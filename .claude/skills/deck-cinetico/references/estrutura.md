# Estrutura e componentes

## Esqueleto

```html
<body>
  <script>document.documentElement.classList.add('js');</script>
  <canvas id="malha" width="96" height="60"></canvas>   <!-- fundo vivo -->
  <svg id="defs">…gradientes e padrões…</svg>
  <div id="hud">
    <div class="linha">
      <div class="marca"><span class="mono">MGP</span><span class="nome">Cliente</span></div>
      <div id="ato">Abertura</div>
    </div>
    <div id="barra"></div>
  </div>
  <main id="doc">
    <section class="cena …" data-bg="#05303F" data-fg="#EAF3F6" data-ac="#31C2DE" data-ato="01 · Nome">…</section>
  </main>
  <script>…motor…</script>
</body>
```

`data-ato` é o que aparece no canto direito do HUD. Numere: `01 · O bloqueio`.

## Cena comum

```html
<section class="cena texto" data-bg="#FFFFFF" data-fg="#0E2C38" data-ac="#0E6C8E" data-ato="02 · Panorama">
  <div class="ghost" data-par="0.16">02</div>
  <div class="wrap">
    <div class="olho sobe">Antetítulo</div>
    <h2 class="anima largo">Título que afirma alguma coisa</h2>
    <p class="lede sobe">Parágrafo de abertura.</p>
    …
    <p class="fonte sobe">Fonte, janela, data de extração.</p>
  </div>
</section>
```

- `.anima` quebra o título em palavras e revela uma a uma
- `.sobe` sobe e aparece quando a cena entra
- `.ghost` é o número gigante de fundo com paralaxe, `data-par` é a intensidade
- `.cena.texto` tira a altura mínima de tela cheia, para cena que cresce com o conteúdo

## Cards

```html
<div class="g g4">
  <div class="cx"><span class="rot">Rótulo</span><span class="big">1.959</span><p>Explicação.</p></div>
  <div class="cx al">…</div>      <!-- barra lateral de alerta -->
  <div class="cx ok">…</div>      <!-- barra lateral positiva -->
  <div class="cx forte">…</div>   <!-- fundo com acento -->
</div>
```

`.g2 .g3 .g4` para a grade. Use `.big` para número e `.fato` para frase curta em display.

## Tabela

```html
<div class="rol">
  <table>
    <caption>Nome da tabela</caption>
    <thead><tr><th>Coluna</th><th class="v">Número</th></tr></thead>
    <tbody>
      <tr><td>Linha</td><td class="v">R$ 480</td></tr>
      <tr class="mk"><td><b>Total</b></td><td class="v"><b>R$ 640</b></td></tr>
    </tbody>
  </table>
</div>
```

`.v` alinha à direita e trava a quebra. `.mk` destaca a linha. `<span class="tag">`, `.tag.al`, `.tag.ok` para etiquetas. `<span class="pt n">Não</span>` para bolinha de status (`.n` alerta, `.s` ok).

## Comparativo antes e depois

```html
<div class="comp">
  <div class="col-c hoje"><h4>Hoje <span>Bloqueado</span></h4><ul>
    <li><i>✕</i><span><b>Tema</b>Descrição.</span></li>
  </ul></div>
  <div class="col-c depois"><h4>Depois <span>Alvo</span></h4><ul>
    <li><i>✓</i><span><b>Tema</b>Descrição.</span></li>
  </ul></div>
</div>
```

## Bloco de bloqueio

Para o impeditivo que domina a peça. Tem faixa zebrada e ponto piscando.

```html
<div class="bloqueio sobe">
  <span class="sel"><i></i> Impeditivo aberto</span>
  <span class="frase">A frase curta do problema</span>
  <p>Explicação com <code>referência técnica</code> e <strong>ênfase</strong>.</p>
</div>
```

## Lista numerada

```html
<ol class="ord">
  <li><span class="mk">01</span><span class="tx"><b>Afirmação.</b>Desenvolvimento.</span></li>
</ol>
```

## Linha de fase

```html
<div class="fase-l"><span class="n">01</span><span class="t">Nome<em>detalhe</em></span><span class="p">Quando</span></div>
<div class="fase-l tot">…</div>
```

## Gráficos nativos

Não importe biblioteca. Barras, histogramas e empilhadas se fazem com div e medida em porcentagem, geradas por JS a partir de um objeto `DATA` no topo do script. O conjunto pronto está em `assets/graficos.css`, `assets/graficos.js` e `references/graficos.md`.

Regra de cor em gráfico: uma cor por série, no máximo três séries. Série de destaque no acento, as outras em tons dessaturados do texto.

## Responsivo e impressão

O template já trata. Em `max-width:820px` as cenas com rolagem horizontal viram lista vertical e as ilustrações somem. Em `@media print` o mesmo, mais o painel de dispositivo aberto e as revelações forçadas a visível. Ao criar cena nova, acrescente o seletor nesses dois blocos.
