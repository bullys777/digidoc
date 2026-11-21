"use strict";
// Giro automatico 0/90/180/270 pelo conteudo (como o HP Smart), usando o OSD do
// tesseract.js, 100% offline. O worker e criado uma vez e reaproveitado.
const { createWorker, OEM } = require("tesseract.js");
const fs = require("fs");
const path = require("path");

let workerP = null;
let PATHS = { core: "", lang: "" };
let LIMIAR_CONF = 1.0;

function configurar(paths, limiar) {
  PATHS = Object.assign({ core: "", lang: "" }, paths);
  if (typeof limiar === "number") LIMIAR_CONF = limiar;
}

// Acha a pasta do tesseract.js-core em dev E empacotado (onde ele fica aninhado
// em tesseract.js/node_modules e precisa vir do app.asar.unpacked).
function resolverCore() {
  if (PATHS.core && fs.existsSync(PATHS.core)) return PATHS.core;
  const unpack = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const cands = [];
  try {
    const dir = path.dirname(require.resolve("tesseract.js/package.json"));
    cands.push(unpack(path.join(dir, "node_modules", "tesseract.js-core"))); // aninhado (pacote/dev)
    cands.push(unpack(path.join(dir, "..", "tesseract.js-core")));           // hoisted (dev)
  } catch {}
  try { cands.push(unpack(path.dirname(require.resolve("tesseract.js-core/package.json")))); } catch {}
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return cands[0] || "";
}

function disponivel() {
  try { return !!PATHS.lang && fs.existsSync(path.join(PATHS.lang, "osd.traineddata")); }
  catch { return false; }
}

function obterWorker() {
  if (!workerP) {
    workerP = createWorker("osd", OEM.TESSERACT_ONLY, {
      corePath: resolverCore(), langPath: PATHS.lang,
      cacheMethod: "none", gzip: false,
      legacyCore: true, legacyLang: true,
      logger: () => {}, errorHandler: () => {},
    }).catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

// retorna o giro (horario) a aplicar pra endireitar: 0, 90, 180 ou 270
async function detectarGiro(buffer) {
  if (!disponivel()) return 0;
  try {
    const w = await obterWorker();
    const { data } = await w.detect(buffer);
    if ((data.orientation_confidence || 0) >= LIMIAR_CONF) {
      const g = (((data.orientation_degrees || 0) % 360) + 360) % 360;
      if (g === 90 || g === 180 || g === 270) return g;
    }
  } catch { /* se falhar, nao gira (cai na heuristica do pipeline) */ }
  return 0;
}

async function encerrar() {
  if (workerP) { try { (await workerP).terminate(); } catch {} workerP = null; }
}

module.exports = { configurar, detectarGiro, encerrar, disponivel };
