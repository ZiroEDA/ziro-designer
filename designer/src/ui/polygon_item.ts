// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::POLYGON_ITEM` — the in-progress outline every polygon,
 * zone, rule area and cutout is drawn with while it is being clicked out.
 * Counterpart: `common/preview_items/polygon_item.cpp`.
 *
 * Shared, and painted here rather than in each canvas, for the same reason
 * {@link ./ruler_item.ts} is: upstream has exactly one of these and hands it to
 * four tools in two editors. It is also the *only* part of the polygon tool a
 * screenshot shows, and ours had reinvented all three of its decisions —
 * stroking the layer colour at the layer's line thickness, with no fill and no
 * separate leader — where upstream strokes **white at one pixel**, draws the
 * leader in `LAYER_AUX_ITEMS`, and fills the ring at **alpha 0.2**.
 *
 * ### The paint order is upstream's, and it is not the obvious one
 *
 * `drawPreviewShape` strokes first and fills *afterwards*
 * (`polygon_item.cpp:78-110`), so the translucent fill lies over the outline
 * rather than under it. At 0.2 that is a small tint, but it is a visible one on
 * the white line and there is no reason to guess differently.
 *
 * ### The fill is the ring, including the parts that are not stroked
 *
 * `SetPoints` concatenates locked + leader + loop into one closed contour. The
 * loop chain — the constrained path from the cursor back to the first corner —
 * is in the fill but is deliberately **never stroked**; in `DIRECT` mode it is
 * empty and the closing edge comes from the contour closing itself. That is why
 * KiCad shows a filled quadrilateral with only two visible edges when you have
 * clicked three corners, which is precisely the shape our version was missing.
 *
 * ### One pixel means one pixel
 *
 * `gal.SetLineWidth( aView->ToWorld( POLY_LINE_WIDTH ) )` with
 * `POLY_LINE_WIDTH = 1` is a screen-space width converted to world so that it
 * does not grow with the zoom. Drawing the strokes in device space is how that
 * stays exact at any scale, and {@link galPenWidth} applies the shader's
 * whole-pixel floor on the way.
 *
 * The fill's compositing is the one thing we knowingly do not match: upstream's
 * `TARGET_OVERLAY` blends `a·C + (1 − a²)·dst`, which is lighter than a plain
 * alpha blend. See the `kicad-overlay-composite-and-select-factor` note; it
 * cannot be expressed as a single 2D canvas fill.
 */

import { galPenWidth } from '@ziroeda/common/src/gal_pixel_grid.js';

/** A world-space point, matching the canvases' own `Vec2`. */
export interface PolygonItemPoint {
  x: number;
  y: number;
}

/** `POLYGON_ITEM::SetPoints`'s three chains. */
export interface PolygonItemChains {
  /** The corners already clicked. */
  locked: readonly PolygonItemPoint[];
  /** Last corner → cursor. Stroked in the leader colour. */
  leader: readonly PolygonItemPoint[];
  /** Cursor → first corner. Filled but never stroked. */
  loop: readonly PolygonItemPoint[];
}

export interface PolygonItemStyle extends PolygonItemChains {
  /** World → device pixels, the canvas's own transform. */
  toPx(p: PolygonItemPoint): { x: number; y: number };
  /**
   * `SIMPLE_OVERLAY_ITEM::m_strokeColor`, which `ZONE_CREATE_HELPER` sets to
   * `COLOR4D::WHITE` and never overrides with `SetLineColor`.
   */
  strokeColor: string;
  /**
   * `POLYGON_ITEM::m_leaderColor`. Unset by every caller, so the item falls
   * back to `GetLayerColor( LAYER_AUX_ITEMS )`.
   */
  leaderColor: string;
  /**
   * `SIMPLE_OVERLAY_ITEM::m_fillColor` — the layer's colour at alpha 0.2,
   * already composed into a CSS colour by the caller.
   */
  fillColor: string;
  /** Device pixels per CSS pixel, for the one-pixel stroke. */
  devicePixelRatio: number;
}

/** `POLYGON_ITEM::POLY_LINE_WIDTH` (`polygon_item.cpp:29`). */
const POLY_LINE_WIDTH = 1;

/** Trace a chain of world points as a device-space path. */
function tracePolyline(
  ctx: CanvasRenderingContext2D,
  pts: readonly PolygonItemPoint[],
  toPx: (p: PolygonItemPoint) => { x: number; y: number },
): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const d = toPx(p);
    if (i === 0) ctx.moveTo(d.x, d.y);
    else ctx.lineTo(d.x, d.y);
  });
}

/**
 * `POLYGON_ITEM::drawPreviewShape`. The context is left with its transform and
 * pen as it was found.
 */
export function drawPolygonItem(ctx: CanvasRenderingContext2D, s: PolygonItemStyle): void {
  const { locked, leader, loop, toPx } = s;
  if (locked.length === 0 && leader.length === 0) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // `ToWorld( POLY_LINE_WIDTH )`, drawn in device space so the zoom cannot
  // stretch it, and floored to a whole pixel the way the GAL shader does.
  ctx.lineWidth = galPenWidth(POLY_LINE_WIDTH * s.devicePixelRatio);

  if (locked.length >= 2) {
    ctx.strokeStyle = s.strokeColor;
    tracePolyline(ctx, locked, toPx);
    ctx.stroke();
  }

  // "draw the leader line in a different color"
  if (leader.length >= 2) {
    ctx.strokeStyle = s.leaderColor;
    tracePolyline(ctx, leader, toPx);
    ctx.stroke();
  }

  // `SetIsStroke( false )`, then the fill — over the strokes, not under them.
  // `SetPoints` builds one contour out of all three chains; consecutive
  // duplicates are dropped because `SHAPE_POLY_SET::Append` drops them.
  const ring: PolygonItemPoint[] = [];
  for (const p of [...locked, ...leader, ...loop]) {
    const last = ring[ring.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    ring.push(p);
  }

  if (ring.length >= 2) {
    ctx.fillStyle = s.fillColor;
    tracePolyline(ctx, ring, toPx);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}
