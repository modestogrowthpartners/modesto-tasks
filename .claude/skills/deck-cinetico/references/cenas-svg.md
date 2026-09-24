# Cenas ilustradas animadas pela rolagem

São o clímax da peça. Use no máximo duas por documento, senão vira parque de diversões.

## Mecânica

A seção recebe altura artificial (`vh * N`) e dentro dela um contêiner `position:sticky; height:100svh`. O progresso da cena é `(scroll - topo) / (altura - vh)`, entre 0 e 1. Cada elemento reage a uma faixa desse progresso.

```js
var p = prog(idx(secao));          // 0 a 1
var entra = fx(p, .02, .14);       // suavizado entre dois pontos
elemento.style.transform = 'translate3d(' + ((1-entra)*120) + '%,0,0)';
```

`fx(v,a,b)` devolve 0 antes de `a`, 1 depois de `b`, com suavização no meio. Está no motor.

**Altura da seção**: 5 vh para uma cena simples, 16 vh para uma com várias fases. Defina em `medir()`, não no CSS, porque depende da altura da janela.

## Regra de ouro: meça, não chute

Nunca posicione uma peça móvel com número mágico. Meça a posição real dos elementos e derive a posição das outras.

```js
function centro(el, ref){
  var r = el.getBoundingClientRect(), p = ref.getBoundingClientRect();
  return {x:r.left-p.left+r.width/2, y:r.top-p.top+r.height/2, w:r.width, h:r.height};
}
```

Coloque marcadores invisíveis no SVG para servirem de âncora:

```html
<circle id="pontaL" cx="66" cy="312" r="2" fill="none"/>   <!-- ponta da lança -->
<rect id="leito" x="46" y="190" width="700" height="18" fill="none"/>  <!-- onde a carga pousa -->
```

**Ao medir, zere todos os transforms envolvidos e restaure depois.** Medir um elemento com o transform da animação aplicado é a causa número um de peça saindo da tela:

```js
function geometria(){
  var t1=a.style.transform, t2=b.style.transform;
  a.style.transform='none'; b.style.transform='none';
  …medições…
  a.style.transform=t1; b.style.transform=t2;
}
```

## Resolver um ângulo em vez de chutar

Quando um braço articulado precisa depositar algo num ponto exato, ache o ângulo por busca binária em vez de tentativa e erro:

```js
var alvoY = destino.y - folga, lo = 2, hi = 64;
for (var i=0; i<24; i++){
  var mid = (lo+hi)/2, ponto = porAngulo(mid);
  if (ponto.y > alvoY) lo = mid; else hi = mid;
}
ANG_FINAL = (lo+hi)/2;
```

Depois desloque a máquina inteira em X para alinhar: `dx = destino.x - pontoNoAnguloFinal.x`.

Atenção ao espelhamento: se o SVG tem `transform:scaleX(-1)`, o sentido da rotação inverte. Ângulo positivo passa a levantar o que antes abaixava.

## Objeto carregado por outro

O objeto transportado não deve ter animação própria. Ele é colado na âncora do transportador a cada quadro:

```js
var ponta = centro(pontaL, palco);
carga.style.transform = 'translate3d(' + (ponta.x - base.x) + 'px,' + (ponta.y + folga - base.y) + 'px,0)';
```

`base` é a posição do objeto sem transform, medida uma vez. Assim ele nunca descola.

## Transição entre dois cenários na mesma cena

Para o veículo carregado sair andando sem cortar para outra cena: envolva veículo e carga num contêiner, e na transição aplique escala nele enquanto troca os cenários por opacidade.

```js
var vira = fx(p, .46, .56);
comboio.style.transform = 'scale(' + (1 - vira*0.64) + ')';
cenarioA.style.opacity = String(1 - vira);
cenarioB.style.opacity = String(vira);
```

Troque também o título e o antetítulo por JS no meio da transição. A leitura muda junto com a imagem.

## Sensação de movimento

O veículo fica parado e o mundo passa. Rodas giram com um acumulador que soma por quadro mais um tanto proporcional à velocidade de rolagem:

```js
giro += vel * (6 + deltaProgresso * 900);
rodas.forEach(function(r){ r.style.transform = 'rotate(' + giro + 'deg)'; });
faixaDaPista.style.transform = 'translate3d(' + (-(giro*1.6) % 118) + 'px,0,0)';
```

Some paralaxe de fundo e um balanço leve: `Math.sin(giro/26) * 1.8` px.

## Dispositivo destravando

Tablet ou celular com tela de bloqueio que sai e revela um painel. O cadeado abre por rotação do arco, a camada de bloqueio sobe e some, e o conteúdo entra em sequência.

```js
var abre = fx(p,.16,.32), some = fx(p,.34,.46);
trava.classList.toggle('aberto', abre > .6);
trava.style.opacity = String(1-some);
trava.style.transform = 'translateY(' + (-some*100) + '%)';
kpis.forEach(function(k,n){ var v = fx(p, .40+n*.03, .49+n*.03); … });
```

O painel dentro do dispositivo é HTML normal, não imagem. Fica nítido em qualquer tela e acessível.

## Armadilhas já pagas

- **Colisão de nome de classe.** `.trava` do dispositivo com `.trava` do roadmap quebrou o layout inteiro porque uma delas era `position:absolute;inset:0`. Prefixe as classes por cena.
- **Escala.** Desenhe o SVG com o `viewBox` proporcional ao objeto real e controle o tamanho só pela largura em `%`. Confira a altura resultante contra a altura do palco antes de seguir.
- **Texto dentro do objeto.** Se a peça precisa conter texto legível, a proporção realista pode não caber. Prefira abrir o objeto além da borda da tela a encolher a fonte abaixo de 12px.
- **Excesso de vazio.** Se sobrar um buraco no meio do palco, é sinal de que falta um elemento de leitura, uma régua de progresso por exemplo, não de que os elementos deveriam crescer.
