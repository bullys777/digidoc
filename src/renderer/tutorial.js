"use strict";
// Tour guiado animado sobre a interface REAL do DigiDoc, com som e narração por voz.
(function () {
  const S = (x) => document.querySelector(x);
  const sfx = (n) => { if (window.SomTutorial) window.SomTutorial.sfx(n); };
  const T = () => window.DigiDocTour || {};

  const PASSOS = [
    { centro: true, dur: 4200, sfx: "whoosh",
      logo: "▣", titulo: "DigiDoc", desc: "Vou te mostrar como digitalizar os documentos dos associados em segundos.", credito: "Desenvolvido por Otavio Martins" },
    { alvo: ".modos", dur: 5200, sfx: "pop", passo: "Passo 1", titulo: "Escolha o modo",
      desc: "Dossiê completo junta tudo num PDF só. Documento por documento faz um PDF para cada tipo.",
      async antes() { T().trocar && T().trocar("documentos"); await esperar(700); T().trocar && T().trocar("dossie"); } },
    { alvo: "#inpAssociado", dur: 5600, sfx: null, passo: "Passo 2", titulo: "Digite o associado",
      desc: "A pasta, com a letra e o nome, é criada sozinha quando você salva. Você nunca cria na mão.",
      async antes() { if (T().digitar) await T().digitar("Maria Silva"); } },
    { alvo: ".fontes", dur: 5400, sfx: "scan", passo: "Passo 3", titulo: "Traga as páginas",
      desc: "Clique em Escanear: o programa descobre sozinho se o papel está no alimentador ou no vidro. Ou importe, arraste, cole, ou use o iPhone.",
      async antes() { if (T().addDemo) await T().addDemo(3); } },
    { alvo: ".col-pags", dur: 5800, sfx: "pop", passo: "Passo 4", titulo: "Organize num clique",
      desc: "Gire, reordene arrastando, e marque o tipo de cada página. Cada tipo vira um PDF separado.",
      async antes() { T().trocar && T().trocar("documentos"); await esperar(400); T().marcarTipos && T().marcarTipos(); await esperar(300); T().girarPrimeira && T().girarPrimeira(); } },
    { alvo: ".salvar-area", dur: 5200, sfx: "pop", passo: "Passo 5", titulo: "Salve em PDF",
      desc: "O programa comprime sozinho pra caber no limite do Siclus e nomeia certo, sem precisar dividir." },
    { alvo: "#scannerChip", dur: 5400, sfx: "pop", passo: "Extra", titulo: "Qualquer scanner e o iPhone",
      desc: "Funciona com impressora multifuncional, scanner de folhas ou scanner de mesa: ele vê sozinho o que o aparelho tem. E o iPhone manda as fotos pelo QR Code, sem cabo." },

    // ----- Configurações -----
    { alvo: "#gSalvar", dur: 5200, sfx: "pop", passo: "Configurações", titulo: "Onde salvar",
      desc: "Aqui você escolhe a pasta principal onde tudo é guardado. Pode ser no pendrive ou no computador.",
      async antes() { T().configAbrir && T().configAbrir(); await esperar(450); T().configScroll && await T().configScroll("#gSalvar"); } },
    { alvo: "#gTipos", dur: 6200, sfx: "pop", passo: "Configurações", titulo: "Tipos de documento",
      desc: "Crie e edite os tipos. A sigla vira o nome do arquivo, como RG ponto PDF. Dá pra colar vários de uma vez e preencher as siglas automaticamente.",
      async antes() { T().configScroll && await T().configScroll("#gTipos"); } },
    { alvo: "#gLimites", dur: 5600, sfx: "pop", passo: "Configurações", titulo: "Limites do Siclus",
      desc: "O tamanho máximo do PDF, de dois mega, e o máximo de quarenta caracteres no nome. O programa respeita isso sozinho.",
      async antes() { T().configAvancado && T().configAvancado(); await esperar(300); T().configScroll && await T().configScroll("#gLimites"); } },
    { alvo: "#gAjustes", dur: 5600, sfx: "pop", passo: "Configurações", titulo: "Ajustes automáticos",
      desc: "Girar para o lado certo, endireitar, clarear o fundo, tirar página em branco e dar nitidez. Pode ligar ou desligar cada um.",
      async antes() { T().configScroll && await T().configScroll("#gAjustes"); } },
    { alvo: "#gScanner", dur: 5600, sfx: "pop", passo: "Configurações", titulo: "Scanner",
      desc: "De onde vem o papel, que pode ficar no automático, frente e verso, qual scanner usar, e o botão pra instalar o motor do scanner no pendrive.",
      async antes() { T().configScroll && await T().configScroll("#gScanner"); } },
    { alvo: "#gBackup", dur: 5400, sfx: "pop", passo: "Configurações", titulo: "Depois de salvar",
      desc: "Abrir a pasta, tocar um som, e uma pasta de backup que copia cada PDF pra um segundo lugar, por segurança.",
      async antes() { T().configScroll && await T().configScroll("#gBackup"); } },

    { centro: true, dur: 5000, sfx: "ding",
      logo: "✓", titulo: "Pronto!", desc: "Agora é só digitalizar. Rápido, organizado e no tamanho certo.", credito: "DigiDoc · Desenvolvido por Otavio Martins",
      async antes() { if (T().configFechar) T().configFechar(); if (T().limparSoDemo) await T().limparSoDemo(); } },
  ];

  let camada, dim, spot, cartao, centro, prog, dots, btnPlay, btnMudo;
  let atual = 0, tocando = true, timer = null, estadoIni = null, construido = false, mudo = false;
  let vozPt = null;

  function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function carregarVozes() {
    if (!window.speechSynthesis) return;
    const vs = speechSynthesis.getVoices();
    vozPt = vs.find((v) => /pt[-_]?BR/i.test(v.lang)) || vs.find((v) => /português|portugu[eê]s|brasil/i.test(v.name)) || vs.find((v) => /^pt/i.test(v.lang)) || null;
  }

  function narrar(texto, aoTerminar) {
    if (mudo || !window.speechSynthesis || !texto.trim()) { aoTerminar && aoTerminar(false); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      if (vozPt) u.voice = vozPt;
      u.lang = "pt-BR"; u.rate = 1.0; u.pitch = 1.03;
      u.onend = () => aoTerminar && aoTerminar(true);
      u.onerror = () => aoTerminar && aoTerminar(false);
      speechSynthesis.speak(u);
    } catch { aoTerminar && aoTerminar(false); }
  }
  function pararVoz() { try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch {} }

  function construir() {
    camada = document.createElement("div");
    camada.className = "tut-camada oculto";
    camada.innerHTML = `
      <div class="tut-dim" id="tutDim"></div>
      <div class="tut-spot" id="tutSpot"></div>
      <div class="tut-centro"><div class="tut-hero" id="tutHero"></div></div>
      <div class="tut-cartao" id="tutCartao"></div>
      <div class="tut-barra">
        <button class="tut-b" id="tutPrev">◀</button>
        <button class="tut-b play" id="tutPlay">⏸ Pausar</button>
        <button class="tut-b" id="tutNext">▶</button>
        <div class="tut-prog"><div id="tutProg"></div></div>
        <div class="tut-dots" id="tutDots"></div>
        <button class="tut-b icone" id="tutMudo" title="Som e narração">🔊</button>
        <button class="tut-fechar" id="tutX" title="Fechar (Esc)">✕</button>
      </div>`;
    document.body.appendChild(camada);
    dim = S("#tutDim"); spot = S("#tutSpot"); cartao = S("#tutCartao"); centro = S("#tutHero");
    prog = S("#tutProg"); dots = S("#tutDots"); btnPlay = S("#tutPlay"); btnMudo = S("#tutMudo");
    dots.innerHTML = PASSOS.map((_, i) => `<div class="tut-dot" data-i="${i}"></div>`).join("");
    dots.querySelectorAll(".tut-dot").forEach((d) => d.onclick = () => irPara(+d.dataset.i));
    S("#tutX").onclick = fechar;
    S("#tutPrev").onclick = () => irPara(atual - 1);
    S("#tutNext").onclick = () => irPara(atual + 1);
    btnPlay.onclick = alternarPlay;
    btnMudo.onclick = () => {
      mudo = !mudo;
      if (window.SomTutorial) window.SomTutorial.setMudo(mudo);
      if (mudo) pararVoz();
      btnMudo.textContent = mudo ? "🔇" : "🔊";
      if (!mudo && tocando) render(atual); // retoma narração do passo
    };
    window.addEventListener("resize", reposicionar);
    document.addEventListener("keydown", (e) => {
      if (camada.classList.contains("oculto")) return;
      if (e.key === "Escape") fechar();
      else if (e.key === "ArrowRight") irPara(atual + 1);
      else if (e.key === "ArrowLeft") irPara(atual - 1);
      else if (e.key === " ") { e.preventDefault(); alternarPlay(); }
    });
    if (window.speechSynthesis) { carregarVozes(); speechSynthesis.onvoiceschanged = carregarVozes; }
    construido = true;
  }

  let _passoAtivo = null;
  function avancar(p) { if (_passoAtivo !== p) return; if (atual === PASSOS.length - 1) pausar(); else irPara(atual + 1); }

  async function render(i) {
    atual = (i + PASSOS.length) % PASSOS.length;
    const p = PASSOS[atual]; _passoAtivo = p;
    clearTimeout(timer); pararVoz();
    // reseta o visual no inicio (evita sobra da cena anterior durante ações assíncronas)
    cartao.classList.remove("on"); spot.classList.remove("on"); centro.classList.remove("on");
    dots.querySelectorAll(".tut-dot").forEach((d, k) => d.classList.toggle("on", k === atual));

    if (p.sfx) sfx(p.sfx);
    if (p.antes) { try { await p.antes(); } catch {} }
    if (_passoAtivo !== p) return; // trocou de passo durante a ação

    if (p.centro) {
      spot.classList.remove("on"); cartao.classList.remove("on"); dim.classList.add("on");
      centro.innerHTML = `<div class="logo">${p.logo}</div><h1>${p.titulo}</h1><p>${p.desc}</p><div class="credito">${p.credito || ""}</div>`;
      requestAnimationFrame(() => centro.classList.add("on"));
    } else {
      centro.classList.remove("on"); dim.classList.remove("on");
      const el = S(p.alvo);
      cartao.innerHTML = `<div class="seta"></div><span class="passo">${p.passo || ""}</span><h2>${p.titulo}</h2><p>${p.desc}</p>`;
      posicionar(el);
      spot.classList.add("on"); requestAnimationFrame(() => cartao.classList.add("on"));
    }

    // barra + avanço: pela narração (quando o narrador termina), senão por tempo
    const texto = (p.titulo ? p.titulo + ". " : "") + (p.desc || "");
    const durBarra = (!mudo && window.speechSynthesis) ? Math.max(p.dur, texto.length * 70 + 1200) : p.dur;
    prog.style.transition = "none"; prog.style.width = (atual / PASSOS.length * 100) + "%";
    requestAnimationFrame(() => { prog.style.transition = `width ${durBarra}ms linear`; prog.style.width = ((atual + 1) / PASSOS.length * 100) + "%"; });

    if (!tocando) return;
    narrar(texto, (falou) => { if (falou && tocando) avancar(p); });
    // tempo: se narrou, é só uma rede de segurança (bem maior); se mudo, é o tempo real
    timer = setTimeout(() => avancar(p), (!mudo && window.speechSynthesis) ? durBarra + 4000 : p.dur);
  }

  function posicionar(el) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!el) { spot.classList.remove("on"); return; }
    const r = el.getBoundingClientRect();
    const pad = 8;
    const Top = Math.max(4, r.top - pad), L = Math.max(4, r.left - pad);
    const W = Math.min(vw - 8, r.width + pad * 2), H = r.height + pad * 2;
    spot.style.left = L + "px"; spot.style.top = Top + "px"; spot.style.width = W + "px"; spot.style.height = H + "px";
    const ch = cartao.offsetHeight || 140, cw = cartao.offsetWidth || 360;
    let cx = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
    let cy, setaEmCima;
    if (Top + H + ch + 22 < vh) { cy = Top + H + 14; setaEmCima = true; }
    else if (Top - ch - 14 > 8) { cy = Top - ch - 14; setaEmCima = false; }
    else { cy = Math.min(vh - ch - 70, Math.max(12, Top)); setaEmCima = true; }
    cartao.style.left = cx + "px"; cartao.style.top = cy + "px";
    const seta = cartao.querySelector(".seta");
    if (seta) {
      const sx = Math.min(Math.max(16, r.left + r.width / 2 - cx - 7), cw - 30);
      seta.style.left = sx + "px"; seta.style.top = setaEmCima ? "-8px" : (ch - 7) + "px";
      seta.style.borderWidth = setaEmCima ? "1px 0 0 1px" : "0 1px 1px 0";
    }
  }
  function reposicionar() { if (_passoAtivo && !_passoAtivo.centro) posicionar(S(_passoAtivo.alvo)); }

  function irPara(i) { render(i); }
  function pausar() { tocando = false; clearTimeout(timer); pararVoz(); btnPlay.innerHTML = "▶ Tocar"; prog.style.transition = "none"; }
  function tocar() { tocando = true; btnPlay.innerHTML = "⏸ Pausar"; render(atual); }
  function alternarPlay() { tocando ? pausar() : tocar(); }

  function abrir() {
    if (!construido) construir();
    carregarVozes();
    estadoIni = (T().estadoInicial && T().estadoInicial()) || null;
    camada.classList.remove("oculto");
    if (window.SomTutorial) { window.SomTutorial.setMudo(mudo); window.SomTutorial.iniciar(); }
    btnMudo.textContent = mudo ? "🔇" : "🔊";
    tocando = true; btnPlay.innerHTML = "⏸ Pausar";
    render(0);
  }
  function fechar() {
    if (!construido) return;
    clearTimeout(timer); pararVoz();
    if (window.SomTutorial) window.SomTutorial.parar();
    camada.classList.add("oculto");
    spot.classList.remove("on"); cartao.classList.remove("on"); centro.classList.remove("on"); dim.classList.remove("on");
    if (T().limparDemo) T().limparDemo(estadoIni);
  }

  window.Tutorial = { abrir, fechar };
  window.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("btnTutorial");
    if (b) b.onclick = abrir;
  });
})();
