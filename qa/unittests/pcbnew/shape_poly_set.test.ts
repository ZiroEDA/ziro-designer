// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SHAPE_POLY_SET::Fracture: a polygon with holes becomes one ring, each hole cut
 * open to the outline along a horizontal slit. This is what a zone fill has to
 * be before it is written, since KiCad fills every ring it reads.
 */
import { describe, it, expect } from 'vitest';
import {
  chamfer,
  CornerStrategy,
  fillet,
  fracture,
  fractureSingle,
  inflate,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

/** Signed area; sign tells the winding, magnitude the enclosed area. */
const signedArea = (ring: { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return a / 2;
};

const square = (x: number, y: number, w: number): { x: number; y: number }[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + w },
  { x, y: y + w },
];

describe('fracture', () => {
  it('leaves a polygon with no holes alone', () => {
    const out = fractureSingle([square(0, 0, 100)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4);
  });

  it('joins a hole to the outline, leaving one ring', () => {
    const out = fractureSingle([square(0, 0, 100), square(30, 30, 40).reverse()]);
    expect(out).toHaveLength(1);
    const ring = out[0]!;
    // Outline (4) + hole (4) + the slit's extra points.
    expect(ring.length).toBeGreaterThan(8);
    // The slit is horizontal: it enters and leaves the hole at the same y.
    const holeY = 30;
    expect(ring.some((p) => p.y === holeY)).toBe(true);
  });

  it('keeps the enclosed area: the slit has no width', () => {
    const outline = square(0, 0, 100);
    const hole = square(30, 30, 40).reverse();
    const fractured = fractureSingle([outline, hole])[0]!;
    // 100x100 less 40x40 = 8400, whichever way the ring is wound.
    expect(Math.abs(signedArea(fractured))).toBeCloseTo(8400, 6);
  });

  it('handles two holes, taking the left-most first', () => {
    const out = fractureSingle([
      square(0, 0, 200),
      square(20, 20, 30).reverse(),
      square(120, 20, 30).reverse(),
    ]);
    expect(out).toHaveLength(1);
    // 200x200 less two 30x30 holes.
    expect(Math.abs(signedArea(out[0]!))).toBeCloseTo(40000 - 900 - 900, 6);
  });

  it('fractures a whole set', () => {
    const rings = fracture([
      [square(0, 0, 100), square(30, 30, 40).reverse()],
      [square(200, 0, 50)],
    ]);
    expect(rings).toHaveLength(2);
    expect(Math.abs(signedArea(rings[0]!))).toBeCloseTo(8400, 6);
    expect(Math.abs(signedArea(rings[1]!))).toBeCloseTo(2500, 6);
  });
});

describe('inflate (SHAPE_POLY_SET::Inflate)', () => {
  it('grows and shrinks by the amount given', () => {
    const grown = inflate([[square(0, 0, 100)]], 10, CornerStrategy.CHAMFER_ALL_CORNERS, 16);
    expect(Math.abs(signedArea(grown[0]![0]!))).toBeGreaterThan(10000);
    const shrunk = inflate([[square(0, 0, 100)]], -10, CornerStrategy.CHAMFER_ALL_CORNERS, 16);
    // 80 x 80 with chamfered corners, so a touch under 6400.
    expect(Math.abs(signedArea(shrunk[0]![0]!))).toBeLessThan(6500);
    expect(Math.abs(signedArea(shrunk[0]![0]!))).toBeGreaterThan(6000);
  });

  it('deflates a shape thinner than the amount out of existence', () => {
    // A 10-wide bar deflated by 6 either side has nothing left.
    const bar = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(inflate([[bar]], -6, CornerStrategy.CHAMFER_ALL_CORNERS, 16)).toHaveLength(0);
  });

  it('keeps a hole a hole rather than turning it into an island', () => {
    const withHole = [square(0, 0, 200), square(80, 80, 40).reverse()];
    const out = inflate([withHole], -5, CornerStrategy.CHAMFER_ALL_CORNERS, 16);
    expect(out).toHaveLength(1);
    // One outline plus its hole, and the hole grew as the outline shrank.
    expect(out[0]).toHaveLength(2);
    expect(Math.abs(signedArea(out[0]![1]!))).toBeGreaterThan(1600);
  });

  it('is a no-op for zero', () => {
    const same = inflate([[square(0, 0, 100)]], 0);
    expect(same[0]![0]).toHaveLength(4);
  });
});

describe('corner smoothing (chamferFilletPolygon)', () => {
  const sq = square(0, 0, 1000);

  it('chamfer cuts each corner into two points', () => {
    const out = chamfer([[sq]], 100);
    // Four corners, each replaced by a pair.
    expect(out[0]![0]).toHaveLength(8);
    // The cut is `distance` along each edge from the corner.
    expect(out[0]![0]).toContainEqual({ x: 0, y: 100 });
    expect(out[0]![0]).toContainEqual({ x: 100, y: 0 });
    // And it removes area: four triangles of 100x100/2.
    expect(Math.abs(signedArea(out[0]![0]!))).toBeCloseTo(1000 * 1000 - 4 * 5000, 6);
  });

  it('chamfer takes at most half an edge, however large the distance', () => {
    const out = chamfer([[sq]], 100000);
    // Clamped to half of each edge, so the square becomes a diamond.
    expect(Math.abs(signedArea(out[0]![0]!))).toBeCloseTo(500000, 6);
  });

  it('fillet rounds a corner into an arc of several points', () => {
    const out = fillet([[sq]], 200, 5);
    expect(out[0]![0]!.length).toBeGreaterThan(8);
    // Rounding removes less than the chamfer of the same size.
    const filletArea = Math.abs(signedArea(out[0]![0]!));
    const chamferArea = Math.abs(signedArea(chamfer([[sq]], 200)[0]![0]!));
    expect(filletArea).toBeGreaterThan(chamferArea);
    expect(filletArea).toBeLessThan(1000 * 1000);
  });

  it('a finer error limit puts more segments in the arc', () => {
    const coarse = fillet([[sq]], 200, 50)[0]![0]!.length;
    const fine = fillet([[sq]], 200, 1)[0]![0]!.length;
    expect(fine).toBeGreaterThan(coarse);
  });

  it('a zero distance leaves the polygon alone', () => {
    expect(chamfer([[sq]], 0)[0]![0]).toHaveLength(4);
    expect(fillet([[sq]], 0, 5)[0]![0]).toHaveLength(4);
  });
});
