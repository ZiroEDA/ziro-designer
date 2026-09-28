// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_creepage_utils.h` / `.cpp`: the creepage graph - the
 * shapes (board-edge points, circles and arcs; copper segments, circles and
 * arcs), the straight paths between every pair, the nodes and connections,
 * and the Dijkstra that finds the shortest surface path between two nets.
 *
 * The C++ dispatches `Paths( const X& )` by overload; here each shape class
 * has one `pathsTo( aS2, ... )` that switches on `aS2`'s class and calls the
 * named method for that pair.
 *
 * Integer / double: `PATH_CONNECTION::a1/a2` are VECTOR2D, most shape data is
 * VECTOR2I. `VECTOR2I::Resize( double )` truncates its length to int first;
 * `resizeI` here does the same.
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { type PCB_LAYER_ID, PCB_LAYER_ID as LAYER } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_0,
  ANGLE_360,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { INTERSECTION_VISITOR } from '@ziroeda/kimath/src/geometry/intersection.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { type SHAPE, SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import type { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import type { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import {
  add,
  divideI,
  EuclideanNorm,
  equal,
  Perpendicular,
  ResizeD,
  ResizeI,
  SquaredEuclideanNorm,
  sub,
  type Vec2,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { ptrGreater, ptrOrdinal } from './ptr_order.js';

/** `VECTOR2I::Resize( T )`: the C++ takes the length as an int. */
const resizeI = (v: VECTOR2I, aNewLength: number): VECTOR2I => ResizeI(v, Math.trunc(aNewLength));

const dAdd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const dSub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dMul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dNorm = (a: Vec2): number => Math.hypot(a.x, a.y);
const dSqNorm = (a: Vec2): number => a.x * a.x + a.y * a.y;
/** `VECTOR2I( VECTOR2D )`: the conversion truncates. */
/**
 * `VECTOR2I( VECTOR2D )`: std::clamp to the int range, then static_cast. A NaN
 * (two overlapping board-edge circles put an arc end inside the other cap, and
 * the tangent maths takes sqrt of a negative) fails both clamp comparisons and
 * the cast yields INT_MIN on x86 - a path the validator then rejects, exactly
 * as KiCad's does. Reproduce that rather than let BigInt() throw on the NaN.
 */
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const castI = (v: number): number =>
  Number.isNaN(v) ? INT_MIN : Math.trunc(Math.min(Math.max(v, INT_MIN), INT_MAX));
const toI = (a: Vec2): VECTOR2I => ({ x: castI(a.x), y: castI(a.y) });
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const vLt = (a: VECTOR2I, b: VECTOR2I): boolean => {
  // VECTOR2<T>::operator< compares the squared norms
  return dSqNorm(a) < dSqNorm(b);
};

// Simple wrapper for track segment data in the RTree
export interface CREEPAGE_TRACK_ENTRY {
  segment: SEG;
  layer: PCB_LAYER_ID;
}

export type TRACK_RTREE = RTree<CREEPAGE_TRACK_ENTRY>;

export function segmentIntersectsArc(
  p1: VECTOR2I,
  p2: VECTOR2I,
  center: VECTOR2I,
  radius: number,
  startAngle: EDA_ANGLE,
  endAngle: EDA_ANGLE,
  aIntersectionPoints: VECTOR2I[] | null = null,
): boolean {
  const segment = new SEG(p1, p2);
  const startPoint: VECTOR2I = {
    x: Math.trunc(radius * Math.cos(startAngle.AsRadians())),
    y: Math.trunc(radius * Math.sin(startAngle.AsRadians())),
  };
  const arc = new SHAPE_ARC(center, add(startPoint, center), endAngle.sub(startAngle));

  const rawPoints: VECTOR2I[] = [];
  const visitor = new INTERSECTION_VISITOR(arc, rawPoints);
  visitor.visit(segment);

  // A path is allowed to end on the arc, so an intersection at either endpoint is a touch,
  // not a crossing. Only interior crossings count. Tolerance absorbs solver rounding.
  const filtered: VECTOR2I[] = [];

  const tolerance = 50;
  const toleranceSq = tolerance * tolerance;

  const coincident = (a: VECTOR2I, b: VECTOR2I): boolean =>
    SquaredEuclideanNorm(sub(a, b)) <= toleranceSq;

  for (const ip of rawPoints) {
    if (!coincident(ip, p1) && !coincident(ip, p2)) filtered.push(ip);
  }

  if (aIntersectionPoints) {
    for (const ip of filtered) aIntersectionPoints.push(ip);
  }

  return filtered.length > 0;
}

//Check if line segments 'p1q1' and 'p2q2' intersect, excluding endpoint overlap

export function segments_intersect(
  p1: VECTOR2I,
  q1: VECTOR2I,
  p2: VECTOR2I,
  q2: VECTOR2I,
  aIntersectionPoints: VECTOR2I[],
): boolean {
  if (equal(p1, p2) || equal(p1, q2) || equal(q1, p2) || equal(q1, q2)) return false;

  const segment1 = new SEG(p1, q1);
  const segment2 = new SEG(p2, q2);

  const startCount = aIntersectionPoints.length;

  const visitor = new INTERSECTION_VISITOR(segment2, aIntersectionPoints);
  visitor.visit(segment1);

  return aIntersectionPoints.length > startCount;
}

export class PATH_CONNECTION {
  a1: Vec2 = { x: 0, y: 0 };
  a2: Vec2 = { x: 0, y: 0 };
  weight = -1;
  m_show = true;

  m_forceA1concavityCheck = false;
  m_forceA2concavityCheck = false;

  clone(): PATH_CONNECTION {
    const pc = new PATH_CONNECTION();
    pc.a1 = { x: this.a1.x, y: this.a1.y };
    pc.a2 = { x: this.a2.x, y: this.a2.y };
    pc.weight = this.weight;
    pc.m_show = this.m_show;
    pc.m_forceA1concavityCheck = this.m_forceA1concavityCheck;
    pc.m_forceA2concavityCheck = this.m_forceA2concavityCheck;
    return pc;
  }

  /** @brief Test if a path is valid
   *
   * Check if a paths intersects the board edge or a track
   *
   * @param aBoard The board (used as fallback if no track index provided)
   * @param aLayer The layer to check
   * @param aBoardEdges Board edge items
   * @param aIgnoreForTest Items to ignore in intersection tests
   * @param aOutline Board outline polygon
   * @param aTestLocalConcavity Concavity test flags
   * @param aMinGrooveWidth Minimum groove width
   * @param aTrackIndex Optional spatial index for tracks (if nullptr, falls back to linear search)
   */
  isValid(
    aBoard: BOARD,
    aLayer: PCB_LAYER_ID,
    aBoardEdges: readonly BOARD_ITEM[],
    aIgnoreForTest: readonly BOARD_ITEM[],
    aOutline: SHAPE_POLY_SET | null,
    _aTestLocalConcavity: [boolean, boolean],
    aMinGrooveWidth: number,
    aTrackIndex: TRACK_RTREE | null = null,
  ): boolean {
    if (!aOutline) return true; // We keep the segment if there is a problem

    if (
      !SegmentIntersectsBoard(
        toI(this.a1),
        toI(this.a2),
        aBoardEdges,
        aIgnoreForTest,
        aMinGrooveWidth,
      )
    )
      return false;

    // The mid point should be inside the board.
    // Tolerance of 100nm.
    const midPoint = toI(dMul(dAdd(this.a1, this.a2), 0.5));
    const tolerance = 100;

    const contained =
      aOutline.Contains(midPoint, -1, tolerance) || aOutline.PointOnEdge(midPoint, tolerance);

    if (!contained) return false;

    // if( false && ( aTestLocalConcavity.first || aTestLocalConcavity.second ) ) { ... }: compiled out.

    if (aLayer !== LAYER.Edge_Cuts) {
      const segPath = new SEG(toI(this.a1), toI(this.a2));

      // Prefer RTree search if available
      if (aTrackIndex) {
        // Calculate bounding box of the path segment
        const minX = Math.min(Math.trunc(this.a1.x), Math.trunc(this.a2.x));
        const minY = Math.min(Math.trunc(this.a1.y), Math.trunc(this.a2.y));
        const maxX = Math.max(Math.trunc(this.a1.x), Math.trunc(this.a2.x));
        const maxY = Math.max(Math.trunc(this.a1.y), Math.trunc(this.a2.y));

        let intersects = false;

        aTrackIndex.Search([minX, minY], [maxX, maxY], (entry: CREEPAGE_TRACK_ENTRY): boolean => {
          if (entry && entry.layer === aLayer) {
            if (segPath.Intersects(entry.segment)) {
              intersects = true;
              return false; // Stop searching
            }
          }
          return true; // Continue searching
        });

        if (intersects) return false;
      } else {
        // Fallback to linear search if no index provided
        for (const track of aBoard.Tracks()) {
          if (!track) continue;

          if (track.Type() === KICAD_T.PCB_TRACE_T && track.IsOnLayer(aLayer)) {
            const sh: SHAPE | null = track.GetEffectiveShape();

            if (sh && sh.Type() === SHAPE_TYPE.SH_SEGMENT) {
              const segTrack = new SEG(track.GetStart(), track.GetEnd());

              if (segPath.Intersects(segTrack)) return false;
            }
          }
        }
      }
    }

    return true;
  }
}

export enum CREEP_SHAPE_TYPE {
  UNDEFINED = 0,
  POINT,
  CIRCLE,
  ARC,
}

/** @class CREEP_SHAPE
 *
 *  @brief A class used to represent the shapes for creepage calculation
 */
export abstract class CREEP_SHAPE {
  protected m_conductive = false;
  protected m_parent: BOARD_ITEM | null = null;
  protected m_pos: VECTOR2I = { x: 0, y: 0 };
  protected m_type: CREEP_SHAPE_TYPE = CREEP_SHAPE_TYPE.UNDEFINED;

  GetRadius(): number {
    return 0;
  }
  GetStartAngle(): EDA_ANGLE {
    return new EDA_ANGLE(0);
  }
  GetEndAngle(): EDA_ANGLE {
    return new EDA_ANGLE(0);
  }
  GetStartPoint(): VECTOR2I {
    return { x: 0, y: 0 };
  }
  GetEndPoint(): VECTOR2I {
    return { x: 0, y: 0 };
  }
  GetPos(): VECTOR2I {
    return this.m_pos;
  }
  GetType(): CREEP_SHAPE_TYPE {
    return this.m_type;
  }
  GetParent(): BOARD_ITEM | null {
    return this.m_parent;
  }
  SetParent(aParent: BOARD_ITEM | null): void {
    this.m_parent = aParent;
  }

  ConnectChildren(_a1: GRAPH_NODE, _a2: GRAPH_NODE, _aG: CREEPAGE_GRAPH): void {}

  ReversePaths(aV: readonly PATH_CONNECTION[]): PATH_CONNECTION[] {
    const r: PATH_CONNECTION[] = [];

    for (const pc of aV) {
      const c = pc.clone();
      [c.a1, c.a2] = [c.a2, c.a1];
      r.push(c);
    }

    return r;
  }

  /** `Paths( const CREEP_SHAPE& )`: the base overload, which finds nothing. */
  PathsBase(_aS2: CREEP_SHAPE, _aMaxWeight: number, _aMaxSquaredWeight: number): PATH_CONNECTION[] {
    return [];
  }

  /** The overload set, dispatched on aS2's concrete class. */
  pathsTo(aS2: CREEP_SHAPE, aMaxWeight: number, aMaxSquaredWeight: number): PATH_CONNECTION[] {
    if (aS2 instanceof BE_SHAPE_ARC) return this.PathsToBeArc(aS2, aMaxWeight, aMaxSquaredWeight);
    if (aS2 instanceof BE_SHAPE_CIRCLE)
      return this.PathsToBeCircle(aS2, aMaxWeight, aMaxSquaredWeight);
    if (aS2 instanceof BE_SHAPE_POINT)
      return this.PathsToBePoint(aS2, aMaxWeight, aMaxSquaredWeight);
    if (aS2 instanceof CU_SHAPE_SEGMENT)
      return this.PathsToCuSegment(aS2, aMaxWeight, aMaxSquaredWeight);
    if (aS2 instanceof CU_SHAPE_ARC) return this.PathsToCuArc(aS2, aMaxWeight, aMaxSquaredWeight);
    if (aS2 instanceof CU_SHAPE_CIRCLE)
      return this.PathsToCuCircle(aS2, aMaxWeight, aMaxSquaredWeight);
    return this.PathsBase(aS2, aMaxWeight, aMaxSquaredWeight);
  }

  PathsToBePoint(
    _aS2: BE_SHAPE_POINT,
    _aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return [];
  }
  PathsToBeCircle(
    _aS2: BE_SHAPE_CIRCLE,
    _aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return [];
  }
  PathsToBeArc(
    _aS2: BE_SHAPE_ARC,
    _aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return [];
  }
  PathsToCuSegment(
    _aS2: CU_SHAPE_SEGMENT,
    _aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return [];
  }
  PathsToCuCircle(
    _aS2: CU_SHAPE_CIRCLE,
    _aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return [];
  }
  PathsToCuArc(
    _aS2: CU_SHAPE_ARC,
    _aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return [];
  }

  IsConductive(): boolean {
    return this.m_conductive;
  }
}

/** @class CU_SHAPE
 *
 *  @brief Creepage: a conductive shape
 */
export abstract class CU_SHAPE extends CREEP_SHAPE {
  constructor() {
    super();
    this.m_conductive = true;
  }
}

/** @class BE_SHAPE
 *
 *  @brief Creepage: a board edge shape
 */
export abstract class BE_SHAPE extends CREEP_SHAPE {
  constructor() {
    super();
    this.m_conductive = false;
  }
}

/** @class CU_SHAPE_SEGMENT
 *
 *  @brief Creepage: a conductive segment
 */
export class CU_SHAPE_SEGMENT extends CU_SHAPE {
  private m_start: VECTOR2I = { x: 0, y: 0 };
  private m_end: VECTOR2I = { x: 0, y: 0 };
  private m_width = 0;

  constructor(aStart: VECTOR2I, aEnd: VECTOR2I, aWidth = 0) {
    super();
    this.m_start = aStart;
    this.m_end = aEnd;
    this.m_width = aWidth;
    this.m_pos = divideI(add(aStart, aEnd), 2);
  }

  GetStart(): VECTOR2I {
    return this.m_start;
  }
  GetEnd(): VECTOR2I {
    return this.m_end;
  }
  GetWidth(): number {
    return this.m_width;
  }

  override GetRadius(): number {
    return (
      Math.trunc(EuclideanNorm(sub(this.m_start, this.m_end)) / 2) + Math.trunc(this.m_width / 2)
    );
  }

