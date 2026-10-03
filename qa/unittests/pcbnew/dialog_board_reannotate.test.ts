// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Geometric reannotation.
 * Counterparts: `DIALOG_BOARD_REANNOTATE` and
 * `BOARD_REANNOTATE_TOOL::ReannotateDuplicates`.
 *
 * The tests below are mostly about the things a careful reader would "fix":
 * a grid rounding that sends −700 to +1000, a scope radio that quietly cancels
 * the exclusion list, an unannotated footprint that comes out called `1`, and a
 * duplicates pass that never frees the designator it just vacated. Each of
 * those is upstream behaviour, and a board renumbered by KiCad and by us has to
 * come out the same.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REANNOTATE_OPTIONS,
  compareReannotateFootprints,
  filterReannotatePrefix,
  planBoardReannotate,
  reannotateDuplicates,
  reannotateSortCodes,
  roundToReannotateGrid,
} from '@ziroeda/pcbnew/dialogs/dialog_board_reannotate.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { parse } from '@ziroeda/sexpr/index.js';
import type { Board, PcbFootprint, PcbTextItem } from '@ziroeda/pcbnew/types.js';
import type { SList, SNode } from '@ziroeda/sexpr/types.js';

/** 1 mm in board IU (nanometres). */
const MM = 1_000_000;

interface FpSpec {
  ref: string;
  x?: number;
  y?: number;
  layer?: string;
  uuid?: string;
  locked?: boolean;
  /** Board-absolute position of the Reference text, when it differs from the anchor. */
  refAt?: { x: number; y: number };
}

const refText = (ref: string, at: { x: number; y: number }): PcbTextItem => ({
  kind: 'reference',
  text: ref,
  at,
  angle: 0,
  layer: 'F.SilkS',
  size: { x: MM, y: MM },
});

let uuidSeed = 0;

const fp = (spec: FpSpec): PcbFootprint => {
  const at = { x: spec.x ?? 0, y: spec.y ?? 0 };
  return {
    lib: 'Resistor_SMD:R_0603',
    at,
    angle: 0,
    layer: spec.layer ?? 'F.Cu',
    reference: spec.ref,
    locked: spec.locked,
    uuid: spec.uuid ?? `u${++uuidSeed}`,
    pads: [],
    shapes: [],
    texts: [refText(spec.ref, spec.refAt ?? at)],
    points: [],
    barcodes: [],
    models: [],
  };
};

const board = (specs: FpSpec[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints: specs.map(fp),
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  textBoxes: [],
  tables: [],
  images: [],
  dimensions: [],
  points: [],
  barcodes: [],
  groups: [],
});

/** The designators after a run, in board order. */
const refs = (b: Board): string[] => b.footprints.map((f) => f.reference ?? '');

// ---------------------------------------------------------------------------

describe('roundToReannotateGrid', () => {
  it('leaves a coordinate already on the grid alone', () => {
    // If this drifts, every footprint moves cell on a perfectly aligned board.
    expect(roundToReannotateGrid(2000, 1000)).toBe(2000);
    expect(roundToReannotateGrid(0, 1000)).toBe(0);
  });

  it('rounds by the remainder, not by the nearest multiple of the half grid', () => {
    // 200 of 1000 is not more than half, so it truncates down.
    expect(roundToReannotateGrid(1200, 1000)).toBe(1000);
    // 600 is, so it steps up.
    expect(roundToReannotateGrid(1600, 1000)).toBe(2000);
  });

  it('treats exactly half a step as "not more than half" and rounds towards zero', () => {
    // The comparison is `>`, not `>=`; a `>=` here would move every part that
    // sits exactly on a half-grid, which on a mils grid is a great many.
    expect(roundToReannotateGrid(1500, 1000)).toBe(1000);
    expect(roundToReannotateGrid(-1500, 1000)).toBe(-1000);
  });

  it('halves the grid with integer division', () => {
    // trunc(1001/2) is 500, so a remainder of 501 steps up but 500 does not.
    expect(roundToReannotateGrid(500, 1001)).toBe(0);
    expect(roundToReannotateGrid(1501, 1001)).toBe(1001);
    expect(roundToReannotateGrid(1502, 1001)).toBe(2002);
  });

  it('rounds a negative coordinate away from zero once it clears the origin', () => {
    expect(roundToReannotateGrid(-1200, 1000)).toBe(-1000);
    expect(roundToReannotateGrid(-1700, 1000)).toBe(-2000);
  });

  it("reproduces upstream's sign bug for a coordinate inside the first cell", () => {
    // RoundToGrid tests the sign of the *truncated* coordinate, which is 0
    // here, so the nudge goes positive: -700 becomes +1000, not -1000.
    // "Fixing" this would put us out of step with a board KiCad has sorted.
    expect(roundToReannotateGrid(-700, 1000)).toBe(1000);
    expect(roundToReannotateGrid(-999, 1000)).toBe(1000);
    // -500 does not clear the half step at all, so it lands on 0 either way.
    expect(roundToReannotateGrid(-500, 1000)).toBe(0);
  });

  it('falls back to MINGRID when handed a zero grid', () => {
    // A zero grid would otherwise divide by zero; upstream substitutes 1000 IU.
    expect(roundToReannotateGrid(1600, 0)).toBe(2000);
    expect(roundToReannotateGrid(400, 0)).toBe(0);
  });
});

