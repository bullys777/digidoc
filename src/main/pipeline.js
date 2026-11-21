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
  // binariza o texto; ignora pixels muito escuros (fundo/cantos de foto, nao texto).
  // Em pagina quase toda branca o meio-termo dos percentis fica ~255 e pegava ate o cinza claro de
  // um cartao (RG) como "texto": o limite nunca passa de (cor do papel - 50).
  const papel = percentil(data, 90);
  const T = Math.min((percentil(data, 6) + percentil(data, 55)) / 2, papel - 50);
  const bin = Buffer.allocUnsafe(data.length);
  let tinta = 0;
  for (let i = 0; i < data.length; i++) { const t = data[i] < T && data[i] > 30; bin[i] = t ? 0 : 255; if (t) tinta++; }
  if (tinta < data.length * 0.002) return 0; // quase nada escrito: nao tem o que endireitar

  async function scoreEm(ang) {
    if (ang === 0) return pontuaProjecao(bin, w0, h0);
    const r = await sharp(bin, { raw: { width: w0, height: h0, channels: 1 } })
      .rotate(ang, { background: { r: 255, g: 255, b: 255 } })
      .raw().toBuffer({ resolveWithObject: true });
    return pontuaProjecao(r.data, r.info.width, r.info.height);
  }

  const v0 = await scoreEm(0);
  let melhor = 0, melhorV = v0;
  for (let a = -6; a <= 6.0001; a += 0.5) {
    if (a === 0) continue;
    const v = await scoreEm(a);
    if (v > melhorV) { melhorV = v; melhor = a; }
  }
  // ajuste fino em volta do melhor. (Bug antigo: o limite do laco usava "melhor", que muda dentro
  // do laco — numa pagina com moldura ele ia "andando" ate 20 graus.)
  const centro = melhor;
  for (let a = centro - 0.4; a <= centro + 0.4001; a += 0.1) {
    const v = await scoreEm(a);
    if (v > melhorV) { melhorV = v; melhor = a; }
  }
  // sem pico claro: o melhor caiu na borda da busca ou e so um pouquinho melhor que 0 -> nao mexe
  if (Math.abs(melhor) >= 5.6 || melhorV < v0 * 1.03) return 0;
  return Math.abs(melhor) < 0.3 ? 0 : Math.round(melhor * 10) / 10; // menos de 0,3 grau: nem mexe
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

  // pagina montada pelo proprio app (ex.: "juntar paginas"): ja esta tratada. So gira, cor e recorte.
  if (opcoes.semAjustes) {
    const g = typeof opcoes.giroFixo === "number" ? ((opcoes.giroFixo % 360) + 360) % 360 : 0;
    let p = sharp(buf);
    if (g) p = p.rotate(g);
    if (!opcoes.colorido) p = p.grayscale();
    let saida = await p.toBuffer();
    if (opcoes.recorte) { try { saida = await aplicarRecorte(saida, opcoes.recorte); } catch {} }
    const m = await sharp(saida).metadata();
    return { buffer: saida, width: m.width, height: m.height, giro: g };
  }

  const { peq } = await estatisticas(buf);

  // branca?
  if (aj.tirarPaginaBranca && ehBranca(peq)) {
    return { branca: true };
  }

  // orientacao: giroFixo (numero) = giro ja decidido (pelo automatico na 1a vez, ou pelo
  // usuario no botao Girar) — nao roda o automatico de novo (e lento e poderia discordar)
  const temFixo = typeof opcoes.giroFixo === "number";
  let giro = temFixo ? ((opcoes.giroFixo % 360) + 360) % 360 : 0;
  let giroIncerto = false;
  if (!temFixo && aj.autoGirar && opcoes.orientador) {
    // modelo de orientacao + Tesseract (orientacao.js). Sem certeza = nao gira (e avisa pra conferir).
    // (antes havia um "chute": pagina deitada sempre girava 90 pro mesmo lado — errava metade)
    try {
      const d = await opcoes.orientador(buf);
      if (d && typeof d === "object") { giro = d.giro || 0; giroIncerto = d.fonte === "incerto"; }
      else giro = d || 0;
    } catch { giro = 0; }
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

  // pagina colorida com "manter a cor do scanner" (padrao): as cores ficam exatamente como o
  // scanner mandou. Esticar o contraste em cor queima os claros e satura demais (fica "estourado").
  const manterCor = !!opcoes.colorido && aj.corOriginal !== false;

  // clarear fundo (normalizacao de niveis)
  if (aj.clararFundo && !manterCor) {
    const g = await sharp(buf).grayscale().resize(300, 420, { fit: "inside" }).raw().toBuffer();
    if (opcoes.colorido) {
      // colorido sem manter a cor: so leva o papel amarelado/cinza pro branco, com UM multiplicador
      // (nao escurece o preto nem satura as cores) e cortando so os 2% mais claros
      const branco = percentil(g, 98);
      if (branco > 140 && branco < 250) proc = proc.linear(255 / branco, 0);
    } else {
      const preto = percentil(g, 2);
      const branco = percentil(g, 80);
      if (branco - preto > 40) {
        // mapeia [preto..branco] -> [0..255]
        const mult = 255 / (branco - preto);
        proc = proc.linear(mult, -preto * mult);
      } else {
        proc = proc.normalise();
      }
    }
  }

  // nitidez: realca as bordas do texto (sharpen leve). Em cor so cria halo: so no cinza.
  if (aj.nitidez && !opcoes.colorido) proc = proc.sharpen({ sigma: 1, m1: 0.5, m2: 2 });

  let saida = await proc.toBuffer();

  // recorte manual (feito no visualizador): retangulo normalizado 0..1 sobre a pagina pronta
  if (opcoes.recorte) {
    try { saida = await aplicarRecorte(saida, opcoes.recorte); } catch {}
  }

  const meta = await sharp(saida).metadata();
  return { buffer: saida, width: meta.width, height: meta.height, giro, giroIncerto };
}

