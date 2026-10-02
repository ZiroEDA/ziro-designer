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
 * The class itself, {@link PNS_TOOL_BASE}, is at the end: `Reset` builds the
 * interface, the router and the grid helper on the live BOARD, and
 * `updateStartItem` / `updateEndItem` / `highlightNets` are the event half the
 * three functions above serve.
 *
 * See `/var/tmp/ziro-router-specs/pns_router_impl.md` §20.
 */

import { PnsKind } from './pns_item.js';
import { PnsLinkedItem } from './pns_item.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { MD_CTRL, MD_SHIFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import { GetClampedCoords } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { BOARD } from '../board.js';
import { PCB_GRID_HELPER } from '../tools/pcb_grid_helper.js';
import { PCB_TOOL_BASE } from '../tools/pcb_tool_base.js';
import { pcbnewLiveSettings } from '../browser/pcbnew_live_settings.js';
import { PNS_KICAD_IFACE, PnsDesignSettingsFromBds } from './pns_kicad_iface.js';
import { PnsLinePlacer, type PnsRouterLike } from './pns_line_placer.js';
import { PnsDiffPairPlacer } from './pns_diff_pair_placer.js';
import { PnsShove, type PnsShoveSettings } from './pns_shove.js';
import { DEFAULT_ROUTER_SIZES, PnsRouter, type PnsRouterSizes } from './pns_router.js';
import type { PnsNode } from './pns_node.js';
import { readRoutingSettings, type RoutingSettings } from './pns_routing_settings.js';
import { PnsDragger } from './pns_dragger.js';
import { PnsComponentDragger } from './pns_component_dragger.js';
import { PnsMultiDragger } from './pns_multi_dragger.js';
import { makePnsRouterHost, type PnsRouterHost } from './pns_drag_algo.js';
import { PnsMode } from './pns_routing_settings.js';
import { PnsRouterState } from './pns_router.js';
import { shapeBBox, shapeDist } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import type { NetHandle } from './pns_item.js';
import type { PnsItem } from './pns_item.js';
import type { PnsRouterIface } from './pns_router.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsSolid } from './pns_solid.js';
import type { PnsVia } from './pns_via.js';
import type { Seg } from './pns_line.js';
import type { Shape } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { MAGNETIC_OPTIONS } from '../pcbnew_settings.js';

/**
 * `TOOL_BASE::COORDS_PADDING` — `pcbIUScale.mmToIU( 20 )`, i.e. 20 mm in
 * internal units (nm). Used by `updateStartItem`/`updateEndItem`, which are not
 * ported; kept because it is the one constant the header exports and callers
 * clamping cursor coordinates need the same number.
 */
export const PNS_COORDS_PADDING = 20_000_000;

/** The two `MAGNETIC_SETTINGS` fields `checkSnap` reads. */
export interface PnsMagneticSettings {
  pads: MAGNETIC_OPTIONS;
  tracks: MAGNETIC_OPTIONS;
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
    magSettings.pads === MAGNETIC_OPTIONS.CAPTURE_CURSOR_IN_TRACK_TOOL ||
    magSettings.pads === MAGNETIC_OPTIONS.CAPTURE_ALWAYS;

  pnss.snapToTracks =
    magSettings.tracks === MAGNETIC_OPTIONS.CAPTURE_CURSOR_IN_TRACK_TOOL ||
    magSettings.tracks === MAGNETIC_OPTIONS.CAPTURE_ALWAYS;

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
  aCtx: { router: PnsRouter; iface: PnsRouterIface; grid: PCB_GRID_HELPER },
  aItem: PnsItem | null,
  aP: Vec2,
): Vec2 {
  const gridFor = (): GRID_HELPER_GRIDS =>
    aCtx.router.isPlacingVia() ? GRID_HELPER_GRIDS.GRID_VIAS : GRID_HELPER_GRIDS.GRID_WIRES;

  if (!aItem || !aCtx.iface.isItemVisible(aItem)) return aCtx.grid.Align(aP, gridFor());

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

        return aCtx.grid.AlignToSegment(aP, seg.seg());
      }

      if (aItem.kind() === PnsKind.ARC_T) {
        const shape = aItem.shape(-1);

        // `AlignToArc( aP, *static_cast<const SHAPE_ARC*>( li->Shape( -1 ) ) )`:
        // an ARC_T's shape is always an arc upstream; anything else falls
        // through to the grid below.
        if (shape?.kind === 'arc') return aCtx.grid.AlignToArc(aP, shape);
      }

      break;
    }

    default:
      break;
  }

  return aCtx.grid.Align(aP, gridFor());
}

