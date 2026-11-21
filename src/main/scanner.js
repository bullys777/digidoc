"use strict";
// Motor de escaneamento. Usa o NAPS2.Console (portatil): ele resolve alimentador (ADF),
// frente e verso e scanner de rede (eSCL), sem instalar nada.
// Antes de escanear, o DigiDoc descobre sozinho (aparelhos.js) qual aparelho usar, o que ele tem
// (vidro / alimentador / frente e verso) e de onde vem o papel — e se adapta: impressora
// multifuncional, scanner de folhas ou scanner de mesa.
// O scanner escolhido (ou achado sozinho) fica guardado POR PC: o pendrive vai de casa pro
// trabalho e cada lugar lembra o seu aparelho.
// Procura o NAPS2 em: config.scanner.caminhoNaps2 > naps2 ao lado do programa >
// naps2 na pasta de cima (raiz do pendrive, com o app em D:\DigiDoc\) > assets/naps2.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { baseDir } = require("./config");
const aparelhos = require("./aparelhos");
const { portaProibida } = require("./escl");
const { decodificarSaida, classificarErroNaps2 } = require("./naps2-erros");

function acharNaps2(cfg) {
  const candidatos = [];
  if (cfg && cfg.scanner && cfg.scanner.caminhoNaps2) candidatos.push(cfg.scanner.caminhoNaps2);
  const base = baseDir();
  // o zip portatil do NAPS2 tem o Console dentro de App\. Cobrimos os dois layouts.
  for (const raiz of [path.join(base, "naps2"), path.join(path.dirname(base), "naps2"), path.join(base, "assets", "naps2")]) {
    candidatos.push(path.join(raiz, "App", "NAPS2.Console.exe"));
    candidatos.push(path.join(raiz, "NAPS2.Console.exe"));
  }
  // so consideramos "achado" se o arquivo existe de verdade (evita falso positivo
  // que levaria a um erro feio de spawn ENOENT).
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

function temNaps2(cfg) {
  return acharNaps2(cfg); // caminho real existente, ou null
}

/* ======================= pasta de dados do NAPS2 (so do DigiDoc) ======================= */
// Perfil da impressora de rede, cache e log do NAPS2 ficam numa pasta LOCAL deste PC (nao no
// perfil "roaming" do Windows, que vai pro servidor): nao mexe na pasta do NAPS2 e funciona
// onde quer que ele esteja.
function pastaDadosNaps2() {
  const base = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "DigiDoc") : path.join(os.tmpdir(), "DigiDoc");
  const p = path.join(base, "naps2-dados");
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
  return p;
}
const envNaps2 = () => Object.assign({}, process.env, { NAPS2_TEST_DATA: pastaDadosNaps2() });

