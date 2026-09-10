// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `doConvertOutlineToPolygon` and `BuildBoardPolygonOutlines`
 * (pcbnew/convert_shape_list_to_polygon.cpp): the Edge.Cuts graphics chained
 * into closed contours, sorted into outlines and holes, and made into one
 * polygon set.
 *
 * What makes this a transcription rather than "chain the shapes":
 *
 *  - a chain is grown from a start shape FORWARD from its end, then BACKWARD
 *    from its start, each step taking the nearest free endpoint within the
 *    chaining epsilon (`findNext`, the two nearest endpoints only);
 *  - every shape is walked from the point the chain ARRIVED at — `aPrevPt` —
 *    and an arc is rebuilt as `SHAPE_ARC( aPrevPt, mid, end )`, so a
 *    neighbour's endpoint a few units off the arc's own start moves every
 *    vertex of its polyline by a unit or so (CM5's rounded corners);
 *  - the last point of a contour whose ends only nearly meet is SNAPPED onto
 *    the first (`SetPoint( -1, CPoint( 0 ) )`), or the closing arc is rebuilt
 *    to end there;
 *  - `SHAPE_LINE_CHAIN::Append` never repeats the last point, and
 *    `SetClosed( true )` drops a last point equal to the first.
 */

import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import {
  booleanSubtract,
  type Polygon,
  simplify,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { rescale64 } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { arcConvertToPolyline, constructArcFromStartEndAngle } from './router/shape_arc_ops.js';
import { ANGLE_360 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { PcbShape } from './types.js';

/** `close_enough`: within `aLimit`, squared, inclusive. */
const closeEnough = (a: Vec2, b: Vec2, limit: number): boolean => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= limit * limit;
};

/** `closer_to_first`: strictly closer to the first point. */
const closerToFirst = (ref: Vec2, first: Vec2, second: Vec2): boolean => {
  const d1x = ref.x - first.x;
  const d1y = ref.y - first.y;
  const d2x = ref.x - second.x;
  const d2y = ref.y - second.y;
  return d1x * d1x + d1y * d1y < d2x * d2x + d2y * d2y;
};

const samePt = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * `SHAPE_LINE_CHAIN` as this needs it: `Append( pt )` skips a point equal to
 * the last one; `Append( chain )` skips the chain's first point when it equals
 * the last one; `SetClosed( true )` drops a last point equal to the first.
 */
class Chain {
  pts: Vec2[] = [];
  closed = false;

  append(p: Vec2): void {
    if (this.pts.length === 0 || !samePt(this.pts[this.pts.length - 1]!, p))
      this.pts.push({ x: p.x, y: p.y });
  }

  appendChain(other: readonly Vec2[]): void {
    if (other.length === 0) return;
    if (this.pts.length === 0 || !samePt(other[0]!, this.pts[this.pts.length - 1]!))
      this.pts.push({ ...other[0]! });
    for (let i = 1; i < other.length; i++) this.pts.push({ ...other[i]! });
    this.mergeFirstLastPointIfNeeded();
  }

  setClosed(closed: boolean): void {
    this.closed = closed;
    this.mergeFirstLastPointIfNeeded();
  }

  private mergeFirstLastPointIfNeeded(): void {
    if (this.closed && this.pts.length > 1 && samePt(this.pts[0]!, this.pts[this.pts.length - 1]!))
      this.pts.pop();
  }

  /**
   * `SHAPE_LINE_CHAIN_BASE::PointInside( aPt, 0, true )`: a ray in +x, the
   * crossing abscissa in `rescale` integer arithmetic.
   */
  pointInside(p: Vec2): boolean {
    if (!this.closed || this.pts.length < 3) return false;
    const n = this.pts.length;
    let inside = false;
    for (let i = 0; i < n; ) {
      const p1 = this.pts[i++]!;
      const p2 = this.pts[i === n ? 0 : i]!;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      if (dy === 0) continue;
      const d = Number(rescale64(BigInt(dx), BigInt(p.y - p1.y), BigInt(dy)));
      if (p1.y >= p.y !== p2.y >= p.y && p.x - p1.x < d) inside = !inside;
    }
    return inside;
  }
}

/** `PCB_SHAPE::GetStart()` / `GetEnd()` for the endpoint index. */
const startOf = (s: PcbShape): Vec2 | undefined =>
  s.kind === 'circle' ? s.center : s.kind === 'poly' ? s.pts?.[0] : s.start;
const endOf = (s: PcbShape): Vec2 | undefined =>
  s.kind === 'poly' ? s.pts?.[s.pts.length - 1] : s.end;

/** `SHAPE_ARC arc360( center, start, ANGLE_360, 0 )`, polygonised. */
function circlePolyline(center: Vec2, radius: number, errorMax: number): Vec2[] {
  const start = { x: center.x + radius, y: center.y };
  return arcConvertToPolyline(constructArcFromStartEndAngle(start, center, ANGLE_360, 0), errorMax);
}

/** `SHAPE_ARC sarc( pstart, pmid, pend, 0 ); chain.Append( sarc, aErrorMax )`. */
const arcPolyline = (start: Vec2, mid: Vec2, end: Vec2, errorMax: number): Vec2[] =>
  arcConvertToPolyline({ p0: start, arcMid: mid, p1: end, width: 0 }, errorMax);

/** `EDA_SHAPE::GetRadius()` for a circle: `KiROUND( hypot )` — the distance centre → end. */
const circleRadius = (s: PcbShape): number => {
  const c = s.center!;
  const e = s.end!;
  return Math.round(Math.hypot(e.x - c.x, e.y - c.y));
};

function processClosedShape(s: PcbShape, contour: Chain, errorMax: number): void {
  switch (s.kind) {
    case 'poly':
      for (const p of s.pts ?? []) contour.append(p);
      contour.setClosed(true);
      break;
    case 'circle':
      if (s.center && s.end)
        contour.appendChain(circlePolyline(s.center, circleRadius(s), errorMax));
      contour.setClosed(true);
      break;
    case 'rect':
      if (s.start && s.end) {
        // `GetRectCorners`: start, (end.x, start.y), end, (start.x, end.y)
        for (const p of [
          s.start,
          { x: s.end.x, y: s.start.y },
          s.end,
          { x: s.start.x, y: s.end.y },
        ])
          contour.append(p);
      }
      contour.setClosed(true);
      break;
    default:
      break;
  }
}

/** `processShapeSegment`: walk one open shape on from `prev`, returning the new `prev`. */
function processShapeSegment(
  s: PcbShape,
  contour: Chain,
  prev: Vec2,
  errorMax: number,
  chainingEpsilon: number,
): Vec2 {
  const start = s.start;
  const end = s.end;
  if (!start || !end) return prev;
  switch (s.kind) {
    case 'line': {
      const nextPt = closerToFirst(prev, start, end) ? end : start;
      contour.append(nextPt);
      return nextPt;
    }
    case 'arc': {
      if (!s.mid) return prev;
      let pstart = start;
      let pend = end;
      if (!closeEnough(prev, pstart, chainingEpsilon)) {
        if (!closeEnough(prev, end, chainingEpsilon)) return prev;
        [pstart, pend] = [pend, pstart];
      }
      pstart = prev;
      contour.appendChain(arcPolyline(pstart, s.mid, pend, errorMax));
      return pend;
    }
    case 'curve': {
      const ctrl = s.pts;
      if (!ctrl || (ctrl.length !== 3 && ctrl.length !== 4)) return prev;
      let nextPt: Vec2;
      let reverse = false;
      if (closerToFirst(prev, start, end)) nextPt = end;
      else {
        nextPt = start;
        reverse = true;
      }
      const bez = new BezierPoly(ctrl).getPoly(errorMax);
      let p = prev;
      const order = reverse ? [...bez].reverse() : bez;
      for (const pt of order) {
        if (samePt(p, pt)) continue;
        contour.append(pt);
        p = pt;
      }
      return nextPt;
    }
    default:
      return prev;
  }
}

export interface OutlineResult {
  success: boolean;
  polygons: Polygon[];
}

/**
 * `doConvertOutlineToPolygon( aShapeList, aPolygons, aErrorMax,
 * aChainingEpsilon, aAllowDisjoint, nullptr, false, cleaner )`.
 *
 * `startCandidates` is a `std::set<PCB_SHAPE*>` — pointer order, which for
 * items the parser allocated one after another is the list's order.
 */
export function doConvertOutlineToPolygon(
  shapeList: readonly PcbShape[],
  errorMax: number,
  chainingEpsilon: number,
  allowDisjoint: boolean,
): OutlineResult {
  if (shapeList.length === 0) return { success: true, polygons: [] };

  // `PCB_SHAPE_ENDPOINTS_ADAPTOR`: start and end of every shape, in list order.
  const endpoints: { pt: Vec2; shape: PcbShape }[] = [];
  for (const s of shapeList) {
    const a = startOf(s);
    const b = endOf(s);
    if (a) endpoints.push({ pt: a, shape: s });
    if (b) endpoints.push({ pt: b, shape: s });
  }

  // `findNext`: the two nearest endpoints of ANY shape, then the closest of
  // those that is not `shape` itself and is within the epsilon.
  const findNext = (shape: PcbShape, point: Vec2): PcbShape | null => {
    let best: { d: number; e: (typeof endpoints)[number] } | null = null;
    let second: { d: number; e: (typeof endpoints)[number] } | null = null;
    for (const e of endpoints) {
      const dx = e.pt.x - point.x;
      const dy = e.pt.y - point.y;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) {
        second = best;
        best = { d, e };
      } else if (!second || d < second.d) second = { d, e };
    }
    if (!best) return null;
    let closest: PcbShape | null = null;
    let closestD = chainingEpsilon * chainingEpsilon;
    for (const c of [best, second]) {
      if (!c || c.e.shape === shape) continue;
      if (c.d < closestD) {
        closestD = c.d;
        closest = c.e.shape;
      }
    }
    return closest;
  };

  const used = new Set<PcbShape>();
  const startCandidates = [...shapeList];
  const contours: Chain[] = [];

  while (startCandidates.length) {
    const graphic = startCandidates.shift()!;
    used.add(graphic);

    const contour = new Chain();
    contours.push(contour);

    if (graphic.kind === 'poly' || graphic.kind === 'circle' || graphic.kind === 'rect') {
      processClosedShape(graphic, contour, errorMax);
      continue;
    }

    // A malformed graphic (a line with no end point) is a contour that can
    // never close: the whole build fails, as upstream's does.
    if (!startOf(graphic) || !endOf(graphic)) return { success: false, polygons: [] };

    const chain: PcbShape[] = [graphic];
    let closed = false;
    let frontPt = startOf(graphic)!;
    let backPt = endOf(graphic)!;

    const extendChain = (forward: boolean): void => {
      let curr = forward ? chain[chain.length - 1]! : chain[0]!;
      let prev = forward ? backPt : frontPt;
      for (;;) {
        const next = findNext(curr, prev);
        if (next && !used.has(next)) {
          used.add(next);
          const at = startCandidates.indexOf(next);
          if (at >= 0) startCandidates.splice(at, 1);
          if (forward) chain.push(next);
          else chain.unshift(next);
          const ns = startOf(next)!;
          const ne = endOf(next)!;
          prev = closerToFirst(prev, ns, ne) ? ne : ns;
          curr = next;
          continue;
        }
        if (next) {
          const chainEnd = forward ? chain[0]! : chain[chain.length - 1]!;
          const chainPt = forward ? frontPt : backPt;
          if (next === chainEnd && closeEnough(prev, chainPt, chainingEpsilon)) closed = true;
        }
        if (forward) backPt = prev;
        else frontPt = prev;
        break;
      }
    };

    extendChain(true);
    if (!closed) extendChain(false);

    const first = chain[0]!;
    let startPt: Vec2;
    if (chain.length > 1) {
      const second = chain[1]!;
      const fs = startOf(first)!;
      if (
        closeEnough(fs, startOf(second)!, chainingEpsilon) ||
        closeEnough(fs, endOf(second)!, chainingEpsilon)
      )
        startPt = endOf(first)!;
      else startPt = fs;
    } else startPt = startOf(first)!;

    contour.append(startPt);
    let prevPt = startPt;
    for (const s of chain)
      prevPt = processShapeSegment(s, contour, prevPt, errorMax, chainingEpsilon);

    // "Handle contour closure"
    const pts = contour.pts;
    if (closeEnough(pts[0]!, pts[pts.length - 1]!, chainingEpsilon)) {
      if (!samePt(pts[0]!, pts[pts.length - 1]!) && pts.length > 2) {
        // The chain's arcs were cleared (`aAllowUseArcsInPolygons` false), so
        // the last point is never an arc end here: it is snapped onto the first.
        pts[pts.length - 1] = { ...pts[0]! };
      }
      contour.setClosed(true);
    }
  }

  // "Ensure all contours are closed"
  for (const c of contours) if (!c.closed) return { success: false, polygons: [] };

  // `buildContourHierarchy`: parents = the other contours containing the first point.
  const parents = new Map<number, number[]>();
  contours.forEach((c, i) => {
    if (c.pts.length < 1) return;
    const list: number[] = [];
    contours.forEach((other, j) => {
      if (j !== i && other.pointInside(c.pts[0]!)) list.push(j);
    });
    parents.set(i, list);
  });

  // `addOutlinesToPolygon`: with no error handler a second outline is added
  // regardless of `aAllowDisjoint`.
  const polygons: Polygon[] = [];
  const outlineOf = new Map<number, number>();
  for (const [i, list] of parents) {
    if (list.length % 2 !== 0) continue;
    void allowDisjoint;
    outlineOf.set(i, polygons.length);
    polygons.push([contours[i]!.pts]);
  }

  // `addHolesToPolygon` (no malformed overlap handling: `hasOverlappingClosedContours`
  // is only consulted to fall back to booleans, which a sound outline never needs).
  for (const [i, list] of parents) {
    if (list.length % 2 !== 1) continue;
    for (const parent of list) {
      if (parents.get(parent)!.length === list.length - 1) {
        const idx = outlineOf.get(parent);
        if (idx !== undefined) polygons[idx]!.push(contours[i]!.pts);
        break;
      }
    }
  }

  // `checkSelfIntersections` only reports; the polygon set is what it is.
  return { success: true, polygons };
}

/**
 * `BuildBoardPolygonOutlines( aBoard, aOutlines, aErrorMax, aChainingEpsilon,
 * aInferOutlineIfNecessary = false, nullptr, false )` up to the inferred
 * rectangle: the board's Edge.Cuts shapes, then `fpHoles.Simplify();
 * aOutlines.BooleanSubtract( fpHoles )` — a Clipper pass even with no holes.
 *
 * `fpHoles` are the footprints whose Edge.Cuts close on their own and hold
 * copper outside of that outline (or more than one outline); the caller
 * supplies that judgement, as `isCopperOutside` needs the pads.
 */
export function buildBoardPolygonOutlines(
  boardShapes: readonly PcbShape[],
  footprintShapes: readonly {
    shapes: readonly PcbShape[];
    copperOutside: (o: Polygon[]) => boolean;
  }[],
  errorMax: number,
  chainingEpsilon: number,
): OutlineResult {
  const fpHoles: Polygon[] = [];
  const skip = new Set<PcbShape>();
  let success = false;
  for (const fp of footprintShapes) {
    const fpSegList = fp.shapes.filter((s) => s.layer === 'Edge.Cuts');
    if (fpSegList.length === 0) continue;
    const r = doConvertOutlineToPolygon(fpSegList, errorMax, chainingEpsilon, false);
    success = r.success;
    if (success && (fp.copperOutside(r.polygons) || r.polygons.length > 1)) {
      fpHoles.push(...r.polygons);
      for (const s of fpSegList) skip.add(s);
    }
  }

  // `PCB_TYPE_COLLECTOR::Collect( aBoard, { PCB_SHAPE_T } )` visits the
  // footprints before the drawings — which is also the file's order, and so
  // the parser's allocation order that the pointer-ordered set follows.
  const segList: PcbShape[] = [];
  for (const s of [...footprintShapes.flatMap((f) => f.shapes), ...boardShapes])
    if (!skip.has(s) && s.layer === 'Edge.Cuts') segList.push(s);

  let polygons: Polygon[] = [];
  if (segList.length) {
    const r = doConvertOutlineToPolygon(segList, errorMax, chainingEpsilon, true);
    success = r.success;
    polygons = r.polygons;
  }

  polygons = booleanSubtract(polygons, simplify(fpHoles));
  return { success, polygons };
}
