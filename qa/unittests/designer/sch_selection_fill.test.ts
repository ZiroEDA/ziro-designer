// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Display Options > "Fill selected shapes",
 * `EESCHEMA_SETTINGS::m_Selection.fill_shapes`
 * (`eeschema_settings.cpp:441-442`) — and note it is the one of its
 * neighbours that upstream defaults to FALSE.
 *
 * It stored a value nothing read. The rule is in the SHADOW pass
 * (`sch_painter.cpp:2066-2080`):
 *
 *     if( aLayer == LAYER_SELECTION_SHADOWS )
 *         if( eeconfig()->m_Selection.fill_shapes )
 *             if( aShape->GetShape() == SHAPE_T::ARC )
 *                 m_gal->SetIsFill( aShape->IsSolidFill() );
 *             else
 *                 m_gal->SetIsFill( true );
 *
 * The arc is an exception with a reason given in the source: *"Consider a NAND
 * gate. We have no idea which side of the arc is 'inside' so we can't reliably
 * fill."* So an unfilled arc keeps its outline even with the setting on, which
 * is the half a port is most likely to flatten.
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

/** Counts fills and strokes separately, so "filled" is not inferred. */
function spy(): { fills: number; strokes: number; ctx: CanvasRenderingContext2D } {
  const n = { fills: 0, strokes: 0 };
  const noop = (): void => {};
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
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
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    strokeRect: () => {
      n.strokes++;
    },
    fillRect: () => {
      n.fills++;
    },
    fill: () => {
      n.fills++;
    },
    stroke: () => {
      n.strokes++;
    },
  };
  return {
    get fills() {
      return n.fills;
    },
    get strokes() {
      return n.strokes;
    },
    ctx: ctx as unknown as CanvasRenderingContext2D,
  } as unknown as { fills: number; strokes: number; ctx: CanvasRenderingContext2D };
}

// `drawSelectionShadows` ids a sheet graphic by INDEX, not by uuid:
// `refId('graphic', undefined, i)` falls through to `${kind}:idx:${index}`
// (`eeschema/src/tools/hittest.ts:314-316`). Selecting by uuid here would match
// nothing and the test would pass for the wrong reason.
const RECT = 'graphic:idx:0';
const ARC = 'graphic:idx:1';

/** One unfilled rectangle and one unfilled arc, both selectable. */
const DOC = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols)
    (rectangle (start 40 40) (end 60 55) (stroke (width 0.1524) (type solid))
      (fill (type none)))
    (arc (start 80 40) (mid 85 35) (end 90 40) (stroke (width 0.1524) (type solid))
      (fill (type none))))`),
);

const paint = (fillSelectedShapes: boolean): { fills: number; strokes: number } => {
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
      new Set([RECT, ARC]),
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        fillSelectedShapes,
        showDrawingSheet: false,
        showPageLimits: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
  } finally {
    setVectorText(false);
  }
  return { fills: s.fills, strokes: s.strokes };
};

describe('a selected shape is filled only when the setting says so', () => {
  it('fills nothing extra with the setting off', () => {
    const off = paint(false);
    const on = paint(true);
    // The shadow pass still OUTLINES both either way — the setting adds fill,
    // it does not replace the halo.
    expect(on.strokes).toBe(off.strokes);
    expect(on.fills).toBeGreaterThan(off.fills);
  });

  it('adds exactly one fill: the rectangle, not the unfilled arc', () => {
    // `SetIsFill( aShape->IsSolidFill() )` for an arc — this document's arc is
    // `(fill (type none))`, so it stays outline-only while the rectangle fills.
    expect(paint(true).fills - paint(false).fills).toBe(1);
  });
});

describe('the default is upstream’s, and it is the odd one out', () => {
  it('is false on both sides', () => {
    // `PARAM<bool>( "selection.fill_shapes", …, false )` — its neighbours on
    // that page default true.
    expect(DEFAULT_RENDER_OPTS.fillSelectedShapes).toBe(false);
    expect(EESCHEMA_DEFAULTS.selection.fill_shapes).toBe(false);
  });
});
