"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let cfg = null;
let modo = "dossie"; // "dossie" | "documentos"
let paginas = [];    // { id, thumb, giro, w, h, tipo:null|sigla|"@IND", colorido, recortada }
let sel = new Set();
let ancora = null;   // ultima pagina clicada (pro shift)
let ocupado = false;
let appVersao = "";

// pagina da tela a partir do que o main devolve
function novaPagina(r) {
  return { id: r.id, thumb: r.thumb, giro: r.giro, w: r.w, h: r.h, tipo: null, colorido: !!r.colorido, recortada: !!r.recortada,
    incerto: !!r.incerto, digital: r.digital || "", repetidaDe: null, tipoAuto: false, lendo: false };
}
// atualiza a pagina da tela com o resultado de girar/recortar/cor
function atualizarPagina(r) {
  const p = r && paginas.find((x) => x.id === r.id);
  if (!p) return null;
  Object.assign(p, { thumb: r.thumb, giro: r.giro, w: r.w, h: r.h, colorido: !!r.colorido, recortada: !!r.recortada,
    incerto: !!r.incerto, digital: r.digital || p.digital });
  return p;
}

// ---------------- aviso flutuante (some sozinho) ----------------
let _toastTimer = null;
function toast(html, tipo = "aviso", ms = 9000) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); el.onclick = () => el.classList.remove("on"); }
  el.className = "toast " + tipo;
  el.innerHTML = html + '<span class="toast-x">✕</span>';
  requestAnimationFrame(() => el.classList.add("on"));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("on"), ms);
}

// ---------------- pagina repetida (alimentador puxou de novo / escaneou 2x) ----------------
const DIG_W = 120, DIG_H = 168; // mesmo tamanho do pipeline.digital
const _cacheDigital = new Map();
function _bytesDigital(d) {
  if (_cacheDigital.has(d)) return _cacheDigital.get(d);
  let b = null;
  try { b = Uint8Array.from(atob(d), (c) => c.charCodeAt(0)); } catch {}
  if (_cacheDigital.size > 400) _cacheDigital.clear();
  _cacheDigital.set(d, b);
  return b;
}
// diferenca media entre duas "impressoes digitais" (0 = identicas). alinhar=true procura o melhor
// encaixe (+-5 px na miniatura) — pega a mesma folha escaneada de novo um pouco deslocada
function diferencaDigital(a, b, alinhar = false) {
  const x = _bytesDigital(a), y = _bytesDigital(b);
  if (!x || !y || x.length !== y.length || x.length !== DIG_W * DIG_H) return 255;
  const M = alinhar ? 5 : 0;
  let melhor = 255;
  for (let dy = -M; dy <= M; dy++) for (let dx = -M; dx <= M; dx++) {
    let s = 0, n = 0;
    for (let yy = 5; yy < DIG_H - 5; yy++) {
      const la = yy * DIG_W, lb = (yy + dy) * DIG_W + dx;
      for (let xx = 5; xx < DIG_W - 5; xx++) { s += Math.abs(x[la + xx] - y[lb + xx]); n++; }
    }
    if (s / n < melhor) melhor = s / n;
  }
  return melhor;
}
// confere as paginas novas: a mesma folha logo em seguida (com encaixe, < 4.5) ou identica a
// qualquer outra (sem encaixe, < 2). Limites escolhidos pra nao acusar 2 contas do mesmo modelo.
function conferirNovasPaginas(novas) {
  const avisos = [];
  for (const p of novas) {
    const i = paginas.indexOf(p);
    if (i < 0 || !p.digital) continue;
    for (let j = i - 1; j >= 0; j--) { // so com as que vieram antes (nao avisa o mesmo par 2 vezes)
      if (!paginas[j].digital) continue;
      const repetida = j === i - 1 ? diferencaDigital(p.digital, paginas[j].digital, true) < 4.5
        : diferencaDigital(p.digital, paginas[j].digital) < 2;
      if (repetida) { p.repetidaDe = paginas[j].id; avisos.push(`a página ${i + 1} parece igual à ${j + 1}`); break; }
    }
  }
  const incertas = novas.filter((p) => p.incerto).map((p) => paginas.indexOf(p) + 1).filter((n) => n > 0);
  const partes = [];
  if (avisos.length) partes.push(`<b>≈ Página repetida?</b> ${avisos.slice(0, 3).join("; ")}${avisos.length > 3 ? "…" : ""}. Confira e apague a que sobrou.`);
  if (incertas.length) partes.push(`<b>↻? Não tive certeza do lado</b> da${incertas.length > 1 ? "s" : ""} página${incertas.length > 1 ? "s" : ""} ${incertas.slice(0, 6).join(", ")}${incertas.length > 6 ? "…" : ""}. Confira (R gira).`);
  if (partes.length) toast(partes.join("<br>"));
  // reconhecer o tipo sozinho (se ligado, no modo documento por documento)
  if (window.Assistente) window.Assistente.paginasNovas(novas);
}

// ---------------- desfazer (Ctrl+Z) ----------------
// cada acao guarda como voltar atras. Paginas removidas ficam na lixeira do main ate sair da pilha.
const pilhaDesfazer = [];
const MAX_DESFAZER = 30;
function registrarDesfazer(rotulo, desfazerFn, purgar) {
  pilhaDesfazer.push({ rotulo, desfazer: desfazerFn, purgar: purgar || [] });
  while (pilhaDesfazer.length > MAX_DESFAZER) {
    const velho = pilhaDesfazer.shift();
    if (velho.purgar.length) window.api.purgarLixeira(velho.purgar);
  }
  atualizarBotaoDesfazer();
}
function zerarDesfazer() {
  const ids = pilhaDesfazer.flatMap((a) => a.purgar);
  pilhaDesfazer.length = 0;
  if (ids.length) window.api.purgarLixeira(ids);
  atualizarBotaoDesfazer();
}
function atualizarBotaoDesfazer() {
  const b = $("#btnDesfazer");
  if (!b) return;
  const ult = pilhaDesfazer[pilhaDesfazer.length - 1];
  b.disabled = !ult || ocupado;
  b.title = ult ? `Desfazer: ${ult.rotulo} (Ctrl+Z)` : "Nada para desfazer (Ctrl+Z)";
}
async function desfazer() {
  if (ocupado) return;
  const a = pilhaDesfazer.pop();
  if (!a) { setStatus("Nada para desfazer."); return; }
  ocupado = true; atualizarBotoesFonte();
  try {
    await a.desfazer();
    setStatus(`↶ Desfeito: ${a.rotulo}.`, "ok");
  } catch (e) {
    setStatus("Não consegui desfazer: " + e.message, "erro");
  } finally {
    ocupado = false; atualizarBotoesFonte(); renderGrade();
    if (ancora && paginas.some((p) => p.id === ancora)) mostrarPrevia(ancora);
    else { ancora = null; $("#previa").style.display = "none"; $("#previaVazia").style.display = "block"; }
    if (window.Visor) window.Visor.atualizar();
  }
}
// guarda a ordem (e os tipos, se comTipos) atuais pra voltar depois (acoes que so mexem na tela).
// Acao que so muda a ORDEM nao guarda os tipos: desfazer ela nao pode apagar os tipos que o
// reconhecimento marcou depois
function fotoDaTela(comTipos = true) {
  return {
    ordem: paginas.map((p) => p.id),
    tipos: comTipos ? new Map(paginas.map((p) => [p.id, { tipo: p.tipo, auto: !!p.tipoAuto }])) : null,
  };
}
function voltarFoto(f) {
  const porId = new Map(paginas.map((p) => [p.id, p]));
  const reordenadas = f.ordem.map((id) => porId.get(id)).filter(Boolean);
  // paginas que entraram depois (nao estavam na foto) vao pro fim, na ordem que estavam
  for (const p of paginas) if (!f.ordem.includes(p.id)) reordenadas.push(p);
  paginas = reordenadas;
  if (f.tipos) for (const p of paginas) if (f.tipos.has(p.id)) { const t = f.tipos.get(p.id); p.tipo = t.tipo; p.tipoAuto = t.auto; }
}

const CORES_TIPO = ["#2f6feb", "#1f9d57", "#b7791f", "#8b5cf6", "#e05a8a", "#0ea5a3", "#d1352c", "#5a6572"];
const PREP = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "DI", "DU", "A", "O", "PARA", "COM", "EM", "DAS", "NA", "NO"]);

// gera uma sigla curta e boa a partir do nome do tipo
function siglaAuto(nome) {
  const w = String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((x) => x && !PREP.has(x));
  if (!w.length) return "DOC";
  let s = w.join("_");
  if (s.length <= 12) return s;
  s = w[0] + "_" + w.slice(1).map((x) => x[0]).join("");
  if (s.length <= 16) return s;
  return w[0].slice(0, 12);
}
// proxima tecla livre (1..9,0)
function proxTecla() {
  const usadas = new Set(cfg.tipos.map((t) => t.tecla).filter(Boolean));
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) if (!usadas.has(k)) return k;
  return "";
}

