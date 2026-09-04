-- O cartão de perfil do chat mostra "membro desde". Sem esta coluna no
-- diretório a data teria que ser inventada, e dado inventado na tela é
-- exatamente o que não pode acontecer.
create or replace view public.user_directory
with (security_invoker = false, security_barrier = true) as
  select p.id,
         coalesce(nullif(btrim(p.nome), ''), split_part(coalesce(p.email,''), '@', 1), 'Sem nome') as nome,
         p.avatar_url,
         p.role,
         p.client_id,
         case when public.is_admin() then p.email else null end as email,
         p.created_at
    from public.profiles p
   where public.is_admin()
      or p.id = auth.uid()
      or p.role = 'admin'
      or (p.client_id is not null and p.client_id = public.current_client_id());

revoke all on public.user_directory from anon;
grant select on public.user_directory to authenticated;

-- Canais em comum entre quem chama e outra pessoa, para o cartão de
-- perfil. Só conta canal que quem chama já enxerga.
create or replace function public.mg_canais_em_comum(p_outro uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int
    from public.channel_members a
    join public.channel_members b
      on b.channel_id = a.channel_id and b.profile_id = p_outro
   where a.profile_id = auth.uid()
     and public.can_see_channel(a.channel_id);
$$;
revoke all on function public.mg_canais_em_comum(uuid) from public, anon;
grant execute on function public.mg_canais_em_comum(uuid) to authenticated;
