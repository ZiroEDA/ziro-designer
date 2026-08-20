// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two ways KiCad spells one keystroke, and how to get from the first to the
 * second.
 *
 * A named key reaches the user through two different pieces of code upstream,
 * and they do not agree:
 *
 *   **The menu accelerator.** `ACTION_MENU::updateHotKeys`
 *   (`common/tool/action_menu.cpp:355-388`) attaches the key to the row and
 *   nothing more - `wxAcceleratorEntry accel( flags, key, id, item );
 *   item->SetAccel( &accel );` - so KiCad never writes that text. wxGTK hands
 *   the keyval and modifier mask to `gtk_widget_add_accelerator`, and the
 *   string in the right-hand column is whatever `gtk_accelerator_get_label`
 *   makes of them. On GTK 3.24 that is `Delete`, `Escape`, `Page Up`.
 *
 *   **The Hotkey List.** `KeyNameFromKeyCode` (`common/hotkeys_basic.cpp:169`)
 *   walks `hotkeyNameList` (`:66-141`), KiCad's own table, and that table says
 *   `{ wxT( "Del" ), WXK_DELETE }` at `:93`. The same function builds the
 *   toolbar tooltips, so a toolbar's parenthetical agrees with the list, not
 *   with the menu.
 *
 * Measured in the running application: pl_editor 10.0.5's Edit menu prints
 * `Delete` beside Delete, and Preferences > Hotkeys > Common > Delete prints
 * `Del`. Its File menu prints `Shift+Ctrl+S` for Save As while the list would
 * print `Ctrl+Shift+S`, which is the second half of the same divergence.
 *
 * The GTK side of the table below was read out of the installed GTK
 * (3.24.41) by calling `gtk_accelerator_get_label` for each keyval in
 * `hotkeyNameList`, rather than guessed: `Delete` and `Home` from that probe
 * match the two screenshots exactly.
 *
 * Everything else agrees. `Tab`, `Home`, `End`, `Up`, `Down`, `Left`, `Right`,
 * `Return`, `Space`, `F1`-`F24` and every printable character are spelled the
 * same by both, which is why {@link hotkeyListName} is an identity for all but
 * the handful of keys named here.
 */

/**
 * Menu accelerator spelling -> Hotkey List spelling, for the keys where the two
 * paths disagree. Keyed lower-case, because a call site may have written the
 * key in either case and neither path is case-sensitive about it.
 *
 * Read as: left is `gtk_accelerator_get_label( keyval, 0 )`, right is the
 * `hotkeyNameList` entry for the `WXK_` code that keyval comes from.
 *
 * The numeric keypad is in here for completeness - no row in this app binds one
 * yet - because leaving it out is how the next person concludes Delete is
 * special.
 */
const HOTKEY_LIST_NAMES: Readonly<Record<string, string>> = {
  // hotkeys_basic.cpp:92-96
  escape: 'Esc',
  delete: 'Del',
  backspace: 'Back',
  insert: 'Ins',
  // hotkeys_basic.cpp:100-101. GTK spells these with a space; KiCad abbreviates.
  'page up': 'PgUp',
  'page down': 'PgDn',
  // hotkeys_basic.cpp:113-132. GTK's prefix is `KP `, KiCad's is `Num Pad `,
  // and the separator differs in the key itself as well as the prefix: X11
  // calls it KP_Separator and GTK labels it `,`, while KiCad calls it `.`.
  'kp 0': 'Num Pad 0',
  'kp 1': 'Num Pad 1',
  'kp 2': 'Num Pad 2',
  'kp 3': 'Num Pad 3',
  'kp 4': 'Num Pad 4',
  'kp 5': 'Num Pad 5',
  'kp 6': 'Num Pad 6',
  'kp 7': 'Num Pad 7',
  'kp 8': 'Num Pad 8',
  'kp 9': 'Num Pad 9',
  'kp +': 'Num Pad +',
  'kp -': 'Num Pad -',
  'kp *': 'Num Pad *',
  'kp /': 'Num Pad /',
  'kp ,': 'Num Pad .',
  'kp enter': 'Num Pad Enter',
  'kp f1': 'Num Pad F1',
  'kp f2': 'Num Pad F2',
  'kp f3': 'Num Pad F3',
  'kp f4': 'Num Pad F4',
};

/**
 * The keys where the two paths disagree, as pairs, for anything that wants to
 * assert on the split rather than perform it.
 */
export const DIVERGENT_KEY_NAMES: readonly (readonly [accelerator: string, hotkeyList: string])[] =
  [
    ['Escape', 'Esc'],
    ['Delete', 'Del'],
    ['BackSpace', 'Back'],
    ['Insert', 'Ins'],
    ['Page Up', 'PgUp'],
    ['Page Down', 'PgDn'],
    ['KP 0', 'Num Pad 0'],
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
    ['KP ,', 'Num Pad .'],
    ['KP Enter', 'Num Pad Enter'],
    ['KP F1', 'Num Pad F1'],
    ['KP F2', 'Num Pad F2'],
    ['KP F3', 'Num Pad F3'],
    ['KP F4', 'Num Pad F4'],
  ];

/**
 * The key half of an accelerator, as the Hotkey List spells it.
 *
 * An unlisted key is returned unchanged, which is the common case - the two
 * tables agree about everything but the keys above.
 */
export function hotkeyListKey(key: string): string {
  return HOTKEY_LIST_NAMES[key.trim().toLowerCase()] ?? key;
}

/**
 * A whole accelerator, as the Hotkey List spells it: `Del` for `Delete`,
 * `Alt+Back` for `Alt+BackSpace`.
 *
 * Only the key half is translated. The modifier prefix is carried through
 * verbatim, and deliberately: the two paths disagree about modifier *order* as
 * well - `KeyNameFromKeyCode` emits Ctrl, Alt, Shift
 * (`common/hotkeys_basic.cpp:192-205`) while GTK emits Shift, Ctrl, Alt, which
 * is why pl_editor's own File menu reads `Shift+Ctrl+S` - but this port already
 * has a third convention of its own in `editors/schematic/hotkey_bindings.ts`
 * (`comboFromEvent`, Ctrl, Shift, Alt) that a user's stored overrides are
 * written in. Settling that is a change to the override format and belongs on
 * its own branch; silently re-ordering here would leave a default row and a
 * rebound row spelled differently in the same column.
 *
 * Modifiers are peeled off the front rather than split on `+`, because `+` is
 * itself a key - `Ctrl++` is Zoom In. `parseAccelerator` in `menu_hotkeys.ts`
 * peels for the same reason.
 *
 * A hint that is not an accelerator at all - a gesture like `Ctrl+Click`, or a
 * bare modifier name - has no key in the table and comes back unchanged.
 */
export function hotkeyListName(shortcut: string | undefined): string {
  if (!shortcut) return '';
  const text = shortcut.trim();
  if (text === '') return '';

  let at = 0;
  for (;;) {
    // `(?=.)` so a string that is nothing but modifiers is not peeled down to
    // an empty key: `Ctrl` on its own is a row in the Hotkey List.
    const m = /^(ctrl|control|cmd|command|meta|shift|alt|option)\+(?=.)/i.exec(text.slice(at));
    if (!m) break;
    at += m[0].length;
  }

  return text.slice(0, at) + hotkeyListKey(text.slice(at));
}
