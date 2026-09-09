# Pacing no portal

Publicação **diária** do pacing no canal `#controle-pacing-diario` do portal
(id `71608354-2fbf-4edb-a95d-250063ff4498`), uma mensagem por cliente, com o
gráfico do mês e o ritmo necessário para fechar na verba.

## Como roda todo dia

| Arquivo | Onde roda | Quando |
|---|---|---|
| `google-ads-gasto.js` | Google Ads Scripts, dentro do MCC | todo dia, 07:00 |
| `pacing-diario.gs` | Apps Script (script.google.com) | todo dia, 07:30 |
| `pacing-portal.gs` | mesmo projeto do Apps Script | biblioteca, não roda sozinho |

O primeiro coleta o gasto diário do Google Ads e grava um JSON no Drive. O
segundo lê esse JSON, busca o Meta pela Graph API, junta por cliente, desenha
o gráfico e publica. O terceiro traz as funções compartilhadas.

### Instalação

1. No Google Ads, em **cada um dos dois MCCs** (Modesto Growth Partners e
   Wondr Experience), crie um script com `google-ads-gasto.js`, ajuste `CONTAS`
   e `ARQUIVO_SAIDA` conforme os comentários, autorize e agende para as 07:00.
2. Em script.google.com, crie um projeto com `pacing-diario.gs` **e**
   `pacing-portal.gs`. Confirme o fuso `America/Sao_Paulo` e cadastre as
   propriedades `META_TOKEN`, `SUPABASE_URL` e `SUPABASE_KEY`.
3. Rode `previa()` e confira o texto no log.
4. Rode `instalarAcionador()` uma vez. Ele apaga acionadores antigos de `main`
   antes de criar o novo, para o pacing não sair em dobro.

Use System User do Business Manager no `META_TOKEN`. Token de usuário comum
expira e o pacing para num dia qualquer, sem aviso.

## De onde vêm as metas

Do `contas.json`, em `automacoes/relatorio-semanal/`, lido direto do
repositório a cada execução. É a fonte única: mudou a verba do mês, edite lá
e o pacing do dia seguinte já sai certo, sem tocar no script.

Hoje estão registradas as verbas de setembro de Wondr, Barbie, Amakha,
Alliance, Meu Rodapé e Ruminar. D&G está sem plano, e sai com o número real,
sem linha de plano e sem semáforo. Melhor não desenhar plano nenhum do que
desenhar um plano inventado.

## Decisões que afetam o número

**O dia de hoje fica de fora da média.** Ele está em curso e sempre parece um
dia fraco. Incluí-lo puxaria a projeção para baixo todo dia, sempre no mesmo
sentido. Por isso o script roda de manhã e usa até ontem.

**Falha de coleta não vira gasto zero.** Conta que não respondeu aparece com
aviso na própria mensagem. Sem isso, uma API fora do ar viraria "o cliente não
investiu", que é outra coisa. E quando *nenhuma* fonte do cliente responde, o
cliente é pulado: não sai mensagem nenhuma, só uma linha no log. Um pacing
zerado com um aviso embaixo ainda é lido como zero.

**Um System User por Business Manager.** As contas Meta estão espalhadas em
cinco BMs (WONDR, Amakha Paris, Alliance Laundry, Meu Rodapé, e as duas da
Ruminar sem BM). O `META_TOKEN` único só alcança todas se todas estiverem
compartilhadas com o BM da Modesto como parceiro. Conta fora disso volta erro
de permissão, cai em aviso, e se for a única fonte do cliente ele é pulado.

**A curva do plano é linear.** A Amakha tem curva semanal no plano
(20/25/28/21/6%), registrada no `contas.json` mas ainda não aplicada ao
gráfico. Contra a reta ela pode aparecer acima do plano sem estar.

## Destino 2: a tela de Pacing

O portal tem uma tela de Pacing no menu lateral, que lê a tabela `public.pacing`
e desenha barra por conta e canal, com o traço de onde o gasto deveria estar.
`pacing-diario.gs` grava nela a cada execução, via `gravarPacingNoPortal`.

Crie o índice único uma vez, senão cada dia insere uma linha nova em vez de
corrigir a do dia:

```sql
create unique index if not exists pacing_conta_dia_uidx
  on public.pacing (conta, dia);
```

Contrato da tabela e formato de `canais`: veja o cabeçalho de `pacing-portal.gs`.

## Enquanto não estiver instalado

O pacing não se atualiza sozinho. Até os acionadores existirem, as mensagens no
canal são as que foram geradas na mão e vão envelhecendo em silêncio, que é o
pior tipo de relatório: parece atual e não é.
