// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/convert_shape_list_to_polygon.h` / `.cpp`: `ConvertOutlineToPolygon`,
 * a polygon set with holes from a `PCB_SHAPE` list, and the helpers it chains
 * shapes with.
 *
 * The nanoflann KD-tree of the C++ answers "the two nearest shape endpoints";
 * `nearestTwoEndpoints` answers the same question by scanning the endpoint
 * list, which is the answer the tree gives without the tree.
 *
 */

import { SKIP_STRUCT } from '@ziroeda/common/src/eda_item_flags.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { ANGLE_360 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ROUNDRECT } from '@ziroeda/kimath/src/geometry/roundrect.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import {
  type INTERSECTIONS,
  SHAPE_LINE_CHAIN,
} from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import {
  LexicographicalCompare,
  type VECTOR2I,
  equal,
  sub,
} from '@ziroeda/kimath/src/math/vector2.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import { PCB_TYPE_COLLECTOR } from './collectors.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_SHAPE } from './pcb_shape.js';

export type OUTLINE_ERROR_HANDLER = (
  msg: string,
  itemA: BOARD_ITEM | null,
  itemB: BOARD_ITEM | null,
  pt: VECTOR2I,
) => void;

/** `class SCOPED_FLAGS_CLEANER : public std::unordered_set<EDA_ITEM*>`: clears the flags of every item it holds on exit. */
class SCOPED_FLAGS_CLEANER extends Set<BOARD_ITEM> {
  private m_flagsToClear: number;

  constructor(aFlagsToClear: number) {
    super();
    this.m_flagsToClear = aFlagsToClear;
  }

  /** The destructor. */
  dispose(): void {
    for (const item of this) item.ClearFlags(this.m_flagsToClear);
  }
}

/**
 * Local and tunable method of qualifying the proximity of two points.
 *
 * @param aLeft is the first point.
 * @param aRight is the second point.
 * @param aLimit is a measure of proximity that the caller knows about.
 * @return true if the two points are close enough, else false.
 */
function close_enough(aLeft: VECTOR2I, aRight: VECTOR2I, aLimit: number): boolean {
  const d = sub(aLeft, aRight);
  return d.x * d.x + d.y * d.y <= SEG.Square(aLimit);
}

/**
 * Local method which qualifies whether the start or end point of a segment is closest to a point.
 *
 * @param aRef is the reference point
 * @param aFirst is the first point
 * @param aSecond is the second point
 * @return true if the first point is closest to the reference, otherwise false.
 */
function closer_to_first(aRef: VECTOR2I, aFirst: VECTOR2I, aSecond: VECTOR2I): boolean {
  const d1 = sub(aRef, aFirst);
  const d2 = sub(aRef, aSecond);
  return d1.x * d1.x + d1.y * d1.y < d2.x * d2.x + d2.y * d2.y;
}

/** `PCB_SHAPE_ENDPOINTS_ADAPTOR`: the start and end of every shape, as the KD-tree indexes them. */
class PCB_SHAPE_ENDPOINTS_ADAPTOR {
  endpoints: [VECTOR2I, PCB_SHAPE][] = [];

  constructor(shapes: readonly PCB_SHAPE[]) {
    for (const shape of shapes) {
      this.endpoints.push([shape.GetStart(), shape]);
      this.endpoints.push([shape.GetEnd(), shape]);
    }
  }
}

/** `kdTree.knnSearch( query_pt, 2, indices, distances )`: the two nearest endpoints, squared distances. */
function nearestTwoEndpoints(
  adaptor: PCB_SHAPE_ENDPOINTS_ADAPTOR,
  aPoint: VECTOR2I,
): { indices: number[]; distances: number[] } {
  let i0 = -1;
  let i1 = -1;
  let d0 = Number.MAX_VALUE;
  let d1 = Number.MAX_VALUE;

  for (let i = 0; i < adaptor.endpoints.length; ++i) {
    const p = adaptor.endpoints[i]![0];
    const dx = p.x - aPoint.x;
    const dy = p.y - aPoint.y;
    const d = dx * dx + dy * dy;

    if (d < d0) {
      i1 = i0;
      d1 = d0;
      i0 = i;
      d0 = d;
    } else if (d < d1) {
      i1 = i;
      d1 = d;
    }
  }

  return { indices: [i0, i1], distances: [d0, d1] };
}

/** `std::map<std::pair<VECTOR2I, VECTOR2I>, PCB_SHAPE*>`, keyed by the two points. */
type SHAPE_OWNERS = Map<string, PCB_SHAPE>;

const ownerKey = (a: VECTOR2I, b: VECTOR2I): string => `${a.x},${a.y}|${b.x},${b.y}`;

function processClosedShape(
  aShape: PCB_SHAPE,
  aContour: SHAPE_LINE_CHAIN,
  aShapeOwners: SHAPE_OWNERS,
  aErrorMax: number,
  aAllowUseArcsInPolygons: boolean,
): void {
  switch (aShape.GetShape()) {
    case SHAPE_T.POLY: {
      let prevPt: VECTOR2I = { x: 0, y: 0 };
      let firstPt = true;

      for (const pt of aShape.GetPolyShape().CIterate()) {
        aContour.Append(pt);

        if (firstPt) firstPt = false;
        else aShapeOwners.set(ownerKey(prevPt, pt), aShape);

        prevPt = pt;
      }

      aContour.SetClosed(true);
      break;
    }

    case SHAPE_T.CIRCLE: {
      const center = aShape.GetCenter();
      const radius = aShape.GetRadius();
      const start = { x: center.x + radius, y: center.y };

      const arc360 = new SHAPE_ARC(center, start, ANGLE_360, 0);
      aContour.Append(arc360, aErrorMax);
      aContour.SetClosed(true);

      for (let ii = 1; ii < aContour.PointCount(); ++ii)
        aShapeOwners.set(ownerKey(aContour.CPoint(ii - 1), aContour.CPoint(ii)), aShape);

      if (!aAllowUseArcsInPolygons) aContour.ClearArcs();

      break;
    }

    case SHAPE_T.RECTANGLE: {
      if (aShape.GetCornerRadius() > 0) {
        const rr = new ROUNDRECT(
          new SHAPE_RECT(
            aShape.GetStart(),
            aShape.GetRectangleWidth(),
            aShape.GetRectangleHeight(),
          ),
          aShape.GetCornerRadius(),
          true /* normalize */,
        );
        const poly = new SHAPE_POLY_SET();
        rr.TransformToPolygon(poly, aShape.GetMaxError());
        aContour.Append(poly.Outline(0));

        for (let ii = 1; ii < aContour.PointCount(); ++ii)
          aShapeOwners.set(ownerKey(aContour.CPoint(ii - 1), aContour.CPoint(ii)), aShape);

        if (!aAllowUseArcsInPolygons) aContour.ClearArcs();

        aContour.SetClosed(true);
        break;
      }

      const pts = aShape.GetRectCorners();
      let prevPt: VECTOR2I = { x: 0, y: 0 };
      let firstPt = true;

      for (const pt of pts) {
        aContour.Append(pt);

        if (firstPt) firstPt = false;
        else aShapeOwners.set(ownerKey(prevPt, pt), aShape);

        prevPt = pt;
      }

      aContour.SetClosed(true);
      break;
    }

    default:
      break;
  }
}

