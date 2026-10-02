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
import {
  PNS_HEAD_TRACE,
  PnsRouter,
  PnsRouterMode,
  PnsRouterState,
  sizesAddLayerPair,
  sizesClearLayerPairs,
  sizesGetLayerTop,
  sizesPairedLayer,
} from './pns_router.js';
import type { PnsRouterIface } from './pns_router.js';
import { DEFAULT_ROUTING_SETTINGS, PnsMode } from './pns_routing_settings.js';
import type { RoutingSettings } from './pns_routing_settings.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import { PNS_TOOL_BASE, copySizes, newPnsRouter, pickSingleItem } from './pns_tool_base.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PnsConstraintType } from './pns_node.js';
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ROUTER_TRANSIENT } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import {
  TOOL_ACTION,
  TOOL_ACTION_ARGS,
  TOOL_ACTION_FLAGS,
  TOOL_ACTION_SCOPE,
} from '@ziroeda/common/tool/tool_action.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  MD_ALT,
  MD_SHIFT,
  TOOL_ACTIONS,
  TOOL_EVENT_CATEGORY,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { APPEND_UNDO } from '../board_commit.js';
import { DRC_CONSTRAINT_T } from '../drc/drc_rule.js';
import type { NETINFO_ITEM } from '../netinfo_item.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import { PCB_ACTIONS } from '../tools/pcb_actions.js';
import { IsZoneFillAction } from '../tools/pcb_picker_tool.js';
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

export { shoveSettingsFrom } from './pns_tool_base.js';

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

    this.router = newPnsRouter();

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

// ---------------------------------------------------------------------------
// ROUTER_TOOL

/** `VIA_ACTION_FLAGS` (router_tool.cpp:118-130): the via actions' parameter. */
export enum VIA_ACTION_FLAGS {
  // Via type
  VIA_MASK = 0x07,
  VIA = 0x00, ///< Normal via
  BLIND_VIA = 0x01, ///< blind via
  BURIED_VIA = 0x02, ///< buried via
  MICROVIA = 0x04, ///< Microvia

  // Select layer
  SELECT_LAYER = 0x07 + 1, ///< Ask user to select layer before adding via
}

const ch = (c: string): number => c.charCodeAt(0);

/** `MINOPTMAX::Max()` of a constraint that set none: `std::numeric_limits<int>::max()`. */
const INT_MAX = 2147483647;

// router_tool.cpp:143-265, the file-static actions. Constructing one registers
// it with ACTION_MANAGER, as their static initialisation does upstream.

export const ACT_PlaceThroughVia = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.PlaceVia')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(ch('V'))
    .LegacyHotkeyName('Add Through Via')
    .FriendlyName('Place Through Via')
    .Tooltip('Adds a through-hole via at the end of currently routed track.')
    .Icon(BITMAPS.via)
    .Flags(TOOL_ACTION_FLAGS.AF_NONE)
    .Parameter(VIA_ACTION_FLAGS.VIA),
);

export const ACT_PlaceBlindVia = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.PlaceBlindVia')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_ALT + MD_SHIFT + ch('V'))
    .LegacyHotkeyName('Add Blind/Buried Via')
    .FriendlyName('Place Blind/Buried Via')
    .Tooltip('Adds a blind or buried via at the end of currently routed track.')
    .Icon(BITMAPS.via_buried)
    .Flags(TOOL_ACTION_FLAGS.AF_NONE)
    .Parameter(VIA_ACTION_FLAGS.BLIND_VIA),
);

export const ACT_PlaceMicroVia = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.PlaceMicroVia')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_CTRL + ch('V'))
    .LegacyHotkeyName('Add MicroVia')
    .FriendlyName('Place Microvia')
    .Tooltip('Adds a microvia at the end of currently routed track.')
    .Icon(BITMAPS.via_microvia)
    .Flags(TOOL_ACTION_FLAGS.AF_NONE)
    .Parameter(VIA_ACTION_FLAGS.MICROVIA),
);

export const ACT_SelLayerAndPlaceThroughVia = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SelLayerAndPlaceVia')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(ch('<'))
    .LegacyHotkeyName('Select Layer and Add Through Via')
    .FriendlyName('Select Layer and Place Through Via...')
    .Tooltip('Select a layer, then add a through-hole via at the end of currently routed track.')
    .Icon(BITMAPS.select_w_layer)
    .Flags(TOOL_ACTION_FLAGS.AF_NONE)
    .Parameter(VIA_ACTION_FLAGS.VIA | VIA_ACTION_FLAGS.SELECT_LAYER),
);

export const ACT_SelLayerAndPlaceBlindVia = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SelLayerAndPlaceBlindVia')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_ALT + ch('<'))
    .LegacyHotkeyName('Select Layer and Add Blind/Buried Via')
    .FriendlyName('Select Layer and Place Blind/Buried Via...')
    .Tooltip('Select a layer, then add a blind or buried via at the end of currently routed track.')
    .Icon(BITMAPS.select_w_layer)
    .Flags(TOOL_ACTION_FLAGS.AF_NONE)
    .Parameter(VIA_ACTION_FLAGS.BLIND_VIA | VIA_ACTION_FLAGS.SELECT_LAYER),
);

export const ACT_SelLayerAndPlaceMicroVia = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SelLayerAndPlaceMicroVia')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .FriendlyName('Select Layer and Place Micro Via...')
    .Tooltip('Select a layer, then add a micro via at the end of currently routed track.')
    .Icon(BITMAPS.select_w_layer)
    .Flags(TOOL_ACTION_FLAGS.AF_NONE)
    .Parameter(VIA_ACTION_FLAGS.MICROVIA | VIA_ACTION_FLAGS.SELECT_LAYER),
);

export const ACT_CustomTrackWidth = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.CustomTrackViaSize')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(ch('Q'))
    .LegacyHotkeyName('Custom Track/Via Size')
    .FriendlyName('Custom Track/Via Size...')
    .Tooltip('Shows a dialog for changing the track width and via size.')
    .Icon(BITMAPS.width_track),
);

export const ACT_SwitchPosture = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SwitchPosture')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(ch('/'))
    .LegacyHotkeyName('Switch Track Posture')
    .FriendlyName('Switch Track Posture')
    .Tooltip('Switches posture of the currently routed track.')
    .Icon(BITMAPS.change_entry_orient),
);

// This old command ( track corner switch mode) is now moved to a submenu with other corner mode options
export const ACT_SwitchCornerModeToNext = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SwitchRoundingToNext')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_CTRL + ch('/'))
    .FriendlyName('Track Corner Mode Switch')
    .Tooltip('Switches between sharp/rounded and 45°/90° corners when routing tracks.')
    .Icon(BITMAPS.switch_corner_rounding_shape),
);

