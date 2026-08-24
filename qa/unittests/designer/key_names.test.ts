// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One keystroke, two names, and the fact that they must stay two.
 *
 * A menu row's accelerator is drawn by GTK: `ACTION_MENU::updateHotKeys`
 * (`common/tool/action_menu.cpp:382-383`) attaches a `wxAcceleratorEntry` and
 * writes no text, so what reaches the screen is
 * `gtk_accelerator_get_label( keyval, mods )` - `Delete`. The Hotkey List is
 * KiCad's own: `KeyNameFromKeyCode` walks `hotkeyNameList`, where
 * `{ wxT( "Del" ), WXK_DELETE }` sits at `common/hotkeys_basic.cpp:93` - `Del`.
 *
 * Both were measured in pl_editor 10.0.5. Its Edit menu prints `Delete` beside
 * Delete; Preferences > Hotkeys > Common > Delete prints `Del`.
 *
 * `MenuItem.shortcut` used to feed both, so it could not be right in both, and
 * these tests exist so that a later sweep "unifying" the two spellings fails
 * rather than quietly picking one. Every divergent key is pinned on **both**
 * sides.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DIVERGENT_KEY_NAMES,
  acceleratorKey,
  acceleratorName,
  hotkeyListKey,
  hotkeyListName,
} from '@ziroeda/designer/src/ui/key_names.js';
import { buildHotkeySections, menuHotkeyName } from '@ziroeda/designer/src/ui/hotkeys_inventory.js';
import { HOTKEYS } from '@ziroeda/designer/src/editors/schematic/hotkeys.js';
import { APP_ORDER, APP_REGISTRIES } from '@ziroeda/designer/src/ui/hotkey_apps.js';
import {
  dispatchMenuHotkey,
  parseAccelerator,
  matchesAccelerator,
  type HotkeyEvent,
} from '@ziroeda/designer/src/ui/menu_hotkeys.js';
import { applyHotkeyOverrides } from '@ziroeda/designer/src/editors/schematic/hotkey_list.js';
import type { Menu, MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

/**
 * The whole divergent set, transcribed here a second time on purpose.
 *
 * The module exports the table the app runs on; this is the independent copy a
 * test needs in order to notice a row being edited *or* deleted. Left is what
 * the menu draws (`gtk_accelerator_get_label`, read out of the installed GTK
 * 3.24.41 for each keyval in `hotkeyNameList`); right is `hotkeyNameList`
 * itself.
 */
const EXPECTED: readonly (readonly [string, string])[] = [
  ['Escape', 'Esc'], // hotkeys_basic.cpp:92
  ['Delete', 'Del'], // :93   - both halves measured in the running app
  ['BackSpace', 'Back'], // :95
  ['Insert', 'Ins'], // :96
  ['Page Up', 'PgUp'], // :100
  ['Page Down', 'PgDn'], // :101
  ['KP 0', 'Num Pad 0'], // :113
  ['KP 1', 'Num Pad 1'],
  ['KP 2', 'Num Pad 2'],
  ['KP 3', 'Num Pad 3'],
  ['KP 4', 'Num Pad 4'],
  ['KP 5', 'Num Pad 5'],
  ['KP 6', 'Num Pad 6'],
  ['KP 7', 'Num Pad 7'],
  ['KP 8', 'Num Pad 8'],
  ['KP 9', 'Num Pad 9'],
  ['KP +', 'Num Pad +'],
  ['KP -', 'Num Pad -'],
  ['KP *', 'Num Pad *'],
  ['KP /', 'Num Pad /'],
  ['KP ,', 'Num Pad .'], // KP_Separator: GTK labels it `,`, KiCad calls it `.`
  ['KP Enter', 'Num Pad Enter'],
  ['KP F1', 'Num Pad F1'],
  ['KP F2', 'Num Pad F2'],
  ['KP F3', 'Num Pad F3'],
  ['KP F4', 'Num Pad F4'],
];

describe('the table of keys the two paths spell differently', () => {
  it('is exactly the set measured against KiCad 10.0.5 and GTK 3.24.41', () => {
    expect(DIVERGENT_KEY_NAMES.map(([a, b]) => `${a}|${b}`)).toEqual(
      EXPECTED.map(([a, b]) => `${a}|${b}`),
    );
  });

  it('never lists a key whose two names are the same', () => {
    // A row where both halves agree would be a transcription error, and would
    // also make every assertion below vacuous for that key.
    for (const [accel, list] of DIVERGENT_KEY_NAMES) expect(accel, list).not.toBe(list);
  });

  it.each(EXPECTED)('%s in a menu is %s in the Hotkey List', (accel, list) => {
    expect(hotkeyListKey(accel)).toBe(list);
    expect(hotkeyListName(accel)).toBe(list);
  });

  it.each(EXPECTED)('%s in a menu is what %s in the Hotkey List came from', (accel, list) => {
    expect(acceleratorKey(list)).toBe(accel);
    expect(acceleratorName(list)).toBe(accel);
  });

  it.each(EXPECTED)('round-trips %s through both directions', (accel, _list) => {
    expect(acceleratorName(hotkeyListName(accel))).toBe(accel);
  });

  it('does not care which case a call site wrote the key in', () => {
    expect(hotkeyListName('DELETE')).toBe('Del');
    expect(hotkeyListName('page up')).toBe('PgUp');
    expect(acceleratorName('del')).toBe('Delete');
  });
});

describe('every other key is spelled the same by both, and is left alone', () => {
  // `hotkeyNameList` and gtk_accelerator_get_label agree about all of these -
  // the GTK side probed, the KiCad side read off hotkeys_basic.cpp:66-141.
  const SAME = [
    'Tab',
    'Home',
    'End',
    'Up',
    'Down',
    'Left',
    'Right',
    'Return',
    'Space',
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
    'A',
    'Z',
    '0',
    '9',
    '+',
    '-',
    ',',
    '`',
    '~',
  ];

  it.each(SAME)('%s survives untouched in both directions', (key) => {
    expect(hotkeyListName(key)).toBe(key);
    expect(acceleratorName(key)).toBe(key);
  });

  it('leaves a gesture hint and a bare modifier alone', () => {
    // The Hotkey List's PSEUDO_ACTION rows. Nothing in them is a named key.
    for (const hint of ['Ctrl+Click', 'Shift+Wheel', 'Double-click', 'Ctrl', 'Shift']) {
      expect(hotkeyListName(hint)).toBe(hint);
    }
  });
});

describe('the modifier half', () => {
  it('is carried through, key and all', () => {
    expect(hotkeyListName('Alt+BackSpace')).toBe('Alt+Back');
    expect(hotkeyListName('Ctrl+Shift+Delete')).toBe('Ctrl+Shift+Del');
    expect(acceleratorName('Alt+Back')).toBe('Alt+BackSpace');
  });

  it('survives `+` being a key in its own right', () => {
    // Zoom In. A `split('+')` yields ['Ctrl', '', ''] and loses the key.
    expect(hotkeyListName('Ctrl++')).toBe('Ctrl++');
    expect(acceleratorName('Ctrl++')).toBe('Ctrl++');
  });

  it('is not reordered, because a third convention is already in the file format', () => {
    // GTK draws `Shift+Ctrl+S` and KeyNameFromKeyCode would write
    // `Ctrl+Shift+S`; `comboFromEvent` writes a user's overrides in a third
    // order again. Reordering here would spell a default row and a rebound row
    // differently in one column, so this function deliberately does not.
    expect(hotkeyListName('Shift+Ctrl+S')).toBe('Shift+Ctrl+S');
    expect(hotkeyListName('Ctrl+Shift+A')).toBe('Ctrl+Shift+A');
  });

  it('is empty when there is none', () => {
    expect(hotkeyListName(undefined)).toBe('');
    expect(hotkeyListName('')).toBe('');
    expect(acceleratorName(undefined)).toBe('');
  });
});

/**
 * The rows that actually carry a divergent key, pinned on both sides.
 *
 * `src` is scraped rather than imported because four of the five frames are
 * `.tsx` and `qa`'s tsconfig compiles `.ts` only.
 */
const SRC = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

describe('the menu rows print the accelerator, character for character', () => {
  const DELETE_ROWS = [
    // The Symbol Editor's row lives in its menubar module, like the
    // schematic's below: the frame used to carry a second `e.key === 'Delete'`
    // binding beside the row, and `menu_hotkey_coverage.test.ts` rejects that
    // restatement -- upstream a menu accelerator IS the binding.
    'editors/symbol/menubar.ts',
    'editors/pcb/PcbEditor.tsx',
    'editors/footprint/FootprintEditor.tsx',
    'editors/schematic/dialogs/dialog_assign_footprints.tsx',
    'editors/schematic/menubar.ts',
    // Already correct before this split, and pinned by
    // drawing_sheet_palette.test.ts as well.
    'editors/drawingsheet/DrawingSheetEditor.tsx',
  ];

  it.each(DELETE_ROWS)('%s says Delete, never Del', (rel) => {
    const src = SRC(rel);
    expect(src).toMatch(/'Delete'/);
    // The Hotkey List's spelling must not appear as a menu accelerator.
    expect(src).not.toMatch(/shortcut: 'Del'/);
    expect(src).not.toMatch(/, 'Del'\)/);
  });

  it('the schematic sheet-navigation rows say Page Up / Page Down', () => {
    const src = SRC('editors/schematic/menubar.ts');
    expect(src).toContain("'Page Up'");
    expect(src).toContain("'Page Down'");
    expect(src).not.toContain("'PgUp'");
    expect(src).not.toContain("'PgDn'");
  });

  it('Leave Sheet says Alt+BackSpace', () => {
    // SCH_ACTIONS::leaveSheet is MD_ALT + WXK_BACK (sch_actions.cpp:1421).
    const src = SRC('editors/schematic/SchematicEditor.tsx');
    expect(src).toContain("shortcut: 'Alt+BackSpace'");
    expect(src).not.toContain("shortcut: 'Alt+Backspace'");
  });

  it('the 3D viewer prints the key names, not arrow glyphs', () => {
    // EDA_3D_ACTIONS::moveLeft is WXK_LEFT; GTK labels it `Left`. A glyph is
    // neither spelling, and is not a KeyboardEvent.key either, so the row was
    // undispatchable as well as wrong.
    const src = SRC('editors/pcb/viewer3dMenus.ts');
    for (const key of ['Left', 'Right', 'Up', 'Down']) {
      expect(src).toContain(`shortcut: '${key}'`);
    }
    for (const glyph of ['←', '→', '↑', '↓']) expect(src).not.toContain(`shortcut: '${glyph}'`);
  });
});

