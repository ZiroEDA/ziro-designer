// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_point.h` / `pcb_point.cpp`: `PCB_POINT`, a construction point
 * drawn as an X with a small circle, on a board layer.
 *
 * Not here: `PCB_POINT_DESC`, the `PROPERTY_MANAGER` registration.
 */

import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FLASHING, GAL_LAYER_ID, PCB_LAYER_ID, POINT_LAYER_FOR } from '@ziroeda/common/layer_id.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { type FLIP_DIRECTION, MIRROR } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestBox } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { type VECTOR2I, add, equal, sub } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
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
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';

import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';

const DEFAULT_PT_SIZE_MM = 1.0;

export class PCB_POINT extends BOARD_ITEM {
  // Center of the point
  private m_pos: VECTOR2I;
  // Visual size of the point in board space
  private m_size: number;

  constructor(aParent: BOARD_ITEM | null);
  /**
   * Construct a point at the given location.
   */
  constructor(aParent: BOARD_ITEM | null, aPos: VECTOR2I, aSize: number);
  constructor(aParent: BOARD_ITEM | null, aPos?: VECTOR2I, aSize?: number) {
    super(aParent, KICAD_T.PCB_POINT_T);

    if (aPos === undefined) {
      this.m_pos = { x: 0, y: 0 };
      this.m_size = pcbIUScale.mmToIU(DEFAULT_PT_SIZE_MM);
    } else {
      this.m_pos = { x: aPos.x, y: aPos.y };
      this.m_size = aSize!;
    }
  }

