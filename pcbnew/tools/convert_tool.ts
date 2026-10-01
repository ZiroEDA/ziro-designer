// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONVERT_TOOL` (`pcbnew/tools/convert_tool.cpp`, `convert_tool.h`): Create
 * Polygon / Zone / Rule Area / Lines / Tracks / Arc from Selection and Outset
 * Items, on the live BOARD through a BOARD_COMMIT, with the "Create from
 * Selection" submenu its Init adds to the selection tool's menu.
 *
 * The modal dialogs (`CONVERT_SETTINGS_DIALOG`, the three zone editors with
 * their conversion box, `SelectOneLayer`, `DIALOG_OUTSET_ITEMS`) are the
 * frame's, asked through {@link CONVERT_TOOL_FRAME} as promises: `ShowModal()`
 * blocks upstream, and the code after it runs in the promise's continuation
 * here, as EDIT_TOOL does for its dialogs.
 */
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import {
  IsCopperLayer,
  IsNonCopperLayer,
  PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { EVENTS } from '@ziroeda/common/tool/actions.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import { SELECTION_CONDITIONS as S_C } from '@ziroeda/common/tool/selection_conditions.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ROUNDRECT } from '@ziroeda/kimath/src/geometry/roundrect.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { Perpendicular, ResizeI, type Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcCenterI } from '@ziroeda/kimath/src/trigo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { BOARD_ITEM_CONTAINER } from '../board_item_container.js';
import type { FOOTPRINT } from '../footprint.js';
import type { NETINFO_ITEM } from '../netinfo.js';
import type { PAD } from '../pad.js';
import type { PCB_BARCODE } from '../pcb_barcode.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TEXT } from '../pcb_text.js';
import { PCB_ARC, PCB_TRACK } from '../pcb_track.js';
import { CONVERT_SETTINGS, CONVERT_STRATEGY } from '../pcbnew_settings.js';
import { ZONE } from '../zone.js';
import type { ZONE_SETTINGS } from '../zone_settings.js';
import {
  CALLABLE_BASED_HANDLER,
  OUTSET_ROUTINE,
  type OUTSET_PARAMETERS,
} from './item_modification_routine.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_SELECTION_CONDITIONS as P_S_C } from './pcb_selection_conditions.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { GetBoardItemWidth } from './pcb_tool_utils.js';

const { BOUNDING_HULL, CENTERLINE, COPY_LINEWIDTH } = CONVERT_STRATEGY;

/** The frame's modal dialogs, as CONVERT_TOOL raises them. */
export interface CONVERT_TOOL_FRAME {
  /**
   * `CONVERT_SETTINGS_DIALOG( frame, aSettings, aShowCopyLineWidthOption,
   * aShowCenterlineOption, aShowBoundingHullOption ).ShowModal() == wxID_OK`:
   * on OK the dialog has written `aSettings`.
   */
  ShowConvertSettingsDialog(
    aSettings: CONVERT_SETTINGS,
    aShowCopyLineWidthOption: boolean,
    aShowCenterlineOption: boolean,
    aShowBoundingHullOption: boolean,
  ): Promise<boolean>;
  /**
   * `InvokeRuleAreaEditor` / `InvokeNonCopperZonesEditor` /
   * `InvokeCopperZonesEditor( frame, nullptr, ... )` with a conversion box:
   * true for wxID_OK, after the dialog has written both settings.
   */
  ShowZoneEditorForConversion(
    aKind: 'ruleArea' | 'nonCopper' | 'copper',
    aZoneSettings: ZONE_SETTINGS,
    aConvertSettings: CONVERT_SETTINGS,
  ): Promise<boolean>;
  /** `PCB_BASE_FRAME::SelectOneLayer( aDefaultLayer, aNotAllowedLayersMask )`: UNDEFINED_LAYER on cancel. */
  SelectOneLayer(aDefaultLayer: PCB_LAYER_ID, aNotAllowedLayersMask: LSET): Promise<PCB_LAYER_ID>;
  /** `DIALOG_OUTSET_ITEMS( frame, aParams ).ShowModal() != wxID_CANCEL`: on OK it wrote `aParams`. */
  ShowOutsetItemsDialog(aParams: OUTSET_PARAMETERS): Promise<boolean>;
  /** `EDA_BASE_FRAME::ShowInfoBarMsg`. */
  ShowInfoBarMsg(aMsg: string): void;
}

type FRAME = PCB_BASE_EDIT_FRAME & CONVERT_TOOL_FRAME;

/** The `static OUTSET_ROUTINE::PARAMETERS` OutsetItems keeps between runs, one per editor. */
let s_outset_params_fp_edit: OUTSET_PARAMETERS | null = null;
let s_outset_params_pcb_edit: OUTSET_PARAMETERS | null = null;

/** Forget the persistent outset settings (tests). */
export function ResetOutsetParams(): void {
  s_outset_params_fp_edit = null;
  s_outset_params_pcb_edit = null;
}

const samePoint = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

export class CONVERT_TOOL extends PCB_TOOL_BASE {
  private m_selectionTool: PCB_SELECTION_TOOL | null = null;
  /** `m_menu`, which hides TOOL_INTERACTIVE's TOOL_MENU of the same name upstream. */
  private m_convertMenu: CONDITIONAL_MENU | null = null;
  private m_frame: FRAME | null = null;
  m_userSettings = new CONVERT_SETTINGS();

