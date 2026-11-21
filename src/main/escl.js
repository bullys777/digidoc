"use strict";
// Impressoras/scanners de REDE (eSCL / AirScan / Mopria) — so leitura, so modulos do Node.
//  - procurarNaRede(): pergunta mDNS de uma vez (_uscan/_uscans) -> aparelhos da rede em ~1,5 s
//  - acharEndereco(ip): descobre http(s)://ip:porta/eSCL/ quando so se sabe o IP
//  - lerCapacidades(): tem vidro (Platen)? alimentador (Adf)? frente e verso?
//  - lerEstado(): o aparelho esta livre? tem papel no alimentador (AdfState)?
// So faz GET de ScannerCapabilities e ScannerStatus. Escanear continua sendo com o NAPS2.
const http = require("http");
const https = require("https");
const net = require("net");
const dgram = require("dgram");
const os = require("os");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ leitor de XML minimo ============================ */
// Casa pelo nome LOCAL do elemento (ignora o prefixo scan:/pwg:).
function desfazEntidades(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e];
  });
}

function lerXml(xml) {
  let s = String(xml == null ? "" : xml).replace(/^﻿/, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!doctype[^>[]*(\[[\s\S]*?\])?\s*>/gi, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, c) => c.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  const tagRe = /<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const topo = { local: "#doc", children: [], text: "" };
  const pilha = [topo];
  let m;
  while ((m = tagRe.exec(s))) {
    const atual = pilha[pilha.length - 1];
    if (m[5] !== undefined) { if (atual !== topo) atual.text += m[5]; continue; }
    const nome = m[2];
    if (m[1] === "/") { // fecha: volta ate a tag aberta com o mesmo nome (tolera pequenos erros)
      for (let k = pilha.length - 1; k > 0; k--) if (pilha[k].name === nome) { pilha.length = k; break; }
      continue;
    }
    const i = nome.indexOf(":");
    const el = { name: nome, local: i >= 0 ? nome.slice(i + 1) : nome, children: [], text: "" };
    atual.children.push(el);
    if (m[4] !== "/") pilha.push(el);
  }
  return topo.children[0] || null;
}
const filhos = (el, local) => (el ? el.children.filter((c) => c.local === local) : []);
const filho = (el, local) => filhos(el, local)[0] || null;
const texto = (el) => (el ? desfazEntidades(el.text).trim() : null);

/* ============================ ScannerCapabilities ============================ */
// Mesmas regras do NAPS2 8.5.1 (o que ele aceita no --source):
// vidro = Platen>PlatenInputCaps, alimentador = Adf>AdfSimplexInputCaps, frente e verso = Adf>AdfDuplexInputCaps
function capacidadesDoXml(xml) {
  const raiz = lerXml(xml);
  if (!raiz || raiz.local !== "ScannerCapabilities") throw new Error("nao e ScannerCapabilities");
  const adf = filho(raiz, "Adf");
  const opcoes = filhos(filho(adf, "AdfOptions"), "AdfOption").map(texto).filter(Boolean);
  return {
    modelo: texto(filho(raiz, "MakeAndModel")),
    fabricante: texto(filho(raiz, "Manufacturer")),
    uuid: texto(filho(raiz, "UUID")),
    vidro: !!filho(filho(raiz, "Platen"), "PlatenInputCaps"),
    alimentador: !!filho(adf, "AdfSimplexInputCaps"),
    duplex: !!filho(adf, "AdfDuplexInputCaps"),
    detectaPapel: opcoes.includes("DetectPaperLoaded"),
  };
}

/* =============================== ScannerStatus =============================== */
const ESTADOS_ADF = {
  ScannerAdfLoaded: "com_papel",
  ScannedAdfLoaded: "com_papel",        // grafia errada de servidores NAPS2 antigos
  ScannerAdfEmpty: "vazio",
  ScannerAdfProcessing: "processando",  // Kyocera manda isso com o alimentador vazio: tratar como "nao sei"
  ScannerAdfJam: "atolado",
  ScannerAdfMispick: "atolado",
  ScannerAdfMultipickDetected: "atolado",
  ScannerAdfHatchOpen: "tampa_aberta",
  ScannerAdfDoorOpen: "tampa_aberta",   // grafia fora do padrao usada por alguns aparelhos
  ScannerAdfDuplexPageTooShort: "erro_adf",
  ScannerAdfDuplexPageTooLong: "erro_adf",
  ScannerAdfInputTrayFailed: "erro_adf",
  ScannerAdfInputTrayOverloaded: "erro_adf",
};
const ESTADOS = { Idle: "livre", Processing: "ocupado", Testing: "aquecendo", Stopped: "parado", Down: "desligado" };

function estadoDoXml(xml) {
  const raiz = lerXml(xml);
  if (!raiz || raiz.local !== "ScannerStatus") throw new Error("nao e ScannerStatus");
  const e = texto(filho(raiz, "State"));
  const a = texto(filho(raiz, "AdfState"));
  return { estado: ESTADOS[e] || "desconhecido", adf: a == null ? "ausente" : ESTADOS_ADF[a] || "desconhecido", bruto: { e, a } };
}

/* ==================================== HTTP ==================================== */
// portas de impressao direta: qualquer byte mandado ali SAI IMPRESSO. Nunca falar com elas,
// nem se um anuncio na rede (mDNS) disser que o scanner esta la.
function portaProibida(url) {
  let p;
  try { const u = new URL(url); p = Number(u.port || (u.protocol === "https:" ? 443 : 80)); } catch { return true; }
  return p === 515 || (p >= 9100 && p <= 9107);
}

function httpGet(url, { tempoMs = 3000, conectarMs = 1500, maxBytes = 2 << 20 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve({ ok: false, erro: "url" }); return; }
    if (portaProibida(url)) { resolve({ ok: false, erro: "porta_proibida" }); return; }
    const tls = u.protocol === "https:";
    const opcoes = {
      method: "GET", host: u.hostname.replace(/^\[|\]$/g, ""), port: u.port || (tls ? 443 : 80),
      path: u.pathname + u.search, agent: false,
      headers: { Accept: "text/xml, application/xml;q=0.9, */*;q=0.1", Connection: "close" },
    };
    if (tls) { opcoes.rejectUnauthorized = false; opcoes.minVersion = "TLSv1"; } // certificado proprio da impressora
    let fim = false, conectou = false, tTudo = null, tConexao = null;
    const terminar = (r) => { if (fim) return; fim = true; clearTimeout(tTudo); clearTimeout(tConexao); resolve(r); };
    const req = (tls ? https : http).request(opcoes, (res) => {
      const partes = []; let tam = 0;
      res.on("data", (c) => {
        tam += c.length;
        if (tam > maxBytes) { req.destroy(); terminar({ ok: false, erro: "grande", status: res.statusCode }); } else partes.push(c);
      });
      res.on("end", () => terminar({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, corpo: Buffer.concat(partes).toString("utf8") }));
      res.on("error", (e) => terminar({ ok: false, erro: e.code || e.message, status: res.statusCode }));
    });
    tTudo = setTimeout(() => { req.destroy(); terminar({ ok: false, erro: "tempo" }); }, tempoMs);
    tConexao = setTimeout(() => { if (!conectou) { req.destroy(); terminar({ ok: false, erro: "sem_conexao" }); } }, conectarMs);
    req.on("socket", (s) => { if (!s.connecting) conectou = true; else s.once("connect", () => { conectou = true; }); });
    req.on("error", (e) => terminar({ ok: false, erro: e.code || e.message }));
    req.end();
  });
}

