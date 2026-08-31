// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `(text …)` with no `(justify …)` is CENTRED, both ways.
 *
 * `EDA_TEXT::Format` writes the token only when the item is mirrored or a
 * justification is not the centre:
 *
 *     if( IsMirrored() || GetHorizJustify() != GR_TEXT_H_ALIGN_CENTER
 *                      || GetVertJustify() != GR_TEXT_V_ALIGN_CENTER )
 *         aFormatter->Print( "(justify" );          (common/eda_text.cpp:1100-1106)
 *
 * so the absence of the token means "still EDA_TEXT's own defaults", which are
 * `GR_TEXT_H_ALIGN_CENTER` / `GR_TEXT_V_ALIGN_CENTER`. `SCH_TEXT`'s constructor
 * changes neither (`eeschema/sch_text.cpp:55-65`).
 *
 * We read the absence as left/bottom. Every unjustified plain text therefore
 * hung off the wrong corner of its anchor — visible on the Preferences > Colors
 * preview, where KiCad centres "PLAIN TEXT" inside a notes rectangle and ours
 * started it at the rectangle's middle and ran out the right-hand side.
 *
 * Nothing in the suite moved when this was fixed, which is the finding: the
 * default was never pinned. This pins it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import type { Schematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

/** The anchor, in the millimetres the file format writes. */
const AT_MM = 50;
const SCALE = 0.0005;

/**
 * Every x the PEN reached, in canvas pixels — path moves only, so the
 * background `fillRect` at the origin does not join the run.
 *
 * The stroke font draws each glyph in glyph space under a `translate`/`scale`,
 * so a spy that ignores the transform sees the same numbers for every
 * justification. This one keeps the x half of it — there is no rotation in
 * these documents — which is the whole point: the justification IS the
 * translate.
 */
function penXs(doc: Schematic): number[] {
  const xs: number[] = [];
  let tx = 0;
  let sx = 1;
  const stack: [number, number][] = [];
  const noop = (): void => {};
  const at = (x: number): void => {
    xs.push(tx + sx * x);
  };
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: (a: number, _b: number, _c: number, _d: number, e: number): void => {
      sx = a;
      tx = e;
    },
    translate: (x: number): void => {
      tx += sx * x;
    },
    rotate: noop,
    scale: (k: number): void => {
      sx *= k;
    },
    save: (): void => {
      stack.push([tx, sx]);
    },
    restore: (): void => {
      const p = stack.pop();
      if (p) [tx, sx] = p;
    },
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: at,
    lineTo: at,
    rect: noop,
    arc: noop,
    bezierCurveTo: at,
    fill: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    strokeRect: noop,
    fillRect: noop,
    stroke: noop,
  } as unknown as CanvasRenderingContext2D;

  setVectorText(true);
  try {
    renderSchematic(
      ctx,
      doc,
      { scale: SCALE, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      900,
      600,
      undefined,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        showDrawingSheet: false,
        showPageLimits: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
  } finally {
    setVectorText(false);
  }
  return xs;
}

const doc = (justify: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (text "MMMMMMMM" (at ${AT_MM} ${AT_MM} 0) (uuid "t1")
        (effects (font (size 1.27 1.27))${justify})))`),
  );

/** The anchor in the same canvas pixels the pen positions are in. */
const anchorPx = AT_MM * 10000 * SCALE;

describe('a plain text with no justify token', () => {
  it('straddles its anchor rather than starting at it', () => {
    const xs = penXs(doc(''));
    expect(xs.length).toBeGreaterThan(4);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    expect(lo).toBeLessThan(anchorPx);
    expect(hi).toBeGreaterThan(anchorPx);
    // ...and it is centred, not merely overlapping: the run's midpoint is the
    // anchor to within a stroke width.
    expect(Math.abs((lo + hi) / 2 - anchorPx)).toBeLessThan(1);
  });
});

describe('a plain text that DOES carry one still obeys it', () => {
  it('starts at the anchor when the file says left', () => {
    const xs = penXs(doc(' (justify left)'));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(anchorPx - 1);
    expect(Math.max(...xs)).toBeGreaterThan(anchorPx);
  });

  it('ends at the anchor when the file says right', () => {
    const xs = penXs(doc(' (justify right)'));
    expect(Math.max(...xs)).toBeLessThanOrEqual(anchorPx + 1);
    expect(Math.min(...xs)).toBeLessThan(anchorPx);
  });
});
