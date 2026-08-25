// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The drawn size of every bitmap the Calculator Tools panels show.
 *
 * ### Why there is a table at all
 *
 * A `wxStaticBitmap` fed by `KiBitmapBundle( BITMAPS::x )` draws at the bundle's
 * natural size, which at 100 % scale is the size of the PNG in
 * `resources/bitmaps_png/png/`. Ours are `<img>`s, and an `<img>` with no width
 * lays out at the SVG's own `width="76mm"` — 287 CSS pixels at 96 dpi, not 288
 * — and reflows the box around it. So the size has to be stated.
 *
 * ### Where the numbers come from
 *
 * **We ship KiCad's own artwork, not a redrawing.** Every file under
 * `assets/calculator/` is byte-identical to
 * `resources/bitmaps_png/sources/dark/<name>.svg`, which is the file KiCad's
 * own build rasterises to produce the PNG. So the PNG's pixel size is a
 * function of the SVG we already have:
 *
 *     px = ceil( mm * 96 / 25.4 )
 *
 * — Inkscape at 96 dpi, rounded up. That holds for all twenty-two sized files
 * with no exceptions, which is why the qa suite can check this table against
 * the SVGs it ships rather than against a screenshot or a remembered number.
 * Five of these were one pixel short before that check existed.
 *
 * One table rather than four: it used to be copied into `panel_transline.tsx`,
 * `panel_rf_attenuators.tsx` and `panel_color_code.tsx`, with `panel_via_size`
 * and `panel_electrical_spacing` writing their one size inline.
 */

/** The dpi KiCad's build rasterises the bitmap sources at. */
export const CALC_ART_DPI = 96;

/** `ceil( mm * dpi / 25.4 )`, the rule the table below follows. */
export const artPixels = (mm: number): number => Math.ceil((mm * CALC_ART_DPI) / 25.4);

/**
 * Bitmap name (the `BITMAPS::` enumerator, and our file's basename) to its
 * drawn size in CSS pixels.
 */
export const CALC_ART_SIZE: Record<string, [number, number]> = {
  // Transmission lines — `m_translineBitmap`, whichever the type carries
  // (transline_dlg_funct.cpp:108), plus the coupled-line helper.
  microstrip: [227, 174],
  c_microstrip: [227, 174],
  stripline: [223, 167],
  coupled_stripline: [322, 167],
  cpw: [227, 167],
  cpw_back: [220, 167],
  rectwaveguide: [265, 163],
  coax: [242, 227],
  twistedpair: [246, 216],
  microstrip_zodd_zeven: [394, 174],
  // RF attenuators — `m_attenuatorBitmap`, `m_SchBitmapName`
  // (attenuators/attenuator_classes.cpp).
  att_pi: [288, 159],
  att_tee: [280, 148],
  att_bridge: [288, 258],
  att_splitter: [295, 121],
  // Via size — `m_viaBitmap`, BITMAPS::viacalc (panel_via_size.cpp:63).
  viacalc: [205, 212],
  // Regulators — regul_3pins or regul (panel_regulator.cpp:104-113).
  regul: [295, 220],
  regul_3pins: [295, 265],
  // Colour code — the six band columns (panel_color_code_base.cpp:45-58).
  color_code_value_and_name: [91, 305],
  color_code_value: [91, 256],
  color_code_multiplier: [91, 305],
  color_code_tolerance: [91, 305],
  // IEC 60664 — the clearance/creepage drawing
  // (panel_electrical_spacing_iec60664_base.cpp).
  creepage_clearance: [227, 167],
};
