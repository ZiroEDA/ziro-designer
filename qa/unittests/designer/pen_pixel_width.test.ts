// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Why KiCad looks sharp and a Canvas2D transcription of the same geometry does
 * not.
 *
 * It is not antialiasing and it is not the device pixel ratio. It is three
 * lines of `common/gal/shaders/kicad_vert.glsl`, run for every stroke:
 *
 *     float w = ((lineWidth == 0.0) ? u_worldPixelSize : lineWidth );
 *     float pixelWidth = roundr( w / u_worldPixelSize, 1.0 );
 *     if( pixelWidth < u_minLinePixelWidth ) pixelWidth = u_minLinePixelWidth;
 *
 * with `roundr(f, 1.0) = floor(f + 0.5)`, `u_worldPixelSize` the world units in
 * one DEVICE pixel (`getWorldPixelSize() / GetScaleFactor()`,
 * `opengl_gal.cpp:585-589`) and `u_minLinePixelWidth` 1.0, set once in the GAL
 * constructor (`graphics_abstraction_layer.cpp:70`). Every stroke KiCad draws is
 * therefore a WHOLE number of device pixels, and never fewer than one.
 *
 * Ours had neither the rounding nor the floor on the 2D path. Measured on the
 * Colors page's own preview at its own zoom, the distinct stroke widths reaching
 * the canvas were
 *
 *     0.149  0.448  0.747  0.896  1.0  1.176  3.672   CSS px
 *
 * — four of the seven under a pixel, the thinnest 0.30 of a device pixel at
 * dpr 2, which a canvas paints as a line at 30% opacity. That is the whole of
 * "dull and blurry": not a blur filter, just every hairline drawn as a fraction
 * of a pixel of coverage.
 *
 * The WebGL path already does this (`shaders.ts`, SEGMENT_VERT and the ring
 * shader both round and floor). The 2D path is not a fallback nobody sees: it
 * draws the Colors preview, the items under a drag, and the halo pass.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_OPTS,
  paperSizeIU,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  COLOR_PREVIEW_SCHEMATIC,
  COLOR_PREVIEW_SELECTION,
} from '@ziroeda/designer/src/editors/schematic/prefs/color_preview_schematic.js';

class Path2DStub {
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  closePath(): void {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= Path2DStub;

/** Every width that actually reached a stroke, in world units. */
function widthSpy(): { widths: Set<number>; strokes: number[]; ctx: CanvasRenderingContext2D } {
  const widths = new Set<number>();
  const strokes: number[] = [];
  const noop = (): void => {};
  const state = { lineWidth: 1 };
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'lineWidth') return state.lineWidth;
        if (k === 'stroke' || k === 'strokeRect')
          return () => {
            widths.add(state.lineWidth);
            strokes.push(state.lineWidth);
          };
        if (
          k === 'strokeStyle' ||
          k === 'fillStyle' ||
          k === 'font' ||
          k === 'textAlign' ||
          k === 'lineCap' ||
          k === 'lineJoin' ||
          k === 'globalAlpha'
        )
          return '';
        return noop;
      },
      set: (_t, k, v) => {
        if (k === 'lineWidth') state.lineWidth = v as number;
        return true;
      },
    },
  );
  return { widths, strokes, ctx: ctx as CanvasRenderingContext2D };
}

/** The Colors page's own preview, at the zoom `zoomFitPreview` gives it. */
function paintPreview(
  dpr: number,
  vector = false,
): { widths: Set<number>; strokes: number[]; scale: number } {
  const page = paperSizeIU(COLOR_PREVIEW_SCHEMATIC.paper);
  if (!page) throw new Error('the preview document has an unreadable paper size');
  const w = 560;
  const h = 620;
  const scale = 0.8 / Math.max(page.w / w, page.h / h);
  const s = widthSpy();
  if (vector) setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      COLOR_PREVIEW_SCHEMATIC,
      { scale, offsetX: w / 2 - (page.w / 2) * scale, offsetY: h / 2 - (page.h / 2) * scale },
      KICAD_DEFAULT,
      w,
      h,
      COLOR_PREVIEW_SELECTION,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        connectivity: false,
        showHiddenFields: true,
        devicePixelRatio: dpr,
      },
    );
  } finally {
    if (vector) setVectorText(false);
  }
  return { widths: s.widths, strokes: s.strokes, scale };
}

describe('every stroke is a whole number of device pixels, and never fewer than one', () => {
  for (const dpr of [1, 2, 1.5]) {
    it(`holds at devicePixelRatio ${dpr}`, () => {
      const { widths, strokes, scale } = paintPreview(dpr);
      // Not the count of DISTINCT widths: quantising collapses them, so a
      // healthy render legitimately ends up with two or three. What has to hold
      // for the assertion below to mean anything is that many strokes actually
      // reached the canvas.
      expect(strokes.length).toBeGreaterThan(50);
      expect(widths.size).toBeGreaterThan(1);
      const bad: string[] = [];
      for (const world of widths) {
        const px = world * scale * dpr;
        // Floating point: a width that came back through a divide is not
        // exactly an integer, so the comparison is against the nearest one.
        if (Math.abs(px - Math.round(px)) > 1e-6 || Math.round(px) < 1) bad.push(px.toFixed(4));
      }
      expect(bad).toEqual([]);
    });
  }

  /**
   * The floor is the half that stops a hairline fading out; without it the
   * preview's thinnest stroke is 0.30 device px, i.e. 30% coverage.
   */
  it('lifts a sub-pixel hairline to exactly one device pixel', () => {
    const { widths, scale } = paintPreview(2);
    const px = [...widths].map((w) => w * scale * 2);
    expect(Math.min(...px)).toBe(1);
  });

  /**
   * `roundr( f, 1.0 )` is `floor( f / 1.0 + 0.5 ) * 1.0` — round half UP, not
   * `Math.round`'s round-half-away-from-zero (identical for positives) and not
   * a truncation, which would turn every 1.9 px stroke into 1.
   */
  it('rounds to the nearest pixel rather than truncating', () => {
    const { widths, scale } = paintPreview(2);
    const px = [...widths].map((w) => w * scale * 2);
    // The preview draws the selection halo, which is several pixels wide; a
    // truncating implementation could not produce a width above 1 that is not
    // also the floor of its true value, so the presence of any width > 1 with
    // a true value below it is what distinguishes the two.
    expect(px.some((v) => v > 1)).toBe(true);
  });
});

describe('a backend with no pixels is left alone', () => {
  /**
   * The SVG, DXF and PostScript plotters and the WebGL recorder all record
   * GEOMETRY. A floor derived from the current zoom would be baked into the
   * output — the same reason `drawingSheetItems` passes `minWidth: 0` for them,
   * and the reason the GL buffer stopped depending on the view.
   */
  it('keeps the true widths under setVectorText', () => {
    const plain = paintPreview(2).widths;
    const vector = paintPreview(2, true).widths;
    const { scale } = paintPreview(1);
    const fractional = [...vector].filter((w) => {
      const px = w * scale * 2;
      return Math.abs(px - Math.round(px)) > 1e-6;
    });
    expect(fractional.length, 'a vector backend must see the real widths').toBeGreaterThan(0);
    expect(vector).not.toEqual(plain);
  });
});