function processShapeSegment(
  aShape: PCB_SHAPE,
  aContour: SHAPE_LINE_CHAIN,
  aPrevPt: { value: VECTOR2I },
  aShapeOwners: SHAPE_OWNERS,
  aErrorMax: number,
  aChainingEpsilon: number,
  aAllowUseArcsInPolygons: boolean,
): void {
  switch (aShape.GetShape()) {
    case SHAPE_T.SEGMENT: {
      let nextPt: VECTOR2I;

      if (closer_to_first(aPrevPt.value, aShape.GetStart(), aShape.GetEnd()))
        nextPt = aShape.GetEnd();
      else nextPt = aShape.GetStart();

      aContour.Append(nextPt);
      aShapeOwners.set(ownerKey(aPrevPt.value, nextPt), aShape);
      aPrevPt.value = nextPt;
      break;
    }

    case SHAPE_T.ARC: {
      let pstart = aShape.GetStart();
      const pmid = aShape.GetArcMid();
      let pend = aShape.GetEnd();

      if (!close_enough(aPrevPt.value, pstart, aChainingEpsilon)) {
        if (!close_enough(aPrevPt.value, aShape.GetEnd(), aChainingEpsilon)) return;

        [pstart, pend] = [pend, pstart];
      }

      pstart = aPrevPt.value;

      const sarc = new SHAPE_ARC(pstart, pmid, pend, 0);
      const arcChain = new SHAPE_LINE_CHAIN();
      arcChain.Append(sarc, aErrorMax);

      if (!aAllowUseArcsInPolygons) arcChain.ClearArcs();

      for (let ii = 1; ii < arcChain.PointCount(); ++ii) {
        aShapeOwners.set(ownerKey(arcChain.CPoint(ii - 1), arcChain.CPoint(ii)), aShape);
      }

      aContour.Append(arcChain);
      aPrevPt.value = pend;
      break;
    }

    case SHAPE_T.BEZIER: {
      let nextPt: VECTOR2I;
      let reverse = false;

      if (closer_to_first(aPrevPt.value, aShape.GetStart(), aShape.GetEnd())) {
        nextPt = aShape.GetEnd();
      } else {
        nextPt = aShape.GetStart();
        reverse = true;
      }

      aShape.RebuildBezierToSegmentsPointsList(aErrorMax);

      if (reverse) {
        for (let jj = aShape.GetBezierPoints().length - 1; jj >= 0; jj--) {
          const pt = aShape.GetBezierPoints()[jj]!;

          if (equal(aPrevPt.value, pt)) continue;

          aContour.Append(pt);
          aShapeOwners.set(ownerKey(aPrevPt.value, pt), aShape);
          aPrevPt.value = pt;
        }
      } else {
        for (const pt of aShape.GetBezierPoints()) {
          if (equal(aPrevPt.value, pt)) continue;

          aContour.Append(pt);
          aShapeOwners.set(ownerKey(aPrevPt.value, pt), aShape);
          aPrevPt.value = pt;
        }
      }

      aPrevPt.value = nextPt;
      break;
    }

    default:
      break;
  }
}

function buildContourHierarchy(aContours: readonly SHAPE_LINE_CHAIN[]): Map<number, number[]> {
  const contourToParentIndexesMap = new Map<number, number[]>();

  for (let ii = 0; ii < aContours.length; ++ii) {
    if (aContours[ii]!.PointCount() < 1)
      // malformed/empty SHAPE_LINE_CHAIN
      continue;

    const firstPt = aContours[ii]!.GetPoint(0);
    const parents: number[] = [];

    for (let jj = 0; jj < aContours.length; ++jj) {
      if (jj === ii) continue;

      const parentCandidate = aContours[jj]!;

      if (parentCandidate.PointInside(firstPt, 0, true)) parents.push(jj);
    }

    contourToParentIndexesMap.set(ii, parents);
  }

  return contourToParentIndexesMap;
}

function addOutlinesToPolygon(
  aContours: readonly SHAPE_LINE_CHAIN[],
  aContourHierarchy: Map<number, number[]>,
  aPolygons: SHAPE_POLY_SET,
  aAllowDisjoint: boolean,
  aErrorHandler: OUTLINE_ERROR_HANDLER | null,
  aFetchOwner: (aSeg: SEG) => PCB_SHAPE | null,
  aContourToOutlineIdxMap: Map<number, number>,
): boolean {
  for (const [contourIndex, parentIndexes] of aContourHierarchy) {
    if (parentIndexes.length % 2 === 0) {
      // Even number of parents; top-level outline
      if (!aAllowDisjoint && !aPolygons.IsEmpty()) {
        if (aErrorHandler) {
          const a = aFetchOwner(aPolygons.Outline(0).GetSegment(0));
          const b = aFetchOwner(aContours[contourIndex]!.GetSegment(0));

          if (a && b) {
            aErrorHandler(
              '(multiple board outlines not supported)',
              a,
              b,
              aContours[contourIndex]!.GetPoint(0),
            );
            return false;
          }
        }
      }

      aPolygons.AddOutline(aContours[contourIndex]!);
      aContourToOutlineIdxMap.set(contourIndex, aPolygons.OutlineCount() - 1);
    }
  }

  return true;
}

function addHolesToPolygon(
  aContours: readonly SHAPE_LINE_CHAIN[],
  aContourHierarchy: Map<number, number[]>,
  aContourToOutlineIdxMap: Map<number, number>,
  aPolygons: SHAPE_POLY_SET,
  aAllowUseArcsInPolygons: boolean,
  aHasMalformedOverlap: boolean,
): void {
  if (aAllowUseArcsInPolygons || !aHasMalformedOverlap) {
    for (const [contourIndex, parentIndexes] of aContourHierarchy) {
      if (parentIndexes.length % 2 === 1) {
        // Odd number of parents; we're a hole in the parent which has one fewer parents
        const hole = aContours[contourIndex]!;

        for (const parentContourIdx of parentIndexes) {
          if (aContourHierarchy.get(parentContourIdx)!.length === parentIndexes.length - 1) {
            const outlineIdx = aContourToOutlineIdxMap.get(parentContourIdx)!;
            aPolygons.AddHole(hole, outlineIdx);
            break;
          }
        }
      }
    }

    return;
  }

  // Malformed overlapping contours in the polygonized path.
  const cutoutCandidates = new SHAPE_POLY_SET();
  const islandCandidates = new SHAPE_POLY_SET();

  for (const [contourIndex, parentIndexes] of aContourHierarchy) {
    if (parentIndexes.length === 0) continue;

    if (parentIndexes.length % 2 === 1) cutoutCandidates.AddOutline(aContours[contourIndex]!);
    else islandCandidates.AddOutline(aContours[contourIndex]!);
  }

  if (cutoutCandidates.OutlineCount()) {
    cutoutCandidates.Simplify();
    aPolygons.BooleanSubtract(cutoutCandidates);
  }

  if (islandCandidates.OutlineCount()) {
    islandCandidates.Simplify();
    aPolygons.BooleanAdd(islandCandidates);
  }
}

