-- Personalização de canal: ícone e descrição ao lado da cor que já existia.
alter table public.channels add column if not exists icone     text;
alter table public.channels add column if not exists descricao text;

-- Prévia da última mensagem de cada conversa, para a lista de conversas
-- diretas ficar no espírito do Slack sem baixar o histórico inteiro só
-- para mostrar uma linha. Uma consulta em vez de uma por conversa.
create or replace function public.mg_ultimas()
returns table(channel_id uuid, corpo text, autor_id uuid, autor_nome text,
              kind text, tem_anexo boolean, em timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (m.channel_id)
         m.channel_id, left(coalesce(m.body,''), 160), m.author_id, m.author_name,
         m.kind, coalesce(jsonb_array_length(m.anexos), 0) > 0, m.created_at
    from public.messages m
   where public.can_see_channel(m.channel_id)
   order by m.channel_id, m.created_at desc;
$$;
revoke all on function public.mg_ultimas() from public, anon;
grant execute on function public.mg_ultimas() to authenticated;

-- Conversa em grupo: mesma ideia da direta, com N pessoas. A identidade
-- é o CONJUNTO de membros, então chamar de novo com as mesmas pessoas
-- reencontra a conversa em vez de criar outra.
create or replace function public.mg_abrir_grupo(p_ids uuid[], p_nome text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_eu uuid := auth.uid(); v_todos uuid[]; v_id uuid; v_nome text; v uuid;
begin
  if v_eu is null then raise exception 'sem sessão' using errcode = '42501'; end if;
  select array_agg(distinct x) into v_todos
    from unnest(coalesce(p_ids, '{}'::uuid[]) || v_eu) as x;
  if array_length(v_todos, 1) < 2 then
    raise exception 'escolha ao menos uma pessoa' using errcode = '22023';
  end if;
  if array_length(v_todos, 1) > 12 then
    raise exception 'no máximo 12 pessoas por conversa' using errcode = '22023';
  end if;
  foreach v in array v_todos loop
    if not exists (select 1 from public.profiles where id = v) then
      raise exception 'pessoa não encontrada' using errcode = 'P0002';
    end if;
    if not public.mg_pode_ver_pessoa(v) then
      raise exception 'sem permissão para falar com esta pessoa' using errcode = '42501';
    end if;
  end loop;
  select c.id into v_id from public.channels c
   where c.tipo = 'dm'
     and (select count(*) from public.channel_members m where m.channel_id = c.id)
         = array_length(v_todos, 1)
     and not exists (select 1 from unnest(v_todos) as t(id)
        where not exists (select 1 from public.channel_members m
                           where m.channel_id = c.id and m.profile_id = t.id))
   order by c.created_at limit 1;
  if v_id is not null then return v_id; end if;
  select string_agg(nome, ', ' order by nome) into v_nome
    from public.user_directory where id = any(v_todos);
  insert into public.channels (tipo, nome, created_by)
       values ('dm', coalesce(nullif(btrim(coalesce(p_nome,'')),''), v_nome, 'Conversa'), v_eu)
    returning id into v_id;
  insert into public.channel_members (channel_id, profile_id)
       select v_id, x from unnest(v_todos) as x;
  return v_id;
end $$;
revoke all on function public.mg_abrir_grupo(uuid[],text) from public, anon;
grant execute on function public.mg_abrir_grupo(uuid[],text) to authenticated;

-- Excluir canal: só admin, e nunca conversa direta de outras pessoas.
create or replace function public.mg_excluir_canal(p_canal uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_tipo text;
begin
  if not public.is_admin() then
    raise exception 'só administrador pode excluir canal' using errcode = '42501';
  end if;
  select tipo into v_tipo from public.channels where id = p_canal;
  if v_tipo is null then
    raise exception 'canal não encontrado' using errcode = 'P0002';
  end if;
  if v_tipo = 'dm' and not exists (select 1 from public.channel_members m
        where m.channel_id = p_canal and m.profile_id = auth.uid()) then
    raise exception 'não dá para excluir conversa direta de outras pessoas' using errcode = '42501';
  end if;
  delete from public.messages       where channel_id = p_canal;
  delete from public.channel_members where channel_id = p_canal;
  delete from public.channels       where id = p_canal;
  return true;
end $$;
revoke all on function public.mg_excluir_canal(uuid) from public, anon;
grant execute on function public.mg_excluir_canal(uuid) to authenticated;