describe('the Hotkey List prints the other name', () => {
  const rows = buildHotkeySections().flatMap((s) => s.entries);
  const keysOf = (command: string): string[] =>
    rows.filter((r) => r.command === command).map((r) => r.keys);

  it('finds the rows at all', () => {
    // A guard on the guard: an inventory that collected nothing would make
    // every `toContain` below vacuous by returning an empty array... and
    // `toContain` on [] fails, but a mistyped command name would not.
    expect(rows.length).toBeGreaterThan(100);
  });

  it('Delete is Del in the list while every menu says Delete', () => {
    const del = keysOf('Delete');
    expect(del.length).toBeGreaterThan(0);
    for (const k of del) expect(k).toBe('Del');
    // And the two halves are genuinely different strings, which is the whole
    // point: a sweep that unified them breaks exactly here.
    expect(del).not.toContain('Delete');
  });

  it('the sheet-navigation rows are PgUp / PgDn in the list', () => {
    expect(keysOf('Previous Sheet')).toContain('PgUp');
    expect(keysOf('Next Sheet')).toContain('PgDn');
  });

  it('Leave Sheet is Alt+Back in the list', () => {
    expect(keysOf('Leave Sheet')).toContain('Alt+Back');
    expect(keysOf('Leave Sheet')).not.toContain('Alt+BackSpace');
  });

  it('the 3D viewer Move Board rows are the key names', () => {
    for (const [command, key] of [
      ['Move Board Left', 'Left'],
      ['Move Board Right', 'Right'],
      ['Move Board Up', 'Up'],
      ['Move Board Down', 'Down'],
    ] as const) {
      expect(keysOf(command), command).toContain(key);
    }
  });
});

