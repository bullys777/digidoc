// Pos-build do DigiDoc (desenvolvido por Otavio Martins): roda depois do "electron-builder --win dir".
// 1) gera o manifesto (lista exata dos arquivos do programa) usado pelo desinstalador
// 2) garante uma copia local do NAPS2 (motor do scanner)
// 3) cria DigiDoc-instalar.zip (programa + naps2) pro instalador do pendrive
// 4) compila o lancador DigiDoc.exe da raiz do pendrive
// 6) cria DigiDoc-Setup.exe (instalador de um arquivo so), DigiDoc-app-<versao>.zip e latest.json
//    (a atualizacao automatica pelo GitHub usa esses tres)
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const DIST = path.join(RAIZ, "dist");
const APP = path.join(DIST, "win-unpacked");
const MANIFESTO = "digidoc-arquivos.txt";
const NAPS2_URL = "https://github.com/cyanfish/naps2/releases/download/v8.5.1/naps2-8.5.1-win-x64.zip";
const NAPS2_DIR = path.join(DIST, "naps2-cache", "naps2");

// o que o app cria quando roda (config, PDFs, marca de instalacao) NUNCA entra no pacote:
// um teste feito em dist/win-unpacked nao pode vazar documento pro pendrive (LGPD)
const DE_USO = new Set(["digitalizador-config.json", "Digitalizado", "digidoc-instalado.txt"]);
const ehDeUso = (rel) => DE_USO.has(rel.split(path.sep)[0]) || rel.endsWith(".salvando");

// novidades da versao (secao "## <versao>" do NOVIDADES.md, uma por linha comecando com "-")
function lerNovidades(versao) {
  try {
    const t = fs.readFileSync(path.join(RAIZ, "NOVIDADES.md"), "utf8").replace(/\r/g, "");
    const partes = t.split(/^## /m);
    const sec = partes.find((p) => p.split("\n")[0].trim().replace(/^v/, "").startsWith(versao));
    return sec ? sec.split("\n").slice(1).filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, "").trim()) : [];
  } catch { return []; }
}

function ps(cmd, env) {
  return execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { stdio: "inherit", env: Object.assign({}, process.env, env || {}) });
}

function baixar(url, dest, n = 0) {
  return new Promise((ok, erro) => {
    if (n > 6) return erro(new Error("muitos redirecionamentos"));
    https.get(url, { headers: { "User-Agent": "DigiDoc-build" } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) { r.resume(); return baixar(r.headers.location, dest, n + 1).then(ok, erro); }
      if (r.statusCode !== 200) { r.resume(); return erro(new Error("HTTP " + r.statusCode)); }
      const f = fs.createWriteStream(dest); r.pipe(f); f.on("finish", () => f.close(ok)); f.on("error", erro);
    }).on("error", erro);
  });
}

