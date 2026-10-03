// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_PAINTER's shapes, sheets, tables and groups (sch_painter.cpp, S4-5) on a
 * recording GAL; plus SCH_TABLE::DrawBorders and PrintableCharCount.
 */
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SCH_RENDER_SETTINGS } from '@ziroeda/eeschema/sch_render_settings.js';
import { PrintableCharCount } from '@ziroeda/common/string_utils.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import { SCH_PAINTER } from '@ziroeda/eeschema/sch_painter.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_TABLE } from '@ziroeda/eeschema/sch_table.js';
import { SCH_TABLECELL } from '@ziroeda/eeschema/sch_tablecell.js';
import { afterEach, describe, expect, it } from 'vitest';
import { RECORDING_GAL } from './support/recording_gal.js';

const [DEFAULT_THEME] = COLOR_SETTINGS.CreateBuiltinColorSettings();
const MIL = 254;

afterEach(() => setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS));

function painter() {
  const gal = new RECORDING_GAL();
  const p = new SCH_PAINTER(gal);
  p.GetSettings().LoadColors(DEFAULT_THEME!);
  return { gal, p, layer: (l: number) => p.GetSettings().GetLayerColor(l) };
}

const rect = (fill = FILL_T.NO_FILL, width = 10 * MIL) => {
  const s = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_NOTES, width, fill);
  s.SetStart({ x: 0, y: 0 });
  s.SetEnd({ x: 1000 * MIL, y: 500 * MIL });
  return s;
};

