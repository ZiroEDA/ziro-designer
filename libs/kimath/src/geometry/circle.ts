// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CIRCLE`. Counterpart: `libs/kimath/src/geometry/circle.cpp`.
 *
 * Only the members `CIRCLE::ConstructFromTanTanPt` needs are here —
 * `IntersectLine` and the constructor — plus `ConstructFromTanTanPt` itself,
 * which is what `PNS::LINE::DragArc` is built on. `NearestPoint`,
 * `FurthestPoint`, `Contains`, `Intersect( CIRCLE )` and `Intersect( SEG )` are
 * already ported in `pcbnew/src/drc/shape_collisions.ts` over a structurally
 * identical circle type; see {@link Circle}.
 *
 * ## Exact integer arithmetic
 *
 * `ConstructFromTanTanPt` is a chain of geometric constructions: an angle
 * bisector, a projection onto it, a homothety, an inversion, and a final
 * perpendicular intersection. Each step consumes the previous step's
 * **rounded integer** coordinate, so an error of one unit at any step is
 * carried, not damped. That is why `segIntersectLines`, `segLineProject` and
 * `segLineDistance` here are the int64 ports and not their double shortcuts.
 */

import { KiROUND } from '../math/util.js';
import { EuclideanNormI, ResizeI, type Vec2 } from '../math/vector2.js';
import { CalcArcMid } from '../trigo.js';
import type { Seg } from './corner_operations.js';
import {
  segApproxParallel,
  segCenter,
  segIntersectLines,
  segLineDistance,
  segLineProject,
  segParallelSeg,
  segPerpendicularSeg,
} from './seg.js';

/**
 * `CIRCLE`, whose two members upstream are the public `Center` and `Radius`.
 *
 * Spelled `c` / `r` rather than `Center` / `Radius` **on purpose**: that makes
 * it structurally identical to `CollideCircle` in
 * `pcbnew/src/drc/shape_collisions.ts`, so the `CIRCLE` members already ported
 * there — `circleNearestPoint`, `circleFurthestPoint`, `circleIntersectCircle`
 * — take one of these directly. A second circle type with different field names
 * would have needed an adapter at every boundary and would have been a rival
 * declaration of the same upstream class.
 */
export interface Circle {
  /** `CIRCLE::Center`. */
  c: Vec2;
  /** `CIRCLE::Radius`. An `int` upstream. */
  r: number;
}

/** `SHAPE::MIN_PRECISION_IU` (`shape.h:129`). */
const MIN_PRECISION_IU = 4;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** `( a - b ).SquaredEuclideanNorm()`, exact — it passes 2^53 at ~9.5 cm. */
const squaredDistance = (a: Vec2, b: Vec2): bigint => {
  const dx = BigInt(Math.round(a.x)) - BigInt(Math.round(b.x));
  const dy = BigInt(Math.round(a.y)) - BigInt(Math.round(b.y));

  return dx * dx + dy * dy;
};

/**
 * `CIRCLE::IntersectLine( aLine )` (`circle.cpp:319`): 0, 1 (tangent) or 2
 * points where the circle meets the **infinite** line through `aLine`.
 *
 * The construction is upstream's: project the centre onto the line to get the
 * chord's midpoint `m`, then step along the line by the half-chord
 * `sqrt( R² - |Om|² )` in both directions.
 *
 * Three details carry:
 *
 * - The tangency test is a **band** of `SHAPE::MIN_PRECISION_IU` (4 IU) either
 *   side of the radius, not an equality. A line 3 IU inside the circle reports
 *   one point, not two, and that single point is `m` rather than either true
 *   crossing.
 * - `int mTo1dist = sqrt( ... )` is a C++ double-to-int conversion, which
 *   **truncates** toward zero. It is not `KiROUND`.
 * - The step is `VECTOR2I::Resize`, the integer one — {@link ResizeI} — which
 *   rounds each component through `sqrt( rescale( len², x², l² ) )` rather than
 *   scaling in doubles.
 *
 * A different `circleIntersectLine` exists, module-private, in
 * `pcbnew/src/drc/shape_collisions.ts`. It computes the same quantities in
 * doubles and backs DRC collision *locations*; it is deliberately left where it
 * is rather than repointed here, because switching it to integer rounding would
 * move DRC results for reasons unrelated to this port.
 */
