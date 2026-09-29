// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_COURTYARD_INDEX` (`pcbnew/footprint_courtyard_index.cpp`, new in
 * 10.0.6) against a brute-force scan, after `qa/tests/pcbnew/drc/
 * test_footprint_courtyard_index.cpp`, plus what the C++ test leaves out: the
 * back courtyard, the union of both sides, the visitor's early stop, and the
 * board dropping its index when it changes.
 *
 * The index is only correct if it returns every footprint whose courtyard
 * bounding box overlaps the query box, which is precisely the broad-phase test
 * the downstream collision check applies.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT_COURTYARD_INDEX } from '@ziroeda/pcbnew/footprint_courtyard_index.js';
import { DRC_CONSTRAINT_T } from '@ziroeda/pcbnew/drc/drc_rule.js';
import { DRC_RULE_CONDITION } from '@ziroeda/pcbnew/drc/drc_rule_condition.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const mm = (aMillimetres: number): number => pcbIUScale.mmToIU(aMillimetres);

let seq = 0;
const U = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

/** A footprint at (x, y) mm with a `w` x `h` mm rectangle courtyard centred on its origin. */
const footprint = (ref: string, x: number, y: number, w: number, h: number, layer = 'F.CrtYd') =>
  `(footprint "L:F" (layer "F.Cu") (uuid "${U()}") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 0 0) (layer "F.SilkS") (hide yes) (uuid "${U()}"))
    (fp_rect (start ${-w / 2} ${-h / 2}) (end ${w / 2} ${h / 2})
      (stroke (width 0.1) (type solid)) (fill no) (layer "${layer}") (uuid "${U()}")))`;

/** A footprint with no courtyard graphics at all. */
const bare = (ref: string, x: number, y: number) =>
  `(footprint "L:F" (layer "F.Cu") (uuid "${U()}") (at ${x} ${y})
    (property "Reference" "${ref}" (at 0 0 0) (layer "F.SilkS") (hide yes) (uuid "${U()}")))`;

