// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_PAINTER (sch_painter.cpp) on a recording GAL: what each draw() hands the GAL,
 * read off the C++ for one item of each kind. S4-2 covers the colour and pen queries and the
 * connection items (junction, wire/bus line, no-connect, bus entry, marker).
 */
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { ENDPOINT, IS_NEW, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { SCH_BUS_BUS_ENTRY, SCH_BUS_WIRE_ENTRY } from '@ziroeda/eeschema/sch_bus_entry.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_NO_CONNECT } from '@ziroeda/eeschema/sch_no_connect.js';
import { SCH_PAINTER } from '@ziroeda/eeschema/sch_painter.js';
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

const wire = (x1: number, y1: number, x2: number, y2: number) => {
  const line = new SCH_LINE({ x: x1, y: y1 }, SCH_LAYER_ID.LAYER_WIRE);
  line.SetEndPoint({ x: x2, y: y2 });
  return line;
};

describe('SCH_PAINTER: junctions', () => {
  it('fills a circle of half the diameter in the junction colour', () => {
    const { gal, p, layer } = painter();
    p.Draw(new SCH_JUNCTION({ x: 100, y: 200 }, 1000), SCH_LAYER_ID.LAYER_JUNCTION);

    expect(gal.draws).toHaveLength(1);
    const [c] = gal.draws;
    expect(c).toMatchObject({
      op: 'circle',
      c: { x: 100, y: 200 },
      r: 500,
      fill: true,
      stroke: false,
    });
    expect(c!.fillColor).toEqual(layer(SCH_LAYER_ID.LAYER_JUNCTION));
  });

  it('draws no shadow for an unselected junction, and a stroked ring for a selected one', () => {
    const { gal, p, layer } = painter();
    const j = new SCH_JUNCTION({ x: 0, y: 0 }, 1000);
    p.Draw(j, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws).toHaveLength(0);

    j.SetSelected();
    p.Draw(j, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws[0]).toMatchObject({ op: 'circle', r: 500, fill: false, stroke: true });
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_SELECTION_SHADOWS));
  });

  it('draws no shadows at all when printing', () => {
    const { gal, p } = painter();
    const j = new SCH_JUNCTION({ x: 0, y: 0 }, 1000);
    j.SetSelected();
    p.GetSettings().SetIsPrinting(true);
    p.Draw(j, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws).toHaveLength(0);
  });

  it('draws nothing for a junction of radius 1 or less', () => {
    const { gal, p } = painter();
    p.Draw(new SCH_JUNCTION({ x: 0, y: 0 }, 3), SCH_LAYER_ID.LAYER_JUNCTION);
    expect(gal.draws).toHaveLength(0);
  });
});

