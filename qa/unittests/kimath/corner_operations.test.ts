// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fillet, chamfer and extend a corner.
 * Counterparts: `libs/kimath/src/geometry/corner_operations.cpp` and the
 * two-segment `SHAPE_ARC` constructor.
 *
 * A fillet is checked by the properties that define it rather than by
 * hand-computed coordinates: the arc must be tangent to both lines, its centre
 * at exactly the radius from each, and its ends must land *on* the segments.
 * That last one is the check that matters — an over-large radius produces a
 * perfectly valid arc whose tangent points lie beyond the ends of the lines,
 * which would silently lengthen them instead of rounding the corner.
 */
import { describe, expect, it } from 'vitest';
import {
  arcTangentToSegments,
  chamferLinePair,
  extendLinePair,
  filletLinePair,
  intersectLines,
  lineProject,
  otherEnd,
  segmentsIntersect,
  sharedEndpoint,
  type Seg,
} from '@ziroeda/kimath/src/geometry/corner_operations.js';

const seg = (ax: number, ay: number, bx: number, by: number): Seg => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

/**
 * Millimetres into internal units. The arc construction rounds its midpoint to
 * whole IU, so a fixture measured in raw IU — where a radius of 20 means twenty
 * *nanometres* — makes that rounding a 5% error and the tangency checks fail on
 * nothing. Real boards work in millions of IU, and there the same rounding is
 * invisible.
 */
const MM = (n: number): number => Math.round(n * 1e6);

const mmSeg = (ax: number, ay: number, bx: number, by: number): Seg =>
  seg(MM(ax), MM(ay), MM(bx), MM(by));

const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number =>
  Math.hypot(p.x - q.x, p.y - q.y);

/** The centre of the circle through three points — for checking an arc. */
const arcCentre = (
  s: { x: number; y: number },
  m: { x: number; y: number },
  e: { x: number; y: number },
): { x: number; y: number } => {
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
  const s2 = s.x * s.x + s.y * s.y;
  const m2 = m.x * m.x + m.y * m.y;
  const e2 = e.x * e.x + e.y * e.y;
  return {
    x: (s2 * (m.y - e.y) + m2 * (e.y - s.y) + e2 * (s.y - m.y)) / d,
    y: (s2 * (e.x - m.x) + m2 * (s.x - e.x) + e2 * (m.x - s.x)) / d,
  };
};

