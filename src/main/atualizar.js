"use strict";
// Atualizacao automatica pelo GitHub (releases do repositorio publico).
// Cada release tem:
//   latest.json                  -> { versao, electron, notas[], app:{arquivo,sha256,bytes}, instalador:{arquivo,sha256,bytes} }
//   DigiDoc-app-<versao>.zip     -> so a pasta resources\ (o programa em si, ~dezenas de MB)
//   DigiDoc-Setup.exe            -> instalador completo (programa + motor do scanner)
// Se o Electron da versao nova for o mesmo deste DigiDoc, baixa so o pacote "app" e troca a pasta
// resources\ depois de fechar. Se mudou, baixa o instalador e roda ele em silencio na mesma pasta.
// A config, a pasta Digitalizado e o motor do scanner (naps2) nunca sao tocados.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");

let pacote = {};
try { pacote = require("../../package.json"); } catch {}
const REPO = (pacote.digidoc && pacote.digidoc.repositorio) || "";
const URL_INFO = REPO ? `https://github.com/${REPO}/releases/latest/download/latest.json` : "";
const URL_PAGINA = REPO ? `https://github.com/${REPO}/releases/latest` : "";

// "0.10.2" > "0.9.9"
function maisNova(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x) || 0), pb = String(b).split(/[.-]/).map((x) => parseInt(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

async function buscarJson(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { signal: ctl.signal, headers: { "User-Agent": "DigiDoc", "Cache-Control": "no-cache" }, redirect: "follow" });
    if (r.status === 404) { const e = new Error("Ainda não há nenhuma versão publicada."); e.semRelease = true; throw e; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

let ultimaInfo = null;
async function procurar(versaoAtual) {
  if (!URL_INFO) return { erro: "Atualização automática não configurada nesta cópia." };
  try {
    const info = await buscarJson(URL_INFO);
    ultimaInfo = info;
    return {
      nova: maisNova(info.versao, versaoAtual), versao: info.versao, atual: versaoAtual,
      notas: Array.isArray(info.notas) ? info.notas : [], data: info.data || "",
      leve: info.electron === process.versions.electron && !!info.app,
      bytes: info.electron === process.versions.electron && info.app ? info.app.bytes : info.instalador && info.instalador.bytes,
      pagina: URL_PAGINA,
    };
  } catch (e) {
    return { erro: e.semRelease ? e.message : e.name === "AbortError" ? "Sem resposta do GitHub (internet lenta ou bloqueada)." : "Não consegui procurar: " + e.message };
  }
}

// baixa com progresso e confere o sha256
async function baixar(url, destino, sha256, onProgresso) {
  const r = await fetch(url, { headers: { "User-Agent": "DigiDoc" }, redirect: "follow" });
  if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
  const total = parseInt(r.headers.get("content-length")) || 0;
  const hash = crypto.createHash("sha256");
  const f = fs.createWriteStream(destino);
  let feito = 0, ultimoAviso = 0;
  try {
    for await (const pedaco of r.body) {
      const b = Buffer.from(pedaco);
      hash.update(b); feito += b.length;
      if (!f.write(b)) await new Promise((ok) => f.once("drain", ok));
      if (onProgresso && Date.now() - ultimoAviso > 250) { ultimoAviso = Date.now(); onProgresso(feito, total); }
    }
  } finally { await new Promise((ok) => f.end(ok)); }
  if (onProgresso) onProgresso(feito, total);
  const h = hash.digest("hex");
  if (sha256 && h.toLowerCase() !== String(sha256).toLowerCase()) throw new Error("o arquivo baixado veio corrompido (confira a internet e tente de novo)");
}

function extrair(zip, dest) {
  return new Promise((ok, erro) => {
    execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      "Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:Z, $env:D)"],
      { windowsHide: true, env: Object.assign({}, process.env, { Z: zip, D: dest }), timeout: 10 * 60000 },
      (e) => (e ? erro(new Error("não consegui abrir o pacote baixado")) : ok()));
  });
}

// junta a lista de arquivos do programa antiga com a nova (o desinstalador continua achando tudo)
function juntarManifesto(baseDir, novaPasta, nome) {
  try {
    const ler = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []);
    const novo = ler(path.join(novaPasta, nome));
    if (!novo.length) return;
    const todos = [...new Set([...novo, ...ler(path.join(baseDir, nome))])];
    const arqs = todos.filter((l) => !/[\\/]$/.test(l));
    const pastas = todos.filter((l) => /[\\/]$/.test(l)).sort((a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length);
    fs.writeFileSync(path.join(novaPasta, nome), arqs.concat(pastas).join("\r\n") + "\r\n", "utf8");
  } catch {}
}

// prepara a atualizacao e devolve uma funcao que, chamada, fecha o app e aplica
async function preparar({ baseDir, exe, podeInstalador, manifesto }, onProgresso) {
  const info = ultimaInfo;
  if (!info) throw new Error("procure a atualização primeiro");
  const base = `https://github.com/${REPO}/releases/download/v${info.versao}/`;
  const tmp = path.join(os.tmpdir(), "digidoc-atualizacao-" + info.versao);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const pid = process.pid;
  const L = ["@echo off", "chcp 65001 >nul", ":esperar",
    `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul && (ping -n 2 127.0.0.1 >nul & goto esperar)`,
    "ping -n 2 127.0.0.1 >nul"];

  if (info.electron === process.versions.electron && info.app) {
    // atualizacao leve: troca so a pasta resources
    const zip = path.join(tmp, info.app.arquivo);
    await baixar(base + info.app.arquivo, zip, info.app.sha256, (f, t) => onProgresso && onProgresso("baixando", f, t || info.app.bytes));
    onProgresso && onProgresso("preparando", 0, 0);
    const pasta = path.join(tmp, "novo");
    await extrair(zip, pasta);
    if (!fs.existsSync(path.join(pasta, "resources", "app.asar"))) throw new Error("o pacote baixado está incompleto");
    juntarManifesto(baseDir, pasta, manifesto);
    fs.rmSync(zip, { force: true });
    L.push(`robocopy "${pasta}" "${baseDir}" /E /R:15 /W:1 /NFL /NDL /NJH /NJS /NP >nul`);
    L.push(`if errorlevel 8 (echo A atualizacao nao terminou. Feche o DigiDoc e tente de novo. > "${path.join(baseDir, "digidoc-atualizacao-falhou.txt")}") else (del /f /q "${path.join(baseDir, "digidoc-atualizacao-falhou.txt")}" >nul 2>&1)`);
  } else {
    if (!podeInstalador) throw new Error("esta versão precisa do instalador completo: baixe o DigiDoc-Setup.exe em " + URL_PAGINA);
    const setup = path.join(tmp, info.instalador.arquivo);
    await baixar(base + info.instalador.arquivo, setup, info.instalador.sha256, (f, t) => onProgresso && onProgresso("baixando", f, t || info.instalador.bytes));
    L.push(`"${setup}" /S /D="${baseDir}"`);
  }
  L.push(`start "" "${exe}"`);
  L.push(`cd /d "%TEMP%"`, `rmdir /s /q "${tmp}" >nul 2>&1`, `(goto) 2>nul & del "%~f0"`);
  const bat = path.join(os.tmpdir(), `digidoc_atualizar_${pid}.bat`);
  fs.writeFileSync(bat, L.join("\r\n") + "\r\n", "utf8");
  return () => spawn("cmd.exe", ["/c", bat], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

module.exports = { procurar, preparar, maisNova, URL_PAGINA, REPO };
