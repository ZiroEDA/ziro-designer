// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where the routing cursor lands over a board — `TOOL_BASE::updateStartItem` /
 * `updateEndItem` (`pcbnew/router/pns_tool_base.cpp:341-430`) without the tool
 * manager.
 *
 * Upstream this is two calls: `pickSingleItem` decides *which* item under the
 * cursor the router latches onto, and `snapToItem` decides *where on it* the
 * cursor goes. Both are already ported in `router/pns_tool_base.ts` — but they
 * work on `PNS::ITEM`s, which only exist once a `PnsSession` has synced the
 * world. The editor has no session yet, so this is the same decision over plain
 * `Board` items, and it is deliberately the *only* place that logic lives so
 * there is one thing to delete when the session is wired in.
 *
 * The picking here is the editor's existing hit-tester rather than a port of
 * `pickSingleItem`'s five-slot priority table; what this module makes faithful
 * is the second half, "where on the item", which is what decides whether the
 * crosshair sits on the copper or floats above it.
 */

import type { Board } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { boardHitCandidates, parseBoardItemId } from './edit-board.js';
import { segNearestPointToPoint } from './drc/shape_collisions.js';
import {
  align,
  alignToArc,
  alignToSegment,
  gridArcFromPoints,
  type PcbGridState,
} from './pcb_grid_helper.js';

/** What the cursor found: the net to route, and the point to route from. */
export interface BoardCursorSnap {
  net: number;
  snap: Vec2;
  /** Which kind of item won, for callers that highlight it. */
  kind: 'pad' | 'via' | 'track' | 'arc';
}

/** The knobs `updateEndItem` reads off the frame. */
export interface BoardSnapOptions {
  /**
   * `boardHitCandidates`'s slop, in internal units — the editor derives it from
   * `MAX_SLOP` = 5 px at the current zoom.
   */
  tol: number;
  /**
   * The active copper layer. `pickSingleItem` fills its five priority slots so
   * that "a pad on this layer" beats "a track on this layer" beats "a pad on
   * another layer" — the active layer is a *preference*, not a filter, and an
   * item elsewhere is still picked when nothing here matches. {@link
   * snapToBoardCopper} reproduces that ordering with two passes.
   */
  layer?: string;
}

/**
 * `TOOL_BASE::snapToItem`'s SOLID_T arm: a pad snaps to its anchor, which for
 * every pad this editor builds is its centre.
 */
function padSnap(aBoard: Board, aWhere: Vec2, aLayer?: string): BoardCursorSnap | null {
  for (const fp of aBoard.footprints) {
    for (const pad of fp.pads) {
      if (aLayer && !pad.layers.some((l) => layerMatches(l, aLayer))) continue;

      if (
        Math.hypot(aWhere.x - pad.at.x, aWhere.y - pad.at.y) <=
        Math.max(pad.size.x, pad.size.y) / 2
      )
        return { net: pad.net ?? 0, snap: { ...pad.at }, kind: 'pad' };
    }
  }

  return null;
}

/** `LSET` membership for the wildcard layer names a pad carries (`*.Cu`). */
function layerMatches(aItemLayer: string, aLayer: string): boolean {
  if (aItemLayer === aLayer) return true;

  return aItemLayer.startsWith('*.') && aLayer.endsWith(aItemLayer.slice(1));
}

/**
 * The routing cursor over copper, or null when there is none under it — in
 * which case the caller aligns to the grid, exactly as `updateEndItem`'s else
 * branch does.
 */
export function snapToBoardCopper(
  aBoard: Board,
  aWhere: Vec2,
  aGrid: PcbGridState,
  aOpts: BoardSnapOptions,
): BoardCursorSnap | null {
  // `pickSingleItem`'s slot ordering: everything on the active layer first,
  // and only then the same search with the layer preference dropped.
  if (aOpts.layer) {
    const onLayer = pickOnLayer(aBoard, aWhere, aGrid, aOpts, aOpts.layer);

    if (onLayer) return onLayer;
  }

  return pickOnLayer(aBoard, aWhere, aGrid, aOpts, undefined);
}

