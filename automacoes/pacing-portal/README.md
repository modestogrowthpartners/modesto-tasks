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
