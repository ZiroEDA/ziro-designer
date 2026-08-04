// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fillet / chamfer / extend applied to a selection.
 * Counterparts: `EDIT_TOOL::ModifyLines` and `PAIRWISE_LINE_ROUTINE`.
 *
 * The maths is covered in qa/unittests/kimath/corner_operations.test.ts; what
 * is tested here is the driving: which pairs are tried, that a line taking part
 * in two corners is shortened by both, and that consumed lines are deleted
 * rather than left as zero-length items.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { modifiableLineCount, modifyLines } from '@ziroeda/pcbnew/src/modify_lines.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const line = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.15),
  fill: false,
  layer: 'Edge.Cuts',
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
  ...{},
});

/** An L: two lines meeting at (100, 0). */
const elbow = (): PcbShape[] => [line(0, 0, 100, 0), line(100, 0, 100, 100)];

/** A closed square drawn as four lines, corners at every turn. */
const square = (): PcbShape[] => [
  line(0, 0, 100, 0),
  line(100, 0, 100, 100),
  line(100, 100, 0, 100),
  line(0, 100, 0, 0),
];

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `shape:${i}`);

describe('what counts as a modifiable line', () => {
  it('counts straight graphics', () => {
    expect(modifiableLineCount(board(elbow()), ids(2))).toBe(2);
  });

  it('ignores anything that is not a straight line', () => {
    const b = board([
      line(0, 0, 100, 0),
      {
        kind: 'rect',
        start: { x: 0, y: 0 },
        end: { x: MM(5), y: MM(5) },
        width: 0,
        fill: true,
        layer: 'F.SilkS',
        source: EMPTY,
      },
    ]);

    expect(modifiableLineCount(b, ids(2))).toBe(1);
  });

  it('ignores a zero-length line, which forms no corner', () => {
    expect(modifiableLineCount(board([line(0, 0, 100, 0), line(5, 5, 5, 5)]), ids(2))).toBe(1);
  });
});

describe('filleting a selection', () => {
  it('replaces the corner with an arc', () => {
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'fillet', { radius: MM(20) });

    expect(out.successes).toBe(1);
    expect(out.board.shapes.filter((s) => s.kind === 'arc')).toHaveLength(1);
    expect(out.board.shapes.filter((s) => s.kind === 'line')).toHaveLength(2);
  });

  it('gives the arc the stroke and layer of the lines it came from', () => {
    const b = board(elbow());
    const arc = modifyLines(b, ids(2), 'fillet', { radius: MM(20) }).board.shapes.find(
      (s) => s.kind === 'arc',
    )!;

    expect(arc.width).toBe(MM(0.15));
    expect(arc.layer).toBe('Edge.Cuts');
    expect(arc.fill).toBe(false);
  });

  it('rounds all four corners of a square in one go', () => {
    // Every unordered pair is tried, so the user need not select in drawing
    // order — and each line takes part in two corners, so it must be shortened
    // by both rather than by whichever came last.
    const b = board(square());
    const out = modifyLines(b, ids(4), 'fillet', { radius: MM(20) });

    expect(out.successes).toBe(4);
    expect(out.board.shapes.filter((s) => s.kind === 'arc')).toHaveLength(4);

    for (const s of out.board.shapes.filter((s) => s.kind === 'line')) {
      const len = Math.hypot(s.end!.x - s.start!.x, s.end!.y - s.start!.y);
      // 100 mm less 20 mm off each end.
      expect(len / MM(60)).toBeCloseTo(1, 3);
    }
  });

  it('counts a corner it cannot round as a failure', () => {
    // They meet, and the radius will not fit: that is a failure the status line
    // should mention, unlike a pair that never met.
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'fillet', { radius: MM(500) });

    expect(out.successes).toBe(0);
    expect(out.failures).toBe(1);
    expect(out.board).toBe(b);
  });

  it('does not count lines that never met as failures', () => {
    // Most pairs in a real selection do not share a corner; calling each of
    // those a failure would make the status line meaningless.
    const b = board([line(0, 0, 100, 0), line(200, 50, 300, 50)]);
    const out = modifyLines(b, ids(2), 'fillet', { radius: MM(10) });

    expect(out.failures).toBe(0);
    expect(out.successes).toBe(0);
  });

  it('does nothing with fewer than two lines', () => {
    const b = board([line(0, 0, 100, 0)]);

    expect(modifyLines(b, ids(1), 'fillet', { radius: MM(10) }).board).toBe(b);
  });
});

