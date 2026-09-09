// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The end-to-end encryption core.
 *
 * These tests pin the properties the guarantee rests on, so that a change which
 * quietly weakens one fails here rather than in production over someone's IP:
 *
 *  - a round trip returns exactly the input, and only the right key opens it;
 *  - tampering with a single ciphertext byte is caught, not ignored;
 *  - a project key sealed to a member opens with that member's private key and
 *    with no one else's;
 *  - the whole account hierarchy unlocks from the recovery key alone (the
 *    OAuth-first case: no password anywhere);
 *  - a blob is content-addressed by its *plaintext* hash, and a substituted
 *    ciphertext is rejected on decrypt.
 *
 * The module is pure over bytes and uses only Web Crypto, so nothing here needs
 * a browser or a backend — `crypto.subtle` is present in the Node test runtime.
 */
import { describe, it, expect } from 'vitest';
import {
  randomKey,
  createProjectKey,
  generateKeyPair,
  encryptSecret,
  decryptSecret,
  seal,
  sealOpen,
  createAccount,
  unlockWithRecoveryKey,
  unlockWithMasterKey,
  wrapProjectKeyForSelf,
  unwrapProjectKeyForSelf,
  shareProjectKey,
  openSharedProjectKey,
  encryptBlob,
  decryptBlob,
  encodeRecoveryKey,
  decodeRecoveryKey,
  bytesToBase64,
  base64ToBytes,
} from '@ziroeda/designer/src/cloud/crypto.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe('symmetric AEAD (encryptSecret / decryptSecret)', () => {
  it('round-trips arbitrary bytes', async () => {
    const key = randomKey();
    const msg = bytes('a schematic net named /GND');
    const ct = await encryptSecret(key, msg);
    expect(text(await decryptSecret(key, ct))).toBe('a schematic net named /GND');
  });

  it('produces a different ciphertext each time (fresh IV)', async () => {
    const key = randomKey();
    const msg = bytes('same input');
    const a = await encryptSecret(key, msg);
    const b = await encryptSecret(key, msg);
    expect(same(a, b)).toBe(false);
    // ...but both decrypt to the same plaintext.
    expect(text(await decryptSecret(key, a))).toBe('same input');
    expect(text(await decryptSecret(key, b))).toBe('same input');
  });

  it('rejects the wrong key', async () => {
    const ct = await encryptSecret(randomKey(), bytes('secret'));
    await expect(decryptSecret(randomKey(), ct)).rejects.toThrow();
  });

  it('rejects a tampered ciphertext (authentication)', async () => {
    const key = randomKey();
    const ct = await encryptSecret(key, bytes('do not flip a bit of me'));
    ct[ct.length - 1] ^= 0x01;
    await expect(decryptSecret(key, ct)).rejects.toThrow();
  });

  it('rejects a key of the wrong length', async () => {
    await expect(encryptSecret(new Uint8Array(16), bytes('x'))).rejects.toThrow(/32 bytes/);
  });
});

describe('asymmetric seal (seal / sealOpen)', () => {
  it('a message sealed to a public key opens only with its private key', async () => {
    const recipient = await generateKeyPair();
    const stranger = await generateKeyPair();
    const sealed = await seal(recipient.publicKey, bytes('for your eyes only'));

    expect(text(await sealOpen(recipient.privateKey, sealed))).toBe('for your eyes only');
    await expect(sealOpen(stranger.privateKey, sealed)).rejects.toThrow();
  });

  it('uses a fresh ephemeral key each time', async () => {
    const r = await generateKeyPair();
    const a = await seal(r.publicKey, bytes('m'));
    const b = await seal(r.publicKey, bytes('m'));
    expect(same(a, b)).toBe(false);
  });
});

describe('account key hierarchy', () => {
  it('unlocks entirely from the recovery key — no password (OAuth-first)', async () => {
    const { keys, wrapped } = await createAccount();
    const unlocked = await unlockWithRecoveryKey(keys.recoveryKey, wrapped);

    expect(same(unlocked.masterKey, keys.masterKey)).toBe(true);
    expect(same(unlocked.privateKey, keys.privateKey)).toBe(true);
    expect(same(unlocked.publicKey, keys.publicKey)).toBe(true);
  });

  it('unlocks from a recovered master key, recovering the recovery key too', async () => {
    const { keys, wrapped } = await createAccount();
    const unlocked = await unlockWithMasterKey(keys.masterKey, wrapped);
    expect(same(unlocked.recoveryKey, keys.recoveryKey)).toBe(true);
    expect(same(unlocked.privateKey, keys.privateKey)).toBe(true);
  });

  it('a wrong recovery key cannot unlock the account', async () => {
    const { wrapped } = await createAccount();
    await expect(unlockWithRecoveryKey(randomKey(), wrapped)).rejects.toThrow();
  });

  it('stores nothing the server could decrypt on its own', async () => {
    const { keys, wrapped } = await createAccount();
    // The only cleartext in the wrapped bundle is the public key.
    expect(same(wrapped.publicKey, keys.publicKey)).toBe(true);
    // The wrapped master key is not the master key.
    expect(same(wrapped.encMasterKeyByRecovery, keys.masterKey)).toBe(false);
    expect(same(wrapped.encPrivateKey, keys.privateKey)).toBe(false);
  });
});

