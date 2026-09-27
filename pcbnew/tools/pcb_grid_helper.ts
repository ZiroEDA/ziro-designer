// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_GRID_HELPER` — `pcbnew/tools/pcb_grid_helper.{h,cpp}`, a subclass of
 * the one `GRID_HELPER` in `common/tool/grid_helper.ts`, exactly as upstream
 * derives it. The grid round, the auxiliary axis, the snap/grid enables and the
 * anchor list are the base's; this file adds only what pcbnew adds.
 *
 * This is the piece that decides **where the cursor actually lands**. Without
 * it every cursor position in the editor is `computeNearest` and nothing else,
 * so hovering a track puts the crosshair on the grid node above or below the
 * track rather than on the track: it can only ever sit on the copper when the
 * copper happens to lie on a grid line. `TOOL_BASE::snapToItem`
 * (`router/pns_tool_base.ts`) calls {@link PCB_GRID_HELPER.AlignToSegment} and
 * {@link PCB_GRID_HELPER.AlignToArc} for exactly that.
 *
 * ### What is ported here
 *
 * - `AlignToSegment` (cpp:350-402) — the cursor on a track centreline.
 * - `AlignToArc` (cpp:405-447) — the same for a curved track.
 *
 * `BestSnapAnchor`, `BestDragOrigin` and the anchor collection behind them
 * live in `pcb_cursor_snap.ts` for now, over the plain `Board`.
 *
 * One thing worth recording from reading it, because it is easy to assume
 * otherwise: pcbnew's *general* crosshair does **not** stick to the middle of a
 * track. A track contributes its two ends as `CORNER | SNAPPABLE` anchors and
 * its midpoint as `ORIGIN` — deliberately without `SNAPPABLE` (cpp:1796-1808) —
 * and `BestSnapAnchor` only ever considers `SNAPPABLE` ones. Mid-track
 * stickiness is specifically a router behaviour, which is why it lives behind
 * `snapToItem` and not in the anchor list.
 *
 * ### The grid selector
 *
 * `Align( aPoint, GRID_HELPER_GRIDS )` picks a per-item-type grid, but
 * `PCB_GRID_HELPER::GetGridSize` (cpp:986-1035) returns the GAL's current grid
 * for every selector unless `GRID_SETTINGS::overrides_enabled` is set, and it is
 * off by default. We have no per-type grid overrides in board settings, so the
 * base's `GetGridSize` (one grid for every selector) *is* upstream's behaviour
 * here rather than a simplification of it.
 *
 * ### No `TOOL_MANAGER`
 *
 * The editor has no `VIEW`/`GAL` for the base to read the grid off, so it is
 * fed through the base's manual setters (`SetGridSize`, `SetOrigin`, ...) from
 * a {@link PcbGridState} — see {@link PCB_GRID_HELPER.SetState}.
 */

import { segIntersectLines, segSquaredDistanceToPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import { circleIntersectLine } from '@ziroeda/kimath/src/geometry/circle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { GRID_HELPER } from '@ziroeda/common/tool/grid_helper.js';
import { arcSliceContainsPoint } from '../drc/shape_collisions.js';
import { arcCenterI } from '../router/shape_arc_ops.js';

/** `SEG`, and the shape every segment type in this tree already has. */
export interface GridSeg {
  a: Vec2;
  b: Vec2;
}

/**
 * The `GRID_HELPER` state the ported methods read, as plain data.
 *
 * Upstream these come off the GAL and the tool event: `GetGrid()`,
 * `GetOrigin()`, `canUseGrid()` (which is `m_enableGrid` AND the GAL's grid
 * snapping) and `m_enableSnap` (cleared while Shift is held —
 * `TOOL_BASE::updateEndItem` does `SetSnap( !aEvent.Modifier( MD_SHIFT ) )`).
 */
export interface PcbGridState {
  /** `GetGrid()`, in internal units. A single value; see the file comment. */
  size: number;
  /** `GetOrigin()` — the board's `(setup (grid_origin ...))`. */
  origin: Vec2;
  /** `canUseGrid()`. When false, `Align` returns the point untouched. */
  enableGrid: boolean;
  /** `GetSnap()` — false while Shift is held, which disables item snapping. */
  enableSnap: boolean;
  /**
   * `GRID_HELPER::m_auxAxis` — the point a gesture started from, which stays
   * reachable for the whole gesture even when it is nowhere near a grid line.
   *
   * This is what lets an off-grid item be put back exactly where it came from.
   * Every tool that moves something sets it to the gesture's origin and clears
   * it at the end: `ROUTER_TOOL` to `m_startSnapPoint` (router_tool.cpp:2190)
   * and to the inline-drag origin (:2654), `EDIT_TOOL` to `dragOrigin`
   * (edit_tool_move_fct.cpp:1401), `PCB_POINT_EDITOR` to the original position
   * (pcb_point_editor.cpp:2366).
   */
  auxAxis?: Vec2 | null;
}

/** `AlignToSegment`'s `c_gridSnapEpsilon_sq` (cpp:352). */
const GRID_SNAP_EPSILON_SQ = 4;

/** `VECTOR2I::ECOORD_MAX`, the "nothing found yet" distance. */
const ECOORD_MAX = Number.MAX_SAFE_INTEGER;

/** `VECTOR2I::SquaredEuclideanNorm()` of `a - b`. */
const squaredDist = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return dx * dx + dy * dy;
};

