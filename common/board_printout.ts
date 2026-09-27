// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/board_printout.cpp` + `include/board_printout.h`:
 * BOARD_PRINTOUT_SETTINGS, the printout parameters pcbnew and GerbView share,
 * and BOARD_PRINTOUT, the wxPrintout that draws one page through `GAL_PRINT`
 * (CAIRO_PRINT_GAL on a page-sized canvas).
 *
 * `wxPrintout` is `wx/prntbase.ts`; the caller that drives the pages
 * (`wx/printer.ts`) hands in each page's DC with `SetDC`, as wxPrinter does.
 */

import { COLOR4D_BLACK, COLOR4D_WHITE, withAlpha } from './color4d.js';
import { GAL_DISPLAY_OPTIONS } from './gal/gal_display_options.js';
import { GAL_PRINT } from './gal/gal_print.js';
import { wxPrintout } from './wx/prntbase.js';

export { wxPrintout };
import { GAL_DRAWING_CONTEXT, type GAL } from './gal/graphics_abstraction_layer.js';
import type { PAINTER } from './gal/painter.js';
import { GAL_LAYER_ID, LAYER_ID_COUNT } from './layer_id.js';
import { LSET } from './lset.js';
import { RENDER_TARGET } from './gal/definitions.js';
import { VIEW } from './view/view.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { PAGE_INFO } from './page_info.js';
import { PRINTOUT_SETTINGS } from './printout.js';
import type { APP_SETTINGS_BASE } from './settings/app_settings.js';

/**
 * Handle the parameters used to print a board drawing.
 */
export class BOARD_PRINTOUT_SETTINGS extends PRINTOUT_SETTINGS {
  m_LayerSet: LSET; ///< Layers to print
  m_Mirror: boolean; ///< Print mirrored

  constructor(aPageInfo: PAGE_INFO) {
    super(aPageInfo);
    this.m_LayerSet = new LSET();
    this.m_LayerSet.set();
    this.m_Mirror = false;
  }

  override Load(aConfig: APP_SETTINGS_BASE): void {
    super.Load(aConfig);

    this.m_LayerSet.reset();

    for (const layer of aConfig.m_Printing.layers) this.m_LayerSet.set(layer, true);

    this.m_Mirror = aConfig.m_Printing.mirror;
  }

  override Save(aConfig: APP_SETTINGS_BASE): void {
    super.Save(aConfig);

    aConfig.m_Printing.layers = [];

    for (let layer = 0; layer < this.m_LayerSet.size(); ++layer)
      if (this.m_LayerSet.test(layer)) aConfig.m_Printing.layers.push(layer);

    aConfig.m_Printing.mirror = this.m_Mirror;
  }
}

/**
 * An object derived from wxPrintout to handle the necessary information to
 * control a printer when printing a board.
 */
export abstract class BOARD_PRINTOUT extends wxPrintout {
  /// Source VIEW object (note that actual printing only refers to this object).
  protected m_view: VIEW;
  /// Printout parameters.
  protected m_settings: BOARD_PRINTOUT_SETTINGS;
  /// True if the caller is Gerbview, false for Pcbnew.
  protected m_gerbviewPrint: boolean;

  constructor(aParams: BOARD_PRINTOUT_SETTINGS, aView: VIEW, aTitle: string) {
    super(aTitle);
    this.m_settings = aParams;
    this.m_view = aView;
    this.m_gerbviewPrint = false;
  }

  GetPageInfo(): { minPage: number; maxPage: number; selPageFrom: number; selPageTo: number } {
    return {
      minPage: 1,
      selPageFrom: 1,
      maxPage: this.m_settings.m_pageCount,
      selPageTo: this.m_settings.m_pageCount,
    };
  }

  HasPage(aPage: number): boolean {
    return aPage <= this.m_settings.m_pageCount;
  }

