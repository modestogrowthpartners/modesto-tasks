-- Função de gatilho não é endpoint. Nenhuma delas deve aparecer em
-- /rest/v1/rpc, nem para anônimo nem para quem está logado.
do $$
declare f text;
begin
  foreach f in array array[
    'public.profiles_sem_escalacao()',
    'public.profiles_insert_seguro()',
    'public.protege_ultimo_admin()',
    'public.log_perfil()',
    'public.handle_new_user()',
    'public.touch_updated_at()'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', f);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

-- As RPC do chat continuam abertas para quem está logado, e fechadas
-- para o anônimo. Sem sessão elas não fariam nada de útil de qualquer
-- jeito, mas endpoint que não precisa existir não deve existir.
revoke all on function public.mg_abrir_dm(uuid)              from anon;
revoke all on function public.mg_threads(uuid)               from anon;
revoke all on function public.mg_buscar_mensagens(text,int)  from anon;
revoke all on function public.mg_pode_ver_pessoa(uuid)       from anon;
revoke all on function public.mg_luq_publicar(uuid,text,uuid) from anon;
revoke all on function public.mg_toggle_reaction(uuid,text)  from anon;
revoke all on function public.mg_unread()                    from anon;
revoke all on function public.save_my_checklist(jsonb)       from anon;
revoke all on function public.can_see_channel(uuid)          from anon;
revoke all on function public.current_client_id()            from anon;
revoke all on function public.is_admin()                     from anon;
