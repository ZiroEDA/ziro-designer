// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_GRID_HELPER` — where the cursor lands when it is over copper.
 *
 * The bug these pin: every cursor position in the PCB editor used to be
 * `computeNearest` and nothing else, so hovering a track put the crosshair on
 * the grid node above or below it. `TOOL_BASE::snapToItem` had been ported for
 * a long time and calls `AlignToSegment` for exactly this, but nothing
 * implemented the grid-helper interface behind it, so the router could never
 * put the cursor on anything.
 *
 * The first test is the whole point of the change: the same pointer, through
 * the old path and the new one, and only one of them ends up on the copper.
 */
import { describe, expect, it } from 'vitest';
import {
  align,
  alignToArc,
  alignToSegment,
  computeNearest,
  gridArcFromPoints,
  PcbGridHelper,
  type PcbGridState,
} from '@ziroeda/pcbnew/src/pcb_grid_helper.js';

const MM = 1e6;

/** A 0.5 mm grid on the world origin, snapping on — the default state. */
const gridState = (over: Partial<PcbGridState> = {}): PcbGridState => ({
  size: 0.5 * MM,
  origin: { x: 0, y: 0 },
  enableGrid: true,
  enableSnap: true,
  ...over,
});

/**
 * A horizontal track whose centreline is deliberately *not* on the grid:
 * y = 1.123 mm, where the grid nodes are at 1.0 mm and 1.5 mm.
 */
const TRACK = { a: { x: 0, y: 1_123_000 }, b: { x: 10 * MM, y: 1_123_000 } };

describe('computeNearest (GRID_HELPER::computeNearest)', () => {
  it('rounds about the origin, not toward it', () => {
    const g = 0.5 * MM;
    const o = { x: 1000, y: 1000 };
    expect(computeNearest({ x: 1000 + g * 0.6, y: 1000 }, g, o).x).toBe(1000 + g);
    expect(computeNearest({ x: 1000 + g * 0.4, y: 1000 }, g, o).x).toBe(1000);
    expect(computeNearest({ x: 1000 - g * 0.6, y: 1000 }, g, o).x).toBe(1000 - g);
  });

  it('leaves a point alone rather than dividing by a zero grid', () => {
    expect(computeNearest({ x: 7, y: 9 }, 0, { x: 0, y: 0 })).toEqual({ x: 7, y: 9 });
  });
});

describe('align (GRID_HELPER::Align)', () => {
  it('does not touch the point when the grid is off (canUseGrid)', () => {
    const p = { x: 2_600_000, y: 1_100_000 };
    expect(align(p, gridState({ enableGrid: false }))).toEqual(p);
  });
});

describe('alignToSegment (PCB_GRID_HELPER::AlignToSegment)', () => {
  it('puts the cursor on the track centreline, where the grid alone cannot', () => {
    const pointer = { x: 2_600_000, y: 1_100_000 };
    const grid = gridState();

    // The old behaviour, and the bug: the nearest grid node is 0.123 mm above
    // the copper, so the cursor floats off the track.
    expect(align(pointer, grid)).toEqual({ x: 2.5 * MM, y: 1 * MM });

    // The vertical ray from that grid node crosses the centreline at the node's
    // own x, and is nearer to it than either diagonal. The cursor is on the
    // copper, at a point that still lines up with the grid.
    expect(alignToSegment(pointer, TRACK, grid)).toEqual({ x: 2.5 * MM, y: 1_123_000 });
  });

  it('offers the diagonal crossings, and takes the nearest of the four', () => {
    // Pull the pointer far enough right that the grid node lands where the +45°
    // ray meets the centreline sooner than the vertical one does.
    const grid = gridState({ size: 1 * MM });
    const pointer = { x: 4_400_000, y: 1_600_000 };

    // aligned = (4, 2) mm. The centreline is 0.877 mm above that, so the
    // vertical crossing is 0.877 mm away and each diagonal is 0.877·√2.
    expect(align(pointer, grid)).toEqual({ x: 4 * MM, y: 2 * MM });
    expect(alignToSegment(pointer, TRACK, grid)).toEqual({ x: 4 * MM, y: 1_123_000 });
  });

  it('prefers an end when the pointer is near one', () => {
    // Measured from the raw pointer, not the grid node — upstream scores the
    // two ends against `aPoint` and the crossings against `aligned`.
    const pointer = { x: 100_000, y: 1_120_000 };
    expect(alignToSegment(pointer, TRACK, gridState())).toEqual(TRACK.a);
  });

  it('discards crossings that land beyond the track, and falls back to its end', () => {
    // 1 mm past the far end. Every ray still meets the infinite centreline, but
    // each crossing is a millimetre off the segment, so `c_gridSnapEpsilon_sq`
    // throws them all away and the nearest end wins.
    const pointer = { x: 11 * MM, y: 1_123_000 };
    expect(alignToSegment(pointer, TRACK, gridState())).toEqual(TRACK.b);
  });

  it('is a plain grid align when snapping is off (Shift held)', () => {
    const pointer = { x: 2_600_000, y: 1_100_000 };
    const grid = gridState({ enableSnap: false });
    expect(alignToSegment(pointer, TRACK, grid)).toEqual({ x: 2.5 * MM, y: 1 * MM });
  });

  it('survives a zero-length track rather than dividing by its direction', () => {
    const degenerate = { a: { x: 3 * MM, y: 3 * MM }, b: { x: 3 * MM, y: 3 * MM } };
    const pointer = { x: 3_100_000, y: 3_100_000 };
    expect(alignToSegment(pointer, degenerate, gridState())).toEqual(degenerate.a);
  });
});

