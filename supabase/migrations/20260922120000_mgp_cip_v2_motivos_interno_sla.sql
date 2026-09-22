-- =====================================================================
-- CIP V2: motivo calibrado por faixa, leitura interna separada,
-- discovery opcional e SLA de contato
--
-- A planilha Modesto_CIP_MGPR_V2 trouxe quatro coisas que não existiam:
--
-- 1. mgp_cip_textos: as 90 frases de motivo (5 por faixa, 3 faixas, 6
--    áreas) e os 18 textos de retorno do Snapshot. Ficam em tabela, não
--    no código, porque são texto de negócio: a Patrícia muda uma frase e
--    ninguém precisa publicar a plataforma.
--
-- 2. mgp_pesquisas_interno: a leitura da Modesto sai da linha que o
--    cliente lê. A RLS de mgp_pesquisas decide a linha, não a coluna, e
--    a coluna `interno` chegava inteira ao cliente pela API. O documento
--    do CIP diz que o cliente nunca vê isso; agora a tabela é outra, com
--    policy só da equipe.
--
-- 3. mgp_pesquisas.com_discovery: cliente antigo, que nunca respondeu
--    Pré-Discovery nem Client Discovery, não recebe a seção "Continuidade
--    do discovery". Quem envia a revisão marca; a tela esconde a seção e
--    o painel mostra "não aplicável" em vez de pendência.
--
-- 4. O gatilho de resposta: quando a Revisão de Parceria volta
--    respondida, o banco calcula MGPI e nota, manda o Snapshot por e-mail
--    ao cliente e, se NPS < 7 ou MGPI < 7, abre a demanda do SLA com
--    prazo de 2 dias úteis para quem enviou a revisão. Nasce no banco
--    para valer em qualquer caminho que grave a resposta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Textos calibrados
-- ---------------------------------------------------------------------
create table if not exists public.mgp_cip_textos (
  id     bigserial primary key,
  area   text not null check (area  in ('confianca','valor','execucao','impacto','futuro','nps')),
  faixa  text not null check (faixa in ('baixa','media','alta')),
  tipo   text not null check (tipo  in ('motivo','retorno')),
  ordem  int  not null default 1,
  texto  text not null,
  unique (area, faixa, tipo, ordem)
);
comment on table public.mgp_cip_textos is
  'CIP/MGPR: frases de motivo por faixa de nota (aba _Motivos) e textos de retorno do Snapshot (aba 02). '
  'Edite aqui; a plataforma lê na hora.';
alter table public.mgp_cip_textos enable row level security;
drop policy if exists mgp_cip_textos_select on public.mgp_cip_textos;
create policy mgp_cip_textos_select on public.mgp_cip_textos
  for select to authenticated using (true);
