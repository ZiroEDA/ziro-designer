-- An account's wrapped keys: the server holds them and can open none of them.
--
-- End-to-end encryption (docs/encryption-design.md) gives every account a
-- random master key. It is never stored. What is stored is the master key
-- wrapped twice, under two independent secrets neither of which the server
-- has: the key derived from the password (Argon2id, `kdf` says how) and the
-- recovery key shown once at sign-up. Beside them, the account's public key
-- in the clear -- collaborators seal a shared project's key to it -- and the
-- matching private key wrapped under the master key.
--
-- One row per user, keyed by auth.users.id, gone with the user. There is no
-- delete policy on purpose: the keys are the account, and an account without
-- them is an account whose projects cannot be opened.
--
-- Every ciphertext is base64 text rather than bytea because that is what the
-- client hands over and reads back (`WrappedAccount`), and a column that needs
-- no conversion at either end is one that cannot be converted wrongly.

create table public.account_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- {name, salt, opsLimit, memLimitKiB} for argon2id; {name, salt, iterations}
  -- for a PBKDF2-SHA256 descriptor from the first accounts. Stored, not
  -- assumed, so the stretch can be replaced on new accounts without a flag day.
  kdf jsonb not null,
  public_key text not null,
  enc_master_key_by_password text not null,
  enc_master_key_by_recovery text not null,
  enc_private_key text not null,
  enc_recovery_key_by_master text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_keys enable row level security;

-- Your own row, and nobody else's, in every direction it can be touched.
create policy "account_keys_select_own"
  on public.account_keys for select
  using (user_id = auth.uid());

create policy "account_keys_insert_own"
  on public.account_keys for insert
  with check (user_id = auth.uid());

create policy "account_keys_update_own"
  on public.account_keys for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.touch_account_keys()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger account_keys_touch
  before update on public.account_keys
  for each row execute function public.touch_account_keys();

-- The one thing about another user's keys that anyone signed in may read: the
-- public key. It is public by construction -- its whole purpose is that others
-- seal things to it -- and the reference design hands it to any signed-in
-- user the same way. Row-level security is per row, not per column, so this is
-- a definer function rather than a policy. Keyed by user id, which is not
-- guessable, and answered only to the signed in; it says nothing about
-- whether an email exists.
create or replace function public.public_keys_of(user_ids uuid[])
returns table (user_id uuid, public_key text)
language sql
security definer
set search_path = public
stable
as $$
  select k.user_id, k.public_key
  from public.account_keys k
  where k.user_id = any (user_ids)
    and auth.uid() is not null;
$$;

-- `anon` by name as well as PUBLIC: the project's default privileges grant
-- execute on every new function to anon and authenticated, and revoking from
-- PUBLIC leaves that explicit grant standing.
revoke all on function public.public_keys_of(uuid[]) from public, anon;
grant execute on function public.public_keys_of(uuid[]) to authenticated;
