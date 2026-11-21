"use strict";
// Reconhecer o tipo do documento (opcional): le o texto da pagina (Tesseract, portugues, offline)
// e pontua cada tipo por expressoes que so aparecem nele ("CARTEIRA DE IDENTIDADE", "CADASTRO DE
// PESSOAS FISICAS", "UNIDADE CONSUMIDORA"...). So marca quando a pontuacao e clara; senao deixa
// sem tipo. Aprende com as correcoes: palavras da pagina corrigida passam a contar pro tipo certo.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

let PATHS = { core: "", lang: "", aprendizado: "" };
function configurar(p) { PATHS = Object.assign(PATHS, p); }

// ---- regras por "familia" de documento: [expressao, peso] (texto ja sem acento e em maiusculas) ----
const EMPRESAS_CONTA = ["ENEL", "CEMIG", "COPEL", "LIGHT", "CPFL", "ELEKTRO", "EDP", "EQUATORIAL", "NEOENERGIA", "COELBA",
  "CELPE", "COSERN", "ENERGISA", "CELESC", "RGE", "SABESP", "CEDAE", "COPASA", "SANEPAR", "EMBASA", "CAGECE", "CORSAN",
  "COMPESA", "CASAN", "SANEAGO", "CAESB", "COMGAS", "NATURGY", "VIVO", "CLARO", "TIM", "OI FIBRA"];
