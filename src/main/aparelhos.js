"use strict";
// Descobre sozinho QUAL scanner usar, O QUE ele tem (vidro, alimentador, frente e verso)
// e, na hora de escanear, DE ONDE vem o papel:
//  - impressora multifuncional (alimentador + vidro): alimentador se tiver papel, senao o vidro
//  - scanner de folhas (so alimentador) ou de mesa / impressora sem alimentador (so vidro): usa o que tem
// Fontes da informacao: rede (eSCL), WIA (USB) e, no TWAIN, o que se aprende escaneando.
const { spawn } = require("child_process");
const escl = require("./escl");
const wia = require("./wia");
const { decodificarSaida, ehLinhaDeMensagem } = require("./naps2-erros");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const TIPOS = {
  multifuncional: { rotulo: "alimentador + vidro", icone: "🖨" },
  alimentador: { rotulo: "só alimentador", icone: "📚" },
  mesa: { rotulo: "só vidro", icone: "📄" },
  desconhecido: { rotulo: "tipo ainda não identificado", icone: "🖨" },
};

function tipoDe(caps) {
  if (!caps) return "desconhecido";
  if (caps.vidro && caps.alimentador) return "multifuncional";
  if (caps.alimentador && caps.vidro === false) return "alimentador";
  if (caps.vidro && caps.alimentador === false) return "mesa";
  return "desconhecido";
}

// chave estavel pra guardar o que ja se sabe de cada aparelho (WIA: nome + id, assim dois
// aparelhos iguais nao viram um so; o nome serve pra reencontrar quando o id muda)
function chaveDe(ap) {
  if (!ap || !ap.driver) return "";
  const id = ap.driver === "escl" ? (ap.uuid ? normUuid(ap.uuid) : ap.ip || ap.nome) : ap.driver === "wia" ? `${ap.nome || ""}|${ap.id || ""}` : ap.nome;
  return (ap.driver + ":" + String(id || "")).toLowerCase();
}

// "urn:uuid:ABC" / "{ABC}" / "abc" -> "abc"
const normUuid = (u) => String(u || "").toLowerCase().replace(/^urn:uuid:/, "").replace(/[{}]/g, "").trim();
// e o mesmo aparelho? so diz "nao" quando os dois uuids existem e sao diferentes
const mesmoUuid = (a, b) => !a || !b || normUuid(a) === normUuid(b);

// o NAPS2 chama os aparelhos de rede de "Modelo (192.168.0.87)"
const RE_IP = /\s*\((\d{1,3}(?:\.\d{1,3}){3})\)\s*$/;
const ipDoNome = (nome) => { const m = RE_IP.exec(nome || ""); return m ? m[1] : null; };
const semIp = (nome) => String(nome || "").replace(RE_IP, "").trim();