// mini-caixa de texto (o window.prompt nao funciona no Electron)
function pedirTexto(titulo, valor = "", multi = false) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "modal";
    ov.innerHTML = `<div class="modal-cx" style="width:460px">
      <div class="modal-cab"><h2>${esc(titulo)}</h2></div>
      <div class="modal-corpo">
        ${multi
          ? `<textarea id="pt-in" rows="8" style="width:100%;font-size:14px;padding:8px;border-radius:8px;border:1px solid var(--borda);background:var(--bg);color:var(--texto)" placeholder="Um por linha…"></textarea>`
          : `<input id="pt-in" type="text" style="width:100%;font-size:15px;padding:9px;border-radius:8px;border:1px solid var(--borda);background:var(--bg);color:var(--texto)" />`}
      </div>
      <div class="modal-rod"><span class="flex1"></span>
        <button class="btn-sec" id="pt-cancel">Cancelar</button>
        <button class="btn-salvar" id="pt-ok">OK</button></div></div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector("#pt-in");
    inp.value = valor; inp.focus(); if (!multi) inp.select();
    const fim = (v) => { ov.remove(); resolve(v); };
    ov.querySelector("#pt-ok").onclick = () => fim(inp.value.trim());
    ov.querySelector("#pt-cancel").onclick = () => fim(null);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) fim(null); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (!multi || e.ctrlKey)) fim(inp.value.trim());
      if (e.key === "Escape") fim(null);
      e.stopPropagation();
    });
  });
}

async function novoTipoRapido() {
  const nome = await pedirTexto("Nome do novo tipo de documento");
  if (!nome) return;
  const sigla = siglaAuto(nome);
  cfg.tipos.push({ nome, sigla, tecla: proxTecla(), colorido: false });
  await window.api.saveConfig(cfg);
  renderTipos();
  if (sel.size) aplicarTipo(sigla, false);
  setStatus(`Tipo "${nome}" criado (arquivo: ${sigla}.pdf).`, "ok");
}

// ---------------- init ----------------
async function init() {
  cfg = await window.api.getConfig();
  try { appVersao = await window.api.versao(); } catch {}
  aplicarTema();
  $("#selNivel").value = cfg.compressaoPadraoDossie;
  renderTipos();
  bind();
  await carregarAssociados();
  atualizarBotoesFonte();
  setStatus("Pronto.");
  window.api.onProgresso(onProgresso);
  window.api.onCelularFoto(aoReceberFotoCelular);
  window.api.onScannerMudou(aplicarScannerInfo);
  window.api.onScannerAchado((ap) => { if (_aoAcharScanner) _aoAcharScanner(ap); });
  window.api.scannerInfo().then(aplicarScannerInfo).catch(() => {});
  avisarSePastaDesconectada();
}

// a pasta escolhida pra salvar (HD externo, pendrive, rede) nao esta conectada agora?
async function avisarSePastaDesconectada() {
  try {
    const st = await window.api.statusPasta();
    if (!st || st.ok) return;
    mostrarAviso("⚠ Pasta dos documentos desconectada",
      `A pasta escolhida pra salvar não está conectada agora:<br><b>${esc(st.configurada)}</b><br><br>` +
      `Enquanto isso, os PDFs vão para:<br><b>${esc(st.usando)}</b><br><br>` +
      `Quando ela voltar, o DigiDoc volta a salvar lá sozinho — a sua escolha continua guardada nas Configurações.`);
  } catch {}
}

function aplicarTema() {
  document.documentElement.setAttribute("data-theme", cfg.tema === "escuro" ? "escuro" : "claro");
}

function setStatus(txt, tipo = "") {
  const el = $("#status");
  el.textContent = txt;
  el.className = "status" + (tipo ? " " + tipo : "");
}

// ---------------- associados (autocompletar) ----------------
let nomesAssociados = [];
async function carregarAssociados() {
  const nomes = await window.api.listarAssociados();
  nomesAssociados = nomes;
  $("#listaAssociados").innerHTML = nomes.map((n) => `<option value="${esc(n)}">`).join("");
}

// ---- nome parecido com um que ja existe (evita pasta duplicada: "Maria Silva" x "Maria da Silva") ----
const _semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
function chaveNome(s) { return _semAcento(s).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !PREP.has(w)); }
function distancia(a, b) { // Levenshtein
  if (Math.abs(a.length - b.length) > 3) return 99;
  let ant = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = cur;
  }
  return ant[b.length];
}
function nomesParecidos(nome) {
  const k = chaveNome(nome);
  if (k.length < 2 || nome.trim().length < 6) return [];
  const kj = k.join(" ");
  const achados = [];
  for (const n of nomesAssociados) {
    const kn = chaveNome(n), knj = kn.join(" ");
    if (knj === kj) { if (_semAcento(n).trim() !== _semAcento(nome).trim()) achados.push({ n, p: 0 }); continue; }
    const d = distancia(kj, knj);
    // erro de digitacao (1-2 letras) ou um nome contido no outro ("Maria Silva" em "Maria Aparecida Silva")
    const contido = k.length >= 2 && k.every((w) => kn.includes(w)) && k[0] === kn[0];
    if (d <= (kj.length >= 12 ? 2 : 1)) achados.push({ n, p: d });
    else if (contido) achados.push({ n, p: 3 });
  }
  return achados.sort((a, b) => a.p - b.p).slice(0, 3).map((x) => x.n);
}

let docsAssoc = []; // PDFs ja salvos do associado atual (pra marcar os tipos)
async function onAssociadoMudou() {
  const nome = $("#inpAssociado").value.trim();
  // o botao Salvar depende do nome: digitar/colar o nome DEPOIS de escanear deixava ele desativado
  // (bug antigo — so voltava ao clicar numa pagina)
  atualizarSalvar();
  if (window.Assistente) window.Assistente.nomeMudou(nome);
  const letra = nome ? primeiraLetra(nome) : "?";
  $("#letraBadge").textContent = letra;
  const cont = $("#assocDocs");
  if (!nome) { cont.innerHTML = ""; docsAssoc = []; renderTipos(); renderResumoDocs(); if (window.Fila) window.Fila.atualizarChip(); return; }
  docsAssoc = await window.api.docsAssociado(nome);
  if ($("#inpAssociado").value.trim() !== nome) return; // digitou mais enquanto lia a pasta
  const parecidos = docsAssoc.length ? [] : nomesParecidos(nome);
  cont.innerHTML = docsAssoc.length
    ? docsAssoc.map((d) => `<button class="doc-chip" data-arq="${esc(d)}" title="Já salvo — clique para abrir o PDF">✓ ${esc(d)}</button>`).join("")
    : `<span style="color:var(--texto-fraco);font-size:12px">pasta nova (nenhum PDF ainda)</span>` +
      (parecidos.length ? `<span class="parecido-txt">⚠ Parecido com:</span>` +
        parecidos.map((n) => `<button class="parecido-chip" data-nome="${esc(n)}" title="Usar o nome que já existe (evita pasta duplicada)">${esc(n)}</button>`).join("") : "");
  cont.querySelectorAll(".parecido-chip").forEach((b) => {
    b.onclick = () => { $("#inpAssociado").value = b.dataset.nome; onAssociadoMudou(); setStatus(`Usando o associado que já existe: ${b.dataset.nome}`, "ok"); };
  });
  cont.querySelectorAll(".doc-chip").forEach((b) => {
    b.onclick = async () => {
      const ok = await window.api.abrirDocAssociado(nome, b.dataset.arq);
      setStatus(ok ? `Abrindo ${b.dataset.arq}…` : `Não achei ${b.dataset.arq} na pasta.`, ok ? "" : "aviso");
    };
  });
  renderTipos();
  renderResumoDocs();
  if (window.Fila) window.Fila.atualizarChip();
}

// um tipo ja foi salvo pra este associado?
// a sigla como ela vira nome de arquivo (igual ao files.js: sem acento, espaco vira _, maiuscula).
// Comparar a sigla "crua" com o nome do arquivo falhava em sigla com acento ou espaco
function siglaArquivo(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toUpperCase();
}
const siglaDoNomeArquivo = (f) => String(f || "").toUpperCase().replace(/\.PDF$/, "").replace(/_\d+$/, "");
function tipoJaSalvo(sigla) {
  const alvo = siglaArquivo(sigla);
  return docsAssoc.some((f) => siglaDoNomeArquivo(f) === alvo);
}

function primeiraLetra(nome) {
  const m = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : "#";
}

// ---------------- tipos de documento ----------------
function renderTipos() {
  const ck = $("#chkReconhecer");
  if (ck) ck.checked = !!cfg.reconhecerTipo;
  const cont = $("#botoesTipos");
  cont.innerHTML = "";
  cfg.tipos.forEach((t, i) => {
    const b = document.createElement("button");
    const salvo = tipoJaSalvo(t.sigla);
    b.className = "btn-tipo" + (salvo ? " ja-salvo" : "");
    b.title = salvo ? "Já tem PDF salvo pra este associado" : "";
    b.innerHTML = `<span class="bolinha" style="width:10px;height:10px;border-radius:50%;background:${CORES_TIPO[i % CORES_TIPO.length]}"></span>
      <span>${esc(t.nome)}</span>${salvo ? '<span class="feito">✓</span>' : ""}${t.tecla ? `<span class="tecla">${esc(t.tecla)}</span>` : ""}`;
    b.onclick = () => aplicarTipo(t.sigla, t.colorido);
    cont.appendChild(b);
  });
  // botao "+ Novo tipo" (cria na hora, sem abrir configuracoes)
  const add = document.createElement("button");
  add.className = "btn-tipo novo";
  add.style.borderStyle = "dashed";
  add.innerHTML = `<span style="font-size:17px;color:var(--acento)">＋</span><span>Novo tipo</span>`;
  add.onclick = novoTipoRapido;
  cont.appendChild(add);
}
function corDoTipo(sigla) {
  const i = cfg.tipos.findIndex((t) => t.sigla === sigla);
  return i >= 0 ? CORES_TIPO[i % CORES_TIPO.length] : "#5a6572";
}
function nomeDoTipo(sigla) {
  if (sigla === "@IND") return "documento avulso";
  const t = cfg.tipos.find((t) => t.sigla === sigla);
  return t ? t.nome : sigla;
}

// ---------------- grade de paginas ----------------
function renderGrade() {
  const g = $("#grade");
  $("#vazio").classList.toggle("oculto", paginas.length > 0);
  // remove cartoes antigos (mantem o .vazio)
  $$(".pag").forEach((e) => e.remove());
  paginas.forEach((p, idx) => {
    const d = document.createElement("div");
    d.className = "pag" + (sel.has(p.id) ? " sel" : "");
    d.dataset.id = p.id;
    // etiqueta do tipo: clicar abre a lista pra trocar (✨ = o DigiDoc reconheceu sozinho)
    let tipoTag = "";
    if (modo === "documentos" && p.lendo) {
      tipoTag = `<div class="pag-tipo lendo">🔎 lendo…</div>`;
    } else if (modo === "documentos" && p.tipo) {
      tipoTag = `<div class="pag-tipo clicavel" style="background:${corDoTipo(p.tipo)}" title="${p.tipoAuto ? "Reconhecido sozinho" + (p.motivoAuto ? " (" + esc(p.motivoAuto) + ")" : "") + " — clique pra trocar" : "Clique pra trocar o tipo"}">${p.tipoAuto ? "✨ " : ""}${esc(nomeDoTipo(p.tipo))} ▾</div>`;
    } else if (modo === "documentos") {
      tipoTag = `<div class="pag-tipo clicavel sem-tipo" title="Clique pra escolher o tipo">＋ tipo ▾</div>`;
    }
    const igual = p.repetidaDe ? paginas.findIndex((x) => x.id === p.repetidaDe) + 1 : 0; // numero atual da pagina igual
    const marcas = (p.incerto ? `<span class="m-alerta" title="Não tive certeza do lado desta página — confira (R gira)">↻?</span>` : "") +
      (igual ? `<span class="m-alerta" title="Parece igual à página ${igual} — confira se não escaneou duas vezes">≈${igual}</span>` : "") +
      (p.colorido ? `<span title="colorida">🎨</span>` : "") + (p.recortada ? `<span title="recortada">✂</span>` : "");
    d.innerHTML = `<img src="${p.thumb || ""}" alt="pág ${idx + 1}" draggable="false" />
      <span class="pag-num">${idx + 1}</span>
      <span class="pag-check">${sel.has(p.id) ? "✓" : ""}</span>${marcas ? `<span class="pag-marcas">${marcas}</span>` : ""}${tipoTag}`;
    d.onclick = (e) => {
      const tag = e.target.closest && e.target.closest(".pag-tipo.clicavel");
      if (tag && window.Assistente) { e.stopPropagation(); window.Assistente.menuTipo(p.id, tag); return; }
      clicarPagina(p.id, e);
    };
    d.ondblclick = (e) => { if (e.target.closest && e.target.closest(".pag-tipo")) return; if (window.Visor) window.Visor.abrir(p.id); };
    d.draggable = true;
    d.addEventListener("dragstart", (e) => { arrastando = p.id; d.classList.add("arrastando"); e.dataTransfer.effectAllowed = "move"; });
    d.addEventListener("dragend", () => { arrastando = null; $$(".pag").forEach((x) => x.classList.remove("arrastando", "alvo")); });
    d.addEventListener("dragover", (e) => { e.preventDefault(); if (arrastando && arrastando !== p.id) d.classList.add("alvo"); });
    d.addEventListener("dragleave", () => d.classList.remove("alvo"));
    d.addEventListener("drop", (e) => { e.preventDefault(); soltarEm(p.id); });
    g.appendChild(d);
  });
  $("#contadorPags").textContent = `${paginas.length} página${paginas.length === 1 ? "" : "s"}` +
    (sel.size ? ` · ${sel.size} marcada${sel.size === 1 ? "" : "s"}` : "");
  renderResumoDocs();
  atualizarSalvar();
}

let arrastando = null;
function soltarEm(idAlvo) {
  if (!arrastando || arrastando === idAlvo) return;
  const de = paginas.findIndex((p) => p.id === arrastando);
  const para = paginas.findIndex((p) => p.id === idAlvo);
  if (de < 0 || para < 0) return;
  const foto = fotoDaTela(false);
  registrarDesfazer("mudar a ordem", async () => voltarFoto(foto));
  const [item] = paginas.splice(de, 1);
  paginas.splice(para, 0, item);
  renderGrade();
}

function clicarPagina(id, e) {
  if (e.shiftKey && ancora) {
    const i0 = paginas.findIndex((p) => p.id === ancora);
    const i1 = paginas.findIndex((p) => p.id === id);
    const [a, b] = [Math.min(i0, i1), Math.max(i0, i1)];
    if (!e.ctrlKey) sel.clear();
    for (let i = a; i <= b; i++) sel.add(paginas[i].id);
  } else if (e.ctrlKey) {
    sel.has(id) ? sel.delete(id) : sel.add(id);
    ancora = id;
  } else {
    sel.clear(); sel.add(id); ancora = id;
  }
  renderGrade();
  mostrarPrevia(id);
}

let _previaPedida = 0;
async function mostrarPrevia(id) {
  const img = $("#previa"), vaz = $("#previaVazia");
  const minha = ++_previaPedida;
  const big = await window.api.previa(id, 900);
  if (minha !== _previaPedida) return; // andou pra outra pagina enquanto esta carregava
  if (big) { img.src = big; img.style.display = "block"; vaz.style.display = "none"; }
}

// ---------------- adicionar / origens ----------------
// scanner configurado em "Colorido": a pagina ja entra colorida. Importadas/coladas entram em cinza
// (o botao 🎨 Cor ou um tipo marcado como colorido, ex.: Foto 3x4, deixam colorida depois)
function coloridoAtual(origem) {
  return origem === "scanner" && !!(cfg && cfg.scanner && cfg.scanner.cor === "cor");
}

function mostrarOverlay(msg) { $("#overlayMsg").textContent = msg; $("#barraFill").style.width = "0%"; $("#overlay").classList.remove("oculto"); }
function esconderOverlay() { $("#overlay").classList.add("oculto"); }

function onProgresso(d) {
  if (d.tipo === "pagina") {
    if (d.feito === 0) $("#btnCancelarScan").classList.add("oculto"); // o scanner terminou: nao ha mais o que cancelar
    const pct = d.total ? Math.round((d.feito / d.total) * 100) : 0;
    $("#barraFill").style.width = pct + "%";
    $("#overlayMsg").textContent = `Processando página ${d.feito} de ${d.total}…`;
  } else if (d.tipo === "scan") {
    $("#overlayMsg").textContent = d.msg;
  } else if (d.tipo === "pdf") {
    $("#overlayMsg").textContent = `Gerando ${d.nome}… (página ${d.pagina}/${d.total})`;
  } else if (d.tipo === "atualizacao") {
    const mb = (b) => (b / 1048576).toFixed(1).replace(".", ",");
    if (d.etapa === "baixando") {
      $("#overlayMsg").textContent = `Baixando a atualização… ${mb(d.feito)}${d.total ? " de " + mb(d.total) : ""} MB`;
      $("#barraFill").style.width = (d.total ? Math.round((d.feito / d.total) * 100) : 0) + "%";
    } else $("#overlayMsg").textContent = "Preparando a atualização…";
  }
}

// importacao de varios arquivos/paginas: junta os avisos (repetida / lado incerto) num so no fim
let _loteNovas = null;
function adicionarResultados(res) {
  let brancas = 0, erros = 0;
  const novas = [];
  for (const r of res) {
    if (!r) continue;
    if (r.branca) { brancas++; continue; }
    if (r.erro) { erros++; continue; }
    const p = novaPagina(r);
    paginas.push(p); novas.push(p);
  }
  if (novas.length) { if (_loteNovas) _loteNovas.push(...novas); else conferirNovasPaginas(novas); }
  renderGrade();
  if (paginas.length && !sel.size) { sel.add(paginas[paginas.length - 1].id); ancora = paginas[paginas.length - 1].id; mostrarPrevia(ancora); renderGrade(); }
  return { brancas, erros };
}

// origem: "auto" (descobre sozinho: alimentador se tiver papel, senao vidro) | "alimentador" | "vidro"
let _cancelouScan = false;
async function escanear(origem = "auto") {
  if (ocupado) return;
  _cancelouScan = false;
  const temMotor = await window.api.scannerTemMotor();
  if (!temMotor) {
    setStatus("Motor de scanner (NAPS2) não encontrado. Use Importar ou iPhone, ou veja as instruções.", "aviso");
    abrirIphone();
    return;
  }
  ocupado = true; atualizarBotoesFonte();
  const cancelar = $("#btnCancelarScan");
  mostrarOverlay("Preparando o scanner…");
  cancelar.classList.remove("oculto");
  try {
    // 1) qual aparelho, o que ele tem e de onde vem o papel
    const p = await window.api.scannerPlanejar({ origem });
    if (_cancelouScan) { setStatus("Digitalização cancelada."); return; }
    if (!p.ok) {
      setStatus(p.msg || "Não consegui preparar o scanner.", "erro");
      if (p.escolher) { esconderOverlay(); abrirEscolhaScanner(p.msg, p.erro === "varios"); }
      return;
    }
    // 2) contador de folhas (anti puxa-2-folhas) — so quando comeca pelo alimentador
    let esperado = 0;
    if (p.usaAlimentador && cfg.scanner.perguntarFolhas) {
      esconderOverlay();
      // se vai SO pelo alimentador, o vidro nao e lido: diz isso na pergunta
      const soAlimentador = !(p.plano.fontes || []).includes("glass");
      const pergunta = soAlimentador
        ? "Vou ler o ALIMENTADOR. Quantas folhas você colocou nele? (deixe vazio pra pular — se o documento está no vidro, clique em Cancelar e use o botão Vidro)"
        : "Quantas folhas você colocou no alimentador? (deixe vazio pra pular — ou se o documento está no vidro)";
      const resp = await pedirTexto(pergunta);
      if (resp === null) { setStatus("Digitalização cancelada."); return; } // Cancelar = nao escaneia
      esperado = parseInt(resp) || 0;
      mostrarOverlay(p.texto);
      cancelar.classList.remove("oculto");
    } else {
      $("#overlayMsg").textContent = p.texto;
    }
    // 3) escaneia (se o alimentador estiver vazio no automatico, o app cai pro vidro sozinho)
    const r = await window.api.escanear({ origem, plano: p.plano, colorido: coloridoAtual("scanner") });
    if (!r.ok) {
      setStatus(r.msg, r.erro === "cancelado" ? "" : "erro");
      if (r.escolher) { esconderOverlay(); abrirEscolhaScanner(r.msg); }
      return;
    }
    adicionarResultados(r.paginas);
    const brancas = r.brancas || 0; // o main ja tirou as em branco: a contagem vem dele
    // no TWAIN o pedido de alimentador pode ter sido ignorado: ai nao da pra afirmar de onde veio
    const de = !r.origemCerta ? "" : r.fonte === "glass" ? " do vidro" : " do alimentador";
    let msg = `${r.paginas.length} página(s) adicionada(s)${de}.`;
    if (brancas) msg += ` ${brancas} em branco descartada(s).`;
    if (r.aviso) msg += " Atenção: " + r.aviso;
    let tipo = r.aviso ? "aviso" : "ok";
    if (!r.paginas.length && r.fonte === "glass" && (r.motivo === "tentar" || r.motivo === "alimentador_vazio")) {
      msg = "O vidro estava vazio. Se o papel está no alimentador, clique em 📚 Alimentador.";
      tipo = "aviso";
    }
    setStatus(msg, tipo);
    // frente e verso: 2 imagens por folha
    const folhasLidas = r.fonte === "duplex" ? Math.ceil(r.lidas / 2) : r.lidas;
    // "puxou folhas juntas" so faz sentido numa leitura completa e certa do alimentador
    // (se parou no meio ou atolou, o aviso de cima ja diz o que houve)
    if (esperado && r.fonte !== "glass" && r.origemCerta && !r.aviso && folhasLidas && folhasLidas < esperado) {
      alertaFolhas(esperado, folhasLidas);
    }
  } catch (e) {
    setStatus("Erro ao escanear: " + e.message, "erro");
  } finally {
    ocupado = false; atualizarBotoesFonte(); esconderOverlay();
    cancelar.classList.add("oculto");
  }
}

function mostrarAviso(titulo, msg, cor = "var(--amarelo)") {
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-cx" style="width:440px">
    <div class="modal-cab"><h2 style="color:${cor}">${esc(titulo)}</h2></div>
    <div class="modal-corpo" style="font-size:15px;line-height:1.6">${msg}</div>
    <div class="modal-rod"><span class="flex1"></span><button class="btn-salvar" id="av-ok">Entendi</button></div></div>`;
  document.body.appendChild(ov);
  const fim = () => ov.remove();
  ov.querySelector("#av-ok").onclick = fim;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) fim(); });
  ov.querySelector("#av-ok").focus();
}

