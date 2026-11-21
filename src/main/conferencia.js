"use strict";
// Lista de conferencia: registro de quais associados tiveram os documentos digitalizados.
// SO o nome do associado (exatamente como esta escrito) e a data — nenhum documento vai pra ca.
// Fica numa pasta escolhida pela pessoa (pode ser uma pasta do OneDrive/Google Drive: ai vai pra
// nuvem, privada, pela sincronizacao do proprio servico). O DigiDoc nunca envia isso pra internet.
//
//   DigiDoc - Lista de conferencia.txt          -> a lista pra ler/imprimir (por data + indice A-Z)
//   DigiDoc - Lista de conferencia (dados).json -> os mesmos nomes, pro DigiDoc atualizar a lista
const fs = require("fs");
const path = require("path");

const NOME_TXT = "DigiDoc - Lista de conferencia.txt";
const NOME_DADOS = "DigiDoc - Lista de conferencia (dados).json";
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const doisDig = (n) => String(n).padStart(2, "0");
const dataLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`; };
const horaLocal = (ms) => { const d = new Date(ms); return `${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`; };
const dataBR = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };
// o nome e guardado/mostrado como esta escrito. So pra saber se e a MESMA pessoa ignora acento,
// maiuscula, pontuacao e a ordem das palavras ("1234 - Maria" = "Maria 1234")
const chave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
const nomeLiteral = (s) => String(s || "").trim();

function ler(pasta) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(pasta, NOME_DADOS), "utf8"));
    const itens = Array.isArray(d.itens) ? d.itens : [];
    // versao 0.6.0 separava um "codigo" do nome: junta de volta (o nome fica inteiro de novo)
    for (const it of itens) if (it.codigo) { it.nome = `${it.nome} ${it.codigo}`; delete it.codigo; }
    return { versao: 2, itens };
  } catch { return { versao: 2, itens: [] }; }
}

// grava num temporario e troca (pasta de nuvem as vezes segura o arquivo: tenta de novo)
function gravarArquivo(arq, conteudo) {
  const tmp = arq + ".salvando";
  fs.writeFileSync(tmp, conteudo);
  for (let i = 1; ; i++) {
    try { fs.renameSync(tmp, arq); return; }
    catch (e) {
      if (i >= 8) { try { fs.writeFileSync(arq, conteudo); fs.rmSync(tmp, { force: true }); return; } catch { throw e; } }
      const ate = Date.now() + 200; while (Date.now() < ate) { /* espera curta */ }
    }
  }
}

// primeira passagem de cada associado (pro indice e pro total)
function primeiras(itens) {
  const m = new Map();
  for (const it of itens) {
    const k = chave(it.nome), v = m.get(k);
    if (!v || it.data + it.hora < v.data + v.hora) m.set(k, it);
  }
  return m;
}

function gerarTxt(dados) {
  const itens = dados.itens.slice().sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));
  const unicos = primeiras(dados.itens);
  const L = [];
  const linha = "=".repeat(72), fina = "-".repeat(72);
  const agora = Date.now();
  L.push(linha, " LISTA DE CONFERÊNCIA — DigiDoc", " Associados cujos documentos passaram pela digitalização.",
    " Só nomes: nenhum documento fica neste arquivo.", linha,
    ` Atualizada em: ${dataBR(dataLocal(agora))} ${horaLocal(agora)}`,
    ` Total: ${unicos.size.toLocaleString("pt-BR")} associado(s) · ${itens.length.toLocaleString("pt-BR")} registro(s)`, "");
  let diaAtual = "";
  const doDia = {};
  for (const it of itens) doDia[it.data] = (doDia[it.data] || 0) + 1;
  for (const it of itens) {
    if (it.data !== diaAtual) {
      diaAtual = it.data;
      const dia = DIAS[new Date(it.data + "T12:00:00").getDay()];
      L.push("", fina, ` ${dataBR(it.data)} — ${dia} — ${doDia[it.data]} associado(s)`, fina);
    }
    const marca = it.origem === "importado" ? "(importado)" : "";
    L.push(marca ? ` ${it.hora}  ${it.nome.padEnd(52)} ${marca}` : ` ${it.hora}  ${it.nome}`);
  }
  if (unicos.size) {
    L.push("", "", linha, " ÍNDICE A–Z  (data em que passou pela primeira vez)", linha);
    const az = [...unicos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    let letra = "";
    for (const it of az) {
      const l = (it.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().match(/[A-Z0-9]/) || ["#"])[0];
      if (l !== letra) { letra = l; L.push("", ` [ ${letra} ]`); }
      const txt = ` ${it.nome} `;
      L.push(txt + ".".repeat(Math.max(3, 60 - txt.length)) + " " + dataBR(it.data));
    }
  }
  L.push("");
  return "﻿" + L.join("\r\n"); // BOM: o Bloco de Notas e o Excel abrem com acento certo
}

function salvar(pasta, dados) {
  fs.mkdirSync(pasta, { recursive: true });
  gravarArquivo(path.join(pasta, NOME_DADOS), JSON.stringify(dados));
  gravarArquivo(path.join(pasta, NOME_TXT), gerarTxt(dados));
}

// anota um associado salvo agora (nome como foi digitado). Mesmo associado no mesmo dia: so atualiza a hora
function registrar(pasta, nomeBruto, quandoMs = Date.now()) {
  const nome = nomeLiteral(nomeBruto);
  if (!nome) return null;
  const dados = ler(pasta);
  const data = dataLocal(quandoMs), hora = horaLocal(quandoMs), k = chave(nome);
  const mesmo = dados.itens.find((i) => i.data === data && chave(i.nome) === k);
  if (mesmo) { mesmo.hora = hora; mesmo.origem = "digitalizado"; }
  else dados.itens.push({ nome, data, hora, origem: "digitalizado" });
  salvar(pasta, dados);
  return { nome, data, hora };
}

// ---- importar pastas ja digitalizadas ----
// cada pasta escolhida pode ser: a pasta de UMA letra ("Digitalizados A": as subpastas sao os
// associados) ou a pasta principal (as subpastas sao letras: entra em cada uma)
// pasta de letra: "A", "Letra B", "Digitalizados C" ou "DigitalizadosC" (sem espaco, erro de digitacao)
function pareceLetra(nome) {
  const n = String(nome).trim();
  return /^[A-Za-z#]$/.test(n) || /\s[A-Z#]$/.test(n) || /[a-z][A-Z]$/.test(n);
}
function subpastas(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
}
function dataDaPasta(dir) {
  try {
    const st = fs.statSync(dir);
    return st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs; // dia em que a pasta foi criada
  } catch { return 0; }
}
function escanear(caminhos) {
  const achados = [];
  const visitarLetra = (dirLetra) => {
    for (const n of subpastas(dirLetra)) {
      if (/^\./.test(n)) continue;
      const dir = path.join(dirLetra, n);
      const nome = nomeLiteral(n); // o nome da pasta, como esta
      const ms = dataDaPasta(dir);
      if (nome && ms) achados.push({ nome, data: dataLocal(ms), hora: horaLocal(ms), pasta: dir });
    }
  };
  for (const c of caminhos || []) {
    const subs = subpastas(c);
    const letras = subs.filter(pareceLetra);
    // a maioria das subpastas sao letras: e a pasta principal
    if (letras.length >= 2 && letras.length >= subs.length * 0.6) for (const l of letras) visitarLetra(path.join(c, l));
    else visitarLetra(c);
  }
  return achados.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}
// junta na lista o que ainda nao esta. O mesmo associado so entra de novo se a pasta mostrar uma data
// MAIS ANTIGA que tudo o que ja tem dele (foi a primeira passagem, que ainda nao estava anotada)
function importar(pasta, achados) {
  const dados = ler(pasta);
  const maisAntiga = new Map(); // associado -> data+hora mais antiga na lista
  for (const i of dados.itens) {
    const k = chave(i.nome), v = i.data + i.hora;
    if (!maisAntiga.has(k) || v < maisAntiga.get(k)) maisAntiga.set(k, v);
  }
  let novos = 0, jaTinha = 0;
  for (const a of achados || []) {
    const nome = nomeLiteral(a.nome), k = chave(nome);
    if (!nome || (maisAntiga.has(k) && maisAntiga.get(k).slice(0, 10) <= a.data)) { jaTinha++; continue; }
    maisAntiga.set(k, a.data + a.hora);
    dados.itens.push({ nome, data: a.data, hora: a.hora, origem: "importado" });
    novos++;
  }
  salvar(pasta, dados);
  return { novos, jaTinha, total: primeiras(dados.itens).size };
}

function resumo(pasta) {
  const dados = ler(pasta);
  return { pasta, txt: path.join(pasta, NOME_TXT), existe: fs.existsSync(path.join(pasta, NOME_TXT)), total: primeiras(dados.itens).size, registros: dados.itens.length };
}

// pastas de nuvem sincronizadas neste PC (os arquivos ficam privados na conta da pessoa)
function nuvens() {
  const out = [];
  const add = (nome, base) => { if (base && fs.existsSync(base) && !out.some((o) => o.base.toLowerCase() === base.toLowerCase())) out.push({ nome, base, pasta: path.join(base, "DigiDoc - Conferencia") }); };
  add("OneDrive", process.env.OneDriveCommercial);
  add("OneDrive", process.env.OneDriveConsumer || process.env.OneDrive);
  for (const l of "DEFGHIJKLMNOPQRSTUVWXYZ") for (const sub of ["Meu Drive", "My Drive"]) add("Google Drive", `${l}:\\${sub}`);
  add("Google Drive", path.join(process.env.USERPROFILE || "", "Google Drive"));
  add("Dropbox", path.join(process.env.USERPROFILE || "", "Dropbox"));
  return out;
}

module.exports = { registrar, escanear, importar, resumo, nuvens, NOME_TXT, _gerarTxt: gerarTxt };
