// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which keystrokes a browser tab may have, and what this app binds instead.
 *
 * A leaf module on purpose: no imports at all. `browser_hotkeys.ts` is the
 * natural home for these and re-exports every name below, but it reaches into
 * `editors/schematic/hotkey_bindings.ts` for `comboFromEvent`, and that module
 * reaches back through `ui/hotkey_apps.ts` to the schematic's own hotkey table.
 * So the moment a *declaration* site - a menu row, a registry entry - asked
 * `browserSafeKey` which key it should carry, it was asking through a cycle,
 * and got `undefined` at module-init time rather than a function.
 *
 * The table therefore lives where anything may import it, including the tables
 * that are themselves imported by the dispatcher.
 */

/**
 * Combos a page cannot take, whatever it does.
 *
 * Chromium's `IsReservedCommandOrKey`, and the equivalent in the other engines:
 * anything that opens or closes a window or a tab, plus tab cycling. Firefox
 * and Safari reserve the same set with minor differences, so this is the union
 * rather than one browser's list.
 */
export const BROWSER_RESERVED: readonly string[] = [
  'Ctrl+N',
  'Ctrl+Shift+N',
  'Ctrl+T',
  'Ctrl+Shift+T',
  'Ctrl+W',
  'Ctrl+Shift+W',
  'Ctrl+Q',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
];

const RESERVED = new Set(BROWSER_RESERVED.map((c) => c.toLowerCase()));

/** Whether a combo is one the browser keeps for itself. */
export const isBrowserReserved = (combo: string): boolean => RESERVED.has(combo.toLowerCase());

/**
 * What this app binds instead, where the browser will not give a key up.
 *
 * `preventDefault` cannot help with {@link BROWSER_RESERVED}, and the Keyboard
 * Lock API only holds in fullscreen, so a command whose upstream key is one of
 * these has to answer to something else in the normal case or it does not work
 * at all. This is that substitution, in one place, so a reader can see the
 * whole of the divergence from KiCad's defaults at once.
 *
 * The replacements add Alt, which no browser and no common desktop takes. Not
 * `Ctrl+Alt+T`, which opens a terminal on GNOME and so would be worse than what
 * it replaced.
 *
 * Note what is and is not being moved. The *platform's* close-this-window and
 * quit stay exactly where they are: a browser closing the tab on Ctrl+W is the
 * faithful analogue of a window manager closing a KiCad frame, and neither is a
 * TOOL_ACTION - `Close` and `Quit` come out of g_standardPlatformCommands and
 * ACTIONS::quit declares no hotkey at all. What needs moving is the *in-app*
 * command that happens to share the key: our File > Close and File > Quit both
 * return to the project manager, which is not a window close and not a process
 * exit. Losing the tab, or the whole browser, instead is the bug.
 *
 * Every reserved combo an in-app command wants is now substituted. Ctrl+Shift+T
 * was the last exception, on the grounds that no dispatcher read it: the PCB
 * editor advertised `PCB_ACTIONS::placeText` on its toolbar and nothing acted on
 * the key. That is no longer true - the Place menu carries the row and
 * `dispatchMenuHotkey` presses it - so the question the deferral was waiting on
 * has an answer, and leaving it would mean the row prints a key the browser
 * eats.
 */
export const BROWSER_REBINDS: Readonly<Record<string, string>> = {
  /** KICAD_MANAGER_ACTIONS::newProject, and ACTIONS::doNew in the editors that
   *  have one. Ctrl+N is the browser's new window. */
  'Ctrl+N': 'Ctrl+Alt+N',
  /** `ACTION_MENU::AddClose`'s in-app Close. Ctrl+W is the browser's close tab. */
  'Ctrl+W': 'Ctrl+Alt+W',
  /**
   * `ACTION_MENU::AddQuit`'s in-app Quit.
   *
   * Chrome binds Ctrl+Q to quitting the *browser* on Linux, and reserves it
   * everywhere, so the raw key either does nothing or throws away every other
   * tab as well. Declaring it anyway - which is what the Image Converter did
   * when the dispatcher first landed, on the grounds that "a key we decline to
   * declare is one that certainly does nothing" - fails its own test: the raw
   * key certainly does nothing here either. The substitution is the spelling
   * that keeps the promise the menu makes.
   */
  'Ctrl+Q': 'Ctrl+Alt+Q',
  /**
   * `PCB_ACTIONS::placeText` - Draw Text, in the PCB and footprint editors
   * (`pcb_actions.cpp:213`). Ctrl+Shift+T is the browser's reopen-closed-tab,
   * which Chromium handles before the page sees the key.
   *
   * Shift is kept and Alt added, which is the shape the three above already
   * have. Not `Ctrl+Alt+T`: that opens a terminal on GNOME, and it is also
   * eeschema's key for nothing at all - `SCH_ACTIONS::placeSchematicText` is a
   * bare `T`, so the two editors' text tools stay as far apart here as they are
   * upstream.
   */
  'Ctrl+Shift+T': 'Ctrl+Alt+Shift+T',
};

/** The combo this app actually binds for a command whose upstream key is taken. */
export const browserSafeKey = (upstream: string): string => BROWSER_REBINDS[upstream] ?? upstream;
