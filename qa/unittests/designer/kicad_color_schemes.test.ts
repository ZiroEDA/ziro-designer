// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The colour themes the PCM offers are KiCad's, not ours.
 *
 * Every expectation here is a value read off the files in
 * `pointhi/kicad-color-schemes` at commit `68ea0402` -- the theme JSON, its
 * `metadata.json`, the repository's `packages.json` -- and never off the code
 * under test. The most important one is the least obvious: the real Nord sheet
 * is LIGHT, `rgb(236, 239, 244)`. The theme this replaced said dark, because it
 * was written from the palette's name rather than from the file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_REPOSITORY } from '@ziroeda/designer/src/pcm/defaultRepo.js';
import { KICAD_COLOR_SCHEMES } from '@ziroeda/designer/src/pcm/kicad_color_schemes.js';
import { pcm, pcmThemeId } from '@ziroeda/designer/src/pcm/pcmStore.js';
import { colorThemeOptions } from '@ziroeda/designer/src/dialogs/prefs/ColorThemeChoice.js';
import { resolveThemeById } from '@ziroeda/designer/src/prefs/useSettings.js';
import { PCB_THEMES, themeByFilename } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import { themeFilesFor } from '@ziroeda/designer/src/prefs/theme_files.js';

const DIR = resolve(import.meta.dirname, '../../../designer/src/assets/color_schemes');
const byId = (stem: string) =>
  KICAD_COLOR_SCHEMES.find((p) => p.id === `com.github.pointhi.kicad-color-schemes.${stem}`)!;

afterEach(() => {
  pcm.discardPending();
  for (const p of pcm.installedList()) pcm.uninstall(p.id);
});

describe('the bundled packages are packages.json, read through the PCM schema', () => {
  it('is the seven packages the repository lists, by identifier', () => {
    expect(KICAD_COLOR_SCHEMES.map((p) => p.id)).toEqual([
      'com.github.pointhi.kicad-color-schemes.black-white',
      'com.github.pointhi.kicad-color-schemes.eagle-dark',
      'com.github.pointhi.kicad-color-schemes.nord',
      'com.github.pointhi.kicad-color-schemes.solarized-dark',
      'com.github.pointhi.kicad-color-schemes.solarized-light',
      'com.github.pointhi.kicad-color-schemes.wdark',
      'com.github.pointhi.kicad-color-schemes.wlight',
    ]);
  });

  it('carries each metadata.json field as the file states it', () => {
    const nord = byId('nord');
    expect(nord.name).toBe('Nord Theme');
    expect(nord.description).toBe('Designed by @0xdec');
    expect(nord.author).toEqual({
      name: 'Jordi Pakey-Rodriguez',
      contact: { web: 'https://github.com/jordiorlando' },
    });
    expect(nord.maintainer?.name).toBe('Thomas Pointhuber');
    expect(nord.license).toBe('CC0-1.0');
    expect(nord.kind).toBe('colortheme');
    expect(nord.versions.map((v) => [v.version, v.status, v.kicadVersion])).toEqual([
      ['1.1', 'stable', '5.99'],
    ]);
    // 5.99 is below the app's version, so the one version is installable.
    expect(nord.versions[0]?.compatible).toBe(true);
    expect(byId('wdark').versions[0]?.version).toBe('1.0');
    expect(byId('solarized-dark').versions[0]?.version).toBe('1.2');
  });

  it('is every file in the folder: nothing vendored and forgotten', () => {
    const stems = readdirSync(DIR)
      .filter((f) => f.endsWith('.metadata.json'))
      .map((f) => f.replace(/\.metadata\.json$/, ''))
      .sort();
    expect(stems).toHaveLength(KICAD_COLOR_SCHEMES.length);
    for (const stem of stems) expect(byId(stem)).toBeDefined();
  });

  it('is what the default repository offers as colour themes, and nothing else', () => {
    const themes = DEFAULT_REPOSITORY.packages.filter((p) => p.kind === 'colortheme');
    expect(themes).toEqual(KICAD_COLOR_SCHEMES);
    expect(themes.some((p) => p.id.startsWith('com.ziroeda.theme.'))).toBe(false);
  });
});

