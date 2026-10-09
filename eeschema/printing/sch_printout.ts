// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/printing/sch_printout.h` / `.cpp`: SCH_PRINTOUT, the wxPrintout that prints the
 * schematic one sheet per page, in page-number order, through `GAL_PRINT` (CAIRO_PRINT_GAL on
 * a page-sized canvas) over a copy of the frame's live view.
 *
 * `wxPrintout` is `common/wx/prntbase.ts`; `wxPrinter` (`common/wx/printer.ts`) hands each
 * page's DC in with `SetDC` and opens the browser's print window on the pages, as
 * `common/board_printout.ts` does for pcbnew.
 */
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { COLOR4D_BLACK, COLOR4D_WHITE, withAlpha } from '@ziroeda/common/gal/color4d.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import {
  GAL_ANTIALIASING_MODE,
  GAL_DISPLAY_OPTIONS,
} from '@ziroeda/common/gal/gal_display_options.js';
import { GAL_PRINT } from '@ziroeda/common/gal/gal_print.js';
import { GAL_DRAWING_CONTEXT } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID, LAYER_ID_COUNT, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { DEFAULT_THEME, GetColorSettings } from '@ziroeda/common/pgm_base.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { wxPrintout } from '@ziroeda/common/wx/prntbase.js';
import { ZOOM_MAX_LIMIT_EESCHEMA, ZOOM_MIN_LIMIT_EESCHEMA } from '@ziroeda/common/zoom_defines.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_ITEM } from '../sch_item.js';
import { SCH_PAINTER } from '../sch_painter.js';
import type { SCH_RENDER_SETTINGS } from '../sch_render_settings.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import type { SCH_VIEW } from '../sch_view.js';
import { SCH_WORLD_UNIT } from '../sch_view.js';
import { SCH_SELECTION_TOOL } from '../tools/sch_selection_tool.js';

/**
 * Custom print out for printing schematics.
 */
export class SCH_PRINTOUT extends wxPrintout {
  private readonly m_parent: SCH_EDIT_FRAME;
  /// Source VIEW object (note that actual printing only refers to this object).
  private m_view: SCH_VIEW | null;

  constructor(aParent: SCH_EDIT_FRAME, aTitle: string) {
    super(aTitle);
    this.m_parent = aParent;
    this.m_view = null;
  }

  GetPageInfo(): { minPage: number; maxPage: number; selPageFrom: number; selPageTo: number } {
    const count = this.m_parent.Schematic().Root().CountActiveSheets();

    return { minPage: 1, selPageFrom: 1, maxPage: count, selPageTo: count };
  }

  HasPage(aPageNum: number): boolean {
    return this.m_parent.Schematic().Root().CountActiveSheets() >= aPageNum;
  }

  OnBeginDocument(_aStartPage: number, _aEndPage: number): boolean {
    return true;
  }

  OnPrintPage(aPage: number): boolean {
    const sheetList = this.m_parent.Schematic().Hierarchy();
    sheetList.SortByPageNumbers(false);

    // wxCHECK_MSG( page >= 1 && page <= (int)sheetList.size(), false, ... )
    if (aPage < 1 || aPage > sheetList.length) return false;

    // wxCHECK_MSG( sheetList[ page - 1].LastScreen() != nullptr, false, ... )
    if (!sheetList[aPage - 1]!.LastScreen()) return false;

    this.m_parent.SetMsgPanel(`Print page ${aPage}`, '');

    const oldsheetpath = this.m_parent.GetCurrentSheet().Clone();

    // Switch to the new current sheet
    this.m_parent.SetCurrentSheet(sheetList[aPage - 1]!);
    this.m_parent.GetCurrentSheet().UpdateAllScreenReferences();
    this.m_parent.SetSheetNumberAndCount();
    this.m_parent.RecomputeIntersheetRefs();
    let screen = this.m_parent.GetCurrentSheet().LastScreen()!;
    // Ensure the displayed page number is updated:
    const sch_view = this.m_parent.GetCanvas()!.GetView() as SCH_VIEW;
    sch_view.GetDrawingSheet()?.SetPageNumber(screen.GetPageNumber());
    sch_view.GetDrawingSheet()?.SetIsFirstPage(screen.GetVirtualPageNumber() === 1);

    // Print page using the current wxPrinterDC
    this.PrintPage(screen, true);

    // Restore the initial current sheet
    this.m_parent.SetCurrentSheet(oldsheetpath);
    this.m_parent.GetCurrentSheet().UpdateAllScreenReferences();
    this.m_parent.SetSheetNumberAndCount();
    screen = this.m_parent.GetCurrentSheet().LastScreen()!;
    sch_view.GetDrawingSheet()?.SetPageNumber(screen.GetPageNumber());
    sch_view.GetDrawingSheet()?.SetIsFirstPage(screen.GetVirtualPageNumber() === 1);

    return true;
  }

  private milsToIU(aMils: number): number {
    return KiROUND(aMils * schIUScale.IU_PER_MILS);
  }

