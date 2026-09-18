// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME` (pcbnew/pcb_edit_frame.h) — the non-window part the React
 * editor owns: the board, the tool manager wired as `setupTools` wires it,
 * the undo/redo stacks, and the settings the commit and undo code read.
 * `PcbEditor.tsx` is the window.
 *
 * The listener is `BOARD_LISTENER` as the React side subscribes to it: every
 * notification schedules one re-derivation of the view from the BOARD.
 */
import { PARSE_ERROR } from '@ziroeda/common/src/dsnlexer.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/src/eda_draw_frame.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { ENUM_MAP } from '@ziroeda/common/src/properties/property.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import { CLEARANCE_LAYER_FOR, IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { TOOL_MANAGER } from '@ziroeda/common/src/tool/tool_manager.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/src/view/view_item.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/src/board_item.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/src/board_item_container.js';
import { BOARD_LISTENER } from '@ziroeda/pcbnew/src/board_listener.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/pcbnew/src/board_project_settings.js';
import { PAD } from '@ziroeda/pcbnew/src/pad.js';
import { PCB_VIA, VIATYPE } from '@ziroeda/pcbnew/src/pcb_track.js';
import type { PROGRESS_REPORTER_LIKE } from '@ziroeda/pcbnew/src/connectivity/connectivity_algo.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/src/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/src/pcb_base_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/src/pcbnew_settings.js';
import type { PcbnewSettings } from '../../prefs/settings.js';

/**
 * `PCBNEW_SETTINGS`' PARAM list, the part of it the frame, the commit and the
 * undo code read, from the designer's `pcbnew.json` slice
 * (`pcbnew_settings.cpp`'s `pcb_display.*` and `editing.*` rows).
 */
export function pcbnewSettingsOf(json: PcbnewSettings): PCBNEW_SETTINGS {
  const s = new PCBNEW_SETTINGS();
  const d = json.pcb_display;
  const e = json.editing;

  s.m_Display.m_NetNames = d.net_names_mode;
  s.m_ViewersDisplay.m_DisplayPadNumbers = d.pad_numbers;
  s.m_Display.m_TrackClearance = d.track_clearance_mode;
  s.m_Display.m_PadClearance = d.pad_clearance;
  s.m_Display.m_UseViaColorForNormalTHPadstacks = d.pad_use_via_color_for_normal_th_padstacks;
  s.m_Display.m_ForceShowFieldsWhenFPSelected = d.force_show_fields_when_fp_selected;
  s.m_Display.m_Live3DRefresh = d.live_3d_refresh;
  s.m_Display.m_DisplayOrigin = d.origin_mode;
  s.m_Display.m_DisplayInvertXAxis = d.origin_invert_x_axis;
  s.m_Display.m_DisplayInvertYAxis = d.origin_invert_y_axis;
  s.m_Display.m_ShowModuleRatsnest = d.ratsnest_footprint;
  s.m_Display.m_DisplayRatsnestLinesCurved = d.ratsnest_curved;
  s.m_Display.m_RatsnestThickness = d.ratsnest_thickness;
  s.m_ShowPageLimits = d.show_page_borders;
  s.m_ColorTheme = json.appearance.color_theme;

  s.m_AngleSnapMode = e.pcb_angle_snap_mode;
  s.m_RotationAngle = new EDA_ANGLE(e.rotation_angle, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
  s.m_ArcEditMode = e.arc_edit_mode;
  s.m_TrackDragAction = e.track_drag_action;
  s.m_FlipDirection = e.flip_left_right ? FLIP_DIRECTION.LEFT_RIGHT : FLIP_DIRECTION.TOP_BOTTOM;
  s.m_AllowFreePads = e.allow_free_pads;
  s.m_AutoRefillZones = e.auto_fill_zones;
  s.m_MagneticItems.pads = e.magnetic_pads;
  s.m_MagneticItems.tracks = e.magnetic_tracks;
  s.m_MagneticItems.graphics = e.magnetic_graphics;
  s.m_ESCClearsNetHighlight = e.esc_clears_net_highlight;
  s.m_ShowCourtyardCollisions = e.show_courtyard_collisions;
  s.m_CtrlClickHighlight = e.ctrl_click_highlight;
  s.m_PolarCoords = e.polar_coords;

  return s;
}

export interface PCB_EDIT_FRAME_HOOKS {
  /** `PCBNEW_SETTINGS`, read on every access so a changed preference is seen. */
  settings(): PCBNEW_SETTINGS;
  /** `PCB_BASE_FRAME::OnModify`'s effect on the window: the dirty flag. */
  onModify(): void;
  /** `wxMessageBox( _( "Incomplete undo/redo operation: some items not found" ) )`. */
  onUndoRedoIncomplete(): void;
}

export class PCB_EDIT_FRAME extends PCB_BASE_EDIT_FRAME {
  private readonly hooks: PCB_EDIT_FRAME_HOOKS;

  constructor(hooks: PCB_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.hooks = hooks;
    this.setupTools();
  }

  /** `PCB_EDIT_FRAME::setupTools`: the manager, its environment; the tools are stage 3's. */
  private setupTools(): void {
    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(this.m_pcb, null, null, this.hooks.settings(), this);
  }

  override SetBoard(
    aBoard: BOARD | null,
    aBuildConnectivity: boolean | PROGRESS_REPORTER_LIKE | null = true,
    aReporter: PROGRESS_REPORTER_LIKE | null = null,
  ): void {
    // `SetBoard( BOARD*, PROGRESS_REPORTER* )` is `SetBoard( aBoard, true, aReporter )`
    if (typeof aBuildConnectivity !== 'boolean') {
      aReporter = aBuildConnectivity;
      aBuildConnectivity = true;
    }

    // m_pcb->ClearProject() / aBoard->SetProject( &Prj() ): with PROJECT (#636 stage 6)

    super.SetBoard(aBoard, aReporter);

    if (aBuildConnectivity) aBoard!.BuildConnectivity();

    // reload the drawing-sheet: SetPageSettings( aBoard->GetPageSettings() ) is the window's
    // UpdateVariantSelectionCtrl(): the toolbar's
  }

  /**
   * `PCB_EDIT_FRAME::OnBoardLoaded` (pcb_edit_frame.cpp:1933): the layer
   * names into the PCB_LAYER_ID enum map (canonical and user), the DRC engine
   * initialised on the project's rules, the clearance cache filled. The rules
   * file arrives as its text (`GetDesignRulesPath()` is the caller's), null
   * when the project has none; a PARSE_ERROR stays quiet, as upstream's does.
   * The WRL-to-STEP migration below it is the 3D viewer's.
   */
  OnBoardLoaded(aRulesText: string | null, aRulesPath = ''): void {
    const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

    layerEnum.Choices().Clear();
    layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

    for (const layer of LSET.AllLayersMask()) {
      // Canonical name
      layerEnum.Map(layer, LSET.Name(layer));

      // User name
      layerEnum.Map(layer, this.GetBoard()!.GetLayerName(layer));
    }

    const drcEngine = this.GetBoard()!.GetDesignSettings().m_DRCEngine;

    try {
      drcEngine?.InitEngine(aRulesText, aRulesPath);
    } catch (e) {
      // Not sure this is the best place to tell the user their rules are buggy, so
      // we'll stay quiet for now.  Feel free to revisit this decision....
      if (!(e instanceof PARSE_ERROR)) throw e;
    }

    this.GetBoard()!.InitializeClearanceCache();
  }

  /**
   * `PCB_EDIT_FRAME::Clear_Pcb`, the part that outlives the window: the undo
   * and redo lists go because the board is about to be replaced whole.
   */
  Clear_Pcb(): void {
    // Clear undo and redo lists because we want a full deletion
    this.ClearUndoRedoList();
  }

  /**
   * `PCB_EDIT_FRAME::SetActiveLayer( aLayer, aForceRedraw )` (pcb_edit_frame.cpp:1823):
   * the canvas half. The Appearance panel's `OnLayerChanged` is the React
   * state's, and `PCB_ACTIONS::layerChanged` is stage 3's.
   */
  override SetActiveLayer(aLayer: PCB_LAYER_ID, aForceRedraw = false): void {
    const oldLayer = this.GetActiveLayer();

    if (oldLayer === aLayer && !aForceRedraw) return;

    super.SetActiveLayer(aLayer);

    const canvas = this.GetCanvas();

    if (!canvas) return;

    canvas.SetHighContrastLayer(aLayer);

    /*
     * Only show pad, via and track clearances when a copper layer is active
     * and then only show the clearance layer for that copper layer. For
     * front/back non-copper layers, show the clearance layer for the outer
     * layer on that side.
     *
     * For pads/vias, this is to avoid clutter when there are pad/via layers
     * that vary in flash (i.e. clearance from the hole or pad edge), padstack
     * shape on each layer or clearances on each layer.
     *
     * For tracks, this follows the same logic as pads/vias, but in theory could
     * have their own set of independent clearance layers to allow track clearance
     * to be shown for more layers.
     */
    const getClearanceLayerForActive = (aActiveLayer: PCB_LAYER_ID): number | null => {
      if (IsCopperLayer(aActiveLayer)) return CLEARANCE_LAYER_FOR(aActiveLayer);

      return null;
    };

    const oldClearanceLayer = getClearanceLayerForActive(oldLayer);

    if (oldClearanceLayer !== null) canvas.GetView().SetLayerVisible(oldClearanceLayer, false);

    const newClearanceLayer = getClearanceLayerForActive(aLayer);

    if (newClearanceLayer !== null) canvas.GetView().SetLayerVisible(newClearanceLayer, true);

    const contrastMode = this.GetDisplayOptions().m_ContrastModeDisplay;

    canvas.GetView().UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
      if (!aItem.IsBOARD_ITEM()) return 0;

      return PCB_EDIT_FRAME.activeLayerUpdateFlags(
        aItem as BOARD_ITEM,
        oldLayer,
        aLayer,
        contrastMode,
      );
    });

    canvas.Refresh();
  }

  /** `PCB_EDIT_FRAME::activeLayerUpdateFlags` (pcb_edit_frame.cpp:1881). */
  static activeLayerUpdateFlags(
    aItem: BOARD_ITEM,
    aOldLayer: PCB_LAYER_ID,
    aNewLayer: PCB_LAYER_ID,
    aContrastMode: HIGH_CONTRAST_MODE,
  ): number {
    // Note: KIGFX::REPAINT isn't enough for things that go from invisible to visible as they
    // won't be found in the view layer's itemset for re-painting.
    if (aContrastMode === HIGH_CONTRAST_MODE.HIDDEN) {
      if (aItem.IsOnLayer(aOldLayer) || aItem.IsOnLayer(aNewLayer)) return VIEW_UPDATE_FLAGS.ALL;
    }

    // High contrast dims by active layer so all flagged items repaint; without it only the flashed
    // copper geometry depends on the active layer, so re-cache just the items whose flashing changes.
    const highContrast = aContrastMode !== HIGH_CONTRAST_MODE.NORMAL;

    if (aItem instanceof PCB_VIA) {
      const via = aItem;

      if (
        via.GetViaType() === VIATYPE.BLIND ||
        via.GetViaType() === VIATYPE.BURIED ||
        via.GetViaType() === VIATYPE.MICROVIA
      ) {
        if (highContrast || via.GetLayerSet().test(aOldLayer) !== via.GetLayerSet().test(aNewLayer))
          return VIEW_UPDATE_FLAGS.REPAINT;
      }

      if (
        via.GetRemoveUnconnected() &&
        (highContrast || via.FlashLayer(aOldLayer) !== via.FlashLayer(aNewLayer))
      ) {
        return VIEW_UPDATE_FLAGS.ALL;
      }
    } else if (aItem instanceof PAD) {
      const pad = aItem;

      if (
        pad.GetRemoveUnconnected() &&
        (highContrast || pad.FlashLayer(aOldLayer) !== pad.FlashLayer(aNewLayer))
      ) {
        return VIEW_UPDATE_FLAGS.ALL;
      }
    }

    return 0;
  }

  GetName(): string {
    return PCB_EDIT_FRAME_NAME;
  }

  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }

  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.hooks.settings();
  }

  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return { m_DisplayInvertXAxis: false, m_DisplayInvertYAxis: false };
  }

  override OnModify(): void {
    super.OnModify();
    this.hooks.onModify();
  }

  protected override ShowUndoRedoIncompleteMessage(): void {
    this.hooks.onUndoRedoIncomplete();
  }
}

