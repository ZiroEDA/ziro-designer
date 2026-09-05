-- The version counts changes to the project, not writes to the row.
--
-- `projects_bump_version` advanced `version` on every UPDATE, whatever it
-- touched. That was right when the only thing that ever updated the row was a
-- commit of the files, and it stopped being right the moment anything else did:
-- `setLinkAccess` writes one metadata column, the trigger bumped the version,
-- and every other device read that as "the project moved".
--
-- What the user sees from that is not a stale number. The sync pulls, finds the
-- local copy has edits the cloud does not, and -- correctly, given what it was
-- told -- preserves them by forking the project aside as
-- "<name> (local copy, <date>)". So turning link sharing on quietly spawned a
-- duplicate project on every other machine signed into that account. Two of
-- them showed up in Open Project before anybody worked out why.
--
-- So the bump is keyed on the document instead: `name` and `files`, the two
-- things a project actually consists of. A write that changes neither leaves the
-- version alone, and a device that has not been told anything moved does not go
-- looking for a conflict.
--
-- This keeps the whole point of the trigger, which was never "every write" for
-- its own sake -- it was that a client must not be able to change the files and
-- leave the version where it was. A browser running an old bundle, or something
-- reaching the REST API directly, still cannot express that: if `files` moves,
-- the version moves, and it is not the caller's choice.
--
-- `name` counts because a rename has to reach the other devices, and the
-- version is the only thing they consult to decide whether to look.

create or replace function public.projects_bump_version() returns trigger
language plpgsql
as $$
begin
  -- `is distinct from` rather than `<>`: `files` is jsonb and `name` is text,
  -- and a null on either side of `<>` yields null, which is not true -- so `<>`
  -- would quietly answer "unchanged" for a column going to or from null.
  if new.files is distinct from old.files or new.name is distinct from old.name then
    -- Always from the row being replaced, never from what the client sent: a
    -- caller that supplies its own `version` must not be able to choose one.
    new.version := old.version + 1;
  else
    -- Metadata only -- `link_access`, `updated_at`. Nothing about the project
    -- changed, so nothing should tell another device that it did.
    new.version := old.version;
  end if;
  return new;
end;
$$;

alter function public.projects_bump_version() owner to postgres;
