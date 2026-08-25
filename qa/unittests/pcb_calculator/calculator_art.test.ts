// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Calculator Tools artwork, and the size it is drawn at.
 *
 * We do not redraw these. Every file under `designer/src/assets/calculator/` is
 * byte-identical to `resources/bitmaps_png/sources/dark/<name>.svg` — the file
 * KiCad's own build rasterises to make `resources/bitmaps_png/png/<name>_dark.png`,
 * which is what a `wxStaticBitmap` fed by `KiBitmapBundle` draws at 100 % scale.
 * So the PNG's pixel size is a function of the SVG we already ship:
 *
 *     px = ceil( mm * 96 / 25.4 )
 *
 * Inkscape at 96 dpi, rounded up. That is checked below against every entry of
 * `CALC_ART_SIZE`, and it holds for all twenty-two with no exceptions. Five of
 * them were one pixel short before this test existed, and one pixel on a
 * `<img>` moves the box around it.
 *
 * An `<img>` with no width lays the SVG out at its own `width="76mm"`, which is
 * 287 CSS pixels rather than 288 — which is why the size has to be stated at
 * all rather than left to the browser.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  artPixels,
  CALC_ART_DPI,
  CALC_ART_SIZE,
} from '@ziroeda/designer/src/editors/calculator/art_sizes.js';

const ASSETS = fileURLToPath(new URL('../../../designer/src/assets/calculator/', import.meta.url));

/**
 * The size the document root declares, in pixels.
 *
 * Two of KiCad's source families state it differently and both are honoured
 * rather than normalised: the drawings are Inkscape millimetre documents
 * (`width="76mm"`), and the four colour-code strips are plain pixel documents
 * (`width="91"`) whose numbers already ARE the PNG's. Anything else — a root
 * with no size at all, which the two toolbar arrows have — is not a panel
 * bitmap and returns null.
 */
function svgPixels(name: string): { w: number; h: number } | null {
  // The root element only; `slice` would run into the artwork's own <rect>s.
  const src = readFileSync(`${ASSETS}${name}.svg`, 'utf8');
  const root = src.slice(0, src.indexOf('>', src.indexOf('<svg')));
  const w = /\bwidth="([\d.]+)(mm)?"/.exec(root);
  const h = /\bheight="([\d.]+)(mm)?"/.exec(root);
  if (!w || !h) return null;
  const scale = (m: RegExpExecArray): number =>
    m[2] === 'mm' ? artPixels(Number(m[1])) : Number(m[1]);
  return { w: scale(w), h: scale(h) };
}

describe('every drawn size follows from the SVG we ship', () => {
  it('rasterises at 96 dpi', () => {
    expect(CALC_ART_DPI).toBe(96);
    // 76 mm is att_pi's, and 287.24 rounds UP to 288 — the pixel the four
    // attenuators and the via drawing were each missing.
    expect(artPixels(76)).toBe(288);
    expect(artPixels(54)).toBe(205);
  });

  for (const [name, [w, h]] of Object.entries(CALC_ART_SIZE)) {
    it(`${name} is ${w}x${h}`, () => {
      const px = svgPixels(name);
      expect(px, `${name}.svg declares no size`).not.toBeNull();
      expect([px?.w, px?.h]).toStrictEqual([w, h]);
    });
  }

  /**
   * The two 16x16 arrows are `STD_BITMAP_BUTTON` icons — the Analyze /
   * Synthesize buttons on Transmission Lines and the Calculate button on RF
   * Attenuators (panel_transline_base.cpp, panel_rf_attenuators_base.cpp). A
   * button sizes its own bitmap; only a `wxStaticBitmap` is drawn at the
   * bundle's natural size, and only those belong in the table.
   */
  const BUTTON_ICONS = ['small_up', 'small_down'];

  it('sizes every panel bitmap we ship, and nothing we do not', () => {
    // A file with no entry draws at the browser's idea of its size, which is
    // one pixel short; an entry with no file draws at 0x0.
    const shipped = readdirSync(ASSETS)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice(0, -4))
      .filter((n) => svgPixels(n) !== null && !BUTTON_ICONS.includes(n))
      .sort();
    expect(Object.keys(CALC_ART_SIZE).sort()).toStrictEqual(shipped);
  });
});
