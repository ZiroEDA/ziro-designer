// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `POLY_CONTAINMENT_INDEX` (libs/kimath/include/geometry/poly_containment_index.h).
 * KiCad has no qa for it. Its header says the ray crossing "matches
 * SHAPE_LINE_CHAIN_BASE::PointInside() exactly, including the accuracy
 * semantics" - true of the crossing, not quite of the accuracy: PointInside's
 * edge test is `SEG::Distance( aPt ) <= aAccuracy + 1` (EdgeContainingPoint),
 * the index's `SquaredDistance( aPt ) <= Square( aAccuracy )`. So the crossing is
 * held to PointInside, and the edge fallback to the index's own rule.
 */
import { describe, expect, it } from 'vitest';
import { POLY_CONTAINMENT_INDEX } from '@ziroeda/kimath/src/geometry/poly_containment_index.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';

/** A fractured fill: a C shape, a slanted quad, and a far-off square. */
function fills(): SHAPE_POLY_SET {
  const set = new SHAPE_POLY_SET();
  const add = (pts: [number, number][]) =>
    set.AddOutline(
      new SHAPE_LINE_CHAIN(
        pts.map(([x, y]) => ({ x, y })),
        true,
      ),
    );

  add([
    [0, 0],
    [1000, 0],
    [1000, 300],
    [300, 300],
    [300, 700],
    [1000, 700],
    [1000, 1000],
    [0, 1000],
  ]);
  add([
    [1200, 100],
    [1900, 250],
    [1750, 900],
    [1150, 820],
  ]);
  add([
    [5000, 5000],
    [5100, 5000],
    [5100, 5100],
    [5000, 5100],
  ]);
  return set;
}

const pointInside = (aSet: SHAPE_POLY_SET, x: number, y: number, aAccuracy: number): boolean => {
  for (let i = 0; i < aSet.OutlineCount(); i++)
    if (aSet.Outline(i).PointInside({ x, y }, aAccuracy)) return true;

  return false;
};

const nearestEdgeSq = (aSet: SHAPE_POLY_SET, x: number, y: number): number => {
  let best = Number.POSITIVE_INFINITY;

  for (let i = 0; i < aSet.OutlineCount(); i++) {
    const chain = aSet.Outline(i);

    for (let j = 0; j < chain.SegmentCount(); j++)
      best = Math.min(best, chain.CSegment(j).SquaredDistance({ x, y }));
  }

  return best;
};

describe('POLY_CONTAINMENT_INDEX::Contains', () => {
  const set = fills();
  const index = new POLY_CONTAINMENT_INDEX();
  index.Build(set);

  for (const accuracy of [0, 1, 25]) {
    it(`agrees with PointInside on a 25-unit grid, accuracy ${accuracy}`, () => {
      let inside = 0;
      let disagree = 0;

      for (let x = -100; x <= 2000; x += 25)
        for (let y = -100; y <= 1100; y += 25) {
          const want =
            pointInside(set, x, y, 0) ||
            (accuracy > 1 && nearestEdgeSq(set, x, y) <= SEG.Square(accuracy));

          if (want) inside++;

          if (index.Contains({ x, y }, accuracy) !== want) disagree++;
        }

      expect(inside).toBeGreaterThan(500);
      expect(disagree).toBe(0);
    });
  }

  it('the slot of the C is outside; within the accuracy of its edge it is not', () => {
    expect(index.Contains({ x: 600, y: 500 })).toBe(false);
    expect(index.Contains({ x: 310, y: 500 }, 25)).toBe(true);
    expect(index.Contains({ x: 340, y: 500 }, 25)).toBe(false);
  });

  it('an accuracy of 1 skips the edge test', () => {
    expect(index.Contains({ x: 600, y: 301 }, 1)).toBe(false);
    expect(index.Contains({ x: 600, y: 301 }, 2)).toBe(true);
  });

  it("the edge test is the squared distance against the accuracy, without PointInside's +1", () => {
    // 26 above the C's lower bar: outside the index's 25, inside PointInside's 25 + 1.
    expect(index.Contains({ x: 600, y: 326 }, 25)).toBe(false);
    expect(set.Outline(0).PointInside({ x: 600, y: 326 }, 25)).toBe(true);
    expect(index.Contains({ x: 600, y: 325 }, 25)).toBe(true);
  });

  it('an empty set contains nothing', () => {
    const empty = new POLY_CONTAINMENT_INDEX();
    empty.Build(new SHAPE_POLY_SET());
    expect(empty.Contains({ x: 0, y: 0 }, 100)).toBe(false);
  });
});
