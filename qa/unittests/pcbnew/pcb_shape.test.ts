// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_SHAPE over BOARD_CONNECTED_ITEM + EDA_SHAPE (`pcbnew/pcb_shape.cpp`).
 * Every expected number below was read from KiCad's own `pcbnew` python
 * module on the same inputs (a default 2-copper BOARD as parent).
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';

const bbox = (s: PCB_SHAPE): [number, number, number, number] => {
  const r = s.GetBoundingBox();
  return [r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()];
};

const units = new UNITS_PROVIDER(pcbIUScale, 'mm');

describe('PCB_SHAPE segment', () => {
  const mk = (): PCB_SHAPE => {
    const s = new PCB_SHAPE(new BOARD(), SHAPE_T.SEGMENT);
    s.SetLayer(PCB_LAYER_ID.Edge_Cuts);
    s.SetStart({ x: 0, y: 0 });
    s.SetEnd({ x: 1000, y: 0 });
    s.SetWidth(100);
    return s;
  };

  it('HitTest near the segment, bounding box and description', () => {
    expect(mk().HitTest({ x: 500, y: 30 }, 10)).toBe(true);
    expect(mk().HitTest({ x: 500, y: 200 }, 10)).toBe(false);
    expect(bbox(mk())).toEqual([-50, -50, 1100, 100]);
    expect(mk().GetItemDescription(units, true)).toBe('Segment on Edge.Cuts');
  });

  it('Move / Rotate / Flip', () => {
    const s = mk();
    s.Move({ x: 10, y: 20 });
    expect(s.GetStart()).toEqual({ x: 10, y: 20 });
    s.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(s.GetStart()).toEqual({ x: 20, y: -10 });
    expect(s.GetEnd()).toEqual({ x: 20, y: -1010 });

    const f = new PCB_SHAPE(new BOARD(), SHAPE_T.SEGMENT);
    f.SetLayer(PCB_LAYER_ID.F_SilkS);
    f.SetStart({ x: 100, y: 0 });
    f.SetEnd({ x: 200, y: 0 });
    f.SetWidth(50);
    f.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(f.GetStart()).toEqual({ x: -100, y: 0 });
    expect(f.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
  });
});

describe('PCB_SHAPE rectangle', () => {
  it('unfilled: border live, interior not; filled: interior hits', () => {
    const s = new PCB_SHAPE(new BOARD(), SHAPE_T.RECTANGLE);
    s.SetLayer(PCB_LAYER_ID.Edge_Cuts);
    s.SetStart({ x: 0, y: 0 });
    s.SetEnd({ x: 1000, y: 1000 });
    s.SetWidth(40);
    s.SetFilled(false);
    expect(s.HitTest({ x: 0, y: 500 }, 5)).toBe(true);
    expect(s.HitTest({ x: 500, y: 500 }, 5)).toBe(false);
    expect(bbox(s)).toEqual([-20, -20, 1040, 1040]);

    s.SetFilled(true);
    s.SetWidth(0);
    expect(s.HitTest({ x: 500, y: 500 }, 0)).toBe(true);
  });
});

describe('PCB_SHAPE circle', () => {
  it('filled interior vs ring', () => {
    const c = new PCB_SHAPE(new BOARD(), SHAPE_T.CIRCLE);
    c.SetLayer(PCB_LAYER_ID.F_Cu);
    c.SetStart({ x: 0, y: 0 });
    c.SetEnd({ x: 500, y: 0 });
    c.SetWidth(20);
    c.SetFilled(true);
    expect(c.HitTest({ x: 100, y: 100 }, 0)).toBe(true);
    expect(c.GetRadius()).toBe(500);
    expect(bbox(c)).toEqual([-510, -510, 1020, 1020]);

    c.SetFilled(false);
    c.SetLayer(PCB_LAYER_ID.F_SilkS);
    expect(c.HitTest({ x: 100, y: 100 }, 0)).toBe(false); // interior of a ring: miss
    expect(c.HitTest({ x: 500, y: 0 }, 5)).toBe(true); // on the circumference
  });
});

describe('PCB_SHAPE arc', () => {
  // CCW quarter arc, centre origin, radius 1000.
  const mk = (): PCB_SHAPE => {
    const a = new PCB_SHAPE(new BOARD(), SHAPE_T.ARC);
    a.SetLayer(PCB_LAYER_ID.F_SilkS);
    a.SetArcGeometry({ x: 1000, y: 0 }, { x: 707, y: 707 }, { x: 0, y: 1000 });
    a.SetWidth(100);
    return a;
  };

  it('hits on-sweep, misses off-sweep; centre, bbox, angle', () => {
    expect(mk().HitTest({ x: 707, y: 707 }, 20)).toBe(true);
    expect(mk().HitTest({ x: -1000, y: 0 }, 20)).toBe(false);
    expect(mk().GetCenter()).toEqual({ x: 0, y: 0 });
    expect(bbox(mk())).toEqual([-50, -50, 1100, 1100]);
    expect(mk().GetArcAngle().AsDegrees()).toBe(90);
  });

  it('TransformShapeToPolygon at 5000 IU error: 10 vertices', () => {
    const poly = new SHAPE_POLY_SET();
    mk().TransformShapeToPolygon(poly, PCB_LAYER_ID.F_SilkS, 0, 5000, ERROR_LOC.ERROR_INSIDE);
    expect(poly.TotalVertices()).toBe(10);
    expect(poly.CVertex(0)).toEqual({ x: 950, y: 0 });
    expect(poly.CVertex(3)).toEqual({ x: 742, y: 742 });
  });
});