// nome "limpo" pra comparar aparelhos: sem IP, sem [ABCD] do mDNS, sem "twain"/"wia"/"series"
function nomeLimpo(n) {
  return semIp(n).toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/^wia-/, "")
    .replace(/\b(twain|wia|series|scanner|scan|driver|usb|net|network|rede)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
// parece o mesmo modelo? um nome contem o outro (com pelo menos 6 letras, pra "HP" nao casar
// com tudo) ou os dois tem o mesmo codigo de modelo (ex.: "580 590", "m426", "lide 300")
function mesmoModelo(a, b) {
  const x = nomeLimpo(a), y = nomeLimpo(b);
  if (!x || !y) return false;
  const [menor, maior] = x.length <= y.length ? [x, y] : [y, x];
  if (menor.length >= 6 && maior.includes(menor)) return true;
  // codigos de modelo: "m426", "et3950" (letra+numero) ou pares como "lide 300", "tank 580"
  const marcas = (s) => {
    const t = s.split(" "), out = new Set();
    for (let i = 0; i < t.length; i++) {
      if (/[a-z]/.test(t[i]) && /\d/.test(t[i]) && t[i].length >= 3) out.add(t[i]);
      if (i + 1 < t.length && /\d/.test(t[i] + t[i + 1]) && (t[i] + t[i + 1]).length >= 6) out.add(t[i] + " " + t[i + 1]);
    }
    return out;
  };
  const my = marcas(y);
  for (const m of marcas(x)) if (my.has(m)) return true;
  return false;
}
// e o aparelho salvo? Com os dois uuids, compara uuid; sem um deles, exige o nome (nunca
// aceita "qualquer um que esteja nesse IP")
function mesmoAparelho(ap, caps, anuncio) {
  const uuidDele = (caps && caps.uuid) || (anuncio && anuncio.uuid) || null;
  if (ap.uuid && uuidDele) return normUuid(ap.uuid) === normUuid(uuidDele);
  const nomes = [anuncio && anuncio.modelo, caps && caps.modelo, anuncio && anuncio.nome].filter(Boolean);
  return nomes.some((n) => mesmoModelo(ap.nome, n));
}

// so os campos que identificam o aparelho (o que ele tem fica guardado a parte)
function limparAp(ap) {
  if (!ap || !ap.driver) return null;
  const o = { driver: ap.driver, nome: ap.nome || "" };
  if (ap.id) o.id = ap.id;
  if (ap.uuid) o.uuid = ap.uuid;
  if (ap.ip) o.ip = ap.ip;
  if (ap.base) o.base = ap.base;
  return o;
}

const capsSimples = (c) => (c ? { vidro: !!c.vidro, alimentador: !!c.alimentador, duplex: !!c.duplex } : null);

/* ================================ listar ================================ */
// NAPS2 --listdevices. TWAIN termina sozinho (o limite so cobre travamento, inclusive o NAPS2
// abrindo devagar do pendrive). O da rede espera 60 s de proposito: para no limite com o que veio.
// mata o processo E os filhos dele (o NAPS2 abre um "worker" pro TWAIN)
function matarArvore(p) {
  if (!p || !p.pid) return;
  try { require("child_process").execFile("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {}); } catch {}
  try { p.kill(); } catch {}
}

function listarNaps2(exe, driver, limiteMs, env, cancelado = () => false) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(exe, ["--listdevices", "--driver", driver], { windowsHide: true, env }); } catch { resolve({ nomes: [], morto: false }); return; }
    const partes = [];
    let fim = false, morto = false;
    const terminar = () => {
      if (fim) return; fim = true; clearTimeout(t); clearInterval(c);
      const nomes = decodificarSaida(Buffer.concat(partes)).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !ehLinhaDeMensagem(s));
      resolve({ nomes: [...new Set(nomes)], morto });
    };
    const matar = () => { if (morto) return; morto = true; matarArvore(p); setTimeout(terminar, 500); };
    const t = setTimeout(matar, limiteMs);
    const c = setInterval(() => { if (cancelado()) matar(); }, 500);
    p.stdout.on("data", (d) => partes.push(d));
    p.on("error", terminar);
    p.on("close", terminar);
  });
}

async function listarWia(cancelado) {
  return (await wia.listar(12000, cancelado)).map((d) => ({
    driver: "wia", nome: d.nome || "Scanner", id: d.id, erro: d.erro || null,
    caps: d.vidro == null && d.alimentador == null ? null : capsSimples(d), fonteCaps: "wia",
  }));
}

function apRede(nome, ip, uuid, base, caps) {
  return { driver: "escl", nome: nome || ip || "Impressora de rede", ip: ip || null, uuid: uuid || null, base: base || null,
    caps: capsSimples(caps), fonteCaps: caps ? "escl" : null };
}

