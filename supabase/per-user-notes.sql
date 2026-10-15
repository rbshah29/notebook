-- ============================================================================
-- Per-user notes: every account sees and edits only its own documents.
--
-- Run once in Supabase → SQL Editor. Step 0 is read-only; run it first.
-- Steps 1–4 run in a single transaction: if anything fails (for example a wrong
-- email in step 2), nothing is changed.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 0 (read-only) — look before changing anything.
-- Check the column list for an existing owner column. If there is one with a
-- different name (e.g. owner_id), stop and adjust this script to use that name.
-- ---------------------------------------------------------------------------
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'documents'
order by ordinal_position;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'documents';


-- ---------------------------------------------------------------------------
-- STEPS 1–4 — replace YOUR_EMAIL below, then run from here to the end.
-- ---------------------------------------------------------------------------
begin;

-- 1. Owner column. New rows are stamped with the signed-in user automatically,
--    so the app's inserts need no changes. Deleting a user deletes their notes.
alter table public.documents
  add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.documents
  alter column user_id set default auth.uid();

-- 2. Give any existing notes without an owner to your own account.
update public.documents
set user_id = (select id from auth.users where email = 'YOUR_EMAIL')
where user_id is null;

-- Fails (and rolls everything back) if step 2 left any note without an owner.
alter table public.documents
  alter column user_id set not null;

create index if not exists documents_user_id_idx on public.documents (user_id);

-- 3. Turn on Row Level Security.
alter table public.documents enable row level security;

-- 4. Replace all existing policies. Policies are OR-ed together, so a leftover
--    permissive one (e.g. "allow all") would silently undo the isolation below.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'documents'
  loop
    execute format('drop policy %I on public.documents', p.policyname);
  end loop;
end $$;

create policy "Read own notes" on public.documents
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Create own notes" on public.documents
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Update own notes" on public.documents
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Delete own notes" on public.documents
  for delete to authenticated
  using ((select auth.uid()) = user_id);

commit;


-- ---------------------------------------------------------------------------
-- Verify: RLS should be on, with exactly the four policies above.
-- ---------------------------------------------------------------------------
select relname, relrowsecurity from pg_class where oid = 'public.documents'::regclass;
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'documents';