function checkSelfIntersections(
  aPolygons: SHAPE_POLY_SET,
  aErrorHandler: OUTLINE_ERROR_HANDLER | null,
  aFetchOwner: (aSeg: SEG) => PCB_SHAPE | null,
): boolean {
  let selfIntersecting = false;

  const segments: SEG[] = [];

  for (const seg of aPolygons.IterateSegmentsWithHoles()) {
    const segment = new SEG(seg);

    if (LexicographicalCompare(segment.A, segment.B) > 0)
      [segment.A, segment.B] = [segment.B, segment.A];

    segments.push(segment);
  }

  segments.sort((a, b) => {
    if (!equal(a.A, b.A)) return LexicographicalCompare(a.A, b.A);

    return LexicographicalCompare(a.B, b.B);
  });

  for (let i = 0; i < segments.length; ++i) {
    const seg1 = segments[i]!;

    for (let j = i + 1; j < segments.length; ++j) {
      const seg2 = segments[j]!;

      // VECTOR2::operator>: lexicographical on x then y
      if (LexicographicalCompare(seg2.A, seg1.B) > 0) break;

      if (
        (equal(seg1.A, seg2.A) && equal(seg1.B, seg2.B)) ||
        (equal(seg1.A, seg2.B) && equal(seg1.B, seg2.A))
      ) {
        if (aErrorHandler) {
          const a = aFetchOwner(seg1);
          const b = aFetchOwner(seg2);
          aErrorHandler('(self-intersecting)', a, b, seg1.A);
        }

        selfIntersecting = true;
      } else {
        const pt = seg1.Intersect(seg2, true);

        if (pt) {
          if (aErrorHandler) {
            const a = aFetchOwner(seg1);
            const b = aFetchOwner(seg2);
            aErrorHandler('(self-intersecting)', a, b, pt);
          }

          selfIntersecting = true;
        }
      }
    }
  }

  return !selfIntersecting;
}

// Helper function to find next shape using KD-tree
function findNext(
  aShape: PCB_SHAPE,
  aPoint: VECTOR2I,
  adaptor: PCB_SHAPE_ENDPOINTS_ADAPTOR,
  aChainingEpsilon: number,
): PCB_SHAPE | null {
  const { indices, distances } = nearestTwoEndpoints(adaptor, aPoint);

  if (distances[0] === Number.MAX_VALUE) return null;

  // Find the closest valid candidate
  let closest_graphic: PCB_SHAPE | null = null;
  let closest_dist_sq = aChainingEpsilon * aChainingEpsilon;

  for (let i = 0; i < 2; ++i) {
    if (distances[i] === Number.MAX_VALUE) continue;

    const candidate = adaptor.endpoints[indices[i]!]![1];

    if (candidate === aShape) continue;

    if (distances[i]! < closest_dist_sq) {
      closest_dist_sq = distances[i]!;
      closest_graphic = candidate;
    }
  }

  return closest_graphic;
}

function hasOverlappingClosedContours(aContours: readonly SHAPE_LINE_CHAIN[]): boolean {
  for (let ii = 0; ii < aContours.length; ++ii) {
    for (let jj = ii + 1; jj < aContours.length; ++jj) {
      const intersections: INTERSECTIONS = [];

      if (aContours[ii]!.Intersect(aContours[jj]!, intersections, true) !== 0) return true;
    }
  }

  return false;
}

// Walk a chain of open shapes (segments/arcs/beziers) starting from aStart, and produce a
// closed SHAPE_LINE_CHAIN if the chain forms a closed loop. Shapes that are consumed are
// removed from aRemaining. Returns true and populates aContour and aOwnerShape only if a
// closed contour is produced. Used to detect cross-contour intersections of bezier-bounded
// slots which would otherwise be missed by the closed-shape-only intersection test.
export function buildChainedClosedContour(
  aStart: PCB_SHAPE,
  aRemaining: Set<PCB_SHAPE>,
  aAdaptor: PCB_SHAPE_ENDPOINTS_ADAPTOR,
  aErrorMax: number,
  aChainingEpsilon: number,
  aContour: SHAPE_LINE_CHAIN,
  aOwnerShape: { value: PCB_SHAPE | null },
): boolean {
  const chain: PCB_SHAPE[] = [];
  chain.push(aStart);

  let closed = false;
  let frontPt = aStart.GetStart();
  let backPt = aStart.GetEnd();

  const visited = new Set<PCB_SHAPE>();
  visited.add(aStart);

  const extendChain = (forward: boolean): void => {
    let curr = forward ? chain[chain.length - 1]! : chain[0]!;
    let prev = forward ? backPt : frontPt;

    for (;;) {
      let next = findNext(curr, prev, aAdaptor, aChainingEpsilon);

      // The KD-tree spans the original openShapes set, so it still returns shapes
      // already consumed by an earlier chain. Filter against aRemaining to avoid
      // accidentally absorbing those into this chain.
      if (next && !aRemaining.has(next)) next = null;

      if (next && !visited.has(next)) {
        visited.add(next);

        if (forward) chain.push(next);
        else chain.unshift(next);

        if (closer_to_first(prev, next.GetStart(), next.GetEnd())) prev = next.GetEnd();
        else prev = next.GetStart();

        curr = next;
        continue;
      }

      if (next) {
        const chainEnd = forward ? chain[0]! : chain[chain.length - 1]!;
        const chainPt = forward ? frontPt : backPt;

        if (next === chainEnd && close_enough(prev, chainPt, aChainingEpsilon)) closed = true;
      }

      if (forward) backPt = prev;
      else frontPt = prev;

      break;
    }
  };

  extendChain(true);

  if (!closed) extendChain(false);

  if (!closed) return false;

  // Build the contour from the closed chain, mirroring doConvertOutlineToPolygon().
  const shapeOwners: SHAPE_OWNERS = new Map();
  const first = chain[0]!;
  let startPt: VECTOR2I;

  if (chain.length > 1) {
    const second = chain[1]!;

    if (
      close_enough(first.GetStart(), second.GetStart(), aChainingEpsilon) ||
      close_enough(first.GetStart(), second.GetEnd(), aChainingEpsilon)
    )
      startPt = first.GetEnd();
    else startPt = first.GetStart();
  } else {
    startPt = first.GetStart();
  }

  aContour.Clear();
  aContour.Append(startPt);
  const prevPt = { value: startPt };

  for (const shapeInChain of chain)
    processShapeSegment(
      shapeInChain,
      aContour,
      prevPt,
      shapeOwners,
      aErrorMax,
      aChainingEpsilon,
      false,
    );

  if (aContour.PointCount() < 3) return false;

  if (!equal(aContour.CPoint(0), aContour.CLastPoint())) aContour.SetPoint(-1, aContour.CPoint(0));

  aContour.SetClosed(true);

  for (const consumed of chain) aRemaining.delete(consumed);

  aOwnerShape.value = first;
  return true;
}

