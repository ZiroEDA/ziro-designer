// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A new tab of an unlocked account opens without the password.
 *
 * The master key lives in each tab's sessionStorage, which the reference
 * design also does — and there every new tab asks for the password. Ours
 * asks the sibling tabs first (`auth/tab_keys.ts`), over a same-origin
 * `BroadcastChannel`. Node's own BroadcastChannel delivers between instances
 * in one process, so the hand-over is exercised for real here: one "tab"
 * serves, another asks.
 *
 * `AuthProvider` is not importable (Supabase client, CSS), so its side is
 * pinned at the source: a tab asks its siblings BEFORE it settles on
 * `locked`, serves while it holds the keys, and drops its own copy when the
 * session ends.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASK_TIMEOUT_MS,
  askSiblingsForMasterKey,
  onSiblingKeyReady,
  serveMasterKey,
} from '@ziroeda/designer/src/auth/tab_keys.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);

describe('tab_keys.ts: the hand-over', () => {
  it('a tab that holds the account answers a sibling asking for it, byte for byte', async () => {
    const stop = serveMasterKey('user-1', KEY);
    try {
      const got = await askSiblingsForMasterKey('user-1');
      expect(got).not.toBeNull();
      expect(Array.from(got!)).toEqual(Array.from(KEY));
    } finally {
      stop();
    }
  });

  it('answers only for the account it holds', async () => {
    const stop = serveMasterKey('user-1', KEY);
    try {
      expect(await askSiblingsForMasterKey('user-2', 50)).toBeNull();
    } finally {
      stop();
    }
  });

  it('with no sibling the question goes unanswered, within the timeout', async () => {
    const t0 = Date.now();
    expect(await askSiblingsForMasterKey('user-1')).toBeNull();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(ASK_TIMEOUT_MS - 5);
  });

  it('a tab that has stopped serving no longer answers', async () => {
    serveMasterKey('user-1', KEY)();
    expect(await askSiblingsForMasterKey('user-1', 50)).toBeNull();
  });
});

describe('tab_keys.ts: a tab that starts holding the key says so (#639)', () => {
  // Sign-up opens in a new tab; the tab that opened it got the session before
  // the new one had made the keys, and must hear when it has them.
  it('a waiting tab hears the account it waits for, and asking again then succeeds', async () => {
    let heard = 0;
    const stopListening = onSiblingKeyReady('user-1', () => heard++);
    const stop = serveMasterKey('user-1', KEY);
    try {
      for (let i = 0; i < 50 && heard === 0; i++) await new Promise((r) => setTimeout(r, 10));
      expect(heard).toBe(1);
      expect(Array.from((await askSiblingsForMasterKey('user-1'))!)).toEqual(Array.from(KEY));
    } finally {
      stop();
      stopListening();
    }
  });

  it('does not hear another account', async () => {
    let heard = 0;
    const stopListening = onSiblingKeyReady('user-2', () => heard++);
    const stop = serveMasterKey('user-1', KEY);
    try {
      await new Promise((r) => setTimeout(r, 100));
      expect(heard).toBe(0);
    } finally {
      stop();
      stopListening();
    }
  });
});

describe('AuthProvider.tsx: where the hand-over sits', () => {
  const src = read('auth/AuthProvider.tsx');

  it('asks the siblings before settling on locked', () => {
    const ask = src.indexOf('askSiblingsForMasterKey(next.user.id)');
    const locked = src.indexOf("setKeyState('locked')", ask);
    expect(ask).toBeGreaterThan(-1);
    expect(locked).toBeGreaterThan(ask);
    // Its own copy first, then the device's, so a tab with the key never waits
    // on the channel.
    expect(src).toMatch(
      /recallMasterKey\(\) \?\?\s*\(await recallFromDevice\(next\.user\.id\)\) \?\?\s*\(await askSiblingsForMasterKey/,
    );
  });

  it('remembers the key on the device BEFORE serving it, so a tab that hears "ready" finds it there (#639)', () => {
    const open = src.slice(
      src.indexOf('const open = useCallback('),
      src.indexOf('const finishSetup'),
    );
    const remember = open.indexOf('await rememberOnDevice(userId, unlocked.masterKey)');
    expect(remember).toBeGreaterThan(-1);
    expect(remember).toBeLessThan(open.indexOf('setKeys(unlocked);'));
  });

  it('a key that does not fit is forgotten on the device too', () => {
    const settle = src.slice(src.indexOf('const settleKeys = useCallback('));
    const bad = settle.slice(settle.indexOf("console.warn('Account keys:', err);"));
    expect(bad.slice(0, bad.indexOf("setKeyState('locked')"))).toContain('void forgetOnDevice();');
  });

  it('the network failing is retried, never read as locked: locked signs the tab out now', () => {
    const settle = src.slice(src.indexOf('const settleKeys = useCallback('));
    const fetchFail = settle.slice(
      settle.indexOf('wrapped = await fetchWrappedAccount(supabase, next.user.id);'),
      settle.indexOf('if (!wrapped) {'),
    );
    expect(fetchFail).toContain('setTimeout(');
    expect(fetchFail).not.toContain("setKeyState('locked')");
  });

  it('a tab coming back into view does not settle again: the app is not thrown away on a tab switch', () => {
    // Supabase re-announces the same session as SIGNED_IN on visibilitychange.
    const settle = src.slice(src.indexOf('const settleKeys = useCallback('));
    const skip = settle.indexOf('if (openFor.current === next.user.id) return;');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(settle.indexOf("setKeyState('loading')"));
    expect(src).toContain('openFor.current = userId;');
  });

  it('sign-in, sign-up and the code check hold settling off while they make keys', () => {
    expect(src).toMatch(/signIn: \(email, password\) =>\s*whileOpening\(/);
    expect(src).toMatch(/signUp: \(email, password\) =>\s*whileOpening\(/);
    expect(src).toMatch(/verifyOtp: \(email, token\) =>\s*whileOpening\(/);
    expect(src).toContain('if (pendingSetup.current || openingRef.current) return;');
  });

  it('serves the key while it holds the account', () => {
    expect(src).toMatch(/return serveMasterKey\(userId, keys\.masterKey\)/);
  });

  it('drops its own copy when the session ends, so a sign-out elsewhere ends here', () => {
    const noSession = src.indexOf('if (!supabase || !next) {');
    const forget = src.indexOf('forgetMasterKey();', noSession);
    const absent = src.indexOf("setKeyState('absent')", noSession);
    expect(forget).toBeGreaterThan(noSession);
    expect(forget).toBeLessThan(absent);
  });
});
