-- A tabela `pacing` tinha RLS ligada e só uma policy de leitura. Nenhuma de
-- escrita. Quem grava é o Pacing Bot, e ele só consegue escrever se estiver
-- com a chave service_role, que passa por cima da RLS. Com qualquer outra
-- chave o INSERT é recusado sem erro visível na tela: o canal do portal
-- recebe a mensagem e a tabela continua vazia, que é o estado de hoje.
--
-- As duas policies abaixo fecham essa lacuna sem afrouxar nada: escrever
-- pacing passa a ser possível para quem é da equipe, do mesmo jeito que
-- acontece em `tasks` e `documents`. Cliente continua só lendo o que é dele,
-- pela policy de select que já existia.
drop policy if exists pacing_equipe_insert on public.pacing;
create policy pacing_equipe_insert on public.pacing
  for insert to authenticated with check (is_admin());

drop policy if exists pacing_equipe_update on public.pacing;
create policy pacing_equipe_update on public.pacing
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists pacing_equipe_delete on public.pacing;
create policy pacing_equipe_delete on public.pacing
  for delete to authenticated using (is_admin());
