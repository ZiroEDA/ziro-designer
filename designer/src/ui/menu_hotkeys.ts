// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The missing middle of this app's hotkeys: the thing that actually presses the
 * menu item whose accelerator you typed.
 *
 * ## What was wrong
 *
 * Upstream a command's key is declared once. `TOOL_ACTION` carries
 * `.DefaultHotkey()`; `ACTION_MANAGER::RunHotKey` dispatches it; `ACTION_MENU`
 * renders the accelerator from the same action (`common/tool/action_menu.cpp`
 * :355-388, `updateHotKeys`). One declaration, three consumers.
 *
 * Here the declaration existed and one consumer was missing. `MenuItem.shortcut`
 * is real data - `ui/hotkeys_inventory.ts` derives the whole Hotkey List dialog
 * by reading it out of the menu builders - but nothing *dispatched* it. Each
 * frame hand-wrote a `window.addEventListener('keydown', …)` with literal
 * comparisons beside its menu, so an accelerator printed in a menu was
 * decoration until somebody separately wrote a matching `if`, and every such
 * `if` was a fresh chance to compare `'Q'` instead of `'q'`. The Image
 * Converter's covered Ctrl+O and Ctrl+`,` and simply had no case for Ctrl+Q,
 * which is how the gap was found.
 *
 * This module is that third consumer: give it the menu tree a frame already
 * builds and it invokes the item whose `shortcut` matches the event.
 *
 * ## Matching rules, and where each comes from
 *
 * **Case-insensitive on the key.** `Ctrl+Q` fires whether the browser reports
 * `e.key` as `'q'` or `'Q'` - and it reports `'Q'` whenever Caps Lock is on,
 * which is the bug a literal `e.key === 'q'` ships with.
 *
 * **Exact on modifiers.** A binding without Shift must not fire on Shift+key:
 * `wxAcceleratorEntry` holds `wxACCEL_CTRL` and `wxACCEL_SHIFT` as separate
 * flags and matches the set, it does not match a subset. So `Ctrl+Q` does not
 * fire on Ctrl+Shift+Q.
 *
 * *With one exemption, which is not a loosening:* for a punctuation key the
 * shifted character **is** the key. `+` is typed as Shift+`=` on a US layout,
 * so `Ctrl++` - Zoom In - would never match if Shift had to be absent. The
 * character already encodes the modifier, so comparing it again counts it
 * twice. `comboFromEvent` in `editors/schematic/hotkey_bindings.ts` draws the
 * same line in the same place (`shiftNames`), for the same reason. Shift is
 * therefore compared for letters, digits, function keys and named keys, and
 * ignored for punctuation.
 *
 * **Ctrl and Cmd are one modifier**, as they are everywhere else here: a Mac
 * user's Cmd+S matches `Ctrl+S`.
 *
 * **A disabled item does not fire.** Upstream this is `ACTION_CONDITIONS` /
 * `RegisterUIUpdateHandler`, and a greyed row's accelerator does nothing. It
 * matters concretely: the project manager's Edit menu carries Cut, Copy and
 * Paste permanently greyed, and a dispatcher that ignored `disabled` would
 * swallow Ctrl+C for the whole app.
 *
 * ## When the user is typing
 *
 * The brief for this work guessed that a wx accelerator fires over a focused
 * text control for Ctrl-combinations. It does not, and KiCad goes out of its
 * way to make sure of it. Two places say so:
 *
 *   `include/widgets/wx_menubar.h:30-58` - `WX_MENUBAR` exists for no other
 *   purpose than to throw away the menubar's accelerator table, because "key
 *   events matching hotkey combinations are converted to menu events and never
 *   get passed to text controls" (kicad#1941). The accelerator on a menu label
 *   is therefore *display*; it is not what dispatches.
 *
 *   `common/tool/tool_dispatcher.cpp:654-670` - what dispatches instead, and
 *   the first thing it does with a key event is:
 *
 *       if( KIUI::IsInputControlFocused( focus ) )
 *       {
 *           bool enabled = KIUI::IsInputControlEditable( focus );
 *           // Never process key events for tools when a text entry has focus
 *           if( enabled ) { aEvent.Skip(); return; }
 *           else if( ke->GetModifiers() == wxMOD_CONTROL
 *                    && ke->GetKeyCode() == 'C' ) { aEvent.Skip(); return; }
 *       }
 *
 * So the rule, stated: **no hotkey fires while an editable text entry has
 * focus - Ctrl-combinations included.** A *read-only* entry is different: it
 * still keeps Ctrl+C, so you can copy out of it, and lets every other key
 * through to the frame. {@link focusBlocksHotkey} is exactly those six lines.
 *
 * That also corrects the note in `ui/browser_hotkeys.ts`, which described
 * `isTypingTarget` as the port "deliberately parting with wx". It is not a
 * departure; it is what wx does, once you follow the dispatch to the place it
 * actually happens.
 *
 * ## When a dialog is open
 *
 * Nothing fires. A KiCad modal runs its own event loop, so the frame beneath it
 * never sees the key - which is why `DIALOG_SHIM` needs no code to suppress the
 * parent's hotkeys. `openModalCount()` from `ui/modal_escape.ts` is the same
 * fact here, and reusing it means a dialog gets this for free the moment it
 * registers its Esc.
 */
