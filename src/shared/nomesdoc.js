"use strict";
// Nome do arquivo x tipo de documento: compara do jeito que as pessoas escrevem de verdade.
// "COMP. ENDEREÇO.pdf", "ENDERECO.pdf" e "END.pdf" sao o comprovante de endereco;
// "RG_2.pdf" e RG; "DOSSIE COMPLETO_compressed.pdf" e o dossie; "NASC JOAO.pdf" e a certidao de
// nascimento de um dependente (JOAO). Usado no processo principal (require) e na tela (window.NomesDoc).
(function (raiz) {
  const INVALIDOS = /[<>:"/\\|?*\x00-\x1f]/g;
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  // sem acento, maiuscula, e espaco/ponto/hifen/_ viram um _ so: "Comp. Endereço" -> "COMP_ENDERECO"
  const chave = (s) => semAcento(s).toUpperCase()
    .replace(INVALIDOS, "_").replace(/[\s._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  // nome do arquivo sem o que nao faz parte do tipo: ".pdf", "_compressed" (iLovePDF), "(1)", "_2"
  const chaveArquivo = (nome) => chave(String(nome || "").replace(/\.pdf$/i, "")
    .replace(/[\s_-]*compressed.*$/i, "").replace(/\s*\(\d+\)\s*$/, "").replace(/_\d+$/, ""));

  // outros jeitos de escrever o mesmo documento (todos os do grupo valem pra todos)
  const GRUPOS = [
    ["ENDERECO", "COMP_ENDERECO", "COMP_DE_ENDERECO", "COMP_RES", "END", "COMPROVANTE_ENDERECO", "COMPROVANTE_DE_ENDERECO", "COMPROVANTE_RESIDENCIA", "COMPROVANTE_DE_RESIDENCIA"],
    ["NASC", "CERT_NASC", "CERT_NASCIMENTO", "CERTIDAO_NASCIMENTO", "CERTIDAO_DE_NASCIMENTO", "NASCIMENTO"],
    ["CASAMENTO", "CERT_CASAMENTO", "CERT_CAS", "CERTIDAO_CASAMENTO", "CERTIDAO_DE_CASAMENTO"],
    ["PROPOSTA", "PROP", "FICHA_PROPOSTA"],
    ["NEG", "NEGATIVA", "CERT_NEGATIVA", "CERTIDAO_NEGATIVA"],
    ["TERMO_DE_COMPROMISSO", "TCO", "TERMO_COMPROMISSO", "COMPROMISSO"],
    ["FICHA", "FICHA_SOCIO", "FICHA_DE_SOCIO", "FICHA_DE_INSCRICAO"],
    ["DOSSIE_COMPLETO", "DOSSIE"],
    ["CARTA_APRESENTACAO", "CARTA_DE_APRESENTACAO", "APRESENTACAO"],
    ["DEC_UNIAO_ESTAVEL", "UNIAO_ESTAVEL", "DECLARACAO_UNIAO_ESTAVEL", "DECLARACAO_DE_UNIAO_ESTAVEL"],
    ["AUTO_CONTA", "CONTA", "AUTORIZACAO_CONTA", "DEBITO_EM_CONTA", "DEBITO_CONTA"],
    ["AUTO_CARTAO", "CARTAO", "CREDITO", "AUTO_CREDITO", "AUTORIZACAO_CARTAO", "DEBITO_CARTAO"],
  ];
  const APELIDOS = {};
  for (const g of GRUPOS) for (const k of g) APELIDOS[k] = g.filter((x) => x !== k);
  const TODAS = new Set(GRUPOS.flat());

  // palavras do complemento que nao sao nome de pessoa ("RG FRENTE", "CNH ATUALIZADA", "PROPOSTA 2")
  const NAO_E_NOME = new Set(["FRENTE", "VERSO", "F", "V", "COPIA", "NOVO", "NOVA", "ANTIGO", "ANTIGA", "ATUAL",
    "ATUALIZADO", "ATUALIZADA", "DIGITAL", "DIGITALIZADO", "DIGITALIZADA", "COMPLETO", "COMPLETA", "ASSINADO",
    "ASSINADA", "PAG", "PAGINA", "PARTE", "SOCIO", "TITULAR", "DE", "DA", "DO", "DOS", "DAS", "E", "VALIDA", "VENCIDA"]);
  const LIGACOES = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "D"]);
  const palavrasDoNome = (s) => new Set(chave(s).split("_").filter((w) => w && !/^\d+$/.test(w) && !LIGACOES.has(w)));

  const nomesDoTipo = (sigla) => { const k = chave(sigla); return k ? [k, ...(APELIDOS[k] || [])] : []; };

  // { tipo, complemento, doTitular } — complemento = o que vem depois do tipo ("JOAO" em "NASC JOAO").
  // titular (opcional) = nome do associado: complemento com o nome dele (ou "FRENTE", "2"...) e dele mesmo;
  // outro nome e de um dependente
  function analisar(nomeArquivo, tipos, titular) {
    const a = chaveArquivo(nomeArquivo);
    const lista = tipos || [];
    if (!a) return { tipo: null, complemento: "", doTitular: true };
    let t = lista.find((x) => chave(x.sigla) === a) || lista.find((x) => nomesDoTipo(x.sigla).includes(a));
    if (t) return { tipo: t, complemento: "", doTitular: true };
    // o tipo + um complemento: o nome mais comprido que casa ganha ("TERMO_DE_COMPROMISSO_X" antes de "TERMO")
    let melhor = null;
    for (const x of lista) for (const k of nomesDoTipo(x.sigla)) {
      if (a.startsWith(k + "_") && (!melhor || k.length > melhor.k.length)) melhor = { t: x, k };
    }
    if (!melhor) return { tipo: null, complemento: "", doTitular: true };
    const resto = a.slice(melhor.k.length + 1);
    const palavras = resto.split("_").filter(Boolean);
    const doTitularNome = titular ? palavrasDoNome(titular) : null;
    const ehDoTitular = TODAS.has(resto) || lista.some((x) => nomesDoTipo(x.sigla).includes(resto)) || // "CNH ENDERECO"
      palavras.every((w) => /^\d+$/.test(w) || NAO_E_NOME.has(w) || (doTitularNome && doTitularNome.has(w)));
    return { tipo: melhor.t, complemento: resto.replace(/_/g, " "), doTitular: !titular || ehDoTitular };
  }
  // o arquivo e desse tipo? com titular: so conta se for do titular (nao de um dependente)
  function arquivoEhDoTipo(nomeArquivo, sigla, titular) {
    const r = analisar(nomeArquivo, [{ sigla }], titular);
    return !!r.tipo && r.doTitular;
  }
  // o tipo da lista que combina com o arquivo (de quem for)
  function tipoDoArquivo(nomeArquivo, tipos) { return analisar(nomeArquivo, tipos).tipo; }

  // ---- dependentes: comparar o nome lido no documento com o do associado ----
  // distancia de edicao pequena = mesmo nome lido com erro ("JOSE" x "JOSF")
  function parecido(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length] <= 1;
  }
  const primeiroNome = (s) => [...palavrasDoNome(s)][0] || "";
  // o nome lido e de OUTRA pessoa? (primeiro nome diferente — sobrenome igual e comum na familia)
  function outraPessoa(nomeLido, titular) {
    const a = primeiroNome(nomeLido), b = primeiroNome(titular);
    if (!a || !b || a.length < 3) return false;
    if (parecido(a, b)) return false;
    // o primeiro nome lido aparece no nome do titular (ex.: titular "Maria Jose", lido "Jose Silva")
    if (palavrasDoNome(titular).has(a)) return false;
    return true;
  }

  const api = { chave, chaveArquivo, nomesDoTipo, analisar, arquivoEhDoTipo, tipoDoArquivo, outraPessoa, primeiroNome, parecido, APELIDOS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.NomesDoc = api;
})(typeof window !== "undefined" ? window : globalThis);
