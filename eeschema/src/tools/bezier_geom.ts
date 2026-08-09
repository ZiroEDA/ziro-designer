// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::BEZIER_GEOM_MANAGER` — the state machine the bezier tool is
 * driven by, and the part of it our tool did not have.
 *
 * The gesture is four clicks in this order:
 *
 *     SET_START, SET_CONTROL1, SET_END, SET_CONTROL2
 *
 * and the fourth click is **not** the second control point. The manager keeps
 * the raw click and reflects it about the end point when it is asked for the
 * geometry:
 *
 *     VECTOR2I BEZIER_GEOM_MANAGER::GetControlC2() const
 *     {
 *         // The actual bezier C2 point is the reflection over the end point
 *         // so that the cursor will be on the C1 point of the next bezier.
 *         return m_end - ( m_controlC2 - m_end );
 *     }
 *
 * Taking the click as C2 directly — which is what we did — mirrors the curve's
 * far half: the tail bends *away* from where the cursor was pulled instead of
 * towards it, so the same gesture that draws an S in KiCad draws a C here. The
 * reflection is also what makes chaining work, because it leaves the cursor
 * sitting exactly where the next segment's C1 belongs.
 *
 * Each acceptor also seeds the points it has not been given yet — "prevents
 * weird-looking loops if the control points aren't initialized" — so there is a
 * sane cubic to preview from the very first click onwards, rather than a
 * control polygon that turns into a curve at the end.
 *
 * The functions here are pure: each returns the next state rather than mutating
 * one, so the canvas can hold a `BezierGeom` in a ref and the tests can drive
 * the whole gesture without a canvas.
 */

import type { Vec2 } from '../types.js';

/** `BEZIER_GEOM_MANAGER::BEZIER_STEPS`. */
export const BEZIER_SET_START = 0;
export const BEZIER_SET_CONTROL1 = 1;
export const BEZIER_SET_END = 2;
export const BEZIER_SET_CONTROL2 = 3;
export const BEZIER_COMPLETE = 4;

/**
 * The manager's state: the step it is on plus its four points.
 *
 * `c2` is the raw fourth click, exactly as `m_controlC2` holds it. The point
 * that goes into the shape is `bezierC2()`, its reflection about `end`.
 */
export interface BezierGeom {
  step: number;
  start: Vec2;
  c1: Vec2;
  end: Vec2;
  c2: Vec2;
  /** `m_lastPoint`: the last raw point given, locked in or not. */
  lastPoint: Vec2;
}

const ORIGIN: Vec2 = { x: 0, y: 0 };

/** A manager in its initial state (`m_step == 0`). */
export function newBezierGeom(): BezierGeom {
  return {
    step: BEZIER_SET_START,
    start: ORIGIN,
    c1: ORIGIN,
    end: ORIGIN,
    c2: ORIGIN,
    lastPoint: ORIGIN,
  };
}

/**
 * `acceptPoint`: fold a point into the geometry for the current step, and say
 * whether the step accepted it. A rejected point steps the manager *back*.
 */
function acceptPoint(g: BezierGeom, p: Vec2): { g: BezierGeom; accepted: boolean } {
  switch (g.step) {
    case BEZIER_SET_START:
      // "Prevents weird-looking loops if the control points aren't initialized."
      return { g: { ...g, start: p, end: p, c1: p, c2: p }, accepted: true };
    case BEZIER_SET_CONTROL1:
      // It is legal to put C1 on the start point.
      return { g: { ...g, c1: p, end: p, c2: p }, accepted: true };
    case BEZIER_SET_END:
      // `return m_end != m_start;` — an end on the start point is refused and
      // drops the manager back to SET_CONTROL1.
      return { g: { ...g, end: p, c2: p }, accepted: p.x !== g.start.x || p.y !== g.start.y };
    case BEZIER_SET_CONTROL2:
      // It is legal to put C2 on the end point (a straight tail).
      return { g: { ...g, c2: p }, accepted: true };
    default:
      return { g, accepted: false };
  }
}

/** `performStep`: advance or regress a step, clamped to the manager's range. */
function performStep(step: number, forward: boolean): number {
  return Math.max(BEZIER_SET_START, Math.min(BEZIER_COMPLETE, step + (forward ? 1 : -1)));
}

/**
 * `MULTISTEP_GEOM_MANAGER::AddPoint( aPt, aLockIn )`.
 *
 * With `lockIn` the point is committed and the manager steps on; without it the
 * geometry is updated for the current step and the manager stays put, which is
 * how the cursor previews the point it has not placed yet.
 */
export function bezierAddPoint(g: BezierGeom, p: Vec2, lockIn = true): BezierGeom {
  const { g: next, accepted } = acceptPoint({ ...g, lastPoint: p }, p);
  return lockIn ? { ...next, step: performStep(next.step, accepted) } : next;
}

/** `SetCursorPosition`: `AddPoint( aP, false )`. */
export function bezierSetCursor(g: BezierGeom, p: Vec2): BezierGeom {
  return bezierAddPoint(g, p, false);
}

/**
 * `RemoveLastPoint` (the Backspace / "Delete Last Point" action): step back,
 * then re-accept the last raw point in the step we have just returned to.
 */
export function bezierRemoveLastPoint(g: BezierGeom): BezierGeom {
  const back = { ...g, step: performStep(g.step, false) };
  return acceptPoint(back, back.lastPoint).g;
}

/** `IsComplete`: all four points are locked in. */
export function bezierIsComplete(g: BezierGeom): boolean {
  return g.step === BEZIER_COMPLETE;
}

/** `IsReset`: nothing has been locked in, so there is nothing to draw. */
export function bezierIsReset(g: BezierGeom): boolean {
  return g.step === BEZIER_SET_START;
}

/** `GetControlC2`: the raw fourth click reflected about the end point. */
export function bezierC2(g: BezierGeom): Vec2 {
  return { x: 2 * g.end.x - g.c2.x, y: 2 * g.end.y - g.c2.y };
}

/**
 * `BEZIER_DRAW_BEHAVIOR::ApplyToShape`, as the four points `makeBezier` takes:
 * start, C1, C2, end.
 */
export function bezierShapePoints(g: BezierGeom): [Vec2, Vec2, Vec2, Vec2] {
  return [g.start, g.c1, bezierC2(g), g.end];
}

/**
 * The manager the *next* segment of a chain starts from.
 *
 * `EE_GRAPHIC_TOOL::DrawBezier` re-enters the draw loop with the finished
 * curve's end as the new start and, when the last arm had any length, the
 * mirror of that arm as the new C1:
 *
 *     initialPts.push_back( bezier->GetEnd() );
 *
 *     // If the last control arm is non-zero, mirror it for tangent continuity
 *     if( bezier->GetEnd() != bezier->GetBezierC2() )
 *     {
 *         VECTOR2D mirroredC1 = bezier->GetEnd() - ( bezier->GetBezierC2() - bezier->GetEnd() );
 *         initialPts.push_back( mirroredC1 );
 *     }
 *
 * so a chain of curves joins smoothly and each further segment costs two clicks
 * (its end and its C2) instead of four. Mirroring the shape's C2 back gives the
 * point that was clicked for it, which is where the cursor already is.
 */
export function bezierChainFrom(g: BezierGeom): BezierGeom {
  const end = g.end;
  const shapeC2 = bezierC2(g);
  let next = bezierAddPoint(newBezierGeom(), end);
  if (shapeC2.x !== end.x || shapeC2.y !== end.y)
    next = bezierAddPoint(next, { x: 2 * end.x - shapeC2.x, y: 2 * end.y - shapeC2.y });
  return next;
}
