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
  applyBoardReannotate,
  compareReannotateFootprints,
  filterReannotatePrefix,
  planBoardReannotate,
  reannotateBoard,
  reannotateDuplicates,
  reannotateSortCodes,
  roundToReannotateGrid,
} from '@ziroeda/pcbnew/src/board_reannotate.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import type { Board, PcbFootprint, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';
import type { SList, SNode } from '@ziroeda/sexpr/src/types.js';

const EMPTY: SList = { kind: 'list', items: [] };
const atom = (value: string): SNode => ({ kind: 'atom', value });
const str = (value: string): SNode => ({ kind: 'string', value });
const list = (...items: SNode[]): SList => ({ kind: 'list', items });

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
  source: list(atom('property'), str('Reference'), str(ref)),
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
    source: list(atom('footprint')),
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
  source: EMPTY,
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

describe('planBoardReannotate: sorting', () => {
  it('numbers front footprints top to bottom, then left to right', () => {
    // Sort code 0 is y-first ascending, x-second ascending. If the axes swap,
    // a board is numbered column-wise and every designator moves.
    const b = board([
      { ref: 'R9', x: 2 * MM, y: 0 },
      { ref: 'R8', x: 0, y: 10 * MM },
      { ref: 'R7', x: 0, y: 0 },
    ]);
    expect(refs(reannotateBoard(b, { sortCode: 0 }).board)).toEqual(['R2', 'R3', 'R1']);
  });

  it('mirrors left and right on the back', () => {
    // Board coordinates are read from the top, so "left to right" seen from
    // the back is decreasing x. Same sort code, opposite x order.
    const b = board([
      { ref: 'R1', x: 0, y: 0, layer: 'B.Cu' },
      { ref: 'R2', x: 5 * MM, y: 0, layer: 'B.Cu' },
    ]);
    expect(refs(reannotateBoard(b, { sortCode: 0 }).board)).toEqual(['R2', 'R1']);
  });

  it('numbers left to right, top to bottom under sort code 4', () => {
    // Code 4 is x-first ascending; the second axis only breaks ties within a
    // column.
    const b = board([
      { ref: 'R1', x: 10 * MM, y: 0 },
      { ref: 'R2', x: 0, y: 10 * MM },
      { ref: 'R3', x: 0, y: 0 },
    ]);
    expect(refs(reannotateBoard(b, { sortCode: 4 }).board)).toEqual(['R3', 'R2', 'R1']);
  });

  it('reverses both axes under sort code 7', () => {
    const b = board([
      { ref: 'R1', x: 0, y: 0 },
      { ref: 'R2', x: 10 * MM, y: 0 },
      { ref: 'R3', x: 10 * MM, y: 10 * MM },
    ]);
    expect(refs(reannotateBoard(b, { sortCode: 7 }).board)).toEqual(['R3', 'R2', 'R1']);
  });

  it('keeps a nearly-aligned row together once it is snapped to a grid', () => {
    // The headline feature. These three are a row 2 µm out of true; without a
    // snap the y sort interleaves them and the row is numbered by its jitter.
    const row = [
      { ref: 'R1', x: 0, y: 10 * MM + 2000 },
      { ref: 'R2', x: 5 * MM, y: 10 * MM - 2000 },
      { ref: 'R3', x: 10 * MM, y: 10 * MM },
    ];

    const jittered = reannotateBoard(board(row), { sortCode: 0 });
    expect(refs(jittered.board)).toEqual(['R3', 'R1', 'R2']);

    const snapped = reannotateBoard(board(row), { sortCode: 0, sortGridX: MM, sortGridY: MM });
    expect(refs(snapped.board)).toEqual(['R1', 'R2', 'R3']);
  });

  it('sorts by the Reference text position when asked to', () => {
    // m_locationChoice = Reference. The anchors here say one order and the
    // silkscreen text says the opposite.
    const specs = [
      { ref: 'R1', x: 0, y: 0, refAt: { x: 0, y: 10 * MM } },
      { ref: 'R2', x: 0, y: 5 * MM, refAt: { x: 0, y: 0 } },
    ];
    expect(refs(reannotateBoard(board(specs), {}).board)).toEqual(['R1', 'R2']);
    expect(refs(reannotateBoard(board(specs), { useFootprintLocation: false }).board)).toEqual([
      'R2',
      'R1',
    ]);
  });
});

