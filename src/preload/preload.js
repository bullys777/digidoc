"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  // caminho de um arquivo arrastado pra janela (no Electron 32+ o File.path nao existe mais)
  caminhoDoArquivo: (f) => { try { return webUtils.getPathForFile(f); } catch { return ""; } },

  // config
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (c) => ipcRenderer.invoke("config:save", c),
  configPadrao: () => ipcRenderer.invoke("config:padrao"),
  configPath: () => ipcRenderer.invoke("config:path"),
  statusPasta: () => ipcRenderer.invoke("pasta:status"),

  // associados
  listarAssociados: () => ipcRenderer.invoke("associados:list"),
  docsAssociado: (nome) => ipcRenderer.invoke("associado:docs", nome),
  pastaAssociado: (nome) => ipcRenderer.invoke("associado:pasta", nome),
  nomeArquivo: (args) => ipcRenderer.invoke("nome:arquivo", args),

  abrirDocAssociado: (nome, arquivo) => ipcRenderer.invoke("associado:abrirDoc", { nome, arquivo }),

  // paginas
  addArquivos: (args) => ipcRenderer.invoke("paginas:addArquivos", args),
  addBuffer: (args) => ipcRenderer.invoke("paginas:addBuffer", args),
  lerPdf: (caminho) => ipcRenderer.invoke("arquivo:lerPdf", caminho),
  girarPagina: (id, graus) => ipcRenderer.invoke("pagina:girar", { id, graus }),
  recortarPagina: (args) => ipcRenderer.invoke("pagina:recortar", args),
  corPagina: (id, colorido) => ipcRenderer.invoke("pagina:cor", { id, colorido }),
  removerPagina: (id) => ipcRenderer.invoke("pagina:remover", id),
  restaurarPaginas: (ids) => ipcRenderer.invoke("paginas:restaurar", ids),
  purgarLixeira: (ids) => ipcRenderer.invoke("lixeira:purgar", ids),
  limparPaginas: () => ipcRenderer.invoke("paginas:limpar"),
  descartarPaginas: (ids) => ipcRenderer.invoke("paginas:descartar", ids),
  confirmarLado: (ids) => ipcRenderer.invoke("pagina:confirmarLado", ids),
  classificarPagina: (id) => ipcRenderer.invoke("pagina:classificar", { id }),
  aprenderTipo: (id, sigla) => ipcRenderer.invoke("tipo:aprender", { id, sigla }),
  esquecerTipos: () => ipcRenderer.invoke("tipo:esquecer"),
  familiasDocumento: (args) => ipcRenderer.invoke("reconhecimento:familias", args || {}),
  clipboardTexto: () => ipcRenderer.invoke("clipboard:texto"),
  clipboardCopiar: (t) => ipcRenderer.invoke("clipboard:copiar", t),
  juntarPaginas: (ids) => ipcRenderer.invoke("paginas:juntar", { ids }),

  // fila de associados
  filaObter: () => ipcRenderer.invoke("fila:obter"),
  filaSalvar: (f) => ipcRenderer.invoke("fila:salvar", f),
  filaImportar: () => ipcRenderer.invoke("fila:importar"),
  previa: (id, tamanho) => ipcRenderer.invoke("pagina:previa", { id, tamanho }),

  // historico de salvamentos (deste PC)
  historico: () => ipcRenderer.invoke("historico:listar"),
  limparHistorico: () => ipcRenderer.invoke("historico:limpar"),
  abrirDoHistorico: (caminho) => ipcRenderer.invoke("historico:abrir", caminho),
  mostrarNaPasta: (caminho) => ipcRenderer.invoke("historico:mostrarNaPasta", caminho),
  onHistorico: (cb) => ipcRenderer.on("historico:mudou", (_e, d) => cb(d)),
  versao: () => ipcRenderer.invoke("app:versao"),

  // painel de producao
  estatisticas: (forcar) => ipcRenderer.invoke("estatisticas:obter", { forcar }),
  resumoEstatisticas: () => ipcRenderer.invoke("estatisticas:resumo"),
  abrirPastaPessoa: (caminho) => ipcRenderer.invoke("estatisticas:abrirPasta", caminho),
  exportarRelatorio: () => ipcRenderer.invoke("estatisticas:exportar"),

  // atualizacao automatica
  procurarAtualizacao: () => ipcRenderer.invoke("atualizacao:procurar"),
  aplicarAtualizacao: () => ipcRenderer.invoke("atualizacao:aplicar"),
  paginaAtualizacao: () => ipcRenderer.invoke("atualizacao:pagina"),
  atualizacaoFalhou: () => ipcRenderer.invoke("atualizacao:falhou"),

  // importar / scanner
  importarDialog: () => ipcRenderer.invoke("importar:dialog"),
  importarClipboard: (args) => ipcRenderer.invoke("importar:clipboard", args),
  demoPaginas: (args) => ipcRenderer.invoke("demo:paginas", args),
  scannerListar: (args) => ipcRenderer.invoke("scanner:listar", args),
  scannerTemMotor: () => ipcRenderer.invoke("scanner:temMotor"),
  scannerInfo: () => ipcRenderer.invoke("scanner:info"),
  scannerDetectar: () => ipcRenderer.invoke("scanner:detectar"),
  scannerPlanejar: (args) => ipcRenderer.invoke("scanner:planejar", args),
  scannerCancelar: () => ipcRenderer.invoke("scanner:cancelar"),
  scannerEscolher: (ap) => ipcRenderer.invoke("scanner:escolher", ap),
  instalarMotor: () => ipcRenderer.invoke("scanner:instalar"),
  escanear: (args) => ipcRenderer.invoke("scanner:escanear", args),

  // salvar
  salvarDossie: (args) => ipcRenderer.invoke("salvar:dossie", args),
  salvarDocumentos: (args) => ipcRenderer.invoke("salvar:documentos", args),
  escolherPdfExistente: (nome) => ipcRenderer.invoke("pdf:escolherExistente", nome),
  adicionarPDF: (args) => ipcRenderer.invoke("salvar:adicionarPDF", args),
  abrirPasta: (nome) => ipcRenderer.invoke("abrir:pasta", nome),
  escolherPastaSaida: () => ipcRenderer.invoke("escolher:pastaSaida"),
  infoDesinstalar: () => ipcRenderer.invoke("pc:infoDesinstalar"),
  desinstalar: () => ipcRenderer.invoke("pc:desinstalar"),
  reiniciar: () => ipcRenderer.invoke("app:reiniciar"),

  // celular (iPhone) por Wi-Fi/QR
  celularIniciar: () => ipcRenderer.invoke("celular:iniciar"),
  celularParar: () => ipcRenderer.invoke("celular:parar"),
  onCelularFoto: (cb) => ipcRenderer.on("celular:foto", (_e, d) => cb(d)),

  // cantinho
  onCantinhoPanico: (cb) => ipcRenderer.on("cantinho:panico", () => cb()),
  onJanelaBlur: (cb) => ipcRenderer.on("janela:blur", () => cb()),
  sairTelaCheia: () => ipcRenderer.invoke("janela:sairTelaCheia"),
  cantinhoEstado: (st) => ipcRenderer.invoke("cantinho:estado", st),
  cantinhoApagarJogos: () => ipcRenderer.invoke("cantinho:apagarJogos"),

  // lista de conferencia
  conferenciaInfo: () => ipcRenderer.invoke("conferencia:info"),
  conferenciaEscolherPasta: (sugerida) => ipcRenderer.invoke("conferencia:escolherPasta", sugerida),
  conferenciaAbrir: (pasta, qual) => ipcRenderer.invoke("conferencia:abrir", { pasta: pasta || null, qual: qual || "lista" }),
  conferenciaEscanear: () => ipcRenderer.invoke("conferencia:escanear"),
  conferenciaImportar: (achados, pasta) => ipcRenderer.invoke("conferencia:importar", { achados, pasta }),
  devDiagnostico: (senha) => ipcRenderer.invoke("dev:diagnostico", { senha }),
  onAviso: (cb) => ipcRenderer.on("aviso", (_e, t) => cb(t)),

  // eventos
  onProgresso: (cb) => ipcRenderer.on("progresso", (_e, d) => cb(d)),
  onScannerMudou: (cb) => ipcRenderer.on("scanner:mudou", (_e, d) => cb(d)),
  onScannerAchado: (cb) => ipcRenderer.on("scanner:achado", (_e, d) => cb(d)),
};

contextBridge.exposeInMainWorld("api", api);
