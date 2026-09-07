// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Lasso selection on a board — `PCB_SELECTION_TOOL::SelectMultiple`'s polygon
 * arm, and the `KIGEOM::ShapeHitTest` rules underneath it.
 *
 * The two modes are the behaviour, and they are chosen by the trace's WINDING
 * rather than by a modifier: clockwise is a window select, counter-clockwise is
 * greedy (`pcb_selection_tool.cpp:1384-1391`). The manual says the same thing
 * and adds the colours — "a lasso drawn in a clockwise direction will only
 * select items that are fully inside", drawn yellow.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { boardItemsInBox, boardItemsInLasso } from '@ziroeda/pcbnew/src/edit-board.js';
import { lassoIsInside } from '@ziroeda/common/src/preview_items/selection_area.js';
import {
  polyHitsBox,
  polyHitsPolygon,
  polyHitsSegment,
  pointInPolygon,
} from '@ziroeda/kimath/src/geometry/poly_hit_test.js';
import { pcbMmToIU as MM } from '@ziroeda/common/src/eda_units.js';

const board = () =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 10 50) (end 90 50) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 20 20) (end 30 20) (width 0.25) (layer "F.Cu") (net 1))
  (gr_line (start 200 200) (end 210 200) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))
)`),
  );

/** A closed square, clockwise in a y-down world. */
const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: MM(x0), y: MM(y0) },
  { x: MM(x1), y: MM(y0) },
  { x: MM(x1), y: MM(y1) },
  { x: MM(x0), y: MM(y1) },
];

describe('boardItemsInLasso', () => {
  it('takes a crossing track when greedy and leaves it when windowing', () => {
    // Track 0 runs 10..90 mm; the lasso covers 40..60, so it crosses.
    const b = board();
    const poly = square(40, 40, 60, 60);
    expect(boardItemsInLasso(b, poly, false)).toContain('track:0');
    expect(boardItemsInLasso(b, poly, true)).not.toContain('track:0');
  });

  it('takes a fully enclosed track in both modes', () => {
    // Track 1 runs 20..30 mm at y=20, well inside.
    const b = board();
    const poly = square(10, 10, 40, 40);
    expect(boardItemsInLasso(b, poly, false)).toContain('track:1');
    expect(boardItemsInLasso(b, poly, true)).toContain('track:1');
  });

  it('leaves everything alone outside the trace', () => {
    expect(boardItemsInLasso(board(), square(300, 300, 320, 320), false)).toEqual([]);
  });

  it('returns nothing for a degenerate trace', () => {
    const b = board();
    expect(boardItemsInLasso(b, [], false)).toEqual([]);
    expect(
      boardItemsInLasso(
        b,
        [
          { x: 0, y: 0 },
          { x: MM(10), y: 0 },
        ],
        false,
      ),
    ).toEqual([]);
  });

  it('agrees with the rectangle select for a rectangular trace', () => {
    // The reason the footprint and zone arms use the same bounding boxes the
    // box path does: the two gestures must not disagree about the same item.
    // A square lasso IS a rectangle select, so for every item the answers match.
    const b = board();
    for (const contained of [false, true]) {
      const rect = boardItemsInBox(b, MM(15), MM(15), MM(65), MM(65), contained).sort();
      const lasso = boardItemsInLasso(b, square(15, 15, 65, 65), contained).sort();
      expect(lasso).toEqual(rect);
    }
  });

  it('is driven by the winding, so the two directions select differently', () => {
    const b = board();
    const cw = square(40, 40, 60, 60);
    const ccw = [...cw].reverse();
    expect(lassoIsInside(cw)).toBe(true);
    expect(lassoIsInside(ccw)).toBe(false);
    expect(boardItemsInLasso(b, cw, lassoIsInside(cw))).not.toContain('track:0');
    expect(boardItemsInLasso(b, ccw, lassoIsInside(ccw))).toContain('track:0');
  });
});

describe('KIGEOM::ShapeHitTest, ported', () => {
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('contained is not just "every corner is inside"', () => {
    // `collidesAll() && !intersectsAny()`. A C-shaped lasso can hold all four
    // corners of a box in its region while its outline still runs through the
    // box; upstream rejects that and a corners-only test would not.
    const c = [
      { x: -5, y: -5 },
      { x: 15, y: -5 },
      { x: 15, y: 15 },
      { x: -5, y: 15 },
      { x: -5, y: 6 },
      { x: 5, y: 6 },
      { x: 5, y: 4 },
      { x: -5, y: 4 },
    ];
    expect(polyHitsBox(c, box, false)).toBe(true);
    expect(polyHitsBox(c, box, true)).toBe(false);
  });

  it('touches a box the lasso is drawn entirely inside', () => {
    // No corner of the box is in the lasso and no outline segment leaves it, so
    // the only thing that says "these overlap" is a lasso vertex in the box.
    const tiny = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ];
    expect(polyHitsBox(tiny, box, false)).toBe(true);
    expect(polyHitsBox(tiny, box, true)).toBe(false);
  });

  it('handles segments, rings and points', () => {
    const around = [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 },
    ];
    expect(polyHitsSegment(around, { x: 0, y: 0 }, { x: 10, y: 10 }, true)).toBe(true);
    expect(polyHitsSegment(around, { x: 0, y: 0 }, { x: 100, y: 0 }, true)).toBe(false);
    expect(polyHitsSegment(around, { x: 0, y: 0 }, { x: 100, y: 0 }, false)).toBe(true);

    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polyHitsPolygon(around, ring, true)).toBe(true);
    expect(
      polyHitsPolygon(
        [
          { x: 4, y: 4 },
          { x: 6, y: 4 },
          { x: 6, y: 6 },
        ],
        ring,
        false,
      ),
    ).toBe(true);

    expect(pointInPolygon(around, { x: 5, y: 5 })).toBe(true);
    expect(pointInPolygon(around, { x: 50, y: 5 })).toBe(false);
  });
});
