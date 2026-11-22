"use strict";
// Arrumar pastas antigas — OPCIONAL, nunca automatico. Analisa a pasta dos digitalizados e PROPOE:
//   - copias duplicadas (o PDF original + o "_compressed" do iLovePDF, ou dois arquivos iguais)
//   - nomes fora do padrao ("COMP. ENDEREÇO.pdf" -> "ENDERECO.pdf", "NEGATIVA JOAO" -> "NEG JOAO")
//   - arquivos do scanner sem nome ("2026-11-05 (1).pdf"): a tela le o documento e sugere o nome
//   - PDF acima do limite (comprimir), pasta na letra errada, espaco sobrando no nome, pasta vazia
// So faz o que a pessoa marcar. NADA e apagado: o que sai vai pra uma pasta de seguranca (com a mesma
// estrutura de pastas) e tudo fica anotado num diario — da pra desfazer.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nomesDoc = require("../shared/nomesdoc");
const files = require("./files");

const DIARIO = "arrumacao (diario).json";
const RX_SCANNER = /^\d{4}[-_ ]\d{2}[-_ ]\d{2}/;                       // "2026-11-05 (1)"
const RX_GENERICO = /^(scan|scanner|digitaliza\w*|documento|img|image|imagem|arquivo|novo documento|sem t[ií]tulo|untitled|digitalizado)?[\s_-]*\(?\d*\)?$/i;
const RX_COMP = /[\s_-]*compressed.*$/i;                                 // "_compressed", "_compressed (1)"
const RX_PARTE = /[\s_-]*compressed[-_]\d+[-_]\d+$|[-_]\d+[-_]\d+$/i;    // pedaco de PDF dividido ("-1-10")