// hotkeys W and Shift+W  are used to switch to track width changes
export const ACT_SwitchCornerMode45 = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SwitchRounding45')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_CTRL + ch('W'))
    .FriendlyName('Track Corner Mode 45')
    .Tooltip('Switch to 45° corner when routing tracks.'),
);

export const ACT_SwitchCornerMode90 = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SwitchRounding90')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_CTRL + MD_ALT + ch('W'))
    .FriendlyName('Track Corner Mode 90')
    .Tooltip('Switch to 90° corner when routing tracks.'),
);

export const ACT_SwitchCornerModeArc45 = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SwitchRoundingArc45')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('W'))
    .FriendlyName('Track Corner Mode Arc 45')
    .Tooltip('Switch to arc 45° corner when routing tracks.'),
);

export const ACT_SwitchCornerModeArc90 = new TOOL_ACTION(
  new TOOL_ACTION_ARGS()
    .Name('pcbnew.InteractiveRouter.SwitchRoundingArc90')
    .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
    .DefaultHotkey(MD_ALT + ch('W'))
    .FriendlyName('Track Corner Mode Arc 90')
    .Tooltip('Switch to arc 90° corner when routing tracks.'),
);

/** `getViaTypeFromFlags` (router_tool.cpp:1004-1019). */
function getViaTypeFromFlags(aFlags: number): VIATYPE {
  switch (aFlags & VIA_ACTION_FLAGS.VIA_MASK) {
    case VIA_ACTION_FLAGS.VIA:
      return VIATYPE.THROUGH;
    case VIA_ACTION_FLAGS.BLIND_VIA:
      return VIATYPE.BLIND;
    case VIA_ACTION_FLAGS.BURIED_VIA:
      return VIATYPE.BURIED;
    case VIA_ACTION_FLAGS.MICROVIA:
      return VIATYPE.MICROVIA;
    default:
      return VIATYPE.THROUGH;
  }
}

/**
 * `ROUTER_TOOL` — pcbnew/router/router_tool.{h,cpp}, the interactive router on
 * TOOL_MANAGER: `MainLoop` arms single-track or diff-pair routing, a click
 * runs `performRouting` until the route is fixed or abandoned, and the via and
 * layer commands switch the head's layer mid-route.
 *
 * TRANSITIONAL (#636 E11b): `InlineDrag`, `InlineBreakTrack`, `RouteSelected`
 * and the context menu's size submenus are still the window's; their
 * transitions arrive with the parts that port them.
 */
export class ROUTER_TOOL extends PNS_TOOL_BASE {
  private m_lastTargetLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  private m_originalActiveLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  private m_inRouterTool = false;
  private m_inRouteSelected = false;
  private m_startWithVia = false;

  constructor() {
    super('pcbnew.InteractiveRouter');
  }

  /** `ROUTER_TOOL::Init` (router_tool.cpp:529-678), menu rows still to come. */
  override Init(): boolean {
    this.m_originalActiveLayer = PCB_LAYER_ID.UNDEFINED_LAYER;

    return true;
  }

  /** `ROUTER_TOOL::Reset` (router_tool.cpp:681-685): only a RUN rebuilds the router. */
  override Reset(aReason: RESET_REASON): void {
    if (aReason === RESET_REASON.RUN) super.Reset(aReason);
  }

  private editFrame(): PCB_EDIT_FRAME {
    return this.frame<PCB_EDIT_FRAME>();
  }

  /** `handleCommonEvents` (router_tool.cpp:774-797); the router dump is a desktop debug aid. */
  private handleCommonEvents(aEvent: TOOL_EVENT): void {
    if (
      aEvent.Category() === TOOL_EVENT_CATEGORY.TC_VIEW ||
      aEvent.Category() === TOOL_EVENT_CATEGORY.TC_MOUSE
    ) {
      const viewAreaD = this.getView()?.GetGAL()?.GetVisibleWorldExtents();

      if (viewAreaD) {
        this.m_router!.setVisibleViewArea({
          x: Math.round(viewAreaD.GetX()),
          y: Math.round(viewAreaD.GetY()),
          width: Math.round(viewAreaD.GetWidth()),
          height: Math.round(viewAreaD.GetHeight()),
        });
      }
    }
  }

  /** `handlePnSCornerModeChange` (router_tool.cpp:800-848). */
  handlePnSCornerModeChange(aEvent: TOOL_EVENT): number {
    const settings = this.m_router!.settings();
    let asChanged = false;

    if (aEvent.IsAction(ACT_SwitchCornerModeToNext)) {
      const curr_mode = settings.cornerMode;

      if (curr_mode === CornerMode.MITERED_45) settings.cornerMode = CornerMode.ROUNDED_45;
      else if (curr_mode === CornerMode.ROUNDED_45) settings.cornerMode = CornerMode.MITERED_90;
      else if (curr_mode === CornerMode.MITERED_90) settings.cornerMode = CornerMode.ROUNDED_90;
      else if (curr_mode === CornerMode.ROUNDED_90) settings.cornerMode = CornerMode.MITERED_45;

      asChanged = true;
    } else if (aEvent.IsAction(ACT_SwitchCornerMode45)) {
      settings.cornerMode = CornerMode.MITERED_45;
      asChanged = true;
    } else if (aEvent.IsAction(ACT_SwitchCornerModeArc45)) {
      settings.cornerMode = CornerMode.ROUNDED_45;
      asChanged = true;
    } else if (aEvent.IsAction(ACT_SwitchCornerMode90)) {
      settings.cornerMode = CornerMode.MITERED_90;
      asChanged = true;
    } else if (aEvent.IsAction(ACT_SwitchCornerModeArc90)) {
      settings.cornerMode = CornerMode.ROUNDED_90;
      asChanged = true;
    }

    if (asChanged) {
      this.UpdateMessagePanel();
      this.updateEndItem(aEvent);
      this.m_router!.move(this.m_endSnapPoint, this.m_endItem); // refresh
    }

    return 0;
  }

  /** `getStartLayer` (router_tool.cpp:851-867). */
  private getStartLayer(_aItem: PnsItem | null): PCB_LAYER_ID {
    const tl = this.getView()!.GetTopLayer() as PCB_LAYER_ID;

    if (this.m_startItem) {
      const startLayer = this.m_iface!.GetPNSLayerFromBoardLayer(tl);
      const ls = this.m_startItem.layers();

      if (ls.overlaps(startLayer)) return tl;

      return this.m_iface!.GetBoardLayerFromPNSLayer(ls.start());
    }

    return tl;
  }

