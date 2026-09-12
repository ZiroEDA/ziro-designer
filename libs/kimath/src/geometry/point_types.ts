// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `geometry/point_types.h`: meanings that can be assigned to a point in pure
 * geometric terms.
 */

import type { VECTOR2I } from '../math/vector2.js';

/**
 * Meanings that can be assigned to a point in pure geometric
 * terms.
 *
 * For example, a circle has a center point and four quadrant points.
 *
 * These can be combined using bitwise OR if a point has multiple meanings.
 */
export enum POINT_TYPE {
  /** No specific point type. */
  PT_NONE = 0,
  /** The point is the center of something. */
  PT_CENTER = 1 << 0,
  /** The point is at the end of a segment, arc, etc. */
  PT_END = 1 << 1,
  /** The point is at the middle of a segment, arc, etc. */
  PT_MID = 1 << 2,
  /** The point is on a quadrant of a circle (N, E, S, W points). */
  PT_QUADRANT = 1 << 3,
  /**
   * The point is a corner of a polygon, rectangle, etc
   * (you may want to infer PT_END from this)
   */
  PT_CORNER = 1 << 4,
  /** The point is an intersection of two (or more) items. */
  PT_INTERSECTION = 1 << 5,
  /**
   * The point is somewhere on another element, but not some specific point.
   * (you can infer this from some other point types)
   */
  PT_ON_ELEMENT = 1 << 6,
}

export const {
  PT_NONE,
  PT_CENTER,
  PT_END,
  PT_MID,
  PT_QUADRANT,
  PT_CORNER,
  PT_INTERSECTION,
  PT_ON_ELEMENT,
} = POINT_TYPE;

export class TYPED_POINT2I {
  m_point: VECTOR2I;
  // Bitwise OR of POINT_TYPE values
  m_types: number;

  constructor(aVec: VECTOR2I, aTypes: number) {
    this.m_point = { x: aVec.x, y: aVec.y };
    this.m_types = aTypes;
  }

  /** `operator==`. */
  equals(o: TYPED_POINT2I): boolean {
    return (
      this.m_point.x === o.m_point.x && this.m_point.y === o.m_point.y && this.m_types === o.m_types
    );
  }
}