describe('reannotateSortCodes', () => {
  const asBits = (c: {
    sortYFirst: boolean;
    descendingFirst: boolean;
    descendingSecond: boolean;
  }) => `${c.sortYFirst ? 1 : 0}${c.descendingFirst ? 1 : 0}${c.descendingSecond ? 1 : 0}`;

  it('pins FrontDirectionsArray', () => {
    // These eight codes are the entire direction feature; a transposed pair
    // renumbers a board in the wrong order and nothing else notices.
    const front = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => asBits(reannotateSortCodes(i, true)));
    expect(front).toEqual(['100', '101', '110', '111', '000', '001', '010', '011']);
  });

  it('pins BackDirectionsArray, which is not the front table negated', () => {
    // Only the horizontal axis mirrors, and it is the secondary axis for the
    // y-first half and the primary axis for the x-first half.
    const back = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => asBits(reannotateSortCodes(i, false)));
    expect(back).toEqual(['101', '100', '111', '110', '010', '011', '000', '001']);
  });

  it('clamps an out-of-range sort code to 0', () => {
    // Upstream does this when no radio button reads back as set.
    expect(asBits(reannotateSortCodes(8, true))).toBe('100');
    expect(asBits(reannotateSortCodes(-1, true))).toBe('100');
  });
});

describe('compareReannotateFootprints', () => {
  const cell = (x: number, y: number) => ({
    index: 0,
    uuid: undefined,
    front: true,
    refDesString: '',
    refDesPrefix: '',
    x,
    y,
    roundedX: x,
    roundedY: y,
    action: 'update' as const,
    fpid: '',
  });

  it('compares only the rounded coordinates', () => {
    // The raw x/y are carried for the report only. Comparing them would undo
    // the whole point of the grid snap.
    const a = { ...cell(0, 0), roundedX: 5000, roundedY: 0 };
    const b = { ...cell(9999, 0), roundedX: 0, roundedY: 0 };
    expect(compareReannotateFootprints(a, b, reannotateSortCodes(0, true))).toBeGreaterThan(0);
  });

  it('treats two footprints in the same cell as equal', () => {
    // Returning non-zero here would make the order depend on the comparator
    // rather than on the board's file order.
    expect(compareReannotateFootprints(cell(3, 4), cell(3, 4), reannotateSortCodes(0, true))).toBe(
      0,
    );
  });
});

describe('filterReannotatePrefix', () => {
  it('keeps an alphanumeric or VALIDPREFIX trailing character', () => {
    expect(filterReannotatePrefix('F_')).toBe('F_');
    expect(filterReannotatePrefix('F1')).toBe('F1');
    expect(filterReannotatePrefix('A/')).toBe('A/');
    expect(filterReannotatePrefix('A\\')).toBe('A\\');
  });

  it('drops a trailing character that is neither', () => {
    // Anything else would end up inside a designator and out of a netlist.
    expect(filterReannotatePrefix('F#')).toBe('F');
    expect(filterReannotatePrefix('F ')).toBe('F');
  });

  it('leaves an empty box alone', () => {
    expect(filterReannotatePrefix('')).toBe('');
  });
});

describe('planBoardReannotate: exclusions and scope', () => {
  it('leaves an excluded footprint out of the numbering entirely', () => {
    // An excluded entry still gets a change row, carrying its old designator,
    // which is what makes the duplicate scan able to see it.
    const b = board([{ ref: 'R4', x: 0, y: 0 }]);
    const plan = planBoardReannotate(b, { excludeList: 'R' });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]!.action).toBe('exclude');
    expect(plan.changes[0]!.newRefDes).toBe('R4');
  });
});

describe('planBoardReannotate: collisions', () => {
  it('gives up reporting after MAXERROR collisions', () => {
    // Six identical designators make fifteen colliding pairs; the scan stops
    // at the twelfth, when `errorcount++ > 10` first holds.
    const b = board([0, 1, 2, 3, 4, 5].map((i) => ({ ref: 'R4', x: 0, y: i * MM })));
    const out = planBoardReannotate(b, { excludeList: 'R' });
    expect(out.ok).toBe(false);
    expect(out.errors).toHaveLength(13);
    expect(out.errors[12]).toBe('Aborted: too many errors');
  });

  it('does not count an empty or invalid designator as a collision', () => {
    // Two unannotated footprints both carry "" into the change array, and
    // the scan skips them: `Action != EMPTY_REFDES && != INVALID_REFDES`.
    const b = board([
      { ref: '', x: 0, y: 0 },
      { ref: '', x: 0, y: 5 * MM },
    ]);
    const out = planBoardReannotate(b, {});
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });
});

