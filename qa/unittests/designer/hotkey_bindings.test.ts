// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * User hotkey bindings — rebinding an action and clearing one.
 *
 * Counterparts: `HOTKEY_STORE`, `WIDGET_HOTKEY_LIST` (Clear Assigned Hotkey /
 * Restore Defaults / Undo Changes), `PANEL_HOTKEYS_EDITOR`.
 *
 * The editor dispatches keys from a long `else if` chain that compares raw
 * events, so bindings are made configurable by translating the *event* before
 * the chain sees it. That makes `remapEvent` the whole mechanism, and these its
 * tests: everything a user can do to a binding has to survive that translation.
 */
import { describe, it, expect } from 'vitest';
import {
  comboFromEvent,
  effectiveBindings,
  eventFromCombo,
  remapEvent,
  type KeyLike,
} from '@ziroeda/designer/src/editors/schematic/hotkey_bindings.js';
import {
  applyHotkeyOverrides,
  buildHotkeyList,
  hotkeyConflicts,
} from '@ziroeda/designer/src/editors/schematic/hotkey_list.js';
import { HOTKEYS } from '@ziroeda/designer/src/editors/schematic/hotkeys.js';
import type { Menu } from '@ziroeda/designer/src/ui/menu_types.js';

const ev = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  preventDefault: () => {},
  stopPropagation: () => {},
  target: null,
  ...mods,
});

const combo = (e: KeyLike | null): string | null => (e ? comboFromEvent(e) : null);

