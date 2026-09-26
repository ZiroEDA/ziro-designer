// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::MULTISTEP_GEOM_MANAGER` — a shape built out of a fixed
 * sequence of clicks. Counterpart:
 * `include/preview_items/multistep_geom_manager.h`.
 *
 * The whole idea is one counter and one virtual. A tool feeds the cursor in on
 * every motion with `lockIn` false — the geometry updates and the step does not
 * move — and on a click with `lockIn` true, which asks the subclass to accept
 * the point and then advances (or, if the subclass rejected it, retreats).
 * `RemoveLastPoint` retreats and re-accepts the same raw point, so backing out
 * of a step leaves the preview showing the earlier step's geometry rather than
 * a stale later one.
 *
 * That "accepted" return is not a validity check in the usual sense. It is the
 * step's own answer to *did this click give me a new degree of freedom* —
 * `BEZIER_GEOM_MANAGER::setEnd` returns `m_end != m_start`, so clicking the end
 * exactly on the start does not advance, and the user is left still setting the
 * end rather than with a zero-length curve.
 *
 * It lives in `common/` because it is not one editor's: upstream has this base
 * plus `ARC_GEOM_MANAGER` and `BEZIER_GEOM_MANAGER` beside it, and the pcbnew
 * and footprint drawing tools both construct them.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `MULTISTEP_GEOM_MANAGER`, with `acceptPoint`/`getMaxStep` left to subclasses. */
export abstract class MultistepGeomManager {
  private step_ = 0;
  private changed_ = false;
  private lastPoint_: Vec2 = { x: 0, y: 0 };

  /** Accept a point for the current stage, or reject it to stay put. */
  protected abstract acceptPoint(pt: Vec2): boolean;

  /** The step number that means "finished". */
  protected abstract getMaxStep(): number;

  /** The stage the manager is on. */
  protected getStep(): number {
    return this.step_;
  }

  /**
   * `AddPoint`: feed the cursor in. `lockIn` is false on a motion (update the
   * geometry, do not move the manager) and true on a click.
   */
  addPoint(pt: Vec2, lockIn: boolean): void {
    // hold onto the raw point separately to the managed geometry
    this.lastPoint_ = pt;

    const accepted = this.acceptPoint(pt);

    if (lockIn) this.performStep(accepted);

    this.changed_ = true;
  }

  /** `RemoveLastPoint`: back up a step, then re-accept the same raw point. */
  removeLastPoint(): void {
    this.performStep(false);
    this.acceptPoint(this.lastPoint_);
    this.changed_ = true;
  }

  /** `IsReset`: nothing has been locked in yet. */
  isReset(): boolean {
    return this.step_ === 0;
  }

  /** `Reset`: back to the initial state. */
  reset(): void {
    this.step_ = 0;
    this.changed_ = true;
  }

  /** `IsComplete`: the last step has been locked in. */
  isComplete(): boolean {
    return this.step_ === this.getMaxStep();
  }

  /**
   * `GetLastPoint`: the last raw point fed in, locked in or not.
   *
   * Not the same as any of the geometry: a step without full degrees of freedom
   * stores something else, which is why the assistant draws its cursor text off
   * this rather than off the shape.
   */
  getLastPoint(): Vec2 {
    return this.lastPoint_;
  }

  /**
   * `setGeometryChanged`: mark the geometry dirty without feeding a point in.
   *
   * `ARC_GEOM_MANAGER::ToggleClockwise` is why this is protected rather than
   * private — flipping the posture changes the arc without moving the cursor.
   */
  protected setGeometryChanged(): void {
    this.changed_ = true;
  }

  /** `HasGeometryChanged`: whether a client should redraw. */
  hasGeometryChanged(): boolean {
    return this.changed_;
  }

  /** `ClearGeometryChanged`, called once the client has redrawn. */
  clearGeometryChanged(): void {
    this.changed_ = false;
  }

  private performStep(forward: boolean): void {
    this.step_ = Math.min(Math.max(this.step_ + (forward ? 1 : -1), 0), this.getMaxStep());
  }
}
