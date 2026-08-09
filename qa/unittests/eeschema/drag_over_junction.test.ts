// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dragging a symbol whose pin sits on a junction, end to end: the plan, the
 * post-drop block and `SCHEMATIC::CleanUp`, in the order the canvas runs them.
 *
 * Counterparts: `SCH_MOVE_TOOL::getConnectedDragItems` (the
 * `ptHasUnselectedJunction` / `SCH_JUNCTION_T` arms, which make one rubber-band
 * stub instead of dragging the neighbour wires' endpoints), the commit's
 * junction/trim block, and `SCHEMATIC::CleanUp` / `SCH_LINE::MergeOverlap`
 * (eeschema/schematic.cpp, eeschema/sch_line.cpp).
 *
 * The stub upstream makes is collinear with, and overlaps, the wire that
 * already leaves the junction in that direction, so `MergeOverlap` is what
 * stops the drop leaving two wires stacked on each other. `MergeOverlap` merges
 * a true overlap unconditionally; only two segments that merely *touch*
 * end-to-end are held apart, and only by a junction at the touch point.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { withPostMoveCleanup } from '@ziroeda/eeschema/src/tools/post_move_cleanup.js';
import { withCleanup, mergeColinearWires } from '@ziroeda/eeschema/src/tools/cleanup.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { addItems, makeWire, makeJunction } from '@ziroeda/eeschema/src/tools/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const junctionAt = (d: Schematic, p: Vec2): boolean => d.junctions.some((j) => same(j.at, p));
/** Wires that cover `p` and run in the +x direction from it. */
const wiresLeaving = (d: Schematic, p: Vec2): number =>
  d.lines.filter((l) => same(l.start, p) || same(l.end, p)).length;

describe('drag a symbol pinned on a junction (getConnectedDragItems + CleanUp)', () => {
  // R1 is vertical with its pin 1 at (100, 100). Three wires meet there, so the
  // point carries a junction dot; one of them runs right to (102.54, 100) where
  // a fourth wire tees away downward.
  const build = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
        (symbol (lib_id "R") (at 100 103.81 0) (unit 1)
          (property "Reference" "R1" (at 0 0 0))
          (property "Value" "R" (at 0 0 0))
          (uuid "r1"))
      )`),
    );

  const wired = (): Schematic =>
    addItems({
      lines: [
        makeWire(at(100, 100), at(102.54, 100)), // the wire the stub will overlap
        makeWire(at(102.54, 100), at(102.54, 95)), // tees away at the far end
        makeWire(at(100, 100), at(100, 95)),
        makeWire(at(100, 100), at(95, 100)),
      ],
      junctions: [makeJunction(at(100, 100))],
    }).apply(build());

  /** The whole drop, exactly as the canvas composes it. */
  const drag = (doc: Schematic, delta: Vec2): Schematic => {
    const sel = new Set([refId('symbol', doc.symbols[0]!.uuid, 0)]);
    const spec = planMove(doc, LIB, sel);
    const cmd = withPostMoveCleanup(moveWithConnections(spec, delta), spec, LIB, sel, true);
    return withCleanup(cmd, LIB).apply(doc);
  };

  it('pins the drag to the junction with one stub, not by moving the neighbours', () => {
    const doc = wired();
    const sel = new Set([refId('symbol', doc.symbols[0]!.uuid, 0)]);
    const spec = planMove(doc, LIB, sel);
    // An unselected junction isolates the drag: neighbour wires stay put
    // (ptHasUnselectedJunction) and a single stub carries the pin away.
    expect(spec.wireStart.size).toBe(0);
    expect(spec.wireEnd.size).toBe(0);
    expect(spec.newWires.length).toBe(1);
    expect(same(spec.newWires[0]!.fixed, at(100, 100))).toBe(true);
  });

  it('does not leave the stub stacked on the wire it overlaps', () => {
    const before = wired();
    const after = drag(before, { x: mmToIU(3.81), y: 0 });
    // The stub runs (100,100) -> (103.81,100) and the existing wire
    // (100,100) -> (102.54,100) lies inside it. MergeOverlap merges a true
    // overlap, so exactly one wire leaves the junction to the right.
    const rightward = after.lines.filter(
      (l) =>
        (same(l.start, at(100, 100)) || same(l.end, at(100, 100))) &&
        l.start.y === l.end.y &&
        Math.max(l.start.x, l.end.x) > mmToIU(100),
    );
    expect(rightward.length).toBe(1);
    expect(after.lines.length).toBe(before.lines.length);
  });

  it('keeps the junction the drag did not empty', () => {
    const before = wired();
    const after = drag(before, { x: mmToIU(3.81), y: 0 });
    // Three wires still meet at (100,100) in three different directions, so the
    // dot is still explicit and must survive the drop.
    expect(wiresLeaving(after, at(100, 100))).toBeGreaterThanOrEqual(3);
    expect(junctionAt(after, at(100, 100))).toBe(true);
  });
});

describe('MergeOverlap merges a true overlap regardless of what lies between', () => {
  const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));

  it('merges two overlapping wires with a third wire ending inside the span', () => {
    // KiCad's CleanUp only refuses to merge segments that *touch* end-to-end at
    // a junction; an overlap always merges, whatever tees into the middle.
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(10, 0)),
        makeWire(at(0, 0), at(15, 0)),
        makeWire(at(10, 0), at(10, 5)),
      ],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    const horizontal = merged.lines.filter((l) => l.start.y === l.end.y);
    expect(horizontal.length).toBe(1);
    expect(Math.max(horizontal[0]!.start.x, horizontal[0]!.end.x)).toBe(mmToIU(15));
  });

  it('still refuses to merge two segments that only touch at a junction', () => {
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(10, 0)),
        makeWire(at(10, 0), at(20, 0)),
        makeWire(at(10, 0), at(10, 5)),
      ],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    // The tee makes (10,0) an explicit junction, so the two collinear halves
    // stay separate on either side of the dot.
    expect(junctionAt(merged, at(10, 0))).toBe(true);
    expect(merged.lines.filter((l) => l.start.y === l.end.y).length).toBe(2);
  });
});