export function circleIntersectLine(aCircle: Circle, aLine: Seg): Vec2[] {
  const m = segLineProject(aLine, aCircle.c);
  const omDist = EuclideanNormI(sub(m, aCircle.c));

  if (omDist > aCircle.r + MIN_PRECISION_IU) return [];

  if (omDist >= aCircle.r - MIN_PRECISION_IU) return [m]; // tangent

  const radiusSquared = BigInt(Math.round(aCircle.r)) * BigInt(Math.round(aCircle.r));
  const omDistSquared = BigInt(omDist) * BigInt(omDist);

  const mTo1dist = Math.trunc(Math.sqrt(Number(radiusSquared - omDistSquared)));
  // `aLine.B - aLine.A` is a difference of VECTOR2I upstream. `ResizeI` squares
  // its arguments in BigInt and therefore throws on a fraction, so the
  // components are converted the way `seg.ts` converts its own — through
  // `KiROUND`, which changes nothing for the integer coordinates upstream
  // guarantees.
  const mTo1vec = ResizeI(
    { x: KiROUND(aLine.b.x) - KiROUND(aLine.a.x), y: KiROUND(aLine.b.y) - KiROUND(aLine.a.y) },
    mTo1dist,
  );
  const mTo2vec = { x: -mTo1vec.x, y: -mTo1vec.y };

  return [add(mTo1vec, m), add(mTo2vec, m)];
}

/**
 * `CIRCLE::NearestPoint( const VECTOR2I& )` (`circle.cpp:196`): the point of the
 * circumference closest to `aP` — the intersection of the circle with the line
 * through `aP` and the centre.
 *
 * This is the **VECTOR2I overload**, and the distinction is not pedantic:
 * upstream has two, and the integer one resizes through `VECTOR2I::Resize`,
 * which rounds each component through
 * `sqrt( rescale( len², x², l² ) )`. `pcbnew/src/drc/shape_collisions.ts`
 * exports a `circleNearestPoint` that is the **VECTOR2D overload** — it scales
 * in doubles and returns a fractional point. Feeding that fractional point back
 * into {@link constructFromTanTanPt}, as `LINE::DragArc` does with its clamped
 * cursor, is what makes the difference visible: upstream's cursor is a
 * `VECTOR2I` throughout.
 *
 * A point exactly at the centre has no nearest point, and upstream picks the
 * `+x` direction arbitrarily rather than returning the centre.
 */
export function circleNearestPoint(aCircle: Circle, aP: Vec2): Vec2 {
  const vec = { x: KiROUND(aP.x) - KiROUND(aCircle.c.x), y: KiROUND(aP.y) - KiROUND(aCircle.c.y) };

  // Arbitrary, to ensure the return value is always on the circumference.
  if (vec.x === 0 && vec.y === 0) vec.x = 1;

  return add(ResizeI(vec, aCircle.r), aCircle.c);
}

