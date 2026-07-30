/**
 * Free text is not a connectable item.
 *
 * SCH_TEXT never overrides SCH_ITEM::IsConnectable(), which returns false
 * (sch_item.h), only SCH_LABEL, SCH_GLOBALLABEL, SCH_HIERLABEL and
 * SCH_DIRECTIVE_LABEL return true (sch_label.h). So a plain text note has no
 * electrical anchor: dragging it must not pull wires along, must not cut the
 * wire it happens to lie over, and it must not ride a wire that moves. A net
 * label sitting at the same spot must still do all three.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { collectAnchors } from '@ziroeda/eeschema/src/tools/snap.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const NO_LIB = new Map<string, LibSymbol>();

/** A wire with one item sitting on it at 110 mm: either a label or free text. */
function sheet(kind: 'label' | 'text'): Schematic {
  const item =
    kind === 'label'
      ? '(label "NET" (at 110 100 0) (effects (font (size 1.27 1.27))) (uuid "i1"))'
      : '(text "a note" (at 110 100 0) (effects (font (size 1.27 1.27))) (uuid "i1"))';
  return readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w1"))
      ${item})`),
  );
}

const itemId = (doc: Schematic) => refId('label', doc.labels[0]!.uuid, 0);
const wire = (doc: Schematic) => doc.lines[0]!;

describe('free text is not connectable', () => {
  it('is parsed as text, and the label case as a label', () => {
    expect(sheet('text').labels[0]!.kind).toBe('text');
    expect(sheet('label').labels[0]!.kind).toBe('label');
  });

  it('contributes no connection point to a move', () => {
    const text = sheet('text');
    const label = sheet('label');
    // A dragged label cuts the wire it sits on; dragged text does not.
    expect(planMove(text, NO_LIB, new Set([itemId(text)])).splits).toHaveLength(0);
    expect(planMove(label, NO_LIB, new Set([itemId(label)])).splits.length).toBeGreaterThan(0);
  });

  it('leaves the wire alone when dragged', () => {
    const doc = sheet('text');
    const before = wire(doc);
    const delta = { x: 0, y: mmToIU(-10) };
    const spec = planMove(doc, NO_LIB, new Set([itemId(doc)]));

    for (const cmd of [orthoMove(doc, spec, delta, NO_LIB), moveWithConnections(spec, delta)]) {
      const after = cmd.apply(doc);
      expect(after.lines).toHaveLength(1); // no stub, no split
      expect(after.lines[0]!.start).toEqual(before.start);
      expect(after.lines[0]!.end).toEqual(before.end);
      // ...and the text itself did move.
      expect(after.labels[0]!.at.y).toBe(doc.labels[0]!.at.y + delta.y);
    }
  });

  it('drags the wire when the same spot holds a label instead', () => {
    const doc = sheet('label');
    const delta = { x: 0, y: mmToIU(-10) };
    const spec = planMove(doc, NO_LIB, new Set([itemId(doc)]));
    const after = orthoMove(doc, spec, delta, NO_LIB).apply(doc);
    // The label is connectable, so the wire follows it, more geometry than we
    // started with, however upstream chooses to bend or split it.
    expect(after.lines.length).toBeGreaterThan(1);
  });

  it('does not ride a wire that moves under it', () => {
    const text = sheet('text');
    const label = sheet('label');
    const wireId = (d: Schematic) => refId('line', d.lines[0]!.uuid, 0);
    expect(planMove(text, NO_LIB, new Set([wireId(text)])).labelRides).toHaveLength(0);
    expect(planMove(label, NO_LIB, new Set([wireId(label)])).labelRides.length).toBeGreaterThan(0);
  });

  it('is not a snap anchor', () => {
    const at = sheet('text').labels[0]!.at;
    const textAnchors = collectAnchors(sheet('text'), NO_LIB);
    const labelAnchors = collectAnchors(sheet('label'), NO_LIB);
    const has = (pts: readonly { x: number; y: number }[]) =>
      pts.some((p) => p.x === at.x && p.y === at.y);
    expect(has(textAnchors)).toBe(false);
    expect(has(labelAnchors)).toBe(true);
  });
});
