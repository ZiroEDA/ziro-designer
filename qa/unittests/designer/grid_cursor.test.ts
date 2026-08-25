// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pure half of `GAL::DrawGrid` / `GAL::blitCursor`.
 *
 * A canvas render is not assertable from here — vitest has no 2D context, and
 * even with one, "the grid looks right" is a pixel judgement. What IS assertable
 * is every decision the painter makes before it touches the context: which step
 * the density loop settles on, which node indices fall inside the viewport, how
 * wide the minor and coarse pens are, which segments a crosshair mode produces,
 * and whether a crosshair is drawn at all (and at what alpha). Those are the
 * numbers that came out different in our four copies.
 */
import { describe, it, expect } from 'vitest';
import {
  GRID_TICK,
  MIN_GRID_IU,
  SMALL_CROSS_PX,
  crosshairSegments,
  cursorAlphaFactor,
  deviceToWorldX,
  deviceToWorldY,
  dimmedCursorColor,
  gridDotEdge,
  gridDotSize,
  gridIndexRange,
  gridPenWidths,
  visibleGridStep,
  worldToDeviceX,
  worldToDeviceY,
} from '@ziroeda/designer/src/ui/grid_cursor.js';

/** eeschema IU: 100 nm, so a 50 mil grid is 12700 IU. */
const MIL = 254;

describe('visibleGridStep — GAL::GetVisibleGridSize', () => {
  it('keeps the requested grid when it is already far enough apart', () => {
    // 50 mil at 0.01 device px/IU = 127 px between nodes, way over the 10 px
    // minimum, so no stepping happens.
    expect(visibleGridStep(50 * MIL, 0.01, 'dots', 10)).toBe(50 * MIL);
  });

  it('steps up by a whole tick, not by doubling', () => {
    // 50 mil (12700 IU) at 0.0005 px/IU = 6.35 px apart, under the 10 px
    // minimum -> one tick up to 500 mil, which is 63.5 px. KiCad multiplies by
    // m_gridTick, so the grid jumps 50 -> 500 mil.
    expect(visibleGridStep(50 * MIL, 0.0005, 'dots', 10)).toBe(50 * MIL * GRID_TICK);
  });

  it('steps repeatedly until it clears the threshold', () => {
    expect(visibleGridStep(50 * MIL, 0.00002, 'dots', 10)).toBe(50 * MIL * GRID_TICK * GRID_TICK);
  });

  it('gives SMALL_CROSS twice the room a dot needs', () => {
    // At this scale a dot grid clears the 10 px minimum and a cross grid does
    // not, because the cross threshold is doubled (cairo_gal.cpp:1787-1788).
    const scale = 0.0009; // 12700 * 0.0009 = 11.43 px
    expect(visibleGridStep(50 * MIL, scale, 'dots', 10)).toBe(50 * MIL);
    expect(visibleGridStep(50 * MIL, scale, 'crosses', 10)).toBe(50 * MIL * GRID_TICK);
  });

  it('scales the pixel threshold by the device pixel ratio', () => {
    const scale = 0.0009;
    // The minimum spacing is a *logical* pixel count; on a 2x canvas the same
    // setting is 20 device px, which this grid no longer clears.
    expect(visibleGridStep(50 * MIL, scale, 'dots', 10, 1)).toBe(50 * MIL);
    expect(visibleGridStep(50 * MIL, scale, 'dots', 10, 2)).toBe(50 * MIL * GRID_TICK);
  });

  it('honours a raised minimum spacing', () => {
    const scale = 0.0009; // 11.43 px
    expect(visibleGridStep(50 * MIL, scale, 'dots', 10)).toBe(50 * MIL);
    expect(visibleGridStep(50 * MIL, scale, 'dots', 20)).toBe(50 * MIL * GRID_TICK);
  });

  it('floors the grid at 100 IU before anything else', () => {
    expect(visibleGridStep(1, 1e6, 'dots', 10)).toBe(MIN_GRID_IU);
  });
});

describe('gridIndexRange — DrawGrid start/end indices', () => {
  it('counts nodes from the grid origin and adds a node of margin each side', () => {
    // world 0..1000, step 100, origin 0 -> indices 0..10, margined to -1..11.
    expect(gridIndexRange(0, 1000, 0, 100)).toEqual({ start: -1, end: 11 });
  });

  it('counts about the grid origin, so the nodes sit on it', () => {
    // pcbnew's board grid origin (`(setup (grid_origin ...))`) offsets every
    // dot: DrawGrid works in indices of `(world - m_gridOrigin) / step` and
    // adds the origin back when it places each node.
    const origin = 30;
    const { start, end } = gridIndexRange(0, 1000, origin, 100);
    // Every node is congruent to the origin, and the lattice still covers the
    // window at both ends.
    expect((((start * 100 + origin) % 100) + 100) % 100).toBe(origin);
    expect(start * 100 + origin).toBeLessThanOrEqual(0);
    expect(end * 100 + origin).toBeGreaterThanOrEqual(1000);
    // Hardcoding it to zero, as we used to, would put the nodes on multiples
    // of 100 instead.
    expect(start * 100 + origin).not.toBe(gridIndexRange(0, 1000, 0, 100).start * 100);
  });

  it('normalises a reversed pair (a mirrored or y-up axis)', () => {
    expect(gridIndexRange(1000, 0, 0, 100)).toEqual({ start: -1, end: 11 });
  });

  it('covers the whole viewport: the first node is at or left of the edge', () => {
    const step = 100;
    const { start, end } = gridIndexRange(37, 963, 0, step);
    expect(start * step).toBeLessThanOrEqual(37);
    expect(end * step).toBeGreaterThanOrEqual(963);
  });
});

