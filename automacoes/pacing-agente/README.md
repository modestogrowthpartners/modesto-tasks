# Agente de pacing (07:30)

Rotina diária que lança o dia anterior fechado no `Controle_Pacing.xlsx`,
recalcula o Painel e sinaliza o que precisa de ação.

As regras aqui vieram do arquivo real, inspecionado célula a célula. A versão
anterior deste documento reconstruía a régua a partir do `pacing-portal.gs`,
porque o arquivo ainda não tinha sido localizado. **Onde os dois divergirem, a
aba `INSTRUCOES` do arquivo manda.**

## O arquivo

`Controle_Pacing.xlsx`. Manipulado com openpyxl mais `recalc.py`.

| Aba | O que é |
|---|---|
| `INSTRUCOES` | regras de negócio. Fonte única do limite de pacing. Nunca hardcode fora dela |
| `PAINEL` | dashboard consolidado, 100% fórmula. Não editar direto |
| `LOG DE ALTERACOES` | mudança de orçamento acima de 20% ou R$ 1.000, com dupla aprovação humana |
| abas de cliente | cabeçalho de controle nas linhas 1 a 32, registro diário a partir da linha 36. Linha 37 é o dia 1, linha 36+N é o dia N |
| abas de dados brutos | uma linha por data, alimentadas via MCP |

Abas de cliente: AMAKHA PARIS, ALLIANCE BR, ALLIANCE LATAM, MEU RODAPE,
WONDR EXPERIENCE, BARBIE, DABELA SITE, DABELA REVENDA, D&G, RUMINAR.

Abas de dados brutos: `AMK Google`, `AMK Meta`, `DEG Google`, `ALI Google BR`,
`ALI Meta`, `RUM Meta`, `' ALI Google LATAM'`, `WDR Google`, `BRB Google`.

**`' ALI Google LATAM'` tem um espaço no início do nome.** Referência sem o
espaço não resolve.

## Dois modos, e o manual é intencional

**Fórmula:** a aba de dados brutos recebe o dado e a aba do cliente propaga
sozinha. Não se toca na aba do cliente.

**Manual:** o número vai direto na célula do dia da aba do cliente. Não se cria
aba de dados brutos nova nem se transforma a célula em fórmula.

O modo manual foi decisão explícita do time. Parece inconsistente com o resto do
arquivo e continua valendo assim.

## Mapa cliente, fonte e conta

IDs preenchidos a partir de `automacoes/relatorio-semanal/contas.json` e da
rotina de pacing que já roda em produção. O arquivo não guarda ID nenhum, o que
é a razão de este mapa existir aqui.

| Cliente | Modo | Google | Meta |
|---|---|---|---|
| AMAKHA PARIS | fórmula | `4074568221` | `act_541549713104937` |
| ALLIANCE BR | fórmula | **não resolvido** | `act_313434459904767` |
| ALLIANCE LATAM | fórmula | `5026131996` | `act_313434459904767` (mesma da BR) |
| D&G | fórmula | `6813205150` | não usa |
| RUMINAR | fórmula | não usa | `act_367338121425127` e `act_1649947782846182` |
| WONDR EXPERIENCE | manual | `4154437131` | `act_2084569325186193` |
| BARBIE | manual | `3805729384` | `act_1450012306123467` |
| MEU RODAPE | manual | `3084869797` | `act_2964386040481714` |
| DABELA SITE | manual | `1592264131` (Windsor) | `act_1508287609836288` (Windsor) |
| DABELA REVENDA | manual | não usa | `act_745620844876754` (sem permissão) |

Quatro armadilhas neste mapa:

**Alliance BR, Google.** As contas prováveis `1149522009` e `7999729145` voltam
`CUSTOMER_NOT_ENABLED` na Pipeboard. Sem ID válido, a linha vai `SEM DADO`. Não
se chuta outro ID no lugar.

