-- The version advances on *every* update, not only the ones that go through
-- `commit_project`.
--
-- As first written, `commit_project` incremented the column itself. That holds
-- the invariant only for callers who use it, and there are two kinds who do not:
-- a browser tab still running the previously deployed bundle, which writes the
-- row with a plain PostgREST upsert, and anything reaching the REST API
-- directly. Such a write changes `files` and leaves `version` where it was, so
-- the next client to read the row sees a version it already believes it has and
-- concludes nothing moved -- which is exactly the stale-overwrite this whole
-- change exists to prevent, reintroduced through the side door.
--
-- Moving the increment into a trigger makes it a property of the table. A write
-- that does not advance the version becomes impossible to express, whoever
-- makes it, which is the only form of an invariant worth relying on.

create or replace function public.projects_bump_version() returns trigger
language plpgsql
as $$
begin
  -- Always from the row being replaced, never from what the client sent: a
  -- caller that supplies its own `version` must not be able to choose one.
  new.version := old.version + 1;
  return new;
end;
$$;

alter function public.projects_bump_version() owner to postgres;

-- `_zz_` so it runs after `projects_reject_damage_trg`: BEFORE triggers fire in
-- name order, and the damage check should reject a bad write before anything
-- else bothers to describe it.
drop trigger if exists projects_bump_version_zz_trg on public.projects;
create trigger projects_bump_version_zz_trg
  before update on public.projects
  for each row execute function public.projects_bump_version();

-- And `commit_project` stops doing it by hand, or the two would compound and
-- every commit would advance the version by two -- making the base a caller
-- correctly recorded stale on its very next push.
create or replace function public.commit_project(
  p_id    uuid,
  p_name  text,
  p_files jsonb,
  p_base  bigint
) returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v bigint;
begin
  if p_base <= 0 then
    insert into public.projects (id, user_id, name, files, version)
    values (p_id, auth.uid(), p_name, p_files, 1)
    on conflict (user_id, id) do nothing
    returning version into v;
    return v; -- null when the row already existed: the caller is stale
  end if;

  -- No `version = version + 1` here any more; the trigger owns it. RETURNING
  -- reads the row after BEFORE triggers have run, so this is the landed value.
  update public.projects
     set name       = p_name,
         files      = p_files,
         updated_at = now()
   where id      = p_id
     and user_id = auth.uid()
     and version = p_base
  returning version into v;

  return v; -- null when the base was stale: the caller must pull and retry
end;
$$;

revoke all     on function public.commit_project(uuid, text, jsonb, bigint) from public;
grant  execute on function public.commit_project(uuid, text, jsonb, bigint) to authenticated;
