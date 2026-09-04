// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A canvas's backing store must be exactly `dpr` times its CSS size.
 *
 * Reported as "the pcb editor flickers a lot when I resize the right or left
 * panels, while eeschema is quite stable". It was not the resize handling and
 * not React: both editors set a width state on every pointermove and both clear
 * their canvases the same way. It was the *measurement*.
 *
 * `PcbEditor` measured with `getBoundingClientRect()`, whose width is a
 * fractional layout value, and wrote a **rounded** backing store behind a
 * **fractional** CSS size. A bitmap `w` device px wide shown in a box that is
 * not exactly `w / dpr` CSS px wide is a non-integer scale, so the browser
 * resamples the whole board on every paint. `SchematicCanvas` measured with
 * `clientWidth`, an integer, and never hit it.
 *
 * `clientWidth` is also the *right box*: it measures the padding box, and these
 * canvases are `position: absolute; inset: 0`, which fills the padding box.
 * `getBoundingClientRect()` includes the border, and `.ze-canvas-wrap` carries
 * the docked pane's bottom border — so the old code also asked for one pixel
 * more height than the canvas had to fill.
 */
import { describe, expect, it } from 'vitest';
import {
  applyCanvasSize,
  backingSizeFor,
  isMeasured,
  type CanvasBackingSize,
} from '@ziroeda/designer/src/ui/canvas_size.js';

/** Does this size force the browser to rescale the bitmap when it paints? */
const resamples = (s: CanvasBackingSize, dpr: number): boolean =>
  s.cssWidth > 0 && Math.abs(s.width / s.cssWidth - dpr) > 1e-9;

describe('the backing store matches the CSS box exactly', () => {
  it.each([1, 2, 3])('at dpr %s, for every width a drag passes through', (dpr) => {
    // A dock drag slides the canvas box through a continuum of layout widths,
    // and `getBoundingClientRect` reports them fractionally. Whole-pixel
    // measurement is what makes the ratio exact at every one of them.
    for (let i = 0; i < 400; i++) {
      const fractional = 900 + i * 0.1;
      expect(resamples(backingSizeFor(fractional, 600, dpr), dpr)).toBe(false);
    }
  });

  it('is what a fractional CSS size would have broken', () => {
    // The defect, stated directly: this is what the old code computed.
    const frac = 900.3;
    const old = { cssWidth: frac, width: Math.round(frac * 1) };
    expect(Math.abs(old.width / old.cssWidth - 1) > 1e-9).toBe(true);
    // …and what the shared helper computes instead.
    expect(resamples(backingSizeFor(frac, 600, 1), 1)).toBe(false);
  });

  it('truncates rather than rounds the CSS size', () => {
    // Rounding *up* would ask for a box larger than the one the element was
    // laid into, and the canvas would be clipped by its parent rather than
    // fitting it. `clientWidth` is already an integer; this only matters for a
    // caller that hands over a measured float.
    expect(backingSizeFor(900.9, 600.9, 1)).toMatchObject({ cssWidth: 900, cssHeight: 600 });
  });
});

describe('a hidden frame', () => {
  it('floors to a 1x1 backing store, so the context stays valid', () => {
    // The editors stay mounted and are toggled with CSS, so a hidden one
    // measures 0 x 0. A zero-width canvas is an error in some browsers and a
    // divide-by-zero in every view transform.
    expect(backingSizeFor(0, 0, 2)).toMatchObject({ width: 1, height: 1 });
  });

  it('but reports itself unmeasured, so nothing fits a view to it', () => {
    // Fitting to 1 x 1 produces a scale and an offset that mean nothing — and
    // recording that fit as done meant the real layout never got one.
    expect(isMeasured(backingSizeFor(0, 0, 2))).toBe(false);
    expect(isMeasured(backingSizeFor(900, 600, 2))).toBe(true);
  });
});

describe('applying a size to the stacked layers', () => {
  const layer = (w = 0, h = 0): HTMLCanvasElement =>
    ({ width: w, height: h, style: {} }) as unknown as HTMLCanvasElement;

  it('touches the backing store only on a real change', () => {
    // Assigning `canvas.width` clears the bitmap even when the value is
    // unchanged. The board editor's effect re-runs whenever the draw options
    // change, so without this guard a left-toolbar toggle blanks the view.
    const size = backingSizeFor(900, 600, 2);
    const c = layer(size.width, size.height);
    let assigned = 0;
    Object.defineProperty(c, 'width', {
      get: () => size.width,
      set: () => {
        assigned++;
      },
    });

    expect(applyCanvasSize([c], size)).toBe(false);
    expect(assigned).toBe(0);
  });

  it('reports a real change, which is the caller’s cache-invalidation signal', () => {
    // The board's crisp raster is viewport-sized, so a size change is what
    // makes it stale.
    expect(applyCanvasSize([layer(100, 100)], backingSizeFor(900, 600, 2))).toBe(true);
  });

  it('sets the CSS size even when the backing store did not move', () => {
    // Two sub-pixel layout widths can round to the same backing store while
    // the element's own box differs; leaving the CSS size behind is how the
    // two drift apart and the resampling comes back.
    const size = backingSizeFor(900, 600, 2);
    const c = layer(size.width, size.height);
    applyCanvasSize([c], size);
    expect(c.style.width).toBe('900px');
    expect(c.style.height).toBe('600px');
  });

  it('skips a layer that is not mounted', () => {
    // The GL and overlay layers mount conditionally.
    expect(() => applyCanvasSize([layer(), null], backingSizeFor(10, 10, 1))).not.toThrow();
  });

  it('sizes every mounted layer alike, since they are one stack', () => {
    // The GL layer's drawing buffer IS the viewport its shaders project into,
    // so a stale size there draws the board at the wrong scale rather than not
    // at all.
    const a = layer();
    const b = layer();
    const size = backingSizeFor(900, 600, 2);
    applyCanvasSize([a, b], size);
    for (const c of [a, b]) {
      expect(c.width).toBe(1800);
      expect(c.height).toBe(1200);
    }
  });
});

describe('the two editors now share one implementation', () => {
  it('neither measures with getBoundingClientRect any more', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const read = (rel: string): string =>
      readFileSync(resolve(process.cwd(), `../designer/src/${rel}`), 'utf8');

    for (const rel of [
      'editors/pcb/PcbEditor.tsx',
      'editors/schematic/components/SchematicCanvas.tsx',
    ]) {
      const src = read(rel);
      expect(src, `${rel} does not use the shared sizer`).toContain('applyCanvasSize');
      // Per occurrence: the moment either sizes a canvas from a fractional
      // rect again, the shimmer comes back in that editor alone — which is
      // exactly how the two drifted apart in the first place.
      expect(src, `${rel} sizes a canvas from a fractional rect`).not.toMatch(
        /getBoundingClientRect\(\)[\s\S]{0,200}?\.(width|height)\s*\*\s*dpr/,
      );
    }
  });
});
