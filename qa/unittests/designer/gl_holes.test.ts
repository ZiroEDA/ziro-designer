// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Filled areas with holes in them, for the board's WebGL renderer.
 *
 * `drawBoard` fills zones, pads and vias with `nonzero` winding, and a copper
 * pour's clearances and thermal reliefs arrive as rings wound against the
 * outline. Ear-clipping each ring alone fills them solid — a ground plane
 * swallowing its own clearances.
 *
 * These assert by **coverage and area** rather than by comparing triangle lists.
 * A triangulation has no unique right answer, so pinning exact output would fail
 * on any harmless change of strategy while saying nothing about correctness. Is
 * a point inside the ring covered, is a point in the hole not, and does the
 * total area match — those hold for any correct triangulation and fail for
 * every incorrect one.
 */
import { describe, expect, it } from 'vitest';
import { triangulateRings } from '@ziroeda/designer/src/render/gl/holes.js';
import type { Pt } from '@ziroeda/designer/src/render/gl/tessellate.js';

const ring = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Same ring wound the other way, which is how a hole is emitted. */
const reversed = (r: Pt[]): Pt[] => [...r].reverse();

const covers = (tris: Pt[], p: Pt): boolean => {
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const [a, b, c] = [tris[i]!, tris[i + 1]!, tris[i + 2]!];
    const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
    const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
};

const area = (tris: Pt[]): number => {
  let s = 0;
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const [a, b, c] = [tris[i]!, tris[i + 1]!, tris[i + 2]!];
    s += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }
  return s;
};

