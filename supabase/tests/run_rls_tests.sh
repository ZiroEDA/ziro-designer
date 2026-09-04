#!/usr/bin/env bash
# Run the row-level-security tests against a throwaway Supabase Postgres.
#
# These policies decide who can read another account's board. Nothing else in
# the repo exercises them: they are SQL, they run inside the database, and a
# migration that applies cleanly can still be wrong in every way that matters.
# So this stands up the real image, applies the real migration chain in order,
# and asks the questions a second user would ask.
#
#   supabase/tests/run_rls_tests.sh
#
# Expectations are written next to each check as `-- expect ...`. Read them.
set -uo pipefail
cd "$(dirname "$0")/../.."

IMAGE=public.ecr.aws/supabase/postgres:17.6.1.141
NAME=${ZIRO_RLS_CONTAINER:-ziro-rls-test}

docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=postgres "$IMAGE" >/dev/null

# The image restarts Postgres partway through its own init, so a single
# pg_isready is not readiness: connections opened before the restart are killed
# mid-migration and the failure looks like a broken migration. Wait for the
# server to answer consistently instead.
stable=0
for _ in $(seq 1 90); do
  if docker exec "$NAME" psql -U postgres -d postgres -tAc "select 1" >/dev/null 2>&1
    then stable=$((stable+1)); else stable=0; fi
  [ "$stable" -ge 8 ] && break
  sleep 1
done
[ "$stable" -ge 8 ] || { echo "postgres never became stable"; exit 1; }

# `storage.objects` and `storage.foldername` are created by the storage service,
# not by the database image, so the policies that reference them have nothing to
# attach to here. This is upstream's own definition of foldername.
docker exec -i "$NAME" psql -U supabase_admin -d postgres -q >/dev/null <<'SQL'
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
 language plpgsql immutable as $$
 declare _parts text[];
 begin select string_to_array(name,'/') into _parts;
   return _parts[1:array_length(_parts,1)-1];
 end $$;
grant all on schema storage to postgres;
grant all on all tables in schema storage to postgres;
grant select on storage.objects to authenticated;
SQL

fail=0
for f in supabase/migrations/*.sql; do
  if err=$(docker exec -i "$NAME" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < "$f" 2>&1); then
    echo "ok   $(basename "$f")"
  else
    echo "FAIL $(basename "$f")"; echo "$err" | head -5; fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1

docker cp supabase/tests/rls_membership.sql "$NAME":/tmp/t.sql >/dev/null
docker exec "$NAME" psql -U postgres -d postgres -f /tmp/t.sql 2>&1 \
  | grep -v '^SET$\|^BEGIN$\|^COMMIT$\|^ROLLBACK$\|^ *$\|^-\{3,\}$\|^(1 row)$\|Pager'

echo
echo "container '$NAME' left running for poking; docker rm -f $NAME when done"