describe('planBoardReannotate: numbering', () => {
  it('renames around a cycle without either footprint clobbering the other', () => {
    // R1 and R2 swap. Renumbering in place would set the top one to R1's old
    // name and then overwrite it; the plan is built entirely from the original
    // designators, so the swap resolves atomically.
    const b = board([
      { ref: 'R1', x: 0, y: 10 * MM },
      { ref: 'R2', x: 0, y: 0 },
    ]);
    const out = reannotateBoard(b, {});
    expect(out.plan.ok).toBe(true);
    expect(refs(out.board)).toEqual(['R2', 'R1']);
  });

  it('counts each prefix separately', () => {
    // A shared counter would number the board R1, C2, R3.
    const b = board([
      { ref: 'R5', x: 0, y: 0 },
      { ref: 'C9', x: 0, y: 5 * MM },
      { ref: 'R6', x: 0, y: 10 * MM },
    ]);
    expect(refs(reannotateBoard(b, {}).board)).toEqual(['R1', 'C1', 'R2']);
  });

  it('starts the front at the requested number', () => {
    const b = board([
      { ref: 'R1', x: 0, y: 0 },
      { ref: 'R2', x: 0, y: 5 * MM },
    ]);
    expect(refs(reannotateBoard(b, { frontStart: 100 }).board)).toEqual(['R100', 'R101']);
  });

  it('treats a start of 0 as a start of 1', () => {
    // GetOrBuildRefDesInfo floors LastUsedRefDes at 0, so a blank start box
    // still produces R1 rather than R0.
    const b = board([{ ref: 'R7', x: 0, y: 0 }]);
    expect(refs(reannotateBoard(b, { frontStart: 0 }).board)).toEqual(['R1']);
  });

  it('lets the back continue the front numbering when its start box is blank', () => {
    // The default. `if( aStartRefDes != 0 )` never fires, so no counter is
    // reset and the back picks up where the front stopped.
    const b = board([
      { ref: 'R1', x: 0, y: 0 },
      { ref: 'R2', x: 0, y: 5 * MM },
      { ref: 'R3', x: 0, y: 0, layer: 'B.Cu' },
    ]);
    expect(refs(reannotateBoard(b, { backStart: 0 }).board)).toEqual(['R1', 'R2', 'R3']);
  });

  it('restarts every counter when the back start box is filled in', () => {
    const b = board([
      { ref: 'R1', x: 0, y: 0 },
      { ref: 'R2', x: 0, y: 5 * MM },
      { ref: 'R3', x: 0, y: 0, layer: 'B.Cu' },
    ]);
    expect(refs(reannotateBoard(b, { backStart: 100 }).board)).toEqual(['R1', 'R2', 'R100']);
  });

  it('skips a number an excluded footprint is holding', () => {
    // BuildUnavailableRefsList reserves 2 under prefix R, so the second
    // renumbered part jumps to R3. Without it the plan would produce two R2s
    // and refuse to run at all.
    const b = board([
      { ref: 'R5', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 5 * MM },
      { ref: 'R2', x: 0, y: 10 * MM },
    ]);
    const out = reannotateBoard(b, { excludeList: 'R2*' });
    expect(out.plan.ok).toBe(true);
    expect(refs(out.board)).toEqual(['R1', 'R3', 'R2']);
  });

  it('reserves the unavailable number under the untouched prefix', () => {
    // The reservation happens before the front prefix is applied, so an
    // excluded R2 does not block 2 under F_R.
    const b = board([
      { ref: 'R5', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 5 * MM },
      { ref: 'R2', x: 0, y: 10 * MM },
    ]);
    const out = reannotateBoard(b, { excludeList: 'R2*', frontPrefix: 'F_' });
    expect(refs(out.board)).toEqual(['F_R1', 'F_R2', 'R2']);
  });
});