// so abre a conexao TCP (nao manda nenhum byte) pra pular portas fechadas rapido
function portaAberta(host, porta, tempoMs = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port: porta });
    const t = setTimeout(() => { s.destroy(); resolve(false); }, tempoMs);
    s.once("connect", () => { clearTimeout(t); s.destroy(); resolve(true); });
    s.once("error", () => { clearTimeout(t); resolve(false); });
  });
}

// "rs" do mDNS: sem barras; ausente -> "eSCL"; vazio -> raiz do servidor
function normRs(rs) {
  if (rs === undefined || rs === null || rs === true) return "eSCL/";
  const t = String(rs).replace(/^\/+|\/+$/g, "");
  return t ? t + "/" : "";
}
const hostDe = (ip) => (net.isIPv6(ip) ? `[${ip}]` : ip);
const montarBase = (esquema, ip, porta, rs) => `${esquema}://${hostDe(ip)}:${porta}/${normRs(rs)}`;

/* ============================ capacidades e estado ============================ */
async function lerCapacidades(base, tempoMs = 3000) {
  const r = await httpGet(base + "ScannerCapabilities", { tempoMs, conectarMs: Math.min(1500, tempoMs) });
  if (!r.ok || !r.corpo) return null;
  try { return capacidadesDoXml(r.corpo); } catch { return null; }
}

