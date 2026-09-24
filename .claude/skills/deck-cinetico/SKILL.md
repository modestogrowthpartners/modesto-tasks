---
name: deck-cinetico
description: Constrói apresentações e relatórios HTML de arquivo único no padrão cinético da Modesto Growth Partners, com cenas em rolagem, troca de cor de fundo por cena, revelação de conteúdo, tipografia Bricolage Grotesque, tabelas e comparativos, gráficos nativos e cenas ilustradas por SVG animado no scroll (dispositivo destravando, veículo carregando e viajando). Use quando o pedido for apresentação, deck, relatório visual, one-pager animado, cronograma, plano de virada, análise de criativos ou qualquer diagnóstico que precise virar peça para cliente ou diretoria. Use também para corrigir escala, enquadramento, sobreposição ou animação quebrada numa peça já feita neste padrão.
---

# Deck cinético

Peça HTML de arquivo único que se lê rolando. Cada seção é uma cena; ao passar de uma para a outra, o fundo, o texto e a cor de acento mudam por interpolação. O conteúdo entra em cena conforme aparece. Cenas-chave podem ser ilustrações em SVG que se animam com a rolagem.

## Quando usar

Relatório de performance, plano, cronograma, diagnóstico, proposta. Qualquer coisa que hoje seria um PDF sem graça e que ganha sendo navegável.

Não use para: documento que precisa ser editado a várias mãos, planilha, ou quando o cliente pediu explicitamente .docx/.pptx.

## Como montar

1. **Leia `references/estrutura.md`** antes de escrever a primeira linha. Ele tem o esqueleto obrigatório, a lista de componentes prontos e as regras de conteúdo.
2. **Copie `assets/template.html`** e preencha. Ele já traz o CSS e o motor de rolagem inline, sem dependências além das fontes do Google.
3. **Escreva as cenas** como `<section class="cena" data-bg data-fg data-ac data-ato>`. A ordem das cores alterna escuro e claro.
4. **Se a peça tiver dados**, leia `references/graficos.md` e use a camada de gráficos nativos. Nada de biblioteca externa.
5. **Valide no navegador** antes de entregar. Isso não é opcional: veja `references/validacao.md`.

## Regras que não se negociam

**Números.** Todo dado vem de fonte nomeada, com janela explícita. Se um número for estimativa, escreva que é. Rodapé de seção com `<p class="fonte">` dizendo de onde veio. Nunca invente um número para preencher um card.

**Honestidade.** Se a análise tem uma ressalva, ela entra na peça, não fica de fora para não estragar a narrativa. Ressalva escrita vale mais que cobrança depois.

**Sem travessão.** A casa não usa ` — ` em copy. Use vírgula, dois pontos ou ponto.

**Título é conclusão.** `h2` afirma alguma coisa. "Os vídeos mais antigos continuam gerando mais leads" e não "Análise por idade de criativo".

**Uma ideia por cena.** Se a cena precisa de duas respirações, são duas cenas.

## Paleta

O padrão é a paleta do cliente. Se não houver, use a base azul petróleo do template. Defina só quatro cores e derive o resto:

- `--bg` fundo, `--fg` texto, `--ac` acento, `--al` alerta
- Tudo o mais sai de `color-mix` sobre essas quatro, então trocar a marca é trocar quatro linhas

Cenas claras e escuras se alternam. Cena escura para números e abertura, clara para tabela e leitura longa.

## Tipografia

- Display: **Bricolage Grotesque**, peso 700 a 800, `font-variation-settings:'wdth'` entre 78 e 90 para condensar títulos grandes
- Corpo: **Space Grotesk**, 300 a 600, com `font-variant-numeric:tabular-nums` em tudo que for número

Outra dupla só se a marca do cliente exigir. Nunca serifada de sistema.

## Estrutura mínima de uma peça

Capa, contexto ou panorama com números, desenvolvimento em três a seis cenas, cena ilustrada como clímax, tabela de decisões ou dependências, riscos, fechamento com o pedido.

O fechamento sempre termina com **uma** coisa pedida, não uma lista de cinco.

## Arquivos

- `assets/template.html` esqueleto pronto, com CSS e motor inline
- `assets/base.css` e `assets/motor.js` os mesmos, separados, para quando for montar do zero
- `assets/graficos.css` e `assets/graficos.js` camada de gráficos nativos, barra empilhada, histograma, linha do tempo, ranking e tabela
- `references/estrutura.md` componentes, classes e exemplos de marcação
- `references/cenas-svg.md` como construir as cenas ilustradas e animá-las no scroll
- `references/graficos.md` gráficos nativos, pódio de destaques e cena-ponte
- `references/validacao.md` como renderizar e conferir antes de entregar
