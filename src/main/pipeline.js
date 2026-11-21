"use strict";
// Processamento de imagem com sharp. Tudo assincrono (o trabalho pesado do sharp
// roda numa thread nativa, fora do thread do JS), entao a tela nunca trava.
const sharp = require("sharp");

sharp.cache(false);
sharp.concurrency(Math.max(1, (require("os").cpus().length || 2) - 1));

// ---------- helpers de analise ----------
async function estatisticas(buf) {
  const img = sharp(buf);
  const meta = await img.metadata();
  // trabalha numa versao pequena em cinza pra decidir rotacao/branco rapido
  const peq = await sharp(buf).grayscale().resize(400, 560, { fit: "inside" })
    .raw().toBuffer({ resolveWithObject: true });
  return { meta, peq };
}

// percentil simples de um Uint8
function percentil(data, p) {
  const h = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) h[data[i]]++;
  const alvo = (data.length * p) / 100;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= alvo) return v; }
  return 255;
}

// pagina em branco? (quase nenhum pixel escuro)
function ehBranca(raw) {
  const { data } = raw;
  let escuros = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < 140) escuros++;
  return escuros / data.length < 0.004;
}

// ---------- orientacao 90/180/270 por projecao ----------
// Heuristica sem OCR: texto gera muitas "linhas" horizontais. Mede a variacao
// das somas por linha (horizontal) vs por coluna (vertical). Decide retrato vs paisagem.
// Para 180 (de cabeca pra baixo) a heuristica de projecao e fraca; o auto-giro
// forte (conteudo) fica a cargo do OCR opcional (orientacao.js), se habilitado.
function variacaoProjecao(data, w, h) {
  const linhas = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += 255 - data[y * w + x];
    linhas[y] = s;
  }
  let v = 0;
  for (let y = 1; y < h; y++) { const d = linhas[y] - linhas[y - 1]; v += d * d; }
  return v;
}

// ---------- deskew (inclinacao pequena, +-6 graus) ----------
// Pontua o alinhamento das linhas de texto: quanto mais "picos" nitidos na
// projecao horizontal (soma por linha), mais alinhado o texto esta.
function pontuaProjecao(data, w, h) {
  // metodo de Postl: soma dos quadrados das projecoes por linha. E maxima quando
  // o texto esta alinhado (concentrado em poucas linhas). Mais robusta que a
  // diferenca entre linhas vizinhas (que subdetectava o angulo).
  let v = 0;
  for (let y = 0; y < h; y++) {
    let s = 0;
    const base = y * w;
    for (let x = 0; x < w; x++) s += 255 - data[base + x];
    v += s * s;
  }
  return v;
}

// Usa o proprio sharp pra rotacionar uma miniatura em cada angulo candidato.
// Assim o angulo encontrado tem EXATAMENTE a mesma convencao do .rotate() final.
// Binariza o texto antes (text=0, resto=255) pra que a BORDA da folha e o
// preenchimento da rotacao nao atrapalhem a medida — so o texto conta.
async function detectarInclinacao(buf) {
  const base = await sharp(buf).grayscale().resize(800, 1100, { fit: "inside" })
    .raw().toBuffer({ resolveWithObject: true });
  const w0 = base.info.width, h0 = base.info.height;
  const data = base.data;
  // binariza o texto; ignora pixels muito escuros (fundo/cantos de foto, nao texto)
  const T = (percentil(data, 6) + percentil(data, 55)) / 2;
  const bin = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) bin[i] = (data[i] < T && data[i] > 30) ? 0 : 255;

  async function scoreEm(ang) {
    if (ang === 0) return pontuaProjecao(bin, w0, h0);
    const r = await sharp(bin, { raw: { width: w0, height: h0, channels: 1 } })
      .rotate(ang, { background: { r: 255, g: 255, b: 255 } })
      .raw().toBuffer({ resolveWithObject: true });
    return pontuaProjecao(r.data, r.info.width, r.info.height);
  }

  let melhor = 0, melhorV = await scoreEm(0);
  for (let a = -6; a <= 6.0001; a += 0.5) {
    if (a === 0) continue;
    const v = await scoreEm(a);
    if (v > melhorV) { melhorV = v; melhor = a; }
  }
  for (let a = melhor - 0.4; a <= melhor + 0.4001; a += 0.1) {
    const v = await scoreEm(a);
    if (v > melhorV) { melhorV = v; melhor = a; }
  }
  return Math.abs(melhor) < 0.2 ? 0 : Math.round(melhor * 10) / 10;
}

