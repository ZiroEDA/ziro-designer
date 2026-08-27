// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME::setupUIConditions`
 * (`eeschema/symbol_editor/symbol_edit_frame.cpp:448-660`), transcribed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * `ACTION_MANAGER::SetConditions` is the *only* thing that decides whether a
 * row or a button in this frame is live, and upstream states all 53 of them in
 * one function. Ours were spread over three places and mostly said nothing:
 * the menu bar carried four booleans computed inline in `SymbolEditor.tsx`, the
 * toolbars carried a static `disabled: true` for anything unbuilt and nothing
 * at all for anything built, and the frame's own handlers re-tested the
 * conditions a fourth time (`rotateSel` bailed on an alias; upstream's rotate
 * does not).
 *
 * The rules live in a `.ts` and not in the `.tsx` because **`qa`'s tsconfig
 * compiles `.ts` only** — importing a *value* from a `.tsx` fails CI with
 * TS6142 — so a condition written inside the frame is a rule no test can run.
 * Every drift below was found by moving the rules here and then asking them.
 *
 * ---------------------------------------------------------------------------
 * THE DEFAULT IS "ENABLED"
 * ---------------------------------------------------------------------------
 *
 * `ACTION_CONDITIONS()`'s constructor (`include/tool/action_manager.h:50-55`)
 * is `enableCondition = SELECTION_CONDITIONS::ShowAlways`. An action
 * `setupUIConditions` never names therefore keeps a **live** row — which is
 * why `SCH_ACTIONS::checkSymbol` (Inspect > Symbol Checker), `ACTIONS::find`,
 * `ACTIONS::newLibrary` and `SCH_ACTIONS::exportSymbol` are live on a cold
 * frame upstream. `symbolActionEnabled` returns `true` for an unknown id for
 * exactly that reason, and it is not a shortcut: it is the upstream default.
 *
 * ---------------------------------------------------------------------------
 * THE ALIAS RULE, WHICH IS TWO RULES
 * ---------------------------------------------------------------------------
 *
 * `isEditableCond` (:466-472) is `IsSymbolEditable() && !IsSymbolAlias()`;
 * `isEditableInAliasCond` (:474-481) is `IsSymbolEditable()` alone, and the
 * comment upstream says why the second exists:
 *
 *     // Less restrictive than isEditableCond
 *     // Symbols fields (root symbols and aliases) from the new s-expression
 *     // libraries or in the schematic are editable.
 *
 * So on a derived symbol **rotate is allowed and mirror is not** (:554-559).
 * That is not a slip to be tidied — a derived symbol owns its own fields and
 * nothing else, `SYMBOL_EDITOR_EDIT_TOOL::Rotate` (:562-608) rotates a
 * `SCH_FIELD_T` happily, and neither tool re-checks the alias flag, so the
 * gate is here or nowhere.
 */

import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import { hasAlternateBodyStyle, unitCount, unitsLocked } from './edits.js';
import type { ToolEntry } from '../../ui/toolbar_types.js';

/** The two halves of a `LIB_ID`, as `GetLibNickname()` / `GetLibItemName()`. */
export interface LibIdParts {
  nickname: string;
  item: string;
}

/**
 * The frame facts the conditions are computed from — one field per expression
 * `setupUIConditions`' lambdas evaluate, and nothing derived. The frame hands
 * these over; every `&&` between them is below, where a test can run it.
 */
