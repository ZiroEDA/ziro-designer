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
import { PanelFpColorSettings } from '@ziroeda/designer/src/editors/footprint/prefs/PanelFpColorSettings.js';
import { pcbThemeWithOverrides } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import {
  normalizeUserThemes,
  EESCHEMA_DEFAULTS,
  FPEDIT_DEFAULTS,
} from '@ziroeda/designer/src/prefs/settings.js';
import type {
  EeschemaSettings,
  FpEditSettings,
  UserColorTheme,
} from '@ziroeda/designer/src/prefs/settings.js';
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

/* ------------------------------------------- the same two, on another page -- */

/**
 * `m_btnOpenFolder` and the `New Theme...` row are `PANEL_COLOR_SETTINGS`'
 * (`panel_color_settings.cpp:65-69` and `:122-176`), so EVERY subclass has
 * them. Ours were wired by hand on eeschema's page alone, which left the
 * footprint editor's Colors page with a dead button and a list that stopped at
 * the three themes — the two things Akshay spotted beside a live 10.0.5.
 *
 * The page differs from eeschema's only in namespace: `m_colorNamespace =
 * "board"` (`panel_fp_editor_color_settings.cpp:34`), so a theme made here
 * carries `board.*` keys.
 */
function fpCtxFor(
  fpEdit: FpEditSettings,
  bag: { themes: Record<string, UserColorTheme>; colors: Record<string, string> },
): PrefsContext {
  return {
    fpEdit,
    upFp: (fn: (s: FpEditSettings) => void) => fn(fpEdit),
    eeschema: structuredClone(EESCHEMA_DEFAULTS),
    upE: () => {},
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

const fpSettingsFor = (theme: string): FpEditSettings => {
  const s = structuredClone(FPEDIT_DEFAULTS);
  s.appearance.color_theme = theme;
  return s;
};

const openFolderBtn = (): HTMLButtonElement =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Open Theme Folder',
  ) as HTMLButtonElement;

describe('Footprint Editor > Colors has the base class’ two theme commands', () => {
  it('offers the separator and New Theme, as every subclass does', () => {
    render(
      <PanelFpColorSettings ctx={fpCtxFor(fpSettingsFor('user'), { themes: {}, colors: {} })} />,
    );
    const labels = [...document.querySelectorAll('.ze-combo-ghost')].map((o) => o.textContent);
    expect(labels.slice(-2)).toEqual([THEME_SEPARATOR, NEW_THEME]);
  });

  it('leaves Open Theme Folder live, not greyed', () => {
    render(
      <PanelFpColorSettings ctx={fpCtxFor(fpSettingsFor('user'), { themes: {}, colors: {} })} />,
    );
    expect(openFolderBtn().disabled).toBe(false);
  });

  /**
   * `for( int layer : m_validLayers )
   *      newSettings->SetColor( layer, m_currentSettings->GetColor( layer ) );`
   * — `m_validLayers` here is the board rows, so the seed is keyed `board.*`
   * and not by a schematic layer.
   */
  it('seeds a new theme from the board colours on show', () => {
    const s = fpSettingsFor('user');
    const bag = {
      themes: {} as Record<string, UserColorTheme>,
      colors: { 'board.copper.f': 'rgb(1, 2, 3)' },
    };
    render(<PanelFpColorSettings ctx={fpCtxFor(s, bag)} />);
    chooseTheme('New Theme...');
    fireEvent.change(nameField(), { target: { value: 'Midnight' } });
    fireEvent.click(screen.getByText('OK'));

    const made = bag.themes.Midnight as UserColorTheme;
    expect(made.colors['board.copper.f']).toBe('rgb(1, 2, 3)');
    // A row the user never touched is seeded from `s_defaultTheme`, which is
    // what a fresh COLOR_SETTINGS carries. The spacing is `fpDefaultColor`'s,
    // not the file format's: `colorThemeToFile` re-spells every colour through
    // `COLOR4D::ToCSSString` on the way out, so the stored form need not match
    // the written one.
    expect(made.colors['board.background']).toBe('rgb(0,16,35)');
    expect(s.appearance.color_theme).toBe('Midnight');
  });

  it('is editable once made, unlike the theme it was seeded from', () => {
    const s = fpSettingsFor('_builtin_default');
    const bag = { themes: {} as Record<string, UserColorTheme>, colors: {} };
    render(<PanelFpColorSettings ctx={fpCtxFor(s, bag)} />);
    const swatch = (): HTMLButtonElement =>
      document.querySelector('.ze-colorgrid button') as HTMLButtonElement;
    expect(swatch().disabled).toBe(true);

    chooseTheme('New Theme...');
    fireEvent.change(nameField(), { target: { value: 'Midnight' } });
    fireEvent.click(screen.getByText('OK'));
    cleanup();
    render(<PanelFpColorSettings ctx={fpCtxFor(s, bag)} />);
    expect(swatch().disabled).toBe(false);
  });

  /**
   * `m_currentSettings` is the SELECTED theme's table. A made theme has a file
   * of its own, so its colours are read from there and not from `user.json` —
   * without that the page would list the theme and then show somebody else's
   * palette under it.
   */
  it('shows the made theme’s own colours, not the user theme’s', () => {
    const s = fpSettingsFor('Midnight');
    const bag = {
      themes: {
        Midnight: {
          name: 'Midnight',
          colors: { 'board.copper.f': 'rgb(9, 9, 9)' },
          override: false,
        },
      } as Record<string, UserColorTheme>,
      // A different F.Cu in `user.json`, which is the theme NOT selected.
      colors: { 'board.copper.f': 'rgb(1, 2, 3)' } as Record<string, string>,
    };
    render(<PanelFpColorSettings ctx={fpCtxFor(s, bag)} />);
    // `fpColorRows()`' first row is F.Cu.
    const swatch = document.querySelector('.ze-colorgrid .ze-swatch') as HTMLElement;
    expect(swatch.style.getPropertyValue('--swatch-color')).toBe('rgb(9, 9, 9)');
  });
});

/* ------------------------------------------------- and the canvas follows -- */

/**
 * `FOOTPRINT_EDIT_FRAME::GetColorSettings()` is
 * `::GetColorSettings( GetSettings()->m_ColorTheme )`, and `SETTINGS_MANAGER`
 * hands back the whole `COLOR_SETTINGS` whatever kind of theme it is. A made
 * theme has a file of its own and `SetReadOnly( false )`
 * (`panel_color_settings.cpp:158-160`), so it paints like `user.json` does —
 * resolving it as a built-in would leave the page showing one palette and the
 * canvas drawing another.
 */
describe('a made theme paints the board, not only the swatches', () => {
  it('reads a made theme’s own table', () => {
    const theme = pcbThemeWithOverrides(
      'Midnight',
      { 'board.copper.f': 'rgb(1, 2, 3)' },
      {
        Midnight: {
          colors: { 'board.copper.f': 'rgb(9, 9, 9)', 'board.background': 'rgb(4, 4, 4)' },
        },
      },
    );
    expect(theme.layerColors['F.Cu']).toBe('rgb(9, 9, 9)');
    expect(theme.background).toBe('rgb(4, 4, 4)');
  });

  it('still reads user.json for the writable theme', () => {
    const theme = pcbThemeWithOverrides('user', { 'board.copper.f': 'rgb(1, 2, 3)' }, {});
    expect(theme.layerColors['F.Cu']).toBe('rgb(1, 2, 3)');
  });

  it('leaves a built-in alone, because its file is read-only', () => {
    const plain = pcbThemeWithOverrides('_builtin_classic', {}, {});
    const withOverrides = pcbThemeWithOverrides(
      '_builtin_classic',
      { 'board.copper.f': 'rgb(1, 2, 3)' },
      {},
    );
    expect(withOverrides.layerColors['F.Cu']).toBe(plain.layerColors['F.Cu']);
  });
});
