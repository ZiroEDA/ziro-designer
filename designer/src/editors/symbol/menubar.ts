// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME::doReCreateMenuBar`
 * (`eeschema/symbol_editor/menubar_symbol_editor.cpp:36-194`).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * It used to be a `useMemo` inside `SymbolEditor.tsx`, and that is not a style
 * question. **`qa`'s tsconfig compiles `.ts` only**, so a menu built inside a
 * `.tsx` cannot be imported by a test — no test in the suite could name a row,
 * count one, or notice one missing. The schematic editor, GerbView and the
 * project manager had each already been moved out for exactly this reason
 * (`editors/schematic/menubar.ts`, `editors/gerbview/menubar.ts`,
 * `home/menubar.ts`); the symbol and footprint editors were the two left.
 *
 * The move is deliberately behaviour-preserving: this commit produces the tree
 * the frame produced before it, row for row, so that the commit which follows
 * is purely "what upstream has and we did not".
 *
 * ---------------------------------------------------------------------------
 * THE THREE HANDLERS
 * ---------------------------------------------------------------------------
 *
 * Same shape as `editors/schematic/menubar.ts`, because it is the same idea:
 *
 *   - `tool(id)`   arms a placement/drawing tool (the RIGHT_TOOLBAR ids);
 *   - `action(id)` runs a one-shot command (save / undo / zoom …);
 *   - `toggle(id)` flips a CHECK setting.
 *
 * An id here is the id the **toolbar** already uses for the same command
 * (`symbolToolbars.ts`), not a second name for it: `ui/hotkeys_inventory.ts`
 * keys on that id the way `HOTKEY_STORE` keys on `TOOL_ACTION::GetName()`, so
 * an action reachable from both the bar and the menu must carry one id or the
 * Hotkey List shows it twice.
 */

import type { Menu, MenuItem } from '../../ui/menu_types.js';
import { addClose } from '../../ui/action_menu.js';
import { browserSafeKey } from '../../ui/browser_reserved.js';
import { standardHelpMenu } from '../../ui/help_menu.js';

const SEP: MenuItem = { sep: true };

export interface SymbolMenuHandlers {
  /** A one-shot command. */
  action: (id: string) => void;
  /** Arm a placement/drawing tool. */
  tool: (id: string) => void;
  /** Flip a CHECK setting. */
  toggle: (id: string) => void;
  /** `ACTIONS::listHotKeys`, through the shared Help menu. */
  showHotkeys: () => void;
  /** `ACTIONS::about`, through the shared Help menu. */
  showAbout: () => void;
}

/** `ACTION_MENU::CHECK` state, keyed by toggle id. */
export type SymbolMenuChecks = Readonly<Record<string, boolean>>;

/**
 * The `ENABLE( … )` conditions of `SYMBOL_EDIT_FRAME::setupUIConditions`
 * (`symbol_edit_frame.cpp:448-562`) that this menu bar reads. The names are
 * upstream's lambda names; the frame evaluates them.
 */
export interface SymbolMenuConditions {
  /** `haveSymbolCond` — a symbol is loaded (`m_symbol`). */
  haveSymbol: boolean;
  /** `symbolModifiedCondition` — ENABLE for `ACTIONS::revert`. */
  revert: boolean;
  /** `symbolSelectedInTreeCondition` — the target LIB_ID names a symbol. */
  targetSymbol: boolean;
}

/**
 * The whole bar, in `menuBar->Append` order
 * (`menubar_symbol_editor.cpp:184-190`): File, Edit, View, Place, Inspect,
 * Preferences, then `AddStandardHelpMenu`.
 */
export function symbolEditorMenus(
  h: SymbolMenuHandlers,
  checks: SymbolMenuChecks,
  conds: SymbolMenuConditions,
): Menu[] {
  const act = (
    label: string,
    icon: string,
    id: string,
    extra: Partial<MenuItem> = {},
  ): MenuItem => ({
    label,
    icon,
    action: () => h.action(id),
    ...extra,
  });
  const tool = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label,
    icon,
    shortcut,
    action: () => h.tool(id),
  });
  /**
   * A CHECK row, still spelling its tick into the label.
   *
   * `MenuItem.checked` exists and `MenuBar.tsx` draws it in the icon gutter;
   * these rows predate both and prepend the glyph to the text instead, which
   * makes the label jump two characters sideways as it is ticked. Left exactly
   * as it was so that this commit moves code and nothing else.
   */
  const chk = (id: string, label: string): MenuItem => ({
    label: `${checks[id] ? '✓ ' : ''}${label}`,
    action: () => h.toggle(id),
  });

  return [
    {
      label: 'File',
      items: [
        act('New Library...', 'newLibrary', 'newLibrary'),
        act('Add Library...', 'addLibrary', 'addLibrary'),
        act('New Symbol...', 'newSymbol', 'newSymbol', {
          shortcut: browserSafeKey('Ctrl+N'),
        }),
        SEP,
        act('Save', 'save', 'save', { shortcut: 'Ctrl+S' }),
        { label: 'Save All', action: () => h.action('saveAll') },
        act('Revert', 'revert', 'revert', { disabled: !conds.revert }),
        SEP,
        act('Import Symbol...', 'importSymbol', 'importSymbol'),
        act('Export Symbol...', 'exportSymbol', 'exportSymbol', {
          disabled: !conds.targetSymbol,
        }),
        SEP,
        act('Symbol Properties...', 'symbolProperties', 'symbolProperties', {
          disabled: !conds.haveSymbol,
        }),
        SEP,
        addClose('Library Editor', () => h.action('close')),
      ],
    },
    {
      label: 'Edit',
      items: [
        act('Undo', 'undo', 'undo', { shortcut: 'Ctrl+Z' }),
        act('Redo', 'redo', 'redo', { shortcut: 'Ctrl+Y' }),
        SEP,
        act('Delete', 'delete', 'doDelete', { shortcut: 'Delete' }),
        SEP,
        act('Pin Table...', 'pinTable', 'pinTable', { disabled: !conds.haveSymbol }),
      ],
    },
    {
      label: 'View',
      items: [
        act('Zoom In', 'zoomIn', 'zoomInCenter'),
        act('Zoom Out', 'zoomOut', 'zoomOutCenter'),
        act('Zoom to Fit', 'zoomFit', 'zoomFitScreen'),
        SEP,
        chk('showHiddenPins', 'Show Hidden Pins'),
        chk('showHiddenFields', 'Show Hidden Fields'),
        chk('showElectricalTypes', 'Show Pin Electrical Types'),
        SEP,
        chk('showLibraryTree', 'Library Tree'),
        chk('showProperties', 'Properties Manager'),
      ],
    },
    {
      label: 'Place',
      items: [
        tool('Pin', 'placePin', 'placePin', 'P'),
        tool('Text', 'placeText', 'placeText', 'T'),
        tool('Rectangle', 'rectangle', 'drawRectangle'),
        tool('Circle', 'circle', 'drawCircle'),
        tool('Arc', 'arc', 'drawArc'),
        tool('Lines', 'lines', 'drawLines'),
        tool('Polygon', 'polygon', 'drawPolygon'),
      ],
    },
    {
      label: 'Inspect',
      items: [
        act('Show Datasheet', 'showDatasheet', 'showDatasheet', { disabled: !conds.haveSymbol }),
        SEP,
        act('Symbol Checker...', 'checkSymbol', 'checkSymbol', { disabled: !conds.haveSymbol }),
      ],
    },
    {
      label: 'Preferences',
      items: [{ label: 'Preferences...', disabled: true }],
    },
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
