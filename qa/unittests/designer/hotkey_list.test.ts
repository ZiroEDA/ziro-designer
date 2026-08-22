// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List's contents, counterpart `ACTIONS::listHotKeys` /
 * `DisplayHotkeyList`, which walks `ACTION_MANAGER` — every registered
 * `TOOL_ACTION` with its `FriendlyName` and `DefaultHotkey`.
 *
 * We had no registry, and the list was assembled from the **menu tree**. That
 * meant it could only ever show a binding that was also a menu item, so
 * everything the canvas binds directly — R, X, Y, M, G, E, U, V, F, O, C, D, N,
 * Tab, Escape, Space, the grid keys — was bound and completely invisible. It
 * listed 42 of roughly 65, and the ones it dropped are precisely the ones a user
 * cannot discover any other way.
 *
 * `hotkeys.ts` is the registry now. These tests hold it in step with the two
 * places that dispatch: the menu tree and the canvas's `TOOL_HOTKEYS` table.
 */
import { describe, it, expect } from 'vitest';
import {
  buildHotkeyList,
  hotkeysMissingFromList,
  menuShortcutsMissingFromList,
} from '@ziroeda/designer/src/editors/schematic/hotkey_list.js';
import { HOTKEYS, HOTKEY_SECTIONS } from '@ziroeda/designer/src/editors/schematic/hotkeys.js';
import { buildMenus, TOOL_HOTKEYS } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import type { Menu } from '@ziroeda/designer/src/ui/menu_types.js';

const handlers = new Proxy({}, { get: () => () => {} }) as Parameters<typeof buildMenus>[0];
const menus = (): Menu[] => buildMenus(handlers);
const list = () => buildHotkeyList();
const rowFor = (action: string) =>
  list()
    .flatMap((s) => s.rows)
    .find((r) => r.action === action);

describe('the sections', () => {
  it('appear in the declared order, with none empty', () => {
    const names = list().map((s) => s.name);
    expect(names).toEqual(HOTKEY_SECTIONS.filter((n) => HOTKEYS.some((h) => h.section === n)));
    for (const s of list()) expect(s.rows.length).toBeGreaterThan(0);
  });

  it('cover the keys a menu can never reach', () => {
    // The whole point of the registry. Each of these is dispatched by the canvas
    // and has no menu item, so the old menu-derived list could not show them.
    for (const [action, keys] of [
      ['Rotate Clockwise', 'R'],
      ['Mirror Vertically', 'X'],
      ['Move', 'M'],
      ['Drag', 'G'],
      ['Properties', 'E'],
      ['Edit Reference Designator', 'U'],
      ['Autoplace Fields', 'O'],
      ['Show Datasheet', 'D'],
      ['Unfold from Bus', 'C'],
      ['Next Net Item', 'Tab'],
      ['Highlight Net', '`'],
      ['Cancel', 'Esc'],
      ['Switch to Next Grid', 'N'],
    ] as const) {
      expect(rowFor(action)?.keys, action).toBe(keys);
    }
  });
});

describe('the rows', () => {
  it('carry a key unless upstream declares none', () => {
    // Not every TOOL_ACTION has a DefaultHotkey. `ACTIONS::zoomInCenter` and
    // `zoomOutCenter` (actions.cpp:769-779) declare a Name, a Scope, a
    // FriendlyName and an Icon and no key on any platform, and PANEL_HOTKEYS_
    // EDITOR still lists them -- with an empty key cell, which is how a user
    // discovers there is a command there to bind.
    const UNBOUND_UPSTREAM = new Set(['Zoom In', 'Zoom Out']);
    for (const s of list())
      for (const r of s.rows)
        if (!UNBOUND_UPSTREAM.has(r.action)) expect(r.keys, r.action).not.toBe('');
  });

  it('and the two that carry none are exactly the ones upstream leaves unbound', () => {
    // The other half: without this, emptying any row's key would pass the check
    // above by widening the exception list rather than fixing the row.
    const blank = list()
      .flatMap((s) => s.rows)
      .filter((r) => r.keys === '')
      .map((r) => r.action)
      .sort();
    expect(blank).toStrictEqual(['Zoom In', 'Zoom Out']);
  });

  it('drop the trailing ellipsis a dialog entry carries', () => {
    expect(rowFor('Paste Special')).toBeDefined();
    expect(list().flatMap((s) => s.rows.map((r) => r.action))).not.toContain('Paste Special...');
  });

  it('list more than the menu tree ever could', () => {
    // The old list had 42 rows. A regression that reverted to menu-derivation
    // would drop back to roughly that.
    expect(list().reduce((n, s) => n + s.rows.length, 0)).toBeGreaterThan(60);
  });
});

describe('the registry itself', () => {
  it('has unique ids', () => {
    const ids = HOTKEYS.map((h) => h.id);
    expect(new Set(ids).size, `duplicate id in HOTKEYS`).toBe(ids.length);
  });

  it('names an upstream action for every entry', () => {
    // The labels and keys are transcribed from these, so an entry with no
    // counterpart is one nobody can check.
    for (const h of HOTKEYS) expect(h.upstream, h.id).toMatch(/^(SCH_)?ACTIONS::/);
  });

  it('explains every key it binds twice', () => {
    // There is no such key any more: F1 used to be Zoom In at Cursor AND Repeat
    // Last Item, which was never upstream's -- on macOS repeat is F1 and zoom
    // is Ctrl++, off macOS repeat is Ins and zoom is F1, and we had taken one
    // branch for one action and the other branch for the other. Any collision
    // now is an accident, and both sides must say so.
    const byKey = new Map<string, string[]>();
    // '' is not a key, so two unbound actions are not a collision. Upstream's
    // own store never compares empty accelerators either.
    for (const h of HOTKEYS)
      if (h.keys !== '') byKey.set(h.keys, [...(byKey.get(h.keys) ?? []), h.id]);
    for (const [keys, ids] of byKey) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        const entry = HOTKEYS.find((h) => h.id === id)!;
        expect(
          entry.note,
          `${keys} is shared by ${ids.join(', ')} with no note on ${id}`,
        ).toBeTruthy();
      }
    }
  });
});

describe('the list and the dispatchers agree', () => {
  it('every single-key tool hotkey is in the registry', () => {
    // The canvas dispatches TOOL_HOTKEYS from its own table. A key there with no
    // registry entry works but is undiscoverable.
    expect(hotkeysMissingFromList(TOOL_HOTKEYS)).toEqual([]);
  });

  it('every enabled menu shortcut is in the registry', () => {
    // The other direction, which is the drift that put this file wrong to begin
    // with: a menu could advertise a key the dialog never mentioned.
    expect(menuShortcutsMissingFromList(menus())).toEqual([]);
  });

  it('both checks would notice one that drifted', () => {
    // Guard on the guards, or they pass for the wrong reason.
    expect(hotkeysMissingFromList({ '9': 'nonexistentTool' })).toEqual(['nonexistentTool']);
    const bogus: Menu[] = [
      { label: 'Fake', items: [{ label: 'Bogus Action', shortcut: 'Ctrl+Shift+Alt+Q' }] },
    ];
    expect(menuShortcutsMissingFromList(bogus)).toEqual(['Bogus Action']);
  });
});
