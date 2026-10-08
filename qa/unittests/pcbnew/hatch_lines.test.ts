// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_SHAPE::UpdateHatching` and the `SHAPE_POLY_SET::GenerateHatchLines`
 * under it (eda_shape.cpp:674-825, shape_poly_set.cpp:3510-3642).
 *
 * A hatched fill is a set of REAL segments, clipped to the shape: they are what
 * the renderer strokes, what a click lands on, and what a plot emits. Their
 * count and their angle are what the fill LOOKS like, so both are derived here
 * from the algorithm rather than read back off it.
 */
import { describe, expect, it } from 'vitest';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';

/** One closed outline through those points. */
const poly = (pts: [number, number][]): SHAPE_POLY_SET => {
  const p = new SHAPE_POLY_SET();
  p.NewOutline();
  for (const [x, y] of pts) p.Append(x, y);
  return p;
};
const BOX: [number, number][] = [
  [0, 0],
  [1000, 0],
  [1000, 1000],
  [0, 1000],
];

/** A `side` x `side` rectangle at the origin with that fill, on a board. */
const square = (side: number, fill: FILL_T, width = 100, radius = 0): PCB_SHAPE => {
  const s = new PCB_SHAPE(new BOARD(), SHAPE_T.RECTANGLE);
  s.SetLayer(PCB_LAYER_ID.F_SilkS);
  s.SetStart({ x: 0, y: 0 });
  s.SetEnd({ x: side, y: side });
  s.SetWidth(width);
  s.SetCornerRadius(radius);
  s.SetFillMode(fill);
  return s;
};
const slope = (l: SEG): number => Math.sign((l.B.y - l.A.y) / (l.B.x - l.A.x));

describe('SHAPE_POLY_SET::GenerateHatchLines', () => {
  it('walks the offsets from a spacing-aligned start, so two shapes share a grid', () => {
    // `min_a = ( min_a / aSpacing ) * aSpacing`: the family is snapped to the
    // spacing grid, not to the shape's corner. Every line's offset `a`
    // (y + x for slope -1) is a multiple of the spacing even in a box at +150.
    const offset = poly(BOX.map(([x, y]) => [x + 150, y + 150]));
    for (const l of offset.GenerateHatchLines([-1], 250, -1))
      expect((l.A.y + l.A.x) % 250, `line at a=${l.A.y + l.A.x}`).toBe(0);

    // For slope -1 over a 1000-unit box the offsets run 0..2000 in 250s, and
    // the two extreme ones clip to nothing: seven crossings survive.
    const lines = poly(BOX).GenerateHatchLines([-1], 250, -1);
    expect(lines.length).toBe(7);
    for (const l of lines) expect(Math.abs(l.B.x - l.A.x)).toBe(Math.abs(l.B.y - l.A.y));
  });

  it('drops a crossing whose midpoint is outside the shape', () => {
    // The `Contains( mid )` test: a 45-degree line through an L's notch has
    // ends on the outline and nothing between them.
    const ell = poly([
      [0, 0],
      [1000, 0],
      [1000, 400],
      [400, 400],
      [400, 1000],
      [0, 1000],
    ]);
    for (const l of ell.GenerateHatchLines([-1], 200, -1)) {
      const mid = { x: (l.A.x + l.B.x) / 2, y: (l.A.y + l.B.y) / 2 };
      expect(mid.x > 400 && mid.y > 400).toBe(false);
    }
  });

  it('splits a long crossing into two stubs when a line length is given', () => {
    // `aLineLength` of -1 is one line per crossing (what EDA_SHAPE passes); a
    // positive one keeps only the two ends, which is a zone's border hatch.
    const whole = poly(BOX).GenerateHatchLines([-1], 250, -1);
    const stubs = poly(BOX).GenerateHatchLines([-1], 250, 50);
    expect(stubs.length).toBeGreaterThan(whole.length);
  });
});

describe('EDA_SHAPE::UpdateHatching, per shape', () => {
  it('gives each mode its own slope, and the cross-hatch both (eda_shape.cpp:687-694)', () => {
    // HATCH is -1, REVERSE_HATCH is +1, CROSS_HATCH both. In screen
    // coordinates y runs down, so the -1 family falls to the right.
    const hatch = square(10_000, FILL_T.HATCH).GetHatchLines();
    const reverse = square(10_000, FILL_T.REVERSE_HATCH).GetHatchLines();
    const cross = square(10_000, FILL_T.CROSS_HATCH).GetHatchLines();

    expect(hatch.length).toBeGreaterThan(0);
    expect(hatch.every((l) => slope(l) === -1)).toBe(true);
    expect(reverse.every((l) => slope(l) === 1)).toBe(true);
    expect(cross.length).toBe(hatch.length + reverse.length);
    const up = cross.filter((l) => slope(l) > 0).length;
    expect(up).toBe(cross.length - up);
  });

  it('hatches only the kinds with an interior', () => {
    // ARC, SEGMENT and BEZIER return early (eda_shape.cpp:701-705).
    const line = new PCB_SHAPE(new BOARD(), SHAPE_T.SEGMENT);
    line.SetStart({ x: 0, y: 0 });
    line.SetEnd({ x: 1000, y: 1000 });
    line.SetFillMode(FILL_T.HATCH);
    expect(line.GetHatchLines()).toEqual([]);
  });

  it('draws nothing for an unfilled or a solid shape', () => {
    expect(square(10_000, FILL_T.NO_FILL).GetHatchLines()).toEqual([]);
    expect(square(10_000, FILL_T.FILLED_SHAPE).GetHatchLines()).toEqual([]);
  });

  it('takes the corner radius into the outline it hatches', () => {
    // `ROUNDRECT rr( …, GetCornerRadius() )`: the hatched area is the ROUNDED
    // rectangle, so the corner-to-corner line is shorter than the square one.
    const len = (l: SEG): number => Math.hypot(l.B.x - l.A.x, l.B.y - l.A.y);
    const longest = (s: PCB_SHAPE): number => Math.max(...s.GetHatchLines().map(len));
    expect(longest(square(10_000, FILL_T.HATCH, 100, 3000))).toBeLessThan(
      longest(square(10_000, FILL_T.HATCH)),
    );
  });

  it('spaces the lines at ten times the pen, and caps them at ~100 across', () => {
    // `GetHatchLineSpacing()` is `GetHatchLineWidth() * 10` (eda_shape.h:172):
    // a 5000 square at a 100 pen is spaced 1000, i.e. offsets 0..10000 in
    // 1000s, nine crossings once the corners clip away.
    expect(square(5000, FILL_T.HATCH).GetHatchLines().length).toBe(9);
    // More than 100 lines across the major axis and the spacing becomes the
    // axis over 100: a 200 000 square is spaced 2000, 199 crossings, not 399.
    expect(square(200_000, FILL_T.HATCH).GetHatchLines().length).toBe(199);
  });
});