  constructor() {
    super('pcbnew.Convert');
    this.initUserSettings();
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  override Reset(_aReason: RESET_REASON): void {}

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    this.m_selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;
    this.m_frame = this.getEditFrame<FRAME>();

    // Create a context menu and make it available through selection tool
    this.m_convertMenu = new CONDITIONAL_MENU(this);
    this.m_convertMenu.SetIcon(BITMAPS.convert);
    this.m_convertMenu.SetUntranslatedTitle('Create from Selection');

    const padTypes = [KICAD_T.PCB_PAD_T];
    const toArcTypes = [KICAD_T.PCB_ARC_T, KICAD_T.PCB_TRACE_T, KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T];
    const shapeTypes = [
      KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T,
      KICAD_T.PCB_SHAPE_LOCATE_RECT_T,
      KICAD_T.PCB_SHAPE_LOCATE_CIRCLE_T,
      KICAD_T.PCB_SHAPE_LOCATE_ARC_T,
      KICAD_T.PCB_SHAPE_LOCATE_BEZIER_T,
      KICAD_T.PCB_FIELD_T,
      KICAD_T.PCB_TEXT_T,
      KICAD_T.PCB_BARCODE_T,
    ];
    const trackTypes = [KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T, KICAD_T.PCB_VIA_T];
    const toTrackTypes = [KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T, KICAD_T.PCB_SHAPE_LOCATE_ARC_T];
    const polyTypes = [
      KICAD_T.PCB_ZONE_T,
      KICAD_T.PCB_SHAPE_LOCATE_POLY_T,
      KICAD_T.PCB_SHAPE_LOCATE_RECT_T,
    ];
    const outsetTypes = [KICAD_T.PCB_PAD_T, KICAD_T.PCB_SHAPE_T];

    const shapes = S_C.And(S_C.OnlyTypes(shapeTypes), P_S_C.SameLayer());
    const graphicToTrack = S_C.OnlyTypes(toTrackTypes);
    const anyTracks = S_C.And(
      S_C.And(S_C.MoreThan(0), S_C.OnlyTypes(trackTypes)),
      P_S_C.SameLayer(),
    );
    const anyPolys = S_C.OnlyTypes(polyTypes);
    const anyPads = S_C.OnlyTypes(padTypes);

    const canCreateArcs = S_C.And(S_C.Count(1), S_C.OnlyTypes(toArcTypes));
    const canCreateArray = S_C.MoreThan(0);
    let canCreatePoly = S_C.Or(S_C.Or(shapes, anyPolys), anyTracks);

    const canCreateOutset = S_C.OnlyTypes(outsetTypes);

    if (this.m_frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR))
      canCreatePoly = S_C.Or(S_C.Or(S_C.Or(shapes, anyPolys), anyTracks), anyPads);

    const canCreateLines = anyPolys;
    const canCreateTracks = S_C.Or(anyPolys, graphicToTrack);
    const canCreate = [
      canCreateLines,
      canCreateTracks,
      canCreateArcs,
      canCreateArray,
      canCreateOutset,
    ].reduce(S_C.Or, canCreatePoly);

    this.m_convertMenu.AddItem(PCB_ACTIONS.convertToPoly, canCreatePoly);

    if (this.m_frame.IsType(FRAME_T.FRAME_PCB_EDITOR))
      this.m_convertMenu.AddItem(PCB_ACTIONS.convertToZone, canCreatePoly);

    this.m_convertMenu.AddItem(PCB_ACTIONS.convertToKeepout, canCreatePoly);
    this.m_convertMenu.AddItem(PCB_ACTIONS.convertToLines, canCreateLines);
    this.m_convertMenu.AddItem(PCB_ACTIONS.outsetItems, canCreateOutset);
    this.m_convertMenu.AddSeparator();

    // Currently the code exists, but tracks are not really existing in footprints
    // only segments on copper layers
    if (this.m_frame.IsType(FRAME_T.FRAME_PCB_EDITOR))
      this.m_convertMenu.AddItem(PCB_ACTIONS.convertToTracks, canCreateTracks);

    this.m_convertMenu.AddItem(PCB_ACTIONS.convertToArc, canCreateArcs);

    this.m_convertMenu.AddSeparator();
    this.m_convertMenu.AddItem(PCB_ACTIONS.createArray, canCreateArray);

    const selToolMenu = this.m_selectionTool.GetToolMenu().GetMenu();
    selToolMenu.AddMenu(this.m_convertMenu, canCreate, 100);

