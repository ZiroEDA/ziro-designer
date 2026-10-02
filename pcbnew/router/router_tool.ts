// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ROUTER_TOOL`'s two size menus — `TRACK_WIDTH_MENU` and `DIFF_PAIR_MENU`
 * (`pcbnew/router/router_tool.cpp:280-520`), as item lists rather than as
 * `ACTION_MENU`s.
 *
 * The rows and their labels are the part worth porting exactly: they are what
 * tells a user which of the three overlapping ways of choosing a size is
 * currently winning, and each menu's checkmarks answer that from a different
 * combination of the same flags. The widget that draws them is the tool's, and
 * this module deliberately builds no UI — it returns what to draw, so the tool
 * that eventually draws it has nothing left to invent.
 *
 * ## The one that catches everybody
 *
 * The track menu lists index 0 as a row ("Track netclass width"); the diff-pair
 * menu does NOT — it lists from index 1 and puts index 0 behind its own "Use
 * Net Class Values" header item instead:
 *
 *     for( unsigned i = 1; i < bds.m_DiffPairDimensionsList.size(); ++i )
 *     …
 *     // remember that the menu doesn't contain index 0 (which is the netclass values)
 *     bds.SetDiffPairIndex( id - ID_POPUP_PCB_SELECT_DIFFPAIR1 + 1 );
 *
 * so the two menus number their rows differently against the same lists.
 */

import type {
  BOARD_DESIGN_SETTINGS,
  DIFF_PAIR_DIMENSION,
  VIA_DIMENSION,
} from '../board_design_settings.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { PNS_KICAD_IFACE, boardLayerFromPnsLayer } from './pns_kicad_iface.js';
import type { COMMIT_HOST, PnsDesignSettings } from './pns_kicad_iface.js';
import type { BOARD } from '../board.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import { VIATYPE } from '../pcb_track_types.js';
import { PnsKind } from './pns_item.js';
import type { PnsItem } from './pns_item.js';
import type { PnsLine } from './pns_line.js';
import type { PnsSegment } from './pns_segment.js';
import { PnsVia } from './pns_via.js';
import { PnsLinePlacer } from './pns_line_placer.js';
import type { PnsRouterLike } from './pns_line_placer.js';
import { PnsDiffPairPlacer } from './pns_diff_pair_placer.js';
import { PNS_HEAD_TRACE, PnsRouter, PnsRouterMode, PnsRouterState } from './pns_router.js';
import type { PnsRouterIface } from './pns_router.js';
import type { PnsNode } from './pns_node.js';
import { PnsShove } from './pns_shove.js';
import type { PnsShoveSettings } from './pns_shove.js';
import { DEFAULT_ROUTING_SETTINGS } from './pns_routing_settings.js';
import type { RoutingSettings } from './pns_routing_settings.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import { pickSingleItem } from './pns_tool_base.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { VIEW_GROUP } from '@ziroeda/common/view/view_group.js';
import { KeyNameFromKeyCode, PSEUDO_WXK_CLICK } from '@ziroeda/common/hotkeys_basic.js';
import { MD_CTRL } from '@ziroeda/common/tool/tool_event.js';
import { ROUTER_STATUS_VIEW_ITEM } from './router_status_view_item.js';

/** One row of either menu. */
export interface RouterSizeMenuItem {
  /** The label, already formatted in the frame's units. */
  label: string;
  /**
   * `wxITEM_CHECK`'s state — which of the rows is the one in force. At most one
   * of the list rows is checked, but a header row can be checked at the same
   * time as nothing else is.
   */
  checked: boolean;
  /**
   * What choosing the row does. `index` selects that entry of the list;
   * the rest are the header rows' own transitions.
   */
  action:
    | { kind: 'index'; index: number }
    | { kind: 'useStartingWidth' }
    | { kind: 'useNetclass' }
    | { kind: 'useCustom' };
  /** A separator follows this row. */
  separatorAfter?: boolean;
}

/** `EDA_DRAW_FRAME::MessageTextFromValue`, which every label below goes through. */
export type MessageText = (aValue: number) => string;

