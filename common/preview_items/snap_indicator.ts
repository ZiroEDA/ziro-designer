// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::SNAP_INDICATOR` - `include/preview_items/snap_indicator.h`
 * + `common/preview_items/snap_indicator.cpp`. The origin marker
 * (`origin_viewitem.ts`) plus a small icon naming *what kind* of point the
 * cursor is sitting on: a corner, a line end, a midpoint, an arc/circle
 * centre or quadrant, an intersection, or "somewhere on an element".
 *
 * KiCad draws this as a `VIEW_ITEM::ViewDraw( int, VIEW* )`, transforming a
 * fixed screen-pixel offset and size through `VIEW::ToWorld` so the icon
 * holds its size at every zoom. `origin_viewitem.ts` made the same choice a
 * different way: it resets the canvas transform and works directly in
 * device pixels, so there is nothing left to convert here - the `{24, 10}`
 * offset and `16` size below are already screen pixels, one for one with the
 * C++ constants.
 *
 * `ViewDraw`'s `if` / `else if` chain (cpp:156-184) picks *one* icon - the
 * first point type that is set, in this fixed order - which is
 * {@link pickSnapIcon}. Each icon's own geometry ({@link cornerIconPlan} and
 * its siblings, cpp:60-140) is returned as plain data rather than drawn
 * straight away, so it can be checked against the C++ formulas without a
 * canvas.
 */

import {
  PT_CENTER,
  PT_CORNER,
  PT_END,
  PT_INTERSECTION,
  PT_MID,
  PT_ON_ELEMENT,
  PT_QUADRANT,
} from '@ziroeda/kimath/src/geometry/point_types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { galSnapPx } from '../gal_pixel_grid.js';
import { drawOriginViewItem, type OriginViewItemOptions } from '../origin_viewitem.js';

/** The constructor's `aColor = COLOR4D::WHITE` default. */
export const SNAP_INDICATOR_DEFAULT_COLOR = '#ffffff';

/** The constructor's `aSize = 16` default - the same constant as `ORIGIN_VIEWITEM_SIZE`. */
export const SNAP_INDICATOR_DEFAULT_SIZE = 16;

/**
 * `ViewDraw`'s icon offset and size (cpp:152-154):
 *
 *     const VECTOR2I typeIconPos = m_position + aView->ToWorld( { 24, 10 }, false );
 *     const int      size = aView->ToWorld( 16 );
 *
 * already in screen pixels - see the file comment on why no `ToWorld` is
 * needed in this port.
 */
const TYPE_ICON_OFFSET: Vec2 = { x: 24, y: 10 };
const TYPE_ICON_SIZE = 16;

export type SnapIconKind =
  | 'corner'
  | 'end'
  | 'mid'
  | 'center'
  | 'quadrant'
  | 'intersection'
  | 'on_element';

/**
 * `SNAP_INDICATOR::ViewDraw`'s `if` / `else if` chain (cpp:156-184): the
 * first point type that is set wins, in this order. `PT_NONE` (0) matches
 * nothing.
 */
export function pickSnapIcon(aSnapTypes: number): SnapIconKind | null {
  if (aSnapTypes & PT_CORNER) return 'corner';
  if (aSnapTypes & PT_END) return 'end';
  if (aSnapTypes & PT_MID) return 'mid';
  if (aSnapTypes & PT_CENTER) return 'center';
  if (aSnapTypes & PT_QUADRANT) return 'quadrant';
  if (aSnapTypes & PT_INTERSECTION) return 'intersection';
  if (aSnapTypes & PT_ON_ELEMENT) return 'on_element';
  return null;
}

/** One `Draw*Icon` helper's output: what to fill, stroke, and the arc, if any. */
export interface SnapIconPlan {
  fillCircle?: { pos: Vec2; r: number };
  strokeCircle?: { pos: Vec2; r: number };
  lines: Array<{ a: Vec2; b: Vec2 }>;
  /** `GAL::DrawArc( aCenterPoint, aRadius, aStartAngle, aAngle )`: degrees, `aAngle` is the *sweep*. */
  arc?: { center: Vec2; r: number; startDeg: number; sweepDeg: number };
}

const sub = (a: Vec2, d: Vec2): Vec2 => ({ x: a.x - d.x, y: a.y - d.y });
const add = (a: Vec2, d: Vec2): Vec2 => ({ x: a.x + d.x, y: a.y + d.y });

/** `DrawCornerIcon` (cpp:60-68). */
export function cornerIconPlan(aPosition: Vec2, aSize: number): SnapIconPlan {
  const nodeRad = aSize / 8;
  const corner = add(sub(aPosition, { x: aSize / 2, y: aSize / 2 }), { x: nodeRad, y: nodeRad });

  return {
    fillCircle: { pos: corner, r: nodeRad },
    lines: [
      { a: corner, b: add(corner, { x: aSize - nodeRad, y: 0 }) },
      { a: corner, b: add(corner, { x: 0, y: aSize - nodeRad }) },
    ],
  };
}

/** `DrawLineEndpointIcon` (cpp:71-78). */
export function lineEndpointIconPlan(aPosition: Vec2, aSize: number): SnapIconPlan {
  const nodeRadius = aSize / 8;
  const lineStart = sub(aPosition, { x: aSize / 2 - nodeRadius, y: 0 });

  return {
    fillCircle: { pos: lineStart, r: nodeRadius },
    lines: [{ a: lineStart, b: add(lineStart, { x: aSize - nodeRadius, y: 0 }) }],
  };
}

