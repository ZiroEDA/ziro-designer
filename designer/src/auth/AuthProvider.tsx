// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { authEnabled, supabase } from './supabaseClient.js';
import { setProjectOwner } from '../home/projectStore.js';

export interface SignUpResult {
  error: string | null;
  /** True when signup succeeded but email confirmation is required before a session exists. */
  needsConfirm: boolean;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  /** OAuth sign-in (redirect flow), e.g. "Continue with Google". */
  signInWithGoogle: () => Promise<{ error: string | null }>;
  /** Passwordless: email a 6-digit sign-in code (creates the account if new). */
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  /** Verify the emailed code; a session starts on success. */
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  // Only "loading" while we resolve an existing session from Supabase.
  const [loading, setLoading] = useState<boolean>(authEnabled);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setProjectOwner(data.session?.user.id ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Keep the project store's idea of the account in step, so a sign-out
      // followed by a different sign-in cannot push the previous person's work.
      setProjectOwner(next?.user.id ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      async signIn(email, password) {
        if (!supabase) return { error: 'Auth is not configured.' };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      async signUp(email, password) {
        if (!supabase) return { error: 'Auth is not configured.', needsConfirm: false };
        const { data, error } = await supabase.auth.signUp({ email, password });
        const needsConfirm = !error && !!data.user && !data.session;
        return { error: error?.message ?? null, needsConfirm };
      },
      async signOut() {
        if (!supabase) return;
        await supabase.auth.signOut();
      },
      async signInWithGoogle() {
        if (!supabase) return { error: 'Auth is not configured.' };
        // Redirect flow: local (IndexedDB) work survives the round trip, and
        // sign-in sync pushes it to the cloud once the session lands.
        //
        // Back to `href`, not `origin`. Returning someone to the bare origin
        // throws away wherever they were, and the case that makes it a bug
        // rather than a wrinkle is a share link: `?p=<project>` is the whole
        // content of the URL somebody followed, and sending them to the origin
        // after they sign in loses the project they were trying to open.
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.href },
        });
        return { error: error?.message ?? null };
      },
      async sendOtp(email) {
        if (!supabase) return { error: 'Auth is not configured.' };
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        });
        return { error: error?.message ?? null };
      },
      async verifyOtp(email, token) {
        if (!supabase) return { error: 'Auth is not configured.' };
        const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
        return { error: error?.message ?? null };
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