drop policy if exists mgp_cip_textos_admin on public.mgp_cip_textos;
create policy mgp_cip_textos_admin on public.mgp_cip_textos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.mgp_cip_textos (area, faixa, tipo, ordem, texto) values
  ('confianca','baixa','motivo',1,'Sinto que as recomendações não vêm acompanhadas de dados ou explicação suficiente.'),
  ('confianca','baixa','motivo',2,'Já tivemos decisões sugeridas que não se confirmaram na prática.'),
  ('confianca','baixa','motivo',3,'Falta mais transparência sobre o porquê de cada escolha estratégica.'),
  ('confianca','baixa','motivo',4,'Ainda não construímos histórico suficiente para eu avaliar com segurança.'),
  ('confianca','baixa','motivo',5,'Sinto que decisões importantes são tomadas sem nos consultar o quanto deveriam.'),
  ('confianca','media','motivo',1,'Confio na maior parte das recomendações, mas ainda questiono algumas.'),
  ('confianca','media','motivo',2,'A equipe é competente, mas às vezes falta contexto no que é sugerido.'),
  ('confianca','media','motivo',3,'Já vi bons resultados, só quero ver mais consistência ao longo do tempo.'),
  ('confianca','media','motivo',4,'Confio no time, mas gostaria de entender melhor a lógica por trás das decisões.'),
  ('confianca','media','motivo',5,'Estamos construindo essa confiança — o caminho está bom.'),
  ('confianca','alta','motivo',1,'As decisões costumam ser bem embasadas e isso me dá segurança.'),
  ('confianca','alta','motivo',2,'Sinto que o time pensa no nosso negócio como se fosse deles.'),
  ('confianca','alta','motivo',3,'Já vi recomendações difíceis que se provaram certas depois.'),
  ('confianca','alta','motivo',4,'A equipe é transparente até quando o resultado não é o esperado.'),
  ('confianca','alta','motivo',5,'Temos total liberdade para questionar e sempre recebemos boas respostas.'),
  ('valor','baixa','motivo',1,'Sinto que ainda tratam a gente como mais um cliente na carteira.'),
  ('valor','baixa','motivo',2,'Falta entendimento mais profundo do nosso modelo de negócio.'),
  ('valor','baixa','motivo',3,'As sugestões parecem genéricas, como se servissem para qualquer empresa.'),
  ('valor','baixa','motivo',4,'Ainda não vejo a Modesto puxando pauta estratégica, só executando.'),
  ('valor','baixa','motivo',5,'Precisamos explicar o negócio de novo em quase toda reunião.'),
  ('valor','media','motivo',1,'Entendem bem o operacional, mas ainda podem aprofundar na estratégia do negócio.'),
  ('valor','media','motivo',2,'Já trazem boas ideias, mas nem sempre conectadas ao nosso momento atual.'),
  ('valor','media','motivo',3,'Sinto que entendem o negócio, mas o discurso estratégico pode evoluir.'),
  ('valor','media','motivo',4,'Boa leitura do dia a dia, falta um pouco mais de visão de longo prazo.'),
  ('valor','media','motivo',5,'Estão no caminho certo, mas ainda cabe mais imersão no nosso setor.'),
  ('valor','alta','motivo',1,'Sinto que enxergam o negócio quase como um sócio enxergaria.'),
  ('valor','alta','motivo',2,'Trazem provocações estratégicas que a gente nem tinha pensado.'),
  ('valor','alta','motivo',3,'Entendem tão bem o contexto que economizamos tempo em cada reunião.'),
  ('valor','alta','motivo',4,'Já indicamos a Modesto justamente por essa visão de negócio, e se confirmou.'),
  ('valor','alta','motivo',5,'Sentimos que são uma extensão real do nosso time de decisão.'),
  ('execucao','baixa','motivo',1,'Tivemos atrasos que impactaram o cronograma.'),
  ('execucao','baixa','motivo',2,'A comunicação podia ser mais clara e frequente.'),
  ('execucao','baixa','motivo',3,'Sentimos falta de organização em alguns processos internos.'),
  ('execucao','baixa','motivo',4,'Precisamos cobrar mais do que gostaríamos para as coisas andarem.'),
  ('execucao','baixa','motivo',5,'Alguns entregáveis vieram com qualidade abaixo do esperado.'),
  ('execucao','media','motivo',1,'No geral entregam bem, mas a comunicação pode ser mais proativa.'),
  ('execucao','media','motivo',2,'Cumprem prazos na maioria das vezes, com alguma variação.'),
  ('execucao','media','motivo',3,'Boa organização, mas ainda cabe mais antecipação de problemas.'),
  ('execucao','media','motivo',4,'Execução sólida, só sinto que reagimos mais do que antecipamos juntos.'),
  ('execucao','media','motivo',5,'Estão evoluindo bem nesse ponto comparado ao início da parceria.'),
  ('execucao','alta','motivo',1,'Prazos são cumpridos com folga e isso facilita nosso planejamento.'),
  ('execucao','alta','motivo',2,'A comunicação é clara, frequente e sem enrolação.'),
  ('execucao','alta','motivo',3,'O time é proativo — muitas vezes já chega com a solução, não só o problema.'),
  ('execucao','alta','motivo',4,'Organização impecável, sabemos sempre o status de tudo.'),
  ('execucao','alta','motivo',5,'Raramente precisamos cobrar algo, eles já se antecipam.'),
  ('impacto','baixa','motivo',1,'Ainda não vimos evolução clara nos números desde o início.'),
  ('impacto','baixa','motivo',2,'Os resultados até melhoraram, mas aquém do que esperávamos.'),
  ('impacto','baixa','motivo',3,'Sinto que estamos testando muito e colhendo pouco resultado prático.'),
  ('impacto','baixa','motivo',4,'Falta uma conexão mais clara entre as ações e o impacto no caixa.'),
  ('impacto','baixa','motivo',5,'Os números melhoraram em alguns pontos, mas pioraram em outros.'),
  ('impacto','media','motivo',1,'Já vemos evolução, mas ainda gostaríamos de um ritmo mais acelerado.'),
  ('impacto','media','motivo',2,'Os resultados são positivos, mas nem sempre no que mais importa pra gente.'),
  ('impacto','media','motivo',3,'Boa evolução geral, com espaço para melhorar consistência mês a mês.'),
  ('impacto','media','motivo',4,'Percebo impacto real, só quero entender melhor como isso escala.'),
  ('impacto','media','motivo',5,'Estamos no caminho certo, mas o resultado ainda não é ''uau''.'),
  ('impacto','alta','motivo',1,'Os números falam por si — a evolução é nítida desde que começamos.'),
  ('impacto','alta','motivo',2,'Já superamos as metas que tínhamos no início da parceria.'),
  ('impacto','alta','motivo',3,'O impacto no negócio foi além do que esperávamos.'),
  ('impacto','alta','motivo',4,'Conseguimos crescer com consistência, mês após mês.'),
  ('impacto','alta','motivo',5,'Hoje uso esses resultados como referência para o resto do negócio.'),
  ('futuro','baixa','motivo',1,'Não estou seguro sobre o potencial de crescimento dessa parceria.'),
  ('futuro','baixa','motivo',2,'Sinto que já exploramos o que era possível e falta fôlego novo.'),
  ('futuro','baixa','motivo',3,'Preciso ver mais iniciativa em trazer novas frentes de trabalho.'),
  ('futuro','baixa','motivo',4,'Ainda não enxergo com clareza os próximos passos da parceria.'),
  ('futuro','baixa','motivo',5,'Tenho dúvidas se a Modesto está preparada para acompanhar nosso próximo estágio.'),
  ('futuro','media','motivo',1,'Vejo potencial de crescer, mas falta um plano mais claro pra isso.'),
  ('futuro','media','motivo',2,'Estou otimista, só quero ver mais ousadia nas próximas frentes.'),
  ('futuro','media','motivo',3,'A parceria tem espaço pra evoluir, e sinto abertura pra isso acontecer.'),
  ('futuro','media','motivo',4,'Bom momento, ainda dá pra explorar mais oportunidades juntos.'),
  ('futuro','media','motivo',5,'Confio no potencial, mas ainda não vi o plano dos próximos passos.'),
  ('futuro','alta','motivo',1,'Vejo essa parceria crescendo junto com a empresa nos próximos anos.'),
  ('futuro','alta','motivo',2,'Já estamos planejando novas frentes juntos, o que me deixa animado.'),
  ('futuro','alta','motivo',3,'Sinto que ainda tem muita coisa boa pela frente com a Modesto.'),
  ('futuro','alta','motivo',4,'A Modesto já se tornou parte do nosso planejamento de longo prazo.'),
  ('futuro','alta','motivo',5,'Enxergo a Modesto como parceira estratégica pros próximos ciclos do negócio.'),
  ('nps','baixa','motivo',1,'No momento não me sinto confortável em recomendar, por experiências recentes.'),
  ('nps','baixa','motivo',2,'Ainda existem pontos em aberto que pesam na minha avaliação geral.'),
  ('nps','baixa','motivo',3,'Prefiro esperar resolver algumas questões antes de recomendar com confiança.'),
  ('nps','baixa','motivo',4,'A experiência até aqui não correspondeu ao que esperávamos ao contratar.'),
  ('nps','baixa','motivo',5,'Recomendaria, mas com ressalvas importantes.'),
  ('nps','media','motivo',1,'É uma boa parceria, mas ainda não é motivo de recomendação espontânea.'),
  ('nps','media','motivo',2,'Recomendaria, mas com algumas ressalvas pontuais.'),
  ('nps','media','motivo',3,'Estou satisfeito, só não é (ainda) um ''sim'' automático.'),
  ('nps','media','motivo',4,'Boa experiência geral, com espaço claro de evolução.'),
  ('nps','media','motivo',5,'Recomendaria dependendo do perfil e do momento da empresa.'),
  ('nps','alta','motivo',1,'Já recomendei a Modesto para outras empresas do meu círculo.'),
  ('nps','alta','motivo',2,'É a parceria que eu cito como referência quando falam de agência de growth.'),
  ('nps','alta','motivo',3,'Recomendaria sem pensar duas vezes.'),
  ('nps','alta','motivo',4,'A experiência supera o que eu esperava de uma agência.'),
  ('nps','alta','motivo',5,'Sinto orgulho de falar que trabalhamos com a Modesto.'),
  ('confianca','baixa','retorno',1,'Entendemos, e é exatamente esse tipo de sinal que essa revisão existe para captar. Vamos aprofundar o racional por trás das nossas próximas recomendações, com mais dados e contexto.'),
  ('confianca','media','retorno',1,'Obrigado pela honestidade — é isso que nos ajuda a evoluir. Vamos manter a consistência e trazer mais clareza sobre a lógica das próximas decisões.'),
  ('confianca','alta','retorno',1,'Ficamos felizes em ler isso. Vamos manter esse padrão e seguir sendo transparentes, inclusive quando o resultado não sai como planejado.'),
  ('valor','baixa','retorno',1,'Registramos esse ponto com atenção. Vamos aprofundar nosso entendimento do seu negócio e trazer discussões mais estratégicas nas próximas reuniões.'),
  ('valor','media','retorno',1,'Vamos usar esse retorno para elevar o nível das nossas discussões estratégicas nos próximos ciclos.'),
  ('valor','alta','retorno',1,'Esse é exatamente o tipo de parceria que buscamos construir. Vamos continuar trazendo provocações estratégicas para o negócio.'),
  ('execucao','baixa','retorno',1,'Esse feedback vai direto para o time responsável. Vamos revisar nossos processos internos e a cadência de comunicação já nas próximas semanas.'),
  ('execucao','media','retorno',1,'Vamos trabalhar para sermos ainda mais proativos e antecipar pontos antes que virem pauta de reunião.'),
  ('execucao','alta','retorno',1,'Ótimo saber! Vamos manter esse padrão de organização e comunicação.'),
  ('impacto','baixa','retorno',1,'Entendido. Vamos revisar com o time estratégico como acelerar a conexão entre as ações em andamento e o resultado no seu negócio.'),
  ('impacto','media','retorno',1,'Vamos trabalhar para acelerar o ritmo de evolução dos resultados nos próximos meses.'),
  ('impacto','alta','retorno',1,'Excelente! Vamos manter o ritmo e buscar os próximos patamares de resultado.'),
  ('futuro','baixa','retorno',1,'Vamos trazer uma conversa dedicada sobre os próximos passos da parceria — sua visão é fundamental para isso.'),
  ('futuro','media','retorno',1,'Vamos estruturar com mais clareza as próximas frentes de trabalho para os próximos meses.'),
  ('futuro','alta','retorno',1,'Ótimo! Vamos continuar planejando os próximos passos juntos.'),
  ('nps','baixa','retorno',1,'Obrigado pela honestidade. Esse tipo de resposta merece uma conversa direta.'),
  ('nps','media','retorno',1,'Obrigado pelo retorno. Vamos usar isso para elevar ainda mais a experiência com a Modesto.'),
  ('nps','alta','retorno',1,'Muito obrigado! Ficamos muito felizes com essa avaliação e vamos seguir com o mesmo nível de entrega.')