/**
 * `CIRCLE::ConstructFromTanTanPt( aLineA, aLineB, aP )` (`circle.cpp:51`): the
 * circle tangent to both lines that passes through `aP`, choosing the solution
 * that can be used to fillet the two lines.
 *
 * Both segments are treated as **infinite lines**; their endpoints matter only
 * for picking which of the several solutions to return.
 *
 * ## The two branches
 *
 * *Parallel lines* have no vertex to work from. The centre must lie on the
 * mid-line and the radius is half the separation, so the answer is where a
 * circle of that radius centred on `aP` crosses the mid-line — of the two
 * crossings, the one nearer `aLineA.A`.
 *
 * *The general case* uses a homothety. Every circle inscribed in the same angle
 * is a scaled copy of every other about the lines' intersection point, so
 * upstream builds an arbitrary inscribed circle (`hSolution`), finds where the
 * ray from the vertex through `aP` meets it, and scales that image back. The
 * `h` prefix upstream puts on those names means "the homothetic image".
 *
 * ## Faithfulness notes
 *
 * - Upstream's five `wxCHECK_MSG( cond, *this, ... )` guards return the circle
 *   **in whatever state it has reached**, not a fresh one. In the parallel
 *   branch `Radius` and `Center` are already written when the guard fires, so a
 *   failure there returns `{ c: aP, r: halfSeparation }`. In the general branch
 *   nothing has been written yet, so a failure returns the default-constructed
 *   `{ c: (0,0), r: 0 }`. Ported exactly, because `DragArc` reads `Radius <= 0`
 *   as its own refusal condition.
 * - `furthestFromIntersect` breaks a tie toward its *second* argument and
 *   `closestToIntersect` toward its *first* — the two use `>` and `<=`
 *   respectively, which is not symmetric and decides which solution comes back
 *   for a symmetric input.
 * - The `possibleCenters.front()` / `.back()` pair is the same element when
 *   `IntersectLine` returned a tangent point, which is the normal case for the
 *   general branch's `hProjections` when `aP` is on the construction circle.
 * - The choice between the "tangent at line A" and "tangent at line B" branches
 *   is upstream's error-minimising heuristic: use whichever tangent point is
 *   *further* from `aP`, because inverting through a short segment magnifies the
 *   rounding.
 *
 * Returns a new circle; upstream mutates `*this` and returns a reference to it.
 */
