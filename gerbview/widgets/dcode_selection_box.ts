// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/widgets/dcode_selection_box.h` + `.cpp`: `DCODE_SELECTION_BOX`,
 * the read-only `wxComboBox` on GerbView's TOP_AUX toolbar that lists the
 * active layer's D-codes.
 *
 * The combo box is the `wxChoice` model (`common/wx/choice.ts`); the frame
 * draws it through the shared `Combo`.
 */

import { wxChoice } from '@ziroeda/common/wx/choice.js';

/**
 * `wxString::ToLong`: the whole string must be a base-10 integer (`strtol`
 * with the end pointer at the terminator), leading white space allowed.
 */
function wxToLong(aText: string): number | null {
  return /^\s*[+-]?\d+$/.test(aText) ? Number.parseInt(aText, 10) : null;
}

/** `wxString::AfterFirst( ' ' ).BeforeFirst( ' ' )`: the second word. */
function secondWord(aText: string): string {
  const first = aText.indexOf(' ');
  const after = first === -1 ? '' : aText.slice(first + 1);
  const next = after.indexOf(' ');

  return next === -1 ? after : after.slice(0, next);
}

/** Helper to display a DCode list and select a DCode id. */
export class DCODE_SELECTION_BOX extends wxChoice {
  constructor(aChoices?: readonly string[]) {
    super();

    if (aChoices)
      // Append aChoices here is by far faster than use aChoices inside
      // the wxComboBox constructor
      this.Append(aChoices);
  }

  /** @return the current selected DCode Id or 0 if no dcode */
  GetSelectedDCodeId(): number {
    const ii = this.GetSelection();

    if (ii > 0) {
      // in strings displayed by the combo box, the dcode number
      // is the second word. get it:
      const id = wxToLong(secondWord(this.GetString(ii)));

      if (id !== null) return id;
    }

    return 0;
  }

  /** @param aDCodeId is the DCode Id to select or <= 0 to select "no dcode". */
  SetDCodeSelection(aDCodeId: number): void {
    for (let index = 1; index < this.GetCount(); ++index) {
      const id = wxToLong(secondWord(this.GetString(index)));

      if (id !== null && id === aDCodeId) {
        this.SetSelection(index);
        return;
      }
    }

    this.SetSelection(0);
  }

  /** @param aChoices is the DCode Id list to add to the combo box. */
  AppendDCodeList(aChoices: readonly string[]): void {
    this.Append(aChoices);
  }
}
