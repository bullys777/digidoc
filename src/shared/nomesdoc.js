"use strict";
// Nome do arquivo x tipo de documento: compara do jeito que as pessoas escrevem de verdade.
// "COMP. ENDEREÇO.pdf", "ENDERECO.pdf" e "END.pdf" sao o comprovante de endereco;
// "RG MARIA.pdf" e "RG_2.pdf" sao RG; "DOSSIE COMPLETO_compressed.pdf" e o dossie.
// Usado no processo principal (require) e na tela (window.NomesDoc).
(function (raiz) {
  const INVALIDOS = /[<>:"/\\|?*\x00-\x1f]/g;
  // sem acento, maiuscula, e espaco/ponto/hifen/_ viram um _ so: "Comp. Endereço" -> "COMP_ENDERECO"
  const chave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(INVALIDOS, "_").replace(/[\s._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  // nome do arquivo sem o que nao faz parte do tipo: ".pdf", "_compressed" (iLovePDF), "(1)", "_2"
  const chaveArquivo = (nome) => chave(String(nome || "").replace(/\.pdf$/i, "")
    .replace(/[\s_-]*compressed.*$/i, "").replace(/\s*\(\d+\)\s*$/, "").replace(/_\d+$/, ""));

  // outros jeitos de escrever o mesmo documento (as duas pontas: o nome novo e o antigo)
  const GRUPOS = [
    ["ENDERECO", "COMP_ENDERECO", "COMP_DE_ENDERECO", "COMP_RES", "END", "COMPROVANTE_ENDERECO", "COMPROVANTE_DE_ENDERECO", "COMPROVANTE_RESIDENCIA", "COMPROVANTE_DE_RESIDENCIA"],
    ["NASC", "CERT_NASC", "CERT_NASCIMENTO", "CERTIDAO_NASCIMENTO", "CERTIDAO_DE_NASCIMENTO", "NASCIMENTO"],
    ["CASAMENTO", "CERT_CASAMENTO", "CERT_CAS", "CERTIDAO_CASAMENTO", "CERTIDAO_DE_CASAMENTO"],
    ["PROPOSTA", "PROP", "FICHA_PROPOSTA"],
    ["NEG", "NEGATIVA"],
    ["TERMO_DE_COMPROMISSO", "TERMO_COMPROMISSO", "COMPROMISSO"],
    ["FICHA", "FICHA_SOCIO", "FICHA_DE_SOCIO", "FICHA_DE_INSCRICAO"],
    ["DOSSIE_COMPLETO", "DOSSIE"],
    ["CARTA_APRESENTACAO", "CARTA_DE_APRESENTACAO", "APRESENTACAO"],
    ["DEC_UNIAO_ESTAVEL", "UNIAO_ESTAVEL", "DECLARACAO_UNIAO_ESTAVEL", "DECLARACAO_DE_UNIAO_ESTAVEL"],
    ["AUTO_CONTA", "AUTORIZACAO_CONTA"],
    ["AUTO_CARTAO", "AUTORIZACAO_CARTAO"],
  ];
  const APELIDOS = {};
  for (const g of GRUPOS) for (const k of g) APELIDOS[k] = g.filter((x) => x !== k);

  const nomesDoTipo = (sigla) => { const k = chave(sigla); return k ? [k, ...(APELIDOS[k] || [])] : []; };
  // o arquivo e desse tipo? (igual, outro jeito de escrever, ou o tipo + um complemento: "RG MARIA")
  function arquivoEhDoTipo(nomeArquivo, sigla) {
    const a = chaveArquivo(nomeArquivo);
    if (!a) return false;
    return nomesDoTipo(sigla).some((k) => a === k || a.startsWith(k + "_"));
  }
  // o tipo da lista que combina com o arquivo (o nome exato ganha de apelido/complemento)
  function tipoDoArquivo(nomeArquivo, tipos) {
    const a = chaveArquivo(nomeArquivo);
    const lista = tipos || [];
    return lista.find((t) => chave(t.sigla) === a) || lista.find((t) => nomesDoTipo(t.sigla).includes(a)) ||
      lista.find((t) => arquivoEhDoTipo(nomeArquivo, t.sigla)) || null;
  }

  const api = { chave, chaveArquivo, nomesDoTipo, arquivoEhDoTipo, tipoDoArquivo, APELIDOS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.NomesDoc = api;
})(typeof window !== "undefined" ? window : globalThis);
