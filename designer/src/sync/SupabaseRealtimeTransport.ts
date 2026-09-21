// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cloudBackend } from '../cloud/cloudStore.js';
import { projectKeyFor, sessionUnlocked } from '../cloud/session_keys.js';
import type {
  EditorKind,
  PeerRole,
  PresenceInfo,
  ProjectSyncPayload,
  ProjectSyncTransport,
} from './ProjectSyncTransport.js';
import {
  openPayload,
  openPresence,
  type PresenceSecrets,
  sealPayload,
  sealPresence,
} from './sync_crypto.js';

/**
 * What each peer publishes about itself on the channel.
 *
 * Two fields in the clear, and both have to be: `peerId` is the presence key
 * Realtime routes on, and `userId` is what turns a peer into a role by joining
 * it against `project_roster()` — a fact the server holds anyway, in
 * `project_members` and in the socket's own authentication. Everything else a
 * peer says about itself is in `enc` (see `sync_crypto.ts`), because the rest
 * of it — which sheet, which name — is project content.
 */
interface WireMeta {
  peerId: string;
  userId: string;
  /** `PresenceSecrets`, sealed under the project key. */
  enc: string;
}

/** The channel name for a project. `uid` and never `(user_id, id)`, for the
 *  reason 20260904120000_project_uid.sql gives: a name containing the owner
 *  cannot survive the project being shared. */
const channelName = (uid: string): string => `project:${uid}`;

/** One broadcast event carries every payload kind; `ProjectSyncPayload.kind`
 *  already discriminates them, and a per-kind event would mean a matching
 *  `.on()` for each and a silent drop the day one is forgotten. */
const EVENT = 'sync';

/**
 * How many messages may wait for the project key before the oldest is dropped.
 *
 * The wait is one database round trip, taken once per connection, so a queue
 * this deep is already far past anything a healthy connection produces. It
 * exists so that the answer to "what happens to an edit made in that window"
 * is "it is sent, a moment later" rather than "it is lost" — a `sheet-patch`
 * nobody resends is a peer permanently behind, unlike a cursor.
 */
const MAX_PENDING = 200;

/** Presence ciphertexts remembered, so a channel full of peers does not
 *  re-decrypt every record on every join and leave. */
const META_CACHE_LIMIT = 256;

/**
 * Cross-device sync over Supabase Realtime.
 *
 * The same `ProjectSyncTransport` the same-browser `BroadcastChannelTransport`
 * implements, so no editor knows which one it is talking to. Three things are
 * genuinely different here, and all three are consequences of there being a
 * server rather than choices:
 *
 * **Roles are read, not elected.** `BroadcastChannelTransport` has to invent an
 * owner (first peer to find nobody else present claims it) because a
 * same-browser channel has no authority to ask. Here `project_roster()` is that
 * authority: ownership is `projects.user_id` and membership is
 * `project_members`, both enforced by RLS. So there is no election, and a
 * `role-assign` is not an honour-system broadcast — it is a `setMemberRole`
 * call the server refuses unless the caller really is the owner.
 *
 * **Presence is per connection, not per account.** The presence key is
 * `peerId`, so somebody with the project open in two tabs is two peers, which
 * is what a cursor list has to show. Their role is the same in both, because
 * role is a fact about the account.
 *
 * **Nothing legible leaves the device.** Every payload body and the readable
 * half of every presence record is sealed under the project key first — see
 * `sync_crypto.ts` for what stays in the clear and why. This is the transport
 * that has a server in the middle, so it is the transport that needs it;
 * `BroadcastChannelTransport` deliberately has none, because a BroadcastChannel
 * never leaves the browser that opened it and encrypting a message to yourself
 * protects nobody.
 *
 * The rule that falls out of that: **without a key, this sends nothing at all.**
 * Not a cleartext fallback — a project whose key this account does not hold is
 * a project whose live traffic would otherwise be readable by the server, which
 * is the exact thing the encryption work was for. A keyless connection reports
 * an empty peer list and stays quiet, which the editor already copes with.
 *
 * Failure is not fatal, ever: multiplayer is additive (requirement 9 in
 * docs/proposals/multiplayer-architecture.md). If the channel never subscribes,
 * the roster cannot be read, or no key can be had, this reports an empty peer
 * list and the editor carries on exactly as it does with nobody else around. It
 * never blocks, refuses or delays an edit.
 */
export class SupabaseRealtimeTransport implements ProjectSyncTransport {
  readonly peerId = crypto.randomUUID();