describe('project keys and sharing', () => {
  it('owner wraps a project key for themselves and gets it back', async () => {
    const { keys } = await createAccount();
    const projectKey = createProjectKey();
    const wrapped = await wrapProjectKeyForSelf(projectKey, keys.masterKey);
    expect(same(await unwrapProjectKeyForSelf(wrapped, keys.masterKey), projectKey)).toBe(true);
  });

  it('sharing hands a project key to a collaborator and no one else', async () => {
    const member = await createAccount();
    const outsider = await createAccount();
    const projectKey = createProjectKey();

    const sealed = await shareProjectKey(projectKey, member.keys.publicKey);

    expect(same(await openSharedProjectKey(sealed, member.keys.privateKey), projectKey)).toBe(true);
    await expect(openSharedProjectKey(sealed, outsider.keys.privateKey)).rejects.toThrow();
  });

  it("a shared collaborator can decrypt the owner's blobs", async () => {
    const member = await createAccount();
    const projectKey = createProjectKey();
    const board = bytes('(kicad_pcb (net 0 ""))');

    // Owner encrypts a blob and shares the key; member opens both.
    const enc = await encryptBlob(projectKey, board);
    const sealed = await shareProjectKey(projectKey, member.keys.publicKey);
    const memberKey = await openSharedProjectKey(sealed, member.keys.privateKey);

    expect(text(await decryptBlob(memberKey, enc.stored, enc.hash))).toBe('(kicad_pcb (net 0 ""))');
  });
});

describe('blob encryption (content-addressed by plaintext)', () => {
  it('addresses by the plaintext hash, which is stable across encryptions', async () => {
    const projectKey = createProjectKey();
    const board = bytes('stable identity');
    const a = await encryptBlob(projectKey, board);
    const b = await encryptBlob(projectKey, board);
    // Same plaintext -> same hash (dedup, "re-push writes nothing" survive)...
    expect(a.hash).toBe(b.hash);
    // ...even though the stored ciphertext differs (fresh IV).
    expect(same(a.stored, b.stored)).toBe(false);
  });

  it('round-trips and verifies against the hash', async () => {
    const projectKey = createProjectKey();
    const enc = await encryptBlob(projectKey, bytes('round trip'));
    expect(text(await decryptBlob(projectKey, enc.stored, enc.hash))).toBe('round trip');
  });

  it('rejects a blob whose plaintext does not match the hash that named it', async () => {
    const projectKey = createProjectKey();
    const real = await encryptBlob(projectKey, bytes('the real board'));
    const other = await encryptBlob(projectKey, bytes('a different board'));
    // Substituting a valid-but-wrong object is caught by the hash check.
    await expect(decryptBlob(projectKey, other.stored, real.hash)).rejects.toThrow(
      /does not match/,
    );
  });

  it('rejects a tampered blob before the hash is even consulted (AEAD)', async () => {
    const projectKey = createProjectKey();
    const enc = await encryptBlob(projectKey, bytes('tamper target'));
    enc.stored[enc.stored.length - 1] ^= 0xff;
    await expect(decryptBlob(projectKey, enc.stored, enc.hash)).rejects.toThrow();
  });
});

describe('recovery-key presentation', () => {
  it('encode/decode is a faithful round trip', () => {
    const key = randomKey();
    const shown = encodeRecoveryKey(key);
    expect(shown).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){15}$/);
    expect(same(decodeRecoveryKey(shown), key)).toBe(true);
  });

  it('tolerates spaces, lowercase and missing dashes on the way back in', () => {
    const key = randomKey();
    const shown = encodeRecoveryKey(key).replace(/-/g, ' ').toLowerCase();
    expect(same(decodeRecoveryKey(shown), key)).toBe(true);
  });

  it('rejects a recovery key of the wrong length', () => {
    expect(() => decodeRecoveryKey('ABCD-1234')).toThrow(/hex characters/);
  });
});

describe('base64 helpers', () => {
  it('round-trips bytes including high values and zero', () => {
    const b = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(same(base64ToBytes(bytesToBase64(b)), b)).toBe(true);
  });
});