const REGRAS = {
  rg: [["CARTEIRA DE IDENTIDADE", 6], ["REGISTRO GERAL", 6], ["IDENTIDADE NACIONAL", 5], ["INSTITUTO DE IDENTIFICACAO", 4],
    ["SEGURANCA PUBLICA", 3], ["FILIACAO", 3], ["NATURALIDADE", 3], ["DOC ORIGEM", 3], ["DOC. ORIGEM", 3],
    ["VALIDA EM TODO O TERRITORIO NACIONAL", 4], ["TERRITORIO NACIONAL", 2], ["LEI N 7.116", 4], ["7.116", 2],
    ["ASSINATURA DO DIRETOR", 3], ["DATA DE EXPEDICAO", 3], ["POLEGAR", 2], ["REPUBLICA FEDERATIVA DO BRASIL", 1]],
  cnh: [["CARTEIRA NACIONAL DE HABILITACAO", 8], ["HABILITACAO", 4], ["DEPARTAMENTO NACIONAL DE TRANSITO", 5], ["DETRAN", 3],
    ["SENATRAN", 4], ["DENATRAN", 4], ["CAT. HAB", 3], ["CAT HAB", 3], ["1A HABILITACAO", 3], ["PERMISSAO", 2], ["ACC", 1]],
  cpf: [["CADASTRO DE PESSOAS FISICAS", 8], ["CADASTRO DE PESSOA FISICA", 8], ["COMPROVANTE DE INSCRICAO", 3],
    ["SITUACAO CADASTRAL", 4], ["RECEITA FEDERAL", 3], ["MINISTERIO DA FAZENDA", 3], ["NUMERO DE INSCRICAO", 2]],
  residencia: [["CONTA DE ENERGIA", 6], ["ENERGIA ELETRICA", 5], ["UNIDADE CONSUMIDORA", 5], ["KWH", 4], ["CONSUMO", 2],
    ["LEITURA", 2], ["VENCIMENTO", 2], ["FATURA", 3], ["CONTA DE AGUA", 6], ["SANEAMENTO", 3], ["ESGOTO", 3],
    ["TOTAL A PAGAR", 2], ["VALOR A PAGAR", 2], ["CODIGO DE BARRAS", 1], ["NOTA FISCAL", 1], ["COMPROVANTE DE RESIDENCIA", 7],
    ["COMPROVANTE DE ENDERECO", 7], ["BANDEIRA TARIFARIA", 4], ...EMPRESAS_CONTA.map((e) => [e, 3])],
  nascimento: [["CERTIDAO DE NASCIMENTO", 8], ["REGISTRO CIVIL DAS PESSOAS NATURAIS", 4], ["AVOS PATERNOS", 4],
    ["AVOS MATERNOS", 4], ["LOCAL DE NASCIMENTO", 3], ["DECLARANTE", 2], ["NASCIMENTO", 2]],
  casamento: [["CERTIDAO DE CASAMENTO", 8], ["REGIME DE BENS", 5], ["CONTRAENTES", 5], ["NUBENTES", 4],
    ["COMUNHAO PARCIAL", 4], ["COMUNHAO UNIVERSAL", 4], ["CASAMENTO", 3]],
  ficha: [["FICHA DE INSCRICAO", 8], ["FICHA CADASTRAL", 6], ["ASSINATURA DO ASSOCIADO", 4],
    ["FICHA", 2], ["ASSOCIADO", 2], ["INSCRICAO", 1]],
  proposta: [["PROPOSTA DE ADMISSAO", 8], ["PROPOSTA DE ADESAO", 8], ["TERMO DE ADESAO", 6], ["PROPOSTA DE FILIACAO", 7],
    ["PROPOSTA", 3], ["ADMISSAO", 3], ["ADESAO", 2]],
  renda: [["DEMONSTRATIVO DE PAGAMENTO", 7], ["HOLERITE", 7], ["CONTRACHEQUE", 7], ["CONTRA CHEQUE", 7], ["RECIBO DE PAGAMENTO", 5],
    ["COMPROVANTE DE RENDIMENTOS", 7], ["SALARIO BASE", 3], ["PROVENTOS", 3], ["VENCIMENTOS", 2], ["DESCONTOS", 2],
    ["LIQUIDO", 2], ["INSS", 2], ["FGTS", 2], ["IRRF", 2]],
  titulo: [["TITULO ELEITORAL", 8], ["TITULO DE ELEITOR", 8], ["JUSTICA ELEITORAL", 6], ["TRIBUNAL SUPERIOR ELEITORAL", 5],
    ["ELEITOR", 3], ["ZONA", 2], ["SECAO", 2]],
  ctps: [["CARTEIRA DE TRABALHO", 8], ["CTPS", 6], ["PREVIDENCIA SOCIAL", 3], ["CONTRATO DE TRABALHO", 3]],
};
// documentos que o DigiDoc sabe reconhecer. "padrao" = nome do arquivo sugerido quando a pessoa
// liga o reconhecimento dele e nao escreve outro (Configuracoes > Reconhecimento > Salvar como)
const FAMILIAS = [
  { id: "rg", nome: "RG / Carteira de identidade", padrao: "RG" },
  { id: "cnh", nome: "CNH (carteira de motorista)", padrao: "CNH" },
  { id: "cpf", nome: "CPF", padrao: "CPF" },
  { id: "residencia", nome: "Comprovante de endereço (conta de luz, água, telefone…)", padrao: "COMP_RES" },
  { id: "nascimento", nome: "Certidão de nascimento", padrao: "CERT_NASC" },
  { id: "casamento", nome: "Certidão de casamento", padrao: "CERT_CAS" },
  { id: "ficha", nome: "Ficha de inscrição / cadastro", padrao: "FICHA" },
  { id: "proposta", nome: "Proposta (admissão, adesão)", padrao: "PROPOSTA" },
  { id: "renda", nome: "Comprovante de renda (holerite, contracheque)", padrao: "RENDA" },
  { id: "titulo", nome: "Título de eleitor", padrao: "TITULO" },
  { id: "ctps", nome: "Carteira de trabalho", padrao: "CTPS" },
  { id: "foto", nome: "Foto 3x4 (imagem sem texto)", padrao: "FOTO" },
];
// qual tipo da config corresponde a cada familia (pela sigla ou por palavras do nome)
const ACHAR_TIPO = {
  rg: [/^RG$/, /IDENTIDADE|^RG\b/], cnh: [/^CNH$/, /HABILITA/], cpf: [/^CPF$/, /\bCPF\b/],
  residencia: [/^COMP_?RES|^ENDERECO/, /RESIDENCIA|ENDERECO/], nascimento: [/NASC/, /NASCIMENTO/], casamento: [/CAS/, /CASAMENTO/],
  ficha: [/^FICHA/, /FICHA|INSCRICAO/], foto: [/^FOTO/, /FOTO|3X4/], proposta: [/^PROPOSTA/, /PROPOSTA/],
  renda: [/^RENDA|HOLERITE/, /RENDA|HOLERITE|CONTRACHEQUE/], titulo: [/^TITULO/, /TITULO|ELEITOR/], ctps: [/^CTPS/, /CARTEIRA DE TRABALHO|CTPS/],
};

