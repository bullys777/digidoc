"use strict";
// Cantinho: area escondida de intervalo (jogos, videos, musica, noticias).
// - nao tem botao: abre com Ctrl+Shift+Espaco ou 3 cliques rapidos no ▣ do topo
// - "se chegar alguem": Esc / Ctrl+Shift+Espaco / mouse no canto da tela / clicar fora da janela
//   escondem NA HORA: pausa e muta tudo, sai da tela cheia e volta pra tela de trabalho
// - sites ficam numa sessao so na memoria (nada fica gravado no PC quando o app fecha)
window.Cantinho = (() => {
  const CHAVE = "dd.pref.ui"; // preferencias deste PC (nome discreto)
  const PADRAO = { blur: true, canto: "inf-esq", disfarce: "nada", ultimo: "" };
  let prefs = Object.assign({}, PADRAO);
  try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(CHAVE) || "{}")); } catch {}
  const salvarPrefs = () => { try { localStorage.setItem(CHAVE, JSON.stringify(prefs)); } catch {} };

  const CATALOGO = [
    { grupo: "Jogos — funcionam sem internet", itens: [
      { id: "2048", ic: "🔢", nome: "2048", desc: "junte os números até chegar no 2048", url: "cantinho-jogos://jogos/2048/index.html" },
      { id: "tetris", ic: "🧱", nome: "Tetris", desc: "o clássico das peças (setas + espaço)", url: "cantinho-jogos://jogos/tetris/index.html" },
      { id: "dino", ic: "🦖", nome: "Dinossauro", desc: "o do Chrome — espaço pula, seta abaixa", url: "cantinho-jogos://jogos/dino/index.html" },
      { id: "adr", ic: "🔥", nome: "A Dark Room", desc: "aventura em texto premiada (salva o progresso)", url: "cantinho-jogos://jogos/adarkroom/index.html?lang=pt_br" },
    ] },
    { grupo: "Jogar com os colegas — crie a sala e clique em 📨 Convidar (só entra quem tiver o link)", amigos: true, itens: [
      { id: "papergames", ic: "❌", nome: "Papergames", desc: "jogo da velha, Ligue 4, batalha naval, xadrez — sem cadastro", url: "https://papergames.io/pt/" },
      { id: "stopots", ic: "🛑", nome: "Stop (Adedonha)", desc: "o Stop clássico com os amigos", url: "https://stopots.com/pt/" },
      { id: "gartic", ic: "✏️", nome: "Gartic", desc: "um desenha, os outros adivinham", url: "https://gartic.io" },
      { id: "skribbl", ic: "🖍", nome: "Skribbl", desc: "desenho e adivinha (sala privada)", url: "https://skribbl.io" },
      { id: "codenames", ic: "🕵", nome: "Codenames", desc: "jogo de palavras em times (tem português)", url: "https://codenames.game" },
      { id: "xadrez", ic: "♟", nome: "Xadrez", desc: "Lichess: “jogar com um amigo” gera o link", url: "https://lichess.org" },
      { id: "bga", ic: "🎲", nome: "Board Game Arena", desc: "centenas de jogos de tabuleiro (precisa de conta grátis)", url: "https://boardgamearena.com" },
    ] },
    { grupo: "Jogos online", itens: [
      { id: "poki", ic: "🕹", nome: "Poki", desc: "centenas de jogos bons, de tudo", url: "https://poki.com/br" },
      { id: "crazy", ic: "🎯", nome: "CrazyGames", desc: "mais centenas de jogos", url: "https://www.crazygames.com.br" },
      { id: "termo", ic: "🟩", nome: "Termo", desc: "adivinhe a palavra do dia", url: "https://term.ooo" },
      { id: "contexto", ic: "🧠", nome: "Contexto", desc: "ache a palavra secreta pela proximidade", url: "https://contexto.me" },
      { id: "slither", ic: "🐍", nome: "Slither.io", desc: "a cobrinha contra gente do mundo todo", url: "https://slither.io" },
      { id: "paciencia", ic: "🃏", nome: "Paciência", desc: "a do Google (clique em Jogar)", url: "https://www.google.com/search?q=solitaire&hl=pt-BR" },
      { id: "minado", ic: "💣", nome: "Campo minado", desc: "o do Google (clique em Jogar)", url: "https://www.google.com/search?q=minesweeper&hl=pt-BR" },
    ] },
    { grupo: "Vídeos e TV", itens: [
      { id: "youtube", ic: "▶️", nome: "YouTube", desc: "vídeos", url: "https://www.youtube.com" },
      { id: "twitch", ic: "🟣", nome: "Twitch", desc: "lives", url: "https://www.twitch.tv" },
      { id: "pluto", ic: "📺", nome: "Pluto TV", desc: "canais de TV grátis, ao vivo", url: "https://pluto.tv/br/live-tv" },
    ] },
    { grupo: "Música e rádio", itens: [
      { id: "ytmusic", ic: "🎵", nome: "YouTube Music", desc: "músicas e playlists", url: "https://music.youtube.com" },
      { id: "radio", ic: "📻", nome: "Radio Garden", desc: "rádios ao vivo do mundo todo", url: "https://radio.garden" },
      { id: "soundcloud", ic: "☁️", nome: "SoundCloud", desc: "músicas e podcasts", url: "https://soundcloud.com" },
    ] },
    { grupo: "Notícias e futebol", itens: [
      { id: "g1", ic: "📰", nome: "g1", desc: "notícias", url: "https://g1.globo.com" },
      { id: "ge", ic: "⚽", nome: "ge", desc: "futebol, placar ao vivo", url: "https://ge.globo.com" },
    ] },
  ];
  const TODOS = CATALOGO.flatMap((g) => g.itens);

  let raiz = null, aberto = false, atual = ""; // atual = id do item (ou "site:<url>")
  const vivos = new Map(); // id -> <webview> (mantem onde parou)
  const MAX_VIVOS = 5;

  function montar() {
    raiz = document.createElement("div");
    raiz.className = "cantinho oculto";
    raiz.innerHTML = `
      <div class="ct-barra">
        <span class="ct-marca">▣ DigiDoc</span>
        <button class="ct-btn" id="ctInicio" title="Início">⌂</button>
        <button class="ct-btn" id="ctVoltar" title="Voltar">◀</button>
        <button class="ct-btn" id="ctAvancar" title="Avançar">▶</button>
        <button class="ct-btn" id="ctRecarregar" title="Recarregar">⟳</button>
        <input id="ctEndereco" class="ct-endereco" placeholder="Digite um site (ex.: netflix não toca aqui) ou pesquise…" spellcheck="false">
        <button class="ct-btn oculto" id="ctConvidar" title="Copiar o link desta sala pra mandar pros colegas (WhatsApp, Teams…)">📨 Convidar</button>
        <button class="ct-btn" id="ctConfig" title="Como esconder">⚙</button>
        <button class="ct-btn ct-esconder" id="ctEsconder" title="Esconder tudo agora (Esc)">🙈 Esconder <kbd>Esc</kbd></button>
      </div>
      <div class="ct-corpo">
        <div class="ct-inicio" id="ctHome"></div>
        <div class="ct-telas" id="ctTelas"></div>
        <div class="ct-config oculto" id="ctPainelCfg"></div>
      </div>`;
    document.body.appendChild(raiz);
    desenharInicio();
    raiz.querySelector("#ctInicio").onclick = irInicio;
    raiz.querySelector("#ctEsconder").onclick = esconder;
    raiz.querySelector("#ctConfig").onclick = alternarConfig;
    raiz.querySelector("#ctVoltar").onclick = () => { const w = vivos.get(atual); if (w && w.canGoBack()) w.goBack(); };
    raiz.querySelector("#ctAvancar").onclick = () => { const w = vivos.get(atual); if (w && w.canGoForward()) w.goForward(); };
    raiz.querySelector("#ctRecarregar").onclick = () => { const w = vivos.get(atual); if (w) w.reload(); };
    // copia o link da sala aberta (o colega cola no navegador ou no cantinho dele)
    raiz.querySelector("#ctConvidar").onclick = async () => {
      const w = vivos.get(atual); if (!w) return;
      const url = w.getURL();
      await window.api.clipboardCopiar(url);
      toast(`📨 <b>Link copiado!</b> Cole no WhatsApp/Teams pro colega. Ele abre no navegador ou cola na barra do cantinho dele.<br><small>${esc(url)}</small>`, "ok", 9000);
    };
    const end = raiz.querySelector("#ctEndereco");
    end.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const t = end.value.trim();
      if (!t) return;
      let url = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) ? "https://" + t : "https://www.google.com/search?hl=pt-BR&q=" + encodeURIComponent(t);
      url = url.replace(/^http:\/\//i, "https://");
      abrirItem({ id: "site", nome: t, url }, true);
      e.preventDefault();
    });
  }

  function desenharInicio() {
    const home = raiz.querySelector("#ctHome");
    home.innerHTML = `<div class="ct-dica"><b>Se chegar alguém:</b> aperte <kbd>Esc</kbd>${prefs.canto !== "off" ? `, leve o mouse no <b>canto ${({ "inf-esq": "inferior esquerdo", "inf-dir": "inferior direito", "sup-esq": "superior esquerdo", "sup-dir": "superior direito" })[prefs.canto]}</b> da tela` : ""}${prefs.blur ? " ou clique fora da janela" : ""} — tudo some na hora, pausa e fica mudo. Pra voltar: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Espaço</kbd> (continua de onde parou).</div>` +
      CATALOGO.map((g) => `<h3 class="ct-grupo">${esc(g.grupo)}</h3><div class="ct-grade">${g.itens.map((it) => `
        <button class="ct-card" data-id="${it.id}"><span class="ct-ic">${it.ic}</span><span><b>${esc(it.nome)}</b><small>${esc(it.desc)}</small></span>${vivos.has(it.id) ? '<span class="ct-aberto" title="aberto — continua de onde parou">●</span>' : ""}</button>`).join("")}</div>`).join("") +
      `<p class="ct-rodape">Netflix, Spotify, Prime Video e Disney+ não tocam aqui (proteção contra cópia). O que você abre nos sites não fica salvo no PC: some quando o DigiDoc fecha.</p>`;
    home.querySelectorAll(".ct-card").forEach((b) => { b.onclick = () => abrirItem(TODOS.find((i) => i.id === b.dataset.id)); });
  }

  function irInicio() {
    pausar(atual);
    atual = "";
    raiz.querySelector("#ctHome").classList.remove("oculto");
    raiz.querySelectorAll(".ct-wv").forEach((w) => w.classList.add("oculto"));
    raiz.querySelector("#ctEndereco").value = "";
    raiz.querySelector("#ctConvidar").classList.add("oculto");
    desenharInicio();
  }

  // abre (ou volta pra) um item. trocar=true recarrega a tela "site" com outro endereco
  function abrirItem(item, trocar = false) {
    if (!item) return;
    if (atual && atual !== item.id) pausar(atual);
    atual = item.id;
    prefs.ultimo = item.id === "site" ? "" : item.id; salvarPrefs();
    raiz.querySelector("#ctHome").classList.add("oculto");
    raiz.querySelector("#ctPainelCfg").classList.add("oculto");
    let wv = vivos.get(item.id);
    if (wv && trocar) { try { wv.loadURL(item.url); } catch {} }
    if (!wv) {
      wv = document.createElement("webview");
      wv.className = "ct-wv";
      wv.setAttribute("src", item.url);
      wv.setAttribute("partition", item.url.startsWith("cantinho-jogos://") ? "persist:cantinho-jogos" : "cantinho");
      wv.addEventListener("did-navigate", (e) => { if (atual === item.id) raiz.querySelector("#ctEndereco").value = e.url.startsWith("cantinho-jogos://") ? "" : e.url; });
      wv.addEventListener("did-navigate-in-page", (e) => { if (atual === item.id && e.isMainFrame) raiz.querySelector("#ctEndereco").value = e.url; });
      raiz.querySelector("#ctTelas").appendChild(wv);
      vivos.set(item.id, wv);
      // muitos abertos: fecha o que foi usado ha mais tempo (economiza memoria)
      while (vivos.size > MAX_VIVOS) {
        const [velhoId, velho] = vivos.entries().next().value;
        if (velhoId === item.id) break;
        velho.remove(); vivos.delete(velhoId);
      }
    } else { vivos.delete(item.id); vivos.set(item.id, wv); } // vira o mais recente
    raiz.querySelectorAll(".ct-wv").forEach((w) => w.classList.toggle("oculto", w !== wv));
    raiz.querySelector("#ctConvidar").classList.toggle("oculto", item.url.startsWith("cantinho-jogos://"));
    try { wv.setAudioMuted(false); } catch {}
    raiz.querySelector("#ctEndereco").value = item.url.startsWith("cantinho-jogos://") ? "" : item.url;
    setTimeout(() => { try { wv.focus(); } catch {} }, 50);
  }

  // pausa e muta (sem fechar: volta de onde parou)
  function pausar(id) {
    const wv = id && vivos.get(id);
    if (!wv) return;
    try { wv.setAudioMuted(true); } catch {}
    try {
      wv.executeJavaScript("document.querySelectorAll('video,audio').forEach(function(m){try{m.pause()}catch(e){}});" +
        "if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen();").catch(() => {});
    } catch {}
  }

  function abrir() {
    if (!raiz) montar();
    if (aberto) return;
    aberto = true;
    raiz.classList.remove("oculto");
    window.api.cantinhoEstado({ aberto: true, canto: prefs.canto });
    const wv = atual && vivos.get(atual);
    if (wv) { try { wv.setAudioMuted(false); wv.focus(); } catch {} }
    else irInicio();
  }

  // SE CHEGAR ALGUEM: some tudo na hora
  function esconder() {
    if (!aberto) return;
    aberto = false;
    raiz.classList.add("oculto");
    for (const id of vivos.keys()) pausar(id);
    window.api.sairTelaCheia();
    window.api.cantinhoEstado({ aberto: false });
    try { if (document.activeElement) document.activeElement.blur(); } catch {}
    document.title = "DigiDoc";
    if (prefs.disfarce === "painel" && window.Painel) window.Painel.abrir();
    else if (prefs.disfarce === "nome") { const i = document.getElementById("inpAssociado"); if (i) { i.focus(); i.select(); } }
  }

  function alternarConfig() {
    const p = raiz.querySelector("#ctPainelCfg");
    if (!p.classList.contains("oculto")) { p.classList.add("oculto"); return; }
    p.innerHTML = `
      <h3>🙈 Como esconder quando chegar alguém</h3>
      <label class="ct-op"><span>Sempre: <kbd>Esc</kbd> ou <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Espaço</kbd> — funciona até com o foco dentro do vídeo/jogo</span></label>
      <label class="ct-op"><input type="checkbox" id="ctOpBlur" ${prefs.blur ? "checked" : ""}> <span>Esconder quando eu clicar fora do DigiDoc ou trocar de programa (Alt+Tab)</span></label>
      <label class="ct-op"><span>Canto de fuga: levar o mouse até o canto da tela esconde</span>
        <select id="ctOpCanto">
          ${[["off", "desligado"], ["inf-esq", "canto inferior esquerdo"], ["inf-dir", "canto inferior direito"], ["sup-esq", "canto superior esquerdo"], ["sup-dir", "canto superior direito"]]
            .map(([v, t]) => `<option value="${v}" ${prefs.canto === v ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
      <label class="ct-op"><span>Depois de esconder, mostrar</span>
        <select id="ctOpDisfarce">
          <option value="nada" ${prefs.disfarce === "nada" ? "selected" : ""}>a tela de trabalho como estava</option>
          <option value="nome" ${prefs.disfarce === "nome" ? "selected" : ""}>a tela de trabalho, já no campo do associado (parece que vai digitar)</option>
          <option value="painel" ${prefs.disfarce === "painel" ? "selected" : ""}>o Painel de produção aberto (parece que está conferindo)</option>
        </select></label>
      <p class="ct-sub">Pra abrir o cantinho: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Espaço</kbd> ou 3 cliques rápidos no ▣ do canto de cima. Não tem botão nenhum na tela.</p>
      <p class="ct-sub">O que você vê nos sites some quando o DigiDoc fecha. Os jogos sem internet guardam só o progresso deles.
        <button class="mini perigo" id="ctApagarJogos">Apagar o progresso dos jogos</button></p>`;
    p.classList.remove("oculto");
    p.querySelector("#ctOpBlur").onchange = (e) => { prefs.blur = e.target.checked; salvarPrefs(); };
    p.querySelector("#ctOpCanto").onchange = (e) => { prefs.canto = e.target.value; salvarPrefs(); window.api.cantinhoEstado({ aberto, canto: prefs.canto }); desenharInicio(); };
    p.querySelector("#ctOpDisfarce").onchange = (e) => { prefs.disfarce = e.target.value; salvarPrefs(); };
    p.querySelector("#ctApagarJogos").onclick = async (e) => {
      for (const it of CATALOGO[0].itens) { const w = vivos.get(it.id); if (w) { w.remove(); vivos.delete(it.id); } }
      await window.api.cantinhoApagarJogos();
      e.target.textContent = "✓ apagado";
    };
  }

  // ---- atalhos ----
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === "Space") { e.preventDefault(); e.stopImmediatePropagation(); aberto ? esconder() : abrir(); return; }
    if (aberto && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); esconder(); }
  }, true);
  // 3 cliques rapidos no ▣ do topo
  let cliques = [];
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest(".topo .logo")) return;
    const agora = Date.now();
    cliques = cliques.filter((t) => agora - t < 700); cliques.push(agora);
    if (cliques.length >= 3) { cliques = []; abrir(); }
  });
  window.api.onCantinhoPanico(esconder);
  window.api.onJanelaBlur(() => { if (aberto && prefs.blur) esconder(); });

  return { abrir, esconder, aberto: () => aberto };
})();
