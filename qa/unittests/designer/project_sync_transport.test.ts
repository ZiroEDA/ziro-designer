// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import { describe, expect, it } from 'vitest';
import { BroadcastChannelTransport } from '../../../designer/src/sync/BroadcastChannelTransport.js';
import type { ProjectSyncPayload } from '../../../designer/src/sync/ProjectSyncTransport.js';

/** Wait for a condition to become true, polling on the microtask/macrotask queue. */
async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('BroadcastChannelTransport', () => {
  it('two peers on the same project discover each other via presence', async () => {
    const a = new BroadcastChannelTransport('proj-1');
    const b = new BroadcastChannelTransport('proj-1');
    const aPeers: string[][] = [];
    const bPeers: string[][] = [];
    a.onMessage((p) => {
      if (p.kind === 'presence') aPeers.push(p.peers.map((x) => x.peerId));
    });
    b.onMessage((p) => {
      if (p.kind === 'presence') bPeers.push(p.peers.map((x) => x.peerId));
    });

    a.connect('schematic', 'root.kicad_sch');
    b.connect('pcb', null);

    await waitFor(
      () => aPeers.some((p) => p.includes(b.peerId)) && bPeers.some((p) => p.includes(a.peerId)),
    );

    expect(aPeers.some((p) => p.includes(b.peerId))).toBe(true);
    expect(bPeers.some((p) => p.includes(a.peerId))).toBe(true);

    a.disconnect();
    b.disconnect();
  });

  it('peers on different projects never see each other', async () => {
    const a = new BroadcastChannelTransport('proj-A');
    const b = new BroadcastChannelTransport('proj-B');
    let sawCross = false;
    a.onMessage((p) => {
      if (p.kind === 'presence' && p.peers.some((x) => x.peerId === b.peerId)) sawCross = true;
    });

    a.connect('schematic', null);
    b.connect('schematic', null);
    await new Promise((r) => setTimeout(r, 100));

    expect(sawCross).toBe(false);
    a.disconnect();
    b.disconnect();
  });

  it('relays a selection payload from one peer to the other, tagged with the sender', async () => {
    const a = new BroadcastChannelTransport('proj-2');
    const b = new BroadcastChannelTransport('proj-2');
    const received: Array<{ payload: ProjectSyncPayload; from: string }> = [];
    b.onMessage((payload, from) => {
      if (payload.kind === 'selection') received.push({ payload, from });
    });

    a.connect('schematic', null);
    b.connect('schematic', null);
    await waitFor(() => received.length === 0 && true, 50).catch(() => {}); // let hello handshake settle
    a.publish({ kind: 'selection', refs: ['R1', 'C4'] });

    await waitFor(() => received.length > 0);
    expect(received[0]!.from).toBe(a.peerId);
    expect(received[0]!.payload).toEqual({ kind: 'selection', refs: ['R1', 'C4'] });

    a.disconnect();
    b.disconnect();
  });

  it('evicts a peer that vanishes without sending bye, once it goes stale', async () => {
    // Fast heartbeat so the sweep fires within the test's timeout instead of
    // waiting on the real 4s/12s production constants.
    const a = new BroadcastChannelTransport('proj-4', 20);
    const b = new BroadcastChannelTransport('proj-4', 20);
    const aPeerLists: string[][] = [];
    a.onMessage((p) => {
      if (p.kind === 'presence') aPeerLists.push(p.peers.map((x) => x.peerId));
    });

    a.connect('schematic', null);
    b.connect('schematic', null);
    await waitFor(() => aPeerLists.some((p) => p.includes(b.peerId)));

    // Simulate a crash: tear down b's channel directly, skipping disconnect()
    // (which would send 'bye') — the exact case the heartbeat sweep exists for.
    (b as unknown as { channel: BroadcastChannel | null }).channel?.close();
    if ((b as unknown as { heartbeat: ReturnType<typeof setInterval> | null }).heartbeat !== null) {
      clearInterval((b as unknown as { heartbeat: ReturnType<typeof setInterval> }).heartbeat);
    }

    await waitFor(
      () => aPeerLists.length > 0 && !aPeerLists[aPeerLists.length - 1]!.includes(b.peerId),
      2000,
    );

    expect(aPeerLists[aPeerLists.length - 1]).not.toContain(b.peerId);
    a.disconnect();
  });

  it('drops a peer from presence after it disconnects', async () => {
    const a = new BroadcastChannelTransport('proj-3');
    const b = new BroadcastChannelTransport('proj-3');
    const aPeerLists: string[][] = [];
    a.onMessage((p) => {
      if (p.kind === 'presence') aPeerLists.push(p.peers.map((x) => x.peerId));
    });

    a.connect('schematic', null);
    b.connect('schematic', null);
    await waitFor(() => aPeerLists.some((p) => p.includes(b.peerId)));

    b.disconnect();
    await waitFor(
      () => aPeerLists.length > 0 && !aPeerLists[aPeerLists.length - 1]!.includes(b.peerId),
    );

    expect(aPeerLists[aPeerLists.length - 1]).not.toContain(b.peerId);
    a.disconnect();
  });

  it('carries the announced display name in presence', async () => {
    const a = new BroadcastChannelTransport('proj-5');
    const b = new BroadcastChannelTransport('proj-5');
    const bPeers: string[] = [];
    b.onMessage((p) => {
      if (p.kind === 'presence') {
        const you = p.peers.find((x) => x.peerId === a.peerId);
        if (you) bPeers.push(you.displayName ?? '');
      }
    });

    a.connect('schematic', null, { displayName: 'alex@example.com' });
    b.connect('schematic', null);

    await waitFor(() => bPeers.includes('alex@example.com'));
    expect(bPeers).toContain('alex@example.com');

    a.disconnect();
    b.disconnect();
  });

  describe('PeerRole: the first one in owns the session', () => {
    it('names itself owner if the election window closes with nobody else around', async () => {
      const a = new BroadcastChannelTransport('proj-owner-1', undefined, 20);
      const selfRoles: string[] = [];
      a.onMessage((p) => {
        if (p.kind === 'self-role') selfRoles.push(p.role);
      });

      a.connect('schematic', null);
      await waitFor(() => selfRoles.includes('owner'));

      expect(selfRoles).toEqual(['owner']);
      a.disconnect();
    });

    it('stays editor when it joins a session someone else is already in', async () => {
      const a = new BroadcastChannelTransport('proj-owner-2', undefined, 20);
      const b = new BroadcastChannelTransport('proj-owner-2', undefined, 20);
      const aSelfRoles: string[] = [];
      const bSelfRoles: string[] = [];
      const bPeerRoles: string[][] = [];
      a.onMessage((p) => {
        if (p.kind === 'self-role') aSelfRoles.push(p.role);
      });
      b.onMessage((p) => {
        if (p.kind === 'self-role') bSelfRoles.push(p.role);
        if (p.kind === 'presence') bPeerRoles.push(p.peers.map((x) => x.role));
      });

      a.connect('schematic', null);
      await waitFor(() => aSelfRoles.includes('owner')); // a is alone first, becomes owner
      b.connect('schematic', null);
      await waitFor(() => bPeerRoles.some((r) => r.includes('owner')));

      // Give b's own election window a chance to fire too, then confirm it
      // never claims ownership for itself — a was already here.
      await new Promise((r) => setTimeout(r, 40));
      expect(aSelfRoles).toEqual(['owner']); // never re-elected once decided
      expect(bSelfRoles).toEqual([]); // b never elects itself, a got there first
      a.disconnect();
      b.disconnect();
    });
  });

  describe('role-assign: the owner moving someone between editor and viewer', () => {
    it('applies only when addressed to this peer, and announces the new role', async () => {
      const a = new BroadcastChannelTransport('proj-role-1');
      const b = new BroadcastChannelTransport('proj-role-1');
      const bSelfRoles: string[] = [];
      const aSeesBRole: string[] = [];
      b.onMessage((p) => {
        if (p.kind === 'role-assign' && p.toPeerId === b.peerId) b.setRole(p.role);
        if (p.kind === 'self-role') bSelfRoles.push(p.role);
      });
      a.onMessage((p) => {
        if (p.kind === 'presence') {
          const bEntry = p.peers.find((x) => x.peerId === b.peerId);
          if (bEntry) aSeesBRole.push(bEntry.role);
        }
      });

      a.connect('schematic', null);
      b.connect('schematic', null);
      await waitFor(() => aSeesBRole.length > 0);

      a.publish({ kind: 'role-assign', toPeerId: b.peerId, role: 'viewer' });
      await waitFor(() => bSelfRoles.includes('viewer'));
      await waitFor(() => aSeesBRole[aSeesBRole.length - 1] === 'viewer');

      expect(bSelfRoles).toContain('viewer');
      expect(aSeesBRole[aSeesBRole.length - 1]).toBe('viewer');

      a.disconnect();
      b.disconnect();
    });

    it('is ignored by a peer it is not addressed to', async () => {
      const a = new BroadcastChannelTransport('proj-role-2');
      const b = new BroadcastChannelTransport('proj-role-2');
      const c = new BroadcastChannelTransport('proj-role-2');
      const cSelfRoles: string[] = [];
      c.onMessage((p) => {
        if (p.kind === 'role-assign' && p.toPeerId === c.peerId) c.setRole(p.role);
        if (p.kind === 'self-role') cSelfRoles.push(p.role);
      });

      a.connect('schematic', null);
      b.connect('schematic', null);
      c.connect('schematic', null);
      await new Promise((r) => setTimeout(r, 60));

      a.publish({ kind: 'role-assign', toPeerId: b.peerId, role: 'viewer' });
      await new Promise((r) => setTimeout(r, 60));

      expect(cSelfRoles).toEqual([]); // never addressed to c, never applied
      a.disconnect();
      b.disconnect();
      c.disconnect();
    });
  });
});
