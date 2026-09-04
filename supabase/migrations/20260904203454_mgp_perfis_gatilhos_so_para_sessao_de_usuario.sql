-- Correção: os gatilhos anteriores barravam qualquer alteração feita SEM
-- sessão de usuário, o que inclui o SQL Editor do painel, scripts de
-- manutenção e a service_role. Isso trancava a própria administração.
-- A regra vale para quem entra pela aplicação; fora dela quem manda
-- continua sendo a RLS, e ela já nega o anônimo.
create or replace function public.profiles_sem_escalacao()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;   -- contexto de servidor
  if public.is_admin() then return new; end if;
  if new.role      is distinct from old.role
  or new.client_id is distinct from old.client_id
  or new.id        is distinct from old.id then
    raise exception 'alteração de papel ou de vínculo não permitida' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.profiles_insert_seguro()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.is_admin() and new.role is distinct from 'client'::user_role then
    new.role := 'client';
  end if;
  return new;
end $$;
