// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One edit, several sheets, one undo step.
 *
 * `SCH_COMMIT` stages each item with the SCH_SCREEN it belongs to and `Push`
 * puts a SINGLE entry on the frame's undo list, so undoing a Move To Sheet
 * takes the items off the destination and puts them back on the source
 * together. Ours had one `History` per document and no way to say that: the two
 * halves went on as two independent entries, and undoing the source half left
 * the copy on the destination.
 *
 * That is not a cosmetic difference. Undo that restores one side and keeps the
 * other DUPLICATES the items — same references, two sheets — which is worse
 * than the edit it was meant to revert.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { History, type EditCommand } from '@ziroeda/eeschema/src/tools/command.js';
import { addItems, deleteByIds } from '@ziroeda/eeschema/src/tools/mutate.js';
import { makeJunctionWithUuid } from '@ziroeda/eeschema/src/tools/build.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const MM = 10000;

const doc = (body: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "eeschema")
${body}
  (sheet_instances (path "/" (page "1"))))`),
  );

const junction = (uuid: string, x: number, y: number): string =>
  `  (junction (at ${x} ${y}) (diameter 0) (color 0 0 0 0) (uuid "${uuid}"))`;

const uuids = (d: Schematic): string[] => d.junctions.map((j) => j.uuid ?? '').sort();

/** The two halves of a Move To Sheet: it leaves here, it arrives there. */
const leaves = (id: string): EditCommand => deleteByIds(new Set([id]));
const arrives = (id: string, at: { x: number; y: number }): EditCommand =>
  addItems({ junctions: [makeJunctionWithUuid(at, id)] });

describe('an edit that spans two sheets', () => {
  const source = () => doc([junction('a', 10, 10), junction('b', 20, 20)].join('\n'));
  const target = () => doc(junction('z', 50, 50));

  it('applies both halves at once', () => {
    const h = new History();
    const others = new Map([['sub.kicad_sch', target()]]);
    const step = h.executeAcross(
      source(),
      { own: leaves('a'), others: new Map([['sub.kicad_sch', arrives('a', { x: 0, y: 0 })]]) },
      others,
    );
    expect(uuids(step.doc)).toEqual(['b']);
    expect(uuids(step.others.get('sub.kicad_sch')!)).toEqual(['a', 'z']);
  });

  /** The whole reason this exists. */
  it('undoes both halves at once, so nothing is left duplicated', () => {
    const h = new History();
    const docs = new Map([['sub.kicad_sch', target()]]);
    const done = h.executeAcross(
      source(),
      { own: leaves('a'), others: new Map([['sub.kicad_sch', arrives('a', { x: 0, y: 0 })]]) },
      docs,
    );
    for (const [f, d] of done.others) docs.set(f, d);

    const back = h.undoAcross(done.doc, docs)!;
    expect(uuids(back.doc)).toEqual(['a', 'b']);
    // ...and it is NOT still on the destination as well.
    expect(uuids(back.others.get('sub.kicad_sch')!)).toEqual(['z']);
  });

  it('redoes both halves at once', () => {
    const h = new History();
    const docs = new Map([['sub.kicad_sch', target()]]);
    const done = h.executeAcross(
      source(),
      { own: leaves('a'), others: new Map([['sub.kicad_sch', arrives('a', { x: 0, y: 0 })]]) },
      docs,
    );
    for (const [f, d] of done.others) docs.set(f, d);
    const back = h.undoAcross(done.doc, docs)!;
    for (const [f, d] of back.others) docs.set(f, d);

    const again = h.redoAcross(back.doc, docs)!;
    expect(uuids(again.doc)).toEqual(['b']);
    expect(uuids(again.others.get('sub.kicad_sch')!)).toEqual(['a', 'z']);
  });

  it('is ONE entry, not two — a second undo reaches past it', () => {
    const h = new History();
    const docs = new Map([['sub.kicad_sch', target()]]);
    let src = source();
    // An ordinary edit first, so there is something underneath to reach.
    src = h.execute(src, deleteByIds(new Set(['b'])));
    const done = h.executeAcross(
      src,
      { own: leaves('a'), others: new Map([['sub.kicad_sch', arrives('a', { x: 0, y: 0 })]]) },
      docs,
    );
    for (const [f, d] of done.others) docs.set(f, d);

    const first = h.undoAcross(done.doc, docs)!;
    for (const [f, d] of first.others) docs.set(f, d);
    expect(uuids(first.doc)).toEqual(['a']);

    const second = h.undoAcross(first.doc, docs)!;
    expect(uuids(second.doc)).toEqual(['a', 'b']);
    // The second undo is the ordinary edit and touched no other sheet.
    expect(second.others.size).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it('leaves an ordinary edit reporting no other sheets at all', () => {
    const h = new History();
    const next = h.execute(source(), deleteByIds(new Set(['a'])));
    const back = h.undoAcross(next, new Map())!;
    expect(back.others.size).toBe(0);
    expect(uuids(back.doc)).toEqual(['a', 'b']);
  });

  /**
   * A sheet the entry names but the project no longer holds — closed, renamed,
   * deleted. Upstream a commit whose screen has gone stages nothing for it;
   * here the file is skipped rather than throwing, and the rest of the step
   * still undoes.
   */
  it('skips a sheet the project no longer has, and still undoes this one', () => {
    const h = new History();
    const done = h.executeAcross(
      source(),
      { own: leaves('a'), others: new Map([['gone.kicad_sch', arrives('a', { x: 0, y: 0 })]]) },
      new Map(),
    );
    expect(done.others.size).toBe(0);
    const back = h.undoAcross(done.doc, new Map())!;
    expect(uuids(back.doc)).toEqual(['a', 'b']);
  });

  /**
   * `History.undo` without the project is the single-sheet form every other
   * caller uses. It must still pop the entry and undo this sheet's half rather
   * than refusing or throwing.
   */
  it('undoes this sheet’s half through the plain single-sheet call', () => {
    const h = new History();
    const docs = new Map([['sub.kicad_sch', target()]]);
    const done = h.executeAcross(
      source(),
      { own: leaves('a'), others: new Map([['sub.kicad_sch', arrives('a', { x: 0, y: 0 })]]) },
      docs,
    );
    expect(uuids(h.undo(done.doc)!)).toEqual(['a', 'b']);
  });

  it('spans three sheets as readily as two', () => {
    const h = new History();
    const docs = new Map([
      ['one.kicad_sch', doc(junction('p', 1 * MM, 1 * MM))],
      ['two.kicad_sch', doc(junction('q', 2 * MM, 2 * MM))],
    ]);
    const done = h.executeAcross(
      source(),
      {
        own: leaves('a'),
        others: new Map([
          ['one.kicad_sch', arrives('a', { x: 0, y: 0 })],
          ['two.kicad_sch', arrives('a2', { x: 0, y: 0 })],
        ]),
      },
      docs,
    );
    expect(uuids(done.others.get('one.kicad_sch')!)).toEqual(['a', 'p']);
    expect(uuids(done.others.get('two.kicad_sch')!)).toEqual(['a2', 'q']);
    for (const [f, d] of done.others) docs.set(f, d);

    const back = h.undoAcross(done.doc, docs)!;
    expect(uuids(back.others.get('one.kicad_sch')!)).toEqual(['p']);
    expect(uuids(back.others.get('two.kicad_sch')!)).toEqual(['q']);
  });
});
