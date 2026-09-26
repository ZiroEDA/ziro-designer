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
 * copy per editor. It is the same shell `UnsavedChangesDialog` draws — on
 * GTK a GtkMessageDialog: a client-side-decorated window whose title is its
 * own 30 px `.titlebar` and not the window manager's bar (so `.ze-msgdlg-title`
 * here, never `.ze-modal-header`), the icon left of the message, and the
 * platform's single full-width button row — with the three-way
 * Save/Discard/Cancel answer replaced by the two-way Yes/No the `wxYES_NO`
 * style asks for. The geometry is `qa/probes/msgdlg_probe.py`'s, in shell.css.
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
  type YesNoCancelResult,
  type YesNoResult,
  yesNoButtons,
  yesNoCancelButtons,
} from '../confirm_types.js';
import { useModalEscape } from '../dialog_shim.js';

/**
 * The `wxICON_*` glyphs — the icon theme's, verbatim.
 *
 * wx adds no image of its own (src/gtk/msgdlg.cpp builds the dialog and sets
 * only its buttons and title); the picture is GtkMessageDialog's, which loads
 * `dialog-information-symbolic` / `-warning-` / `-error-` / `-question-` for
 * the message type at GTK_ICON_SIZE_DIALOG (48) and recolours it in the
 * dialog's foreground. The paths below are
 * /usr/share/icons/Yaru/scalable/status/dialog-*-symbolic.svg, unchanged but
 * for `fill`, which is `gray` on disk and the foreground once GTK is done
 * with it.
 *
 * Exported because `KIDIALOG` is a `wxRichMessageDialog`, which is the same
 * dialog family with a checkbox added — `ui/kidialog.tsx` draws it at its own
 * 48 px box (`qa/probes/kidialog_probe.cpp`).
 */