describe('the split has a per-row escape hatch that nothing needs yet', () => {
  it('falls back to the accelerator, which is why no call site had to change', () => {
    expect(menuHotkeyName({ label: 'Save', shortcut: 'Ctrl+S' })).toBe('Ctrl+S');
    expect(menuHotkeyName({ label: 'Zoom to Fit', shortcut: 'Home' })).toBe('Home');
  });

  it.each(EXPECTED)('a row printing %s is listed as %s', (accel, list) => {
    // The inventory's whole default, pressed directly. It has to be pressed
    // directly: `withRegistry` overwrites a collected row's keys with the
    // registry's, and every row in the app that carries a divergent key today
    // is claimed by one - so no row reaching the dialog exercises this.
    expect(menuHotkeyName({ label: 'x', shortcut: accel })).toBe(list);
  });

  it('a row with no accelerator is listed with an empty Hotkey cell', () => {
    expect(menuHotkeyName({ label: 'Plot...' })).toBe('');
  });

  it('is what the inventory actually collects with', () => {
    // A source assertion, and deliberately: `withRegistry` overwrites every
    // collected row whose key diverges, so collapsing the call site back to
    // `it.shortcut` changes not one of the 520 rows the dialog shows today.
    // The wiring is a guarantee about the next menu-only row, and this is the
    // only place it can be held.
    const src = SRC('ui/hotkeys_inventory.ts');
    expect(src).toContain("add(keyOf(it.icon, it.label ?? ''), it.label ?? '', menuHotkeyName(it)");
    expect(src).not.toMatch(/add\(keyOf\(it\.icon[^\n]*it\.shortcut/);
  });

  it('an explicit hotkeyName wins over the table', () => {
    expect(menuHotkeyName({ label: 'Odd', shortcut: 'Delete', hotkeyName: 'Whatever' })).toBe(
      'Whatever',
    );
  });

  it('a MenuItem still carries both fields', () => {
    // A `hotkeyName` deleted from the interface would make the escape hatch
    // above a type error rather than a silent no-op, which is the point.
    const row: MenuItem = { label: 'Delete', shortcut: 'Delete', hotkeyName: 'Del' };
    expect([row.shortcut, row.hotkeyName]).toEqual(['Delete', 'Del']);
  });
});

describe('the registries are written in the Hotkey List spelling', () => {
  // The other source of the Hotkey column. `withRegistry` overwrites a
  // collected row's keys with the registry's, so a registry written in the
  // menu's spelling would put `Delete` in a column that must say `Del` - and
  // would also stop `applyHotkeyOverrides` finding the row at all.
  const registryRows = [
    ...HOTKEYS.map((h) => [`eeschema.${h.id}`, h.keys] as const),
    // Every editor that has grown a registry, so a new one is covered the day
    // it is added rather than the day somebody remembers this test.
    ...APP_ORDER.flatMap((app) =>
      (APP_REGISTRIES[app] ?? []).map((a) => [`${app}.${a.id}`, a.keys] as const),
    ),
  ].filter(([, keys]) => keys !== '');

  it('finds the registries in the first place', () => {
    expect(registryRows.length).toBeGreaterThan(100);
  });

  it.each(registryRows)('%s: %s is already a Hotkey List name', (_id, keys) => {
    expect(hotkeyListName(keys)).toBe(keys);
  });
});

describe('dispatch accepts both spellings, so a row written either way fires', () => {
  const press = (key: string): HotkeyEvent => ({
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  });

  it.each([
    ['Delete', 'Delete'],
    ['Del', 'Delete'],
    ['Escape', 'Escape'],
    ['Esc', 'Escape'],
    ['Page Up', 'PageUp'],
    ['PgUp', 'PageUp'],
    ['Page Down', 'PageDown'],
    ['PgDn', 'PageDown'],
    ['BackSpace', 'Backspace'],
    ['Backspace', 'Backspace'],
  ])('%s matches a real %s keystroke', (shortcut, eventKey) => {
    const acc = parseAccelerator(shortcut);
    expect(acc, shortcut).not.toBeNull();
    expect(matchesAccelerator(acc!, press(eventKey))).toBe(true);
  });

  it('runs the row whichever way its accelerator was written', () => {
    for (const shortcut of ['Delete', 'Del']) {
      let ran = 0;
      const menus: Menu[] = [
        { label: 'Edit', items: [{ label: 'Delete', shortcut, action: () => ran++ }] },
      ];
      expect(dispatchMenuHotkey(menus, press('Delete'), { modalCount: 0 }), shortcut).toBe(true);
      expect(ran).toBe(1);
    }
  });
});

describe('a rebinding does not rename the key in the menus', () => {
  // `applyHotkeyOverrides` looks a row up in the registry by its accelerator
  // and writes the effective key back onto the row. The registry stores the
  // *list* spelling, so without the inverse translation opening the hotkey
  // editor would silently turn every `Delete` row into `Del`.
  const editMenu = (): Menu[] => [
    { label: 'Edit', items: [{ label: 'Delete', icon: 'delete', shortcut: 'Delete' }] },
  ];

  it('leaves an unchanged binding printing the accelerator', () => {
    // The overrides map has to be non-empty or the whole rewrite is skipped;
    // the entry is for a different action, so Delete keeps its default.
    const out = applyHotkeyOverrides(editMenu(), { 'eeschema.save': 'Ctrl+Alt+S' });
    expect(out[0]!.items[0]!.shortcut).toBe('Delete');
  });

  it('prints a rebound key in the menu spelling too', () => {
    // A user moving Delete onto Escape: the registry stores `Esc`, the menu
    // has to draw `Escape`.
    const out = applyHotkeyOverrides(editMenu(), { 'eeschema.delete': 'Esc' });
    expect(out[0]!.items[0]!.shortcut).toBe('Escape');
  });

  it('still finds the registry row through the two spellings', () => {
    // A cleared binding drops the accelerator entirely; that it changes at all
    // proves the lookup matched, which is the half that the split could break.
    const out = applyHotkeyOverrides(editMenu(), { 'eeschema.delete': null });
    expect(out[0]!.items[0]!.shortcut).toBeUndefined();
  });
});