// ---------- recorte do documento numa foto ----------
// acha a regiao clara (a folha) contra o fundo e corta pra ela (eixo-alinhado).
// Se a deteccao for fraca, devolve a imagem original (nao arrisca cortar errado).
async function recortarDocumento(buf) {
  const s = await sharp(buf).grayscale().resize(1000, 1000, { fit: "inside" })
    .raw().toBuffer({ resolveWithObject: true });
  const { data } = s, W = s.info.width, H = s.info.height;
  const thr = Math.max(115, percentil(data, 55)); // folha = claro
  const rowCov = new Float32Array(H), colCov = new Float32Array(W);
  for (let y = 0; y < H; y++) { let c = 0; const b = y * W; for (let x = 0; x < W; x++) if (data[b + x] >= thr) c++; rowCov[y] = c / W; }
  for (let x = 0; x < W; x++) { let c = 0; for (let y = 0; y < H; y++) if (data[y * W + x] >= thr) c++; colCov[x] = c / H; }
  const faixa = (cov, n) => { let a = 0; while (a < n && cov[a] < 0.3) a++; let b = n - 1; while (b > a && cov[b] < 0.3) b--; return [a, b]; };
  const [top, bot] = faixa(rowCov, H), [left, right] = faixa(colCov, W);
  if (bot - top < H * 0.25 || right - left < W * 0.25) return buf; // deteccao fraca
  if ((bot - top) * (right - left) > W * H * 0.96) return buf;     // ja ocupa tudo
  const meta = await sharp(buf).metadata();
  const sx = meta.width / W, sy = meta.height / H;
  const mx = (right - left) * 0.012, my = (bot - top) * 0.012;
  const L = Math.max(0, Math.round((left - mx) * sx)), T = Math.max(0, Math.round((top - my) * sy));
  const Wc = Math.min(meta.width - L, Math.round((right - left + 2 * mx) * sx));
  const Hc = Math.min(meta.height - T, Math.round((bot - top + 2 * my) * sy));
  if (Wc < 10 || Hc < 10) return buf;
  return sharp(buf).extract({ left: L, top: T, width: Wc, height: Hc }).toBuffer();
}

