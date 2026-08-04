// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What rides a dragged wire, and what does not. Counterpart
 * SCH_MOVE_TOOL::getConnectedDragItems, whose per-kind switch draws a line that
 * is easy to state backwards:
 *
 *   - labels (all four kinds, directive included) join when the wire passes
 *     through them *anywhere along its length* — `line->HitTest( pos, 1 )`;
 *   - junctions, symbols and no-connects join only when they sit on the
 *     *specific point* being dragged — `test->IsConnected( aPoint )`.
 *
 * So "labels and junctions ride a moved wire mid-span" is half wrong: a
 * junction mid-span must stay where it is. These tests pin both halves down.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();
const GRID = mmToIU(1.27);
const mm = (n: number): number => n * 1.27; // grid units, in mm for the fixture text

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** A horizontal wire from 10 to 30 grid units, with `body` alongside it. */
const withWire = (body: string): Schematic =>
  sheet(
    [`(wire (pts (xy ${mm(10)} ${mm(10)}) (xy ${mm(30)} ${mm(10)})) (uuid "w-1"))`, body].join(
      '\n',
    ),
  );

const wireId = (d: Schematic): string => refId('line', 'w-1', 0);
/** Drag the whole wire. */
const planWhole = (d: Schematic) => planMove(d, LIB, new Set([wireId(d)]));

describe('labels ride the wire anywhere along its length', () => {
  it('a plain label mid-span is carried', () => {
    const d = withWire(
      `(label "NET" (at ${mm(20)} ${mm(10)} 0) (effects (font (size 1.27 1.27))) (uuid "l-1"))`,
    );
    const spec = planWhole(d);
    expect(spec.labelRides.map((r) => r.id)).toContain(refId('label', 'l-1', 0));
  });

  it('a label off the wire is not', () => {
    const d = withWire(
      `(label "NET" (at ${mm(20)} ${mm(14)} 0) (effects (font (size 1.27 1.27))) (uuid "l-1"))`,
    );
    expect(planWhole(d).labelRides).toEqual([]);
  });

  it('free text never rides — it is not connectable', () => {
    const d = withWire(
      `(text "note" (at ${mm(20)} ${mm(10)} 0) (effects (font (size 1.27 1.27))) (uuid "t-1"))`,
    );
    expect(planWhole(d).labelRides).toEqual([]);
  });
});

describe('a directive label is a label for this purpose', () => {
  it('rides a wire that passes through it', () => {
    // SCH_DIRECTIVE_LABEL_T sits in the same case as SCH_LABEL_T /
    // SCH_GLOBAL_LABEL_T / SCH_HIER_LABEL_T in getConnectedDragItems.
    const d = withWire(
      `(netclass_flag "HV" (length 2.54) (shape round) (at ${mm(20)} ${mm(10)} 0)
         (effects (font (size 1.27 1.27)) (justify left)) (uuid "nc-1")
         (property "Netclass" "HV" (at ${mm(20)} ${mm(10)} 0)
           (effects (font (size 1.27 1.27)))))`,
    );
    expect(d.directiveLabels ?? []).toHaveLength(1);
    const spec = planWhole(d);
    expect(spec.labelRides.map((r) => r.id)).toContain(refId('directive', 'nc-1', 0));
  });
});

describe('a junction rides only the point being dragged', () => {
  const junctionAt = (x: number) =>
    withWire(`(junction (at ${mm(x)} ${mm(10)}) (diameter 0) (uuid "j-1"))`);

  it('one sitting mid-span does NOT ride', () => {
    // getConnectedDragItems puts SCH_JUNCTION_T with SCH_SYMBOL_T and
    // SCH_NO_CONNECT_T: `test->IsConnected( aPoint )`, the dragged point only.
    // A junction mid-span is not at that point, so it stays.
    const d = junctionAt(20);
    const spec = planMove(d, LIB, new Set([wireId(d)]));
    expect(spec.fullIds.has(refId('junction', 'j-1', 0))).toBe(false);
  });

  it('one at an endpoint of a whole-wire move comes along', () => {
    const d = junctionAt(10);
    const spec = planMove(d, LIB, new Set([wireId(d)]));
    // Either it is pulled into the move set, or a stub holds it — what must not
    // happen is the wire leaving it stranded with nothing recorded.
    const id = refId('junction', 'j-1', 0);
    const held = spec.fullIds.has(id) || spec.newWires.length > 0;
    expect(held).toBe(true);
  });
});

describe('the grid the fixtures sit on', () => {
  it('is the 1.27 mm schematic grid', () => {
    // Guard: an off-grid fixture would exercise the snap instead of the plan.
    const d = junctionFixture();
    for (const l of d.lines) {
      expect(l.start.x % GRID).toBe(0);
      expect(l.start.y % GRID).toBe(0);
    }
  });
  const junctionFixture = (): Schematic =>
    withWire(`(junction (at ${mm(20)} ${mm(10)}) (diameter 0) (uuid "j-1"))`);
});

describe('the ride is actually applied, not just planned', () => {
  it('a directive label moves with the wire it sits on', () => {
    // Planning the ride and then not applying it would leave the flag behind
    // while the wire walks away, which is the failure this guards.
    const d = withWire(
      `(netclass_flag "HV" (length 2.54) (shape round) (at ${mm(20)} ${mm(10)} 0)
         (effects (font (size 1.27 1.27)) (justify left)) (uuid "nc-1")
         (property "Netclass" "HV" (at ${mm(20)} ${mm(10)} 0)
           (effects (font (size 1.27 1.27)))))`,
    );
    const before = (d.directiveLabels ?? [])[0]!.at;
    const spec = planWhole(d);
    const after = moveWithConnections(spec, { x: GRID, y: 0 }).apply(d);
    expect((after.directiveLabels ?? [])[0]!.at).toEqual({ x: before.x + GRID, y: before.y });
  });

  it('one off the wire stays put', () => {
    const d = withWire(
      `(netclass_flag "HV" (length 2.54) (shape round) (at ${mm(20)} ${mm(14)} 0)
         (effects (font (size 1.27 1.27)) (justify left)) (uuid "nc-1")
         (property "Netclass" "HV" (at ${mm(20)} ${mm(14)} 0)
           (effects (font (size 1.27 1.27)))))`,
    );
    const before = (d.directiveLabels ?? [])[0]!.at;
    const after = moveWithConnections(planWhole(d), { x: GRID, y: 0 }).apply(d);
    expect((after.directiveLabels ?? [])[0]!.at).toEqual(before);
  });
});
