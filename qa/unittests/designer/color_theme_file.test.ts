// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A COLOR_SETTINGS file, checked against one KiCad itself wrote.
 *
 * `qa/data/settings/kicad_10_0_5_default_theme.json` is the `user.json` a
 * 10.0.5 install writes into `SETTINGS_MANAGER::GetColorSettingsPath()` the
 * first time it saves a theme — `meta` plus one section per app, every param
 * `Store()` knows. Its `schematic` section is therefore the whole format at
 * once: which keys exist, what each is called, which layer each names, how a
 * colour is spelled, and what the default value of every layer is.
 *
 * Reading the C++ would have got the names; only the file settles the spelling
 * (`rgba(230, 9, 13, 0.800)` — three decimals, computed from the byte, trailing
 * zeros kept) and the defaults. This is the `kicad-cli`-as-oracle habit applied
 * to a settings file: diff against what KiCad wrote, not against what the
 * header says.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COLOR_THEME_SCHEMA_VERSION,
  OVERRIDE_ITEM_COLORS_KEY,
  SCHEMATIC_COLOR_KEYS,
  colorThemeFileText,
  colorThemeFromFile,
  colorThemeToFile,
  type SchLayerId,
} from '@ziroeda/common/src/settings/color_theme_file.js';

const KICAD = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/settings/kicad_10_0_5_default_theme.json'), 'utf8'),
) as { meta: { name: string; version: number }; schematic: Record<string, string | boolean> };

/** What KiCad writes for a theme nobody has changed: every default, verbatim. */
const ours = colorThemeToFile({ name: KICAD.meta.name, colors: {}, override: false }) as {
  meta: { name: string; version: number };
  schematic: Record<string, string | boolean>;
};

describe('the file we write is the file KiCad writes', () => {
  it('names the same keys, in the same order', () => {
    // Order is part of it: nlohmann::json sorts an object's keys, so every
    // theme file on disk is sorted and a hand-built one that is not would read
    // as a different file to anyone diffing two themes.
    expect(Object.keys(ours.schematic)).toEqual(Object.keys(KICAD.schematic));
  });

  it('gives every layer the colour KiCad gives it, spelled the way KiCad spells it', () => {
    expect(ours.schematic).toEqual(KICAD.schematic);
  });

  it('carries meta.name and the schema version', () => {
    expect(ours.meta).toEqual({ name: 'KiCad Default', version: COLOR_THEME_SCHEMA_VERSION });
    expect(COLOR_THEME_SCHEMA_VERSION).toBe(KICAD.meta.version);
  });

  it('is 47 colours and the one flag', () => {
    // `override_item_colors` is a param of the same section, which is why the
    // checkbox belongs to the THEME and not to eeschema's settings.
    expect(SCHEMATIC_COLOR_KEYS).toHaveLength(47);
    expect(Object.keys(KICAD.schematic)).toHaveLength(48);
    expect(KICAD.schematic[OVERRIDE_ITEM_COLORS_KEY]).toBe(false);
  });

  it('leaves the two layers that have never been in a theme file out of it', () => {
    // Neither has a `CLR()` line nor an entry in `s_defaultTheme`, which is why
    // their swatches on the Colors page show the bare checkerboard.
    const layers = new Set(SCHEMATIC_COLOR_KEYS.map(([, layer]) => layer));
    expect(layers.has('LAYER_INTERSHEET_REFS' as SchLayerId)).toBe(false);
    expect(layers.has('LAYER_SHAPES_BACKGROUND' as SchLayerId)).toBe(false);
  });
});

describe('a theme file read back is the theme that was written', () => {
  const edited = {
    name: 'Midnight',
    colors: {
      LAYER_WIRE: 'rgb(1, 2, 3)',
      LAYER_BUS: 'rgba(4, 5, 6, 0.502)',
      LAYER_SCHEMATIC_BACKGROUND: 'rgb(7, 8, 9)',
    } as Partial<Record<SchLayerId, string>>,
    override: true,
  };

  it('round-trips the colours, the name and the flag', () => {
    const back = colorThemeFromFile(colorThemeToFile(edited));
    expect(back?.name).toBe('Midnight');
    expect(back?.override).toBe(true);
    for (const [layer, css] of Object.entries(edited.colors))
      expect(back?.colors[layer as SchLayerId], layer).toBe(css);
  });

  it('fills in every layer the caller left out, because Store() writes them all', () => {
    const back = colorThemeFromFile(colorThemeToFile(edited));
    expect(Object.keys(back?.colors ?? {})).toHaveLength(SCHEMATIC_COLOR_KEYS.length);
    // The default, not the edited neighbour's colour.
    expect(back?.colors.LAYER_JUNCTION).toBe(KICAD.schematic.junction);
  });

  it('re-spells a half-transparent colour the way ToCSSString does', () => {
    // `wxString::FromCDouble( c.Alpha() / 255.0, 3 )` over the QUANTISED alpha:
    // 0.5 becomes the byte 128, and 128/255 prints as 0.502.
    const file = colorThemeToFile({
      name: 'x',
      colors: { LAYER_WIRE: 'rgba(0, 0, 0, 0.5)' },
      override: false,
    }) as { schematic: Record<string, string> };
    expect(file.schematic.wire).toBe('rgba(0, 0, 0, 0.502)');
  });

  it('ends the text on a newline, at nlohmann dump(2)', () => {
    const text = colorThemeFileText({ name: 'x', colors: {}, override: false });
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "schematic": {\n    "anchor": ');
  });
});

describe('a file that is not a theme is refused rather than half-read', () => {
  it('rejects a non-object, an array and a null', () => {
    for (const bad of ['{}', '[]', 'null', '3'])
      expect(colorThemeFromFile(JSON.parse(bad)), bad).toBeNull();
  });

  it('rejects JSON with no schematic section', () => {
    expect(colorThemeFromFile({ meta: { name: 'x' }, board: {} })).toBeNull();
  });

  it('accepts a KiCad file that has other sections too', () => {
    // The vendored fixture carries `board`, `gerbview` and `3d_viewer`; a
    // reader that insisted on knowing every section could not open it.
    const back = colorThemeFromFile(KICAD);
    expect(back?.name).toBe('KiCad Default');
    expect(back?.colors.LAYER_WIRE).toBe(KICAD.schematic.wire);
  });

  it('names the theme "User" when the file has no meta.name', () => {
    expect(colorThemeFromFile({ schematic: { wire: 'rgb(0, 0, 0)' } })?.name).toBe('User');
  });

  it('takes only the keys it knows, and only strings', () => {
    const back = colorThemeFromFile({
      schematic: { wire: 'rgb(0, 0, 0)', nonsense: 'rgb(1, 1, 1)', bus: 7, junction: '' },
    });
    expect(Object.keys(back?.colors ?? {})).toEqual(['LAYER_WIRE']);
  });
});
