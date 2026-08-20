// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EDA_BASE_FRAME::AddMenuLanguageList (common/eda_base_frame.cpp:2062-2087)
 * and the LanguagesList table (common/pgm_base.cpp:95-148), against the shared
 * port in designer/src/ui/language_menu.ts — and through the project manager's
 * real menu builder, which is where a user meets it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES_LIST,
  setLanguageMenuItem,
  TRANSLATED_LANGUAGES,
} from '@ziroeda/designer/src/ui/language_menu.js';
import { buildManagerMenus } from '@ziroeda/designer/src/home/menubar.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';
import type { ProjectMeta } from '@ziroeda/designer/src/home/projectStore.js';

const menu = (over: Partial<Parameters<typeof setLanguageMenuItem>[0]> = {}): MenuItem =>
  setLanguageMenuItem({ current: DEFAULT_LANGUAGE, onSelect: () => {}, ...over });

describe('the LanguagesList table', () => {
  it('carries all 45 rows, not one', () => {
    // pgm_base.cpp:95-148, minus the { 0, 0, "", false } sentinel. Ours was an
    // inline [{ label: 'English', disabled: true }] stub, twice.
    expect(LANGUAGES_LIST).toHaveLength(45);
  });

  it('opens with Default and keeps upstream’s endonym ordering', () => {
    // Not alphabetical by English name: Indonesian sits under B and Japanese
    // under N, because the list is sorted by the endonym.
    const labels = LANGUAGES_LIST.map((l) => l.label);
    expect(labels[0]).toBe('Default');
    expect(labels.slice(1, 5)).toEqual(['العربية', 'فارسی', 'Bahasa Indonesia', 'Български']);
    expect(labels.indexOf('Bahasa Indonesia')).toBeLessThan(labels.indexOf('Català'));
    expect(labels.indexOf('Norsk Bokmål')).toBeLessThan(labels.indexOf('日本語'));
    expect(labels.at(-1)).toBe('繁體中文');
  });

  it('marks only Default as translatable, as m_DoNotTranslate does', () => {
    // Every other row is an endonym and reads the same in every locale.
    const translated = LANGUAGES_LIST.filter((l) => !l.doNotTranslate).map((l) => l.label);
    expect(translated).toEqual(['Default']);
  });

  it('has no duplicate labels — the label is the config key', () => {
    // pgm_base.cpp:89-90: "m_Lang_Label is also used as key in config".
    expect(new Set(LANGUAGES_LIST.map((l) => l.label)).size).toBe(LANGUAGES_LIST.length);
  });
});

describe('the Set Language submenu', () => {
  it('is titled "Set Language" and carries the language icon', () => {
    // langsMenu->SetTitle( _( "Set Language" ) );
    // langsMenu->SetIcon( BITMAPS::language );
    expect(menu().label).toBe('Set Language');
    expect(menu().icon).toBe('language');
  });

  it('has one row per language, in table order', () => {
    expect(menu().submenu?.map((i) => i.label)).toEqual(LANGUAGES_LIST.map((l) => l.label));
  });

  it('is a set of wxITEM_CHECK rows, exactly one of them checked', () => {
    const rows = menu({ current: 'English' }).submenu ?? [];
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['English']);
  });

  it('falls back to Default when the stored value names no language', () => {
    // PGM_BASE (pgm_base.cpp:588-600) leaves wxLANGUAGE_DEFAULT set when no
    // LanguagesList row matches the stored string.
    const rows = menu({ current: 'Klingon' }).submenu ?? [];
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['Default']);
  });
});

describe('what we can honestly offer', () => {
  it('only enables the languages we have a catalogue for', () => {
    // We ship no message catalogues, so "Default" and "English" are the whole
    // of it. The other rows are shown, because upstream's list is the whole
    // list, and greyed, because offering 45 no-ops would be a lie.
    expect([...TRANSLATED_LANGUAGES]).toEqual(['Default', 'English']);

    const enabled = (menu().submenu ?? []).filter((r) => !r.disabled).map((r) => r.label);
    expect(enabled).toEqual(['Default', 'English']);
  });

  it('greys the rest without hiding them', () => {
    const rows = menu().submenu ?? [];
    expect(rows.filter((r) => r.disabled)).toHaveLength(LANGUAGES_LIST.length - 2);
    expect(rows.map((r) => r.label)).toContain('Français');
  });

  it('grows with no other change when catalogues land', () => {
    // The only seam translations have to move.
    const rows = menu({ available: ['Default', 'English', 'Français'] }).submenu ?? [];
    expect(rows.filter((r) => !r.disabled).map((r) => r.label)).toEqual([
      'Default',
      'English',
      'Français',
    ]);
  });

  it('reports the picked language by its m_Lang_Label, the key upstream stores', () => {
    const onSelect = vi.fn();
    const rows = menu({ onSelect, available: LANGUAGES_LIST.map((l) => l.label) }).submenu ?? [];
    rows.find((r) => r.label === 'Español')?.action?.();

    expect(onSelect).toHaveBeenCalledWith('Español');
  });
});

// ---- through the project manager's real Preferences menu ------------------------

const noop = (): void => undefined;
const managerHandlers = {
  newProject: noop,
  openProject: noop,
  selectProjectFiles: noop,
  openRecent: noop,
  clearRecent: noop,
  language: DEFAULT_LANGUAGE,
  setLanguage: noop,
  closeProject: noop,
  restoreLocalHistory: noop,
  hasLocalHistory: false,
  saveAs: noop,
  archiveProject: noop,
  unarchiveProject: noop,
  refresh: noop,
  toggleLocalHistory: noop,
  localHistoryShown: false,
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
  recent: [] as ProjectMeta[],
  demos: [],
};

const managerSetLanguage = (over: Partial<typeof managerHandlers> = {}): MenuItem => {
  const prefs = buildManagerMenus({ ...managerHandlers, ...over }).find(
    (m) => m.label === 'Preferences',
  );
  const item = prefs?.items.find((i) => i.label === 'Set Language');
  if (!item) throw new Error('the Preferences menu has no Set Language row');
  return item;
};

describe("the project manager's Preferences menu", () => {
  it('ends with Set Language, after a separator', () => {
    // kicad/menubar.cpp's prefsMenu->AppendSeparator() then AddMenuLanguageList.
    const prefs = buildManagerMenus(managerHandlers).find((m) => m.label === 'Preferences');
    const items = prefs?.items ?? [];
    expect(items.at(-1)?.label).toBe('Set Language');
    expect(items.at(-2)?.sep).toBe(true);
  });

  it('shows the whole list rather than a lone disabled English', () => {
    const rows = managerSetLanguage().submenu ?? [];
    expect(rows).toHaveLength(45);
    expect(rows.map((r) => r.label)).toContain('日本語');
  });

  it('checks the language the settings hold', () => {
    const rows = managerSetLanguage({ language: 'English' }).submenu ?? [];
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['English']);
  });

  it('hands the picked label back to the settings', () => {
    const setLanguage = vi.fn();
    const rows = managerSetLanguage({ setLanguage }).submenu ?? [];
    rows.find((r) => r.label === 'English')?.action?.();

    expect(setLanguage).toHaveBeenCalledWith('English');
  });
});