describe('SCH_PAINTER: lines', () => {
  it('strokes a wire in the wire colour at its 6 mil pen', () => {
    const { gal, p, layer } = painter();
    p.Draw(wire(0, 0, 10000, 0), SCH_LAYER_ID.LAYER_WIRE);

    expect(gal.draws).toEqual([
      expect.objectContaining({
        op: 'line',
        a: { x: 0, y: 0 },
        b: { x: 10000, y: 0 },
        width: 6 * MIL,
      }),
    ]);
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_WIRE));
  });

  it('dashes a dashed line through STROKE_PARAMS::Stroke, dash (12 - 1) and gap (3 + 1) widths', () => {
    const { gal, p } = painter();
    const line = wire(0, 0, 100000, 0);
    line.SetLineStyle(LINE_STYLE.DASH);
    p.Draw(line, SCH_LAYER_ID.LAYER_WIRE);

    const lines = gal.draws.filter((d) => d.op === 'line');
    expect(lines.length).toBeGreaterThan(3);
    // GetDashLength = max( 12 - correction, 1 ) * width, correction 1 for the pen's own width
    // (render_settings.cpp:69); the gap is ( 3 + 1 ) * width (:83).
    expect(lines[0]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 11 * 6 * MIL, y: 0 } });
    expect(lines[1]).toMatchObject({ a: { x: 15 * 6 * MIL, y: 0 }, b: { x: 26 * 6 * MIL, y: 0 } });
  });

  it('marks a dangling wire end with a box on the dangling layer, and nothing else', () => {
    const { gal, p } = painter();
    const line = wire(0, 0, 10000, 0);
    (line as unknown as { m_startIsDangling: boolean }).m_startIsDangling = true;
    (line as unknown as { m_endIsDangling: boolean }).m_endIsDangling = false;
    p.Draw(line, SCH_LAYER_ID.LAYER_DANGLING);

    // DANGLING_SYMBOL_SIZE 12 mil: radius = width + 6 mil
    const r = 6 * MIL + 6 * MIL;
    expect(gal.draws).toEqual([
      expect.objectContaining({ op: 'rect', a: { x: -r, y: -r }, b: { x: r, y: r }, fill: false }),
    ]);
    // GetDanglingIndicatorThickness: the default pen over three
    expect(gal.draws[0]!.width).toBe(508);
  });

  it("shows a selected line's unflagged ends on the shadow layer, inverted", () => {
    const { gal, p, layer } = painter();
    const line = wire(0, 0, 10000, 0);
    line.SetSelected();
    line.SetFlags(ENDPOINT); // the end is being dragged: only the start shows
    p.Draw(line, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);

    const rects = gal.draws.filter((d) => d.op === 'rect');
    expect(rects).toHaveLength(1);
    const shadow = layer(SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    // UNSELECTED_END_SIZE 4 mil, half the (rounded) width
    const w = Math.trunc(Math.round(gal.draws.find((d) => d.op === 'line')!.width) / 2);
    const r = w + 2 * MIL;
    expect(rects[0]).toMatchObject({ a: { x: -r, y: -r }, b: { x: r, y: r } });
    // Inverted, then brightened by 0.3
    const inv = { r: 1 - shadow.r, g: 1 - shadow.g, b: 1 - shadow.b };
    expect(rects[0]!.strokeColor.r).toBeCloseTo(inv.r + (1 - inv.r) * 0.3, 6);
    void STARTPOINT;
  });

  it('skips a new line on the dangling layer', () => {
    const { gal, p } = painter();
    const line = wire(0, 0, 10000, 0);
    (line as unknown as { m_startIsDangling: boolean }).m_startIsDangling = true;
    line.SetFlags(IS_NEW);
    p.Draw(line, SCH_LAYER_ID.LAYER_DANGLING);
    expect(gal.draws).toHaveLength(0);
  });

  it('draws net-colour highlights only when the preference is on, and never for default nets', () => {
    const { gal, p } = painter();
    p.Draw(wire(0, 0, 10000, 0), SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT);
    expect(gal.draws).toHaveLength(0);

    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      selection: { ...EESCHEMA_DEFAULTS.selection, highlight_netclass_colors: true },
    }));
    p.Draw(wire(0, 0, 10000, 0), SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT);
    expect(gal.draws).toHaveLength(0); // default-coloured wire

    const red = wire(0, 0, 10000, 0);
    red.SetLineColor({ r: 1, g: 0, b: 0, a: 1 });
    p.Draw(red, SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT);
    expect(gal.draws).toHaveLength(1);
    // 6 mil pen + 15 mil highlight, at 0.6 alpha
    expect(gal.draws[0]).toMatchObject({ width: 6 * MIL + 15 * MIL });
    expect(gal.draws[0]!.strokeColor.a).toBeCloseTo(0.6, 6);
  });
});

describe('SCH_PAINTER: no-connects', () => {
  it('crosses two lines over max(size, 3 pens) / 2 each way', () => {
    const { gal, p, layer } = painter();
    p.Draw(new SCH_NO_CONNECT({ x: 1000, y: 2000 }), SCH_LAYER_ID.LAYER_NOCONNECT);

    const d = (48 * MIL) / 2; // DEFAULT_NOCONNECT_SIZE 48 mil
    expect(gal.draws.map((c) => (c.op === 'line' ? [c.a, c.b] : null))).toEqual([
      [
        { x: 1000 - d, y: 2000 - d },
        { x: 1000 + d, y: 2000 + d },
      ],
      [
        { x: 1000 - d, y: 2000 + d },
        { x: 1000 + d, y: 2000 - d },
      ],
    ]);
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_NOCONNECT));
  });

  it('never draws smaller than three default pens', () => {
    const { gal, p } = painter();
    const nc = new SCH_NO_CONNECT({ x: 0, y: 0 });
    (nc as unknown as { m_size: number }).m_size = 10;
    p.Draw(nc, SCH_LAYER_ID.LAYER_NOCONNECT);
    const d = Math.trunc((3 * 6 * MIL) / 2);
    expect(gal.draws[0]).toMatchObject({ a: { x: -d, y: -d }, b: { x: d, y: d } });
  });
});

