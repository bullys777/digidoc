"use strict";
// Giro automatico 0/90/180/270, 100% offline. Tres etapas, da mais confiavel pra menos:
//
//  1) Modelo PP-LCNet_x1_0_doc_ori (PaddleOCR, Apache-2.0), um classificador treinado so pra
//     orientacao de documento (~99% de acerto declarado, 9 ms por imagem). Pra ficar ainda mais
//     firme, olha a pagina de 2 jeitos (centro e pagina inteira) x 4 giros e junta as respostas.
//  2) Se o modelo nao tiver certeza: Tesseract OSD, so aceito com confianca >= 2 (abaixo disso o
//     OSD costuma "chutar" — e o que mais errava antes, ex.: RG pequeno no vidro).
//  3) Se ninguem tiver certeza: NAO gira. Melhor deixar como veio do que girar errado.
//
// Nos testes (comprovante, folha quase vazia, RG no vidro, formulario, cada um nos 4 giros):
// modelo 16/16, Tesseract sozinho 13/16. Foto sem texto: o modelo fica sem certeza e nao gira.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

let PATHS = { core: "", lang: "", modelo: "" };
const CONF_MODELO = 0.45; // abaixo disso o modelo "nao sabe" (foto sem texto ficou em 36%)
const CONF_OSD = 2.0;     // OSD: paginas boas ficam entre 2 e 5; abaixo e ruido

function configurar(paths) { PATHS = Object.assign({ core: "", lang: "", modelo: "" }, paths); }

// ======================= 1) modelo (onnxruntime) =======================
let sessaoP = null, ort = null;
function obterSessao() {
  if (!sessaoP) {
    sessaoP = (async () => {
      if (!PATHS.modelo || !fs.existsSync(PATHS.modelo)) throw new Error("modelo de orientacao ausente");
      ort = require("onnxruntime-node");
      // le o arquivo pelo fs do Electron (funciona dentro do app.asar) e passa os bytes
      return ort.InferenceSession.create(fs.readFileSync(PATHS.modelo), { logSeverityLevel: 3, intraOpNumThreads: 2 });
    })().catch((e) => { sessaoP = null; throw e; });
  }
  return sessaoP;
}

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225], LADO = 224;

// imagem RGB crua (lado x lado) -> tensor normalizado CHW
function paraTensor(data) {
  const n = LADO * LADO, f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) f[c * n + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  return new ort.Tensor("float32", f, [1, 3, LADO, LADO]);
}

// as duas "vistas" da pagina, ja pequenas (o giro e feito na imagem pequena: rapido)
async function vistas(buf) {
  const m = await sharp(buf, { failOn: "none" }).metadata();
  const w0 = m.width, h0 = m.height;
  // a) como o modelo foi treinado: lado menor = 256 e corta o centro 224x224
  const esc = 256 / Math.min(w0, h0);
  const w = Math.max(LADO, Math.round(w0 * esc)), h = Math.max(LADO, Math.round(h0 * esc));
  const centro = await sharp(buf, { failOn: "none" }).removeAlpha().toColourspace("srgb").resize(w, h, { fit: "fill" }).png().toBuffer();
  // b) pagina inteira encaixada em 224x224 com borda branca (pega texto que fica so no topo/rodape)
  const inteira = await sharp(buf, { failOn: "none" }).removeAlpha().toColourspace("srgb")
    .resize(LADO, LADO, { fit: "contain", background: { r: 255, g: 255, b: 255 } }).png().toBuffer();
  return { centro, inteira };
}

async function cortarCentro(png) {
  const img = sharp(png); const m = await img.metadata();
  return img.extract({ left: Math.floor((m.width - LADO) / 2), top: Math.floor((m.height - LADO) / 2), width: LADO, height: LADO })
    .raw().toBuffer();
}

