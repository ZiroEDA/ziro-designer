// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::MOUSE_TRAIL_TRACER` — the posture solver.
 *
 * Counterpart: `pcbnew/router/pns_mouse_trail_tracer.{h,cpp}`.
 *
 * "Posture" is the one bit of state a 45°-routing track needs that the cursor
 * position cannot supply: given a start and an end, there are two legal
 * two-segment traces between them — straight-then-diagonal, or
 * diagonal-then-straight — and the router has to guess which one the user
 * meant. This class guesses it from the *path the mouse took*, not from where
 * it ended up.
 *
 * The mechanism is an area comparison (`GetPosture`, `mtt.cpp:113-133`). Close
 * each candidate trace against the recorded mouse trail to make a polygon, and
 * measure them. If the trail hugs the diagonal-first candidate, that polygon is
 * thin and the straight-first one is fat, so the ratio `areaS / (areaDiag + 1)`
 * is large. Two thresholds and a dead band keep it from flickering, and two
 * distance factors lock the answer once the user has committed to a direction
 * and unlock it if they drag back to the start.
 *
 * Everything here is tuned by five constants that upstream states as literals
 * (`mtt.cpp:87-99`), and every one of them is load-bearing — see `getPosture`.
 *
 * Not ported: the `PNS_DBG` debug-decorator calls, which are no-ops in a release
 * build.
 */
