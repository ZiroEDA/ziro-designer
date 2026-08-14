// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The menu *data* types, split out of `MenuBar.tsx` so the modules that build
 * menus can be reached from the test suite.
 *
 * `qa`'s tsconfig compiles `.ts` only. Every menubar and toolbar data module
 * imported `Menu` / `MenuItem` from `MenuBar.tsx`, which made the whole of the
 * menu inventory — every editor's entries, their ids, their shortcuts and their
 * enabled state — untestable by construction, however pure the module itself
 * was. Nothing about these two interfaces needs React; only the component that
 * renders them does.
 *
 * `MenuBar.tsx` re-exports both, so existing importers are unaffected.
 */

export interface MenuItem {
  label?: string;
  /** Tool/action id, its KiCad icon is shown if one is mapped. */
  icon?: string;
  action?: () => void;
  sep?: boolean;
  disabled?: boolean;
  /** Keyboard hint shown right-aligned (e.g. "Ctrl+S"). A single-character
   *  hint is also live while a ContextMenu is open, the way wx treats the
   *  `\tA` half of an ACTION_MENU label. */
  shortcut?: string;
  /** The character wx underlines — what the `&` marks in a KiCad menu string
   *  ("Select &All"). The first occurrence in the label is underlined. */
  mnemonic?: string;
  /**
   * Pointer entering or leaving the row (`TA_CHOICE_MENU_UPDATE`).
   *
   * KiCad's selection menu uses this to brighten the item a row refers to
   * while you point at it, which is the only way to tell three stacked pours
   * apart — their descriptions differ by a layer name, but the board is what
   * you are actually looking at.
   */
  onHover?: (over: boolean) => void;
  /** ACTION_MENU::CHECK items, shows a checkmark when true. */
  checked?: boolean;
  /** Nested items rendered as a flyout submenu (KiCad ACTION_MENU submenus:
   *  Import, Export, Attributes, Open Recent…). `items` and `submenu` are
   *  accepted interchangeably so callers from either editor keep working. */
  submenu?: MenuItem[];
  items?: MenuItem[];
}

export interface Menu {
  label: string;
  items: MenuItem[];
}
