// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_PAINTER's text items (sch_painter.cpp, S4-3): SCH_TEXT, the four labels,
 * SCH_FIELD and SCH_TEXTBOX on a recording GAL, each expectation read off the C++.
 */
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
} from '@ziroeda/eeschema/sch_label.js';
import { SCH_PAINTER } from '@ziroeda/eeschema/sch_painter.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_TEXTBOX } from '@ziroeda/eeschema/sch_textbox.js';
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

const settings = (patch: {
  appearance?: Partial<typeof EESCHEMA_DEFAULTS.appearance>;
  selection?: Partial<typeof EESCHEMA_DEFAULTS.selection>;
}) =>
  setEeschemaSettingsProvider(() => ({
    ...EESCHEMA_DEFAULTS,
    appearance: { ...EESCHEMA_DEFAULTS.appearance, ...patch.appearance },
    selection: { ...EESCHEMA_DEFAULTS.selection, ...patch.selection },
  }));

const ops = (gal: RECORDING_GAL) => gal.draws.map((d) => d.op);

describe('SCH_PAINTER: SCH_TEXT', () => {
  it('strokes its glyphs in the notes colour', () => {
    const { gal, p, layer } = painter();
    p.Draw(new SCH_TEXT({ x: 0, y: 0 }, 'AB'), SCH_LAYER_ID.LAYER_NOTES);

    const glyphs = gal.draws.filter((d) => d.op === 'glyph');
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0]).toMatchObject({ stroke: true, fill: false });
    expect(glyphs[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_NOTES));
  });

  it('draws a hidden text only when hidden fields are shown, in the hidden colour', () => {
    const { gal, p, layer } = painter();
    const text = new SCH_TEXT({ x: 0, y: 0 }, 'AB');
    text.SetVisible(false);
    p.Draw(text, SCH_LAYER_ID.LAYER_NOTES);
    expect(gal.draws).toHaveLength(0);

    settings({ appearance: { show_hidden_fields: true } });
    p.Draw(text, SCH_LAYER_ID.LAYER_NOTES);
    expect(gal.draws.length).toBeGreaterThan(0);
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_HIDDEN));
  });

  it('marks a selected text with an anchor cross at its position', () => {
    const { gal, p, layer } = painter();
    const text = new SCH_TEXT({ x: 1000, y: 2000 }, 'AB');
    text.SetSelected();
    p.Draw(text, SCH_LAYER_ID.LAYER_NOTES);

    const lines = gal.draws.filter((d) => d.op === 'line');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR));
    // a horizontal then a vertical stroke through the position
    expect(lines[0]!.a.y).toBe(2000);
    expect(lines[1]!.a.x).toBe(1000);
    expect((lines[0]!.a.x + (lines[0] as { b: { x: number } }).b.x) / 2).toBe(1000);
  });

  it('draws nothing for an unselected text on the shadow layer', () => {
    const { gal, p } = painter();
    p.Draw(new SCH_TEXT({ x: 0, y: 0 }, 'AB'), SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws).toHaveLength(0);
  });
});