describe('triangulateRings', () => {
  it('leaves a hole empty', () => {
    // 100x100 outline with a 20x20 hole at its centre.
    const tris = triangulateRings([ring(0, 0, 100, 100), reversed(ring(40, 40, 20, 20))]);

    expect(covers(tris, { x: 50, y: 50 })).toBe(false); // dead centre of the hole
    expect(covers(tris, { x: 41, y: 41 })).toBe(false); // just inside the hole
    expect(covers(tris, { x: 10, y: 10 })).toBe(true); // solid copper
    expect(covers(tris, { x: 95, y: 50 })).toBe(true);
    expect(covers(tris, { x: 150, y: 50 })).toBe(false); // outside entirely

    // 10000 minus 400. The regression is this coming back as 10000.
    expect(area(tris)).toBeCloseTo(9600, 6);
  });

  it('handles several holes in one outline', () => {
    const tris = triangulateRings([
      ring(0, 0, 100, 100),
      reversed(ring(10, 10, 10, 10)),
      reversed(ring(70, 70, 10, 10)),
      reversed(ring(70, 10, 10, 10)),
    ]);
    expect(area(tris)).toBeCloseTo(10000 - 300, 6);
    for (const p of [
      { x: 15, y: 15 },
      { x: 75, y: 75 },
      { x: 75, y: 15 },
    ]) {
      expect(covers(tris, p)).toBe(false);
    }
    expect(covers(tris, { x: 50, y: 50 })).toBe(true);
  });

  it('keeps disjoint islands separate, each with its own holes', () => {
    // Two pours that do not touch; a hole belongs to the one containing it.
    const tris = triangulateRings([
      ring(0, 0, 50, 50),
      reversed(ring(10, 10, 10, 10)),
      ring(100, 0, 50, 50),
      reversed(ring(110, 10, 10, 10)),
    ]);
    expect(area(tris)).toBeCloseTo(2 * (2500 - 100), 6);
    expect(covers(tris, { x: 15, y: 15 })).toBe(false);
    expect(covers(tris, { x: 115, y: 15 })).toBe(false);
    expect(covers(tris, { x: 5, y: 5 })).toBe(true);
    expect(covers(tris, { x: 105, y: 5 })).toBe(true);
    expect(covers(tris, { x: 75, y: 25 })).toBe(false); // the gap between them
  });

  it('fills an island sitting inside a hole', () => {
    // A plane split around a connector: copper, a void, and copper again. Depth
    // 2 is solid, not a hole — getting this wrong erases the inner island.
    const tris = triangulateRings([
      ring(0, 0, 100, 100),
      reversed(ring(20, 20, 60, 60)),
      ring(40, 40, 20, 20),
    ]);
    expect(covers(tris, { x: 50, y: 50 })).toBe(true); // the island
    expect(covers(tris, { x: 25, y: 25 })).toBe(false); // the void around it
    expect(covers(tris, { x: 5, y: 5 })).toBe(true); // the outer pour
    expect(area(tris)).toBeCloseTo(10000 - 3600 + 400, 6);
  });

  it('handles a pour perforated like a real ground plane', () => {
    // The case that sank the hand-rolled bridging: it got one and three holes
    // right and returned 40,496 units of area here, where 9,100 is correct.
    const rings: Pt[][] = [ring(0, 0, 100, 100)];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        rings.push(reversed(ring(10 + i * 18, 10 + j * 18, 6, 6)));
      }
    }
    const tris = triangulateRings(rings);
    expect(area(tris)).toBeCloseTo(10000 - 25 * 36, 6);
    expect(covers(tris, { x: 13, y: 13 })).toBe(false); // in the first clearance
    expect(covers(tris, { x: 85, y: 85 })).toBe(false); // in the last
    expect(covers(tris, { x: 5, y: 50 })).toBe(true); // copper down the edge
  });

  it('scales to a densely perforated pour', () => {
    // 100 clearances. Not a boundary case so much as a floor: a real ground
    // plane on a dense board has hundreds, and the failure mode being guarded
    // against degraded with hole count rather than appearing at some threshold.
    const rings: Pt[][] = [ring(0, 0, 200, 200)];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        rings.push(reversed(ring(5 + i * 19, 5 + j * 19, 8, 8)));
      }
    }
    const tris = triangulateRings(rings);
    expect(area(tris)).toBeCloseTo(40000 - 100 * 64, 4);
    expect(covers(tris, { x: 9, y: 9 })).toBe(false);
    expect(covers(tris, { x: 2, y: 100 })).toBe(true);
  });

  it('handles a concave outline', () => {
    // An L-shaped pour with a hole in the arm. A concave outline breaks the
    // assumption that any nearby vertex is visible from the hole.
    const L: Pt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    const tris = triangulateRings([L, reversed(ring(60, 10, 10, 10))]);
    // L area: 100x40 + 40x60 = 6400, less the 100-unit hole.
    expect(area(tris)).toBeCloseTo(6400 - 100, 6);
    expect(covers(tris, { x: 65, y: 15 })).toBe(false); // the hole
    expect(covers(tris, { x: 90, y: 20 })).toBe(true); // the arm
    expect(covers(tris, { x: 20, y: 90 })).toBe(true); // the upright
    expect(covers(tris, { x: 80, y: 80 })).toBe(false); // the notch, outside
  });

  it('keeps a ring nested in a same-wound ring solid', () => {
    // The `nonzero` rule this whole module hangs on, and the bug it shipped
    // with. Every bucket in `buildScene` is one path holding a whole layer's
    // shapes, and they overlap all the time — here a paste window inside the
    // thermal pad it belongs to. Both are wound the same way, so the winding
    // number inside the small ring is 2, not 0, and `nonzero` fills it. Judging
    // by nesting instead makes it a hole and the pad shows the layers *under*
    // it through the gap.
    const tris = triangulateRings([ring(0, 0, 100, 100), ring(40, 40, 20, 20)]);

    expect(covers(tris, { x: 50, y: 50 })).toBe(true); // inside both rings
    expect(covers(tris, { x: 10, y: 10 })).toBe(true); // the pad around it
    expect(covers(tris, { x: 150, y: 50 })).toBe(false);
  });

  it('unions two partly overlapping rings', () => {
    // Neither contains the other. Both must be covered whole: dropping one as
    // redundant would erase the part of it sticking out.
    const tris = triangulateRings([ring(0, 0, 60, 60), ring(40, 40, 60, 60)]);

    expect(covers(tris, { x: 10, y: 10 })).toBe(true); // only the first
    expect(covers(tris, { x: 90, y: 90 })).toBe(true); // only the second
    expect(covers(tris, { x: 50, y: 50 })).toBe(true); // the shared corner
    expect(covers(tris, { x: 10, y: 90 })).toBe(false); // neither
  });

  it('counts winding rather than depth when a hole sits under two rings', () => {
    // Two same-wound rings and one reversed ring inside both. The winding number
    // there is 1 + 1 - 1 = 1, so `nonzero` — and Canvas2D — keep it filled: one
    // reversal cancels one covering ring, not both. Depth parity would call it
    // solid too, but for the wrong reason, and gets the sibling case below
    // backwards.
    const twoDeep = triangulateRings([
      ring(0, 0, 100, 100),
      ring(20, 20, 60, 60),
      reversed(ring(45, 45, 10, 10)),
    ]);
    expect(covers(twoDeep, { x: 50, y: 50 })).toBe(true);

    // The same reversed ring under a single covering ring cancels to zero, and
    // is a hole.
    const oneDeep = triangulateRings([ring(0, 0, 100, 100), reversed(ring(45, 45, 10, 10))]);
    expect(covers(oneDeep, { x: 50, y: 50 })).toBe(false);
    expect(covers(oneDeep, { x: 5, y: 5 })).toBe(true);
  });

  it('is unchanged for a single ring with no holes', () => {
    const tris = triangulateRings([ring(0, 0, 10, 10)]);
    expect(area(tris)).toBeCloseTo(100, 6);
    expect(covers(tris, { x: 5, y: 5 })).toBe(true);
  });

  it('ignores degenerate rings instead of throwing', () => {
    expect(triangulateRings([])).toEqual([]);
    expect(triangulateRings([[{ x: 0, y: 0 }]])).toEqual([]);
    expect(
      area(
        triangulateRings([
          ring(0, 0, 10, 10),
          [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
        ]),
      ),
    ).toBeCloseTo(100, 6);
  });
});
