// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_TARGET (`pcbnew/pcb_target.cpp`). Every expected number below was read
 * from KiCad's own `pcbnew` python module on the same inputs, not derived
 * from our port.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_TARGET } from '@ziroeda/pcbnew/pcb_target.js';

const polyOf = (t: PCB_TARGET) => {
  const ps = new SHAPE_POLY_SET();
  t.TransformShapeToPolygon(ps, PCB_LAYER_ID.Edge_Cuts, 0, 5000, ERROR_LOC.ERROR_INSIDE, false);
  const bb = ps.BBox();
  return {
    counts: Array.from({ length: ps.OutlineCount() }, (_, i) => ps.Outline(i).PointCount()),
    bbox: [bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()],
    ps,
  };
};

describe('PCB_TARGET', () => {
  it('constructs like PCB_TARGET( aParent ): a 5 mm +, 0.2 mm wide, on Edge.Cuts', () => {
    const b = new BOARD();
    const t = new PCB_TARGET(b);
    expect(t.Type()).toBe(KICAD_T.PCB_TARGET_T);
    expect(t.GetShape()).toBe(0);
    expect(t.GetSize()).toBe(5000000);
    expect(t.GetWidth()).toBe(200000);
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.Edge_Cuts);
    expect(t.GetItemDescription(null, true)).toBe('Target');
    expect(PCB_TARGET.ClassOf(t)).toBe(true);
  });

  it('GetBoundingBox is the size square; HitTest is a square of half the size plus the accuracy', () => {
    const t = new PCB_TARGET(new BOARD());
    t.SetPosition({ x: 1000000, y: 2000000 });
    const r = t.GetBoundingBox();
    expect([r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()]).toEqual([
      -1500000, -500000, 5000000, 5000000,
    ]);
    expect(t.HitTest({ x: 3500000, y: 2000000 }, 0)).toBe(true);
    expect(t.HitTest({ x: 3500001, y: 2000000 }, 0)).toBe(false);
    expect(t.HitTest({ x: 3600000, y: 2000000 }, 100000)).toBe(true);
  });

  it('TransformShapeToPolygon: two lines and a circle, the X form rotated 45 degrees', () => {
    const t = new PCB_TARGET(new BOARD());
    t.SetPosition({ x: 1000000, y: 2000000 });
    const plus = polyOf(t);
    expect(plus.counts).toEqual([20, 20, 91]);
    expect(plus.bbox).toEqual([-1598079, -598079, 5196158, 5196158]);

    t.SetShape(1);
    const x = polyOf(t);
    expect(x.counts).toEqual([20, 20, 115]);
    expect(x.bbox).toEqual([-1595910, -595910, 5191820, 5191820]);
    const o = x.ps.Outline(0);
    expect([0, 1, 2, 3].map((i) => [o.CPoint(i).x, o.CPoint(i).y])).toEqual([
      [3301465, -440169],
      [3337513, -455101],
      [3376531, -455101],
      [3412579, -440169],
    ]);
  });

  it('Flip mirrors the position through the board; Rotate; Similarity and equality', () => {
    const b = new BOARD();
    const t = new PCB_TARGET(b);
    b.Add(t);
    t.SetPosition({ x: 1000000, y: 2000000 });
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetPosition()).toEqual({ x: -1000000, y: 2000000 });
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.Edge_Cuts);
    t.Rotate({ x: 0, y: 0 }, new EDA_ANGLE(90, EDA_ANGLE_T.DEGREES_T));
    expect(t.GetPosition()).toEqual({ x: 2000000, y: 1000000 });

    const d = t.Duplicate(false) as PCB_TARGET;
    expect(t.Similarity(d)).toBe(1.0);
    expect(t.equals(d)).toBe(true);
    d.SetSize(1);
    expect(t.Similarity(d)).toBeCloseTo(0.9, 12);
    expect(t.equals(d)).toBe(false);
  });
});