/** The four rays `AlignToSegment` / `AlignToArc` shoot from the aligned cursor. */
const testSegmentsFrom = (aligned: Vec2): GridSeg[] => [
  { a: aligned, b: { x: aligned.x + 1, y: aligned.y } },
  { a: aligned, b: { x: aligned.x, y: aligned.y + 1 } },
  { a: aligned, b: { x: aligned.x + 1, y: aligned.y + 1 } },
  { a: aligned, b: { x: aligned.x + 1, y: aligned.y - 1 } },
];

/**
 * The two "nearest" loops both methods end with (cpp:377-399, :425-444).
 *
 * Note they measure from **different** points: the ends are scored against the
 * raw pointer `aPoint`, the intersections against the grid-aligned `aligned`,
 * and both are compared against the same running minimum. That is upstream as
 * written, and it is what makes the ends win when the pointer is genuinely near
 * one while still letting a mid-span intersection beat an end that the grid
 * round has pulled away from.
 */
function nearestOf(
  aPoint: Vec2,
  aligned: Vec2,
  aEnds: readonly Vec2[],
  aPoints: readonly Vec2[],
): Vec2 {
  let nearest = aligned;
  let minDistSq = ECOORD_MAX;

  // Snap by distance between pointer and endpoints
  for (const pt of aEnds) {
    const dSq = squaredDist(pt, aPoint);

    if (dSq < minDistSq) {
      minDistSq = dSq;
      nearest = pt;
    }
  }

  // Snap by distance between aligned cursor and intersections
  for (const pt of aPoints) {
    const dSq = squaredDist(pt, aligned);

    if (dSq < minDistSq) {
      minDistSq = dSq;
      nearest = pt;
    }
  }

  return nearest;
}

/** `SHAPE_ARC::GetP0()` / `GetP1()`, from the shape this tree stores. */
const arcPointAt = (aArc: GridArc, aAngle: number): Vec2 => ({
  x: aArc.c.x + aArc.rad * Math.cos(aAngle),
  y: aArc.c.y + aArc.rad * Math.sin(aAngle),
});

/** `SHAPE_ARC`, as `Shape`'s arc member spells it. */
export interface GridArc {
  c: Vec2;
  rad: number;
  a0: number;
  sweep: number;
}

const TAU = 2 * Math.PI;
const normTau = (a: number): number => ((a % TAU) + TAU) % TAU;

/**
 * `SHAPE_ARC( aStart, aMid, aEnd, aWidth )` reduced to the slice.
 *
 * A curved track is stored as three points, and `PCB_ARC::Shape()` builds a
 * `SHAPE_ARC` from them; {@link PCB_GRID_HELPER.AlignToArc} wants centre and sweep. The sweep's
 * sign is whichever direction puts the mid point inside it, which is the whole
 * reason the mid point is stored rather than just the two ends.
 *
 * Three collinear points have no centre, and `CalcArcCenter` answers with one
 * clamped to the coordinate limit rather than an error — so the arc comes back
 * with a radius near `INT_MAX`. That is upstream's shape, and upstream catches
 * it downstream instead: `SHAPE_ARC::IntersectLine` (`shape_arc.cpp:346`)
 * refuses any arc whose radius reaches `INT_MAX / 2`, which {@link PCB_GRID_HELPER.AlignToArc}
 * mirrors. Null here is only for a centre that is not a number at all.
 */
export function gridArcFromPoints(aStart: Vec2, aMid: Vec2, aEnd: Vec2): GridArc | null {
  const c = arcCenterI(aStart, aMid, aEnd);

  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;

  const rad = Math.hypot(aStart.x - c.x, aStart.y - c.y);

  if (!(rad > 0) || !Number.isFinite(rad)) return null;

  const a0 = Math.atan2(aStart.y - c.y, aStart.x - c.x);
  const spanCcw = normTau(Math.atan2(aEnd.y - c.y, aEnd.x - c.x) - a0);
  const midCcw = normTau(Math.atan2(aMid.y - c.y, aMid.x - c.x) - a0);

  return { c, rad, a0, sweep: midCcw <= spanCcw ? spanCcw : spanCcw - TAU };
}

