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

/** The button the user pressed: `wxID_YES` / `wxID_NO`. */
export type YesNoResult = 'yes' | 'no';

/** GTK's stock labels, which `wxMessageDialog` uses unless `SetYesNoLabels`. */
export const YES_LABEL = 'Yes';
export const NO_LABEL = 'No';

/**
 * The `wxYES_NO` row in GTK order — negative first, affirmative last — with the
 * `wx*_DEFAULT` flag resolved into which one holds the focus ring.
 */
export function yesNoButtons(defaultButton: YesNoResult): {
  id: YesNoResult;
  label: string;
  isDefault: boolean;
}[] {
  return [
    { id: 'no', label: NO_LABEL, isDefault: defaultButton === 'no' },
    { id: 'yes', label: YES_LABEL, isDefault: defaultButton === 'yes' },
  ];
}