describe('the theme is the file, read the way COLOR_SETTINGS reads it', () => {
  it("takes meta.name, which is the chooser's label, not the package name", () => {
    expect(byId('nord').theme?.name).toBe('Nord');
    expect(byId('solarized-dark').theme?.name).toBe('Solarized Dark (Schematic only)');
    expect(byId('black-white').theme?.name).toBe('Black/White (Schematic only)');
  });

  it("the real Nord sheet is light and its board is dark -- the file's numbers", () => {
    const t = byId('nord').theme!;
    expect(t.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(236, 239, 244)');
    expect(t.colors.LAYER_WIRE).toBe('rgb(163, 190, 140)');
    expect(t.colors.LAYER_SCHEMATIC_DRAWINGSHEET).toBe('rgb(59, 66, 82)');
    expect(t.board?.LAYER_PCB_BACKGROUND).toBe('rgb(46, 52, 64)');
    expect(t.board?.F_Cu).toBe('rgb(179, 71, 77)');
    expect(t.board?.In13_Cu).toBe(
      (
        JSON.parse(readFileSync(resolve(DIR, 'nord.json'), 'utf8')) as {
          board: { copper: Record<string, string> };
        }
      ).board.copper.in13,
    );
    expect(t.override).toBe(false);
  });

  it('the dark schematic themes are the ones whose files say so', () => {
    expect(byId('solarized-dark').theme?.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(0, 43, 54)');
    expect(byId('wdark').theme?.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(40, 44, 52)');
    expect(byId('eagle-dark').theme?.colors.LAYER_SCHEMATIC_BACKGROUND).toBe('rgb(33, 33, 33)');
    expect(byId('eagle-dark').theme?.board?.LAYER_PCB_BACKGROUND).toBe('rgb(33, 33, 33)');
  });

  it('a "(Schematic only)" theme has no board section, so it is not written one', () => {
    for (const stem of ['black-white', 'solarized-dark', 'solarized-light', 'wdark', 'wlight']) {
      expect(byId(stem).theme?.board).toBeUndefined();
    }
    for (const stem of ['nord', 'eagle-dark']) expect(byId(stem).theme?.board).toBeDefined();
  });

  it('migrates the version-3 files: page_limits takes the grid colour (3 -> 4)', () => {
    // color_settings.cpp:299-309. The files never name `page_limits`; without
    // the migration every one of them would draw its page edge in
    // s_defaultTheme's grey.
    const nord = byId('nord').theme!;
    expect(nord.colors.LAYER_SCHEMATIC_PAGE_LIMITS).toBe('rgb(76, 86, 106)');
    expect(nord.colors.LAYER_SCHEMATIC_PAGE_LIMITS).toBe(nord.colors.LAYER_SCHEMATIC_GRID);
    expect(nord.board?.LAYER_PAGE_LIMITS).toBe('rgb(216, 222, 233)');
    expect(nord.board?.LAYER_PAGE_LIMITS).toBe(nord.board?.LAYER_GRID);
    const wdark = byId('wdark').theme!;
    expect(wdark.colors.LAYER_SCHEMATIC_PAGE_LIMITS).toBe(wdark.colors.LAYER_SCHEMATIC_GRID);
  });
});

describe('an installed theme reaches every consumer', () => {
  const install = (stem: string) => {
    const p = byId(stem);
    pcm.install(p, 'test');
    return pcmThemeId(p.id);
  };

  it('is listed in the chooser under meta.name, marked read-only, sorted by name', () => {
    install('nord');
    install('solarized-dark');
    const options = colorThemeOptions(pcm.installedThemes(), true);
    // "Nord", not the package's "Nord Theme": the chooser shows
    // `COLOR_SETTINGS::GetName()`, which is the file's `meta.name`.
    expect(options.map(([, label]) => label)).toEqual([
      'KiCad Classic (read-only)',
      'KiCad Default (read-only)',
      'KiCad Default (user)',
      'Nord (read-only)',
      'Solarized Dark (Schematic only) (read-only)',
    ]);
  });

  it('paints the schematic in the file, with default for what the file lacks', () => {
    const id = install('solarized-dark');
    const theme = resolveThemeById(id);
    expect(theme.background).toBe('rgb(0, 43, 54)');
    expect(theme.wire).toBe('rgb(133, 153, 0)');
    // Not in a version-3 file; `aResetIfMissing` puts s_defaultTheme's colour there.
    expect(theme.ruleArea).toBe(resolveThemeById('_builtin_default').ruleArea);
  });

  it('paints the board in the file when it has a board section', () => {
    const id = install('nord');
    const board = themeByFilename(id);
    // pcbnew's compact spelling, which is what this module's palette is in.
    expect(board.name).toBe('Nord');
    expect(board.background).toBe('rgb(46,52,64)');
    expect(board.layerColors['F.Cu']).toBe('rgb(179,71,77)');
    expect(board.layerColors['In13.Cu']).toBe('rgb(194,194,194)');
    expect(board.special.pageLimits).toBe('rgb(216,222,233)');
    expect(board.special.drawingSheet).toBe('rgb(76,86,106)');
  });

  it('and in KiCad Default when it is a schematic-only theme', () => {
    const id = install('wdark');
    const board = themeByFilename(id);
    expect(board.name).toBe('wDark (Schematic only)');
    expect(board.background).toBe(PCB_THEMES[0]!.background);
    expect(board.layerColors).toEqual(PCB_THEMES[0]!.layerColors);
  });

  it('an id nothing knows is KiCad Default, as GetColorSettings falls back', () => {
    expect(themeByFilename('pcm:com.ziroeda.theme.nord')).toBe(PCB_THEMES[0]);
  });

  it('goes back out of the theme folder as the file it came in as', () => {
    install('nord');
    install('wdark');
    const files = themeFilesFor({}, false);
    const nord = files.find(
      (f) => f.fileName === 'com.github.pointhi.kicad-color-schemes.nord.json',
    );
    expect(nord?.writable).toBe(false);
    expect(nord?.contents.board?.LAYER_PCB_BACKGROUND).toBe('rgb(46, 52, 64)');
    const wdark = files.find(
      (f) => f.fileName === 'com.github.pointhi.kicad-color-schemes.wdark.json',
    );
    expect(wdark?.contents.board).toBeUndefined();
  });
});