describe('gridPenWidths — OPENGL_GAL::DrawGrid’s minor/major line width', () => {
  it('derives the stored width the way updatedGalDisplayOptions does', () => {
    // m_gridLineWidth = scaleFactor * setting + 0.25, floored at 1 px, coarse
    // lines double (graphics_abstraction_layer.cpp:124, opengl_gal.cpp:1911).
    expect(gridPenWidths(1, 2)).toEqual({ minor: 2.25, major: 4.5 });
  });

  it('floors the minor pen at one device pixel', () => {
    expect(gridPenWidths(0.5, 1).minor).toBe(1);
    expect(gridPenWidths(0, 1).minor).toBe(1);
  });

  /**
   * OpenGL clamps BEFORE doubling —
   * `majorLineWidth = std::fmax( 1.0f, m_gridLineWidth ) * ... * 2.0f` — so
   * the smallest setting the Preferences panel offers (0.5, giving a stored
   * 0.75) gives a 1 px minor and a 2 px tick. Cairo's DOTS branch clamps after
   * the doubling and would give 1.5 there; we follow OpenGL, which is what a
   * live pl_editor runs.
   */
  it('doubles the CLAMPED minor, as the OpenGL backend does', () => {
    expect(gridPenWidths(0.5, 1)).toEqual({ minor: 1, major: 2 });
    expect(gridPenWidths(0.3, 1)).toEqual({ minor: 1, major: 2 });
  });

  it('carries GAL’s own 0.25, so a default pen is 1.25 px and a tick 2.5', () => {
    // `grid.line_width` defaults to 1.0 (app_settings.cpp:549-550) and
    // `m_gridLineWidth = m_scaleFactor * that + 0.25`.
    expect(gridPenWidths(1, 1)).toStrictEqual({ minor: 1.25, major: 2.5 });
  });
});

describe('the grid dot is a whole number of device pixels', () => {
  /**
   * MEASURED against the installed KiCad 10.0.5 on this machine: a live
   * pl_editor at the default `grid.line_width` of 1.0 was captured and its
   * canvas held exactly two colours — background and rgb(194,194,194) — with
   * no anti-aliased pixel anywhere. A minor mark was 1x1; a mark on a tick
   * column was 3 wide and 1 tall; one on a tick row 1 wide and 3 tall. Tick
   * columns were 955 px apart against a 95.5 px node pitch, i.e. every tenth,
   * which is `SetCoarseGrid( 10 )`.
   *
   * The expectations below are those measured pixel counts, not what our code
   * prints.
   */
  it('lights one pixel for a 1.25 px mark and three for a 2.5 px tick', () => {
    expect(gridDotSize(1.25)).toBe(1);
    expect(gridDotSize(2.5)).toBe(3);
  });

  /** A pixel is lit when its centre is in `[-w/2, w/2)`, so an even width is even. */
  it('follows the pixel-centre rule for the other widths the panel offers', () => {
    expect(gridDotSize(1)).toBe(1);
    expect(gridDotSize(2)).toBe(2);
    expect(gridDotSize(4.5)).toBe(5); // a 2x display's tick
    expect(gridDotSize(2.25)).toBe(3); // a 2x display's minor
  });

  it('is always a whole number', () => {
    for (const w of [1, 1.25, 1.75, 2, 2.5, 3.25, 4.5, 10.25])
      expect(Number.isInteger(gridDotSize(w))).toBe(true);
  });

  it('puts a mark’s edges on whole pixels, which is why KiCad’s are sharp', () => {
    // roundp for an odd width is floor(x + 0.5) + 0.5, and drawGridPoint then
    // offsets by -floor(sw/2) - 0.5. Net: the left edge is an integer.
    // A 1.25 px minor mark: floor(1.25 / 2) is 0, so the edge is the snapped
    // position itself and the mark paints that one pixel.
    expect(gridDotEdge(10.3, 1.25)).toBe(10);
    expect(gridDotEdge(10.7, 1.25)).toBe(11);
    // A 2.5 px tick: floor(2.5 / 2) is 1, so it extends one pixel left — and
    // `gridDotSize` makes it three wide, so it reaches one pixel right too.
    expect(gridDotEdge(10.3, 2.5)).toBe(9);
    expect(gridDotEdge(10.3, 2.5) + gridDotSize(2.5)).toBe(12);
    // Whatever the fraction, the edge is an integer — that is the point.
    expect(Number.isInteger(gridDotEdge(7.49, 1.25))).toBe(true);
    expect(Number.isInteger(gridDotEdge(7.51, 2.5))).toBe(true);
  });

  /** The tick mark is centred on the same pixel as a minor one would be. */
  it('grows a tick symmetrically about the pixel a minor mark would light', () => {
    for (const x of [10.1, 10.4, 10.5, 10.9, 37.0]) {
      const minor = gridDotEdge(x, 1.25);
      expect(gridDotSize(1.25)).toBe(1);
      expect(gridDotEdge(x, 2.5)).toBe(minor - 1);
      expect(gridDotEdge(x, 2.5) + gridDotSize(2.5)).toBe(minor + 2);
    }
  });
});

