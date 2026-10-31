-- =============================================================================
-- 0062 — Imagens dos quizzes (fundo, logotipo, tela inicial, imagem lateral)
-- =============================================================================
-- Bucket público: a página do lead carrega as imagens sem login. O tipo e o
-- tamanho são validados pelo próprio Storage (não só no navegador). Cada
-- organização grava só na sua pasta: <organization_id>/<arquivo>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-media', 'quiz-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists quiz_media_tool_select on storage.objects;
create policy quiz_media_tool_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'quiz-media'
    and private.has_agency_tool_access('disparo.quizzes')
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  );

drop policy if exists quiz_media_tool_insert on storage.objects;
create policy quiz_media_tool_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'quiz-media'
    and private.has_agency_tool_access('disparo.quizzes')
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  );

drop policy if exists quiz_media_tool_delete on storage.objects;
create policy quiz_media_tool_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'quiz-media'
    and private.has_agency_tool_access('disparo.quizzes')
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  );