async function listarRede(exe, env, aoMatar, cancelado) {
  const achados = await escl.procurarNaRede();
  if (cancelado()) return [];
  const lista = await Promise.all(achados.map(async (a) => {
    for (const e of a.enderecos) {
      if (!e.base) continue;
      const caps = await escl.lerCapacidades(e.base);
      if (caps && mesmoUuid(a.uuid, caps.uuid)) return apRede(a.modelo || caps.modelo || a.nome, e.ip, a.uuid || caps.uuid, e.base, caps);
    }
    const e = a.enderecos.find((x) => x.ip);
    return apRede(a.modelo || a.nome, e && e.ip, a.uuid, null, null);
  }));
  if (!lista.length && exe && !cancelado()) {
    // aparelho que nao responde a pergunta "de uma vez": usa a busca do proprio NAPS2
    const r = await listarNaps2(exe, "escl", 20000, env, cancelado);
    if (r.morto && aoMatar) aoMatar();
    for (const n of r.nomes) {
      const ip = ipDoNome(n);
      const ach = ip ? await escl.acharEndereco(ip) : null;
      lista.push(apRede(semIp(n), ip, ach && ach.caps.uuid, ach && ach.base, ach && ach.caps));
    }
  }
  return lista;
}

// procura em tudo ao mesmo tempo (USB/WIA, rede, TWAIN). onAchado(ap) a cada aparelho novo.
// aoMatar: chamado quando um NAPS2 de listagem teve de ser encerrado (pra limpar o que ele deixou)
// cancelado(): se ficar true, as buscas param na hora (os processos sao encerrados)
async function listar({ exe, driver, env, onAchado, incluirTwain = true, aoMatar, cancelado = () => false } = {}) {
  const achados = [];
  const achou = (ap) => {
    if (!ap || achados.some((x) => chaveDe(x) === chaveDe(ap))) return;
    achados.push(ap);
    if (onAchado) { try { onAchado(ap); } catch {} }
  };
  const quer = (d) => !driver || driver === "auto" || driver === d;
  const tarefas = [];
  if (quer("wia")) tarefas.push(listarWia(cancelado).then((l) => l.forEach(achou)).catch(() => {}));
  if (quer("escl")) tarefas.push(listarRede(exe, env, aoMatar, cancelado).then((l) => l.forEach(achou)).catch(() => {}));
  if (quer("twain") && incluirTwain && exe) {
    tarefas.push(listarNaps2(exe, "twain", 45000, env, cancelado).then((r) => {
      if (r.morto && aoMatar) aoMatar();
      r.nomes.forEach((n) => achou({ driver: "twain", nome: n, caps: null, fonteCaps: null }));
    }).catch(() => {}));
  }
  await Promise.all(tarefas);
  return achados;
}

// quando ninguem escolheu o scanner. Por niveis: USB (WIA) que responde > rede com informacao >
// os que falharam > TWAIN (a lista do TWAIN mostra o que esta INSTALADO, mesmo desligado).
// So escolhe sozinho se o melhor nivel tiver UM aparelho e nao houver um scanner TWAIN de
// OUTRO modelo instalado (muito scanner de folhas so tem TWAIN); senao o usuario escolhe — num
// escritorio, escanear o aparelho errado pode puxar o papel de outra pessoa.
// -> { ap } | { varios: [...] } | { nenhum: true }
function escolherAutomatico(lista) {
  const v = (lista || []).filter((a) => a && a.driver);
  const twain = v.filter((a) => a.driver === "twain");
  const outros = v.filter((a) => a.driver !== "twain");
  const niveis = [
    v.filter((a) => a.driver === "wia" && !a.erro),
    v.filter((a) => a.driver === "escl" && a.caps),
    v.filter((a) => (a.driver === "wia" && a.erro) || (a.driver === "escl" && !a.caps)),
    twain,
  ];
  for (const n of niveis) {
    if (n.length > 1) return { varios: n };
    if (n.length === 1) {
      const x = n[0];
      if (x.driver === "twain") return { ap: x };
      // TWAIN que nao e so "o mesmo aparelho por outro caminho" -> pergunta
      const twainDeOutro = twain.filter((tw) => !outros.some((o) => mesmoModelo(o.nome, tw.nome)));
      return twainDeOutro.length ? { varios: [x, ...twainDeOutro] } : { ap: x };
    }
  }
  return { nenhum: true };
}
const nivelDe = (ap) => (!ap ? 9 : ap.driver === "wia" && !ap.erro ? 0 : ap.driver === "escl" && ap.caps ? 1 : ap.driver === "twain" ? 3 : 2);

