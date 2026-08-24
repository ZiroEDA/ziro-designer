// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint tree's right-click menu — `FOOTPRINT_EDITOR_CONTROL::Init`
 * (`pcbnew/tools/footprint_editor_control.cpp:81-171`) plus
 * `LIBRARY_EDITOR_CONTROL::AddContextMenuItems`
 * (`common/tool/library_editor_control.cpp:41-85`), which every library editor
 * appends to its own tree menu.
 *
 * **There was no menu here at all.** Right-clicking a library or a footprint in
 * our tree did nothing; the only tree gesture that existed was a Delete key
 * binding invented for the purpose. Fifteen rows, and the entire second half of
 * what a library editor is for — rename, duplicate, revert, pin — were
 * unreachable.
 *
 * Built through `ui/conditional_menu.ts`, the shared `CONDITIONAL_MENU` port,
 * for the reason that file gives: writing the evaluated shape out by hand is
 * how a menu stops matching, because the conditions end up spelled once in the
 * layout instead of once per row, and separators stop eliding. Two tools
 * contribute to this one menu upstream — the footprint editor's and the shared
 * library editor's — at orders 1/10/100/200/400, and `Evaluate` interleaves
 * them. That is exactly what `AddItem( action, condition, order )` is for.
 *
 * A `.ts`, not part of `FootprintEditor.tsx`, so a test can read the rows.
 */

import type { MenuItem } from '../../ui/menu_types.js';
import {
  type ConditionalEntry,
  evaluateConditionalMenu,
  menuEntry,
  menuSeparator,
} from '../../ui/conditional_menu.js';

/**
 * What the tree selection is, which is all four of `Init`'s conditions
 * (:89-111) read off `GetLibTree()->GetSelectedLibId()`.
 */
export interface FpTreeSelection {
  /** `sel.GetLibNickname()` — empty string for no selection. */
  library: string;
  /** `sel.GetLibItemName()` — empty when a library row is selected. */
  footprint: string;
  /** `LIB_TREE_NODE::m_Pinned` for the selected library. */
  pinned: boolean;
}

/** The handlers the rows dispatch to, keyed the way the toolbars key ids. */
export interface FpTreeMenuHandlers {
  action: (id: string) => void;
}

/**
 * `fpExportCondition` (:113-118) — `GetBoard()->GetFirstFootprint() != nullptr`.
 * The one condition in this menu that asks about the canvas rather than the
 * tree.
 */
export interface FpTreeMenuConditions {
  haveFootprint: boolean;
}

/**
 * Rows whose command does not exist in this port yet. They are shown, in their
 * upstream position, and greyed — the same treatment `menubar.ts` gives its
 * stubs, and for the same reason: a missing row is a parity gap you cannot see,
 * while a greyed one says what is coming.
 *
 * `CONDITIONAL_MENU` conditions decide whether a row is *present*;
 * `ACTION_CONDITIONS` decides whether it is *enabled*. These are the second
 * kind, so they do not change which rows appear.
 */
const UNIMPLEMENTED = new Set([
  'createFootprint',
  'saveAs',
  'cutFootprint',
  'copyFootprint',
  'pasteFootprint',
  'duplicateFootprint',
  'renameFootprint',
]);

/** One `AddItem( ACTION, condition, order )`, with the action's FriendlyName. */
function row(
  h: FpTreeMenuHandlers,
  label: string,
  id: string,
  when: boolean,
  order: number,
): ConditionalEntry {
  const item: MenuItem = UNIMPLEMENTED.has(id)
    ? { label, icon: id, disabled: true }
    : { label, icon: id, action: () => h.action(id) };
  return menuEntry(item, order, when);
}

/**
 * The menu, evaluated against one tree selection.
 *
 * Every label is the action's `.FriendlyName()`, out of `common/tool/actions.cpp`
 * and `pcbnew/tools/pcb_actions.cpp`: "Delete Footprint from Library", not
 * "Delete"; "Export Current Footprint...", which is a different string from the
 * File > Export submenu's "Footprint..." because that one passes a replacement
 * label to `ACTION_MENU::Add` and this one does not.
 */
export function footprintTreeContextMenu(
  h: FpTreeMenuHandlers,
  sel: FpTreeSelection,
  conds: FpTreeMenuConditions,
): MenuItem[] {
  // :89-111, verbatim. `libInferred` is deliberately looser than `libSelected`:
  // "allows you to do things like New Symbol and Paste with a symbol selected
  // (in other words, when we know the library context even if the library
  // itself isn't selected)".
  const libSelected = sel.library !== '' && sel.footprint === '';
  const libInferred = sel.library !== '';
  const fpSelected = sel.library !== '' && sel.footprint !== '';

  const entries: ConditionalEntry[] = [
    // --- LIBRARY_EDITOR_CONTROL::AddContextMenuItems, order 1 -----------------
    row(h, 'Pin Library', 'pinLibrary', libInferred && !sel.pinned, 1),
    row(h, 'Unpin Library', 'unpinLibrary', libInferred && sel.pinned, 1),
    menuSeparator(1),

    // --- FOOTPRINT_EDITOR_CONTROL::Init, order 10 ----------------------------
    row(h, 'New Footprint', 'newFootprint', libSelected, 10),
    row(h, 'Create Footprint...', 'createFootprint', libSelected, 10),
    menuSeparator(10),
    row(h, 'Save', 'save', true, 10),
    row(h, 'Save As...', 'saveAs', libSelected || fpSelected, 10),
    row(h, 'Revert', 'revert', libSelected || libInferred, 10),
    menuSeparator(10),
    row(h, 'Cut Footprint', 'cutFootprint', fpSelected, 10),
    row(h, 'Copy Footprint', 'copyFootprint', fpSelected, 10),
    row(h, 'Paste Footprint', 'pasteFootprint', libInferred, 10),
    row(h, 'Duplicate Footprint', 'duplicateFootprint', fpSelected, 10),
    row(h, 'Rename Footprint...', 'renameFootprint', fpSelected, 10),
    row(h, 'Delete Footprint from Library', 'deleteFootprint', fpSelected, 10),
    row(h, 'Footprint Properties...', 'footprintProperties', fpSelected, 10),

    // --- order 100 -----------------------------------------------------------
    menuSeparator(100),
    row(h, 'Import Footprint...', 'importFootprint', libInferred, 100),
    row(h, 'Export Current Footprint...', 'exportFootprint', conds.haveFootprint, 100),

    // NOT here: `ACTIONS::openWithTextEditor` and `ACTIONS::openDirectory` at
    // order 200. Both are behind `ADVANCED_CFG::m_EnableLibWithText` /
    // `m_EnableLibDir`, which default **false** (`advanced_config.cpp:280-281`),
    // so a stock KiCad never draws them — and neither has any meaning in a
    // browser.

    // --- AddContextMenuItems, order 400 --------------------------------------
    menuSeparator(400),
    row(h, 'Hide Library Tree', 'hideLibraryTree', true, 400),
  ];

  return evaluateConditionalMenu(entries);
}
