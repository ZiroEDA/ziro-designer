// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_POLY_SET`'s boolean ops and the offset, over Clipper.
 *
 * Three things upstream guarantees that a JavaScript port has to be told:
 *
 * - the fill rule is `FillRule::NonZero` (shape_poly_set.cpp:859), not even-odd
 * - the result is `VECTOR2I`, so every corner is a whole internal unit
 * - `importTree` reads Clipper's own outline/hole hierarchy instead of working
 *   the nesting out again from containment
 */
import { describe, expect, it } from 'vitest';
import {
  booleanAdd,
  booleanOp,
  BooleanOp,
  booleanSubtract,
  CornerStrategy,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A one-polygon set, which is what every entry point here takes. */
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon[] => [
  [
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  ],
];

/** The same rectangle wound the other way round. */
const reversed = (ps: Polygon[]): Polygon[] =>
  ps.map((poly) => poly.map((ring) => [...ring].reverse()));

const ringArea = (ring: Vec2[]): number => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return Math.abs(a / 2);
};

/** Outline area less its holes, over the whole set. */
const netArea = (polys: Polygon[]): number =>
  polys.reduce(
    (s, poly) => s + poly.reduce((t, ring, i) => t + (i === 0 ? 1 : -1) * ringArea(ring), 0),
    0,
  );

describe('the fill rule', () => {
  it('unions two overlapping clip shapes rather than cancelling them', () => {
    // Under even-odd the overlap of two clip paths reads as OUTSIDE and comes
    // back as subject. `booleanOp` declares NonZero, so subtracting the pair
    // takes away their union.
    const subject = rect(0, 0, 100, 100);
    const clips = [...rect(20, 20, 60, 60), ...rect(40, 40, 80, 80)];
    const out = booleanOp(subject, clips, BooleanOp.SUBTRACT);

    // The union of the two 40 x 40 squares overlapping on a 20 x 20 corner.
    expect(netArea(out)).toBeCloseTo(100 * 100 - (1600 + 1600 - 400), 6);
  });

  it('does not care which way round a caller wound its rings', () => {
    // The non-zero rule counts windings, so two overlapping clip paths only
    // union when they turn the same way. A caller building its own rings — a
    // knockout circle, a stadium along a pad edge — has no such convention, so
    // `booleanOp` orients them: outline one way, holes the other.
    const subject = rect(0, 0, 100, 100);
    const same = [...rect(20, 20, 60, 60), ...rect(40, 40, 80, 80)];
    const mixed = [...rect(20, 20, 60, 60), ...reversed(rect(40, 40, 80, 80))];

    expect(netArea(booleanOp(subject, same, BooleanOp.SUBTRACT))).toBeCloseTo(
      netArea(booleanOp(subject, mixed, BooleanOp.SUBTRACT)),
      6,
    );
  });
});

describe('the result is VECTOR2I', () => {
  const integral = (polys: Polygon[]): boolean =>
    polys
      .flatMap((poly) => poly.flat())
      .every((p) => Number.isInteger(p.x) && Number.isInteger(p.y));

  it('has whole-unit corners even after an offset', () => {
    const out = inflate(rect(0, 0, 1000, 1000), 137, CornerStrategy.ROUND_ALL_CORNERS, 16);
    expect(out.flatMap((poly) => poly.flat()).length).toBeGreaterThan(4);
    expect(integral(out)).toBe(true);
  });

  it("rounds a caller's fractional corners rather than passing them on", () => {
    // Clipper rounds the crossings IT computes, but a vertex handed to it comes
    // back untouched — so fractional input propagates through a chain of
    // operations. `SHAPE_POLY_SET` cannot: it is `VECTOR2I`, and a later
    // boolean between two shapes that very nearly coincide fails outright
    // ("Unable to find segment … in SweepLine tree") rather than answering
    // wrongly. That is how a zone came to throw part-way through a pour.
    const skew: Polygon[] = [
      [
        [
          { x: 0.5, y: 0.25 },
          { x: 700.5, y: 0.25 },
          { x: 700.5, y: 1000.75 },
          { x: 0.5, y: 1000.75 },
        ],
      ],
    ];
    const out = booleanOp(skew, rect(300, 300, 400, 400), BooleanOp.SUBTRACT);
    expect(out.length).toBeGreaterThan(0);
    expect(integral(out)).toBe(true);
  });
});

describe('importTree', () => {
  it('keeps a hole as a hole of its own outline', () => {
    const out = booleanSubtract(rect(0, 0, 100, 100), rect(20, 20, 80, 80));
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2); // outline plus one hole
    expect(netArea(out)).toBeCloseTo(100 * 100 - 60 * 60, 6);
  });

  it('makes an island inside a hole a polygon of its own', () => {
    // Clipper nests these three deep; a flat list rebuilt by containment gets
    // the same answer only by counting the nesting depth, and the PolyTree
    // says it outright.
    const ring = booleanSubtract(rect(0, 0, 100, 100), rect(20, 20, 80, 80));
    const withIsland = booleanAdd(ring, rect(40, 40, 60, 60));

    expect(withIsland).toHaveLength(2);
    expect(netArea(withIsland)).toBeCloseTo(100 * 100 - 60 * 60 + 20 * 20, 6);

    // The island is its own outline, not a ring hanging off the frame.
    const island = withIsland.find((p) => ringArea(p[0]!) === 20 * 20);
    expect(island).toBeDefined();
    expect(island).toHaveLength(1);
  });

  it('drops nothing when a subtraction leaves several separate pieces', () => {
    const out = booleanSubtract(rect(0, 0, 100, 20), rect(40, -10, 60, 30));
    expect(out).toHaveLength(2);
    expect(netArea(out)).toBeCloseTo(40 * 20 * 2, 6);
  });
});
