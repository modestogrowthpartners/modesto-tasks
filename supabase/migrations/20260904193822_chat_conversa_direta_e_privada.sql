-- =====================================================================
-- Conversa direta passa a ser privada.
-- Antes, can_see_channel devolvia verdadeiro para qualquer admin em
-- QUALQUER canal, inclusive nas conversas diretas entre outras duas
-- pessoas. Na prática, os cinco administradores liam as mensagens
-- particulares uns dos outros.
-- Agora: em canal do tipo 'dm', só os membros. Nos demais, nada muda.
-- =====================================================================
create or replace function public.can_see_channel(cid uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select case
    when (select c.tipo from public.channels c where c.id = cid) = 'dm' then
      exists (select 1 from public.channel_members m
               where m.channel_id = cid and m.profile_id = auth.uid())
    else
      exists (select 1 from public.channel_members m
               where m.channel_id = cid and m.profile_id = auth.uid())
      or public.is_admin()
      or exists (select 1 from public.channels c
                  where c.id = cid and c.tipo = 'client'
                    and c.client_id = public.current_client_id())
  end;
$$;
