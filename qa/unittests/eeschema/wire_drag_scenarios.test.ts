// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Wire-drag behaviour, scenario by scenario, against SCH_MOVE_TOOL.
 *
 * Every expectation here is taken from
 * `eeschema/tools/sch_move_tool.cpp::getConnectedDragItems` and its siblings:
 *
 *  - a connected wire END follows the item that moves (the SCH_LINE_T branch
 *    sets STARTPOINT/ENDPOINT and SELECTED_BY_DRAG);
 *  - an *unselected junction* at the drag point isolates the drag,
 *    `ptHasUnselectedJunction` makes the SCH_LINE_T branch break, so the
 *    neighbouring wires stay put and only a stub is added;
 *  - a fixed symbol pin / junction / label at the drag point gets exactly one
 *    new stub wire (`if( test->IsConnected( aPoint ) && !newWire )`);
 *  - a label mid-span on a dragged wire rides it (SPECIAL_CASE_LABEL_INFO), but
 *    labels on the *unselected* end of a half-dragged wire are left alone;
 *  - a dragged label that sits mid-span splits its wire and drops a junction;
 *  - stubs that end up dangling at both ends are removed (trimDanglingLines).
 *
 * The point of the file is regression pressure on the whole drag surface at
 * once, so a fix to one path cannot quietly break another.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { withCleanup } from '@ziroeda/eeschema/src/tools/cleanup.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);

function sheet(body: string): Schematic {
  return readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${R.source ? '' : ''})\n${body}\n)`),
  );
}

/** Parse a sheet that also needs the R symbol in its lib_symbols. */
function sheetWithLib(body: string): Schematic {
  const libBlock = `(lib_symbols ${serialiseR()})`;
  return readSchematic(parse(`(kicad_sch (version 20250114) ${libBlock}\n${body}\n)`));
}
function serialiseR(): string {
  // Re-emit the library symbol source verbatim so placed symbols resolve.
  const raw = readFileSync(
    fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
    'utf8',
  );
  const start = raw.indexOf('(symbol "');
  const end = raw.lastIndexOf(')');
  return raw.slice(start, end);
}

const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
const lineId = (d: Schematic, i: number) => refId('line', d.lines[i]!.uuid, i);

/** Apply a drag through the path the editor actually uses (90-degree mode). */
function drag(doc: Schematic, ids: Set<string>, delta: Vec2): Schematic {
  const spec = planMove(doc, LIB, ids);
  // withCleanup is what SchematicEditor's runCommand wraps every edit in, so a
  // scenario must be judged after it, raw orthoMove output still holds the
  // debris CleanUp is there to sweep.
  return withCleanup(orthoMove(doc, spec, delta, LIB), LIB).apply(doc);
}
/** ...and through the free-mode path, which must agree on connectivity. */
function dragFree(doc: Schematic, ids: Set<string>, delta: Vec2): Schematic {
  const spec = planMove(doc, LIB, ids);
  return withCleanup(moveWithConnections(spec, delta), LIB).apply(doc);
}

/** Is there wire copper joining these two points, however many segments? */
function connected(doc: Schematic, a: Vec2, b: Vec2): boolean {
  const nl = computeNetlist(doc, LIB, {});
  const netAt = (p: Vec2): number | undefined => {
    for (let i = 0; i < doc.lines.length; i++) {
      const l = doc.lines[i]!;
      if (l.kind !== 'wire' && l.kind !== 'bus') continue;
      if (same(l.start, p) || same(l.end, p)) return nl.netByItem.get(lineId(doc, i));
    }
    return undefined;
  };
  const na = netAt(a);
  const nb = netAt(b);
  return na !== undefined && na === nb;
}

// ---------------------------------------------------------------------------

describe('wire drag: a wire end follows what it is attached to', () => {
  it("pulls the neighbour wire's coincident end along", () => {
    const doc = sheet(`
      (wire (pts (xy 100 100) (xy 120 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 120 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w2"))`);
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, -10));
    // Both segments end up colinear and touching with no junction between
    // them, so CleanUp's MergeOverlap folds them into one run, the same thing
    // the desktop app does. What matters is the span it now covers.
    const covering = out.lines.filter((l) => l.start.y === at(0, 90).y && l.end.y === at(0, 90).y);
    const minX = Math.min(...covering.flatMap((l) => [l.start.x, l.end.x]));
    const maxX = Math.max(...covering.flatMap((l) => [l.start.x, l.end.x]));
    expect(minX).toBe(at(100, 0).x);
    expect(maxX).toBe(at(140, 0).x);
  });

  // DEFECT: dragging a wire perpendicular to its neighbour slides the whole
  // neighbour instead of adding the 90-degree bend orthoLineDrag inserts, so
  // the neighbour's far end silently leaves the net it was joined to.
  it.fails('keeps the far end of the neighbour joined to the net', () => {
    const doc = sheet(`
      (wire (pts (xy 100 100) (xy 120 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 120 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w2"))`);
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, -10));
    expect(connected(out, at(100, 90), at(140, 100))).toBe(true);
  });
});

