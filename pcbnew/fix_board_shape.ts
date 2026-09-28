// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/fix_board_shape.h` / `.cpp`: `ConnectBoardShapes`, which welds a set
 * of `PCB_SHAPE` graphics into continuous contours by snapping adjacent
 * endpoints together (a common vertex per join). It mutates the shapes in
 * place and is the model half of the "Repair Board" / "Heal Shapes" tools
 * (`edit_tool.cpp`, `graphics_cleaner.cpp`, the EasyEDA importers) — none of
 * which have a live-model caller here yet (see the file's doc comment in the
 * porting commit for what does and does not call it).
 *
 * The reference walks a nanoflann KD-tree for "nearest two endpoints"; this
 * repo already has that substitution once, in `nearestTwoEndpoints`
 * (`convert_shape_list_to_polygon.ts`, for a different algorithm — chaining
 * into closed polygon contours rather than welding in place). `findNext`
 * below is the same O(n) scan, answering `fix_board_shape.cpp`'s own
 * `findNext` query: the closest *other* unconsumed endpoint to a point,
 * within `aChainingEpsilon`.
 */

import { ANGLE_45 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG, type OPT_VECTOR2I } from '@ziroeda/kimath/src/geometry/seg.js';
import { SquaredEuclideanNorm, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { SKIP_STRUCT } from '@ziroeda/common/eda_item_flags.js';
import type { PCB_SHAPE } from './pcb_shape.js';

interface ENDPOINT {
  pt: VECTOR2I;
  shape: PCB_SHAPE;
}

/**
 * `findNext` (`fix_board_shape.cpp:91`): the closer of the *two globally
 * nearest* endpoints to `aPoint` that belongs to a shape other than `aShape`
 * and is not yet consumed (`SKIP_STRUCT`), within `aChainingEpsilon`.
 *
 * This is deliberately not "the nearest surviving endpoint over the whole
 * list" — upstream's KD-tree is asked for exactly `knnSearch( ..., 2, ... )`,
 * the two nearest neighbours full stop, *then* filters those two by
 * `aShape` / `SKIP_STRUCT`. When a shape's own far endpoint is one of its
 * near endpoint's two closest neighbours (short shapes packed close
 * together), both of the k=2 results can belong to `aShape` itself, and the
 * walk correctly dead-ends instead of reaching past them to a third,
 * farther shape. A full scan that takes the nearest *surviving* endpoint
 * would reach past that dead end and weld the wrong pair.
 */
function findNext(
  aShape: PCB_SHAPE,
  aPoint: VECTOR2I,
  aEndpoints: readonly ENDPOINT[],
  aChainingEpsilon: number,
): PCB_SHAPE | null {
  // knnSearch( query, 2, ... ): the two globally nearest endpoints, before
  // any filtering by shape identity or SKIP_STRUCT.
  let best0: ENDPOINT | null = null;
  let best0DistSq = Number.POSITIVE_INFINITY;
  let best1: ENDPOINT | null = null;
  let best1DistSq = Number.POSITIVE_INFINITY;

  for (const ep of aEndpoints) {
    const distSq = SquaredEuclideanNorm({ x: aPoint.x - ep.pt.x, y: aPoint.y - ep.pt.y });

    if (distSq < best0DistSq) {
      best1 = best0;
      best1DistSq = best0DistSq;
      best0 = ep;
      best0DistSq = distSq;
    } else if (distSq < best1DistSq) {
      best1 = ep;
      best1DistSq = distSq;
    }
  }

  let closest: PCB_SHAPE | null = null;
  let closestDistSq = aChainingEpsilon * aChainingEpsilon;

  for (const [ep, distSq] of [
    [best0, best0DistSq],
    [best1, best1DistSq],
  ] as const) {
    if (!ep) continue;
    if (ep.shape === aShape) continue;
    if (ep.shape.GetFlags() & SKIP_STRUCT) continue;

    if (distSq < closestDistSq) {
      closestDistSq = distSq;
      closest = ep.shape;
    }
  }

  return closest;
}

function closerToFirst(aRef: VECTOR2I, aFirst: VECTOR2I, aSecond: VECTOR2I): boolean {
  const df = SquaredEuclideanNorm({ x: aRef.x - aFirst.x, y: aRef.y - aFirst.y });
  const ds = SquaredEuclideanNorm({ x: aRef.x - aSecond.x, y: aRef.y - aSecond.y });
  return df < ds;
}

function minDistanceSq(aRef: VECTOR2I, aFirst: VECTOR2I, aSecond: VECTOR2I): number {
  return Math.min(
    SquaredEuclideanNorm({ x: aRef.x - aFirst.x, y: aRef.y - aFirst.y }),
    SquaredEuclideanNorm({ x: aRef.x - aSecond.x, y: aRef.y - aSecond.y }),
  );
}

/** `d[idx]` and `int idx = std::min_element( d, d + 4 ) - d;` for a 4-way distance table. */
function argmin4(d: readonly [number, number, number, number]): number {
  let idx = 0;
  for (let i = 1; i < 4; i++) if (d[i]! < d[idx]!) idx = i;
  return idx;
}

/**
 * `connectPair` (`fix_board_shape.cpp:153`): snap the nearer ends of two
 * adjacent shapes together. Segment/segment either finds a real corner
 * (intersection, or an angle sharp enough that extending to the intersection
 * makes sense) or, failing that, welds the closest ends together when the gap
 * is within `WELD_GAP_TOLERANCE` — rounding noise, not a real feature.
 * Every other shape-kind pair just snaps its nearer ends to a shared point
 * (the midpoint for arc/arc and bezier/bezier, matching a control point's
 * delta for arc/bezier and bezier/segment so the curve doesn't distort).
 */
function connectPair(aPrevShape: PCB_SHAPE, aShape: PCB_SHAPE, aWeldGapTolerance: number): boolean {
  const shape0 = aPrevShape.GetShape();
  const shape1 = aShape.GetShape();

  if (shape0 === SHAPE_T.SEGMENT && shape1 === SHAPE_T.SEGMENT) {
    const seg0 = new SEG(aPrevShape.GetStart(), aPrevShape.GetEnd());
    const seg1 = new SEG(aShape.GetStart(), aShape.GetEnd());
    const d: [number, number, number, number] = [
      SquaredEuclideanNorm({ x: seg0.A.x - seg1.A.x, y: seg0.A.y - seg1.A.y }),
      SquaredEuclideanNorm({ x: seg0.A.x - seg1.B.x, y: seg0.A.y - seg1.B.y }),
      SquaredEuclideanNorm({ x: seg0.B.x - seg1.A.x, y: seg0.B.y - seg1.A.y }),
      SquaredEuclideanNorm({ x: seg0.B.x - seg1.B.x, y: seg0.B.y - seg1.B.y }),
    ];
    const idx = argmin4(d);
    const i0 = Math.trunc(idx / 2);
    const i1 = idx % 2;

    if (seg0.Intersects(seg1) || seg0.Angle(seg1).AsDegrees() > ANGLE_45.AsDegrees()) {
      const inter: OPT_VECTOR2I = seg0.IntersectLines(seg1);

      if (inter) {
        if (i0 === 0) aPrevShape.SetStart(inter);
        else aPrevShape.SetEnd(inter);

        if (i1 === 0) aShape.SetStart(inter);
        else aShape.SetEnd(inter);

        return true;
      }
    }

    // Near-collinear facets have no real corner to extend to, so weld the closest ends
    // together, but only for a hairline gap (rounding noise) so real thin features survive.
    if (d[idx]! <= aWeldGapTolerance * aWeldGapTolerance) {
      const p0 = i0 === 0 ? seg0.A : seg0.B;
      const p1 = i1 === 0 ? seg1.A : seg1.B;
      const mid: VECTOR2I = { x: Math.trunc((p0.x + p1.x) / 2), y: Math.trunc((p0.y + p1.y) / 2) };

      if (i0 === 0) aPrevShape.SetStart(mid);
      else aPrevShape.SetEnd(mid);

      if (i1 === 0) aShape.SetStart(mid);
      else aShape.SetEnd(mid);

      return true;
    }

    return false;
  }

  if (
    (shape0 === SHAPE_T.ARC && shape1 === SHAPE_T.SEGMENT) ||
    (shape0 === SHAPE_T.SEGMENT && shape1 === SHAPE_T.ARC)
  ) {
    const arcShape = shape0 === SHAPE_T.ARC ? aPrevShape : aShape;
    const segShape = shape0 === SHAPE_T.SEGMENT ? aPrevShape : aShape;
    const arcPts: [VECTOR2I, VECTOR2I] = [arcShape.GetStart(), arcShape.GetEnd()];
    const segPts: [VECTOR2I, VECTOR2I] = [segShape.GetStart(), segShape.GetEnd()];
    const d: [number, number, number, number] = [
      SquaredEuclideanNorm({ x: segPts[0].x - arcPts[0].x, y: segPts[0].y - arcPts[0].y }),
      SquaredEuclideanNorm({ x: segPts[0].x - arcPts[1].x, y: segPts[0].y - arcPts[1].y }),
      SquaredEuclideanNorm({ x: segPts[1].x - arcPts[0].x, y: segPts[1].y - arcPts[0].y }),
      SquaredEuclideanNorm({ x: segPts[1].x - arcPts[1].x, y: segPts[1].y - arcPts[1].y }),
    ];

    switch (argmin4(d)) {
      case 0:
        segShape.SetStart(arcPts[0]);
        break;
      case 1:
        segShape.SetStart(arcPts[1]);
        break;
      case 2:
        segShape.SetEnd(arcPts[0]);
        break;
      default:
        segShape.SetEnd(arcPts[1]);
        break;
    }

    return true;
  }

  if (shape0 === SHAPE_T.ARC && shape1 === SHAPE_T.ARC) {
    const pts0: [VECTOR2I, VECTOR2I] = [aPrevShape.GetStart(), aPrevShape.GetEnd()];
    const pts1: [VECTOR2I, VECTOR2I] = [aShape.GetStart(), aShape.GetEnd()];
    const d: [number, number, number, number] = [
      SquaredEuclideanNorm({ x: pts0[0].x - pts1[0].x, y: pts0[0].y - pts1[0].y }),
      SquaredEuclideanNorm({ x: pts0[0].x - pts1[1].x, y: pts0[0].y - pts1[1].y }),
      SquaredEuclideanNorm({ x: pts0[1].x - pts1[0].x, y: pts0[1].y - pts1[0].y }),
      SquaredEuclideanNorm({ x: pts0[1].x - pts1[1].x, y: pts0[1].y - pts1[1].y }),
    ];
    const idx = argmin4(d);
    const i0 = Math.trunc(idx / 2);
    const i1 = idx % 2;
    const middle: VECTOR2I = {
      x: Math.trunc((pts0[i0]!.x + pts1[i1]!.x) / 2),
      y: Math.trunc((pts0[i0]!.y + pts1[i1]!.y) / 2),
    };

    if (i0 === 0) aPrevShape.SetArcGeometry(middle, aPrevShape.GetArcMid(), aPrevShape.GetEnd());
    else aPrevShape.SetArcGeometry(aPrevShape.GetStart(), aPrevShape.GetArcMid(), middle);

    if (i1 === 0) aShape.SetArcGeometry(middle, aShape.GetArcMid(), aShape.GetEnd());
    else aShape.SetArcGeometry(aShape.GetStart(), aShape.GetArcMid(), middle);

    return true;
  }

  if (
    (shape0 === SHAPE_T.BEZIER && shape1 === SHAPE_T.ARC) ||
    (shape0 === SHAPE_T.ARC && shape1 === SHAPE_T.BEZIER)
  ) {
    const bezShape = shape0 === SHAPE_T.BEZIER ? aPrevShape : aShape;
    const arcShape = shape0 === SHAPE_T.ARC ? aPrevShape : aShape;
    const bezPts: [VECTOR2I, VECTOR2I] = [bezShape.GetStart(), bezShape.GetEnd()];
    const arcPts: [VECTOR2I, VECTOR2I] = [arcShape.GetStart(), arcShape.GetEnd()];
    const d: [number, number, number, number] = [
      SquaredEuclideanNorm({ x: bezPts[0].x - arcPts[0].x, y: bezPts[0].y - arcPts[0].y }),
      SquaredEuclideanNorm({ x: bezPts[0].x - arcPts[1].x, y: bezPts[0].y - arcPts[1].y }),
      SquaredEuclideanNorm({ x: bezPts[1].x - arcPts[0].x, y: bezPts[1].y - arcPts[0].y }),
      SquaredEuclideanNorm({ x: bezPts[1].x - arcPts[1].x, y: bezPts[1].y - arcPts[1].y }),
    ];

    switch (argmin4(d)) {
      case 0: {
        const delta = { x: arcPts[0].x - bezPts[0].x, y: arcPts[0].y - bezPts[0].y };
        bezShape.SetStart(arcPts[0]);
        const c1 = bezShape.GetBezierC1();
        bezShape.SetBezierC1({ x: c1.x + delta.x, y: c1.y + delta.y });
        break;
      }
      case 1: {
        const delta = { x: arcPts[1].x - bezPts[0].x, y: arcPts[1].y - bezPts[0].y };
        bezShape.SetStart(arcPts[1]);
        const c1 = bezShape.GetBezierC1();
        bezShape.SetBezierC1({ x: c1.x + delta.x, y: c1.y + delta.y });
        break;
      }
      case 2: {
        const delta = { x: arcPts[0].x - bezPts[1].x, y: arcPts[0].y - bezPts[1].y };
        bezShape.SetEnd(arcPts[0]);
        const c2 = bezShape.GetBezierC2();
        bezShape.SetBezierC2({ x: c2.x + delta.x, y: c2.y + delta.y });
        break;
      }
      default: {
        const delta = { x: arcPts[1].x - bezPts[1].x, y: arcPts[1].y - bezPts[1].y };
        bezShape.SetEnd(arcPts[1]);
        const c2 = bezShape.GetBezierC2();
        bezShape.SetBezierC2({ x: c2.x + delta.x, y: c2.y + delta.y });
        break;
      }
    }

    return true;
  }

  if (
    (shape0 === SHAPE_T.BEZIER && shape1 === SHAPE_T.SEGMENT) ||
    (shape0 === SHAPE_T.SEGMENT && shape1 === SHAPE_T.BEZIER)
  ) {
    const bezShape = shape0 === SHAPE_T.BEZIER ? aPrevShape : aShape;
    const segShape = shape0 === SHAPE_T.SEGMENT ? aPrevShape : aShape;
    const bezPts: [VECTOR2I, VECTOR2I] = [bezShape.GetStart(), bezShape.GetEnd()];
    const segPts: [VECTOR2I, VECTOR2I] = [segShape.GetStart(), segShape.GetEnd()];
    const d: [number, number, number, number] = [
      SquaredEuclideanNorm({ x: segPts[0].x - bezPts[0].x, y: segPts[0].y - bezPts[0].y }),
      SquaredEuclideanNorm({ x: segPts[0].x - bezPts[1].x, y: segPts[0].y - bezPts[1].y }),
      SquaredEuclideanNorm({ x: segPts[1].x - bezPts[0].x, y: segPts[1].y - bezPts[0].y }),
      SquaredEuclideanNorm({ x: segPts[1].x - bezPts[1].x, y: segPts[1].y - bezPts[1].y }),
    ];

    switch (argmin4(d)) {
      case 0:
        segShape.SetStart(bezPts[0]);
        break;
      case 1:
        segShape.SetStart(bezPts[1]);
        break;
      case 2:
        segShape.SetEnd(bezPts[0]);
        break;
      default:
        segShape.SetEnd(bezPts[1]);
        break;
    }

    return true;
  }

  if (shape0 === SHAPE_T.BEZIER && shape1 === SHAPE_T.BEZIER) {
    const pts0: [VECTOR2I, VECTOR2I] = [aPrevShape.GetStart(), aPrevShape.GetEnd()];
    const pts1: [VECTOR2I, VECTOR2I] = [aShape.GetStart(), aShape.GetEnd()];
    const d: [number, number, number, number] = [
      SquaredEuclideanNorm({ x: pts0[0].x - pts1[0].x, y: pts0[0].y - pts1[0].y }),
      SquaredEuclideanNorm({ x: pts0[0].x - pts1[1].x, y: pts0[0].y - pts1[1].y }),
      SquaredEuclideanNorm({ x: pts0[1].x - pts1[0].x, y: pts0[1].y - pts1[0].y }),
      SquaredEuclideanNorm({ x: pts0[1].x - pts1[1].x, y: pts0[1].y - pts1[1].y }),
    ];
    const idx = argmin4(d);
    const i0 = Math.trunc(idx / 2);
    const i1 = idx % 2;
    const middle: VECTOR2I = {
      x: Math.trunc((pts0[i0]!.x + pts1[i1]!.x) / 2),
      y: Math.trunc((pts0[i0]!.y + pts1[i1]!.y) / 2),
    };

    if (i0 === 0) {
      const delta = {
        x: middle.x - aPrevShape.GetStart().x,
        y: middle.y - aPrevShape.GetStart().y,
      };
      aPrevShape.SetStart(middle);
      const c1 = aPrevShape.GetBezierC1();
      aPrevShape.SetBezierC1({ x: c1.x + delta.x, y: c1.y + delta.y });
    } else {
      const delta = { x: middle.x - aPrevShape.GetEnd().x, y: middle.y - aPrevShape.GetEnd().y };
      aPrevShape.SetEnd(middle);
      const c2 = aPrevShape.GetBezierC2();
      aPrevShape.SetBezierC2({ x: c2.x + delta.x, y: c2.y + delta.y });
    }

    if (i1 === 0) {
      const delta = { x: middle.x - aShape.GetStart().x, y: middle.y - aShape.GetStart().y };
      aShape.SetStart(middle);
      const c1 = aShape.GetBezierC1();
      aShape.SetBezierC1({ x: c1.x + delta.x, y: c1.y + delta.y });
    } else {
      const delta = { x: middle.x - aShape.GetEnd().x, y: middle.y - aShape.GetEnd().y };
      aShape.SetEnd(middle);
      const c2 = aShape.GetBezierC2();
      aShape.SetBezierC2({ x: c2.x + delta.x, y: c2.y + delta.y });
    }

    return true;
  }

  return false;
}

/**
 * `ConnectBoardShapes` (`fix_board_shape.cpp:131`): weld `aShapeList`'s
 * segment/arc/bezier endpoints into continuous contours, in place.
 *
 * `aChainingEpsilon` is the max gap between two shapes' endpoints that still
 * counts as "the same vertex"; nearer-than-`WELD_GAP_TOLERANCE` (0.01 mm,
 * `pcbIUScale`) collinear segment ends are welded outright rather than
 * extended to an intersection, since a hairline gap there is rounding noise,
 * not a feature.
 */
export function ConnectBoardShapes(aShapeList: PCB_SHAPE[], aChainingEpsilon: number): void {
  if (aShapeList.length === 0) return;

  const WELD_GAP_TOLERANCE = 10000; // pcbIUScale.mmToIU( 0.01 ), IU is nm: data KiCad hardcodes.

  const endpoints: ENDPOINT[] = [];
  for (const shape of aShapeList) {
    endpoints.push({ pt: shape.GetStart(), shape });
    endpoints.push({ pt: shape.GetEnd(), shape });
  }

  const walkFrom = (
    aStartGraphic: PCB_SHAPE,
    aStartPt: VECTOR2I,
    aStartCandidates: Set<PCB_SHAPE>,
  ): void => {
    let currGraphic = aStartGraphic;
    let prevPt = aStartPt;

    for (;;) {
      const nextGraphic = findNext(currGraphic, prevPt, endpoints, aChainingEpsilon);

      if (!nextGraphic) break;

      connectPair(currGraphic, nextGraphic, WELD_GAP_TOLERANCE);

      prevPt = closerToFirst(prevPt, nextGraphic.GetStart(), nextGraphic.GetEnd())
        ? nextGraphic.GetEnd()
        : nextGraphic.GetStart();
      currGraphic = nextGraphic;
      currGraphic.SetFlags(SKIP_STRUCT);
      aStartCandidates.delete(currGraphic);
    }
  };

  const startCandidates = new Set<PCB_SHAPE>();

  for (const shape of aShapeList) {
    if (
      shape.GetShape() === SHAPE_T.SEGMENT ||
      shape.GetShape() === SHAPE_T.ARC ||
      shape.GetShape() === SHAPE_T.BEZIER
    ) {
      shape.ClearFlags(SKIP_STRUCT);
      startCandidates.add(shape);
    }
  }

  while (startCandidates.size > 0) {
    const graphic = startCandidates.values().next().value as PCB_SHAPE;

    const ptEnd = graphic.GetEnd();
    const ptStart = graphic.GetStart();

    const grAtEnd = findNext(graphic, ptEnd, endpoints, aChainingEpsilon);
    const grAtStart = findNext(graphic, ptStart, endpoints, aChainingEpsilon);

    let beginFromEndPt = true;

    // We need to start walking from a point that is closest to a point of another shape.
    if (grAtEnd && grAtStart) {
      const dAtEnd = minDistanceSq(ptEnd, grAtEnd.GetStart(), grAtEnd.GetEnd());
      const dAtStart = minDistanceSq(ptStart, grAtStart.GetStart(), grAtStart.GetEnd());
      beginFromEndPt = dAtEnd <= dAtStart;
    } else if (grAtEnd) {
      beginFromEndPt = true;
    } else if (grAtStart) {
      beginFromEndPt = false;
    }

    if (beginFromEndPt) {
      // Do not inline GetEnd / GetStart as endpoints may update
      walkFrom(graphic, graphic.GetEnd(), startCandidates);
      walkFrom(graphic, graphic.GetStart(), startCandidates);
    } else {
      walkFrom(graphic, graphic.GetStart(), startCandidates);
      walkFrom(graphic, graphic.GetEnd(), startCandidates);
    }

    startCandidates.delete(graphic);
  }
}
