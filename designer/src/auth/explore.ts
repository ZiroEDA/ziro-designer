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
 * The full-page sign-up (or sign-in) in a new tab. This tab stays as it is -
 * a demo with edits in it is still there - and becomes signed in once the new
 * tab has the account's keys (AuthProvider's `onSiblingKeyReady`; see
 * {@link gateView} for why it does not wall meanwhile). `noopener`: the new tab
 * shares nothing with this one but the origin, so it lands on the project
 * manager once through, not on a copy of this tab's route.
 */
export function goToAuth(
  aStep: AuthStep = 'signup',
  aOpen: (aUrl: string, aTarget: string, aFeatures: string) => unknown = (u, t, f) =>
    window.open(u, t, f),
): void {
  aOpen(`/${aStep}`, '_blank', 'noopener');
}

/** What AuthGate draws, from the auth state; see {@link gateView}. */
export interface GateView {
  /** `splash` and `wall` replace the app; `app` mounts it. */
  view: 'splash' | 'wall' | 'app';
  /** Whether the wall puts itself in the address (`/signup`, `/unlock`, ...). */
  routeToWall: boolean;
  /** The `signedOutHere` flag to carry into the next render. */
  signedOutHere: boolean;
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
}

/**
 * AuthGate's decision, kept apart from it so it can be tested: AuthGate itself
 * pulls in the Supabase client.
 *
 * The wall stands for two reasons. No session, on a route that needs one - a
 * signed-out visitor is otherwise in. And a session whose master key is not in
 * this tab: everything encrypted is unreadable until the password opens it, and
 * a new account's recovery key has to be seen before anything else.
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
  const gated =
    s.authEnabled &&
    !s.loading &&
    !waitingForSibling &&
    (s.hasSession
      ? s.recovering || s.keyState === 'locked' || s.keyState === 'none' || s.pendingRecoveryKey
      : !s.explorable);
  if (s.authEnabled && (s.loading || settling))
    return { view: 'splash', routeToWall: false, signedOutHere };
  if (gated) return { view: 'wall', routeToWall: true, signedOutHere };
  return { view: 'app', routeToWall: false, signedOutHere };
}
