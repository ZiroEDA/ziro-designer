// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Delete account - the reference's `DeleteAccount.tsx` (ente), step for step.
 *
 *  1. "Why are you leaving?" - a reason from the fixed list and a free-text
 *     "Anything else?", both required (`delete_account_form.ts`). Continue.
 *  2. "Permanently delete your account?" - a back arrow, a summary of what
 *     goes (loaded from the server; a failed load shows "Couldn't load your
 *     data counts" with Try again, and the checkbox stays disabled until it
 *     has loaded), the acknowledgement checkbox, and the critical button.
 *  3. Password. ente opens its `AuthenticateUser` mini dialog over the top
 *     ("Password" / "Authenticate"); here it is the card's third step, same
 *     title, same button, since a modal over a modal is the one thing the
 *     app's dialog stack does not do.
 *
 * Then the provider does what ente's `onSubmit` does after authentication:
 * proves it to the server, deletes, logs out.
 *
 * Every surface here is the auth card's own: the same `.ze-auth-*` rules the
 * sign-in wall uses, the shared Combo, the shared checkbox row, the shared
 * button. The one colour is `--critical`, which is ente's.
 */
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { cloudBackend } from '../cloud/cloudStore.js';
import { Combo } from '../ui/Combo.js';
import { useModalEscape } from '../ui/useModalEscape.js';
import { DELETE_REASONS, validateDeleteAccountForm } from './delete_account_form.js';

type Step = 'reason' | 'confirmation' | 'password';
type Summary = { projects: number; people: number };
type SummaryPhase = { state: 'loading' } | { state: 'ready'; summary: Summary } | { state: 'failed' };

