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
 * - `BestSnapAnchor` (cpp:597-934) and `BestDragOrigin` (cpp:507-565), with
 *   the `computeAnchors` passes behind them, over the plain `Board` rather than
 *   `BOARD_ITEM`s: an anchor's `items` list is empty, and item ids stand in for
 *   the `aSkip` / selection pointers. `nearestAnchor` is pcbnew's own.
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

import {
  segIntersectLines,
  segNearestPoint,
  segSquaredDistanceToPoint,
} from '@ziroeda/kimath/src/geometry/seg.js';
import { circleIntersectLine } from '@ziroeda/kimath/src/geometry/circle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { type ANCHOR, ANCHOR_FLAGS, GRID_HELPER } from '@ziroeda/common/tool/grid_helper.js';
import type { Board, PcbBarcode } from '../types.js';
import { parseBoardItemId } from '../edit-board.js';
import { footprintBBox, padBBox } from '../edit-footprint.js';
import { barcodeGeometry, type BarcodeGeometry } from '../pcb_io/kicad_sexpr/board_view.js';
import { rotatePcb } from '../read-board.js';
import { PnsMagneticOption } from '../router/pns_tool_base.js';
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

// ---------------------------------------------------------------------------
// `PCB_GRID_HELPER::BestSnapAnchor` — the *other* cursor.
//
// The router asks "where on this item"; every other tool that snaps asks "what
// is near the cursor at all". The two answer differently on purpose, and the
// difference is the thing that surprises people: `snapToItem` rides a track's
// centreline, while `BestSnapAnchor` will not, because a track contributes its
// two ends as `CORNER | SNAPPABLE` anchors and its midpoint as `ORIGIN`
// deliberately *without* `SNAPPABLE` (cpp:1796-1808) — and only snappable
// anchors are weighed. Mid-track centring outside the router happens in exactly
// one case, and it is the case below where the grid is switched off.
// ---------------------------------------------------------------------------

export interface BestSnapOptions {
  /**
   * `view->ToWorld( 25 )` — the 25-screen-pixel snap radius in world units.
   * Upstream calls the constant `snapSize` (cpp:605).
   */
  snapScale: number;
  /** `GetVisibleGrid().x`, which clamps the snap radius when the grid is on. */
  visibleGrid: number;
  /** `view->ToWorld( ADVANCED_CFG::m_SnapHysteresis )`, 5 px by default. */
  hysteresis?: number;
  /** The active layer — `BestSnapAnchor`'s `aLayers`. */
  layer?: string;
  /** `MAGNETIC_SETTINGS::pads` / `::tracks`. */
  magneticPads?: PnsMagneticOption;
  magneticTracks?: PnsMagneticOption;
  /** `MAGNETIC_SETTINGS::allLayers`, which defeats the layer filter. */
  allLayers?: boolean;
  /**
   * `BestSnapAnchor`'s `aSkip`, as board item ids — the items whose anchors are
   * left out. `PCB_POINT_EDITOR` passes `{ item }` (pcb_point_editor.cpp:2594,
   * :2621, :2644) so a point being dragged cannot snap to the very shape it is
   * reshaping, which would pin it in place.
   */
  avoid?: ReadonlySet<string>;
  /**
   * `aSelectionFilter->points` — the Selection Filter's Points box, which
   * `computeAnchors` consults before adding a `PCB_POINT`'s anchor
   * (`pcb_grid_helper.cpp:1610-1611`, `:1790-1796`). Absent means on, as the
   * filter defaults.
   */
  points?: boolean;
  /**
   * `aSelectionFilter->otherItems`, which gates a barcode's anchors
   * (`pcb_grid_helper.cpp:1916-1917`). A barcode is not in the Graphics
   * category — `pcb_selection_tool.cpp:3522` puts it in the catch-all with
   * targets. Absent means on.
   */
  otherItems?: boolean;
}

/** `LSET` membership for the wildcard layer names a pad carries (`*.Cu`). */
export function layerMatches(aItemLayer: string, aLayer: string): boolean {
  if (aItemLayer === aLayer) return true;

  return aItemLayer.startsWith('*.') && aLayer.endsWith(aItemLayer.slice(1));
}

