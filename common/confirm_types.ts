// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KICAD_MESSAGE_DIALOG` — what the flags mean, without a DOM.
 *
 * `include/confirm.h:45-53` defines `KICAD_MESSAGE_DIALOG` as `wxMessageDialog`
 * everywhere but Windows, so every call site in KiCad — `bitmap2cmp_panel.cpp`,
 * `eeschema/files-io.cpp`, `eeschema/sheet.cpp`, `dialog_sheet_properties.cpp`,
 * … — is one shared platform dialog configured by a style word:
 *
 *     KICAD_MESSAGE_DIALOG dlg( parent, msg, caption,
 *                               wxYES_NO | wxICON_QUESTION | wxYES_DEFAULT );
 *
 * Three independent things ride in that word: which buttons, which icon, and
 * which button is default. They are pulled apart here so the React dialog is a
 * rendering of the decision rather than the place the decision is made — the
 * same split `confirm.ts` makes for the unsaved-changes question.
 *
 * The button ORDER is not ours to choose either. A wxMessageDialog lays its
 * buttons out the way the platform does, and on GTK that is one row with the
 * affirmative LAST: "No", then "Yes". `wxYES_DEFAULT` then focuses Yes, so
 * Enter answers yes; `wxNO_DEFAULT` focuses No.
 */

/** `wxICON_QUESTION` / `wxICON_WARNING` / `wxICON_ERROR` / `wxICON_INFORMATION`. */
export type MessageDialogIcon = 'question' | 'warning' | 'error' | 'information';

/**
 * The caption `DisplayErrorMessage` gives its box (common/confirm.cpp) — it
 * passes `_( "Error" )`, not the frame's name, on every call.
 */
export const ERROR_CAPTION = 'Error';

/**
 * …and the caption `DisplayInfoMessage` gives its box, from the same file:
 *
 *     dlg = new KICAD_MESSAGE_DIALOG_BASE( aParent, aMessage, _( "Information" ),
 *                                          wxOK | wxCENTRE | wxRESIZE_BORDER |
 *                                          icon | wxSTAY_ON_TOP );
 *
 * (`common/confirm.cpp:266-268`, with `icon = wxICON_INFORMATION`.) Like the
 * error box it is the same word on every call site, never the frame's name.
 */
export const INFO_CAPTION = _HKI('Information');

/** The button the user pressed: `wxID_YES` / `wxID_NO`. */
export type YesNoResult = 'yes' | 'no';

/**
 * GTK's stock labels, which `wxMessageDialog` uses unless `SetYesNoLabels`: wx's
 * (external/wx/stockitem.ts). `SetYesNoLabels` is the `labels` argument to
 * {@link yesNoButtons}: it renames the two buttons WITHOUT changing which is affirmative.
 */
import { CANCEL_LABEL, NO_LABEL, OK_LABEL, YES_LABEL } from '@ziroeda/wx/stockitem.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
export { CANCEL_LABEL, NO_LABEL, OK_LABEL, YES_LABEL };

/**
 * The `wxYES_NO` row in GTK order — negative first, affirmative last — with the
 * `wx*_DEFAULT` flag resolved into which one holds the focus ring.
 */
export function yesNoButtons(
  defaultButton: YesNoResult,
  labels?: { yes?: string; no?: string },
): {
  id: YesNoResult;
  label: string;
  isDefault: boolean;
}[] {
  return [
    { id: 'no', label: labels?.no ?? NO_LABEL, isDefault: defaultButton === 'no' },
    { id: 'yes', label: labels?.yes ?? YES_LABEL, isDefault: defaultButton === 'yes' },
  ];
}

/**
 * The `wxOK | wxCANCEL` row, in the same GTK order the `wxYES_NO` one uses —
 * negative first, affirmative last — with `wxOK` holding the focus.
 *
 * A separate function rather than `yesNoButtons` with two labels passed in,
 * because the two style words differ in exactly the thing a caller forgets: the
 * STOCK labels. `SetOKLabel` renames one button and leaves the other at
 * "Cancel"; routing that through the yes/no row gave it "No".
 */
export function okCancelButtons(labels?: { ok?: string; cancel?: string }): {
  id: 'ok' | 'cancel';
  label: string;
  isDefault: boolean;
}[] {
  return [
    { id: 'cancel', label: labels?.cancel ?? CANCEL_LABEL, isDefault: false },
    // `wxOK_DEFAULT` is the default when neither is named, and every KIDIALOG
    // call site leaves it that way.
    { id: 'ok', label: labels?.ok ?? OK_LABEL, isDefault: true },
  ];
}

export type YesNoCancelResult = 'yes' | 'no' | 'cancel';

/**
 * `wxYES_NO | wxCANCEL`: wxGTK adds the buttons No, Cancel, Yes in that order
 * and `wxYES_DEFAULT` focuses Yes - measured on the very dialog
 * DIALOG_DRC::OnDeleteAllClick raises (`qa/probes/msgdlg_yesnocancel`).
 */
export function yesNoCancelButtons(
  defaultButton: 'yes' | 'no',
  labels?: { yes?: string; no?: string; cancel?: string },
): {
  id: YesNoCancelResult;
  label: string;
  isDefault: boolean;
}[] {
  return [
    { id: 'no', label: labels?.no ?? NO_LABEL, isDefault: defaultButton === 'no' },
    { id: 'cancel', label: labels?.cancel ?? CANCEL_LABEL, isDefault: false },
    { id: 'yes', label: labels?.yes ?? YES_LABEL, isDefault: defaultButton === 'yes' },
  ];
}
