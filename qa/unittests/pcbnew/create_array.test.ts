// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Create Array on the board.
 * Counterparts: `ARRAY_TOOL::CreateArray` and `ARRAY_CREATOR`.
 *
 * The placement maths is covered in qa/unittests/common/array_options.test.ts;
 * what is tested here is that the board ends up with the right *set* of
 * positions — including the original's, which is an array item like any other
 * and moves when position 0's transform is not the identity.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { arraySize, createArray } from '@ziroeda/pcbnew/src/create_array.js';
import type { Board, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const via = (x: number, y: number): PcbVia => ({
  at: { x: MM(x), y: MM(y) },
  size: MM(0.8),
  drill: MM(0.4),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 0,
  source: EMPTY,
});

const board = (vias: PcbVia[]): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias,
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  groups: [],
  source: EMPTY,
});

/** Every via position, sorted, so the *set* can be compared without order. */
const positions = (b: Board): string[] =>
  b.vias
    .map((v) => `${Math.round(v.at.x / 1000)},${Math.round(v.at.y / 1000)}`)
    .sort((a, z) => a.localeCompare(z));

describe('array size', () => {
  it('is nx times ny for a grid', () => {
    expect(arraySize({ kind: 'grid', options: { nx: 3, ny: 4, delta: { x: 1, y: 1 } } })).toBe(12);
  });

  it('is the point count for a circle', () => {
    expect(arraySize({ kind: 'circular', options: { nPts: 6, centre: { x: 0, y: 0 } } })).toBe(6);
  });
});

describe('a grid array on the board', () => {
  const spec = (over = {}) => ({
    kind: 'grid' as const,
    options: { nx: 3, ny: 2, delta: { x: MM(10), y: MM(5) }, ...over },
  });

  it('leaves nx*ny items in total', () => {
    const out = createArray(board([via(0, 0)]), ['via:0'], spec());

    expect(out.added).toBe(5);
    expect(out.board.vias).toHaveLength(6);
  });

  it('puts them on the pitch', () => {
    const out = createArray(board([via(0, 0)]), ['via:0'], spec());

    expect(positions(out.board)).toEqual(
      ['0,0', '10000,0', '20000,0', '0,5000', '10000,5000', '20000,5000'].sort((a, z) =>
        a.localeCompare(z),
      ),
    );
  });

  it('leaves the original where it was for a plain grid', () => {
    // Position 0's transform is the identity here, so nothing should move.
    const out = createArray(board([via(0, 0)]), ['via:0'], spec());

    expect(out.board.vias[0]!.at).toEqual({ x: 0, y: 0 });
  });

  it('moves the original too when the array is centred', () => {
    // The original is an array item, not the thing the array is built around.
    // Extent is 2*10 by 1*5, so everything shifts back by (10, 2.5) and the
    // original lands at (-10, -2.5) rather than staying put.
    const out = createArray(board([via(0, 0)]), ['via:0'], spec({ centred: true }));

    expect(out.board.vias[0]!.at).toEqual({ x: MM(-10), y: MM(-2.5) });
  });

  it('centres the whole set on where the original was', () => {
    const out = createArray(board([via(0, 0)]), ['via:0'], spec({ centred: true }));
    const xs = out.board.vias.map((v) => v.at.x);
    const ys = out.board.vias.map((v) => v.at.y);

    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(0);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(0);
  });

  it('carries a multi-item selection as a block', () => {
    const out = createArray(board([via(0, 0), via(1, 0)]), ['via:0', 'via:1'], spec({ ny: 1 }));

    // Three copies of a two-via block.
    expect(out.board.vias).toHaveLength(6);
  });

  it('adds nothing for an array of one', () => {
    // Position 0 is the identity for a plain grid, so nothing moves either.
    const b = board([via(0, 0)]);
    const out = createArray(b, ['via:0'], spec({ nx: 1, ny: 1 }));

    expect(out.added).toBe(0);
    expect(out.board).toBe(b);
  });

  it('does nothing with an empty selection', () => {
    const b = board([via(0, 0)]);

    expect(createArray(b, [], spec()).board).toBe(b);
  });
});

