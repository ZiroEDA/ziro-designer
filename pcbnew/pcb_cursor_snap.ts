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
import type { ANCHOR } from '@ziroeda/common/tool/grid_helper.js';
import {
  gridArcFromPoints,
  layerMatches,
  PCB_GRID_HELPER,
  type BestSnapOptions,
  type DragOriginOptions,
  type PcbGridState,
} from './tools/pcb_grid_helper.js';

/** What the cursor found: the net to route, and the point to route from. */
export interface BoardCursorSnap {
  net: number;
  snap: Vec2;
  /** Which kind of item won, for callers that highlight it. */
  kind: 'pad' | 'via' | 'track' | 'arc';
  /**
   * The item's own width, for a track or an arc — `PNS::SEGMENT::Width()` /
   * `PNS::ARC::Width()`, which is `inheritTrackWidth`'s first and commonest
   * branch (pns_kicad_iface.cpp:989-1006). Absent for a pad or a via, which
   * have no width of their own and send that function to the joint instead.
   */
  width?: number;
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
  /**
   * `pickSingleItem`'s `aAvoidItems`, as board item ids.
   *
   * `updateEndItem` passes `{ m_startItem }` so a drag cannot snap to the very
   * item it is dragging. Without it the cursor latches onto the moving line and
   * the drag locks onto itself.
   */
  avoid?: ReadonlySet<string>;
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

/**
 * The routing cursor over copper, or null when there is none under it — in
 * which case the caller aligns to the grid, exactly as `updateEndItem`'s else
 * branch does.
 */
export function snapToBoardCopper(
  aBoard: Board,
  aWhere: Vec2,
  aGrid: PCB_GRID_HELPER | PcbGridState,
  aOpts: BoardSnapOptions,
): BoardCursorSnap | null {
  // The router tool's own `m_gridHelper` when the caller holds one, as the
  // editor does; a bare state gets a helper for the one call.
  const grid = aGrid instanceof PCB_GRID_HELPER ? aGrid : new PCB_GRID_HELPER(aGrid);

  // `pickSingleItem`'s slot ordering: everything on the active layer first,
  // and only then the same search with the layer preference dropped.
  if (aOpts.layer) {
    const onLayer = pickOnLayer(aBoard, aWhere, grid, aOpts, aOpts.layer);

    if (onLayer) return onLayer;
  }

  return pickOnLayer(aBoard, aWhere, grid, aOpts, undefined);
}

function pickOnLayer(
  aBoard: Board,
  aWhere: Vec2,
  aGrid: PCB_GRID_HELPER,
  aOpts: BoardSnapOptions,
  aLayer: string | undefined,
): BoardCursorSnap | null {
  const pad = padSnap(aBoard, aWhere, aLayer);

  if (pad) return pad;

  for (const id of boardHitCandidates(aBoard, aWhere, aOpts.tol)) {
    if (aOpts.avoid?.has(id)) continue;

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
        width: t.width,
      };
    }

    const curved = r.kind === 'arc' ? aBoard.arcs[r.index] : null;

    if (curved) {
      const arc = gridArcFromPoints(curved.start, curved.mid, curved.end);

      if (arc)
        return { net: t.net, snap: aGrid.AlignToArc(aWhere, arc), kind: 'arc', width: t.width };
    }

    return {
      net: t.net,
      snap: aGrid.AlignToSegment(aWhere, { a: t.start, b: t.end }),
      kind: r.kind,
      width: t.width,
    };
  }

  return null;
}

/**
 * `PCB_GRID_HELPER::BestSnapAnchor` for one event's grid state — the cursor
 * for every tool that is not the router. See the method.
 */
export function bestSnapAnchor(
  aBoard: Board,
  aWhere: Vec2,
  aGrid: PcbGridState,
  aOpts: BestSnapOptions,
): Vec2 {
  return new PCB_GRID_HELPER(aGrid).BestSnapAnchor(aBoard, aWhere, aOpts);
}

/**
 * `PCB_GRID_HELPER::computeAnchors( aItems, aRefPos, aFrom = true )` over the
 * selection, as board item ids — the anchors {@link bestDragOrigin} weighs.
 */
export function computeDragAnchors(
  aBoard: Board,
  aItems: Iterable<string>,
  aWhere: Vec2,
  aOpts: DragOriginOptions,
): readonly ANCHOR[] {
  const helper = new PCB_GRID_HELPER();

  helper.computeDragAnchors(aBoard, aItems, aWhere, aOpts);

  return helper.GetAnchors();
}

/**
 * `PCB_GRID_HELPER::BestDragOrigin` — the point a move measures itself from.
 * It reads no grid state: the grid only enters through `aOpts.gridSize`.
 */
export function bestDragOrigin(
  aBoard: Board,
  aItems: Iterable<string>,
  aWhere: Vec2,
  aOpts: DragOriginOptions,
): Vec2 {
  return new PCB_GRID_HELPER().BestDragOrigin(aBoard, aItems, aWhere, aOpts);
}
