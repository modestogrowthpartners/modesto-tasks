# Agente de pacing (07:30)

Rotina diária que lê o investimento do dia fechado, grava na planilha de
orçamento, calcula o pacing e avisa quando o estado de alguma conta mudou.

Ela não substitui o **Pacing Bot MGP** (Apps Script das 8h) enquanto a fase 2
não estiver pronta. Enquanto as duas rodarem juntas, os números vão divergir,
e o motivo está em "Precedência de fonte" abaixo. Isso é conhecido, não é bug.

## O fluxo

```
Pipeboard + Windsor.ai
        |
        v
  dados de ontem  ->  preenche a planilha de orçamento
        |
        v
  calcula pacing pelas regras da aba INSTRUCOES
        |
        +--> relatório do dia
        +--> HTML de insights e To Do (30 dias, dia a dia)
        +--> aviso, SÓ se o estado da conta mudou (fase 2: Slack e e-mail)
```

## Fases

| Fase | O que faz | Situação |
|---|---|---|
| 1 | Coleta, preenche a planilha, calcula, gera relatório e HTML | é o que esta rotina faz |
| 2 | Alertas de ajuste no Slack e e-mail, críticos direto para o Everton | depende do Apps Script, ainda não existe |

O aviso da fase 1 sai no próprio resultado da tarefa. Quando o Apps Script
existir, ele passa a rotear o mesmo conteúdo para Slack e e-mail.

## Descoberta antes da coleta

Lista fixa de conta envelhece em silêncio. Todo dia, antes de coletar, o agente
lista as contas de anúncio de todas as plataformas conectadas e compara com a
lista conhecida.

| Plataforma | Chamada |
|---|---|
| Google Ads | `list_google_ads_customers` |
| Meta Ads | `get_ad_accounts` |
| TikTok Ads | `list_tiktok_advertisers` |
| Pinterest | `list_pinterest_ad_accounts` |
| Snapchat | `list_snap_ad_accounts` |
| Windsor.ai | `get_connectors` |

- Conta conhecida que sumiu vira `SEM ACESSO`, com o erro.
- Conta nova que gastou ontem entra no relatório como "cliente não definido",
  com o gasto. **Nunca descarte em silêncio uma conta que está gastando
  dinheiro.** É assim que verba some do pacing sem ninguém perceber.
- Conta sem gasto ontem e sem gasto no mês fica de fora, para não poluir.

Pinterest e Snapchat estão conectados e nenhum cliente tem conta mapeada no
`contas.json`. São listados mesmo assim, exatamente pelo segundo caso acima.

## GA4 e Shopify são receita, nunca gasto

Entram como contexto e ficam em coluna própria, com a fonte declarada.

**Dado de analytics de site não é prova de entrega de plataforma.** Quando a
receita do GA4 ou do Shopify divergir da receita reportada pela plataforma, o
relatório mostra as duas e diz que divergem, em vez de escolher uma e apresentar
como se fosse a verdade.

## Precedência de fonte

**Pipeboard primeiro, Windsor só onde a Pipeboard não chega.** Nunca o
contrário, e nunca as duas para a mesma conta.

O motivo está medido em `automacoes/pacing-portal/README.md`, conferido conta
a conta em 12/09/2026: a Windsor devolve 3 das 8 contas Meta e não devolve a
conta viva do Meu Rodapé no Google. O efeito somado foi o Meu Rodapé aparecer
com R$ 8.496 onde a plataforma dizia R$ 106.518, um cliente de R$ 315.000/mês
reportado a 8% do gasto real.

| Conta | Fonte |
|---|---|
| Amakha, Meu Rodapé, Wondr, Barbie, D&G, Ruminar | Pipeboard |
| TikTok de Wondr, Barbie e Amakha | Pipeboard TikTok |
| Dabela (Semijoias e Revendedoras) | Windsor, é a única que tem |
| Alliance BR e LATAM | Pipeboard se `5026131996` responder; se voltar `CUSTOMER_NOT_ENABLED`, Windsor |

Toda linha gravada leva a fonte junto. Célula sem fonte declarada é célula que
ninguém consegue auditar depois.

