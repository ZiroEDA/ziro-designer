// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::MOUSE_TRAIL_TRACER`. Counterpart:
 * `pcbnew/router/pns_mouse_trail_tracer.{h,cpp}`.
 *
 * The tracer records where the cursor has been during a routing or dragging
 * gesture. `LINE_PLACER` uses the whole of it to guess a posture; `DRAGGER`
 * uses **three members only** — {@link PnsMouseTrailTracer.clear},
 * {@link PnsMouseTrailTracer.addTrailPoint} and
 * {@link PnsMouseTrailTracer.getTrailLeadVector} — to work out which way the
 * user is pulling a via, so that a via that cannot be pushed out by the
 * barycentric force can instead be walked backwards along the cursor's path.
 *
 * Ported here is exactly that subset, plus the `m_forced` / `m_manuallyForced`
 * flags that `Clear()` resets. The posture machinery (`GetPosture`,
 * `SetMouseDisabled`, `IsManuallyForced`, the area-ratio heuristics) belongs
 * with `LINE_PLACER` and is deliberately absent rather than half-written; the
 * fields it would need are not declared here either, so a later port adds them
 * with its own tests rather than inheriting untested ones.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { segSquaredDistanceToSeg } from '../drc/shape_collisions.js';
import { PnsLineChain } from './pns_line_item.js';

export class PnsMouseTrailTracer {
  private mTrail = new PnsLineChain();
  private mTolerance = 0;
  private mForced = false;
  private mManuallyForced = false;

  /** `MOUSE_TRAIL_TRACER()`: tolerance 0, mouse enabled, then `Clear()`. */
  constructor() {
    this.clear();
  }

  clear(): void {
    this.mForced = false;
    this.mManuallyForced = false;
    this.mTrail = new PnsLineChain();
  }

  setTolerance(aTolerance: number): void {
    this.mTolerance = aTolerance;
  }

  tolerance(): number {
    return this.mTolerance;
  }

  /** `m_forced`, only ever cleared by {@link clear} in this subset. */
  isForced(): boolean {
    return this.mForced;
  }

  isManuallyForced(): boolean {
    return this.mManuallyForced;
  }

  /** The trail itself, for tests and for a later posture port. */
  trail(): PnsLineChain {
    return this.mTrail;
  }

  /**
   * `MOUSE_TRAIL_TRACER::AddTrailPoint` (`:44-79`).
   *
   * The loop is the whole point: when the new step comes back within
   * `m_tolerance` of a segment the trail already laid down — the user has
   * doubled back over their own path — the trail is **truncated to that
   * segment** rather than left to grow a loop. The scan stops two segments
   * short of the end (`i < SegmentCount() - 2`) so the immediately preceding
   * couple of segments, which the new step legitimately touches, never
   * trigger it.
   *
   * With the default tolerance of 0 the test is `squaredDistance <= 0`, so
   * only an exact re-touch truncates. `DRAGGER` never calls `SetTolerance`, so
   * that is the case the dragger actually runs in.
   */
  addTrailPoint(aP: Vec2): void {
    if (this.mTrail.segmentCount() === 0) {
      this.mTrail.appendPoint(aP);
    } else {
      const sNew = { a: this.mTrail.cLastPoint(), b: aP };

      if (this.mTrail.segmentCount() > 2) {
        const limit = this.mTolerance * this.mTolerance;

        for (let i = 0; i < this.mTrail.segmentCount() - 2; i++) {
          const sTrail = this.mTrail.cSegment(i);

          if (segSquaredDistanceToSeg(sTrail, sNew) <= limit) {
            this.mTrail = this.mTrail.slice(0, i);
            break;
          }
        }
      }

      this.mTrail.appendPoint(aP);
    }

    this.mTrail.simplify();
  }

  /**
   * `MOUSE_TRAIL_TRACER::GetTrailLeadVector` (`:81-91`): the straight line from
   * where the gesture started to where the cursor is now.
   *
   * Fewer than two points is `(0, 0)`, and a caller negating that gets `(0, 0)`
   * back — which is why the very first `Drag()` of a via cannot use the lead
   * vector to escape and must rely on the barycentric push alone.
   */
  getTrailLeadVector(): Vec2 {
    if (this.mTrail.pointCount() < 2) return { x: 0, y: 0 };

    const last = this.mTrail.cLastPoint();
    const first = this.mTrail.cPoint(0);

    return { x: last.x - first.x, y: last.y - first.y };
  }
}
