// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The text and shape classes of the live model (eeschema stage E3): `SCH_TEXT`,
 * `SCH_LABEL_BASE` and its kinds, `SCH_SHAPE`, `SCH_TEXTBOX`. Each expectation is
 * the C++ arithmetic on the stated inputs (sch_text.cpp, sch_label.cpp,
 * sch_shape.cpp, sch_textbox.cpp) with no SCHEMATIC parent: a default text is
 * 50 mil = 12700 IU high.
 */
import { describe, expect, it } from 'vitest';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  SPIN_STYLE,
} from '@ziroeda/eeschema/sch_label.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_TEXTBOX } from '@ziroeda/eeschema/sch_textbox.js';

describe('SPIN_STYLE', () => {
  it('rotates and mirrors as the C++ switch tables do', () => {
    const s = (v: number) => new SPIN_STYLE(v);
    expect(Number(s(SPIN_STYLE.LEFT).RotateCCW())).toBe(SPIN_STYLE.BOTTOM);
    expect(Number(s(SPIN_STYLE.UP).RotateCCW())).toBe(SPIN_STYLE.LEFT);
    expect(Number(s(SPIN_STYLE.UP).MirrorX())).toBe(SPIN_STYLE.BOTTOM);
    expect(Number(s(SPIN_STYLE.LEFT).MirrorX())).toBe(SPIN_STYLE.LEFT);
    expect(Number(s(SPIN_STYLE.RIGHT).MirrorY())).toBe(SPIN_STYLE.LEFT);
    expect(s(SPIN_STYLE.LEFT).CCWRotationsTo(s(SPIN_STYLE.BOTTOM))).toBe(1);
  });
});

describe('SCH_LABEL_BASE', () => {
  it('SetSpinStyle picks the angle and justification; GetSpinStyle reads them back', () => {
    const l = new SCH_LABEL({ x: 0, y: 0 }, 'A');
    for (const spin of [SPIN_STYLE.LEFT, SPIN_STYLE.UP, SPIN_STYLE.RIGHT, SPIN_STYLE.BOTTOM]) {
      l.SetSpinStyle(new SPIN_STYLE(spin));
      expect(Number(l.GetSpinStyle())).toBe(spin);
      expect(l.GetVertJustify()).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
    }
    l.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
    expect(l.GetTextAngle().equals(ANGLE_VERTICAL)).toBe(true);
    expect(l.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
  });

  it('a global label is born with a hidden ${INTERSHEET_REFS} field', () => {
    const g = new SCH_GLOBALLABEL({ x: 100, y: 200 }, 'SDA');
    expect(g.GetShape()).toBe(LABEL_FLAG_SHAPE.L_BIDI);
    expect(g.GetFields().length).toBe(1);
    const f = g.GetFields()[0]!;
    expect(f.GetId()).toBe(FIELD_T.INTERSHEET_REFS);
    expect(f.GetText()).toBe('${INTERSHEET_REFS}');
    expect(f.IsVisible()).toBe(false);
    expect(f.GetTextPos()).toEqual({ x: 100, y: 200 });
    // a label's field names go through SCH_LABEL_BASE::GetDefaultFieldName
    expect(f.GetName()).toBe('Sheet References');
    expect(f.GetParent()).toBe(g);

    const copy = g.Clone();
    expect(copy.GetFields()[0]!.GetParent()).toBe(copy);
    expect(copy.GetFields()[0]!.m_Uuid).toBe(f.m_Uuid);
  });

  it('the hierarchical label shape follows the template table', () => {
    const h = new SCH_HIERLABEL({ x: 1000, y: 0 }, 'IN');
    h.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT)); // HN column
    const pts: { x: number; y: number }[] = [];
    h.CreateGraphicShape(null, pts, h.GetTextPos());
    // TemplateIN_HN = 6 corners, halfSize = 12700 / 2
    expect(pts).toEqual([
      { x: 1000, y: 0 },
      { x: 1000 - 6350, y: -6350 },
      { x: 1000 - 12700, y: -6350 },
      { x: 1000 - 12700, y: 6350 },
      { x: 1000 - 6350, y: 6350 },
      { x: 1000, y: 0 },
    ]);
  });

  it('a directive label draws its round flag 100 mil down the pin', () => {
    const d = new SCH_DIRECTIVE_LABEL({ x: 0, y: 0 });
    expect(d.GetPinLength()).toBe(25400);
    const pts: { x: number; y: number }[] = [];
    // a fresh label reads as spin RIGHT (angle 0, not right-justified): turned 180 degrees
    d.CreateGraphicShape(null, pts, { x: 0, y: 0 });
    expect(pts[2]).toEqual({ x: 0, y: -25400 });
    // spin LEFT is the unrotated template
    d.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
    d.CreateGraphicShape(null, pts, { x: 0, y: 0 });
    expect(pts.slice(0, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 25400 - 5080 },
      { x: 0, y: 25400 },
    ]);
    // no rule areas: dangling
    expect(d.IsDangling()).toBe(true);
  });

  it('Move carries the fields along; Rotate turns the spin clockwise about a centre', () => {
    const g = new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'N');
    g.Move({ x: 10, y: 20 });
    expect(g.GetPosition()).toEqual({ x: 10, y: 20 });
    expect(g.GetFields()[0]!.GetTextPos()).toEqual({ x: 10, y: 20 });

    const l = new SCH_LABEL({ x: 100, y: 0 }, 'A');
    l.Rotate({ x: 0, y: 0 }, true);
    expect(l.GetPosition()).toEqual({ x: 0, y: -100 });
    expect(Number(l.GetSpinStyle())).toBe(SPIN_STYLE.UP);
  });

  it('the label kinds carry their own types and layers', () => {
    expect(new SCH_LABEL().Type()).toBe(KICAD_T.SCH_LABEL_T);
    expect(new SCH_LABEL().GetLayer()).toBe(SCH_LAYER_ID.LAYER_LOCLABEL);
    expect(new SCH_HIERLABEL().GetLayer()).toBe(SCH_LAYER_ID.LAYER_HIERLABEL);
    expect(new SCH_DIRECTIVE_LABEL().GetLayer()).toBe(SCH_LAYER_ID.LAYER_NETCLASS_REFS);
    expect(new SCH_LABEL().IsType([KICAD_T.SCH_LABEL_LOCATE_ANY_T])).toBe(true);
  });
});