function pickOnLayer(
  aBoard: Board,
  aWhere: Vec2,
  aGrid: PcbGridState,
  aOpts: BoardSnapOptions,
  aLayer: string | undefined,
): BoardCursorSnap | null {
  const pad = padSnap(aBoard, aWhere, aLayer);

  if (pad) return pad;

  for (const id of boardHitCandidates(aBoard, aWhere, aOpts.tol)) {
    const r = parseBoardItemId(id);

    if (r?.kind === 'via') {
      const v = aBoard.vias[r.index];

      // A via spans layers, so the active layer never excludes it.
      if (v) return { net: v.net, snap: { ...v.at }, kind: 'via' };

      continue;
    }

    if (r?.kind !== 'track' && r?.kind !== 'arc') continue;

    const t = r.kind === 'track' ? aBoard.tracks[r.index] : aBoard.arcs[r.index];

    if (!t) continue;

    // `pickSingleItem` only takes an item whose layers overlap the one asked
    // for. Without this a track on the far side of the board pulls the cursor
    // off the one actually under it.
    if (aLayer && t.layer !== aLayer) continue;

    // `snapToItem`, SEGMENT_T / ARC_T (pns_tool_base.cpp:480-505): an end wins
    // only within *half the track width* of the cursor — not within a screen
    // tolerance — and everywhere else the cursor rides the centreline.
    const wSq = Math.trunc(t.width / 2) ** 2;
    const distASq = (aWhere.x - t.start.x) ** 2 + (aWhere.y - t.start.y) ** 2;
    const distBSq = (aWhere.x - t.end.x) ** 2 + (aWhere.y - t.end.y) ** 2;

    if (distASq < wSq || distBSq < wSq) {
      return {
        net: t.net,
        snap: { ...(distASq < distBSq ? t.start : t.end) },
        kind: r.kind,
      };
    }

    const curved = r.kind === 'arc' ? aBoard.arcs[r.index] : null;

    if (curved) {
      const arc = gridArcFromPoints(curved.start, curved.mid, curved.end);

      if (arc) return { net: t.net, snap: alignToArc(aWhere, arc, aGrid), kind: 'arc' };
    }

    return {
      net: t.net,
      snap: alignToSegment(aWhere, { a: t.start, b: t.end }, aGrid),
      kind: r.kind,
    };
  }

  return null;
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

/** `GRID_HELPER::ANCHOR_FLAGS` (`grid_helper.h:150-164`), the ones used here. */
export const ANCHOR_CORNER = 1;
export const ANCHOR_OUTLINE = 2;
export const ANCHOR_SNAPPABLE = 4;
export const ANCHOR_ORIGIN = 8;

export interface SnapAnchor {
  pos: Vec2;
  flags: number;
}

/** `MAGNETIC_OPTIONS` (`pcbnew_settings.h:53-58`). */
export enum MagneticOption {
  NO_EFFECT = 0,
  CAPTURE_CURSOR_IN_TRACK_TOOL = 1,
  CAPTURE_ALWAYS = 2,
}

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
  magneticPads?: MagneticOption;
  magneticTracks?: MagneticOption;
  /** `MAGNETIC_SETTINGS::allLayers`, which defeats the layer filter. */
  allLayers?: boolean;
}

