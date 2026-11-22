"use strict";
// Configuracao do app. Tudo e configuravel e fica salvo AO LADO DO PROGRAMA
// (na pasta do DigiDoc, no pendrive ou no PC). Em desenvolvimento, fica na pasta do projeto.
//
// Caminhos (pasta dos documentos, backup, motor do scanner) sao gravados RELATIVOS a
// pasta do programa sempre que estao no mesmo disco — assim o pendrive continua
// funcionando quando muda de letra (D: num PC, E: em outro).
const fs = require("fs");
const path = require("path");
const os = require("os");

let electronApp = null;
try { const e = require("electron"); if (e && typeof e === "object" && e.app) electronApp = e.app; } catch {}

const NOME_CONFIG = "digitalizador-config.json";

function baseDir() {
  // build antigo (exe unico "portable"): pasta do exe original
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  // build em pasta: a pasta onde esta o DigiDoc.exe
  if (electronApp && electronApp.isPackaged) return path.dirname(process.execPath);
  // desenvolvimento
  return path.join(__dirname, "..", "..");
}

const CONFIG_PATH = path.join(baseDir(), NOME_CONFIG);

function empacotado() { return !!(process.env.PORTABLE_EXECUTABLE_DIR || (electronApp && electronApp.isPackaged)); }

// Pasta de saida padrao: "Digitalizado" dentro da pasta do programa; em dev, Documentos.
function pastaSaidaPadrao() {
  if (empacotado()) return path.join(baseDir(), "Digitalizado");
  return path.join(os.homedir(), "Documents", "Digitalizado");
}

const PADRAO = {
  // ----- pastas e nomes -----
  pastaSaida: "",                     // vazio = padrao (Digitalizado ao lado do programa)
  formatoPastaLetra: "Letra {letra}", // ex.: "Letra A"  (ou "{letra}" para so "A")
  formatoNomeAssociado: "titulo",     // "titulo" | "maiusculo" | "original"
  removerAcentosPasta: false,
  formatoNomeArquivo: "{tipo}",       // ex.: RG.pdf  (dossie usa siglaDossie)
  maiusculasNomeArquivo: true,
  removerAcentosArquivo: true,

  // ----- limites (regras do Siclus) -----
  tamanhoMaxMB: 2.0,
  maxCaracteresNome: 40,
  extensaoContaNoLimite: true, // conta ".pdf" dentro dos 40

  // ----- arquivo repetido -----
  seArquivoExiste: "numerar", // "numerar" | "substituir" | "perguntar"

  // ----- compressao (estilo iLovePDF) -----
  compressaoPadraoDossie: "extrema",     // pouca | recomendada | extrema
  compressaoPadraoDocumento: "recomendada",
  nuncaDividir: true, // o usuario pediu: nunca dividir o PDF

  // ----- scanner -----
  scanner: {
    origem: "auto",        // auto (alimentador se tiver papel, senao vidro) | alimentador | vidro
    resolucao: 200,        // dpi
    cor: "cinza",          // cor | cinza | pb
    frenteEVerso: false,   // duplex
    driver: "auto",        // (antigo) a busca automatica sempre olha USB e rede
    dispositivo: "",       // (antigo) nome do scanner; virou porPC
    porPC: {},             // scanner de CADA PC (o pendrive viaja): { nomeDoPC: { aparelho, ultimoAuto } }
                           //   aparelho = escolhido no seletor; ultimoAuto = achado sozinho
    capacidades: {},       // o que cada aparelho tem: { chave: { vidro, alimentador, duplex, fonte, em } }
    folhearAntes: true,    // lembrete de folhear o maco (anti puxa-2-folhas)
    perguntarFolhas: true, // pergunta quantas folhas colocou, pra avisar se puxou 2 juntas
    caminhoNaps2: "",      // vazio = procura a pasta naps2 ao lado do programa
  },

  // ----- ajustes automaticos de imagem (cada um liga/desliga) -----
  ajustes: {
    autoGirar: true,       // 0/90/180/270 pelo conteudo (como HP Smart)
    endireitar: true,      // corrige inclinacao pequena (deskew)
    clararFundo: true,     // deixa o fundo branco
    tirarPaginaBranca: true,
    recortarFolha: true,   // util nas fotos do iPhone (tira a mesa/fundo)
    nitidez: true,         // realca o texto (sharpen leve) — so nas paginas em cinza
    corOriginal: true,     // pagina colorida sai com a cor do scanner, sem clarear/realcar (senao "estoura")
  },

  // ----- iPhone / celular -----
  celular: {
    metodo: "usb",         // usb | wifi | desligado
    apagarDepoisDeImportar: false,
    qualidadeFoto: 85,
  },

  // ----- depois de salvar -----
  aposSalvar: {
    abrirPasta: false,
    tocarSom: true,
    limparPaginas: true,   // limpa a tela pro proximo
    proximoAssociado: true, // volta pro campo do nome, ja selecionado (so digitar o proximo)
    pastaBackup: "",       // se preenchida, copia o PDF salvo pra ca tambem (backup)
  },

  // ----- producao -----
  metaDia: 0,              // meta de associados por dia (0 = sem meta); barrinha no rodape
  reconhecerTipo: false,   // le o texto da pagina e ja marca o tipo (RG, CPF...) no modo documento por documento
  // lista de conferencia: anota o nome (e codigo) de cada associado salvo num TXT por data
  conferencia: { ativo: true, pasta: "" }, // pasta vazia = Documentos / "DigiDoc - Conferencia"
  reconhecimento: {},      // por documento reconhecido: { ativo, nome } — nome = "salvar como" (ex.: residencia -> ENDERECO)

  // ----- atualizacao automatica (GitHub) -----
  atualizacao: {
    automatica: true,      // procura ao abrir (so avisa; a pessoa escolhe a hora de atualizar)
  },

  // ----- visual / compatibilidade -----
  tema: "claro",           // claro | escuro
  tamanhoMiniatura: 150,
  semAceleracao: false,    // modo compatibilidade: desliga a aceleracao de video (tela branca/preta em PC fraco)

  // ----- tipos de documento (nome, sigla, tecla de atalho, cor) -----
  // os nomes que a equipe ja usa nas pastas (RG, CNH, ENDERECO, PROPOSTA, NASC...)
  tipos: TIPOS_PADRAO(),
  siglaDossie: "DOSSIE COMPLETO", // nome do arquivo no modo dossie completo
  espacoNoNomeArquivo: true,      // "TERMO DE COMPROMISSO.pdf" (false = "TERMO_DE_COMPROMISSO.pdf")

  _versao: 3,
};

