-- One identity for a project, which is `uid`.
--
-- The primary key was `(user_id, id)`, and `id` came from the browser's
-- IndexedDB. That was not sloppiness: the four user-data folders -- Templates,
-- Symbols, Footprints, 3D Models -- deliberately use FIXED uuids so that
-- "Templates" is the same row on every device an account signs in from, and
-- sharing that id across accounts is only safe while the owner is part of the
-- key. So the composite key was load-bearing, and `id` was genuinely not
-- unique.
--
-- Two ids is not what anything else does. A project in Figma, Canva or Linear
-- has one, and everything -- links, membership, history -- names that one.
-- Carrying two means every join, every policy and every client path has to
-- know which of them is meaningful in that context, and the answer differs.
--
-- `uid` is already that one id: every foreign key in the schema references it,
-- and nothing references `(user_id, id)`. This makes it the key.
--
-- What that dissolves, rather than fixes: once the server keys on `uid`, two
-- accounts holding the same local `id` stops mattering at all. The fixed folder
-- uuids become what they always were -- a local name for a local file -- and
-- the per-owner derived id the client keeps for browser-level collisions is no
-- longer anything the cloud has an opinion about.
--
-- `id` survives one more release as a plain, nullable column, and only because
-- clients that predate this still recognise their own rows by it. It is dropped
-- once they have all learned their uids.

alter table public.projects drop constraint projects_pkey;
alter table public.projects add constraint projects_pkey primary key (uid);

-- Not a key any more, so not required either. A project created by a client
-- that mints its own uid has no need of one.
alter table public.projects alter column id drop not null;

-- `projects_uid_key` stays. The primary key's own index makes it redundant, but
-- the three foreign keys were created against that named constraint and
-- dropping it would mean recreating all of them -- a lot of churn on live data
-- to save one index on a table of this size.

-- `(user_id, id)` survives as a UNIQUE constraint rather than as the key, and
-- for one specific reason: a client that predates minting its own uid pushes a
-- first commit with no identity to offer, and the old primary key was what made
-- that insert idempotent. A conflict on `uid` cannot catch it -- the row would
-- arrive with a freshly minted uid and conflict with nothing -- so a stale
-- browser pushing a project the cloud already has would insert a SECOND copy.
--
-- It also serves the one-time lookup those clients need: "the row I know as
-- this local id, in my account".
--
-- Dropped in the same pass as the `id` column, once no client needs either.
alter table public.projects
  add constraint projects_user_local_id_key unique (user_id, id);

/**
 * The only supported way to write a project row.
 *
 * `p_uid` is now the identity for BOTH branches. A client that mints its own
 * uuid at creation -- which is what an offline-first client must be able to do,
 * and what everyone else lets it do -- names its project from the moment it
 * exists, so there is no window in which a project has no identity. That window
 * is what made `Share` say "this project has not reached the cloud yet" about a
 * project sitting in the cloud, and what the extra read-back after a first push
 * existed to close.
 *
 * The four-argument call is still resolvable, so a browser running the
 * previously deployed bundle keeps working: without `p_uid` it behaves exactly
 * as before, and the server mints the uid.
 *
 * Still `security invoker`: this states the concurrency rule, and row-level
 * security -- membership-aware -- remains the authority on access.
 */
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
    -- A first commit, which asserts the project is not there yet. `do nothing`
    -- rather than `do update` is the whole point: a row already at this uid is
    -- one this client has not seen, so it is stale and must pull before it may
    -- write.
    --
    -- Two conflict targets, because there are two kinds of caller and a
    -- statement may only name one.
    --
    -- A client with an identity conflicts on it, which is the stronger check:
    -- it notices the project is already there even if its local id has moved.
    -- A client without one has nothing to offer but `(user_id, id)`, and that
    -- constraint exists precisely so its insert stays idempotent -- a conflict
    -- on a uid minted one line earlier would never fire, and a stale browser
    -- would quietly create a second copy of a project it already has.
    if p_uid is null then
      insert into public.projects (id, user_id, name, files, version, uid)
      values (p_id, auth.uid(), p_name, p_files, 1, gen_random_uuid())
      on conflict (user_id, id) do nothing
      returning version into v;
    else
      insert into public.projects (id, user_id, name, files, version, uid)
      values (p_id, auth.uid(), p_name, p_files, 1, p_uid)
      on conflict (uid) do nothing
      returning version into v;
    end if;
    return v; -- null when the row already existed
  end if;

  update public.projects
     set name       = p_name,
         files      = p_files,
         updated_at = now()
   where version = p_base
     and case
           -- By identity. The `id` branch is only for a client that predates
           -- minting its own, and it still has to be the caller's own row.
           when p_uid is null then id = p_id and user_id = auth.uid()
           else uid = p_uid
         end
  returning version into v;

  -- Null when the base was stale, or when row-level security hid the row
  -- because the caller may only read it. Both mean: pull, then retry.
  return v;
end;
$$;

revoke all     on function public.commit_project(uuid, text, jsonb, bigint, uuid) from public;
grant  execute on function public.commit_project(uuid, text, jsonb, bigint, uuid) to authenticated;
