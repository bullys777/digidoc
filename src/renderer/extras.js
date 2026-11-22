"use strict";
// Extras do DigiDoc: visualizador (zoom/recorte), importar PDF, painel de producao,
// historico, atalhos e atualizacao automatica. Usa o estado e as funcoes do app.js
// (paginas, sel, ancora, renderGrade, setStatus, esc...), que sao globais da pagina.

// ---------------- dica flutuante (tooltip dos graficos) ----------------
const Dica = (() => {
  let el = null;
  function mostrar(html, e) {
    if (!el) { el = document.createElement("div"); el.className = "dica-flutuante"; document.body.appendChild(el); }
    el.innerHTML = html; el.style.display = "block"; mover(e);
  }
  function mover(e) {
    if (!el || el.style.display === "none") return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = e.clientX + 14, y = e.clientY - h - 10;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    el.style.left = x + "px"; el.style.top = y + "px";
  }
  function esconder() { if (el) el.style.display = "none"; }
  // liga a dica em todos os elementos [data-dica] dentro de raiz
  function ligar(raiz) {
    raiz.querySelectorAll("[data-dica]").forEach((n) => {
      n.addEventListener("mouseenter", (e) => mostrar(n.dataset.dica, e));
      n.addEventListener("mousemove", mover);
      n.addEventListener("mouseleave", esconder);
    });
  }
  return { mostrar, mover, esconder, ligar };
})();

// janela simples (mesmo visual dos outros modais)
function abrirJanela({ titulo, largura = 560, corpo = "", rodape = "", classe = "" }) {
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `<div class="modal-cx ${classe}" style="width:${largura}px">
    <div class="modal-cab"><h2>${titulo}</h2><button class="icone" data-fechar>✕</button></div>
    <div class="modal-corpo">${corpo}</div>
    ${rodape ? `<div class="modal-rod">${rodape}</div>` : ""}</div>`;
  document.body.appendChild(ov);
  const fechar = () => { Dica.esconder(); ov.remove(); document.removeEventListener("keydown", esc_, true); };
  // Esc fecha so a janela de cima
  const esc_ = (e) => {
    if (e.key !== "Escape") return;
    const abertas = [...document.querySelectorAll(".modal:not(.oculto)")];
    if (abertas[abertas.length - 1] === ov) { e.stopImmediatePropagation(); fechar(); }
  };
  document.addEventListener("keydown", esc_, true);
  ov.querySelector("[data-fechar]").onclick = fechar;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) fechar(); });
  return { ov, fechar, q: (s) => ov.querySelector(s), qq: (s) => [...ov.querySelectorAll(s)] };
}

const fmtMB = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : b >= 1073741824 ? (b / 1073741824).toFixed(1).replace(".", ",") + " GB" : (b / 1048576).toFixed(b >= 104857600 ? 0 : 1).replace(".", ",") + " MB");
const fmtNum = (n) => Number(n || 0).toLocaleString("pt-BR");
const plural = (n, um, varios) => `${fmtNum(n)} ${n === 1 ? um : varios}`;
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function diaLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dataCurta(dia) { const [a, m, d] = dia.split("-"); return `${d}/${m}`; }
function horaOuData(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return diaLocal(ms) === diaLocal(Date.now()) ? "hoje " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("pt-BR");
}

