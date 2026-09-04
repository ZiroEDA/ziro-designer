-- Sharing by link, the way a document is shared.
--
-- `project_invites` is the GitHub model: a token addressed to a person, spent
-- once. It is the right shape for "invite paul@example.com as an editor", and
-- the wrong shape for the ordinary case -- "here is a link to my board" --
-- which is what Figma and Google Docs do, and they do it differently: the URL
-- *addresses the document*, and access is a setting on the document itself.
--
-- The difference matters because a token is a secret living in a URL, and that
-- one fact drags in everything around it: it has to be taken out of the address
-- bar, carried across a sign-in, spent exactly once, and explained when it has
-- already been spent. An address needs none of that.
--
-- So: `link_access` says what a link is worth, and null means links are off.
--
-- ---------------------------------------------------------------------------
-- The trap this avoids
-- ---------------------------------------------------------------------------
-- The obvious implementation is to let `project_role_of` fall back to
-- `link_access`, so anyone signed in gets that role. It is also catastrophic:
-- the SELECT policy on `projects` is `project_role_of(uid) is not null`, so
-- every link-shared project in the database would appear in every user's
-- project list.
--
-- Google Docs does not put a document in your drive until you open it. Nor does
-- this: the link grants a *membership row on first open*, and membership stays
-- the only thing any policy consults. A share link is a self-service invite --
-- which is exactly what it is -- rather than a second, parallel access rule
-- that every policy would have to remember to ask about.

alter table public.projects
  add column if not exists link_access public.project_role;

comment on column public.projects.link_access is
  'What anyone holding this project''s link may claim, via join_project_by_link(). '
  'Null disables link sharing. Deliberately NOT consulted by any policy: see '
  '20260904140000_project_link_access.sql.';

-- Ownership is not claimable by link, for the same reason it is not
-- transferable by invite.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_link_access_not_owner'
  ) then
    alter table public.projects
      add constraint projects_link_access_not_owner check (link_access <> 'owner');
  end if;
end $$;

/**
 * Claim the access a project's link offers, and return what was granted.
 *
 * `security definer` because the caller cannot see the project yet -- that is
 * the entire point -- so the row has to be read on their behalf. It reads
 * exactly one column of one row named by an unguessable uuid, and grants only
 * what that column already says it grants.
 *
 * Idempotent, and never a demotion: following a viewer link when you are
 * already an editor leaves you an editor, and the owner following their own
 * link is told they own it rather than being handed a membership row they must
 * not have.
 */
create or replace function public.join_project_by_link(p_uid uuid)
returns public.project_role
language plpgsql
security definer
set search_path = public
as $$
declare
  proj  public.projects;
  uid   uuid := auth.uid();
  grant_role public.project_role;
begin
  if uid is null then
    raise exception 'sign in to open a shared project';
  end if;

  select * into proj from public.projects p where p.uid = p_uid;

  -- One message whether the project does not exist or its link sharing is off.
  -- Distinguishing them turns this into an oracle for which project ids are
  -- real, which is the only secret an unguessable id has.
  if not found or proj.link_access is null then
    raise exception 'this link is not available';
  end if;

  if proj.user_id = uid then
    return 'owner'::public.project_role;
  end if;

  grant_role := proj.link_access;

  insert into public.project_members (project_uid, user_id, role)
  values (p_uid, uid, grant_role)
  -- Named constraint rather than a column list: this function's own
  -- `project_role` return type and the table's `role` column make a bare list
  -- ambiguous, which Postgres reports at call time and not before.
  on conflict on constraint project_members_pkey do update
    set role = greatest(public.project_members.role, excluded.role)
  returning role into grant_role;

  return grant_role;
end;
$$;

revoke all     on function public.join_project_by_link(uuid) from public;
grant  execute on function public.join_project_by_link(uuid) to authenticated;
