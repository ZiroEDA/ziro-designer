// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List (Ctrl+F1). Counterparts: `ACTIONS::listHotKeys`,
 * `DisplayHotkeyList` (common/hotkeys_basic.cpp) and the read-only
 * `PANEL_HOTKEYS_EDITOR` it shows.
 *
 * Upstream walks every frame's ACTION_MANAGER and lists each registered
 * TOOL_ACTION with its section, name and key. `hotkeys.ts` is that registry
 * here, and this turns it into the dialog's sections and rows — the editable
 * PANEL_HOTKEYS_EDITOR as well as the read-only list, since both read the same
 * store.
 *
 * Deliberately data-only, with no React import: it is the half worth testing,
 * and the dialog that renders it is a thin consumer.
 */

import type { HotkeyOverrides } from './hotkey_bindings.js';
import type { Menu, MenuItem } from '../../ui/menu_types.js';
import { HOTKEYS, HOTKEY_SECTIONS, actionName } from './hotkeys.js';
import { acceleratorName, hotkeyListName } from '../../ui/key_names.js';

export interface HotkeyRow {
  /** `TOOL_ACTION::GetName()` - `eeschema.save` - for a row the user can rebind. */
  id: string;
  /** The menu label, without its trailing ellipsis. */
  action: string;
  /** The effective key combination, e.g. "Ctrl+S"; empty when cleared. */
  keys: string;
  /** The upstream `DefaultHotkey`, so a row can be reset or marked as changed. */
  defaultKeys: string;
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
 * The dialog's contents, from the hotkey registry, with the user's overrides
 * applied — a cleared action keeps its row and shows no key, exactly as
 * PANEL_HOTKEYS_EDITOR renders one whose binding was removed.
 *
 * This used to be assembled from the **menu tree**, which meant it could only
 * ever show a binding that was also a menu item. Everything the canvas binds
 * directly — R, X, Y, M, G, E, U, V, F, O, C, D, N, Tab, Escape, Space, the grid
 * keys — was bound and invisible: the dialog listed 42 of roughly 65, and the
 * ones it dropped are exactly the ones a user is least likely to discover on
 * their own. `hotkeys.ts` is the registry now, as `ACTION_MANAGER` is upstream's.
 */
export function buildHotkeyList(overrides: HotkeyOverrides = {}): HotkeySection[] {
  const sections: HotkeySection[] = [];
  for (const name of HOTKEY_SECTIONS) {
    const rows = HOTKEYS.filter((h) => h.section === name).map((h) => {
      const id = actionName(h.id);
      return {
        id,
        action: cleanLabel(h.label),
        keys: (Object.hasOwn(overrides, id) ? overrides[id] : h.keys) ?? '',
        defaultKeys: h.keys,
      };
    });
    if (rows.length > 0) sections.push({ name, rows });
  }
  return sections;
}

/**
 * Actions already answering to `keys`, ignoring `exceptId`.
 *
 * HOTKEY_STORE refuses a binding that would collide, and names what holds it;
 * "already taken" is the one thing a user cannot see for themselves while typing
 * a combo into a row.
 */
export function hotkeyConflicts(
  keys: string,
  exceptId: string,
  overrides: HotkeyOverrides = {},
): { action: string; section: string }[] {
  if (keys === '') return [];
  const want = keys.toLowerCase();
  return HOTKEYS.filter((h) => actionName(h.id) !== exceptId)
    .filter((h) => {
      const id = actionName(h.id);
      return ((Object.hasOwn(overrides, id) ? overrides[id] : h.keys) ?? '').toLowerCase() === want;
    })
    .map((h) => ({ action: cleanLabel(h.label), section: h.section }));
}

/**
 * Tool hotkeys the registry does not list.
 *
 * The canvas dispatches single-key tool hotkeys from `TOOL_HOTKEYS`, so a key
 * there with no registry entry is undiscoverable: it works, and the dialog that
 * claims to list every hotkey never mentions it. Returns the offending tool ids
 * so a test can hold the two in step.
 */
export function hotkeysMissingFromList(toolHotkeys: Readonly<Record<string, string>>): string[] {
  const listed = new Set(HOTKEYS.map((h) => h.keys.toLowerCase()));
  return Object.entries(toolHotkeys)
    .filter(([key]) => !listed.has(key.toLowerCase()))
    .map(([, tool]) => tool);
}

/**
 * Relabel every menu shortcut with the user's binding for that action.
 *
 * Upstream never has to do this: a menu entry built by `ACTION_MENU::Add` reads
 * its key straight off the `TOOL_ACTION`, so rebinding one changes the menu with
 * it. Our menus carry the combo as literal text, and a File menu still promising
 * Ctrl+S after Save was moved to Ctrl+Q is worse than no shortcut at all — the
 * one place a user looks to check what a key does would be lying.
 *
 * An entry is matched to the registry by its *default* combo, not its label:
 * menu labels are written for the menu ("Place No Connect Flags") and only
 * mostly coincide with a `FriendlyName` ("Place/Remove No Connect Flags"). Where
 * two actions share a default — F1 is Zoom In at Cursor and Repeat Last Item —
 * the label breaks the tie, and an unmatched entry is left exactly as it was.
 */
export function applyHotkeyOverrides(menus: readonly Menu[], overrides: HotkeyOverrides): Menu[] {
  if (Object.keys(overrides).length === 0) return menus as Menu[];

  const effective = (id: string, def: string): string =>
    (Object.hasOwn(overrides, id) ? overrides[id] : def) ?? '';

  const rewrite = (item: MenuItem): MenuItem => {
    const sub = item.submenu ?? item.items;
    const kids = sub ? sub.map(rewrite) : undefined;
    const next: MenuItem = kids
      ? { ...item, ...(item.submenu ? { submenu: kids } : { items: kids }) }
      : { ...item };

    if (!item.shortcut) return next;
    // The row prints its menu accelerator (`Delete`); the registry is keyed on
    // the Hotkey List's spelling of the same key (`Del`). See `ui/key_names.ts`.
    const want = hotkeyListName(item.shortcut).toLowerCase();
    const cands = HOTKEYS.filter((h) => h.keys.toLowerCase() === want);
    const hit =
      cands.length === 1
        ? cands[0]
        : cands.find(
            (h) => cleanLabel(h.label).toLowerCase() === cleanLabel(item.label ?? '').toLowerCase(),
          );
    if (!hit) return next;

    const keys = effective(actionName(hit.id), hit.keys);
    // A cleared action loses the shortcut text entirely, as an unbound
    // ACTION_MENU entry has none.
    if (keys === '') delete next.shortcut;
    // Back into the menu's spelling: the registry stores `Del` and the row has
    // to keep drawing `Delete`, or opening the hotkey editor would silently
    // rename the key in every menu it touched.
    else next.shortcut = acceleratorName(keys);
    return next;
  };

  return menus.map((m) => ({ ...m, items: m.items.map(rewrite) }));
}

/**
 * Menu shortcuts with no registry entry — the drift that put this file wrong in
 * the first place, now checkable in the other direction too.
 */
export function menuShortcutsMissingFromList(menus: readonly Menu[]): string[] {
  const listed = new Set(HOTKEYS.map((h) => h.keys.toLowerCase()));
  const out: string[] = [];
  for (const menu of menus) {
    for (const item of flatten(menu.items)) {
      if (!item.label || !item.shortcut || item.disabled) continue;
      if (!listed.has(hotkeyListName(item.shortcut).toLowerCase()))
        out.push(cleanLabel(item.label));
    }
  }
  return out;
}
