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

/** An 8-bit RGB triple, the range `wxColour` works in. */
export type Rgb8 = readonly [number, number, number];

/**
 * `wxColourBase::AlphaBlend`, src/common/colourcmn.cpp: the blend is done in
 * doubles and the result is TRUNCATED by the cast to `unsigned char`, not
 * rounded. That one detail is why `ChangeLightness( 78 )` of skyblue's green
 * channel is 160 and not 161 — 206 * 0.78 = 160.68.
 */
const alphaBlend = (fg: number, bg: number, alpha: number): number =>
  Math.trunc(Math.max(0, Math.min(255, bg + alpha * (fg - bg))));

/**
 * `wxColourBase::ChangeLightness`, src/common/colourcmn.cpp.
 *
 * `ialpha` runs 0..200 with 100 meaning "unchanged": below 100 the colour is
 * blended toward black, above 100 toward white by the COMPLEMENT
 * (`200 - ialpha`), so 125 lands a quarter of the way to white and 40 keeps
 * two fifths of the original.
 *
 * KiCad leans on this in several places that must agree with each other — the
 * four BITMAP_BUTTON states are `wxSYS_COLOUR_HIGHLIGHT.ChangeLightness()` at
 * 40/50/20 (bitmap_button.cpp:270-310), and the E-series display darkens its
 * seven column colours by 78 and alternates every merged block at 125
 * (panel_eseries_display.cpp:120-146). It lives here so there is one of it.
 */
export const changeLightness = (rgb: Rgb8, ialpha: number): Rgb8 => {
  if (ialpha === 100) return rgb;
  const toWhite = ialpha > 100;
  const bg = toWhite ? 255 : 0;
  const alpha = (toWhite ? 200 - ialpha : ialpha) / 100;
  return [
    alphaBlend(rgb[0], bg, alpha),
    alphaBlend(rgb[1], bg, alpha),
    alphaBlend(rgb[2], bg, alpha),
  ];
};

/** `wxColour( 0xBBGGRR )` — the byte order the E-series table is written in. */
export const rgbFromBgrHex = (bgr: number): Rgb8 => [
  bgr & 0xff,
  (bgr >> 8) & 0xff,
  (bgr >> 16) & 0xff,
];

/** An `Rgb8` as CSS. */
export const rgb8ToCss = (c: Rgb8): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// ---------------------------------------------------------------------------
// COLOR4D's operations
//
// Moved here from `designer/src/render/color4d.ts`, which declared a SECOND
// `Color4d` interface with the same four fields and held the arithmetic half of
// the same class. Upstream there is one COLOR4D — `include/gal/color4d.h` and
// `common/gal/color4d.cpp` carry the names, the conversions AND Brightened,
// Darkened, Inverted, WithAlpha, Distance and GetBrightness together — and a
// painter in `common/` cannot reach a module in `designer/`, which is what
// forced the split to be noticed.
// ---------------------------------------------------------------------------
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Parse the CSS forms the themes are written in: `#rgb`, `#rrggbb`,
 * `rgb(r, g, b)` and `rgba(r, g, b, a)`. Anything else comes back opaque black,
 * which is visible rather than silently invisible.
 */
