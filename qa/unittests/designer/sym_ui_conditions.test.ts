// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which rows and buttons of the Symbol Editor are greyed, and on what.
 *
 * Counterpart: `SYMBOL_EDIT_FRAME::setupUIConditions`
 * (`eeschema/symbol_editor/symbol_edit_frame.cpp:448-660`). That function is
 * the whole authority — `ACTION_MANAGER::SetConditions` is the only thing that
 * decides an action's enabled state, and an action it never names keeps
 * `ACTION_CONDITIONS()`'s default `enableCondition`, which is ShowAlways
 * (`include/tool/action_manager.h:50-55`).
 *
 * `symfp_menubar.test.ts` next door pins the rows, their order and their
 * labels, with every condition set true so that a greyed row there is greyed
 * on its own merits. That left the conditions unpinned, and most of them were
 * wrong: undo/redo live on an empty stack, Revert live on a clean symbol,
 * Show Datasheet reading "a symbol is open" instead of the Datasheet field,
 * Symbol Checker greyed where upstream leaves it live, File > Export greyed on
 * a condition upstream never gives it, every drawing tool and every
 * rotate/mirror button live on a cold frame, and the alias rules absent
 * entirely.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SHAPE OF THIS FILE
 * ---------------------------------------------------------------------------
 *
 * A conditions table is exactly where a file-level check hides a per-entry
 * bug: thirty-eight near-identical lines, and a test that asked the table what
 * it thought — `expect(enabled('cut')).toBe(conds.isEditable)` — would pass for
 * any rule at all. So every expectation below is a **literal**, and the central
 * sweep flips ONE condition against an all-true baseline and names the exact
 * set of actions that go dead. Flipping any single line of the table moves one
 * of those sets.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import {
  SYMBOL_ACTION_ENABLE,
  symbolActionEnabled,
  symbolConditions,
  symbolToolbarDisabledIds,
  targetLibId,
  type SymbolConditions,
  type SymbolFrameState,
} from '@ziroeda/designer/src/editors/symbol/conditions.js';
import {
  SYM_TOP_TOOLBAR,
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import {
  symbolEditorMenus,
  type SymbolMenuConditions,
  type SymbolMenuHandlers,
} from '@ziroeda/designer/src/editors/symbol/menubar.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

// ---------------------------------------------------------------------------
// 1. The table's membership
// ---------------------------------------------------------------------------

/**
 * Every action `setupUIConditions` gives an `ENABLE( … )`, by the id our menu
 * bar and toolbars dispatch. Written out rather than derived, so a key that is
 * renamed, dropped or misspelled shows up here — a typo'd key is invisible
 * otherwise, because `symbolActionEnabled` returns ShowAlways for an id it does
 * not know and a silently-always-live row looks exactly like a correct one.
 *
 * Thirty-eight, and the arithmetic is checkable against the C++:
 * `setupUIConditions` makes **53** `mgr->SetConditions` calls, of which **11**
 * are CHECK-only (:541-542, :561-562, :601-607) and **4** are
 * `ENABLE( SELECTION_CONDITIONS::ShowAlways )` (:528-529, :533-534). Both
 * groups are deliberately absent: a CHECK-only action has no enable rule, and
 * ShowAlways *is* the default, so writing it here would be restating it. That
 * leaves 53 − 11 − 4 = 38.
 */
const GATED_ACTIONS = [
  'bezier',
  'copy',
  'copyAsText',
  'cut',
  'cycleBodyStyle',
  'deleteTool',
  'doDelete',
  'drawArc',
  'drawCircle',
  'drawPolygon',
  'drawRectangle',
  'drawSymbolLines',
  'drawSymbolTextBox',
  'duplicate',
  'editLibSymbolWithLibEdit',
  'importGraphics',
  'mirrorH',
  'mirrorV',
  'paste',
  'pinTable',
  'placeAnchor',
  'placePin',
  'placeText',
  'redo',
  'revert',
  'rotateCCW',
  'rotateCW',
  'runERC',
  'saveLibraryAs',
  'saveSymbolAs',
  'saveSymbolCopyAs',
  'selectAll',
  'showDatasheet',
  'symbolProperties',
  'toggleSyncedPinsMode',
  'undo',
  'unselectAll',
  'updateSymbolFields',
];

describe('the table is the ENABLE half of setupUIConditions', () => {
  it('gates exactly these actions and no others', () => {
    expect(Object.keys(SYMBOL_ACTION_ENABLE).sort()).toEqual(GATED_ACTIONS);
  });

  /**
   * `ACTION_CONDITIONS()`'s default is `enableCondition = ShowAlways`
   * (`action_manager.h:53`), so an action the function never names is live.
   * These four are the ones that used to be greyed here and are not upstream.
   */
  it.each([
    'checkSymbol',
    'exportSymbol',
    'newSymbol',
    'find',
  ])('%s is ShowAlways, because upstream never names it', (id) => {
    expect(Object.hasOwn(SYMBOL_ACTION_ENABLE, id)).toBe(false);
    expect(symbolActionEnabled(id, NONE)).toBe(true);
  });

  /**
   * A key that no surface dispatches is a rule that can never fire. The two
   * exceptions are upstream's own: `SCH_ACTIONS::runERC` (:635) reaches no row
   * in this frame — the Inspect menu carries `checkSymbol`, a different action
   * — and `SCH_ACTIONS::cycleBodyStyle` (:638) is hotkey-only, the top toolbar
   * carrying the body-style CHOICE instead (`toolbars_symbol_editor.cpp:148`).
   */
  it('every other key is an id some row or button emits', () => {
    const surface = new Set<string>();
    for (const e of [...SYM_TOP_TOOLBAR, ...SYM_RIGHT_TOOLBAR]) {
      if (e === 'sep' || 'spacer' in e || 'control' in e) continue;
      if ('group' in e) for (const a of e.actions) surface.add(a.id);
      else surface.add(e.id);
    }
    const walk = (items: readonly MenuItem[]): void => {
      for (const i of items) {
        if (i.icon) surface.add(i.icon);
        walk(i.submenu ?? i.items ?? []);
      }
    };
    for (const m of menus()) walk(m.items);

    expect(
      Object.keys(SYMBOL_ACTION_ENABLE)
        .filter((k) => !surface.has(k))
        .sort(),
    ).toEqual(['cycleBodyStyle', 'runERC']);
  });
});

// ---------------------------------------------------------------------------
// 2. The per-condition sweep
// ---------------------------------------------------------------------------

/** Every condition true. `symbolFromSchematic` included, unlike the menu-bar
 *  fixture next door, so that flipping it moves Edit Library Symbol. */
const ALL: SymbolConditions = {
  haveSymbol: true,
  isEditable: true,
  isEditableInAlias: true,
  canUpdateFields: true,
  symbolModified: true,
  libSelected: true,
  canEditProperties: true,
  symbolSelectedInTree: true,
  saveSymbolAs: true,
  symbolFromSchematic: true,
  undoAvailable: true,
  redoAvailable: true,
  idle: true,
  noActiveTool: true,
  multiUnitMode: true,
  multiBodyStyle: true,
  haveDatasheet: true,
};

/** A cold frame: nothing loaded, nothing selected, no library. */
const NONE: SymbolConditions = {
  haveSymbol: false,
  isEditable: false,
  isEditableInAlias: false,
  canUpdateFields: false,
  symbolModified: false,
  libSelected: false,
  canEditProperties: false,
  symbolSelectedInTree: false,
  saveSymbolAs: false,
  symbolFromSchematic: false,
  undoAvailable: false,
  redoAvailable: false,
  idle: false,
  noActiveTool: false,
  multiUnitMode: false,
  multiBodyStyle: false,
  haveDatasheet: false,
};

/** The gated actions that are dead under `c`. */
const dead = (c: SymbolConditions): string[] =>
  GATED_ACTIONS.filter((id) => !symbolActionEnabled(id, c)).sort();

const flip = (key: keyof SymbolConditions): string[] => dead({ ...ALL, [key]: false });

describe('flipping one condition kills exactly these actions', () => {
  it('with every condition true, nothing is greyed', () => {
    expect(dead(ALL)).toEqual([]);
  });

  it('with every condition false, every gated action is greyed', () => {
    expect(dead(NONE)).toEqual(GATED_ACTIONS);
  });

  /**
   * `haveSymbolCond` (:460-464) — :545, :546, :551, :552, :635 on its own, plus
   * the three actions that AND it with something else: `undo` and `redo`
   * (:537-538, `haveSymbolCond && cond.UndoAvailable()`) and `pinTable` (:636,
   * `isEditableCond && haveSymbolCond` — belt and braces upstream, since
   * `isEditableCond` already implies a symbol, but it is written twice there
   * and so is written twice here).
   *
   * `symbolProperties` is NOT here: its tree branch is still true.
   */
  it('haveSymbol', () => {
    expect(flip('haveSymbol')).toEqual([
      'copy',
      'copyAsText',
      'pinTable',
      'redo',
      'runERC',
      'selectAll',
      'undo',
      'unselectAll',
    ]);
  });

  /**
   * `isEditableCond` (:466-472) — `IsSymbolEditable() && !IsSymbolAlias()`.
   * The widest rule in the function: seven edit actions (:544, :547, :549,
   * :550, :558, :559, :636) and all twelve `EDIT_TOOL`s (:645-656).
   *
   * `rotateCW` / `rotateCCW` are NOT here. That is the asymmetry upstream
   * states at :554-559 and it is the whole point of `isEditableInAliasCond`
   * existing: on a derived symbol you may rotate a field and may not mirror it.
   */
  it('isEditable', () => {
    expect(flip('isEditable')).toEqual([
      'bezier',
      'cut',
      'deleteTool',
      'doDelete',
      'drawArc',
      'drawCircle',
      'drawPolygon',
      'drawRectangle',
      'drawSymbolLines',
      'drawSymbolTextBox',
      'duplicate',
      'importGraphics',
      'mirrorH',
      'mirrorV',
      'paste',
      'pinTable',
      'placeAnchor',
      'placePin',
      'placeText',
    ]);
  });

  /** `isEditableInAliasCond` (:474-481) — rotate only (:555-556). */
  it('isEditableInAlias', () => {
    expect(flip('isEditableInAlias')).toEqual(['rotateCCW', 'rotateCW']);
  });

  /** `canUpdateFieldsCond` (:483-487) — :637. */
  it('canUpdateFields', () => {
    expect(flip('canUpdateFields')).toEqual(['updateSymbolFields']);
  });

  /** `symbolModifiedCondition` (:489-494) — :539. */
  it('symbolModified', () => {
    expect(flip('symbolModified')).toEqual(['revert']);
  });

  /** `libSelectedCondition` (:496-500) — :530. */
  it('libSelected', () => {
    expect(flip('libSelected')).toEqual(['saveLibraryAs']);
  });

  /** `saveSymbolAsCondition` (:515-519) — :531 and :532, both. */
  it('saveSymbolAs', () => {
    expect(flip('saveSymbolAs')).toEqual(['saveSymbolAs', 'saveSymbolCopyAs']);
  });

  /** `isSymbolFromSchematicCond` (:521-525) — :535. */
  it('symbolFromSchematic', () => {
    expect(flip('symbolFromSchematic')).toEqual(['editLibSymbolWithLibEdit']);
  });

  /** `cond.UndoAvailable()` / `cond.RedoAvailable()` (:537-538), independent. */
  it('undoAvailable', () => {
    expect(flip('undoAvailable')).toEqual(['undo']);
  });
  it('redoAvailable', () => {
    expect(flip('redoAvailable')).toEqual(['redo']);
  });

  /** `SELECTION_CONDITIONS::Idle` and `cond.NoActiveTool()`, the two extra
   *  terms `ACTIONS::paste` carries (:547-548) and nothing else does. */
  it('idle', () => {
    expect(flip('idle')).toEqual(['paste']);
  });
  it('noActiveTool', () => {
    expect(flip('noActiveTool')).toEqual(['paste']);
  });

  /** `multiUnitModeCond` (:609-613) — :640, Enable only; its Check is the
   *  `m_SyncPinEdit` flag, which is our `toggles` set. */
  it('multiUnitMode', () => {
    expect(flip('multiUnitMode')).toEqual(['toggleSyncedPinsMode']);
  });

  /** `multiBodyStyleModeCond` (:615-619) — :638. */
  it('multiBodyStyle', () => {
    expect(flip('multiBodyStyle')).toEqual(['cycleBodyStyle']);
  });

  /** `haveDatasheetCond` (:627-631) — :633. */
  it('haveDatasheet', () => {
    expect(flip('haveDatasheet')).toEqual(['showDatasheet']);
  });

  /**
   * The remaining two conditions feed one OR and nothing else, so flipping
   * either alone against an all-true baseline moves nothing — which is itself
   * worth asserting: it says no other rule has quietly picked them up. The OR
   * they do feed is pinned combination-by-combination below.
   */
  it('canEditProperties alone moves nothing', () => {
    expect(flip('canEditProperties')).toEqual([]);
  });
  it('symbolSelectedInTree alone moves nothing', () => {
    expect(flip('symbolSelectedInTree')).toEqual([]);
  });
});

describe('symbolProperties is an OR of two conditions (:634)', () => {
  /**
   * `ENABLE( symbolSelectedInTreeCondition || ( canEditProperties && haveSymbolCond ) )`.
   * A tree row alone is enough — that is the branch
   * `SYMBOL_EDITOR_CONTROL::EditSymbolProperties` serves when nothing is open.
   */
  const props = (c: Partial<SymbolConditions>): boolean =>
    symbolActionEnabled('symbolProperties', { ...NONE, ...c });

  it('a tree selection alone is enough', () => {
    expect(props({ symbolSelectedInTree: true })).toBe(true);
  });
  it('a loaded, editable symbol alone is enough', () => {
    expect(props({ canEditProperties: true, haveSymbol: true })).toBe(true);
  });
  it('a loaded symbol whose properties cannot be edited is not', () => {
    expect(props({ canEditProperties: false, haveSymbol: true })).toBe(false);
  });
  it('canEditProperties without a symbol is not', () => {
    expect(props({ canEditProperties: true, haveSymbol: false })).toBe(false);
  });
  it('none of the three is not', () => {
    expect(props({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The lambdas themselves
// ---------------------------------------------------------------------------

const LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "R" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "R_0_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
  (symbol "R_Small" (extends "R")
    (property "Value" "R_Small" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "http://example/ds.pdf" (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
  (symbol "U" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "U_1_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
    (symbol "U_2_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
  (symbol "U_Locked" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "ki_locked" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "U_Locked_1_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
    (symbol "U_Locked_2_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
  (symbol "DM" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "DM_1_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
    (symbol "DM_1_2" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
)`;
const SYMS = new Map(readSymbolLib(parse(LIB)).map((s) => [s.libId, s]));
const sym = (name: string): LibSymbol => {
  const s = SYMS.get(name);
  if (!s) throw new Error(`no symbol ${name}`);
  return s;
};

/** A frame with nothing open, nothing in the tree, an empty undo stack. */
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

/** `R` open from library `Device`, saved, nothing in the tree. */
const OPEN: SymbolFrameState = {
  ...COLD,
  symbol: sym('R'),
  symbolLibId: { nickname: 'Device', item: 'R' },
  symbolExists: () => true,
};

const at = (over: Partial<SymbolFrameState>): SymbolConditions =>
  symbolConditions({ ...OPEN, ...over });

describe('IsSymbolEditable / IsSymbolAlias (:2225-2234)', () => {
  it('a cold frame is neither editable nor editable-in-alias', () => {
    const c = symbolConditions(COLD);
    expect([c.haveSymbol, c.isEditable, c.isEditableInAlias, c.canUpdateFields]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  /** A root symbol: editable both ways, and it has no parent to update from. */
  it('a root symbol is editable, and cannot update fields from a parent', () => {
    const c = at({});
    expect([c.haveSymbol, c.isEditable, c.isEditableInAlias, c.canUpdateFields]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  /**
   * A derived symbol: `IsSymbolAlias()` is `m_symbol && !m_symbol->IsRoot()`,
   * so `isEditableCond` is false while `isEditableInAliasCond` stays true, and
   * `CanUpdateFieldsFromParent()` (`lib_symbol.h:356`) is `IsDerived()` and so
   * turns ON. Three different answers from one symbol; this is the case a
   * plausible-looking port collapses into one flag.
   */
  it('a derived symbol is editable-in-alias only, and CAN update fields', () => {
    const c = at({ symbol: sym('R_Small'), symbolLibId: { nickname: 'Device', item: 'R_Small' } });
    expect([c.haveSymbol, c.isEditable, c.isEditableInAlias, c.canUpdateFields]).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  /** `IsSymbolEditable()` (:2231) — a legacy-library symbol is not editable
   *  unless it came from the schematic. Nothing here can produce one, but the
   *  expression is upstream's and the second term is what rescues it. */
  it('a legacy-library symbol is not editable', () => {
    expect(at({ fromLegacyLibrary: true }).isEditable).toBe(false);
  });
  it('unless it came from the schematic', () => {
    expect(at({ fromLegacyLibrary: true, fromSchematic: true }).isEditable).toBe(true);
  });
});

describe('GetTargetLibId (:1359-1370)', () => {
  /** The second `if` is not an `else`: an empty tree nickname falls through. */
  it('an empty tree row falls through to the loaded symbol', () => {
    expect(targetLibId(OPEN)).toEqual({ nickname: 'Device', item: 'R' });
  });

  it('a tree row wins over the loaded symbol', () => {
    expect(targetLibId({ ...OPEN, treeLibId: { nickname: 'Other', item: 'C' } })).toEqual({
      nickname: 'Other',
      item: 'C',
    });
  });

  /** `if( IsLibraryTreeShown() )` — a hidden tree is not consulted at all. */
  it('a hidden tree is not read, even with a row selected', () => {
    expect(
      targetLibId({
        ...OPEN,
        libraryTreeShown: false,
        treeLibId: { nickname: 'Other', item: 'C' },
      }),
    ).toEqual({ nickname: 'Device', item: 'R' });
  });

  it('with neither, both halves are empty', () => {
    expect(targetLibId(COLD)).toEqual({ nickname: '', item: '' });
  });
});

describe('symbolModifiedCondition follows the TARGET, not the canvas (:489-494)', () => {
  /** Revert used to be `!!curName` — live the instant anything was open. */
  it('a freshly opened, unmodified symbol cannot be reverted', () => {
    expect(at({ isSymbolModified: () => false }).symbolModified).toBe(false);
  });

  it('the dirty bit is asked for the target LIB_ID', () => {
    const asked: string[] = [];
    const c = at({
      treeLibId: { nickname: 'Other', item: 'C' },
      isSymbolModified: (nickname, item) => {
        asked.push(`${nickname}:${item}`);
        return true;
      },
    });
    expect(asked).toEqual(['Other:C']);
    expect(c.symbolModified).toBe(true);
  });
});

describe('getTargetSymbol (:1345-1356)', () => {
  /** A valid tree LIB_ID short-circuits: the frame's own symbol is NOT a
   *  fallback once the tree names one, so a tree row pointing at a symbol the
   *  manager does not hold leaves Save As dead. */
  it('a tree row naming a missing symbol is not rescued by the open one', () => {
    expect(
      at({ treeLibId: { nickname: 'Other', item: 'C' }, symbolExists: () => false }).saveSymbolAs,
    ).toBe(false);
  });

  it('a tree row naming only a library falls through to the open symbol', () => {
    expect(at({ treeLibId: { nickname: 'Other', item: '' } }).saveSymbolAs).toBe(true);
  });

  it('a cold frame has no target symbol', () => {
    expect(symbolConditions(COLD).saveSymbolAs).toBe(false);
  });
});

describe('the symbol-shape conditions', () => {
  /** `multiUnitModeCond` (:609-613) — `IsMultiUnit() && !UnitsLocked()`. */
  it('a single-unit symbol cannot sync pins', () => {
    expect(at({}).multiUnitMode).toBe(false);
  });
  it('a multi-unit symbol can', () => {
    expect(at({ symbol: sym('U') }).multiUnitMode).toBe(true);
  });
  /** `UnitsLocked()` rides on the `ki_locked` field
   *  (`sch_io_kicad_sexpr_lib_cache.cpp:466-474`); locked units are not
   *  interchangeable, so editing one may not edit the others. */
  it('a multi-unit symbol with locked units cannot', () => {
    expect(at({ symbol: sym('U_Locked') }).multiUnitMode).toBe(false);
  });

  /** `multiBodyStyleModeCond` (:615-619) — `IsMultiBodyStyle()`. */
  it('cycleBodyStyle needs a second body style', () => {
    expect(at({}).multiBodyStyle).toBe(false);
    expect(at({ symbol: sym('DM') }).multiBodyStyle).toBe(true);
  });

  /** `haveDatasheetCond` (:627-631) — the FIELD, not the symbol. */
  it('an empty Datasheet field greys Show Datasheet', () => {
    expect(at({}).haveDatasheet).toBe(false);
  });
  it('a filled one lights it', () => {
    expect(at({ symbol: sym('R_Small') }).haveDatasheet).toBe(true);
  });
});

describe('the frame-state conditions', () => {
  it('undo and redo follow their own stacks', () => {
    expect(at({ undoCount: 0, redoCount: 3 }).undoAvailable).toBe(false);
    expect(at({ undoCount: 0, redoCount: 3 }).redoAvailable).toBe(true);
    expect(at({ undoCount: 2, redoCount: 0 }).undoAvailable).toBe(true);
    expect(at({ undoCount: 2, redoCount: 0 }).redoAvailable).toBe(false);
  });

  /** `cond.NoActiveTool()` is `ToolStackIsEmpty()`; the selection tool is
   *  always running and is not on the stack. */
  it('the selection tool is an empty tool stack', () => {
    expect(at({ activeTool: 'select' }).noActiveTool).toBe(true);
    expect(at({ activeTool: 'drawRectangle' }).noActiveTool).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The call sites: the menu bar and the toolbars read the same table
// ---------------------------------------------------------------------------

const noop = (): void => {};
const handlers = (): SymbolMenuHandlers => ({
  action: noop,
  tool: noop,
  toggle: noop,
  language: 'Default',
  onSelectLanguage: noop,
  showHotkeys: noop,
  showAbout: noop,
});
const menus = (conds: Partial<SymbolMenuConditions> = {}): Menu[] =>
  symbolEditorMenus(handlers(), {}, { ...ALL, symbolFromSchematic: false, ...conds });

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
const greyed = (bar: Menu[], label: string): boolean => find(bar, label).disabled === true;

describe('the menu bar reads the table', () => {
  /**
   * Every row that carries a condition, named with the condition that greys
   * it. A row whose feature is not built here is a permanent stub and is not
   * in this list — `symfp_menubar.test.ts` pins those.
   */
  it.each([
    ['Undo', 'undoAvailable'],
    ['Redo', 'redoAvailable'],
    ['Revert', 'symbolModified'],
    ['Delete', 'isEditable'],
    ['Pin Table...', 'isEditable'],
    ['Show Datasheet', 'haveDatasheet'],
    ['Edit Library Symbol...', 'symbolFromSchematic'],
    ['Draw Pins', 'isEditable'],
    ['Draw Text', 'isEditable'],
    ['Draw Rectangles', 'isEditable'],
    ['Draw Circles', 'isEditable'],
    ['Draw Arcs', 'isEditable'],
    ['Draw Lines', 'isEditable'],
    ['Draw Polygons', 'isEditable'],
  ] as [string, keyof SymbolConditions][])('%s is greyed when %s is false', (label, key) => {
    expect(greyed(menus({ [key]: true }), label)).toBe(false);
    expect(greyed(menus({ [key]: false }), label)).toBe(true);
  });

  /**
   * The rows that are live on a cold frame, spelled out. Three of these used
   * to be greyed here and are not upstream, and the fourth — Save — is
   * `ENABLE( ShowAlways )` at :529 because it reaches the library, not only
   * the symbol on the canvas.
   */
  it('greys nothing upstream leaves live on a cold frame', () => {
    const cold = menus(NONE);
    const live: Record<string, boolean> = {};
    for (const label of [
      'New Library...',
      'Add Library...',
      'New Symbol...',
      'Save',
      'Symbol Checker',
      'Revert',
      'Undo',
      'Delete',
      'Show Datasheet',
      'Symbol Properties...',
      'Pin Table...',
    ]) {
      live[label] = !greyed(cold, label);
    }
    expect(live).toEqual({
      // No SetConditions anywhere: ShowAlways.
      'New Library...': true,
      'Add Library...': true,
      'New Symbol...': true,
      // ENABLE( ShowAlways ) at :529.
      Save: true,
      // `checkSymbol` is never named by setupUIConditions (`runERC` is, and is
      // a different action), so it keeps the ShowAlways default.
      'Symbol Checker': true,
      // Everything else is gated and the frame is cold.
      Revert: false,
      Undo: false,
      Delete: false,
      'Show Datasheet': false,
      'Symbol Properties...': false,
      'Pin Table...': false,
    });
  });

  /** `SCH_ACTIONS::exportSymbol` gets no condition, so the row stays live even
   *  on a cold frame; ours gated it on a target symbol. It is in the Export
   *  submenu, whose label `Symbol...` is shared with Import's, so it is
   *  addressed by path rather than by first match. */
  it('File > Export > Symbol... is live on a cold frame', () => {
    const sub = find(menus(NONE), 'Export').submenu ?? [];
    expect(sub.find((i) => i.label === 'Symbol...')?.disabled).toBe(false);
  });
});

describe('the toolbars read the same table', () => {
  /** The top bar on a cold frame. Written out, because the regression was that
   *  the toolbars consulted NOTHING: every one of these was live. */
  it('greys exactly these top-bar buttons on a cold frame', () => {
    expect([...symbolToolbarDisabledIds(SYM_TOP_TOOLBAR, NONE)].sort()).toEqual([
      'mirrorH',
      'mirrorV',
      'pinTable',
      'redo',
      'rotateCCW',
      'rotateCW',
      'showDatasheet',
      'symbolProperties',
      'toggleSyncedPinsMode',
      'undo',
    ]);
  });

  /** Save, Save All, Symbol Checker and Add Symbol to Schematic are NOT in that
   *  set: none is named by setupUIConditions, and `save` is explicitly
   *  `ENABLE( ShowAlways )`. */
  it.each([
    'save',
    'saveAll',
    'checkSymbol',
    'addSymbolToSchematic',
    'newSymbol',
  ])('%s stays live on a cold frame', (id) => {
    expect(symbolToolbarDisabledIds(SYM_TOP_TOOLBAR, NONE).has(id)).toBe(false);
  });

  /**
   * The left bar greys nothing, ever, and that is a claim about upstream
   * rather than an omission here: every action on it — the grid toggles
   * (:541-542), the units and crosshair groups (`eda_draw_frame.cpp:1372-1374`),
   * `showElectricalTypes`, `showHiddenPins`, `showHiddenFields`,
   * `showLibraryTree`, `showProperties` (:601-607) — is registered with
   * `CHECK( … )` and no `ENABLE`, so its enabled state is unconditional. The
   * frame still hands the bar a `disabledIds` set for uniformity; this is what
   * says the set is empty by rule and not by accident.
   */
  it('greys nothing on the left bar, on a cold frame or any other', () => {
    expect([...symbolToolbarDisabledIds(SYM_LEFT_TOOLBAR, NONE)]).toEqual([]);
    expect([...symbolToolbarDisabledIds(SYM_LEFT_TOOLBAR, ALL)]).toEqual([]);
  });

  /** The right bar is `EDIT_TOOL( … )` end to end except the selection tool,
   *  which is `ACTIONS::selectionTool` — a CHECK-only registration (:562). */
  it('greys every drawing tool on a cold frame, and not Select', () => {
    expect([...symbolToolbarDisabledIds(SYM_RIGHT_TOOLBAR, NONE)].sort()).toEqual([
      'bezier',
      'deleteTool',
      'drawArc',
      'drawCircle',
      'drawPolygon',
      'drawRectangle',
      'drawSymbolLines',
      'drawSymbolTextBox',
      'placeAnchor',
      'placePin',
      'placeText',
    ]);
  });

  /**
   * The asymmetry, on the buttons that actually carry it: the top toolbar is
   * the only surface with Rotate and Mirror on it (the menu bar has neither).
   * On a derived symbol upstream leaves Rotate live and kills Mirror.
   */
  it('an alias keeps Rotate and loses Mirror', () => {
    const alias: SymbolConditions = { ...ALL, isEditable: false, isEditableInAlias: true };
    const off = symbolToolbarDisabledIds(SYM_TOP_TOOLBAR, alias);
    expect(off.has('rotateCW')).toBe(false);
    expect(off.has('rotateCCW')).toBe(false);
    expect(off.has('mirrorH')).toBe(true);
    expect(off.has('mirrorV')).toBe(true);
  });
});
