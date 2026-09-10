// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { authEnabled, supabase } from './supabaseClient.js';
import { setProjectOwner } from '../home/projectStore.js';
import {
  createAccount,
  decodeRecoveryKey,
  encodeRecoveryKey,
  loginSecret,
  rewrapWithNewPassword,
  unlockWithMasterKey,
  unlockWithPassword,
  unlockWithRecoveryKey,
  type AccountKeys,
  type WrappedAccount,
} from '../cloud/crypto.js';
import {
  fetchWrappedAccount,
  forgetMasterKey,
  recallMasterKey,
  rememberMasterKey,
  storeWrappedAccount,
} from './account_keys.js';
import { askSiblingsForMasterKey, serveMasterKey } from './tab_keys.js';
import { setSessionKeys } from '../cloud/session_keys.js';
import { setLocalVaultFromMasterKey } from '../home/local_vault.js';
import { sealLocalStore } from '../home/projectStore.js';

export interface SignUpResult {
  error: string | null;
  /** True when signup succeeded but email confirmation is required before a session exists. */
  needsConfirm: boolean;
}

/**
 * Where the account's keys are, beside the session.
 *
 * A session says who you are to the server. It says nothing about whether the
 * master key is in this tab, and everything encrypted depends on that. So the
 * two are tracked apart:
 *
 *   - `loading`   the session exists; whether keys are stored is being asked.
 *   - `none`      the session exists and the server has no keys for it: a
 *                 sign-up that ended before its keys were stored, or an account
 *                 from before encryption. Key setup runs on the next password.
 *   - `locked`    keys are stored and the master key is not in this tab: a new
 *                 tab, or a session the browser restored. The password opens it.
 *   - `unlocked`  the master key is in hand.
 *   - `absent`    no session (or auth is off): nothing to say.
 */