describe('SCH_PAINTER: shapes', () => {
  it('strokes a rectangle in the notes colour at its width', () => {
    const { gal, p, layer } = painter();
    p.Draw(rect(), SCH_LAYER_ID.LAYER_NOTES);
    expect(gal.draws).toEqual([
      expect.objectContaining({
        op: 'rect',
        a: { x: 0, y: 0 },
        b: { x: 1000 * MIL, y: 500 * MIL },
        stroke: true,
        fill: false,
        width: 10 * MIL,
      }),
    ]);
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_NOTES));
  });

  it('fills a colour-filled rectangle on the background layer, not in black-and-white print', () => {
    const { gal, p } = painter();
    const s = rect(FILL_T.FILLED_WITH_COLOR);
    s.SetFillColor({ r: 0, g: 0, b: 1, a: 1 });
    p.Draw(s, SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);
    expect(gal.draws).toEqual([
      expect.objectContaining({
        op: 'rect',
        fill: true,
        stroke: false,
        fillColor: { r: 0, g: 0, b: 1, a: 1 },
      }),
    ]);

    gal.calls.length = 0;
    p.GetSettings().SetIsPrinting(true);
    p.GetSettings().SetPrintBlackAndWhite(true);
    p.Draw(s, SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);
    expect(gal.draws).toHaveLength(0);
  });

  it('fills a body-coloured (FILLED_SHAPE) rectangle in the foreground, then strokes it', () => {
    const { gal, p } = painter();
    p.Draw(rect(FILL_T.FILLED_SHAPE), SCH_LAYER_ID.LAYER_NOTES);
    expect(gal.draws.map((d) => [d.op, d.fill, d.stroke])).toEqual([
      ['rect', true, false],
      ['rect', false, true],
    ]);

    gal.calls.length = 0;
    p.Draw(rect(FILL_T.FILLED_SHAPE), SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);
    expect(gal.draws).toHaveLength(0); // "Fill in the foreground layer"
  });

  it('draws a circle at its centre with its radius', () => {
    const { gal, p } = painter();
    const c = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_NOTES, 10 * MIL);
    c.SetCenter({ x: 100 * MIL, y: 200 * MIL });
    c.SetEnd({ x: 150 * MIL, y: 200 * MIL });
    p.Draw(c, SCH_LAYER_ID.LAYER_NOTES);
    expect(gal.draws[0]).toMatchObject({
      op: 'circle',
      c: { x: 100 * MIL, y: 200 * MIL },
      r: 50 * MIL,
    });
  });

  it('dashes a dashed rectangle along its four edges', () => {
    const { gal, p } = painter();
    const s = rect();
    s.SetLineStyle(LINE_STYLE.DASH);
    p.Draw(s, SCH_LAYER_ID.LAYER_NOTES);
    const lines = gal.draws.filter((d) => d.op === 'line');
    expect(lines.length).toBeGreaterThan(8);
    expect(gal.draws.some((d) => d.op === 'rect')).toBe(false);
  });

  it('draws a Bezier as a curve, and dashes it along its flattened polyline', () => {
    const { gal, p } = painter();
    const b = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_NOTES, 10 * MIL);
    b.SetStart({ x: 0, y: 0 });
    b.SetBezierC1({ x: 0, y: 500 * MIL });
    b.SetBezierC2({ x: 1000 * MIL, y: 500 * MIL });
    b.SetEnd({ x: 1000 * MIL, y: 0 });
    p.Draw(b, SCH_LAYER_ID.LAYER_NOTES);
    expect(gal.draws.map((d) => d.op)).toEqual(['curve']);

    gal.calls.length = 0;
    b.SetLineStyle(LINE_STYLE.DASH);
    p.Draw(b, SCH_LAYER_ID.LAYER_NOTES);
    const lines = gal.draws.filter((d) => d.op === 'line');
    expect(lines.length).toBeGreaterThan(2);
    // The first dash starts at the curve's start.
    expect(lines[0]).toMatchObject({ a: { x: 0, y: 0 } });
  });

  it('draws a polygon through each segment start and the last end', () => {
    const { gal, p } = painter();
    const poly = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_NOTES, 10 * MIL);
    poly.AddPoint({ x: 0, y: 0 });
    poly.AddPoint({ x: 100 * MIL, y: 0 });
    poly.AddPoint({ x: 100 * MIL, y: 100 * MIL });
    p.Draw(poly, SCH_LAYER_ID.LAYER_NOTES);
    expect(gal.draws[0]).toMatchObject({
      op: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 100 * MIL, y: 0 },
        { x: 100 * MIL, y: 100 * MIL },
      ],
    });
  });

  it('hatches a hatched rectangle on the background layer with lines', () => {
    const { gal, p } = painter();
    const s = rect(FILL_T.HATCH);
    s.SetFillColor({ r: 1, g: 0, b: 0, a: 1 });
    p.Draw(s, SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);
    const lines = gal.draws.filter((d) => d.op === 'line');
    expect(lines.length).toBeGreaterThan(3);
    expect(lines[0]!.width).toBe(s.GetHatchLineWidth());
  });

  it("fills a selected shape's shadow per the preference, an arc by its own fill", () => {
    const { gal, p } = painter();
    const s = rect();
    s.SetSelected();
    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      selection: { ...EESCHEMA_DEFAULTS.selection, fill_shapes: true },
    }));
    p.Draw(s, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws[0]).toMatchObject({ op: 'rect', fill: true, stroke: true });

    gal.calls.length = 0;
    const arc = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_NOTES, 10 * MIL);
    arc.SetArcGeometry({ x: 0, y: 0 }, { x: 50 * MIL, y: 50 * MIL }, { x: 100 * MIL, y: 0 });
    arc.SetSelected();
    p.Draw(arc, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws[0]).toMatchObject({ op: 'arc', fill: false });
  });
});

describe('SCH_PAINTER: sheets', () => {
  const sheet = () => new SCH_SHEET(null, { x: 0, y: 0 }, { x: 2000 * MIL, y: 1000 * MIL });

  it('strokes the sheet box on LAYER_SHEET', () => {
    const { gal, p, layer } = painter();
    p.Draw(sheet(), SCH_LAYER_ID.LAYER_SHEET);
    const r = gal.draws.find((d) => d.op === 'rect')!;
    expect(r).toMatchObject({
      a: { x: 0, y: 0 },
      b: { x: 2000 * MIL, y: 1000 * MIL },
      stroke: true,
    });
    expect(r.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_SHEET));
  });

  it('fills the background only when its colour is visible', () => {
    const { gal, p } = painter();
    const s = sheet();
    p.GetSettings().SetLayerColor(SCH_LAYER_ID.LAYER_SHEET_BACKGROUND, { r: 1, g: 1, b: 1, a: 0 });
    p.Draw(s, SCH_LAYER_ID.LAYER_SHEET_BACKGROUND);
    expect(gal.draws.filter((d) => d.op === 'rect')).toHaveLength(0);

    s.SetBackgroundColor({ r: 1, g: 1, b: 0, a: 1 });
    p.Draw(s, SCH_LAYER_ID.LAYER_SHEET_BACKGROUND);
    expect(gal.draws.filter((d) => d.op === 'rect')).toEqual([
      expect.objectContaining({ fill: true, stroke: false, fillColor: { r: 1, g: 1, b: 0, a: 1 } }),
    ]);
  });
});

