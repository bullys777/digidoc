"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const config = require("./config");
const files = require("./files");
const scanner = require("./scanner");
const estatisticas = require("./estatisticas");
const conferencia = require("./conferencia");
const atualizar = require("./atualizar");

// ---- modulos pesados (sharp, pdf-lib, tesseract, qrcode) so carregam quando usados:
//      a janela aparece bem mais rapido, principalmente vindo de pendrive ----
const _mods = {};
function sobDemanda(chave, carregar) {
  return new Proxy({}, {
    get(_alvo, prop) {
      if (!_mods[chave]) _mods[chave] = carregar();
      return _mods[chave][prop];
    },
  });
}
const pipeline = sobDemanda("pipeline", () => require("./pipeline"));
// reconhecer o tipo do documento (opcional): OCR em portugues, carrega so quando usado
const classificador = sobDemanda("classificar", () => {
  const c = require("./classificar");
  const unpacked = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : path.join(__dirname, "..", "..");
  c.configurar({
    core: path.join(unpacked, "node_modules", "tesseract.js", "node_modules", "tesseract.js-core"),
    lang: path.join(unpacked, "assets", "tesseract"),
    aprendizado: path.join(app.getPath("userData"), "aprendizado-tipos.json"),
  });
  return c;
});
const pdf = sobDemanda("pdf", () => require("./pdf"));
const servidorCelular = sobDemanda("servidorCelular", () => require("./servidorCelular"));
const QRCode = sobDemanda("qrcode", () => require("qrcode"));
// motor de OSD (giro automatico): caminhos funcionando em dev e empacotado
const orientacao = sobDemanda("orientacao", () => {
  const o = require("./orientacao");
  const unpacked = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : path.join(__dirname, "..", "..");
  o.configurar({
    core: path.join(unpacked, "node_modules", "tesseract.js-core"),
    lang: path.join(unpacked, "assets", "tesseract"),
    // modelo de orientacao: lido pelo fs do Electron (funciona dentro do app.asar)
    modelo: path.join(__dirname, "..", "..", "assets", "modelos", "orientacao-documento.onnx"),
  });
  return o;
});

let cfg = config.carregar();
let win = null;
let splash = null;

// modo compatibilidade (sem aceleracao de video) vale POR PC: fica no perfil do Windows deste
// PC, nao na config que viaja no pendrive (um PC com placa ruim nao deixa os outros mais lentos)
const COMPAT_PC = path.join(app.getPath("userData"), "modo-compatibilidade.json");
function compatDestePC() {
  try { return JSON.parse(fs.readFileSync(COMPAT_PC, "utf8")).semAceleracao === true; } catch { return false; }
}
function gravarCompatDestePC(ligado) {
  try { fs.mkdirSync(path.dirname(COMPAT_PC), { recursive: true }); fs.writeFileSync(COMPAT_PC, JSON.stringify({ semAceleracao: !!ligado })); } catch {}
}
cfg.semAceleracao = compatDestePC();

// pasta onde os PDFs vao AGORA: a escolhida nas Configuracoes; se o disco/pendrive/rede dela
// nao estiver conectado, usa a padrao (o app avisa) — sem trocar a escolha salva na config
const saidaConectada = () => config.discoExiste(cfg.pastaSaida);
function cfgSaida() {
  return saidaConectada() ? cfg : Object.assign({}, cfg, { pastaSaida: config.pastaSaidaPadrao() });
}

// ---- uma instancia so: se clicar de novo (porque demorou), so traz a janela pra frente ----
const temInstancia = app.requestSingleInstanceLock();
if (!temInstancia) app.quit();
app.on("second-instance", (_e, argv) => {
  const w = win && !win.isDestroyed() && win.isVisible() ? win : splash;
  if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  // pediram pra desinstalar (Windows > Aplicativos) com o DigiDoc aberto: pergunta nesta janela
  if ((argv || []).includes("--desinstalar")) desinstalarPelaLinhaDeComando(win && !win.isDestroyed() ? win : null).catch(() => {});
});

// ---- modo compatibilidade: sem aceleracao de video (tela branca/preta em PC fraco, VM ou acesso remoto) ----
if (cfg.semAceleracao) app.disableHardwareAcceleration();
// o Windows marca a janela coberta por outra como "escondida" e o Chromium para de desenhar: o que
// depende da tela (importar PDF, miniaturas) ficava parado ate a pessoa voltar pro DigiDoc
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("child-process-gone", (_e, d) => {
  // se a placa de video derrubar o app, liga o modo compatibilidade sozinho e reabre
  if (d.type === "GPU" && !cfg.semAceleracao && ["crashed", "abnormal-exit", "launch-failed", "integrity-failure"].includes(d.reason)) {
    cfg.semAceleracao = true;
    gravarCompatDestePC(true);
    app.relaunch(); app.exit(0);
  }
});

// ---- armazenamento das paginas (buffers ficam no processo principal, nao no renderer) ----
// id -> { original: Buffer, opts:{colorido, ehFoto, giroFixo, recorte}, processado: Buffer, meta:{w,h,giro} }
//   giroFixo: giro total decidido (automatico na 1a vez; o botao Girar soma em cima dele)
//   recorte: { x, y, w, h } normalizado (0..1) sobre a pagina pronta, ou null
const paginas = new Map();
// paginas removidas que ainda podem voltar com o Desfazer (Ctrl+Z). Esvazia ao salvar/limpar.
const lixeira = new Map();
let seq = 0;

function opcoesPipeline(extra = {}) {
  return {
    colorido: extra.colorido ?? false,
    ajustes: cfg.ajustes,
    giroFixo: typeof extra.giroFixo === "number" ? extra.giroFixo : undefined,
    recorte: extra.recorte || null,
    ehFoto: extra.ehFoto || false,
    // o pipeline so chama o orientador quando ajustes.autoGirar estiver ligado
    orientador: (buf) => orientacao.detectarDetalhado(buf),
    semAjustes: !!extra.semAjustes,
  };
}

const resumoPagina = (id, p, thumb) => ({
  id, thumb, giro: p.meta.giro, w: p.meta.w, h: p.meta.h, colorido: !!p.opts.colorido, recortada: !!p.opts.recorte,
  incerto: !!p.meta.incerto, digital: p.meta.digital || "",
});
async function digitalSegura(buf) { try { return await pipeline.digital(buf); } catch { return ""; } }

async function registrarPagina(original, { colorido, ehFoto } = {}) {
  const id = "p" + ++seq;
  const opts = { colorido: !!colorido, ehFoto: !!ehFoto, giroFixo: undefined, recorte: null };
  const r = await pipeline.processarPagina(original, opcoesPipeline(opts));
  if (r.branca && cfg.ajustes.tirarPaginaBranca) {
    return { branca: true };
  }
  opts.giroFixo = r.giro || 0; // daqui pra frente o giro e fixo (Girar soma em cima)
  const p = { original, opts, processado: r.buffer,
    meta: { w: r.width, h: r.height, giro: r.giro, incerto: !!r.giroIncerto, digital: await digitalSegura(r.buffer) } };
  paginas.set(id, p);
  const thumb = await pipeline.miniatura(r.buffer, cfg.tamanhoMiniatura);
  return resumoPagina(id, p, thumb);
}

async function reprocessar(id) {
  const p = paginas.get(id);
  if (!p) return null;
  const r = await pipeline.processarPagina(p.original, opcoesPipeline(p.opts));
  if (r.branca) return resumoPagina(id, p, await pipeline.miniatura(p.processado, cfg.tamanhoMiniatura));
  p.processado = r.buffer;
  p.meta = Object.assign(p.meta || {}, { w: r.width, h: r.height, giro: r.giro, digital: await digitalSegura(r.buffer) });
  const thumb = await pipeline.miniatura(r.buffer, cfg.tamanhoMiniatura);
  return resumoPagina(id, p, thumb);
}

// gira um retangulo normalizado junto com a pagina (graus multiplo de 90, horario)
function girarRetangulo(r, graus) {
  if (!r) return r;
  let o = Object.assign({}, r);
  const passos = (((graus / 90) % 4) + 4) % 4;
  for (let i = 0; i < passos; i++) o = { x: 1 - (o.y + o.h), y: o.x, w: o.h, h: o.w };
  return o;
}

