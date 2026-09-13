// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB_DIMENSION_BASE family (`pcbnew/pcb_dimension.cpp`). Every expected
 * number below was read from KiCad's own `pcbnew` python module on the same
 * inputs (a default 2-copper BOARD as parent, the default 1.27 mm text and
 * 0.2 mm line), not derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';
import {
  PCB_DIM_ALIGNED,
  PCB_DIM_CENTER,
  PCB_DIM_LEADER,
  PCB_DIM_ORTHOGONAL,
  PCB_DIM_RADIAL,
  type PCB_DIMENSION_BASE,
} from '@ziroeda/pcbnew/src/pcb_dimension.js';
import {
  DIM_ARROW_DIRECTION,
  DIM_PRECISION,
  DIM_TEXT_BORDER,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from '@ziroeda/pcbnew/src/pcb_dimension_types.js';

const deg = (d: number) => new EDA_ANGLE(d, EDA_ANGLE_T.DEGREES_T);

type Shape = ['S', number, number, number, number] | ['C', number, number, number];

const shapes = (d: PCB_DIMENSION_BASE): Shape[] =>
  d.GetShapes().map((s) => {
    if (s instanceof SHAPE_SEGMENT) {
      const seg = s.GetSeg();
      return ['S', seg.A.x, seg.A.y, seg.B.x, seg.B.y];
    }
    const c = s as SHAPE_CIRCLE;
    return ['C', c.GetCenter().x, c.GetCenter().y, c.GetRadius()];
  });

const bb = (d: PCB_DIMENSION_BASE): [number, number, number, number] => {
  const r = d.GetBoundingBox();
  return [r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()];
};

function aligned(): { b: BOARD; a: PCB_DIM_ALIGNED } {
  const b = new BOARD();
  const a = new PCB_DIM_ALIGNED(b);
  b.Add(a);
  a.SetStart({ x: 0, y: 0 });
  a.SetEnd({ x: 10000000, y: 0 });
  a.SetHeight(3000000);
  a.SetUnitsMode(DIM_UNITS_MODE.MM);
  a.SetUnitsFormat(DIM_UNITS_FORMAT.BARE_SUFFIX);
  a.SetPrecision(DIM_PRECISION.X_XX);
  a.Update();
  return { b, a };
}

describe('PCB_DIM_ALIGNED', () => {
  it('constructs like the C++: User.Drawings, inches, bare suffix, 0.0000, 0.2 mm line, 50 mil arrow', () => {
    const a = new PCB_DIM_ALIGNED(new BOARD());
    expect(a.GetLayer()).toBe(PCB_LAYER_ID.Dwgs_User);
    expect(a.GetUnits()).toBe('in');
    expect(a.GetUnitsFormat()).toBe(DIM_UNITS_FORMAT.BARE_SUFFIX);
    expect(a.GetPrecision()).toBe(DIM_PRECISION.X_XXXX);
    expect(a.GetLineThickness()).toBe(200000);
    expect(a.GetArrowLength()).toBe(1270000);
    expect(a.GetExtensionHeight()).toBe(586420);
    expect(a.GetKeepTextAligned()).toBe(true);
    expect(a.GetTextPositionMode()).toBe(DIM_TEXT_POSITION.OUTSIDE);
    expect(a.GetClass()).toBe('PCB_DIM_ALIGNED');
  });

  it('Update: the measured text, the text above the crossbar, the two extension lines, the crossbar and the arrows', () => {
    const { a } = aligned();
    expect(a.GetText()).toBe('10.00 mm');
    expect(a.GetMeasuredValue()).toBe(10000000);
    expect(a.GetTextPos()).toEqual({ x: 5000000, y: 1571250 });
    expect(a.GetTextAngle().AsDegrees()).toBe(0);
    expect(a.GetCrossbarStart()).toEqual({ x: 0, y: 3000000 });
    expect(a.GetCrossbarEnd()).toEqual({ x: 10000000, y: 3000000 });
    expect(shapes(a)).toEqual([
      ['S', 0, 0, 0, 3586420],
      ['S', 10000000, 0, 10000000, 3586420],
      ['S', 0, 3000000, 10000000, 3000000],
      ['S', 0, 3000000, 1126504, 2413579],
      ['S', 0, 3000000, 1126504, 3586421],
      ['S', 10000000, 3000000, 8873496, 3586421],
      ['S', 10000000, 3000000, 8873496, 2413579],
    ]);
    expect(bb(a)).toEqual([-100000, -100000, 10200001, 3786422]);
    expect(a.GetItemDescription(null, true)).toBe("Dimension '10.00 mm' on User.Drawings");
    expect(a.HitTest(a.GetTextPos(), 0)).toBe(true);
    expect(a.HitTest({ x: -20000000, y: 0 }, 0)).toBe(false);
  });

  it('INLINE text knocks the crossbar out; INWARD arrows carry a tail', () => {
    const { a } = aligned();
    a.SetTextPositionMode(DIM_TEXT_POSITION.INLINE);
    a.Update();
    expect(a.GetTextPos()).toEqual({ x: 5000000, y: 3000000 });
    expect(shapes(a)).toHaveLength(6); // the crossbar is entirely inside the text box
    expect(shapes(a)[2]).toEqual(['S', 0, 3000000, 1126504, 2413579]);

    a.SetArrowDirection(DIM_ARROW_DIRECTION.INWARD);
    a.Update();
    expect(shapes(a)).toHaveLength(8);
    expect(shapes(a).slice(2)).toEqual([
      ['S', 0, 3000000, -2540000, 3000000],
      ['S', 0, 3000000, -1126504, 3586421],
      ['S', 0, 3000000, -1126504, 2413579],
      ['S', 10000000, 3000000, 12540000, 3000000],
      ['S', 10000000, 3000000, 11126504, 2413579],
      ['S', 10000000, 3000000, 11126504, 3586421],
    ]);
  });

  it('GetValueText: precision, the V_ variants per unit, zero suppression, prefix/suffix and the unit formats', () => {
    const { a } = aligned();
    a.SetSuppressZeroes(true);
    a.SetPrecision(DIM_PRECISION.V_VVVV);
    a.Update();
    expect(a.GetText()).toBe('10 mm');

    a.SetUnitsFormat(DIM_UNITS_FORMAT.PAREN_SUFFIX);
    a.SetPrefix('L=');
    a.SetSuffix('!');
    a.Update();
    expect(a.GetText()).toBe('L=10 (mm)!');

    a.SetUnitsMode(DIM_UNITS_MODE.MILS);
    a.Update();
    expect(a.GetText()).toBe('L=393.7 (mils)!');

    a.SetUnitsMode(DIM_UNITS_MODE.INCH);
    a.SetPrecision(DIM_PRECISION.X_XXXX);
    a.SetSuppressZeroes(false);
    a.Update();
    expect(a.GetText()).toBe('L=0.3937 (in)!');
  });

  it('Rotate / Mirror / Flip / UpdateHeight', () => {
    const { a } = aligned();
    a.Rotate({ x: 0, y: 0 }, deg(90));
    expect(a.GetStart()).toEqual({ x: 0, y: 0 });
    expect(a.GetEnd()).toEqual({ x: 0, y: -10000000 });
    expect(a.GetTextPos()).toEqual({ x: 1571250, y: -5000000 });
    expect(a.GetTextAngle().AsDegrees()).toBe(90);
    expect(a.GetCrossbarStart()).toEqual({ x: 3000000, y: 0 });

    a.Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(a.GetHeight()).toBe(-3000000);
    expect(a.GetTextPos()).toEqual({ x: -4428750, y: -5000000 });
    expect(a.GetTextAngle().AsDegrees()).toBe(90); // re-aligned to the crossbar

    a.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);
    expect(a.GetLayer()).toBe(PCB_LAYER_ID.Dwgs_User);
    expect(a.GetHeight()).toBe(3000000);
    expect(a.IsMirrored()).toBe(false);

    a.UpdateHeight({ x: 2000000, y: -3000000 }, { x: 6000000, y: -3000000 });
    expect(a.GetHeight()).toBe(-3605551);
  });
});

