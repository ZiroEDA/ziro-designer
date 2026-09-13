// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/marker_base.h` / `common/marker_base.cpp`: `MARKER_BASE`, the
 * graphic shape (an arrow polygon) markers in Pcbnew and Eeschema share.
 * `PCB_MARKER` and `SCH_MARKER` inherit this beside their item base; see
 * `applyMixins`. A derived constructor calls `initMarkerBase()`.
 */

import type { Color4d } from './color4d.js';
import type { KIID } from './kiid.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { RC_ITEM } from './rc_item.js';
import { RPT_SEVERITY_EXCLUSION, RPT_SEVERITY_UNDEFINED, type Severity } from './reporter.js';

/**
 * The graphic shape of markers is a polygon.
 *
 * MarkerShapeCorners contains the coordinates of corners of the polygonal default shape
 * they are arbitrary units to make coding shape easy.
 * Internal units coordinates are these values scaled by .m_ScalingFactor
 */
const MarkerShapeCorners: readonly VECTOR2I[] = [
  { x: 0, y: 0 },
  { x: 8, y: 1 },
  { x: 4, y: 3 },
  { x: 13, y: 8 },
  { x: 9, y: 9 },
  { x: 8, y: 13 },
  { x: 3, y: 4 },
  { x: 1, y: 8 },
  { x: 0, y: 0 },
];
const CORNERS_COUNT = MarkerShapeCorners.length;

export enum MARKER_T {
  MARKER_UNSPEC = 0,
  MARKER_ERC = 1,
  MARKER_DRC = 2,
  MARKER_DRAWING_SHEET = 3,
  MARKER_RATSNEST = 4,
  MARKER_PARITY = 5,
  MARKER_SIMUL = 6,
}

/**
 * Marker are mainly used to show a DRC or ERC error or warning
 */
export abstract class MARKER_BASE {
  static readonly MARKER_T = MARKER_T;

  m_Pos!: VECTOR2I; ///< Position of the marker.

  protected m_markerType!: MARKER_T; ///< The type of marker.
  protected m_excluded!: boolean; ///< User has excluded this specific error.
  protected m_comment!: string; ///< User supplied comment.
  protected m_rcItem!: RC_ITEM | null;
  protected m_scalingFactor!: number; ///< Scaling factor to convert corners coordinates to internal
  ///< units.  Dependant on current zoom.
  protected m_shapeBoundingBox!: BOX2I; ///< Bounding box of the graphic symbol relative to the position
  ///< of the shape in marker shape units.

  /** `MARKER_BASE( int aScalingFactor, std::shared_ptr<RC_ITEM> aItem, MARKER_T aType )`. */
  protected initMarkerBase(
    aScalingFactor: number,
    aItem: RC_ITEM | null,
    aType: MARKER_T = MARKER_T.MARKER_UNSPEC,
  ): void {
    this.m_Pos = { x: 0, y: 0 };
    this.m_markerType = aType;
    this.m_excluded = false;
    this.m_comment = '';
    this.m_rcItem = aItem;
    this.m_scalingFactor = aScalingFactor;
    this.m_shapeBoundingBox = new BOX2I();

    let point_shape = 0;
    const start: VECTOR2I = { x: MarkerShapeCorners[0]!.x, y: MarkerShapeCorners[0]!.y };
    const end: VECTOR2I = { x: start.x, y: start.y };

    for (let ii = 1; ii < CORNERS_COUNT; ii++) {
      ++point_shape;
      const corner = MarkerShapeCorners[point_shape]!;
      start.x = Math.min(start.x, corner.x);
      start.y = Math.min(start.y, corner.y);
      end.x = Math.max(end.x, corner.x);
      end.y = Math.max(end.y, corner.y);
    }

    this.m_shapeBoundingBox.SetOrigin(start);
    this.m_shapeBoundingBox.SetEnd(end);
  }

  /** The compiler-generated copy: the RC_ITEM is shared (a `shared_ptr`), not copied. */
  protected initMarkerBaseFrom(aOther: MARKER_BASE): void {
    this.m_Pos = { ...aOther.m_Pos };
    this.m_markerType = aOther.m_markerType;
    this.m_excluded = aOther.m_excluded;
    this.m_comment = aOther.m_comment;
    this.m_rcItem = aOther.m_rcItem;
    this.m_scalingFactor = aOther.m_scalingFactor;
    this.m_shapeBoundingBox = aOther.m_shapeBoundingBox.Clone();
  }

  /**
   * The scaling factor to convert polygonal shape coordinates to internal units.
   */
  MarkerScale(): number {
    return this.m_scalingFactor;
  }
  SetMarkerScale(aScale: number): void {
    this.m_scalingFactor = aScale;
  }

