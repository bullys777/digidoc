"use strict";
// Geracao do PDF a partir das paginas ja processadas, com compressao automatica
// ate caber no limite (padrao 2 MB). NUNCA divide (o usuario pediu).
// Estilo iLovePDF: 3 niveis de partida; se nao couber, aperta mais sozinho.
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");

// escadas (dpi, qualidade). O nivel escolhido so muda por onde a escada COMECA.
const ESCADA = [
  { dpi: 300, q: 85 }, // pouca (comeca aqui)
  { dpi: 250, q: 80 },
  { dpi: 200, q: 72 }, // recomendada (comeca aqui)
  { dpi: 200, q: 60 },
  { dpi: 170, q: 55 },
  { dpi: 150, q: 50 }, // extrema (comeca aqui)
  { dpi: 150, q: 42 },
  { dpi: 120, q: 45 },
  { dpi: 110, q: 38 },
  { dpi: 100, q: 32 },
  { dpi: 90, q: 28 },
  { dpi: 80, q: 24 },
];

const INICIO = { pouca: 0, recomendada: 2, extrema: 5 };

// grava num temporario ao lado e so depois troca pelo arquivo final: se o app fechar ou o
// pendrive sair no meio, o PDF que ja existia (ex.: "adicionar paginas") continua inteiro
async function gravarSeguro(caminho, bytes) {
  const fs = require("fs");
  const tmp = caminho + ".salvando";
  fs.writeFileSync(tmp, bytes);
  for (let tentativa = 1; ; tentativa++) {
    try { fs.renameSync(tmp, caminho); return; }
    catch (e) {
      // antivirus/indexador as vezes segura o arquivo novo por um instante
      if (tentativa >= 6 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        throw e;
      }
      await new Promise((ok) => setTimeout(ok, 250));
    }
  }
}

// A4 em polegadas (pra calcular o tamanho da pagina no PDF a partir do dpi)
function pontosA4(wpx, hpx, dpi) {
  return [(wpx / dpi) * 72, (hpx / dpi) * 72];
}

// paginas: [{ buffer, width, height, dpiOrigem }]
// retorna { bytes, dpi, q, caminho } ou lanca erro se nao couber nem no fim da escada.
async function gerarPDF(paginas, caminho, { maxBytes, nivel = "recomendada", pb = false, onProgresso } = {}) {
  if (!paginas || !paginas.length) throw new Error("Nenhuma pagina pra salvar.");
  const fs = require("fs");
  const inicio = INICIO[nivel] ?? 2;

  async function montar(i) {
    const { dpi, q } = ESCADA[i];
    const doc = await PDFDocument.create();
    for (let p = 0; p < paginas.length; p++) {
      const pg = paginas[p];
      const dpiOrig = pg.dpiOrigem || 200;
      const fator = Math.min(1, dpi / dpiOrig);
      let img = sharp(pg.buffer);
      if (fator < 1) {
        img = img.resize(Math.max(1, Math.round(pg.width * fator)),
                         Math.max(1, Math.round(pg.height * fator)));
      }
      if (pb) img = img.grayscale().threshold(170); // preto e branco deixa texto bem leve
      const jpg = await img.jpeg({ quality: q, mozjpeg: true }).toBuffer();
      const meta = await sharp(jpg).metadata();
      const emb = await doc.embedJpg(jpg);
      const [pw, ph] = pontosA4(meta.width, meta.height, fator < 1 ? dpi : dpiOrig);
      doc.addPage([pw, ph]).drawImage(emb, { x: 0, y: 0, width: pw, height: ph });
      if (onProgresso) onProgresso({ etapa: "montando", pagina: p + 1, total: paginas.length });
    }
    return { bytes: await doc.save({ useObjectStreams: true }), dpi, q };
  }

  // busca binaria: acha a MELHOR qualidade (menor indice) que cabe no limite.
  let lo = inicio, hi = ESCADA.length - 1, escolhido = null, ultimoBuf = null, ultimo = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = await montar(mid);
    ultimoBuf = r.bytes; ultimo = { dpi: r.dpi, q: r.q };
    if (r.bytes.length <= maxBytes) { escolhido = { ...r, i: mid }; hi = mid - 1; }
    else lo = mid + 1;
  }
  if (escolhido) {
    await gravarSeguro(caminho, escolhido.bytes);
    return { bytes: escolhido.bytes.length, dpi: escolhido.dpi, q: escolhido.q, caminho, pb };
  }

  // nao coube nem no fim da escada. Tenta preto e branco como ultimo recurso.
  if (!pb) {
    return gerarPDF(paginas, caminho, { maxBytes, nivel: "extrema", pb: true, onProgresso });
  }

  // ainda nao coube: salva o menor que conseguiu e avisa (sem dividir).
  await gravarSeguro(caminho, ultimoBuf);
  const e = new Error(
    `Mesmo no maximo de compressao o PDF ficou com ${(ultimoBuf.length / 1024 / 1024).toFixed(2)} MB, ` +
    `acima do limite de ${(maxBytes / 1024 / 1024).toFixed(1)} MB.\n` +
    `Salvei assim mesmo (voce pediu pra nunca dividir). Opcoes: escanear em preto e branco, ` +
    `tirar paginas em branco, ou aumentar o limite nas configuracoes.`
  );
  e.salvouAcimaDoLimite = true;
  e.caminho = caminho;
  e.bytes = ultimoBuf.length;
  throw e;
}

