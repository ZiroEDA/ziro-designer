// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_marker.h` / `pcb_marker.cpp`: `PCB_MARKER`, a DRC/ERC/parity
 * marker on the board, over `BOARD_ITEM` with `MARKER_BASE` mixed in.
 *
 * Not here: `PCB_MARKER_DESC`, the `PROPERTY_MANAGER` registration.
 */

import type { Color4d } from '@ziroeda/common/src/color4d.js';
import type { EDA_DRAW_FRAME_LIKE, EDA_ITEM } from '@ziroeda/common/src/eda_item.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/src/eda_search_data.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { type KIID, kiidFromString } from '@ziroeda/common/src/kiid.js';
import {
  FLASHING,
  GAL_LAYER_ID,
  LayerName,
  PCB_LAYER_ID,
  ToLAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import { MARKER_BASE, MARKER_T } from '@ziroeda/common/src/marker_base.js';
import type { RC_ITEM } from '@ziroeda/common/src/rc_item.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_UNDEFINED,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/src/reporter.js';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/src/settings/builtin_color_themes.js';
import { STROKE_PARAMS } from '@ziroeda/common/src/stroke_params.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import { applyMixins } from '@ziroeda/core/src/mixins.js';
import type { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_NULL } from '@ziroeda/kimath/src/geometry/shape_null.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  Perpendicular,
  ResizeI,
  type VECTOR2I,
  add,
  equal,
  sub,
} from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_ITEM } from './board_item.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  NO_SETTER,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_OPT_INT,
  TYPE_STRING,
} from '@ziroeda/common/src/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/src/properties/property_mgr.js';

import { DRC_ITEM, PCB_DRC_CODE } from './drc/drc_item.js';
import { PCB_SHAPE } from './pcb_shape.js';

/// Factor to convert the maker unit shape to internal units:
const SCALING_FACTOR = pcbIUScale.mmToIU(0.1625);

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (MARKER_BASE mixin)
export interface PCB_MARKER extends MARKER_BASE {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (MARKER_BASE mixin)
export class PCB_MARKER extends BOARD_ITEM {
  protected m_pathShapes: PCB_SHAPE[]; // Shown on LAYER_DRC_SHAPES
  protected m_pathStart: VECTOR2I;
  protected m_pathEnd: VECTOR2I;
  protected m_pathLength: number;

  constructor(aItem: RC_ITEM | null, aPosition: VECTOR2I, aLayer: number = PCB_LAYER_ID.F_Cu) {
    super(null, KICAD_T.PCB_MARKER_T, PCB_LAYER_ID.F_Cu); // parent set during BOARD::Add()
    this.initMarkerBase(SCALING_FACTOR, aItem);
    this.m_pathShapes = [];
    this.m_pathStart = { x: 0, y: 0 };
    this.m_pathEnd = { x: 0, y: 0 };
    this.m_pathLength = 0;

    if (this.m_rcItem) {
      this.m_rcItem.SetParent(this);

      if (aLayer === GAL_LAYER_ID.LAYER_DRAWINGSHEET) {
        this.SetMarkerType(MARKER_T.MARKER_DRAWING_SHEET);
      } else {
        switch (this.m_rcItem.GetErrorCode()) {
          case PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS:
            this.SetMarkerType(MARKER_T.MARKER_RATSNEST);
            break;

          case PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT:
          case PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT:
          case PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT:
          case PCB_DRC_CODE.DRCE_NET_CONFLICT:
          case PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY:
          case PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY:
          case PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS:
            this.SetMarkerType(MARKER_T.MARKER_PARITY);
            break;

          default:
            this.SetMarkerType(MARKER_T.MARKER_DRC);
            break;
        }

        this.SetLayer(ToLAYER_ID(aLayer));
      }
    }

    this.m_Pos = { x: aPosition.x, y: aPosition.y };
  }

  /** `PCB_MARKER( const PCB_MARKER& )`: the compiler-generated copy, as a static. */
  static copyOf(aOther: PCB_MARKER): PCB_MARKER {
    const copy = new PCB_MARKER(null, aOther.m_Pos, aOther.m_layer);
    BOARD_ITEM.copyBase(copy, aOther);
    copy.initMarkerBaseFrom(aOther);
    copy.m_pathShapes = aOther.m_pathShapes.map((s) => PCB_SHAPE.copyOf(s));
    copy.m_pathStart = { ...aOther.m_pathStart };
    copy.m_pathEnd = { ...aOther.m_pathEnd };
    copy.m_pathLength = aOther.m_pathLength;
    return copy;
  }

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && KICAD_T.PCB_MARKER_T === aItem.Type();
  }