/* =================================== conferir =================================== */
// confere UM aparelho antes de escanear: ele responde? e ELE MESMO (nao outro no mesmo endereco)?
// o que ele tem? -> { ap (pode vir atualizado: IP/porta/id novos), caps|null, fonte,
//                     online: true|false|null (null = nao da pra saber sem escanear), papel?, outro? }
async function conferir(ap, { exe, env, verificarTwain = false } = {}) {
  if (!ap) return { ap, caps: null, online: false };
  if (ap.driver === "escl") {
    let caps = ap.base ? await escl.lerCapacidades(ap.base) : null;
    let novo = ap, outro = null;
    if (caps && !mesmoAparelho(ap, caps, null)) { outro = caps.modelo || "outro aparelho"; caps = null; } // outro no mesmo endereco
    else if (caps && !ap.uuid && caps.uuid) novo = Object.assign({}, ap, { uuid: caps.uuid }); // e ele: guarda o uuid
    if (!caps) {
      // trocou de IP (DHCP) ou de porta? procura de novo na rede — pelo uuid, se ja se sabe
      const achados = await escl.procurarNaRede();
      const a = ap.uuid
        ? achados.find((x) => x.uuid && normUuid(x.uuid) === normUuid(ap.uuid))
        : achados.find((x) => x.enderecos.some((e) => e.ip && e.ip === ap.ip));
      if (a) {
        for (const e of a.enderecos) {
          if (!e.base) continue;
          const cp = await escl.lerCapacidades(e.base);
          if (cp && mesmoAparelho(ap, cp, a)) { caps = cp; novo = Object.assign({}, ap, { ip: e.ip, base: e.base, uuid: ap.uuid || a.uuid || cp.uuid }); break; }
          if (cp && !outro) outro = cp.modelo || a.modelo || "outro aparelho";
        }
      }
      if (!caps && ap.ip && !outro) {
        const ach = await escl.acharEndereco(ap.ip);
        if (ach && mesmoAparelho(ap, ach.caps, null)) { caps = ach.caps; novo = Object.assign({}, ap, { base: ach.base, uuid: ap.uuid || ach.caps.uuid }); }
        else if (ach) outro = ach.caps.modelo || "outro aparelho";
      }
    }
    if (!caps) return { ap, caps: null, online: false, outro };
    return { ap: novo, caps: capsSimples(caps), fonte: "escl", online: true };
  }
  if (ap.driver === "wia") {
    let d = await wia.ler(ap.id);
    if (!d) return { ap, caps: null, online: null };          // nao deu pra perguntar (o NAPS2 decide)
    let novo = ap;
    if (d.ausente || (d.nome && ap.nome && d.nome !== ap.nome)) {
      // o numero do aparelho muda com a porta USB (e de um PC pro outro): procura pelo nome
      const r = await wia.listarTudo();
      const iguais = r.itens.filter((x) => x.nome && x.nome === ap.nome);
      if (iguais.length !== 1) return { ap, caps: null, online: r.completo && !iguais.length ? false : null }; // lista cortada ou 2 iguais: nao sei
      d = iguais[0];
      novo = Object.assign({}, ap, { id: d.id });
    }
    if (d.vidro == null && d.alimentador == null) return { ap: novo, caps: null, online: d.erro ? null : true };
    return { ap: novo, caps: capsSimples(d), fonte: "wia", online: true, papel: d.papel };
  }
  if (ap.driver === "twain" && exe && verificarTwain) {
    // TWAIN: so da pra ver se a fonte esta instalada NESTE PC (ligado ou nao, so escaneando).
    // Abre o NAPS2, entao fica pro segundo plano / "Detectar", nao pra cada digitalizacao.
    const r = await listarNaps2(exe, "twain", 45000, env);
    if (!r.morto && !r.nomes.includes(ap.nome)) return { ap, caps: null, online: false };
  }
  return { ap, caps: null, online: null };
}

