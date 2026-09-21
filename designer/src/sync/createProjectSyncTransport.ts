// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import { supabase } from '../auth/supabaseClient.js';
import type { ProjectSyncTransport } from './ProjectSyncTransport.js';
import { BroadcastChannelTransport } from './BroadcastChannelTransport.js';
import { SupabaseRealtimeTransport } from './SupabaseRealtimeTransport.js';

/**
 * What the caller knows about the project it is opening.
 *
 * Both are optional and both are routinely absent, which is the point: a
 * project that has never met the cloud has no `uid`, and a signed-out session
 * has no `userId`. Neither is an error and neither may cost the editor
 * anything.
 */
export interface SyncIdentity {
  /** `projects.uid` — the project's global identity. Null until it has synced
   *  at least once, which is every local-only project and every project in a
   *  deployment with no Supabase configured at all. */
  uid?: string | null;
  /** The signed-in account, `auth.uid()`. Null when signed out. */
  userId?: string | null;
}

/**
 * The live connection for a project, or the closest thing available.
 *
 * Three conditions have to hold before this can be the cross-device transport,
 * and every one of them is false in an ordinary offline or development run:
 *
 *   1. Supabase is configured at all (`VITE_SUPABASE_URL` / `_ANON_KEY`);
 *   2. somebody is signed in, because every policy the channel relies on is
 *      written against `auth.uid()` and the roster refuses an anonymous
 *      caller outright;
 *   3. the project has a `uid`, because that — never `(user_id, id)` — is what
 *      a shared project is named by.
 *
 * When any of them is missing this falls back to the same-browser transport,
 * which is not a degraded mode so much as the mode this feature was built and
 * tested in: cross-tab sync keeps working with no network, no account and no
 * configuration. That is requirement 9 in
 * docs/proposals/multiplayer-architecture.md — the app has to open and edit a
 * project just as well with the collaboration layer unavailable — and it is
 * why the decision lives here rather than inside either transport.
 *
 * Note what is deliberately NOT a condition: whether the network is actually
 * up. A configured, signed-in client whose channel never reaches the server
 * reports an empty peer list and keeps going, so a dropped connection and an
 * empty project look the same to the editor, which is the only way "additive"
 * can survive a flaky link.
 */
export function createProjectSyncTransport(
  projectId: string,
  identity: SyncIdentity = {},
): ProjectSyncTransport {
  const { uid, userId } = identity;
  if (supabase && uid && userId) {
    return new SupabaseRealtimeTransport(supabase, uid, userId);
  }
  return new BroadcastChannelTransport(projectId);
}