// =====================================================================
// VISUALIZADOR: ver grande, zoom (roda do mouse), arrastar, girar, cor, recortar
// =====================================================================
window.Visor = (() => {
  const V = (s) => document.querySelector(s);
  let id = null, escala = 1, escalaAjuste = 1, tx = 0, ty = 0, natW = 0, natH = 0;
  let arrasto = null;               // arrastando a imagem (pan)
  let cortando = false, corteIni = null, corte = null; // recorte: retangulo normalizado 0..1
  let carregando = 0;

  const aberto = () => !V("#visor").classList.contains("oculto");
  const pagina = () => paginas.find((p) => p.id === id);

  function abrir(novoId) {
    if (!paginas.some((p) => p.id === novoId)) return;
    V("#visor").classList.remove("oculto");
    irPara(novoId, true);
  }
  function fechar() {
    sairCorte();
    V("#visor").classList.add("oculto");
    if (id && paginas.some((p) => p.id === id)) { mostrarPrevia(id); rolarAte(id); }
    id = null;
  }
  function irPara(novoId, ajustar) {
    id = novoId;
    sel.clear(); sel.add(id); ancora = id;
    renderGrade();
    sairCorte();
    carregar(ajustar);
  }
  function andar(dir) {
    const i = paginas.findIndex((p) => p.id === id);
    const j = i + dir;
    if (j >= 0 && j < paginas.length) irPara(paginas[j].id, true);
  }

  async function carregar(ajustar) {
    const p = pagina();
    if (!p) { if (paginas.length) irPara(paginas[0].id, true); else fechar(); return; }
    const i = paginas.indexOf(p);
    const extras = [p.tipo && modo === "documentos" ? nomeDoTipo(p.tipo) : "", p.colorido ? "colorida" : "", p.recortada ? "recortada" : ""].filter(Boolean);
    V("#vInfo").textContent = `Página ${i + 1} de ${paginas.length}` + (extras.length ? " · " + extras.join(" · ") : "");
    V("#vAnt").disabled = i <= 0; V("#vProx").disabled = i >= paginas.length - 1;
    V("#vCor").classList.toggle("ativo", !!p.colorido);
    V("#vTirarCorte").classList.toggle("oculto", !p.recortada);
    const minha = ++carregando;
    V("#vCarregando").classList.remove("oculto");
    const url = await window.api.previa(id, 1400);
    if (minha !== carregando || !aberto()) return;
    const img = V("#vImg");
    img.onload = () => {
      if (minha !== carregando) return;
      natW = img.naturalWidth; natH = img.naturalHeight;
      if (ajustar || !escalaAjuste) ajustarTela(); else { calcAjuste(); aplicar(); }
      V("#vCarregando").classList.add("oculto");
    };
    img.src = url || "";
  }

  function calcAjuste() {
    const r = V("#vPalco").getBoundingClientRect();
    escalaAjuste = Math.max(0.05, Math.min((r.width - 48) / natW, (r.height - 48) / natH));
  }
  function ajustarTela() {
    if (!natW) return;
    calcAjuste();
    const r = V("#vPalco").getBoundingClientRect();
    escala = escalaAjuste;
    tx = (r.width - natW * escala) / 2; ty = (r.height - natH * escala) / 2;
    aplicar();
  }
  function aplicar() {
    V("#vImg").style.transform = `translate(${tx}px, ${ty}px) scale(${escala})`;
    V("#vZoom").textContent = Math.round((escala / escalaAjuste) * 100) + "%";
    desenharCorte();
  }
  // zoom mantendo o ponto (cx, cy) do palco parado embaixo do mouse
  function zoomEm(cx, cy, fator) {
    const nova = Math.max(escalaAjuste * 0.5, Math.min(escalaAjuste * 10, escala * fator));
    tx = cx - (cx - tx) * (nova / escala); ty = cy - (cy - ty) * (nova / escala);
    escala = nova; aplicar();
  }
  function zoomCentro(fator) { const r = V("#vPalco").getBoundingClientRect(); zoomEm(r.width / 2, r.height / 2, fator); }

  // ----- recorte -----
  function entrarCorte() {
    if (!pagina() || ocupado) return;
    cortando = true; corte = null; corteIni = null;
    V("#vPalco").classList.add("cortando");
    V("#vCorteBarra").classList.remove("oculto");
    V("#vAplicarCorte").disabled = true;
    V("#vRecortar").classList.add("ativo");
    desenharCorte();
  }
  function sairCorte() {
    cortando = false; corte = null; corteIni = null;
    V("#vPalco").classList.remove("cortando");
    V("#vCorteBarra").classList.add("oculto");
    V("#vRecortar").classList.remove("ativo");
    desenharCorte();
  }
  function pontoNaImagem(e) {
    const ir = V("#vImg").getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - ir.left) / ir.width)), y: Math.max(0, Math.min(1, (e.clientY - ir.top) / ir.height)) };
  }
  function desenharCorte() {
    const el = V("#vCorte");
    if (!cortando || !corte) { el.classList.add("oculto"); return; }
    const ir = V("#vImg").getBoundingClientRect(), pr = V("#vPalco").getBoundingClientRect();
    el.classList.remove("oculto");
    el.style.left = ir.left - pr.left + corte.x * ir.width + "px";
    el.style.top = ir.top - pr.top + corte.y * ir.height + "px";
    el.style.width = corte.w * ir.width + "px";
    el.style.height = corte.h * ir.height + "px";
  }
  async function aplicarCorte() {
    if (!corte || corte.w < 0.02 || corte.h < 0.02 || ocupado) return;
    const pid = id, rect = corte;
    sairCorte();
    await mexer(async () => {
      const r = await window.api.recortarPagina({ id: pid, rect });
      if (!r) return;
      atualizarPagina(r);
      const antes = r.recorteAntes;
      registrarDesfazer("recortar", async () => { atualizarPagina(await window.api.recortarPagina({ id: pid, rect: antes, absoluto: true })); });
      setStatus("✂ Página recortada. Ctrl+Z desfaz.", "ok");
    });
  }
  async function tirarCorte() {
    const pid = id;
    sairCorte();
    await mexer(async () => {
      const r = await window.api.recortarPagina({ id: pid, rect: null });
      if (!r) return;
      atualizarPagina(r);
      const antes = r.recorteAntes;
      registrarDesfazer("voltar a página inteira", async () => { atualizarPagina(await window.api.recortarPagina({ id: pid, rect: antes, absoluto: true })); });
      setStatus("Página inteira de volta.", "ok");
    });
  }
  // roda uma acao que muda a pagina e recarrega a imagem
  async function mexer(fn, ajustar = true) {
    if (ocupado) return;
    ocupado = true; atualizarBotoesFonte();
    V("#vCarregando").classList.remove("oculto");
    try { await fn(); } catch (e) { setStatus("Erro: " + e.message, "erro"); }
    finally { ocupado = false; atualizarBotoesFonte(); renderGrade(); }
    await carregar(ajustar);
  }

  async function girar(graus) {
    if (!pagina() || ocupado) return;
    sel.clear(); sel.add(id);
    await girarSel(graus);
    await carregar(true);
  }
  async function cor() {
    if (!pagina() || ocupado) return;
    sel.clear(); sel.add(id);
    await alternarCorSel();
    await carregar(false);
  }
  async function remover() {
    if (!pagina() || ocupado) return;
    const i = paginas.findIndex((p) => p.id === id);
    await removerPaginas([id]);
    setStatus("Página removida. Ctrl+Z desfaz.");
    if (!paginas.length) { fechar(); return; }
    irPara(paginas[Math.min(i, paginas.length - 1)].id, true);
  }

  function ligar() {
    const palco = V("#vPalco");
    V("#vFechar").onclick = fechar;
    V("#vAnt").onclick = () => andar(-1);
    V("#vProx").onclick = () => andar(1);
    V("#vGirar").onclick = () => girar(90);
    V("#vGirarEsq").onclick = () => girar(-90);
    V("#vCor").onclick = cor;
    V("#vRemover").onclick = remover;
    V("#vRecortar").onclick = () => (cortando ? sairCorte() : entrarCorte());
    V("#vAplicarCorte").onclick = aplicarCorte;
    V("#vCancelarCorte").onclick = sairCorte;
    V("#vTirarCorte").onclick = tirarCorte;
    V("#vMais").onclick = () => zoomCentro(1.25);
    V("#vMenos").onclick = () => zoomCentro(1 / 1.25);
    V("#vAjustar").onclick = ajustarTela;

    palco.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = palco.getBoundingClientRect();
      zoomEm(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    palco.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (cortando) { corteIni = pontoNaImagem(e); corte = { x: corteIni.x, y: corteIni.y, w: 0, h: 0 }; desenharCorte(); }
      else { arrasto = { x: e.clientX, y: e.clientY, tx, ty }; palco.classList.add("arrastando"); }
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!aberto()) return;
      if (cortando && corteIni) {
        const p = pontoNaImagem(e);
        corte = { x: Math.min(p.x, corteIni.x), y: Math.min(p.y, corteIni.y), w: Math.abs(p.x - corteIni.x), h: Math.abs(p.y - corteIni.y) };
        desenharCorte();
      } else if (arrasto) {
        tx = arrasto.tx + (e.clientX - arrasto.x); ty = arrasto.ty + (e.clientY - arrasto.y); aplicar();
      }
    });
    window.addEventListener("mouseup", () => {
      if (cortando && corteIni) { corteIni = null; V("#vAplicarCorte").disabled = !(corte && corte.w > 0.02 && corte.h > 0.02); }
      if (arrasto) { arrasto = null; palco.classList.remove("arrastando"); }
    });
    palco.addEventListener("dblclick", () => { if (cortando) return; if (Math.abs(escala - escalaAjuste) < 0.01) zoomCentro(2.2); else ajustarTela(); });
    window.addEventListener("resize", () => { if (aberto() && natW) ajustarTela(); });

    // teclado do visualizador (antes dos atalhos da tela principal)
    document.addEventListener("keydown", (e) => {
      if (!aberto() || document.querySelector(".modal:not(.oculto)")) return;
      // cantinho aberto por cima: as teclas sao dele (inclusive o Esc de esconder)
      if (window.Cantinho && window.Cantinho.aberto()) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      let feito = true;
      if (k === "Escape") { cortando ? sairCorte() : fechar(); }
      else if (ctrl && (k === "z" || k === "Z")) { desfazer(); }
      else if (ctrl) feito = false;
      else if (cortando && k === "Enter") aplicarCorte();
      else if (k === "ArrowLeft" || k === "PageUp") andar(-1);
      else if (k === "ArrowRight" || k === "PageDown" || k === " ") andar(1);
      else if (k === "r" || k === "R") girar(e.shiftKey ? -90 : 90);
      else if (k === "x" || k === "X") (cortando ? sairCorte() : entrarCorte());
      else if (k === "c" || k === "C") cor();
      else if (k === "Delete") remover();
      else if (k === "+" || k === "=") zoomCentro(1.25);
      else if (k === "-" || k === "_") zoomCentro(1 / 1.25);
      else if (k === "0") ajustarTela();
      else feito = false;
      if (feito) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  return { abrir, fechar, ligar, aberto, atualizar() { if (aberto()) carregar(false); } };
})();