export function doConvertOutlineToPolygon(
  aShapeList: PCB_SHAPE[],
  aPolygons: SHAPE_POLY_SET,
  aErrorMax: number,
  aChainingEpsilon: number,
  aAllowDisjoint: boolean,
  aErrorHandler: OUTLINE_ERROR_HANDLER | null,
  aAllowUseArcsInPolygons: boolean,
  aCleaner: SCOPED_FLAGS_CLEANER,
): boolean {
  if (aShapeList.length === 0) return true;

  let selfIntersecting = false;

  let graphic: PCB_SHAPE | null = null;

  // std::set<PCB_SHAPE*>: pointer order; insertion order here
  const startCandidates = new Set<PCB_SHAPE>(aShapeList);

  // Pre-build KD-tree
  const adaptor = new PCB_SHAPE_ENDPOINTS_ADAPTOR(aShapeList);

  // Keep a list of where the various shapes came from
  const shapeOwners: SHAPE_OWNERS = new Map();

  const fetchOwner = (seg: SEG): PCB_SHAPE | null => {
    return shapeOwners.get(ownerKey(seg.A, seg.B)) ?? null;
  };

  const reportedGaps = new Set<string>();
  const shapeIndex = new Map<PCB_SHAPE, number>();
  aShapeList.forEach((s, i) => shapeIndex.set(s, i));

  const contours: SHAPE_LINE_CHAIN[] = [];

  for (const shape of startCandidates) shape.ClearFlags(SKIP_STRUCT);

  // Process each shape to build contours
  while (startCandidates.size) {
    graphic = startCandidates.values().next().value!;
    graphic.SetFlags(SKIP_STRUCT);
    aCleaner.add(graphic);
    startCandidates.delete(graphic);

    const currContour = new SHAPE_LINE_CHAIN();
    contours.push(currContour);
    currContour.SetWidth(graphic.GetWidth());

    // Handle closed shapes (circles, rects, polygons)
    if (
      graphic.GetShape() === SHAPE_T.POLY ||
      graphic.GetShape() === SHAPE_T.CIRCLE ||
      graphic.GetShape() === SHAPE_T.RECTANGLE
    ) {
      processClosedShape(graphic, currContour, shapeOwners, aErrorMax, aAllowUseArcsInPolygons);
    } else {
      // Build chains for open shapes
      const chain: PCB_SHAPE[] = [];
      chain.push(graphic);

      let closed = false;
      let frontPt = graphic.GetStart();
      let backPt = graphic.GetEnd();

      const extendChain = (forward: boolean): void => {
        let curr = forward ? chain[chain.length - 1]! : chain[0]!;
        let prev = forward ? backPt : frontPt;

        for (;;) {
          const next = findNext(curr, prev, adaptor, aChainingEpsilon);

          if (next && !(next.GetFlags() & SKIP_STRUCT)) {
            next.SetFlags(SKIP_STRUCT);
            aCleaner.add(next);
            startCandidates.delete(next);

            if (forward) chain.push(next);
            else chain.unshift(next);

            if (closer_to_first(prev, next.GetStart(), next.GetEnd())) prev = next.GetEnd();
            else prev = next.GetStart();

            curr = next;
            continue;
          }

          if (next) {
            const chainEnd = forward ? chain[0]! : chain[chain.length - 1]!;
            const chainPt = forward ? frontPt : backPt;

            if (next === chainEnd && close_enough(prev, chainPt, aChainingEpsilon)) {
              closed = true;
            } else {
              if (aErrorHandler) aErrorHandler('(self-intersecting)', curr, next, prev);

              selfIntersecting = true;
            }
          }

          if (forward) backPt = prev;
          else frontPt = prev;

          break;
        }
      };

      extendChain(true);

      if (!closed) extendChain(false);

      // Process the chain to build the contour
      const first = chain[0]!;
      let startPt: VECTOR2I;

      if (chain.length > 1) {
        const second = chain[1]!;

        if (
          close_enough(first.GetStart(), second.GetStart(), aChainingEpsilon) ||
          close_enough(first.GetStart(), second.GetEnd(), aChainingEpsilon)
        )
          startPt = first.GetEnd();
        else startPt = first.GetStart();
      } else {
        startPt = first.GetStart();
      }

      currContour.Append(startPt);
      const prevPt = { value: startPt };

      for (const shapeInChain of chain) {
        processShapeSegment(
          shapeInChain,
          currContour,
          prevPt,
          shapeOwners,
          aErrorMax,
          aChainingEpsilon,
          aAllowUseArcsInPolygons,
        );
      }

      // Handle contour closure
      if (close_enough(currContour.CPoint(0), currContour.CLastPoint(), aChainingEpsilon)) {
        if (
          !equal(currContour.CPoint(0), currContour.CLastPoint()) &&
          currContour.PointCount() > 2
        ) {
          const owner = fetchOwner(currContour.CSegment(-1));

          if (currContour.IsArcEnd(currContour.PointCount() - 1)) {
            const arc = currContour.Arc(currContour.ArcIndex(currContour.PointCount() - 1));
            const sarc = new SHAPE_ARC(arc.GetP0(), arc.GetArcMid(), currContour.CPoint(0), 0);
            const arcChain = new SHAPE_LINE_CHAIN();
            arcChain.Append(sarc, aErrorMax);

            if (!aAllowUseArcsInPolygons) arcChain.ClearArcs();

            for (let ii = 1; ii < arcChain.PointCount(); ++ii) {
              if (owner)
                shapeOwners.set(ownerKey(arcChain.CPoint(ii - 1), arcChain.CPoint(ii)), owner);
              else shapeOwners.delete(ownerKey(arcChain.CPoint(ii - 1), arcChain.CPoint(ii)));
            }

            currContour.RemoveShape(currContour.PointCount() - 1);
            currContour.Append(arcChain);
          } else {
            currContour.SetPoint(-1, currContour.CPoint(0));
            const key = ownerKey(
              currContour.CPoints()[currContour.PointCount() - 2]!,
              currContour.CLastPoint(),
            );

            if (owner) shapeOwners.set(key, owner);
            else shapeOwners.delete(key);
          }
        }

        currContour.SetClosed(true);
      } else {
        const report_gap = (pt: VECTOR2I): void => {
          if (!aErrorHandler) return;

          // Find the two closest items to the given point using kdtree
          const { indices } = nearestTwoEndpoints(adaptor, pt);

          const shapeA = adaptor.endpoints[indices[0]!]![1];
          const shapeB = adaptor.endpoints[indices[1]!]![1];

          // Avoid reporting the same pair twice
          const ia = shapeIndex.get(shapeA)!;
          const ib = shapeIndex.get(shapeB)!;
          const key = `${Math.min(ia, ib)}:${Math.max(ia, ib)}`;

          if (reportedGaps.has(key)) return;

          reportedGaps.add(key);

          // Find the nearest points between the two shapes and calculate midpoint
          const effectiveShapeA = shapeA.GetEffectiveShape();
          const effectiveShapeB = shapeB.GetEffectiveShape();
          const ptA: VECTOR2I = { x: 0, y: 0 };
          const ptB: VECTOR2I = { x: 0, y: 0 };
          let midpoint = pt; // fallback to original point

          if (
            effectiveShapeA &&
            effectiveShapeB &&
            effectiveShapeA.NearestPoints(effectiveShapeB, ptA, ptB)
          ) {
            midpoint = { x: Math.trunc((ptA.x + ptB.x) / 2), y: Math.trunc((ptA.y + ptB.y) / 2) };
          }

          aErrorHandler('(not a closed shape)', shapeA, shapeB, midpoint);
        };

        report_gap(currContour.CPoint(0));
        report_gap(currContour.CLastPoint());
      }
    }
  }

  // Ensure all contours are closed
  for (const contour of contours) {
    if (!contour.IsClosed()) return false;
  }

  // Generate bounding boxes for hierarchy calculations
  for (let ii = 0; ii < contours.length; ++ii) {
    const contour = contours[ii]!;

    if (!contour.GetCachedBBox().IsValid()) contour.GenerateBBoxCache();
  }

  // Build contour hierarchy
  const contourHierarchy = buildContourHierarchy(contours);

  const hasMalformedOverlap = !aAllowUseArcsInPolygons && hasOverlappingClosedContours(contours);

  // Add outlines to polygon set
  const contourToOutlineIdxMap = new Map<number, number>();

  if (
    !addOutlinesToPolygon(
      contours,
      contourHierarchy,
      aPolygons,
      aAllowDisjoint,
      aErrorHandler,
      fetchOwner,
      contourToOutlineIdxMap,
    )
  ) {
    return false;
  }

  // Add holes to polygon set
  addHolesToPolygon(
    contours,
    contourHierarchy,
    contourToOutlineIdxMap,
    aPolygons,
    aAllowUseArcsInPolygons,
    hasMalformedOverlap,
  );

  // Check for self-intersections
  // (`selfIntersecting` is set above but does not reach the return in the C++ either)
  void selfIntersecting;
  return checkSelfIntersections(aPolygons, aErrorHandler, fetchOwner);
}