  /** `switchLayerOnViaPlacement` (router_tool.cpp:870-889). */
  private switchLayerOnViaPlacement(): void {
    const activeLayer = this.m_iface!.GetPNSLayerFromBoardLayer(this.frame().GetActiveLayer());
    const currentLayer = this.m_router!.getCurrentLayer();

    if (currentLayer !== activeLayer) this.m_router!.switchLayer(activeLayer);

    let newLayer = sizesPairedLayer(this.m_router!.sizes(), currentLayer);

    if (newLayer === undefined) newLayer = sizesGetLayerTop(this.m_router!.sizes());

    this.m_router!.switchLayer(newLayer);
    this.m_lastTargetLayer = this.m_iface!.GetBoardLayerFromPNSLayer(newLayer);

    this.updateSizesAfterRouterEvent(newLayer, this.m_endSnapPoint);
    this.UpdateMessagePanel();
  }

  /**
   * `updateSizesAfterRouterEvent` (router_tool.cpp:892-1001). N.B. aTargetLayer
   * is a PNS layer, not a PCB_LAYER_ID.
   */
  private updateSizesAfterRouterEvent(aTargetLayer: number, aPos: Vec2): void {
    const nets = this.m_router!.getCurrentNets();

    const sizes = copySizes(this.m_router!.sizes());
    const bds = this.board().GetDesignSettings();
    const drcEngine = bds.m_DRCEngine;
    const targetLayer = this.m_iface!.GetBoardLayerFromPNSLayer(aTargetLayer);

    if (!drcEngine) return;

    const dummyTrack = new PCB_TRACK(this.board());
    dummyTrack.SetFlags(ROUTER_TRANSIENT);
    dummyTrack.SetLayer(targetLayer);
    dummyTrack.SetNet(nets.length === 0 ? null : (nets[0] as NETINFO_ITEM));
    dummyTrack.SetStart(aPos);
    dummyTrack.SetEnd(dummyTrack.GetStart());

    let constraint = drcEngine.EvalRules(
      DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
      dummyTrack,
      null,
      targetLayer,
    );

    if (constraint.m_Value.Min() >= bds.m_MinClearance) {
      sizes.clearance = constraint.m_Value.Min();
      sizes.clearanceSource = constraint.GetName();
    } else {
      sizes.clearance = bds.m_MinClearance;
      sizes.clearanceSource = 'board minimum clearance';
    }

    if (bds.UseNetClassTrack() || !sizes.trackWidthIsExplicit) {
      constraint = drcEngine.EvalRules(
        DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT,
        dummyTrack,
        null,
        targetLayer,
      );

      if (!constraint.IsNull()) {
        const width = sizes.trackWidth;

        // Only change the size if we're explicitly using the net class, or we're out of range
        // for our new constraints. Otherwise, just leave the track width alone so we don't
        // change for no reason.
        if (
          bds.UseNetClassTrack() ||
          width < bds.m_TrackMinWidth ||
          width < constraint.m_Value.Min() ||
          width > constraint.m_Value.Max()
        ) {
          sizes.trackWidth = Math.max(bds.m_TrackMinWidth, constraint.m_Value.Opt());
        }

        if (sizes.trackWidth === constraint.m_Value.Opt()) sizes.widthSource = constraint.GetName();
        else if (sizes.trackWidth === bds.m_TrackMinWidth)
          sizes.widthSource = 'board minimum track width';
        else sizes.widthSource = 'existing track';
      }
    }

    if (nets.length >= 2 && (bds.UseNetClassDiffPair() || !sizes.trackWidthIsExplicit)) {
      const dummyTrackB = new PCB_TRACK(this.board());
      dummyTrackB.SetFlags(ROUTER_TRANSIENT);
      dummyTrackB.SetLayer(targetLayer);
      dummyTrackB.SetNet(nets[1] as NETINFO_ITEM);
      dummyTrackB.SetStart(aPos);
      dummyTrackB.SetEnd(dummyTrackB.GetStart());

      constraint = drcEngine.EvalRules(
        DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT,
        dummyTrack,
        dummyTrackB,
        targetLayer,
      );

      if (!constraint.IsNull()) {
        if (
          bds.UseNetClassDiffPair() ||
          sizes.diffPairWidth < bds.m_TrackMinWidth ||
          sizes.diffPairWidth < constraint.m_Value.Min() ||
          sizes.diffPairWidth > constraint.m_Value.Max()
        ) {
          sizes.diffPairWidth = Math.max(bds.m_TrackMinWidth, constraint.m_Value.Opt());
        }

        if (sizes.diffPairWidth === constraint.m_Value.Opt())
          sizes.diffPairWidthSource = constraint.GetName();
        else sizes.diffPairWidthSource = 'board minimum track width';
      }

      constraint = drcEngine.EvalRules(
        DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT,
        dummyTrack,
        dummyTrackB,
        targetLayer,
      );

      if (!constraint.IsNull()) {
        if (
          bds.UseNetClassDiffPair() ||
          sizes.diffPairGap < bds.m_MinClearance ||
          sizes.diffPairGap < constraint.m_Value.Min() ||
          sizes.diffPairGap > constraint.m_Value.Max()
        ) {
          sizes.diffPairGap = Math.max(bds.m_MinClearance, constraint.m_Value.Opt());
        }

        if (sizes.diffPairGap === constraint.m_Value.Opt())
          sizes.diffPairGapSource = constraint.GetName();
        else sizes.diffPairGapSource = 'board minimum clearance';
      }
    }

    this.m_router!.updateSizes(sizes);
  }

  /** `onLayerCommand` (router_tool.cpp:1022-1028). */
  *onLayerCommand(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.handleLayerSwitch(aEvent, false);
    this.UpdateMessagePanel();

    return 0;
  }

  /** `onViaCommand` (router_tool.cpp:1031-1048). */
  *onViaCommand(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_router!.isPlacingVia()) {
      return yield* this.handleLayerSwitch(aEvent, true);
    }

    this.m_router!.toggleViaPlacement();
    this.frame().SetActiveLayer(
      this.m_iface!.GetBoardLayerFromPNSLayer(this.m_router!.getCurrentLayer()),
    );
    this.updateEndItem(aEvent);
    this.m_router!.move(this.m_endSnapPoint, this.m_endItem);