  override PathsToBePoint(
    aS2: BE_SHAPE_POINT,
    _aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const start = this.GetStart();
    const end = this.GetEnd();
    const halfWidth = this.GetWidth() / 2;
    const trackAngle = EDA_ANGLE.fromVector(sub(end, start));
    const pointPos = aS2.GetPos();

    const length = EuclideanNorm(sub(start, end));
    const projectedPos =
      Math.cos(trackAngle.AsRadians()) * (pointPos.x - start.x) +
      Math.sin(trackAngle.AsRadians()) * (pointPos.y - start.y);

    let newPoint: VECTOR2I;

    if (projectedPos <= 0) {
      newPoint = add(start, resizeI(sub(pointPos, start), halfWidth));
    } else if (projectedPos >= length) {
      newPoint = add(end, resizeI(sub(pointPos, end), halfWidth));
    } else {
      let posOnSegment =
        SquaredEuclideanNorm(sub(start, pointPos)) - SquaredEuclideanNorm(sub(end, pointPos));
      posOnSegment = posOnSegment / (2 * length) + length / 2;

      newPoint = add(start, resizeI(sub(end, start), posOnSegment));
      newPoint = add(newPoint, resizeI(sub(pointPos, newPoint), halfWidth));
    }

    const weightSquared = SquaredEuclideanNorm(sub(pointPos, newPoint));

    if (weightSquared > aMaxSquaredWeight) return result;

    const pc = new PATH_CONNECTION();
    pc.a1 = newPoint;
    pc.a2 = pointPos;
    pc.weight = Math.sqrt(weightSquared);

    result.push(pc);
    return result;
  }

  override PathsToBeCircle(
    aS2: BE_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const start = this.GetStart();
    const end = this.GetEnd();
    const halfWidth = this.GetWidth() / 2;

    const circleRadius = aS2.GetRadius();
    const circleCenter = aS2.GetPos();
    const length = EuclideanNorm(sub(start, end));
    const trackAngle = EDA_ANGLE.fromVector(sub(end, start));

    let weightSquared = Number.POSITIVE_INFINITY;
    let PointOnTrack: VECTOR2I;
    let PointOnCircle: VECTOR2I;

    // There are two possible paths
    // First the one on the side of the start of the track.
    let projectedPos1 =
      Math.cos(trackAngle.AsRadians()) * (circleCenter.x - start.x) +
      Math.sin(trackAngle.AsRadians()) * (circleCenter.y - start.y);
    const projectedPos2 = projectedPos1 + circleRadius;
    projectedPos1 = projectedPos1 - circleRadius;

    const trackSide = cross(sub(end, start), sub(circleCenter, start)) > 0 ? 1 : -1;

    if (projectedPos1 < 0 && projectedPos2 < 0) {
      const csc = new CU_SHAPE_CIRCLE(start, halfWidth);
      for (const pc of csc.PathsToBeCircle(aS2, aMaxWeight, aMaxSquaredWeight)) {
        result.push(pc);
      }
    } else if (projectedPos1 > length && projectedPos2 > length) {
      const csc = new CU_SHAPE_CIRCLE(end, halfWidth);

      for (const pc of csc.PathsToBeCircle(aS2, aMaxWeight, aMaxSquaredWeight)) result.push(pc);
    } else if (
      projectedPos1 >= 0 &&
      projectedPos1 <= length &&
      projectedPos2 >= 0 &&
      projectedPos2 <= length
    ) {
      // Both point connects to the segment part of the track
      PointOnTrack = start;
      PointOnTrack = add(PointOnTrack, resizeI(sub(end, start), projectedPos1));
      PointOnTrack = add(
        PointOnTrack,
        scaleI(resizeI(Perpendicular(sub(end, start)), halfWidth), trackSide),
      );
      PointOnCircle = sub(circleCenter, resizeI(sub(end, start), circleRadius));
      weightSquared = SquaredEuclideanNorm(sub(PointOnCircle, PointOnTrack));

      if (weightSquared < aMaxSquaredWeight) {
        const pc = new PATH_CONNECTION();
        pc.a1 = PointOnTrack;
        pc.a2 = PointOnCircle;
        pc.weight = Math.sqrt(weightSquared);

        result.push(pc);

        PointOnTrack = start;
        PointOnTrack = add(PointOnTrack, resizeI(sub(end, start), projectedPos2));
        PointOnTrack = add(
          PointOnTrack,
          scaleI(resizeI(Perpendicular(sub(end, start)), halfWidth), trackSide),
        );
        PointOnCircle = add(circleCenter, resizeI(sub(end, start), circleRadius));

        const pc2 = pc.clone();
        pc2.a1 = PointOnTrack;
        pc2.a2 = PointOnCircle;

        result.push(pc2);
      }
    } else if (
      projectedPos1 >= 0 &&
      projectedPos1 <= length &&
      (projectedPos2 > length || projectedPos2 < 0)
    ) {
      const csc = new CU_SHAPE_CIRCLE(end, halfWidth);
      const pcs = csc.PathsToBeCircle(aS2, aMaxWeight, aMaxSquaredWeight);

      if (pcs.length < 2) return result;

      result.push(pcs[trackSide === 1 ? 1 : 0]!);

      PointOnTrack = start;
      PointOnTrack = add(PointOnTrack, resizeI(sub(end, start), projectedPos1));
      PointOnTrack = add(
        PointOnTrack,
        scaleI(resizeI(Perpendicular(sub(end, start)), halfWidth), trackSide),
      );
      PointOnCircle = sub(circleCenter, resizeI(sub(end, start), circleRadius));
      weightSquared = SquaredEuclideanNorm(sub(PointOnCircle, PointOnTrack));

      if (weightSquared < aMaxSquaredWeight) {
        const pc = new PATH_CONNECTION();
        pc.a1 = PointOnTrack;
        pc.a2 = PointOnCircle;
        pc.weight = Math.sqrt(weightSquared);

        result.push(pc);
      }
    } else if (
      projectedPos2 >= 0 &&
      projectedPos2 <= length &&
      (projectedPos1 > length || projectedPos1 < 0)
    ) {
      const csc = new CU_SHAPE_CIRCLE(start, halfWidth);
      const pcs = csc.PathsToBeCircle(aS2, aMaxWeight, aMaxSquaredWeight);

      if (pcs.length < 2) return result;

      result.push(pcs[trackSide === 1 ? 0 : 1]!);

      PointOnTrack = start;
      PointOnTrack = add(PointOnTrack, resizeI(sub(end, start), projectedPos2));
      PointOnTrack = add(
        PointOnTrack,
        scaleI(resizeI(Perpendicular(sub(end, start)), halfWidth), trackSide),
      );
      PointOnCircle = add(circleCenter, resizeI(sub(end, start), circleRadius));
      weightSquared = SquaredEuclideanNorm(sub(PointOnCircle, PointOnTrack));

      if (weightSquared < aMaxSquaredWeight) {
        const pc = new PATH_CONNECTION();
        pc.a1 = PointOnTrack;
        pc.a2 = PointOnCircle;
        pc.weight = Math.sqrt(weightSquared);

        result.push(pc);
      }
    }

    return result;
  }

  override PathsToBeArc(
    aS2: BE_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const bsc = new BE_SHAPE_CIRCLE(aS2.GetPos(), aS2.GetRadius());

    for (const pc of this.PathsToBeCircle(bsc, aMaxWeight, aMaxSquaredWeight)) {
      const testAngle = aS2.AngleBetweenStartAndEnd(toI(pc.a2));

      if (testAngle.lt(aS2.GetEndAngle())) result.push(pc);
    }

    if (result.length < 2) {
      const bsp1 = new BE_SHAPE_POINT(aS2.GetStartPoint());
      const bsp2 = new BE_SHAPE_POINT(aS2.GetEndPoint());

      const beArcPos = aS2.GetPos();
      const beArcRadius = aS2.GetRadius();
      const beArcStartAngle = aS2.GetStartAngle();
      const beArcEndAngle = aS2.GetEndAngle();

      for (const pc of this.PathsToBePoint(bsp1, aMaxWeight, aMaxSquaredWeight)) {
        if (
          !segmentIntersectsArc(
            toI(pc.a1),
            toI(pc.a2),
            beArcPos,
            beArcRadius,
            beArcStartAngle,
            beArcEndAngle,
          )
        )
          result.push(pc);
      }

      for (const pc of this.PathsToBePoint(bsp2, aMaxWeight, aMaxSquaredWeight)) {
        if (
          !segmentIntersectsArc(
            toI(pc.a1),
            toI(pc.a2),
            beArcPos,
            beArcRadius,
            beArcStartAngle,
            beArcEndAngle,
          )
        )
          result.push(pc);
      }
    }

    return result;
  }

  override PathsToCuCircle(
    aS2: CU_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const s_start = this.GetStart();
    const s_end = this.GetEnd();
    const halfWidth = this.GetWidth() / 2;

    const trackAngle = EDA_ANGLE.fromVector(sub(s_end, s_start));
    const pointPos = aS2.GetPos();

    const length = EuclideanNorm(sub(s_start, s_end));
    const projectedPos =
      Math.cos(trackAngle.AsRadians()) * (pointPos.x - s_start.x) +
      Math.sin(trackAngle.AsRadians()) * (pointPos.y - s_start.y);

    if (projectedPos <= 0 || equal(s_start, s_end)) {
      const csc = new CU_SHAPE_CIRCLE(s_start, halfWidth);
      return csc.PathsToCuCircle(aS2, aMaxWeight, aMaxSquaredWeight);
    }

    if (projectedPos >= length) {
      const csc = new CU_SHAPE_CIRCLE(s_end, halfWidth);
      return csc.PathsToCuCircle(aS2, aMaxWeight, aMaxSquaredWeight);
    }

    const radius = aS2.GetRadius();
    const trackSide = cross(sub(s_end, s_start), sub(pointPos, s_start)) > 0 ? 1 : -1;

    const pc = new PATH_CONNECTION();
    pc.a1 = add(
      add(s_start, resizeI(sub(s_end, s_start), projectedPos)),
      scaleI(resizeI(Perpendicular(sub(s_end, s_start)), halfWidth), trackSide),
    );
    pc.a2 = add(resizeI(sub(toI(pc.a1), pointPos), radius), pointPos);
    pc.weight = dSqNorm(dSub(pc.a2, pc.a1));

    if (pc.weight <= aMaxSquaredWeight) {
      pc.weight = Math.sqrt(pc.weight);
      result.push(pc);
    }

    return result;
  }

  override PathsToCuArc(
    aS2: CU_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const s_start = this.GetStart();
    const s_end = this.GetEnd();
    const halfWidth1 = this.GetWidth() / 2;

    const arcPos = aS2.GetPos();
    const arcRadius = aS2.GetRadius();
    const halfWidth2 = aS2.GetWidth() / 2;

    const csc = new CU_SHAPE_CIRCLE(arcPos, arcRadius + halfWidth2);

    const pcs = this.PathsToCuCircle(csc, aMaxWeight, aMaxSquaredWeight);

    if (pcs.length < 1) return result;

    let testAngle = new EDA_ANGLE(0);

    if (pcs.length > 0) {
      testAngle = aS2.AngleBetweenStartAndEnd(toI(pcs[0]!.a1));
    }

    if (testAngle.lt(aS2.GetEndAngle()) && pcs.length > 0) {
      result.push(pcs[0]!);
      return result;
    }

    const csc1 = new CU_SHAPE_CIRCLE(aS2.GetStartPoint(), halfWidth2);
    const csc2 = new CU_SHAPE_CIRCLE(aS2.GetEndPoint(), halfWidth2);
    let bestPath: PATH_CONNECTION | null = null;

    for (const pc of this.PathsToCuCircle(csc1, aMaxWeight, aMaxSquaredWeight)) {
      if (!bestPath || bestPath.weight > pc.weight) bestPath = pc;
    }

    for (const pc of this.PathsToCuCircle(csc2, aMaxWeight, aMaxSquaredWeight)) {
      if (!bestPath || bestPath.weight > pc.weight) bestPath = pc;
    }

    const csc3 = new CU_SHAPE_CIRCLE(s_start, halfWidth1);
    const csc4 = new CU_SHAPE_CIRCLE(s_end, halfWidth1);

    for (const pc of csc3.PathsToCuArc(aS2, aMaxWeight, aMaxSquaredWeight)) {
      if (!bestPath || bestPath.weight > pc.weight) bestPath = pc;
    }

    for (const pc of csc4.PathsToCuArc(aS2, aMaxWeight, aMaxSquaredWeight)) {
      if (!bestPath || bestPath.weight > pc.weight) bestPath = pc;
    }

    if (bestPath) result.push(bestPath);

    return result;
  }

  override PathsToCuSegment(
    aS2: CU_SHAPE_SEGMENT,
    aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const A = this.GetStart();
    const B = this.GetEnd();
    const halfWidth1 = this.GetWidth() / 2;

    const C = aS2.GetStart();
    const D = aS2.GetEnd();
    const halfWidth2 = aS2.GetWidth() / 2;

    const P1 = closestPointOnSegment(A, B, C);
    const P2 = closestPointOnSegment(A, B, D);
    const P3 = closestPointOnSegment(C, D, A);
    const P4 = closestPointOnSegment(C, D, B);

    // Calculate all possible squared distances between the segments
    const dist1 = SquaredEuclideanNorm(sub(P1, C));
    const dist2 = SquaredEuclideanNorm(sub(P2, D));
    const dist3 = SquaredEuclideanNorm(sub(P3, A));
    const dist4 = SquaredEuclideanNorm(sub(P4, B));

    // Find the minimum squared distance and update closest points
    let min_dist = dist1;
    let closest1 = P1;
    let closest2 = C;

    if (dist2 < min_dist) {
      min_dist = dist2;
      closest1 = P2;
      closest2 = D;
    }

    if (dist3 < min_dist) {
      min_dist = dist3;
      closest1 = A;
      closest2 = P3;
    }

    if (dist4 < min_dist) {
      min_dist = dist4;
      closest1 = B;
      closest2 = P4;
    }

    const pc = new PATH_CONNECTION();
    pc.a1 = add(closest1, resizeI(sub(closest2, closest1), halfWidth1));
    pc.a2 = add(closest2, resizeI(sub(closest1, closest2), halfWidth2));
    pc.weight = Math.max(Math.sqrt(min_dist) - halfWidth1 - halfWidth2, 0.0);

    if (pc.weight <= aMaxWeight) result.push(pc);

    return result;
  }
}