function alertaFolhas(esperado, lidas) {
  mostrarAviso("⚠ Faltou página!",
    `Você colocou <b>${esperado} folha(s)</b>, mas só saíram <b>${lidas}</b>.<br><br>` +
    "O alimentador provavelmente <b>puxou folhas juntas</b>. " +
    "Escaneie a(s) que faltou no vidro e use arrastar (ou as setas) pra pôr na ordem certa.");
}

const EXT_IMAGEM = /\.(jpe?g|png|tif?f|bmp|webp|heic)$/i;

// imagens e PDFs juntos, na ordem em que vieram (escolhidos ou arrastados)
async function importarCaminhos(caminhos, rotulo = "") {
  const imgs = caminhos.filter((c) => EXT_IMAGEM.test(c));
  const pdfs = caminhos.filter((c) => /\.pdf$/i.test(c));
  if (!imgs.length && !pdfs.length) { setStatus("Escolha imagens (JPG, PNG, TIFF, BMP, WEBP, HEIC) ou PDFs.", "aviso"); return; }
  ocupado = true; atualizarBotoesFonte();
  mostrarOverlay(pdfs.length && !imgs.length ? "Abrindo o PDF…" : "Processando imagens…");
  let addImgs = 0, addPdf = 0, brancas = 0, erros = 0;
  const avisos = [];
  _loteNovas = [];
  try {
    for (const c of caminhos) {
      if (EXT_IMAGEM.test(c)) {
        const res = await window.api.addArquivos({ caminhos: [c], colorido: coloridoAtual("importar"), ehFoto: false });
        const r = adicionarResultados(res);
        brancas += r.brancas; erros += r.erros; addImgs += res.length - r.brancas - r.erros;
      } else if (/\.pdf$/i.test(c)) {
        if (!window.ImportarPDF) { avisos.push("leitor de PDF indisponível"); continue; }
        const r = await window.ImportarPDF.importar(c, (msg, feito, total) => {
          $("#overlayMsg").textContent = msg;
          $("#barraFill").style.width = (total ? Math.round((feito / total) * 100) : 0) + "%";
        });
        brancas += r.brancas; addPdf += r.adicionadas;
        if (r.erro) avisos.push(r.erro);
      }
    }
    const partes = [];
    if (addImgs) partes.push(`${addImgs} imagem(ns)`);
    if (addPdf) partes.push(`${addPdf} página(s) de PDF`);
    let msg = partes.length ? `${partes.join(" e ")} adicionada(s)${rotulo}.` : "Nenhuma página adicionada.";
    if (brancas) msg += ` ${brancas} em branco descartada(s).`;
    if (erros) msg += ` ${erros} com erro.`;
    if (avisos.length) msg += " " + avisos.join(" ");
    setStatus(msg, avisos.length || erros || !partes.length ? "aviso" : "ok");
  } finally {
    const lote = _loteNovas; _loteNovas = null;
    if (lote && lote.length) { conferirNovasPaginas(lote); renderGrade(); }
    ocupado = false; atualizarBotoesFonte(); esconderOverlay();
  }
}

async function importar() {
  if (ocupado) return;
  const caminhos = await window.api.importarDialog();
  if (!caminhos.length) return;
  await importarCaminhos(caminhos);
}

// ---------------- acoes de pagina ----------------
async function girarSel(graus = 90) {
  if (!sel.size || ocupado) return;
  const ids = paginas.filter((p) => sel.has(p.id)).map((p) => p.id);
  ocupado = true; atualizarBotoesFonte();
  if (ids.length > 3) mostrarOverlay("Girando…");
  try {
    for (const id of ids) atualizarPagina(await window.api.girarPagina(id, graus));
  } finally { ocupado = false; atualizarBotoesFonte(); esconderOverlay(); }
  registrarDesfazer(`girar ${ids.length} página(s)`, async () => {
    for (const id of ids) atualizarPagina(await window.api.girarPagina(id, -graus));
  });
  renderGrade();
  if (sel.size === 1) mostrarPrevia([...sel][0]);
}

// tira paginas da tela (vao pra lixeira do main; o Desfazer devolve no mesmo lugar)
async function removerPaginas(ids, rotulo) {
  if (!ids.length) return;
  const tirar = new Set(ids);
  const itens = paginas.map((p, i) => ({ p, i })).filter((x) => tirar.has(x.p.id));
  itens.forEach(({ p }) => (p.lendo = false)); // se voltar com Ctrl+Z, nao fica preso em "lendo…"
  for (const id of ids) await window.api.removerPagina(id);
  paginas = paginas.filter((p) => !tirar.has(p.id));
  for (const id of ids) sel.delete(id);
  if (ancora && tirar.has(ancora)) ancora = null;
  registrarDesfazer(rotulo || `remover ${ids.length} página(s)`, async () => {
    await window.api.restaurarPaginas(ids);
    for (const { p, i } of itens) paginas.splice(Math.min(i, paginas.length), 0, p); // em ordem crescente de posicao
  }, ids);
  if (!ancora) { $("#previa").style.display = "none"; $("#previaVazia").style.display = "block"; }
  renderGrade();
}

async function removerSel() {
  if (!sel.size || ocupado) return;
  const n = sel.size;
  await removerPaginas([...sel]);
  setStatus(`${n} página(s) removida(s). Ctrl+Z desfaz.`);
}

function moverSel(dir) {
  if (sel.size !== 1) return;
  const id = [...sel][0];
  const i = paginas.findIndex((p) => p.id === id);
  const j = i + dir;
  if (j < 0 || j >= paginas.length) return;
  const foto = fotoDaTela(false);
  registrarDesfazer("mudar a ordem", async () => voltarFoto(foto));
  [paginas[i], paginas[j]] = [paginas[j], paginas[i]];
  renderGrade();
}

// deixa as paginas coloridas ou cinza (reprocessa no main). Devolve quantas mudaram.
async function definirCor(ids, colorido) {
  let mudou = 0, semCor = 0;
  for (const id of ids) {
    const p = paginas.find((x) => x.id === id);
    if (!p || p.colorido === !!colorido) continue;
    const r = await window.api.corPagina(id, !!colorido);
    if (r) { atualizarPagina(r); mudou++; if (r.semCor) semCor++; }
  }
  return { mudou, semCor };
}

async function alternarCorSel() {
  if (!sel.size || ocupado) return;
  const ids = paginas.filter((p) => sel.has(p.id)).map((p) => p.id);
  const colorir = ids.some((id) => !paginas.find((p) => p.id === id).colorido);
  const corAntes = new Map(ids.map((id) => [id, !!paginas.find((p) => p.id === id).colorido])); // pra desfazer pagina por pagina
  ocupado = true; atualizarBotoesFonte();
  if (ids.length > 2) mostrarOverlay(colorir ? "Deixando colorido…" : "Passando pra tons de cinza…");
  let r;
  try { r = await definirCor(ids, colorir); }
  finally { ocupado = false; atualizarBotoesFonte(); esconderOverlay(); }
  registrarDesfazer(colorir ? "deixar colorido" : "tirar a cor", async () => { for (const [id, c] of corAntes) await definirCor([id], c); });
  renderGrade();
  if (sel.size === 1) mostrarPrevia([...sel][0]);
  if (r.semCor) setStatus(`${r.semCor} página(s) não têm cor na imagem original (escaneada ou fotografada em tons de cinza). Para escanear colorido: Configurações → Scanner → Cor.`, "aviso");
  else setStatus(colorir ? `${ids.length} página(s) colorida(s).` : `${ids.length} página(s) em tons de cinza.`, "ok");
}

async function aplicarTipo(sigla, colorido) {
  if (modo !== "documentos" || ocupado) return;
  const alvo = sel.size ? paginas.filter((p) => sel.has(p.id)).map((p) => p.id) : [];
  if (!alvo.length) { setStatus("Marque uma ou mais páginas antes de escolher o tipo.", "aviso"); return; }
  const foto = fotoDaTela();
  const corAntes = new Map(alvo.map((id) => [id, paginas.find((p) => p.id === id).colorido]));
  for (const id of alvo) {
    const p = paginas.find((x) => x.id === id);
    if (!p) continue;
    // corrigiu um tipo reconhecido sozinho: o DigiDoc aprende com o texto dessa pagina
    if (p.tipoAuto && p.tipo !== sigla) window.api.aprenderTipo(p.id, sigla);
    p.tipo = sigla; p.tipoAuto = false;
  }
  renderGrade();
  // o tipo decide a cor (ex.: Foto 3x4 colorida, RG em cinza)
  let r = { mudou: 0, semCor: 0 };
  if (alvo.some((id) => corAntes.get(id) !== !!colorido)) {
    ocupado = true; atualizarBotoesFonte();
    try { r = await definirCor(alvo, !!colorido); }
    finally { ocupado = false; atualizarBotoesFonte(); }
    renderGrade();
    if (sel.size === 1) mostrarPrevia([...sel][0]);
  }
  registrarDesfazer(`marcar ${nomeDoTipo(sigla)}`, async () => {
    voltarFoto(foto);
    for (const [id, c] of corAntes) await definirCor([id], c);
  });
  let msg = `${alvo.length} página(s) marcada(s) como ${nomeDoTipo(sigla)}${r.mudou && colorido ? " (colorida)" : ""}.`;
  if (r.semCor) msg += " Atenção: a imagem original é em tons de cinza, então fica sem cor.";
  setStatus(msg, r.semCor ? "aviso" : "");
}

function cadaPaginaUmDoc() {
  const alvo = sel.size ? [...sel] : paginas.map((p) => p.id);
  const foto = fotoDaTela();
  registrarDesfazer("1 página = 1 documento", async () => voltarFoto(foto));
  for (const id of alvo) { const p = paginas.find((x) => x.id === id); if (p) p.tipo = "@IND"; }
  renderGrade();
  setStatus(`${alvo.length} página(s) marcada(s) como documento avulso.`);
}

// paginas que as acoes de organizar usam: as marcadas (se 2 ou mais), senao todas
function alvoOrganizar() {
  const marcadas = paginas.filter((p) => sel.has(p.id));
  return marcadas.length >= 2 ? marcadas : paginas.slice();
}
// troca as paginas de "alvo" (nas mesmas posicoes) pela nova ordem
function reposicionar(alvo, novaOrdem) {
  const posicoes = alvo.map((p) => paginas.indexOf(p)).sort((a, b) => a - b);
  posicoes.forEach((pos, i) => { paginas[pos] = novaOrdem[i]; });
}

function inverterOrdem() {
  const alvo = alvoOrganizar();
  if (alvo.length < 2) { setStatus("Precisa de pelo menos 2 páginas.", "aviso"); return; }
  const foto = fotoDaTela(false);
  registrarDesfazer("inverter a ordem", async () => voltarFoto(foto));
  reposicionar(alvo, alvo.slice().reverse());
  renderGrade();
  setStatus(`Ordem invertida (${alvo.length} páginas). Ctrl+Z desfaz.`, "ok");
}

// scanner sem frente e verso: escaneia as frentes, vira o maco e escaneia os versos.
// Fica F1 F2 F3 V3 V2 V1 (virou o maco) ou F1 F2 F3 V1 V2 V3 -> vira F1 V1 F2 V2 F3 V3
function intercalarFrenteVerso(versosAoContrario = true) {
  const alvo = alvoOrganizar();
  if (alvo.length < 2 || alvo.length % 2) {
    mostrarAviso("Intercalar frente e verso", `Precisa de um número <b>par</b> de páginas (todas as frentes + todos os versos). Agora tem <b>${alvo.length}</b>.`);
    return;
  }
  const n = alvo.length / 2;
  const frentes = alvo.slice(0, n), versos = alvo.slice(n);
  if (versosAoContrario) versos.reverse();
  const nova = [];
  for (let i = 0; i < n; i++) nova.push(frentes[i], versos[i]);
  const foto = fotoDaTela(false);
  registrarDesfazer("intercalar frente e verso", async () => voltarFoto(foto));
  reposicionar(alvo, nova);
  renderGrade();
  setStatus(`Frente e verso intercalados: ${n} folhas (${alvo.length} páginas). Ctrl+Z desfaz.`, "ok");
}

