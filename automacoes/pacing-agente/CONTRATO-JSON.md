# O contrato entre o agente e o Apps Script

O agente não escreve célula. O conector de Drive dele só mexe em metadados.
Quem tem `SpreadsheetApp` é o Apps Script.

Então o caminho é: **o agente larga um JSON, o Apps Script grava.**

```
07:30  agente puxa Google, Meta e TikTok
       grava pacing_AAAA-MM-DD.json na pasta Pacing Diário
08:00  rodarAlertas
       -> importarPacingDoDrive_  le o JSON e preenche as celulas
       -> analisa, envia e-mail e Slack, escala critico para o Everton
       -> escreverAbaAlertas_  registra o que foi enviado na aba ALERTAS
```

## Onde

| O quê | ID |
|---|---|
| Planilha de pacing (cópia de trabalho) | `1eRsRKFpJ61MQK9MeycAZtHmJPVyXRndaDjNSPyhKH3Q` |
| Pasta de ingestão (`Pacing Diário`) | `1Qahos1FUoplgwn5C5LI0twrBr5NsDHt0` |
| Planilha de orçamento externa | `1rHmIt2Nc_gIR3d96qf2ags3X-xI5YNZUfwPkMCPvyeA` |

Nome do arquivo: `pacing_AAAA-MM-DD.json`, onde a data é o **dia lançado**,
que é D-1. Depois de consumido, o script renomeia para
`pacing_AAAA-MM-DD.json.processado`, em vez de apagar, para dar para auditar.

## O formato

```json
{
  "data": "2026-09-13",
  "contas": {
    "AMAKHA PARIS": {
      "google": { "investido": 1526.27, "impressoes": 147198, "cliques": 1478,
                  "conversoes": 348.51, "receita": 7085.83, "fonte": "Pipeboard" },
      "meta":   { "investido": 841.76, "impressoes": 72420, "cliques": 1295,
                  "conversoes": 10, "receita": 1915.65, "fonte": "Pipeboard" }
    },
    "RUMINAR": {
      "meta_lead":     { "investido": 192.70, "impressoes": 15380, "cliques": 210, "conversoes": 9 },
      "meta_whatsapp": { "investido": 480.00, "impressoes": 41200, "cliques": 640, "conversoes": 31 }
    },
    "MEU RODAPE": {
      "google": { "investido": 4054.04, "impressoes": 353693, "cliques": 4164,
                  "conversoes": 63, "receita": 22553.62, "fonte": "Pipeboard" },
      "meta":   { "investido": 3910.00, "impressoes": 288100, "cliques": 3520,
                  "conversoes": 47, "receita": 18400.00, "fonte": "Pipeboard" }
    }
  }
}
```

Campo ausente é campo não gravado. Isso é de propósito: **não mande zero para
dizer "não sei"**. Zero é um número, entra na média e mente. Conta sem dado sai
do JSON e o Apss Script registra a ausência como alerta.

`data` no arquivo tem que bater com o dia que o script vai lançar. Se divergir,
ele não grava nada e alerta. Lançar o dia certo na linha errada é o pior erro
possível aqui, porque ninguém percebe.

## Por conta

| Conta no JSON | Veículos esperados |
|---|---|
| `AMAKHA PARIS` | `google`, `meta` |
| `ALLIANCE BR` | `google`, `meta` (o Meta é o número somado de BR e LATAM) |
| `ALLIANCE LATAM` | `google` só |
| `D&G` | `google` só |
| `RUMINAR` | `meta_lead`, `meta_whatsapp` |
| `WONDR EXPERIENCE` | `google`, `meta` |
| `BARBIE` | `google`, `meta` |
| `MEU RODAPE` | `google`, `meta` |
| `DABELA SITE` | `google`, `meta` (Windsor) |
| `DABELA REVENDA` | `meta` (Windsor) |

**Alliance tem uma aba `ALI Meta` só, com um bloco só**, lida pelas duas abas de
cliente. Por isso o Meta da Alliance vai inteiro na `ALLIANCE BR` e a
`ALLIANCE LATAM` manda só Google. Separar exige mudar a planilha.

