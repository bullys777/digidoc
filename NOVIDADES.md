# Novidades do DigiDoc

Cada versão nova começa com `## <versão>`. As linhas com `-` viram a lista de
novidades que aparece no aviso de atualização dentro do app.

## 0.6.0
- Lista de conferência: cada associado salvo é anotado num arquivo TXT organizado por data (com hora, código se tiver, e índice de A a Z) — só nomes, nenhum documento
- A pasta da lista é você que escolhe: numa pasta do OneDrive ou Google Drive ela vai pra nuvem e fica privada na sua conta
- Importar pastas já digitalizadas: escolha a pasta principal ou as das letras (ex.: Digitalizados A) e o DigiDoc anota cada associado com o dia em que a pasta foi criada (sem repetir)
- O código do associado é reconhecido no nome (ex.: "1234 - Maria Silva")
- Botão "Lista de conferência" no Histórico

## 0.5.0
- Reconhecer o tipo do documento sozinho (opcional): no modo documento por documento, o DigiDoc lê o texto da página e já marca RG, CNH, CPF, comprovante de endereço, certidões, ficha, proposta, holerite, título de eleitor, carteira de trabalho e foto 3x4
- Configurações > Reconhecimento: escolha o nome do arquivo de cada documento reconhecido (ex.: comprovante de endereço → ENDERECO, proposta de admissão → PROPOSTA)
- Errou o tipo? Clique na etiqueta da página e escolha o certo — ele aprende com a correção
- Lê o nome escrito no RG/CNH/CPF e sugere pro campo Associado
- Botão 📋 Colar: cola o nome copiado no campo Associado
- 🕘 Recentes: clique põe o nome; 2 cliques reabrem os documentos salvos pra editar e salvar por cima
- Depois de salvar, o campo Associado fica limpo, pronto pro próximo
- Corrigido: digitar o nome depois de escanear deixava o botão Salvar desativado
- Corrigido: "Clarear o fundo" deixava RG/cartão escaneado no vidro todo preto
- Corrigido: cancelar a pergunta "arquivo já existe" apagava as páginas da tela
- Corrigido: páginas sem tipo sumiam depois de salvar (agora ficam na tela)
- Corrigido: várias páginas avulsas no mesmo salvamento podiam se sobrescrever
- Corrigido: importar PDF ficava parado se a janela do DigiDoc estivesse atrás de outra
- Corrigido: colar texto do Excel na lista de nomes virava página
- Corrigido: "Restaurar padrão" salvava na hora, mesmo clicando Cancelar
- Corrigido: aviso flutuante cobria o botão Salvar; desfazer cor/ordem voltava errado

## 0.4.1
- A pasta da letra segue o padrão das pastas que já existem (ex.: "Digitalizados A" → cria "Digitalizados E"). Espaços não contam, então pasta com erro de digitação também é reconhecida
- A pasta do associado é reaproveitada mesmo se estiver escrita diferente (maiúsculas, acentos ou espaços), sem criar pasta duplicada
- Rodapé mais compacto: não quebra mais linha no modo documento por documento

## 0.4.0
- Giro automático novo: usa um modelo de inteligência artificial feito só pra orientação de documento (PaddleOCR). Nos testes acertou 24 de 24, inclusive RG pequeno no vidro, que o sistema antigo errava
- Quando não tem certeza do lado (ex.: foto sem texto), o DigiDoc não gira e marca a página com ↻? pra você conferir
- Corrigido o "endireitar": em página com cartão (RG) ele podia entortar até 20 graus
- Aviso de página repetida (≈): quando a mesma folha entra duas vezes
- Menu ⋯ Mais: intercalar frente e verso (scanner sem duplex), inverter a ordem e juntar páginas numa folha (RG frente e verso numa A4)
- Fila de associados (📋 Fila): cole a lista de nomes; depois de salvar, o próximo nome já entra sozinho
- Documentos obrigatórios: marque em Configurações > Tipos (coluna Obrig.) e o DigiDoc mostra o que falta de cada associado
- Corrigido: apagar um tipo na tabela de tipos fazia os de baixo perderem a opção "Cor?"

## 0.3.1
- Cor do próprio scanner: as páginas coloridas agora saem com as cores exatamente como o scanner mandou (antes ficavam estouradas)
- Nova opção em Configurações > Ajustes da imagem: "Manter a cor do scanner" (ligada por padrão)
- "Melhorar nitidez" passa a valer só para páginas em cinza (em cor criava halos)

## 0.3.0
- Painel de produção (F3): quantos associados e PDFs hoje, ontem, na semana e no total, letra atual, gráfico por dia e por letra, e quem ainda não tem cada documento
- Meta de associados por dia, com barrinha de progresso no rodapé
- Relatório para o Excel com todos os associados e a produção por dia
- Ver a página grande, com zoom, girar e recortar (Espaço ou duplo clique)
- Importar PDF: cada página vira uma página no DigiDoc (também dá pra arrastar o PDF)
- Desfazer (Ctrl+Z): remover, limpar, girar, mudar a ordem, marcar tipo, recortar e cor
- Cor por página (botão 🎨 ou tecla C) e o tipo "Foto 3x4" agora sai colorido de verdade
- Aviso de nome parecido, pra não criar pasta duplicada ("Maria Silva" x "Maria da Silva")
- Clique num PDF já salvo (no topo) para abrir
- Histórico do que foi salvo neste PC, com atalho para abrir cada PDF
- Atalhos novos: F2 escanear, F3 painel, F4 nome, Ctrl+S salvar, Ctrl+O importar, Shift+R girar pra esquerda, F1 lista de atalhos
- Depois de salvar, o campo do nome já fica pronto pro próximo associado
- Atualização automática pela internet (avisa quando tem versão nova)
- Corrigido: o botão Girar às vezes deixava a página de cabeça pra baixo
