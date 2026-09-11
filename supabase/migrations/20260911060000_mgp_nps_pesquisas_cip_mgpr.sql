-- =====================================================================
-- MGP NPS — Pré-Discovery, Client Discovery e CIP/MGPR numa tabela só
--
-- Os três documentos nasceram como três planilhas separadas, e o pedido da
-- reunião foi justamente que eles parem de ser separados: o Client Discovery
-- abre mostrando o que o cliente já respondeu no Pré-Discovery, e a revisão
-- de parceria (MGPR) aos 60 dias cobra o que foi levantado nos dois.
--
-- Por isso uma tabela só, com `tipo`, em vez de três. O que muda entre elas é
-- o questionário, não o ciclo de vida: alguém da Modesto envia, o cliente
-- responde, a Modesto lê o resultado. Três tabelas iguais seriam três vezes a
-- mesma RLS para manter.
--
-- As respostas ficam em jsonb de propósito. O questionário é texto de
-- negócio, muda a cada revisão do documento, e uma coluna por pergunta
-- viraria uma migração por ajuste de redação. O cálculo do MGPI é feito na
-- tela a partir das chaves, do mesmo jeito que a planilha faz a partir das
-- células.
-- =====================================================================
create table if not exists public.mgp_pesquisas (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  tipo          text not null check (tipo in ('pre_discovery','client_discovery','mgpr')),
  rodada        int  not null default 1 check (rodada >= 1),
  status        text not null default 'enviado' check (status in ('rascunho','enviado','respondido')),
  respostas     jsonb not null default '{}'::jsonb,
  anexos        jsonb not null default '[]'::jsonb,
  -- leitura interna da Modesto: atenções, oportunidades, hipóteses e o
  -- acompanhamento da continuidade do discovery. Nunca vai para o cliente.
  interno       jsonb not null default '{}'::jsonb,
  enviado_em    timestamptz not null default now(),
  respondido_em timestamptz,
  proxima_em    date,
  criado_por    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Uma rodada por tipo por empresa. O Pré-Discovery e o Client Discovery
-- ficam na rodada 1; o MGPR incrementa a cada trimestre.
create unique index if not exists mgp_pesquisas_rodada_uidx
  on public.mgp_pesquisas (client_id, tipo, rodada);

create index if not exists mgp_pesquisas_cliente_idx
  on public.mgp_pesquisas (client_id, tipo, rodada desc);

comment on table public.mgp_pesquisas is
  'Pré-Discovery, Client Discovery e Revisão de Parceria (CIP/MGPR). '
  'respostas = o que o cliente preencheu; interno = a leitura da Modesto, '
  'que o cliente não enxerga por policy.';

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function public.mgp_pesquisas_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.mgp_pesquisas_touch() from public, anon, authenticated;

drop trigger if exists mgp_pesquisas_touch_t on public.mgp_pesquisas;
create trigger mgp_pesquisas_touch_t before update on public.mgp_pesquisas
  for each row execute function public.mgp_pesquisas_touch();

-- ---------------------------------------------------------------------
-- O cliente responde, e só isso
--
-- A RLS decide a linha, não a coluna. Sem este gatilho, o UPDATE que deixa o
-- cliente gravar as respostas dele deixaria junto trocar a empresa da
-- pesquisa, adiantar a próxima revisão ou reescrever a leitura interna da
-- Modesto. O gatilho devolve esses campos ao valor antigo em vez de recusar
-- a gravação inteira: o que interessa é que a resposta entre.
-- ---------------------------------------------------------------------
create or replace function public.mgp_pesquisas_cliente_so_responde()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;

  new.client_id  := old.client_id;
  new.tipo       := old.tipo;
  new.rodada     := old.rodada;
  new.interno    := old.interno;
  new.proxima_em := old.proxima_em;
  new.enviado_em := old.enviado_em;
  new.criado_por := old.criado_por;
  new.created_at := old.created_at;

  -- o cliente avança o status, nunca volta atrás
  if new.status not in ('enviado','respondido') then
    new.status := old.status;
  end if;
  if old.status = 'respondido' and new.status = 'enviado' then
    new.status := 'respondido';
  end if;
  if new.status = 'respondido' and new.respondido_em is null then
    new.respondido_em := now();
  end if;

  return new;
end $$;
revoke all on function public.mgp_pesquisas_cliente_so_responde() from public, anon, authenticated;

drop trigger if exists mgp_pesquisas_cliente_t on public.mgp_pesquisas;
create trigger mgp_pesquisas_cliente_t before update on public.mgp_pesquisas
  for each row execute function public.mgp_pesquisas_cliente_so_responde();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.mgp_pesquisas enable row level security;

-- Lê: a equipe vê tudo; o cliente vê as pesquisas da própria empresa, e só
-- as que já foram enviadas a ele. Rascunho é trabalho interno.
drop policy if exists mgp_pesquisas_select on public.mgp_pesquisas;
create policy mgp_pesquisas_select on public.mgp_pesquisas
  for select to authenticated using (
    public.is_admin()
    or (client_id = public.current_client_id() and status <> 'rascunho')
  );

drop policy if exists mgp_pesquisas_insert on public.mgp_pesquisas;
create policy mgp_pesquisas_insert on public.mgp_pesquisas
  for insert to authenticated with check (public.is_admin());

-- Atualiza: a equipe sempre; o cliente só a pesquisa enviada à empresa dele.
-- O que ele pode mexer dentro da linha é o gatilho acima que decide.
drop policy if exists mgp_pesquisas_update on public.mgp_pesquisas;
create policy mgp_pesquisas_update on public.mgp_pesquisas
  for update to authenticated
  using (
    public.is_admin()
    or (client_id = public.current_client_id() and status in ('enviado','respondido'))
  )
  with check (
    public.is_admin()
    or client_id = public.current_client_id()
  );

drop policy if exists mgp_pesquisas_delete on public.mgp_pesquisas;
create policy mgp_pesquisas_delete on public.mgp_pesquisas
  for delete to authenticated using (public.is_admin());

-- a tela da equipe precisa saber na hora que o cliente respondeu
do $$
begin
  begin
    alter publication supabase_realtime add table public.mgp_pesquisas;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------
-- Anexos do discovery
--
-- "Se houver documentos, dashboards ou materiais úteis, envie junto." O
-- bucket `documents` só deixava o cliente escrever em <client_id>/chat/.
-- Aqui abre a pasta <client_id>/pesquisas/ com a mesma regra: a pasta da
-- própria empresa, nada além dela.
-- ---------------------------------------------------------------------
drop policy if exists storage_documents_client_pesquisas_insert on storage.objects;
create policy storage_documents_client_pesquisas_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (public.current_client_id())::text
    and (storage.foldername(name))[2] = 'pesquisas'
  );
