-- ============================================================================
-- PIN-locked notes, enforced by the database.
--
-- Run once in Supabase → SQL Editor, after per-user-notes.sql. Safe to re-run.
--
-- How it works
--   • Locking moves the note's content into public.note_locks and clears
--     documents.content. note_locks has row level security with NO policies,
--     so the app (and anyone with your session) can't read it directly.
--   • Content comes back only through the functions below, and only with the
--     right PIN. PINs are stored as bcrypt hashes.
--   • 5 wrong PINs block that note for 15 minutes, so the 10,000 possible
--     PINs can't be tried quickly.
--   • A locked note can't be deleted (or have its content overwritten)
--     through the normal API; delete_locked_note needs the PIN.
--   • Forgotten PIN: the content is still in note_locks.content and can be
--     read from the Supabase dashboard (Table Editor), which bypasses RLS.
-- ============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.documents
  add column if not exists is_locked boolean not null default false;
-- Locking turns sharing off; make sure the column exists even if sharing-and-images.sql wasn't run.
alter table public.documents
  add column if not exists share_token uuid unique;

-- note_id is the note's id as text, so this works whatever type documents.id has.
create table if not exists public.note_locks (
  note_id text primary key,
  pin_hash text not null,
  content jsonb,
  failed_attempts int not null default 0,
  blocked_until timestamptz
);
alter table public.note_locks enable row level security;
revoke all on public.note_locks from anon, authenticated;

-- Deleting a note (including by account deletion) deletes its lock.
create or replace function public.note_locks_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.note_locks where note_id = old.id::text;
  return old;
end $$;
drop trigger if exists note_locks_cleanup on public.documents;
create trigger note_locks_cleanup after delete on public.documents
  for each row execute function public.note_locks_cleanup();

create or replace function public.note_is_locked(nid text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.note_locks where note_id = nid)
$$;

-- Internal: checks ownership and the PIN, counting failures. Returns null when the PIN is right,
-- otherwise an error object. Errors are returned, not raised, so the failure count is kept.
create or replace function public._check_note_pin(nid text, pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.note_locks;
begin
  if not exists (select 1 from public.documents d where d.id::text = nid and d.user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into l from public.note_locks where note_id = nid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_locked');
  end if;
  if l.blocked_until is not null and l.blocked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts',
      'retry_after', ceil(extract(epoch from l.blocked_until - now())));
  end if;
  if pin is null or l.pin_hash <> extensions.crypt(pin, l.pin_hash) then
    if l.failed_attempts + 1 >= 5 then
      update public.note_locks set failed_attempts = 0, blocked_until = now() + interval '15 minutes' where note_id = nid;
      return jsonb_build_object('ok', false, 'error', 'too_many_attempts', 'retry_after', 900);
    end if;
    update public.note_locks set failed_attempts = l.failed_attempts + 1 where note_id = nid;
    return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'remaining', 5 - (l.failed_attempts + 1));
  end if;
  if l.failed_attempts > 0 or l.blocked_until is not null then
    update public.note_locks set failed_attempts = 0, blocked_until = null where note_id = nid;
  end if;
  return null;
end $$;

-- Writes jsonb content back into documents.content, whatever that column's type is.
create or replace function public._restore_note_content(nid text, body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ctype text;
begin
  select format_type(a.atttypid, a.atttypmod) into ctype
  from pg_attribute a where a.attrelid = 'public.documents'::regclass and a.attname = 'content';
  execute format('update public.documents set content = ($1::text)::%s, is_locked = false where id::text = $2', ctype)
    using body, nid;
end $$;

create or replace function public.lock_note(nid text, pin text, body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if pin is null or pin !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;
  if not exists (select 1 from public.documents d where d.id::text = nid and d.user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (select 1 from public.note_locks where note_id = nid) then
    return jsonb_build_object('ok', false, 'error', 'already_locked');
  end if;
  insert into public.note_locks (note_id, pin_hash, content)
  values (nid, extensions.crypt(pin, extensions.gen_salt('bf', 8)), body);
  update public.documents set content = null, is_locked = true, share_token = null where id::text = nid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.unlock_note(nid text, pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  err jsonb := public._check_note_pin(nid, pin);
begin
  if err is not null then return err; end if;
  return jsonb_build_object('ok', true, 'content', (select content from public.note_locks where note_id = nid));
end $$;

create or replace function public.save_locked_note(nid text, pin text, body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  err jsonb := public._check_note_pin(nid, pin);
begin
  if err is not null then return err; end if;
  update public.note_locks set content = body where note_id = nid;
  update public.documents set updated_at = now() where id::text = nid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.remove_note_lock(nid text, pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  err jsonb := public._check_note_pin(nid, pin);
  body jsonb;
begin
  if err is not null then return err; end if;
  select content into body from public.note_locks where note_id = nid;
  perform public._restore_note_content(nid, body);
  delete from public.note_locks where note_id = nid;
  return jsonb_build_object('ok', true, 'content', body);
end $$;

create or replace function public.delete_locked_note(nid text, pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  err jsonb := public._check_note_pin(nid, pin);
begin
  if err is not null then return err; end if;
  delete from public.note_locks where note_id = nid;
  delete from public.documents where id::text = nid and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.note_locks_cleanup() from public, anon, authenticated;
revoke all on function public._check_note_pin(text, text) from public, anon, authenticated;
revoke all on function public._restore_note_content(text, jsonb) from public, anon, authenticated;
revoke all on function public.note_is_locked(text) from public, anon;
revoke all on function public.lock_note(text, text, jsonb) from public, anon;
revoke all on function public.unlock_note(text, text) from public, anon;
revoke all on function public.save_locked_note(text, text, jsonb) from public, anon;
revoke all on function public.remove_note_lock(text, text) from public, anon;
revoke all on function public.delete_locked_note(text, text) from public, anon;
grant execute on function public.note_is_locked(text) to authenticated;
grant execute on function public.lock_note(text, text, jsonb) to authenticated;
grant execute on function public.unlock_note(text, text) to authenticated;
grant execute on function public.save_locked_note(text, text, jsonb) to authenticated;
grant execute on function public.remove_note_lock(text, text) to authenticated;
grant execute on function public.delete_locked_note(text, text) to authenticated;

-- Normal updates and deletes: a locked note can't be deleted, can't get content written into
-- documents.content, and is_locked must always match whether a lock really exists.
drop policy if exists "Update own notes" on public.documents;
create policy "Update own notes" on public.documents
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and is_locked = public.note_is_locked(id::text)
    and (not is_locked or content is null)
  );

drop policy if exists "Delete own notes" on public.documents;
create policy "Delete own notes" on public.documents
  for delete to authenticated
  using ((select auth.uid()) = user_id and not public.note_is_locked(id::text));

commit;


-- ---------------------------------------------------------------------------
-- Verify: a note_locks table with RLS on and no policies, and the two updated policies.
-- ---------------------------------------------------------------------------
select relname, relrowsecurity from pg_class where oid = 'public.note_locks'::regclass;
select count(*) as note_locks_policies from pg_policies where schemaname = 'public' and tablename = 'note_locks';
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'documents';
