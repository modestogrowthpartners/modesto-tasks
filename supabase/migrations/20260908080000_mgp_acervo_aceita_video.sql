-- O criativo em vídeo é o que mais circula nas conversas de mídia, e o
-- bucket recusava. A lista aqui e a MG_TIPOS_OK do front são a mesma de
-- propósito: se divergirem, quem manda é o banco e a tela vira mentira.
update storage.buckets
   set allowed_mime_types = allowed_mime_types
                          || array['video/mp4','video/quicktime','video/webm']
 where id = 'documents'
   and not (allowed_mime_types @> array['video/mp4']);
