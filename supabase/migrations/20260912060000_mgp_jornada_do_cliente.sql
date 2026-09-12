-- =====================================================================
-- Jornada do cliente — o roadmap que ele vê ao entrar
--
-- O cliente entra na plataforma e não sabe em que ponto do trabalho está.
-- A jornada resolve isso: uma lista de etapas com situação e data, montada
-- no cadastro da empresa e atualizada conforme o trabalho anda.
--
-- Por que uma coluna em `clients` e não uma tabela nova: a jornada é um
-- atributo da empresa, existe no máximo uma por empresa, e é sempre lida
-- junto com ela. Uma tabela separada significaria um segundo SELECT em toda
-- tela que mostra a empresa, e uma segunda RLS para manter alinhada com a
-- de `clients` — que já diz exatamente quem pode ver o quê:
--
--   select : is_admin() OR id = current_client_id()
--   update : is_dono()   (role = 'admin')
--
-- Então o cliente lê a própria jornada e não escreve nela, sem nenhuma
-- policy nova. Quem configura precisa ser admin.
--
-- Formato:
--   {
--     "etapas": [
--       {"id":"cadastro","status":"concluido","data":"2026-09-12","visivel":true},
--       {"id":"pre_discovery","status":"andamento","data":null,"visivel":true}
--     ],
--     "atualizado_em": "2026-09-12T12:00:00Z"
--   }
--
-- O rótulo de cada etapa NÃO fica aqui. Ele vive no catálogo da tela, junto
-- da descrição que o cliente lê. Guardar texto de interface no banco faria
-- toda correção de redação virar um UPDATE em todas as empresas.
--
-- `visivel` é o que o cliente enxerga. Etapa invisível continua existindo
-- para a equipe: é assim que "o cliente vê só o andamento do cadastro" no
-- começo e vai ganhando etapa conforme o trabalho avança.
-- =====================================================================
alter table public.clients
  add column if not exists jornada jsonb not null default '{}'::jsonb;

comment on column public.clients.jornada is
  'Roadmap da empresa: {etapas:[{id,status,data,visivel}], atualizado_em}. '
  'status = pendente|andamento|concluido. visivel decide o que o cliente vê. '
  'Rótulos e descrições ficam no catálogo da tela, não aqui.';