// Function to compute the projection of point P onto the line segment AB
function closestPointOnSegment(A: VECTOR2I, B: VECTOR2I, P: VECTOR2I): VECTOR2I {
  if (equal(A, B)) return A;
  if (equal(A, P)) return A;

  const AB = sub(B, A);
  const AP = sub(P, A);

  let t = Math.fround(AB.x * AP.x + AB.y * AP.y) / Math.fround(SquaredEuclideanNorm(AB));

  // Clamp t to the range [0, 1] to restrict the projection to the segment
  t = Math.max(0.0, Math.min(1.0, t));

  // A + ( AB * t ): VECTOR2I * double rounds
  return add(A, { x: KiROUND(AB.x * t), y: KiROUND(AB.y * t) });
}

/** @class CU_SHAPE_CIRCLE
 *
 *  @brief Creepage: a conductive circle
 */
export class CU_SHAPE_CIRCLE extends CU_SHAPE {
  protected m_radius = 1;

  constructor(aPos: VECTOR2I, aRadius = 0) {
    super();
    this.m_pos = aPos;
    this.m_radius = aRadius;
  }

  override GetRadius(): number {
    // int GetRadius() const override { return m_radius; }: the double truncates
    return Math.trunc(this.m_radius);
  }

  override PathsToBePoint(
    aS2: BE_SHAPE_POINT,
    aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const R = this.GetRadius();
    const center = this.GetPos();
    const point = aS2.GetPos();
    const weight = EuclideanNorm(sub(center, point)) - R;

    if (weight > aMaxWeight) return result;

    const pc = new PATH_CONNECTION();
    pc.weight = Math.max(weight, 0.0);
    pc.a2 = point;
    pc.a1 = add(center, resizeI(sub(point, center), R));

    result.push(pc);
    return result;
  }

  override PathsToBeCircle(
    aS2: BE_SHAPE_CIRCLE,
    aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const R1 = this.GetRadius();
    const R2 = aS2.GetRadius();
    const center1 = this.GetPos();
    const center2 = aS2.GetPos();
    const dist = EuclideanNorm(sub(center1, center2));

    if (dist > aMaxWeight || dist === 0) return result;

    const circleAngle = EDA_ANGLE.fromVector(sub(center2, center1)).AsRadians();

    if (dist <= R2) {
      // Copper circle center is inside the board-edge circle so external tangent lines
      // don't exist. The nearest gap is the radial distance between circle boundaries.
      const weight = Math.max(R2 - dist - R1, 0.0);

      if (weight > aMaxWeight) return result;

      const radialAngle = circleAngle + Math.PI;
      const cx = Math.cos(radialAngle);
      const cy = Math.sin(radialAngle);
      const pEnd = add(center2, { x: Math.trunc(R2 * cx), y: Math.trunc(R2 * cy) });
      const pStart = add(center1, { x: Math.trunc(R1 * cx), y: Math.trunc(R1 * cy) });

      const pc = new PATH_CONNECTION();
      pc.a1 = pStart;
      pc.a2 = pEnd;
      pc.weight = weight;

      // Callers expect two entries (one per tangent side) and select by index.
      result.push(pc);
      result.push(pc.clone());

      return result;
    }

    const weight = Math.sqrt(dist * dist - R2 * R2) - R1;
    const theta = Math.asin(R2 / dist);
    const psi = Math.acos(R2 / dist);

    if (weight > aMaxWeight) return result;

    const pc = new PATH_CONNECTION();
    pc.weight = Math.max(weight, 0.0);

    let pStart: VECTOR2I;
    let pEnd: VECTOR2I;

    pStart = {
      x: Math.trunc(R1 * Math.cos(theta + circleAngle)),
      y: Math.trunc(R1 * Math.sin(theta + circleAngle)),
    };
    pStart = add(pStart, center1);
    pEnd = {
      x: Math.trunc(-R2 * Math.cos(psi - circleAngle)),
      y: Math.trunc(R2 * Math.sin(psi - circleAngle)),
    };
    pEnd = add(pEnd, center2);

    pc.a1 = pStart;
    pc.a2 = pEnd;
    result.push(pc);

    pStart = {
      x: Math.trunc(R1 * Math.cos(-theta + circleAngle)),
      y: Math.trunc(R1 * Math.sin(-theta + circleAngle)),
    };
    pStart = add(pStart, center1);
    pEnd = {
      x: Math.trunc(-R2 * Math.cos(-psi - circleAngle)),
      y: Math.trunc(R2 * Math.sin(-psi - circleAngle)),
    };
    pEnd = add(pEnd, center2);

    const pc2 = pc.clone();
    pc2.a1 = pStart;
    pc2.a2 = pEnd;

    result.push(pc2);
    return result;
  }

  override PathsToBeArc(
    aS2: BE_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const beArcPos = aS2.GetPos();
    const beArcRadius = aS2.GetRadius();
    const beArcStartAngle = aS2.GetStartAngle();
    const beArcEndAngle = aS2.GetEndAngle();

    const bsc = new BE_SHAPE_CIRCLE(beArcPos, beArcRadius);

    for (const pc of this.PathsToBeCircle(bsc, aMaxWeight, aMaxSquaredWeight)) {
      const testAngle = aS2.AngleBetweenStartAndEnd(toI(pc.a2));

      if (testAngle.lt(aS2.GetEndAngle())) result.push(pc);
    }

    if (result.length < 2) {
      const bsp1 = new BE_SHAPE_POINT(aS2.GetStartPoint());
      const bsp2 = new BE_SHAPE_POINT(aS2.GetEndPoint());

      for (const pc of this.PathsToBePoint(bsp1, aMaxWeight, aMaxSquaredWeight)) {
        if (
          !segmentIntersectsArc(
            toI(pc.a1),
            toI(pc.a2),
            beArcPos,
            beArcRadius,
            beArcStartAngle,
            beArcEndAngle,
          )
        )
          result.push(pc);
      }

      for (const pc of this.PathsToBePoint(bsp2, aMaxWeight, aMaxSquaredWeight)) {
        if (
          !segmentIntersectsArc(
            toI(pc.a1),
            toI(pc.a2),
            beArcPos,
            beArcRadius,
            beArcStartAngle,
            beArcEndAngle,
          )
        )
          result.push(pc);
      }
    }
    return result;
  }

