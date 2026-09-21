// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * What the server is allowed to see of a live session.
 *
 * `docs/encryption-plan.md` P5: "presence messages go under the project key or
 * the server sees names and cursors". Live presence exists now, so this file
 * is the standing proof that it does not regress — every assertion here is
 * about what does NOT appear on the wire, because that is the property that
 * silently stops being true the day somebody adds a field to a payload and
 * sends it beside the sealed one.
 *
 * The crypto is real, not faked. A test that mocked `sync_crypto` could not
 * tell the difference between a sealed message and a stub that returns its
 * input, which is exactly the failure it would be there to catch. The Supabase
 * channel is the only thing stubbed, by a hub small enough to let two
 * transports genuinely talk to each other.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The project key both peers hold, unless a test says otherwise. */
const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(9);

const keyRef: { current: Uint8Array | null | Promise<Uint8Array | null> } = { current: KEY };
const unlockedRef = { current: true };

vi.mock('../../../designer/src/cloud/session_keys.js', () => ({
  projectKeyFor: () => Promise.resolve(keyRef.current),
  sessionUnlocked: () => unlockedRef.current,
}));

// `projectRoster` is deliberately absent: the transport returns early without
// it, which keeps this file about encryption rather than about membership.
vi.mock('../../../designer/src/cloud/cloudStore.js', () => ({
  cloudBackend: () => ({}),
}));

const { SupabaseRealtimeTransport } = await import(
  '../../../designer/src/sync/SupabaseRealtimeTransport.js'
);

type Payload = { from?: string; enc?: string };
type Meta = { peerId: string; userId: string; enc: string };

/**
 * The smallest thing that behaves like a Realtime channel: presence keyed by
 * the connection, and broadcast that reaches everyone but the sender
 * (`broadcast: { self: false }`, which the transport asks for).
 */
class Hub {
  /** Every frame any channel has sent, exactly as it went out. */
  readonly sent: { from: string; payload: Payload }[] = [];
  /** Every presence record tracked, exactly as it went out. */
  readonly tracked: Meta[] = [];

  private readonly channels: FakeChannel[] = [];
  private readonly state: Record<string, unknown[]> = {};

  channel(_name: string, opts: { config: { presence: { key: string } } }): FakeChannel {
    const ch = new FakeChannel(this, opts.config.presence.key);
    this.channels.push(ch);
    return ch;
  }

  remove(ch: FakeChannel): void {
    const i = this.channels.indexOf(ch);
    if (i >= 0) this.channels.splice(i, 1);
  }

  track(key: string, meta: Meta): void {
    this.tracked.push(meta);
    this.state[key] = [meta];
    for (const c of this.channels) c.firePresence();
  }

  send(from: FakeChannel, payload: Payload): void {
    this.sent.push({ from: from.key, payload });
    for (const c of this.channels) if (c !== from) c.fireBroadcast(payload);
  }

  presence(): Record<string, unknown[]> {
    return this.state;
  }

  /** Everything the server would have been able to read, as one string. */
  wire(): string {
    return JSON.stringify({ sent: this.sent, tracked: this.tracked });
  }
}

class FakeChannel {
  private presenceHandlers: (() => void)[] = [];
  private broadcastHandlers: ((arg: { payload: Payload }) => void)[] = [];

  constructor(
    private readonly hub: Hub,
    readonly key: string,
  ) {}

  on(type: string, _filter: unknown, cb: (arg: never) => void): this {
    if (type === 'presence') this.presenceHandlers.push(cb as () => void);
    else this.broadcastHandlers.push(cb as (arg: { payload: Payload }) => void);
    return this;
  }

  subscribe(cb?: (status: string) => void): this {
    cb?.('SUBSCRIBED');
    return this;
  }

  async track(meta: Meta): Promise<void> {
    this.hub.track(this.key, meta);
  }

  async send(frame: { payload: Payload }): Promise<void> {
    this.hub.send(this, frame.payload);
  }

  presenceState<T>(): Record<string, T[]> {
    return this.hub.presence() as Record<string, T[]>;
  }

  firePresence(): void {
    for (const h of this.presenceHandlers) h();
  }

  fireBroadcast(payload: Payload): void {
    for (const h of this.broadcastHandlers) h({ payload });
  }
}

const UID = '11111111-2222-3333-4444-555555555555';
const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002';

/** A string that could only have come from the plaintext. */
const SECRET_SHEET = '/enclosure/preamp-secret-sheet.kicad_sch';
const SECRET_NAME = 'someone@example.com';
const SECRET_REF = 'uuid-marker-9f3c-do-not-leak';

