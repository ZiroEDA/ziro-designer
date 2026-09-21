// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * What a `supabase.auth.signUp` answer means, when it is not an error.
 *
 * Three shapes come back without an error, and only two of them are a
 * sign-up:
 *
 *  - a user AND a session: confirmation is off on this server; signed in.
 *  - a user and NO session, with an identity: a real new account, waiting on
 *    the code that was just mailed.
 *  - a user and NO session, with NO identities: the address is already
 *    registered and confirmed. Supabase answers a placeholder rather than
 *    an error so the form cannot be used to learn which addresses have
 *    accounts -- and it sends no mail. Treated as "waiting on a code", this
 *    shows a code screen for a code that will never come, and starts making
 *    a fresh set of encryption keys for an account that already has keys.
 *
 * (An address that is registered but never confirmed comes back with its
 * identity and a re-sent code, which is the second shape and correct.)
 */
export type SignUpOutcome = 'signed-in' | 'confirm' | 'exists';

export function signUpOutcome(data: {
  user: { identities?: unknown[] | null } | null;
  session: unknown | null;
}): SignUpOutcome {
  if (!data.user) return 'confirm';
  if (data.session) return 'signed-in';
  return (data.user.identities?.length ?? 0) === 0 ? 'exists' : 'confirm';
}

/** The sign-up form's message for {@link SignUpOutcome} `exists`. */
export const ACCOUNT_EXISTS_MESSAGE = 'An account with this email already exists. Sign in instead.';