// junta as marcadas numa pagina so (ex.: RG frente e verso numa folha A4)
async function juntarSelecionadas() {
  const marcadas = paginas.filter((p) => sel.has(p.id));
  if (marcadas.length < 2) { setStatus("Marque 2 ou mais páginas (Ctrl+clique) pra juntar numa folha só.", "aviso"); return; }
  if (marcadas.length > 4 && !confirm(`Juntar ${marcadas.length} páginas numa folha só? Vai ficar bem pequeno.`)) return;
  if (ocupado) return;
  ocupado = true; atualizarBotoesFonte(); mostrarOverlay("Juntando as páginas…");
  let r;
  try { r = await window.api.juntarPaginas(marcadas.map((p) => p.id)); }
  finally { ocupado = false; atualizarBotoesFonte(); esconderOverlay(); }
  if (!r || r.erro) { setStatus("Não consegui juntar: " + ((r && r.erro) || "erro"), "erro"); return; }
  const itens = marcadas.map((p) => ({ p, i: paginas.indexOf(p) })).sort((a, b) => a.i - b.i);
  const nova = novaPagina(r);
  nova.tipo = marcadas[0].tipo;
  paginas = paginas.filter((p) => !sel.has(p.id));
  paginas.splice(itens[0].i, 0, nova);
  sel.clear(); sel.add(nova.id); ancora = nova.id;
  const ids = marcadas.map((p) => p.id);
  registrarDesfazer("juntar páginas", async () => {
    await window.api.removerPagina(nova.id);
    await window.api.restaurarPaginas(ids);
    paginas = paginas.filter((p) => p.id !== nova.id);
    for (const { p, i } of itens) paginas.splice(Math.min(i, paginas.length), 0, p);
  }, ids); // se esse desfazer sair da pilha, as paginas originais (na lixeira) saem da memoria
  renderGrade(); mostrarPrevia(nova.id);
  setStatus(`${marcadas.length} páginas juntadas numa folha só. Ctrl+Z desfaz.`, "ok");
}

// "o lado ja esta certo": tira o aviso ↻? das marcadas (ou de todas)
async function confirmarLado() {
  const alvo = (sel.size ? paginas.filter((p) => sel.has(p.id)) : paginas).filter((p) => p.incerto);
  if (!alvo.length) { setStatus("Nenhuma página com o aviso ↻?.", ""); return; }
  await window.api.confirmarLado(alvo.map((p) => p.id));
  alvo.forEach((p) => (p.incerto = false));
  renderGrade();
  setStatus(`${alvo.length} página(s) conferida(s).`, "ok");
}

function limparTipos() {
  if (!paginas.some((p) => p.tipo)) return;
  const foto = fotoDaTela();
  registrarDesfazer("limpar marcações", async () => voltarFoto(foto));
  paginas.forEach((p) => (p.tipo = null));
  renderGrade();
}

// documentos obrigatorios que este associado ainda nao tem (nem salvos, nem marcados agora)
function obrigatoriosFaltando() {
  const obrig = (cfg.tipos || []).filter((t) => t.obrigatorio);
  return { configurado: obrig.length > 0, falta: obrig.filter((t) => !tipoJaSalvo(t.sigla) && !paginas.some((p) => p.tipo === t.sigla)) };
}

function renderResumoDocs() {
  if (modo !== "documentos") return;
  const cont = $("#resumoDocs");
  const grupos = montarGrupos();
  const semTipo = paginas.filter((p) => !p.tipo).length;
  let html = "";
  const ob = obrigatoriosFaltando();
  if (ob.configurado && $("#inpAssociado").value.trim()) {
    html += ob.falta.length
      ? `<div class="obrig falta">📋 Ainda falta: <b>${ob.falta.map((t) => esc(t.nome)).join(", ")}</b></div>`
      : `<div class="obrig ok">✓ Todos os documentos obrigatórios deste associado</div>`;
  } else if (!ob.configurado) {
    html += `<div class="obrig dica-obrig">Dica: marque os documentos <b>obrigatórios</b> em Configurações → Tipos (coluna "Obrig.") e o DigiDoc mostra aqui o que falta de cada associado.</div>`;
  }
  for (const g of grupos) {
    html += `<div class="resumo-item"><span class="bolinha" style="background:${corDoTipo(g.tipoSigla)}"></span>
      <b>${esc(g.nomeArquivo)}</b> <span style="color:var(--texto-fraco)">— ${g.ids.length} pág.</span></div>`;
  }
  if (semTipo) html += `<div class="resumo-item" style="color:var(--amarelo)">⚠ ${semTipo} página(s) sem tipo — não serão salvas.</div>`;
  cont.innerHTML = html;
}

function montarGrupos() {
  // agrupa por tipo preservando a ordem. "@IND" vira 1 grupo por pagina.
  const grupos = [];
  const porTipo = new Map();
  let indN = 0;
  for (const p of paginas) {
    if (!p.tipo) continue;
    if (p.tipo === "@IND") {
      indN++;
      grupos.push({ tipoSigla: cfg.siglaDossie === "DOSSIE" ? "DOC" : "DOC", ids: [p.id], _ind: indN, colorido: false });
    } else {
      if (!porTipo.has(p.tipo)) { const o = { tipoSigla: p.tipo, ids: [], colorido: !!(cfg.tipos.find((t) => t.sigla === p.tipo) || {}).colorido }; porTipo.set(p.tipo, o); grupos.push(o); }
      porTipo.get(p.tipo).ids.push(p.id);
    }
  }
  // nomes de arquivo (previa; o nome final sai no main)
  return grupos.map((g) => ({ ...g, nomeArquivo: (g.tipoSigla + (g._ind ? "_" + g._ind : "")) + ".pdf" }));
}

// ---------------- salvar ----------------
function atualizarSalvar() {
  const nome = $("#inpAssociado").value.trim();
  let ok = paginas.length > 0 && nome.length > 0;
  if (modo === "documentos") ok = ok && paginas.some((p) => p.tipo);
  $("#btnSalvar").disabled = !ok || ocupado;
}

async function salvar() {
  const nome = $("#inpAssociado").value.trim();
  const edicao = window.Assistente ? window.Assistente.edicao : null; // reabriu documentos salvos pra editar
  if (!nome) { setStatus("Digite o nome do associado.", "aviso"); $("#inpAssociado").focus(); return; }
  if (!paginas.length) { setStatus("Nenhuma página.", "aviso"); return; }
  const nivel = $("#selNivel").value;
  ocupado = true; atualizarBotoesFonte();
  mostrarOverlay("Gerando PDF…");
  try {
    let r;
    if (modo === "dossie") {
      r = await window.api.salvarDossie({ nomeAssociado: nome, ids: paginas.map((p) => p.id), nivel, substituir: !!edicao, nomeArquivo: edicao ? window.Assistente.arquivoDaEdicao(cfg.siglaDossie) : null });
    } else {
      const grupos = montarGrupos().map((g) => ({ tipoSigla: g.tipoSigla, ids: g.ids, colorido: g.colorido, nomeArquivo: edicao ? window.Assistente.arquivoDaEdicao(g.tipoSigla) : null }));
      if (!grupos.length) { setStatus("Nenhuma página tem tipo. Marque as páginas primeiro.", "aviso"); return; }
      r = await window.api.salvarDocumentos({ nomeAssociado: nome, grupos, nivel, substituir: !!edicao });
    }
    if (!r.ok) { setStatus(r.msg || "Erro ao salvar.", "erro"); return; }
    relatarSalvamento(r);
    // so conta o que foi gravado mesmo (cancelar a pergunta "ja existe" ou dar erro NAO tira as paginas)
    const okSalvos = r.salvos.filter((s) => s.caminho && !s.cancelado && !s.erro);
    const idsSalvos = new Set(okSalvos.flatMap((s) => s.ids || []));
    const tudoCerto = okSalvos.length > 0 && okSalvos.length === r.salvos.length;
    if (!okSalvos.length) return; // nada gravado: tudo continua na tela, como estava
    if (edicao && tudoCerto) window.Assistente.terminouEdicao();
    if (cfg.aposSalvar.tocarSom) bip();
    let limpou = false;
    if (cfg.aposSalvar.limparPaginas) {
      // tira da tela so as paginas salvas: as sem tipo (ou que chegaram durante o salvamento) ficam
      const restam = paginas.filter((p) => !idsSalvos.has(p.id));
      await window.api.descartarPaginas([...idsSalvos]);
      paginas = restam; sel.clear(); ancora = null;
      $("#previa").style.display = "none"; $("#previaVazia").style.display = "block";
      limpou = !restam.length;
      if (limpou) zerarDesfazer(); // tela vazia: o desfazer comeca do zero
      renderGrade();
      if (restam.length) toast(`${restam.length} página(s) ${modo === "documentos" ? "sem tipo " : ""}ficaram na tela (não foram salvas).`, "aviso", 8000);
    }
    // faltou documento obrigatorio? avisa (nao impede de salvar)
    const faltou = modo === "documentos" ? obrigatoriosFaltando() : null;
    await carregarAssociados();
    await onAssociadoMudou();
    if (faltou && faltou.configurado) {
      const ainda = obrigatoriosFaltando().falta;
      if (ainda.length) toast(`📋 <b>${esc(nome)}</b> ainda não tem: ${ainda.map((t) => esc(t.nome)).join(", ")}.`, "aviso", 8000);
    }
    // fila de associados: marca este como feito e ja poe o proximo nome
    let foiProFila = false;
    if (window.Fila) foiProFila = await window.Fila.aposSalvar(nome, limpou);
    // pronto pro proximo: limpa o nome do associado e deixa o cursor no campo
    if (!foiProFila && limpou && cfg.aposSalvar.proximoAssociado !== false) {
      const inp = $("#inpAssociado");
      inp.value = ""; await onAssociadoMudou();
      setTimeout(() => inp.focus(), 50);
    }
  } catch (e) {
    setStatus("Erro ao salvar: " + e.message, "erro");
  } finally {
    ocupado = false; atualizarBotoesFonte(); esconderOverlay();
  }
}

async function adicionarAPdfExistente() {
  if (ocupado) return;
  if (!paginas.length) { setStatus("Escaneie ou importe as páginas primeiro.", "aviso"); return; }
  const nome = $("#inpAssociado").value.trim();
  const caminho = await window.api.escolherPdfExistente(nome);
  if (!caminho) return;
  ocupado = true; atualizarBotoesFonte(); mostrarOverlay("Adicionando ao PDF…");
  try {
    const r = await window.api.adicionarPDF({ caminho, ids: paginas.map((p) => p.id), nomeAssociado: nome });
    if (!r.ok) { setStatus(r.msg || "Erro ao adicionar.", "erro"); return; }
    if (r.aviso) setStatus(r.aviso.split("\n")[0], "aviso");
    else setStatus(`✓ ${paginas.length} página(s) adicionada(s) a ${r.nome} — ${(r.bytes / 1024).toFixed(0)} KB.`, "ok");
    if (cfg.aposSalvar.tocarSom) bip();
    if (cfg.aposSalvar.limparPaginas && !r.aviso) {
      await window.api.limparPaginas();
      paginas = []; sel.clear(); ancora = null;
      $("#previa").style.display = "none"; $("#previaVazia").style.display = "block";
      zerarDesfazer();
      renderGrade();
    }
    await onAssociadoMudou();
  } catch (e) {
    setStatus("Erro ao adicionar: " + e.message, "erro");
  } finally {
    ocupado = false; atualizarBotoesFonte(); esconderOverlay();
  }
}

function relatarSalvamento(r) {
  const oks = r.salvos.filter((s) => s.caminho && !s.erro && !s.cancelado);
  const avisos = r.salvos.filter((s) => s.aviso);
  const erros = r.salvos.filter((s) => s.erro);
  if (avisos.length) { setStatus(avisos[0].aviso.split("\n")[0], "aviso"); return; }
  if (erros.length) { setStatus(erros[0].erro, "erro"); return; }
  if (!oks.length) { setStatus("Nada foi salvo.", "aviso"); return; }
  const nomes = oks.map((s) => `${s.nome} (${(s.bytes / 1024).toFixed(0)} KB)`).join(", ");
  if (r.reserva) setStatus(`⚠ Pasta principal desconectada — salvo em ${r.pasta} — ${nomes}`, "aviso");
  else setStatus(`✓ Salvo em ${r.pasta} — ${nomes}`, "ok");
}

function bip() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.stop(ac.currentTime + 0.12);
  } catch {}
}

// ---------------- modos ----------------
function trocarModo(novo) {
  modo = novo;
  $("#modoDossie").classList.toggle("ativo", novo === "dossie");
  $("#modoDocs").classList.toggle("ativo", novo === "documentos");
  $("#painelDocs").classList.toggle("oculto", novo !== "documentos");
  $("#painelDossie").classList.toggle("oculto", novo === "documentos");
  $("#btnSalvar").textContent = novo === "dossie" ? "💾 Salvar dossiê" : "💾 Salvar documentos";
  $("#selNivel").value = novo === "dossie" ? cfg.compressaoPadraoDossie : cfg.compressaoPadraoDocumento;
  renderGrade();
}

function atualizarBotoesFonte() {
  $$(".fonte").forEach((b) => (b.disabled = ocupado));
  $("#btnSalvar").disabled = ocupado;
  atualizarSalvar();
  atualizarBotaoDesfazer();
}

// ---------------- scanner: o que o app sabe do aparelho ----------------
let scannerInfo = null;       // { nome, driver, automatico, tipo, rotulo, caps, origem }
let _aoAcharScanner = null;   // modal de escolha recebendo os aparelhos conforme aparecem
let _tokenBusca = 0;          // numero da busca atual do seletor

function rotuloConexao(d) {
  return ({ escl: "rede/Wi-Fi", wia: "USB", twain: "USB (TWAIN)" })[d] || "conexão";
}
const chaveAp = (ap) => (ap ? `${ap.driver}:${ap.uuid || ap.id || ap.ip || ap.nome}`.toLowerCase() : "");

