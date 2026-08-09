// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The handful of `COLOR4D` operations the painters actually derive colours
 * with (include/gal/color4d.h, common/gal/color4d.cpp).
 *
 * Two places need them, and both were guessing before: `EDIT_POINTS::ViewDraw`
 * derives an edit point's fill and border from `LAYER_AUX_ITEMS` against the
 * canvas background, and `SCH_PAINTER::getRenderColor` drops a *background*
 * layer's alpha when its item is selected. Both are exact formulas upstream, so
 * they are transcribed here rather than approximated at each call site.
 *
 * Colours are held as 0..1 components, as `COLOR4D` does, because every one of
 * these formulas is defined on that range.
 */

export interface Color4d {
  r: number;
  g: number;
  b: number;
  a: number;
}

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
