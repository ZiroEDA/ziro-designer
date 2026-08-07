// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::TOOL_BASE` — `pcbnew/router/pns_tool_base.{h,cpp}`, the router-state
 * half.
 *
 * `TOOL_BASE` is a `PCB_TOOL_BASE` subclass and most of it is wxWidgets event
 * plumbing: constructing `PNS_KICAD_IFACE` and `PCB_GRID_HELPER`, reading
 * `TOOL_EVENT` modifiers, forcing the cursor position, poking
 * `RENDER_SETTINGS` to highlight nets. None of that belongs in this engine.
 *
 * Three methods are not plumbing but routing decisions, and those are here:
 *
 * - {@link pickSingleItem} (cpp:111-250) — which of the items under the cursor
 *   the router should latch onto. A five-slot priority table, two search radii,
 *   and a fistful of net/layer/visibility rules. This is the function that
 *   decides whether clicking near a pad starts a route from the pad or from the
 *   track next to it.
 * - {@link checkSnap} (cpp:296-329) — whether a picked item is eligible to snap
 *   to, given the magnetic-items settings and whether it is part of the line
 *   currently being dragged.
 * - {@link snapToItem} (cpp:445-515) — where on the item to snap.
 *
 * Deliberately not ported: the ctor/dtor, `Reset` (they own the iface, the
 * router and the grid helper), `highlightNets`, `updateStartItem`,
 * `updateEndItem`, and the two trivial accessors. All are wx-side.
 *
 * The wx dependencies the three ported methods do have — `PCB_GRID_HELPER`,
 * the view's top layer, the high-contrast display option, the magnetic
 * settings — become small explicit inputs rather than a frame pointer.
 *
 * See `/var/tmp/ziro-router-specs/pns_router_impl.md` §20.
 */

import { PnsKind } from './pns_item.js';
import { PnsLinkedItem } from './pns_item.js';
import { PnsDragger } from './pns_dragger.js';
import { PnsMode } from './pns_routing_settings.js';
import { PnsRouterState } from './pns_router.js';
import { shapeBBox, shapeDist } from '../drc/drc_geometry.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsItem } from './pns_item.js';
import type { PnsRouter, PnsRouterIface } from './pns_router.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsSolid } from './pns_solid.js';
import type { PnsVia } from './pns_via.js';
import type { Seg } from './pns_line.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `TOOL_BASE::COORDS_PADDING` — `pcbIUScale.mmToIU( 20 )`, i.e. 20 mm in
 * internal units (nm). Used by `updateStartItem`/`updateEndItem`, which are not
 * ported; kept because it is the one constant the header exports and callers
 * clamping cursor coordinates need the same number.
 */
export const PNS_COORDS_PADDING = 20_000_000;

/** `GRID_HELPER_GRIDS` (`include/tool/grid_helper.h:39`), the two values used here. */
export enum PnsGridHelperGrid {
  GRID_CURRENT = 0,
  GRID_CONNECTABLE = 1,
  GRID_WIRES = 2,
  GRID_VIAS = 3,
  GRID_TEXT = 4,
  GRID_GRAPHICS = 5,
}

/** `MAGNETIC_OPTIONS` — `pcbnew/pcbnew_settings.h:53-58`. */
export enum PnsMagneticOption {
  NO_EFFECT = 0,
  CAPTURE_CURSOR_IN_TRACK_TOOL = 1,
  CAPTURE_ALWAYS = 2,
}

/** The two `MAGNETIC_SETTINGS` fields `checkSnap` reads. */
export interface PnsMagneticSettings {
  pads: PnsMagneticOption;
  tracks: PnsMagneticOption;
}

/**
 * `PCB_GRID_HELPER`, reduced to the three calls `snapToItem` makes.
 *
 * The real thing is a tool-manager-bound object that collects snap anchors from
 * the whole board; none of that is engine logic. What the router actually asks
 * of it is "put this point on the grid", "put it on this segment" and "put it
 * on this arc".
 */
export interface PnsSnapGridHelper {
  /** `Align( const VECTOR2I&, GRID_HELPER_GRIDS )`. */
  align(aP: Vec2, aGrid: PnsGridHelperGrid): Vec2;
  /** `AlignToSegment( const VECTOR2I&, const SEG& )`. */
  alignToSegment(aP: Vec2, aSeg: Seg): Vec2;
  /** `AlignToArc( const VECTOR2I&, const SHAPE_ARC& )`. */
  alignToArc(aP: Vec2, aArc: Shape): Vec2;
}

/**
 * The wx-side inputs {@link pickSingleItem} reads off the frame and view.
 */
