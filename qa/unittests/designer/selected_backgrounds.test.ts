// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Selecting something makes its *background* translucent.
 *
 * `SCH_PAINTER::getRenderColor`:
 *
 *     else if( aItem->IsSelected() && isBackgroundLayer( aLayer ) )
 *         // Selected items will be painted over all other items, so make backgrounds
 *         // translucent so that non-selected overlapping objects are visible
 *         color = color.WithAlpha( 0.5 );
 *
 * `isBackgroundLayer` covers LAYER_DEVICE_BACKGROUND (a symbol's body fill),
 * LAYER_SHEET_BACKGROUND, and the two shape background layers. None of it was
 * ported: a selected symbol's body stayed solid light yellow and a selected
 * sheet's interior did not change at all.
 *
 * Also checked here: a sheet with no background colour of its own falls back to
 * the theme's LAYER_SHEET_BACKGROUND, which the fill used to skip entirely.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';
import type { Theme } from '@ziroeda/designer/src/editors/schematic/theme.js';

/** Records every fill colour used, in order, and every filled rectangle. */
function spy(): {
  fills: string[];
  rects: { colour: string; x: number; y: number; w: number; h: number }[];
  ctx: CanvasRenderingContext2D;
} {
  const fills: string[] = [];
  const rects: { colour: string; x: number; y: number; w: number; h: number }[] = [];
  const noop = (): void => {};
  let fillStyle = '';
  const ctx = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
      fills.push(v);
    },
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    stroke: noop,
    fill: noop,
    strokeRect: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    fillRect: (x: number, y: number, w: number, h: number) =>
      rects.push({ colour: fillStyle, x, y, w, h }),
  };
  return { fills, rects, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const paint = (
  doc: Schematic,
  selection: ReadonlySet<string> | undefined,
  theme: Theme = KICAD_DEFAULT,
): ReturnType<typeof spy> => {
  const s = spy();
  // Stroke text as raw segments: the fast path builds a Path2D, which is a
  // browser type with no Node equivalent (the GL recorder flips the same flag).
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      theme,
      1200,
      900,
      selection,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        showDrawingSheet: false,
      },
    );
  } finally {
    setVectorText(false);
  }
  return s;
};

describe("a selected symbol's body fill", () => {
  // A body rectangle with `(fill (type background))`, i.e. LAYER_DEVICE_BACKGROUND.
  // The stock resistor is drawn unfilled, so it has no background to dim.
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114)
      (lib_symbols
        (symbol "U" (pin_names (offset 0)) (in_bom yes) (on_board yes)
          (property "Reference" "U" (at 0 5 0))
          (property "Value" "U" (at 0 -5 0))
          (symbol "U_1_1"
            (rectangle (start -5 5) (end 5 -5)
              (stroke (width 0) (type default)) (fill (type background))))))
      (symbol (lib_id "U") (at 100 100 0) (unit 1) (uuid "u1")
        (property "Reference" "U1" (at 105 100 0))
        (property "Value" "U" (at 107 100 0))))`),
  );
  const R1 = refId('symbol', 'u1', 0);

  it('is solid when nothing is selected', () => {
    // LAYER_DEVICE_BACKGROUND is opaque light yellow in both builtin themes.
    expect(paint(doc, undefined).fills).toContain(KICAD_DEFAULT.symbolFill);
  });

  it('goes translucent when it is selected', () => {
    const fills = paint(doc, new Set([R1])).fills;
    expect(fills).not.toContain(KICAD_DEFAULT.symbolFill);
    expect(fills).toContain('rgba(255, 255, 194, 0.5)');
  });
});

describe("a sheet's background", () => {
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 100 50) (size 40 30) (uuid "sh1")
        (property "Sheetname" "xilinx" (at 100 49 0))
        (property "Sheetfile" "xilinx.kicad_sch" (at 100 81 0))))`),
  );
  const SH = refId('sheet', 'sh1', 0);
  /** Filled rects the size of the sheet body (40 x 30 mm in IU). */
  const sheetRects = (s: ReturnType<typeof spy>) =>
    s.rects.filter((r) => r.w === 400000 && r.h === 300000);

  it('is not painted at all when the theme ships it transparent', () => {
    // Both builtin themes ship LAYER_SHEET_BACKGROUND at alpha 0, and upstream
    // draws it "only ... if it has a visible alpha value".
    expect(sheetRects(paint(doc, new Set([SH])))).toHaveLength(0);
  });

  it('is painted from the theme when the theme sets one', () => {
    // The gap: the fill used to require a per-sheet `fill_color` and ignored
    // the theme, so a themed sheet background never appeared.
    const themed: Theme = { ...KICAD_DEFAULT, sheetBackground: 'rgb(200, 220, 255)' };
    const rects = sheetRects(paint(doc, undefined, themed));
    expect(rects).toHaveLength(1);
    expect(rects[0]!.colour).toBe('rgb(200, 220, 255)');
  });

  it('and halves its alpha when the sheet is selected', () => {
    const themed: Theme = { ...KICAD_DEFAULT, sheetBackground: 'rgb(200, 220, 255)' };
    const rects = sheetRects(paint(doc, new Set([SH]), themed));
    expect(rects).toHaveLength(1);
    expect(rects[0]!.colour).toBe('rgba(200, 220, 255, 0.5)');
  });

  it("uses the sheet's own colour over the theme's, and dims that too", () => {
    const own: Schematic = readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (sheet (at 100 50) (size 40 30) (fill (color 255 200 200 1)) (uuid "sh1")
          (property "Sheetname" "xilinx" (at 100 49 0))
          (property "Sheetfile" "xilinx.kicad_sch" (at 100 81 0))))`),
    );
    expect(sheetRects(paint(own, undefined))[0]!.colour).toBe('rgb(255, 200, 200)');
    expect(sheetRects(paint(own, new Set([SH])))[0]!.colour).toBe('rgba(255, 200, 200, 0.5)');
  });
});
