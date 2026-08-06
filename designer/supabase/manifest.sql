-- Ziro Designer, content-addressed project manifests and version history.
-- Run once in the Supabase SQL editor, after projects.sql and storage.sql.
--
-- Two things the client cannot be trusted to do for itself:
--
--   1. Keep history. Blobs are content-addressed and never overwritten, so
--      every version of every file a user has committed is still in the bucket.
--      What was missing was a record of which blobs made up which version —
--      that is `project_versions`, and it is what turns a bad commit into a
--      restore instead of a loss.
--
--   2. Refuse damage. Every invariant used to live in the browser, which means
--      a bug in the browser was a bug in the data: a push whose uploads had all
--      failed rewrote the row that held the only surviving copy, and Postgres
--      accepted it because nothing had told Postgres what a valid row looked
--      like. The trigger below is the second opinion.

-- ---------------------------------------------------------------------------
-- Version history: one immutable row per commit.
-- ---------------------------------------------------------------------------
create table if not exists public.project_versions (
  version_id   bigserial primary key,
  project_id   uuid not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  -- The manifest exactly as committed: [{ "name": …, "hash": …, "size": … }]
  files        jsonb not null default '[]'::jsonb,
  committed_at timestamptz not null default now(),
  recorded_at  timestamptz not null default now()
);

create index if not exists project_versions_lookup_idx
  on public.project_versions (user_id, project_id, version_id desc);

alter table public.project_versions enable row level security;

drop policy if exists "project_versions_select_own" on public.project_versions;
drop policy if exists "project_versions_insert_own" on public.project_versions;

create policy "project_versions_select_own"
  on public.project_versions for select
  using (auth.uid() = user_id);

create policy "project_versions_insert_own"
  on public.project_versions for insert
  with check (auth.uid() = user_id);

-- Deliberately no update or delete policy. History that can be rewritten is not
-- history, and this table is the backstop for every other mistake in the
-- system. Rows go away only with the account, via the cascade above.

-- ---------------------------------------------------------------------------
-- Server-side validation of a project row.
-- ---------------------------------------------------------------------------
create or replace function public.projects_reject_damage()
returns trigger
language plpgsql
as $$
declare
  old_count int := 0;
  new_count int := jsonb_array_length(coalesce(new.files, '[]'::jsonb));
  hollow    int;
begin
  -- A manifest entry must name a blob. Catching this here means a row can never
  -- reference nothing at all, whatever the client believes it uploaded.
  if new_count > 0 then
    select count(*) into hollow
    from jsonb_array_elements(new.files) f
    where coalesce(f->>'hash', '') = '' and coalesce(f->>'gzB64', '') = '';

    -- Legacy rows list names only and are still readable; they are simply never
    -- written any more. Allow them through on UPDATE of an already-legacy row
    -- so an old client cannot be locked out mid-migration, but never let a row
    -- that has real content regress to that shape.
    if hollow = new_count and tg_op = 'UPDATE' then
      select jsonb_array_length(coalesce(old.files, '[]'::jsonb)) into old_count;
      if old_count > 0 and exists (
        select 1 from jsonb_array_elements(old.files) f
        where coalesce(f->>'hash', '') <> '' or coalesce(f->>'gzB64', '') <> ''
      ) then
        raise exception
          'refusing to replace % addressable files in "%" with % that address nothing',
          old_count, new.name, new_count;
      end if;
    end if;
  end if;

  -- A project that had files does not silently become a project with none.
  -- A real "delete everything" is a DELETE, not an UPDATE to an empty list.
  if tg_op = 'UPDATE' then
    select jsonb_array_length(coalesce(old.files, '[]'::jsonb)) into old_count;
    if old_count > 0 and new_count = 0 then
      raise exception 'refusing to empty "%": % files would be dropped', new.name, old_count;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists projects_reject_damage_trg on public.projects;
create trigger projects_reject_damage_trg
  before insert or update on public.projects
  for each row execute function public.projects_reject_damage();