export interface PnsPickContext {
  router: PnsRouter;
  iface: PnsRouterIface;
  /**
   * `GetPNSLayerFromBoardLayer( getView()->GetTopLayer() )` — the active layer,
   * already converted to a PNS layer index.
   */
  topLayer: number;
  /**
   * `max( m_gridHelper->GetGrid().x, m_gridHelper->GetGrid().y )` — the second
   * and wider of the two search radii.
   */
  maxSlopRadius: number;
  /**
   * `frame()->GetDisplayOptions().m_ContrastModeDisplay != HIGH_CONTRAST_MODE::NORMAL`.
   */
  highContrast: boolean;
}

/** `SEG::ecoord`'s maximum, the "nothing found yet" distance. */
const ECOORD_MAX = Number.MAX_SAFE_INTEGER;

/** `VECTOR2I::SquaredEuclideanNorm()` of `a - b`. */
const squaredDist = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return dx * dx + dy * dy;
};

/** `SEG::Square( a )`. */
const square = (a: number): number => a * a;

/** A zero-radius circle, which is how this tree spells "a point as a shape". */
const pointShape = (aPoint: Vec2): Shape => ({ kind: 'circle', c: aPoint, r: 0 });

/**
 * `SHAPE_BASE::Centre()`, which is `BBox( 0 ).Centre()` for every shape the
 * router sees. `SHAPE_CIRCLE` overrides it to return the circle centre, which
 * is the same point.
 */
function shapeCentre(aShape: Shape): Vec2 {
  const bb = shapeBBox(aShape);

  // BOX2I::Centre() is `GetOrigin() + GetSize() / 2` in integer arithmetic, so
  // it truncates toward the origin on an odd extent.
  return {
    x: bb.minX + Math.trunc((bb.maxX - bb.minX) / 2),
    y: bb.minY + Math.trunc((bb.maxY - bb.minY) / 2),
  };
}

/** `SHAPE::Collide( const VECTOR2I& aP )` with the default zero clearance. */
const shapeCollidesPoint = (aShape: Shape, aP: Vec2): boolean =>
  shapeDist(aShape, pointShape(aP)) <= 0;

/**
 * `TOOL_BASE::pickSingleItem( aWhere, aNet, aLayer, aIgnorePads, aAvoidItems )`
 * — pns_tool_base.cpp:111-250.
 *
 * Picks the one item under the cursor the router should anchor to. Five
 * priority slots, filled by two passes at widening radii:
 *
 * | slot | what lands in it |
 * |------|------------------|
 * | 0 | a via or pad **on the active layer**, nearest centre; also any free pad the cursor is inside |
 * | 1 | a segment or arc **on the active layer**, nearest end |
 * | 2 | a via or pad on any layer, nearest centre |
 * | 3 | a segment or arc on any layer, nearest end |
 * | 4 | an unconnected item, in `RM_MarkObstacles` mode only |
 *
 * Slots are read back in order, so "a pad on this layer" beats "a track on this
 * layer" beats "a pad on another layer", and the mark-obstacles fallback is
 * only ever reached when nothing else matched at all.
 *
 * Three details that a rewrite would get wrong:
 *
 * - `tl` falls back to the view's top layer when `aLayer > 0` is false — note
 *   **`> 0`**, not `>= 0`, so an explicit request for PNS layer 0 (the front
 *   copper layer) is treated as "no preference". Upstream; pinned by a test.
 * - the centre distance for vias and pads is measured on `Shape( aLayer )`,
 *   the **caller's** layer argument, not `tl`. A `-1` there asks for the
 *   layer-agnostic shape.
 * - the `RM_MarkObstacles` fallback (slot 4) performs **no distance test at
 *   all**, so among several unconnected candidates the last one visited wins.
 *
 * The two passes stop as soon as any slot is filled, so the wide radius only
 * runs when an exact hit found nothing.
 */
