# DigiDoc

Digitalizador de documentos em lote para Windows: escaneia (USB ou rede), importa imagens e PDFs, recebe fotos do iPhone, arruma as páginas e salva PDFs organizados em `Digitalizado\Letra X\Nome do Associado\`, sempre dentro do limite de tamanho.

**Desenvolvido por Otavio Martins.**

## Instalar

1. Abra a página de [versões (Releases)](../../releases/latest).
2. Baixe o **DigiDoc-Setup.exe** (em *Assets*) e dê dois cliques.
3. Se o Windows mostrar *"O Windows protegeu o computador"*, clique em **Mais informações → Executar assim mesmo** (o instalador não é assinado digitalmente).

Não precisa de administrador. O DigiDoc fica em `C:\Users\<você>\DigiDoc`, com atalho na Área de Trabalho e no Menu Iniciar. Para remover: **Configurações do Windows → Aplicativos → DigiDoc → Desinstalar**. Os seus PDFs nunca são apagados.

Depois de instalado, ele **se atualiza sozinho**: quando sai uma versão nova, aparece um botão verde embaixo da tela.

## O que ele faz

- Escanear com qualquer scanner (USB/WIA/TWAIN ou rede/eSCL), alimentador e vidro automáticos
- Importar imagens e PDFs, arrastar, colar, ou receber fotos do iPhone pelo Wi-Fi (QR Code)
- Girar automático, endireitar, clarear o fundo, tirar página em branco
- Ver grande com zoom, recortar, cor por página, desfazer (Ctrl+Z)
- Modo dossiê (um PDF) ou documento por documento (RG.pdf, CPF.pdf…)
- Painel de produção: hoje, total, letra atual, por tipo de documento, quem falta, relatório para o Excel

Veja [NOVIDADES.md](NOVIDADES.md) e [COMO_USAR.txt](COMO_USAR.txt).

## Privacidade

Os documentos ficam **só no computador** (ou na pasta de rede que você escolher). Nada é enviado para a internet: o único acesso à rede é para procurar atualizações nesta página. O `.gitignore` impede que PDFs, imagens e a configuração local entrem no repositório.

## Desenvolvimento

```bash
npm install
npm start                 # roda em modo desenvolvimento
npm run dist              # gera dist/DigiDoc-Setup.exe, o kit do pendrive e os arquivos de atualização
npm run publicar          # publica a versão do package.json como release no GitHub
```

Para publicar uma versão: suba o `version` no `package.json`, escreva as novidades numa seção `## <versão>` do `NOVIDADES.md`, faça o commit e rode `npm run publicar` (precisa do [GitHub CLI](https://cli.github.com/) logado).