/**
 * Build a polygon set with holes from a #PCB_SHAPE list.
 *
 * The shape list is expected to be one or more top-level closed outlines with zero or more
 * holes in each.  Optionally, it can be limited to a single top-level closed outline.
 *
 * @param aShapeList the initial list of drawsegments (only lines, circles and arcs).
 * @param aPolygons will contain the complex polygon.
 * @param aErrorMax is the max error distance when polygonizing a curve (internal units).
 * @param aChainingEpsilon is the max distance from one endPt to the next startPt (internal units).
 * @param aAllowDisjoint indicates multiple top-level outlines are allowed.
 * @param aErrorHandler is an optional error handler.
 * @param aAllowUseArcsInPolygons is an option to allow adding arcs in #SHAPE_LINE_CHAIN
 *                                polylines/polygons when building outlines from aShapeList
 *                                This is mainly for export to STEP files.
 * @return true if success, false if a contour is not valid (self intersecting).
 */
export function ConvertOutlineToPolygon(
  aShapeList: PCB_SHAPE[],
  aPolygons: SHAPE_POLY_SET,
  aErrorMax: number,
  aChainingEpsilon: number,
  aAllowDisjoint: boolean,
  aErrorHandler: OUTLINE_ERROR_HANDLER | null,
  aAllowUseArcsInPolygons = false,
): boolean {
  const cleaner = new SCOPED_FLAGS_CLEANER(SKIP_STRUCT);

  try {
    return doConvertOutlineToPolygon(
      aShapeList,
      aPolygons,
      aErrorMax,
      aChainingEpsilon,
      aAllowDisjoint,
      aErrorHandler,
      aAllowUseArcsInPolygons,
      cleaner,
    );
  } finally {
    cleaner.dispose();
  }
}

function isCopperOutside(aFootprint: FOOTPRINT, aShape: SHAPE_POLY_SET): boolean {
  let padOutside = false;

  for (const pad of aFootprint.Pads()) {
    pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      const poly = aShape.CloneDropTriangulation();

      poly.ClearArcs();

      poly.BooleanIntersection(pad.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE));

      if (poly.OutlineCount() === 0) {
        padOutside = true;
      }
    });

    if (padOutside) break;
  }

  return padOutside;
}

/**
 * Check a board outline is valid.
 *
 * Every shape must be a closed contour or joined to the next with a gap at
 * most aMinDist, and no closed contour may cross another.
 */
