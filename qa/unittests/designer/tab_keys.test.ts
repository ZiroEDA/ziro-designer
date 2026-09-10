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

describe('AuthProvider.tsx: where the hand-over sits', () => {
  const src = read('auth/AuthProvider.tsx');

  it('asks the siblings before settling on locked', () => {
    const ask = src.indexOf('askSiblingsForMasterKey(next.user.id)');
    const locked = src.indexOf("setKeyState('locked')", ask);
    expect(ask).toBeGreaterThan(-1);
    expect(locked).toBeGreaterThan(ask);
    // Its own copy first, so a tab with the key never waits on the channel.
    expect(src).toMatch(/recallMasterKey\(\) \?\? \(await askSiblingsForMasterKey/);
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
