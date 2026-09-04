-- A project's own name, independent of who owns it.
--
-- `projects.id` comes from the browser's IndexedDB and is unique only on one
-- machine, so the primary key is `(user_id, id)` -- see the comment in
-- projects.sql for the upsert bug that forced it. That was the right fix for
-- that bug, but it has a consequence which only becomes visible once a project
-- can be shared: it makes the **owner part of the project's identity**.
--
-- Identity is the one thing that cannot be revised later. Once share links,
-- other users' membership rows, cached client records and (eventually) an
-- operation log all name a project, whatever they name it by is fixed. With the
-- owner inside that name:
--
--   * ownership can never be transferred -- not to a teammate, not to a team
--     account, not when someone leaves;
--   * a share link has to carry an account id, permanently, in the URL;
--   * every foreign key to a project is composite and drags an account id into
--     tables that have no business knowing one.
--
-- `uid` is the fix, and it is deliberately meaningless: server-generated,
-- globally unique, and carrying no fact about anybody. Everything that refers
-- to a project from outside -- membership, invites, blobs, links, ops -- refers
-- to this.
--
-- `(user_id, id)` is untouched. It stays the key the browser's local store
-- syncs against, and the client keeps mapping its own IndexedDB id to a `uid`
-- rather than the server having to care that browsers name things badly.
--
-- Doing this now is the whole point. With a few dozen projects it is this file.
-- Once there are real users it is a coordinated client rollout, dead links, and
-- stale ids cached in every browser that ever opened the app.

alter table public.projects
  add column if not exists uid uuid not null default gen_random_uuid();

-- `gen_random_uuid()` is volatile, so Postgres cannot take its fast path of
-- storing one value for every existing row: each row is rewritten with its own.
-- That is what makes this safe to run on a populated table.
create unique index if not exists projects_uid_key on public.projects (uid);

comment on column public.projects.uid is
  'The project''s global identity. Everything outside the owner''s own account '
  'references this, never (user_id, id); see 20260904120000_project_uid.sql.';

-- ---------------------------------------------------------------------------
-- History learns the same name
-- ---------------------------------------------------------------------------
-- `project_versions` deliberately has no foreign key to `projects`: history
-- outlives the project it describes, which is the entire reason the table
-- exists. So `project_uid` is filled where a project is still there and left
-- null where it is not -- and it stays nullable for exactly that reason. A null
-- here means "the project this belonged to is gone", not "unknown".
alter table public.project_versions
  add column if not exists project_uid uuid;

update public.project_versions v
   set project_uid = p.uid
  from public.projects p
 where v.project_uid is null
   and p.user_id = v.user_id
   and p.id      = v.project_id;

create index if not exists project_versions_uid_idx
  on public.project_versions (project_uid, version_id desc);

-- Filled by trigger rather than by a default so that a browser still running
-- the previously deployed bundle -- which inserts the old four columns and
-- knows nothing about `uid` -- keeps producing rows that the new policies can
-- see. BEFORE triggers run ahead of any constraint check, so this is enough.
create or replace function public.project_versions_default_uid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_uid is null then
    select p.uid into new.project_uid
      from public.projects p
     where p.user_id = new.user_id
       and p.id      = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists project_versions_default_uid_trg on public.project_versions;
create trigger project_versions_default_uid_trg
  before insert on public.project_versions
  for each row execute function public.project_versions_default_uid();

-- ---------------------------------------------------------------------------
-- Identity is immutable
-- ---------------------------------------------------------------------------
-- A name that can be reassigned is not an identity. This also closes a hole the
-- membership migration would otherwise open: an editor's UPDATE is checked by a
-- policy that cannot see the old row, so without this they could set `user_id`
-- to themselves and pass the check by having become the owner.
create or replace function public.projects_freeze_identity()
returns trigger
language plpgsql
as $$
begin
  if new.uid <> old.uid or new.id <> old.id or new.user_id <> old.user_id then
    raise exception
      'a project''s identity is fixed; to re-own it, transfer it or copy it';
  end if;
  return new;
end;
$$;

-- Named to sort before `projects_bump_version_zz_trg` and after
-- `projects_reject_damage_trg`: BEFORE triggers fire in name order, and there
-- is no point describing or versioning a write that is about to be refused.
drop trigger if exists projects_freeze_identity_trg on public.projects;
create trigger projects_freeze_identity_trg
  before update on public.projects
  for each row execute function public.projects_freeze_identity();
