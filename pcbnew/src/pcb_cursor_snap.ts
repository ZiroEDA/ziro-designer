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

import type { Board, PcbBarcode } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { boardHitCandidates, parseBoardItemId } from './edit-board.js';
import { footprintBBox, padBBox } from './edit-footprint.js';
import { barcodeGeometry } from './barcode_geometry.js';
import { rotatePcb } from './read-board.js';
import { segNearestPoint } from '@ziroeda/kimath/src/geometry/seg.js';
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
        return { net: t.net, snap: alignToArc(aWhere, arc, aGrid), kind: 'arc', width: t.width };
    }

    return {
      net: t.net,
      snap: alignToSegment(aWhere, { a: t.start, b: t.end }, aGrid),
      kind: r.kind,
      width: t.width,
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

const sqDist = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

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

  const skipped = (kind: string, index: number): boolean =>
    aOpts.avoid?.has(`${kind}:${index}`) ?? false;

  if (pads === MagneticOption.CAPTURE_ALWAYS) {
    for (const [fpIndex, fp] of aBoard.footprints.entries()) {
      if (skipped('footprint', fpIndex)) continue;

      for (const pad of fp.pads) {
        if (!pad.layers.some(onLayer)) continue;

        // `handlePadShape`: the pad's own position is its origin anchor.
        if (inRange(pad.at)) anchors.push({ pos: pad.at, flags: ANCHOR_ORIGIN | ANCHOR_SNAPPABLE });
      }
    }
  }

  if (tracks === MagneticOption.CAPTURE_ALWAYS) {
    for (const [i, v] of aBoard.vias.entries()) {
      if (skipped('via', i)) continue;

      // A via spans layers, so the layer filter never excludes one.
      if (inRange(v.at))
        anchors.push({ pos: v.at, flags: ANCHOR_ORIGIN | ANCHOR_CORNER | ANCHOR_SNAPPABLE });
    }

    const wires: { kind: string; index: number; t: (typeof aBoard.tracks)[number] }[] = [
      ...aBoard.tracks.map((t, index) => ({ kind: 'track', index, t })),
      ...aBoard.arcs.map((a, index) => ({ kind: 'arc', index, t: a })),
    ];

    for (const { kind, index, t } of wires) {
      if (skipped(kind, index)) continue;

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
      if (inRange(pt.at)) anchors.push({ pos: pt.at, flags: ANCHOR_ORIGIN | ANCHOR_SNAPPABLE });
    }

    for (const [fpIndex, fp] of aBoard.footprints.entries()) {
      if (skipped('footprint', fpIndex)) continue;

      for (const pt of fp.points) {
        if (!onLayer(pt.layer)) continue;
        if (inRange(pt.at)) anchors.push({ pos: pt.at, flags: ANCHOR_ORIGIN | ANCHOR_SNAPPABLE });
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
      if (!inRange(bc.at)) continue;

      // `addAnchor( aItem->GetPosition(), ORIGIN, barcode, PT_CENTER )`.
      anchors.push({ pos: bc.at, flags: ANCHOR_ORIGIN });

      for (const p of barcodeSnapPoints(bc))
        if (inRange(p)) anchors.push({ pos: p, flags: ANCHOR_CORNER | ANCHOR_SNAPPABLE });
    }
  }

  return anchors;
}

/**
 * `addRectPoints( barcode->GetSymbolPoly().BBox(), … )`
 * (`pcb_grid_helper.cpp:1479-1502`): the box's centre, its four corners and
 * the midpoint of each of its four edges.
 *
 * The box is the *symbol's*, taken before the rotation is applied to `m_poly`,
 * so the nine points turn with the barcode rather than boxing it upright.
 */
function barcodeSnapPoints(bc: PcbBarcode): Vec2[] {
  const g = barcodeGeometry(bc);
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

const symbolPolyBox = (poly: readonly (readonly (readonly Vec2[])[])[]): {
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
 * anchors were collected. Ours mirrors that split, and eeschema's same-named
 * function in eeschema/src/tools/snap.ts is deliberately not this one.
 */
export function nearestAnchor(
  aAnchors: readonly SnapAnchor[],
  aPos: Vec2,
  aFlags: number,
): SnapAnchor | null {
  let best: SnapAnchor | null = null;
  // Upstream's is `std::numeric_limits<double>::max()`. `MAX_SAFE_INTEGER` is
  // not the same seed here: these are *squared* distances in internal units, so
  // it silently rejects every anchor further than ~95 mm from the cursor. That
  // never showed while the only caller pre-filtered its anchors by a screen
  // radius; `bestDragOrigin` does not, because a grabbed selection must always
  // yield a reference point however far away it is.
  let minDist = Number.POSITIVE_INFINITY;

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

      const p = segNearestPoint({ a: t.start, b: t.end }, aWhere);
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
export function computeDragAnchors(
  aBoard: Board,
  aItems: Iterable<string>,
  aWhere: Vec2,
  aOpts: DragOriginOptions,
): SnapAnchor[] {
  const anchors: SnapAnchor[] = [];
  // `VECTOR2I grid( GetGrid() ); … > grid.SquaredEuclideanNorm()`, and a GAL
  // grid is square here, so the threshold is both axes together.
  const gridSq = 2 * aOpts.gridSize * aOpts.gridSize;

  const pad = (p: { at: Vec2 }): void => {
    anchors.push({ pos: p.at, flags: ANCHOR_ORIGIN | ANCHOR_SNAPPABLE });
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

        anchors.push({ pos: fp.at, flags: ANCHOR_ORIGIN | ANCHOR_SNAPPABLE });

        // `footprint->GetBoundingBox( false )` — the box without the text, so a
        // long reference cannot drag the centre off the part.
        const bb = footprintBBox(fp, false);
        if (bb) {
          const centre = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
          if (sqDist(centre, fp.at) > gridSq)
            anchors.push({ pos: centre, flags: ANCHOR_ORIGIN | ANCHOR_SNAPPABLE });
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
        if (v) anchors.push({ pos: v.at, flags: ANCHOR_ORIGIN | ANCHOR_CORNER | ANCHOR_SNAPPABLE });
        break;
      }

      case 'track': {
        const t = aBoard.tracks[ref.index];
        if (!t) break;
        anchors.push({ pos: t.start, flags: ANCHOR_CORNER | ANCHOR_SNAPPABLE });
        anchors.push({ pos: t.end, flags: ANCHOR_CORNER | ANCHOR_SNAPPABLE });
        anchors.push({
          pos: { x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 },
          flags: ANCHOR_ORIGIN,
        });
        break;
      }

      case 'arc': {
        const a = aBoard.arcs[ref.index];
        if (!a) break;
        anchors.push({ pos: a.start, flags: ANCHOR_CORNER | ANCHOR_SNAPPABLE });
        anchors.push({ pos: a.end, flags: ANCHOR_CORNER | ANCHOR_SNAPPABLE });
        // The stored midpoint, which is grid-aligned when the arc is. The
        // derived centre is deliberately *not* offered as the arc's own origin.
        anchors.push({ pos: a.mid, flags: ANCHOR_CORNER | ANCHOR_SNAPPABLE });
        break;
      }

      default:
        break;
    }
  }

  return anchors;
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
export function bestDragOrigin(
  aBoard: Board,
  aItems: Iterable<string>,
  aWhere: Vec2,
  aOpts: DragOriginOptions,
): Vec2 {
  const anchors = computeDragAnchors(aBoard, aItems, aWhere, aOpts);

  const nearestOutline = nearestAnchor(anchors, aWhere, ANCHOR_OUTLINE);
  const nearestCorner = nearestAnchor(anchors, aWhere, ANCHOR_CORNER);
  const nearestOrigin = nearestAnchor(anchors, aWhere, ANCHOR_ORIGIN);

  let best: SnapAnchor | null = null;
  let minDist = Number.MAX_VALUE;

  if (nearestOrigin) {
    minDist = Math.sqrt(sqDist(nearestOrigin.pos, aWhere));
    best = nearestOrigin;
  }

  if (nearestCorner) {
    const d = Math.sqrt(sqDist(nearestCorner.pos, aWhere));
    if (d < minDist) {
      minDist = d;
      best = nearestCorner;
    }
  }

  if (nearestOutline) {
    const d = Math.sqrt(sqDist(nearestOutline.pos, aWhere));
    if (minDist > (aOpts.lineSnapMinCornerDistance ?? 0) && d < minDist) best = nearestOutline;
  }

  return best ? { x: best.pos.x, y: best.pos.y } : { x: aWhere.x, y: aWhere.y };
}
