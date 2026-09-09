// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * End-to-end encryption: the crypto core.
 *
 * This module holds the primitives and the key hierarchy, and nothing else. It
 * talks to no backend, reads no storage, and knows nothing about projects,
 * rows, or sync — every function is pure over its byte inputs. That is what
 * lets it be exercised in full without a browser or a database (see
 * `qa/unittests/designer/crypto.test.ts`), and it is why landing it changes no
 * existing behaviour: nothing calls it yet.
 *
 * The design and the reasoning behind every choice live in
 * `docs/encryption-design.md`. The short version:
 *
 *  - A project is encrypted with a random per-project key. That project key is
 *    the only thing ever wrapped for another person, so sharing costs one small
 *    asymmetric operation, never a re-encryption of the boards.
 *  - The project key is wrapped under the account's `masterKey` for its owner,
 *    and sealed to a member's public key for each collaborator.
 *  - The `masterKey` is wrapped TWICE, by two independent secrets: a key derived
 *    from the account password (the everyday way in) and a `recoveryKey` shown
 *    once at sign-up (the only way in when the password is gone). Neither can
 *    produce the other, and the server holds only the two ciphertexts — which
 *    is why a password reset by email cannot exist here: it would restore the
 *    account and leave every project unreadable.
 *
 * Primitives are Web Crypto only — the same `crypto.subtle` already used in
 * `blobStore.ts` — so there is no new dependency and nothing to initialise:
 *
 *  - symmetric AEAD:  AES-256-GCM, a fresh 96-bit IV per message, stored `iv‖ct`
 *  - asymmetric seal: ephemeral ECDH P-256 → HKDF-SHA256 → AES-256-GCM,
 *                     stored `ephPub‖iv‖ct`
 *
 * A "key" here is raw bytes (a 32-byte symmetric key; a P-256 public key as its
 * 65-byte uncompressed encoding; a private key as PKCS#8), so keys are values
 * that can be wrapped, stored, and passed around — never opaque CryptoKey
 * handles that would have to be threaded through the whole app.
 */

import { sha256Hex } from './blobStore.js';

const KEY_BYTES = 32; // 256-bit symmetric keys
const IV_BYTES = 12; // 96-bit GCM nonce
const P256_RAW_PUBLIC_BYTES = 65; // uncompressed P-256 point: 0x04 ‖ X ‖ Y
const HKDF_INFO = new TextEncoder().encode('ziro-seal-v1');

/** Fresh cryptographically random bytes. */
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** A fresh random 256-bit symmetric key. */
export function randomKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

/** A fresh random per-project key. Named for what it is at the call site. */
export const createProjectKey = randomKey;

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Web Crypto wants a `BufferSource`, and under the current TS lib a
// `Uint8Array` is generic over `ArrayBufferLike` (it might be backed by a
// `SharedArrayBuffer`), which does not satisfy that parameter. Copying into a
// fresh plain `ArrayBuffer` fixes the type and also strips any `.subarray`
// byteOffset, so a view never leaks into a call that expects a whole buffer.
function ab(b: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  if (keyBytes.length !== KEY_BYTES) {
    throw new Error(`symmetric key must be ${KEY_BYTES} bytes, got ${keyBytes.length}`);
  }
  return crypto.subtle.importKey('raw', ab(keyBytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Symmetric AEAD — the "wrap" of the whole scheme.
 *
 * Encrypts `plaintext` under a 32-byte `key`, returning `iv ‖ ciphertext`. The
 * ciphertext carries GCM's authentication tag, so any tampering is caught on
 * decrypt. A fresh random IV per call: 96-bit random nonces are safe far beyond
 * the message count any single project key will ever encrypt.
 */
export async function encryptSecret(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const aes = await importAesKey(key);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv) }, aes, ab(plaintext)),
  );
  return concat(iv, ct);
}

/** Inverse of {@link encryptSecret}. Rejects if the tag does not verify. */
export async function decryptSecret(key: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < IV_BYTES) throw new Error('ciphertext too short to contain an IV');
  const aes = await importAesKey(key);
  const iv = blob.subarray(0, IV_BYTES);
  const ct = blob.subarray(IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(iv) }, aes, ab(ct)));
}

// ---------------------------------------------------------------------------
// Deriving a key from a password
// ---------------------------------------------------------------------------

