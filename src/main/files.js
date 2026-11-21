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

// pasta final do associado (cria se preciso quando criar=true)
function pastaAssociado(cfg, nome, criar = false) {
  const letra = primeiraLetra(nome);
  const pastaLetra = limpaPasta(cfg.formatoPastaLetra.replace("{letra}", letra));
  const nomeFmt = formataNomeAssociado(nome, cfg) || "SEM NOME";
  const destino = path.join(cfg.pastaSaida, pastaLetra, nomeFmt);
  if (criar) fs.mkdirSync(destino, { recursive: true });
  return destino;
}

// ----- nome do arquivo (com limite de 40 caracteres) -----
function sanitizaBase(s, cfg) {
  let v = s;
  if (cfg.removerAcentosArquivo) v = tiraAcentos(v);
  v = v.replace(INVALIDOS, "_").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (cfg.maiusculasNomeArquivo) v = v.toUpperCase();
  return v;
}

function abrevia(nomeAssociado, limite) {
  // tenta encurtar o nome do associado mantendo primeiro e ultimo e inicial dos meios
  let partes = nomeAssociado.split("_").filter((p) => p && !PREPOSICOES.has(p.toUpperCase()));
  if (partes.length >= 3) {
    partes = [partes[0], ...partes.slice(1, -1).map((p) => p[0]), partes[partes.length - 1]];
  }
  let v = partes.join("_");
  if (v.length > limite && partes.length >= 2) v = partes[0] + "_" + partes[partes.length - 1];
  if (v.length > limite) v = v.slice(0, Math.max(1, limite)).replace(/_+$/, "");
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
    let base = tipo.slice(0, Math.max(1, limite - descontoExt));
    return base + ext;
  }
  const nome = sanitizaBase(nomeAssociado || "SEM_NOME", cfg);
  const espaco = limite - descontoExt - tipo.length - 1; // 1 pro "_"
  const nomeCurto = nome.length > espaco ? abrevia(nome, Math.max(1, espaco)) : nome;
  return `${nomeCurto}_${tipo}`.slice(0, Math.max(1, limite - descontoExt)) + ext;
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
