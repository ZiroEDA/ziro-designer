-- Deleting your own account, the way the reference (ente) does it.
--
-- ente's `DELETE /users/delete` takes the reason and feedback its dialog
-- collected, proves the caller holds the account's keys (a challenge sealed
-- to their public key), and removes the account with everything under it.
-- This is that, on Postgres:
--
--   - `account_deletion_summary()` is `/users/deletion-summary`: what the
--     confirmation step lists before the checkbox can be ticked.
--   - `delete_my_account(reason, feedback)` is `/users/delete`.
--
-- The proof is the JWT rather than a sealed challenge. The dialog asks for
-- the password again and signs in with it, which mints a token whose `amr`
-- names a password authentication and when; the function refuses a token
-- whose last password sign-in is not recent. What that buys is the same
-- thing ente's challenge buys: a session token on its own -- lifted from a
-- tab, or a refresh token -- cannot delete the account, because a refresh
-- keeps the old `amr` and only the password mints a fresh one.
--
-- Everything under the account goes by cascade from `auth.users`: projects
-- and their versions, the memberships and invitations of projects this
-- account owned (members lose them, as they do in ente when a shared album's
-- owner leaves), this account's memberships in other people's projects, its
-- project keys, its account keys, its settings. The bytes in storage are the
-- client's to remove first, through the storage API, because a row deleted
-- from `storage.objects` by SQL leaves its object behind unreachable; the
-- policy below is what lets it.

-- ---------------------------------------------------------------------------
-- Feedback. Anonymous by construction: ente mails the reason and feedback to
-- its team; ours is a row with no user in it, because the user is about to
-- not exist. Nobody reads it through the API -- no policy -- only the
-- definer function writes it.
-- ---------------------------------------------------------------------------
create table if not exists public.account_deletion_feedback (
  id         bigint generated always as identity primary key,
  reason     text not null,
  feedback   text not null,
  created_at timestamptz not null default now()
);
alter table public.account_deletion_feedback enable row level security;

-- ---------------------------------------------------------------------------
-- Storage: the owner may remove their own blobs. Update was already
-- ownership-only (20260904121000); delete is the same rule, and was missing
-- from the chain -- the orphan sweep in cloudStore.ts has been relying on a
-- policy set by hand.
-- ---------------------------------------------------------------------------
drop policy if exists "proj_files_delete_own" on storage.objects;
create policy "proj_files_delete_own" on storage.objects for delete
  using (bucket_id = 'projects' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------------
-- Was the caller's token minted by a password sign-in within `p_within`?
-- `amr` is the list of authentication methods behind this token, each with
-- the time it happened; a refreshed token carries the list forward unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.recently_signed_in_with_password(p_within interval)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
     where e ->> 'method' = 'password'
       and to_timestamp((e ->> 'timestamp')::bigint) > now() - p_within
  );
$$;

revoke all     on function public.recently_signed_in_with_password(interval) from public;
grant  execute on function public.recently_signed_in_with_password(interval) to authenticated;

-- ---------------------------------------------------------------------------
-- What deleting the account deletes, for the confirmation step.
-- ---------------------------------------------------------------------------
create or replace function public.account_deletion_summary()
returns table (projects bigint, people bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.projects p where p.user_id = auth.uid()),
    (select count(distinct m.user_id)
       from public.project_members m
       join public.projects p on p.uid = m.project_uid
      where p.user_id = auth.uid());
$$;

revoke all     on function public.account_deletion_summary() from public;
grant  execute on function public.account_deletion_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- The deletion.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account(p_reason text, p_feedback text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not public.recently_signed_in_with_password(interval '5 minutes') then
    raise exception 'reauthentication required' using errcode = '28000';
  end if;
  insert into public.account_deletion_feedback (reason, feedback)
  values (coalesce(p_reason, ''), coalesce(p_feedback, ''));
  delete from auth.users where id = v_uid;
end;
$$;

revoke all     on function public.delete_my_account(text, text) from public;
grant  execute on function public.delete_my_account(text, text) to authenticated;
