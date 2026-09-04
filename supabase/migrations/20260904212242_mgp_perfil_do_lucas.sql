-- O Lucas já tinha login no Auth desde 20/07/2026 e chegou a entrar em
-- 24/07. O que faltava era a linha em profiles, e é por isso que as 29
-- demandas dele apareciam como nome solto, sem foto e sem vínculo.
--
-- O nome sai do próprio e-mail, seguindo exatamente o padrão dos outros
-- perfis da casa (vinicius.reis -> Vinícius Reis, everton.medeiros ->
-- Everton Medeiros, phellip.lira -> Phellip Lira, elias.braga -> Elias
-- Braga). Não foi inventado.
--
-- O papel é admin porque é o único que funciona para quem é da equipe:
-- 'client' sem client_id faria current_client_id() devolver nulo e ele
-- não enxergaria demanda nenhuma.
insert into public.profiles (id, nome, email, role, client_id)
select u.id, 'Lucas Modesto', u.email, 'admin'::user_role, null
  from auth.users u
 where u.id = 'e3190072-5142-4aea-82db-9f1a92d639ab'
on conflict (id) do nothing;

-- Religa as demandas que já citavam "Lucas" no texto. O gatilho de
-- sincronia só dispara em escrita de tasks, então o histórico precisa
-- deste empurrão uma vez.
update public.tasks t
   set assignee_ids = coalesce((
         select array_agg(distinct p.id)
           from unnest(coalesce(t.assignees,'{}'::text[])) as n(nome)
           join public.profiles p
             on public.mg_norm(public.mg_primeiro_nome(p.nome)) = public.mg_norm(n.nome)
             or public.mg_norm(p.nome) = public.mg_norm(n.nome)
       ), '{}'::uuid[])
 where exists (
   select 1 from unnest(coalesce(t.assignees,'{}'::text[])) as n(nome)
    where public.mg_norm(n.nome) = 'lucas');

-- O perfil nasceria com created_at de hoje, e o cartão de perfil do chat
-- mostraria "membro desde" errado. A data verdadeira é a do Auth.
update public.profiles p set created_at = u.created_at
  from auth.users u
 where p.id = u.id and p.id = 'e3190072-5142-4aea-82db-9f1a92d639ab';
