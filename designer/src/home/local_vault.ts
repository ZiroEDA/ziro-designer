// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The local store at rest: every record sealed under a key that exists only
 * while the account is open.
 *
 * docs/encryption-plan.md P2. The wall decides what is on the page; it does
 * not decide what is in IndexedDB, and until this, everything was - every
 * project, every file, every name, readable by anyone with the browser
 * profile or devtools, wall or no wall. Now a record on disk is `{ id,
 * updatedAt, userDir, sealed }`: the id (a random uuid) and the timestamp
 * stay in the clear because the store indexes on them and they say nothing,
 * and everything else - name, files, hashes, cloud identity - is one AES-GCM
 * ciphertext under the vault key. The vault key is HKDF of the master key
 * with its own label, so it is as strong as the master key and shares no
 * bytes with it, and it goes when the master key goes: lock the account and
 * the browser holds only ciphertext.
 *
 * The envelope is binary-safe on purpose. A record carries every file's
 * gzipped bytes; JSON would base64 them at a third more space and a copy per
 * read. Instead the record's Uint8Arrays are lifted out and appended raw
 * behind a small JSON header that names them by index.
 *
 * A build without an account (no auth configured) has no vault key and reads
 * and writes plaintext records as it always did. A record sealed by another
 * account opens to nothing here and is skipped by a listing, because it is
 * not this account's to read.
 */
import { ab, decryptSecret, encryptSecret } from '../cloud/crypto.js';

let vaultKey: Uint8Array | null = null;

const LABEL = new TextEncoder().encode('ziro-local-vault-v1');

/** Derive the vault key from the master key and install it; null locks. */
export async function setLocalVaultFromMasterKey(masterKey: Uint8Array | null): Promise<void> {
  if (!masterKey) {
    vaultKey = null;
    return;
  }
  const hk = await crypto.subtle.importKey('raw', ab(masterKey), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: ab(LABEL) },
    hk,
    256,
  );
  vaultKey = new Uint8Array(bits);
}

/** For tests: a key straight in. */
export function setLocalVaultKey(key: Uint8Array | null): void {
  vaultKey = key;
}

export const localVaultOpen = (): boolean => vaultKey !== null;

/**
 * What a sealed record looks like on disk: the fields a store keys or indexes
 * on, in the clear, and everything else as one ciphertext.
 */
export interface SealedRecord {
  sealed: Uint8Array;
  v: 1;
  [clear: string]: unknown;
}

export const isSealed = (r: unknown): r is SealedRecord =>
  !!r && typeof r === 'object' && (r as SealedRecord).sealed instanceof Uint8Array;

// --- the envelope ----------------------------------------------------------

const BIN = '$bin';
const KIND = '$kind';

/** Every typed array a record may carry, by the name it is rebuilt with. */
const VIEWS = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
} as const;
type ViewKind = keyof typeof VIEWS;

function lift(value: unknown, bins: Uint8Array[]): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const kind = value.constructor.name as ViewKind;
    if (!(kind in VIEWS)) throw new Error(`cannot seal a ${kind}`);
    bins.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return kind === 'Uint8Array' ? { [BIN]: bins.length - 1 } : { [BIN]: bins.length - 1, [KIND]: kind };
  }
  if (Array.isArray(value)) return value.map((v) => lift(v, bins));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = lift(v, bins);
    }
    return out;
  }
  return value;
}

function lower(value: unknown, bins: Uint8Array[]): unknown {
  if (Array.isArray(value)) return value.map((v) => lower(v, bins));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o[BIN] === 'number' && (Object.keys(o).length === 1 || (Object.keys(o).length === 2 && KIND in o))) {
      const bytes = bins[o[BIN] as number]!;
      const kind = (o[KIND] as ViewKind | undefined) ?? 'Uint8Array';
      // Each bin was sliced into its own buffer, offset 0, so every element
      // width is aligned.
      const View = VIEWS[kind];
      return new View(bytes.buffer as ArrayBuffer, 0, bytes.byteLength / View.BYTES_PER_ELEMENT);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = lower(v, bins);
    return out;
  }
  return value;
}

/** `u32 jsonLen ‖ json ‖ (u32 len ‖ bytes)*` */
export function encodeEnvelope(record: object): Uint8Array {
  const bins: Uint8Array[] = [];
  const json = new TextEncoder().encode(JSON.stringify(lift(record, bins)));
  let total = 4 + json.length;
  for (const b of bins) total += 4 + b.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  view.setUint32(at, json.length);
  at += 4;
  out.set(json, at);
  at += json.length;
  for (const b of bins) {
    view.setUint32(at, b.length);
    at += 4;
    out.set(b, at);
    at += b.length;
  }
  return out;
}

export function decodeEnvelope<T>(bytes: Uint8Array): T {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const jsonLen = view.getUint32(at);
  at += 4;
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(at, at + jsonLen))) as unknown;
  at += jsonLen;
  const bins: Uint8Array[] = [];
  while (at < bytes.length) {
    const len = view.getUint32(at);
    at += 4;
    // A copy, so the record does not keep the whole envelope alive by reference.
    bins.push(bytes.slice(at, at + len));
    at += len;
  }
  return lower(json, bins) as T;
}

// --- sealing ----------------------------------------------------------------

/**
 * Seal a record for a store, keeping the named fields in the clear - the ones
 * the store keys or indexes on: an id, a timestamp, a hash used as a key.
 * With no vault, the record is returned as it is.
 */
export async function sealRecord<T extends object>(
  record: T,
  keep: readonly (keyof T & string)[],
): Promise<T | SealedRecord> {
  if (!vaultKey) return record;
  const clear: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if ((keep as readonly string[]).includes(k)) clear[k] = v;
    else rest[k] = v;
  }
  return { ...clear, sealed: await encryptSecret(vaultKey, encodeEnvelope(rest)), v: 1 };
}

/**
 * Open a record from a store. A plaintext record (from before the vault, or
 * a build with none) comes back as it is. A sealed one needs the vault key;
 * with the wrong key - another account's record - or none, it is `null`.
 */
export async function openRecord<T>(stored: T | SealedRecord | undefined): Promise<T | null> {
  if (stored === undefined) return null;
  if (!isSealed(stored)) return stored as T;
  if (!vaultKey) return null;
  try {
    const { sealed, v: _v, ...clear } = stored;
    const rest = decodeEnvelope<Record<string, unknown>>(await decryptSecret(vaultKey, sealed));
    return { ...clear, ...rest } as T;
  } catch {
    return null;
  }
}