const normaliza = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/[^A-Z0-9.\n ]+/g, " ").replace(/[ \t]+/g, " ");

function tipoDaFamilia(familia, tipos) {
  const [porSigla, porNome] = ACHAR_TIPO[familia] || [];
  const ts = tipos.map((t) => ({ t, s: normaliza(t.sigla).trim(), n: normaliza(t.nome) }));
  const t = (ts.find((x) => porSigla && porSigla.test(x.s)) || ts.find((x) => porNome && porNome.test(x.n)) || {}).t || null;
  // sem um tipo "CNH" na config, a CNH conta como documento de identidade (o tipo do RG)
  if (!t && familia === "cnh") return tipoDaFamilia("rg", tipos);
  return t;
}

// sigla (nome do arquivo) a partir de um nome: "Comprovante de endereço" -> COMPROVANTE_ENDERECO
const PREPOSICOES = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "A", "O", "EM", "NA", "NO", "PARA", "COM"]);
function siglaDe(nome) {
  const w = normaliza(nome).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((x) => x && !PREPOSICOES.has(x));
  return (w.join("_") || "DOC").slice(0, 30);
}
// "ENDERECO" -> "Endereco"; sigla curta (CNH, RG, CPF) fica como esta
const bonito = (s) => {
  const v = String(s).trim();
  return /^[A-Z0-9]{1,5}$/.test(v) ? v : v.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
};

// pra onde vai cada familia. rec = cfg.reconhecimento ({ rg: { ativo, nome }, ... })
// -> { t: tipo existente } | { criar: { nome, sigla } } | null (desligado / sem tipo)
function destinoDaFamilia(fid, tipos, rec) {
  const c = rec && rec[fid];
  if (c && c.ativo === false) return null;
  const fam = FAMILIAS.find((f) => f.id === fid);
  const escrito = c && String(c.nome || "").trim();
  if (escrito || (c && c.ativo === true)) {
    // a pessoa escolheu o nome ("ENDERECO", "Proposta"...): usa o tipo com esse nome ou cria um
    const alvo = escrito || (tipoDaFamilia(fid, tipos) || {}).sigla || fam.padrao;
    const s = siglaDe(alvo);
    const t = tipos.find((x) => normaliza(x.sigla).trim().replace(/ /g, "_") === s || normaliza(x.nome).trim() === normaliza(alvo).trim());
    return t ? { t } : { criar: { nome: bonito(alvo.replace(/_/g, " ")), sigla: s } };
  }
  // sem configuracao: so reconhece se ja existe um tipo que combina (como sempre foi)
  const t = tipoDaFamilia(fid, tipos);
  return t ? { t } : null;
}

// lista pra tela de Configuracoes: cada familia e o nome que vai usar hoje
function familias(tipos, rec) {
  return FAMILIAS.map((f) => {
    const d = destinoDaFamilia(f.id, tipos, rec);
    const c = (rec && rec[f.id]) || {};
    return { id: f.id, nome: f.nome, padrao: f.padrao, ativo: !!d, nomeEscrito: c.nome || "",
      usa: d ? (d.t ? d.t.sigla : d.criar.sigla) : "" };
  });
}

// ---- aprendizado (palavras das paginas que a pessoa corrigiu) ----
const PALAVRAS_COMUNS = new Set(("PARA COMO DESTE DESTA ESTE ESTA PELOS PELAS SOBRE ENTRE QUANDO ONDE DATA NOME VALOR TOTAL " +
  "BRASIL REPUBLICA FEDERATIVA NUMERO ENDERECO CIDADE ESTADO PAGINA ASSINATURA").split(" "));
