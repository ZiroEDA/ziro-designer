// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The key-name half of `common/hotkeys_basic.cpp` — `KeyNameFromKeyCode` /
 * `KeyCodeFromKeyName` for a browser `KeyboardEvent`: a combo string
 * ("Ctrl+Shift+H") from an event and back, and the two combos the browser
 * keeps for itself. The per-frame registries stay with the frames.
 */
import { NAMED_KEYS } from './tool/action_menu_hotkeys.js';

/** The parts of a KeyboardEvent the editor's handler reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
  target: EventTarget | null;
}

/**
 * Named keys as the registry spells them, keyed by `KeyboardEvent.key`.
 *
 * The right-hand side is KiCad's own spelling — `hotkeyNameList`
 * (common/hotkeys_basic.cpp:65-141) — so a row here exists for exactly one
 * reason: the DOM and KiCad disagree about the name of that key. Checked row by
 * row against that list, which is how `Ins` and `Return` were found missing.
 *
 *   hotkeys_basic.cpp   KeyboardEvent.key   row needed?
 *   Esc      :92        Escape              yes
 *   Del      :93        Delete              yes
 *   Back     :95        Backspace           yes
 *   Ins      :96        Insert              yes
 *   PgUp     :100       PageUp              yes
 *   PgDn     :101       PageDown            yes
 *   Up/Down/Left/Right  Arrow*              yes  (:103-106)
 *   Return   :108       Enter               yes
 *   Space    :110       ' '                 yes
 *   Tab      :94        Tab                 NO — identical
 *   Home     :98        Home                NO — identical
 *   End      :99        End                 NO — identical
 *
 * The three marked NO are deliberately absent: `comboFromEvent` passes any
 * multi-character key through unchanged, so an identity row would be dead
 * weight. Do not "complete" the table by adding them.
 *
 * The `Num Pad *` family (:112-131) has no row because nothing binds one yet;
 * `ui/key_names.ts` is where those spellings are written down.
 */
const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Escape: 'Esc',
  Delete: 'Del',
  // `{ wxT( "Ins" ), WXK_INSERT }` — hotkeys_basic.cpp:96. Missing until Repeat
  // Last Item was moved onto its platform default, at which point the registry
  // held a combo the parser could not rebuild: `eventFromCombo('Ins')` came
  // back as `Insert`, so the row could never be rebound to or cleared.
  Insert: 'Ins',
  Backspace: 'Back',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  /**
   * `{ wxT( "Return" ), WXK_RETURN }` — hotkeys_basic.cpp:108.
   *
   * Found by checking the whole table rather than only the row that broke.
   * Nothing in the schematic registry binds Return today, so unlike `Ins` this
   * one is not yet visibly wrong — but `comboFromEvent` is also what the
   * rebind capture reads (`dialogs/prefs/panels/PanelHotkeysEditor.tsx`), so a
   * user pressing Enter to rebind a command was already being recorded as
   * `Enter`, a spelling no registry row can ever equal.
   */
  Enter: 'Return',
};
/** The inverse, for turning a registry combo back into an event key. */
const EVENT_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(KEY_NAMES).map(([k, v]) => [v, k]),
);

/**
 * The registry's spelling of an event: `Ctrl+Shift+S`, `Alt+3`, `R`, `Esc`.
 *
 * Ctrl and Cmd collapse to `Ctrl`, as the menus do — the editor treats them
 * interchangeably throughout, so a Mac user's Cmd+S must match `Ctrl+S`.
 * A single letter is upper-cased; Shift is only named for keys that are not
 * already distinguished by it.
 */
export function comboFromEvent(e: KeyLike): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');

  const named = KEY_NAMES[e.key];
  let key = named ?? e.key;
  if (!named && key.length === 1) key = key.toUpperCase();

  // Shift is part of the name for letters and for anything with a name of its
  // own (Tab, Home, F1 — Shift+Tab is Previous Net Item). For a punctuation key
  // the shifted character *is* the key ('?' rather than Shift+/), so naming
  // Shift as well would count it twice.
  const shiftNames = key.length > 1 || /^[A-Z0-9]$/.test(key);
  if (e.shiftKey && shiftNames) parts.push('Shift');

  parts.push(key);
  // Ctrl+Shift+X reads better than Ctrl+X+Shift; the modifier order above is
  // already Ctrl, Alt, Shift — reorder to the menus' Ctrl+Shift+Alt.
  const mods = parts.slice(0, -1);
  const order = ['Ctrl', 'Shift', 'Alt'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, parts[parts.length - 1]].join('+');
}

/** Turn a registry combo back into the event fields the handler reads. */
export function eventFromCombo(combo: string, from: KeyLike): KeyLike {
  // Peeled off the front rather than split on '+', because '+' is itself a key:
  // splitting `Ctrl++` yields ['Ctrl', '', ''] and loses it. Zoom In is Ctrl++.
  const mods = new Set<string>();
  let key = combo;
  for (;;) {
    const m = /^(Ctrl|Shift|Alt)\+(?=.)/.exec(key);
    if (!m) break;
    mods.add(m[1]!);
    key = key.slice(m[0].length);
  }
  return {
    // `EVENT_KEYS` is the registry's spelling (`Del`, `PgUp`); `NAMED_KEYS` is
    // the *menu's* (`Delete`, `Page Up`), which is a different string for the
    // same key - see `ui/key_names.ts`. A combo written either way has to build
    // the same event, so both tables are consulted.
    key:
      EVENT_KEYS[key] ??
      NAMED_KEYS[key.toLowerCase()] ??
      (key.length === 1 ? key.toLowerCase() : key),
    ctrlKey: mods.has('Ctrl'),
    metaKey: false,
    shiftKey: mods.has('Shift'),
    altKey: mods.has('Alt'),
    preventDefault: () => from.preventDefault(),
    stopPropagation: () => from.stopPropagation(),
    target: from.target,
  };
}

/**
 * Combos `WIDGET_HOTKEY_LIST` refuses to assign — "'%s' is a reserved hotkey in
 * KiCad and cannot be assigned." Upstream's list is exactly these two; they walk
 * the notebook tabs, and losing them would strand a user on one page.
 */
export const RESERVED_HOTKEYS: readonly string[] = ['Ctrl+Tab', 'Ctrl+Shift+Tab'];

export const isReservedHotkey = (combo: string): boolean =>
  RESERVED_HOTKEYS.some((r) => r.toLowerCase() === combo.toLowerCase());

/**
 * The editor whose registry a call is about.
 *
 * Defaults to the schematic because it is the only editor wired up today, and
 * because every existing caller means it. An editor being brought onto the
 * store passes its own - see ui/hotkey_apps.ts, which is the table of them.
 */
