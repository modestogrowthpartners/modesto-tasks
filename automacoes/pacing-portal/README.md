# Pacing no portal

O pacing diário já existe e já roda: é o **Pacing Bot MGP**, um Apps Script
vinculado à planilha de metas, que puxa Google e Meta pelo **Windsor.ai**,
posta no Slack `#controle_pacing_diário` e manda o e-mail para a diretoria,
todo dia às 8h.

Este diretório acrescenta uma terceira saída a ele: o portal.

| Arquivo | O que é |
|---|---|
| `bot-antigo-portal.gs` | **o que vale hoje.** Cola no projeto do bot e manda a leitura para o portal |
| `pacing-diario.gs`, `google-ads-gasto.js`, `pacing-portal.gs` | tentativa anterior, um coletor próprio. Ver "Por que não usamos" no fim |

## O que o encaixe faz

Ele não coleta nem calcula nada. Lê o `results` que o bot já montou e escreve
em dois lugares:

- canal `#controle-pacing-diario` do portal (id `71608354-2fbf-4edb-a95d-250063ff4498`),
  uma mensagem por bloco, com gráfico interativo
- tabela `public.pacing`, que alimenta a tela de Pacing

O bot segue sendo a única fonte do número. Se este arquivo recalculasse
qualquer coisa, um dia divergiria do Slack e ninguém saberia em qual acreditar.

## Instalação

1. No projeto do bot: **Arquivos > + > Script**, nome `portal`, cole
   `bot-antigo-portal.gs`.
2. **Configurações do projeto > Propriedades do script**, acrescente
   `SUPABASE_URL` (`https://eeqaabwsheaiwyhujcqj.supabase.co`) e `SUPABASE_KEY`
   (service_role). `WINDSOR_API_KEY` e `SLACK_BOT_TOKEN` já estão lá.
3. No Supabase, uma vez:
   ```sql
   create unique index if not exists pacing_conta_dia_uidx
     on public.pacing (conta, dia);
   ```
4. No arquivo do bot, troque o bloco dos cinco atalhos por:
   ```javascript
   function atualizarTudo()  { run_({ slack:true,  email:true,  portal:true,  manual:true }); }
   function atualizarSlack() { run_({ slack:true,  email:false, portal:false, manual:true }); }
   function enviarEmail()    { run_({ slack:false, email:true,  portal:false, manual:true }); }
   function rotinaDiaria()   { run_({ slack:true,  email:true,  portal:true,  manual:false }); }
   function testarTudo()     { run_({ slack:true,  email:true,  portal:true,  manual:false }); }
   ```
5. Dentro de `run_`, logo abaixo da linha do e-mail, acrescente:
   ```javascript
   if (opts.portal) { try { sendPortal_(results, ctx); msgs.push('Portal atualizado'); } catch (e) { msgs.push('Portal falhou: ' + e.message); Logger.log(e); } }
   ```
6. Rode `atualizarPortal()` e confira o canal.

Não precisa criar gatilho novo. O `rotinaDiaria` das 8h passa a alimentar as
três saídas.

## Se o canal recebe a mensagem e a tela de Pacing continua vazia

Foi o que aconteceu em 09/09/2026: o canal `#controle-pacing-diario` do portal
tinha as seis mensagens do dia e a tabela `public.pacing` estava sem uma linha.

`sendPortal_` faz as duas coisas em sequência, mensagem primeiro e tabela
depois, e cada bloco roda dentro do próprio `try`. Mensagem entrando e tabela
não entrando significa que `portalPacing_` levantou erro. Olhe o log da
execução: a falha aparece como `Portal, <conta>: supabase 4xx`.

As duas causas prováveis, nesta ordem:

1. **`SUPABASE_KEY` não é a `service_role`.** A tabela tinha RLS ligada e, até
   10/09/2026, nenhuma policy de escrita. Com chave anônima ou publicável o
   INSERT voltava 401/403. A migração
   `20260910080000_mgp_pacing_aceita_escrita_da_equipe.sql` acrescentou as
   policies de insert, update e delete para quem é da equipe, então uma chave
   de usuário do time também grava. `service_role` continua sendo o certo para
   um bot.
2. **Índice único ausente.** O upsert manda `resolution=merge-duplicates` e
   depende de um índice único em `(conta, dia)`. Ele existe, com o nome
   `pacing_conta_dia_key`. Se algum dia sumir, o erro é `42P10`.

## Decisões que afetam o resultado

**URL longa do QuickChart, não a curta.** O portal redesenha o gráfico com
Chart.js lendo a configuração do parâmetro `c` da URL. A URL curta não carrega
esse parâmetro, só a imagem pronta. Por isso o portal usa `chartUrlLong_` e o
Slack continua com `chartUrlShort_`, que é o que ele precisa.

**Edita a mensagem do dia, não empilha.** Reexecução no mesmo dia faz PATCH no
corpo. O canal precisa mostrar o estado de hoje, não o histórico das tentativas
de hoje. Vira mensagem nova só quando o dia vira.

**Bloco que falha não derruba os outros.** Cada cliente é publicado dentro do
próprio try. O log diz qual ficou para trás.

**Dabela e Alliance apontam para a mesma empresa nos dois blocos.** O canal
mostra e-commerce e revendedoras separados, que é como o time opera; a tela de
Pacing filtra por empresa e junta.

## A Windsor.ai não enxerga metade das contas (12/09/2026)

Conferido conta por conta contra a API do Google Ads e a do Meta, na janela
de 1 a 11/09/2026. **A Windsor devolve só 3 das 8 contas Meta, e não devolve a
conta viva do Meu Rodapé no Google.** Como o bot puxa tudo pela Windsor, o
número que vai para o Slack e para o e-mail da diretoria está subestimado.

