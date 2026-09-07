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
 * **PAGE_INFO's unit is MILS, and the metric sizes are rounded into it.** The
 * table is built through
 *
 *     #define MMsize( x, y ) VECTOR2D( Mm2mils( x ), Mm2mils( y ) )
 *     int Mm2mils( double aVal ) { return KiROUND( aVal * 1000. / 25.4 ); }
 *                                            page_info.cpp:38, eda_units.cpp:76
 *
 * so A3 is not 420 mm — it is `KiROUND( 420 * 1000 / 25.4 )` = **16535 mils**,
 * which is 419.989 mm. We stored the millimetres instead and were 0.011 mm
 * wide, which is invisible on screen and completely visible the moment a number
 * is printed: pl_editor's message panel reads "Page Width 419.9890 mm" where
 * ours read "420.0000 mm".
 *
 * Storing mils and deriving the millimetres puts the rounding where upstream
 * has it instead of throwing it away. See [[wx-panel-state-is-field-text]] —
 * holding more precision than KiCad holds is a parity bug, not an improvement.
 *
 * Landscape W×H, in the C++'s own order ("All MUST be defined as landscape").
 */
export const PAPER_MILS: Record<string, [number, number]> = {
  A5: [8268, 5827],
  A4: [11693, 8268],
  A3: [16535, 11693],
  A2: [23386, 16535],
  A1: [33110, 23386],
  A0: [46811, 33110],
  A: [11000, 8500],
  B: [17000, 11000],
  C: [22000, 17000],
  D: [34000, 22000],
  E: [44000, 34000],
  GERBER: [32000, 32000],
  User: [17000, 11000],
  USLetter: [11000, 8500],
  USLegal: [14000, 8500],
  USLedger: [17000, 11000],
};

/**
 * The same table in millimetres, derived rather than declared.
 *
 * `GetWidthIU` is `int GetWidthIU( double aIUScale ) { return aIUScale *
 * GetWidthMils(); }` (page_info.h:159) — an **int**, so the IU value truncates
 * as well. At pl_editor's scale (`drawSheetIUScale`, 25.4 IU per mil) A3 comes
 * out 419989 x 297002 IU, which is what makes its message panel print
 * "419.9890" and "297.0020" rather than "419.9890" and "297.0022".
 */
export const PAPER_MM: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(PAPER_MILS).map(([k, [w, h]]) => [k, [(w * 25.4) / 1000, (h * 25.4) / 1000]]),
) as Record<string, [number, number]>;

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

/**
 * `PAGE_INFO::GetWidthIU` / `GetHeightIU` — page size in internal units.
 *
 *     int GetWidthIU( double aIUScale ) const { return aIUScale * GetWidthMils(); }
 *                                                          page_info.h:159, 168
 *
 * The **int** return is not incidental. At pl_editor's scale (`drawSheetIUScale`,
 * 25.4 IU per mil) A3's height is 11693 x 25.4 = 297002.2, which truncates to
 * 297002 IU; converted back for display that is 297.0020 mm, and it is exactly
 * what a live pl_editor's message panel prints. Carrying the .2 would print
 * 297.0022 and be wrong by being more accurate.
 */
export function pageSizeIU(paper: string, iuPerMil: number): [number, number] {
  const mils = PAPER_MILS[paper];
  if (!mils) return [0, 0];
  return [Math.trunc(iuPerMil * mils[0]), Math.trunc(iuPerMil * mils[1])];
}

/** IU per mil at pl_editor's scale: PL_IU_PER_MM (1e3) x 25.4 / 1000. */
export const DRAW_SHEET_IU_PER_MIL = 25.4;

/**
 * The page size as the drawing sheet editor's message panel prints it —
 * millimetres, after the mils rounding AND the integer-IU truncation above.
 */
export function pageSizeDisplayMM(paper: string): [number, number] {
  const [w, h] = pageSizeIU(paper, DRAW_SHEET_IU_PER_MIL);
  return [w / 1000, h / 1000];
}

/**
 * The page a `(paper …)` TOKEN names, in millimetres — the file's spelling
 * rather than a `PAGE_INFO` field.
 *
 * Two forms, and both matter: a name with an optional `portrait` keyword, which
 * swaps the landscape pair above; and `User <w> <h>`, whose two numbers ARE the
 * size in millimetres and so cannot come out of any table — that is what "user"
 * means. `PAPER_MILS`' `User: [17000, 11000]` is `PAGE_INFO`'s *initial* custom
 * page, not the one a given file holds.
 *
 * It lives here because two renderers needed it and each had grown its own
 * copy: `editors/schematic/render/renderer.ts` handled `User` and
 * `editors/pcb/renderBoard.ts` did not, so a board saved with a custom page
 * size drew neither its drawing sheet nor its page limits while the same
 * schematic drew both. Millimetres, not IU: pcbnew's internal unit is a
 * nanometre and eeschema's is 100 nm, so a shared function returning IU would
 * be wrong in one of the two callers — see [[iu-scale-differs-per-editor]].
 */
export function pageSizeMM(paper: string | undefined): { w: number; h: number } | null {
  if (!paper) return null;

  const parts = paper.trim().split(/\s+/);

  if (parts[0] === 'User') {
    const w = Number(parts[1]);
    const h = Number(parts[2]);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
  }

  const dims = PAPER_MM[parts[0] ?? ''];
  if (!dims) return null;

  const [w, h] = parts.includes('portrait') ? [dims[1], dims[0]] : dims;
  return { w, h };
}
