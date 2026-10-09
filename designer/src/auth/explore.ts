// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Signed out, you are in the app (#639), the way EasyEDA does it.
 *
 * A visitor with no account lands in the project manager and can open the
 * demos (GitHub projects later) and the standalone tools, and play with them -
 * nothing is kept. Anything that makes or keeps a project sends them to the
 * full-page sign-up (`/signup`), and signing up brings them back where they
 * were. A project in an account (`/p/<uid>`) is behind the wall.
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
 * Off to the full-page sign-up (or sign-in) from inside the app, to come back
 * to `aFrom` once through. Pushed, not replaced: Back from the wall returns to
 * where they were, which a signed-out visitor may be.
 */
export function goToAuth(
  aNavigate: (aRoute: Route) => void,
  aFrom: Route,
  aStep: AuthStep = 'signup',
): void {
  rememberDestination(aFrom);
  aNavigate({ kind: 'auth', step: aStep });
}

/** What AuthGate draws, from the auth state; see {@link gateView}. */
export interface GateView {
  /** `splash` and `wall` replace the app; `app` mounts it. */
  view: 'splash' | 'wall' | 'app';
  /** Whether the wall puts itself in the address (`/signup`, `/unlock`, ...). */
  routeToWall: boolean;
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
}

/**
 * AuthGate's decision, kept apart from it so it can be tested: AuthGate itself
 * pulls in the Supabase client.
 *
 * The wall stands for two reasons. No session, on a route that needs one - a
 * signed-out visitor is otherwise in. And a session whose master key is not in
 * this tab: everything encrypted is unreadable until the password opens it, and
 * a new account's recovery key has to be seen before anything else.
 */
export function gateView(s: GateState): GateView {
  const settling = s.hasSession && s.keyState === 'loading';
  const gated =
    s.authEnabled &&
    !s.loading &&
    (s.hasSession
      ? s.recovering || s.keyState === 'locked' || s.keyState === 'none' || s.pendingRecoveryKey
      : !s.explorable);
  if (s.authEnabled && (s.loading || settling)) return { view: 'splash', routeToWall: false };
  if (gated) return { view: 'wall', routeToWall: true };
  return { view: 'app', routeToWall: false };
}
