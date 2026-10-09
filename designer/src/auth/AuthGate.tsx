// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { authEnabled } from './supabaseClient.js';
import { useAuth } from './AuthProvider.js';
import {
  closeIfOpenedByApp,
  explorerMayVisit,
  gateView,
  rememberDestination,
  takeDestination,
} from './explore.js';
import { GateBackdrop } from './GateBackdrop.js';
import { SignInDialog } from './SignIn.js';
import { useRoute } from '../nav/useRoute.js';
import { HOME, type AuthStep } from '../nav/route.js';

/**
 * Sign-in wall. When Supabase auth is configured, a visitor with no account is
 * IN the app (#639, the way EasyEDA does it): the project manager, the demos and
 * the tools, nothing kept. The wall is for what needs an account - a project in
 * one (`/p/<uid>`), and creating or keeping anything, which opens the
 * full-page `/signup` in a new tab (auth/explore.ts `goToAuth`). The manager's chrome is
 * rendered blurred and inert behind the sign-in panel (GateBackdrop - NOT the
 * real app, which would load the project).
 *
 * (Guest-first entry was tried before, as a guest who could create projects on
 * this device, and almost nobody signed in: the account never meant anything.
 * Here an account is the ONLY way to create or keep a project, so it does.)
 *
 * ### The wall is in the address, like everywhere else in the app
 *
 * `/signup`, `/signin` and `/verify` are real routes, so the step you are on
 * survives a reload and Back moves between them. Two things that took care:
 *
 *  - **Where you were heading is remembered, not encoded.** Landing on
 *    `/p/<uid>/pcb` signed out replaces the address with `/signup` and puts the
 *    project route in `sessionStorage`; signing in restores it. It is not a
 *    `?next=` parameter, because a redirect target that arrives in the URL is
 *    an open-redirect waiting to be pointed somewhere else.
 *  - **`replace`, never push, on the way in.** The destination must not become
 *    a Back target: pressing Back from `/signup` would land on a project the
 *    visitor cannot open, which bounces straight back to `/signup`.
 *
 * When auth is disabled (no Supabase env vars) the app runs fully offline and
 * this gate is a passthrough.
 */

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { session, loading, keyState, opening, pendingRecoveryKey, recovering, signOut } =
    useAuth();
  const { route, navigate } = useRoute();
  // Whether this mount has already sent a signed-in visitor onward, so the
  // restore runs once rather than on every render while the session settles.
  const restored = useRef(false);
  // In the app signed out at some point, until an account is all the way
  // through: see `gateView`.
  const signedOutHere = useRef(false);
  const g = gateView({
    authEnabled,
    loading,
    hasSession: !!session,
    keyState,
    pendingRecoveryKey: pendingRecoveryKey !== null,
    recovering,
    explorable: explorerMayVisit(route),
    signedOutHere: signedOutHere.current,
    opening,
  });
  signedOutHere.current = g.signedOutHere;
  const wallStep: AuthStep = !session ? 'signup' : recovering ? 'recover' : 'recovery-key';

  // No key anywhere for this session: out, in this browser only (see gateView).
  useEffect(() => {
    if (g.signOutHere) void signOut('local');
  }, [g.signOutHere, signOut]);

  // Walled: put the wall in the address, keeping where they were headed.
  useEffect(() => {
    if (!g.routeToWall || route.kind === 'auth') return;
    rememberDestination(route);
    navigate({ kind: 'auth', step: wallStep }, { replace: true });
  }, [g.routeToWall, route, navigate, wallStep]);

  // Through the wall while standing on it: go where they were headed.
  useEffect(() => {
    if (!session || g.view !== 'app' || restored.current) return;
    if (route.kind !== 'auth') return;
    restored.current = true;
    // Opened by one of our tabs for this sign-up (#639): that tab is signed in
    // now too, so go back to it and close. A browser may refuse the close, so
    // carry on regardless; a tab that did close never shows it.
    closeIfOpenedByApp();
    navigate(takeDestination() ?? HOME, { replace: true });
  }, [session, g.view, route, navigate]);

  // Hold the first paint while an existing session resolves, and while its
  // keys are being asked for, so a signed-in user doesn't flash the wall on
  // every reload.
  if (g.view === 'splash') {
    return (
      <div className="ze-auth">
        <div className="ze-auth-splash">ZiroEDA...</div>
      </div>
    );
  }

  if (g.view === 'wall') {
    return (
      <div className="ze-auth-gate">
        {/* Not `children`. The manager behind the glass used to be the real
            one, which loaded the project and put its file names in the DOM
            under a CSS blur - readable with devtools before any password. The
            backdrop is the same chrome with nothing in it; the app mounts only
            once the wall is down. */}
        <div className="ze-auth-gate-app" aria-hidden="true">
          <GateBackdrop />
        </div>
        <SignInDialog
          gate
          step={route.kind === 'auth' ? route.step : wallStep}
          onStep={(step) => navigate({ kind: 'auth', step })}
        />
      </div>
    );
  }

  return <>{children}</>;
}
