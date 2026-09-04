-- Only an owner decides how a project is shared.
--
-- `projects_update_editor` grants UPDATE on the row, and a row is all columns.
-- `link_access` is one of them, so as it stands an editor -- somebody invited
-- to help with a board -- can switch on "anyone with the link can edit" for a
-- project that is not theirs, and nothing tells the owner.
--
-- That is not what being an editor means anywhere: in Figma and Google Docs
-- alike, editing a document and changing who can reach it are different
-- permissions, and the second belongs to the owner.
--
-- Enforced with a trigger rather than a column-level grant, for the same reason
-- `projects_freeze_identity` is: a policy's `with check` cannot see the old
-- row, so it can tell that the new value is 'editor' but not that it was null a
-- moment ago -- and it is the *change* that has to be refused, not the value.

create or replace function public.projects_freeze_identity()
returns trigger
language plpgsql
as $$
begin
  if new.uid <> old.uid or new.id <> old.id or new.user_id <> old.user_id then
    raise exception
      'a project''s identity is fixed; to re-own it, transfer it or copy it';
  end if;

  -- `is distinct from` rather than `<>`: link_access is nullable, and null is
  -- the value that matters most here -- switching sharing ON is exactly the
  -- change being guarded, and `null <> 'editor'` is null, which is not true,
  -- so `<>` would wave it straight through.
  if new.link_access is distinct from old.link_access and old.user_id <> auth.uid() then
    raise exception 'only the owner of a project can change how it is shared';
  end if;

  return new;
end;
$$;
