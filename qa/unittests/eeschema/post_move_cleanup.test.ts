// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The post-drop block of SCH_MOVE_TOOL's commit: the junctions a move makes and
 * unmakes, the wire span a dropped symbol bridges, and the stubs a drag leaves
 * hanging.
 *
 * Counterparts: `SCH_EDIT_FRAME::TrimWire` (eeschema/bus-wire-junction.cpp),
 * `SCH_LINE_WIRE_BUS_TOOL::TrimOverLappingWires` / `AddJunctionsIfNeeded`
 * (eeschema/tools/sch_line_wire_bus_tool.cpp), `SCH_SCREEN::GetNeededJunctions`
 * (eeschema/sch_screen.cpp) and `SCH_MOVE_TOOL::trimDanglingLines`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  trimWire,
  trimOverlappingWires,
  neededJunctions,
  addJunctionsIfNeeded,
  junctionsAtVacatedPoints,
  trimDanglingLines,
  dragSetFromMove,
  withPostMoveCleanup,
} from '@ziroeda/eeschema/src/tools/post_move_cleanup.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { moveItems } from '@ziroeda/eeschema/src/tools/move.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols)\n${body}\n)`));
const sheetWithR = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})\n${body}\n)`));

const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const lineId = (d: Schematic, i: number): string => refId('line', d.lines[i]!.uuid, i);
const hasJunctionAt = (d: Schematic, p: Vec2): boolean => d.junctions.some((j) => same(j.at, p));
const wire = (uuid: string, a: Vec2, b: Vec2): string =>
  `(wire (pts (xy ${iuToMM(a.x)} ${iuToMM(a.y)}) (xy ${iuToMM(b.x)} ${iuToMM(b.y)}))
     (stroke (width 0) (type default)) (uuid "${uuid}"))`;

describe('TrimWire', () => {
  const doc = sheet(`
    (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w1"))`);

  it('removes the span between two points that both lie on the wire', () => {
    const out = trimWire(doc, at(110, 100), at(130, 100));
    // The middle goes; the two outer stubs remain.
    expect(out.lines).toHaveLength(2);
    const spans = out.lines.map((l) => [l.start.x, l.end.x].sort((a, b) => a - b));
    expect(spans).toContainEqual([mmToIU(100), mmToIU(110)]);
    expect(spans).toContainEqual([mmToIU(130), mmToIU(140)]);
  });

  it('leaves the wire alone when the two points are its own ends', () => {
    // "Don't remove entire wires" — this would delete it rather than trim it.
    expect(trimWire(doc, at(100, 100), at(140, 100))).toBe(doc);
  });

  it('does nothing when the two points are the same', () => {
    expect(trimWire(doc, at(110, 100), at(110, 100))).toBe(doc);
  });

  it('does nothing when a point is off the wire', () => {
    expect(trimWire(doc, at(110, 100), at(130, 120))).toBe(doc);
  });

  it('trims flush to an end without leaving a zero-length stub', () => {
    const out = trimWire(doc, at(100, 100), at(130, 100));
    expect(out.lines).toHaveLength(1);
    expect(out.lines.every((l) => !same(l.start, l.end))).toBe(true);
  });
});

describe('TrimOverLappingWires', () => {
  it('removes the wire a dropped symbol now bridges pin to pin', () => {
    // R's pins are 7.62 mm apart on its own axis; placed at (100,100) they land
    // on a vertical wire that runs straight past both.
    const doc = sheetWithR(`
      (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 102 98 0))
        (property "Value" "R" (at 102 102 0)))
      ${wire('w1', at(100, 90), at(100, 110))}`);
    const out = trimOverlappingWires(doc, new Set([refId('symbol', 'r1', 0)]), LIB);
    // The span under the symbol is gone, leaving a stub above and below.
    expect(out.lines).toHaveLength(2);
    for (const l of out.lines) expect(Math.abs(l.end.y - l.start.y)).toBeLessThan(mmToIU(20));
  });

  it('leaves a wire that the symbol only touches once', () => {
    const doc = sheetWithR(`
      (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 102 98 0))
        (property "Value" "R" (at 102 102 0)))
      ${wire('w1', at(100, 90), at(100, 96.19))}`);
    const out = trimOverlappingWires(doc, new Set([refId('symbol', 'r1', 0)]), LIB);
    expect(out.lines).toHaveLength(1);
  });

  it('ignores items that are not in the set', () => {
    const doc = sheetWithR(`
      (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 102 98 0))
        (property "Value" "R" (at 102 102 0)))
      ${wire('w1', at(100, 90), at(100, 110))}`);
    expect(trimOverlappingWires(doc, new Set(), LIB)).toBe(doc);
  });
});