async function lerEstado(base, tempoMs = 3000) {
  const r = await httpGet(base + "ScannerStatus", { tempoMs });
  if (!r.ok) return null;
  try { return estadoDoXml(r.corpo); } catch { return null; }
}

// Portas vistas em aparelhos reais. NUNCA colocar 9100-9107 (impressao direta) nem 515 (LPD):
// qualquer byte mandado ali sai impresso.
const PORTAS = [
  { esquema: "http", porta: 8080 },  // HP
  { esquema: "http", porta: 80 },    // Canon, Brother, Xerox
  { esquema: "https", porta: 443 },  // quase todos (certificado proprio)
  { esquema: "http", porta: 631 },   // Ricoh
  { esquema: "http", porta: 9095 },  // Kyocera
  { esquema: "http", porta: 8090 },  // AirSane
];

// so com o IP: testa as portas e devolve { base, caps } do primeiro endereco eSCL que responder
async function acharEndereco(ip, rs) {
  if (!ip) return null;
  const portas = [...new Set(PORTAS.map((o) => o.porta))];
  const abertas = new Map(await Promise.all(portas.map(async (p) => [p, await portaAberta(ip, p)])));
  const candidatos = PORTAS.filter((o) => abertas.get(o.porta)).map((o) => montarBase(o.esquema, ip, o.porta, rs));
  if (abertas.get(443)) candidatos.push(montarBase("http", ip, 443, rs)); // Epson: http puro na 443
  const res = await Promise.all(candidatos.map(async (base) => ({ base, caps: await lerCapacidades(base) })));
  return res.find((x) => x.caps) || null;
}

/* ==================================== mDNS ==================================== */
const MDNS_IP = "224.0.0.251";
const MDNS_PORTA = 5353;
const T = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 };

function codificarNome(nome) {
  const rotulos = Array.isArray(nome) ? nome : String(nome).replace(/\.$/, "").split(".");
  const partes = [];
  for (const l of rotulos) {
    const b = Buffer.from(l, "utf8");
    if (b.length < 1 || b.length > 63) throw new Error("rotulo DNS invalido");
    partes.push(Buffer.from([b.length]), b);
  }
  partes.push(Buffer.from([0]));
  return Buffer.concat(partes);
}

// cabecalho DNS + perguntas, ID 0 e flags 0 (RFC 6762 18.1-18.6)
function montarPergunta(perguntas) {
  const cab = Buffer.alloc(12);
  cab.writeUInt16BE(perguntas.length, 4);
  const corpo = perguntas.map(({ nome, tipo }) => {
    const fim = Buffer.alloc(4);
    fim.writeUInt16BE(tipo, 0);
    fim.writeUInt16BE(1, 2); // classe IN
    return Buffer.concat([codificarNome(nome), fim]);
  });
  return Buffer.concat([cab, ...corpo]);
}

function lerNome(buf, off) {
  const rotulos = [];
  let prox = -1, saltos = 0;
  for (;;) {
    if (off >= buf.length) throw new Error("nome fora do pacote");
    const len = buf[off];
    if (len === 0) { if (prox < 0) prox = off + 1; break; }
    if ((len & 0xc0) === 0xc0) { // ponteiro de compressao
      if (off + 1 >= buf.length) throw new Error("ponteiro fora do pacote");
      if (prox < 0) prox = off + 2;
      if (++saltos > 64) throw new Error("ponteiro em loop");
      off = ((len & 0x3f) << 8) | buf[off + 1];
      continue;
    }
    if (len & 0xc0) throw new Error("rotulo invalido");
    if (off + 1 + len > buf.length) throw new Error("rotulo fora do pacote");
    rotulos.push(buf.toString("utf8", off + 1, off + 1 + len));
    off += 1 + len;
  }
  return { rotulos, prox };
}