on conflict (area, faixa, tipo, ordem) do update set texto = excluded.texto;

-- ---------------------------------------------------------------------
-- 2. Leitura interna em tabela própria
-- ---------------------------------------------------------------------
create table if not exists public.mgp_pesquisas_interno (
  pesquisa_id uuid primary key references public.mgp_pesquisas(id) on delete cascade,
  dados       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
comment on table public.mgp_pesquisas_interno is
  'Leitura da Modesto sobre uma pesquisa: continuidade do discovery, CAP, SLA. O cliente não tem policy aqui.';
alter table public.mgp_pesquisas_interno enable row level security;
drop policy if exists mgp_pesquisas_interno_equipe on public.mgp_pesquisas_interno;
create policy mgp_pesquisas_interno_equipe on public.mgp_pesquisas_interno
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists mgp_pesquisas_interno_touch_t on public.mgp_pesquisas_interno;
create trigger mgp_pesquisas_interno_touch_t before update on public.mgp_pesquisas_interno
  for each row execute function public.mgp_pesquisas_touch();

-- o que já estava na coluna vai para a tabela, e a coluna some
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'mgp_pesquisas' and column_name = 'interno') then
    insert into public.mgp_pesquisas_interno (pesquisa_id, dados)
      select id, interno from public.mgp_pesquisas where interno <> '{}'::jsonb
      on conflict (pesquisa_id) do nothing;
    alter table public.mgp_pesquisas drop column interno;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Discovery opcional
