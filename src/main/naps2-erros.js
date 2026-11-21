"use strict";
// Classificador da saida do NAPS2.Console 8.5.1 (textos EN + pt-BR + pt-PT).
// Tolerante a maiusculas, acentos e "mojibake" (o .NET escreve o stdout na pagina de
// codigo do console oculto = CP850 neste PC; Node decodifica como UTF-8 por padrao).

// CP850, bytes 0x80..0xFF (gerado com [Text.Encoding]::GetEncoding(850)).
const CP850_ALTO =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" +
  "áíóúñÑªº¿®¬½¼¡«»" +
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" +
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" +
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" +
  "­±‗¾¶§÷¸°¨·¹³²■ ";

// Junte os chunks com Buffer.concat e decodifique UMA vez (nao use `out += d`).
function decodificarSaida(buf) {
  if (!buf || !buf.length) return "";
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { /* nao e UTF-8 */ }
  let s = "";
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP850_ALTO[b - 0x80];
  return s;
}

function normalizar(txt) {
  return String(txt || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // tira acentos
    .replace(/[‘’´`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// "~" marca uma letra acentuada: casa com ela, com o lixo que ela vira
// (U+FFFD, "Ã£", "?", etc.) ou com nada.
const R = (src) => new RegExp(src.replace(/~/g, "\\S{0,3}"), "i");

// ORDEM IMPORTA: especifico antes do generico. Ex.: o texto pt-BR de "nao suporta
// alimentador" contem "alimentador", e quase todo erro vem seguido de
// "No scanned pages to export.".
const REGRAS = [
  ["sem_alimentador", R("does not support using a feeder|suporta o uso de alimentador|n~o possui um alimentador")],
  ["sem_duplex", R("does not support using duplex|suporta o uso duplex|permite digitaliza~~o em frente e verso")],
  ["tampa_aberta", R("cover is open|tampa d[oa] .{0,40}aberta|scanneradfhatchopen|adfdooropen|twain error: ?interlock")],
  ["atolado", R("paper jam|atolamento|papel encravado|twain error: ?paperdoublefeed|scanneradfmispick|scanneradfmultipick")],
  ["sem_papel", R("no pages are in the feeder|sem papel no alimentador|existem folhas no alimentador|twain error: ?nomedia|wia error code 80210003")],
  ["ocupado", R("scanner is busy|est~ ocupado|warming up|est~ aquecendo|est~ a aquecer|does not indicate success: 503\\b|twain session open error: ?busy|scannerlocked")],
  ["offline", R(
    "is offline|est~ offline|est~ desligado|communication with the scanning device was interrupted|" +
    "comunica~~o com (o )?(scanner|digitalizador) foi interrompida|connection may have been interrupted|" +
    "error occurred while sending the request|httpclient\\.timeout|actively refused|recusou ativamente|" +
    "did not properly respond|n~o respondeu corretamente|unreachable (host|network)|host inacess|rede inacess|" +
    "no such host|host n~o ~ conhecido|forcibly closed|pelo host remoto|dead network|rede inoperante|" +
    "wia error code 80210005|wia error code 8021000a")],
  ["sem_dispositivo", R(
    "no device was specified|selected scanner could not be found|no scanning device was found|" +
    "no device selected|no devices found|escolhido n~o foi encontrado|nenhum scanner (foi encontrado|escolhido)|" +
    "n~o foi encontrado um digitalizador|nenhum dispositivo selecionado|wia error code 80210015")],
  ["cancelado", R("\\bcancel+ing\\b|\\bcancel+ed\\b|\\bcancelad[oa]\\b")],
];

// Subtipos de "outro" (para log/mensagem; nao mudam a acao).
const OUTROS = [
  ["opcao_invalida", R("error\\(s\\):|defined with a bad format|' is unknown|required option '|' is not recognized|' has no value|" +
    "driver option was not valid|--driver option must be set|page size could not be parsed|profile is unavailable or ambiguous|" +
    "at least one of the -o")],
  ["driver_nao_suportado", R("driver is not supported|unsupported driver|driver selecionado n~o ~ suportado|controlador escolhido n~o ~ suportado")],
  ["erro_driver", R("error occurred with the scanning driver|erro com o (driver|controlador)|twain (session open )?error|wia error code|sane error|scanneradf")],
  ["worker", R("worker process crashed|processo de trabalho (travou|falhou)|could not start (a )?worker|worker could not start")],
  ["arquivo_existe", R("file already exists")],
  ["erro_salvar", R("permission to save|permiss~o para (salvar|guardar)|error occurred when trying to (auto )?save|erro ao tentar (salvar|guardar)|could not be overwritten|sobrescrito|n~o pode ser substitu")],
  ["http", R("response status code does not indicate success")],
  ["inesperado", R("unexpected error occurred|unhandled exception")],
];

const SEM_PAGINAS = R("no scanned pages to (export|email)");

// texto: stdout + "\n" + stderr ja decodificados.
// opts.cancelado: true se o DigiDoc matou o processo (o NAPS2 nao imprime nada nesse caso).
// opts.fonte: "glass" | "feeder" | "duplex" (so usado na heuristica de "0 paginas").
function classificarErroNaps2(texto, opts = {}) {
  if (opts.cancelado) return { categoria: "cancelado", chave: "morto_pelo_app", semPaginas: false };
  const t = normalizar(texto);
  const semPaginas = SEM_PAGINAS.test(t);
  for (const [categoria, re] of REGRAS) {
    if (re.test(t)) return { categoria, chave: categoria, semPaginas };
  }
  if (semPaginas && (opts.fonte === "feeder" || opts.fonte === "duplex")) {
    // Heuristica: no TWAIN o NAPS2 nao checa papel; com alimentador vazio o driver pode
    // so devolver 0 paginas, sem erro (depende do driver).
    return { categoria: "sem_papel", chave: "zero_paginas_alimentador", semPaginas };
  }
  for (const [chave, re] of OUTROS) {
    if (re.test(t)) return { categoria: "outro", chave, semPaginas };
  }
  return { categoria: "outro", chave: semPaginas ? "sem_paginas" : (t.trim() ? "desconhecido" : "sem_saida"), semPaginas };
}

// Para --listdevices: descarta linhas que sao mensagens, nao nomes de aparelho.
function ehLinhaDeMensagem(linha) {
  const t = normalizar(linha);
  if (!t.trim()) return true;
  return REGRAS.some(([, re]) => re.test(t)) || OUTROS.some(([, re]) => re.test(t)) || SEM_PAGINAS.test(t);
}

module.exports = { decodificarSaida, normalizar, classificarErroNaps2, ehLinhaDeMensagem, CP850_ALTO };