describe('SCH_PAINTER: labels', () => {
  // SCH_LABEL_BASE::ViewGetLayers (sch_label.cpp:1095): a label's shape and text draw on
  // LAYER_DEVICE; LAYER_NETCLASS_REFS and LAYER_FIELDS carry its fields.
  it('draws only the fields of a directive label on the netclass-refs layer', () => {
    const { gal, p } = painter();
    p.Draw(new SCH_DIRECTIVE_LABEL({ x: 0, y: 0 }), SCH_LAYER_ID.LAYER_NETCLASS_REFS);
    expect(ops(gal)).not.toContain('polyline');
    expect(ops(gal)).not.toContain('circle');
  });

  it('outlines a global label with its flag shape, then strokes its text', () => {
    const { gal, p, layer } = painter();
    const label = new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'NET');
    p.Draw(label, SCH_LAYER_ID.LAYER_GLOBLABEL);

    const shape: { x: number; y: number }[] = [];
    label.CreateGraphicShape(p.GetSettings(), shape, label.GetTextPos());
    expect(gal.draws[0]).toMatchObject({
      op: 'polyline',
      points: shape,
      fill: false,
      stroke: true,
    });
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_GLOBLABEL));
    expect(ops(gal).filter((o) => o === 'glyph')).toHaveLength(3);
  });

  it("fills a selected global label's shadow only when the preference says so", () => {
    const { gal, p } = painter();
    const label = new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'NET');
    label.SetSelected();
    p.Draw(label, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    const poly = gal.draws.find((d) => d.op === 'polygon')!;
    expect(poly.fill).toBe(EESCHEMA_DEFAULTS.selection.fill_shapes);

    gal.calls.length = 0;
    settings({ selection: { fill_shapes: !EESCHEMA_DEFAULTS.selection.fill_shapes } });
    p.Draw(label, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS);
    expect(gal.draws.find((d) => d.op === 'polygon')!.fill).toBe(
      !EESCHEMA_DEFAULTS.selection.fill_shapes,
    );
  });

  it('fills a hierarchical label in the background colour', () => {
    const { gal, p, layer } = painter();
    p.Draw(new SCH_HIERLABEL({ x: 0, y: 0 }, 'IN'), SCH_LAYER_ID.LAYER_HIERLABEL);
    expect(gal.draws[0]).toMatchObject({ op: 'polyline', fill: true, stroke: true });
    expect(gal.draws[0]!.fillColor).toEqual(layer(SCH_LAYER_ID.LAYER_SCHEMATIC_BACKGROUND));
    expect(gal.draws[0]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_HIERLABEL));
  });

  it('boxes a dangling local label on the dangling layer, at 6 mils plus the half size', () => {
    const { gal, p } = painter();
    const label = new SCH_LABEL({ x: 500, y: 700 }, 'n');
    p.Draw(label, SCH_LAYER_ID.LAYER_DANGLING);

    // drawDanglingIndicator( pos, color, MilsToIU( DANGLING_SYMBOL_SIZE / 2 ), true, ... )
    const r = 6 * MIL + 6 * MIL;
    expect(gal.draws).toEqual([
      expect.objectContaining({
        op: 'rect',
        a: { x: 500 - r, y: 700 - r },
        b: { x: 500 + r, y: 700 + r },
      }),
    ]);
  });

  it('gives a dangling selected local label no anchor, and a connected one an anchor', () => {
    const { gal, p } = painter();
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'n');
    label.SetSelected();
    p.Draw(label, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws.filter((d) => d.op === 'line')).toHaveLength(0);

    (label as unknown as { m_isDangling: boolean }).m_isDangling = false;
    gal.calls.length = 0;
    p.Draw(label, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws.filter((d) => d.op === 'line')).toHaveLength(2);
  });

  it('draws a dot directive label as a stem and a filled circle', () => {
    const { gal, p, layer } = painter();
    const label = new SCH_DIRECTIVE_LABEL({ x: 0, y: 0 });
    label.SetShape(LABEL_FLAG_SHAPE.F_DOT);
    p.Draw(label, SCH_LAYER_ID.LAYER_DEVICE);

    const pts: { x: number; y: number }[] = [];
    label.CreateGraphicShape(p.GetSettings(), pts, label.GetTextPos());
    const shapes = gal.draws.filter((d) => d.op === 'line' || d.op === 'circle');
    expect(shapes[0]).toMatchObject({ op: 'line', a: pts[0], b: pts[1] });
    expect(shapes[1]).toMatchObject({
      op: 'circle',
      c: pts[2],
      r: Math.hypot(pts[2]!.x - pts[1]!.x, pts[2]!.y - pts[1]!.y),
      fill: true,
    });
    expect(shapes[1]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_NETCLASS_REFS));
  });

  it('draws a round directive label with an unfilled circle', () => {
    const { gal, p } = painter();
    const label = new SCH_DIRECTIVE_LABEL({ x: 0, y: 0 });
    label.SetShape(LABEL_FLAG_SHAPE.F_ROUND);
    p.Draw(label, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws.find((d) => d.op === 'circle')!.fill).toBe(false);
  });

  it('hides unselected directive labels when the preference is off', () => {
    const { gal, p } = painter();
    settings({ appearance: { show_directive_labels: false } });
    const label = new SCH_DIRECTIVE_LABEL({ x: 0, y: 0 });
    p.Draw(label, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws).toHaveLength(0);

    label.SetSelected();
    p.Draw(label, SCH_LAYER_ID.LAYER_DEVICE);
    expect(gal.draws.length).toBeGreaterThan(0);
  });

  it("draws a label's fields on their own layer, and nothing of the label there", () => {
    const { gal, p } = painter();
    const label = new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'NET');
    const field = label.GetFields()[0]!; // the intersheet references field
    field.SetVisible(true);
    field.SetText('[1]');
    p.Draw(label, SCH_LAYER_ID.LAYER_INTERSHEET_REFS);

    // isFieldsLayer: the label stops after its fields - no flag outline
    expect(ops(gal)).not.toContain('polyline');
    expect(ops(gal).filter((o) => o === 'glyph').length).toBeGreaterThan(0);
  });
});

