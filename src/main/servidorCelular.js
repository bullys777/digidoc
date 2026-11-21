"use strict";
// Servidor local (rede/Wi-Fi) que serve uma pagina de captura pro celular.
// As fotos vao direto do celular pro PC, sem internet, sem servidor de fora.
// Protegido por um token aleatorio na URL.
const http = require("http");
const os = require("os");
const crypto = require("crypto");

let servidor = null;
let token = "";
let onFoto = null;

function ipLocal() {
  const ifaces = os.networkInterfaces();
  const candidatos = [];
  for (const nome of Object.keys(ifaces)) {
    for (const i of ifaces[nome]) {
      if (i.family === "IPv4" && !i.internal) {
        // prioriza redes privadas comuns
        const score = /^192\.168\./.test(i.address) ? 3 : /^10\./.test(i.address) ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(i.address) ? 2 : 1;
        candidatos.push({ ip: i.address, score });
      }
    }
  }
  candidatos.sort((a, b) => b.score - a.score);
  return candidatos.length ? candidatos[0].ip : null;
}

function pagina() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>DigiDoc — enviar fotos</title><style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0f1115;color:#fff;padding:16px 16px 40px;max-width:640px;margin:0 auto}
header{text-align:center;margin-bottom:10px}
h1{font-size:20px;margin:6px 0 2px}.sub{color:#9aa0a8;font-size:13px;margin:0}
.badge{display:inline-block;background:#1f9d57;color:#fff;border-radius:999px;padding:3px 12px;font-weight:700;font-size:13px;margin-top:8px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:0;border-radius:16px;padding:18px;font-size:18px;font-weight:700;margin:9px 0;color:#fff}
.cam{background:#2f6feb}.gal{background:#2a2d33}
.dica{background:#1b1d22;border:1px solid #2a2d33;border-radius:12px;padding:12px;font-size:13px;color:#c7ccd3;margin:10px 0}
input[type=file]{display:none}
#status{margin:12px 0;font-size:15px;font-weight:600;min-height:22px;text-align:center}
#lista{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.item{position:relative;border-radius:10px;overflow:hidden;background:#2a2d33;aspect-ratio:3/4}
.item img{width:100%;height:100%;object-fit:cover}
.ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800}
.ov.send{background:rgba(0,0,0,.45);font-size:14px}
.ov.ok{background:rgba(31,157,87,.45)}
.ov.err{background:rgba(209,53,44,.55);font-size:13px;flex-direction:column;cursor:pointer}
.sp{width:22px;height:22px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:g .8s linear infinite}
@keyframes g{to{transform:rotate(360deg)}}
footer{text-align:center;color:#5a6572;font-size:12px;margin-top:22px}
</style></head><body>
<header>
  <h1>📄 DigiDoc</h1><p class="sub">Envie as fotos dos documentos pro PC</p>
  <div class="badge" id="badge">0 enviadas</div>
</header>
<label class="btn cam">📸 Tirar / adicionar fotos<input type="file" accept="image/*" multiple id="fmain"></label>
<label class="btn gal">🖼 Escolher várias da galeria<input type="file" accept="image/*" multiple id="fgal"></label>
<div class="dica">Para mandar <b>várias de uma vez</b>: tire as fotos no app <b>Câmera</b> normalmente e depois toque em <b>“Escolher várias da galeria”</b> e selecione todas.</div>
<div id="status"></div>
<div id="lista"></div>
<footer>DigiDoc · desenvolvido por Otavio Martins · rede local</footer>
<script>
const T=new URLSearchParams(location.search).get("t")||"";
let enviadas=0;
const lista=document.getElementById("lista"),status=document.getElementById("status"),badge=document.getElementById("badge");
function setStatus(txt,cor){status.textContent=txt;status.style.color=cor||"#35c074";}
async function enviar(file,cel){
  if(!cel){cel=document.createElement("div");cel.className="item";const img=document.createElement("img");img.src=URL.createObjectURL(file);cel.appendChild(img);lista.prepend(cel);}
  let ov=cel.querySelector(".ov");if(ov)ov.remove();
  ov=document.createElement("div");ov.className="ov send";ov.innerHTML='<div class="sp"></div>';cel.appendChild(ov);
  try{
    const r=await fetch("/up?t="+encodeURIComponent(T)+"&n="+encodeURIComponent(file.name||"foto.jpg"),{method:"POST",headers:{"Content-Type":file.type||"image/jpeg"},body:file});
    if(!r.ok)throw 0;
    ov.className="ov ok";ov.textContent="✓";
    enviadas++;badge.textContent=enviadas+" enviada"+(enviadas>1?"s":"");
    setStatus("Enviada! Pode continuar.");
  }catch(e){
    ov.className="ov err";ov.innerHTML="⚠<span style='font-size:11px'>toque p/ repetir</span>";
    ov.onclick=()=>enviar(file,cel);
    setStatus("Erro ao enviar. O PC está na mesma rede? Toque na foto pra repetir.","#f1685e");
  }
}
function trata(inp){inp.addEventListener("change",()=>{[...inp.files].forEach(f=>enviar(f));inp.value="";});}
trata(document.getElementById("fmain"));trata(document.getElementById("fgal"));
</script></body></html>`;
}

function iniciar(cb, porta = 8713) {
  return new Promise((resolve, reject) => {
    if (servidor) return resolve(infoAtual());
    onFoto = cb;
    token = crypto.randomBytes(8).toString("hex");
    servidor = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.searchParams.get("t") !== token) { res.writeHead(403); return res.end("acesso negado"); }
      if (req.method === "GET" && u.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(pagina());
      }
      if (req.method === "POST" && u.pathname === "/up") {
        const chunks = []; let tam = 0;
        req.on("data", (c) => { tam += c.length; if (tam > 25 * 1024 * 1024) req.destroy(); else chunks.push(c); });
        req.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (onFoto && buf.length) onFoto(buf, u.searchParams.get("n") || "foto.jpg");
          res.writeHead(200); res.end("ok");
        });
        req.on("error", () => { try { res.writeHead(500); res.end(); } catch {} });
        return;
      }
      res.writeHead(404); res.end();
    });
    servidor.on("error", (e) => { servidor = null; reject(e); });
    servidor.listen(porta, "0.0.0.0", () => resolve(infoAtual()));
  });
}

function infoAtual() {
  const ip = ipLocal();
  const porta = servidor.address().port;
  return { ip, porta, url: ip ? `http://${ip}:${porta}/?t=${token}` : null, token };
}

function parar() {
  if (servidor) { try { servidor.close(); } catch {} servidor = null; onFoto = null; }
}

module.exports = { iniciar, parar, ipLocal };
