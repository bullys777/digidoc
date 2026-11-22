"use strict";
// Painel de producao: conta direto na pasta dos documentos (Digitalizado\Letra X\Pessoa\*.pdf).
// Assim os numeros valem pra TUDO que ja foi feito (ate antes desta versao, ou por outro PC
// salvando na mesma pasta de rede) e nunca ficam diferentes do que esta no disco.
// A data de cada PDF e a da ultima gravacao do arquivo.
const fs = require("fs");
const path = require("path");
const files = require("./files");

let cache = null;      // ultimo resultado
let calculando = null; // promessa do calculo em andamento (nao roda dois ao mesmo tempo)

const diaLocal = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nomesDoc = require("../shared/nomesdoc");
// "RG_2.pdf" -> "RG", "COMP. ENDEREÇO.pdf" -> "COMP_ENDERECO" (sem acento, espaco/ponto viram _)
const siglaDoArquivo = (f) => nomesDoc.chaveArquivo(f);
// a sigla do tipo do mesmo jeito — pra comparar com o arquivo
const siglaArquivo = (s) => nomesDoc.chave(s);

async function lerDir(d) {
  try { return await fs.promises.readdir(d, { withFileTypes: true }); } catch { return []; }
}

// roda fn em lotes pra nao abrir milhares de arquivos ao mesmo tempo (pasta de rede agradece)
async function emLotes(itens, n, fn) {
  const out = [];
  for (let i = 0; i < itens.length; i += n) out.push(...(await Promise.all(itens.slice(i, i + n).map(fn))));
  return out;
}

async function varrer(pastaSaida) {
  const pessoas = [];
  for (const l of await lerDir(pastaSaida)) {
    if (!l.isDirectory()) continue;
    const dirLetra = path.join(pastaSaida, l.name);
    const dirs = (await lerDir(dirLetra)).filter((a) => a.isDirectory());
    const lidas = await emLotes(dirs, 24, async (a) => {
      const dir = path.join(dirLetra, a.name);
      const pdfs = (await lerDir(dir)).filter((f) => f.isFile() && /\.pdf$/i.test(f.name));
      const docs = await emLotes(pdfs, 32, async (f) => {
        try { const st = await fs.promises.stat(path.join(dir, f.name)); return { nome: f.name, sigla: siglaDoArquivo(f.name), bytes: st.size, ms: st.mtimeMs }; }
        catch { return null; }
      });
      return { nome: a.name, letra: files.primeiraLetra(a.name), pasta: dir, docs: docs.filter(Boolean) };
    });
    pessoas.push(...lidas);
  }
  return pessoas;
}

