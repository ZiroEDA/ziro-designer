// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_SHAPE::UpdateHatching` and the `SHAPE_POLY_SET::GenerateHatchLines`
 * under it (eda_shape.cpp:668-760, shape_poly_set.cpp:3510-3642).
 *
 * A hatched fill is a set of REAL segments, clipped to the shape: they are what
 * the renderer strokes, what a click lands on, and what a plot emits. Their
 * count and their angle are what the fill LOOKS like, so both are derived here
 * from the algorithm rather than read back off it.
 */
import { describe, expect, it } from 'vitest';
import {
  generateHatchLines,
  hatchSlopes,
  hatchSpacing,
  segIntersectsLine,
} from '@ziroeda/kimath/src/geometry/hatch_lines.js';
import { shapeFillOutline, shapeHatchLines } from '@ziroeda/pcbnew/src/shape_fill.js';
import type { PcbShape } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const square = (side: number, fillMode: PcbShape['fillMode'], width = 100): PcbShape => ({
  kind: 'rect',
  start: { x: 0, y: 0 },
  end: { x: side, y: side },
  width,
  fillMode,
  layer: 'F.SilkS',
  source: EMPTY,
});

describe('SEG::IntersectsLine', () => {
  it('solves a vertical segment for y, which the parametric form cannot', () => {
    // `if( segDir.x == 0 )` (seg.cpp:463-480): x is fixed, so the line's own
    // equation gives y directly — and it is a miss when that y is off the
    // segment.
    const p = { x: 100, y: 0 };
    const q = { x: 100, y: 1000 };
    expect(segIntersectsLine(p, q, 1, 0)).toEqual({ x: 100, y: 100 });
    expect(segIntersectsLine(p, q, 1, -5000)).toBeNull();
  });

  it('reports a collinear segment at its own midpoint', () => {
    // The parallel branch: `diff < 0.5` means the segment lies ON the line, and
    // upstream returns the midpoint rather than nothing, so the crossing still
    // has two ends.
    const hit = segIntersectsLine({ x: 0, y: 0 }, { x: 1000, y: 1000 }, 1, 0);
    expect(hit).toEqual({ x: 500, y: 500 });
    // Parallel but off the line is a miss.
    expect(segIntersectsLine({ x: 0, y: 500 }, { x: 1000, y: 1500 }, 1, 0)).toBeNull();
  });

  it('rejects an intersection past either end of the segment', () => {
    // `t >= 0 && t <= 1` — the infinite line meets the segment's LINE beyond
    // its ends, and that is not a crossing.
    expect(segIntersectsLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, -1000)).toBeNull();
  });
});

