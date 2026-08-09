// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a net label ends up when the symbol its wire runs to is dragged.
 *
 * `SCH_MOVE_TOOL::moveItem` never translates a label that is in
 * `m_specialCaseLabels` — which is every label sitting on a wire the drag
 * picked up:
 *
 *     case SCH_LABEL_T: ...
 *         if( !m_specialCaseLabels.count( label ) )
 *             label->Move( aDelta );
 *
 * Its position is recomputed instead, from how far each *end of its wire*
 * moved (the `m_specialCaseLabels` block at the end of `doMoveSelection`):
 *
 *     if( deltaStart == deltaEnd )  label->SetPosition( originalLabelPos + deltaStart );
 *     else                          label->SetPosition( originalLabelPos + fixedEndDelta );
 *
 * So a wire that translates whole takes its labels along, and a wire with only
 * one end dragged leaves them exactly where they are — `fixedEndDelta` is zero
 * by construction. They are pulled back onto the wire only when it has shrunk
 * past them, "otherwise the label can drift off the end of the line, and change
 * connectivity".
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { withPostMoveCleanup } from '@ziroeda/eeschema/src/tools/post_move_cleanup.js';
import { withCleanup } from '@ziroeda/eeschema/src/tools/cleanup.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { EditCommand } from '@ziroeda/eeschema/src/tools/command.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const at = (x: number, y: number): Vec2 => ({ x: mmToIU(x), y: mmToIU(y) });
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** R1 vertical at (100,100); its lower pin at (100,103.81) feeds a wire down to
 *  (100,120), with NET1 sitting on that wire at (100,110). */
