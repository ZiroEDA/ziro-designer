// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three things `SCH_PAINTER::draw( SCH_SYMBOL )` does to a symbol that
 * carries the DNP or "exclude from simulation" attribute, none of which we did:
 *
 *  - the DNP cross, `eeschema/sch_painter.cpp:2809-2835`;
 *  - the simulation-exclusion box and its circled tilde, `:2837-2870`;
 *  - the greying, `getRenderColor`'s `aDimmed` tail at `:482-486`.
 *
 * The third is DNP's alone. `draw()` computes `DNP` at `:2695` and hands it to
 * every field (`:2705`) and to the body (`:2790`) as `aDimmed`; the exclusion
 * flag is computed on the very next line (`:2696`) and is passed to nothing —
 * it only gates the marker. Both attributes on one symbol makes it look as if
 * either could be the cause, which is exactly why this is asserted separately.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  DNP_MARKER_STROKE_WIDTH,
  SIM_EXCLUSION_STROKE_WIDTH,
  dnpMarkerSegments,
  simExclusionMarker,
} from '@ziroeda/designer/src/editors/schematic/render/symbol_markers.js';
import { dimmedColor } from '@ziroeda/designer/src/editors/schematic/render/render_color.js';
import { BUILTIN_DEFAULT_THEME } from '@ziroeda/common/src/settings/builtin_color_themes.js';
import { toCssColor } from '@ziroeda/common';
import type { BBox } from '@ziroeda/eeschema/src/tools/bbox.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';
import type { RenderOpts } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';

/* ------------------------------------------------------------------ geometry */

/**
 * A body box and a body-and-pins box whose pin margins differ on the two axes,
 * and differ enough that the two `margins` statements cannot be reordered
 * without changing the answer.
 *
 *     margins.x = max( 500,  0 ) = 500        margins.y = max( 100, 0 ) = 100
 *     margins.x = max( 500 * 0.6, 100 * 0.3 ) = max( 300, 30 )  = 300
 *     margins.y = max( 100 * 0.6, 300 * 0.3 ) = max(  60, 90 )  =  90
 *
 * The second line reads the 300 the first line just wrote. Computed in the
 * other order it would read the original 500 and give
 * `max( 60, 150 ) = 150` — a different, taller cross.
 */
const BODY: BBox = { minX: 0, minY: 0, maxX: 1000, maxY: 400 };
const PINS: BBox = { minX: -500, minY: -100, maxX: 1000, maxY: 400 };

describe('the DNP cross, sch_painter.cpp:2809-2835', () => {
  it('inflates the BODY box by the pin margins, in upstream’s order', () => {
    const [a, b] = dnpMarkerSegments(BODY, PINS);
    // bbox.Inflate( 300, 90 ) over (0,0)..(1000,400).
    expect(a).toEqual({ a: { x: -300, y: -90 }, b: { x: 1300, y: 490 } });
    // `std::swap( pt1.x, pt2.x )` — the second diagonal, not a second copy of
    // the first.
    expect(b).toEqual({ a: { x: 1300, y: -90 }, b: { x: -300, y: 490 } });
  });

  it('would give a different box if the two margin statements were reordered', () => {
    // The value the swapped order produces, stated here so the test above is
    // not merely "whatever the code prints": 90 and 150 are both reachable
    // from this fixture and only one of them is KiCad's.
    const [a] = dnpMarkerSegments(BODY, PINS);
    expect(a.a.y).toBe(-90);
    expect(a.a.y).not.toBe(-150);
  });

  it('rounds each axis with KiROUND before inflating, not after', () => {
    // margins = ( 9, 5 ) -> x = max( 5.4, 1.5 ) = 5.4 -> 5
    //                       y = max( 3.0, 1.62 ) = 3.0 -> 3
    const [a] = dnpMarkerSegments(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { minX: -9, minY: -5, maxX: 100, maxY: 100 },
    );
    expect(a.a).toEqual({ x: -5, y: -3 });
  });

  it('leaves the box alone when the pins do not stick out', () => {
    const same = { minX: 10, minY: 20, maxX: 110, maxY: 120 };
    const [a, b] = dnpMarkerSegments(same, same);
    expect(a).toEqual({ a: { x: 10, y: 20 }, b: { x: 110, y: 120 } });
    expect(b).toEqual({ a: { x: 110, y: 20 }, b: { x: 10, y: 120 } });
  });

  it('is three default line widths thick', () => {
    // 3 * MilsToIU( DEFAULT_LINE_WIDTH_MILS ), DEFAULT_LINE_WIDTH_MILS = 6
    // (eeschema/default_values.h:51) and the schematic IU is 254 per mil.
    expect(DNP_MARKER_STROKE_WIDTH).toBe(3 * 6 * 254);
  });
});

