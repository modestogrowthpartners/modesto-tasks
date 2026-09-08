-- =====================================================================
-- Fecha o EXECUTE das funções que ficaram de fora da 20260904203602
-- e das que nasceram depois dela.
--
-- Duas armadilhas que este arquivo documenta, porque as duas custaram
-- uma rodada para achar:
--
-- 1. Função de gatilho não é endpoint. Ela roda pelo gatilho, que NÃO
--    confere EXECUTE de quem disparou, então tirar o privilégio não
--    quebra nada e ela some de /rest/v1/rpc.
--
-- 2. is_dono() é chamada DENTRO das políticas, e política é avaliada com
--    o privilégio de quem consulta. Tirar de authenticated derrubaria o
--    acesso do administrador. E revogar só de anon não adianta: toda
--    função nasce com EXECUTE para PUBLIC, e anon herda de PUBLIC. Tem
--    que fechar em PUBLIC e devolver a quem precisa.
-- =====================================================================

do $$
declare f text;
begin
  foreach f in array array[
    'public.task_notes_imutaveis()',
    'public.tasks_cliente_sem_campo_de_equipe()',
    'public.tasks_sincroniza_responsaveis()',
    'public.perfil_renomeia_responsaveis()'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', f);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

revoke all on function public.is_dono() from public, anon, authenticated;
grant execute on function public.is_dono() to authenticated;
