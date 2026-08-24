// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which rows of the Footprint Editor's menu bar are greyed, and on what.
 *
 * Counterpart: `FOOTPRINT_EDIT_FRAME::setupUIConditions`
 * (`pcbnew/footprint_edit_frame.cpp:1279-1497`). That function is the whole
 * authority — `ACTION_MANAGER::SetConditions` is the only thing that decides a
 * row's enabled state, and an action it never names keeps
 * `ACTION_CONDITIONS`'s default, which is ShowAlways.
 *
 * `symfp_menubar.test.ts` next door pins the rows, their order and their
 * labels. It evaluates every condition as **true**, deliberately, so a greyed
 * row there is greyed on its own merits. That left the conditions themselves
 * unpinned, and six of them were wrong: Save greyed when nothing was modified
 * (upstream: always live), Undo/Redo live on an empty stack, Delete reading the
 * canvas selection rather than the board, Export reading the tree's target FPID
 * rather than the loaded footprint, Footprint Properties missing its tree
 * branch, and Revert permanently dead.
 *
 * Every case below flips ONE condition off against an all-true baseline and
 * names the expected state as a literal. A test that asked the menu what it
 * thought — `expect(row.disabled).toBe(!conds.haveFootprint)` — would pass for
 * any rule at all, which is the shape that let this drift.
 */
import { describe, expect, it } from 'vitest';
import {
  footprintEditorMenus,
  type FootprintMenuConditions,
  type FootprintMenuHandlers,
} from '@ziroeda/designer/src/editors/footprint/menubar.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const noop = (): void => {};

const handlers = (): FootprintMenuHandlers => ({
  action: noop,
  tool: noop,
  toggle: noop,
  language: 'Default',
  onSelectLanguage: noop,
  showHotkeys: noop,
  showAbout: noop,
});

/** Every condition true. */
const ALL: FootprintMenuConditions = {
  haveFootprint: true,
  targetLib: true,
  targetFootprint: true,
  footprintSelectedInTree: true,
  contentModified: true,
  hasItems: true,
  undoAvailable: true,
  redoAvailable: true,
};

/** Every condition false: a cold frame with no footprint and nothing selected. */
const NONE: FootprintMenuConditions = {
  haveFootprint: false,
  targetLib: false,
  targetFootprint: false,
  footprintSelectedInTree: false,
  contentModified: false,
  hasItems: false,
  undoAvailable: false,
  redoAvailable: false,
};

const menus = (conds: Partial<FootprintMenuConditions> = {}): Menu[] =>
  footprintEditorMenus(handlers(), {}, { ...ALL, ...conds });

/** The first row with this label, anywhere in the bar (submenus included). */
const find = (bar: Menu[], label: string): MenuItem => {
  let hit: MenuItem | undefined;
  const walk = (items: readonly MenuItem[]): void => {
    for (const i of items) {
      if (i.label === label) hit ??= i;
      walk(i.submenu ?? i.items ?? []);
    }
  };
  for (const m of bar) walk(m.items);
  if (!hit) throw new Error(`no row labelled ${label}`);
  return hit;
};

/**
 * A row addressed by its submenu path, for the two labels that appear twice:
 * `Import > [Footprint...]` and `Export > [Footprint...]` both spell the row
 * `Footprint...`, because `submenuImport->Add( action, NORMAL, _( "Footprint..." ) )`
 * replaces the FriendlyName (`menubar_footprint_editor.cpp:67, 77`). Reaching
 * for the first match found Import's, which carries no condition at all.
 */
const at = (bar: Menu[], parent: string, label: string): MenuItem => {
  const sub = find(bar, parent).submenu ?? find(bar, parent).items ?? [];
  const hit = sub.find((i) => i.label === label);
  if (!hit) throw new Error(`no row ${parent} > ${label}`);
  return hit;
};

/** `disabled` normalised — an absent flag is an enabled row. */
const greyed = (bar: Menu[], label: string): boolean => find(bar, label).disabled === true;

