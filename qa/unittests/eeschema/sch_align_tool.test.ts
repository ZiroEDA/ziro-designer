// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Align to top / bottom / left / right / middle / centre (SCH_ALIGN_TOOL).
 *
 * The alignment itself is arithmetic; what is worth pinning is `selectTarget`'s
 * order of preference (cursor, then a locked item, then the outermost), that
 * locked items never move, and that a connectable item lands on the grid.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { alignItems } from '@ziroeda/eeschema/src/tools/sch_align_tool.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const mm = (v: number): number => mmToIU(v);
const LIBS = new Map();
/** 1.27 mm, KiCad's default schematic grid (50 mil). */
const GRID = mm(1.27);

// Schematic items sit on the 1.27 mm grid, so the fixture does too: an
// off-grid coordinate would be snapped by adjustDeltaForGrid and the numbers
// below would be testing the snap rather than the alignment.
const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  (junction (at 12.7 12.7) (uuid "j1"))
  (junction (at 25.4 25.4) (uuid "j2"))
  (junction (at 38.1 50.8) (uuid "j3"))
  (rectangle (start 63.5 12.7) (end 76.2 25.4) (uuid "r1"))
)`;

const sch = readSchematic(parse(DOC));
const J1 = refId('junction', 'j1', 0);
const J2 = refId('junction', 'j2', 1);
const J3 = refId('junction', 'j3', 2);
const RECT = refId('graphic', undefined, 0);
const ALL = new Set([J1, J2, J3]);

const run = (
  ids: Set<string>,
  mode: Parameters<typeof alignItems>[3],
  cursor?: { x: number; y: number },
) => alignItems(sch, ids, LIBS, mode, GRID, cursor)?.apply(sch) ?? sch;

describe('aligning', () => {
  it('brings everything to the topmost item', () => {
    const out = run(ALL, 'top');
    for (const j of out.junctions) expect(j.at.y).toBe(mm(12.7));
    // Only the axis being aligned moves.
    expect(out.junctions.map((j) => j.at.x)).toEqual([mm(12.7), mm(25.4), mm(38.1)]);
  });

  it('brings everything to the bottommost item', () => {
    for (const j of run(ALL, 'bottom').junctions) expect(j.at.y).toBe(mm(50.8));
  });

  it('aligns left and right on the x axis', () => {
    for (const j of run(ALL, 'left').junctions) expect(j.at.x).toBe(mm(12.7));
    for (const j of run(ALL, 'right').junctions) expect(j.at.x).toBe(mm(38.1));
  });

  it('aligns to the middle and centre of the outermost item', () => {
    // A junction's box is its point, so its centre is its position; the
    // outermost by centre is the smallest, which is j1.
    for (const j of run(ALL, 'centerX').junctions) expect(j.at.x).toBe(mm(12.7));
    for (const j of run(ALL, 'centerY').junctions) expect(j.at.y).toBe(mm(12.7));
  });

  it('does nothing for an empty or unalignable selection', () => {
    expect(alignItems(sch, new Set(), LIBS, 'top', GRID)).toBeNull();
    expect(alignItems(sch, new Set(['nope']), LIBS, 'top', GRID)).toBeNull();
  });

  it('does nothing when everything is already aligned', () => {
    // Every delta is zero, so there is no command rather than an empty one.
    expect(alignItems(sch, new Set([J1]), LIBS, 'top', GRID)).toBeNull();
  });
});

describe('choosing what to align to', () => {
  it('uses the item under the cursor', () => {
    // selectTarget prefers the item the cursor is over, so pointing at the
    // middle junction aligns the others to it rather than to the topmost.
    const out = run(ALL, 'top', { x: mm(25.4), y: mm(25.4) });
    for (const j of out.junctions) expect(j.at.y).toBe(mm(25.4));
  });

  it('falls back to the outermost when the cursor is over nothing', () => {
    const out = run(ALL, 'top', { x: mm(999), y: mm(999) });
    for (const j of out.junctions) expect(j.at.y).toBe(mm(12.7));
  });
});

describe('the grid', () => {
  it('lands a connectable item on the grid', () => {
    // The rectangle's top is at 12.7 mm, which is on grid; align the junctions
    // to it and they stay connectable.
    const out = run(new Set([J1, J3, RECT]), 'top');
    for (const j of out.junctions.slice(0, 1)) expect(j.at.y % GRID).toBe(0);
  });

  it('never leaves a connectable item off grid', () => {
    // A target that is not on the grid is snapped to it, because a junction
    // between grid points connects to nothing.
    // The rectangle is the topmost, so it is the target, and its top edge is
    // deliberately not a grid point.
    const offGrid = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (junction (at 12.7 25.4) (uuid "a"))
        (rectangle (start 50.8 11.1) (end 63.5 20.32) (uuid "r")))`),
    );
    const out = alignItems(
      offGrid,
      new Set([refId('junction', 'a', 0), refId('graphic', undefined, 0)]),
      LIBS,
      'top',
      GRID,
    )?.apply(offGrid);
    // 11.1 mm is not a grid point, so the junction lands on the nearest one
    // rather than on the rectangle's edge.
    expect(out!.junctions[0]!.at.y % GRID).toBe(0);
    expect(out!.junctions[0]!.at.y).not.toBe(mm(11.1));
  });

  it('leaves a graphic where the target is, on grid or not', () => {
    // Only connectable items snap; a shape has nothing to connect.
    const offGrid = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (rectangle (start 10 11.1) (end 20 20) (uuid "a"))
        (rectangle (start 50 30) (end 60 40) (uuid "b")))`),
    );
    const out = alignItems(
      offGrid,
      new Set([refId('graphic', undefined, 0), refId('graphic', undefined, 1)]),
      LIBS,
      'top',
      GRID,
    )!.apply(offGrid);
    const b = out.graphics[1] as { start: { y: number } };
    expect(b.start.y).toBe(mm(11.1));
  });
});
