"use strict";
// Lista de conferencia: registro de quais associados tiveram os documentos digitalizados.
// SO o nome do associado (exatamente como esta escrito) e a data — nenhum documento vai pra ca.
// Fica numa pasta escolhida pela pessoa (pode ser uma pasta do OneDrive/Google Drive: ai vai pra
// nuvem, privada, pela sincronizacao do proprio servico). O DigiDoc nunca envia isso pra internet.
//
//   DigiDoc - Lista de conferencia.txt          -> a lista pra ler/imprimir, por LETRA (A-Z)
//   DigiDoc - Lista de conferencia.xlsx         -> a mesma lista em planilha (Excel), por letra
//   DigiDoc - Lista de conferencia (dados).json -> os mesmos nomes, pro DigiDoc atualizar a lista
// A lista se atualiza sozinha: ao salvar no DigiDoc e quando aparece pasta de associado nova
// na pasta principal (mesmo criada a mao).
const fs = require("fs");
const path = require("path");
const planilha = require("./planilha");

const NOME_TXT = "DigiDoc - Lista de conferencia.txt";
const NOME_XLSX = "DigiDoc - Lista de conferencia.xlsx";
const NOME_DADOS = "DigiDoc - Lista de conferencia (dados).json";
const FORMATO = 3; // muda quando o jeito de escrever a lista muda (ai reescreve a lista uma vez)
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const doisDig = (n) => String(n).padStart(2, "0");
const dataLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`; };
const horaLocal = (ms) => { const d = new Date(ms); return `${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`; };
const dataBR = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; };
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
// o nome e guardado/mostrado como esta escrito. So pra saber se e a MESMA pessoa ignora acento,
// maiuscula, pontuacao e a ordem das palavras ("1234 - Maria" = "Maria 1234")
const chave = (s) => semAcento(s).toUpperCase()
  .replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
const nomeLiteral = (s) => String(s || "").trim();
// letra da lista = primeira letra do nome (como a pasta da letra do DigiDoc)
const letraDe = (nome) => (semAcento(nome).toUpperCase().match(/[A-Z]/) || ["#"])[0];
const ordemNome = (a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });

function ler(pasta) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(pasta, NOME_DADOS), "utf8"));
    const itens = Array.isArray(d.itens) ? d.itens : [];
    // versao 0.6.0 separava um "codigo" do nome: junta de volta (o nome fica inteiro de novo)
    for (const it of itens) if (it.codigo) { it.nome = `${it.nome} ${it.codigo}`; delete it.codigo; }
    return { versao: 2, formato: d.formato || 0, planilhaPendente: !!d.planilhaPendente, itens };
  } catch { return { versao: 2, formato: 0, planilhaPendente: false, itens: [] }; }
}

// grava num temporario e troca (pasta de nuvem as vezes segura o arquivo: tenta de novo)
function gravarArquivo(arq, conteudo, tentativas = 8) {
  const tmp = arq + ".salvando";
  fs.writeFileSync(tmp, conteudo);
  for (let i = 1; ; i++) {
    try { fs.renameSync(tmp, arq); return; }
    catch (e) {
      if (i >= tentativas) {
        try { fs.writeFileSync(arq, conteudo); fs.rmSync(tmp, { force: true }); return; }
        catch { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
      }
      const ate = Date.now() + 200; while (Date.now() < ate) { /* espera curta */ }
    }
  }
}

// primeira passagem de cada associado (uma linha por pessoa na lista)
function primeiras(itens) {
  const m = new Map();
  for (const it of itens) {
    const k = chave(it.nome), v = m.get(k);
    if (!v) m.set(k, Object.assign({}, it, { vezes: 1 }));
    else {
      v.vezes++;
      if (it.data + it.hora < v.data + v.hora) Object.assign(v, it, { vezes: v.vezes });
    }
  }
  return m;
}
// associados por letra, em ordem alfabetica: [[letra, [itens]]]
function porLetra(itens) {
  const g = new Map();
  for (const it of primeiras(itens).values()) {
    const l = letraDe(it.nome);
    if (!g.has(l)) g.set(l, []);
    g.get(l).push(it);
  }
  for (const lista of g.values()) lista.sort((a, b) => ordemNome(a.nome, b.nome));
  return [...g.entries()].sort((a, b) => (a[0] === "#") - (b[0] === "#") || a[0].localeCompare(b[0]));
}

function gerarTxt(dados) {
  const grupos = porLetra(dados.itens);
  const total = grupos.reduce((n, [, l]) => n + l.length, 0);
  const L = [];
  const linha = "=".repeat(72), fina = "-".repeat(72);
  const agora = Date.now();
  L.push(linha, " LISTA DE CONFERÊNCIA — DigiDoc", " Associados cujos documentos passaram pela digitalização.",
    " Só nomes: nenhum documento fica neste arquivo.", linha,
    ` Atualizada em: ${dataBR(dataLocal(agora))} ${horaLocal(agora)}`,
    ` Total: ${total.toLocaleString("pt-BR")} associado(s)`);
  if (grupos.length) {
    // "A: 60   B: 10   C: 71 ..." (quebra a linha a cada 8 letras)
    const resumo = grupos.map(([l, lista]) => `${l}: ${lista.length}`);
    for (let i = 0; i < resumo.length; i += 8) L.push(` ${i ? "       " : "Letras:"} ${resumo.slice(i, i + 8).join("   ")}`);
  }
  L.push("", " Em ordem alfabética, letra por letra. Do lado do nome: o dia em que passou", " pela digitalização (o dia em que a pasta dele foi criada).");
  for (const [letra, lista] of grupos) {
    L.push("", fina, ` [ ${letra} ]   ${lista.length} associado(s)`, fina);
    for (const it of lista) {
      const txt = ` ${it.nome} `;
      L.push(txt + ".".repeat(Math.max(3, 60 - txt.length)) + " " + dataBR(it.data));
    }
  }
  // no fim, so a contagem por dia (quantos passaram pela primeira vez em cada dia)
  const doDia = new Map();
  for (const [, lista] of grupos) for (const it of lista) doDia.set(it.data, (doDia.get(it.data) || 0) + 1);
  if (doDia.size) {
    L.push("", "", linha, " POR DIA  (quantos associados passaram pela primeira vez)", linha);
    for (const [d, n] of [...doDia.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      L.push(` ${dataBR(d)}  ${DIAS[new Date(d + "T12:00:00").getDay()].padEnd(13)} ${String(n).padStart(5)} associado(s)`);
    }
  }
  L.push("");
  return "﻿" + L.join("\r\n"); // BOM: o Bloco de Notas e o Excel abrem com acento certo
}

function gerarPlanilha(dados) {
  const linhas = [];
  for (const [letra, lista] of porLetra(dados.itens)) {
    for (const it of lista) linhas.push([letra, it.nome, it.data, it.hora, it.origem === "importado" ? "pasta já existente" : "salvo no DigiDoc"]);
  }
  return planilha.gerarXlsx({
    aba: "Lista de conferência",
    colunas: [
      { titulo: "Letra", largura: 7 }, { titulo: "Associado", largura: 52 },
      { titulo: "Data", largura: 12, tipo: "data" }, { titulo: "Hora", largura: 7 }, { titulo: "Como entrou", largura: 20 },
    ],
    linhas,
  });
}

function salvar(pasta, dados) {
  fs.mkdirSync(pasta, { recursive: true });
  dados.formato = FORMATO;
  // a planilha aberta no Excel fica travada: nao impede o resto, tenta de novo na proxima vez
  let planilhaOk = true;
  try { gravarArquivo(path.join(pasta, NOME_XLSX), gerarPlanilha(dados), 3); } catch { planilhaOk = false; }
  dados.planilhaPendente = !planilhaOk;
  gravarArquivo(path.join(pasta, NOME_DADOS), JSON.stringify(dados));
  gravarArquivo(path.join(pasta, NOME_TXT), gerarTxt(dados));
  return planilhaOk;
}

// anota um associado salvo agora (nome como esta escrito). Mesmo associado no mesmo dia: so atualiza a hora
function registrar(pasta, nomeBruto, quandoMs = Date.now()) {
  const nome = nomeLiteral(nomeBruto);
  if (!nome) return null;
  const dados = ler(pasta);
  const data = dataLocal(quandoMs), hora = horaLocal(quandoMs), k = chave(nome);
  const mesmo = dados.itens.find((i) => i.data === data && chave(i.nome) === k);
  if (mesmo) { mesmo.hora = hora; mesmo.origem = "digitalizado"; mesmo.nome = nome; }
  else dados.itens.push({ nome, data, hora, origem: "digitalizado" });
  salvar(pasta, dados);
  return { nome, data, hora };
}

// ---- pastas ja digitalizadas ----
// cada pasta pode ser: a pasta de UMA letra ("Digitalizados A": as subpastas sao os associados)
// ou a pasta principal (as subpastas sao letras: entra em cada uma)
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
// as pastas de associado (so os nomes, sem abrir nada): [{ nome, dir }]
function pastasDeAssociado(caminhos) {
  const out = [];
  const daLetra = (dirLetra) => {
    for (const n of subpastas(dirLetra)) {
      if (/^\./.test(n)) continue;
      const nome = nomeLiteral(n); // o nome da pasta, como esta
      if (nome) out.push({ nome, dir: path.join(dirLetra, n) });
    }
  };
  for (const c of caminhos || []) {
    if (!c) continue;
    const subs = subpastas(c);
    const letras = subs.filter(pareceLetra);
    // a maioria das subpastas sao letras: e a pasta principal
    if (letras.length >= 2 && letras.length >= subs.length * 0.6) for (const l of letras) daLetra(path.join(c, l));
    else daLetra(c);
  }
  return out;
}
function escanear(caminhos) {
  const achados = [];
  for (const { nome, dir } of pastasDeAssociado(caminhos)) {
    const ms = dataDaPasta(dir);
    if (ms) achados.push({ nome, data: dataLocal(ms), hora: horaLocal(ms), pasta: dir });
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

// deixa a lista igual as pastas: associado novo (pasta criada no DigiDoc ou a mao) entra; o nome
// fica escrito igual ao da pasta. So grava se mudou alguma coisa (nao fica reescrevendo a toa).
// Associado que nao tem mais pasta continua na lista (ele passou pela digitalizacao).
function sincronizar(pasta, raiz) {
  const dados = ler(pasta);
  const naLista = new Map(); // chave -> itens
  for (const it of dados.itens) { const k = chave(it.nome); if (!naLista.has(k)) naLista.set(k, []); naLista.get(k).push(it); }
  const daPasta = new Map(); // chave -> { nome, dir } (a primeira pasta com esse nome)
  for (const p of pastasDeAssociado([raiz])) { const k = chave(p.nome); if (k && !daPasta.has(k)) daPasta.set(k, p); }
  let mudou = dados.formato !== FORMATO || dados.planilhaPendente, novos = 0;
  for (const [k, p] of daPasta) {
    const ja = naLista.get(k);
    if (ja) {
      for (const it of ja) if (it.nome !== p.nome) { it.nome = p.nome; mudou = true; }
      continue;
    }
    const ms = dataDaPasta(p.dir);
    if (!ms) continue;
    dados.itens.push({ nome: p.nome, data: dataLocal(ms), hora: horaLocal(ms), origem: "importado" });
    novos++; mudou = true;
  }
  if (!fs.existsSync(path.join(pasta, NOME_TXT)) || !fs.existsSync(path.join(pasta, NOME_XLSX))) mudou = true;
  if (mudou) salvar(pasta, dados);
  return { novos, mudou, total: primeiras(dados.itens).size };
}

function resumo(pasta) {
  const dados = ler(pasta);
  return { pasta, txt: path.join(pasta, NOME_TXT), xlsx: path.join(pasta, NOME_XLSX), existe: fs.existsSync(path.join(pasta, NOME_TXT)), total: primeiras(dados.itens).size, registros: dados.itens.length };
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

module.exports = { registrar, escanear, importar, sincronizar, resumo, nuvens, NOME_TXT, NOME_XLSX, NOME_DADOS, _gerarTxt: gerarTxt, _gerarPlanilha: gerarPlanilha };
