// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview_draw_panel_gal.h` + `.cpp`: `GERBVIEW_DRAW_PANEL_GAL`,
 * GerbView's canvas. It is `EDA_DRAW_PANEL_GAL` - the same VIEW, OPENGL_GAL
 * and view controls the board editor draws through - with GerbView's painter,
 * its layer order and its world unit.
 */

import {
  type DRAW_PANEL_GAL_PARENT,
  type DRAW_PANEL_GAL_WINDOW,
  EDA_DRAW_PANEL_GAL,
  GAL_TYPE,
} from '@ziroeda/common/draw_panel_gal.js';
import type { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import type { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import type { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import {
  GAL_LAYER_ID,
  GERBER_DCODE_LAYER,
  GERBER_DRAW_LAYER,
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { DEFAULT_THEME, GetColorSettings } from '@ziroeda/common/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { WX_VIEW_CONTROLS } from '@ziroeda/common/view/wx_view_controls.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { ZOOM_MAX_LIMIT_GERBVIEW, ZOOM_MIN_LIMIT_GERBVIEW } from '@ziroeda/common/zoom_defines.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { GERBER_FILE_IMAGE_LIST } from './gerber_file_image_list.js';
import { gerbIUScale } from './gerbview.js';
import { GERBVIEW_PAINTER, type GERBVIEW_RENDER_SETTINGS } from './gerbview_painter.js';

/**
 * What the panel asks of `GERBVIEW_FRAME` through
 * `dynamic_cast<GERBVIEW_FRAME*>( GetParentEDAFrame() )`: the three calls
 * `gerbview_draw_panel_gal.cpp` makes. The frame class itself is
 * `gerbview_frame`, which is still `designer/.../GerberViewer.tsx`
 * (gerbview/STRUCTURE.md); this names the members it will carry.
 */
export interface GERBVIEW_FRAME_FOR_PANEL {
  GetActiveLayer(): number;
  GetImagesList(): GERBER_FILE_IMAGE_LIST;
  GetColorSettings(aForceRefresh?: boolean): COLOR_SETTINGS;
}

function isGerbviewFrame(aFrame: unknown): aFrame is GERBVIEW_FRAME_FOR_PANEL {
  return (
    aFrame !== null &&
    typeof aFrame === 'object' &&
    typeof (aFrame as GERBVIEW_FRAME_FOR_PANEL).GetImagesList === 'function' &&
    typeof (aFrame as GERBVIEW_FRAME_FOR_PANEL).GetActiveLayer === 'function'
  );
}

export class GERBVIEW_DRAW_PANEL_GAL extends EDA_DRAW_PANEL_GAL {
  /// Currently used drawing-sheet.
  protected m_drawingSheet: DS_PROXY_VIEW_ITEM | null = null;

  constructor(
    aParentWindow: DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null,
    aWindow: DRAW_PANEL_GAL_WINDOW,
    aOptions: GAL_DISPLAY_OPTIONS,
    aGalType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL,
  ) {
    super(aParentWindow, aWindow, aOptions, aGalType);

    this.m_view = new VIEW();
    this.m_view.SetGAL(this.m_gal!);
    this.GetGAL().SetWorldUnitLength(
      1.0 / gerbIUScale.IU_PER_MM /* 10 nm upstream; see gerbview.ts */ / 25.4 /* 1 inch in mm */,
    );

    this.m_painter = new GERBVIEW_PAINTER(this.m_gal);
    this.m_view.SetPainter(this.m_painter);

    // This fixes the zoom in and zoom out limits:
    this.m_view.SetScaleLimits(ZOOM_MAX_LIMIT_GERBVIEW, ZOOM_MIN_LIMIT_GERBVIEW);

    this.m_viewControls = new WX_VIEW_CONTROLS(this.m_view, this);

    this.setDefaultLayerDeps();

    let cs = GetColorSettings(DEFAULT_THEME);
    const frame = this.gerbviewFrame();

    if (frame) cs = frame.GetColorSettings();

    const renderSettings = this.m_painter.GetSettings() as GERBVIEW_RENDER_SETTINGS;
    renderSettings.LoadColors(cs);
  }

  /** `dynamic_cast<GERBVIEW_FRAME*>( GetParentEDAFrame() )`. */
  private gerbviewFrame(): GERBVIEW_FRAME_FOR_PANEL | null {
    const frame: unknown = this.GetParentEDAFrame();

    return isGerbviewFrame(frame) ? frame : null;
  }

  /// @copydoc EDA_DRAW_PANEL_GAL::SetHighContrastLayer
  override SetHighContrastLayer(aLayer: number): void {
    // Set display settings for high contrast mode
    const rSettings = this.m_view!.GetPainter().GetSettings();

    this.SetTopLayer(aLayer);

    rSettings.ClearHighContrastLayers();
    rSettings.SetLayerIsHighContrast(aLayer);
    rSettings.SetLayerIsHighContrast(GERBER_DCODE_LAYER(aLayer));

    this.m_view!.UpdateAllLayersColor();
  }

  /// @copydoc EDA_DRAW_PANEL_GAL::GetMsgPanelInfo
  override GetMsgPanelInfo(_aFrame: EDA_DRAW_FRAME, _aList: MSG_PANEL_ITEM[]): void {}

  /// @copydoc EDA_DRAW_PANEL_GAL::OnShow
  override OnShow(): void {
    const frame = this.gerbviewFrame();

    if (frame) this.SetTopLayer(frame.GetActiveLayer());

    this.m_view!.RecacheAllItems();
  }

  override SwitchBackend(aGalType: GAL_TYPE): boolean {
    const rv = super.SwitchBackend(aGalType);

    // The base constructor switches before this class has made its view; the
    // rest is for a later switch (`m_view` is null in C++ there too, and
    // setDefaultLayerDeps would dereference it).
    if (!this.m_view) return rv;

    // The next onPaint event will call m_view->UpdateItems() that is very time consuming
    // after switching to opengl. Clearing m_view and rebuild it is much faster
    if (aGalType === GAL_TYPE.GAL_TYPE_OPENGL) {
      const frame = this.gerbviewFrame();

      if (frame) {
        this.m_view.Clear();

        for (let layer = GERBER_DRAWLAYERS_COUNT - 1; layer >= 0; --layer) {
          const gerber = frame.GetImagesList().GetGbrImage(layer);

          if (gerber === null)
            // Graphic layer not yet used
            continue;

          for (const item of gerber.GetItems()) this.m_view.Add(item);
        }
      }
    }

    this.setDefaultLayerDeps();

    this.GetGAL().SetWorldUnitLength(1.0 / gerbIUScale.IU_PER_MM / 25.4);

    return rv;
  }

  /**
   * Set the drawing sheet used by the draw panel. The object is then owned by
   * GERBVIEW_DRAW_PANEL_GAL.
   */
  SetDrawingSheet(aDrawingSheet: DS_PROXY_VIEW_ITEM): void {
    this.m_drawingSheet = aDrawingSheet;
    this.m_view!.Add(this.m_drawingSheet);
  }

  /** @return the current drawing sheet. */
  GetDrawingSheet(): DS_PROXY_VIEW_ITEM | null {
    return this.m_drawingSheet;
  }

  /// @copydoc EDA_DRAW_PANEL_GAL::SetTopLayer
  override SetTopLayer(aLayer: number): void {
    const view = this.m_view!;

    view.ClearTopLayers();

    for (let i = 0; i < GERBER_DRAWLAYERS_COUNT; ++i) {
      view.SetLayerOrder(GERBER_DCODE_LAYER(GERBER_DRAW_LAYER(i)), GERBER_DRAW_LAYER(2 * i));
      view.SetLayerOrder(GERBER_DRAW_LAYER(i), GERBER_DRAW_LAYER(2 * i + 1));
    }

    view.SetTopLayer(aLayer);

    // Move DCODE layer to the top
    view.SetTopLayer(GERBER_DCODE_LAYER(aLayer));

    view.SetTopLayer(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    view.SetTopLayer(GAL_LAYER_ID.LAYER_GP_OVERLAY);

    view.UpdateAllLayersOrder();
  }

  override GetDefaultViewBBox(): BOX2I {
    // Even in Gervbview, LAYER_DRAWINGSHEET controls the visibility of the drawingsheet
    if (this.m_drawingSheet && this.m_view!.IsLayerVisible(GAL_LAYER_ID.LAYER_DRAWINGSHEET))
      return this.m_drawingSheet.ViewBBox();

    return new BOX2I();
  }

  /// Set rendering targets & dependencies for layers.
  protected setDefaultLayerDeps(): void {
    const view = this.m_view!;

    // caching makes no sense for Cairo and other software renderers
    const target =
      this.m_backend === GAL_TYPE.GAL_TYPE_OPENGL
        ? RENDER_TARGET.TARGET_CACHED
        : RENDER_TARGET.TARGET_NONCACHED;

    for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; i++) view.SetLayerTarget(i, target);

    view.SetLayerDisplayOnly(GERBVIEW_LAYER_ID.LAYER_DCODES);
    view.SetLayerDisplayOnly(GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS);
    view.SetLayerDisplayOnly(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID);
    view.SetLayerDisplayOnly(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_AXES);
    view.SetLayerDisplayOnly(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_BACKGROUND);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_DRAWINGSHEET);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_GP_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_GP_OVERLAY);
  }
}
