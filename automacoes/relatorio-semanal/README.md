# Relatório semanal de otimizações e tarefas

Post automático toda **sexta-feira às 16h (America/Sao_Paulo)**, com o mesmo
texto em dois lugares:

| Destino | Canal | Id |
|---|---|---|
| Slack | `#resumo_otmizações_e_tarefas` | `C0C0H9AGT8U` |
| Portal (modestopartners.com.br) | `#resumo-otimizacoes-e-tarefas` | `d40d1fd3-2a32-42da-8bff-f2235a75fc5e` |

O texto é idêntico nos dois e não precisa de conversão: o portal usa a mesma
marcação do Slack (`*negrito*`, `_itálico_`, `` `código` ``, `~riscado~`), como
se vê na função `corpoHTML` do `index.html`.

O canal do portal é de **equipe**, não de cliente, e isso é proposital: o post
junta todos os clientes, e canal do tipo `client` é visível para o cliente.
Publicar ali vazaria informação de um cliente para outro.

## Como o envio automático acontece

Duas rotas, e elas não são equivalentes.

**Rota A, recomendada: Apps Script.** Roda sozinha, sem depender do Claude, com
acionador nativo do Google. São dois arquivos neste diretório:

| Arquivo | Onde roda | Quando |
|---|---|---|
| `google-ads-script.js` | Google Ads Scripts, dentro do MCC | sexta, 15:30 |
| `apps-script.gs` | Apps Script (script.google.com) | sexta, 16:00 |

O primeiro coleta o Google Ads e grava um JSON no Drive. O segundo lê esse JSON,
busca Meta e MGP Tasks, monta o post e publica. Instalação:

1. No Google Ads, em cada um dos dois MCCs (Modesto Growth Partners e Wondr
   Experience), crie um script com o conteúdo de `google-ads-script.js`, ajuste
   `CONTAS` e `ARQUIVO_SAIDA` conforme os comentários, autorize e agende para
   sexta às 15:30.
2. Em script.google.com, crie um projeto com `apps-script.gs`. Em Configurações
   do projeto, confirme o fuso `America/Sao_Paulo` e cadastre as quatro
   propriedades de script: `META_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`,
   `SLACK_TOKEN`.
3. Rode `previa()` uma vez e confira o texto no log antes de agendar.
4. Crie o acionador semanal de `main` para sexta, 16h.

Sobre o `META_TOKEN`: use System User do Business Manager, com `ads_read`. Token
de usuário comum expira e o relatório para de sair numa sexta qualquer, sem aviso.

**Rota B, ponte: Routine do Claude Code.** Existe uma Routine agendada
(`0 19 * * 5` em UTC, que é 16h em Brasília) que acorda a sessão do Claude e
manda executar o procedimento deste README. Funciona, mas é frágil por um motivo
concreto: a criação de Routine por API não consegue anexar conectores MCP nesta
organização, então ela depende de disparar numa sessão que já tenha Slack,
Pipeboard e Supabase carregados. Sessão remota é efêmera. Trate a rota B como
ponte até a rota A estar no ar, e confira o resultado nas primeiras semanas.

## O que entra no post

**BLOCO 1 — Otimizações da semana.** O que o time mexeu nas contas de mídia,
puxado do histórico de alterações de cada plataforma.

**BLOCO 2 — Tarefas da semana.** O que andou no MGP Tasks, puxado do Supabase
(`eeqaabwsheaiwyhujcqj`).

Nos dois blocos os clientes aparecem sempre na mesma ordem, a mesma do
`contas.json`: Wondr, Barbie, Amakha, Alliance, Meu Rodapé, D&G, Dabela,
Ruminar, Botoclinic.

Cliente sem nada na semana entra assim mesmo, com um travessão. A ausência é
informação: mostra conta parada.

## Janela

De **segunda-feira 00:00** até **sexta-feira 16:00**, fuso de Brasília. O que
acontecer depois das 16h de sexta cai no relatório da semana seguinte.

**Converta a janela para o fuso de cada conta antes de consultar.** O
`change_date_time` do Google Ads vem no fuso da conta, não em Brasília, e as
contas não estão todas no mesmo fuso:

| Conta | Fuso | 16h de Brasília equivale a |
|---|---|---|
| Wondr, Barbie | Europe/Amsterdam | 21:00 (horário de verão) / 20:00 |
| Alliance (LATAM) | America/Chicago | 14:00 |
| MEU RODAPÉ - ANTIGA | America/Los_Angeles | 12:00 |
| Amakha, Meu Rodapé, D&G | America/Sao_Paulo | 16:00 |

Usar 16:00 cru em conta europeia corta cinco horas de trabalho do relatório, e
o corte é silencioso: nada indica que ficou de fora. O Meta aceita ISO 8601 com
fuso em `since`/`until`, o que evita o problema.

## Fonte de cada dado

| Plataforma | Como puxa | Cobertura real |
|---|---|---|
| Google Ads | `execute_google_ads_gaql_query` no recurso `change_event` | Só os últimos 30 dias, teto de 10 mil eventos por consulta. Traz e-mail de quem alterou e valor antes/depois. |
| Meta Ads | `get_account_activities` (Activity Log) | Traz nome de quem alterou e valor antes/depois em **unidade menor da moeda** (2760 = R$ 27,60). |
| TikTok Ads | não há | A API do TikTok Business não expõe log de alterações. As 3 contas (Wondr, Barbie, Amakha) ficam de fora do BLOCO 1. Se houver mudança relevante, o time registra como tarefa. |
| MGP Tasks | SQL no Supabase | Tabelas `tasks` e `task_notes`. |