describe('SCH_PAINTER: fields', () => {
  it('draws nothing - not even the anchor - for a field whose shown text is empty', () => {
    const { gal, p } = painter();
    const label = new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'NET');
    const field = label.GetFields()[0]!;
    field.SetVisible(true);
    field.SetText('');
    field.SetSelected();
    p.Draw(field, SCH_LAYER_ID.LAYER_INTERSHEET_REFS);
    expect(gal.draws).toHaveLength(0);

    field.SetText('[1]');
    p.Draw(field, SCH_LAYER_ID.LAYER_INTERSHEET_REFS);
    expect(ops(gal)).toContain('line'); // the anchor of a selected field
  });
});

describe('SCH_PAINTER: text boxes', () => {
  it('fills a solid text box on the background layer', () => {
    const { gal, p } = painter();
    const box = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_NOTES, 0, FILL_T.FILLED_WITH_COLOR, 'x');
    box.SetStart({ x: 0, y: 0 });
    box.SetEnd({ x: 10000, y: 5000 });
    box.SetFillColor({ r: 0, g: 0, b: 1, a: 1 });
    p.Draw(box, SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);

    expect(gal.draws).toEqual([
      expect.objectContaining({
        op: 'rect',
        a: { x: 0, y: 0 },
        b: { x: 10000, y: 5000 },
        fill: true,
        stroke: false,
        fillColor: { r: 0, g: 0, b: 1, a: 1 },
      }),
    ]);
  });

  it('leaves an unfilled text box unfilled, however opaque its colour', () => {
    const { gal, p } = painter();
    // An opaque background colour: the theme's notes background is transparent, which would
    // skip the fill whatever IsSolidFill said.
    p.GetSettings().SetLayerColor(SCH_LAYER_ID.LAYER_NOTES_BACKGROUND, { r: 1, g: 1, b: 0, a: 1 });
    const box = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_NOTES, 0, FILL_T.NO_FILL, 'x');
    box.SetEnd({ x: 10000, y: 5000 });
    p.Draw(box, SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);
    expect(gal.draws).toHaveLength(0);
  });

  it('fills nothing in black-and-white print', () => {
    const { gal, p } = painter();
    const solid = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_NOTES, 0, FILL_T.FILLED_WITH_COLOR, 'x');
    solid.SetEnd({ x: 10000, y: 5000 });
    solid.SetFillColor({ r: 0, g: 0, b: 1, a: 1 });
    p.GetSettings().SetIsPrinting(true);
    p.Draw(solid, SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);
    expect(gal.draws).toHaveLength(1); // colour printing fills

    p.GetSettings().SetPrintBlackAndWhite(true);
    p.Draw(solid, SCH_LAYER_ID.LAYER_NOTES_BACKGROUND);
    expect(gal.draws).toHaveLength(1);
  });

  it('strokes the text, then the border in the notes colour at the border width', () => {
    const { gal, p, layer } = painter();
    const box = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_NOTES, 10 * MIL, FILL_T.NO_FILL, 'x');
    box.SetEnd({ x: 10000, y: 5000 });
    p.Draw(box, SCH_LAYER_ID.LAYER_NOTES);

    expect(ops(gal)).toEqual(['glyph', 'rect']);
    expect(gal.draws[1]).toMatchObject({ fill: false, stroke: true, width: 10 * MIL });
    expect(gal.draws[1]!.strokeColor).toEqual(layer(SCH_LAYER_ID.LAYER_NOTES));
  });
});