const ehLetraUnica = (n) => /^[A-Za-z#]$/.test(n.trim()) || /\s[A-Z#]$/.test(n.trim()) || /[a-z][A-Z]$/.test(n.trim());
const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory() && !x.name.startsWith(".")).map((x) => x.name); } catch { return []; } };
const arquivosDe = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isFile()).map((x) => x.name); } catch { return []; } };
const tamanho = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const hashDe = (p) => { try { return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex"); } catch { return Math.random().toString(); } };
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const letraDoNome = (nome) => (semAcento(nome).toUpperCase().match(/[A-Z]/) || ["#"])[0];
const palavras = (s) => new Set(nomesDoc.chave(s).split("_").filter((w) => w && !/^\d+$/.test(w) && !["DE", "DA", "DO", "DOS", "DAS", "E"].includes(w)));

// pasta principal -> letras -> associados (mesma regra da lista de conferencia)
function estrutura(raiz) {
  const subs = subdirs(raiz);
  const letras = subs.filter(ehLetraUnica);
  const ehRaiz = letras.length >= 2 && letras.length >= subs.length * 0.6;
  const dirsLetra = ehRaiz ? letras.map((n) => path.join(raiz, n)) : [raiz];
  const socios = [], soltos = [];
  for (const dl of dirsLetra) {
    const nomeL = path.basename(dl).trim();
    const letra = ehRaiz ? nomeL.slice(-1).toUpperCase() : null;
    for (const n of subdirs(dl)) socios.push({ dir: path.join(dl, n), nome: n, dirLetra: dl, letra });
    if (ehRaiz) for (const f of arquivosDe(dl)) soltos.push(path.join(dl, f));
  }
  return { ehRaiz, dirsLetra, socios, soltos, outras: ehRaiz ? subs.filter((n) => !ehLetraUnica(n)) : [] };
}

// nome padrao de um arquivo cujo tipo foi reconhecido pelo nome (ou null se nao reconheceu)
function nomePadrao(cfg, tipos, nomeLogico, titular) {
  const an = nomesDoc.analisar(nomeLogico + ".pdf", tipos, titular);
  if (!an.tipo) return null;
  let comp = an.complemento;
  // complemento so com o nome do proprio titular ("RG MARIA" da Maria) sai; "RG FRENTE", "NASC JOAO" ficam
  if (comp && an.doTitular) { const t = palavras(titular); if ([...palavras(comp)].every((w) => t.has(w))) comp = ""; }
  return { tipo: an.tipo, dono: an.doTitular ? "" : comp, nome: files.montaNomeArquivo(cfg, { tipoSigla: comp ? `${an.tipo.sigla} ${comp}` : an.tipo.sigla }) };
}

function analisar(raiz, cfg) {
  const t0 = Date.now();
  const tipos = [...(cfg.tipos || []), { sigla: cfg.siglaDossie || "DOSSIE COMPLETO", nome: "Dossiê completo" }];
  const maxBytes = (cfg.tamanhoMaxMB || 2) * 1048576;
  const cfgRaiz = Object.assign({}, cfg, { pastaSaida: raiz });
  const itens = [];
  let n = 0;
  const add = (o) => { o.id = "a" + ++n; if (o.marcado === undefined) o.marcado = !!o.acao; itens.push(o); return o; };
  const est = estrutura(raiz);
  const resumo = { socios: est.socios.length, arquivos: 0, bytes: 0, ehRaiz: est.ehRaiz };

  for (const s of est.socios) {
    const rel = path.relative(raiz, s.dir);
    const nomes = arquivosDe(s.dir);
    const sub = subdirs(s.dir);
    resumo.arquivos += nomes.length;
    // --- a pasta ---
    if (!nomes.length && !sub.length) add({ cat: "vazia", acao: "removerPasta", de: s.dir, socio: s.nome, rel, motivo: "pasta sem nenhum arquivo", marcado: false });
    const limpo = s.nome.replace(/\s+/g, " ").trim();
    if (limpo !== s.nome) {
      const para = path.join(s.dirLetra, limpo);
      add({ cat: "nomePasta", acao: "renomearPasta", de: s.dir, para, socio: s.nome, rel, novoNome: limpo, motivo: "espaço sobrando no nome da pasta", marcado: false,
        bloqueado: fs.existsSync(para) ? "já existe uma pasta com o nome certo — junte as duas à mão" : "" });
    }
    if (s.letra && letraDoNome(s.nome) !== s.letra && /[A-Z]/.test(letraDoNome(s.nome))) {
      const certa = letraDoNome(s.nome);
      const dirL = path.join(raiz, files.nomePastaLetra(cfgRaiz, certa));
      const para = path.join(dirL, s.nome);
      add({ cat: "letra", acao: "moverPasta", de: s.dir, para, socio: s.nome, rel, novoNome: path.relative(raiz, para),
        motivo: `começa com ${certa}, mas está na pasta da letra ${s.letra}`, marcado: false,
        bloqueado: fs.existsSync(para) ? "já existe essa pasta na letra certa — junte as duas à mão" : "" });
    }
    // --- os arquivos ---
    const info = nomes.map((nome) => {
      const ext = path.extname(nome).toLowerCase();
      const base = nome.slice(0, nome.length - ext.length);
      const caminho = path.join(s.dir, nome);
      const bytes = tamanho(caminho);
      resumo.bytes += bytes;
      return { nome, ext, base, caminho, bytes, comp: RX_COMP.test(base), parte: RX_PARTE.test(base), logico: base.replace(RX_COMP, "").trim() };
    });
    const pdfs = info.filter((f) => f.ext === ".pdf");
    for (const f of info.filter((f) => f.ext !== ".pdf")) add({ cat: "info", acao: null, de: f.caminho, socio: s.nome, arquivo: f.nome, rel, motivo: "não é PDF" });
    for (const f of pdfs.filter((f) => f.parte)) add({ cat: "info", acao: null, de: f.caminho, socio: s.nome, arquivo: f.nome, rel, motivo: "pedaço de um PDF dividido (não mexo)" });
    const inteiros = pdfs.filter((f) => !f.parte);
    const vaiSair = new Set(); // arquivos que vao pra seguranca
    // 1) original + "_compressed": fica o menor, o outro vai pra seguranca
    const porLogico = new Map();
    for (const f of inteiros) { const k = f.logico.toLowerCase(); if (!porLogico.has(k)) porLogico.set(k, []); porLogico.get(k).push(f); }
    for (const grupo of porLogico.values()) {
      if (grupo.length < 2 || !grupo.some((f) => f.comp)) continue;
      const fica = grupo.slice().sort((a, b) => a.bytes - b.bytes)[0];
      for (const f of grupo) if (f !== fica) {
        vaiSair.add(f.caminho);
        add({ cat: "duplicado", acao: "backup", de: f.caminho, socio: s.nome, arquivo: f.nome, rel, bytes: f.bytes,
          motivo: `cópia de ${fica.nome} (${(fica.bytes / 1048576).toFixed(1).replace(".", ",")} MB) — fica a menor` });
      }
    }
    // 2) arquivos iguais (mesmo tamanho e mesmo conteudo) com nomes diferentes
    const restantes = inteiros.filter((f) => !vaiSair.has(f.caminho));
    const porTam = new Map();
    for (const f of restantes) { if (!porTam.has(f.bytes)) porTam.set(f.bytes, []); porTam.get(f.bytes).push(f); }
    for (const grupo of porTam.values()) {
      if (grupo.length < 2) continue;
      const porHash = new Map();
      for (const f of grupo) { const h = hashDe(f.caminho); if (!porHash.has(h)) porHash.set(h, []); porHash.get(h).push(f); }
      for (const iguais of porHash.values()) {
        if (iguais.length < 2) continue;
        // fica o de nome mais "certo" (reconhecido e sem _compressed)
        const nota = (f) => (nomePadrao(cfg, tipos, f.logico, s.nome) ? 2 : 0) + (f.comp ? 0 : 1);
        const fica = iguais.slice().sort((a, b) => nota(b) - nota(a) || a.nome.length - b.nome.length)[0];
        for (const f of iguais) if (f !== fica) {
          vaiSair.add(f.caminho);
          add({ cat: "duplicado", acao: "backup", de: f.caminho, socio: s.nome, arquivo: f.nome, rel, bytes: f.bytes, motivo: `igualzinho a ${fica.nome}` });
        }
      }
    }
    // 3) nomes: fora do padrao -> renomear; do scanner/sem nome -> ler e sugerir
    const ficam = inteiros.filter((f) => !vaiSair.has(f.caminho));
    for (const f of ficam) {
      const np = nomePadrao(cfg, tipos, f.logico, s.nome);
      if (np) {
        if (np.nome !== f.nome) {
          const tco = /^TCO\b/.test(nomesDoc.chaveArquivo(f.logico));
          add({ cat: "nome", acao: "renomear", de: f.caminho, socio: s.nome, arquivo: f.nome, rel, novoNome: np.nome,
            motivo: f.comp ? "tirar o _compressed e deixar no padrão" : "nome fora do padrão", marcado: !tco,
            nota: tco ? "TCO = termo de compromisso? confira antes" : "" });
        }
      } else if (RX_SCANNER.test(f.logico) || RX_GENERICO.test(f.logico)) {
        add({ cat: "semNome", acao: "renomear", de: f.caminho, socio: s.nome, arquivo: f.nome, rel, novoNome: "", bytes: f.bytes,
          motivo: "arquivo do scanner sem nome", precisaLer: true, marcado: false });
      } else {
        add({ cat: "info", acao: null, de: f.caminho, socio: s.nome, arquivo: f.nome, rel, motivo: "nome que eu não reconheci (deixo como está)" });
      }
      if (f.bytes > maxBytes) {
        add({ cat: "grande", acao: "comprimir", de: f.caminho, socio: s.nome, arquivo: f.nome, rel, bytes: f.bytes,
          motivo: `${(f.bytes / 1048576).toFixed(1).replace(".", ",")} MB (o limite é ${cfg.tamanhoMaxMB || 2} MB)`, marcado: false });
      }
    }
    for (const d of sub) add({ cat: "info", acao: null, de: path.join(s.dir, d), socio: s.nome, rel, motivo: `subpasta "${d}" dentro da pasta do associado` });
  }
  // pastas de associado repetidas (o mesmo nome escrito diferente) — so avisa
  const porChave = new Map();
  for (const s of est.socios) { const k = [...palavras(s.nome)].sort().join(" "); if (!k) continue; if (!porChave.has(k)) porChave.set(k, []); porChave.get(k).push(s); }
  for (const rep of porChave.values()) if (rep.length > 1) {
    add({ cat: "info", acao: null, de: rep[0].dir, socio: rep.map((s) => s.nome).join("  ×  "), rel: path.relative(raiz, rep[0].dir), motivo: "pastas do mesmo associado (junte à mão)" });
  }
  for (const f of est.soltos) add({ cat: "info", acao: null, de: f, arquivo: path.basename(f), rel: path.relative(raiz, f), motivo: "arquivo solto na pasta da letra (fora da pasta de um associado)" });
  resumo.levouMs = Date.now() - t0;
  return { raiz, criadoEm: Date.now(), resumo, itens };
}

// ---- aplicar (so os marcados) ----
// a pasta de seguranca fica do lado da pasta PRINCIPAL (nunca dentro dela: senao apareceria no painel
// como se fosse uma letra), no mesmo disco (mover e instantaneo). Cada arrumacao tem a sua.
function pastaSeguranca(raiz, documentos, principal) {
  const d = new Date(), z = (x) => String(x).padStart(2, "0");
  const carimbo = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}h${z(d.getMinutes())}`;
  const r = path.resolve(raiz), p = principal ? path.resolve(principal) : "";
  const dentroDaPrincipal = p && (r.toLowerCase() === p.toLowerCase() || r.toLowerCase().startsWith(p.toLowerCase() + path.sep));
  const ref = dentroDaPrincipal ? p : r;
  const pai = path.dirname(ref);
  const base = pai && pai !== ref ? path.join(pai, "DigiDoc - backup da arrumacao") : path.join(documentos, "DigiDoc - backup da arrumacao");
  let alvo = path.join(base, carimbo);
  for (let i = 2; fs.existsSync(alvo) && i < 99; i++) alvo = path.join(base, `${carimbo} (${i})`);
  return alvo;
}
// destino dentro da seguranca que nunca cobre outro arquivo
function destinoLivre(para) {
  if (!fs.existsSync(para)) return para;
  const dir = path.dirname(para), nome = livre(dir, path.basename(para));
  return path.join(dir, nome || `${Date.now()}-${path.basename(para)}`);
}
function mover(de, para) {
  fs.mkdirSync(path.dirname(para), { recursive: true });
  try { fs.renameSync(de, para); }
  catch (e) {
    if (e.code !== "EXDEV") throw e;
    // outro disco: copia, confere o tamanho e so entao tira o original
    fs.copyFileSync(de, para);
    if (fs.statSync(para).size !== fs.statSync(de).size) throw new Error("a cópia não ficou igual");
    fs.rmSync(de, { force: true });
  }
}
function livre(dir, nome) {
  if (!fs.existsSync(path.join(dir, nome))) return nome;
  const ext = path.extname(nome), base = nome.slice(0, -ext.length || undefined);
  for (let i = 2; i < 999; i++) { const t = `${base}_${i}${ext}`; if (!fs.existsSync(path.join(dir, t))) return t; }
  return null;
}
function gravarDiario(diario) {
  fs.mkdirSync(diario.seguranca, { recursive: true });
  fs.writeFileSync(path.join(diario.seguranca, DIARIO), JSON.stringify(diario, null, 1));
}

// itens: os marcados (com novoNome ja decidido na tela). Devolve { feitos, pulados, caminhos, diario }
function aplicar(raiz, itens, { documentos, ultimaArq, principal } = {}) {
  const seguranca = pastaSeguranca(raiz, documentos, principal);
  const diario = { em: Date.now(), raiz, seguranca, ops: [] };
  const caminhos = {}; // caminho antigo -> novo (renomeados), pra comprimir depois
  const pastasMovidas = []; // [de, para] das pastas renomeadas/movidas
  const feitos = [], pulados = [];
  const ok = (it, txt) => feitos.push({ id: it.id, txt });
  const pula = (it, txt) => pulados.push({ id: it.id, txt });
  const ordem = { backup: 1, renomear: 2, renomearPasta: 3, moverPasta: 4, removerPasta: 5 };
  const lista = itens.filter((i) => ordem[i.acao]).sort((a, b) => ordem[a.acao] - ordem[b.acao]);
  for (const it of lista) {
    try {
      const de = caminhos[it.de] || it.de;
      if (it.acao === "backup") {
        if (!fs.existsSync(de)) { pula(it, "não existe mais"); continue; }
        const para = destinoLivre(path.join(seguranca, path.relative(raiz, de)));
        mover(de, para); diario.ops.push({ tipo: "mover", de, para }); ok(it, "foi pra pasta de segurança");
      } else if (it.acao === "renomear") {
        const nome = String(it.novoNome || "").trim();
        if (!nome || !/\.pdf$/i.test(nome) || /[<>:"/\\|?*]/.test(nome)) { pula(it, "sem nome novo"); continue; }
        if (!fs.existsSync(de)) { pula(it, "não existe mais"); continue; }
        const dir = path.dirname(de);
        if (path.basename(de) === nome) { pula(it, "já estava com esse nome"); continue; }
        const final = livre(dir, nome);
        if (!final) { pula(it, "não achei um nome livre"); continue; }
        const para = path.join(dir, final);
        mover(de, para); diario.ops.push({ tipo: "mover", de, para }); caminhos[it.de] = para;
        ok(it, final === nome ? `virou ${final}` : `virou ${final} (já existia ${nome})`);
      } else if (it.acao === "renomearPasta" || it.acao === "moverPasta") {
        if (!fs.existsSync(de)) { pula(it, "não existe mais"); continue; }
        if (fs.existsSync(it.para)) { pula(it, "já existe uma pasta com esse nome lá"); continue; }
        const dirPai = path.dirname(it.para);
        if (!fs.existsSync(dirPai)) { fs.mkdirSync(dirPai, { recursive: true }); diario.ops.push({ tipo: "mkdir", dir: dirPai }); }
        fs.renameSync(de, it.para); diario.ops.push({ tipo: "mover", de, para: it.para }); pastasMovidas.push([de, it.para]);
        // arquivos de dentro mudaram de lugar
        for (const k of Object.keys(caminhos)) if (caminhos[k].startsWith(de + path.sep)) caminhos[k] = it.para + caminhos[k].slice(de.length);
        ok(it, it.acao === "moverPasta" ? `foi pra ${path.relative(raiz, it.para)}` : `virou "${path.basename(it.para)}"`);
      } else if (it.acao === "removerPasta") {
        if (!fs.existsSync(de)) { pula(it, "não existe mais"); continue; }
        if (fs.readdirSync(de).length) { pula(it, "não está mais vazia"); continue; }
        fs.rmdirSync(de); diario.ops.push({ tipo: "rmdir", dir: de }); ok(it, "pasta vazia removida");
      }
    } catch (e) { pula(it, e.message); }
  }
  if (diario.ops.length) {
    gravarDiario(diario);
    if (ultimaArq) try { fs.writeFileSync(ultimaArq, JSON.stringify({ arq: path.join(seguranca, DIARIO), em: diario.em, raiz })); } catch {}
  }
  return { feitos, pulados, caminhos, pastasMovidas, seguranca: diario.ops.length ? seguranca : "", diarioArq: diario.ops.length ? path.join(seguranca, DIARIO) : "" };
}

// comprimir um PDF ja gerado de novo (novoTmp) no lugar do original (que vai pra seguranca)
function trocarPorComprimido(diarioArq, raiz, original, novoTmp, { documentos, principal } = {}) {
  let diario;
  try { diario = JSON.parse(fs.readFileSync(diarioArq, "utf8")); } catch { diario = null; }
  if (!diario) {
    const seguranca = pastaSeguranca(raiz, documentos || path.dirname(novoTmp), principal);
    diario = { em: Date.now(), raiz, seguranca, ops: [] };
    diarioArq = path.join(seguranca, DIARIO);
  }
  const para = destinoLivre(path.join(diario.seguranca, path.relative(raiz, original)));
  mover(original, para); diario.ops.push({ tipo: "mover", de: original, para });
  fs.renameSync(novoTmp, original); diario.ops.push({ tipo: "criar", arq: original });
  gravarDiario(diario);
  return diarioArq;
}

// desfazer: refaz o caminho de volta, do ultimo pro primeiro. Nada e apagado (o comprimido novo vai
// pra uma subpasta "desfeito" da seguranca)
function desfazer(diarioArq) {
  const diario = JSON.parse(fs.readFileSync(diarioArq, "utf8"));
  if (diario.desfeito) return { ok: false, msg: "essa arrumação já foi desfeita" };
  let voltou = 0; const falhas = [];
  for (const op of diario.ops.slice().reverse()) {
    try {
      if (op.tipo === "mover") {
        if (!fs.existsSync(op.para)) { falhas.push(`${path.basename(op.para)}: não está mais lá`); continue; }
        if (fs.existsSync(op.de)) { falhas.push(`${path.basename(op.de)}: já existe outro no lugar`); continue; }
        mover(op.para, op.de); voltou++;
      } else if (op.tipo === "criar") {
        if (fs.existsSync(op.arq)) mover(op.arq, path.join(diario.seguranca, "desfeito", path.relative(diario.raiz, op.arq)));
      } else if (op.tipo === "rmdir") { fs.mkdirSync(op.dir, { recursive: true }); voltou++; }
      else if (op.tipo === "mkdir") { try { if (!fs.readdirSync(op.dir).length) fs.rmdirSync(op.dir); } catch {} }
    } catch (e) { falhas.push(e.message); }
  }
  diario.desfeito = Date.now();
  try { fs.writeFileSync(diarioArq, JSON.stringify(diario, null, 1)); } catch {}
  return { ok: true, voltou, falhas };
}

module.exports = { analisar, aplicar, desfazer, trocarPorComprimido, nomePadrao, _estrutura: estrutura };