## Procedimento

### BLOCO 1

Para cada conta Google Ads do `contas.json`:

```sql
SELECT change_event.change_date_time, change_event.change_resource_type,
       change_event.resource_change_operation, change_event.changed_fields,
       change_event.old_resource, change_event.new_resource,
       change_event.user_email, campaign.name
FROM change_event
WHERE change_event.change_date_time >= '<segunda> 00:00:00'
  AND change_event.change_date_time <= '<sexta> 16:00:00'
  AND change_event.change_resource_type IN
      ('CAMPAIGN','CAMPAIGN_BUDGET','AD_GROUP','CAMPAIGN_CRITERION',
       'AD_GROUP_CRITERION','CAMPAIGN_BIDDING_STRATEGY')
ORDER BY change_event.change_date_time DESC
LIMIT 200
```

`old_resource` e `new_resource` só vêm preenchidos quando pedidos no SELECT, e são
o que permite dizer "R$ 400 para R$ 520" em vez de "orçamento alterado".
`amountMicros` divide por 1.000.000.

Criativo (`AD`, `AD_GROUP_AD`, `ASSET`) fica fora do filtro acima porque uma única
troca de anúncio gera dezenas de eventos e afoga o resto. Para contar criativo,
rodar uma segunda consulta só com esses tipos e reportar o total agregado, nunca
evento a evento.

Para cada conta Meta, `get_account_activities` com `since`/`until` da janela,
`limit=25`, `max_pages=4`, e **sempre com `category`**. A chamada aceita uma
categoria por vez, então rode uma por conta para `BUDGET`, `STATUS` e
`TARGETING`, nesta ordem de prioridade.

Chamar sem `category` não funciona na prática: numa conta movimentada a resposta
passa de 50 mil caracteres e é rejeitada por exceder o limite de tokens, porque
vem afogada em ruído que não é otimização — `first_delivery_event`,
`ad_account_billing_charge`, `funding_event_successful` e `edit_images`, este
último carregando URLs assinadas de CDN com centenas de caracteres cada.

Restrinja também `fields` a `event_time,event_type,actor_name,object_name,extra_data`.

Descartar linhas com `actor_name` igual a `Meta`: são eventos automáticos da
plataforma, não otimização do time. Conferir `coverage.truncated` antes de
concluir que a janela veio inteira.

### BLOCO 2

```sql
select c.nome as cliente, t.title, t.status, t.priority, t.urgente,
       t.created_at, t.completed_at
from public.tasks t
left join public.clients c on c.id = t.client_id
where t.archived = false
  and (t.created_at >= '<segunda>' or t.completed_at >= '<segunda>')
order by c.nome, t.completed_at desc nulls last
```

Atenção: **não filtrar por `updated_at`**. Em 08/09/2026 uma alteração em massa
tocou 425 das 443 linhas da tabela, o que torna esse campo inútil como sinal de
"mexeu nesta semana". `created_at` e `completed_at` são confiáveis.

Complementar com `task_notes` da janela, que é onde o time descreve o que foi
feito:

```sql
select t.client_id, c.nome as cliente, t.title, n.author_name, n.body, n.created_at
from public.task_notes n
join public.tasks t on t.id = n.task_id
left join public.clients c on c.id = t.client_id
where n.created_at >= '<segunda>' and n.visibility <> 'private'
order by n.created_at desc
```

Nota `private` fica fora: é anotação interna de quem escreveu.

## Formato do post

```
*RESUMO DA SEMANA — DD/MM a DD/MM*

*BLOCO 1 — Otimizações da semana*

*Wondr:*
• Google: <o que mudou, com valor antes/depois quando houver> — <quem>
• Meta: <...> — <quem>

*Barbie:*
• —

[... demais clientes na ordem fixa ...]

*BLOCO 2 — Tarefas da semana*

*Wondr:* 4 concluídas, 2 abertas
• Concluído: <título>
• Em aberto: <título> (<status>)

[... demais clientes na ordem fixa ...]

_Fontes: Google Ads change history, Meta Ads activity log, MGP Tasks. TikTok não expõe histórico de alterações via API._
```

Regras de escrita, porque o post é lido por gente com pressa:

- Agregar. "6 campanhas com orçamento ajustado" vale mais que seis linhas iguais.
- Valor sempre que a API entregar, com a moeda certa da conta (EUR em Wondr e
  Barbie, USD em Alliance, BRL no resto).
- Nome de pessoa, não e-mail: `everton.medeiros@modestogrowth.com.br` vira
  `Everton`.
- Nunca inventar o motivo de uma mudança. O log diz o que mudou, não por quê.
- Se uma conta falhar na coleta, dizer isso na linha dela. Silêncio vira
  "não teve mexida", que é diferente de "não consegui ler".

## Manutenção

Entrou cliente, saiu conta, mudou o canal: editar `contas.json`. O procedimento
não muda.

Para conferir ou alterar a Routine, use as ferramentas de trigger do Claude Code
(`list_triggers`, `update_trigger`). O prompt dela aponta para este arquivo, então
mudança de conteúdo se faz aqui, não no trigger.

## Limites conhecidos

- Google Ads guarda change history por **30 dias**. Semana perdida não se
  recupera depois.
- TikTok não tem log de alteração na API.
- Dabela e Botoclinic não têm conta de mídia conectada ao Pipeboard. Dabela
  aparece só no BLOCO 2; Botoclinic não existe nem como cliente no Supabase.
- O Activity Log do Meta falha com frequência em janelas largas. Por isso
  `limit=25` e paginação, e por isso vale checar `coverage.truncated`.
