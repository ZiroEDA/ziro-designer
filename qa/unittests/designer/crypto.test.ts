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
  deriveKeyFromPassword,
  deriveNewKeyFromPassword,
  loginSecret,
  unlockWithPasswordKey,
  ARGON2ID,
  type Argon2Fn,
  type KdfParams,
  unlockWithPassword,
  rewrapWithNewPassword,
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

/** One password for the suite. Derivation is deliberately slow, so it is not
    varied without a reason. */
const PW = 'correct horse battery staple';
/**
 * Argon2id at 1 pass over 1 MiB: the real function, at a cost a unit test can
 * afford. Production never names a start; it takes libsodium's SENSITIVE
 * limits (4 passes over 1 GiB) and comes down only if the device cannot.
 */
const FAST = { opsLimit: 1, memLimitKiB: 1024 };

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
    ct[ct.length - 1] = (ct[ct.length - 1] ?? 0) ^ 0x01;
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
  it('unlocks entirely from the recovery key, when the password is gone', async () => {
    const { keys, wrapped } = await createAccount(PW, FAST);
    const unlocked = await unlockWithRecoveryKey(keys.recoveryKey, wrapped);

    expect(same(unlocked.masterKey, keys.masterKey)).toBe(true);
    expect(same(unlocked.privateKey, keys.privateKey)).toBe(true);
    expect(same(unlocked.publicKey, keys.publicKey)).toBe(true);
  });

  it('unlocks from a recovered master key, recovering the recovery key too', async () => {
    const { keys, wrapped } = await createAccount(PW, FAST);
    const unlocked = await unlockWithMasterKey(keys.masterKey, wrapped);
    expect(same(unlocked.recoveryKey, keys.recoveryKey)).toBe(true);
    expect(same(unlocked.privateKey, keys.privateKey)).toBe(true);
  });

  it('a wrong recovery key cannot unlock the account', async () => {
    const { wrapped } = await createAccount(PW, FAST);
    await expect(unlockWithRecoveryKey(randomKey(), wrapped)).rejects.toThrow();
  });

  it('stores nothing the server could decrypt on its own', async () => {
    const { keys, wrapped } = await createAccount(PW, FAST);
    // The only cleartext in the wrapped bundle is the public key.
    expect(same(wrapped.publicKey, keys.publicKey)).toBe(true);
    // The wrapped master key is not the master key.
    expect(same(wrapped.encMasterKeyByRecovery, keys.masterKey)).toBe(false);
    expect(same(wrapped.encPrivateKey, keys.privateKey)).toBe(false);
  });
});

