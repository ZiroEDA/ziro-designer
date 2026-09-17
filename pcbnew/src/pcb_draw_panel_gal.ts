// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_draw_panel_gal.h` + `.cpp`: `PCB_DRAW_PANEL_GAL`, the board
 * editor's canvas — the GAL layer order and dependencies, the board's
 * display, the high-contrast and top-layer smarts, and the ratsnest.
 */

import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import {
  type DRAW_PANEL_GAL_PARENT,
  type DRAW_PANEL_GAL_WINDOW,
  EDA_DRAW_PANEL_GAL,
  GAL_TYPE,
} from '@ziroeda/common/src/draw_panel_gal.js';
import type { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/src/drawing_sheet/ds_proxy_view_item.js';
import type { EDA_DRAW_FRAME } from '@ziroeda/common/src/eda_draw_frame.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import { RENDER_TARGET } from '@ziroeda/common/src/gal/definitions.js';
import type { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/src/gal/gal_display_options.js';
import {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  BITMAP_LAYER_FOR,
  CLEARANCE_LAYER_FOR,
  Cmts_User,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  GAL_LAYER_ID,
  GetNetnameLayer,
  In1_Cu,
  In10_Cu,
  In11_Cu,
  In12_Cu,
  In13_Cu,
  In14_Cu,
  In15_Cu,
  In16_Cu,
  In17_Cu,
  In18_Cu,
  In19_Cu,
  In2_Cu,
  In20_Cu,
  In21_Cu,
  In22_Cu,
  In23_Cu,
  In24_Cu,
  In25_Cu,
  In26_Cu,
  In27_Cu,
  In28_Cu,
  In29_Cu,
  In3_Cu,
  In30_Cu,
  In4_Cu,
  In5_Cu,
  In6_Cu,
  In7_Cu,
  In8_Cu,
  In9_Cu,
  IsBackLayer,
  IsCopperLayer,
  IsFrontLayer,
  IsNetnameLayer,
  IsNonCopperLayer,
  LAYER_ANCHOR,
  LAYER_BOARD_OUTLINE_AREA,
  LAYER_CONFLICTS_SHADOW,
  LAYER_CURSOR,
  LAYER_DRAWINGSHEET,
  LAYER_DRC_ERROR,
  LAYER_DRC_EXCLUSION,
  LAYER_DRC_SHAPES,
  LAYER_DRC_WARNING,
  LAYER_FOOTPRINTS_BK,
  LAYER_FOOTPRINTS_FR,
  LAYER_FP_REFERENCES,
  LAYER_FP_TEXT,
  LAYER_FP_VALUES,
  LAYER_GP_OVERLAY,
  LAYER_GRID,
  LAYER_GRID_AXES,
  LAYER_LOCKED_ITEM_SHADOW,
  LAYER_MARKER_SHADOWS,
  LAYER_NON_PLATEDHOLES,
  LAYER_PAD_BK_NETNAMES,
  LAYER_PAD_FR_NETNAMES,
  LAYER_PAD_HOLEWALLS,
  LAYER_PAD_NETNAMES,
  LAYER_PAD_PLATEDHOLES,
  LAYER_PADS,
  LAYER_POINTS,
  LAYER_RATSNEST,
  LAYER_SELECT_OVERLAY,
  LAYER_VIA_BLIND,
  LAYER_VIA_BURIED,
  LAYER_VIA_HOLES,
  LAYER_VIA_HOLEWALLS,
  LAYER_VIA_MICROVIA,
  LAYER_VIA_NETNAMES,
  LAYER_VIA_THROUGH,
  LAYER_VIAS,
  Margin,
  NETNAMES_LAYER_ID,
  NETNAMES_LAYER_INDEX,
  PAD_COPPER_LAYER_FOR,
  PCB_LAYER_ID,
  POINT_LAYER_FOR,
  User_1,
  User_10,
  User_11,
  User_12,
  User_13,
  User_14,
  User_15,
  User_16,
  User_17,
  User_18,
  User_19,
  User_2,
  User_20,
  User_21,
  User_22,
  User_23,
  User_24,
  User_25,
  User_26,
  User_27,
  User_28,
  User_29,
  User_3,
  User_30,
  User_31,
  User_32,
  User_33,
  User_34,
  User_35,
  User_36,
  User_37,
  User_38,
  User_39,
  User_4,
  User_40,
  User_41,
  User_42,
  User_43,
  User_44,
  User_45,
  User_5,
  User_6,
  User_7,
  User_8,
  User_9,
  VIA_COPPER_LAYER_FOR,
  ZONE_LAYER_FOR,
} from '@ziroeda/common/src/layer_ids.js';
import { DEFAULT_THEME, GetColorSettings, PgmOrNull } from '@ziroeda/common/src/pgm_base.js';
import { VIEW } from '@ziroeda/common/src/view/view.js';
import { WX_VIEW_CONTROLS } from '@ziroeda/common/src/view/wx_view_controls.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import { ZOOM_MAX_LIMIT_PCBNEW, ZOOM_MIN_LIMIT_PCBNEW } from '@ziroeda/common/src/zoom_defines.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD } from './board.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import type { PCB_BASE_FRAME } from './pcb_base_frame.js';
import { PCB_PAINTER, type PCB_RENDER_SETTINGS } from './pcb_painter.js';
import { PCB_VIEW } from './pcb_view.js';
import type { PCBNEW_SETTINGS } from './pcbnew_settings.js';
import { RATSNEST_VIEW_ITEM } from './ratsnest/ratsnest_view_item.js';

const { LAYER_UI_START, LAYER_UI_END, LAYER_BITMAP_START, LAYER_BITMAP_END } = GAL_LAYER_ID;

/** The per-layer triple the table repeats: the layer, its zone and its points. */
const L3 = (l: number): number[] => [l, ZONE_LAYER_FOR(l), POINT_LAYER_FOR(l)];

/** An inner copper layer's six entries. */
const CU = (l: number): number[] => [
  NETNAMES_LAYER_INDEX(l),
  PAD_COPPER_LAYER_FOR(l),
  VIA_COPPER_LAYER_FOR(l),
  CLEARANCE_LAYER_FOR(l),
  POINT_LAYER_FOR(l),
  l,
  ZONE_LAYER_FOR(l),
];

const USER_LAYERS = [
  User_1,
  User_2,
  User_3,
  User_4,
  User_5,
  User_6,
  User_7,
  User_8,
  User_9,
  User_10,
  User_11,
  User_12,
  User_13,
  User_14,
  User_15,
  User_16,
  User_17,
  User_18,
  User_19,
  User_20,
  User_21,
  User_22,
  User_23,
  User_24,
  User_25,
  User_26,
  User_27,
  User_28,
  User_29,
  User_30,
  User_31,
  User_32,
  User_33,
  User_34,
  User_35,
  User_36,
  User_37,
  User_38,
  User_39,
  User_40,
  User_41,
  User_42,
  User_43,
  User_44,
  User_45,
];

const INNER_CU = [
  In1_Cu,
  In2_Cu,
  In3_Cu,
  In4_Cu,
  In5_Cu,
  In6_Cu,
  In7_Cu,
  In8_Cu,
  In9_Cu,
  In10_Cu,
  In11_Cu,
  In12_Cu,
  In13_Cu,
  In14_Cu,
  In15_Cu,
  In16_Cu,
  In17_Cu,
  In18_Cu,
  In19_Cu,
  In20_Cu,
  In21_Cu,
  In22_Cu,
  In23_Cu,
  In24_Cu,
  In25_Cu,
  In26_Cu,
  In27_Cu,
  In28_Cu,
  In29_Cu,
  In30_Cu,
];

const BITMAP_ORDER_LAYERS = [
  Dwgs_User,
  Cmts_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  Margin,
  ...USER_LAYERS,
  F_Cu,
  F_Mask,
  F_SilkS,
  F_Paste,
  F_Adhes,
  F_CrtYd,
  F_Fab,
  ...INNER_CU,
  B_Cu,
  B_Mask,
  B_SilkS,
  B_Paste,
  B_Adhes,
  B_CrtYd,
  B_Fab,
];

/** `GAL_LAYER_ORDER[]`: the rendering order, first drawn last. */
export const GAL_LAYER_ORDER: readonly number[] = [
  LAYER_UI_START + 9,
  LAYER_UI_START + 8,
  LAYER_UI_START + 7,
  LAYER_UI_START + 6,
  LAYER_UI_START + 5,
  LAYER_UI_START + 4,
  LAYER_UI_START + 3,
  LAYER_UI_START + 2,
  LAYER_UI_START + 1,
  LAYER_UI_START,
  LAYER_GP_OVERLAY,
  LAYER_SELECT_OVERLAY,
  LAYER_CONFLICTS_SHADOW,

  LAYER_DRC_ERROR,
  LAYER_DRC_WARNING,
  LAYER_DRC_EXCLUSION,
  LAYER_MARKER_SHADOWS,
  LAYER_DRC_SHAPES,
  LAYER_PAD_NETNAMES,
  LAYER_VIA_NETNAMES,
  ...L3(Dwgs_User),
  ...L3(Cmts_User),
  ...L3(Eco1_User),
  ...L3(Eco2_User),
  ...L3(Edge_Cuts),
  ...L3(Margin),
  ...USER_LAYERS.flatMap(L3),

  POINT_LAYER_FOR(F_Cu),
  LAYER_FP_TEXT,
  LAYER_FP_REFERENCES,
  LAYER_FP_VALUES,
  LAYER_RATSNEST,
  LAYER_ANCHOR,
  LAYER_POINTS,
  LAYER_LOCKED_ITEM_SHADOW,

  LAYER_VIA_HOLES,
  LAYER_VIA_HOLEWALLS,
  LAYER_PAD_PLATEDHOLES,
  LAYER_PAD_HOLEWALLS,
  LAYER_NON_PLATEDHOLES,
  LAYER_VIA_THROUGH,
  LAYER_VIA_BLIND,
  LAYER_VIA_BURIED,
  LAYER_VIA_MICROVIA,

  LAYER_PAD_FR_NETNAMES,
  NETNAMES_LAYER_INDEX(F_Cu),
  PAD_COPPER_LAYER_FOR(F_Cu),
  VIA_COPPER_LAYER_FOR(F_Cu),
  CLEARANCE_LAYER_FOR(F_Cu),
  // POINT_LAYER_FOR( F_Cu ),
  F_Cu,
  ZONE_LAYER_FOR(F_Cu),
  F_Mask,
  ZONE_LAYER_FOR(F_Mask),
  F_SilkS,
  ZONE_LAYER_FOR(F_SilkS),
  F_Paste,
  ZONE_LAYER_FOR(F_Paste),
  F_Adhes,
  ZONE_LAYER_FOR(F_Adhes),
  F_CrtYd,
  ZONE_LAYER_FOR(F_CrtYd),
  F_Fab,
  ZONE_LAYER_FOR(F_Fab),

  ...INNER_CU.flatMap(CU),

  LAYER_PAD_BK_NETNAMES,
  NETNAMES_LAYER_INDEX(B_Cu),
  PAD_COPPER_LAYER_FOR(B_Cu),
  VIA_COPPER_LAYER_FOR(B_Cu),
  CLEARANCE_LAYER_FOR(B_Cu),
  POINT_LAYER_FOR(B_Cu),
  B_Cu,
  ZONE_LAYER_FOR(B_Cu),
  B_Mask,
  ZONE_LAYER_FOR(B_Mask),
  B_SilkS,
  ZONE_LAYER_FOR(B_SilkS),
  B_Paste,
  ZONE_LAYER_FOR(B_Paste),
  B_Adhes,
  ZONE_LAYER_FOR(B_Adhes),
  B_CrtYd,
  ZONE_LAYER_FOR(B_CrtYd),
  B_Fab,
  ZONE_LAYER_FOR(B_Fab),

  ...BITMAP_ORDER_LAYERS.map(BITMAP_LAYER_FOR),

  LAYER_BOARD_OUTLINE_AREA,
  LAYER_DRAWINGSHEET,
];

export class PCB_DRAW_PANEL_GAL extends EDA_DRAW_PANEL_GAL {
  protected m_drawingSheet: DS_PROXY_VIEW_ITEM | null = null; ///< Currently used drawing-sheet.
  protected m_ratsnest: RATSNEST_VIEW_ITEM | null = null; ///< Ratsnest view item

  constructor(
    aParentWindow: DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null,
    aWindow: DRAW_PANEL_GAL_WINDOW,
    aOptions: GAL_DISPLAY_OPTIONS,
    aGalType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL,
  ) {
    super(aParentWindow, aWindow, aOptions, aGalType);

    this.m_view = new PCB_VIEW();
    this.m_view.SetGAL(this.m_gal!);

    let frameType = FRAME_T.FRAME_FOOTPRINT_PREVIEW;

    if (aParentWindow && typeof (aParentWindow as EDA_DRAW_FRAME).GetFrameType === 'function')
      frameType = (aParentWindow as EDA_DRAW_FRAME).GetFrameType();

    this.m_painter = new PCB_PAINTER(this.m_gal, frameType);
    this.m_view.SetPainter(this.m_painter);

    // This fixes the zoom in and zoom out limits:
    this.m_view.SetScaleLimits(ZOOM_MAX_LIMIT_PCBNEW, ZOOM_MIN_LIMIT_PCBNEW);

    this.setDefaultLayerOrder();
    this.setDefaultLayerDeps();

    // View controls is the first in the event handler chain, so the Tool Framework operates
    // on updated viewport data.
    this.m_viewControls = new WX_VIEW_CONTROLS(this.m_view, this);

    // Load display options (such as filled/outline display of items).
    // Can be made only if the parent window is an EDA_DRAW_FRAME (or a derived class)
    // which is not always the case (namely when it is used from a wxDialog like the pad editor)
    if (!this.IsDialogPreview()) {
      const view = this.m_view as PCB_VIEW;
      const frame = this.pcbFrame();

      if (frame) view.UpdateDisplayOptions(frame.GetDisplayOptions());
    }
  }

  /** `dynamic_cast<PCB_BASE_FRAME*>( GetParentEDAFrame() )`. */
  private pcbFrame(): PCB_BASE_FRAME | null {
    const frame = this.GetParentEDAFrame();

    if (frame && typeof (frame as PCB_BASE_FRAME).GetDisplayOptions === 'function')
      return frame as PCB_BASE_FRAME;

    return null;
  }

  /**
   * Add all items from the current board to the VIEW, so they can be displayed by GAL.
   *
   * @param aBoard is the PCB to be loaded.
   */
  DisplayBoard(aBoard: BOARD, aReporter: PROGRESS_REPORTER_LIKE | null = null): void {
    this.m_view!.Clear();

    aBoard.CacheTriangulation(aReporter);

    if (this.m_drawingSheet) this.m_drawingSheet.SetFileName(aBoard.GetFileName());

    for (const item of aBoard.GetItemSet()) this.m_view!.Add(item);

    aBoard.UpdateBoardOutline();
    this.m_view!.Add(aBoard.BoardOutline());

    // Ratsnest
    if (!aBoard.IsFootprintHolder()) {
      this.m_ratsnest = new RATSNEST_VIEW_ITEM(aBoard.GetConnectivity());
      this.m_view!.Add(this.m_ratsnest);
    }
  }

  /**
   * Sets (or updates) drawing-sheet used by the draw panel.
   *
   * @param aDrawingSheet is the drawing-sheet to be used. The object is then owned by
   *                      PCB_DRAW_PANEL_GAL.
   */
  SetDrawingSheet(aDrawingSheet: DS_PROXY_VIEW_ITEM | null): void {
    if (this.m_drawingSheet) this.m_view!.Remove(this.m_drawingSheet);

    this.m_drawingSheet = aDrawingSheet;

    if (this.m_drawingSheet) this.m_view!.Add(this.m_drawingSheet);
  }

  GetDrawingSheet(): DS_PROXY_VIEW_ITEM | null {
    return this.m_drawingSheet;
  }

  // TODO(JE) Look at optimizing this out
  /**
   * Update the color settings in the painter and GAL.
   */
  UpdateColors(): void {
    let cs = GetColorSettings(DEFAULT_THEME);

    const frame = this.pcbFrame();

    if (frame) {
      cs = frame.GetColorSettings();
    } else {
      const cfg = PgmOrNull()?.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');

      if (cfg) cs = GetColorSettings(cfg.m_ColorTheme);
    }

    console.assert(cs !== null, 'null COLOR_SETTINGS');

    const rs = this.m_view!.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;
    rs.LoadColors(cs);

    this.m_gal!.SetGridColor(cs.GetColor(LAYER_GRID));
    this.m_gal!.SetAxesColor(cs.GetColor(LAYER_GRID_AXES));
    this.m_gal!.SetCursorColor(cs.GetColor(LAYER_CURSOR));
  }

  ///< SetHighContrastLayer(), with some extra smarts for PCB.
  override SetHighContrastLayer(aLayer: number): void {
    // Set display settings for high contrast mode
    const rSettings = this.m_view!.GetPainter().GetSettings();

    this.SetTopLayer(aLayer);
    rSettings.SetActiveLayer(aLayer);

    rSettings.ClearHighContrastLayers();
    rSettings.SetLayerIsHighContrast(aLayer);

    if (IsCopperLayer(aLayer)) {
      // Bring some other layers to the front in case of copper layers and make them colored
      // fixme do not like the idea of storing the list of layers here,
      // should be done in some other way I guess..
      const layers = [
        LAYER_CONFLICTS_SHADOW,
        GetNetnameLayer(aLayer),
        LAYER_PAD_FR_NETNAMES,
        LAYER_PAD_BK_NETNAMES,
        LAYER_PAD_NETNAMES,
        LAYER_VIA_NETNAMES,
        PAD_COPPER_LAYER_FOR(aLayer),
        VIA_COPPER_LAYER_FOR(aLayer),
        ZONE_LAYER_FOR(aLayer),
        BITMAP_LAYER_FOR(aLayer),
        POINT_LAYER_FOR(aLayer),
        LAYER_PAD_PLATEDHOLES,
        LAYER_PAD_HOLEWALLS,
        LAYER_NON_PLATEDHOLES,
        LAYER_VIA_THROUGH,
        LAYER_VIA_BLIND,
        LAYER_VIA_BURIED,
        LAYER_VIA_MICROVIA,
        LAYER_VIA_HOLES,
        LAYER_VIA_HOLEWALLS,
        LAYER_DRC_ERROR,
        LAYER_DRC_WARNING,
        LAYER_DRC_EXCLUSION,
        LAYER_MARKER_SHADOWS,
        LAYER_DRC_SHAPES,
        LAYER_SELECT_OVERLAY,
        LAYER_GP_OVERLAY,
        LAYER_RATSNEST,
        LAYER_CURSOR,
        LAYER_ANCHOR,
        LAYER_LOCKED_ITEM_SHADOW,
      ];

      for (const i of layers) rSettings.SetLayerIsHighContrast(i);

      for (let i = LAYER_UI_START; i < LAYER_UI_END; ++i) rSettings.SetLayerIsHighContrast(i);

      // Pads should be shown too
      if (aLayer === B_Cu) {
        rSettings.SetLayerIsHighContrast(LAYER_FOOTPRINTS_BK);
      } else if (aLayer === F_Cu) {
        rSettings.SetLayerIsHighContrast(LAYER_FOOTPRINTS_FR);
      }
    }

    this.m_view!.UpdateAllLayersColor();
  }

  ///< SetTopLayer(), with some extra smarts for PCB.
  override SetTopLayer(aLayer: number): void {
    this.m_view!.ClearTopLayers();
    this.setDefaultLayerOrder();
    this.m_view!.SetTopLayer(aLayer);

    // Layers that should always have on-top attribute enabled
    const layers = [
      LAYER_VIA_THROUGH,
      LAYER_VIA_BLIND,
      LAYER_VIA_BURIED,
      LAYER_VIA_MICROVIA,
      LAYER_VIA_HOLES,
      LAYER_VIA_HOLEWALLS,
      LAYER_PAD_PLATEDHOLES,
      LAYER_PAD_HOLEWALLS,
      LAYER_NON_PLATEDHOLES,
      LAYER_PAD_NETNAMES,
      LAYER_VIA_NETNAMES,
      LAYER_SELECT_OVERLAY,
      LAYER_GP_OVERLAY,
      LAYER_RATSNEST,
      LAYER_ANCHOR,
      LAYER_DRC_ERROR,
      LAYER_DRC_WARNING,
      LAYER_DRC_EXCLUSION,
      LAYER_MARKER_SHADOWS,
      LAYER_DRC_SHAPES,
      LAYER_CONFLICTS_SHADOW,
    ];

    for (const layer of layers) this.m_view!.SetTopLayer(layer);

    for (let i = LAYER_UI_START; i < LAYER_UI_END; i++) this.m_view!.SetTopLayer(i);

    // Extra layers that are brought to the top if a F.* or B.* is selected
    const frontLayers = [
      F_Cu,
      F_Adhes,
      F_Paste,
      F_SilkS,
      F_Mask,
      F_Fab,
      F_CrtYd,
      LAYER_PAD_FR_NETNAMES,
      NETNAMES_LAYER_INDEX(F_Cu),
    ];

    const backLayers = [
      B_Cu,
      B_Adhes,
      B_Paste,
      B_SilkS,
      B_Mask,
      B_Fab,
      B_CrtYd,
      LAYER_PAD_BK_NETNAMES,
      NETNAMES_LAYER_INDEX(B_Cu),
    ];

    let extraLayers: number[] | null = null;

    // Bring a few more extra layers to the top depending on the selected board side
    if (IsFrontLayer(aLayer)) extraLayers = frontLayers;
    else if (IsBackLayer(aLayer)) extraLayers = backLayers;

    if (extraLayers) {
      for (const layer of extraLayers) {
        this.m_view!.SetTopLayer(layer);

        if (layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT) {
          this.m_view!.SetTopLayer(ZONE_LAYER_FOR(layer));
          this.m_view!.SetTopLayer(PAD_COPPER_LAYER_FOR(layer));
          this.m_view!.SetTopLayer(VIA_COPPER_LAYER_FOR(layer));
          this.m_view!.SetTopLayer(CLEARANCE_LAYER_FOR(layer));
          this.m_view!.SetTopLayer(POINT_LAYER_FOR(layer));
        }
      }

      // Move the active layer to the top of the stack but below all the overlay layers
      if (!IsCopperLayer(aLayer)) {
        this.m_view!.SetLayerOrder(aLayer, this.m_view!.GetLayerOrder(LAYER_MARKER_SHADOWS) + 1);
        this.m_view!.SetLayerOrder(
          ZONE_LAYER_FOR(aLayer),
          this.m_view!.GetLayerOrder(LAYER_MARKER_SHADOWS) + 2,
        );
        this.m_view!.SetLayerOrder(
          POINT_LAYER_FOR(aLayer),
          this.m_view!.GetLayerOrder(LAYER_MARKER_SHADOWS) + 3,
        );

        // Fix up pad and via netnames to be below.  This is hacky, we need a rethink
        // of layer ordering...
        this.m_view!.SetLayerOrder(
          LAYER_PAD_NETNAMES,
          this.m_view!.GetLayerOrder(LAYER_MARKER_SHADOWS) + 4,
        );
        this.m_view!.SetLayerOrder(
          LAYER_VIA_NETNAMES,
          this.m_view!.GetLayerOrder(LAYER_MARKER_SHADOWS) + 5,
        );
      }
    }

    if (IsCopperLayer(aLayer)) {
      this.m_view!.SetTopLayer(ZONE_LAYER_FOR(aLayer));
      this.m_view!.SetTopLayer(PAD_COPPER_LAYER_FOR(aLayer));
      this.m_view!.SetTopLayer(VIA_COPPER_LAYER_FOR(aLayer));
      this.m_view!.SetTopLayer(CLEARANCE_LAYER_FOR(aLayer));

      // Display labels for copper layers on the top
      this.m_view!.SetTopLayer(GetNetnameLayer(aLayer));
    }

    this.m_view!.SetTopLayer(POINT_LAYER_FOR(aLayer));
    this.m_view!.SetTopLayer(BITMAP_LAYER_FOR(aLayer));
    this.m_view!.EnableTopLayer(true);
    this.m_view!.UpdateAllLayersOrder();
  }

  /**
   * Update "visibility" property of each layer of a given #BOARD.
   *
   * @param aBoard contains layers visibility settings to be applied.
   */
  SyncLayersVisibility(aBoard: BOARD): void {
    // Load layer & elements visibility settings
    for (let i = 0; i < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++i)
      this.m_view!.SetLayerVisible(i, aBoard.IsLayerVisible(i as PCB_LAYER_ID));

    for (let i = GAL_LAYER_ID.GAL_LAYER_ID_START; i < GAL_LAYER_ID.GAL_LAYER_ID_END; ++i)
      this.m_view!.SetLayerVisible(i, aBoard.IsElementVisible(i));

    // Via layers controlled by dependencies
    this.m_view!.SetLayerVisible(LAYER_VIA_MICROVIA, true);
    this.m_view!.SetLayerVisible(LAYER_VIA_BLIND, true);
    this.m_view!.SetLayerVisible(LAYER_VIA_BURIED, true);
    this.m_view!.SetLayerVisible(LAYER_VIA_THROUGH, true);

    // Always enable netname layers, as their visibility is controlled by layer dependencies
    for (
      let i = NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_START;
      i < NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_END;
      ++i
    )
      this.m_view!.SetLayerVisible(i, true);

    for (let i = GAL_LAYER_ID.LAYER_ZONE_START; i < GAL_LAYER_ID.LAYER_ZONE_END; i++)
      this.m_view!.SetLayerVisible(i, true);

    for (let i = GAL_LAYER_ID.LAYER_PAD_COPPER_START; i < GAL_LAYER_ID.LAYER_PAD_COPPER_END; i++)
      this.m_view!.SetLayerVisible(i, true);

    for (let i = GAL_LAYER_ID.LAYER_VIA_COPPER_START; i < GAL_LAYER_ID.LAYER_VIA_COPPER_END; i++)
      this.m_view!.SetLayerVisible(i, true);

    for (let i = GAL_LAYER_ID.LAYER_CLEARANCE_START; i < GAL_LAYER_ID.LAYER_CLEARANCE_END; i++)
      this.m_view!.SetLayerVisible(i, false);

    for (let i = GAL_LAYER_ID.LAYER_POINT_START; i < GAL_LAYER_ID.LAYER_POINT_END; i++)
      this.m_view!.SetLayerVisible(i, true);

    for (let i = LAYER_BITMAP_START; i < LAYER_BITMAP_END; i++)
      this.m_view!.SetLayerVisible(i, true);

    for (let i = LAYER_UI_START; i < LAYER_UI_END; i++) this.m_view!.SetLayerVisible(i, true);

    // Enable some layers that are GAL specific
    this.m_view!.SetLayerVisible(LAYER_PAD_PLATEDHOLES, true);
    this.m_view!.SetLayerVisible(LAYER_NON_PLATEDHOLES, true);
    this.m_view!.SetLayerVisible(LAYER_PAD_HOLEWALLS, true);
    this.m_view!.SetLayerVisible(LAYER_VIA_HOLES, true);
    this.m_view!.SetLayerVisible(LAYER_VIA_HOLEWALLS, true);
    this.m_view!.SetLayerVisible(LAYER_GP_OVERLAY, true);
    this.m_view!.SetLayerVisible(LAYER_SELECT_OVERLAY, true);
    this.m_view!.SetLayerVisible(LAYER_RATSNEST, true);
    this.m_view!.SetLayerVisible(LAYER_MARKER_SHADOWS, true);
    this.m_view!.SetLayerVisible(LAYER_DRC_SHAPES, true);
  }

  ///< @copydoc EDA_DRAW_PANEL_GAL::GetMsgPanelInfo()
  override GetMsgPanelInfo(_aFrame: EDA_DRAW_FRAME, aList: MSG_PANEL_ITEM[]): void {
    const board = (this.GetParentEDAFrame() as PCB_BASE_FRAME).GetBoard()!;
    let padCount = 0;
    let viaCount = 0;
    let trackSegmentCount = 0;
    const netCodes = new Set<number>();
    const unconnected = board.GetConnectivity().GetUnconnectedCount(true);

    for (const item of board.Tracks()) {
      if (item.Type() === KICAD_T.PCB_VIA_T) viaCount++;
      else trackSegmentCount++;

      if (item.GetNetCode() > 0) netCodes.add(item.GetNetCode());
    }

    for (const footprint of board.Footprints()) {
      for (const pad of footprint.Pads()) {
        padCount++;

        if (pad.GetNetCode() > 0) netCodes.add(pad.GetNetCode());
      }
    }

    aList.push(new MSG_PANEL_ITEM('Pads', `${padCount}`));
    aList.push(new MSG_PANEL_ITEM('Vias', `${viaCount}`));
    aList.push(new MSG_PANEL_ITEM('Track Segments', `${trackSegmentCount}`));
    aList.push(new MSG_PANEL_ITEM('Nets', `${netCodes.size}`));
    aList.push(new MSG_PANEL_ITEM('Unrouted', `${unconnected}`));
  }

  ///< @copydoc EDA_DRAW_PANEL_GAL::OnShow()
  override OnShow(): void {
    let frame: PCB_BASE_FRAME | null = null;

    if (!this.IsDialogPreview()) frame = this.pcbFrame();

    try {
      // Check if the current rendering back end can be properly initialized
      this.m_view!.UpdateItems();
    } catch (e) {
      console.error((e as Error).message);

      // Use the fallback if we have one
      if (EDA_DRAW_PANEL_GAL.GAL_FALLBACK !== this.m_backend) {
        this.SwitchBackend(EDA_DRAW_PANEL_GAL.GAL_FALLBACK);

        if (frame) frame.ActivateGalCanvas();
      }
    }

    if (frame) {
      this.SetTopLayer(frame.GetActiveLayer());
      const painter = this.m_view!.GetPainter() as PCB_PAINTER;
      const settings = painter.GetSettings();
      settings.LoadDisplayOptions(frame.GetDisplayOptions());
      settings.m_ForceShowFieldsWhenFPSelected =
        frame.GetPcbNewSettings().m_Display.m_ForceShowFieldsWhenFPSelected;
    }
  }

  ///< Reassign layer order to the initial settings.
  protected setDefaultLayerOrder(): void {
    for (let i = 0; i < GAL_LAYER_ORDER.length; ++i) {
      const layer = GAL_LAYER_ORDER[i]!;
      console.assert(layer < VIEW.VIEW_MAX_LAYERS);

      // MW: Gross hack to make SetTopLayer bring the correct bitmap layer to
      // the top of the other bitmaps, but still below all the other layers
      if (layer >= LAYER_BITMAP_START && layer < LAYER_BITMAP_END)
        this.m_view!.SetLayerOrder(layer, i - VIEW.TOP_LAYER_MODIFIER, false);
      else this.m_view!.SetLayerOrder(layer, i, false);
    }

    this.m_view!.SortOrderedLayers();
  }

  override SwitchBackend(aGalType: GAL_TYPE): boolean {
    const rv = super.SwitchBackend(aGalType);

    // The base constructor switches before the PCB_VIEW exists
    if (this.m_view) this.setDefaultLayerDeps();

    this.m_gal!.SetWorldUnitLength(1e-9 /* 1 nm */ / 0.0254 /* 1 inch in meters */);

    return rv;
  }

  ///< Force refresh of the ratsnest visual representation.
  RedrawRatsnest(): void {
    if (this.m_ratsnest) this.m_view!.Update(this.m_ratsnest);
  }

  ///< @copydoc EDA_DRAW_PANEL_GAL::GetDefaultViewBBox()
  override GetDefaultViewBBox(): BOX2I {
    if (this.m_drawingSheet && this.m_view!.IsLayerVisible(LAYER_DRAWINGSHEET))
      return this.m_drawingSheet.ViewBBox();

    return new BOX2I();
  }

  ///< Set rendering targets & dependencies for layers.
  protected setDefaultLayerDeps(): void {
    // caching makes no sense for Cairo and other software renderers
    const target =
      this.m_backend === GAL_TYPE.GAL_TYPE_OPENGL
        ? RENDER_TARGET.TARGET_CACHED
        : RENDER_TARGET.TARGET_NONCACHED;

    for (let i = 0; i < VIEW.VIEW_MAX_LAYERS; i++) this.m_view!.SetLayerTarget(i, target);

    for (let i = 0; i < GAL_LAYER_ORDER.length; ++i) {
      const layer = GAL_LAYER_ORDER[i]!;
      console.assert(layer < VIEW.VIEW_MAX_LAYERS);

      // Set layer display dependencies & targets
      if (IsCopperLayer(layer)) {
        this.m_view!.SetRequired(ZONE_LAYER_FOR(layer), layer);
        this.m_view!.SetRequired(PAD_COPPER_LAYER_FOR(layer), layer);
        this.m_view!.SetRequired(VIA_COPPER_LAYER_FOR(layer), layer);
        this.m_view!.SetRequired(CLEARANCE_LAYER_FOR(layer), layer);
        this.m_view!.SetRequired(POINT_LAYER_FOR(layer), layer);
        this.m_view!.SetRequired(BITMAP_LAYER_FOR(layer), layer);
        this.m_view!.SetLayerTarget(BITMAP_LAYER_FOR(layer), RENDER_TARGET.TARGET_NONCACHED);
        this.m_view!.SetRequired(GetNetnameLayer(layer), layer);
      } else if (IsNonCopperLayer(layer)) {
        this.m_view!.SetRequired(POINT_LAYER_FOR(layer), layer);
        this.m_view!.SetRequired(ZONE_LAYER_FOR(layer), layer);
        this.m_view!.SetLayerTarget(BITMAP_LAYER_FOR(layer), RENDER_TARGET.TARGET_NONCACHED);
        this.m_view!.SetRequired(BITMAP_LAYER_FOR(layer), layer);
      } else if (IsNetnameLayer(layer)) {
        this.m_view!.SetLayerDisplayOnly(layer);
      }
    }

    this.m_view!.SetLayerTarget(LAYER_ANCHOR, RENDER_TARGET.TARGET_NONCACHED);
    this.m_view!.SetLayerDisplayOnly(LAYER_ANCHOR);

    // Use TARGET_OVERLAY for LAYER_CONFLICTS_SHADOW, it is for items
    // that may change while the view stays the same.
    this.m_view!.SetLayerTarget(LAYER_CONFLICTS_SHADOW, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerDisplayOnly(LAYER_LOCKED_ITEM_SHADOW);
    this.m_view!.SetLayerDisplayOnly(LAYER_CONFLICTS_SHADOW);
    this.m_view!.SetLayerDisplayOnly(LAYER_BOARD_OUTLINE_AREA);

    // Some more required layers settings
    this.m_view!.SetRequired(LAYER_PAD_NETNAMES, LAYER_PADS);

    // Holes can be independent of their host objects (cf: printing drill marks)
    this.m_view!.SetRequired(LAYER_VIA_HOLES, LAYER_VIAS);
    this.m_view!.SetRequired(LAYER_VIA_HOLEWALLS, LAYER_VIAS);
    this.m_view!.SetRequired(LAYER_PAD_PLATEDHOLES, LAYER_PADS);
    this.m_view!.SetRequired(LAYER_PAD_HOLEWALLS, LAYER_PADS);
    this.m_view!.SetRequired(LAYER_NON_PLATEDHOLES, LAYER_PADS);

    // Via visibility
    this.m_view!.SetRequired(LAYER_VIA_MICROVIA, LAYER_VIAS);
    this.m_view!.SetRequired(LAYER_VIA_BLIND, LAYER_VIAS);
    this.m_view!.SetRequired(LAYER_VIA_BURIED, LAYER_VIAS);
    this.m_view!.SetRequired(LAYER_VIA_THROUGH, LAYER_VIAS);
    this.m_view!.SetRequired(LAYER_VIA_NETNAMES, LAYER_VIAS);

    this.m_view!.SetLayerTarget(LAYER_SELECT_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerDisplayOnly(LAYER_SELECT_OVERLAY);

    this.m_view!.SetLayerTarget(LAYER_GP_OVERLAY, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerDisplayOnly(LAYER_GP_OVERLAY);

    this.m_view!.SetLayerTarget(LAYER_RATSNEST, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerDisplayOnly(LAYER_RATSNEST);

    this.m_view!.SetLayerTarget(LAYER_DRC_ERROR, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerTarget(LAYER_DRC_WARNING, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerTarget(LAYER_DRC_EXCLUSION, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerTarget(LAYER_MARKER_SHADOWS, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerDisplayOnly(LAYER_MARKER_SHADOWS);
    this.m_view!.SetLayerTarget(LAYER_DRC_SHAPES, RENDER_TARGET.TARGET_OVERLAY);
    this.m_view!.SetLayerDisplayOnly(LAYER_DRC_SHAPES); // markers can't be selected through shapes

    this.m_view!.SetLayerTarget(LAYER_DRAWINGSHEET, RENDER_TARGET.TARGET_NONCACHED);
    this.m_view!.SetLayerDisplayOnly(LAYER_DRAWINGSHEET); // drawing sheet can't be selected
    this.m_view!.SetLayerDisplayOnly(LAYER_GRID); // grid can't be selected

    for (let i = LAYER_UI_START; i < LAYER_UI_END; ++i) {
      this.m_view!.SetLayerTarget(i, RENDER_TARGET.TARGET_OVERLAY);
      this.m_view!.SetLayerDisplayOnly(i);
    }
  }

  override GetView(): PCB_VIEW {
    return this.m_view as PCB_VIEW;
  }
}
