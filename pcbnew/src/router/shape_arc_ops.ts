// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `SHAPE_ARC` operations the meander's rounded corners are built from.
 * Counterparts: `libs/kimath/src/geometry/shape_arc.cpp`
 * (`ConstructFromStartEndAngle`, `update_values`, `GetStartAngle`,
 * `GetCentralAngle`, `GetLength`, `Mirror( const SEG& )`, `ConvertToPolyline`),
 * `libs/kimath/include/geometry/shape_arc.h` (`IsCCW`,
 * `DefaultAccuracyForPCB`), the `CalcArcCenter( start, end, angle )` overload in
 * `libs/kimath/src/trigo.cpp:329`, and `getArcPolygonizationMaxError`
 * (`shape_line_chain.cpp:57`).
 *
 * ## Free functions over the existing `ShapeArc`, not a class
 *
 * `ShapeArc` is already `{ p0, arcMid, p1, width }` in `pns_arc.ts` — upstream's
 * three-point representation, and the one the board file writes. Upstream's
 * `SHAPE_ARC` caches `m_center` and `m_radius` in `update_values()`; here they
 * are derived on demand. That is not a behavioural difference: `update_values`
 * recomputes them from the same three points after every mutation, and the only
 * other thing it maintains is the bounding box, which nothing in the meander
 * reads. Deriving keeps the three points as the single truth, which is the
 * reason `pns_arc.ts` gives for storing them that way in the first place.
 *
 * The centre is derived exactly as upstream caches it — `CalcArcCenter` on the
 * three points, `KiROUND`ed and clamped to `int` range — so `GetCenter()` is
 * integral here as it is there, and the start/central angles that hang off it
 * are bit-identical rather than merely close.
 */