  private channel: ReturnType<SupabaseClient['channel']> | null = null;
  private readonly handlers = new Set<(payload: ProjectSyncPayload, fromPeerId: string) => void>();

  /** Role per `user_id`, from `project_roster()`. Empty until it answers, and
   *  empty for good on a deployment without the membership migration — which
   *  is why every read of it falls back rather than waiting. */
  private roster = new Map<string, { role: PeerRole; email: string | null }>();

  private selfView: EditorKind = 'schematic';
  private selfSheetPath: string | null = null;
  private selfDisplayName: string | null = null;
  private selfRole: PeerRole = 'editor';
  /** Last role announced to the UI, so a roster refresh only emits `self-role`
   *  when the answer actually changed. */
  private announcedRole: PeerRole | null = null;

  /** The project key, once it has been fetched. Null means nothing may be
   *  sent; see the class comment. */
  private key: Uint8Array | null = null;
  /** The in-flight fetch, so an inbound message that beats it can wait for it
   *  instead of being dropped. */
  private keyPromise: Promise<Uint8Array | null> | null = null;
  /** Set once the fetch has come back empty: publishes stop queueing and start
   *  being dropped, because no later event will produce a key. */
  private keyless = false;

  /** Published before the key arrived, in order. */
  private pending: ProjectSyncPayload[] = [];

  /**
   * Inbound and outbound are each a promise chain rather than a set of loose
   * `void`ed promises.
   *
   * Sealing and opening are both async, and a patch applied in the wrong order
   * is a corrupted board — `a then b` and `b then a` do not agree for a diff.
   * Chaining costs one microtask per message and makes the delivered order the
   * order they were published and received in.
   */
  private inbound: Promise<void> = Promise.resolve();
  private outbound: Promise<void> = Promise.resolve();

  /** Opened presence records, keyed by their ciphertext. */
  private metaCache = new Map<string, PresenceSecrets | null>();
  /** Guards against an older presence resolve emitting after a newer one. */
  private presenceToken = 0;