-- ---------------------------------------------------------------------
alter table public.mgp_pesquisas
  add column if not exists com_discovery boolean not null default true;
comment on column public.mgp_pesquisas.com_discovery is
  'false = cliente sem Pré-Discovery/Client Discovery: a seção Continuidade não aparece no formulário.';

-- o gatilho do cliente perde a linha do `interno` e ganha a do discovery
create or replace function public.mgp_pesquisas_cliente_so_responde()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;

  new.client_id     := old.client_id;
  new.tipo          := old.tipo;
  new.rodada        := old.rodada;
  new.com_discovery := old.com_discovery;
  new.proxima_em    := old.proxima_em;
  new.enviado_em    := old.enviado_em;
  new.criado_por    := old.criado_por;
  new.created_at    := old.created_at;

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

-- ---------------------------------------------------------------------
-- 4. Cálculo, célula por célula, igual à aba 03
-- ---------------------------------------------------------------------
create or replace function public.mgp_cip_nota(r jsonb, k text)
returns numeric language sql immutable as $$
  select case when r ? k and (r->>k) ~ '^\s*-?\d+(\.\d+)?\s*$' then (r->>k)::numeric else null end
$$;

-- média que ignora vazio, como AVERAGE
create or replace function public.mgp_cip_media(variadic v numeric[])
returns numeric language sql immutable as $$
  select avg(x) from unnest(v) x where x is not null
