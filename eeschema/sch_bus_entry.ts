// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_bus_entry.h` / `eeschema/sch_bus_entry.cpp`: `SCH_BUS_ENTRY_BASE`
 * and its two kinds, `SCH_BUS_WIRE_ENTRY` and `SCH_BUS_BUS_ENTRY`.
 *
 * Not here: `Plot`, `GetMenuImage`, `SCH_BUS_ENTRY_DESC`. The
 * net-class width/style/colour wait on the connection graph (E3 part 2).
 */

import { unescapeString } from '@ziroeda/common/string_utils.js';
import {
  ENUM_MAP,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_COLOR4D,
  TYPE_INT,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { COLOR4D_UNSPECIFIED, type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { IsPointOnSegment, RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_SCH_ENTRY_SIZE, DEFAULT_WIRE_WIDTH_MILS } from './default_values.js';
import { DANGLING_END_ITEM, DANGLING_END_T, SCH_ITEM } from './sch_item.js';
import { WIRE_STYLE } from './sch_line.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';

/** `TARGET_BUSENTRY_RADIUS`: circle diameter drawn at the ends. */
export const TARGET_BUSENTRY_RADIUS = schIUScale.milsToIU(12);

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/**
 * `SCH_CONNECTION::IsBusLabel` (sch_connection.cpp): the unescaped label parses as a
 * vector bus or a bus group. `SCH_CONNECTION` itself waits on the connection graph.
 */
export function IsBusLabel(aLabel: string): boolean {
  const unescaped = unescapeString(aLabel);

  return (
    NET_SETTINGS.ParseBusVector(unescaped, null, null) ||
    NET_SETTINGS.ParseBusGroup(unescaped, null, null)
  );
}

/**
 * Base class for a bus or wire entry.
 */
export abstract class SCH_BUS_ENTRY_BASE extends SCH_ITEM {
  protected m_pos: VECTOR2I;
  protected m_size: VECTOR2I;
  protected m_isStartDangling: boolean;
  protected m_isEndDangling: boolean;
  protected m_stroke: STROKE_PARAMS;

  // If real-time connectivity gets disabled (due to being too slow on a particular
  // design), we can no longer rely on getting the NetClass to find netclass-specific
  // linestyles, linewidths and colors.
  protected m_lastResolvedLineStyle: LINE_STYLE;
  protected m_lastResolvedWidth: number;
  protected m_lastResolvedColor: Color4d;

  constructor(aType: KICAD_T, pos: VECTOR2I = { x: 0, y: 0 }, aFlipY = false) {
    super(null, aType);

    this.m_pos = { x: pos.x, y: pos.y };
    this.m_size = {
      x: schIUScale.milsToIU(DEFAULT_SCH_ENTRY_SIZE),
      y: schIUScale.milsToIU(DEFAULT_SCH_ENTRY_SIZE),
    };

    this.m_stroke = new STROKE_PARAMS();
    this.m_stroke.SetWidth(0);
    this.m_stroke.SetLineStyle(LINE_STYLE.DEFAULT);
    this.m_stroke.SetColor(COLOR4D_UNSPECIFIED);

    if (aFlipY) this.m_size.y *= -1;

    this.m_isStartDangling = this.m_isEndDangling = true;

    this.m_lastResolvedWidth = schIUScale.milsToIU(DEFAULT_WIRE_WIDTH_MILS);
    this.m_lastResolvedLineStyle = LINE_STYLE.SOLID;
    this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };
  }

  /** The compiler-generated copy of this class's members. */
  protected static copyBusEntry<T extends SCH_BUS_ENTRY_BASE>(
    aInto: T,
    aOther: SCH_BUS_ENTRY_BASE,
  ): T {
    SCH_ITEM.copySchItem(aInto, aOther);
    aInto.m_pos = { ...aOther.m_pos };
    aInto.m_size = { ...aOther.m_size };
    aInto.m_isStartDangling = aOther.m_isStartDangling;
    aInto.m_isEndDangling = aOther.m_isEndDangling;
    aInto.m_stroke = aOther.m_stroke.clone();
    aInto.m_lastResolvedLineStyle = aOther.m_lastResolvedLineStyle;
    aInto.m_lastResolvedWidth = aOther.m_lastResolvedWidth;
    aInto.m_lastResolvedColor = { ...aOther.m_lastResolvedColor };
    return aInto;
  }

  IsStartDangling(): boolean {
    return this.m_isStartDangling;
  }
  IsEndDangling(): boolean {
    return this.m_isEndDangling;
  }
  SetEndDangling(aDanglingState: boolean): void {
    this.m_isEndDangling = aDanglingState;
  }

  override SetLastResolvedState(aItem: SCH_ITEM): void {
    if (aItem instanceof SCH_BUS_ENTRY_BASE) {
      this.m_lastResolvedWidth = aItem.m_lastResolvedWidth;
      this.m_lastResolvedLineStyle = aItem.m_lastResolvedLineStyle;
      this.m_lastResolvedColor = { ...aItem.m_lastResolvedColor };
    }
  }

  /** Return true for items which are moved with the anchor point at mouse cursor. */
  override IsMovableFromAnchorPoint(): boolean {
    return false;
  }

  GetEnd(): VECTOR2I {
    return { x: this.m_pos.x + this.m_size.x, y: this.m_pos.y + this.m_size.y };
  }

  GetSize(): VECTOR2I {
    return { ...this.m_size };
  }
  SetSize(aSize: VECTOR2I): void {
    this.m_size = { x: aSize.x, y: aSize.y };
  }

  override GetPenWidth(): number {
    return this.m_lastResolvedWidth;
  }

  SetPenWidth(aWidth: number): void {
    this.m_stroke.SetWidth(aWidth);
    this.m_lastResolvedWidth = aWidth;
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

  SetLineStyle(aStyle: LINE_STYLE): void {
    this.m_stroke.SetLineStyle(aStyle);
    this.m_lastResolvedLineStyle = aStyle;
  }

  GetEffectiveLineStyle(): LINE_STYLE {
    if (this.m_stroke.GetLineStyle() !== LINE_STYLE.DEFAULT)
      this.m_lastResolvedLineStyle = this.m_stroke.GetLineStyle();
    // else if( IsConnectable() && !IsConnectivityDirty() ) -> net class: pending.

    return this.m_lastResolvedLineStyle;
  }

  SetWireStyle(aStyle: WIRE_STYLE): void {
    this.SetLineStyle(aStyle as unknown as LINE_STYLE);
  }
  GetWireStyle(): WIRE_STYLE {
    return this.GetStroke().GetLineStyle() as unknown as WIRE_STYLE;
  }

  GetBusEntryColor(): Color4d {
    if (!color4dEquals(this.m_stroke.GetColor(), COLOR4D_UNSPECIFIED))
      this.m_lastResolvedColor = { ...this.m_stroke.GetColor() };
    // else if( IsConnectable() && !IsConnectivityDirty() ) -> net class: pending.

    return this.m_lastResolvedColor;
  }

  SetBusEntryColor(aColor: Color4d): void {
    this.m_stroke.SetColor(aColor);
    this.m_lastResolvedColor = { ...aColor };
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (!(aItem instanceof SCH_BUS_ENTRY_BASE)) return; // wxCHECK_RET

    const item = aItem;

    [this.m_pos, item.m_pos] = [item.m_pos, this.m_pos];
    [this.m_size, item.m_size] = [item.m_size, this.m_size];
    [this.m_stroke, item.m_stroke] = [item.m_stroke, this.m_stroke];

    [this.m_lastResolvedWidth, item.m_lastResolvedWidth] = [
      item.m_lastResolvedWidth,
      this.m_lastResolvedWidth,
    ];
    [this.m_lastResolvedLineStyle, item.m_lastResolvedLineStyle] = [
      item.m_lastResolvedLineStyle,
      this.m_lastResolvedLineStyle,
    ];
    [this.m_lastResolvedColor, item.m_lastResolvedColor] = [
      item.m_lastResolvedColor,
      this.m_lastResolvedColor,
    ];
  }

  override ViewGetLayers(): number[] {
    // Bus entries are drawn on the wire or bus layer.
    if (this.Type() === KICAD_T.SCH_BUS_BUS_ENTRY_T)
      return [
        SCH_LAYER_ID.LAYER_BUS,
        SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT,
        SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
      ];

    return [
      SCH_LAYER_ID.LAYER_WIRE,
      SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
  }

  override GetBoundingBox(): BOX2I {
    const bbox = new BOX2I(this.m_pos);
    bbox.SetEnd(this.GetEnd());

    bbox.Normalize();
    bbox.Inflate(Math.trunc(this.GetPenWidth() / 2) + 1);

    return bbox;
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_pos = { x: this.m_pos.x + aMoveVector.x, y: this.m_pos.y + aMoveVector.y };
  }

  override MirrorHorizontally(aCenter: number): void {
    this.m_pos.x = aCenter - (this.m_pos.x - aCenter);
    this.m_size.x = -this.m_size.x;
  }

  override MirrorVertically(aCenter: number): void {
    this.m_pos.y = aCenter - (this.m_pos.y - aCenter);
    this.m_size.y = -this.m_size.y;
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    this.m_pos = RotatePoint(this.m_pos, aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
    this.m_size = RotatePoint(this.m_size, aRotateCCW ? ANGLE_90 : ANGLE_270);
  }

  override IsDangling(): boolean {
    return this.m_isStartDangling || this.m_isEndDangling;
  }

  override IsConnectable(): boolean {
    return true;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    _aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Don't compare against itself.
    if (aItem === this) return false;

    if (!(aItem instanceof SCH_BUS_ENTRY_BASE)) return false; // wxCHECK

    // Check if the position has changed.
    if (!samePt(this.GetPosition(), aItem.GetPosition())) return true;

    return !samePt(this.GetEnd(), aItem.GetEnd());
  }

  override GetConnectionPoints(): VECTOR2I[] {
    return [{ ...this.m_pos }, this.GetEnd()];
  }

  override GetPosition(): VECTOR2I {
    return { ...this.m_pos };
  }
  override SetPosition(aPosition: VECTOR2I): void {
    this.m_pos = { x: aPosition.x, y: aPosition.y };
  }

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    return (
      (samePt(this.GetPosition(), aPos) && this.IsStartDangling()) ||
      (samePt(this.GetEnd(), aPos) && this.IsEndDangling())
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
    if (a instanceof BOX2I) {
      const rect = new BOX2I(a.GetPosition(), a.GetSize());

      rect.Inflate(c ?? 0);

      if (b as boolean) return rect.Contains(this.GetBoundingBox());

      return rect.Intersects(this.GetBoundingBox());
    }

    if ('x' in a && 'y' in a) {
      let aAccuracy = (b as number | undefined) ?? 0;

      // Insure minimum accuracy
      if (aAccuracy === 0) aAccuracy = Math.trunc(this.GetPenWidth() / 2) + 4;

      return TestSegmentHit(a, this.m_pos, this.GetEnd(), aAccuracy);
    }

    const line = new SHAPE_SEGMENT(this.m_pos, this.GetEnd(), this.GetPenWidth());
    return KIGEOM_ShapeHitTest(a, line, b as boolean);
  }

  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const symbol = aItem as SCH_BUS_ENTRY_BASE;

    if (this.GetLayer() !== symbol.GetLayer()) return this.GetLayer() < symbol.GetLayer();

    if (this.GetPosition().x !== symbol.GetPosition().x)
      return this.GetPosition().x < symbol.GetPosition().x;

    if (this.GetPosition().y !== symbol.GetPosition().y)
      return this.GetPosition().y < symbol.GetPosition().y;

    if (this.GetEnd().x !== symbol.GetEnd().x) return this.GetEnd().x < symbol.GetEnd().x;

    return this.GetEnd().y < symbol.GetEnd().y;
  }

  override Similarity(aItem: SCH_ITEM): number {
    if (aItem.Type() !== this.Type()) return 0.0;

    if (this.m_Uuid === aItem.m_Uuid) return 1.0;

    const other = aItem as SCH_BUS_ENTRY_BASE;

    if (this.GetLayer() !== other.GetLayer()) return 0.0;

    if (!samePt(this.GetPosition(), other.GetPosition())) return 0.0;

    return 1.0;
  }

  override equals(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return false;

    const symbol = aItem as SCH_BUS_ENTRY_BASE;

    if (this.GetLayer() !== symbol.GetLayer()) return false;

    if (!samePt(this.GetPosition(), symbol.GetPosition())) return false;

    if (!samePt(this.GetEnd(), symbol.GetEnd())) return false;

    return true;
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    return samePt(this.m_pos, aPosition) || samePt(this.GetEnd(), aPosition);
  }
}

/**
 * Class for a wire to bus entry.
 */
export class SCH_BUS_WIRE_ENTRY extends SCH_BUS_ENTRY_BASE {
  /**
   * Pointer to the bus item (usually a bus wire) connected to this bus-wire
   * entry, if it is connected to one.
   */
  m_connected_bus_item: SCH_ITEM | null;

  /**
   * `SCH_BUS_WIRE_ENTRY( pos, aFlipY )`, or `SCH_BUS_WIRE_ENTRY( pos, aQuadrant )` when the
   * second argument is a number: the quadrant (1..4) the entry's far end lies in.
   */
  constructor(pos: VECTOR2I = { x: 0, y: 0 }, aFlipYOrQuadrant: boolean | number = false) {
    super(
      KICAD_T.SCH_BUS_WIRE_ENTRY_T,
      pos,
      typeof aFlipYOrQuadrant === 'boolean' ? aFlipYOrQuadrant : false,
    );

    if (typeof aFlipYOrQuadrant === 'number') {
      switch (aFlipYOrQuadrant) {
        case 1:
          this.m_size.x *= 1;
          this.m_size.y *= -1;
          break;
        case 2:
          this.m_size.x *= 1;
          this.m_size.y *= 1;
          break;
        case 3:
          this.m_size.x *= -1;
          this.m_size.y *= 1;
          break;
        case 4:
          this.m_size.x *= -1;
          this.m_size.y *= -1;
          break;
        default:
          // wxFAIL_MSG( "SCH_BUS_WIRE_ENTRY ctor: unexpected quadrant" )
          break;
      }
    }

    this.m_layer = SCH_LAYER_ID.LAYER_WIRE;
    this.m_connected_bus_item = null;

    this.m_lastResolvedWidth = schIUScale.milsToIU(DEFAULT_WIRE_WIDTH_MILS);
    this.m_lastResolvedLineStyle = LINE_STYLE.SOLID;
    this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };
  }

  static copyOf(aOther: SCH_BUS_WIRE_ENTRY): SCH_BUS_WIRE_ENTRY {
    const copy = new SCH_BUS_WIRE_ENTRY(aOther.m_pos);
    SCH_BUS_ENTRY_BASE.copyBusEntry(copy, aOther);
    copy.m_connected_bus_item = aOther.m_connected_bus_item;
    return copy;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_BUS_WIRE_ENTRY_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_BUS_WIRE_ENTRY';
  }

  /** `GetMsgPanelInfo( aFrame, aList )` (sch_bus_entry.cpp). */
  override GetMsgPanelInfo(_aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    let msg: string;

    switch (this.GetLayer()) {
      default:
      case SCH_LAYER_ID.LAYER_WIRE:
        msg = 'Wire';
        break;
      case SCH_LAYER_ID.LAYER_BUS:
        msg = 'Bus';
        break;
    }

    aList.push(new MSG_PANEL_ITEM('Bus Entry Type', msg));

    // dynamic_cast<SCH_EDIT_FRAME*>( aFrame ): a schematic editor's item has a schematic.
    const conn = !this.IsConnectivityDirty() && this.Schematic() ? this.Connection() : null;

    if (conn) {
      conn.AppendInfoToMsgPanel(aList);

      // Upstream does not unescape this one; null is NETCLASS( wxEmptyString ), named ''.
      if (!conn.IsBus())
        aList.push(
          new MSG_PANEL_ITEM(
            'Resolved Netclass',
            this.GetEffectiveNetClass()?.GetHumanReadableName() ?? '',
          ),
        );
    }
  }

  override GetPenWidth(): number {
    if (this.m_stroke.GetWidth() > 0) this.m_lastResolvedWidth = this.m_stroke.GetWidth();
    // else if( IsConnectable() && !IsConnectivityDirty() ) -> net class wire width: pending.

    return this.m_lastResolvedWidth;
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    aItemList.push(new DANGLING_END_ITEM(DANGLING_END_T.WIRE_ENTRY_END, this, this.m_pos));
    aItemList.push(new DANGLING_END_ITEM(DANGLING_END_T.WIRE_ENTRY_END, this, this.GetEnd()));
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    return (
      aItem.Type() === KICAD_T.SCH_LINE_T &&
      (aItem.GetLayer() === SCH_LAYER_ID.LAYER_WIRE || aItem.GetLayer() === SCH_LAYER_ID.LAYER_BUS)
    );
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Bus to wire entry';
  }

  override Clone(): SCH_BUS_WIRE_ENTRY {
    return SCH_BUS_WIRE_ENTRY.copyOf(this);
  }

  /**
   * Pass SCH_WIRE_BUS_ENTRY connections through only to the wire side: a bus line, a bus
   * junction, a bus label or another bus-wire entry does not get this entry's connection.
   */
  override ConnectionPropagatesTo(aItem: EDA_ITEM): boolean {
    // Don't generate connections between bus entries and buses, since there is
    // a connectivity change at that point (e.g. A[7..0] to A7)
    if (
      aItem.Type() === KICAD_T.SCH_LINE_T &&
      (aItem as SCH_ITEM).GetLayer() === SCH_LAYER_ID.LAYER_BUS
    ) {
      return false;
    }

    // Same for bus junctions
    if (
      aItem.Type() === KICAD_T.SCH_JUNCTION_T &&
      (aItem as SCH_ITEM).GetLayer() === SCH_LAYER_ID.LAYER_BUS_JUNCTION
    ) {
      return false;
    }

    // Don't generate connections between bus entries and bus labels that happen
    // to land at the same point on the bus wire as this bus entry
    if (
      aItem.Type() === KICAD_T.SCH_LABEL_T &&
      IsBusLabel((aItem as unknown as { GetText(): string }).GetText())
    ) {
      return false;
    }

    // Don't generate connections between two bus-wire entries
    if (aItem.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) return false;

    return true;
  }

  override UpdateDanglingState(
    aItemListByType: DANGLING_END_ITEM[],
    _aItemListByPos: DANGLING_END_ITEM[],
    _aPath: SCH_SHEET_PATH | null = null,
  ): boolean {
    const previousStateStart = this.m_isStartDangling;
    const previousStateEnd = this.m_isEndDangling;

    this.m_isStartDangling = this.m_isEndDangling = true;

    // Store the connection type and state for the start (0) and end (1)
    const has_wire = [false, false];
    const has_bus = [false, false];

    for (let ii = 0; ii < aItemListByType.length; ii++) {
      const item = aItemListByType[ii]!;

      if (item.GetItem() === this) continue;

      switch (item.GetType()) {
        case DANGLING_END_T.WIRE_END:
          if (samePt(this.m_pos, item.GetPosition())) has_wire[0] = true;
          else if (samePt(this.GetEnd(), item.GetPosition())) has_wire[1] = true;

          break;

        case DANGLING_END_T.BUS_END: {
          // The bus has created 2 DANGLING_END_ITEMs, one per end.
          const nextItem = aItemListByType[++ii]!;

          if (IsPointOnSegment(item.GetPosition(), nextItem.GetPosition(), this.m_pos))
            has_bus[0] = true;
          else if (IsPointOnSegment(item.GetPosition(), nextItem.GetPosition(), this.GetEnd()))
            has_bus[1] = true;

          break;
        }

        default:
          break;
      }
    }

    // A bus-wire entry is connected at both ends if it has a bus and a wire on its
    // ends.  Otherwise, we connect only one end (in the case of a wire-wire or bus-bus)
    if ((has_wire[0] && has_bus[1]) || (has_wire[1] && has_bus[0]))
      this.m_isEndDangling = this.m_isStartDangling = false;
    else if (has_wire[0] || has_bus[0]) this.m_isStartDangling = false;
    else if (has_wire[1] || has_bus[1]) this.m_isEndDangling = false;

    return (
      previousStateStart !== this.m_isStartDangling || previousStateEnd !== this.m_isEndDangling
    );
  }
}

/**
 * Class for a bus to bus entry.
 */
export class SCH_BUS_BUS_ENTRY extends SCH_BUS_ENTRY_BASE {
  /**
   * Pointer to the bus items (usually bus wires) connected to this bus-bus
   * entry (either or both may be nullptr)
   */
  m_connected_bus_items: [SCH_ITEM | null, SCH_ITEM | null];

  constructor(pos: VECTOR2I = { x: 0, y: 0 }, aFlipY = false) {
    super(KICAD_T.SCH_BUS_BUS_ENTRY_T, pos, aFlipY);

    this.m_layer = SCH_LAYER_ID.LAYER_BUS;
    this.m_connected_bus_items = [null, null];

    this.m_lastResolvedWidth = schIUScale.milsToIU(DEFAULT_WIRE_WIDTH_MILS);
    this.m_lastResolvedLineStyle = LINE_STYLE.SOLID;
    this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };
  }

  static copyOf(aOther: SCH_BUS_BUS_ENTRY): SCH_BUS_BUS_ENTRY {
    const copy = new SCH_BUS_BUS_ENTRY(aOther.m_pos);
    SCH_BUS_ENTRY_BASE.copyBusEntry(copy, aOther);
    copy.m_connected_bus_items = [...aOther.m_connected_bus_items];
    return copy;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_BUS_BUS_ENTRY_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_BUS_BUS_ENTRY';
  }

  override GetPenWidth(): number {
    if (this.m_stroke.GetWidth() > 0) this.m_lastResolvedWidth = this.m_stroke.GetWidth();
    // else if( IsConnectable() && !IsConnectivityDirty() ) -> net class bus width: pending.

    return this.m_lastResolvedWidth;
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    aItemList.push(new DANGLING_END_ITEM(DANGLING_END_T.BUS_ENTRY_END, this, this.m_pos));
    aItemList.push(new DANGLING_END_ITEM(DANGLING_END_T.BUS_ENTRY_END, this, this.GetEnd()));
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    return aItem.Type() === KICAD_T.SCH_LINE_T && aItem.GetLayer() === SCH_LAYER_ID.LAYER_BUS;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Bus to bus entry';
  }

  override Clone(): SCH_BUS_BUS_ENTRY {
    return SCH_BUS_BUS_ENTRY.copyOf(this);
  }

  override UpdateDanglingState(
    aItemListByType: DANGLING_END_ITEM[],
    _aItemListByPos: DANGLING_END_ITEM[],
    _aPath: SCH_SHEET_PATH | null = null,
  ): boolean {
    const previousStateStart = this.m_isStartDangling;
    const previousStateEnd = this.m_isEndDangling;

    this.m_isStartDangling = this.m_isEndDangling = true;

    // TODO: filter using get_lower as we only use one item type
    for (let ii = 0; ii < aItemListByType.length; ii++) {
      const item = aItemListByType[ii]!;

      if (item.GetItem() === this) continue;

      switch (item.GetType()) {
        case DANGLING_END_T.BUS_END: {
          // The bus has created 2 DANGLING_END_ITEMs, one per end.
          const nextItem = aItemListByType[++ii]!;

          if (IsPointOnSegment(item.GetPosition(), nextItem.GetPosition(), this.m_pos))
            this.m_isStartDangling = false;

          if (IsPointOnSegment(item.GetPosition(), nextItem.GetPosition(), this.GetEnd()))
            this.m_isEndDangling = false;

          break;
        }

        default:
          break;
      }
    }

    return (
      previousStateStart !== this.m_isStartDangling || previousStateEnd !== this.m_isEndDangling
    );
  }
}

/**
 * `static struct SCH_BUS_ENTRY_DESC` (eeschema/sch_bus_entry.cpp:627).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_BUS_WIRE_ENTRY);
  REGISTER_TYPE(SCH_BUS_BUS_ENTRY);
  REGISTER_TYPE(SCH_BUS_ENTRY_BASE);
  propMgr.InheritsAfter(SCH_BUS_ENTRY_BASE, SCH_ITEM);
  propMgr.InheritsAfter(SCH_BUS_WIRE_ENTRY, SCH_BUS_ENTRY_BASE);
  propMgr.InheritsAfter(SCH_BUS_BUS_ENTRY, SCH_BUS_ENTRY_BASE);

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

  propMgr.AddProperty(
    new PROPERTY_ENUM<SCH_BUS_ENTRY_BASE, WIRE_STYLE>(
      SCH_BUS_ENTRY_BASE,
      'Wire Style',
      'SetWireStyle',
      'GetWireStyle',
      wireLineStyleEnum,
    ),
  );

  propMgr.AddProperty(
    new PROPERTY<SCH_BUS_ENTRY_BASE, number>(
      SCH_BUS_ENTRY_BASE,
      'Line Width',
      'SetPenWidth',
      'GetPenWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
  );

  propMgr.AddProperty(
    new PROPERTY<SCH_BUS_ENTRY_BASE, Color4d>(
      SCH_BUS_ENTRY_BASE,
      'Color',
      'SetBusEntryColor',
      'GetBusEntryColor',
      TYPE_COLOR4D,
    ),
  );
})();
