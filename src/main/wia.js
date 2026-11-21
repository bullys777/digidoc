"use strict";
// Scanners WIA (USB, ou de rede instalados no Windows): o que cada um tem (vidro, alimentador,
// frente e verso) e se tem papel no alimentador agora. Usa o WIA do proprio Windows pelo
// PowerShell 5.1 — sem programa extra. Se travar ou estiver bloqueado, devolve [] (o app segue
// no modo "tentar o alimentador e, se estiver vazio, o vidro").
const { spawn } = require("child_process");
const path = require("path");

// Propriedades WIA (raiz do aparelho): 3086 = o que ele suporta, 3087 = estado agora.
// 3086: 1 = alimentador, 2 = vidro, 4 = frente e verso, 0x20 = consegue ver papel no alimentador
// 3087: 1 = alimentador com papel (so vale "sem papel" se o aparelho disser que consegue ver)
// Sem a 3086, fica "nao sei" (o NAPS2 confere antes de puxar papel).
// Cada aparelho sai numa linha JSON assim que e lido (se um travar, os anteriores ja chegaram).
function scriptPs(somenteId) {
  const id = String(somenteId || "").replace(/\0/g, "").replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
$SomenteId = '${id}'
function Saida($o) {
  $j = $o | ConvertTo-Json -Compress
  $j = [regex]::Replace($j, '[^\\x00-\\x7F]', { param($m) '\\u{0:x4}' -f [int][char]$m.Value })
  [Console]::Out.WriteLine($j); [Console]::Out.Flush()
}
try { $dm = New-Object -ComObject WIA.DeviceManager } catch { exit 3 }
foreach ($di in @($dm.DeviceInfos)) {
  try {
    if ([int]$di.Type -ne 1) { continue }
    $devId = [string]$di.DeviceID
    if ($SomenteId -and $devId -ne $SomenteId) { continue }
    $nome = ''
    foreach ($p in $di.Properties) { if ([int]$p.PropertyID -eq 7) { $nome = [string]$p.Value } }
    $r = [ordered]@{ id = $devId; nome = $nome; alimentador = $null; vidro = $null; duplex = $null; papel = $null; erro = $null }
    try {
      $dev = $di.Connect()
      $cap = $null; $est = $null
      foreach ($p in $dev.Properties) {
        $idp = [int]$p.PropertyID
        if ($idp -eq 3086) { $cap = [int]$p.Value } elseif ($idp -eq 3087) { $est = [int]$p.Value }
      }
      if ($null -ne $cap) {
        $r.alimentador = (($cap -band 1) -ne 0); $r.vidro = (($cap -band 2) -ne 0); $r.duplex = (($cap -band 4) -ne 0)
        if ($r.alimentador -and $null -ne $est) {
          if (($est -band 1) -ne 0) { $r.papel = $true } elseif (($cap -band 0x20) -ne 0) { $r.papel = $false }
        }
      }
    } catch { $r.erro = [string]$_.Exception.Message }
    Saida $r
  } catch {}
}
Saida @{ fim = $true }
exit 0
`;
}

const POWERSHELL = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

// roda o script e junta as linhas JSON; passado o tempo, mata o PowerShell e fica com o que chegou.
// completo = o script chegou ao fim (sem ele, "nao achei o aparelho" nao quer dizer nada)
function rodar(somenteId, tempoMs, cancelado = () => false) {
  return new Promise((resolve) => {
    // texto puro no -Command (sem base64 nem "Bypass": isso parece malware pros antivirus de empresa;
    // politica de execucao nao vale pra -Command)
    let p;
    try {
      p = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", scriptPs(somenteId)], { windowsHide: true });
    } catch { resolve({ itens: [], completo: false }); return; }
    const partes = [];
    let fim = false;
    const terminar = () => {
      if (fim) return; fim = true; clearTimeout(t); clearInterval(c);
      const itens = [];
      let completo = false;
      for (const l of Buffer.concat(partes).toString("utf8").split(/\r?\n/)) {
        const s = l.trim();
        if (!s.startsWith("{")) continue;
        try { const o = JSON.parse(s); if (o.fim === true) completo = true; else itens.push(o); } catch {}
      }
      resolve({ itens, completo });
    };
    const parar = () => { try { p.kill(); } catch {} terminar(); };
    const t = setTimeout(parar, tempoMs);
    const c = setInterval(() => { if (cancelado()) parar(); }, 500);
    p.stdout.on("data", (d) => partes.push(d));
    p.on("error", terminar);
    p.on("close", terminar);
  });
}

// todos os scanners WIA: [{ id, nome, alimentador, vidro, duplex, papel, erro }]
async function listar(tempoMs = 12000, cancelado) { return (await rodar("", tempoMs, cancelado)).itens; }
// idem, dizendo se a lista veio inteira (completo) ou cortada pelo tempo
function listarTudo(tempoMs = 12000, cancelado) { return rodar("", tempoMs, cancelado); }

// so um aparelho (pra conferir e ver o papel na hora de escanear):
// { ...dados } | { ausente: true } (o WIA respondeu e ele nao esta conectado) | null (nao deu pra saber)
async function ler(id, tempoMs = 8000) {
  if (!id) return null;
  const r = await rodar(id, tempoMs);
  const d = r.itens.find((x) => x.id === id);
  if (d) return d;
  return r.completo ? { ausente: true } : null;
}

module.exports = { listar, listarTudo, ler, scriptPs };
