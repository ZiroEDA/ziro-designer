// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/kimath/src/geometry/vector_utils.cpp` and `vector_utils.h`: the
 * direction and projection tests, and the grid rounding (`KIGEOM::RoundGrid`,
 * `RoundNW`, `RoundSE`). The C++ templates divide ints, which truncates toward
 * zero; `Math.trunc` is that division.
 */
import type { Vec2 as VECTOR2I } from '../math/vector2.js';
import type { SEG } from './seg.js';

/** `KIGEOM::PointIsInDirection`: `( aPoint - aFrom ).Dot( aDirection ) > 0`. */
export function KIGEOM_PointIsInDirection(
  aPoint: VECTOR2I,
  aDirection: VECTOR2I,
  aFrom: VECTOR2I,
): boolean {
  return (aPoint.x - aFrom.x) * aDirection.x + (aPoint.y - aFrom.y) * aDirection.y > 0;
}

/** `KIGEOM::PointsAreInSameDirection`. */
export function KIGEOM_PointsAreInSameDirection(
  aPointA: VECTOR2I,
  aPointB: VECTOR2I,
  aFrom: VECTOR2I,
): boolean {
  return KIGEOM_PointIsInDirection(
    aPointB,
    { x: aPointA.x - aFrom.x, y: aPointA.y - aFrom.y },
    aFrom,
  );
}

/** `KIGEOM::SegIsInDirection`. */
export function KIGEOM_SegIsInDirection(aSeg: SEG, aDirection: VECTOR2I): boolean {
  return KIGEOM_PointIsInDirection(aSeg.B, aDirection, aSeg.A);
}

/**
 * `KIGEOM::PointProjectsOntoSegment`: SEG::NearestPoint returns an end point
 * when the projection falls outside the segment.
 */
export function KIGEOM_PointProjectsOntoSegment(aPoint: VECTOR2I, aSeg: SEG): boolean {
  const projected = aSeg.NearestPoint(aPoint);
  return (
    !(projected.x === aSeg.A.x && projected.y === aSeg.A.y) &&
    !(projected.x === aSeg.B.x && projected.y === aSeg.B.y)
  );
}

/** `KIGEOM::GetLengthRatioFromStart`. */
export function KIGEOM_GetLengthRatioFromStart(aPoint: VECTOR2I, aSeg: SEG): number {
  const length = aSeg.Length();
  const projectedLength = Math.hypot(aPoint.x - aSeg.A.x, aPoint.y - aSeg.A.y);
  return projectedLength / length;
}

/** `KIGEOM::GetProjectedPointLengthRatio`. */
export function KIGEOM_GetProjectedPointLengthRatio(aPoint: VECTOR2I, aSeg: SEG): number {
  const projected = aSeg.NearestPoint(aPoint);

  if (projected.x === aSeg.A.x && projected.y === aSeg.A.y) return 0.0;
  if (projected.x === aSeg.B.x && projected.y === aSeg.B.y) return 1.0;

  return KIGEOM_GetLengthRatioFromStart(projected, aSeg);
}

/** `KIGEOM::GetNearestEndpoint`: the start on a tie. */
export function KIGEOM_GetNearestEndpoint(aSeg: SEG, aPoint: VECTOR2I): VECTOR2I {
  const distToCBStart = Math.hypot(aSeg.A.x - aPoint.x, aSeg.A.y - aPoint.y);
  const distToCBEnd = Math.hypot(aSeg.B.x - aPoint.x, aSeg.B.y - aPoint.y);
  return distToCBStart <= distToCBEnd ? aSeg.A : aSeg.B;
}

const idiv = (a: number, b: number): number => Math.trunc(a / b);

function RoundNearest(x: number, g: number): number {
  return idiv(x + (x < 0 ? -idiv(g, 2) : idiv(g, 2)), g) * g;
}

function RoundDown(x: number, g: number): number {
  return idiv(x < 0 ? x - g + 1 : x, g) * g;
}

function RoundUp(x: number, g: number): number {
  return idiv(x < 0 ? x : x + g - 1, g) * g;
}

/** Round a vector to the nearest grid point in any direction. */
export function KIGEOM_RoundGrid(aVec: VECTOR2I, aGridSize: number): VECTOR2I {
  return { x: RoundNearest(aVec.x, aGridSize), y: RoundNearest(aVec.y, aGridSize) };
}

/** Round a vector to the nearest grid point in the NW direction (towards -x, -y). */
export function KIGEOM_RoundNW(aVec: VECTOR2I, aGridSize: number): VECTOR2I {
  return { x: RoundDown(aVec.x, aGridSize), y: RoundDown(aVec.y, aGridSize) };
}

/** Round a vector to the nearest grid point in the SE direction (towards +x, +y). */
export function KIGEOM_RoundSE(aVec: VECTOR2I, aGridSize: number): VECTOR2I {
  return { x: RoundUp(aVec.x, aGridSize), y: RoundUp(aVec.y, aGridSize) };
}
