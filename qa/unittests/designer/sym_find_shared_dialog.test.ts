// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's top toolbar with no symbol loaded, button by button, and
 * the claim that Find is ONE module both editors open.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE, NEXT TO THE TWO THAT ALREADY EXIST
 * ---------------------------------------------------------------------------
 *
 * A rendered button is greyed by an OR of two independent inputs:
 *
 *     !!b.disabled || !!disabledIds?.has(b.id)        — `ui/toolbar_types.ts`
 *
 * `toolbar_static_disabled.test.ts` pins the left operand and
 * `sym_ui_conditions.test.ts` pins the right, and BOTH were green while the
 * empty Symbol Editor greyed Find and Find and Replace against a KiCad toolbar
 * that greys neither: the static flag said "we have not built this", the
 * conditions table (rightly) said nothing at all, and no test asked for the OR.
 * So the expectation here is the whole bar, as a user sees it, in upstream
 * order — the sum, not either half.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE EXPECTED TABLE COMES FROM
 * ---------------------------------------------------------------------------
 *
 * The bar is `SYMBOL_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig`'s TOP_MAIN
 * (`eeschema/symbol_editor/toolbars_symbol_editor.cpp:112-157`). Whether each
 * of its actions is live with `m_symbol == nullptr` is decided ONLY by
 * `ACTION_MANAGER::SetConditions`, and `SYMBOL_EDIT_FRAME::setupUIConditions`
 * (`symbol_edit_frame.cpp:448-660`) is the only caller. An action it does not
 * name keeps `ACTION_CONDITIONS()`'s constructed default,
 * `enableCondition = SELECTION_CONDITIONS::ShowAlways`
 * (`include/tool/action_manager.h:50-55`) — live.
 *
 * Read straight off that function, per button, and NOT by asking our own
 * table what it thinks:
 *
 *   newSymbol            not named                       -> live
 *   saveAll              ENABLE( ShowAlways )    :528     -> live
 *   save                 ENABLE( ShowAlways )    :529     -> live
 *   undo                 haveSymbolCond && UndoAvailable   :537 -> dead
 *   redo                 haveSymbolCond && RedoAvailable   :538 -> dead
 *   find                 not named                       -> live
 *   findReplace          not named (ACTIONS::findAndReplace) -> live
 *   zoomRedraw           not named                       -> live
 *   zoomIn               not named                       -> live
 *   zoomOut              not named                       -> live
 *   zoomFit              not named                       -> live
 *   zoomTool             CHECK only              :561     -> live
 *   rotateCCW/rotateCW   isEditableInAliasCond   :555-556 -> dead
 *   mirrorV/mirrorH      isEditableCond          :558-559 -> dead
 *   symbolProperties     symbolSelectedInTree ||
 *                        (canEditProperties && haveSymbolCond) :634 -> dead
 *   pinTable             isEditableCond && haveSymbolCond :636 -> dead
 *   showDatasheet        haveDatasheetCond       :633     -> dead
 *   checkSymbol          not named                       -> live
 *   toggleSyncedPinsMode multiUnitModeCond       :640     -> dead
 *   addSymbolToSchematic not named                       -> live
 *
 * The two selectors are `AppendControl` slots, not buttons, and are absent
 * from both lists for that reason.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  symbolConditions,
  symbolToolbarDisabledIds,
  type SymbolFrameState,
} from '@ziroeda/designer/src/editors/symbol/conditions.js';
import { SYM_TOP_TOOLBAR } from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import { TOP_TOOLBAR } from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import {
  toolbarButtonDisabled,
  toolbarEnabledIds,
  type ToolButton,
  type ToolEntry,
} from '@ziroeda/designer/src/ui/toolbar_types.js';
import {
  symbolEditorMenus,
  type SymbolMenuHandlers,
} from '@ziroeda/designer/src/editors/symbol/menubar.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

/** A SYMBOL_EDIT_FRAME the moment it opens: no symbol, no library row, empty
 *  undo/redo stacks, the selection tool running. */
const COLD: SymbolFrameState = {
  symbol: null,
  fromLegacyLibrary: false,
  fromSchematic: false,
  libraryTreeShown: true,
  treeLibId: { nickname: '', item: '' },
  symbolLibId: { nickname: '', item: '' },
  undoCount: 0,
  redoCount: 0,
  idle: true,
  activeTool: 'select',
  isSymbolModified: () => false,
  symbolExists: () => false,
};

const buttons = (entries: readonly ToolEntry[]): ToolButton[] =>
  entries.flatMap((e) =>
    e === 'sep' ? [] : 'group' in e ? e.actions : 'control' in e || 'spacer' in e ? [] : [e],
  );

