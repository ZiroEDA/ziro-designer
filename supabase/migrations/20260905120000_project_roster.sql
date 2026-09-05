-- Who is on a project.
--
-- `project_members` stores user ids, because that is what a foreign key to an
-- account is. A roster has to show people, and a person is an email address --
-- so something has to read `auth.users`, which no client may do and should not
-- be able to: that table is every account on the deployment.
--
-- Hence one `security definer` function that answers exactly one question, for
-- exactly one project, and only for somebody already on it. It cannot be used
-- to enumerate accounts: without a project uid it returns nothing, and a uid is
-- an unguessable identifier that the caller must already have access to.
--
-- The privacy trade is deliberate and is the one every tool of this kind makes:
-- people sharing a project can see each other's addresses. That is what makes a
-- roster a roster rather than a count, and it is what Figma, Canva and Google
-- Docs all show. It does not extend one row further than the project.

create or replace function public.project_roster(p_uid uuid)
returns table (
  user_id   uuid,
  email     text,
  role      public.project_role,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The access check is the whole security of this function. `project_role_of`
  -- is itself definer and answers for the CALLER, so a member sees the roster
  -- and nobody else reaches the query below at all.
  if public.project_role_of(p_uid) is null then
    raise exception 'this project is not available';
  end if;

  return query
    -- The owner, who holds no membership row: ownership is the `projects` row.
    select p.user_id, u.email::text, 'owner'::public.project_role, p.created_at
      from public.projects p
      join auth.users u on u.id = p.user_id
     where p.uid = p_uid
    union all
    select m.user_id, u.email::text, m.role, m.created_at
      from public.project_members m
      join auth.users u on u.id = m.user_id
     where m.project_uid = p_uid
     -- Newest last, so a roster reads in the order people arrived and does not
     -- reshuffle when somebody's role changes.
     order by 4;
end;
$$;

revoke all     on function public.project_roster(uuid) from public;
grant  execute on function public.project_roster(uuid) to authenticated;
