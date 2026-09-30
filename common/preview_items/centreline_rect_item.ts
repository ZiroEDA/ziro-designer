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
import { galPenWidth } from '../gal_pixel_grid.js';

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

export interface CentrelineRectStyle {
  /** `TWO_POINT_GEOMETRY_MANAGER::GetOrigin()`. */
  origin: CentrelineRectPoint;
  /** `GetEnd()`. */
  end: CentrelineRectPoint;
  /** `m_aspect`. */
  aspect: number;
  /** World -> device pixels, the canvas's own transform. */
  toPx(p: CentrelineRectPoint): { x: number; y: number };
  /** `SetStrokeColor`, as a CSS colour. */
  strokeColor: string;
  /** `SetFillColor`, as a CSS colour. */
  fillColor: string;
  /**
   * `SetLineWidth`, in device pixels: `gal.SetLineWidth( m_lineWidth )` is a
   * world width, so the caller has already applied the view scale.
   */
  linePx: number;
}

/**
 * `CENTRELINE_RECT_ITEM::drawPreviewShape`. The context is left with its
 * transform and pen as it was found.
 */
export function drawCentrelineRectItem(
  ctx: CanvasRenderingContext2D,
  s: CentrelineRectStyle,
): void {
  const outline = getRectangleAlongCentreLine(s.origin, s.end, s.aspect);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = galPenWidth(s.linePx);
  ctx.strokeStyle = s.strokeColor;
  ctx.fillStyle = s.fillColor;

  // gal.DrawLine( origin, end )
  const a = s.toPx(s.origin);
  const b = s.toPx(s.end);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // gal.DrawPolygon( outline ): filled and stroked, `SetIsStroke( true )` and
  // `SetIsFill( true )` both being on.
  ctx.beginPath();
  outline.forEach((p, i) => {
    const d = s.toPx(p);
    if (i === 0) ctx.moveTo(d.x, d.y);
    else ctx.lineTo(d.x, d.y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}
