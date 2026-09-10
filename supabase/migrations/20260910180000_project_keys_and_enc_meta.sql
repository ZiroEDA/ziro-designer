-- End-to-end encryption of projects: the keys the server relays and cannot
-- open, and the column the encrypted metadata lives in.
--
-- docs/encryption-plan.md, phases P0 and P1. Every project has a random
-- `projectKey`. It is never stored; what is stored is that key wrapped under
-- the owner's master key, and, for each collaborator, sealed to their public
-- key. A project's name and its manifest (paths, sizes, plaintext hashes,
-- per-file keys) travel in `enc_meta`, encrypted under the project key. The
-- server keeps seeing `files`, because the row-level security that grants a
-- member a blob keys on it -- but for an encrypted project the `hash` in each
-- entry is a random id and the `size` is the ciphertext's, so what it grants
-- is a name that means nothing.

-- ---------------------------------------------------------------------------
-- The keys.

create table public.project_keys (
  project_uid uuid not null references public.projects (uid) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Base64 ciphertext. `master`: wrapped under this user's master key (the
  -- owner, or a member who has re-wrapped a key handed to them by link).
  -- `sealed`: sealed to this user's public key by the owner at share time,
  -- readable by this user's private key alone.
  enc_key     text not null,
  how         text not null check (how in ('master', 'sealed')),
  created_at  timestamptz not null default now(),
  primary key (project_uid, user_id)
);

alter table public.project_keys enable row level security;

-- You read your own key to a project. The OWNER of the project reads every
-- key row of it: they are all keys to their project, they wrote the sealed
-- ones, and a member's master-wrapped one opens nothing without that
-- member's master key. The owner needs to see them to take one away -- a
-- DELETE with a WHERE is also a SELECT under row-level security.
create policy "project_keys_select_own_or_owner"
  on public.project_keys for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.uid = project_uid and p.user_id = auth.uid()
    )
  );

-- Two writers. Your own row, however it is wrapped. And the OWNER of the
-- project, writing a sealed row for a member they are sharing with -- the
-- only way a key reaches someone who was not handed it by link.
create policy "project_keys_insert_own_or_owner"
  on public.project_keys for insert
  with check (
    user_id = auth.uid()
    or (
      how = 'sealed'
      and exists (
        select 1 from public.projects p
        where p.uid = project_uid and p.user_id = auth.uid()
      )
    )
  );

create policy "project_keys_update_own_or_owner"
  on public.project_keys for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.uid = project_uid and p.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.uid = project_uid and p.user_id = auth.uid()
    )
  );

-- The owner takes a member's key away (removal, then rotation); a member may
-- drop their own.
create policy "project_keys_delete_own_or_owner"
  on public.project_keys for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.uid = project_uid and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- The encrypted metadata.

alter table public.projects add column if not exists enc_meta text;
alter table public.project_versions add column if not exists enc_meta text;

-- commit_project carries it. The old five-argument signature goes, so the new
-- one with a defaulted sixth resolves for a client that does not send it.
drop function if exists public.commit_project(uuid, text, jsonb, bigint, uuid);

create or replace function public.commit_project(
  p_id       uuid,
  p_name     text,
  p_files    jsonb,
  p_base     bigint,
  p_uid      uuid default null,
  p_enc_meta text default null
) returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v bigint;
begin
  if p_base <= 0 then
    if p_uid is null then
      insert into public.projects (id, user_id, name, files, version, uid, enc_meta)
      values (p_id, auth.uid(), p_name, p_files, 1, gen_random_uuid(), p_enc_meta)
      on conflict (user_id, id) do nothing
      returning version into v;
    else
      insert into public.projects (id, user_id, name, files, version, uid, enc_meta)
      values (p_id, auth.uid(), p_name, p_files, 1, p_uid, p_enc_meta)
      on conflict (uid) do nothing
      returning version into v;
    end if;
    return v;
  end if;

  update public.projects
     set name       = p_name,
         files      = p_files,
         enc_meta   = p_enc_meta,
         updated_at = now()
   where version = p_base
     and case
           when p_uid is null then id = p_id and user_id = auth.uid()
           else uid = p_uid
         end
  returning version into v;

  return v;
end;
$$;

revoke all     on function public.commit_project(uuid, text, jsonb, bigint, uuid, text) from public, anon;
grant  execute on function public.commit_project(uuid, text, jsonb, bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The version counts changes to the project, and the encrypted metadata IS
-- the project now: an encrypted commit changes `enc_meta` and may leave
-- `files` and `name` exactly as they were (a rename, a rotation), and the
-- version must still move or no other device is told and compare-and-swap
-- has nothing to compare. The harness caught this: a second encrypted commit
-- came back as version 1.

create or replace function public.projects_bump_version() returns trigger
language plpgsql
as $$
begin
  if new.files is distinct from old.files
     or new.name is distinct from old.name
     or new.enc_meta is distinct from old.enc_meta then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;