export function pickSingleItem(
  aCtx: PnsPickContext,
  aWhere: Vec2,
  aNet: NetHandle = null,
  aLayer = -1,
  aIgnorePads = false,
  aAvoidItems: readonly PnsItem[] = [],
): PnsItem | null {
  const { router, iface } = aCtx;

  const tl = aLayer > 0 ? aLayer : aCtx.topLayer;

  const candidateCount = 5;
  const prioritized: (PnsItem | null)[] = new Array<PnsItem | null>(candidateCount).fill(null);
  const dist: number[] = new Array<number>(candidateCount).fill(ECOORD_MAX);

  const haveCandidates = (): boolean => prioritized.some((item) => item !== null);

  for (const slopRadius of [0, aCtx.maxSlopRadius]) {
    const candidates = router.queryHoverItems(aWhere, slopRadius);

    for (const item of candidates.items()) {
      if (!item.isRoutable()) continue;

      if (!iface.isPnsCopperLayer(item.layers().start())) continue;

      if (!iface.isAnyLayerVisible(item.layers())) continue;

      if (aAvoidItems.includes(item)) continue;

      // fixme: this causes flicker with live loop removal...
      // if( item->Parent() && !item->Parent()->ViewIsVisible() ) continue;

      if (item.ofKind(PnsKind.SOLID_T) && aIgnorePads) {
        // Upstream's shape is an if / else-if chain (pns_tool_base.cpp:163-218)
        // whose first arm is a bare `continue`. Dropping it leaves an empty
        // block; flattening the chain reorders order-dependent guards.
        // biome-ignore lint/complexity/noUselessContinue: mirrors the C++ chain
        continue;
      } else if (iface.getNetCode(aNet) <= 0 || item.net() === aNet) {
        if (item.ofKind(PnsKind.VIA_T | PnsKind.SOLID_T)) {
          const shape = item.shape(aLayer);
          // Upstream dereferences Shape( aLayer ) unguarded; an item that has
          // no shape on that layer is skipped here rather than crashing.
          if (!shape) continue;

          const d = squaredDist(shapeCentre(shape), aWhere);

          if (d < dist[2]!) {
            prioritized[2] = item;
            dist[2] = d;
          }

          if (item.layers().overlaps(tl) && d < dist[0]!) {
            prioritized[0] = item;
            dist[0] = d;
          }
        } else {
          // ITEM::SEGMENT_T | ITEM::ARC_T
          const li = item as PnsLinkedItem;
          const d = Math.min(squaredDist(li.anchor(0), aWhere), squaredDist(li.anchor(1), aWhere));

          if (d < dist[3]!) {
            prioritized[3] = item;
            dist[3] = d;
          }

          if (item.layers().overlaps(tl) && d < dist[1]!) {
            prioritized[1] = item;
            dist[1] = d;
          }
        }
      } else if (item.ofKind(PnsKind.SOLID_T) && item.isFreePad()) {
        // Allow free pads only when already inside pad
        const shape = item.shape(-1);

        if (shape && shapeCollidesPoint(shape, aWhere)) {
          prioritized[0] = item;
          dist[0] = 0;
        }
      } else if (item.net() === 0 && router.settings().routingMode === PnsMode.RM_MarkObstacles) {
        // Allow unconnected items as last resort in RM_MarkObstacles mode
        if (item.layers().overlaps(tl)) prioritized[4] = item;
      }
    }

    if (haveCandidates()) break;
  }

  let rv: PnsItem | null = null;

  for (const candidate of prioritized) {
    let item = candidate;

    if (aCtx.highContrast && item && !item.layers().overlaps(tl)) item = null;

    if (item && (aLayer < 0 || item.layers().overlaps(aLayer))) {
      rv = item;
      break;
    }
  }

  return rv;
}

/** The inputs {@link checkSnap} reads that are not on the router. */
export interface PnsSnapContext {
  router: PnsRouter;
  magnetic: PnsMagneticSettings;
  /** `m_startItem` — the item the current operation began on. */
  startItem: PnsItem | null;
}

/**
 * `TOOL_BASE::checkSnap( ITEM* )` — pns_tool_base.cpp:296-329.
 *
 * Two jobs in one function, which is upstream's shape: it **writes** the
 * magnetic-items settings into `ROUTING_SETTINGS` (so the engine's own
 * snap-to-pads/tracks flags track the PCB editor's options) and then answers
 * whether this particular item may be snapped to.
 *
 * The early exit is the interesting part: while dragging a segment, an item
 * that is part of the line being dragged is never snappable — otherwise the
 * line would snap to itself and the drag would lock up. Upstream expresses this
 * as a `dynamic_cast<DRAGGER*>` plus `GetOriginalLine().ContainsLink()`; here
 * the optional `getOriginalLine` on `PnsDragAlgo` is the same test, since only
 * a plain `DRAGGER` has one.
 *
 * Note the settings write happens **after** that early return, so a drag over
 * one's own line leaves the flags stale for that call. Upstream.
 */
