-- =====================================================================
-- DIRETÓRIO CANÔNICO DE USUÁRIOS
--
-- Problema: a policy de SELECT em profiles é "id = auth.uid() OR is_admin()".
-- Quem é cliente só enxerga o próprio registro. Resultado: no chat, o
-- cliente não consegue resolver nome nem foto de ninguém com quem fala,
-- e a plataforma cai em nomes soltos e avatares vazios.
--
-- Solução: uma view com projeção reduzida (sem checklist, sem e-mail para
-- quem não é admin) e regra de visibilidade explícita. profiles continua
-- fechado; a leitura de identidade passa a ter uma porta só.
-- =====================================================================
drop view if exists public.user_directory;

create view public.user_directory
with (security_barrier = true) as
select
  p.id,
  coalesce(nullif(btrim(p.nome), ''), split_part(coalesce(p.email,''), '@', 1), 'Sem nome') as nome,
  p.avatar_url,
  p.role,
  p.client_id,
  case when public.is_admin() then p.email else null end as email
from public.profiles p
where
      public.is_admin()                    -- a equipe vê todo mundo
   or p.id = auth.uid()                    -- todos veem a si mesmos
   or p.role = 'admin'                     -- todos veem a equipe da agência
   or (p.client_id is not null             -- e os colegas da própria empresa
       and p.client_id = public.current_client_id());

alter view public.user_directory set (security_invoker = false);

revoke all on public.user_directory from public, anon;
grant select on public.user_directory to authenticated;

comment on view public.user_directory is
  'Identidade canônica: userId -> nome, avatar, papel. Única fonte de '
  'verdade para exibir uma pessoa em qualquer tela. profiles segue fechado.';

-- anexos de mensagem (o bucket documents já existe e já é usado)
alter table public.messages add column if not exists anexos jsonb not null default '[]'::jsonb;
