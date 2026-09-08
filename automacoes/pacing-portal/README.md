# Pacing no portal

O Pacing Bot MGP já roda e publica todo dia às 09:40 no Slack, em
`#controle_pacing_diário`. Isto aqui leva o mesmo pacing para o portal
(modestopartners.com.br), em dois lugares, e os dois valem a pena por motivos
diferentes.

## Destino 1: o canal (o que foi pedido)

Canal de equipe `#controle-pacing-diario`, id `71608354-2fbf-4edb-a95d-250063ff4498`,
com os seis da equipe dentro. É o espelho do canal do Slack: mesma mensagem,
mesmo horário.

A marcação é a mesma do Slack (`*negrito*`, `_itálico_`, `` `código` ``), então o
texto que o bot já monta serve sem conversão. Duas diferenças que valem atenção:

- **Emoji em código não renderiza.** O portal mostra `:large_orange_circle:`
  como texto literal. Troque por emoji de verdade (🟠 🔴 🟢 ⚠️) antes de mandar.
- **Gráfico do QuickChart vira link, não imagem.** O corpo da mensagem no portal
  é texto. Se o gráfico importa, o destino 2 resolve melhor.

## Destino 2: a tabela `pacing` (o que eu recomendo)

O portal **já tem uma tela de Pacing pronta**, no menu lateral, e ela está vazia
esperando dados. Ela lê `public.tabela pacing` dos últimos 45 dias e desenha, por
conta e canal, uma barra de quanto foi gasto com um traço vertical em quanto
deveria ter sido gasto até hoje, mais um mini gráfico dos últimos dias, sem
depender de serviço externo. Hoje a tabela tem zero linhas, então a tela mostra
o aviso de vazio.

Ou seja: o trabalho de desenhar já foi feito. Falta o bot gravar.

Uma linha por conta e por dia:

| Coluna | Tipo | Exemplo |
|---|---|---|
| `conta` | text | `Meu Rodapé` |
| `client_id` | uuid | opcional, liga ao cliente e mostra o nome da empresa |
| `dia` | date | `2026-09-08` |
| `mes` | text | `2026-09` |
| `moeda` | text | `BRL`, `USD`, `EUR` |
| `dias_fechados` | int | `8` |
| `dias_no_mes` | int | `30` |
| `canais` | jsonb | veja abaixo |
| `receita` | numeric | `941184` |
| `pedidos` | int | `2201` |
| `conversoes` | int | para conta de lead, em vez de receita |
| `roas` | numeric | `6.93` |
| `roas_piso` | numeric | `4.5` |

`canais` é um array, um item por plataforma:

```json
[
  { "canal": "Google Ads", "investido": 69435, "meta": 162000, "situacao": "ok" },
  { "canal": "Meta Ads",   "investido": 66311, "meta": 138000,
    "situacao": "acima", "sugestao_dia": 3983 }
]
```

`situacao` aceita exatamente três valores, e qualquer outra coisa cai em "no ritmo":

| Valor | Como aparece na tela |
|---|---|
| `ok` | No ritmo, verde |
| `abaixo` | Abaixo do ritmo, laranja |
| `acima` | Gastando rápido, vermelho |

`sugestao_dia` é opcional. Quando vem, a tela escreve sozinha "reduzir o teto
para R$ X/dia para fechar o mês na meta", com a seta no sentido certo.

`meta` ausente ou zero é tratado como conta sem meta: mostra o número real, sem
barra e sem semáforo. É o caso de Wondr e Botoclinic hoje.

## Como ligar

Em `pacing-portal.gs` estão as duas funções prontas. Cole no projeto do Pacing
Bot que já existe e chame depois de montar o texto de cada conta:

```javascript
gravarPacingNoPortal(linha);         // alimenta a tela de Pacing
publicarPacingNoCanal(texto);        // espelha a mensagem no canal
```

O bot precisa das mesmas propriedades de script que o relatório semanal usa:
`SUPABASE_URL` e `SUPABASE_KEY`. Se os dois scripts estiverem no mesmo projeto,
já estão lá.

`gravarPacingNoPortal` faz upsert por `conta` + `dia`, então rodar duas vezes no
mesmo dia corrige a linha em vez de duplicar. Para isso funcionar, crie o índice
único uma vez:

```sql
create unique index if not exists pacing_conta_dia_uidx
  on public.pacing (conta, dia);
```
