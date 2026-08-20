// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's default colours — `s_defaultTheme` in
 * `common/settings/builtin_color_themes.h`, which is the table
 * `COLOR_SETTINGS`' constructor reads to seed every `gerbview.*` colour
 * (`common/settings/color_settings.cpp:103-121`).
 *
 * This file used to hold an invented palette: sixteen made-up hexes
 * (`#D02020`, `#20A020`, …) that appear nowhere upstream, a `#DDDDDD` for
 * DCodes, a `#0F0F1A` for negative objects, and a permanent 0.8 alpha. None of
 * it was KiCad's. CLAUDE.md's rule for this case is explicit — a table KiCad
 * hardcodes is *data*, it stays local, "but must mirror KiCad's own table
 * rather than our invention".
 *
 * ---------------------------------------------------------------------------
 * THE LAYER CYCLE
 * ---------------------------------------------------------------------------
 *
 * `s_defaultTheme` carries **64** gerbview drawing-layer entries,
 * `GERBVIEW_LAYER_ID_START + 0` through `+ 63`
 * (`builtin_color_themes.h:91-154`), and every one of them is the fourteen
 * below repeated — index 14 is index 0 again, and it holds without exception
 * for all 64. Alpha is 1 throughout.
 *
 * `s_classicTheme` is a *different* table further down the same file
 * (`:310` onward) whose gerbview rows are named COLOR4D constants — MAGENTA,
 * BROWN, LIGHTGRAY. It is not what a stock install shows and is not mirrored
 * here.
 */

/**
 * `s_defaultTheme`'s gerbview layer colours, the fourteen distinct values in
 * upstream's own order (`builtin_color_themes.h:91-104`).
 *
 * [data] KiCad's own table, transcribed. Not a palette to like or dislike.
 */
export const GERBER_LAYER_COLORS: readonly string[] = [
  'rgb(200, 52, 52)', // [data] GERBVIEW_LAYER_ID_START + 0, builtin_color_themes.h:91
  'rgb(127, 200, 127)', // [data] GERBVIEW_LAYER_ID_START + 1, builtin_color_themes.h:92
  'rgb(206, 125, 44)', // [data] GERBVIEW_LAYER_ID_START + 2, builtin_color_themes.h:93
  'rgb(79, 203, 203)', // [data] GERBVIEW_LAYER_ID_START + 3, builtin_color_themes.h:94
  'rgb(219, 98, 139)', // [data] GERBVIEW_LAYER_ID_START + 4, builtin_color_themes.h:95
  'rgb(167, 165, 198)', // [data] GERBVIEW_LAYER_ID_START + 5, builtin_color_themes.h:96
  'rgb(40, 204, 217)', // [data] GERBVIEW_LAYER_ID_START + 6, builtin_color_themes.h:97
  'rgb(232, 178, 167)', // [data] GERBVIEW_LAYER_ID_START + 7, builtin_color_themes.h:98
  'rgb(242, 237, 161)', // [data] GERBVIEW_LAYER_ID_START + 8, builtin_color_themes.h:99
  'rgb(141, 203, 129)', // [data] GERBVIEW_LAYER_ID_START + 9, builtin_color_themes.h:100
  'rgb(237, 124, 51)', // [data] GERBVIEW_LAYER_ID_START + 10, builtin_color_themes.h:101
  'rgb(91, 195, 235)', // [data] GERBVIEW_LAYER_ID_START + 11, builtin_color_themes.h:102
  'rgb(247, 111, 142)', // [data] GERBVIEW_LAYER_ID_START + 12, builtin_color_themes.h:103
  'rgb(77, 127, 196)', // [data] GERBVIEW_LAYER_ID_START + 13, builtin_color_themes.h:104
];

/**
 * How many drawing layers the default theme actually names.
 *
 * `GERBER_DRAWLAYERS_COUNT` is `PCB_LAYER_ID_COUNT`, 128
 * (`include/layer_ids.h:519,171`), but `s_defaultTheme` stops at 64. The
 * constructor skips the rest with a trace — "Missing default color for gerbview
 * layer %d" (`color_settings.cpp:113-118`) — and `COLOR_SETTINGS::GetColor`
 * answers `COLOR4D::UNSPECIFIED` for a layer it has no entry for (`:402-408`).
 * So layers 64..127 genuinely have no default colour upstream. That is KiCad's
 * own gap, recorded rather than filled in.
 */
export const GERBER_DEFAULT_THEME_LAYERS = 64;

/**
 * The colour GerbView gives drawing layer `i`.
 *
 * Upstream this is a lookup, not a modulo: the table lists all 64 entries
 * explicitly. The modulo is how those 64 entries were *written*, and it gives
 * the identical answer for every index the table defines.
 */
export function defaultLayerColor(i: number): string {
  return GERBER_LAYER_COLORS[i % GERBER_LAYER_COLORS.length] as string;
}