/** `DrawMidpointIcon` (cpp:81-87). */
export function midpointIconPlan(aPosition: Vec2, aSize: number): SnapIconPlan {
  const nodeRadius = aSize / 8;

  return {
    fillCircle: { pos: aPosition, r: nodeRadius },
    lines: [
      { a: sub(aPosition, { x: aSize / 2, y: 0 }), b: add(aPosition, { x: aSize / 2, y: 0 }) },
    ],
  };
}

/**
 * `DrawCentrePointIcon` (cpp:90-98). Unlike the others this calls
 * `GAL::DrawCircle` directly rather than through `DrawSnapNode`, so the ring
 * is **stroked**, not filled - `DrawSnapNode` is the only place that toggles
 * fill on.
 */
export function centrePointIconPlan(aPosition: Vec2, aSize: number): SnapIconPlan {
  const ringRadius = aSize / 4;

  return {
    strokeCircle: { pos: aPosition, r: ringRadius },
    lines: [
      { a: sub(aPosition, { x: aSize / 2, y: 0 }), b: add(aPosition, { x: aSize / 2, y: 0 }) },
      { a: sub(aPosition, { x: 0, y: aSize / 2 }), b: add(aPosition, { x: 0, y: aSize / 2 }) },
    ],
  };
}

/** `DrawQuadrantPointIcon` (cpp:101-114): most of the top half of a circle passing through the node. */
export function quadrantPointIconPlan(aPosition: Vec2, aSize: number): SnapIconPlan {
  const nodeRadius = aSize / 8;
  const quadPoint = sub(aPosition, { x: 0, y: aSize / 2 - nodeRadius });
  const arcRadius = aSize - nodeRadius * 2;
  const arcCenter = add(quadPoint, { x: 0, y: arcRadius });

  return {
    fillCircle: { pos: quadPoint, r: nodeRadius },
    lines: [],
    arc: { center: arcCenter, r: arcRadius, startDeg: -160, sweepDeg: 140 },
  };
}

/** `DrawIntersectionIcon` (cpp:117-129): a slightly squashed X through the point. */
export function intersectionIconPlan(aPosition: Vec2, aSize: number): SnapIconPlan {
  const nodeRadius = aSize / 8;
  const leg = { x: aSize / 2, y: aSize / 3 };
  const leg2 = { x: leg.x, y: -leg.y };

  return {
    fillCircle: { pos: aPosition, r: nodeRadius },
    lines: [
      { a: sub(aPosition, leg), b: add(aPosition, leg) },
      { a: sub(aPosition, leg2), b: add(aPosition, leg2) },
    ],
  };
}

/** `DrawOnElementIcon` (cpp:132-140): like a midpoint, but off to one side. */
export function onElementIconPlan(aPosition: Vec2, aSize: number): SnapIconPlan {
  const nodeRadius = aSize / 8;

  return {
    fillCircle: { pos: add(aPosition, { x: aSize / 4, y: 0 }), r: nodeRadius },
    lines: [
      { a: sub(aPosition, { x: aSize / 2, y: 0 }), b: add(aPosition, { x: aSize / 2, y: 0 }) },
    ],
  };
}

/** Dispatch table for {@link pickSnapIcon}'s result. */
export function snapIconPlan(aKind: SnapIconKind, aPosition: Vec2, aSize: number): SnapIconPlan {
  switch (aKind) {
    case 'corner':
      return cornerIconPlan(aPosition, aSize);
    case 'end':
      return lineEndpointIconPlan(aPosition, aSize);
    case 'mid':
      return midpointIconPlan(aPosition, aSize);
    case 'center':
      return centrePointIconPlan(aPosition, aSize);
    case 'quadrant':
      return quadrantPointIconPlan(aPosition, aSize);
    case 'intersection':
      return intersectionIconPlan(aPosition, aSize);
    case 'on_element':
      return onElementIconPlan(aPosition, aSize);
  }
}

export interface SnapIndicatorOptions extends OriginViewItemOptions {
  /** `SetSnapTypes`: a bitwise OR of `POINT_TYPE`. */
  snapTypes: number;
}

/**
 * `SNAP_INDICATOR::ViewDraw` (cpp:143-185): the origin marker, then the type
 * icon at a fixed screen offset from it, so it never overlaps the ruler
 * helpers.
 */
export function drawSnapIndicator(ctx: CanvasRenderingContext2D, opts: SnapIndicatorOptions): void {
  drawOriginViewItem(ctx, opts);

  const kind = pickSnapIcon(opts.snapTypes);

  if (!kind) return;

  const pen = opts.lineWidth ?? 1;
  const p = opts.toPx(opts.position);
  const iconPos: Vec2 = {
    x: galSnapPx(p.x + TYPE_ICON_OFFSET.x, pen),
    y: galSnapPx(p.y + TYPE_ICON_OFFSET.y, pen),
  };
  const plan = snapIconPlan(kind, iconPos, TYPE_ICON_SIZE);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = opts.color;
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = pen;

  if (plan.fillCircle) {
    ctx.beginPath();
    ctx.arc(plan.fillCircle.pos.x, plan.fillCircle.pos.y, plan.fillCircle.r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (plan.strokeCircle) {
    ctx.beginPath();
    ctx.arc(plan.strokeCircle.pos.x, plan.strokeCircle.pos.y, plan.strokeCircle.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const line of plan.lines) {
    ctx.beginPath();
    ctx.moveTo(line.a.x, line.a.y);
    ctx.lineTo(line.b.x, line.b.y);
    ctx.stroke();
  }

  if (plan.arc) {
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    ctx.beginPath();
    ctx.arc(
      plan.arc.center.x,
      plan.arc.center.y,
      plan.arc.r,
      toRad(plan.arc.startDeg),
      toRad(plan.arc.startDeg + plan.arc.sweepDeg),
    );
    ctx.stroke();
  }
}