Meta Ads, gasto de 1 a 11/09:

| Conta | Plataforma diz | Windsor diz |
|---|---:|---|
| Meta Ads \| Meu Rodapé V2 | R$ 47.196,26 | ausente |
| Barbie Experience | € 23.346,29 | ausente |
| WONDR EXPERIENCE | € 13.799,66 | ausente |
| PINK BEACH | € 2.745,37 | ausente |
| LATAM (Alliance) | US$ 1.851,29 | ausente |
| Amakha Paris #1 | R$ 11.974,29 | confere |
| Ruminar - Whatsapp | R$ 7.221,22 | confere |
| Ruminar - Lead Ad | R$ 2.094,72 | confere |

Google Ads, Meu Rodapé:

| Conta | Gasto 1 a 11/09 | Windsor |
|---|---:|---|
| 308-486-9797 (viva) | R$ 50.825,65 | ausente |
| 805-602-2205 (antiga) | R$ 8.496,32 | presente |

O efeito somado: o Meu Rodapé gastou **R$ 106.518** em setembro até o dia 11,
e pela Windsor aparecem **R$ 8.496**. Um cliente com plano de R$ 315.000/mês
sendo reportado a 8% do que realmente gastou.

Isto não é o mesmo problema da tabela `UNITS` descrito abaixo. Ali o bot
aponta para a conta errada; aqui a Windsor não entrega a conta, então trocar
o `UNITS` não resolve. **O que resolve é autorizar as contas que faltam na
Windsor.ai**, e só depois corrigir o `UNITS`.

Enquanto isso não acontecer, o pacing do portal foi preenchido na mão, a
partir das APIs das plataformas (ver "Preenchimento manual" abaixo).

## Preenchimento manual de 12/09/2026

`public.pacing` estava com zero linhas. Foram gravadas 7 linhas, uma por
empresa, com o retrato de 1 a 11/09/2026 (`dia = 2026-09-11`,
`dias_fechados = 11`, `dias_no_mes = 30`):

| Empresa | Moeda | Google | Meta | Total | Receita | ROAS |
|---|---|---:|---:|---:|---:|---:|
| Meu Rodapé | BRL | 59.321,97 | 47.196,26 | 106.518,23 | 517.388,16 | 4,86 |
| Wondr/Barbie/PB | EUR | 9.935,30 | 39.891,32 | 49.826,62 | 137.952,46 | 2,77 |
| Amakha Paris | BRL | 15.959,77 | 11.974,29 | 27.934,06 | 70.277,11 | 2,52 |
| Ruminar | BRL | — | 9.315,94 | 9.315,94 | — | — |
| Alliance Laundry | USD | 1.822,80 | 1.851,29 | 3.674,09 | — | — |
| Dolce & Gabbana | BRL | 3.034,74 | — | 3.034,74 | — | — |
| Dabela | BRL | 0,06 | — | 0,06 | — | — |

Três decisões, para quem for conferir:

**Uma linha por empresa, não uma por conta.** A tela de Pacing filtra por
empresa e usa a linha mais recente. Wondr, Barbie e Pink Beach compartilham
o mesmo `client_id`, então três linhas no mesmo dia fariam a tela mostrar uma
e esconder duas. Elas vão somadas, com `conta = 'Wondr/Barbie/PB'`.

**Receita só onde é receita.** Alliance e Ruminar reportam contagem de lead
no campo de valor (5,99 conversões = 5,99 de "valor"), e a D&G usa valor
atribuído a lead. Nesses três, `receita` e `roas` ficaram nulos em vez de
virarem um ROAS que ninguém pode usar. A tela mostra "—", que é verdade.

**De onde veio cada número.** Google pela Windsor, para ficar na mesma fonte
do bot, exceto a conta viva do Meu Rodapé, que a Windsor não tem e veio da
API do Google Ads. Meta inteiramente pela API do Meta, porque a Windsor só
tem 3 das 8 contas. Não há `roas_piso`: ele não existe em lugar nenhum que
dê para ler daqui.

Isto é um remendo com data. Quando o bot voltar a gravar, ele sobrescreve
pelo índice único `(conta, dia)` — desde que use o mesmo rótulo de `conta`,
que hoje ele não usa. Vale conferir na primeira execução.

## Divergências conhecidas no bot antigo

Achadas conferindo o `UNITS` contra a API do Google Ads em 09/09/2026. Não
foram corrigidas aqui: são do bot, e mexer nelas muda o Slack e o e-mail
também.

| O quê | Situação |
|---|---|
| Meu Rodapé, Google | `UNITS` usa `805-602-2205`, que parou de gastar em 02/09. A conta viva é `308-486-9797`. Set 1 a 8: R$ 8.496 na antiga contra R$ 33.698 na nova |
| Wondr, moeda | `cur:'R$'`, mas a conta `415-443-7131` é EUR, fuso Europe/Amsterdam. O valor está certo, o símbolo não |
| Barbie | não existe no `UNITS`. Conta Google `380-572-9384`, Meta `act_1450012306123467` |
| Amakha, Meta | `UNITS` tem `3581610182098860` além da `541549713104937`. A segunda não está no `contas.json` |
| Botoclinic | sem empresa no portal, então vai com `client_id` nulo |

## Por que não usamos o coletor próprio

`pacing-diario.gs` e `google-ads-gasto.js` foram escritos antes de eu saber que
o bot existia. Eles montam um segundo pipeline, com Graph API e Google Ads
Scripts, exigindo um `META_TOKEN` que o bot não precisa porque usa Windsor.

Dois pipelines calculando o mesmo número é pior do que nenhum: um dia divergem
e a discussão vira sobre qual está certo. Ficam no repositório como registro,
não estão instalados em lugar nenhum e não devem ser.
