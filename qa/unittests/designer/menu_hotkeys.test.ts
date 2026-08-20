// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The accelerator a menu declares, and what it takes to press it.
 *
 * This is pure logic over the menu data, which is the point: the thing it
 * replaces was a per-frame `keydown` listener full of literal comparisons, and
 * every one of those was a fresh chance to write `e.key === 'Q'` and lose the
 * binding to Caps Lock, or to write `(e.ctrlKey || e.metaKey) && e.key === 'z'`
 * and have Ctrl+Shift+Z run Undo. Those two mistakes are both in the history of
 * this tree, so both have a row here.
 */
import { describe, expect, it } from 'vitest';
import {
  dispatchMenuHotkey,
  findMenuHotkey,
  focusBlocksHotkey,
  matchesAccelerator,
  parseAccelerator,
  type HotkeyEvent,
} from '@ziroeda/designer/src/ui/menu_hotkeys.js';
import type { Menu } from '@ziroeda/designer/src/ui/menu_types.js';

/** A keyboard event with nothing held down, overridden per case. */
const ev = (key: string, mods: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('reading an accelerator', () => {
  it('reads the spellings the menus actually use', () => {
    // Every shape in the tree, from
    //   grep -rn "shortcut:" designer/src | sed 's/.*shortcut: //' | sort -u
    const cases: [string, { ctrl: boolean; shift: boolean; alt: boolean; key: string }][] = [
      ['Ctrl+Q', { ctrl: true, shift: false, alt: false, key: 'Q' }],
      ['Ctrl+Shift+M', { ctrl: true, shift: true, alt: false, key: 'M' }],
      // Both orders appear in the tree; Save As is written the other way round.
      ['Shift+Ctrl+S', { ctrl: true, shift: true, alt: false, key: 'S' }],
      ['Ctrl+Alt+N', { ctrl: true, shift: false, alt: true, key: 'N' }],
      ['Alt+Backspace', { ctrl: false, shift: false, alt: true, key: 'Backspace' }],
      ['Ctrl+,', { ctrl: true, shift: false, alt: false, key: ',' }],
      ['Ctrl+F1', { ctrl: true, shift: false, alt: false, key: 'F1' }],
      ['F5', { ctrl: false, shift: false, alt: false, key: 'F5' }],
      ['Del', { ctrl: false, shift: false, alt: false, key: 'Del' }],
      ['Home', { ctrl: false, shift: false, alt: false, key: 'Home' }],
      ['Esc', { ctrl: false, shift: false, alt: false, key: 'Esc' }],
      ['E', { ctrl: false, shift: false, alt: false, key: 'E' }],
      ['↑', { ctrl: false, shift: false, alt: false, key: '↑' }],
    ];
    for (const [text, want] of cases) {
      const acc = parseAccelerator(text);
      expect(acc, text).toBeTruthy();
      expect({ ctrl: acc!.ctrl, shift: acc!.shift, alt: acc!.alt, key: acc!.key }, text).toEqual(
        want,
      );
    }
  });

  it("keeps the key when the key is '+'", () => {
    // Zoom In is `Ctrl++`. Splitting the string on '+' yields ['Ctrl','',''] and
    // loses it, which is why the modifiers are peeled off the front instead.
    expect(parseAccelerator('Ctrl++')).toMatchObject({ ctrl: true, key: '+' });
    expect(parseAccelerator('Ctrl+-')).toMatchObject({ ctrl: true, key: '-' });
  });

  it('is nothing for a gesture or an empty hint', () => {
    expect(parseAccelerator(undefined)).toBeNull();
    expect(parseAccelerator('')).toBeNull();
    // `planClaim` skips the same shapes: a mouse gesture is not a keystroke.
    expect(parseAccelerator('Ctrl+Click')).toBeNull();
    expect(parseAccelerator('Shift+Wheel')).toBeNull();
  });
});

describe('matching an event against it', () => {
  const acc = (text: string) => parseAccelerator(text)!;

  it('is case-insensitive on the key', () => {
    // `e.key` is 'Q' with Caps Lock on and 'q' without. Both are Ctrl+Q.
    expect(matchesAccelerator(acc('Ctrl+Q'), ev('q', { ctrlKey: true }))).toBe(true);
    expect(matchesAccelerator(acc('Ctrl+Q'), ev('Q', { ctrlKey: true }))).toBe(true);
  });

  it('is exact on the modifier set', () => {
    // wxAcceleratorEntry holds wxACCEL_CTRL and wxACCEL_SHIFT as separate flags
    // and matches the set, not a subset.
    expect(matchesAccelerator(acc('Ctrl+Q'), ev('q', { ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(matchesAccelerator(acc('Ctrl+Q'), ev('q', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(matchesAccelerator(acc('Ctrl+Q'), ev('q', {}))).toBe(false);
    // And the shifted binding does not fire without Shift.
    expect(matchesAccelerator(acc('Ctrl+Shift+M'), ev('m', { ctrlKey: true }))).toBe(false);
    expect(
      matchesAccelerator(acc('Ctrl+Shift+M'), ev('M', { ctrlKey: true, shiftKey: true })),
    ).toBe(true);
  });

  it('does not count Shift twice for a punctuation key', () => {
    // '+' is Shift+'=' on a US layout, so the character already carries the
    // modifier. Requiring Shift to be absent would make Ctrl++ unpressable.
    // comboFromEvent draws the line in the same place (`shiftNames`).
    expect(matchesAccelerator(acc('Ctrl++'), ev('+', { ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(matchesAccelerator(acc('Ctrl+,'), ev(',', { ctrlKey: true }))).toBe(true);
  });

  it('treats Cmd as Ctrl', () => {
    expect(matchesAccelerator(acc('Ctrl+S'), ev('s', { metaKey: true }))).toBe(true);
  });

  it('reads a named key as the event spells it', () => {
    expect(matchesAccelerator(acc('Del'), ev('Delete'))).toBe(true);
    expect(matchesAccelerator(acc('Esc'), ev('Escape'))).toBe(true);
    expect(matchesAccelerator(acc('Home'), ev('Home'))).toBe(true);
    expect(matchesAccelerator(acc('↑'), ev('ArrowUp'))).toBe(true);
    expect(matchesAccelerator(acc('Alt+Backspace'), ev('Backspace', { altKey: true }))).toBe(true);
  });

  it('tells F5 from the letter F', () => {
    expect(matchesAccelerator(acc('F5'), ev('F5'))).toBe(true);
    expect(matchesAccelerator(acc('F'), ev('F5'))).toBe(false);
    expect(matchesAccelerator(acc('F5'), ev('f'))).toBe(false);
  });
});

/** The Image Converter's File menu, as it now reads. */
const imageMenus = (calls: string[], quitDisabled = false): Menu[] => [
  {
    label: 'File',
    items: [
      { label: 'Open...', shortcut: 'Ctrl+O', action: () => calls.push('open') },
      {
        label: 'Open Recent',
        submenu: [{ label: 'logo.png', shortcut: 'Ctrl+D', action: () => calls.push('recent') }],
      },
      { sep: true },
      {
        label: 'Quit',
        shortcut: 'Ctrl+Q',
        tooltip: 'Quit Image Converter',
        disabled: quitDisabled,
        action: () => calls.push('quit'),
      },
    ],
  },
  {
    label: 'Preferences',
    items: [{ label: 'Preferences...', shortcut: 'Ctrl+,', action: () => calls.push('prefs') }],
  },
];

describe('finding the row an event belongs to', () => {
  it('presses the row whose accelerator it is', () => {
    const calls: string[] = [];
    // The report that started this work: Ctrl+Q did nothing in the Image
    // Converter, because the menu said "Close Image Converter" with no key and
    // the hand-written listener knew only Ctrl+O and Ctrl+','.
    expect(dispatchMenuHotkey(imageMenus(calls), ev('q', { ctrlKey: true }))).toBe(true);
    expect(calls).toEqual(['quit']);
  });

  it('does not press it with an extra modifier held', () => {
    const calls: string[] = [];
    expect(dispatchMenuHotkey(imageMenus(calls), ev('q', { ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(calls).toEqual([]);
  });

  it('presses it whichever case the browser reports', () => {
    const upper: string[] = [];
    const lower: string[] = [];
    dispatchMenuHotkey(imageMenus(upper), ev('Q', { ctrlKey: true }));
    dispatchMenuHotkey(imageMenus(lower), ev('q', { ctrlKey: true }));
    expect(upper).toEqual(['quit']);
    expect(lower).toEqual(['quit']);
  });

  it('leaves a disabled row alone', () => {
    // ACTION_CONDITIONS: a greyed row's accelerator does nothing. It matters
    // concretely - the project manager's Edit menu carries Cut/Copy/Paste
    // permanently disabled, and swallowing Ctrl+C would break copying.
    const calls: string[] = [];
    expect(dispatchMenuHotkey(imageMenus(calls, true), ev('q', { ctrlKey: true }))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('reaches into a submenu', () => {
    // Open Recent is a flyout, and its rows are rows.
    const calls: string[] = [];
    expect(dispatchMenuHotkey(imageMenus(calls), ev('d', { ctrlKey: true }))).toBe(true);
    expect(calls).toEqual(['recent']);
  });

  it("works for a punctuation accelerator, which Ctrl+',' is", () => {
    const calls: string[] = [];
    expect(dispatchMenuHotkey(imageMenus(calls), ev(',', { ctrlKey: true }))).toBe(true);
    expect(calls).toEqual(['prefs']);
  });

  it('returns nothing for a key no row claims', () => {
    expect(findMenuHotkey(imageMenus([]), ev('k', { ctrlKey: true }))).toBeNull();
  });
});

describe('what focus is allowed to keep', () => {
  // tool_dispatcher.cpp:654-670. The brief for this work guessed that a wx
  // accelerator fires over a focused text control for Ctrl-combinations; it
  // does not, and WX_MENUBAR (wx_menubar.h:30-58) exists to make sure of it.
  it('gives an editable text entry every key, Ctrl combinations included', () => {
    const input = { tagName: 'INPUT', type: 'text' };
    expect(focusBlocksHotkey(input, ev('s', { ctrlKey: true }))).toBe(true);
    expect(focusBlocksHotkey(input, ev('q', { ctrlKey: true }))).toBe(true);
    expect(focusBlocksHotkey(input, ev('m'))).toBe(true);
    expect(focusBlocksHotkey({ tagName: 'TEXTAREA' }, ev('s', { ctrlKey: true }))).toBe(true);
    expect(focusBlocksHotkey({ isContentEditable: true }, ev('s', { ctrlKey: true }))).toBe(true);
  });

  it('gives a read-only entry only its copy-out', () => {
    // "Even if not enabled, allow a copy out."
    const ro = { tagName: 'INPUT', type: 'text', readOnly: true };
    expect(focusBlocksHotkey(ro, ev('c', { ctrlKey: true }))).toBe(true);
    expect(focusBlocksHotkey(ro, ev('s', { ctrlKey: true }))).toBe(false);
    expect(focusBlocksHotkey(ro, ev('c', { ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('is not in the way of a checkbox or the canvas', () => {
    expect(focusBlocksHotkey({ tagName: 'INPUT', type: 'checkbox' }, ev('s'))).toBe(false);
    expect(focusBlocksHotkey({ tagName: 'CANVAS' }, ev('s'))).toBe(false);
    expect(focusBlocksHotkey(null, ev('s'))).toBe(false);
  });

  it('stops the frame acting while the user types in it', () => {
    const calls: string[] = [];
    const typed = dispatchMenuHotkey(imageMenus(calls), ev('o', { ctrlKey: true }), {
      target: { tagName: 'INPUT', type: 'text' },
    });
    expect(typed).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('what an open dialog does to the frame beneath it', () => {
  it('silences it, as a wx modal event loop does', () => {
    const calls: string[] = [];
    expect(
      dispatchMenuHotkey(imageMenus(calls), ev('o', { ctrlKey: true }), { modalCount: 1 }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does not silence a frame that is itself the dialog', () => {
    // CVPCB. Its own registration on the modal stack must not stop its own
    // menubar working; a dialog it opens in turn still must.
    const calls: string[] = [];
    expect(
      dispatchMenuHotkey(imageMenus(calls), ev('o', { ctrlKey: true }), {
        modalCount: 1,
        modalFloor: 1,
      }),
    ).toBe(true);
    expect(
      dispatchMenuHotkey(imageMenus([]), ev('o', { ctrlKey: true }), {
        modalCount: 2,
        modalFloor: 1,
      }),
    ).toBe(false);
    expect(calls).toEqual(['open']);
  });
});
