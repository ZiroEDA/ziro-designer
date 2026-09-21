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
import { signUpOutcome } from '@ziroeda/designer/src/auth/signup_outcome.js';

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
