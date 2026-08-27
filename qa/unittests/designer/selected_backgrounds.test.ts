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
 *
 * The rule is per *item*, not per symbol. `draw( SCH_SHAPE )` and
 * `draw( SCH_TEXTBOX )` fill on LAYER_NOTES_BACKGROUND / LAYER_SHAPES_BACKGROUND
 * through the very same `getRenderColor`, so a selected sheet-level rectangle
 * and a selected text box wash out too — and those two were the half of
 * `isBackgroundLayer` still unported.
 *
 * And the schematic renders through WebGL by default, so the alpha is pinned on
 * *both* backends: a rule that only the Canvas2D path obeys is invisible in the
 * app.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import {
  recordSchematicScene,
  sameContent,
  type ContentKey,
} from '@ziroeda/designer/src/render/gl/schematic_gl.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
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

const RENDER_OPTS = {
  ...DEFAULT_RENDER_OPTS,
  grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
  showDrawingSheet: false,
};

const paint = (
  doc: Schematic,
  selection: ReadonlySet<string> | undefined,
  theme: Theme = KICAD_DEFAULT,
  highlight?: ReadonlySet<string>,
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
      highlight,
      RENDER_OPTS,
    );
  } finally {
    setVectorText(false);
  }
  return s;
};

/**
 * The alphas of every triangle the WebGL backend would upload.
 *
 * The recorded buffer is the GL path's observable: it is exactly what the
 * device draws, and a colour that loses its alpha on the way into it is a
 * selected symbol that never washes out on screen however right the painter is.
 * Recorded through `recordSchematicScene` rather than a private setup, so this
 * exercises the call the app makes.
 */
const glFillAlphas = (
  doc: Schematic,
  selection: ReadonlySet<string> | undefined,
  theme: Theme = KICAD_DEFAULT,
): number[] => {
  const scene = new Scene();
  recordSchematicScene(
    scene,
    { doc, theme, opts: RENDER_OPTS, selection, highlight: undefined },
    0.0005,
  );
  const tri = scene.triangles.view();
  const out = new Set<number>();
  // position(2) + rgba(4) per vertex; the alpha is the sixth float.
  for (let i = 0; i + 5 < tri.length; i += 6) out.add(tri[i + 5]!);
  return [...out].sort();
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

  it('goes further when the symbol is brightened', () => {
    // The arm above the selected one: `color.WithAlpha( 0.2 )`.
    const fills = paint(doc, undefined, KICAD_DEFAULT, new Set([R1])).fills;
    expect(fills).not.toContain(KICAD_DEFAULT.symbolFill);
    expect(fills).toContain('rgba(255, 255, 194, 0.2)');
  });

  it('reaches the WebGL buffer at 0.5, not just the 2D canvas', () => {
    // The schematic renders through WebGL by default, and the buffer is
    // recorded once and re-recorded only when the content key changes. If the
    // alpha were lost between the painter and the vertex buffer — or if the
    // recording were not keyed on the selection — the body would stay solid on
    // screen while every Canvas2D assertion above still passed.
    expect(glFillAlphas(doc, undefined)).toEqual([1]);
    expect(glFillAlphas(doc, new Set([R1]))).toEqual([0.5]);
  });
});

