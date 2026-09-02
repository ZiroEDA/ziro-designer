-- A version integer and a compare-and-swap commit, replacing wall-clock LWW.
--
-- What was wrong. `projects.updated_at` held whatever `Date.now()` the *browser*
-- said (`cloudStore.ts` wrote `new Date(p.updatedAt).toISOString()`), and the
-- reconcile compared two machines' clocks to decide which copy was newer. A
-- device ninety seconds slow lost every race regardless of what actually
-- happened first, and the contents were never consulted at all -- so merely
-- opening a project, which rewrites identical bytes and restamps the clock,
-- could overwrite a different machine's real work.
--
-- What replaces it. A push states the version it was editing. The update lands
-- only if the row is still at that version; zero rows back means the row moved
-- underneath it. Divergence becomes a fact the server states rather than
-- something a client infers from two numbers it has no reason to trust. This is
-- git's fast-forward rule, and it is the same shape as `append_ops(doc_id,
-- base_seq, ops)` in the op-log design -- file granularity now, op granularity
-- later, one mechanism either way.
--
-- `updated_at` survives as a display field. Nothing reads it to decide anything
-- any more, and from here it is stamped by the server's clock, not a client's.

alter table public.projects
  add column if not exists version bigint not null default 1;

comment on column public.projects.version is
  'Monotonic commit counter. A write must name the version it replaces; see commit_project().';

-- The only supported way to write a project row.
--
-- `security invoker` on purpose: row-level security stays the authority on who
-- may write what, exactly as it is for a direct update. This function adds the
-- concurrency rule, not an exemption from the access rule.
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
    -- A first commit, which asserts the row does not exist yet. `do nothing`
    -- rather than `do update` is the entire point: a row that is already there
    -- is one this client has never seen, so it is stale and has to pull before
    -- it may write. An upsert here would silently overwrite another device's
    -- project, which is the bug this migration exists to remove.
    insert into public.projects (id, user_id, name, files, version)
    values (p_id, auth.uid(), p_name, p_files, 1)
    on conflict (user_id, id) do nothing
    returning version into v;
    return v; -- null when the row already existed
  end if;

  update public.projects
     set name       = p_name,
         files      = p_files,
         version    = version + 1,
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