describe('a circular array on the board', () => {
  it('spaces the points evenly round the centre', () => {
    // Four vias at 10 mm radius, a quarter turn apart.
    const out = createArray(board([via(10, 0)]), ['via:0'], {
      kind: 'circular',
      options: { nPts: 4, centre: { x: 0, y: 0 } },
    });

    expect(out.board.vias).toHaveLength(4);
    for (const v of out.board.vias) {
      expect(Math.hypot(v.at.x, v.at.y) / MM(10)).toBeCloseTo(1, 3);
    }
  });

  it('puts them at the expected quarter-turn positions', () => {
    const out = createArray(board([via(10, 0)]), ['via:0'], {
      kind: 'circular',
      options: { nPts: 4, centre: { x: 0, y: 0 } },
    });

    expect(positions(out.board)).toEqual(
      ['10000,0', '0,-10000', '-10000,0', '0,10000'].sort((a, z) => a.localeCompare(z)),
    );
  });

  it('turns the whole ring when an angle offset is given', () => {
    // Position 0 is no longer the identity, so nothing stays where it started.
    // The offset is 45°, not 90°: a square turned by a quarter is the same four
    // points, so a right angle here would prove nothing.
    const out = createArray(board([via(10, 0)]), ['via:0'], {
      kind: 'circular',
      options: { nPts: 4, centre: { x: 0, y: 0 }, angleOffset: 45 },
    });

    expect(positions(out.board)).not.toContain('10000,0');
    for (const v of out.board.vias) {
      expect(Math.hypot(v.at.x, v.at.y) / MM(10)).toBeCloseTo(1, 3);
    }
  });

  it('goes the other way when clockwise', () => {
    // A fan, not a full ring: three points evenly round a circle land on the
    // same set whichever way they are walked, so only an incomplete sweep can
    // tell the two directions apart.
    const ccw = createArray(board([via(10, 0)]), ['via:0'], {
      kind: 'circular',
      options: { nPts: 3, angle: 30, centre: { x: 0, y: 0 } },
    });
    const cw = createArray(board([via(10, 0)]), ['via:0'], {
      kind: 'circular',
      options: { nPts: 3, angle: 30, centre: { x: 0, y: 0 }, clockwise: true },
    });

    expect(positions(ccw.board)).not.toEqual(positions(cw.board));
  });

  it('still moves a single-point array that has an angle offset', () => {
    // An array of one is not a no-op: upstream applies position 0's transform
    // whatever the size, so the lone item swings round the centre.
    const out = createArray(board([via(10, 0)]), ['via:0'], {
      kind: 'circular',
      options: { nPts: 1, centre: { x: 0, y: 0 }, angleOffset: 90 },
    });

    expect(out.added).toBe(0);
    expect(out.board.vias[0]!.at).toEqual({ x: 0, y: MM(-10) });
  });

  it('refuses a zero-point array rather than dividing by zero', () => {
    const b = board([via(10, 0)]);

    expect(
      createArray(b, ['via:0'], { kind: 'circular', options: { nPts: 0, centre: { x: 0, y: 0 } } })
        .board,
    ).toBe(b);
  });

  it('turns each copy about its own place, not about the array centre', () => {
    // Needs an asymmetric block: a lone via looks the same however it is
    // turned, so it cannot tell the two rotation centres apart. Two vias 2 mm
    // apart, arrayed round a circle of radius 20 with each copy turned to
    // follow the sweep.
    const out = createArray(board([via(20, -1), via(20, 1)]), ['via:0', 'via:1'], {
      kind: 'circular',
      options: { nPts: 4, centre: { x: 0, y: 0 }, rotateItems: true },
    });

    expect(out.board.vias).toHaveLength(8);

    // Each pair's midpoint must still sit on the circle. Turning about the
    // array centre a second time would fling them off it.
    for (let i = 0; i < 8; i += 2) {
      const mx = (out.board.vias[i]!.at.x + out.board.vias[i + 1]!.at.x) / 2;
      const my = (out.board.vias[i]!.at.y + out.board.vias[i + 1]!.at.y) / 2;
      expect(Math.hypot(mx, my) / MM(20)).toBeCloseTo(1, 3);
    }

    // …and each pair is still 2 mm apart: a rotation is not a stretch.
    for (let i = 0; i < 8; i += 2) {
      const d = Math.hypot(
        out.board.vias[i]!.at.x - out.board.vias[i + 1]!.at.x,
        out.board.vias[i]!.at.y - out.board.vias[i + 1]!.at.y,
      );
      expect(d / MM(2)).toBeCloseTo(1, 3);
    }

    // The part that needs the rotation to have happened at all: the original
    // pair lies along y, so a copy a quarter turn round must lie along x. The
    // two checks above hold whether or not the copies were turned.
    const quarter = [0, 2, 4, 6].find((i) => {
      const my = (out.board.vias[i]!.at.y + out.board.vias[i + 1]!.at.y) / 2;
      const mx = (out.board.vias[i]!.at.x + out.board.vias[i + 1]!.at.x) / 2;
      return Math.abs(mx) < MM(0.5) && my < 0;
    })!;

    expect(quarter).toBeDefined();
    const dx = Math.abs(out.board.vias[quarter]!.at.x - out.board.vias[quarter + 1]!.at.x);
    const dy = Math.abs(out.board.vias[quarter]!.at.y - out.board.vias[quarter + 1]!.at.y);
    expect(dx).toBeGreaterThan(dy);
  });

  it('steps by a given angle rather than dividing a full turn', () => {
    // Three points 30° apart is a fan, not a triangle: they do not close.
    const out = createArray(board([via(10, 0)]), ['via:0'], {
      kind: 'circular',
      options: { nPts: 3, angle: 30, centre: { x: 0, y: 0 } },
    });
    const xs = out.board.vias.map((v) => v.at.x);

    // All three still on the same side, which an evenly-divided turn would not be.
    expect(Math.min(...xs)).toBeGreaterThan(0);
  });
});
