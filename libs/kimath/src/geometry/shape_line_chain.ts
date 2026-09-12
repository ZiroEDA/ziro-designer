// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_LINE_CHAIN` (`geometry/shape_line_chain.h`, `src/geometry/shape_line_chain.cpp`):
 * a polyline (or closed polygon) of points, some of which belong to arcs.
 *
 * `m_shapes[i]` is the pair of arc indices point `i` belongs to
 * (`SHAPES_ARE_PT` = `[-1, -1]` for a plain vertex; a shared point between
 * two arcs carries both). `m_arcs` holds the arcs themselves; the points of
 * an arc in `m_points` are its polyline approximation.
 */

import { ECOORD_MAX, EuclideanNormI, ResizeI, type Vec2, type VECTOR2I } from '../math/vector2.js';
import { INT_MAX } from '../math/util.js';
import { EDA_ANGLE } from './eda_angle.js';
import { FLIP_DIRECTION } from '../core/mirror.js';
import { BOX2I } from '../math/box2.js';
import { BOX2I_MINMAX } from '../math/box2_minmax.js';
import { RotatePoint, TestSegmentHit } from '../trigo.js';
import { CIRCLE } from './circle.js';
import { type OPT_VECTOR2I, SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_LINE_CHAIN_BASE, SHAPE_TYPE } from './shape.js';
// the base class dispatches through these; see SHAPE_HOOKS
import './shape_collisions.js';
import './shape_nearest_points.js';
import './shape_poly_set.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_POLY_SET } from './shape_poly_set.js';
import type { ERROR_LOC } from '../convert_basic_shapes_to_polygon.js';
import type { CornerStrategy } from './shape_poly_set_algorithms.js';
import type { Path64 } from '../clipper2/clipper.core.js';

/** `ssize_t`-indexed pair `( first, second )` of `m_shapes`. */
export type SHAPE_PAIR = [number, number];

/** A Clipper2 `Point64` that also carries KiCad's Z (an index into the Z-value buffer). */
export interface Point64Z {
  x: number;
  y: number;
  z: number;
}

/**
 * Holds information on each point of a SHAPE_LINE_CHAIN that is retrievable
 * after an operation with Clipper2Lib.
 */
export class CLIPPER_Z_VALUE {
  m_FirstArcIdx: number;
  m_SecondArcIdx: number;

  constructor(aShapeIndices?: SHAPE_PAIR, aOffset = 0) {
    if (aShapeIndices === undefined) {
      this.m_FirstArcIdx = -1;
      this.m_SecondArcIdx = -1;
      return;
    }

    this.m_FirstArcIdx = aShapeIndices[0];
    this.m_SecondArcIdx = aShapeIndices[1];

    const offsetVal = (aVal: number): number => (aVal >= 0 ? aVal + aOffset : aVal);

    this.m_FirstArcIdx = offsetVal(this.m_FirstArcIdx);
    this.m_SecondArcIdx = offsetVal(this.m_SecondArcIdx);
  }
}

/**
 * Represent an intersection between two line segments
 */
export class INTERSECTION {
  /// Point of intersection between our and their.
  p: VECTOR2I = { x: 0, y: 0 };

  /// Index of the intersecting corner/segment in the 'our' (== this) line.
  index_our = -1;

  /// index of the intersecting corner/segment in the 'their' (Intersect() method parameter) line.
  index_their = -1;

  /// When true, the corner [index_our] of the 'our' line lies exactly on 'their' line.
  is_corner_our = false;

  /// When true, the corner [index_their] of the 'their' line lies exactly on 'our' line.
  /// Note that when both is_corner_our and is_corner_their are set, the line chains touch
  /// with with corners.
  is_corner_their = false;

  /// Auxiliary flag to avoid copying intersection info to intersection refining code,
  /// used by the refining code (e.g. hull handling stuff in the P&S) to reject false
  /// intersection points.
  valid = false;
}

export type INTERSECTIONS = INTERSECTION[];

