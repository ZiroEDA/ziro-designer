-- Sharing a project with another account.
--
-- Every policy in this schema so far says `auth.uid() = user_id`, on all three
-- walls independently: the `projects` row, its `project_versions` history, and
-- the storage objects holding the bytes. A project is therefore reachable by
-- exactly one account, and there is no database-level way to share one at all --
-- not read-only, not by link, not by invitation.
--
-- What replaces it is a membership table the policies consult instead of
-- ownership. Ownership does not go away: it stays in `projects.user_id` and
-- still means "may delete, may invite". Membership is the layer above it.
--
-- Everything here keys on `projects.uid`, never on `(user_id, id)`; see
-- 20260904120000_project_uid.sql for why an identity that contains the owner
-- cannot be shared.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- Declared in ascending order so Postgres' own enum comparison gives us
-- `role >= 'editor'` for free; there is no separate rank table to keep in sync.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_role') then
    create type public.project_role as enum ('viewer', 'editor', 'owner');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
create table if not exists public.project_members (
  project_uid uuid not null references public.projects (uid) on delete cascade,
  user_id     uuid not null references auth.users (id)       on delete cascade,
  role        public.project_role not null default 'viewer',
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint project_members_pkey primary key (project_uid, user_id),
  -- The owner holds no row here: ownership already lives in `projects.user_id`,
  -- and duplicating it would mean two sources for one fact and a bootstrap
  -- trigger to keep them agreeing. `project_role_of` reads both.
  constraint project_members_role_not_owner check (role <> 'owner')
);

create index if not exists project_members_user_idx
  on public.project_members (user_id);

-- The one question every policy below asks.
--
-- `security definer` for two reasons: it reads `projects` (whose own policy is
-- about to call this function) and `project_members` (which is under RLS), and
-- either would recurse. It is safe to expose because it reports only the
-- *calling* user's role, whatever argument it is handed -- there is no input
-- that makes it describe anybody else.
create or replace function public.project_role_of(p_uid uuid)
returns public.project_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.projects p
       where p.uid = p_uid and p.user_id = auth.uid()
    ) then 'owner'::public.project_role
    else (
      select m.role from public.project_members m
       where m.project_uid = p_uid and m.user_id = auth.uid()
    )
  end;
$$;

