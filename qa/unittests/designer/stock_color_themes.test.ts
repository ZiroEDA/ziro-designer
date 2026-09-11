// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The stock colours directory holds KiCad's themes, not ours.
 *
 * Every expectation here is a value read off the files in
 * `pointhi/kicad-color-schemes` at commit `68ea0402` -- never off the code
 * under test. The most important one is the least obvious: the real Nord
 * sheet is LIGHT, `rgb(236, 239, 244)`. The theme this replaced said dark,
 * because it was written from the palette's name rather than from the file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_REPOSITORY } from '@ziroeda/designer/src/pcm/defaultRepo.js';
import {
  STOCK_COLOR_THEMES,
  colorSettingsById,
  colorSettingsList,
  stockThemeId,
} from '@ziroeda/designer/src/prefs/color_settings_list.js';
import { colorThemeOptions } from '@ziroeda/designer/src/dialogs/prefs/ColorThemeChoice.js';
import {
  overrideItemColorsFor,
  resolveThemeById,
} from '@ziroeda/designer/src/prefs/useSettings.js';
import { PCB_THEMES, themeByFilename } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import { themeFilesFor } from '@ziroeda/designer/src/prefs/theme_files.js';

const DIR = resolve(import.meta.dirname, '../../../designer/src/assets/color_schemes');
const stock = (stem: string) => STOCK_COLOR_THEMES.find((t) => t.id === stockThemeId(stem))!;

