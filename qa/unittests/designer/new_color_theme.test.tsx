// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two rows the theme choice ends on, and the theme they make.
 *
 * `createThemeList` (`common/dialogs/panel_color_settings.cpp:238-239`):
 *
 *     m_cbTheme->Append( wxT( "---" ) );
 *     m_cbTheme->Append( _( "New Theme..." ) );
 *
 * We had neither, which is what Akshay spotted beside a live 10.0.5: our list
 * stopped at the three themes. They are `PANEL_COLOR_SETTINGS`' own —
 * `PANEL_PL_EDITOR_COLOR_SETTINGS` fills its choice from the same
 * `GetColorSettingsList()` and appends nothing
 * (`panel_pl_editor_color_settings.cpp:44-58`) — so a shared list that always
 * carried them would put "New Theme..." on a page that cannot make one.
 *
 * `OnThemeChanged` reads both by INDEX (`:122-137`): the separator puts the
 * selection back and returns, and the last row runs the prompt instead of
 * selecting anything.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  colorThemeOptions,
  NEW_THEME,
  THEME_SEPARATOR,
} from '@ziroeda/designer/src/dialogs/prefs/ColorThemeChoice.js';
import {
  filterThemeName,
  THEME_NAME_ILLEGAL_CHARS,
} from '@ziroeda/designer/src/dialogs/prefs/dialog_add_color_theme.js';
import { PanelEeschemaColorSettings } from '@ziroeda/designer/src/editors/schematic/prefs/PanelEeschemaColorSettings.js';
import { normalizeUserThemes, EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import type { EeschemaSettings, UserColorTheme } from '@ziroeda/designer/src/prefs/settings.js';
import type { PrefsContext } from '@ziroeda/designer/src/dialogs/prefs/types.js';

afterEach(cleanup);

describe('the list ends the way createThemeList ends it', () => {
  it('appends the separator and New Theme, in that order, after the sort', () => {
    const opts = colorThemeOptions([], true, {}, true);
    expect(opts.slice(-2).map(([id]) => id)).toEqual([THEME_SEPARATOR, NEW_THEME]);
    expect(opts.at(-1)?.[1]).toBe('New Theme...');
    // …after the sort, so "New Theme..." does not land between the K's.
    expect(opts[0]?.[1]).toBe('KiCad Classic (read-only)');
  });

  it('appends neither for a page that cannot make a theme', () => {
    const opts = colorThemeOptions([], true, {});
    expect(opts.map(([id]) => id)).not.toContain(NEW_THEME);
    expect(opts.map(([id]) => id)).not.toContain(THEME_SEPARATOR);
  });

  /**
   * `AddNewColorSettings` writes `<name>.json` and `SetReadOnly( false )`, so a
   * theme the user made is writable and carries no "(read-only)" — the one
   * thing that tells the two kinds apart in the list.
   */
  it('lists a made theme among the rest, unmarked, in name order', () => {
    const opts = colorThemeOptions([], true, { midnight: { name: 'Midnight' } }, true);
    const names = opts.map(([, n]) => n);
    expect(names).toContain('Midnight');
    expect(names.indexOf('Midnight')).toBeGreaterThan(names.indexOf('KiCad Default (user)'));
  });
});

describe('the name field is FOOTPRINT_NAME_VALIDATOR', () => {
  /**
   * `wxFILTER_EXCLUDE_CHAR_LIST` over `"%$<>\t\n\r\"\\/:"`
   * (`common/validators.cpp:45-53`) — an EXCLUDE list, so a space, a dot and a
   * dash all go through. An allow-list reading would have refused "My Theme".
   */
  it('drops exactly the characters wx refuses, and nothing else', () => {
    expect(filterThemeName('My Theme v1.0-a')).toBe('My Theme v1.0-a');
    for (const c of THEME_NAME_ILLEGAL_CHARS)
      expect(filterThemeName(`a${c}b`), JSON.stringify(c)).toBe('ab');
  });
});

describe('the store keeps what New Theme makes', () => {
  it('reads a theme back, and refuses anything that is not one', () => {
    const themes = normalizeUserThemes({
      midnight: { name: 'Midnight', colors: { wire: 'rgb(1, 2, 3)' }, override: true },
      broken: 'not an object',
      nameless: { colors: {} },
    });
    expect(themes.midnight).toEqual({
      name: 'Midnight',
      colors: { wire: 'rgb(1, 2, 3)' },
      override: true,
    });
    expect(themes.broken).toBeUndefined();
    // A theme with no name falls back to its file stem, which is what the
    // folder would have shown.
    expect(themes.nameless?.name).toBe('nameless');
  });
});

/* --------------------------------------------------------------- the page -- */

function ctxFor(
  eeschema: EeschemaSettings,
  bag: { themes: Record<string, UserColorTheme>; colors: Record<string, string> },
): PrefsContext {
  return {
    eeschema,
    upE: (fn: (s: EeschemaSettings) => void) => fn(eeschema),
    userColors: bag.colors,
    setUserColors: (fn: (c: Record<string, string>) => Record<string, string>) => {
      bag.colors = fn(bag.colors);
    },
    userThemes: bag.themes,
    setUserThemes: (fn: (t: Record<string, UserColorTheme>) => Record<string, UserColorTheme>) => {
      bag.themes = fn(bag.themes);
    },
  } as unknown as PrefsContext;
}

const settingsFor = (theme: string): EeschemaSettings => {
  const s = structuredClone(EESCHEMA_DEFAULTS);
  s.appearance.color_theme = theme;
  return s;
};

/** Open the theme combo and pick the row with this label. */
function chooseTheme(label: string): void {
  const row = [...document.querySelectorAll('.ze-pref-row')].find(
    (r) => r.querySelector('.lbl')?.textContent === 'Theme:',
  );
  fireEvent.click(row?.querySelector('.ze-combo') as HTMLElement);
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (o) => o.textContent === label,
  );
  if (!option) throw new Error(`no theme option "${label}"`);
  fireEvent.mouseDown(option);
}

