// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_line.h` / `eeschema/sch_line.cpp`: `SCH_LINE`, a wire, a bus or a
 * graphic line.
 *
 * Not here: `Serialize`/`Deserialize` (protobuf), `ViewGetLOD`, `Plot`,
 * `GetMenuImage`, `SCH_LINE_DESC`. The net-class answers
 * (`GetEffectiveNetClass`) wait on the connection graph, so a wire whose stroke
 * says "default" keeps its last resolved style/width/colour, as KiCad does while
 * connectivity is dirty.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import {
  ENDPOINT,
  SKIP_STRUCT,
  STARTPOINT,
  STRUCT_DELETED,
} from '@ziroeda/common/eda_item_flags.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import {
  COLOR4D_UNSPECIFIED,
  type Color4d,
  color4dEquals as sameColor4d,
} from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import {
  DEFAULT_BUS_WIDTH_MILS,
  DEFAULT_LINE_WIDTH_MILS,
  DEFAULT_WIRE_WIDTH_MILS,
} from './default_values.js';
import {
  DANGLING_END_ITEM,
  DANGLING_END_ITEM_HELPER,
  DANGLING_END_T,
  SCH_ITEM,
  type SCH_COMMIT_LIKE,
} from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';

/**
 * `WIRE_STYLE`: the same values as `LINE_STYLE`, but "default" is exposed in the wire
 * property while it is not in the line style one.
 */
export enum WIRE_STYLE {
  DEFAULT = LINE_STYLE.DEFAULT,
  SOLID = LINE_STYLE.SOLID,
  DASH = LINE_STYLE.DASH,
  DOT = LINE_STYLE.DOT,
  DASHDOT = LINE_STYLE.DASHDOT,
  DASHDOTDOT = LINE_STYLE.DASHDOTDOT,
}

/** A three-component point, `VECTOR3I`: z is 1 on a hop arc's points. */
export interface VECTOR3I {
  x: number;
  y: number;
  z: number;
}

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** Segment description and methods for a wire, a bus or a graphic line. */
export class SCH_LINE extends SCH_ITEM {
  private m_startIsDangling: boolean; ///< True if start point is not connected.
  private m_endIsDangling: boolean; ///< True if end point is not connected.
  private m_start: VECTOR2I; ///< Line start point
  private m_end: VECTOR2I; ///< Line end point
  private m_storedAngle: EDA_ANGLE; ///< Stored angle
  private m_stroke: STROKE_PARAMS; ///< Line stroke properties.

  // If real-time connectivity gets disabled (due to being too slow on a particular
  // design), we can no longer rely on getting the NetClass to find netclass-specific
  // linestyles, linewidths and colors.
  private m_lastResolvedLineStyle: LINE_STYLE;
  private m_lastResolvedWidth: number;
  private m_lastResolvedColor: Color4d;

  private m_operatingPoint: string;

  constructor(pos: VECTOR2I = { x: 0, y: 0 }, layer: number = SCH_LAYER_ID.LAYER_NOTES) {
    super(null, KICAD_T.SCH_LINE_T);

    this.m_start = { x: pos.x, y: pos.y };
    this.m_end = { x: pos.x, y: pos.y };
    this.m_storedAngle = new EDA_ANGLE(0);
    this.m_stroke = new STROKE_PARAMS();
    this.m_stroke.SetWidth(0);
    this.m_stroke.SetLineStyle(LINE_STYLE.DEFAULT);
    this.m_stroke.SetColor(COLOR4D_UNSPECIFIED);
    this.m_operatingPoint = '';

    switch (layer) {
      case SCH_LAYER_ID.LAYER_WIRE:
        this.m_layer = SCH_LAYER_ID.LAYER_WIRE;
        break;
      case SCH_LAYER_ID.LAYER_BUS:
        this.m_layer = SCH_LAYER_ID.LAYER_BUS;
        break;
      default:
        this.m_layer = SCH_LAYER_ID.LAYER_NOTES;
        break;
    }

    if (layer === SCH_LAYER_ID.LAYER_NOTES) {
      this.m_startIsDangling = this.m_endIsDangling = true;
    } else {
      this.m_startIsDangling = this.m_endIsDangling = false;
    }

    if (layer === SCH_LAYER_ID.LAYER_WIRE)
      this.m_lastResolvedWidth = schIUScale.milsToIU(DEFAULT_WIRE_WIDTH_MILS);
    else if (layer === SCH_LAYER_ID.LAYER_BUS)
      this.m_lastResolvedWidth = schIUScale.milsToIU(DEFAULT_BUS_WIDTH_MILS);
    else this.m_lastResolvedWidth = schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS);