// adapta o rodape ao aparelho: so vidro, so alimentador, ou os dois (multifuncional)
function aplicarScannerInfo(info) {
  if (!info) return;
  scannerInfo = info;
  atualizarChipScanner();
  const b = $("#btnEscanear"), ico = $("#icoEscanear");
  if (!b || !ico) return;
  let fixa = info.origem === "alimentador" || info.origem === "vidro" ? info.origem : null;
  // "Sempre o alimentador" num aparelho so de vidro (ou o contrario): vale o que o aparelho tem
  if ((fixa === "alimentador" && info.tipo === "mesa") || (fixa === "vidro" && info.tipo === "alimentador")) fixa = null;
  if (fixa === "vidro" || (!fixa && info.tipo === "mesa")) {
    ico.textContent = "📄";
    b.title = fixa ? "Escaneia o vidro (escolhido nas Configurações)" : "Este aparelho só tem vidro";
  } else if (fixa === "alimentador" || (!fixa && info.tipo === "alimentador")) {
    ico.textContent = "📚";
    b.title = fixa ? "Escaneia o alimentador (escolhido nas Configurações)" : "Este aparelho só tem alimentador";
  } else {
    ico.textContent = "🖨";
    b.title = "Descobre sozinho de onde vem o papel: alimentador (se tiver papel) ou vidro";
  }
  const dois = info.tipo === "multifuncional" || info.tipo === "desconhecido";
  $("#btnAlim").classList.toggle("oculto", !dois);
  $("#btnVidro").classList.toggle("oculto", !dois);
  const t = $("#cfgDispTxt");
  if (t) t.textContent = textoScanner();
}

function textoScanner() {
  const i = scannerInfo;
  if (!i || !i.nome) return "automático — o DigiDoc procura sozinho ao escanear";
  return `${i.nome} — ${i.rotulo} (${rotuloConexao(i.driver)})${i.automatico ? ", achado sozinho" : ""}`;
}

function atualizarChipScanner() {
  const nome = $("#scannerNome"), tipo = $("#scannerTipo"), chip = $("#scannerChip");
  if (!nome) return;
  const i = scannerInfo;
  if (!i || !i.nome) {
    nome.textContent = "escolher scanner";
    if (tipo) tipo.textContent = "";
    if (chip) chip.title = "Escolher qual scanner usar (ou deixar o DigiDoc achar sozinho)";
    return;
  }
  nome.textContent = i.nome;
  if (tipo) tipo.textContent = i.rotulo + (i.automatico ? " · automático" : "");
  if (chip) chip.title = `${i.nome} — ${i.rotulo} (${rotuloConexao(i.driver)}). Clique para escolher outro.`;
}

// escolher o scanner: ja abre procurando (rede e USB ao mesmo tempo) e mostra o que cada um tem
async function abrirEscolhaScanner(aviso = "", semPreSelecao = false) {
  if ($("#es-modal")) return;
  if (typeof aviso !== "string") aviso = "";
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.id = "es-modal";
  // "Procurar em" vale so pra esta busca (o modo automatico sempre olha USB e rede)
  ov.innerHTML = `<div class="modal-cx" style="width:580px">
    <div class="modal-cab"><h2>🖨 Escolher scanner</h2><button class="icone" id="es-x">✕</button></div>
    <div class="modal-corpo">
      ${aviso ? `<p style="margin:0 0 8px;color:var(--amarelo);font-weight:600">${esc(aviso)}</p>` : ""}
      <p class="sub" style="margin:0 0 8px">O DigiDoc procura no USB e na rede e descobre sozinho o que cada aparelho tem: vidro, alimentador e frente e verso. A escolha vale só para este PC.</p>
      <div id="es-lista" class="disp-lista"></div>
      <div style="display:flex;gap:8px;align-items:center;margin:8px 0">
        <button class="btn-sec" id="es-procurar">🔍 Procurar de novo</button>
        <span class="flex1"></span>
        <label class="sub" for="es-driver">Procurar em:</label>
        <select id="es-driver"><option value="auto">USB e rede</option><option value="escl">Só rede / Wi-Fi</option><option value="wia">Só USB (WIA)</option><option value="twain">Só USB (TWAIN)</option></select>
      </div>
      <div class="cfg-linha"><label class="rot">Frente e verso (duplex)<span class="sub">se o aparelho tiver</span></label>
        <label class="switch"><input type="checkbox" id="es-duplex"><span class="slider"></span></label></div>
    </div>
    <div class="modal-rod"><span class="flex1"></span>
      <button class="btn-sec" id="es-cancel">Cancelar</button>
      <button class="btn-salvar" id="es-ok">Usar este</button></div></div>`;
  document.body.appendChild(ov);
  const fim = () => { _aoAcharScanner = null; ov.remove(); };
  ov.querySelector("#es-x").onclick = fim;
  ov.querySelector("#es-cancel").onclick = fim;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) fim(); });

  const lista = ov.querySelector("#es-lista");
  const btnProcurar = ov.querySelector("#es-procurar"), selDriver = ov.querySelector("#es-driver"), btnOk = ov.querySelector("#es-ok");
  // frente e verso: comeca do que esta na tela das Configuracoes (se aberta), mesmo nao salvo
  const chkDuplex = ov.querySelector("#es-duplex"), cfgDuplex = $("#cfgDuplex");
  chkDuplex.checked = cfgDuplex ? cfgDuplex.checked : !!cfg.scanner.frenteEVerso;
  const duplexAntes = chkDuplex.checked;
  const k = (ap) => (ap && ap.chave) || chaveAp(ap);
  // o escolhido deste PC ja entra na lista (se clicar "Usar este" antes da busca acabar, nao perde)
  const atual = scannerInfo && !scannerInfo.automatico && scannerInfo.aparelho
    ? Object.assign({}, scannerInfo.aparelho, { chave: scannerInfo.chave, rotulo: scannerInfo.rotulo, caps: scannerInfo.caps }) : null;
  // "" = automatico; null = nada marcado (quando o app pediu pra escolher entre varios)
  let escolhido = atual ? k(atual) : semPreSelecao ? null : "";
  const achados = [];

  const linha = (ap) => `<label class="disp-item"><input type="radio" name="es-disp" value="${esc(k(ap))}" ${escolhido === k(ap) ? "checked" : ""}> ${esc(ap.nome)} <span class="sub">(${rotuloConexao(ap.driver)})</span> <span class="tipo-tag">${esc(ap.rotulo || "")}</span></label>`;
  function desenhar(procurando) {
    // marcado algo que sumiu da lista (outra busca): volta pro que esta salvo
    if (escolhido && !achados.some((a) => k(a) === escolhido)) escolhido = atual ? k(atual) : null;
    let msg = "";
    if (procurando) msg = `<div class="sub" style="padding:6px">procurando ${selDriver.value === "auto" ? "no USB e na rede" : "(" + selDriver.options[selDriver.selectedIndex].text.toLowerCase() + ")"}… (alguns segundos)</div>`;
    else if (!achados.length) msg = `<div class="sub" style="padding:6px">Nenhum scanner encontrado. Veja se está ligado, no cabo USB ou na mesma rede, e clique em Procurar de novo.</div>`;
    lista.innerHTML = achados.map(linha).join("") + msg +
      `<label class="disp-item"><input type="radio" name="es-disp" value="" ${escolhido === "" ? "checked" : ""}> Automático — o DigiDoc acha o scanner sozinho</label>`;
    lista.querySelectorAll("input[name=es-disp]").forEach((x) => { x.onchange = () => { escolhido = x.value; btnOk.disabled = false; }; });
    btnProcurar.disabled = selDriver.disabled = !!procurando;
    btnOk.disabled = escolhido === null;
  }
  // um aparelho achado substitui a linha provisoria do escolhido (que fica marcada "procurando")
  const juntar = (ap) => {
    if (!ap) return false;
    const i = achados.findIndex((a) => k(a) === k(ap));
    if (i >= 0) { if (achados[i].provisorio) { achados[i] = ap; return true; } return false; }
    achados.push(ap); return true;
  };

  async function procurar() {
    const minha = ++_tokenBusca; // contador do modulo: busca de um seletor fechado nao vaza pro novo
    achados.length = 0;
    const filtro = selDriver.value;
    if (atual) {
      const fora = filtro !== "auto" && filtro !== atual.driver;
      achados.push(Object.assign({}, atual, { provisorio: !fora, rotulo: fora ? "fora deste filtro" : (atual.rotulo || "") + " · procurando…" }));
    }
    desenhar(true);
    _aoAcharScanner = (ap) => { if (ap.token === minha && minha === _tokenBusca && juntar(ap)) desenhar(true); };
    let r = null;
    try { r = await window.api.scannerListar({ driver: filtro, token: minha }); } catch {}
    if (minha !== _tokenBusca || !document.body.contains(ov)) return;
    _aoAcharScanner = null;
    ((r && r.dispositivos) || []).forEach(juntar);
    // o escolhido nao respondeu agora: continua na lista pra nao sumir a escolha
    const p = achados.findIndex((a) => a.provisorio);
    if (p >= 0) achados[p] = Object.assign({}, atual, { rotulo: "não respondeu agora" });
    desenhar(false);
  }
  btnProcurar.onclick = procurar;
  selDriver.onchange = procurar;

  btnOk.onclick = async () => {
    if (escolhido === null) return;
    if (chkDuplex.checked !== duplexAntes) {
      cfg.scanner.frenteEVerso = chkDuplex.checked;
      await window.api.saveConfig(cfg);
      if (cfgDuplex) cfgDuplex.checked = chkDuplex.checked; // Configuracoes abertas por baixo
    }
    const ap = escolhido ? achados.find((a) => k(a) === escolhido) || (atual && k(atual) === escolhido ? atual : null) : null;
    const igual = ap ? !!atual && k(ap) === k(atual) : !!(scannerInfo && scannerInfo.automatico);
    if (!igual) { // so muda a escolha se mudou mesmo (o automatico nao perde o que ja achou a toa)
      let reg = null;
      if (ap) {
        reg = { driver: ap.driver, nome: ap.nome, caps: ap.caps || null, fonteCaps: ap.fonteCaps || null };
        for (const c of ["id", "uuid", "ip", "base"]) if (ap[c]) reg[c] = ap[c];
      }
      aplicarScannerInfo(await window.api.scannerEscolher(reg));
    }
    setStatus(ap ? `Scanner deste PC: ${ap.nome} (${String(ap.rotulo || "").replace(/ · procurando…$/, "")})` : "Scanner: automático — o DigiDoc acha sozinho ao escanear", "ok");
    fim();
  };
  procurar();
}

// ---------------- iPhone ----------------
let _celularFotos = 0;
async function abrirIphone() {
  $("#modalIphone").classList.remove("oculto");
  $("#iphoneCorpo").innerHTML = `<div style="text-align:center;padding:20px"><div class="spinner" style="margin:0 auto 10px"></div>Preparando conexão…</div>`;
  _celularFotos = 0;
  const r = await window.api.celularIniciar();
  if (!r.ok) {
    $("#iphoneCorpo").innerHTML = `
      <p style="color:var(--amarelo)">${esc(r.msg)}</p>
      <p>Enquanto isso, você pode tirar as fotos no iPhone e trazer pro PC, depois clicar em Importar.</p>
      <div style="text-align:right"><button class="btn-salvar" id="iphoneImportar">🖼 Importar fotos</button></div>`;
    $("#iphoneImportar").onclick = () => { fecharIphone(); importar(); };
    return;
  }
  $("#iphoneCorpo").innerHTML = `
    <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:center">
      <div style="text-align:center">
        <img src="${r.qr}" alt="QR" style="width:220px;height:220px;border-radius:12px;background:#fff;padding:8px">
        <div class="sub" style="margin-top:6px">Aponte a câmera do iPhone</div>
      </div>
      <div style="flex:1;min-width:240px">
        <ol style="line-height:1.8;margin:0 0 10px;padding-left:20px">
          <li>Abra a <b>câmera</b> do iPhone e aponte pro QR Code.</li>
          <li>Toque no aviso que aparece pra abrir a página.</li>
          <li>Tire as fotos — elas aparecem <b>sozinhas</b> aqui no PC.</li>
        </ol>
        <div class="sub">Ou digite no Safari: <b>${esc((r.url || "").replace(/\?.*/, ""))}</b></div>
        <div id="celStatus" style="margin-top:12px;font-weight:700;color:var(--verde)">Aguardando o celular conectar…</div>
      </div>
    </div>
    <p class="sub" style="margin-top:16px;border-top:1px solid var(--borda);padding-top:12px">
      Precisa: o iPhone e o PC na <b>mesma rede</b> (o iPhone no Wi-Fi do escritório).
      As fotos vão direto pro PC, sem internet.</p>
    <div style="text-align:right"><button class="btn-sec" id="iphoneImportar">🖼 Preferir importar do PC</button></div>`;
  $("#iphoneImportar").onclick = () => { fecharIphone(); importar(); };
}
function fecharIphone() {
  $("#modalIphone").classList.add("oculto");
  window.api.celularParar();
}
function aoReceberFotoCelular(reg) {
  if (!reg || reg.branca) return;
  const nova = novaPagina(reg);
  paginas.push(nova);
  conferirNovasPaginas([nova]);
  _celularFotos++;
  const st = $("#celStatus");
  if (st) { st.textContent = `✓ ${_celularFotos} foto(s) recebida(s) do iPhone`; }
  renderGrade();
  if (!sel.size) { sel.add(reg.id); ancora = reg.id; mostrarPrevia(reg.id); renderGrade(); }
  setStatus(`Foto do iPhone recebida (${_celularFotos}).`, "ok");
}

// ---------------- configuracoes ----------------
let familiasDoc = [];
let confInfo = null; // lista de conferencia (pasta, total, pastas de nuvem deste PC) // documentos que o reconhecimento sabe identificar (vem do main)
async function abrirConfig() {
  try { familiasDoc = await window.api.familiasDocumento(); } catch { familiasDoc = []; }
  try { confInfo = await window.api.conferenciaInfo(); } catch { confInfo = null; }
  $("#configCorpo").innerHTML = montarFormConfig(cfg);
  $("#modalConfig").classList.remove("oculto");
  bindConfigDinamico();
}
function fecharConfig() { $("#modalConfig").classList.add("oculto"); }

function sw(id, val) { return `<label class="switch"><input type="checkbox" id="${id}" ${val ? "checked" : ""}><span class="slider"></span></label>`; }
function linhaSw(id, rot, sub, val) { return `<div class="cfg-linha"><label class="rot" for="${id}">${rot}${sub ? `<span class="sub">${sub}</span>` : ""}</label>${sw(id, val)}</div>`; }