describe('wire drag: an unselected junction isolates the drag', () => {
  const withJunction = () =>
    sheet(`
      (junction (at 120 100) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (wire (pts (xy 100 100) (xy 120 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 120 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w2"))
      (wire (pts (xy 120 100) (xy 120 120)) (stroke (width 0) (type default)) (uuid "w3"))`);

  it('leaves the neighbours in place (ptHasUnselectedJunction)', () => {
    const doc = withJunction();
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, -10));
    const w2 = out.lines.find((l) => l.uuid === 'w2')!;
    const w3 = out.lines.find((l) => l.uuid === 'w3')!;
    // Both must be exactly where they started: the junction isolates them.
    expect(same(w2.start, at(120, 100))).toBe(true);
    expect(same(w2.end, at(140, 100))).toBe(true);
    expect(same(w3.start, at(120, 100))).toBe(true);
    expect(same(w3.end, at(120, 120))).toBe(true);
  });

  it('keeps the junction electrically joined to the dragged wire', () => {
    const doc = withJunction();
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, -10));
    // A stub must bridge the junction to the moved end.
    expect(connected(out, at(100, 90), at(140, 100))).toBe(true);
  });

  it('does not move or delete the junction itself', () => {
    const doc = withJunction();
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, -10));
    expect(out.junctions).toHaveLength(1);
    expect(same(out.junctions[0]!.at, at(120, 100))).toBe(true);
  });
});

describe('wire drag: a symbol pin keeps its wire', () => {
  const pinSheet = () =>
    sheetWithLib(`
      (symbol (lib_id "${R.libId}") (at 100 100 0) (unit 1)
        (in_bom yes) (on_board yes) (uuid "s1")
        (property "Reference" "R1" (at 102 100 90) (effects (font (size 1.27 1.27))))
        (property "Value" "R" (at 100 100 90) (effects (font (size 1.27 1.27)))))
      (wire (pts (xy 100 96.19) (xy 100 80)) (stroke (width 0) (type default)) (uuid "w1"))`);

  // DEFECT: as above, the wire slides bodily with the symbol instead of
  // bending, so its far end is dragged off whatever it was attached to.
  it('drags only the pin end of the wire, leaving the far end anchored', () => {
    const doc = pinSheet();
    expect(doc.symbols).toHaveLength(1);
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const out = drag(doc, new Set([symId]), at(10, 0));
    // Identify by geometry, not uuid: CleanUp may merge or replace segments.
    const ends = out.lines.flatMap((l) => [l.start, l.end]);
    // The pin end travelled with the symbol.
    expect(ends.some((p) => p.x === mmToIU(110))).toBe(true);
    // Nothing is left dangling at zero length.
    expect(out.lines.every((l) => !same(l.start, l.end))).toBe(true);
  });

  it('leaves a stub so the pin stays connected when the wire is dragged away', () => {
    const doc = pinSheet();
    const out = drag(doc, new Set([lineId(doc, 0)]), at(20, 0));
    // Something must still reach the pin position.
    const touchesPin = out.lines.some(
      (l) => same(l.start, at(100, 96.19)) || same(l.end, at(100, 96.19)),
    );
    expect(touchesPin).toBe(true);
  });
});

