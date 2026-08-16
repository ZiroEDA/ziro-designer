// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List's inventory, which is collected from the menu builders and
 * the toolbar tables rather than transcribed.
 *
 * The hand-written table this replaced was 61 rows and had already drifted from
 * the menus it claimed to describe. These tests are mostly about the collection
 * not going quiet: an inventory built by walking modules fails by returning
 * nothing, and a dialog listing nothing looks much like one that is merely
 * empty.
 */
import { describe, expect, it } from 'vitest';
import {
  buildHotkeySections,
  filterHotkeys,
  type HotkeySection,
} from '@ziroeda/designer/src/ui/hotkeys_inventory.js';
import { buildManagerMenus } from '@ziroeda/designer/src/home/menubar.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const sections: HotkeySection[] = buildHotkeySections();
const rows = sections.flatMap((s) => s.entries);
const find = (command: string): (typeof rows)[number] | undefined =>
  rows.find((e) => e.command === command);

const noop = (): void => undefined;
const managerHandlers = {
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
  openGerberViewer: noop,
  openCalculator: noop,
  openDrawingSheetEditor: noop,
  openPreferences: noop,
  showAbout: noop,
  showHotkeys: noop,
  openDemo: noop,
  hasProject: true,
  hasTextFileSelected: true,
  recent: [],
  demos: [],
};

describe('the hotkey inventory', () => {
  it('collects the whole app, not a handful of rows', () => {
    // KiCad's dialog lists 809 actions. Ours is smaller because the app is,
    // but it is the same order of magnitude and it is derived - a drop here
    // means a builder stopped being walked, which is otherwise silent.
    expect(rows.length).toBeGreaterThan(300);
    expect(sections.length).toBeGreaterThanOrEqual(7);
  });

  it('leaves no section empty', () => {
    // buildHotkeySections drops empty ones, so an empty section here means the
    // drop stopped working rather than that a section is genuinely bare.
    for (const s of sections) expect(s.entries.length, `${s.name} is empty`).toBeGreaterThan(0);
  });

  it('names its sections the way HOTKEY_STORE::GetSectionName does', () => {
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
    for (const s of sections) expect(known, `unexpected section ${s.name}`).toContain(s.name);
  });

  it('strips the ellipsis, as updateFromClientData does', () => {
    //   label.Replace( wxT( "..." ), wxEmptyString );
    //   label.Replace( wxT( "…" ), wxEmptyString );
    for (const e of rows) {
      expect(e.command, `${e.command} keeps its ellipsis`).not.toMatch(/\.\.\.|…/);
    }
    expect(find('Open Project')).toBeDefined();
  });

  it('carries every accelerator the manager menu declares', () => {
    // The one section whose source can be re-read here independently, so the
    // collection is checked against something other than itself.
    const declared = new Map<string, string>();
    const walk = (items: readonly MenuItem[]): void => {
      for (const it of items) {
        if (it.submenu) walk(it.submenu);
        if (it.label && it.shortcut) {
          declared.set(it.label.replace(/\.\.\.|…/g, '').trim(), it.shortcut);
        }
      }
    };
    for (const m of buildManagerMenus(managerHandlers)) walk(m.items);
    expect(declared.size).toBeGreaterThan(8);

    const mgr = sections.find((s) => s.name === 'Project Manager');
    expect(mgr).toBeDefined();
    for (const [label, keys] of declared) {
      const row = mgr?.entries.find((e) => e.command === label);
      expect(row, `${label} missing from the Project Manager section`).toBeDefined();
      expect(row?.keys, `${label} lost its accelerator`).toBe(keys);
    }
  });

  it('leaves out the empty-state placeholders', () => {
    // "(no recent projects)" and "(no demos bundled)" are what a menu says when
    // it has nothing to list; they are not commands and were being listed as
    // two of them. Upstream has no equivalent - an empty FILE_HISTORY just has
    // no rows.
    for (const e of rows) {
      expect(e.command, `${e.command} is a placeholder`).not.toMatch(/^\(.*\)$/);
    }
  });

  it('lists List Hotkeys itself, on Ctrl+F1', () => {
    // ACTIONS::listHotKeys: .DefaultHotkey( MD_CTRL + WXK_F1 ).
    expect(find('List Hotkeys')?.keys).toBe('Ctrl+F1');
  });

  it('never repeats the command in the description column', () => {
    // A ToolButton has one string for both, so a description that is simply the
    // command again fills the column without saying anything. Upstream's two
    // come from GetFriendlyName() and GetDescription(), which differ.
    for (const e of rows) {
      if (e.description !== '') expect(e.description).not.toBe(e.command);
    }
  });

  it('leaves the alternate column empty, because nothing binds a second key', () => {
    for (const e of rows) expect(e.alt).toBe('');
  });

  it('has no duplicate command within a section', () => {
    for (const s of sections) {
      const names = s.entries.map((e) => e.command);
      expect(new Set(names).size, `${s.name} lists a command twice`).toBe(names.length);
    }
  });
});

describe('filterHotkeys (WIDGET_HOTKEY_LIST::updateShownItems)', () => {
  it('matches the command name', () => {
    const out = filterHotkeys(sections, 'undo');
    expect(out.flatMap((s) => s.entries).some((e) => /undo/i.test(e.command))).toBe(true);
  });

  it('matches the keystroke, so searching a key finds its command', () => {
    const out = filterHotkeys(sections, 'ctrl+n');
    expect(out.flatMap((s) => s.entries).some((e) => e.keys === 'Ctrl+N')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(filterHotkeys(sections, '  UNDO ').length).toBeGreaterThan(0);
  });

  it('drops sections with no surviving row', () => {
    for (const s of filterHotkeys(sections, 'undo')) expect(s.entries.length).toBeGreaterThan(0);
  });

  it('an empty filter is not a filter', () => {
    expect(filterHotkeys(sections, '')).toHaveLength(sections.length);
    expect(filterHotkeys(sections, '   ')).toHaveLength(sections.length);
  });

  it('returns nothing for a filter nothing matches', () => {
    expect(filterHotkeys(sections, 'zzzz-no-such-command')).toEqual([]);
  });
});