// O NAPS2 guarda cada pagina lida numa pasta de recuperacao e so apaga ao terminar direito.
// Quando o DigiDoc precisa encerra-lo (Cancelar, travou, busca na rede), sobram imagens de
// documentos ali: limpa tudo que nao estiver em uso.
function limparRecuperacao() {
  const rec = path.join(pastaDadosNaps2(), "recovery");
  let itens = [];
  try { itens = fs.readdirSync(rec, { withFileTypes: true }); } catch { return; }
  for (const it of itens) {
    if (!it.isDirectory()) continue;
    const d = path.join(rec, it.name);
    try { fs.rmSync(path.join(d, ".lock"), { force: true }); } catch { continue; } // em uso: um NAPS2 vivo
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
}

/* ======================= o scanner deste PC ======================= */
const NOME_PC = (os.hostname() || "pc").toLowerCase();

function meuPC(cfg) {
  const s = cfg.scanner;
  if (!s.porPC || typeof s.porPC !== "object") s.porPC = {};
  if (!s.porPC[NOME_PC]) {
    s.porPC[NOME_PC] = { aparelho: null, ultimoAuto: null };
    const chaves = Object.keys(s.porPC); // nao deixa crescer pra sempre
    for (const velha of chaves.slice(0, Math.max(0, chaves.length - 20))) if (velha !== NOME_PC) delete s.porPC[velha];
  }
  return s.porPC[NOME_PC];
}

// configs antigas: so o nome do aparelho (e o driver), ou o aparelho fora do "porPC"
function migrarEscolhaAntiga(cfg) {
  const s = cfg.scanner, m = meuPC(cfg);
  let mudou = false;
  if (s.aparelho !== undefined || s.ultimoAuto !== undefined) {
    if (!m.aparelho && s.aparelho && s.aparelho.driver) m.aparelho = aparelhos.limparAp(s.aparelho);
    if (!m.ultimoAuto && s.ultimoAuto && s.ultimoAuto.driver) m.ultimoAuto = aparelhos.limparAp(s.ultimoAuto);
    delete s.aparelho; delete s.ultimoAuto; mudou = true;
  }
  if (s.dispositivo) {
    if (!m.aparelho) {
      const ip = aparelhos.ipDoNome(s.dispositivo);
      const driver = ["escl", "wia", "twain"].includes(s.driver) ? s.driver : ip ? "escl" : null;
      if (driver) {
        m.aparelho = { driver, nome: driver === "escl" ? aparelhos.semIp(s.dispositivo) : s.dispositivo };
        if (ip) m.aparelho.ip = ip;
      } // driver "auto" e nome solto: o app procura sozinho
    }
    s.dispositivo = ""; mudou = true;
  }
  if (s.driver && s.driver !== "auto") { s.driver = "auto"; mudou = true; } // a busca automatica olha tudo
  return mudou;
}

function apAtual(cfg) {
  const m = meuPC(cfg);
  if (m.aparelho && m.aparelho.driver) return { ap: m.aparelho, escolhido: true };
  if (m.ultimoAuto && m.ultimoAuto.driver) return { ap: m.ultimoAuto, escolhido: false };
  return { ap: null, escolhido: false };
}

function guardarAp(cfg, escolhido, ap) {
  const m = meuPC(cfg);
  if (escolhido) m.aparelho = aparelhos.limparAp(ap);
  else m.ultimoAuto = aparelhos.limparAp(ap);
}

// o usuario escolheu no seletor: um aparelho, ou null = automatico (procura de novo)
function escolher(cfg, ap) {
  migrarEscolhaAntiga(cfg);
  const m = meuPC(cfg);
  m.aparelho = ap && ap.driver ? aparelhos.limparAp(ap) : null;
  if (!m.aparelho) m.ultimoAuto = null;
  if (ap && ap.caps) guardarCaps(cfg, ap, ap.caps, ap.fonteCaps || "aprendido");
  return info(cfg);
}

/* ======================= o que ja se sabe de cada aparelho ======================= */
function capsDe(cfg, ap) {
  const c = ap && cfg.scanner.capacidades ? cfg.scanner.capacidades[aparelhos.chaveDe(ap)] : null;
  return c ? { vidro: c.vidro, alimentador: c.alimentador, duplex: c.duplex } : null;
}

// fonte: "escl" / "wia" (o aparelho disse) ou "aprendido" (descoberto escaneando)
function guardarCaps(cfg, ap, caps, fonte) {
  const k = aparelhos.chaveDe(ap);
  if (!k || !caps) return;
  const todas = cfg.scanner.capacidades = cfg.scanner.capacidades || {};
  delete todas[k];
  todas[k] = { vidro: caps.vidro, alimentador: caps.alimentador, duplex: caps.duplex, fonte, em: new Date().toISOString().slice(0, 10) };
  const chaves = Object.keys(todas); // nao deixa crescer pra sempre
  for (const velha of chaves.slice(0, Math.max(0, chaves.length - 30))) delete todas[velha];
}

function guardarDaLista(cfg, lista) {
  for (const ap of lista || []) if (ap.caps) guardarCaps(cfg, ap, ap.caps, ap.fonteCaps || "aprendido");
}

// aprende escaneando. O que o aparelho informou (eSCL/WIA) vale mais. No TWAIN, um pedido de
// alimentador que o aparelho nao tem e ignorado calado (sai do vidro), entao "deu certo" la nao
// prova nada — so os erros contam.
function aprender(cfg, ap, fonte, erro) {
  if (!erro && ap.driver === "twain") return;
  const k = aparelhos.chaveDe(ap);
  const atual = (cfg.scanner.capacidades || {})[k];
  const c = atual ? { vidro: atual.vidro, alimentador: atual.alimentador, duplex: atual.duplex } : { vidro: null, alimentador: null, duplex: null };
  const oficial = atual && (atual.fonte === "escl" || atual.fonte === "wia");
  if (erro === "sem_alimentador") { c.alimentador = false; c.duplex = false; }
  else if (erro === "sem_duplex") c.duplex = false;
  else if (!erro && fonte === "glass" && !oficial) c.vidro = true;
  else if (!erro && (fonte === "feeder" || fonte === "duplex")) { c.alimentador = true; if (fonte === "duplex") c.duplex = true; }
  else return;
  if (oficial && !erro) return; // nada novo
  guardarCaps(cfg, ap, c, oficial ? atual.fonte : "aprendido");
}

// resumo pra tela (rodape, configuracoes)
function info(cfg) {
  migrarEscolhaAntiga(cfg);
  const { ap, escolhido } = apAtual(cfg);
  const caps = ap ? capsDe(cfg, ap) : null;
  const tipo = aparelhos.tipoDe(caps);
  return {
    nome: ap ? ap.nome : "", driver: ap ? ap.driver : null, automatico: !escolhido,
    chave: ap ? aparelhos.chaveDe(ap) : "", aparelho: ap ? aparelhos.limparAp(ap) : null,
    tipo, rotulo: aparelhos.TIPOS[tipo].rotulo, caps,
    origem: cfg.scanner.origem || "auto", temMotor: !!temNaps2(cfg),
  };
}

function enfeitar(ap) {
  const tipo = aparelhos.tipoDe(ap.caps);
  return Object.assign(aparelhos.limparAp(ap), { chave: aparelhos.chaveDe(ap), caps: ap.caps || null, fonteCaps: ap.fonteCaps || null, tipo, rotulo: aparelhos.TIPOS[tipo].rotulo });
}

/* ================================= listar ================================= */
// procura em tudo ao mesmo tempo; onAchado recebe cada aparelho (ja com o que ele tem).
// driver: limita SO esta busca ("escl" | "wia" | "twain"); nao fica salvo
async function listar(cfg, onAchado, driver) {
  const exe = temNaps2(cfg);
  const lista = await aparelhos.listar({ exe, driver: driver || "auto", env: envNaps2(), aoMatar: limparRecuperacao,
    onAchado: onAchado ? (ap) => onAchado(enfeitar(ap)) : null });
  guardarDaLista(cfg, lista);
  return { ok: true, dispositivos: lista.map(enfeitar), semMotor: !exe };
}

// em segundo plano (ao abrir o app): descobre o scanner / o que ele tem, se ainda nao sabe.
// So PREENCHE a vaga vazia (PC novo) com o que a busca do Escanear tambem escolheria; nunca
// troca por OUTRO aparelho calado (isso fica pro Escanear, que avisa).
// pegarCfg() devolve a config ATUAL (ela pode ter sido trocada enquanto isso)
let _segundoPlano = null;
function atualizarEmSegundoPlano(pegarCfg, aoMudar) {
  if (_segundoPlano) return _segundoPlano;
  limparRecuperacao();
  const cfg0 = pegarCfg();
  migrarEscolhaAntiga(cfg0);
  const { ap } = apAtual(cfg0);
  if (ap && (capsDe(cfg0, ap) || ap.driver === "twain")) return null; // ja sabe; o resto e conferido na hora de escanear
  _segundoPlano = (async () => {
    try {
      if (!ap) {
        // com TWAIN na busca: se houver um scanner TWAIN de outro modelo, a escolha fica pro usuario
        const lista = await aparelhos.listar({ exe: temNaps2(cfg0), driver: "auto", env: envNaps2(), aoMatar: limparRecuperacao });
        const cfg = pegarCfg();
        guardarDaLista(cfg, lista);
        const esc = aparelhos.escolherAutomatico(lista);
        if (esc.ap && !apAtual(cfg).ap) meuPC(cfg).ultimoAuto = aparelhos.limparAp(esc.ap);
      } else {
        const c = await aparelhos.conferir(ap, { exe: temNaps2(cfg0), env: envNaps2(), verificarTwain: true });
        const cfg = pegarCfg();
        if (c.caps) guardarCaps(cfg, c.ap, c.caps, c.fonte);
        const atual = apAtual(cfg);
        if (c.ap !== ap && atual.ap && aparelhos.chaveDe(atual.ap) === aparelhos.chaveDe(ap)) guardarAp(cfg, atual.escolhido, c.ap);
      }
      if (aoMudar) aoMudar();
    } catch {} finally { _segundoPlano = null; }
  })();
  return _segundoPlano;
}

/* ================================ planejar ================================ */
let _atual = null;      // NAPS2 rodando agora (pra poder cancelar)
let _cancelado = false; // "Cancelar" clicado (vale tambem se ainda estava procurando/conferindo)

function cancelar() {
  _cancelado = true;
  if (_atual) { _atual.cancelado = true; aparelhos.matarArvore(_atual.p); }
  return true;
}

const CANCELADO = () => ({ ok: false, erro: "cancelado", msg: mensagem("cancelado") });

// qual aparelho usar: o escolhido, o achado sozinho da ultima vez, ou procura agora
async function resolverAparelho(cfg, exe, avisar, procurarDeNovo) {
  migrarEscolhaAntiga(cfg);
  const atual = apAtual(cfg);
  if (atual.ap && !(procurarDeNovo && !atual.escolhido)) return atual;
  avisar("Procurando o scanner…");
  const lista = await aparelhos.listar({ exe, driver: "auto", env: envNaps2(), aoMatar: limparRecuperacao, cancelado: () => _cancelado });
  if (_cancelado) return { erro: "cancelado" };
  guardarDaLista(cfg, lista);
  const r = aparelhos.escolherAutomatico(lista);
  if (r.nenhum) return { erro: "nenhum_dispositivo" };
  if (r.varios) return { erro: "varios" };
  meuPC(cfg).ultimoAuto = aparelhos.limparAp(r.ap);
  return { ap: meuPC(cfg).ultimoAuto, escolhido: false, novo: true };
}

const NOME_FONTE = { feeder: "o alimentador", duplex: "o alimentador (frente e verso)", glass: "o vidro" };
const MOTIVO = {
  papel_no_alimentador: "tem papel no alimentador",
  alimentador_vazio: "o alimentador está vazio",
  so_vidro: "este aparelho só tem vidro",
  so_alimentador: "este aparelho só tem alimentador",
  sem_vidro: "este aparelho não tem vidro",
  tentar: "se o alimentador estiver vazio, uso o vidro",
};

const erroPlano = (erro, extra) => Object.assign({ ok: false, erro, msg: mensagem(erro), escolher: ["nenhum_dispositivo", "varios", "offline"].includes(erro) }, extra || {});

// decide de onde escanear. origem: "alimentador" | "vidro" = botao explicito; qualquer outra
// coisa = o botao Escanear, que segue a preferencia das Configuracoes ("automatico" por padrao)
// -> { ok, plano: { aparelho, fontes, motivo, pedido, explicito, automatico }, usaAlimentador, texto }
//    ou { ok:false, erro, msg, escolher? }
async function planejar(cfg, origem, avisar = () => {}) {
  _cancelado = false; // comeca uma digitalizacao nova
  const exe = temNaps2(cfg);
  if (!exe) return erroPlano("naps2_ausente");
  let r = await resolverAparelho(cfg, exe, avisar);
  if (_cancelado || r.erro === "cancelado") return CANCELADO();
  if (r.erro) return erroPlano(r.erro);

  avisar(`Conferindo ${r.ap.nome || "o scanner"}…`);
  const env = envNaps2();
  let c = await aparelhos.conferir(r.ap, { exe, env });
  if (_cancelado) return CANCELADO();
  if (c.online === false && !r.escolhido && !r.novo) {
    // o achado sozinho da outra vez nao respondeu: procura de novo — mas nao troca calado por
    // OUTRO aparelho (podia puxar o papel de outra pessoa): avisa e usa no proximo clique
    const antigo = r.ap;
    r = await resolverAparelho(cfg, exe, avisar, true);
    if (_cancelado || r.erro === "cancelado") { meuPC(cfg).ultimoAuto = antigo; return CANCELADO(); }
    if (r.erro) { meuPC(cfg).ultimoAuto = antigo; return erroPlano(r.erro); }
    if (aparelhos.chaveDe(r.ap) !== aparelhos.chaveDe(antigo)) {
      // um scanner USB/de rede que sumiu (cabo solto, desligado) nao vira o TWAIN instalado — a
      // lista do TWAIN mostra o que esta instalado, nao o que esta ligado
      if (antigo.driver !== "twain" && r.ap.driver === "twain") {
        meuPC(cfg).ultimoAuto = antigo;
        const como = antigo.driver === "escl" ? "ligado e na mesma rede" : "ligado e com o cabo USB conectado";
        return { ok: false, erro: "offline", msg: `${antigo.nome || "O scanner"} não respondeu. Veja se está ${como} e tente de novo.` };
      }
      return { ok: false, erro: "trocou", msg: `${antigo.nome || "O scanner de antes"} não respondeu. Achei ${r.ap.nome} — clique em Escanear de novo pra usar ele (ou escolha outro no 🖨 do rodapé).` };
    }
    c = await aparelhos.conferir(r.ap, { exe, env });
    if (_cancelado) return CANCELADO();
  }
  if (c.online === false) {
    const nome = r.ap.nome || "O scanner";
    if (c.outro) return { ok: false, erro: "offline", escolher: true, msg: `${nome} não respondeu: no endereço dele agora responde outro aparelho (${c.outro}). Escolha o scanner de novo.` };
    const como = r.ap.driver === "escl" ? "ligado e na mesma rede" : "ligado e com o cabo USB conectado";
    return { ok: false, erro: "offline", escolher: true, msg: `${nome} não respondeu. Veja se está ${como} e tente de novo.` };
  }
  let ap = r.ap;
  if (c.ap && c.ap !== r.ap) { ap = c.ap; guardarAp(cfg, r.escolhido, ap); }
  if (c.caps) guardarCaps(cfg, ap, c.caps, c.fonte);

  const caps = capsDe(cfg, ap);
  const explicito = origem === "alimentador" || origem === "vidro";
  const pedido = explicito ? origem : ["alimentador", "vidro"].includes(cfg.scanner.origem) ? cfg.scanner.origem : "auto";
  let papel = c.papel === true || c.papel === false ? c.papel : null;
  // o WIA ja leu o papel no conferir (ler de novo so gasta tempo); rede le agora
  if (pedido === "auto" && caps && caps.vidro !== false && caps.alimentador !== false && papel === null && ap.driver === "escl") {
    avisar("Vendo se tem papel no alimentador…");
    const lp = await aparelhos.lerPapel(ap, avisar, () => _cancelado);
    if (_cancelado || lp.erro === "cancelado") return CANCELADO();
    if (lp.erro) {
      const dica = lp.erro === "atolado" || lp.erro === "tampa_aberta" ? " Se o documento está no vidro, use o botão Vidro." : "";
      return { ok: false, erro: lp.erro, msg: mensagem(lp.erro) + dica };
    }
    papel = lp.papel;
  }
  let p = aparelhos.planejarFontes({ pedido, caps, papel, duplex: !!cfg.scanner.frenteEVerso });
  // "Sempre o alimentador" (Configuracoes) num aparelho que so tem vidro: usa o vidro, como o
  // "Sempre o vidro" num scanner de folhas usa o alimentador. Erro so pro botao Alimentador.
  if (p.erro === "sem_alimentador" && !explicito) p = { fontes: ["glass"], motivo: "so_vidro" };
  if (p.erro) return erroPlano(p.erro);
  const motivo = MOTIVO[p.motivo];
  return {
    ok: true,
    plano: { aparelho: aparelhos.limparAp(ap), fontes: p.fontes, motivo: p.motivo, pedido, explicito, automatico: !r.escolhido },
    // "quantas folhas" (pega o alimentador puxando 2 juntas): quando comeca pelo alimentador. No
    // TWAIN sem saber o que o aparelho tem, nao (ele pode ignorar o alimentador e ler o vidro)
    usaAlimentador: p.fontes[0] !== "glass" && (p.fontes.length === 1 || ap.driver !== "twain"),
    texto: `Escaneando ${NOME_FONTE[p.fontes[0]]}${motivo ? " (" + motivo + ")" : ""}…`,
  };
}

/* ================================ escanear ================================ */
const PERFIL_REDE = "DigiDoc-rede";

// impressora de rede: perfil do NAPS2 com o endereco direto (nada de busca na rede, que pode
// demorar 60 s ou ser bloqueada). Reescrito antes de cada uso.
function escreverPerfilRede(ap) {
  const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const url = ap.base.replace(/\/+$/, "");
  if (portaProibida(url)) throw new Error("porta de impressao");
  const nome = ap.nome + (ap.ip ? ` (${ap.ip})` : "");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ArrayOfScanProfile xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <ScanProfile>
    <Version>2</Version>
    <DisplayName>${PERFIL_REDE}</DisplayName>
    <DriverName>escl</DriverName>
    <Device>
      <ID>${x(url)}</ID>
      <Name>${x(nome)}</Name>
    </Device>
    <UseNativeUI>false</UseNativeUI>
  </ScanProfile>
</ArrayOfScanProfile>
`;
  fs.writeFileSync(path.join(pastaDadosNaps2(), "profiles.xml"), xml, "utf8");
}

// como o NAPS2 acha o aparelho: id exato (uuid / id WIA) ou pedaco do nome
function deviceNaps2(ap) {
  if (ap.driver === "escl") return ap.uuid || (ap.ip ? `(${ap.ip})` : ap.nome);
  if (ap.driver === "wia") return ap.id || ap.nome;
  return ap.nome;
}

function argsNaps2(cfg, ap, fonte, saida, viaPerfil) {
  const s = cfg.scanner;
  const comum = ["-v", "-o", saida, "--jpegquality", "90",
    "--dpi", String(s.resolucao || 200),
    "--bitdepth", s.cor === "cor" ? "color" : s.cor === "pb" ? "bw" : "gray",
    "--source", fonte, "--pagesize", "a4", "--force"];
  // --noprofile: um perfil padrao do NAPS2 (de quem abriu a janela dele) nao interfere
  if (viaPerfil) return ["--profile", PERFIL_REDE, ...comum];
  const dev = deviceNaps2(ap);
  return ["--noprofile", "--driver", ap.driver, ...(dev ? ["--device", dev] : []), ...comum];
}

// roda o NAPS2 vigiando: se ficar sem dar sinal (TWAIN esperando papel, rede caindo...), encerra.
// -> { ok, arquivos, dir, lidas, aviso? } ou { ok:false, erro, chave, lidas, bruto }
function rodarNaps2(exe, args, { onLidas, primeiraMs = 150000, entreMs = 120000 } = {}) {
  return new Promise((resolve) => {
    let dir;
    try { dir = fs.mkdtempSync(path.join(os.tmpdir(), "digscan-")); } catch (e) { resolve({ ok: false, erro: "outro", lidas: 0, bruto: e.message }); return; }
    const a = args.slice();
    a[a.indexOf("-o") + 1] = path.join(dir, "pag_$(nnnn).jpg");
    const fonte = a[a.indexOf("--source") + 1];
    let p;
    try { p = spawn(exe, a, { windowsHide: true, env: envNaps2() }); }
    catch (e) { resolve({ ok: false, erro: "naps2_ausente", lidas: 0, dir, bruto: e.message }); return; }
    const estado = { p, cancelado: false, travou: false };
    _atual = estado;
    const outB = [], errB = [];
    let ultimoSinal = Date.now(), lidas = 0, textoOut = "", fim = false, codSaida = null, reserva = null;
    const matar = () => {
      aparelhos.matarArvore(p); // o NAPS2 e o "worker" do TWAIN (pra o aparelho ficar livre)
      // se o 'close' nao vier (um processo filho segurando o pipe), termina mesmo assim
      if (!reserva) reserva = setTimeout(() => terminar(codSaida), 10000);
    };
    const vigia = setInterval(() => {
      if (_cancelado && !estado.cancelado) { estado.cancelado = true; matar(); }
      if (!estado.travou && Date.now() - ultimoSinal > (lidas ? entreMs : primeiraMs)) { estado.travou = true; matar(); }
    }, 1000);
    p.stdout.on("data", (d) => {
      outB.push(d); ultimoSinal = Date.now();
      textoOut += d.toString("latin1");
      const n = (textoOut.match(/Scanned page \d+/g) || []).length; // -v: uma linha por pagina lida
      if (n > lidas) { lidas = n; if (onLidas) onLidas(n); }
    });
    p.stderr.on("data", (d) => { errB.push(d); ultimoSinal = Date.now(); });
    const terminar = (code, erroSpawn) => {
      if (fim) return; fim = true;
      clearInterval(vigia); clearTimeout(reserva);
      if (_atual === estado) _atual = null;
      if (estado.cancelado || estado.travou) limparRecuperacao();
      const bruto = (decodificarSaida(Buffer.concat(outB)) + "\n" + decodificarSaida(Buffer.concat(errB))).trim();
      let arquivos = [];
      try { arquivos = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => path.join(dir, f)); } catch {}
      if (erroSpawn) return resolve({ ok: false, erro: erroSpawn.code === "ENOENT" ? "naps2_ausente" : "outro", arquivos, dir, lidas, bruto: erroSpawn.message });
      if (estado.cancelado) return resolve({ ok: false, erro: "cancelado", arquivos, dir, lidas, bruto });
      const c = classificarErroNaps2(bruto, { fonte });
      if (arquivos.length) {
        // erro no meio (ex.: atolou na 3a folha): o NAPS2 salva o que ja leu e sai com 1 — sempre avisa
        const interrompeu = code !== 0 || estado.travou;
        return resolve({ ok: true, arquivos, dir, lidas, aviso: interrompeu ? (c.categoria !== "outro" ? c.categoria : "interrompido") : null, bruto });
      }
      if (estado.travou) return resolve({ ok: false, erro: lidas ? "travou_meio" : "travou", arquivos, dir, lidas, bruto });
      resolve({ ok: false, erro: c.categoria, chave: c.chave, arquivos, dir, lidas, bruto });
    };
    p.on("error", (e) => terminar(null, e));
    p.on("exit", (code) => { codSaida = code; if (!reserva) reserva = setTimeout(() => terminar(code), 3000); });
    p.on("close", (code) => terminar(code));
  });
}

function apagarPasta(dir) { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } }

const FALANDO = { feeder: "Escaneando o alimentador…", duplex: "Escaneando o alimentador (frente e verso)…", glass: "Escaneando o vidro…" };

// escaneia seguindo o plano (ou planeja agora). Se o alimentador estiver vazio no modo
// automatico, cai pro vidro; sem frente e verso, so a frente; sem alimentador, o vidro.
// -> { ok, arquivos, dir, fonte, aviso?, origemCerta } ou { ok:false, erro, msg, escolher? }
async function escanear(cfg, { origem, plano } = {}, avisar = () => {}) {
  const exe = temNaps2(cfg);
  if (!exe) return erroPlano("naps2_ausente");
  const ok = plano && plano.aparelho && plano.aparelho.driver && Array.isArray(plano.fontes) && plano.fontes.length;
  if (!ok) {
    const p = await planejar(cfg, origem, avisar);
    if (!p.ok) return p;
    plano = p.plano;
  }
  const ap = plano.aparelho;
  const fontes = plano.fontes.filter((f) => ["glass", "feeder", "duplex"].includes(f));
  let viaPerfil = ap.driver === "escl" && !!ap.base;
  let ultimo = null;
  while (fontes.length) {
    if (_cancelado) return CANCELADO();
    const fonte = fontes.shift();
    avisar(FALANDO[fonte]);
    if (viaPerfil) { try { escreverPerfilRede(ap); } catch { viaPerfil = false; } }
    // tentativa "pra ver" do alimentador no TWAIN (ele pode ficar parado esperando papel): espera
    // menos — mas o bastante pro NAPS2 abrir do pendrive e o aparelho aquecer
    const praVer = plano.motivo === "tentar" && fonte !== "glass" && fontes.includes("glass") && ap.driver === "twain";
    const r = await rodarNaps2(exe, argsNaps2(cfg, ap, fonte, "x", viaPerfil), { onLidas: (n) => avisar(`Lendo página ${n}…`), primeiraMs: praVer ? 90000 : 150000 });
    if (r.ok) {
      aprender(cfg, ap, fonte, null);
      return { ok: true, arquivos: r.arquivos, dir: r.dir, fonte, aviso: r.aviso || null, motivo: plano.motivo,
        origemCerta: !(ap.driver === "twain" && fonte !== "glass") }; // TWAIN pode ter ignorado o pedido de alimentador
    }
    apagarPasta(r.dir);
    ultimo = r;
    if (r.erro === "cancelado" || r.erro === "naps2_ausente") break;
    // pelo endereco direto nao achou: tenta pela busca do NAPS2 (so erros de ANTES de comecar a
    // digitalizar — um "offline" no meio pode ter puxado folhas, e repetir puxaria outras)
    if (viaPerfil && (r.chave === "opcao_invalida" || r.erro === "sem_dispositivo")) { viaPerfil = false; fontes.unshift(fonte); continue; }
    if (r.erro === "sem_duplex") { aprender(cfg, ap, fonte, "sem_duplex"); fontes.unshift("feeder"); avisar("Sem frente e verso: escaneando só a frente…"); continue; }
    if (r.erro === "sem_alimentador") {
      aprender(cfg, ap, fonte, "sem_alimentador");
      if (plano.explicito && plano.pedido === "alimentador") break;
      if (!fontes.includes("glass")) fontes.unshift("glass");
      avisar("Este aparelho não tem alimentador: escaneando o vidro…");
      continue;
    }
    if ((r.erro === "sem_papel" || r.erro === "travou") && !r.lidas && fontes.includes("glass")) { avisar("Alimentador vazio — escaneando o vidro…"); continue; }
    break;
  }
  const erro = ultimo ? ultimo.erro : "outro";
  // achado sozinho que sumiu (desligado, outro PC): esquece pra procurar de novo no proximo clique
  let escolherDeNovo = false;
  if (plano.automatico && (erro === "sem_dispositivo" || erro === "offline")) {
    const m = meuPC(cfg);
    if (m.ultimoAuto && aparelhos.chaveDe(m.ultimoAuto) === aparelhos.chaveDe(ap)) m.ultimoAuto = null;
    escolherDeNovo = true;
  }
  return { ok: false, erro, msg: mensagem(erro, ultimo && ultimo.bruto), escolher: escolherDeNovo };
}

// confere de novo o aparelho atual (botao "Detectar"). No automatico, procura de verdade.
async function detectarAgora(cfg, avisar = () => {}) {
  _cancelado = false;
  const exe = temNaps2(cfg);
  migrarEscolhaAntiga(cfg);
  const r = await resolverAparelho(cfg, exe, avisar, true);
  if (r.erro) return { ok: false, msg: mensagem(r.erro), info: info(cfg) };
  avisar(`Conferindo ${r.ap.nome || "o scanner"}…`);
  const c = await aparelhos.conferir(r.ap, { exe, env: envNaps2(), verificarTwain: true });
  if (c.ap && c.ap !== r.ap) guardarAp(cfg, r.escolhido, c.ap);
  if (c.caps) guardarCaps(cfg, c.ap || r.ap, c.caps, c.fonte);
  return { ok: c.online !== false, msg: c.online === false ? `${r.ap.nome} não respondeu.` : "", info: info(cfg) };
}

const MENSAGENS = {
  naps2_ausente: "O motor de scanner (NAPS2) não está na pasta do programa. Coloque a pasta 'naps2' ao lado do app, ou use Importar / iPhone.",
  nenhum_dispositivo: "Nenhum scanner encontrado. Veja se o aparelho está ligado (no cabo USB ou na mesma rede) e tente de novo.",
  varios: "Achei mais de um scanner. Escolha qual usar (só precisa fazer isso uma vez neste PC).",
  sem_dispositivo: "Não achei o scanner. Veja se está ligado e conectado (ou escolha outro no 🖨 do rodapé).",
  sem_papel: "O alimentador está vazio. Coloque as folhas no alimentador (ou use o vidro).",
  sem_alimentador: "Este aparelho não tem alimentador — coloque o documento no vidro e clique em Escanear.",
  sem_duplex: "Este aparelho não faz frente e verso sozinho.",
  offline: "Não consegui falar com o scanner (desligado, sem cabo ou fora da rede). Se ele estava escaneando, confira a bandeja: as folhas que passaram precisam ser escaneadas de novo.",
  ocupado: "O scanner está ocupado ou aquecendo. Espere um pouco e tente de novo.",
  atolado: "Tem papel atolado no scanner. Tire o papel com cuidado e tente de novo.",
  tampa_aberta: "A tampa do scanner está aberta. Feche e tente de novo.",
  travou: "O scanner parou de responder. Confira o aparelho e tente de novo.",
  travou_meio: "O scanner parou no meio e as folhas já lidas se perderam. Escaneie de novo.",
  interrompido: "O scanner parou no meio: confira se todas as folhas foram lidas.",
  cancelado: "Digitalização cancelada.",
};

function mensagem(erro, bruto) {
  if (MENSAGENS[erro]) return MENSAGENS[erro];
  // erro que nao se conhece: mostra a ultima linha do NAPS2 que nao seja so o "0 paginas"
  const linhas = String(bruto || "").split(/\r?\n/).map((s) => s.trim())
    .filter((s) => s && !/^(Beginning scan|Starting scan|\d+ page\(s\) scanned|No scanned pages to export)/i.test(s));
  return "Erro ao escanear" + (linhas.length ? ": " + linhas[linhas.length - 1].slice(0, 160) : ".");
}

module.exports = {
  listar, planejar, escanear, cancelar, detectarAgora, escolher, info, atualizarEmSegundoPlano, limparRecuperacao,
  temNaps2, acharNaps2, mensagem, pastaDadosNaps2,
  // para testes
  argsNaps2, deviceNaps2, migrarEscolhaAntiga, aprender, capsDe, guardarCaps, meuPC, apAtual, NOME_PC,
};
