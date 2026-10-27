// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A sign-up for an address that already has an account must not show the
 * "we sent a code" screen: no code was sent. Supabase does not say so with an
 * error -- it answers a placeholder user with no identities -- so the form has
 * to recognise the shape (designer/src/auth/signup_outcome.ts).
 *
 * The three fixtures are the three answers `auth.signUp` gives without an
 * error, as supabase-js 2.x returns them.
 */
import { describe, expect, it } from 'vitest';
import {
  describeAuthError,
  INCORRECT_PASSWORD_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  signUpOutcome,
} from '@ziroeda/designer/src/auth/signup_outcome.js';
import { progressPercent } from '@ziroeda/designer/src/auth/auth_progress.js';

const identity = { id: 'u1', provider: 'email' };

describe('signUpOutcome', () => {
  it('an address that is already registered and confirmed is "exists" - a placeholder user, no session, no identities', () => {
    expect(signUpOutcome({ user: { identities: [] }, session: null })).toBe('exists');
    // Older servers leave the array out rather than empty.
    expect(signUpOutcome({ user: {}, session: null })).toBe('exists');
    expect(signUpOutcome({ user: { identities: null }, session: null })).toBe('exists');
  });

  it('a new account waiting on its code is "confirm" - a user with an identity, no session', () => {
    expect(signUpOutcome({ user: { identities: [identity] }, session: null })).toBe('confirm');
  });

  it('confirmation off is "signed-in" - user and session together', () => {
    expect(
      signUpOutcome({ user: { identities: [identity] }, session: { access_token: 't' } }),
    ).toBe('signed-in');
  });
});

/**
 * A request that never reached the server reads as one plain sentence, in every browser's
 * wording - the Firefox one is what sign-up showed: "NetworkError when attempting to fetch
 * resource. (<project>.supabase.co)".
 */
describe('describeAuthError', () => {
  it('says a request that never arrived in plain words, whichever browser said it', () => {
    for (const raw of [
      'NetworkError when attempting to fetch resource. (rrnpoleplkavdgfxmyyy.supabase.co)',
      'Failed to fetch',
      'Load failed',
      'TypeError: fetch failed',
    ])
      expect(describeAuthError(raw), raw).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('keeps the wrong-password wording, and passes anything else through', () => {
    expect(describeAuthError('Invalid login credentials')).toBe(INCORRECT_PASSWORD_MESSAGE);
    expect(describeAuthError('Email rate limit exceeded')).toBe('Email rate limit exceeded');
  });
});

describe('progressPercent', () => {
  const at = (step: number, steps: number, expectMs: number) => ({
    stage: { label: '', why: '', expectMs },
    step,
    steps,
    startedAt: 1000,
  });

  it('counts the stages done and this one by its usual time', () => {
    expect(progressPercent(at(1, 3, 1000), 1000)).toBe(0);
    expect(progressPercent(at(1, 3, 1000), 1500)).toBe(17);
    expect(progressPercent(at(2, 3, 1000), 1000)).toBe(33);
  });

  it('waits short of the next stage when one runs long, rather than claiming it done', () => {
    expect(progressPercent(at(3, 3, 1000), 60_000)).toBe(98);
    expect(progressPercent(at(1, 2, 1000), 60_000)).toBeLessThan(50);
  });
});
