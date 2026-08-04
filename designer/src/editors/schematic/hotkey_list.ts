// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List (Ctrl+F1). Counterparts: `ACTIONS::listHotKeys`,
 * `DisplayHotkeyList` (common/hotkeys_basic.cpp) and the read-only
 * `PANEL_HOTKEYS_EDITOR` it shows.
 *
 * Upstream walks every frame's ACTION_MANAGER and lists each registered
 * TOOL_ACTION with its section, name and key. We have no cross-frame action
 * registry — the menus *are* the registry here — so the list is assembled from
 * the menu tree, grouped by the top-level menu an entry sits under. That gives
 * the same thing a user wants from the dialog (what does each key do, grouped
 * sensibly) from the one place that already knows both halves.
 *
 * Deliberately data-only, with no React import: it is the half worth testing,
 * and the dialog that renders it is a thin consumer.
 */

import type { Menu, MenuItem } from '../../ui/menu_types.js';

export interface HotkeyRow {
  /** The menu label, without its trailing ellipsis. */
  action: string;
  /** The key combination as the menu spells it, e.g. "Ctrl+S". */
  keys: string;
}

export interface HotkeySection {
  /** The top-level menu the entries came from. */
  name: string;
  rows: HotkeyRow[];
}

/** Menu labels carry a trailing "..." for dialogs; the hotkey list drops it. */
const cleanLabel = (label: string): string => label.replace(/\.\.\.$/, '').trim();

/** Every item in a menu tree, submenus included, in display order. */
function flatten(items: readonly MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    out.push(it);
    const sub = it.submenu ?? it.items;
    if (sub) out.push(...flatten(sub));
  }
  return out;
}

/**
 * The dialog's contents: one section per top-level menu, holding every entry
 * that has a shortcut.
 *
 * A disabled entry is skipped. Upstream lists actions rather than menu items so
 * the question does not arise there, but here a greyed-out row would advertise
 * a key that does nothing — the opposite of what the dialog is for.
 *
 * Sections with no shortcuts at all are dropped rather than shown empty.
 */
export function buildHotkeyList(menus: readonly Menu[]): HotkeySection[] {
  const sections: HotkeySection[] = [];
  for (const menu of menus) {
    const rows: HotkeyRow[] = [];
    for (const item of flatten(menu.items)) {
      if (!item.label || !item.shortcut || item.disabled) continue;
      rows.push({ action: cleanLabel(item.label), keys: item.shortcut });
    }
    if (rows.length > 0) sections.push({ name: menu.label, rows });
  }
  return sections;
}

/**
 * Keys bound to something that never reaches the list.
 *
 * The canvas dispatches single-key tool hotkeys from its own table, so a key
 * there whose tool has no menu entry would be undiscoverable: it works, and the
 * dialog claiming to list every hotkey never mentions it. Returns the offending
 * tool ids so a test can assert the two stay in step.
 */
export function hotkeysMissingFromList(
  menus: readonly Menu[],
  toolHotkeys: Readonly<Record<string, string>>,
): string[] {
  const listed = new Set(
    buildHotkeyList(menus).flatMap((s) => s.rows.map((r) => r.keys.toLowerCase())),
  );
  return Object.entries(toolHotkeys)
    .filter(([key]) => !listed.has(key.toLowerCase()))
    .map(([, tool]) => tool);
}