  GetUUID(): KIID {
    return this.m_Uuid;
  }

  SerializeToString(): string {
    const rcItem = this.m_rcItem!;

    if (
      rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_COPPER_SLIVER ||
      rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_WARNING ||
      rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_ERROR
    ) {
      return `${rcItem.GetSettingsKey()}|${this.m_Pos.x}|${this.m_Pos.y}|${rcItem.GetMainItemID()}|${LayerName(this.m_layer)}`;
    } else if (rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS) {
      let layer = this.m_layer;

      if (this.m_layer === PCB_LAYER_ID.UNDEFINED_LAYER) layer = PCB_LAYER_ID.F_Cu;

      return `${rcItem.GetSettingsKey()}|${this.m_Pos.x}|${this.m_Pos.y}|${LayerName(layer)}|${this.GetMarkerType()}|${rcItem.GetMainItemID()}|${rcItem.GetAuxItemID()}`;
    } else if (rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_STARVED_THERMAL) {
      return `${rcItem.GetSettingsKey()}|${this.m_Pos.x}|${this.m_Pos.y}|${rcItem.GetMainItemID()}|${rcItem.GetAuxItemID()}|${LayerName(this.m_layer)}`;
    } else if (
      rcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE &&
      rcItem.GetParent()!.GetMarkerType() === MARKER_T.MARKER_DRAWING_SHEET
    ) {
      // Drawing sheet KIIDs aren't preserved between runs
      return `${rcItem.GetSettingsKey()}|${this.m_Pos.x}|${this.m_Pos.y}||`;
    } else {
      return `${rcItem.GetSettingsKey()}|${this.m_Pos.x}|${this.m_Pos.y}|${rcItem.GetMainItemID()}|${rcItem.GetAuxItemID()}`;
    }
  }

  static DeserializeFromString(data: string): PCB_MARKER | null {
    const getMarkerLayer = (layerName: string): number => {
      for (let layer = 0; layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++layer) {
        if (LayerName(ToLAYER_ID(layer)) === layerName) return layer;
      }

      return PCB_LAYER_ID.F_Cu;
    };

    const props = data.split('|');
    let markerLayer: number = PCB_LAYER_ID.F_Cu;
    const markerPos: VECTOR2I = {
      x: Number.parseInt(props[1]!, 10) || 0,
      y: Number.parseInt(props[2]!, 10) || 0,
    };

    const drcItem = DRC_ITEM.Create(props[0]!);

    if (!drcItem) return null;

    if (
      drcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_COPPER_SLIVER ||
      drcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_WARNING ||
      drcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_ERROR
    ) {
      drcItem.SetItems(kiidFromString(props[3]!));
      markerLayer = getMarkerLayer(props[4]!);
    } else if (drcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS) {
      // Pre-9.0.4 versions didn't have KIIDs as last two properties to allow sorting stability
      if (props.length < 6) drcItem.SetItems(kiidFromString(props[3]!), kiidFromString(props[4]!));
      else drcItem.SetItems(kiidFromString(props[5]!), kiidFromString(props[6]!));
    } else if (drcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_STARVED_THERMAL) {
      drcItem.SetItems(kiidFromString(props[3]!), kiidFromString(props[4]!));

      // Pre-7.0 versions didn't differentiate between layers
      if (props.length === 6) markerLayer = getMarkerLayer(props[5]!);
    } else if (
      drcItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE &&
      props[3]!.length === 0 &&
      props[4]!.length === 0
    ) {
      // Note: caller must load our item pointer with the drawing sheet proxy item
      markerLayer = GAL_LAYER_ID.LAYER_DRAWINGSHEET;
    } else {
      drcItem.SetItems(kiidFromString(props[3]!), kiidFromString(props[4]!));
    }

    return new PCB_MARKER(drcItem, markerPos, markerLayer);
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_Pos = add(this.m_Pos, aMoveVector);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    // Marker geometry isn't user-editable
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // Marker geometry isn't user-editable
  }

  override GetPosition(): VECTOR2I {
    return this.m_Pos;
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.m_Pos = { x: aPos.x, y: aPos.y };
  }