  /** `PCB_POINT( const PCB_POINT& )`: the compiler-generated copy, as a static. */
  static copyOf(aOther: PCB_POINT): PCB_POINT {
    const copy = new PCB_POINT(null);
    copy.assignPoint(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignPoint(aOther: PCB_POINT): this {
    this.assignBoardItem(aOther);
    this.m_pos = { ...aOther.m_pos };
    this.m_size = aOther.m_size;
    return this;
  }

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && KICAD_T.PCB_POINT_T === aItem.Type();
  }

  /** `cmp_points::operator()`. */
  static cmp_points(a: PCB_POINT, b: PCB_POINT): boolean {
    if (a.GetLayer() !== b.GetLayer()) return a.GetLayer() < b.GetLayer();

    if (a.GetPosition().x !== b.GetPosition().x) return a.GetPosition().x < b.GetPosition().x;

    if (a.GetPosition().y !== b.GetPosition().y) return a.GetPosition().y < b.GetPosition().y;

    if (a.GetSize() !== b.GetSize()) return a.GetSize() < b.GetSize();

    if (a.m_Uuid !== b.m_Uuid) return a.m_Uuid < b.m_Uuid;

    return false; // a < b: pointer order, no analogue
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_pos = { x: aPos.x, y: aPos.y };
  }
  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  SetSize(aSize: number): void {
    this.m_size = aSize;
  }
  GetSize(): number {
    return this.m_size;
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_pos = add(this.m_pos, aMoveVector);
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    // All points hidden
    if (!aView!.IsLayerVisible(GAL_LAYER_ID.LAYER_POINTS)) return PCB_POINT.LOD_HIDE;

    // Hide if the "main" layer is not shown
    if (!aView!.IsLayerVisible(this.m_layer)) return PCB_POINT.LOD_HIDE;

    return PCB_POINT.LOD_SHOW;
  }

  override ViewGetLayers(): number[] {
    const layer = this.GetLayer();

    const layers: number[] = [POINT_LAYER_FOR(layer)];

    if (this.IsLocked()) layers.push(GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW);

    return layers;
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_pos = RotatePoint(this.m_pos, aRotCentre, aAngle);
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_pos, aCentre, aFlipDirection);
    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));
  }

  GetClass(): string {
    return 'PCB_POINT';
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I)
      return KIGEOM_BoxHitTestBox(a, this.GetBoundingBox(), b as boolean, c ?? 0);

    if (typeof (a as VECTOR2I).x !== 'number')
      // Not overridden for a chain in C++: BOARD_ITEM's default.
      return super.HitTest(a as SHAPE_LINE_CHAIN, b as boolean);

    const aPosition = a as VECTOR2I;
    const aAccuracy = (b as number | undefined) ?? 0;

    // Compute the hit on the bars of the X
    const size = Math.trunc(this.GetSize() / 2);
    const loc = new SEG(aPosition, aPosition);

    const seg1 = new SEG(
      sub(this.m_pos, { x: size, y: size }),
      add(this.m_pos, { x: size, y: size }),
    );
    const seg2 = new SEG(
      sub(this.m_pos, { x: size, y: -size }),
      add(this.m_pos, { x: size, y: -size }),
    );
    const circle = new SHAPE_CIRCLE(this.m_pos, Math.trunc(size / 2));

    const hit =
      seg1.Collide(loc, aAccuracy) ||
      seg2.Collide(loc, aAccuracy) ||
      circle.Collide(loc, aAccuracy);

    return hit;
  }

  // Virtual function
  override GetBoundingBox(): BOX2I {
    const bbox = BOX2I.ByCenter(this.m_pos, { x: this.m_size, y: this.m_size });
    return bbox;
  }

  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    return new SHAPE_RECT(this.GetBoundingBox());
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return 'Point';
  }

  override GetMenuImage(): string {
    return 'add_point'; // BITMAPS::add_point
  }

  override Clone(): PCB_POINT {
    return PCB_POINT.copyOf(this);
  }

  protected override swapData(aOther: BOARD_ITEM): void {
    console.assert(aOther.Type() === KICAD_T.PCB_POINT_T);

    // std::swap( *this, *aOther ): every member of both classes.
    const other = aOther as PCB_POINT;
    const mine = PCB_POINT.copyOf(this);

    this.assignPoint(other);
    (this as { m_Uuid: string }).m_Uuid = other.m_Uuid;
    other.assignPoint(mine);
    (other as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    aList.push(new MSG_PANEL_ITEM('PCB Point', ''));
    aList.push(new MSG_PANEL_ITEM('Position X', aFrame.MessageTextFromValue(this.GetPosition().x)));
    aList.push(new MSG_PANEL_ITEM('Position Y', aFrame.MessageTextFromValue(this.GetPosition().y)));
    aList.push(new MSG_PANEL_ITEM('Size', aFrame.MessageTextFromValue(this.GetSize())));
    aList.push(new MSG_PANEL_ITEM('Layer', this.GetLayerName()));
  }

  /**
   * Convert the shape to a closed polygon.
   *
   * Used in filling zones calculations.  Circles and arcs are approximated by segments.
   */
  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    ignoreLineWidth = false,
  ): void {}

  /** `operator==( const BOARD_ITEM& )`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_POINT;

    return this.equalsPoint(other);
  }

  /** `operator==( const PCB_POINT& )`. */
  equalsPoint(aOther: PCB_POINT): boolean {
    return equal(this.m_pos, aOther.m_pos) && this.m_size === aOther.m_size;
  }

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_POINT;

    let similarity = 1.0;

    // Upstream compares the positions with `==` here (a bug it carries); mirrored as written.
    if (equal(this.m_pos, other.m_pos)) similarity *= 0.9;

    if (this.m_size !== other.m_size) similarity *= 0.9;

    if (this.GetLayer() !== other.GetLayer()) similarity *= 0.9;

    return similarity;
  }
}

/**
 * `static struct PCB_POINT_DESC` (pcbnew/pcb_point.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_POINT);
  propMgr.InheritsAfter(PCB_POINT, BOARD_ITEM);

  propMgr.AddProperty(
    new PROPERTY<PCB_POINT, number>(
      PCB_POINT,
      'Size',
      'SetSize',
      'GetSize',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
  );
})();