describe('planBoardReannotate: the plan itself', () => {
  it('sorts the change rows into natural order on the old designator', () => {
    // ChangeArrayCompare uses StrNumCmp, so R2 comes before R10.
    const b = board([
      { ref: 'R10', x: 0, y: 0 },
      { ref: 'R2', x: 0, y: 5 * MM },
    ]);
    const plan = planBoardReannotate(b, {});
    expect(plan.changes.map((c) => c.oldRefDesString)).toEqual(['R2', 'R10']);
  });

  it('carries one row per footprint, whatever happened to it', () => {
    // ReannotateBoard walks every footprint and expects to find each one.
    const b = board([
      { ref: 'R1', x: 0, y: 0 },
      { ref: '', x: 0, y: 5 * MM },
      { ref: 'C1', x: 0, y: 10 * MM, locked: true },
    ]);
    const plan = planBoardReannotate(b, { excludeLocked: true });
    expect(plan.changes).toHaveLength(3);
    expect([...plan.changes].map((c) => c.action).sort()).toEqual(['empty', 'exclude', 'update']);
  });

  it('records the rounded coordinates the sorter actually used', () => {
    // The report prints "at X (rounded to Y)"; both must be the real values.
    const b = board([{ ref: 'R1', x: 1600, y: -700 }]);
    const plan = planBoardReannotate(b, { sortGridX: 1000, sortGridY: 1000 });
    expect(plan.front[0]).toMatchObject({ x: 1600, y: -700, roundedX: 2000, roundedY: 1000 });
  });
});

describe('reannotateDuplicates', () => {
  const dup = (
    specs: FpSpec[],
    selected: string[],
    additional?: { uuid: string; reference: string }[],
  ) => refs(reannotateDuplicates(board(specs), new Set(selected), additional));

  it('walks a duplicated designator up until it is free', () => {
    // R1 is taken and R2 is taken, so the pasted copy lands on R3.
    expect(
      dup(
        [
          { ref: 'R1', x: 0, y: 0, uuid: 'a' },
          { ref: 'R1', x: 0, y: MM, uuid: 'b' },
          { ref: 'R2', x: 0, y: 2 * MM, uuid: 'c' },
        ],
        ['b'],
      ),
    ).toEqual(['R1', 'R3', 'R2']);
  });

  it('leaves a designator that is already unique alone', () => {
    // The map holds only this footprint's own UUID, so `duplicate` never
    // becomes true and the loop breaks on the first pass.
    expect(dup([{ ref: 'R2', x: 0, y: 0, uuid: 'c' }], ['c'])).toEqual(['R2']);
  });

  it('never reuses a designator it has just vacated', () => {
    // The multimap is only ever inserted into, so R1 stays marked as taken
    // by all three even after two of them have moved off it — and nobody
    // ends up called R1. Reproduced deliberately.
    expect(
      dup(
        [
          { ref: 'R1', x: 0, y: 0, uuid: 'a' },
          { ref: 'R1', x: 0, y: MM, uuid: 'b' },
          { ref: 'R1', x: 0, y: 2 * MM, uuid: 'c' },
        ],
        ['a', 'b', 'c'],
      ),
    ).toEqual(['R4', 'R3', 'R2']);
  });

  it('orders the selection by descending y, so the bottom-most is renamed first', () => {
    // Equal designators fall through StrNumCmp to a position compare whose y
    // arm is `aA.y > aB.y`. Ascending y would hand out the numbers the other
    // way round.
    expect(
      dup(
        [
          { ref: 'R1', x: 0, y: 0, uuid: 'a' },
          { ref: 'R1', x: 0, y: 10 * MM, uuid: 'b' },
        ],
        ['a', 'b'],
      ),
    ).toEqual(['R3', 'R2']);
  });

  it('counts a not-yet-placed footprint as holding its designator', () => {
    // aAdditionalFootprints: the paste preview is not on the board yet but
    // its names are already spoken for.
    expect(
      dup([{ ref: 'R1', x: 0, y: 0, uuid: 'a' }], ['a'], [{ uuid: 'p', reference: 'R1' }]),
    ).toEqual(['R2']);
  });

  it('restarts an unannotated designator at 1', () => {
    // GetRefDesNumber returns -1 for "R?"; the loop maps that to 1 rather
    // than to 0.
    expect(
      dup(
        [
          { ref: 'R?', x: 0, y: 0, uuid: 'a' },
          { ref: 'R?', x: 0, y: MM, uuid: 'b' },
        ],
        ['b'],
      ),
    ).toEqual(['R?', 'R1']);
  });

  it('does nothing at all for an empty selection', () => {
    const b = board([{ ref: 'R1', x: 0, y: 0, uuid: 'a' }]);
    expect(reannotateDuplicates(b, new Set())).toBe(b);
  });
});

describe('DEFAULT_REANNOTATE_OPTIONS', () => {
  it('matches the dialog as it opens', () => {
    // A wrong default here silently changes what every caller does.
    expect(DEFAULT_REANNOTATE_OPTIONS).toMatchObject({
      sortCode: 0,
      scope: 'all',
      excludeLocked: false,
      useFootprintLocation: true,
      frontStart: 1,
      backStart: 0,
      frontPrefix: '',
      backPrefix: '',
      removeFrontPrefix: false,
      removeBackPrefix: false,
    });
  });
});