import { CalcArcCenter } from '@ziroeda/kimath/src/trigo.js';
import {
  EDA_ANGLE,
  ANGLE_0,
  ANGLE_90,
  ANGLE_180,
  ANGLE_360,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { RotatePoint, RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import { getArcToSegmentCount } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { segReflectPoint } from './pns_seg_ops.js';
import type { Seg } from './pns_line.js';
import type { ShapeArc } from './pns_arc.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `ARC_HIGH_DEF` (`include/base_units.h:137`): `pcbIUScale.mmToIU( 0.005 )`. */
export const ARC_HIGH_DEF = 5000;

/**
 * `getArcPolygonizationMaxError` (`shape_line_chain.cpp:57`):
 * `SHAPE_ARC::DefaultAccuracyForPCB() / 5`.
 *
 * A fifth of the normal budget because the polyline is only ever a stand-in for
 * display and collision — the native arc stays the truth for output.
 */
export const ARC_POLYGONIZATION_MAX_ERROR = ARC_HIGH_DEF / 5;

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

const noNegZero = (v: number): number => (v === 0 ? 0 : v);

/** `(int) aDouble` — C's cast truncates toward zero. */
export const truncToInt = (v: number): number => noNegZero(Math.trunc(v));

/** `VECTOR2D → VECTOR2I`, which is `(T) aVec.x` per component. */
export const truncVec = (v: Vec2): Vec2 => ({ x: truncToInt(v.x), y: truncToInt(v.y) });

/**
 * `CalcArcCenter( const VECTOR2I&, const VECTOR2I&, const VECTOR2I& )`
 * (trigo.cpp:544): the `VECTOR2D` circumcentre, rounded and clamped to `int`
 * range with a 100 IU margin.
 */
export function arcCenterI(aStart: Vec2, aMid: Vec2, aEnd: Vec2): Vec2 {
  const c = CalcArcCenter(aStart, aMid, aEnd);
  const clamp = (v: number): number => Math.min(INT_MAX - 100, Math.max(INT_MIN + 100, v));

  return { x: KiROUND(clamp(c.x)), y: KiROUND(clamp(c.y)) };
}

/**
 * `CalcArcCenter( const VECTOR2D& aStart, const VECTOR2D& aEnd, const
 * EDA_ANGLE& aAngle )` (trigo.cpp:329).
 *
 * The two normalisations at the top are what make the answer single-valued: a
 * negative angle and an angle past 180° both name the same chord traversed the
 * other way, so both swap the endpoints. Without them the perpendicular offset
 * would be applied to the wrong side and the arc would bulge the wrong way.
 */
export function arcCenterFromStartEndAngle(aStart: Vec2, aEnd: Vec2, aAngle: EDA_ANGLE): Vec2 {
  let angle = aAngle;
  let start = aStart;
  let end = aEnd;

  if (angle.lt(ANGLE_0)) {
    const t = start;
    start = end;
    end = t;
    angle = angle.negate();
  }

  if (angle.gt(ANGLE_180)) {
    const t = start;
    start = end;
    end = t;
    angle = ANGLE_360.sub(angle);
  }

  const chord = Math.hypot(start.x - end.x, start.y - end.y);
  const sinHalfAngle = angle.divide(2.0).Sin();

  // A zero arc angle has no defined centre; upstream falls back to the chord
  // midpoint rather than dividing by zero.
  if (sinHalfAngle === 0.0) return { x: (start.x + end.x) / 2.0, y: (start.y + end.y) / 2.0 };

  const r = chord / 2.0 / sinHalfAngle;
  const dSquared = r * r - (chord * chord) / 4.0;
  const d = dSquared > 0.0 ? Math.sqrt(dSquared) : 0.0;

  const delta = { x: end.x - start.x, y: end.y - start.y };
  let vec2 = resizeD(delta, d);
  const vc = resizeD(delta, chord / 2);

  vec2 = RotatePointD(vec2, ANGLE_90.negate());

  return { x: start.x + vc.x + vec2.x, y: start.y + vc.y + vec2.y };
}

/**
 * `VECTOR2<double>::Resize( aNewLength )` (`math/vector2d.h:381`).
 *
 * Three details, all of them observable:
 *
 *  - a zero vector stays zero rather than becoming a NaN;
 *  - `|x| == |y|` is its own branch returning `|len| * √½` on both axes, which
 *    is exact for the 45° directions the router lives on and is *not* what the
 *    general branch's two square roots would produce;
 *  - the length's sign multiplies the result, so `Resize( 0 )` is `(0,0)` and a
 *    negative length reverses the vector. The meander relies on the negative
 *    case: `aDir.Resize( offset )` with a negative baseline offset is how the
 *    second line of a diff pair lands on the far side of the baseline.
 */
export function resizeD(aVec: Vec2, aNewLength: number): Vec2 {
  if (aVec.x === 0 && aVec.y === 0) return { x: 0, y: 0 };

  let newX: number;
  let newY: number;

  if (Math.abs(aVec.x) === Math.abs(aVec.y)) {
    newX = newY = Math.abs(aNewLength) * Math.SQRT1_2;
  } else {
    const xSq = aVec.x * aVec.x;
    const ySq = aVec.y * aVec.y;
    const lSq = xSq + ySq;
    const newLengthSq = aNewLength * aNewLength;

    // The double specialisation of `rescale` is a plain `a * b / c`.
    newX = Math.sqrt((newLengthSq * xSq) / lSq);
    newY = Math.sqrt((newLengthSq * ySq) / lSq);
  }

  // `sign( 0 ) == 0`, so a zero length collapses the vector.
  const s = aNewLength > 0 ? 1 : aNewLength < 0 ? -1 : 0;

  return {
    x: noNegZero((aVec.x < 0 ? -newX : newX) * s),
    y: noNegZero((aVec.y < 0 ? -newY : newY) * s),
  };
}

/** `VECTOR2::Perpendicular()`: `(-y, x)`. */
export const perpendicular = (aVec: Vec2): Vec2 => ({ x: -aVec.y, y: aVec.x });

/**
 * `SHAPE_ARC::ConstructFromStartEndAngle`.
 *
 * The mid point is the start rotated about the centre by **minus half** the
 * angle — KiCad's rotation is clockwise on screen for a positive angle, so the
 * negation is what puts the mid point on the same side of the chord as the
 * sweep.
 *
 * Two conversions, and they differ: the centre comes from the `VECTOR2D`
 * `CalcArcCenter` into a `VECTOR2I`, which **truncates**; the mid point is then
 * rotated by the *integer* `RotatePoint` overload, which **rounds**.
 */
export function constructArcFromStartEndAngle(
  aStart: Vec2,
  aEnd: Vec2,
  aAngle: EDA_ANGLE,
  aWidth = 0,
): ShapeArc {
  const centre = truncVec(arcCenterFromStartEndAngle(aStart, aEnd, aAngle));
  const mid = RotatePoint({ ...aStart }, centre, aAngle.divide(2.0).negate());

  return { p0: { ...aStart }, arcMid: mid, p1: { ...aEnd }, width: aWidth };
}

/** `SHAPE_ARC::GetCenter()` — integral, as `update_values()` caches it. */
export const shapeArcCenter = (aArc: ShapeArc): Vec2 => arcCenterI(aArc.p0, aArc.arcMid, aArc.p1);

/** `SHAPE_ARC::GetRadius()`. */
export function arcRadius(aArc: ShapeArc): number {
  const c = shapeArcCenter(aArc);

  return Math.sqrt((aArc.p0.x - c.x) ** 2 + (aArc.p0.y - c.y) ** 2);
}

/** `SHAPE_ARC::GetStartAngle()`. */
export function arcStartAngle(aArc: ShapeArc): EDA_ANGLE {
  const c = shapeArcCenter(aArc);

  return EDA_ANGLE.fromVector({ x: aArc.p0.x - c.x, y: aArc.p0.y - c.y }).Normalize();
}

/**
 * `SHAPE_ARC::IsCCW()`: the cross product of (end - mid) with (start - mid).
 *
 * The mid point is what decides this. Start and end alone name two arcs with
 * the same centre, and the shorter one is not always the intended one.
 */
export function arcIsCCW(aArc: ShapeArc): boolean {
  const v1 = { x: aArc.p1.x - aArc.arcMid.x, y: aArc.p1.y - aArc.arcMid.y };
  const v2 = { x: aArc.p0.x - aArc.arcMid.x, y: aArc.p0.y - aArc.arcMid.y };

  return v1.x * v2.y - v1.y * v2.x > 0;
}

/**
 * `SHAPE_ARC::GetCentralAngle()`.
 *
 * An arc whose start and end coincide is a **circle**, and upstream answers 360°
 * rather than 0 — the degenerate-arc reading would make a full turn measure
 * nothing.
 */
export function arcCentralAngle(aArc: ShapeArc): EDA_ANGLE {
  if (aArc.p0.x === aArc.p1.x && aArc.p0.y === aArc.p1.y) return ANGLE_360;

  const c = shapeArcCenter(aArc);
  let angle = EDA_ANGLE.fromVector({ x: aArc.p1.x - c.x, y: aArc.p1.y - c.y }).sub(
    EDA_ANGLE.fromVector({ x: aArc.p0.x - c.x, y: aArc.p0.y - c.y }),
  );

  if (arcIsCCW(aArc)) {
    if (angle.lt(ANGLE_0)) angle = angle.add(ANGLE_360);
  } else if (angle.gt(ANGLE_0)) {
    angle = angle.sub(ANGLE_360);
  }

  return angle;
}

/** `SHAPE_ARC::GetLength()`. */
export const arcLength = (aArc: ShapeArc): number =>
  Math.abs(arcRadius(aArc) * arcCentralAngle(aArc).AsRadians());

/** `SHAPE_ARC::Mirror( const SEG& axis )`: all three points reflected. */
export const arcMirror = (aArc: ShapeArc, aAxis: Seg): ShapeArc => ({
  p0: segReflectPoint(aAxis, aArc.p0),
  arcMid: segReflectPoint(aAxis, aArc.arcMid),
  p1: segReflectPoint(aAxis, aArc.p1),
  width: aArc.width,
});

/**
 * `CircleToEndSegmentDeltaRadius` (`geometry_utils.cpp`).
 *
 * Computed here rather than imported from
 * `libs/kimath/src/convert_basic_shapes_to_polygon.ts`, whose
 * `circleToEndSegmentDeltaRadius` evaluates `r * (1 - cos α)` where upstream
 * evaluates `| r * (1 - 1/cos α) |` — a different quantity (the first is the
 * sagitta measured inward, the second the outward growth of the circumscribed
 * polygon). `ConvertToPolyline` needs upstream's, and `libs/kimath` is
 * additive-only for this work, so the divergence is reported rather than fixed.
 */
function circleToEndSegmentDeltaRadiusUpstream(aRadius: number, aSegCount: number): number {
  // Below three there is no polygon to speak of, and upstream clamps rather
  // than dividing into a degenerate angle.
  const segCount = aSegCount <= 2 ? 3 : aSegCount;
  const alpha = Math.PI / segCount;

  return KiROUND(Math.abs(aRadius * (1 - 1 / Math.cos(alpha))));
}

/**
 * `SHAPE_ARC::ConvertToPolyline( aMaxError )`, returning the points.
 *
 * Three things here are easy to get subtly wrong and all three are load
 * bearing:
 *
 *  1. the segment count is taken on the **external** radius (`r + width/2`),
 *     not the centreline radius — for a fat arc of small radius the difference
 *     is large enough to blow the error budget;
 *  2. the radius is then grown by *half* the achieved error, so the polyline
 *     straddles the true arc instead of sitting entirely inside it — and the
 *     first and last points are still the exact endpoints, which is why the
 *     loop below runs over odd indices of a doubled count rather than simply
 *     stepping `n` times;
 *  3. a degenerate arc — external radius under half the error budget, or a mid
 *     point that has collapsed onto the chord — is emitted as the bare chord,
 *     with the effective error taken as the whole external radius.
 *
 * `aActualError` is not ported: nothing in the meander reads it.
 */
export function arcConvertToPolyline(
  aArc: ShapeArc,
  aMaxError: number = ARC_POLYGONIZATION_MAX_ERROR,
): Vec2[] {
  let r = arcRadius(aArc);
  const sa = arcStartAngle(aArc);
  const c = shapeArcCenter(aArc);
  const ca = arcCentralAngle(aArc);

  const halfMaxError = Math.max(1.0, aMaxError / 2.0);
  const externalRadius = r + aArc.width / 2.0;

  let n: number;
  let effectiveError: number;

  if (
    externalRadius < halfMaxError ||
    distanceToSeg(aArc.p0, aArc.p1, aArc.arcMid) < halfMaxError
  ) {
    n = 0;
    effectiveError = externalRadius;
  } else {
    // Both helpers take `int aRadius`, so the double external radius truncates
    // on the way in — and it really can be a hair under the integer, because it
    // comes out of a square root.
    n = getArcToSegmentCount(truncToInt(externalRadius), aMaxError, ca.AsDegrees());

    // `int seg360 = n * 360.0 / fabs( ca.AsDegrees() )` — an int, so truncated.
    const seg360 = truncToInt((n * 360.0) / Math.abs(ca.AsDegrees()));
    effectiveError = circleToEndSegmentDeltaRadiusUpstream(truncToInt(externalRadius), seg360);
  }

  r += effectiveError / 2;
  n = n * 2;

  const out: Vec2[] = [{ ...aArc.p0 }];

  for (let i = 1; i < n; i += 2) {
    // Upstream guards `n != 0` inside a loop that cannot run when `n == 0`.
    const a = sa.add(ca.multiply(i).divide(n));

    out.push({ x: KiROUND(c.x + r * a.Cos()), y: KiROUND(c.y + r * a.Sin()) });
  }

  out.push({ ...aArc.p1 });

  return out;
}

/** `SEG::Distance( const VECTOR2I& )` for the degeneracy test above. */
function distanceToSeg(aA: Vec2, aB: Vec2, aP: Vec2): number {
  const dx = aB.x - aA.x;
  const dy = aB.y - aA.y;
  const lSq = dx * dx + dy * dy;

  if (lSq === 0) return Math.hypot(aP.x - aA.x, aP.y - aA.y);

  const t = Math.max(0, Math.min(1, ((aP.x - aA.x) * dx + (aP.y - aA.y) * dy) / lSq));

  return Math.hypot(aP.x - (aA.x + dx * t), aP.y - (aA.y + dy * t));
}
