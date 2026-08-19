// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KiCad's built-in colour themes, `common/settings/builtin_color_themes.h`.
 *
 * The point of the shared table is that one wrong channel anywhere in it is
 * caught, so most of what follows is a fingerprint over every entry rather
 * than a spot check: a spot check on 40 of 487 colours is exactly the state
 * this module was written to replace. The named cases below it exist so that a
 * failure says which layer, and they are the ones with something to get wrong
 * — an alpha, a legacy name resolved through a blue-first struct, a `.7` that
 * rounds up.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CLASSIC_THEME,
  BUILTIN_DEFAULT_THEME,
  BUILTIN_THEMES,
  color4dChannel,
  type Color4d,
  COPPER_LOOP_COLORS,
  LEGACY_COLORS,
  toCssColor,
  USER_LOOP_COLORS,
} from '@ziroeda/common';

/** Every entry as `LAYER: rgb(...)`, sorted — a one-channel edit moves a line. */
const fingerprint = (theme: Readonly<Record<string, Color4d>>): string =>
  Object.entries(theme)
    .map(([layer, color]) => `${layer}=${toCssColor(color)}`)
    .sort()
    .join('\n');

/** A crude but sufficient digest; any single character change moves it. */
const digest = (s: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = ((h1 ^ s.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + s.charCodeAt(i) * (i + 1)) * 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}-${h2.toString(16)}`;
};

describe('the ported table is complete', () => {
  it('carries every entry of both maps', () => {
    // s_defaultTheme and s_classicTheme, counted in the 10.0.5 header.
    expect(Object.keys(BUILTIN_DEFAULT_THEME)).toHaveLength(246);
    expect(Object.keys(BUILTIN_CLASSIC_THEME)).toHaveLength(241);
    expect(COPPER_LOOP_COLORS).toHaveLength(7);
    expect(USER_LOOP_COLORS).toHaveLength(4);
    expect(Object.keys(LEGACY_COLORS)).toHaveLength(35); // NBCOLORS
  });

  it('classic covers every layer default does, bar the five it genuinely omits', () => {
    const missing = Object.keys(BUILTIN_DEFAULT_THEME).filter((k) => !(k in BUILTIN_CLASSIC_THEME));
    // s_classicTheme sets no schematic page-limits colour and stops at
    // gerbview layer 59, where the default theme goes to 63.
    expect(missing.sort()).toEqual([
      'GERBVIEW_LAYER_ID_START+60',
      'GERBVIEW_LAYER_ID_START+61',
      'GERBVIEW_LAYER_ID_START+62',
      'GERBVIEW_LAYER_ID_START+63',
      'LAYER_SCHEMATIC_PAGE_LIMITS',
    ]);
    // And nothing the default theme has never heard of.
    expect(Object.keys(BUILTIN_CLASSIC_THEME).filter((k) => !(k in BUILTIN_DEFAULT_THEME))).toEqual(
      [],
    );
  });

  it('every colour is in range and every alpha is meaningful', () => {
    for (const theme of [BUILTIN_DEFAULT_THEME, BUILTIN_CLASSIC_THEME]) {
      for (const [layer, c] of Object.entries(theme as Record<string, Color4d>)) {
        for (const [chan, v] of Object.entries(c))
          expect(v, `${layer}.${chan}`).toBeGreaterThanOrEqual(0);
        for (const [chan, v] of Object.entries(c))
          expect(v, `${layer}.${chan}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has not drifted from the header', () => {
    // Regenerate with ziro-colortheme-gen.py and diff before touching these.
    expect(digest(fingerprint(BUILTIN_DEFAULT_THEME))).toMatchInlineSnapshot(`"7bf93904-1cbd3400"`);
    expect(digest(fingerprint(BUILTIN_CLASSIC_THEME))).toMatchInlineSnapshot(`"9af4059c-67ccea80"`);
  });
});

