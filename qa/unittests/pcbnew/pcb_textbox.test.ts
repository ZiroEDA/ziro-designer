// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_TEXTBOX over PCB_SHAPE + EDA_TEXT (`pcbnew/pcb_textbox.cpp`). Every
 * expected number below was read from KiCad's own `pcbnew` python module on
 * the same inputs (a default 2-copper BOARD as parent, the default 1.27 mm
 * text and 0.1 mm border), not derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';

const deg = (d: number) => new EDA_ANGLE(d, EDA_ANGLE_T.DEGREES_T);

function fixture(): { b: BOARD; t: PCB_TEXTBOX } {
  const b = new BOARD();
  const t = new PCB_TEXTBOX(b);
  t.SetStart({ x: 1000000, y: 2000000 });
  t.SetEnd({ x: 9000000, y: 5000000 });
  t.SetText('Hello');
  return { b, t };
}

describe('PCB_TEXTBOX', () => {
  it('constructs like PCB_TEXTBOX( aParent ): a rectangle, left/centre justified, multiline, legacy margins', () => {
    const t = new PCB_TEXTBOX(new BOARD());
    expect(t.Type()).toBe(KICAD_T.PCB_TEXTBOX_T);
    expect(t.GetClass()).toBe('PCB_TEXTBOX');
    expect(t.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(t.GetWidth()).toBe(100000);
    expect(t.GetTextSize()).toEqual({ x: 1270000, y: 1270000 });
    expect(t.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    expect(t.GetVertJustify()).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
    expect(t.IsMultilineAllowed()).toBe(true);
    expect(t.IsBorderEnabled()).toBe(true);
    expect(t.GetLegacyTextMargin()).toBe(1002500);
    expect([t.GetMarginLeft(), t.GetMarginTop(), t.GetMarginRight(), t.GetMarginBottom()]).toEqual([
      1002500, 1002500, 1002500, 1002500,
    ]);
    expect(t.IsType([KICAD_T.PCB_LOCATE_TEXT_T])).toBe(true);
    expect(t.GetFriendlyName()).toBe('Text Box');
  });

  it('GetDrawPos anchors on the box corner/midpoint of the justification, pushed in by the margins', () => {
    const { t } = fixture();
    expect(t.GetDrawPos()).toEqual({ x: 1952500, y: 3500000 });

    t.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    t.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
    expect(t.GetDrawPos()).toEqual({ x: 8047500, y: 2952500 });

    t.SetMirrored(true); // mirrored swaps left and right
    expect(t.GetDrawPos()).toEqual({ x: 1952500, y: 2952500 });
    t.SetMirrored(false);

    t.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
    t.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
    expect(t.GetDrawPos()).toEqual({ x: 5000000, y: 4047500 });
  });

  it('GetBoundingBox is the shape box; GetMinSize constrains only the text-height axis', () => {
    const { t } = fixture();
    const bb = t.GetBoundingBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      950000, 1950000, 8100000, 3100000,
    ]);
    expect(t.GetMinSize()).toEqual({ x: 0, y: 4048113 });
    expect(t.GetItemDescription(null, true)).toBe("PCB text box 'Hello' on F.Cu");
    expect(t.GetTopLeft()).toEqual({ x: 1000000, y: 2000000 });
    expect(t.GetBotRight()).toEqual({ x: 9000000, y: 5000000 });
  });

  it('Rotate by a cardinal angle keeps the rectangle; the edge accessors follow the rotation', () => {
    const { t } = fixture();
    t.Rotate({ x: 1000000, y: 2000000 }, deg(90));
    expect(t.GetTextAngle().AsDegrees()).toBe(90);
    expect(t.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(t.GetStart()).toEqual({ x: 1000000, y: 2000000 });
    expect(t.GetEnd()).toEqual({ x: 4000000, y: -6000000 });
    expect(t.GetTopLeft()).toEqual({ x: 1000000, y: -6000000 });
    expect(t.GetBotRight()).toEqual({ x: 4000000, y: 2000000 });
    expect(t.GetDrawPos()).toEqual({ x: 2500000, y: 1047500 });
    expect(t.GetMinSize()).toEqual({ x: 4048113, y: 0 });

    t.SetTop(-9000000); // at 90° the top is the END y
    expect(t.GetStart().y).toBe(2000000);
    expect(t.GetEnd().y).toBe(-9000000);

    t.SetTextAngle(deg(0)); // rotates about GetPosition() by the delta
    expect(t.GetTextAngle().AsDegrees()).toBe(0);
    expect(t.GetStart()).toEqual({ x: 1000000, y: 2000000 });
    expect(t.GetEnd()).toEqual({ x: 12000000, y: 5000000 });
  });

  it('Rotate off-cardinal becomes a POLY; back on a cardinal it is re-rectangled', () => {
    const { t } = fixture();
    t.SetEnd({ x: 12000000, y: 5000000 });
    t.Rotate({ x: 0, y: 0 }, deg(45));
    expect(t.GetShape()).toBe(SHAPE_T.POLY);
    expect(t.GetTextAngle().AsDegrees()).toBe(45);
    expect(t.GetPolyShape().Outline(0).PointCount()).toBe(4);

    t.Rotate({ x: 0, y: 0 }, deg(45));
    expect(t.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(t.GetTextAngle().AsDegrees()).toBe(90);
    expect(t.GetStart()).toEqual({ x: 2000000, y: -1000000 });
    expect(t.GetEnd()).toEqual({ x: 5000000, y: -12000000 });
  });

  it('TransformShapeToPolygon: the filled rectangle plus four border ovals, or just the rectangle', () => {
    const b = new BOARD();
    const t = new PCB_TEXTBOX(b);
    t.SetStart({ x: 0, y: 0 });
    t.SetEnd({ x: 4000000, y: 2000000 });
    t.SetText('Hi');

    let ps = new SHAPE_POLY_SET();
    t.TransformShapeToPolygon(ps, PCB_LAYER_ID.F_SilkS, 0, 5000, ERROR_LOC.ERROR_INSIDE, false);
    expect(ps.OutlineCount()).toBe(5);
    expect([0, 1, 2, 3, 4].map((i) => ps.Outline(i).PointCount())).toEqual([4, 12, 12, 12, 12]);
    const bb = ps.BBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      -50000, -50000, 4100000, 2100000,
    ]);

    t.SetBorderEnabled(false);
    ps = new SHAPE_POLY_SET();
    t.TransformShapeToPolygon(
      ps,
      PCB_LAYER_ID.F_SilkS,
      100000,
      5000,
      ERROR_LOC.ERROR_INSIDE,
      false,
    );
    expect(ps.OutlineCount()).toBe(1);
    expect(ps.Outline(0).PointCount()).toBe(4);

    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(t.IsMirrored()).toBe(true);
    expect(Math.abs(t.GetTextAngle().AsDegrees())).toBe(0);
    expect(t.GetStart()).toEqual({ x: 0, y: 0 });
  });

  it('GetShownText wraps at the column width less the margins; GetEffectiveShape covers the text and the border', () => {
    const b = new BOARD();
    const t = new PCB_TEXTBOX(b);
    t.SetStart({ x: 0, y: 0 });
    t.SetEnd({ x: 6000000, y: 3000000 });
    t.SetText('The quick brown fox jumps over the lazy dog');
    expect(t.GetShownText(false)).toBe('The\nquick\nbrown\nfox\njumps\nover\nthe\nlazy\ndog');

    // A 7 mm box: the column is 7 - 2 x 1.0025 mm; one margin less and 'ab cd' would fit.
    const t7 = new PCB_TEXTBOX(b);
    t7.SetStart({ x: 0, y: 0 });
    t7.SetEnd({ x: 7000000, y: 3000000 });
    t7.SetText('ab cd ef gh');
    expect(t7.GetShownText(false)).toBe('ab\ncd ef\ngh');

    const bb = t.GetEffectiveShape().BBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      -50000, -7440360, 6464256, 18209106,
    ]);

    const c = t.Duplicate(false) as PCB_TEXTBOX;
    expect(t.Similarity(c)).toBe(1.0);
    expect(t.equals(c)).toBe(true);
    c.SetMarginLeft(1);
    expect(t.Similarity(c)).toBeCloseTo(0.9, 12);
    c.SetBorderEnabled(false);
    expect(t.equals(c)).toBe(false);
  });
});