describe('the simulation-exclusion marker, sch_painter.cpp:2837-2870', () => {
  // ADVANCED_CFG::m_ExcludeFromSimulationLineWidth defaults to 25
  // (common/advanced_config.cpp:326).
  const W = 25 * 254; // 6350
  const D = W / 2; // KiROUND( strokeWidth * 0.5 ) = 3175
  const OFFSET = 2 * W; // 12700

  it('takes its width from the advanced-config default, 25 mils', () => {
    expect(SIM_EXCLUSION_STROKE_WIDTH).toBe(6350);
    expect(SIM_EXCLUSION_STROKE_WIDTH).toBe(W);
  });

  it('boxes the body, inflated by half the stroke, in upstream’s corner order', () => {
    const m = simExclusionMarker(BODY);
    const x0 = BODY.minX - D;
    const y0 = BODY.minY - D;
    const x1 = BODY.maxX + D;
    const y1 = BODY.maxY + D;
    expect(m.box).toEqual([
      { a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
      { a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
      { a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
      { a: { x: x0, y: y1 }, b: { x: x0, y: y0 } },
    ]);
  });

  it('hangs the badge off the box’s END corner, right and up', () => {
    const m = simExclusionMarker(BODY);
    // center = bbox.GetEnd() + VECTOR2D( offset + strokeWidth, -offset )
    expect(m.circle).toEqual({
      center: { x: BODY.maxX + D + OFFSET + W, y: BODY.maxY + D - OFFSET },
      radius: OFFSET,
    });
  });

  it('draws the tilde with left/right as ENDS and top/bottom as CONTROLS', () => {
    // DrawCurve( left, top, bottom, right, 1 ): the reason it is an S and not a
    // bow is that the two controls are on OPPOSITE sides of the chord.
    const m = simExclusionMarker(BODY);
    const c = m.circle.center;
    expect(m.curve.start).toEqual({ x: c.x - OFFSET, y: c.y });
    expect(m.curve.end).toEqual({ x: c.x + OFFSET, y: c.y });
    expect(m.curve.control1).toEqual({ x: c.x, y: c.y + OFFSET });
    expect(m.curve.control2).toEqual({ x: c.x, y: c.y - OFFSET });
    // …and they straddle the chord, which a bow would not.
    expect(Math.sign(m.curve.control1.y - c.y)).toBe(-Math.sign(m.curve.control2.y - c.y));
  });
});

/* ---------------------------------------------------------------- getRenderColor */

describe('getRenderColor’s aDimmed tail, sch_painter.cpp:482-486', () => {
  const BG = toCssColor(BUILTIN_DEFAULT_THEME.LAYER_SCHEMATIC_BACKGROUND, ', ');

  /**
   * Desaturate() then Mix( sheetColour, 0.5 ), worked through by hand for
   * LAYER_DEVICE = rgb(132, 0, 0) on the default beige sheet:
   *
   *   ToHSL   -> lightness ( max + min ) / 2 = ( 132/255 + 0 ) / 2 = 0.258823…
   *   FromHSL with saturation 0 -> r = g = b = lightness, i.e. 66/255
   *   Mix     -> 0.5 * background + 0.5 * 66/255 per channel
   *              red   0.5 * 245 + 0.5 * 66 = 155.5 -> 156
   *              green 0.5 * 244 + 0.5 * 66 = 155.0 -> 155
   *              blue  0.5 * 239 + 0.5 * 66 = 152.5 -> 153
   *
   * (`color4dChannel` is `floor( c * 255 + 0.5 )`, so a .5 rounds up.)
   */
  it('desaturates first, then mixes half-and-half with the SHEET colour', () => {
    expect(dimmedColor('rgb(132, 0, 0)', BG)).toBe('rgb(156, 155, 153)');
  });

  it('is not a plain mix: skipping Desaturate leaves the hue behind', () => {
    // 0.5 * 245 + 0.5 * 132 = 188.5, 0.5 * 244 + 0 = 122, 0.5 * 239 = 119.5.
    expect(dimmedColor('rgb(132, 0, 0)', BG)).not.toBe('rgb(189, 122, 120)');
  });

  it('is not a plain desaturate: skipping the Mix leaves it far too dark', () => {
    expect(dimmedColor('rgb(132, 0, 0)', BG)).not.toBe('rgb(66, 66, 66)');
  });

  it('collapses hue, so three layers of the same lightness dim alike', () => {
    // LAYER_DEVICE, LAYER_FIELDS and LAYER_PIN are rgb(132,0,0), rgb(132,0,132)
    // and rgb(0,132,132) — three hues, one lightness. Desaturate() erases the
    // difference, which is what makes a DNP symbol read as one grey object.
    const device = dimmedColor('rgb(132, 0, 0)', BG);
    expect(dimmedColor('rgb(132, 0, 132)', BG)).toBe(device);
    expect(dimmedColor('rgb(0, 132, 132)', BG)).toBe(device);
  });

  it('fades toward the theme’s own sheet colour, not toward a fixed grey', () => {
    // KiCad Classic's background is white, so the same red lands lighter:
    // 0.5 * 255 + 0.5 * 127.5 = 191.25 -> 191.
    expect(dimmedColor('rgb(255, 0, 0)', 'rgb(255, 255, 255)')).toBe('rgb(191, 191, 191)');
  });
});

/* -------------------------------------------------------------- the renderer */

interface Paint {
  strokes: { color: string; width: number }[];
  fills: string[];
  curves: number;
  arcs: number;
}

/** Records what was stroked and filled, and in which colour. */
function spy(): { paint: Paint; ctx: CanvasRenderingContext2D } {
  const paint: Paint = { strokes: [], fills: [], curves: 0, arcs: 0 };
  const noop = (): void => {};
  const st = { strokeStyle: '', fillStyle: '', lineWidth: 1 };
  const ctx = {
    get strokeStyle() {
      return st.strokeStyle;
    },
    set strokeStyle(v: string) {
      st.strokeStyle = v;
    },
    get fillStyle() {
      return st.fillStyle;
    },
    set fillStyle(v: string) {
      st.fillStyle = v;
    },
    get lineWidth() {
      return st.lineWidth;
    },
    set lineWidth(v: number) {
      st.lineWidth = v;
    },
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
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: () => {
      paint.arcs++;
    },
    bezierCurveTo: () => {
      paint.curves++;
    },
    fill: () => {
      paint.fills.push(st.fillStyle);
    },
    fillText: noop,
    drawImage: noop,
    clip: noop,
    strokeRect: noop,
    fillRect: noop,
    stroke: () => {
      paint.strokes.push({ color: st.strokeStyle, width: st.lineWidth });
    },
  };
  return { paint, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const paintSheet = (doc: Schematic, opts: Partial<RenderOpts> = {}): Paint => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      1400,
      1000,
      undefined,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        showDrawingSheet: false,
        ...opts,
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.paint;
};

/** A resistor placement, with whichever attribute tokens the caller wants. */
const sheetWith = (attrs: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (lib_symbols
        (symbol "R" (pin_numbers (hide yes)) (pin_names (offset 0))
          (property "Reference" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
          (property "Value" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
          (symbol "R_0_1"
            (rectangle (start -1.016 -2.54) (end 1.016 2.54)
              (stroke (width 0.254) (type default)) (fill (type none))))
          (symbol "R_1_1"
            (pin passive line (at 0 3.81 270) (length 1.27)
              (name "~" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27)))))
            (pin passive line (at 0 -3.81 90) (length 1.27)
              (name "~" (effects (font (size 1.27 1.27))))
              (number "2" (effects (font (size 1.27 1.27))))))))
      (symbol (lib_id "R") (at 50 50 0) (unit 1) ${attrs} (uuid "r1")
        (property "Reference" "R1" (at 52 49 90) (effects (font (size 1.27 1.27))))
        (property "Value" "10k" (at 52 51 90) (effects (font (size 1.27 1.27))))))`),
  );

const DNP_COLOUR = toCssColor(BUILTIN_DEFAULT_THEME.LAYER_DNP_MARKER, ', ');
const SIM_COLOUR = toCssColor(BUILTIN_DEFAULT_THEME.LAYER_EXCLUDED_FROM_SIM, ', ');
const OUTLINE = KICAD_DEFAULT.symbolOutline;

describe('the renderer paints what the painter paints', () => {
  it('draws no marker on a plain symbol', () => {
    const p = paintSheet(sheetWith(''), { markSimExclusions: true });
    expect(p.strokes.map((s) => s.color)).not.toContain(DNP_COLOUR);
    expect(p.strokes.map((s) => s.color)).not.toContain(SIM_COLOUR);
    // …and the body is painted in the undimmed LAYER_DEVICE colour.
    expect(p.strokes.map((s) => s.color)).toContain(OUTLINE);
  });

  it('draws exactly two crossing segments for DNP, at three default widths', () => {
    const p = paintSheet(sheetWith('(dnp yes)'));
    const cross = p.strokes.filter((s) => s.color === DNP_COLOUR);
    expect(cross).toHaveLength(2);
    expect(cross.map((s) => s.width)).toEqual([DNP_MARKER_STROKE_WIDTH, DNP_MARKER_STROKE_WIDTH]);
  });

  it('greys the whole symbol out for DNP — body, pins and fields', () => {
    const plain = paintSheet(sheetWith(''));
    const dnp = paintSheet(sheetWith('(dnp yes)'));
    expect(plain.strokes.map((s) => s.color)).toContain(OUTLINE);
    expect(dnp.strokes.map((s) => s.color)).not.toContain(OUTLINE);
    expect(dnp.strokes.map((s) => s.color)).toContain(
      dimmedColor(OUTLINE, KICAD_DEFAULT.background),
    );
    // The pins are a separate layer and go the same way.
    expect(plain.strokes.map((s) => s.color)).toContain(KICAD_DEFAULT.pin);
    expect(dnp.strokes.map((s) => s.color)).toContain(
      dimmedColor(KICAD_DEFAULT.pin, KICAD_DEFAULT.background),
    );
    // Fields: R1 / 10k are stroked text on LAYER_REFERENCEPART / LAYER_VALUEPART.
    expect(plain.strokes.map((s) => s.color)).toContain(KICAD_DEFAULT.reference);
    expect(dnp.strokes.map((s) => s.color)).not.toContain(KICAD_DEFAULT.reference);
  });

  it('draws the exclusion box and its badge when the setting is on', () => {
    const p = paintSheet(sheetWith('(exclude_from_sim yes)'), { markSimExclusions: true });
    const strokes = p.strokes.filter(
      (s) => s.color === SIM_COLOUR && s.width === SIM_EXCLUSION_STROKE_WIDTH,
    );
    // Four box sides, the disc's ring, and the tilde. `SetIsStroke( true )` is
    // set once for the whole block and never cleared, so the circle is stroked
    // in the FULL marker colour as well as filled at a tenth of it — that ring
    // is what makes the badge readable, and filling alone loses it.
    expect(strokes).toHaveLength(6);
    expect(p.curves).toBeGreaterThan(0);
    // The disc's fill, and only the disc's, is the tenth-alpha one.
    expect(p.fills.filter((f) => f === 'rgba(194, 194, 194, 0.1)')).toHaveLength(1);
    // `SetFillColor( marker_color )` before DrawCurve, and DrawPolygon fills
    // the closed contour: the tilde is filled at full strength, not at 0.1.
    expect(p.fills).toContain(SIM_COLOUR);
  });

  it('draws NO exclusion marker when mark_sim_exclusions is off', () => {
    // eeschema_settings.cpp:222-223 defaults the setting to true, and
    // PANEL_EESCHEMA_DISPLAY_OPTIONS lets a user turn it off; a hardcoded
    // marker would ignore that.
    const p = paintSheet(sheetWith('(exclude_from_sim yes)'), { markSimExclusions: false });
    expect(p.strokes.map((s) => s.color)).not.toContain(SIM_COLOUR);
    expect(p.fills).not.toContain('rgba(194, 194, 194, 0.1)');
  });

  it('does NOT grey the symbol for a simulation exclusion', () => {
    // The flag at sch_painter.cpp:2696 is passed to nothing; only the DNP flag
    // at :2695 reaches `aDimmed`.
    const p = paintSheet(sheetWith('(exclude_from_sim yes)'), { markSimExclusions: true });
    expect(p.strokes.map((s) => s.color)).toContain(OUTLINE);
    expect(p.strokes.map((s) => s.color)).not.toContain(
      dimmedColor(OUTLINE, KICAD_DEFAULT.background),
    );
  });

  it('draws both markers, and dims, when a symbol carries both attributes', () => {
    const p = paintSheet(sheetWith('(exclude_from_sim yes) (dnp yes)'), {
      markSimExclusions: true,
    });
    expect(p.strokes.filter((s) => s.color === DNP_COLOUR)).toHaveLength(2);
    expect(p.strokes.filter((s) => s.color === SIM_COLOUR)).toHaveLength(6);
    // The markers themselves are NOT dimmed: they are drawn after the body,
    // from the layer colour, with no `aDimmed` in sight.
    expect(p.strokes.map((s) => s.color)).not.toContain(OUTLINE);
  });
});