// devolve { giro (correcao horaria a aplicar), conf } ou null
async function pelaRede(buf) {
  const s = await obterSessao();
  const v = await vistas(buf);
  const soma = [0, 0, 0, 0];
  let n = 0;
  for (const [nome, png] of Object.entries(v)) {
    for (const r of [0, 90, 180, 270]) {
      const girada = r ? await sharp(png).rotate(r).png().toBuffer() : png;
      const raw = nome === "centro" ? await cortarCentro(girada) : await sharp(girada).raw().toBuffer();
      const out = await s.run({ [s.inputNames[0]]: paraTensor(raw) });
      const p = Array.from(out[s.outputNames[0]].data);
      // girar r a mais soma r na classe: alinha cada resposta com a pagina original
      for (let k = 0; k < 4; k++) soma[k] += p[(k + r / 90) % 4];
      n++;
    }
  }
  for (let k = 0; k < 4; k++) soma[k] /= n;
  const i = soma.indexOf(Math.max(...soma));
  // classe k = a pagina esta girada k graus (horario) -> corrige girando (360 - k)
  return { giro: (360 - i * 90) % 360, conf: soma[i] };
}

// ======================= 2) Tesseract OSD (segunda opiniao) =======================
let workerP = null;
function resolverCore() {
  if (PATHS.core && fs.existsSync(PATHS.core)) return PATHS.core;
  const unpack = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const cands = [];
  try {
    const dir = path.dirname(require.resolve("tesseract.js/package.json"));
    cands.push(unpack(path.join(dir, "node_modules", "tesseract.js-core")));
    cands.push(unpack(path.join(dir, "..", "tesseract.js-core")));
  } catch {}
  try { cands.push(unpack(path.dirname(require.resolve("tesseract.js-core/package.json")))); } catch {}
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return cands[0] || "";
}
const osdDisponivel = () => { try { return !!PATHS.lang && fs.existsSync(path.join(PATHS.lang, "osd.traineddata")); } catch { return false; } };
function obterWorker() {
  if (!workerP) {
    const { createWorker, OEM } = require("tesseract.js");
    workerP = createWorker("osd", OEM.TESSERACT_ONLY, {
      corePath: resolverCore(), langPath: PATHS.lang, cacheMethod: "none", gzip: false,
      legacyCore: true, legacyLang: true, logger: () => {}, errorHandler: () => {},
    }).catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}
async function peloOSD(buf) {
  if (!osdDisponivel()) return null;
  // cinza, contraste normalizado, ~300 dpi e com a resolucao gravada (sem ela o Tesseract assume 70 dpi e erra mais)
  const prep = await sharp(buf, { failOn: "none" }).grayscale().normalise()
    .resize(2480, 2480, { fit: "inside", withoutEnlargement: false }).withMetadata({ density: 300 }).png().toBuffer();
  const w = await obterWorker();
  const { data } = await w.detect(prep);
  const conf = data.orientation_confidence || 0;
  const g = (((data.orientation_degrees || 0) % 360) + 360) % 360;
  return { giro: [0, 90, 180, 270].includes(g) ? g : 0, conf };
}

// ======================= decisao =======================
// detalhado: { giro, fonte: "modelo"|"osd"|"incerto", conf }
async function detectarDetalhado(buffer) {
  let rede = null;
  try { rede = await pelaRede(buffer); } catch {}
  if (rede && rede.conf >= CONF_MODELO) return { giro: rede.giro, fonte: "modelo", conf: rede.conf };
  let osd = null;
  try { osd = await peloOSD(buffer); } catch {}
  if (osd && osd.conf >= CONF_OSD) {
    // o modelo tinha um palpite fraco e o OSD concorda: otimo. Se discordam, vale o OSD so se bem confiante.
    if (!rede || rede.giro === osd.giro || osd.conf >= CONF_OSD * 2) return { giro: osd.giro, fonte: "osd", conf: osd.conf };
  }
  return { giro: 0, fonte: "incerto", conf: rede ? rede.conf : 0 };
}

// retorna o giro (horario) a aplicar pra endireitar: 0, 90, 180 ou 270
async function detectarGiro(buffer) {
  try { return (await detectarDetalhado(buffer)).giro; } catch { return 0; }
}

async function encerrar() {
  if (workerP) { try { (await workerP).terminate(); } catch {} workerP = null; }
  if (sessaoP) { try { (await sessaoP).release(); } catch {} sessaoP = null; }
}

const disponivel = () => (!!PATHS.modelo && fs.existsSync(PATHS.modelo)) || osdDisponivel();

module.exports = { configurar, detectarGiro, detectarDetalhado, encerrar, disponivel };