const sqDist = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * `computeAnchors` over the board's copper.
 *
 * Ported: pads (`handlePadShape`'s centre), vias, tracks and arcs — the items
 * whose anchors decide where a track or a via can be dropped. Not yet ported:
 * graphics, zones, dimensions, text and the construction-geometry
 * intersections, all of which add anchors upstream and none of which change
 * where copper lands.
 */
export function computeCopperAnchors(
  aBoard: Board,
  aWhere: Vec2,
  aRange: number,
  aOpts: BestSnapOptions,
): SnapAnchor[] {
  const anchors: SnapAnchor[] = [];
  const pads = aOpts.magneticPads ?? MagneticOption.CAPTURE_ALWAYS;
  const tracks = aOpts.magneticTracks ?? MagneticOption.CAPTURE_ALWAYS;

  // `queryVisible`'s horizon: upstream builds a box of `snapRange` about the
  // cursor and asks the view for what is inside it.
  const inRange = (p: Vec2): boolean =>
    Math.abs(p.x - aWhere.x) <= aRange && Math.abs(p.y - aWhere.y) <= aRange;

  const onLayer = (itemLayer: string): boolean =>
    !!aOpts.allLayers || !aOpts.layer || layerMatches(itemLayer, aOpts.layer);

  if (pads === MagneticOption.CAPTURE_ALWAYS) {
    for (const fp of aBoard.footprints) {
      for (const pad of fp.pads) {
        if (!pad.layers.some(onLayer)) continue;

        // `handlePadShape`: the pad's own position is its origin anchor.
        if (inRange(pad.at)) anchors.push({ pos: pad.at, flags: ANCHOR_ORIGIN | ANCHOR_SNAPPABLE });
      }
    }
  }

  if (tracks === MagneticOption.CAPTURE_ALWAYS) {
    for (const v of aBoard.vias) {
      // A via spans layers, so the layer filter never excludes one.
      if (inRange(v.at))
        anchors.push({ pos: v.at, flags: ANCHOR_ORIGIN | ANCHOR_CORNER | ANCHOR_SNAPPABLE });
    }

    for (const t of [...aBoard.tracks, ...aBoard.arcs]) {
      if (!onLayer(t.layer)) continue;

      for (const end of [t.start, t.end]) {
        if (inRange(end)) anchors.push({ pos: end, flags: ANCHOR_CORNER | ANCHOR_SNAPPABLE });
      }

      // `track->GetCenter()`, added as ORIGIN and *not* SNAPPABLE — see the
      // block comment above. It is here because it is upstream, and because
      // leaving it out would make the omission look accidental.
      const mid = { x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 };

      if (inRange(mid)) anchors.push({ pos: mid, flags: ANCHOR_ORIGIN });
    }
  }

  return anchors;
}

/** `GRID_HELPER::nearestAnchor( aPos, aFlags )` — nearest anchor carrying every flag. */
export function nearestAnchor(
  aAnchors: readonly SnapAnchor[],
  aPos: Vec2,
  aFlags: number,
): SnapAnchor | null {
  let best: SnapAnchor | null = null;
  let minDist = Number.MAX_SAFE_INTEGER;

  for (const anchor of aAnchors) {
    if ((aFlags & anchor.flags) !== aFlags) continue;

    const d = sqDist(anchor.pos, aPos);

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
export function bestSnapAnchor(
  aBoard: Board,
  aWhere: Vec2,
  aGrid: PcbGridState,
  aOpts: BestSnapOptions,
): Vec2 {
  // Snapping distance is in screen space, clamped to the current grid so that
  // the grid points that are visible can always be snapped to (cpp:604-615).
  const snapRange = Math.round(
    aGrid.enableGrid ? Math.min(aOpts.snapScale, aOpts.visibleGrid) : aOpts.snapScale,
  );

  const nearestGrid = align(aWhere, aGrid);

  if (!aGrid.enableSnap) return nearestGrid;

  const anchors = computeCopperAnchors(aBoard, aWhere, snapRange, aOpts);
  const nearest = nearestAnchor(anchors, aWhere, ANCHOR_SNAPPABLE);
  const snapIn = Math.max(0, snapRange - (aOpts.hysteresis ?? 0));

  if (nearest && Math.hypot(nearest.pos.x - aWhere.x, nearest.pos.y - aWhere.y) <= snapIn)
    return { ...nearest.pos };

  // "If we're snapping to a grid, on-element snaps would be too intrusive but
  // they're useful when there isn't a grid to snap to" (cpp:896-917). This is
  // the one path outside the router that puts the cursor on a track's
  // centreline rather than at one of its ends.
  if (!aGrid.enableGrid) {
    let best: Vec2 | null = null;
    let bestDist = Number.MAX_SAFE_INTEGER;

    for (const t of [...aBoard.tracks, ...aBoard.arcs]) {
      if (!aOpts.allLayers && aOpts.layer && !layerMatches(t.layer, aOpts.layer)) continue;

      const p = segNearestPointToPoint({ a: t.start, b: t.end }, aWhere);
      const d = sqDist(p, aWhere);

      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }

    if (best && Math.hypot(best.x - aWhere.x, best.y - aWhere.y) <= snapRange) return best;
  }

  return nearestGrid;
}