// ---------- processamento principal de uma pagina ----------
// opcoes: { colorido, ajustes:{autoGirar,endireitar,clararFundo,tirarPaginaBranca,recortarFolha},
//           girarManual: 0|90|180|270, ehFoto: bool, orientador: fn opcional }
async function processarPagina(entrada, opcoes = {}) {
  const aj = opcoes.ajustes || {};
  let img = sharp(entrada, { failOn: "none" }).rotate(); // .rotate() sem arg aplica EXIF (foto do iPhone)
  let buf = await img.toBuffer();

  const { peq } = await estatisticas(buf);
  const pw = peq.info.width, ph = peq.info.height;

  // branca?
  if (aj.tirarPaginaBranca && ehBranca(peq)) {
    return { branca: true };
  }

  // orientacao: giroFixo (numero) = giro ja decidido (pelo automatico na 1a vez, ou pelo
  // usuario no botao Girar) — nao roda o automatico de novo (e lento e poderia discordar)
  const temFixo = typeof opcoes.giroFixo === "number";
  let giro = temFixo ? ((opcoes.giroFixo % 360) + 360) % 360 : 0;
  if (!temFixo && aj.autoGirar) {
    if (opcoes.orientador) {
      try { giro = (await opcoes.orientador(buf)) || 0; } catch { giro = 0; }
    }
    if (!giro) {
      // heuristica: se esta "deitado" (mais largo que alto) assume 90
      const varH = variacaoProjecao(peq.data, pw, ph);
      const varV = variacaoProjecao(
        rotacionaRaw90(peq.data, pw, ph).data, ph, pw);
      if (pw > ph * 1.15 && varV > varH) giro = 90;
    }
  }
  if (giro) buf = await sharp(buf).rotate(giro).toBuffer();

  const fundoBranco = { r: 255, g: 255, b: 255 };

  // foto: corta a folha (tira a mesa/fundo) antes de endireitar
  if (aj.recortarFolha && opcoes.ehFoto) {
    try { buf = await recortarDocumento(buf); } catch {}
  }

  // deskew — rotaciona o buffer ANTES de cinza/clareamento
  if (aj.endireitar) {
    const ang = await detectarInclinacao(buf);
    if (ang) buf = await sharp(buf).rotate(ang, { background: fundoBranco }).toBuffer();
  }

  // cor / cinza
  let proc = sharp(buf);
  if (!opcoes.colorido) proc = proc.grayscale();

  // clarear fundo (normalizacao de niveis)
  if (aj.clararFundo) {
    const g = await sharp(buf).grayscale().resize(300, 420, { fit: "inside" }).raw().toBuffer();
    const preto = percentil(g, 2);
    const branco = percentil(g, opcoes.colorido ? 92 : 80);
    if (branco - preto > 40) {
      // mapeia [preto..branco] -> [0..255]
      const mult = 255 / (branco - preto);
      proc = proc.linear(mult, -preto * mult);
    } else {
      proc = proc.normalise();
    }
  }

  // nitidez: realca as bordas do texto (sharpen leve)
  if (aj.nitidez) proc = proc.sharpen({ sigma: 1, m1: 0.5, m2: 2 });

  let saida = await proc.toBuffer();

  // recorte manual (feito no visualizador): retangulo normalizado 0..1 sobre a pagina pronta
  if (opcoes.recorte) {
    try { saida = await aplicarRecorte(saida, opcoes.recorte); } catch {}
  }

  const meta = await sharp(saida).metadata();
  return { buffer: saida, width: meta.width, height: meta.height, giro };
}

// corta um retangulo normalizado { x, y, w, h } (0..1) da imagem
async function aplicarRecorte(buf, r) {
  const meta = await sharp(buf).metadata();
  const W = meta.width, H = meta.height;
  const left = Math.max(0, Math.min(W - 1, Math.round(r.x * W)));
  const top = Math.max(0, Math.min(H - 1, Math.round(r.y * H)));
  const width = Math.max(1, Math.min(W - left, Math.round(r.w * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(r.h * H)));
  if (width < 16 || height < 16) return buf; // pequeno demais: provavelmente clique sem querer
  return sharp(buf).extract({ left, top, width, height }).toBuffer();
}

// o original tem cor? (escaneado em cinza nao tem o que colorir)
async function temCor(buf) {
  try {
    const { data, info } = await sharp(buf, { failOn: "none" }).resize(120, 120, { fit: "inside" })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels < 3) return false;
    let dif = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      dif += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    }
    return dif / (data.length / info.channels) >= 6; // saturacao media quase zero = cinza
  } catch { return true; }
}

// rotaciona raw cinza 90 graus (horario) — pra heuristica de orientacao
function rotacionaRaw90(data, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out[x * h + (h - 1 - y)] = data[y * w + x];
  return { data: out, w: h, h: w };
}

// gera uma miniatura JPEG (data URL) pra tela
async function miniatura(entrada, tamanho = 150, opcoes = {}) {
  try {
    let img = sharp(entrada, { failOn: "none" }).rotate();
    if (opcoes.giro) img = img.rotate(opcoes.giro);
    const b = await img.resize(tamanho * 2, tamanho * 2, { fit: "inside" })
      .jpeg({ quality: 60 }).toBuffer();
    return "data:image/jpeg;base64," + b.toString("base64");
  } catch {
    return null;
  }
}

module.exports = { processarPagina, miniatura, detectarInclinacao, recortarDocumento, aplicarRecorte, temCor };