  private warned = false;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly projectUid: string,
    private readonly userId: string,
  ) {}

  connect(
    view: EditorKind,
    sheetPath: string | null,
    identity: { displayName: string | null } = { displayName: null },
  ): void {
    if (this.channel) return;
    this.selfView = view;
    this.selfSheetPath = sheetPath;
    this.selfDisplayName = identity.displayName;

    const channel = this.supabase.channel(channelName(this.projectUid), {
      config: {
        // Realtime Authorization: the server checks a policy on
        // `realtime.messages` before it lets this socket join or send.
        //
        // Not optional, and not belt-and-braces over the encryption. A public
        // channel is named `project:<uid>`, and a uid is in every share URL,
        // so anyone holding the anon key who has seen one could subscribe.
        // The project key still stops them reading a message or forging one,
        // but the `userId` of everyone present would leak: presence carries
        // it in the clear so the roster can name them.
        //
        // The policy is `supabase/migrations/20260921120000_realtime_authz.sql`:
        // a project's members, and nobody else, may join and send on
        // `project:<uid>`. This flag is the client half; without the policy
        // the server refuses every join, which is the right way round.
        // Replay -- a captured frame re-sent under another `from` -- is
        // closed separately, by sealing the sender into the body
        // (`sync_crypto.ts`).
        private: true,
        // Keyed by connection, not by account: two tabs are two cursors.
        presence: { key: this.peerId },
        // We already know what we sent; echoing it back would make every
        // publish a message this tab has to recognise and discard.
        broadcast: { self: false },
      },
    });
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => this.emitPresence());
    channel.on('broadcast', { event: EVENT }, ({ payload }) => {
      const wire = payload as { from?: string; enc?: string } | undefined;
      if (!wire?.from || typeof wire.enc !== 'string') return;
      if (wire.from === this.peerId) return; // belt and braces; `self: false` already did this
      const { from, enc } = wire;
      this.inbound = this.inbound.then(() => this.deliver(from, enc));
    });

    // Nothing is tracked here. Presence carries the sheet path, so announcing
    // before the key exists would publish in the clear the one field P1 went
    // out of its way to encrypt; `adoptKey` tracks the moment there is a key.
    channel.subscribe(() => undefined);

    this.keyPromise = this.loadKey();
    void this.keyPromise.then((key) => this.adoptKey(channel, key));

    // Not awaited: presence must not wait on the roster, and the roster is
    // only ever an enrichment of a peer list that is already correct.
    void this.refreshRoster();
  }

  updatePresence(view: EditorKind, sheetPath: string | null): void {
    this.selfView = view;
    this.selfSheetPath = sheetPath;
    void this.trackSelf();
  }

  /**
   * Adopt a role locally.
   *
   * Kept for interface parity with the broadcast transport, but it is not how
   * a role changes here: the roster is the authority, so anything this sets is
   * corrected by the next refresh. The real path is an owner publishing
   * `role-assign`, which `publish` turns into a `setMemberRole` write.
   */
  setRole(role: PeerRole): void {
    this.selfRole = role;
    void this.trackSelf();
  }

  disconnect(): void {
    const channel = this.channel;
    this.channel = null;
    this.roster.clear();
    this.announcedRole = null;
    this.key = null;
    this.keyPromise = null;
    this.keyless = false;
    this.pending = [];
    this.metaCache.clear();
    this.presenceToken++;
    if (channel) void this.supabase.removeChannel(channel);
  }

  publish(payload: ProjectSyncPayload): void {
    // A role change is a database write, not a message. Sending it as one
    // would be the honour system the broadcast transport is stuck with, and
    // across devices that means anybody could demote anybody.
    if (payload.kind === 'role-assign') {
      void this.assignRole(payload.toPeerId, payload.role);
      return;
    }
    if (this.key) {
      this.queueSend(this.key, payload);
      return;
    }
    // No key yet. Either it is still being fetched, in which case this waits
    // for it, or there will never be one, in which case it is dropped — never
    // sent in the clear.
    if (this.keyless) return;
    this.pending.push(payload);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  onMessage(handler: (payload: ProjectSyncPayload, fromPeerId: string) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** The project key for this account, or null if there is none to be had. */
  private async loadKey(): Promise<Uint8Array | null> {
    const be = cloudBackend();
    if (!be || !sessionUnlocked()) return null;
    try {
      return await projectKeyFor(be, this.userId, this.projectUid);
    } catch {
      return null; // locked, no row, or a backend that does not hold keys
    }
  }

  /** Take delivery of the key: announce, and release whatever was waiting. */
  private adoptKey(channel: unknown, key: Uint8Array | null): void {
    if (this.channel !== channel) return; // disconnected while we were asking
    if (!key) {
      this.keyless = true;
      this.pending = [];
      this.warnOnce(
        'sync: no key for this project, so nothing will be sent — live collaboration is off',
      );
      return;
    }
    this.key = key;
    void this.trackSelf();
    const queued = this.pending;
    this.pending = [];
    for (const payload of queued) this.queueSend(key, payload);
    this.emitPresence();
  }

  /** Announce this peer, with everything but the routing fields sealed. */
  private async trackSelf(): Promise<void> {
    const key = this.key;
    const channel = this.channel;
    if (!key || !channel) return;
    const enc = await sealPresence(
      key,
      {
        view: this.selfView,
        sheetPath: this.selfSheetPath,
        displayName: this.selfDisplayName,
      },
      this.peerId,
    );
    if (this.channel !== channel) return; // disconnected while we were sealing
    const meta: WireMeta = { peerId: this.peerId, userId: this.userId, enc };
    await channel.track(meta);
  }

  private queueSend(key: Uint8Array, payload: ProjectSyncPayload): void {
    this.outbound = this.outbound.then(async () => {
      const channel = this.channel;
      if (!channel) return;
      const enc = await sealPayload(key, payload, this.peerId);
      if (this.channel !== channel) return;
      await channel.send({
        type: 'broadcast',
        event: EVENT,
        payload: { from: this.peerId, enc },
      });
    });
  }

  /** Open one inbound message and hand it on. */
  private async deliver(from: string, enc: string): Promise<void> {
    const key = this.key ?? (await (this.keyPromise ?? Promise.resolve(null)));
    if (!key || !this.channel) return;
    let body: ProjectSyncPayload;
    try {
      body = await openPayload(key, enc, from);
    } catch {
      // A peer holding a different key, a message altered in flight, or one
      // captured and re-sent under another peer's name. Either way there is
      // nothing to apply and nothing worth taking an editor down for.
      this.warnOnce('sync: a message on this project could not be opened and was ignored');
      return;
    }
    for (const h of this.handlers) h(body, from);
  }

  /**
   * `role-assign` addressed to a peer, applied where it is actually enforced.
   *
   * The payload names a *peer*, because that is what a cursor list shows;
   * membership names an *account*. Presence is what maps one to the other, so
   * an assignment to a peer that has since gone simply finds nothing and does
   * nothing, rather than guessing. It reads `userId` straight off the wire
   * record, which is in the clear precisely so this join needs no key.
   */
  private async assignRole(toPeerId: string, role: 'editor' | 'viewer'): Promise<void> {
    const target = this.peers().find((p) => p.peerId === toPeerId);
    const be = cloudBackend();
    if (!target?.userId || !be?.setMemberRole) return;
    try {
      await be.setMemberRole(this.projectUid, target.userId, role);
    } catch {
      return; // the server refused: not the owner, or the row is gone
    }
    await this.refreshRoster();
  }

  /** Ask the database who is on this project and what they may do. */
  private async refreshRoster(): Promise<void> {
    const be = cloudBackend();
    if (!be?.projectRoster) return;
    let rows: { user_id: string; email: string; role: string; joined_at: string }[];
    try {
      rows = await be.projectRoster(this.projectUid);
    } catch {
      return; // no membership migration, or offline: presence still works
    }
    if (!this.channel) return; // disconnected while we were asking
    this.roster = new Map(
      rows.map((r) => [r.user_id, { role: asRole(r.role) ?? 'viewer', email: r.email || null }]),
    );
    const mine = this.roster.get(this.userId)?.role ?? 'editor';
    this.selfRole = mine;
    if (this.announcedRole !== mine) {
      this.announcedRole = mine;
      // Locally synthesised, never peer-authored — the same contract
      // `BroadcastChannelTransport` documents on its own `self-role`.
      for (const h of this.handlers) h({ kind: 'self-role', role: mine }, this.peerId);
    }
    this.emitPresence();
  }

  /** Every peer currently tracked on the channel, this tab included, still
   *  sealed. */
  private peers(): WireMeta[] {
    const state = this.channel?.presenceState<WireMeta>() ?? {};
    return Object.values(state)
      .flat()
      .filter((m): m is WireMeta & { presence_ref: string } => !!m && !!m.peerId);
  }

  /**
   * Publish the peer list, minus this tab.
   *
   * Opening each record is async, so this starts the work and lets the newest
   * start win: presence syncs arrive in bursts as people join, and an older
   * resolve landing after a newer one would show a list that has already been
   * superseded.
   */
  private emitPresence(): void {
    const token = ++this.presenceToken;
    void this.resolvePresence(token);
  }

  /**
   * Role and display name are taken from the roster and not from what the peer
   * said about itself: one is a database fact and the other is a claim. A peer
   * the roster has not answered for yet falls back to its own announcement,
   * which is what makes the list correct immediately and merely better later.
   *
   * A peer whose record will not open is left out entirely rather than shown
   * with blanks — it holds a different key, so it is not really on this
   * project, and a nameless row in the panel explains nothing to anybody.
   */
  private async resolvePresence(token: number): Promise<void> {
    const key = this.key;
    if (!key) return;
    const peers: PresenceInfo[] = [];
    for (const m of this.peers()) {
      if (m.peerId === this.peerId) continue;
      const secrets = await this.openMeta(key, m.enc, m.peerId);
      if (!secrets) continue;
      const known = this.roster.get(m.userId);
      peers.push({
        peerId: m.peerId,
        view: secrets.view,
        sheetPath: secrets.sheetPath,
        role: known?.role ?? 'editor',
        displayName: known?.email ?? secrets.displayName,
      });
    }
    if (token !== this.presenceToken || !this.channel) return;
    for (const h of this.handlers) h({ kind: 'presence', peers }, this.peerId);
  }

  private async openMeta(
    key: Uint8Array,
    enc: string,
    peerId: string,
  ): Promise<PresenceSecrets | null> {
    // Keyed by the pair: the same ciphertext tracked under another peerId is
    // a different question, and must not get the answer this one earned.
    const cacheKey = `${peerId}\n${enc}`;
    const hit = this.metaCache.get(cacheKey);
    if (hit !== undefined) return hit;
    let secrets: PresenceSecrets | null;
    try {
      secrets = await openPresence(key, enc, peerId);
    } catch {
      secrets = null;
    }
    // A peer republishes on every sheet change, so this is bounded by how much
    // people move around, not by how many of them there are. Dropping the
    // whole map is fine: the cost of a miss is one decrypt.
    if (this.metaCache.size >= META_CACHE_LIMIT) this.metaCache.clear();
    this.metaCache.set(cacheKey, secrets);
    return secrets;
  }

  /** One line per connection, not one per message: a key that is missing is
   *  missing for every message, and a console full of it helps nobody. */
  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(message);
  }
}

/** `project_role` comes back as a bare string; anything unrecognised is not
 *  quietly treated as an editor. */
function asRole(value: string): PeerRole | null {
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : null;
}
