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

/**
 * The parameter an ordinary share link carries: the project's own id.
 *
 * This is the Figma / Google Docs shape, and it is the one to reach for. The
 * URL *addresses* the project; what a link is worth is a setting on the
 * project (`projects.link_access`), not something encoded in the URL. Nothing
 * here is a secret to be spent, so there is nothing to strip, stash or explain
 * afterwards -- the machinery below exists only for `?join`, and only because a
 * token genuinely is a secret sitting in an address bar.
 */
export const PROJECT_PARAM = 'p';

/** The query parameter an *invitation* link carries: a one-time token. */
export const INVITE_PARAM = 'join';

/** Where the token waits while the reader signs in. */
const STASH_KEY = 'ziro.pendingInvite';

/**
 * Where the *project* a link named waits while the reader signs in.
 *
 * `localStorage`, not `sessionStorage`, and that difference is deliberate. The
 * invite token is a secret, so it is kept for exactly one tab and no longer.
 * A project id is an address, and the flow it has to survive is worse: an
 * emailed magic link can open a **new tab**, where a session store is empty.
 * The exposure is a project id sitting in one browser for half an hour, which
 * is what the address bar would have held anyway.
 */
const LINK_KEY = 'ziro.pendingProjectLink';

/**
 * How long a remembered link stays worth acting on.
 *
 * Long enough for a sign-up with an emailed code, short enough that a link
 * followed and abandoned last week does not silently join a project the next
 * time somebody signs in on that machine.
 */
const LINK_TTL_MS = 30 * 60 * 1000;

export type ProjectRole = 'owner' | 'editor' | 'viewer';

/** A uuid, as it appears in a URL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The project a `?p=<uid>` link names, or null.
 *
 * Deliberately left in the address bar. It is the project's address, the way
 * `/file/<key>` is in Figma -- a person who has opened a project expects to be
 * able to reload, bookmark and send that URL, and stripping it would break all
 * three for no gain. What the link is *worth* is revocable on the project.
 */
export function projectLinkIn(href: string): string | null {
  try {
    const raw = new URL(href).searchParams.get(PROJECT_PARAM);
    return raw && UUID.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The link to send somebody, for a project and the page this app is served
 * from.
 *
 * Built from `origin + pathname`, dropping whatever query and hash happen to be
 * on the current URL. Copying the address bar instead would hand out whatever
 * was in it — another project's `?p=`, a `?join=` token, a demo parameter —
 * which is how a share button quietly shares the wrong thing.
 */
export function shareUrlFor(uid: string, base?: string): string {
  const href = base ?? (typeof window === 'undefined' ? '' : window.location.href);
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}?${PROJECT_PARAM}=${uid}`;
  } catch {
    return `?${PROJECT_PARAM}=${uid}`;
  }
}

/**
 * Write down the project the current URL names, so signing in cannot lose it.
 *
 * **Called before the Supabase client is constructed**, from `supabaseClient.ts`,
 * because the client is what destroys the evidence. `detectSessionInUrl` reads
 * the auth fragment and then rewrites the address bar, and Supabase itself
 * falls back to the project's configured Site URL -- which carries no query --
 * whenever the `redirectTo` it was handed is not in the allow-list. Either way
 * `?p=<uid>` is gone by the time a session exists, and the app is left showing
 * whatever project that account happened to have open last.
 *
 * This was the bug: sharing was tested by generating a link, and following one
 * only ever failed *after* a sign-in, which is the one path no test covered.
 * `redirectTo: window.location.href` was necessary and nowhere near sufficient.
 *
 * Idempotent, and a URL with no link leaves an already-remembered one alone.
 */
export function rememberProjectLink(): string | null {
  if (typeof window === 'undefined') return null;
  const uid = projectLinkIn(window.location.href);
  if (!uid) return pendingProjectLink();
  try {
    window.localStorage.setItem(LINK_KEY, JSON.stringify({ uid, at: Date.now() }));
  } catch {
    // Private browsing, or storage disabled. The link still works in this page
    // load; it just will not survive a sign-in that navigates.
  }
  return uid;
}

/** The project a link named, if one is still waiting and recent enough. */
export function pendingProjectLink(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LINK_KEY);
    if (!raw) return null;
    const { uid, at } = JSON.parse(raw) as { uid?: string; at?: number };
    if (typeof uid !== 'string' || !UUID.test(uid)) return null;
    if (typeof at !== 'number' || Date.now() - at > LINK_TTL_MS) return null;
    return uid;
  } catch {
    return null;
  }
}

export function clearPendingProjectLink(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LINK_KEY);
  } catch {
    /* nothing to clear if it could not be written either */
  }
}

/**
 * Claim whatever project link this visit is carrying.
 *
 * The URL first, then what was remembered before the sign-in took the URL
 * apart. Cleared once acted on, successfully or not: a link that the database
 * refuses will be refused identically forever, and re-attempting it on every
 * sign-in would put the same message in front of somebody who needs a new
 * link, not a reminder.
 */
export async function openProjectLink(
  backend: CloudBackend | null,
): Promise<{ uid: string; role: ProjectRole } | null> {
  if (typeof window === 'undefined') return null;
  const uid = projectLinkIn(window.location.href) ?? pendingProjectLink();
  if (!uid) return null;
  // No backend, or a deployment without the migration: leave it remembered.
  // Nothing was attempted, so the next load can still act on it.
  if (!backend?.openByLink) return null;

  clearPendingProjectLink();
  const role = await backend.openByLink(uid);
  if (!role) return null;
  return { uid, role: role === 'owner' || role === 'editor' ? role : 'viewer' };
}

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
  const token = UUID.test(raw) ? raw : null;
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