/**
 * How an account's key-encryption-key was derived from its password.
 *
 * **Stored with the account, not assumed.** This is the single thing that makes
 * the choice of KDF reversible: a stretch that is right today is weak in five
 * years, and an account that records which function and which cost produced its
 * key can be re-wrapped later while every older account keeps opening. The
 * reference design stores exactly this (its salt and its Argon2 ops/mem limits)
 * for the same reason. Hard-coding the parameters instead would make the first
 * upgrade a flag day for every account at once.
 */
export interface KdfParams {
  /**
   * PBKDF2-SHA256 today, because it is what Web Crypto implements natively and
   * therefore needs no dependency. It is NOT the best choice on the merits:
   * Argon2id is memory-hard and PBKDF2 is not, so PBKDF2 gives far more ground
   * to GPUs. The upgrade is a new value here on new accounts, which is why this
   * field exists at all.
   */
  name: 'PBKDF2-SHA256';
  /** Base64. Fresh per account, so two identical passwords derive differently. */
  salt: string;
  iterations: number;
}

/** OWASP's floor for PBKDF2-SHA256 when it guards a key rather than a login. */
export const DEFAULT_KDF_ITERATIONS = 600_000;

/** A fresh descriptor for a new account. */
export function newKdfParams(): KdfParams {
  return {
    name: 'PBKDF2-SHA256',
    salt: bytesToBase64(randomBytes(16)),
    iterations: DEFAULT_KDF_ITERATIONS,
  };
}

/**
 * The key-encryption-key for a password — the value that wraps the master key.
 *
 * Never sent anywhere. The server sees the salt and the iteration count (it has
 * to, or a second device could not derive the same key) and never the result.
 */
export async function deriveKeyFromPassword(
  password: string,
  params: KdfParams,
): Promise<Uint8Array> {
  if (params.name !== 'PBKDF2-SHA256') {
    // A descriptor from a newer client. Failing loudly beats deriving a
    // different key and reporting "wrong password" for the rest of time.
    throw new Error(`unsupported key derivation: ${String(params.name)}`);
  }
  const material = await crypto.subtle.importKey(
    'raw',
    ab(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: ab(base64ToBytes(params.salt)),
      iterations: params.iterations,
    },
    material,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** An account's ECDH keypair, as storable bytes. */
export interface KeyPair {
  /** Uncompressed P-256 point, 65 bytes. Stored in the clear; used to receive shares. */
  publicKey: Uint8Array;
  /** PKCS#8. Wrapped under the master key before it is stored. */
  privateKey: Uint8Array;
}

/** Generate a fresh account keypair for asymmetric sealing. */
export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey, privateKey };
}

