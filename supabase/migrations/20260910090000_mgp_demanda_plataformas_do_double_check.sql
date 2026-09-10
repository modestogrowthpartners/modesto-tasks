-- Quais plataformas estão ligadas na demanda. Cada uma acende um bloco de
-- subtarefas de implementação e double check.
--
-- Por que uma coluna e não deduzir das subtarefas: apagar à mão o último
-- item de uma plataforma desligaria o botão sem ninguém ter pedido, e ligar
-- de novo traria os itens já conferidos de volta desmarcados. O estado do
-- botão é decisão de quem opera, não consequência da lista.
alter table public.tasks
  add column if not exists plataformas text[] not null default '{}';

comment on column public.tasks.plataformas is
  'Plataformas com bloco de implementação e double check aberto: meta, google, tiktok, pinterest, bing.';