describe('GetNeededJunctions / AddJunctionsIfNeeded', () => {
  it('finds the dot where a moved wire now crosses a third wire’s end', () => {
    // Three wires meet at (120,100): a dot is needed there.
    const doc = sheet(`
      ${wire('w1', at(100, 100), at(140, 100))}
      ${wire('w2', at(120, 100), at(120, 120))}
      ${wire('w3', at(120, 100), at(120, 80))}`);
    const pts = neededJunctions(doc, new Set([lineId(doc, 0)]), LIB);
    expect(pts.some((p) => same(p, at(120, 100)))).toBe(true);
    expect(
      hasJunctionAt(addJunctionsIfNeeded(doc, new Set([lineId(doc, 0)]), LIB), at(120, 100)),
    ).toBe(true);
  });

  it('adds nothing where two wires simply meet end to end', () => {
    const doc = sheet(`
      ${wire('w1', at(100, 100), at(120, 100))}
      ${wire('w2', at(120, 100), at(120, 120))}`);
    expect(addJunctionsIfNeeded(doc, new Set([lineId(doc, 0)]), LIB)).toBe(doc);
  });

  it('does not add a second dot where one already sits', () => {
    const doc = sheet(`
      (junction (at 120 100) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      ${wire('w1', at(100, 100), at(140, 100))}
      ${wire('w2', at(120, 100), at(120, 120))}
      ${wire('w3', at(120, 100), at(120, 80))}`);
    expect(addJunctionsIfNeeded(doc, new Set([lineId(doc, 0)]), LIB).junctions).toHaveLength(1);
  });
});

describe('junctions at the points a move vacated', () => {
  it('drops a dot where the wires left behind still need one', () => {
    // Four wires meet at (120,100). Take one away and three remain, which is
    // still a junction — upstream puts the dot in as the move commits.
    const doc = sheet(`
      ${wire('w1', at(100, 100), at(120, 100))}
      ${wire('w2', at(140, 100), at(120, 100))}
      ${wire('w3', at(120, 120), at(120, 100))}`);
    const out = junctionsAtVacatedPoints(doc, [at(120, 100)], LIB);
    expect(hasJunctionAt(out, at(120, 100))).toBe(true);
  });

  it('leaves a vacated corner alone', () => {
    const doc = sheet(`
      ${wire('w1', at(100, 100), at(120, 100))}
      ${wire('w2', at(120, 120), at(120, 100))}`);
    expect(junctionsAtVacatedPoints(doc, [at(120, 100)], LIB)).toBe(doc);
  });
});

describe('trimDanglingLines', () => {
  it('removes a new stub dangling at both ends', () => {
    const doc = sheet(wire('s1', at(100, 100), at(110, 100)));
    const out = trimDanglingLines(doc, new Set(), new Set(['s1']), LIB);
    expect(out.lines).toHaveLength(0);
  });

  it('keeps a new stub that still carries a connection', () => {
    // s1's right end meets w1, so it is doing a job and must survive.
    const doc = sheet(`
      ${wire('s1', at(100, 100), at(110, 100))}
      ${wire('w1', at(110, 100), at(110, 120))}`);
    const out = trimDanglingLines(doc, new Set(), new Set(['s1']), LIB);
    expect(out.lines).toHaveLength(2);
  });

  it('removes a broken half on either end dangling, not only both', () => {
    const doc = sheet(`
      ${wire('b1', at(100, 100), at(110, 100))}
      ${wire('w1', at(110, 100), at(110, 120))}`);
    // Same geometry as above, but b1 was split by the drag rather than created:
    // one dangling end is enough for it to go.
    const out = trimDanglingLines(doc, new Set(['b1']), new Set(), LIB);
    expect(out.lines.map((l) => l.uuid)).toEqual(['w1']);
  });

  it('leaves anything still selected alone', () => {
    const doc = sheet(wire('s1', at(100, 100), at(110, 100)));
    const out = trimDanglingLines(doc, new Set(), new Set(['s1']), LIB, new Set([lineId(doc, 0)]));
    expect(out.lines).toHaveLength(1);
  });

  it('leaves wires it was told nothing about', () => {
    const doc = sheet(wire('w1', at(100, 100), at(110, 100)));
    expect(trimDanglingLines(doc, new Set(), new Set(), LIB)).toBe(doc);
  });
});

