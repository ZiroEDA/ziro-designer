// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { MessageDialogOk } from '../ui/dialog_message.js';
import { RecoveryKeyContents } from './RecoveryKeyContents.js';
import { useAuth } from './AuthProvider.js';
import { useModalEscape } from '../ui/useModalEscape.js';
import { ZiroLogo } from '../ui/ZiroLogo.js';
import type { AuthStep } from '../nav/route.js';

/**
 * Sign-in / sign-up. **Email and password, and nothing else.**
 *
 * ### Why there is no "Continue with Google", and no passwordless code
 *
 * Both used to be here, and both were removed for the same reason: they create
 * accounts that have no password. The end-to-end encryption derives a
 * key-encryption-key from the password and wraps the account's master key with
 * it (`docs/encryption-design.md`), so an account created by OAuth or by an
 * emailed code has no root of its own — its master key can only ever be held by
 * a recovery key, and half the accounts end up on a different key hierarchy
 * from the other half. One way in means one hierarchy.
 *
 * A 6-digit code is still emailed, but only to *confirm the address* at sign-up.
 * It is never a way to sign in.
 *
 * ### Sign-up and sign-in are two modes of one form
 *
 * Not because the split is nice, but because a password makes it unavoidable:
 * the server cannot be asked "does this email exist" without handing anyone an
 * email-enumeration oracle, so it cannot decide for us. The answer comes from
 * the sign-up attempt itself — Supabase refuses an address that is already
 * registered, and that error is shown on the email field, which is exactly how
 * the reference implementation resolves it.
 *
 * `gate` mode (AuthGate) makes it a required wall: no close button, backdrop
 * clicks don't dismiss it, and it opens on **sign-up**, because a visitor who
 * has hit the wall is usually new. Otherwise it's an optional modal opened from
 * the project manager, which opens on sign-in.
 */
/** Where the address being verified waits, so `/verify` survives a reload. */
const PENDING_EMAIL_KEY = 'ziro.pendingSignupEmail';

