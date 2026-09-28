// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_draw_panel_gal.h` + `pl_draw_panel_gal.cpp`:
 * `PL_DRAW_PANEL_GAL`, the Drawing Sheet Editor's canvas — `EDA_DRAW_PANEL_GAL`
 * with `DS_PAINTER`, the drawing sheet's world unit and zoom limits, and
 * `DisplayDrawingSheet`, which puts every `DS_DATA_ITEM`'s draw items and the
 * page-limits item into the VIEW.
 */

import {
  type DRAW_PANEL_GAL_PARENT,
  type DRAW_PANEL_GAL_WINDOW,
  EDA_DRAW_PANEL_GAL,
  GAL_TYPE,
} from '@ziroeda/common/draw_panel_gal.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import {
  DS_DRAW_ITEM_LIST,
  DS_DRAW_ITEM_PAGE,
} from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import { DS_PAINTER } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import type { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import { drawSheetIUScale } from '@ziroeda/common/eda_units.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import type { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import {
  GAL_LAYER_ID,
  LAYER_DRAWINGSHEET,
  LAYER_DRAWINGSHEET_PAGE1,
  LAYER_DRAWINGSHEET_PAGEn,
} from '@ziroeda/common/layer_id.js';
import { DEFAULT_THEME, GetColorSettings, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { WX_VIEW_CONTROLS } from '@ziroeda/common/view/wx_view_controls.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { ZOOM_MAX_LIMIT_PLEDITOR, ZOOM_MIN_LIMIT_PLEDITOR } from '@ziroeda/common/zoom_defines.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { PL_EDITOR_FRAME } from './pl_editor_frame.js';
import type { PL_EDITOR_SETTINGS } from './pl_editor_settings.js';
import { PL_SELECTION_TOOL } from './tools/pl_selection_tool.js';

export class PL_DRAW_PANEL_GAL extends EDA_DRAW_PANEL_GAL {
  /// The item showing the page limits and the coordinate origin marker.
  private m_pageDrawItem: DS_DRAW_ITEM_PAGE | null = null;

  constructor(
    aParentWindow: DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null,
    aWindow: DRAW_PANEL_GAL_WINDOW,
    aOptions: GAL_DISPLAY_OPTIONS,
    aGalType: GAL_TYPE,
  ) {
    super(aParentWindow, aWindow, aOptions, aGalType);

    this.m_view = new VIEW();
    this.m_view.SetGAL(this.m_gal!);

    this.GetGAL().SetWorldUnitLength(
      1.0 / drawSheetIUScale.IU_PER_MM /* 10 nm */ / 25.4 /* 1 inch in mm */,
    );

    this.m_painter = new DS_PAINTER(this.m_gal);

    const cfg =
      PgmOrNull()?.GetSettingsManager().GetAppSettings<PL_EDITOR_SETTINGS>('pl_editor') ?? null;

    this.m_painter
      .GetSettings()
      .LoadColors(GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME));

    this.m_view.SetPainter(this.m_painter);
    // This fixes the zoom in and zoom out limits
    this.m_view.SetScaleLimits(ZOOM_MAX_LIMIT_PLEDITOR, ZOOM_MIN_LIMIT_PLEDITOR);

    this.setDefaultLayerDeps();

    this.m_view.SetLayerVisible(LAYER_DRAWINGSHEET, true);
    this.m_view.SetLayerVisible(LAYER_DRAWINGSHEET_PAGE1, true);
    this.m_view.SetLayerVisible(LAYER_DRAWINGSHEET_PAGEn, false);

    this.m_viewControls = new WX_VIEW_CONTROLS(this.m_view, this);
  }

  /// @copydoc EDA_DRAW_PANEL_GAL::GetMsgPanelInfo()
  override GetMsgPanelInfo(_aFrame: EDA_DRAW_FRAME, _aList: MSG_PANEL_ITEM[]): void {}

  /**
   * Build and update the list of WS_DRAW_ITEM_xxx showing the frame layout
   */
  DisplayDrawingSheet(): void {
    const frame = this.m_edaFrame as PL_EDITOR_FRAME;
    const view = this.m_view!;
    const selTool = frame.GetToolManager()!.GetTool(PL_SELECTION_TOOL)!;
    const model = DS_DATA_MODEL.GetTheInstance();

    selTool.GetSelection().Clear();
    view.Clear();

    this.m_pageDrawItem = null;

    model.SetupDrawEnvironment(frame.GetPageSettings(), drawSheetIUScale.IU_PER_MILS);

    // To show the formatted texts instead of raw texts in drawing sheet editor, we need
    // a dummy DS_DRAW_ITEM_LIST.
    const dummy = new DS_DRAW_ITEM_LIST(drawSheetIUScale);
    dummy.SetPaperFormat(frame.GetPageSettings().GetTypeAsString());
    dummy.SetTitleBlock(frame.GetTitleBlock());
    dummy.SetProject(frame.PrjOrNull());

    for (const dataItem of model.GetItems()) dataItem.SyncDrawItems(dummy, view);

    // Build and add a DS_DRAW_ITEM_PAGE to show the page limits and the corner position
    // of the selected corner for coord origin of new items
    // Not also this item has no peer in DS_DATA_MODEL list.
    const penWidth = 0; // This value is to use the default thickness line
    const markerSize = drawSheetIUScale.mmToIU(5);
    this.m_pageDrawItem = new DS_DRAW_ITEM_PAGE(penWidth, markerSize);
    view.Add(this.m_pageDrawItem);

    selTool.RebuildSelection();

    // Gives a reasonable boundary to the view area
    // Otherwise scroll bars are not usable
    // A full size = 2 * page size allows a margin around the drawing sheet.
    // (Note: no need to have a large working area: nothing can be drawn outside th page size).
    const size_x = frame.GetPageSizeIU().x;
    const size_y = frame.GetPageSizeIU().y;
    const boundary = new BOX2D(
      { x: -size_x / 4, y: -size_y / 4 },
      { x: size_x * 1.5, y: size_y * 1.5 },
    );
    view.SetBoundary(boundary);

    this.m_pageDrawItem.SetPageSize(frame.GetPageSizeIU());
    const originCoord = frame.ReturnCoordOriginCorner();
    this.m_pageDrawItem.SetMarkerPos(originCoord);
  }

  /** The page-limits item `DisplayDrawingSheet` last built. */
  GetPageDrawItem(): DS_DRAW_ITEM_PAGE | null {
    return this.m_pageDrawItem;
  }

  /// @copydoc EDA_DRAW_PANEL_GAL::SwitchBackend()
  override SwitchBackend(aGalType: GAL_TYPE): boolean {
    const rv = super.SwitchBackend(aGalType);

    // The base constructor switches before this class has made its view.
    if (!this.m_view) return rv;

    this.setDefaultLayerDeps();

    this.GetGAL().SetWorldUnitLength(
      1.0 / drawSheetIUScale.IU_PER_MM /* 10 nm */ / 25.4 /* 1 inch in mm */,
    );

    return rv;
  }

  /// @copydoc EDA_DRAW_PANEL_GAL::SetTopLayer()
  override SetTopLayer(aLayer: number): void {
    const view = this.m_view!;

    view.ClearTopLayers();
    view.SetTopLayer(aLayer);

    view.SetTopLayer(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    view.SetTopLayer(GAL_LAYER_ID.LAYER_GP_OVERLAY);

    view.UpdateAllLayersOrder();
  }

  ///< Set rendering targets & dependencies for layers.
  private setDefaultLayerDeps(): void {
    const view = this.m_view!;

    for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; i++)
      view.SetLayerTarget(i, RENDER_TARGET.TARGET_NONCACHED);

    view.SetLayerDisplayOnly(LAYER_DRAWINGSHEET);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_SELECT_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    view.SetLayerTarget(GAL_LAYER_ID.LAYER_GP_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    view.SetLayerDisplayOnly(GAL_LAYER_ID.LAYER_GP_OVERLAY);
  }
}
