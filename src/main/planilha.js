"use strict";
// Planilha .xlsx simples, sem biblioteca: uma aba, cabecalho em negrito e congelado, filtro,
// larguras das colunas e datas de verdade (da pra ordenar/filtrar). Abre no Excel, LibreOffice
// e Google Planilhas.
//   gerarXlsx({ aba: "Lista", colunas: [{ titulo, largura, tipo: "texto"|"data" }], linhas: [[...]] })
// celula "data" = "AAAA-MM-DD"
const zlib = require("zlib");

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zip (deflate) com nomes em UTF-8
function zip(arquivos) {
  const locais = [], central = [];
  let pos = 0;
  const d = new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const dados = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(a.dados, "utf8");
    const comp = zlib.deflateRawSync(dados);
    const crc = crc32(dados);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(hora, 10); lh.writeUInt16LE(dia, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(dados.length, 22); lh.writeUInt16LE(nome.length, 26); lh.writeUInt16LE(0, 28);
    locais.push(lh, nome, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(hora, 12); ch.writeUInt16LE(dia, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(dados.length, 24); ch.writeUInt16LE(nome.length, 28);
    // extra, comentario, disco, atributos internos = 0; atributos externos = 0
    ch.writeUInt32LE(pos, 42);
    central.push(ch, nome);
    pos += lh.length + nome.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, cd, fim]);
}

// texto seguro pra XML (tira caractere de controle, que o Excel recusa)
const xml = (s) => String(s == null ? "" : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const letraCol = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// "2026-11-22" -> numero de serie do Excel (dias desde 30/12/1899)
const serieData = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5) : null;
};

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function gerarXlsx({ aba = "Lista", colunas, linhas }) {
  const nomeAba = xml(String(aba).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Lista");
  const ultCol = letraCol(colunas.length - 1);
  const ultLinha = linhas.length + 1;
  const celula = (ref, v, tipo, estilo) => {
    if (v == null || v === "") return estilo ? `<c r="${ref}" s="${estilo}"/>` : "";
    if (tipo === "data") { const n = serieData(v); if (n != null) return `<c r="${ref}" s="2"><v>${n}</v></c>`; }
    if (tipo === "numero" && Number.isFinite(Number(v))) return `<c r="${ref}"><v>${Number(v)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const rows = [`<row r="1">${colunas.map((c, i) => celula(`${letraCol(i)}1`, c.titulo, "texto", 1)).join("")}</row>`];
  linhas.forEach((l, j) => {
    const r = j + 2;
    rows.push(`<row r="${r}">${colunas.map((c, i) => celula(`${letraCol(i)}${r}`, l[i], c.tipo)).join("")}</row>`);
  });
  const sheet = CAB + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<dimension ref="A1:${ultCol}${ultLinha}"/>` +
    `<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 14}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    `<autoFilter ref="A1:${ultCol}${ultLinha}"/>` +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `</worksheet>`;
  const workbook = CAB + `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView/></bookViews>` +
    `<sheets><sheet name="${nomeAba}" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${nomeAba.replace(/'/g, "''")}'!$A$1:$${ultCol}$${ultLinha}</definedName>` +
    `<definedName name="_xlnm.Print_Titles" localSheetId="0">'${nomeAba.replace(/'/g, "''")}'!$1:$1</definedName></definedNames></workbook>`;
  const estilos = CAB + `<styleSheet xmlns="${NS}">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const tipos = CAB + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const relsRaiz = CAB + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const relsWb = CAB + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zip([
    { nome: "[Content_Types].xml", dados: tipos },
    { nome: "_rels/.rels", dados: relsRaiz },
    { nome: "xl/workbook.xml", dados: workbook },
    { nome: "xl/_rels/workbook.xml.rels", dados: relsWb },
    { nome: "xl/styles.xml", dados: estilos },
    { nome: "xl/worksheets/sheet1.xml", dados: sheet },
  ]);
}

module.exports = { gerarXlsx, _crc32: crc32 };