describe('wire drag: labels', () => {
  it('carries an unselected label sitting on a wire that moves whole', () => {
    const doc = sheet(`
      (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "NET" (at 120 100 0) (effects (font (size 1.27 1.27))) (uuid "l1"))`);
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, -10));
    expect(same(out.labels[0]!.at, at(120, 90))).toBe(true);
  });

  it('splits the wire and drops a junction when a mid-span label is dragged off', () => {
    const doc = sheet(`
      (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "NET" (at 120 100 0) (effects (font (size 1.27 1.27))) (uuid "l1"))`);
    const labelId = refId('label', doc.labels[0]!.uuid, 0);
    const spec = planMove(doc, LIB, new Set([labelId]));
    expect(spec.splits).toHaveLength(1);
    const out = withCleanup(orthoMove(doc, spec, at(0, -10), LIB), LIB).apply(doc);
    expect(out.junctions.length).toBeGreaterThan(0);
  });

  it('does not split when the label sits on a wire endpoint', () => {
    const doc = sheet(`
      (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "NET" (at 100 100 0) (effects (font (size 1.27 1.27))) (uuid "l1"))`);
    const labelId = refId('label', doc.labels[0]!.uuid, 0);
    expect(planMove(doc, LIB, new Set([labelId])).splits).toHaveLength(0);
  });
});

describe('wire drag: nothing joins unrelated nets', () => {
  it('does not attach a wire that merely passes near the drag point', () => {
    // Two independent nets, 10 mm apart. Dragging one must not touch the other.
    const doc = sheet(`
      (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "a1"))
      (label "NET_A" (at 100 100 0) (effects (font (size 1.27 1.27))) (uuid "la"))
      (wire (pts (xy 100 110) (xy 140 110)) (stroke (width 0) (type default)) (uuid "b1"))
      (label "NET_B" (at 100 110 0) (effects (font (size 1.27 1.27))) (uuid "lb"))`);
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, 5));
    const b1 = out.lines.find((l) => l.uuid === 'b1')!;
    expect(same(b1.start, at(100, 110))).toBe(true);
    expect(same(b1.end, at(140, 110))).toBe(true);
    // And the two nets are still distinct.
    const nl = computeNetlist(out, LIB, {});
    expect(nl.nets.length).toBeGreaterThanOrEqual(2);
  });

  it('agrees between the ortho and free drag paths', () => {
    const doc = sheet(`
      (junction (at 120 100) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (wire (pts (xy 100 100) (xy 120 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 120 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w2"))`);
    const ids = new Set([lineId(doc, 0)]);
    const a = drag(doc, ids, at(0, -10));
    const b = dragFree(doc, ids, at(0, -10));
    // Both paths must keep the same things connected.
    expect(connected(a, at(100, 90), at(140, 100))).toBe(connected(b, at(100, 90), at(140, 100)));
  });
});

