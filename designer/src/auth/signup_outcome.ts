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

/**
 * The sign-up form's message for {@link SignUpOutcome} `exists`: the
 * reference's `email_already_registered`, set on the email field.
 */
export const ACCOUNT_EXISTS_MESSAGE = 'Email already registered';

/**
 * Supabase's refused-password error, as the sign-in form shows it. Also what an
 * account from before encryption (2026-09-10) gets with its RIGHT password: the
 * server still holds that password, while sign-in now sends the login secret
 * derived from it (`loginSecret`). It cannot be retried with the raw password -
 * for an encrypted account that would hand the server the key's root - so the
 * form says how such an account gets in: one password reset, which needs no
 * recovery key because the account has no keys yet (`completeRecovery`).
 */
export const INCORRECT_PASSWORD_MESSAGE = 'Incorrect password or email not registered';

/**
 * A request that never reached the server, in plain words. Each browser says it its own way -
 * Firefox "NetworkError when attempting to fetch resource. (<host>)", Chrome "Failed to fetch",
 * Safari "Load failed" - and every one of them read as the app being broken.
 */
export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach ZiroEDA's server. Check your internet connection and try again.";

/** What an auth call's error says to the person who made it. */
export function describeAuthError(aMessage: string): string {
  if (/invalid login credentials/i.test(aMessage)) return INCORRECT_PASSWORD_MESSAGE;

  if (
    /NetworkError when attempting to fetch|Failed to fetch|Load failed|fetch failed/i.test(aMessage)
  )
    return NETWORK_ERROR_MESSAGE;

  return aMessage;
}