async function ecdhShared(privatePkcs8: Uint8Array, publicRaw: Uint8Array): Promise<Uint8Array> {
  const priv = await crypto.subtle.importKey(
    'pkcs8',
    ab(privatePkcs8),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const pub = await crypto.subtle.importKey(
    'raw',
    ab(publicRaw),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
}

// HKDF over a raw ECDH shared secret → a 32-byte AES key. Domain-separated by a
// fixed info string so this derivation cannot be confused with any other.
async function deriveSealKey(shared: Uint8Array): Promise<Uint8Array> {
  const hk = await crypto.subtle.importKey('raw', ab(shared), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0), info: ab(HKDF_INFO) },
    hk,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Asymmetric seal — how a project key is handed to another person.
 *
 * Encrypts `plaintext` to a recipient's `recipientPublicKey` such that only the
 * holder of the matching private key can open it, and the sender needs no key
 * of their own. An ephemeral keypair is generated per call; the shared secret
 * (ephemeral private × recipient public) is run through HKDF into an AES key.
 * Output is `ephemeralPublicKey ‖ iv ‖ ciphertext`.
 */
export async function seal(
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const eph = await generateKeyPair();
  const shared = await ecdhShared(eph.privateKey, recipientPublicKey);
  const aesKey = await deriveSealKey(shared);
  const inner = await encryptSecret(aesKey, plaintext); // iv ‖ ct
  return concat(eph.publicKey, inner);
}

/**
 * Open a {@link seal} with the recipient's private key.
 *
 * Only the private key is needed: the ephemeral public key travels in the blob,
 * and ECDH is symmetric, so `ephPriv × recipientPub == recipientPriv × ephPub`.
 */
export async function sealOpen(
  recipientPrivateKey: Uint8Array,
  sealed: Uint8Array,
): Promise<Uint8Array> {
  if (sealed.length < P256_RAW_PUBLIC_BYTES + IV_BYTES) {
    throw new Error('sealed blob too short');
  }
  const ephPub = sealed.subarray(0, P256_RAW_PUBLIC_BYTES);
  const inner = sealed.subarray(P256_RAW_PUBLIC_BYTES);
  const shared = await ecdhShared(recipientPrivateKey, ephPub);
  const aesKey = await deriveSealKey(shared);
  return decryptSecret(aesKey, inner);
}

// ---------------------------------------------------------------------------
// Account key hierarchy
// ---------------------------------------------------------------------------

/** The unwrapped keys held in memory once an account is unlocked. */
export interface AccountKeys {
  masterKey: Uint8Array;
  recoveryKey: Uint8Array;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** The wrapped forms the server stores. It can open none of them. */
export interface WrappedAccount {
  publicKey: Uint8Array;
  /** How the password-derived key was made. See {@link KdfParams}. */
  kdf: KdfParams;
  /**
   * masterKey encrypted under the PASSWORD-derived key — the everyday way in.
   *
   * The master key is wrapped twice, by two independent secrets, and that is
   * the whole shape of the design: the password opens it on an ordinary sign
   * in, and the recovery key opens it when the password is gone. Neither can
   * produce the other, and the server holds only these two ciphertexts.
   */
  encMasterKeyByPassword: Uint8Array;
  /** masterKey encrypted under recoveryKey — the root of recovery. */
  encMasterKeyByRecovery: Uint8Array;
  /** privateKey encrypted under masterKey. */
  encPrivateKey: Uint8Array;
  /** recoveryKey encrypted under masterKey, so the pair is mutually recoverable. */
  encRecoveryKeyByMaster: Uint8Array;
}

/**
 * Generate a brand-new account's keys and their wrapped forms.
 *
 * The caller shows `keys.recoveryKey` to the user once (see
 * {@link encodeRecoveryKey}) and uploads `wrapped` to the server. Nothing here
 * is stored unwrapped anywhere the server can see.
 */
export async function createAccount(
  password: string,
): Promise<{ keys: AccountKeys; wrapped: WrappedAccount }> {
  const masterKey = randomKey();
  const recoveryKey = randomKey();
  const { publicKey, privateKey } = await generateKeyPair();
  const kdf = newKdfParams();
  const passwordKey = await deriveKeyFromPassword(password, kdf);
  const wrapped: WrappedAccount = {
    publicKey,
    kdf,
    encMasterKeyByPassword: await encryptSecret(passwordKey, masterKey),
    encMasterKeyByRecovery: await encryptSecret(recoveryKey, masterKey),
    encPrivateKey: await encryptSecret(masterKey, privateKey),
    encRecoveryKeyByMaster: await encryptSecret(masterKey, recoveryKey),
  };
  return { keys: { masterKey, recoveryKey, publicKey, privateKey }, wrapped };
}

/**
 * Unlock an account the ordinary way: with its password.
 *
 * Rejects when the password is wrong, because the AEAD tag will not verify —
 * there is no separate check to get out of step with the real one.
 */
export async function unlockWithPassword(
  password: string,
  wrapped: WrappedAccount,
): Promise<AccountKeys> {
  const passwordKey = await deriveKeyFromPassword(password, wrapped.kdf);
  const masterKey = await decryptSecret(passwordKey, wrapped.encMasterKeyByPassword);
  return unlockWithMasterKey(masterKey, wrapped);
}

/**
 * Set a new password on an account whose master key is already in hand.
 *
 * This is what the recovery path ends in: the recovery key opened the master
 * key, and now a fresh password has to wrap the SAME master key — never a new
 * one, or every project encrypted under the old master key would be lost, which
 * is the failure a password reset is supposed to prevent. A fresh salt each
 * time, so the new wrap shares nothing with the old.
 */
export async function rewrapWithNewPassword(
  masterKey: Uint8Array,
  newPassword: string,
  wrapped: WrappedAccount,
): Promise<WrappedAccount> {
  const kdf = newKdfParams();
  const passwordKey = await deriveKeyFromPassword(newPassword, kdf);
  return {
    ...wrapped,
    kdf,
    encMasterKeyByPassword: await encryptSecret(passwordKey, masterKey),
  };
}

/**
 * Unlock an account on a new device from its recovery key.
 *
 * This is the path when the user pastes their recovery key: unwrap the master
 * key with it, then everything else follows from the master key.
 */
export async function unlockWithRecoveryKey(
  recoveryKey: Uint8Array,
  wrapped: WrappedAccount,
): Promise<AccountKeys> {
  const masterKey = await decryptSecret(recoveryKey, wrapped.encMasterKeyByRecovery);
  const privateKey = await decryptSecret(masterKey, wrapped.encPrivateKey);
  return { masterKey, recoveryKey, publicKey: wrapped.publicKey, privateKey };
}

/** Unlock the account keys given an already-recovered master key. */
export async function unlockWithMasterKey(
  masterKey: Uint8Array,
  wrapped: WrappedAccount,
): Promise<AccountKeys> {
  const privateKey = await decryptSecret(masterKey, wrapped.encPrivateKey);
  const recoveryKey = await decryptSecret(masterKey, wrapped.encRecoveryKeyByMaster);
  return { masterKey, recoveryKey, publicKey: wrapped.publicKey, privateKey };
}

// ---------------------------------------------------------------------------
// Project keys and sharing
// ---------------------------------------------------------------------------

/** Wrap a project key for its owner, under the account master key. */
export function wrapProjectKeyForSelf(
  projectKey: Uint8Array,
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  return encryptSecret(masterKey, projectKey);
}

/** Unwrap a project key the owner wrapped for themselves. */
export function unwrapProjectKeyForSelf(
  wrapped: Uint8Array,
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  return decryptSecret(masterKey, wrapped);
}

/**
 * Seal a project key to a collaborator's public key — the whole of sharing.
 *
 * The board blobs are never touched; only this small key is wrapped, once per
 * member. Layered onto the existing membership machinery, this is what turns
 * "may reach the project" into "can decrypt it".
 */
export function shareProjectKey(
  projectKey: Uint8Array,
  memberPublicKey: Uint8Array,
): Promise<Uint8Array> {
  return seal(memberPublicKey, projectKey);
}

/** Open a project key that was sealed to this account. */
export function openSharedProjectKey(
  sealed: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  return sealOpen(privateKey, sealed);
}

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

/** An encrypted blob and the hash of its *plaintext*, which is its storage key. */
export interface EncryptedBlob {
  /** `iv ‖ ciphertext`, the bytes to store. */
  stored: Uint8Array;
  /** SHA-256 of the plaintext — stable content identity, verified after decrypt. */
  hash: string;
}

/**
 * Encrypt a board blob under a project key, content-addressed by its plaintext.
 *
 * The returned `hash` is `sha256(plaintext)`, not of the ciphertext — that is
 * the departure from a textbook design that keeps content addressing working:
 * dedup, "re-push writes nothing", and post-decrypt verification all key off a
 * value that does not change with the random IV. See `docs/encryption-design.md`.
 */
export async function encryptBlob(
  projectKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<EncryptedBlob> {
  const hash = await sha256Hex(plaintext);
  const stored = await encryptSecret(projectKey, plaintext);
  return { stored, hash };
}

/**
 * Decrypt a blob and verify it against the plaintext hash that named it.
 *
 * Two independent checks stand between the stored bytes and the parser: GCM's
 * tag catches tampering or truncation, and the hash catches a substituted
 * object — strictly stronger than the plaintext store's single hash check.
 */
export async function decryptBlob(
  projectKey: Uint8Array,
  stored: Uint8Array,
  expectedHash: string,
): Promise<Uint8Array> {
  const plaintext = await decryptSecret(projectKey, stored);
  const actual = await sha256Hex(plaintext);
  if (actual !== expectedHash) {
    throw new Error(
      `decrypted blob does not match its hash: expected ${expectedHash.slice(0, 12)}..., got ${actual.slice(0, 12)}...`,
    );
  }
  return plaintext;
}

// ---------------------------------------------------------------------------
// Recovery-key presentation
// ---------------------------------------------------------------------------

/**
 * Render a recovery key for a human to write down: uppercase hex in groups of
 * four, dash-separated. Not a mnemonic yet — a word list is a nicety to add
 * later; this is unambiguous and copy-pastes cleanly.
 */
export function encodeRecoveryKey(recoveryKey: Uint8Array): string {
  const hex = Array.from(recoveryKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return (hex.match(/.{1,4}/g) ?? []).join('-');
}

/** Parse a recovery key a user typed back, tolerant of spaces, dashes and case. */
export function decodeRecoveryKey(text: string): Uint8Array {
  const hex = text.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== KEY_BYTES * 2) {
    throw new Error(`recovery key must be ${KEY_BYTES * 2} hex characters, got ${hex.length}`);
  }
  const out = new Uint8Array(KEY_BYTES);
  for (let i = 0; i < KEY_BYTES; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Base64 of some bytes, for storing a wrapped blob as a string in a row. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Inverse of {@link bytesToBase64}. */
export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