describe('crosshairSegments — blitCursor', () => {
  const at = { x: 300, y: 200 };

  it('draws the small cross 80 logical px across, centred on the cursor', () => {
    const segs = crosshairSegments('small', at, 800, 600, 1);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ x1: 260, y1: 200, x2: 340, y2: 200 });
    expect(segs[1]).toEqual({ x1: 300, y1: 160, x2: 300, y2: 240 });
    expect(segs[0]!.x2 - segs[0]!.x1).toBe(SMALL_CROSS_PX);
  });

  it('scales the small cross by the device pixel ratio', () => {
    // m_screenSize is the client size in logical px (draw_panel_gal.cpp:459),
    // so 80 of them is 160 device px on a 2x display.
    const segs = crosshairSegments('small', at, 800, 600, 2);
    expect(segs[0]!.x2 - segs[0]!.x1).toBe(SMALL_CROSS_PX * 2);
  });

  it('spans the whole window in FULLSCREEN_CROSS', () => {
    const segs = crosshairSegments('full', at, 800, 600, 1);
    expect(segs[0]).toEqual({ x1: 0, y1: 200, x2: 800, y2: 200 });
    expect(segs[1]).toEqual({ x1: 300, y1: 0, x2: 300, y2: 600 });
  });

  it('draws two 45-degree diagonals through the cursor in FULLSCREEN_DIAGONAL', () => {
    const segs = crosshairSegments('45', at, 800, 600, 1);
    expect(segs).toHaveLength(2);
    for (const s of segs) {
      // Exactly 45 degrees, and passing through the cursor.
      expect(Math.abs(s.x2 - s.x1)).toBe(Math.abs(s.y2 - s.y1));
      const t = (at.x - s.x1) / (s.x2 - s.x1);
      expect(s.y1 + t * (s.y2 - s.y1)).toBeCloseTo(at.y, 9);
    }
    // "Oversized but that's ok": longer than the window's diagonal, so the
    // clip, not the length, decides where it ends.
    expect(Math.abs(segs[0]!.x2 - segs[0]!.x1)).toBeGreaterThan(800);
  });
});

describe('cursorAlphaFactor — IsCursorEnabled + getCursorColor', () => {
  it('draws nothing when neither the tool nor the preference asks for it', () => {
    expect(cursorAlphaFactor(false, false)).toBeNull();
  });

  it('draws at full alpha when the active tool asked for a cursor', () => {
    expect(cursorAlphaFactor(true, false)).toBe(1);
    expect(cursorAlphaFactor(true, true)).toBe(1);
  });

  it('dims a cursor that is only on because it was forced', () => {
    // "dim the cursor if it's only on because it was forced (this helps to
    // provide a hint for active tools)" - graphics_abstraction_layer.cpp:262.
    expect(cursorAlphaFactor(false, true)).toBe(0.5);
  });

  it('multiplies the layer colour alpha rather than replacing it', () => {
    expect(dimmedCursorColor('rgba(255, 255, 255, 0.8)', 0.5)).toBe('rgba(255, 255, 255, 0.4)');
    expect(dimmedCursorColor('rgb(255, 255, 255)', 1)).toBe('rgb(255, 255, 255)');
  });
});

describe('GridView transform', () => {
  const v = { scale: 2, tx: 100, ty: 50 };

  it('round-trips a plain scale + translate', () => {
    expect(worldToDeviceX(v, 10)).toBe(120);
    expect(deviceToWorldX(v, 120)).toBe(10);
    expect(worldToDeviceY(v, 10)).toBe(70);
    expect(deviceToWorldY(v, 70)).toBe(10);
  });

  it('mirrors X for pcbnew flip-board and Y for gerbview', () => {
    const fx = { ...v, flipX: true };
    expect(worldToDeviceX(fx, 10)).toBe(80);
    expect(deviceToWorldX(fx, 80)).toBe(10);
    const fy = { ...v, flipY: true };
    expect(worldToDeviceY(fy, 10)).toBe(30);
    expect(deviceToWorldY(fy, 30)).toBe(10);
  });
});
