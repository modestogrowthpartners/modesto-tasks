-- Só messages, task_notes e tasks publicavam mudança em tempo real. Por
-- isso foto de perfil trocada, canal novo, empresa nova e documento novo
-- só apareciam para os outros depois de recarregar a página.
--
-- Publicar não abre nada: o Realtime aplica a RLS de cada assinante, e
-- todas as seis já têm RLS ligada com política de leitura. Quem não pode
-- ler a linha continua sem receber o evento dela.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'channels', 'channel_members', 'clients', 'documents', 'projects'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
