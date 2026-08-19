// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KICAD_MESSAGE_DIALOG` with `wxYES_NO`, drawn.
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
import { type MessageDialogIcon, type YesNoResult, yesNoButtons } from './message_dialog.js';
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

export function MessageDialogYesNo({
  caption,
  message,
  extendedMessage,
  icon,
  defaultButton,
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
          {yesNoButtons(defaultButton).map((b) => (
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