/**
 * `ROUTING_SETTINGS` as `SHOVE` reads it.
 *
 * `pns_shove.ts` declares its own settings type and says so: it was written
 * before `RoutingSettings` was ported and left the field names identical so the
 * bridge would be this and nothing more. Two of them are not straight copies —
 * `SMART_PADS` is only enabled in the 45° corner modes (`ROUTER_TOOL` gates it
 * the same way), and `cornerMode45` is that test rather than the mode itself.
 */
export function shoveSettingsFrom(aSettings: RoutingSettings): PnsShoveSettings {
  const cornerMode45 =
    aSettings.cornerMode === CornerMode.MITERED_45 ||
    aSettings.cornerMode === CornerMode.ROUNDED_45;

  return {
    shoveIterationLimit: aSettings.shoveIterationLimit,
    shoveTimeLimit: aSettings.shoveTimeLimit,
    shoveVias: aSettings.shoveVias,
    jumpOverObstacles: aSettings.jumpOverObstacles,
    walkaroundIterationLimit: aSettings.walkaroundIterationLimit,
    optimizerEffort: aSettings.optimizerEffort,
    smartPads: aSettings.smartPads,
    cornerMode45,
  };
}

/**
 * `new ROUTER` (pns_router.cpp:63-79), with the placers `ROUTER::SetMode` and
 * `StartRouting` build.
 *
 * Upstream's router news its placers itself; here they are a factory because
 * `PnsRouter` cannot import them without a cycle — `pns_shove.ts` reaches back
 * into the router's world. The shove reads the router's settings when it is
 * made, as upstream's reads `Settings()` when it runs, so a corner mode changed
 * mid-route reaches the next shove.
 */
export function newPnsRouter(): PnsRouter {
  return new PnsRouter({
    factory: {
      linePlacer: (r) => {
        const host: PnsRouterLike = {
          getInterface: () => r.getInterface() as never,
          getWorld: () => r.world(),
          settings: () => r.settings(),
          commitRouting: (aNode: PnsNode) => r.commitRouting(aNode),
          makeShove: (aWorld: PnsNode) => new PnsShove(aWorld, shoveSettingsFrom(r.settings())),
        };

        return new PnsLinePlacer(host) as never;
      },
      // `ROUTER::StartDragging`'s three `new …DRAGGER( this )`.
      dragger: (r) => new PnsDragger(draggerHost(r)),
      componentDragger: (r) => new PnsComponentDragger(draggerHost(r)),
      multiDragger: (r) => new PnsMultiDragger(draggerHost(r)),
      diffPairPlacer: (r) =>
        new PnsDiffPairPlacer({
          world: () => r.world(),
          settings: () => r.settings(),
          setFailureReason: (reason: string) => r.setFailureReason(reason),
          commitRouting: (aNode: PnsNode) => r.commitRouting(aNode),
        }) as never,
    },
  });
}

/** What a dragger asks its ROUTER for. */
function draggerHost(aRouter: PnsRouter): PnsRouterHost {
  return makePnsRouterHost({
    settings: () => aRouter.settings(),
    commitRouting: (aNode: PnsNode) => {
      aRouter.commitRouting(aNode);
    },
    setFailureReason: (aReason: string) => aRouter.setFailureReason(aReason),
  });
}

/** `SIZES_SETTINGS`' copy constructor: a value copy, its layer-pair map included. */
export function copySizes(aSizes: PnsRouterSizes): PnsRouterSizes {
  return { ...aSizes, layerPairs: new Map(aSizes.layerPairs ?? []) };
}