-- Blobs are stored per *user*, not per project (see the storage section), so
-- writing one asks a coarser question than reading it does.
create or replace function public.can_write_for_owner(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_owner = auth.uid() or exists (
    select 1
      from public.project_members m
      join public.projects p on p.uid = m.project_uid
     where p.user_id  = p_owner
       and m.user_id  = auth.uid()
       and m.role    >= 'editor'
  );
$$;

revoke all     on function public.project_role_of(uuid)     from public;
revoke all     on function public.can_write_for_owner(uuid) from public;
grant  execute on function public.project_role_of(uuid)     to authenticated;
grant  execute on function public.can_write_for_owner(uuid) to authenticated;

alter table public.project_members enable row level security;

drop policy if exists "project_members_select"      on public.project_members;
drop policy if exists "project_members_write_owner" on public.project_members;
drop policy if exists "project_members_leave"       on public.project_members;

-- Anyone on the project can see the roster. You cannot show "who else is here"
-- without it, and presence is the first thing this unlocks.
create policy "project_members_select"
  on public.project_members for select
  using (public.project_role_of(project_uid) is not null);

-- Only the owner grants and revokes. Redeeming an invite does not come through
-- this policy; it goes through `redeem_project_invite` below.
create policy "project_members_write_owner"
  on public.project_members for all
  using      (public.project_role_of(project_uid) = 'owner')
  with check (public.project_role_of(project_uid) = 'owner');

-- ...except that you may always remove yourself.
create policy "project_members_leave"
  on public.project_members for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
-- One table serves both paths. A link invite has `email is null` and is
-- redeemable by whoever holds the token; an email invite is addressed, and the
-- redeeming account must match it.
--
-- Either way the token is a one-time door and not the standing credential: once
-- redeemed, access *is* the membership row. Revoking someone therefore means
-- deleting their row, not rotating the link -- which is the only version of
-- revocation that works when the link has already been forwarded.
create table if not exists public.project_invites (
  token       uuid primary key default gen_random_uuid(),
  project_uid uuid not null references public.projects (uid) on delete cascade,
  role        public.project_role not null default 'viewer',
  email       text,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  max_uses    int,
  uses        int not null default 0,
  revoked     boolean not null default false,
  -- Ownership is not transferable by link.
  constraint project_invites_role check (role <> 'owner')
);

create index if not exists project_invites_project_idx
  on public.project_invites (project_uid);

alter table public.project_invites enable row level security;

drop policy if exists "project_invites_owner" on public.project_invites;

-- Deliberately no policy for the invitee. Holding a token must not let you read
-- the row: that would leak who else was invited, at what role, and would let
-- anyone probe which tokens exist. The redeemer only ever calls the function.
create policy "project_invites_owner"
  on public.project_invites for all
  using      (public.project_role_of(project_uid) = 'owner')
  with check (public.project_role_of(project_uid) = 'owner'
              and created_by = auth.uid());

create or replace function public.redeem_project_invite(p_token uuid)
returns table (project_uid uuid, role public.project_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv   public.project_invites;
  uid   uuid := auth.uid();
  owner uuid;
begin
  if uid is null then
    raise exception 'sign in before opening a shared project';
  end if;

  -- `for update` so two people redeeming a single-use link at once cannot both
  -- pass the `uses` check.
  select * into inv from public.project_invites where token = p_token for update;

  -- One message for every failure. Distinguishing "expired" from "no such
  -- token" tells someone probing which tokens are real.
  if not found
     or inv.revoked
     or (inv.expires_at is not null and inv.expires_at < now())
     or (inv.max_uses   is not null and inv.uses >= inv.max_uses) then
    raise exception 'this invite is no longer valid';
  end if;

  if inv.email is not null and lower(inv.email) <> lower(coalesce(
       (select u.email from auth.users u where u.id = uid), '')) then
    raise exception 'this invite is no longer valid';
  end if;

  select p.user_id into owner from public.projects p where p.uid = inv.project_uid;

  -- The owner following their own link already has everything, and the
  -- `role <> 'owner'` check on the table would refuse the row anyway.
  if uid = owner then
    return query select inv.project_uid, 'owner'::public.project_role;
    return;
  end if;

  insert into public.project_members (project_uid, user_id, role, invited_by)
  values (inv.project_uid, uid, inv.role, inv.created_by)
  -- Named constraint rather than `on conflict (project_uid, user_id)`: this
  -- function's OUT parameters are called `project_uid` and `role` too, and a
  -- bare column list there is ambiguous between the two -- which Postgres
  -- rejects at call time, not at definition time, so every redemption fails.
  on conflict on constraint project_members_pkey do update
    -- Re-following a viewer link must not demote an existing editor.
    set role = greatest(public.project_members.role, excluded.role);

  update public.project_invites set uses = uses + 1 where token = p_token;

  return query select inv.project_uid, inv.role;
end;
$$;

revoke all     on function public.redeem_project_invite(uuid) from public;
grant  execute on function public.redeem_project_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Wall 1: the project row
-- ---------------------------------------------------------------------------
drop policy if exists "projects_select_own"     on public.projects;
drop policy if exists "projects_update_own"     on public.projects;
drop policy if exists "projects_select_member"  on public.projects;
drop policy if exists "projects_update_editor"  on public.projects;

create policy "projects_select_member"
  on public.projects for select
  using (public.project_role_of(uid) is not null);

create policy "projects_update_editor"
  on public.projects for update
  using      (public.project_role_of(uid) >= 'editor')
  with check (public.project_role_of(uid) >= 'editor');

-- `projects_insert_own` and `projects_delete_own` are unchanged and stay
-- ownership-only: you create projects for yourself, and only an owner deletes.
-- The `with check` above cannot see the old row, so what stops an editor
-- reassigning `user_id` to themselves is `projects_freeze_identity_trg`, added
-- with the `uid` column.

-- ---------------------------------------------------------------------------
-- Wall 2: version history
-- ---------------------------------------------------------------------------
-- `user_id` used to carry two facts at once: which project this is a version
-- of, and who committed it. Once an editor can commit, those differ.
-- `project_uid` now carries the first; `user_id` keeps the second and becomes
-- the authorship record an activity feed will read.
drop policy if exists "project_versions_select_own"    on public.project_versions;
drop policy if exists "project_versions_insert_own"    on public.project_versions;
drop policy if exists "project_versions_select_member" on public.project_versions;
drop policy if exists "project_versions_insert_editor" on public.project_versions;

create policy "project_versions_select_member"
  on public.project_versions for select
  using (
    (project_uid is not null and public.project_role_of(project_uid) is not null)
    -- History outlives its project, so a row whose project is gone has a null
    -- `project_uid` and no membership to consult. Its author keeps it.
    or (project_uid is null and user_id = auth.uid())
  );

create policy "project_versions_insert_editor"
  on public.project_versions for insert
  with check (
    public.project_role_of(project_uid) >= 'editor'
    and user_id = auth.uid()   -- you may only sign a commit as yourself
  );

-- Still no update or delete policy, for the reason manifest.sql gives.

-- ---------------------------------------------------------------------------
-- Wall 3: the bytes
-- ---------------------------------------------------------------------------
-- Blobs live at `<owner_id>/blobs/<xx>/<hash>` -- content-addressed and
-- deduplicated per *user*, not per project. So "may I read this object" cannot
-- be answered from the path alone: it needs to know whether that hash appears
-- in a project I am a member of. This table is that index, maintained from the
-- committed manifest so a client cannot widen its own access by naming a hash
-- it never committed.
--
-- Note what is deliberately NOT happening here: the bytes are not being moved
-- to a project-scoped path. A storage layout is not an identity -- nothing
-- outside this database references a blob path -- so it stays changeable, and
-- moving objects is a data migration this file cannot honestly perform. `uid`
-- had to be now; this did not.
--
-- Entries are never removed. A hash dropped from the current manifest is still
-- named by `project_versions`, and a member restoring an old version must still
-- be able to read it. Blobs are immutable, so an accrued grant can never come
-- to point at different content than it did when it was granted.
create table if not exists public.project_blobs (
  project_uid uuid not null references public.projects (uid) on delete cascade,
  hash        text not null,
  -- Which user's storage folder the bytes sit in. A location, not an identity;
  -- it changes if the layout ever does.
  owner_id    uuid not null,
  primary key (project_uid, hash)
);

create index if not exists project_blobs_lookup_idx
  on public.project_blobs (owner_id, hash);

alter table public.project_blobs enable row level security;

drop policy if exists "project_blobs_select_member" on public.project_blobs;
create policy "project_blobs_select_member"
  on public.project_blobs for select
  using (public.project_role_of(project_uid) is not null);
-- No write policy: only the trigger below writes here, and it is definer.

create or replace function public.projects_index_blobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_blobs (project_uid, hash, owner_id)
  select distinct new.uid, f->>'hash', new.user_id
    from jsonb_array_elements(coalesce(new.files, '[]'::jsonb)) f
   where coalesce(f->>'hash', '') <> ''
  on conflict do nothing;
  return null;
end;
$$;

drop trigger if exists projects_index_blobs_trg on public.projects;
create trigger projects_index_blobs_trg
  after insert or update of files on public.projects
  for each row execute function public.projects_index_blobs();

-- Backfill for projects that already exist.
insert into public.project_blobs (project_uid, hash, owner_id)
select distinct p.uid, f->>'hash', p.user_id
  from public.projects p, jsonb_array_elements(coalesce(p.files, '[]'::jsonb)) f
 where coalesce(f->>'hash', '') <> ''
on conflict do nothing;

drop policy if exists "proj_files_select_own"      on storage.objects;
drop policy if exists "proj_files_insert_own"      on storage.objects;
drop policy if exists "proj_files_update_own"      on storage.objects;
drop policy if exists "proj_files_select_member"   on storage.objects;
drop policy if exists "proj_files_insert_member"   on storage.objects;
drop policy if exists "proj_files_update_own_only" on storage.objects;

create policy "proj_files_select_member" on storage.objects for select
  using (
    bucket_id = 'projects'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (
        select 1 from public.project_blobs b
         where b.owner_id::text = (storage.foldername(name))[1]
           and b.hash = regexp_replace(name, '^.*/', '')
           and public.project_role_of(b.project_uid) is not null
      )
    )
  );

-- An editor's uploads must land in the *owner's* space, or the owner could not
-- read back what the editor committed. This grant is coarser than the read one
-- -- per owner, not per hash -- because the object has to exist before any
-- manifest can name it. The exposure is quota, not disclosure: object names are
-- content hashes, so a write can only ever create bytes the writer already
-- holds, and reading anything back still goes through the policy above.
create policy "proj_files_insert_member" on storage.objects for insert
  with check (
    bucket_id = 'projects'
    and public.can_write_for_owner(((storage.foldername(name))[1])::uuid)
  );

-- Update and delete stay ownership-only. Blobs are immutable and addressed by
-- their content; nothing in the app has a reason to overwrite one, and a
-- collaborator must never be able to remove bytes another project still names.
create policy "proj_files_update_own_only" on storage.objects for update
  using (bucket_id = 'projects' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------------
-- commit_project(), for a project you do not own
-- ---------------------------------------------------------------------------
-- The compare-and-swap is unchanged, and so is the fact that the version is
-- advanced by `projects_bump_version_zz_trg` and never here -- doing it in both
-- places would advance it by two and make a correctly recorded base stale on
-- the caller's very next push.
--
-- What changes is that the row is no longer assumed to be the caller's.
-- `p_uid` defaults to null so existing four-argument calls keep resolving and
-- keep meaning "my own project with this local id".
--
-- Still `security invoker`, for the reason the CAS migration gives: this
-- function states the concurrency rule, and RLS -- now membership-aware --
-- remains the authority on access.
drop function if exists public.commit_project(uuid, text, jsonb, bigint);

create or replace function public.commit_project(
  p_id    uuid,
  p_name  text,
  p_files jsonb,
  p_base  bigint,
  p_uid   uuid default null
) returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v bigint;
begin
  if p_base <= 0 then
    -- A first commit is always your own project: you cannot create a row inside
    -- someone else's account, and `projects_insert_own` would refuse it anyway.
    insert into public.projects (id, user_id, name, files, version)
    values (p_id, auth.uid(), p_name, p_files, 1)
    on conflict (user_id, id) do nothing
    returning version into v;
    return v; -- null when the row already existed: the caller is stale
  end if;

  update public.projects
     set name       = p_name,
         files      = p_files,
         updated_at = now()
   where version = p_base
     and case
           when p_uid is null then id = p_id and user_id = auth.uid()
           else uid = p_uid
         end
  returning version into v;

  -- Null when the base was stale *or* when RLS hid the row because the caller
  -- is only a viewer. Both mean the same thing to a client: pull, then retry.
  return v;
end;
$$;

revoke all     on function public.commit_project(uuid, text, jsonb, bigint, uuid) from public;
grant  execute on function public.commit_project(uuid, text, jsonb, bigint, uuid) to authenticated;
