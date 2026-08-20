// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PAGE_INFO` — `common/page_info.cpp`.
 *
 * Upstream this is one table in `common/`, and every frame that offers a page
 * size reads it: the shared `DIALOG_PAGES_SETTINGS`, the plotters, the
 * renderers. It is `common/` here for the same reason, and because it was not:
 * `PAPER_MM` had grown FIVE copies in this tree — the drawing sheet's, one in
 * `dialog_print_pcb.tsx`, one in `renderBoard.ts`, one in the schematic
 * renderer, and the schematic's page-settings dialog importing the drawing
 * sheet's *component file* sideways, which is the circular ownership between
 * peers the project brief already names. This module is where they collapse to.
 */

/**
 * `PAGE_INFO::standardPageSizes` (common/page_info.cpp:46-68), in its own order.
 *
 * `DIALOG_PAGES_SETTINGS::TransferDataToWindow` (:112-133) appends the WHOLE
 * list to the combo, in this order, with each row's client data set to its
 * PAGE_SIZE_TYPE — so the combo IS this table and nothing sorts or filters it.
 *
 * Sizes are millimetres, landscape W×H, exactly as the C++ declares them
 * ("All MUST be defined as landscape"); the imperial ones are its mils
 * converted. Ours had A5 as 148.5 mm tall where upstream says 148.
 */
export const PAPER_MM: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  /** VECTOR2D( 32000, 32000 ) mils. */
  GERBER: [812.8, 812.8],
  User: [431.8, 279.4],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
};

/**
 * The combo, row for row.
 *
 * Three things the audit found wrong and all three are in the C++ verbatim:
 * the descriptions have SPACES around the `x` ("A5 148 x 210mm"), the US sizes
 * are two words ("US Letter"), and `User (Custom)` is the 13th row rather than
 * the last — because the table's order is the combo's order and the US sizes
 * come after it.
 *
 * The blank row at 12 is not a mistake either: `PAGE_SIZE_TYPE::GERBER` is
 * declared with `wxPAPER_NONE` and NO `_HKI` description (page_info.cpp:62), so
 * `Append( wxGetTranslation( "" ) )` puts an empty row in the list. It selects
 * a real 32000 x 32000 mil page. Reproduced rather than tidied away: the bar is
 * that a user cannot tell which app they are in.
 */
export const PAPER_CHOICES: { id: string; label: string }[] = [
  { id: 'A5', label: 'A5 148 x 210mm' },
  { id: 'A4', label: 'A4 210 x 297mm' },
  { id: 'A3', label: 'A3 297 x 420mm' },
  { id: 'A2', label: 'A2 420 x 594mm' },
  { id: 'A1', label: 'A1 594 x 841mm' },
  { id: 'A0', label: 'A0 841 x 1189mm' },
  { id: 'A', label: 'A 8.5 x 11in' },
  { id: 'B', label: 'B 11 x 17in' },
  { id: 'C', label: 'C 17 x 22in' },
  { id: 'D', label: 'D 22 x 34in' },
  { id: 'E', label: 'E 34 x 44in' },
  { id: 'GERBER', label: '' },
  { id: 'User', label: 'User (Custom)' },
  { id: 'USLetter', label: 'US Letter 8.5 x 11in' },
  { id: 'USLegal', label: 'US Legal 8.5 x 14in' },
  { id: 'USLedger', label: 'US Ledger 11 x 17in' },
];
