"use strict";
// Diagnostico pra desenvolvedor (TEMPORARIO — sai quando o desenvolvedor pedir).
// Gera um texto so com a ESTRUTURA da pasta dos digitalizados: quantas pastas, como os arquivos
// sao nomeados, tamanhos. Nenhum arquivo e aberto e nada e enviado pra internet.
//   - o nome de cada associado vira <NOME> (e o numero que estiver no nome da pasta vira <CÓD>)
//   - palavra que aparece nos arquivos de poucos associados vira <?> (nome de conjuge, rua...)
//   - numeros viram # (so fica o tamanho: ###.###.###-## parece CPF)
//   - a pasta de cada associado aparece so pela FORMA (ex.: "XXX XXX XXX (####)")
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

// so quem tem a senha de desenvolvedor gera o relatorio (aqui fica so o "hash" dela)
const SAL = "6b1d4f2ce59ca210928671f134dbecd4";
const HASH = "ab446a400ea60101f7e298ab18ca15d9a40430431fb65a1e08ab517e10c5a2b7";
function senhaOk(s) {
  if (typeof s !== "string" || !s.trim() || s.length > 200) return false;
  try { return crypto.timingSafeEqual(crypto.scryptSync(s.trim(), SAL, 32), Buffer.from(HASH, "hex")); }
  catch { return false; }
}

const MIN_SOCIOS = 3;            // a palavra so aparece se estiver nos arquivos de 3+ associados diferentes
const LIMITE_ARQUIVOS = 300000;
const LIMITE_MS = 4 * 60 * 1000; // pasta de rede lenta: para depois de 4 minutos (relatorio parcial)
const LIGACOES = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "D"]);
const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s) => semAcento(s).toUpperCase();
const SEP = /([\s_\-.,;+()[\]{}]+)/;
const SO_SEP = /^[\s_\-.,;+()[\]{}]+$/;

async function lerDir(dir) { try { return await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; } }
async function info(p) { try { return await fsp.stat(p); } catch { return null; } }