export function TestBoardOutlinesGraphicItems(
  aBoard: BOARD,
  aMinDist: number,
  aErrorHandler: OUTLINE_ERROR_HANDLER | null,
): boolean {
  let success = true;
  const items = new PCB_TYPE_COLLECTOR();
  const min_dist = Math.max(0, aMinDist);

  // Get all the shapes into 'items', then keep only those on layer == Edge_Cuts.
  items.Collect(aBoard, [KICAD_T.PCB_SHAPE_T]);

  const shapeList: PCB_SHAPE[] = [];

  for (let ii = 0; ii < items.GetCount(); ii++) {
    const seg = items.at(ii) as PCB_SHAPE;

    if (seg.GetLayer() === PCB_LAYER_ID.Edge_Cuts) shapeList.push(seg);
  }

  // Now Test validity of collected items
  for (const shape of shapeList) {
    switch (shape.GetShape()) {
      case SHAPE_T.RECTANGLE: {
        const seg = sub(shape.GetEnd(), shape.GetStart());
        const dim = EuclideanNormI(seg);

        if (dim <= min_dist) {
          success = false;

          if (aErrorHandler) {
            aErrorHandler(
              `(rectangle has null or very small size: ${dim} nm)`,
              shape,
              null,
              shape.GetStart(),
            );
          }
        }

        break;
      }

      case SHAPE_T.CIRCLE: {
        const r = shape.GetRadius();

        if (r <= min_dist) {
          success = false;

          if (aErrorHandler) {
            aErrorHandler(
              `(circle has null or very small radius: ${r} nm)`,
              shape,
              null,
              shape.GetStart(),
            );
          }
        }

        break;
      }

      case SHAPE_T.SEGMENT: {
        const seg = sub(shape.GetEnd(), shape.GetStart());
        const dim = EuclideanNormI(seg);

        if (dim <= min_dist) {
          success = false;

          if (aErrorHandler) {
            aErrorHandler(
              `(segment has null or very small length: ${dim} nm)`,
              shape,
              null,
              shape.GetStart(),
            );
          }
        }

        break;
      }

      case SHAPE_T.ARC: {
        // Arc size can be evaluated from the distance between arc middle point and arc ends
        // We do not need a precise value, just an idea of its size
        const arcMiddle = shape.GetArcMid();
        const seg1 = sub(arcMiddle, shape.GetStart());
        const seg2 = sub(shape.GetEnd(), arcMiddle);
        const dim = EuclideanNormI(seg1) + EuclideanNormI(seg2);

        if (dim <= min_dist) {
          success = false;

          if (aErrorHandler) {
            aErrorHandler(
              `(arc has null or very small size: ${dim} nm)`,
              shape,
              null,
              shape.GetStart(),
            );
          }
        }

        break;
      }

      case SHAPE_T.POLY:
        break;

      case SHAPE_T.BEZIER:
        break;

      default:
        throw new Error(`UNIMPLEMENTED_FOR( ${shape.SHAPE_T_asString()} )`);
    }
  }

  const closedContours: [PCB_SHAPE, SHAPE_LINE_CHAIN][] = [];
  // std::set<PCB_SHAPE*>: pointer order; insertion order stands in for it
  const openShapes = new Set<PCB_SHAPE>();

  for (const shape of shapeList) {
    if (
      shape.GetShape() === SHAPE_T.POLY ||
      shape.GetShape() === SHAPE_T.CIRCLE ||
      shape.GetShape() === SHAPE_T.RECTANGLE
    ) {
      const contour = new SHAPE_LINE_CHAIN();
      const shapeOwners: SHAPE_OWNERS = new Map();
      processClosedShape(shape, contour, shapeOwners, shape.GetMaxError(), true);
      closedContours.push([shape, contour]);
    } else if (
      shape.GetShape() === SHAPE_T.SEGMENT ||
      shape.GetShape() === SHAPE_T.ARC ||
      shape.GetShape() === SHAPE_T.BEZIER
    ) {
      openShapes.add(shape);
    }
  }

  // Gather closed contours from chained open shapes (slots formed by segments/arcs/beziers).
  // Without this, malformed-outline detection misses overlaps involving such slots.
  if (openShapes.size > 0) {
    const openShapeList = [...openShapes];
    const adaptor = new PCB_SHAPE_ENDPOINTS_ADAPTOR(openShapeList);

    const chainingEpsilon = aBoard.GetOutlinesChainingEpsilon();
    const maxError = aBoard.GetDesignSettings().m_MaxError;

    while (openShapes.size > 0) {
      const start = openShapes.values().next().value as PCB_SHAPE;
      const contour = new SHAPE_LINE_CHAIN();
      const owner: { value: PCB_SHAPE | null } = { value: null };

      if (
        buildChainedClosedContour(
          start,
          openShapes,
          adaptor,
          maxError,
          chainingEpsilon,
          contour,
          owner,
        )
      ) {
        closedContours.push([owner.value!, contour]);
      } else {
        openShapes.delete(start);
      }
    }
  }

  for (let ii = 0; ii < closedContours.length; ++ii) {
    const contourA = closedContours[ii]![1];

    for (let jj = ii + 1; jj < closedContours.length; ++jj) {
      const contourB = closedContours[jj]![1];
      const intersections: INTERSECTIONS = [];

      // Ignore touching-only cases; report only real overlap/crossing.
      if (contourA.Intersect(contourB, intersections, true) === 0) continue;

      success = false;

      if (aErrorHandler) {
        const shapeA = closedContours[ii]![0];
        const shapeB = closedContours[jj]![0];

        let midpoint = intersections[0]!.p;
        const effectiveShapeA = shapeA.GetEffectiveShape();
        const effectiveShapeB = shapeB.GetEffectiveShape();

        if (effectiveShapeA && effectiveShapeB) {
          const bboxA = effectiveShapeA.BBox();
          const bboxB = effectiveShapeB.BBox();
          const overlapBox = bboxA.Intersect(bboxB);

          if (overlapBox.GetWidth() > 0 && overlapBox.GetHeight() > 0)
            midpoint = overlapBox.Centre();
        }

        aErrorHandler('(self-intersecting)', shapeA, shapeB, midpoint);
      }
    }
  }

  return success;
}

/**
 * Extract the board outlines and build a closed polygon from lines, arcs and circle items
 * on edge cut layer.
 *
 * Any closed outline inside the main outline is a hole.  All contours should be closed,
 * i.e. have valid vertices to build a closed polygon.
 *
 * @param aBoard is the board to build outlines from.
 * @param aOutlines is the SHAPE_POLY_SET to fill in with outlines/holes.
 * @param aErrorMax is the max error distance when polygonizing a curve (internal units).
 * @param aChainingEpsilon is the max distance from one endPt to the next startPt (internal units).
 * @param aInferOutlineIfNecessary is true to build a rectangle outline from the board or
 *                                 items bounding box when no valid outline is found.
 * @param aErrorHandler is an optional error handler.
 * @param aAllowUseArcsInPolygons is an option to allow adding arcs in SHAPE_LINE_CHAIN
 *                                polylines/polygons when building outlines from aShapeList
 *                                This is mainly for export to STEP files.
 * @return true if success, false if a contour is not valid (self intersecting).
 */
export function BuildBoardPolygonOutlines(
  aBoard: BOARD,
  aOutlines: SHAPE_POLY_SET,
  aErrorMax: number,
  aChainingEpsilon: number,
  aInferOutlineIfNecessary: boolean,
  aErrorHandler: OUTLINE_ERROR_HANDLER | null,
  aAllowUseArcsInPolygons: boolean,
): boolean {
  const items = new PCB_TYPE_COLLECTOR();
  const fpHoles = new SHAPE_POLY_SET();
  let success = false;

  const cleaner = new SCOPED_FLAGS_CLEANER(SKIP_STRUCT);

  try {
    // Get all the shapes into 'items', then keep only those on layer == Edge_Cuts.
    items.Collect(aBoard, [KICAD_T.PCB_SHAPE_T]);

    for (let ii = 0; ii < items.GetCount(); ++ii) items.at(ii)!.ClearFlags(SKIP_STRUCT);

    for (const fp of aBoard.Footprints()) {
      const fpItems = new PCB_TYPE_COLLECTOR();
      fpItems.Collect(fp, [KICAD_T.PCB_SHAPE_T]);

      const fpSegList: PCB_SHAPE[] = [];

      for (let ii = 0; ii < fpItems.GetCount(); ii++) {
        const fpSeg = fpItems.at(ii) as PCB_SHAPE;

        if (fpSeg.GetLayer() === PCB_LAYER_ID.Edge_Cuts) fpSegList.push(fpSeg);
      }

      if (fpSegList.length > 0) {
        const fpOutlines = new SHAPE_POLY_SET();
        success = doConvertOutlineToPolygon(
          fpSegList,
          fpOutlines,
          aErrorMax,
          aChainingEpsilon,
          false,
          null, // don't report errors here; the second pass also
          // gets an opportunity to use these segments
          aAllowUseArcsInPolygons,
          cleaner,
        );

        // Test to see if we should make holes or outlines.  Holes are made if the footprint
        // has copper outside of a single, closed outline.  If there are multiple outlines,
        // we assume that the footprint edges represent holes as we do not support multiple
        // boards.  Similarly, if any of the footprint pads are located outside of the edges,
        // then the edges are holes
        if (success && (isCopperOutside(fp, fpOutlines) || fpOutlines.OutlineCount() > 1)) {
          fpHoles.Append(fpOutlines);
        } else {
          // If it wasn't a closed area, or wasn't a hole, the we want to keep the fpSegs
          // in contention for the board outline builds.
          for (let ii = 0; ii < fpItems.GetCount(); ++ii) fpItems.at(ii)!.ClearFlags(SKIP_STRUCT);
        }
      }
    }

    // Make a working copy of aSegList, because the list is modified during calculations
    const segList: PCB_SHAPE[] = [];

    for (let ii = 0; ii < items.GetCount(); ii++) {
      const seg = items.at(ii) as PCB_SHAPE;

      // Skip anything already used to generate footprint holes (above)
      if (seg.GetFlags() & SKIP_STRUCT) continue;

      if (seg.GetLayer() === PCB_LAYER_ID.Edge_Cuts) segList.push(seg);
    }

    if (segList.length) {
      success = doConvertOutlineToPolygon(
        segList,
        aOutlines,
        aErrorMax,
        aChainingEpsilon,
        true,
        aErrorHandler,
        aAllowUseArcsInPolygons,
        cleaner,
      );
    }

    if ((!success || !aOutlines.OutlineCount()) && aInferOutlineIfNecessary) {
      // Couldn't create a valid polygon outline.  Use the board edge cuts bounding box to
      // create a rectangular outline, or, failing that, the bounding box of the items on
      // the board.
      let bbbox = aBoard.GetBoardEdgesBoundingBox();

      // If null area, uses the global bounding box.
      if (bbbox.GetWidth() === 0 || bbbox.GetHeight() === 0)
        bbbox = aBoard.ComputeBoundingBox(false, true);

      // Ensure non null area. If happen, gives a minimal size.
      if (bbbox.GetWidth() === 0 || bbbox.GetHeight() === 0) bbbox.Inflate(pcbIUScale.mmToIU(1.0));

      aOutlines.RemoveAllContours();
      aOutlines.NewOutline();

      aOutlines.Append(bbbox.GetOrigin());

      aOutlines.Append({ x: bbbox.GetOrigin().x, y: bbbox.GetEnd().y });

      aOutlines.Append(bbbox.GetEnd());

      aOutlines.Append({ x: bbbox.GetEnd().x, y: bbbox.GetOrigin().y });
    }

    if (aAllowUseArcsInPolygons) {
      for (let ii = 0; ii < fpHoles.OutlineCount(); ++ii) {
        const holePt = fpHoles.Outline(ii).CPoint(0);

        for (let jj = 0; jj < aOutlines.OutlineCount(); ++jj) {
          if (aOutlines.Outline(jj).PointInside(holePt)) {
            aOutlines.AddHole(fpHoles.Outline(ii), jj);
            break;
          }
        }
      }
    } else {
      fpHoles.Simplify();
      aOutlines.BooleanSubtract(fpHoles);
    }

    return success;
  } finally {
    cleaner.dispose();
  }
}

