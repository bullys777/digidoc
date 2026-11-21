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
  tipos: [
    { nome: "RG / Identidade", sigla: "RG", tecla: "1", colorido: false },
    { nome: "CPF", sigla: "CPF", tecla: "2", colorido: false },
    { nome: "Comprovante de residencia", sigla: "COMP_RES", tecla: "3", colorido: false },
    { nome: "Certidao de nascimento", sigla: "CERT_NASC", tecla: "4", colorido: false },
    { nome: "Certidao de casamento", sigla: "CERT_CAS", tecla: "5", colorido: false },
    { nome: "Ficha de inscricao", sigla: "FICHA", tecla: "6", colorido: false },
    { nome: "Foto 3x4", sigla: "FOTO", tecla: "7", colorido: true },
    { nome: "Outros", sigla: "DOC", tecla: "8", colorido: false },
  ],
  siglaDossie: "DOSSIE", // nome do arquivo no modo dossie completo

  _versao: 2,
};

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