const build = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
      (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 105 100 0))
        (property "Value" "10k" (at 107 100 0)))
      (wire (pts (xy 100 103.81) (xy 100 120)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "NET1" (at 100 110 0) (effects (font (size 1.27 1.27))) (uuid "l1")))`),
  );

/** The whole drop, as the canvas composes it, for one of the two line modes. */
const drag = (doc: Schematic, delta: Vec2, mode: 'ortho' | 'free'): Schematic => {
  const sel = new Set([refId('symbol', doc.symbols[0]!.uuid, 0)]);
  const spec = planMove(doc, LIB, sel);
  const move: EditCommand =
    mode === 'ortho' ? orthoMove(doc, spec, delta, LIB) : moveWithConnections(spec, delta);
  return withCleanup(withPostMoveCleanup(move, spec, LIB, sel, true), LIB).apply(doc);
};

const labelAt = (d: Schematic): Vec2 => d.labels[0]!.at;
/**
 * Is `p` sitting on a wire (i.e. still electrically attached)?
 * `SCH_LINE::HitTest( pos, 1 )`: within an internal unit of the segment, which
 * is a *distance*, so a diagonal wire is measured perpendicular to itself.
 */
const onWire = (d: Schematic, p: Vec2): boolean =>
  d.lines.some((l) => {
    const dx = l.end.x - l.start.x;
    const dy = l.end.y - l.start.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return false;
    const t = Math.max(0, Math.min(1, ((p.x - l.start.x) * dx + (p.y - l.start.y) * dy) / len2));
    return Math.hypot(p.x - (l.start.x + t * dx), p.y - (l.start.y + t * dy)) <= 1;
  });
const onSomeWire = (d: Schematic): boolean => onWire(d, labelAt(d));

describe('dragging a symbol sideways, 90 degree line mode (the default)', () => {
  it('leaves the label exactly where it was', () => {
    // The reported bug, and it was spectacular rather than subtle: the label
    // jumped from mid-wire to the symbol's new pin position, several
    // millimetres away.
    //
    // The cause was the wire it rode on collapsing to zero length. An ortho
    // drag perpendicular to a wire keeps the wire's span where it is and adds a
    // jog next to the pin that moved, which upstream does by leaving `a` in
    // place and letting the original line collapse. Our "if the wire shrank
    // past the label, put the label back on the wire" repair then asked for the
    // nearest point of a zero-length segment, which is just that segment's
    // position — the moved pin.
    const out = drag(build(), { x: -mmToIU(5), y: 0 }, 'ortho');
    expect(same(labelAt(out), at(100, 110))).toBe(true);
  });

  it('and the label is still on a wire, so the net is unchanged', () => {
    const out = drag(build(), { x: -mmToIU(5), y: 0 }, 'ortho');
    expect(onSomeWire(out)).toBe(true);
  });

  it('keeps the wire span it was labelling, and jogs at the pin instead', () => {
    // The shape upstream produces: the run the label sits on stays put and a
    // new segment carries the pin's new position back to it.
    //
    // The elbow lands one grid short of the moving end rather than on it —
    // `int xBendCount = 1` in `doMoveSelection` — so the run gives up one grid
    // at the pin end and the drag leaves a one-grid stub running into the pin.
    // The label is at (100, 110), nowhere near either, so it does not move.
    const out = drag(build(), { x: -mmToIU(5), y: 0 }, 'ortho');
    const has = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
      out.lines.some(
        (l) => (same(l.start, a) && same(l.end, b)) || (same(l.end, a) && same(l.start, b)),
      );

    // The run, one grid shorter at the pin end.
    expect(has(at(100, 105.08), at(100, 120))).toBe(true);
    // The jog across to the new pin column.
    expect(has(at(95, 105.08), at(100, 105.08))).toBe(true);
    // The stub into the pin, along the wire's own axis.
    expect(has(at(95, 103.81), at(95, 105.08))).toBe(true);
  });
});

describe('dragging a symbol sideways, free line mode', () => {
  it('pulls the label back onto the wire, which is now diagonal', () => {
    // Here the wire really does stretch under the label, so `fixedEndDelta` is
    // zero and the label would stay at (100,110) — but that point is no longer
    // on the line, and upstream then does
    // `label->SetPosition( SEG( start, end ).NearestPoint( label->GetPosition() ) )`
    // precisely so the label does not drift off and change connectivity.
    const out = drag(build(), { x: -mmToIU(5), y: 0 }, 'free');
    expect(same(labelAt(out), at(100, 110))).toBe(false);
    expect(onSomeWire(out)).toBe(true);
  });
});

describe('dragging a hierarchical sheet with labelled wires on its pins', () => {
  // A sheet at (100,50) 40x30 with three pins down its left edge, each fed by a
  // horizontal wire from a net label 20 mm to the left. Moving the sheet drags
  // three wire ends at once, which is where the failure was loudest: every one
  // of those labels ended up stacked beside the sheet, one grid step apart.
  const sheet = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (sheet (at 100 50) (size 40 30) (uuid "sh1")
          (property "Sheetname" "xilinx" (at 100 49 0))
          (property "Sheetfile" "xilinx.kicad_sch" (at 100 81 0))
          (pin "IRQ_1" input (at 100 60 180) (uuid "p1"))
          (pin "IRQ_2" input (at 100 65 180) (uuid "p2"))
          (pin "IRQ_3" input (at 100 70 180) (uuid "p3")))
        (wire (pts (xy 80 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "w1"))
        (wire (pts (xy 80 65) (xy 100 65)) (stroke (width 0) (type default)) (uuid "w2"))
        (wire (pts (xy 80 70) (xy 100 70)) (stroke (width 0) (type default)) (uuid "w3"))
        (label "IRQ_1" (at 80 60 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
        (label "IRQ_2" (at 80 65 0) (effects (font (size 1.27 1.27))) (uuid "l2"))
        (label "IRQ_3" (at 80 70 0) (effects (font (size 1.27 1.27))) (uuid "l3")))`),
    );

  const dragSheet = (delta: Vec2): Schematic => {
    const doc = sheet();
    const sel = new Set([refId('sheet', 'sh1', 0)]);
    const spec = planMove(doc, LIB, sel);
    const cmd = withPostMoveCleanup(orthoMove(doc, spec, delta, LIB), spec, LIB, sel, true);
    return withCleanup(cmd, LIB).apply(doc);
  };

  it('leaves every label where it was', () => {
    // `orthoLineDrag` hands each wire's *span* to the new segment it creates at
    // the far end and lets the original collapse towards the pin — so a label
    // that still points at the original uuid is now pointing at a stub beside
    // the sheet. Upstream re-parents it as part of the same step
    // (`m_specialCaseLabels[label].attachedLine = a`); that port was missing.
    const out = dragSheet({ x: mmToIU(10), y: -mmToIU(10) });
    const by = new Map(out.labels.map((l) => [l.text, l.at]));
    expect(same(by.get('IRQ_1')!, at(80, 60))).toBe(true);
    expect(same(by.get('IRQ_2')!, at(80, 65))).toBe(true);
    expect(same(by.get('IRQ_3')!, at(80, 70))).toBe(true);
  });

  it('and does not stack them one grid step apart beside the sheet', () => {
    // The exact signature of the bug: the bend counter offsets each wire by one
    // grid step so parallel drags do not overlap, so the labels landed in a
    // staircase at 1.27 mm intervals next to the moved sheet.
    const out = dragSheet({ x: mmToIU(10), y: -mmToIU(10) });
    const xs = new Set(out.labels.map((l) => l.at.x));
    expect(xs.size).toBe(1);
    expect([...xs][0]).toBe(mmToIU(80));
  });

  it('keeps each label on a wire, so no net is broken', () => {
    const out = dragSheet({ x: mmToIU(10), y: -mmToIU(10) });
    for (let i = 0; i < out.labels.length; i++) expect(onWire(out, out.labels[i]!.at)).toBe(true);
  });
});

describe('dragging a symbol along its wire', () => {
  it('leaves the label alone: the wire only stretches under it', () => {
    // Nothing forces the label off the line, so `originalLabelPos + 0` stands.
    const out = drag(build(), { x: 0, y: -mmToIU(5) }, 'ortho');
    expect(same(labelAt(out), at(100, 110))).toBe(true);
    expect(onSomeWire(out)).toBe(true);
  });
});