export interface SymbolFrameState {
  /** `m_symbol` — the symbol on the canvas, or null for a cold frame. */
  symbol: LibSymbol | null;
  /**
   * `IsSymbolFromLegacyLibrary()` (:892-905): the symbol's library row is a
   * `SCH_IO_MGR::SCH_LEGACY` one.
   *
   * Always false here and it is not a stub: this port reads `.kicad_sym`
   * only, there is no legacy plugin to load a `.lib` through, so no symbol can
   * come from one. It stays a named field rather than being folded away so
   * that `isEditable` reads as upstream's expression does.
   */
  fromLegacyLibrary: boolean;
  /** `IsSymbolFromSchematic()` — this frame was opened on a schematic's own symbol. */
  fromSchematic: boolean;
  /** `IsLibraryTreeShown()`, which is what makes `GetTargetLibId` read the tree. */
  libraryTreeShown: boolean;
  /** `GetTreeLIBID()` — the tree's selected row, empty parts when none. */
  treeLibId: LibIdParts;
  /** `m_symbol->GetLibId()`; empty parts when no symbol is loaded. */
  symbolLibId: LibIdParts;
  /** `GetUndoCommandCount()` (`EDITOR_CONDITIONS::UndoAvailable`). */
  undoCount: number;
  /** `GetRedoCommandCount()` (`EDITOR_CONDITIONS::RedoAvailable`). */
  redoCount: number;
  /** `SELECTION_CONDITIONS::Idle` — no item is being dragged/edited. */
  idle: boolean;
  /**
   * `EDITOR_CONDITIONS::NoActiveTool` — `ToolStackIsEmpty()`. The selection
   * tool is always running and is not on the stack, so our `'select'` is
   * upstream's empty stack.
   */
  activeTool: string;
  /** `m_libMgr->IsSymbolModified( item, nickname )`. */
  isSymbolModified: (nickname: string, item: string) => boolean;
  /** `m_libMgr->GetSymbol( item, nickname ) != nullptr`. */
  symbolExists: (nickname: string, item: string) => boolean;
}

/**
 * The lambdas of `setupUIConditions`, evaluated. One field per lambda, named
 * as upstream names it, so the table below reads like the C++ it came from.
 */
export interface SymbolConditions {
  /** `haveSymbolCond` (:460-464) — `m_symbol`. */
  haveSymbol: boolean;
  /** `isEditableCond` (:466-472) — `IsSymbolEditable() && !IsSymbolAlias()`. */
  isEditable: boolean;
  /** `isEditableInAliasCond` (:474-481) — `IsSymbolEditable()`. */
  isEditableInAlias: boolean;
  /** `canUpdateFieldsCond` (:483-487) — editable **and** derived from a parent. */
  canUpdateFields: boolean;
  /** `symbolModifiedCondition` (:489-494) — the TARGET symbol's dirty bit. */
  symbolModified: boolean;
  /** `libSelectedCondition` (:496-500) — the target LIB_ID names a library. */
  libSelected: boolean;
  /** `canEditProperties` (:502-506) — `m_symbol && (!legacy || fromSchematic)`. */
  canEditProperties: boolean;
  /** `symbolSelectedInTreeCondition` (:508-513) — target LIB_ID names both halves. */
  symbolSelectedInTree: boolean;
  /** `saveSymbolAsCondition` (:515-519) — `getTargetSymbol() != nullptr`. */
  saveSymbolAs: boolean;
  /** `isSymbolFromSchematicCond` (:521-525). */
  symbolFromSchematic: boolean;
  /** `cond.UndoAvailable()`. */
  undoAvailable: boolean;
  /** `cond.RedoAvailable()`. */
  redoAvailable: boolean;
  /** `SELECTION_CONDITIONS::Idle`. */
  idle: boolean;
  /** `cond.NoActiveTool()`. */
  noActiveTool: boolean;
  /** `multiUnitModeCond` (:609-613) — `IsMultiUnit() && !UnitsLocked()`. */
  multiUnitMode: boolean;
  /** `multiBodyStyleModeCond` (:615-619) — `IsMultiBodyStyle()`. */
  multiBodyStyle: boolean;
  /** `haveDatasheetCond` (:627-631) — the Datasheet field's text is not empty. */
  haveDatasheet: boolean;
}