$$;

create or replace function public.mgp_cip_calculo(r jsonb)
returns jsonb language plpgsql immutable as $$
declare
  c numeric; v numeric; e numeric; i numeric; f numeric; m numeric;
begin
  c := public.mgp_cip_media(public.mgp_cip_nota(r,'confianca_recomendacoes'), public.mgp_cip_nota(r,'confianca_seguranca'));
  v := public.mgp_cip_nota(r,'valor_entende');
  e := public.mgp_cip_media(public.mgp_cip_nota(r,'exec_comunicacao'), public.mgp_cip_nota(r,'exec_organizacao'),
                            public.mgp_cip_nota(r,'exec_prazos'),      public.mgp_cip_nota(r,'exec_proatividade'));
  i := public.mgp_cip_nota(r,'impacto_evolucao');
  f := public.mgp_cip_nota(r,'futuro_potencial');
  m := public.mgp_cip_media(c, v, e, i, f);
  return jsonb_build_object(
    'confianca', c, 'valor', v, 'execucao', e, 'impacto', i, 'futuro', f,
    'mgpi', case when m is null then null else round(m, 2) end,
    'nps',  public.mgp_cip_nota(r,'nps_nota'));
end $$;

create or replace function public.mgp_cip_faixa(n numeric)
returns text language sql immutable as $$
  select case when n is null then null when n < 7 then 'baixa' when n < 9 then 'media' else 'alta' end
