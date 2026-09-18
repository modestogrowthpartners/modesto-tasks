# Backend do MGP Tasks

O que roda fora do `index.html`. Até agora isto vivia só dentro do painel
do Supabase, sem versão e sem revisão. Agora está aqui.

Projeto: `eeqaabwsheaiwyhujcqj`

## `functions/kronos`

A Edge Function do assistente. É o Claude com as ferramentas da
plataforma, e o desenho dela sustenta duas garantias que não dependem de
boa vontade do modelo:

1. **Ela herda a permissão de quem chamou.** O cliente Supabase é criado
   com a chave pública mais o `Authorization` da pessoa. Não existe
   `service_role` na função. Se alguém não pode criar uma demanda na mão,
   também não cria pelo Kronos: quem recusa é a RLS.

2. **Escrita nunca acontece dentro da conversa com o modelo.** O modelo
   só PROPÕE. A execução é uma segunda chamada, no modo `executar`,
   disparada depois que a pessoa clicou em Confirmar na tela. Por isso o
   "criei a demanda" não pode ser inventado: quem relata o resultado é o
   banco.

### Ler as conversas da plataforma

A pessoa liga isto no painel do Kronos, no botão 💬 do topo. Ligado, o
front manda `contexto.ler_conversas: true` e a função monta um
**panorama** antes da primeira chamada ao modelo: o histórico recente de
cada conversa que aquela pessoa pode ver, agrupado por canal, do canal
mais ativo para o menos ativo.

O que ele NÃO é, e é bom não prometer o contrário: não é "todas as
mensagens já enviadas na plataforma". Isso estoura a janela do modelo e o
custo de cada pergunta. Os tetos estão no topo de `panoramaDasConversas`:
14 mensagens por canal, 220 no total, 22 mil caracteres, 320 caracteres
por mensagem. O que ficar de fora sai pela ferramenta `varrer_conversas`,
que procura em todas as conversas visíveis por termo, autor, canal e
período, sem precisar do id do canal.

Três coisas seguram o risco:

- **Alcance.** A consulta roda com o token de quem perguntou, então a
  policy `can_see_channel` decide o que entra. Equipe vê canal de time e
  de cliente; cliente vê o da própria empresa; conversa direta só aparece
  para quem está dentro dela. "Ler tudo" nunca inclui a direta alheia.
- **Fronteira.** O panorama entra na instrução dentro de um bloco marcado
  como conteúdo escrito por pessoas, com a regra explícita de que é dado
  e não ordem. Sem isso, qualquer um poderia escrever uma instrução numa
  mensagem de canal e ela chegaria ao modelo como se fosse do usuário.
- **Execução.** Continua valendo a regra 2: nada é criado sem a pessoa
  confirmar na tela.

Ainda não medido: o custo por pergunta com a opção ligada. O panorama é
reenviado a cada volta do laço de ferramentas (até 6), então o candidato
óbvio a otimização é marcar a instrução com `cache_control`. Não foi
feito porque sem `ANTHROPIC_API_KEY` não há como testar se a chamada
continua válida, e quebrar o Kronos inteiro por uma economia não medida é
mau negócio.

### Segredos

| Segredo | Obrigatório | Para quê |
|---|---|---|
| `ANTHROPIC_API_KEY` | sim | sem ela a função responde `sem_chave` e a tela diz isso, em vez de fingir |
| `KRONOS_MODEL` | não | troca o modelo; o padrão é `claude-sonnet-5` |

`SUPABASE_URL` e `SUPABASE_ANON_KEY` já vêm do ambiente.

Definir em: Project Settings → Edge Functions → Secrets.

### Publicar

```
supabase functions deploy kronos --project-ref eeqaabwsheaiwyhujcqj
```

## Segurança: o que o advisor aponta e o que foi decidido

Rodado em 13/09/2026 com `get_advisors`. Três achados, nenhum deles
corrigido às cegas: cada um tem uma razão registrada aqui.

