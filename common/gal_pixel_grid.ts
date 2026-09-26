// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GAL's pixel grid: the rule that makes KiCad's canvas look sharp.
 * Counterpart: `common/gal/shaders/kicad_vert.glsl:69-77`, which every stroke
 * KiCad draws passes through.
 *
 *     float w = ((lineWidth == 0.0) ? u_worldPixelSize : lineWidth );
 *     float pixelWidth = roundr( w / u_worldPixelSize, 1.0 );   // floor(f + 0.5)
 *     if( pixelWidth < u_minLinePixelWidth ) pixelWidth = u_minLinePixelWidth;
 *
 * `u_worldPixelSize` is the world units in one **device** pixel and
 * `u_minLinePixelWidth` is 1, set once in the GAL constructor
 * (`graphics_abstraction_layer.cpp:70`). So every stroke covers a whole number
 * of device pixels and never fewer than one — and the vertex shader snaps the
 * endpoints to the same grid, offsetting by half a pixel for an odd width so a
 * one-pixel line lands on a pixel *centre* rather than straddling two columns
 * at half strength each.
 *
 * That straddling is the whole of "why does ours look blurry next to KiCad".
 * A faithful transcription of the geometry is not enough; the quantisation has
 * to come with it.
 *
 * This module exists because the rule had been written out three times — in
 * `renderBoard.ts`, in `origin_viewitem.ts`, and not at all in the PCB editor's
 * point-editor overlay, which is why its handles read soft while the board
 * behind them did not.
 *
 * **Vector backends get none of this.** SVG, DXF, PostScript and the GL
 * recorder record geometry rather than pixels, so a zoom-derived floor would be
 * baked into the output.
 */

/**
 * `roundr( w / u_worldPixelSize, 1.0 )` with the `u_minLinePixelWidth` floor:
 * a width in device pixels rounded to a whole number, never below one.
 */
export function galPenWidth(devicePixels: number): number {
  return Math.max(1, Math.round(devicePixels));
}

/**
 * `roundv`: put a device-space coordinate where a stroke of `width` device
 * pixels lands on whole pixels.
 *
 * An odd width wants a pixel *centre* — canvas strokes straddle the path, so
 * half of an odd width falls either side of a `.5` — and an even one wants a
 * boundary.
 */
export function galSnapPx(v: number, width: number): number {
  return Math.floor(v) + (Math.round(width) % 2 === 1 ? 0.5 : 0);
}
