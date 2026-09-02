// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::SELECTION_AREA` — one preview item, one colour table, and
 * the three things about it that every canvas here had wrong.
 *
 * Upstream it is a single `ViewDraw` (`common/preview_items/selection_area.cpp`)
 * that each editor's tools add to the view. Ours had FOUR partial copies of its
 * table, and the interesting part is that no two were wrong in the same way —
 * which is what a per-file port produces, and why the fix is one module rather
 * than four corrections.
 *
 * The three behaviours pinned here are the ones a screenshot shows and a colour
 * constant does not:
 *
 *  1. the OUTLINE IS DRAWN FIRST and the fill goes over it. Upstream says why
 *     in the source — "draw the fill as the second object so that Z test will
 *     not clamp the single-pixel-wide rectangle sides" — and since the fill is
 *     translucent, doing it the other way round leaves the outline at full
 *     strength instead of tinted. Every canvas did it the other way round.
 *  2. the pen is ONE DEVICE PIXEL, because `SetLineWidth( 0.0 )` lands in
 *     `syncLineWidth`'s `w <= 1.0` branch. The canvases wrote `dpr` or
 *     `1 / scale`, i.e. one LOGICAL pixel — identical at 1x and twice too heavy
 *     on a HiDPI screen.
 *  3. the scheme follows `IsBackgroundDark()`, whose base returns a flat FALSE
 *     and which only three render-settings subclasses override.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SELECTION_COLOR_SCHEME,
  SELECTION_AREA_LINE_WIDTH_PX,
  drawSelectionArea,
  drawSelectionLasso,
  isBackgroundDark,
  lassoIsInside,
  roundOddPen,
  selectionAreaColors,
} from '@ziroeda/common';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** A context that records the order and the arguments, nothing more. */
interface Call {
  op: string;
  style?: string;
  width?: number;
}
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', lineCap: '' };
  const ctx = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    get lineJoin() {
      return state.lineJoin;
    },
    set lineJoin(v: string) {
      state.lineJoin = v;
    },
    get lineCap() {
      return state.lineCap;
    },
    set lineCap(v: string) {
      state.lineCap = v;
    },
    strokeRect: () =>
      calls.push({ op: 'stroke', style: state.strokeStyle, width: state.lineWidth }),
    fillRect: () => calls.push({ op: 'fill', style: state.fillStyle }),
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => calls.push({ op: 'stroke', style: state.strokeStyle, width: state.lineWidth }),
    fill: () => calls.push({ op: 'fill', style: state.fillStyle }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('the two passes, in ViewDraw’s order', () => {
  it('strokes the outline BEFORE filling, so the translucent fill tints it', () => {
    const { ctx, calls } = recorder();
    drawSelectionArea(ctx, 10, 10, 50, 40, { fill: 'rgba(1,2,3,0.3)', stroke: 'rgb(4,5,6)' });
    expect(calls.map((c) => c.op)).toEqual(['stroke', 'fill']);
  });

  it('does the same for a lasso, which is the other arm of drawSelectionShape', () => {
    const { ctx, calls } = recorder();
    drawSelectionLasso(
      ctx,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      { fill: 'rgba(1,2,3,0.3)', stroke: 'rgb(4,5,6)' },
    );
    expect(calls.map((c) => c.op)).toEqual(['stroke', 'fill']);
  });

  it('a lasso of fewer than two points draws nothing at all', () => {
    const { ctx, calls } = recorder();
    drawSelectionLasso(ctx, [{ x: 0, y: 0 }], { fill: 'a', stroke: 'b' });
    expect(calls).toEqual([]);
  });

  it('strokes one DEVICE pixel, not one logical pixel', () => {
    // `gal.SetLineWidth( 0.0 )` -> `syncLineWidth`'s `if( w <= 1.0 ) w = 1.0`
    // and `cairo_set_line_width( …, 1.0 )` in DEVICE units. Writing `dpr` here
    // is the bug: correct at 1x, two device pixels at 2x, where KiCad's band
    // stays a hairline at every scale.
    const { ctx, calls } = recorder();
    drawSelectionArea(ctx, 0, 0, 5, 5, { fill: 'f', stroke: 's' });
    expect(SELECTION_AREA_LINE_WIDTH_PX).toBe(1);
    expect(calls.find((c) => c.op === 'stroke')?.width).toBe(1);
  });
});

describe('roundOddPen', () => {
  it('lands an odd pen on a half-integer, which is what keeps it one pixel', () => {
    // An odd-width stroke is centred on its path, so a path on an integer
    // boundary covers two pixel columns at half alpha each and renders grey.
    expect(roundOddPen(10)).toBe(10.5);
    expect(roundOddPen(10.4)).toBe(10.5);
    expect(roundOddPen(10.6)).toBe(11.5);
    expect(roundOddPen(-3)).toBe(-2.5);
  });
});

describe('selectionColorScheme, all six colours of both', () => {
  it('is KiCad’s table, dark scheme', () => {
    const d = SELECTION_COLOR_SCHEME[0];
    expect(d.normal).toBe('rgba(77, 77, 179, 0.3)');
    expect(d.additive).toBe('rgba(77, 179, 77, 0.3)');
    expect(d.subtract).toBe('rgba(179, 77, 77, 0.3)');
    expect(d.exclusiveOr).toBe('rgba(179, 77, 77, 0.3)');
    expect(d.outlineL2R).toBe('rgb(255, 255, 102)');
    expect(d.outlineR2L).toBe('rgb(102, 102, 255)');
  });

  it('is KiCad’s table, bright scheme', () => {
    const b = SELECTION_COLOR_SCHEME[1];
    expect(b.normal).toBe('rgba(128, 77, 255, 0.5)');
    expect(b.additive).toBe('rgba(128, 255, 128, 0.5)');
    expect(b.subtract).toBe('rgba(255, 128, 128, 0.5)');
    expect(b.exclusiveOr).toBe('rgba(255, 128, 128, 0.5)');
    expect(b.outlineL2R).toBe('rgb(179, 179, 0)');
    expect(b.outlineR2L).toBe('rgb(26, 26, 255)');
  });

  it('picks the scheme by background, and the modifier ladder in ViewDraw’s order', () => {
    const dark = { backgroundDark: true, inside: true };
    expect(selectionAreaColors(dark).fill).toBe(SELECTION_COLOR_SCHEME[0].normal);
    expect(selectionAreaColors({ ...dark, backgroundDark: false }).fill).toBe(
      SELECTION_COLOR_SCHEME[1].normal,
    );
    // additive wins over subtractive, which wins over exclusive-or (:109-116).
    expect(selectionAreaColors({ ...dark, additive: true, subtractive: true }).fill).toBe(
      SELECTION_COLOR_SCHEME[0].additive,
    );
    expect(selectionAreaColors({ ...dark, subtractive: true, exclusiveOr: true }).fill).toBe(
      SELECTION_COLOR_SCHEME[0].subtract,
    );
  });

  it('strokes l2r for an INSIDE drag and r2l otherwise', () => {
    expect(selectionAreaColors({ backgroundDark: true, inside: true }).stroke).toBe(
      SELECTION_COLOR_SCHEME[0].outlineL2R,
    );
    expect(selectionAreaColors({ backgroundDark: true, inside: false }).stroke).toBe(
      SELECTION_COLOR_SCHEME[0].outlineR2L,
    );
  });
});

describe('IsBackgroundDark, and the three overrides', () => {
  it('is COLOR4D::GetBrightness against 0.5', () => {
    // r*0.299 + g*0.587 + b*0.117 (`color4d.h:334-338`).
    expect(isBackgroundDark('rgb(0, 0, 0)')).toBe(true);
    expect(isBackgroundDark('rgb(255, 255, 255)')).toBe(false);
    // Green alone clears 0.5; blue alone does not, at the same 255.
    expect(isBackgroundDark('rgb(0, 255, 0)')).toBe(false);
    expect(isBackgroundDark('rgb(0, 0, 255)')).toBe(true);
  });

  it('the Gerber Viewer asks for the BRIGHT scheme on its black canvas', () => {
    // Not a mistake here: `GERBVIEW_RENDER_SETTINGS` derives straight from
    // `RENDER_SETTINGS` (`gerbview_painter.h:46`) and never overrides
    // `IsBackgroundDark`, whose base returns a flat `false`
    // (`render_settings.h:288-291`). Reasoning from the visible background
    // instead — which is what our dark-scheme constants did — is the more
    // sensible answer and the wrong one.
    const src = read('editors/gerbview/GerberCanvas.tsx');
    expect(src).toMatch(/selectionAreaColors\(\{\s*backgroundDark:\s*false/);
    expect(src, 'gerbview must not derive it from its own background').not.toMatch(
      /isBackgroundDark\(/,
    );
  });
});

describe('the lasso mode follows its winding', () => {
  it('clockwise is a window select and takes the yellow outline', () => {
    // `sch_selection_tool.cpp:2352-2360`: isClockwise = Area( false ) > 0, and
    // clockwise is INSIDE_LASSO. In a y-down world a positive shoelace sum is
    // clockwise on screen.
    const cw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(lassoIsInside(cw)).toBe(true);
    expect(lassoIsInside([...cw].reverse())).toBe(false);
  });

  it('a mirrored view flips it, and a degenerate one is not flipped', () => {
    // `if( getView()->IsMirroredX() && shapeArea != 0 ) isClockwise = !isClockwise;`
    const cw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(lassoIsInside(cw, true)).toBe(false);
    // Zero area: the guard means it is NOT flipped, so it stays whatever
    // `> 0` said of it, which is false.
    const flat = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(lassoIsInside(flat, true)).toBe(false);
    expect(lassoIsInside(flat, false)).toBe(false);
  });
});

describe('there is one copy of the table', () => {
  const CANVASES = [
    'editors/gerbview/GerberCanvas.tsx',
    'editors/drawingsheet/DrawingSheetCanvas.tsx',
    'editors/symbol/SymbolCanvas.tsx',
    'editors/footprint/FootprintCanvas.tsx',
    'editors/schematic/components/SchematicCanvas.tsx',
  ];

  it('no canvas writes a selection colour of its own', () => {
    // Every literal that was in one of the four copies. Matching the VALUES
    // rather than the constant names is what makes this survive a rename.
    const literals = [
      'rgba(128, 77, 255',
      'rgba(128, 255, 128',
      'rgba(255, 128, 128',
      'rgb(179, 179, 0)',
      'rgb(26, 26, 255)',
      'rgb(255 255 102)',
      'rgb(77 77 179',
      'rgba(120,170,255',
      'rgba(120,255,150',
    ];
    for (const rel of CANVASES) {
      const src = read(rel);
      for (const lit of literals) expect(src, `${rel} still writes ${lit}`).not.toContain(lit);
    }
  });

  it('every canvas draws the band through the shared item', () => {
    for (const rel of CANVASES) {
      const src = read(rel);
      expect(src, rel).toMatch(/drawSelectionArea\(|drawSelectionLasso\(/);
      // A canvas that still sets these around a band is painting one by hand.
      expect(src, `${rel} still hand-rolls the band`).not.toMatch(
        /(?:ctx|octx)\.lineWidth = (?:dpr|Math\.max\(1, dpr\)|1 \/ vp\.scale);\s*\n\s*const x = Math\.min/,
      );
    }
  });
});