describe('ACTIONS::save is ShowAlways in this frame', () => {
  /**
   * `mgr->SetConditions( ACTIONS::save, ENABLE( SELECTION_CONDITIONS::ShowAlways ) )`
   * (:1353). Save here reaches the library, not only the footprint on the
   * canvas, which is why upstream never gates it — not even on a cold frame.
   */
  it('is live with every condition false', () => {
    expect(greyed(menus(NONE), 'Save')).toBe(false);
  });

  /**
   * The regression that mattered: ours greyed Save on "nothing modified
   * anywhere". Nothing in the condition set may move it, so flip each one in
   * turn rather than only the one that used to.
   */
  it.each(
    Object.keys(ALL) as (keyof FootprintMenuConditions)[],
  )('stays live with %s false', (key) => {
    expect(greyed(menus({ [key]: false }), 'Save')).toBe(false);
  });
});

describe('Edit > Undo / Redo follow the undo stacks', () => {
  /** `ENABLE( cond.UndoAvailable() )` — `GetUndoCommandCount() > 0` (:1361). */
  it('Undo is greyed with an empty undo stack', () => {
    expect(greyed(menus({ undoAvailable: false }), 'Undo')).toBe(true);
    expect(greyed(menus({ undoAvailable: true }), 'Undo')).toBe(false);
  });

  /** `ENABLE( cond.RedoAvailable() )` (:1362). */
  it('Redo is greyed with an empty redo stack', () => {
    expect(greyed(menus({ redoAvailable: false }), 'Redo')).toBe(true);
    expect(greyed(menus({ redoAvailable: true }), 'Redo')).toBe(false);
  });

  /** They are two conditions, not one: an undo leaves Redo live and Undo dead. */
  it('the two are independent', () => {
    const afterOneUndo = menus({ undoAvailable: false, redoAvailable: true });
    expect(greyed(afterOneUndo, 'Undo')).toBe(true);
    expect(greyed(afterOneUndo, 'Redo')).toBe(false);
  });
});

describe('Edit > Delete reads the board, not the selection', () => {
  /**
   * `ENABLE( cond.HasItems() )` (:1370), and `PCB_EDITOR_CONDITIONS::hasItemsFunc`
   * (`pcb_editor_conditions.cpp:140-145`) is `board && !board->IsEmpty()`.
   * Upstream's Delete row is live whenever the board holds anything, with or
   * without a selection; ours required a canvas selection.
   */
  it('is live with a footprint on the board and nothing selected', () => {
    expect(greyed(menus({ hasItems: true }), 'Delete')).toBe(false);
  });

  it('is greyed on an empty board', () => {
    expect(greyed(menus({ hasItems: false }), 'Delete')).toBe(true);
  });
});

describe('File > Revert follows IsContentModified', () => {
  /**
   * `ENABLE( cond.ContentModified() )` (:1352).
   * `FOOTPRINT_EDIT_FRAME::IsContentModified()` (:368-372) is the loaded
   * footprint's dirty bit, so a clean footprint cannot be reverted.
   */
  it('is greyed on a clean footprint', () => {
    expect(greyed(menus({ contentModified: false }), 'Revert')).toBe(true);
  });

  it('is live on a modified one', () => {
    expect(greyed(menus({ contentModified: true }), 'Revert')).toBe(false);
  });

  /** It was a permanently dead stub; it now dispatches. */
  it('has an action', () => {
    expect(typeof find(menus(), 'Revert').action).toBe('function');
  });
});

