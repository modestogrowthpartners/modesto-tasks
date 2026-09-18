-- Owner na demanda, avisos por gatilho e fila de e-mail.
--
-- 1. tasks.owner_id: uma pessoa da equipe dona da demanda, acima dos
--    responsáveis. Coluna e não texto: aviso precisa de id.
--
-- 2. Os avisos nascem no banco, não na tela. Um gatilho em tasks grava
--    linhas em task_mentions quando alguém vira owner, entra como
--    responsável, ou quando a demanda vai para Impeditivo/Aprovação ou
--    Feito. Assim vale para todo caminho que muda a linha: janela,
--    painel, arraste no Kanban, Kronos. A tela já entrega task_mentions
--    na hora (realtime) e no sino; o que muda é o texto, por `origem`.
--    Quem agiu não recebe aviso da própria ação.
--
-- 3. email_fila: cada task_mentions vira uma linha com o e-mail do alvo
--    (lido de auth.users, por isso SECURITY DEFINER), assunto e corpo
--    prontos. Ninguém lê a fila pela API: RLS ligada e sem policy. Quem
--    envia é o Apps Script (automacoes/avisos-email), com a chave de
--    serviço, pelo Gmail da conta.

alter table public.tasks
  add column if not exists owner_id uuid references public.profiles(id) on delete set null;
create index if not exists tasks_owner_idx on public.tasks (owner_id);

create table if not exists public.email_fila (
  id          bigserial primary key,
  alvo_id     uuid references auth.users(id) on delete cascade,
  para        text not null,
  assunto     text not null,
  corpo       text not null,
  criado_em   timestamptz not null default now(),
  enviado_em  timestamptz,
  tentativas  int not null default 0,
  erro        text
);
alter table public.email_fila enable row level security;
create index if not exists email_fila_pendente_idx on public.email_fila (criado_em) where enviado_em is null;

create or replace function public.mgp_nome_de(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(nome), ''), split_part(coalesce(email, ''), '@', 1), 'Alguém')
    from public.profiles where id = p
$$;

create or replace function public.mgp_avisar_demanda()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ator  uuid := auth.uid();
  v_nome  text;
  v_alvo  uuid;
  v_novos uuid[];
begin
  /* Sem sessão (bot, migração, painel) não há quem atribuir o aviso, e
     task_mentions exige autor. Pular é melhor que derrubar a demanda. */
  if v_ator is null then return new; end if;
  v_nome := coalesce(public.mgp_nome_de(v_ator), 'Alguém');

  begin
    if tg_op = 'INSERT' then
      if new.owner_id is not null and new.owner_id is distinct from v_ator then
        insert into public.task_mentions (task_id, origem, autor_id, autor_nome, alvo_id, trecho)
        values (new.id, 'owner', v_ator, v_nome, new.owner_id, new.title);
      end if;
      foreach v_alvo in array coalesce(new.assignee_ids, '{}'::uuid[]) loop
        if v_alvo is distinct from v_ator then
          insert into public.task_mentions (task_id, origem, autor_id, autor_nome, alvo_id, trecho)
          values (new.id, 'responsavel', v_ator, v_nome, v_alvo, new.title);
        end if;
      end loop;
      return new;
    end if;

    if new.owner_id is not null and new.owner_id is distinct from old.owner_id
       and new.owner_id is distinct from v_ator then
      insert into public.task_mentions (task_id, origem, autor_id, autor_nome, alvo_id, trecho)
      values (new.id, 'owner', v_ator, v_nome, new.owner_id, new.title);
    end if;

    select array_agg(x) into v_novos
      from unnest(coalesce(new.assignee_ids, '{}'::uuid[])) x
     where not (x = any (coalesce(old.assignee_ids, '{}'::uuid[])));
    foreach v_alvo in array coalesce(v_novos, '{}'::uuid[]) loop
      if v_alvo is distinct from v_ator then
        insert into public.task_mentions (task_id, origem, autor_id, autor_nome, alvo_id, trecho)
        values (new.id, 'responsavel', v_ator, v_nome, v_alvo, new.title);
      end if;
    end loop;

    if new.status is distinct from old.status
       and new.status in ('Impeditivo/Aprovação', 'Feito') then
      for v_alvo in
        select distinct u from unnest(coalesce(new.assignee_ids, '{}'::uuid[]) || array[new.owner_id]) u
         where u is not null
      loop
        if v_alvo is distinct from v_ator then
          insert into public.task_mentions (task_id, origem, autor_id, autor_nome, alvo_id, trecho)
          values (new.id, 'status', v_ator, v_nome, v_alvo, new.status);
        end if;
      end loop;
    end if;
  exception when others then
    /* o aviso é conforto; a demanda é o registro. Um nunca derruba o outro. */
    raise warning 'mgp_avisar_demanda: %', sqlerrm;
  end;
  return new;