export function constructFromTanTanPt(aLineA: Seg, aLineB: Seg, aP: Vec2): Circle {
  // The default-constructed CIRCLE every `wxCHECK_MSG` falls back to.
  const out: Circle = { c: { x: 0, y: 0 }, r: 0 };

  let intersectPoint: Vec2 = { x: 0, y: 0 };

  // Mutation-testing note: relaxing this `>` to `>=` survives every test here,
  // and it can only matter when the two arguments are *exactly* equidistant
  // from the intersection — the intersection at a segment's midpoint, or the
  // two `hProjections` straddling it symmetrically. No case in upstream's own
  // suite or in `LINE::DragArc` produces that, so the tie-break is transcribed
  // from upstream rather than justified by a test.
  const furthestFromIntersect = (aPt1: Vec2, aPt2: Vec2): Vec2 =>
    EuclideanNormI(sub(aPt1, intersectPoint)) > EuclideanNormI(sub(aPt2, intersectPoint))
      ? aPt1
      : aPt2;

  // The same holds for this `<=`, and note it is deliberately *not* the
  // mirror of the `>` above: upstream breaks a tie toward the first argument
  // here and toward the second there. Tightening it to `<` survives too.
  const closestToIntersect = (aPt1: Vec2, aPt2: Vec2): Vec2 =>
    EuclideanNormI(sub(aPt1, intersectPoint)) <= EuclideanNormI(sub(aPt2, intersectPoint))
      ? aPt1
      : aPt2;

  if (segApproxParallel(aLineA, aLineB)) {
    // Special case, no intersection point between the two lines. The centre
    // lies on the line equidistant from the two, and the radius is half their
    // separation; the possible centres are found by intersection.
    const perpendicularAtoB: Seg = { a: aLineA.a, b: segLineProject(aLineB, aLineA.a) };
    const midPt = segCenter(perpendicularAtoB);

    out.r = EuclideanNormI(sub(midPt, aLineA.a));

    const anglebisector = segParallelSeg(aLineA, midPt);

    // Use this circle as a construction to find the actual centres.
    out.c = { x: aP.x, y: aP.y };

    const possibleCenters = circleIntersectLine(out, anglebisector);

    if (possibleCenters.length === 0) return out; // "No solutions exist!"

    // Only to decide which solution to return.
    intersectPoint = aLineA.a;

    // For two parallel segments, return the solution whose centre is closest to
    // `aLineA.A`.
    out.c = closestToIntersect(
      possibleCenters[0] as Vec2,
      possibleCenters[possibleCenters.length - 1] as Vec2,
    );

    return out;
  }

  // General case, using homothety.
  const intersectCalc = segIntersectLines(aLineA.a, aLineA.b, aLineB.a, aLineB.b);

  if (!intersectCalc) return out; // "Lines do not intersect but are not parallel?"

  intersectPoint = intersectCalc;

  if (samePoint(aP, intersectPoint)) {
    // The point is at the intersection of the two lines.
    out.c = { x: aP.x, y: aP.y };
    out.r = 0;

    return out;
  }

  // Calculate bisector.
  const lineApt = furthestFromIntersect(aLineA.a, aLineA.b);
  const lineBpt = furthestFromIntersect(aLineB.a, aLineB.b);
  const bisectorPt = CalcArcMid(lineApt, lineBpt, intersectPoint, true);

  const anglebisector: Seg = { a: intersectPoint, b: bisectorPt };

  // An arbitrary circle tangent to both lines.
  const hSolution: Circle = { c: segLineProject(anglebisector, aP), r: 0 };
  // Mutation-testing note: measuring from `aLineB` here survives every test,
  // and near enough has to — `hSolution.c` sits on the angle bisector, so it is
  // equidistant from both lines by construction, and the two answers differ
  // only by the integer rounding of two different `LineDistance` chains. It is
  // `aLineA` because upstream writes `aLineA`, not because a test separates it.
  hSolution.r = segLineDistance(aLineA, hSolution.c);

  // The homothetic image of `aP` in the construction circle.
  const throughaP: Seg = { a: intersectPoint, b: aP };
  const hProjections = circleIntersectLine(hSolution, throughaP);

  if (hProjections.length === 0) return out; // "No solutions exist!"

  // A fillet is wanted, so take the image closest to the intersection.
  const hSelected = closestToIntersect(
    hProjections[0] as Vec2,
    hProjections[hProjections.length - 1] as Vec2,
  );

  const hTanLineA = segLineProject(aLineA, hSolution.c);
  const hTanLineB = segLineProject(aLineB, hSolution.c);

  // To minimise errors, use the tangent point furthest from `aP`.
  if (squaredDistance(hTanLineA, aP) > squaredDistance(hTanLineB, aP)) {
    // Find the tangent at line A by homothetic inversion.
    const hT: Seg = { a: hTanLineA, b: hSelected };
    const hTParallel = segParallelSeg(hT, aP);
    const actTanA = segIntersectLines(hTParallel.a, hTParallel.b, aLineA.a, aLineA.b);

    if (!actTanA) return out; // "No solutions exist!"

    // The centre is where the perpendicular meets the angle bisector.
    const perpendicularToTanA = segPerpendicularSeg(aLineA, actTanA);
    const actCenter = segIntersectLines(
      perpendicularToTanA.a,
      perpendicularToTanA.b,
      anglebisector.a,
      anglebisector.b,
    );

    if (!actCenter) return out; // "No solutions exist!"

    out.c = actCenter;
    out.r = segLineDistance(aLineA, out.c);

    return out;
  }

  // Find the tangent at line B by inversion.
  const hT: Seg = { a: hTanLineB, b: hSelected };
  const hTParallel = segParallelSeg(hT, aP);
  const actTanB = segIntersectLines(hTParallel.a, hTParallel.b, aLineB.a, aLineB.b);

  if (!actTanB) return out; // "No solutions exist!"

  const perpendicularToTanB = segPerpendicularSeg(aLineB, actTanB);
  const actCenter = segIntersectLines(
    perpendicularToTanB.a,
    perpendicularToTanB.b,
    anglebisector.a,
    anglebisector.b,
  );

  if (!actCenter) return out; // "No solutions exist!"

  out.c = actCenter;
  out.r = segLineDistance(aLineB, out.c);

  return out;
}
