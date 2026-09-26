// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::BEZIER_GEOM_MANAGER` — the four clicks that draw a cubic.
 * Counterpart: `common/preview_items/bezier_geom_manager.cpp`.
 *
 * The click order is **start, C1, end, C2**, and each step leaves the points it
 * has not been given yet sitting on the one it just got, "to prevent
 * weird-looking loops if the control points aren't initialized". So:
 *
 *   1. click the start. Everything is on the cursor;
 *   2. the cursor drags C1 — and the end and C2 ride along with it, so what
 *      follows the cursor is a straight line from the start;
 *   3. click C1, then the cursor drags the end (C2 pinned to it), and the
 *      segment bows towards C1;
 *   4. click the end, then the cursor drags C2 and the far half pulls into an S;
 *   5. click C2, and the curve is done.
 *
 * The one thing that is not obvious is {@link BezierGeomManager.getControlC2}:
 * the point the user clicks is *reflected about the end point* to give the real
 * C2. Upstream's comment says why — "so that the cursor will be on the C1 point
 * of the next bezier" — which is the whole of the chaining rule in
 * `DRAWING_TOOL::DrawBezier`. Draw one curve, and the next starts at its end
 * with its C1 already at the place the cursor was when you finished, so the two
 * meet tangentially without the user aiming for it.
 *
 * `setEnd` returning `m_end != m_start` is the one rejection: an end clicked on
 * the start does not advance the manager, so a zero-length bezier cannot be
 * built by clicking four times in one place.
 *
 * eeschema does **not** use this. `SCH_ACTIONS::drawBezier` runs the generic
 * `SCH_DRAWING_TOOLS::DrawShape`, which drives `EDA_SHAPE::beginEdit` /
 * `calcEdit` / `continueEdit` and takes its points in the order start, *end*,
 * C1, C2 with no reflection and no chaining. That divergence is upstream's, not
 * ours; `eeschema/src/tools/bezier_geom.ts` is the port of the other path.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { MultistepGeomManager } from './multistep_geom_manager.js';

/** `BEZIER_GEOM_MANAGER::BEZIER_STEPS`. */
export enum BezierStep {
  /** Waiting to lock in the start point. */
  SET_START = 0,
  /** Waiting to lock in the first control point. */
  SET_CONTROL1 = 1,
  /** Waiting to lock in the end point. */
  SET_END = 2,
  /** Waiting to lock in the second control point. */
  SET_CONTROL2 = 3,
  COMPLETE = 4,
}

export class BezierGeomManager extends MultistepGeomManager {
  private start_: Vec2 = { x: 0, y: 0 };
  private controlC1_: Vec2 = { x: 0, y: 0 };
  private end_: Vec2 = { x: 0, y: 0 };
  private controlC2_: Vec2 = { x: 0, y: 0 };

  protected getMaxStep(): number {
    return BezierStep.COMPLETE;
  }

  /** `GetStep()`. */
  getBezierStep(): BezierStep {
    return this.getStep() as BezierStep;
  }

  protected acceptPoint(pt: Vec2): boolean {
    switch (this.getBezierStep()) {
      case BezierStep.SET_START:
        return this.setStart(pt);
      case BezierStep.SET_CONTROL1:
        return this.setControlC1(pt);
      case BezierStep.SET_END:
        return this.setEnd(pt);
      case BezierStep.SET_CONTROL2:
        return this.setControlC2(pt);
      case BezierStep.COMPLETE:
        return false;
    }
  }

  getStart(): Vec2 {
    return this.start_;
  }

  getControlC1(): Vec2 {
    return this.controlC1_;
  }

  getEnd(): Vec2 {
    return this.end_;
  }

  /**
   * The real C2, which is the clicked point reflected over the end point.
   *
   * `return m_end - ( m_controlC2 - m_end )`, i.e. `2 * end - clicked`.
   */
  getControlC2(): Vec2 {
    return {
      x: this.end_.x - (this.controlC2_.x - this.end_.x),
      y: this.end_.y - (this.controlC2_.y - this.end_.y),
    };
  }

  private setStart(start: Vec2): boolean {
    this.start_ = start;
    // Prevents weird-looking loops if the control points aren't initialized
    this.end_ = start;
    this.controlC1_ = start;
    this.controlC2_ = start;
    return true;
  }

  private setControlC1(controlC1: Vec2): boolean {
    this.controlC1_ = controlC1;
    this.end_ = controlC1;
    this.controlC2_ = controlC1;
    // It's possible to set the control 1 point to the same as the start point
    return true;
  }

  private setEnd(end: Vec2): boolean {
    this.end_ = end;
    this.controlC2_ = end;
    return end.x !== this.start_.x || end.y !== this.start_.y;
  }

  private setControlC2(controlC2: Vec2): boolean {
    this.controlC2_ = controlC2;
    // It's possible to set the control 2 point to the same as the end point
    return true;
  }
}