/**
 * `PNS::TOOL_BASE` — pns_tool_base.{h,cpp}: what `ROUTER_TOOL` and the length
 * tuner share. It owns the interface, the router and the grid helper, rebuilt
 * on every `Reset( RUN )`, and the start/end item and snap point the event
 * loops read.
 */
export abstract class PNS_TOOL_BASE extends PCB_TOOL_BASE {
  /** `COORDS_PADDING` — `pcbIUScale.mmToIU( 20 )`. */
  static readonly COORDS_PADDING = PNS_COORDS_PADDING;

  /** `m_savedSizes`: the sizes kept across a `Reset`. */
  protected m_savedSizes: PnsRouterSizes = copySizes(DEFAULT_ROUTER_SIZES);

  protected m_startItem: PnsItem | null = null;
  protected m_startSnapPoint: Vec2 = { x: 0, y: 0 };

  protected m_endItem: PnsItem | null = null;
  protected m_endSnapPoint: Vec2 = { x: 0, y: 0 };

  protected m_gridHelper: PCB_GRID_HELPER | null = null;
  protected m_iface: PNS_KICAD_IFACE | null = null;
  protected m_router: PnsRouter | null = null;
  protected m_cancelled = false;

  /** `m_startHighlightNetcodes`: the highlight to restore when routing ends. */
  private m_startHighlightNetcodes = new Set<number>();

  /** `TOOL_BASE::Reset` (pns_tool_base.cpp:72-107). */
  override Reset(aReason: RESET_REASON): void {
    // `delete m_router; delete m_iface;` — m_router first, as its NODE dtor
    // needs the interface's rule resolver.
    this.m_router?.dispose();
    this.m_iface?.Dispose();

    if (aReason === RESET_REASON.SHUTDOWN) {
      this.m_gridHelper = null;
      this.m_router = null;
      this.m_iface = null;
      return;
    }

    const frame = this.frame<PCB_BASE_FRAME>();
    const view = this.getView();

    // A frame resets its tools before a board is bound (`InitTools` runs from
    // `setupTools`). Upstream builds the router regardless and its `SyncWorld`
    // returns early on a null board (pns_kicad_iface.cpp, `if( !m_board )`);
    // this interface needs the board to exist, so the router waits for the
    // `Reset( RUN )` that comes with one.
    if (!this.getModel<BOARD>()) {
      this.m_router = null;
      this.m_iface = null;
      this.m_gridHelper = null;
      return;
    }

    // m_iface->SetBoard( board() ); SetView( getView() ); SetHostTool( this );
    this.m_iface = new PNS_KICAD_IFACE(this.board(), {
      isLayerVisible: view
        ? (aLayer: string) => view.IsLayerVisible(this.board().GetLayerID(aLayer))
        : undefined,
      designSettings: PnsDesignSettingsFromBds(this.board().GetDesignSettings()),
      view,
      trackClearanceMode: () => frame.GetPcbNewSettings().m_Display.m_TrackClearance,
      commitHost: this,
      enteredGroup: () => this.enteredGroup(),
    });

    this.m_router = newPnsRouter();
    this.m_router.setInterface(this.m_iface as unknown as PnsRouterIface);
    this.m_router.clearWorld();
    this.m_router.syncWorld();

    this.m_router.updateSizes(copySizes(this.m_savedSizes));

    this.m_router.loadSettings(this.routingSettings());

    this.m_gridHelper = new PCB_GRID_HELPER(
      this.m_toolMgr!,
      frame.GetMagneticItemsSettings() as never,
    );
  }

  /**
   * `PCBNEW_SETTINGS::m_PnsSettings`, made on first use as `Reset` makes it
   * upstream (`std::make_unique<ROUTING_SETTINGS>( settings, "tools.pns" )`:
   * the NESTED_SETTINGS loads itself from pcbnew.json's `tools.pns` block).
   * The router reads this same object, so a handler that only touches
   * settings works before any route has built a router.
   */
  protected routingSettings(): RoutingSettings {
    const settings = this.frame<PCB_BASE_FRAME>().GetPcbNewSettings();

    if (!settings.m_PnsSettings)
      settings.m_PnsSettings = readRoutingSettings(pcbnewLiveSettings().tools.pns);

    return settings.m_PnsSettings;
  }

