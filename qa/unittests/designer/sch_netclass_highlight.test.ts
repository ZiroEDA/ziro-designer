// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * LAYER_NET_COLOR_HIGHLIGHT — the three "Highlight netclass colors" rows on
 * Schematic Editor > Display Options, which are one feature.
 *
 * A fat translucent band under a wire or bus that a netclass has coloured, so a
 * net's colour reads at a glance without changing the wire itself. Three
 * settings feed it (`eeschema_settings.cpp:444-451`): the flag, a thickness in
 * MILS added to the wire's own width (`getLineWidth`'s
 * `aDrawingWireColorHighlights` arm, `:510-519`) and an alpha applied as a
 * FACTOR on the colour's own (`:1846`).
 *
 * Three things a plausible port gets wrong:
 *
 *  1. it is painted UNDERNEATH. The layer is never given a place in
 *     `SCH_LAYER_ORDER`, so it keeps VIEW's default `renderingOrder` = its enum
 *     value, 493 (`view.cpp:279`), and layers sort DESCENDING by that
 *     (`view.h:857-860`) — far behind the ordered 0..40;
 *  2. a wire whose colour IS the layer's own gets NO band —
 *     "Don't draw highlights for default-colored nets" (`:1839-1845`). Without
 *     that, every wire on the sheet grows a halo and the feature says nothing;
 *  3. the alpha is a fraction, 0.6, not the 60 the control shows. The panel
 *     scales it both ways (`panel_eeschema_display_options.cpp:73`, `:117`),
 *     and our settings stored the DISPLAYED number.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

interface Stroke {
  style: string;
  width: number;
}