export type KeyState = 'absent' | 'loading' | 'none' | 'locked' | 'unlocked';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  /** See {@link KeyState}. */
  keyState: KeyState;
  /** The unlocked account's keys, while `keyState` is `unlocked`. */
  keys: AccountKeys | null;
  /**
   * The recovery key, spelled for a human, until it has been acknowledged.
   *
   * Set once, right after the keys are created, and shown by the wall before
   * anything else — it is the only way back into the account's data without
   * the password, and there is no second chance to write it down.
   */
  pendingRecoveryKey: string | null;
  acknowledgeRecoveryKey: () => void;
  /**
   * The unlocked account's recovery key, spelled out, for showing again: the
   * reference design offers it from settings for exactly the person who chose
   * "Do this later" at sign-up. Null while the account is not unlocked.
   */
  recoveryKeyMnemonic: () => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  /** Open a `locked` account with its password, or set up a `none` one. */
  unlock: (password: string) => Promise<{ error: string | null }>;
  /**
   * A forgotten password, in two halves that answer two different questions.
   *
   * The server's question is "is this your address?", and its own reset link
   * answers it: `requestPasswordReset` sends one, and the link opens the app
   * with a session marked for recovery (`recovering`). The data's question is
   * "can you open the master key?", and only the recovery key answers that -
   * the server holds nothing that could. `completeRecovery` takes both the
   * new password and the recovery key, unwraps the master key with the latter,
   * re-wraps the SAME master key under the former, and gives the server the
   * new login secret. An account that has no keys yet (one from before
   * encryption, or a sign-up that never stored them) needs no recovery key:
   * there is nothing to unwrap, so keys are made fresh.
   */
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  /** True from the moment a reset link opened the app until recovery completes. */
  recovering: boolean;
  /**
   * Leave the reset without finishing it: the password came back to mind, or
   * the link was a mistake. The session the link made is a real one, so the
   * wall goes on to ask for the password as it would for any restored session.
   */
  cancelRecovery: () => void;
  completeRecovery: (
    newPassword: string,
    recoveryKey: string | null,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /**
   * Re-send the 6-digit code that confirms a new account's email address.
   *
   * There is no passwordless *sign-in*: a code only ever proves the address at
   * sign-up. Every account has a password, because the password is what the
   * end-to-end encryption derives its key-encryption-key from — an account
   * created without one would have no root to wrap its master key with. See
   * `docs/encryption-design.md`.
   */
  resendSignupCode: (email: string) => Promise<{ error: string | null }>;
  /** Verify the emailed sign-up code; a session starts on success. */
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Supabase's wording for a refused password, with the fact it hides restored. */
const describe = (message: string): string =>
  /invalid login credentials/i.test(message)
    ? 'Incorrect password or email not registered'
    : message;

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  // Only "loading" while we resolve an existing session from Supabase.
  const [loading, setLoading] = useState<boolean>(authEnabled);
  const [keyState, setKeyState] = useState<KeyState>('absent');
  const [keys, setKeys] = useState<AccountKeys | null>(null);
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  /**
   * A sign-up's keys, made while the address is being confirmed.
   *
   * Creating the keys is the slow part (Argon2id at SENSITIVE limits: seconds),
   * and it needs nothing from the server, so it starts the moment sign-up is
   * submitted and is usually done by the time the code has been typed. It is
   * kept here, not in state, because nothing renders it — it is consumed once,
   * when the session exists to store it under.
   */
  const pendingSetup = useRef<{
    email: string;
    made: Promise<{ keys: AccountKeys; wrapped: WrappedAccount }>;
  } | null>(null);

  const open = useCallback(async (unlocked: AccountKeys, userId: string) => {
    rememberMasterKey(unlocked.masterKey);
    // The sync layer is not React: hand it the keys the same moment. And the
    // local store's vault key is derived from the master key, so the store
    // opens with the account and seals whatever it still holds in the clear.
    setSessionKeys(unlocked, userId);
    await setLocalVaultFromMasterKey(unlocked.masterKey);
    setKeys(unlocked);
    setKeyState('unlocked');
    void sealLocalStore().catch((e) => console.warn('local store not sealed:', e));
  }, []);

  /**
   * Store a freshly made account's keys under the session, open it, and queue
   * the recovery key for the wall to show.
   */
  const finishSetup = useCallback(
    async (userId: string, made: { keys: AccountKeys; wrapped: WrappedAccount }) => {
      if (!supabase) return;
      await storeWrappedAccount(supabase, userId, made.wrapped);
      setPendingRecoveryKey(await encodeRecoveryKey(made.keys.recoveryKey));
      await open(made.keys, userId);
    },
    [open],
  );

  /**
   * Where the keys are for this session: stored or not, and in this tab or not.
   *
   * Runs on every session change. A sign-up whose keys are still being made
   * is left to `verifyOtp`/`signUp`, which will store them; asking the server
   * now would answer `none` and set up a second, different set.
   */
  const settleKeys = useCallback(
    async (next: Session | null) => {
      if (!supabase || !next) {
        // No session, so the key in this tab is of no use and should not
        // outlive it: a sign-out in another tab ends here too.
        forgetMasterKey();
        setKeyState('absent');
        setKeys(null);
        setSessionKeys(null);
        void setLocalVaultFromMasterKey(null);
        return;
      }
      if (pendingSetup.current) return;
      setKeyState('loading');
      try {
        const wrapped = await fetchWrappedAccount(supabase, next.user.id);
        if (!wrapped) {
          setKeyState('none');
          return;
        }
        // This tab's own copy first; failing that, a sibling tab's. Only when
        // neither has it does the wall ask for the password.
        const masterKey = recallMasterKey() ?? (await askSiblingsForMasterKey(next.user.id));
        if (!masterKey) {
          setKeyState('locked');
          return;
        }
        await open(await unlockWithMasterKey(masterKey, wrapped), next.user.id);
      } catch (err) {
        // A stale or foreign key in the tab, or the network: the password can
        // always open it, so `locked` is the honest answer, not an error.
        console.warn('Account keys:', err);
        forgetMasterKey();
        setSessionKeys(null);
        void setLocalVaultFromMasterKey(null);
        setKeyState('locked');
      }
    },
    [open],
  );

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setProjectOwner(data.session?.user.id ?? null);
      setLoading(false);
      void settleKeys(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Keep the project store's idea of the account in step, so a sign-out
      // followed by a different sign-in cannot push the previous person's work.
      setProjectOwner(next?.user.id ?? null);
      setLoading(false);
      // The reset link: a session that exists to set a new password, and
      // nothing else until it has. The keys are still asked for, so the wall
      // knows whether to ask for the recovery key.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      // A token refresh is the same session and the same keys.
      if (event !== 'TOKEN_REFRESHED') void settleKeys(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [settleKeys]);

  // While open, answer a new tab of this origin that asks for the key, so it
  // opens without the password. Closed (sign-out, lock) unregisters.
  const userId = session?.user.id;
  useEffect(() => {
    if (!keys || !userId) return;
    return serveMasterKey(userId, keys.masterKey);
  }, [keys, userId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      keyState,
      keys,
      pendingRecoveryKey,
      acknowledgeRecoveryKey: () => setPendingRecoveryKey(null),
      recoveryKeyMnemonic: async () => (keys ? encodeRecoveryKey(keys.recoveryKey) : null),
      async signIn(email, password) {
        if (!supabase) return { error: 'Auth is not configured.' };
        // The server is given a value derived from the password, never the
        // password: see `loginSecret`. It can check it and recover nothing.
        const secret = await loginSecret(email, password);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: secret });
        if (error) return { error: describe(error.message) };
        const userId = data.user?.id;
        if (!userId) return { error: 'Signed in without a session.' };
        try {
          const wrapped = await fetchWrappedAccount(supabase, userId);
          if (wrapped) {
            // The server accepted the login secret, so the password is right and
            // this unwrap cannot fail on it; if it does, the row is damaged, and
            // that is worth seeing rather than "wrong password".
            await open(await unlockWithPassword(password, wrapped), userId);
          } else {
            // A sign-up that ended before its keys were stored, or an account
            // from before encryption: make them now, under the same password.
            await finishSetup(userId, await createAccount(password));
          }
          return { error: null };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
      async signUp(email, password) {
        if (!supabase) return { error: 'Auth is not configured.', needsConfirm: false };
        const secret = await loginSecret(email, password);
        const { data, error } = await supabase.auth.signUp({ email, password: secret });
        if (error) return { error: error.message, needsConfirm: false };
        // Start on the keys now; the code is going to take a while to arrive.
        const made = createAccount(password).catch((err: unknown) => {
          throw new Error(
            /cannot derive/.test(String(err))
              ? "Your browser was unable to generate a strong key that meets ZiroEDA's encryption standards, please try another browser"
              : String(err),
          );
        });
        pendingSetup.current = { email, made };
        const needsConfirm = !!data.user && !data.session;
        if (!needsConfirm && data.user) {
          // Confirmation is off on this server: the session is here already.
          try {
            await finishSetup(data.user.id, await made);
          } finally {
            pendingSetup.current = null;
          }
        }
        return { error: null, needsConfirm };
      },
      async unlock(password) {
        if (!supabase || !session) return { error: 'Not signed in.' };
        try {
          const wrapped = await fetchWrappedAccount(supabase, session.user.id);
          if (wrapped) await open(await unlockWithPassword(password, wrapped), session.user.id);
          else await finishSetup(session.user.id, await createAccount(password));
          return { error: null };
        } catch {
          // The AEAD tag did not verify: the only way that happens with the
          // stored row intact is the wrong password.
          return { error: 'Incorrect password' };
        }
      },
      async requestPasswordReset(email) {
        if (!supabase) return { error: 'Auth is not configured.' };
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/recover`,
        });
        return { error: error?.message ?? null };
      },
      recovering,
      cancelRecovery: () => setRecovering(false),
      async completeRecovery(newPassword, recoveryKeyText) {
        if (!supabase || !session?.user.email) return { error: 'Not signed in.' };
        const userId = session.user.id;
        try {
          const wrapped = await fetchWrappedAccount(supabase, userId);
          let unlocked: AccountKeys;
          let next: WrappedAccount;
          let fresh = false;
          if (wrapped) {
            if (!recoveryKeyText) return { error: 'Recovery key is required' };
            let recoveryKey: Uint8Array;
            try {
              recoveryKey = await decodeRecoveryKey(recoveryKeyText);
              unlocked = await unlockWithRecoveryKey(recoveryKey, wrapped);
            } catch {
              return { error: 'Incorrect recovery key' };
            }
            // The SAME master key, under the new password.
            next = await rewrapWithNewPassword(unlocked.masterKey, newPassword, wrapped);
          } else {
            const made = await createAccount(newPassword);
            unlocked = made.keys;
            next = made.wrapped;
            fresh = true;
          }
          // Keys first, then the server's password. The other order can leave
          // a server that accepts the new password beside a wrap only the old
          // one opens; this order at worst leaves the old login secret beside
          // a new wrap, and the reset link can simply be used again.
          await storeWrappedAccount(supabase, userId, next);
          const { error } = await supabase.auth.updateUser({
            password: await loginSecret(session.user.email, newPassword),
          });
          if (error) return { error: error.message };
          if (fresh) setPendingRecoveryKey(await encodeRecoveryKey(unlocked.recoveryKey));
          await open(unlocked, userId);
          setRecovering(false);
          return { error: null };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
      async signOut() {
        if (!supabase) return;
        forgetMasterKey();
        setSessionKeys(null);
        void setLocalVaultFromMasterKey(null);
        setKeys(null);
        setKeyState('absent');
        setPendingRecoveryKey(null);
        setRecovering(false);
        pendingSetup.current = null;
        await supabase.auth.signOut();
      },
      async resendSignupCode(email) {
        if (!supabase) return { error: 'Auth is not configured.' };
        const { error } = await supabase.auth.resend({ type: 'signup', email });
        return { error: error?.message ?? null };
      },
      async verifyOtp(email, token) {
        if (!supabase) return { error: 'Auth is not configured.' };
        // `signup`, not `email`: this code confirms a newly created account's
        // address rather than standing in for a password.
        const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
        if (error) return { error: error.message };
        const pending = pendingSetup.current;
        const userId = data.user?.id;
        if (pending && userId) {
          try {
            await finishSetup(userId, await pending.made);
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          } finally {
            pendingSetup.current = null;
          }
        } else if (userId) {
          // The keys were being made in another tab, or the page was reloaded on
          // the verify step and the password is gone with it: the wall will ask
          // for it and set up then.
          void settleKeys(data.session);
        }
        return { error: null };
      },
    }),
    [
      session,
      loading,
      keyState,
      keys,
      pendingRecoveryKey,
      recovering,
      open,
      finishSetup,
      settleKeys,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