describe('GenerateHatchLines', () => {
  const box = [
    [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ],
  ];

  it('walks the offsets from a spacing-aligned start, so two shapes share a grid', () => {
    // `min_a = ( min_a / aSpacing ) * aSpacing` — the family is snapped to the
    // spacing grid, not to the shape's own corner, which is why two hatched
    // shapes side by side line up. A box at an offset position proves it: every
    // line's own offset `a` (which is `y + x` for slope -1) is still a multiple
    // of the spacing, where an unsnapped start would put them at `a + 150`.
    const offsetBox = box.map((poly) => poly.map((p) => ({ x: p.x + 150, y: p.y + 150 })));
    for (const l of generateHatchLines(offsetBox, [-1], 250))
      expect((l.a.y + l.a.x) % 250, `line at a=${l.a.y + l.a.x}`).toBe(0);

    const lines = generateHatchLines(box, [-1], 250);
    // For slope -1 over a 1000-unit box the offsets run 0..2000 in 250s, and
    // the two extreme ones clip to nothing, so seven crossings survive.
    expect(lines.length).toBe(7);
    // Every line is at 45 degrees: |dx| === |dy|.
    for (const l of lines) expect(Math.abs(l.b.x - l.a.x)).toBe(Math.abs(l.b.y - l.a.y));
  });

  it('gives each mode its own slope, and the cross-hatch both', () => {
    // eda_shape.cpp:684-690 — HATCH is -1, REVERSE_HATCH is +1, CROSS_HATCH is
    // both. The SIGN is the whole difference between the two single modes, so a
    // test that only counts lines cannot tell them apart.
    expect(hatchSlopes('hatch')).toEqual([-1]);
    expect(hatchSlopes('reverse_hatch')).toEqual([1]);
    expect(hatchSlopes('cross_hatch')).toEqual([1, -1]);

    const slopeOf = (mode: 'hatch' | 'reverse_hatch'): number => {
      const [l] = generateHatchLines(box, hatchSlopes(mode), 250);
      return Math.sign((l!.b.y - l!.a.y) / (l!.b.x - l!.a.x));
    };
    // In screen coordinates y runs down, so the -1 family falls to the right.
    expect(slopeOf('hatch')).toBe(-1);
    expect(slopeOf('reverse_hatch')).toBe(1);

    const one = generateHatchLines(box, hatchSlopes('hatch'), 250).length;
    const other = generateHatchLines(box, hatchSlopes('reverse_hatch'), 250).length;
    const both = generateHatchLines(box, hatchSlopes('cross_hatch'), 250).length;
    expect(one).toBeGreaterThan(0);
    expect(both).toBe(one + other);
  });

  it('drops a crossing whose midpoint is outside the shape', () => {
    // The `Contains( mid )` test: an L is two rectangles' worth of outline, and
    // a 45-degree line through the notch has ends on the outline with nothing
    // between them.
    const ell = [
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 400 },
        { x: 400, y: 400 },
        { x: 400, y: 1000 },
        { x: 0, y: 1000 },
      ],
    ];
    for (const l of generateHatchLines(ell, [-1], 200)) {
      const mid = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 };
      // The notch is the square x>400, y>400.
      expect(mid.x > 400 && mid.y > 400).toBe(false);
    }
  });

  it('splits a long crossing into two stubs when a line length is given', () => {
    // `aLineLength` of -1 is one line per crossing (what EDA_SHAPE passes);
    // a positive one keeps only the two ends, which is a zone's border hatch.
    const whole = generateHatchLines(box, [-1], 250, -1);
    const stubs = generateHatchLines(box, [-1], 250, 50);
    expect(stubs.length).toBeGreaterThan(whole.length);
  });
});

describe('UpdateHatching, per shape', () => {
  it('hatches only the kinds with an interior', () => {
    // ARC, SEGMENT and BEZIER return early (eda_shape.cpp:696-701).
    expect(shapeFillOutline({ ...square(1000, 'hatch'), kind: 'line' })).toEqual([]);
    expect(
      shapeFillOutline({
        kind: 'arc',
        start: { x: 0, y: 0 },
        mid: { x: 5, y: 5 },
        end: { x: 10, y: 0 },
        width: 100,
        fillMode: 'hatch',
        layer: 'F.SilkS',
        source: EMPTY,
      }),
    ).toEqual([]);
    expect(shapeHatchLines({ ...square(1000, 'hatch'), kind: 'line' })).toEqual([]);
  });

  it('takes the corner radius into the outline it hatches', () => {
    // `ROUNDRECT rr( …, GetCornerRadius() )` — the hatched area is the ROUNDED
    // rectangle, so a corner line is shorter than the square one.
    const plain = shapeFillOutline(square(10_000, 'hatch'));
    const rounded = shapeFillOutline({ ...square(10_000, 'hatch'), cornerRadius: 3000 });
    expect(plain[0]).toHaveLength(4);
    expect(rounded[0]!.length).toBeGreaterThan(4);
  });

  it('spaces the lines at ten times the pen, and caps them at ~100 across', () => {
    // `GetHatchLineSpacing()` is `GetHatchLineWidth() * 10` (eda_shape.h:172),
    // and `UpdateHatching` then caps it: more than 100 lines across the major
    // axis and the spacing becomes the axis over 100.
    expect(hatchSpacing(100, 5000)).toBe(1000);
    // 200 000 / 1000 is 200 lines, past the cap, so the spacing opens up.
    expect(hatchSpacing(100, 200_000)).toBe(2000);
  });

  it('gives a hatched square a plausible line count, and none when unfilled', () => {
    const lines = shapeHatchLines(square(10_000, 'cross_hatch'));
    expect(lines.length).toBeGreaterThan(0);
    // Both families, so an equal split between the two slopes.
    const up = lines.filter((l) => (l.b.y - l.a.y) / (l.b.x - l.a.x) > 0).length;
    expect(up).toBe(lines.length - up);
    expect(shapeHatchLines(square(10_000, 'none'))).toEqual([]);
    expect(shapeHatchLines(square(10_000, 'solid'))).toEqual([]);
  });
});