  /** `PCB_SELECTION_TOOL::GetEnteredGroup()`, by name to keep the import graph acyclic. */
  private enteredGroup(): EDA_GROUP | null {
    const selTool = this.m_toolMgr?.FindTool('common.InteractiveSelection') as unknown as {
      GetEnteredGroup(): EDA_GROUP | null;
    } | null;

    return selTool?.GetEnteredGroup() ?? null;
  }

  /** `PCB_TOOL_BASE::controls()`: the view controls, as the C++ types them. */
  protected controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /** `Router()`. */
  Router(): PnsRouter | null {
    return this.m_router;
  }

  /** `GetInterface()`. */
  GetInterface(): PNS_KICAD_IFACE | null {
    return this.m_iface;
  }

  /** `TOOL_BASE::pickSingleItem` on this tool's router, view and grid. */
  protected pickSingleItem(
    aWhere: Vec2,
    aNet: NetHandle = null,
    aLayer = -1,
    aIgnorePads = false,
    aAvoidItems: readonly PnsItem[] = [],
  ): PnsItem | null {
    const grid = this.m_gridHelper!.GetGrid();
    const frame = this.frame<PCB_BASE_FRAME>();

    return pickSingleItem(
      {
        router: this.m_router!,
        iface: this.m_iface as unknown as PnsRouterIface,
        topLayer: this.m_iface!.GetPNSLayerFromBoardLayer(
          this.getView()!.GetTopLayer() as PCB_LAYER_ID,
        ),
        maxSlopRadius: Math.max(grid.x, grid.y),
        highContrast: frame.GetDisplayOptions().m_ContrastModeDisplay !== HIGH_CONTRAST_MODE.NORMAL,
      },
      aWhere,
      aNet,
      aLayer,
      aIgnorePads,
      aAvoidItems,
    );
  }

  /** `TOOL_BASE::checkSnap` with the frame's magnetic settings. */
  protected checkSnap(aItem: PnsItem | null): boolean {
    const mag = this.frame<PCB_BASE_FRAME>().GetMagneticItemsSettings();

    return checkSnap(
      {
        router: this.m_router!,
        magnetic: { pads: mag.pads, tracks: mag.tracks },
        startItem: this.m_startItem,
      },
      aItem,
    );
  }

  /** `TOOL_BASE::snapToItem`. */
  protected snapToItem(aItem: PnsItem | null, aP: Vec2): Vec2 {
    return snapToItem(
      {
        router: this.m_router!,
        iface: this.m_iface as unknown as PnsRouterIface,
        grid: this.m_gridHelper!,
      },
      aItem,
      aP,
    );
  }

  /** `TOOL_BASE::highlightNets` (pns_tool_base.cpp:253-293). */
  protected highlightNets(aEnabled: boolean, aNets: ReadonlySet<NetHandle> = new Set()): void {
    const view = this.getView();

    if (!view) return;

    const rs = view.GetPainter()!.GetSettings();
    const netcodes = new Set<number>();

    for (const net of aNets) netcodes.add(this.m_router!.getInterface()!.getNetCode(net));

    if (netcodes.size > 0 && aEnabled) {
      // If the user has previously set some of the routed nets to be highlighted,
      // we assume they want to keep them highlighted after routing
      const currentNetCodes = rs.GetHighlightNetCodes();
      let keep = false;

      for (const netcode of netcodes) {
        if (currentNetCodes.has(netcode)) {
          keep = true;
          break;
        }
      }

      if (rs.IsHighlightEnabled() && keep) this.m_startHighlightNetcodes = new Set(currentNetCodes);
      else this.m_startHighlightNetcodes.clear();

      rs.SetHighlight(netcodes, true);
    } else {
      rs.SetHighlight(this.m_startHighlightNetcodes, this.m_startHighlightNetcodes.size > 0);
    }

    // Do not remove this call.  This is required to update the layers when we highlight a net.
    // In this case, highlighting a net dims all other elements, so the colors need to update
    view.UpdateAllLayersColor();
  }