describe('spelling an event', () => {
  it('matches how the registry writes each combo', () => {
    expect(comboFromEvent(ev('s', { ctrlKey: true }))).toBe('Ctrl+S');
    expect(comboFromEvent(ev('v', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+V');
    expect(comboFromEvent(ev('f', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+F');
    expect(comboFromEvent(ev('r'))).toBe('R');
    expect(comboFromEvent(ev('Escape'))).toBe('Esc');
    expect(comboFromEvent(ev(' '))).toBe('Space');
    expect(comboFromEvent(ev('Delete'))).toBe('Del');
    expect(comboFromEvent(ev('F1'))).toBe('F1');
    expect(comboFromEvent(ev('Home'))).toBe('Home');
  });

  it('reads Cmd as Ctrl', () => {
    // Every branch in the editor's chain is written `e.ctrlKey || e.metaKey`,
    // so a Mac user's Cmd+S has to spell the same combo or their bindings would
    // silently never match.
    expect(comboFromEvent(ev('s', { metaKey: true }))).toBe('Ctrl+S');
  });

  it('names Shift only where it is not already the character', () => {
    // Shift+/ produces '?'; calling that "Shift+?" would name the shift twice.
    expect(comboFromEvent(ev('?', { shiftKey: true }))).toBe('?');
    expect(comboFromEvent(ev('A', { shiftKey: true }))).toBe('Shift+A');
    expect(comboFromEvent(ev('Tab', { shiftKey: true }))).toBe('Shift+Tab');
  });

  it('round-trips every combo the registry actually binds', () => {
    // A combo the parser cannot rebuild is one the user can never rebind *to*,
    // and one whose clearing would silently do nothing.
    for (const h of HOTKEYS)
      expect(comboFromEvent(eventFromCombo(h.keys, ev('x'))), h.id).toBe(h.keys);
  });

  it("keeps '+' as a key rather than a separator", () => {
    // Zoom In is Ctrl++; splitting on '+' loses it entirely.
    const back = eventFromCombo('Ctrl++', ev('x'));
    expect(back.key).toBe('+');
    expect(back.ctrlKey).toBe(true);
    expect(comboFromEvent(back)).toBe('Ctrl++');
  });
});

describe('with nothing customised', () => {
  it('hands the event straight through, untouched', () => {
    const e = ev('s', { ctrlKey: true });
    expect(remapEvent(e, {})).toBe(e);
    expect(remapEvent(e)).toBe(e);
  });

  it('reports each action on its default', () => {
    const bindings = effectiveBindings();
    for (const h of HOTKEYS) expect(bindings.get(h.id), h.id).toBe(h.keys);
  });
});

describe('clearing a hotkey', () => {
  it('stops the key reaching the editor at all', () => {
    // WIDGET_HOTKEY_LIST's "Clear Assigned Hotkey": the action stays, the key
    // goes. Ctrl+S must now do nothing.
    expect(remapEvent(ev('s', { ctrlKey: true }), { save: null })).toBeNull();
  });

  it('leaves every other key alone', () => {
    const e = ev('o', { ctrlKey: true });
    expect(remapEvent(e, { save: null })).toBe(e);
  });

  it('would have matched without the remap', () => {
    // Guard on the guard: if the default combo did not resolve to `save` in the
    // first place, the test above would pass for the wrong reason.
    expect(HOTKEYS.find((h) => h.id === 'save')?.keys).toBe('Ctrl+S');
    expect(remapEvent(ev('s', { ctrlKey: true }), {})).not.toBeNull();
  });

  it('drops a cleared action from the list without dropping its row', () => {
    const rows = buildHotkeyList({ save: null }).flatMap((s) => s.rows);
    const save = rows.find((r) => r.id === 'save');
    expect(save?.keys).toBe('');
    expect(save?.defaultKeys).toBe('Ctrl+S');
  });
});

describe('rebinding a hotkey', () => {
  const moved = { save: 'Ctrl+Q' };

  it('makes the new key arrive spelled as the old one', () => {
    // The editor's chain still matches Ctrl+S; it never learns bindings moved.
    expect(combo(remapEvent(ev('q', { ctrlKey: true }), moved))).toBe('Ctrl+S');
  });

  it('takes the key away from where it was', () => {
    expect(remapEvent(ev('s', { ctrlKey: true }), moved)).toBeNull();
  });

  it('carries preventDefault through to the real event', () => {
    // The chain calls preventDefault on the object it was handed. If that were
    // the stand-in rather than the browser's event, Ctrl+Q would still close the
    // window underneath us.
    let stopped = false;
    const real = ev('q', { ctrlKey: true, preventDefault: () => (stopped = true) });
    remapEvent(real, moved)?.preventDefault();
    expect(stopped).toBe(true);
  });

  it('preserves the event target the typing guards read', () => {
    const target = {} as EventTarget;
    const real = ev('q', { ctrlKey: true, target });
    expect(remapEvent(real, moved)?.target).toBe(target);
  });

  it('wins over whatever held the key by default', () => {
    // Bind Save to R, which Rotate Clockwise owns. Upstream keeps both and runs
    // one; the explicit user binding is the one that runs.
    expect(combo(remapEvent(ev('r'), { save: 'R' }))).toBe('Ctrl+S');
  });

  it('is a no-op when rebound to the key it already had', () => {
    const e = ev('s', { ctrlKey: true });
    expect(remapEvent(e, { save: 'Ctrl+S' })).toBe(e);
  });

  it('restores the default once the override is removed', () => {
    // "Restore Default" deletes the entry rather than storing the default's
    // value, so a later upstream change is picked up. Ctrl+S works again, and
    // Ctrl+Q goes back to being an ordinary unbound key rather than a dropped
    // one.
    const save = ev('s', { ctrlKey: true });
    const q = ev('q', { ctrlKey: true });
    expect(remapEvent(save, moved)).toBeNull();
    expect(remapEvent(save, {})).toBe(save);
    expect(remapEvent(q, {})).toBe(q);
  });
});

describe('conflicts', () => {
  it('name the action and the section already holding the key', () => {
    const [hit] = hotkeyConflicts('Ctrl+S', 'undo');
    expect(hit?.action).toBe('Save');
    expect(hit?.section).toBe('File');
  });

  it('ignore the row being edited', () => {
    expect(hotkeyConflicts('Ctrl+S', 'save')).toEqual([]);
  });

  it('see through an override, both ways', () => {
    // Ctrl+S is free once Save has moved off it...
    expect(hotkeyConflicts('Ctrl+S', 'undo', { save: 'Ctrl+Q' })).toEqual([]);
    // ...and Ctrl+Q is taken once it has moved on to it.
    expect(hotkeyConflicts('Ctrl+Q', 'undo', { save: 'Ctrl+Q' })[0]?.action).toBe('Save');
  });

  it('never reports the empty binding as a conflict', () => {
    // Several actions can be cleared at once; that is not a collision.
    expect(hotkeyConflicts('', 'undo', { save: null, undo: null })).toEqual([]);
  });
});

describe('the menus follow the bindings', () => {
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Save', shortcut: 'Ctrl+S' },
        { label: 'Open...', shortcut: 'Ctrl+O' },
        { label: 'More', submenu: [{ label: 'Print...', shortcut: 'Ctrl+P' }] },
      ],
    },
  ];
  const shortcutOf = (out: Menu[], label: string): string | undefined =>
    [...out[0]!.items, ...(out[0]!.items[2]!.submenu ?? [])].find((i) => i.label === label)
      ?.shortcut;

  it('relabels a moved shortcut', () => {
    expect(shortcutOf(applyHotkeyOverrides(menus, { save: 'Ctrl+Q' }), 'Save')).toBe('Ctrl+Q');
  });

  it('removes a cleared one instead of showing a stale key', () => {
    expect(shortcutOf(applyHotkeyOverrides(menus, { save: null }), 'Save')).toBeUndefined();
  });

  it('reaches into submenus', () => {
    expect(shortcutOf(applyHotkeyOverrides(menus, { print: 'Ctrl+Alt+P' }), 'Print...')).toBe(
      'Ctrl+Alt+P',
    );
  });

  it('leaves untouched entries and the original tree alone', () => {
    const out = applyHotkeyOverrides(menus, { save: 'Ctrl+Q' });
    expect(shortcutOf(out, 'Open...')).toBe('Ctrl+O');
    expect(menus[0]!.items[0]!.shortcut).toBe('Ctrl+S');
  });

  it('returns the same tree when nothing is customised', () => {
    expect(applyHotkeyOverrides(menus, {})).toBe(menus);
  });
});