const ERROS_ADF = { atolado: "atolado", tampa_aberta: "tampa_aberta", erro_adf: "atolado" };

// tem papel no alimentador AGORA? { papel: true|false|null } ou { erro } (atolado, tampa aberta, ocupado, desligado)
async function lerPapel(ap, avisar = () => {}, cancelado = () => false) {
  if (ap && ap.driver === "escl" && ap.base) {
    let st = await escl.lerEstado(ap.base);
    // aquecendo / terminando outro trabalho: espera um pouco (o NAPS2 recusa nesses estados)
    for (let i = 0; st && !ERROS_ADF[st.adf] && (st.estado === "aquecendo" || st.estado === "ocupado") && i < 8; i++) {
      if (cancelado()) return { erro: "cancelado" };
      avisar(st.estado === "aquecendo" ? "A impressora está aquecendo…" : "A impressora está ocupada, aguardando…");
      await esperar(1500);
      st = (await escl.lerEstado(ap.base)) || st;
    }
    if (!st) return { papel: null };
    if (ERROS_ADF[st.adf]) return { erro: ERROS_ADF[st.adf] }; // antes do estado geral: esperar nao desatola papel
    if (st.estado === "desligado") return { erro: "offline" };
    if (st.estado === "ocupado" || st.estado === "aquecendo" || st.estado === "parado") return { erro: "ocupado" };
    if (st.adf === "com_papel") return { papel: true };
    if (st.adf === "vazio") return { papel: false };
    return { papel: null }; // sem alimentador, "processando" ou desconhecido
  }
  if (ap && ap.driver === "wia" && ap.id) {
    const d = await wia.ler(ap.id);
    return { papel: d && !d.ausente ? (d.papel === true ? true : d.papel === false ? false : null) : null };
  }
  return { papel: null };
}

/* ================================== planejar ================================== */
// pedido: "auto" | "alimentador" | "vidro"; caps: { vidro, alimentador, duplex } (null = nao sei)
// papel: true | false | null; duplex: o usuario quer frente e verso
// -> { fontes: ["feeder"|"duplex"|"glass", ...em ordem], motivo } ou { erro }
function planejarFontes({ pedido = "auto", caps = null, papel = null, duplex = false } = {}) {
  const c = caps || {};
  const temAlim = c.alimentador !== false, temVidro = c.vidro !== false;
  const alim = duplex && c.duplex !== false && temAlim ? "duplex" : "feeder";
  if (!temAlim && !temVidro) return { fontes: ["glass"], motivo: "desconhecido" };
  if (pedido === "vidro") {
    if (!temVidro) return { fontes: [alim], motivo: "sem_vidro" }; // scanner de folhas: so o alimentador
    return { fontes: ["glass"], motivo: "pedido" };
  }
  if (pedido === "alimentador") {
    if (!temAlim) return { erro: "sem_alimentador" };
    return { fontes: [alim], motivo: "pedido" };
  }
  if (!temAlim) return { fontes: ["glass"], motivo: "so_vidro" };
  if (!temVidro) return { fontes: [alim], motivo: "so_alimentador" };
  if (papel === true) return { fontes: [alim], motivo: "papel_no_alimentador" };
  if (papel === false) return { fontes: ["glass"], motivo: "alimentador_vazio" };
  return { fontes: [alim, "glass"], motivo: "tentar" };
}

module.exports = {
  TIPOS, tipoDe, chaveDe, normUuid, mesmoUuid, mesmoModelo, mesmoAparelho, nomeLimpo, ipDoNome, semIp, limparAp, capsSimples, nivelDe,
  listar, listarNaps2, matarArvore, escolherAutomatico, conferir, lerPapel, planejarFontes,
};
