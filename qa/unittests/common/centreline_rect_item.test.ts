// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * CENTRELINE_RECT_ITEM (common/preview_items/centreline_rect_item.cpp): the
 * rectangle along a centre line, whose corners are worked by hand from
 * `getRectangleAlongCentreLine`.
 */
import { describe, expect, it } from 'vitest';
import {
  CENTRELINE_RECT_ITEM,
  getRectangleAlongCentreLine,
} from '@ziroeda/common/preview_items/centreline_rect_item.js';
import { TWO_POINT_GEOMETRY_MANAGER } from '@ziroeda/common/preview_items/two_point_geom_manager.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

describe('getRectangleAlongCentreLine', () => {
  it('lays the rectangle out as the C++ diagram says, for a horizontal centre line', () => {
    // cl = (100, 0); side = cl rotated by -90 deg = (0, 100), scaled by 0.5 = (0, 50).
    // pt0 = s + side/2 = (0, 25); pt1 = pt0 + cl; pt2 = pt1 - side; pt3 = pt2 - cl.
    expect(getRectangleAlongCentreLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5)).toEqual([
      { x: 0, y: 25 },
      { x: 100, y: 25 },
      { x: 100, y: -25 },
      { x: 0, y: -25 },
    ]);
  });

  it('rotates the side with the centre line, for a vertical one', () => {
    // cl = (0, 100); RotatePoint( cl, -ANGLE_90 ) is (-y, x) = (-100, 0); * 0.5 = (-50, 0).
    expect(getRectangleAlongCentreLine({ x: 10, y: 10 }, { x: 10, y: 110 }, 0.5)).toEqual([
      { x: -15, y: 10 },
      { x: -15, y: 110 },
      { x: 35, y: 110 },
      { x: 35, y: 10 },
    ]);
  });

  it('never returns a degenerate polygon: a zero centre line becomes (1, 0)', () => {
    const pts = getRectangleAlongCentreLine({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.5);
    expect(pts[1]!.x - pts[0]!.x).toBe(1);
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(4);
  });
});

describe('CENTRELINE_RECT_ITEM, the VIEW item', () => {
  const recording = () => {
    const calls: string[] = [];
    const gal = {
      SetLineWidth: (w: number) => calls.push(`w${w}`),
      SetStrokeColor: (c: { r: number }) => calls.push(`s${c.r}`),
      SetFillColor: (c: { r: number }) => calls.push(`f${c.r}`),
      SetIsStroke: () => {},
      SetIsFill: () => {},
      DrawLine: (a: { x: number; y: number }, b: { x: number; y: number }) =>
        calls.push(`L${a.x},${a.y}-${b.x},${b.y}`),
      DrawPolygon: (p: SHAPE_POLY_SET) =>
        calls.push(
          `P${p
            .Outline(0)
            .CPoints()
            .map((q) => `${q.x},${q.y}`)
            .join(' ')}`,
        ),
    };
    return { calls, view: { GetGAL: () => gal } as unknown as VIEW };
  };

  it('draws the centre line first and the outline second, with the item pen', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetOrigin({ x: 0, y: 0 });
    mgr.SetEnd({ x: 100, y: 0 });
    const item = new CENTRELINE_RECT_ITEM(mgr, 0.5);
    item.SetStrokeColor({ r: 0.4, g: 1, b: 1, a: 1 });
    item.SetFillColor({ r: 0.3, g: 0.3, b: 0.5, a: 0.3 });
    item.SetLineWidth(1);

    const { calls, view } = recording();
    item.ViewDraw(0, view);

    expect(calls).toEqual(['w1', 's0.4', 'f0.3', 'L0,0-100,0', 'P0,25 100,25 100,-25 0,-25']);
  });

  it("follows the geometry manager, and its box is the outline's", () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    const item = new CENTRELINE_RECT_ITEM(mgr, 0.5);
    mgr.SetOrigin({ x: 10, y: 10 });
    mgr.SetEnd({ x: 10, y: 110 });
    const box = item.ViewBBox();
    expect([box.GetX(), box.GetY(), box.GetWidth(), box.GetHeight()]).toEqual([-15, 10, 50, 100]);
  });

  it('is on the GP overlay, as every SIMPLE_OVERLAY_ITEM', () => {
    const item = new CENTRELINE_RECT_ITEM(new TWO_POINT_GEOMETRY_MANAGER(), 0.5);
    expect(item.ViewGetLayers()).toEqual([GAL_LAYER_ID.LAYER_GP_OVERLAY]);
  });
});