/**
 * Get the complete bounding box of the board (including all items).
 *
 * The vertex numbers and segment numbers of the rectangle returned.
 *              1
 *      *---------------*
 *      |1             2|
 *     0|               |2
 *      |0             3|
 *      *---------------*
 *              3
 */
export function buildBoardBoundingBoxPoly(aBoard: BOARD, aOutline: SHAPE_POLY_SET): void {
  let bbbox = aBoard.GetBoundingBox();
  const chain = new SHAPE_LINE_CHAIN();

  // If null area, uses the global bounding box.
  if (bbbox.GetWidth() === 0 || bbbox.GetHeight() === 0)
    bbbox = aBoard.ComputeBoundingBox(false, true);

  // Ensure non null area. If happen, gives a minimal size.
  if (bbbox.GetWidth() === 0 || bbbox.GetHeight() === 0) bbbox.Inflate(pcbIUScale.mmToIU(1.0));

  // Inflate slightly (by 1/10th the size of the box)
  bbbox.Inflate(Math.trunc(bbbox.GetWidth() / 10), Math.trunc(bbbox.GetHeight() / 10));

  chain.Append(bbbox.GetOrigin());
  chain.Append(bbbox.GetOrigin().x, bbbox.GetEnd().y);
  chain.Append(bbbox.GetEnd());
  chain.Append(bbbox.GetEnd().x, bbbox.GetOrigin().y);
  chain.SetClosed(true);

  aOutline.RemoveAllContours();
  aOutline.AddOutline(chain);
}

export function projectPointOnSegment(
  aEndPoint: VECTOR2I,
  aOutline: SHAPE_POLY_SET,
  aOutlineNum = 0,
): VECTOR2I {
  let minDistance = -1;
  let projPoint: VECTOR2I = { x: 0, y: 0 };

  for (const it = aOutline.CIterateSegments(aOutlineNum); it.valid(); it.Advance()) {
    const seg = it.Get();
    const dis = seg.Distance(aEndPoint);

    if (minDistance < 0 || dis < minDistance) {
      minDistance = dis;
      projPoint = seg.NearestPoint(aEndPoint);
    }
  }

  return projPoint;
}

export function findEndSegments(aChain: SHAPE_LINE_CHAIN, aEnds: { start: SEG; end: SEG }): number {
  let foundSegs = 0;

  for (let i = 0; i < aChain.SegmentCount(); i++) {
    const seg = aChain.Segment(i);

    let foundA = false;
    let foundB = false;

    for (let j = 0; j < aChain.SegmentCount(); j++) {
      // Don't test the segment against itself
      if (i === j) continue;

      const testSeg = aChain.Segment(j);

      if (testSeg.Contains(seg.A)) foundA = true;

      if (testSeg.Contains(seg.B)) foundB = true;
    }

    // This segment isn't a start or end
    if (foundA && foundB) continue;

    if (foundSegs === 0) {
      // The first segment we encounter is the "start" segment
      aEnds.start = seg;
      foundSegs++;
    } else {
      // Once we find both start and end, we can stop
      aEnds.end = seg;
      foundSegs++;
      break;
    }
  }

  return foundSegs;
}

/**
 * Extract a board outline for a footprint view.
 */