## Como o script decide a coluna

Nunca por posição. Sempre pelo rótulo, e dentro do bloco do veículo que a linha
35 delimita.

O motivo tem nome: **Meu Rodapé e Barbie têm o bloco Meta deslocado uma coluna**
em relação às outras oito abas. Investimento Realizado é `O` nelas e `N` no
resto. Escrever por analogia colocaria o gasto em Investimento Planejado, e o
índice de pacing passaria a comparar o planejado com ele mesmo, sem erro
nenhum na tela.

Validado contra o arquivo real:

| Aba | Bloco Meta resolvido |
|---|---|
| MEU RODAPE, BARBIE | investido `O`, impressões `P`, cliques `Q`, conversões `S`, receita `V` |
| WONDR, DABELA REVENDA, demais | investido `N`, impressões `O`, cliques `P`, conversões `R`, receita `U` |
| RUM Meta, blocos de origem | `H:K` e `N:Q`, sem encostar no consolidado `A:E` |

## Célula com fórmula não é sobrescrita

As células de entrada são amarelas, mas nas contas em modo fórmula a amarela
**já contém** a fórmula que puxa da aba bruta. Sobrescrever com número mata o
vínculo para o mês inteiro, e é o que a aba `INSTRUCOES` avisa na legenda de
cores.

`escreverSeNaoForFormula_` checa antes de gravar. Célula com fórmula é pulada e
registrada, nunca sobrescrita em silêncio.

## Instalação do lado do Apps Script

1. Abra a planilha de pacing, **Extensões > Apps Script**.
2. `pacing_alertas.gs` como está.
3. Arquivos > + > Script, nome `ingestao`, cole `pacing-ingestao.gs`.
4. Em `executar_(opts)` do `pacing_alertas.gs`, duas linhas:

   logo depois de `const alertas = [];`
   ```javascript
   importarPacingDoDrive_(ss, datas, alertas);
   SpreadsheetApp.flush();
   ```

   logo depois de `enviar_(alertas, painel, datas, opts);`
   ```javascript
   if (!opts.teste) escreverAbaAlertas_(ss, alertas, datas);
   ```

5. Rode `importarPacingAgora` uma vez para autorizar o Drive.

6. Slack. Em `enviar_(alertas, painel, datas, opts)`, troque o bloco

   ```javascript
   if (webhook) {
     blocosCanal.forEach(txt => postSlack_(webhook, { text: txt }));
   } else {
     Logger.log('SLACK_WEBHOOK_URL não configurado. Canal não notificado.');
   }
   ```

   por

   ```javascript
   postarNoCanalPacing_(blocosCanal, alertas);
   ```

   E acrescente nas Propriedades do script **uma** das duas:

   | Propriedade | Para quê |
   |---|---|
   | `SLACK_WEBHOOK_URL` | Incoming Webhook de `#controle_pacing_diário` |
   | `SLACK_BOT_TOKEN` | token `xoxb-...`, e o bot precisa estar no canal |

   O canal é `#controle_pacing_diário`, ID `C0BG2NK56UC`, conferido na API do
   Slack em 14/09/2026. O ID já está no código, e `SLACK_CANAL_PACING`
   sobrescreve se um dia mudar.

## O Slack hoje falha calado

O `enviar_` original só tenta o webhook. Sem a propriedade configurada, ele
escreve uma linha no `Logger` e segue em frente.

Ninguém lê Logger. O e-mail sai normalmente, dizendo que está tudo certo, e o
canal fica mudo. A falha só aparece quando alguém repara que faz semanas que não
chega nada no Slack, e aí não dá para saber desde quando.

`postarNoCanalPacing_` tenta o webhook, cai para o bot token, e se nenhum dos
dois funcionar transforma isso em alerta de ATENÇÃO no dia seguinte e linha na
aba `ALERTAS`. Falha de canal de alerta precisa gritar, senão vira exatamente o
problema que o canal existia para evitar.