/** `LIB_SYMBOL::GetDatasheetField().GetText()`. */
function datasheetText(sym: LibSymbol): string {
  return sym.properties.find((f) => f.key === 'Datasheet')?.value ?? '';
}

/**
 * `GetTargetLibId()` (:1359-1370):
 *
 *     if( IsLibraryTreeShown() )   id = GetTreeLIBID();
 *     if( id.GetLibNickname().empty() && m_symbol )  id = m_symbol->GetLibId();
 *
 * Note the second `if` is not an `else`: a tree row that names no library
 * falls through to the loaded symbol, and a tree row that names one wins even
 * when a different symbol is open.
 */
export function targetLibId(state: SymbolFrameState): LibIdParts {
  let id: LibIdParts = { nickname: '', item: '' };
  if (state.libraryTreeShown) id = state.treeLibId;
  if (id.nickname === '' && state.symbol) id = state.symbolLibId;
  return id;
}

/**
 * `getTargetSymbol()` (:1345-1356) reduced to "is there one": the tree's
 * symbol when the tree is shown and its LIB_ID is valid, otherwise `m_symbol`.
 * `LIB_ID::IsValid()` is both halves non-empty.
 */
function haveTargetSymbol(state: SymbolFrameState): boolean {
  if (state.libraryTreeShown) {
    const { nickname, item } = state.treeLibId;
    if (nickname !== '' && item !== '') return state.symbolExists(nickname, item);
  }
  return state.symbol !== null;
}

/** Every lambda of `setupUIConditions`, evaluated against one frame state. */
export function symbolConditions(state: SymbolFrameState): SymbolConditions {
  const sym = state.symbol;
  const haveSymbol = sym !== null;
  // `IsSymbolEditable()` (:2231-2234).
  const editable = haveSymbol && (!state.fromLegacyLibrary || state.fromSchematic);
  // `IsSymbolAlias()` (:2225-2228) — `m_symbol && !m_symbol->IsRoot()`.
  const isAlias = haveSymbol && sym.extends !== undefined;
  const target = targetLibId(state);

  return {
    haveSymbol,
    isEditable: editable && !isAlias,
    isEditableInAlias: editable,
    // `IsSymbolEditable() && m_symbol && m_symbol->CanUpdateFieldsFromParent()`,
    // and `CanUpdateFieldsFromParent()` is `IsDerived()` (`lib_symbol.h:356`).
    canUpdateFields: editable && isAlias,
    symbolModified: state.isSymbolModified(target.nickname, target.item),
    libSelected: target.nickname !== '',
    // Upstream spells this out again rather than reusing IsSymbolEditable();
    // it is the same expression, and it is kept separate here for the same
    // reason — the two are set on different actions and could diverge.
    canEditProperties: haveSymbol && (!state.fromLegacyLibrary || state.fromSchematic),
    symbolSelectedInTree: target.nickname !== '' && target.item !== '',
    saveSymbolAs: haveTargetSymbol(state),
    symbolFromSchematic: state.fromSchematic,
    undoAvailable: state.undoCount > 0,
    redoAvailable: state.redoCount > 0,
    idle: state.idle,
    noActiveTool: state.activeTool === 'select',
    multiUnitMode: haveSymbol && unitCount(sym) > 1 && !unitsLocked(sym),
    multiBodyStyle: haveSymbol && hasAlternateBodyStyle(sym),
    haveDatasheet: haveSymbol && datasheetText(sym) !== '',
  };
}

/**
 * The `ENABLE( … )` half of every `SetConditions` call in
 * `setupUIConditions`, keyed by **our** action id — the id the menu bar and the
 * toolbars already dispatch, which is what `ui/hotkeys_inventory.ts` keys on
 * too. Upstream's action name is in the comment where the two differ.
 *
 * An action absent from this table is `ShowAlways`, which is upstream's
 * default and not an omission. The CHECK-only registrations (`toggleGrid`,
 * `toggleGridOverrides`, `zoomTool`, `selectionTool`, `showElectricalTypes`,
 * `toggleBoundingBoxes`, `showLibraryTree`, `showProperties`,
 * `showHiddenPins`, `showHiddenFields`, `togglePinAltIcons`) set no ENABLE at
 * all, so they are absent here on purpose: their tick is the `toggles` set and
 * their enabled state is unconditional.
 */