export function DialogIcon({
  icon,
  className = 'ze-msgdlg-icon',
}: {
  icon: MessageDialogIcon;
  /** Which dialog family is drawing it; the artwork is shared, the box is not. */
  className?: string;
}): JSX.Element {
  if (icon === 'question')
    return (
      <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
        <path d="m8 0a8 8 0 0 0-8 8 8 8 0 0 0 8 8 8 8 0 0 0 8-8 8 8 0 0 0-8-8zm0 1a7 7 0 0 1 7 7 7 7 0 0 1-7 7 7 7 0 0 1-7-7 7 7 0 0 1 7-7z" />
        <path d="M8.226 3.001c-.444 0-.864.051-1.26.153-.36.094-.679.222-.973.371l.3.832c.574-.291 1.162-.45 1.764-.45.506 0 .907.133 1.184.41.272.262.41.613.41 1.03 0 .259-.06.501-.18.723-.108.214-.25.419-.424.613-.17.19-.35.379-.54.568v.001h-.002c-.185.176-.36.37-.527.583l-.001.002c-.164.2-.3.418-.41.655-.097.231-.147.49-.147.779 0 .174.02.336.047.495h.906c0-.02-.005-.037-.005-.057v-.155c0-.323.064-.617.193-.876.126-.26.28-.498.465-.712l.001-.002c.182-.22.382-.43.601-.63.214-.194.408-.398.584-.61.174-.211.32-.436.439-.673.115-.24.174-.511.174-.819 0-.243-.04-.497-.123-.762v-.002l-.001-.002a1.703 1.703 0 0 0-.4-.721 2.161 2.161 0 0 0-.798-.526H9.5l-.002-.002C9.177 3.075 8.752 3 8.225 3zM8 11.304c-.27 0-.468.082-.619.25a.854.854 0 0 0-.229.598c0 .232.074.426.23.598.15.168.347.25.618.25.27 0 .468-.082.62-.25a.855.855 0 0 0 .228-.598.854.854 0 0 0-.229-.598c-.15-.168-.348-.25-.619-.25z" />
      </svg>
    );
  if (icon === 'information')
    return (
      <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
        <path d="m8 16a8 8 0 0 1-8-8 8 8 0 0 1 8-8 8 8 0 0 1 8 8 8 8 0 0 1-8 8zm0-1a7 7 0 0 0 7-7 7 7 0 0 0-7-7 7 7 0 0 0-7 7 7 7 0 0 0 7 7z" />
        <path d="M8 3.75c-.386 0-.69.124-.914.373A1.27 1.27 0 0 0 6.75 5c0 .336.112.628.336.877.224.249.528.373.914.373s.69-.124.914-.373A1.27 1.27 0 0 0 9.25 5a1.27 1.27 0 0 0-.336-.877C8.69 3.874 8.386 3.75 8 3.75zM7 7v5h2V7z" />
      </svg>
    );
  if (icon === 'error')
    return (
      <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
        <path d="M8 0a8 8 0 0 1 8 8 8 8 0 0 1-8 8 8 8 0 0 1-8-8 8 8 0 0 1 8-8zm0 1a7 7 0 0 0-7 7 7 7 0 0 0 7 7 7 7 0 0 0 7-7 7 7 0 0 0-7-7zm3.147 3.146l.707.708L8.707 8l3.147 3.146-.707.708L8 8.707l-3.146 3.147-.707-.708L7.293 8 4.147 4.854l.707-.708L8 7.293z" />
      </svg>
    );
  // wxICON_WARNING (and wxICON_EXCLAMATION, the same flag).
  return (
    <svg className={className} viewBox="0 0 16.002 16.002" aria-hidden="true" fill="currentColor">
      <path d="M7.963 0a1.499 1.499 0 0 0-1.277.785l-6.502 12A1.5 1.5 0 0 0 1.5 15.002h13a1.5 1.5 0 0 0 1.317-2.217l-6.498-12A1.496 1.496 0 0 0 7.963 0zm.025 1a.494.494 0 0 1 .451.262l6.498 12c.203.374-.016.74-.437.74h-13c-.422 0-.64-.366-.438-.74l6.502-12A.493.493 0 0 1 7.988 1zm-.695 2.002v2.662c0 .793.03 1.517.086 2.168.057.642.128 1.284.213 1.926h.82c.085-.642.157-1.284.213-1.926.057-.651.086-1.375.086-2.168V3.002zm.71 8a1 1 0 0 0-1 1c0 .282.118.535.306.717.17.189.4.283.693.283.293 0 .524-.094.694-.283a.994.994 0 0 0 .306-.717 1 1 0 0 0-1-1z" />
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
        <div className="ze-msgdlg-title">{ERROR_CAPTION}</div>
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
        <div className="ze-msgdlg-title">{caption}</div>
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
 * window, the information glyph left of a centred message, one full-width OK.
 * The OK is focused but shows no ring until the keyboard is used — GTK's
 * `gtk-visible-focus = automatic`, which is `:focus-visible` here.
 *
 * With no `wxCANCEL` in the style word Esc maps to the only button there is, so
 * Esc dismisses it.
 */
/**
 * `wxMessageDialog( …, wxYES_NO | wxCANCEL | wxICON_* )` with `SetYesNoLabels`:
 * three buttons, and Esc is `wxID_CANCEL` because the style has one.
 */
export function MessageDialogYesNoCancel({
  caption,
  message,
  icon,
  defaultButton,
  labels,
  onResult,
}: {
  caption: string;
  message: string;
  icon: MessageDialogIcon;
  defaultButton: 'yes' | 'no';
  labels?: { yes?: string; no?: string };
  onResult: (result: YesNoCancelResult) => void;
}): JSX.Element {
  useModalEscape(() => onResult('cancel'));

  const defaultRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    defaultRef.current?.focus();
  }, []);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-msgdlg" role="dialog" aria-modal="true">
        <div className="ze-msgdlg-title">{caption}</div>
        <div className="ze-msgdlg-body">
          <DialogIcon icon={icon} />
          <div className="ze-msgdlg-text">
            <div className="ze-msgdlg-message">{message}</div>
          </div>
        </div>
        <div className="ze-msgdlg-buttons">
          {yesNoCancelButtons(defaultButton, labels).map((b) => (
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
        <div className="ze-msgdlg-title">{caption}</div>
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
