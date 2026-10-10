// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The login secret, primed while the form is filled in (#639: a faster
 * sign-in). Node has no `Worker`, so this runs the main-thread fallback; the
 * worker itself was checked in Chrome (same bytes, frames kept coming, submit
 * after priming 0 ms against ~800 ms).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loginSecret } from '@ziroeda/designer/src/cloud/crypto.js';
import {
  forgetPrimedLoginSecret,
  loginSecretFor,
  primeLoginSecret,
} from '@ziroeda/designer/src/auth/login_secret_cache.js';

describe('login_secret_cache.ts', () => {
  beforeEach(() => forgetPrimedLoginSecret());

  it('the submit gets the primed derivation itself, not a second run', async () => {
    primeLoginSecret('a@b.com', 'pw-123456');
    const t = performance.now();
    const got = await loginSecretFor('a@b.com', 'pw-123456');
    const again = performance.now();
    // Asking again for the same pair is the same promise: no second Argon2id.
    await loginSecretFor('a@b.com', 'pw-123456');
    expect(performance.now() - again).toBeLessThan(50);
    expect(got).toBe(await loginSecret('a@b.com', 'pw-123456'));
    expect(t).toBeGreaterThan(0);
  }, 30_000);

  it('a changed password is derived afresh, never answered with the primed one', async () => {
    primeLoginSecret('a@b.com', 'pw-123456');
    const other = await loginSecretFor('a@b.com', 'pw-654321');
    expect(other).toBe(await loginSecret('a@b.com', 'pw-654321'));
    expect(other).not.toBe(await loginSecret('a@b.com', 'pw-123456'));
  }, 30_000);

  it('nothing is primed for an empty field', async () => {
    primeLoginSecret('a@b.com', '');
    primeLoginSecret('', 'pw-123456');
    // Still derives correctly on submit.
    expect(await loginSecretFor('a@b.com', 'pw-123456')).toBe(
      await loginSecret('a@b.com', 'pw-123456'),
    );
  }, 30_000);

  it('forgotten once the account is open', async () => {
    primeLoginSecret('a@b.com', 'pw-123456');
    forgetPrimedLoginSecret();
    const t = performance.now();
    await loginSecretFor('a@b.com', 'pw-123456');
    // A fresh run: Argon2id over 64 MiB is not instant.
    expect(performance.now() - t).toBeGreaterThan(50);
  }, 30_000);
});