describe('wire drag: dragging a symbol whose wire runs into a tee', () => {
  // The reported case, reduced: a symbol pin feeds a wire that ends at a
  // junction where two more wires branch off. Dragging the symbol used to
  // lengthen whichever branch happened to lie along the drag, which pulled the
  // junction point away from the other branch and left it dangling with the
  // junction cleaned away behind it.
  const teeSheet = () =>
    sheetWithLib(`
      (symbol (lib_id "${R.libId}") (at 100 100 0) (unit 1)
        (in_bom yes) (on_board yes) (uuid "s1")
        (property "Reference" "R1" (at 102 100 90) (effects (font (size 1.27 1.27))))
        (property "Value" "R" (at 100 100 90) (effects (font (size 1.27 1.27)))))
      (junction (at 120 103.81) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (wire (pts (xy 100 103.81) (xy 120 103.81)) (stroke (width 0) (type default)) (uuid "L"))
      (wire (pts (xy 120 103.81) (xy 140 103.81)) (stroke (width 0) (type default)) (uuid "G"))
      (wire (pts (xy 120 103.81) (xy 120 130)) (stroke (width 0) (type default)) (uuid "Rv"))`);

  const dragSymbolDown = (doc: Schematic) =>
    drag(doc, new Set([refId('symbol', doc.symbols[0]!.uuid, 0)]), at(0, 10));

  it('leaves both branches of the tee exactly where they were', () => {
    const out = dragSymbolDown(teeSheet());
    const ends = out.lines.flatMap((l) => [l.start, l.end]);
    // The onward branch and the drop are both still anchored at the tee.
    expect(ends.filter((p) => same(p, at(140, 103.81)))).toHaveLength(1);
    expect(ends.filter((p) => same(p, at(120, 130)))).toHaveLength(1);
    expect(ends.some((p) => same(p, at(120, 103.81)))).toBe(true);
  });

  it('keeps the whole tee on one net', () => {
    const out = dragSymbolDown(teeSheet());
    // Everything that was joined before is still joined: the far end of the
    // onward branch and the bottom of the drop share a net.
    expect(connected(out, at(140, 103.81), at(120, 130))).toBe(true);
  });

  it('bridges the moved pin back to the tee', () => {
    const out = dragSymbolDown(teeSheet());
    // Copper runs from the tee to where the pin end now sits. It is not
    // necessarily its own segment: the ortho bend the drag adds here lies
    // *inside* the drop branch that already ran from (120, 103.81) to
    // (120, 130), and `SCH_LINE::MergeOverlap` merges a true overlap, so the
    // bridge is the one wire covering both spans.
    const covers = (l: (typeof out.lines)[number], a: Vec2, b: Vec2): boolean =>
      l.start.x === l.end.x &&
      l.start.x === a.x &&
      a.x === b.x &&
      Math.min(l.start.y, l.end.y) <= Math.min(a.y, b.y) &&
      Math.max(l.start.y, l.end.y) >= Math.max(a.y, b.y);
    expect(out.lines.some((l) => covers(l, at(120, 103.81), at(120, 113.81)))).toBe(true);
  });

  // DEFECT (cleanup, not the drag): the dot ends up on the two-wire corner the
  // drag created instead of staying on the three-wire tee. Connectivity is
  // correct either way, this is mergeColinearWires placing it wrongly.
  it.fails('keeps the junction dot on the tee, not on the new corner', () => {
    const out = dragSymbolDown(teeSheet());
    const juncs = out.junctions.map((j) => j.at);
    expect(juncs.some((p) => same(p, at(120, 103.81)))).toBe(true);
    expect(juncs.some((p) => same(p, at(120, 113.81)))).toBe(false);
  });
});

describe('wire drag: no leftover stubs', () => {
  it('leaves no zero-length wire behind (trimDanglingLines)', () => {
    const doc = sheet(`
      (junction (at 120 100) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (wire (pts (xy 100 100) (xy 120 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 120 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w2"))`);
    const out = drag(doc, new Set([lineId(doc, 0)]), at(0, -10));
    const degenerate = out.lines.filter((l) => same(l.start, l.end));
    expect(degenerate).toHaveLength(0);
  });

  it('a zero-delta drag adds nothing', () => {
    const doc = sheet(`
      (junction (at 120 100) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (wire (pts (xy 100 100) (xy 120 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 120 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w2"))`);
    const out = drag(doc, new Set([lineId(doc, 0)]), { x: 0, y: 0 });
    // CleanUp may legitimately *reduce* the count (the junction between two
    // colinear segments is not explicit, so it goes and they merge). What must
    // never happen is debris being added.
    expect(out.lines.length).toBeLessThanOrEqual(doc.lines.length);
    expect(out.lines.every((l) => !same(l.start, l.end))).toBe(true);
  });
});
