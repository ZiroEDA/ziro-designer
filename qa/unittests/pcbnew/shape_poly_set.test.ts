// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SHAPE_POLY_SET::Fracture: a polygon with holes becomes one ring, each hole cut
 * open to the outline along a horizontal slit. This is what a zone fill has to
 * be before it is written, since KiCad fills every ring it reads.
 */
import { describe, it, expect } from 'vitest';
import { fracture, fractureSingle } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

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