export function SignInDialog({
  onClose,
  gate = false,
  step: stepProp,
  onStep,
}: {
  onClose?: () => void;
  gate?: boolean;
  /**
   * The step to show, when something above owns it.
   *
   * The gate passes the one in the address (`/signup`, `/signin`, `/verify`) so
   * the step survives a reload and Back moves between the steps. The in-app
   * modal passes neither and keeps the step in local state — it is not a place
   * you can link to, so it has no business in the address.
   */
  step?: AuthStep;
  onStep?: (step: AuthStep) => void;
}): JSX.Element {
  const close = onClose ?? ((): void => {});

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Gate mode is the exception: it has no Cancel button
  // and no dismissable backdrop, so there is nothing for Esc to press - the
  // same reason a wxDialog with SetEscapeId( wxID_NONE ) ignores the key.
  useModalEscape(close, !gate);

  const {
    session,
    signIn,
    signUp,
    signOut,
    unlock,
    resendSignupCode,
    verifyOtp,
    pendingRecoveryKey,
    acknowledgeRecoveryKey,
    keyState,
    recovering,
    requestPasswordReset,
    completeRecovery,
  } = useAuth();
  // Controlled by the route when the gate owns it, local otherwise. One `step`
  // drives everything below, so the address and the form cannot disagree.
  const [localStep, setLocalStep] = useState<AuthStep>(gate ? 'signup' : 'signin');
  const step = stepProp ?? localStep;
  const setStep = onStep ?? setLocalStep;
  // 'verify' is reached only from 'signup', so it shows the sign-up side.
  // 'unlock' and 'recovery-key' are the signed-in half of the wall: the
  // session is there, the keys are not in this tab yet (or the recovery key
  // is waiting to be read), and the address says which. See AuthGate.
  // 'recover' is two screens under one address: asking for the email that a
  // reset link goes to, and - once that link has opened the app with a session
  // marked for recovery - the new password, with the recovery key beside it
  // when the account has keys to unwrap.
  const mode: 'signup' | 'signin' | 'unlock' | 'recovery-key' | 'recover' =
    step === 'signup' || step === 'verify'
      ? 'signup'
      : step === 'unlock'
        ? 'unlock'
        : step === 'recovery-key'
          ? 'recovery-key'
          : step === 'recover'
            ? 'recover'
            : 'signin';
  const codeSent = step === 'verify';
  // `/verify` is a real address, so it can be reloaded or reached by Back — and
  // the code is verified against the address it was sent to, which lived only
  // in React state. Kept for the tab, so a reload on the verify step can still
  // finish; sessionStorage rather than local because it is one sign-up, not a
  // fact about this machine.
  const [email, setEmail] = useState<string>(() => {
    if (step !== 'verify') return '';
    try {
      return sessionStorage.getItem(PENDING_EMAIL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = usePasswordStrength(password);
  const [noRecoveryKey, setNoRecoveryKey] = useState(false);

  const run = async (fn: () => Promise<{ error: string | null }>): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) setError(error);
      return !error;
    } finally {
      setBusy(false);
    }
  };

  async function onSignUp(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    // Scored at submit through the loader itself, so a submit that beats the
    // dictionaries to the page is judged, not refused for a meter still blank.
    if ((await loadZxcvbn())(password).score < 2) {
      setError('Please choose a stronger password.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error, needsConfirm } = await signUp(email, password);
      if (error) setError(error);
      else if (needsConfirm) {
        try {
          sessionStorage.setItem(PENDING_EMAIL_KEY, email);
        } catch {
          // Storage disabled: the step still works in this page load, it just
          // cannot survive a reload.
        }
        setStep('verify');
      } else close();
    } finally {
      setBusy(false);
    }
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    if (await run(() => signIn(email, password))) close();
  }

  async function onUnlock(e: FormEvent) {
    e.preventDefault();
    if (await run(() => unlock(password))) close();
  }

  const [recoveryKeyText, setRecoveryKeyText] = useState('');
  const [resetSent, setResetSent] = useState(false);
  async function onRequestReset(e: FormEvent) {
    e.preventDefault();
    if (await run(() => requestPasswordReset(email))) setResetSent(true);
  }
  async function onCompleteRecovery(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    // Scored at submit through the loader itself, so a submit that beats the
    // dictionaries to the page is judged, not refused for a meter still blank.
    if ((await loadZxcvbn())(password).score < 2) {
      setError('Please choose a stronger password.');
      return;
    }
    if (
      await run(() =>
        completeRecovery(password, keyState === 'none' ? null : recoveryKeyText.trim() || null),
      )
    )
      close();
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!(await run(() => verifyOtp(email, code.trim())))) return;
    try {
      sessionStorage.removeItem(PENDING_EMAIL_KEY);
    } catch {
      /* nothing to clear if it could not be written either */
    }
    close();
  }

  const emailField = (
    <label className="ze-auth-field">
      <span>Email</span>
      <input
        type="email"
        autoComplete="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </label>
  );

  const passwordField = (
    <label className="ze-auth-field">
      <span>Password</span>
      <input
        type="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
    </label>
  );

  return (
    <div
      className={`ze-modal-backdrop${gate ? ' ze-auth-gate-scrim ze-auth-split' : ''}`}
      onMouseDown={gate ? undefined : close}
    >
      <div
        className={`ze-auth-card ze-auth-modal${gate ? ' ze-auth-panel' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={
          mode === 'signup'
            ? 'Create an account'
            : mode === 'unlock'
              ? 'Unlock your account'
              : mode === 'recovery-key'
                ? 'Your recovery key'
                : mode === 'recover'
                  ? 'Recover account'
                  : 'Sign in'
        }
      >
        {!gate && (
          <span className="ze-auth-close" title="Close" onClick={close}>
            ✕
          </span>
        )}
        <div className="ze-auth-head">
          <ZiroLogo size={52} />
          <div className="ze-auth-title">
            {/* The brand belongs in this line rather than as a second wordmark
                under the mark: the logo is an abstract glyph, so without the
                name the screen never says what the account is FOR. One line,
                one place. */}
            {codeSent
              ? 'Confirm your email'
              : mode === 'signup'
                ? 'Create your free ZiroEDA account'
                : mode === 'unlock'
                  ? 'Unlock your ZiroEDA account'
                  : mode === 'recovery-key'
                    ? 'Recovery key'
                    : mode === 'recover'
                      ? 'Recover account'
                      : 'Sign in to ZiroEDA'}
          </div>
        </div>

        {codeSent && (
          <form onSubmit={onVerify}>
            <p className="ze-auth-note">
              We sent a 6-digit code to <strong>{email}</strong>. Please check your inbox (and spam)
              to complete verification.
            </p>
            <label className="ze-auth-field">
              <span>Code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-btn primary ze-auth-submit" disabled={busy}>
              {busy ? 'Verifying...' : 'Confirm'}
            </button>
            <div className="ze-auth-toggle">
              <button
                type="button"
                className="ze-auth-switch"
                disabled={busy}
                onClick={() => void run(() => resendSignupCode(email))}
              >
                Resend code
              </button>
            </div>
          </form>
        )}

        {!codeSent && mode === 'signup' && (
          <form onSubmit={onSignUp}>
            {emailField}
            {passwordField}
            {password && <PasswordStrengthHint strength={strength} />}
            <label className="ze-auth-field">
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-btn primary ze-auth-submit" disabled={busy}>
              {busy ? 'Generating encryption keys...' : 'Create account'}
            </button>
            <p className="ze-auth-note ze-auth-warn">
              Your password encrypts your projects. We cannot reset it or read your designs without
              it.
            </p>
            <div className="ze-auth-toggle">
              Already have an account?{' '}
              <button
                type="button"
                className="ze-auth-switch"
                onClick={() => {
                  setError(null);
                  setStep('signin');
                }}
              >
                Sign in
              </button>
            </div>
          </form>
        )}

        {mode === 'unlock' && (
          <form onSubmit={onUnlock}>
            <p className="ze-auth-note">
              Signed in as <strong>{session?.user.email}</strong>. Your projects are encrypted;
              enter your password to open them in this tab.
            </p>
            <label className="ze-auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-btn primary ze-auth-submit" disabled={busy}>
              {busy ? 'Unlocking...' : 'Unlock'}
            </button>
            <div className="ze-auth-toggle">
              <button
                type="button"
                className="ze-auth-switch"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStep('recover');
                }}
              >
                Forgot password
              </button>
            </div>
            <div className="ze-auth-toggle">
              Not you?{' '}
              <button
                type="button"
                className="ze-auth-switch"
                disabled={busy}
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </form>
        )}
        {mode === 'recovery-key' && pendingRecoveryKey && (
          <RecoveryKeyContents
            recoveryKey={pendingRecoveryKey}
            onLater={() => {
              acknowledgeRecoveryKey();
              close();
            }}
          />
        )}
        {mode === 'recover' && !recovering && (
          <form onSubmit={onRequestReset}>
            {resetSent ? (
              <p className="ze-auth-note">
                If <strong>{email}</strong> has an account, a reset link is on its way. Open it on
                this device to choose a new password.
              </p>
            ) : (
              <>
                <p className="ze-auth-note">
                  We will email you a link to set a new password. Your projects stay encrypted: to
                  open them under the new password you will also need your recovery key.
                </p>
                {emailField}
                {error && <div className="ze-auth-error">{error}</div>}
                <button type="submit" className="ze-btn primary ze-auth-submit" disabled={busy}>
                  {busy ? 'Sending...' : 'Send reset link'}
                </button>
              </>
            )}
            <div className="ze-auth-toggle">
              <button
                type="button"
                className="ze-auth-switch"
                onClick={() => {
                  setError(null);
                  setResetSent(false);
                  setStep('signin');
                }}
              >
                Back to sign in
              </button>
            </div>
          </form>
        )}
        {mode === 'recover' && recovering && (
          <form onSubmit={onCompleteRecovery}>
            <p className="ze-auth-note">
              {keyState !== 'none'
                ? 'Enter the recovery key you saved when you created your account, and choose a new password.'
                : `Choose a new password for ${session?.user.email}.`}
            </p>
            {keyState !== 'none' && (
              <label className="ze-auth-field">
                <span>Recovery key</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your 24-word recovery key"
                  required
                  autoFocus
                  value={recoveryKeyText}
                  onChange={(e) => setRecoveryKeyText(e.target.value)}
                />
              </label>
            )}
            <label className="ze-auth-field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                autoFocus={keyState === 'none'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {password && <PasswordStrengthHint strength={strength} />}
            <label className="ze-auth-field">
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-btn primary ze-auth-submit" disabled={busy}>
              {busy ? 'Generating encryption keys...' : 'Recover'}
            </button>
            {keyState !== 'none' && (
              <div className="ze-auth-toggle">
                <button
                  type="button"
                  className="ze-auth-switch"
                  onClick={() => setNoRecoveryKey(true)}
                >
                  No recovery key?
                </button>
              </div>
            )}
          </form>
        )}
        {noRecoveryKey && (
          // The reference design's answer, word for word, because there is no
          // kinder true one: the server holds nothing that could decrypt the
          // data, which is the whole promise, and this is its price.
          <MessageDialogOk
            caption="Sorry"
            message="Due to the nature of our end-to-end encryption protocol, your data cannot be decrypted without your password or recovery key"
            onClose={() => setNoRecoveryKey(false)}
          />
        )}
        {!codeSent && mode === 'signin' && (
          <form onSubmit={onSignIn}>
            {emailField}
            {passwordField}
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-btn primary ze-auth-submit" disabled={busy}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
            <div className="ze-auth-toggle">
              <button
                type="button"
                className="ze-auth-switch"
                onClick={() => {
                  setError(null);
                  setStep('recover');
                }}
              >
                Forgot password?
              </button>
            </div>
            <div className="ze-auth-toggle">
              New to ZiroEDA?{' '}
              <button
                type="button"
                className="ze-auth-switch"
                onClick={() => {
                  setError(null);
                  setStep('signup');
                }}
              >
                Create an account
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface Strength {
  /** 0 (unusable) to 4 (strong). Below 2 is refused at sign-up. */
  score: number;
  label: string;
}

/** What the reference design shows: its three bands, on zxcvbn's score. */
function strengthOf(score: number): Strength {
  return score < 2
    ? { score, label: 'Password strength: Weak' }
    : score < 3
      ? { score, label: 'Password strength: Moderate' }
      : { score, label: 'Password strength: Strong' };
}

/**
 * zxcvbn, as the reference design uses it (weak under 2, moderate under 3),
 * and loaded only once a password is being typed: its English dictionaries are
 * a few hundred kilobytes that a sign-in has no use for, so they are a
 * separate chunk that the sign-up form pulls in on the first keystroke. Until
 * it arrives the meter says nothing rather than something wrong; the submit
 * still refuses a score under 2 once it has.
 */
type Zxcvbn = (password: string) => { score: number };
let zxcvbnLoaded: Promise<Zxcvbn> | null = null;
function loadZxcvbn(): Promise<Zxcvbn> {
  zxcvbnLoaded ??= Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en'),
  ]).then(([core, common, en]) => {
    const z = new core.ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...en.dictionary },
      graphs: common.adjacencyGraphs,
      translations: en.translations,
    });
    return (pw: string) => z.check(pw);
  });
  return zxcvbnLoaded;
}

function usePasswordStrength(password: string): Strength {
  const [fn, setFn] = useState<Zxcvbn | null>(null);
  useEffect(() => {
    if (!password || fn) return;
    let live = true;
    void loadZxcvbn().then((f) => {
      if (live) setFn(() => f);
    });
    return () => {
      live = false;
    };
  }, [password, fn]);
  if (!password) return { score: 0, label: '' };
  if (!fn) return { score: 0, label: '' };
  return strengthOf(fn(password).score);
}

function PasswordStrengthHint({ strength }: { strength: Strength }): JSX.Element {
  return (
    <div className="ze-auth-strength" data-score={strength.score}>
      <div className="ze-auth-strength-bar">
        <span style={{ width: `${(strength.score / 4) * 100}%` }} />
      </div>
      <span className="ze-auth-strength-label">{strength.label}</span>
    </div>
  );
}
