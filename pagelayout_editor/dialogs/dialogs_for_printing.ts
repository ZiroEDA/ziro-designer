// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/dialogs/dialogs_for_printing.cpp`: `PLEDITOR_PRINTOUT`,
 * `InvokeDialogPrint` and `InvokeDialogPrintPreview` - what pl_editor prints,
 * how many sheets of paper it is, and how it draws them: on the wxDC print
 * path (`common/wx/dc.ts`, `gr_basic.ts`, `PrintDrawingSheet`), not the GAL.
 *
 * `PLEDITOR_PRINTOUT` (pagelayout_editor/dialogs/dialogs_for_printing.cpp) is
 * a two-page printout and says so twice:
 *
 *     bool HasPage( int aPageNum ) override { return ( aPageNum <= 2 ); }      // :62
 *     *minPage = *selPageFrom = 1;                                            // :155
 *     *maxPage = *selPageTo   = 2;                                            // :156
 *
 * and `InvokeDialogPrint` seeds the dialog with `printDialogData.SetMaxPage( 2 )`
 * and enables the page-number controls because of it (:227-233). The GTK print
 * dialog a driven pl_editor opens really does show the two-page collate icon.
 *
 * Two pages is the point of the editor rather than a detail of it. Every item
 * carries a page option — `(option page1only)` or `(option notonpage1)` — and
 * `PrintPage` sets `screen->SetVirtualPageNumber( aPageNum )` before rendering
 * (:189) so that each page shows its own set. A one-page print can show at most
 * half of any sheet that uses the feature, and ours printed whichever page the
 * toolbar's `Page 1 / Other pages` selector happened to be on.
 *
 * `PLEDITOR_PREVIEW_FRAME` (the wxPrintPreview window) has no browser form:
 * the browser's print dialog is its own preview, so `InvokeDialogPrintPreview`
 * prints, as `InvokeDialogPrint` does.
 */

import { LEGACY_COLORS } from '@ziroeda/common/color4d.js';
import { DS_DATA_ITEM_BITMAP } from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { DS_RENDER_SETTINGS } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { drawSheetIUScale } from '@ziroeda/common/eda_units.js';
import { GRForceBlackPen, GRResetPenAndBrush } from '@ziroeda/common/gr_basic.js';
import { LAYER_DRAWINGSHEET } from '@ziroeda/common/layer_id.js';
import { wxPrinter } from '@ziroeda/common/wx/printer.js';
import { wxPrintout } from '@ziroeda/common/wx/prntbase.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';

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
 * Both follow from `PrintPage` below with nothing added: the numbering is the
 * screen's, as upstream's is.
 */

/**
 * Custom print out for printing schematics.
 */
export class PLEDITOR_PRINTOUT extends wxPrintout {
  private m_parent: PL_EDITOR_FRAME;

  constructor(aParent: PL_EDITOR_FRAME, aTitle: string) {
    super(aTitle);
    this.m_parent = aParent;
  }

  override OnPrintPage(aPageNum: number): boolean {
    this.PrintPage(aPageNum);
    return true;
  }

  HasPage(aPageNum: number): boolean {
    return aPageNum <= 2;
  }

  GetPageInfo(): { minPage: number; maxPage: number; selPageFrom: number; selPageTo: number } {
    return { minPage: 1, selPageFrom: 1, maxPage: 2, selPageTo: 2 };
  }

  /**
   * Print a page.
   */
  PrintPage(aPageNum: number): void {
    const dc = this.GetDC();
    const screen = this.m_parent.GetScreen()!;

    // Save current offsets and clip box.
    const tmp_startvisu = { ...screen.m_StartVisu };
    const old_org = { ...screen.m_DrawOrg };

    // Change scale factor and offset to print the whole page.
    const pageSizeIU = this.m_parent.GetPageSettings().GetSizeIU(drawSheetIUScale.IU_PER_MILS);
    this.FitThisSizeToPaper(pageSizeIU);
    const fitRect = this.GetLogicalPaperRect();

    const xoffset = Math.trunc((fitRect.width - pageSizeIU.x) / 2);
    const yoffset = Math.trunc((fitRect.height - pageSizeIU.y) / 2);

    this.OffsetLogicalOrigin(xoffset, yoffset);

    GRResetPenAndBrush(dc);
    GRForceBlackPen(true);

    const bg_color = this.m_parent.GetDrawBgColor();
    this.m_parent.SetDrawBgColor(LEGACY_COLORS.WHITE);

    screen.SetVirtualPageNumber(aPageNum);

    const renderSettings = new DS_RENDER_SETTINGS();
    renderSettings.SetDefaultPenWidth(1);
    renderSettings.SetLayerColor(LAYER_DRAWINGSHEET, LEGACY_COLORS.RED);
    renderSettings.SetPrintDC(dc);

    // Ensure the scaling factor (used only in printing) of bitmaps is up to date
    const model = DS_DATA_MODEL.GetTheInstance();

    for (const dataItem of model.GetItems()) {
      if (dataItem instanceof DS_DATA_ITEM_BITMAP && dataItem.m_ImageBitmap) {
        const bitmap = dataItem.m_ImageBitmap;
        bitmap.SetPixelSizeIu((drawSheetIUScale.IU_PER_MILS * 1000) / bitmap.GetPPI());
      }
    }

    this.m_parent.PrintDrawingSheet(renderSettings, screen, null, drawSheetIUScale.IU_PER_MILS, '');

    this.m_parent.SetDrawBgColor(bg_color);
    GRForceBlackPen(false);

    screen.m_StartVisu = tmp_startvisu;
    screen.m_DrawOrg = old_org;

    // PrintDrawingSheet clears the current display list when calling BuildDrawItemsList()
    // So rebuild and redraw it.
    this.m_parent.GetCanvas()?.DisplayDrawingSheet();
  }
}

/**
 * The paper `ToPrinter` sets up: the sheet's own paper and orientation
 * (`s_pageSetupData->SetPaperId( pageInfo.GetPaperId() )`, `SetOrientation`),
 * in inches, as `wxPrinter` takes it.
 */
function paperInches(aCaller: PL_EDITOR_FRAME): { x: number; y: number } {
  const page = aCaller.GetPageSettings();
  return { x: page.GetWidthMils() / 1000, y: page.GetHeightMils() / 1000 };
}

/**
 * Create and show a print dialog; returns 1 if OK, 0 if there is a problem.
 */
export function InvokeDialogPrint(aCaller: PL_EDITOR_FRAME): number {
  const printer = new wxPrinter();
  const printout = new PLEDITOR_PRINTOUT(aCaller, 'Print Drawing Sheet');

  if (!printer.Print(printout, paperInches(aCaller))) {
    aCaller
      .GetHost()
      ?.MessageBox('An error occurred attempting to print the drawing sheet.', 'Printing');
    return 0;
  }

  return 1;
}

/**
 * Create and show a print preview dialog; returns 1 if OK, 0 if there is a
 * problem. The browser's print dialog previews, so this prints.
 */
export function InvokeDialogPrintPreview(aCaller: PL_EDITOR_FRAME): number {
  const printer = new wxPrinter();

  return printer.Print(new PLEDITOR_PRINTOUT(aCaller, 'Preview'), paperInches(aCaller)) ? 1 : 0;
}