## Regras de cálculo (aba INSTRUCOES)

São as mesmas do bot atual, lidas de `pacing-portal.gs` e
`bot-antigo-portal.gs`. Foram copiadas de propósito: régua nova faria o agente
divergir do que o time já lê no Slack, e a discussão viraria sobre qual está
certo em vez de sobre o cliente.

```
dias_fechados   = dias do mês já encerrados (normalmente até ontem)
realizado       = soma do gasto até dias_fechados
media           = realizado / dias_fechados
projecao        = media * dias_no_mes
ritmo_ideal     = orcamento / dias_no_mes
restantes       = dias_no_mes - dias_fechados
ajuste          = (orcamento - realizado) / restantes
pct_do_plano    = projecao / orcamento * 100
```

**Hoje fica fora da conta.** O dia em curso sempre parece fraco, entra na média
puxando a projeção para baixo e faz a conta mentir todo dia, sempre no mesmo
sentido.

Semáforo pela `pct_do_plano`:

| Faixa | Sinal | Leitura |
|---|---|---|
| 95% a 105% | verde | no ritmo |
| acima de 105% | vermelho | gastando rápido, segurar |
| abaixo de 95% | laranja | abaixo do plano |

Diagnóstico, que é o que vira recomendação:

| Código | Quando | Recomendação |
|---|---|---|
| `OK` | dentro da faixa verde | nada a fazer |
| `SEGURAR` | acima de 105% | reduzir para o valor de `ajuste` por dia |
| `VERBA` | abaixo do plano e o teto diário limita a entrega | subir o teto para cerca de `ajuste` por dia |
| `ENTREGA` | abaixo do plano com teto folgado | não subir verba. O gargalo é criativo, segmentação ou leilão |

**Sem orçamento declarado não há semáforo.** Grava o investimento real e
escreve "sem meta". Plano inventado é pior do que plano ausente.

**Curva não linear.** A Amakha tem distribuição semanal declarada
(0,20 / 0,25 / 0,28 / 0,21 / 0,06). Onde houver curva, o `ritmo_ideal` segue a
curva, não a divisão linear por dia.

## Quando o agente avisa

Só quando o estado muda. Repetir "no ritmo" todo dia treina o time a ignorar
o aviso, e no dia que importa ele passa batido.

Dispara aviso quando, comparando com a leitura de ontem:

- o diagnóstico mudou de código (ex: `OK` para `SEGURAR`)
- o diagnóstico continua `SEGURAR`, `VERBA` ou `ENTREGA` e o `ajuste` mudou
  mais de 10% em relação ao de ontem
- uma conta que tinha dado passou a não ter

Não dispara quando o diagnóstico é `OK` e continuou `OK`.

## Planilha de orçamento

`[Interno] Orçamento por cliente`
(`1rHmIt2Nc_gIR3d96qf2ags3X-xI5YNZUfwPkMCPvyeA`), dona: Elias Braga.

Estrutura mínima, porque `Cliente | Orçamento` não comporta os dados:

```
Cliente | Mês | Orçamento | Moeda | Curva | Origem | Atualizado em
```

Wondr e Barbie são EUR, Alliance é USD, o resto BRL. Sem coluna de moeda,
qualquer soma ou comparação sai errada. Sem coluna de mês, a planilha não
sobrevive à virada de outubro.

**Nunca converter moeda.** Valor bruto e a moeda ao lado, que é como as contas
reportam e como o time confere.

Orçamentos de setembro/2026, lidos dos planos de mídia do Drive em 09/09/2026
e hoje em `automacoes/relatorio-semanal/contas.json`:

| Cliente | Orçamento | Moeda | Origem |
|---|---:|---|---|
| Meu Rodapé | 315.000 | BRL | Plano_de_Midia_Setembro_2026_v2 |
| Wondr | 73.536 | EUR | Plano de Mídia Set/26 |
| Amakha Paris | 70.000 | BRL | Google 36k + Meta 34k |
| Barbie | 65.651 | EUR | Plano de Mídia Set/26 |
| Ruminar | 26.355 | BRL | painel de pacing, sem plano no Drive |
| Alliance | 10.000 | USD | Google BR 4k + LATAM 1k + Meta 5k |
| D&G | sem valor | BRL | sem plano de setembro no Drive |
| Dabela | sem valor | BRL | sem plano no Drive |