$$;

create or replace function public.mgp_mes_ano(d date)
returns text language sql immutable as $$
  select (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
                'setembro','outubro','novembro','dezembro'])[extract(month from d)::int]
         || '/' || extract(year from d)::int
$$;

-- n dias úteis à frente, sem feriado (só pula sábado e domingo)
create or replace function public.mgp_dias_uteis(d date, n int)
returns date language plpgsql immutable as $$
declare
  x date := d; k int := 0;
begin
  while k < n loop
    x := x + 1;
    if extract(isodow from x) < 6 then k := k + 1; end if;
  end loop;
  return x;
end $$;

-- ---------------------------------------------------------------------
-- 5. O aviso de demanda aceita um nome de autor vindo de quem criou a
--    demanda por automação. Sem isso, a demanda do SLA sairia como se o
--    cliente tivesse definido o owner.
-- ---------------------------------------------------------------------
create or replace function public.mgp_avisar_demanda()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ator  uuid := auth.uid();
  v_nome  text;
  v_alvo  uuid;
  v_novos uuid[];
begin
  if v_ator is null then return new; end if;
  v_nome := coalesce(nullif(current_setting('mgp.autor', true), ''), public.mgp_nome_de(v_ator), 'Alguém');

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
    raise warning 'mgp_avisar_demanda: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.mgp_avisar_demanda() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. A revisão voltou respondida: Snapshot por e-mail e SLA
-- ---------------------------------------------------------------------
create or replace function public.mgp_cip_snapshot_texto(p public.mgp_pesquisas, p_nome text)
returns text language plpgsql stable as $$
declare
  r       jsonb := coalesce(p.respostas, '{}'::jsonb);
  calc    jsonb := public.mgp_cip_calculo(coalesce(p.respostas, '{}'::jsonb));
  areas   text[] := array['confianca','valor','execucao','impacto','futuro'];
  rotulos text[] := array['Confiança','Valor Estratégico','Excelência na Execução','Impacto nos Resultados','Futuro da Parceria'];
  chaves  text[] := array['confianca_motivo','valor_motivo','exec_motivo','impacto_motivo','futuro_motivo'];
  t       text;
  k       int;
  motivo  text;
  retorno text;
  temas   text;
  nps     numeric := (calc->>'nps')::numeric;
  prox    text;
