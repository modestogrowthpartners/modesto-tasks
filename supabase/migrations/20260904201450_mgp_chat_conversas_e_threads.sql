-- Índices que o chat novo passa a usar de verdade
create index if not exists messages_reply_to_idx        on public.messages(reply_to) where reply_to is not null;
create index if not exists messages_canal_criado_idx    on public.messages(channel_id, created_at);
create index if not exists channel_members_perfil_idx   on public.channel_members(profile_id);

-- Quem este usuário tem direito de enxergar como pessoa.
-- Espelha exatamente a regra da view user_directory, para não existirem
-- duas noções diferentes de "pessoa visível" na plataforma.
create or replace function public.mg_pode_ver_pessoa(p uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (
       p = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.profiles x where x.id = p and x.role = 'admin')
    or exists (select 1 from public.profiles x
                where x.id = p and x.client_id is not null
                  and x.client_id = public.current_client_id())
  );
$$;

-- Abre (ou reencontra) a conversa direta entre quem chama e a outra pessoa.
-- A identidade da conversa é o CONJUNTO DE MEMBROS, não o nome, por isso
-- as conversas antigas continuam sendo reencontradas em vez de duplicadas.
create or replace function public.mg_abrir_dm(p_outro uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_eu   uuid := auth.uid();
  v_id   uuid;
  v_nome text;
begin
  if v_eu is null then
    raise exception 'sem sessão' using errcode = '42501';
  end if;
  if p_outro is null or p_outro = v_eu then
    raise exception 'conversa direta precisa de outra pessoa' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_outro) then
    raise exception 'pessoa não encontrada' using errcode = 'P0002';
  end if;
  if not public.mg_pode_ver_pessoa(p_outro) then
    raise exception 'sem permissão para falar com esta pessoa' using errcode = '42501';
  end if;

  select c.id into v_id
    from public.channels c
   where c.tipo = 'dm'
     and (select count(*) from public.channel_members m where m.channel_id = c.id) = 2
     and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.profile_id = v_eu)
     and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.profile_id = p_outro)
   order by c.created_at
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select string_agg(nome, ' ↔ ' order by nome) into v_nome
    from public.user_directory where id in (v_eu, p_outro);

  insert into public.channels (tipo, nome, created_by)
       values ('dm', coalesce(v_nome, 'Conversa direta'), v_eu)
    returning id into v_id;

  insert into public.channel_members (channel_id, profile_id)
       values (v_id, v_eu), (v_id, p_outro);

  return v_id;
end;
$$;

-- Resumo das threads de um canal: quantas respostas cada mensagem-raiz tem,
-- quando foi a última e quem participou. Uma consulta em vez de N.
create or replace function public.mg_threads(p_canal uuid)
returns table(raiz uuid, respostas bigint, ultima timestamptz, autores uuid[])
language sql stable security definer set search_path to 'public' as $$
  select m.reply_to,
         count(*),
         max(m.created_at),
         array_agg(distinct m.author_id) filter (where m.author_id is not null)
    from public.messages m
   where m.channel_id = p_canal
     and m.reply_to is not null
     and public.can_see_channel(p_canal)
   group by m.reply_to;
$$;

-- Busca de mensagens restrita ao que a pessoa já poderia ler de qualquer jeito.
create or replace function public.mg_buscar_mensagens(p_termo text, p_limite int default 40)
returns table(id uuid, channel_id uuid, author_id uuid, author_name text,
              body text, reply_to uuid, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select m.id, m.channel_id, m.author_id, m.author_name, m.body, m.reply_to, m.created_at
    from public.messages m
   where length(coalesce(p_termo,'')) >= 2
     and m.body ilike '%' || p_termo || '%'
     and public.can_see_channel(m.channel_id)
   order by m.created_at desc
   limit least(greatest(coalesce(p_limite,40), 1), 100);
$$;

revoke all on function public.mg_abrir_dm(uuid)              from public;
revoke all on function public.mg_threads(uuid)               from public;
revoke all on function public.mg_buscar_mensagens(text,int)  from public;
revoke all on function public.mg_pode_ver_pessoa(uuid)       from public;
grant execute on function public.mg_abrir_dm(uuid)             to authenticated;
grant execute on function public.mg_threads(uuid)              to authenticated;
grant execute on function public.mg_buscar_mensagens(text,int) to authenticated;
grant execute on function public.mg_pode_ver_pessoa(uuid)      to authenticated;