  override PathsToCuSegment(
    aS2: CU_SHAPE_SEGMENT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToCuCircle(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuCircle(
    aS2: CU_SHAPE_CIRCLE,
    aMaxWeight: number,
    _aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const R1 = this.GetRadius();
    const R2 = aS2.GetRadius();
    const C1 = this.GetPos();
    const C2 = aS2.GetPos();

    if (SquaredEuclideanNorm(sub(C1, C2)) < (R1 - R2) * (R1 - R2)) {
      // One of the circles is inside the other
      return result;
    }

    const weight = EuclideanNorm(sub(C1, C2)) - R1 - R2;

    if (weight > aMaxWeight || weight < 0) return result;

    const pc = new PATH_CONNECTION();
    pc.weight = Math.max(weight, 0.0);
    pc.a1 = add(resizeI(sub(C2, C1), R1), C1);
    pc.a2 = add(resizeI(sub(C1, C2), R2), C2);
    result.push(pc);
    return result;
  }

  override PathsToCuArc(
    aS2: CU_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const circlePos = this.GetPos();
    const arcPos = aS2.GetPos();

    const circleRadius = this.GetRadius();
    const arcRadius = aS2.GetRadius();

    const startPoint = aS2.GetStartPoint();
    const endPoint = aS2.GetEndPoint();

    const csc = new CU_SHAPE_CIRCLE(arcPos, arcRadius + aS2.GetWidth() / 2);

    if (EuclideanNorm(sub(circlePos, arcPos)) > arcRadius + circleRadius) {
      const pcs = this.PathsToCuCircle(csc, aMaxWeight, aMaxSquaredWeight);

      if (pcs.length === 1) {
        const testAngle = aS2.AngleBetweenStartAndEnd(toI(pcs[0]!.a2));

        if (testAngle.lt(aS2.GetEndAngle())) {
          result.push(pcs[0]!);
          return result;
        }
      }
    }

    const csc1 = new CU_SHAPE_CIRCLE(startPoint, aS2.GetWidth() / 2);
    const csc2 = new CU_SHAPE_CIRCLE(endPoint, aS2.GetWidth() / 2);

    let bestPath: PATH_CONNECTION | null = null;

    const pcs1 = this.PathsToCuCircle(csc1, aMaxWeight, aMaxSquaredWeight);
    const pcs2 = this.PathsToCuCircle(csc2, aMaxWeight, aMaxSquaredWeight);

    for (const pc of pcs1) {
      if (!bestPath || (bestPath.weight > pc.weight && pc.weight > 0)) bestPath = pc;
    }

    for (const pc of pcs2) {
      if (!bestPath || (bestPath.weight > pc.weight && pc.weight > 0)) bestPath = pc;
    }

    // If the circle center is insde the arc ring

    const pc3 = new PATH_CONNECTION();

    if (SquaredEuclideanNorm(sub(circlePos, arcPos)) < arcRadius * arcRadius) {
      if (!equal(circlePos, arcPos)) {
        // The best path is already found otherwise
        const testAngle = aS2.AngleBetweenStartAndEnd(circlePos);

        if (testAngle.lt(aS2.GetEndAngle())) {
          pc3.weight = Math.max(
            arcRadius - EuclideanNorm(sub(circlePos, arcPos)) - circleRadius,
            0.0,
          );
          pc3.a1 = add(circlePos, resizeI(sub(circlePos, arcPos), circleRadius));
          pc3.a2 = add(arcPos, resizeI(sub(circlePos, arcPos), arcRadius - aS2.GetWidth() / 2));

          if (!bestPath || (bestPath.weight > pc3.weight && pc3.weight > 0)) bestPath = pc3;
        }
      }
    }

    if (bestPath && bestPath.weight > 0) {
      result.push(bestPath);
    }

    return result;
  }
}

/** @class CU_SHAPE_ARC
 *
 *  @brief Creepage: a conductive arc
 */
export class CU_SHAPE_ARC extends CU_SHAPE_CIRCLE {
  private m_width: number;
  private readonly m_startAngle: EDA_ANGLE;
  private readonly m_endAngle: EDA_ANGLE;
  private readonly m_startPoint: VECTOR2I;
  private readonly m_endPoint: VECTOR2I;

  constructor(
    aPos: VECTOR2I,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aEndAngle: EDA_ANGLE,
    aStartPoint: Vec2,
    aEndPoint: Vec2,
  ) {
    super(aPos, aRadius);
    this.m_startAngle = aStartAngle;
    this.m_endAngle = aEndAngle;
    this.m_startPoint = toI(aStartPoint);
    this.m_endPoint = toI(aEndPoint);
    this.m_type = CREEP_SHAPE_TYPE.ARC;
    this.m_width = 0;
  }

  override PathsToBePoint(
    aS2: BE_SHAPE_POINT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const point = aS2.GetPos();
    const arcCenter = this.GetPos();

    const radius = this.GetRadius();
    const width = this.GetWidth();

    let angle = EDA_ANGLE.fromVector(sub(point, arcCenter));

    while (angle.lt(this.GetStartAngle())) angle = angle.add(ANGLE_360);
    while (angle.gt(this.GetEndAngle().add(ANGLE_360))) angle = angle.sub(ANGLE_360);

    if (angle.lt(this.GetEndAngle())) {
      if (SquaredEuclideanNorm(sub(point, arcCenter)) > radius * radius) {
        const circle = new CU_SHAPE_CIRCLE(arcCenter, radius + width / 2);
        return circle.PathsToBePoint(aS2, aMaxWeight, aMaxSquaredWeight);
      } else {
        const pc = new PATH_CONNECTION();
        pc.weight = Math.max(radius - width / 2 - EuclideanNorm(sub(point, arcCenter)), 0.0);
        pc.a1 = add(resizeI(sub(point, arcCenter), radius - width / 2), arcCenter);
        pc.a2 = point;

        if (pc.weight > 0 && pc.weight < aMaxWeight) result.push(pc);

        return result;
      }
    } else {
      let nearestPoint: VECTOR2I;

      if (
        SquaredEuclideanNorm(sub(point, this.GetStartPoint())) >
        SquaredEuclideanNorm(sub(point, this.GetEndPoint()))
      ) {
        nearestPoint = this.GetEndPoint();
      } else {
        nearestPoint = this.GetStartPoint();
      }

      const circle = new CU_SHAPE_CIRCLE(nearestPoint, width / 2);
      return circle.PathsToBePoint(aS2, aMaxWeight, aMaxSquaredWeight);
    }
  }

  // NB: the C++ never reads aS2 here; the paths are between the arc and its own circle.
  override PathsToBeCircle(
    _aS2: BE_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const csc = new CU_SHAPE_CIRCLE(this.GetPos(), this.GetRadius() + this.GetWidth() / 2);

    // this->Paths( csc, ... ): CU_SHAPE_ARC::Paths( const CU_SHAPE_CIRCLE& ) reverses csc.Paths( *this )
    for (const pc of this.PathsToCuCircle(csc, aMaxWeight, aMaxSquaredWeight)) {
      const testAngle = this.AngleBetweenStartAndEnd(toI(pc.a2));

      if (testAngle.lt(this.GetEndAngle())) result.push(pc);
    }

    if (result.length < 2) {
      const csc1 = new CU_SHAPE_CIRCLE(this.GetStartPoint(), this.GetWidth() / 2);
      const csc2 = new CU_SHAPE_CIRCLE(this.GetEndPoint(), this.GetWidth() / 2);

      for (const pc of this.PathsToCuCircle(csc1, aMaxWeight, aMaxSquaredWeight)) result.push(pc);

      for (const pc of this.PathsToCuCircle(csc2, aMaxWeight, aMaxSquaredWeight)) result.push(pc);
    }

    return result;
  }

  override PathsToBeArc(
    aS2: BE_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const beArcPos = aS2.GetPos();
    const beArcRadius = aS2.GetRadius();
    const beArcStartAngle = aS2.GetStartAngle();
    const beArcEndAngle = aS2.GetEndAngle();

    const bsc = new BE_SHAPE_CIRCLE(aS2.GetPos(), aS2.GetRadius());

    for (const pc of this.PathsToBeCircle(bsc, aMaxWeight, aMaxSquaredWeight)) {
      const testAngle = aS2.AngleBetweenStartAndEnd(toI(pc.a2));

      if (testAngle.lt(aS2.GetEndAngle())) result.push(pc);
    }

    if (result.length < 2) {
      const bsp1 = new BE_SHAPE_POINT(aS2.GetStartPoint());
      const bsp2 = new BE_SHAPE_POINT(aS2.GetEndPoint());

      for (const pc of this.PathsToBePoint(bsp1, aMaxWeight, aMaxSquaredWeight)) {
        if (
          !segmentIntersectsArc(
            toI(pc.a1),
            toI(pc.a2),
            beArcPos,
            beArcRadius,
            beArcStartAngle,
            beArcEndAngle,
          )
        )
          result.push(pc);
      }

      for (const pc of this.PathsToBePoint(bsp2, aMaxWeight, aMaxSquaredWeight)) {
        if (
          !segmentIntersectsArc(
            toI(pc.a1),
            toI(pc.a2),
            beArcPos,
            beArcRadius,
            beArcStartAngle,
            beArcEndAngle,
          )
        )
          result.push(pc);
      }
    }

    return result;
  }

  override PathsToCuSegment(
    aS2: CU_SHAPE_SEGMENT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToCuArc(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuCircle(
    aS2: CU_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToCuArc(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuArc(
    aS2: CU_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const R1 = this.GetRadius();
    const R2 = aS2.GetRadius();

    const C1 = this.GetPos();
    const C2 = aS2.GetPos();

    let bestPath = new PATH_CONNECTION();
    bestPath.weight = Number.POSITIVE_INFINITY;
    const csc1 = new CU_SHAPE_CIRCLE(C1, R1 + this.GetWidth() / 2);
    const csc2 = new CU_SHAPE_CIRCLE(C2, R2 + aS2.GetWidth() / 2);

    const csc3 = new CU_SHAPE_CIRCLE(this.GetStartPoint(), this.GetWidth() / 2);
    const csc4 = new CU_SHAPE_CIRCLE(this.GetEndPoint(), this.GetWidth() / 2);
    const csc5 = new CU_SHAPE_CIRCLE(aS2.GetStartPoint(), aS2.GetWidth() / 2);
    const csc6 = new CU_SHAPE_CIRCLE(aS2.GetEndPoint(), aS2.GetWidth() / 2);

    for (const pcs of [
      csc1.PathsToCuCircle(csc2, aMaxWeight, aMaxSquaredWeight),
      this.PathsToCuCircle(csc2, aMaxWeight, aMaxSquaredWeight),
      csc1.PathsToCuArc(aS2, aMaxWeight, aMaxSquaredWeight),
    ]) {
      for (const pc of pcs) {
        const testAngle1 = this.AngleBetweenStartAndEnd(toI(pc.a1));
        const testAngle2 = aS2.AngleBetweenStartAndEnd(toI(pc.a2));

        if (
          testAngle1.lt(this.GetEndAngle()) &&
          testAngle2.lt(aS2.GetEndAngle()) &&
          bestPath.weight > pc.weight
        )
          bestPath = pc;
      }
    }

    for (const pcs of [
      this.PathsToCuCircle(csc5, aMaxWeight, aMaxSquaredWeight),
      this.PathsToCuCircle(csc6, aMaxWeight, aMaxSquaredWeight),
      csc3.PathsToCuArc(aS2, aMaxWeight, aMaxSquaredWeight),
      csc4.PathsToCuArc(aS2, aMaxWeight, aMaxSquaredWeight),
    ]) {
      for (const pc of pcs) {
        if (bestPath.weight > pc.weight) bestPath = pc;
      }
    }

    if (bestPath.weight !== Number.POSITIVE_INFINITY) result.push(bestPath);

    return result;
  }

  override GetStartAngle(): EDA_ANGLE {
    return this.m_startAngle;
  }
  override GetEndAngle(): EDA_ANGLE {
    return this.m_endAngle;
  }
  override GetRadius(): number {
    return Math.trunc(this.m_radius);
  }
  override GetStartPoint(): VECTOR2I {
    return this.m_startPoint;
  }
  override GetEndPoint(): VECTOR2I {
    return this.m_endPoint;
  }

  AngleBetweenStartAndEnd(aPoint: VECTOR2I): EDA_ANGLE {
    let angle = EDA_ANGLE.fromVector(sub(aPoint, this.m_pos));

    while (angle.lt(this.GetStartAngle())) angle = angle.add(ANGLE_360);
    while (angle.gt(this.GetEndAngle().add(ANGLE_360))) angle = angle.sub(ANGLE_360);

    return angle;
  }

  GetWidth(): number {
    return this.m_width;
  }
  SetWidth(aW: number): void {
    // int m_width: the double truncates
    this.m_width = Math.trunc(aW);
  }
}

export enum GRAPH_NODE_TYPE {
  POINT = 0,
  CIRCLE,
  ARC,
  SEGMENT,
  VIRTUAL,
}

/** @class GRAPH_NODE
 *
 *  @brief a node in a @class CREEPAGE_GRAPH
 */
export class GRAPH_NODE {
  m_parent: CREEP_SHAPE | null;
  m_node_conns = new Set<GRAPH_CONNECTION>();
  m_pos: VECTOR2I;
  // Virtual nodes are connected with a 0 weight connection to equivalent net ( same net or netclass )
  m_virtual = false;
  m_connectDirectly = true;
  m_net = -1;
  m_type: GRAPH_NODE_TYPE;

  constructor(
    aType: GRAPH_NODE_TYPE,
    aParent: CREEP_SHAPE | null,
    aPos: VECTOR2I = { x: 0, y: 0 },
  ) {
    this.m_parent = aParent;
    this.m_pos = aPos;
    this.m_type = aType;
  }
}

/** @class GRAPH_CONNECTION
 *
 *  @brief a connection in a @class CREEPAGE_GRAPH
 */
export class GRAPH_CONNECTION {
  n1: GRAPH_NODE | null;
  n2: GRAPH_NODE | null;
  m_path: PATH_CONNECTION;
  m_forceStraightLine = false;

  constructor(aN1: GRAPH_NODE, aN2: GRAPH_NODE, aPc: PATH_CONNECTION) {
    this.n1 = aN1;
    this.n2 = aN2;
    this.m_path = aPc.clone();
  }

  GetShapes(aShapes: PCB_SHAPE[]): void {
    if (!this.m_path.m_show) return;

    if (!this.n1 || !this.n2) return;

    if (this.n1.m_type === GRAPH_NODE_TYPE.VIRTUAL || this.n2.m_type === GRAPH_NODE_TYPE.VIRTUAL)
      return;

    if (
      !this.m_forceStraightLine &&
      this.n1.m_parent &&
      this.n1.m_parent === this.n2.m_parent &&
      this.n1.m_parent.GetType() === CREEP_SHAPE_TYPE.CIRCLE
    ) {
      const center = this.n1.m_parent.GetPos();
      const R1 = sub(this.n1.m_pos, center);
      const R2 = sub(this.n2.m_pos, center);
      const s = new PCB_SHAPE(null, SHAPE_T.ARC);

      if (cross(R1, R2) > 0) {
        s.SetStart(this.n1.m_pos);
        s.SetEnd(this.n2.m_pos);
      } else {
        s.SetStart(this.n2.m_pos);
        s.SetEnd(this.n1.m_pos);
      }

      s.SetCenter(center);
      aShapes.push(s);
      return;
    }

    if (
      !this.m_forceStraightLine &&
      this.n1.m_parent &&
      this.n1.m_parent === this.n2.m_parent &&
      this.n1.m_parent.GetType() === CREEP_SHAPE_TYPE.ARC
    ) {
      const arc = this.n1.m_parent instanceof BE_SHAPE_ARC ? this.n1.m_parent : null;

      if (arc) {
        const center = arc.GetPos();
        const R1 = sub(this.n1.m_pos, center);
        const R2 = sub(this.n2.m_pos, center);
        const s = new PCB_SHAPE(null, SHAPE_T.ARC);

        if (cross(R1, R2) > 0) {
          s.SetStart(this.n1.m_pos);
          s.SetEnd(this.n2.m_pos);
        } else {
          s.SetStart(this.n2.m_pos);
          s.SetEnd(this.n1.m_pos);
        }

        s.SetCenter(center);

        //Check that we are on the correct side of the arc.
        const mid = s.GetArcMid();
        const midAngle = arc.AngleBetweenStartAndEnd(mid);

        if (midAngle.gt(arc.GetEndAngle())) {
          const tmp = s.GetStart();
          s.SetStart(s.GetEnd());
          s.SetEnd(tmp);
          s.SetCenter(center);
        }

        aShapes.push(s);
        return;
      }
    }

    const s = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
    s.SetStart(toI(this.m_path.a1));
    s.SetEnd(toI(this.m_path.a2));
    aShapes.push(s);
  }
}

/** `VECTOR2I * int`. */
const scaleI = (v: VECTOR2I, k: number): VECTOR2I => ({ x: v.x * k, y: v.y * k });

/** @class BE_SHAPE_POINT
 *
 *  @brief Creepage: a board edge point
 */
export class BE_SHAPE_POINT extends BE_SHAPE {
  constructor(aPos: VECTOR2I) {
    super();
    this.m_pos = aPos;
    this.m_type = CREEP_SHAPE_TYPE.POINT;
  }

  override PathsToBePoint(
    aS2: BE_SHAPE_POINT,
    _aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const weight = SquaredEuclideanNorm(sub(this.GetPos(), aS2.GetPos()));

    if (weight > aMaxSquaredWeight) return result;

    const pc = new PATH_CONNECTION();
    pc.a1 = this.GetPos();
    pc.a2 = aS2.GetPos();
    pc.weight = Math.sqrt(weight);

    result.push(pc);
    return result;
  }

  override PathsToBeCircle(
    aS2: BE_SHAPE_CIRCLE,
    _aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const radius = aS2.GetRadius();
    const pointPos = this.GetPos();
    const circleCenter = aS2.GetPos();

    if (radius <= 0) return result;

    const pointToCenterDistanceSquared = SquaredEuclideanNorm(sub(pointPos, circleCenter));
    const weightSquared = pointToCenterDistanceSquared - Math.fround(radius) * Math.fround(radius);

    if (weightSquared > aMaxSquaredWeight) return result;

    let direction1: Vec2 = { x: pointPos.x - circleCenter.x, y: pointPos.y - circleCenter.y };
    direction1 = ResizeD(direction1, 1);

    const direction2 = Perpendicular(direction1);

    const radiusSquared = radius * radius;

    const distance = Math.sqrt(pointToCenterDistanceSquared);
    const value1 = radiusSquared / distance;
    const value2 = Math.sqrt(radiusSquared - value1 * value1);

    let resultPoint: Vec2;

    const pc = new PATH_CONNECTION();
    pc.a1 = pointPos;
    pc.weight = Math.sqrt(weightSquared);

    resultPoint = dAdd(dAdd(dMul(direction1, value1), dMul(direction2, value2)), circleCenter);
    pc.a2 = toI(resultPoint);
    result.push(pc);

    resultPoint = dAdd(dSub(dMul(direction1, value1), dMul(direction2, value2)), circleCenter);
    const pc2 = pc.clone();
    pc2.a2 = toI(resultPoint);
    result.push(pc2);

    return result;
  }

  override PathsToBeArc(
    aS2: BE_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const center = aS2.GetPos();
    const radius = aS2.GetRadius();

    // First path tries to connect to start point
    // Second path tries to connect to end point
    const behavesLikeCircle = aS2.IsThereATangentPassingThroughPoint(this);

    if (behavesLikeCircle[0] && behavesLikeCircle[1]) {
      const csc = new BE_SHAPE_CIRCLE(center, radius);
      return this.PathsToBeCircle(csc, aMaxWeight, aMaxSquaredWeight);
    }

    if (behavesLikeCircle[0]) {
      const csc = new BE_SHAPE_CIRCLE(center, radius);
      const paths = this.PathsToBeCircle(csc, aMaxWeight, aMaxSquaredWeight);

      if (paths.length > 1)
        // Point to circle creates either 0 or 2 connections
        result.push(paths[1]!);
    } else {
      const csp1 = new BE_SHAPE_POINT(aS2.GetStartPoint());

      for (const pc of this.PathsToBePoint(csp1, aMaxWeight, aMaxSquaredWeight)) result.push(pc);
    }

    if (behavesLikeCircle[1]) {
      const csc = new BE_SHAPE_CIRCLE(center, radius);
      const paths = this.PathsToBeCircle(csc, aMaxWeight, aMaxSquaredWeight);

      if (paths.length > 1)
        // Point to circle creates either 0 or 2 connections
        result.push(paths[0]!);
    } else {
      const csp1 = new BE_SHAPE_POINT(aS2.GetEndPoint());

      for (const pc of this.PathsToBePoint(csp1, aMaxWeight, aMaxSquaredWeight)) result.push(pc);
    }

    return result;
  }

  override PathsToCuSegment(
    aS2: CU_SHAPE_SEGMENT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBePoint(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuCircle(
    aS2: CU_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBePoint(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuArc(
    aS2: CU_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBePoint(this, aMaxWeight, aMaxSquaredWeight));
  }

  override ConnectChildren(_a1: GRAPH_NODE, _a2: GRAPH_NODE, _aG: CREEPAGE_GRAPH): void {}
}

/** @class BE_SHAPE_CIRCLE
 *
 *  @brief Creepage: a board edge circle
 */
export class BE_SHAPE_CIRCLE extends BE_SHAPE {
  protected m_radius: number;

  constructor(aPos: VECTOR2I = { x: 0, y: 0 }, aRadius = 0) {
    super();
    this.m_pos = aPos;
    // int m_radius
    this.m_radius = Math.trunc(aRadius);
    this.m_type = CREEP_SHAPE_TYPE.CIRCLE;
  }

  override PathsToBePoint(
    aS2: BE_SHAPE_POINT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeCircle(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToBeCircle(
    aS2: BE_SHAPE_CIRCLE,
    _aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];

    const p1 = this.GetPos();
    const p2 = aS2.GetPos();

    const distSquared: Vec2 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const weightSquared = dSqNorm(distSquared);

    const R1 = this.GetRadius();
    const R2 = aS2.GetRadius();

    const Rdiff = Math.abs(R1 - R2);
    const Rsum = R1 + R2;

    // "Straight" paths
    const weightSquared1 = weightSquared - Rdiff * Rdiff;
    // "Crossed" paths
    const weightSquared2 = weightSquared - Rsum * Rsum;

    if (weightSquared1 <= aMaxSquaredWeight) {
      let direction1: Vec2 = { x: p2.x - p1.x, y: p2.y - p1.y };
      direction1 = ResizeD(direction1, 1);
      const direction2 = Perpendicular(direction1);

      const D = Math.sqrt(weightSquared);
      const ratio1 = (R1 - R2) / D;
      const ratio2 = Math.sqrt(1 - ratio1 * ratio1);

      const pc = new PATH_CONNECTION();
      pc.weight = Math.sqrt(weightSquared1);

      pc.a1 = dAdd(dAdd(p1, dMul(direction1, R1 * ratio1)), dMul(direction2, R1 * ratio2));
      pc.a2 = dAdd(dAdd(p2, dMul(direction1, R2 * ratio1)), dMul(direction2, R2 * ratio2));

      result.push(pc);

      const pcb = pc.clone();
      pcb.a1 = dSub(dAdd(p1, dMul(direction1, R1 * ratio1)), dMul(direction2, R1 * ratio2));
      pcb.a2 = dSub(dAdd(p2, dMul(direction1, R2 * ratio1)), dMul(direction2, R2 * ratio2));

      result.push(pcb);
    }
    if (weightSquared2 <= aMaxSquaredWeight) {
      let direction1: Vec2 = { x: p2.x - p1.x, y: p2.y - p1.y };
      direction1 = ResizeD(direction1, 1);
      const direction2 = Perpendicular(direction1);

      const D = Math.sqrt(weightSquared);
      const ratio1 = (R1 + R2) / D;
      const ratio2 = Math.sqrt(1 - ratio1 * ratio1);

      const pc = new PATH_CONNECTION();
      pc.weight = Math.sqrt(weightSquared2);

      pc.a1 = dAdd(dAdd(p1, dMul(direction1, R1 * ratio1)), dMul(direction2, R1 * ratio2));
      pc.a2 = dSub(dSub(p2, dMul(direction1, R2 * ratio1)), dMul(direction2, R2 * ratio2));

      result.push(pc);

      const pcb = pc.clone();
      pcb.a1 = dSub(dAdd(p1, dMul(direction1, R1 * ratio1)), dMul(direction2, R1 * ratio2));
      pcb.a2 = dAdd(dSub(p2, dMul(direction1, R2 * ratio1)), dMul(direction2, R2 * ratio2));

      result.push(pcb);
    }

    return result;
  }

  override PathsToBeArc(
    aS2: BE_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const circleCenter = this.GetPos();
    const circleRadius = this.GetRadius();
    const arcCenter = aS2.GetPos();
    const arcRadius = aS2.GetRadius();
    const arcStartAngle = aS2.GetStartAngle();
    const arcEndAngle = aS2.GetEndAngle();

    const centerDistance = EuclideanNorm(sub(circleCenter, arcCenter));

    if (centerDistance + arcRadius < circleRadius) {
      // The arc is inside the circle
      return result;
    }

    const csp1 = new BE_SHAPE_POINT(aS2.GetStartPoint());
    const csp2 = new BE_SHAPE_POINT(aS2.GetEndPoint());
    const csc = new BE_SHAPE_CIRCLE(arcCenter, arcRadius);

    for (const pc of this.PathsToBeCircle(csc, aMaxWeight, aMaxSquaredWeight)) {
      const pointAngle = aS2.AngleBetweenStartAndEnd(toI(pc.a2));

      if (pointAngle.le(aS2.GetEndAngle())) result.push(pc);
    }

    if (result.length === 4) {
      // It behaved as a circle
      return result;
    }

    for (const csp of [csp1, csp2]) {
      for (const pc of this.PathsToBePoint(csp, aMaxWeight, aMaxSquaredWeight)) {
        if (
          !segmentIntersectsArc(
            toI(pc.a1),
            toI(pc.a2),
            arcCenter,
            arcRadius,
            arcStartAngle,
            arcEndAngle,
          )
        )
          result.push(pc);
      }
    }

    return result;
  }

  override PathsToCuSegment(
    aS2: CU_SHAPE_SEGMENT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeCircle(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuCircle(
    aS2: CU_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeCircle(this, aMaxWeight, aMaxSquaredWeight));
  }

  override GetRadius(): number {
    return this.m_radius;
  }

  override ConnectChildren(a1: GRAPH_NODE, a2: GRAPH_NODE, aG: CREEPAGE_GRAPH): void {
    if (!a1 || !a2) return;

    if (this.m_radius === 0) return;

    const distI = sub(a1.m_pos, a2.m_pos);
    const distD: Vec2 = { x: distI.x, y: distI.y };

    const weight = this.m_radius * 2 * Math.asin(dNorm(distD) / (2.0 * this.m_radius));

    if (weight > aG.GetTarget()) return;

    if (aG.m_minGrooveWidth <= 0) {
      const pc = new PATH_CONNECTION();
      pc.a1 = a1.m_pos;
      pc.a2 = a2.m_pos;
      pc.weight = Math.max(weight, 0.0);

      aG.AddConnection(a1, a2, pc);
      return;
    }

    if (weight > aG.m_minGrooveWidth) this.ShortenChildDueToGV(a1, a2, aG, weight);
    // Else well.. this paths will be "shorted" by another one
  }

  ShortenChildDueToGV(
    a1: GRAPH_NODE,
    a2: GRAPH_NODE,
    aG: CREEPAGE_GRAPH,
    aNormalWeight: number,
  ): void {
    let angle1 = EDA_ANGLE.fromVector(sub(a1.m_pos, this.m_pos));
    let angle2 = EDA_ANGLE.fromVector(sub(a2.m_pos, this.m_pos));

    while (angle1.lt(ANGLE_0)) angle1 = angle1.add(ANGLE_360);
    while (angle2.lt(ANGLE_0)) angle2 = angle2.add(ANGLE_360);
    while (angle1.gt(ANGLE_360)) angle1 = angle1.sub(ANGLE_360);
    while (angle2.gt(ANGLE_360)) angle2 = angle2.sub(ANGLE_360);

    const maxAngle = angle1.gt(angle2) ? angle1 : angle2;
    let skipAngle = new EDA_ANGLE(
      Math.asin(Math.fround(aG.m_minGrooveWidth) / (2 * this.m_radius)),
      EDA_ANGLE_T.RADIANS_T,
    );
    skipAngle = skipAngle.add(skipAngle); // Cannot multiply EDA_ANGLE by scalar, but this really is angle *2
    const pointAngle = maxAngle.sub(skipAngle);

    const skipPoint: VECTOR2I = { x: this.m_pos.x, y: this.m_pos.y };
    // skipPoint.x += m_radius * cos( ... ): the int member truncates the sum
    skipPoint.x = Math.trunc(skipPoint.x + this.m_radius * Math.cos(pointAngle.AsRadians()));
    skipPoint.y = Math.trunc(skipPoint.y + this.m_radius * Math.sin(pointAngle.AsRadians()));

    const gnt = aG.AddNode(GRAPH_NODE_TYPE.POINT, a1.m_parent, skipPoint);

    const pc = new PATH_CONNECTION();

    pc.a1 = maxAngle.equals(angle2) ? a1.m_pos : a2.m_pos;
    pc.a2 = skipPoint;
    pc.weight = aNormalWeight - aG.m_minGrooveWidth;
    aG.AddConnection(maxAngle.equals(angle2) ? a1 : a2, gnt, pc);

    const pc2 = new PATH_CONNECTION();
    pc2.a1 = skipPoint;
    pc2.a2 = maxAngle.equals(angle2) ? a2.m_pos : a1.m_pos;
    pc2.weight = aG.m_minGrooveWidth;

    const gc = aG.AddConnection(gnt, maxAngle.equals(angle2) ? a2 : a1, pc2);

    if (gc) gc.m_forceStraightLine = true;
  }
}

/** @class BE_SHAPE_ARC
 *
 *  @brief Creepage: a board edge arc
 */
export class BE_SHAPE_ARC extends BE_SHAPE_CIRCLE {
  protected m_startAngle: EDA_ANGLE;
  protected m_endAngle: EDA_ANGLE;
  protected m_startPoint: VECTOR2I;
  protected m_endPoint: VECTOR2I;

  constructor(
    aPos: VECTOR2I,
    aRadius: number,
    aStartAngle: EDA_ANGLE,
    aEndAngle: EDA_ANGLE,
    aStartPoint: Vec2,
    aEndPoint: Vec2,
  ) {
    super(aPos, aRadius);
    this.m_startAngle = aStartAngle;
    this.m_endAngle = aEndAngle;
    this.m_startPoint = toI(aStartPoint);
    this.m_endPoint = toI(aEndPoint);
    this.m_type = CREEP_SHAPE_TYPE.ARC;
  }

  override ConnectChildren(a1: GRAPH_NODE, a2: GRAPH_NODE, aG: CREEPAGE_GRAPH): void {
    if (!a1 || !a2) return;

    // Drop an arc that bulges into an overlapping cutout, it is not a real edge to hug.
    if (aG.m_hasOverlappingCutouts && aG.m_boardOutline) {
      const center: Vec2 = { x: this.GetPos().x, y: this.GetPos().y };
      const mid = dSub(
        dMul(dAdd({ x: a1.m_pos.x, y: a1.m_pos.y }, { x: a2.m_pos.x, y: a2.m_pos.y }), 0.5),
        center,
      );

      if (dNorm(mid) > 0) {
        const arcMid = toI(dAdd(center, ResizeD(mid, this.m_radius)));

        if (
          !aG.m_boardOutline.Contains(arcMid, -1, 100) &&
          !aG.m_boardOutline.PointOnEdge(arcMid, 100)
        ) {
          return;
        }
      }
    }

    const angle1 = this.AngleBetweenStartAndEnd(a1.m_pos);
    const angle2 = this.AngleBetweenStartAndEnd(a2.m_pos);

    const weight = Math.abs(this.m_radius * angle2.sub(angle1).AsRadians());

    if (aG.m_minGrooveWidth <= 0) {
      if (weight > aG.GetTarget()) return;

      const pc = new PATH_CONNECTION();
      pc.a1 = a1.m_pos;
      pc.a2 = a2.m_pos;
      pc.weight = weight;

      aG.AddConnection(a1, a2, pc);
      return;
    }

    if (weight > aG.m_minGrooveWidth) this.ShortenChildDueToGV(a1, a2, aG, weight);
  }

  override PathsToBePoint(
    aS2: BE_SHAPE_POINT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeArc(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToBeCircle(
    aS2: BE_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeArc(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToBeArc(
    aS2: BE_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    const result: PATH_CONNECTION[] = [];
    const circleCenter = this.GetPos();
    const circleRadius = this.GetRadius();
    const arcCenter = aS2.GetPos();
    const arcRadius = aS2.GetRadius();

    const centerDistance = EuclideanNorm(sub(circleCenter, arcCenter));

    if (centerDistance + arcRadius < circleRadius) {
      // The arc is inside the circle
      return result;
    }

    // this->Paths( BE_SHAPE_CIRCLE( aS2 ) ): BE_SHAPE_ARC::Paths( const BE_SHAPE_CIRCLE& ) reverses the
    // circle's Paths( *this ), i.e. BE_SHAPE_CIRCLE::Paths( const BE_SHAPE_ARC& ).
    for (const pc of this.PathsToBeCircle(
      new BE_SHAPE_CIRCLE(aS2.GetPos(), aS2.GetRadius()),
      aMaxWeight,
      aMaxSquaredWeight,
    )) {
      const pointAngle = aS2.AngleBetweenStartAndEnd(toI(pc.a2));

      if (pointAngle.le(aS2.GetEndAngle())) result.push(pc);
    }

    for (const pc of new BE_SHAPE_CIRCLE(this.GetPos(), this.GetRadius()).PathsToBeArc(
      aS2,
      aMaxWeight,
      aMaxSquaredWeight,
    )) {
      const pointAngle = this.AngleBetweenStartAndEnd(toI(pc.a1));

      if (pointAngle.le(this.GetEndAngle())) result.push(pc);
    }

    return result;
  }

  override PathsToCuSegment(
    aS2: CU_SHAPE_SEGMENT,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeArc(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuCircle(
    aS2: CU_SHAPE_CIRCLE,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeArc(this, aMaxWeight, aMaxSquaredWeight));
  }

  override PathsToCuArc(
    aS2: CU_SHAPE_ARC,
    aMaxWeight: number,
    aMaxSquaredWeight: number,
  ): PATH_CONNECTION[] {
    return this.ReversePaths(aS2.PathsToBeArc(this, aMaxWeight, aMaxSquaredWeight));
  }

  override GetStartAngle(): EDA_ANGLE {
    return this.m_startAngle;
  }
  override GetEndAngle(): EDA_ANGLE {
    return this.m_endAngle;
  }
  override GetRadius(): number {
    return this.m_radius;
  }
  override GetStartPoint(): VECTOR2I {
    return this.m_startPoint;
  }
  override GetEndPoint(): VECTOR2I {
    return this.m_endPoint;
  }

  AngleBetweenStartAndEnd(aPoint: VECTOR2I): EDA_ANGLE {
    let angle = EDA_ANGLE.fromVector(sub(aPoint, this.m_pos));

    while (angle.lt(this.m_startAngle)) angle = angle.add(ANGLE_360);
    while (angle.gt(this.m_endAngle.add(ANGLE_360))) angle = angle.sub(ANGLE_360);

    return angle;
  }

  IsThereATangentPassingThroughPoint(aPoint: BE_SHAPE_POINT): [boolean, boolean] {
    const R = this.m_radius;

    const newPoint = sub(aPoint.GetPos(), this.m_pos);

    if (SquaredEuclideanNorm(newPoint) <= R * R) {
      // If the point is inside the arc
      return [false, false];
    }

    const testAngle = this.AngleBetweenStartAndEnd(aPoint.GetPos());

    const startAngle = this.m_startAngle.AsRadians();
    const endAngle = this.m_endAngle.AsRadians();
    const pointAngle = testAngle.AsRadians();

    const greaterThan180 = this.m_endAngle.sub(this.m_startAngle).gt(new EDA_ANGLE(180));
    let connectToEndPoint: boolean;

    connectToEndPoint = Math.cos(startAngle) * newPoint.x + Math.sin(startAngle) * newPoint.y >= R;

    if (greaterThan180)
      connectToEndPoint &&= Math.cos(endAngle) * newPoint.x + Math.sin(endAngle) * newPoint.y <= R;

    connectToEndPoint ||=
      Math.cos(endAngle) * newPoint.x + Math.sin(endAngle) * newPoint.y <= R &&
      (pointAngle >= endAngle || pointAngle <= startAngle);

    const first = !connectToEndPoint;

    connectToEndPoint = Math.cos(endAngle) * newPoint.x + Math.sin(endAngle) * newPoint.y >= R;

    if (greaterThan180)
      connectToEndPoint &&=
        Math.cos(startAngle) * newPoint.x + Math.sin(startAngle) * newPoint.y <= R;

    connectToEndPoint ||=
      Math.cos(startAngle) * newPoint.x + Math.sin(startAngle) * newPoint.y <= R &&
      (pointAngle >= endAngle || pointAngle <= startAngle);

    const second = !connectToEndPoint;
    return [first, second];
  }
}

export function compareShapes(a: CREEP_SHAPE | null, b: CREEP_SHAPE | null): boolean {
  if (!a) return true;

  if (!b) return false;

  if (a.GetType() !== b.GetType()) return a.GetType() < b.GetType();

  if (a.GetType() === CREEP_SHAPE_TYPE.UNDEFINED) return true;

  if (!equal(a.GetPos(), b.GetPos())) return vLt(a.GetPos(), b.GetPos());

  if (a.GetType() === CREEP_SHAPE_TYPE.CIRCLE) return a.GetRadius() < b.GetRadius();

  return false;
}

export function areEquivalent(a: CREEP_SHAPE | null, b: CREEP_SHAPE | null): boolean {
  if (!a && !b) return true;

  if (!a || !b) return false;

  if (a.GetType() !== b.GetType()) return false;

  if (a.GetType() === CREEP_SHAPE_TYPE.POINT) return equal(a.GetPos(), b.GetPos());

  if (a.GetType() === CREEP_SHAPE_TYPE.CIRCLE)
    return equal(a.GetPos(), b.GetPos()) && a.GetRadius() === b.GetRadius();

  return false;
}

export function segmentIntersectsCircle(
  p1: VECTOR2I,
  p2: VECTOR2I,
  center: VECTOR2I,
  radius: number,
  aIntersectPoints: VECTOR2I[] | null,
): boolean {
  const segment = new SEG(p1, p2);
  const circle = new CIRCLE(center, radius);

  const intersectionPoints: VECTOR2I[] = [];

  const visitor = new INTERSECTION_VISITOR(circle, intersectionPoints);
  visitor.visit(segment);

  // A path is allowed to end on the circle, so an intersection at either endpoint is a
  // touch, not a crossing. Only interior crossings count.
  const toleranceSq = 50 * 50;

  const coincident = (a: VECTOR2I, b: VECTOR2I): boolean =>
    SquaredEuclideanNorm(sub(a, b)) <= toleranceSq;

  const filtered: VECTOR2I[] = [];

  for (const ip of intersectionPoints) {
    if (!coincident(ip, p1) && !coincident(ip, p2)) filtered.push(ip);
  }

  if (aIntersectPoints) {
    for (const point of filtered) aIntersectPoints.push(point);
  }

  return filtered.length > 0;
}

interface CornerArcRange {
  center: VECTOR2I;
  startAngle: EDA_ANGLE;
  endAngle: EDA_ANGLE;
}

export function SegmentIntersectsBoard(
  aP1: VECTOR2I,
  aP2: VECTOR2I,
  aBe: readonly BOARD_ITEM[],
  aDontTestAgainst: readonly BOARD_ITEM[],
  aMinGrooveWidth: number,
): boolean {
  const intersectionPoints: VECTOR2I[] = [];
  const TestGrooveWidth = aMinGrooveWidth > 0;

  for (const be of aBe) {
    if (aDontTestAgainst.includes(be)) continue;

    const d = be as PCB_SHAPE;
    if (!d) continue;

    switch (d.GetShape()) {
      case SHAPE_T.SEGMENT: {
        const intersects = segments_intersect(
          aP1,
          aP2,
          d.GetStart(),
          d.GetEnd(),
          intersectionPoints,
        );

        if (intersects && !TestGrooveWidth) return false;

        break;
      }

      case SHAPE_T.RECTANGLE: {
        const r = d.GetCornerRadius();

        if (r > 0) {
          // Rounded rectangle: four shortened straight sides + four quarter-circle arcs.
          const x1 = Math.min(d.GetStart().x, d.GetEnd().x);
          const y1 = Math.min(d.GetStart().y, d.GetEnd().y);
          const x2 = Math.max(d.GetStart().x, d.GetEnd().x);
          const y2 = Math.max(d.GetStart().y, d.GetEnd().y);

          // Straight sides (between arc endpoints). Skip zero-length
          // sides that occur when one dimension equals 2*r (stadium).
          const w = x2 - x1;
          const h = y2 - y1;
          let intersects = false;

          if (w > 2 * r) {
            intersects ||= segments_intersect(
              aP1,
              aP2,
              { x: x1 + r, y: y1 },
              { x: x2 - r, y: y1 },
              intersectionPoints,
            );
            intersects ||= segments_intersect(
              aP1,
              aP2,
              { x: x2 - r, y: y2 },
              { x: x1 + r, y: y2 },
              intersectionPoints,
            );
          }

          if (h > 2 * r) {
            intersects ||= segments_intersect(
              aP1,
              aP2,
              { x: x2, y: y1 + r },
              { x: x2, y: y2 - r },
              intersectionPoints,
            );
            intersects ||= segments_intersect(
              aP1,
              aP2,
              { x: x1, y: y2 - r },
              { x: x1, y: y1 + r },
              intersectionPoints,
            );
          }

          if (intersects && !TestGrooveWidth) return false;

          // Corner arcs, matching the decomposition in TransformEdgeToCreepShapes.
          // Stadium shapes get semicircles instead of four quarter-arcs to
          // avoid duplicate centers that cause division by zero in Paths().
          let arcs: CornerArcRange[];

          if (h === 2 * r) {
            // Horizontal stadium: left and right semicircles. Each cap spans
            // the outer half of its circle so the modeled boundary matches the
            // decomposition in TransformEdgeToCreepShapes.
            arcs = [
              {
                center: { x: x1 + r, y: y1 + r },
                startAngle: new EDA_ANGLE(90.0),
                endAngle: new EDA_ANGLE(270.0),
              },
              {
                center: { x: x2 - r, y: y1 + r },
                startAngle: new EDA_ANGLE(-90.0),
                endAngle: new EDA_ANGLE(90.0),
              },
            ];
          } else if (w === 2 * r) {
            // Vertical stadium: top and bottom semicircles
            arcs = [
              {
                center: { x: x1 + r, y: y1 + r },
                startAngle: new EDA_ANGLE(-180.0),
                endAngle: new EDA_ANGLE(0.0),
              },
              {
                center: { x: x1 + r, y: y2 - r },
                startAngle: new EDA_ANGLE(0.0),
                endAngle: new EDA_ANGLE(180.0),
              },
            ];
          } else {
            arcs = [
              {
                center: { x: x1 + r, y: y1 + r },
                startAngle: new EDA_ANGLE(-180.0),
                endAngle: new EDA_ANGLE(-90.0),
              },
              {
                center: { x: x2 - r, y: y1 + r },
                startAngle: new EDA_ANGLE(-90.0),
                endAngle: new EDA_ANGLE(0.0),
              },
              {
                center: { x: x2 - r, y: y2 - r },
                startAngle: new EDA_ANGLE(0.0),
                endAngle: new EDA_ANGLE(90.0),
              },
              {
                center: { x: x1 + r, y: y2 - r },
                startAngle: new EDA_ANGLE(90.0),
                endAngle: new EDA_ANGLE(180.0),
              },
            ];
          }

          for (const ca of arcs) {
            const arcIntersects = segmentIntersectsArc(
              aP1,
              aP2,
              ca.center,
              r,
              ca.startAngle,
              ca.endAngle,
              intersectionPoints,
            );

            if (arcIntersects && !TestGrooveWidth) return false;
          }
        } else {
          const c1 = d.GetStart();
          const c2: VECTOR2I = { x: d.GetStart().x, y: d.GetEnd().y };
          const c3 = d.GetEnd();
          const c4: VECTOR2I = { x: d.GetEnd().x, y: d.GetStart().y };

          let intersects = false;
          intersects ||= segments_intersect(aP1, aP2, c1, c2, intersectionPoints);
          intersects ||= segments_intersect(aP1, aP2, c2, c3, intersectionPoints);
          intersects ||= segments_intersect(aP1, aP2, c3, c4, intersectionPoints);
          intersects ||= segments_intersect(aP1, aP2, c4, c1, intersectionPoints);

          if (intersects && !TestGrooveWidth) return false;
        }

        break;
      }

      case SHAPE_T.POLY: {
        const points = d.GetPolyPoints();

        if (points.length < 2) break;

        let prevPoint = points[points.length - 1]!;

        let intersects = false;

        for (const p of points) {
          intersects ||= segments_intersect(aP1, aP2, prevPoint, p, intersectionPoints);
          prevPoint = p;
        }

        if (intersects && !TestGrooveWidth) return false;

        break;
      }

      case SHAPE_T.CIRCLE: {
        const center = d.getCenter();
        const radius = d.GetRadius();

        const intersects = segmentIntersectsCircle(aP1, aP2, center, radius, intersectionPoints);

        if (intersects && !TestGrooveWidth) return false;

        break;
      }

      case SHAPE_T.ARC: {
        const center = d.getCenter();
        const radius = d.GetRadius();

        const [A, B] = d.CalcArcAngles();

        const intersects = segmentIntersectsArc(aP1, aP2, center, radius, A, B, intersectionPoints);

        if (intersects && !TestGrooveWidth) return false;

        break;
      }

      default:
        break;
    }
  }

  if (intersectionPoints.length <= 0) return true;

  if (intersectionPoints.length % 2 !== 0) return false; // Should not happen if the start and end are both on the board

  let minx = intersectionPoints[0]!.x;
  let maxx = intersectionPoints[0]!.x;
  let miny = intersectionPoints[0]!.y;
  let maxy = intersectionPoints[0]!.y;

  for (const v of intersectionPoints) {
    minx = v.x < minx ? v.x : minx;
    maxx = v.x > maxx ? v.x : maxx;
    // The C++ reads v.x for the y bounds too.
    miny = v.x < miny ? v.x : miny;
    maxy = v.x > maxy ? v.x : maxy;
  }

  if (Math.abs(maxx - minx) > Math.abs(maxy - miny)) {
    intersectionPoints.sort((a: VECTOR2I, b: VECTOR2I): number => b.x - a.x);
  } else {
    intersectionPoints.sort((a: VECTOR2I, b: VECTOR2I): number => b.y - a.y);
  }

  const GVSquared = aMinGrooveWidth * aMinGrooveWidth;

  for (let i = 0; i < intersectionPoints.length; i += 2) {
    if (SquaredEuclideanNorm(sub(intersectionPoints[i]!, intersectionPoints[i + 1]!)) > GVSquared)
      return false;
  }

  return true;
}

export function GetPaths(
  aS1: CREEP_SHAPE | null,
  aS2: CREEP_SHAPE | null,
  aMaxWeight: number,
): PATH_CONNECTION[] {
  const maxWeight = aMaxWeight;
  const maxWeightSquared = maxWeight * maxWeight;
  const result: PATH_CONNECTION[] = [];

  // The C++ dynamic_casts both shapes to every class and tests the pairs in
  // order, most derived first; `pathsTo` resolves aS2 the same way, and aS1's
  // own class picks the method.
  if (!aS1 || !aS2) return result;

  return aS1.pathsTo(aS2, maxWeight, maxWeightSquared);
}

interface ParentEntry {
  parent: BOARD_ITEM;
  bbox: BOX2I;
}

/** @class CREEPAGE_GRAPH
 *
 *  @brief A graph with nodes and connections for creepage calculation
 */
export class CREEPAGE_GRAPH {
  m_board: BOARD;
  m_boardEdge: BOARD_ITEM[] = [];
  m_ownedBoardEdges: PCB_SHAPE[] = [];
  m_boardOutline: SHAPE_POLY_SET | null = null;
  m_hasOverlappingCutouts = false;
  m_nodes: GRAPH_NODE[] = [];
  m_connections: GRAPH_CONNECTION[] = [];
  m_shapeCollection: CREEP_SHAPE[] = [];

  // This is a duplicate of m_nodes, but it is used to quickly find a node rather than iterating through m_nodes
  m_nodeset = new Map<string, GRAPH_NODE>();

  m_minGrooveWidth = 0;

  private m_creepageTarget = -1;
  private m_creepageTargetSquared = -1;

  constructor(aBoard: BOARD) {
    this.m_board = aBoard;
  }

  /** GraphNodeHash / GraphNodeEqual: type, parent identity and position. */
  static nodeKey(aType: GRAPH_NODE_TYPE, aParent: CREEP_SHAPE | null, aPos: VECTOR2I): string {
    return `${aType}:${aParent ? ptrOrdinal(aParent) : -1}:${aPos.x},${aPos.y}`;
  }

  TransformEdgeToCreepShapes(): void {
    // Flag overlapping cutouts so the arc void check below only runs when needed.
    const cutouts: BOX2I[] = [];

    for (const be of this.m_boardEdge) {
      const s = be as PCB_SHAPE;

      if (
        s &&
        (s.GetShape() === SHAPE_T.RECTANGLE ||
          s.GetShape() === SHAPE_T.CIRCLE ||
          s.GetShape() === SHAPE_T.POLY)
      ) {
        cutouts.push(s.GetBoundingBox());
      }
    }

    for (let i = 0; i < cutouts.length && !this.m_hasOverlappingCutouts; ++i) {
      for (let j = i + 1; j < cutouts.length; ++j) {
        if (
          cutouts[i]!.Intersects(cutouts[j]!) &&
          !cutouts[i]!.Contains(cutouts[j]!) &&
          !cutouts[j]!.Contains(cutouts[i]!)
        ) {
          this.m_hasOverlappingCutouts = true;
          break;
        }
      }
    }

    for (const drawing of this.m_boardEdge) {
      const d = drawing instanceof PCB_SHAPE ? drawing : null;

      if (!d) continue;

      switch (d.GetShape()) {
        case SHAPE_T.SEGMENT: {
          let a = new BE_SHAPE_POINT(d.GetStart());
          a.SetParent(d);
          this.m_shapeCollection.push(a);
          a = new BE_SHAPE_POINT(d.GetEnd());
          a.SetParent(d);
          this.m_shapeCollection.push(a);
          break;
        }

        case SHAPE_T.RECTANGLE: {
          const r = d.GetCornerRadius();

          if (r > 0) {
            // Rounded rectangle: decompose into arcs.
            // Normalize coordinates so x1 < x2 and y1 < y2.
            const x1 = Math.min(d.GetStart().x, d.GetEnd().x);
            const y1 = Math.min(d.GetStart().y, d.GetEnd().y);
            const x2 = Math.max(d.GetStart().x, d.GetEnd().x);
            const y2 = Math.max(d.GetStart().y, d.GetEnd().y);

            const w = x2 - x1;
            const h = y2 - y1;

            const addArc = (center: VECTOR2I, startPt: VECTOR2I, endPt: VECTOR2I): void => {
              const startAngle = EDA_ANGLE.fromVector(sub(startPt, center));
              let endAngle = EDA_ANGLE.fromVector(sub(endPt, center));

              while (endAngle.lt(startAngle)) endAngle = endAngle.add(ANGLE_360);

              const arc = new BE_SHAPE_ARC(center, r, startAngle, endAngle, startPt, endPt);
              arc.SetParent(d);
              this.m_shapeCollection.push(arc);
            };

            if (h === 2 * r) {
              // Horizontal stadium: left and right semicircles. The endpoint order
              // makes addArc sweep the outer half of each circle so the caps bulge
              // away from the slot.
              addArc({ x: x1 + r, y: y1 + r }, { x: x1 + r, y: y2 }, { x: x1 + r, y: y1 });
              addArc({ x: x2 - r, y: y1 + r }, { x: x2 - r, y: y1 }, { x: x2 - r, y: y2 });
            } else if (w === 2 * r) {
              // Vertical stadium: top and bottom semicircles
              addArc({ x: x1 + r, y: y1 + r }, { x: x1, y: y1 + r }, { x: x2, y: y1 + r });
              addArc({ x: x1 + r, y: y2 - r }, { x: x2, y: y2 - r }, { x: x1, y: y2 - r });
            } else {
              // General rounded rectangle: four quarter-circle arcs
              addArc({ x: x1 + r, y: y1 + r }, { x: x1, y: y1 + r }, { x: x1 + r, y: y1 });
              addArc({ x: x2 - r, y: y1 + r }, { x: x2 - r, y: y1 }, { x: x2, y: y1 + r });
              addArc({ x: x2 - r, y: y2 - r }, { x: x2, y: y2 - r }, { x: x2 - r, y: y2 });
              addArc({ x: x1 + r, y: y2 - r }, { x: x1 + r, y: y2 }, { x: x1, y: y2 - r });
            }
          } else {
            let a = new BE_SHAPE_POINT(d.GetStart());
            a.SetParent(d);
            this.m_shapeCollection.push(a);
            a = new BE_SHAPE_POINT(d.GetEnd());
            a.SetParent(d);
            this.m_shapeCollection.push(a);
            a = new BE_SHAPE_POINT({ x: d.GetEnd().x, y: d.GetStart().y });
            a.SetParent(d);
            this.m_shapeCollection.push(a);
            a = new BE_SHAPE_POINT({ x: d.GetStart().x, y: d.GetEnd().y });
            a.SetParent(d);
            this.m_shapeCollection.push(a);
          }

          break;
        }

        case SHAPE_T.POLY:
          for (const p of d.GetPolyPoints()) {
            const a = new BE_SHAPE_POINT(p);
            a.SetParent(d);
            this.m_shapeCollection.push(a);
          }

          break;

        case SHAPE_T.CIRCLE: {
          const a = new BE_SHAPE_CIRCLE(d.getCenter(), d.GetRadius());
          a.SetParent(d);
          this.m_shapeCollection.push(a);
          break;
        }

        case SHAPE_T.ARC: {
          // If the arc is not locally convex, only use the endpoints
          const [alpha, beta] = d.CalcArcAngles();
          const a = new BE_SHAPE_ARC(
            d.getCenter(),
            d.GetRadius(),
            alpha,
            beta,
            d.GetStart(),
            d.GetEnd(),
          );
          a.SetParent(d);

          this.m_shapeCollection.push(a);
          break;
        }

        default:
          break;
      }
    }
  }

  TransformCreepShapesToNodes(aShapes: readonly (CREEP_SHAPE | null)[]): void {
    for (const p1 of aShapes) {
      if (!p1) continue;

      switch (p1.GetType()) {
        case CREEP_SHAPE_TYPE.POINT:
          this.AddNode(GRAPH_NODE_TYPE.POINT, p1, p1.GetPos());
          break;
        case CREEP_SHAPE_TYPE.CIRCLE:
          this.AddNode(GRAPH_NODE_TYPE.CIRCLE, p1, p1.GetPos());
          break;
        case CREEP_SHAPE_TYPE.ARC:
          this.AddNode(GRAPH_NODE_TYPE.ARC, p1, p1.GetPos());
          break;
        default:
          break;
      }
    }
  }

  RemoveDuplicatedShapes(): void {
    // Sort the vector
    const coll: (CREEP_SHAPE | null)[] = this.m_shapeCollection.slice();
    coll.sort((a, b) => (compareShapes(a, b) ? -1 : compareShapes(b, a) ? 1 : 0));
    const newVector: CREEP_SHAPE[] = [];

    let i = 0;

    for (i = 0; i < coll.length - 1; i++) {
      if (coll[i] === null) continue;

      if (areEquivalent(coll[i]!, coll[i + 1]!)) {
        coll[i] = null;
      } else {
        newVector.push(coll[i]!);
      }
    }

    if (coll[i]) newVector.push(coll[i]!);

    this.m_shapeCollection = newVector;
  }

  // Add a node to the graph. If an equivalent node exists, returns the pointer of the existing node instead
  AddNode(
    aType: GRAPH_NODE_TYPE,
    parent: CREEP_SHAPE | null = null,
    pos: VECTOR2I = { x: 0, y: 0 },
  ): GRAPH_NODE {
    let gn = this.FindNode(aType, parent, pos);

    if (gn) return gn;

    gn = new GRAPH_NODE(aType, parent, pos);
    this.m_nodes.push(gn);
    this.m_nodeset.set(CREEPAGE_GRAPH.nodeKey(aType, parent, pos), gn);
    return gn;
  }

  AddNodeVirtual(): GRAPH_NODE {
    //Virtual nodes are always unique, do not try to find them
    const gn = new GRAPH_NODE(GRAPH_NODE_TYPE.VIRTUAL, null);
    this.m_nodes.push(gn);
    // The set keys on (type, parent, pos); every virtual node has the same key,
    // so only the latest one is findable - as in the C++, where the earlier one
    // stays in the unordered_set but the insert of an equal key is a no-op.
    const key = CREEPAGE_GRAPH.nodeKey(GRAPH_NODE_TYPE.VIRTUAL, null, gn.m_pos);
    if (!this.m_nodeset.has(key)) this.m_nodeset.set(key, gn);
    return gn;
  }

  AddConnection(
    aN1: GRAPH_NODE | null,
    aN2: GRAPH_NODE | null,
    aPc?: PATH_CONNECTION,
  ): GRAPH_CONNECTION | null {
    if (!aN1 || !aN2) return null;

    if (aPc === undefined) {
      const pc = new PATH_CONNECTION();
      pc.a1 = aN1.m_pos;
      pc.a2 = aN2.m_pos;
      pc.weight = 0;

      return this.AddConnection(aN1, aN2, pc);
    }

    // wxASSERT_MSG( ( aN1 != aN2 ), "Creepage: a connection connects a node to itself" );

    const gc = new GRAPH_CONNECTION(aN1, aN2, aPc);
    this.m_connections.push(gc);
    aN1.m_node_conns.add(gc);
    aN2.m_node_conns.add(gc);

    return gc;
  }

  FindNode(aType: GRAPH_NODE_TYPE, aParent: CREEP_SHAPE | null, aPos: VECTOR2I): GRAPH_NODE | null {
    return this.m_nodeset.get(CREEPAGE_GRAPH.nodeKey(aType, aParent, aPos)) ?? null;
  }

  RemoveConnection(aGc: GRAPH_CONNECTION | null, aDelete = false): void {
    if (!aGc) return;

    for (const gn of [aGc.n1, aGc.n2]) {
      if (gn) {
        gn.m_node_conns.delete(aGc);

        if (gn.m_node_conns.size === 0 && aDelete) {
          const it = this.m_nodes.indexOf(gn);

          if (it >= 0) this.m_nodes.splice(it, 1);

          const key = CREEPAGE_GRAPH.nodeKey(gn.m_type, gn.m_parent, gn.m_pos);

          if (this.m_nodeset.get(key) === gn) this.m_nodeset.delete(key);
        }
      }
    }

    if (aDelete) {
      // Remove the connection from the graph's connections
      this.m_connections = this.m_connections.filter((c) => c !== aGc);
    }
  }

  Trim(aWeightLimit: number): void {
    const toRemove: GRAPH_CONNECTION[] = [];

    // Collect connections to remove
    for (const gc of this.m_connections) {
      if (gc && gc.m_path.weight > aWeightLimit) toRemove.push(gc);
    }

    // Remove collected connections
    for (const gc of toRemove) this.RemoveConnection(gc);
  }

  Addshape(aShape: SHAPE, aConnectTo: GRAPH_NODE | null, aParent: BOARD_ITEM | null = null): void {
    let newshape: CREEP_SHAPE | null = null;

    if (!aConnectTo) return;

    switch (aShape.Type()) {
      case SHAPE_TYPE.SH_SEGMENT: {
        const segment = aShape as SHAPE_SEGMENT;
        newshape = new CU_SHAPE_SEGMENT(segment.GetSeg().A, segment.GetSeg().B, segment.GetWidth());
        break;
      }

      case SHAPE_TYPE.SH_CIRCLE: {
        const circle = aShape as SHAPE_CIRCLE;
        newshape = new CU_SHAPE_CIRCLE(circle.GetCenter(), circle.GetRadius());
        break;
      }

      case SHAPE_TYPE.SH_ARC: {
        const arc = aShape as SHAPE_ARC;

        const edaArc = new PCB_SHAPE(null, SHAPE_T.ARC);

        if (arc.IsClockwise()) {
          edaArc.SetArcGeometry(arc.GetP0(), arc.GetArcMid(), arc.GetP1());
        } else {
          edaArc.SetArcGeometry(arc.GetP1(), arc.GetArcMid(), arc.GetP0());
        }

        const [alpha, beta] = edaArc.CalcArcAngles();

        const cuarc = new CU_SHAPE_ARC(
          edaArc.getCenter(),
          edaArc.GetRadius(),
          alpha,
          beta,
          arc.GetP0(),
          arc.GetP1(),
        );
        cuarc.SetWidth(arc.GetWidth());
        newshape = cuarc;
        break;
      }

      case SHAPE_TYPE.SH_COMPOUND: {
        const shapes = (aShape as SHAPE_COMPOUND).Shapes();
        const nbShapes = shapes.length;
        for (const subshape of shapes) {
          if (subshape) {
            // We don't want to add shape for the inner rectangle of rounded rectangles
            if (!(subshape.Type() === SHAPE_TYPE.SH_RECT && nbShapes === 5))
              this.Addshape(subshape, aConnectTo, aParent);
          }
        }
        break;
      }

      case SHAPE_TYPE.SH_POLY_SET: {
        const polySet = aShape as SHAPE_POLY_SET;

        for (const it = polySet.CIterateSegmentsWithHoles(); it.valid(); it.Advance()) {
          const object = it.Get();
          const segment = new SHAPE_SEGMENT(object.A, object.B);
          this.Addshape(segment, aConnectTo, aParent);
        }
        break;
      }

      case SHAPE_TYPE.SH_LINE_CHAIN: {
        const lineChain = aShape as SHAPE_LINE_CHAIN;

        let prevPoint = lineChain.CLastPoint();

        for (const point of lineChain.CPoints()) {
          const segment = new SHAPE_SEGMENT(point, prevPoint);
          prevPoint = point;
          this.Addshape(segment, aConnectTo, aParent);
        }

        break;
      }

      case SHAPE_TYPE.SH_SIMPLE: {
        // SHAPE_SIMPLE is the arbitrary-polygon form used for rectangular, trapezoidal and
        // chamfered pads when they are not axis-aligned (orthogonal rotations collapse to
        // SH_RECT instead). Decompose its closed outline into segments so the copper edge
        // is added to the graph, otherwise the pad contributes no creepage anchor and the
        // path snaps to the pad hole instead of the copper (issue #24543).
        const simple = aShape as SHAPE_SIMPLE;
        const vertices = simple.Vertices();

        if (vertices.PointCount() < 3) break;

        let prevPoint = vertices.CLastPoint();

        for (const point of vertices.CPoints()) {
          if (!equal(point, prevPoint))
            this.Addshape(new SHAPE_SEGMENT(prevPoint, point), aConnectTo, aParent);

          prevPoint = point;
        }

        break;
      }

      case SHAPE_TYPE.SH_RECT: {
        const rect = aShape as SHAPE_RECT;

        const point0 = rect.GetPosition();
        const point1 = add(rect.GetPosition(), { x: rect.GetSize().x, y: 0 });
        const point2 = add(rect.GetPosition(), rect.GetSize());
        const point3 = add(rect.GetPosition(), { x: 0, y: rect.GetSize().y });

        this.Addshape(new SHAPE_SEGMENT(point0, point1), aConnectTo, aParent);
        this.Addshape(new SHAPE_SEGMENT(point1, point2), aConnectTo, aParent);
        this.Addshape(new SHAPE_SEGMENT(point2, point3), aConnectTo, aParent);
        this.Addshape(new SHAPE_SEGMENT(point3, point0), aConnectTo, aParent);
        break;
      }

      default:
        break;
    }

    if (!newshape) return;

    let gnShape: GRAPH_NODE | null = null;

    newshape.SetParent(aParent);

    switch (aShape.Type()) {
      case SHAPE_TYPE.SH_SEGMENT:
        gnShape = this.AddNode(GRAPH_NODE_TYPE.SEGMENT, newshape, newshape.GetPos());
        break;
      case SHAPE_TYPE.SH_CIRCLE:
        gnShape = this.AddNode(GRAPH_NODE_TYPE.CIRCLE, newshape, newshape.GetPos());
        break;
      case SHAPE_TYPE.SH_ARC:
        gnShape = this.AddNode(GRAPH_NODE_TYPE.ARC, newshape, newshape.GetPos());
        break;
      default:
        break;
    }

    if (gnShape) {
      this.m_shapeCollection.push(newshape);
      gnShape.m_net = aConnectTo.m_net;
      const gc = this.AddConnection(gnShape, aConnectTo);

      if (gc) gc.m_path.m_show = false;
    }
  }

  Solve(aFrom: GRAPH_NODE | null, aTo: GRAPH_NODE | null, aResult: GRAPH_CONNECTION[]): number {
    if (!aFrom || !aTo) return 0;

    if (aFrom === aTo) return 0;

    // Dijkstra's algorithm for shortest path
    const distances = new Map<GRAPH_NODE, number>();
    const previous = new Map<GRAPH_NODE, GRAPH_NODE>();

    const dist = (n: GRAPH_NODE): number => {
      // unordered_map::operator[] default-constructs a 0.0 for an unknown key
      let d = distances.get(n);

      if (d === undefined) {
        d = 0.0;
        distances.set(n, d);
      }

      return d;
    };

    // std::priority_queue<GRAPH_NODE*, ..., cmp>: top() is the smallest distance,
    // ties broken by the larger address ( `left > right` puts the higher address
    // first ).
    const pq: GRAPH_NODE[] = [];

    const pqLess = (left: GRAPH_NODE, right: GRAPH_NODE): boolean => {
      const distLeft = dist(left);
      const distRight = dist(right);

      if (distLeft === distRight) return ptrGreater(left, right); // Compare addresses to avoid ties.
      return distLeft > distRight;
    };

    const pqPush = (n: GRAPH_NODE): void => {
      pq.push(n);
      let i = pq.length - 1;

      while (i > 0) {
        const p = (i - 1) >> 1;

        if (pqLess(pq[p]!, pq[i]!)) {
          [pq[p], pq[i]] = [pq[i]!, pq[p]!];
          i = p;
        } else break;
      }
    };

    const pqPop = (): GRAPH_NODE => {
      const top = pq[0]!;
      const last = pq.pop()!;

      if (pq.length > 0) {
        pq[0] = last;
        let i = 0;

        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;

          if (l < pq.length && pqLess(pq[m]!, pq[l]!)) m = l;
          if (r < pq.length && pqLess(pq[m]!, pq[r]!)) m = r;

          if (m === i) break;

          [pq[m], pq[i]] = [pq[i]!, pq[m]!];
          i = m;
        }
      }

      return top;
    };

    // Initialize distances to infinity for all nodes except the starting node
    for (const node of this.m_nodes) {
      if (node !== null) distances.set(node, Number.POSITIVE_INFINITY); // Set to infinity
    }

    distances.set(aFrom, 0.0);
    distances.set(aTo, Number.POSITIVE_INFINITY);
    pqPush(aFrom);

    // Dijkstra's main loop
    while (pq.length > 0) {
      const current = pqPop();

      if (current === aTo) {
        break; // Shortest path found
      }

      // Traverse neighbors
      for (const connection of current.m_node_conns) {
        const neighbor = connection.n1 === current ? connection.n2 : connection.n1;

        if (!neighbor) continue;

        // Ignore connections with negative weights as Dijkstra doesn't support them.
        if (connection.m_path.weight < 0.0) {
          continue;
        }

        const alt = dist(current) + connection.m_path.weight; // Calculate alternative path cost

        if (alt < dist(neighbor)) {
          distances.set(neighbor, alt);
          previous.set(neighbor, current);
          pqPush(neighbor);
        }
      }
    }

    const pathWeight = dist(aTo);

    // If aTo is unreachable, return infinity
    if (pathWeight === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;

    // Trace back the path from aTo to aFrom
    let step: GRAPH_NODE = aTo;

    while (step !== aFrom) {
      const prevNode = previous.get(step) ?? null;

      for (const node_conn of step.m_node_conns) {
        if (
          (node_conn.n1 === prevNode && node_conn.n2 === step) ||
          (node_conn.n1 === step && node_conn.n2 === prevNode)
        ) {
          aResult.push(node_conn);
          break;
        }
      }
      step = prevNode!;
    }

    return pathWeight;
  }

  GeneratePaths(aMaxWeight: number, aLayer: PCB_LAYER_ID): void {
    const nodes: GRAPH_NODE[] = [];

    const trackIndex: TRACK_RTREE = new RTree<CREEPAGE_TRACK_ENTRY>();

    if (aLayer !== LAYER.Edge_Cuts) {
      for (const track of this.m_board.Tracks()) {
        if (track && track.Type() === KICAD_T.PCB_TRACE_T && track.IsOnLayer(aLayer)) {
          const sh = track.GetEffectiveShape();

          if (sh && sh.Type() === SHAPE_TYPE.SH_SEGMENT) {
            const entry: CREEPAGE_TRACK_ENTRY = {
              segment: new SEG(track.GetStart(), track.GetEnd()),
              layer: aLayer,
            };

            const bbox = track.GetBoundingBox();
            trackIndex.Insert(
              [bbox.GetX(), bbox.GetY()],
              [bbox.GetRight(), bbox.GetBottom()],
              entry,
            );
          }
        }
      }
    }

    for (const gn of this.m_nodes) {
      if (gn && gn.m_parent && gn.m_connectDirectly && gn.m_type !== GRAPH_NODE_TYPE.VIRTUAL)
        nodes.push(gn);
    }

    nodes.sort((gn1: GRAPH_NODE, gn2: GRAPH_NODE): number => {
      const p1 = ptrOrdinal(gn1.m_parent!);
      const p2 = ptrOrdinal(gn2.m_parent!);

      if (p1 !== p2) return p1 - p2;
      return gn1.m_net - gn2.m_net;
    });

    // Build parent -> net -> nodes mapping for efficient filtering
    // Also cache bounding boxes for early spatial filtering
    const parent_net_groups = new Map<BOARD_ITEM | null, Map<number, GRAPH_NODE[]>>();
    const parent_bboxes = new Map<BOARD_ITEM, BOX2I>();
    const parent_keys: (BOARD_ITEM | null)[] = [];

    for (const gn of nodes) {
      const parent = gn.m_parent!.GetParent();

      let groups = parent_net_groups.get(parent);

      if (!groups) {
        groups = new Map();
        parent_net_groups.set(parent, groups);
      }

      if (groups.size === 0) {
        parent_keys.push(parent);
        if (parent) parent_bboxes.set(parent, parent.GetBoundingBox());
      }

      let list = groups.get(gn.m_net);

      if (!list) {
        list = [];
        groups.set(gn.m_net, list);
      }

      list.push(gn);
    }

    // Generate work items using parent-level spatial indexing
    const work_items: [GRAPH_NODE, GRAPH_NODE][] = [];

    // Use RTree for spatial indexing of parent bounding boxes
    // Expand each bbox by maxWeight to find potentially overlapping parents

    const maxDist = Math.trunc(aMaxWeight);

    const parentIndex = new RTree<ParentEntry>();
    const parentEntries: ParentEntry[] = [];

    // Build list of non-null parents first
    for (const parent of parent_keys) {
      if (parent) parentEntries.push({ parent, bbox: parent_bboxes.get(parent)! });
    }

    // Insert into RTree
    for (const entry of parentEntries) {
      parentIndex.Insert(
        [entry.bbox.GetLeft(), entry.bbox.GetTop()],
        [entry.bbox.GetRight(), entry.bbox.GetBottom()],
        entry,
      );
    }

    const searchParent = (i: number): boolean => {
      const entry1 = parentEntries[i]!;
      const parent1 = entry1.parent;
      const bbox1 = entry1.bbox;

      const localWorkItems: [GRAPH_NODE, GRAPH_NODE][] = [];

      // Search for parents within maxDist of bbox1
      const searchMin = [bbox1.GetLeft() - maxDist, bbox1.GetTop() - maxDist];
      const searchMax = [bbox1.GetRight() + maxDist, bbox1.GetBottom() + maxDist];

      parentIndex.Search(searchMin, searchMax, (entry2: ParentEntry): boolean => {
        const parent2 = entry2.parent;

        // Only process if parent1 < parent2 to avoid duplicates
        if (ptrOrdinal(parent1) >= ptrOrdinal(parent2)) return true;

        // Precise bbox distance check
        const bbox2 = entry2.bbox;

        let bboxDistX = 0;
        if (bbox2.GetLeft() > bbox1.GetRight()) bboxDistX = bbox2.GetLeft() - bbox1.GetRight();
        else if (bbox1.GetLeft() > bbox2.GetRight()) bboxDistX = bbox1.GetLeft() - bbox2.GetRight();

        let bboxDistY = 0;
        if (bbox2.GetTop() > bbox1.GetBottom()) bboxDistY = bbox2.GetTop() - bbox1.GetBottom();
        else if (bbox1.GetTop() > bbox2.GetBottom()) bboxDistY = bbox1.GetTop() - bbox2.GetBottom();

        const bboxDistSq = bboxDistX * bboxDistX + bboxDistY * bboxDistY;
        if (bboxDistSq > maxDist * maxDist) return true;

        // Get nodes for both parents
        const it1 = parent_net_groups.get(parent1);
        const it2 = parent_net_groups.get(parent2);

        if (!it1 || !it2) return true;

        for (const [net1, nodes1] of it1) {
          for (const [net2, nodes2] of it2) {
            // Skip same net if both are conductive
            if (net1 === net2 && nodes1.length > 0 && nodes2.length > 0) {
              if (nodes1[0]!.m_parent!.IsConductive() && nodes2[0]!.m_parent!.IsConductive())
                continue;
            }

            for (const gn1 of nodes1) {
              for (const gn2 of nodes2) {
                const pos1 = gn1.m_parent!.GetPos();
                const pos2 = gn2.m_parent!.GetPos();
                const r1 = gn1.m_parent!.GetRadius();
                const r2 = gn2.m_parent!.GetRadius();

                const centerDistSq = SquaredEuclideanNorm(sub(pos1, pos2));
                const threshold = aMaxWeight + r1 + r2;
                const thresholdSq = threshold * threshold;

                if (centerDistSq > thresholdSq) continue;

                localWorkItems.push([gn1, gn2]);
              }
            }
          }
        }

        return true;
      });

      // Merge local results into global
      if (localWorkItems.length > 0) work_items.push(...localWorkItems);

      return true;
    };

    for (let i = 0; i < parentEntries.length; ++i) searchParent(i);

    // Generate work items for same-parent node pairs. The cross-parent search above
    // skips pairs where parent1 == parent2, but creepage paths between different edge
    // segments of the same slot (which share a footprint grandparent) are needed for
    // the path to navigate around the slot geometry. Also handles null-parent nodes
    // (e.g. NPTH pad shapes) which were excluded from the RTree search entirely.
    for (const [, net_groups] of parent_net_groups) {
      const sameParentNodes: GRAPH_NODE[] = [];

      for (const [, nodeList] of net_groups) sameParentNodes.push(...nodeList);

      for (let i = 0; i < sameParentNodes.length; i++) {
        for (let j = i + 1; j < sameParentNodes.length; j++) {
          const gn1 = sameParentNodes[i]!;
          const gn2 = sameParentNodes[j]!;

          // ConnectChildren already handles nodes on the same CREEP_SHAPE
          if (gn1.m_parent === gn2.m_parent) continue;

          // Skip same-net conductive pairs
          if (
            gn1.m_parent!.IsConductive() &&
            gn2.m_parent!.IsConductive() &&
            gn1.m_net === gn2.m_net
          ) {
            continue;
          }

          const pos1 = gn1.m_parent!.GetPos();
          const pos2 = gn2.m_parent!.GetPos();
          const r1 = gn1.m_parent!.GetRadius();
          const r2 = gn2.m_parent!.GetRadius();

          const centerDistSq = SquaredEuclideanNorm(sub(pos1, pos2));
          const threshold = aMaxWeight + r1 + r2;
          const thresholdSq = threshold * threshold;

          if (centerDistSq > thresholdSq) continue;

          work_items.push([gn1, gn2]);
        }
      }
    }

    const processWorkItems = (idx: number): boolean => {
      const [gn1, gn2] = work_items[idx]!;

      // Distance filtering already done during work item creation
      const shape1 = gn1.m_parent!;
      const shape2 = gn2.m_parent!;

      for (const pc of GetPaths(shape1, shape2, aMaxWeight)) {
        const IgnoreForTest: BOARD_ITEM[] = [];

        // Don't ignore the whole parent board item for arc/circle ends. The
        // tangent touch is already handled by the endpoint exclusion in
        // segmentIntersectsArc/Circle (issue #24286). A rounded slot is a single
        // PCB_SHAPE, so ignoring the parent would exempt every other edge of the
        // same slot and let a path cut across it.

        // Ignore each CU shape's own parent for the endpoint-inside-track
        // test so we don't reject paths that touch the track's own edge.
        if (shape1.IsConductive()) IgnoreForTest.push(shape1.GetParent()!);

        if (shape2.IsConductive()) IgnoreForTest.push(shape2.GetParent()!);

        const valid = pc.isValid(
          this.m_board,
          aLayer,
          this.m_boardEdge,
          IgnoreForTest,
          this.m_boardOutline,
          [false, true],
          this.m_minGrooveWidth,
          trackIndex,
        );

        if (!valid) {
          continue;
        }

        let connect1: GRAPH_NODE = gn1;
        let connect2: GRAPH_NODE = gn2;

        // Handle non-point node1
        if (gn1.m_parent!.GetType() !== CREEP_SHAPE_TYPE.POINT) {
          const gnt1 = this.AddNode(GRAPH_NODE_TYPE.POINT, gn1.m_parent, toI(pc.a1));
          gnt1.m_connectDirectly = false;
          connect1 = gnt1;

          if (gn1.m_parent!.IsConductive()) {
            const gc = this.AddConnection(gn1, gnt1);
            if (gc) gc.m_path.m_show = false;
          }
        }

        // Handle non-point node2
        if (gn2.m_parent!.GetType() !== CREEP_SHAPE_TYPE.POINT) {
          const gnt2 = this.AddNode(GRAPH_NODE_TYPE.POINT, gn2.m_parent, toI(pc.a2));
          gnt2.m_connectDirectly = false;
          connect2 = gnt2;

          if (gn2.m_parent!.IsConductive()) {
            const gc = this.AddConnection(gn2, gnt2);
            if (gc) gc.m_path.m_show = false;
          }
        }

        this.AddConnection(connect1, connect2, pc);
      }

      return true;
    };

    for (let ii = 0; ii < work_items.length; ii++) processWorkItems(ii);
  }

  AddNetElements(aNetCode: number, aLayer: PCB_LAYER_ID, _aMaxCreepage: number): GRAPH_NODE {
    const virtualNode = this.AddNodeVirtual();
    virtualNode.m_net = aNetCode;

    for (const footprint of this.m_board.Footprints()) {
      for (const pad of footprint.Pads()) {
        if (pad.GetNetCode() !== aNetCode || !pad.IsOnLayer(aLayer)) continue;

        const padShape = pad.GetEffectiveShape(aLayer);
        if (padShape) this.Addshape(padShape, virtualNode, pad);
      }
    }

    for (const track of this.m_board.Tracks()) {
      if (track.GetNetCode() !== aNetCode || !track.IsOnLayer(aLayer)) continue;

      const shape = track.GetEffectiveShape();
      if (shape) this.Addshape(shape, virtualNode, track);
    }

    for (const zone of this.m_board.Zones()) {
      if (zone.GetNetCode() !== aNetCode || !zone.IsOnLayer(aLayer)) continue;

      const shape = zone.GetEffectiveShape(aLayer);
      if (shape) this.Addshape(shape, virtualNode, zone);
    }

    const drawings = this.m_board.Drawings();

    for (const drawing of drawings) {
      if (drawing.IsConnected()) {
        const bci = drawing as BOARD_CONNECTED_ITEM;

        if (bci.GetNetCode() !== aNetCode || !bci.IsOnLayer(aLayer)) continue;

        const shape = bci.GetEffectiveShape();
        if (shape) this.Addshape(shape, virtualNode, bci);
      }
    }

    return virtualNode;
  }

  SetTarget(aTarget: number): void {
    this.m_creepageTarget = aTarget;
    this.m_creepageTargetSquared = aTarget * aTarget;
  }

  GetTarget(): number {
    return this.m_creepageTarget;
  }
}
