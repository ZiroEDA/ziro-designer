// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `geometry/half_line.h` / `src/geometry/half_line.cpp`: `HALF_LINE`, a ray
 * — a straight line that starts at a point and goes on in one direction.
 */

import { rescale64 } from '../math/util.js';
import type { VECTOR2I } from '../math/vector2.js';
import { type OPT_VECTOR2I, SEG } from './seg.js';

/**
 * Check if two vectors point into the same quadrant.
 */
function VectorsInSameQuadrant(aA: VECTOR2I, aB: VECTOR2I): boolean {
  // The sign of the x and y components of the vectors must be the same
  return aA.x >= 0 === aB.x >= 0 && aA.y >= 0 === aB.y >= 0;
}

export class HALF_LINE {
  /// Internally, we can represent a just a segment that the ray passes through
  private m_seg: SEG;

  constructor(aSeg: SEG);
  constructor(aStart: VECTOR2I, aOtherContainedPoint: VECTOR2I);
  constructor(a: SEG | VECTOR2I, b?: VECTOR2I) {
    this.m_seg = a instanceof SEG ? a : new SEG(a, b!);
  }

  /**
   * Get the start point of the ray.
   */
  GetStart(): VECTOR2I {
    return this.m_seg.A;
  }

  /**
   * Get one (of the infinite number) of points that the ray passes through.
   */
  GetContainedPoint(): VECTOR2I {
    return this.m_seg.B;
  }

  Contains(aPoint: VECTOR2I): boolean {
    // Check that the point is on the right side of the ray from
    // the start point
    // This is quick, so we can do it first
    if (
      !VectorsInSameQuadrant(
        { x: this.m_seg.B.x - this.m_seg.A.x, y: this.m_seg.B.y - this.m_seg.A.y },
        { x: aPoint.x - this.m_seg.A.x, y: aPoint.y - this.m_seg.A.y },
      )
    ) {
      return false;
    }

    // Check that the point is within a distance of 1 from the
    // infinite line of the ray
    return this.m_seg.LineDistance(aPoint) <= 1;
  }

  Intersect(aSeg: SEG): OPT_VECTOR2I;
  Intersect(aOther: HALF_LINE): OPT_VECTOR2I;
  Intersect(a: SEG | HALF_LINE): OPT_VECTOR2I {
    if (a instanceof HALF_LINE) {
      // Intsersection of two infinite lines
      const otherSeg = a.GetContainedSeg();
      const intersection = this.m_seg.Intersect(otherSeg, false, true);

      // Reject parallel lines
      if (!intersection) return undefined;

      // Check that the intersection is on the right side of both
      // rays' start points (i.e. equal quadrants)
      if (
        !VectorsInSameQuadrant(
          { x: this.m_seg.B.x - this.m_seg.A.x, y: this.m_seg.B.y - this.m_seg.A.y },
          { x: intersection.x - this.m_seg.A.x, y: intersection.y - this.m_seg.A.y },
        ) ||
        !VectorsInSameQuadrant(
          { x: a.m_seg.B.x - a.m_seg.A.x, y: a.m_seg.B.y - a.m_seg.A.y },
          { x: intersection.x - a.m_seg.A.x, y: intersection.y - a.m_seg.A.y },
        )
      ) {
        return undefined;
      }

      return intersection;
    }

    // Intsersection of two infinite lines
    const seg = this.GetContainedSeg();
    const intersection = a.Intersect(seg, false, true);

    // Reject parallel lines
    if (!intersection) return undefined;

    // Check that the intersection is on the right side of the
    // ray's start point (i.e. equal quadrants)
    if (
      !VectorsInSameQuadrant(
        { x: this.m_seg.B.x - this.m_seg.A.x, y: this.m_seg.B.y - this.m_seg.A.y },
        { x: intersection.x - this.m_seg.A.x, y: intersection.y - this.m_seg.A.y },
      )
    ) {
      return undefined;
    }

    // Check that the intersection is not somewhere past the end
    // of the segment
    if (!a.Contains(intersection)) return undefined;

    return intersection;
  }

  /**
   * Get the nearest point on the ray to the given point.
   */
  NearestPoint(aPoint: VECTOR2I): VECTOR2I {
    // Same as the SEG implementation, but without the early return
    // if the point isn't on the segment.
    // Inlined for performance reasons
    const dx = BigInt(this.m_seg.B.x - this.m_seg.A.x);
    const dy = BigInt(this.m_seg.B.y - this.m_seg.A.y);
    const l_squared = dx * dx + dy * dy;

    if (l_squared === 0n) return this.m_seg.A;

    const t = dx * BigInt(aPoint.x - this.m_seg.A.x) + dy * BigInt(aPoint.y - this.m_seg.A.y);

    if (t < 0n) return this.m_seg.A;

    const xp = rescale64(t, dx, l_squared);
    const yp = rescale64(t, dy, l_squared);

    return { x: Number(BigInt(this.m_seg.A.x) + xp), y: Number(BigInt(this.m_seg.A.y) + yp) };
  }

  equals(aOther: HALF_LINE): boolean {
    return this.m_seg.equals(aOther.m_seg);
  }

  /**
   * Get a segment that the ray passes through (`m_seg`, the start and the contained point).
   */
  GetContainedSeg(): SEG {
    return this.m_seg;
  }
}