    this.m_lastResolvedLineStyle = LINE_STYLE.SOLID;
    this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };
  }

  /** `SCH_LINE( const SCH_LINE& aLine )`: the copy is in no group. */
  static copyOf(aLine: SCH_LINE): SCH_LINE {
    const copy = new SCH_LINE(aLine.m_start, aLine.m_layer);
    SCH_ITEM.copySchItem(copy, aLine);
    copy.m_start = { ...aLine.m_start };
    copy.m_end = { ...aLine.m_end };
    copy.m_stroke = aLine.m_stroke.clone();
    copy.m_startIsDangling = aLine.m_startIsDangling;
    copy.m_endIsDangling = aLine.m_endIsDangling;
    copy.m_lastResolvedLineStyle = aLine.m_lastResolvedLineStyle;
    copy.m_lastResolvedWidth = aLine.m_lastResolvedWidth;
    copy.m_lastResolvedColor = { ...aLine.m_lastResolvedColor };
    copy.m_operatingPoint = aLine.m_operatingPoint;
    copy.SetParentGroup(null);
    return copy;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_LINE_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_LINE';
  }

  /** `GetMsgPanelInfo( aFrame, aList )` (sch_line.cpp). */
  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    let msg: string;

    switch (this.GetLayer()) {
      case SCH_LAYER_ID.LAYER_WIRE:
        msg = 'Wire';
        break;
      case SCH_LAYER_ID.LAYER_BUS:
        msg = 'Bus';
        break;
      default:
        msg = 'Graphical';
        break;
    }

    aList.push(new MSG_PANEL_ITEM('Line Type', msg));

    const lineStyle = this.GetStroke().GetLineStyle();

    if (this.GetEffectiveLineStyle() !== lineStyle)
      aList.push(new MSG_PANEL_ITEM('Line Style', 'from netclass'));
    else this.GetStroke().GetMsgPanelInfo(aFrame, aList, true, false);

    // dynamic_cast<SCH_EDIT_FRAME*>( aFrame ): a schematic editor's item has a schematic.
    const conn = !this.IsConnectivityDirty() && this.Schematic() ? this.Connection() : null;

    if (conn) {
      conn.AppendInfoToMsgPanel(aList);

      if (!conn.IsBus()) {
        aList.push(
          new MSG_PANEL_ITEM(
            'Resolved Netclass',
            // null is upstream's static NETCLASS( wxEmptyString ), whose name is ''.
            unescapeString(this.GetEffectiveNetClass()?.GetHumanReadableName() ?? ''),
          ),
        );
      }
    }
  }

  override GetFriendlyName(): string {
    switch (this.GetLayer()) {
      case SCH_LAYER_ID.LAYER_WIRE:
        return 'Wire';
      case SCH_LAYER_ID.LAYER_BUS:
        return 'Bus';
      default:
        return 'Graphic Line';
    }
  }

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    if (super.IsType(aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_ITEM_LOCATE_WIRE_T && this.m_layer === SCH_LAYER_ID.LAYER_WIRE)
        return true;

      if (scanType === KICAD_T.SCH_ITEM_LOCATE_BUS_T && this.m_layer === SCH_LAYER_ID.LAYER_BUS)
        return true;

      if (
        scanType === KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T &&
        this.m_layer === SCH_LAYER_ID.LAYER_NOTES
      )
        return true;
    }

    return false;
  }

  override IsEndPoint(aPoint: VECTOR2I): boolean {
    return samePt(aPoint, this.m_start) || samePt(aPoint, this.m_end);
  }

  GetAngleFrom(aPoint: VECTOR2I): number {
    let vec: VECTOR2I;

    if (samePt(aPoint, this.m_start))
      vec = { x: this.m_end.x - aPoint.x, y: this.m_end.y - aPoint.y };
    else vec = { x: this.m_start.x - aPoint.x, y: this.m_start.y - aPoint.y };

    return KiROUND(EDA_ANGLE.fromVector(vec).AsDegrees());
  }

  GetReverseAngleFrom(aPoint: VECTOR2I): number {
    let vec: VECTOR2I;

    if (samePt(aPoint, this.m_end))
      vec = { x: this.m_start.x - aPoint.x, y: this.m_start.y - aPoint.y };
    else vec = { x: this.m_end.x - aPoint.x, y: this.m_end.y - aPoint.y };

    return KiROUND(EDA_ANGLE.fromVector(vec).AsDegrees());
  }

  /** Get the angle between the start and end lines. */
  Angle(): EDA_ANGLE {
    return EDA_ANGLE.fromVector({
      x: this.m_end.x - this.m_start.x,
      y: this.m_end.y - this.m_start.y,
    });
  }

  /**
   * Save the current line angle.
   *
   * Useful when dragging a line and its important to be able to restart the line from length
   * 0 in the correct direction.
   */
  StoreAngle(aAngle?: EDA_ANGLE): void {
    if (aAngle) {
      this.m_storedAngle = aAngle;
      return;
    }

    if (!this.IsNull()) this.m_storedAngle = this.Angle();
  }

  /** Return the angle stored by StoreAngle(). */
  GetStoredAngle(): EDA_ANGLE {
    return this.m_storedAngle;
  }

  /** Check if line is orthogonal (to the grid). */
  IsOrthogonal(): boolean {
    return this.Angle().IsCardinal();
  }

  IsNull(): boolean {
    return samePt(this.m_start, this.m_end);
  }

  GetStartPoint(): VECTOR2I {
    return { ...this.m_start };
  }
  SetStartPoint(aPosition: VECTOR2I): void {
    this.m_start = { x: aPosition.x, y: aPosition.y };
  }
  GetStartX(): number {
    return this.m_start.x;
  }
  SetStartX(aX: number): void {
    this.SetStartPoint({ x: aX, y: this.m_start.y });
  }
  GetStartY(): number {
    return this.m_start.y;
  }
  SetStartY(aY: number): void {
    this.SetStartPoint({ x: this.m_start.x, y: aY });
  }

  GetMidPoint(): VECTOR2I {
    // VECTOR2I / 2 truncates each component.
    return {
      x: Math.trunc((this.m_start.x + this.m_end.x) / 2),
      y: Math.trunc((this.m_start.y + this.m_end.y) / 2),
    };
  }

  GetEndPoint(): VECTOR2I {
    return { ...this.m_end };
  }
  SetEndPoint(aPosition: VECTOR2I): void {
    this.m_end = { x: aPosition.x, y: aPosition.y };
  }
  GetEndX(): number {
    return this.m_end.x;
  }
  SetEndX(aX: number): void {
    this.SetEndPoint({ x: aX, y: this.m_end.y });
  }
  GetEndY(): number {
    return this.m_end.y;
  }
  SetEndY(aY: number): void {
    this.SetEndPoint({ x: this.m_end.x, y: aY });
  }

  /** Get the geometric aspect of the wire as a SEG. */
  GetSeg(): SEG {
    return new SEG(this.m_start, this.m_end);
  }

  override SetLastResolvedState(aItem: SCH_ITEM): void {
    if (aItem instanceof SCH_LINE) {
      this.m_stroke = aItem.GetStroke();
      this.m_lastResolvedLineStyle = aItem.m_lastResolvedLineStyle;
      this.m_lastResolvedWidth = aItem.m_lastResolvedWidth;
      this.m_lastResolvedColor = { ...aItem.m_lastResolvedColor };
    }
  }

  SetLineStyle(aStyle: LINE_STYLE): void {
    this.m_stroke.SetLineStyle(aStyle);
    this.m_lastResolvedLineStyle = this.GetEffectiveLineStyle();
  }

  GetLineStyle(): LINE_STYLE {
    if (this.IsGraphicLine() && this.m_stroke.GetLineStyle() === LINE_STYLE.DEFAULT)
      return LINE_STYLE.SOLID;
    else return this.m_stroke.GetLineStyle();
  }

  /**
   * @return the style that the line should be drawn in
   * this might be set on the line or inherited from the line's netclass
   */
  GetEffectiveLineStyle(): LINE_STYLE {
    if (this.m_stroke.GetLineStyle() !== LINE_STYLE.DEFAULT)
      this.m_lastResolvedLineStyle = this.m_stroke.GetLineStyle();
    else if (!this.IsConnectable()) this.m_lastResolvedLineStyle = LINE_STYLE.SOLID;
    // else if( !IsConnectivityDirty() ) -> GetEffectiveNetClass()->GetLineStyle():
    // pending the connection graph (E3 part 2); the last resolved style stands.

    return this.m_lastResolvedLineStyle;
  }

  SetWireStyle(aStyle: WIRE_STYLE): void {
    this.SetLineStyle(aStyle as unknown as LINE_STYLE);
  }
  GetWireStyle(): WIRE_STYLE {
    return this.GetLineStyle() as unknown as WIRE_STYLE;
  }

  /** `SetLineColor( const COLOR4D& )` or `SetLineColor( r, g, b, a )`. */
  SetLineColor(aColor: Color4d): void;
  SetLineColor(r: number, g: number, b: number, a: number): void;
  SetLineColor(a: Color4d | number, g?: number, b?: number, alpha?: number): void {
    if (typeof a !== 'number') {
      this.m_stroke.SetColor(a);
      this.m_lastResolvedColor = { ...this.GetLineColor() };
      return;
    }

    const newColor: Color4d = { r: a, g: g!, b: b!, a: alpha! };

    if (sameColor4d(newColor, COLOR4D_UNSPECIFIED)) {
      this.m_stroke.SetColor(COLOR4D_UNSPECIFIED);
    } else {
      // Eeschema does not allow alpha channel in colors
      newColor.a = 1.0;
      this.m_stroke.SetColor(newColor);
    }
  }

  /** Return #COLOR4D::UNSPECIFIED if a custom color hasn't been set for this line. */
  GetLineColor(): Color4d {
    if (!sameColor4d(this.m_stroke.GetColor(), COLOR4D_UNSPECIFIED))
      this.m_lastResolvedColor = { ...this.m_stroke.GetColor() };
    else if (!this.IsConnectable()) this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };
    // else if( !IsConnectivityDirty() ) -> GetEffectiveNetClass()->GetSchematicColor():
    // pending the connection graph (E3 part 2).

    return this.m_lastResolvedColor;
  }

  SetLineWidth(aSize: number): void {
    this.m_stroke.SetWidth(aSize);
    this.m_lastResolvedWidth = this.GetPenWidth();
  }

  GetLineWidth(): number {
    return this.m_stroke.GetWidth();
  }

  override HasLineStroke(): boolean {
    return true;
  }
  override GetStroke(): STROKE_PARAMS {
    return this.m_stroke.clone();
  }
  override SetStroke(aStroke: STROKE_PARAMS): void {
    this.m_stroke = aStroke.clone();
  }

  IsStrokeEquivalent(aLine: SCH_LINE): boolean {
    if (this.m_stroke.GetWidth() !== aLine.GetStroke().GetWidth()) return false;

    if (!sameColor4d(this.m_stroke.GetColor(), aLine.GetStroke().GetColor())) return false;

    const style_a = this.m_stroke.GetLineStyle();
    const style_b = aLine.GetStroke().GetLineStyle();

    return (
      style_a === style_b ||
      (style_a === LINE_STYLE.DEFAULT && style_b === LINE_STYLE.SOLID) ||
      (style_a === LINE_STYLE.SOLID && style_b === LINE_STYLE.DEFAULT)
    );
  }

  override ViewGetLayers(): number[] {
    if (this.IsWire() || this.IsBus())
      return [
        SCH_LAYER_ID.LAYER_DANGLING,
        this.m_layer,
        SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
        SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT,
        SCH_LAYER_ID.LAYER_OP_VOLTAGES,
      ];

    return [
      SCH_LAYER_ID.LAYER_DANGLING,
      this.m_layer,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
      SCH_LAYER_ID.LAYER_OP_VOLTAGES,
    ];
  }

  override GetBoundingBox(): BOX2I {
    const width = Math.trunc(this.GetPenWidth() / 2);

    const xmin = Math.min(this.m_start.x, this.m_end.x) - width;
    const ymin = Math.min(this.m_start.y, this.m_end.y) - width;
    const xmax = Math.max(this.m_start.x, this.m_end.x) + width + 1;
    const ymax = Math.max(this.m_start.y, this.m_end.y) + width + 1;

    return new BOX2I({ x: xmin, y: ymin }, { x: xmax - xmin, y: ymax - ymin });
  }

  /** @return The length of the line segment. */
  GetLength(): number {
    return Math.hypot(this.m_end.x - this.m_start.x, this.m_end.y - this.m_start.y);
  }

  SetLength(aLength: number): void {
    if (aLength < 0.0) aLength = 0.0;

    const currentLength = this.GetLength();
    const start = this.GetStartPoint();
    let end: VECTOR2I;

    if (currentLength <= 0.0) {
      end = { x: start.x + KiROUND(aLength), y: start.y + KiROUND(0.0) };
    } else {
      const delta = { x: this.m_end.x - start.x, y: this.m_end.y - start.y };
      const scale = aLength / currentLength;

      end = { x: start.x + KiROUND(delta.x * scale), y: start.y + KiROUND(delta.y * scale) };
    }

    this.SetEndPoint(end);
  }

  override GetPenWidth(): number {
    const schematic = this.Schematic();

    switch (this.m_layer) {
      case SCH_LAYER_ID.LAYER_WIRE:
        if (this.m_stroke.GetWidth() > 0) this.m_lastResolvedWidth = this.m_stroke.GetWidth();
        // else if( !IsConnectivityDirty() ) -> GetEffectiveNetClass()->GetWireWidth(): pending.

        return this.m_lastResolvedWidth;

      case SCH_LAYER_ID.LAYER_BUS:
        if (this.m_stroke.GetWidth() > 0) this.m_lastResolvedWidth = this.m_stroke.GetWidth();
        // else if( !IsConnectivityDirty() ) -> GetEffectiveNetClass()->GetBusWidth(): pending.

        return this.m_lastResolvedWidth;

      default:
        if (this.m_stroke.GetWidth() > 0) return this.m_stroke.GetWidth();

        if (schematic) return schematic.Settings().m_DefaultLineWidth;

        return schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS);
    }
  }

  override Move(aOffset: VECTOR2I): void {
    this.m_start = { x: this.m_start.x + aOffset.x, y: this.m_start.y + aOffset.y };
    this.m_end = { x: this.m_end.x + aOffset.x, y: this.m_end.y + aOffset.y };
  }

  MoveStart(aOffset: VECTOR2I): void {
    this.m_start = { x: this.m_start.x + aOffset.x, y: this.m_start.y + aOffset.y };
  }

  MoveEnd(aOffset: VECTOR2I): void {
    this.m_end = { x: this.m_end.x + aOffset.x, y: this.m_end.y + aOffset.y };
  }

  override MirrorVertically(aCenter: number): void {
    if (this.m_flags & STARTPOINT) this.m_start.y = aCenter - (this.m_start.y - aCenter);

    if (this.m_flags & ENDPOINT) this.m_end.y = aCenter - (this.m_end.y - aCenter);
  }

  override MirrorHorizontally(aCenter: number): void {
    if (this.m_flags & STARTPOINT) this.m_start.x = aCenter - (this.m_start.x - aCenter);

    if (this.m_flags & ENDPOINT) this.m_end.x = aCenter - (this.m_end.x - aCenter);
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    if (this.m_flags & STARTPOINT)
      this.m_start = RotatePoint(this.m_start, aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);

    if (this.m_flags & ENDPOINT)
      this.m_end = RotatePoint(this.m_end, aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
  }

  /**
   * Check line against \a aLine to see if it overlaps and merge if it does.
   *
   * This method will return an equivalent of the union of line and \a aLine if the
   * two lines overlap.  This method is used to merge multiple line segments into a single
   * line.
   *
   * @param aScreen is the current screen.
   * @param aLine is the line to compare.
   * @param aCheckJunctions is used to indicate if we need to check for a junction if the two
   *                        segments are colinear and touch.
   * @return New line that combines the two or NULL on non-overlapping segments.
   */
  MergeOverlap(aScreen: SCH_SCREEN | null, aLine: SCH_LINE, aCheckJunctions: boolean) {
    const less = (lhs: VECTOR2I, rhs: VECTOR2I): boolean => {
      if (lhs.x === rhs.x) return lhs.y < rhs.y;

      return lhs.x < rhs.x;
    };

    const min2 = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => (less(b, a) ? b : a);

    if (!(aLine && aLine.Type() === KICAD_T.SCH_LINE_T)) return null; // wxCHECK_MSG

    if (this === aLine || this.GetLayer() !== aLine.GetLayer()) return null;

    let leftmost_start = { ...aLine.m_start };
    let leftmost_end = { ...aLine.m_end };

    let rightmost_start = { ...this.m_start };
    let rightmost_end = { ...this.m_end };

    // We place the start to the left and below the end of both lines
    if (!samePt(leftmost_start, min2(leftmost_start, leftmost_end)))
      [leftmost_start, leftmost_end] = [leftmost_end, leftmost_start];

    if (!samePt(rightmost_start, min2(rightmost_start, rightmost_end)))
      [rightmost_start, rightmost_end] = [rightmost_end, rightmost_start];

    // - leftmost is the line that starts farthest to the left
    // - other is the line that is _not_ leftmost
    // - rightmost is the line that ends farthest to the right.  This may or may not be 'other'
    //   as the second line may be completely covered by the first.
    if (less(rightmost_start, leftmost_start)) {
      [leftmost_start, rightmost_start] = [rightmost_start, leftmost_start];
      [leftmost_end, rightmost_end] = [rightmost_end, leftmost_end];
    }

    const other_start = { ...rightmost_start };
    const other_end = { ...rightmost_end };

    if (less(rightmost_end, leftmost_end)) {
      rightmost_start = leftmost_start;
      rightmost_end = leftmost_end;
    }

    // If we end one before the beginning of the other, no overlap is possible
    if (less(leftmost_end, other_start)) {
      return null;
    }

    // Search for a common end:
    if (samePt(leftmost_start, other_start) && samePt(leftmost_end, other_end)) {
      // Trivial case
      const ret = SCH_LINE.copyOf(aLine);
      ret.SetStartPoint(leftmost_start);
      ret.SetEndPoint(leftmost_end);
      ret.SetConnectivityDirty(true);

      if (this.IsSelected() || aLine.IsSelected()) ret.SetSelected();

      return ret;
    }

    let colinear = false;

    /* Test alignment: */
    if (leftmost_start.y === leftmost_end.y && other_start.y === other_end.y) {
      // Horizontal segment
      colinear = leftmost_start.y === other_start.y;
    } else if (leftmost_start.x === leftmost_end.x && other_start.x === other_end.x) {
      // Vertical segment
      colinear = leftmost_start.x === other_start.x;
    } else {
      // We use long long here to avoid overflow -- it enforces promotion
      // The slope of the left-most line is dy/dx.  Then we check that the slope from the
      // left most start to the right most start is the same as well as the slope from the
      // left most start to right most end.
      const dx = BigInt(leftmost_end.x - leftmost_start.x);
      const dy = BigInt(leftmost_end.y - leftmost_start.y);
      colinear =
        BigInt(other_start.y - leftmost_start.y) * dx ===
          BigInt(other_start.x - leftmost_start.x) * dy &&
        BigInt(other_end.y - leftmost_start.y) * dx === BigInt(other_end.x - leftmost_start.x) * dy;
    }

    if (!colinear) return null;

    // We either have a true overlap or colinear touching segments.  We always want to merge
    // the former, but the later only get merged if there no junction at the touch point.

    const touching = samePt(leftmost_end, rightmost_start);

    if (touching && aCheckJunctions && aScreen?.IsJunction(leftmost_end)) return null;

    // Make a new segment that merges the 2 segments
    leftmost_end = rightmost_end;

    const ret = SCH_LINE.copyOf(aLine);
    ret.SetStartPoint(leftmost_start);
    ret.SetEndPoint(leftmost_end);
    ret.SetConnectivityDirty(true);

    if (this.IsSelected() || aLine.IsSelected()) ret.SetSelected();

    return ret;
  }

  /**
   * Break this segment into two at the specified point.
   *
   * @note No checks are made to verify if aPoint is contained within the segment. That is
   *       the responsibility of the caller.
   * @note It is the responsibility of the caller to add the newly created segment to the screen.
   *
   * @param aPoint Point at which to break the segment
   * @return The newly created segment.
   */
  BreakAt(aCommit: SCH_COMMIT_LIKE | null, aPoint: VECTOR2I): SCH_LINE {
    const newSegment = this.Duplicate(true /* addToParentGroup */, aCommit) as SCH_LINE;

    newSegment.SetStartPoint(aPoint);
    newSegment.SetConnectivityDirty(true);
    this.SetEndPoint(aPoint);

    return newSegment;
  }

  NonGroupAware_BreakAt(aPoint: VECTOR2I): SCH_LINE {
    const newSegment = this.Duplicate(false /* addToParentGroup */, null) as SCH_LINE;

    newSegment.SetStartPoint(aPoint);
    newSegment.SetConnectivityDirty(true);
    this.SetEndPoint(aPoint);

    return newSegment;
  }

  IsParallel(aLine: SCH_LINE): boolean {
    if (!(aLine && aLine.Type() === KICAD_T.SCH_LINE_T)) return false; // wxCHECK_MSG

    const firstSeg = { x: this.m_end.x - this.m_start.x, y: this.m_end.y - this.m_start.y };
    const secondSeg = { x: aLine.m_end.x - aLine.m_start.x, y: aLine.m_end.y - aLine.m_start.y };

    // Use long long here to avoid overflow in calculations
    return !(BigInt(firstSeg.x) * BigInt(secondSeg.y) - BigInt(firstSeg.y) * BigInt(secondSeg.x));
  }

  /**
   * For wires only:
   * @return true if a wire can accept a hop over arc shape. false for other items.
   */
  ShouldHopOver(aLine: SCH_LINE): boolean {
    // try to find if this should hop over aLine. Horizontal wires have preference for hop.
    const isMeVertical = this.m_end.x === this.m_start.x;
    const isCandidateVertical = aLine.GetEndPoint().x === aLine.GetStartPoint().x;

    // Vertical vs. Horizontal: Horizontal should hop
    if (isMeVertical && !isCandidateVertical) return false;

    if (isCandidateVertical && !isMeVertical) return true;

    // Both this and aLine have a slope. Try to find the best candidate
    const slopeMe = (this.m_end.y - this.m_start.y) / (this.m_end.x - this.m_start.x);
    const slopeCandidate =
      (aLine.GetEndPoint().y - aLine.GetStartPoint().y) /
      (aLine.GetEndPoint().x - aLine.GetStartPoint().x);

    if (Math.abs(slopeMe) === Math.abs(slopeCandidate))
      // Can easily happen with 45 deg wires
      return slopeMe < slopeCandidate; // signs are certainly different

    return Math.abs(slopeMe) < Math.abs(slopeCandidate); // The shallower line should hop
  }

  /**
   * For wires only: build the list of points to draw the shape using segments and 180 deg
   * arcs.  Points are VECTOR3I, with x,y = coordinates and z = 0 (a segment end) or 1 (an
   * arc's start, middle and end).
   */
  BuildWireWithHopShape(aScreen: SCH_SCREEN, aArcRadius: number): VECTOR3I[] {
    // Note: Points are VECTOR3D, with Z coord used as flag
    // for segments: start point and end point have the Z coord = 0
    // for arcs: start point middle point and end point have the Z coord = 1

    const wire_shape: VECTOR3I[] = []; // List of coordinates:
    // 2 points for a segment, 3 points for an arc

    if (!this.IsWire() && !this.IsBus()) {
      wire_shape.push({ x: this.GetStartPoint().x, y: this.GetStartPoint().y, z: 0 });
      wire_shape.push({ x: this.GetEndPoint().x, y: this.GetEndPoint().y, z: 0 });
      return wire_shape;
    }

    const existingWires: SCH_LINE[] = []; // wires to test (candidates)
    const intersections: VECTOR2I[] = [];

    for (const item of aScreen.Items().Overlapping(KICAD_T.SCH_LINE_T, this.GetBoundingBox())) {
      const line = item as SCH_LINE;

      if (line.IsWire() || line.IsBus()) existingWires.push(line);
    }

    const currentLineStartPoint = this.GetStartPoint();
    const currentLineEndPoint = this.GetEndPoint();

    for (const existingLine of existingWires) {
      const extLineStartPoint = existingLine.GetStartPoint();
      const extLineEndPoint = existingLine.GetEndPoint();

      if (
        samePt(extLineStartPoint, currentLineStartPoint) &&
        samePt(extLineEndPoint, currentLineEndPoint)
      )
        continue;

      if (!this.ShouldHopOver(existingLine)) continue;

      const currentSegment = new SEG(currentLineStartPoint, currentLineEndPoint);
      const existingSegment = new SEG(extLineStartPoint, extLineEndPoint);

      const intersect = currentSegment.Intersect(existingSegment, true, false);

      if (intersect) {
        if (this.IsEndPoint(intersect) || existingLine.IsEndPoint(intersect)) continue;

        // Ensure intersecting point is not yet entered. it can be already just entered
        // if more than two wires are intersecting at the same point,
        // creating bad hop over shapes for the current wire
        if (intersections.length === 0 || !samePt(intersections.at(-1)!, intersect))
          intersections.push(intersect);
      }
    }

    if (intersections.length === 0) {
      wire_shape.push({ x: currentLineStartPoint.x, y: currentLineStartPoint.y, z: 0 });
      wire_shape.push({ x: currentLineEndPoint.x, y: currentLineEndPoint.y, z: 0 });
    } else {
      const getDistance = (a: VECTOR2I, b: VECTOR2I): number =>
        Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

      const start = this.GetStartPoint();
      intersections.sort((a, b) => getDistance(start, a) - getDistance(start, b));

      let currentStart = this.GetStartPoint();
      const R = aArcRadius;

      for (const hopMid of intersections) {
        // Calculate the angle of the line from start point to end point in radians
        const lineAngle = Math.atan2(
          this.GetEndPoint().y - this.GetStartPoint().y,
          this.GetEndPoint().x - this.GetStartPoint().x,
        );

        // In fact coordinates of points are VECTOR2I, so use an int angle, in degrees
        let arcAngle = lineAngle;

        if (arcAngle < 0.0) arcAngle += Math.PI;
        else if (arcAngle >= Math.PI) arcAngle -= Math.PI;

        const arcMidPoint = {
          x: hopMid.x + Math.trunc(R * Math.sin(arcAngle)),
          y: hopMid.y - Math.trunc(R * Math.cos(arcAngle)),
        };

        const beforeHop = {
          x: hopMid.x - KiROUND(R * Math.cos(lineAngle)),
          y: hopMid.y - KiROUND(R * Math.sin(lineAngle)),
        };
        const afterHop = {
          x: hopMid.x + KiROUND(R * Math.cos(lineAngle)),
          y: hopMid.y + KiROUND(R * Math.sin(lineAngle)),
        };

        // Draw the line from the current start point to the before-hop point
        wire_shape.push({ x: currentStart.x, y: currentStart.y, z: 0 });
        wire_shape.push({ x: beforeHop.x, y: beforeHop.y, z: 0 });

        // Create an arc object
        wire_shape.push({ x: beforeHop.x, y: beforeHop.y, z: 1 });
        wire_shape.push({ x: arcMidPoint.x, y: arcMidPoint.y, z: 1 });
        wire_shape.push({ x: afterHop.x, y: afterHop.y, z: 1 });

        currentStart = afterHop;
      }

      // Draw the final line from the current start point to the end point of the original line
      wire_shape.push({ x: currentStart.x, y: currentStart.y, z: 0 });
      wire_shape.push({ x: this.GetEndPoint().x, y: this.GetEndPoint().y, z: 0 });
    }

    return wire_shape;
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    if (this.IsConnectable()) {
      const t = this.IsBus() ? DANGLING_END_T.BUS_END : DANGLING_END_T.WIRE_END;
      aItemList.push(new DANGLING_END_ITEM(t, this, this.m_start));
      aItemList.push(new DANGLING_END_ITEM(t, this, this.m_end));
    }
  }

  override UpdateDanglingState(
    _aItemListByType: DANGLING_END_ITEM[],
    aItemListByPos: DANGLING_END_ITEM[],
    _aPath: SCH_SHEET_PATH | null = null,
  ): boolean {
    if (!this.IsConnectable()) return false;

    const previousStartState = this.m_startIsDangling;
    const previousEndState = this.m_endIsDangling;

    this.m_startIsDangling = this.m_endIsDangling = true;

    for (
      let it = DANGLING_END_ITEM_HELPER.get_lower_pos(aItemListByPos, this.m_start);
      it < aItemListByPos.length && samePt(aItemListByPos[it]!.GetPosition(), this.m_start);
      it++
    ) {
      const item = aItemListByPos[it]!;

      if (item.GetItem() === this) continue;

      if (
        (this.IsWire() &&
          item.GetType() !== DANGLING_END_T.BUS_END &&
          item.GetType() !== DANGLING_END_T.BUS_ENTRY_END) ||
        (this.IsBus() &&
          item.GetType() !== DANGLING_END_T.WIRE_END &&
          item.GetType() !== DANGLING_END_T.PIN_END)
      ) {
        this.m_startIsDangling = false;
        break;
      }
    }

    for (
      let it = DANGLING_END_ITEM_HELPER.get_lower_pos(aItemListByPos, this.m_end);
      it < aItemListByPos.length && samePt(aItemListByPos[it]!.GetPosition(), this.m_end);
      it++
    ) {
      const item = aItemListByPos[it]!;

      if (item.GetItem() === this) continue;

      if (
        (this.IsWire() &&
          item.GetType() !== DANGLING_END_T.BUS_END &&
          item.GetType() !== DANGLING_END_T.BUS_ENTRY_END) ||
        (this.IsBus() &&
          item.GetType() !== DANGLING_END_T.WIRE_END &&
          item.GetType() !== DANGLING_END_T.PIN_END)
      ) {
        this.m_endIsDangling = false;
        break;
      }
    }

    // We only use the bus dangling state for automatic line starting, so we don't care if it
    // has changed or not (and returning true will result in extra work)
    if (this.IsBus()) return false;

    return (
      previousStartState !== this.m_startIsDangling || previousEndState !== this.m_endIsDangling
    );
  }

  IsStartDangling(): boolean {
    return this.m_startIsDangling;
  }
  IsEndDangling(): boolean {
    return this.m_endIsDangling;
  }
  override IsDangling(): boolean {
    return this.m_startIsDangling || this.m_endIsDangling;
  }

  override IsConnectable(): boolean {
    if (this.m_layer === SCH_LAYER_ID.LAYER_WIRE || this.m_layer === SCH_LAYER_ID.LAYER_BUS)
      return true;

    return false;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    _aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this || !this.IsConnectable()) return false;

    if (!(aItem instanceof SCH_LINE)) return false; // wxCHECK

    const line = aItem;

    if (!samePt(this.GetStartPoint(), line.GetStartPoint())) return true;

    return !samePt(this.GetEndPoint(), line.GetEndPoint());
  }

  override GetConnectionPoints(): VECTOR2I[] {
    return [{ ...this.m_start }, { ...this.m_end }];
  }

  override ConnectionPropagatesTo(aItem: EDA_ITEM): boolean {
    switch (aItem.Type()) {
      case KICAD_T.SCH_LINE_T:
        return this.IsBus() === (aItem as SCH_LINE).IsBus();

      default:
        return true;
    }
  }

  GetSelectedPoints(aPoints: VECTOR2I[]): void {
    if (this.m_flags & STARTPOINT) aPoints.push({ ...this.m_start });

    if (this.m_flags & ENDPOINT) aPoints.push({ ...this.m_end });
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    switch (aItem.Type()) {
      case KICAD_T.SCH_NO_CONNECT_T:
      case KICAD_T.SCH_SYMBOL_T:
        return this.IsWire();

      case KICAD_T.SCH_JUNCTION_T:
      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
      case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
      case KICAD_T.SCH_SHEET_T:
      case KICAD_T.SCH_SHEET_PIN_T:
        return this.IsWire() || this.IsBus();

      default:
        return this.m_layer === aItem.GetLayer();
    }
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    let txtfmt: string;

    if (this.m_start.x === this.m_end.x) {
      switch (this.m_layer) {
        case SCH_LAYER_ID.LAYER_WIRE:
          txtfmt = 'Vertical Wire, length %s';
          break;
        case SCH_LAYER_ID.LAYER_BUS:
          txtfmt = 'Vertical Bus, length %s';
          break;
        default:
          txtfmt = 'Vertical Graphic Line, length %s';
          break;
      }
    } else if (this.m_start.y === this.m_end.y) {
      switch (this.m_layer) {
        case SCH_LAYER_ID.LAYER_WIRE:
          txtfmt = 'Horizontal Wire, length %s';
          break;
        case SCH_LAYER_ID.LAYER_BUS:
          txtfmt = 'Horizontal Bus, length %s';
          break;
        default:
          txtfmt = 'Horizontal Graphic Line, length %s';
          break;
      }
    } else {
      switch (this.m_layer) {
        case SCH_LAYER_ID.LAYER_WIRE:
          txtfmt = 'Wire, length %s';
          break;
        case SCH_LAYER_ID.LAYER_BUS:
          txtfmt = 'Bus, length %s';
          break;
        default:
          txtfmt = 'Graphic Line, length %s';
          break;
      }
    }

    const length = this.GetLength();
    const shown = aUnitsProvider ? aUnitsProvider.MessageTextFromValue(length) : String(length);

    return txtfmt.replace('%s', shown);
  }

  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const line = aItem as SCH_LINE;

    if (this.GetLayer() !== line.GetLayer()) return this.GetLayer() < line.GetLayer();

    if (this.GetStartPoint().x !== line.GetStartPoint().x)
      return this.GetStartPoint().x < line.GetStartPoint().x;

    if (this.GetStartPoint().y !== line.GetStartPoint().y)
      return this.GetStartPoint().y < line.GetStartPoint().y;

    if (this.GetEndPoint().x !== line.GetEndPoint().x)
      return this.GetEndPoint().x < line.GetEndPoint().x;

    return this.GetEndPoint().y < line.GetEndPoint().y;
  }

  override GetPosition(): VECTOR2I {
    return { ...this.m_start };
  }

  override SetPosition(aPosition: VECTOR2I): void {
    this.m_end = {
      x: this.m_end.x - (this.m_start.x - aPosition.x),
      y: this.m_end.y - (this.m_start.y - aPosition.y),
    };
    this.m_start = { x: aPosition.x, y: aPosition.y };
  }

  override GetSortPosition(): VECTOR2I {
    return this.GetMidPoint();
  }

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    return (
      (samePt(this.GetStartPoint(), aPos) && this.IsStartDangling()) ||
      (samePt(this.GetEndPoint(), aPos) && this.IsEndDangling())
    );
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return this.hitTestRect(a, b as boolean, c ?? 0);

    if ('x' in a && 'y' in a) return this.hitTestPoint(a, (b as number | undefined) ?? 0);

    return this.hitTestChain(a, b as boolean);
  }

  private hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    // Performance enhancement for connection-building
    if (samePt(aPosition, this.m_start) || samePt(aPosition, this.m_end)) return true;

    if (aAccuracy >= 0) aAccuracy += Math.trunc(this.GetPenWidth() / 2);
    else aAccuracy = Math.abs(aAccuracy);

    return TestSegmentHit(aPosition, this.m_start, this.m_end, aAccuracy);
  }

  private hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

    const rect = new BOX2I(aRect.GetPosition(), aRect.GetSize());

    if (aAccuracy) rect.Inflate(aAccuracy);

    if (aContained) return rect.Contains(this.m_start) && rect.Contains(this.m_end);

    return rect.Intersects(this.m_start, this.m_end);
  }

  private hitTestChain(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean {
    if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

    const line = new SHAPE_SEGMENT(this.m_start, this.m_end, this.GetPenWidth());
    return KIGEOM_ShapeHitTest(aPoly, line, aContained);
  }

  override Clone(): SCH_LINE {
    return SCH_LINE.copyOf(this);
  }

  GetOperatingPoint(): string {
    return this.m_operatingPoint;
  }
  SetOperatingPoint(aText: string): void {
    this.m_operatingPoint = aText;
  }

  /**
   * Return if the line is a graphic (non electrical line).
   *
   * Currently, anything on the #LAYER_NOTES layer is a graphic line.
   */
  IsGraphicLine(): boolean {
    return this.GetLayer() === SCH_LAYER_ID.LAYER_NOTES;
  }

  /** Return true if the line is a wire. */
  IsWire(): boolean {
    return this.GetLayer() === SCH_LAYER_ID.LAYER_WIRE;
  }

  /** Return true if the line is a bus. */
  IsBus(): boolean {
    return this.GetLayer() === SCH_LAYER_ID.LAYER_BUS;
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (this.Type() !== aOther.Type()) return 0.0;

    const other = aOther as SCH_LINE;

    if (this.GetLayer() !== other.GetLayer()) return 0.0;

    let similarity = 1.0;

    if (!samePt(this.m_start, other.m_start)) similarity *= 0.9;

    if (!samePt(this.m_end, other.m_end)) similarity *= 0.9;

    if (this.m_stroke.GetWidth() !== other.m_stroke.GetWidth()) similarity *= 0.9;

    if (!sameColor4d(this.m_stroke.GetColor(), other.m_stroke.GetColor())) similarity *= 0.9;

    if (this.m_stroke.GetLineStyle() !== other.m_stroke.GetLineStyle()) similarity *= 0.9;

    return similarity;
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const other = aOther as SCH_LINE;

    if (this.GetLayer() !== other.GetLayer()) return false;

    if (!samePt(this.m_start, other.m_start)) return false;

    if (!samePt(this.m_end, other.m_end)) return false;

    if (this.m_stroke.GetWidth() !== other.m_stroke.GetWidth()) return false;

    if (!sameColor4d(this.m_stroke.GetColor(), other.m_stroke.GetColor())) return false;

    if (this.m_stroke.GetLineStyle() !== other.m_stroke.GetLineStyle()) return false;

    return true;
  }

  protected override swapData(aItem: SCH_ITEM): void {
    const item = aItem as SCH_LINE;

    [this.m_start, item.m_start] = [item.m_start, this.m_start];
    [this.m_end, item.m_end] = [item.m_end, this.m_end];
    [this.m_startIsDangling, item.m_startIsDangling] = [
      item.m_startIsDangling,
      this.m_startIsDangling,
    ];
    [this.m_endIsDangling, item.m_endIsDangling] = [item.m_endIsDangling, this.m_endIsDangling];
    [this.m_stroke, item.m_stroke] = [item.m_stroke, this.m_stroke];
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    if (this.m_layer !== SCH_LAYER_ID.LAYER_WIRE && this.m_layer !== SCH_LAYER_ID.LAYER_BUS)
      return false;

    return this.IsEndPoint(aPosition);
  }
}