| Achado | Nível | Decisão |
|---|---|---|
| View `user_directory` é SECURITY DEFINER | erro | **Mantida de propósito.** É o diretório canônico de nomes e fotos. Ela precisa passar por cima da RLS de `profiles` para que um cliente consiga resolver o nome de quem escreveu no chat; o filtro de visibilidade está DENTRO da view (`is_admin() or id = auth.uid() or role in (admin, equipe) or mesmo client_id`), e o e-mail só sai para `is_dono()`. Trocar para `security_invoker` faria o chat do cliente mostrar "Desconhecido" em toda mensagem da equipe. |
| 19 funções SECURITY DEFINER chamáveis por `authenticated` via `/rest/v1/rpc` | aviso | **Mantidas.** As de escrita foram lidas uma a uma nesta varredura: todas checam `auth.uid()`, `is_dono()` ou `can_see_channel()` antes de tocar no banco (`mg_criar_canal`, `mg_definir_membros`, `mg_excluir_canal`, `mg_atualizar_canal`, `mg_kronos_publicar`, `mg_toggle_reaction`, `mg_abrir_grupo`, `save_my_checklist` só altera a própria linha). As auxiliares (`is_admin`, `is_dono`, `current_client_id`, `can_see_channel`, `mg_pode_ver_pessoa`) devolvem um booleano sobre quem chamou. A forma "certa" pelo linter é movê-las para um schema fora da API, o que reescreve todas as policies; o ganho não paga o risco agora. |
| Proteção contra senha vazada desligada | aviso | **Ação de painel**, não dá para ligar por aqui: Authentication → Providers → Email → "Leaked password protection". Liga e pronto. |

Conferido e em ordem, sem achado: bucket `documents` privado, com lista de
MIME e teto de 25 MB; leitura só para admin ou para a pasta da própria
empresa; cliente grava só em `<empresa>/chat/` e `<empresa>/pesquisas/`.
A chave anon está no HTML porque é pública por desenho; `service_role`
não aparece em lugar nenhum do código.

Um item continua pendente porque depende de uma máquina com saída para
o CDN: o `supabase-js` é carregado de `@2` sem versão fixa e sem SRI.
Para fixar, rode num terminal seu:

```
curl -sI https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 | grep -i x-jsd-version
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.X.Y | openssl dgst -sha384 -binary | openssl base64 -A
```

e troque a tag do `index.html` por `@2.X.Y` com `integrity="sha384-…"
crossorigin="anonymous"`. Sem isso, uma versão nova ou comprometida no
CDN entra no site sem ninguém decidir.

## Fluidez: o que foi medido e mudado

Medição com Playwright, dados de produção (452 demandas), 8 segundos
parado na tela de demandas. "Layouts" é o número de vezes que o
navegador recalculou a geometria da página.

| | CPU em 8 s | recálculos de estilo | layouts |
|---|---|---|---|
| antes | 837 ms | 482 | 482 |
| sem o fundo animado | 103 ms | 36 | 5 |
| sem fundo nem pollers | 13 ms | 5 | 0 |
| **depois das mudanças** | **58 ms** | **17** | **2** |

O que estava custando e o que mudou:

- **Fundo de marca (88% do custo).** Duas linhas fluíam por
  `stroke-dashoffset`, seis pontos subiam por `transform` em `<circle>`,
  e a marca d'água respirava por opacidade num `<g>`. Tudo em SVG passa
  pela thread principal e suja o layout a cada quadro, 60 vezes por
  segundo, em toda tela. As linhas ficaram paradas, a marca d'água ficou
  numa opacidade fixa, e os pontos viraram elementos HTML com
  `will-change`, que o compositor move sozinho. O desenho é o mesmo.
- **Pollers.** `mgPainelAberto` a cada 250 ms e `mgEstadoDaTela` a cada
  700 ms (este com `getComputedStyle`, que força recálculo). Agora um
  `MutationObserver` no `<body>` chama os dois no máximo uma vez por
  quadro, e só quando o DOM muda; sobrou um poll de 2,5 s de segurança.
- **`buildNotifs`** fazia um `find()` linear por nota: 92 ms → 33 ms com
  um mapa por id.
- **Rodada completa da sincronização** (a cada 10) repintava 450 cards
  mesmo sem mudança. Agora compara o que veio do banco com o retrato da
  última pintura e só repinta se mudou. A comparação é com o que está na
  tela, e não com a memória: salvar um card altera a memória antes de
  sincronizar, e a tela precisa acompanhar mesmo que o banco devolva o
  mesmo (caso 57d da jornada).