/**
 * `TRACK_WIDTH_MENU::update()` (`router_tool.cpp:295-362`).
 *
 * Three header rows, a separator, then every track width and every via size —
 * both lists in ONE menu, index 0 included and labelled.
 */
export function trackWidthMenuItems(
  aTrackWidthList: readonly number[],
  aViasDimensionsList: readonly VIA_DIMENSION[],
  aBds: BOARD_DESIGN_SETTINGS,
  aUseConnectedTrackWidth: boolean,
  aText: MessageText,
): RouterSizeMenuItem[] {
  // `bool useIndex = !bds.m_UseConnectedTrackWidth && !bds.UseCustomTrackViaSize();`
  const useIndex = !aUseConnectedTrackWidth && !aBds.UseCustomTrackViaSize();
  const items: RouterSizeMenuItem[] = [
    {
      label: 'Use Starting Track Width',
      checked: aUseConnectedTrackWidth && !aBds.UseCustomTrackViaSize(),
      action: { kind: 'useStartingWidth' },
    },
    {
      label: 'Use Net Class Values',
      // Both indices, not one: the row covers the track AND the via.
      checked: useIndex && aBds.GetTrackWidthIndex() === 0 && aBds.GetViaSizeIndex() === 0,
      action: { kind: 'useNetclass' },
    },
    {
      label: 'Use Custom Values...',
      checked: aBds.UseCustomTrackViaSize(),
      action: { kind: 'useCustom' },
      separatorAfter: true,
    },
  ];

  aTrackWidthList.forEach((width, i) => {
    items.push({
      label: i === 0 ? 'Track netclass width' : `Track ${aText(width)}`,
      checked: useIndex && aBds.GetTrackWidthIndex() === i,
      action: { kind: 'index', index: i },
      separatorAfter: i === aTrackWidthList.length - 1,
    });
  });

  aViasDimensionsList.forEach((via, i) => {
    let label: string;

    if (i === 0) label = 'Via netclass values';
    else if (via.m_Drill > 0) label = `Via ${aText(via.m_Diameter)}, hole ${aText(via.m_Drill)}`;
    else label = `Via ${aText(via.m_Diameter)}`;

    items.push({
      label,
      checked: useIndex && aBds.GetViaSizeIndex() === i,
      action: { kind: 'index', index: i },
    });
  });

  return items;
}

/**
 * `DIFF_PAIR_MENU::update()` (`router_tool.cpp:432-489`).
 *
 * Two header rows, a separator, then the pair dimensions **from index 1** — the
 * reserved entry is the "Use Net Class Values" row above, not a row of its own.
 *
 * The label grows with what the row actually carries: a gap of zero drops the
 * gap from the text, and a via gap of zero drops the via gap, so a row that
 * names only a width reads "Width 0.2 mm".
 */
export function diffPairMenuItems(
  aDiffPairDimensionsList: readonly DIFF_PAIR_DIMENSION[],
  aBds: BOARD_DESIGN_SETTINGS,
  aText: MessageText,
): RouterSizeMenuItem[] {
  const items: RouterSizeMenuItem[] = [
    {
      label: 'Use Net Class Values',
      // `!UseCustomDiffPairDimensions() && GetDiffPairIndex() == 0`.
      checked: !aBds.UseCustomDiffPairDimensions() && aBds.GetDiffPairIndex() === 0,
      action: { kind: 'useNetclass' },
    },
    {
      label: 'Use Custom Values...',
      checked: aBds.UseCustomDiffPairDimensions(),
      action: { kind: 'useCustom' },
      separatorAfter: true,
    },
  ];

  for (let i = 1; i < aDiffPairDimensionsList.length; i++) {
    const dp = aDiffPairDimensionsList[i]!;
    let label: string;

    if (dp.m_Gap <= 0) {
      label =
        dp.m_ViaGap <= 0
          ? `Width ${aText(dp.m_Width)}`
          : `Width ${aText(dp.m_Width)}, via gap ${aText(dp.m_ViaGap)}`;
    } else {
      label =
        dp.m_ViaGap <= 0
          ? `Width ${aText(dp.m_Width)}, gap ${aText(dp.m_Gap)}`
          : `Width ${aText(dp.m_Width)}, gap ${aText(dp.m_Gap)}, via gap ${aText(dp.m_ViaGap)}`;
    }

    items.push({
      label,
      checked: !aBds.UseCustomDiffPairDimensions() && aBds.GetDiffPairIndex() === i,
      action: { kind: 'index', index: i },
    });
  }

  return items;
}

