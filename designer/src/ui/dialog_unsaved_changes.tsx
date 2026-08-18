// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Save Changes?" — the shared unsaved-work prompt. Counterpart:
 * `common/confirm.cpp` `UnsavedChangesDialog`, the `KICAD_MESSAGE_DIALOG_BASE`
 * built with `wxYES_NO | wxCANCEL | wxYES_DEFAULT | wxICON_WARNING | wxCENTER`.
 *
 * The window title is "Save Changes?"; the caller's sentence is the message;
 * `SetExtendedMessage` puts "If you don't save, all your changes will be
 * permanently lost." under it in the smaller face; `SetYesNoLabels` renames the
 * buttons "Save" and "Discard Changes". The platform lays a message dialog's
 * buttons out itself — on GTK, one full-width row, the affirmative last and
 * focused — which is why the row here is the destructive answer, Cancel, then
 * Save with the focus ring, and not our usual right-aligned footer.
 *
 * Everything about what the answers *mean* is in `confirm.ts`; this file only
 * draws the question. Callers should not read the result directly — pass it to
 * `handleUnsavedChanges` — so that "cancel aborts the close, discard does not"
 * stays one rule rather than one per dialog.
 */
import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import {
  UNSAVED_CHANGES_CANCEL_LABEL,
  UNSAVED_CHANGES_DISCARD_LABEL,
  UNSAVED_CHANGES_EXTENDED,
  UNSAVED_CHANGES_SAVE_LABEL,
  UNSAVED_CHANGES_TITLE,
  type UnsavedChangesResult,
} from './confirm.js';
import { useModalEscape } from './useModalEscape.js';

export function UnsavedChangesDialog({
  message,
  onResult,
}: {
  /** The frame's own sentence, e.g. "Symbol to Footprint links have been
   *  modified. Save changes?". */
  message: string;
  onResult: (result: UnsavedChangesResult) => void;
}): JSX.Element {
  // Esc is wxID_CANCEL here as in every wxDialog: it aborts the close, it does
  // not discard. See ui/modal_escape.ts.
  useModalEscape(() => onResult('cancel'));

  // wxYES_DEFAULT: Save has the focus ring when the dialog opens, so Enter
  // keeps the work rather than losing it.
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    saveRef.current?.focus();
  }, []);

  return (
    // A message dialog is modal on its parent and has no dismiss-by-clicking-
    // away: the point of asking is that one of the three answers is given.
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-msgdlg" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{UNSAVED_CHANGES_TITLE}</div>
        <div className="ze-msgdlg-body">
          <svg className="ze-msgdlg-icon" viewBox="0 0 48 48" aria-hidden="true">
            <path
              d="M24 5 45 43H3Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path
              d="M24 18v11"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="24" cy="36" r="1.9" fill="currentColor" />
          </svg>
          <div className="ze-msgdlg-text">
            <div className="ze-msgdlg-message">{message}</div>
            <div className="ze-msgdlg-extended">{UNSAVED_CHANGES_EXTENDED}</div>
          </div>
        </div>
        <div className="ze-msgdlg-buttons">
          <button type="button" className="ze-btn" onClick={() => onResult('discard')}>
            {UNSAVED_CHANGES_DISCARD_LABEL}
          </button>
          <button type="button" className="ze-btn" onClick={() => onResult('cancel')}>
            {UNSAVED_CHANGES_CANCEL_LABEL}
          </button>
          <button
            type="button"
            className="ze-btn primary"
            ref={saveRef}
            onClick={() => onResult('save')}
          >
            {UNSAVED_CHANGES_SAVE_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
