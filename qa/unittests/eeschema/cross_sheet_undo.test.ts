// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One undo stack for the whole project, on the frame — not one per sheet.
 *
 *     UNDO_REDO_CONTAINER m_undoList;   // eda_base_frame.h:860
 *
 * lives on `EDA_BASE_FRAME`, and `SCH_EDIT_FRAME` adds none of its own. So a
 * schematic of forty sheets has exactly one undo stack, and Ctrl+Z takes back
 * the last thing you did anywhere in it. Each picker inside an entry carries
 * the SCH_SCREEN its item belongs to — `ITEM_PICKER( aScreen, aItem, … )` — and
 * `PutDataInPreviousState` calls `AddToScreen( eda_item, screen )` with THAT
 * screen, so one entry restoring several sheets is the ordinary shape of the
 * mechanism rather than a special case.
 *
 * Ours kept a `History` per document. Two consequences, both of them things a
 * user meets on an afternoon's work:
 *
 *   - move a part on sheet 2, step into sheet 3, press Ctrl+Z: KiCad puts the
 *     part back, ours undid some unrelated older edit of sheet 3's, or nothing;
 *   - an edit spanning two sheets went on as two independent entries, so
 *     undoing the source half left the copy on the destination — the same
 *     items on two sheets, which is worse than the edit it meant to revert.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { ProjectHistory, History, type EditCommand } from '@ziroeda/eeschema/src/tools/command.js';