// ============================================================================
// Folded in from pns_session.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================
/**
 * One interactive routing session: `ROUTER_TOOL`, minus wxWidgets.
 *
 * Every part of KiCad's push-and-shove router is ported in this directory —
 * `PnsRouter`, `PnsLinePlacer`, `PnsShove`, `PnsWalkaround`, `PnsNode`,
 * `PNS_KICAD_IFACE` and the rest — and each has a suite of its own. What did not
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
  /**
   * The pair's lane width and gap, `SIZES_SETTINGS::DiffPairWidth/Gap`, for a
   * caller with no design settings; absent means the constructor's 125000 /
   * 180000.
   */
  diffPairWidth?: number;
  diffPairGap?: number;
  /**
   * `BOARD_DESIGN_SETTINGS`, which is what `ROUTER_TOOL::prepareInteractive`
   * actually uses:
   *
   *     m_iface->ImportSizes( sizes, m_startItem, nullptr, aStartPosition );
   *     m_router->UpdateSizes( sizes );
   *
   * Supply it and the three loose numbers above are ignored: the sizes come
   * from Board Setup, the netclass and the toolbar's choice, resolved by
   * `ImportSizes`. They stay for callers that only want to place one track of a
   * stated width.
   */
  designSettings?: PnsDesignSettings;
  /**
   * `ROUTER::SetMode` — which placer the session builds
   * (`ROUTER_TOOL::MainLoop` picks it from the action that started the tool).
   * Defaults to single-track routing, which is what `ROUTER`'s own constructor
   * sets.
   */
  mode?: PnsRouterMode;
  /**
   * `PNS_KICAD_IFACE::SetView`: the VIEW the router previews on. The interface
   * puts its `VIEW_GROUP` in it and `DisplayItem` / `EraseView` / `HideItem`
   * work on it, as upstream's do. Without one (a headless session) the
   * preview calls do nothing.
   */
  view?: VIEW | null;
  /** `PCBNEW_SETTINGS::m_Display.m_TrackClearance`, for `DisplayItem`. */
  trackClearanceMode?: () => number;
  /** What the interface's BOARD_COMMIT is made for (`SetHostTool`). */
  commitHost?: COMMIT_HOST | null;
  /** `PCB_SELECTION_TOOL::GetEnteredGroup()`. */
  enteredGroup?: () => EDA_GROUP | null;
}

/** What a session did to the board, once it finished. */
export interface PnsSessionResult {
  /** Whether the route was placed at all. */
  ok: boolean;
  /** `ROUTER::FailureReason()` — already a user-facing sentence upstream. */
  reason: string;
}

/**
 * An interactive routing session over one board.
 *
 * Construct one per route. The board is read at construction (`SyncWorld`) and
 * is not written until {@link PnsSession.commit}, so abandoning a session
 * leaves the board exactly as it was.
 */
export class PnsSession {
  private readonly iface: PNS_KICAD_IFACE;
  private readonly router: PnsRouter;
  private readonly settings: RoutingSettings;
  private readonly maxSlopRadius: number;
  /** The PNS layer the route is on; `pickSingleItem` needs it as `topLayer`. */
  private layer = 0;
  constructor(
    private readonly board: BOARD,
    aOptions: PnsSessionOptions = {},
  ) {
    this.settings = aOptions.settings ?? { ...DEFAULT_ROUTING_SETTINGS };
    this.maxSlopRadius = aOptions.maxSlopRadius ?? 250_000;

    this.iface = new PNS_KICAD_IFACE(board, {
      isLayerVisible: aOptions.isLayerVisible,
      designSettings: aOptions.designSettings ?? null,
      view: aOptions.view ?? null,
      ...(aOptions.trackClearanceMode ? { trackClearanceMode: aOptions.trackClearanceMode } : {}),
      commitHost: aOptions.commitHost ?? null,
      ...(aOptions.enteredGroup ? { enteredGroup: aOptions.enteredGroup } : {}),
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
        // `PNS_MODE_ROUTE_DIFF_PAIR` -> `new DIFF_PAIR_PLACER( this )`. The
        // placer was ported and never reachable: nothing built one, so setting
        // the mode found no algo and the router stayed idle.
        diffPairPlacer: (r) =>
          new PnsDiffPairPlacer({
            world: () => r.world(),
            settings: () => r.settings(),
            setFailureReason: (reason: string) => r.setFailureReason(reason),
            commitRouting: (aNode: PnsNode) => r.commitRouting(aNode),
          }) as never,
      },
    });

