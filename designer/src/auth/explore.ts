// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Signed out, you are in the app (#639), the way EasyEDA does it.
 *
 * A visitor with no account lands in the project manager and can open the
 * demos (GitHub projects later) and the standalone tools, and play with them -
 * nothing is kept. Anything that makes or keeps a project opens the full-page
 * sign-up (`/signup`) in a NEW tab, as EasyEDA does: the tab they were in keeps
 * what they had open, and turns signed-in when the new tab has the keys. A
 * project in an account (`/p/<uid>`) is behind the wall.
 */
import { HOME, type AuthStep, type Route } from '../nav/route.js';

/**
 * Where a visitor with no account may be: everything that needs no account -
 * home, the demos, the standalone tools. Not a project in an account, and not
 * the wall itself.
 */
export function explorerMayVisit(aRoute: Route): boolean {
  return aRoute.kind === 'home' || aRoute.kind === 'demo' || aRoute.kind === 'tool';
}

/** Where the visitor was heading before the wall replaced the address. */
const DEST_KEY = 'ziro.postAuthRoute';

export function rememberDestination(route: Route): void {
  // An auth route is not a destination; remembering one would restore the wall.
  if (route.kind === 'auth') return;
  try {
    sessionStorage.setItem(DEST_KEY, JSON.stringify(route));
  } catch {
    // Private browsing, or storage disabled. Signing in then lands on home,
    // which is a worse landing but not a broken one.
  }
}

export function takeDestination(): Route | null {
  try {
    const raw = sessionStorage.getItem(DEST_KEY);
    sessionStorage.removeItem(DEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Route;
    // Shape-checked, not trusted: it has been through storage, and a malformed
    // value would be handed to the router as if it were a place.
    return parsed && typeof parsed === 'object' && typeof parsed.kind === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The full-page sign-up (or sign-in) in a new tab, as EasyEDA does it. This
 * tab stays as it is - a demo with edits in it is still there - and becomes
 * signed in once the new tab has the account's keys (AuthProvider's
 * `onSiblingKeyReady`; see {@link gateView} for why it does not wall
 * meanwhile). The new tab keeps its `opener`, so once through it can hand the
 * visitor back here and close: {@link closeIfOpenedByApp}.
 */
export function goToAuth(
  aStep: AuthStep = 'signup',
  aOpen: (aUrl: string, aTarget: string) => unknown = (u, t) => window.open(u, t),
): void {
  aOpen(`/${aStep}`, '_blank');
}

/** The part of `window` {@link closeIfOpenedByApp} uses. */
export interface OpenedWindow {
  opener: { location: { origin: string }; closed: boolean; focus(): void } | null;
  location: { origin: string };
  close(): void;
}

/**
 * The sign-up tab, all the way through: back to the tab that opened it, and
 * close, as EasyEDA's does. Only when that tab is one of OURS - same origin,
 * still open. A sign-up reached any other way (a link on the marketing site, a
 * typed address) is the visitor's tab to keep. Returns whether it tried.
 */
export function closeIfOpenedByApp(
  aWin: OpenedWindow = window as unknown as OpenedWindow,
): boolean {
  let opener: OpenedWindow['opener'];
  try {
    opener = aWin.opener;
    // Reading a cross-origin opener's location throws: not ours.
    if (!opener || opener.closed || opener.location.origin !== aWin.location.origin) return false;
  } catch {
    return false;
  }
  opener.focus();
  aWin.close();
  return true;
}

/** What AuthGate draws, from the auth state; see {@link gateView}. */
export interface GateView {
  /** `splash` and `wall` replace the app; `app` mounts it. */
  view: 'splash' | 'wall' | 'app';
  /** Whether the wall puts itself in the address (`/signup`, `/unlock`, ...). */
  routeToWall: boolean;
  /** The `signedOutHere` flag to carry into the next render. */
  signedOutHere: boolean;
  /**
   * Sign this tab out (locally): it has a session but no key in the tab, on
   * the device or in a sibling, and there is no unlock step any more - the
   * sign-in it falls back to is one step, and opens the account.
   */
  signOutHere: boolean;
}

export interface GateState {
  authEnabled: boolean;
  loading: boolean;
  hasSession: boolean;
  keyState: 'absent' | 'loading' | 'none' | 'locked' | 'unlocked';
  pendingRecoveryKey: boolean;
  recovering: boolean;
  /** `explorerMayVisit` of the current route. */
  explorable: boolean;
  /**
   * This tab has been in the app signed out, and its session has not been all
   * the way through yet. Carried from the previous render.
   */
  signedOutHere: boolean;
  /** AuthProvider's `opening`: this tab's sign-in or sign-up is making keys. */
  opening: boolean;
}

/**
 * AuthGate's decision, kept apart from it so it can be tested: AuthGate itself
 * pulls in the Supabase client.
 *
 * The wall stands for no session on a route that needs one - a signed-out
 * visitor is otherwise in - and for the two signed-in steps that remain: a new
 * account's recovery key, and recovery from a reset link. A session whose key
 * cannot be found anywhere (tab, device, sibling) is not walled: there is no
 * unlock step (#639), so the tab signs itself out and is a signed-out tab.
 *
 * Except in a tab that was in the app signed out when the session arrived: the
 * account was signed up or in from the new tab `goToAuth` opened, and that tab
 * shows the recovery key and holds the keys. Here the keys arrive from it a
 * moment later (`none` while it is still storing them, `locked` until it
 * answers, `loading` in between). Walling meanwhile would replace the app - and
 * the demo with its edits - for a password this person has just typed in the
 * other tab. So on a route a visitor may see anyway, this tab stays the app
 * until the keys come, and only then is it an ordinary signed-in tab.
 */
export function gateView(s: GateState): GateView {
  let signedOutHere = s.signedOutHere;
  // Not while the stored session is still being read: every tab starts with no
  // session for a moment, and a returning user's tab must still meet its wall.
  if (!s.hasSession && !s.loading) signedOutHere = s.explorable || signedOutHere;
  else if (s.keyState === 'unlocked') signedOutHere = false;

  const waitingForSibling =
    s.hasSession && signedOutHere && s.explorable && !s.recovering && !s.pendingRecoveryKey;
  const settling = s.hasSession && s.keyState === 'loading' && !waitingForSibling;
  // The form that is signing in stays, busy, for the seconds Argon2id takes:
  // the session lands half-way, and neither the splash nor a sign-out belongs
  // there.
  if (s.hasSession && s.opening)
    return { view: 'wall', routeToWall: false, signedOutHere, signOutHere: false };

  const keyless =
    s.authEnabled &&
    s.hasSession &&
    (s.keyState === 'locked' || s.keyState === 'none') &&
    !s.recovering &&
    !s.pendingRecoveryKey &&
    !waitingForSibling;
  const gated =
    s.authEnabled &&
    !s.loading &&
    (s.hasSession ? s.recovering || s.pendingRecoveryKey : !s.explorable);
  if (s.authEnabled && (s.loading || settling || keyless))
    return { view: 'splash', routeToWall: false, signedOutHere, signOutHere: keyless };
  if (gated) return { view: 'wall', routeToWall: true, signedOutHere, signOutHere: false };
  return { view: 'app', routeToWall: false, signedOutHere, signOutHere: false };
}