describe('PCB_DIM_ORTHOGONAL', () => {
  function ortho(): PCB_DIM_ORTHOGONAL {
    const b = new BOARD();
    const o = new PCB_DIM_ORTHOGONAL(b);
    b.Add(o);
    o.SetStart({ x: 0, y: 0 });
    o.SetEnd({ x: 8000000, y: 2000000 });
    o.SetHeight(-4000000);
    o.SetUnitsMode(DIM_UNITS_MODE.MM);
    o.SetPrecision(DIM_PRECISION.X_X);
    o.Update();
    return o;
  }

  it('measures along the locked axis; the second extension line runs from the far feature point', () => {
    const o = ortho();
    expect(o.GetText()).toBe('8.0 mm');
    expect(o.GetMeasuredValue()).toBe(8000000);
    expect(o.GetTextPos()).toEqual({ x: 4000000, y: -5428750 });
    expect(shapes(o)).toEqual([
      ['S', 0, 0, 0, -4586420],
      ['S', 8000000, -4586420, 8000000, 2000000],
      ['S', 0, -4000000, 8000000, -4000000],
      ['S', 0, -4000000, 1126504, -4586421],
      ['S', 0, -4000000, 1126504, -3413579],
      ['S', 8000000, -4000000, 6873496, -3413579],
      ['S', 8000000, -4000000, 6873496, -4586421],
    ]);
    expect(bb(o)).toEqual([-100000, -6450306, 8200001, 8550307]);

    o.SetOrientation(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
    o.Update();
    expect(o.GetText()).toBe('2.0 mm');
    expect(o.GetTextPos()).toEqual({ x: -5428750, y: 1000000 });
    expect(o.GetTextAngle().AsDegrees()).toBe(90);
    expect(o.GetCrossbarStart()).toEqual({ x: -4000000, y: 0 });
    expect(o.GetCrossbarEnd()).toEqual({ x: -4000000, y: 2000000 });
    expect(shapes(o)).toEqual([
      ['S', 0, 0, -4586420, 0],
      ['S', -4586420, 2000000, 8000000, 2000000],
      ['S', -4000000, 0, -4000000, 2000000],
      ['S', -4000000, 0, -3413579, 1126504],
      ['S', -4000000, 0, -4586421, 1126504],
      ['S', -4000000, 2000000, -4586421, 873496],
      ['S', -4000000, 2000000, -3413579, 873496],
    ]);
  });

  it('Rotate swaps the orientation and the height sign per quadrant; Mirror flips the height only along its axis', () => {
    const o = ortho();
    o.SetOrientation(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
    o.Update();
    o.Rotate({ x: 0, y: 0 }, deg(90));
    expect(o.GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL);
    expect(o.GetHeight()).toBe(4000000);
    expect(o.GetEnd()).toEqual({ x: 2000000, y: -8000000 });
    o.Rotate({ x: 0, y: 0 }, deg(-90));
    expect(o.GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
    expect(o.GetHeight()).toBe(-4000000);
    o.Rotate({ x: 0, y: 0 }, deg(180));
    expect(o.GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
    expect(o.GetHeight()).toBe(4000000);
    o.Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(o.GetHeight()).toBe(-4000000);
    o.Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);
    expect(o.GetHeight()).toBe(-4000000);
  });
});

describe('PCB_DIM_RADIAL', () => {
  it('centre cross, radial leader knocked out by the text, arrow at the radius point', () => {
    const b = new BOARD();
    const r = new PCB_DIM_RADIAL(b);
    b.Add(r);
    expect(r.GetPrefix()).toBe('R ');
    expect(r.GetLeaderLength()).toBe(3810000);
    expect(r.GetUnitsFormat()).toBe(DIM_UNITS_FORMAT.NO_SUFFIX);
    r.SetStart({ x: 0, y: 0 });
    r.SetEnd({ x: 3000000, y: 4000000 });
    r.SetTextPos({ x: 9000000, y: 9000000 });
    r.SetUnitsMode(DIM_UNITS_MODE.MM);
    r.SetPrecision(DIM_PRECISION.X_XX);
    r.Update();
    expect(r.GetText()).toBe('R 5.00');
    expect(r.GetMeasuredValue()).toBe(5000000);
    expect(r.GetKnee()).toEqual({ x: 5286000, y: 7048000 });
    expect(r.GetTextAngle().AsDegrees()).toBe(332);
    expect(shapes(r)).toEqual([
      ['S', 0, -1270000, 0, 1270000],
      ['S', 1270000, 0, -1270000, 0],
      ['S', 3000000, 4000000, 5286000, 7048000],
      ['S', 5286000, 7048000, 5475498, 7147596],
      ['S', 3000000, 4000000, 4145039, 4549351],
      ['S', 3000000, 4000000, 3206766, 5253055],
    ]);
    expect(bb(r)).toEqual([-1370000, -1370000, 13716603, 11391558]);
  });
});

describe('PCB_DIM_LEADER', () => {
  function leader(): PCB_DIM_LEADER {
    const b = new BOARD();
    const l = new PCB_DIM_LEADER(b);
    b.Add(l);
    l.SetStart({ x: 0, y: 0 });
    l.SetEnd({ x: 5000000, y: 5000000 });
    l.SetTextPos({ x: 9000000, y: 5000000 });
    l.Update();
    return l;
  }

  it('constructs with the "Leader" override and no border; the text line stops at the text box', () => {
    const l = leader();
    expect(l.GetOverrideText()).toBe('Leader');
    expect(l.GetText()).toBe('Leader');
    expect(l.GetTextBorder()).toBe(DIM_TEXT_BORDER.NONE);
    expect(l.GetKeepTextAligned()).toBe(false);
    expect(shapes(l)).toEqual([
      ['S', 0, 0, 5000000, 5000000],
      ['S', 0, 0, 1211221, 381896],
      ['S', 0, 0, 381896, 1211221],
      ['S', 5000000, 5000000, 5109114, 5000000],
    ]);
    expect(bb(l)).toEqual([-100000, -100000, 12355888, 6121558]);
    expect(l.GetItemDescription(null, true)).toBe("Dimension 'Leader' on User.Drawings");
  });

  it('RECTANGLE and CIRCLE borders; the extension offset moves the line start', () => {
    const l = leader();
    l.SetTextBorder(DIM_TEXT_BORDER.RECTANGLE);
    l.Update();
    expect(shapes(l).slice(3)).toEqual([
      ['S', 5109114, 3660944, 5109114, 6339057],
      ['S', 5109114, 6339057, 12890887, 6339057],
      ['S', 12890887, 6339057, 12890887, 3660944],
      ['S', 12890887, 3660944, 5109114, 3660944],
      ['S', 5000000, 5000000, 5109114, 5000000],
    ]);

    l.SetTextBorder(DIM_TEXT_BORDER.CIRCLE);
    l.Update();
    expect(shapes(l).slice(3)).toEqual([
      ['C', 9000000, 5000000, 3811511],
      ['S', 5000000, 5000000, 5188489, 5000000],
    ]);

    const ps = new SHAPE_POLY_SET();
    l.TransformShapeToPolygon(ps, PCB_LAYER_ID.Dwgs_User, 0, 5000, ERROR_LOC.ERROR_INSIDE, false);
    expect([0, 1, 2, 3, 4].map((i) => ps.Outline(i).PointCount())).toEqual([20, 20, 20, 65, 20]);

    l.SetExtensionOffset(500000);
    l.SetTextBorder(DIM_TEXT_BORDER.NONE);
    l.Update();
    expect(shapes(l)[0]).toEqual(['S', 353553, 353553, 5000000, 5000000]);
  });
});

describe('PCB_DIM_CENTER', () => {
  it('two arms through the centre, no text, the text position at the centre', () => {
    const b = new BOARD();
    const c = new PCB_DIM_CENTER(b);
    b.Add(c);
    c.SetStart({ x: 1000000, y: 1000000 });
    c.SetEnd({ x: 3000000, y: 1000000 });
    c.Update();
    expect(c.GetText()).toBe('');
    expect(shapes(c)).toEqual([
      ['S', -1000000, 1000000, 3000000, 1000000],
      ['S', 1000000, -1000000, 1000000, 3000000],
    ]);
    expect(bb(c)).toEqual([-1100000, -1100000, 4200001, 4200001]);
    expect(c.GetTextPos()).toEqual({ x: 1000000, y: 1000000 });
    const vb = c.ViewBBox();
    expect([vb.GetX(), vb.GetY(), vb.GetWidth(), vb.GetHeight()]).toEqual([
      -1100000, -1100000, 4200001, 4200001,
    ]);

    const ps = new SHAPE_POLY_SET();
    c.TransformShapeToPolygon(ps, PCB_LAYER_ID.Dwgs_User, 0, 5000, ERROR_LOC.ERROR_INSIDE, false);
    expect([0, 1].map((i) => ps.Outline(i).PointCount())).toEqual([20, 20]);

    const d = c.Duplicate(false) as PCB_DIM_CENTER;
    expect(c.Similarity(d)).toBe(0.0); // EDA_TEXT::Similarity of two empty texts
    expect(c.equals(d)).toBe(true);
    d.SetLineThickness(1);
    expect(c.equals(d)).toBe(false);
  });
});
