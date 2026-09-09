// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useState, type FormEvent, type JSX } from 'react';
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

  const { signIn, signUp, resendSignupCode, verifyOtp } = useAuth();
  // Controlled by the route when the gate owns it, local otherwise. One `step`
  // drives everything below, so the address and the form cannot disagree.
  const [localStep, setLocalStep] = useState<AuthStep>(gate ? 'signup' : 'signin');
  const step = stepProp ?? localStep;
  const setStep = onStep ?? setLocalStep;
  // 'verify' is reached only from 'signup', so it shows the sign-up side.
  // 'recover' has no screen yet -- the recovery key cannot be checked until the
  // wrapped key attributes are stored server-side -- so a typed `/recover`
  // lands on sign-in rather than on a form that cannot finish.
  const mode: 'signup' | 'signin' = step === 'signup' || step === 'verify' ? 'signup' : 'signin';
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

  const strength = passwordStrength(password);

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
      setError('The two passwords do not match.');
      return;
    }
    if (strength.score < 2) {
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
        aria-label={mode === 'signup' ? 'Create an account' : 'Sign in'}
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
                : 'Sign in to ZiroEDA'}
          </div>
        </div>

        {codeSent && (
          <form onSubmit={onVerify}>
            <p className="ze-auth-note">
              We sent a 6-digit code to <strong>{email}</strong>. Enter it to finish creating your
              account.
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
              {busy ? 'Creating account...' : 'Create account'}
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

        {!codeSent && mode === 'signin' && (
          <form onSubmit={onSignIn}>
            {emailField}
            {passwordField}
            {error && <div className="ze-auth-error">{error}</div>}
            <button type="submit" className="ze-btn primary ze-auth-submit" disabled={busy}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
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

/**
 * A deliberately simple strength estimate: length first, then how many
 * character classes appear.
 *
 * Not a dictionary check — a real one (zxcvbn and friends) is a ~400 kB word
 * list, which is a lot of bundle for a hint. This catches the cases that
 * actually matter here (short, single-class) and the copy beside it does the
 * rest of the work by explaining *why* the password matters.
 */
function passwordStrength(password: string): Strength {
  if (!password) return { score: 0, label: '' };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (classes >= 2) score += 1;
  if (classes >= 3 && password.length >= 10) score += 1;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] ?? '' };
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