end $$;

-- `assignees` entra na lista de propósito: a tela grava os nomes, e é o
-- gatilho BEFORE trg_tasks_responsaveis que sincroniza assignee_ids. Um
-- "UPDATE OF assignee_ids" sozinho não dispararia, porque a coluna não
-- está no SET do comando.
drop trigger if exists trg_tasks_avisos on public.tasks;
create trigger trg_tasks_avisos
  after insert or update of owner_id, assignees, assignee_ids, status on public.tasks
  for each row execute function public.mgp_avisar_demanda();

create or replace function public.mgp_enfileirar_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email   text;
  v_titulo  text;
  v_cliente text;
  v_quem    text := coalesce(new.autor_nome, 'Alguém');
  v_assunto text;
  v_corpo   text;
  v_link    text;
begin
  select u.email into v_email from auth.users u where u.id = new.alvo_id;
  if v_email is null then return new; end if;
  select t.title, c.nome into v_titulo, v_cliente
    from public.tasks t left join public.clients c on c.id = t.client_id
   where t.id = new.task_id;
  v_titulo := coalesce(v_titulo, 'uma demanda');
  v_link   := 'https://modestopartners.com.br/#demanda=' || new.task_id::text;

  if new.origem = 'owner' then
    v_assunto := '[MGP] Você é o owner de: ' || v_titulo;
    v_corpo   := v_quem || ' definiu você como owner da demanda "' || v_titulo || '"';
  elsif new.origem = 'responsavel' then
    v_assunto := '[MGP] Você é responsável por: ' || v_titulo;
    v_corpo   := v_quem || ' colocou você como responsável pela demanda "' || v_titulo || '"';
  elsif new.origem = 'status' then
    v_assunto := '[MGP] ' || v_titulo || ' foi para ' || coalesce(new.trecho, 'outro status');
    v_corpo   := v_quem || ' moveu a demanda "' || v_titulo || '" para ' || coalesce(new.trecho, 'outro status');
  else
    v_assunto := '[MGP] ' || v_quem || ' marcou você em: ' || v_titulo;
    v_corpo   := v_quem || ' marcou você na demanda "' || v_titulo || '"'
              || case when coalesce(new.trecho, '') <> '' then E'\n\n"' || new.trecho || '"' else '' end;
  end if;
  if v_cliente is not null then v_corpo := v_corpo || E'\nCliente: ' || v_cliente; end if;
  v_corpo := v_corpo || E'\n\nAbrir na plataforma: ' || v_link
          || E'\n\nEste aviso é automático da plataforma MGP. Você também o recebe no sino, dentro dela.';

  insert into public.email_fila (alvo_id, para, assunto, corpo)
  values (new.alvo_id, v_email, v_assunto, v_corpo);
  return new;
end $$;

drop trigger if exists trg_mencao_email on public.task_mentions;
create trigger trg_mencao_email
  after insert on public.task_mentions
  for each row execute function public.mgp_enfileirar_email();
