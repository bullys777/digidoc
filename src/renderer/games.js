"use strict";
// Central de joguinhos do DigiDoc — versões leves e limpas dos clássicos.
(function () {
  let camada, corpo, placarEl, jogoAtual = null;

  // ---------------- utilidades ----------------
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  function setPlacar(txt) { placarEl.textContent = txt || ""; }

  // ================= JOGOS =================
  const JOGOS = [
    { id: "cobra", emoji: "🐍", nome: "Cobrinha", desc: "Coma as maçãs e cresça. Setas pra mover.", iniciar: jogoCobra },
    { id: "2048", emoji: "🔢", nome: "2048", desc: "Junte os números até chegar no 2048.", iniciar: jogo2048 },
    { id: "memoria", emoji: "🧠", nome: "Memória", desc: "Ache todos os pares de figuras.", iniciar: jogoMemoria },
    { id: "mina", emoji: "💣", nome: "Campo Minado", desc: "Revele sem explodir. Direito = bandeira.", iniciar: jogoMina },
    { id: "velha", emoji: "⭕", nome: "Jogo da Velha", desc: "Você (X) contra o computador (O).", iniciar: jogoVelha },
    { id: "pong", emoji: "🏓", nome: "Pong", desc: "Mouse pra mover. Primeiro a 5 vence.", iniciar: jogoPong },
    { id: "tijolo", emoji: "🧱", nome: "Quebra-tijolos", desc: "Rebata a bola e quebre os tijolos.", iniciar: jogoTijolo },
    { id: "flappy", emoji: "🐤", nome: "Flappy", desc: "Espaço/clique pra voar entre os canos.", iniciar: jogoFlappy },
    { id: "dino", emoji: "🦖", nome: "Dino Corrida", desc: "Pule os cactos. Espaço pra pular.", iniciar: jogoDino },
    { id: "genius", emoji: "🎵", nome: "Genius", desc: "Repita a sequência de cores.", iniciar: jogoGenius },
    { id: "toupeira", emoji: "🐹", nome: "Pega-Toupeira", desc: "Clique nas toupeiras em 30s.", iniciar: jogoToupeira },
    { id: "ppt", emoji: "✂️", nome: "Pedra Papel Tesoura", desc: "Clássico contra o computador.", iniciar: jogoPPT },
    { id: "forca", emoji: "🔤", nome: "Forca", desc: "Adivinhe a palavra letra por letra.", iniciar: jogoForca },
    { id: "invasores", emoji: "👾", nome: "Invasores", desc: "Atire nos aliens. Setas + espaço.", iniciar: jogoInvasores },
    { id: "asteroides", emoji: "🚀", nome: "Asteroides", desc: "Gire, acelere e atire nas rochas.", iniciar: jogoAsteroides },
    { id: "tiroalvo", emoji: "🎯", nome: "Tiro ao Alvo", desc: "Acerte os alvos em 30s. Mira no mouse.", iniciar: jogoTiroAlvo },
    { id: "nave", emoji: "🛸", nome: "Nave", desc: "Shooter vertical. Mouse pra desviar e atirar.", iniciar: jogoNave },
  ];

  // ---------- Cobrinha ----------
  function jogoCobra(palco) {
    const N = 20, CEL = 18, S = N * CEL;
    const cv = el("canvas"); cv.width = S; cv.height = S; const g = cv.getContext("2d");
    palco.appendChild(cv);
    palco.appendChild(el("div", "jogo-dica", "Setas pra mover"));
    let cobra, dir, prox, comida, pts, vivo, timer;
    function reset() {
      cobra = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
      dir = { x: 1, y: 0 }; prox = dir; comida = novaComida(); pts = 0; vivo = true; setPlacar("Pontos: 0");
    }
    function novaComida() { let c; do { c = { x: (Math.random() * N) | 0, y: (Math.random() * N) | 0 }; } while (cobra && cobra.some(s => s.x === c.x && s.y === c.y)); return c; }
    function passo() {
      if (!vivo) return;
      dir = prox;
      const h = { x: cobra[0].x + dir.x, y: cobra[0].y + dir.y };
      if (h.x < 0 || h.y < 0 || h.x >= N || h.y >= N || cobra.some(s => s.x === h.x && s.y === h.y)) { vivo = false; fim(); return; }
      cobra.unshift(h);
      if (h.x === comida.x && h.y === comida.y) { pts++; setPlacar("Pontos: " + pts); comida = novaComida(); } else cobra.pop();
      desenhar();
    }
    function desenhar() {
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, S, S);
      g.fillStyle = "#e05a8a"; g.fillRect(comida.x * CEL + 2, comida.y * CEL + 2, CEL - 4, CEL - 4);
      cobra.forEach((s, i) => { g.fillStyle = i === 0 ? "#a07bff" : "#7c4dff"; g.fillRect(s.x * CEL + 1, s.y * CEL + 1, CEL - 2, CEL - 2); });
    }
    function fim() {
      clearInterval(timer);
      const ov = el("div", "jogo-fim", `<h3>Fim! ${pts} ponto(s)</h3><button class="jogo-btn">Jogar de novo</button>`);
      palco.style.position = "relative"; palco.appendChild(ov);
      ov.querySelector("button").onclick = () => { ov.remove(); reset(); timer = setInterval(passo, 110); desenhar(); };
    }
    const tecla = (e) => {
      const m = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }[e.key];
      if (!m) return; e.preventDefault();
      if (m.x !== -dir.x || m.y !== -dir.y) prox = m;
    };
    document.addEventListener("keydown", tecla);
    reset(); desenhar(); timer = setInterval(passo, 110);
    return { cleanup() { clearInterval(timer); document.removeEventListener("keydown", tecla); } };
  }

  // ---------- 2048 ----------
  function jogo2048(palco) {
    const CORES = { 2: "#3a3550", 4: "#4a4066", 8: "#b7791f", 16: "#c76a28", 32: "#d1553a", 64: "#d1352c", 128: "#e0a93c", 256: "#e0b93c", 512: "#2f9d6f", 1024: "#2f8fdb", 2048: "#7c4dff" };
    let g = Array.from({ length: 4 }, () => [0, 0, 0, 0]), pts = 0;
    const grade = el("div", "g2048"); palco.appendChild(grade);
    palco.appendChild(el("div", "jogo-dica", "Setas pra juntar os números"));
    function spawn() { const v = []; g.forEach((r, i) => r.forEach((c, j) => { if (!c) v.push([i, j]); })); if (!v.length) return; const [i, j] = v[(Math.random() * v.length) | 0]; g[i][j] = Math.random() < 0.9 ? 2 : 4; }
    function render() {
      grade.innerHTML = "";
      g.forEach(r => r.forEach(c => { const d = el("div", "cel", c || ""); if (c) { d.style.background = CORES[c] || "#7c4dff"; d.style.fontSize = c >= 1024 ? "20px" : "26px"; } grade.appendChild(d); }));
      setPlacar("Pontos: " + pts);
    }
    const comprime = (linha) => { let a = linha.filter(x => x); for (let i = 0; i < a.length - 1; i++) if (a[i] === a[i + 1]) { a[i] *= 2; pts += a[i]; a[i + 1] = 0; } a = a.filter(x => x); while (a.length < 4) a.push(0); return a; };
    function mover(dir) {
      const antes = JSON.stringify(g);
      const rot = (m) => m[0].map((_, c) => m.map(r => r[c]));
      if (dir === "ArrowLeft") g = g.map(comprime);
      else if (dir === "ArrowRight") g = g.map(r => comprime(r.reverse()).reverse());
      else if (dir === "ArrowUp") { let t = rot(g).map(comprime); g = rot(t.map(r => r)); g = g[0].map((_, c) => t.map(r => r[c])); }
      else if (dir === "ArrowDown") { let t = rot(g).map(r => comprime(r.reverse()).reverse()); g = t[0].map((_, c) => t.map(r => r[c])); }
      if (JSON.stringify(g) !== antes) { spawn(); render(); checar(); }
    }
    function checar() {
      if (g.some(r => r.includes(2048))) return fim("Você chegou no 2048! 🎉");
      const cheio = g.every(r => r.every(c => c));
      const temMov = g.some((r, i) => r.some((c, j) => (j < 3 && c === r[j + 1]) || (i < 3 && c === g[i + 1][j])));
      if (cheio && !temMov) fim("Fim de jogo!");
    }
    function fim(msg) {
      const ov = el("div", "jogo-fim", `<h3>${msg}</h3><div class="jogo-dica">${pts} pontos</div><button class="jogo-btn">Jogar de novo</button>`);
      palco.style.position = "relative"; palco.appendChild(ov);
      ov.querySelector("button").onclick = () => { ov.remove(); g = Array.from({ length: 4 }, () => [0, 0, 0, 0]); pts = 0; spawn(); spawn(); render(); };
    }
    const tecla = (e) => { if (e.key.startsWith("Arrow")) { e.preventDefault(); mover(e.key); } };
    document.addEventListener("keydown", tecla);
    spawn(); spawn(); render();
    return { cleanup() { document.removeEventListener("keydown", tecla); } };
  }

  // ---------- Memória ----------
  function jogoMemoria(palco) {
    const figs = ["🍎", "🚗", "🌟", "🐶", "🎈", "🍕", "⚽", "🎸"];
    let baralho = [...figs, ...figs].sort(() => Math.random() - 0.5);
    let viradas = [], achados = 0, jogadas = 0, travado = false;
    const grade = el("div", "gmem"); palco.appendChild(grade);
    palco.appendChild(el("div", "jogo-dica", "Ache os 8 pares"));
    setPlacar("Jogadas: 0");
    baralho.forEach((fig, i) => {
      const c = el("div", "carta"); c.dataset.i = i; c.dataset.fig = fig;
      c.onclick = () => {
        if (travado || c.classList.contains("virada") || c.classList.contains("achou")) return;
        c.classList.add("virada"); c.textContent = fig; viradas.push(c);
        if (viradas.length === 2) {
          jogadas++; setPlacar("Jogadas: " + jogadas); travado = true;
          const [a, b] = viradas;
          if (a.dataset.fig === b.dataset.fig) { a.classList.add("achou"); b.classList.add("achou"); viradas = []; travado = false; achados++; if (achados === figs.length) fim(); }
          else setTimeout(() => { a.classList.remove("virada"); b.classList.remove("virada"); a.textContent = ""; b.textContent = ""; viradas = []; travado = false; }, 700);
        }
      };
      grade.appendChild(c);
    });
    function fim() {
      const ov = el("div", "jogo-fim", `<h3>Boa! 🎉</h3><div class="jogo-dica">Em ${jogadas} jogadas</div><button class="jogo-btn">Jogar de novo</button>`);
      palco.style.position = "relative"; palco.appendChild(ov);
      ov.querySelector("button").onclick = () => { ov.remove(); jogoAtual && jogoAtual.cleanup && jogoAtual.cleanup(); corpo.innerHTML = ""; const p = el("div", "jogo-palco"); corpo.appendChild(p); jogoAtual = jogoMemoria(p); };
    }
    return { cleanup() {} };
  }

  // ---------- Campo Minado ----------
  function jogoMina(palco) {
    const N = 9, MINAS = 10, CORES = ["", "#6ea8ff", "#35c074", "#f1685e", "#c9a7ff", "#e0a93c", "#22d3ee", "#fff", "#aaa"];
    let g, aberto, bandeira, vivo, restam, timer, seg;
    const cont = el("div"); palco.appendChild(cont);
    palco.appendChild(el("div", "jogo-dica", "Clique pra abrir · clique direito = bandeira"));
    function reset() {
      g = Array.from({ length: N }, () => Array(N).fill(0));
      aberto = Array.from({ length: N }, () => Array(N).fill(false));
      bandeira = Array.from({ length: N }, () => Array(N).fill(false));
      vivo = true; restam = N * N - MINAS; seg = 0; clearInterval(timer); timer = setInterval(() => { if (vivo) { seg++; setPlacar("Tempo: " + seg + "s"); } }, 1000);
      let postas = 0; while (postas < MINAS) { const i = (Math.random() * N) | 0, j = (Math.random() * N) | 0; if (g[i][j] !== "M") { g[i][j] = "M"; postas++; } }
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { if (g[i][j] === "M") continue; let c = 0; viz(i, j, (a, b) => { if (g[a][b] === "M") c++; }); g[i][j] = c; }
      setPlacar("Tempo: 0s"); render();
    }
    const viz = (i, j, fn) => { for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) if (a >= 0 && b >= 0 && a < N && b < N && !(a === i && b === j)) fn(a, b); };
    function abrir(i, j) {
      if (!vivo || aberto[i][j] || bandeira[i][j]) return;
      aberto[i][j] = true;
      if (g[i][j] === "M") { vivo = false; clearInterval(timer); render(true); return fim(false); }
      restam--;
      if (g[i][j] === 0) viz(i, j, (a, b) => abrir(a, b));
      if (restam === 0) { vivo = false; clearInterval(timer); fim(true); }
    }
    function render(mostrarMinas) {
      cont.innerHTML = "";
      const grade = el("div", "gmine"); grade.style.gridTemplateColumns = `repeat(${N},30px)`;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const c = el("div", "c"); const a = aberto[i][j];
        if (a || (mostrarMinas && g[i][j] === "M")) {
          c.classList.add("aberta");
          if (g[i][j] === "M") { c.classList.add("bomba"); c.textContent = "💣"; }
          else if (g[i][j] > 0) { c.textContent = g[i][j]; c.style.color = CORES[g[i][j]]; }
        } else if (bandeira[i][j]) c.textContent = "🚩";
        c.oncontextmenu = (e) => { e.preventDefault(); if (vivo && !aberto[i][j]) { bandeira[i][j] = !bandeira[i][j]; render(); } };
        c.onclick = () => { if (vivo) { abrir(i, j); render(); } };
        grade.appendChild(c);
      }
      cont.appendChild(grade);
    }
    function fim(venceu) {
      const ov = el("div", "jogo-fim", `<h3>${venceu ? "Venceu! 🎉" : "💥 Boom!"}</h3><button class="jogo-btn">Jogar de novo</button>`);
      palco.style.position = "relative"; palco.appendChild(ov);
      ov.querySelector("button").onclick = () => { ov.remove(); reset(); };
    }
    reset();
    return { cleanup() { clearInterval(timer); } };
  }

  // ---------- Jogo da Velha ----------
  function jogoVelha(palco) {
    let t, fim_, vezJog;
    const grade = el("div", "gvelha"); palco.appendChild(grade);
    const dica = el("div", "jogo-dica"); palco.appendChild(dica);
    function reset() { t = Array(9).fill(""); fim_ = false; vezJog = true; setPlacar("Você é X"); dica.textContent = "Sua vez"; render(); }
    const linhas = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const vencedor = (b) => { for (const [a, c, d] of linhas) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return b.includes("") ? null : "empate"; };
    function render() {
      grade.innerHTML = "";
      t.forEach((v, i) => { const q = el("div", "q" + (v ? " " + v.toLowerCase() : ""), v); q.onclick = () => jogar(i); grade.appendChild(q); });
    }
    function jogar(i) {
      if (fim_ || t[i] || !vezJog) return;
      t[i] = "X"; vezJog = false; render(); if (checar()) return;
      dica.textContent = "Computador pensando..."; setTimeout(() => { cpu(); render(); if (!checar()) { vezJog = true; dica.textContent = "Sua vez"; } }, 350);
    }
    function cpu() {
      const vazias = t.map((v, i) => v ? -1 : i).filter(i => i >= 0);
      const tenta = (quem) => { for (const i of vazias) { const c = [...t]; c[i] = quem; if (vencedor(c) === quem) return i; } return -1; };
      let i = tenta("O"); if (i < 0) i = tenta("X"); // ganha, senão bloqueia
      if (i < 0 && t[4] === "") i = 4;
      if (i < 0) { const cantos = [0, 2, 6, 8].filter(c => !t[c]); i = cantos.length ? cantos[(Math.random() * cantos.length) | 0] : vazias[(Math.random() * vazias.length) | 0]; }
      t[i] = "O";
    }
    function checar() { const v = vencedor(t); if (v) { fim_ = true; dica.textContent = v === "X" ? "Você ganhou! 🎉" : v === "O" ? "Computador ganhou" : "Deu velha!"; setTimeout(botaoReset, 400); return true; } return false; }
    function botaoReset() { const b = el("button", "jogo-btn", "Jogar de novo"); b.onclick = reset; dica.appendChild(document.createElement("br")); dica.appendChild(b); }
    reset();
    return { cleanup() {} };
  }

  // ---------- Pong ----------
  function jogoPong(palco) {
    const W = 460, H = 300; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "Mexa o mouse pra mover sua barra (esquerda)"));
    let py = H / 2, ay = H / 2, bx, by, vx, vy, ps = 0, as = 0, raf;
    const PH = 64, PW = 10;
    function saque(dir) { bx = W / 2; by = H / 2; vx = 4 * dir; vy = (Math.random() * 4 - 2); }
    function loop() {
      // IA segue a bola com atraso
      ay += Math.max(-4, Math.min(4, (by - ay) * 0.09));
      bx += vx; by += vy;
      if (by < 6 || by > H - 6) vy *= -1;
      // raquete jogador
      if (bx < PW + 10 && by > py - PH / 2 && by < py + PH / 2) { vx = Math.abs(vx) + 0.3; vy += (by - py) * 0.05; }
      // raquete IA
      if (bx > W - PW - 10 && by > ay - PH / 2 && by < ay + PH / 2) { vx = -Math.abs(vx) - 0.3; vy += (by - ay) * 0.05; }
      if (bx < 0) { as++; placar(); saque(1); } if (bx > W) { ps++; placar(); saque(-1); }
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      g.strokeStyle = "#ffffff20"; g.setLineDash([6, 8]); g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#a07bff"; g.fillRect(6, py - PH / 2, PW, PH);
      g.fillStyle = "#6ea8ff"; g.fillRect(W - PW - 6, ay - PH / 2, PW, PH);
      g.fillStyle = "#fff"; g.beginPath(); g.arc(bx, by, 6, 0, 7); g.fill();
      if (ps < 5 && as < 5) raf = requestAnimationFrame(loop);
      else fim();
    }
    function placar() { setPlacar(`Você ${ps} × ${as} CPU`); }
    function fim() {
      const ov = el("div", "jogo-fim", `<h3>${ps > as ? "Você venceu! 🎉" : "CPU venceu"}</h3><button class="jogo-btn">Jogar de novo</button>`);
      palco.style.position = "relative"; palco.appendChild(ov);
      ov.querySelector("button").onclick = () => { ov.remove(); ps = as = 0; placar(); saque(1); loop(); };
    }
    const mover = (e) => { const r = cv.getBoundingClientRect(); py = Math.max(PH / 2, Math.min(H - PH / 2, e.clientY - r.top)); };
    cv.addEventListener("mousemove", mover);
    placar(); saque(1); loop();
    return { cleanup() { cancelAnimationFrame(raf); cv.removeEventListener("mousemove", mover); } };
  }

  // ---------- Quebra-tijolos ----------
  function jogoTijolo(palco) {
    const W = 460, H = 320; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "Mexa o mouse pra rebater"));
    const COLS = 9, ROWS = 5, BW = 44, BH = 16, GAP = 4, OFF = (W - (COLS * (BW + GAP) - GAP)) / 2;
    let px, bx, by, vx, vy, tij, pts, raf, vivo;
    function reset() { px = W / 2; bx = W / 2; by = H - 40; vx = 3; vy = -3; pts = 0; vivo = true; tij = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) tij.push({ r, c, viva: true }); setPlacar("Pontos: 0"); }
    function loop() {
      bx += vx; by += vy;
      if (bx < 6 || bx > W - 6) vx *= -1; if (by < 6) vy *= -1;
      if (by > H - 24 && by < H - 14 && bx > px - 40 && bx < px + 40) { vy = -Math.abs(vy); vx += (bx - px) * 0.04; }
      if (by > H) { vivo = false; return fim("Caiu!"); }
      tij.forEach(t => { if (!t.viva) return; const x = OFF + t.c * (BW + GAP), y = 40 + t.r * (BH + GAP); if (bx > x && bx < x + BW && by > y && by < y + BH) { t.viva = false; vy *= -1; pts += 10; setPlacar("Pontos: " + pts); } });
      if (!tij.some(t => t.viva)) { vivo = false; return fim("Venceu! 🎉"); }
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      tij.forEach(t => { if (!t.viva) return; g.fillStyle = ["#e05a8a", "#e0a93c", "#35c074", "#6ea8ff", "#a07bff"][t.r]; g.fillRect(OFF + t.c * (BW + GAP), 40 + t.r * (BH + GAP), BW, BH); });
      g.fillStyle = "#a07bff"; g.fillRect(px - 40, H - 20, 80, 10);
      g.fillStyle = "#fff"; g.beginPath(); g.arc(bx, by, 6, 0, 7); g.fill();
      if (vivo) raf = requestAnimationFrame(loop);
    }
    function fim(msg) { const ov = el("div", "jogo-fim", `<h3>${msg}</h3><div class="jogo-dica">${pts} pontos</div><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); loop(); }; }
    const mv = (e) => { const r = cv.getBoundingClientRect(); px = Math.max(40, Math.min(W - 40, e.clientX - r.left)); };
    cv.addEventListener("mousemove", mv); reset(); loop();
    return { cleanup() { cancelAnimationFrame(raf); cv.removeEventListener("mousemove", mv); } };
  }

  // ---------- Flappy ----------
  function jogoFlappy(palco) {
    const W = 360, H = 400; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "Espaço ou clique pra voar"));
    let y, vy, canos, pts, raf, vivo, t;
    const GAP = 120, LARG = 52;
    function reset() { y = H / 2; vy = 0; canos = []; pts = 0; vivo = true; t = 0; setPlacar("Pontos: 0"); }
    function flap() { if (vivo) vy = -6.2; }
    function loop() {
      t++; vy += 0.38; y += vy;
      if (t % 95 === 0) canos.push({ x: W, top: 50 + Math.random() * (H - GAP - 120), passou: false });
      canos.forEach(c => { c.x -= 2.4; if (!c.passou && c.x + LARG < 60) { c.passou = true; pts++; setPlacar("Pontos: " + pts); } });
      canos = canos.filter(c => c.x > -LARG);
      for (const c of canos) if (60 + 14 > c.x && 60 - 14 < c.x + LARG && (y - 14 < c.top || y + 14 > c.top + GAP)) vivo = false;
      if (y > H - 14 || y < 14) vivo = false;
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#35c074"; canos.forEach(c => { g.fillRect(c.x, 0, LARG, c.top); g.fillRect(c.x, c.top + GAP, LARG, H - c.top - GAP); });
      g.font = "26px serif"; g.fillText("🐤", 46, y + 9);
      if (vivo) raf = requestAnimationFrame(loop); else fim();
    }
    function fim() { const ov = el("div", "jogo-fim", `<h3>Fim! ${pts} ponto(s)</h3><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); loop(); }; }
    const tecla = (e) => { if (e.key === " ") { e.preventDefault(); flap(); } };
    document.addEventListener("keydown", tecla); cv.addEventListener("mousedown", flap);
    reset(); loop();
    return { cleanup() { cancelAnimationFrame(raf); document.removeEventListener("keydown", tecla); } };
  }

  // ---------- Dino ----------
  function jogoDino(palco) {
    const W = 500, H = 220, CHAO = H - 30; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "Espaço pra pular"));
    let y, vy, pulando, obs, pts, vel, raf, vivo, t;
    function reset() { y = CHAO; vy = 0; pulando = false; obs = []; pts = 0; vel = 5; vivo = true; t = 0; setPlacar("Pontos: 0"); }
    function pular() { if (!pulando && vivo) { vy = -11; pulando = true; } }
    function loop() {
      t++; if (t % 6 === 0) { pts++; setPlacar("Pontos: " + pts); } vel = 5 + pts / 120;
      vy += 0.6; y += vy; if (y >= CHAO) { y = CHAO; vy = 0; pulando = false; }
      if (t % Math.max(40, 95 - (pts / 8 | 0)) === 0) obs.push({ x: W, h: 18 + Math.random() * 20 });
      obs.forEach(o => o.x -= vel); obs = obs.filter(o => o.x > -20);
      for (const o of obs) if (o.x < 60 && o.x > 24 && y > CHAO - o.h) vivo = false;
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      g.strokeStyle = "#ffffff30"; g.beginPath(); g.moveTo(0, CHAO + 10); g.lineTo(W, CHAO + 10); g.stroke();
      g.font = "26px serif"; g.fillText("🦖", 28, y + 8);
      g.fillStyle = "#35c074"; obs.forEach(o => g.fillText("🌵", o.x, CHAO + 8));
      if (vivo) raf = requestAnimationFrame(loop); else fim();
    }
    function fim() { const ov = el("div", "jogo-fim", `<h3>Fim! ${pts} ponto(s)</h3><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); loop(); }; }
    const tecla = (e) => { if (e.key === " " || e.key === "ArrowUp") { e.preventDefault(); pular(); } };
    document.addEventListener("keydown", tecla); cv.addEventListener("mousedown", pular);
    reset(); loop();
    return { cleanup() { cancelAnimationFrame(raf); document.removeEventListener("keydown", tecla); } };
  }

  // ---------- Genius ----------
  function jogoGenius(palco) {
    const CORES = [["#35c074", 0], ["#e05a8a", 1], ["#6ea8ff", 2], ["#e0a93c", 3]];
    const wrap = el("div"); wrap.style.cssText = "display:grid;grid-template-columns:repeat(2,96px);gap:10px";
    palco.appendChild(wrap); palco.appendChild(el("div", "jogo-dica", "Olhe a sequência e repita"));
    const btns = CORES.map(([cor]) => { const b = el("div"); b.style.cssText = `width:96px;height:96px;border-radius:14px;background:${cor};opacity:.45;cursor:pointer`; wrap.appendChild(b); return b; });
    let seq = [], passo = 0, aceita = false, nivel = 0;
    function piscar(i, dur = 350) { return new Promise(r => { btns[i].style.opacity = 1; if (window.SomTutorial) window.SomTutorial.sfx("pop"); setTimeout(() => { btns[i].style.opacity = .45; setTimeout(r, 120); }, dur); }); }
    async function tocar() { aceita = false; for (const i of seq) await piscar(i); aceita = true; passo = 0; }
    function prox() { nivel++; setPlacar("Nível: " + nivel); seq.push((Math.random() * 4) | 0); tocar(); }
    btns.forEach((b, i) => b.onclick = async () => {
      if (!aceita) return; await piscar(i, 200);
      if (seq[passo] === i) { passo++; if (passo === seq.length) { aceita = false; setTimeout(prox, 600); } }
      else { aceita = false; const ov = el("div", "jogo-fim", `<h3>Errou! Nível ${nivel}</h3><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); seq = []; nivel = 0; prox(); }; }
    });
    setTimeout(prox, 500);
    return { cleanup() {} };
  }

  // ---------- Pega-Toupeira ----------
  function jogoToupeira(palco) {
    const grade = el("div"); grade.style.cssText = "display:grid;grid-template-columns:repeat(3,90px);gap:12px";
    palco.appendChild(grade); const dica = el("div", "jogo-dica", "Clique nas toupeiras!"); palco.appendChild(dica);
    const bur = []; for (let i = 0; i < 9; i++) { const b = el("div"); b.style.cssText = "width:90px;height:90px;border-radius:50%;background:#2a2342;display:flex;align-items:center;justify-content:center;font-size:40px;cursor:pointer"; grade.appendChild(b); bur.push(b); }
    let pts = 0, seg = 30, atual = -1, tMole, tCron;
    setPlacar("Pontos: 0 · 30s");
    function mole() { if (atual >= 0) bur[atual].textContent = ""; atual = (Math.random() * 9) | 0; bur[atual].textContent = "🐹"; }
    bur.forEach((b, i) => b.onclick = () => { if (i === atual) { pts++; setPlacar("Pontos: " + pts + " · " + seg + "s"); b.textContent = "💥"; atual = -1; } });
    tMole = setInterval(mole, 780); tCron = setInterval(() => { seg--; setPlacar("Pontos: " + pts + " · " + seg + "s"); if (seg <= 0) { clearInterval(tMole); clearInterval(tCron); const ov = el("div", "jogo-fim", `<h3>Tempo! ${pts} ponto(s)</h3><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); jogar({ iniciar: jogoToupeira }); }; } }, 1000);
    return { cleanup() { clearInterval(tMole); clearInterval(tCron); } };
  }

  // ---------- Pedra, Papel e Tesoura ----------
  function jogoPPT(palco) {
    const OPC = [["✊", "Pedra"], ["✋", "Papel"], ["✌️", "Tesoura"]];
    const res = el("div", "jogo-dica", "Escolha:"); res.style.fontSize = "17px"; res.style.minHeight = "60px";
    const linha = el("div"); linha.style.cssText = "display:flex;gap:14px";
    OPC.forEach(([em, nm], i) => { const b = el("div"); b.style.cssText = "width:90px;height:90px;border-radius:16px;background:#ffffff12;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;font-size:34px"; b.innerHTML = `${em}<span style="font-size:12px;color:#b7add0">${nm}</span>`; b.onclick = () => jogar2(i); linha.appendChild(b); });
    palco.appendChild(linha); palco.appendChild(res);
    let v = 0, d = 0, e = 0;
    function jogar2(eu) { const cpu = (Math.random() * 3) | 0; let r; if (eu === cpu) { r = "Empate"; e++; } else if ((eu + 1) % 3 === cpu) { r = "Você perdeu"; d++; } else { r = "Você ganhou! 🎉"; v++; } res.innerHTML = `Você ${OPC[eu][0]} × ${OPC[cpu][0]} CPU<br><b>${r}</b>`; setPlacar(`V:${v} D:${d} E:${e}`); }
    setPlacar("V:0 D:0 E:0");
    return { cleanup() {} };
  }

  // ---------- Forca ----------
  function jogoForca(palco) {
    const PALAVRAS = ["ASSOCIADO", "DOCUMENTO", "SCANNER", "DIGITALIZAR", "IMPRESSORA", "PENDRIVE", "ARQUIVO", "PASTA", "COMPUTADOR", "TECLADO", "JANELA", "BOTAO"];
    const BONECO = ["😀", "🙂", "😐", "😟", "😣", "😵", "💀"];
    let palavra, achadas, erros;
    const boneco = el("div"); boneco.style.fontSize = "56px";
    const txt = el("div"); txt.style.cssText = "font-size:30px;letter-spacing:8px;font-weight:800;margin:6px 0";
    const teclado = el("div"); teclado.style.cssText = "display:grid;grid-template-columns:repeat(9,1fr);gap:5px;max-width:420px";
    const dica = el("div", "jogo-dica");
    palco.append(boneco, txt, teclado, dica);
    function reset() {
      palavra = PALAVRAS[(Math.random() * PALAVRAS.length) | 0]; achadas = new Set(); erros = 0;
      teclado.innerHTML = ""; dica.textContent = "";
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(l => { const b = el("button", "jogo-btn", l); b.style.cssText = "padding:8px 0;font-size:14px;background:#ffffff14"; b.onclick = () => tentar(l, b); teclado.appendChild(b); });
      render();
    }
    function render() { boneco.textContent = BONECO[erros]; txt.textContent = palavra.split("").map(c => achadas.has(c) ? c : "_").join(" "); }
    function tentar(l, b) {
      b.disabled = true; b.style.opacity = .4;
      if (palavra.includes(l)) { achadas.add(l); render(); if (palavra.split("").every(c => achadas.has(c))) fim(true); }
      else { erros++; render(); if (erros >= 6) fim(false); }
    }
    function fim(venceu) { dica.innerHTML = venceu ? "Acertou! 🎉" : `Era <b>${palavra}</b>`; const ov = el("div", "jogo-fim", `<h3>${venceu ? "Venceu!" : "Perdeu!"}</h3><button class="jogo-btn">Outra palavra</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); }; }
    reset();
    return { cleanup() {} };
  }

  // ---------- Invasores (Space Invaders) ----------
  function jogoInvasores(palco) {
    const W = 440, H = 380; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "← → move · espaço atira"));
    const COLS = 8, ROWS = 4;
    let px, tiros, aliens, dx, bombas, pts, vivo, raf, cd; const keys = {};
    function reset() {
      px = W / 2; tiros = []; bombas = []; dx = 0.6; pts = 0; vivo = true; cd = 0; aliens = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) aliens.push({ x: 40 + c * 46, y: 40 + r * 34, viva: true });
      setPlacar("Pontos: 0");
    }
    function loop() {
      if (keys.ArrowLeft) px -= 5; if (keys.ArrowRight) px += 5; px = Math.max(18, Math.min(W - 18, px));
      if (keys[" "] && cd <= 0) { tiros.push({ x: px, y: H - 30 }); cd = 14; } if (cd > 0) cd--;
      tiros.forEach(t => t.y -= 7); tiros = tiros.filter(t => t.y > -5);
      // mover aliens
      let bateu = false; aliens.forEach(a => { if (!a.viva) return; a.x += dx; if (a.x > W - 16 || a.x < 16) bateu = true; });
      if (bateu) { dx *= -1; aliens.forEach(a => a.y += 16); }
      // bombas
      if (Math.random() < 0.02) { const vivos = aliens.filter(a => a.viva); if (vivos.length) { const a = vivos[(Math.random() * vivos.length) | 0]; bombas.push({ x: a.x, y: a.y }); } }
      bombas.forEach(b => b.y += 4); bombas = bombas.filter(b => b.y < H);
      // colisões
      tiros.forEach(t => aliens.forEach(a => { if (a.viva && Math.abs(a.x - t.x) < 16 && Math.abs(a.y - t.y) < 14) { a.viva = false; t.y = -99; pts += 10; setPlacar("Pontos: " + pts); } }));
      for (const b of bombas) if (Math.abs(b.x - px) < 16 && b.y > H - 34) vivo = false;
      for (const a of aliens) if (a.viva && a.y > H - 40) vivo = false;
      if (!aliens.some(a => a.viva)) { vivo = false; desenhar(); return fim("Venceu! 🎉"); }
      desenhar();
      if (vivo) raf = requestAnimationFrame(loop); else fim("Fim!");
    }
    function desenhar() {
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      g.font = "22px serif"; aliens.forEach(a => { if (a.viva) g.fillText("👾", a.x - 11, a.y + 8); });
      g.fillStyle = "#6ea8ff"; tiros.forEach(t => g.fillRect(t.x - 2, t.y, 4, 10));
      g.fillStyle = "#e05a8a"; bombas.forEach(b => g.fillRect(b.x - 2, b.y, 4, 9));
      g.font = "24px serif"; g.fillText("🔺", px - 12, H - 16);
    }
    function fim(msg) { const ov = el("div", "jogo-fim", `<h3>${msg} ${pts} pts</h3><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); loop(); }; }
    const kd = (e) => { if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault(); keys[e.key] = true; };
    const ku = (e) => { keys[e.key] = false; };
    document.addEventListener("keydown", kd); document.addEventListener("keyup", ku);
    reset(); loop();
    return { cleanup() { cancelAnimationFrame(raf); document.removeEventListener("keydown", kd); document.removeEventListener("keyup", ku); } };
  }

  // ---------- Asteroides ----------
  function jogoAsteroides(palco) {
    const W = 460, H = 360; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "← → gira · ↑ acelera · espaço atira"));
    let nave, tiros, roids, pts, vivo, raf, cd; const keys = {};
    const wrap = (o) => { if (o.x < 0) o.x += W; if (o.x > W) o.x -= W; if (o.y < 0) o.y += H; if (o.y > H) o.y -= H; };
    function novoRoid(x, y, r) { const a = Math.random() * 7; return { x, y, vx: Math.cos(a) * (3 - r / 20), vy: Math.sin(a) * (3 - r / 20), r }; }
    function reset() {
      nave = { x: W / 2, y: H / 2, ang: -Math.PI / 2, vx: 0, vy: 0 }; tiros = []; pts = 0; vivo = true; cd = 0;
      roids = []; for (let i = 0; i < 5; i++) roids.push(novoRoid(Math.random() * W, 40, 34)); setPlacar("Pontos: 0");
    }
    function loop() {
      if (keys.ArrowLeft) nave.ang -= 0.09; if (keys.ArrowRight) nave.ang += 0.09;
      if (keys.ArrowUp) { nave.vx += Math.cos(nave.ang) * 0.18; nave.vy += Math.sin(nave.ang) * 0.18; }
      nave.vx *= 0.99; nave.vy *= 0.99; nave.x += nave.vx; nave.y += nave.vy; wrap(nave);
      if (keys[" "] && cd <= 0) { tiros.push({ x: nave.x, y: nave.y, vx: Math.cos(nave.ang) * 7, vy: Math.sin(nave.ang) * 7, vida: 55 }); cd = 12; } if (cd > 0) cd--;
      tiros.forEach(t => { t.x += t.vx; t.y += t.vy; t.vida--; wrap(t); }); tiros = tiros.filter(t => t.vida > 0);
      roids.forEach(a => { a.x += a.vx; a.y += a.vy; wrap(a); });
      // tiro x roid
      for (const t of tiros) for (let i = roids.length - 1; i >= 0; i--) { const a = roids[i]; if (Math.hypot(a.x - t.x, a.y - t.y) < a.r) { t.vida = 0; pts += 20; setPlacar("Pontos: " + pts); roids.splice(i, 1); if (a.r > 18) { roids.push(novoRoid(a.x, a.y, a.r / 2), novoRoid(a.x, a.y, a.r / 2)); } break; } }
      for (const a of roids) if (Math.hypot(a.x - nave.x, a.y - nave.y) < a.r + 8) vivo = false;
      if (!roids.length) { for (let i = 0; i < 6; i++) roids.push(novoRoid(Math.random() * W, 20, 34)); }
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      g.strokeStyle = "#b7add0"; g.fillStyle = "#b7add0"; roids.forEach(a => { g.beginPath(); g.arc(a.x, a.y, a.r, 0, 7); g.stroke(); });
      g.fillStyle = "#fff"; tiros.forEach(t => { g.fillRect(t.x - 1.5, t.y - 1.5, 3, 3); });
      g.save(); g.translate(nave.x, nave.y); g.rotate(nave.ang); g.fillStyle = "#a07bff"; g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, -7); g.lineTo(-8, 7); g.closePath(); g.fill(); g.restore();
      if (vivo) raf = requestAnimationFrame(loop); else fim();
    }
    function fim() { const ov = el("div", "jogo-fim", `<h3>Explodiu! ${pts} pts</h3><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); loop(); }; }
    const kd = (e) => { if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault(); keys[e.key] = true; };
    const ku = (e) => { keys[e.key] = false; };
    document.addEventListener("keydown", kd); document.addEventListener("keyup", ku);
    reset(); loop();
    return { cleanup() { cancelAnimationFrame(raf); document.removeEventListener("keydown", kd); document.removeEventListener("keyup", ku); } };
  }

  // ---------- Tiro ao Alvo ----------
  function jogoTiroAlvo(palco) {
    const W = 460, H = 340; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "Mire com o mouse e clique pra atirar"));
    let alvos, pts, tiros_, acertos, seg, raf, tCron; let mx = W / 2, my = H / 2;
    function reset() { alvos = []; pts = 0; tiros_ = 0; acertos = 0; seg = 30; setPlacar("Pontos: 0 · 30s"); if (tCron) clearInterval(tCron); tCron = setInterval(() => { seg--; placar(); if (seg <= 0) fim(); }, 1000); }
    function placar() { setPlacar(`Pontos: ${pts} · ${seg}s`); }
    function loop() {
      if (Math.random() < 0.04 && alvos.length < 5) alvos.push({ x: 30 + Math.random() * (W - 60), y: 30 + Math.random() * (H - 60), r: 26, vida: 90 });
      alvos.forEach(a => { a.vida--; a.r = 26 - Math.max(0, (90 - a.vida) / 90) * 8; }); alvos = alvos.filter(a => a.vida > 0);
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      alvos.forEach(a => { for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(a.x, a.y, a.r - k * 8, 0, 7); g.fillStyle = k % 2 ? "#fff" : "#e05a8a"; g.fill(); } });
      g.strokeStyle = "#6ea8ff"; g.lineWidth = 2; g.beginPath(); g.arc(mx, my, 10, 0, 7); g.moveTo(mx - 15, my); g.lineTo(mx + 15, my); g.moveTo(mx, my - 15); g.lineTo(mx, my + 15); g.stroke();
      raf = requestAnimationFrame(loop);
    }
    function fim() { clearInterval(tCron); cancelAnimationFrame(raf); const ac = tiros_ ? Math.round(acertos / tiros_ * 100) : 0; const ov = el("div", "jogo-fim", `<h3>Tempo! ${pts} pts</h3><div class="jogo-dica">Precisão: ${ac}%</div><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); }; }
    const mv = (e) => { const r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; };
    const cl = () => { if (seg <= 0) return; tiros_++; for (let i = alvos.length - 1; i >= 0; i--) { if (Math.hypot(alvos[i].x - mx, alvos[i].y - my) < alvos[i].r) { pts += 10; acertos++; alvos.splice(i, 1); placar(); if (window.SomTutorial) window.SomTutorial.sfx("pop"); return; } } };
    cv.addEventListener("mousemove", mv); cv.addEventListener("mousedown", cl);
    reset(); loop();
    return { cleanup() { clearInterval(tCron); cancelAnimationFrame(raf); cv.removeEventListener("mousemove", mv); cv.removeEventListener("mousedown", cl); } };
  }

  // ---------- Nave (shooter vertical) ----------
  function jogoNave(palco) {
    const W = 380, H = 420; const cv = el("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
    palco.appendChild(cv); palco.appendChild(el("div", "jogo-dica", "Mexa o mouse pra desviar — atira sozinho"));
    let px, tiros, inim, ebal, pts, vidas, raf, t;
    function reset() { px = W / 2; tiros = []; inim = []; ebal = []; pts = 0; vidas = 3; t = 0; setPlacar("Pontos: 0 · ❤❤❤"); }
    function placar() { setPlacar(`Pontos: ${pts} · ${"❤".repeat(vidas) || "—"}`); }
    function loop() {
      t++;
      if (t % 9 === 0) tiros.push({ x: px, y: H - 36 });
      tiros.forEach(b => b.y -= 8); tiros = tiros.filter(b => b.y > -5);
      if (t % 42 === 0) inim.push({ x: 30 + Math.random() * (W - 60), y: -20, fase: Math.random() * 7, vida: 1 });
      inim.forEach(e => { e.y += 1.7; e.x += Math.sin((e.y + e.fase * 30) / 40) * 1.6; if (Math.random() < 0.006) ebal.push({ x: e.x, y: e.y }); });
      ebal.forEach(b => b.y += 4);
      // colisões tiro x inimigo
      tiros.forEach(b => inim.forEach(e => { if (e.vida > 0 && Math.abs(e.x - b.x) < 16 && Math.abs(e.y - b.y) < 16) { e.vida = 0; b.y = -99; pts += 10; placar(); } }));
      inim = inim.filter(e => e.vida > 0 && e.y < H + 20);
      ebal = ebal.filter(b => b.y < H + 10);
      // inimigo/bala x player
      for (const e of inim) if (Math.abs(e.x - px) < 18 && e.y > H - 40 && e.y < H - 6) { e.vida = 0; dano(); }
      for (let i = ebal.length - 1; i >= 0; i--) if (Math.abs(ebal[i].x - px) < 14 && ebal[i].y > H - 40 && ebal[i].y < H - 6) { ebal.splice(i, 1); dano(); }
      g.fillStyle = "#0d0a16"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#6ea8ff"; tiros.forEach(b => g.fillRect(b.x - 2, b.y, 4, 10));
      g.font = "22px serif"; inim.forEach(e => g.fillText("👾", e.x - 11, e.y + 8));
      g.fillStyle = "#e05a8a"; ebal.forEach(b => g.fillRect(b.x - 2, b.y, 4, 9));
      g.font = "26px serif"; g.fillText("🛸", px - 13, H - 12);
      if (vidas > 0) raf = requestAnimationFrame(loop); else fim();
    }
    function dano() { vidas--; placar(); if (window.SomTutorial) window.SomTutorial.sfx("whoosh"); }
    function fim() { const ov = el("div", "jogo-fim", `<h3>Fim! ${pts} pts</h3><button class="jogo-btn">Jogar de novo</button>`); palco.style.position = "relative"; palco.appendChild(ov); ov.querySelector("button").onclick = () => { ov.remove(); reset(); loop(); }; }
    const mv = (e) => { const r = cv.getBoundingClientRect(); px = Math.max(16, Math.min(W - 16, e.clientX - r.left)); };
    cv.addEventListener("mousemove", mv);
    reset(); loop();
    return { cleanup() { cancelAnimationFrame(raf); cv.removeEventListener("mousemove", mv); } };
  }

  // ================= central =================
  function construir() {
    camada = el("div", "jogos-camada oculto");
    camada.innerHTML = `
      <div class="jogos-top">
        <div class="tit"><span>🎮</span> Jogos do DigiDoc</div>
        <div class="flex1"></div>
        <div class="jogos-placar" id="jogosPlacar"></div>
        <button id="jogosHub">▦ Jogos</button>
        <button id="jogosX">✕ Fechar</button>
      </div>
      <div class="jogos-corpo" id="jogosCorpo"></div>`;
    document.body.appendChild(camada);
    corpo = camada.querySelector("#jogosCorpo");
    placarEl = camada.querySelector("#jogosPlacar");
    camada.querySelector("#jogosX").onclick = fechar;
    camada.querySelector("#jogosHub").onclick = hub;
    document.addEventListener("keydown", (e) => { if (!camada.classList.contains("oculto") && e.key === "Escape") { if (jogoAtual) hub(); else fechar(); } });
  }
  function limpar() { if (jogoAtual && jogoAtual.cleanup) try { jogoAtual.cleanup(); } catch {} jogoAtual = null; setPlacar(""); }
  function hub() {
    limpar(); corpo.innerHTML = "";
    const grid = el("div", "jogos-grid");
    JOGOS.forEach(j => { const c = el("div", "jogo-card", `<div class="ic">${j.emoji}</div><div class="nm">${j.nome}</div><div class="ds">${j.desc}</div>`); c.onclick = () => jogar(j); grid.appendChild(c); });
    corpo.appendChild(grid);
  }
  function jogar(def) {
    limpar(); corpo.innerHTML = "";
    const palco = el("div", "jogo-palco"); corpo.appendChild(palco);
    try { jogoAtual = def.iniciar(palco); } catch (e) { palco.appendChild(el("div", "jogo-dica", "Erro ao abrir o jogo.")); }
  }
  function abrir() { if (!camada) construir(); camada.classList.remove("oculto"); hub(); }
  function fechar() { limpar(); if (camada) camada.classList.add("oculto"); }

  window.Jogos = { abrir, fechar };
  window.addEventListener("DOMContentLoaded", () => { const b = document.getElementById("btnJogos"); if (b) b.onclick = abrir; });
})();
