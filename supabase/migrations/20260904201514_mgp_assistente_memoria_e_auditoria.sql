-- Conversa do usuário com o Kronos no painel flutuante.
create table if not exists public.assistant_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  papel      text not null check (papel in ('user','assistant','sistema')),
  conteudo   text not null default '',
  dados      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_user_idx
  on public.assistant_messages(user_id, created_at);
alter table public.assistant_messages enable row level security;

drop policy if exists am_sel on public.assistant_messages;
drop policy if exists am_ins on public.assistant_messages;
drop policy if exists am_del on public.assistant_messages;
create policy am_sel on public.assistant_messages for select using (user_id = auth.uid());
create policy am_ins on public.assistant_messages for insert with check (user_id = auth.uid());
create policy am_del on public.assistant_messages for delete using (user_id = auth.uid());

-- Registro de toda ação de escrita que o Kronos executou, com o
-- resultado real. Serve de auditoria e é o que permite afirmar depois
-- se algo aconteceu ou não.
create table if not exists public.assistant_actions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  ferramenta  text not null,
  argumentos  jsonb not null default '{}'::jsonb,
  status      text not null default 'pendente'
              check (status in ('pendente','ok','erro','cancelada')),
  resultado   jsonb not null default '{}'::jsonb,
  erro        text,
  created_at  timestamptz not null default now()
);
create index if not exists assistant_actions_user_idx
  on public.assistant_actions(user_id, created_at desc);
alter table public.assistant_actions enable row level security;

drop policy if exists aa_sel on public.assistant_actions;
drop policy if exists aa_ins on public.assistant_actions;
create policy aa_sel on public.assistant_actions for select
  using (user_id = auth.uid() or public.is_admin());
create policy aa_ins on public.assistant_actions for insert
  with check (user_id = auth.uid());

-- Resposta do Kronos publicada dentro de um canal, sem autor humano.
-- Continua respeitando can_see_channel: só publica onde quem pediu já lê.
create or replace function public.mg_kronos_publicar(
  p_canal uuid, p_texto text, p_reply_to uuid default null)
returns public.messages language plpgsql security definer set search_path to 'public' as $$
declare v public.messages;
begin
  if auth.uid() is null then
    raise exception 'sem sessão' using errcode = '42501';
  end if;
  if not public.can_see_channel(p_canal) then
    raise exception 'sem acesso a esta conversa' using errcode = '42501';
  end if;
  if coalesce(btrim(p_texto),'') = '' then
    raise exception 'resposta vazia' using errcode = '22023';
  end if;
  if p_reply_to is not null and not exists (
       select 1 from public.messages m where m.id = p_reply_to and m.channel_id = p_canal) then
    raise exception 'mensagem de origem não pertence a esta conversa' using errcode = '22023';
  end if;

  insert into public.messages (channel_id, author_id, author_name, body, kind, reply_to)
       values (p_canal, null, 'Kronos', p_texto, 'kronos', p_reply_to)
    returning * into v;
  return v;
end;
$$;

revoke all on function public.mg_kronos_publicar(uuid,text,uuid) from public;
grant execute on function public.mg_kronos_publicar(uuid,text,uuid) to authenticated;
