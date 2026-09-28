// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `HOTKEY_STORE` (common/hotkey_store.cpp): the sections and rows the hotkeys
 * editor shows, the filter over them and the conflict search. The rows come
 * from an actions list each program contributes (`KIFACE::GetActions`); ours
 * is `designer/src/ui/hotkeys_inventory.ts`, which the frame hands the panel.
 */

/**
 * The user's rebindings, keyed by action name. Absent = the default; `null` =
 * unbound.
 */
export type HotkeyOverrides = Readonly<Record<string, string | null>>;

export interface HotkeyEntry {
  /**
   * `TOOL_ACTION::GetName()` - the key HOTKEY_STORE's map is keyed on, which is
   * what an override, an import and a reset all match a row by.
   *
   * Upstream's is `<app>.<Tool>.<action>`; we have the app and the action id but
   * no tool, so ours is `<app>.<id>` - `kicad.newProject`, `eeschema.drawWire`.
   * What matters is that it is stable and app-qualified, so the same id in two
   * editors is two rows rather than one.
   *
   * '' for a PSEUDO_ACTION - the gestures and the platform commands - which has
   * no name upstream either, and so can be neither rebound nor imported onto.
   */
  name: string;
  /** GetFriendlyName(), with the ellipsis stripped as updateFromClientData does. */
  command: string;
  /** The primary accelerator in force: the override where there is one, else the default. */
  keys: string;
  /** `GetDefaultHotKey()`, which is what "Undo All Changes" and a reset restore. */
  defaultKeys: string;
  /** m_EditKeycodeAlt. Nothing here binds a second key yet, so always ''. */
  alt: string;
  /** GetDescription(), flattened to one line. */
  description: string;
}

export interface HotkeySection {
  /** GetSectionName( action ) - what the tree row says. */
  name: string;
  entries: HotkeyEntry[];
}

/**
 * WIDGET_HOTKEY_LIST's filter, which tests the command name and the key text,
 * so searching "ctrl+z" finds Undo. The description is searched too - upstream
 * added that column and there is no reason to make it dead weight.
 */
export function filterHotkeys(sections: readonly HotkeySection[], filter: string): HotkeySection[] {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return sections as HotkeySection[];
  return sections
    .map((s) => ({
      name: s.name,
      entries: s.entries.filter(
        (e) =>
          e.command.toLowerCase().includes(needle) ||
          e.keys.toLowerCase().includes(needle) ||
          e.description.toLowerCase().includes(needle),
      ),
    }))
    .filter((s) => s.entries.length > 0);
}

/**
 * Commands already answering to `keys`, ignoring the one being rebound.
 *
 * `WIDGET_HOTKEY_LIST::resolveKeyConflicts` names what holds a combo before
 * assigning it, because "already taken" is the one thing a user cannot see for
 * themselves while typing one into a row. It searches the whole store rather
 * than the section, so a schematic binding that collides with a PCB one is
 * still reported.
 *
 * A PSEUDO_ACTION is skipped: a gesture is not something a key can be taken
 * from, and Ctrl+Click is not a keystroke.
 */
export function hotkeyConflicts(
  sections: readonly HotkeySection[],
  keys: string,
  exceptName: string,
): { command: string; section: string }[] {
  if (keys === '') return [];
  const want = keys.toLowerCase();
  const out: { command: string; section: string }[] = [];
  for (const s of sections) {
    for (const e of s.entries) {
      if (e.name === '' || e.name === exceptName) continue;
      if (e.keys.toLowerCase() === want) out.push({ command: e.command, section: s.name });
    }
  }
  return out;
}