function TIPOS_PADRAO() {
  return [
    { nome: "RG / Identidade", sigla: "RG", tecla: "1", colorido: false },
    { nome: "CNH", sigla: "CNH", tecla: "2", colorido: false },
    { nome: "CPF", sigla: "CPF", tecla: "3", colorido: false },
    { nome: "Comprovante de endereço", sigla: "ENDERECO", tecla: "4", colorido: false },
    { nome: "Proposta", sigla: "PROPOSTA", tecla: "5", colorido: false },
    { nome: "Certidão de nascimento", sigla: "NASC", tecla: "6", colorido: false },
    { nome: "Certidão de casamento", sigla: "CASAMENTO", tecla: "7", colorido: false },
    { nome: "Negativa", sigla: "NEG", tecla: "8", colorido: false },
    { nome: "Termo de compromisso", sigla: "TERMO DE COMPROMISSO", tecla: "9", colorido: false },
    { nome: "Ficha de sócio", sigla: "FICHA", tecla: "0", colorido: false },
    { nome: "Auto conta", sigla: "AUTO CONTA", tecla: "", colorido: false },
    { nome: "Auto cartão", sigla: "AUTO CARTAO", tecla: "", colorido: false },
    { nome: "Conta", sigla: "CONTA", tecla: "", colorido: false },
    { nome: "TCO", sigla: "TCO", tecla: "", colorido: false },
    { nome: "CAP", sigla: "CAP", tecla: "", colorido: false },
    { nome: "Carta de apresentação", sigla: "CARTA APRESENTACAO", tecla: "", colorido: false },
    { nome: "Inadimplência", sigla: "INADIMPLENCIA", tecla: "", colorido: false },
    { nome: "Declaração de união estável", sigla: "DEC UNIAO ESTAVEL", tecla: "", colorido: false },
    { nome: "Foto 3x4", sigla: "FOTO", tecla: "", colorido: true },
    { nome: "Outros", sigla: "DOC", tecla: "", colorido: false },
  ];
}
// a lista de tipos que vinha de fabrica ate a versao 0.6 (quem nunca mexeu ganha a lista nova)
const SIGLAS_FABRICA_ANTIGA = ["RG", "CPF", "COMP_RES", "CERT_NASC", "CERT_CAS", "FICHA", "FOTO", "DOC"];
const TROCA_ANTIGA = { COMP_RES: "ENDERECO", CERT_NASC: "NASC", CERT_CAS: "CASAMENTO" };
function migrar(c) {
  if ((c._versao || 0) >= 3) return c;
  const tipos = Array.isArray(c.tipos) ? c.tipos : [];
  const siglas = tipos.map((t) => String(t.sigla || "").toUpperCase());
  if (siglas.length === SIGLAS_FABRICA_ANTIGA.length && siglas.every((s, i) => s === SIGLAS_FABRICA_ANTIGA[i])) {
    // os nomes que a equipe usa; mantem o que a pessoa marcou (obrigatorio, cor) nos que continuam
    const novos = TIPOS_PADRAO();
    for (const antigo of tipos) {
      const sigla = TROCA_ANTIGA[String(antigo.sigla).toUpperCase()] || String(antigo.sigla).toUpperCase();
      const n = novos.find((t) => t.sigla === sigla);
      if (n) { if (antigo.obrig) n.obrig = true; if (sigla !== "FOTO") n.colorido = !!antigo.colorido; }
    }
    c.tipos = novos;
  }
  if (!c.siglaDossie || String(c.siglaDossie).toUpperCase() === "DOSSIE") c.siglaDossie = "DOSSIE COMPLETO";
  c._versao = 3;
  return c;
}

