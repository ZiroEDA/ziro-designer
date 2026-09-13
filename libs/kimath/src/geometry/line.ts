// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `geometry/line.h` / `src/geometry/line.cpp`: `LINE`, an infinite line
 * represented by a segment it passes through.
 */

import { rescale64 } from '../math/util.js';
import type { VECTOR2I } from '../math/vector2.js';
import { type OPT_VECTOR2I, SEG } from './seg.js';

export class LINE {
  /// Internally, we can represent a just a segment that the line passes through
  private m_seg: SEG;

  constructor(aSeg: SEG);
  constructor(aStart: VECTOR2I, aEnd: VECTOR2I);
  constructor(a: SEG | VECTOR2I, b?: VECTOR2I) {
    this.m_seg = a instanceof SEG ? a : new SEG(a, b!);
  }

  equals(aOther: LINE): boolean {
    return this.m_seg.equals(aOther.m_seg);
  }

  /**
   * Gets the (one of the infinite number of) segments that the line passes through.
   */
  GetContainedSeg(): SEG {
    return this.m_seg;
  }

  Intersect(aOther: SEG): OPT_VECTOR2I;
  Intersect(aOther: LINE): OPT_VECTOR2I;
  Intersect(a: SEG | LINE): OPT_VECTOR2I {
    if (a instanceof LINE) {
      // Defer to the SEG implementation
      return a.m_seg.Intersect(this.m_seg, false, true);
    }

    const intersection = a.Intersect(this.m_seg, false, true);

    if (intersection) {
      // Not parallel.
      // That was two lines, but we need to check if the intersection is on
      // the requested segment
      if (a.Contains(intersection)) return intersection;
    }

    return undefined;
  }

  Distance(aPoint: VECTOR2I): number {
    // Just defer to the SEG implementation
    return this.m_seg.LineDistance(aPoint);
  }

  NearestPoint(aPoint: VECTOR2I): VECTOR2I {
    // Same as the SEG implementation, but without the early return
    // if the point isn't on the segment.
    // Inlined for performance reasons
    const dx = BigInt(this.m_seg.B.x - this.m_seg.A.x);
    const dy = BigInt(this.m_seg.B.y - this.m_seg.A.y);
    const l_squared = dx * dx + dy * dy;

    if (l_squared === 0n) return this.m_seg.A;

    const t = dx * BigInt(aPoint.x - this.m_seg.A.x) + dy * BigInt(aPoint.y - this.m_seg.A.y);

    const xp = rescale64(t, dx, l_squared);
    const yp = rescale64(t, dy, l_squared);

    return { x: Number(BigInt(this.m_seg.A.x) + xp), y: Number(BigInt(this.m_seg.A.y) + yp) };
  }
}
