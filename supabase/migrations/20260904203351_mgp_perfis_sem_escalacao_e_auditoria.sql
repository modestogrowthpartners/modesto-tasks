-- A policy profiles_update_own já compara role e client_id no WITH CHECK e
-- hoje barra a escalada. O gatilho abaixo é a segunda tranca: se alguém
-- afrouxar a policy no futuro, a regra continua valendo no banco.
create or replace function public.profiles_sem_escalacao()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.is_admin() then return new; end if;
  if new.role      is distinct from old.role
  or new.client_id is distinct from old.client_id
  or new.id        is distinct from old.id then
    raise exception 'alteração de papel ou de vínculo não permitida' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_sem_escalacao on public.profiles;
create trigger trg_profiles_sem_escalacao
  before update on public.profiles
  for each row execute function public.profiles_sem_escalacao();

-- Ninguém nasce admin sem ser criado por um admin. O gatilho de novo
-- usuário do Auth roda como definer e continua funcionando: ele só cria
-- perfil com o papel padrão, que já é client.
create or replace function public.profiles_insert_seguro()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() and new.role is distinct from 'client'::user_role then
    new.role := 'client';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_insert_seguro on public.profiles;
create trigger trg_profiles_insert_seguro
  before insert on public.profiles
  for each row execute function public.profiles_insert_seguro();

-- O portal não pode ficar sem administrador.
create or replace function public.protege_ultimo_admin()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.role = 'admin' and new.role is distinct from 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'não é possível remover o último administrador' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_ultimo_admin on public.profiles;
create trigger trg_ultimo_admin
  before update on public.profiles
  for each row execute function public.protege_ultimo_admin();

-- Avatar em base64 sem limite deixava qualquer pessoa gravar megabytes
-- na própria linha, que é lida por todo mundo no diretório.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_tam') then
    alter table public.profiles
      add constraint profiles_avatar_tam
      check (avatar_url is null or length(avatar_url) < 400000);
  end if;
end $$;

-- Quem mudou papel ou vínculo, e quando.
create table if not exists public.audit_perfil(
  id     bigserial primary key,
  quando timestamptz not null default now(),
  autor  uuid,
  alvo   uuid,
  campo  text,
  de     text,
  para   text
);
alter table public.audit_perfil enable row level security;
drop policy if exists audit_sel on public.audit_perfil;
create policy audit_sel on public.audit_perfil for select using (public.is_admin());

create or replace function public.log_perfil()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_perfil(autor,alvo,campo,de,para)
    values (auth.uid(), new.id, 'role', old.role::text, new.role::text);
  end if;
  if new.client_id is distinct from old.client_id then
    insert into public.audit_perfil(autor,alvo,campo,de,para)
    values (auth.uid(), new.id, 'client_id', old.client_id::text, new.client_id::text);
  end if;
  return new;
end $$;

drop trigger if exists trg_log_perfil on public.profiles;
create trigger trg_log_perfil after update on public.profiles
  for each row execute function public.log_perfil();