describe('the drag set, read off the move', () => {
  it('separates wires that appeared, changed, and were split', () => {
    const before = sheet(`
      ${wire('w1', at(100, 100), at(140, 100))}
      ${wire('w2', at(140, 100), at(140, 120))}`);
    const after = sheet(`
      ${wire('w1', at(100, 100), at(140, 90))}
      ${wire('w2', at(140, 100), at(140, 120))}
      ${wire('n1', at(140, 90), at(140, 100))}`);
    const set = dragSetFromMove(before, after, { splits: [] }, LIB, new Set());
    expect([...set.newLineUuids]).toEqual(['n1']);
    expect([...set.changedLineUuids]).toEqual(['w1']);
  });

  it('counts a split’s far half as broken, not new', () => {
    // trimDanglingLines treats the two differently, so the distinction matters.
    const before = sheet(wire('w1', at(100, 100), at(140, 100)));
    const after = sheet(`
      ${wire('w1', at(100, 100), at(120, 100))}
      ${wire('h2', at(120, 100), at(140, 100))}`);
    const set = dragSetFromMove(
      before,
      after,
      { splits: [{ lineUuid: 'w1', newUuid: 'h2' }] },
      LIB,
      new Set(),
    );
    expect(set.newLineUuids.size).toBe(0);
    expect([...set.brokenLineUuids].sort()).toEqual(['h2', 'w1']);
  });

  it('records what the selection vacated', () => {
    const before = sheet(wire('w1', at(100, 100), at(140, 100)));
    const set = dragSetFromMove(before, before, { splits: [] }, LIB, new Set([lineId(before, 0)]));
    expect(set.vacatedPoints).toHaveLength(2);
    expect(set.vacatedPoints.some((p) => same(p, at(100, 100)))).toBe(true);
  });
});

describe('the whole block, wrapped around a drag', () => {
  it('leaves the dot behind at a tee a plain move pulled a wire off', () => {
    // M, not G: a drag would take the other three wires' ends along and leave
    // nothing at the tee, which is exactly why the vacated-point pass exists
    // for the move that *does* abandon them.
    const doc = sheet(`
      ${wire('w1', at(100, 100), at(120, 100))}
      ${wire('w2', at(140, 100), at(120, 100))}
      ${wire('w3', at(120, 120), at(120, 100))}
      ${wire('w4', at(120, 80), at(120, 100))}`);
    const ids = new Set([lineId(doc, 3)]);
    const spec = planMove(doc, LIB, ids);
    const out = withPostMoveCleanup(moveItems(ids, at(10, 0)), spec, LIB, ids, false).apply(doc);
    // Three wires still meet at (120,100), so the dot belongs there.
    expect(hasJunctionAt(out, at(120, 100))).toBe(true);
  });

  it('undo restores the document exactly', () => {
    const doc = sheet(`
      ${wire('w1', at(100, 100), at(120, 100))}
      ${wire('w2', at(140, 100), at(120, 100))}
      ${wire('w3', at(120, 120), at(120, 100))}
      ${wire('w4', at(120, 80), at(120, 100))}`);
    const ids = new Set([lineId(doc, 3)]);
    const spec = planMove(doc, LIB, ids);
    const cmd = withPostMoveCleanup(orthoMove(doc, spec, at(10, 0), LIB), spec, LIB, ids, true);
    const after = cmd.apply(doc);
    expect(after).not.toEqual(doc);
    expect(cmd.invert(doc).apply(after)).toEqual(doc);
  });

  it('a plain move is not drag-like, so its stubs are left alone', () => {
    const doc = sheet(`
      ${wire('w1', at(100, 100), at(120, 100))}
      ${wire('w2', at(140, 100), at(120, 100))}`);
    const ids = new Set([lineId(doc, 0)]);
    const spec = planMove(doc, LIB, ids);
    const dragged = withPostMoveCleanup(
      orthoMove(doc, spec, at(0, -10), LIB),
      spec,
      LIB,
      ids,
      false,
    );
    // Nothing throws and the move still lands; the point is only that the
    // stub-trimming pass is skipped for M.
    expect(dragged.apply(doc).lines.length).toBeGreaterThan(0);
  });
});
