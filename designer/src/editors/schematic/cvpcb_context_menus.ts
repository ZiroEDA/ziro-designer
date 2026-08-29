// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two right-click menus of the Assign Footprints window. Counterpart:
 * `CVPCB_MAINFRAME::setupTools` (cvpcb/cvpcb_mainframe.cpp:271-285), which
 * builds them, and `setupEventHandlers` (`:333-344`), which pops them up.
 *
 *     m_symbolsContextMenu = new ACTION_MENU( false, tool );
 *     m_symbolsContextMenu->Add( CVPCB_ACTIONS::showFootprintViewer );
 *     m_symbolsContextMenu->AppendSeparator();
 *     m_symbolsContextMenu->Add( ACTIONS::cut );
 *     m_symbolsContextMenu->Add( ACTIONS::copy );
 *     m_symbolsContextMenu->Add( ACTIONS::paste );
 *     m_symbolsContextMenu->AppendSeparator();
 *     m_symbolsContextMenu->Add( CVPCB_ACTIONS::deleteAssoc );
 *
 *     m_footprintContextMenu = new ACTION_MENU( false, tool );
 *     m_footprintContextMenu->Add( CVPCB_ACTIONS::showFootprintViewer );
 *
 * Data, not a component, for the reason `cvpcb_commands.ts` is: a menu built
 * inside a `.tsx` closure cannot be tested, and the window's header claimed
 * both of these menus were ported while the file handled no right-click at all.
 *
 * ## Three things that are easy to get wrong, and all three are upstream's
 *
 * **No row is ever disabled.** `setupUIConditions` (`:288-330`) sets a
 * condition for `saveAssociationsToSchematic`, `saveAssociationsToFile`,
 * `undo`, `redo` and the three filter toggles, and for nothing else — so
 * showFootprintViewer, cut, copy, paste and deleteAssoc are always live and
 * take their own guards silently. That is the same finding the Edit menu
 * already carries; these are literally the same TOOL_ACTIONs.
 *
 * **The right button does not change the selection.** The two handlers are
 * `[this]( wxMouseEvent& ) { PopupMenu( … ); }` — no `event.Skip()`, and
 * nothing that reads the position, hit-tests a row or selects one. The menu is
 * raised and that is all it does, so every row acts on the CURRENT selection
 * rather than on the row under the pointer: right-clicking an unselected
 * symbol and choosing Copy copies the SELECTED one's footprint. Making the
 * right button select first would be an invention, and the invention would be
 * silent — a Delete Footprint Assignment that cleared a different row than the
 * one it appeared over.
 *
 * **View Selected Footprint shows; it never hides.**
 * `CVPCB_CONTROL::ShowFootprintViewer` (cvpcb_control.cpp:156-214) creates the
 * DISPLAY_FOOTPRINTS_FRAME or, if it already exists, raises it and calls
 * `InitDisplay()`. There is no branch that closes it. The toolbar button ran a
 * toggle here, so a second press hid the viewer where KiCad would have brought
 * it forward; the panel's own ✕ is what stands for closing the frame.
 */

import type { MenuItem } from '../../ui/menu_types.js';

/** What the rows run. Each is the TOOL_ACTION of the same name. */
export interface CvpcbContextMenuActions {
  /** `CVPCB_ACTIONS::showFootprintViewer` — show, never toggle. */
  showFootprintViewer: () => void;
  /** `ACTIONS::cut` / `copy` / `paste`, the clipboard commands in
   *  `cvpcb_commands.ts`. */
  cut: () => void;
  copy: () => void;
  paste: () => void;
  /** `CVPCB_ACTIONS::deleteAssoc`. */
  deleteAssoc: () => void;
}

/**
 * `m_symbolsContextMenu` — the "Symbol : Footprint Assignments" pane's.
 *
 * The accelerators are the actions' own `DefaultHotkey`s, spelled the way the
 * menu draws them: `MD_CTRL + 'X' / 'C' / 'V'` (common/tool/actions.cpp:308-348)
 * and `WXK_DELETE` for `deleteAssoc` (cvpcb_actions.cpp:129-134).
 * `showFootprintViewer` declares none, so its row shows none.
 */
export function cvpcbSymbolsContextMenu(actions: CvpcbContextMenuActions): MenuItem[] {
  return [
    {
      label: 'View Selected Footprint',
      icon: 'cvpcbViewFootprint',
      action: actions.showFootprintViewer,
    },
    { sep: true },
    { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', action: actions.cut },
    { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', action: actions.copy },
    {
      // Ctrl+V is left to the browser's own paste event, the only reliable read
      // of the system clipboard — see MenuItem.nativeShortcut. The row still
      // declares the accelerator, because the menu draws it.
      label: 'Paste',
      icon: 'paste',
      shortcut: 'Ctrl+V',
      nativeShortcut: true,
      action: actions.paste,
    },
    { sep: true },
    {
      label: 'Delete Footprint Assignment',
      icon: 'cvpcbDeleteAssoc',
      shortcut: 'Delete',
      action: actions.deleteAssoc,
    },
  ];
}

/**
 * `m_footprintContextMenu` — the "Filtered Footprints" pane's, which is one
 * row and no separator.
 *
 * The library pane has no context menu at all: `setupEventHandlers` binds
 * `wxEVT_RIGHT_DOWN` on the footprint and symbol lists only.
 */
export function cvpcbFootprintsContextMenu(actions: CvpcbContextMenuActions): MenuItem[] {
  return [
    {
      label: 'View Selected Footprint',
      icon: 'cvpcbViewFootprint',
      action: actions.showFootprintViewer,
    },
  ];
}
