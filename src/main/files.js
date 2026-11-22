"use strict";
// Montagem de nomes de arquivo e da estrutura de pastas
//   Digitalizado\Letra X\Nome do Associado\<TIPO>.pdf
const fs = require("fs");
const path = require("path");

const PREPOSICOES = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "DI", "DU"]);
const INVALIDOS = /[<>:"/\\|?*\x00-\x1f]/g; // proibidos em nome de arquivo no Windows

function tiraAcentos(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function limpaPasta(s) {
  // mantem espacos e acentos (pasta pode ter), so tira o que o Windows proibe
  return s.replace(INVALIDOS, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
}

function tituloCase(s) {
  return s.toLowerCase().replace(/(^|\s|')\p{L}/gu, (c) => c.toUpperCase());
}

function formataNomeAssociado(nome, cfg) {
  let n = (nome || "").trim();
  if (cfg.removerAcentosPasta) n = tiraAcentos(n);
  if (cfg.formatoNomeAssociado === "maiusculo") n = n.toUpperCase();
  else if (cfg.formatoNomeAssociado === "titulo") n = tituloCase(n);
  return limpaPasta(n);
}

function primeiraLetra(nome) {
  const semAcento = tiraAcentos((nome || "").trim());
  const m = semAcento.match(/\p{L}/u);
  return m ? m[0].toUpperCase() : "#";
}

// ---- seguir o padrao das pastas que ja existem ----
// Ex.: a pasta dos documentos ja tem "Digitalizados A", "Digitalizados B"... -> a letra E vira
// "Digitalizados E" (e nao "Letra E"). Espacos NAO contam na comparacao (pode ser erro de
// digitacao): "DigitalizadosC" e "Digitalizados  D" sao reconhecidas como as pastas do C e do D.
const chaveNome = (s) => tiraAcentos(String(s)).replace(/\s+/g, "").toLowerCase();

function subpastas(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return []; }
}

const _cachePadrao = new Map(); // base -> { em, padrao, dirs }
// padrao das pastas de letra: { chave, grafia } (grafia = como escrever o comeco, ex.: "Digitalizados ")
function padraoPastasLetra(base) {
  const c = _cachePadrao.get(base);
  if (c && Date.now() - c.em < 3000) return c;
  const dirs = subpastas(base);
  const grupos = new Map(); // chave do comeco -> { n, comEspaco, grafias: Map }
  for (const nome of dirs) {
    const m = nome.match(/^(.*?)(\s*)([A-Za-z])\s*$/); // termina numa letra
    if (!m || m[3] !== m[3].toUpperCase()) continue;   // a letra do padrao e maiuscula
    const [, comeco, sep] = m;
    if (comeco && !sep && /[A-Z]$/.test(comeco)) continue; // "DOSSIES ANTIGOS": a letra final faz parte da palavra
    const chave = chaveNome(comeco);
    const g = grupos.get(chave) || { n: 0, comEspaco: false, grafias: new Map() };
    g.n++; if (sep || !comeco) g.comEspaco = true;
    const grafia = comeco + sep;
    g.grafias.set(grafia, (g.grafias.get(grafia) || 0) + 1);
    grupos.set(chave, g);
  }
  let padrao = null;
  for (const [chave, g] of grupos) {
    if (g.n < 2 && !g.comEspaco) continue; // 1 pasta so, colada na letra: pode ser outra coisa
    if (!padrao || g.n > padrao.n) {
      // a grafia mais comum (com espaco, se empatar): "Digitalizados "
      const grafia = [...g.grafias.entries()].sort((a, b) => b[1] - a[1] || (/\s$/.test(b[0]) ? 1 : 0) - (/\s$/.test(a[0]) ? 1 : 0))[0][0];
      padrao = { chave, grafia, n: g.n };
    }
  }
  const r = { em: Date.now(), padrao, dirs };
  _cachePadrao.set(base, r);
  return r;
}

// nome da pasta da letra: a que ja existe (no padrao, ou no formato da config) ou uma nova no padrao
function nomePastaLetra(cfg, letra) {
  const { padrao, dirs } = padraoPastasLetra(cfg.pastaSaida);
  const doFormato = limpaPasta(cfg.formatoPastaLetra.replace("{letra}", letra));
  const procurados = [];
  if (padrao) procurados.push(padrao.chave + letra.toLowerCase());
  procurados.push(chaveNome(doFormato));
  for (const alvo of procurados) {
    const achou = dirs.find((d) => chaveNome(d) === alvo);
    if (achou) return achou; // usa a pasta que ja existe, do jeito que esta escrita
  }
  return padrao ? limpaPasta(padrao.grafia + letra) : doFormato;
}

// pasta do associado dentro da letra: reaproveita uma que ja existe com o mesmo nome escrito
// diferente (maiusculas, acentos ou espacos), pra nao criar pasta duplicada
function nomePastaPessoa(dirLetra, nomeFmt) {
  const alvo = chaveNome(nomeFmt);
  return subpastas(dirLetra).find((d) => chaveNome(d) === alvo) || nomeFmt;
}

// pasta final do associado (cria se preciso quando criar=true)
function pastaAssociado(cfg, nome, criar = false) {
  const letra = primeiraLetra(nome);
  const dirLetra = path.join(cfg.pastaSaida, nomePastaLetra(cfg, letra));
  const nomeFmt = formataNomeAssociado(nome, cfg) || "SEM NOME";
  const destino = path.join(dirLetra, nomePastaPessoa(dirLetra, nomeFmt));
  if (criar) {
    fs.mkdirSync(destino, { recursive: true });
    _cachePadrao.delete(cfg.pastaSaida); // pode ter criado uma pasta de letra nova
  }
  return destino;
}

// ----- nome do arquivo (com limite de 40 caracteres) -----
// separador das palavras no nome do arquivo: espaco ("TERMO DE COMPROMISSO.pdf", como a equipe
// ja escreve) ou _ ("TERMO_DE_COMPROMISSO.pdf", o jeito antigo do DigiDoc)
const separador = (cfg) => (cfg && cfg.espacoNoNomeArquivo === false ? "_" : " ");
function sanitizaBase(s, cfg) {
  let v = s;
  if (cfg.removerAcentosArquivo) v = tiraAcentos(v);
  const sep = separador(cfg);
  v = v.replace(INVALIDOS, "_").replace(/[\s_]+/g, sep).trim().replace(/^_+|_+$/g, "");
  if (cfg.maiusculasNomeArquivo) v = v.toUpperCase();
  return v;
}

function abrevia(nomeAssociado, limite, sep = "_") {
  // tenta encurtar o nome do associado mantendo primeiro e ultimo e inicial dos meios
  let partes = nomeAssociado.split(/[ _]+/).filter((p) => p && !PREPOSICOES.has(p.toUpperCase()));
  if (partes.length >= 3) {
    partes = [partes[0], ...partes.slice(1, -1).map((p) => p[0]), partes[partes.length - 1]];
  }
  let v = partes.join(sep);
  if (v.length > limite && partes.length >= 2) v = partes[0] + sep + partes[partes.length - 1];
  if (v.length > limite) v = v.slice(0, Math.max(1, limite)).replace(/[ _]+$/, "");
  return v;
}

// Monta "NOME_TIPO.pdf" respeitando o limite.
// incluirNome=false gera so "TIPO.pdf" (uso tipico: salvar dentro da pasta do associado).
function montaNomeArquivo(cfg, { nomeAssociado, tipoSigla, sufixo = "", incluirNome = false }) {
  const ext = ".pdf";
  const limite = cfg.maxCaracteresNome;
  const descontoExt = cfg.extensaoContaNoLimite ? ext.length : 0;
  let tipo = sanitizaBase(cfg.formatoNomeArquivo.replace("{tipo}", tipoSigla || "DOC"), cfg) + (sufixo || "");

  if (!incluirNome) {
    let base = tipo.slice(0, Math.max(1, limite - descontoExt)).trim();
    return base + ext;
  }
  const sep = separador(cfg);
  const nome = sanitizaBase(nomeAssociado || "SEM NOME", cfg);
  const espaco = limite - descontoExt - tipo.length - 1; // 1 pro separador
  const nomeCurto = nome.length > espaco ? abrevia(nome, Math.max(1, espaco), sep) : nome;
  return `${nomeCurto}${sep}${tipo}`.slice(0, Math.max(1, limite - descontoExt)).trim() + ext;
}

// resolve conflito de nome conforme a config; retorna caminho final a usar, ou null se "perguntar"
function resolveDestino(destinoDir, nomeArquivo, modo) {
  const cheio = path.join(destinoDir, nomeArquivo);
  if (!fs.existsSync(cheio)) return { caminho: cheio, nome: nomeArquivo, existia: false };
  if (modo === "substituir") return { caminho: cheio, nome: nomeArquivo, existia: true };
  if (modo === "perguntar") return { caminho: cheio, nome: nomeArquivo, existia: true, perguntar: true };
  // numerar
  const ext = path.extname(nomeArquivo);
  const base = nomeArquivo.slice(0, -ext.length);
  for (let i = 2; i < 999; i++) {
    const tent = `${base}_${i}${ext}`;
    if (!fs.existsSync(path.join(destinoDir, tent))) {
      return { caminho: path.join(destinoDir, tent), nome: tent, existia: true, renomeado: true };
    }
  }
  return { caminho: cheio, nome: nomeArquivo, existia: true };
}

// lista nomes de associados ja existentes (pra autocompletar)
function listaAssociados(cfg) {
  const nomes = new Set();
  try {
    for (const letra of fs.readdirSync(cfg.pastaSaida, { withFileTypes: true })) {
      if (!letra.isDirectory()) continue;
      const dirLetra = path.join(cfg.pastaSaida, letra.name);
      for (const a of fs.readdirSync(dirLetra, { withFileTypes: true })) {
        if (a.isDirectory()) nomes.add(a.name);
      }
    }
  } catch {}
  return [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// lista PDFs ja salvos na pasta de um associado (pra marcar o que ja foi feito)
function docsDoAssociado(cfg, nome) {
  try {
    return fs.readdirSync(pastaAssociado(cfg, nome, false))
      .filter((f) => f.toLowerCase().endsWith(".pdf"));
  } catch {
    return [];
  }
}

module.exports = {
  tiraAcentos, formataNomeAssociado, primeiraLetra, pastaAssociado,
  montaNomeArquivo, resolveDestino, listaAssociados, docsDoAssociado, sanitizaBase,
};