export function BuildFootprintPolygonOutlines(
  aBoard: BOARD,
  aOutlines: SHAPE_POLY_SET,
  aErrorMax: number,
  aChainingEpsilon: number,
  aErrorHandler: OUTLINE_ERROR_HANDLER | null,
): boolean {
  const footprint = aBoard.GetFirstFootprint();

  // No footprint loaded
  if (!footprint) {
    return false;
  }

  const items = new PCB_TYPE_COLLECTOR();
  const outlines = new SHAPE_POLY_SET();
  let success = false;

  const cleaner = new SCOPED_FLAGS_CLEANER(SKIP_STRUCT);

  try {
    // Get all the SHAPEs into 'items', then keep only those on layer == Edge_Cuts.
    items.Collect(aBoard, [KICAD_T.PCB_SHAPE_T]);

    // Make a working copy of aSegList, because the list is modified during calculations
    const segList: PCB_SHAPE[] = [];

    for (let ii = 0; ii < items.GetCount(); ii++) {
      if (items.at(ii)!.GetLayer() === PCB_LAYER_ID.Edge_Cuts)
        segList.push(items.at(ii) as PCB_SHAPE);
    }

    if (segList.length > 0) {
      success = doConvertOutlineToPolygon(
        segList,
        outlines,
        aErrorMax,
        aChainingEpsilon,
        true,
        aErrorHandler,
        false,
        cleaner,
      );
    }

    // A closed outline was found on Edge_Cuts
    if (success) {
      // If copper is outside a closed polygon, treat it as a hole
      // If there are multiple outlines in the footprint, they are also holes
      if (isCopperOutside(footprint, outlines) || outlines.OutlineCount() > 1) {
        buildBoardBoundingBoxPoly(aBoard, aOutlines);

        // Copy all outlines from the conversion as holes into the new outline
        for (let i = 0; i < outlines.OutlineCount(); i++) {
          const out = outlines.Outline(i);

          if (out.IsClosed()) aOutlines.AddHole(out, -1);

          for (let j = 0; j < outlines.HoleCount(i); j++) {
            const hole = outlines.Hole(i, j);

            if (hole.IsClosed()) aOutlines.AddHole(hole, -1);
          }
        }
      }
      // If all copper is inside, then the computed outline is the board outline
      else {
        aOutlines.assign(outlines);
      }

      return true;
    }
    // No board outlines were found, so use the bounding box
    if (outlines.OutlineCount() === 0) {
      buildBoardBoundingBoxPoly(aBoard, aOutlines);
      return true;
    }
    // There is an outline present, but it is not closed

    const closedChains: SHAPE_LINE_CHAIN[] = [];
    const openChains: SHAPE_LINE_CHAIN[] = [];

    // The ConvertOutlineToPolygon function returns only one main outline and the rest as
    // holes, so we promote the holes and process them
    openChains.push(outlines.Outline(0));

    for (let j = 0; j < outlines.HoleCount(0); j++) {
      const hole = outlines.Hole(0, j);

      if (hole.IsClosed()) {
        closedChains.push(hole);
      } else {
        openChains.push(hole);
      }
    }

    const bbox = new SHAPE_POLY_SET();
    buildBoardBoundingBoxPoly(aBoard, bbox);

    // Treat the open polys as the board edge
    const chain = new SHAPE_LINE_CHAIN(openChains[0]!);
    const rect = bbox.Outline(0);

    // We know the outline chain is open, so set to non-closed to get better segment count
    chain.SetClosed(false);

    const ends = { start: new SEG(), end: new SEG() };

    // The two possible board outlines
    const upper = new SHAPE_LINE_CHAIN();
    const lower = new SHAPE_LINE_CHAIN();

    findEndSegments(chain, ends);

    if (chain.SegmentCount() === 0) {
      // Something is wrong, bail out with the overall footprint bounding box
      aOutlines.assign(bbox);
      return true;
    }
    if (chain.SegmentCount() === 1) {
      // This case means there is only 1 line segment making up the edge cuts of the
      // footprint, so we just need to use it to cut the bounding box in half.
      const startSeg = chain.Segment(0);

      // Intersect with all the sides of the rectangle
      const inter0 = startSeg.IntersectLines(rect.Segment(0));
      const inter1 = startSeg.IntersectLines(rect.Segment(1));
      const inter2 = startSeg.IntersectLines(rect.Segment(2));
      const inter3 = startSeg.IntersectLines(rect.Segment(3));

      if (inter0 && inter2 && !inter1 && !inter3) {
        // Intersects the vertical rectangle sides only

        // The upper half
        upper.Append(inter0);
        upper.Append(rect.GetPoint(1));
        upper.Append(rect.GetPoint(2));
        upper.Append(inter2);
        upper.SetClosed(true);

        // The lower half
        lower.Append(inter0);
        lower.Append(rect.GetPoint(0));
        lower.Append(rect.GetPoint(3));
        lower.Append(inter2);
        lower.SetClosed(true);
      } else if (inter1 && inter3 && !inter0 && !inter2) {
        // Intersects the horizontal rectangle sides only

        // The left half
        upper.Append(inter1);
        upper.Append(rect.GetPoint(1));
        upper.Append(rect.GetPoint(0));
        upper.Append(inter3);
        upper.SetClosed(true);

        // The right half
        lower.Append(inter1);
        lower.Append(rect.GetPoint(2));
        lower.Append(rect.GetPoint(3));
        lower.Append(inter3);
        lower.SetClosed(true);
      } else {
        // Angled line segment that cuts across a corner

        // Figure out which actual lines are intersected, since IntersectLines assumes
        // an infinite line
        const hit0 = rect.Segment(0).Contains(inter0!);
        const hit1 = rect.Segment(1).Contains(inter1!);
        const hit2 = rect.Segment(2).Contains(inter2!);
        const hit3 = rect.Segment(3).Contains(inter3!);

        if (hit0 && hit1) {
          // Cut across the upper left corner

          // The upper half
          upper.Append(inter0!);
          upper.Append(rect.GetPoint(1));
          upper.Append(inter1!);
          upper.SetClosed(true);

          // The lower half
          lower.Append(inter0!);
          lower.Append(rect.GetPoint(0));
          lower.Append(rect.GetPoint(3));
          lower.Append(rect.GetPoint(2));
          lower.Append(inter1!);
          lower.SetClosed(true);
        } else if (hit1 && hit2) {
          // Cut across the upper right corner

          // The upper half
          upper.Append(inter1!);
          upper.Append(rect.GetPoint(2));
          upper.Append(inter2!);
          upper.SetClosed(true);

          // The lower half
          lower.Append(inter1!);
          lower.Append(rect.GetPoint(1));
          lower.Append(rect.GetPoint(0));
          lower.Append(rect.GetPoint(3));
          lower.Append(inter2!);
          lower.SetClosed(true);
        } else if (hit2 && hit3) {
          // Cut across the lower right corner

          // The upper half
          upper.Append(inter2!);
          upper.Append(rect.GetPoint(2));
          upper.Append(rect.GetPoint(1));
          upper.Append(rect.GetPoint(0));
          upper.Append(inter3!);
          upper.SetClosed(true);

          // The bottom half
          lower.Append(inter2!);
          lower.Append(rect.GetPoint(3));
          lower.Append(inter3!);
          lower.SetClosed(true);
        } else {
          // Cut across the lower left corner

          // The upper half
          upper.Append(inter0!);
          upper.Append(rect.GetPoint(1));
          upper.Append(rect.GetPoint(2));
          upper.Append(rect.GetPoint(3));
          upper.Append(inter3!);
          upper.SetClosed(true);

          // The bottom half
          lower.Append(inter0!);
          lower.Append(rect.GetPoint(0));
          lower.Append(inter3!);
          lower.SetClosed(true);
        }
      }
    } else {
      // More than 1 segment

      // Just a temporary thing
      aOutlines.assign(bbox);
      return true;
    }

    // Figure out which is the correct outline
    const poly1 = new SHAPE_POLY_SET();
    const poly2 = new SHAPE_POLY_SET();

    // `Append( upper )` takes the SHAPE_LINE_CHAIN through SHAPE_POLY_SET's
    // converting constructor: the chain lands as a second outline after the
    // empty one NewOutline() made.
    poly1.NewOutline();
    poly1.Append(new SHAPE_POLY_SET(upper));

    poly2.NewOutline();
    poly2.Append(new SHAPE_POLY_SET(lower));

    if (isCopperOutside(footprint, poly1)) {
      aOutlines.assign(poly2);
    } else {
      aOutlines.assign(poly1);
    }

    // Add all closed polys as holes to the main outline
    for (const closedChain of closedChains) {
      aOutlines.AddHole(closedChain, -1);
    }

    return true;
  } finally {
    cleaner.dispose();
  }
}
