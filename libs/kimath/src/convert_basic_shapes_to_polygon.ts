// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Basic shapes to polygons.
 * Counterparts: `libs/kimath/src/convert_basic_shapes_to_polygon.cpp` and
 * `GetArcToSegmentCount` from `libs/kimath/src/geometry/geometry_utils.cpp`.
 */

import { KiROUND, rescale64 } from './math/util.js';
import { EuclideanNormI, Perpendicular, ResizeI, type VECTOR2I } from './math/vector2.js';
import { acos, asin, cos, hypot, sin } from './math/libm.js';
import { EDA_ANGLE, EDA_ANGLE_T } from './geometry/eda_angle.js';
import { getArcToSegmentCount } from './geometry/geometry_utils.js';

export { getArcToSegmentCount };
import { RotatePoint } from './trigo.js';
import { segIntersectLines } from './geometry/seg.js';
import { booleanIntersection, fractureSingle, type Polygon } from './geometry/shape_poly_set.js';

/** Where the approximation error is spent relative to the true shape. */
export enum ErrorLoc {
  /** The polygon lies inside the shape: vertices sit on the true outline. */
  ERROR_INSIDE = 0,
  /** The polygon encloses the shape: the radius is grown to compensate. */
  ERROR_OUTSIDE = 1,
}

/**
 * `CircleToEndSegmentDeltaRadius` (geometry_utils.cpp): how far the polygon's
 * *vertices* stand outside the circle its edges are tangent to.
 *
 * `aRadius` is the radius of the circle tangent to the middle of each segment,
 * so `aRadius / cos(alpha)` is the radius through the segment ends and the
 * difference between them is `r * (1 - 1/cos alpha)`. That is a **secant**
 * relationship, not a cosine one: `r * (1 - cos alpha)` is the sagitta — how
 * far a chord's midpoint falls *inside* the circle — which is a different
 * quantity and always the smaller of the two.
 *
 * Getting this wrong is invisible except in size: the sole caller adds the
 * result back to the radius for `ERROR_OUTSIDE`, so a sagitta under-inflates
 * the polygon and it no longer encloses the circle it is standing in for. The
 * ratio is exactly `1 / cos alpha`, so the shortfall is ~8.2% of the
 * correction at the 8-segment floor, ~2.0% at 16 and ~0.5% at 32.
 */
export function circleToEndSegmentDeltaRadius(aRadius: number, aSegCount: number): number {
  // The minimum is 3, or the result cannot be computed; in practice KiCad
  // clamps to 8.
  const segCount = aSegCount <= 2 ? 3 : aSegCount;
  const alpha = Math.PI / segCount;
  return KiROUND(Math.abs(aRadius * (1.0 - 1.0 / Math.cos(alpha))));
}

/**
 * TransformCircleToPolygon, the SHAPE_LINE_CHAIN form.
 *
 * The vertex phase (`delta / 2`) and the round-up to a multiple of 8 are not
 * cosmetic: they put vertices symmetrically about the axes and land segment
 * boundaries on the 45° diagonals, so a track entering a via along an axis
 * meets an edge rather than a corner. Sampling from angle 0 instead shifts
 * every teardrop anchor by half a segment.
 */
