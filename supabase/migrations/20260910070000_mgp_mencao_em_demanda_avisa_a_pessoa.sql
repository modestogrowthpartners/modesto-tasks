-- Menção com @ na descrição ou na anotação de uma demanda.
--
-- Por que uma tabela em vez de varrer o texto no front: quem é mencionado
-- precisa ser avisado mesmo estando com a plataforma fechada, e precisa
-- continuar vendo o aviso depois. Texto dentro de outro campo não dá gancho
-- nem para o realtime nem para "já li".
create table if not exists public.task_mentions (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id)      on delete cascade,
  note_id    uuid          references public.task_notes(id) on delete cascade,
  origem     text not null default 'nota',      -- 'nota' | 'descricao'
  autor_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  autor_nome text,
  alvo_id    uuid not null references auth.users(id) on delete cascade,
  trecho     text,
  lida       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists task_mentions_alvo_idx
  on public.task_mentions (alvo_id, lida, created_at desc);
create index if not exists task_mentions_task_idx
  on public.task_mentions (task_id);

-- a mesma pessoa não é marcada duas vezes pela mesma anotação
create unique index if not exists task_mentions_nota_uidx
  on public.task_mentions (note_id, alvo_id) where note_id is not null;

alter table public.task_mentions enable row level security;

-- Quem lê: só quem foi marcado e quem marcou. Admin de propósito fica de
-- fora: menção é conversa entre duas pessoas, não registro de auditoria.
drop policy if exists mentions_select on public.task_mentions;
create policy mentions_select on public.task_mentions
  for select using (alvo_id = auth.uid() or autor_id = auth.uid());

-- Quem marca: só o time, e só em demanda que ele enxerga.
drop policy if exists mentions_insert on public.task_mentions;
create policy mentions_insert on public.task_mentions
  for insert with check (
    autor_id = auth.uid()
    and is_admin()
    and exists (select 1 from public.tasks t where t.id = task_id and is_admin())
  );

-- Marcar como lida é do dono do aviso.
drop policy if exists mentions_update on public.task_mentions;
create policy mentions_update on public.task_mentions
  for update using (alvo_id = auth.uid()) with check (alvo_id = auth.uid());

drop policy if exists mentions_delete on public.task_mentions;
create policy mentions_delete on public.task_mentions
  for delete using (autor_id = auth.uid() or alvo_id = auth.uid());

-- o aviso precisa chegar na hora
alter publication supabase_realtime add table public.task_mentions;
