// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Opening a share link.
 *
 * The app has no router — there is one page and everything is in-app state — so
 * a link to a project has to arrive as a query parameter and be dealt with at
 * startup. `?join=<token>` is that parameter.
 *
 * ### Why the token is taken out of the address bar immediately
 *
 * Until it is redeemed the token *is* the credential: anyone holding it can
 * take the role the link grants. Left in the address bar it is bookmarked,
 * screenshotted, pasted into a chat to ask "is this the right link?", and kept
 * in browser history on a shared machine. Stripping it the moment it is read
 * costs nothing and removes all of that. (After redemption it is worth little:
 * access is the membership row from then on, and revoking someone means
 * deleting that row, not rotating the link.)
 *
 * ### Why it is stashed rather than redeemed on the spot
 *
 * Redeeming requires a session, and the person following the link usually has
 * none — that is rather the point of sharing. So the token has to survive:
 *
 *  - a sign-in or a sign-up, including the email round trip;
 *  - **an OAuth redirect**, which is the one that forces the issue.
 *    `signInWithGoogle` sends the browser to `window.location.origin`, and the
 *    origin has no query string, so a token still sitting in the URL is gone by
 *    the time the session exists.
 *
 * `sessionStorage` rather than `localStorage`: the redirect returns to the same
 * tab, so it survives exactly as long as it must and no longer. A token left in
 * `localStorage` outlives the visit, on a machine that may not be the reader's.
 */

import type { CloudBackend } from './backend.js';

/** The query parameter a share link carries. */
export const INVITE_PARAM = 'join';

/** Where the token waits while the reader signs in. */
const STASH_KEY = 'ziro.pendingInvite';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

/**
 * The token in a URL, and the same URL without it.
 *
 * Pure, and separate from anything that touches the document, so the parsing
 * and the stripping can be tested without a browser — which is the half that
 * has to be right, because getting it wrong either leaks the token or loses it.
 */
export function inviteTokenIn(href: string): { token: string | null; cleaned: string } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { token: null, cleaned: href };
  }
  const raw = url.searchParams.get(INVITE_PARAM);
  if (!raw) return { token: null, cleaned: href };

  url.searchParams.delete(INVITE_PARAM);
  // `toString()` leaves a bare "?" behind when that was the only parameter,
  // which is a visible difference in the address bar for no reason.
  const cleaned = url.searchParams.size === 0 ? url.href.replace(/\?(?=#|$)/, '') : url.href;

  // Shape-checked, not trusted: the value came off a URL, and it is about to be
  // put in storage and later sent to the database. A token is a uuid; anything
  // else is a typo or a probe, and stashing it would only produce a confusing
  // failure later, well away from the link that caused it.
  const token = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
  return { token, cleaned };
}

/**
 * Read a share token out of the current URL, remember it, and clean the address
 * bar. Returns the token, or null when the URL carries none.
 *
 * Safe to call more than once: a URL with no token leaves an already-stashed
 * one alone, so a re-render cannot lose an invite that is waiting for a sign-in.
 */
export function captureInviteFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const { token, cleaned } = inviteTokenIn(window.location.href);
  if (!token) return pendingInvite();
  try {
    window.sessionStorage.setItem(STASH_KEY, token);
  } catch {
    // Private browsing, or storage disabled. The invite can still be redeemed
    // in this page load; it just will not survive a sign-in redirect.
  }
  // `replaceState`, not `pushState`: the link should not become a Back target
  // that puts the token straight back into the URL.
  window.history.replaceState(window.history.state, '', cleaned);
  return token;
}

/** The token waiting for a session, if any. */
export function pendingInvite(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(STASH_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STASH_KEY);
  } catch {
    /* nothing to clear if it could not be written either */
  }
}

/**
 * Redeem the waiting invite, if there is one and the backend can.
 *
 * Cleared whatever happens. A token is one use of a door: on success it has
 * been spent, and on failure — expired, revoked, addressed to a different
 * email — retrying it on every sign-in for the life of the tab would report the
 * same thing forever. The caller says so once, and the user asks for a new link.
 *
 * Returns what was joined, so the caller can say which project appeared; null
 * when there was nothing to redeem.
 */
export async function redeemPendingInvite(
  backend: CloudBackend | null,
): Promise<{ uid: string; role: ProjectRole } | null> {
  const token = pendingInvite();
  if (!token) return null;
  // No backend, or a deployment without the membership migration: leave the
  // token where it is. Nothing has been attempted, so nothing has been spent,
  // and the next load with a working backend can still use it.
  if (!backend?.redeemInvite) return null;

  clearPendingInvite();
  const joined = await backend.redeemInvite(token);
  if (!joined) return null;
  const role = joined.role;
  return {
    uid: joined.project_uid,
    role: role === 'owner' || role === 'editor' ? role : 'viewer',
  };
}