// ---------------------------------------------------------------------------
// `PCB_GRID_HELPER::BestDragOrigin` — where a move measures itself *from*.
//
// This is the half of a move that decides whether two parts can ever be lined
// up with each other, and it is not obvious from the name. A move does not
// translate the selection by the cursor's travel; it picks an anchor **on the
// selection** (`aFrom = true`, so a footprint offers its own origin), warps the
// pointer onto it — "Warp mouse to origin of moved object", `warp_mouse_on_move`,
// which `common_settings.cpp:255` defaults to **true** — and from then on
// `EDIT_TOOL::Move` only ever writes
//
//     movement = BestSnapAnchor( mousePos ) - prevPos
//
// with `prevPos` starting at that anchor (edit_tool_move_fct.cpp:1311-1351).
// The anchor therefore lands *absolutely* on whatever `BestSnapAnchor` returns
// — a grid node, another footprint's pad — rather than being carried along at
// whatever sub-grid offset it happened to have. Two footprints dragged in the
// same session both end up on grid nodes, which is the whole of "it aligns
// itself" that KiCad feels like and a delta-based move can never reproduce:
// quantising the *travel* preserves the original offset exactly.
//
// A browser cannot warp the pointer, and it does not have to. With the warp,
// upstream's mouse position for the rest of the gesture is the anchor plus the
// motion since the grab, so adding that motion to the anchor and snapping the
// result is the same number by construction.
//
// Note there is no snap radius here: unlike `BestSnapAnchor` this takes the
// nearest anchor however far away it is, because the selection is being grabbed
// and must always have a reference point (upstream falls back to the mouse
// position only when the selection contributes no anchors at all).
// ---------------------------------------------------------------------------

/** `computeAnchors`'s `aFrom = true` inputs that the editor has to supply. */
export interface DragOriginOptions {
  /**
   * `GetGrid()` in internal units — read only by the footprint rule that adds
   * the bounding-box centre as a second anchor when it is more than a grid step
   * away from the footprint's own origin (pcb_grid_helper.cpp:1645-1646).
   */
  gridSize: number;
  /**
   * `view->ToWorld( 50 )`, upstream's `lineSnapMinCornerDistance` (cpp:518).
   * An OUTLINE anchor may only beat a corner/origin one that is further away
   * than this. No item type collects OUTLINE anchors with `aFrom = true`, so
   * this changes nothing today and is here because it is the rule.
   */
  lineSnapMinCornerDistance?: number;
}

/**
 * `addRectPoints( barcode->GetSymbolPoly().BBox(), … )`
 * (`pcb_grid_helper.cpp:1479-1502`): the box's centre, its four corners and
 * the midpoint of each of its four edges.
 *
 * The box is the *symbol's*, taken before the rotation is applied to `m_poly`,
 * so the nine points turn with the barcode rather than boxing it upright.
 */
function barcodeSnapPoints(g: BarcodeGeometry, bc: PcbBarcode): Vec2[] {
  if (g.symbolPoly.length === 0) return [];

  const b = symbolPolyBox(g.symbolPoly);
  const turn = (p: Vec2): Vec2 => {
    if (bc.angle === 0) return p;
    const r = rotatePcb({ x: p.x - bc.at.x, y: p.y - bc.at.y }, bc.angle);
    return { x: r.x + bc.at.x, y: r.y + bc.at.y };
  };

  const tl = { x: b.x1, y: b.y1 };
  const tr = { x: b.x2, y: b.y1 };
  const br = { x: b.x2, y: b.y2 };
  const bl = { x: b.x1, y: b.y2 };
  const mid = (a: Vec2, c: Vec2): Vec2 => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });

  return [
    mid(tl, br), // the box centre
    tl,
    mid(tl, tr),
    tr,
    mid(tr, br),
    br,
    mid(br, bl),
    bl,
    mid(bl, tl),
  ].map(turn);
}