    this.UpdateMessagePanel();
    return 0;
  }

  /** `handleLayerSwitch` (router_tool.cpp:1051-1378). */
  private *handleLayerSwitch(aEvent: TOOL_EVENT, aForceVia: boolean): COROUTINE_BODY<number> {
    if (!this.m_router) return 0;

    if (!this.IsToolActive()) return 0;

    // First see if this is one of the switch layer commands
    const brd = this.board();
    const iface = this.m_iface!;
    const enabledLayers = LSET.AllCuMask(brd.GetDesignSettings().GetCopperLayerCount());
    const layers = enabledLayers.UIOrder();

    // These layers are in Board Layer UI order not PNS layer order
    let currentLayer = iface.GetBoardLayerFromPNSLayer(this.m_router.getCurrentLayer());
    let targetLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;

    if (aEvent.IsAction(PCB_ACTIONS.layerNext)) {
      let idx = 0;

      for (let i = 0; i < layers.length; i++) {
        if (layers[i] === currentLayer) {
          idx = i;
          break;
        }
      }

      let target_idx = (idx + 1) % layers.length;
      // issue: #14480
      // idx + 1 layer may be invisible, switches to next visible layer
      for (let i = 0; i < layers.length - 1; i++) {
        if (brd.IsLayerVisible(layers[target_idx]!)) {
          targetLayer = layers[target_idx]!;
          break;
        }

        target_idx += 1;

        if (target_idx >= layers.length) target_idx = 0;
      }

      // if there is no visible layers
      if (targetLayer === PCB_LAYER_ID.UNDEFINED_LAYER) return 0;
    } else if (aEvent.IsAction(PCB_ACTIONS.layerPrev)) {
      let idx = 0;

      for (let i = 0; i < layers.length; i++) {
        if (layers[i] === currentLayer) {
          idx = i;
          break;
        }
      }

      let target_idx = idx > 0 ? idx - 1 : layers.length - 1;

      for (let i = 0; i < layers.length - 1; i++) {
        if (brd.IsLayerVisible(layers[target_idx]!)) {
          targetLayer = layers[target_idx]!;
          break;
        }

        if (target_idx > 0) target_idx -= 1;
        else target_idx = layers.length - 1;
      }

      // if there is no visible layers
      if (targetLayer === PCB_LAYER_ID.UNDEFINED_LAYER) return 0;
    } else if (aEvent.IsAction(PCB_ACTIONS.layerToggle)) {
      const screen = this.editFrame().GetScreen()!;

      if (currentLayer === screen.m_Route_Layer_TOP) targetLayer = screen.m_Route_Layer_BOTTOM;
      else targetLayer = screen.m_Route_Layer_TOP;
    } else if (aEvent.IsActionInGroup(PCB_ACTIONS.layerDirectSwitchActions())) {
      targetLayer = aEvent.Parameter<PCB_LAYER_ID>();

      if (!enabledLayers.Contains(targetLayer)) return 0;
    }

    if (targetLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      if (targetLayer === currentLayer) return 0;

      if (!aForceVia && this.m_router.switchLayer(iface.GetPNSLayerFromBoardLayer(targetLayer))) {
        this.updateEndItem(aEvent);
        this.updateSizesAfterRouterEvent(
          iface.GetPNSLayerFromBoardLayer(targetLayer),
          this.m_endSnapPoint,
        );
        this.m_router.move(this.m_endSnapPoint, this.m_endItem); // refresh
        return 0;
      }
    }

    const bds = this.board().GetDesignSettings();

    const pairTop = this.editFrame().GetScreen()!.m_Route_Layer_TOP;
    const pairBottom = this.editFrame().GetScreen()!.m_Route_Layer_BOTTOM;

    const sizes = copySizes(this.m_router.sizes());

    let viaType = VIATYPE.THROUGH;
    let selectLayer = false;

    // Otherwise it is one of the router-specific via commands
    if (targetLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      const actViaFlags = aEvent.Parameter<number>() ?? 0;
      selectLayer = (actViaFlags & VIA_ACTION_FLAGS.SELECT_LAYER) !== 0;

      viaType = getViaTypeFromFlags(actViaFlags);

      // ask the user for a target layer
      if (selectLayer) {
        // When the currentLayer is undefined, trying to place a via does not work
        // because it means there is no track in progress, and some other variables
        // values are not defined like m_endSnapPoint. So do not continue.
        if (currentLayer === PCB_LAYER_ID.UNDEFINED_LAYER) return 0;

        // Build the list of not allowed layer for the target layer
        const not_allowed_ly = LSET.AllNonCuMask();

        if (viaType !== VIATYPE.THROUGH) not_allowed_ly.set(currentLayer);

        // `SelectOneLayer( currentLayer, not_allowed_ly, endPoint )`: the popup
        // opens over the window rather than at the track's end.
        targetLayer =
          (yield* this.RunMainStackModal(() =>
            this.editFrame().SelectOneLayer(currentLayer, not_allowed_ly),
          )) ?? PCB_LAYER_ID.UNDEFINED_LAYER;

        // Reset the cursor to the end of the track
        this.controls().SetCursorPosition(this.m_endSnapPoint);

        // canceled by user
        if (targetLayer === PCB_LAYER_ID.UNDEFINED_LAYER) return 0;

        // One cannot place a blind/buried via on only one layer:
        if (viaType !== VIATYPE.THROUGH) {
          if (currentLayer === targetLayer) return 0;
        }
      }
    }

    // fixme: P&S supports more than one fixed layer pair. Update the dialog?
    sizesClearLayerPairs(sizes);

    // Convert blind/buried via to a through hole one, if it goes through all layers
    if (
      viaType !== VIATYPE.THROUGH &&
      ((targetLayer === PCB_LAYER_ID.B_Cu && currentLayer === PCB_LAYER_ID.F_Cu) ||
        (targetLayer === PCB_LAYER_ID.F_Cu && currentLayer === PCB_LAYER_ID.B_Cu))
    ) {
      viaType = VIATYPE.THROUGH;
    }

    if (targetLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      // Implicit layer selection
      if (viaType === VIATYPE.THROUGH) {
        // Try to switch to the nearest ratnest item's layer if we have one
        const anchor = this.m_router.getNearestRatnestAnchor();

        if (!anchor) {
          // use the default layer pair
          currentLayer = pairTop;
          targetLayer = pairBottom;
        } else {
          // use the layer of the other end, unless it is the same layer as the currently active
          // layer, in which case use the layer pair (if applicable)
          const otherEndLayers = anchor.otherEndLayers;
          const otherEndItem = anchor.otherEndItem;
          const otherEndLayerPcbId = iface.GetBoardLayerFromPNSLayer(otherEndLayers.start());
          const pairedLayerPns = sizesPairedLayer(
            this.m_router.sizes(),
            this.m_router.getCurrentLayer(),
          );

          const allCopperLayers = new PnsLayerRange(
            iface.GetPNSLayerFromBoardLayer(PCB_LAYER_ID.F_Cu),
            iface.GetPNSLayerFromBoardLayer(PCB_LAYER_ID.B_Cu),
          );

          // A through anchor connects on every copper layer, so it names no single target.
          // Test the hole rather than the copper range, which segmented padstacks
          // (FRONT_INNER_BACK, custom) can report as a single layer.
          const hole = otherEndItem?.hole?.() ?? null;
          const otherEndIsThrough =
            otherEndLayers.equals(allCopperLayers) ||
            (otherEndItem !== null && hole !== null && hole.layers().equals(allCopperLayers));

          if (otherEndIsThrough) {
            // Honour the user's layer pair; the anchor span start is always the top
            // copper layer and would ignore it. Constrained anchors fall through below.
            if (currentLayer === pairBottom) targetLayer = pairTop;
            else if (currentLayer === pairTop) targetLayer = pairBottom;
            else targetLayer = pairTop;
          } else if (currentLayer === otherEndLayerPcbId && pairedLayerPns !== undefined) {
            // Closest ratsnest layer is the same as the active layer - assume the via is being
            // placed for other routing reasons and switch the layer
            targetLayer = iface.GetBoardLayerFromPNSLayer(pairedLayerPns);
          } else {
            targetLayer = iface.GetBoardLayerFromPNSLayer(otherEndLayers.start());
          }
        }
      } else {
        if (currentLayer === pairTop || currentLayer === pairBottom) {
          // the current layer is on the defined layer pair,
          // swap to the other side
          currentLayer = pairTop;
          targetLayer = pairBottom;
        } else {
          // the current layer is not part of the current layer pair,
          // so fallback and swap to the top layer of the pair by default
          targetLayer = pairTop;
        }

        // Do not create a broken via (i.e. a via on only one copper layer)
        if (currentLayer === targetLayer) {
          // `infobar->ShowMessageFor( …, 2000, wxICON_ERROR, DRC_VIOLATION )`.
          this.editFrame().ShowInfoBarError('Via needs 2 different layers.');
          return 0;
        }
      }
    }

    sizes.viaDiameter = bds.m_ViasMinSize;
    sizes.viaDrill = bds.m_MinThroughDrill;

    if (bds.UseNetClassVia() || viaType === VIATYPE.MICROVIA) {
      const dummyVia = new PCB_VIA(this.board());
      dummyVia.SetViaType(viaType);
      dummyVia.SetLayerPair(currentLayer, targetLayer);

      if (this.m_router.getCurrentNets().length > 0)
        dummyVia.SetNet(this.m_router.getCurrentNets()[0] as NETINFO_ITEM);

      const drcEngine = bds.m_DRCEngine;

      if (drcEngine) {
        let constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT,
          dummyVia,
          null,
          currentLayer,
        );

        if (!constraint.IsNull()) sizes.viaDiameter = constraint.m_Value.Opt();

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT,
          dummyVia,
          null,
          currentLayer,
        );

        if (!constraint.IsNull()) sizes.viaDrill = constraint.m_Value.Opt();
      }
    } else {
      sizes.viaDiameter = bds.GetCurrentViaSize();
      sizes.viaDrill = bds.GetCurrentViaDrill();
    }

    sizes.viaType = viaType;
    sizesAddLayerPair(
      sizes,
      iface.GetPNSLayerFromBoardLayer(currentLayer),
      iface.GetPNSLayerFromBoardLayer(targetLayer),
    );

    this.m_router.updateSizes(sizes);

    if (!this.m_router.isPlacingVia()) this.m_router.toggleViaPlacement();

    if (this.m_router.routingInProgress()) {
      this.updateEndItem(aEvent);
      this.m_router.move(this.m_endSnapPoint, this.m_endItem);
    } else {
      this.updateStartItem(aEvent);
    }

    return 0;
  }

  /** `prepareInteractive` (router_tool.cpp:1381-1453). */
  private prepareInteractive(aStartPosition: Vec2): boolean {
    const editFrame = this.editFrame();
    const pcbLayer = this.getStartLayer(this.m_startItem);
    const pnsLayer = this.m_iface!.GetPNSLayerFromBoardLayer(pcbLayer);

    if (!IsCopperLayer(pcbLayer)) {
      editFrame.ShowInfoBarError('Tracks on Copper layers only.');
      return false;
    }

    this.m_originalActiveLayer = editFrame.GetActiveLayer();
    editFrame.SetActiveLayer(pcbLayer);

    if (!this.getView()!.IsLayerVisible(pcbLayer)) {
      editFrame.GetAppearancePanel()?.SetLayerVisible?.(pcbLayer, true);
      editFrame.GetCanvas()?.Refresh();
    }

    const sizes = copySizes(this.m_router!.sizes());

    this.m_iface!.SetStartLayerFromPCBNew(pcbLayer);

    this.board().GetDesignSettings().m_TempOverrideTrackWidth = false;
    this.m_iface!.importSizes(sizes, this.m_startItem, null, aStartPosition);
    sizesAddLayerPair(
      sizes,
      this.m_iface!.GetPNSLayerFromBoardLayer(editFrame.GetScreen()!.m_Route_Layer_TOP),
      this.m_iface!.GetPNSLayerFromBoardLayer(editFrame.GetScreen()!.m_Route_Layer_BOTTOM),
    );

    this.m_router!.updateSizes(sizes);

    if (this.m_startItem?.net()) {
      if (this.m_router!.mode() === PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR) {
        const coupledNet = this.m_router!.getRuleResolver()?.dpCoupledNet(this.m_startItem.net());

        if (coupledNet) this.highlightNets(true, new Set([this.m_startItem.net(), coupledNet]));
      } else {
        this.highlightNets(true, new Set([this.m_startItem.net()]));
      }
    }

    this.controls().SetAutoPan(true);

    if (!this.m_router!.startRouting(this.m_startSnapPoint, this.m_startItem, pnsLayer)) {
      // It would make more sense to leave the net highlighted as the higher-contrast mode
      // makes the router clearances more visible.  However, since we just started routing
      // the conversion of the screen from low contrast to high contrast is a bit jarring and
      // makes the infobar coming up less noticeable.
      this.highlightNets(false);

      // `ShowInfoBarError( reason, true, [&]{ m_router->ClearViewDecorations(); } )`:
      // the close callback is the infobar's; the decorations go when the next
      // route starts (`performRouting`'s first line).
      editFrame.ShowInfoBarError(this.m_router!.failureReason(), true);

      this.controls().SetAutoPan(false);
      return false;
    }

    this.m_endItem = null;
    this.m_endSnapPoint = this.m_startSnapPoint;

    this.UpdateMessagePanel();
    editFrame.UndoRedoBlock(true);

    return true;
  }

  /** `finishInteractive` (router_tool.cpp:1456-1472). */
  private finishInteractive(): boolean {
    this.m_router!.stopRouting();

    this.m_startItem = null;
    this.m_endItem = null;

    this.frame().SetActiveLayer(this.m_originalActiveLayer);
    this.UpdateMessagePanel();
    this.frame().GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
    this.controls().SetAutoPan(false);
    this.controls().ForceCursorPosition(false);
    this.editFrame().UndoRedoBlock(false);
    this.highlightNets(false);

    return true;
  }

  /** `performRouting` (router_tool.cpp:1475-1695). */
  private *performRouting(aStartPosition: Vec2): COROUTINE_BODY<void> {
    const router = this.m_router!;
    const controls = this.controls();

    router.clearViewDecorations();

    if (!this.prepareInteractive(aStartPosition)) return;

    const setCursor = (): void => {
      this.frame().GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
    };

    const syncRouterAndFrameLayer = (): void => {
      const pnsLayer = router.getCurrentLayer();
      const pcbLayer = this.m_iface!.GetBoardLayerFromPNSLayer(pnsLayer);
      const editFrame = this.editFrame();

      editFrame.SetActiveLayer(pcbLayer);

      if (!this.getView()!.IsLayerVisible(pcbLayer)) {
        editFrame.GetAppearancePanel()?.SetLayerVisible?.(pcbLayer, true);
        editFrame.GetCanvas()?.Refresh();
      }
    };

    // Set initial cursor
    setCursor();

    // If the user pressed 'V' before starting to route, enable via placement now
    if (this.m_startWithVia) {
      this.m_startWithVia = false;
      yield* this.handleLayerSwitch(ACT_PlaceThroughVia.MakeEvent(), true);
    }

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();

      // Don't crash if we missed an operation that canceled routing.
      if (!router.routingInProgress()) {
        if (evt.IsCancelInteractive()) this.m_cancelled = true;

        break;
      }

      this.handleCommonEvents(evt);

      if (evt.IsMotion()) {
        this.updateEndItem(evt);
        router.move(this.m_endSnapPoint, this.m_endItem);
      } else if (
        evt.IsAction(PCB_ACTIONS.routerUndoLastSegment) ||
        evt.IsAction(ACTIONS.doDelete) ||
        evt.IsAction(ACTIONS.undo)
      ) {
        const last = router.undoLastSegment();

        if (last) {
          controls.WarpMouseCursor(last, true);
          evt.SetMousePosition(last);
        }

        this.updateEndItem(evt);
        router.move(this.m_endSnapPoint, this.m_endItem);
      } else if (evt.IsAction(PCB_ACTIONS.routerAttemptFinish)) {
        if (this.m_toolMgr!.IsContextMenuActive()) this.m_toolMgr!.WarpAfterContextMenu();

        const autoRouted = evt.Parameter<{ value: boolean } | null>() ?? null;

        if (router.finish()) {
          // When we're routing a group of signals automatically we want
          // to break up the undo stack every time we have to manually route
          // so the user gets nice checkpoints. Remove the APPEND_UNDO flag.
          if (autoRouted) autoRouted.value = true;

          break;
        }

        // This acts as check if we were called by the autorouter; we don't want
        // to reset APPEND_UNDO if we're auto finishing after route-other-end
        if (autoRouted) {
          autoRouted.value = false;
          this.m_iface!.SetCommitFlags(0);
        }

        // Warp the mouse so the user is at the point we managed to route to
        const end = router.placer()?.currentEnd();

        if (end) controls.WarpMouseCursor(end, true, true);
      } else if (evt.IsAction(PCB_ACTIONS.routerContinueFromEnd)) {
        const needsAppend = router.placer()?.hasPlacedAnything?.() ?? false;
        const continued = router.continueFromEnd();

        if (continued) {
          this.m_startItem = continued.newStartItem;
          syncRouterAndFrameLayer();
          this.m_startSnapPoint = router.placer()!.currentStart();
          this.updateEndItem(evt);

          // Warp the mouse to wherever we actually ended up routing to
          controls.WarpMouseCursor(router.placer()!.currentEnd(), true, true);

          // We want the next router commit to be one undo at the UI layer
          this.m_iface!.SetCommitFlags(needsAppend ? APPEND_UNDO : 0);
        } else {
          this.editFrame().ShowInfoBarError(router.failureReason(), true);
        }
      } else if (
        evt.IsClick(BUT_LEFT) ||
        evt.IsDrag(BUT_LEFT) ||
        evt.IsAction(PCB_ACTIONS.routeSingleTrack)
      ) {
        this.updateEndItem(evt);
        const needLayerSwitch = router.isPlacingVia();
        const forceCommit = false;

        if (router.fixRoute(this.m_endSnapPoint, this.m_endItem, false, forceCommit)) break;

        if (needLayerSwitch) this.switchLayerOnViaPlacement();
        else this.updateSizesAfterRouterEvent(router.getCurrentLayer(), this.m_endSnapPoint);

        // Synchronize the indicated layer
        syncRouterAndFrameLayer();

        this.updateEndItem(evt);
        router.move(this.m_endSnapPoint, this.m_endItem);
        this.m_startItem = null;
      } else if (evt.IsAction(ACT_SwitchPosture)) {
        router.flipPosture();
        this.updateEndItem(evt);
        router.move(this.m_endSnapPoint, this.m_endItem); // refresh
      } else if (evt.IsAction(PCB_ACTIONS.properties)) {
        this.frame().GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
        controls.SetAutoPan(false);
        this.m_toolMgr!.RunAction(ACT_CustomTrackWidth);
        controls.SetAutoPan(true);
        setCursor();
        this.UpdateMessagePanel();
      } else if (evt.IsAction(ACTIONS.finishInteractive) || evt.IsDblClick(BUT_LEFT)) {
        // Stop current routing:
        const forceFinish = true;
        const forceCommit = false;

        router.fixRoute(this.m_endSnapPoint, this.m_endItem, forceFinish, forceCommit);
        break;
      } else if (
        evt.IsCancelInteractive() ||
        evt.IsAction(PCB_ACTIONS.cancelCurrentItem) ||
        evt.IsActivate() ||
        evt.IsAction(PCB_ACTIONS.routerInlineDrag)
      ) {
        if (evt.IsCancelInteractive() && (this.m_inRouteSelected || !router.routingInProgress()))
          this.m_cancelled = true;

        if (evt.IsActivate() && !evt.IsMoveTool()) this.m_cancelled = true;

        break;
      } else if (evt.IsUndoRedo()) {
        // We're in an UndoRedoBlock.  If we get here, something's broken.
        break;
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.selection());
      }
      // TODO: It'd be nice to be able to say "don't allow any non-trivial editing actions",
      // but we don't at present have that, so we just knock out some of the egregious ones.
      else if (IsZoneFillAction(evt)) {
        wxBell();
      } else {
        evt.SetPassEvent();
      }
    }

    router.commitRoutingSession();
    // Reset to normal for next route
    this.m_iface!.SetCommitFlags(0);

    this.finishInteractive();
  }

  /** `ChangeRouterMode` (router_tool.cpp:1730-1739). */
  ChangeRouterMode(aEvent: TOOL_EVENT): number {
    const mode = aEvent.Parameter<PnsMode>();
    const settings = this.m_router!.settings();

    settings.routingMode = mode;
    this.UpdateMessagePanel();

    return 0;
  }

  /** `CycleRouterMode` (router_tool.cpp:1742-1758). */
  CycleRouterMode(_aEvent: TOOL_EVENT): number {
    const settings = this.m_router!.settings();
    let mode = settings.routingMode;

    switch (mode) {
      case PnsMode.RM_MarkObstacles:
        mode = PnsMode.RM_Shove;
        break;
      case PnsMode.RM_Shove:
        mode = PnsMode.RM_Walkaround;
        break;
      case PnsMode.RM_Walkaround:
        mode = PnsMode.RM_MarkObstacles;
        break;
    }

    settings.routingMode = mode;
    this.UpdateMessagePanel();

    return 0;
  }

  /** `GetRouterMode` (router_tool.cpp:1761). */
  GetRouterMode(): PnsMode {
    return this.m_router!.settings().routingMode;
  }

  /** `RoutingInProgress` (router_tool.cpp:1767). */
  RoutingInProgress(): boolean {
    return this.m_router?.routingInProgress() ?? false;
  }

  /** `MainLoop` (router_tool.cpp:1925-2070). */
  *MainLoop(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_inRouterTool) return 0;

    // REENTRANCY_GUARD guard( &m_inRouterTool );
    this.m_inRouterTool = true;

    try {
      return yield* this.mainLoop(aEvent);
    } finally {
      this.m_inRouterTool = false;
    }
  }

  private *mainLoop(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const mode = aEvent.Parameter<PnsRouterMode>();
    const frame = this.editFrame();
    const controls = this.controls();
    const router = this.m_router!;

    if (router.routingInProgress()) {
      if (router.mode() === mode) return 0;

      router.stopRouting();
    }

    // Deselect all items
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    const pushedEvent = aEvent;
    frame.PushTool(aEvent);

    const setCursor = (): void => {
      frame.GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.ForceCursorPosition(false);
    // Set initial cursor
    setCursor();

    router.setMode(mode);
    this.m_cancelled = false;
    this.m_startWithVia = false;

    if (aEvent.HasPosition()) this.m_toolMgr!.PrimeTool(aEvent.Position());

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      if (!evt.IsDrag()) setCursor();

      if (evt.IsCancelInteractive()) {
        frame.PopTool(pushedEvent);
        break;
      } else if (evt.IsActivate()) {
        if (evt.IsMoveTool() || evt.IsEditorTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        }

        frame.PopTool(pushedEvent);
        break;
      } else if (evt.Action() === TOOL_ACTIONS.TA_UNDO_REDO_PRE) {
        router.clearWorld();
      } else if (
        evt.Action() === TOOL_ACTIONS.TA_UNDO_REDO_POST ||
        evt.Action() === TOOL_ACTIONS.TA_MODEL_CHANGE
      ) {
        router.syncWorld();
      } else if (evt.IsMotion()) {
        this.updateStartItem(evt);
      } else if (
        evt.IsClick(BUT_LEFT) ||
        evt.IsAction(PCB_ACTIONS.routeSingleTrack) ||
        evt.IsAction(PCB_ACTIONS.routeDiffPair)
      ) {
        this.updateStartItem(evt);

        if (evt.HasPosition()) yield* this.performRouting(evt.Position());
      } else if (evt.IsAction(ACT_PlaceThroughVia)) {
        this.m_startWithVia = true;
        this.m_toolMgr!.RunAction(PCB_ACTIONS.layerToggle);
      } else if (evt.IsAction(PCB_ACTIONS.layerChanged)) {
        router.switchLayer(this.m_iface!.GetPNSLayerFromBoardLayer(frame.GetActiveLayer()));
        this.updateStartItem(evt);
        this.updateSizesAfterRouterEvent(
          this.m_iface!.GetPNSLayerFromBoardLayer(frame.GetActiveLayer()),
          this.m_startSnapPoint,
        );
      } else if (evt.IsKeyPressed()) {
        // wxWidgets fails to correctly translate shifted keycodes on the wxEVT_CHAR_HOOK
        // event so we need to process the wxEVT_CHAR event that will follow as long as we
        // pass the event.
        evt.SetPassEvent();
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.selection());
      } else {
        evt.SetPassEvent();
      }

      if (this.m_cancelled) {
        frame.PopTool(pushedEvent);
        break;
      }
    }

    // Store routing settings till the next invocation
    this.m_savedSizes = copySizes(router.sizes());
    router.clearViewDecorations();

    return 0;
  }

  /** `UpdateMessagePanel` (router_tool.cpp:2913-3054). */
  UpdateMessagePanel(): void {
    const router = this.m_router!;
    const frame = this.editFrame();

    if (router.getState() !== PnsRouterState.ROUTE_TRACK) {
      frame.SetMsgPanel(this.board());
      return;
    }

    const items: MSG_PANEL_ITEM[] = [];
    const sizes = router.sizes();
    const nets = router.getCurrentNets() as (NETINFO_ITEM | null)[];
    let description: string;
    let secondary: string;

    if (router.mode() === PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR) {
      const netA = nets[0]!;
      const netB = nets[1]!;

      description = `Routing Diff Pair: ${netA.GetNetname()}, ${netB.GetNetname()}`;

      const netclassA = netA.GetNetClass();
      const netclassB = netB.GetNetClass();
      const netclass = netclassA.equals(netclassB)
        ? netclassA.GetHumanReadableName()
        : `${netclassA.GetHumanReadableName()}, ${netclassB.GetHumanReadableName()}`;

      secondary = `Resolved Netclass: ${unescapeString(netclass)}`;
    } else if (nets.length > 0 && nets[0]) {
      const net = nets[0];

      description = `Routing Track: ${net.GetNetname()}`;
      secondary = `Resolved Netclass: ${unescapeString(net.GetNetClass().GetHumanReadableName())}`;
    } else {
      description = 'Routing Track';
      secondary = '(no net)';
    }

    items.push(new MSG_PANEL_ITEM(description, secondary));

    let cornerMode = '';

    if (router.settings().freeAngleMode) {
      cornerMode = 'Free-angle';
    } else {
      switch (router.settings().cornerMode) {
        case CornerMode.MITERED_45:
          cornerMode = '45-degree';
          break;
        case CornerMode.ROUNDED_45:
          cornerMode = '45-degree rounded';
          break;
        case CornerMode.MITERED_90:
          cornerMode = '90-degree';
          break;
        case CornerMode.ROUNDED_90:
          cornerMode = '90-degree rounded';
          break;
        default:
          break;
      }
    }

    items.push(new MSG_PANEL_ITEM('Corner Style', cornerMode));

    let mode = '';

    switch (router.settings().routingMode) {
      case PnsMode.RM_MarkObstacles:
        mode = 'Highlight collisions';
        break;
      case PnsMode.RM_Walkaround:
        mode = 'Walk around';
        break;
      case PnsMode.RM_Shove:
        mode = 'Shove';
        break;
      default:
        break;
    }

    items.push(new MSG_PANEL_ITEM('Mode', mode));

    const units = frame.GetUnitsProvider();
    const FORMAT_VALUE = (x: number): string => units.MessageTextFromValue(x);

    if (router.mode() === PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR) {
      items.push(
        new MSG_PANEL_ITEM(
          `Track Width: ${FORMAT_VALUE(sizes.diffPairWidth)}`,
          `(from ${sizes.diffPairWidthSource})`,
        ),
      );
      items.push(
        new MSG_PANEL_ITEM(
          `Min Clearance: ${FORMAT_VALUE(sizes.clearance)}`,
          `(from ${sizes.clearanceSource})`,
        ),
      );
      items.push(
        new MSG_PANEL_ITEM(
          `Diff Pair Gap: ${FORMAT_VALUE(sizes.diffPairGap)}`,
          `(from ${sizes.diffPairGapSource})`,
        ),
      );

      const traces = router.placer()!.traces();
      const resolver = this.m_iface!.getRuleResolver();
      const constraint =
        traces.size() === 2
          ? (resolver?.queryConstraint(
              PnsConstraintType.CT_MAX_UNCOUPLED,
              traces.at(0)!,
              traces.at(1)!,
              router.getCurrentLayer(),
            ) ?? null)
          : null;

      if (constraint) {
        items.push(
          new MSG_PANEL_ITEM(
            `DP Max Uncoupled-length: ${FORMAT_VALUE(constraint.value.max ?? INT_MAX)}`,
            `(from ${constraint.ruleName})`,
          ),
        );
      }
    } else {
      items.push(
        new MSG_PANEL_ITEM(
          `Track Width: ${FORMAT_VALUE(sizes.trackWidth)}`,
          `(from ${sizes.widthSource})`,
        ),
      );
      items.push(
        new MSG_PANEL_ITEM(
          `Min Clearance: ${FORMAT_VALUE(sizes.clearance)}`,
          `(from ${sizes.clearanceSource})`,
        ),
      );
    }

    frame.SetMsgPanel(items);
  }

  /** `setTransitions` (router_tool.cpp:3057-3124), the part this stage owns. */
  protected override setTransitions(): void {
    this.Go(this.MainLoop, PCB_ACTIONS.routeSingleTrack.MakeEvent());
    this.Go(this.MainLoop, PCB_ACTIONS.routeDiffPair.MakeEvent());
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.ChangeRouterMode),
      PCB_ACTIONS.routerHighlightMode.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.ChangeRouterMode),
      PCB_ACTIONS.routerShoveMode.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.ChangeRouterMode),
      PCB_ACTIONS.routerWalkaroundMode.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.CycleRouterMode),
      PCB_ACTIONS.cycleRouterMode.MakeEvent(),
    );

    this.Go(this.onViaCommand, ACT_PlaceThroughVia.MakeEvent());
    this.Go(this.onViaCommand, ACT_PlaceBlindVia.MakeEvent());
    this.Go(this.onViaCommand, ACT_PlaceMicroVia.MakeEvent());
    this.Go(this.onViaCommand, ACT_SelLayerAndPlaceThroughVia.MakeEvent());
    this.Go(this.onViaCommand, ACT_SelLayerAndPlaceBlindVia.MakeEvent());
    this.Go(this.onViaCommand, ACT_SelLayerAndPlaceMicroVia.MakeEvent());

    for (const layerAction of [
      PCB_ACTIONS.layerTop,
      PCB_ACTIONS.layerInner1,
      PCB_ACTIONS.layerInner2,
      PCB_ACTIONS.layerInner3,
      PCB_ACTIONS.layerInner4,
      PCB_ACTIONS.layerInner5,
      PCB_ACTIONS.layerInner6,
      PCB_ACTIONS.layerInner7,
      PCB_ACTIONS.layerInner8,
      PCB_ACTIONS.layerInner9,
      PCB_ACTIONS.layerInner10,
      PCB_ACTIONS.layerInner11,
      PCB_ACTIONS.layerInner12,
      PCB_ACTIONS.layerInner13,
      PCB_ACTIONS.layerInner14,
      PCB_ACTIONS.layerInner15,
      PCB_ACTIONS.layerInner16,
      PCB_ACTIONS.layerInner17,
      PCB_ACTIONS.layerInner18,
      PCB_ACTIONS.layerInner19,
      PCB_ACTIONS.layerInner20,
      PCB_ACTIONS.layerInner21,
      PCB_ACTIONS.layerInner22,
      PCB_ACTIONS.layerInner23,
      PCB_ACTIONS.layerInner24,
      PCB_ACTIONS.layerInner25,
      PCB_ACTIONS.layerInner26,
      PCB_ACTIONS.layerInner27,
      PCB_ACTIONS.layerInner28,
      PCB_ACTIONS.layerInner29,
      PCB_ACTIONS.layerInner30,
      PCB_ACTIONS.layerBottom,
      PCB_ACTIONS.layerNext,
      PCB_ACTIONS.layerPrev,
      PCB_ACTIONS.layerToggle,
    ]) {
      this.Go(this.onLayerCommand, layerAction.MakeEvent());
    }

    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.handlePnSCornerModeChange),
      ACT_SwitchCornerModeToNext.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.handlePnSCornerModeChange),
      ACT_SwitchCornerMode45.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.handlePnSCornerModeChange),
      ACT_SwitchCornerMode90.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.handlePnSCornerModeChange),
      ACT_SwitchCornerModeArc45.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<ROUTER_TOOL>(this.handlePnSCornerModeChange),
      ACT_SwitchCornerModeArc90.MakeEvent(),
    );
  }
}