export class PCB_GRID_HELPER extends GRID_HELPER {
  /**
   * `PCB_GRID_HELPER()` — no `TOOL_MANAGER`, so the grid comes through the
   * base's manual setters; `aState`, when given, is applied at once.
   */
  constructor(aState?: PcbGridState) {
    super();

    if (aState) this.SetState(aState);
  }

  /**
   * Load one event's {@link PcbGridState} into the base: `SetGridSize` /
   * `SetOrigin` for the GAL values, `SetUseGrid` and `SetSnap` for the two
   * flags a tool pokes per event, and `SetAuxAxes` for the gesture origin.
   *
   * A grid of zero or less is treated as grid snapping off. Upstream cannot
   * reach that state — a GAL grid is always positive — and without the guard
   * `computeNearest` would divide by it; with the grid off `Align` returns the
   * point untouched, which is what this port's old guard answered too.
   */
  SetState(aState: PcbGridState): this {
    this.SetGridSize({ x: aState.size, y: aState.size });
    this.SetOrigin(aState.origin);
    this.SetGridSnapping(true);
    this.SetUseGrid(aState.enableGrid && aState.size > 0);
    this.SetSnap(aState.enableSnap);
    this.SetAuxAxes(!!aState.auxAxis, aState.auxAxis ?? { x: 0, y: 0 });

    return this;
  }

  /**
   * `PCB_GRID_HELPER::AlignToSegment` (cpp:350-402) — the cursor, on a track.
   *
   * Take the grid node nearest the pointer, shoot four rays from it along the
   * routing directions (horizontal, vertical, and both diagonals), and
   * intersect each with the track's **infinite** centreline. An intersection
   * is kept only if it is within `c_gridSnapEpsilon_sq` of the segment itself,
   * which is what discards the ones that land out on the line's extension
   * beyond the track. The winner is then the nearest of the two ends and those
   * intersections (see {@link nearestOf}).
   */
  AlignToSegment(aPoint: Vec2, aSeg: GridSeg): Vec2 {
    const aligned = this.Align(aPoint);

    if (!this.m_enableSnap) return aligned;

    const points: Vec2[] = [];

    for (const seg of testSegmentsFrom(aligned)) {
      const vec = segIntersectLines(aSeg, seg);

      if (vec && segSquaredDistanceToPoint(aSeg, vec) <= GRID_SNAP_EPSILON_SQ) points.push(vec);
    }

    return nearestOf(aPoint, aligned, [aSeg.a, aSeg.b], points);
  }

  /**
   * `PCB_GRID_HELPER::AlignToArc` (cpp:405-447).
   *
   * The same four rays as {@link AlignToSegment}, through
   * `SHAPE_ARC::IntersectLine` (`shape_arc.cpp:341`) — which is the circle's
   * intersection with the infinite line, filtered to the arc's angular slice.
   * That filter is why there is no epsilon test here: unlike the segment case,
   * the intersection routine has already thrown away everything off the arc.
   */
  AlignToArc(aPoint: Vec2, aArc: GridArc): Vec2 {
    const aligned = this.Align(aPoint);

    if (!this.m_enableSnap) return aligned;

    const points: Vec2[] = [];
    const slice = { ...aArc, halfWidth: 0 };

    // `SHAPE_ARC::IntersectLine` (`shape_arc.cpp:346-347`) returns nothing at
    // all for an arc this large. It is how the degenerate arc that
    // `CalcArcCenter` builds from three collinear points — centre clamped to
    // the coordinate limit — stops short of producing meaningless crossings.
    const degenerate = aArc.rad >= 2_147_483_647 / 2;

    for (const seg of degenerate ? [] : testSegmentsFrom(aligned)) {
      for (const ip of circleIntersectLine({ c: aArc.c, r: aArc.rad }, seg)) {
        if (arcSliceContainsPoint(slice, ip)) points.push(ip);
      }
    }

    return nearestOf(
      aPoint,
      aligned,
      [arcPointAt(aArc, aArc.a0), arcPointAt(aArc, aArc.a0 + aArc.sweep)],
      points,
    );
  }
}

/**
 * `Align( aPoint )` for one event's state: the grid round, and the auxiliary
 * axis that keeps a gesture's origin reachable off-grid — both the base's.
 */
export function align(aPoint: Vec2, aGrid: PcbGridState): Vec2 {
  return new PCB_GRID_HELPER(aGrid).Align(aPoint);
}

/** `AlignToSegment` for one event's state. */
export function alignToSegment(aPoint: Vec2, aSeg: GridSeg, aGrid: PcbGridState): Vec2 {
  return new PCB_GRID_HELPER(aGrid).AlignToSegment(aPoint, aSeg);
}

/** `AlignToArc` for one event's state. */
export function alignToArc(aPoint: Vec2, aArc: GridArc, aGrid: PcbGridState): Vec2 {
  return new PCB_GRID_HELPER(aGrid).AlignToArc(aPoint, aArc);
}