import { AngleType, Direction45, Directions } from '@ziroeda/kimath/src/geometry/direction45.js';
import { PnsLineChain } from './pns_line_item.js';
import { segSquaredDistanceToSeg } from '../drc/shape_collisions.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export class PnsMouseTrailTracer {
  private mTrail = new PnsLineChain();
  private mTolerance = 0;
  private mDirection: Direction45 = Direction45.UNDEFINED;
  private mLastSegDirection: Direction45 = Direction45.UNDEFINED;
  private mForced = false;
  private mDisableMouse = false;
  private mManuallyForced = false;

  /**
   * `Clear()` (`mtt.cpp:39-44`). Note what it does *not* reset: the tolerance,
   * `m_disableMouse`, and both directions all survive. `LINE_PLACER::FixRoute`
   * relies on that — it clears the trail and then immediately re-seeds the
   * directions, but never re-states the mouse-disabled flag.
   */
  clear(): void {
    this.mForced = false;
    this.mManuallyForced = false;
    this.mTrail.clear();
  }

  /**
   * `AddTrailPoint( aP )` (`mtt.cpp:47-81`).
   *
   * The interesting half is the self-approach test: when the new segment comes
   * within `m_tolerance` of an *old* segment of the trail, the trail is
   * truncated back to that segment. That is how a user who loops the cursor
   * around and comes back gets a trail describing the loop rather than a trail
   * describing everything since the click.
   *
   * Two bounds keep it from firing on the trail's own recent history:
   * `segmentCount() > 2` before testing at all, and `i < segmentCount() - 2`,
   * so the two most recent segments — which are adjacent to the new one and
   * therefore always within tolerance of it — are never candidates.
   *
   * The distance test is squared on both sides (`limit = tolerance²`), so an
   * exact touch at the tolerance counts (`<=`).
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
   * `Tolerance()`. Kept because the draggers' independent port of this class
   * exposed it; nothing reads it today, but it is upstream's accessor and
   * dropping it during a merge would be a silent narrowing rather than a
   * decision.
   */
  tolerance(): number {
    return this.mTolerance;
  }

  setTolerance(aTolerance: number): void {
    this.mTolerance = aTolerance;
  }

  /**
   * `SetDefaultDirections( aInitDirection, aLastSegDir )`
   * (`pns_mouse_trail_tracer.h:44-48`).
   *
   * The two arguments land in different members and mean different things: the
   * first *is* the current posture, the second is the direction of the segment
   * the route is leaving, used only to correct the posture into something that
   * makes a sane corner with it. `LINE_PLACER` passes them in opposite orders
   * from `FixRoute` and `UnfixRoute`, which is deliberate on both sides.
   */
  setDefaultDirections(aInitDirection: Direction45, aLastSegDir: Direction45): void {
    this.mDirection = aInitDirection;
    this.mLastSegDirection = aLastSegDir;
  }

  setMouseDisabled(aDisabled = true): void {
    this.mDisableMouse = aDisabled;
  }

  isManuallyForced(): boolean {
    return this.mManuallyForced;
  }

  /** `GetTrailLeadVector()` (`mtt.cpp:279-289`). */
  getTrailLeadVector(): Vec2 {
    if (this.mTrail.pointCount() < 2) return { x: 0, y: 0 };

    const last = this.mTrail.cLastPoint();
    const first = this.mTrail.cPoint(0);

    return { x: last.x - first.x, y: last.y - first.y };
  }

  /**
   * `FlipPosture()` (`mtt.cpp:271-276`): a **45° right turn**, and it latches
   * both `m_forced` and `m_manuallyForced`.
   *
   * `m_manuallyForced` is the stronger of the two and is never cleared except by
   * `Clear()`. Once the user has pressed the posture key, the mouse trail is out
   * of the picture for the rest of the placement, and `LINE_PLACER` additionally
   * stops enabling SMART_PADS optimisation and stops running FANOUT_CLEANUP
   * (`pns_line_placer.cpp:775`, `:1056`) — both of which would override the
   * posture the user just chose.
   */
  flipPosture(): void {
    this.mDirection = this.mDirection.right();
    this.mForced = true;
    this.mManuallyForced = true;
  }

  /**
   * `GetPosture( aP )` (`mtt.cpp:84-268`).
   *
   * The five tuning constants, upstream's values and upstream's names:
   *
   * | constant | value | what it does |
   * | --- | --- | --- |
   * | `areaRatioThreshold` | 1.3 | how much better one candidate must fit |
   * | `areaRatioEpsilon` | 0.25 | dead band on top of it, to stop flutter |
   * | `minAreaCutoffDistanceFactor` | 6 | trail must be this many tolerances long |
   * | `lockDistanceFactor` | 30 | past this, the answer is frozen |
   * | `unlockDistanceFactor` | 10 | drag back inside this, and it thaws |
   *
   * The two live decision thresholds are therefore `ratio > 1.55` and
   * `ratio < 0.5192…` (`1/1.3 - 0.25`). Between them the current posture is
   * kept — that band is the whole reason the trace does not flip back and forth
   * while the cursor sits near the diagonal.
   */
  getPosture(aP: Vec2): Direction45 {
    const areaRatioThreshold = 1.3;
    const areaRatioEpsilon = 0.25;
    const minAreaCutoffDistanceFactor = 6;
    const lockDistanceFactor = 30;
    const unlockDistanceFactor = 10;

    if (this.mTrail.pointCount() < 2 || this.mManuallyForced) {
      // With no trail to measure, the previous segment is the best hint there
      // is — except when the mouse is disabled, where upstream assumes the user
      // wants to alternate postures every segment and turns right instead.
      if (!this.mManuallyForced && this.mLastSegDirection.isDefined()) {
        this.mDirection = this.mDisableMouse
          ? this.mLastSegDirection.right()
          : this.mLastSegDirection;
      }

      return this.mDirection;
    }

    const p0 = this.mTrail.cPoint(0);
    const refLength = Math.round(Math.hypot(aP.x - p0.x, aP.y - p0.y));

    const straight = PnsLineChain.fromPoints(
      Direction45.UNDEFINED.buildInitialTrace(p0, aP, false),
    );
    straight.setClosed(true);
    straight.appendChain(this.mTrail.reverse());
    straight.simplify();

    const areaS = straight.area();

    const diag = PnsLineChain.fromPoints(Direction45.UNDEFINED.buildInitialTrace(p0, aP, true));
    diag.appendChain(this.mTrail.reverse());
    diag.setClosed(true);
    diag.simplify();

    const areaDiag = diag.area();
    const ratio = areaS / (areaDiag + 1.0);

    // Heuristic for "the user dragged the cursor back to where they started":
    // cancel any forced posture and restart the trail from that point.
    if (this.mForced && refLength < unlockDistanceFactor * this.mTolerance) {
      this.mForced = false;
      const start = { ...p0 };
      this.mTrail.clear();
      this.mTrail.appendPoint(start);
    }

    let areaOk = false;

    // Check the trail's own area against a cutoff. This prevents flutter when
    // the trail is very close to a straight line, where both candidate polygons
    // are near-degenerate and their ratio is noise.
    if (!this.mForced && refLength > minAreaCutoffDistanceFactor * this.mTolerance) {
      const areaCutoff = this.mTolerance * refLength;
      const trail = this.mTrail.clone();
      trail.setClosed(true);

      if (trail.area() > areaCutoff) areaOk = true;
    }

    const straightDirection = Direction45.fromSeg(straight.cSegment(0).a, straight.cSegment(0).b);
    const diagDirection = Direction45.fromSeg(diag.cSegment(0).a, diag.cSegment(0).b);
    let newDirection: Direction45;

    if (!this.mForced && areaOk && ratio > areaRatioThreshold + areaRatioEpsilon)
      newDirection = diagDirection;
    else if (!this.mForced && areaOk && ratio < 1.0 / areaRatioThreshold - areaRatioEpsilon)
      newDirection = straightDirection;
    else newDirection = this.mDirection.isDiagonal() ? diagDirection : straightDirection;

    if (!this.mDisableMouse && !newDirection.equals(this.mDirection))
      this.mDirection = newDirection;

    // If we have a last segment, correct the direction relative to it. For a
    // segment exit we want the least obtuse corner we can get.
    if (!this.mManuallyForced && !this.mDisableMouse && this.mLastSegDirection.isDefined()) {
      if (straightDirection.equals(this.mLastSegDirection)) {
        this.mDirection = straightDirection;
      } else if (diagDirection.equals(this.mLastSegDirection)) {
        this.mDirection = diagDirection;
      } else {
        switch (this.mDirection.angle(this.mLastSegDirection)) {
          case AngleType.ANG_HALF_FULL:
            // A 180° reversal is never acceptable; flip unconditionally.
            this.mDirection = this.mDirection.isDiagonal() ? straightDirection : diagDirection;
            break;

          case AngleType.ANG_ACUTE: {
            // Flip only if it actually buys us a right angle.
            const candidate = this.mDirection.isDiagonal() ? straightDirection : diagDirection;

            if (candidate.angle(this.mLastSegDirection) === AngleType.ANG_RIGHT)
              this.mDirection = candidate;

            break;
          }

          case AngleType.ANG_RIGHT: {
            // Flip only if it actually buys us an obtuse angle.
            const candidate = this.mDirection.isDiagonal() ? straightDirection : diagDirection;

            if (candidate.angle(this.mLastSegDirection) === AngleType.ANG_OBTUSE)
              this.mDirection = candidate;

            break;
          }

          default:
            break;
        }
      }
    }

    // Far enough from the initial point that the user has clearly committed:
    // freeze the solution so it cannot flutter for the rest of the drag.
    if (!this.mForced && refLength > lockDistanceFactor * this.mTolerance) this.mForced = true;

    return this.mDirection;
  }

  /** Test seam: the recorded trail. Upstream keeps `m_trail` private too. */
  trail(): PnsLineChain {
    return this.mTrail;
  }

  /** Test seam: `m_forced`, the "posture locked in" latch. */
  isForced(): boolean {
    return this.mForced;
  }
}

/** Re-exported so callers need not reach into kimath for the enum. */
export { Directions };