function linhaTipo(t, i) {
  return `<tr data-i="${i}">
      <td><input type="text" class="t-nome" value="${esc(t.nome)}" placeholder="Nome do documento"></td>
      <td><input type="text" class="curto t-sigla" value="${esc(t.sigla)}" placeholder="auto"></td>
      <td><input type="text" class="curto t-tecla" value="${esc(t.tecla || "")}" maxlength="1"></td>
      <td style="text-align:center">${sw("t-cor-" + i, t.colorido)}</td>
      <td style="text-align:center" title="Obrigatório: o DigiDoc avisa quando o associado ainda não tem">${sw("t-obr-" + i, t.obrigatorio)}</td>
      <td class="acao"><button class="mini perigo t-del" title="remover">✕</button></td>
    </tr>`;
}

function montarFormConfig(c) {
  const tiposRows = c.tipos.map(linhaTipo).join("");

  return `
  <!-- ===== ESSENCIAL ===== -->
  <div class="cfg-grupo" id="gSalvar">
    <h3>Onde salvar</h3>
    <div class="cfg-linha"><label class="rot">Pasta principal<span class="sub" id="cfgPastaTxt">${esc(c.pastaSaida)}</span></label>
      <button class="btn-sec" id="btnEscolherPasta">Mudar…</button></div>
  </div>

  <div class="cfg-grupo" id="gTipos">
    <h3>Tipos de documento</h3>
    <p class="sub" style="margin:-4px 0 10px">A <b>sigla</b> é o nome do arquivo (RG.pdf). A <b>tecla</b> marca as páginas rápido. Deixe a sigla em branco para ela sair sozinha do nome.</p>
    <table class="tipos-tabela"><thead><tr><th>Nome</th><th>Sigla</th><th>Tecla</th><th>Cor?</th><th title="Obrigatório: o DigiDoc mostra o que falta de cada associado">Obrig.</th><th></th></tr></thead>
      <tbody id="tiposBody">${tiposRows}</tbody></table>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="mini" id="btnAddTipo">＋ Adicionar um</button>
      <button class="mini" id="btnColarTipos">📋 Colar vários (lista)</button>
      <button class="mini" id="btnSugerirSiglas">✨ Preencher siglas automáticas</button>
    </div>
  </div>

  <div class="cfg-grupo" id="gProducao">
    <h3>Produção</h3>
    <div class="cfg-linha"><label class="rot">Meta de associados por dia<span class="sub">aparece embaixo, com a barrinha de progresso (0 = sem meta)</span></label>
      <input type="number" id="cfgMetaDia" min="0" max="999" value="${Number(c.metaDia) || 0}"></div>
    ${linhaSw("cfgProximo", "Depois de salvar, limpar o nome", "o campo Associado fica vazio e com o cursor, pronto pro próximo", c.aposSalvar.proximoAssociado !== false)}
  </div>

  <div class="cfg-grupo" id="gConferencia">
    <h3>Lista de conferência</h3>
    ${linhaSw("cfgConfAtivo", "Anotar cada associado salvo na lista", "um arquivo TXT organizado por data com o nome (e o código, se tiver) de quem já passou pela digitalização. Só nomes — nenhum documento vai pra lista.", !(c.conferencia && c.conferencia.ativo === false))}
    <div class="cfg-linha"><label class="rot">Pasta da lista<span class="sub" id="cfgConfPastaTxt">${esc((c.conferencia && c.conferencia.pasta) || (confInfo && confInfo.padrao) || "")}</span></label>
      <button class="btn-sec" id="btnConfPasta">Mudar…</button></div>
    ${confInfo && confInfo.nuvens && confInfo.nuvens.length ? `<div class="cfg-linha conf-nuvens"><label class="rot">Guardar na nuvem<span class="sub">usa a pasta do serviço que já sincroniza neste PC: a lista fica <b>privada</b> na sua conta (ninguém vê, a não ser que você compartilhe)</span></label>
      ${confInfo.nuvens.map((nv, i) => `<button class="btn-sec" data-nuvem="${i}">☁ ${esc(nv.nome)}</button>`).join("")}</div>` :
      `<p class="sub" style="margin:-2px 0 8px">Pra guardar na nuvem: instale o OneDrive ou o Google Drive para computador e escolha uma pasta dele em "Mudar…" — a lista sincroniza sozinha e fica privada na sua conta.</p>`}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn-sec" id="btnConfAbrir">📄 Abrir a lista</button>
      <button class="btn-sec" id="btnConfImportar">📥 Importar pastas já digitalizadas…</button>
      <span class="sub">${confInfo && confInfo.total ? `${confInfo.total.toLocaleString("pt-BR")} associado(s) na lista` : "lista ainda vazia"}</span>
    </div>
  </div>

  <div class="cfg-grupo" id="gReconhecer">
    <h3>Reconhecimento do documento</h3>
    ${linhaSw("cfgReconhecer", "Reconhecer o tipo sozinho", "no modo documento por documento, lê o texto da página e já marca o tipo. Errou? Clique na etiqueta da página e troque — ele aprende com a correção.", !!c.reconhecerTipo)}
    <p class="sub" style="margin:4px 0 8px">Quando reconhecer cada documento, <b>salvar como</b> (nome do arquivo). Ex.: comprovante de endereço → <b>ENDERECO</b>. Se o nome ainda não for um tipo, o DigiDoc cria.</p>
    <table class="tipos-tabela rec-tabela"><thead><tr><th>Reconhecer</th><th>Documento</th><th>Salvar como</th></tr></thead><tbody id="recBody">
      ${familiasDoc.map((f) => `<tr data-fam="${f.id}"><td style="text-align:center">${sw("rec-" + f.id, f.ativo)}</td><td>${esc(f.nome)}</td>
        <td><input type="text" class="rec-nome" value="${esc(f.nomeEscrito)}" placeholder="${esc(f.usa || f.padrao)}"></td></tr>`).join("")}
    </tbody></table>
    <div style="margin-top:8px"><button class="mini" id="btnEsquecerAprendizado" title="Apaga o que ele aprendeu com as suas correções">Esquecer o que aprendeu</button></div>
  </div>

  <div class="cfg-grupo">
    <h3>Aparência</h3>
    <div class="cfg-linha"><label class="rot">Tema</label>
      <select id="cfgTema"><option value="claro" ${c.tema === "claro" ? "selected" : ""}>Claro</option><option value="escuro" ${c.tema === "escuro" ? "selected" : ""}>Escuro</option></select></div>
    <div class="cfg-linha"><label class="rot">Compressão padrão<span class="sub">quanto menor o arquivo</span></label>
      <select id="cfgCompDossie">${nivelOpts(c.compressaoPadraoDossie)}</select></div>
    ${linhaSw("cfgSemAceleracao", "Modo compatibilidade", "ligue se a tela ficar branca ou preta em algum PC (desliga a aceleração de vídeo e reinicia o app)", c.semAceleracao)}
  </div>

  <!-- ===== AVANCADO (recolhido) ===== -->
  <details class="cfg-avancado">
    <summary>⚙ Opções avançadas</summary>

    <div class="cfg-grupo" id="gLimites">
      <h3>Limites do Siclus</h3>
      <div class="cfg-linha"><label class="rot">Tamanho máximo do PDF (MB)</label><input type="number" id="cfgMaxMB" step="0.1" min="0.2" value="${c.tamanhoMaxMB}"></div>
      <div class="cfg-linha"><label class="rot">Máximo de caracteres no nome</label><input type="number" id="cfgMaxCar" min="8" value="${c.maxCaracteresNome}"></div>
      ${linhaSw("cfgExtConta", 'Contar ".pdf" dentro do limite', "", c.extensaoContaNoLimite)}
      ${linhaSw("cfgNuncaDiv", "Nunca dividir o PDF", "comprime mais em vez de dividir", c.nuncaDividir)}
    </div>

    <div class="cfg-grupo">
      <h3>Pastas e nomes</h3>
      <div class="cfg-linha"><label class="rot">Formato da pasta da letra<span class="sub">O DigiDoc segue sozinho o padrão das pastas que já existem (ex.: "Digitalizados A" → cria "Digitalizados E"; espaços não contam). Este formato só vale numa pasta vazia. {letra} = primeira letra.</span></label>
        <input type="text" id="cfgFormatoLetra" value="${esc(c.formatoPastaLetra)}"></div>
      <div class="cfg-linha"><label class="rot">Nome do associado na pasta</label>
        <select id="cfgFormatoNome">
          <option value="titulo" ${c.formatoNomeAssociado === "titulo" ? "selected" : ""}>Maria Silva</option>
          <option value="maiusculo" ${c.formatoNomeAssociado === "maiusculo" ? "selected" : ""}>MARIA SILVA</option>
          <option value="original" ${c.formatoNomeAssociado === "original" ? "selected" : ""}>como digitado</option>
        </select></div>
      ${linhaSw("cfgRemAcentoPasta", "Tirar acentos da pasta", "", c.removerAcentosPasta)}
      <div class="cfg-linha"><label class="rot">Sigla do dossiê completo</label><input type="text" id="cfgSiglaDossie" value="${esc(c.siglaDossie)}"></div>
      <div class="cfg-linha"><label class="rot">Compressão no documento por documento</label>
        <select id="cfgCompDoc">${nivelOpts(c.compressaoPadraoDocumento)}</select></div>
    </div>

    <div class="cfg-grupo" id="gAjustes">
      <h3>Ajustes automáticos da imagem</h3>
      ${linhaSw("cfgAutoGirar", "Girar para o lado certo", "0/90/180/270 automático", c.ajustes.autoGirar)}
      ${linhaSw("cfgEndireitar", "Endireitar folha torta", "", c.ajustes.endireitar)}
      ${linhaSw("cfgClarar", "Clarear o fundo", "deixa o fundo branco", c.ajustes.clararFundo)}
      ${linhaSw("cfgTirarBranca", "Tirar página em branco", "", c.ajustes.tirarPaginaBranca)}
      ${linhaSw("cfgRecortar", "Recortar a folha (fotos)", "tira a mesa/fundo nas fotos", c.ajustes.recortarFolha)}
      ${linhaSw("cfgNitidez", "Melhorar nitidez", "realça o texto (só nas páginas em cinza)", c.ajustes.nitidez)}
      ${linhaSw("cfgCorOriginal", "Manter a cor do scanner", "páginas coloridas saem com as cores exatamente como o scanner mandou, sem clarear nem realçar", c.ajustes.corOriginal !== false)}
    </div>

    <div class="cfg-grupo" id="gScanner">
      <h3>Scanner</h3>
      <div class="cfg-linha"><label class="rot">Resolução (DPI)</label><input type="number" id="cfgDpi" min="72" max="600" step="10" value="${c.scanner.resolucao}"></div>
      <div class="cfg-linha"><label class="rot">Cor</label>
        <select id="cfgCor">
          <option value="cinza" ${c.scanner.cor === "cinza" ? "selected" : ""}>Tons de cinza</option>
          <option value="cor" ${c.scanner.cor === "cor" ? "selected" : ""}>Colorido</option>
          <option value="pb" ${c.scanner.cor === "pb" ? "selected" : ""}>Preto e branco</option>
        </select></div>
      <div class="cfg-linha"><label class="rot">De onde vem o papel<span class="sub">no automático: alimentador se tiver papel, senão o vidro</span></label>
        <select id="cfgOrigem">
          <option value="auto" ${(c.scanner.origem || "auto") === "auto" ? "selected" : ""}>Automático (recomendado)</option>
          <option value="alimentador" ${c.scanner.origem === "alimentador" ? "selected" : ""}>Sempre o alimentador</option>
          <option value="vidro" ${c.scanner.origem === "vidro" ? "selected" : ""}>Sempre o vidro</option>
        </select></div>
      ${linhaSw("cfgDuplex", "Frente e verso (duplex)", "se o aparelho tiver", c.scanner.frenteEVerso)}
      ${linhaSw("cfgPerguntarFolhas", "Perguntar quantas folhas", "avisa se o alimentador puxou folhas juntas", c.scanner.perguntarFolhas)}
      <div class="cfg-linha"><label class="rot">Scanner<span class="sub" id="cfgDispTxt">${esc(textoScanner())}</span></label>
        <button class="btn-sec" id="btnDetectarScanner" title="Conferir de novo o que o aparelho tem">🔄 Detectar</button>
        <button class="btn-sec" id="btnEscolherScannerCfg">Escolher…</button></div>
      <div class="cfg-linha"><label class="rot">Motor de scanner (NAPS2)<span class="sub" id="cfgMotorTxt">verificando…</span></label>
        <button class="btn-sec" id="btnInstalarMotor">Instalar / ativar</button></div>
      <p class="sub" style="margin-top:4px">Funciona com qualquer scanner: a sua HP, outra impressora, ou um scanner de mesa — por USB ou pela rede.</p>
    </div>

    <div class="cfg-grupo" id="gBackup">
      <h3>Depois de salvar</h3>
      ${linhaSw("cfgAbrirPasta", "Abrir a pasta", "", c.aposSalvar.abrirPasta)}
      ${linhaSw("cfgSom", "Tocar um som", "", c.aposSalvar.tocarSom)}
      ${linhaSw("cfgLimpar", "Limpar as páginas da tela", "", c.aposSalvar.limparPaginas)}
      <div class="cfg-linha"><label class="rot">Backup automático<span class="sub" id="cfgBackupTxt">${esc(c.aposSalvar.pastaBackup || "desligado")}</span></label>
        <button class="btn-sec" id="btnEscolherBackup">Escolher…</button>${c.aposSalvar.pastaBackup ? '<button class="mini perigo" id="btnLimparBackup">tirar</button>' : ""}</div>
      <div class="cfg-linha"><label class="rot">Se o arquivo já existe</label>
        <select id="cfgExiste">
          <option value="numerar" ${c.seArquivoExiste === "numerar" ? "selected" : ""}>Numerar (RG_2.pdf)</option>
          <option value="substituir" ${c.seArquivoExiste === "substituir" ? "selected" : ""}>Substituir</option>
          <option value="perguntar" ${c.seArquivoExiste === "perguntar" ? "selected" : ""}>Perguntar</option>
        </select></div>
    </div>

    <div class="cfg-grupo" id="gAtualizacao">
      <h3>Atualizações</h3>
      <div class="cfg-linha"><label class="rot">Versão instalada: ${esc(appVersao || "?")}<span class="sub" id="cfgAtuTxt">as novas versões chegam pela internet (GitHub)</span></label>
        <button class="btn-sec" id="btnProcurarAtu">🔄 Procurar agora</button></div>
      ${linhaSw("cfgAtuAuto", "Procurar atualização sozinho", "ao abrir o DigiDoc (só avisa — você escolhe a hora de atualizar)", !c.atualizacao || c.atualizacao.automatica !== false)}
    </div>

    <div class="cfg-grupo">
      <h3>Instalação neste PC</h3>
      <div class="cfg-linha"><label class="rot">Remover o DigiDoc deste PC<span class="sub">tira só o programa — seus PDFs não somem</span></label>
        <button class="btn-sec" id="btnDesinstalar" style="color:var(--vermelho);border-color:var(--vermelho)">🗑 Desinstalar</button></div>
    </div>
  </details>

  <div class="cfg-creditos">
    <div class="cred-logo">▣ DigiDoc</div>
    <div>Digitalizador de documentos — versão ${esc(appVersao || "?")}</div>
    <div style="font-weight:700;margin-top:4px">${AUTOR}</div>
  </div>`;
}
// assinatura fixa do app (nao e configuravel)
const AUTOR = "Desenvolvido por Otavio Martins";
function nivelOpts(v) {
  return ["pouca", "recomendada", "extrema"].map((n) => `<option value="${n}" ${v === n ? "selected" : ""}>${n[0].toUpperCase() + n.slice(1)}</option>`).join("");
}