export function DeleteAccountDialog({
  email,
  onClose,
  onDelete,
  loadSummary = defaultLoadSummary,
}: {
  /** The signed-in address, for the password manager (ente's hidden email input). */
  email: string;
  onClose: () => void;
  /** `AuthContextValue.deleteAccount`. Resolves with the error to show, or null. */
  onDelete: (password: string, reason: string, feedback: string) => Promise<{ error: string | null }>;
  /** `/users/deletion-summary`; injectable so a test needs no backend. */
  loadSummary?: () => Promise<Summary>;
}): JSX.Element {
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [touched, setTouched] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPhase>({ state: 'loading' });

  useModalEscape(onClose, !busy);

  const load = useCallback(async () => {
    setSummary({ state: 'loading' });
    try {
      setSummary({ state: 'ready', summary: await loadSummary() });
    } catch {
      setSummary({ state: 'failed' });
    }
  }, [loadSummary]);

  useEffect(() => {
    if (step === 'confirmation') void load();
  }, [step, load]);

  const errors = validateDeleteAccountForm({ reason, feedback });
  const canConfirm = summary.state === 'ready' && accepted;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (step === 'reason') {
      setTouched(true);
      if (errors.reason || errors.feedback) return;
      setStep('confirmation');
      return;
    }
    if (step === 'confirmation') {
      if (!canConfirm) return;
      setStep('password');
      return;
    }
    if (!password) return;
    setBusy(true);
    const { error: failed } = await onDelete(password, reason, feedback.trim());
    setBusy(false);
    if (failed) setError(failed);
    // On success the provider has signed out and the account is gone; the
    // dialog is unmounted with everything else that needed a session.
  };

  const back = () => {
    setError(null);
    if (step === 'password') {
      setPassword('');
      setStep('confirmation');
    } else {
      setAccepted(false);
      setStep('reason');
    }
  };

  const title =
    step === 'reason'
      ? 'Why are you leaving?'
      : step === 'confirmation'
        ? 'Permanently delete your ZiroEDA account?'
        : 'Password';
  // ente: "This helps us improve Ente." / "One account across Photos, Auth,
  // and Locker." - the second is about their three apps; ours says what the
  // one account holds. The password step has no subtitle there either.
  const subtitle =
    step === 'reason'
      ? 'This helps us improve ZiroEDA.'
      : step === 'confirmation'
        ? 'Your projects, and the access you have given others, go with it.'
        : null;

  return (
    <div className="ze-modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <form
        className="ze-auth-card ze-auth-modal ze-delete-account"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
        role="dialog"
        aria-label="Delete account"
      >
        {!busy && (
          <span className="ze-auth-close" title="Close" onClick={onClose}>
            ✕
          </span>
        )}
        <div className="ze-delete-account-head">
          {step !== 'reason' && (
            <button
              type="button"
              className="ze-btn ze-delete-account-back"
              aria-label="Back"
              disabled={busy}
              onClick={back}
            >
              ←
            </button>
          )}
          <div>
            <div className="ze-auth-title">{title}</div>
            {subtitle && <div className="ze-auth-sub">{subtitle}</div>}
          </div>
        </div>

        {step === 'reason' && (
          <>
            <label className="ze-auth-field" htmlFor="ze-delete-reason">
              <span>
                Reason for leaving <b className="ze-required">*</b>
              </span>
              <Combo
                id="ze-delete-reason"
                ariaLabel="Reason for leaving"
                value={reason}
                onChange={setReason}
                options={[{ value: '', label: 'Select a reason', disabled: true }, ...DELETE_REASONS]}
              />
              {touched && errors.reason && <div className="ze-auth-error">{errors.reason}</div>}
            </label>
            <label className="ze-auth-field">
              <span>
                Anything else? <b className="ze-required">*</b>
              </span>
              <textarea
                rows={5}
                value={feedback}
                placeholder="Share your feedback here"
                onChange={(e) => setFeedback(e.target.value)}
              />
              {touched && errors.feedback && <div className="ze-auth-error">{errors.feedback}</div>}
            </label>
            <button type="submit" className="ze-btn primary ze-auth-submit">
              Continue
            </button>
          </>
        )}

        {step === 'confirmation' && (
          <>
            <div className="ze-delete-account-summary" aria-live="polite">
              {summary.state === 'loading' && <div className="ze-auth-note">Loading...</div>}
              {summary.state === 'failed' && (
                <>
                  <div className="ze-auth-error">
                    Couldn't load your data counts. Try again to review what will be deleted.
                  </div>
                  <button type="button" className="ze-btn" onClick={() => void load()}>
                    Try again
                  </button>
                </>
              )}
              {summary.state === 'ready' && (
                <>
                  <SummaryRow count={summary.summary.projects} one="project" other="projects" />
                  <SummaryRow
                    count={summary.summary.people}
                    one="person loses access"
                    other="people lose access"
                  />
                </>
              )}
            </div>
            <label className="ze-check">
              <input
                type="checkbox"
                checked={accepted}
                disabled={summary.state !== 'ready'}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>I understand this deletes my account and all its data.</span>
            </label>
            <button
              type="submit"
              className="ze-btn ze-auth-submit ze-critical"
              disabled={!canConfirm}
            >
              Delete ZiroEDA account
            </button>
          </>
        )}

        {step === 'password' && (
          <>
            <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
            <label className="ze-auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <div className="ze-auth-error">{error}</div>}
            <button
              type="submit"
              className="ze-btn primary ze-auth-submit"
              disabled={busy || !password}
            >
              {busy ? 'Deleting...' : 'Authenticate'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

/** One line of the summary: `{{count, number}} photo & video` in ente. */
function SummaryRow({ count, one, other }: { count: number; one: string; other: string }) {
  return (
    <div className="ze-delete-account-row">
      <b>{count.toLocaleString()}</b> {count === 1 ? one : other}
    </div>
  );
}

async function defaultLoadSummary(): Promise<Summary> {
  const be = cloudBackend();
  if (!be?.accountDeletionSummary) throw new Error('no backend');
  return be.accountDeletionSummary();
}