    // Before `syncWorld`, because `SetMode` is what decides which placer
    // `StartRouting` will ask the factory for.
    this.router.setMode(aOptions.mode ?? PnsRouterMode.PNS_MODE_ROUTE_SINGLE);

    this.router.setInterface(this.iface as unknown as PnsRouterIface);
    this.router.loadSettings(this.settings);
    // `ROUTER_TOOL::prepareInteractive` — the sizes have to be in before the
    // placer starts, because `LINE_PLACER::initPlacement` reads the width once
    // and stamps it on the head and the tail.
    if (aOptions.designSettings) {
      // `ImportSizes( sizes, m_startItem, nullptr, aStartPosition )`. There is
      // no start item yet at construction — the tool re-imports once it has
      // one — so this is the no-item answer: board minimums raised by the
      // toolbar's choice and the netclass.
      const sizes = { ...this.router.sizes() };
      this.iface.importSizes(sizes, null, null, { x: 0, y: 0 });
      this.router.updateSizes(sizes);
    } else {
      const base = this.router.sizes();
      this.router.updateSizes({
        ...base,
        trackWidth: aOptions.trackWidth ?? 0,
        // "The user picked this width", so continuing an existing track adopts
        // it rather than keeping the old one. A caller that passes nothing is
        // deliberately not explicit about anything.
        trackWidthIsExplicit: aOptions.trackWidth !== undefined,
        viaDiameter: aOptions.viaDiameter ?? 0,
        viaDrill: aOptions.viaDrill ?? 0,
        diffPairWidth: aOptions.diffPairWidth ?? base.diffPairWidth,
        diffPairGap: aOptions.diffPairGap ?? base.diffPairGap,
      });
    }
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
    const startItem = this.pick(aWhere, this.layer);

    // `ROUTER_TOOL::prepareInteractive`, now that there IS a start item:
    //
    //     m_iface->ImportSizes( sizes, m_startItem, nullptr, aStartPosition );
    //     m_router->UpdateSizes( sizes );
    //
    // The constructor's import had no item; this one is what lets "Use
    // Existing Track Width" inherit from the track the route starts on.
    if (this.iface.importSizesEnabled) {
      const sizes = { ...this.router.sizes() };
      this.iface.importSizes(sizes, startItem, null, aWhere);
      this.router.updateSizes(sizes);
    }