export const SYMBOL_ACTION_ENABLE: Readonly<Record<string, (c: SymbolConditions) => boolean>> = {
  // ----- File (:530-535) ----------------------------------------------------
  /** `SCH_ACTIONS::saveLibraryAs` (:530). */
  saveLibraryAs: (c) => c.libSelected,
  /** `SCH_ACTIONS::saveSymbolAs` (:531). */
  saveSymbolAs: (c) => c.saveSymbolAs,
  /** `SCH_ACTIONS::saveSymbolCopyAs` (:532). */
  saveSymbolCopyAs: (c) => c.saveSymbolAs,
  /** `SCH_ACTIONS::editLibSymbolWithLibEdit` (:535). */
  editLibSymbolWithLibEdit: (c) => c.symbolFromSchematic,

  // ----- Edit (:537-559) ----------------------------------------------------
  /** `ACTIONS::undo` (:537) — `haveSymbolCond && cond.UndoAvailable()`. */
  undo: (c) => c.haveSymbol && c.undoAvailable,
  /** `ACTIONS::redo` (:538). */
  redo: (c) => c.haveSymbol && c.redoAvailable,
  /** `ACTIONS::revert` (:539) — the TARGET symbol's dirty bit, not "a symbol is open". */
  revert: (c) => c.symbolModified,
  /** `ACTIONS::cut` (:544). */
  cut: (c) => c.isEditable,
  /** `ACTIONS::copy` (:545) — copy is allowed on an alias; cut is not. */
  copy: (c) => c.haveSymbol,
  /** `ACTIONS::copyAsText` (:546). */
  copyAsText: (c) => c.haveSymbol,
  /** `ACTIONS::paste` (:547-548). */
  paste: (c) => c.isEditable && c.idle && c.noActiveTool,
  /** `ACTIONS::doDelete` (:549) — note it does NOT ask for a selection. */
  doDelete: (c) => c.isEditable,
  /** `ACTIONS::duplicate` (:550). */
  duplicate: (c) => c.isEditable,
  /** `ACTIONS::selectAll` (:551). */
  selectAll: (c) => c.haveSymbol,
  /** `ACTIONS::unselectAll` (:552). */
  unselectAll: (c) => c.haveSymbol,
  /** `SCH_ACTIONS::rotateCW` (:555) — `isEditableInAliasCond`, see the header. */
  rotateCW: (c) => c.isEditableInAlias,
  /** `SCH_ACTIONS::rotateCCW` (:556). */
  rotateCCW: (c) => c.isEditableInAlias,
  /** `SCH_ACTIONS::mirrorH` (:558) — `isEditableCond`, which excludes an alias. */
  mirrorH: (c) => c.isEditable,
  /** `SCH_ACTIONS::mirrorV` (:559). */
  mirrorV: (c) => c.isEditable,

  // ----- Inspect / properties (:633-640) ------------------------------------
  /** `ACTIONS::showDatasheet` (:633) — a non-empty Datasheet field. */
  showDatasheet: (c) => c.haveDatasheet,
  /** `SCH_ACTIONS::symbolProperties` (:634). */
  symbolProperties: (c) => c.symbolSelectedInTree || (c.canEditProperties && c.haveSymbol),
  /**
   * `SCH_ACTIONS::runERC` (:635). No row or button in this frame dispatches it
   * — the Inspect menu carries `SCH_ACTIONS::checkSymbol`, a different action
   * (`sch_actions.cpp:47-59`) that upstream gives no condition, so Symbol
   * Checker is live on a cold frame. Kept so the transcription is complete.
   */
  runERC: (c) => c.haveSymbol,
  /** `SCH_ACTIONS::pinTable` (:636). */
  pinTable: (c) => c.isEditable && c.haveSymbol,
  /** `SCH_ACTIONS::updateSymbolFields` (:637). */
  updateSymbolFields: (c) => c.canUpdateFields,
  /** `SCH_ACTIONS::cycleBodyStyle` (:638). */
  cycleBodyStyle: (c) => c.multiBodyStyle,
  /** `SCH_ACTIONS::toggleSyncedPinsMode` (:640) — Enable(multiUnitModeCond). */
  toggleSyncedPinsMode: (c) => c.multiUnitMode,

  // ----- EDIT_TOOL( tool ) (:643-656) ---------------------------------------
  //
  //     #define EDIT_TOOL( tool ) \
  //         ACTION_CONDITIONS().Enable( isEditableCond ).Check( cond.CurrentTool( tool ) )
  //
  // Twelve actions, all gated on `isEditableCond`, so every drawing tool is
  // dead on a derived symbol as well as on a cold frame.
  /** `ACTIONS::deleteTool` (:645). */
  deleteTool: (c) => c.isEditable,
  /** `SCH_ACTIONS::placeSymbolPin` (:646). */
  placePin: (c) => c.isEditable,
  /** `SCH_ACTIONS::placeSymbolText` (:647). */
  placeText: (c) => c.isEditable,
  /** `SCH_ACTIONS::drawSymbolTextBox` (:648). */
  drawSymbolTextBox: (c) => c.isEditable,
  /** `SCH_ACTIONS::drawRectangle` (:649). */
  drawRectangle: (c) => c.isEditable,
  /** `SCH_ACTIONS::drawCircle` (:650). */
  drawCircle: (c) => c.isEditable,
  /** `SCH_ACTIONS::drawArc` (:651). */
  drawArc: (c) => c.isEditable,
  /** `SCH_ACTIONS::drawBezier` (:652). */
  bezier: (c) => c.isEditable,
  /** `SCH_ACTIONS::drawSymbolLines` (:653). */
  drawSymbolLines: (c) => c.isEditable,
  /** `SCH_ACTIONS::drawSymbolPolygon` (:654). */
  drawPolygon: (c) => c.isEditable,
  /** `SCH_ACTIONS::placeSymbolAnchor` (:655). */
  placeAnchor: (c) => c.isEditable,
  /** `SCH_ACTIONS::importGraphics` (:656). */
  importGraphics: (c) => c.isEditable,
};