export function parseColor4d(css: string): Color4d {
  const s = css.trim();
  const fn = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1]!.split(/[,/\s]+/).filter((p) => p.length > 0);
    const chan = (p: string | undefined): number =>
      p === undefined
        ? 0
        : p.endsWith('%')
          ? clamp01(Number.parseFloat(p) / 100)
          : clamp01(Number.parseFloat(p) / 255);
    return {
      r: chan(parts[0]),
      g: chan(parts[1]),
      b: chan(parts[2]),
      a: parts[3] === undefined ? 1 : clamp01(Number.parseFloat(parts[3])),
    };
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const h = hex[1]!;
    const wide = h.length > 4;
    const n = wide ? 2 : 1;
    const at = (i: number): number => {
      const part = h.slice(i * n, i * n + n);
      if (part.length === 0) return 1;
      return clamp01(Number.parseInt(wide ? part : part + part, 16) / 255);
    };
    return { r: at(0), g: at(1), b: at(2), a: h.length === 4 || h.length === 8 ? at(3) : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function toCss(c: Color4d): string {
  const ch = (v: number): number => Math.round(clamp01(v) * 255);
  return c.a >= 1
    ? `rgb(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)})`
    : `rgba(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)}, ${Math.round(clamp01(c.a) * 1000) / 1000})`;
}

/** `COLOR4D::Distance`: the *squared* RGB distance, alpha ignored. */
export const distance = (a: Color4d, b: Color4d): number =>
  (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;

/** `COLOR4D::GetBrightness`: the weighted W3C formula, with KiCad's coefficients. */
export const brightness = (c: Color4d): number => c.r * 0.299 + c.g * 0.587 + c.b * 0.117;

/** `COLOR4D::Inverted`: alpha is kept. */
export const inverted = (c: Color4d): Color4d => ({ r: 1 - c.r, g: 1 - c.g, b: 1 - c.b, a: c.a });

/** `COLOR4D::Brightened`: mix towards white by `f`. */
export const brightened = (c: Color4d, f: number): Color4d => ({
  r: c.r * (1 - f) + f,
  g: c.g * (1 - f) + f,
  b: c.b * (1 - f) + f,
  a: c.a,
});

/** `COLOR4D::Darkened`: scale towards black by `f`. */
export const darkened = (c: Color4d, f: number): Color4d => ({
  r: c.r * (1 - f),
  g: c.g * (1 - f),
  b: c.b * (1 - f),
  a: c.a,
});

export const withAlpha = (c: Color4d, a: number): Color4d => ({ ...c, a: clamp01(a) });

/** The same, straight from and back to CSS, for callers holding theme strings. */
export const cssWithAlpha = (css: string, a: number): string =>
  toCss(withAlpha(parseColor4d(css), a));

/** Whether a CSS colour is fully transparent, i.e. there is nothing to draw. */
export const isTransparent = (css: string): boolean => parseColor4d(css).a <= 0;

export interface EditPointColors {
  /** The square's fill (`drawColor`). */
  fill: string;
  /** Its border when idle. */
  border: string;
  /** Its border while hovered or being dragged. */
  highlight: string;
}

/**
 * `EDIT_POINTS::ViewDraw`'s colour derivation, verbatim:
 *
 *     COLOR4D drawColor = settings->GetLayerColor( LAYER_AUX_ITEMS );
 *     // Don't assume LAYER_AUX_ITEMS is always a good choice.  Compare with background.
 *     if( aView->GetGAL()->GetClearColor().Distance( drawColor ) < 0.5 )
 *         drawColor.Invert();
 *     ...
 *     if( brightness > 0.5 )       border = drawColor.Darkened( 0.7 ).WithAlpha( 0.8 );
 *     else if( brightness > 0.2 )  border = drawColor.Brightened( 0.4 ).WithAlpha( 0.8 );
 *     else                         border = drawColor.Brightened( 0.7 ).WithAlpha( 0.8 );
 *
 * `LAYER_SCHEMATIC_AUX_ITEMS` is black in both builtin themes, so on a normal
 * light sheet this gives a *black* square with a pale grey border. The canvas
 * had it the other way round — a white square with a dark border — which is
 * what made the handles read as heavy dark boxes.
 */
export function editPointColors(auxItemsCss: string, backgroundCss: string): EditPointColors {
  const background = parseColor4d(backgroundCss);
  let draw = parseColor4d(auxItemsCss);
  if (distance(background, draw) < 0.5) draw = inverted(draw);

  const bright = brightness(draw);
  const [borderC, highlightC] =
    bright > 0.5
      ? [darkened(draw, 0.7), darkened(draw, 0.5)]
      : bright > 0.2
        ? [brightened(draw, 0.4), brightened(draw, 0.3)]
        : [brightened(draw, 0.7), brightened(draw, 0.5)];

  return {
    fill: toCss(draw),
    border: toCss(withAlpha(borderC, 0.8)),
    highlight: toCss(withAlpha(highlightC, 0.8)),
  };
}

/**
 * `SCH_PAINTER::getRenderColor`'s alpha for a *background* layer
 * (LAYER_DEVICE_BACKGROUND, LAYER_NOTES_BACKGROUND, LAYER_SHAPES_BACKGROUND,
 * LAYER_SHEET_BACKGROUND):
 *
 *     if( aItem->IsBrightened() ) { ... else if( isBackgroundLayer( aLayer ) ) color = color.WithAlpha( 0.2 ); }
 *     else if( aItem->IsSelected() && isBackgroundLayer( aLayer ) )
 *         // "Selected items will be painted over all other items, so make backgrounds
 *         //  translucent so that non-selected overlapping objects are visible"
 *         color = color.WithAlpha( 0.5 );
 *
 * `WithAlpha` *replaces* the alpha — `return COLOR4D( r, g, b, aAlpha )` — it
 * does not scale it. So a half-transparent background comes out **more** opaque
 * when selected, not less. This used to return a multiplier the callers applied
 * to the colour's own alpha, which is the same number only for a fully opaque
 * one and quietly wrong for every other. It takes the colour's alpha now so
 * there is nothing left to multiply.
 */
export function backgroundLayerAlpha(
  ownAlpha: number,
  selected: boolean,
  brightenedItem: boolean,
): number {
  return backgroundLayerAlphaOverride(selected, brightenedItem) ?? ownAlpha;
}

/**
 * The same rule for a caller that has many shapes and one selection state: the
 * alpha every background shape is forced to, or null when the item is neither
 * brightened nor selected and each shape keeps the alpha of its own colour.
 */
export function backgroundLayerAlphaOverride(
  selected: boolean,
  brightenedItem: boolean,
): number | null {
  if (brightenedItem) return 0.2;
  return selected ? 0.5 : null;
}

/**
 * `COLOR4D::ToHSV` (`common/gal/color4d.cpp:387-438`).
 *
 * Hue in degrees, saturation and value in 0..1. `alwaysDefineHue` is upstream's
 * second parameter: with it false a greyscale colour reports `NaN` for hue, so
 * a caller can tell "no hue" from "red"; DIALOG_COLOR_PICKER passes true when
 * it reads a typed hex back, because a spin control has to show a number.
 */
export function toHSV(
  c: Color4d,
  alwaysDefineHue = false,
): { hue: number; sat: number; val: number } {
  const min = Math.min(c.r, c.g, c.b);
  const max = Math.max(c.r, c.g, c.b);
  const delta = max - min;
  const noHue = alwaysDefineHue ? 0 : Number.NaN;

  // "for black color (r = g = b = 0) saturation is set to 0."
  if (max <= 0) return { hue: noHue, sat: 0, val: max };

  const sat = delta / max;

  if (delta === 0) return { hue: noHue, sat, val: max };

  let hue: number;

  if (c.r >= max) hue = (c.g - c.b) / delta;
  else if (c.g >= max) hue = 2.0 + (c.b - c.r) / delta;
  else hue = 4.0 + (c.r - c.g) / delta;

  hue *= 60.0;
  if (hue < 0.0) hue += 360.0;

  return { hue, sat, val: max };
}

/** `COLOR4D::FromHSV` (`color4d.cpp:441-511`). Alpha is untouched, as upstream. */
export function fromHSV(hue: number, sat: number, val: number, a = 1): Color4d {
  if (sat <= 0.0) return { r: val, g: val, b: val, a };

  let hh = hue;
  while (hh >= 360.0) hh -= 360.0;
  hh /= 60.0;

  const i = Math.trunc(hh);
  const ff = hh - i;

  const p = val * (1.0 - sat);
  const q = val * (1.0 - sat * ff);
  const t = val * (1.0 - sat * (1.0 - ff));

  switch (i) {
    case 0:
      return { r: val, g: t, b: p, a };
    case 1:
      return { r: q, g: val, b: p, a };
    case 2:
      return { r: p, g: val, b: t, a };
    case 3:
      return { r: p, g: q, b: val, a };
    case 4:
      return { r: t, g: p, b: val, a };
    default:
      return { r: val, g: p, b: q, a };
  }
}

/**
 * `COLOR4D::ToHexString` (`color4d.cpp:215-223`) — `#RRGGBBAA`, upper case, and
 * the alpha byte is ALWAYS written, even when it is `FF`.
 */
export function toHexString(c: Color4d): string {
  const b = (v: number): string =>
    Math.round(v * 255.0)
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
  return `#${b(c.r)}${b(c.g)}${b(c.b)}${b(c.a)}`;
}

/**
 * `COLOR4D::SetFromHexString` (`color4d.cpp:180-212`), which returns false for
 * anything it will not parse rather than throwing — the picker keeps the old
 * colour while a half-typed string is in the field.
 *
 * The length rules are upstream's and are not the same on both sides: under 7
 * characters is refused outright, 9 or more reads an alpha byte, and anything
 * between takes alpha 1. So `#ABC` is NOT a colour here, though CSS says it is.
 */
export function setFromHexString(text: string): Color4d | null {
  const str = text.trim();

  if (str.length < 7 || !str.startsWith('#')) return null;

  // `wxSscanf( … "%lx" … )`: hexadecimal, and anything after the digits is
  // ignored rather than refused.
  const m = /^[0-9a-f]+/i.exec(str.slice(1));
  if (!m) return null;

  const tmp = Number.parseInt(m[0], 16);

  if (str.length >= 9) {
    return {
      r: ((tmp >>> 24) & 0xff) / 255,
      g: ((tmp >>> 16) & 0xff) / 255,
      b: ((tmp >>> 8) & 0xff) / 255,
      a: (tmp & 0xff) / 255,
    };
  }

  return {
    r: ((tmp >>> 16) & 0xff) / 255,
    g: ((tmp >>> 8) & 0xff) / 255,
    b: (tmp & 0xff) / 255,
    a: 1.0,
  };
}