const nameField = (): HTMLInputElement =>
  document.querySelector('.ze-newprjfolder-body input') as HTMLInputElement;

describe('New Theme..., end to end on the page', () => {
  it('opens the prompt rather than selecting a theme called that', () => {
    const s = settingsFor('user');
    const bag = { themes: {}, colors: {} };
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, bag)} />);
    chooseTheme('New Theme...');
    expect(screen.getByText('Add Color Theme')).toBeTruthy();
    expect(s.appearance.color_theme).toBe('user');
  });

  it('puts the selection back when the separator is picked', () => {
    const s = settingsFor('user');
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, { themes: {}, colors: {} })} />);
    chooseTheme('---');
    expect(s.appearance.color_theme).toBe('user');
    expect(screen.queryByText('Add Color Theme')).toBeNull();
  });

  /**
   * `for( int layer : m_validLayers )
   *      newSettings->SetColor( layer, m_currentSettings->GetColor( layer ) );`
   * — the SELECTED theme's colours, not the defaults. Classic's wire is green
   * where Default's is a darker green, so starting from Classic is visible.
   */
  it('seeds the new theme from the theme that was selected', () => {
    const s = settingsFor('_builtin_classic');
    const bag = { themes: {} as Record<string, UserColorTheme>, colors: {} };
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, bag)} />);
    chooseTheme('New Theme...');
    fireEvent.change(nameField(), { target: { value: 'Midnight' } });
    fireEvent.click(screen.getByText('OK'));

    expect(Object.keys(bag.themes)).toEqual(['Midnight']);
    const made = bag.themes.Midnight as UserColorTheme;
    expect(made.name).toBe('Midnight');
    // Classic's background, which is not Default's.
    expect(made.colors.background).toBe('rgb(255, 255, 255)');
    // …and it becomes the selection.
    expect(s.appearance.color_theme).toBe('Midnight');
  });

  it('refuses a name whose file already exists, and makes nothing', () => {
    const s = settingsFor('user');
    const bag = {
      themes: { Midnight: { name: 'Midnight', colors: {}, override: false } },
      colors: {},
    };
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, bag)} />);
    chooseTheme('New Theme...');
    fireEvent.change(nameField(), { target: { value: 'Midnight' } });
    fireEvent.click(screen.getByText('OK'));
    expect(screen.getByText('Theme already exists!')).toBeTruthy();
    expect(Object.keys(bag.themes)).toEqual(['Midnight']);
    expect(s.appearance.color_theme).toBe('user');
  });

  /** `user.json` is in that folder too, so its stem is taken as well. */
  it('refuses "user", because that file is in the folder', () => {
    const s = settingsFor('user');
    const bag = { themes: {} as Record<string, UserColorTheme>, colors: {} };
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, bag)} />);
    chooseTheme('New Theme...');
    fireEvent.change(nameField(), { target: { value: 'user' } });
    fireEvent.click(screen.getByText('OK'));
    expect(screen.getByText('Theme already exists!')).toBeTruthy();
    expect(bag.themes).toEqual({});
  });

  it('is editable once made, unlike the theme it was seeded from', () => {
    const s = settingsFor('_builtin_default');
    const bag = { themes: {} as Record<string, UserColorTheme>, colors: {} };
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, bag)} />);
    // A built-in's swatches are dead.
    const swatch = (): HTMLButtonElement =>
      document.querySelector('.ze-colorgrid button') as HTMLButtonElement;
    expect(swatch().disabled).toBe(true);

    chooseTheme('New Theme...');
    fireEvent.change(nameField(), { target: { value: 'Midnight' } });
    fireEvent.click(screen.getByText('OK'));
    cleanup();
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, bag)} />);
    expect(swatch().disabled).toBe(false);
  });
});