describe('the built-in themes', () => {
  it('are the two CreateBuiltinColorSettings() returns, in its order', () => {
    expect(BUILTIN_THEMES.map((t) => t.filename)).toEqual(['_builtin_default', '_builtin_classic']);
    expect(BUILTIN_THEMES.map((t) => t.name)).toEqual(['KiCad Default', 'KiCad Classic']);
  });

  it('resolves s_defaultTheme CSS_COLOR entries exactly', () => {
    const d = BUILTIN_DEFAULT_THEME;
    expect(toCssColor(d.LAYER_SCHEMATIC_BACKGROUND)).toBe('rgb(245,244,239)');
    expect(toCssColor(d.LAYER_PCB_BACKGROUND)).toBe('rgb(0,16,35)');
    expect(toCssColor(d.LAYER_WIRE)).toBe('rgb(0,150,0)');
    expect(toCssColor(d.F_Cu)).toBe('rgb(200,52,52)');
    expect(toCssColor(d.B_Cu)).toBe('rgb(77,127,196)');
    expect(toCssColor(d.LAYER_PINNUM)).toBe('rgb(169,0,0)');
    expect(toCssColor(d.LAYER_HIERLABEL)).toBe('rgb(114,86,0)');
  });

  it('keeps the alphas rather than flattening them', () => {
    const d = BUILTIN_DEFAULT_THEME;
    expect(toCssColor(d.LAYER_DNP_MARKER)).toBe('rgba(220,9,13,0.85)');
    expect(toCssColor(d.LAYER_EXCLUDED_FROM_SIM)).toBe('rgba(194,194,194,0.95)');
    expect(toCssColor(d.LAYER_RATSNEST)).toBe('rgba(0,248,255,0.35)');
    expect(toCssColor(d.B_Mask)).toBe('rgba(2,255,238,0.4)');
    // A wholly transparent colour is still rgba, not rgb.
    expect(toCssColor(d.LAYER_SHEET_BACKGROUND)).toBe('rgba(255,255,255,0)');
    expect(toCssColor(d.LAYER_NOTES_BACKGROUND)).toBe('rgba(0,0,0,0)');
  });

  it('takes the non-Mac branch of the one #ifdef in the header', () => {
    // COLOR4D( .4, .7, 1.0, 0.8 ); the __WXMAC__ branch would be .3/.7/1.0/0.6.
    for (const theme of [BUILTIN_DEFAULT_THEME, BUILTIN_CLASSIC_THEME])
      expect(theme.LAYER_SELECTION_SHADOWS).toEqual({ r: 0.4, g: 0.7, b: 1.0, a: 0.8 });
  });

  it('reads LAYER_CONFLICTS_SHADOW as decimal 5, not the header octal 05', () => {
    // The header writes CSS_COLOR( 255, 0, 05, 0.5 ); in C++ `05` is octal 5.
    expect(toCssColor(BUILTIN_DEFAULT_THEME.LAYER_CONFLICTS_SHADOW)).toBe('rgba(255,0,5,0.5)');
  });

  it('resolves s_classicTheme through the legacy palette', () => {
    const c = BUILTIN_CLASSIC_THEME;
    expect(toCssColor(c.LAYER_PCB_BACKGROUND)).toBe('rgb(0,0,0)'); // BLACK
    expect(toCssColor(c.LAYER_SCHEMATIC_BACKGROUND)).toBe('rgb(255,255,255)'); // WHITE
    expect(toCssColor(c.F_Cu)).toBe('rgb(132,0,0)'); // RED, not PURERED
    expect(toCssColor(c.B_Cu)).toBe('rgb(0,132,0)'); // GREEN
    expect(toCssColor(c.In1_Cu)).toBe('rgb(194,194,0)'); // YELLOW
    expect(toCssColor(c.LAYER_HIERLABEL)).toBe('rgb(132,132,0)'); // BROWN
    expect(toCssColor(c.LAYER_DRAWINGSHEET)).toBe('rgb(72,0,0)'); // DARKRED
    // The two that were transcribed wrong before the table was shared.
    expect(toCssColor(c.LAYER_ERC_EXCLUSION)).toBe('rgb(194,194,194)'); // LIGHTGRAY, not CSS lightgray
    expect(toCssColor(c.LAYER_RULE_AREAS)).toBe('rgb(132,0,0)'); // RED, not 255,0,0
  });

  it('applies .WithAlpha() on top of a legacy colour', () => {
    expect(toCssColor(BUILTIN_CLASSIC_THEME.LAYER_DNP_MARKER)).toBe('rgba(255,0,0,0.85)');
    expect(toCssColor(BUILTIN_CLASSIC_THEME.LAYER_ERC_ERR)).toBe('rgba(255,0,0,0.8)');
    expect(toCssColor(BUILTIN_CLASSIC_THEME.LAYER_ERC_WARN)).toBe('rgba(0,255,0,0.8)');
    // COLOR4D( UNSPECIFIED_COLOR ) is transparent black, not opaque black.
    expect(BUILTIN_CLASSIC_THEME.LAYER_NOTES_BACKGROUND).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('does not swap two layers that share a colour in one theme', () => {
    // Several layers happen to agree in the default theme, which is exactly
    // what lets a swap go unnoticed; these disagree in at least one theme.
    expect(toCssColor(BUILTIN_DEFAULT_THEME.LAYER_PIN)).toBe('rgb(132,0,0)');
    expect(toCssColor(BUILTIN_DEFAULT_THEME.LAYER_PINNAM)).toBe('rgb(0,100,100)');
    expect(toCssColor(BUILTIN_CLASSIC_THEME.LAYER_PINNUM)).toBe('rgb(132,0,0)');
    expect(toCssColor(BUILTIN_CLASSIC_THEME.LAYER_PINNAM)).toBe('rgb(0,132,132)');
    expect(toCssColor(BUILTIN_DEFAULT_THEME.LAYER_GRID)).toBe('rgb(132,132,132)');
    expect(toCssColor(BUILTIN_DEFAULT_THEME.LAYER_GRID_AXES)).toBe('rgb(194,194,194)');
    expect(toCssColor(BUILTIN_DEFAULT_THEME.LAYER_SCHEMATIC_GRID)).toBe('rgb(181,181,181)');
    expect(toCssColor(BUILTIN_DEFAULT_THEME.LAYER_SCHEMATIC_GRID_AXES)).toBe('rgb(0,0,132)');
  });

  it('keeps the copper and user loop palettes distinct and in order', () => {
    // color_settings.cpp indexes these by layer % length for layers past the
    // ones the theme names, so their ORDER is load-bearing.
    expect(COPPER_LOOP_COLORS.map((c) => toCssColor(c))).toEqual([
      'rgb(237,124,51)',
      'rgb(91,195,235)',
      'rgb(247,111,142)',
      'rgb(167,165,198)',
      'rgb(40,204,217)',
      'rgb(232,178,167)',
      'rgb(242,237,161)',
    ]);
    expect(USER_LOOP_COLORS.map((c) => toCssColor(c))).toEqual([
      'rgb(89,148,220)',
      'rgb(180,219,210)',
      'rgb(216,200,82)',
      'rgb(194,194,194)',
    ]);
  });
});

describe('the legacy EDA_COLOR_T palette (colorRefs)', () => {
  it('undoes StructColors’ blue-first field order', () => {
    // { m_Blue, m_Green, m_Red, ... }: BLUE is written { 132, 0, 0 } upstream.
    expect(toCssColor(LEGACY_COLORS.BLUE)).toBe('rgb(0,0,132)');
    expect(toCssColor(LEGACY_COLORS.RED)).toBe('rgb(132,0,0)');
    expect(toCssColor(LEGACY_COLORS.PURERED)).toBe('rgb(255,0,0)');
    expect(toCssColor(LEGACY_COLORS.PUREBLUE)).toBe('rgb(0,0,255)');
    expect(toCssColor(LEGACY_COLORS.BROWN)).toBe('rgb(132,132,0)');
    expect(toCssColor(LEGACY_COLORS.YELLOW)).toBe('rgb(194,194,0)');
    expect(toCssColor(LEGACY_COLORS.PUREYELLOW)).toBe('rgb(255,255,0)');
    expect(toCssColor(LEGACY_COLORS.PURECYAN)).toBe('rgb(0,255,255)');
    expect(toCssColor(LEGACY_COLORS.LIGHTYELLOW)).toBe('rgb(255,255,194)');
    expect(toCssColor(LEGACY_COLORS.ORANGE)).toBe('rgb(204,102,0)');
    expect(toCssColor(LEGACY_COLORS.LIGHTORANGE)).toBe('rgb(221,133,0)');
    expect(toCssColor(LEGACY_COLORS.LIGHTERORANGE)).toBe('rgb(255,229,191)');
    expect(toCssColor(LEGACY_COLORS.DARKORANGE)).toBe('rgb(128,77,0)');
  });

  it('has KiCad’s LIGHTGRAY, which is not CSS lightgray', () => {
    expect(toCssColor(LEGACY_COLORS.LIGHTGRAY)).toBe('rgb(194,194,194)');
    expect(toCssColor(LEGACY_COLORS.DARKGRAY)).toBe('rgb(132,132,132)');
    expect(toCssColor(LEGACY_COLORS.DARKDARKGRAY)).toBe('rgb(72,72,72)');
  });

  it('is opaque throughout', () => {
    for (const [name, c] of Object.entries(LEGACY_COLORS)) expect(c.a, name).toBe(1);
  });
});

describe('toCssColor / color4dChannel (COLOR4D::ToColour)', () => {
  it('rounds half up, as (unsigned char)( c * 255 + 0.5 ) does', () => {
    expect(color4dChannel(0.7)).toBe(179); // 178.5, not truncated to 178
    expect(color4dChannel(0.4)).toBe(102);
    expect(color4dChannel(0.5)).toBe(128); // 127.5
    expect(color4dChannel(0)).toBe(0);
    expect(color4dChannel(1)).toBe(255);
  });

  it('clamps rather than wrapping', () => {
    expect(color4dChannel(-1)).toBe(0);
    expect(color4dChannel(2)).toBe(255);
  });

  it('round-trips an 8-bit channel exactly', () => {
    for (let v = 0; v <= 255; v++) expect(color4dChannel(v / 255)).toBe(v);
  });

  it('emits rgb() only when fully opaque', () => {
    expect(toCssColor({ r: 1, g: 0, b: 0, a: 1 })).toBe('rgb(255,0,0)');
    expect(toCssColor({ r: 1, g: 0, b: 0, a: 0.5 })).toBe('rgba(255,0,0,0.5)');
  });

  it('honours the separator both editors’ palettes are spelled with', () => {
    const c = { r: 1, g: 0.5, b: 0, a: 0.5 };
    expect(toCssColor(c)).toBe('rgba(255,128,0,0.5)');
    expect(toCssColor(c, ', ')).toBe('rgba(255, 128, 0, 0.5)');
  });
});