function spy(): { strokes: Stroke[]; ctx: CanvasRenderingContext2D } {
  const strokes: Stroke[] = [];
  const noop = (): void => {};
  const state = { strokeStyle: '', lineWidth: 0 };
  const ctx = {
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
    fillStyle: '',
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
    arc: noop,
    bezierCurveTo: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    fillRect: noop,
    fill: noop,
    strokeRect: noop,
    stroke: () => {
      strokes.push({ style: state.strokeStyle, width: state.lineWidth });
    },
  };
  return { strokes, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const WIRE = '55555555-5555-5555-5555-555555555555';
const DOC = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols)
    (wire (pts (xy 50 50) (xy 80 50))
      (stroke (width 0) (type default)) (uuid "${WIRE}")))`),
);

/** The netclass has coloured this wire; the default wire colour is the theme's. */
const NETCLASS_RED = 'rgb(255, 0, 0)';

const paint = (
  o: Partial<(typeof DEFAULT_RENDER_OPTS)['grid']> & Record<string, unknown> = {},
  netColor: string | undefined = NETCLASS_RED,
): Stroke[] => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      DOC,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      900,
      600,
      new Set(),
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        highlightNetclassColors: true,
        showDrawingSheet: false,
        showPageLimits: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        ...(netColor
          ? {
              netOverrides: {
                lines: new Map([[WIRE, { color: netColor }]]),
                junctions: new Map(),
              },
            }
          : {}),
        ...o,
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.strokes;
};

/**
 * The wire's own stroke width, with no band drawn — the baseline the band is
 * recognised against.
 */
const WIRE_WIDTH = (() => {
  const only = paint({ highlightNetclassColors: false });
  return Math.max(...only.map((st) => st.width));
})();

/**
 * The band: the stroke WIDER than the wire's own.
 *
 * Not "the one with an rgba() style" — that was the first version, and it broke
 * at alpha 1, where the colour serialises back to `rgb(...)`. Width is what the
 * band actually is; the colour is a separate assertion.
 */
const band = (strokes: Stroke[]): Stroke | undefined => strokes.find((st) => st.width > WIRE_WIDTH);

describe('the band', () => {
  it('is drawn for a wire a netclass has coloured', () => {
    expect(band(paint())).toBeDefined();
  });

  it('is NOT drawn for a wire at the layer’s own colour', () => {
    // "Don't draw highlights for default-colored nets". Without this every wire
    // grows a halo, which is the shape of port that looks like it works.
    expect(band(paint({}, KICAD_DEFAULT.wire))).toBeUndefined();
  });

  it('is not drawn at all with the flag off', () => {
    expect(band(paint({ highlightNetclassColors: false }))).toBeUndefined();
  });

  it('is painted BEFORE the wire, so the wire sits on it', () => {
    // The layer's rendering order puts it behind everything. Painted after, the
    // translucent band would tint the wire instead of framing it.
    const strokes = paint();
    const bandAt = strokes.findIndex((st) => st.width > WIRE_WIDTH);
    const wireAt = strokes.findIndex((st) => st.style === NETCLASS_RED);
    expect(bandAt).toBeGreaterThanOrEqual(0);
    expect(wireAt).toBeGreaterThanOrEqual(0);
    expect(bandAt).toBeLessThan(wireAt);
  });
});

describe('the two numbers', () => {
  it('adds the thickness in MILS to the wire’s own width', () => {
    // `width += schIUScale.MilsToIU( thickness )`. 1 mil = 0.0254 mm, and the
    // schematic's IU is 1e4 per mm, so a mil is 254 IU.
    // Two NON-ZERO thicknesses: at 0 the band is exactly the wire's width and
    // the "wider than the wire" finder cannot see it — which is correct
    // behaviour (upstream still paints it, translucent and invisible) and a
    // useless baseline.
    const thin = band(paint({ netclassHighlightThicknessMils: 10 }))!;
    const thick = band(paint({ netclassHighlightThicknessMils: 30 }))!;
    expect(thick.width - thin.width).toBe(20 * 254);
    // ...and the absolute width is the wire's own plus the thickness.
    expect(thin.width).toBe(WIRE_WIDTH + 10 * 254);
  });

  it('applies the alpha as a FACTOR on the colour’s own', () => {
    // `color.WithAlpha( color.a * highlightAlpha )` — not an assignment. The
    // wire's colour is opaque here, so the band's alpha IS the factor.
    const half = band(paint({ netclassHighlightAlpha: 0.5 }))!;
    const full = band(paint({ netclassHighlightAlpha: 1 }))!;
    expect(half.style).toContain('0.5');
    // At a factor of 1 the colour comes back opaque — the wire's own alpha
    // unchanged — which is what "a factor, not an assignment" means.
    expect(full.style).not.toBe(half.style);
    expect(full.style).not.toContain('0.5');
  });

  it('MULTIPLIES an already-translucent net colour rather than replacing it', () => {
    // The distinction is invisible on an opaque colour, where `a * alpha` and
    // `alpha` are the same number — which is why the assertions above could not
    // tell a factor from an assignment, and a mutant doing
    // `WithAlpha( highlightAlpha )` survived them.
    //
    // A netclass colour that is already half-transparent settles it: the factor
    // gives 0.5 * 0.6 = 0.3, the assignment would give 0.6.
    const translucent = band(paint({ netclassHighlightAlpha: 0.6 }, 'rgba(255, 0, 0, 0.5)'))!;
    expect(translucent.style).toContain('0.3');
  });
});

describe('the alpha is stored as a fraction, and shown as a percent', () => {
  it('defaults to 0.6, not 60', () => {
    // `PARAM<double>( …, 0.6, 0, 1 )`. The panel is what multiplies by 100.
    expect(EESCHEMA_DEFAULTS.selection.highlight_netclass_colors_alpha).toBe(0.6);
    expect(DEFAULT_RENDER_OPTS.netclassHighlightAlpha).toBe(0.6);
  });

  it('and the other two defaults are upstream’s', () => {
    expect(EESCHEMA_DEFAULTS.selection.highlight_netclass_colors).toBe(false);
    expect(EESCHEMA_DEFAULTS.selection.highlight_netclass_colors_thickness).toBe(15);
  });
});