describe('project keys and sharing', () => {
  it('owner wraps a project key for themselves and gets it back', async () => {
    const { keys } = await createAccount(PW, FAST);
    const projectKey = createProjectKey();
    const wrapped = await wrapProjectKeyForSelf(projectKey, keys.masterKey);
    expect(same(await unwrapProjectKeyForSelf(wrapped, keys.masterKey), projectKey)).toBe(true);
  });

  it('sharing hands a project key to a collaborator and no one else', async () => {
    const member = await createAccount(PW, FAST);
    const outsider = await createAccount(PW, FAST);
    const projectKey = createProjectKey();

    const sealed = await shareProjectKey(projectKey, member.keys.publicKey);

    expect(same(await openSharedProjectKey(sealed, member.keys.privateKey), projectKey)).toBe(true);
    await expect(openSharedProjectKey(sealed, outsider.keys.privateKey)).rejects.toThrow();
  });

  it("a shared collaborator can decrypt the owner's blobs", async () => {
    const member = await createAccount(PW, FAST);
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
    enc.stored[enc.stored.length - 1] = (enc.stored[enc.stored.length - 1] ?? 0) ^ 0xff;
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

describe('password, and the recovery that replaces a reset email', () => {
  it('unlocks the account the ordinary way', async () => {
    const { keys, wrapped } = await createAccount(PW, FAST);
    const unlocked = await unlockWithPassword(PW, wrapped);
    expect(same(unlocked.masterKey, keys.masterKey)).toBe(true);
    expect(same(unlocked.privateKey, keys.privateKey)).toBe(true);
  });

  it('unlocks from the password-derived key already in hand', async () => {
    const { keys, wrapped } = await createAccount(PW, FAST);
    const passwordKey = await deriveKeyFromPassword(PW, wrapped.kdf);
    const unlocked = await unlockWithPasswordKey(passwordKey, wrapped);
    expect(same(unlocked.masterKey, keys.masterKey)).toBe(true);
    await expect(unlockWithPasswordKey(new Uint8Array(32), wrapped)).rejects.toThrow();
  });

  it('refuses the wrong password', async () => {
    const { wrapped } = await createAccount(PW, FAST);
    await expect(unlockWithPassword('not the password', wrapped)).rejects.toThrow();
  });

  it('salts each account, so one password does not derive one key', async () => {
    const a = await createAccount(PW, FAST);
    const b = await createAccount(PW, FAST);
    expect(a.wrapped.kdf.salt).not.toBe(b.wrapped.kdf.salt);
    // ...and therefore the two wraps share nothing, despite the same password.
    expect(same(a.wrapped.encMasterKeyByPassword, b.wrapped.encMasterKeyByPassword)).toBe(false);
  });

  it('derives the same key from the same password and params, and not otherwise', async () => {
    const { key: one, params } = await deriveNewKeyFromPassword(PW, FAST);
    expect(same(await deriveKeyFromPassword(PW, params), one)).toBe(true);
    const { key: other } = await deriveNewKeyFromPassword(PW, FAST);
    expect(same(other, one)).toBe(false);
    expect(same(await deriveKeyFromPassword('other', params), one)).toBe(false);
  });

  it('stores nothing the server could derive the password key from', async () => {
    const { wrapped } = await createAccount(PW, FAST);
    // The salt and cost are storable by design -- a second device needs them --
    // but they are not the key, and the key is not in the bundle.
    expect(wrapped.kdf.name).toBe('argon2id');
    const derived = await deriveKeyFromPassword(PW, wrapped.kdf);
    expect(same(wrapped.encMasterKeyByPassword, derived)).toBe(false);
  });

  it('a reset through the recovery key KEEPS the master key, so projects survive', async () => {
    // The failure this guards against is the one a reset is supposed to
    // prevent: minting a fresh master key would leave every project encrypted
    // under the old one, i.e. lost.
    const { keys, wrapped } = await createAccount(PW, FAST);
    const projectKey = createProjectKey();
    const stored = await wrapProjectKeyForSelf(projectKey, keys.masterKey);

    // Password forgotten: the recovery key opens the master key...
    const recovered = await unlockWithRecoveryKey(keys.recoveryKey, wrapped);
    // ...and a new password re-wraps that SAME master key.
    const rewrapped = await rewrapWithNewPassword(
      recovered.masterKey,
      'a brand new passphrase',
      wrapped,
      FAST,
    );

    const after = await unlockWithPassword('a brand new passphrase', rewrapped);
    expect(same(after.masterKey, keys.masterKey)).toBe(true);
    // The project encrypted before the reset still opens.
    expect(same(await unwrapProjectKeyForSelf(stored, after.masterKey), projectKey)).toBe(true);
    // And the old password no longer works.
    await expect(unlockWithPassword(PW, rewrapped)).rejects.toThrow();
  });
});

describe('Argon2id is the same function the reference design runs', () => {
  // Known answers from libsodium itself (PyNaCl, crypto_pwhash_alg with
  // ALG_ARGON2ID13), computed on this machine for this test. Salt 00..0f.
  const salt = new Uint8Array(16).map((_, i) => i);
  const hex = (b: Uint8Array): string =>
    [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

  it('ops=1, mem=8 MiB', async () => {
    const params: KdfParams = {
      name: 'argon2id',
      salt: bytesToBase64(salt),
      opsLimit: 1,
      memLimitKiB: 8192,
    };
    expect(hex(await deriveKeyFromPassword(PW, params))).toBe(
      '9aeef75313e585f492c33c5e12d82e9ad253b7dd78632d537e899cd4eddd789c',
    );
  });

  it("ops=2, mem=64 MiB (libsodium's INTERACTIVE limits, the ladder's floor)", async () => {
    const params: KdfParams = {
      name: 'argon2id',
      salt: bytesToBase64(salt),
      opsLimit: ARGON2ID.OPS_INTERACTIVE,
      memLimitKiB: ARGON2ID.MEM_INTERACTIVE_KIB,
    };
    expect(hex(await deriveKeyFromPassword(PW, params))).toBe(
      'c05ce4c4dd7e0e45ee6011cc59d068ade47df1b01fc0cf9cd4678bdf68a5b7b0',
    );
  });

  it("the limits are libsodium's", () => {
    expect(ARGON2ID.OPS_SENSITIVE).toBe(4);
    expect(ARGON2ID.MEM_SENSITIVE_KIB * 1024).toBe(1073741824);
    expect(ARGON2ID.OPS_INTERACTIVE).toBe(2);
    expect(ARGON2ID.MEM_INTERACTIVE_KIB * 1024).toBe(67108864);
    expect(ARGON2ID.PARALLELISM).toBe(1);
  });
});

describe('the ladder: start at SENSITIVE, come down only if the device cannot', () => {
  /** A device that can give at most `maxKiB`; records every attempt. */
  const deviceWith = (maxKiB: number) => {
    const tried: Array<[number, number]> = [];
    const argon2: Argon2Fn = async (_pw, _salt, ops, mem) => {
      tried.push([ops, mem]);
      if (mem > maxKiB) throw new RangeError('WebAssembly.Memory(): could not allocate memory');
      return new Uint8Array(32).fill(ops);
    };
    return { tried, argon2 };
  };

  it('a capable device gets 4 passes over 1 GiB, first try', async () => {
    const d = deviceWith(ARGON2ID.MEM_SENSITIVE_KIB);
    const { params } = await deriveNewKeyFromPassword(PW, { argon2: d.argon2 });
    expect(params).toMatchObject({ name: 'argon2id', opsLimit: 4, memLimitKiB: 1_048_576 });
    expect(d.tried).toHaveLength(1);
  });

  it('a device with 256 MiB: memory halves and passes double, so the work is the same', async () => {
    const d = deviceWith(262_144);
    const { params } = await deriveNewKeyFromPassword(PW, { argon2: d.argon2 });
    expect(params).toMatchObject({ opsLimit: 16, memLimitKiB: 262_144 });
    expect(d.tried).toEqual([
      [4, 1_048_576],
      [8, 524_288],
      [16, 262_144],
    ]);
    expect(params.opsLimit * params.memLimitKiB).toBe(4 * 1_048_576);
  });

  it('it stops at INTERACTIVE (64 MiB) and refuses below it, rather than issuing a weak key', async () => {
    const floor = deviceWith(ARGON2ID.MEM_INTERACTIVE_KIB);
    const { params } = await deriveNewKeyFromPassword(PW, { argon2: floor.argon2 });
    expect(params).toMatchObject({ opsLimit: 64, memLimitKiB: 65_536 });

    const weak = deviceWith(32_768);
    await expect(deriveNewKeyFromPassword(PW, { argon2: weak.argon2 })).rejects.toThrow(
      /cannot derive/,
    );
    // It tried the floor, and nothing under it.
    expect(weak.tried.at(-1)).toEqual([64, 65_536]);
  });

  it('a fresh salt every time', async () => {
    const d = deviceWith(ARGON2ID.MEM_SENSITIVE_KIB);
    const a = await deriveNewKeyFromPassword(PW, { argon2: d.argon2 });
    const b = await deriveNewKeyFromPassword(PW, { argon2: d.argon2 });
    expect(a.params.salt).not.toBe(b.params.salt);
    expect(base64ToBytes(a.params.salt)).toHaveLength(16);
  });
});

describe('the login secret: what the auth server gets instead of the password', () => {
  /** The real function at INTERACTIVE cost takes ~0.4 s; a stand-in that keeps the salt visible. */
  const capture = () => {
    const calls: Array<{ salt: Uint8Array; ops: number; mem: number }> = [];
    const argon2: Argon2Fn = async (pw, salt, ops, mem) => {
      calls.push({ salt, ops, mem });
      const d = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${pw}|${bytesToBase64(salt)}`),
      );
      return new Uint8Array(d);
    };
    return { calls, argon2 };
  };

  it("is Argon2id at libsodium's INTERACTIVE limits over a salt made from the email", async () => {
    const c = capture();
    await loginSecret('someone@example.com', PW, c.argon2);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ ops: 2, mem: 65_536 });
    expect(c.calls[0]?.salt).toHaveLength(16);
  });

  it('is neither the password nor the key that wraps the master key', async () => {
    const { wrapped } = await createAccount(PW, FAST);
    const kek = await deriveKeyFromPassword(PW, wrapped.kdf);
    const secret = await loginSecret('someone@example.com', PW, capture().argon2);
    expect(secret).not.toBe(PW);
    expect(secret).not.toBe(bytesToBase64(kek));
  });

  it('the same for the same email however it is written; different for another', async () => {
    const c = capture();
    const a = await loginSecret('Someone@Example.com', PW, c.argon2);
    const b = await loginSecret('  someone@example.com ', PW, c.argon2);
    const other = await loginSecret('someone.else@example.com', PW, c.argon2);
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(bytesToBase64(c.calls[0]!.salt)).toBe(bytesToBase64(c.calls[1]!.salt));
  });

  it('changes with the password', async () => {
    const c = capture();
    expect(await loginSecret('someone@example.com', PW, c.argon2)).not.toBe(
      await loginSecret('someone@example.com', 'another password', c.argon2),
    );
  });

  it('shares no salt with the KEK, so the server holding its bcrypt learns nothing of the KEK', async () => {
    const { wrapped } = await createAccount(PW, FAST);
    const c = capture();
    await loginSecret('someone@example.com', PW, c.argon2);
    expect(bytesToBase64(c.calls[0]!.salt)).not.toBe(wrapped.kdf.salt);
  });

  it('the real function, once, against libsodium', async () => {
    // Salt: SHA-256("ziro-login-v1\\0someone@example.com")[0..16), from Python's
    // hashlib; stretch: PyNaCl crypto_pwhash_alg(ARGON2ID13, 2, 64 MiB). Pinned
    // so a change in the salt construction or the limits is a failed test and
    // not a locked-out account.
    expect(await loginSecret('someone@example.com', PW)).toBe(
      'I/X/sLCFFURSeLxcYDoB2NAcwyDyx7+qwnCZsGghRXo=',
    );
  });
});

describe('a descriptor already stored keeps opening', () => {
  it('PBKDF2-SHA256, what the first accounts were written with, still derives', async () => {
    const params: KdfParams = {
      name: 'PBKDF2-SHA256',
      salt: bytesToBase64(new Uint8Array(16).fill(7)),
      iterations: 1000,
    };
    const one = await deriveKeyFromPassword(PW, params);
    expect(one).toHaveLength(32);
    expect(same(await deriveKeyFromPassword(PW, params), one)).toBe(true);
  });

  it('a descriptor from a newer client fails loudly rather than deriving a different key', async () => {
    const params = { name: 'scrypt', salt: 'AA==', n: 1 } as unknown as KdfParams;
    await expect(deriveKeyFromPassword(PW, params)).rejects.toThrow(/unsupported key derivation/);
  });

  it('new accounts are never written with it', async () => {
    const { wrapped } = await createAccount(PW, FAST);
    expect(wrapped.kdf.name).toBe('argon2id');
  });
});
