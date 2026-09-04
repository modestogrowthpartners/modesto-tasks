-- O assistente mudou de nome: Luquinhas virou Kronos. Como não havia
-- nenhuma mensagem gravada com kind 'luquinhas' (conferido: zero), deu
-- para renomear de verdade em vez de deixar o nome antigo escondido no
-- código para sempre.
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

revoke all on function public.mg_kronos_publicar(uuid,text,uuid) from public, anon;
grant execute on function public.mg_kronos_publicar(uuid,text,uuid) to authenticated;

drop function if exists public.mg_luq_publicar(uuid,text,uuid);

update public.assistant_messages
   set conteudo = replace(replace(conteudo, 'Luquinhas', 'Kronos'), 'luquinhas', 'kronos')
 where conteudo ilike '%luquinhas%';