export function checkSnap(aCtx: PnsSnapContext, aItem: PnsItem | null): boolean {
  // Sync PNS engine settings with the general PCB editor options.
  const pnss = aCtx.router.settings();

  // If we're dragging a track segment, don't try to snap to items that are part
  // of the original line.
  if (
    aCtx.startItem &&
    aItem &&
    aCtx.router.getState() === PnsRouterState.DRAG_SEGMENT &&
    aCtx.router.getDragger()
  ) {
    // `dynamic_cast<DRAGGER*>( m_router->GetDragger() )` — only the plain
    // dragger has an original line. `COMPONENT_DRAGGER` and `MULTI_DRAGGER`
    // fail the cast upstream and fall through to the settings write below, so
    // `instanceof` is the faithful test and NOT a structural check for the
    // method: `getOriginalLine` is declared on `DRAGGER` (pns_dragger.h:103),
    // not on `DRAG_ALGO`, and putting it on the base to avoid the cast would
    // widen an interface upstream deliberately kept narrow.
    const dragger = aCtx.router.getDragger();
    const linkedItem = aItem instanceof PnsLinkedItem ? aItem : null;

    if (dragger instanceof PnsDragger && linkedItem) {
      if (dragger.getOriginalLine().containsLink(linkedItem)) return false;
    }
  }

  const magSettings = aCtx.magnetic;

  pnss.snapToPads =
    magSettings.pads === PnsMagneticOption.CAPTURE_CURSOR_IN_TRACK_TOOL ||
    magSettings.pads === PnsMagneticOption.CAPTURE_ALWAYS;

  pnss.snapToTracks =
    magSettings.tracks === PnsMagneticOption.CAPTURE_CURSOR_IN_TRACK_TOOL ||
    magSettings.tracks === PnsMagneticOption.CAPTURE_ALWAYS;

  if (aItem) {
    if (aItem.ofKind(PnsKind.VIA_T | PnsKind.SEGMENT_T | PnsKind.ARC_T)) return pnss.snapToTracks;
    if (aItem.ofKind(PnsKind.SOLID_T)) return pnss.snapToPads;
  }

  return false;
}

/**
 * `TOOL_BASE::snapToItem( ITEM*, const VECTOR2I& )` — pns_tool_base.cpp:445-515.
 *
 * Where on a picked item the cursor lands. Anything unrecognised — and a null
 * or invisible item — falls through to a plain grid align, on the via grid when
 * a via is being placed and the wire grid otherwise.
 *
 * - a pad snaps to its nearest **anchor point** (custom pads carry several), or
 *   to `Anchor( 0 )` when it has no anchor list;
 * - a via snaps to its centre;
 * - a segment or arc snaps to whichever **end** is within half a track width of
 *   the cursor, and otherwise aligns along the segment or arc. The half-width
 *   is integer-halved before squaring (`SEG::Square( li->Width() / 2 )`), so an
 *   odd width rounds the snap radius down.
 *
 * Upstream's nearest-anchor scan seeds `anchor` with a default-constructed
 * `VECTOR2I`, i.e. the origin. That is only observable if every candidate is at
 * `ecoord` max distance, which cannot happen for a non-empty list, so the same
 * seed is used here without ceremony.
 */
export function snapToItem(
  aCtx: { router: PnsRouter; iface: PnsRouterIface; grid: PnsSnapGridHelper },
  aItem: PnsItem | null,
  aP: Vec2,
): Vec2 {
  const gridFor = (): PnsGridHelperGrid =>
    aCtx.router.isPlacingVia() ? PnsGridHelperGrid.GRID_VIAS : PnsGridHelperGrid.GRID_WIRES;

  if (!aItem || !aCtx.iface.isItemVisible(aItem)) return aCtx.grid.align(aP, gridFor());

  switch (aItem.kind()) {
    case PnsKind.SOLID_T: {
      const solid = aItem as PnsSolid;

      if (solid.anchorPoints().length === 0) return solid.anchor(0);

      let anchor: Vec2 = { x: 0, y: 0 };
      let minDist = ECOORD_MAX;

      for (const anchorCandidate of solid.anchorPoints()) {
        const distSq = squaredDist(aP, anchorCandidate);

        if (distSq < minDist) {
          minDist = distSq;
          anchor = anchorCandidate;
        }
      }

      return anchor;
    }

    case PnsKind.VIA_T:
      return (aItem as PnsVia).pos();

    case PnsKind.SEGMENT_T:
    case PnsKind.ARC_T: {
      const li = aItem as PnsLinkedItem;
      const A = li.anchor(0);
      const B = li.anchor(1);
      const wSq = square(Math.trunc(li.width() / 2));
      const distASq = squaredDist(aP, A);
      const distBSq = squaredDist(aP, B);

      if (distASq < wSq || distBSq < wSq) {
        return distASq < distBSq ? A : B;
      }

      if (aItem.kind() === PnsKind.SEGMENT_T) {
        // TODO(snh): Clean this up
        const seg = li as PnsSegment;

        return aCtx.grid.alignToSegment(aP, seg.seg());
      }

      if (aItem.kind() === PnsKind.ARC_T) {
        const shape = aItem.shape(-1);

        if (shape) return aCtx.grid.alignToArc(aP, shape);
      }

      break;
    }

    default:
      break;
  }

  return aCtx.grid.align(aP, gridFor());
}
