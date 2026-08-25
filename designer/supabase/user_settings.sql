-- Ziro Designer, the user's settings following their account.
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Independent of projects.sql / storage.sql / manifest.sql; order does not
-- matter. Until it is run the app still works: preferences persist in the
-- browser exactly as before, the client reports the missing table once to the
-- console, and nothing throws (see designer/src/cloud/settingsSync.ts).
--
-- One row per KiCad settings *file*, not one row per user. That is upstream's
-- granularity — SETTINGS_MANAGER keeps a JSON_SETTINGS per file and
-- SETTINGS_MANAGER::Save (common/settings/settings_manager.cpp:190-209) writes
-- each to its own path — and it is what keeps a conflict from taking the whole
-- preferences dialog with it: two devices have to have edited the *same* file
-- for either to lose anything.
--
-- `key` holds the file's basename: common, eeschema, pcbnew, pl_editor,
-- privacy, colors.user, hotkeys.

create table if not exists public.user_settings (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  -- `meta.version` (common/settings/json_settings.cpp:96) — the schema version
  -- of the build that wrote this row. A client reading a row NEWER than itself
  -- loads what it understands and never writes back, which is
  -- JSON_SETTINGS' m_isFutureFormat (json_settings.cpp:323-330) plus
  -- ShouldAutoSave() (include/project/project_file.h:158).
  version    int not null default 0,
  value      jsonb not null default '{}'::jsonb,
  -- Set by the trigger below, never by the client: one clock shared by every
  -- device is what makes "has the account moved since we agreed" exact.
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Scoped (user_id, key) for the same reason projects.sql scopes (user_id, id):
-- a key that is unique across accounts lets one account's upsert take its
-- ON CONFLICT UPDATE path against a row it does not own, which row-level
-- security then refuses with "violates ... (USING expression)".

create index if not exists user_settings_user_idx on public.user_settings (user_id);

-- ---------------------------------------------------------------------------
-- The server owns updated_at.
-- ---------------------------------------------------------------------------
-- A client-supplied timestamp is a second clock, and the whole point of reading
-- this value back after a write is to compare two writes from two machines. It
-- is also the one thing a buggy or hostile client could set far in the future
-- to win every conflict forever.
create or replace function public.user_settings_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_settings_stamp_trg on public.user_settings;
create trigger user_settings_stamp_trg
  before insert or update on public.user_settings
  for each row execute function public.user_settings_stamp();

-- ---------------------------------------------------------------------------
-- Row-level security: a user reaches only their own settings.
-- ---------------------------------------------------------------------------
alter table public.user_settings enable row level security;

-- Recreated idempotently, as in projects.sql, so the file can be re-run.
drop policy if exists "user_settings_select_own" on public.user_settings;
drop policy if exists "user_settings_insert_own" on public.user_settings;
drop policy if exists "user_settings_update_own" on public.user_settings;
drop policy if exists "user_settings_delete_own" on public.user_settings;

create policy "user_settings_select_own"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "user_settings_insert_own"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "user_settings_update_own"
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_settings_delete_own"
  on public.user_settings for delete
  using (auth.uid() = user_id);