// =====================================================================
// IMPORTAR PDF: desenha cada pagina (pdf.js, offline) e manda como imagem
// =====================================================================
window.ImportarPDF = (() => {
  let lib = null;
  async function carregarLib() {
    if (!lib) {
      lib = await import("./vendor/pdfjs/pdf.min.mjs");
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", location.href).href;
    }
    return lib;
  }
  // progresso(msg, feito, total). Devolve { adicionadas, brancas, erro, ids }
  // opcoes.semAjustes: PDF que o proprio DigiDoc salvou (reabrir pra editar): entra como esta
  async function importar(caminho, progresso, opcoes = {}) {
    const out = { adicionadas: 0, brancas: 0, erro: "", ids: [] };
    const nome = caminho.split(/[\\/]/).pop();
    const arq = await window.api.lerPdf(caminho);
    if (arq.erro) { out.erro = `${nome}: ${arq.erro}`; return out; }
    let doc = null;
    try {
      const pdfjs = await carregarLib();
      // isEvalSupported:false = nao executa nada que venha de dentro do PDF
      doc = await pdfjs.getDocument({ data: arq.bytes, isEvalSupported: false, enableXfa: false }).promise;
      const dpi = (cfg && cfg.scanner && cfg.scanner.resolucao) || 200; // mesmo dpi do scanner: o PDF final sai no tamanho certo
      for (let i = 1; i <= doc.numPages; i++) {
        progresso && progresso(`Lendo ${nome}: página ${i} de ${doc.numPages}…`, i - 1, doc.numPages);
        const pg = await doc.getPage(i);
        const v1 = pg.getViewport({ scale: 1 });
        const escala = Math.min(dpi / 72, 3400 / Math.max(v1.width, v1.height)); // nunca gigante
        const vp = pg.getViewport({ scale: escala });
        const cv = document.createElement("canvas");
        cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        // intent "print": desenha sem esperar quadro da tela. No modo normal ("display") o pdf.js espera
        // o proximo quadro — com a janela coberta por outra, o Windows pausa a tela e a importacao travava
        await pg.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
        const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.92));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        cv.width = cv.height = 0; pg.cleanup();
        const reg = await window.api.addBuffer({ bytes, colorido: false, semAjustes: !!opcoes.semAjustes });
        if (reg && reg.branca) out.brancas++;
        else if (reg && reg.id) { adicionarResultados([reg]); out.adicionadas++; out.ids.push(reg.id); }
      }
      progresso && progresso(`${nome}: pronto`, doc.numPages, doc.numPages);
    } catch (e) {
      out.erro = e && e.name === "PasswordException" ? `${nome} tem senha — abra no leitor de PDF, salve sem senha e importe de novo.`
        : `Não consegui ler ${nome} (${(e && e.message) || "erro"}).`;
    } finally { try { if (doc) await doc.destroy(); } catch {} }
    return out;
  }
  return { importar };
})();