describe('the stock directory is the seven files, read as COLOR_SETTINGS reads them', () => {
  it('is every file in the folder, under its stem: nothing vendored and forgotten', () => {
    const stems = readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    expect(stems).toEqual([
      'black-white',
      'eagle-dark',
      'nord',
      'solarized-dark',
      'solarized-light',
      'wdark',
      'wlight',
    ]);
    expect(STOCK_COLOR_THEMES.map((t) => t.id).sort()).toEqual(stems.map(stockThemeId));
  });

  it('is named by meta.name, which is what the chooser shows', () => {
    expect(stock('nord').name).toBe('Nord');
    expect(stock('solarized-dark').name).toBe('Solarized Dark (Schematic only)');
    expect(stock('black-white').name).toBe('Black/White (Schematic only)');
  });

  it("the real Nord sheet is light and its board is dark -- the file's numbers", () => {
    const t = stock('nord').theme;
    expect(t.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(236, 239, 244)');
    expect(t.colors.LAYER_WIRE).toBe('rgb(163, 190, 140)');
    expect(t.colors.LAYER_SCHEMATIC_DRAWINGSHEET).toBe('rgb(59, 66, 82)');
    expect(t.board?.LAYER_PCB_BACKGROUND).toBe('rgb(46, 52, 64)');
    expect(t.board?.F_Cu).toBe('rgb(179, 71, 77)');
    const file = JSON.parse(readFileSync(resolve(DIR, 'nord.json'), 'utf8')) as {
      board: { copper: Record<string, string> };
    };
    expect(t.board?.In13_Cu).toBe(file.board.copper.in13);
    expect(t.override).toBe(false);
  });

  it('the dark schematic themes are the ones whose files say so', () => {
    expect(stock('solarized-dark').theme.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(0, 43, 54)');
    expect(stock('wdark').theme.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(40, 44, 52)');
    expect(stock('eagle-dark').theme.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(33, 33, 33)');
    expect(stock('eagle-dark').theme.board?.LAYER_PCB_BACKGROUND).toBe('rgb(33, 33, 33)');
  });

  it('a "(Schematic only)" theme has no board section', () => {
    for (const stem of ['black-white', 'solarized-dark', 'solarized-light', 'wdark', 'wlight']) {
      expect(stock(stem).theme.board, stem).toBeUndefined();
    }
    for (const stem of ['nord', 'eagle-dark']) expect(stock(stem).theme.board).toBeDefined();
  });

  it('migrates the version-3 files: page_limits takes the grid colour (3 -> 4)', () => {
    // color_settings.cpp:299-309. The files never name `page_limits`; without
    // the migration every one of them would draw its page edge in
    // s_defaultTheme's grey.
    const nord = stock('nord').theme;
    expect(nord.colors.LAYER_SCHEMATIC_PAGE_LIMITS).toBe('rgb(76, 86, 106)');
    expect(nord.colors.LAYER_SCHEMATIC_PAGE_LIMITS).toBe(nord.colors.LAYER_SCHEMATIC_GRID);
    expect(nord.board?.LAYER_PAGE_LIMITS).toBe('rgb(216, 222, 233)');
    expect(nord.board?.LAYER_PAGE_LIMITS).toBe(nord.board?.LAYER_GRID);
    const wdark = stock('wdark').theme;
    expect(wdark.colors.LAYER_SCHEMATIC_PAGE_LIMITS).toBe(wdark.colors.LAYER_SCHEMATIC_GRID);
  });

  it('the default repository offers no colour themes: they are stock, not packages', () => {
    expect(DEFAULT_REPOSITORY.packages.some((p) => p.kind === 'colortheme')).toBe(false);
  });
});

describe('a stock theme reaches every consumer without a manager', () => {
  it('is in the list with nothing installed', () => {
    expect(colorSettingsList().map((t) => t.id)).toEqual(STOCK_COLOR_THEMES.map((t) => t.id));
  });

  it('is in the chooser under meta.name, marked read-only, sorted by name', () => {
    const options = colorThemeOptions(colorSettingsList(), true);
    expect(options.map(([, label]) => label)).toEqual([
      'Black/White (Schematic only) (read-only)',
      'Eagle Dark (read-only)',
      'KiCad Classic (read-only)',
      'KiCad Default (read-only)',
      'KiCad Default (user)',
      'Nord (read-only)',
      'Solarized Dark (Schematic only) (read-only)',
      'Solarized Light (Schematic only) (read-only)',
      'wDark (Schematic only) (read-only)',
      'wLight (Schematic only) (read-only)',
    ]);
    expect(options.find(([, label]) => label === 'Nord (read-only)')?.[0]).toBe('stock:nord');
  });

  it('paints the schematic in the file, with default for what the file lacks', () => {
    const theme = resolveThemeById(stockThemeId('solarized-dark'));
    expect(theme.background).toBe('rgb(0, 43, 54)');
    expect(theme.wire).toBe('rgb(133, 153, 0)');
    // Not in a version-3 file; `aResetIfMissing` puts s_defaultTheme's colour there.
    expect(theme.ruleArea).toBe(resolveThemeById('_builtin_default').ruleArea);
    // Read-only, so `override_item_colors` is the file's false, never the page's.
    expect(overrideItemColorsFor(stockThemeId('solarized-dark'))).toBe(false);
  });

  it('paints the board in the file when it has a board section', () => {
    // pcbnew's compact spelling, which is what this module's palette is in.
    const board = themeByFilename(stockThemeId('nord'));
    expect(board.name).toBe('Nord');
    expect(board.background).toBe('rgb(46,52,64)');
    expect(board.layerColors['F.Cu']).toBe('rgb(179,71,77)');
    expect(board.layerColors['In13.Cu']).toBe('rgb(194,194,194)');
    expect(board.special.pageLimits).toBe('rgb(216,222,233)');
    expect(board.special.drawingSheet).toBe('rgb(76,86,106)');
  });

  it('and in KiCad Default when it is a schematic-only theme', () => {
    const board = themeByFilename(stockThemeId('wdark'));
    expect(board.name).toBe('wDark (Schematic only)');
    expect(board.background).toBe(PCB_THEMES[0]!.background);
    expect(board.layerColors).toEqual(PCB_THEMES[0]!.layerColors);
  });

  it('an id nothing knows is KiCad Default, as GetColorSettings falls back', () => {
    expect(colorSettingsById('pcm:com.ziroeda.theme.nord')).toBeUndefined();
    expect(themeByFilename('pcm:com.ziroeda.theme.nord')).toBe(PCB_THEMES[0]);
  });

  it("is not in the user's theme folder: Open Theme Folder is GetColorSettingsPath()", () => {
    expect(themeFilesFor({}, false).map((f) => f.fileName)).toEqual(['user.json']);
  });
});
