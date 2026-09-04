-- =====================================================================
-- CHAT — correcao de RLS e funcoes de apoio
-- Causa do 403: o upsert de channel_members (on_conflict) exige policy de
-- UPDATE, e so existia chm_upd_propria (linha do proprio usuario).
-- =====================================================================

-- 1. admin gerencia membros de canal
drop policy if exists chm_upd_admin on public.channel_members;
create policy chm_upd_admin on public.channel_members
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists chm_del_admin on public.channel_members;
create policy chm_del_admin on public.channel_members
  for delete using (public.is_admin());

drop policy if exists chm_del_propria on public.channel_members;
create policy chm_del_propria on public.channel_members
  for delete using (profile_id = auth.uid());

-- 2. mensagens: apagar e editar as proprias (nao existia policy de DELETE,
--    entao "excluir mensagem" falhava em silencio)
drop policy if exists msg_del on public.messages;
create policy msg_del on public.messages
  for delete using (author_id = auth.uid() or public.is_admin());

drop policy if exists msg_upd_propria on public.messages;
create policy msg_upd_propria on public.messages
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

-- 3. reacoes deixam de exigir UPDATE aberto na tabela.
--    A policy antiga (using true / with check true) permitia que qualquer
--    pessoa reescrevesse o corpo de qualquer mensagem.
drop policy if exists messages_update_reagir on public.messages;

create or replace function public.mg_toggle_reaction(p_message uuid, p_emoji text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_cid uuid;
  v_r   jsonb;
  v_arr jsonb;
begin
  if v_uid is null then raise exception 'sem sessao'; end if;
  select channel_id, coalesce(reactions, '{}'::jsonb) into v_cid, v_r
    from public.messages where id = p_message;
  if v_cid is null then raise exception 'mensagem nao encontrada'; end if;
  if not public.can_see_channel(v_cid) then raise exception 'sem acesso ao canal'; end if;

  v_arr := coalesce(v_r -> p_emoji, '[]'::jsonb);
  if v_arr ? v_uid::text then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_arr
      from jsonb_array_elements(v_arr) x where x <> to_jsonb(v_uid::text);
  else
    v_arr := v_arr || to_jsonb(v_uid::text);
  end if;

  if jsonb_array_length(v_arr) = 0 then
    v_r := v_r - p_emoji;
  else
    v_r := jsonb_set(v_r, array[p_emoji], v_arr);
  end if;

  update public.messages set reactions = v_r where id = p_message;
  return v_r;
end $$;

revoke all on function public.mg_toggle_reaction(uuid, text) from public;
grant execute on function public.mg_toggle_reaction(uuid, text) to authenticated;

-- 4. nao lidas em uma chamada so (antes o app baixava 400 mensagens
--    a cada abertura do chat para contar)
create or replace function public.mg_unread()
returns table(channel_id uuid, nao_lidas bigint, ultima timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select m.channel_id,
         count(*) filter (
           where m.author_id is distinct from auth.uid()
             and m.created_at > coalesce(cm.last_read_at, timestamptz 'epoch')
         ) as nao_lidas,
         max(m.created_at) as ultima
    from public.messages m
    left join public.channel_members cm
      on cm.channel_id = m.channel_id and cm.profile_id = auth.uid()
   where public.can_see_channel(m.channel_id)
   group by m.channel_id;
$$;

revoke all on function public.mg_unread() from public;
grant execute on function public.mg_unread() to authenticated;

-- 5. indices de leitura
create index if not exists messages_canal_data_idx on public.messages (channel_id, created_at);
create index if not exists channel_members_perfil_idx on public.channel_members (profile_id);