// "impressao digital" da pagina pra achar pagina repetida: 120x168 em cinza, contraste esticado e
// levemente borrada (tira o serrilhado das letras). A tela compara procurando o melhor encaixe.
const DIGITAL_W = 120, DIGITAL_H = 168;
async function digital(buf) {
  const { data } = await sharp(buf, { failOn: "none" }).grayscale().normalise().blur(2.5)
    .resize(DIGITAL_W, DIGITAL_H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(data).toString("base64");
}

// junta varias paginas numa so (ex.: RG frente e verso numa folha). Corta as margens brancas de cada
// uma, empilha e, se couber, poe numa folha A4 (no dpi do scanner) — fica do tamanho real.
async function juntarPaginas(bufs, { dpi = 200, colorido = false } = {}) {
  const pedacos = [];
  for (const b of bufs) {
    let p = sharp(b, { failOn: "none" }).flatten({ background: "#ffffff" });
    try { p = sharp(await p.trim({ background: "#ffffff", threshold: 40 }).toBuffer()); } catch { p = sharp(b, { failOn: "none" }); }
    const buf = await p.toBuffer();
    const m = await sharp(buf).metadata();
    pedacos.push({ buf, w: m.width, h: m.height });
  }
  const a4w = Math.round(8.27 * dpi), a4h = Math.round(11.69 * dpi), margem = Math.round(0.4 * dpi), vao = Math.round(0.25 * dpi);
  // largura comum: a maior, mas nunca mais larga que a folha A4 (menos as margens)
  const larg = Math.min(Math.max(...pedacos.map((p) => p.w)), a4w - 2 * margem);
  const prontos = [];
  for (const p of pedacos) {
    const esc = p.w > larg ? larg / p.w : 1;
    const w = Math.round(p.w * esc), h = Math.round(p.h * esc);
    prontos.push({ input: esc < 1 ? await sharp(p.buf).resize(w, h).toBuffer() : p.buf, w, h });
  }
  const altura = prontos.reduce((s, p) => s + p.h, 0) + vao * (prontos.length - 1);
  const cabeA4 = altura <= a4h - 2 * margem;
  const W = cabeA4 ? a4w : larg + 2 * margem, H = cabeA4 ? a4h : altura + 2 * margem;
  let y = margem;
  const camadas = prontos.map((p) => { const c = { input: p.input, left: Math.round((W - p.w) / 2), top: y }; y += p.h + vao; return c; });
  let out = sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(camadas);
  if (!colorido) out = out.grayscale();
  return out.jpeg({ quality: 92 }).toBuffer();
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

module.exports = { processarPagina, miniatura, detectarInclinacao, recortarDocumento, aplicarRecorte, temCor, digital, juntarPaginas };