/**
 * `static struct SCH_LINE_DESC` (eeschema/sch_line.cpp:1214).
 */
(() => {
  const lineStyleEnum = ENUM_MAP.Instance<LINE_STYLE>('LINE_STYLE');

  if (lineStyleEnum.Choices().GetCount() === 0) {
    lineStyleEnum
      .Map(LINE_STYLE.SOLID, 'Solid')
      .Map(LINE_STYLE.DASH, 'Dashed')
      .Map(LINE_STYLE.DOT, 'Dotted')
      .Map(LINE_STYLE.DASHDOT, 'Dash-Dot')
      .Map(LINE_STYLE.DASHDOTDOT, 'Dash-Dot-Dot');
  }

  const wireLineStyleEnum = ENUM_MAP.Instance<WIRE_STYLE>('WIRE_STYLE');

  if (wireLineStyleEnum.Choices().GetCount() === 0) {
    wireLineStyleEnum
      .Map(WIRE_STYLE.DEFAULT, 'Default')
      .Map(WIRE_STYLE.SOLID, 'Solid')
      .Map(WIRE_STYLE.DASH, 'Dashed')
      .Map(WIRE_STYLE.DOT, 'Dotted')
      .Map(WIRE_STYLE.DASHDOT, 'Dash-Dot')
      .Map(WIRE_STYLE.DASHDOTDOT, 'Dash-Dot-Dot');
  }

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_LINE);
  propMgr.InheritsAfter(SCH_LINE, SCH_ITEM);

  const isGraphicLine = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_LINE ? aItem.IsGraphicLine() : false;

  const isWireOrBus = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_LINE ? aItem.IsWire() || aItem.IsBus() : false;

  const coord = (
    aName: string,
    aSetter: keyof SCH_LINE & string,
    aGetter: keyof SCH_LINE & string,
    aType: COORD_TYPES_T,
  ) =>
    new PROPERTY<SCH_LINE, number>(
      SCH_LINE,
      aName,
      aSetter,
      aGetter,
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      aType,
    );

  propMgr.AddProperty(coord('Start X', 'SetStartX', 'GetStartX', COORD_TYPES_T.ABS_X_COORD));
  propMgr.AddProperty(coord('Start Y', 'SetStartY', 'GetStartY', COORD_TYPES_T.ABS_Y_COORD));
  propMgr.AddProperty(coord('End X', 'SetEndX', 'GetEndX', COORD_TYPES_T.ABS_X_COORD));
  propMgr.AddProperty(coord('End Y', 'SetEndY', 'GetEndY', COORD_TYPES_T.ABS_Y_COORD));

  propMgr.AddProperty(
    new PROPERTY<SCH_LINE, number>(
      SCH_LINE,
      'Length',
      'SetLength',
      'GetLength',
      TYPE_DOUBLE,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
  );

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<SCH_LINE, LINE_STYLE>(
        SCH_LINE,
        'Line Style',
        'SetLineStyle',
        'GetLineStyle',
        lineStyleEnum,
      ),
    )
    .SetAvailableFunc(isGraphicLine);

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<SCH_LINE, WIRE_STYLE>(
        SCH_LINE,
        'Wire Style',
        'SetWireStyle',
        'GetWireStyle',
        wireLineStyleEnum,
      ),
    )
    .SetAvailableFunc(isWireOrBus);

  propMgr.AddProperty(
    new PROPERTY<SCH_LINE, number>(
      SCH_LINE,
      'Line Width',
      'SetLineWidth',
      'GetLineWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
  );

  propMgr.AddProperty(
    new PROPERTY<SCH_LINE, Color4d>(
      SCH_LINE,
      'Color',
      'SetLineColor',
      'GetLineColor',
      TYPE_COLOR4D,
    ),
  );
})();