describe('SCH_PAINTER: tables', () => {
  function table() {
    const t = new SCH_TABLE(10 * MIL);
    t.SetColCount(2);
    for (let i = 0; i < 4; i++) t.AddCell(new SCH_TABLECELL());
    t.SetColWidth(0, 500 * MIL);
    t.SetColWidth(1, 500 * MIL);
    t.SetRowHeight(0, 200 * MIL);
    t.SetRowHeight(1, 200 * MIL);
    t.Normalize();
    return t;
  }

  it('draws the external border and both separators, each once', () => {
    const t = table();
    t.SetStrokeExternal(true);
    t.SetStrokeHeaderSeparator(true);
    t.SetStrokeColumns(true);
    t.SetStrokeRows(true);
    const seen: string[] = [];
    t.DrawBorders((a, b) => seen.push(`${a.x},${a.y}-${b.x},${b.y}`));
    // 2 column-separator segments (one per row) + 2 row-separator segments + 4 border sides
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });

  it('draws no inner lines when separators are off, and no outline when the border is', () => {
    const t = table();
    t.SetStrokeExternal(false);
    t.SetStrokeHeaderSeparator(false);
    t.SetStrokeColumns(false);
    t.SetStrokeRows(false);
    const seen: unknown[] = [];
    t.DrawBorders(() => seen.push(1));
    expect(seen).toHaveLength(0);
  });

  it('paints the border lines in the notes colour at the default pen when unset', () => {
    const { gal, p, layer } = painter();
    const t = new SCH_TABLE(0);
    t.SetColCount(1);
    t.AddCell(new SCH_TABLECELL());
    t.SetColWidth(0, 500 * MIL);
    t.SetRowHeight(0, 200 * MIL);
    t.Normalize();
    t.SetStrokeExternal(true);
    p.Draw(t, SCH_LAYER_ID.LAYER_NOTES);
    const lines = gal.draws.filter((d) => d.op === 'line');
    expect(lines).toHaveLength(4);
    expect(lines[0]!.width).toBe(6 * MIL);
    expect(lines[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_NOTES));
  });
});

describe('SCH_PAINTER: groups', () => {
  it('outlines a selected group on the anchor layer, and nothing for an unselected one', () => {
    const { gal, p } = painter();
    const g = new SCH_GROUP();
    g.AddItem(rect());
    p.Draw(g, SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR);
    expect(gal.draws).toHaveLength(0);

    g.SetSelected();
    p.Draw(g, SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR);
    expect(gal.draws.filter((d) => d.op === 'line')).toHaveLength(4);
  });
});

describe('PrintableCharCount', () => {
  it('counts what shows: no tabs, no markup braces', () => {
    expect(PrintableCharCount('abc')).toBe(3);
    expect(PrintableCharCount('a\tb')).toBe(2);
    expect(PrintableCharCount('V^{2}')).toBe(2);
    expect(PrintableCharCount('~{CS}')).toBe(2);
    expect(PrintableCharCount('I_{out}')).toBe(4);
    expect(PrintableCharCount('{x}')).toBe(3); // a plain brace pair counts
  });
});

describe('STROKE_PARAMS::Stroke on a line chain', () => {
  it('carries the dash pattern across a corner instead of restarting it', () => {
    const w = 6 * MIL; // 1524
    const dash = 11 * w; // GetDashLength: ( 12 - 1 ) * width
    const gap = 4 * w; // GetGapLength: ( 3 + 1 ) * width
    const chain = new SHAPE_LINE_CHAIN([
      { x: 0, y: 0 },
      { x: 20000, y: 0 },
      { x: 20000, y: 40000 },
    ]);
    const out: string[] = [];
    STROKE_PARAMS.Stroke(chain, LINE_STYLE.DASH, w, new SCH_RENDER_SETTINGS(), (a, b) =>
      out.push(`${a.x},${a.y}-${b.x},${b.y}`),
    );
    // The first gap starts at 16764 and runs 3236 to the corner, then 2860 down the second leg.
    const leftover = gap - (20000 - dash);
    expect(out.slice(0, 2)).toEqual([
      `0,0-${dash},0`,
      `20000,${leftover}-20000,${leftover + dash}`,
    ]);
  });
});