**Meu Rodapé, Google.** A conta viva é `3084869797`. A `8056022205` migrou e
não gasta desde 02/09. O controle antigo apontava para a migrada, e foi assim
que o cliente apareceu reportado a 8% do gasto real.

**Ruminar, Meta.** Duas contas no mesmo bloco, colunas G:K e N:R. Confira o
cabeçalho da linha 36 antes de escrever, em vez de assumir a ordem.

**Pink Beach.** `act_331761388917652` (EUR) pertence ao mesmo cliente que a
Wondr no `contas.json`, mas não tem aba no arquivo. Não some sem confirmar. O
gasto dela sai no relatório como "fora do arquivo".

## Classificação

```
indice = % do budget consumido / % do mes decorrido
```

| Índice | Cor | Ação |
|---|---|---|
| 0,95 a 1,05 | verde | seguir |
| 0,85 a 0,94 ou 1,06 a 1,15 | amarelo | ajustar no mesmo dia |
| abaixo de 0,85 ou acima de 1,15 | vermelho | escalar imediatamente |

Vermelho escala no mesmo dia para o **Everton**, via Apps Script. O prompt de
origem dizia Lucas e o fluxograma dizia Everton; a decisão do time foi Everton.

**Crédito da agência** (Alliance BR, Alliance LATAM, Meu Rodapé, Wondr): estouro
é prejuízo da agência, não do cliente. A trava de gasto na plataforma precisa
estar em 97% do budget contratado. O agente verifica e alerta. Configurar é
trabalho de humano na conta de anúncio.

**CPA sem teto natural** (Wondr, Barbie): mesma exigência de trava, mesmo sem
orçamento mensal fixo.

Wondr e Barbie estão com o orçamento do mês do Google em branco, então o índice
das duas sai zerado. Isso é reportado como "sem orçamento", nunca como
"pacing zero". Número inventado é pior que número ausente.

## Coleta

| Regra | Por quê |
|---|---|
| Google: `conversions`, nunca `all_conversions` | cada conta tem uma única ação oficial (`include_in_conversions_metric=true`), sempre a compra real. `all_conversions` mistura ligação e visita a página |
| Meta: `link_click` de dentro de `actions` | o campo `clicks` de topo é outra coisa |
| Meta: `purchase`, exceto Ruminar, que usa `lead` | a Ruminar não vende produto pelo Meta, o evento real é lead ou conversa |
| Meta: restringir `fields` e passar `category` | senão a resposta estoura o limite de tokens |
| Moeda nunca convertida | Wondr e Barbie EUR, Alliance USD, o resto BRL |
| Dabela só pela Windsor.ai | não existe na Pipeboard |

## Não é bug novo

**378 erros `#VALUE!`** nas colunas Y, Z, AA e AC ("Consolidado") de
AMAKHA PARIS e ALLIANCE BR, só em linhas de dias futuros. A fórmula soma
Google mais Meta quando a célula original devolve texto vazio em vez de zero.
Essa é a linha de base do `recalc.py`.

`#VALUE!` num dia **já lançado** é outra coisa, e aí sim é para reportar. Pode
acontecer se Google e Meta do mesmo dia forem lançados em momentos diferentes.

**Coluna "Investimento Planejado"** usa divisor diferente por conta, `/31` na
Amakha, `/30` na Alliance BR e no Meu Rodapé, valor fixo na Ruminar, enquanto a
`INSTRUCOES` manda `budget ÷ 30,4`. Já conferido: a coluna não alimenta o índice
nem o status, é referência visual. Não corrigir sozinho, é decisão de
padronização, não bug funcional.

## Entrega dos alertas

O Apps Script já existe e é ele quem avisa o Everton. O agente não manda e-mail
e não posta no Slack: ele entrega o que ficou errado e para por aí.

