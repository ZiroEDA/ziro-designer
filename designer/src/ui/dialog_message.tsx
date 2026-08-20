// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KICAD_MESSAGE_DIALOG`, drawn — the three shapes `pcb_calculator`, the drawing
 * sheet and the editors between them raise.
 *
 * There are TWO one-button dialogs here and that is deliberate, because upstream
 * has two distinct callers:
 *
 *   `MessageDialogError`  `DisplayErrorMessage()` (common/confirm.cpp) —
 *                         `wxOK | wxICON_ERROR`, caption fixed to `_( "Error" )`,
 *                         and an optional `SetExtendedMessage`.
 *   `MessageDialogOk`     a bare `wxMessageBox( msg )` — `wxICON_INFORMATION`
 *                         and `wxMessageBoxCaptionStr`, i.e. the caption is the
 *                         CALLER's to choose. `pcb_calculator` raises three.
 *
 * They differ in icon, in where the caption comes from, and in whether the
 * caption is a parameter at all. Do not collapse them into one component with
 * flags without checking both call sites first.
 *
 * `include/confirm.h:45-53` aliases it to `wxMessageDialog`, which is one
 * dialog shared by every frame; ours is likewise one component in `ui/`, not a
 * copy per editor. It is the same shell `UnsavedChangesDialog` draws — the
 * `.ze-msgdlg` body with the icon left of the message, and the platform's
 * single full-width button row — with the three-way Save/Discard/Cancel answer
 * replaced by the two-way Yes/No the `wxYES_NO` style asks for.
 *
 * Which button sits where, and which one is focused, is decided in
 * `message_dialog.ts`; this file only renders it. Esc is `wxID_NO`: a
 * wxMessageDialog with no `wxCANCEL` maps Esc to the negative button, so
 * dismissing the question declines it rather than doing the thing.
 */
import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import {
  ERROR_CAPTION,
  type MessageDialogIcon,
  OK_LABEL,
  type YesNoResult,
  yesNoButtons,
} from './message_dialog.js';
import { useModalEscape } from './useModalEscape.js';

/** The `wxICON_*` glyphs, drawn at the 44 px `.ze-msgdlg-icon` box. */
function DialogIcon({ icon }: { icon: MessageDialogIcon }): JSX.Element {
  if (icon === 'question')
    return (
      <svg className="ze-msgdlg-icon" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M18 18.5a6 6 0 1 1 6 6V29"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="24" cy="35.5" r="1.9" fill="currentColor" />
      </svg>
    );
  if (icon === 'information')
    return (
      <svg className="ze-msgdlg-icon" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M24 22v14"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="24" cy="14.5" r="1.9" fill="currentColor" />
      </svg>
    );
  // wxICON_WARNING and wxICON_ERROR are both the exclamation triangle here, as
  // UnsavedChangesDialog draws it.
  return (
    <svg className="ze-msgdlg-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M24 5 45 43H3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M24 18v11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="36" r="1.9" fill="currentColor" />
    </svg>
  );
}

/**
 * `DisplayErrorMessage( aParent, aText, aExtraInfo )` (common/confirm.cpp) —
 * the same `KICAD_MESSAGE_DIALOG` shell with `wxOK | wxICON_ERROR` and the
 * caption `_( "Error" )`. wx maps Esc to the sole button here, so dismissing
 * it is the same as pressing OK.
 */
export function MessageDialogError({
  message,
  extendedMessage,
  onClose,
}: {
  /** `aText`, the error itself. */
  message: string;
  /** `SetExtendedMessage( aExtraInfo )`, omitted by most call sites. */
  extendedMessage?: string;
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);

  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
  }, []);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-msgdlg" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{ERROR_CAPTION}</div>
        <div className="ze-msgdlg-body">
          <DialogIcon icon="error" />
          <div className="ze-msgdlg-text">
            <div className="ze-msgdlg-message">{message}</div>
            {extendedMessage && <div className="ze-msgdlg-extended">{extendedMessage}</div>}
          </div>
        </div>
        <div className="ze-msgdlg-buttons">
          <button type="button" className="ze-btn primary" ref={okRef} onClick={onClose}>
            {OK_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MessageDialogYesNo({
  caption,
  message,
  extendedMessage,
  icon,
  defaultButton,
  labels,
  onResult,
}: {
  /** The window title — `KICAD_MESSAGE_DIALOG`'s third argument. */
  caption: string;
  /** The question — its second argument. */
  message: string;
  /** `SetExtendedMessage`, the smaller line under it. Most call sites omit it. */
  extendedMessage?: string;
  /** `wxICON_QUESTION` and friends. */
  icon: MessageDialogIcon;
  /** `wxYES_DEFAULT` / `wxNO_DEFAULT`. */
  defaultButton: YesNoResult;
  /** `SetYesNoLabels`. Omitted, the two buttons are GTK's stock Yes and No. */
  labels?: { yes?: string; no?: string };
  onResult: (result: YesNoResult) => void;
}): JSX.Element {
  // No wxCANCEL in the style word, so Esc is the negative answer.
  useModalEscape(() => onResult('no'));

  const defaultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    defaultRef.current?.focus();
  }, []);

  return (
    // Modal on its parent, and not dismissable by clicking away: the point of
    // asking is that one of the two answers is given.
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-msgdlg" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-msgdlg-body">
          <DialogIcon icon={icon} />
          <div className="ze-msgdlg-text">
            <div className="ze-msgdlg-message">{message}</div>
            {extendedMessage && <div className="ze-msgdlg-extended">{extendedMessage}</div>}
          </div>
        </div>
        <div className="ze-msgdlg-buttons">
          {yesNoButtons(defaultButton, labels).map((b) => (
            <button
              key={b.id}
              type="button"
              className={`ze-btn${b.isDefault ? ' primary' : ''}`}
              ref={b.isDefault ? defaultRef : undefined}
              onClick={() => onResult(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * `wxMessageBox( msg )` — the one-button information box, the same
 * `KICAD_MESSAGE_DIALOG` shell with `wxOK | wxICON_INFORMATION` instead of
 * `wxYES_NO`. `pcb_calculator` raises three of them (an out-of-range required
 * resistance, a duplicate regulator, an unreadable data file) and every one is
 * this dialog, not an inline label — measured on the running 10.0.5: a 461x163
 * window, the information glyph left of a centred message, one full-width OK
 * with the focus ring on it.
 *
 * With no `wxCANCEL` in the style word Esc maps to the only button there is, so
 * Esc dismisses it.
 */
export function MessageDialogOk({
  caption = 'Message',
  message,
  icon = 'information',
  onClose,
}: {
  /** `wxMessageBoxCaptionStr`, which is what a bare wxMessageBox uses. */
  caption?: string;
  message: string;
  icon?: MessageDialogIcon;
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);

  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
  }, []);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-msgdlg" role="alertdialog" aria-modal="true">
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-msgdlg-body">
          <DialogIcon icon={icon} />
          <div className="ze-msgdlg-text">
            <div className="ze-msgdlg-message">{message}</div>
          </div>
        </div>
        <div className="ze-msgdlg-buttons">
          <button type="button" className="ze-btn primary" ref={okRef} onClick={onClose}>
            {OK_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
