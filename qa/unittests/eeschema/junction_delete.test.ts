// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Deleting a junction dot has to make the connection go away, not just the dot.
 *
 * A dot removed on its own does not stay removed: the tee it sat on is still a
 * tee, so the next `CleanUp` pass finds a junction is needed there and puts one
 * back. Upstream never reaches that state, because `SCH_EDIT_TOOL::DoDelete`
 * routes a selected junction through `SCH_EDIT_FRAME::DeleteJunction`, which
 * fuses the colinear wires that met on it:
 *
 *     if( SCH_LINE* new_line = secondLine->MergeOverlap( screen, firstLine, false ) )
 *
 * — `aCheckJunctions` false, so the merge may bridge the point the junction was
 * on. The two segments become one wire running through, the third ends in the
 * middle of it, and no junction is called for any more.
 *
 * And the dot goes whether or not the tee would ask for one, because the
 * deleted flag is tested before the "is it needed" question:
 *
 *     if( junction->HasFlag( STRUCT_DELETED ) || !screen->IsExplicitJunction( point ) )
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import { deleteByIds } from '@ziroeda/eeschema/src/tools/mutate.js';
import { deleteItems, withCleanup } from '@ziroeda/eeschema/src/tools/cleanup.js';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** A tee: two colinear wires meeting a third, with a dot on the meeting point. */
const tee = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (wire (pts (xy 50 100) (xy 100 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 100 100) (xy 150 100)) (stroke (width 0) (type default)) (uuid "w2"))
      (wire (pts (xy 100 100) (xy 100 150)) (stroke (width 0) (type default)) (uuid "w3"))
      (junction (at 100 100) (diameter 0) (color 0 0 0 0) (uuid "j1")))`),
  );

const JID = refId('junction', 'j1', 0);
const run = (doc: Schematic, ids: Set<string>): Schematic =>
  withCleanup(deleteItems(doc, ids)).apply(doc);

describe('deleting a junction dot', () => {
  it('used to come straight back, which is the bug', () => {
    // The plain delete still behaves that way; it is what `deleteItems` wraps.
    const doc = tee();
    expect(doc.junctions).toHaveLength(1);
    expect(withCleanup(deleteByIds(new Set([JID]))).apply(doc).junctions).toHaveLength(1);
  });

  it('stays deleted', () => {
    expect(run(tee(), new Set([JID])).junctions).toHaveLength(0);
  });

  it('because the two colinear wires are fused into one', () => {
    const out = run(tee(), new Set([JID]));
    const horizontals = out.lines.filter((l) => l.start.y === l.end.y);
    expect(horizontals).toHaveLength(1);
    const h = horizontals[0]!;
    expect(new Set([h.start.x, h.end.x])).toEqual(new Set([mmToIU(50), mmToIU(150)]));
    // The third wire is untouched.
    expect(out.lines.filter((l) => l.start.x === l.end.x)).toHaveLength(1);
  });

  it('and the branch is genuinely disconnected afterwards', () => {
    // Which is the point of deleting a dot at all: a wire ending on the middle
    // of another is only connected when a junction says so, which is why
    // `IsExplicitJunctionNeeded` flags the point in the first place.
    const labelled = (extra: string): Schematic =>
      readSchematic(
        parse(`(kicad_sch (version 20250114) (lib_symbols)
          (wire (pts (xy 50 100) (xy 100 100)) (stroke (width 0) (type default)) (uuid "w1"))
          (wire (pts (xy 100 100) (xy 150 100)) (stroke (width 0) (type default)) (uuid "w2"))
          (wire (pts (xy 100 100) (xy 100 150)) (stroke (width 0) (type default)) (uuid "w3"))
          (label "MAIN" (at 50 100 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
          (label "BRANCH" (at 100 150 90) (effects (font (size 1.27 1.27))) (uuid "l2"))
          ${extra})`),
      );
    const before = labelled('(junction (at 100 100) (diameter 0) (color 0 0 0 0) (uuid "j1"))');
    expect(computeNetlist(before, new Map()).nets).toHaveLength(1);
    const after = withCleanup(deleteItems(before, new Set([JID]))).apply(before);
    expect(after.junctions).toHaveLength(0);
    expect(computeNetlist(after, new Map()).nets).toHaveLength(2);
  });

  it('leaves a selection with no junction in it exactly as it was', () => {
    const doc = tee();
    const wire = refId('line', 'w3', 2);
    const out = run(doc, new Set([wire]));
    // The two colinear wires that are left merge into one, and the junction is
    // no longer explicit, so ordinary cleanup drops it — that path was already
    // right, and `deleteItems` must not disturb it.
    expect(out.lines).toHaveLength(1);
    expect(out.junctions).toHaveLength(0);
  });

  it('undo puts the dot and both wires back', () => {
    const doc = tee();
    const cmd = withCleanup(deleteItems(doc, new Set([JID])));
    const after = cmd.apply(doc);
    const back = cmd.invert(doc).apply(after);
    expect(back.junctions).toHaveLength(1);
    expect(back.lines).toHaveLength(3);
  });
});

describe('a four-way crossing with a dot', () => {
  // Four segments meeting at a point: deleting the dot fuses both colinear
  // pairs, leaving two wires that merely cross.
  const cross = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (wire (pts (xy 50 100) (xy 100 100)) (stroke (width 0) (type default)) (uuid "a"))
        (wire (pts (xy 100 100) (xy 150 100)) (stroke (width 0) (type default)) (uuid "b"))
        (wire (pts (xy 100 50) (xy 100 100)) (stroke (width 0) (type default)) (uuid "c"))
        (wire (pts (xy 100 100) (xy 100 150)) (stroke (width 0) (type default)) (uuid "d"))
        (junction (at 100 100) (diameter 0) (color 0 0 0 0) (uuid "j1")))`),
    );

  it('becomes two crossing wires and no dot', () => {
    const out = run(cross(), new Set([JID]));
    expect(out.junctions).toHaveLength(0);
    expect(out.lines).toHaveLength(2);
    // ...and crossing without a dot is *not* a connection, which is the one
    // case where deleting the dot really does change the netlist.
    expect(out.lines.every((l) => l.start.x === l.end.x || l.start.y === l.end.y)).toBe(true);
  });
});
