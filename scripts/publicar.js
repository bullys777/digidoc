// Publica uma versao nova do DigiDoc no GitHub (desenvolvido por Otavio Martins).
// Todo DigiDoc instalado ve o aviso "Nova versao" e se atualiza sozinho.
//
// Antes de rodar:
//   1) suba a "version" no package.json (ex.: 0.3.0 -> 0.3.1)
//   2) escreva as novidades em NOVIDADES.md, numa secao "## 0.3.1"
//   3) faca o commit
// Depois:  npm run publicar          (ou: node scripts/publicar.js --sem-build, se ja buildou)
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const DIST = path.join(RAIZ, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
const versao = pkg.version;
const repo = pkg.digidoc && pkg.digidoc.repositorio;

function acharGh() {
  const cands = [process.env.GH_PATH, path.join(process.env.LOCALAPPDATA || "", "Programs", "gh-cli", "bin", "gh.exe"), "gh"].filter(Boolean);
  for (const c of cands) { try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch {} }
  throw new Error("GitHub CLI (gh) nao encontrado");
}
const roda = (cmd, args, opts = {}) => execFileSync(cmd, args, Object.assign({ cwd: RAIZ, stdio: "inherit" }, opts));

(async () => {
  if (!repo || repo.startsWith("DONO/")) throw new Error('configure "digidoc.repositorio" no package.json (ex.: usuario/digidoc)');
  const gh = acharGh();

  // a versao ja foi publicada?
  const existe = spawnSync(gh, ["release", "view", "v" + versao, "--repo", repo], { cwd: RAIZ, stdio: "ignore" }).status === 0;
  if (existe) throw new Error(`a versao ${versao} ja esta publicada. Suba a "version" no package.json.`);

  // nada de commit pendente (o que vai pro ar tem que estar no GitHub tambem)
  const pendente = execFileSync("git", ["status", "--porcelain"], { cwd: RAIZ, encoding: "utf8" }).trim();
  if (pendente) throw new Error("tem alteracoes sem commit:\n" + pendente);

  if (!process.argv.includes("--sem-build")) {
    console.log(`\n=== build da versao ${versao} ===`);
    const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
    roda(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dist"], { env, shell: true });
  }

  const info = JSON.parse(fs.readFileSync(path.join(DIST, "latest.json"), "utf8"));
  if (info.versao !== versao) throw new Error(`dist/latest.json e da versao ${info.versao}, nao ${versao}: rode sem --sem-build`);
  const arquivos = [path.join(DIST, info.instalador.arquivo), path.join(DIST, info.app.arquivo), path.join(DIST, "latest.json")];
  for (const a of arquivos) if (!fs.existsSync(a)) throw new Error("faltou " + a);

  console.log("\n=== enviando o codigo ===");
  roda("git", ["push"]);

  const notas = [
    `## DigiDoc ${versao}`, "",
    ...(info.notas.length ? info.notas.map((n) => "- " + n) : ["- Melhorias e correcoes"]), "",
    "### Como instalar",
    "Baixe o **DigiDoc-Setup.exe** aqui embaixo (em *Assets*) e de dois cliques.",
    "Se o Windows mostrar \"O Windows protegeu o computador\", clique em **Mais informacoes** > **Executar assim mesmo**.", "",
    "Quem ja tem o DigiDoc instalado recebe esta versao sozinho (aparece o aviso verde embaixo da tela).",
  ].join("\n");
  const arqNotas = path.join(DIST, "notas-release.md");
  fs.writeFileSync(arqNotas, notas, "utf8");

  console.log("\n=== criando o release no GitHub (envia ~" + Math.round(arquivos.reduce((n, a) => n + fs.statSync(a).size, 0) / 1048576) + " MB) ===");
  roda(gh, ["release", "create", "v" + versao, ...arquivos, "--repo", repo, "--title", "DigiDoc " + versao, "--notes-file", arqNotas, "--latest"]);
  console.log(`\nPRONTO: https://github.com/${repo}/releases/tag/v${versao}`);
})().catch((e) => { console.error("\nERRO:", e.message); process.exit(1); });
