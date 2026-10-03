// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZONE_CREATE_HELPER` (pcbnew/tools/zone_create_helper.cpp): the
 * POLYGON_GEOM_MANAGER client DRAWING_TOOL::DrawZone hands its outline to. It
 * makes the zone (from the source zone, or the board defaults through the
 * zone's properties dialog), keeps the POLYGON_ITEM preview in the view, and
 * on completion commits a zone, a zone cutout or a graphic polygon.
 *
 * The properties dialog answers asynchronously here, so `createNewZone` - which
 * upstream calls from `OnFirstPoint`, inside `POLYGON_GEOM_MANAGER::AddPoint` -
 * runs before the first corner is handed to the manager, as
 * `PrepareFirstPoint`; `OnFirstPoint` then finds the zone made or refused.
 */
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { COLOR4D_WHITE } from '@ziroeda/common/gal/color4d.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { POLYGON_ITEM } from '@ziroeda/common/preview_items/polygon_item.js';
import {
  LeaderMode,
  type POLYGON_GEOM_MANAGER,
  type POLYGON_GEOM_MANAGER_CLIENT,
} from '@ziroeda/common/preview_items/polygon_geom_manager.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '../board.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { BOARD_ITEM_CONTAINER } from '../board_item_container.js';
import { DIALOG_NON_COPPER_ZONES_EDITOR } from '../dialogs/dialog_non_copper_zones_properties.js';
import { DIALOG_RULE_AREA_PROPERTIES } from '../dialogs/dialog_rule_area_properties.js';
import { DIALOG_COPPER_ZONE } from '../dialogs/panel_zone_properties.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { TEARDROP_TYPE } from '../teardrop/teardrop_parameters.js';
import { ZONE } from '../zone.js';
import type { ZONE_SETTINGS } from '../zone_settings.js';
import { ZONE_MODE } from './pcb_actions.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';

/** `ZONE_CREATE_HELPER::PARAMS`. */
export interface ZONE_CREATE_PARAMS {
  /** Should create a keepout zone? */
  m_keepout: boolean;
  /** The zone mode to operate in. */
  m_mode: ZONE_MODE;
  /** Zone settings source (for similar and cutout zones). */
  m_sourceZone: ZONE | null;
  /** Layer to begin drawing. */
  m_layer: PCB_LAYER_ID;
}

/** The DRAWING_TOOL as the helper reaches into it (a friend upstream). */
export interface ZONE_CREATE_TOOL {
  GetManager(): TOOL_MANAGER | null;
  getView(): VIEW | null;
  GetAngleSnapMode(): LeaderMode;
  /** `m_tool.m_frame`. */
  editFrame(): PCB_BASE_EDIT_FRAME;
  /** `RunMainStack( [&]() { result = dlg.ShowModal(); } )`, asynchronously. */
  RunMainStackModal<T>(aShow: () => Promise<T>): COROUTINE_BODY<T | null>;
}

export class ZONE_CREATE_HELPER implements POLYGON_GEOM_MANAGER_CLIENT {
  private m_zone: ZONE | null = null;
  private readonly m_previewItem = new POLYGON_ITEM();
  private readonly m_parentView: VIEW;

  constructor(
    private readonly m_tool: ZONE_CREATE_TOOL,
    private readonly m_params: ZONE_CREATE_PARAMS,
  ) {
    this.m_parentView = m_tool.getView()!;
    this.m_parentView.Add(this.m_previewItem);
  }

  /** The destructor: remove the preview from the view. */
  Destroy(): void {
    this.m_parentView.SetVisible(this.m_previewItem, false);
    this.m_parentView.Remove(this.m_previewItem);
  }

  GetZone(): ZONE | null {
    return this.m_zone;
  }

  private setUniquePriority(aZoneInfo: ZONE_SETTINGS): void {
    const board = this.m_tool.editFrame().GetBoard()!;

    // By default, new zones get the first unused priority
    const priorities = new Set<number>();

    for (const zone of board.Zones()) {
      if (
        zone.GetTeardropAreaType() === TEARDROP_TYPE.TD_NONE &&
        zone.GetLayerSet().and(LSET.AllCuMask()).any() &&
        !zone.GetIsRuleArea()
      ) {
        priorities.add(zone.GetAssignedPriority());
      }
    }

    let priority = 0;

    for (const exist_priority of [...priorities].sort((a, b) => a - b)) {
      if (priority !== exist_priority) break;

      ++priority;
    }

    aZoneInfo.m_ZonePriority = priority;
  }

  /** `createNewZone`, whose properties dialog answers asynchronously. */
  private *createNewZone(aKeepout: boolean): COROUTINE_BODY<ZONE | null> {
    const frame = this.m_tool.editFrame();
    const board = frame.GetBoard()!;
    const parent = frame.GetModel();
    const highlightedNets = board.GetHighLightNetCodes();

    // Get the current default settings for zones
    const zoneInfo = board.GetDesignSettings().GetDefaultZoneSettings().clone();
    zoneInfo.m_Layers = new LSET([this.m_params.m_layer]); // TODO(JE) multilayer defaults?
    zoneInfo.m_LayerProperties.clear(); // Do not copy over layer properties
    zoneInfo.m_Netcode = highlightedNets.size === 0 ? -1 : [...highlightedNets][0]!;
    zoneInfo.SetIsRuleArea(aKeepout);
    // A new zone starts unnamed, do not inherit the last drawn zone's name (issue 23131)
    zoneInfo.m_Name = '';

    if (
      this.m_params.m_mode !== ZONE_MODE.GRAPHIC_POLYGON &&
      zoneInfo.m_Layers.and(LSET.AllCuMask()).any()
    ) {
      this.setUniquePriority(zoneInfo);
    }

    // If we don't have a net from highlighting, maybe we can get one from the selection
    const selectionTool = this.m_tool
      .GetManager()!
      .FindTool('common.InteractiveSelection') as unknown as PCB_SELECTION_TOOL | null;

    if (selectionTool && !selectionTool.GetSelection().Empty() && zoneInfo.m_Netcode === -1) {
      const item = selectionTool.GetSelection().GetItems()[0];

      if (item instanceof BOARD_CONNECTED_ITEM) zoneInfo.m_Netcode = item.GetNetCode();
    }

    if (this.m_params.m_mode !== ZONE_MODE.GRAPHIC_POLYGON) {
      // Show options dialog
      let ok: boolean | null;

      if (this.m_params.m_keepout) {
        const dlg = new DIALOG_RULE_AREA_PROPERTIES(frame, null, zoneInfo);
        ok = yield* this.m_tool.RunMainStackModal(() => frame.ShowZoneSettingsDialog(dlg));
      } else if (zoneInfo.m_Layers.and(LSET.AllCuMask()).any()) {
        const dlg = new DIALOG_COPPER_ZONE(frame, null, zoneInfo);
        ok = yield* this.m_tool.RunMainStackModal(() => frame.ShowZoneSettingsDialog(dlg));
      } else {
        const dlg = new DIALOG_NON_COPPER_ZONES_EDITOR(frame, null, zoneInfo);
        ok = yield* this.m_tool.RunMainStackModal(() => frame.ShowZoneSettingsDialog(dlg));
      }

      if (ok !== true) return null;

      const controls = this.m_tool.GetManager()!.GetViewControls();
      controls?.WarpMouseCursor(controls.GetCursorPosition(), true);
    }

    const newZone = new ZONE(parent as unknown as BOARD_ITEM_CONTAINER);

    // Apply the selected settings
    zoneInfo.ExportSetting(newZone);

    return newZone;
  }

  private createZoneFromExisting(aSrcZone: ZONE): ZONE {
    const board = this.m_tool.editFrame().GetBoard()!;
    const newZone = new ZONE(board);

    const zoneSettings = board.GetDesignSettings().GetDefaultZoneSettings().clone();
    zoneSettings.importFrom(aSrcZone);
    zoneSettings.ExportSetting(newZone);

    return newZone;
  }

  private performZoneCutout(aZone: ZONE, aCutout: ZONE): void {
    const commit = new BOARD_COMMIT(this.m_tool.editFrame());
    const newZones: ZONE[] = [];

    // Clear the selection before removing the old zone
    const toolMgr = this.m_tool.GetManager()!;
    toolMgr.RunAction(ACTIONS.selectionClear);

    const originalOutline = aZone.Outline().Clone() as SHAPE_POLY_SET;
    const cutoutOutline = aCutout.Outline().Clone() as SHAPE_POLY_SET;

    // Clipper2 cannot carry arcs through boolean operations when either operand has holes or
    // the clip side has outlines, so strip arc metadata first.
    originalOutline.ClearArcs();
    cutoutOutline.ClearArcs();

    originalOutline.BooleanSubtract(cutoutOutline);

    // After substracting the hole, originalOutline can have more than one main outline.
    // But a zone can have only one main outline, so create as many zones as originalOutline
    // contains main outlines:
    for (let outline = 0; outline < originalOutline.OutlineCount(); outline++) {
      const newZoneOutline = new SHAPE_POLY_SET();
      newZoneOutline.AddOutline(originalOutline.Outline(outline));

      // Add holes (if any) to the new zone outline:
      for (let hole = 0; hole < originalOutline.HoleCount(outline); hole++)
        newZoneOutline.AddHole(originalOutline.CHole(outline, hole));

      const newZone = aZone.Clone();
      newZone.SetOutline(newZoneOutline); // zone takes ownership
      newZone.SetLocalFlags(1);
      newZone.HatchBorder();
      newZone.UnFill();
      newZones.push(newZone);
      commit.Add(newZone);
    }

    commit.Remove(aZone);
    commit.Push('Add Zone Cutout');

    // Select the new zone and set it as the source for the next cutout
    if (newZones.length === 0) {
      this.m_params.m_sourceZone = null;
    } else {
      this.m_params.m_sourceZone = newZones[0]!;
      toolMgr.RunAction(ACTIONS.selectItem, newZones[0]!);
    }
  }

  private commitZone(aZone: ZONE): void {
    switch (this.m_params.m_mode) {
      case ZONE_MODE.CUTOUT:
        // For cutouts, subtract from the source
        this.performZoneCutout(this.m_params.m_sourceZone!, aZone);
        break;

      case ZONE_MODE.ADD:
      case ZONE_MODE.SIMILAR: {
        const commit = new BOARD_COMMIT(this.m_tool.editFrame());
        aZone.HatchBorder();
        commit.Add(aZone);
        commit.Push('Draw Zone');
        this.m_tool.GetManager()!.RunAction(ACTIONS.selectItem, aZone);
        break;
      }

      case ZONE_MODE.GRAPHIC_POLYGON: {
        const commit = new BOARD_COMMIT(this.m_tool.editFrame());
        const board = this.m_tool.editFrame().GetBoard() as BOARD;
        const layer = this.m_params.m_layer;
        const poly = new PCB_SHAPE(this.m_tool.editFrame().GetModel() as unknown as BOARD_ITEM);

        poly.SetShape(SHAPE_T.POLY);
        poly.SetFilled(
          layer !== PCB_LAYER_ID.Edge_Cuts &&
            layer !== PCB_LAYER_ID.F_CrtYd &&
            layer !== PCB_LAYER_ID.B_CrtYd,
        );
        poly.SetStroke(
          new STROKE_PARAMS(board.GetDesignSettings().GetLineThickness(layer), LINE_STYLE.SOLID),
        );
        poly.SetLayer(layer);
        poly.SetPolyShape(aZone.Outline());

        commit.Add(poly);
        commit.Push('Draw Polygon');

        this.m_tool.GetManager()!.RunAction(ACTIONS.selectItem, poly);
        break;
      }
    }
  }

  /**
   * The first half of `OnFirstPoint`: make the zone if there is none yet,
   * through its properties dialog. Answers whether there is a zone now.
   */
  *PrepareFirstPoint(): COROUTINE_BODY<boolean> {
    // if we don't have a zone, create one
    if (!this.m_zone) {
      if (this.m_params.m_sourceZone)
        this.m_zone = this.createZoneFromExisting(this.m_params.m_sourceZone);
      else this.m_zone = yield* this.createNewZone(this.m_params.m_keepout);
    }

    return this.m_zone !== null;
  }

  OnFirstPoint(aMgr: POLYGON_GEOM_MANAGER): boolean {
    if (this.m_zone) {
      this.m_tool.GetManager()!.RunAction(ACTIONS.selectionClear);

      // set up properties from zone
      const settings = this.m_parentView.GetPainter()!.GetSettings();
      const color = settings.GetColor(null, this.m_zone.GetFirstLayer());

      this.m_previewItem.SetStrokeColor(COLOR4D_WHITE);
      this.m_previewItem.SetFillColor({ ...color, a: 0.2 });

      this.m_parentView.SetVisible(this.m_previewItem, true);

      const mode = this.m_tool.GetAngleSnapMode();
      aMgr.SetLeaderMode(mode);
    }

    return this.m_zone !== null;
  }

  OnGeometryChange(aMgr: POLYGON_GEOM_MANAGER): void {
    // Handle a cancel-interactive
    if (this.m_zone && !aMgr.IsPolygonInProgress()) {
      this.m_zone = null;
      this.m_parentView.SetVisible(this.m_previewItem, false);
      return;
    }

    // send the points to the preview item
    this.m_previewItem.SetPoints(
      aMgr.GetLockedInPoints(),
      aMgr.GetLeaderLinePoints(),
      aMgr.GetLoopLinePoints(),
    );
    this.m_parentView.Update(this.m_previewItem, VIEW_UPDATE_FLAGS.GEOMETRY);
  }

  OnComplete(aMgr: POLYGON_GEOM_MANAGER): void {
    const finalPoints = aMgr.GetLockedInPoints();

    if (finalPoints.length < 3 || !this.m_zone) {
      // just scrap the zone in progress
      this.m_zone = null;
    } else {
      // if m_params.m_mode == DRAWING_TOOL::ZONE_MODE::CUTOUT, m_zone will be merged to the
      // existing zone as a new hole.
      this.m_zone.Outline().NewOutline();
      const outline = this.m_zone.Outline();

      for (const p of finalPoints) outline.Append(p);

      // In DEG45 mode, we may have intermediate points in the leader that should be included
      // as they are shown in the preview.  These typically maintain the 45 constraint
      if (aMgr.GetLeaderMode() === LeaderMode.DEG45 || aMgr.GetLeaderMode() === LeaderMode.DEG90) {
        const leaderPts = aMgr.GetLeaderLinePoints();

        for (let i = 1; i < leaderPts.length; i++) outline.Append(leaderPts[i]!);

        const loopPts = aMgr.GetLoopLinePoints();

        for (let i = 1; i < loopPts.length - 1; i++) outline.Append(loopPts[i]!);
      }

      const chain = outline.Outline(0);
      chain.SetClosed(true);
      chain.Simplify(1); // Simplify( true ): an int tolerance, so 1

      // Remove the start point if it lies on the line between neighbouring points.
      // Simplify doesn't handle that currently.
      if (chain.PointCount() >= 3) {
        const seg = new SEG(chain.CLastPoint(), chain.CPoint(1));

        if (seg.LineDistance(chain.CPoint(0)) <= 1) chain.Remove(0);
      }

      // hand the zone over to the committer
      this.commitZone(this.m_zone);
      this.m_zone = null;
    }

    this.m_parentView.SetVisible(this.m_previewItem, false);
  }
}