describe('SCH_TEXT', () => {
  it('operator< sorts by layer, position, sim exclusion, then text', () => {
    const a = new SCH_TEXT({ x: 0, y: 0 }, 'b');
    const b = new SCH_TEXT({ x: 0, y: 0 }, 'a');
    expect(b.lessThan(a)).toBe(true);
    expect(a.lessThan(b)).toBe(false);
    // any sim-exclusion difference answers true, whichever way round (int-to-bool)
    a.SetExcludedFromSim(true);
    expect(a.lessThan(b)).toBe(true);
    expect(b.lessThan(a)).toBe(true);
  });

  it('Rotate90 flips the justification only from horizontal clockwise', () => {
    const t = new SCH_TEXT({ x: 0, y: 0 }, 'x');
    t.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    t.Rotate90(true);
    expect(t.GetTextAngle().equals(ANGLE_VERTICAL)).toBe(true);
    expect(t.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
  });
});

describe('SCH_SHAPE / SCH_TEXTBOX', () => {
  it('SetFilled picks outline fill in a symbol, colour fill in a schematic', () => {
    const s = new SCH_SHAPE(SHAPE_T.RECTANGLE);
    s.SetFilled(true);
    expect(s.GetFillMode()).toBe(FILL_T.FILLED_WITH_COLOR);
  });

  it('Normalize makes a rectangle start at its top-left', () => {
    const s = new SCH_SHAPE(SHAPE_T.RECTANGLE);
    s.SetStart({ x: 100, y: 100 });
    s.SetEnd({ x: 0, y: 0 });
    s.Normalize();
    expect([s.GetStart(), s.GetEnd()]).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it('a text box margin is half the stroke plus 0.75 of the text height', () => {
    const tb = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_NOTES, 0, FILL_T.NO_FILL, 'hi');
    // KiROUND( 0 / 2 ) + KiROUND( 12700 * 0.75 )
    expect(tb.GetMarginLeft()).toBe(9525);
    expect(tb.GetShape()).toBe(SHAPE_T.RECTANGLE);
    const dev = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_DEVICE);
    expect(dev.GetMarginTop()).toBe(10160); // KiROUND( 12700 * 0.8 )

    tb.SetStart({ x: 0, y: 0 });
    tb.SetEnd({ x: 100000, y: 50000 });
    expect(tb.GetDrawPos()).toEqual({ x: 9525, y: 9525 });
    expect(tb.Clone().GetText()).toBe('hi');
  });
});