/**
 * The React side's BOARD_LISTENER: whatever the board reports, the view is
 * re-derived once, after the current commit or undo has finished — the
 * listener is invoked in the middle of both.
 */
export class REACT_BOARD_LISTENER extends BOARD_LISTENER {
  private pending = false;
  /**
   * The items the notifications since the last re-derivation named, so the
   * view keeps every other item's object (`boardFromBOARD`'s `aUnchanged`);
   * null once a notification named no items (net settings), which means
   * every item's view is re-derived.
   */
  private touched: Set<BOARD_ITEM> | null = new Set();

  constructor(private readonly refresh: (aUnchanged: ((k: BOARD_ITEM) => boolean) | null) => void) {
    super();
  }

  /** True between a notification and the re-derivation it scheduled. */
  IsPending(): boolean {
    return this.pending;
  }

  private note(aItems: readonly BOARD_ITEM[]): void {
    if (!this.touched) return;
    for (const item of aItems) {
      this.touched.add(item);
      // A footprint's children are viewed through the footprint.
      const fp = item.GetParentFootprint();
      if (fp) this.touched.add(fp);
    }
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      const touched = this.touched;
      this.touched = new Set();
      this.refresh(touched ? (k) => !touched.has(k) : null);
    });
  }

  override OnBoardItemAdded(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsAdded(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardItemRemoved(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsRemoved(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardItemChanged(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsChanged(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardCompositeUpdate(
    _aBoard: BOARD,
    aAddedItems: BOARD_ITEM[],
    aRemovedItems: BOARD_ITEM[],
    aChangedItems: BOARD_ITEM[],
  ): void {
    this.note(aAddedItems);
    this.note(aRemovedItems);
    this.note(aChangedItems);
    this.schedule();
  }
  override OnBoardNetSettingsChanged(_aBoard: BOARD): void {
    this.touched = null;
    this.schedule();
  }
}
