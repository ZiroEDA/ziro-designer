// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What Help > List Hotkeys shows, grouped the way HOTKEY_STORE groups it.
 *
 * KiCad builds this list at runtime: DIALOG_LIST_HOTKEYS asks the manager's
 * ACTION_MANAGER for its actions and then each kiface in turn - eeschema,
 * pcbnew, gerbview, pl_editor - for theirs, so the list is every TOOL_ACTION
 * that exists, whether or not its editor is open.
 *
 * There is no equivalent here. An editor's commands live in that editor's
 * module and several are declared inline in the component, so there is nothing
 * to ask while sitting in the project manager. This table is that list,
 * transcribed, and the section names are HOTKEY_STORE::GetSectionName's:
 *
 *     { "common",   _( "Common" ) },
 *     { "kicad",    _( "Project Manager" ) },
 *     { "eeschema", _( "Schematic Editor" ) },
 *     { "pcbnew",   _( "PCB Editor" ) },
 *     { "plEditor", _( "Drawing Sheet Editor" ) },
 *     { "3DViewer", _( "3D Viewer" ) },
 *     { "gerbview", _( "Gerber Viewer" ) },
 *
 * A transcription can drift from the menus it describes, so the sections whose
 * menus are built by a function rather than inline are checked against those
 * functions by qa/unittests/designer/hotkeys_table.test.ts. The rest cannot be
 * checked that way and are the reason this file is worth reviewing when a
 * hotkey changes.
 */

export interface HotkeyEntry {
  /** The command's name, as its menu shows it. */
  command: string;
  /** The keystroke, formatted as the menus format it. */
  keys: string;
}

export interface HotkeySection {
  name: string;
  entries: HotkeyEntry[];
}

/**
 * Commands that exist in every editor, which is what upstream's "Common"
 * section holds - `common.*` actions, registered once and shared.
 */
const COMMON: HotkeyEntry[] = [
  { command: 'Undo', keys: 'Ctrl+Z' },
  { command: 'Redo', keys: 'Ctrl+Y' },
  { command: 'Cut', keys: 'Ctrl+X' },
  { command: 'Copy', keys: 'Ctrl+C' },
  { command: 'Paste', keys: 'Ctrl+V' },
  { command: 'Delete', keys: 'Del' },
  { command: 'Save', keys: 'Ctrl+S' },
  { command: 'Zoom to Fit', keys: 'Home' },
  { command: 'Zoom In', keys: 'Ctrl++' },
  { command: 'Zoom Out', keys: 'Ctrl+-' },
  { command: 'Refresh', keys: 'F5' },
  { command: 'Preferences…', keys: 'Ctrl+,' },
  { command: 'List Hotkeys…', keys: 'Ctrl+F1' },
  { command: 'Close (back to project)', keys: 'Ctrl+W' },
];

export const HOTKEY_SECTIONS: HotkeySection[] = [
  { name: 'Common', entries: COMMON },
  {
    name: 'Project Manager',
    entries: [
      { command: 'New Project…', keys: 'Ctrl+N' },
      { command: 'Open Project…', keys: 'Ctrl+O' },
      // Refresh is not here: it is ACTIONS::zoomRedraw, a common.Control.*
      // action, so it belongs to Common above - and its key there is F5, not
      // the Ctrl+R the manager toolbar's tooltip claims. Ctrl+R is the
      // __WXMAC__ branch of that DefaultHotkey; F5 is every other platform's.
      { command: 'Schematic Editor', keys: 'Ctrl+E' },
      { command: 'Symbol Editor', keys: 'Ctrl+L' },
      { command: 'PCB Editor', keys: 'Ctrl+P' },
      { command: 'Footprint Editor', keys: 'Ctrl+F' },
      { command: 'Gerber Viewer', keys: 'Ctrl+G' },
      { command: 'Image Converter', keys: 'Ctrl+B' },
      { command: 'Drawing Sheet Editor', keys: 'Ctrl+Y' },
    ],
  },
  {
    name: 'Schematic Editor',
    entries: [
      { command: 'Properties…', keys: 'E' },
      { command: 'Duplicate', keys: 'Ctrl+D' },
      { command: 'Edit with Symbol Editor', keys: 'Ctrl+E' },
      { command: 'Select/Expand Connection', keys: 'Ctrl+4' },
      { command: 'Leave Sheet', keys: 'Alt+Backspace' },
      { command: 'Delete Footprint Assignment', keys: 'Del' },
    ],
  },
  {
    name: 'PCB Editor',
    entries: [
      { command: 'Properties…', keys: 'E' },
      { command: 'Duplicate', keys: 'Ctrl+D' },
      { command: 'Find', keys: 'Ctrl+F' },
      { command: 'Move Exactly…', keys: 'Shift+M' },
      { command: 'Position Relative To…', keys: 'Shift+P' },
      { command: 'Rotate Counterclockwise', keys: 'R' },
      { command: 'Rotate Clockwise', keys: 'Shift+R' },
      { command: 'Change Side / Flip', keys: 'F' },
      { command: 'Measure Tool', keys: 'Ctrl+Shift+M' },
      { command: 'Single Track', keys: 'X' },
      { command: 'Update PCB from Schematic…', keys: 'F8' },
    ],
  },
  {
    name: '3D Viewer',
    entries: [
      { command: 'View Front', keys: 'Y' },
      { command: 'View Back', keys: 'Shift+Y' },
      { command: 'View Right', keys: 'X' },
      { command: 'View Left', keys: 'Shift+X' },
      { command: 'View Top', keys: 'Z' },
      { command: 'View Bottom', keys: 'Shift+Z' },
      { command: 'Flip Board', keys: 'F' },
      { command: 'Move Board Left', keys: '←' },
      { command: 'Move Board Right', keys: '→' },
      { command: 'Move Board Up', keys: '↑' },
      { command: 'Move Board Down', keys: '↓' },
      { command: 'Close 3D Viewer', keys: 'Esc' },
    ],
  },
  {
    name: 'Symbol Editor',
    entries: [
      { command: 'New Symbol…', keys: 'Ctrl+N' },
      { command: 'Pin', keys: 'P' },
      { command: 'Text', keys: 'T' },
    ],
  },
  {
    name: 'Footprint Editor',
    entries: [
      { command: 'New Footprint…', keys: 'Ctrl+N' },
      { command: 'Zoom to Fit', keys: 'F' },
    ],
  },
  {
    name: 'Gerber Viewer',
    entries: [{ command: 'Open Gerber File(s)…', keys: 'Ctrl+O' }],
  },
  {
    name: 'Drawing Sheet Editor',
    entries: [
      { command: 'New', keys: 'Ctrl+N' },
      { command: 'Open…', keys: 'Ctrl+O' },
    ],
  },
  {
    name: 'Image Converter',
    entries: [{ command: 'Open…', keys: 'Ctrl+O' }],
  },
];

/**
 * WIDGET_HOTKEY_LIST's filter: the text is matched against the command name and
 * the keystroke, and a section survives when any of its rows does.
 *
 * Upstream matches on the same two fields (`WIDGET_HOTKEY_LIST::updateShownItems`
 * tests the name and then the key text), so searching "ctrl+z" finds Undo.
 */
export function filterHotkeys(sections: readonly HotkeySection[], filter: string): HotkeySection[] {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return sections as HotkeySection[];
  return sections
    .map((s) => ({
      name: s.name,
      entries: s.entries.filter(
        (e) => e.command.toLowerCase().includes(needle) || e.keys.toLowerCase().includes(needle),
      ),
    }))
    .filter((s) => s.entries.length > 0);
}