// =====================================================================
// CONTADOR DO RODAPE + PAINEL DE PRODUCAO
// =====================================================================
window.Painel = (() => {
  let ultimo = null;

  async function atualizarContador() {
    const b = document.getElementById("contadorHoje");
    if (!b) return;
    let r = null;
    try { r = await window.api.resumoEstatisticas(); } catch {}
    if (!r || r.erro) { b.textContent = "📊 Painel"; return; }
    ultimo = r;
    const h = r.hoje || { pessoas: 0, pdfs: 0 };
    const meta = Number(r.meta) || 0;
    let txt = `📊 Hoje: ${plural(h.pessoas, "associado", "associados")} · ${plural(h.pdfs, "PDF", "PDFs")}`;
    if (r.ultima) txt += ` · Letra ${r.ultima.letra}`;
    b.innerHTML = esc(txt) + (meta ? metaHtml(h.pessoas, meta) : "");
    b.classList.toggle("meta-ok", !!meta && h.pessoas >= meta);
    b.title = `Total: ${plural(r.total.pessoas, "associado", "associados")} · ${plural(r.total.pdfs, "PDF", "PDFs")}. Clique para abrir o painel (F3).`;
  }
  function metaHtml(feito, meta) {
    const pct = Math.min(100, Math.round((feito / meta) * 100));
    return ` <span class="meta-mini"><span class="meta-mini-fill" style="width:${pct}%"></span></span> ${feito >= meta ? "✓ meta" : `${fmtNum(feito)}/${fmtNum(meta)}`}`;
  }

  // barras de um so valor (associados por dia / por letra). itens: [{rotulo, valor, dica, destaque}]
  function barrasVerticais(itens, { altura = 120, rotular = () => false } = {}) {
    const max = Math.max(1, ...itens.map((i) => i.valor));
    return `<div class="g-barras" style="height:${altura + 34}px">
      <div class="g-grade" style="height:${altura}px"><span style="bottom:100%">${fmtNum(max)}</span><span style="bottom:50%">${fmtNum(Math.round(max / 2))}</span></div>
      ${itens.map((i) => {
        const h = i.valor ? Math.max(3, Math.round((i.valor / max) * altura)) : 0;
        return `<div class="g-col${i.destaque ? " destaque" : ""}${i.clique ? " clicavel" : ""}" data-dica="${esc(i.dica)}" ${i.clique ? `data-clique="${esc(i.clique)}"` : ""}>
          <div class="g-area" style="height:${altura}px">${rotular(i) && i.valor ? `<span class="g-valor" style="bottom:${h + 2}px">${fmtNum(i.valor)}</span>` : ""}<div class="g-barra" style="height:${h}px"></div></div>
          <div class="g-rot">${esc(i.rotulo)}</div></div>`;
      }).join("")}</div>`;
  }

  async function abrir() {
    const J = abrirJanela({
      titulo: "📊 Painel de produção", largura: 1000, classe: "painel-cx",
      corpo: `<div class="painel-carregando"><div class="spinner"></div>Contando os documentos na pasta…</div>`,
      rodape: `<span class="sub" id="pnOnde"></span>
        <button class="btn-sec" id="pnRecontar">🔄 Recontar</button>
        <button class="btn-sec" id="pnExportar">📥 Relatório (Excel)</button>`,
    });
    let filtro = { texto: "", letra: "", falta: "" };
    let dados = null;

    async function carregarDados(forcar) {
      dados = await window.api.estatisticas(forcar);
      if (!J.ov.isConnected) return;
      if (!dados || dados.erro) { J.q(".modal-corpo").innerHTML = `<p style="color:var(--vermelho)">Não consegui contar: ${esc((dados && dados.erro) || "erro")}</p>`; return; }
      desenhar();
    }

    function desenhar() {
      const d = dados, meta = Number(d.meta) || 0;
      const hoje = d.hoje, ontem = d.ontem;
      const tendencia = ontem.pessoas ? Math.round(((hoje.pessoas - ontem.pessoas) / ontem.pessoas) * 100) : null;
      // ultimos 14 dias
      const dias = [];
      for (let i = 13; i >= 0; i--) {
        const ms = Date.now() - i * 864e5, dia = diaLocal(ms), v = d.porDia[dia] || { pessoas: 0, pdfs: 0 };
        dias.push({ rotulo: i === 0 ? "hoje" : DIAS_SEMANA[new Date(ms).getDay()], valor: v.pessoas, destaque: i === 0,
          dica: `<b>${dataCurta(dia)}${i === 0 ? " (hoje)" : ""}</b><br>${plural(v.pessoas, "associado", "associados")}<br>${plural(v.pdfs, "PDF", "PDFs")}` });
      }
      const maxDia = Math.max(...dias.map((x) => x.valor));
      // alfabeto
      const letraAtual = d.ultima ? d.ultima.letra : "";
      const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      if (Object.keys(d.porLetra).some((l) => !letras.includes(l))) letras.push("#");
      const alfabeto = letras.map((l) => {
        const v = d.porLetra[l] || { pessoas: 0, pdfs: 0 };
        return { rotulo: l, valor: v.pessoas, destaque: l === letraAtual, clique: l,
          dica: `<b>Letra ${l}</b>${l === letraAtual ? " (atual)" : ""}<br>${plural(v.pessoas, "associado", "associados")}<br>${plural(v.pdfs, "PDF", "PDFs")}<br><i>clique para listar</i>` };
      });
      const feitasLetras = letras.filter((l) => d.porLetra[l] && d.porLetra[l].pessoas).length;
      // tipos
      const tipos = Object.entries(d.porTipo).sort((a, b) => b[1] - a[1]);
      const maxTipo = Math.max(1, ...tipos.map((t) => t[1]));
      const ch = window.NomesDoc.chave;
      const nomeSigla = (s) => { const t = (cfg.tipos || []).find((x) => ch(x.sigla) === s); return t ? t.nome : s === ch(cfg.siglaDossie || "DOSSIE COMPLETO") ? "Dossiê completo" : s.replace(/_/g, " "); };
      const base = d.total.pessoas || 1;

      J.q(".modal-corpo").innerHTML = `
        <div class="pn-cards">
          ${card("Hoje", fmtNum(hoje.pessoas), "associados", `${plural(hoje.pdfs, "PDF", "PDFs")}${d.estePC && d.estePC.paginas ? ` · ${plural(d.estePC.paginas, "página", "páginas")} neste PC` : ""}`, "hoje",
            tendencia === null ? "" : `<span class="pn-tend ${tendencia >= 0 ? "sobe" : "desce"}">${tendencia >= 0 ? "▲" : "▼"} ${Math.abs(tendencia)}% vs ontem</span>`)}
          ${card("Ontem", fmtNum(ontem.pessoas), "associados", plural(ontem.pdfs, "PDF", "PDFs"))}
          ${card("Últimos 7 dias", fmtNum(d.semana.pessoas), "associados", plural(d.semana.pdfs, "PDF", "PDFs"))}
          ${card("Total", fmtNum(d.total.pessoas), "associados", `${plural(d.total.pdfs, "PDF", "PDFs")} · ${fmtMB(d.total.bytes)}`)}
          ${card("Média por dia", String(d.mediaPorDia).replace(".", ","), "associados", `${plural(d.total.dias, "dia trabalhado", "dias trabalhados")}`)}
          ${card("Recorde", d.recorde ? fmtNum(d.recorde.pessoas) : "—", "num dia", d.recorde ? `em ${dataCurta(d.recorde.dia)}/${d.recorde.dia.slice(0, 4)}` : "ainda sem dados")}
        </div>
        ${meta ? `<div class="pn-meta ${hoje.pessoas >= meta ? "ok" : ""}">
            <div class="pn-meta-txt"><b>Meta do dia:</b> ${fmtNum(hoje.pessoas)} de ${fmtNum(meta)} associados ${hoje.pessoas >= meta ? "— ✓ meta batida!" : `— faltam ${fmtNum(meta - hoje.pessoas)}`}</div>
            <div class="pn-meta-barra"><div style="width:${Math.min(100, (hoje.pessoas / meta) * 100)}%"></div></div></div>` : ""}

        <div class="pn-linha">
          <div class="pn-bloco pn-letra">
            <h4>Letra atual</h4>
            <div class="pn-letra-grande">${esc(letraAtual || "?")}</div>
            <div class="sub">${d.ultima ? `Último salvo: <b>${esc(d.ultima.nome)}</b><br>${esc(d.ultima.arquivo)} · ${horaOuData(d.ultima.ms)}` : "nada salvo ainda"}</div>
            ${letraAtual && d.porLetra[letraAtual] ? `<div class="sub" style="margin-top:6px">${plural(d.porLetra[letraAtual].pessoas, "associado", "associados")} na letra ${esc(letraAtual)}</div>` : ""}
          </div>
          <div class="pn-bloco" style="flex:1">
            <h4>Associados por dia <span class="sub">— últimos 14 dias</span></h4>
            ${barrasVerticais(dias, { altura: 110, rotular: (i) => i.destaque || (i.valor === maxDia && maxDia > 0) })}
          </div>
        </div>

        <div class="pn-bloco">
          <h4>Associados por letra <span class="sub">— ${feitasLetras} de ${letras.length} letras com alguém · clique numa letra para listar</span></h4>
          ${barrasVerticais(alfabeto, { altura: 90, rotular: (i) => i.destaque })}
        </div>

        <div class="pn-linha">
          <div class="pn-bloco" style="flex:1">
            <h4>PDFs por tipo de documento</h4>
            ${tipos.length ? `<div class="g-horiz">${tipos.slice(0, 12).map(([s, n]) => `
              <div class="g-hlinha" data-dica="${esc(`<b>${esc(nomeSigla(s))}</b><br>${plural(n, "PDF", "PDFs")}`)}">
                <span class="g-hrot">${esc(nomeSigla(s))}</span>
                <span class="g-htrilho"><span class="g-hbarra" style="width:${Math.max(1, (n / maxTipo) * 100)}%"></span></span>
                <span class="g-hval">${fmtNum(n)}</span></div>`).join("")}</div>` : `<p class="sub">Nenhum PDF ainda.</p>`}
          </div>
          <div class="pn-bloco" style="flex:1">
            <h4>Quem já tem cada documento <span class="sub">— clique em "falta" para ver quem não tem</span></h4>
            <div class="g-horiz">${(d.cobertura || []).map((c) => {
              const pct = Math.round((c.tem / base) * 100), falta = d.total.pessoas - c.tem;
              return `<div class="g-hlinha" data-dica="${esc(`<b>${esc(c.nome)}</b><br>${fmtNum(c.tem)} de ${fmtNum(d.total.pessoas)} associados (${pct}%)`)}">
                <span class="g-hrot">${esc(c.nome)}</span>
                <span class="g-htrilho"><span class="g-hbarra" style="width:${pct}%"></span></span>
                <span class="g-hval">${pct}%</span>
                ${falta > 0 ? `<button class="mini pn-falta" data-sigla="${esc(c.sigla)}">falta ${fmtNum(falta)}</button>` : `<span class="pn-ok">✓ todos</span>`}</div>`;
            }).join("")}</div>
          </div>
        </div>

        <div class="pn-bloco">
          <h4>Associados <span class="sub" id="pnContagem"></span></h4>
          <div class="pn-filtros">
            <input type="text" id="pnBusca" placeholder="🔍 Procurar pelo nome…" value="${esc(filtro.texto)}" spellcheck="false">
            <select id="pnLetra"><option value="">Todas as letras</option>${letras.map((l) => `<option value="${l}" ${filtro.letra === l ? "selected" : ""}>Letra ${l}</option>`).join("")}</select>
            <select id="pnFalta"><option value="">Com ou sem documentos</option>
              <option value="@vazia" ${filtro.falta === "@vazia" ? "selected" : ""}>Pasta sem nenhum PDF</option>
              ${(d.cobertura || []).map((c) => `<option value="${esc(c.sigla)}" ${filtro.falta === c.sigla ? "selected" : ""}>Sem ${esc(c.nome)}</option>`).join("")}</select>
          </div>
          <div class="pn-lista" id="pnLista"></div>
        </div>`;

      J.q("#pnOnde").textContent = `Contado na pasta ${d.pasta} em ${(d.levouMs / 1000).toFixed(1).replace(".", ",")} s`;
      Dica.ligar(J.ov);
      J.qq(".g-col.clicavel").forEach((c) => { c.onclick = () => { filtro.letra = c.dataset.clique; J.q("#pnLetra").value = filtro.letra; listar(true); }; });
      J.qq(".pn-falta").forEach((b) => { b.onclick = () => { filtro.falta = b.dataset.sigla; J.q("#pnFalta").value = filtro.falta; listar(true); }; });
      J.q("#pnBusca").oninput = (e) => { filtro.texto = e.target.value; listar(); };
      J.q("#pnLetra").onchange = (e) => { filtro.letra = e.target.value; listar(); };
      J.q("#pnFalta").onchange = (e) => { filtro.falta = e.target.value; listar(); };
      listar();
    }

    function card(tit, valor, unid, sub, classe = "", extra = "") {
      return `<div class="pn-card ${classe}"><div class="pn-card-tit">${tit}</div><div class="pn-card-valor">${valor} <span>${unid}</span></div><div class="pn-card-sub">${sub}</div>${extra}</div>`;
    }

    function listar(rolar) {
      const sem = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const t = sem(filtro.texto.trim());
      let lista = dados.pessoas;
      if (t) lista = lista.filter((p) => sem(p.nome).includes(t));
      if (filtro.letra) lista = lista.filter((p) => p.letra === filtro.letra);
      if (filtro.falta === "@vazia") lista = lista.filter((p) => !p.pdfs);
      else if (filtro.falta) lista = lista.filter((p) => !p.siglas.includes(filtro.falta));
      J.q("#pnContagem").textContent = `— ${plural(lista.length, "encontrado", "encontrados")}`;
      const max = 300;
      J.q("#pnLista").innerHTML = lista.length ? `<table class="pn-tabela"><thead><tr><th>Associado</th><th>Letra</th><th>Documentos</th><th>Último</th><th></th></tr></thead><tbody>
        ${lista.slice(0, max).map((p, i) => `<tr>
          <td><b>${esc(p.nome)}</b></td><td>${esc(p.letra)}</td>
          <td>${p.siglas.length ? p.siglas.map((s) => `<span class="pn-sigla">${esc(String(s).replace(/_/g, " "))}</span>`).join("") : '<span class="sub">vazia</span>'}</td>
          <td class="sub">${horaOuData(p.ultimo)}</td>
          <td class="pn-acoes"><button class="mini" data-usar="${i}" title="Pôr este nome no campo Associado">Usar nome</button><button class="mini" data-pasta="${i}" title="Abrir a pasta">📂</button></td></tr>`).join("")}
        </tbody></table>${lista.length > max ? `<p class="sub">Mostrando ${max} de ${fmtNum(lista.length)} — refine a busca.</p>` : ""}`
        : `<p class="sub" style="padding:10px">Ninguém com esse filtro.</p>`;
      J.qq("[data-usar]").forEach((b) => { b.onclick = async () => { const p = lista[+b.dataset.usar]; $("#inpAssociado").value = p.nome; J.fechar(); await onAssociadoMudou(); setStatus(`Associado: ${p.nome}`, "ok"); }; });
      J.qq("[data-pasta]").forEach((b) => { b.onclick = () => window.api.abrirPastaPessoa(lista[+b.dataset.pasta].pasta); });
      if (rolar) J.q("#pnLista").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    J.q("#pnRecontar").onclick = async () => { J.q("#pnRecontar").disabled = true; await carregarDados(true); J.q("#pnRecontar").disabled = false; };
    J.q("#pnExportar").onclick = async () => {
      const r = await window.api.exportarRelatorio();
      if (r && r.ok) setStatus("Relatório salvo: " + r.caminho, "ok");
      else if (r && !r.cancelado) setStatus("Não consegui salvar o relatório: " + (r.msg || ""), "erro");
    };
    carregarDados(true);
  }

  return { abrir, atualizarContador, get ultimo() { return ultimo; } };
})();

// =====================================================================
// HISTORICO (deste PC)
// =====================================================================
async function abrirHistorico() {
  const J = abrirJanela({ titulo: "🕘 Histórico — salvos neste PC", largura: 720, corpo: `<div class="painel-carregando"><div class="spinner"></div></div>`,
    rodape: `<button class="mini perigo" id="hiLimpar">Limpar histórico</button><span class="flex1"></span><button class="btn-sec" id="hiConferencia" title="Lista com o nome de todos que já passaram pela digitalização (TXT, por letra)">📄 Lista de conferência</button><button class="btn-sec" id="hiConfPlanilha" title="A mesma lista em planilha (Excel), por letra">📗 Planilha</button><button class="btn-sec" id="hiPainel">📊 Painel de produção</button>` });
  J.q("#hiConferencia").onclick = () => window.api.conferenciaAbrir();
  J.q("#hiConfPlanilha").onclick = () => window.api.conferenciaAbrir(null, "planilha");
  async function desenhar() {
    const h = await window.api.historico();
    if (!J.ov.isConnected) return;
    if (!h.itens.length) { J.q(".modal-corpo").innerHTML = `<p class="sub">Nada salvo neste PC ainda. Cada PDF que você salvar aparece aqui, com atalho pra abrir.</p>`; return; }
    let html = `<p class="sub" style="margin:0 0 10px">Hoje neste PC: <b>${plural(h.hoje.associados, "associado", "associados")}</b> · ${plural(h.hoje.pdfs, "PDF", "PDFs")}${h.hoje.paginas ? ` · ${plural(h.hoje.paginas, "página", "páginas")}` : ""}</p>`;
    let diaAtual = "";
    h.itens.forEach((e, i) => {
      const dia = diaLocal(new Date(e.quando).getTime());
      if (dia !== diaAtual) {
        diaAtual = dia;
        html += `<div class="hi-dia">${dia === diaLocal(Date.now()) ? "Hoje" : dia === diaLocal(Date.now() - 864e5) ? "Ontem" : new Date(e.quando).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</div>`;
      }
      html += `<div class="hi-item">
        <span class="hi-hora">${new Date(e.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="hi-nome">${esc(e.associado || "—")}</span>
        <span class="hi-arqs">${e.arquivos.map((a, j) => `<button class="doc-chip ${a.existe ? "" : "sumiu"}" data-i="${i}" data-j="${j}" title="${a.existe ? "Abrir " + esc(a.nome) : "Este arquivo não está mais lá"}">${esc(a.nome)}</button>`).join("")}</span>
        <button class="mini" data-pasta="${i}" title="Abrir a pasta">📂</button></div>`;
    });
    J.q(".modal-corpo").innerHTML = html;
    J.qq(".hi-arqs .doc-chip").forEach((b) => {
      b.onclick = async () => { const a = h.itens[+b.dataset.i].arquivos[+b.dataset.j]; if (!(await window.api.abrirDoHistorico(a.caminho))) setStatus("Esse PDF não está mais na pasta.", "aviso"); };
    });
    J.qq("[data-pasta]").forEach((b) => {
      b.onclick = async () => { const e = h.itens[+b.dataset.pasta]; if (!(await window.api.abrirDoHistorico(e.pasta))) setStatus("Essa pasta não existe mais.", "aviso"); };
    });
    // 2 cliques na linha: traz os documentos de volta pra tela pra editar
    J.qq(".hi-item").forEach((el, i) => {
      el.title = "2 cliques: abrir esses documentos pra editar";
      el.ondblclick = (ev) => { if (ev.target.closest("button")) return; J.fechar(); if (window.Assistente) window.Assistente.reabrir(h.itens[i]); };
    });
  }
  J.q("#hiLimpar").onclick = async () => { if (confirm("Apagar o histórico deste PC? (os PDFs não são apagados)")) { await window.api.limparHistorico(); desenhar(); } };
  J.q("#hiPainel").onclick = () => { J.fechar(); window.Painel.abrir(); };
  desenhar();
}

// =====================================================================
// ATALHOS DE TECLADO
// =====================================================================
function abrirAtalhos() {
  const linhas = [
    ["Geral", [["F2", "Escanear"], ["Ctrl + O", "Importar imagens ou PDF"], ["Ctrl + V", "Colar imagem"], ["F4", "Ir pro nome do associado"],
      ["Enter / Ctrl + S", "Salvar"], ["Ctrl + Z", "Desfazer"], ["F3", "Painel de produção"], ["F1", "Esta lista"]]],
    ["Páginas", [["← → ↑ ↓", "Andar entre as páginas"], ["Shift + setas", "Ir marcando várias"], ["Ctrl + A", "Marcar todas"], ["Home / End", "Primeira / última"],
      ["R / Shift + R", "Girar pra direita / esquerda"], ["C", "Colorido / cinza"], ["Del", "Remover"], ["Espaço", "Ver grande"], ["1 … 9", "Marcar tipo (modo documento por documento)"],
      ["⋯ Mais", "Intercalar frente e verso, inverter, juntar numa folha"]]],
    ["Ver grande", [["Roda do mouse", "Zoom"], ["Arrastar", "Mover a página"], ["Duplo clique", "Aproximar / caber"], ["X", "Recortar (Enter aplica)"],
      ["+ / − / 0", "Zoom / caber na tela"], ["← →", "Página anterior / próxima"], ["Esc", "Fechar"]]],
  ];
  abrirJanela({ titulo: "⌨ Atalhos de teclado", largura: 760,
    corpo: `<div class="at-grade">${linhas.map(([g, ls]) => `<div><h4>${g}</h4>${ls.map(([k, t]) => `<div class="at-linha"><span class="at-tecla">${k.split(" / ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" / ")}</span><span>${esc(t)}</span></div>`).join("")}</div>`).join("")}</div>` });
}

// =====================================================================
// ATUALIZACAO AUTOMATICA
// =====================================================================
window.Atualizacao = (() => {
  let info = null;
  async function procurar(manual) {
    let r = null;
    try { r = await window.api.procurarAtualizacao(); } catch (e) { r = { erro: e.message }; }
    if (r && r.nova) { info = r; mostrarBotao(); }
    else if (manual && r && !r.erro) setStatus(`Você já está na versão mais nova (${appVersao}).`, "ok");
    return r;
  }
  function mostrarBotao() {
    const b = document.getElementById("avisoAtualizacao");
    if (!b || !info) return;
    b.textContent = `⬆ Nova versão ${info.versao} — atualizar`;
    b.classList.remove("oculto");
    b.onclick = abrirJanelaAtualizar;
  }
  function abrirJanelaAtualizar() {
    if (!info) return;
    const J = abrirJanela({ titulo: `⬆ DigiDoc ${esc(info.versao)} disponível`, largura: 520,
      corpo: `<p style="margin-top:0">Você está na versão <b>${esc(appVersao)}</b>.${info.bytes ? ` Download: ~${fmtMB(info.bytes)}.` : ""}</p>
        ${info.notas && info.notas.length ? `<h4 style="margin:10px 0 6px">Novidades</h4><ul class="atu-notas">${info.notas.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        <p class="sub">O DigiDoc fecha, atualiza e abre de novo sozinho (leva menos de 1 minuto). Seus PDFs, a pasta dos documentos e as configurações continuam iguais.${paginas.length ? "<br><b style='color:var(--amarelo)'>Atenção: tem páginas na tela que ainda não foram salvas — salve antes.</b>" : ""}</p>`,
      rodape: `<button class="btn-sec" id="atuPagina">Ver no GitHub</button><span class="flex1"></span><button class="btn-sec" data-depois>Depois</button><button class="btn-salvar" id="atuAgora">Atualizar agora</button>` });
    J.q("[data-depois]").onclick = J.fechar;
    J.q("#atuPagina").onclick = () => window.api.paginaAtualizacao();
    J.q("#atuAgora").onclick = async () => {
      if (paginas.length && !confirm("Tem páginas na tela que não foram salvas. Elas vão se perder.\n\nAtualizar mesmo assim?")) return;
      J.fechar();
      ocupado = true; atualizarBotoesFonte();
      mostrarOverlay("Baixando a atualização…");
      const r = await window.api.aplicarAtualizacao();
      if (r && r.ok) { $("#overlayMsg").textContent = "Pronto! Reiniciando o DigiDoc…"; return; }
      ocupado = false; atualizarBotoesFonte(); esconderOverlay();
      mostrarAviso("Não deu pra atualizar", esc((r && r.msg) || "erro desconhecido") + "<br><br>Você pode baixar o instalador novo no GitHub (botão Ver no GitHub).", "var(--vermelho)");
    };
  }
  async function iniciar() {
    try {
      if (await window.api.atualizacaoFalhou()) setStatus("⚠ A última atualização não terminou. Feche outros DigiDoc abertos e tente atualizar de novo.", "aviso");
    } catch {}
    if (cfg.atualizacao && cfg.atualizacao.automatica === false) return;
    setTimeout(() => procurar(false), 8000);           // logo depois de abrir
    setInterval(() => procurar(false), 4 * 3600 * 1000); // e a cada 4 horas, pra quem deixa aberto o dia todo
  }
  return { procurar, iniciar, abrirJanelaAtualizar };
})();

// =====================================================================
// MENU "⋯ MAIS" (organizar paginas)
// =====================================================================
function abrirMenuMais(botao) {
  const velho = document.getElementById("menuMais");
  if (velho) { velho.remove(); return; }
  const marcadas = paginas.filter((p) => sel.has(p.id)).length;
  const alvo = marcadas >= 2 ? `as ${marcadas} marcadas` : "todas as páginas";
  const incertas = paginas.filter((p) => p.incerto).length;
  const itens = [
    { ic: "⇄", t: "Intercalar frente e verso", d: `scanner sem frente e verso: escaneie todas as frentes, vire o maço e escaneie os versos (${alvo})`, f: () => perguntarIntercalar() },
    { ic: "⇅", t: "Inverter a ordem", d: `a última vira a primeira (${alvo})`, f: inverterOrdem },
    { ic: "⧉", t: "Juntar as marcadas numa folha", d: marcadas >= 2 ? `RG frente e verso numa folha A4 só (${marcadas} páginas)` : "marque 2 páginas (Ctrl+clique), ex.: frente e verso do RG", f: juntarSelecionadas, off: marcadas < 2 },
    { ic: "✓", t: "O lado está certo", d: incertas ? `tira o aviso ↻? de ${sel.size ? "das marcadas" : incertas + " página(s)"}` : "nenhuma página com aviso ↻?", f: confirmarLado, off: !incertas },
    { ic: "☑", t: "Marcar todas", d: "Ctrl+A", f: () => { paginas.forEach((p) => sel.add(p.id)); renderGrade(); } },
  ];
  const m = document.createElement("div");
  m.id = "menuMais"; m.className = "menu-mais";
  m.innerHTML = itens.map((it, i) => `<button class="menu-item" data-i="${i}" ${it.off ? "disabled" : ""}><span class="mi-ic">${it.ic}</span><span><b>${esc(it.t)}</b><small>${esc(it.d)}</small></span></button>`).join("");
  document.body.appendChild(m);
  const r = botao.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + "px";
  m.style.top = Math.max(8, r.top - m.offsetHeight - 6) + "px";
  m.querySelectorAll(".menu-item").forEach((b) => { b.onclick = () => { m.remove(); if (!ocupado) itens[+b.dataset.i].f(); }; });
  setTimeout(() => {
    const fora = (e) => { if (!m.contains(e.target) && e.target !== botao) { m.remove(); document.removeEventListener("mousedown", fora); } };
    document.addEventListener("mousedown", fora);
  }, 0);
}
function perguntarIntercalar() {
  const alvo = alvoOrganizar();
  const J = abrirJanela({ titulo: "⇄ Intercalar frente e verso", largura: 520,
    corpo: `<p style="margin-top:0">Use quando o scanner <b>não faz frente e verso sozinho</b>: escaneie todas as <b>frentes</b>, vire o maço e escaneie todos os <b>versos</b>. O DigiDoc põe cada verso logo depois da sua frente.</p>
      <p class="sub">${alvo.length} página(s) ${alvo.length % 2 ? "— <b style='color:var(--amarelo)'>precisa ser um número par</b>" : `= ${alvo.length / 2} folhas`}</p>
      <p style="margin-bottom:0"><b>Como os versos saíram?</b></p>`,
    rodape: `<span class="flex1"></span><button class="btn-sec" id="itMesma">Na mesma ordem</button><button class="btn-salvar" id="itInv">Ao contrário (virei o maço)</button>` });
  J.q("#itInv").onclick = () => { J.fechar(); intercalarFrenteVerso(true); };
  J.q("#itMesma").onclick = () => { J.fechar(); intercalarFrenteVerso(false); };
}

// =====================================================================
// FILA DE ASSOCIADOS: cola a lista de nomes e vai fazendo um por um
// =====================================================================
window.Fila = (() => {
  let fila = { itens: [], auto: true };
  const chave = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const pendentes = () => fila.itens.filter((i) => !i.feito);
  const salvar = () => window.api.filaSalvar(fila);

  async function carregar() { try { fila = await window.api.filaObter(); } catch {} atualizarChip(); }

  function proximo() {
    const atual = chave($("#inpAssociado").value);
    return pendentes().find((i) => chave(i.nome) !== atual) || null;
  }
  function atualizarChip() {
    const b = document.getElementById("filaProx"), bf = document.getElementById("btnFila");
    if (!b) return;
    const pend = pendentes(), prox = proximo();
    if (bf) bf.textContent = fila.itens.length ? `👥 Fila ${fila.itens.length - pend.length}/${fila.itens.length}` : "👥 Fila";
    if (!prox) { b.classList.add("oculto"); return; }
    b.classList.remove("oculto");
    b.innerHTML = `Próximo: <b>${esc(prox.nome)}</b> ▶`;
    b.onclick = async () => { $("#inpAssociado").value = prox.nome; await onAssociadoMudou(); setStatus(`Associado: ${prox.nome}`, "ok"); };
  }
  // depois de salvar: marca o nome como feito e (se ligado) ja poe o proximo. true = pos o proximo
  async function aposSalvar(nome, limpou) {
    const k = chave(nome);
    let mudou = false;
    for (const i of fila.itens) if (!i.feito && chave(i.nome) === k) { i.feito = true; mudou = true; }
    if (mudou) await salvar();
    let pos = false;
    if (fila.auto && limpou) {
      const prox = pendentes()[0];
      if (prox) {
        const inp = $("#inpAssociado");
        inp.value = prox.nome;
        await onAssociadoMudou();
        setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 50);
        setStatus(`${$("#status").textContent}  ▶ Próximo da fila: ${prox.nome}`, "ok");
        pos = true;
      } else if (mudou && fila.itens.length) toast("🎉 <b>Fila terminada!</b> Todos os associados da lista foram feitos.", "ok");
    }
    atualizarChip();
    return pos;
  }

  function abrir() {
    const J = abrirJanela({ titulo: "👥 Fila de associados", largura: 640,
      corpo: `<p class="sub" style="margin-top:0">Cole a lista de nomes (um por linha) ou importe de um arquivo. Depois de salvar cada associado, o DigiDoc marca como feito e já põe o próximo nome.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn-sec" id="fiColar">📋 Colar nomes</button>
          <button class="btn-sec" id="fiImportar">📄 Importar .txt / .csv</button>
          <span class="flex1"></span>
          <button class="mini" id="fiLimparFeitos">Tirar os feitos</button>
          <button class="mini perigo" id="fiLimpar">Esvaziar</button>
        </div>
        <div class="cfg-linha"><label class="rot">Depois de salvar, já pôr o próximo nome da fila</label>
          <label class="switch"><input type="checkbox" id="fiAuto"><span class="slider"></span></label></div>
        <div id="fiLista" class="fila-lista"></div>`,
      rodape: `<span class="sub" id="fiResumo"></span><span class="flex1"></span><button class="btn-salvar" data-ok>Pronto</button>` });
    J.q("[data-ok]").onclick = J.fechar;
    const auto = J.q("#fiAuto");
    auto.checked = fila.auto !== false;
    auto.onchange = async () => { fila.auto = auto.checked; await salvar(); };
    const existentes = new Set((typeof nomesAssociados !== "undefined" ? nomesAssociados : []).map(chave));

    function desenhar() {
      const pend = pendentes().length;
      J.q("#fiResumo").textContent = fila.itens.length ? `${fila.itens.length - pend} feitos · ${pend} faltando` : "fila vazia";
      J.q("#fiLista").innerHTML = fila.itens.length ? fila.itens.map((it, i) => `
        <div class="fila-item ${it.feito ? "feito" : ""}">
          <span class="fila-n">${i + 1}</span>
          <span class="fila-nome">${esc(it.nome)}${existentes.has(chave(it.nome)) ? ' <span class="fila-tag" title="Já existe pasta com esse nome">📁 já tem pasta</span>' : ""}</span>
          <button class="mini" data-usar="${i}" title="Pôr no campo Associado">Usar</button>
          <button class="mini" data-feito="${i}">${it.feito ? "↺ Desfazer" : "✓ Feito"}</button>
          <button class="mini perigo" data-tirar="${i}" title="Tirar da fila">✕</button>
        </div>`).join("") : `<p class="sub" style="padding:12px;text-align:center">Nenhum nome ainda. Clique em <b>Colar nomes</b>.</p>`;
      J.qq("[data-usar]").forEach((b) => { b.onclick = async () => { $("#inpAssociado").value = fila.itens[+b.dataset.usar].nome; J.fechar(); await onAssociadoMudou(); $("#inpAssociado").focus(); }; });
      J.qq("[data-feito]").forEach((b) => { b.onclick = async () => { const it = fila.itens[+b.dataset.feito]; it.feito = !it.feito; await salvar(); desenhar(); atualizarChip(); }; });
      J.qq("[data-tirar]").forEach((b) => { b.onclick = async () => { fila.itens.splice(+b.dataset.tirar, 1); await salvar(); desenhar(); atualizarChip(); }; });
    }
    async function adicionar(nomes) {
      const ja = new Set(fila.itens.map((i) => chave(i.nome)));
      let n = 0;
      for (const bruto of nomes) {
        const nome = String(bruto).replace(/\s+/g, " ").trim();
        if (nome.length < 2 || ja.has(chave(nome))) continue;
        ja.add(chave(nome)); fila.itens.push({ nome, feito: false }); n++;
      }
      await salvar(); desenhar(); atualizarChip();
      setStatus(`${n} nome(s) entraram na fila.`, "ok");
    }
    J.q("#fiColar").onclick = async () => { const t = await pedirTexto("Cole os nomes (um por linha) — Ctrl+Enter confirma", "", true); if (t) adicionar(t.split(/\r?\n/)); };
    J.q("#fiImportar").onclick = async () => { const l = await window.api.filaImportar(); if (l && l.length) adicionar(l); };
    J.q("#fiLimparFeitos").onclick = async () => { fila.itens = pendentes(); await salvar(); desenhar(); atualizarChip(); };
    J.q("#fiLimpar").onclick = async () => { if (fila.itens.length && confirm("Esvaziar a fila inteira?")) { fila.itens = []; await salvar(); desenhar(); atualizarChip(); } };
    desenhar();
  }
  return { carregar, abrir, aposSalvar, atualizarChip, proximo };
})();

// =====================================================================
// liga tudo
// =====================================================================
// =====================================================================
// LISTA DE CONFERENCIA: importar pastas ja digitalizadas (nome da pasta + dia em que foi criada)
// =====================================================================
window.Conferencia = (() => {
  async function importar(pasta) {
    const r = await window.api.conferenciaEscanear();
    if (!r) return; // cancelou a escolha
    const achados = r.achados || [];
    const pastas = r.pastas.map((p) => p.split(/[\\/]/).pop());
    const max = 400;
    const J = abrirJanela({ titulo: "📥 Importar pra lista de conferência", largura: 720,
      corpo: achados.length ? `
        <p style="margin-top:0">Encontrei <b>${fmtNum(achados.length)} associado(s)</b> em ${esc(pastas.join(", "))} — pastas criadas de <b>${dataCurta(achados[0].data)}/${achados[0].data.slice(0, 4)}</b> a <b>${dataCurta(achados[achados.length - 1].data)}/${achados[achados.length - 1].data.slice(0, 4)}</b>.</p>
        <p class="sub">Vai pra lista só o <b>nome da pasta</b> (exatamente como está escrito) e o <b>dia em que a pasta foi criada</b>. Quem já está na lista não entra de novo.</p>
        <div class="pn-lista" style="max-height:340px"><table class="pn-tabela"><thead><tr><th>Dia</th><th>Associado</th><th>Pasta</th></tr></thead><tbody>
          ${achados.slice(0, max).map((a) => `<tr><td class="sub">${dataCurta(a.data)}/${a.data.slice(0, 4)}</td><td><b>${esc(a.nome)}</b></td><td class="sub">${esc(a.pasta.split(/[\\/]/).slice(-2, -1)[0] || "")}</td></tr>`).join("")}
        </tbody></table></div>
        ${achados.length > max ? `<p class="sub">Mostrando ${max} de ${fmtNum(achados.length)} — todos vão ser importados.</p>` : ""}`
        : `<p style="margin-top:0">Não achei pastas de associados em ${esc(pastas.join(", "))}.</p><p class="sub">Escolha a pasta principal dos digitalizados ou as pastas das letras (ex.: "Digitalizados A") — dentro delas ficam as pastas com o nome de cada associado.</p>`,
      rodape: `<span class="flex1"></span><button class="btn-sec" data-cancelar>${achados.length ? "Cancelar" : "Fechar"}</button>${achados.length ? `<button class="btn-salvar" id="cfImportar">Importar ${fmtNum(achados.length)}</button>` : ""}` });
    J.q("[data-cancelar]").onclick = J.fechar;
    const b = J.q("#cfImportar");
    if (b) b.onclick = async () => {
      b.disabled = true; b.textContent = "Importando…";
      const res = await window.api.conferenciaImportar(achados, pasta || null);
      J.fechar();
      if (res && res.ok) {
        toast(`📄 <b>Lista de conferência:</b> ${fmtNum(res.novos)} associado(s) adicionado(s)${res.jaTinha ? `, ${fmtNum(res.jaTinha)} já estavam` : ""}. Total: ${fmtNum(res.total)}.`, "ok", 9000);
        setStatus(`Lista de conferência: +${res.novos} (total ${res.total}).`, "ok");
      } else setStatus("Não consegui importar: " + ((res && res.msg) || "erro"), "erro");
    };
  }
  return { importar };
})();

window.Extras = { atalhos: abrirAtalhos, historico: abrirHistorico };
(function ligarExtras() {
  window.Visor.ligar();
  document.getElementById("btnMais").onclick = (e) => abrirMenuMais(e.currentTarget);
  document.getElementById("btnFila").onclick = () => window.Fila.abrir();
  window.Fila.carregar();
  document.getElementById("btnHistorico").onclick = abrirHistorico;
  document.getElementById("btnAtalhos").onclick = abrirAtalhos;
  document.getElementById("contadorHoje").onclick = () => window.Painel.abrir();
  window.api.onHistorico(() => window.Painel.atualizarContador());
  window.api.onAviso((t) => toast("⚠ " + esc(t), "aviso", 10000)); // avisos do processo principal (ex.: lista de conferencia)
  // o contador e a busca de atualizacao esperam a config carregar (init do app.js e assincrono)
  const esperarCfg = setInterval(() => {
    if (!cfg) return;
    clearInterval(esperarCfg);
    window.Painel.atualizarContador();
    window.Atualizacao.iniciar();
    // vira o dia com o app aberto: zera o "Hoje"
    let dia = diaLocal(Date.now());
    setInterval(() => { if (diaLocal(Date.now()) !== dia) { dia = diaLocal(Date.now()); window.Painel.atualizarContador(); } }, 60000);
  }, 200);
})();
