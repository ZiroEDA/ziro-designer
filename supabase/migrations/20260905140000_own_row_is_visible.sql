-- A row you just inserted is a row you can see.
--
-- `commit_project` ends its first-commit branch with `returning version`, and
-- that statement has been failing since membership landed:
--
--   new row violates row-level security policy for table "projects"
--
-- The insert itself was always allowed -- `projects_insert_own` is
-- `auth.uid() = user_id` and the row satisfies it. What failed is the
-- RETURNING, because Postgres applies the **SELECT** policy to the row a
-- statement hands back, and the SELECT policy was
--
--   using (project_role_of(uid) is not null)
--
-- `project_role_of` is `stable`, so it reads the statement's snapshot -- taken
-- *before* the insert -- looks for the row in `projects`, does not find it, and
-- answers "no role". The row is therefore judged invisible and the whole
-- statement is refused.
--
-- So every first push of a new project failed, which is to say no project
-- created in the browser could reach the cloud at all. It surfaced as one line
-- in the sync pill and nowhere else, and no test caught it because the SQL
-- suite exercised `commit_project` only on projects that already existed.
--
-- The fix says the obvious thing out loud: your own row is yours, and deciding
-- that needs no function call and no snapshot. It is also the cheaper test for
-- the common case -- most rows a user reads are their own -- so the definer
-- function is now only consulted for rows that are somebody else's.

drop policy if exists "projects_select_member" on public.projects;

create policy "projects_select_member"
  on public.projects for select
  using (
    -- Directly, and FIRST. A column compared against `auth.uid()` needs no
    -- snapshot of the table it is in, which is what makes this work for a row
    -- that does not exist yet as far as the statement is concerned.
    user_id = auth.uid()
    or public.project_role_of(uid) is not null
  );

-- The same reasoning applies wherever a policy asks a `stable` function about
-- the table it is guarding. `project_versions` is the other one, and its own
-- insert is written without RETURNING today -- but relying on a client never
-- asking for the row back is not an invariant, so it takes the same shape.
drop policy if exists "project_versions_select_member" on public.project_versions;

create policy "project_versions_select_member"
  on public.project_versions for select
  using (
    user_id = auth.uid()
    or (project_uid is not null and public.project_role_of(project_uid) is not null)
  );
