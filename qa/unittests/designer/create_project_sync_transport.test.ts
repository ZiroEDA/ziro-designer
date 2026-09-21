// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Which transport a project gets, and — the point of this file — how hard it
 * is to accidentally make the cross-device one mandatory.
 *
 * Requirement 9 in docs/proposals/multiplayer-architecture.md is that the app
 * opens and edits a project just as well with the collaboration layer
 * unavailable. The factory is the only place that can break it, because it is
 * the only place that chooses, so every way of arriving without cloud identity
 * is asserted here rather than left to "it probably falls through".
 *
 * `../auth/supabaseClient.js` is mocked because importing it for real reads
 * `import.meta.env` and constructs a client; the whole question here is what
 * the factory does with that module's two exports, so they are what is faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseRef: { current: unknown } = { current: null };

vi.mock('../../../designer/src/auth/supabaseClient.js', () => ({
  get supabase() {
    return supabaseRef.current;
  },
  get authEnabled() {
    return supabaseRef.current !== null;
  },
}));

const { createProjectSyncTransport } = await import(
  '../../../designer/src/sync/createProjectSyncTransport.js'
);
const { BroadcastChannelTransport } = await import(
  '../../../designer/src/sync/BroadcastChannelTransport.js'
);
const { SupabaseRealtimeTransport } = await import(
  '../../../designer/src/sync/SupabaseRealtimeTransport.js'
);

/** Enough of a client for the factory, which only ever checks it for null. */
const fakeClient = { channel: () => ({}), removeChannel: () => {} };

const UID = '11111111-2222-3333-4444-555555555555';
const USER = '66666666-7777-8888-9999-000000000000';

describe('the same-browser transport is the floor, not the failure case', () => {
  beforeEach(() => {
    supabaseRef.current = null;
  });

  it('uses BroadcastChannel when Supabase is not configured at all', () => {
    // A dev run with no VITE_SUPABASE_* env: the common case, and the one
    // that must never need an account or a network.
    const t = createProjectSyncTransport('proj', { uid: UID, userId: USER });
    expect(t).toBeInstanceOf(BroadcastChannelTransport);
  });

  it('uses BroadcastChannel when configured but signed out', () => {
    // Every policy the channel leans on is written against `auth.uid()`, and
    // `project_roster` refuses an anonymous caller outright.
    supabaseRef.current = fakeClient;
    const t = createProjectSyncTransport('proj', { uid: UID, userId: null });
    expect(t).toBeInstanceOf(BroadcastChannelTransport);
  });

  it('uses BroadcastChannel for a project that has never synced', () => {
    // No `projects.uid` yet, so there is nothing to name a channel after —
    // a local-only project is still fully editable and still syncs cross-tab.
    supabaseRef.current = fakeClient;
    const t = createProjectSyncTransport('proj', { uid: null, userId: USER });
    expect(t).toBeInstanceOf(BroadcastChannelTransport);
  });

  it('uses BroadcastChannel when the caller says nothing about identity', () => {
    // The parameter is optional, so an un-updated call site degrades to
    // today's behaviour rather than losing sync entirely.
    supabaseRef.current = fakeClient;
    expect(createProjectSyncTransport('proj')).toBeInstanceOf(BroadcastChannelTransport);
  });

  it('upgrades to Realtime only when configured, signed in and synced', () => {
    supabaseRef.current = fakeClient;
    const t = createProjectSyncTransport('proj', { uid: UID, userId: USER });
    expect(t).toBeInstanceOf(SupabaseRealtimeTransport);
  });
});