import { openModalCount } from './modal_escape.js';
import { isTypingTarget, type FocusLike } from './browser_hotkeys.js';
import type { Menu, MenuItem } from './menu_types.js';

/** A parsed accelerator: the modifier set, and the key it wants. */
export interface Accelerator {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** The key half, as written in the menu - `Q`, `,`, `F5`, `Del`, `↑`. */
  key: string;
  /**
   * Whether Shift is compared at all. False for a punctuation key, whose
   * shifted character is already the key - see the module note.
   */
  shiftMatters: boolean;
}

/**
 * How the menus spell a named key, against `KeyboardEvent.key`.
 *
 * A superset of `hotkey_bindings.ts`'s `KEY_NAMES` inverse: the menus also use
 * the arrow *glyphs*, which is how KiCad's own menu strings read them
 * ("Move Up  ↑"), while the hotkey registry spells them `Up`/`Down`. Both are
 * accepted so a shortcut written either way dispatches.
 */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  del: 'Delete',
  delete: 'Delete',
  esc: 'Escape',
  escape: 'Escape',
  space: ' ',
  backspace: 'Backspace',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',
  ins: 'Insert',
  insert: 'Insert',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
};

/** `F1`…`F12`. `F` on its own is the letter, and must not match here. */
const FUNCTION_KEY = /^F([1-9]|1[0-2])$/i;

/**
 * A hint that is a mouse gesture rather than a keystroke - "Ctrl+Click",
 * "Shift+Wheel". `planClaim` in browser_hotkeys.ts skips the same shapes.
 */
const GESTURE = /click|wheel|drag/i;

/**
 * Read a menu accelerator. `null` for anything that is not one.
 *
 * Modifiers are peeled off the front rather than split on `+`, because `+` is
 * itself a key: splitting `Ctrl++` on `+` yields `['Ctrl', '', '']` and loses
 * it. `eventFromCombo` peels for the same reason.
 *
 * Both orders the menus use are accepted - `Ctrl+Shift+S` and `Shift+Ctrl+S`
 * both appear in the tree today.
 */
export function parseAccelerator(shortcut: string | undefined): Accelerator | null {
  if (!shortcut) return null;
  const text = shortcut.trim();
  if (text === '' || GESTURE.test(text)) return null;

  let ctrl = false;
  let shift = false;
  let alt = false;
  let key = text;

  for (;;) {
    // The `(?=.)` keeps a string that is nothing but modifiers - `Ctrl+Alt+` -
    // from being peeled down to an empty key. `eventFromCombo` guards the same
    // way. The `Ctrl++` case is handled by peeling from the front rather than
    // by the lookahead: a naive `split('+')` is what loses it.
    const m = /^(ctrl|control|cmd|command|meta|shift|alt|option)\+(?=.)/i.exec(key);
    if (!m) break;
    const mod = m[1]!.toLowerCase();
    if (mod === 'shift') shift = true;
    else if (mod === 'alt' || mod === 'option') alt = true;
    else ctrl = true;
    key = key.slice(m[0].length);
  }

  if (key === '') return null;

  const named = NAMED_KEYS[key.toLowerCase()];
  const isFunctionKey = FUNCTION_KEY.test(key);
  // Shift is compared for anything whose character does not already carry it:
  // letters, digits, function keys, and keys with a name of their own.
  const shiftMatters = !!named || isFunctionKey || /^[a-z0-9]$/i.test(key);

  return { ctrl, shift, alt, key, shiftMatters };
}