function makeTransport(hub: Hub, userId: string) {
  const supabase = {
    channel: (name: string, opts: { config: { presence: { key: string } } }) =>
      hub.channel(name, opts),
    removeChannel: (ch: unknown) => hub.remove(ch as FakeChannel),
  };
  // The constructor's type is the real SupabaseClient; the hub implements the
  // handful of members the transport actually touches.
  return new SupabaseRealtimeTransport(supabase as never, UID, userId);
}

/**
 * Let the seal/send/open/deliver chain finish.
 *
 * Real `crypto.subtle` resolves off the microtask queue, so draining with
 * `await Promise.resolve()` would return before a single message was encrypted
 * and every assertion below would pass on an empty hub.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('nothing legible reaches the server', () => {
  beforeEach(() => {
    keyRef.current = KEY;
    unlockedRef.current = true;
  });

  it('seals the payload body, so no part of an edit appears on the wire', async () => {
    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    a.connect('schematic', SECRET_SHEET, { displayName: SECRET_NAME });
    await settle();

    a.publish({ kind: 'selection', refs: [SECRET_REF] });
    await settle();

    expect(hub.sent).toHaveLength(1);
    const payload = hub.sent[0].payload;
    expect(typeof payload.enc).toBe('string');
    // The whole point: the body is not beside the ciphertext.
    expect(payload).not.toHaveProperty('body');
    expect(hub.wire()).not.toContain(SECRET_REF);
    expect(hub.wire()).not.toContain('selection');
  });

  it('seals the sheet path and display name out of the presence record', async () => {
    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    a.connect('schematic', SECRET_SHEET, { displayName: SECRET_NAME });
    await settle();

    expect(hub.tracked).toHaveLength(1);
    const meta = hub.tracked[0];
    // `peerId` routes and `userId` joins against the roster; both are facts the
    // server holds anyway. Nothing else may be readable.
    expect(Object.keys(meta).sort()).toEqual(['enc', 'peerId', 'userId']);
    expect(meta.userId).toBe(USER_A);
    expect(hub.wire()).not.toContain(SECRET_SHEET);
    expect(hub.wire()).not.toContain(SECRET_NAME);
    // A path is what P1 encrypts in `enc_meta`; announcing even a fragment of
    // it here would hand that straight back.
    expect(hub.wire()).not.toContain('preamp-secret-sheet');
  });

  it('never announces before the key arrives, even for a moment', async () => {
    // The window between subscribing and holding a key is the one a naive
    // implementation announces in, and a sheet path announced once is leaked
    // for good.
    let release: (k: Uint8Array) => void = () => undefined;
    keyRef.current = new Promise<Uint8Array>((r) => {
      release = r;
    });

    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    a.connect('schematic', SECRET_SHEET, { displayName: SECRET_NAME });
    await settle();

    expect(hub.tracked).toEqual([]);

    release(KEY);
    await settle();
    expect(hub.tracked).toHaveLength(1);
    expect(hub.wire()).not.toContain(SECRET_SHEET);
  });
});

describe('a peer with no key is silent, not cleartext', () => {
  beforeEach(() => {
    keyRef.current = KEY;
    unlockedRef.current = true;
  });

  it('sends and tracks nothing at all when there is no project key', async () => {
    keyRef.current = null;

    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    a.connect('schematic', SECRET_SHEET, { displayName: SECRET_NAME });
    await settle();

    a.publish({ kind: 'selection', refs: [SECRET_REF] });
    a.publish({ kind: 'cursor', x: 1, y: 2 });
    await settle();

    // Falling back to the clear here would be worse than not syncing: it is
    // the exact traffic the encryption work exists to hide.
    expect(hub.sent).toEqual([]);
    expect(hub.tracked).toEqual([]);

    // The control. An empty hub is also what a harness that never ran
    // produces, so the same hub is made to carry traffic from a peer that
    // does hold a key — without this, the two assertions above would pass
    // for the wrong reason and go on passing after the encryption was gone.
    keyRef.current = KEY;
    const withKey = makeTransport(hub, USER_B);
    withKey.connect('schematic', '/b.kicad_sch', { displayName: 'b@example.com' });
    withKey.publish({ kind: 'cursor', x: 5, y: 6 });
    await settle();
    expect(hub.tracked).toHaveLength(1);
    expect(hub.sent).toHaveLength(1);
    expect(hub.sent[0].from).toBe(withKey.peerId);
  });

  it('sends nothing when the account is locked', async () => {
    unlockedRef.current = false;

    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    a.connect('pcb', null, { displayName: SECRET_NAME });
    await settle();
    a.publish({ kind: 'cursor', x: 3, y: 4 });
    await settle();

    expect(hub.sent).toEqual([]);
    expect(hub.tracked).toEqual([]);

    // Same control, for the same reason.
    unlockedRef.current = true;
    const unlocked = makeTransport(hub, USER_B);
    unlocked.connect('pcb', null, { displayName: 'b@example.com' });
    await settle();
    expect(hub.tracked).toHaveLength(1);
  });
});

describe('two peers holding the same key still see each other', () => {
  beforeEach(() => {
    keyRef.current = KEY;
    unlockedRef.current = true;
  });

  it('round-trips a payload through the seal', async () => {
    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    const b = makeTransport(hub, USER_B);
    a.connect('schematic', '/a.kicad_sch', { displayName: 'a@example.com' });
    b.connect('schematic', '/b.kicad_sch', { displayName: 'b@example.com' });
    await settle();

    const got: { payload: unknown; from: string }[] = [];
    b.onMessage((payload, from) => {
      if (payload.kind !== 'presence') got.push({ payload, from });
    });

    const sent = { kind: 'selection', refs: [SECRET_REF] } as const;
    a.publish(sent);
    await settle();

    expect(got).toHaveLength(1);
    expect(got[0].payload).toEqual(sent);
    expect(got[0].from).toBe(a.peerId);
  });

  it('round-trips the presence secrets', async () => {
    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    const b = makeTransport(hub, USER_B);

    const seen: { peerId: string; view: string; sheetPath: string | null }[] = [];
    b.onMessage((payload) => {
      if (payload.kind === 'presence') seen.push(...payload.peers);
    });

    b.connect('pcb', null, { displayName: 'b@example.com' });
    a.connect('schematic', SECRET_SHEET, { displayName: SECRET_NAME });
    await settle();

    const last = seen.filter((p) => p.peerId === a.peerId).pop();
    expect(last).toBeDefined();
    expect(last?.view).toBe('schematic');
    expect(last?.sheetPath).toBe(SECRET_SHEET);
  });

  it('delivers what was published before the key landed, rather than losing it', async () => {
    let release: (k: Uint8Array) => void = () => undefined;
    keyRef.current = new Promise<Uint8Array>((r) => {
      release = r;
    });

    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    const b = makeTransport(hub, USER_B);
    a.connect('schematic', '/a.kicad_sch', { displayName: 'a@example.com' });
    await settle();

    // An edit made in the window costs a peer a patch it will never be sent
    // again, so it has to wait rather than be dropped.
    a.publish({ kind: 'selection', refs: ['first'] });
    a.publish({ kind: 'selection', refs: ['second'] });
    await settle();
    expect(hub.sent).toEqual([]);

    keyRef.current = KEY;
    b.connect('schematic', '/b.kicad_sch', { displayName: 'b@example.com' });
    const got: unknown[] = [];
    b.onMessage((payload) => {
      if (payload.kind === 'selection') got.push(payload.refs);
    });

    release(KEY);
    await settle();

    expect(got).toEqual([['first'], ['second']]);
  });
});

describe('a peer holding a different key is ignored, not trusted', () => {
  beforeEach(() => {
    keyRef.current = KEY;
    unlockedRef.current = true;
  });

  it('drops a message it cannot open, and does not throw', async () => {
    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    a.connect('schematic', '/a.kicad_sch', { displayName: 'a@example.com' });
    await settle();

    keyRef.current = OTHER_KEY;
    const b = makeTransport(hub, USER_B);
    b.connect('schematic', '/b.kicad_sch', { displayName: 'b@example.com' });
    await settle();

    const got: unknown[] = [];
    b.onMessage((payload) => {
      if (payload.kind !== 'presence') got.push(payload);
    });

    a.publish({ kind: 'selection', refs: [SECRET_REF] });
    await settle();

    expect(got).toEqual([]);
    // The control: A really did publish and the frame really did reach B,
    // so the empty list above is B refusing to open it rather than nothing
    // having happened.
    expect(hub.sent).toHaveLength(1);
    expect(hub.sent[0].from).toBe(a.peerId);
  });

  it('leaves a peer whose presence will not open out of the list', async () => {
    const hub = new Hub();
    const a = makeTransport(hub, USER_A);
    a.connect('schematic', SECRET_SHEET, { displayName: SECRET_NAME });
    await settle();

    keyRef.current = OTHER_KEY;
    const b = makeTransport(hub, USER_B);
    const lists: { peerId: string }[][] = [];
    b.onMessage((payload) => {
      if (payload.kind === 'presence') lists.push(payload.peers);
    });
    b.connect('schematic', '/b.kicad_sch', { displayName: 'b@example.com' });
    await settle();

    // A blank row would say "somebody is here" and explain nothing; the honest
    // answer is that this peer is not on the same project.
    expect(lists.at(-1)).toEqual([]);
  });
});