describe('chamfering a selection', () => {
  it('replaces the corner with a straight cut', () => {
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'chamfer', { setback: MM(20) });

    expect(out.successes).toBe(1);
    // Three lines now: the two shortened originals and the chamfer.
    expect(out.board.shapes).toHaveLength(3);
    expect(out.board.shapes.every((s) => s.kind === 'line')).toBe(true);
  });

  it('puts the cut between the two set-back points', () => {
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'chamfer', { setback: MM(20) });
    const added = out.board.shapes[out.board.shapes.length - 1]!;

    expect(added.start).toEqual({ x: MM(80), y: 0 });
    expect(added.end).toEqual({ x: MM(100), y: MM(20) });
  });

  it('deletes a line the chamfer consumes entirely', () => {
    // A set-back reaching the far end leaves nothing; upstream deletes rather
    // than keeping a zero-length item.
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'chamfer', { setback: MM(100) });

    expect(out.successes).toBe(1);
    // Both originals consumed, one chamfer added.
    expect(out.board.shapes).toHaveLength(1);
  });
});

describe('dogboning a selection', () => {
  it('replaces the corner with a pocket arc', () => {
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'dogbone', { dogboneRadius: MM(5) });

    expect(out.successes).toBe(1);
    expect(out.board.shapes.filter((s) => s.kind === 'arc')).toHaveLength(1);
  });

  it('runs the pocket through the original corner', () => {
    // The deepest point is the corner itself, which is what lets a mating
    // sharp corner still seat.
    const b = board(elbow());
    const arc = modifyLines(b, ids(2), 'dogbone', { dogboneRadius: MM(5) }).board.shapes.find(
      (s) => s.kind === 'arc',
    )!;

    expect(arc.mid).toEqual({ x: MM(100), y: 0 });
  });

  it('counts a corner it cannot pocket as a failure', () => {
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'dogbone', { dogboneRadius: MM(500) });

    expect(out.successes).toBe(0);
    expect(out.failures).toBe(1);
  });

  it('shortens both arms back to the pocket', () => {
    const b = board(elbow());
    const out = modifyLines(b, ids(2), 'dogbone', { dogboneRadius: MM(5) });

    for (const s of out.board.shapes.filter((s) => s.kind === 'line')) {
      const len = Math.hypot(s.end!.x - s.start!.x, s.end!.y - s.start!.y);
      expect(len).toBeLessThan(MM(100));
    }
  });
});

describe('extending a selection', () => {
  it('grows both lines until they meet', () => {
    const b = board([line(0, 0, 50, 0), line(100, 20, 100, 80)]);
    const out = modifyLines(b, ids(2), 'extend');

    expect(out.successes).toBe(1);
    expect(out.board.shapes).toHaveLength(2); // nothing added
    expect(out.board.shapes[0]!.end).toEqual({ x: MM(100), y: 0 });
    expect(out.board.shapes[1]!.end).toEqual({ x: MM(100), y: 0 });
  });

  it('leaves lines that already cross alone', () => {
    const b = board([line(0, 0, 100, 0), line(50, -5, 50, 5)]);
    const out = modifyLines(b, ids(2), 'extend');

    expect(out.successes).toBe(0);
    expect(out.board).toBe(b);
  });

  it('adds nothing, unlike fillet and chamfer', () => {
    const b = board([line(0, 0, 50, 0), line(100, 20, 100, 80)]);
    const out = modifyLines(b, ids(2), 'extend');

    expect(out.board.shapes).toHaveLength(b.shapes.length);
  });

  it('is stable when run twice', () => {
    const b = board([line(0, 0, 50, 0), line(100, 20, 100, 80)]);
    const once = modifyLines(b, ids(2), 'extend').board;
    const twice = modifyLines(once, ids(2), 'extend');

    expect(twice.successes).toBe(0);
    expect(twice.board).toBe(once);
  });
});

describe('the source node', () => {
  it('is dropped from a shortened line so the writer rebuilds it', () => {
    // The parsed node still describes the old endpoints. Keeping it would write
    // the original geometry back out and lose the fillet on reload.
    const b = board(elbow());
    b.shapes[0] = {
      ...b.shapes[0]!,
      source: { kind: 'list', items: [{ kind: 'atom', value: 'gr_line' }] },
    };
    const out = modifyLines(b, ids(2), 'fillet', { radius: MM(20) });
    const shortened = out.board.shapes.find((s) => s.kind === 'line' && s.start!.x === 0)!;

    expect(shortened.source.items).toEqual([]);
  });
});
