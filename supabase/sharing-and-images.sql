-- ============================================================================
-- Public share links + image uploads.
--
-- Run once in Supabase → SQL Editor, after per-user-notes.sql. Safe to re-run.
-- Until it has run, the app works as before; sharing and image uploads show a
-- message pointing here.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Share links
--    A shared note has a random token. Nobody can list shared notes: there is
--    no public policy on the table. The only public way in is the function
--    below, which returns one note for a token you already know.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists share_token uuid unique;

create or replace function public.get_shared_note(token uuid)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object('title', d.title, 'content', d.content, 'updated_at', d.updated_at)
  from public.documents d
  where d.share_token = token
$$;

revoke all on function public.get_shared_note(uuid) from public;
grant execute on function public.get_shared_note(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Image storage
--    Public bucket so images show on share pages; file names are random UUIDs
--    inside each user's folder. Users can only upload to / delete from their
--    own folder. SVG is not allowed (it can carry scripts).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-images', 'note-images', true, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Upload own note images" on storage.objects;
drop policy if exists "Delete own note images" on storage.objects;

create policy "Upload own note images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Delete own note images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;


-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'documents' and column_name = 'share_token';
select id, public, file_size_limit from storage.buckets where id = 'note-images';
