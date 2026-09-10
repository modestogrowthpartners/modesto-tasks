-- Data de início da demanda. O prazo final já existe em `due`, e a data de
-- abertura já existe em `created_at`, que o banco preenche sozinho e ninguém
-- edita pela tela. Faltava só o começo planejado.
alter table public.tasks
  add column if not exists start_date date;

comment on column public.tasks.start_date is
  'Data de início planejada. Não confundir com created_at, que é a abertura do card e é imutável.';
