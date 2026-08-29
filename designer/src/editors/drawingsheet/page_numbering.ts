// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `${#}` and `${##}` resolve to in the Drawing Sheet Editor, on screen and
 * on paper — which are not the same answer, and neither of them is the page the
 * `Page 1 / Other pages` selector is showing.
 *
 * ## On screen: always `1/1`
 *
 * `DS_DRAW_ITEM_LIST`'s constructor sets `m_pageNumber = "1"` and
 * `m_sheetCount = 1` (include/drawing_sheet/ds_draw_item.h:409-410), and
 * `PL_DRAW_PANEL_GAL::DisplayDrawingSheet` builds its `dummy` list and sets only
 * the paper format, the title block and the project on it
 * (pl_draw_panel_gal.cpp:100-103) — never `SetPageNumber` or `SetSheetCount`.
 * The selector does not go near them either: `OnSelectPage` toggles
 * `LAYER_DRAWINGSHEET_PAGE1` and `LAYER_DRAWINGSHEET_PAGEn` visibility and
 * refreshes (pl_editor_frame.cpp:461-467), so switching to `Other pages` hides
 * and shows *items* and leaves the title block's numbering alone.
 *
 * **Measured, not only read.** A driven pl_editor with the default sheet, in
 * preview mode, reads `Id: 1/1` on `Page 1` and reads `Id: 1/1` again on
 * `Other pages`, while 6266 canvas pixels change between the two — so the
 * layers did toggle and the numbering did not. `qa/probes/pl_e2e`.
 *
 * Ours passed `sheetCount: pageNumber > 1 ? 2 : 1` and let `${#}` fall back to
 * the ordinal, so `Other pages` showed `2/2`, a pair of numbers pl_editor never
 * puts on the canvas.
 *
 * ## On paper: `1/1` then `2/1`
 *
 * The printout is the one place a page number moves.
 * `PLEDITOR_PRINTOUT::PrintPage` calls
 * `screen->SetVirtualPageNumber( aPageNum )` (dialogs_for_printing.cpp:189) and
 * `EDA_DRAW_FRAME::PrintDrawingSheet` then passes `aScreen->GetPageCount()` and
 * `aScreen->GetPageNumber()` down (eda_draw_frame.cpp:1236-1239).
 *
 * `GetPageCount()` is 1: `BASE_SCREEN`'s constructor sets `m_pageCount = 1`
 * (base_screen.cpp:39) and nothing in `pagelayout_editor` calls `SetPageCount`.
 * `GetPageNumber()` returns `m_pageNumber` when it is set and the virtual page
 * number otherwise (base_screen.cpp:70-80), and nothing in `pagelayout_editor`
 * calls `SetPageNumber` either — so the printed second sheet is numbered `2` out
 * of a total of `1`. That reads oddly and it is what the program does.
 *
 * Kept out of `DrawingSheetEditor.tsx` because the frame is a `.tsx` and `qa`'s
 * tsconfig sets no `--jsx`, so a rule that lives inside it cannot be exercised.
 */

/** The `WksResolveContext` half that decides the numbering. */
export interface DsPageNumbering {
  /** `${#}` — `DS_DRAW_ITEM_LIST::m_pageNumber`. */
  pageName: string;
  /** `${##}` — `DS_DRAW_ITEM_LIST::m_sheetCount`. */
  sheetCount: number;
}

/**
 * `DS_DRAW_ITEM_LIST`'s own defaults, which the editor canvas never overrides.
 * Constant on purpose: the `Page 1 / Other pages` selector must not reach it.
 */
export const DS_CANVAS_PAGE_NUMBERING: DsPageNumbering = { pageName: '1', sheetCount: 1 };

/**
 * `aScreen->GetPageNumber()` / `aScreen->GetPageCount()` for the sheet of paper
 * numbered `aPageNum`.
 */
export function dsPrintPageNumbering(aPageNum: number): DsPageNumbering {
  return { pageName: String(aPageNum), sheetCount: 1 };
}