## Uma fonte só para o orçamento

Hoje o `meta_mes` vive no `contas.json` e o `pacing-diario.gs` diz, no
comentário, que ele "é a fonte única: mudou a verba, edite lá". Se a planilha
passar a carregar o mesmo número sem que o JSON pare, viram duas fontes, e um
dia divergem.

A decisão pendente é qual das duas manda. Se for a planilha, o relatório
semanal precisa passar a ler dela, porque hoje lê o JSON.

## Métricas da coleta

Google Ads: `cost`, `clicks`, `impressions`, `conversions`, `conversions_value`.

**`conversions`, nunca `all_conversions`.** Cada conta tem uma única ação
marcada como oficial (`include_in_conversions_metric=true`) e é sempre a compra
real. `all_conversions` mistura isso com sinal fraco, como ligação e visita a
página.

Meta Ads: `spend`, `impressions`, `link_click` e a conversão.

**`link_click` sai de dentro de `actions`**, não do campo `clicks` de topo.
A conversão é `purchase` (em `actions` e `action_values`), exceto Ruminar, que
usa `lead`: a Ruminar não vende produto pelo Meta, o evento real é lead ou
conversa.

**Restrinja `fields` e passe `category`** nas chamadas do Meta, senão a
resposta estoura o limite de tokens.

## TikTok entra na conta

Os orçamentos do plano de mídia são "investimento total todas as plataformas".
Wondr, Barbie e Amakha têm conta de TikTok ativa no `contas.json`. Coletar só
Google e Meta e comparar com essa meta faz o pacing dos três sair subestimado,
e o agente recomendaria subir verba onde não precisa.

| Cliente | Conta TikTok | Moeda |
|---|---|---|
| Wondr | `7030798271740116994` (WONDR B.V.) | EUR |
| Barbie | `7527375330907439120` (Barbie Experience) | EUR |
| Amakha | `7475811555985571856` (Amakha#1) | BRL |

O bot antigo não coleta TikTok. Essa é a segunda fonte de divergência entre ele
e o agente, junto com a precedência Pipeboard/Windsor.

## Preenchimento de células sem dado

| Caso | Escreve |
|---|---|
| veículo que a conta comprovadamente não tem | `N/A` |
| veículo que deveria ter dado e a API não devolveu | `SEM DADO` |

Ruminar não tem Google, D&G não tem Meta: esses são `N/A`. Bloqueio de
permissão é `SEM DADO`, nunca célula vazia.

Se a Pipeboard ou a Windsor rejeitarem uma chamada, **pare e registre o erro**
no relatório. Não tente credencial alternativa, token de ambiente ou qualquer
via que não seja a ferramenta MCP já autorizada.

## A rotina

`trig_01NQZmDapBpDbdymgLxAvgtv`, cron `30 10 * * *` em UTC, que é 07:30 de
Brasília. Sessão nova a cada disparo, sem herdar contexto do dia anterior.

**Ela foi criada sem conectores MCP.** A API recusa anexar conector por esta
via, e sem `Pipeboard Google Ads`, `Pipeboard Meta Ads`, `Pipeboard TikTok Ads`,
`Windsor.ai` e `Google Drive` a sessão disparada não enxerga nenhuma conta nem
a planilha. Os conectores precisam ser anexados na tela de Rotinas do claude.ai
antes do primeiro disparo valer alguma coisa.

## O que ainda falta

- A "planilha de pacing atual" original, com a aba `INSTRUCOES`, nunca foi
  localizada no Drive desta conta. As regras acima foram reconstruídas do
  código do bot. Se a planilha aparecer e divergir, ela manda.
- Decidir a fonte única do orçamento (planilha ou `contas.json`).
- Apps Script da fase 2, e o e-mail do Everton para os críticos.
- D&G e Dabela sem orçamento declarado: ficam sem semáforo até entrar plano.