describe("a selected sheet-level shape's fill", () => {
  // `draw( SCH_SHAPE )` fills FILLED_WITH_COLOR on LAYER_NOTES_BACKGROUND,
  // which `isBackgroundLayer` covers.
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (rectangle (start 10 10) (end 40 30)
        (stroke (width 0) (type default))
        (fill (type color) (color 200 220 255 1))
        (uuid "g1")))`),
  );
  // Sheet graphics are keyed by index: SCH_SHAPE carries no uuid of its own here.
  const G1 = refId('graphic', undefined, 0);

  it('is solid when nothing is selected', () => {
    expect(paint(doc, undefined).fills).toContain('rgb(200, 220, 255)');
  });

  it('halves when the shape is selected', () => {
    const fills = paint(doc, new Set([G1])).fills;
    expect(fills).not.toContain('rgb(200, 220, 255)');
    expect(fills).toContain('rgba(200, 220, 255, 0.5)');
  });

  it('drops to 0.2 when the shape is brightened', () => {
    expect(paint(doc, undefined, KICAD_DEFAULT, new Set([G1])).fills).toContain(
      'rgba(200, 220, 255, 0.2)',
    );
  });

  it('replaces the shape’s own alpha rather than scaling it', () => {
    // `WithAlpha` is `return COLOR4D( r, g, b, aAlpha )`: a half-transparent
    // fill comes out *more* opaque when selected, not a quarter.
    const faint: Schematic = readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (rectangle (start 10 10) (end 40 30)
          (stroke (width 0) (type default))
          (fill (type color) (color 200 220 255 0.25))
          (uuid "g1")))`),
    );
    expect(paint(faint, undefined).fills).toContain('rgba(200, 220, 255, 0.25)');
    expect(paint(faint, new Set([G1])).fills).toContain('rgba(200, 220, 255, 0.5)');
  });

  it('reaches the WebGL buffer too', () => {
    expect(glFillAlphas(doc, undefined)).toEqual([1]);
    expect(glFillAlphas(doc, new Set([G1]))).toEqual([0.5]);
  });
});

describe("a selected text box's fill", () => {
  // `draw( SCH_TEXTBOX )` fills on the same background layers as SCH_SHAPE.
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (text_box "note" (at 10 10 0) (size 30 20)
        (stroke (width 0) (type solid))
        (fill (type color) (color 200 220 255 1))
        (effects (font (size 1.27 1.27)) (justify left top))
        (uuid "tb1")))`),
  );
  const TB = refId('textbox', 'tb1', 0);

  it('is solid when nothing is selected', () => {
    expect(paint(doc, undefined).fills).toContain('rgb(200, 220, 255)');
  });

  it('halves when the box is selected', () => {
    const fills = paint(doc, new Set([TB])).fills;
    expect(fills).not.toContain('rgb(200, 220, 255)');
    expect(fills).toContain('rgba(200, 220, 255, 0.5)');
  });

  it('drops to 0.2 when the box is brightened', () => {
    expect(paint(doc, undefined, KICAD_DEFAULT, new Set([TB])).fills).toContain(
      'rgba(200, 220, 255, 0.2)',
    );
  });

  it('reaches the WebGL buffer too', () => {
    expect(glFillAlphas(doc, undefined)).toEqual([1]);
    expect(glFillAlphas(doc, new Set([TB]))).toEqual([0.5]);
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

describe("the WebGL buffer's re-record key", () => {
  // Recording is ~165 ms on a real sheet, so the buffer is kept until the
  // *content* changes. That makes the key the second half of the rule: getting
  // the painter right and then not re-recording on a selection change would
  // leave the body at the colour it was recorded with — solid — while every
  // painter assertion above still passed.
  const doc: Schematic = readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols))`));
  const key = (selection: ReadonlySet<string> | undefined): ContentKey => ({
    doc,
    theme: KICAD_DEFAULT,
    opts: RENDER_OPTS,
    selection,
    highlight: undefined,
  });

  it('holds while nothing changes', () => {
    const a = key(undefined);
    expect(sameContent(a, { ...a })).toBe(true);
  });

  it('breaks when the selection changes', () => {
    expect(sameContent(key(undefined), key(new Set(['symbol:u1'])))).toBe(false);
    expect(sameContent(key(new Set(['symbol:u1'])), key(new Set(['symbol:u2'])))).toBe(false);
  });

  it('breaks when the highlight changes', () => {
    const a = key(undefined);
    expect(sameContent(a, { ...a, highlight: new Set(['symbol:u1']) })).toBe(false);
  });
});
