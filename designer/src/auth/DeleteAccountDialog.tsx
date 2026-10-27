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
 * The surface is the shared dialog every ported KiCad dialog is made of:
 * `.ze-modal` with its header, a body laid out as a wxFormBuilder column
 * (each item bordered `--wx-border`), and `StdDialogButtons` for the footer
 * with the step's affirmative in the OK slot and ente's Back on the left.
 * The controls are the shared ones - Combo, entry, textarea, `.ze-check` - so
 * nothing here states a font, a colour or a size; the dialog's width is its
 * sizer's over the widest control, which is the reason list. The one colour
 * is `--critical`, which is ente's.
 */
import { Button, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { cloudBackend } from '../cloud/cloudStore.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { DELETE_REASONS, validateDeleteAccountForm } from './delete_account_form.js';

type Step = 'reason' | 'confirmation' | 'password';
type Summary = { projects: number; people: number };
type SummaryPhase =
  | { state: 'loading' }
  | { state: 'ready'; summary: Summary }
  | { state: 'failed' };

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
  onDelete: (
    password: string,
    reason: string,
    feedback: string,
  ) => Promise<{ error: string | null }>;
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

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
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

  const okLabel =
    step === 'reason'
      ? 'Continue'
      : step === 'confirmation'
        ? 'Delete ZiroEDA account'
        : 'Authenticate';
  const okDisabled =
    busy || (step === 'confirmation' && !canConfirm) || (step === 'password' && !password);

  return (
    <DialogShim
      title={title}
      // Nothing closes it while a delete is in flight: the close box and Escape wait.
      onClose={() => {
        if (!busy) onClose();
      }}
      className="ze-delete-account"
    >
      <form onSubmit={(e) => void submit(e)}>
        {/* bMainSizer: a wxFormBuilder column, each item bordered 5 as KiCad's are, the entries
            wxEXPAND; at least the reference's dialog wide - ente's MUI "xs" - so a label and a
            reason fit on a line rather than the narrowest control deciding the width. */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxALL} border={5} minSize={[444, -1]}>
            <BoxSizer orient={wxVERTICAL}>
              {subtitle && (
                <SizerItem flag={wxALL} border={5}>
                  <StaticText label={subtitle} wrap={420} />
                </SizerItem>
              )}

              {step === 'reason' && (
                <>
                  <SizerItem flag={wxTOP | wxLEFT | wxRIGHT} border={5}>
                    <label htmlFor="ze-delete-reason">
                      Reason for leaving <b className="ze-required">*</b>
                    </label>
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALL} border={5}>
                    <Combo
                      id="ze-delete-reason"
                      ariaLabel="Reason for leaving"
                      value={reason}
                      onChange={setReason}
                      options={[
                        { value: '', label: 'Select a reason', disabled: true },
                        ...DELETE_REASONS,
                      ]}
                    />
                  </SizerItem>
                  {touched && errors.reason && (
                    <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
                      <span className="ze-delete-account-error">{errors.reason}</span>
                    </SizerItem>
                  )}
                  <SizerItem flag={wxTOP | wxLEFT | wxRIGHT} border={5}>
                    <label htmlFor="ze-delete-feedback">
                      Anything else? <b className="ze-required">*</b>
                    </label>
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} minSize={[-1, 120]}>
                    <TextCtrl
                      multiLine
                      id="ze-delete-feedback"
                      value={feedback}
                      hint="Share your feedback here"
                      onChange={setFeedback}
                    />
                  </SizerItem>
                  {touched && errors.feedback && (
                    <SizerItem flag={wxLEFT | wxRIGHT | wxBOTTOM} border={5}>
                      <span className="ze-delete-account-error">{errors.feedback}</span>
                    </SizerItem>
                  )}
                </>
              )}

              {step === 'confirmation' && (
                <>
                  <SizerItem flag={wxALL} border={5}>
                    <div aria-live="polite">
                      {summary.state === 'loading' && <StaticText label="Loading..." />}
                      {summary.state === 'failed' && (
                        <span className="ze-delete-account-error">
                          Couldn't load your data counts. Try again to review what will be deleted.
                        </span>
                      )}
                      {summary.state === 'ready' && (
                        <>
                          <SummaryRow
                            count={summary.summary.projects}
                            one="project"
                            other="projects"
                          />
                          <SummaryRow
                            count={summary.summary.people}
                            one="person loses access"
                            other="people lose access"
                          />
                        </>
                      )}
                    </div>
                  </SizerItem>
                  {summary.state === 'failed' && (
                    <SizerItem flag={wxLEFT | wxRIGHT | wxBOTTOM} border={5}>
                      <Button label="Try again" onClick={() => void load()} />
                    </SizerItem>
                  )}
                  <SizerItem flag={wxALL} border={5}>
                    <CheckBox
                      label="I understand this deletes my account and all its data."
                      checked={accepted}
                      disabled={summary.state !== 'ready'}
                      onChange={(aChecked) => setAccepted(aChecked)}
                    />
                  </SizerItem>
                </>
              )}

              {step === 'password' && (
                <>
                  {/* The address, for the password manager (ente's hidden email input). */}
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    value={email}
                    readOnly
                    hidden
                  />
                  <SizerItem flag={wxTOP | wxLEFT | wxRIGHT} border={5}>
                    <label htmlFor="ze-delete-password">Password</label>
                  </SizerItem>
                  <SizerItem flag={wxEXPAND | wxALL} border={5}>
                    <TextCtrl
                      password
                      autoComplete="current-password"
                      id="ze-delete-password"
                      autoFocus
                      value={password}
                      disabled={busy}
                      onChange={setPassword}
                    />
                  </SizerItem>
                  {error && (
                    <SizerItem flag={wxLEFT | wxRIGHT | wxBOTTOM} border={5}>
                      <span className="ze-delete-account-error">{error}</span>
                    </SizerItem>
                  )}
                </>
              )}
            </BoxSizer>
          </SizerItem>
        </BoxSizer>

        <StdDialogButtons
          onCancel={onClose}
          onOk={() => void submit()}
          okLabel={busy ? 'Deleting...' : okLabel}
          okDisabled={okDisabled}
        >
          {step !== 'reason' && <Button label="Back" disabled={busy} onClick={back} />}
        </StdDialogButtons>
      </form>
    </DialogShim>
  );
}

/** One line of the summary: `{{count, number}} photo & video` in ente. */
function SummaryRow({ count, one, other }: { count: number; one: string; other: string }) {
  return (
    <div>
      <b>{count.toLocaleString()}</b> {count === 1 ? one : other}
    </div>
  );
}

async function defaultLoadSummary(): Promise<Summary> {
  const be = cloudBackend();
  if (!be?.accountDeletionSummary) throw new Error('no backend');
  return be.accountDeletionSummary();
}
