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
  const { key, unsaved } = await ensureProjectKeyFor(backend, userId, projectUid);
  if (unsaved) await saveProjectKeyFor(backend, userId, projectUid);
  return key;
}

/**
 * The same key, minted but deliberately NOT written yet.
 *
 * `project_keys.project_uid` is a foreign key onto `projects.uid`, so the row
 * cannot be written until the project row it points at exists. A first push
 * mints the uid itself, which means there is no such row yet -- and the key is
 * needed *as a value* long before the commit, to wrap each file key and to seal
 * the metadata that goes into the very row being committed. Those two facts
 * pull in opposite directions, and doing the write eagerly is what made every
 * first push of a new project fail on a database where that project had never
 * landed. See `commitEncrypted`, which persists it straight after the commit.
 *
 * `unsaved` says whether the caller now owes a {@link saveProjectKeyFor}. The
 * key is cached either way, so anything else asking for it this session gets
 * the same bytes, and a retry after a failed write reuses the key rather than
 * minting a second one that would leave the first commit's metadata unopenable.
 */
export async function ensureProjectKeyFor(
  backend: CloudBackend,
  userId: string,
  projectUid: string,
): Promise<{ key: Uint8Array; unsaved: boolean }> {
  const existing = await projectKeyFor(backend, userId, projectUid);
  if (existing) return { key: existing, unsaved: false };
  // Both checks stay here rather than moving to the save: a locked account or
  // a backend that cannot hold keys must fail before anything is encrypted
  // under a key that could never be stored.
  needAccount();
  if (!backend.putProjectKey) throw new Error('this backend cannot hold project keys');
  const key = newProjectKey();
  projectKeys.set(projectUid, key);
  return { key, unsaved: true };
}

/** Write the row for a key {@link ensureProjectKeyFor} has already minted. */
export async function saveProjectKeyFor(
  backend: CloudBackend,
  userId: string,
  projectUid: string,
): Promise<void> {
  const key = projectKeys.get(projectUid);
  if (!key) throw new Error('no key is held for this project to save');
  const keys = needAccount();
  if (!backend.putProjectKey) throw new Error('this backend cannot hold project keys');
  await backend.putProjectKey(
    projectUid,
    userId,
    bytesToBase64(await encryptSecret(keys.masterKey, key)),
    'master',
  );
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

/** A cached key that no longer opens the row: the next lookup asks the server. */
export function forgetCachedProjectKey(projectUid: string): void {
  projectKeys.delete(projectUid);
}

/** The open account's keys, for the one caller that must wrap under the master key itself. */
export function sessionAccount(): AccountKeys {
  return needAccount();
}
