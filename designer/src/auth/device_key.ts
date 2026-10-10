// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The master key, remembered on this device.
 *
 * Signed in stays signed in: a returning user is let straight back in, with
 * no password (#639 - there was an "unlock" step for exactly this, and it is
 * gone). The Supabase session already survives the browser closing; the key
 * that opens the projects now does too, so the two can no longer disagree.
 *
 * It is kept in IndexedDB, sealed with AES-GCM under a wrapping key the
 * browser generated as NON-EXTRACTABLE: a `CryptoKey` IndexedDB stores as an
 * object, whose bytes no script can read back - only ask it to decrypt, in this
 * origin, in this browser profile. So the record is no use copied off the
 * disk, and nothing a server holds can open it. What it does mean is that
 * whoever can use this browser profile can open the projects, as with any site
 * one is signed in to. Signing out wipes it.
 *
 * One account per browser profile: remembering one replaces whatever was
 * there.
 */

const DB = 'ziro-device-key';
const STORE = 'key';
const ID = 'account';

interface Sealed {
  id: typeof ID;
  userId: string;
  wrapKey: CryptoKey;
  iv: Uint8Array;
  sealed: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Remember `userId`'s master key on this device, replacing any other account's. */
export async function rememberOnDevice(userId: string, masterKey: Uint8Array): Promise<void> {
  const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrapKey,
    masterKey as BufferSource,
  );
  const record: Sealed = { id: ID, userId, wrapKey, iv, sealed };
  await tx('readwrite', (s) => s.put(record));
}

/** `userId`'s master key from this device, or null when it holds none for them. */
export async function recallFromDevice(userId: string): Promise<Uint8Array | null> {
  try {
    const record = (await tx('readonly', (s) => s.get(ID))) as Sealed | undefined;
    if (!record || record.userId !== userId) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as BufferSource },
      record.wrapKey,
      record.sealed,
    );
    return new Uint8Array(plain);
  } catch {
    // No IndexedDB (private window), or a record that will not open: the same
    // as nothing remembered.
    return null;
  }
}

/** Forget whatever this device remembers. Sign-out, and a key that did not fit. */
export async function forgetOnDevice(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(ID));
  } catch {
    // Nothing stored, or no IndexedDB: nothing to forget.
  }
}
