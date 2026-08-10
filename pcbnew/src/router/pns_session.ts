// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One interactive routing session: `ROUTER_TOOL`, minus wxWidgets.
 *
 * Every part of KiCad's push-and-shove router is ported in this directory —
 * `PnsRouter`, `PnsLinePlacer`, `PnsShove`, `PnsWalkaround`, `PnsNode`,
 * `PnsBoardIface` and the rest — and each has a suite of its own. What did not
 * exist was the thing that *assembles* them, so nothing had ever driven the
 * line placer through the router over a real board. The editor's Route tool
 * used a hand-rolled substitute instead: a two-segment posture path and a
 * shortest-path walk around a set of hulls, which is a reasonable sketch of
 * routing and is not what pcbnew does.
 *
 * Assembling them found two seams that individually-correct pieces had hidden
 * from each other, both of which are fixed rather than worked around here:
 * `ROUTER` stores its sizes as a plain object while `LINE_PLACER` wanted the
 * `SIZES_SETTINGS` class (see `PnsSizesSettings.from`), and the placer asks its
 * router for a shove engine, which `PnsRouter` has no way to build without
 * importing `PnsShove` and closing a cycle. Composition belongs to the caller,
 * so it happens here.
 *
 * ### What this owns
 *
 * The board interface, the router, and the mapping between board layer names
 * and PNS layer indices. It deliberately does **not** own the cursor, the grid,
 * undo, or anything that draws: a session takes world points and hands back the
 * board changes the router decided on, so it can be tested without a canvas.
 *
 * ### The shape of a session
 *
 * `ROUTER_TOOL::MainLoop` in one paragraph: pick the item under the cursor,
 * `StartRouting`, then `Move` on every mouse move to re-run the placer against
 * the live world, `FixRoute` on a click to nail down what has been placed, and
 * `CommitRouting` at the end to fold the router's node back into the board.
 * `StopRouting` throws the session away. The methods below are those, in that
 * order.
 */
import type { Board } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { addBoardTrack, addBoardVia } from '../edit-board.js';
import { boardCopperLayerCount as copperLayerCount } from '../unused_pad_layers.js';
import { PnsBoardIface, boardLayerFromPnsLayer, type PnsPendingChange } from './pns_board_iface.js';
import { PnsKind } from './pns_item.js';
import type { PnsSegment } from './pns_segment.js';
import { PnsVia } from './pns_via.js';
import { PnsLinePlacer, type PnsRouterLike } from './pns_line_placer.js';
import { PnsRouter, PnsRouterState, type PnsRouterIface } from './pns_router.js';
import type { PnsItem } from './pns_item.js';
import type { PnsNode } from './pns_node.js';
import { PnsShove, type PnsShoveSettings } from './pns_shove.js';
import { DEFAULT_ROUTING_SETTINGS, type RoutingSettings } from './pns_routing_settings.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import { pickSingleItem } from './pns_tool_base.js';

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
 * Fold the router's decisions into a board.
 *
 * `PNS_KICAD_IFACE::AddItem`/`RemoveItem` build `PCB_TRACK`s and `PCB_VIA`s and
 * stage them on a `BOARD_COMMIT`; this is that, against an immutable `Board`.
 * Identity does the matching: an item the router synced out of the board keeps
 * a reference to the object it came from in `parent()`, so a remove or an update
 * finds its original without any search key.
 *
 * Arcs are placed by the router as `PnsArc`, and this drops them for now rather
 * than writing a wrong `PcbArcTrack`; the 45° corner modes the tool defaults to
 * never produce one.
 */
export function applyPnsChanges(aBoard: Board, aChanges: readonly PnsPendingChange[]): Board {
  let board = aBoard;
  // A removal names the object to drop; collect them and filter once, so a
  // route that rips up ten segments is one pass rather than ten copies.
  const dropped = new Set<unknown>();

  for (const change of aChanges) {
    const item = change.item;
    const parent = item.parent() as unknown;

    if (change.kind === 'remove' || change.kind === 'update') {
      if (parent) dropped.add(parent);
      if (change.kind === 'remove') continue;
    }

    if (item.kind() === PnsKind.SEGMENT_T) {
      const seg = item as PnsSegment;
      const s = seg.seg();
      board = addBoardTrack(board, {
        start: { x: s.a.x, y: s.a.y },
        end: { x: s.b.x, y: s.b.y },
        width: seg.width(),
        layer: boardLayerFromPnsLayer(seg.layers().start(), copperLayerCount(board)),
        net: netCodeOf(item),
      }).board;
    } else if (item.kind() === PnsKind.VIA_T) {
      const via = item as PnsVia;
      const at = via.pos();
      board = addBoardVia(board, {
        at: { x: at.x, y: at.y },
        size: via.diameter(PnsVia.ALL_LAYERS),
        drill: via.drill(),
        kind: via.viaType(),
        layers: [
          boardLayerFromPnsLayer(via.layers().start(), copperLayerCount(board)),
          boardLayerFromPnsLayer(via.layers().end(), copperLayerCount(board)),
        ],
        net: netCodeOf(item),
      }).board;
    }
  }

  if (dropped.size === 0) return board;

  return {
    ...board,
    tracks: board.tracks.filter((t) => !dropped.has(t)),
    arcs: board.arcs.filter((a) => !dropped.has(a)),
    vias: board.vias.filter((v) => !dropped.has(v)),
  };
}