const coldDisabledIds = (): ReadonlySet<string> =>
  symbolToolbarDisabledIds(SYM_TOP_TOOLBAR, symbolConditions(COLD));

// ---------------------------------------------------------------------------
// 1. The whole bar, as rendered, on a cold frame
// ---------------------------------------------------------------------------

describe('the Symbol Editor top toolbar with no symbol loaded', () => {
  /**
   * Every button of TOP_MAIN with its final state, in upstream's order and
   * spelled out one line at a time. A set of the live ones alone would pass
   * with a button missing from the bar entirely, and a count would pass with
   * any two transposed.
   */
  it('is live/dead exactly as setupUIConditions says', () => {
    const disabledIds = coldDisabledIds();
    const table = buttons(SYM_TOP_TOOLBAR).map(
      (b) => `${b.id}: ${toolbarButtonDisabled(b, disabledIds) ? 'dead' : 'live'}`,
    );
    expect(table).toEqual([
      'newSymbol: live',
      'saveAll: live',
      'save: live',
      'undo: dead',
      'redo: dead',
      'find: live',
      'findReplace: live',
      'zoomRedraw: live',
      'zoomIn: live',
      'zoomOut: live',
      'zoomFit: live',
      'zoomTool: live',
      'rotateCCW: dead',
      'rotateCW: dead',
      'mirrorV: dead',
      'mirrorH: dead',
      'symbolProperties: dead',
      'pinTable: dead',
      'showDatasheet: dead',
      // `SCH_ACTIONS::checkSymbol` (`sch_actions.cpp:47-59`) gets no
      // SetConditions call at all — `runERC` at :635 is a DIFFERENT action —
      // so Symbol Checker is live with no symbol open.
      'checkSymbol: live',
      'toggleSyncedPinsMode: dead',
      'addSymbolToSchematic: live',
    ]);
  });

  /**
   * Find and Find and Replace, called out on their own and against BOTH
   * inputs, because they were dead for the static reason while the conditions
   * table correctly said nothing — and a whole-bar expectation can be dragged
   * back into line by "fixing" the wrong half.
   */
  it('greys Find and Find and Replace by neither input', () => {
    const disabledIds = coldDisabledIds();
    for (const id of ['find', 'findReplace']) {
      const b = buttons(SYM_TOP_TOOLBAR).find((x) => x.id === id);
      expect(b, `${id} is not on the bar at all`).toBeDefined();
      // The static flag: a claim about us, and we no longer have one to make.
      expect(b!.disabled, `${id} carries a static disabled`).toBeFalsy();
      // The condition: upstream registers none, so ShowAlways stands.
      expect(disabledIds.has(id), `${id} is gated by a condition`).toBe(false);
    }
  });

  /**
   * The OR itself, on a bar built for it. Both halves have to be able to grey a
   * button on their own, and the real bars cannot show that any more: after
   * this change the symbol top bar has no static `disabled` left on it, so
   * dropping `!!b.disabled` from `toolbarButtonDisabled` changes nothing there
   * — a mutant that did exactly that survived the sweep against the tables
   * above. It is a shared function every editor's bar goes through, so pinning
   * it synthetically is pinning it where it lives, not inventing a case.
   */
  it('greys on either input alone', () => {
    const bar: ToolEntry[] = [
      { id: 'built', icon: 'x' },
      { id: 'unbuilt', icon: 'x', disabled: true },
      { id: 'gated', icon: 'x' },
      { group: 'G', actions: [{ id: 'inGroup', icon: 'x', disabled: true }] },
    ];
    const gated = new Set(['gated']);
    expect(toolbarEnabledIds(bar, gated)).toEqual(['built']);
    // Each half on its own, so neither can be dropped without moving a line.
    expect(toolbarEnabledIds(bar, new Set())).toEqual(['built', 'gated']);
    expect(toolbarEnabledIds(bar, new Set(['built', 'gated']))).toEqual([]);
    expect(toolbarButtonDisabled({ id: 'unbuilt', icon: 'x', disabled: true })).toBe(true);
    expect(toolbarButtonDisabled({ id: 'built', icon: 'x' }, gated)).toBe(false);
    expect(toolbarButtonDisabled({ id: 'gated', icon: 'x' }, gated)).toBe(true);
  });

  /**
   * Per editor. "Right in the symbol editor, wrong in eeschema" is the shape
   * this codebase keeps producing, and the dialog only just moved out from
   * under `editors/schematic/`, so the schematic's own two buttons are checked
   * here too — `SCH_EDIT_FRAME::setupUIConditions` names neither either.
   */
  it.each([
    ['symbol', SYM_TOP_TOOLBAR],
    ['schematic', TOP_TOOLBAR],
  ] as const)('leaves find and findReplace live on the %s top bar', (_name, bar) => {
    const live = toolbarEnabledIds(bar, coldDisabledIds());
    expect(live).toContain('find');
    expect(live).toContain('findReplace');
  });
});