/* ---------------------------------------------------------------------------
   The seven gerbview-specific layers, `color_settings.cpp:103-109`.
   Each value is its `s_defaultTheme` row.
   --------------------------------------------------------------------------- */

/** LAYER_GERBVIEW_BACKGROUND. [data] CSS_COLOR( 0, 0, 0, 1 ), `:84`. */
export const GERBER_BG_COLOR = 'rgb(0, 0, 0)';

/** LAYER_GERBVIEW_AXES. [data] CSS_COLOR( 0, 0, 132, 1 ), `:83`. */
export const GERBER_AXES_COLOR = 'rgb(0, 0, 132)';

/** LAYER_DCODES. [data] CSS_COLOR( 255, 255, 255, 1 ), `:85`. Ours said #DDDDDD. */
export const GERBER_DCODE_COLOR = 'rgb(255, 255, 255)';

/** LAYER_GERBVIEW_GRID. [data] CSS_COLOR( 132, 132, 132, 1 ), `:86` — DARKGRAY. */
export const GERBER_GRID_COLOR = 'rgb(132, 132, 132)';

/**
 * LAYER_NEGATIVE_OBJECTS. [data] CSS_COLOR( 132, 132, 132, 1 ), `:87`, and the
 * same DARKGRAY that `GBR_DISPLAY_OPTIONS`' constructor gives
 * `m_NegativeDrawColor` (`gerbview/gbr_display_options.h:57`). Ours had
 * `#0F0F1A`, a near-black that made the "ghost" invisible against the
 * background it was supposed to stand out from.
 */
export const GERBER_NEGATIVE_COLOR = 'rgb(132, 132, 132)';

/** LAYER_GERBVIEW_DRAWINGSHEET. [data] CSS_COLOR( 0, 0, 132, 1 ), `:88`. */
export const GERBER_DRAWINGSHEET_COLOR = 'rgb(0, 0, 132)';

/** LAYER_GERBVIEW_PAGE_LIMITS. [data] CSS_COLOR( 132, 132, 132, 1 ), `:89`. */
export const GERBER_PAGE_LIMITS_COLOR = 'rgb(132, 132, 132)';

/** LAYER_CURSOR, read by GERBVIEW_PAINTER (`gerbview/gerbview_painter.h:95`). */
export const GERBER_CURSOR_COLOR = 'rgb(255, 255, 255)';

/**
 * `m_OpacityModeAlphaValue`, the alpha a layer takes **only** while
 * `toggleForceOpacityMode` is on (`gerbview/gbr_display_options.h:61`, applied
 * at `gerbview_painter.cpp:65-66`).
 *
 * Outside that mode a layer keeps the theme's own alpha, which is 1 for all 64
 * rows. We used to composite every layer at a permanent 0.8 — a value with no
 * upstream source, always on, which is both the wrong number and the wrong
 * behaviour.
 */
export const GERBER_OPACITY_MODE_ALPHA = 0.6;

/* ---------------------------------------------------------------------------
   COLOR4D arithmetic
   --------------------------------------------------------------------------- */

/** Parse `rgb(r, g, b)` / `#rrggbb` into 0..255 channels. */
function channels(color: string): [number, number, number] | null {
  const rgb = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return null;
}

/**
 * `COLOR4D::Brightened( aFactor )` (`include/gal/color4d.h:269-275`):
 *
 *     r * ( 1.0 - aFactor ) + aFactor
 *
 * per channel, on 0..1 components, with alpha untouched. It is a lerp towards
 * white, not a multiply, so a dark colour brightens far more than a light one.
 */
export function brightened(color: string, factor: number): string {
  const c = channels(color);
  if (!c) return color;
  const f = Math.min(Math.max(factor, 0), 1);
  const lerp = (v: number): number => Math.round((v / 255) * (1 - f) * 255 + f * 255);
  return `rgb(${lerp(c[0])}, ${lerp(c[1])}, ${lerp(c[2])})`;
}

/**
 * The colour a highlighted item takes: `m_layerColorsHi`, which
 * `GERBVIEW_RENDER_SETTINGS::LoadColors` fills with `baseColor.Brightened( 0.5 )`
 * (`gerbview/gerbview_painter.cpp:70`) and `GetColor` returns for a net,
 * component or attribute match (`:135-147`).
 *
 * It is the **layer's own colour** brightened, so a highlighted item still
 * reads as belonging to its layer. Ours painted every highlight flat white.
 */
export function highlightedLayerColor(layerColor: string): string {
  return brightened(layerColor, 0.5);
}

/**
 * `m_layerColorsSel`, `baseColor.Brightened( 0.8 )` — a *selected* item, which
 * is a stronger lift than a highlighted one (`gerbview_painter.cpp:71`).
 */
export function selectedLayerColor(layerColor: string): string {
  return brightened(layerColor, 0.8);
}
