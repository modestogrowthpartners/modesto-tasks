-- Índices apontados pelo advisor de performance do Supabase.
--
-- 1. messages tinha dois índices idênticos (channel_id, created_at). Cada
--    insert pagava os dois. Fica um.
-- 2. Chaves estrangeiras sem índice: toda exclusão ou atualização na tabela
--    referenciada varre a tabela inteira para conferir a FK. São as
--    consultas que o chat e as demandas fazem o tempo todo.

drop index if exists public.messages_canal_criado_idx;

create index if not exists messages_author_idx        on public.messages (author_id);
create index if not exists task_notes_author_idx      on public.task_notes (author_id);
create index if not exists task_mentions_autor_idx    on public.task_mentions (autor_id);
create index if not exists tasks_created_by_idx       on public.tasks (created_by);
create index if not exists tasks_timer_by_idx         on public.tasks (timer_by);
create index if not exists tasks_chat_msg_idx         on public.tasks (chat_msg_id);
create index if not exists channels_client_idx        on public.channels (client_id);
create index if not exists channels_created_by_idx    on public.channels (created_by);
create index if not exists briefings_task_idx         on public.briefings (task_id);
create index if not exists mgp_pesquisas_criado_por_idx on public.mgp_pesquisas (criado_por);
