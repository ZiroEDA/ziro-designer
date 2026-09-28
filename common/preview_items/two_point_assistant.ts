// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::TWO_POINT_ASSISTANT` — the readout beside the cursor while
 * a line, rectangle or circle is being dragged out.
 * Counterpart: `common/preview_items/two_point_assistant.cpp`.
 *
 * It is the shape tools' equivalent of the polygon's fill: the one thing on
 * screen that tells you what you are about to draw, and ours had none of it.
 * Three shapes, three readouts:
 *
 * | shape | drawn | said |
 * |---|---|---|
 * | segment | — | `l: <length>`, `θ: <angle>°` |
 * | rect | — | `x: <width>`, `y: <height>` |
 * | circle | the radius line, origin → cursor | `r: <radius>` |
 *
 * The circle is the one that draws something, and it draws it through
 * `DRAW_CONTEXT` — the aux-items hairline, not the shape's own pen.
 *
 * `θ` is `EDA_ANGLE( VECTOR2I( radVec.x, -radVec.y ) )`, with the comment
 * "Ensures that +90° is up and -90° is down in pcbnew": the board's Y grows
 * downward, so the reported angle negates it and a line drawn upward reads
 * positive.
 */

import { DrawContext, type DevicePoint } from './draw_context.js';
import {
  angleLabel,
  dimensionLabel,
  drawTextNextToCursor,
  type PreviewUnits,
} from './preview_utils.js';

/** `KIGFX::PREVIEW::GEOM_SHAPE`, the three shapes `drawShape` supports. */
export type TwoPointShape = 'segment' | 'rect' | 'circle';

export interface TwoPointAssistantOptions {
  shape: TwoPointShape;
  /** `TWO_POINT_GEOMETRY_MANAGER::GetOrigin()`, in world units. */
  origin: { x: number; y: number };
  /** `GetEnd()`, in world units. */
  end: { x: number; y: number };
  /** World → device pixels, the canvas's own transform. */
  toPx: (p: { x: number; y: number }) => DevicePoint;
  /** `rs->GetLayerColor( LAYER_AUX_ITEMS )`. */
  color: string;
  /** For `DRAW_CONTEXT`'s special-angle green; unused by this assistant's line. */
  backgroundIsDark: boolean;
  /** The caller's IU per millimetre: pcbnew's and eeschema's differ. */
  iuPerMm: number;
  units: PreviewUnits;
  devicePixelRatio: number;
}

/**
 * `TWO_POINT_ASSISTANT::GetCursorStrings` — factored out so the strings can be
 * asserted without a canvas, the way `rulerDimensionStrings` is.
 */
export function twoPointCursorStrings(
  shape: TwoPointShape,
  origin: { x: number; y: number },
  end: { x: number; y: number },
  iuPerMm: number,
  units: PreviewUnits,
): string[] {
  const radVec = { x: end.x - origin.x, y: end.y - origin.y };

  if (shape === 'segment') {
    // "Ensures that +90° is up and -90° is down in pcbnew".
    const deltaAngle = (Math.atan2(-radVec.y, radVec.x) * 180) / Math.PI;
    return [
      dimensionLabel('l', Math.hypot(radVec.x, radVec.y), iuPerMm, units),
      angleLabel('θ', deltaAngle),
    ];
  }

  if (shape === 'rect') {
    return [
      dimensionLabel('x', Math.abs(radVec.x), iuPerMm, units),
      dimensionLabel('y', Math.abs(radVec.y), iuPerMm, units),
    ];
  }

  return [dimensionLabel('r', Math.hypot(radVec.x, radVec.y), iuPerMm, units)];
}

/** `TWO_POINT_ASSISTANT::ViewDraw`. */
export function drawTwoPointAssistant(
  ctx: CanvasRenderingContext2D,
  o: TwoPointAssistantOptions,
): void {
  const radVec = { x: o.end.x - o.origin.x, y: o.end.y - o.origin.y };

  // "text next to cursor jumps around a lot in this corner case".
  if (radVec.x === 0 && radVec.y === 0) return;

  const originPx = o.toPx(o.origin);
  const endPx = o.toPx(o.end);

  if (o.shape === 'circle') {
    // `preview_ctx.DrawLine( origin, end, false )` — the radius, at full
    // strength, in the aux-items colour.
    new DrawContext(ctx, {
      color: o.color,
      backgroundIsDark: o.backgroundIsDark,
      devicePixelRatio: o.devicePixelRatio,
    }).drawLine(originPx, endPx, false);
  }

  drawTextNextToCursor(ctx, {
    cursor: endPx,
    // "place the text next to cursor, on opposite side from drawing":
    // `origin - end`, taken on screen so a flipped board view needs no case.
    quadrant: { x: originPx.x - endPx.x, y: originPx.y - endPx.y },
    strings: twoPointCursorStrings(o.shape, o.origin, o.end, o.iuPerMm, o.units),
    color: o.color,
    devicePixelRatio: o.devicePixelRatio,
  });
}
