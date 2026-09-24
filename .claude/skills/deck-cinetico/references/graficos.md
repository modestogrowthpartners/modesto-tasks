# Gráficos nativos

Sem biblioteca. Tudo é div com largura ou altura em porcentagem, gerada por JS a partir de um objeto `DATA` no topo do documento. A revelação é feita pelo CSS: enquanto a cena não tem `.viva`, a medida fica em zero; quando entra, vai para `var(--w)` ou `var(--h)` com transição de 0,9s.

```css
.js .cena .rank .br{width:0!important}
.js .cena.viva .rank .br{width:var(--w)!important}
```

Por isso o JS nunca anima nada: ele só escreve `style="--w:62.4%"`. Quem anima é a cena ao entrar.

## Como usar

Cole `assets/graficos.css` no bloco de estilo e `assets/graficos.js` num `<script>` antes do motor. O JS expõe `window.GR` com as cinco funções. O `DATA` fica num `<script>` logo acima.

## As cinco funções

**`stack(id, s, unidade)`** barra empilhada de dois grupos. `s = {antigo:{n,g,res}, recente:{n,g,res}}`. Gera três linhas: criativos, investimento e resultado. Serve para qualquer corte binário, não só antigo e recente.

O rótulo interno usa `ra` e `rr = 100 - ra`, nunca dois arredondamentos independentes, senão a soma dá 101%.

**`hist(id, h)`** histograma de contagem por mês. `h = {'2026-05':10, '2026-09':23}`. Barras dos meses recentes saem em dourado, as antigas no acento.

**`linha(id, serie, unidade)`** mini linha do tempo dentro de um card. `serie = [{p:'2026-03', g:5438.04, r:978}]`. Altura pelo gasto, tooltip com gasto e resultado.

**`rank(id, rows, tipo)`** top 12 em barra horizontal com tooltip. Cada linha traz nome, estreia, número de anúncios e o resultado. Barra dourada é item recente.

**`tabela(id, rows, tipo)`** tabela completa dentro de um `<details>`, ordenada por investimento, com linha de total. Fica fechada por padrão, então não pesa a leitura.

## Marcação

```html
<div class="painel-g">
  <h3>Conta WhatsApp</h3>
  <p class="sub">Contexto em uma linha.</p>
  <div class="stack" id="stackWhats"></div>
  <div class="legenda"><span><i style="background:var(--ac)"></i>Antigos</span><span><i style="background:#C9A24A"></i>Recentes</span></div>
</div>

<div class="hist" id="histWhats"></div>
<div class="rank" id="rankWhats"></div>
<details class="tbl"><summary>Ver os 38 criativos</summary><div class="rol" id="tblWhats"></div></details>
```

## Pódio de destaques

`.podio > article.crt` para os três primeiros colocados. Cada card tem `.pos` com o número gigante, `.selos` com etiquetas, `.destaque` com o par número e unidade, `.met` com seis métricas secundárias, `.porque` com o motivo em texto e uma `.tl` com a linha do tempo.

Use no máximo três. O quarto e o quinto viram `.cx` de menção honrosa.

## Cena-ponte

Quando a peça junta dois assuntos, a costura é uma cena só, com a classe `.ponte`: frase gigante de um lado, dois parágrafos do outro, e três `.cx.al` embaixo com o que continua impossível. É ela que impede a peça de virar dois PDFs grampeados.

## Regras de cor

Uma cor por série, no máximo três séries. Série de destaque no acento, as outras em dourado `#C9A24A` ou em tom dessaturado do texto. Nunca use vermelho de alerta em barra que representa volume, só em risco.

## Honestidade no gráfico

- Eixo de contagem sempre começa em zero, sem exceção
- Barra com valor baixo recebe altura mínima de 6% só para ficar visível, e o número aparece escrito
- Mês sem dado não vira zero, ele não entra na série, e a legenda diz que a série é descontínua
- Toda cena com gráfico termina com `<p class="fonte">` dizendo a origem, a janela e a data da extração
