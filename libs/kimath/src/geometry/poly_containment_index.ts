// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/kimath/include/geometry/poly_containment_index.h`: a spatial index
 * for point-in-polygon containment testing.
 *
 * `SHAPE_LINE_CHAIN::PointInside()` is O(V) per query, ray-casting against
 * every edge. This builds an R-tree of polygon edges so a query is
 * O(log V + K), K being the edges the horizontal ray actually crosses. The
 * ray-crossing matches `SHAPE_LINE_CHAIN_BASE::PointInside()` exactly. Its
 * `aAccuracy > 1` edge fallback is close but not the same: `SquaredDistance
 * <= Square( aAccuracy )` here, `Distance <= aAccuracy + 1` there.
 */
import { RTree } from '../thirdparty/rtree.js';
import { rescaleInt } from './shape.js';
import type { VECTOR2I } from '../math/vector2.js';
import { SEG } from './seg.js';
import type { SHAPE_POLY_SET } from './shape_poly_set.js';

/** `INT_MAX`. */
const INT_MAX = 2147483647;

interface EDGE {
  p1: VECTOR2I;
  p2: VECTOR2I;
  outlineIdx: number;
}

export class POLY_CONTAINMENT_INDEX {
  private m_segments: EDGE[] = [];
  /** `RTree<intptr_t, int, 2, double> m_tree`. */
  private m_tree = new RTree<number>(2);
  private m_outlineCount = 0;

  /**
   * Build the spatial index from a SHAPE_POLY_SET's outlines. Only outlines
   * are indexed, not holes (zone fills are fractured and have no holes).
   */
  Build(aPolySet: SHAPE_POLY_SET): void {
    this.m_outlineCount = aPolySet.OutlineCount();

    for (let outlineIdx = 0; outlineIdx < this.m_outlineCount; outlineIdx++) {
      const outline = aPolySet.COutline(outlineIdx);
      const ptCount = outline.PointCount();

      if (ptCount < 3) continue;

      for (let j = 0; j < ptCount; j++) {
        const p1 = outline.CPoint(j);
        const p2 = outline.CPoint((j + 1) % ptCount);

        const idx = this.m_segments.length;
        this.m_segments.push({ p1, p2, outlineIdx });

        this.m_tree.Insert(
          [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y)],
          [Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)],
          idx,
        );
      }
    }
  }

  /**
   * Whether `aPt` is inside any outline or, when `aAccuracy > 1`, within
   * `aAccuracy` of any edge. Values <= 1 skip the edge test.
   */
  Contains(aPt: VECTOR2I, aAccuracy = 0): boolean {
    if (this.m_segments.length === 0) return false;

    const crossings = new Int32Array(this.m_outlineCount);

    // Only segments whose X extent reaches past aPt.x can produce a rightward ray crossing.
    this.m_tree.Search([aPt.x, aPt.y], [INT_MAX, aPt.y], (idx) => {
      const seg = this.m_segments[idx]!;
      const p1 = seg.p1;
      const p2 = seg.p2;

      if (p1.y >= aPt.y === p2.y >= aPt.y) return true;

      const d = rescaleInt(p2.x - p1.x, aPt.y - p1.y, p2.y - p1.y);

      if (aPt.x - p1.x < d) crossings[seg.outlineIdx]!++;

      return true;
    });

    for (let i = 0; i < this.m_outlineCount; i++) {
      if (crossings[i]! & 1) return true;
    }

    if (aAccuracy > 1) {
      const accuracySq = SEG.Square(aAccuracy);
      let onEdge = false;

      this.m_tree.Search(
        [aPt.x - aAccuracy, aPt.y - aAccuracy],
        [aPt.x + aAccuracy, aPt.y + aAccuracy],
        (idx) => {
          const seg = this.m_segments[idx]!;
          const s = new SEG(seg.p1, seg.p2);

          if (s.SquaredDistance(aPt) <= accuracySq) {
            onEdge = true;
            return false;
          }

          return true;
        },
      );

      return onEdge;
    }

    return false;
  }
}