// telinha "Abrindo DigiDoc…" que aparece na hora, enquanto a janela principal carrega
const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#1d1f2b;color:#fff;font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden;user-select:none;-webkit-app-region:drag}
.c{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
.l{font-size:46px;color:#6ea8ff;line-height:1}.t{font-size:22px;font-weight:800}.s{font-size:13px;color:#a9b0c0}
.b{width:160px;height:4px;border-radius:9px;background:#ffffff1f;overflow:hidden;margin-top:8px}
.b i{display:block;width:40%;height:100%;border-radius:9px;background:linear-gradient(90deg,#3b82f6,#22d3ee);animation:a 1.1s ease-in-out infinite}
@keyframes a{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
.r{position:absolute;bottom:10px;width:100%;text-align:center;font-size:11px;color:#6b7184}
</style></head><body><div class="c"><div class="l">&#9635;</div><div class="t">DigiDoc</div><div class="s">Abrindo&hellip;</div><div class="b"><i></i></div></div><div class="r">Desenvolvido por Otavio Martins</div></body></html>`;

function criarSplash() {
  splash = new BrowserWindow({
    width: 340, height: 210, frame: false, resizable: false, maximizable: false, center: true,
    show: true, title: "Abrindo DigiDoc", backgroundColor: "#1d1f2b",
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.removeMenu();
  splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(SPLASH_HTML));
  splash.on("closed", () => { splash = null; });
}

function criarJanela() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 640,
    show: false, // so aparece quando ja estiver pintada (nada de tela branca)
    backgroundColor: cfg.tema === "escuro" ? "#1e1f22" : "#f4f5f7",
    title: "DigiDoc",
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true, nodeIntegration: false,
      webviewTag: true, // so pro cantinho (YouTube), travado em will-attach-webview
      backgroundThrottling: false, // continua trabalhando (importar, ler texto) com a janela atras de outra
    },
  });
  // cantinho: o <webview> so abre YouTube, isolado (sem preload/node, sandbox) e numa sessao em
  // memoria — nada fica gravado no PC quando o app fecha
  win.webContents.on("will-attach-webview", (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    const src = params.src || "";
    params.partition = ehJogoLocal(src) ? PARTICAO_JOGOS : PARTICAO_CANTINHO;
    if (!SITE_CANTINHO.test(src) && !ehJogoLocal(src)) e.preventDefault();
  });
  // a janela perdeu o foco (Alt+Tab, clicou em outro programa): o cantinho se esconde
  win.on("blur", () => enviar("janela:blur"));
  // Esc / Ctrl+Shift+Espaco com o cantinho aberto: esconde, venha a tecla de onde vier (com o foco
  // dentro de um jogo/site a tecla pode chegar pela janela e nao pelo <webview>)
  win.webContents.on("before-input-event", (ev, input) => {
    if (!_cantinhoAberto || input.type !== "keyDown") return;
    if (input.key === "Escape" || (input.control && input.shift && input.code === "Space")) {
      ev.preventDefault();
      if (win.isFullScreen()) win.setFullScreen(false);
      enviar("cantinho:panico");
    }
  });
  win.removeMenu();
  let mostrou = false;
  const mostrar = () => {
    if (mostrou || !win || win.isDestroyed()) return;
    mostrou = true;
    win.show(); win.focus();
    if (splash && !splash.isDestroyed()) splash.destroy();
  };
  win.once("ready-to-show", mostrar);
  setTimeout(mostrar, 25000); // rede de seguranca: se a pintura travar, mostra mesmo assim
  // se a parte da tela travar/morrer, recarrega em vez de ficar branca — mas sem loop infinito
  const quedas = [];
  win.webContents.on("render-process-gone", (_e, d) => {
    if (d.reason === "clean-exit" || !win || win.isDestroyed()) return;
    const agora = Date.now();
    while (quedas.length && agora - quedas[0] > 60000) quedas.shift();
    quedas.push(agora);
    if (quedas.length <= 2) { try { win.reload(); } catch {} return; }
    // caiu 3x em 1 minuto: liga o modo compatibilidade neste PC e reabre (uma vez so)
    if (!cfg.semAceleracao) { cfg.semAceleracao = true; gravarCompatDestePC(true); app.relaunch(); app.exit(0); return; }
    dialog.showMessageBoxSync({
      type: "error", title: "DigiDoc", buttons: ["Fechar"],
      message: "A tela do DigiDoc parou de funcionar várias vezes seguidas.",
      detail: "Feche outros programas e abra o DigiDoc de novo. Se continuar, reinicie o PC.",
    });
    app.quit();
  });
  win.on("closed", () => { win = null; });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

// ---- cantinho (escondido): sites e jogos num <webview> isolado (processo separado, sandbox) ----
const PARTICAO_CANTINHO = "cantinho";              // sites: so na memoria (nada fica gravado ao fechar)
const PARTICAO_JOGOS = "persist:cantinho-jogos";   // jogos offline: guarda so o progresso dos jogos
// cantinho-jogos://jogos/2048/index.html -> assets/cantinho-jogos/2048/index.html
// (o "host" e sempre "jogos": um host so de numeros, como 2048, vira endereco IP no navegador)
const ESQUEMA_JOGOS = "cantinho-jogos";
const SITE_CANTINHO = /^https:\/\//i;
const ehJogoLocal = (u) => String(u || "").startsWith(ESQUEMA_JOGOS + "://");
// o esquema dos jogos precisa ser registrado ANTES do app ficar pronto
require("electron").protocol.registerSchemesAsPrivileged([
  { scheme: ESQUEMA_JOGOS, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
const TIPOS_ARQ = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".eot": "application/vnd.ms-fontobject" };
function registrarJogosLocais() {
  const { session } = require("electron");
  const raiz = path.join(__dirname, "..", "..", "assets", "cantinho-jogos");
  session.fromPartition(PARTICAO_JOGOS).protocol.handle(ESQUEMA_JOGOS, async (req) => {
    try {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "").replace(/\/$/, "/index.html");
      const arq = path.join(raiz, rel);
      if (!dentroDe(arq, raiz)) return new Response("negado", { status: 403 });
      const dados = await fs.promises.readFile(arq); // fs do Electron: le de dentro do app.asar
      return new Response(dados, { headers: { "content-type": TIPOS_ARQ[path.extname(arq).toLowerCase()] || "application/octet-stream" } });
    } catch { return new Response("nao achei", { status: 404 }); }
  });
}
app.on("web-contents-created", (_e, wc) => {
  if (wc.getType() !== "webview") return;
  // link que abriria janela/aba nova: abre no proprio cantinho (janela nova seria visivel)
  wc.setWindowOpenHandler(({ url }) => { if (SITE_CANTINHO.test(url)) setImmediate(() => { try { wc.loadURL(url); } catch {} }); return { action: "deny" }; });
  wc.on("will-navigate", (ev, url) => { if (!SITE_CANTINHO.test(url) && !ehJogoLocal(url)) ev.preventDefault(); });
  // Esc / Ctrl+Shift+Espaco com o foco DENTRO do video tambem escondem na hora
  wc.on("before-input-event", (ev, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "Escape" || (input.control && input.shift && input.code === "Space")) {
      ev.preventDefault();
      if (win && !win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false);
      enviar("cantinho:panico");
    }
  });
});
ipcMain.handle("janela:sairTelaCheia", () => { if (win && !win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false); return true; });

// "canto de fuga": com o cantinho aberto, levar o mouse ate o canto escolhido da tela esconde tudo
// (funciona mesmo com o mouse em cima do video, porque olha a posicao do cursor na tela)
let _timerCanto = null, _cantoFuga = "off";
function vigiarCanto(ligar, canto) {
  clearInterval(_timerCanto); _timerCanto = null; _cantoFuga = canto || "off";
  if (!ligar || _cantoFuga === "off") return;
  const { screen } = require("electron");
  _timerCanto = setInterval(() => {
    try {
      const p = screen.getCursorScreenPoint(), b = screen.getDisplayNearestPoint(p).bounds, m = 4;
      const esq = p.x <= b.x + m, dir = p.x >= b.x + b.width - 1 - m, cima = p.y <= b.y + m, baixo = p.y >= b.y + b.height - 1 - m;
      const ok = { "inf-esq": esq && baixo, "inf-dir": dir && baixo, "sup-esq": esq && cima, "sup-dir": dir && cima }[_cantoFuga];
      if (ok) { if (win && !win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false); enviar("cantinho:panico"); }
    } catch {}
  }, 120);
}
let _cantinhoAberto = false;
ipcMain.handle("cantinho:estado", (_e, { aberto, canto } = {}) => { _cantinhoAberto = !!aberto; vigiarCanto(!!aberto, canto); return true; });
// apagar o progresso salvo dos jogos (o unico rastro que o cantinho deixa no PC)
ipcMain.handle("cantinho:apagarJogos", async () => {
  try { await require("electron").session.fromPartition(PARTICAO_JOGOS).clearStorageData(); return true; } catch { return false; }
});

app.whenReady().then(async () => {
  if (!temInstancia) return;
  // o YouTube recusa/limita navegador com "Electron" no nome: usa o mesmo do Chrome
  try {
    const { session } = require("electron");
    const s = session.fromPartition(PARTICAO_CANTINHO);
    s.setUserAgent(s.getUserAgent().replace(/\s*Electron\/\S+/i, "").replace(/\s*(digitalizador|DigiDoc)\/\S+/gi, ""));
    s.setPermissionRequestHandler((_wc, perm, ok) => ok(perm === "fullscreen")); // nada de camera/microfone/localizacao
    require("electron").session.fromPartition(PARTICAO_JOGOS).setPermissionRequestHandler((_wc, perm, ok) => ok(perm === "fullscreen"));
    registrarJogosLocais();
  } catch {}
  if (PEDIU_DESINSTALAR) {
    // so a pergunta de desinstalar, sem abrir o app
    let ok = false;
    try { ok = await desinstalarPelaLinhaDeComando(null); } catch {}
    if (!ok) app.quit();
    return;
  }
  criarSplash();
  criarJanela();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  // so encerra o que chegou a ser carregado (nao carrega tesseract so pra fechar)
  try { if (_mods.orientacao) _mods.orientacao.encerrar(); } catch {}
  try { if (_mods.classificar) _mods.classificar.encerrar(); } catch {}
  try { if (_mods.servidorCelular) _mods.servidorCelular.parar(); } catch {}
});

function enviar(canal, dado) { if (win && !win.isDestroyed()) win.webContents.send(canal, dado); }

// ---------------- IPC ----------------
// troca o conteudo da config sem trocar o OBJETO: quem esta no meio de algo (uma busca de
// scanner, por exemplo) continua gravando na config certa
function trocarCfg(novo) {
  for (const k of Object.keys(cfg)) delete cfg[k];
  Object.assign(cfg, novo);
}

ipcMain.handle("config:get", () => cfg);
ipcMain.handle("config:save", (_e, novo) => {
  if (!!novo.semAceleracao !== compatDestePC()) gravarCompatDestePC(novo.semAceleracao);
  // qual scanner cada PC usa e o que cada aparelho tem sao do processo principal (a copia da
  // tela pode estar desatualizada): a escolha e feita pelo "scanner:escolher"
  if (novo.scanner && cfg.scanner) {
    scanner.migrarEscolhaAntiga(cfg); // escolha de config antiga ja vai pro lugar novo antes
    novo.scanner.capacidades = cfg.scanner.capacidades || {};
    novo.scanner.porPC = cfg.scanner.porPC || {};
    novo.scanner.driver = cfg.scanner.driver;
    novo.scanner.dispositivo = cfg.scanner.dispositivo;
    delete novo.scanner.aparelho; delete novo.scanner.ultimoAuto;
  }
  trocarCfg(novo); config.salvar(cfg); return true;
});
// "Restaurar padrao": so DEVOLVE os valores padrao pra tela mostrar; nada muda ate clicar em
// "Salvar configuracoes" (antes salvava na hora, mesmo clicando Cancelar)
ipcMain.handle("config:padrao", () => {
  const p = config.padraoResolvido();
  // o scanner de cada PC e o que cada aparelho tem nao sao "preferencias": continuam
  if (cfg.scanner) { p.scanner.porPC = cfg.scanner.porPC || {}; p.scanner.capacidades = cfg.scanner.capacidades || {}; }
  p.semAceleracao = compatDestePC();
  return p;
});
ipcMain.handle("config:path", () => config.CONFIG_PATH);
ipcMain.handle("app:reiniciar", () => { app.relaunch(); app.exit(0); });

// a pasta escolhida pra salvar esta conectada? (async: rede fora do ar nao trava o app)
ipcMain.handle("pasta:status", async () => {
  const configurada = cfg.pastaSaida;
  let ok = true;
  try { await fs.promises.access(path.parse(configurada).root); } catch { ok = false; }
  return { ok, configurada, usando: ok ? configurada : config.pastaSaidaPadrao() };
});

ipcMain.handle("associados:list", () => files.listaAssociados(cfgSaida()));
ipcMain.handle("associado:docs", (_e, nome) => files.docsDoAssociado(cfgSaida(), nome));
ipcMain.handle("associado:pasta", (_e, nome) => {
  try { return files.pastaAssociado(cfgSaida(), nome, false); } catch { return ""; }
});

ipcMain.handle("nome:arquivo", (_e, args) => files.montaNomeArquivo(cfg, args));

// processa e adiciona paginas a partir de caminhos de arquivo (importar/scanner/iphone)
ipcMain.handle("paginas:addArquivos", async (_e, { caminhos, colorido, ehFoto }) => {
  const res = [];
  for (const c of caminhos) {
    try {
      const buf = fs.readFileSync(c);
      const r = await registrarPagina(buf, { colorido, ehFoto });
      res.push(r);
      enviar("progresso", { tipo: "pagina", feito: res.length, total: caminhos.length });
    } catch (e) {
      res.push({ erro: e.message, arquivo: path.basename(c) });
    }
  }
  return res;
});

// paginas que vem como bytes (paginas de um PDF importado, desenhadas na tela).
// semAjustes: pagina de um PDF que o proprio DigiDoc ja salvou (reabrir pra editar) — entra como
// esta, sem tratar de novo, e mantem a cor se tiver
ipcMain.handle("paginas:addBuffer", async (_e, { bytes, colorido, semAjustes } = {}) => {
  try {
    if (!bytes || !bytes.byteLength) return { erro: "vazio" };
    const buf = Buffer.from(bytes);
    if (!semAjustes) return await registrarPagina(buf, { colorido: !!colorido, ehFoto: false });
    const id = "p" + ++seq;
    const opts = { colorido: await pipeline.temCor(buf), ehFoto: false, giroFixo: 0, recorte: null, semAjustes: true };
    const r = await pipeline.processarPagina(buf, opcoesPipeline(opts));
    const p = { original: buf, opts, processado: r.buffer, meta: { w: r.width, h: r.height, giro: 0, incerto: false, digital: await digitalSegura(r.buffer) } };
    paginas.set(id, p);
    return resumoPagina(id, p, await pipeline.miniatura(r.buffer, cfg.tamanhoMiniatura));
  } catch (e) { return { erro: e.message }; }
});

// ---- reconhecer o tipo do documento (le o texto da pagina) ----
ipcMain.handle("pagina:classificar", async (_e, { id } = {}) => {
  const p = paginas.get(id);
  if (!p) return { erro: "sumiu" };
  try {
    if (!classificador.disponivel()) return { erro: "Falta o leitor de texto em português (por.traineddata)." };
    const r = await classificador.classificar(p.processado, cfg.tipos || [], { ehFoto: !!p.opts.ehFoto, reconhecimento: cfg.reconhecimento || {} });
    p.meta.textoOCR = r.texto || ""; // guardado so na memoria, pra aprender se a pessoa corrigir
    delete r.texto;
    return r;
  } catch (e) { return { erro: e.message }; }
});
// a pessoa corrigiu o tipo que o DigiDoc tinha marcado: aprende com o texto daquela pagina
ipcMain.handle("tipo:aprender", (_e, { id, sigla } = {}) => {
  const p = paginas.get(id) || lixeira.get(id);
  if (p && p.meta.textoOCR && sigla) { try { classificador.aprender(p.meta.textoOCR, sigla); } catch {} }
  return true;
});
// lista pra tela de Configuracoes > Reconhecimento (tipos/regra podem vir da tela, ainda nao salvos)
ipcMain.handle("reconhecimento:familias", (_e, { tipos, reconhecimento } = {}) => {
  try { return classificador.familias(tipos || cfg.tipos || [], reconhecimento || cfg.reconhecimento || {}); } catch { return []; }
});
ipcMain.handle("tipo:esquecer", () => { try { classificador.esquecerAprendizado(); } catch {} return true; });

// texto copiado (botao "Colar" do nome do associado)
ipcMain.handle("clipboard:texto", () => { try { return clipboard.readText() || ""; } catch { return ""; } });
ipcMain.handle("clipboard:copiar", (_e, t) => { try { clipboard.writeText(String(t || "")); return true; } catch { return false; } });

// le um PDF escolhido/arrastado pra tela desenhar as paginas (so .pdf, ate 300 MB)
ipcMain.handle("arquivo:lerPdf", async (_e, caminho) => {
  try {
    if (typeof caminho !== "string" || !/\.pdf$/i.test(caminho)) return { erro: "Não é um PDF." };
    const st = await fs.promises.stat(caminho);
    if (st.size > 300 * 1024 * 1024) return { erro: "PDF grande demais (mais de 300 MB)." };
    return { bytes: await fs.promises.readFile(caminho), nome: path.basename(caminho) };
  } catch (e) { return { erro: e.message }; }
});

ipcMain.handle("pagina:girar", async (_e, { id, graus }) => {
  const p = paginas.get(id);
  if (!p) return null;
  const g = ((graus % 360) + 360) % 360;
  p.opts.giroFixo = (((p.opts.giroFixo || 0) + g) % 360 + 360) % 360;
  p.opts.recorte = girarRetangulo(p.opts.recorte, g);
  p.meta.incerto = false; // a pessoa ja conferiu o lado
  return reprocessar(id);
});

// "ja conferi, esta certo": tira o aviso de lado incerto sem girar
ipcMain.handle("pagina:confirmarLado", (_e, ids) => {
  for (const id of ids || []) { const p = paginas.get(id); if (p) p.meta.incerto = false; }
  return true;
});

// junta varias paginas numa so (RG frente e verso numa folha A4). A nova pagina entra no lugar;
// as originais vao pra lixeira (o Desfazer traz de volta)
ipcMain.handle("paginas:juntar", async (_e, { ids } = {}) => {
  try {
    const ps = (ids || []).map((id) => paginas.get(id)).filter(Boolean);
    if (ps.length < 2) return { erro: "Marque pelo menos 2 páginas." };
    const colorido = ps.some((p) => p.opts.colorido);
    const original = await pipeline.juntarPaginas(ps.map((p) => p.processado), { dpi: cfg.scanner.resolucao || 200, colorido });
    const id = "p" + ++seq;
    const opts = { colorido, ehFoto: false, giroFixo: 0, recorte: null, semAjustes: true };
    const r = await pipeline.processarPagina(original, opcoesPipeline(opts));
    const p = { original, opts, processado: r.buffer, meta: { w: r.width, h: r.height, giro: 0, incerto: false, digital: await digitalSegura(r.buffer) } };
    paginas.set(id, p);
    for (const old of ids) { const q = paginas.get(old); if (q) { lixeira.set(old, q); paginas.delete(old); } }
    return resumoPagina(id, p, await pipeline.miniatura(r.buffer, cfg.tamanhoMiniatura));
  } catch (e) { return { erro: e.message }; }
});

// recorte manual. rect normalizado sobre a imagem que a tela mostra AGORA (ja recortada, se tiver);
// absoluto=true: rect ja e sobre a pagina inteira (usado pelo Desfazer); rect=null tira o recorte
ipcMain.handle("pagina:recortar", async (_e, { id, rect, absoluto } = {}) => {
  const p = paginas.get(id);
  if (!p) return null;
  const antes = p.opts.recorte ? Object.assign({}, p.opts.recorte) : null;
  if (!rect) p.opts.recorte = null;
  else {
    const lim = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    let r = { x: lim(rect.x), y: lim(rect.y), w: lim(rect.w), h: lim(rect.h) };
    if (!absoluto && antes) r = { x: antes.x + r.x * antes.w, y: antes.y + r.y * antes.h, w: r.w * antes.w, h: r.h * antes.h };
    p.opts.recorte = r.w > 0.02 && r.h > 0.02 ? r : antes;
  }
  const res = await reprocessar(id);
  return res && Object.assign(res, { recorteAntes: antes });
});

// colorido / cinza de uma pagina (o tipo "Foto 3x4" pede cor, por exemplo)
ipcMain.handle("pagina:cor", async (_e, { id, colorido }) => {
  const p = paginas.get(id);
  if (!p) return null;
  if (!!p.opts.colorido === !!colorido) return resumoPagina(id, p, await pipeline.miniatura(p.processado, cfg.tamanhoMiniatura));
  p.opts.colorido = !!colorido;
  const res = await reprocessar(id);
  // pediu cor mas a pagina veio do scanner em tons de cinza: avisa (nao tem cor pra mostrar)
  if (res && colorido && !(await pipeline.temCor(p.original))) res.semCor = true;
  return res;
});

// remover vai pra lixeira (o Desfazer traz de volta); purgar apaga de vez
ipcMain.handle("pagina:remover", (_e, id) => {
  const p = paginas.get(id);
  if (p) { lixeira.set(id, p); paginas.delete(id); }
  return true;
});
ipcMain.handle("paginas:restaurar", (_e, ids) => {
  let n = 0;
  for (const id of ids || []) { const p = lixeira.get(id); if (p) { paginas.set(id, p); lixeira.delete(id); n++; } }
  return n;
});
ipcMain.handle("lixeira:purgar", (_e, ids) => { for (const id of ids || []) lixeira.delete(id); return true; });
// limpar depois de salvar: some tudo da memoria (documento de associado nao fica guardado a toa)
ipcMain.handle("paginas:limpar", () => { paginas.clear(); lixeira.clear(); return true; });
// tira de vez so as paginas que foram salvas (as sem tipo, ou que chegaram durante o salvamento, ficam)
ipcMain.handle("paginas:descartar", (_e, ids) => { for (const id of ids || []) { paginas.delete(id); lixeira.delete(id); } return true; });

ipcMain.handle("pagina:previa", async (_e, { id, tamanho }) => {
  const p = paginas.get(id);
  if (!p) return null;
  return pipeline.miniatura(p.processado, tamanho || 700);
});

// ---- importar via dialog ----
ipcMain.handle("importar:dialog", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Escolher imagens ou PDFs (na ordem das paginas)",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Imagens e PDF", extensions: ["jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp", "heic", "pdf"] },
      { name: "Imagens", extensions: ["jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp", "heic"] },
      { name: "PDF", extensions: ["pdf"] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

// ---- colar imagem da area de transferencia ----
ipcMain.handle("importar:clipboard", async ({ }, { colorido } = {}) => {
  const img = clipboard.readImage();
  if (!img || img.isEmpty()) return { vazio: true };
  const png = img.toPNG();
  return registrarPagina(png, { colorido: !!colorido, ehFoto: false });
});

// ---- paginas de demonstracao (tutorial) ----
ipcMain.handle("demo:paginas", async (_e, { n } = {}) => {
  const res = [];
  try {
    const buf = fs.readFileSync(path.join(__dirname, "..", "..", "assets", "amostra.jpg"));
    for (let i = 0; i < (n || 3); i++) {
      const r = await registrarPagina(buf, { colorido: false });
      if (!r.branca) res.push(r);
    }
  } catch {}
  return res;
});

// ---- scanner ----
// o que o app descobre sozinho (qual aparelho, o que ele tem) fica salvo e a tela e avisada
function salvarScanner() {
  try { config.salvar(cfg); } catch {}
  enviar("scanner:mudou", scanner.info(cfg));
}
const avisarScan = (msg) => enviar("progresso", { tipo: "scan", msg });

// resumo pro rodape (na hora, do que ja se sabe) e, se faltar algo, descobre em segundo plano
let _infoPedida = false;
ipcMain.handle("scanner:info", () => {
  if (!_infoPedida) { _infoPedida = true; setTimeout(() => scanner.atualizarEmSegundoPlano(() => cfg, salvarScanner), 3000); }
  return scanner.info(cfg);
});

// token: a tela ignora aparelhos que chegam de uma busca anterior
ipcMain.handle("scanner:listar", async (_e, { driver, token } = {}) => {
  const r = await scanner.listar(cfg, (ap) => enviar("scanner:achado", Object.assign({ token }, ap)), driver);
  salvarScanner();
  return Object.assign({ token }, r);
});

// escolha do seletor: um aparelho, ou null = automatico (o app procura de novo)
ipcMain.handle("scanner:escolher", (_e, ap) => {
  const i = scanner.escolher(cfg, ap || null);
  salvarScanner();
  return i;
});

ipcMain.handle("scanner:detectar", async () => {
  const r = await scanner.detectarAgora(cfg, avisarScan);
  salvarScanner();
  return r;
});

ipcMain.handle("scanner:planejar", async (_e, { origem } = {}) => {
  const r = await scanner.planejar(cfg, origem, avisarScan);
  salvarScanner();
  return r;
});

ipcMain.handle("scanner:cancelar", () => scanner.cancelar());

ipcMain.handle("scanner:temMotor", () => !!scanner.temNaps2(cfg));

// baixa o NAPS2 portatil e extrai ao lado do app (pendrive)
ipcMain.handle("scanner:instalar", async () => {
  const URL = "https://github.com/cyanfish/naps2/releases/download/v8.5.1/naps2-8.5.1-win-x64.zip";
  try {
    const destDir = path.join(config.baseDir(), "naps2");
    const zip = path.join(os.tmpdir(), "naps2-portable.zip");
    enviar("progresso", { tipo: "scan", msg: "Baixando o motor do scanner…" });
    await baixarArquivo(URL, zip);
    fs.mkdirSync(destDir, { recursive: true });
    enviar("progresso", { tipo: "scan", msg: "Instalando…" });
    await extrairZip(zip, destDir);
    const exe = acharConsoleRecursivo(destDir);
    if (!exe) return { ok: false, msg: "Baixei o pacote mas não encontrei o NAPS2.Console.exe dentro." };
    cfg.scanner.caminhoNaps2 = exe; config.salvar(cfg);
    try { fs.rmSync(zip, { force: true }); } catch {}
    return { ok: true, caminho: exe };
  } catch (e) {
    return {
      ok: false,
      msg: "Não consegui baixar automaticamente (" + e.message + ").",
      instrucoes: "Sem internet? Baixe 'naps2-8.5.1-win-x64.zip' em naps2.com/download, extraia e coloque a pasta ao lado do programa com o nome 'naps2'.",
    };
  }
});

function baixarArquivo(url, dest, prof = 0) {
  return new Promise((resolve, reject) => {
    if (prof > 6) return reject(new Error("muitos redirecionamentos"));
    require("https").get(url, { headers: { "User-Agent": "Digitalizador" } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) { r.resume(); return baixarArquivo(r.headers.location, dest, prof + 1).then(resolve, reject); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error("HTTP " + r.statusCode)); }
      const f = fs.createWriteStream(dest);
      r.pipe(f);
      f.on("finish", () => f.close(() => resolve()));
      f.on("error", reject);
    }).on("error", reject);
  });
}

function extrairZip(zip, dest) {
  return new Promise((resolve, reject) => {
    require("child_process").execFile("powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${dest}" -Force`],
      { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}

function acharConsoleRecursivo(dir) {
  let achado = null;
  (function walk(d) {
    if (achado) return;
    let itens = [];
    try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      if (achado) return;
      const full = path.join(d, it.name);
      if (it.isDirectory()) walk(full);
      else if (it.name.toLowerCase() === "naps2.console.exe") achado = full;
    }
  })(dir);
  return achado;
}

// origem: "auto" | "alimentador" | "vidro"; plano: o que veio do scanner:planejar (opcional)
ipcMain.handle("scanner:escanear", async (_e, { origem, plano, colorido } = {}) => {
  const adicionados = [];
  let brancas = 0;
  const r = await scanner.escanear(cfg, { origem, plano }, avisarScan);
  salvarScanner(); // pode ter aprendido algo do aparelho (ex.: nao tem alimentador)
  if (!r.ok) return { ok: false, erro: r.erro, msg: r.msg || scanner.mensagem(r.erro), escolher: !!r.escolher };
  enviar("progresso", { tipo: "pagina", feito: 0, total: r.arquivos.length }); // o scanner terminou: agora e so processar
  for (const f of r.arquivos) {
    try {
      const buf = fs.readFileSync(f);
      const reg = await registrarPagina(buf, { colorido });
      if (reg.branca) { brancas++; continue; }
      adicionados.push(reg);
      enviar("progresso", { tipo: "pagina", feito: adicionados.length + brancas, total: r.arquivos.length });
    } catch {}
  }
  try { fs.rmSync(r.dir, { recursive: true, force: true }); } catch {}
  return {
    ok: true, paginas: adicionados, brancas, lidas: r.arquivos.length,
    fonte: r.fonte, motivo: r.motivo, origemCerta: r.origemCerta !== false,
    aviso: r.aviso ? scanner.mensagem(r.aviso) : null,
  };
});

// ---- salvar PDF ----
// modo "dossie": tudo num PDF. modo "documentos": grupos [{tipoSigla, ids:[...]}]
// nome de arquivo vindo da tela (editar documento reaberto): so o nome, sem pasta, terminando em .pdf
const nomeArquivoSeguro = (n) => {
  const b = path.win32.basename(String(n || ""));
  return /^[^<>:"\/\\|?*\x00-\x1f]+\.pdf$/i.test(b) && !b.startsWith(".") ? b : null;
};

ipcMain.handle("salvar:dossie", async (_e, { nomeAssociado, ids, nivel, substituir, nomeArquivo }) => {
  try {
    const dir = files.pastaAssociado(cfgSaida(), nomeAssociado, true);
    const reaberto = substituir ? nomeArquivoSeguro(nomeArquivo) : null; // editando o PDF reaberto: grava por cima dele
    const nomeArq = reaberto || files.montaNomeArquivo(cfg, { nomeAssociado, tipoSigla: cfg.siglaDossie, incluirNome: false });
    const r = await salvarPDFs(dir, [{ nome: nomeArq, ids, substituir: !!reaberto }], nivel || cfg.compressaoPadraoDossie);
    registrarHistorico(nomeAssociado, "dossie", r);
    return r;
  } catch (e) {
    return { ok: false, msg: e.message };
  }
});

ipcMain.handle("salvar:documentos", async (_e, { nomeAssociado, grupos, nivel, substituir }) => {
  try {
    const dir = files.pastaAssociado(cfgSaida(), nomeAssociado, true);
    const lista = grupos.map((g) => ({
      // so o grupo que veio de um PDF reaberto grava por cima dele; documento novo segue a regra normal
      nome: (substituir && nomeArquivoSeguro(g.nomeArquivo)) || files.montaNomeArquivo(cfg, { nomeAssociado, tipoSigla: g.tipoSigla, incluirNome: false }),
      substituir: !!(substituir && nomeArquivoSeguro(g.nomeArquivo)),
      ids: g.ids, colorido: g.colorido,
    }));
    const r = await salvarPDFs(dir, lista, nivel || cfg.compressaoPadraoDocumento);
    registrarHistorico(nomeAssociado, "documentos", r);
    return r;
  } catch (e) {
    return { ok: false, msg: e.message };
  }
});

// ---- historico de salvamentos (deste PC, fica no perfil do Windows) ----
// so nomes e caminhos (o mesmo que ja esta nas pastas) — nenhuma imagem de documento
const HISTORICO = path.join(app.getPath("userData"), "historico.json");
const MAX_HISTORICO = 300;
function lerHistorico() {
  try { const h = JSON.parse(fs.readFileSync(HISTORICO, "utf8")); return Array.isArray(h) ? h : []; } catch { return []; }
}
function registrarHistorico(associado, modoSalvo, r) {
  try {
    if (!r || !r.ok) return;
    estatisticas.invalidar();
    const arquivos = (r.salvos || []).filter((s) => s.caminho && !s.erro && !s.cancelado)
      .map((s) => ({ nome: s.nome, caminho: s.caminho, bytes: s.bytes || 0, paginas: s.paginas || 0 }));
    if (!arquivos.length) return;
    anotarNaConferencia(associado);
    const h = lerHistorico();
    h.unshift({ quando: new Date().toISOString(), associado: String(associado || "").trim(), modo: modoSalvo, pasta: r.pasta || "", arquivos });
    fs.mkdirSync(path.dirname(HISTORICO), { recursive: true });
    fs.writeFileSync(HISTORICO, JSON.stringify(h.slice(0, MAX_HISTORICO)), "utf8");
    enviar("historico:mudou", resumoHoje(h));
  } catch {}
}

// ---- lista de conferencia (so nomes/codigos de quem foi digitalizado, num TXT organizado por data) ----
const pastaConferencia = () => (cfg.conferencia && cfg.conferencia.pasta) || path.join(app.getPath("documents"), "DigiDoc - Conferencia");
function anotarNaConferencia(associado) {
  if (cfg.conferencia && cfg.conferencia.ativo === false) return;
  try { conferencia.registrar(pastaConferencia(), associado); }
  catch (e) { enviar("aviso", `Não consegui anotar na lista de conferência (${e.message}). A pasta da lista está acessível?`); }
}
ipcMain.handle("conferencia:info", () => {
  try { return Object.assign(conferencia.resumo(pastaConferencia()), { ativo: !(cfg.conferencia && cfg.conferencia.ativo === false), nuvens: conferencia.nuvens(), padrao: path.join(app.getPath("documents"), "DigiDoc - Conferencia") }); }
  catch (e) { return { erro: e.message, nuvens: [] }; }
});
// trocar a pasta da lista: leva junto a lista que ja existe (se a pasta nova ainda nao tem uma)
function levarLista(de, para) {
  try {
    if (!de || !para || path.resolve(de) === path.resolve(para)) return;
    fs.mkdirSync(para, { recursive: true });
    for (const n of [conferencia.NOME_TXT, conferencia.NOME_TXT.replace(".txt", " (dados).json")]) {
      const a = path.join(de, n), b = path.join(para, n);
      if (fs.existsSync(a) && !fs.existsSync(b)) fs.copyFileSync(a, b);
    }
  } catch {}
}
ipcMain.handle("conferencia:escolherPasta", async (_e, sugerida) => {
  let destino = sugerida;
  if (!destino) {
    const r = await dialog.showOpenDialog(win, { title: "Pasta da lista de conferência", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    destino = r.filePaths[0];
  }
  levarLista(pastaConferencia(), destino);
  return destino;
});
ipcMain.handle("conferencia:abrir", (_e, pasta) => {
  try {
    const p = pasta || pastaConferencia();
    const txt = path.join(p, conferencia.NOME_TXT);
    if (!fs.existsSync(txt)) conferencia.importar(p, []); // cria a lista (vazia) pra abrir
    shell.openPath(txt);
    return true;
  } catch (e) { return false; }
});
// escolher pastas ja digitalizadas (a principal ou as de letra) e ver o que vai entrar
ipcMain.handle("conferencia:escanear", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Escolha a pasta dos digitalizados (a principal ou as das letras, ex.: Digitalizados A)",
    defaultPath: cfgSaida().pastaSaida, properties: ["openDirectory", "multiSelections"],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return { pastas: r.filePaths, achados: conferencia.escanear(r.filePaths) };
});
ipcMain.handle("conferencia:importar", (_e, { achados, pasta } = {}) => {
  try { return Object.assign(conferencia.importar(pasta || pastaConferencia(), achados || []), { ok: true }); }
  catch (e) { return { ok: false, msg: e.message }; }
});
function resumoHoje(h) {
  const hoje = new Date().toDateString();
  const doDia = h.filter((e) => new Date(e.quando).toDateString() === hoje);
  return {
    associados: new Set(doDia.map((e) => e.associado.toLowerCase())).size,
    pdfs: doDia.reduce((n, e) => n + e.arquivos.length, 0),
    paginas: doDia.reduce((n, e) => n + e.arquivos.reduce((m, a) => m + (a.paginas || 0), 0), 0),
  };
}

// ---- painel de producao (conta na pasta dos documentos) ----
ipcMain.handle("estatisticas:obter", async (_e, { forcar } = {}) => {
  try {
    const e = await estatisticas.obter(cfgSaida(), !!forcar);
    return Object.assign({}, e, { estePC: resumoHoje(lerHistorico()), meta: Number(cfg.metaDia) || 0 });
  } catch (err) { return { erro: err.message }; }
});
ipcMain.handle("estatisticas:resumo", async () => {
  try {
    const e = await estatisticas.obter(cfgSaida(), false);
    return Object.assign(estatisticas.resumo(e), { estePC: resumoHoje(lerHistorico()), meta: Number(cfg.metaDia) || 0 });
  } catch (err) { return { erro: err.message }; }
});
// abre a pasta de um associado listado no painel (so pastas dentro da pasta dos documentos)
ipcMain.handle("estatisticas:abrirPasta", (_e, caminho) => {
  const base = cfgSaida().pastaSaida;
  if (typeof caminho !== "string" || !dentroDe(path.resolve(caminho), path.resolve(base)) || !fs.existsSync(caminho)) return false;
  shell.openPath(caminho);
  return true;
});
ipcMain.handle("estatisticas:exportar", async () => {
  try {
    const e = await estatisticas.obter(cfgSaida(), true);
    const r = await dialog.showSaveDialog(win, {
      title: "Salvar relatório (abre no Excel)",
      defaultPath: path.join(app.getPath("documents"), `DigiDoc-relatorio-${estatisticas.diaLocal(Date.now())}.csv`),
      filters: [{ name: "Planilha CSV (Excel)", extensions: ["csv"] }],
    });
    if (r.canceled || !r.filePath) return { cancelado: true };
    fs.writeFileSync(r.filePath, estatisticas.csv(e), "utf8");
    shell.showItemInFolder(r.filePath);
    return { ok: true, caminho: r.filePath };
  } catch (err) { return { ok: false, msg: err.message }; }
});

// ---- atualizacao automatica (GitHub) ----
ipcMain.handle("atualizacao:procurar", () => atualizar.procurar(app.getVersion()));
ipcMain.handle("atualizacao:aplicar", async () => {
  if (!app.isPackaged) return { ok: false, msg: "Modo desenvolvimento: não dá pra atualizar a si mesmo." };
  try {
    const baseDir = config.baseDir();
    const aplicar = await atualizar.preparar({
      baseDir, exe: process.execPath, manifesto: MANIFESTO,
      podeInstalador: !ehCopiaDoPendrive(baseDir), // no pendrive, so a atualizacao leve
    }, (etapa, feito, total) => enviar("progresso", { tipo: "atualizacao", etapa, feito, total }));
    aplicar();
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  } catch (e) { return { ok: false, msg: e.message }; }
});
ipcMain.handle("atualizacao:pagina", () => { if (atualizar.URL_PAGINA) shell.openExternal(atualizar.URL_PAGINA); return !!atualizar.URL_PAGINA; });
// a ultima atualizacao falhou no meio? (o .bat deixa um aviso na pasta do programa)
ipcMain.handle("atualizacao:falhou", () => fs.existsSync(path.join(config.baseDir(), "digidoc-atualizacao-falhou.txt")));
ipcMain.handle("historico:listar", () => {
  const h = lerHistorico();
  return { itens: h.slice(0, 150).map((e) => Object.assign({}, e, { arquivos: e.arquivos.map((a) => Object.assign({}, a, { existe: fs.existsSync(a.caminho) })) })), hoje: resumoHoje(h) };
});
ipcMain.handle("historico:limpar", () => { try { fs.rmSync(HISTORICO, { force: true }); } catch {} return resumoHoje([]); });
// so abre o que esta no historico (a tela nao abre caminho qualquer)
ipcMain.handle("historico:abrir", (_e, caminho) => {
  const ok = lerHistorico().some((e) => e.pasta === caminho || e.arquivos.some((a) => a.caminho === caminho));
  if (!ok || !fs.existsSync(caminho)) return false;
  shell.openPath(caminho);
  return true;
});
ipcMain.handle("historico:mostrarNaPasta", (_e, caminho) => {
  const ok = lerHistorico().some((e) => e.arquivos.some((a) => a.caminho === caminho));
  if (ok && fs.existsSync(caminho)) { shell.showItemInFolder(caminho); return true; }
  return false;
});

// abre um PDF ja salvo na pasta do associado (os chips "✓ RG.pdf" do topo)
ipcMain.handle("associado:abrirDoc", (_e, { nome, arquivo } = {}) => {
  try {
    const dir = files.pastaAssociado(cfgSaida(), nome, false);
    const alvo = path.join(dir, path.basename(String(arquivo || "")));
    if (!/\.pdf$/i.test(alvo) || !fs.existsSync(alvo)) return false;
    shell.openPath(alvo);
    return true;
  } catch { return false; }
});

ipcMain.handle("app:versao", () => app.getVersion());

// ---- fila de associados (lista de nomes pra ir fazendo um por um) — deste PC ----
const FILA = path.join(app.getPath("userData"), "fila.json");
ipcMain.handle("fila:obter", () => {
  try { const f = JSON.parse(fs.readFileSync(FILA, "utf8")); return { itens: Array.isArray(f.itens) ? f.itens : [], auto: f.auto !== false }; }
  catch { return { itens: [], auto: true }; }
});
ipcMain.handle("fila:salvar", (_e, f) => {
  try {
    fs.mkdirSync(path.dirname(FILA), { recursive: true });
    const itens = (f && Array.isArray(f.itens) ? f.itens : []).slice(0, 5000)
      .map((i) => ({ nome: String(i.nome || "").trim().slice(0, 120), feito: !!i.feito })).filter((i) => i.nome);
    fs.writeFileSync(FILA, JSON.stringify({ itens, auto: !(f && f.auto === false) }), "utf8");
    return true;
  } catch { return false; }
});
// le nomes de um .txt/.csv (1a coluna; separador ; , ou tab). Ignora linha de cabecalho "nome".
ipcMain.handle("fila:importar", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Lista de associados (um nome por linha)", properties: ["openFile"],
    filters: [{ name: "Texto ou planilha CSV", extensions: ["txt", "csv"] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  let txt = fs.readFileSync(r.filePaths[0]);
  // Excel salva CSV em ANSI (latin1) no Windows; se nao for UTF-8 valido, le como latin1
  let s = txt.toString("utf8");
  if (s.includes("�")) s = txt.toString("latin1");
  return s.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.split(/[;\t,]/)[0].replace(/^"|"$/g, "").trim())
    .filter((n, i) => n && !(i === 0 && /^nome/i.test(n)));
});

// copia o PDF salvo pra pasta de backup, espelhando Letra\Nome\arquivo.pdf
function fazerBackup(caminho) {
  const bk = cfg.aposSalvar.pastaBackup;
  if (!bk || !caminho) return;
  try {
    const rel = path.relative(cfgSaida().pastaSaida, caminho);
    const destino = rel.startsWith("..") || path.isAbsolute(rel) ? path.join(bk, path.basename(caminho)) : path.join(bk, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    // copia pra um temporario e troca: um backup que ja existia nunca fica pela metade
    const tmp = destino + ".salvando";
    try { fs.copyFileSync(caminho, tmp); fs.renameSync(tmp, destino); }
    catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
  } catch (e) { enviar("progresso", { tipo: "scan", msg: "Aviso: falha no backup (" + e.message + ")" }); }
}

// item.substituir=true: grupo de um PDF reaberto pra editar (Recentes) — grava por cima do mesmo arquivo
async function salvarPDFs(dir, lista, nivel) {
  const maxBytes = cfg.tamanhoMaxMB * 1024 * 1024;
  const salvos = []; // cada um leva os ids das paginas: a tela so tira da lista o que foi salvo mesmo
  const gravadosAgora = new Set(); // dois grupos no mesmo salvamento nunca gravam o mesmo arquivo
  for (const item of lista) {
    const pgs = item.ids.map((id) => {
      const p = paginas.get(id);
      return p ? { buffer: p.processado, width: p.meta.w, height: p.meta.h, dpiOrigem: cfg.scanner.resolucao || 200 } : null;
    }).filter(Boolean);
    if (!pgs.length) continue;
    const ids = item.ids;

    let dest = files.resolveDestino(dir, item.nome, item.substituir ? "substituir" : cfg.seArquivoExiste);
    // ex.: 3 paginas "avulsas" viram DOC.pdf cada uma — com "Substituir" uma apagava a outra
    if (gravadosAgora.has(path.resolve(dest.caminho).toLowerCase())) dest = files.resolveDestino(dir, item.nome, "numerar");
    if (dest.perguntar) {
      const resp = dialog.showMessageBoxSync(win, {
        type: "question", buttons: ["Substituir", "Manter os dois (numerar)", "Cancelar"],
        defaultId: 1, cancelId: 2, title: "Arquivo ja existe",
        message: `Ja existe "${item.nome}" na pasta.`, detail: "O que deseja fazer?",
      });
      if (resp === 2) { salvos.push({ nome: item.nome, cancelado: true, ids }); continue; }
      if (resp === 1) {
        const d2 = files.resolveDestino(dir, item.nome, "numerar");
        dest.caminho = d2.caminho; dest.nome = d2.nome;
      }
    }
    gravadosAgora.add(path.resolve(dest.caminho).toLowerCase());
    try {
      const r = await pdf.gerarPDF(pgs, dest.caminho, {
        maxBytes, nivel, onProgresso: (p) => enviar("progresso", { tipo: "pdf", ...p, nome: dest.nome }),
      });
      fazerBackup(r.caminho);
      salvos.push({ nome: dest.nome, bytes: r.bytes, dpi: r.dpi, pb: r.pb, caminho: r.caminho, paginas: pgs.length, ids });
    } catch (e) {
      if (e.salvouAcimaDoLimite) { fazerBackup(e.caminho); salvos.push({ nome: dest.nome, bytes: e.bytes, caminho: e.caminho, aviso: e.message, paginas: pgs.length, ids }); }
      else salvos.push({ nome: item.nome, erro: e.message, ids });
    }
  }
  // acoes pos-salvar
  if (cfg.aposSalvar.abrirPasta && salvos.some((s) => s.caminho)) shell.openPath(dir);
  return { ok: true, salvos, pasta: dir, reserva: !saidaConectada() };
}

// ---- celular (iPhone) por Wi-Fi/QR ----
ipcMain.handle("celular:iniciar", async () => {
  try {
    const info = await servidorCelular.iniciar(async (buf) => {
      try {
        const reg = await registrarPagina(buf, { colorido: false, ehFoto: true });
        if (!reg.branca) enviar("celular:foto", reg);
      } catch {}
    });
    if (!info.url) return { ok: false, msg: "Não encontrei o IP da rede. O PC está conectado em alguma rede (cabo ou Wi-Fi)?" };
    const qr = await QRCode.toDataURL(info.url, { margin: 1, width: 320 });
    return { ok: true, url: info.url, ip: info.ip, porta: info.porta, qr };
  } catch (e) {
    const msg = e.code === "EADDRINUSE" ? "A porta está ocupada. Feche a janela do iPhone e abra de novo." : "Erro ao iniciar: " + e.message;
    return { ok: false, msg };
  }
});
ipcMain.handle("celular:parar", () => { if (_mods.servidorCelular) _mods.servidorCelular.parar(); return true; });

// ---- desinstalar o DigiDoc deste PC (de dentro do app) ----
// Seguranca: so apaga os arquivos listados no manifesto gerado no build (arquivos do
// PROGRAMA). Qualquer outra coisa na pasta (documentos, arquivos do usuario) fica.
const MANIFESTO = "digidoc-arquivos.txt";
const MARCA_INSTALADO = "digidoc-instalado.txt"; // gravado pelo "INSTALAR DigiDoc no PC.bat"

// tipo do disco: "removivel" (pendrive), "fixo" (HD/SSD do PC) ou "?" (nao deu pra saber).
// Assincrono e com folga no tempo: o PowerShell pode demorar pra abrir em PC lento.
let _tipoDisco = null;
function tipoDisco(dir) {
  if (_tipoDisco) return _tipoDisco;
  const letra = (path.parse(dir).root[0] || "").toUpperCase();
  if (!/^[A-Z]$/.test(letra)) return Promise.resolve("?");
  _tipoDisco = new Promise((ok) => {
    require("child_process").execFile("powershell",
      ["-NoProfile", "-Command", `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${letra}:'").DriveType`],
      { windowsHide: true, encoding: "utf8", timeout: 45000 }, (err, out) => {
        const t = String(out || "").trim();
        ok(err ? "?" : t === "2" ? "removivel" : t === "3" ? "fixo" : "?");
      });
  }).then((t) => { if (t === "?") _tipoDisco = null; return t; }); // "?" tenta de novo na proxima
  return _tipoDisco;
}

// a pasta do programa e a copia que mora no pendrive? (o instalador fica do lado dela)
function ehCopiaDoPendrive(dir) {
  const pai = path.dirname(dir);
  return ["DigiDoc-instalar.zip", "INSTALAR DigiDoc no PC.bat"].some((n) => fs.existsSync(path.join(pai, n)));
}

// Na duvida, NAO remove (falha fechada): so desinstala se tiver certeza de que e uma
// instalacao no PC — e nunca a copia do pendrive.
async function avaliarDesinstalacao() {
  const dir = config.baseDir();
  if (!config.empacotado()) return { dir, motivo: "dev" };
  if (!fs.existsSync(path.join(dir, "DigiDoc.exe"))) return { dir, motivo: "semExe" };
  if (ehCopiaDoPendrive(dir)) return { dir, motivo: "pendrive" };
  const tipo = await tipoDisco(dir);
  if (tipo === "removivel") return { dir, motivo: "pendrive" };
  const marcado = fs.existsSync(path.join(dir, MARCA_INSTALADO));
  if (!marcado && tipo !== "fixo") return { dir, motivo: "incerto" };
  return { dir, motivo: "" };
}

const dentroDe = (p, pasta) => { const r = path.relative(pasta, p); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };

ipcMain.handle("pc:infoDesinstalar", async () => {
  const { dir, motivo } = await avaliarDesinstalacao();
  const docs = cfgSaida().pastaSaida;
  return {
    dir, docs,
    dev: motivo === "dev",
    instalado: !motivo,
    removivel: motivo === "pendrive",
    incerto: motivo === "incerto" || motivo === "semExe",
    temDocs: fs.existsSync(docs),
    docsDentro: dentroDe(docs, dir),
  };
});

ipcMain.handle("pc:desinstalar", () => executarDesinstalacao());

// chave do "Aplicativos instalados" do Windows (criada pelo DigiDoc-Setup.exe)
const CHAVE_UNINSTALL = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DigiDoc";

// "DigiDoc.exe --desinstalar": chamado pelo Windows (Configuracoes > Aplicativos > Desinstalar)
const PEDIU_DESINSTALAR = process.argv.includes("--desinstalar");
async function desinstalarPelaLinhaDeComando(janela) {
  const info = await avaliarDesinstalacao();
  const docs = cfgSaida().pastaSaida;
  if (info.motivo) {
    const msg = info.motivo === "pendrive" ? "O DigiDoc está rodando do pendrive: não há nada instalado neste PC."
      : info.motivo === "dev" ? "Modo desenvolvimento: nada a desinstalar."
      : "Não consegui confirmar que esta cópia está instalada neste PC. Por segurança não removi nada.";
    await dialog.showMessageBox(janela || undefined, { type: "info", title: "DigiDoc", message: msg, buttons: ["OK"] });
    return false;
  }
  const r = await dialog.showMessageBox(janela || undefined, {
    type: "question", title: "Desinstalar DigiDoc", buttons: ["Desinstalar", "Cancelar"], defaultId: 1, cancelId: 1,
    message: "Remover o DigiDoc deste PC?",
    detail: `Pasta do programa:\n${info.dir}\n\nSeus PDFs (${docs}) NÃO serão apagados — ficam exatamente onde estão.`,
  });
  if (r.response !== 0) return false;
  const res = await executarDesinstalacao();
  if (!res.ok) await dialog.showMessageBox(janela || undefined, { type: "error", title: "DigiDoc", message: "Não consegui remover: " + res.msg, buttons: ["OK"] });
  return res.ok;
}

async function executarDesinstalacao() {
  try {
    const { dir, motivo } = await avaliarDesinstalacao();
    if (motivo === "dev") return { ok: false, msg: "Modo desenvolvimento: nada a desinstalar." };
    if (motivo === "semExe") return { ok: false, msg: "Não achei o DigiDoc.exe na pasta do programa." };
    if (motivo === "pendrive") return { ok: false, msg: "O DigiDoc está rodando do pendrive: não há nada instalado neste PC." };
    if (motivo) return { ok: false, msg: "Não consegui confirmar que esta cópia está instalada neste PC. Por segurança não removi nada." };

    // pastas que NUNCA podem ser tocadas (documentos — a escolhida e a padrao — e backup)
    const protegidas = [cfg.pastaSaida, config.pastaSaidaPadrao(), cfg.aposSalvar && cfg.aposSalvar.pastaBackup]
      .filter(Boolean).map((p) => path.resolve(p));
    const mesmo = (a, b) => path.relative(a, b) === "";
    // o caminho e (ou esta dentro de) uma pasta protegida?
    const protegido = (abs) => protegidas.some((p) => mesmo(abs, p) || dentroDe(abs, p));
    // o caminho contem uma pasta protegida dentro dele? (nao pode apagar recursivo)
    const contemProtegida = (abs) => protegidas.some((p) => mesmo(abs, p) || dentroDe(p, abs));

    let arquivos = [];
    const man = path.join(dir, MANIFESTO);
    if (fs.existsSync(man)) arquivos = fs.readFileSync(man, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    else arquivos = ["DigiDoc.exe"]; // instalacao antiga (exe unico)
    // linhas terminadas em "\" no manifesto sao pastas (as pastas sao recalculadas abaixo)
    arquivos = arquivos.filter((r) => !/[\\/]$/.test(r));
    arquivos = arquivos
      .map((r) => r.replace(/\//g, "\\"))
      .filter((r) => !path.isAbsolute(r) && !r.split("\\").includes("..") && !/[<>|"]/.test(r))
      .filter((r) => !protegido(path.resolve(dir, r)));

    // pastas que ficarem vazias, das mais fundas pras mais rasas
    const pastas = new Set();
    for (const r of arquivos) { let d = path.dirname(r); while (d && d !== "." && d !== "\\") { pastas.add(d); d = path.dirname(d); } }
    const pastasOrd = [...pastas].sort((a, b) => b.split("\\").length - a.split("\\").length);

    const naps2 = path.join(dir, "naps2");
    const apagarNaps2 = fs.existsSync(naps2) && !contemProtegida(naps2);
    const userData = app.getPath("userData");
    const apagarUserData = /digi/i.test(path.basename(userData)) && dentroDe(userData, app.getPath("appData")) && !contemProtegida(userData);
    // dados locais do motor do scanner (%LOCALAPPDATA%\DigiDoc\naps2-dados: perfil da impressora de
    // rede, cache). So essa subpasta; a de cima so sai se ficar vazia (o programa pode estar nela)
    const localApp = process.env.LOCALAPPDATA || "";
    const dadosLocais = localApp ? path.join(localApp, "DigiDoc") : "";
    const naps2Dados = dadosLocais ? path.join(dadosLocais, "naps2-dados") : "";
    const apagarLocais = !!dadosLocais && dentroDe(dadosLocais, localApp) && !contemProtegida(naps2Dados);
    const lnk = path.join(app.getPath("desktop"), "DigiDoc.lnk");
    // atalho do Menu Iniciar (criado pelo DigiDoc-Setup.exe); so apaga se apontar pra ESTA pasta
    const lnkMenu = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "DigiDoc.lnk");
    let tirarRegistro = false;
    try {
      const out = require("child_process").execFileSync("reg", ["query", CHAVE_UNINSTALL, "/v", "InstallLocation"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      const m = out.match(/InstallLocation\s+REG_\w+\s+(.+)/);
      tirarRegistro = !!m && path.relative(path.resolve(m[1].trim()), dir) === "";
    } catch {}
    const pid = process.pid;

    const L = ["@echo off", "chcp 65001 >nul",
      ":esperar",
      `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul && (ping -n 2 127.0.0.1 >nul & goto esperar)`,
      `cd /d "${dir}" || goto fim`,
      "set /a TENTATIVA=0", ":apagar", "set /a TENTATIVA+=1"];
    for (const r of arquivos) L.push(`if exist "${r}" del /f /q "${r}" >nul 2>&1`);
    L.push(`if exist "DigiDoc.exe" if %TENTATIVA% LSS 30 (ping -n 2 127.0.0.1 >nul & goto apagar)`);
    L.push(`if exist "${config.NOME_CONFIG}" del /f /q "${config.NOME_CONFIG}" >nul 2>&1`);
    if (apagarNaps2) L.push(`if exist "naps2" rmdir /s /q "naps2" >nul 2>&1`);
    for (const d of pastasOrd) L.push(`rmdir "${d}" >nul 2>&1`);
    L.push(`if exist "${MANIFESTO}" del /f /q "${MANIFESTO}" >nul 2>&1`);
    L.push(`if exist "${MARCA_INSTALADO}" del /f /q "${MARCA_INSTALADO}" >nul 2>&1`);
    L.push(`if exist "${lnk}" del /f /q "${lnk}" >nul 2>&1`);
    if (tirarRegistro) {
      L.push(`if exist "${lnkMenu}" del /f /q "${lnkMenu}" >nul 2>&1`);
      L.push(`reg delete "${CHAVE_UNINSTALL}" /f >nul 2>&1`);
    }
    if (apagarUserData) L.push(`if exist "${userData}" rmdir /s /q "${userData}" >nul 2>&1`);
    if (apagarLocais) L.push(`if exist "${naps2Dados}" rmdir /s /q "${naps2Dados}" >nul 2>&1`, `rmdir "${dadosLocais}" >nul 2>&1`);
    L.push(`cd /d "%TEMP%"`, `rmdir "${dir}" >nul 2>&1`);
    L.push(":fim", `(goto) 2>nul & del "%~f0"`);

    const bat = path.join(os.tmpdir(), `digidoc_remover_${pid}.bat`);
    fs.writeFileSync(bat, L.join("\r\n") + "\r\n", "utf8");
    require("child_process").spawn("cmd.exe", ["/c", bat], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (e) { return { ok: false, msg: e.message }; }
}

// ---- adicionar paginas a um PDF ja salvo ----
ipcMain.handle("pdf:escolherExistente", async (_e, nomeAssociado) => {
  const c = cfgSaida();
  let defaultPath = c.pastaSaida;
  try { if (nomeAssociado) { const d = files.pastaAssociado(c, nomeAssociado, false); if (fs.existsSync(d)) defaultPath = d; } } catch {}
  const r = await dialog.showOpenDialog(win, {
    title: "Escolher o PDF para adicionar páginas", defaultPath,
    properties: ["openFile"], filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("salvar:adicionarPDF", async (_e, { caminho, ids, nomeAssociado }) => {
  try {
    const pgs = ids.map((id) => {
      const p = paginas.get(id);
      return p ? { buffer: p.processado, width: p.meta.w, height: p.meta.h, dpiOrigem: cfg.scanner.resolucao || 200 } : null;
    }).filter(Boolean);
    if (!pgs.length) return { ok: false, msg: "Sem páginas para adicionar." };
    const maxBytes = cfg.tamanhoMaxMB * 1024 * 1024;
    const r = await pdf.adicionarAoPDF(caminho, pgs, { maxBytes, onProgresso: (p) => enviar("progresso", { tipo: "pdf", ...p, nome: path.basename(caminho) }) });
    fazerBackup(caminho);
    const res = { ok: true, nome: path.basename(caminho), bytes: r.bytes, caminho };
    registrarHistorico(nomeAssociado || path.basename(path.dirname(caminho)), "adicionar", { ok: true, pasta: path.dirname(caminho), salvos: [res] });
    return res;
  } catch (e) {
    if (e.salvouAcimaDoLimite) { fazerBackup(e.caminho); return { ok: true, nome: path.basename(e.caminho), bytes: e.bytes, caminho: e.caminho, aviso: e.message }; }
    return { ok: false, msg: e.message };
  }
});

ipcMain.handle("abrir:pasta", (_e, nomeAssociado) => {
  try {
    const c = cfgSaida();
    const dir = nomeAssociado ? files.pastaAssociado(c, nomeAssociado, true) : c.pastaSaida;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return true;
  } catch { return false; }
});

ipcMain.handle("escolher:pastaSaida", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