describe('planBoardReannotate: prefixes', () => {
  it('adds a front prefix once, not once per run', () => {
    // `prefixpresent` is what stops a second pass producing F_F_R1. It also
    // means an already-prefixed footprint shares the F_R counter with a bare
    // one, rather than opening a second sequence under F_F_R.
    const b = board([
      { ref: 'R1', x: 0, y: 0 },
      { ref: 'F_R4', x: 0, y: 5 * MM },
    ]);
    expect(refs(reannotateBoard(b, { frontPrefix: 'F_' }).board)).toEqual(['F_R1', 'F_R2']);
  });

  it('removes a front prefix when told to', () => {
    const b = board([{ ref: 'F_R4', x: 0, y: 0 }]);
    expect(refs(reannotateBoard(b, { frontPrefix: 'F_', removeFrontPrefix: true }).board)).toEqual([
      'R1',
    ]);
  });

  it('does nothing when asked to remove a prefix the footprint does not carry', () => {
    const b = board([{ ref: 'R4', x: 0, y: 0 }]);
    expect(refs(reannotateBoard(b, { frontPrefix: 'F_', removeFrontPrefix: true }).board)).toEqual([
      'R1',
    ]);
  });

  it('only counts a prefix as present when it starts the designator', () => {
    // `find( aPrefix ) == 0`, not "contains". XF_R already has F_ in it; a
    // containment test would refuse to prefix it and, worse, would slice two
    // characters off the front of it when removal is checked.
    const b = board([{ ref: 'XF_R4', x: 0, y: 0 }]);
    expect(refs(reannotateBoard(b, { frontPrefix: 'F_' }).board)).toEqual(['F_XF_R1']);
    expect(refs(reannotateBoard(b, { frontPrefix: 'F_', removeFrontPrefix: true }).board)).toEqual([
      'XF_R1',
    ]);
  });

  it('never adds a prefix while removal is checked', () => {
    // addprefix is `haveprefix & !aRemovePrefix`; a truthier reading would
    // add the prefix to everything that lacked it and then strip it again.
    const b = board([{ ref: 'C4', x: 0, y: 0 }]);
    expect(refs(reannotateBoard(b, { frontPrefix: 'F_', removeFrontPrefix: true }).board)).toEqual([
      'C1',
    ]);
  });

  it('gives the back its own prefix', () => {
    const b = board([
      { ref: 'R1', x: 0, y: 0 },
      { ref: 'R2', x: 0, y: 0, layer: 'B.Cu' },
    ]);
    const out = reannotateBoard(b, { frontPrefix: 'F_', backPrefix: 'B_' });
    expect(refs(out.board)).toEqual(['F_R1', 'B_R1']);
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
  it('excludes by bare prefix', () => {
    // "R means R*" — a token without a star is compared to the prefix.
    const b = board([
      { ref: 'R4', x: 0, y: 0 },
      { ref: 'C9', x: 0, y: 5 * MM },
    ]);
    const out = reannotateBoard(b, { excludeList: 'R' });
    expect(refs(out.board)).toEqual(['R4', 'C1']);
  });

  it('globs a token that ends in a star against the whole designator', () => {
    const b = board([
      { ref: 'R41', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 5 * MM },
    ]);
    expect(refs(reannotateBoard(b, { excludeList: 'R4*' }).board)).toEqual(['R41', 'R1']);
  });

  it('globs case-SENSITIVELY, because upstream uses wxString::Matches', () => {
    // dialog_board_reannotate.cpp:506 is `RefDesString.Matches( excluded )`,
    // not the WildCompareString( …, false ) the filter dialogs use, so `R4*`
    // does not reach `r41`.
    const b = board([
      { ref: 'R41', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 5 * MM },
    ]);
    // `R4*` reaches R41 and holds it back; `r4*` reaches nothing.
    expect(refs(reannotateBoard(b, { excludeList: 'R4*' }).board)).toEqual(['R41', 'R1']);
    expect(refs(reannotateBoard(b, { excludeList: 'r4*' }).board)).toEqual(['R1', 'R2']);
  });

  it('splits the exclusion box on commas and whitespace', () => {
    const b = board([
      { ref: 'R4', x: 0, y: 0 },
      { ref: 'C9', x: 0, y: 5 * MM },
      { ref: 'L2', x: 0, y: 10 * MM },
    ]);
    const plan = planBoardReannotate(b, { excludeList: ' R,,\tC \n' });
    expect(plan.excludes).toEqual(['R', 'C']);
    expect(refs(applyBoardReannotate(b, plan))).toEqual(['R4', 'C9', 'L1']);
  });

  it('lets a Front scope silently cancel the exclusion list', () => {
    // BuildFootprintList overwrites the action it just computed. Only the
    // "All" scope leaves an exclusion standing, which is why the first
    // assertion below and the second disagree about the same board.
    const b = board([
      { ref: 'R4', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 5 * MM },
    ]);
    expect(refs(reannotateBoard(b, { excludeList: 'R', scope: 'all' }).board)).toEqual([
      'R4',
      'R9',
    ]);
    expect(refs(reannotateBoard(b, { excludeList: 'R', scope: 'front' }).board)).toEqual([
      'R1',
      'R2',
    ]);
  });

  it('keeps a locked footprint excluded even under a Front scope', () => {
    // The locked test comes before the scope chain, so unlike the exclusion
    // list it survives it.
    const b = board([
      { ref: 'R4', x: 0, y: 0, locked: true },
      { ref: 'R9', x: 0, y: 5 * MM },
    ]);
    const out = reannotateBoard(b, { excludeLocked: true, scope: 'front' });
    expect(refs(out.board)).toEqual(['R4', 'R1']);
  });

  it('renumbers a locked footprint when the box is left unchecked', () => {
    // The default is unchecked, so this branch is the one a caller gets for
    // free and the one most likely to rot unnoticed.
    const b = board([{ ref: 'R4', x: 0, y: 0, locked: true }]);
    expect(refs(reannotateBoard(b, { excludeLocked: false }).board)).toEqual(['R1']);
  });

  it('renumbers only the selection under a Selection scope', () => {
    const b = board([
      { ref: 'R4', x: 0, y: 0, uuid: 'a' },
      { ref: 'R9', x: 0, y: 5 * MM, uuid: 'b' },
    ]);
    const out = reannotateBoard(b, { scope: 'selection', selected: new Set(['b']) });
    expect(refs(out.board)).toEqual(['R4', 'R1']);
  });

  it('renumbers only one side under a Back scope', () => {
    const b = board([
      { ref: 'R4', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 0, layer: 'B.Cu' },
    ]);
    expect(refs(reannotateBoard(b, { scope: 'back' }).board)).toEqual(['R4', 'R1']);
  });

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

describe('planBoardReannotate: empty and invalid designators', () => {
  it('leaves an unannotated footprint alone and reports it', () => {
    const b = board([
      { ref: '', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 5 * MM },
    ]);
    const out = reannotateBoard(b, {});
    expect(refs(out.board)).toEqual(['', 'R1']);
    expect(out.plan.badRefDes.map((i) => i.action)).toEqual(['empty']);
  });

  it('leaves a digitless designator alone and reports it', () => {
    // find_first_of("0123456789") returning npos is INVALID_REFDES, and
    // substr(0, npos) makes the whole string the prefix.
    const b = board([{ ref: 'REF', x: 0, y: 0 }]);
    const out = reannotateBoard(b, {});
    expect(refs(out.board)).toEqual(['REF']);
    expect(out.plan.badRefDes.map((i) => i.action)).toEqual(['invalid']);
    expect(out.plan.front[0]!.refDesPrefix).toBe('REF');
  });

  it('names an unannotated footprint with a bare number under a Front scope', () => {
    // The scope chain overwrites EMPTY_REFDES with UPDATE_REFDES, and the
    // prefix of an empty designator is the empty string, so the footprint
    // comes out called "1". Upstream does exactly this; a port that "fixed"
    // it would disagree with KiCad on the same board.
    const b = board([
      { ref: '', x: 0, y: 0 },
      { ref: 'R9', x: 0, y: 5 * MM },
    ]);
    const out = reannotateBoard(b, { scope: 'front' });
    expect(refs(out.board)).toEqual(['1', 'R1']);
    expect(out.plan.badRefDes).toEqual([]);
  });

  it('prefixes even that bare number when a front prefix is set', () => {
    const b = board([{ ref: '', x: 0, y: 0 }]);
    expect(refs(reannotateBoard(b, { scope: 'front', frontPrefix: 'F_' }).board)).toEqual(['F_1']);
  });
});

describe('planBoardReannotate: collisions', () => {
  it('refuses the whole run when two entries claim the same designator', () => {
    // Two excluded footprints already share R4. Nothing is renumbered — not
    // even the parts that would have been fine.
    const b = board([
      { ref: 'R4', x: 0, y: 0 },
      { ref: 'R4', x: 0, y: 5 * MM },
      { ref: 'C1', x: 0, y: 10 * MM },
    ]);
    const out = reannotateBoard(b, { excludeList: 'R' });
    expect(out.plan.ok).toBe(false);
    expect(out.plan.errors).toEqual(['Duplicate instances of R4']);
    expect(out.board).toBe(b);
    expect(refs(out.board)).toEqual(['R4', 'R4', 'C1']);
  });

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

describe('applyBoardReannotate', () => {
  it('rewrites the Reference text alongside the model field', () => {
    // A model-only update leaves the written file saying the old name.
    const b = board([{ ref: 'R9', x: 0, y: 0 }]);
    const out = reannotateBoard(b, {}).board;
    expect(out.footprints[0]!.reference).toBe('R1');
    expect(out.footprints[0]!.texts[0]!.text).toBe('R1');
  });

  it('survives a real read and write round trip', () => {
    // The reader normalises plenty, so this asserts on the serialized text
    // rather than on a re-read model: what matters is what lands in the file.
    const text = `(kicad_pcb (version 20240108) (generator "test")
      (footprint "R_0603" (layer "F.Cu") (uuid "aaaa") (at 10 20)
        (property "Reference" "R7" (at 0 0) (layer "F.SilkS")))
      (footprint "R_0603" (layer "F.Cu") (uuid "bbbb") (at 10 5)
        (property "Reference" "R2" (at 0 0) (layer "F.SilkS")))
    )`;
    const read = readBoard(parse(text) as SList);
    const out = reannotateBoard(read, {}).board;
    const written = serializeBoard(out);
    // The one nearer the top of the board becomes R1.
    expect(written).toContain('"Reference" "R1"');
    expect(written).toContain('"Reference" "R2"');
    expect(written).not.toContain('"Reference" "R7"');
  });

  it('leaves a footprint with no change row untouched', () => {
    // GetNewRefDes returning null aborts upstream; here a row simply cannot
    // be missing, but the guard keeps a partial plan from wiping designators.
    const b = board([
      { ref: 'R5', x: 0, y: 0 },
      { ref: 'R6', x: 0, y: 5 * MM },
    ]);
    const plan = planBoardReannotate(b, {});
    const trimmed = { ...plan, changes: plan.changes.filter((c) => c.index === 0) };
    expect(refs(applyBoardReannotate(b, trimmed))).toEqual(['R1', 'R6']);
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