function mesclar(padrao, salvo) {
  if (Array.isArray(padrao)) return salvo !== undefined ? salvo : padrao;
  if (padrao && typeof padrao === "object") {
    const out = {};
    for (const k of Object.keys(padrao)) {
      out[k] = salvo && k in salvo ? mesclar(padrao[k], salvo[k]) : padrao[k];
    }
    // mantem chaves extras que o usuario tenha adicionado
    if (salvo) for (const k of Object.keys(salvo)) if (!(k in out)) out[k] = salvo[k];
    return out;
  }
  return salvo !== undefined ? salvo : padrao;
}

// ---- caminhos: disco (relativo quando der) <-> memoria (absoluto) ----
function mesmoDisco(a, b) { return path.parse(a).root.toLowerCase() === path.parse(b).root.toLowerCase(); }

function paraDisco(p) {
  if (!p) return "";
  if (!path.isAbsolute(p)) return p;
  const base = baseDir();
  return mesmoDisco(p, base) ? (path.relative(base, p) || ".") : p;
}

function paraMemoria(p) {
  if (!p) return "";
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(baseDir(), p);
}

function discoExiste(p) { try { return !!p && fs.existsSync(path.parse(p).root); } catch { return false; } }

// devolve a config com todos os caminhos ABSOLUTOS pra uso em runtime.
// A pasta dos documentos e a do backup ficam como o usuario escolheu MESMO se o disco/rede
// estiver desconectado agora: quem decide onde salvar na hora e o main (e avisa). Assim um
// HD/pendrive/rede desligado nunca apaga a escolha salva na config.
function resolver(c) {
  c.pastaSaida = paraMemoria(c.pastaSaida) || pastaSaidaPadrao();
  c.aposSalvar.pastaBackup = paraMemoria(c.aposSalvar && c.aposSalvar.pastaBackup);

  const n2 = paraMemoria(c.scanner && c.scanner.caminhoNaps2);
  c.scanner.caminhoNaps2 = n2 && fs.existsSync(n2) ? n2 : "";
  return c;
}

function lerJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

function carregar() {
  let salvo = null;
  try { salvo = lerJson(CONFIG_PATH); } catch {}
  if (!salvo) {
    // migracao do layout antigo (exe unico na raiz do pendrive, config ao lado dele)
    try {
      const antigo = path.join(path.dirname(baseDir()), NOME_CONFIG);
      if (empacotado() && antigo !== CONFIG_PATH && fs.existsSync(antigo)) {
        salvo = lerJson(antigo);
        const velhaSaida = paraMemoria(salvo.pastaSaida);
        if (velhaSaida && !fs.existsSync(velhaSaida)) salvo.pastaSaida = ""; // nao havia documentos la
      }
    } catch { salvo = null; }
  }
  // config antiga (sem _versao 3): troca a lista de tipos de fabrica pela dos nomes da equipe
  if (salvo && !((salvo._versao || 0) >= 3)) { salvo._versao = salvo._versao || 2; migrar(salvo); }
  return resolver(mesclar(PADRAO, salvo || {}));
}

// config padrao ja com caminhos resolvidos (usado no "Restaurar padrao")
function padraoResolvido() { return resolver(JSON.parse(JSON.stringify(PADRAO))); }

function salvar(cfg) {
  const c = JSON.parse(JSON.stringify(cfg));
  c.pastaSaida = c.pastaSaida && path.normalize(c.pastaSaida) === path.normalize(pastaSaidaPadrao()) ? "" : paraDisco(c.pastaSaida);
  if (c.aposSalvar) c.aposSalvar.pastaBackup = paraDisco(c.aposSalvar.pastaBackup);
  if (c.scanner) c.scanner.caminhoNaps2 = paraDisco(c.scanner.caminhoNaps2);
  delete c.semAceleracao; // modo compatibilidade e de cada PC (fica no perfil do Windows), nao viaja no pendrive
  delete c.creditos;      // a assinatura do app e fixa (versoes antigas deixavam editar)
  // grava num temporario e troca: se o pendrive sair no meio, a config antiga continua inteira
  const texto = JSON.stringify(c, null, 2), tmp = CONFIG_PATH + ".salvando";
  try {
    fs.writeFileSync(tmp, texto, "utf8");
    fs.renameSync(tmp, CONFIG_PATH);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    fs.writeFileSync(CONFIG_PATH, texto, "utf8"); // antivirus segurando o temporario: grava direto
  }
  return true;
}

module.exports = { carregar, salvar, padraoResolvido, PADRAO, CONFIG_PATH, NOME_CONFIG, baseDir, pastaSaidaPadrao, empacotado, discoExiste };
