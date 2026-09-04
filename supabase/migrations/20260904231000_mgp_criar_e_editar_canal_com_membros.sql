-- Criar canal e definir quem participa numa operação só. Antes o front
-- inseria o canal e depois os membros em duas idas ao banco, e uma falha
-- no meio deixava canal sem ninguém dentro.
create or replace function public.mg_criar_canal(
  p_tipo text, p_nome text, p_client_id uuid default null,
  p_membros uuid[] default null, p_icone text default null,
  p_cor text default null, p_descricao text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_nome text;
begin
  if not public.is_admin() then
    raise exception 'só administrador cria canal' using errcode = '42501';
  end if;
  if p_tipo not in ('client','team') then
    raise exception 'tipo de canal inválido' using errcode = '22023';
  end if;
  v_nome := btrim(coalesce(p_nome,''));
  if v_nome = '' then
    raise exception 'o canal precisa de um nome' using errcode = '22023';
  end if;
  if p_tipo = 'client' and p_client_id is null then
    raise exception 'canal de cliente precisa da empresa' using errcode = '22023';
  end if;

  insert into public.channels (tipo, nome, client_id, created_by, icone, cor, descricao)
       values (p_tipo, v_nome, p_client_id, auth.uid(),
               nullif(btrim(coalesce(p_icone,'')),''),
               nullif(btrim(coalesce(p_cor,'')),''),
               nullif(btrim(coalesce(p_descricao,'')),''))
    returning id into v_id;

  /* quem entra: o que veio na lista, mais quem criou, sempre */
  insert into public.channel_members (channel_id, profile_id)
       select v_id, y from (
         select distinct z from unnest(coalesce(p_membros,'{}'::uuid[]) || auth.uid()) as z
       ) s(y)
       where exists (select 1 from public.profiles p where p.id = y)
    on conflict do nothing;

  return v_id;
end $$;

-- Editar a personalização. Só admin, e o tipo e a empresa não mudam.
create or replace function public.mg_atualizar_canal(
  p_canal uuid, p_nome text default null, p_icone text default null,
  p_cor text default null, p_descricao text default null)
returns public.channels language plpgsql security definer set search_path to 'public' as $$
declare v public.channels;
begin
  if not public.is_admin() then
    raise exception 'só administrador edita canal' using errcode = '42501';
  end if;
  update public.channels set
      nome      = coalesce(nullif(btrim(coalesce(p_nome,'')),''), nome),
      icone     = case when p_icone     is null then icone     else nullif(btrim(p_icone),'')     end,
      cor       = case when p_cor       is null then cor       else nullif(btrim(p_cor),'')       end,
      descricao = case when p_descricao is null then descricao else nullif(btrim(p_descricao),'') end
   where id = p_canal
  returning * into v;
  if v.id is null then
    raise exception 'canal não encontrado' using errcode = 'P0002';
  end if;
  return v;
end $$;

-- Trocar a lista de participantes de um canal de uma vez.
create or replace function public.mg_definir_membros(p_canal uuid, p_ids uuid[])
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_tipo text; v_n int;
begin
  if not public.is_admin() then
    raise exception 'só administrador altera participantes' using errcode = '42501';
  end if;
  select tipo into v_tipo from public.channels where id = p_canal;
  if v_tipo is null then
    raise exception 'canal não encontrado' using errcode = 'P0002';
  end if;
  if v_tipo = 'dm' then
    raise exception 'conversa direta não tem lista de participantes' using errcode = '22023';
  end if;

  delete from public.channel_members m
   where m.channel_id = p_canal
     and not (m.profile_id = any(coalesce(p_ids,'{}'::uuid[])));

  insert into public.channel_members (channel_id, profile_id)
       select p_canal, x from unnest(coalesce(p_ids,'{}'::uuid[])) as x
        where exists (select 1 from public.profiles p where p.id = x)
    on conflict do nothing;

  select count(*) into v_n from public.channel_members where channel_id = p_canal;
  return v_n;
end $$;

revoke all on function public.mg_criar_canal(text,text,uuid,uuid[],text,text,text) from public, anon;
revoke all on function public.mg_atualizar_canal(uuid,text,text,text,text)         from public, anon;
revoke all on function public.mg_definir_membros(uuid,uuid[])                      from public, anon;
grant execute on function public.mg_criar_canal(text,text,uuid,uuid[],text,text,text) to authenticated;
grant execute on function public.mg_atualizar_canal(uuid,text,text,text,text)         to authenticated;
grant execute on function public.mg_definir_membros(uuid,uuid[])                      to authenticated;