describe('SCH_PAINTER: bus entries', () => {
  it('draws a wire entry as a wire-coloured line from its position to its end', () => {
    const { gal, p, layer } = painter();
    const entry = new SCH_BUS_WIRE_ENTRY({ x: 0, y: 0 });
    p.Draw(entry, SCH_LAYER_ID.LAYER_WIRE);

    expect(gal.draws).toHaveLength(1);
    expect(gal.draws[0]).toMatchObject({ op: 'line', a: entry.GetPosition(), b: entry.GetEnd() });
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_WIRE));
  });

  it('draws a bus entry in the bus colour', () => {
    const { gal, p, layer } = painter();
    p.Draw(new SCH_BUS_BUS_ENTRY({ x: 0, y: 0 }), SCH_LAYER_ID.LAYER_BUS);
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_BUS));
  });

  it('rings a dangling end on the dangling layer', () => {
    const { gal, p } = painter();
    const entry = new SCH_BUS_WIRE_ENTRY({ x: 0, y: 0 });
    (entry as unknown as { m_isStartDangling: boolean }).m_isStartDangling = true;
    (entry as unknown as { m_isEndDangling: boolean }).m_isEndDangling = false;
    p.Draw(entry, SCH_LAYER_ID.LAYER_DANGLING);

    // GetPenWidth() + KiROUND( TARGET_BUSENTRY_RADIUS / 2 ), TARGET_BUSENTRY_RADIUS = 12 mil
    expect(gal.draws).toEqual([
      expect.objectContaining({
        op: 'circle',
        c: { x: 0, y: 0 },
        r: entry.GetPenWidth() + 6 * MIL,
      }),
    ]);
  });
});

describe('SCH_PAINTER: render colours', () => {
  it('uses the brightened colour for a brightened item, its shadow at 0.15 alpha', () => {
    const { gal, p, layer } = painter();
    const j = new SCH_JUNCTION({ x: 0, y: 0 }, 1000);
    j.SetBrightened();
    p.Draw(j, SCH_LAYER_ID.LAYER_JUNCTION);
    expect(gal.draws[0]!.fillColor).toEqual(layer(SCH_LAYER_ID.LAYER_BRIGHTENED));

    p.Draw(j, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws[1]!.strokeColor).toEqual({ ...layer(SCH_LAYER_ID.LAYER_BRIGHTENED), a: 0.15 });
  });

  it("uses the item's own colour unless the theme overrides item colours", () => {
    const { gal, p, layer } = painter();
    const red = wire(0, 0, 10000, 0);
    red.SetLineColor({ r: 1, g: 0, b: 0, a: 1 });
    p.Draw(red, SCH_LAYER_ID.LAYER_WIRE);
    expect(gal.draws[0]!.strokeColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });

    p.GetSettings().m_OverrideItemColors = true;
    p.Draw(red, SCH_LAYER_ID.LAYER_WIRE);
    expect(gal.draws[1]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_WIRE));
  });

  it('darkens everything by half when showing disabled', () => {
    const { gal, p, layer } = painter();
    p.GetSettings().m_ShowDisabled = true;
    p.Draw(wire(0, 0, 10000, 0), SCH_LAYER_ID.LAYER_WIRE);
    const w = layer(SCH_LAYER_ID.LAYER_WIRE);
    expect(w.g).toBeGreaterThan(0); // the default wire colour is (0, 150, 0)
    expect(gal.draws[0]!.strokeColor.g).toBeCloseTo(w.g * 0.5, 6);
  });

  it('widens a selected scaled-selection item by the shadow width', () => {
    const { gal, p } = painter();
    const j = new SCH_JUNCTION({ x: 0, y: 0 }, 1000);
    j.SetSelected();
    p.Draw(j, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    // pen (0 for a junction: GetEffectivePenWidth) + |scale.x * 3| + 3 mil (selection.thickness 3)
    // float width = pen; width += (float)( |scale.x * 3| + MilsToIU( 3 ) ), in float arithmetic
    const shadow = Math.fround(Math.abs(gal.GetScreenWorldMatrix().GetScale().x * 3) + 3 * MIL);
    const pen = Math.fround(j.GetEffectivePenWidth(p.GetSettings()));
    expect(gal.draws[0]!.width).toBe(Math.fround(pen + shadow));
  });
});

describe('SCH_PAINTER: bounding boxes', () => {
  it('outlines each item in grey on request', () => {
    const { gal, p } = painter();
    p.GetSettings().SetDrawBoundingBoxes(true);
    const nc = new SCH_NO_CONNECT({ x: 0, y: 0 });
    p.Draw(nc, SCH_LAYER_ID.LAYER_NOCONNECT);

    const box = nc.GetBoundingBox();
    expect(gal.draws.at(-1)).toMatchObject({
      op: 'rect',
      a: box.GetOrigin(),
      b: box.GetEnd(),
      width: 3 * MIL,
      strokeColor: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
    });
  });
});