// adiciona paginas a um PDF ja existente, mantendo o resultado <= maxBytes.
// Estrategia simples e robusta: le as imagens do PDF antigo nao e trivial, entao
// recebemos as paginas antigas ja como imagens (o chamador guarda isso) OU, se so
// temos o arquivo, anexamos as novas e recomprimimos tudo via rasterizacao externa.
// Aqui tratamos o caso comum: juntar PDFs de imagens -> ver merge.js (futuro).
// Adiciona paginas novas a um PDF ja existente, recomprimindo SO as novas pra
// tentar manter <= maxBytes (as paginas antigas sao preservadas como estao).
async function adicionarAoPDF(caminhoExistente, novas, { maxBytes, onProgresso } = {}) {
  const fs = require("fs");
  if (!novas || !novas.length) throw new Error("Nenhuma página nova pra adicionar.");
  const orig = fs.readFileSync(caminhoExistente);

  async function montar(i) {
    const { dpi, q } = ESCADA[i];
    const doc = await PDFDocument.load(orig);
    for (let p = 0; p < novas.length; p++) {
      const pg = novas[p];
      const dpiOrig = pg.dpiOrigem || 200;
      const fator = Math.min(1, dpi / dpiOrig);
      let img = sharp(pg.buffer);
      if (fator < 1) img = img.resize(Math.max(1, Math.round(pg.width * fator)), Math.max(1, Math.round(pg.height * fator)));
      const jpg = await img.jpeg({ quality: q, mozjpeg: true }).toBuffer();
      const meta = await sharp(jpg).metadata();
      const emb = await doc.embedJpg(jpg);
      const [pw, ph] = pontosA4(meta.width, meta.height, fator < 1 ? dpi : dpiOrig);
      doc.addPage([pw, ph]).drawImage(emb, { x: 0, y: 0, width: pw, height: ph });
      if (onProgresso) onProgresso({ etapa: "adicionando", pagina: p + 1, total: novas.length });
    }
    return doc.save({ useObjectStreams: true });
  }

  let lo = 0, hi = ESCADA.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = await montar(mid);
    if (b.length <= maxBytes) { best = b; hi = mid - 1; } else lo = mid + 1;
  }
  if (best) { await gravarSeguro(caminhoExistente, best); return { bytes: best.length, caminho: caminhoExistente }; }

  const menor = await montar(ESCADA.length - 1);
  await gravarSeguro(caminhoExistente, menor);
  const e = new Error(
    `Mesmo comprimindo, ficou ${(menor.length / 1024 / 1024).toFixed(2)} MB (acima de ${(maxBytes / 1024 / 1024).toFixed(1)} MB). ` +
    `O PDF original já era grande. Salvei assim mesmo.`);
  e.salvouAcimaDoLimite = true; e.caminho = caminhoExistente; e.bytes = menor.length;
  throw e;
}

module.exports = { gerarPDF, adicionarAoPDF, gravarSeguro, ESCADA, INICIO };
