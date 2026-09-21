-- Realtime Authorization for live multiplayer.
--
-- A project's live channel is `project:<uid>`, opened by the client with
-- `private: true` (designer/src/sync/SupabaseRealtimeTransport.ts). For a
-- private channel Realtime consults row-level policies on `realtime.messages`
-- before it lets a socket join (select) or send (insert); with no policy at
-- all, every join is refused. This is the policy.
--
-- What it protects. Every message and every presence record on the channel is
-- sealed under the project key, so the server -- and anyone who reaches the
-- channel -- reads ciphertext. What the encryption cannot hide is the roster:
-- presence carries each peer's `userId` in the clear, because that is how the
-- other peers join it against `project_roster()` to show a name and a role. A
-- project uid is in every share URL, so on a public channel anyone holding the
-- anon key who had seen a link could sit in the room and watch who is present.
-- The rule is therefore the same one `projects` itself answers to: you are in
-- the room if `project_role_of()` says you are a member.
--
-- `realtime.topic()` is the channel the socket is asking about. The uid is
-- parsed out of it by a helper that answers null for anything not of the
-- form `project:<uuid>`, rather than raising on a cast -- a policy that errors
-- refuses, but with a server log line per probe, and a malformed topic is a
-- probe.

create or replace function public.project_uid_of_topic(p_topic text)
returns uuid
language sql
immutable
strict
as $$
  select case
    when p_topic ~ '^project:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substr(p_topic, length('project:') + 1)::uuid
    else null
  end;
$$;

revoke all     on function public.project_uid_of_topic(text) from public;
grant  execute on function public.project_uid_of_topic(text) to authenticated;

-- Joining and receiving. Broadcast and presence only; there is no
-- postgres_changes subscription on this channel and none should slip in
-- under it.
drop policy if exists "project members may join their project's channel" on realtime.messages;
create policy "project members may join their project's channel"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.project_role_of(public.project_uid_of_topic(realtime.topic())) is not null
  );

-- Sending and tracking presence. Viewers send too: a viewer's cursor and
-- presence record are how the others see them, and the editor/viewer split
-- is applied by the peers on the sealed body the server cannot read. The
-- server's question is only "is this one of the project's people".
drop policy if exists "project members may send on their project's channel" on realtime.messages;
create policy "project members may send on their project's channel"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.project_role_of(public.project_uid_of_topic(realtime.topic())) is not null
  );
