// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COLOR4D` — a colour as four normalised components, KiCad's `common/color4d.h`.
 *
 * It lived in `pcbnew/src/plot_dxf.ts` because the DXF plotter was the first
 * thing to need it. The graphics importers need it too, and they are shared
 * between the board and the schematic, so it belongs where both can reach it.
 * `plot_dxf.ts` re-exports it, so nothing that used it there had to change.
 */

export interface Color4d {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const COLOR4D_BLACK: Color4d = { r: 0, g: 0, b: 0, a: 1 };
export const COLOR4D_WHITE: Color4d = { r: 1, g: 1, b: 1, a: 1 };

/**
 * The legacy `EDA_COLOR_T` palette, `colorRefs()` in KiCad's
 * `common/gal/color4d.cpp`. `COLOR4D( EDA_COLOR_T )` looks a colour up here and
 * divides each channel by 255, which is how `s_classicTheme` — written almost
 * entirely in these names — resolves to real colours.
 *
 * Beware `StructColors`: its fields are declared `m_Blue, m_Green, m_Red`, so
 * the C++ initialisers read blue-first. `BLUE` is `{ 132, 0, 0 }` there and
 * means rgb(0, 0, 132). The values below are already in r, g, b order.
 */
const legacyPalette = (r: number, g: number, b: number): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a: 1,
});

/** `colorRefs()`, keyed by `EDA_COLOR_T` name, in the enum's own order. */
export const LEGACY_COLORS = {
  BLACK: legacyPalette(0, 0, 0),
  DARKDARKGRAY: legacyPalette(72, 72, 72),
  DARKGRAY: legacyPalette(132, 132, 132),
  LIGHTGRAY: legacyPalette(194, 194, 194),
  WHITE: legacyPalette(255, 255, 255),
  LIGHTYELLOW: legacyPalette(255, 255, 194),
  LIGHTERORANGE: legacyPalette(255, 229, 191),
  DARKBLUE: legacyPalette(0, 0, 72),
  DARKGREEN: legacyPalette(0, 72, 0),
  DARKCYAN: legacyPalette(0, 72, 72),
  DARKRED: legacyPalette(72, 0, 0),
  DARKMAGENTA: legacyPalette(72, 0, 72),
  DARKBROWN: legacyPalette(72, 72, 0),
  DARKORANGE: legacyPalette(128, 77, 0),
  BLUE: legacyPalette(0, 0, 132),
  GREEN: legacyPalette(0, 132, 0),
  CYAN: legacyPalette(0, 132, 132),
  RED: legacyPalette(132, 0, 0),
  MAGENTA: legacyPalette(132, 0, 132),
  BROWN: legacyPalette(132, 132, 0),
  ORANGE: legacyPalette(204, 102, 0),
  LIGHTBLUE: legacyPalette(0, 0, 194),
  LIGHTGREEN: legacyPalette(0, 194, 0),
  LIGHTCYAN: legacyPalette(0, 194, 194),
  LIGHTRED: legacyPalette(194, 0, 0),
  LIGHTMAGENTA: legacyPalette(194, 0, 194),
  YELLOW: legacyPalette(194, 194, 0),
  LIGHTORANGE: legacyPalette(221, 133, 0),
  PUREBLUE: legacyPalette(0, 0, 255),
  PUREGREEN: legacyPalette(0, 255, 0),
  PURECYAN: legacyPalette(0, 255, 255),
  PURERED: legacyPalette(255, 0, 0),
  PUREMAGENTA: legacyPalette(255, 0, 255),
  PUREYELLOW: legacyPalette(255, 255, 0),
  PUREORANGE: legacyPalette(255, 153, 0),
} as const satisfies Record<string, Color4d>;

/** A legacy `EDA_COLOR_T` enumerator name. */
export type EdaColorName = keyof typeof LEGACY_COLORS;

/**
 * A channel as KiCad renders it, `COLOR4D::ToColour()`:
 * `static_cast<unsigned char>( c * 255 + 0.5 )` — round half up, then clamp.
 */
export const color4dChannel = (c: number): number =>
  Math.max(0, Math.min(255, Math.floor(c * 255 + 0.5)));

/**
 * A `Color4d` as a CSS colour string. Fully opaque colours render as `rgb()`,
 * everything else as `rgba()`, which is what the editors' palettes have always
 * emitted.
 *
 * `separator` exists because the two editors that grew their own copies of this
 * table spell the same colour differently — pcbnew's is `rgb(0,16,35)` and
 * eeschema's is `rgb(245, 244, 239)` — and their tests pin the spelling.
 */
export const toCssColor = (c: Color4d, separator = ','): string => {
  const [r, g, b] = [color4dChannel(c.r), color4dChannel(c.g), color4dChannel(c.b)];
  const rgb = [r, g, b].join(separator);
  return c.a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}${separator}${c.a})`;
};
