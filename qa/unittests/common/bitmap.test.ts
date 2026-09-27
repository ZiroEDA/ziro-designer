// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/bitmap.ts` and `BITMAP_STORE`, and the disabled bitmap: every row
 * of the conversion table is a line of `qa/probes/convert_disabled_probe.cpp`
 * (wxGTK 3.2, this machine) - "brightness r g b -> r g b".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { svgUrl } from '@ziroeda/bitmaps_png';
import {
  GetBitmapStore,
  KiBitmap,
  KiBitmapBundle,
  KiDisabledBitmapBundle,
  KiIconScale,
  KiScaledBitmap,
} from '@ziroeda/common/bitmap.js';
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { describe, expect, it } from 'vitest';

const PROBE: [number, [number, number, number], [number, number, number]][] = [
  [70, [0, 0, 0], [42, 42, 42]],
  [70, [255, 255, 255], [144, 144, 144]],
  [70, [255, 0, 0], [144, 42, 42]],
  [70, [200, 100, 50], [122, 82, 62]],
  [70, [17, 34, 51], [48, 55, 62]],
  [70, [128, 128, 128], [93, 93, 93]],
  [70, [1, 2, 3], [42, 42, 43]],
  [70, [254, 253, 252], [143, 143, 142]],
  [70, [77, 166, 229], [72, 108, 133]],
  [255, [0, 0, 0], [153, 153, 153]],
  [255, [200, 100, 50], [233, 193, 173]],
  [255, [254, 253, 252], [254, 254, 253]],
  [0, [255, 255, 255], [102, 102, 102]],
  [0, [254, 253, 252], [101, 101, 100]],
  [128, [0, 0, 0], [76, 76, 76]],
  [128, [128, 128, 128], [128, 128, 128]],
  [128, [1, 2, 3], [77, 77, 78]],
];

describe('wxImage::ConvertToDisabled', () => {
  it.each(PROBE)('brightness %i: %j -> %j', (brightness, rgb, want) => {
    const img = new WX_IMAGE(1, 1);
    img.GetData()!.set(rgb);

    const out = img.ConvertToDisabled(brightness);

    expect([...out.GetData()!]).toEqual(want);
    expect([...img.GetData()!]).toEqual(rgb); // a copy: the source is kept
  });

  it('defaults to brightness 255, as wx declares it', () => {
    const img = new WX_IMAGE(1, 1);
    expect([...img.ConvertToDisabled().GetData()!]).toEqual([153, 153, 153]);
  });

  it('keeps alpha', () => {
    const img = new WX_IMAGE(1, 1);
    img.SetAlpha();
    img.GetAlpha()![0] = 40;

    expect(img.ConvertToDisabled(70).GetAlpha()![0]).toBe(40);
  });
});

describe('--bitmap-disabled-filter', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../../../common/widgets/shell.css', import.meta.url)),
    'utf8',
  );
  const token = /--bitmap-disabled-filter:\s*brightness\(([\d.]+)\)\s*contrast\(([\d.]+)\);/.exec(
    css,
  );

  it('is ConvertToDisabled( 70 ) as the CSS filter functions compute it', () => {
    expect(token).not.toBeNull();
    const m = Number(token![1]);
    const k = Number(token![2]);

    // Filter Effects 1: brightness is c * m, contrast is c * k + (1 - k) / 2,
    // each on 0..1. wx truncates where a compositor rounds, so within one.
    for (const [, rgb, want] of PROBE.filter((r) => r[0] === 70)) {
      rgb.forEach((c, i) => {
        const out = ((c / 255) * m * k + (1 - k) / 2) * 255;
        expect(Math.abs(out - want[i]!)).toBeLessThan(1);
      });
    }
  });

  it('is what every disabled bitmap button draws with, on the bitmap only', () => {
    for (const sel of ['.ze-tbtn.disabled', '.ze-tbtn:disabled', '.ze-lp-iconbtn:disabled']) {
      const plain = new RegExp(`${sel.replace(/[.:]/g, '\\$&')}[^{>]*\\{([^}]*)\\}`).exec(css);
      expect(plain, sel).not.toBeNull();
      expect(plain![1], `${sel} fades the whole button`).not.toMatch(/opacity|filter/);

      const img = new RegExp(`${sel.replace(/[.:]/g, '\\$&')} > \\*[^{]*\\{([^}]*)\\}`).exec(css);
      expect(img?.[1], `${sel} > *`).toMatch(/filter:\s*var\(--bitmap-disabled-filter\)/);
    }
  });
});

describe('BITMAP_STORE', () => {
  it('answers an id with its SVG, whatever the height', () => {
    expect(KiBitmap(BITMAPS.about)).toBe(svgUrl('toolbar', 'about'));
    expect(KiBitmap(BITMAPS.about, 24)).toBe(KiBitmap(BITMAPS.about));
    expect(KiBitmapBundle(BITMAPS.zoom_in)).toBe(svgUrl('toolbar', 'zoom_in'));
    expect(KiDisabledBitmapBundle(BITMAPS.zoom_in)).toBe(KiBitmapBundle(BITMAPS.zoom_in));
  });

  it('draws a constraint from KiCad’s constraints/ artwork, renamed as CMake does', () => {
    expect(KiBitmap(BITMAPS.constraint_basic_clearance)).toBe(
      svgUrl('toolbar', 'constraint_basic_clearance'),
    );
    expect(svgUrl('toolbar', 'constraint_basic_clearance')).toBeDefined();
  });

  it('draws dummy_item from its own PNG, and a missing id as image-not-found', () => {
    const dummy = KiBitmap(BITMAPS.dummy_item);
    const missing = KiBitmap(BITMAPS.zoom); // no BITMAP_INFO entry in 10.0.5
    const invalid = KiBitmap(BITMAPS.INVALID_BITMAP);

    expect(dummy).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(missing).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(missing).not.toBe(dummy);
    expect(invalid).toBe(missing);
  });

  it('is one store', () => {
    expect(GetBitmapStore()).toBe(GetBitmapStore());
  });
});

describe('KiIconScale', () => {
  const win = (h: number) => ({ GetCharHeight: () => h });

  it('is unity (4) up to 24 px, then 6, 7 and 8', () => {
    expect([18, 24, 25, 29, 30, 34, 35].map((h) => KiIconScale(win(h)))).toEqual([
      4, 4, 6, 6, 7, 7, 8,
    ]);
  });

  it('quantizes to a whole multiple of 4 when asked', () => {
    expect(KiScaledBitmap(BITMAPS.about, win(25)).scale).toBe(6);
    expect(KiScaledBitmap(BITMAPS.about, win(25), -1, true).scale).toBe(8);
    expect(KiScaledBitmap(BITMAPS.about, win(18), -1, true).scale).toBe(4);
  });
});