describe('segment helpers', () => {
  it('finds the shared corner', () => {
    expect(sharedEndpoint(seg(0, 0, 10, 0), seg(10, 0, 10, 10))).toEqual({ x: 10, y: 0 });
  });

  it('finds it whichever ends happen to touch', () => {
    // Lines are not drawn in a consistent direction, so all four pairings must
    // resolve.
    expect(sharedEndpoint(seg(10, 0, 0, 0), seg(10, 10, 10, 0))).toEqual({ x: 10, y: 0 });
    expect(sharedEndpoint(seg(0, 0, 10, 0), seg(0, 0, 0, 10))).toEqual({ x: 0, y: 0 });
  });

  it('reports none when the lines only cross', () => {
    // Crossing in the middle is not a corner.
    expect(sharedEndpoint(seg(0, 0, 10, 0), seg(5, -5, 5, 5))).toBeNull();
  });

  it('gives the other end', () => {
    expect(otherEnd(seg(0, 0, 10, 0), { x: 10, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(otherEnd(seg(0, 0, 10, 0), { x: 0, y: 0 })).toEqual({ x: 10, y: 0 });
  });

  it('intersects infinite lines that do not overlap as segments', () => {
    expect(intersectLines(seg(0, 0, 10, 0), seg(20, -5, 20, 5))).toEqual({ x: 20, y: 0 });
  });

  it('refuses to intersect parallel lines', () => {
    expect(intersectLines(seg(0, 0, 10, 0), seg(0, 5, 10, 5))).toBeNull();
  });

  it('tells crossing segments from merely crossing lines', () => {
    expect(segmentsIntersect(seg(0, 0, 10, 0), seg(5, -5, 5, 5))).toBe(true);
    expect(segmentsIntersect(seg(0, 0, 10, 0), seg(20, -5, 20, 5))).toBe(false);
  });

  it('projects onto the infinite line, not the segment', () => {
    // Beyond the end: LineProject does not clamp, which is what lets the fillet
    // centre sit outside the drawn extent.
    expect(lineProject(seg(0, 0, 10, 0), { x: 25, y: 7 })).toEqual({ x: 25, y: 0 });
  });
});

describe('the arc tangent to two segments', () => {
  it('is tangent to both, at the radius from each', () => {
    const a = mmSeg(0, 0, 100, 0);
    const b = mmSeg(100, 0, 100, 100);
    const arc = arcTangentToSegments(a, b, MM(20))!;
    const c = arcCentre(arc.start, arc.mid, arc.end);

    // Tangency: the centre is exactly the radius from each infinite line, and
    // the arc ends are the feet of those perpendiculars.
    expect(Math.abs(c.y - MM(20))).toBeLessThan(MM(0.001));
    expect(Math.abs(MM(100) - c.x - MM(20))).toBeLessThan(MM(0.001));
    expect(dist(arc.start, c) / MM(20)).toBeCloseTo(1, 5);
    expect(dist(arc.end, c) / MM(20)).toBeCloseTo(1, 5);
  });

  it('puts the midpoint on the arc, not on the chord', () => {
    const arc = arcTangentToSegments(mmSeg(0, 0, 100, 0), mmSeg(100, 0, 100, 100), MM(20))!;
    const c = arcCentre(arc.start, arc.mid, arc.end);

    expect(dist(arc.mid, c) / MM(20)).toBeCloseTo(1, 5);
  });

  it('bulges towards the corner it replaces, not away from it', () => {
    // Both rotation directions put the midpoint on the circle — one on the
    // near arc, one on the far side. Only the near one rounds the corner; the
    // other sweeps a three-quarter turn out into open space.
    const arc = arcTangentToSegments(mmSeg(0, 0, 100, 0), mmSeg(100, 0, 100, 100), MM(20))!;
    const oldCorner = { x: MM(100), y: 0 };
    const chordMid = {
      x: (arc.start.x + arc.end.x) / 2,
      y: (arc.start.y + arc.end.y) / 2,
    };

    expect(dist(arc.mid, oldCorner)).toBeLessThan(dist(chordMid, oldCorner));
  });

  it('scales with the radius', () => {
    const small = arcTangentToSegments(mmSeg(0, 0, 100, 0), mmSeg(100, 0, 100, 100), MM(10))!;
    const big = arcTangentToSegments(mmSeg(0, 0, 100, 0), mmSeg(100, 0, 100, 100), MM(40))!;

    // A bigger radius starts the curve further back along the first line.
    expect(small.start.x).toBeGreaterThan(big.start.x);
  });

  it('refuses parallel lines', () => {
    expect(arcTangentToSegments(mmSeg(0, 0, 10, 0), mmSeg(0, 5, 10, 5), MM(2))).toBeNull();
  });

  it('refuses a zero-length segment', () => {
    expect(arcTangentToSegments(mmSeg(5, 5, 5, 5), mmSeg(0, 0, 10, 0), MM(2))).toBeNull();
  });

  it('handles an acute corner as readily as a right angle', () => {
    const arc = arcTangentToSegments(mmSeg(0, 0, 100, 0), mmSeg(0, 0, 100, 100), MM(10))!;
    const c = arcCentre(arc.start, arc.mid, arc.end);

    expect(dist(arc.start, c) / MM(10)).toBeCloseTo(1, 5);
    expect(dist(arc.end, c) / MM(10)).toBeCloseTo(1, 5);
  });
});

describe('filleting a corner', () => {
  const corner = (): [Seg, Seg] => [mmSeg(0, 0, 100, 0), mmSeg(100, 0, 100, 100)];

  it('rounds a right angle and shortens both lines', () => {
    const [a, b] = corner();
    const r = filletLinePair(a, b, MM(20))!;

    expect(r.updatedA).not.toBeNull();
    expect(r.updatedB).not.toBeNull();
    // Each keeps its far end and now stops short of the old corner.
    expect(r.updatedA!.a).toEqual({ x: 0, y: 0 });
    expect(r.updatedA!.b.x).toBeLessThan(MM(100));
    expect(r.updatedB!.a).toEqual({ x: MM(100), y: MM(100) });
    expect(r.updatedB!.b.y).toBeGreaterThan(0);
  });

  it('joins the shortened lines to the arc without a gap', () => {
    const [a, b] = corner();
    const r = filletLinePair(a, b, MM(20))!;
    const ends = [r.updatedA!.b, r.updatedB!.b];

    // Whichever way round, each line now ends at one end of the arc.
    expect(ends).toContainEqual(r.arc.start);
    expect(ends).toContainEqual(r.arc.end);
  });

  it('refuses a radius too big for the corner', () => {
    // The tangent points would fall beyond the far ends, lengthening the lines
    // instead of rounding them — a valid arc and entirely the wrong answer.
    const [a, b] = corner();

    expect(filletLinePair(a, b, MM(500))).toBeNull();
  });

  it('refuses lines that do not share a corner', () => {
    expect(filletLinePair(mmSeg(0, 0, 100, 0), mmSeg(200, 50, 300, 50), MM(10))).toBeNull();
  });

  it('refuses lines that cross in the middle rather than meeting at a corner', () => {
    // These are not parallel, and a tangent arc of this radius would land
    // squarely on both — so only the shared-endpoint requirement rejects them.
    // A fixture of parallel lines cannot tell that requirement from the
    // geometry refusing anyway.
    expect(filletLinePair(mmSeg(0, 0, 100, 0), mmSeg(50, -50, 50, 50), MM(10))).toBeNull();
  });

  it('refuses collinear lines', () => {
    // They share an endpoint but form no corner.
    expect(filletLinePair(mmSeg(0, 0, 100, 0), mmSeg(100, 0, 200, 0), MM(10))).toBeNull();
  });

  it('refuses a zero-length line', () => {
    expect(filletLinePair(mmSeg(0, 0, 0, 0), mmSeg(0, 0, 100, 0), MM(10))).toBeNull();
  });
});

describe('chamfering a corner', () => {
  const corner = (): [Seg, Seg] => [seg(0, 0, 100, 0), seg(100, 0, 100, 100)];

  it('cuts the corner at the set-back along each line', () => {
    const [a, b] = corner();
    const r = chamferLinePair(a, b, 20, 30)!;

    // 20 back along the first line from (100,0), 30 back along the second.
    expect(r.chamfer.a).toEqual({ x: 80, y: 0 });
    expect(r.chamfer.b).toEqual({ x: 100, y: 30 });
  });

  it('takes different set-backs on each side', () => {
    const [a, b] = corner();
    const even = chamferLinePair(a, b, 20, 20)!;
    const uneven = chamferLinePair(a, b, 20, 40)!;

    expect(even.chamfer.b).not.toEqual(uneven.chamfer.b);
  });

  it('shortens both lines to meet the chamfer', () => {
    const [a, b] = corner();
    const r = chamferLinePair(a, b, 20, 30)!;

    expect(r.updatedA).toEqual({ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } });
    expect(r.updatedB).toEqual({ a: { x: 100, y: 100 }, b: { x: 100, y: 30 } });
  });

  it('consumes a line entirely when the set-back reaches its far end', () => {
    // Nothing is left of the first line, so it is dropped rather than kept as a
    // zero-length item.
    const [a, b] = corner();
    const r = chamferLinePair(a, b, 100, 30)!;

    expect(r.updatedA).toBeNull();
    expect(r.updatedB).not.toBeNull();
  });

  it('refuses a set-back longer than its line', () => {
    const [a, b] = corner();

    expect(chamferLinePair(a, b, 200, 30)).toBeNull();
  });

  it('refuses two zero set-backs', () => {
    const [a, b] = corner();

    expect(chamferLinePair(a, b, 0, 0)).toBeNull();
  });

  it('allows a zero set-back on one side', () => {
    // Odd but well-defined: it adds a collinear point. Upstream spells the
    // refusal with an && precisely so this stays legal.
    const [a, b] = corner();

    expect(chamferLinePair(a, b, 0, 30)).not.toBeNull();
  });

  it('refuses lines that do not share a corner', () => {
    expect(chamferLinePair(seg(0, 0, 100, 0), seg(200, 50, 300, 50), 10, 10)).toBeNull();
  });
});

describe('extending two lines to meet', () => {
  it('grows both to the crossing point', () => {
    const r = extendLinePair(seg(0, 0, 50, 0), seg(100, 20, 100, 80))!;

    // The infinite lines meet at (100, 0).
    expect(r.updatedA).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(r.updatedB).toEqual({ a: { x: 100, y: 80 }, b: { x: 100, y: 0 } });
  });

  it('keeps the end further from the meeting point', () => {
    // Which is what makes running it twice a no-op rather than a wobble.
    const first = extendLinePair(seg(0, 0, 50, 0), seg(100, 20, 100, 80))!;
    const again = extendLinePair(first.updatedA!, first.updatedB!);

    expect(again).toBeNull();
  });

  it('leaves lines that already cross alone', () => {
    expect(extendLinePair(seg(0, 0, 100, 0), seg(50, -5, 50, 5))).toBeNull();
  });

  it('refuses parallel lines, which never meet', () => {
    expect(extendLinePair(seg(0, 0, 50, 0), seg(0, 20, 50, 20))).toBeNull();
  });

  it('extends only the line that needs it', () => {
    // The second already reaches the meeting point, so only the first moves.
    const r = extendLinePair(seg(0, 0, 50, 0), seg(100, 0, 100, 80))!;

    expect(r.updatedA).not.toBeNull();
    expect(r.updatedB).toBeNull();
  });

  it('refuses a zero-length line', () => {
    expect(extendLinePair(seg(5, 5, 5, 5), seg(100, 20, 100, 80))).toBeNull();
  });
});