/** The parts of a keyboard event this module reads. Structural, so it is
 *  exercisable without a DOM - this workspace's tests run in node. */
export interface HotkeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Whether `e` is the accelerator `acc`. See the module note for each rule. */
export function matchesAccelerator(acc: Accelerator, e: HotkeyEvent): boolean {
  // Ctrl and Cmd collapse to one modifier, as the menus and comboFromEvent do.
  if ((e.ctrlKey || e.metaKey) !== acc.ctrl) return false;
  if (e.altKey !== acc.alt) return false;
  if (acc.shiftMatters && e.shiftKey !== acc.shift) return false;

  const named = NAMED_KEYS[acc.key.toLowerCase()];
  if (named) return e.key === named;
  if (FUNCTION_KEY.test(acc.key)) return e.key.toUpperCase() === acc.key.toUpperCase();
  // Case-insensitive: `e.key` is `'Q'` with Caps Lock on and `'q'` without,
  // and both are the same keystroke.
  return e.key.toLowerCase() === acc.key.toLowerCase();
}

/**
 * Every item in the tree that can be invoked, submenus included.
 *
 * `items` and `submenu` are both walked because `MenuItem` accepts either -
 * the two editors that grew flyouts spelled it differently and both still
 * work. Separators and rows that are only there to hold a submenu are skipped;
 * a row with no `action` has nothing to dispatch.
 */
function* invocable(items: readonly MenuItem[]): Generator<MenuItem> {
  for (const item of items) {
    if (item.sep) continue;
    if (item.action) yield item;
    const kids = item.submenu ?? item.items;
    if (kids) yield* invocable(kids);
  }
}

/**
 * The item whose accelerator this event is, or `null`.
 *
 * A disabled row is skipped rather than matched-and-ignored, so a greyed
 * Ctrl+C leaves the key to whatever else wants it instead of swallowing it.
 * First match wins, in menu order, which is upstream's rule too: two actions
 * on one key is a hotkey conflict and `ACTION_MANAGER` runs the first it finds.
 */
export function findMenuHotkey(menus: readonly Menu[], e: HotkeyEvent): MenuItem | null {
  for (const menu of menus) {
    for (const item of invocable(menu.items)) {
      if (item.disabled) continue;
      const acc = parseAccelerator(item.shortcut);
      if (acc && matchesAccelerator(acc, e)) return item;
    }
  }
  return null;
}

/**
 * Whether the thing with focus keeps this key for itself.
 *
 * `tool_dispatcher.cpp:654-670`, transcribed: an editable text entry takes
 * every key; a read-only one takes only Ctrl+C, so a copy out still works.
 */
export function focusBlocksHotkey(
  target: (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null | undefined,
  e: HotkeyEvent,
): boolean {
  if (!isTypingTarget(target)) return false;
  if (!target?.readOnly && !target?.disabled) return true;
  // "Even if not enabled, allow a copy out."
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c';
}

/** What a dispatch attempt is allowed to consider. */
export interface DispatchOptions {
  /** The focused element, if any. Defaults to nothing focused. */
  target?: (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
  /** How many modal dialogs are open. Defaults to asking the modal stack. */
  modalCount?: number;
  /**
   * How many open dialogs this frame sits *under* before it should go quiet.
   *
   * Zero for a frame, which is beneath every dialog it opens. One for a frame
   * that is itself a dialog - CVPCB is a `KIWAY_PLAYER` with its own menubar
   * upstream and a modal here - so its own registration does not silence it,
   * while a dialog it opens in turn still does.
   */
  modalFloor?: number;
}

/**
 * Run the menu command this event is the accelerator for.
 *
 * Returns whether anything ran, so the caller can decide about
 * `preventDefault`. Deliberately does no `preventDefault` itself: suppressing
 * the *browser's* action is `ui/browser_hotkeys.ts`'s job and it already runs a
 * capture-phase listener for exactly the combos the app claims.
 */
export function dispatchMenuHotkey(
  menus: readonly Menu[],
  e: HotkeyEvent,
  opts: DispatchOptions = {},
): boolean {
  const modals = opts.modalCount ?? openModalCount();
  // A wx modal has its own event loop; the frame below it never sees the key.
  if (modals > (opts.modalFloor ?? 0)) return false;
  if (focusBlocksHotkey(opts.target, e)) return false;

  const hit = findMenuHotkey(menus, e);
  if (!hit) return false;
  hit.action?.();
  return true;
}
