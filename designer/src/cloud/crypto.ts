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

import { argon2id } from 'hash-wasm';
import { BIP39_ENGLISH } from './bip39_english.js';
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
export function ab(b: Uint8Array): ArrayBuffer {
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
export type KdfParams = Argon2idParams | Pbkdf2Params;

/**
 * Argon2id, the KDF every new account gets.
 *
 * Memory-hard: an attacker with a rack of GPUs gains far less over a laptop
 * than with PBKDF2, because each guess has to touch the whole memory block.
 * The limits are libsodium's, which is what the reference design runs — see
 * {@link ARGON2ID} — and are per account because the device that created the
 * account chose them (see {@link deriveNewKeyFromPassword}).
 */
export interface Argon2idParams {
  name: 'argon2id';
  /** Base64. Fresh per account, so two identical passwords derive differently. */
  salt: string;
  /** Passes over the memory. libsodium's `opslimit`. */
  opsLimit: number;
  /** Memory in KiB. libsodium's `memlimit`, which it states in bytes. */
  memLimitKiB: number;
}

/**
 * PBKDF2-SHA256: what the first accounts were written with, because Web Crypto
 * implements it natively and nothing else needed a dependency. Kept so that a
 * descriptor already stored still opens; never produced any more.
 */
export interface Pbkdf2Params {
  name: 'PBKDF2-SHA256';
  salt: string;
  iterations: number;
}

/**
 * libsodium's `crypto_pwhash` limits for Argon2id, which the reference design
 * uses as its units of strength.
 * [data] libsodium `crypto_pwhash_argon2id.h`: OPSLIMIT_SENSITIVE 4,
 * MEMLIMIT_SENSITIVE 1073741824; OPSLIMIT_MODERATE 3, MEMLIMIT_MODERATE
 * 268435456; OPSLIMIT_INTERACTIVE 2, MEMLIMIT_INTERACTIVE 67108864.
 * Parallelism is fixed at 1 there, and so it is here. MEM_SENSITIVE_MIN_KIB is
 * the reference design's own floor for a SENSITIVE key (its core's
 * MEMLIMIT_SENSITIVE_MIN, 134217728), not libsodium's.
 */
export const ARGON2ID = {
  OPS_SENSITIVE: 4,
  MEM_SENSITIVE_KIB: 1_048_576,
  MEM_MODERATE_KIB: 262_144,
  MEM_SENSITIVE_MIN_KIB: 131_072,
  OPS_INTERACTIVE: 2,
  MEM_INTERACTIVE_KIB: 65_536,
  PARALLELISM: 1,
} as const;

/** OWASP's floor for PBKDF2-SHA256 when it guards a key rather than a login. */
export const DEFAULT_KDF_ITERATIONS = 600_000;

/** One Argon2id run. Injectable so the ladder can be tested without a gigabyte. */
export type Argon2Fn = (
  password: string,
  salt: Uint8Array,
  opsLimit: number,
  memLimitKiB: number,
) => Promise<Uint8Array>;

const argon2idReal: Argon2Fn = (password, salt, opsLimit, memLimitKiB) =>
  argon2id({
    password,
    salt,
    iterations: opsLimit,
    memorySize: memLimitKiB,
    parallelism: ARGON2ID.PARALLELISM,
    hashLength: KEY_BYTES,
    outputType: 'binary',
  });

/**
 * A NEW account's key from its password: the parameters are chosen here, by
 * trying, and stored with the key so every later device derives the same.
 *
 * This is the reference design's ladder, as its core (shared by its web and
 * mobile apps) runs it now. The strength wanted is SENSITIVE — 4 passes over
 * 1 GiB — but a 1 GiB allocation is one browsers and phones often refuse, so
 * the first attempt is the same work in a MODERATE footprint: 16 passes over
 * 256 MiB. If the device cannot give even that, halve the memory and double
 * the passes and try again, so the WORK never changes and only the footprint
 * drops, down to the design's floor of 128 MiB, below which it refuses rather
 * than issue a weak key. The device that made the account decides once; a
 * weaker device signing in later must still manage what it chose, which is
 * why the floor is not lower.
 */
export async function deriveNewKeyFromPassword(
  password: string,
  opts: { opsLimit?: number; memLimitKiB?: number; argon2?: Argon2Fn } = {},
): Promise<{ key: Uint8Array; params: Argon2idParams }> {
  const run = opts.argon2 ?? argon2idReal;
  const salt = randomBytes(16);
  const factor = ARGON2ID.MEM_SENSITIVE_KIB / ARGON2ID.MEM_MODERATE_KIB;
  let opsLimit = opts.opsLimit ?? ARGON2ID.OPS_SENSITIVE * factor;
  let memLimitKiB = opts.memLimitKiB ?? ARGON2ID.MEM_MODERATE_KIB;
  // The start is always tried, so a caller (a test) may name one under the
  // floor; the DESCENT never goes under it.
  for (;;) {
    try {
      const key = await run(password, salt, opsLimit, memLimitKiB);
      return {
        key,
        params: { name: 'argon2id', salt: bytesToBase64(salt), opsLimit, memLimitKiB },
      };
    } catch {
      opsLimit *= 2;
      memLimitKiB /= 2;
      if (memLimitKiB < ARGON2ID.MEM_SENSITIVE_MIN_KIB)
        throw new Error('this device cannot derive an account key');
    }
  }
}

/**
 * The key-encryption-key for a password — the value that wraps the master key.
 *
 * Never sent anywhere. The server sees the salt and the cost (it has to, or a
 * second device could not derive the same key) and never the result.
 */
export async function deriveKeyFromPassword(
  password: string,
  params: KdfParams,
  argon2: Argon2Fn = argon2idReal,
): Promise<Uint8Array> {
  if (params.name === 'argon2id') {
    return argon2(password, base64ToBytes(params.salt), params.opsLimit, params.memLimitKiB);
  }
  if (params.name !== 'PBKDF2-SHA256') {
    // A descriptor from a newer client. Failing loudly beats deriving a
    // different key and reporting "wrong password" for the rest of time.
    throw new Error(`unsupported key derivation: ${String((params as { name: unknown }).name)}`);
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

/**
 * What the auth server is given in place of the password.
 *
 * The reference design signs in with SRP, so the password never leaves the
 * device. Supabase Auth has no SRP: it takes a password string and bcrypts it.
 * So what it is given is not the password, and not the key that wraps the
 * master key either, but a second Argon2id output that shares nothing with the
 * first: a different salt, derived from the EMAIL, and libsodium's INTERACTIVE
 * limits. The server can bcrypt and compare it, and from it can recover
 * neither the password nor the KEK.
 *
 * The salt is the email, hashed under a label, on purpose: a random per-account
 * salt would have to be fetched BEFORE signing in, which is an unauthenticated
 * "does this account exist" endpoint that then needs fake answers to hide that,
 * and a sign-up that died between the auth call and storing the keys would be
 * locked out. With the email as the salt there is no round trip and nothing to
 * enumerate, and such a sign-up simply signs in and runs key setup again. The
 * cost is one INTERACTIVE-sized run (2 passes over 64 MiB) beside the SENSITIVE
 * one that unwraps the master key: under half a second, once per sign-in.
 *
 * The email is lowercased and trimmed first, as the auth server stores it, so
 * "A@B.com" and "a@b.com" are the one account they are on the server.
 */
export async function loginSecret(
  email: string,
  password: string,
  argon2: Argon2Fn = argon2idReal,
): Promise<string> {
  const salt = await loginSalt(email);
  const key = await argon2(password, salt, ARGON2ID.OPS_INTERACTIVE, ARGON2ID.MEM_INTERACTIVE_KIB);
  return bytesToBase64(key);
}

/** SHA-256 of the labelled, normalised email: 16 bytes of it, libsodium's salt size. */
async function loginSalt(email: string): Promise<Uint8Array> {
  const normalised = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    ab(new TextEncoder().encode(`ziro-login-v1\0${normalised}`)),
  );
  return new Uint8Array(digest).slice(0, 16);
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
  kdfOpts?: Parameters<typeof deriveNewKeyFromPassword>[1],
): Promise<{ keys: AccountKeys; wrapped: WrappedAccount }> {
  const masterKey = randomKey();
  const recoveryKey = randomKey();
  const { publicKey, privateKey } = await generateKeyPair();
  const { key: passwordKey, params: kdf } = await deriveNewKeyFromPassword(password, kdfOpts);
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
  argon2?: Argon2Fn,
): Promise<AccountKeys> {
  return unlockWithPasswordKey(await deriveKeyFromPassword(password, wrapped.kdf, argon2), wrapped);
}

/** Unlock with the password-derived key already in hand. */
export async function unlockWithPasswordKey(
  passwordKey: Uint8Array,
  wrapped: WrappedAccount,
): Promise<AccountKeys> {
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
  kdfOpts?: Parameters<typeof deriveNewKeyFromPassword>[1],
): Promise<WrappedAccount> {
  const { key: passwordKey, params: kdf } = await deriveNewKeyFromPassword(newPassword, kdfOpts);
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
 * Render a recovery key for a human: 24 English words, BIP-39.
 *
 * 256 bits of key plus an 8-bit checksum (the first byte of its SHA-256) is
 * 264 bits, which is exactly 24 eleven-bit indexes into the 2048-word list.
 * Words are what a person can read back over the phone and type without
 * confusing 0 and O; the checksum catches a word out of place before the
 * wrong key is even tried. The reference design spells its recovery key the
 * same way, with the same list, and still accepts the plain hex it used first
 * — so does {@link decodeRecoveryKey}.
 */
export async function encodeRecoveryKey(recoveryKey: Uint8Array): Promise<string> {
  if (recoveryKey.length !== KEY_BYTES) throw new Error('recovery key must be 32 bytes');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ab(recoveryKey)));
  // 264 bits, as one string of '0'/'1': simple, and it runs once per sign-up.
  let bits = '';
  for (const b of recoveryKey) bits += b.toString(2).padStart(8, '0');
  bits += digest[0]!.toString(2).padStart(8, '0');
  const words: string[] = [];
  for (let i = 0; i < 24; i++) {
    words.push(BIP39_ENGLISH[Number.parseInt(bits.slice(i * 11, i * 11 + 11), 2)]!);
  }
  return words.join(' ');
}

/**
 * Parse a recovery key a user typed back: the 24 words, or the 64 hex digits.
 *
 * Whitespace runs, case and dashes are forgiven, as the reference design
 * forgives them. A wrong word, a word out of place, or a checksum that does
 * not match is a refusal here rather than a wrong key tried against the
 * ciphertext: "incorrect recovery key" is the honest message either way, but
 * this one is instant.
 */
export async function decodeRecoveryKey(text: string): Promise<Uint8Array> {
  const parts = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 24) {
    let bits = '';
    for (const w of parts) {
      const i = BIP39_ENGLISH.indexOf(w);
      if (i < 0) throw new Error('incorrect recovery key');
      bits += i.toString(2).padStart(11, '0');
    }
    const out = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ab(out)));
    if (Number.parseInt(bits.slice(256, 264), 2) !== digest[0]) {
      throw new Error('incorrect recovery key');
    }
    return out;
  }
  const hex = parts.join('').replace(/-/g, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('incorrect recovery key');
  const out = new Uint8Array(KEY_BYTES);
  for (let i = 0; i < KEY_BYTES; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
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
