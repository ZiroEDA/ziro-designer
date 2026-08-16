// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A hierarchical label's flag is filled; a global label's is not.
 *
 * The two look alike and are painted differently, which is exactly the kind of
 * difference that gets ported as one rule. `SCH_PAINTER::draw` for a
 * hierarchical label fills the outline with the *background* colour, so a wire
 * running behind the flag is hidden by it:
 *
 *     m_gal->SetIsFill( true );
 *     m_gal->SetFillColor( m_schSettings.GetLayerColor( LAYER_SCHEMATIC_BACKGROUND ) );
 *     m_gal->DrawPolyline( d_pts );
 *
 * while `draw( const SCH_GLOBALLABEL* )` sets `SetIsFill( false )` for the
 * ordinary pass and fills only a *selected* one, and only when the "fill
 * shapes" preference is on.
 *
 * Ours drew both hollow, so anything behind a hierarchical label showed
 * through it (#103).
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
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** Records each `fill()` with the style in force, and each `stroke()`. */
function spy(): { fills: string[]; strokes: string[]; ctx: CanvasRenderingContext2D } {
  const fills: string[] = [];
  // An array, not a counter: a number returned from here would be a snapshot
  // taken before anything was drawn.
  const strokes: string[] = [];
  const noop = (): void => {};
  const ctx = {
    fillStyle: '',
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
    ellipse: noop,
    bezierCurveTo: noop,
    fill: () => {
      fills.push(String(ctx.fillStyle));
    },
    fillText: noop,
    measureText: () => ({ width: 0 }),
    drawImage: noop,
    clip: noop,
    stroke: () => {
      strokes.push(String(ctx.strokeStyle));
    },
    strokeRect: noop,
    fillRect: noop,
  };
  return { fills, strokes, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const sheet = (node: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols) ${node})`));

const HIER = `(hierarchical_label "CLK" (shape input) (at 100 60 0)
  (effects (font (size 1.27 1.27))) (uuid "h1"))`;
const GLOBAL = `(global_label "CLK" (shape input) (at 100 60 0)
  (effects (font (size 1.27 1.27))) (uuid "g1"))`;

const paint = (doc: Schematic): { fills: string[]; strokes: string[] } => {
  const s = spy();
  // Glyph runs otherwise go through a retained `Path2D`, which node has no
  // implementation of; vector-text mode strokes them onto the context instead.
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
      },
    );
  } finally {
    setVectorText(false);
  }
  return { fills: s.fills, strokes: s.strokes };
};

/** Fills painted in the background colour, i.e. a flag knocking out what is behind it. */
const bgFills = (doc: Schematic): number =>
  paint(doc).fills.filter((f) => f === KICAD_DEFAULT.background).length;

describe('the flag behind a label', () => {
  it('a hierarchical label knocks out what is behind it', () => {
    expect(bgFills(sheet(HIER))).toBeGreaterThan(0);
  });

  it('a global label does not', () => {
    // `SetIsFill( false )` on the ordinary pass — the wire shows through, which
    // is how KiCad draws it.
    expect(bgFills(sheet(GLOBAL))).toBe(0);
  });

  it('and an empty sheet fills nothing in the background colour', () => {
    // Guards the test itself: if the background were painted as a fill by
    // something else, the assertions above would pass for the wrong reason.
    expect(bgFills(sheet(''))).toBe(0);
  });

  it('the flag is still stroked, not only filled', () => {
    expect(paint(sheet(HIER)).strokes.length).toBeGreaterThan(0);
  });
});
