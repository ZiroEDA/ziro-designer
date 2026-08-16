// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List's table, checked against the menus it claims to describe.
 *
 * KiCad builds this list from the live ACTION_MANAGER, so it cannot be wrong.
 * Ours is a transcription, which can be - a hotkey changed in a menu and not
 * here would leave the dialog quietly lying. The project manager's menus are
 * built by a function, so that section at least can be checked rather than
 * trusted, and this is that check.
 */
import { describe, expect, it } from 'vitest';
import {
  HOTKEY_SECTIONS,
  filterHotkeys,
  type HotkeySection,
} from '@ziroeda/designer/src/ui/hotkeys_table.js';
import { buildManagerMenus } from '@ziroeda/designer/src/home/menubar.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const section = (name: string): HotkeySection => {
  const s = HOTKEY_SECTIONS.find((x) => x.name === name);
  expect(s, `no "${name}" section`).toBeDefined();
  return s!;
};

/** Every shortcut the manager's menus actually declare, label -> keys. */
function managerShortcuts(): Map<string, string> {
  const noop = (): void => undefined;
  const menus = buildManagerMenus({
    newProject: noop,
    openProject: noop,
    selectProjectFiles: noop,
    openRecent: noop,
    clearRecent: noop,
    closeProject: noop,
    saveAs: noop,
    archiveProject: noop,
    unarchiveProject: noop,
    refresh: noop,
    openTextViewer: noop,
    editSchematic: noop,
    editSymbols: noop,
    editPcb: noop,
    editFootprints: noop,
    openImageConverter: noop,
    openPreferences: noop,
    showAbout: noop,
    showHotkeys: noop,
    openDemo: noop,
    hasProject: true,
    hasTextFileSelected: true,
    recent: [],
    demos: [],
  });
  const out = new Map<string, string>();
  const walk = (items: readonly MenuItem[]): void => {
    for (const it of items) {
      if (it.submenu) walk(it.submenu);
      if (it.label && it.shortcut) out.set(it.label, it.shortcut);
    }
  };
  for (const m of menus) walk(m.items);
  return out;
}

describe('the hotkey table describes the menus it is transcribed from', () => {
  const declared = managerShortcuts();

  it('found the manager menus', () => {
    // Without this the sweep passes by having nothing to compare against.
    expect(declared.size).toBeGreaterThan(8);
    expect(declared.get('New Project…')).toBe('Ctrl+N');
  });

  it('lists List Hotkeys… itself, on Ctrl+F1', () => {
    // ACTIONS::listHotKeys: .DefaultHotkey( MD_CTRL + WXK_F1 ). A dialog that
    // does not list the way it was opened is the first thing anyone notices.
    expect(declared.get('List Hotkeys…')).toBe('Ctrl+F1');
    const all = HOTKEY_SECTIONS.flatMap((s) => s.entries);
    expect(all.find((e) => e.command === 'List Hotkeys…')?.keys).toBe('Ctrl+F1');
  });

  it('agrees with the manager menus wherever both name a command', () => {
    const table = new Map(
      [...section('Project Manager').entries, ...section('Common').entries].map((e) => [
        e.command,
        e.keys,
      ]),
    );
    const disagreements: string[] = [];
    for (const [label, keys] of declared) {
      const mine = table.get(label);
      if (mine !== undefined && mine !== keys) {
        disagreements.push(`${label}: menu says ${keys}, table says ${mine}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('has no duplicate command within a section', () => {
    for (const s of HOTKEY_SECTIONS) {
      const names = s.entries.map((e) => e.command);
      expect(new Set(names).size, `${s.name} lists a command twice`).toBe(names.length);
    }
  });

  it('names every section HOTKEY_STORE would', () => {
    // GetSectionName's map, minus the ones with no commands of their own here.
    const known = new Set([
      'Common',
      'Project Manager',
      'Schematic Editor',
      'PCB Editor',
      'Drawing Sheet Editor',
      '3D Viewer',
      'Gerber Viewer',
      'Symbol Editor',
      'Footprint Editor',
      'Image Converter',
    ]);
    for (const s of HOTKEY_SECTIONS)
      expect(known, `unexpected section ${s.name}`).toContain(s.name);
  });
});

describe('filterHotkeys (WIDGET_HOTKEY_LIST::updateShownItems)', () => {
  it('matches the command name', () => {
    const out = filterHotkeys(HOTKEY_SECTIONS, 'undo');
    expect(out.flatMap((s) => s.entries).some((e) => e.command === 'Undo')).toBe(true);
  });

  it('matches the keystroke too, so searching a key finds its command', () => {
    const out = filterHotkeys(HOTKEY_SECTIONS, 'ctrl+z');
    expect(out.flatMap((s) => s.entries).map((e) => e.command)).toContain('Undo');
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(filterHotkeys(HOTKEY_SECTIONS, '  UNDO ').length).toBeGreaterThan(0);
  });

  it('drops sections with no surviving row', () => {
    const out = filterHotkeys(HOTKEY_SECTIONS, 'undo');
    expect(out.every((s) => s.entries.length > 0)).toBe(true);
  });

  it('an empty filter is not a filter', () => {
    expect(filterHotkeys(HOTKEY_SECTIONS, '')).toHaveLength(HOTKEY_SECTIONS.length);
    expect(filterHotkeys(HOTKEY_SECTIONS, '   ')).toHaveLength(HOTKEY_SECTIONS.length);
  });

  it('returns nothing for a filter nothing matches', () => {
    expect(filterHotkeys(HOTKEY_SECTIONS, 'zzzz-no-such-command')).toEqual([]);
  });
});
