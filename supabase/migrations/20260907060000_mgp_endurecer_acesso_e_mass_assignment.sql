-- =====================================================================
-- Patch de segurança: superfície de acesso e atribuição em massa
-- Aplicado em produção em 07/09/2026.
--
-- 1. O papel `anon` perde tudo no schema public.
--    A plataforma não lê nenhuma tabela antes do login: boot() chama
--    loadProfile(), que já exige sessão, e login/cadastro/recuperação
--    passam pelo GoTrue, não pelo PostgREST. O RLS já barrava o anônimo
--    em todas as tabelas; tirar o grant é a segunda tranca, para o dia
--    em que alguém criar uma política nova e errar a condição.
--
-- 2. TRUNCATE sai de `authenticated`.
--    Isto não é redundância: no Postgres o RLS NÃO se aplica a TRUNCATE.
--    Uma política de linha, por mais correta que seja, não impede um
--    TRUNCATE de quem tem o privilégio. O PostgREST não expõe TRUNCATE
--    hoje, então não era explorável, mas o privilégio não tem uso e sai.
--    REFERENCES e TRIGGER saem pelo mesmo motivo.
--
-- 3. Duas funções de GATILHO estavam publicadas como RPC.
--    perfil_renomeia_responsaveis() e tasks_sincroniza_responsaveis()
--    existem para rodar em trigger. Estavam com EXECUTE aberto, e a
--    primeira era chamável até sem login, por /rest/v1/rpc/. As duas são
--    SECURITY DEFINER e escrevem em tasks.
-- =====================================================================

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;

revoke execute on function public.perfil_renomeia_responsaveis()  from anon, authenticated;
revoke execute on function public.tasks_sincroniza_responsaveis() from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- =====================================================================
-- 4. Atribuição em massa na criação de demanda pelo cliente
--
--    A política tasks_insert_cliente checa LINHA: cliente certo, status
--    'Não iniciado', não urgente, não arquivada. Ela não checa COLUNA.
--    Como o PostgREST aceita qualquer coluna no corpo do POST, um
--    cliente podia nascer uma demanda já com prioridade Alta, com
--    responsável escolhido por ele, com tempo gasto, apontando para um
--    projeto de outra empresa ou pendurada numa demanda que não é dele.
--
--    RLS resolve linha; coluna se resolve aqui. O gatilho normaliza em
--    vez de recusar: o cliente cria a demanda dele e os campos que são
--    da equipe voltam ao padrão, em silêncio.
-- =====================================================================
create or replace function public.tasks_cliente_sem_campo_de_equipe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return new; end if;   -- contexto de servidor
  if public.is_admin()  then return new; end if;

  new.client_id    := public.current_client_id();
  new.status       := 'Não iniciado';
  new.priority     := 'Média';
  new.urgente      := false;
  new.archived     := false;
  new.assignees    := '{}'::text[];
  new.assignee_ids := '{}'::uuid[];
  new.time_spent   := 0;
  new.timer_start  := null;
  new.completed_at := null;
  new.position     := coalesce(new.position, 0);

  -- projeto e demanda-pai só valem se forem da própria empresa
  if new.project_id is not null and not exists (
       select 1 from public.projects p
        where p.id = new.project_id and p.client_id = new.client_id) then
    new.project_id := null;
  end if;
  if new.parent_id is not null and not exists (
       select 1 from public.tasks t
        where t.id = new.parent_id and t.client_id = new.client_id) then
    new.parent_id := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_tasks_cliente_campos on public.tasks;
create trigger trg_tasks_cliente_campos
  before insert on public.tasks
  for each row execute function public.tasks_cliente_sem_campo_de_equipe();

revoke execute on function public.tasks_cliente_sem_campo_de_equipe() from anon, authenticated;

-- =====================================================================
-- 5. O acervo passa a recusar arquivo grande e tipo fora da lista
--    (aplicado por UPDATE em storage.buckets, replicado aqui para o
--    histórico ficar completo)
--
--    update storage.buckets
--       set file_size_limit = 26214400,
--           allowed_mime_types = array[...17 tipos...]
--     where id = 'documents';
-- =====================================================================
