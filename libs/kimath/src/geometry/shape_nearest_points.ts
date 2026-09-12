// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `src/geometry/shape_nearest_points.cpp`: `SHAPE::NearestPoints( const SHAPE* )`,
 * the pairwise nearest-point table over every shape type.
 */

import { ECOORD_MAX, EuclideanNormI, ResizeI, type VECTOR2I } from '../math/vector2.js';
import { SEG } from './seg.js';
import { SHAPE, SHAPE_HOOKS, SHAPE_LINE_CHAIN_BASE, SHAPE_TYPE } from './shape.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_CIRCLE } from './shape_circle.js';
import { SHAPE_COMPOUND } from './shape_compound.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import { SHAPE_POLY_SET } from './shape_poly_set.js';
import { SHAPE_RECT } from './shape_rect.js';
import { SHAPE_SEGMENT } from './shape_segment.js';

const setPt = (dst: VECTOR2I, src: VECTOR2I): void => {
  dst.x = src.x;
  dst.y = src.y;
};
const sqDist = (a: VECTOR2I, b: VECTOR2I): number =>
  (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
const samePoint = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

function npCircleCircle(
  aA: SHAPE_CIRCLE,
  aB: SHAPE_CIRCLE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const delta = { x: aB.GetCenter().x - aA.GetCenter().x, y: aB.GetCenter().y - aA.GetCenter().y };
  const dist = EuclideanNormI(delta);

  if (dist === 0) {
    // Circles are concentric - pick arbitrary points
    setPt(aPtA, { x: aA.GetCenter().x + aA.GetRadius(), y: aA.GetCenter().y });
    setPt(aPtB, { x: aB.GetCenter().x + aB.GetRadius(), y: aB.GetCenter().y });
  } else {
    // Points lie on line between centers
    const ra = ResizeI(delta, aA.GetRadius());
    const rb = ResizeI(delta, aB.GetRadius());
    setPt(aPtA, { x: aA.GetCenter().x + ra.x, y: aA.GetCenter().y + ra.y });
    setPt(aPtB, { x: aB.GetCenter().x - rb.x, y: aB.GetCenter().y - rb.y });
  }

  return true;
}

function npCircleRect(
  aCircle: SHAPE_CIRCLE,
  aRect: SHAPE_RECT,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const c = aCircle.GetCenter();
  const p0 = aRect.GetPosition();
  const size = aRect.GetSize();

  // Clamp circle center to rectangle bounds to find nearest point on rect
  aPtB.x = Math.max(p0.x, Math.min(c.x, p0.x + size.x));
  aPtB.y = Math.max(p0.y, Math.min(c.y, p0.y + size.y));

  // Find nearest point on circle
  if (samePoint(aPtB, c)) {
    // Center is inside rectangle - find nearest edge
    const distToLeft = c.x - p0.x;
    const distToRight = p0.x + size.x - c.x;
    const distToTop = c.y - p0.y;
    const distToBottom = p0.y + size.y - c.y;

    const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

    if (minDist === distToLeft) {
      setPt(aPtB, { x: p0.x, y: c.y });
      setPt(aPtA, { x: c.x - aCircle.GetRadius(), y: c.y });
    } else if (minDist === distToRight) {
      setPt(aPtB, { x: p0.x + size.x, y: c.y });
      setPt(aPtA, { x: c.x + aCircle.GetRadius(), y: c.y });
    } else if (minDist === distToTop) {
      setPt(aPtB, { x: c.x, y: p0.y });
      setPt(aPtA, { x: c.x, y: c.y - aCircle.GetRadius() });
    } else {
      setPt(aPtB, { x: c.x, y: p0.y + size.y });
      setPt(aPtA, { x: c.x, y: c.y + aCircle.GetRadius() });
    }
  } else {
    const dir = ResizeI({ x: aPtB.x - c.x, y: aPtB.y - c.y }, aCircle.GetRadius());
    setPt(aPtA, { x: c.x + dir.x, y: c.y + dir.y });
  }

  return true;
}

function npCircleSeg(aCircle: SHAPE_CIRCLE, aSeg: SEG, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  setPt(aPtB, aSeg.NearestPoint(aCircle.GetCenter()));

  if (samePoint(aPtB, aCircle.GetCenter())) {
    // Center is on segment - pick perpendicular direction
    const perp = { x: -(aSeg.B.y - aSeg.A.y), y: aSeg.B.x - aSeg.A.x };
    const dir = ResizeI(perp, aCircle.GetRadius());
    setPt(aPtA, { x: aCircle.GetCenter().x + dir.x, y: aCircle.GetCenter().y + dir.y });
  } else {
    const dir = ResizeI(
      { x: aPtB.x - aCircle.GetCenter().x, y: aPtB.y - aCircle.GetCenter().y },
      aCircle.GetRadius(),
    );
    setPt(aPtA, { x: aCircle.GetCenter().x + dir.x, y: aCircle.GetCenter().y + dir.y });
  }

  return true;
}

function npCircleChainBase(
  aCircle: SHAPE_CIRCLE,
  aChain: SHAPE_LINE_CHAIN_BASE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const chain = aChain instanceof SHAPE_LINE_CHAIN ? aChain : null;
  let minDistSq = ECOORD_MAX;

  for (let i = 0; i < aChain.GetSegmentCount(); i++) {
    if (chain && chain.IsArcSegment(i)) continue;

    const ptA: VECTOR2I = { x: 0, y: 0 };
    const ptB: VECTOR2I = { x: 0, y: 0 };

    if (npCircleSeg(aCircle, aChain.GetSegment(i), ptA, ptB)) {
      const distSq = sqDist(ptA, ptB);

      if (distSq < minDistSq) {
        minDistSq = distSq;
        setPt(aPtA, ptA);
        setPt(aPtB, ptB);
      }
    }
  }

  // Also handle arcs if this is a SHAPE_LINE_CHAIN
  if (chain) {
    for (let j = 0; j < chain.ArcCount(); j++) {
      const arc = chain.Arc(j);
      const ptA: VECTOR2I = { x: 0, y: 0 };
      const ptB: VECTOR2I = { x: 0, y: 0 };
      const distSq = { value: 0 };

      // Reverse the output points to match the arc_from_chain/circle order
      if (arc.NearestPoints(aCircle, ptB, ptA, distSq)) {
        if (distSq.value < minDistSq) {
          minDistSq = distSq.value;
          setPt(aPtA, ptA);
          setPt(aPtB, ptB);
        }
      }
    }
  }

  return minDistSq < ECOORD_MAX;
}

function npRectRect(aA: SHAPE_RECT, aB: SHAPE_RECT, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  // Convert rectangles to line chains and use that algorithm
  const outlineA = aA.Outline();
  const outlineB = aB.Outline();

  return npChainBaseChainBase(outlineA, outlineB, aPtA, aPtB);
}

function npRectSeg(aRect: SHAPE_RECT, aSeg: SEG, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  const outline = aRect.Outline();

  // Reverse the output points to match the seg/rect_outline order
  return npSegChainBase(aSeg, outline, aPtB, aPtA);
}

function npRectChainBase(
  aRect: SHAPE_RECT,
  aChain: SHAPE_LINE_CHAIN_BASE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const outline = aRect.Outline();

  return npChainBaseChainBase(outline, aChain, aPtA, aPtB);
}

function npSegSeg(aA: SEG, aB: SEG, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  setPt(aPtA, aA.NearestPoint(aB));
  setPt(aPtB, aB.NearestPoint(aPtA));
  return true;
}

function npSegChainBase(
  aSeg: SEG,
  aChain: SHAPE_LINE_CHAIN_BASE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const chain = aChain instanceof SHAPE_LINE_CHAIN ? aChain : null;
  let minDistSq = ECOORD_MAX;

  for (let i = 0; i < aChain.GetSegmentCount(); i++) {
    if (chain && chain.IsArcSegment(i)) continue;

    const ptA: VECTOR2I = { x: 0, y: 0 };
    const ptB: VECTOR2I = { x: 0, y: 0 };

    if (npSegSeg(aSeg, aChain.GetSegment(i), ptA, ptB)) {
      const distSq = sqDist(ptA, ptB);

      if (distSq < minDistSq) {
        minDistSq = distSq;
        setPt(aPtA, ptA);
        setPt(aPtB, ptB);
      }
    }
  }

  // Also handle arcs if this is a SHAPE_LINE_CHAIN
  if (chain) {
    for (let j = 0; j < chain.ArcCount(); j++) {
      const arc = chain.Arc(j);
      const ptA: VECTOR2I = { x: 0, y: 0 };
      const ptB: VECTOR2I = { x: 0, y: 0 };
      const distSq = { value: 0 };

      // Reverse the output points to match the arc_from_chain/seg order
      if (arc.NearestPoints(aSeg, ptB, ptA, distSq)) {
        if (distSq.value < minDistSq) {
          minDistSq = distSq.value;
          setPt(aPtA, ptA);
          setPt(aPtB, ptB);
        }
      }
    }
  }

  return minDistSq < ECOORD_MAX;
}

function npChainBaseChainBase(
  aA: SHAPE_LINE_CHAIN_BASE,
  aB: SHAPE_LINE_CHAIN_BASE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const chainA = aA instanceof SHAPE_LINE_CHAIN ? aA : null;
  const chainB = aB instanceof SHAPE_LINE_CHAIN ? aB : null;
  let minDistSq = ECOORD_MAX;

  // Check all segment pairs
  for (let i = 0; i < aA.GetSegmentCount(); i++) {
    if (chainA && chainA.IsArcSegment(i)) continue;

    for (let j = 0; j < aB.GetSegmentCount(); j++) {
      if (chainB && chainB.IsArcSegment(j)) continue;

      const ptA: VECTOR2I = { x: 0, y: 0 };
      const ptB: VECTOR2I = { x: 0, y: 0 };

      if (npSegSeg(aA.GetSegment(i), aB.GetSegment(j), ptA, ptB)) {
        const distSq = sqDist(ptA, ptB);

        if (distSq < minDistSq) {
          minDistSq = distSq;
          setPt(aPtA, ptA);
          setPt(aPtB, ptB);
        }
      }
    }
  }

  // Also handle arcs if this is a SHAPE_LINE_CHAIN
  if (chainA) {
    for (let i = 0; i < chainA.ArcCount(); i++) {
      const arcA = chainA.Arc(i);

      if (chainB) {
        // Arc to arc
        for (let j = 0; j < chainB.ArcCount(); j++) {
          const ptA: VECTOR2I = { x: 0, y: 0 };
          const ptB: VECTOR2I = { x: 0, y: 0 };
          const distSq = { value: 0 };

          if (arcA.NearestPoints(chainB.Arc(j), ptA, ptB, distSq)) {
            if (distSq.value < minDistSq) {
              minDistSq = distSq.value;
              setPt(aPtA, ptA);
              setPt(aPtB, ptB);
            }
          }
        }
      }

      // Arc to segments
      for (let j = 0; j < aB.GetSegmentCount(); j++) {
        const ptA: VECTOR2I = { x: 0, y: 0 };
        const ptB: VECTOR2I = { x: 0, y: 0 };
        const distSq = { value: 0 };

        if (arcA.NearestPoints(aB.GetSegment(j), ptA, ptB, distSq)) {
          if (distSq.value < minDistSq) {
            minDistSq = distSq.value;
            setPt(aPtA, ptA);
            setPt(aPtB, ptB);
          }
        }
      }
    }
  }

  if (chainB && !chainA) {
    // Handle arcs in chainB vs segments in aA
    for (let j = 0; j < chainB.ArcCount(); j++) {
      const arcB = chainB.Arc(j);

      for (let i = 0; i < aA.GetSegmentCount(); i++) {
        const ptA: VECTOR2I = { x: 0, y: 0 };
        const ptB: VECTOR2I = { x: 0, y: 0 };
        const distSq = { value: 0 };

        if (arcB.NearestPoints(aA.GetSegment(i), ptB, ptA, distSq)) {
          if (distSq.value < minDistSq) {
            minDistSq = distSq.value;
            setPt(aPtA, ptA);
            setPt(aPtB, ptB);
          }
        }
      }
    }
  }

  return minDistSq < ECOORD_MAX;
}

function npArcCircle(
  aArc: SHAPE_ARC,
  aCircle: SHAPE_CIRCLE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const distSq = { value: 0 };
  return aArc.NearestPoints(aCircle, aPtA, aPtB, distSq);
}

function npArcRect(aArc: SHAPE_ARC, aRect: SHAPE_RECT, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  const distSq = { value: 0 };
  return aArc.NearestPoints(aRect, aPtA, aPtB, distSq);
}

function npArcSegment(
  aArc: SHAPE_ARC,
  aSeg: SHAPE_SEGMENT,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const distSq = { value: 0 };
  const retVal = aArc.NearestPoints(aSeg.GetSeg(), aPtA, aPtB, distSq);

  // Adjust point B by half the seg width towards point A
  const dir = ResizeI({ x: aPtA.x - aPtB.x, y: aPtA.y - aPtB.y }, Math.trunc(aSeg.GetWidth() / 2));
  aPtB.x += dir.x;
  aPtB.y += dir.y;

  return retVal;
}

function npArcArc(aArcA: SHAPE_ARC, aArcB: SHAPE_ARC, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  const distSq = { value: 0 };
  return aArcA.NearestPoints(aArcB, aPtA, aPtB, distSq);
}

function npArcChainBase(
  aArc: SHAPE_ARC,
  aChain: SHAPE_LINE_CHAIN_BASE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  const chain = aChain instanceof SHAPE_LINE_CHAIN ? aChain : null;
  const distSq = { value: 0 };
  let minDistSq = ECOORD_MAX;
  const tmp_ptA: VECTOR2I = { x: 0, y: 0 };
  const tmp_ptB: VECTOR2I = { x: 0, y: 0 };

  for (let i = 0; i < aChain.GetSegmentCount(); i++) {
    if (chain && chain.IsArcSegment(i)) continue;

    if (aArc.NearestPoints(aChain.GetSegment(i), tmp_ptA, tmp_ptB, distSq)) {
      if (distSq.value < minDistSq) {
        setPt(aPtA, tmp_ptA);
        setPt(aPtB, tmp_ptB);
        minDistSq = distSq.value;
      }
    }
  }

  // Also handle arcs if this is a SHAPE_LINE_CHAIN
  if (chain) {
    for (let j = 0; j < chain.ArcCount(); j++) {
      const arc = chain.Arc(j);

      if (aArc.NearestPoints(arc, tmp_ptA, tmp_ptB, distSq)) {
        if (distSq.value < minDistSq) {
          minDistSq = distSq.value;
          setPt(aPtA, tmp_ptA);
          setPt(aPtB, tmp_ptB);
        }
      }
    }
  }

  return true;
}

function npSegmentCircle(
  aSeg: SHAPE_SEGMENT,
  aCircle: SHAPE_CIRCLE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  if (npCircleSeg(aCircle, aSeg.GetSeg(), aPtB, aPtA)) {
    // Adjust point A by half the segment width towards point B
    const dir = ResizeI(
      { x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y },
      Math.trunc(aSeg.GetWidth() / 2),
    );
    aPtA.x += dir.x;
    aPtA.y += dir.y;
    return true;
  }

  return false;
}

function npSegmentRect(
  aSeg: SHAPE_SEGMENT,
  aRect: SHAPE_RECT,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  if (npRectSeg(aRect, aSeg.GetSeg(), aPtB, aPtA)) {
    // Adjust point A by half the segment width towards point B
    const dir = ResizeI(
      { x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y },
      Math.trunc(aSeg.GetWidth() / 2),
    );
    aPtA.x += dir.x;
    aPtA.y += dir.y;
    return true;
  }

  return false;
}

function npSegmentSegment(
  aSegA: SHAPE_SEGMENT,
  aSegB: SHAPE_SEGMENT,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  // Find nearest points between two segments
  if (npSegSeg(aSegA.GetSeg(), aSegB.GetSeg(), aPtA, aPtB)) {
    // Adjust point A by half the segment width towards point B
    let dir = ResizeI({ x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y }, Math.trunc(aSegA.GetWidth() / 2));
    aPtA.x += dir.x;
    aPtA.y += dir.y;

    // Adjust point B by half the segment width towards point A
    dir = ResizeI({ x: aPtA.x - aPtB.x, y: aPtA.y - aPtB.y }, Math.trunc(aSegB.GetWidth() / 2));
    aPtB.x += dir.x;
    aPtB.y += dir.y;
    return true;
  }

  return false;
}

function npSegmentChainBase(
  aSeg: SHAPE_SEGMENT,
  aChain: SHAPE_LINE_CHAIN_BASE,
  aPtA: VECTOR2I,
  aPtB: VECTOR2I,
): boolean {
  if (npSegChainBase(aSeg.GetSeg(), aChain, aPtA, aPtB)) {
    // Adjust point A by half the segment width towards point B
    const dir = ResizeI(
      { x: aPtB.x - aPtA.x, y: aPtB.y - aPtA.y },
      Math.trunc(aSeg.GetWidth() / 2),
    );
    aPtA.x += dir.x;
    aPtA.y += dir.y;
    return true;
  }

  return false;
}

type NpFn<A, B> = (a: A, b: B, aPtA: VECTOR2I, aPtB: VECTOR2I) => boolean;

/** `NearestPointsCaseReversed`: the operands and the output points swapped. */
function reversed<A, B>(fn: NpFn<B, A>, aA: A, aB: B, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  return fn(aB, aA, aPtB, aPtA);
}

function nearestPointsSingleShapes(aA: SHAPE, aB: SHAPE, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  const T = SHAPE_TYPE;

  switch (aA.Type()) {
    case T.SH_RECT:
      switch (aB.Type()) {
        case T.SH_RECT:
          return npRectRect(aA as SHAPE_RECT, aB as SHAPE_RECT, aPtA, aPtB);
        case T.SH_CIRCLE:
          return reversed(npCircleRect, aA as SHAPE_RECT, aB as SHAPE_CIRCLE, aPtA, aPtB);
        case T.SH_LINE_CHAIN:
          return npRectChainBase(aA as SHAPE_RECT, aB as SHAPE_LINE_CHAIN, aPtA, aPtB);
        case T.SH_SEGMENT:
          return reversed(npSegmentRect, aA as SHAPE_RECT, aB as SHAPE_SEGMENT, aPtA, aPtB);
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return npRectChainBase(aA as SHAPE_RECT, aB as SHAPE_LINE_CHAIN_BASE, aPtA, aPtB);
        case T.SH_ARC:
          return reversed(npArcRect, aA as SHAPE_RECT, aB as SHAPE_ARC, aPtA, aPtB);
        default:
          break;
      }
      break;

    case T.SH_CIRCLE:
      switch (aB.Type()) {
        case T.SH_RECT:
          return npCircleRect(aA as SHAPE_CIRCLE, aB as SHAPE_RECT, aPtA, aPtB);
        case T.SH_CIRCLE:
          return npCircleCircle(aA as SHAPE_CIRCLE, aB as SHAPE_CIRCLE, aPtA, aPtB);
        case T.SH_LINE_CHAIN:
          return npCircleChainBase(aA as SHAPE_CIRCLE, aB as SHAPE_LINE_CHAIN, aPtA, aPtB);
        case T.SH_SEGMENT:
          return reversed(npSegmentCircle, aA as SHAPE_CIRCLE, aB as SHAPE_SEGMENT, aPtA, aPtB);
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return npCircleChainBase(aA as SHAPE_CIRCLE, aB as SHAPE_LINE_CHAIN_BASE, aPtA, aPtB);
        case T.SH_ARC:
          return reversed(npArcCircle, aA as SHAPE_CIRCLE, aB as SHAPE_ARC, aPtA, aPtB);
        default:
          break;
      }
      break;

    case T.SH_LINE_CHAIN:
      switch (aB.Type()) {
        case T.SH_RECT:
          return reversed(npRectChainBase, aA as SHAPE_LINE_CHAIN, aB as SHAPE_RECT, aPtA, aPtB);
        case T.SH_CIRCLE:
          return reversed(
            npCircleChainBase,
            aA as SHAPE_LINE_CHAIN,
            aB as SHAPE_CIRCLE,
            aPtA,
            aPtB,
          );
        case T.SH_LINE_CHAIN:
          return npChainBaseChainBase(aA as SHAPE_LINE_CHAIN, aB as SHAPE_LINE_CHAIN, aPtA, aPtB);
        case T.SH_SEGMENT:
          return reversed(
            npSegmentChainBase,
            aA as SHAPE_LINE_CHAIN,
            aB as SHAPE_SEGMENT,
            aPtA,
            aPtB,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return npChainBaseChainBase(
            aA as SHAPE_LINE_CHAIN,
            aB as SHAPE_LINE_CHAIN_BASE,
            aPtA,
            aPtB,
          );
        case T.SH_ARC: {
          // Special handling for arc
          const chain = aA as SHAPE_LINE_CHAIN;
          const arc = aB as SHAPE_ARC;
          let minDistSq = ECOORD_MAX;

          // Check segments
          for (let i = 0; i < chain.SegmentCount(); i++) {
            const ptA: VECTOR2I = { x: 0, y: 0 };
            const ptB: VECTOR2I = { x: 0, y: 0 };
            const distSq = { value: 0 };

            // Reverse the output points to match the arc/segment_from_rect order
            if (arc.NearestPoints(chain.CSegment(i), ptB, ptA, distSq)) {
              if (distSq.value < minDistSq) {
                minDistSq = distSq.value;
                setPt(aPtA, ptA);
                setPt(aPtB, ptB);
              }
            }
          }

          // Check arcs
          for (let i = 0; i < chain.ArcCount(); i++) {
            const ptA: VECTOR2I = { x: 0, y: 0 };
            const ptB: VECTOR2I = { x: 0, y: 0 };
            const distSq = { value: 0 };

            if (chain.Arc(i).NearestPoints(arc, ptA, ptB, distSq)) {
              if (distSq.value < minDistSq) {
                minDistSq = distSq.value;
                setPt(aPtA, ptA);
                setPt(aPtB, ptB);
              }
            }
          }

          return minDistSq < ECOORD_MAX;
        }
        default:
          break;
      }
      break;

    case T.SH_SEGMENT:
      switch (aB.Type()) {
        case T.SH_RECT:
          return npSegmentRect(aA as SHAPE_SEGMENT, aB as SHAPE_RECT, aPtA, aPtB);
        case T.SH_CIRCLE:
          return npSegmentCircle(aA as SHAPE_SEGMENT, aB as SHAPE_CIRCLE, aPtA, aPtB);
        case T.SH_LINE_CHAIN:
          return npSegmentChainBase(aA as SHAPE_SEGMENT, aB as SHAPE_LINE_CHAIN, aPtA, aPtB);
        case T.SH_SEGMENT:
          return npSegmentSegment(aA as SHAPE_SEGMENT, aB as SHAPE_SEGMENT, aPtA, aPtB);
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return npSegmentChainBase(aA as SHAPE_SEGMENT, aB as SHAPE_LINE_CHAIN_BASE, aPtA, aPtB);
        case T.SH_ARC:
          return reversed(npArcSegment, aA as SHAPE_SEGMENT, aB as SHAPE_ARC, aPtA, aPtB);
        default:
          break;
      }
      break;

    case T.SH_SIMPLE:
    case T.SH_POLY_SET_TRIANGLE:
      switch (aB.Type()) {
        case T.SH_RECT:
          return reversed(
            npRectChainBase,
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_RECT,
            aPtA,
            aPtB,
          );
        case T.SH_CIRCLE:
          return reversed(
            npCircleChainBase,
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_CIRCLE,
            aPtA,
            aPtB,
          );
        case T.SH_LINE_CHAIN:
          return reversed(
            npChainBaseChainBase,
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_LINE_CHAIN,
            aPtA,
            aPtB,
          );
        case T.SH_SEGMENT:
          return reversed(
            npSegmentChainBase,
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_SEGMENT,
            aPtA,
            aPtB,
          );
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return npChainBaseChainBase(
            aA as SHAPE_LINE_CHAIN_BASE,
            aB as SHAPE_LINE_CHAIN_BASE,
            aPtA,
            aPtB,
          );
        case T.SH_ARC: {
          // Handle arc specially
          const chain = aA as SHAPE_LINE_CHAIN_BASE;
          const arc = aB as SHAPE_ARC;
          let minDistSq = ECOORD_MAX;

          for (let i = 0; i < chain.GetSegmentCount(); i++) {
            const ptA: VECTOR2I = { x: 0, y: 0 };
            const ptB: VECTOR2I = { x: 0, y: 0 };
            const distSq = { value: 0 };

            // Reverse the output points to match the arc/segment_from_line_chain order
            if (arc.NearestPoints(chain.GetSegment(i), ptB, ptA, distSq)) {
              if (distSq.value < minDistSq) {
                minDistSq = distSq.value;
                setPt(aPtA, ptA);
                setPt(aPtB, ptB);
              }
            }
          }

          return minDistSq < ECOORD_MAX;
        }
        default:
          break;
      }
      break;

    case T.SH_ARC:
      switch (aB.Type()) {
        case T.SH_RECT:
          return npArcRect(aA as SHAPE_ARC, aB as SHAPE_RECT, aPtA, aPtB);
        case T.SH_CIRCLE:
          return npArcCircle(aA as SHAPE_ARC, aB as SHAPE_CIRCLE, aPtA, aPtB);
        case T.SH_LINE_CHAIN:
          return npArcChainBase(aA as SHAPE_ARC, aB as SHAPE_LINE_CHAIN, aPtA, aPtB);
        case T.SH_SEGMENT:
          return npArcSegment(aA as SHAPE_ARC, aB as SHAPE_SEGMENT, aPtA, aPtB);
        case T.SH_SIMPLE:
        case T.SH_POLY_SET_TRIANGLE:
          return npArcChainBase(aA as SHAPE_ARC, aB as SHAPE_LINE_CHAIN_BASE, aPtA, aPtB);
        case T.SH_ARC:
          return npArcArc(aA as SHAPE_ARC, aB as SHAPE_ARC, aPtA, aPtB);
        default:
          break;
      }
      break;

    case T.SH_POLY_SET: {
      // For polygon sets, find nearest points to all edges
      const polySet = aA as SHAPE_POLY_SET;
      let minDistSq = ECOORD_MAX;

      for (const s of polySet.CIterateSegmentsWithHoles()) {
        const seg = new SHAPE_SEGMENT(s);
        const ptA: VECTOR2I = { x: 0, y: 0 };
        const ptB: VECTOR2I = { x: 0, y: 0 };

        if (nearestPointsSingleShapes(seg, aB, ptA, ptB)) {
          const distSq = sqDist(ptA, ptB);

          if (distSq < minDistSq) {
            minDistSq = distSq;
            setPt(aPtA, ptA);
            setPt(aPtB, ptB);
          }
        }
      }

      return minDistSq < ECOORD_MAX;
    }

    default:
      break;
  }

  // Handle SHAPE_POLY_SET as second shape
  if (aB.Type() === T.SH_POLY_SET) {
    const polySet = aB as SHAPE_POLY_SET;
    let minDistSq = ECOORD_MAX;

    for (const s of polySet.CIterateSegments()) {
      const seg = new SHAPE_SEGMENT(s);
      const ptA: VECTOR2I = { x: 0, y: 0 };
      const ptB: VECTOR2I = { x: 0, y: 0 };

      if (nearestPointsSingleShapes(aA, seg, ptA, ptB)) {
        const distSq = sqDist(ptA, ptB);

        if (distSq < minDistSq) {
          minDistSq = distSq;
          setPt(aPtA, ptA);
          setPt(aPtB, ptB);
        }
      }
    }

    return minDistSq < ECOORD_MAX;
  }

  return false;
}

/** `nearestPoints`: the compound walk over `nearestPointsSingleShapes`. */
export function nearestPointsShapes(aA: SHAPE, aB: SHAPE, aPtA: VECTOR2I, aPtB: VECTOR2I): boolean {
  let minDistSq = ECOORD_MAX;
  let found = false;

  const checkNearestPoints = (shapeA: SHAPE, shapeB: SHAPE): boolean => {
    const ptA: VECTOR2I = { x: 0, y: 0 };
    const ptB: VECTOR2I = { x: 0, y: 0 };

    if (nearestPointsSingleShapes(shapeA, shapeB, ptA, ptB)) {
      const distSq = sqDist(ptA, ptB);

      if (distSq < minDistSq) {
        minDistSq = distSq;
        setPt(aPtA, ptA);
        setPt(aPtB, ptB);
        found = true;
      }

      return true;
    }

    return false;
  };

  if (aA.Type() === SHAPE_TYPE.SH_COMPOUND && aB.Type() === SHAPE_TYPE.SH_COMPOUND) {
    const cmpA = aA as SHAPE_COMPOUND;
    const cmpB = aB as SHAPE_COMPOUND;

    for (const elemA of cmpA.Shapes()) {
      for (const elemB of cmpB.Shapes()) {
        checkNearestPoints(elemA, elemB);
      }
    }
  } else if (aA.Type() === SHAPE_TYPE.SH_COMPOUND) {
    const cmpA = aA as SHAPE_COMPOUND;

    for (const elemA of cmpA.Shapes()) {
      checkNearestPoints(elemA, aB);
    }
  } else if (aB.Type() === SHAPE_TYPE.SH_COMPOUND) {
    const cmpB = aB as SHAPE_COMPOUND;

    for (const elemB of cmpB.Shapes()) {
      checkNearestPoints(aA, elemB);
    }
  } else {
    return nearestPointsSingleShapes(aA, aB, aPtA, aPtB);
  }

  return found;
}

SHAPE_HOOKS.nearestPointsShapes = nearestPointsShapes;