import { addItems, deleteByIds } from '@ziroeda/eeschema/src/tools/mutate.js';
import {
  setPageSettingsCommand,
  getPageSettings,
} from '@ziroeda/eeschema/src/tools/page_settings.js';
import { makeJunctionWithUuid } from '@ziroeda/eeschema/src/tools/build.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const doc = (body: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "eeschema")
${body}
  (sheet_instances (path "/" (page "1"))))`),
  );

const junction = (uuid: string, x: number, y: number): string =>
  `  (junction (at ${x} ${y}) (diameter 0) (color 0 0 0 0) (uuid "${uuid}"))`;

const uuids = (d: Schematic | undefined): string[] =>
  (d?.junctions ?? []).map((j) => j.uuid ?? '').sort();

/** The two halves of a Move To Sheet: it leaves here, it arrives there. */
const leaves = (id: string): EditCommand => deleteByIds(new Set([id]));
const arrives = (id: string): EditCommand =>
  addItems({ junctions: [makeJunctionWithUuid({ x: 0, y: 0 }, id)] });

/** A project of two sheets, and the moves between them. */
const project = () =>
  new Map([
    ['root.kicad_sch', doc([junction('a', 10, 10), junction('b', 20, 20)].join('\n'))],
    ['sub.kicad_sch', doc(junction('z', 50, 50))],
  ]);

const moveToSub = new Map<string, EditCommand>([
  ['root.kicad_sch', leaves('a')],
  ['sub.kicad_sch', arrives('a')],
]);

/** Fold a step back the way the editor does: changed documents replace theirs. */
const fold = (
  docs: Map<string, Schematic>,
  step: { docs: Map<string, Schematic> } | null,
): Map<string, Schematic> => {
  for (const [f, d] of step?.docs ?? []) docs.set(f, d);
  return docs;
};

describe('one entry, several sheets', () => {
  it('applies every half at once', () => {
    const h = new ProjectHistory();
    const docs = fold(project(), h.execute(project(), moveToSub));
    expect(uuids(docs.get('root.kicad_sch'))).toEqual(['b']);
    expect(uuids(docs.get('sub.kicad_sch'))).toEqual(['a', 'z']);
  });

  /** The whole reason a single entry matters. */
  it('undoes every half at once, so nothing is left duplicated', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, moveToSub));

    fold(docs, h.undo(docs));
    expect(uuids(docs.get('root.kicad_sch'))).toEqual(['a', 'b']);
    // ...and it is NOT still on the destination as well.
    expect(uuids(docs.get('sub.kicad_sch'))).toEqual(['z']);
  });

  it('redoes every half at once', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, moveToSub));
    fold(docs, h.undo(docs));

    fold(docs, h.redo(docs));
    expect(uuids(docs.get('root.kicad_sch'))).toEqual(['b']);
    expect(uuids(docs.get('sub.kicad_sch'))).toEqual(['a', 'z']);
  });

  it('spans three sheets as readily as two', () => {
    const h = new ProjectHistory();
    const docs = project();
    docs.set('third.kicad_sch', doc(junction('q', 30, 30)));
    fold(
      docs,
      h.execute(
        docs,
        new Map([
          ['root.kicad_sch', leaves('a')],
          ['sub.kicad_sch', arrives('a')],
          ['third.kicad_sch', leaves('q')],
        ]),
      ),
    );
    expect(uuids(docs.get('third.kicad_sch'))).toEqual([]);

    fold(docs, h.undo(docs));
    expect(uuids(docs.get('root.kicad_sch'))).toEqual(['a', 'b']);
    expect(uuids(docs.get('sub.kicad_sch'))).toEqual(['z']);
    expect(uuids(docs.get('third.kicad_sch'))).toEqual(['q']);
  });

  it('reports only the documents it touched', () => {
    const h = new ProjectHistory();
    const step = h.execute(project(), new Map([['root.kicad_sch', leaves('a')]]));
    expect([...step.docs.keys()]).toEqual(['root.kicad_sch']);
  });

  /**
   * A sheet the entry names but the project no longer holds — closed, renamed,
   * deleted. Upstream a picker whose screen has gone stages nothing for it;
   * here the file is skipped rather than throwing, and the rest still undoes.
   */
  it('skips a sheet the project no longer has, and still undoes the others', () => {
    const h = new ProjectHistory();
    const docs = project();
    docs.delete('sub.kicad_sch');
    fold(docs, h.execute(docs, moveToSub));
    expect(docs.has('sub.kicad_sch')).toBe(false);

    fold(docs, h.undo(docs));
    expect(uuids(docs.get('root.kicad_sch'))).toEqual(['a', 'b']);
  });
});

describe('the stack is the project’s, not the sheet you are looking at', () => {
  /**
   * The divergence this replaced. With a stack per sheet, an edit made on the
   * root and then undone "from" the sub-sheet reached the sub-sheet's own
   * history — a different entry, or none at all.
   */
  it('undoes the last edit wherever in the project it was made', () => {
    const h = new ProjectHistory();
    const docs = project();
    // Edit the root, then edit the sub-sheet, then undo twice: the edits come
    // back newest-first regardless of which sheet each was made on.
    fold(docs, h.execute(docs, new Map([['root.kicad_sch', leaves('a')]])));
    fold(docs, h.execute(docs, new Map([['sub.kicad_sch', leaves('z')]])));

    fold(docs, h.undo(docs));
    expect(uuids(docs.get('sub.kicad_sch'))).toEqual(['z']);
    expect(uuids(docs.get('root.kicad_sch'))).toEqual(['b']);

    fold(docs, h.undo(docs));
    expect(uuids(docs.get('root.kicad_sch'))).toEqual(['a', 'b']);
    expect(h.canUndo).toBe(false);
  });

  it('interleaves sheets in one stack rather than keeping one per sheet', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, new Map([['root.kicad_sch', leaves('a')]])));
    fold(docs, h.execute(docs, new Map([['sub.kicad_sch', leaves('z')]])));
    fold(docs, h.execute(docs, new Map([['root.kicad_sch', leaves('b')]])));

    // Three edits, three undos, in reverse order of when they were made — not
    // grouped by the sheet they were made on. The first undo is the LAST edit,
    // which was the root's second one, so 'b' comes back before the sub-sheet's
    // edit is reached at all.
    expect(uuids(fold(docs, h.undo(docs)).get('root.kicad_sch'))).toEqual(['b']);
    expect(uuids(fold(docs, h.undo(docs)).get('sub.kicad_sch'))).toEqual(['z']);
    expect(uuids(fold(docs, h.undo(docs)).get('root.kicad_sch'))).toEqual(['a', 'b']);
    expect(h.canUndo).toBe(false);
  });

  it('undoes an edit made on a sheet without needing that sheet on screen', () => {
    // No "current file" enters into it at all: the step is applied to the
    // documents it names, which is `AddToScreen( item, screen )`.
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, new Map([['sub.kicad_sch', leaves('z')]])));
    const step = h.undo(docs)!;
    expect([...step.docs.keys()]).toEqual(['sub.kicad_sch']);
  });

  it('has nothing to undo when nothing has been done', () => {
    const h = new ProjectHistory();
    expect(h.canUndo).toBe(false);
    expect(h.undo(project())).toBeNull();
    expect(h.redo(project())).toBeNull();
  });

  it('drops the redo stack on the next edit, as PushCommandToUndoList does', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, new Map([['root.kicad_sch', leaves('a')]])));
    fold(docs, h.undo(docs));
    expect(h.canRedo).toBe(true);

    fold(docs, h.execute(docs, new Map([['root.kicad_sch', leaves('b')]])));
    expect(h.canRedo).toBe(false);
  });

  it('forgets everything when the project is closed', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, new Map([['root.kicad_sch', leaves('a')]])));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});

/**
 * `UNDO_REDO::PAGESETTINGS` is the one picker status whose undo navigates:
 *
 *     if( GetCurrentSheet() != undoSheet ) { SetCurrentSheet( undoSheet ); … }
 *     (`schematic_undo_redo.cpp:353-358`)
 *
 * Every other status is applied to its own screen with the view left alone.
 */
describe('the one status whose undo brings its sheet on screen', () => {
  const pageEdit = (docs: Map<string, Schematic>) =>
    new Map([
      [
        'sub.kicad_sch',
        setPageSettingsCommand({ ...getPageSettings(docs.get('sub.kicad_sch')!), title: 'Power' }),
      ],
    ]);

  it('names the sheet to show when undoing page settings', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, pageEdit(docs)));
    expect(h.undo(docs)!.showSheet).toBe('sub.kicad_sch');
  });

  it('names it on redo too, since both go through PutDataInPreviousState', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, pageEdit(docs)));
    fold(docs, h.undo(docs));
    expect(h.redo(docs)!.showSheet).toBe('sub.kicad_sch');
  });

  it('does not name one while the edit is being made', () => {
    // Making the change never goes through `PutDataInPreviousState`; you are
    // already looking at the sheet whose settings the dialog just changed.
    const h = new ProjectHistory();
    const docs = project();
    expect(h.execute(docs, pageEdit(docs)).showSheet).toBeUndefined();
  });

  it('names none for an ordinary edit', () => {
    const h = new ProjectHistory();
    const docs = project();
    fold(docs, h.execute(docs, new Map([['sub.kicad_sch', leaves('z')]])));
    expect(h.undo(docs)!.showSheet).toBeUndefined();
  });
});

/** The one-document facade the command tests use is the same stacks. */
describe('the single-document form', () => {
  const one = () => doc([junction('a', 10, 10), junction('b', 20, 20)].join('\n'));

  it('undoes and redoes a lone document', () => {
    const h = new History();
    const next = h.execute(one(), deleteByIds(new Set(['a'])));
    expect(uuids(next)).toEqual(['b']);
    const back = h.undo(next)!;
    expect(uuids(back)).toEqual(['a', 'b']);
    expect(uuids(h.redo(back)!)).toEqual(['b']);
  });

  it('reports nothing to undo on an empty stack', () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    expect(h.undo(one())).toBeNull();
    expect(h.redo(one())).toBeNull();
  });
});