async function calcular(cfg) {
  const inicio = Date.now();
  const pessoas = await varrer(cfg.pastaSaida);
  // cada PDF conta pro tipo que ele e, mesmo escrito de outro jeito ("COMP. ENDEREÇO" = ENDERECO,
  // "RG MARIA" = RG, "DOSSIE" = DOSSIE COMPLETO)
  const tiposConhecidos = [...(cfg.tipos || []), { sigla: cfg.siglaDossie || "DOSSIE COMPLETO" }];
  // d.tipo = o documento (pro grafico por tipo); d.sigla = o que conta pro associado — o documento de um
  // dependente ("NASC JOAO") aparece com o nome dele e nao conta como o do titular
  for (const p of pessoas) for (const d of p.docs) {
    const an = nomesDoc.analisar(d.nome, tiposConhecidos, p.nome);
    if (an.tipo) { d.tipo = siglaArquivo(an.tipo.sigla); d.sigla = an.doTitular ? d.tipo : `${d.tipo}_${nomesDoc.chave(an.complemento)}`; }
    // "2026-11-05 (1).pdf": arquivo que saiu do scanner e ninguem renomeou
    else if (/^\d{4}_\d{2}_\d{2}(_\d+)*$/.test(d.sigla)) d.tipo = d.sigla = "ARQUIVO_DO_SCANNER";
    else d.tipo = d.sigla;
  }
  const hoje = diaLocal(Date.now());
  const ontem = diaLocal(Date.now() - 864e5);
  const porLetra = {}, porTipo = {}, porDia = {};
  let totalPdfs = 0, totalBytes = 0, ultima = null;

  for (const p of pessoas) {
    const L = porLetra[p.letra] || (porLetra[p.letra] = { pessoas: 0, pdfs: 0, comDocs: 0 });
    L.pessoas++;
    if (p.docs.length) L.comDocs++;
    const diasDaPessoa = new Set();
    for (const d of p.docs) {
      totalPdfs++; totalBytes += d.bytes; L.pdfs++;
      porTipo[d.tipo || d.sigla] = (porTipo[d.tipo || d.sigla] || 0) + 1;
      const dia = diaLocal(d.ms);
      const D = porDia[dia] || (porDia[dia] = { pessoas: 0, pdfs: 0, bytes: 0 });
      D.pdfs++; D.bytes += d.bytes;
      diasDaPessoa.add(dia);
      if (!ultima || d.ms > ultima.ms) ultima = { ms: d.ms, nome: p.nome, letra: p.letra, arquivo: d.nome };
    }
    for (const dia of diasDaPessoa) porDia[dia].pessoas++;
    p.ultimo = p.docs.reduce((m, d) => Math.max(m, d.ms), 0);
    p.siglas = [...new Set(p.docs.map((d) => d.sigla))];
  }

  const dias = Object.keys(porDia).sort();
  let recorde = null;
  for (const dia of dias) if (!recorde || porDia[dia].pessoas > recorde.pessoas) recorde = { dia, pessoas: porDia[dia].pessoas, pdfs: porDia[dia].pdfs };
  const somaDias = (n) => {
    const r = { pessoas: 0, pdfs: 0 };
    for (let i = 0; i < n; i++) { const d = porDia[diaLocal(Date.now() - i * 864e5)]; if (d) { r.pessoas += d.pessoas; r.pdfs += d.pdfs; } }
    return r;
  };
  const comDocs = pessoas.filter((p) => p.docs.length).length;
  // quantas pessoas tem cada tipo configurado (cobertura / o que falta)
  const cobertura = (cfg.tipos || []).map((t) => {
    const s = siglaArquivo(t.sigla);
    return { sigla: s, nome: t.nome, tem: pessoas.filter((p) => p.siglas.includes(s)).length };
  });
  const dossie = siglaArquivo(cfg.siglaDossie || "DOSSIE COMPLETO");

  cache = {
    em: Date.now(), levouMs: Date.now() - inicio, pasta: cfg.pastaSaida,
    total: { pessoas: pessoas.length, comDocs, pdfs: totalPdfs, bytes: totalBytes, dias: dias.length },
    hoje: porDia[hoje] || { pessoas: 0, pdfs: 0, bytes: 0 },
    ontem: porDia[ontem] || { pessoas: 0, pdfs: 0, bytes: 0 },
    semana: somaDias(7), mes: somaDias(30),
    mediaPorDia: dias.length ? Math.round((dias.reduce((n, d) => n + porDia[d].pessoas, 0) / dias.length) * 10) / 10 : 0,
    recorde, ultima, porLetra, porTipo, porDia, cobertura,
    dossies: pessoas.filter((p) => p.siglas.includes(dossie)).length,
    // lista enxuta pra busca/pendencias na tela
    pessoas: pessoas.map((p) => ({ nome: p.nome, letra: p.letra, pasta: p.pasta, siglas: p.siglas, pdfs: p.docs.length, ultimo: p.ultimo }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  };
  return cache;
}

// calcula (ou devolve o que ja esta calculando). forcar=false aceita um resultado de ate 20 s atras
function obter(cfg, forcar = false) {
  if (!forcar && cache && cache.pasta === cfg.pastaSaida && Date.now() - cache.em < 20000) return Promise.resolve(cache);
  if (!calculando) calculando = calcular(cfg).finally(() => { calculando = null; });
  return calculando;
}

// so o resumo (pro rodape), sem a lista de pessoas
function resumo(e) {
  if (!e) return null;
  const { pessoas, porDia, ...resto } = e;
  return resto;
}

// relatorio pra abrir no Excel (separador ";" e BOM, como o Excel em portugues espera)
function csv(e) {
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const data = (ms) => (ms ? new Date(ms).toLocaleString("pt-BR") : "");
  const linhas = [["Letra", "Associado", "Documentos", "Qtd. de PDFs", "Último salvamento", "Pasta"].map(q).join(";")];
  for (const p of e.pessoas) linhas.push([p.letra, p.nome, p.siglas.join(", "), p.pdfs, data(p.ultimo), p.pasta].map(q).join(";"));
  linhas.push("");
  linhas.push([q("Produção por dia")].join(";"));
  linhas.push(["Dia", "Associados", "PDFs"].map(q).join(";"));
  for (const dia of Object.keys(e.porDia).sort().reverse()) {
    const [a, m, d] = dia.split("-");
    linhas.push([`${d}/${m}/${a}`, e.porDia[dia].pessoas, e.porDia[dia].pdfs].map(q).join(";"));
  }
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

function invalidar() { if (cache) cache.em = 0; }

module.exports = { obter, resumo, csv, invalidar, diaLocal };