**O script não está no GitHub.** Vive só no editor do Apps Script, então o ponto
de entrada dele não é auditável daqui. Enquanto ele não for lido, o agente
trabalha por descoberta: procura no arquivo uma aba de fila (`ALERTAS`,
`ALERTA`, `AJUSTES`, `ALERTS`) e escreve respeitando o cabeçalho que já estiver
lá.

**Se não achar a fila, o agente não cria uma.** Aba que o script não lê faz o
alerta sumir em silêncio, com o relatório dizendo que deu tudo certo. Falhar
alto é melhor: ele para a entrega, deixa os alertas no resultado da tarefa e
reporta "fila de alertas não localizada".

**Só entra na fila o que MUDOU.** O agente compara com o dia anterior e entrega
quando a cor do cliente mudou em qualquer sentido, quando o cliente segue
amarelo ou vermelho e o ajuste diário mudou mais de 10%, ou quando uma conta
passou a ficar `SEM DADO` (ou voltou a ter dado). Nada disso mudou, nada é
entregue: o relatório diz "sem alteração hoje" e encerra.

Repetir o mesmo alerta todo dia treina o time a ignorar, e no dia que importa
ele passa batido. Só o vermelho vai marcado como crítico, e é o que chega no
Everton.

Cada alerta carrega data de referência, cliente, cor, índice, consumido, budget,
% do mês decorrido, se é para subir ou descer, o ajuste diário e a moeda.

## Limites

- Somente leitura nas plataformas. Nunca `update_google_ads_campaign`,
  `update_campaign`, pausa ou alteração de orçamento.
- Nunca escrever um número no arquivo sem ter puxado o dado real via MCP na
  própria execução. Cache de execução anterior não vale sem revalidar.
- Célula que deveria ser fórmula e está com valor fixo não se sobrescreve sem
  confirmar. Pode ser ajuste manual intencional.
- O agente não registra nada no `LOG DE ALTERACOES`. Ele sinaliza que precisa
  ser registrado por humano, com dupla aprovação.

## A rotina

`trig_01NQZmDapBpDbdymgLxAvgtv`, cron `30 10 * * *` em UTC, que é 07:30 de
Brasília. Sessão nova a cada disparo.

**Criada sem conectores MCP.** A API recusa anexar conector por esta via. Sem
`Pipeboard Google Ads`, `Pipeboard Meta Ads`, `Windsor.ai` e `Google Drive`, a
sessão disparada não enxerga conta nenhuma. Os conectores precisam ser anexados
na tela de Rotinas do claude.ai.

## O que trava hoje

1. **`Controle_Pacing.xlsx` não foi localizado** no Drive desta conta nem no
   disco da sessão. Sem o arquivo, a rotina para no passo 0, de propósito.
2. **ID do Google da Alliance BR.**
3. **Orçamento do mês do Google para Wondr e Barbie**, hoje em branco.
4. **Contato do Lucas** para os vermelhos.
5. **Onde o Apps Script lê os alertas.** O script existe e não está no GitHub,
   então o nome da aba de fila (ou a URL, se for Web App) ainda não é conhecido.

## Relação com o que já existe

Três saídas de pacing por manhã, com números que não batem:

| Quem | Horário | Fonte |
|---|---|---|
| Rotina `Ajuda de controle de pacing` | 07:00 | Pipeboard, gera `Pacing_AAAA-MM-DD.xlsx` |
| Este agente | 07:30 | Pipeboard e Windsor, atualiza o `Controle_Pacing.xlsx` |
| Pacing Bot MGP (Apps Script) | 08:00 | Windsor, posta no Slack e manda e-mail |

O bot das 8h usa Windsor para tudo, e a Windsor devolve 3 das 8 contas Meta e
não devolve a conta viva do Meu Rodapé no Google, conferido em 12/09/2026
(`automacoes/pacing-portal/README.md`). O número dele é o mais baixo dos três,
e é o que chega na diretoria.

Consolidar as três saídas numa só é decisão pendente.