let _pastaEscolhida = null;
let _confPastaEscolhida = null; // pasta nova da lista de conferencia (vale ao salvar as configuracoes)
let _backupEscolhido = null;

function teclasUsadasNaTabela() {
  return new Set($$("#tiposBody .t-tecla").map((i) => i.value.trim()).filter(Boolean));
}
function proxTeclaTabela() {
  const u = teclasUsadasNaTabela();
  for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) if (!u.has(k)) return k;
  return "";
}
function wireLinhaTipo(tr) {
  tr.querySelector(".t-del").onclick = () => tr.remove();
  const nome = tr.querySelector(".t-nome"), sigla = tr.querySelector(".t-sigla");
  nome.addEventListener("blur", () => { if (!sigla.value.trim() && nome.value.trim()) sigla.value = siglaAuto(nome.value); });
}
let _seqLinhaTipo = 0;
function addLinhaTipo(t) {
  const tb = $("#tiposBody"); const i = "n" + ++_seqLinhaTipo; // id unico (nao repete depois de apagar linha)
  const tmp = document.createElement("tbody");
  tmp.innerHTML = linhaTipo({ nome: t.nome || "", sigla: t.sigla || "", tecla: t.tecla || "", colorido: !!t.colorido, obrigatorio: !!t.obrigatorio }, i);
  const tr = tmp.firstElementChild;
  tb.appendChild(tr);
  wireLinhaTipo(tr);
  return tr;
}

function bindConfigDinamico() {
  _pastaEscolhida = null; _backupEscolhido = null; _confPastaEscolhida = null;
  const usarPastaConf = async (sugerida) => {
    const p = await window.api.conferenciaEscolherPasta(sugerida || null);
    if (p) { _confPastaEscolhida = p; $("#cfgConfPastaTxt").textContent = p + "  (vale ao salvar)"; }
  };
  $("#btnConfPasta").onclick = () => usarPastaConf();
  $$("[data-nuvem]").forEach((b) => { b.onclick = () => usarPastaConf(confInfo.nuvens[+b.dataset.nuvem].pasta); });
  $("#btnConfAbrir").onclick = () => window.api.conferenciaAbrir(_confPastaEscolhida || null);
  $("#btnConfImportar").onclick = () => { if (window.Conferencia) window.Conferencia.importar(_confPastaEscolhida || null); };
  $("#btnEscolherPasta").onclick = async () => {
    const p = await window.api.escolherPastaSaida();
    if (p) { _pastaEscolhida = p; $("#cfgPastaTxt").textContent = p; }
  };
  $("#btnEscolherBackup").onclick = async () => {
    const p = await window.api.escolherPastaSaida();
    if (p) { _backupEscolhido = p; $("#cfgBackupTxt").textContent = p; }
  };
  const bl = $("#btnLimparBackup");
  if (bl) bl.onclick = () => { _backupEscolhido = ""; $("#cfgBackupTxt").textContent = "desligado"; bl.remove(); };
  $("#btnAddTipo").onclick = () => { const tr = addLinhaTipo({ tecla: proxTeclaTabela() }); tr.querySelector(".t-nome").focus(); };
  $("#btnColarTipos").onclick = async () => {
    const txt = await pedirTexto("Cole a lista de tipos (um por linha)", "", true);
    if (!txt) return;
    txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((nome) =>
      addLinhaTipo({ nome, sigla: siglaAuto(nome), tecla: proxTeclaTabela() }));
  };
  $("#btnSugerirSiglas").onclick = () => {
    $$("#tiposBody tr").forEach((tr) => {
      const n = tr.querySelector(".t-nome").value.trim(), s = tr.querySelector(".t-sigla");
      if (n && !s.value.trim()) s.value = siglaAuto(n);
    });
  };
  $$("#tiposBody tr").forEach(wireLinhaTipo);

  // ----- scanner: motor + aparelho -----
  atualizarStatusMotor();
  $("#btnInstalarMotor").onclick = instalarMotor;
  $("#btnEscolherScannerCfg").onclick = () => abrirEscolhaScanner();
  $("#btnDetectarScanner").onclick = async () => {
    const t = $("#cfgDispTxt"), b = $("#btnDetectarScanner");
    b.disabled = true; t.textContent = "conferindo o aparelho…";
    try {
      const r = await window.api.scannerDetectar();
      aplicarScannerInfo(r.info);
      t.textContent = r.ok ? textoScanner() : (r.msg || "não encontrei o scanner");
    } catch { t.textContent = textoScanner(); }
    b.disabled = false;
  };

  const bd = $("#btnDesinstalar");
  if (bd) bd.onclick = desinstalarDoPC;
  const be = $("#btnEsquecerAprendizado");
  if (be) be.onclick = async () => { if (confirm("Esquecer tudo o que o reconhecimento aprendeu com as suas correções?")) { await window.api.esquecerTipos(); be.textContent = "✓ esquecido"; } };
  // escrever um nome em "salvar como" ja liga o reconhecimento daquele documento
  $$("#recBody .rec-nome").forEach((inp) => inp.addEventListener("input", () => { if (inp.value.trim()) inp.closest("tr").querySelector("input[type=checkbox]").checked = true; }));
  const ba = $("#btnProcurarAtu");
  if (ba) ba.onclick = async () => {
    const t = $("#cfgAtuTxt");
    ba.disabled = true; t.textContent = "procurando…";
    const r = window.Atualizacao ? await window.Atualizacao.procurar(true) : null;
    ba.disabled = false;
    t.textContent = !r ? "não deu pra procurar agora" : r.erro ? r.erro : r.nova ? `versão ${r.versao} disponível — aviso embaixo da tela` : "você já está na versão mais nova ✓";
  };
}

async function desinstalarDoPC() {
  setStatus("Conferindo a instalação…");
  const info = await window.api.infoDesinstalar();
  setStatus("Pronto.");
  if (info.dev) {
    mostrarAviso("Modo desenvolvimento", "Você está rodando a versão de desenvolvimento — não tem instalação pra remover.", "var(--acento)");
    return;
  }
  if (info.removivel) {
    mostrarAviso("Você está rodando do pendrive",
      "O DigiDoc está rodando direto do pendrive — <b>não tem nada instalado neste PC pra remover</b>.<br><br>É só fechar o programa e tirar o pendrive.", "var(--acento)");
    return;
  }
  if (info.incerto) {
    mostrarAviso("Não dá pra remover por aqui",
      "Não consegui confirmar que esta cópia do DigiDoc está <b>instalada neste PC</b> (e não num pendrive) — então, por segurança, <b>não apaguei nada</b>.<br><br>" +
      "Pra remover, use o <b>DESINSTALAR DigiDoc do PC.bat</b> que fica no pendrive.");
    return;
  }
  const msg = `Remover o DigiDoc deste PC?\n\n` +
    `Pasta do programa:\n${info.dir}\n\n` +
    (info.temDocs ? `Seus PDFs em:\n${info.docs}\nNÃO serão apagados — ficam exatamente onde estão.\n\n` : "") +
    `O programa vai FECHAR e se remover em seguida.`;
  if (!window.confirm(msg)) return;
  const r = await window.api.desinstalar();
  if (r && r.ok) {
    fecharConfig();
    setStatus("Removendo o DigiDoc deste PC… o programa vai fechar.", "aviso");
  } else {
    mostrarAviso("Erro", "Não consegui iniciar a remoção: " + ((r && r.msg) || "erro"), "var(--vermelho)");
  }
}

async function atualizarStatusMotor() {
  const el = $("#cfgMotorTxt"); if (!el) return;
  const tem = await window.api.scannerTemMotor();
  el.textContent = tem ? "✓ instalado e pronto" : "não instalado (necessário para escanear)";
  el.style.color = tem ? "var(--verde)" : "var(--amarelo)";
}

async function instalarMotor() {
  const btn = $("#btnInstalarMotor");
  btn.disabled = true; $("#cfgMotorTxt").textContent = "baixando o motor (pode levar 1-2 min)…";
  const r = await window.api.instalarMotor();
  btn.disabled = false;
  if (r.ok) { setStatus("Motor de scanner instalado!", "ok"); }
  else { setStatus(r.msg || "Não consegui instalar automaticamente.", "erro"); if (r.instrucoes) $("#cfgMotorTxt").textContent = r.instrucoes; }
  atualizarStatusMotor();
}

function coletarConfig() {
  const c = JSON.parse(JSON.stringify(cfg));
  if (_pastaEscolhida) c.pastaSaida = _pastaEscolhida;
  c.formatoPastaLetra = $("#cfgFormatoLetra").value || "Letra {letra}";
  c.formatoNomeAssociado = $("#cfgFormatoNome").value;
  c.removerAcentosPasta = $("#cfgRemAcentoPasta").checked;
  c.siglaDossie = $("#cfgSiglaDossie").value || "DOSSIE";
  c.tamanhoMaxMB = parseFloat($("#cfgMaxMB").value) || 2;
  c.maxCaracteresNome = parseInt($("#cfgMaxCar").value) || 40;
  c.extensaoContaNoLimite = $("#cfgExtConta").checked;
  c.nuncaDividir = $("#cfgNuncaDiv").checked;
  c.compressaoPadraoDossie = $("#cfgCompDossie").value;
  c.compressaoPadraoDocumento = $("#cfgCompDoc").value;
  c.ajustes.autoGirar = $("#cfgAutoGirar").checked;
  c.ajustes.endireitar = $("#cfgEndireitar").checked;
  c.ajustes.clararFundo = $("#cfgClarar").checked;
  c.ajustes.tirarPaginaBranca = $("#cfgTirarBranca").checked;
  c.ajustes.recortarFolha = $("#cfgRecortar").checked;
  c.ajustes.nitidez = $("#cfgNitidez").checked;
  c.ajustes.corOriginal = $("#cfgCorOriginal").checked;
  c.scanner.resolucao = parseInt($("#cfgDpi").value) || 200;
  c.scanner.cor = $("#cfgCor").value;
  c.scanner.frenteEVerso = $("#cfgDuplex").checked;
  c.scanner.perguntarFolhas = $("#cfgPerguntarFolhas").checked;
  c.scanner.origem = $("#cfgOrigem").value || "auto";
  c.aposSalvar.abrirPasta = $("#cfgAbrirPasta").checked;
  c.aposSalvar.tocarSom = $("#cfgSom").checked;
  c.aposSalvar.limparPaginas = $("#cfgLimpar").checked;
  c.aposSalvar.proximoAssociado = $("#cfgProximo").checked;
  c.reconhecerTipo = $("#cfgReconhecer").checked;
  c.conferencia = { ativo: $("#cfgConfAtivo").checked, pasta: _confPastaEscolhida !== null ? _confPastaEscolhida : ((cfg.conferencia && cfg.conferencia.pasta) || "") };
  // Reconhecimento: ligado/desligado e o "salvar como" de cada documento
  c.reconhecimento = {};
  $$("#recBody tr").forEach((tr) => {
    const id = tr.dataset.fam, nome = tr.querySelector(".rec-nome").value.trim().toUpperCase();
    c.reconhecimento[id] = { ativo: tr.querySelector("#rec-" + id).checked, nome };
  });
  c.metaDia = Math.max(0, parseInt($("#cfgMetaDia").value) || 0);
  c.atualizacao = Object.assign({}, c.atualizacao, { automatica: $("#cfgAtuAuto").checked });
  if (_backupEscolhido !== null) c.aposSalvar.pastaBackup = _backupEscolhido;
  c.seArquivoExiste = $("#cfgExiste").value;
  c.tema = $("#cfgTema").value;
  c.semAceleracao = $("#cfgSemAceleracao").checked;
  delete c.creditos; // assinatura e fixa (nao vem da config)
  c.tipos = $$("#tiposBody tr").map((tr, i) => ({
    nome: tr.querySelector(".t-nome").value.trim() || "Documento",
    sigla: (tr.querySelector(".t-sigla").value.trim() || "DOC").toUpperCase(),
    tecla: tr.querySelector(".t-tecla").value.trim(),
    // pelo prefixo do id (o numero do id nao bate com a posicao depois de apagar uma linha)
    colorido: tr.querySelector('[id^="t-cor-"]')?.checked || false,
    obrigatorio: tr.querySelector('[id^="t-obr-"]')?.checked || false,
  })).filter((t) => t.nome);
  return c;
}

async function salvarConfig() {
  const compatAntes = !!cfg.semAceleracao;
  cfg = coletarConfig();
  await window.api.saveConfig(cfg);
  aplicarTema();
  renderTipos();
  $("#selNivel").value = modo === "dossie" ? cfg.compressaoPadraoDossie : cfg.compressaoPadraoDocumento;
  await onAssociadoMudou();
  await carregarAssociados();
  fecharConfig();
  setStatus("Configurações salvas.", "ok");
  if (window.Painel) window.Painel.atualizarContador(); // a meta do dia pode ter mudado
  window.api.scannerInfo().then(aplicarScannerInfo).catch(() => {}); // origem do papel pode ter mudado
  if (!!cfg.semAceleracao !== compatAntes &&
      window.confirm("O modo compatibilidade só vale depois de reiniciar o DigiDoc.\n\nReiniciar agora?")) {
    window.api.reiniciar();
  }
}

