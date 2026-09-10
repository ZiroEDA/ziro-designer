// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A rounded corner gets the vertices Clipper2 gives it, not Clipper 1's.
 *
 * KiCad inflates with Clipper2 (`SHAPE_POLY_SET::inflate2`); `clipper-lib` is
 * the port of Clipper 1, and the two count a round join's chords differently:
 * `ceil( steps_per_rad * |angle| )` against `Round( … )`. The expectation
 * here is KiCad 10.0.5's own answer, read through its Python API:
 *
 *     ps = SHAPE_POLY_SET(); square 0..10 mm
 *     ps.Inflate( 500000, CORNER_STRATEGY_ROUND_ALL_CORNERS, 5000 )
 *     -> 28 vertices; the arc past (10, 10) is
 *        (10071157, 10494911) (10207708, 10454816) (10327430, 10377875)
 *        (10420627, 10270320) (10479746, 10140866)
 *
 * The port produced the last four to the nanometre and not the first: five
 * chords where KiCad draws six, one sliver on every rounded corner of every
 * pour on the board.
 */
import { describe, it, expect } from 'vitest';
import { inflate, CornerStrategy } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { segmentsForRadius } from '@ziroeda/pcbnew/src/zone_filler.js';

const square = [
  [
    { x: 0, y: 0 },
    { x: 10_000_000, y: 0 },
    { x: 10_000_000, y: 10_000_000 },
    { x: 0, y: 10_000_000 },
  ],
];

describe('round join, the Clipper2 way', () => {
  it('gives the 10 mm square inflated by 0.5 mm the 28 vertices KiCad gives it', () => {
    const out = inflate(
      [square],
      500_000,
      CornerStrategy.ROUND_ALL_CORNERS,
      segmentsForRadius(500_000, 5000),
    );
    const ring = out[0]![0]!;
    expect(ring).toHaveLength(28);

    const arc = [...ring]
      .filter((p) => p.x > 10_000_000 && p.y > 10_000_000)
      .map((p) => [Math.round(p.x), Math.round(p.y)])
      .sort((a, b) => a[0]! - b[0]!);
    expect(arc).toEqual([
      [10071157, 10494911],
      [10207708, 10454816],
      [10327430, 10377875],
      [10420627, 10270320],
      [10479746, 10140866],
    ]);
  });
});
