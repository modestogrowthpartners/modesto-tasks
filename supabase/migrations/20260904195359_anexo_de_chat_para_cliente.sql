-- O bucket documents só aceitava upload de admin. Para o cliente poder
-- anexar arquivo numa conversa, liberamos apenas a pasta
-- <client_id>/chat/ da própria empresa dele. Nada além disso.
drop policy if exists storage_documents_client_chat_insert on storage.objects;
create policy storage_documents_client_chat_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (public.current_client_id())::text
    and (storage.foldername(name))[2] = 'chat'
  );