describe('alignToArc (PCB_GRID_HELPER::AlignToArc)', () => {
  // A quarter arc of radius 1 mm about the origin, sweeping +x to +y.
  const ARC = { c: { x: 0, y: 0 }, rad: 1 * MM, a0: 0, sweep: Math.PI / 2 };

  it('puts the cursor on the arc', () => {
    const pointer = { x: 700_000, y: 700_000 };
    const got = alignToArc(pointer, ARC, gridState());

    // The +45° ray from the grid node (0.5, 0.5) mm meets the arc at 45°, which
    // is nearer to that node than any other crossing or either end.
    expect(got.x).toBeCloseTo(707_107, -1);
    expect(got.y).toBeCloseTo(707_107, -1);
    // And it really is on the arc, to within the integer rounding.
    expect(Math.hypot(got.x - ARC.c.x, got.y - ARC.c.y)).toBeCloseTo(ARC.rad, -1);
  });

  it('is a plain grid align when snapping is off', () => {
    const pointer = { x: 700_000, y: 700_000 };
    expect(alignToArc(pointer, ARC, gridState({ enableSnap: false }))).toEqual({
      x: 0.5 * MM,
      y: 0.5 * MM,
    });
  });
});

describe('gridArcFromPoints (SHAPE_ARC from a curved track)', () => {
  it('sweeps whichever way puts the mid point inside the arc', () => {
    // The same two ends, with the mid point on opposite sides: the sign of the
    // sweep is the only thing that distinguishes them, which is why a curved
    // track stores three points and not two.
    const ccw = gridArcFromPoints({ x: 1 * MM, y: 0 }, { x: 0, y: 1 * MM }, { x: -1 * MM, y: 0 });
    const cw = gridArcFromPoints({ x: 1 * MM, y: 0 }, { x: 0, y: -1 * MM }, { x: -1 * MM, y: 0 });

    expect(ccw?.sweep).toBeCloseTo(Math.PI, 6);
    expect(cw?.sweep).toBeCloseTo(-Math.PI, 6);
    expect(ccw?.rad).toBeCloseTo(1 * MM, 0);
    expect(ccw?.c.x).toBeCloseTo(0, 0);
    expect(ccw?.c.y).toBeCloseTo(0, 0);
  });

  it('yields a radius near the coordinate limit for three collinear points', () => {
    // `CalcArcCenter` answers a collinear triple with a centre clamped to the
    // coordinate limit rather than failing, so the arc is enormous instead of
    // absent. Upstream catches that in `SHAPE_ARC::IntersectLine`, not here.
    const degenerate = gridArcFromPoints({ x: 0, y: 0 }, { x: 1 * MM, y: 0 }, { x: 2 * MM, y: 0 });
    expect(degenerate).not.toBeNull();
    expect(degenerate!.rad).toBeGreaterThan(2_147_483_647 / 2);
  });

  it('produces no crossings from a degenerate arc, leaving only its ends', () => {
    const degenerate = gridArcFromPoints({ x: 0, y: 0 }, { x: 1 * MM, y: 0 }, { x: 2 * MM, y: 0 });
    const pointer = { x: 1_100_000, y: 100_000 };
    const got = alignToArc(pointer, degenerate!, gridState());

    // Every crossing is suppressed, so the nearer end wins — the cursor stays
    // on the copper rather than leaping to the centre clamped at INT_MAX.
    expect(got.x).toBeCloseTo(2 * MM, 3);
    expect(got.y).toBeCloseTo(0, 3);
  });
});

describe('PcbGridHelper (the PnsSnapGridHelper the router asks for)', () => {
  it('aligns a segment through the shared state', () => {
    const helper = new PcbGridHelper(gridState());
    expect(helper.alignToSegment({ x: 2_600_000, y: 1_100_000 }, TRACK)).toEqual({
      x: 2.5 * MM,
      y: 1_123_000,
    });
  });

  it('falls back to the grid for a shape that is not an arc', () => {
    const helper = new PcbGridHelper(gridState());
    const circle = { kind: 'circle', c: { x: 0, y: 0 }, r: 1 * MM } as const;
    expect(helper.alignToArc({ x: 700_000, y: 700_000 }, circle)).toEqual({
      x: 0.5 * MM,
      y: 0.5 * MM,
    });
  });

  it('tracks a later change to the state it was handed', () => {
    // Upstream's helper is a long-lived member the event handler pokes with
    // SetUseGrid / SetSnap rather than rebuilding per mouse move.
    const state = gridState();
    const helper = new PcbGridHelper(state);
    state.enableSnap = false;
    expect(helper.alignToSegment({ x: 2_600_000, y: 1_100_000 }, TRACK)).toEqual({
      x: 2.5 * MM,
      y: 1 * MM,
    });
  });
});