function lerAprendizado() { try { return JSON.parse(fs.readFileSync(PATHS.aprendizado, "utf8")); } catch { return {}; } }
function aprender(texto, sigla) {
  if (!PATHS.aprendizado || !texto || !sigla) return;
  const ap = lerAprendizado();
  const conta = {};
  for (const p of normaliza(texto).split(/[\s.\n]+/)) if (p.length >= 5 && /^[A-Z]+$/.test(p) && !PALAVRAS_COMUNS.has(p)) conta[p] = (conta[p] || 0) + 1;
  const top = Object.entries(conta).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p]) => p);
  const doTipo = ap[sigla] || (ap[sigla] = {});
  for (const p of top) doTipo[p] = Math.min(9, (doTipo[p] || 0) + 1);
  try { fs.mkdirSync(path.dirname(PATHS.aprendizado), { recursive: true }); fs.writeFileSync(PATHS.aprendizado, JSON.stringify(ap)); } catch {}
}
function esquecerAprendizado() { try { fs.rmSync(PATHS.aprendizado, { force: true }); } catch {} }

// ---- OCR ----
let workerP = null;
function resolverCore() {
  if (PATHS.core && fs.existsSync(PATHS.core)) return PATHS.core;
  try {
    const dir = path.dirname(require.resolve("tesseract.js/package.json")).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    for (const c of [path.join(dir, "node_modules", "tesseract.js-core"), path.join(dir, "..", "tesseract.js-core")]) if (fs.existsSync(c)) return c;
  } catch {}
  return "";
}
function obterWorker() {
  if (!workerP) {
    const { createWorker, OEM, PSM } = require("tesseract.js");
    workerP = (async () => {
      const w = await createWorker("por", OEM.LSTM_ONLY, {
        corePath: resolverCore(), langPath: PATHS.lang, cacheMethod: "none", gzip: false,
        legacyCore: false, legacyLang: false, logger: () => {}, errorHandler: () => {},
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}
const disponivel = () => { try { return fs.existsSync(path.join(PATHS.lang, "por.traineddata")); } catch { return false; } };

async function lerTexto(buf) {
  // cinza, perto da resolucao do scanner (lado maior entre 1600 e 2400 px). Nao reduz mais que isso:
  // reduzida, a letra miuda de um cartao (RG) fica pequena demais e o leitor nao acha nada.
  // E SEM esticar o contraste (numa pagina quase branca com um cartao, o cartao ficava preto).
  const m = await sharp(buf, { failOn: "none" }).metadata();
  const lado = Math.max(m.width || 0, m.height || 0);
  const alvo = lado > 2400 ? 2400 : lado < 1600 ? 1600 : lado;
  let img = sharp(buf, { failOn: "none" }).grayscale();
  if (alvo !== lado) img = img.resize(alvo, alvo, { fit: "inside", withoutEnlargement: false });
  const prep = await img.withMetadata({ density: 200 }).png().toBuffer();
  const w = await obterWorker();
  const { data } = await w.recognize(prep);
  return data.text || "";
}

// nome escrito no documento (linha depois de "NOME", ou "Nome: ...")
function acharNome(texto) {
  const linhas = String(texto).split(/\n/).map((l) => l.trim()).filter(Boolean);
  const valido = (s) => {
    const n = s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();
    const ps = n.split(" ").filter((p) => p.length >= 2);
    return ps.length >= 2 && ps.length <= 7 && n.length >= 8 && !/NOME|FILIACAO|DATA|NASC|CPF|REGISTRO|CARTEIRA|REPUBLICA/i.test(n) ? n : "";
  };
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(/^\s*nome(?:\s*(?:civil|social|completo))?\s*[:\-]?\s*(.*)$/i);
    if (!m) continue;
    const mesma = valido(m[1] || "");
    if (mesma) return mesma.toUpperCase();
    if (linhas[i + 1]) { const prox = valido(linhas[i + 1]); if (prox) return prox.toUpperCase(); }
  }
  return "";
}

// { sigla, nomeTipo, criarTipo?, conf, motivo, nome, texto } — sigla vazia = nao deu pra saber
// criarTipo: o nome escolhido em "Salvar como" ainda nao existe como tipo (a tela cria)
async function classificar(buf, tipos, { ehFoto = false, reconhecimento = null } = {}) {
  const bruto = await lerTexto(buf);
  const texto = normaliza(bruto);
  const letras = (texto.match(/[A-Z]/g) || []).length;
  const pont = []; // { t:{sigla,nome}, criar?, pontos, achou[] }
  const resultado = (d, conf, motivo, extra = {}) => Object.assign({
    sigla: d.t ? d.t.sigla : d.criar.sigla, nomeTipo: d.t ? d.t.nome : d.criar.nome, criarTipo: d.criar || null,
    conf, motivo, nome: "", texto: bruto.slice(0, 4000) }, extra);

  // foto 3x4: quase nenhum texto numa imagem que nao e branca
  if (letras < 25) {
    const d = destinoDaFamilia("foto", tipos, reconhecimento);
    if (d) {
      const st = await sharp(buf, { failOn: "none" }).stats();
      const variacao = st.channels.slice(0, 3).reduce((s, c) => s + c.stdev, 0) / Math.min(3, st.channels.length);
      if (variacao > 25 || ehFoto) return resultado(d, 0.6, "imagem sem texto (parece foto)", { texto: "" });
    }
  }

  const tem = (exp) => texto.includes(exp);
  for (const [familia, regras] of Object.entries(REGRAS)) {
    const d = destinoDaFamilia(familia, tipos, reconhecimento);
    if (!d) continue;
    const t = d.t || d.criar;
    let pontos = 0; const achou = [];
    for (const [exp, peso] of regras) if (tem(exp)) { pontos += peso; achou.push(exp.toLowerCase()); }
    if (familia === "cpf" && /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(texto)) { pontos += 1; }
    const atual = pont.find((p) => p.t.sigla === t.sigla);
    if (atual) { if (pontos > atual.pontos) Object.assign(atual, { pontos, achou }); } // ex.: CNH cai no tipo do RG
    else pont.push({ t, d, pontos, achou });
  }
  // tipos criados pela pessoa (sem regra pronta): o proprio nome do tipo
  for (const t of tipos) {
    if (pont.some((p) => p.t.sigla === t.sigla)) continue;
    const nome = normaliza(t.nome).trim();
    if (nome.length < 4) continue;
    let pontos = tem(nome) ? 7 : 0; const achou = pontos ? [nome.toLowerCase()] : [];
    for (const w of nome.split(" ")) if (w.length >= 6 && tem(w)) { pontos += 1; achou.push(w.toLowerCase()); }
    pont.push({ t, d: { t }, pontos, achou });
  }
  // o que aprendeu com as correcoes
  const ap = lerAprendizado();
  const palavras = new Set(texto.split(/[\s.\n]+/));
  for (const p of pont) {
    const doTipo = ap[p.t.sigla];
    if (!doTipo) continue;
    let extra = 0;
    for (const [w, n] of Object.entries(doTipo)) if (palavras.has(w)) extra += Math.min(n, 3) * 0.5;
    if (extra) { p.pontos += Math.min(extra, 6); p.achou.push("aprendido"); }
  }

  pont.sort((a, b) => b.pontos - a.pontos);
  const [a, b] = pont;
  const nome = acharNome(bruto);
  if (!a || a.pontos < 5 || (b && b.pontos > 0 && a.pontos < b.pontos * 1.5)) {
    return { sigla: "", conf: 0, motivo: a && a.pontos ? `em dúvida (${a.t.nome}?)` : "não reconheci", nome, texto: bruto.slice(0, 4000) };
  }
  return resultado(a.d, Math.min(1, a.pontos / 12), a.achou.slice(0, 3).join(", "), { nome });
}

async function encerrar() { if (workerP) { try { (await workerP).terminate(); } catch {} workerP = null; } }

module.exports = { configurar, classificar, familias, aprender, esquecerAprendizado, disponivel, encerrar, _normaliza: normaliza, _acharNome: acharNome };