export function transformCircleToPolygon(
  aCenter: VECTOR2I,
  aRadius: number,
  aError: number,
  aErrorLoc: ErrorLoc = ErrorLoc.ERROR_INSIDE,
  aMinSegCount = 0,
): VECTOR2I[] {
  let numSegs = getArcToSegmentCount(aRadius, aError, 360);
  numSegs = Math.max(aMinSegCount, numSegs);

  // Round up to 8 so the approximation aligns at 45 degrees.
  numSegs = Math.ceil(numSegs / 8) * 8;

  const delta = 360 / numSegs;
  let radius = aRadius;

  if (aErrorLoc === ErrorLoc.ERROR_OUTSIDE) {
    const actualDeltaRadius = circleToEndSegmentDeltaRadius(radius, numSegs);
    // GetCircleToPolyCorrection: the whole delta is added back.
    radius += actualDeltaRadius;
  }

  const buffer: VECTOR2I[] = [];

  for (let angle = delta / 2; angle < 360; angle += delta) {
    // RotatePoint's sense: KiCad's y axis points down, so a positive angle
    // turns clockwise on screen. (radius, 0) rotated by `angle` is therefore
    // (r cos a, -r sin a).
    const rad = (angle * Math.PI) / 180;
    buffer.push({
      x: aCenter.x + KiROUND(radius * Math.cos(rad)),
      y: aCenter.y - KiROUND(radius * Math.sin(rad)),
    });
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// The SHAPE_POLY_SET forms, as the zone filler's knockouts call them: each
// returns the closed outline(s) exactly as `aBuffer.Append( … )` would hold
// them, duplicate closing point and all.

/**
 * `TransformCircleToPolygon( SHAPE_POLY_SET&, … )`: the SHAPE_LINE_CHAIN
 * form above plus the "Finish circle" vertex, which repeats the first one.
 */
export function transformCircleToPolygonSet(
  aCenter: VECTOR2I,
  aRadius: number,
  aError: number,
  aErrorLoc: ErrorLoc,
  aMinSegCount = 0,
): VECTOR2I[] {
  let numSegs = getArcToSegmentCount(aRadius, aError, 360);
  numSegs = Math.max(aMinSegCount, numSegs);
  numSegs = Math.trunc((numSegs + 7) / 8) * 8;

  const delta = new EDA_ANGLE(360 / numSegs);
  let radius = aRadius;

  if (aErrorLoc === ErrorLoc.ERROR_OUTSIDE) {
    const actual_delta_radius = circleToEndSegmentDeltaRadius(radius, numSegs);
    radius += actual_delta_radius; // GetCircleToPolyCorrection
  }

  const out: VECTOR2I[] = [];
  const half = new EDA_ANGLE(delta.AsDegrees() / 2);
  for (let angle = half.AsDegrees(); angle < 360; angle += delta.AsDegrees()) {
    const corner = RotatePoint({ x: radius, y: 0 }, new EDA_ANGLE(angle));
    out.push({ x: corner.x + aCenter.x, y: corner.y + aCenter.y });
  }
  // Finish circle
  const corner = RotatePoint({ x: radius, y: 0 }, half);
  out.push({ x: corner.x + aCenter.x, y: corner.y + aCenter.y });
  return out;
}

/**
 * `TransformOvalToPolygon`: the rounded ends are built one radius-correction
 * too wide, clamped to the segment's own width by a BooleanIntersection with
 * its bounding box, then rotated into place — so the vertices are what
 * Clipper returns, not what the arithmetic drew.
 */
export function transformOvalToPolygon(
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aWidth: number,
  aError: number,
  aErrorLoc: ErrorLoc,
  aMinSegCount = 0,
): Polygon[] {
  let radius = Math.trunc(aWidth / 2);
  let numSegs = getArcToSegmentCount(radius, aError, 360);
  numSegs = Math.max(aMinSegCount, numSegs);
  numSegs = Math.trunc((numSegs + 7) / 8) * 8;

  const delta = 360 / numSegs;

  if (aErrorLoc === ErrorLoc.ERROR_OUTSIDE) {
    const actual_delta_radius = circleToEndSegmentDeltaRadius(radius, numSegs);
    radius += actual_delta_radius;
  }

  let endp: VECTOR2I = { x: aEnd.x - aStart.x, y: aEnd.y - aStart.y };
  let startp = aStart;
  const polyshape: VECTOR2I[] = [];

  if (endp.x < 0) {
    endp = { x: aStart.x - aEnd.x, y: aStart.y - aEnd.y };
    startp = aEnd;
  }

  const delta_angle = EDA_ANGLE.fromVector(endp);
  const seg_len = EuclideanNormI(endp);

  // add right rounded end:
  polyshape.push({ x: seg_len, y: radius });
  for (let angle = delta / 2; angle < 180; angle += delta) {
    const corner = RotatePoint({ x: 0, y: radius }, new EDA_ANGLE(angle));
    polyshape.push({ x: corner.x + seg_len, y: corner.y });
  }
  polyshape.push({ x: seg_len, y: -radius });
  // Left arc start:
  polyshape.push({ x: 0, y: -radius });
  for (let angle = delta / 2; angle < 180; angle += delta) {
    const corner = RotatePoint({ x: 0, y: -radius }, new EDA_ANGLE(angle));
    polyshape.push(corner);
  }
  polyshape.push({ x: 0, y: radius });

  // Now trim the edges of the polygonal shape which will be slightly outside
  // the track width.
  const halfwidth = Math.trunc(aWidth / 2);
  const bbox: VECTOR2I[] = [
    { x: -radius - 2, y: halfwidth },
    { x: -radius - 2, y: -halfwidth },
    { x: radius + seg_len + 2, y: -halfwidth },
    { x: radius + seg_len + 2, y: halfwidth },
  ];

  const appended: VECTOR2I[] = [];
  for (const p of polyshape) {
    const l = appended[appended.length - 1];
    if (!l || l.x !== p.x || l.y !== p.y) appended.push(p);
  }
  const clamped = booleanIntersection([[appended]], [[bbox]]);

  // Rotate and move the polygon to its right location
  const minus = new EDA_ANGLE(-delta_angle.AsDegrees());
  return clamped.map((poly) =>
    poly.map((ring) =>
      ring.map((pt) => {
        const r = RotatePoint(pt, minus);
        return { x: r.x + startp.x, y: r.y + startp.y };
      }),
    ),
  );
}

interface RoundedCorner {
  m_position: VECTOR2I;
  m_radius: number;
}

/** `SEG::Side`: which side of A→B the point lies, by the sign of the cross. */
function segSide(a: VECTOR2I, b: VECTOR2I, p: VECTOR2I): number {
  const det =
    (BigInt(b.x) - BigInt(a.x)) * (BigInt(p.y) - BigInt(a.y)) -
    (BigInt(b.y) - BigInt(a.y)) * (BigInt(p.x) - BigInt(a.x));
  return det < 0n ? -1 : det > 0n ? 1 : 0;
}

/** `SEG::ReflectPoint`: the point mirrored across the line A→B. */
function segReflectPoint(a: VECTOR2I, b: VECTOR2I, p: VECTOR2I): VECTOR2I {
  const dx = BigInt(b.x - a.x);
  const dy = BigInt(b.y - a.y);
  const l_squared = dx * dx + dy * dy;
  const t = dx * BigInt(p.x - a.x) + dy * BigInt(p.y - a.y);
  let cx: bigint;
  let cy: bigint;
  if (l_squared === 0n) {
    cx = BigInt(p.x);
    cy = BigInt(p.y);
  } else {
    cx = BigInt(a.x) + rescale64(t, dx, l_squared);
    cy = BigInt(a.y) + rescale64(t, dy, l_squared);
  }
  return { x: Number(2n * cx - BigInt(p.x)), y: Number(2n * cy - BigInt(p.y)) };
}

/**
 * `CornerListToPolygon`: a convex corner list, clockwise, no duplicates,
 * rounded and inflated corner by corner.
 */
function cornerListToPolygon(
  aCorners: RoundedCorner[],
  aInflate: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): VECTOR2I[] {
  const outline: VECTOR2I[] = [];
  const last = aCorners[aCorners.length - 1]!;
  let incoming: VECTOR2I = {
    x: aCorners[0]!.m_position.x - last.m_position.x,
    y: aCorners[0]!.m_position.y - last.m_position.y,
  };

  for (let n = 0, count = aCorners.length; n < count; n++) {
    const cur = aCorners[n]!;
    const next = aCorners[(n + 1) % count]!;
    const outgoing: VECTOR2I = {
      x: next.m_position.x - cur.m_position.x,
      y: next.m_position.y - cur.m_position.y,
    };

    if (!(aInflate || cur.m_radius)) {
      outline.push({ ...cur.m_position });
    } else {
      let cornerPosition: VECTOR2I = { ...cur.m_position };
      let radius = cur.m_radius;
      let endAngle: EDA_ANGLE;
      let tanAngle2: number;

      if ((incoming.x === 0 && outgoing.y === 0) || (incoming.y === 0 && outgoing.x === 0)) {
        endAngle = new EDA_ANGLE(90);
        tanAngle2 = 1.0;
      } else {
        const cosNum = incoming.x * outgoing.x + incoming.y * outgoing.y;
        const cosDen = EuclideanNormI(incoming) * EuclideanNormI(outgoing);
        const angle = acos(cosNum / cosDen);
        tanAngle2 = Math.tan((Math.PI - angle) / 2);
        endAngle = new EDA_ANGLE(angle, EDA_ANGLE_T.RADIANS_T);
      }

      if (aInflate && tanAngle2) {
        radius += aInflate;
        const a = ResizeI(incoming, Math.trunc(aInflate / tanAngle2));
        const b = ResizeI(Perpendicular(incoming), -aInflate);
        cornerPosition = { x: cornerPosition.x + a.x + b.x, y: cornerPosition.y + a.y + b.y };
      }

      // Ensure 16+ segments per 360deg and ensure first & last segment are the same size
      const numSegs = Math.max(16, getArcToSegmentCount(radius, aError, 360));
      const angDelta = new EDA_ANGLE(360 / numSegs);
      let lastSeg = new EDA_ANGLE(endAngle.AsDegrees());

      if (lastSeg.AsDegrees() > 0) {
        while (lastSeg.AsDegrees() > angDelta.AsDegrees())
          lastSeg = new EDA_ANGLE(lastSeg.AsDegrees() - angDelta.AsDegrees());
      } else {
        while (lastSeg.AsDegrees() < -angDelta.AsDegrees())
          lastSeg = new EDA_ANGLE(lastSeg.AsDegrees() + angDelta.AsDegrees());
      }

      let angPos =
        lastSeg.AsDegrees() === 0
          ? angDelta.AsDegrees()
          : (angDelta.AsDegrees() + lastSeg.AsDegrees()) / 2;

      const arcTransitionDistance = tanAngle2 > 0 ? radius / tanAngle2 : 0;
      const tr = ResizeI(incoming, Math.trunc(arcTransitionDistance));
      let arcStart: VECTOR2I = { x: cornerPosition.x - tr.x, y: cornerPosition.y - tr.y };
      const pr = ResizeI(Perpendicular(incoming), radius);
      const arcCenter: VECTOR2I = { x: arcStart.x + pr.x, y: arcStart.y + pr.y };
      let arcEnd: VECTOR2I;
      let arcStartOrigin: VECTOR2I;
      let endAngleDeg = endAngle.AsDegrees();

      if (aErrorLoc === ErrorLoc.ERROR_INSIDE) {
        arcEnd = segReflectPoint(cornerPosition, arcCenter, arcStart);
        arcStartOrigin = { x: arcStart.x - arcCenter.x, y: arcStart.y - arcCenter.y };
        outline.push(arcStart);
      } else {
        // The outer radius should be radius+aError, recalculate because numSegs is clamped
        const actualDeltaRadius = circleToEndSegmentDeltaRadius(radius, numSegs);
        const radiusExtend = actualDeltaRadius; // GetCircleToPolyCorrection
        const ext = ResizeI(Perpendicular(incoming), -radiusExtend);
        arcStart = { x: arcStart.x + ext.x, y: arcStart.y + ext.y };
        arcStartOrigin = { x: arcStart.x - arcCenter.x, y: arcStart.y - arcCenter.y };

        // To avoid "ears", we only add segments crossing/within the non-rounded outline
        // Note: outlineIn is short and must be treated as defining an infinite line
        const outlineInA: VECTOR2I = {
          x: cornerPosition.x - incoming.x,
          y: cornerPosition.y - incoming.y,
        };
        const outlineInB = cornerPosition;
        let prevPt = arcStart;
        arcEnd = cornerPosition; // default if no points within the outline are found

        while (angPos < endAngleDeg) {
          const rot = RotatePoint(arcStartOrigin, new EDA_ANGLE(-angPos));
          const pt: VECTOR2I = { x: rot.x + arcCenter.x, y: rot.y + arcCenter.y };
          angPos += angDelta.AsDegrees();

          if (segSide(outlineInA, outlineInB, pt) > 0) {
            const intersect = segIntersectLines(
              { a: outlineInA, b: outlineInB },
              { a: prevPt, b: pt },
            );
            if (!intersect) break; // wxCHECK_RET( intersect, "No solutions exist!" )
            outline.push(intersect);
            outline.push(pt);
            arcEnd = segReflectPoint(cornerPosition, arcCenter, intersect);
            break;
          }

          endAngleDeg -= angDelta.AsDegrees(); // if skipping first, also skip last
          prevPt = pt;
        }
      }

      for (; angPos < endAngleDeg; angPos += angDelta.AsDegrees()) {
        const rot = RotatePoint(arcStartOrigin, new EDA_ANGLE(-angPos));
        outline.push({ x: rot.x + arcCenter.x, y: rot.y + arcCenter.y });
      }

      outline.push(arcEnd);
    }

    incoming = outgoing;
  }
  return outline;
}

function cornerListRemoveDuplicates(aCorners: RoundedCorner[]): void {
  let prev = aCorners[0]!.m_position;
  for (let pos = aCorners.length - 1; pos >= 0; pos--) {
    const c = aCorners[pos]!;
    if (c.m_position.x === prev.x && c.m_position.y === prev.y) aCorners.splice(pos, 1);
    else prev = c.m_position;
  }
}

/** `SHAPE_LINE_CHAIN::Append` on every point, then Rotate and Move. */
function placeOutline(outline: VECTOR2I[], aRotation: EDA_ANGLE, aPosition: VECTOR2I): VECTOR2I[] {
  const appended: VECTOR2I[] = [];
  for (const p of outline) {
    const l = appended[appended.length - 1];
    if (!l || l.x !== p.x || l.y !== p.y) appended.push(p);
  }
  const rotated =
    aRotation.AsDegrees() === 0 ? appended : appended.map((p) => RotatePoint(p, aRotation));
  return rotated.map((p) => ({ x: p.x + aPosition.x, y: p.y + aPosition.y }));
}

/** `TransformTrapezoidToPolygon`. */
export function transformTrapezoidToPolygon(
  aPosition: VECTOR2I,
  aSize: VECTOR2I,
  aRotation: EDA_ANGLE,
  aDeltaX: number,
  aDeltaY: number,
  aInflate: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): VECTOR2I[] {
  const size: VECTOR2I = { x: Math.trunc(aSize.x / 2), y: Math.trunc(aSize.y / 2) };
  const corners: RoundedCorner[] = [];
  const rc = (x: number, y: number): RoundedCorner => ({ m_position: { x, y }, m_radius: 0 });

  if (aInflate < 0) {
    if (!aDeltaX && !aDeltaY) {
      size.x = Math.max(1, size.x + aInflate);
      size.y = Math.max(1, size.y + aInflate);
    } else if (aDeltaX) {
      const slope = aDeltaX / size.x;
      const yShrink = KiROUND((hypot(size.x, aDeltaX) * aInflate) / size.x);
      size.y = Math.max(1, size.y + yShrink);
      size.x = Math.max(1, size.x + aInflate);
      aDeltaX = KiROUND(size.x * slope);
      if (aDeltaX > size.y) {
        corners.push(rc(-size.x, -size.y - aDeltaX));
        corners.push(rc(KiROUND(size.y / slope), 0));
        corners.push(rc(-size.x, size.y + aDeltaX));
      }
    } else {
      const slope = aDeltaY / size.y;
      const xShrink = KiROUND((hypot(size.y, aDeltaY) * aInflate) / size.y);
      size.x = Math.max(1, size.x + xShrink);
      size.y = Math.max(1, size.y + aInflate);
      aDeltaY = KiROUND(size.y * slope);
      if (aDeltaY > size.x) {
        corners.push(rc(0, -KiROUND(size.x / slope)));
        corners.push(rc(size.x + aDeltaY, size.y));
        corners.push(rc(-size.x - aDeltaY, size.y));
      }
    }
    aInflate = 0;
  }

  if (corners.length === 0) {
    corners.push(rc(-size.x + aDeltaY, -size.y - aDeltaX));
    corners.push(rc(size.x - aDeltaY, -size.y + aDeltaX));
    corners.push(rc(size.x + aDeltaY, size.y - aDeltaX));
    corners.push(rc(-size.x - aDeltaY, size.y + aDeltaX));
    if (Math.abs(aDeltaY) === Math.abs(size.x) || Math.abs(aDeltaX) === Math.abs(size.y))
      cornerListRemoveDuplicates(corners);
  }

  const outline = cornerListToPolygon(corners, aInflate, aError, aErrorLoc);
  return placeOutline(outline, aRotation, aPosition);
}

export const RECT_CHAMFER_TOP_LEFT = 1;
export const RECT_CHAMFER_TOP_RIGHT = 2;
export const RECT_CHAMFER_BOTTOM_LEFT = 4;
export const RECT_CHAMFER_BOTTOM_RIGHT = 8;

/** `TransformRoundChamferedRectToPolygon`. */
export function transformRoundChamferedRectToPolygon(
  aPosition: VECTOR2I,
  aSize: VECTOR2I,
  aRotation: EDA_ANGLE,
  aCornerRadius: number,
  aChamferRatio: number,
  aChamferCorners: number,
  aInflate: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): VECTOR2I[] {
  const size: VECTOR2I = { x: Math.trunc(aSize.x / 2), y: Math.trunc(aSize.y / 2) };
  let chamferCnt = 0;
  for (let b = aChamferCorners & 0xff; b; b >>= 1) chamferCnt += b & 1;
  let chamferDeduct = 0;

  if (aInflate < 0) {
    size.x = Math.max(1, size.x + aInflate);
    size.y = Math.max(1, size.y + aInflate);
    chamferDeduct = aInflate * (2.0 - Math.SQRT2);
    aCornerRadius = Math.max(0, aCornerRadius + aInflate);
    aInflate = 0;
  }

  const rc = (x: number, y: number, r: number): RoundedCorner => ({
    m_position: { x, y },
    m_radius: r,
  });
  const corners: RoundedCorner[] = [
    rc(-size.x, -size.y, aCornerRadius),
    rc(size.x, -size.y, aCornerRadius),
    rc(size.x, size.y, aCornerRadius),
    rc(-size.x, size.y, aCornerRadius),
  ];

  if (aChamferCorners) {
    const shorterSide = Math.min(aSize.x, aSize.y);
    const chamfer = Math.max(0, KiROUND(aChamferRatio * shorterSide + chamferDeduct));
    const chamId = [
      RECT_CHAMFER_TOP_LEFT,
      RECT_CHAMFER_TOP_RIGHT,
      RECT_CHAMFER_BOTTOM_RIGHT,
      RECT_CHAMFER_BOTTOM_LEFT,
    ];
    const sign = [0, 1, -1, 0, 0, -1, 1, 0];

    for (let cc = 0, pos = 0; cc < 4; cc++, pos++) {
      if (!(aChamferCorners & chamId[cc]!)) continue;

      corners[pos]!.m_radius = 0;
      if (chamfer === 0) continue;

      const copy: RoundedCorner = {
        m_position: { ...corners[pos]!.m_position },
        m_radius: corners[pos]!.m_radius,
      };
      corners.splice(pos + 1, 0, copy);
      corners[pos]!.m_position.x += sign[(2 * cc) & 7]! * chamfer;
      corners[pos]!.m_position.y += sign[(2 * cc - 2) & 7]! * chamfer;
      corners[pos + 1]!.m_position.x += sign[(2 * cc + 1) & 7]! * chamfer;
      corners[pos + 1]!.m_position.y += sign[(2 * cc - 1) & 7]! * chamfer;
      pos++;
    }

    if (chamferCnt > 1 && 2 * chamfer >= shorterSide) cornerListRemoveDuplicates(corners);
  }

  const outline = cornerListToPolygon(corners, aInflate, aError, aErrorLoc);
  return placeOutline(outline, aRotation, aPosition);
}

/** `TransformRingToPolygon`: a fractured ring, or a disc when it has no hole. */
export function transformRingToPolygon(
  aCentre: VECTOR2I,
  aRadius: number,
  aWidth: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): VECTOR2I[][] {
  const inner_radius = aRadius - Math.trunc(aWidth / 2);
  const outer_radius = inner_radius + aWidth;

  if (inner_radius <= 0) {
    return [
      transformCircleToPolygonSet(aCentre, aRadius + Math.trunc(aWidth / 2), aError, aErrorLoc),
    ];
  }

  const outer = transformCircleToPolygonSet(aCentre, outer_radius, aError, aErrorLoc);
  const inner_err_loc =
    aErrorLoc === ErrorLoc.ERROR_OUTSIDE ? ErrorLoc.ERROR_INSIDE : ErrorLoc.ERROR_OUTSIDE;
  // `TransformCircleToPolygon( SHAPE_LINE_CHAIN& hole, … )`: no closing vertex.
  const hole = transformCircleToPolygon(aCentre, inner_radius, aError, inner_err_loc);
  return fractureSingle([outer, hole]);
}

// ---------------------------------------------------------------------------
// Arcs: `ARC_CHORD_PARAMS`, `ConvertArcToPolyline`, `TransformArcToPolygon`.

/**
 * `ARC_CHORD_PARAMS` (arc_chord_params.cpp): the circle an arc's polygon is
 * built on — and it is NOT the circle through the three points. The radius
 * comes from the chord and the SAGITTA, the mid point's distance from the
 * chord: `r = ( h² + s² ) / 2s`.
 */
interface ArcChordParams {
  radius: number;
  sagitta: number;
  halfChord: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  centerOffset: number;
  midx: number;
  midy: number;
}

function arcChordParams(aStart: VECTOR2I, aMid: VECTOR2I, aEnd: VECTOR2I): ArcChordParams | null {
  const dx = aEnd.x - aStart.x;
  const dy = aEnd.y - aStart.y;
  const chordLen = Math.sqrt(dx * dx + dy * dy);
  if (chordLen <= 0.0) return null;
  const mx = aMid.x - aStart.x;
  const my = aMid.y - aStart.y;
  const cross = mx * dy - my * dx;
  if (cross === 0.0) return null;
  const sagitta = Math.abs(cross) / chordLen;
  if (sagitta <= 0.0) return null;
  const halfChord = chordLen / 2.0;
  const radius = (halfChord * halfChord + sagitta * sagitta) / (2.0 * sagitta);
  if (radius <= 0.0) return null;
  const ux = dx / chordLen;
  const uy = dy / chordLen;
  let nx = -uy;
  let ny = ux;
  if (cross < 0.0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    radius,
    sagitta,
    halfChord,
    ux,
    uy,
    nx,
    ny,
    centerOffset: radius - sagitta,
    midx: (aStart.x + aEnd.x) * 0.5,
    midy: (aStart.y + aEnd.y) * 0.5,
  };
}

const chordStartAngle = (p: ArcChordParams): EDA_ANGLE => {
  const sin_half = p.halfChord / p.radius;
  const cos_half = p.centerOffset / p.radius;
  return EDA_ANGLE.fromVector({
    x: -sin_half * p.ux - cos_half * p.nx,
    y: -sin_half * p.uy - cos_half * p.ny,
  });
};
const chordEndAngle = (p: ArcChordParams): EDA_ANGLE => {
  const sin_half = p.halfChord / p.radius;
  const cos_half = p.centerOffset / p.radius;
  return EDA_ANGLE.fromVector({
    x: sin_half * p.ux - cos_half * p.nx,
    y: sin_half * p.uy - cos_half * p.ny,
  });
};
const chordArcAngle = (p: ArcChordParams): number => {
  const ratio = Math.min(1.0, Math.max(0.0, p.halfChord / p.radius));
  const base_angle = 2.0 * asin(ratio);
  if (p.sagitta > p.radius) return 2.0 * Math.PI - base_angle;
  return base_angle;
};

/** `SHAPE_LINE_CHAIN::Append( x, y )`: a point equal to the last is dropped. */
function chainAppend(chain: VECTOR2I[], x: number, y: number): void {
  const l = chain[chain.length - 1];
  if (!l || l.x !== x || l.y !== y) chain.push({ x, y });
}

/** `ConvertArcToPolyline( aPolyline, aStart, aMid, aEnd, aAccuracy, aErrorLoc, aRadialOffset )`. */
function convertArcToPolylineChord(
  aPolyline: VECTOR2I[],
  aStart: VECTOR2I,
  aMid: VECTOR2I,
  aEnd: VECTOR2I,
  aAccuracy: number,
  aErrorLoc: ErrorLoc,
  aRadialOffset: number,
): number {
  const params = arcChordParams(aStart, aMid, aEnd);
  if (!params) {
    chainAppend(aPolyline, aStart.x, aStart.y);
    if (aEnd.x !== aStart.x || aEnd.y !== aStart.y) chainAppend(aPolyline, aEnd.x, aEnd.y);
    return 0;
  }

  const arc_angle = chordArcAngle(params);
  if (arc_angle <= 0.0) {
    chainAppend(aPolyline, aStart.x, aStart.y);
    chainAppend(aPolyline, aEnd.x, aEnd.y);
    return 0;
  }

  const max_coord = 2147483647;
  const append_point = (aAlpha: number, aEffectiveRadius: number): boolean => {
    const u_offset = aEffectiveRadius * sin(aAlpha);
    const n_offset = params.centerOffset - aEffectiveRadius * cos(aAlpha);
    const x = params.midx + params.ux * u_offset + params.nx * n_offset;
    const y = params.midy + params.uy * u_offset + params.ny * n_offset;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > max_coord ||
      Math.abs(y) > max_coord
    ) {
      aPolyline.length = 0;
      chainAppend(aPolyline, aStart.x, aStart.y);
      chainAppend(aPolyline, aEnd.x, aEnd.y);
      return false;
    }
    chainAppend(aPolyline, KiROUND(x), KiROUND(y));
    return true;
  };

  const effective_radius = params.radius + aRadialOffset;
  const arc_angle_eda = new EDA_ANGLE(arc_angle, EDA_ANGLE_T.RADIANS_T);
  let n = 2;
  const radius_for_seg = KiROUND(Math.min(Math.abs(effective_radius), max_coord));
  if (radius_for_seg >= aAccuracy)
    n = getArcToSegmentCount(radius_for_seg, aAccuracy, arc_angle_eda.AsDegrees()) + 1;

  const half_angle = arc_angle / 2.0;
  const delta = arc_angle / n;

  if (aErrorLoc === ErrorLoc.ERROR_INSIDE) {
    for (let i = 0; i <= n; ++i)
      if (!append_point(-half_angle + delta * i, effective_radius)) return 0;
  } else {
    const seg360 = Math.abs(KiROUND((n * 360.0) / arc_angle_eda.AsDegrees()));
    if (seg360 <= 0) {
      for (let i = 0; i <= n; ++i)
        if (!append_point(-half_angle + delta * i, effective_radius)) return 0;
      return n;
    }
    const delta_radius = circleToEndSegmentDeltaRadius(radius_for_seg, seg360);
    const error_radius = effective_radius + delta_radius;
    if (!append_point(-half_angle, effective_radius)) return 0;
    for (let i = 0; i < n; ++i)
      if (!append_point(-half_angle + delta * (i + 0.5), error_radius)) return 0;
    if (!append_point(half_angle, effective_radius)) return 0;
  }
  return n;
}

/** `ConvertArcToPolyline( aPolyline, aCenter, aRadius, aStartAngle, aArcAngle, aAccuracy, aErrorLoc )`. */
function convertArcToPolylineCentre(
  aPolyline: VECTOR2I[],
  aCenter: VECTOR2I,
  aRadius: number,
  aStartAngle: EDA_ANGLE,
  aArcAngle: EDA_ANGLE,
  aAccuracy: number,
  aErrorLoc: ErrorLoc,
): number {
  let n = 2;
  if (aRadius >= aAccuracy) n = getArcToSegmentCount(aRadius, aAccuracy, aArcAngle.AsDegrees()) + 1;

  const delta = aArcAngle.AsDegrees() / n;

  if (aErrorLoc === ErrorLoc.ERROR_INSIDE) {
    let rot = aStartAngle.AsDegrees();
    for (let i = 0; i <= n; i++, rot += delta) {
      const r = new EDA_ANGLE(rot);
      const x = aCenter.x + aRadius * r.Cos();
      const y = aCenter.y + aRadius * r.Sin();
      chainAppend(aPolyline, KiROUND(x), KiROUND(y));
    }
  } else {
    const seg360 = Math.abs(KiROUND((n * 360.0) / aArcAngle.AsDegrees()));
    const actual_delta_radius = circleToEndSegmentDeltaRadius(aRadius, seg360);
    const errorRadius = aRadius + actual_delta_radius;

    let x = aCenter.x + aRadius * aStartAngle.Cos();
    let y = aCenter.y + aRadius * aStartAngle.Sin();
    chainAppend(aPolyline, KiROUND(x), KiROUND(y));

    let rot = aStartAngle.AsDegrees() + delta / 2;
    for (let i = 0; i < n; i++, rot += delta) {
      const r = new EDA_ANGLE(rot);
      x = aCenter.x + errorRadius * r.Cos();
      y = aCenter.y + errorRadius * r.Sin();
      chainAppend(aPolyline, KiROUND(x), KiROUND(y));
    }

    const endA = new EDA_ANGLE(aStartAngle.AsDegrees() + aArcAngle.AsDegrees());
    x = aCenter.x + aRadius * endA.Cos();
    y = aCenter.y + aRadius * endA.Sin();
    chainAppend(aPolyline, KiROUND(x), KiROUND(y));
  }
  return n;
}

/** `isqrt`: the exact integer square root (seg.cpp:61). */
function isqrt(x: bigint): bigint {
  if (x < 0n) return 3037000499n;
  let r = BigInt(Math.trunc(Math.sqrt(Number(x))));
  while (r < 3037000499n && r * r < x) r++;
  while (r > 3037000499n || r * r > x) r--;
  return r;
}

/** `SEG::Distance( const VECTOR2I& )`: `int( isqrt( SquaredDistance( aP ) ) )`. */
function segDistanceToPoint(a: VECTOR2I, b: VECTOR2I, p: VECTOR2I): number {
  const abx = BigInt(b.x) - BigInt(a.x);
  const aby = BigInt(b.y) - BigInt(a.y);
  const apx = BigInt(p.x) - BigInt(a.x);
  const apy = BigInt(p.y) - BigInt(a.y);
  const e = apx * abx + apy * aby;
  let sq: bigint;
  if (e <= 0n) sq = apx * apx + apy * apy;
  else {
    const f = abx * abx + aby * aby;
    if (e >= f) {
      const bpx = BigInt(p.x) - BigInt(b.x);
      const bpy = BigInt(p.y) - BigInt(b.y);
      sq = bpx * bpx + bpy * bpy;
    } else {
      const g = Number(apx * apx + apy * apy) - (Number(e) * Number(e)) / Number(f);
      if (g < 0 || g > 2 ** 63) sq = 0n;
      else sq = BigInt(KiROUND(g));
    }
  }
  return Number(isqrt(sq));
}

/**
 * `TransformArcToPolygon( aBuffer, aStart, aMid, aEnd, aWidth, aError,
 * aErrorLoc )`: a thick arc as ONE polygon — start cap, outer edge, end cap,
 * inner edge — on the chord circle; or an oval when the mid is within a unit
 * of the chord.
 */
export function transformArcToPolygon(
  aStart: VECTOR2I,
  aMid: VECTOR2I,
  aEnd: VECTOR2I,
  aWidth: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  const distanceToMid = segDistanceToPoint(aStart, aEnd, aMid);

  if (distanceToMid <= 1) {
    // Not an arc but essentially a straight line with a small error
    return transformOvalToPolygon(aStart, aEnd, aWidth + distanceToMid, aError, aErrorLoc);
  }

  // Determine arc direction using cross product. For consistent polygon
  // winding, ensure we always process a CCW arc by swapping endpoints if needed.
  const cross =
    BigInt(aMid.x - aStart.x) * BigInt(aEnd.y - aStart.y) -
    BigInt(aMid.y - aStart.y) * BigInt(aEnd.x - aStart.x);

  let p0 = aStart;
  let p1 = aEnd;
  if (cross < 0n) {
    p0 = aEnd;
    p1 = aStart;
  }

  const params = arcChordParams(p0, aMid, p1);
  if (!params) return transformOvalToPolygon(aStart, aEnd, aWidth, aError, aErrorLoc);

  const startAngle = chordStartAngle(params);
  const endAngle = chordEndAngle(params);

  const radial_offset = Math.trunc(aWidth / 2);
  const arc_inner_radius = params.radius - radial_offset;
  const errorLocInner =
    aErrorLoc === ErrorLoc.ERROR_INSIDE ? ErrorLoc.ERROR_OUTSIDE : ErrorLoc.ERROR_INSIDE;
  const errorLocOuter =
    aErrorLoc === ErrorLoc.ERROR_INSIDE ? ErrorLoc.ERROR_INSIDE : ErrorLoc.ERROR_OUTSIDE;

  const outline: VECTOR2I[] = [];
  const A180 = new EDA_ANGLE(180);

  // Starting end cap (semicircle at p0)
  convertArcToPolylineCentre(
    outline,
    p0,
    radial_offset,
    new EDA_ANGLE(startAngle.AsDegrees() - 180),
    A180,
    aError,
    aErrorLoc,
  );
  // Outside edge
  convertArcToPolylineChord(outline, p0, aMid, p1, aError, errorLocOuter, radial_offset);
  // Ending end cap (semicircle at p1)
  convertArcToPolylineCentre(outline, p1, radial_offset, endAngle, A180, aError, aErrorLoc);
  // Inside edge (reversed direction)
  if (arc_inner_radius > 0)
    convertArcToPolylineChord(outline, p1, aMid, p0, aError, errorLocInner, -radial_offset);

  return [[outline]];
}