- **Banco.** Índice duplicado em `messages` removido e dez chaves
  estrangeiras sem índice ganharam um (migração
  `20260913100000_mgp_indices_apontados_pelo_advisor`).

Não mexido, de propósito: 29 policies que chamam `auth.uid()` sem o
`(select …)` que o advisor recomenda. É uma reescrita mecânica de todas
as policies; com o volume atual o ganho é pequeno e o risco de trancar
alguém fora não é.

## `migrations/`

Doze migrações, na ordem em que foram aplicadas. As quatro primeiras
saíram do histórico do próprio banco; as demais são as desta rodada.

| Arquivo | O que resolve |
|---|---|
| `..._chat_rls_fix_e_rpcs` | o 403 do chat, o excluir mensagem que falhava calado, e a policy de UPDATE aberta que deixava qualquer um reescrever mensagem alheia |
| `..._chat_conversa_direta_e_privada` | conversa direta era legível por qualquer admin |
| `..._diretorio_canonico_de_usuarios` | cliente não conseguia resolver nome nem foto de ninguém |
| `..._anexo_de_chat_para_cliente` | cliente anexar arquivo, só na pasta da própria empresa |
| `..._mgp_chat_conversas_e_threads` | threads, conversa direta sem duplicar, busca de mensagem |
| `..._mgp_kronos_memoria_e_auditoria` | memória e auditoria do assistente, e a publicação da resposta no canal |
| `..._mgp_perfis_sem_escalacao_e_auditoria` | escalada de papel, último admin, auditoria, limite de avatar |
| `..._mgp_perfis_gatilhos_so_para_sessao_de_usuario` | correção: os gatilhos acima trancavam a administração fora de sessão |
| `..._mgp_fecha_execute_das_funcoes` | função de gatilho deixou de ser endpoint em `/rest/v1/rpc` |
| `..._mgp_diretorio_com_data_de_entrada` | "membro desde" com data real, e canais em comum |
| `..._mgp_responsaveis_por_id` | vínculo de responsável por id, e o rename que não órfã mais as demandas |
| `..._mgp_perfil_do_lucas` | o Lucas tinha login desde julho e nunca teve perfil |
| `..._mgp_nps_pesquisas_cip_mgpr` | a tabela `mgp_pesquisas`, que guarda Pré-Discovery, Client Discovery e Revisão de Parceria |
| `..._mgp_jornada_do_cliente` | a coluna `clients.jornada`, o roadmap que o cliente vê ao entrar |
| `..._mgp_indices_apontados_pelo_advisor` | índice duplicado em `messages` fora, e dez chaves estrangeiras sem índice ganharam o seu |
| `..._mgp_owner_e_avisos` | `tasks.owner_id`, os avisos por gatilho (owner, responsável, status) e a fila `email_fila` |

## `mgp_pesquisas`

Uma tabela para os três questionários, com `tipo` separando
`pre_discovery`, `client_discovery` e `mgpr`. O que muda entre eles é o
questionário, não o ciclo de vida, e três tabelas iguais seriam três vezes
a mesma RLS para manter.

Duas garantias que não dependem da tela:

1. **A coluna `interno` nunca chega ao cliente.** A leitura da Modesto
   (continuidade do discovery, atenções, hipóteses) mora nela, e a policy
   de select do cliente devolve a linha inteira — por isso a segunda
   garantia existe.

2. **O cliente só responde.** A RLS decide a linha, não a coluna. Um
   gatilho `before update` devolve `client_id`, `tipo`, `rodada`,
   `interno`, `proxima_em` e as datas ao valor antigo quando quem grava
   não é da equipe. Ele corrige em vez de recusar: o que importa é que a
   resposta entre.

O cálculo do MGPI não está no banco. Ele é feito na tela, a partir das
chaves do jsonb, do mesmo jeito que a planilha faz a partir das células —
e está coberto por `testes/nps.mjs`.

Dois cuidados da tela que valem registrar:

- **Excluir envio.** Uma pesquisa enviada sem querer pode ser excluída pela
  equipe enquanto está em "aguardando o cliente". O `delete` vai com
  `neq('status','respondido')`: se o cliente respondeu no meio do caminho,
  o banco não apaga e a tela recarrega. Pesquisa respondida é dado do
  cliente e não se apaga pela tela. A policy de delete é `is_admin()`.
- **Salvar em PDF.** O retorno da Revisão de Parceria sempre teve o botão.
  O bloco "Respostas do cliente" (Pré-Discovery e Client Discovery, que não
  têm retorno) ganhou o mesmo: a classe `mgn-folha` só existe durante a
  impressão, e a folha de estilo de papel mostra só o bloco, sem abas nem
  botões, com um cabeçalho de empresa, pesquisa, rodada e data.

## Owner e avisos

`tasks.owner_id` é uma pessoa da equipe, uma só, acima dos responsáveis.
Coluna e não texto, porque o aviso precisa do id.

Os avisos nascem no banco, não na tela. `trg_tasks_avisos` grava em
`task_mentions` quando alguém vira owner, entra como responsável, ou quando a
demanda vai para Impeditivo/Aprovação ou Feito; vale para todo caminho que
muda a linha (janela, painel, arraste no Kanban, Kronos). A tela já entregava
`task_mentions` na hora e no sino; o que muda é o texto, pela coluna
`origem`. Quem agiu não recebe aviso da própria ação. O gatilho dispara em
`update of assignees` de propósito: a tela grava nomes e é o gatilho BEFORE
`trg_tasks_responsaveis` que sincroniza `assignee_ids`; um "update of
assignee_ids" sozinho não dispararia.

Duas regras de resiliência, aprendidas no teste: sem sessão (bot, migração,
painel) o aviso é pulado, porque `task_mentions.autor_id` é obrigatório; e
qualquer erro do aviso vira `warning`, nunca derruba a gravação da demanda.

`trg_mencao_email` transforma cada `task_mentions` numa linha de
`email_fila`, com o e-mail do alvo lido de `auth.users` (por isso SECURITY
DEFINER), assunto, corpo e o link `#demanda=<id>`. A fila tem RLS ligada e
nenhuma policy: só a chave de serviço enxerga. Quem envia é o Apps Script em
`automacoes/avisos-email`, pelo Gmail, a cada 5 minutos.

## `clients.jornada`

O roadmap da empresa, em coluna e não em tabela nova: existe no máximo uma
por empresa e é sempre lida junto dela, então uma tabela separada custaria um
segundo SELECT em toda tela e uma segunda RLS para manter alinhada com a de
`clients` — que já diz exatamente quem pode o quê (`select`: admin ou a
própria empresa; `update`: `is_dono()`). O cliente lê a própria jornada e não
escreve nela, sem policy nova.

Os rótulos das etapas NÃO ficam no banco. Ficam no catálogo da tela, junto da
descrição que o cliente lê: guardar texto de interface no banco faria toda
correção de redação virar um UPDATE em todas as empresas.

`visivel` é o que decide o que o cliente enxerga. É por isso que ele começa
vendo só o andamento do cadastro e vai ganhando etapa conforme o diagnóstico,
a proposta e o kickoff acontecem.

Uma ressalva sobre a trava de "só o Vinícius configura": ela vive no front e
é um guarda-corpo, não uma fronteira. Qualquer `admin` pode renomear um perfil
pela aba Equipe e passar por ela. A trava real é a policy, que exige
`role = 'admin'` para escrever em `clients`. Para uma trava por pessoa de
verdade seria preciso uma coluna de permissão em `profiles` e uma policy que
a leia — não dá para fazer só no front, e essa coluna não foi inventada aqui.

## Pendências

A lista de pendências de configuração saiu daqui. Este repositório é
público, e um inventário de configurações fracas num repositório público
é um roteiro pronto para quem quiser tentar alguma coisa.

Elas estão descritas na conversa com o time e devem ser tratadas no
painel do Supabase. Em resumo, sem detalhar o que está aberto: revisar as
opções de Authentication, o limite do bucket de Storage e o fluxo de
remoção de acesso, que hoje apaga o perfil mas não o login.