  /**
   * Print a page (or a set of pages).
   *
   * @note This function prepares the print parameters for the function which actually
   * draws the page.
   */
  DrawPage(aLayerName = '', _aPageNum = 1, _aPageCount = 1): void {
    const dc = this.GetDC();
    const options = new GAL_DISPLAY_OPTIONS();
    const galPrint = GAL_PRINT.Create(options, dc);
    const gal = galPrint.GetGAL();
    const printCtx = galPrint.GetPrintCtx();
    const painter = this.getPainter(gal);
    const view = this.m_view.DataReference();

    // Target paper size
    const pageSizePx = this.GetLogicalPageRect();
    const pageSizeIn = { x: pageSizePx.width / dc.GetPPI(), y: pageSizePx.height / dc.GetPPI() };
    const pageSizeIU = {
      x: this.milsToIU(pageSizeIn.x * 1000),
      y: this.milsToIU(pageSizeIn.y * 1000),
    };

    galPrint.SetSheetSize(pageSizeIn);

    view.SetGAL(gal);
    view.SetPainter(painter);
    view.SetScaleLimits(10e9, 0.0001);
    view.SetScale(1.0);

    // Set the color scheme
    const dstSettings = view.GetPainter()!.GetSettings();
    dstSettings.LoadColors(this.m_settings.m_colorSettings);

    if (this.m_settings.m_blackWhite) {
      for (let i = 0; i < LAYER_ID_COUNT; ++i) dstSettings.SetLayerColor(i, COLOR4D_BLACK);

      // In B&W mode, draw the background only in wxhite, because any other color
      // will be replaced by a black background
      dstSettings.SetBackgroundColor(COLOR4D_WHITE);
    } else {
      // color enabled
      for (let i = 0; i < LAYER_ID_COUNT; ++i) {
        // Cairo does not support translucent colors on PostScript surfaces
        dstSettings.SetLayerColor(i, withAlpha(dstSettings.GetLayerColor(i), 1.0));
      }
    }

    dstSettings.SetIsPrinting(true);

    this.setupPainter(painter);
    this.setupViewLayers(view, this.m_settings.m_LayerSet);
    dstSettings.SetPrintLayers(this.m_settings.m_LayerSet);

    dstSettings.SetLayerName(aLayerName);

    const sheetSizeMils = this.m_settings.m_pageInfo.GetSizeMils();
    const sheetSizeIU = { x: this.milsToIU(sheetSizeMils.x), y: this.milsToIU(sheetSizeMils.y) };
    let drawingAreaBBox = new BOX2I({ x: 0, y: 0 }, sheetSizeIU);

    // When printing the board without worksheet items, move board center to the
    // drawing area center.
    if (!this.m_settings.PrintBorderAndTitleBlock()) drawingAreaBBox = this.getBoundingBox();

    view.SetLayerVisible(
      GAL_LAYER_ID.LAYER_DRAWINGSHEET,
      this.m_settings.PrintBorderAndTitleBlock(),
    );

    // Fit to page (drawingAreaBBox)
    if (this.m_settings.m_scale <= 0.0) {
      if (drawingAreaBBox.GetWidth() === 0 || drawingAreaBBox.GetHeight() === 0) {
        // Nothing to print (empty board and no worksheet)
        this.m_settings.m_scale = 1.0;
      } else {
        const scaleX = pageSizeIU.x / drawingAreaBBox.GetWidth();
        const scaleY = pageSizeIU.y / drawingAreaBBox.GetHeight();
        this.m_settings.m_scale = Math.min(scaleX, scaleY);
      }
    }

    this.setupGal(gal);
    galPrint.SetNativePaperSize(pageSizeIn, printCtx.HasNativeLandscapeRotation());
    gal.SetLookAtPoint(drawingAreaBBox.Centre());
    gal.SetZoomFactor(this.m_settings.m_scale);
    gal.SetClearColor(dstSettings.GetBackgroundColor());

    // Clearing the screen for the background color needs the screen set to the page size
    // in pixels.
    const size = gal.GetScreenPixelSize();
    gal.ResizeScreen(pageSizePx.width, pageSizePx.height);
    gal.ClearScreen();
    gal.ResizeScreen(size.x, size.y);

    // Mandatory in Gerbview to use the same order for printing as for screen redraw
    // due to negative objects that need a specific order
    if (this.m_gerbviewPrint) view.UseDrawPriority(true);

    GAL_DRAWING_CONTEXT(gal, () => view.Redraw());

    galPrint.destroy();
  }

  /** Convert mils to internal units. */
  protected abstract milsToIU(aMils: number): number;

  /** Enable layers visibility for a printout. */
  protected setupViewLayers(aView: VIEW, _aLayerSet: LSET): void {
    // Disable all layers by default, let specific implementations enable required layers
    for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; ++i) {
      aView.SetLayerVisible(i, false);
      aView.SetTopLayer(i, false);
      aView.SetLayerTarget(i, RENDER_TARGET.TARGET_NONCACHED);
    }
  }

  /** Configure #PAINTER object for a printout. */
  protected setupPainter(aPainter: PAINTER): void {
    if (!this.m_settings.m_background) aPainter.GetSettings().SetBackgroundColor(COLOR4D_WHITE);
  }

  /** Configure #GAL object for a printout. */
  protected setupGal(aGal: GAL): void {
    aGal.SetFlip(this.m_settings.m_Mirror, false);
  }

  /** Return bounding box of the printed objects (excluding drawing-sheet frame). */
  protected abstract getBoundingBox(): BOX2I;

  /** Return the #PAINTER instance used to draw the items. */
  protected abstract getPainter(aGal: GAL): PAINTER;
}
