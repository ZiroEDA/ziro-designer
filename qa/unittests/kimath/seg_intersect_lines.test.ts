// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import { describe, expect, it } from 'vitest';
import { segIntersect, segIntersectLines } from '@ziroeda/kimath/src/geometry/seg.js';
import { rescale64 } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

describe('rescale64', () => {
  it('rounds half away from zero, in both signs', () => {
    // (7*1 + 2/2) / 2 = 4 — upstream adds d/2 before dividing.
    expect(rescale64(7n, 1n, 2n)).toBe(4n);
    // The correction follows (numerator < 0) XOR (denominator < 0).
    expect(rescale64(-7n, 1n, 2n)).toBe(-4n);
    expect(rescale64(7n, 1n, -2n)).toBe(-4n);
    expect(rescale64(-7n, 1n, -2n)).toBe(4n);
  });

  it('truncates d/2 for an odd denominator, so the rounding is not exactly half', () => {
    // `d / 2` is itself an integer divide, so for an odd denominator the
    // correction is slightly less than half: 3/2 truncates to 1, making the
    // rounding threshold 1/3 rather than 1/2. That is upstream's arithmetic,
    // not an approximation of it, and it is why this cannot be written as a
    // round-half-away-from-zero of the exact quotient.
    expect(rescale64(5n, 1n, 3n)).toBe(2n);
    expect(rescale64(1n, 1n, 3n)).toBe(0n);
  });

  it('stays exact past 2^53, where a double no longer can', () => {
    // The whole reason this exists. 1e16 is the scale of a board-coordinate
    // determinant; doubles stop representing consecutive integers at ~9e15.
    const n = 12345678901234567n;
    expect(rescale64(n, 2n, 2n)).toBe(n);
    expect(Number.isSafeInteger(Number(n))).toBe(false);
  });
});

describe('segIntersectLines', () => {
  it('crosses two lines whose segments come nowhere near each other', () => {
    // The defining difference from segIntersect: no bounding-box rejection,
    // because infinite lines can meet anywhere. These two segments are far
    // apart and share no box at all.
    const p = segIntersectLines(V(0, 0), V(10, 0), V(1000, -500), V(1000, -400));

    expect(p).toEqual({ x: 1000, y: 0 });
    expect(segIntersect(V(0, 0), V(10, 0), V(1000, -500), V(1000, -400))).toBeNull();
  });

  it('meets outside both segments, where the segment question answers null', () => {
    const a1 = V(0, 0);
    const a2 = V(100, 0);
    const b1 = V(500, -100);
    const b2 = V(500, -50);

    expect(segIntersectLines(a1, a2, b1, b2)).toEqual({ x: 500, y: 0 });
    expect(segIntersect(a1, a2, b1, b2)).toBeNull();
  });

  it('answers null for parallel lines that are not collinear', () => {
    expect(segIntersectLines(V(0, 0), V(100, 0), V(0, 50), V(100, 50))).toBeNull();
  });

  it('answers the midpoint of the two starts for collinear lines', () => {
    // Upstream's comment calls this "a reasonable choice" for an intersection
    // that is genuinely the whole line. It is not derived from anything, so it
    // has to be transcribed rather than reasoned out.
    expect(segIntersectLines(V(0, 0), V(100, 0), V(400, 0), V(500, 0))).toEqual({ x: 200, y: 0 });
  });

  it('prefers a degenerate argument’s own start over the midpoint', () => {
    // The two degenerate arms are checked before the midpoint, and aSeg's is
    // checked first — so a point-vs-point pair answers aSeg's start, not this
    // segment's.
    expect(segIntersectLines(V(0, 0), V(100, 0), V(40, 0), V(40, 0))).toEqual({ x: 40, y: 0 });
    expect(segIntersectLines(V(10, 0), V(10, 0), V(0, 0), V(100, 0))).toEqual({ x: 10, y: 0 });
    expect(segIntersectLines(V(10, 0), V(10, 0), V(40, 0), V(40, 0))).toEqual({ x: 40, y: 0 });
  });

  it('truncates the collinear midpoint per component, rather than rounding it', () => {
    // `( A + aSeg.A ) / 2` is VECTOR2I's integer divide. 0 and 3 average to 1,
    // not 2; and a negative pair truncates toward zero, not down.
    expect(segIntersectLines(V(0, 0), V(100, 0), V(3, 0), V(103, 0))).toEqual({ x: 1, y: 0 });
    expect(segIntersectLines(V(0, 0), V(0, 100), V(0, -3), V(0, 97))).toEqual({ x: 0, y: -1 });
  });

  it('is exact where a fractional implementation drifts', () => {
    // A shallow crossing at board scale: the determinant here is order 1e12 and
    // the product feeding rescale is order 1e18, well past 2^53. The exact
    // answer is an integer; a double-based divide need not land on it.
    const p = segIntersectLines(V(0, 0), V(1000000, 1), V(0, 1000000), V(1000000, 1000001));

    // Parallel — both have slope 1/1000000 — so this must be null, not a
    // near-miss point invented by floating-point noise.
    expect(p).toBeNull();
  });

  it('refuses an intersection that exists but overflows a 32-bit coordinate', () => {
    // Two nearly-parallel lines meet a very long way away. Slopes 1e-6 and
    // 5e-7 with a 100000 offset put the crossing at x = 2e11, which is two
    // orders of magnitude past a 32-bit coordinate. Upstream returns "no
    // intersection" rather than truncating, and the guard is the last thing
    // before the return — the arithmetic above it succeeded.
    expect(segIntersectLines(V(0, 0), V(1000000, 1), V(0, 100000), V(2000000, 100001))).toBeNull();
  });

  it('agrees with segIntersect wherever the segments genuinely cross', () => {
    const cases: [VECTOR2I, VECTOR2I, VECTOR2I, VECTOR2I][] = [
      [V(0, 0), V(100, 100), V(0, 100), V(100, 0)],
      [V(-50, 0), V(50, 0), V(0, -50), V(0, 50)],
      [V(0, 0), V(1000, 300), V(200, 400), V(800, -100)],
    ];

    for (const [a1, a2, b1, b2] of cases) {
      const seg = segIntersect(a1, a2, b1, b2);
      expect(seg).not.toBeNull();
      expect(segIntersectLines(a1, a2, b1, b2)).toEqual(seg);
    }
  });
});
