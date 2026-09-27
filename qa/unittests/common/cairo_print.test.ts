// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CAIRO_PRINT_CTX` / `CAIRO_PRINT_GAL` (common/gal/cairo/cairo_print.cpp) and
 * `GAL_PRINT::Create` (include/gal/gal_print.h).
 *
 * The page is 100 DPI with 0.01 inch per world unit, so the world scale is the
 * zoom and a paper size in inches is a hundred units an inch. The expected
 * points are `scale * translation * flip * rotate * lookat` (:231) worked by
 * hand for each branch of :213-227.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAIRO_PRINT_GAL } from '@ziroeda/common/gal/cairo/cairo_print.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL_PRINT, type wxDC } from '@ziroeda/common/gal/gal_print.js';
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { fakeCanvas, installSurfaceFactory, paints } from './cairo_test_canvas.js';

function page(aPPI = 100) {
  const canvas = fakeCanvas('page');
  const dc: wxDC = {
    ctx: canvas.ctx,
    image: canvas.image,
    GetSize: () => ({ x: 850, y: 1100 }),
    GetPPI: () => aPPI,
  };
  const print = GAL_PRINT.Create(new GAL_DISPLAY_OPTIONS(), dc);
  const gal = print.GetGAL() as CAIRO_PRINT_GAL;
  gal.SetWorldUnitLength(0.01);
  return { canvas, print, gal };
}

describe('GAL_PRINT::Create', () => {
  it('is a CAIRO_PRINT_GAL on the page, at the page PPI, with native landscape rotation (GTK3)', () => {
    const { print, gal } = page(96);
    expect(gal).toBeInstanceOf(CAIRO_PRINT_GAL);
    expect(print.GetGAL()).toBe(print);
    expect(print.GetPrintCtx().GetNativeDPI()).toBe(96);
    expect(gal.GetScreenDPI()).toBe(96);
    expect(print.GetPrintCtx().HasNativeLandscapeRotation()).toBe(true);
  });

  it('clears to white, with the bounded SOURCE of ClearScreen (cairo_print.cpp:189, cairo_gal.cpp:601-609)', () => {
    const { canvas, gal } = page();
    gal.SetSheetSize({ x: 1, y: 0.5 });
    canvas.log.length = 0;
    gal.BeginDrawing();
    const rect = [['M', 0, 0], ['L', 200, 0], ['L', 200, 100], ['L', 0, 100], ['Z']];
    expect(paints(canvas.log).map((p) => [p.op, p.style, p.path])).toEqual([
      ['destination-out', 'rgba(0, 0, 0, 1)', rect],
      ['lighter', 'rgba(255, 255, 255, 1)', rect],
    ]);
  });
});

describe('CAIRO_PRINT_GAL::SetSheetSize (cairo_print.cpp:246-251)', () => {
  it('is twice the sheet in pixels, each side rounded up', () => {
    const { gal } = page(96);
    gal.SetSheetSize({ x: 8.3, y: 11.7 });
    // ceil( 796.8 ) * 2, ceil( 1123.2 ) * 2
    expect(gal.GetScreenPixelSize()).toEqual({ x: 1594, y: 2248 });
  });
});

describe('CAIRO_PRINT_GAL::ComputeWorldScreenMatrix (cairo_print.cpp:197-236)', () => {
  const at = (
    aPaper: { x: number; y: number },
    aNative: boolean,
    aSetup: (gal: CAIRO_PRINT_GAL) => void = () => {},
  ) => {
    const { gal } = page();
    gal.SetNativePaperSize(aPaper, aNative);
    aSetup(gal);
    gal.ComputeWorldScreenMatrix();
    const p = gal.ToScreen({ x: 10, y: 0 });
    return [Math.round(p.x * 1e9) / 1e9, Math.round(p.y * 1e9) / 1e9];
  };

  it('portrait: centred on the page, not turned', () => {
    // paperSizeIU = ( 1100, 850 ), transposed ( 850, 1100 ): the centre ( 425, 550 )
    expect(at({ x: 8.5, y: 11 }, false)).toEqual([435, 550]);
  });

  it('landscape the platform does not rotate: turned a quarter and centred on the tall page', () => {
    // paperSizeIU = ( 850, 1100 ): ( 10, 0 ) turns to ( 0, 10 ), then + ( 425, 550 )
    expect(at({ x: 11, y: 8.5 }, false)).toEqual([425, 560]);
  });

  it('landscape the platform rotates: centred on the wide page, not turned', () => {
    // transposed ( 1100, 850 ): the centre ( 550, 425 )
    expect(at({ x: 11, y: 8.5 }, true)).toEqual([560, 425]);
  });

  it('zoom scales the whole, and the centre by 1 / zoom first', () => {
    // ( 10 + 425 / 2, 550 / 2 ) * 2
    expect(at({ x: 8.5, y: 11 }, false, (g) => g.SetZoomFactor(2))).toEqual([445, 550]);
  });

  it('landscape turned by the GAL: the flip comes after the turn (flip * rotate)', () => {
    // ( 10, 0 ) turns to ( 0, 10 ); flipping x leaves it; + ( 425, 550 )
    expect(at({ x: 11, y: 8.5 }, false, (g) => g.SetFlip(true, false))).toEqual([425, 560]);
  });

  it('a flip mirrors about the look-at point before the centring', () => {
    expect(at({ x: 8.5, y: 11 }, false, (g) => g.SetFlip(true, false))).toEqual([415, 550]);
  });

  it('is the matrix the drawing uses', () => {
    const { canvas, gal } = page();
    gal.SetNativePaperSize({ x: 11, y: 8.5 }, false);
    gal.BeginDrawing();
    canvas.log.length = 0;
    gal.SetIsStroke(true);
    gal.SetIsFill(false);
    gal.SetLineWidth(0.25);
    gal.DrawLine({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(paints(canvas.log)[0]!.path).toEqual([
      ['M', 425.5, 550.5],
      ['L', 425.5, 560.5],
    ]);
  });
});

describe('CAIRO_PRINT_GAL::Create( options, wxImage, dpi ) (cairo_print.cpp:281-285)', () => {
  let factory: ReturnType<typeof installSurfaceFactory>;

  beforeEach(() => {
    factory = installSurfaceFactory();
  });

  afterEach(() => factory.restore());

  it('draws on an image surface its size, and hands the pixels over when destroyed (:137-181)', () => {
    const image = new WX_IMAGE(2, 1);
    image.SetAlpha();
    image.GetData()!.fill(99); // stale bytes: the transparent pixel must be zeroed, not skipped
    const gal = CAIRO_PRINT_GAL.Create(new GAL_DISPLAY_OPTIONS(), image, 300);
    expect(gal.GetPrintCtx().GetNativeDPI()).toBe(300);

    const [surface] = factory.surfaces;
    expect([surface!.w, surface!.h]).toEqual([2, 1]);

    // a transparent pixel is black and clear; the other is copied
    surface!.canvas.pixels = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 128]);
    gal.destroy();
    expect([...image.GetData()!]).toEqual([0, 0, 0, 40, 50, 60]);
    expect([...image.GetAlpha()!]).toEqual([0, 128]);
  });
});
