// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The "Save Changes?" question, and what each answer means. Counterpart:
 * `common/confirm.cpp` (`UnsavedChangesDialog` / `HandleUnsavedChanges`).
 *
 * KiCad asks this once, from `common/`, and every frame that can hold unsaved
 * work calls it: eeschema, pcbnew, the symbol and footprint editors, cvpcb.
 * The wording, the button labels, the button order and which button is default
 * are therefore the same everywhere, and so is the rule that turns the answer
 * into "may I close?". That rule lives here rather than in the React dialog so
 * it can be tested without a DOM, and so the dialog stays a rendering of it.
 *
 * The three answers are not symmetric and the difference is the whole point of
 * having three: only *cancel* aborts the close. "Discard Changes" closes and
 * loses the work — deliberately — and "Save" closes only if the save succeeds,
 * which is why the caller hands in a function returning whether it did.
 * A two-way "discard?" prompt, which is what several of our dialogs grew
 * instead, offers no way to keep the work at all: the user who hit Esc by
 * mistake can only lose it or go back and save by hand.
 */

/** The button the user pressed: `wxID_YES` / `wxID_NO` / `wxID_CANCEL`. */
export type UnsavedChangesResult = 'save' | 'discard' | 'cancel';

/** The dialog's window title. */
export const UNSAVED_CHANGES_TITLE = 'Save Changes?';

/** `SetExtendedMessage`, the grey sub-line under the question. */
export const UNSAVED_CHANGES_EXTENDED =
  "If you don't save, all your changes will be permanently lost.";

/** `SetYesNoLabels( _( "&Save" ), _( "&Discard Changes" ) )`. */
export const UNSAVED_CHANGES_SAVE_LABEL = 'Save';
export const UNSAVED_CHANGES_DISCARD_LABEL = 'Discard Changes';
export const UNSAVED_CHANGES_CANCEL_LABEL = 'Cancel';

/**
 * `HandleUnsavedChanges`: run the answer and report whether the caller may go
 * on with whatever it was doing (closing, usually).
 *
 *     case wxID_YES:    return aSaveFunction();
 *     case wxID_NO:     return true;  // proceed without saving
 *     default:
 *     case wxID_CANCEL: return false;
 *
 * `save` returns whether the save succeeded; a failed save keeps the window
 * open, because the alternative is throwing the work away on the user's behalf.
 */
export function handleUnsavedChanges(result: UnsavedChangesResult, save: () => boolean): boolean {
  switch (result) {
    case 'save':
      return save();
    case 'discard':
      return true;
    default:
      return false;
  }
}