  override GetCenter(): VECTOR2I {
    return this.GetPosition();
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (this.GetMarkerType() === MARKER_T.MARKER_RATSNEST) return false;

    if (a instanceof BOX2I) return this.HitTestMarker(a, b as boolean, c ?? 0);

    if (typeof (a as VECTOR2I).x === 'number')
      return this.HitTestMarker(a as VECTOR2I, (b as number | undefined) ?? 0);

    return this.HitTestMarker(a as SHAPE_LINE_CHAIN, b as boolean);
  }

  override Clone(): PCB_MARKER {
    return PCB_MARKER.copyOf(this);
  }

  GetColorLayer(): GAL_LAYER_ID {
    switch (this.GetSeverity()) {
      case RPT_SEVERITY_WARNING:
        return GAL_LAYER_ID.LAYER_DRC_WARNING;
      case RPT_SEVERITY_EXCLUSION:
        return GAL_LAYER_ID.LAYER_DRC_EXCLUSION;
      default:
        return GAL_LAYER_ID.LAYER_DRC_ERROR;
    }
  }

  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    // Markers do not participate in the board geometry space, and therefore have no effective shape.
    return new SHAPE_NULL();
  }

  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    ignoreLineWidth = false,
  ): void {
    // Markers do not participate in the board geometry space, and therefore have no shape.
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const rcItem = this.m_rcItem!;

    aList.push(new MSG_PANEL_ITEM('Type', 'Marker'));
    aList.push(new MSG_PANEL_ITEM('Violation', rcItem.GetErrorMessage(true)));

    switch (this.GetSeverity()) {
      case RPT_SEVERITY_IGNORE:
        aList.push(new MSG_PANEL_ITEM('Severity', 'Ignore'));
        break;
      case RPT_SEVERITY_WARNING:
        aList.push(new MSG_PANEL_ITEM('Severity', 'Warning'));
        break;
      case RPT_SEVERITY_ERROR:
        aList.push(new MSG_PANEL_ITEM('Severity', 'Error'));
        break;
      default:
        break;
    }

    if (this.GetMarkerType() === MARKER_T.MARKER_DRAWING_SHEET) {
      aList.push(new MSG_PANEL_ITEM('Drawing Sheet', ''));
    } else {
      let mainText = '';
      let auxText = '';
      const mainItem: EDA_ITEM | null = aFrame.ResolveItem(rcItem.GetMainItemID());
      const auxItem: EDA_ITEM | null = aFrame.ResolveItem(rcItem.GetAuxItemID());

      if (mainItem) mainText = mainItem.GetItemDescription(aFrame, true);

      if (auxItem) auxText = auxItem.GetItemDescription(aFrame, true);

      aList.push(new MSG_PANEL_ITEM(mainText, auxText));
    }

    if (this.IsExcluded()) aList.push(new MSG_PANEL_ITEM('Excluded', this.m_comment));
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    return this.matchesText(this.m_rcItem!.GetErrorMessage(true), aSearchData);
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Marker (${aFull ? this.m_rcItem!.GetErrorMessage(true) : this.m_rcItem!.GetErrorText(true)})`;
  }

  override GetMenuImage(): string {
    return 'drc'; // BITMAPS::drc
  }

  SetZoom(aZoomFactor: number): void {
    this.SetMarkerScale(SCALING_FACTOR * aZoomFactor);
  }

  override ViewBBox(): BOX2I {
    return this.GetBoundingBox();
  }

  override GetBoundingBox(): BOX2I {
    const box = this.GetBoundingBoxMarker();

    for (const s of this.m_pathShapes) box.Merge(s.GetBoundingBox());

    return box;
  }

  override ViewGetLayers(): number[] {
    if (this.GetMarkerType() === MARKER_T.MARKER_RATSNEST) return [];

    const layers: number[] = [0, GAL_LAYER_ID.LAYER_MARKER_SHADOWS, GAL_LAYER_ID.LAYER_DRC_SHAPES];

    switch (this.GetSeverity()) {
      case RPT_SEVERITY_WARNING:
        layers[0] = GAL_LAYER_ID.LAYER_DRC_WARNING;
        break;
      case RPT_SEVERITY_EXCLUSION:
        layers[0] = GAL_LAYER_ID.LAYER_DRC_EXCLUSION;
        break;
      default:
        layers[0] = GAL_LAYER_ID.LAYER_DRC_ERROR;
        break;
    }

    return layers;
  }

  GetSeverity(): Severity {
    if (this.IsExcluded()) return RPT_SEVERITY_EXCLUSION;

    const item = this.m_rcItem as DRC_ITEM;

    if (item.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_WARNING) return RPT_SEVERITY_WARNING;
    else if (item.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_ERROR) return RPT_SEVERITY_ERROR;

    const rule = item.GetViolatingRule();

    if (rule && rule.m_Severity !== RPT_SEVERITY_UNDEFINED) return rule.m_Severity;

    return this.GetBoard()!.GetDesignSettings().GetSeverity(item.GetErrorCode());
  }

  Similarity(aBoardItem: BOARD_ITEM): number {
    return 0.0;
  }

  /** `operator==( const BOARD_ITEM& )`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    return false;
  }

  /** Get class name
   * @return  string "PCB_MARKER"
   */
  GetClass(): string {
    return 'PCB_MARKER';
  }

  GetShapes(): PCB_SHAPE[] {
    const hairline = new STROKE_PARAMS(1.0); // Segments of width 1.0 will get drawn as lines by PCB_PAINTER
    const pathShapes: PCB_SHAPE[] = [];

    if (equal(this.m_pathStart, this.m_pathEnd)) {
      // Add a collision 'X'
      const len = KiROUND(2.5 * this.MarkerScale());
      const s = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
      s.SetStroke(hairline);
      s.SetStart(add(this.m_pathStart, { x: -len, y: -len }));
      s.SetEnd(add(this.m_pathStart, { x: len, y: len }));
      pathShapes.push(PCB_SHAPE.copyOf(s));
      s.SetStart(add(this.m_pathStart, { x: -len, y: len }));
      s.SetEnd(add(this.m_pathStart, { x: len, y: -len }));
      pathShapes.push(PCB_SHAPE.copyOf(s));
    } else {
      // Add the path
      for (const source of this.m_pathShapes) {
        const shape = PCB_SHAPE.copyOf(source);
        shape.SetStroke(hairline);
        pathShapes.push(shape);
      }

      // Draw perpendicular begin/end stops
      if (pathShapes.length > 0) {
        let V1 = sub(pathShapes[0]!.GetStart(), pathShapes[0]!.GetEnd());
        let V2 = sub(
          pathShapes[pathShapes.length - 1]!.GetStart(),
          pathShapes[pathShapes.length - 1]!.GetEnd(),
        );
        V1 = ResizeI(Perpendicular(V1), 2.5 * this.MarkerScale());
        V2 = ResizeI(Perpendicular(V2), 2.5 * this.MarkerScale());

        const s = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
        s.SetStroke(hairline);
        s.SetStart(add(this.m_pathStart, V1));
        s.SetEnd(sub(this.m_pathStart, V1));
        pathShapes.push(PCB_SHAPE.copyOf(s));
        s.SetStart(add(this.m_pathEnd, V2));
        s.SetEnd(sub(this.m_pathEnd, V2));
        pathShapes.push(PCB_SHAPE.copyOf(s));
      }
    }

    // Add shaded areas
    for (const source of this.m_pathShapes) {
      const shape = PCB_SHAPE.copyOf(source);
      shape.SetWidth(10 * this.MarkerScale());
      pathShapes.push(shape);
    }

    return pathShapes;
  }

  SetPath(aShapes: readonly PCB_SHAPE[], aStart: VECTOR2I, aEnd: VECTOR2I): void {
    this.m_pathShapes = aShapes.map((s) => PCB_SHAPE.copyOf(s));
    this.m_pathStart = { x: aStart.x, y: aStart.y };
    this.m_pathEnd = { x: aEnd.x, y: aEnd.y };
  }

  GetPath(): readonly PCB_SHAPE[] {
    return this.m_pathShapes;
  }

  protected getColor(): Color4d {
    // ::GetColorSettings( DEFAULT_THEME )->GetColor( GetColorLayer() )
    return BUILTIN_DEFAULT_THEME[
      GAL_LAYER_ID[this.GetColorLayer()] as keyof typeof BUILTIN_DEFAULT_THEME
    ];
  }
}

applyMixins(PCB_MARKER, [MARKER_BASE]);

/**
 * `static struct PCB_MARKER_DESC` (pcbnew/pcb_marker.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_MARKER);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_MARKER, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_MARKER, MARKER_BASE));
  propMgr.InheritsAfter(PCB_MARKER, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_MARKER, MARKER_BASE);

  // Markers cannot be locked and have no user-accessible layer control
  propMgr.Mask(PCB_MARKER, BOARD_ITEM, 'Layer');
  propMgr.Mask(PCB_MARKER, BOARD_ITEM, 'Locked');
})();