begin
  t := 'Obrigado' || case when coalesce(p_nome,'') <> '' then ', ' || p_nome else '' end
    || ', por participar da nossa Revisão de Parceria. Sua opinião é fundamental para continuarmos evoluindo juntos.' || E'\n';

  for k in 1..5 loop
    motivo := nullif(btrim(coalesce(r->>chaves[k], '')), '');
    if motivo is null then continue; end if;
    select x.texto into retorno from public.mgp_cip_textos x
     where x.area = areas[k] and x.tipo = 'retorno'
       and x.faixa = public.mgp_cip_faixa((calc->>areas[k])::numeric)
     order by x.ordem limit 1;
    t := t || E'\n' || upper(rotulos[k]) || E'\n'
      || 'O que você destacou: ' || motivo || E'\n'
      || case when retorno is not null then 'Nosso retorno: ' || retorno || E'\n' else '' end;
  end loop;

  select string_agg(v, '; ') into temas
    from (select jsonb_array_elements_text(case when jsonb_typeof(r->'temas') = 'array' then r->'temas' else '[]'::jsonb end) v
          union all select nullif(btrim(coalesce(r->>'temas_outro','')), '')) s
   where v is not null;
  t := t || E'\nTEMAS QUE VOCÊ DESTACOU PARA GERAR MAIS VALOR\n'
    || coalesce(temas, 'Nenhum tema específico apontado nesta rodada.') || E'\n';

  motivo := nullif(btrim(coalesce(r->>'nps_motivo', '')), '');
  if motivo is not null then
    select x.texto into retorno from public.mgp_cip_textos x
     where x.area = 'nps' and x.tipo = 'retorno' and x.faixa = public.mgp_cip_faixa(nps)
     order by x.ordem limit 1;
    t := t || E'\nSOBRE SUA RECOMENDAÇÃO\n' || 'O que você destacou: ' || motivo || E'\n'
      || case when retorno is not null then 'Nosso retorno: ' || retorno || E'\n' else '' end;
  end if;

  if nps is not null and nps < 7 then
    t := t || E'\nPRÓXIMO PASSO\nCombinado: nosso time vai entrar em contato em até 2 dias úteis para conversarmos com calma sobre os pontos que você trouxe.\n';
  end if;

  t := t || E'\nNOSSO COMPROMISSO\n'
    || E'✓ Compartilhar benchmarking e boas práticas de mercado no próximo ciclo.\n'
    || E'✓ Revisar nossa agenda de reuniões executivas com você.\n'
    || E'✓ Incorporar este feedback ao nosso plano de melhoria contínua.\n';

  /* mês por extenso em português, sem depender do locale do banco */
  prox := public.mgp_mes_ano(coalesce(p.proxima_em, (coalesce(p.respondido_em, now()) + interval '3 months')::date));
  t := t || E'\nPróxima revisão prevista: ' || prox || E'\n'
    || E'\nVocê pode rever este retorno e salvar em PDF na plataforma: https://modestopartners.com.br';
  return t;
end $$;
revoke all on function public.mgp_cip_snapshot_texto(public.mgp_pesquisas, text) from public, anon, authenticated;

create or replace function public.mgp_cip_ao_responder()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  calc      jsonb;
  v_mgpi    numeric;
  v_nps     numeric;
  v_cli     text;
  v_interno uuid;
  v_task    uuid;
  v_prazo   date;
  v_owner   uuid;
  v_alvo    record;
  v_texto   text;
  v_nome    text;