/**
 * Whether `id`'s row/button is live. An id with no entry is `ShowAlways` —
 * `ACTION_CONDITIONS()`'s default `enableCondition`, which is what upstream
 * leaves on every action `setupUIConditions` does not name.
 */
export function symbolActionEnabled(id: string, c: SymbolConditions): boolean {
  const rule = SYMBOL_ACTION_ENABLE[id];
  return rule ? rule(c) : true;
}

/**
 * The ids in `entries` whose condition is false, for `Toolbar`'s `disabledIds`.
 *
 * Derived from the toolbar's own entries rather than from a second hand-written
 * list, so a button added to `symbolToolbars.ts` is covered the moment it is
 * added. A button's own static `disabled` (a feature not built yet) is applied
 * by `Toolbar` on top of this and is not restated here.
 */
export function symbolToolbarDisabledIds(
  entries: readonly ToolEntry[],
  c: SymbolConditions,
): Set<string> {
  const out = new Set<string>();
  const check = (id: string): void => {
    if (!symbolActionEnabled(id, c)) out.add(id);
  };
  for (const e of entries) {
    if (e === 'sep' || 'spacer' in e || 'control' in e) continue;
    if ('group' in e) for (const a of e.actions) check(a.id);
    else check(e.id);
  }
  return out;
}
