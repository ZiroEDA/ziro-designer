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
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/tools/connect.js';
import { moveWithConnections } from '@ziroeda/eeschema/tools/move.js';
import { withPostMoveCleanup } from '@ziroeda/eeschema/tools/post_move_cleanup.js';
import { withCleanup } from '@ziroeda/eeschema/tools/cleanup.js';
import { refId } from '@ziroeda/eeschema/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/eda_units.js';
import type { EditCommand } from '@ziroeda/eeschema/tools/command.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/types.js';

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
const drag = (doc: Schematic, delta: Vec2, _mode: 'free'): Schematic => {
  const sel = new Set([refId('symbol', doc.symbols[0]!.uuid, 0)]);
  const spec = planMove(doc, LIB, sel);
  const move: EditCommand = moveWithConnections(spec, delta);
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
