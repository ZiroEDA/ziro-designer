// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `POLYGON_GEOM_MANAGER` — the corner-by-corner outline every KiCad polygon
 * tool is built on. Counterpart: `common/preview_items/polygon_geom_manager.cpp`
 * and `include/preview_items/polygon_geom_manager.h`.
 *
 * It lives in `common/` upstream because it is not one tool's and not one
 * editor's. `DRAWING_TOOL::DrawZone` drives it for **all four** of Add Zone,
 * Add Rule Area, Zone Cutout and Draw Polygon (the mode only changes what
 * `ZONE_CREATE_HELPER::commitZone` builds at the end), and the footprint editor
 * runs the same tool. Every one of those sees the same three chains and the
 * same closing rule; a copy parked in a canvas is a copy the others drift from.
 *
 * The three chains are the whole model, and they are what our hand-rolled
 * version was missing:
 *
 * - **locked** — the corners the user has clicked. These are the polygon.
 * - **leader** — from the last locked corner to the cursor. One segment in
 *   `DIRECT` mode; in `DEG45`/`DEG90` it is a *two* segment dogleg through a
 *   computed mid point, and clicking locks in **both** of its points.
 * - **loop** — from the cursor back to the *first* corner, and only in the
 *   constrained modes, where closing the ring also has to obey the angle rule.
 *   In `DIRECT` mode it is empty, because the closing segment is straight and
 *   `POLYGON_ITEM` gets it for free from the fill.
 *
 * The loop chain is why {@link build45DegLeader} is called a second time on the
 * *reversed* locked chain: the constraint at the closing end is measured from
 * the first corner's outgoing direction, not the last corner's.
 *
 * The client callbacks mirror `POLYGON_GEOM_MANAGER::CLIENT`. `onFirstPoint`
 * returning false is a real veto — `ZONE_CREATE_HELPER` returns false when the
 * zone properties dialog is cancelled, and the outline never starts.
 */