(async () => {
  if (!fs.existsSync(path.join(APP, "DigiDoc.exe"))) throw new Error("rode o electron-builder antes (dist/win-unpacked nao existe)");

  // 1) manifesto: arquivos e depois pastas (mais fundas primeiro, com "\" no fim)
  const arqs = [], pastas = [], ignorados = [];
  (function andar(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name), r = path.relative(APP, f);
      if (ehDeUso(r)) { ignorados.push(r); continue; }
      if (e.isDirectory()) { pastas.push(r); andar(f); } else if (r !== MANIFESTO) arqs.push(r);
    }
  })(APP);
  if (ignorados.length) console.log("AVISO: ficaram FORA do pacote (arquivos de uso/teste):", ignorados.join(", "));
  pastas.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  fs.writeFileSync(path.join(APP, MANIFESTO), arqs.concat(pastas.map((p) => p + "\\")).join("\r\n") + "\r\n", "utf8");
  console.log(`manifesto: ${arqs.length} arquivos, ${pastas.length} pastas`);

  // 2) NAPS2 local
  if (!fs.existsSync(path.join(NAPS2_DIR, "App", "NAPS2.Console.exe"))) {
    fs.mkdirSync(NAPS2_DIR, { recursive: true });
    const zip = path.join(DIST, "naps2-cache", "naps2.zip");
    if (!fs.existsSync(zip)) { console.log("baixando NAPS2..."); await baixar(NAPS2_URL, zip); }
    console.log("extraindo NAPS2...");
    ps("Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:Z, $env:D)", { Z: zip, D: NAPS2_DIR });
  }

  // 3) zip de instalacao = programa + naps2
  const stage = path.join(DIST, "_stage");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(APP, stage, { recursive: true, filter: (src) => { const r = path.relative(APP, src); return !r || !ehDeUso(r); } });
  fs.cpSync(NAPS2_DIR, path.join(stage, "naps2"), { recursive: true });
  const zipFinal = path.join(DIST, "DigiDoc-instalar.zip");
  fs.rmSync(zipFinal, { force: true });
  console.log("criando DigiDoc-instalar.zip...");
  ps("Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:S, $env:Z, [IO.Compression.CompressionLevel]::Optimal, $false)", { S: stage, Z: zipFinal });
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`zip: ${(fs.statSync(zipFinal).size / 1048576).toFixed(1)} MB`);

  // 4) lancador da raiz do pendrive
  const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  const lanc = path.join(DIST, "DigiDoc-lancador.exe");
  execFileSync(csc, ["/nologo", "/target:winexe", "/codepage:65001", "/optimize+",
    "/win32icon:" + path.join(RAIZ, "build", "icon.ico"), "/out:" + lanc,
    "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", path.join(__dirname, "lancador.cs")], { stdio: "inherit" });
  console.log(`lancador: ${(fs.statSync(lanc).size / 1024).toFixed(0)} KB`);

  // 6) atualizacao automatica + instalador de um arquivo so
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  const versao = pkg.version;
  const versaoElectron = JSON.parse(fs.readFileSync(path.join(RAIZ, "node_modules", "electron", "package.json"), "utf8")).version;
  for (const f of fs.readdirSync(DIST)) if (/^DigiDoc-app-.*\.zip$/.test(f)) fs.rmSync(path.join(DIST, f), { force: true });

  // 6a) pacote leve: so resources\ (o programa) + a lista de arquivos. Serve quando o Electron nao muda.
  const stageApp = path.join(DIST, "_stage_app");
  fs.rmSync(stageApp, { recursive: true, force: true });
  fs.mkdirSync(stageApp, { recursive: true });
  fs.cpSync(path.join(APP, "resources"), path.join(stageApp, "resources"), { recursive: true });
  fs.copyFileSync(path.join(APP, MANIFESTO), path.join(stageApp, MANIFESTO));
  const nomeAppZip = `DigiDoc-app-${versao}.zip`;
  const appZip = path.join(DIST, nomeAppZip);
  console.log(`criando ${nomeAppZip}...`);
  ps("Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:S, $env:Z, [IO.Compression.CompressionLevel]::Optimal, $false)", { S: stageApp, Z: appZip });
  fs.rmSync(stageApp, { recursive: true, force: true });

  // 6b) DigiDoc-Setup.exe: instalador com o zip completo (programa + naps2) embutido
  const setup = path.join(DIST, "DigiDoc-Setup.exe");
  const versaoTxt = path.join(DIST, "versao.txt");
  fs.writeFileSync(versaoTxt, versao, "utf8");
  console.log("compilando DigiDoc-Setup.exe...");
  execFileSync(csc, ["/nologo", "/target:winexe", "/codepage:65001", "/optimize+",
    "/win32icon:" + path.join(RAIZ, "build", "icon.ico"), "/out:" + setup,
    "/resource:" + zipFinal + ",DigiDoc.zip", "/resource:" + versaoTxt + ",versao.txt",
    "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
    "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", path.join(__dirname, "instalador.cs")], { stdio: "inherit" });
  fs.rmSync(versaoTxt, { force: true });

  // 6c) latest.json: o que o DigiDoc instalado le pra saber se tem versao nova
  const sha = (p) => require("crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const info = {
    versao, electron: versaoElectron, data: new Date().toISOString().slice(0, 10),
    notas: lerNovidades(versao),
    app: { arquivo: nomeAppZip, bytes: fs.statSync(appZip).size, sha256: sha(appZip) },
    instalador: { arquivo: "DigiDoc-Setup.exe", bytes: fs.statSync(setup).size, sha256: sha(setup) },
  };
  fs.writeFileSync(path.join(DIST, "latest.json"), JSON.stringify(info, null, 2), "utf8");
  console.log(`versao ${versao}: app ${(info.app.bytes / 1048576).toFixed(1)} MB, instalador ${(info.instalador.bytes / 1048576).toFixed(1)} MB`);

  // 5) .bat do pendrive sempre em CRLF + ASCII (o cmd do Windows quebra com LF)
  for (const nome of ["INSTALAR DigiDoc no PC.bat", "DESINSTALAR DigiDoc do PC.bat", "COMO_USAR.txt"]) {
    const p = path.join(RAIZ, nome);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    fs.writeFileSync(p, nome.endsWith(".bat") ? Buffer.from(t, "latin1") : t);
  }
  console.log("PRONTO");
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
