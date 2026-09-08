-- =====================================================================
-- Anotação da demanda com anexo, e a demanda com raiz no MGP Chat
--
-- 1. task_notes.anexos   · o print colado na anotação
-- 2. tasks.chat_msg_id   · qual mensagem do chat representa esta demanda
-- 3. visibilidade em três níveis: private / equipe / public
-- 4. correção: notes_update estava sem with_check, dava para mover a
--    anotação para a demanda de outro cliente
-- =====================================================================

alter table public.task_notes
  add column if not exists anexos jsonb not null default '[]'::jsonb;

alter table public.tasks
  add column if not exists chat_msg_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_chat_msg_id_fkey') then
    alter table public.tasks
      add constraint tasks_chat_msg_id_fkey
      foreign key (chat_msg_id) references public.messages(id) on delete set null;
  end if;
end $$;

-- private = só o autor · equipe = o time · public = o cliente também vê
alter table public.task_notes drop constraint if exists task_notes_visibility_ok;
alter table public.task_notes
  add constraint task_notes_visibility_ok
  check (visibility in ('private','equipe','public'));

drop policy if exists notes_select on public.task_notes;
create policy notes_select on public.task_notes for select using (
  exists (
    select 1 from public.tasks t
     where t.id = task_notes.task_id
       and (public.is_admin() or t.client_id = public.current_client_id())
  )
  and (
    author_id = auth.uid()
    or (public.is_admin() and visibility in ('public','equipe'))
    or (not public.is_admin() and visibility = 'public')
  )
);

drop policy if exists notes_update on public.task_notes;
create policy notes_update on public.task_notes for update
using (author_id = auth.uid() or public.is_admin())
with check (
  exists (
    select 1 from public.tasks t
     where t.id = task_notes.task_id
       and (public.is_admin() or t.client_id = public.current_client_id())
  )
);

create or replace function public.task_notes_imutaveis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id         := old.id;
  new.task_id    := old.task_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists task_notes_sem_troca on public.task_notes;
create trigger task_notes_sem_troca
  before update on public.task_notes
  for each row execute function public.task_notes_imutaveis();

-- a raiz da demanda no MGP Chat é da equipe: o cliente não escolhe
create or replace function public.tasks_cliente_sem_campo_de_equipe()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then return new; end if;
  if public.is_admin()  then return new; end if;

  new.client_id    := public.current_client_id();
  new.status       := 'Não iniciado';
  new.priority     := 'Média';
  new.urgente      := false;
  new.archived     := false;
  new.assignees    := '{}'::text[];
  new.assignee_ids := '{}'::uuid[];
  new.time_spent   := 0;
  new.timer_start  := null;
  new.completed_at := null;
  new.position     := coalesce(new.position, 0);

  if tg_op = 'UPDATE' then new.chat_msg_id := old.chat_msg_id;
  else                     new.chat_msg_id := null; end if;

  if new.project_id is not null and not exists (
       select 1 from public.projects p
        where p.id = new.project_id and p.client_id = new.client_id) then
    new.project_id := null;
  end if;
  if new.parent_id is not null and not exists (
       select 1 from public.tasks t
        where t.id = new.parent_id and t.client_id = new.client_id) then
    new.parent_id := null;
  end if;

  return new;
end $function$;