const symbolPolyBox = (
  poly: readonly (readonly (readonly Vec2[])[])[],
): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} => {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;

  for (const rings of poly)
    for (const ring of rings)
      for (const p of ring) {
        if (p.x < x1) x1 = p.x;
        if (p.y < y1) y1 = p.y;
        if (p.x > x2) x2 = p.x;
        if (p.y > y2) y2 = p.y;
      }

  return { x1, y1, x2, y2 };
};

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
    if (aState.auxAxis) this.SetAuxAxes(true, aState.auxAxis);

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

  /**
   * The anchors the last `computeAnchors` pass collected — what upstream's
   * `PCBGridHelperTestFixture` (a friend class) reads off `m_anchors`.
   */
  GetAnchors(): readonly ANCHOR[] {
    return this.m_anchors;
  }

  /**
   * `computeAnchors` over the board's copper — and over its snap points.
   *
   * Ported: pads (`handlePadShape`'s centre), vias, tracks and arcs — the items
   * whose anchors decide where a track or a via can be dropped — plus every
   * `PCB_POINT`, which is what a point is *for*: "a defined snap anchor for
   * component alignment, [or] a routing snap point in a custom pad"
   * (`pcb_point.h:31-35`). A point that did not reach this list would be a
   * marker and nothing more. Not yet ported: graphics, zones, dimensions, text
   * and the construction-geometry intersections, all of which add anchors
   * upstream and none of which change where copper lands.
   */
  protected computeAnchors(
    aBoard: Board,
    aWhere: Vec2,
    aRange: number,
    aOpts: BestSnapOptions,
  ): void {
    const add = (aPos: Vec2, aFlags: number): void => this.addAnchor(aPos, aFlags, []);
    const pads = aOpts.magneticPads ?? PnsMagneticOption.CAPTURE_ALWAYS;
    const tracks = aOpts.magneticTracks ?? PnsMagneticOption.CAPTURE_ALWAYS;

    // `queryVisible`'s horizon: upstream builds a box of `snapRange` about the
    // cursor and asks the view for what is inside it.
    const inRange = (p: Vec2): boolean =>
      Math.abs(p.x - aWhere.x) <= aRange && Math.abs(p.y - aWhere.y) <= aRange;

    const onLayer = (itemLayer: string): boolean =>
      !!aOpts.allLayers || !aOpts.layer || layerMatches(itemLayer, aOpts.layer);

    const skipped = (kind: string, index: number): boolean =>
      aOpts.avoid?.has(`${kind}:${index}`) ?? false;

    if (pads === PnsMagneticOption.CAPTURE_ALWAYS) {
      for (const [fpIndex, fp] of aBoard.footprints.entries()) {
        if (skipped('footprint', fpIndex)) continue;

        for (const pad of fp.pads) {
          if (!pad.layers.some(onLayer)) continue;

          // `handlePadShape`: the pad's own position is its origin anchor.
          if (inRange(pad.at)) add(pad.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);
        }
      }
    }

    if (tracks === PnsMagneticOption.CAPTURE_ALWAYS) {
      for (const [i, v] of aBoard.vias.entries()) {
        if (skipped('via', i)) continue;

        // A via spans layers, so the layer filter never excludes one.
        if (inRange(v.at))
          add(v.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
      }

      const wires: { kind: string; index: number; t: (typeof aBoard.tracks)[number] }[] = [
        ...aBoard.tracks.map((t, index) => ({ kind: 'track', index, t })),
        ...aBoard.arcs.map((a, index) => ({ kind: 'arc', index, t: a })),
      ];

      for (const { kind, index, t } of wires) {
        if (skipped(kind, index)) continue;

        if (!onLayer(t.layer)) continue;

        for (const end of [t.start, t.end]) {
          if (inRange(end)) add(end, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
        }

        // `track->GetCenter()`, added as ORIGIN and *not* SNAPPABLE — see the
        // block comment above. It is here because it is upstream, and because
        // leaving it out would make the omission look accidental.
        const mid = { x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 };

        if (inRange(mid)) add(mid, ANCHOR_FLAGS.ORIGIN);
      }
    }

    // `case PCB_POINT_T: addAnchor( aItem->GetPosition(), ORIGIN | SNAPPABLE, … )`
    // (`pcb_grid_helper.cpp:1790-1797`), and the same for a footprint's own
    // points, which upstream collects in the footprint branch with the comment
    // "Points are also pick-up points" (`:1607-1617`).
    //
    // Outside both magnetic blocks above: `MAGNETIC_SETTINGS` govern pads and
    // tracks, and a point is neither — its anchor is offered whatever those are
    // set to.
    if (aOpts.points !== false) {
      for (const [i, pt] of aBoard.points.entries()) {
        if (skipped('point', i)) continue;
        if (!onLayer(pt.layer)) continue;
        if (inRange(pt.at)) add(pt.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);
      }

      for (const [fpIndex, fp] of aBoard.footprints.entries()) {
        if (skipped('footprint', fpIndex)) continue;

        for (const pt of fp.points) {
          if (!onLayer(pt.layer)) continue;
          if (inRange(pt.at)) add(pt.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);
        }
      }
    }

    // `case PCB_BARCODE_T` (`pcb_grid_helper.cpp:1915-1928`): the item's own
    // position as a centre anchor, then the SYMBOL polygon's bounding box —
    // `GetSymbolPoly().BBox()`, so the human-readable line and any knockout
    // margin are outside it — through `addRectPoints`.
    //
    // Gated on the Selection Filter's "Other items" box rather than on Graphics,
    // matching `pcb_selection_tool.cpp:3522`.
    if (aOpts.otherItems !== false) {
      const barcodes: { kind: string; index: number; bc: PcbBarcode }[] = [
        ...aBoard.barcodes.map((bc, index) => ({ kind: 'barcode', index, bc })),
      ];

      for (const { kind, index, bc } of barcodes) {
        if (skipped(kind, index)) continue;
        if (!onLayer(bc.layer)) continue;

        // `queryVisible`'s horizon is the item's EXTENT against the box round
        // the cursor, not its position: a barcode whose corner is under the
        // cursor has its centre 5 mm away, and gating on the centre would offer
        // the anchors of exactly the items the cursor is not near.
        const g = barcodeGeometry(bc);
        if (g.symbolPoly.length === 0) continue;

        const box = g.bbox;
        if (box.x2 < aWhere.x - aRange || box.x1 > aWhere.x + aRange) continue;
        if (box.y2 < aWhere.y - aRange || box.y1 > aWhere.y + aRange) continue;

        // `addAnchor( aItem->GetPosition(), ORIGIN, barcode, PT_CENTER )`.
        if (inRange(bc.at)) add(bc.at, ANCHOR_FLAGS.ORIGIN);

        for (const p of barcodeSnapPoints(g, bc))
          if (inRange(p)) add(p, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
      }
    }
  }

  /**
   * `PCB_GRID_HELPER::nearestAnchor( aPos, aFlags )` (pcbnew/tools/pcb_grid_helper.cpp:1966)
   * — nearest anchor carrying every flag.
   *
   * A private member of `PCB_GRID_HELPER`, not of `GRID_HELPER`. The base
   * (include/tool/grid_helper.h:55) holds `m_anchors` and the flag set; the search
   * over them belongs to each editor and differs: eeschema's
   * (`EE_GRID_HELPER::nearestAnchor`, eeschema/tools/ee_grid_helper.cpp:553) also
   * takes a `GRID_HELPER_GRIDS` and filters on `SCH_ITEM::IsConnectable()`, which
   * has no meaning on a board where the layer filtering has already happened as the
   * anchors were collected. Ours mirrors that split: `EE_GRID_HELPER` has its own.
   *
   * Upstream then collects every anchor tied for nearest and asks the snap
   * manager which of them the user has activated; that half is not ported.
   */
  private nearestAnchor(aPos: Vec2, aFlags: number): ANCHOR | null {
    let best: ANCHOR | null = null;
    // Upstream's is `std::numeric_limits<double>::max()`. `MAX_SAFE_INTEGER` is
    // not the same seed here: these are *squared* distances in internal units, so
    // it silently rejects every anchor further than ~95 mm from the cursor. That
    // never showed while the only caller pre-filtered its anchors by a screen
    // radius; `bestDragOrigin` does not, because a grabbed selection must always
    // yield a reference point however far away it is.
    let minDist = Number.POSITIVE_INFINITY;

    for (const anchor of this.m_anchors) {
      if ((aFlags & anchor.flags) !== aFlags) continue;

      const d = squaredDist(anchor.pos, aPos);

      if (d < minDist) {
        minDist = d;
        best = anchor;
      }
    }

    return best;
  }

  /**
   * `PCB_GRID_HELPER::BestSnapAnchor` (cpp:597-934) — the cursor for every tool
   * that is not the router.
   *
   * Ported: the snap radius and its clamp to the visible grid, the anchor scan,
   * the point-on-element fallback, and the grid as the last resort. Not ported:
   * snap lines, construction geometry and the `m_snapItem` stickiness — the last
   * of which is why only `snapIn` appears here and `snapOut` does not. `snapOut`
   * exists solely to hold a snap that has *already* been made, so a stateless
   * port is upstream's entry behaviour exactly.
   */
  BestSnapAnchor(aBoard: Board, aWhere: Vec2, aOpts: BestSnapOptions): Vec2 {
    // Snapping distance is in screen space, clamped to the current grid so that
    // the grid points that are visible can always be snapped to (cpp:604-615).
    const snapRange = Math.round(
      this.canUseGrid() ? Math.min(aOpts.snapScale, aOpts.visibleGrid) : aOpts.snapScale,
    );

    const nearestGrid = this.Align(aWhere);

    if (!this.m_enableSnap) return nearestGrid;

    this.clearAnchors();
    this.m_snapItem = null;
    this.computeAnchors(aBoard, aWhere, snapRange, aOpts);

    const nearest = this.nearestAnchor(aWhere, ANCHOR_FLAGS.SNAPPABLE);
    const snapIn = Math.max(0, snapRange - (aOpts.hysteresis ?? 0));

    if (nearest && nearest.Distance(aWhere) <= snapIn) {
      this.m_snapItem = nearest;

      return { ...nearest.pos };
    }

    // "If we're snapping to a grid, on-element snaps would be too intrusive but
    // they're useful when there isn't a grid to snap to" (cpp:896-917). This is
    // the one path outside the router that puts the cursor on a track's
    // centreline rather than at one of its ends.
    if (!this.canUseGrid()) {
      let best: Vec2 | null = null;
      let bestDist = Number.MAX_SAFE_INTEGER;

      for (const t of [...aBoard.tracks, ...aBoard.arcs]) {
        if (!aOpts.allLayers && aOpts.layer && !layerMatches(t.layer, aOpts.layer)) continue;

        const p = segNearestPoint({ a: t.start, b: t.end }, aWhere);
        const d = squaredDist(p, aWhere);

        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }

      if (best && Math.hypot(best.x - aWhere.x, best.y - aWhere.y) <= snapRange) return best;
    }

    return nearestGrid;
  }

  /**
   * `PCB_GRID_HELPER::computeAnchors( aItems, aRefPos, aFrom = true )` over the
   * selection, as board item ids.
   *
   * `aFrom = true` is a different anchor set from the one {@link
   * computeCopperAnchors} builds, not merely a filtered one:
   *
   * - a pad contributes **only** its centre — "if we are getting a drag point, we
   *   don't want to center the edge of pads" (cpp:1374-1376), so none of the
   *   outline key points are collected;
   * - a footprint contributes its own origin unconditionally, plus the centre of
   *   its bounding box when that is more than a grid step away, plus the centres
   *   of the pads whose bounding box the cursor is actually inside (cpp:1576-1648);
   * - an arc offers its stored midpoint but *not* its derived geometric centre,
   *   which is rarely on the grid (cpp:1315-1323).
   *
   * Not ported, all for the same reason `computeCopperAnchors` leaves them out —
   * they are anchor sources we have no geometry for here: graphic shapes, zone
   * outlines, dimensions, text, and the construction-geometry intersections.
   * A selection made only of those falls back to the cursor, which is upstream's
   * own answer when nothing contributes an anchor.
   */
  computeDragAnchors(
    aBoard: Board,
    aItems: Iterable<string>,
    aWhere: Vec2,
    aOpts: DragOriginOptions,
  ): void {
    const add = (aPos: Vec2, aFlags: number): void => this.addAnchor(aPos, aFlags, []);
    // `VECTOR2I grid( GetGrid() ); … > grid.SquaredEuclideanNorm()`, and a GAL
    // grid is square here, so the threshold is both axes together.
    const gridSq = 2 * aOpts.gridSize * aOpts.gridSize;

    const pad = (p: { at: Vec2 }): void => {
      add(p.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);
    };

    for (const id of aItems) {
      const ref = parseBoardItemId(id);
      if (!ref) continue;

      switch (ref.kind) {
        case 'footprint': {
          const fp = aBoard.footprints[ref.index];
          if (!fp) break;

          // "pad->GetBoundingBox().Contains( aRefPos )" (cpp:1592): only a pad the
          // cursor is genuinely over is a pick-up point, which is what makes
          // grabbing a part by one of its pads drag it by that pad.
          for (const p of fp.pads) {
            const bb = padBBox(p);
            if (
              bb &&
              aWhere.x >= bb.minX &&
              aWhere.x <= bb.maxX &&
              aWhere.y >= bb.minY &&
              aWhere.y <= bb.maxY
            )
              pad(p);
          }

          add(fp.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);

          // `footprint->GetBoundingBox( false )` — the box without the text, so a
          // long reference cannot drag the centre off the part.
          const bb = footprintBBox(fp, false);
          if (bb) {
            const centre = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
            if (squaredDist(centre, fp.at) > gridSq)
              add(centre, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);
          }

          break;
        }

        case 'pad': {
          const p = aBoard.footprints[ref.index]?.pads[ref.sub ?? 0];
          if (p) pad(p);
          break;
        }

        case 'via': {
          const v = aBoard.vias[ref.index];
          if (v) add(v.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          break;
        }

        case 'track': {
          const t = aBoard.tracks[ref.index];
          if (!t) break;
          add(t.start, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          add(t.end, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          add({ x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 }, ANCHOR_FLAGS.ORIGIN);
          break;
        }

        case 'arc': {
          const a = aBoard.arcs[ref.index];
          if (!a) break;
          add(a.start, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          add(a.end, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          // The stored midpoint, which is grid-aligned when the arc is. The
          // derived centre is deliberately *not* offered as the arc's own origin.
          add(a.mid, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          break;
        }

        default:
          break;
      }
    }
  }

  /**
   * `PCB_GRID_HELPER::BestDragOrigin` (cpp:507-565) — the point a move measures
   * itself from, given the selection and the raw mouse position.
   *
   * Origin beats corner beats outline, each only when it is nearer; the outline
   * anchor additionally may not win unless the best of the other two is further
   * away than `lineSnapMinCornerDistance`. With no anchors at all the cursor
   * itself is the answer.
   */
  BestDragOrigin(
    aBoard: Board,
    aItems: Iterable<string>,
    aWhere: Vec2,
    aOpts: DragOriginOptions,
  ): Vec2 {
    this.clearAnchors();
    this.computeDragAnchors(aBoard, aItems, aWhere, aOpts);

    const nearestOutline = this.nearestAnchor(aWhere, ANCHOR_FLAGS.OUTLINE);
    const nearestCorner = this.nearestAnchor(aWhere, ANCHOR_FLAGS.CORNER);
    const nearestOrigin = this.nearestAnchor(aWhere, ANCHOR_FLAGS.ORIGIN);

    let best: ANCHOR | null = null;
    let minDist = Number.MAX_VALUE;

    if (nearestOrigin) {
      minDist = nearestOrigin.Distance(aWhere);
      best = nearestOrigin;
    }

    if (nearestCorner) {
      const d = nearestCorner.Distance(aWhere);
      if (d < minDist) {
        minDist = d;
        best = nearestCorner;
      }
    }

    if (nearestOutline) {
      const d = nearestOutline.Distance(aWhere);
      if (minDist > (aOpts.lineSnapMinCornerDistance ?? 0) && d < minDist) best = nearestOutline;
    }

    return best ? { x: best.pos.x, y: best.pos.y } : { x: aWhere.x, y: aWhere.y };
  }
}

/**
 * `Align( aPoint )` for one event's state: the grid round, and the auxiliary
 * axis that keeps a gesture's origin reachable off-grid — both the base's.
 */
export function align(aPoint: Vec2, aGrid: PcbGridState): Vec2 {
  return new PCB_GRID_HELPER(aGrid).Align(aPoint);
}
