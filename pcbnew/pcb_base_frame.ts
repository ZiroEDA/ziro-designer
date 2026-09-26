// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BASE_FRAME` (include/pcb_base_frame.h, pcbnew/pcb_base_frame.cpp): the
 * base of the board and footprint editors — the board it holds, the model
 * accessor the commit system uses, the origins, the settings accessors and
 * the modify hook. The window, the layer manager and the 3D viewer are the
 * designer's; the settings objects come through two abstract accessors so
 * the designer's stores supply them.
 */
import { EDA_DRAW_FRAME } from '@ziroeda/common/eda_draw_frame.js';
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { RPT_SEVERITY_ACTION, type Severity } from '@ziroeda/common/reporter.js';
import type { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { CLEANUP_FIRST } from './cleanup_item.js';
import type { PAGE_INFO } from '@ziroeda/common/page_info.js';
import type { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { add, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { FOOTPRINT } from './footprint.js';
import type { ZONE } from './zone.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { TOOL_DISPATCHER } from '@ziroeda/common/draw_panel_gal.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { type VIEW_ITEM, VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { BOARD } from './board.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { PAD } from './pad.js';
import { PCB_DISPLAY_OPTIONS, type PCB_PAINTER } from './pcb_painter.js';
import type { PCB_DRAW_PANEL_GAL } from './pcb_draw_panel_gal.js';
import type { PCB_SCREEN } from './pcb_screen.js';
import { PCB_VIA, VIATYPE } from './pcb_track.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import type { BOARD_DESIGN_SETTINGS } from './board_design_settings.js';
import { type BOARD_ITEM, DELETED_BOARD_ITEM } from './board_item.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import { PCB_ORIGIN_TRANSFORMS } from './pcb_origin_transforms.js';
import { PCB_DISPLAY_ORIGIN, type PCBNEW_SETTINGS } from './pcbnew_settings.js';

/**
 * `FOOTPRINT_EDITOR_SETTINGS` as the base frame reads it; the class lands with
 * the settings wiring (#636 stage 6).
 */
export interface FOOTPRINT_EDITOR_SETTINGS_LIKE {
  m_DisplayInvertXAxis: boolean;
  m_DisplayInvertYAxis: boolean;
  m_AngleSnapMode: LEADER_MODE;
}

export abstract class PCB_BASE_FRAME extends EDA_DRAW_FRAME {
  protected m_pcb: BOARD | null = null;
  protected m_originTransforms: PCB_ORIGIN_TRANSFORMS;
  protected m_displayOptions = new PCB_DISPLAY_OPTIONS();

  constructor(aFrameType: FRAME_T, aUnits: EdaUnits = 'mm') {
    super(aFrameType, pcbIUScale, aUnits);
    this.m_originTransforms = new PCB_ORIGIN_TRANSFORMS(this);
  }

  /**
   * Set the #m_Pcb member in such a way that all the derived classes (that have their own
   * board) will point to the same board.
   */
  SetBoard(aBoard: BOARD | null, _aReporter: PROGRESS_REPORTER_LIKE | null = null): void {
    if (this.m_pcb !== aBoard) {
      this.m_pcb = aBoard;

      if (this.GetBoard()) this.GetBoard()!.SetUserUnits(this.GetUserUnits());

      if (this.GetBoard() && this.GetCanvas()) {
        const rs = this.GetCanvas()!.GetView().GetPainter().GetSettings();

        if (rs) {
          rs.SetDashLengthRatio(this.GetBoard()!.GetPlotOptions().GetDashedLineDashRatio());
          rs.SetGapLengthRatio(this.GetBoard()!.GetPlotOptions().GetDashedLineGapRatio());
        }
      }

      this.OnBoardChanged();
    }
  }

  /** `PCB_DRAW_PANEL_GAL* GetCanvas() const override`. */
  override GetCanvas(): PCB_DRAW_PANEL_GAL | null {
    return this.m_canvas as PCB_DRAW_PANEL_GAL | null;
  }

  override GetScreen(): PCB_SCREEN | null {
    return this.m_currentScreen as PCB_SCREEN | null;
  }

  /**
   * Helper to retrieve the current color settings.
   */
  override GetColorSettings(_aForceRefresh = false): COLOR_SETTINGS {
    throw new Error('Color settings requested for a PCB_BASE_FRAME that does not override!');
  }

  /**
   * Display options control the way tracks, vias, outlines and other things are shown
   * (for instance solid or sketch mode).
   */
  GetDisplayOptions(): PCB_DISPLAY_OPTIONS {
    return this.m_displayOptions;
  }

  /**
   * Update the display options and refresh the canvas.
   */
  SetDisplayOptions(aOptions: PCB_DISPLAY_OPTIONS, aRefresh = true): void {
    const hcChanged =
      this.m_displayOptions.m_ContrastModeDisplay !== aOptions.m_ContrastModeDisplay;
    const hcVisChanged =
      this.m_displayOptions.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.HIDDEN ||
      aOptions.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.HIDDEN;
    this.m_displayOptions = aOptions;

    const canvas = this.GetCanvas()!;
    const view = canvas.GetView();

    view.UpdateDisplayOptions(aOptions);
    view.SetMirror(aOptions.m_FlipBoardView, view.IsMirroredY());
    view.RecacheAllItems();

    canvas.SetHighContrastLayer(this.GetActiveLayer());
    this.OnDisplayOptionsChanged();

    // Vias on a restricted layer set must be redrawn when high contrast mode is changed
    if (hcChanged) {
      let showNetNames = false;

      const config = this.config() as PCBNEW_SETTINGS;

      if (config?.m_Display) showNetNames = config.m_Display.m_NetNames > 0;

      // Note: KIGFX::REPAINT isn't enough for things that go from invisible to visible as
      // they won't be found in the view layer's itemset for re-painting.
      this.GetCanvas()!
        .GetView()
        .UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
          if (aItem instanceof PCB_VIA) {
            if (
              aItem.GetViaType() !== VIATYPE.THROUGH ||
              aItem.GetRemoveUnconnected() ||
              showNetNames
            ) {
              return hcVisChanged ? VIEW_UPDATE_FLAGS.ALL : VIEW_UPDATE_FLAGS.REPAINT;
            }
          } else if (aItem instanceof PAD) {
            if (aItem.GetRemoveUnconnected() || showNetNames) {
              return hcVisChanged ? VIEW_UPDATE_FLAGS.ALL : VIEW_UPDATE_FLAGS.REPAINT;
            }
          }

          return 0;
        });
    }

    if (aRefresh) canvas.Refresh();
  }

  OnDisplayOptionsChanged(): void {}

  SetActiveLayer(aLayer: PCB_LAYER_ID): void {
    this.GetScreen()!.m_Active_Layer = aLayer;
  }

  GetActiveLayer(): PCB_LAYER_ID {
    return this.GetScreen()!.m_Active_Layer;
  }

  override ActivateGalCanvas(): void {
    super.ActivateGalCanvas();

    const canvas = this.GetCanvas()!;
    const view = canvas.GetView();

    if (this.m_toolManager) {
      this.m_toolManager.SetEnvironment(
        this.m_pcb,
        view,
        canvas.GetViewControls(),
        this.config(),
        this,
      );

      this.m_toolManager.ResetTools(RESET_REASON.GAL_SWITCH);
    }

    const painter = view.GetPainter() as PCB_PAINTER;
    const settings = painter.GetSettings();
    const displ_opts = this.GetDisplayOptions();

    settings.LoadDisplayOptions(displ_opts);
    settings.LoadColors(this.GetColorSettings());
    settings.m_ForceShowFieldsWhenFPSelected =
      this.GetPcbNewSettings().m_Display.m_ForceShowFieldsWhenFPSelected;

    view.RecacheAllItems();
    canvas.SetEventDispatcher(this.m_toolDispatcher as TOOL_DISPATCHER | null);
    canvas.StartDrawing();
  }

  /** `EDA_EVT_BOARD_CHANGED`, the event `SetBoard` raises. */
  protected OnBoardChanged(): void {}

  GetBoard(): BOARD | null {
    return this.m_pcb;
  }

  /**
   * Return the PCB board or the loaded footprint, whichever the frame edits.
   */
  abstract GetModel(): BOARD_ITEM_CONTAINER | null;

  GetPageSettings(): PAGE_INFO {
    return this.m_pcb!.GetPageSettings();
  }

  GetPageSizeIU(): VECTOR2I {
    // this function is only needed because EDA_DRAW_FRAME is not compiled
    // with either -DPCBNEW or -DEESCHEMA, so the virtual is used to route
    // into an application specific source file.
    return this.m_pcb!.GetPageSettings().GetSizeIU(pcbIUScale.IU_PER_MILS);
  }

  GetGridOrigin(): VECTOR2I {
    return this.m_pcb!.GetDesignSettings().GetGridOrigin();
  }

  SetGridOrigin(aPoint: VECTOR2I): void {
    this.m_pcb!.GetDesignSettings().SetGridOrigin(aPoint);
  }

  GetAuxOrigin(): VECTOR2I {
    return this.m_pcb!.GetDesignSettings().GetAuxOrigin();
  }

  GetUserOrigin(): VECTOR2I {
    let origin: VECTOR2I = { x: 0, y: 0 };

    switch (this.GetPcbNewSettings().m_Display.m_DisplayOrigin) {
      case PCB_DISPLAY_ORIGIN.PCB_ORIGIN_PAGE:
        break;
      case PCB_DISPLAY_ORIGIN.PCB_ORIGIN_AUX:
        origin = this.GetAuxOrigin();
        break;
      case PCB_DISPLAY_ORIGIN.PCB_ORIGIN_GRID:
        origin = this.GetGridOrigin();
        break;
      default:
        console.assert(false);
        break;
    }

    return origin;
  }

  /**
   * Return a reference to the default ORIGIN_TRANSFORMS object
   */
  override GetOriginTransforms(): PCB_ORIGIN_TRANSFORMS {
    return this.m_originTransforms;
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.m_pcb!.GetTitleBlock();
  }

  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.m_pcb!.SetTitleBlock(aTitleBlock);
  }

  /**
   * Return the BOARD_DESIGN_SETTINGS for the open project.
   */
  GetDesignSettings(): BOARD_DESIGN_SETTINGS {
    return this.m_pcb!.GetDesignSettings();
  }

  /**
   * Fetch an item by KIID.
   */
  override ResolveItem(aId: KIID, aAllowNullptrReturn = false): BOARD_ITEM | null {
    return this.GetBoard()!.ResolveItem(aId, aAllowNullptrReturn);
  }

  override GetSeverity(aErrorCode: number): Severity {
    if (aErrorCode >= CLEANUP_FIRST) return RPT_SEVERITY_ACTION;

    const bds = this.GetBoard()!.GetDesignSettings();

    return bds.m_DRCSeverities.get(aErrorCode)!;
  }

  /**
   * `Pgm().GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>( "pcbnew" )`:
   * the designer's settings store supplies the object.
   */
  abstract GetPcbNewSettings(): PCBNEW_SETTINGS;

  /**
   * `EDA_BASE_FRAME::config()` is `Kiface().KifaceSettings()`, which in
   * pcbnew's kiface is its PCBNEW_SETTINGS; FOOTPRINT_EDIT_FRAME overrides it.
   */
  config(): APP_SETTINGS_BASE {
    return this.GetPcbNewSettings();
  }

  /**
   * `Pgm().GetSettingsManager().GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" )`.
   */
  abstract GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE;

  /** `static std::vector<KIID> lastBrightenedItemIDs` of FocusOnItems. */
  private static lastBrightenedItemIDs: KIID[] = [];

  override FocusOnItem(aItem: EDA_ITEM | null, aAllowScroll?: boolean): void;
  override FocusOnItem(
    aItem: BOARD_ITEM | null,
    aLayer?: PCB_LAYER_ID,
    aAllowScroll?: boolean,
  ): void;
  override FocusOnItem(
    aItem: EDA_ITEM | BOARD_ITEM | null,
    b?: boolean | PCB_LAYER_ID,
    c?: boolean,
  ): void {
    if (typeof b === 'boolean' || b === undefined) {
      // FocusOnItem( EDA_ITEM* aItem, bool aAllowScroll )
      // nullptr will clear the current focus
      if (aItem !== null && !aItem.IsBOARD_ITEM()) return;

      this.FocusOnItem(aItem as BOARD_ITEM | null, PCB_LAYER_ID.UNDEFINED_LAYER, b ?? true);
      return;
    }

    const items: BOARD_ITEM[] = [];

    if (aItem) items.push(aItem as BOARD_ITEM);

    this.FocusOnItems(items, b, c ?? true);
  }

  FocusOnItems(
    aItems: BOARD_ITEM[],
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aAllowScroll = true,
  ): void {
    let itemsUnbrightened = false;

    for (const lastBrightenedItemID of PCB_BASE_FRAME.lastBrightenedItemIDs) {
      const lastItem = this.GetBoard()!.ResolveItem(lastBrightenedItemID, true);

      if (lastItem) {
        lastItem.ClearBrightened();
        this.GetCanvas()!.GetView().Update(lastItem);
        itemsUnbrightened = true;
      }
    }

    if (itemsUnbrightened) this.GetCanvas()!.Refresh();

    PCB_BASE_FRAME.lastBrightenedItemIDs = [];

    if (aItems.length === 0) return;

    let focusPt: VECTOR2I = { x: 0, y: 0 };
    const view = this.GetCanvas()!.GetView();
    const viewportPoly = new SHAPE_POLY_SET(view.GetViewport());

    for (const dialog of this.findDialogRects()) {
      // ScreenToClient( dialog->GetScreenPosition() ) / dialog->GetSize(): the rects are
      // already client-relative
      const dialogPoly = new SHAPE_POLY_SET(
        new BOX2D(view.ToWorld(dialog.GetOrigin(), true), view.ToWorld(dialog.GetSize(), false)),
      );

      try {
        viewportPoly.BooleanSubtract(dialogPoly);
      } catch (e) {
        console.error('Clipper exception occurred:', e);
      }
    }

    let itemPoly = new SHAPE_POLY_SET();
    const clippedPoly = new SHAPE_POLY_SET();

    for (const item of aItems) {
      if (item && item !== DELETED_BOARD_ITEM.GetInstance()) {
        item.SetBrightened();
        PCB_BASE_FRAME.lastBrightenedItemIDs.push(item.m_Uuid);

        item.RunOnChildren((child: BOARD_ITEM) => {
          child.SetBrightened();
          PCB_BASE_FRAME.lastBrightenedItemIDs.push(child.m_Uuid);
        }, RECURSE_MODE.RECURSE);

        this.GetCanvas()!.GetView().Update(item);

        // Focus on the object's location.  Prefer a visible part of the object to its anchor
        // in order to keep from scrolling around.

        focusPt = item.GetPosition();

        if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER && item.GetLayerSet().any())
          aLayer = item.GetLayerSet().Seq()[0]!;

        switch (item.Type()) {
          case KICAD_T.PCB_FOOTPRINT_T:
            try {
              itemPoly = (item as FOOTPRINT).GetBoundingHull();
            } catch (e) {
              console.error('Clipper exception occurred:', e);
            }

            break;

          case KICAD_T.PCB_PAD_T:
          case KICAD_T.PCB_MARKER_T:
          case KICAD_T.PCB_VIA_T:
            this.FocusOnLocation(item.GetFocusPosition(), aAllowScroll);
            this.GetCanvas()!.Refresh();
            return;

          case KICAD_T.PCB_SHAPE_T:
          case KICAD_T.PCB_FIELD_T:
          case KICAD_T.PCB_TEXT_T:
          case KICAD_T.PCB_TEXTBOX_T:
          case KICAD_T.PCB_BARCODE_T:
          case KICAD_T.PCB_TRACE_T:
          case KICAD_T.PCB_ARC_T:
          case KICAD_T.PCB_DIM_ALIGNED_T:
          case KICAD_T.PCB_DIM_LEADER_T:
          case KICAD_T.PCB_DIM_CENTER_T:
          case KICAD_T.PCB_DIM_RADIAL_T:
          case KICAD_T.PCB_DIM_ORTHOGONAL_T:
            item.TransformShapeToPolygon(
              itemPoly,
              aLayer,
              0,
              pcbIUScale.mmToIU(0.1),
              ERROR_LOC.ERROR_INSIDE,
            );
            break;

          case KICAD_T.PCB_ZONE_T: {
            const zone = item as ZONE;
            // much faster calculation time when using only the zone outlines
            itemPoly = new SHAPE_POLY_SET(zone.Outline());

            break;
          }

          default: {
            const item_bbox = item.GetBoundingBox();
            itemPoly.NewOutline();
            itemPoly.Append(item_bbox.GetOrigin());
            itemPoly.Append(add(item_bbox.GetOrigin(), { x: item_bbox.GetWidth(), y: 0 }));
            itemPoly.Append(add(item_bbox.GetOrigin(), { x: 0, y: item_bbox.GetHeight() }));
            itemPoly.Append(
              add(item_bbox.GetOrigin(), { x: item_bbox.GetWidth(), y: item_bbox.GetHeight() }),
            );
            break;
          }
        }

        try {
          itemPoly.ClearArcs();
          viewportPoly.ClearArcs();
          clippedPoly.BooleanIntersection(itemPoly, viewportPoly);
        } catch (e) {
          console.error('Clipper exception occurred:', e);
        }

        if (!clippedPoly.IsEmpty()) itemPoly = clippedPoly;
      }
    }

    /*
     * Perform a step-wise deflate to find the visual-center-of-mass
     */

    if (itemPoly.IsEmpty()) {
      this.FocusOnLocation(focusPt, aAllowScroll);
      this.GetCanvas()!.Refresh();
      return;
    }

    const bbox = itemPoly.BBox();
    const step = Math.trunc(Math.min(bbox.GetWidth(), bbox.GetHeight()) / 10);

    // Tiny shapes can quantize to a zero deflate step
    if (step <= 0) {
      this.FocusOnLocation(bbox.Centre(), aAllowScroll);
      this.GetCanvas()!.Refresh();
      return;
    }

    while (!itemPoly.IsEmpty()) {
      focusPt = itemPoly.BBox().Centre();

      try {
        itemPoly.Deflate(step, CornerStrategy.ALLOW_ACUTE_CORNERS, ARC_LOW_DEF);
      } catch (e) {
        console.error('Clipper exception occurred:', e);
      }
    }

    this.FocusOnLocation(focusPt, aAllowScroll);
    this.GetCanvas()!.Refresh();
  }

  ShowSolderMask(): void {
    const view = this.GetCanvas()?.GetView() ?? null;

    if (view && this.GetBoard()?.m_SolderMaskBridges) {
      if (view.HasItem(this.GetBoard()!.m_SolderMaskBridges))
        view.Remove(this.GetBoard()!.m_SolderMaskBridges);

      view.Add(this.GetBoard()!.m_SolderMaskBridges);
    }
  }

  /**
   * Remove the solder-mask bridges zone from the view.
   */
  HideSolderMask(): void {
    const view = this.GetCanvas()?.GetView() ?? null;

    if (
      view &&
      this.GetBoard()?.m_SolderMaskBridges &&
      view.HasItem(this.GetBoard()!.m_SolderMaskBridges)
    )
      view.Remove(this.GetBoard()!.m_SolderMaskBridges);
  }

  /**
   * Update the 3D view, if the viewer is open.
   */
  Update3DView(_aMarkDirty: boolean, _aRefresh: boolean, _aTitle: string | null = null): void {}

  /**
   * Rebuild the ratsnest from the board's connectivity (`ratsnest/ratsnest.cpp`).
   */
  Compile_Ratsnest(aDisplayStatus: boolean): void {
    this.GetBoard()!.GetConnectivity().RecalculateRatsnest();
    this.GetBoard()!.UpdateRatsnestExclusions();
    this.GetBoard()!.OnRatsnestChanged();

    if (aDisplayStatus) this.SetMsgPanel(this.m_pcb!);
  }

  /**
   * Must be called after a change in order to set the "modify" flag and update other data
   * structures and GUI elements.
   */
  override OnModify(): void {
    super.OnModify();

    // GetScreen()->SetContentModified(): PCB_SCREEN lands with the canvas (#636 stage 5)
    this.GetBoard()!.IncrementTimeStamp();

    if (this.m_isClosing) return;

    this.UpdateStatusBar();
    this.UpdateMsgPanel();
  }
}
