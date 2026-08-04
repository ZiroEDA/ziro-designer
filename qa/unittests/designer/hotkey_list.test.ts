// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List's contents, counterpart ACTIONS::listHotKeys / DisplayHotkeyList.
 */
import { describe, it, expect } from 'vitest';
import {
  buildHotkeyList,
  hotkeysMissingFromList,
} from '@ziroeda/designer/src/editors/schematic/hotkey_list.js';
import { buildMenus, TOOL_HOTKEYS } from '@ziroeda/designer/src/editors/schematic/menubar.js';
import type { Menu } from '@ziroeda/designer/src/ui/menu_types.js';

const handlers = new Proxy({}, { get: () => () => {} }) as Parameters<typeof buildMenus>[0];
const menus = (): Menu[] => buildMenus(handlers);
const list = () => buildHotkeyList(menus());

describe('the sections', () => {
  it('are the top-level menus that actually have hotkeys', () => {
    const names = list().map((s) => s.name);
    expect(names).toContain('File');
    expect(names).toContain('Edit');
    expect(names).toContain('Place');
    // Order follows the menubar, so the dialog reads like the menus do.
    expect(names).toEqual(
      menus()
        .map((m) => m.label)
        .filter((n) => names.includes(n)),
    );
  });

  it('never contains an empty section', () => {
    for (const s of list()) expect(s.rows.length).toBeGreaterThan(0);
  });
});

describe('the rows', () => {
  const rowFor = (action: string) =>
    list()
      .flatMap((s) => s.rows)
      .find((r) => r.action === action);

  it('carry the key a menu advertises', () => {
    expect(rowFor('Save')?.keys).toBe('Ctrl+S');
    expect(rowFor('Copy')?.keys).toBe('Ctrl+C');
    expect(rowFor('Place Symbols')?.keys).toBe('A');
  });

  it('drop the trailing ellipsis a dialog entry carries', () => {
    // The menu says "Paste Special...", the hotkey list says "Paste Special".
    expect(rowFor('Paste Special')).toBeDefined();
    expect(
      list()
        .flatMap((s) => s.rows)
        .some((r) => r.action.endsWith('...')),
    ).toBe(false);
  });

  it('omit entries with no shortcut', () => {
    // "Plot..." has no key; it must not appear with an empty one.
    expect(rowFor('Plot')).toBeUndefined();
    for (const s of list()) for (const r of s.rows) expect(r.keys).not.toBe('');
  });

  it('omit greyed-out entries, which would advertise a dead key', () => {
    // "Graphics..." (Import) is disabled and carries Ctrl+Shift+F. Listing it
    // would promise a key that does nothing.
    expect(rowFor('Graphics')).toBeUndefined();
    const keys = list().flatMap((s) => s.rows.map((r) => r.keys));
    expect(keys).not.toContain('Ctrl+Shift+F');
  });
});

describe('the list and the canvas agree', () => {
  it('every single-key tool hotkey appears in the list', () => {
    // The canvas dispatches TOOL_HOTKEYS from its own table. A key there with
    // no menu entry works but is undiscoverable — the dialog claims to list
    // every hotkey and would not mention it.
    expect(hotkeysMissingFromList(menus(), TOOL_HOTKEYS)).toEqual([]);
  });

  it('the check would notice one that drifted', () => {
    // Guard on the guard: a bogus binding must be reported, or the assertion
    // above passes for the wrong reason.
    expect(hotkeysMissingFromList(menus(), { '9': 'nonexistentTool' })).toEqual([
      'nonexistentTool',
    ]);
  });
});
