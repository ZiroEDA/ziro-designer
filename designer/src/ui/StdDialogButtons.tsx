// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A dialog's standard button row.
 * Counterpart: `wxStdDialogButtonSizer`, which is what every KiCad dialog uses —
 * wxFormBuilder emits `m_sdbSizer1` / `m_sdbSizer1OK` / `m_sdbSizer1Cancel` and
 * a `Realize()` into each `*_base.cpp`, so no dialog upstream states the row
 * itself.
 *
 * Here, eighty-nine dialogs each wrote their own `<div className="ze-modal-footer">`
 * with two hand-made buttons, and they had already drifted: some gave the
 * buttons `className="ze-btn"` and some nothing, some set `type="button"` and
 * some left it to default to `submit`. That is the whole reason wx has a sizer
 * for this.
 *
 * ## Order is the platform's, not the call site's
 *
 * `Realize()` is where wx applies the platform convention, and the two disagree:
 * GTK follows the GNOME HIG and puts the affirmative button **last**
 * (Cancel, then OK), Windows puts it first. Our parity target is the GTK build
 * on this machine, so Cancel comes first — and it is settled here once rather
 * than at each call site, which is exactly what stopped the 89 copies agreeing.
 *
 * The OK button is the dialog's default: `SetAffirmativeButton` is what makes
 * Enter activate it.
 */
import type { JSX, ReactNode } from 'react';

export interface StdDialogButtonsProps {
  /** `wxID_CANCEL`'s handler. Also what Esc runs, via `useModalEscape`. */
  onCancel: () => void;
  /** `wxID_OK`'s handler — the affirmative, and the dialog's default button. */
  onOk: () => void;
  /**
   * Stock label overrides. wx takes these from the stock ids (`wxID_OK` → "OK",
   * `wxID_CANCEL` → "Cancel"); a dialog that renames one does it deliberately,
   * as `DIALOG_SHIM`'s `SetOKCancelLabels` callers do.
   */
  okLabel?: string;
  cancelLabel?: string;
  /** `m_sdbSizerOK->Enable( false )`. */
  okDisabled?: boolean;
  /** A tooltip on Cancel — `SetToolTip` on the stock button. */
  cancelTitle?: string;
  /**
   * Anything the dialog puts at the *left* of the row — a Help button, a
   * "Reset to Defaults", a status line. `wxStdDialogButtonSizer` grows a
   * stretch spacer between those and the affirmative pair.
   */
  children?: ReactNode;
}

export function StdDialogButtons({
  onCancel,
  onOk,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  okDisabled,
  cancelTitle,
  children,
}: StdDialogButtonsProps): JSX.Element {
  return (
    <div className="ze-modal-footer">
      {children}
      {children ? <span className="ze-sdb-spacer" /> : null}
      <button type="button" className="ze-btn" title={cancelTitle} onClick={onCancel}>
        {cancelLabel}
      </button>
      <button type="button" className="ze-btn primary" disabled={okDisabled} onClick={onOk}>
        {okLabel}
      </button>
    </div>
  );
}