    return true;
  }

  /** The submenu Init built, for the window's context menu (TRANSITIONAL). */
  GetMenu(): CONDITIONAL_MENU | null {
    return this.m_convertMenu;
  }

  /**
   * Initialize the user settings for the tool.
   */
  private initUserSettings(): void {
    this.m_userSettings.m_Strategy = CENTERLINE;
    this.m_userSettings.m_Gap = 0;
    this.m_userSettings.m_LineWidth = 0;
    this.m_userSettings.m_DeleteOriginals = true;
  }

  /**
   * Convert selected lines to a polygon, if possible.
   */
  CreatePolys(aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const bds = frame.GetBoard()!.GetDesignSettings();
    const polys: SHAPE_POLY_SET[] = [];
    const destLayer = frame.GetActiveLayer();
    let parentFootprint: FOOTPRINT | null = null;

    const selection = this.m_selectionTool!.RequestSelection(() => {});

    if (selection.Empty()) return 0;

    const getPolys = (cfg: CONVERT_SETTINGS): boolean => {
      polys.length = 0;

      for (const item of selection) item.ClearTempFlags();

      const polySet = new SHAPE_POLY_SET();

      polySet.Append(this.makePolysFromClosedGraphics(selection.GetItems(), cfg.m_Strategy));

      if (cfg.m_Strategy === BOUNDING_HULL) {
        polySet.Append(this.makePolysFromOpenGraphics(selection.GetItems(), 0));

        polySet.ClearArcs();
        polySet.Simplify();

        // Now inflate the bounding hull by cfg.m_Gap
        // (the C++ passes ERROR_OUTSIDE, 0, where Inflate takes aSimplify)
        polySet.Inflate(cfg.m_Gap, CornerStrategy.ROUND_ALL_CORNERS, bds.m_MaxError, false);
      } else {
        polySet.Append(this.makePolysFromChainedSegs(selection.GetItems(), cfg.m_Strategy));
      }

      if (polySet.IsEmpty()) return false;

      for (let ii = 0; ii < polySet.OutlineCount(); ++ii) {
        polys.push(new SHAPE_POLY_SET(polySet.COutline(ii)));

        for (let jj = 0; jj < polySet.HoleCount(ii); ++jj)
          polys[polys.length - 1]!.AddHole(polySet.Hole(ii, jj));
      }

      return true;
    };

    // Pre-flight getPolys() to see if there's anything to convert.
    const preflightSettings = Object.assign(new CONVERT_SETTINGS(), this.m_userSettings);
    preflightSettings.m_Strategy = BOUNDING_HULL;

    if (!getPolys(preflightSettings)) return 0;

    const front = selection.Front();

    if (front?.IsBOARD_ITEM()) parentFootprint = (front as BOARD_ITEM).GetParentFootprint();

    const layer = frame.GetActiveLayer();
    const commit = new BOARD_COMMIT(frame);

    /** The tail both branches share: delete the originals and push. */
    const finish = (): void => {
      if (this.m_userSettings.m_DeleteOriginals) {
        const selectionCopy = [...selection.GetItems()];
        this.m_selectionTool!.ClearSelection();

        for (const item of selectionCopy) {
          if (item.GetFlags() & SKIP_STRUCT) commit.Remove(item);
        }
      }

      if (aEvent.IsAction(PCB_ACTIONS.convertToPoly)) {
        if (this.m_userSettings.m_DeleteOriginals) commit.Push('Convert to Polygon');
        else commit.Push('Create Polygon');
      } else {
        if (this.m_userSettings.m_DeleteOriginals) commit.Push('Convert to Zone');
        else commit.Push('Create Zone');
      }
    };

    if (aEvent.IsAction(PCB_ACTIONS.convertToPoly)) {
      let showCopyLineWidth = true;

      // No copy-line-width option for pads
      if (selection.Front()!.Type() === KICAD_T.PCB_PAD_T) {
        if (this.m_userSettings.m_Strategy === COPY_LINEWIDTH)
          this.m_userSettings.m_Strategy = CENTERLINE;

        showCopyLineWidth = false;
      }

      const previousSettings = Object.assign(new CONVERT_SETTINGS(), this.m_userSettings);

      void frame
        .ShowConvertSettingsDialog(this.m_userSettings, showCopyLineWidth, true, true)
        .then((ok) => {
          if (!ok) return;

          const resolvedSettings = Object.assign(new CONVERT_SETTINGS(), this.m_userSettings);

          if (resolvedSettings.m_Strategy !== CENTERLINE) {
            if (resolvedSettings.m_LineWidth === 0)
              resolvedSettings.m_LineWidth = bds.m_LineThickness[bds.GetLayerClass(layer)]!;
          }

          if (resolvedSettings.m_Strategy === BOUNDING_HULL) {
            if (resolvedSettings.m_Gap > 0)
              resolvedSettings.m_Gap += Math.round(resolvedSettings.m_LineWidth / 2.0);
          }

          if (!getPolys(resolvedSettings)) {
            let msg: string;

            if (resolvedSettings.m_Strategy === BOUNDING_HULL)
              msg = 'Resulting polygon would be empty';
            else msg = 'Objects must form a closed shape';

            DisplayErrorMessage('Could not convert selection', msg);

            this.m_userSettings = previousSettings;
            return;
          }

          for (const poly of polys) {
            const graphic = new PCB_SHAPE(parentFootprint);

            if (resolvedSettings.m_Strategy === COPY_LINEWIDTH) {
              let topLeftItem: BOARD_ITEM | null = null;
              let pos: VECTOR2I;

              for (const item of selection) {
                if (!item.IsBOARD_ITEM()) continue;

                const candidate = item as BOARD_ITEM;

                if (candidate.HasLineStroke()) {
                  pos = candidate.GetPosition();

                  if (
                    !topLeftItem ||
                    pos.x < topLeftItem.GetPosition().x ||
                    (topLeftItem.GetPosition().x === pos.x && pos.y < topLeftItem.GetPosition().y)
                  ) {
                    topLeftItem = candidate;
                    resolvedSettings.m_LineWidth = topLeftItem.GetStroke().GetWidth();
                  }
                }
              }
            }

            graphic.SetShape(SHAPE_T.POLY);
            graphic.SetStroke(
              new STROKE_PARAMS(
                resolvedSettings.m_LineWidth,
                LINE_STYLE.SOLID,
                COLOR4D_UNSPECIFIED,
              ),
            );
            graphic.SetFilled(resolvedSettings.m_Strategy === CENTERLINE);
            graphic.SetLayer(destLayer);
            graphic.SetPolyShape(poly);

            commit.Add(graphic);
          }

          finish();
        });
    } else {
      // Creating zone or keepout
      const parent: BOARD_ITEM_CONTAINER | null = frame.GetModel();
      const zoneInfo = bds.GetDefaultZoneSettings().clone();

      const nonCopper = IsNonCopperLayer(destLayer);
      zoneInfo.m_Layers = new LSET().set(destLayer);
      zoneInfo.m_Name = '';

      // No copy-line-width option for zones/keepouts
      if (this.m_userSettings.m_Strategy === COPY_LINEWIDTH)
        this.m_userSettings.m_Strategy = CENTERLINE;

      let kind: 'ruleArea' | 'nonCopper' | 'copper';

      if (aEvent.IsAction(PCB_ACTIONS.convertToKeepout)) {
        zoneInfo.SetIsRuleArea(true);
        kind = 'ruleArea';
      } else if (nonCopper) {
        zoneInfo.SetIsRuleArea(false);
        kind = 'nonCopper';
      } else {
        zoneInfo.SetIsRuleArea(false);
        kind = 'copper';
      }

      void frame.ShowZoneEditorForConversion(kind, zoneInfo, this.m_userSettings).then((ok) => {
        if (!ok) return;

        if (!getPolys(this.m_userSettings)) return;

        for (const poly of polys) {
          const zone = new ZONE(parent);

          zone.SetOutline(poly);
          zone.HatchBorder();

          zoneInfo.ExportSetting(zone);

          commit.Add(zone);
        }

        finish();
      });
    }

    return 0;
  }

  /**
   * Try to make polygons from chained segments in the selected items.
   *
   * Polygons are formed from chains of lines/arcs.  Each set containing two or more lines/arcs
   * that are connected will be added to the return SHAPE_POLY_SET as an outline.  No attempt
   * is made to guess at holes.
   */
  makePolysFromChainedSegs(
    aItems: readonly EDA_ITEM[],
    aStrategy: CONVERT_STRATEGY,
  ): SHAPE_POLY_SET {
    // Using a large epsilon here to allow for sloppy drawing can cause the algorithm to miss very
    // short segments in a converted bezier.  So use an epsilon only large enough to cover for
    // rouding errors in the conversion.
    const chainingEpsilon = 100; // max dist from one endPt to next startPt in IU

    const poly = new SHAPE_POLY_SET();

    // Stores pairs of (anchor, item) where anchor == 0 -> SEG.A, anchor == 1 -> SEG.B.
    // std::map<VECTOR2I, ...>: keyed by value, iterated in (x, y) order.
    const connections = new Map<string, { key: VECTOR2I; list: [number, EDA_ITEM][] }>();
    const keyOf = (p: VECTOR2I): string => `${p.x},${p.y}`;
    const sortedConnections = (): { key: VECTOR2I; list: [number, EDA_ITEM][] }[] =>
      [...connections.values()].sort((a, b) => a.key.x - b.key.x || a.key.y - b.key.y);
    const at = (p: VECTOR2I): [number, EDA_ITEM][] => {
      let e = connections.get(keyOf(p));

      if (!e) {
        e = { key: { ...p }, list: [] };
        connections.set(keyOf(p), e);
      }

      return e.list;
    };

    // Canonical key each (item, anchor) endpoint was filed under.  Re-running findInsertionPoint()
    // during the walk is order-dependent and could resolve to a different bucket once the map is
    // fully populated, so the walk reuses these stored keys instead.
    const connectionKeys = new Map<EDA_ITEM, [VECTOR2I, VECTOR2I]>();

    const toCheck: EDA_ITEM[] = [];

    const closeEnough = (aLeft: VECTOR2I, aRight: VECTOR2I, aLimit: number): boolean => {
      const dx = aLeft.x - aRight.x;
      const dy = aLeft.y - aRight.y;
      return dx * dx + dy * dy <= aLimit * aLimit;
    };

    const findInsertionPoint = (aPoint: VECTOR2I): VECTOR2I => {
      if (connections.has(keyOf(aPoint))) return aPoint;

      for (const candidatePair of sortedConnections()) {
        if (closeEnough(aPoint, candidatePair.key, chainingEpsilon)) return candidatePair.key;
      }

      return aPoint;
    };

    for (const item of aItems) {
      const seg = CONVERT_TOOL.getStartEndPoints(item);

      if (seg) {
        toCheck.push(item);

        const keyA = findInsertionPoint(seg.A);
        const keyB = findInsertionPoint(seg.B);

        at(keyA).push([0, item]);
        at(keyB).push([1, item]);

        connectionKeys.set(item, [keyA, keyB]);
      }
    }

    while (toCheck.length > 0) {
      const insertedItems: BOARD_ITEM[] = [];

      const candidate = toCheck.shift()!;

      if (candidate.GetFlags() & SKIP_STRUCT) continue;

      const outline = new SHAPE_LINE_CHAIN();

      const insert = (aItem: EDA_ITEM, aAnchor: VECTOR2I, aDirection: boolean): void => {
        if (aItem.IsType([KICAD_T.PCB_ARC_T, KICAD_T.PCB_SHAPE_LOCATE_ARC_T])) {
          let arc: SHAPE_ARC;

          if (aItem.Type() === KICAD_T.PCB_ARC_T) {
            const pcb_arc = aItem as unknown as PCB_ARC;
            arc = new SHAPE_ARC(pcb_arc.GetEffectiveShape() as unknown as SHAPE_ARC);
          } else {
            const pcb_shape = aItem as unknown as PCB_SHAPE;
            arc = new SHAPE_ARC(
              pcb_shape.GetStart(),
              pcb_shape.GetArcMid(),
              pcb_shape.GetEnd(),
              pcb_shape.GetWidth(),
            );
          }

          if (aDirection) outline.Append(samePoint(aAnchor, arc.GetP0()) ? arc : arc.Reversed());
          else outline.Insert(0, samePoint(aAnchor, arc.GetP0()) ? arc : arc.Reversed());

          insertedItems.push(aItem as BOARD_ITEM);
        } else if (aItem.IsType([KICAD_T.PCB_SHAPE_LOCATE_BEZIER_T])) {
          const graphic = aItem as unknown as PCB_SHAPE;

          if (samePoint(aAnchor, graphic.GetStart())) {
            for (const pt of graphic.GetBezierPoints()) {
              if (aDirection) outline.Append(pt);
              else outline.Insert(0, pt);
            }
          } else {
            for (const pt of [...graphic.GetBezierPoints()].reverse()) {
              if (aDirection) outline.Append(pt);
              else outline.Insert(0, pt);
            }
          }

          insertedItems.push(aItem as BOARD_ITEM);
        } else {
          const nextSeg = CONVERT_TOOL.getStartEndPoints(aItem);

          if (nextSeg) {
            const point = samePoint(aAnchor, nextSeg.A) ? nextSeg.B : nextSeg.A;

            if (aDirection) outline.Append(point);
            else outline.Insert(0, point);

            insertedItems.push(aItem as BOARD_ITEM);
          }
        }
      };

      // Walk by anchor index rather than by point.  MCAD splines leave sub-chainingEpsilon gaps
      // at the junctions, so neighbouring endpoints do not compare equal and a point-based lookup
      // would dead-end the walk; connectionKeys maps each (item, anchor) back to the bucket it was
      // filed under.

      // aDirection == true for walking "right" and appending to the end of points
      // false for walking "left" and prepending to the beginning
      const process = (aItem: EDA_ITEM, aAnchor: number, aDirection: boolean): void => {
        if (aItem.GetFlags() & SKIP_STRUCT) return;

        aItem.SetFlags(SKIP_STRUCT);

        const anchors = CONVERT_TOOL.getStartEndPoints(aItem)!;

        insert(aItem, aAnchor === 0 ? anchors.A : anchors.B, aDirection);

        const nextAnchor = 1 - aAnchor;

        for (const pair of [...at(connectionKeys.get(aItem)![nextAnchor]!)]) {
          if (pair[1] === aItem) continue;

          process(pair[1], pair[0], aDirection);
        }
      };

      const anchors = CONVERT_TOOL.getStartEndPoints(candidate)!;

      // Start with the first object and walk "right"
      // Note if the first object is an arc, we don't need to insert its first point here, the
      // whole arc will be inserted at anchor B inside process()
      if (!candidate.IsType([KICAD_T.PCB_ARC_T, KICAD_T.PCB_SHAPE_LOCATE_ARC_T]))
        insert(candidate, anchors.A, true);

      process(candidate, 1, true);

      // check for any candidates on the "left"
      let left: EDA_ITEM | null = null;
      let leftAnchor = 0;

      for (const possibleLeft of at(connectionKeys.get(candidate)![0])) {
        if (possibleLeft[1] !== candidate) {
          left = possibleLeft[1];
          leftAnchor = possibleLeft[0];
          break;
        }
      }

      if (left) process(left, leftAnchor, false);

      if (
        outline.PointCount() < 3 ||
        !closeEnough(outline.GetPoint(0), outline.GetPoint(-1), chainingEpsilon)
      ) {
        for (const item of insertedItems) item.ClearFlags(SKIP_STRUCT);

        continue;
      }

      outline.SetClosed(true);

      poly.AddOutline(outline);

      if (aStrategy === BOUNDING_HULL) {
        for (const item of insertedItems)
          item.TransformShapeToPolygon(
            poly,
            UNDEFINED_LAYER,
            0,
            item.GetMaxError(),
            ERROR_LOC.ERROR_INSIDE,
          );
      }

      insertedItems.length = 0;
    }

    return poly;
  }

  /**
   * Make polygons from graphic shapes and zones.
   */
  makePolysFromOpenGraphics(aItems: readonly EDA_ITEM[], aGap: number): SHAPE_POLY_SET {
    const poly = new SHAPE_POLY_SET();

    for (const item of aItems) {
      if (item.GetFlags() & SKIP_STRUCT) continue;

      switch (item.Type()) {
        case KICAD_T.PCB_SHAPE_T: {
          const shape = item as unknown as PCB_SHAPE;

          if (shape.IsClosed()) continue;

          shape.TransformShapeToPolygon(
            poly,
            UNDEFINED_LAYER,
            aGap,
            shape.GetMaxError(),
            ERROR_LOC.ERROR_INSIDE,
          );
          shape.SetFlags(SKIP_STRUCT);

          break;
        }

        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T: {
          const track = item as unknown as PCB_TRACK;

          track.TransformShapeToPolygon(
            poly,
            UNDEFINED_LAYER,
            aGap,
            track.GetMaxError(),
            ERROR_LOC.ERROR_INSIDE,
          );
          track.SetFlags(SKIP_STRUCT);

          break;
        }

        default:
          continue;
      }
    }

    return poly;
  }

  makePolysFromClosedGraphics(
    aItems: readonly EDA_ITEM[],
    aStrategy: CONVERT_STRATEGY,
  ): SHAPE_POLY_SET {
    const poly = new SHAPE_POLY_SET();

    for (const item of aItems) {
      if (item.GetFlags() & SKIP_STRUCT) continue;

      switch (item.Type()) {
        case KICAD_T.PCB_SHAPE_T: {
          const shape = item as unknown as PCB_SHAPE;
          const wasFilled = shape.GetFillMode();

          if (!shape.IsClosed()) continue;

          if (shape.GetShape() === SHAPE_T.CIRCLE && aStrategy !== BOUNDING_HULL) {
            const c = shape.GetCenter();
            const R = shape.GetRadius();
            const arc = new SHAPE_ARC(
              { x: c.x - R, y: c.y },
              { x: c.x + R, y: c.y },
              { x: c.x - R, y: c.y },
              0,
            );

            poly.NewOutline();
            poly.Append(arc);
          } else {
            if (aStrategy !== BOUNDING_HULL) shape.SetFilled(true);

            shape.TransformShapeToPolygon(
              poly,
              UNDEFINED_LAYER,
              0,
              shape.GetMaxError(),
              ERROR_LOC.ERROR_INSIDE,
              aStrategy !== BOUNDING_HULL,
            );

            if (aStrategy !== BOUNDING_HULL) shape.SetFillMode(wasFilled);
          }

          shape.SetFlags(SKIP_STRUCT);
          break;
        }

        case KICAD_T.PCB_ZONE_T:
          poly.Append((item as unknown as ZONE).Outline());
          item.SetFlags(SKIP_STRUCT);
          break;

        case KICAD_T.PCB_FIELD_T:
        case KICAD_T.PCB_TEXT_T: {
          const text = item as unknown as PCB_TEXT;
          text.TransformTextToPolySet(poly, 0, text.GetMaxError(), ERROR_LOC.ERROR_INSIDE);
          text.SetFlags(SKIP_STRUCT);
          break;
        }

        case KICAD_T.PCB_BARCODE_T: {
          const barcode = item as unknown as PCB_BARCODE;

          if (aStrategy === BOUNDING_HULL)
            barcode.GetBoundingHull(
              poly,
              UNDEFINED_LAYER,
              0,
              barcode.GetMaxError(),
              ERROR_LOC.ERROR_INSIDE,
            );
          else
            barcode.TransformShapeToPolySet(
              poly,
              UNDEFINED_LAYER,
              0,
              barcode.GetMaxError(),
              ERROR_LOC.ERROR_INSIDE,
            );

          barcode.SetFlags(SKIP_STRUCT);
          break;
        }

        case KICAD_T.PCB_PAD_T: {
          const pad = item as unknown as PAD;

          pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
            const layerPoly = new SHAPE_POLY_SET();
            pad.TransformShapeToPolygon(
              layerPoly,
              aLayer,
              0,
              pad.GetMaxError(),
              ERROR_LOC.ERROR_INSIDE,
            );
            poly.BooleanAdd(layerPoly);
          });

          pad.SetFlags(SKIP_STRUCT);
          break;
        }

        default:
          continue;
      }
    }

    return poly;
  }

  /**
   * Convert selected polygon-like object to graphic lines, if possible.
   */
  CreateLines(aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection((_aPt, aCollector) => {
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        switch (item.Type()) {
          case KICAD_T.PCB_SHAPE_T:
            switch ((item as unknown as PCB_SHAPE).GetShape()) {
              case SHAPE_T.SEGMENT:
              case SHAPE_T.ARC:
              case SHAPE_T.POLY:
              case SHAPE_T.RECTANGLE:
                break;

              default:
                aCollector.Remove(item);
            }

            break;

          case KICAD_T.PCB_ZONE_T:
            break;

          default:
            aCollector.Remove(item);
        }
      }
    });

    if (selection.Empty()) return 0;

    const commit = new BOARD_COMMIT(this.m_frame!);
    const frame = this.m_frame!;
    const fpEditor = this.m_frame!.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR);
    let footprint: FOOTPRINT | null = null;
    let targetLayer = this.m_frame!.GetActiveLayer();
    const parent = frame.GetModel();

    if (fpEditor) footprint = frame.GetBoard()!.GetFirstFootprint();

    const handleGraphicSeg = (aItem: EDA_ITEM, aNet: NETINFO_ITEM | null): boolean => {
      if (aItem.Type() !== KICAD_T.PCB_SHAPE_T) return false;

      const graphic = aItem as unknown as PCB_SHAPE;

      if (graphic.GetShape() === SHAPE_T.SEGMENT) {
        const track = new PCB_TRACK(parent);

        track.SetLayer(targetLayer);
        track.SetStart(graphic.GetStart());
        track.SetEnd(graphic.GetEnd());
        track.SetWidth(graphic.GetWidth());

        if (aNet) track.SetNet(aNet);

        commit.Add(track);

        return true;
      } else if (graphic.GetShape() === SHAPE_T.ARC) {
        const arc = new PCB_ARC(parent);

        arc.SetLayer(targetLayer);
        arc.SetStart(graphic.GetStart());
        arc.SetEnd(graphic.GetEnd());
        arc.SetMid(graphic.GetArcMid());
        arc.SetWidth(graphic.GetWidth());

        if (aNet) arc.SetNet(aNet);

        commit.Add(arc);

        return true;
      }

      return false;
    };

    const addGraphicChain = (aChain: SHAPE_LINE_CHAIN, aWidth: number | null): void => {
      for (let si = 0; si < aChain.GetSegmentCount(); ++si) {
        const seg = aChain.GetSegment(si);

        if (seg.Length() === 0) continue;

        if (aChain.IsArcSegment(si)) continue;

        const graphic = new PCB_SHAPE(footprint, SHAPE_T.SEGMENT);

        graphic.SetLayer(targetLayer);
        graphic.SetStart(seg.A);
        graphic.SetEnd(seg.B);

        if (aWidth !== null && aWidth > 0) graphic.SetWidth(aWidth);

        commit.Add(graphic);
      }

      for (let ai = 0; ai < aChain.ArcCount(); ++ai) {
        const arc = aChain.Arc(ai);

        if (samePoint(arc.GetP0(), arc.GetP1())) continue;

        const graphic = new PCB_SHAPE(footprint, SHAPE_T.ARC);

        graphic.SetLayer(targetLayer);
        graphic.SetFilled(false);
        graphic.SetArcGeometry(arc.GetP0(), arc.GetArcMid(), arc.GetP1());

        if (aWidth !== null && aWidth > 0) graphic.SetWidth(aWidth);

        commit.Add(graphic);
      }
    };

    const addTrackChain = (
      aChain: SHAPE_LINE_CHAIN,
      aWidth: number | null,
      aNet: NETINFO_ITEM | null,
    ): void => {
      for (let si = 0; si < aChain.GetSegmentCount(); ++si) {
        const seg = aChain.GetSegment(si);

        if (seg.Length() === 0) continue;

        if (aChain.IsArcSegment(si)) continue;

        const track = new PCB_TRACK(parent);

        track.SetLayer(targetLayer);
        track.SetStart(seg.A);
        track.SetEnd(seg.B);

        if (aWidth !== null && aWidth > 0) track.SetWidth(aWidth);

        if (aNet) track.SetNet(aNet);

        commit.Add(track);
      }

      for (let ai = 0; ai < aChain.ArcCount(); ++ai) {
        const arc = aChain.Arc(ai);

        if (samePoint(arc.GetP0(), arc.GetP1())) continue;

        const trackArc = new PCB_ARC(parent);

        trackArc.SetLayer(targetLayer);
        trackArc.SetStart(arc.GetP0());
        trackArc.SetEnd(arc.GetP1());
        trackArc.SetMid(arc.GetArcMid());

        if (aWidth !== null && aWidth > 0) trackArc.SetWidth(aWidth);

        if (aNet) trackArc.SetNet(aNet);

        commit.Add(trackArc);
      }
    };

    const processChain = (
      aChain: SHAPE_LINE_CHAIN,
      aWidth: number | null,
      aNet: NETINFO_ITEM | null,
    ): void => {
      if (aChain.GetSegmentCount() === 0 && aChain.ArcCount() === 0) return;

      if (aEvent.IsAction(PCB_ACTIONS.convertToLines)) {
        addGraphicChain(aChain, aWidth);
      } else if (fpEditor) {
        addGraphicChain(aChain, aWidth);
      } else {
        addTrackChain(aChain, aWidth, aNet);
      }
    };

    const processPolySet = (
      aPoly: SHAPE_POLY_SET,
      aWidth: number | null,
      aNet: NETINFO_ITEM | null,
    ): void => {
      for (let oi = 0; oi < aPoly.OutlineCount(); ++oi) {
        processChain(aPoly.COutline(oi), aWidth, aNet);

        for (let hi = 0; hi < aPoly.HoleCount(oi); ++hi)
          processChain(aPoly.CHole(oi, hi), aWidth, aNet);
      }
    };

    const convert = (): void => {
      for (const item of selection) {
        if (!item.IsBOARD_ITEM()) continue;

        const connected = (item as BOARD_ITEM).IsConnected()
          ? (item as unknown as BOARD_CONNECTED_ITEM)
          : null;
        const sourceNet = connected ? connected.GetNet() : null;

        if (handleGraphicSeg(item, sourceNet)) continue;

        const boardItem = item as BOARD_ITEM;
        const itemWidth = GetBoardItemWidth(boardItem);

        if (boardItem.Type() === KICAD_T.PCB_SHAPE_T) {
          const graphic = item as unknown as PCB_SHAPE;

          switch (graphic.GetShape()) {
            case SHAPE_T.RECTANGLE: {
              const rect = new SHAPE_RECT(graphic.GetStart(), graphic.GetEnd());
              const rrect = new ROUNDRECT(rect, graphic.GetCornerRadius(), true);
              const poly = new SHAPE_POLY_SET();

              rrect.TransformToPolygon(poly, graphic.GetMaxError());
              processPolySet(poly, itemWidth, sourceNet);
              break;
            }

            case SHAPE_T.POLY:
              processPolySet(graphic.GetPolyShape(), itemWidth, sourceNet);
              break;

            default:
              console.assert(false, 'Unhandled graphic shape type in PolyToLines');
              break;
          }
        } else if (boardItem.Type() === KICAD_T.PCB_ZONE_T) {
          const zone = item as unknown as ZONE;
          processPolySet(zone.Outline(), itemWidth, sourceNet);
        } else {
          console.assert(false, 'Unhandled type in PolyToLines');
        }
      }

      if (this.m_userSettings.m_DeleteOriginals) {
        const selectionCopy = [...selection.GetItems()];
        this.m_selectionTool!.ClearSelection();

        for (const item of selectionCopy) commit.Remove(item);
      }

      commit.Push('Create Lines');
    };

    if (aEvent.IsAction(PCB_ACTIONS.convertToTracks)) {
      if (!IsCopperLayer(targetLayer)) {
        void frame.SelectOneLayer(PCB_LAYER_ID.F_Cu, LSET.AllNonCuMask()).then((aLayer) => {
          if (aLayer === UNDEFINED_LAYER)
            // User canceled
            return;

          targetLayer = aLayer;
          convert();
        });
        return 0;
      }

      convert();
    } else {
      void frame.ShowConvertSettingsDialog(this.m_userSettings, false, false, false).then((ok) => {
        if (!ok) return;

        convert();
      });
    }

    return 0;
  }

  /**
   * Convert selected segment (graphic or track) to an arc of the same type
   */
  SegmentToArc(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection((_aPt, aCollector) => {
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (!item.IsType([KICAD_T.PCB_SHAPE_T, KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T]))
          aCollector.Remove(item);
      }
    });

    if (selection.Empty() || !selection.Front()!.IsBOARD_ITEM()) return -1;

    const source = selection.Front() as BOARD_ITEM;
    let start: VECTOR2I;
    let end: VECTOR2I;
    let mid: VECTOR2I;

    // Offset the midpoint along the normal a little bit so that it's more obviously an arc
    const offsetRatio = 0.1;

    const seg = CONVERT_TOOL.getStartEndPoints(source);

    if (seg) {
      start = seg.A;
      end = seg.B;

      const normal = ResizeI(
        Perpendicular({ x: seg.B.x - seg.A.x, y: seg.B.y - seg.A.y }),
        offsetRatio * seg.Length(),
      );
      const c = seg.Center();
      mid = { x: c.x + normal.x, y: c.y + normal.y };
    } else {
      return -1;
    }

    const frame = this.m_frame!;
    const parent = frame.GetModel();
    const layer = source.GetLayer();
    const commit = new BOARD_COMMIT(frame);

    if (
      source.Type() === KICAD_T.PCB_SHAPE_T &&
      (source as unknown as PCB_SHAPE).GetShape() === SHAPE_T.SEGMENT
    ) {
      const line = source as unknown as PCB_SHAPE;
      const arc = new PCB_SHAPE(parent, SHAPE_T.ARC);

      const center = CalcArcCenterI(start, mid, end);

      arc.SetFilled(false);
      arc.SetLayer(layer);
      arc.SetStroke(line.GetStroke());

      arc.SetCenter(center);
      arc.SetStart(start);
      arc.SetEnd(end);

      commit.Add(arc);
    } else if (
      source.Type() === KICAD_T.PCB_SHAPE_T &&
      (source as unknown as PCB_SHAPE).GetShape() === SHAPE_T.ARC
    ) {
      const source_arc = source as unknown as PCB_SHAPE;
      const arc = new PCB_ARC(parent);

      arc.SetLayer(layer);
      arc.SetWidth(source_arc.GetWidth());
      arc.SetStart(start);
      arc.SetMid(source_arc.GetArcMid());
      arc.SetEnd(end);

      commit.Add(arc);
    } else if (source.Type() === KICAD_T.PCB_TRACE_T) {
      const line = source as unknown as PCB_TRACK;
      const arc = new PCB_ARC(parent);

      arc.SetLayer(layer);
      arc.SetWidth(line.GetWidth());
      arc.SetNet(line.GetNet());
      arc.SetStart(start);
      arc.SetMid(mid);
      arc.SetEnd(end);

      commit.Add(arc);
    } else if (source.Type() === KICAD_T.PCB_ARC_T) {
      const source_arc = source as unknown as PCB_ARC;
      const arc = new PCB_SHAPE(parent, SHAPE_T.ARC);

      arc.SetFilled(false);
      arc.SetLayer(layer);
      arc.SetWidth(source_arc.GetWidth());

      arc.SetArcGeometry(source_arc.GetStart(), source_arc.GetMid(), source_arc.GetEnd());
      commit.Add(arc);
    }

    commit.Push('Create Arc');

    return 0;
  }

  /**
   * Retrieve the start and end points for a generic item.
   *
   * @return a segment from start to end, or null if invalid.
   */
  static getStartEndPoints(aItem: EDA_ITEM): SEG | null {
    switch (aItem.Type()) {
      case KICAD_T.PCB_SHAPE_T: {
        const shape = aItem as unknown as PCB_SHAPE;

        switch (shape.GetShape()) {
          case SHAPE_T.SEGMENT:
          case SHAPE_T.ARC:
          case SHAPE_T.POLY:
          case SHAPE_T.BEZIER:
            if (samePoint(shape.GetStart(), shape.GetEnd())) return null;

            return new SEG(shape.GetStart(), shape.GetEnd());

          default:
            return null;
        }
      }

      case KICAD_T.PCB_TRACE_T: {
        const line = aItem as unknown as PCB_TRACK;
        return new SEG(line.GetStart(), line.GetEnd());
      }

      case KICAD_T.PCB_ARC_T: {
        const arc = aItem as unknown as PCB_ARC;
        return new SEG(arc.GetStart(), arc.GetEnd());
      }

      default:
        return null;
    }
  }

  /**
   * Convert selected items to outset versions of themselves.
   */
  OutsetItems(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const selection = this.m_selectionTool!.RequestSelection((_aPt, aCollector, sTool) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        // We've converted the polygon and rectangle to segments, so drop everything
        // that isn't a segment at this point
        if (!item.IsType([KICAD_T.PCB_PAD_T, KICAD_T.PCB_SHAPE_T])) aCollector.Remove(item);
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    if (this.m_selectionTool!.ReportFilteredLockedItems()) return 0;

    const commit = new BOARD_COMMIT(this);

    for (const item of selection) item.ClearFlags(STRUCT_DELETED);

    // List of thing to select at the end of the operation
    // (doing it as we go will invalidate the iterator)
    const items_to_select_on_success: BOARD_ITEM[] = [];

    // Handle modifications to existing items by the routine
    // How to deal with this depends on whether we're in the footprint editor or not
    // and whether the item was conjured up by decomposing a polygon or rectangle
    const item_modification_handler = (_aItem: BOARD_ITEM): void => {};

    let any_items_created = false;

    const item_creation_handler = (aItem: BOARD_ITEM): void => {
      any_items_created = true;
      items_to_select_on_success.push(aItem);
      commit.Add(aItem);
    };

    const item_removal_handler = (aItem: BOARD_ITEM): void => {
      // If you do an outset on a FP pad, do you really want to delete
      // the parent?
      if (!aItem.GetParentFootprint()) {
        commit.Remove(aItem);
      }
    };

    // Combine these callbacks into a CHANGE_HANDLER to inject in the ROUTINE
    const change_handler = new CALLABLE_BASED_HANDLER(
      item_creation_handler,
      item_modification_handler,
      item_removal_handler,
    );

    // Persistent settings between dialog invocations
    // Init with some sensible defaults
    s_outset_params_fp_edit ??= {
      outsetDistance: pcbIUScale.mmToIU(0.25), // A common outset value
      roundCorners: false,
      useSourceLayers: false,
      useSourceWidths: true,
      layer: PCB_LAYER_ID.F_CrtYd,
      lineWidth: frame.GetDesignSettings().GetLineThickness(PCB_LAYER_ID.F_CrtYd),
      gridRounding: pcbIUScale.mmToIU(0.01),
      deleteSourceItems: false,
    };

    s_outset_params_pcb_edit ??= {
      outsetDistance: pcbIUScale.mmToIU(1),
      roundCorners: true,
      useSourceLayers: true,
      useSourceWidths: true,
      layer: PCB_LAYER_ID.Edge_Cuts, // Outsets often for slots?
      lineWidth: frame.GetDesignSettings().GetLineThickness(PCB_LAYER_ID.Edge_Cuts),
      gridRounding: null,
      deleteSourceItems: false,
    };

    const outset_params = this.IsFootprintEditor()
      ? s_outset_params_fp_edit
      : s_outset_params_pcb_edit;

    const items = [...selection.GetItems()];

    void frame.ShowOutsetItemsDialog(outset_params).then((ok) => {
      if (!ok) return;

      const outset_routine = new OUTSET_ROUTINE(
        frame.GetModel() as unknown as BOARD_ITEM,
        change_handler,
        outset_params,
      );

      for (const item of items) {
        if (!item.IsBOARD_ITEM()) continue;

        const board_item = item as BOARD_ITEM;
        outset_routine.ProcessItem(board_item);
      }

      // Deselect all the original items
      this.m_selectionTool!.ClearSelection();

      // Select added and modified items
      for (const item of items_to_select_on_success) this.m_selectionTool!.AddItemToSel(item, true);

      if (any_items_created) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

      // Notify other tools of the changes
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

      commit.Push(outset_routine.GetCommitDescription());

      const msg = outset_routine.GetStatusMessage();

      if (msg !== null) frame.ShowInfoBarMsg(msg);
    });

    return 0;
  }

  ///< @copydoc TOOL_INTERACTIVE::setTransitions()
  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.CreatePolys), PCB_ACTIONS.convertToPoly.MakeEvent());
    this.Go(SYNC_HANDLER(this.CreatePolys), PCB_ACTIONS.convertToZone.MakeEvent());
    this.Go(SYNC_HANDLER(this.CreatePolys), PCB_ACTIONS.convertToKeepout.MakeEvent());
    this.Go(SYNC_HANDLER(this.CreateLines), PCB_ACTIONS.convertToLines.MakeEvent());
    this.Go(SYNC_HANDLER(this.CreateLines), PCB_ACTIONS.convertToTracks.MakeEvent());
    this.Go(SYNC_HANDLER(this.SegmentToArc), PCB_ACTIONS.convertToArc.MakeEvent());
    this.Go(SYNC_HANDLER(this.OutsetItems), PCB_ACTIONS.outsetItems.MakeEvent());
  }
}