    return this.router.startRouting(aWhere, startItem, this.layer);
  }

  /** `m_iface->GetBoardLayerFromPNSLayer( m_router->GetCurrentLayer() )`. */
  currentBoardLayer(): string {
    return boardLayerFromPnsLayer(this.router.getCurrentLayer(), this.board.GetCopperLayerCount());
  }

  /** `ROUTER::IsPlacingVia`. */
  get placingVia(): boolean {
    return this.router.isPlacingVia();
  }

  /**
   * `ROUTER_TOOL::handleLayerSwitch( aEvent, aForceVia = true )`'s tail
   * (router_tool.cpp:1325-1368), for a target layer the caller has already
   * chosen: the via's geometry and layer pair go into the sizes, via placement
   * is switched on if it was not, and the head is re-run against the cursor.
   *
   *     sizes.SetViaDiameter( … ); sizes.SetViaDrill( … );
   *     sizes.SetViaType( viaType );
   *     sizes.AddLayerPair( currentLayer, targetLayer );
   *     m_router->UpdateSizes( sizes );
   *     if( !m_router->IsPlacingVia() ) m_router->ToggleViaPlacement();
   *     if( m_router->RoutingInProgress() ) m_router->Move( … );
   */
  placeVia(
    aTargetBoardLayer: string,
    aViaDiameter: number,
    aViaDrill: number,
    aCursor: Vec2,
  ): void {
    const sizes = {
      ...this.router.sizes(),
      viaDiameter: aViaDiameter,
      viaDrill: aViaDrill,
      viaType: VIATYPE.THROUGH,
      layerTop: this.router.getCurrentLayer(),
      layerBottom: this.pnsLayer(aTargetBoardLayer),
    };
    this.router.updateSizes(sizes);

    if (!this.router.isPlacingVia()) this.router.toggleViaPlacement();

    if (this.router.routingInProgress()) this.move(aCursor);
  }

  /**
   * `ROUTER_TOOL::onViaCommand` when a via is already on the head:
   * `ToggleViaPlacement()` takes it off again, and the head is re-run.
   */
  cancelVia(aCursor: Vec2): void {
    if (this.router.isPlacingVia()) this.router.toggleViaPlacement();
    if (this.router.routingInProgress()) this.move(aCursor);
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
    // `bool needLayerSwitch = m_router->IsPlacingVia();` before the fix
    // (router_tool.cpp:1608), `switchLayerOnViaPlacement()` after it (:1617):
    // the TOOL, not the placer, moves the run onto the via's other layer —
    // `Sizes().PairedLayer( currentLayer )`, else `GetLayerTop()`.
    const needLayerSwitch = this.router.isPlacingVia();
    const done = this.router.fixRoute(aWhere, this.pick(aWhere, this.layer), aForceFinish, false);

    if (!done && needLayerSwitch) {
      const sizes = this.router.sizes();
      const current = this.router.getCurrentLayer();
      const paired =
        current === sizes.layerTop
          ? sizes.layerBottom
          : current === sizes.layerBottom
            ? sizes.layerTop
            : sizes.layerTop;
      this.router.switchLayer(paired);
      this.layer = paired;
    }

    return done;
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
   * End the session. `CommitRoutingSession` folds the placer's node into the
   * world, and the interface pushes it onto the board as a BOARD_COMMIT, as
   * each fixed segment already was.
   */
  commit(): PnsSessionResult {
    const wasRouting = this.routing;

    if (wasRouting) this.router.commitRoutingSession();

    this.router.dispose();
    this.iface.Dispose();

    return { ok: this.iface.pushedCommits() > 0, reason: this.router.failureReason() };
  }

  /** `ROUTER::StopRouting` — throw the route away, board untouched. */
  abort(): void {
    this.router.stopRouting();
    this.iface.commit();
    this.router.dispose();
    this.iface.Dispose();
  }

  /** `PNS_KICAD_IFACE::~PNS_KICAD_IFACE`: free the preview and take its group off the view. */
  dispose(): void {
    this.iface.Dispose();
  }

  /** The group the router's preview items are in, when a view was given. */
  get previewGroup(): VIEW_GROUP | null {
    return this.iface.GetPreviewItems();
  }
}

/**
 * `ROUTER_TOOL::performDragging`'s motion arm (router_tool.cpp:2118-2142): when
 * the dragger is in force-mark-obstacles mode, the preview is cleared and, if
 * the drag collides, a `ROUTER_STATUS_VIEW_ITEM` at the pointer says so.
 */
export function updateDragStatus(
  aView: VIEW,
  aDragger: { getForceMarkObstaclesMode(aDragStatus: { value: boolean }): boolean },
  aMousePosition: Vec2,
): ROUTER_STATUS_VIEW_ITEM | null {
  const dragStatus = { value: false };

  if (!aDragger.getForceMarkObstaclesMode(dragStatus)) return null;

  aView.ClearPreview();

  if (dragStatus.value) return null;

  const statusItem = new ROUTER_STATUS_VIEW_ITEM();
  statusItem.SetMessage('Track violates DRC.');
  statusItem.SetHint(`(${KeyNameFromKeyCode(MD_CTRL + PSEUDO_WXK_CLICK)} to commit anyway.)`);
  statusItem.SetPosition({ x: Math.round(aMousePosition.x), y: Math.round(aMousePosition.y) });
  aView.AddToPreview(statusItem);

  return statusItem;
}