  /**
   * Return the shape polygon in internal units in a #SHAPE_LINE_CHAIN the coordinates
   * are relatives to the marker position (are not absolute).
   *
   * @param aPolygon is the #SHAPE_LINE_CHAIN to fill with the shape.
   */
  ShapeToPolygon(aPolygon: SHAPE_LINE_CHAIN, aScale = -1): void {
    if (aScale < 0) aScale = this.MarkerScale();

    for (const corner of MarkerShapeCorners)
      aPolygon.Append({ x: corner.x * aScale, y: corner.y * aScale });

    // Be sure aPolygon is seen as a closed polyline:
    aPolygon.SetClosed(true);
  }

  /**
   * @return the position of this marker in internal units.
   */
  GetPos(): VECTOR2I {
    return this.m_Pos;
  }

  abstract GetUUID(): KIID;

  /**
   * Accessors to set/get marker type (DRC, ERC, or other)
   */
  SetMarkerType(aMarkerType: MARKER_T): void {
    this.m_markerType = aMarkerType;
  }
  GetMarkerType(): MARKER_T {
    return this.m_markerType;
  }

  IsExcluded(): boolean {
    return this.m_excluded;
  }
  SetExcluded(aExcluded: boolean, aComment = ''): void {
    this.m_excluded = aExcluded;
    this.m_comment = aComment;
  }

  GetComment(): string {
    return this.m_comment;
  }

  GetSeverity(): Severity {
    return RPT_SEVERITY_UNDEFINED;
  }

  /**
   * A marker is treated as excluded when the user has dismissed it through the DRC UI
   * (m_excluded) or when a custom rule has pinned its severity to "exclusion".
   */
  IsTreatedAsExcluded(): boolean {
    return this.m_excluded || this.GetSeverity() === RPT_SEVERITY_EXCLUSION;
  }

  /**
   * @return the #RC_ITEM held within this marker so that its interface may be used.
   */
  GetRCItem(): RC_ITEM | null {
    return this.m_rcItem;
  }

  /**
   * Test if the given #VECTOR2I is within the bounds of this object.
   *
   * @param aHitPosition is the #VECTOR2I to test (in internal units).
   * @return true if a hit, else false.
   */
  HitTestMarker(aHitPosition: VECTOR2I, aAccuracy: number): boolean;
  /**
   * Test if the given #BOX2I intersects or contains the bounds of this object.
   */
  HitTestMarker(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  /**
   * Test if the given #SHAPE_LINE_CHAIN intersects or contains the bounds of this object.
   */
  HitTestMarker(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  HitTestMarker(a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN, b: number | boolean, c = 0): boolean {
    if (a instanceof BOX2I) {
      const bbox = this.GetBoundingBoxMarker().GetInflated(c);

      if (b as boolean) return a.Contains(bbox);

      return a.Intersects(bbox);
    }

    if (a instanceof SHAPE_LINE_CHAIN) {
      const shape = new SHAPE_LINE_CHAIN();
      this.ShapeToPolygon(shape);
      shape.Move(this.m_Pos);

      return KIGEOM_ShapeHitTest(a, shape, b as boolean);
    }

    const aHitPosition = a;
    const aAccuracy = b as number;
    const bbox = this.GetBoundingBoxMarker().GetInflated(aAccuracy);

    // Fast hit test using boundary box. A finer test will be made if requested
    let hit = bbox.Contains(aHitPosition);

    if (hit) {
      // Fine test
      const polygon = new SHAPE_LINE_CHAIN();
      this.ShapeToPolygon(polygon);

      const rel_pos: VECTOR2I = {
        x: aHitPosition.x - this.m_Pos.x,
        y: aHitPosition.y - this.m_Pos.y,
      };
      hit = polygon.PointInside(rel_pos, aAccuracy);
    }

    return hit;
  }

  /**
   * Return the orthogonal, bounding box of this object for display purposes.
   *
   * This box should be an enclosing perimeter for visible components of this
   * object, and the units should be in the pcb or schematic coordinate system.
   * It is OK to overestimate the size by a few counts.
   */
  GetBoundingBoxMarker(): BOX2I {
    const bbox = this.m_shapeBoundingBox;
    const pos: VECTOR2I = { ...this.m_Pos };
    pos.x += this.m_shapeBoundingBox.GetPosition().x * this.m_scalingFactor;
    pos.y += this.m_shapeBoundingBox.GetPosition().y * this.m_scalingFactor;

    return new BOX2I(pos, {
      x: bbox.GetSize().x * this.m_scalingFactor,
      y: bbox.GetSize().y * this.m_scalingFactor,
    });
  }

  protected abstract getColor(): Color4d;
}
