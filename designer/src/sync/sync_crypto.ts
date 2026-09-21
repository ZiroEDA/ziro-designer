// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * What a live-sync message looks like once it has to cross someone else's
 * server: one opaque string, under the project key.
 *
 * `docs/encryption-plan.md` P5, the item that reads "Nothing to build until
 * live presence exists; when it does, presence messages go under the project
 * key or the server sees names and cursors." Live presence now exists, so this
 * is that.
 *
 * Pure over its inputs, exactly like `cloud/enc_meta.ts` and for the same
 * reason: the whole of it can be exercised without a channel, a client or a
 * database. It talks to no backend and holds no state.
 *
 * The primitive is the one the rest of the scheme already uses — AES-256-GCM
 * with a fresh IV per call, stored `iv ‖ ciphertext` and base64'd because
 * Realtime carries JSON, not bytes. GCM's tag is doing double duty here: it
 * keeps the server from reading a message AND from editing one, which matters
 * more for sync than for a stored row, since a patch that has been altered in
 * flight would be applied to a live board.
 *
 * The sender is sealed in with the message. Realtime routes on a `from` that
 * has to ride in the clear, and a private channel only says who may be in the
 * room, not that a frame was sent by the peer it names: anyone in the room
 * could capture a ciphertext and re-send it as somebody else. So the body
 * carries the sender too, and opening a message checks the two agree; a
 * replay under another name fails to open and is dropped like a wrong key.
 * Presence is bound the same way to the `peerId` it is tracked under.
 */
import { base64ToBytes, bytesToBase64, decryptSecret, encryptSecret } from '../cloud/crypto.js';
import type { EditorKind, ProjectSyncPayload } from './ProjectSyncTransport.js';

/**
 * The half of a peer's presence record that is nobody's business but the
 * project's.
 *
 * `sheetPath` is the reason this type exists at all. It is a path inside the
 * project, and P1 went to the trouble of encrypting every path in
 * `projects.enc_meta` precisely so the server could not read one — announcing
 * the same string in the clear on a presence channel would hand back exactly
 * what that bought. `displayName` is an email, and `view` says which editor
 * somebody is in; neither is catastrophic alone, but both are free to carry
 * here and there is no argument for leaking them.
 */
export interface PresenceSecrets {
  view: EditorKind;
  sheetPath: string | null;
  displayName: string | null;
}

/** Encrypt one payload for the channel, bound to the peer sending it. */
export async function sealPayload(
  projectKey: Uint8Array,
  payload: ProjectSyncPayload,
  from: string,
): Promise<string> {
  return sealJson(projectKey, { from, body: payload });
}

/**
 * Open a payload from the channel.
 *
 * Throws on the wrong key, on a tampered message, on a message sealed by a
 * peer other than the `from` it arrived under, and on anything that decrypts
 * to a shape this does not recognise. Every caller treats a throw as "ignore
 * this message": a peer that cannot be understood is not a reason to take an
 * editor down, and GCM having verified the tag means a garbled body is a
 * version skew rather than an attack.
 */
export async function openPayload(
  projectKey: Uint8Array,
  enc: string,
  from: string,
): Promise<ProjectSyncPayload> {
  const value = await openJson(projectKey, enc);
  if (!isRecord(value) || !isRecord(value.body) || typeof value.body.kind !== 'string') {
    throw new Error('sync: decrypted payload is not a message');
  }
  if (value.from !== from) throw new Error('sync: message was not sealed by the peer it names');
  return value.body as unknown as ProjectSyncPayload;
}

/** Encrypt this peer's presence secrets for `channel.track`, bound to its `peerId`. */
export async function sealPresence(
  projectKey: Uint8Array,
  secrets: PresenceSecrets,
  peerId: string,
): Promise<string> {
  return sealJson(projectKey, { from: peerId, body: secrets });
}

/** Open a peer's presence secrets. Throws on the same terms as `openPayload`. */
export async function openPresence(
  projectKey: Uint8Array,
  enc: string,
  peerId: string,
): Promise<PresenceSecrets> {
  const value = await openJson(projectKey, enc);
  if (!isRecord(value) || !isRecord(value.body) || typeof value.body.view !== 'string') {
    throw new Error('sync: decrypted presence is not a presence record');
  }
  if (value.from !== peerId) throw new Error('sync: presence was not sealed by the peer it names');
  const body = value.body;
  return {
    view: body.view as EditorKind,
    sheetPath: typeof body.sheetPath === 'string' ? body.sheetPath : null,
    displayName: typeof body.displayName === 'string' ? body.displayName : null,
  };
}

async function sealJson(projectKey: Uint8Array, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytesToBase64(await encryptSecret(projectKey, bytes));
}

async function openJson(projectKey: Uint8Array, enc: string): Promise<unknown> {
  const bytes = await decryptSecret(projectKey, base64ToBytes(enc));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
