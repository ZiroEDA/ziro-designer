// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { authEnabled } from './supabaseClient.js';
import { useAuth } from './AuthProvider.js';
import { SignInDialog } from './SignIn.js';
import { useRoute } from '../nav/useRoute.js';
import { HOME, type Route } from '../nav/route.js';

/**
 * Sign-in wall. When Supabase auth is configured, the app is gated behind a
 * sign-in: visitors must create an account (or sign in) before they can use it.
 * To show what they're signing up for, the real editor is rendered blurred and
 * inert behind the sign-in panel, the KiCad-like UI is right there, just out of
 * reach until you're in.
 *
 * (Guest-first entry was tried earlier but backfired, almost nobody signed in,
 * so the value of an account never landed. This puts the account up front while
 * still previewing the product behind the glass.)
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

/** Where the visitor was heading before the wall replaced the address. */
const DEST_KEY = 'ziro.postAuthRoute';

function rememberDestination(route: Route): void {
  // An auth route is not a destination; remembering one would restore the wall.
  if (route.kind === 'auth') return;
  try {
    sessionStorage.setItem(DEST_KEY, JSON.stringify(route));
  } catch {
    // Private browsing, or storage disabled. Signing in then lands on home,
    // which is a worse landing but not a broken one.
  }
}

function takeDestination(): Route | null {
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

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { session, loading } = useAuth();
  const { route, navigate } = useRoute();
  // Whether this mount has already sent a signed-in visitor onward, so the
  // restore runs once rather than on every render while the session settles.
  const restored = useRef(false);

  const gated = authEnabled && !loading && !session;

  // Signed out: put the wall in the address, keeping where they were headed.
  useEffect(() => {
    if (!gated || route.kind === 'auth') return;
    rememberDestination(route);
    navigate({ kind: 'auth', step: 'signup' }, { replace: true });
  }, [gated, route, navigate]);

  // Signed in while standing on the wall: go where they were headed.
  useEffect(() => {
    if (!session || restored.current) return;
    if (route.kind !== 'auth') return;
    restored.current = true;
    navigate(takeDestination() ?? HOME, { replace: true });
  }, [session, route, navigate]);

  // Hold the first paint while an existing session resolves, so a signed-in
  // user doesn't flash the wall on every reload.
  if (authEnabled && loading) {
    return (
      <div className="ze-auth">
        <div className="ze-auth-splash">ZiroEDA...</div>
      </div>
    );
  }

  if (gated) {
    return (
      <div className="ze-auth-gate">
        <div className="ze-auth-gate-app" aria-hidden="true">
          {children}
        </div>
        <SignInDialog
          gate
          step={route.kind === 'auth' ? route.step : 'signup'}
          onStep={(step) => navigate({ kind: 'auth', step })}
        />
      </div>
    );
  }

  return <>{children}</>;
}
