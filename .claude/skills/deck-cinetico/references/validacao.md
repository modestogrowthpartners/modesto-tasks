# Validação antes de entregar

Peça com animação por rolagem não se valida lendo o código. Renderize.

## Preparo, uma vez por sessão

```bash
cd <pasta de trabalho>
npm i playwright-core --silent --no-audit --no-fund
```

O Chromium já existe no ambiente. Não rode `playwright install`.

```
/opt/pw-browsers/chromium-1194/chrome-linux/chrome
```

Se a versão for outra, ache com `find /opt/pw-browsers -maxdepth 3 -name chrome`.

## Script de captura

```js
import { chromium } from 'playwright-core';
const file = 'file://' + process.cwd() + '/peca.html';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const err = []; p.on('pageerror', e => err.push('ERR ' + e.message));
await p.goto(file, { waitUntil: 'load' });
await p.waitForTimeout(1200);

const g = await p.evaluate(() => ({ t: document.querySelector('#cena').offsetTop, h: document.querySelector('#cena').offsetHeight }));
async function t(f, n){ await p.evaluate(v => window.scrollTo(0, v), g.t + g.h*f); await p.waitForTimeout(820); await p.screenshot({ path:n }); }
await t(0.10,'f1.png'); await t(0.30,'f2.png'); await t(0.55,'f3.png'); await t(0.85,'f4.png');
console.log(err.join('|') || 'sem erros');
await b.close();
```

O `waitForTimeout` depois do scroll não é luxo: o motor suaviza a rolagem, então o quadro só estabiliza alguns centésimos depois.

Falha de certificado ao buscar as fontes do Google é esperada no ambiente e não afeta a lógica. Qualquer `pageerror` de verdade precisa ser corrigido.

## Inspeção de geometria

Quando algo aparece fora do lugar, meça em vez de adivinhar:

```js
const o = await p.evaluate(() => {
  const pal = document.querySelector('#palco').getBoundingClientRect();
  const q = s => { const e = document.querySelector(s); if(!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.round(r.left-pal.left), y: Math.round(r.top-pal.top), w: Math.round(r.width), h: Math.round(r.height),
             op: getComputedStyle(e).opacity, tf: e.style.transform }; };
  return { palco:{w:Math.round(pal.width),h:Math.round(pal.height)}, peca: q('#peca'), alvo: q('#alvo') };
});
```

Um transform de milhares de pixels quase sempre significa que a medição de referência foi feita com outro elemento já transformado.

## Checagens obrigatórias

1. **Cada fase da cena animada**, uma captura por fase declarada
2. **Celular**, viewport 390x844, conferindo que as cenas com rolagem horizontal viraram lista
3. **Console limpo**, nenhum `pageerror`
4. **Sobreposição**, nenhum texto por baixo de ilustração
5. **Contraste**, texto claro sobre fundo claro é o erro mais comum ao alternar cenas

## Iterar

Ajuste, rode o script de novo, olhe a captura. De três a cinco voltas é normal numa cena ilustrada nova. Não entregue uma peça animada sem ter olhado pelo menos uma captura de cada fase.