describe('haveFootprintCond rows', () => {
  /**
   * `haveFootprintCond` (:1291-1295) is `GetBoard()->GetFirstFootprint() != nullptr`.
   * `Export > Footprint...` is `ENABLE( haveFootprintCond )` (:1428) — ours
   * read `footprintTargettedCond` (the tree's target FPID) instead, which is a
   * different question and is true for a tree row that was never opened.
   */
  it('Export > Footprint... follows the loaded footprint, not the tree target', () => {
    const off = at(
      menus({ haveFootprint: false, targetFootprint: true }),
      'Export',
      'Footprint...',
    );
    const on = at(menus({ haveFootprint: true, targetFootprint: false }), 'Export', 'Footprint...');
    expect(off.disabled).toBe(true);
    expect(on.disabled).toBeFalsy();
  });

  /**
   * And the neighbouring `Import > Footprint...` is NOT gated: upstream sets no
   * condition on `PCB_ACTIONS::importFootprint`. The two rows share a label,
   * which is how the first version of this test read the wrong one.
   */
  it('Import > Footprint... stays live on a cold frame', () => {
    expect(at(menus(NONE), 'Import', 'Footprint...').disabled).toBeFalsy();
  });

  /** `ENABLE( haveFootprintCond )` (:1436) — ACTIONS::showDatasheet. */
  it('Show Datasheet follows the loaded footprint', () => {
    expect(greyed(menus({ haveFootprint: false }), 'Show Datasheet')).toBe(true);
    expect(greyed(menus({ haveFootprint: true }), 'Show Datasheet')).toBe(false);
  });

  /**
   * `CURRENT_EDIT_TOOL( action )` (:1469-1494) is
   * `Enable( haveFootprintCond ).Check( cond.CurrentTool( action ) )`, applied
   * to every Place tool. Only the four that are implemented here can be
   * checked; the rest are greyed stubs whatever the conditions say.
   */
  it.each([
    'Add Pad',
    'Draw Lines',
    'Draw Rectangles',
    'Draw Circles',
  ])('Place > %s needs a footprint', (label) => {
    expect(greyed(menus({ haveFootprint: false }), label)).toBe(true);
    expect(greyed(menus({ haveFootprint: true }), label)).toBe(false);
  });
});

describe('File > Footprint Properties... is an OR of two conditions', () => {
  /**
   * `ENABLE( footprintSelectedInTreeCond || haveFootprintCond )` (:1431).
   * `editFootprintPropertiesFromLibrary` (`footprint_editor_control.cpp:794`)
   * is the branch that runs when only the tree row is set, so a tree selection
   * alone opens the dialog. Ours read `haveFootprintCond` alone.
   */
  const row = 'Footprint Properties...';

  it('a tree selection alone is enough', () => {
    expect(greyed(menus({ haveFootprint: false, footprintSelectedInTree: true }), row)).toBe(false);
  });

  it('a loaded footprint alone is enough', () => {
    expect(greyed(menus({ haveFootprint: true, footprintSelectedInTree: false }), row)).toBe(false);
  });

  it('neither is not', () => {
    expect(greyed(menus({ haveFootprint: false, footprintSelectedInTree: false }), row)).toBe(true);
  });
});

describe('File > New Footprint', () => {
  /**
   * Upstream sets NO condition on `PCB_ACTIONS::newFootprint`, so its menu row
   * is always live: `NewFootprint` (`footprint_editor_control.cpp:212-244`)
   * builds the footprint either way and only `tryToSaveFootprintInLibrary`
   * (:174-208) looks at the target, doing nothing when the nickname is empty.
   *
   * Ours greys it, deliberately: every buffer in `libraryManager.ts` is keyed
   * by library, so there is nowhere to put a library-less footprint. This case
   * exists so that the deviation is a decision on the record rather than an
   * accident — change the model and this expectation is what tells you the row
   * can go back to being always live.
   */
  it('is greyed without a target library, unlike upstream', () => {
    expect(greyed(menus({ targetLib: false }), 'New Footprint')).toBe(true);
    expect(greyed(menus({ targetLib: true }), 'New Footprint')).toBe(false);
  });
});

describe('the cold frame', () => {
  /**
   * With nothing loaded and nothing selected, exactly these File/Edit/Inspect
   * rows are still live. Spelled out rather than derived, so adding a row that
   * forgets its condition shows up here as well as in its own case.
   */
  it('greys everything but the rows upstream leaves live', () => {
    const cold = menus(NONE);
    const live: Record<string, boolean> = {};
    for (const label of [
      'New Library...',
      'Add Library...',
      'New Footprint',
      'Save',
      'Revert',
      'Undo',
      'Redo',
      'Delete',
      'Show Datasheet',
      'Footprint Properties...',
    ]) {
      live[label] = !greyed(cold, label);
    }
    expect(live).toEqual({
      // ACTIONS::newLibrary / addLibrary get no SetConditions anywhere.
      'New Library...': true,
      'Add Library...': true,
      // Our deviation, above.
      'New Footprint': false,
      // ENABLE( ShowAlways ).
      Save: true,
      Revert: false,
      Undo: false,
      Redo: false,
      Delete: false,
      'Show Datasheet': false,
      'Footprint Properties...': false,
    });
  });
});
