// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Distributing items evenly.
 * Counterparts: `libs/kimath/src/geometry/distribute.cpp` and
 * `ALIGN_DISTRIBUTE_TOOL::doDistributeGaps` / `doDistributeCenters`.
 *
 * By *gaps* and by *centres* are genuinely different operations, not two
 * spellings of one. Equal gaps leave items of different sizes unevenly spaced;
 * equal centres leave them unevenly separated. They agree whenever the two
 * *end* items are the same size — whatever the middle looks like — so the
 * fixture below deliberately gives them different widths. A fixture without
 * that passes under either algorithm and proves nothing; mine did, until the
 * divergence test caught it.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  deltasForDistributeByGaps,
  deltasForDistributeByPoints,
} from '@ziroeda/kimath/src/geometry/distribute.js';
import { distributeBoardItems } from '@ziroeda/pcbnew/src/distribute_items.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** A filled rectangle from (x0,y0) to (x1,y1) — a bbox we can predict. */
const rect = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'rect',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: 0,
  fill: true,
  layer: 'F.SilkS',
  source: EMPTY,
});

const board = (shapes: PcbShape[]): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes,
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  groups: [],
  source: EMPTY,
});

const xs = (b: Board): number[] => b.shapes.map((s) => s.start!.x);

describe('the maths', () => {
  it('leaves fewer than three items alone', () => {
    expect(deltasForDistributeByGaps([[0, 10]])).toEqual([0]);
    expect(
      deltasForDistributeByGaps([
        [0, 10],
        [20, 30],
      ]),
    ).toEqual([0, 0]);
    expect(deltasForDistributeByPoints([0, 100])).toEqual([0, 0]);
  });

  it('never moves the first or last item', () => {
    const d = deltasForDistributeByGaps([
      [0, 10],
      [15, 40],
      [90, 100],
    ]);

    expect(d[0]).toBe(0);
    expect(d[d.length - 1]).toBe(0);
  });

  it('equalises gaps, not positions', () => {
    // Spans 0-10, 15-40 (25 wide), 90-100. Space between inner edges is
    // 90-10 = 80, less the 25 the middle item occupies: 55 of gap over two
    // gaps, so 27.5 each. The middle item starts at 10 + 27.5 → 38 (rounded).
    const d = deltasForDistributeByGaps([
      [0, 10],
      [15, 40],
      [90, 100],
    ]);

    expect(15 + d[1]!).toBe(38);
  });

  it('equalises points regardless of size', () => {
    const d = deltasForDistributeByPoints([0, 10, 100]);

    // Midpoint of 0 and 100 is 50, so the middle point moves from 10 to 50.
    expect(10 + d[1]!).toBe(50);
  });

  it('does not stack rounding error across a long row', () => {
    // Ten points over a span that does not divide evenly: the last moved
    // point must still land where the exact arithmetic puts it.
    const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1000];
    const d = deltasForDistributeByPoints(positions);
    const moved = positions.map((p, i) => p + d[i]!);

    expect(moved[8]).toBe(Math.round((8 * 1000) / 9));
  });
});

describe('on a board', () => {
  // The two algorithms only diverge when the *end* items differ in size —
  // with equal ends they agree whatever the middle looks like, which is how a
  // fixture can pass under either and prove nothing. Here the left end is
  // 20 wide and the right 10.
  const three = (): PcbShape[] => [rect(0, 0, 20, 5), rect(30, 0, 40, 5), rect(90, 0, 100, 5)];

  it('does nothing with fewer than three items', () => {
    const b = board(three());
    const out = distributeBoardItems(b, ['shape:0', 'shape:1'], 'horizontallyGaps');

    expect(xs(out)).toEqual(xs(b));
  });

  it('moves only the middle item', () => {
    const b = board(three());
    const out = distributeBoardItems(b, ['shape:0', 'shape:1', 'shape:2'], 'horizontallyGaps');

    expect(out.shapes[0]!.start!.x).toBe(b.shapes[0]!.start!.x);
    expect(out.shapes[2]!.start!.x).toBe(b.shapes[2]!.start!.x);
    expect(out.shapes[1]!.start!.x).not.toBe(b.shapes[1]!.start!.x);
  });

  it('gaps and centres give different answers for differing sizes', () => {
    const gaps = distributeBoardItems(
      board(three()),
      ['shape:0', 'shape:1', 'shape:2'],
      'horizontallyGaps',
    );
    const centres = distributeBoardItems(
      board(three()),
      ['shape:0', 'shape:1', 'shape:2'],
      'horizontallyCenters',
    );

    expect(gaps.shapes[1]!.start!.x).not.toBe(centres.shapes[1]!.start!.x);
  });

  it('equalises the gaps when asked for gaps', () => {
    const out = distributeBoardItems(
      board(three()),
      ['shape:0', 'shape:1', 'shape:2'],
      'horizontallyGaps',
    );
    const s = out.shapes;
    const gapA = s[1]!.start!.x - s[0]!.end!.x;
    const gapB = s[2]!.start!.x - s[1]!.end!.x;

    expect(Math.abs(gapA - gapB)).toBeLessThanOrEqual(1);
  });

  it('equalises the centres when asked for centres', () => {
    const out = distributeBoardItems(
      board(three()),
      ['shape:0', 'shape:1', 'shape:2'],
      'horizontallyCenters',
    );
    const mid = (s: PcbShape): number => (s.start!.x + s.end!.x) / 2;
    const c = out.shapes.map(mid);

    expect(Math.abs(c[1]! - c[0]! - (c[2]! - c[1]!))).toBeLessThanOrEqual(1);
  });

  it('works on the vertical axis too', () => {
    const b = board([rect(0, 0, 5, 10), rect(0, 15, 5, 40), rect(0, 90, 5, 100)]);
    const out = distributeBoardItems(b, ['shape:0', 'shape:1', 'shape:2'], 'verticallyGaps');

    expect(out.shapes[1]!.start!.y).not.toBe(b.shapes[1]!.start!.y);
    // …and leaves x alone.
    expect(out.shapes[1]!.start!.x).toBe(b.shapes[1]!.start!.x);
  });

  it('does not depend on the order the selection is given in', () => {
    const forwards = distributeBoardItems(
      board(three()),
      ['shape:0', 'shape:1', 'shape:2'],
      'horizontallyGaps',
    );
    const backwards = distributeBoardItems(
      board(three()),
      ['shape:2', 'shape:1', 'shape:0'],
      'horizontallyGaps',
    );

    expect(xs(forwards)).toEqual(xs(backwards));
  });

  it('is idempotent', () => {
    // The end items never move, so running it twice must change nothing the
    // second time.
    const once = distributeBoardItems(
      board(three()),
      ['shape:0', 'shape:1', 'shape:2'],
      'horizontallyGaps',
    );
    const twice = distributeBoardItems(once, ['shape:0', 'shape:1', 'shape:2'], 'horizontallyGaps');

    expect(xs(twice)).toEqual(xs(once));
  });

  it('ignores ids that resolve to nothing', () => {
    const b = board(three());
    const out = distributeBoardItems(
      b,
      ['shape:0', 'shape:1', 'shape:2', 'shape:99'],
      'horizontallyGaps',
    );

    expect(out.shapes[1]!.start!.x).not.toBe(b.shapes[1]!.start!.x);
  });
});