/** `getArcPolygonizationMaxError`. */
export function getArcPolygonizationMaxError(): number {
  // This polyline will only be used for display.  The native arc is still used for output.
  // We therefore want to use a higher definition than the typical maxError.
  return Math.trunc(SHAPE_ARC.DefaultAccuracyForPCB() / 5);
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const samePair = (a: SHAPE_PAIR, b: SHAPE_PAIR): boolean => a[0] === b[0] && a[1] === b[1];
const sqDist = (a: Vec2, b: Vec2): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const copyInto = (dst: VECTOR2I, src: Vec2): void => {
  dst.x = src.x;
  dst.y = src.y;
};

/** `alg::run_on_pair`. */
const runOnPair = (sh: SHAPE_PAIR, fn: (v: number) => number): void => {
  sh[0] = fn(sh[0]);
  sh[1] = fn(sh[1]);
};

/** `alg::pair_contains`. */
const pairContains = (sh: SHAPE_PAIR, v: number): boolean => sh[0] === v || sh[1] === v;

// Compact bounding-box record used inside SHAPE_LINE_CHAIN::Intersect.
interface SEG_EXTENT {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  segIdx: number;
}

export class SHAPE_LINE_CHAIN extends SHAPE_LINE_CHAIN_BASE {
  static readonly SHAPE_IS_PT = -1;
  static SHAPES_ARE_PT(): SHAPE_PAIR {
    return [SHAPE_LINE_CHAIN.SHAPE_IS_PT, SHAPE_LINE_CHAIN.SHAPE_IS_PT];
  }

  /// array of vertices
  private m_points: VECTOR2I[];

  /**
   * Array of indices that refer to the index of the shape if the point is part of a larger
   * shape, e.g. arc or spline.
   * If the value is -1, the point is just a point.
   *
   * There can be up to two shapes associated with a single point (e.g. the end point of
   * one arc might be the start point of another).
   *
   * Generally speaking only the first element of the pair will be populated (i.e. with a value
   * not equal to SHAPE_IS_PT), unless the point is shared between two arc shapes. If the point
   * is shared, then both the first and second element of the pair should be populated.
   *
   * The second element must always be SHAPE_IS_PT if the first element is SHAPE_IS_PT.
   */
  private m_shapes: SHAPE_PAIR[];

  private m_arcs: SHAPE_ARC[];

  // the maxError to use when converting arcs to points
  private m_accuracy: number;

  /// is the line chain closed?
  private m_closed: boolean;

  /// Width of the segments (for BBox calculations in RTREE and DRC)
  private m_width: number;

  /// cached bounding box
  private m_bbox: BOX2I;

  constructor();
  constructor(aShape: SHAPE_LINE_CHAIN);
  /** Initialize a 2D point list from a flat list of ints `x0 y0 x1 y1 ...`. */
  constructor(aV: number[]);
  constructor(aV: Vec2[], aClosed?: boolean);
  constructor(aArc: SHAPE_ARC, aClosed?: boolean, aMaxError?: number);
  constructor(
    aPath: Path64 | Point64Z[],
    aZValueBuffer: CLIPPER_Z_VALUE[],
    aArcBuffer: SHAPE_ARC[],
  );
  constructor(
    a?: SHAPE_LINE_CHAIN | number[] | Vec2[] | SHAPE_ARC | Path64 | Point64Z[],
    b?: boolean | CLIPPER_Z_VALUE[],
    c?: number | SHAPE_ARC[],
  ) {
    super(SHAPE_TYPE.SH_LINE_CHAIN);
    this.m_points = [];
    this.m_shapes = [];
    this.m_arcs = [];
    this.m_accuracy = 0;
    this.m_closed = false;
    this.m_width = 0;
    this.m_bbox = new BOX2I();

    if (a === undefined) return;

    if (a instanceof SHAPE_LINE_CHAIN) {
      this.m_points = a.m_points.map((p) => ({ x: p.x, y: p.y }));
      this.m_shapes = a.m_shapes.map((s) => [s[0], s[1]]);
      this.m_arcs = a.m_arcs.map((arc) => new SHAPE_ARC(arc));
      this.m_accuracy = a.m_accuracy;
      this.m_closed = a.m_closed;
      this.m_width = a.m_width;
      this.m_bbox = a.m_bbox.Clone();
      return;
    }

    if (a instanceof SHAPE_ARC) {
      this.m_width = a.GetWidth();

      if (c !== undefined) this.Append(a, c as number);
      else this.Append(a);

      this.SetClosed((b as boolean | undefined) ?? false);
      return;
    }

    if (Array.isArray(b)) {
      // SHAPE_LINE_CHAIN( const Clipper2Lib::Path64&, aZValueBuffer, aArcBuffer )
      this.constructFromClipper(a as Point64Z[], b, c as SHAPE_ARC[]);
      return;
    }

    if (a.length > 0 && typeof a[0] === 'number') {
      const aV = a as number[];

      for (let i = 0; i < aV.length; i += 2) {
        this.Append(aV[i]!, aV[i + 1]!);
      }

      return;
    }

    const aV = a as Vec2[];
    this.m_points = aV.map((p) => ({ x: p.x, y: p.y }));
    this.m_shapes = aV.map(() => SHAPE_LINE_CHAIN.SHAPES_ARE_PT());
    this.SetClosed((b as boolean | undefined) ?? false);
  }

  private constructFromClipper(
    aPath: Point64Z[],
    aZValueBuffer: CLIPPER_Z_VALUE[],
    aArcBuffer: SHAPE_ARC[],
  ): void {
    this.m_closed = true;

    const loadedArcs = new Map<number, number>();

    const loadArc = (aArcIndex: number): number => {
      if (aArcIndex === SHAPE_LINE_CHAIN.SHAPE_IS_PT) {
        return SHAPE_LINE_CHAIN.SHAPE_IS_PT;
      } else if (!loadedArcs.has(aArcIndex)) {
        loadedArcs.set(aArcIndex, this.m_arcs.length);
        this.m_arcs.push(new SHAPE_ARC(aArcBuffer[aArcIndex]!));
      }

      return loadedArcs.get(aArcIndex)!;
    };

    for (let ii = 0; ii < aPath.length; ++ii) {
      const pt = aPath[ii]!;
      this.Append(pt.x, pt.y);

      // Add arc info (if exists)
      const idx_z = pt.z ?? -1;

      if (idx_z < 0 || idx_z >= aZValueBuffer.length) continue;

      this.m_shapes[ii]![0] = loadArc(aZValueBuffer[idx_z]!.m_FirstArcIdx);
      this.m_shapes[ii]![1] = loadArc(aZValueBuffer[idx_z]!.m_SecondArcIdx);
    }

    // Clipper shouldn't return duplicate contiguous points. if it did, these would be
    // removed during Append() and we would have different number of shapes to points
    // wxASSERT( m_shapes.size() == m_points.size() );

    // Clipper might mess up the rotation of the indices such that an arc can be split between
    // the end point and wrap around to the start point. Lets fix the indices up now
    this.fixIndicesRotation();
  }

  /**
   * Create a Clipper2 path, with the arc data recorded in the Z-value buffer
   * and the arcs themselves appended to `aArcBuffer`.
   */
  convertToClipper2(
    aRequiredOrientation: boolean,
    aZValueBuffer: CLIPPER_Z_VALUE[],
    aArcBuffer: SHAPE_ARC[],
  ): Point64Z[] {
    const c_path: Point64Z[] = [];
    let input: SHAPE_LINE_CHAIN;
    const orientation = this.Area(false) >= 0;
    const shape_offset = aArcBuffer.length;

    if (orientation !== aRequiredOrientation) input = this.Reverse();
    else input = this;

    const pointCount = input.PointCount();

    for (let i = 0; i < pointCount; i++) {
      const vertex = input.CPoint(i);
      const z_value = new CLIPPER_Z_VALUE(input.m_shapes[i]!, shape_offset);
      const z_value_ptr = aZValueBuffer.length;
      aZValueBuffer.push(z_value);

      c_path.push({ x: vertex.x, y: vertex.y, z: z_value_ptr });
    }

    for (const arc of input.m_arcs) aArcBuffer.push(new SHAPE_ARC(arc));

    return c_path;
  }

  /**
   * Fix indices of this chain to ensure arcs are not split between the end and start indices
   */
  private fixIndicesRotation(): void {
    if (this.m_shapes.length !== this.m_points.length) return; // wxCHECK

    if (this.m_shapes.length <= 1) return;

    let rotations = 0;

    while (this.ArcIndex(0) !== SHAPE_LINE_CHAIN.SHAPE_IS_PT && !this.IsArcStart(0)) {
      // Rotate right
      this.m_points.unshift(this.m_points.pop()!);
      this.m_shapes.unshift(this.m_shapes.pop()!);

      // Sanity check - avoid infinite loops  (NB: wxCHECK is not thread-safe)
      if (rotations++ > this.m_shapes.length) return;
    }
  }

  /**
   * Merge the first and last point if they are the same and this chain is closed
   */
  private mergeFirstLastPointIfNeeded(): void {
    if (this.m_closed) {
      if (
        this.m_points.length > 1 &&
        samePoint(this.m_points[0]!, this.m_points[this.m_points.length - 1]!)
      ) {
        if (this.ArcIndex(this.m_shapes.length - 1) !== SHAPE_LINE_CHAIN.SHAPE_IS_PT) {
          this.m_shapes[0]![1] = this.m_shapes[0]![0];
          this.m_shapes[0]![0] = this.ArcIndex(this.m_shapes.length - 1);
        }

        this.m_points.pop();
        this.m_shapes.pop();

        this.fixIndicesRotation();
      }
    } else {
      if (this.m_points.length > 1 && this.IsSharedPt(0)) {
        // Create a duplicate point at the end
        this.m_points.push({ x: this.m_points[0]!.x, y: this.m_points[0]!.y });
        this.m_shapes.push([this.m_shapes[0]![0], SHAPE_LINE_CHAIN.SHAPE_IS_PT]);
        this.m_shapes[0]![0] = this.m_shapes[0]![1];
        this.m_shapes[0]![1] = SHAPE_LINE_CHAIN.SHAPE_IS_PT;
      }
    }
  }

  /**
   * Convert an arc to only a point chain by removing the arc and references
   *
   * @param aArcIndex index of the arc to convert to points
   */
  private convertArc(aArcIndex: number): void {
    if (aArcIndex < 0) aArcIndex += this.m_arcs.length;

    if (aArcIndex >= this.m_arcs.length) return;

    // Clear the shapes references
    for (const sh of this.m_shapes) {
      runOnPair(sh, (aShapeIndex) => {
        if (aShapeIndex === aArcIndex) aShapeIndex = SHAPE_LINE_CHAIN.SHAPE_IS_PT;

        if (aShapeIndex > aArcIndex) --aShapeIndex;

        return aShapeIndex;
      });

      if (sh[1] !== SHAPE_LINE_CHAIN.SHAPE_IS_PT && sh[0] === SHAPE_LINE_CHAIN.SHAPE_IS_PT) {
        const t = sh[0];
        sh[0] = sh[1];
        sh[1] = t;
      }
    }

    this.m_arcs.splice(aArcIndex, 1);
  }

  /**
   * Splits an arc into two arcs at aPtIndex. Parameter \p aCoincident controls whether the two
   * arcs are to be coincident at aPtIndex or whether a short straight segment should be created
   * instead
   *
   * @param aPtIndex index of the point in the chain in which to split the arc
   * @param aCoincident If true, the end point of the first arc will be coincident with the start
   *                    point of the second arc at aPtIndex.
   *                    If false, the end point of the first arc will be at aPtIndex-1 and the
   *                    start point of the second arc will be at aPtIndex, resulting in a short
   *                    straight line segment between aPtIndex-1 and aPtIndex.
   */
  private splitArc(aPtIndex: number, aCoincident = false): void {
    if (aPtIndex < 0) aPtIndex += this.m_shapes.length;

    if (!this.IsSharedPt(aPtIndex) && this.IsArcStart(aPtIndex)) return; // Nothing to do

    if (!this.IsPtOnArc(aPtIndex)) return; // Nothing to do

    if (aPtIndex >= this.m_shapes.length) return; // wxCHECK_MSG( "Invalid point index requested." )

    if (this.IsSharedPt(aPtIndex) || this.IsArcEnd(aPtIndex)) {
      if (aCoincident || aPtIndex === 0) return; // nothing to do

      const firstArcIndex = this.m_shapes[aPtIndex]![0];

      const newStart = this.m_arcs[firstArcIndex]!.GetP0(); // don't amend the start
      const newEnd = this.m_points[aPtIndex - 1]!;
      this.amendArc(firstArcIndex, newStart, newEnd);

      if (this.IsSharedPt(aPtIndex)) {
        this.m_shapes[aPtIndex]![0] = this.m_shapes[aPtIndex]![1];
        this.m_shapes[aPtIndex]![1] = SHAPE_LINE_CHAIN.SHAPE_IS_PT;
      } else {
        this.m_shapes[aPtIndex] = SHAPE_LINE_CHAIN.SHAPES_ARE_PT();
      }

      return;
    }

    const currArcIdx = this.ArcIndex(aPtIndex);
    const currentArc = this.m_arcs[currArcIdx]!;

    const newArc1 = new SHAPE_ARC();
    const newArc2 = new SHAPE_ARC();

    const arc1End = aCoincident ? this.m_points[aPtIndex]! : this.m_points[aPtIndex - 1]!;
    const arc2Start = this.m_points[aPtIndex]!;

    newArc1.ConstructFromStartEndCenter(
      currentArc.GetP0(),
      arc1End,
      currentArc.GetCenter(),
      currentArc.IsClockwise(),
    );

    newArc2.ConstructFromStartEndCenter(
      arc2Start,
      currentArc.GetP1(),
      currentArc.GetCenter(),
      currentArc.IsClockwise(),
    );

    if (!aCoincident && this.ArcIndex(aPtIndex - 1) !== currArcIdx) {
      //Ignore newArc1 as it has zero points
      this.m_arcs[currArcIdx] = newArc2;
    } else {
      this.m_arcs[currArcIdx] = newArc1;
      this.m_arcs.splice(currArcIdx + 1, 0, newArc2);

      if (aCoincident) {
        this.m_shapes[aPtIndex]![1] = currArcIdx + 1;
        aPtIndex++;
      }

      // Only change the arc indices for the second half of the point range
      for (let i = aPtIndex; i < this.PointCount(); i++) {
        runOnPair(this.m_shapes[i]!, (aIndex) =>
          aIndex !== SHAPE_LINE_CHAIN.SHAPE_IS_PT ? aIndex + 1 : aIndex,
        );
      }
    }
  }

  private amendArc(aArcIndex: number, aNewStart: Vec2, aNewEnd: Vec2): void {
    if (aArcIndex >= this.m_arcs.length) return; // wxCHECK_MSG( "Invalid arc index requested." )

    const theArc = this.m_arcs[aArcIndex]!;

    // Try to preseve the centre of the original arc
    const newArc = new SHAPE_ARC();
    newArc.ConstructFromStartEndCenter(
      aNewStart,
      aNewEnd,
      theArc.GetCenter(),
      theArc.IsClockwise(),
    );

    this.m_arcs[aArcIndex] = newArc;
  }

  private amendArcStart(aArcIndex: number, aNewStart: Vec2): void {
    this.amendArc(aArcIndex, aNewStart, this.m_arcs[aArcIndex]!.GetP1());
  }

  private amendArcEnd(aArcIndex: number, aNewEnd: Vec2): void {
    this.amendArc(aArcIndex, this.m_arcs[aArcIndex]!.GetP0(), aNewEnd);
  }

  /**
   * Return the arc index for the given segment index, looking backwards
   */
  private reversedArcIndex(aSegment: number): number {
    if (this.IsSharedPt(aSegment)) return this.m_shapes[aSegment]![0];
    return this.m_shapes[aSegment]![1];
  }

  override CollidePoint(aP: Vec2, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    if (this.IsClosed() && this.PointInside(aP, aClearance)) {
      if (aLocation) copyInto(aLocation, aP);

      if (aActual) aActual.value = 0;

      return true;
    }

    let closest_dist_sq = ECOORD_MAX;
    const clearance_sq = aClearance * aClearance;
    let nearest: VECTOR2I = { x: 0, y: 0 };

    // Collide line segments
    for (let i = 0; i < this.GetSegmentCount(); i++) {
      if (this.IsArcSegment(i)) continue;

      const s = this.GetSegment(i);
      const pn = s.NearestPoint(aP);
      const dist_sq = sqDist(pn, aP);

      if (dist_sq < closest_dist_sq) {
        nearest = pn;
        closest_dist_sq = dist_sq;

        if (closest_dist_sq === 0) break;

        // If we're not looking for aActual then any collision will do
        if (closest_dist_sq < clearance_sq && !aActual) break;
      }
    }

    if (closest_dist_sq === 0 || closest_dist_sq < clearance_sq) {
      if (aLocation) copyInto(aLocation, nearest);

      if (aActual) aActual.value = Math.trunc(Math.sqrt(closest_dist_sq));

      return true;
    }

    // Collide arc segments
    for (let i = 0; i < this.ArcCount(); i++) {
      const arc = this.Arc(i);

      // The arcs in the chain should have zero width
      // wxASSERT_MSG( arc.GetWidth() == 0, wxT( "Invalid arc width - should be zero" ) );

      if (arc.CollidePoint(aP, aClearance, aActual, aLocation)) return true;
    }

    return false;
  }

  override CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    if (this.IsClosed() && this.PointInside(aSeg.A)) {
      if (aLocation) copyInto(aLocation, aSeg.A);

      if (aActual) aActual.value = 0;

      return true;
    }

    let closest_dist_sq = ECOORD_MAX;
    const clearance_sq = aClearance * aClearance;
    let nearest: VECTOR2I = { x: 0, y: 0 };

    // Collide line segments
    for (let i = 0; i < this.GetSegmentCount(); i++) {
      if (this.IsArcSegment(i)) continue;

      const s = this.GetSegment(i);
      const dist_sq = s.SquaredDistance(aSeg);

      if (dist_sq < closest_dist_sq) {
        if (aLocation) nearest = s.NearestPoint(aSeg);

        closest_dist_sq = dist_sq;

        if (closest_dist_sq === 0) break;

        // If we're not looking for aActual then any collision will do
        if (closest_dist_sq < clearance_sq && !aActual) break;
      }
    }

    if (closest_dist_sq === 0 || closest_dist_sq < clearance_sq) {
      if (aLocation) copyInto(aLocation, nearest);

      if (aActual) aActual.value = Math.trunc(Math.sqrt(closest_dist_sq));

      return true;
    }

    const dist = { value: INT_MAX };
    let closest_dist = Math.trunc(Math.sqrt(closest_dist_sq));

    // Collide arc segments
    for (let i = 0; i < this.ArcCount(); i++) {
      const arc = this.Arc(i);
      const pos: VECTOR2I = { x: 0, y: 0 };

      // The arcs in the chain should have zero width
      // wxASSERT_MSG( arc.GetWidth() == 0, wxT( "Invalid arc width - should be zero" ) );

      if (
        arc.CollideSeg(
          aSeg,
          aClearance,
          aActual || aLocation ? dist : undefined,
          aLocation ? pos : undefined,
        )
      ) {
        if (!aActual) return true;

        if (dist.value < closest_dist) {
          closest_dist = dist.value;
          nearest = pos;
        }
      }
    }

    if (closest_dist === 0 || closest_dist < aClearance) {
      if (aLocation) copyInto(aLocation, nearest);

      if (aActual) aActual.value = closest_dist;

      return true;
    }

    return false;
  }

  /**
   * Finds closest points between this and the other line chain. Doesn't test segments or arcs.
   */
  ClosestPoints(aOther: SHAPE_LINE_CHAIN, aPt0: VECTOR2I, aPt1: VECTOR2I): boolean {
    const dist_sq = { value: 0 };
    return SHAPE_LINE_CHAIN.ClosestPointsRange(
      this.m_points,
      0,
      this.m_points.length,
      aOther.m_points,
      0,
      aOther.m_points.length,
      aPt0,
      aPt1,
      dist_sq,
    );
  }

  /** `ClosestPoints( aMyStart, aMyEnd, aOtherStart, aOtherEnd, ... )`: over two index ranges. */
  static ClosestPointsRange(
    aMy: readonly VECTOR2I[],
    aMyStart: number,
    aMyEnd: number,
    aOther: readonly VECTOR2I[],
    aOtherStart: number,
    aOtherEnd: number,
    aPt0: VECTOR2I,
    aPt1: VECTOR2I,
    aDistSq: OutInt,
  ): boolean {
    let closest_dist_sq = ECOORD_MAX;

    for (let itA = aMyStart; itA !== aMyEnd; itA++) {
      const ptA = aMy[itA]!;

      for (let itB = aOtherStart; itB !== aOtherEnd; itB++) {
        const ptB = aOther[itB]!;

        const dx = ptB.x - ptA.x;
        const dy = ptB.y - ptA.y;
        const dist_sq = dx * dx + dy * dy;

        if (dist_sq < closest_dist_sq) {
          closest_dist_sq = dist_sq;
          copyInto(aPt0, ptA);
          copyInto(aPt1, ptB);
        }
      }
    }

    aDistSq.value = closest_dist_sq;
    return closest_dist_sq !== ECOORD_MAX;
  }

  /** `ClosestSegments`: over two index ranges, with the previous point of each range. */
  static ClosestSegments(
    aMyPrevPt: VECTOR2I,
    aMy: readonly VECTOR2I[],
    aMyStart: number,
    aMyEnd: number,
    aOtherPrevPt: VECTOR2I,
    aOther: readonly VECTOR2I[],
    aOtherStart: number,
    aOtherEnd: number,
    aPt0: VECTOR2I,
    aPt1: VECTOR2I,
    aDistSq: OutInt,
  ): boolean {
    if (aMyStart === aMyEnd) return false;

    if (aOtherStart === aOtherEnd) return false;

    let closest_dist_sq = ECOORD_MAX;
    let lastPtA = aMyPrevPt;

    for (let itA = aMyStart; itA !== aMyEnd; itA++) {
      const ptA = aMy[itA]!;
      let lastPtB = aOtherPrevPt;

      for (let itB = aOtherStart; itB !== aOtherEnd; itB++) {
        const ptB = aOther[itB]!;

        const segA = new SEG(lastPtA, ptA);
        const segB = new SEG(lastPtB, ptB);

        const nearestA: VECTOR2I = { x: 0, y: 0 };
        const nearestB: VECTOR2I = { x: 0, y: 0 };
        const dist_sq = { value: 0 };

        if (segA.NearestPoints(segB, nearestA, nearestB, dist_sq)) {
          if (dist_sq.value < closest_dist_sq) {
            closest_dist_sq = dist_sq.value;
            copyInto(aPt0, nearestA);
            copyInto(aPt1, nearestB);
          }
        }

        lastPtB = ptB;
      }

      lastPtA = ptA;
    }

    aDistSq.value = closest_dist_sq;
    return closest_dist_sq !== ECOORD_MAX;
  }

  /**
   * Finds closest points between segments of this and the other line chain. Doesn't guarantee
   * that the points are the absolute closest points, but tries to find a good candidate quickly.
   */
  ClosestSegmentsFast(aOther: SHAPE_LINE_CHAIN, aPt0: VECTOR2I, aPt1: VECTOR2I): boolean {
    const myPts = this.m_points;
    const otherPts = aOther.m_points;

    const c_maxBoxes = 100;
    const c_minPtsPerBox = 20;

    const myPointsPerBox = Math.max(c_minPtsPerBox, Math.trunc(myPts.length / c_maxBoxes) + 1);
    const otherPointsPerBox = Math.max(
      c_minPtsPerBox,
      Math.trunc(otherPts.length / c_maxBoxes) + 1,
    );

    const myNumBoxes = Math.trunc((myPts.length + myPointsPerBox - 1) / myPointsPerBox);
    const otherNumBoxes = Math.trunc((otherPts.length + otherPointsPerBox - 1) / otherPointsPerBox);

    interface BOX {
      bbox: BOX2I_MINMAX;
      center: VECTOR2I;
      radius: number;
      valid: boolean;
    }

    const newBox = (): BOX => ({
      bbox: new BOX2I_MINMAX(),
      center: { x: 0, y: 0 },
      radius: 0,
      valid: false,
    });

    const myBoxes: BOX[] = Array.from({ length: myNumBoxes }, newBox);
    const otherBoxes: BOX[] = Array.from({ length: otherNumBoxes }, newBox);

    // Calculate bounding boxes
    for (let i = 0; i < myPts.length; i++) {
      const pt = myPts[i]!;
      const box = myBoxes[Math.trunc(i / myPointsPerBox)]!;

      if (box.valid) {
        box.bbox.Merge(pt);
      } else {
        box.bbox = new BOX2I_MINMAX(pt);
        box.valid = true;
      }
    }

    for (let i = 0; i < otherPts.length; i++) {
      const pt = otherPts[i]!;
      const box = otherBoxes[Math.trunc(i / otherPointsPerBox)]!;

      if (box.valid) {
        box.bbox.Merge(pt);
      } else {
        box.bbox = new BOX2I_MINMAX(pt);
        box.valid = true;
      }
    }

    // Store centers and radiuses
    for (const box of myBoxes) {
      box.center = box.bbox.GetCenter();
      box.radius = Math.trunc(box.bbox.GetDiameter() / 2);
    }

    for (const box of otherBoxes) {
      box.center = box.bbox.GetCenter();
      box.radius = Math.trunc(box.bbox.GetDiameter() / 2);
    }

    // Find closest pairs
    interface DIST_PAIR {
      dist: number;
      idA: number;
      idB: number;
    }

    const pairsToTest: DIST_PAIR[] = [];

    for (let ia = 0; ia < myBoxes.length; ia++) {
      for (let ib = 0; ib < otherBoxes.length; ib++) {
        const ca = myBoxes[ia]!;
        const cb = otherBoxes[ib]!;

        if (!ca.valid || !cb.valid) continue;

        let dist = EuclideanNormI({ x: cb.center.x - ca.center.x, y: cb.center.y - ca.center.y });
        dist -= ca.radius;
        dist -= cb.radius;

        pairsToTest.push({ dist, idA: ia, idB: ib });
      }
    }

    pairsToTest.sort((a, b) => a.dist - b.dist);

    const c_polyPairsLimit = 5;

    // Find closest segments in tested pairs
    let total_closest_dist_sq = ECOORD_MAX;

    for (let pairId = 0; pairId < pairsToTest.length && pairId < c_polyPairsLimit; pairId++) {
      const pair = pairsToTest[pairId]!;

      const ptA: VECTOR2I = { x: 0, y: 0 };
      const ptB: VECTOR2I = { x: 0, y: 0 };
      const dist_sq = { value: 0 };

      const myStartId = pair.idA * myPointsPerBox;
      let myEndId = myStartId + myPointsPerBox;

      if (myEndId > myPts.length) myEndId = myPts.length;

      const myPrevPt = myPts[myStartId === 0 ? myPts.length - 1 : myStartId - 1]!;

      const otherStartId = pair.idB * otherPointsPerBox;
      let otherEndId = otherStartId + otherPointsPerBox;

      if (otherEndId > otherPts.length) otherEndId = otherPts.length;

      const otherPrevPt = otherPts[otherStartId === 0 ? otherPts.length - 1 : otherStartId - 1]!;

      if (
        SHAPE_LINE_CHAIN.ClosestSegments(
          myPrevPt,
          myPts,
          myStartId,
          myEndId,
          otherPrevPt,
          otherPts,
          otherStartId,
          otherEndId,
          ptA,
          ptB,
          dist_sq,
        )
      ) {
        if (dist_sq.value < total_closest_dist_sq) {
          total_closest_dist_sq = dist_sq.value;
          copyInto(aPt0, ptA);
          copyInto(aPt1, ptB);
        }
      }
    }

    return total_closest_dist_sq !== ECOORD_MAX;
  }

  /** `operator=`. */
  assign(aOther: SHAPE_LINE_CHAIN): this {
    this.m_points = aOther.m_points.map((p) => ({ x: p.x, y: p.y }));
    this.m_shapes = aOther.m_shapes.map((s) => [s[0], s[1]]);
    this.m_arcs = aOther.m_arcs.map((arc) => new SHAPE_ARC(arc));
    this.m_accuracy = aOther.m_accuracy;
    this.m_closed = aOther.m_closed;
    this.m_width = aOther.m_width;
    this.m_bbox = aOther.m_bbox.Clone();
    return this;
  }

  override Clone(): SHAPE {
    return new SHAPE_LINE_CHAIN(this);
  }

  /**
   * Remove all points from the line chain.
   */
  Clear(): void {
    this.m_points = [];
    this.m_arcs = [];
    this.m_shapes = [];
    this.m_closed = false;
  }

  /**
   * Mark the line chain as closed (i.e. with a segment connecting the last point with
   * the first point).
   */
  SetClosed(aClosed: boolean): void {
    this.m_closed = aClosed;
    this.mergeFirstLastPointIfNeeded();
  }

  IsClosed(): boolean {
    return this.m_closed;
  }

  /**
   * Set the width of all segments in the chain.
   */
  override SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }

  /**
   * Get the current width of the segments in the chain.
   */
  Width(): number {
    return this.m_width;
  }

  /**
   * Return the number of segments in this line chain.
   */
  SegmentCount(): number {
    let c = this.m_points.length - 1;

    if (this.m_closed) c++;

    return Math.max(0, c);
  }

  /**
   * Return the number of shapes (line segments or arcs) in this line chain.
   */
  ShapeCount(): number {
    if (this.m_points.length !== this.m_shapes.length) return 0; // wxCHECK2_MSG( "Invalid chain!" )

    if (this.m_points.length < 2) return 0;

    let numShapes = 1;

    for (let i = this.NextShape(0); i !== -1; i = this.NextShape(i)) numShapes++;

    return numShapes;
  }

  /**
   * Remove the duplicate points from the line chain.
   */
  RemoveDuplicatePoints(): void {
    const pts_unique: VECTOR2I[] = [];
    const shapes_unique: SHAPE_PAIR[] = [];

    // Always try to keep at least 2 points otherwise, we're not really a line
    if (this.PointCount() < 3) {
      return;
    } else if (this.PointCount() === 3) {
      if (samePoint(this.m_points[0]!, this.m_points[1]!)) this.Remove(1);

      return;
    }

    let i = 0;

    while (i < this.PointCount()) {
      let j = i + 1;

      // We can eliminate duplicate vertices as long as they are part of the same shape, OR if
      // one of them is part of a shape and one is not.
      while (
        j < this.PointCount() &&
        samePoint(this.m_points[i]!, this.m_points[j]!) &&
        (samePair(this.m_shapes[i]!, this.m_shapes[j]!) ||
          samePair(this.m_shapes[i]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()) ||
          samePair(this.m_shapes[j]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()))
      ) {
        j++;
      }

      let shapeToKeep = this.m_shapes[i]!;

      if (samePair(shapeToKeep, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()))
        shapeToKeep = this.m_shapes[j - 1]!;

      pts_unique.push(this.CPoint(i));
      shapes_unique.push(shapeToKeep);

      i = j;
    }

    this.m_points = [];
    this.m_shapes = [];

    for (let ii = 0; ii < pts_unique.length; ++ii) {
      const p0 = pts_unique[ii]!;

      this.m_points.push(p0);
      this.m_shapes.push(shapes_unique[ii]!);
    }
  }

  /**
   * Simplify the line chain by removing colinear adjacent segments and duplicate vertices.
   *
   * @param aTolerance is the maximum tolerance in internal units.  Setting to 0 will
   * only remove duplicate points.
   */
  Simplify(aTolerance = 0): void {
    if (this.PointCount() < 3) return;

    const new_points: VECTOR2I[] = [];
    const new_shapes: SHAPE_PAIR[] = [];
    const n = this.m_points.length;

    for (let start_idx = 0; start_idx < n; ) {
      new_points.push(this.m_points[start_idx]!);
      new_shapes.push(this.m_shapes[start_idx]!);

      // If the line is not closed, we need at least 3 points before simplifying
      if (!this.m_closed && start_idx === n - 2) break;

      // Initialize the end index to be two points ahead of start
      let end_idx = (start_idx + 2) % n;
      let can_simplify = true;

      while (can_simplify && end_idx !== start_idx && (end_idx > start_idx || this.m_closed)) {
        // Test all points between start_idx and end_idx
        for (
          let test_idx = (start_idx + 1) % n;
          test_idx !== end_idx;
          test_idx = (test_idx + 1) % n
        ) {
          // Check if all points are regular points (not arcs)
          if (
            this.m_shapes[start_idx]![0] !== SHAPE_LINE_CHAIN.SHAPE_IS_PT ||
            this.m_shapes[test_idx]![0] !== SHAPE_LINE_CHAIN.SHAPE_IS_PT ||
            this.m_shapes[end_idx]![0] !== SHAPE_LINE_CHAIN.SHAPE_IS_PT
          ) {
            can_simplify = false;
            break;
          }

          // Test if the point is within the allowed error
          if (
            !TestSegmentHit(
              this.m_points[test_idx]!,
              this.m_points[start_idx]!,
              this.m_points[end_idx]!,
              aTolerance,
            )
          ) {
            can_simplify = false;
            break;
          }
        }

        if (can_simplify) {
          // If we can simplify, move end_idx one further
          end_idx = (end_idx + 1) % n;
        }
      }

      // If we couldn't simplify at all, move to the next point
      if (end_idx === (start_idx + 2) % n) {
        ++start_idx;
      } else {
        // Otherwise, jump to the last point we could include in the simplification
        const new_start_idx = (end_idx + n - 1) % n;

        // If we looped all the way around, we're done
        if (new_start_idx <= start_idx) break;

        start_idx = new_start_idx;
      }
    }

    // If we have only one point, we need to add a second point to make a line
    if (new_points.length === 1) {
      new_points.push(this.m_points[n - 1]!);
      new_shapes.push(this.m_shapes[n - 1]!);
    }

    // If we are not closed, then the start and end points of the original line need to
    // be the start and end points of the new line.
    if (!this.m_closed && !samePoint(this.m_points[n - 1]!, new_points[new_points.length - 1]!)) {
      new_points.push(this.m_points[n - 1]!);
      new_shapes.push(this.m_shapes[n - 1]!);
    }

    this.m_points = new_points;
    this.m_shapes = new_shapes;
  }

  // legacy function, used by the router. Please do not remove until I'll figure out
  // the root cause of rounding errors - Tom
  Simplify2(aRemoveColinear = true): this {
    const pts_unique: VECTOR2I[] = [];
    const shapes_unique: SHAPE_PAIR[] = [];

    // Always try to keep at least 2 points otherwise, we're not really a line
    if (this.PointCount() < 3) {
      return this;
    } else if (this.PointCount() === 3) {
      if (samePoint(this.m_points[0]!, this.m_points[1]!)) this.Remove(1);

      return this;
    }

    let i = 0;
    let np = this.PointCount();

    // stage 1: eliminate duplicate vertices
    while (i < np) {
      let j = i + 1;

      // We can eliminate duplicate vertices as long as they are part of the same shape, OR if
      // one of them is part of a shape and one is not.
      while (
        j < np &&
        samePoint(this.m_points[i]!, this.m_points[j]!) &&
        (samePair(this.m_shapes[i]!, this.m_shapes[j]!) ||
          samePair(this.m_shapes[i]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()) ||
          samePair(this.m_shapes[j]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()))
      ) {
        j++;
      }

      let shapeToKeep = this.m_shapes[i]!;

      if (samePair(shapeToKeep, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()))
        shapeToKeep = this.m_shapes[j - 1]!;

      pts_unique.push(this.CPoint(i));
      shapes_unique.push(shapeToKeep);

      i = j;
    }

    this.m_points = [];
    this.m_shapes = [];
    np = pts_unique.length;

    i = 0;

    // stage 2: eliminate colinear segments
    while (i < np - 2) {
      const p0 = pts_unique[i]!;
      let n = i;

      if (
        aRemoveColinear &&
        samePair(shapes_unique[i]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()) &&
        samePair(shapes_unique[i + 1]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT())
      ) {
        while (
          n < np - 2 &&
          (new SEG(p0, pts_unique[n + 2]!).LineDistance(pts_unique[n + 1]!) <= 1 ||
            new SEG(p0, pts_unique[n + 2]!).Collinear(new SEG(p0, pts_unique[n + 1]!)))
        )
          n++;
      }

      this.m_points.push(p0);
      this.m_shapes.push(shapes_unique[i]!);

      if (n > i) i = n;

      if (n === np - 2) {
        this.m_points.push(pts_unique[np - 1]!);
        this.m_shapes.push(shapes_unique[np - 1]!);
        return this;
      }

      i++;
    }

    if (np > 1) {
      this.m_points.push(pts_unique[np - 2]!);
      this.m_shapes.push(shapes_unique[np - 2]!);
    }

    this.m_points.push(pts_unique[np - 1]!);
    this.m_shapes.push(shapes_unique[np - 1]!);

    return this;
  }

  /**
   * Return the number of points (vertices) in this line chain.
   */
  PointCount(): number {
    return this.m_points.length;
  }

  /**
   * Return a copy of the aIndex-th segment in the line chain.
   *
   * @param aIndex is the index of the segment in the line chain. Negative values are counted
   *               from the end (i.e. -1 means the last segment in the line chain).
   * @return a segment at the \a aIndex in the line chain.
   */
  Segment(aIndex: number): SEG {
    const segCount = this.SegmentCount();

    if (aIndex < 0) aIndex += segCount;

    if (!(aIndex < segCount && aIndex >= 0)) {
      // wxCHECK
      const last = this.m_points[this.m_points.length - 1];
      return last ? new SEG(last, last) : new SEG(0, 0, 0, 0);
    }

    if (aIndex === this.m_points.length - 1 && this.m_closed)
      return new SEG(this.m_points[aIndex]!, this.m_points[0]!, aIndex);
    return new SEG(this.m_points[aIndex]!, this.m_points[aIndex + 1]!, aIndex);
  }

  /**
   * Return a constant copy of the \a aIndex segment in the line chain.
   */
  CSegment(aIndex: number): SEG {
    return this.Segment(aIndex);
  }

  /**
   * Return the vertex index of the next shape in the chain, or -1 if \a aPointIndex is the
   * last shape.
   *
   * If \a aPointIndex is the start of a segment, this will be ( aPointIndex + 1 ).  If
   * \a aPointIndex is the start of an arc, this will be the index of the start of the next
   * shape after the arc, in other words, the last point of the arc.
   *
   * @param aPointIndex is a vertex in the chain.
   * @return the vertex index of the start of the next shape after aPointIndex's shape or -1
   *         if the end was reached.
   */
  NextShape(aPointIndex: number): number {
    if (aPointIndex < 0) aPointIndex += this.PointCount();

    if (aPointIndex < 0) return -1;

    const lastIndex = this.PointCount() - 1;

    // Last point?
    if (aPointIndex >= lastIndex) return -1; // we don't want to wrap around

    if (samePair(this.m_shapes[aPointIndex]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT())) {
      if (aPointIndex === lastIndex - 1) {
        if (this.m_closed) return lastIndex;
        return -1;
      }

      return aPointIndex + 1;
    }

    const arcStart = aPointIndex;

    // The second element should only get populated when the point is shared between two shapes.
    // If not a shared point, then the index should always go on the first element.
    if (this.m_shapes[aPointIndex]![0] === SHAPE_LINE_CHAIN.SHAPE_IS_PT) return -1; // wxCHECK2_MSG( "malformed chain!" )

    const currentArcIdx = this.ArcIndex(aPointIndex);

    // Now skip the rest of the arc
    while (aPointIndex < lastIndex && this.ArcIndex(aPointIndex) === currentArcIdx)
      aPointIndex += 1;

    const indexStillOnArc = pairContains(this.m_shapes[aPointIndex]!, currentArcIdx);

    // We want the last vertex of the arc if the initial point was the start of one
    // Well-formed arcs should generate more than one point to travel above
    if (aPointIndex - arcStart > 1 && !indexStillOnArc) aPointIndex -= 1;

    if (aPointIndex === lastIndex) {
      if (!this.m_closed || this.IsArcSegment(aPointIndex)) return -1; //no shape
      return lastIndex; // Segment between last point and the start of the chain
    }

    return aPointIndex;
  }

  /**
   * Move a point to a specific location.
   *
   * @param aIndex is the index of the point to move.  Negative indices are counted from the end.
   * @param aPos is the new position of the point.
   */
  SetPoint(aIndex: number, aPos: Vec2): void {
    if (aIndex < 0) aIndex += this.PointCount();
    else if (aIndex >= this.PointCount()) aIndex -= this.PointCount();

    this.m_points[aIndex] = { x: aPos.x, y: aPos.y };

    // convertArc mutates m_shapes; run on a copy of the pair as the C++ ref would read it
    const sh = this.m_shapes[aIndex]!;
    for (const aIdx of [sh[0], sh[1]]) {
      if (aIdx !== SHAPE_LINE_CHAIN.SHAPE_IS_PT) this.convertArc(aIdx);
    }
  }

  /**
   * Return a reference to a given point in the line chain.
   *
   * @param aIndex is the index of the point.  Negative indices are counted from the end.
   */
  CPoint(aIndex: number): VECTOR2I {
    if (aIndex < 0) aIndex += this.PointCount();
    else if (aIndex >= this.PointCount()) aIndex -= this.PointCount();

    return this.m_points[aIndex]!;
  }

  CPoints(): readonly VECTOR2I[] {
    return this.m_points;
  }

  /**
   * Return the last point in the line chain.
   */
  CLastPoint(): VECTOR2I {
    return this.m_points[this.PointCount() - 1]!;
  }

  /**
   * @return the vector of stored arcs.
   */
  CArcs(): readonly SHAPE_ARC[] {
    return this.m_arcs;
  }

  /**
   * @return the vector of values indicating shape type and location.
   */
  CShapes(): readonly SHAPE_PAIR[] {
    return this.m_shapes;
  }

  /// @copydoc SHAPE::BBox()
  BBox(aClearance = 0): BOX2I {
    const bbox = new BOX2I();
    bbox.Compute(this.m_points);

    if (aClearance !== 0 || this.m_width !== 0) bbox.Inflate(aClearance + this.m_width);

    return bbox;
  }

  GenerateBBoxCache(): void {
    this.m_bbox.Compute(this.m_points);

    if (this.m_width !== 0) this.m_bbox.Inflate(this.m_width);
  }

  override GetCachedBBox(): BOX2I {
    return this.m_bbox;
  }

  /**
   * Reverse point order in the line chain.
   *
   * @return line chain with reversed point order (original A-B-C-D: returned D-C-B-A).
   */
  Reverse(): SHAPE_LINE_CHAIN {
    const a = new SHAPE_LINE_CHAIN(this);

    a.m_points.reverse();
    a.m_shapes.reverse();
    a.m_arcs.reverse();

    for (const sh of a.m_shapes) {
      if (!samePair(sh, SHAPE_LINE_CHAIN.SHAPES_ARE_PT())) {
        runOnPair(sh, (aShapeIndex) =>
          aShapeIndex !== SHAPE_LINE_CHAIN.SHAPE_IS_PT
            ? a.m_arcs.length - aShapeIndex - 1
            : aShapeIndex,
        );

        if (sh[1] !== SHAPE_LINE_CHAIN.SHAPE_IS_PT) {
          // If the second element is populated, the first one should be too!
          // Switch round first and second in shared points, as part of reversing the chain
          const t = sh[0];
          sh[0] = sh[1];
          sh[1] = t;
        }
      }
    }

    for (const arc of a.m_arcs) arc.Reverse();

    a.m_closed = this.m_closed;

    return a;
  }

  /**
   * Remove all arc references in the line chain, resulting in a chain formed
   * only of straight segments. Any arcs in the chain are converted to segments.
   */
  ClearArcs(): void {
    for (let arcIndex = this.m_arcs.length - 1; arcIndex >= 0; --arcIndex)
      this.convertArc(arcIndex);
  }

  /**
   * Return length of the line chain in Euclidean metric.
   */
  Length(): number {
    let l = 0;

    for (let i = 0; i < this.SegmentCount(); i++) {
      // Only include segments that aren't part of arc shapes
      if (!this.IsArcSegment(i)) l += this.CSegment(i).Length();
    }

    for (let i = 0; i < this.ArcCount(); i++) l += Math.trunc(this.CArcs()[i]!.GetLength());

    return l;
  }

  /**
   * Allocate a number of points all at once (for performance).
   */
  ReservePoints(aSize: number): void {}

  /**
   * Append a new point at the end of the line chain.
   *
   * @param aP is the new point.
   * @param aAllowDuplication set to true to append the new point even if it is the same as
   *                          the last entered point, false (default) to skip it if it is the
   *                          same as the last entered point.
   */
  Append(aX: number, aY: number, aAllowDuplication?: boolean): void;
  Append(aP: Vec2, aAllowDuplication?: boolean): void;
  /**
   * Append another line chain at the end.
   */
  Append(aOtherLine: SHAPE_LINE_CHAIN): void;
  /**
   * Append an arc.
   */
  Append(aArc: SHAPE_ARC, aMaxError?: number): void;
  Append(a: number | Vec2 | SHAPE_LINE_CHAIN | SHAPE_ARC, b?: number | boolean, c?: boolean): void {
    if (typeof a === 'number') {
      this.appendPoint({ x: a, y: b as number }, c ?? false);
      return;
    }

    if (a instanceof SHAPE_LINE_CHAIN) {
      this.appendChain(a);
      return;
    }

    if (a instanceof SHAPE_ARC) {
      this.appendArc(a, (b as number | undefined) ?? getArcPolygonizationMaxError());
      return;
    }

    this.appendPoint(a, (b as boolean | undefined) ?? false);
  }

  private appendPoint(aP: Vec2, aAllowDuplication: boolean): void {
    if (this.m_points.length === 0) this.m_bbox = new BOX2I(aP, { x: 0, y: 0 });

    if (this.m_points.length === 0 || aAllowDuplication || !samePoint(this.CLastPoint(), aP)) {
      this.m_points.push({ x: aP.x, y: aP.y });
      this.m_shapes.push(SHAPE_LINE_CHAIN.SHAPES_ARE_PT());
      this.m_bbox.Merge(aP);
    }
  }

  private appendChain(aOtherLine: SHAPE_LINE_CHAIN): void {
    if (aOtherLine.PointCount() === 0) {
      return;
    }

    const num_arcs = this.m_arcs.length;
    for (const arc of aOtherLine.m_arcs) this.m_arcs.push(new SHAPE_ARC(arc));

    const fixShapeIndices = (aShapeIndices: SHAPE_PAIR): SHAPE_PAIR => {
      const retval: SHAPE_PAIR = [aShapeIndices[0], aShapeIndices[1]];
      runOnPair(retval, (aIndex) =>
        aIndex !== SHAPE_LINE_CHAIN.SHAPE_IS_PT ? aIndex + num_arcs : aIndex,
      );
      return retval;
    };

    if (this.PointCount() === 0 || !samePoint(aOtherLine.CPoint(0), this.CLastPoint())) {
      const p = aOtherLine.CPoint(0);
      this.m_points.push({ x: p.x, y: p.y });
      this.m_shapes.push(fixShapeIndices(aOtherLine.CShapes()[0]!));
      this.m_bbox.Merge(p);
    } else if (aOtherLine.IsArcSegment(0)) {
      // Associate the new arc shape with the last point of this chain
      const last = this.m_shapes[this.m_shapes.length - 1]!;

      if (samePair(last, SHAPE_LINE_CHAIN.SHAPES_ARE_PT()))
        last[0] = aOtherLine.CShapes()[0]![0] + num_arcs;
      else last[1] = aOtherLine.CShapes()[0]![0] + num_arcs;
    }

    for (let i = 1; i < aOtherLine.PointCount(); i++) {
      const p = aOtherLine.CPoint(i);
      this.m_points.push({ x: p.x, y: p.y });

      const arcIndex = aOtherLine.ArcIndex(i);

      if (arcIndex !== SHAPE_LINE_CHAIN.SHAPE_IS_PT) {
        this.m_shapes.push(fixShapeIndices(aOtherLine.m_shapes[i]!));
      } else this.m_shapes.push(SHAPE_LINE_CHAIN.SHAPES_ARE_PT());

      this.m_bbox.Merge(p);
    }

    this.mergeFirstLastPointIfNeeded();
  }

  private appendArc(aArc: SHAPE_ARC, aMaxError: number): void {
    const chain = aArc.ConvertToPolyline(aMaxError);

    if (chain.PointCount() > 2) {
      chain.m_arcs.push(new SHAPE_ARC(aArc));
      chain.m_arcs[chain.m_arcs.length - 1]!.SetWidth(0);

      for (const sh of chain.m_shapes) sh[0] = 0;
    }

    this.appendChain(chain);
  }

  /**
   * Insert a point at the given vertex index (or an arc).
   */
  Insert(aVertex: number, aP: Vec2): void;
  Insert(aVertex: number, aArc: SHAPE_ARC, aMaxError?: number): void;
  Insert(aVertex: number, a: Vec2 | SHAPE_ARC, aMaxError?: number): void {
    if (a instanceof SHAPE_ARC) {
      this.insertArc(aVertex, a, aMaxError ?? getArcPolygonizationMaxError());
      return;
    }

    if (aVertex === this.m_points.length) {
      this.Append(a);
      return;
    }

    if (!(aVertex < this.m_points.length)) return; // wxCHECK

    if (aVertex > 0 && this.IsPtOnArc(aVertex)) this.splitArc(aVertex);

    //@todo need to check we aren't creating duplicate points
    this.m_points.splice(aVertex, 0, { x: a.x, y: a.y });
    this.m_shapes.splice(aVertex, 0, SHAPE_LINE_CHAIN.SHAPES_ARE_PT());
  }

  private insertArc(aVertex: number, aArc: SHAPE_ARC, aMaxError: number): void {
    if (!(aVertex < this.m_points.length)) return; // wxCHECK

    if (aVertex > 0 && this.IsPtOnArc(aVertex)) this.splitArc(aVertex);

    /// Step 1: Find the position for the new arc in the existing arc vector
    let arc_pos = this.m_arcs.length;

    // `for( auto arc_it = m_shapes.rbegin(); arc_it != m_shapes.rend() + aVertex; arc_it++ )`:
    // from the last shape backwards, stopping before index aVertex.
    for (let k = this.m_shapes.length - 1; k >= aVertex; k--) {
      const sh = this.m_shapes[k]!;

      if (!samePair(sh, SHAPE_LINE_CHAIN.SHAPES_ARE_PT())) {
        arc_pos = Math.max(sh[0], sh[1]);
        arc_pos++;
      }
    }

    //Increment all arc indices before inserting the new arc
    for (const sh of this.m_shapes) {
      runOnPair(sh, (aIndex) => (aIndex >= arc_pos ? aIndex + 1 : aIndex));
    }

    const arcCopy = new SHAPE_ARC(aArc);
    arcCopy.SetWidth(0);
    this.m_arcs.splice(arc_pos, 0, arcCopy);

    /// Step 2: Add the arc polyline points to the chain
    //@todo need to check we aren't creating duplicate points at start or end
    const chain = aArc.ConvertToPolyline(aMaxError);
    this.m_points.splice(aVertex, 0, ...chain.CPoints().map((p) => ({ x: p.x, y: p.y })));

    /// Step 3: Add the vector of indices to the shape vector
    //@todo need to check we aren't creating duplicate points at start or end
    const new_points: SHAPE_PAIR[] = Array.from({ length: chain.PointCount() }, () => [
      arc_pos,
      SHAPE_LINE_CHAIN.SHAPE_IS_PT,
    ]);
    this.m_shapes.splice(aVertex, 0, ...new_points);
  }

  /**
   * Replace points with indices in range [start_index, end_index] with a single point \a aP.
   */
  Replace(aStartIndex: number, aEndIndex: number, aP: Vec2): void;
  /**
   * Replace points with indices in range [start_index, end_index] with the points from line
   * chain \a aLine.
   */
  Replace(aStartIndex: number, aEndIndex: number, aLine: SHAPE_LINE_CHAIN): void;
  Replace(aStartIndex: number, aEndIndex: number, a: Vec2 | SHAPE_LINE_CHAIN): void {
    if (!(a instanceof SHAPE_LINE_CHAIN)) {
      this.Remove(aStartIndex, aEndIndex);
      this.Insert(aStartIndex, a);
      return;
    }

    if (aEndIndex < 0) aEndIndex += this.PointCount();

    if (aStartIndex < 0) aStartIndex += this.PointCount();

    // We only process lines in order in this house
    // wxASSERT( aStartIndex <= aEndIndex );
    // wxASSERT( aEndIndex < static_cast<int>( m_points.size() ) );

    const newLine = new SHAPE_LINE_CHAIN(a);

    // Zero points to add?
    if (newLine.PointCount() === 0) {
      this.Remove(aStartIndex, aEndIndex);
      return;
    }

    // Remove coincident points in the new line
    if (samePoint(newLine.m_points[0]!, this.m_points[aStartIndex]!)) {
      aStartIndex++;
      newLine.Remove(0);

      // Zero points to add?
      if (newLine.PointCount() === 0) {
        this.Remove(aStartIndex, aEndIndex);
        return;
      }
    }

    if (
      samePoint(newLine.m_points[newLine.m_points.length - 1]!, this.m_points[aEndIndex]!) &&
      aEndIndex > 0
    ) {
      aEndIndex--;
      newLine.Remove(-1);
    }

    this.Remove(aStartIndex, aEndIndex);

    // Zero points to add?
    if (newLine.PointCount() === 0) return;

    // The total new arcs index is added to the new arc indices
    const prev_arc_count = this.m_arcs.length;
    const new_shapes: SHAPE_PAIR[] = newLine.m_shapes.map((s) => [s[0], s[1]]);

    for (const shape_pair of new_shapes) {
      runOnPair(shape_pair, (aShape) =>
        aShape !== SHAPE_LINE_CHAIN.SHAPE_IS_PT ? aShape + prev_arc_count : aShape,
      );
    }

    this.m_shapes.splice(aStartIndex, 0, ...new_shapes);
    this.m_points.splice(aStartIndex, 0, ...newLine.m_points.map((p) => ({ x: p.x, y: p.y })));
    for (const arc of newLine.m_arcs) this.m_arcs.push(arc);
  }

  /**
   * Remove the range of points [start_index, end_index] from the line chain.
   */
  Remove(aStartIndex: number, aEndIndex?: number): void {
    if (aEndIndex === undefined) aEndIndex = aStartIndex;

    if (this.m_shapes.length !== this.m_points.length) return; // wxCHECK

    // Unwrap the chain first (correctly handling removing arc at
    // end of chain coincident with start)
    const closedState = this.IsClosed();
    this.SetClosed(false);

    if (aEndIndex < 0) aEndIndex += this.PointCount();

    if (aStartIndex < 0) aStartIndex += this.PointCount();

    if (
      aStartIndex >= this.PointCount() ||
      aEndIndex >= this.PointCount() ||
      aStartIndex > aEndIndex
    ) {
      this.SetClosed(closedState);
      return;
    }

    // Split arcs, making arcs coincident
    if (!this.IsArcStart(aStartIndex) && this.IsPtOnArc(aStartIndex))
      this.splitArc(aStartIndex, false);

    if (this.IsSharedPt(aStartIndex)) aStartIndex += 1; // Don't delete the shared point

    if (!this.IsArcEnd(aEndIndex) && this.IsPtOnArc(aEndIndex) && aEndIndex < this.PointCount() - 1)
      this.splitArc(aEndIndex + 1, true);

    if (this.IsSharedPt(aEndIndex)) aEndIndex -= 1; // Don't delete the shared point

    if (aStartIndex > aEndIndex) {
      this.SetClosed(closedState);
      return;
    }

    const extra_arcs = new Set<number>();
    const logArcIdxRemoval = (aShapeIndex: number): number => {
      if (aShapeIndex !== SHAPE_LINE_CHAIN.SHAPE_IS_PT) extra_arcs.add(aShapeIndex);
      return aShapeIndex;
    };

    // Remove any overlapping arcs in the point range
    for (let i = aStartIndex; i <= aEndIndex; i++) {
      if (this.IsSharedPt(i)) {
        if (i === aStartIndex) {
          logArcIdxRemoval(this.m_shapes[i]![1]); // Only remove the arc on the second index
          continue;
        } else if (i === aEndIndex) {
          logArcIdxRemoval(this.m_shapes[i]![0]); // Only remove the arc on the first index
          continue;
        }
      } else {
        runOnPair(this.m_shapes[i]!, logArcIdxRemoval);
      }
    }

    // std::set iterates in ascending order
    for (const arc of [...extra_arcs].sort((x, y) => x - y)) this.convertArc(arc);

    this.m_shapes.splice(aStartIndex, aEndIndex - aStartIndex + 1);
    this.m_points.splice(aStartIndex, aEndIndex - aStartIndex + 1);

    this.SetClosed(closedState);
  }

  /**
   * Remove the shape at the given index from the line chain.
   *
   * If the given index is inside an arc, the entire arc will be removed.
   * Otherwise this function is equivalent to calling Remove of a single point.
   */
  RemoveShape(aPointIndex: number): void {
    if (aPointIndex < 0) aPointIndex += this.PointCount();

    if (aPointIndex >= this.PointCount() || aPointIndex < 0) return; // Invalid index, fail gracefully

    if (samePair(this.m_shapes[aPointIndex]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT())) {
      this.Remove(aPointIndex);
      return;
    }

    let start = aPointIndex;
    let end = aPointIndex;
    const arcIdx = this.ArcIndex(aPointIndex);

    if (!this.IsArcStart(start)) {
      // aPointIndex is not a shared point, so iterate backwards to find the start of the arc
      while (start > 0 && this.ArcIndex(start - 1) === arcIdx) start--;
    }

    if (!this.IsArcEnd(end) || start === end) end = this.NextShape(end); // can be -1 to indicate end of chain

    this.Remove(start, end);
  }

  /**
   * Check if point \a aP lies closer to us than \a aDist, and if so, return the index of
   * the split point (inserting one if `aExact` is false).
   */
  Split(aP: Vec2, aExact?: boolean): number;
  /**
   * Split the line chain into three parts at the nearest points to `aStart` and `aEnd`.
   */
  Split(
    aStart: Vec2,
    aEnd: Vec2,
    aPre: SHAPE_LINE_CHAIN,
    aMid: SHAPE_LINE_CHAIN,
    aPost: SHAPE_LINE_CHAIN,
  ): void;
  Split(
    a: Vec2,
    b?: boolean | Vec2,
    aPre?: SHAPE_LINE_CHAIN,
    aMid?: SHAPE_LINE_CHAIN,
    aPost?: SHAPE_LINE_CHAIN,
  ): number | undefined {
    if (typeof b === 'object') {
      this.splitThree(a, b, aPre!, aMid!, aPost!);
      return undefined;
    }

    const aExact = b ?? false;
    let ii = -1;
    let min_dist = 2;

    const found_index = this.Find(a);

    if (found_index >= 0 && aExact) return found_index;

    for (let s = 0; s < this.SegmentCount(); s++) {
      const seg = this.CSegment(s);
      const dist = seg.Distance(a);

      // make sure we are not producing a 'slightly concave' primitive. This might happen
      // if aP lies very close to one of already existing points.
      if (dist < min_dist && !samePoint(seg.A, a) && !samePoint(seg.B, a)) {
        min_dist = dist;
        if (found_index < 0) ii = s;
        else if (s < found_index) ii = s;
      }
    }

    if (ii < 0) ii = found_index;

    if (ii >= 0) {
      // Don't create duplicate points
      if (samePoint(this.GetPoint(ii), a)) return ii;

      const newIndex = ii + 1;

      if (this.IsArcSegment(ii)) {
        this.m_points.splice(newIndex, 0, { x: a.x, y: a.y });
        this.m_shapes.splice(newIndex, 0, [this.ArcIndex(ii), SHAPE_LINE_CHAIN.SHAPE_IS_PT]);
        this.splitArc(newIndex, true); // Make the inserted point a shared point
      } else {
        this.Insert(newIndex, a);
      }

      return newIndex;
    }

    return -1;
  }

  private splitThree(
    aStart: Vec2,
    aEnd: Vec2,
    aPre: SHAPE_LINE_CHAIN,
    aMid: SHAPE_LINE_CHAIN,
    aPost: SHAPE_LINE_CHAIN,
  ): void {
    const cp = { x: aEnd.x, y: aEnd.y };

    const n = this.NearestPoint(cp, false);
    const m = this.NearestPoint(aStart, false);

    let l = new SHAPE_LINE_CHAIN(this);
    l.Split(n, true);
    l.Split(m, true);

    let i_start = l.Find(m);
    let i_end = l.Find(n);

    if (i_start > i_end) {
      l = l.Reverse();
      i_start = l.Find(m);
      i_end = l.Find(n);
    }

    aPre.assign(l.Slice(0, i_start));
    aPost.assign(l.Slice(i_end, -1));
    aMid.assign(l.Slice(i_start, i_end));
  }

  /**
   * Search for point \a aP.
   *
   * @param aP is the point to be looked for.
   * @return the index of the corresponding point in the line chain or negative when not found.
   */
  Find(aP: Vec2, aThreshold = 0): number {
    for (let s = 0; s < this.PointCount(); s++) {
      if (aThreshold === 0) {
        if (samePoint(this.CPoint(s), aP)) return s;
      } else {
        const c = this.CPoint(s);
        if (EuclideanNormI({ x: c.x - aP.x, y: c.y - aP.y }) <= aThreshold) return s;
      }
    }

    return -1;
  }

  /**
   * Search for segment containing point \a aP.
   *
   * @param aP is the point to be looked for.
   * @return index of the corresponding segment in the line chain or negative when not found.
   */
  FindSegment(aP: Vec2, aThreshold = 1): number {
    for (let s = 0; s < this.SegmentCount(); s++) {
      if (this.CSegment(s).Distance(aP) <= aThreshold) return s;
    }

    return -1;
  }

  /**
   * Return a subset of this line chain containing the [start_index, end_index] range of points.
   *
   * @param aStartIndex is the start of the point range to be returned (inclusive).
   * @param aEndIndex is the end of the point range to be returned (inclusive).
   * @return the cut line chain.
   */
  Slice(
    aStartIndex: number,
    aEndIndex: number,
    aMaxError: number = getArcPolygonizationMaxError(),
  ): SHAPE_LINE_CHAIN {
    const rv = new SHAPE_LINE_CHAIN();

    if (aEndIndex < 0) aEndIndex += this.PointCount();

    if (aStartIndex < 0) aStartIndex += this.PointCount();

    // Bad programmer checks
    if (aStartIndex < 0) return new SHAPE_LINE_CHAIN();
    if (aEndIndex < 0) return new SHAPE_LINE_CHAIN();
    if (aStartIndex >= this.PointCount()) return new SHAPE_LINE_CHAIN();
    if (aEndIndex >= this.PointCount()) return new SHAPE_LINE_CHAIN();
    if (aEndIndex < aStartIndex) return new SHAPE_LINE_CHAIN();

    const numPoints = this.m_points.length;

    if (this.IsArcSegment(aStartIndex) && !this.IsArcStart(aStartIndex)) {
      // Cutting in middle of an arc, lets split it
      const arcToSplitIndex = this.ArcIndex(aStartIndex);
      const arcToSplit = this.Arc(arcToSplitIndex);

      // Copy the points as arc points
      for (
        let i = aStartIndex;
        i < this.m_points.length && arcToSplitIndex === this.ArcIndex(i);
        i++
      ) {
        rv.m_points.push({ x: this.m_points[i]!.x, y: this.m_points[i]!.y });
        rv.m_shapes.push([rv.m_arcs.length, SHAPE_LINE_CHAIN.SHAPE_IS_PT]);
        rv.m_bbox.Merge(this.m_points[i]!);
      }

      // Create a new arc from the existing one, with different start point.
      const newArc = new SHAPE_ARC();

      const newArcStart = this.m_points[aStartIndex]!;

      newArc.ConstructFromStartEndCenter(
        newArcStart,
        arcToSplit.GetP1(),
        arcToSplit.GetCenter(),
        arcToSplit.IsClockwise(),
      );

      rv.m_arcs.push(newArc);

      aStartIndex += rv.PointCount();
    }

    for (let i = aStartIndex; i <= aEndIndex && i < numPoints; i = this.NextShape(i)) {
      if (i === -1) return rv; // NextShape reached the end

      const nextShape = this.NextShape(i);
      const isLastShape = nextShape < 0;

      if (this.IsArcStart(i)) {
        if ((isLastShape && aEndIndex !== numPoints - 1) || nextShape > aEndIndex) {
          if (i === aEndIndex) {
            // Single point on an arc, just append the single point
            rv.Append(this.m_points[i]!);
            return rv;
          }

          // Cutting in middle of an arc, lets split it
          const arcIndex = this.ArcIndex(i);
          const currentArc = this.Arc(arcIndex);

          // Copy the points as arc points
          for (; i <= aEndIndex && i < numPoints; i++) {
            if (arcIndex !== this.ArcIndex(i)) break;

            rv.m_points.push({ x: this.m_points[i]!.x, y: this.m_points[i]!.y });
            rv.m_shapes.push([rv.m_arcs.length, SHAPE_LINE_CHAIN.SHAPE_IS_PT]);
            rv.m_bbox.Merge(this.m_points[i]!);
          }

          // Create a new arc from the existing one, with different end point.
          const newArc = new SHAPE_ARC();

          const newArcEnd = this.m_points[aEndIndex]!;

          newArc.ConstructFromStartEndCenter(
            currentArc.GetP0(),
            newArcEnd,
            currentArc.GetCenter(),
            currentArc.IsClockwise(),
          );

          rv.m_arcs.push(newArc);

          return rv;
        } else {
          // append the whole arc
          const currentArc = this.Arc(this.ArcIndex(i));
          rv.Append(currentArc, aMaxError);
        }

        if (isLastShape) return rv;
      } else {
        // wxASSERT_MSG( !IsArcSegment( i ), wxT( "Still on an arc segment, we missed something..." ) );

        if (i === aStartIndex) rv.Append(this.m_points[i]!);

        const nextPointIsArc = isLastShape ? false : this.IsArcSegment(nextShape);

        if (!nextPointIsArc && i < this.SegmentCount() && i < aEndIndex)
          rv.Append(this.GetSegment(i).B);
      }
    }

    return rv;
  }

  /**
   * Check if the line chain intersects the segment / other chain.
   */
  Intersects(aSeg: SEG): boolean;
  Intersects(aChain: SHAPE_LINE_CHAIN): boolean;
  Intersects(a: SEG | SHAPE_LINE_CHAIN): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) {
      const dummy: INTERSECTIONS = [];
      return this.Intersect(a, dummy) !== 0;
    }

    const segCount = this.SegmentCount();
    const ptCount = this.m_points.length;
    const segMinX = Math.min(a.A.x, a.B.x);
    const segMaxX = Math.max(a.A.x, a.B.x);
    const segMinY = Math.min(a.A.y, a.B.y);
    const segMaxY = Math.max(a.A.y, a.B.y);

    for (let s = 0; s < segCount; s++) {
      const ptA = this.m_points[s]!;
      const ptB = this.m_points[s + 1 < ptCount ? s + 1 : 0]!;

      if (
        Math.max(ptA.x, ptB.x) < segMinX ||
        Math.min(ptA.x, ptB.x) > segMaxX ||
        Math.max(ptA.y, ptB.y) < segMinY ||
        Math.min(ptA.y, ptB.y) > segMaxY
      ) {
        continue;
      }

      if (new SEG(ptA, ptB).Intersects(a)) return true;
    }

    return false;
  }

  /**
   * Find all intersection points between our line chain and the segment \a aSeg.
   *
   * @param aSeg is the segment chain to find intersections with.
   * @param aIp is the reference to a vector to store found intersections. Intersection points
   *            are sorted with increasing distances from point aSeg.a.
   * @return the number of intersections found.
   */
  Intersect(aSeg: SEG, aIp: INTERSECTIONS): number;
  /**
   * Find all intersection points between our line chain and the line chain \a aChain.
   *
   * @param aChain is the line chain to find intersections with.
   * @param aIp is reference to a vector to store found intersections. Intersection points are
   *            sorted with increasing path lengths from the starting point of aChain.
   * @return the number of intersections found.
   */
  Intersect(
    aChain: SHAPE_LINE_CHAIN,
    aIp: INTERSECTIONS,
    aExcludeColinearAndTouching?: boolean,
    aChainBBox?: BOX2I,
  ): number;
  Intersect(
    a: SEG | SHAPE_LINE_CHAIN,
    aIp: INTERSECTIONS,
    aExcludeColinearAndTouching = false,
    aChainBBox?: BOX2I,
  ): number {
    if (a instanceof SHAPE_LINE_CHAIN)
      return this.intersectChain(a, aIp, aExcludeColinearAndTouching, aChainBBox);

    const segCount = this.SegmentCount();
    const ptCount = this.m_points.length;
    const segMinX = Math.min(a.A.x, a.B.x);
    const segMaxX = Math.max(a.A.x, a.B.x);
    const segMinY = Math.min(a.A.y, a.B.y);
    const segMaxY = Math.max(a.A.y, a.B.y);

    for (let s = 0; s < segCount; s++) {
      const ptA = this.m_points[s]!;
      const ptB = this.m_points[s + 1 < ptCount ? s + 1 : 0]!;

      if (
        Math.max(ptA.x, ptB.x) < segMinX ||
        Math.min(ptA.x, ptB.x) > segMaxX ||
        Math.max(ptA.y, ptB.y) < segMinY ||
        Math.min(ptA.y, ptB.y) > segMaxY
      ) {
        continue;
      }

      const p = new SEG(ptA, ptB, s).Intersect(a);

      if (p) {
        const is = new INTERSECTION();
        is.valid = true;
        is.index_our = s;
        is.index_their = -1;
        is.is_corner_our = is.is_corner_their = false;
        is.p = p;
        aIp.push(is);
      }
    }

    // compareOriginDistance( aSeg.A ): by squared distance from the origin
    const origin = a.A;
    aIp.sort((x, y) => sqDist(origin, x.p) - sqDist(origin, y.p));

    return aIp.length;
  }

  private intersectChain(
    aChain: SHAPE_LINE_CHAIN,
    aIp: INTERSECTIONS,
    aExcludeColinearAndTouching: boolean,
    aChainBBox?: BOX2I,
  ): number {
    const ourSegCount = this.SegmentCount();
    const theirSegCount = aChain.SegmentCount();

    if (ourSegCount === 0 || theirSegCount === 0) return 0;

    const bbOther = new BOX2I_MINMAX(aChainBBox ? aChainBBox : aChain.BBox());
    const ourPtCount = this.m_points.length;
    const theirPtCount = aChain.CPoints().length;
    const theirPts = aChain.CPoints();

    const theirSegs: SEG[] = new Array(theirSegCount);
    const sorted: SEG_EXTENT[] = new Array(theirSegCount);

    // Pre-build SEGs for the other chain so each is constructed exactly once
    for (let i = 0; i < theirSegCount; i++) {
      const pa = theirPts[i]!;
      const pb = theirPts[i + 1 < theirPtCount ? i + 1 : 0]!;
      theirSegs[i] = new SEG(pa, pb, i);
    }

    // Compact extent array for cache-friendly scanning, sorted by minX
    for (let i = 0; i < theirSegCount; i++) {
      const s = theirSegs[i]!;
      sorted[i] = {
        minX: Math.min(s.A.x, s.B.x),
        maxX: Math.max(s.A.x, s.B.x),
        minY: Math.min(s.A.y, s.B.y),
        maxY: Math.max(s.A.y, s.B.y),
        segIdx: i,
      };
    }

    // std::sort is not stable; the comparator only orders by minX, so ties keep
    // whatever order the sort leaves - Array.prototype.sort is stable, which is
    // one of the orders std::sort may produce.
    sorted.sort((x, y) => x.minX - y.minX);

    for (let s1 = 0; s1 < ourSegCount; s1++) {
      const a1 = this.m_points[s1]!;
      const b1 = this.m_points[s1 + 1 < ourPtCount ? s1 + 1 : 0]!;

      const ourMinX = Math.min(a1.x, b1.x);
      const ourMaxX = Math.max(a1.x, b1.x);
      const ourMinY = Math.min(a1.y, b1.y);
      const ourMaxY = Math.max(a1.y, b1.y);

      if (
        ourMaxX < bbOther.m_Left ||
        ourMinX > bbOther.m_Right ||
        ourMaxY < bbOther.m_Top ||
        ourMinY > bbOther.m_Bottom
      ) {
        continue;
      }

      const a = new SEG(a1, b1, s1);

      // Find the right boundary in the sorted extents: first entry where minX > ourMaxX.
      // Everything past this point is too far right to overlap.
      let lo = 0;
      let hi = sorted.length;

      while (lo < hi) {
        const mid = (lo + hi) >>> 1;

        if (ourMaxX < sorted[mid]!.minX) hi = mid;
        else lo = mid + 1;
      }

      const rightEnd = lo;

      for (let jt = 0; jt < rightEnd; ++jt) {
        const e = sorted[jt]!;

        if (e.maxX < ourMinX || e.maxY < ourMinY || e.minY > ourMaxY) continue;

        const b = theirSegs[e.segIdx]!;

        const is = new INTERSECTION();
        is.index_our = s1;
        is.index_their = e.segIdx;
        is.is_corner_our = false;
        is.is_corner_their = false;
        is.valid = true;

        const p = a.Intersect(b);

        if (!aExcludeColinearAndTouching && a.Collinear(b)) {
          if (a.Contains(b.A)) {
            is.p = { x: b.A.x, y: b.A.y };
            is.is_corner_their = true;
            aIp.push(cloneIntersection(is));
          }

          if (a.Contains(b.B)) {
            is.p = { x: b.B.x, y: b.B.y };
            is.index_their++;
            is.is_corner_their = true;
            aIp.push(cloneIntersection(is));
          }

          if (b.Contains(a.A)) {
            is.p = { x: a.A.x, y: a.A.y };
            is.is_corner_our = true;
            aIp.push(cloneIntersection(is));
          }

          if (b.Contains(a.B)) {
            is.p = { x: a.B.x, y: a.B.y };
            is.index_our++;
            is.is_corner_our = true;
            aIp.push(cloneIntersection(is));
          }
        } else if (p) {
          is.p = p;
          is.is_corner_our = false;
          is.is_corner_their = false;

          if (samePoint(p, a.A)) {
            is.is_corner_our = true;
          }

          if (samePoint(p, a.B)) {
            is.is_corner_our = true;
            is.index_our++;
          }

          if (samePoint(p, b.A)) {
            is.is_corner_their = true;
          }

          if (samePoint(p, b.B)) {
            is.is_corner_their = true;
            is.index_their++;
          }

          aIp.push(is);
        }
      }
    }

    return aIp.length;
  }

  /**
   * Compute the walk path length from the beginning of the line chain and the point \a aP
   * belonging to our line.
   *
   * @return the path length in Euclidean metric or -1 if aP does not belong to the line chain.
   */
  PathLength(aP: Vec2, aIndex = -1): number {
    let sum = 0;

    for (let i = 0; i < this.SegmentCount(); i++) {
      const seg = this.CSegment(i);
      let indexMatch = true;

      if (aIndex >= 0) {
        if (aIndex === this.SegmentCount()) {
          indexMatch = i === this.SegmentCount() - 1;
        } else {
          indexMatch = i === aIndex;
        }
      }

      if (indexMatch) {
        sum += EuclideanNormI({ x: aP.x - seg.A.x, y: aP.y - seg.A.y });
        return sum;
      } else sum += seg.Length();
    }

    return -1;
  }

  /**
   * Check if point \a aP is closer to (or on) an edge or vertex of the line chain.
   *
   * @param aP is the point to check.
   * @param aDist is the distance in internal units.
   * @return true if the point is equal to or closer than aDist to the line chain.
   */
  CheckClearance(aP: Vec2, aDist: number): boolean {
    if (!this.PointCount()) return false;
    else if (this.PointCount() === 1) return samePoint(this.m_points[0]!, aP);

    for (let i = 0; i < this.SegmentCount(); i++) {
      const s = this.CSegment(i);

      if (samePoint(s.A, aP) || samePoint(s.B, aP)) return true;

      if (s.Distance(aP) <= aDist) return true;
    }

    return false;
  }

  /**
   * Check if the line chain is self-intersecting. Only processes line segments (not arcs).
   *
   * @return (optional) first found self-intersection point.
   */
  SelfIntersecting(): INTERSECTION | undefined {
    const segCount = this.SegmentCount();
    const ptCount = this.m_points.length;
    const closed = this.m_closed;

    if (segCount < 2) return undefined;

    // Index of the second endpoint of segment i, handling the closed-chain wrap
    const endIdx = (i: number): number => {
      const next = i + 1;
      return next < ptCount ? next : 0;
    };

    for (let s1 = 0; s1 < segCount; s1++) {
      const a1 = this.m_points[s1]!;
      const b1 = this.m_points[endIdx(s1)]!;

      // Expand by 2 to account for Contains() tolerance (SquaredDistance <= 3)
      const s1MinX = Math.min(a1.x, b1.x) - 2;
      const s1MaxX = Math.max(a1.x, b1.x) + 2;
      const s1MinY = Math.min(a1.y, b1.y) - 2;
      const s1MaxY = Math.max(a1.y, b1.y) + 2;

      for (let s2 = s1 + 1; s2 < segCount; s2++) {
        const a2 = this.m_points[s2]!;
        const b2 = this.m_points[endIdx(s2)]!;

        const s2MinX = Math.min(a2.x, b2.x);
        const s2MaxX = Math.max(a2.x, b2.x);

        if (s1MaxX < s2MinX || s2MaxX < s1MinX) continue;

        const s2MinY = Math.min(a2.y, b2.y);
        const s2MaxY = Math.max(a2.y, b2.y);

        if (s1MaxY < s2MinY || s2MaxY < s1MinY) continue;

        const seg1 = new SEG(a1, b1, s1);

        if (s1 + 1 !== s2 && seg1.Contains(a2)) {
          const is = new INTERSECTION();
          is.index_our = s1;
          is.index_their = s2;
          is.p = { x: a2.x, y: a2.y };
          return is;
        } else if (
          seg1.Contains(b2) &&
          // for closed polylines, the ending point of the
          // last segment == starting point of the first segment
          // this is a normal case, not self intersecting case
          !(closed && s1 === 0 && s2 === segCount - 1)
        ) {
          const is = new INTERSECTION();
          is.index_our = s1;
          is.index_their = s2;
          is.p = { x: b2.x, y: b2.y };
          return is;
        } else {
          const p = seg1.Intersect(new SEG(a2, b2, s2), true);

          if (p) {
            const is = new INTERSECTION();
            is.index_our = s1;
            is.index_their = s2;
            is.p = p;
            return is;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Check if the line chain is self-intersecting. Also processes arcs. Might be slower.
   *
   * @return (optional) first found self-intersection point.
   */
  SelfIntersectingWithArcs(): INTERSECTION | undefined {
    const pointsClose = (aPt1: Vec2, aPt2: Vec2): boolean => sqDist(aPt1, aPt2) <= 2.0;

    const collideArcSeg = (
      aArc: SHAPE_ARC,
      aSeg: SEG,
      aClearance = 0,
      aLocation?: VECTOR2I,
    ): boolean => {
      const center = aArc.GetCenter();
      const circle = new CIRCLE(center, Math.trunc(aArc.GetRadius()));

      const candidatePts = circle.Intersect(aSeg);

      for (const candidate of candidatePts) {
        // Skip shared points
        if (samePoint(aArc.GetP1(), aSeg.A) && pointsClose(candidate, aSeg.A)) continue;

        if (samePoint(aSeg.B, aArc.GetP0()) && pointsClose(candidate, aSeg.B)) continue;

        const collides = aArc.CollidePoint(candidate, aClearance, undefined, aLocation);

        if (collides) return true;
      }

      return false;
    };

    const collideArcArc = (aArc1: SHAPE_ARC, aArc2: SHAPE_ARC, aLocation?: VECTOR2I): boolean => {
      const candidatePts: VECTOR2I[] = [];

      aArc1.Intersect(aArc2, candidatePts);

      for (const candidate of candidatePts) {
        // Skip shared points
        if (samePoint(aArc1.GetP1(), aArc2.GetP0()) && pointsClose(candidate, aArc1.GetP1()))
          continue;

        if (samePoint(aArc2.GetP1(), aArc1.GetP0()) && pointsClose(candidate, aArc2.GetP1()))
          continue;

        if (aLocation) copyInto(aLocation, candidate);

        return true;
      }

      return false;
    };

    const collideSegSeg = (s1: number, s2: number, is: INTERSECTION): boolean => {
      const seg1 = this.CSegment(s1);
      const seg2 = this.CSegment(s2);

      const s2a = seg2.A;
      const s2b = seg2.B;

      if (s1 + 1 !== s2 && seg1.Contains(s2a)) {
        is.index_our = s1;
        is.index_their = s2;
        is.p = { x: s2a.x, y: s2a.y };
        return true;
      } else if (
        seg1.Contains(s2b) &&
        // for closed polylines, the ending point of the
        // last segment == starting point of the first segment
        // this is a normal case, not self intersecting case
        !(this.IsClosed() && s1 === 0 && s2 === this.SegmentCount() - 1)
      ) {
        is.index_our = s1;
        is.index_their = s2;
        is.p = { x: s2b.x, y: s2b.y };
        return true;
      } else {
        const p = seg1.Intersect(seg2, true);

        if (p) {
          is.index_our = s1;
          is.index_their = s2;
          is.p = p;
          return true;
        }
      }

      return false;
    };

    const is = new INTERSECTION();

    interface SHAPE_KEY {
      m_FirstIdx: number;
      m_ArcIdx: number;
      m_BBox: BOX2I_MINMAX;
    }

    const shapeCache: SHAPE_KEY[] = [];

    for (let si = 0; si !== -1; si = this.NextShape(si)) {
      const arci = this.ArcIndex(si);
      shapeCache.push({
        m_FirstIdx: si,
        m_ArcIdx: arci,
        m_BBox:
          arci === -1
            ? new BOX2I_MINMAX(this.CSegment(si).A, this.CSegment(si).B)
            : new BOX2I_MINMAX(this.Arc(arci).BBox()),
      });
    }

    for (let sk1 = 0; sk1 < shapeCache.length; sk1++) {
      for (let sk2 = sk1 + 1; sk2 < shapeCache.length; sk2++) {
        const loc: VECTOR2I = { x: 0, y: 0 };
        const k1 = shapeCache[sk1]!;
        const k2 = shapeCache[sk2]!;

        if (!k1.m_BBox.Intersects(k2.m_BBox)) continue;

        if (k1.m_ArcIdx === -1 && k2.m_ArcIdx === -1) {
          if (collideSegSeg(k1.m_FirstIdx, k2.m_FirstIdx, is)) {
            return is;
          }
        } else if (k1.m_ArcIdx !== -1 && k2.m_ArcIdx === -1) {
          if (collideArcSeg(this.Arc(k1.m_ArcIdx), this.CSegment(k2.m_FirstIdx), 0, loc)) {
            is.index_our = k1.m_FirstIdx;
            is.index_their = k2.m_FirstIdx;
            is.p = loc;
            return is;
          }
        } else if (k1.m_ArcIdx === -1 && k2.m_ArcIdx !== -1) {
          if (collideArcSeg(this.Arc(k2.m_ArcIdx), this.CSegment(k1.m_FirstIdx), 0, loc)) {
            is.index_our = k1.m_FirstIdx;
            is.index_their = k2.m_FirstIdx;
            is.p = loc;
            return is;
          }
        } else if (k1.m_ArcIdx !== -1 && k2.m_ArcIdx !== -1) {
          if (collideArcArc(this.Arc(k1.m_ArcIdx), this.Arc(k2.m_ArcIdx), loc)) {
            is.index_our = k1.m_FirstIdx;
            is.index_their = k2.m_FirstIdx;
            is.p = loc;
            return is;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Find the segment nearest the given point.
   *
   * @param aP is the point to compare with.
   * @return the index of the segment closest to the point.
   */
  NearestSegment(aP: Vec2): number {
    let min_d = INT_MAX;
    let nearest = 0;

    for (let i = 0; i < this.SegmentCount(); i++) {
      const d = this.CSegment(i).Distance(aP);

      if (d < min_d) {
        min_d = d;
        nearest = i;
      }
    }

    return nearest;
  }

  /**
   * Find a point on the line chain that is closest to point \a aP.
   *
   * @param aP is the point to find.
   * @param aAllowInternalShapePoints is true to allow points on the line chain that are
   *        parts of arcs to be returned; false to restrict to the start and end points of
   *        arcs.
   * @return the nearest point.
   */
  NearestPoint(aP: Vec2, aAllowInternalShapePoints?: boolean): VECTOR2I;
  /**
   * Find a point on the line chain that is closest to the line defined by the points of
   * segment \a aSeg, also returns the distance.
   *
   * @param aSeg is the segment defining the line.
   * @param dist is the reference receiving the distance to the nearest point.
   * @return the nearest point.
   */
  NearestPoint(aSeg: SEG, dist: OutInt): VECTOR2I;
  NearestPoint(a: Vec2 | SEG, b?: boolean | OutInt): VECTOR2I {
    if (a instanceof SEG) {
      const dist = b as OutInt;

      if (this.PointCount() === 0) {
        // The only right answer here is "don't crash".
        return { x: 0, y: 0 };
      }

      let nearest = 0;

      dist.value = INT_MAX;

      for (let i = 0; i < this.PointCount(); i++) {
        const d = a.LineDistance(this.CPoint(i));

        if (d < dist.value) {
          dist.value = d;
          nearest = i;
        }
      }

      return this.CPoint(nearest);
    }

    const aAllowInternalShapePoints = (b as boolean | undefined) ?? true;

    if (this.PointCount() === 0) {
      // The only right answer here is "don't crash".
      return { x: 0, y: 0 };
    }

    let min_d = INT_MAX;
    let nearest = 0;

    for (let i = 0; i < this.SegmentCount(); i++) {
      const d = this.CSegment(i).Distance(a);

      if (d < min_d) {
        min_d = d;
        nearest = i;
      }
    }

    if (!aAllowInternalShapePoints) {
      //Snap to arc end points if the closest found segment is part of an arc segment
      if (nearest > 0 && nearest < this.PointCount() && this.IsArcSegment(nearest)) {
        const segA = this.CSegment(nearest).A;
        const segB = this.CSegment(nearest).B;
        const ptToSegStart = { x: segA.x - a.x, y: segA.y - a.y };
        const ptToSegEnd = { x: segB.x - a.x, y: segB.y - a.y };

        if (EuclideanNormI(ptToSegStart) > EuclideanNormI(ptToSegEnd)) nearest++;

        // Is this the start or end of an arc?  If so, return it directly
        if (this.IsArcStart(nearest) || this.IsArcEnd(nearest)) {
          return this.m_points[nearest]!;
        } else {
          const nearestArc = this.Arc(this.ArcIndex(nearest));
          const ptToArcStart = { x: nearestArc.GetP0().x - a.x, y: nearestArc.GetP0().y - a.y };
          const ptToArcEnd = { x: nearestArc.GetP1().x - a.x, y: nearestArc.GetP1().y - a.y };

          if (EuclideanNormI(ptToArcStart) > EuclideanNormI(ptToArcEnd)) return nearestArc.GetP1();
          return nearestArc.GetP0();
        }
      }
    }

    return this.CSegment(nearest).NearestPoint(a);
  }

  /// @copydoc SHAPE::Format()
  override Format(aCplusPlus = true): string {
    let ss = 'SHAPE_LINE_CHAIN( { ';

    for (let i = 0; i < this.PointCount(); i++) {
      ss += `VECTOR2I( ${this.m_points[i]!.x}, ${this.m_points[i]!.y})`;

      if (i !== this.PointCount() - 1) ss += ', ';
    }

    ss += `}, ${this.m_closed ? 'true' : 'false'}`;
    ss += ' );';

    return ss;
  }

  /// @copydoc SHAPE::Parse()
  override Parse(aStream: string): boolean {
    const tokens = aStream.trim().split(/\s+/);
    let pos = 0;
    const next = (): number => Number(tokens[pos++]);

    this.m_points = [];

    const n_pts = next();

    // Rough sanity check, just make sure the loop bounds aren't absolutely outlandish
    if (n_pts > aStream.length) return false;

    this.m_closed = next() !== 0;

    const n_arcs = next();

    if (n_arcs > aStream.length) return false;

    for (let i = 0; i < n_pts; i++) {
      const x = next();
      const y = next();
      this.m_points.push({ x, y });
      const ind = next();
      this.m_shapes.push([ind, SHAPE_LINE_CHAIN.SHAPE_IS_PT]);
    }

    for (let i = 0; i < n_arcs; i++) {
      const pc = { x: next(), y: next() };
      const p0 = { x: next(), y: next() };
      const angle = next();

      this.m_arcs.push(new SHAPE_ARC(pc, p0, new EDA_ANGLE(angle)));
    }

    return true;
  }

  /** `operator!=`. */
  notEquals(aRhs: SHAPE_LINE_CHAIN): boolean {
    if (this.PointCount() !== aRhs.PointCount()) return true;

    for (let i = 0; i < this.PointCount(); i++) {
      if (!samePoint(this.CPoint(i), aRhs.CPoint(i))) return true;
    }

    return false;
  }

  CompareGeometry(aOther: SHAPE_LINE_CHAIN, aCyclicalCompare = false, aEpsilon = 0): boolean {
    const a = new SHAPE_LINE_CHAIN(this);
    const b = new SHAPE_LINE_CHAIN(aOther);

    a.Simplify();
    b.Simplify();

    if (a.m_points.length !== b.m_points.length) return false;

    if (aCyclicalCompare) {
      const aVerts = a.m_points.slice();
      const bVerts = b.m_points.slice();

      const centroid = (pts: VECTOR2I[]): [number, number] => {
        let sx = 0.0;
        let sy = 0.0;

        for (const p of pts) {
          sx += p.x;
          sy += p.y;
        }

        return [sx / pts.length, sy / pts.length];
      };

      const aC = centroid(aVerts);
      const bC = centroid(bVerts);

      const angleCmp = (c: [number, number], p1: VECTOR2I, p2: VECTOR2I): number => {
        const a1 = Math.atan2(p1.y - c[1], p1.x - c[0]);
        const a2 = Math.atan2(p2.y - c[1], p2.x - c[0]);
        return a1 - a2;
      };

      // sort by angle around centroid so that cyclic vertex order doesn't matter
      aVerts.sort((p1, p2) => angleCmp(aC, p1, p2));
      bVerts.sort((p1, p2) => angleCmp(bC, p1, p2));

      for (let i = 0; i < aVerts.length; i++) {
        if (
          Math.abs(aVerts[i]!.x - bVerts[i]!.x) > aEpsilon ||
          Math.abs(aVerts[i]!.y - bVerts[i]!.y) > aEpsilon
        )
          return false;
      }
    } else {
      for (let i = 0; i < a.PointCount(); i++) {
        if (
          Math.abs(a.CPoint(i).x - b.CPoint(i).x) > aEpsilon ||
          Math.abs(a.CPoint(i).y - b.CPoint(i).y) > aEpsilon
        )
          return false;
      }
    }

    return true;
  }

  Move(aVector: Vec2): void {
    for (const pt of this.m_points) {
      pt.x += aVector.x;
      pt.y += aVector.y;
    }

    for (const arc of this.m_arcs) arc.Move(aVector);

    this.m_bbox.Move(aVector);
  }

  /**
   * Mirror the line points about y or x axis (or a segment).
   */
  Mirror(aRef: Vec2, aFlipDirection: FLIP_DIRECTION): void;
  Mirror(axis: SEG): void;
  Mirror(a: Vec2 | SEG, aFlipDirection?: FLIP_DIRECTION): void {
    if (a instanceof SEG) {
      for (let i = 0; i < this.m_points.length; i++)
        this.m_points[i] = a.ReflectPoint(this.m_points[i]!);

      for (const arc of this.m_arcs) arc.Mirror(a);

      return;
    }

    for (const pt of this.m_points) {
      if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) pt.x = -pt.x + 2 * a.x;
      else pt.y = -pt.y + 2 * a.y;
    }

    for (const arc of this.m_arcs) arc.Mirror(a, aFlipDirection!);
  }

  /**
   * Rotate all vertices by a given angle.
   *
   * @param aCenter is the rotation center.
   * @param aAngle is the rotation angle.
   */
  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    for (let i = 0; i < this.m_points.length; i++)
      this.m_points[i] = RotatePoint(this.m_points[i]!, aCenter, aAngle);

    for (const arc of this.m_arcs) arc.Rotate(aAngle, aCenter);
  }

  IsSolid(): boolean {
    return false;
  }

  PointAlong(aPathLength: number): VECTOR2I {
    let total = 0;

    if (aPathLength === 0) return this.CPoint(0);

    for (let i = 0; i < this.SegmentCount(); i++) {
      const s = this.CSegment(i);
      const l = s.Length();

      if (total + l >= aPathLength) {
        const d = { x: s.B.x - s.A.x, y: s.B.y - s.A.y };
        const r = ResizeI(d, aPathLength - total);
        return { x: s.A.x + r.x, y: s.A.y + r.y };
      }

      total += l;
    }

    return this.CLastPoint();
  }

  Area(aAbsolute = true): number {
    // see https://www.mathopenref.com/coordpolygonarea2.html

    if (!this.m_closed) return 0.0;

    let area = 0.0;
    const size = this.m_points.length;

    for (let i = 0, j = size - 1; i < size; ++i) {
      area +=
        (this.m_points[j]!.x + this.m_points[i]!.x) * (this.m_points[j]!.y - this.m_points[i]!.y);
      j = i;
    }

    if (aAbsolute) return Math.abs(area * 0.5); // The result would be negative if points are anti-clockwise
    return -area * 0.5; // The result would be negative if points are anti-clockwise
  }

  /**
   * Creates line chains \a aLeft and \a aRight offset to this line chain.
   *
   * @param aAmount is the amount to offset by.
   * @param aCornerStrategy is the strategy to use for corners.
   * @param aMaxError is the maximum error to allow for the offset.
   * @param aLeft is the left line chain.
   * @param aRight is the right line chain.
   * @param aSimplify is true to simplify the line chains.
   * @return true if the offset was successful.
   */
  OffsetLine(
    aAmount: number,
    aCornerStrategy: CornerStrategy,
    aMaxError: number,
    aLeft: SHAPE_LINE_CHAIN,
    aRight: SHAPE_LINE_CHAIN,
    aSimplify = false,
  ): boolean {
    if (this.PointCount() < 2) return false;

    const poly = new SHAPE_POLY_SET();
    poly.OffsetLineChain(this, aAmount, aCornerStrategy, aMaxError, aSimplify);

    if (poly.OutlineCount() !== 1) return false;

    if (poly.COutline(0).PointCount() < 3) return false;

    if (poly.HasHoles()) return false;

    const outline = poly.COutline(0);

    // wxASSERT( outline.IsClosed() );

    const start = this.CPoint(0);
    const end = this.CLastPoint();

    outline.Split(start, true);
    outline.Split(end, true);

    const idA = outline.Find(start);
    const idB = outline.Find(end);

    if (idA === -1 || idB === -1) return false;

    aLeft.Clear();
    aRight.Clear();

    for (let i = idA; ; ) {
      aLeft.Append(outline.CPoint(i));

      i = (i + 1) % outline.PointCount();

      if (i === idB) {
        aLeft.Append(outline.CPoint(i));
        break;
      }

      if (i === idA) return false;
    }

    if (aLeft.PointCount() < 2) return false;

    for (let i = idB; ; ) {
      aRight.Append(outline.CPoint(i));

      i = (i + 1) % outline.PointCount();

      if (i === idA) {
        aRight.Append(outline.CPoint(i));
        break;
      }

      if (i === idB) return false;
    }

    if (aRight.PointCount() < 2) return false;

    if (!samePoint(aLeft.CPoint(0), start)) {
      aLeft.assign(aLeft.Reverse());
      // wxASSERT( aLeft.CPoint( 0 ) == start );
    }

    if (!samePoint(aRight.CPoint(0), start)) {
      aRight.assign(aRight.Reverse());
      // wxASSERT( aRight.CPoint( 0 ) == start );
    }

    const base = new SEG(this.CPoint(0), this.CPoint(1));
    const sideLeft = base.Side(aLeft.CPoint(1));
    const sideRight = base.Side(aRight.CPoint(1));

    if (sideLeft === 0 || sideRight === 0) return false;

    if (sideLeft === sideRight) return false;

    if (sideLeft > 0 && sideRight < 0) {
      const t = new SHAPE_LINE_CHAIN(aLeft);
      aLeft.assign(aRight);
      aRight.assign(t);
    }

    if (aLeft.PointCount() < 4) return false;

    if (aRight.PointCount() < 4) return false;

    aLeft.Remove(0);
    aLeft.Remove(aLeft.PointCount() - 1);

    aRight.Remove(0);
    aRight.Remove(aRight.PointCount() - 1);

    return true;
  }

  ArcCount(): number {
    return this.m_arcs.length;
  }

  /**
   * Return the arc index for the given segment index.
   */
  ArcIndex(aSegment: number): number {
    if (this.IsSharedPt(aSegment)) return this.m_shapes[aSegment]![1];
    return this.m_shapes[aSegment]![0];
  }

  Arc(aArc: number): SHAPE_ARC {
    return this.m_arcs[aArc]!;
  }

  /**
   * Test if a point is shared between multiple shapes
   */
  IsSharedPt(aIndex: number): boolean {
    return (
      aIndex < this.m_shapes.length &&
      this.m_shapes[aIndex]![0] !== SHAPE_LINE_CHAIN.SHAPE_IS_PT &&
      this.m_shapes[aIndex]![1] !== SHAPE_LINE_CHAIN.SHAPE_IS_PT
    );
  }

  IsPtOnArc(aPtIndex: number): boolean {
    return (
      aPtIndex < this.m_shapes.length &&
      !samePair(this.m_shapes[aPtIndex]!, SHAPE_LINE_CHAIN.SHAPES_ARE_PT())
    );
  }

  IsArcSegment(aSegment: number): boolean {
    /*
     * A segment is part of an arc except in the special case of two arcs next to each other
     * but without a shared vertex.  Here there is a segment between the end of the first arc
     * and the start of the second arc.
     */
    let nextIdx = aSegment + 1;

    if (nextIdx > this.m_shapes.length - 1) {
      if (nextIdx === this.m_shapes.length && this.m_closed && this.IsSharedPt(0))
        nextIdx = 0; // segment between end point and first point
      else return false;
    }

    return this.IsPtOnArc(aSegment) && this.ArcIndex(aSegment) === this.m_shapes[nextIdx]![0];
  }

  IsArcStart(aIndex: number): boolean {
    if (!this.IsArcSegment(aIndex)) return false; // also does bound checking

    if (this.IsSharedPt(aIndex)) return true;

    const arc = this.Arc(this.ArcIndex(aIndex));

    return samePoint(arc.GetP0(), this.m_points[aIndex]!);
  }

  IsArcEnd(aIndex: number): boolean {
    let prevIndex = aIndex - 1;

    if (aIndex === 0) prevIndex = this.m_points.length - 1;
    else if (aIndex > this.m_points.length - 1) return false; // invalid index requested

    if (!this.IsArcSegment(prevIndex)) return false;

    if (this.IsSharedPt(aIndex)) return true;

    const arc = this.Arc(this.ArcIndex(aIndex));

    return samePoint(arc.GetP1(), this.m_points[aIndex]!);
  }

  /** `Distance( aP, aOutlineOnly )`. */
  DistanceOutline(aP: Vec2, aOutlineOnly: boolean): number {
    return Math.trunc(Math.sqrt(this.SquaredDistance(aP, aOutlineOnly)));
  }

  GetPoint(aIndex: number): VECTOR2I {
    return this.CPoint(aIndex);
  }
  GetSegment(aIndex: number): SEG {
    return this.CSegment(aIndex);
  }
  GetPointCount(): number {
    return this.PointCount();
  }
  GetSegmentCount(): number {
    return this.SegmentCount();
  }

  override TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {
    aBuffer.AddOutline(this);
  }
}

function cloneIntersection(is: INTERSECTION): INTERSECTION {
  const c = new INTERSECTION();
  c.p = { x: is.p.x, y: is.p.y };
  c.index_our = is.index_our;
  c.index_their = is.index_their;
  c.is_corner_our = is.is_corner_our;
  c.is_corner_their = is.is_corner_their;
  c.valid = is.valid;
  return c;
}

/**
 * `SHAPE_LINE_CHAIN::POINT_INSIDE_TRACKER`: an incremental point-in-polygon
 * test over polylines fed one at a time.
 */
export class POINT_INSIDE_TRACKER {
  private m_point: VECTOR2I;
  private m_lastPoint: VECTOR2I = { x: 0, y: 0 };
  private m_firstPoint: VECTOR2I = { x: 0, y: 0 };
  private m_finished: boolean;
  private m_state: number;
  private m_count: number;

  constructor(aPoint: Vec2) {
    this.m_point = { x: aPoint.x, y: aPoint.y };
    this.m_finished = false;
    this.m_state = 0;
    this.m_count = 0;
  }

  private processVertex(ip: VECTOR2I, ipNext: VECTOR2I): boolean {
    if (ipNext.y === this.m_point.y) {
      if (
        ipNext.x === this.m_point.x ||
        (ip.y === this.m_point.y && ipNext.x > this.m_point.x === ip.x < this.m_point.x)
      ) {
        this.m_finished = true;
        this.m_state = -1;
        return false;
      }
    }

    if (ip.y < this.m_point.y !== ipNext.y < this.m_point.y) {
      if (ip.x >= this.m_point.x) {
        if (ipNext.x > this.m_point.x) {
          this.m_state = 1 - this.m_state;
        } else {
          const d =
            (ip.x - this.m_point.x) * (ipNext.y - this.m_point.y) -
            (ipNext.x - this.m_point.x) * (ip.y - this.m_point.y);

          if (!d) {
            this.m_finished = true;
            this.m_state = -1;
            return false;
          }

          if (d > 0 === ipNext.y > ip.y) this.m_state = 1 - this.m_state;
        }
      } else {
        if (ipNext.x > this.m_point.x) {
          const d =
            (ip.x - this.m_point.x) * (ipNext.y - this.m_point.y) -
            (ipNext.x - this.m_point.x) * (ip.y - this.m_point.y);

          if (!d) {
            this.m_finished = true;
            this.m_state = -1;
            return false;
          }

          if (d > 0 === ipNext.y > ip.y) this.m_state = 1 - this.m_state;
        }
      }
    }

    return true;
  }

  AddPolyline(aPolyline: SHAPE_LINE_CHAIN): void {
    if (!this.m_count) {
      this.m_lastPoint = aPolyline.CPoint(0);
      this.m_firstPoint = aPolyline.CPoint(0);
    }

    this.m_count += aPolyline.PointCount();

    for (let i = 1; i < aPolyline.PointCount(); i++) {
      const p = aPolyline.CPoint(i);

      if (!this.processVertex(this.m_lastPoint, p)) return;

      this.m_lastPoint = p;
    }
  }

  IsInside(): boolean {
    this.processVertex(this.m_lastPoint, this.m_firstPoint);
    return this.m_state > 0;
  }
}

/**
 * `SHAPE_LINE_CHAIN::Simplify( int aTolerance )` over a bare point list.
 *
 * `ZONE_CREATE_HELPER::OnComplete` calls this as `chain.Simplify( true )`, the
 * `bool` converting to a tolerance of 1 IU.
 *
 * @deprecated build a `SHAPE_LINE_CHAIN` and call `Simplify`.
 */
export function simplifyLineChain(points: readonly Vec2[], closed: boolean, tolerance = 0): Vec2[] {
  const c = new SHAPE_LINE_CHAIN(points as Vec2[], closed);
  c.Simplify(tolerance);
  return c.CPoints().map((p) => ({ x: p.x, y: p.y }));
}