// ---------------- teclado ----------------
function onTecla(e) {
  // qualquer janela aberta por cima (aviso, pergunta, seletor, iPhone, configuracoes, visualizador):
  // Enter, R e Del nao mexem nas paginas por baixo — ex.: Enter pra fechar o "Faltou pagina!" salvava o PDF
  if (document.querySelector(".modal:not(.oculto)")) return;
  if (!$("#visor").classList.contains("oculto")) return; // o visualizador tem os atalhos dele
  if ($(".tut-camada:not(.oculto)")) return; // tutorial aberto
  if (window.Cantinho && window.Cantinho.aberto()) return;
  const ctrl = e.ctrlKey || e.metaKey;
  // atalhos que valem ate digitando o nome
  if (ctrl && (e.key === "s" || e.key === "S")) { e.preventDefault(); if (!$("#btnSalvar").disabled) salvar(); else atualizarSalvarComAviso(); return; }
  if (ctrl && (e.key === "o" || e.key === "O")) { e.preventDefault(); importar(); return; }
  if (e.key === "F1") { e.preventDefault(); if (window.Extras) window.Extras.atalhos(); return; }
  if (e.key === "F2") { e.preventDefault(); escanear("auto"); return; }
  if (e.key === "F3") { e.preventDefault(); if (window.Painel) window.Painel.abrir(); return; }
  if (e.key === "F4") { e.preventDefault(); const i = $("#inpAssociado"); i.focus(); i.select(); return; }
  if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    if (e.key === "Enter" && document.activeElement.id === "inpAssociado") document.activeElement.blur();
    return;
  }
  if (ctrl && (e.key === "z" || e.key === "Z")) { e.preventDefault(); desfazer(); return; }
  if (ctrl && (e.key === "a" || e.key === "A")) { e.preventDefault(); paginas.forEach((p) => sel.add(p.id)); renderGrade(); return; }
  if (ctrl) return;
  if (e.key === "r" || e.key === "R") { girarSel(e.shiftKey ? -90 : 90); e.preventDefault(); }
  else if (e.key === "Delete" || e.key === "Backspace") { removerSel(); e.preventDefault(); }
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") { navegar(1, e.shiftKey); e.preventDefault(); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { navegar(-1, e.shiftKey); e.preventDefault(); }
  else if (e.key === "Home") { navegarPara(0); e.preventDefault(); }
  else if (e.key === "End") { navegarPara(paginas.length - 1); e.preventDefault(); }
  else if (e.key === " ") { e.preventDefault(); if (!ocupado && window.Visor && (ancora || paginas[0])) window.Visor.abrir(ancora || paginas[0].id); }
  else if (e.key === "c" || e.key === "C") { alternarCorSel(); }
  else if (modo === "documentos" && /^[0-9]$/.test(e.key)) {
    const t = cfg.tipos.find((t) => t.tecla === e.key);
    if (t) aplicarTipo(t.sigla, t.colorido);
  } else if (e.key === "Enter") { if (!$("#btnSalvar").disabled) salvar(); else atualizarSalvarComAviso(); }
}
// Enter/Ctrl+S sem poder salvar: diz o que falta (em vez de nao fazer nada)
function atualizarSalvarComAviso() {
  if (ocupado) return;
  if (!$("#inpAssociado").value.trim()) { setStatus("Falta o nome do associado (F4 vai pro campo).", "aviso"); $("#inpAssociado").focus(); }
  else if (!paginas.length) setStatus("Ainda não tem páginas. Escaneie (F2) ou importe (Ctrl+O).", "aviso");
  else if (modo === "documentos" && !paginas.some((p) => p.tipo)) setStatus("Marque o tipo das páginas (teclas 1 a 9) antes de salvar.", "aviso");
}
function navegarPara(i) {
  if (!paginas.length) return;
  const id = paginas[Math.max(0, Math.min(paginas.length - 1, i))].id;
  sel.clear(); sel.add(id); ancora = id;
  renderGrade(); mostrarPrevia(id); rolarAte(id);
}
function rolarAte(id) {
  const el = document.querySelector(`.pag[data-id="${id}"]`);
  if (el) el.scrollIntoView({ block: "nearest" });
}
// setas: anda uma pagina. Com Shift: vai marcando junto (pra escolher o tipo de varias)
function navegar(dir, somar = false) {
  if (!paginas.length) return;
  let i = ancora ? paginas.findIndex((p) => p.id === ancora) : -1;
  i = Math.max(0, Math.min(paginas.length - 1, i + dir));
  const id = paginas[i].id;
  if (!somar) sel.clear();
  sel.add(id); ancora = id;
  renderGrade(); mostrarPrevia(id); rolarAte(id);
}

// ---------------- bind ----------------
function bind() {
  $("#modoDossie").onclick = () => trocarModo("dossie");
  $("#modoDocs").onclick = () => trocarModo("documentos");
  $("#btnConfig").onclick = abrirConfig;
  $("#btnFecharConfig").onclick = fecharConfig;
  $("#btnCancelarConfig").onclick = fecharConfig;
  $("#btnSalvarConfig").onclick = salvarConfig;
  // so mostra os valores padrao no formulario: nada muda ate clicar em "Salvar configuracoes"
  $("#btnRestaurar").onclick = async () => {
    const p = await window.api.configPadrao();
    $("#configCorpo").innerHTML = montarFormConfig(p);
    bindConfigDinamico();
    _pastaEscolhida = p.pastaSaida; _backupEscolhido = (p.aposSalvar && p.aposSalvar.pastaBackup) || "";
    setStatus("Valores padrão na tela — clique em Salvar configurações pra valer (ou Cancelar pra deixar como estava).");
  };

  $("#inpAssociado").addEventListener("input", onAssociadoMudou);
  $("#inpAssociado").addEventListener("change", onAssociadoMudou);
  $("#btnAbrirPasta").onclick = () => window.api.abrirPasta($("#inpAssociado").value.trim());
  $("#btnColarNome").onclick = () => window.Assistente.colarNome();
  $("#btnRecentes").onclick = (e) => window.Assistente.abrirRecentes(e.currentTarget);
  $("#btnReconhecer").onclick = () => window.Assistente.reconhecerAgora();
  $("#chkReconhecer").onchange = async (e) => {
    cfg.reconhecerTipo = e.target.checked; await window.api.saveConfig(cfg);
    setStatus(cfg.reconhecerTipo ? "✨ Reconhecer sozinho: ligado. As próximas páginas já vêm com o tipo." : "Reconhecer sozinho: desligado.", "ok");
    if (cfg.reconhecerTipo && paginas.some((p) => !p.tipo)) window.Assistente.reconhecerAgora();
  };

  $("#btnEscanear").onclick = () => escanear("auto");
  $("#btnAlim").onclick = () => escanear("alimentador");
  $("#btnVidro").onclick = () => escanear("vidro");
  $("#btnCancelarScan").onclick = () => { _cancelouScan = true; window.api.scannerCancelar(); $("#overlayMsg").textContent = "Cancelando…"; };
  $("#btnImportar").onclick = importar;
  $("#btnIphone").onclick = () => abrirIphone();
  $("#btnFecharIphone").onclick = fecharIphone;
  $("#scannerChip").onclick = () => abrirEscolhaScanner();

  $("#btnGirar").onclick = () => girarSel(90);
  $("#btnGirarEsq").onclick = () => girarSel(-90);
  $("#btnRemover").onclick = removerSel;
  $("#btnEsq").onclick = () => moverSel(-1);
  $("#btnDir").onclick = () => moverSel(1);
  $("#btnCor").onclick = alternarCorSel;
  $("#btnVer").onclick = () => { const id = ancora || (paginas[0] && paginas[0].id); if (id && window.Visor) window.Visor.abrir(id); };
  $("#btnDesfazer").onclick = desfazer;
  $("#previaWrap").ondblclick = () => { if (ancora && window.Visor) window.Visor.abrir(ancora); };
  $("#btnSelTudo").onclick = () => { paginas.forEach((p) => sel.add(p.id)); renderGrade(); };
  // limpar tudo: vai pra lixeira (Ctrl+Z traz de volta), entao nao precisa perguntar
  $("#btnLimpar").onclick = async () => {
    if (!paginas.length || ocupado) return;
    const n = paginas.length;
    await removerPaginas(paginas.map((p) => p.id), "limpar a tela");
    ancora = null; $("#previa").style.display = "none"; $("#previaVazia").style.display = "block";
    setStatus(`${n} página(s) tirada(s) da tela. Ctrl+Z traz de volta.`);
  };

  $("#btnCadaPag").onclick = cadaPaginaUmDoc;
  $("#btnLimparTipos").onclick = limparTipos;
  $("#btnSalvar").onclick = salvar;
  $("#btnAddPdf").onclick = adicionarAPdfExistente;
  $("#selNivel").onchange = () => {};

  // arrastar imagens de fora pra dentro da janela
  const corpo = document.body;
  ["dragenter", "dragover"].forEach((ev) => corpo.addEventListener(ev, (e) => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); document.documentElement.classList.add("arrastando-arquivo"); }
  }));
  ["dragleave", "drop"].forEach((ev) => corpo.addEventListener(ev, (e) => {
    if (ev === "dragleave" && e.relatedTarget) return;
    document.documentElement.classList.remove("arrastando-arquivo");
  }));
  corpo.addEventListener("drop", async (e) => {
    const arqs = [...(e.dataTransfer?.files || [])];
    if (arqs.length) e.preventDefault(); // senao a janela "abre" o arquivo no lugar do app
    if (ocupado) { if (arqs.length) setStatus("Espere terminar o que está fazendo e arraste de novo.", "aviso"); return; }
    // Electron 32+: o caminho do arquivo vem pelo preload (File.path nao existe mais)
    const caminhoDe = (f) => { try { return window.api.caminhoDoArquivo(f) || f.path || ""; } catch { return f.path || ""; } };
    const caminhos = arqs.map(caminhoDe).filter(Boolean).filter((p) => EXT_IMAGEM.test(p) || /\.pdf$/i.test(p));
    if (!caminhos.length) { if (arqs.length) setStatus("Arraste imagens (JPG, PNG, TIFF, BMP, WEBP, HEIC) ou PDFs.", "aviso"); return; }
    await importarCaminhos(caminhos, " (arrastadas)");
  });
  // colar imagem (Ctrl+V)
  document.addEventListener("paste", async (e) => {
    // colando numa caixa de texto (nome, lista da Fila…), numa janela aberta ou no cantinho: e texto,
    // nao pagina. (O Excel copia as celulas tambem como imagem — virava pagina em vez de texto)
    const ativo = document.activeElement;
    if (ativo && (["INPUT", "TEXTAREA", "SELECT"].includes(ativo.tagName) || ativo.isContentEditable)) return;
    if (document.querySelector(".modal:not(.oculto)") || (window.Cantinho && window.Cantinho.aberto())) return;
    if (ocupado) return;
    const temImg = [...(e.clipboardData?.items || [])].some((i) => i.type.startsWith("image/"));
    if (!temImg) return;
    e.preventDefault();
    const reg = await window.api.importarClipboard({ colorido: coloridoAtual("colar") });
    if (reg && !reg.vazio && !reg.branca) {
      paginas.push(novaPagina(reg));
      renderGrade(); sel.clear(); sel.add(reg.id); ancora = reg.id; mostrarPrevia(reg.id); renderGrade();
      setStatus("Imagem colada adicionada.", "ok");
    }
  });

  document.addEventListener("keydown", onTecla);
  // Esc fecha modais; clique no fundo tambem
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const es = $("#es-modal");
      if (es) { _aoAcharScanner = null; es.remove(); return; } // fecha so o de cima
      fecharConfig(); fecharIphone();
    }
  });
  $("#modalConfig").addEventListener("mousedown", (e) => { if (e.target.id === "modalConfig") fecharConfig(); });
  $("#modalIphone").addEventListener("mousedown", (e) => { if (e.target.id === "modalIphone") fecharIphone(); });
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------------- API usada pelo tour (tutorial.js) ----------------
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let _tourDemoIds = [];
window.DigiDocTour = {
  estadoInicial() { return { modo, assoc: $("#inpAssociado").value, tinhaPaginas: paginas.length > 0 }; },
  trocar(m) { trocarModo(m); },
  async digitar(txt) {
    const inp = $("#inpAssociado");
    inp.value = "";
    for (const ch of txt) {
      inp.value += ch;
      if (window.SomTutorial) window.SomTutorial.sfx("tick");
      await onAssociadoMudou();
      await dormir(95);
    }
  },
  async addDemo(n) {
    if (_tourDemoIds.length) return;
    const res = await window.api.demoPaginas({ n: n || 3 });
    for (const r of res) {
      if (r && r.id) { paginas.push(novaPagina(r)); _tourDemoIds.push(r.id); }
    }
    renderGrade();
    if (paginas.length) { sel.clear(); sel.add(paginas[0].id); ancora = paginas[0].id; mostrarPrevia(paginas[0].id); renderGrade(); }
  },
  marcarTipos() {
    if (modo !== "documentos") return;
    const sig = ["RG", "CPF", "COMP_RES"];
    _tourDemoIds.forEach((id, i) => { const p = paginas.find((x) => x.id === id); if (p) p.tipo = sig[i % sig.length]; });
    renderGrade();
  },
  async girarPrimeira() {
    if (!_tourDemoIds[0]) return;
    sel.clear(); sel.add(_tourDemoIds[0]); ancora = _tourDemoIds[0];
    await girarSel();
  },
  async limparSoDemo() {
    for (const id of _tourDemoIds) { try { await window.api.removerPagina(id); } catch {} }
    if (_tourDemoIds.length) window.api.purgarLixeira(_tourDemoIds);
    paginas = paginas.filter((p) => !_tourDemoIds.includes(p.id));
    _tourDemoIds = [];
    sel.clear(); ancora = null;
    $("#previa").style.display = "none"; $("#previaVazia").style.display = "block";
    renderGrade();
  },
  async limparDemo(ini) {
    await this.limparSoDemo();
    fecharConfig();
    if (ini) {
      trocarModo(ini.modo);
      $("#inpAssociado").value = ini.assoc || "";
      await onAssociadoMudou();
    }
  },
  // ----- Configurações (pro tour explicar cada parte) -----
  configAbrir() { abrirConfig(); },
  configFechar() { fecharConfig(); },
  configAvancado() { const d = document.querySelector(".cfg-avancado"); if (d) d.open = true; },
  async configScroll(sel) { const e = document.querySelector(sel); if (e) { e.scrollIntoView({ block: "center", behavior: "smooth" }); await dormir(550); } },
};

init();