function lerTxt(buf, off, len) {
  const fim = off + len, mapa = {};
  while (off < fim) {
    const l = buf[off];
    const s = buf.toString("utf8", off + 1, Math.min(fim, off + 1 + l));
    off += 1 + l;
    if (!s || s[0] === "=") continue;
    const eq = s.indexOf("=");
    const chave = (eq < 0 ? s : s.slice(0, eq)).toLowerCase(); // chaves sem diferenciar maiusculas
    if (!(chave in mapa)) mapa[chave] = eq < 0 ? true : s.slice(eq + 1); // vale a primeira
  }
  return mapa;
}

function lerPacote(buf) {
  if (buf.length < 12) throw new Error("pacote curto");
  const flags = buf.readUInt16BE(2);
  const n = [4, 6, 8, 10].map((o) => buf.readUInt16BE(o));
  let off = 12;
  for (let i = 0; i < n[0]; i++) off = lerNome(buf, off).prox + 4;
  const registros = [];
  const total = n[1] + n[2] + n[3];
  for (let i = 0; i < total; i++) {
    const nm = lerNome(buf, off);
    off = nm.prox;
    if (off + 10 > buf.length) throw new Error("registro fora do pacote");
    const tipo = buf.readUInt16BE(off), tam = buf.readUInt16BE(off + 8), rd = off + 10;
    if (rd + tam > buf.length) throw new Error("dados fora do pacote");
    const r = { rotulos: nm.rotulos, tipo, dado: null };
    if (tipo === T.PTR) r.dado = lerNome(buf, rd).rotulos;
    else if (tipo === T.SRV) r.dado = { porta: buf.readUInt16BE(rd + 4), alvo: lerNome(buf, rd + 6).rotulos };
    else if (tipo === T.TXT) r.dado = lerTxt(buf, rd, tam);
    else if (tipo === T.A && tam === 4) r.dado = `${buf[rd]}.${buf[rd + 1]}.${buf[rd + 2]}.${buf[rd + 3]}`;
    registros.push(r);
    off = rd + tam;
  }
  return { resposta: !!(flags & 0x8000), registros };
}

const chave = (rotulos) => rotulos.map((l) => l.toLowerCase()).join(".");
const ipNum = (ip) => ip.split(".").reduce((a, o) => ((a << 8) | (+o & 255)) >>> 0, 0);
const mesmaRede = (ip, ifc) => net.isIPv4(ip) && ((ipNum(ip) & ipNum(ifc.netmask)) >>> 0) === ((ipNum(ifc.address) & ipNum(ifc.netmask)) >>> 0);

