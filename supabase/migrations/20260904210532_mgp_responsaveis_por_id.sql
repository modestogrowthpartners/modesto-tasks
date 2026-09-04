-- Normalização usada em toda a resolução de nome. translate em vez de
-- unaccent para não depender de extensão instalada.
create or replace function public.mg_norm(t text)
returns text language sql immutable set search_path to 'public' as $$
  select lower(btrim(translate(coalesce(t,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')));
$$;

-- Primeiro nome de um perfil, que é a forma como tasks.assignees grava.
create or replace function public.mg_primeiro_nome(t text)
returns text language sql immutable set search_path to 'public' as $$
  select split_part(btrim(coalesce(t,'')), ' ', 1);
$$;

-- Vínculo por id, ao lado do texto que já existe. A coluna de texto NÃO
-- é removida: 33 pontos do front leem dela, e dois nomes gravados
-- ("Lucas", com 29 demandas, e "Renato", com 2) não têm perfil nenhum,
-- então migrar de vez perderia esses vínculos.
alter table public.tasks
  add column if not exists assignee_ids uuid[] not null default '{}'::uuid[];

create index if not exists tasks_assignee_ids_idx on public.tasks using gin (assignee_ids);

-- Deriva os ids a partir dos nomes, em toda escrita. Assim o front
-- continua gravando nome, como sempre fez, e o id aparece sozinho.
create or replace function public.tasks_sincroniza_responsaveis()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
    into new.assignee_ids
    from unnest(coalesce(new.assignees, '{}'::text[])) as n(nome)
    join public.profiles p
      on public.mg_norm(public.mg_primeiro_nome(p.nome)) = public.mg_norm(n.nome)
      or public.mg_norm(p.nome) = public.mg_norm(n.nome);
  return new;
end $$;

drop trigger if exists trg_tasks_responsaveis on public.tasks;
create trigger trg_tasks_responsaveis
  before insert or update of assignees on public.tasks
  for each row execute function public.tasks_sincroniza_responsaveis();

-- Preenche o que já existe.
update public.tasks t
   set assignee_ids = coalesce((
         select array_agg(distinct p.id)
           from unnest(coalesce(t.assignees,'{}'::text[])) as n(nome)
           join public.profiles p
             on public.mg_norm(public.mg_primeiro_nome(p.nome)) = public.mg_norm(n.nome)
             or public.mg_norm(p.nome) = public.mg_norm(n.nome)
       ), '{}'::uuid[]);

-- A fragilidade real de guardar primeiro nome é esta: trocar o nome da
-- pessoa quebrava, em silêncio, o vínculo dela com as demandas. Agora o
-- banco reescreve o texto junto, e só quando o primeiro nome novo não
-- pertencer a outra pessoa, para não trocar responsável sem querer.
create or replace function public.perfil_renomeia_responsaveis()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  velho text := public.mg_primeiro_nome(old.nome);
  novo  text := public.mg_primeiro_nome(new.nome);
begin
  if public.mg_norm(velho) = public.mg_norm(novo) or coalesce(novo,'') = '' then
    return new;
  end if;
  if exists (select 1 from public.profiles p
              where p.id <> new.id
                and public.mg_norm(public.mg_primeiro_nome(p.nome)) = public.mg_norm(novo)) then
    return new;   -- o nome novo já é de outra pessoa: não mexe no texto
  end if;
  update public.tasks t
     set assignees = array_replace(t.assignees, e.nome, novo)
    from (select distinct x.nome from public.tasks tt,
                 unnest(tt.assignees) as x(nome)
           where public.mg_norm(x.nome) = public.mg_norm(velho)) e
   where new.id = any(t.assignee_ids)
      or e.nome = any(t.assignees);
  return new;
end $$;

drop trigger if exists trg_perfil_renomeia on public.profiles;
create trigger trg_perfil_renomeia
  after update of nome on public.profiles
  for each row execute function public.perfil_renomeia_responsaveis();