const pcb = (...items: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (31 "F.CrtYd" user "F.Courtyard") (29 "B.CrtYd" user "B.Courtyard") (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  ${items.join('\n  ')}
)`);

const box = (x: number, y: number, w: number, h: number): BOX2I =>
  new BOX2I({ x: mm(x), y: mm(y) }, { x: mm(w), y: mm(h) });

/** The footprints whose combined courtyard bounding box overlaps aBox, by linear scan. */
function bruteForceOverlap(aBoard: BOARD, aBox: BOX2I): Set<FOOTPRINT> {
  const result = new Set<FOOTPRINT>();

  for (const fp of aBoard.Footprints()) {
    let bbox: BOX2I | null = null;

    for (const side of [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]) {
      const courtyard = fp.GetCourtyard(side);

      if (courtyard.OutlineCount() === 0) continue;

      if (bbox) bbox.Merge(courtyard.BBox());
      else bbox = courtyard.BBox();
    }

    if (bbox?.Intersects(aBox)) result.add(fp);
  }

  return result;
}

function indexOverlap(aIndex: FOOTPRINT_COURTYARD_INDEX, aBox: BOX2I): Set<FOOTPRINT> {
  const result = new Set<FOOTPRINT>();
  aIndex.QueryOverlapping(aBox, (fp) => {
    result.add(fp);
    return true;
  });
  return result;
}

const refs = (aSet: Set<FOOTPRINT>): string[] => [...aSet].map((f) => f.GetReference()).sort();

function scene(): BOARD {
  return pcb(
    footprint('U1', 0, 0, 2, 2),
    footprint('U2', 50, 0, 2, 2),
    footprint('U3', 100, 100, 2, 2),
    // A courtyard far larger than its body: indexing the body would drop it from far queries.
    footprint('U4', 0, 50, 60, 60),
    bare('U5', 50, 50),
    footprint('U6', -80, -80, 4, 4, 'B.CrtYd'),
  );
}

describe('FOOTPRINT_COURTYARD_INDEX', () => {
  it('returns what a brute-force scan does, for every kind of query', () => {
    const board = scene();
    const index = new FOOTPRINT_COURTYARD_INDEX(board);
    const queries = [
      box(-5, -5, 10, 10), // around U1 only
      box(200, 200, 10, 10), // empty region
      box(20, 40, 5, 5), // only U4's large courtyard
      box(-100, -100, 350, 350), // everything
      box(-82, -82, 4, 4), // U6's back courtyard
    ];

    for (const q of queries)
      expect(refs(indexOverlap(index, q))).toEqual(refs(bruteForceOverlap(board, q)));
  });

  it('answers what the queries are for, by reference', () => {
    const index = new FOOTPRINT_COURTYARD_INDEX(scene());
    expect(refs(indexOverlap(index, box(-5, -5, 10, 10)))).toEqual(['U1']);
    expect(refs(indexOverlap(index, box(20, 40, 5, 5)))).toEqual(['U4']);
    expect(refs(indexOverlap(index, box(200, 200, 10, 10)))).toEqual([]);
  });

  it('never returns a footprint with no courtyard', () => {
    const index = new FOOTPRINT_COURTYARD_INDEX(scene());
    expect(refs(indexOverlap(index, box(-100, -100, 350, 350)))).not.toContain('U5');
  });

  it('indexes a back-only courtyard', () => {
    const index = new FOOTPRINT_COURTYARD_INDEX(scene());
    expect(refs(indexOverlap(index, box(-82, -82, 4, 4)))).toEqual(['U6']);
  });

  it('indexes the union of the front and back courtyards', () => {
    const both = pcb(`(footprint "L:F" (layer "F.Cu") (uuid "${U()}") (at 0 0)
      (property "Reference" "X1" (at 0 0 0) (layer "F.SilkS") (hide yes) (uuid "${U()}"))
      (fp_rect (start -1 -1) (end 1 1) (stroke (width 0.1) (type solid)) (fill no) (layer "F.CrtYd") (uuid "${U()}"))
      (fp_rect (start 20 20) (end 22 22) (stroke (width 0.1) (type solid)) (fill no) (layer "B.CrtYd") (uuid "${U()}")))`);
    const index = new FOOTPRINT_COURTYARD_INDEX(both);
    // between the two courtyards, inside their union: still a broad-phase hit
    expect(refs(indexOverlap(index, box(10, 10, 1, 1)))).toEqual(['X1']);
    expect(refs(indexOverlap(index, box(30, 30, 1, 1)))).toEqual([]);
  });

  it('stops when the visitor returns false, like a linear scan short-circuiting', () => {
    const index = new FOOTPRINT_COURTYARD_INDEX(scene());
    let visited = 0;
    index.QueryOverlapping(box(-100, -100, 350, 350), () => {
      visited++;
      return false;
    });
    expect(visited).toBe(1);
  });
});

describe('BOARD::GetFootprintCourtyardIndex', () => {
  it('is built once and reused until the board changes', () => {
    const board = scene();
    const first = board.GetFootprintCourtyardIndex();
    expect(board.GetFootprintCourtyardIndex()).toBe(first);
    board.IncrementTimeStamp();
    expect(board.GetFootprintCourtyardIndex()).not.toBe(first);
  });

  it('a removed footprint is gone from the next index', () => {
    const board = scene();
    const q = box(-5, -5, 10, 10);
    expect(refs(indexOverlap(board.GetFootprintCourtyardIndex(), q))).toEqual(['U1']);
    const u1 = board.Footprints().find((f) => f.GetReference() === 'U1')!;
    board.Remove(u1);
    expect(refs(indexOverlap(board.GetFootprintCourtyardIndex(), q))).toEqual([]);
  });
});

/**
 * The three rule predicates that search the index (`pcbexpr_functions.cpp`
 * `searchFootprintsNearItem`, three callers), through the same
 * DRC_RULE_CONDITION a `.kicad_dru` condition compiles to.
 */
describe('intersectsCourtyard() and its side variants use the index', () => {
  const track = (aX: number, aY: number, aLayer = 'F.Cu'): string =>
    `(segment (start ${aX} ${aY}) (end ${aX + 0.5} ${aY}) (width 0.25) (layer "${aLayer}") (net 0) (uuid "${U()}"))`;

  const holds = (
    aBoard: BOARD,
    aTrack: number,
    aExpr: string,
    aLayer = PCB_LAYER_ID.F_Cu,
  ): boolean => {
    const cond = new DRC_RULE_CONDITION(aExpr);
    expect(cond.Compile(null)).toBe(true);
    return cond.EvaluateFor(
      aBoard.Tracks()[aTrack]!,
      null,
      DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
      aLayer,
    );
  };

  const board = (): BOARD =>
    pcb(
      footprint('U1', 0, 0, 4, 4),
      footprint('U2', 50, 0, 4, 4),
      // a big courtyard nowhere near the tracks tested against 'U1'
      footprint('BIG', 0, 100, 60, 60),
      track(0.5, 0), // 0: inside U1
      track(20, 0), // 1: in clear air
      track(50, 0), // 2: inside U2
      track(0, 100), // 3: inside BIG
    );

  it('a track on U1 collides with U1 and only U1', () => {
    const b = board();
    expect(holds(b, 0, "A.intersectsCourtyard('U1')")).toBe(true);
    expect(holds(b, 0, "A.intersectsCourtyard('U2')")).toBe(false);
    expect(holds(b, 0, "A.intersectsCourtyard('BIG')")).toBe(false);
  });

  it('a track in clear air collides with nothing', () => {
    const b = board();
    expect(holds(b, 1, "A.intersectsCourtyard('U*')")).toBe(false);
  });

  it('a wildcard selector reaches every footprint the index finds', () => {
    const b = board();
    expect(holds(b, 2, "A.intersectsCourtyard('U*')")).toBe(true);
    expect(holds(b, 3, "A.intersectsCourtyard('B*')")).toBe(true);
    expect(holds(b, 3, "A.intersectsCourtyard('U*')")).toBe(false);
  });

  it('the front and back variants read their own side', () => {
    const b = board();
    expect(holds(b, 0, "A.intersectsFrontCourtyard('U1')")).toBe(true);
    expect(holds(b, 0, "A.intersectsBackCourtyard('U1')", PCB_LAYER_ID.B_Cu)).toBe(false);
  });

  it('sees a footprint moved onto the track (the index is rebuilt after a change)', () => {
    const b = board();
    expect(holds(b, 1, "A.intersectsCourtyard('U2')")).toBe(false);
    const u2 = b.Footprints().find((f) => f.GetReference() === 'U2')!;
    u2.Move({ x: mm(-30), y: 0 });
    b.IncrementTimeStamp();
    expect(holds(b, 1, "A.intersectsCourtyard('U2')")).toBe(true);
  });

  it('"A" and "B" name the items of the pair, not a board-wide search', () => {
    const b = board();
    const u1 = b.Footprints().find((f) => f.GetReference() === 'U1')!;
    const u2 = b.Footprints().find((f) => f.GetReference() === 'U2')!;
    const onU1 = b.Tracks()[0]!;
    const evalPair = (
      aExpr: string,
      aA: typeof onU1 | typeof u1,
      aB: typeof u1 | null,
    ): boolean => {
      const cond = new DRC_RULE_CONDITION(aExpr);
      expect(cond.Compile(null)).toBe(true);
      // one order only: DRC_RULE_CONDITION also tries (B, A), so ask with a null B to pin A
      return cond.EvaluateFor(aA, aB, DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, PCB_LAYER_ID.F_Cu);
    };

    // B = U1: the track collides with it
    expect(evalPair("A.intersectsCourtyard('B')", onU1, u1)).toBe(true);
    // B = U2: it does not
    expect(evalPair("A.intersectsCourtyard('B')", onU1, u2)).toBe(false);
    // 'A' is the first item of the pair: a track is no footprint, a footprint is its own
    expect(evalPair("A.intersectsCourtyard('A')", onU1, null)).toBe(false);
    expect(evalPair("A.intersectsCourtyard('A')", u1, null)).toBe(true);
    // A missing B is no footprint at all
    expect(evalPair("A.intersectsCourtyard('B')", onU1, null)).toBe(false);
  });
});