// "Digitalizados A", "Letra B", "C", "DigitalizadosD"
function letraDaPasta(nome) {
  const m = String(nome).match(/^(.*?)(\s*)([A-Za-z#])\s*$/);
  if (!m || m[3] !== m[3].toUpperCase()) return null;
  if (m[1] && !m[2] && /[A-Z]$/.test(m[1])) return null; // "ANTIGOS": a letra final faz parte da palavra
  return { letra: m[3], prefixo: norm(m[1]).replace(/\s+/g, "") };
}

// forma de um nome sem mostrar o nome: "Maria da Silva (123)" -> "Xxx da Xxx (###)"
function forma(nome) {
  return String(nome)
    .replace(/\d+/g, (d) => "#".repeat(Math.min(d.length, 14)))
    .replace(/\p{L}+/gu, (w) => {
      if (w.length > 1 && LIGACOES.has(norm(w))) return w; // de/da/do: mostra como esta
      if (w.length === 1) return w === w.toUpperCase() ? "X" : "x";
      if (w === w.toUpperCase()) return "XXX";
      if (w === w.toLowerCase()) return "xxx";
      if (w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase()) return "Xxx";
      return "XxX";
    })
    .replace(/\s{2,}/g, (s) => "·".repeat(s.length)); // espaco duplo aparece como ··
}

// palavras e numeros do nome da pasta do associado (pra trocar por <NOME>/<CÓD> nos arquivos)
function tokensDoNome(nome) {
  const pal = new Set(), num = new Set();
  for (const t of norm(nome).split(/[^A-Z0-9]+/)) {
    for (const p of t.split(/(\d+)/)) {
      if (!p) continue;
      if (/^\d+$/.test(p)) num.add(p);
      else if (p.length > 1 && !LIGACOES.has(p)) pal.add(p);
    }
  }
  return { pal, num };
}

// nome do arquivo em pedacos: separadores e numeros ja anonimos; palavras ficam pra decidir depois
function pedacos(base, nomeTk) {
  const out = [];
  for (const p of String(base).split(SEP)) {
    if (!p) continue;
    if (SO_SEP.test(p)) { out.push({ s: p.replace(/\s+/g, " ") }); continue; }
    for (const q of p.split(/(\d+)/)) {
      if (!q) continue;
      if (/^\d+$/.test(q)) out.push({ s: nomeTk && nomeTk.num.has(q) ? "<CÓD>" : "#".repeat(Math.min(q.length, 14)) });
      else {
        const n = norm(q);
        const ant = [...out].reverse().find((x) => !(x.s != null && SO_SEP.test(x.s)));
        if (nomeTk && nomeTk.pal.has(n)) out.push({ s: "<NOME>" });
        else if (LIGACOES.has(n) && ant && ant.s === "<NOME>") out.push({ s: "<NOME>" }); // "Silva DA Costa"
        else out.push({ tok: n, orig: q });
      }
    }
  }
  return out;
}

function montar(partes, fontesDoTok, limiar = MIN_SOCIOS) {
  let s = partes.map((p) => (p.s != null ? p.s : (fontesDoTok.get(p.tok) || new Set()).size >= limiar ? p.orig : "<?>")).join("");
  s = s.replace(/<NOME>(?:[\s_\-.]*<NOME>)+/g, "<NOME>");
  s = s.replace(/<\?>(?:[\s_\-.]*<\?>)+/g, "<?>");
  return s;
}

const fmtN = (n) => Number(n || 0).toLocaleString("pt-BR");
const pct = (a, b) => (b ? `${Math.round((a * 100) / b)}%` : "0%");
const fmtMB = (b) => `${(b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
const somar = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const doisDig = (n) => String(n).padStart(2, "0");
const mes = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}`; };
const chaveSocio = (s) => norm(s).replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");

async function gerar(cfg, meta = {}) {
  const t0 = Date.now();
  const raiz = cfg.pastaSaida;
  let parcial = "";
  const tempoAcabou = () => { if (Date.now() - t0 > LIMITE_MS) { parcial = parcial || "tempo (4 min)"; return true; } return false; };

  const arquivos = [];               // { fonte, partes, ext, tam, onde: "socio"|"letra"|"raiz", sub }
  const fontesDoTok = new Map();     // palavra -> Set(associado/fonte) — pra saber se e comum
  const grafias = new Map();         // palavra -> Map(grafia -> n)
  let nFonte = 0;
  const anotar = (fonte, partes) => {
    for (const p of partes) if (p.tok) {
      if (!fontesDoTok.has(p.tok)) fontesDoTok.set(p.tok, new Set());
      fontesDoTok.get(p.tok).add(fonte);
      if (!grafias.has(p.tok)) grafias.set(p.tok, new Map());
      somar(grafias.get(p.tok), p.orig);
    }
  };
  const addArquivo = async (dir, nome, fonte, nomeTk, onde, sub = null) => {
    if (arquivos.length >= LIMITE_ARQUIVOS) { parcial = parcial || `limite de ${fmtN(LIMITE_ARQUIVOS)} arquivos`; return; }
    const ext = path.extname(nome).toLowerCase() || "(sem extensão)";
    const base = ext === "(sem extensão)" ? nome : nome.slice(0, -ext.length);
    const st = await info(path.join(dir, nome));
    const partes = pedacos(base, nomeTk);
    anotar(fonte, partes);
    arquivos.push({ fonte, partes, ext, tam: st ? st.size : 0, onde, sub, longo: nome.length > 40 });
  };

  // ---- pasta principal ----
  const ents = await lerDir(raiz);
  const dirsRaiz = ents.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  const prefixos = new Map();
  for (const n of dirsRaiz) { const l = letraDaPasta(n); if (l) somar(prefixos, l.prefixo); }
  const ehLetra = (n) => { const l = letraDaPasta(n); return l && (l.prefixo === "" || prefixos.get(l.prefixo) >= 2) ? l : null; };
  let pastasLetra = dirsRaiz.filter((n) => ehLetra(n)).map((n) => ({ dir: path.join(raiz, n), rotulo: n, letra: ehLetra(n).letra }));
  const outrasRaiz = dirsRaiz.filter((n) => !ehLetra(n));
  let semLetras = false;
  if (!pastasLetra.length) { // a pasta escolhida ja e a de uma letra (ou outra organizacao)
    semLetras = true;
    pastasLetra = [{ dir: raiz, rotulo: "(a própria pasta principal)", letra: "?" }];
  }
  for (const f of ents.filter((d) => d.isFile())) await addArquivo(raiz, f.name, `r${++nFonte}`, null, "raiz");

  // ---- letras > associados > arquivos ----
  const socios = [];   // { id, letra, forma, tk, nArq, vazia, comSub, ms, chave, letraCerta }
  const porLetra = [];
  for (const L of pastasLetra) {
    if (tempoAcabou()) break;
    const pl = { rotulo: L.rotulo, socios: 0, arquivos: 0, vazias: 0, soltos: 0 };
    porLetra.push(pl);
    const itens = await lerDir(L.dir);
    for (const it of itens) {
      if (tempoAcabou() || arquivos.length >= LIMITE_ARQUIVOS) break;
      if (it.isFile()) {
        if (semLetras) continue; // ja contado como arquivo da raiz
        pl.soltos++; await addArquivo(L.dir, it.name, `l${++nFonte}`, null, "letra"); continue;
      }
      if (!it.isDirectory() || it.name.startsWith(".")) continue;
      if (semLetras && ehLetra(it.name)) continue;
      const dirS = path.join(L.dir, it.name);
      const id = socios.length + 1, fonte = `s${id}`;
      const tk = tokensDoNome(it.name);
      const st = await info(dirS);
      const primeira = (norm(it.name).match(/[A-Z]/) || ["#"])[0];
      const s = { id, letra: L.letra, forma: forma(it.name), nArq: 0, comSub: false, ms: st ? (st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs) : 0,
        chave: `${L.dir}|${chaveSocio(it.name)}`, letraCerta: L.letra === "?" || primeira === L.letra, nome: it.name };
      socios.push(s);
      pl.socios++;
      const conteudo = await lerDir(dirS);
      for (const c of conteudo) {
        if (c.isFile()) { await addArquivo(dirS, c.name, fonte, tk, "socio"); s.nArq++; }
        else if (c.isDirectory()) {
          s.comSub = true;
          const subPartes = pedacos(c.name, tk);
          anotar(fonte, subPartes);
          for (const c2 of await lerDir(path.join(dirS, c.name))) {
            if (c2.isFile()) { await addArquivo(path.join(dirS, c.name), c2.name, fonte, tk, "socio", subPartes); s.nArq++; }
          }
        }
      }
      if (!s.nArq) pl.vazias++;
      pl.arquivos += s.nArq;
    }
  }

  // ---- outras pastas da raiz (so a forma do nome e quanto tem dentro) ----
  const outras = [];
  for (const n of outrasRaiz) {
    if (tempoAcabou()) break;
    const dentro = await lerDir(path.join(raiz, n));
    outras.push({ forma: forma(n), pastas: dentro.filter((d) => d.isDirectory()).length, arquivos: dentro.filter((d) => d.isFile()).length });
  }

  // com muitos associados, a palavra precisa estar em mais deles pra aparecer
  const limiar = socios.length >= 100 ? 5 : MIN_SOCIOS;

  // ================= relatorio =================
  const L = [];
  const linha = "=".repeat(78), fina = "-".repeat(78);
  const titulo = (t) => L.push("", fina, ` ${t}`, fina);
  const tabela = (pares, larg = 54) => { for (const [a, b] of pares) L.push(`  ${String(a).padEnd(larg)} ${b}`); };

  let caminho = String(raiz || "");
  if (meta.home && caminho.toLowerCase().startsWith(String(meta.home).toLowerCase())) caminho = "%USERPROFILE%" + caminho.slice(meta.home.length);
  if (meta.usuario && meta.usuario.length >= 3) caminho = caminho.split(new RegExp(meta.usuario.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig")).join("<usuario>");

  const arqSocio = arquivos.filter((a) => a.onde === "socio");
  const totalTam = arquivos.reduce((n, a) => n + a.tam, 0);
  L.push(linha, " DIAGNÓSTICO DO DIGIDOC (anônimo) — só a estrutura das pastas", linha,
    " Nenhum documento foi aberto e nada foi enviado pra internet.",
    " Nome de associado = <NOME>   número da pasta do associado = <CÓD>   número = #",
    ` Palavra que aparece em menos de ${limiar} associados = <?>`,
    " Pasta de associado aparece só pela forma: XXX = palavra MAIÚSCULA, Xxx = Título, xxx = minúscula",
    "", ` Gerado em: ${new Date().toLocaleString("pt-BR")}   DigiDoc ${meta.versao || "?"}   Windows ${meta.windows || "?"}`,
    ` Pasta principal: ${caminho || "(não configurada)"}${!fs.existsSync(raiz || "") ? "   ** NÃO ENCONTRADA **" : !ents.length ? "   (vazia)" : ""}`,
    ` Leitura: ${((Date.now() - t0) / 1000).toFixed(1)} s${parcial ? `   ** PARCIAL: parou por ${parcial} **` : ""}`);

  titulo("TOTAIS");
  tabela([
    ["Pastas de letra", semLetras ? "nenhuma (a pasta principal foi tratada como uma letra)" : fmtN(pastasLetra.length)],
    ["Pastas de associado", fmtN(socios.length)],
    ["  sem nenhum arquivo", `${fmtN(socios.filter((s) => !s.nArq).length)}`],
    ["  com subpasta dentro", `${fmtN(socios.filter((s) => s.comSub).length)}`],
    ["  na letra 'errada' (1ª letra do nome ≠ letra da pasta)", fmtN(socios.filter((s) => !s.letraCerta).length)],
    ["  possíveis duplicadas (mesmo nome, escrito diferente)", fmtN(socios.length - new Set(socios.map((s) => s.chave)).size)],
    ["Arquivos (todos)", `${fmtN(arquivos.length)}  (${fmtMB(totalTam)})`],
    ["  dentro das pastas de associado", fmtN(arqSocio.length)],
    ["  soltos na pasta da letra", fmtN(arquivos.filter((a) => a.onde === "letra").length)],
    ["  soltos na pasta principal", fmtN(arquivos.filter((a) => a.onde === "raiz").length)],
    ["  com nome maior que 40 caracteres", fmtN(arquivos.filter((a) => a.longo).length)],
  ]);

  titulo("TIPOS DE ARQUIVO");
  const exts = new Map(), extTam = new Map();
  for (const a of arquivos) { somar(exts, a.ext); somar(extTam, a.ext, a.tam); }
  tabela([...exts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([e, n]) => [e, `${fmtN(n)} arquivo(s)  ${fmtMB(extTam.get(e))}`]), 20);
  const pdfs = arquivos.filter((a) => a.ext === ".pdf");
  if (pdfs.length) {
    const faixas = [["até 200 KB", 0, 204800], ["200 KB – 1 MB", 204800, 1048576], ["1 – 2 MB", 1048576, 2097152], ["2 – 5 MB", 2097152, 5242880], ["mais de 5 MB", 5242880, Infinity]];
    L.push("", "  Tamanho dos PDFs:");
    tabela(faixas.map(([r, a, b]) => { const n = pdfs.filter((p) => p.tam >= a && p.tam < b).length; return [`  ${r}`, `${fmtN(n)}  (${pct(n, pdfs.length)})`]; }), 20);
  }

  titulo("PASTAS DE LETRA");
  for (const p of porLetra) {
    const l = letraDaPasta(p.rotulo);
    const rot = semLetras || !l || l.prefixo === "" || prefixos.get(l.prefixo) >= 2 ? p.rotulo : forma(p.rotulo);
    L.push(`  "${rot}"`.padEnd(30) + ` ${fmtN(p.socios).padStart(6)} associado(s)  ${fmtN(p.arquivos).padStart(7)} arquivo(s)` +
      (p.vazias ? `  ${fmtN(p.vazias)} vazia(s)` : "") + (p.soltos ? `  ${fmtN(p.soltos)} solto(s)` : ""));
  }
  if (outras.length) {
    L.push("", "  Outras pastas na pasta principal (só a forma do nome):");
    for (const o of outras.slice(0, 40)) L.push(`    "${o.forma}"  — ${fmtN(o.pastas)} pasta(s), ${fmtN(o.arquivos)} arquivo(s)`);
  }

  titulo("COMO AS PASTAS DE ASSOCIADO SÃO ESCRITAS");
  if (socios.length) {
    const tem = (re) => socios.filter((s) => re.test(s.nome)).length;
    tabela([
      ["tudo MAIÚSCULO", pct(tem(/^[^a-zà-ÿ]*$/), socios.length)],
      ["Primeira Letra Maiúscula", pct(socios.filter((s) => /^Xxx/.test(s.forma) && !/XXX/.test(s.forma)).length, socios.length)],
      ["com acento", pct(tem(/[À-ÿ]/), socios.length)],
      ["com número", pct(tem(/\d/), socios.length)],
      ["  número entre parênteses no fim, ex.: (1234)", pct(tem(/\(\s*\d+\s*\)\s*$/), socios.length)],
      ["  número no começo", pct(tem(/^\s*\d/), socios.length)],
      ["com hífen ( - )", pct(tem(/-/), socios.length)],
      ["com espaço duplo", pct(tem(/\s{2}/), socios.length)],
      ["com espaço no começo/fim", pct(tem(/^\s|\s$/), socios.length)],
      ["com ponto ou outro símbolo", pct(tem(/[^\p{L}\d\s()\-]/u), socios.length)],
    ], 46);
    const palavras = new Map();
    for (const s of socios) somar(palavras, (s.nome.match(/\p{L}+/gu) || []).length);
    L.push("", "  Palavras no nome: " + [...palavras.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}: ${fmtN(n)}`).join("   "));
    const formas = new Map();
    for (const s of socios) somar(formas, s.forma);
    L.push("", "  Formas mais comuns:");
    for (const [f, n] of [...formas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) L.push(`    ${fmtN(n).padStart(6)}  "${f}"`);
  }

  titulo("ARQUIVOS POR ASSOCIADO");
  if (socios.length) {
    const faixas = [["0", 0, 0], ["1", 1, 1], ["2", 2, 2], ["3", 3, 3], ["4", 4, 4], ["5", 5, 5], ["6 a 9", 6, 9], ["10 a 19", 10, 19], ["20 ou mais", 20, Infinity]];
    tabela(faixas.map(([r, a, b]) => { const n = socios.filter((s) => s.nArq >= a && s.nArq <= b).length; return [`${r} arquivo(s)`, `${fmtN(n)} associado(s)  (${pct(n, socios.length)})`]; }), 20);
  }

  titulo("NOMES DOS ARQUIVOS — padrões mais comuns (dentro das pastas de associado)");
  const padroes = new Map(); // padrao -> { n, fontes }
  for (const a of arqSocio) {
    const k = (a.sub ? montar(a.sub, fontesDoTok, limiar) + " / " : "") + montar(a.partes, fontesDoTok, limiar) + a.ext;
    const v = padroes.get(k) || { n: 0, fontes: new Set() };
    v.n++; v.fontes.add(a.fonte); padroes.set(k, v);
  }
  L.push("  associados  arquivos  padrão");
  for (const [k, v] of [...padroes.entries()].sort((a, b) => b[1].fontes.size - a[1].fontes.size || b[1].n - a[1].n).slice(0, 150)) {
    L.push(`  ${fmtN(v.fontes.size).padStart(9)}  ${fmtN(v.n).padStart(8)}  ${k}`);
  }
  if (padroes.size > 150) L.push(`  … e mais ${fmtN(padroes.size - 150)} padrão(ões) diferentes`);

  titulo("PALAVRAS QUE MAIS APARECEM NOS NOMES DOS ARQUIVOS");
  const vocab = [...fontesDoTok.entries()].filter(([, f]) => f.size >= limiar).sort((a, b) => b[1].size - a[1].size).slice(0, 120);
  L.push("  em quantos associados/arquivos soltos  palavra  (jeitos de escrever)");
  for (const [tok, f] of vocab) {
    const g = [...grafias.get(tok).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s}×${fmtN(n)}`).join(", ");
    L.push(`  ${fmtN(f.size).padStart(8)}  ${tok.padEnd(22)} ${g}`);
  }

  const soltos = arquivos.filter((a) => a.onde !== "socio");
  if (soltos.length) {
    titulo("ARQUIVOS SOLTOS (fora das pastas de associado) — padrões");
    const ps = new Map();
    for (const a of soltos) somar(ps, `[${a.onde === "raiz" ? "principal" : "letra"}] ${montar(a.partes, fontesDoTok, limiar)}${a.ext}`);
    for (const [k, n] of [...ps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`  ${fmtN(n).padStart(7)}  ${k}`);
  }

  titulo("QUANDO AS PASTAS DE ASSOCIADO FORAM CRIADAS (por mês)");
  const meses = new Map();
  for (const s of socios) if (s.ms) somar(meses, mes(s.ms));
  for (const [m, n] of [...meses.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 36)) L.push(`  ${m}  ${fmtN(n).padStart(6)}  ${"█".repeat(Math.min(50, Math.ceil(n / Math.max(1, Math.max(...meses.values()) / 50))))}`);

  titulo("CONFIGURAÇÃO DO DIGIDOC NESTE PC");
  tabela([
    ["Pasta da letra (formato)", JSON.stringify(cfg.formatoPastaLetra)],
    ["Nome da pasta do associado", JSON.stringify(cfg.formatoNomeAssociado)],
    ["Nome do arquivo (formato)", JSON.stringify(cfg.formatoNomeArquivo)],
    ["Nome do arquivo em maiúsculas / sem acento", `${cfg.maiusculasNomeArquivo ? "sim" : "não"} / ${cfg.removerAcentosArquivo ? "sim" : "não"}`],
    ["Máximo de caracteres", String(cfg.maxCaracteresNome)],
    ["Reconhecer o tipo sozinho", cfg.reconhecerTipo ? "ligado" : "desligado"],
  ], 44);
  const tipos = Array.isArray(cfg.tipos) ? cfg.tipos : [];
  if (tipos.length) L.push("", "  Tipos de documento: " + tipos.map((t) => `${t.nome || "?"}${t.sigla && t.sigla !== t.nome ? ` (${t.sigla})` : ""}`).join(", "));
  L.push("", linha, "");
  return L.join("\n");
}

module.exports = { senhaOk, gerar, _forma: forma, _pedacos: pedacos, _montar: montar, _tokensDoNome: tokensDoNome };
