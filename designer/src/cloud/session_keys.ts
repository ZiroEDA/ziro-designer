// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The unlocked account's keys, where the sync layer can reach them, and the
 * project keys derived from them.
 *
 * `AuthProvider` owns the account keys as React state. Sync, the blob store
 * and the local store are not React, so the provider hands the keys here when
 * the account opens and takes them back when it locks. Everything below is
 * `docs/encryption-plan.md` P0: one random key per project, wrapped under the
 * owner's master key, or sealed to a member's public key by the owner; the
 * server relays the wrapped forms and can open none of them.
 *
 * Nothing here is persisted. A project key lives in this map for as long as
 * the account is open and is derived again from the server's row on the next
 * open, which is one small decrypt.
 */
import type { CloudBackend } from './backend.js';
import {
  type AccountKeys,
  base64ToBytes,
  bytesToBase64,
  createProjectKey as newProjectKey,
  decryptSecret,
  encryptSecret,
  seal,
  sealOpen,
} from './crypto.js';

let account: AccountKeys | null = null;
let userId = '';
const projectKeys = new Map<string, Uint8Array>();

/** The provider's hand-over. Null locks: every project key goes with it. */
export function setSessionKeys(keys: AccountKeys | null, forUser = ''): void {
  account = keys;
  userId = keys ? forUser : '';
  // Every hand-over, not only a lock: a different account must never find
  // the previous one's project keys still in the map.
  projectKeys.clear();
}

/** Whose keys these are: the signed-in user's id, or '' when locked. */
export const sessionUserId = (): string => userId;

/** Whether there is an open account to encrypt for. */
export const sessionUnlocked = (): boolean => account !== null;

function needAccount(): AccountKeys {
  if (!account) throw new Error('the account is locked: no keys in this tab');
  return account;
}

/**
 * The key of a project, for the signed-in user.
 *
 * Their own `project_keys` row, opened with whichever of their keys wrapped it.
 * A row the owner SEALED to this user's public key is opened with the private
 * key and then re-wrapped under the master key in place - the same key, one
 * cheap symmetric decrypt from then on rather than an ECDH each time, and the
 * row's `how` says which it is.
 *
 * Null when the user has no key to this project: a project shared with them
 * before keys existed, or one they were never given a key to.
 */
export async function projectKeyFor(
  backend: CloudBackend,
  userId: string,
  projectUid: string,
): Promise<Uint8Array | null> {
  const cached = projectKeys.get(projectUid);
  if (cached) return cached;
  const keys = needAccount();
  if (!backend.getProjectKey) throw new Error('this backend cannot hold project keys');
  const row = await backend.getProjectKey(projectUid);
  if (!row) return null;
  let key: Uint8Array;
  if (row.how === 'master') {
    key = await decryptSecret(keys.masterKey, base64ToBytes(row.enc_key));
  } else {
    key = await sealOpen(keys.privateKey, base64ToBytes(row.enc_key));
    // Re-wrap for next time; best effort, the sealed row still opens.
    try {
      await backend.putProjectKey?.(
        projectUid,
        userId,
        bytesToBase64(await encryptSecret(keys.masterKey, key)),
        'master',
      );
    } catch (e) {
      console.warn('project key not re-wrapped:', e);
    }
  }
  projectKeys.set(projectUid, key);
  return key;
}

/**
 * A brand-new key for a project this user owns, wrapped under their master
 * key and stored. Idempotent: an existing row wins, so two devices creating
 * keys for the same project at once cannot leave each other unable to read.
 */
export async function createProjectKeyFor(
  backend: CloudBackend,
  userId: string,
  projectUid: string,
): Promise<Uint8Array> {
  const existing = await projectKeyFor(backend, userId, projectUid);
  if (existing) return existing;
  const keys = needAccount();
  if (!backend.putProjectKey) throw new Error('this backend cannot hold project keys');
  const key = newProjectKey();
  await backend.putProjectKey(
    projectUid,
    userId,
    bytesToBase64(await encryptSecret(keys.masterKey, key)),
    'master',
  );
  projectKeys.set(projectUid, key);
  return key;
}

/**
 * Hand a project's key to a member: sealed to their public key, written by
 * the owner (the server refuses anyone else). The member opens it with their
 * private key on their next sync; see {@link projectKeyFor}.
 */
export async function shareProjectKeyWith(
  backend: CloudBackend,
  projectUid: string,
  projectKey: Uint8Array,
  member: { userId: string; publicKey: Uint8Array },
): Promise<void> {
  if (!backend.putProjectKey) throw new Error('this backend cannot hold project keys');
  await backend.putProjectKey(
    projectUid,
    member.userId,
    bytesToBase64(await seal(member.publicKey, projectKey)),
    'sealed',
  );
}

/**
 * A key handed over by link (in the URL fragment): wrap it under this user's
 * own master key and keep it. The owner's device need not be online.
 */
export async function adoptProjectKey(
  backend: CloudBackend,
  userId: string,
  projectUid: string,
  key: Uint8Array,
): Promise<void> {
  const keys = needAccount();
  if (!backend.putProjectKey) throw new Error('this backend cannot hold project keys');
  await backend.putProjectKey(
    projectUid,
    userId,
    bytesToBase64(await encryptSecret(keys.masterKey, key)),
    'master',
  );
  projectKeys.set(projectUid, key);
}

/** A key known only for this session (a viewer following a link, signed out). */
export function holdProjectKey(projectUid: string, key: Uint8Array): void {
  projectKeys.set(projectUid, key);
}

/** After a rotation: the new key replaces the cached one. */
export function replaceCachedProjectKey(projectUid: string, key: Uint8Array): void {
  projectKeys.set(projectUid, key);
}
