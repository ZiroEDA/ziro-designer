// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_preview_panel.h` / `.cpp`: SCH_PREVIEW_PANEL, the canvas a symbol or design
 * block preview draws on - an EDA_DRAW_PANEL_GAL over an SCH_VIEW with no frame, the default
 * colour theme, no pin types or forced pin numbers, and every layer uncached (an alias's fields
 * cannot substitute their parent's values, so they may not draw themselves).
 *
 * No caller yet: SYMBOL_PREVIEW_WIDGET and the design block preview, which build one, are not
 * ported. wx's `SetEvtHandlerEnabled`/`Show`/`Raise` have no counterpart on a panel here (the
 * page shows the canvas); the rest of the constructor is upstream's.
 */
import {
  type DRAW_PANEL_GAL_PARENT,
  type DRAW_PANEL_GAL_WINDOW,
  EDA_DRAW_PANEL_GAL,
  GAL_TYPE,
} from '@ziroeda/common/draw_panel_gal.js';
import type { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import type { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { DEFAULT_THEME, GetColorSettings } from '@ziroeda/common/pgm_base.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { WX_VIEW_CONTROLS } from '@ziroeda/common/view/wx_view_controls.js';
import {
  ZOOM_MAX_LIMIT_EESCHEMA_PREVIEW,
  ZOOM_MIN_LIMIT_EESCHEMA_PREVIEW,
} from '@ziroeda/common/zoom_defines.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { SCH_PAINTER } from './sch_painter.js';
import type { SCH_RENDER_SETTINGS } from './sch_render_settings.js';
import { SCH_LAYER_ORDER, SCH_VIEW, SCH_WORLD_UNIT } from './sch_view.js';

export class SCH_PREVIEW_PANEL extends EDA_DRAW_PANEL_GAL {
  constructor(
    aParentWindow: DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null,
    aWindow: DRAW_PANEL_GAL_WINDOW,
    aOptions: GAL_DISPLAY_OPTIONS,
    aGalType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL,
  ) {
    super(aParentWindow, aWindow, aOptions, aGalType);

    this.m_view = new SCH_VIEW(null);
    this.m_view.SetGAL(this.m_gal!);

    this.m_gal!.SetWorldUnitLength(SCH_WORLD_UNIT);

    this.m_painter = new SCH_PAINTER(this.m_gal);

    const renderSettings = this.GetRenderSettings();
    renderSettings.LoadColors(GetColorSettings(DEFAULT_THEME));
    renderSettings.m_ShowPinsElectricalType = false;
    renderSettings.m_ShowPinNumbers = false;
    renderSettings.m_TextOffsetRatio = 0.35;

    this.m_view.SetPainter(this.m_painter);
    // This fixes the zoom in and zoom out limits:
    this.m_view.SetScaleLimits(ZOOM_MAX_LIMIT_EESCHEMA_PREVIEW, ZOOM_MIN_LIMIT_EESCHEMA_PREVIEW);
    this.m_view.SetMirror(false, false);

    this.setDefaultLayerOrder();
    this.setDefaultLayerDeps();

    this.view().UpdateAllLayersOrder();
    // View controls is the first in the event handler chain, so the Tool Framework operates
    // on updated viewport data.
    this.m_viewControls = new WX_VIEW_CONTROLS(this.m_view, this);

    this.m_gal!.SetGridColor(
      this.m_painter.GetSettings().GetLayerColor(SCH_LAYER_ID.LAYER_SCHEMATIC_GRID),
    );
    this.m_gal!.SetCursorEnabled(false);
    this.m_gal!.SetGridSize({ x: schIUScale.milsToIU(100.0), y: schIUScale.milsToIU(100.0) });

    this.SetFocus();
    this.StartDrawing();
  }

  GetRenderSettings(): SCH_RENDER_SETTINGS {
    return this.m_painter!.GetSettings() as SCH_RENDER_SETTINGS;
  }

  override OnShow(): void {
    //m_view->RecacheAllItems();
  }

  protected setDefaultLayerOrder(): void {
    for (let i = 0; i < SCH_LAYER_ORDER.length; ++i) {
      const layer = SCH_LAYER_ORDER[i]!;
      this.m_view!.SetLayerOrder(layer, i);
    }
  }

  protected setDefaultLayerDeps(): void {
    // An alias's fields don't know how to substitute in their parent's values, so we
    // don't let them draw themselves.  This means no caching.
    const target = RENDER_TARGET.TARGET_NONCACHED;
    const view = this.m_view!;

    for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; i++) view.SetLayerTarget(i, target);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_GP_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_GP_OVERLAY);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_DRAWINGSHEET, RENDER_TARGET.TARGET_NONCACHED);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_DRAWINGSHEET);
  }

  protected view(): SCH_VIEW {
    return this.m_view as SCH_VIEW;
  }

  protected override onPaint(): void {
    if (this.IsShownOnScreen()) super.onPaint();
  }
}
