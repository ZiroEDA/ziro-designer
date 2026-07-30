import type { JSX, ReactNode } from 'react';
import { authEnabled } from './supabaseClient.js';
import { useAuth } from './AuthProvider.js';
import { SignInDialog } from './SignIn.js';

/**
 * Sign-in wall. When Supabase auth is configured, the app is gated behind a
 * sign-in: visitors must create an account (or sign in) before they can use it.
 * To show what they're signing up for, the real editor is rendered blurred and
 * inert behind the centred sign-in card, the KiCad-like UI is right there,
 * just out of reach until you're in.
 *
 * (Guest-first entry was tried earlier but backfired, almost nobody signed in,
 * so the value of an account never landed. This puts the account up front while
 * still previewing the product behind the glass.)
 *
 * When auth is disabled (no Supabase env vars) the app runs fully offline and
 * this gate is a passthrough.
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { session, loading } = useAuth();

  // Hold the first paint while an existing session resolves, so a signed-in
  // user doesn't flash the wall on every reload.
  if (authEnabled && loading) {
    return (
      <div className="ze-auth">
        <div className="ze-auth-splash">Ziro Designer…</div>
      </div>
    );
  }

  if (authEnabled && !session) {
    return (
      <div className="ze-auth-gate">
        <div className="ze-auth-gate-app" aria-hidden="true">
          {children}
        </div>
        <SignInDialog gate />
      </div>
    );
  }

  return <>{children}</>;
}
