// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::CENTRELINE_RECT_ITEM` — a rectangle of a given aspect drawn
 * along a vector, with the midpoint of one side on the start point and the
 * midpoint of the opposite side on the end. Counterpart:
 * `common/preview_items/centreline_rect_item.cpp`.
 *
 * The microwave inductor tool's preview while its two corners are clicked out
 * (`MICROWAVE_TOOL::drawMicrowaveInductor`). Shared and painted here, beside
 * {@link ./polygon_item.ts}, because the canvases draw their previews from a
 * painter over the 2D context rather than through a GAL item.
 *
 * `drawPreviewShape` draws the centre line first and the outline second, both
 * with `SIMPLE_OVERLAY_ITEM`'s pen: the stroke colour at the item's line width
 * and the fill colour under the polygon.
 */

import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VIEW } from '../view/view.js';
import { SIMPLE_OVERLAY_ITEM } from './simple_overlay_item.js';
import type { TWO_POINT_GEOMETRY_MANAGER } from './two_point_geom_manager.js';

/** A world-space point. */
export interface CentrelineRectPoint {
  x: number;
  y: number;
}

/**
 * `getRectangleAlongCentreLine`: the four corners, in the order the C++ appends
 * them.
 *
 *     0 ---------------- 1 -----
 *     |                  |     ^
 *     s--------cl------->e   |cl|/aspect
 *     |                  |     v
 *     3----------------- 2 -----
 *
 * `start`/`end` need not be horizontal or vertical.
 */
export function getRectangleAlongCentreLine(
  aClStart: CentrelineRectPoint,
  aClEnd: CentrelineRectPoint,
  aAspect: number,
): CentrelineRectPoint[] {
  // vector down the centre line of the rectangle
  const cl = { x: aClEnd.x - aClStart.x, y: aClEnd.y - aClStart.y };

  // don't allow degenerate polygons
  if (cl.x === 0 && cl.y === 0) cl.x = 1.0;

  // the "side" of the rectangle is the centre line rotated by 90 deg
  // and scaled by the aspect ratio
  const rotated = RotatePointD(cl, ANGLE_90.negate());
  const side = { x: rotated.x * aAspect, y: rotated.y * aAspect };

  let pt = { x: aClStart.x + side.x / 2.0, y: aClStart.y + side.y / 2.0 };
  const out: CentrelineRectPoint[] = [pt];

  pt = { x: pt.x + cl.x, y: pt.y + cl.y };
  out.push(pt);

  pt = { x: pt.x - side.x, y: pt.y - side.y };
  out.push(pt);

  pt = { x: pt.x - cl.x, y: pt.y - cl.y };
  out.push(pt);

  return out;
}

/**
 * `KIGFX::PREVIEW::CENTRELINE_RECT_ITEM`: a rectangle along the line a
 * TWO_POINT_GEOMETRY_MANAGER describes, `aAspect` as wide as it is long, drawn
 * with its centre line.
 */
export class CENTRELINE_RECT_ITEM extends SIMPLE_OVERLAY_ITEM {
  constructor(
    private readonly m_geomMgr: TWO_POINT_GEOMETRY_MANAGER,
    private readonly m_aspect: number,
  ) {
    super();
  }

  override GetClass(): string {
    return 'CENTRELINE_RECT_ITEM';
  }

  private getOutline(): SHAPE_POLY_SET {
    const poly = new SHAPE_POLY_SET();
    poly.NewOutline();

    // `Append( VECTOR2D )` goes through VECTOR2I's casting ctor, which KiROUNDs.
    for (const p of getRectangleAlongCentreLine(
      this.m_geomMgr.GetOrigin(),
      this.m_geomMgr.GetEnd(),
      this.m_aspect,
    ))
      poly.Append({ x: KiROUND(p.x), y: KiROUND(p.y) });

    return poly;
  }

  override ViewBBox(): BOX2I {
    return this.getOutline().BBox();
  }

  protected override drawPreviewShape(aView: VIEW): void {
    const gal = aView.GetGAL()!;

    gal.DrawLine(this.m_geomMgr.GetOrigin(), this.m_geomMgr.GetEnd());
    gal.DrawPolygon(this.getOutline());
  }
}
