// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The master key, remembered on this device (#639): a returning user is let
 * straight in, with no unlock step. `auth/device_key.ts` is exercised for real
 * on fake-indexeddb with Node's own Web Crypto, whose structured clone keeps a
 * `CryptoKey` non-extractable the way a browser's IndexedDB does.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetOnDevice,
  recallFromDevice,
  rememberOnDevice,
} from '@ziroeda/designer/src/auth/device_key.js';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff);
const OTHER = Uint8Array.from({ length: 32 }, (_, i) => (i * 3 + 1) & 0xff);

describe('device_key.ts', () => {
  beforeEach(() => forgetOnDevice());

  it('gives back the key it was given, byte for byte', async () => {
    await rememberOnDevice('user-1', KEY);
    expect(Array.from((await recallFromDevice('user-1'))!)).toEqual(Array.from(KEY));
  });

  it('remembers nothing until told to', async () => {
    expect(await recallFromDevice('user-1')).toBeNull();
  });

  it('gives one account nothing of another', async () => {
    await rememberOnDevice('user-1', KEY);
    expect(await recallFromDevice('user-2')).toBeNull();
  });

  it('one account per profile: remembering another replaces the first', async () => {
    await rememberOnDevice('user-1', KEY);
    await rememberOnDevice('user-2', OTHER);
    expect(await recallFromDevice('user-1')).toBeNull();
    expect(Array.from((await recallFromDevice('user-2'))!)).toEqual(Array.from(OTHER));
  });

  it('sign-out forgets it', async () => {
    await rememberOnDevice('user-1', KEY);
    await forgetOnDevice();
    expect(await recallFromDevice('user-1')).toBeNull();
  });

  it('keeps no key bytes in the store: what is there is sealed, under a key nothing can export', async () => {
    await rememberOnDevice('user-1', KEY);
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = indexedDB.open('ziro-device-key');
      req.onsuccess = () => {
        const get = req.result.transaction('key').objectStore('key').get('account');
        get.onsuccess = () => {
          req.result.close();
          resolve(get.result as Record<string, unknown>);
        };
        get.onerror = () => reject(get.error);
      };
      req.onerror = () => reject(req.error);
    });
    const wrapKey = record.wrapKey as CryptoKey;
    expect(wrapKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', wrapKey)).rejects.toThrow();
    // The sealed bytes are not the key, anywhere in them.
    const sealed = Array.from(new Uint8Array(record.sealed as ArrayBuffer)).join(',');
    expect(sealed.includes(Array.from(KEY).join(','))).toBe(false);
    expect(Object.values(record).some((v) => v instanceof Uint8Array && v.length === 32)).toBe(
      false,
    );
  });
});