  /** `TOOL_BASE::updateStartItem` (pns_tool_base.cpp:332-364). */
  protected updateStartItem(aEvent: TOOL_EVENT, aIgnorePads = false): void {
    const tl = this.m_iface!.GetPNSLayerFromBoardLayer(
      this.getView()!.GetTopLayer() as PCB_LAYER_ID,
    );
    const gal = this.m_toolMgr!.GetView()!.GetGAL()!;
    const controls = this.controls();
    let pos = aEvent.HasPosition() ? aEvent.Position() : this.m_startSnapPoint;

    pos = GetClampedCoords(pos, PNS_COORDS_PADDING);

    if (aEvent.Modifier(MD_CTRL) && aEvent.Modifier(MD_SHIFT)) {
      this.m_startItem = null;
      this.m_startSnapPoint = controls.GetMousePosition();
      controls.ForceCursorPosition(true, this.m_startSnapPoint);
      return;
    }

    controls.ForceCursorPosition(false);
    this.m_gridHelper!.SetUseGrid(gal.GetGridSnapping() && !aEvent.DisableGridSnapping());
    this.m_gridHelper!.SetSnap(!aEvent.Modifier(MD_SHIFT));

    this.m_startItem = this.pickSingleItem(pos, null, -1, aIgnorePads);

    if (
      !this.m_gridHelper!.GetUseGrid() &&
      this.m_startItem &&
      !this.m_startItem.layers().overlaps(tl)
    )
      this.m_startItem = null;

    this.m_startSnapPoint = this.snapToItem(this.m_startItem, pos);
    controls.ForceCursorPosition(true, this.m_startSnapPoint);
  }

  /** `TOOL_BASE::updateEndItem` (pns_tool_base.cpp:367-430). */
  protected updateEndItem(aEvent: TOOL_EVENT): void {
    const gal = this.m_toolMgr!.GetView()!.GetGAL()!;
    const controls = this.controls();
    const router = this.m_router!;

    this.m_gridHelper!.SetUseGrid(gal.GetGridSnapping() && !aEvent.DisableGridSnapping());
    this.m_gridHelper!.SetSnap(!aEvent.Modifier(MD_SHIFT));

    controls.ForceCursorPosition(false);

    let mousePos = GetClampedCoords(controls.GetMousePosition(), PNS_COORDS_PADDING);

    if (router.getState() === PnsRouterState.ROUTE_TRACK && aEvent.IsDrag()) {
      // If the user is moving the mouse quickly while routing then clicks will come in as
      // short drags.  In this case we want to use the drag origin rather than the current
      // mouse position.
      mousePos = aEvent.DragOrigin();
    }

    const nets = router.getCurrentNets();

    if (
      router.settings().routingMode !== PnsMode.RM_MarkObstacles &&
      (nets.length === 0 || nets[0] == null)
    ) {
      this.m_endSnapPoint = this.snapToItem(null, mousePos);
      controls.ForceCursorPosition(true, this.m_endSnapPoint);
      this.m_endItem = null;

      return;
    }

    const layer = router.isPlacingVia() ? -1 : router.getCurrentLayer();

    let endItem: PnsItem | null = null;

    for (const net of nets) {
      endItem = this.pickSingleItem(
        mousePos,
        net,
        layer,
        false,
        this.m_startItem ? [this.m_startItem] : [],
      );

      if (endItem) break;
    }

    if (this.m_gridHelper!.GetSnap() && this.checkSnap(endItem)) {
      this.m_endItem = endItem;
      this.m_endSnapPoint = this.snapToItem(endItem, mousePos);
    } else {
      this.m_endItem = null;
      this.m_endSnapPoint = this.m_gridHelper!.Align(
        mousePos,
        router.isPlacingVia() ? GRID_HELPER_GRIDS.GRID_VIAS : GRID_HELPER_GRIDS.GRID_WIRES,
      );
    }

    controls.ForceCursorPosition(true, this.m_endSnapPoint);
  }
}
