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
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import { mergeColinearWires } from '@ziroeda/eeschema/tools/cleanup.js';
import { addItems, makeWire } from '@ziroeda/eeschema/tools/index.js';
import { mmToIU } from '@ziroeda/common/eda_units.js';
import type { Schematic, Vec2 } from '@ziroeda/eeschema/types.js';

const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const junctionAt = (d: Schematic, p: Vec2): boolean => d.junctions.some((j) => same(j.at, p));

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