begin
  if new.tipo <> 'mgpr' then return new; end if;
  if not (new.status = 'respondido' and coalesce(old.status, '') <> 'respondido') then return new; end if;

  begin
    calc   := public.mgp_cip_calculo(coalesce(new.respostas, '{}'::jsonb));
    v_mgpi := (calc->>'mgpi')::numeric;
    v_nps  := (calc->>'nps')::numeric;
    select c.nome into v_cli from public.clients c where c.id = new.client_id;

    /* Snapshot por e-mail: para quem respondeu, se for gente da empresa;
       senão, para todo usuário da empresa. Sem nota, sem classificação. */
    for v_alvo in
      select p.id, u.email, p.nome
        from public.profiles p join auth.users u on u.id = p.id
       where p.client_id = new.client_id and p.role = 'client'
         and (auth.uid() is null or p.id = auth.uid()
              or not exists (select 1 from public.profiles q where q.id = auth.uid() and q.client_id = new.client_id))
    loop
      if v_alvo.email is null then continue; end if;
      v_nome  := split_part(coalesce(v_alvo.nome, ''), ' ', 1);
      v_texto := public.mgp_cip_snapshot_texto(new, v_nome);
      insert into public.email_fila (alvo_id, para, assunto, corpo)
      values (v_alvo.id, v_alvo.email,
              'Modesto · o retorno da sua Revisão de Parceria', v_texto);
    end loop;

    /* SLA: NPS < 7 ou MGPI < 7 abre contato em até 2 dias úteis */
    if (v_nps is not null and v_nps < 7) or (v_mgpi is not null and v_mgpi < 7) then
      v_owner := new.criado_por;
      v_prazo := public.mgp_dias_uteis(current_date, 2);
      /* a demanda vai para a empresa interna: com o client_id do cliente
         ela apareceria no portal dele, com a nota que ele não deve ver */
      select c.id into v_interno from public.clients c
       where c.nome ilike 'Modesto (Interno)%' order by c.created_at limit 1;

      perform set_config('mgp.autor', 'MGP NPS', true);
      insert into public.tasks (client_id, title, description, status, priority, urgente,
                                due, owner_id, created_by, assignees, assignee_ids)
      values (v_interno,
              'SLA · ' || coalesce(v_cli, 'cliente') || ' · contato em até 2 dias úteis',
              'A Revisão de Parceria (rodada ' || new.rodada || ') de ' || coalesce(v_cli, 'cliente')
              || ' voltou com nota de recomendação ' || coalesce(v_nps::text, '—')
              || ' e MGPI ' || coalesce(replace(v_mgpi::text, '.', ','), '—') || '.'
              || E'\n\nRegra do CIP: NPS abaixo de 7 ou MGPI abaixo de 7 abre contato do Customer Success em até 2 dias úteis.'
              || E'\nPrazo: ' || to_char(v_prazo, 'DD/MM/YYYY')
              || E'\n\nO painel completo, com pilares, alertas e CAP, está em MGP NPS > ' || coalesce(v_cli, 'empresa') || '.',
              'Não iniciado', 'Alta', true, v_prazo, v_owner, v_owner, '{}'::text[], '{}'::uuid[])
      returning id into v_task;
      perform set_config('mgp.autor', '', true);

      /* o aviso nasceu com o cliente como autor; passa a ser do owner,
         senão o cliente enxerga o aviso pela policy de task_mentions */
      if v_owner is not null then
        update public.task_mentions set autor_id = v_owner, autor_nome = 'MGP NPS'
         where task_id = v_task and autor_id is distinct from v_owner;
      end if;

      insert into public.mgp_pesquisas_interno (pesquisa_id, dados)
      values (new.id, jsonb_build_object('sla', jsonb_build_object(
                'task_id', v_task, 'prazo', v_prazo, 'mgpi', v_mgpi, 'nps', v_nps, 'em', now())))
      on conflict (pesquisa_id) do update
        set dados = public.mgp_pesquisas_interno.dados || excluded.dados;
    end if;
  exception when others then
    /* o retorno e o SLA são consequência; a resposta do cliente é o registro */
    raise warning 'mgp_cip_ao_responder: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.mgp_cip_ao_responder() from public, anon, authenticated;

drop trigger if exists mgp_cip_ao_responder_t on public.mgp_pesquisas;
create trigger mgp_cip_ao_responder_t after update of status on public.mgp_pesquisas
  for each row execute function public.mgp_cip_ao_responder();

-- as funções de cálculo são puras e podem ser chamadas pela tela
grant execute on function public.mgp_cip_calculo(jsonb) to authenticated;
grant execute on function public.mgp_cip_faixa(numeric) to authenticated;
revoke execute on function public.mgp_cip_nota(jsonb, text) from anon;
revoke execute on function public.mgp_cip_media(numeric[]) from anon;
revoke execute on function public.mgp_dias_uteis(date, int) from anon;
revoke execute on function public.mgp_mes_ano(date) from anon;

-- ---------------------------------------------------------------------
-- 7. O linter do Supabase apontou search_path mutável nas funções novas
--    e execute por anon em duas funções de gatilho antigas
-- ---------------------------------------------------------------------
alter function public.mgp_cip_nota(jsonb, text) set search_path = public;
alter function public.mgp_cip_media(numeric[]) set search_path = public;
alter function public.mgp_cip_calculo(jsonb) set search_path = public;
alter function public.mgp_cip_faixa(numeric) set search_path = public;
alter function public.mgp_cip_snapshot_texto(public.mgp_pesquisas, text) set search_path = public;
alter function public.mgp_dias_uteis(date, int) set search_path = public;
alter function public.mgp_mes_ano(date) set search_path = public;
revoke execute on function public.mgp_enfileirar_email() from public, anon, authenticated;
revoke execute on function public.mgp_nome_de(uuid) from public, anon;
