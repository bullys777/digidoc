"use strict";
// Assistente: reconhecer o tipo do documento (opcional), trocar o tipo com 1 clique, colar o nome
// copiado, Recentes (historico de nomes) e reabrir documentos ja salvos pra editar.
window.Assistente = (() => {
  // =================== reconhecer o tipo (le o texto da pagina) ===================
  const fila = [];
  let rodando = false, pausado = false, nomeSugerido = false;

  // paginas que acabaram de entrar (scanner, importar, iPhone, colar)
  function paginasNovas(novas) {
    if (paginas.length === novas.length) nomeSugerido = false; // lote novo (tela estava vazia)
    if (pausado || modo !== "documentos" || !cfg.reconhecerTipo) return;
    enfileirar(novas.filter((p) => !p.tipo));
  }
  // botao "✨ Reconhecer": as marcadas, ou todas sem tipo
  function reconhecerAgora() {
    const alvo = sel.size ? paginas.filter((p) => sel.has(p.id)) : paginas.filter((p) => !p.tipo || p.tipoAuto);
    if (!alvo.length) { setStatus("Todas as páginas já têm tipo. Marque as que quer reconhecer de novo.", ""); return; }
    for (const p of alvo) if (p.tipoAuto) { p.tipo = null; p.tipoAuto = false; }
    enfileirar(alvo);
  }
  function enfileirar(lista) {
    for (const p of lista) if (!fila.includes(p.id)) { fila.push(p.id); p.lendo = true; }
    renderGrade();
    processar();
  }
  async function processar() {
    if (rodando) return;
    rodando = true;
    let marcadas = 0, duvida = 0;
    setStatus("🔎 Lendo as páginas pra reconhecer o tipo…");
    try {
      while (fila.length) {
        const id = fila.shift();
        const p = paginas.find((x) => x.id === id);
        if (!p) continue;
        const r = await window.api.classificarPagina(id);
        p.lendo = false;
        if (r && r.erro === "sumiu") continue; // a pagina foi removida enquanto esperava: pula so ela
        if (!r || r.erro) {
          paginas.forEach((x) => (x.lendo = false)); fila.length = 0;
          setStatus("Não consegui ler o texto: " + ((r && r.erro) || "erro"), "aviso");
          break;
        }
        // "Salvar como" com um nome que ainda nao e tipo (ex.: ENDERECO): cria o tipo na hora
        if (!p.tipo && r.sigla && r.criarTipo && !cfg.tipos.some((t) => t.sigla === r.sigla)) {
          cfg.tipos.push({ nome: r.criarTipo.nome, sigla: r.criarTipo.sigla, tecla: proxTecla(), colorido: r.criarTipo.sigla === "FOTO" });
          await window.api.saveConfig(cfg);
          renderTipos();
        }
        if (!p.tipo && r.sigla && cfg.tipos.some((t) => t.sigla === r.sigla)) {
          p.tipo = r.sigla; p.tipoAuto = true; p.motivoAuto = r.motivo; marcadas++;
          const t = cfg.tipos.find((t) => t.sigla === r.sigla);
          if (t && !!t.colorido !== !!p.colorido) await definirCor([p.id], !!t.colorido); // ex.: Foto 3x4 colorida
        } else if (!p.tipo) { duvida++; p.motivoAuto = r.motivo; }
        if (r.nome && !nomeSugerido && !$("#inpAssociado").value.trim()) { nomeSugerido = true; sugerirNome(r.nome); }
        renderGrade();
      }
    } finally { rodando = false; }
    if (marcadas || duvida) {
      setStatus(`✨ ${marcadas} página(s) reconhecida(s)${duvida ? ` · ${duvida} sem certeza — marque o tipo dessas` : ""}. Errou? Clique na etiqueta da página pra trocar.`, duvida ? "aviso" : "ok");
    }
  }
  function sugerirNome(nome) {
    toast(`📇 Nome lido no documento: <b>${esc(nome)}</b> <button class="toast-btn" id="usarNomeLido">Usar este nome</button>`, "ok", 15000);
    const b = document.getElementById("usarNomeLido");
    if (b) b.onclick = async (e) => {
      e.stopPropagation();
      const fmt = nome.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
      $("#inpAssociado").value = fmt; await onAssociadoMudou();
      document.getElementById("toast").classList.remove("on");
      setStatus(`Associado: ${fmt} (lido do documento — confira)`, "ok");
    };
  }

  // =================== trocar o tipo com 1 clique (etiqueta da pagina) ===================
  function menuTipo(id, ancoraEl) {
    fecharMenus();
    const p = paginas.find((x) => x.id === id);
    if (!p) return;
    const alvo = sel.has(id) && sel.size > 1 ? paginas.filter((x) => sel.has(x.id)) : [p];
    const m = document.createElement("div");
    m.className = "menu-mais menu-tipo"; m.id = "menuTipo";
    const itens = cfg.tipos.map((t, i) => ({ sigla: t.sigla, nome: t.nome, cor: CORES_TIPO[i % CORES_TIPO.length], tecla: t.tecla }));
    m.innerHTML = `<div class="mt-tit">${alvo.length > 1 ? `Tipo das ${alvo.length} páginas marcadas` : `Tipo da página ${paginas.indexOf(p) + 1}`}${p.tipoAuto && p.motivoAuto ? `<small>reconhecido por: ${esc(p.motivoAuto)}</small>` : ""}</div>` +
      itens.map((t) => `<button class="menu-item" data-s="${esc(t.sigla)}"><span class="bolinha" style="background:${t.cor}"></span><b>${esc(t.nome)}</b>${t.tecla ? `<kbd>${esc(t.tecla)}</kbd>` : ""}${p.tipo === t.sigla ? " ✓" : ""}</button>`).join("") +
      `<button class="menu-item" data-s="@IND"><span class="bolinha" style="background:#5a6572"></span><b>Documento avulso</b></button>
       <button class="menu-item" data-s=""><span class="bolinha" style="background:transparent;border:1px solid var(--borda)"></span><b>Sem tipo</b></button>`;
    document.body.appendChild(m);
    const r = ancoraEl.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + "px";
    m.style.top = (r.bottom + m.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - m.offsetHeight - 4) : r.bottom + 4) + "px";
    m.querySelectorAll(".menu-item").forEach((b) => { b.onclick = () => { m.remove(); trocarTipo(alvo, b.dataset.s || null); }; });
    setTimeout(() => document.addEventListener("mousedown", fechaFora, true), 0);
    function fechaFora(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("mousedown", fechaFora, true); } }
  }
  function fecharMenus() { const v = document.getElementById("menuTipo"); if (v) v.remove(); }
  async function trocarTipo(alvo, sigla) {
    const foto = fotoDaTela();
    const corAntes = new Map(alvo.map((p) => [p.id, !!p.colorido]));
    for (const p of alvo) {
      // corrigiu um tipo que o DigiDoc tinha marcado: aprende com o texto daquela pagina
      if (p.tipoAuto && sigla && sigla !== "@IND" && sigla !== p.tipo) window.api.aprenderTipo(p.id, sigla);
      p.tipo = sigla; p.tipoAuto = false;
    }
    // desfazer volta o tipo E a cor de cada pagina (o tipo pode ter trocado a cor, ex.: Foto 3x4)
    registrarDesfazer("trocar o tipo", async () => { voltarFoto(foto); for (const [id, c] of corAntes) await definirCor([id], c); });
    const t = sigla && cfg.tipos.find((x) => x.sigla === sigla);
    if (t) await definirCor(alvo.map((p) => p.id), !!t.colorido);
    renderGrade();
    setStatus(sigla ? `${alvo.length} página(s): ${nomeDoTipo(sigla)}.` : `${alvo.length} página(s) sem tipo.`, "ok");
  }

  // =================== colar o nome copiado ===================
  async function colarNome() {
    let t = "";
    try { t = await window.api.clipboardTexto(); } catch {}
    t = String(t || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
    t = t.replace(/[<>:"/\\|?*\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!t) { setStatus("Não tem nenhum nome copiado (copie o nome e clique de novo).", "aviso"); return; }
    $("#inpAssociado").value = t;
    await onAssociadoMudou();
    setStatus(`Nome colado: ${t}`, "ok");
  }

  // =================== Recentes + reabrir pra editar ===================
  let edicao = null; // { nome, modo, arquivos:[nome.pdf] } — reabriu documentos ja salvos
  const chave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  async function abrirRecentes(botao) {
    const velho = document.getElementById("menuRecentes");
    if (velho) { velho.remove(); return; }
    const h = await window.api.historico();
    const vistos = new Set(), lista = [];
    for (const e of h.itens) { const k = chave(e.associado); if (!k || vistos.has(k)) continue; vistos.add(k); lista.push(e); if (lista.length >= 60) break; }
    const m = document.createElement("div");
    m.id = "menuRecentes"; m.className = "menu-mais menu-recentes";
    m.innerHTML = `<input class="mr-busca" placeholder="🔎 Procurar nos recentes…" spellcheck="false">
      <div class="mr-lista"></div>
      <div class="mr-rod">Clique = pôr o nome · <b>2 cliques = abrir os documentos pra editar</b></div>`;
    document.body.appendChild(m);
    const r = botao.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(innerWidth - 420, r.left - 200)) + "px";
    m.style.top = r.bottom + 6 + "px";
    const desenhar = (filtro) => {
      const f = chave(filtro);
      const itens = lista.filter((e) => !f || chave(e.associado).includes(f));
      m.querySelector(".mr-lista").innerHTML = itens.length ? itens.map((e) => `
        <div class="mr-item" data-i="${lista.indexOf(e)}" title="2 cliques: abrir pra editar">
          <b>${esc(e.associado)}</b>
          <small>${quando(e.quando)} · ${e.arquivos.map((a) => `<span class="${a.existe ? "" : "sumiu"}">${esc(a.nome)}</span>`).join(", ")}</small>
        </div>`).join("") : `<p class="sub" style="padding:10px">${lista.length ? "Nenhum com esse nome." : "Nada salvo neste PC ainda."}</p>`;
      m.querySelectorAll(".mr-item").forEach((el) => {
        const e = lista[+el.dataset.i];
        el.onclick = async () => { $("#inpAssociado").value = e.associado; await onAssociadoMudou(); };
        el.ondblclick = () => { m.remove(); reabrir(e); };
      });
    };
    desenhar("");
    const busca = m.querySelector(".mr-busca");
    busca.oninput = () => desenhar(busca.value);
    busca.focus();
    busca.addEventListener("keydown", (e) => { if (e.key === "Escape") { m.remove(); e.stopPropagation(); } });
    setTimeout(() => document.addEventListener("mousedown", fora, true), 0);
    function fora(e) { if (!m.contains(e.target) && e.target !== botao) { m.remove(); document.removeEventListener("mousedown", fora, true); } }
  }
  function quando(iso) {
    const d = new Date(iso), hoje = new Date().toDateString();
    return d.toDateString() === hoje ? "hoje " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("pt-BR");
  }

  // traz de volta pra tela os PDFs que foram salvos (cada pagina com o seu tipo) pra editar e salvar por cima
  async function reabrir(e) {
    if (ocupado) return;
    const arquivos = (e.arquivos || []).filter((a) => a.existe !== false);
    if (!arquivos.length) { mostrarAviso("Não dá pra reabrir", "Os PDFs desse salvamento não estão mais na pasta."); return; }
    if (paginas.length && !confirm(`Tem ${paginas.length} página(s) na tela. Tirar elas (Ctrl+Z traz de volta) e abrir os documentos de ${e.associado}?`)) return;
    if (paginas.length) await removerPaginas(paginas.map((p) => p.id), "trocar pelos documentos reabertos");
    $("#inpAssociado").value = e.associado;
    const ehDossie = e.modo === "dossie" || (arquivos.length === 1 && arquivos[0].nome.replace(/\.pdf$/i, "").replace(/_\d+$/, "").toUpperCase() === String(cfg.siglaDossie || "DOSSIE").toUpperCase());
    trocarModo(ehDossie ? "dossie" : "documentos");
    pausado = true; ocupado = true; atualizarBotoesFonte();
    mostrarOverlay("Abrindo os documentos salvos…");
    let total = 0;
    try {
      for (const a of arquivos) {
        const r = await window.ImportarPDF.importar(a.caminho, (msg, f, t) => {
          $("#overlayMsg").textContent = msg; $("#barraFill").style.width = (t ? Math.round((f / t) * 100) : 0) + "%";
        }, { semAjustes: true });
        total += r.adicionadas;
        if (!ehDossie) {
          const sigla = a.nome.replace(/\.pdf$/i, "").replace(/_\d+$/, "").toUpperCase();
          const t = cfg.tipos.find((x) => siglaArquivo(x.sigla) === sigla); // sigla como vira nome de arquivo
          for (const id of r.ids || []) { const p = paginas.find((x) => x.id === id); if (p) p.tipo = t ? t.sigla : "@IND"; }
        }
      }
    } finally { pausado = false; ocupado = false; atualizarBotoesFonte(); esconderOverlay(); }
    edicao = { nome: e.associado, modo: ehDossie ? "dossie" : "documentos", arquivos: arquivos.map((a) => a.nome) };
    // (sem zerar o desfazer: as paginas que estavam na tela continuam voltando com Ctrl+Z)
    await onAssociadoMudou();
    mostrarEdicao();
    renderGrade();
    setStatus(`✏ ${total} página(s) de ${e.associado} abertas pra editar. Ao salvar, substitui ${edicao.arquivos.join(", ")}.`, "ok");
  }
  function mostrarEdicao() {
    const b = document.getElementById("bannerEdicao");
    if (!b) return;
    if (!edicao) { b.classList.add("oculto"); return; }
    b.innerHTML = `✏ Editando — ao salvar, substitui <b>${edicao.arquivos.map(esc).join(", ")}</b> <button class="mini" id="sairEdicao">sair da edição</button>`;
    b.classList.remove("oculto");
    b.querySelector("#sairEdicao").onclick = () => { edicao = null; mostrarEdicao(); setStatus("Saiu da edição: ao salvar, segue a regra normal (numerar/perguntar).", ""); };
  }
  // o nome no campo mudou pra outra pessoa: sai da edicao
  function nomeMudou(nome) { if (edicao && chave(nome) !== chave(edicao.nome)) { edicao = null; mostrarEdicao(); } }
  // nome exato do arquivo reaberto pra um grupo (ex.: RG_2.pdf), pra salvar por cima do mesmo
  function arquivoDaEdicao(sigla) {
    if (!edicao) return null;
    // reabriu como dossie mas vai salvar como documentos (ou o contrario): nao grava por cima de nada
    if (edicao.modo !== modo) return null;
    if (edicao.modo === "dossie") return edicao.arquivos[0] || null;
    const doTipo = edicao.arquivos.filter((n) => siglaDoNomeArquivo(n) === siglaArquivo(sigla));
    return doTipo.length === 1 ? doTipo[0] : null;
  }

  return {
    paginasNovas, reconhecerAgora, menuTipo, colarNome, abrirRecentes, reabrir, nomeMudou, arquivoDaEdicao,
    get edicao() { return edicao; }, terminouEdicao() { edicao = null; mostrarEdicao(); }, lendo: () => rodando,
  };
})();