// ---------------------------------------------------------------------------
// 2. The menu rows the same two actions have
// ---------------------------------------------------------------------------

describe('Edit > Find and Edit > Find and Replace', () => {
  const rows = (): MenuItem[] => {
    const handlers = {
      action: () => {},
      tool: () => {},
      toggle: () => {},
      language: 'Default',
      onSelectLanguage: () => {},
      showHotkeys: () => {},
      showAbout: () => {},
    } as unknown as SymbolMenuHandlers;
    const menus: Menu[] = symbolEditorMenus(
      handlers,
      {
        showHiddenPins: false,
        showHiddenFields: false,
        showLibraryTree: true,
        showProperties: true,
      },
      symbolConditions(COLD),
    );
    const edit = menus.find((m) => m.label === 'Edit');
    expect(edit).toBeDefined();
    return edit!.items.filter((i) => !i.sep && i.label !== undefined);
  };

  /** Live rows on a cold frame, with an action wired — a greyed row and a row
   *  that dispatches nothing look identical to a reader and to a user. */
  it.each([
    ['Find', 'find'],
    ['Find and Replace', 'findReplace'],
  ])('%s is live and dispatches %s', (label, id) => {
    const row = rows().find((r) => r.label === label);
    expect(row, `no Edit > ${label} row`).toBeDefined();
    expect(row!.disabled).toBeFalsy();
    expect(row!.icon).toBe(id);
    expect(typeof row!.action).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 3. One dialog, two editors
// ---------------------------------------------------------------------------

/** Every `.ts`/`.tsx` under `designer/src`. */
function designerSources(): string[] {
  const root = new URL('../../../designer/src/', import.meta.url).pathname;
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

describe('DIALOG_SCH_FIND is a SCH_BASE_FRAME facility', () => {
  /**
   * `ShowFindReplaceDialog`, `GetFindReplaceDialog` and `m_findReplaceDialog`
   * are declared on SCH_BASE_FRAME (`eeschema/sch_base_frame.h:246-248, :318`),
   * so there is one dialog class and both frames construct it. Per-file and by
   * counting DEFINITIONS, because the bug was a second frame having none — and
   * "some file exports it" would pass with a copy sitting beside the original.
   */
  it('has exactly one implementation, and it is not under an editor', () => {
    const defs = designerSources().filter((f) =>
      /export function DialogSchFind\b/.test(readFileSync(f, 'utf8')),
    );
    expect(defs.map((f) => f.slice(f.indexOf('/designer/src/')))).toEqual([
      '/designer/src/widgets/dialog_sch_find.tsx',
    ]);
  });

  /** Both editors reach the same module. Listed per importer rather than as a
   *  count, so an editor dropping its import is a named failure. */
  it('is imported by both the schematic and the symbol editor', () => {
    const importers = designerSources()
      .filter((f) => /from '[^']*widgets\/dialog_sch_find\.js'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(f.indexOf('/designer/src/')))
      .sort();
    expect(importers).toEqual([
      '/designer/src/editors/schematic/SchematicEditor.tsx',
      '/designer/src/editors/symbol/SymbolEditor.tsx',
    ]);
  });

  /**
   * Nothing states the dialog locally again. The rule this file is enforcing
   * is CLAUDE.md's "a base class every subclass inherits -> one shared module,
   * never a per-editor copy", and the way that gets undone is not a deleted
   * import but a second component with a slightly different name.
   */
  it('leaves no per-editor find dialog behind', () => {
    const strays = designerSources()
      .filter((f) => !f.endsWith('/widgets/dialog_sch_find.tsx'))
      .filter((f) => /(function|const)\s+Dialog\w*Find\w*\s*[=(]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(f.indexOf('/designer/src/')));
    // Named, not filtered by directory: `pcbnew/dialogs/dialog_find.cpp`'s
    // DIALOG_FIND is a different upstream class on a different base frame
    // (PCB_BASE_FRAME), with its own search-history and marker options. Listing
    // it here rather than scoping the sweep to eeschema's folders means a
    // second sch find dialog appearing ANYWHERE — including under editors/pcb
    // — still fails.
    expect(strays).toEqual(['/designer/src/editors/pcb/dialogs/dialog_find.tsx']);
  });
});