import { EDA_ANGLE, ANGLE_45 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { LeaderMode, vectorSnapped45 } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { segIntersect, segSquaredDistanceToPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * Re-exported so a caller that reaches for the manager gets its mode with it.
 * The enum itself belongs to kimath (`geometry_utils.h:42-51`), because
 * `TWO_POINT_GEOMETRY_MANAGER` and `PCB_TOOL_BASE::GetAngleSnapMode` read the
 * same one.
 */
export { LeaderMode };

/** `POLYGON_GEOM_MANAGER::CLIENT`, the tool the manager reports back to. */
export interface PolygonGeomClient {
  /**
   * Called before the very first corner is locked in. Return false to refuse
   * to start — `ZONE_CREATE_HELPER::OnFirstPoint` does exactly that when the
   * zone properties dialog comes back cancelled.
   */
  onFirstPoint(mgr: PolygonGeomManager): boolean;
  /** Called whenever any of the three chains changed. */
  onGeometryChange(mgr: PolygonGeomManager): void;
  /** Called when the outline is closed; the client builds the real item. */
  onComplete(mgr: PolygonGeomManager): void;
}

/**
 * `SHAPE_LINE_CHAIN::Append( aP, aAllowDuplication = false )`: a point equal to
 * the current last point is silently dropped.
 *
 * This is not a nicety — `AddPoint` deliberately appends the leader's *whole*
 * tail, whose first element is the corner already locked in, and relies on this
 * to swallow it. Appending blindly would double every corner.
 */
function appendPoint(chain: Vec2[], pt: Vec2): void {
  const last = chain[chain.length - 1];
  if (last && last.x === pt.x && last.y === pt.y) return;
  chain.push({ x: pt.x, y: pt.y });
}

/**
 * `build45DegLeader` (polygon_geom_manager.cpp:157-217): the H/V/45 dogleg from
 * the last point of `lastPoints` to `endPoint`.
 *
 * With a single locked point there is no previous direction to react to, so the
 * result is the one snapped segment `GetVectorSnapped45` gives. With two or
 * more, the bend is placed at whichever end keeps the turn shallow: `bendEnd`
 * is true when the new segment is within 45° of the previous one (or within the
 * 90..135 band), and a previous segment that is *itself* diagonal flips that
 * choice, because the diagonal is then the piece that has to move.
 */
function build45DegLeader(endPoint: Vec2, lastPoints: readonly Vec2[]): Vec2[] {
  if (lastPoints.length < 1) return [];

  const lastPt = lastPoints[lastPoints.length - 1]!;
  const lineVec = { x: endPoint.x - lastPt.x, y: endPoint.y - lastPt.y };

  // `aLastPoints.SegmentCount() < 1` — one point is no segment, so no previous
  // direction exists.
  if (lastPoints.length < 2) {
    const snapped = vectorSnapped45(lineVec);
    return [lastPt, { x: lastPt.x + snapped.x, y: lastPt.y + snapped.y }];
  }

  const prev = lastPoints[lastPoints.length - 2]!;
  const lineA = EDA_ANGLE.fromVector(lineVec);
  const prevA = EDA_ANGLE.fromVector(
    vectorSnapped45({ x: lastPt.x - prev.x, y: lastPt.y - prev.y }),
  );

  const vertical = Math.abs(lineVec.y) > Math.abs(lineVec.x);
  const horizontal = Math.abs(lineVec.y) < Math.abs(lineVec.x);

  const angDiff = Math.abs(lineA.sub(prevA).Normalize180().AsDegrees());

  let bendEnd = angDiff < 45 || (angDiff > 90 && angDiff < 135);

  const prev90 = prevA.Clone().Normalize90();
  if (prev90.equals(ANGLE_45) || prev90.equals(ANGLE_45.negate())) bendEnd = !bendEnd;

  let mid = { x: endPoint.x, y: endPoint.y };

  if (bendEnd) {
    if (vertical)
      mid = { x: lastPt.x, y: endPoint.y + (lineVec.y > 0 ? -1 : 1) * Math.abs(lineVec.x) };
    else if (horizontal)
      mid = { x: endPoint.x + (lineVec.x > 0 ? -1 : 1) * Math.abs(lineVec.y), y: lastPt.y };
  } else {
    if (vertical)
      mid = { x: endPoint.x, y: lastPt.y + (lineVec.y > 0 ? 1 : -1) * Math.abs(lineVec.x) };
    else if (horizontal)
      mid = { x: lastPt.x + (lineVec.x > 0 ? 1 : -1) * Math.abs(lineVec.y), y: endPoint.y };
  }

  return [lastPt, { x: KiROUND(mid.x), y: KiROUND(mid.y) }, endPoint];
}

/**
 * `build90DegLeader` (polygon_geom_manager.cpp:219-231): the H-then-V dogleg.
 *
 * The mid point is always `( end.x, last.y )` — horizontal first — and an
 * already-orthogonal move degenerates to the single segment.
 */
function build90DegLeader(endPoint: Vec2, lastPoints: readonly Vec2[]): Vec2[] {
  if (lastPoints.length < 1) return [];

  const lastPt = lastPoints[lastPoints.length - 1]!;

  if (lastPt.x === endPoint.x || lastPt.y === endPoint.y) return [lastPt, endPoint];

  return [lastPt, { x: endPoint.x, y: lastPt.y }, endPoint];
}

/** `POLYGON_GEOM_MANAGER`. */
export class PolygonGeomManager {
  private readonly client_: PolygonGeomClient;
  private lockedPoints_: Vec2[] = [];
  private leaderPts_: Vec2[] = [];
  private loopPts_: Vec2[] = [];
  private leaderMode_: LeaderMode = LeaderMode.DIRECT;
  private intersectionsAllowed_ = true;

  constructor(client: PolygonGeomClient) {
    this.client_ = client;
  }

  /**
   * `AddPoint`: lock in a corner.
   *
   * The point the caller passes is *not* what necessarily gets stored. When the
   * leader is a dogleg its mid point is a corner too, so both of its trailing
   * points go in; only the unconstrained case appends the cursor directly.
   * Returns false if the client vetoed the first point, or if the corner would
   * self-intersect an outline that does not allow it.
   */
  addPoint(pt: Vec2): boolean {
    if (!this.isPolygonInProgress() && !this.client_.onFirstPoint(this)) return false;

    if (this.leaderPts_.length > 1) {
      appendPoint(this.lockedPoints_, this.leaderPts_[this.leaderPts_.length - 2]!);
      appendPoint(this.lockedPoints_, this.leaderPts_[this.leaderPts_.length - 1]!);
    } else {
      appendPoint(this.lockedPoints_, pt);
    }

    if (!this.intersectionsAllowed_ && this.isSelfIntersecting(false)) {
      this.lockedPoints_.pop();
      return false;
    }

    if (this.lockedPoints_.length > 0) this.updateTemporaryLines(pt);

    this.client_.onGeometryChange(this);
    return true;
  }

  /** `SetFinished`: hand the outline to the client to build the real item. */
  setFinished(): void {
    this.client_.onComplete(this);
  }

  /** `SetLeaderMode`. */
  setLeaderMode(mode: LeaderMode): void {
    this.leaderMode_ = mode;
  }

  /** `GetLeaderMode`. */
  getLeaderMode(): LeaderMode {
    return this.leaderMode_;
  }

  /** `AllowIntersections`. pcbnew never turns it off; the footprint wizard does. */
  allowIntersections(enabled: boolean): void {
    this.intersectionsAllowed_ = enabled;
  }

  /** `IntersectionsAllowed`. */
  intersectionsAllowed(): boolean {
    return this.intersectionsAllowed_;
  }

  /**
   * `IsSelfIntersecting`: does the outline cross itself, counting the implicit
   * closing segment (`pts.SetClosed( true )` before the test)?
   *
   * `SHAPE_LINE_CHAIN::SelfIntersecting` (`shape_line_chain.cpp:2102-2183`)
   * transcribed: an endpoint *lying on* another segment counts, not only a
   * proper crossing, with the two exemptions upstream carves out — a segment
   * always contains its own successor's start, and on a closed chain the last
   * segment always ends on the first segment's start.
   *
   * Nothing in pcbnew turns intersection checking off, so this runs only for a
   * caller that has asked for it. It is kept because it is the class's API and
   * a reimplementation at a call site would be the copy this module exists to
   * prevent.
   */
  isSelfIntersecting(includeLeaderPts: boolean): boolean {
    const pts: Vec2[] = this.lockedPoints_.map((p) => ({ x: p.x, y: p.y }));

    if (includeLeaderPts) {
      const first = pts[0];
      for (const p of this.leaderPts_) {
        if (!first || p.x !== first.x || p.y !== first.y) appendPoint(pts, p);
      }
    }

    // A closed chain's segment count equals its point count.
    const ptCount = pts.length;
    const segCount = ptCount;

    if (segCount < 2) return false;

    const endIdx = (i: number): number => (i + 1 < ptCount ? i + 1 : 0);
    // `SEG::Contains( aP )` is `SquaredDistance( aP ) <= 3`.
    const contains = (a: Vec2, b: Vec2, p: Vec2): boolean =>
      segSquaredDistanceToPoint({ a, b }, p) <= 3;

    for (let s1 = 0; s1 < segCount; s1++) {
      const a1 = pts[s1]!;
      const b1 = pts[endIdx(s1)]!;

      for (let s2 = s1 + 1; s2 < segCount; s2++) {
        const a2 = pts[s2]!;
        const b2 = pts[endIdx(s2)]!;

        if (s1 + 1 !== s2 && contains(a1, b1, a2)) return true;
        // "for closed polylines, the ending point of the last segment ==
        // starting point of the first segment; this is a normal case".
        if (contains(a1, b1, b2) && !(s1 === 0 && s2 === segCount - 1)) return true;
        if (segIntersect({ a: a1, b: b1 }, { a: a2, b: b2 }, true) !== null) return true;
      }
    }

    return false;
  }

  /** `SetCursorPosition`: a motion event; only meaningful once started. */
  setCursorPosition(pos: Vec2): void {
    if (this.lockedPoints_.length > 0) this.updateTemporaryLines(pos);
  }

  /** `IsPolygonInProgress`. */
  isPolygonInProgress(): boolean {
    return this.lockedPoints_.length > 0;
  }

  /** `PolygonPointCount`. */
  polygonPointCount(): number {
    return this.lockedPoints_.length;
  }

  /**
   * `NewPointClosesOutline`: is this point *exactly* the first corner?
   *
   * Exactly — there is no tolerance. Both the cursor and the first corner have
   * been through the same grid snap, so hitting it is a matter of landing on
   * the same grid node, and a radius here would instead steal clicks that were
   * meant to place a corner near the start.
   */
  newPointClosesOutline(pt: Vec2): boolean {
    const first = this.lockedPoints_[0];
    return !!first && first.x === pt.x && first.y === pt.y;
  }

  /**
   * `DeleteLastCorner`: drop the most recent corner and return it, so the
   * caller can warp the cursor back onto it. Returns null when there was none.
   */
  deleteLastCorner(): Vec2 | null {
    let last: Vec2 | null = null;

    if (this.lockedPoints_.length > 0) last = this.lockedPoints_.pop() ?? null;

    // Update the new last segment (was previously locked in), reusing the last
    // constraints.
    const leaderLast = this.leaderPts_[this.leaderPts_.length - 1];
    if (this.lockedPoints_.length > 0 && leaderLast) this.updateTemporaryLines(leaderLast);

    this.client_.onGeometryChange(this);
    return last;
  }

  /** `Reset`: throw the outline away. */
  reset(): void {
    this.lockedPoints_ = [];
    this.leaderPts_ = [];
    this.loopPts_ = [];

    this.client_.onGeometryChange(this);
  }

  /** `GetLockedInPoints`. */
  getLockedInPoints(): readonly Vec2[] {
    return this.lockedPoints_;
  }

  /** `GetLeaderLinePoints`. */
  getLeaderLinePoints(): readonly Vec2[] {
    return this.leaderPts_;
  }

  /** `GetLoopLinePoints`. */
  getLoopLinePoints(): readonly Vec2[] {
    return this.loopPts_;
  }

  /**
   * `updateTemporaryLines`: rebuild the leader and loop chains for a cursor at
   * `endPoint`.
   *
   * `modifier` is upstream's per-event override — the tool passes `DIRECT` when
   * Ctrl is down, which suspends the mode for that event without changing it.
   */
  updateTemporaryLines(endPoint: Vec2, modifier?: LeaderMode): void {
    if (this.lockedPoints_.length === 0) return;
    const lastPt = this.lockedPoints_[this.lockedPoints_.length - 1]!;

    if (this.leaderMode_ === LeaderMode.DEG45 || modifier === LeaderMode.DEG45) {
      this.leaderPts_ = build45DegLeader(endPoint, this.lockedPoints_);
      this.loopPts_ = build45DegLeader(endPoint, [...this.lockedPoints_].reverse()).reverse();
    } else if (this.leaderMode_ === LeaderMode.DEG90 || modifier === LeaderMode.DEG90) {
      this.leaderPts_ = build90DegLeader(endPoint, this.lockedPoints_);
      this.loopPts_ = build90DegLeader(endPoint, [...this.lockedPoints_].reverse()).reverse();
    } else {
      // Direct segment.
      this.leaderPts_ = [lastPt, endPoint];
      this.loopPts_ = [];
    }

    this.client_.onGeometryChange(this);
  }
}