function interfacesIPv4() {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const a of lista || []) {
      const fam = typeof a.family === "string" ? a.family : a.family === 4 ? "IPv4" : "IPv6";
      if (fam === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) out.push({ address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

// junta PTR + SRV + TXT + A de todas as respostas: um item por aparelho (pelo uuid)
function montarAparelhos(registros, servicos) {
  const aparelhos = new Map();
  for (const sv of servicos) {
    const sk = chave(String(sv).replace(/\.$/, "").split("."));
    const tls = sk.startsWith("_uscans.");
    for (const ptr of registros.filter((r) => r.tipo === T.PTR && chave(r.rotulos) === sk && r.dado)) {
      const inst = ptr.dado, ik = chave(inst);
      const srv = registros.find((r) => r.tipo === T.SRV && chave(r.rotulos) === ik && r.dado);
      const txt = (registros.find((r) => r.tipo === T.TXT && chave(r.rotulos) === ik && r.dado) || {}).dado || {};
      const ak = srv ? chave(srv.dado.alvo) : null;
      const as = ak ? registros.filter((r) => r.tipo === T.A && chave(r.rotulos) === ak && r.dado) : [];
      const a = as.find((r) => r.ifc && mesmaRede(r.dado, r.ifc)) || as[0];
      const ip = a ? a.dado : ptr.de;
      const id = (typeof txt.uuid === "string" && txt.uuid.toLowerCase()) || ik.replace(/\._uscans?\./, ".");
      const ap = aparelhos.get(id) || { nome: inst[0], modelo: null, uuid: typeof txt.uuid === "string" ? txt.uuid : null, enderecos: [] };
      ap.modelo = ap.modelo || (typeof txt.ty === "string" ? txt.ty : null);
      let base = srv && ip ? montarBase(tls ? "https" : "http", ip, srv.dado.porta, txt.rs) : null;
      if (base && portaProibida(base)) base = null;
      if (!ap.enderecos.some((e) => e.base === base && e.ip === ip)) {
        ap.enderecos.push({ tls, ip, porta: srv ? srv.dado.porta : null, base, alvo: srv ? srv.dado.alvo : null, instancia: inst, txt });
      }
      aparelhos.set(id, ap);
    }
  }
  // http antes de https (certificado proprio da impressora as vezes nem negocia)
  for (const ap of aparelhos.values()) ap.enderecos.sort((x, y) => Number(x.tls) - Number(y.tls));
  return [...aparelhos.values()];
}

// Pergunta mDNS "de uma vez" (RFC 6762 5.1): sai de porta qualquer e o aparelho responde direto
// pra ela. O firewall do Windows aceita essas respostas por ~3 s, sem regra nova.
async function procurarNaRede({ tempoMs = 1500, complementoMs = 800 } = {}) {
  const servicos = ["_uscan._tcp.local", "_uscans._tcp.local"];
  const registros = [], socks = [];
  await Promise.all(interfacesIPv4().map((ifc) => new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4" });
    sock.on("error", () => { try { sock.close(); } catch {} resolve(); });
    sock.on("message", (msg, rinfo) => {
      if (!mesmaRede(rinfo.address, ifc)) return; // so respostas da propria rede local
      try {
        const p = lerPacote(msg);
        if (p.resposta) for (const r of p.registros) registros.push(Object.assign(r, { de: rinfo.address, ifc }));
      } catch { /* pacote estranho: ignora */ }
    });
    sock.bind(0, ifc.address, () => {
      try { sock.setMulticastInterface(ifc.address); sock.setMulticastTTL(255); } catch {}
      socks.push(sock);
      const perguntar = () => {
        for (const sv of servicos) { try { sock.send(montarPergunta([{ nome: sv, tipo: T.PTR }]), MDNS_PORTA, MDNS_IP, () => {}); } catch {} }
      };
      perguntar();
      setTimeout(perguntar, 400); // repete uma vez (Wi-Fi perde pacote)
      resolve();
    });
  })));
  await esperar(tempoMs);
  let achados = montarAparelhos(registros, servicos);
  // se a resposta veio sem SRV/TXT/A, pergunta por eles
  const faltam = [];
  for (const ap of achados) for (const e of ap.enderecos) {
    if (e.porta == null || !Object.keys(e.txt).length) faltam.push({ nome: e.instancia, tipo: T.SRV }, { nome: e.instancia, tipo: T.TXT });
    else if (!e.base && e.alvo) faltam.push({ nome: e.alvo, tipo: T.A });
  }
  if (faltam.length && socks.length) {
    for (const s of socks) for (const q of faltam) { try { s.send(montarPergunta([q]), MDNS_PORTA, MDNS_IP, () => {}); } catch {} }
    await esperar(complementoMs);
    achados = montarAparelhos(registros, servicos);
  }
  for (const s of socks) { try { s.close(); } catch {} }
  return achados;
}

module.exports = {
  procurarNaRede, acharEndereco, lerCapacidades, lerEstado, portaProibida,
  capacidadesDoXml, estadoDoXml, lerXml, httpGet, portaAberta, montarBase, normRs,
  montarPergunta, lerPacote, montarAparelhos, PORTAS,
};
