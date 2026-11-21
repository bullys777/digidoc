"use strict";
// Trilha e efeitos do tutorial — 100% sintetizados (Web Audio), sem arquivos.
(function () {
  let ac = null, master = null, musicaBus = null, sfxBus = null;
  let tocandoMusica = false, timerAcorde = null, mudo = false;
  const ativos = new Set();

  function garantir() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = mudo ? 0 : 1; master.connect(ac.destination);
    musicaBus = ac.createGain(); musicaBus.gain.value = 0.085;
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.3;
    // um delay leve pra dar "espaco" na musica
    const delay = ac.createDelay(); delay.delayTime.value = 0.33;
    const fb = ac.createGain(); fb.gain.value = 0.28;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200;
    musicaBus.connect(lp); lp.connect(master);
    lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(master);
    sfxBus.connect(master);
  }

  function resumir() { garantir(); if (ac.state === "suspended") ac.resume(); }

  // ---- notas ----
  const NOTA = (n) => 440 * Math.pow(2, (n - 69) / 12); // n = MIDI
  // progressao suave: Cmaj7 - Amin7 - Fmaj7 - Gmaj  (em oitava media)
  const ACORDES = [
    [60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67],
  ];
  let idxAcorde = 0;

  function pad(freqs, dur) {
    const t = ac.currentTime;
    freqs.forEach((f, i) => {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
      o1.type = "triangle"; o2.type = "sine";
      o1.frequency.value = f; o2.frequency.value = f * 1.004; // leve detune
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.5);
      g.gain.linearRampToValueAtTime(0.12, t + dur - 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o1.connect(g); o2.connect(g); g.connect(musicaBus);
      o1.start(t); o2.start(t); o1.stop(t + dur); o2.stop(t + dur);
      [o1, o2].forEach((o) => { ativos.add(o); o.onended = () => ativos.delete(o); });
    });
  }

  function arpejo(freqs, dur) {
    const t0 = ac.currentTime;
    freqs.concat([freqs[1] * 2]).forEach((f, i) => {
      const t = t0 + 0.25 + i * (dur / 6);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f * 2;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
      o.connect(g); g.connect(musicaBus);
      o.start(t); o.stop(t + 0.55);
      ativos.add(o); o.onended = () => ativos.delete(o);
    });
  }

  function proximoAcorde() {
    if (!tocandoMusica) return;
    const dur = 3.6;
    const freqs = ACORDES[idxAcorde % ACORDES.length].map(NOTA);
    pad(freqs, dur); arpejo(freqs, dur);
    idxAcorde++;
    timerAcorde = setTimeout(proximoAcorde, dur * 1000 - 200);
  }

  function iniciarMusica() { resumir(); if (tocandoMusica) return; tocandoMusica = true; idxAcorde = 0; proximoAcorde(); }
  function pararMusica() { tocandoMusica = false; clearTimeout(timerAcorde); }

  // ---- efeitos ----
  function ruido(dur) {
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf; return src;
  }
  function env(node, t, a, pico, dur) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pico, t + a);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    node.connect(g); g.connect(sfxBus); return g;
  }
  const SFX = {
    whoosh() {
      const t = ac.currentTime, src = ruido(0.5);
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
      src.connect(bp); env(bp, t, 0.05, 0.5, 0.45); src.start(t); src.stop(t + 0.5);
    },
    pop() {
      const t = ac.currentTime, o = ac.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(920, t + 0.09);
      env(o, t, 0.005, 0.6, 0.14); o.start(t); o.stop(t + 0.15);
    },
    tick() {
      const t = ac.currentTime, o = ac.createOscillator(); o.type = "square";
      o.frequency.value = 1300; env(o, t, 0.002, 0.18, 0.04); o.start(t); o.stop(t + 0.05);
    },
    scan() {
      const t = ac.currentTime, o = ac.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      o.connect(lp); env(lp, t, 0.03, 0.35, 0.6); o.start(t); o.stop(t + 0.62);
    },
    ding() {
      const t = ac.currentTime;
      [84, 88, 91].forEach((n, i) => {
        const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = NOTA(n);
        env(o, t + i * 0.09, 0.01, 0.3, 0.5 + i * 0.1); o.start(t + i * 0.09); o.stop(t + 0.7 + i * 0.1);
      });
    },
  };

  function sfx(nome) { try { resumir(); (SFX[nome] || (() => {}))(); } catch {} }

  function setMudo(m) { mudo = m; if (master) master.gain.value = m ? 0 : 1; }

  window.SomTutorial = {
    iniciar() { try { iniciarMusica(); } catch {} },
    parar() { try { pararMusica(); ativos.forEach((o) => { try { o.stop(); } catch {} }); ativos.clear(); } catch {} },
    sfx, setMudo, estaMudo: () => mudo,
  };
})();