  /**
   * Print the active screen. `aDC` is the printout's own (`GetDC()`); upstream's memory-DC path
   * (`aForPrinting` false, the clipboard bitmap) has no caller here.
   */
  PrintPage(aScreen: SCH_SCREEN, aForPrinting: boolean): boolean {
    // Note: some data (like paper size) is available only when printing
    const dc = this.GetDC();
    this.m_view = this.m_parent.GetCanvas()!.GetView() as SCH_VIEW;
    const options = new GAL_DISPLAY_OPTIONS();
    options.antialiasing_mode = GAL_ANTIALIASING_MODE.AA_HIGHQUALITY;
    const galPrint = GAL_PRINT.Create(options, dc);
    const gal = galPrint.GetGAL();
    const printCtx = galPrint.GetPrintCtx();
    const painter = new SCH_PAINTER(gal);
    const view = this.m_view.DataReference();

    painter.SetSchematic(this.m_parent.Schematic());

    const cfg = this.m_parent.eeconfig();
    const cs = GetColorSettings(cfg ? cfg.printing.color_theme : DEFAULT_THEME);
    const selTool = this.m_parent.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;

    // Target paper size
    if (!aForPrinting) return false;

    const pageSizePix = this.GetLogicalPageRect();
    const dcPPI = dc.GetPPI();

    const pageSizeIn = { x: pageSizePix.width / dcPPI, y: pageSizePix.height / dcPPI };
    const pageSizeIU = {
      x: this.milsToIU(pageSizeIn.x * 1000),
      y: this.milsToIU(pageSizeIn.y * 1000),
    };

    galPrint.SetSheetSize(pageSizeIn);

    view.SetGAL(gal);
    view.SetPainter(painter);
    view.SetScaleLimits(ZOOM_MAX_LIMIT_EESCHEMA, ZOOM_MIN_LIMIT_EESCHEMA);
    view.SetScale(1.0);
    gal.SetWorldUnitLength(SCH_WORLD_UNIT);

    // Init the SCH_RENDER_SETTINGS used by the painter used to print schematic
    const dstSettings = painter.GetSettings() as SCH_RENDER_SETTINGS;

    if (aForPrinting) dstSettings.assign(this.m_parent.GetRenderSettings()!);

    dstSettings.m_ShowPinsElectricalType = false;

    // Set the color scheme
    dstSettings.LoadColors(this.m_parent.GetColorSettings(false));

    if (cfg?.printing.use_theme) dstSettings.LoadColors(cs);

    const printDrawingSheet = cfg ? cfg.printing.title_block : true;

    let bgColor = this.m_parent
      .GetColorSettings()
      .GetColor(SCH_LAYER_ID.LAYER_SCHEMATIC_BACKGROUND);

    if (cfg?.printing.background) {
      if (cfg.printing.use_theme) bgColor = cs.GetColor(SCH_LAYER_ID.LAYER_SCHEMATIC_BACKGROUND);
    } else {
      bgColor = COLOR4D_WHITE;
    }

    dstSettings.SetBackgroundColor(bgColor);

    // The drawing-sheet-item print code is shared between PCBNew and Eeschema, so it's easier
    // if they just use the PCB layer.
    dstSettings.SetLayerColor(
      GAL_LAYER_ID.LAYER_DRAWINGSHEET,
      dstSettings.GetLayerColor(SCH_LAYER_ID.LAYER_SCHEMATIC_DRAWINGSHEET),
    );

    dstSettings.SetDefaultFont(cfg ? cfg.appearance.default_font : '');

    if (cfg?.printing.monochrome) {
      for (let i = 0; i < LAYER_ID_COUNT; ++i) dstSettings.SetLayerColor(i, COLOR4D_BLACK);

      // In B&W mode, draw the background only in white, because any other color
      // will be replaced by a black background
      dstSettings.SetBackgroundColor(COLOR4D_WHITE);
      dstSettings.m_OverrideItemColors = true;

      // Disable print some backgrounds
      dstSettings.SetPrintBlackAndWhite(true);
    } else {
      // color enabled
      for (let i = 0; i < LAYER_ID_COUNT; ++i) {
        // Cairo does not support translucent colors on PostScript surfaces
        dstSettings.SetLayerColor(i, withAlpha(dstSettings.GetLayerColor(i), 1.0));
      }
    }

    dstSettings.SetIsPrinting(true);

    const sheetSizeIU = aScreen.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
    const drawingAreaBBox = new BOX2I({ x: 0, y: 0 }, sheetSizeIU);

    // Enable all layers and use KIGFX::TARGET_NONCACHED to force update drawings
    // for printing with current GAL instance
    for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; ++i) {
      view.SetLayerVisible(i, true);
      view.SetLayerTarget(i, RENDER_TARGET.TARGET_NONCACHED);
    }

    view.SetLayerVisible(GAL_LAYER_ID.LAYER_DRAWINGSHEET, printDrawingSheet);

    // Don't draw the selection if it's not from the current screen
    for (const item of selTool.GetSelection()) {
      if (item instanceof SCH_ITEM) {
        if (!this.m_parent.GetScreen()!.CheckIfOnDrawList(item))
          view.SetLayerVisible(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, false);

        break;
      }
    }

    // When is the actual paper size does not match the schematic page size,
    // we need to adjust the print scale to fit the selected paper size (pageSizeIU)
    const scaleX = pageSizeIU.x / drawingAreaBBox.GetWidth();
    const scaleY = pageSizeIU.y / drawingAreaBBox.GetHeight();

    const print_scale = Math.min(scaleX, scaleY);

    galPrint.SetNativePaperSize(pageSizeIn, printCtx.HasNativeLandscapeRotation());
    gal.SetLookAtPoint(drawingAreaBBox.Centre());
    gal.SetZoomFactor(print_scale);
    gal.SetClearColor(dstSettings.GetBackgroundColor());

    // Clearing the screen for the background color needs the screen set to the page size
    // in pixels.  This can ?somehow? prevent some but not all foreground elements from being
    // printed. TODO (upstream): figure out what's going on here. See also board_printout
    const size = gal.GetScreenPixelSize();
    gal.ResizeScreen(pageSizePix.width, pageSizePix.height);
    gal.ClearScreen();
    gal.ResizeScreen(size.x, size.y);

    // Needed to use the same order for printing as for screen redraw
    view.UseDrawPriority(true);

    GAL_DRAWING_CONTEXT(gal, () => view.Redraw());

    galPrint.destroy();

    return true;
  }
}