/**
 * The net code behind a `NET_HANDLE`.
 *
 * Upstream a handle is an opaque `void*` that only `PNS_KICAD_IFACE::GetNetCode`
 * can read; here it is the board's own net object, and this is that accessor
 * without needing the interface on hand. A handle-less item is net zero, which
 * is what an unconnected track is.
 */
function netCodeOf(aItem: PnsItem): number {
  const net = aItem.net() as unknown;

  if (typeof net === 'number') return net;
  if (net && typeof net === 'object' && 'code' in net) {
    const code = (net as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }

  return 0;
}

/** How a session is set up. Everything optional has a KiCad default. */
export interface PnsSessionOptions {
  /** `ROUTING_SETTINGS`; the tool's Interactive Router Settings dialog. */
  settings?: RoutingSettings;
  /** Which board layers the user can see — `PNS_KICAD_IFACE::IsAnyLayerVisible`. */
  isLayerVisible?: (aLayer: string) => boolean;
  /**
   * `max( m_gridHelper->GetGrid().x, .y )`, the wider of the two radii
   * `pickSingleItem` searches at. Defaults to a quarter of a millimetre, which
   * is the pcbnew default grid.
   */
  maxSlopRadius?: number;
  /**
   * `SIZES_SETTINGS::Init( board, item, net )` — the track width and via
   * geometry the placer stamps on what it creates.
   *
   * Without it every segment comes out zero-width, which is what the first
   * assembled route did: the router is perfectly happy to place a track of no
   * width, and the board writer is happy to store one.
   */
  trackWidth?: number;
  viaDiameter?: number;
  viaDrill?: number;
}

/** What a session did to the board, once it finished. */
export interface PnsSessionResult {
  /** Whether the route was placed at all. */
  ok: boolean;
  /** `ROUTER::FailureReason()` — already a user-facing sentence upstream. */
  reason: string;
  /** The adds, updates and removes the router decided on, in order. */
  changes: PnsPendingChange[];
}

/**
 * An interactive routing session over one board.
 *
 * Construct one per route. The board is read at construction (`SyncWorld`) and
 * is not written until {@link PnsSession.commit}, so abandoning a session
 * leaves the board exactly as it was.
 */
export class PnsSession {
  private readonly iface: PnsBoardIface;
  private readonly router: PnsRouter;
  private readonly settings: RoutingSettings;
  private readonly maxSlopRadius: number;
  /** The PNS layer the route is on; `pickSingleItem` needs it as `topLayer`. */
  private layer = 0;
  /**
   * Everything the router committed, in order.
   *
   * Collected through the interface's commit hook rather than read off it
   * afterwards: `ROUTER::CommitRouting` closes the batch itself, from inside
   * the placer, so by the time control comes back here the interface has
   * already opened a fresh one.
   */
  private readonly committed: PnsPendingChange[] = [];

  constructor(
    private readonly board: Board,
    aOptions: PnsSessionOptions = {},
  ) {
    this.settings = aOptions.settings ?? { ...DEFAULT_ROUTING_SETTINGS };
    this.maxSlopRadius = aOptions.maxSlopRadius ?? 250_000;

    this.iface = new PnsBoardIface(board, {
      isLayerVisible: aOptions.isLayerVisible,
      onCommit: (batch) => {
        for (const change of batch) this.committed.push(change);
      },
    });

    const shoveSettings = shoveSettingsFrom(this.settings);
    this.router = new PnsRouter({
      factory: {
        // `ROUTER::SetMode`'s `PNS_MODE_ROUTE_SINGLE` arm. The placer talks to
        // its router through `PnsRouterLike`, four accessors and a shove
        // factory — the last of which is why this adapter exists rather than
        // the router itself being passed: `PnsRouter` cannot build a `PnsShove`
        // without importing it, and `pns_shove.ts` already reaches back into
        // the router's world. The composition lives out here instead.
        linePlacer: (r) => {
          const host: PnsRouterLike = {
            getInterface: () => r.getInterface() as never,
            getWorld: () => r.world(),
            settings: () => r.settings(),
            commitRouting: (aNode: PnsNode) => r.commitRouting(aNode),
            makeShove: (aWorld: PnsNode) => new PnsShove(aWorld, shoveSettings),
          };

          return new PnsLinePlacer(host) as never;
        },
      },
    });

    this.router.setInterface(this.iface as unknown as PnsRouterIface);
    this.router.loadSettings(this.settings);
    // `ROUTER_TOOL::prepareInteractive` — the sizes have to be in before the
    // placer starts, because `LINE_PLACER::initPlacement` reads the width once
    // and stamps it on the head and the tail.
    this.router.updateSizes({
      ...this.router.sizes(),
      trackWidth: aOptions.trackWidth ?? 0,
      // "The user picked this width", so continuing an existing track adopts it
      // rather than keeping the old one. A caller that passes nothing is
      // deliberately not explicit about anything.
      trackWidthIsExplicit: aOptions.trackWidth !== undefined,
      viaDiameter: aOptions.viaDiameter ?? 0,
      viaDrill: aOptions.viaDrill ?? 0,
    });
    this.router.syncWorld();
  }

  /** The live router, for callers that need more than this wrapper exposes. */
  get pnsRouter(): PnsRouter {
    return this.router;
  }

  /** `PNS_KICAD_IFACE`'s board-layer to PNS-layer mapping. */
  pnsLayer(aBoardLayer: string): number {
    return this.iface.getPnsLayerFromBoardLayer(aBoardLayer);
  }

  /**
   * `TOOL_BASE::pickSingleItem` — what the router should anchor to at `aWhere`.
   *
   * Exposed because the answer is worth showing before a route starts: it is
   * what decides whether clicking near a pad routes from the pad or from the
   * track beside it, and the editor highlights it.
   */
  pick(aWhere: Vec2, aLayer?: number): PnsItem | null {
    return pickSingleItem(
      {
        router: this.router,
        iface: this.iface as unknown as PnsRouterIface,
        topLayer: aLayer ?? this.layer,
        maxSlopRadius: this.maxSlopRadius,
        highContrast: false,
      },
      aWhere,
    );
  }

  /**
   * `ROUTER::StartRouting`. False when the start point is not routable, with
   * {@link PnsSession.failureReason} saying why — "The routing start point
   * violates DRC", most often.
   */
  start(aWhere: Vec2, aBoardLayer: string): boolean {
    this.layer = this.pnsLayer(aBoardLayer);

    return this.router.startRouting(aWhere, this.pick(aWhere, this.layer), this.layer);
  }

  /** `ROUTER::Move` — re-run the placer against the cursor. */
  move(aWhere: Vec2): boolean {
    return this.router.move(aWhere, this.pick(aWhere, this.layer));
  }

  /**
   * `ROUTER::FixRoute` — nail down what has been placed so far.
   *
   * `aForceFinish` is the double-click / Enter path: it ends the route here
   * rather than leaving the placer running from this point.
   */
  fix(aWhere: Vec2, aForceFinish = false): boolean {
    return this.router.fixRoute(aWhere, this.pick(aWhere, this.layer), aForceFinish, false);
  }

  /** Whether a route is in progress. */
  get routing(): boolean {
    return this.router.getState() === PnsRouterState.ROUTE_TRACK;
  }

  /** `ROUTER::FailureReason()`. */
  get failureReason(): string {
    return this.router.failureReason();
  }

  /**
   * End the session and hand back what the router decided.
   *
   * `CommitRoutingSession` folds the placer's node into the world and the
   * interface turns that into board changes; nothing has touched `board` until
   * this point, so a session abandoned before here costs nothing.
   */
  commit(): PnsSessionResult {
    const wasRouting = this.routing;

    if (wasRouting) this.router.commitRoutingSession();

    const changes = [...this.committed];
    this.committed.length = 0;
    this.router.dispose();

    return { ok: changes.length > 0, reason: this.router.failureReason(), changes };
  }

  /** `ROUTER::StopRouting` — throw the route away, board untouched. */
  abort(): void {
    this.router.stopRouting();
    this.iface.commit();
    this.router.dispose();
  }
}
