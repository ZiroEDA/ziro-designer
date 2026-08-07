// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::ROUTER` — `pcbnew/router/pns_router.{h,cpp}`.
 *
 * The driver that ties the push-and-shove router together. Everything it calls
 * — `NODE`, `SHOVE`, `WALKAROUND`, `OPTIMIZER`, the placers — is an algorithm
 * that answers one question. `ROUTER` is the state machine that decides *which*
 * question, holds the world, and pushes the answers at the UI.
 *
 * Four states (`PnsRouterState`) and two families of algorithm:
 *
 *   IDLE ──StartRouting──▶ ROUTE_TRACK ──Move──▶ ROUTE_TRACK ──FixRoute──▶ ROUTE_TRACK
 *     │                          └──CommitRouting/StopRouting──▶ IDLE
 *     └──StartDragging──▶ DRAG_SEGMENT | DRAG_COMPONENT ──Drag/FixRoute──▶ (same)
 *                                └──StopRouting──▶ IDLE
 *
 * `FixRoute` deliberately does **not** leave the routing state: fixing a
 * corner in the middle of a track keeps the session alive. Only
 * `CommitRouting()` / `StopRouting()` return to IDLE.
 *
 * Nothing here does geometry. Every method is a guard on `mState`, a
 * delegation to the current placer or dragger, and a view update. That is why
 * the interesting bugs in this file are all transition bugs, and why several
 * of upstream's oddities (§ the `ClearTemporaryCaches` that never runs,
 * `GetUpdatedItems` ignoring `DRAG_COMPONENT`, `UndoLastSegment` in a drag
 * state) survive here documented rather than fixed.
 *
 * See `/var/tmp/ziro-router-specs/pns_router_impl.md` for the method-by-method
 * derivation from the C++, including what is deliberately not ported.
 *
 * ## What this file has to declare, and why
 *
 * `PNS_KICAD_IFACE` (3293 lines of wxWidgets/BOARD bridge) is **out of scope**;
 * this repo replaces it with its own board layer. `ROUTER` calls it constantly,
 * so {@link PnsRouterIface} declares the surface and the bridge is somebody
 * else's PR.
 *
 * `PLACEMENT_ALGO` has no counterpart in this tree — nothing had needed the
 * abstraction until now — so {@link PnsPlacementAlgo} is declared here,
 * matching `pns_placement_algo.h` member for member. `DRAG_ALGO` **does** now
 * exist, as the abstract class `PnsDragAlgo` in `pns_drag_algo.ts`, and is
 * used directly; this file added `setDebugDecorator` to it, which
 * `ALGO_BASE` has upstream and `StartDragging` calls.
 *
 * `SIZES_SETTINGS` does not exist either. Following the precedent
 * `pns_diff_pair_placer.ts` set (and its comment explaining that a second
 * module inventing the name is what caused the last merge conflict here),
 * {@link PnsRouterSizes} extends that file's `DpPlacerSizes` with the three
 * further members `ROUTER` reads, rather than creating a rival module.
 */

import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import { ObstacleSet } from './pns_collision.js';
import { PnsItemSet } from './pns_itemset.js';
import { PnsKind, LineMarker } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PnsLine, PnsLineChain } from './pns_line_item.js';
import { PnsNode } from './pns_node.js';
import { PnsSegment } from './pns_segment.js';
import { findDpPrimitivePair, type DpPlacerSizes } from './pns_diff_pair_placer.js';
import { PnsDragMode, type PnsDragAlgo } from './pns_drag_algo.js';
import { PnsTopology } from './pns_topology.js';
import type { MeanderRouterIface } from './pns_meander_placer_base.js';
import type {
  NetHandle,
  PnsRouterIface as PnsCollisionRouterIface,
  PnsRuleResolver,
} from './pns_collision.js';
import type { PnsItem } from './pns_item.js';
import type { RoutingSettings } from './pns_routing_settings.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `router_preview_item.h:50` — the flag `movePlacing` tags the head with. */
export const PNS_HEAD_TRACE = 1;
/** `router_preview_item.h:51`. */
export const PNS_HOVER_ITEM = 2;
/** `router_preview_item.h:52`. */
export const PNS_SEMI_SOLID = 4;

// ---------------------------------------------------------------------------
// Enums — pns_router.h:67-84, 144-150

/**
 * `PNS::ROUTER_MODE` (pns_router.h:67-73).
 *
 * Numbered from **1**, not 0, upstream. Kept, because the value is persisted in
 * the tool's state and read back by `SetMode`.
 */
export enum PnsRouterMode {
  PNS_MODE_ROUTE_SINGLE = 1,
  PNS_MODE_ROUTE_DIFF_PAIR = 2,
  PNS_MODE_TUNE_SINGLE = 3,
  PNS_MODE_TUNE_DIFF_PAIR = 4,
  PNS_MODE_TUNE_DIFF_PAIR_SKEW = 5,
}

/** `ROUTER::RouterState` (pns_router.h:144-150). */
export enum PnsRouterState {
  IDLE = 0,
  DRAG_SEGMENT = 1,
  DRAG_COMPONENT = 2,
  ROUTE_TRACK = 3,
}

// ---------------------------------------------------------------------------
// SIZES_SETTINGS, reduced to what ROUTER reads

/**
 * The `PNS::SIZES_SETTINGS` members `ROUTER` reads, on top of the ten
 * `DIFF_PAIR_PLACER` already declared in `pns_diff_pair_placer.ts`.
 *
 * `pns_sizes_settings.ts` does not exist on `main` and this port deliberately
 * does not create it — see the file header. Extending `DpPlacerSizes` rather
 * than restating it means `router.sizes()` can be handed straight to
 * `PnsDiffPairPlacer.updateSizes()` with no adapter, which is what
 * `m_placer->UpdateSizes( m_sizes )` does upstream.
 */
export interface PnsRouterSizes extends DpPlacerSizes {
  /** `TrackWidth()` — the width of the track being placed. */
  trackWidth: number;
  /** `BoardMinTrackWidth()` — the narrowest track the board rules permit. */
  boardMinTrackWidth: number;
  /** `MinClearance()` — the board's minimum clearance constraint. */
  minClearance: number;
}

/** Every {@link PnsRouterSizes} member at its C++ default. */
export const DEFAULT_ROUTER_SIZES: PnsRouterSizes = {
  diffPairWidth: 0,
  diffPairGap: 0,
  diffPairViaGap: 0,
  diffPairViaGapSameAsTraceGap: false,
  diffPairHoleToHole: 0,
  diffPairCopperToHole: 0,
  viaDiameter: 0,
  viaDrill: 0,
  viaType: 'through',
  layerTop: 0,
  layerBottom: 0,
  trackWidthIsExplicit: false,
  trackWidth: 0,
  boardMinTrackWidth: 0,
  minClearance: 0,
};

// ---------------------------------------------------------------------------
// ROUTER_IFACE

/**
 * `PNS::ROUTER_IFACE` (pns_router.h:91-139) — the board/UI bridge, declared but
 * **not implemented** here.
 *
 * Upstream's only implementation is `PNS_KICAD_IFACE`, 3293 lines of wxWidgets
 * and `BOARD` plumbing that this repo replaces wholesale. Implementing it
 * against Ziro's `Board` is the next PR; this type is the contract that PR has
 * to satisfy.
 *
 * Divergences from the C++ declaration, all forced by this tree:
 *
 * - `PCB_LAYER_ID` is a layer *name* string here (`'F.Cu'`), so
 *   `getBoardLayerFromPnsLayer` returns a string and
 *   `getPnsLayerFromBoardLayer` takes one.
 * - The two `IsFlashedOnLayer` overloads collapse into one method taking
 *   `number | PnsLayerRange`; TS cannot overload an interface member by
 *   parameter type without a call-signature list, and the bodies upstream
 *   differ only in how they iterate.
 * - The six length/delay calculators are inherited from `MeanderRouterIface`,
 *   which `pns_meander_placer_base.ts` already declares from this same C++
 *   interface. Restating them would be a rival declaration of six names.
 * - `getDebugDecorator` is optional: `DEBUG_DECORATOR` is a drawing sink with
 *   no arithmetic and is not ported.
 * - {@link startPointUnroutableReason} has no C++ counterpart; see its doc.
 *
 * It also extends `pns_collision.ts`'s `PnsRouterIface`, which is the one
 * member (`isFlashedOnLayer`) the item model reaches through the router
 * singleton. That module declared the slice first and `setRouterIface` takes
 * it, so extending rather than restating means a full interface can be
 * installed as the singleton with no adapter — and there is one
 * `isFlashedOnLayer` signature in the tree, not two.
 *
 * Because the two share a name, `pcbnew/src/index.ts` re-exports only the
 * collision slice; import the full interface from
 * `./router/pns_router.js` directly. Same call, same reason, as
 * `pns_diff_pair_placer.ts`'s `DpPlacerHost`.
 */
export interface PnsRouterIface extends MeanderRouterIface, PnsCollisionRouterIface {
  /** `SyncWorld( NODE* )`: fill a fresh, bulk-add-open node from the board. */
  syncWorld(aNode: PnsNode): void;

  /** `AddItem( ITEM* )`: a routed item the board does not have yet. */
  addItem(aItem: PnsItem): void;

  /**
   * `UpdateItem( ITEM* )`: an item whose geometry changed but whose identity
   * (UUID, pad data) must be preserved. See {@link PnsRouter.commitRoutingTo}
   * for how `ROUTER` decides an item is an update rather than a remove+add.
   */
  updateItem(aItem: PnsItem): void;

  /** `RemoveItem( ITEM* )`. */
  removeItem(aItem: PnsItem): void;

  /** `IsAnyLayerVisible( const PNS_LAYER_RANGE& )`. */
  isAnyLayerVisible(aLayer: PnsLayerRange): boolean;

  /** `IsItemVisible( const ITEM* )`. */
  isItemVisible(aItem: PnsItem): boolean;

  // `isFlashedOnLayer` — both `IsFlashedOnLayer` overloads (pns_router.h:103-104)
  // — is inherited from `PnsCollisionRouterIface`, which already declares it
  // with this exact signature.

  /** `IsPNSCopperLayer( int )`. */
  isPnsCopperLayer(aPnsLayer: number): boolean;

  /**
   * `DisplayItem( const ITEM*, int aClearance, bool aEdit, int aFlags )`.
   *
   * `aFlags` takes {@link PNS_HEAD_TRACE} / {@link PNS_HOVER_ITEM} /
   * {@link PNS_SEMI_SOLID}. `aEdit` is upstream's "this item is being dragged".
   */
  displayItem(aItem: PnsItem, aClearance: number, aEdit?: boolean, aFlags?: number): void;

  /** `DisplayPathLine( const SHAPE_LINE_CHAIN&, int aImportance )`. */
  displayPathLine(aLine: PnsLineChain, aImportance: number): void;

  /** `DisplayRatline( const SHAPE_LINE_CHAIN&, NET_HANDLE )`. */
  displayRatline(aRatline: PnsLineChain, aNet: NetHandle): void;

  /** `HideItem( ITEM* )`. */
  hideItem(aItem: PnsItem): void;

  /** `Commit()`: push the accumulated add/remove/update at the undo stack. */
  commit(): void;

  /**
   * `ImportSizes( SIZES_SETTINGS&, ITEM*, NET_HANDLE, VECTOR2D )`: read track
   * width, via size and diff-pair dimensions out of the board's netclasses for
   * the net being started. Mutates `aSizes` upstream; same here.
   */
  importSizes(
    aSizes: PnsRouterSizes,
    aStartItem: PnsItem | null,
    aNet: NetHandle,
    aStartPosition: Vec2,
  ): boolean;

  /** `StackupHeight( int, int )`: physical distance between two layers. */
  stackupHeight(aFirstLayer: number, aSecondLayer: number): number;

  /** `EraseView()`: drop every preview item drawn since the last erase. */
  eraseView(): void;

  /** `GetNetCode( NET_HANDLE )`. Zero or negative means "no net". */
  getNetCode(aNet: NetHandle): number;

  /** `GetNetName( NET_HANDLE )`. */
  getNetName(aNet: NetHandle): string;

  /** `UpdateNet( NET_HANDLE )`: recompute the ratsnest for one net. */
  updateNet(aNet: NetHandle): void;

  /** `GetOrphanedNetHandle()`: the handle standing for "no net at all". */
  getOrphanedNetHandle(): NetHandle;

  /** `GetWorld()`: the iface's own view of the board, not the router's node. */
  getWorld(): PnsNode | null;

  /** `GetRuleResolver()`: the DRC engine the whole router asks for clearances. */
  getRuleResolver(): PnsRuleResolver | null;

  /** `GetBoardLayerFromPNSLayer( int )` — a layer name in this tree. */
  getBoardLayerFromPnsLayer(aLayer: number): string;

  /** `GetPNSLayerFromBoardLayer( PCB_LAYER_ID )` — takes a layer name here. */
  getPnsLayerFromBoardLayer(aLayer: string): number;

  /**
   * `GetDebugDecorator()`. Optional: `DEBUG_DECORATOR` is a pure drawing sink
   * used only by the router's own visual debugger, so an iface that has none is
   * a legal iface. Typed `unknown` because {@link PnsPlacementAlgo} and
   * {@link PnsDragAlgo} only ever pass it straight through.
   */
  getDebugDecorator?(): unknown;

  /**
   * Why a non-routable item cannot be a routing start point — the
   * `switch( parent->Type() )` at pns_router.cpp:257-295, which classifies the
   * `BOARD_ITEM` behind the `PNS::ITEM`: a non-plated hole, a keepout rule area
   * (named or not), or a text item.
   *
   * There is no C++ method here. `ROUTER` reads `BOARD_ITEM` directly, and this
   * tree's `PnsBoardItem` is `{ layer?: string }` — it carries no type, no pad
   * attribute and no zone keepout flags. Pushing the classification behind the
   * iface is the smallest seam that keeps
   * {@link PnsRouter.isStartingPointRoutable} exact; the board bridge owns the
   * switch. Return `null` for "no objection", which is upstream's `default:`.
   */
  startPointUnroutableReason(aItem: PnsItem): string | null;
}

// ---------------------------------------------------------------------------
// PLACEMENT_ALGO / DRAG_ALGO

/**
 * `PNS::PLACEMENT_ALGO` (`pns_placement_algo.h`) — the interface every
 * interactive placer implements: single-track, diff-pair, and the three length
 * tuners.
 *
 * Not declared anywhere else in this tree. `PnsDiffPairPlacer`,
 * `PnsMeanderPlacer`, `PnsDpMeanderPlacer` and `PnsMeanderSkewPlacer` all
 * satisfy it structurally today; `qa/unittests/pcbnew/pns_router.test.ts`
 * asserts that at compile time so this declaration cannot drift from them.
 *
 * The optional members are the ones upstream gives a body in the header, i.e.
 * the ones a subclass may legally not implement. `Start`, `Move`, `FixRoute`,
 * `Traces`, `CurrentStart`, `CurrentEnd`, `CurrentNets`, `CurrentLayer` and
 * `CurrentNode` are pure virtual and so are required here.
 *
 * `currentNode` returns `PnsNode | null`: upstream's `NODE*` is genuinely
 * nullable (a placer that has not started has no node), and
 * {@link PnsRouter.updateView} exists to handle exactly that.
 */
export interface PnsPlacementAlgo {
  /** `Start( const VECTOR2I&, ITEM* )`. */
  start(aP: Vec2, aStartItem: PnsItem | null): boolean;

  /** `Move( const VECTOR2I&, ITEM* )`. */
  move(aP: Vec2, aEndItem: PnsItem | null): boolean;

  /** `FixRoute( const VECTOR2I&, ITEM*, bool aForceFinish )`. */
  fixRoute(aP: Vec2, aEndItem: PnsItem | null, aForceFinish?: boolean): boolean;

  /** `Traces()`: everything currently being routed or tuned. */
  traces(): PnsItemSet;

  /** `CurrentStart()`. */
  currentStart(): Vec2;

  /** `CurrentEnd()`: not the cursor — collisions hold it back. */
  currentEnd(): Vec2;

  /** `CurrentNets()`. */
  currentNets(): NetHandle[];

  /** `CurrentLayer()`. */
  currentLayer(): number;

  /** `CurrentNode( bool aLoopsRemoved )`: the most recent board state. */
  currentNode(aLoopsRemoved?: boolean): PnsNode | null;

  /** `UnfixRoute()`: default `std::nullopt`. */
  unfixRoute?(): Vec2 | null;

  /** `CommitPlacement()`: default false. */
  commitPlacement?(): boolean;

  /** `AbortPlacement()`: default false. */
  abortPlacement?(): boolean;

  /** `HasPlacedAnything()`: default false. */
  hasPlacedAnything?(): boolean;

  /** `ToggleVia( bool )`: default false. */
  toggleVia?(aEnabled: boolean): boolean;

  /** `IsPlacingVia()`: default false. */
  isPlacingVia?(): boolean;

  /** `SetLayer( int )`: default false. */
  setLayer?(aLayer: number): boolean;

  /** `FlipPosture()`: default no-op. */
  flipPosture?(): void;

  /** `UpdateSizes( const SIZES_SETTINGS& )`: default no-op. */
  updateSizes?(aSizes: PnsRouterSizes): void;

  /** `SetOrthoMode( bool )`: default no-op. */
  setOrthoMode?(aOrthoMode: boolean): void;

  /** `GetModifiedNets( std::vector<NET_HANDLE>& )`: default no-op. */
  getModifiedNets?(aNets: NetHandle[]): void;

  /** `ALGO_BASE::SetDebugDecorator`. */
  setDebugDecorator?(aDecorator: unknown): void;
}

/**
 * The construction seam standing in for `std::make_unique<X>( this )`.
 *
 * Upstream `StartRouting` and `StartDragging` name five placer classes and
 * three dragger classes directly. In this tree `LINE_PLACER`, `DRAGGER`,
 * `COMPONENT_DRAGGER` and `MULTI_DRAGGER` **do not exist**, and the two placers
 * that do exist take mutually incompatible host objects
 * (`PnsDiffPairPlacer(DpPlacerHost)`, `PnsMeanderPlacer(MeanderPlacerHost)`,
 * the latter needing two `TOPOLOGY` assemblers that are also unported). There
 * is no way to write `new LINE_PLACER( this )`.
 *
 * So the `switch( m_mode )` stays a switch — it is the structure worth having
 * and worth mutating — and only the `new X( this )` inside each arm becomes a
 * factory call. A factory that returns `null` lands on the same `return false`
 * as upstream's `default:` arm, which is the honest behaviour for a mode whose
 * placer has not been written yet.
 *
 * {@link PnsRouter} implements `DpPlacerHost`, so wiring the diff-pair placer up
 * is `{ diffPairPlacer: (r) => new PnsDiffPairPlacer(r) }`.
 */
export interface PnsRouterAlgoFactory {
  /** `PNS_MODE_ROUTE_SINGLE` → `new LINE_PLACER( this )`. Not ported. */
  linePlacer?(aRouter: PnsRouter): PnsPlacementAlgo | null;
  /** `PNS_MODE_ROUTE_DIFF_PAIR` → `new DIFF_PAIR_PLACER( this )`. */
  diffPairPlacer?(aRouter: PnsRouter): PnsPlacementAlgo | null;
  /** `PNS_MODE_TUNE_SINGLE` → `new MEANDER_PLACER( this )`. */
  meanderPlacer?(aRouter: PnsRouter): PnsPlacementAlgo | null;
  /** `PNS_MODE_TUNE_DIFF_PAIR` → `new DP_MEANDER_PLACER( this )`. */
  dpMeanderPlacer?(aRouter: PnsRouter): PnsPlacementAlgo | null;
  /** `PNS_MODE_TUNE_DIFF_PAIR_SKEW` → `new MEANDER_SKEW_PLACER( this )`. */
  meanderSkewPlacer?(aRouter: PnsRouter): PnsPlacementAlgo | null;

  /** All-solids drag → `new COMPONENT_DRAGGER( this )`. Not ported. */
  componentDragger?(aRouter: PnsRouter): PnsDragAlgo | null;
  /** More than one segment/arc → `new MULTI_DRAGGER( this )`. Not ported. */
  multiDragger?(aRouter: PnsRouter): PnsDragAlgo | null;
  /** Anything else → `new DRAGGER( this )`. Not ported. */
  dragger?(aRouter: PnsRouter): PnsDragAlgo | null;
}

/** Optional constructor dependencies. */
export interface PnsRouterDeps {
  factory?: PnsRouterAlgoFactory;
}

// ---------------------------------------------------------------------------

/**
 * `static ROUTER* theRouter` (pns_router.cpp:58).
 *
 * Upstream calls this "an ugly singleton for drawing debug items within the
 * router context. To be fixed sometime in the future." The constructor assigns
 * it unconditionally, so constructing a second `ROUTER` silently displaces the
 * first and the older one's `GetInstance()` now returns the newer. Reproduced,
 * because a caller relying on `GetInstance()` gets upstream's answer or none.
 */
let theRouter: PnsRouter | null = null;

/**
 * `PNS::ROUTER` — pns_router.h:141, pns_router.cpp.
 *
 * Implements `DpPlacerHost` (`world`, `settings`, `setFailureReason`,
 * `commitRouting`) so `PnsDiffPairPlacer` can be constructed straight from it,
 * matching `ALGO_BASE::Router()` upstream.
 */
export class PnsRouter {
  private mVisibleViewArea: { x: number; y: number; width: number; height: number };
  private mState: PnsRouterState;

  private mWorld: PnsNode | null = null;
  private mPlacer: PnsPlacementAlgo | null = null;
  private mDragger: PnsDragAlgo | null = null;
  private mLeaderSegments: PnsItem[] = [];

  private mIface: PnsRouterIface | null;
  private mIterLimit: number;
  private mSettings: RoutingSettings | null;
  private mSizes: PnsRouterSizes;
  private mMode: PnsRouterMode;
  private mFailureReason = '';

  private readonly mFactory: PnsRouterAlgoFactory;

  /**
   * `ROUTER::ROUTER()` — pns_router.cpp:60-78.
   *
   * `m_visibleViewArea.SetMaximum()` is `BOX2I`'s "everything", which upstream
   * spells as the full `int` range with the origin at the minimum.
   *
   * `m_logger` is not ported: it is only ever constructed under
   * `ADVANCED_CFG::GetCfg().m_EnableRouterDump`, so it is null in every
   * shipping build, and every one of its uses in this file is guarded by
   * `if( m_logger )`. Carrying it would add a dozen dead branches.
   *
   * `m_lastNode`, `m_shove` and `m_toolStatusbarName` are declared in the
   * header and never read anywhere in `pns_router.cpp`. Not ported either.
   */
  constructor(aDeps: PnsRouterDeps = {}) {
    theRouter = this;

    this.mState = PnsRouterState.IDLE;
    this.mMode = PnsRouterMode.PNS_MODE_ROUTE_SINGLE;

    this.mIterLimit = 0;
    this.mSettings = null;
    this.mIface = null;
    this.mSizes = { ...DEFAULT_ROUTER_SIZES };
    this.mVisibleViewArea = {
      x: -0x8000_0000,
      y: -0x8000_0000,
      width: 0xffff_ffff,
      height: 0xffff_ffff,
    };

    this.mFactory = aDeps.factory ?? {};
  }

  /** `ROUTER::GetInstance()` — pns_router.cpp:81-84. */
  static getInstance(): PnsRouter | null {
    return theRouter;
  }

  /**
   * `ROUTER::~ROUTER()` — pns_router.cpp:87-92. There is no destructor in TS,
   * so the two observable effects get a method: the world is torn down and the
   * singleton is released.
   */
  dispose(): void {
    this.clearWorld();

    if (theRouter === this) theRouter = null;
  }

  // -- trivial accessors (pns_router.h) ------------------------------------

  /** `SetInterface( ROUTER_IFACE* )` — cpp:1097-1100. */
  setInterface(aIface: PnsRouterIface | null): void {
    this.mIface = aIface;
  }

  /** `GetInterface()` — h:240. */
  getInterface(): PnsRouterIface | null {
    return this.mIface;
  }

  /** `SetMode( ROUTER_MODE )` — cpp:1091-1094. */
  setMode(aMode: PnsRouterMode): void {
    this.mMode = aMode;
  }

  /** `Mode()` — h:158. */
  mode(): PnsRouterMode {
    return this.mMode;
  }

  /** `GetState()` — h:160. */
  getState(): PnsRouterState {
    return this.mState;
  }

  /** `GetDragger()` — h:162. */
  getDragger(): PnsDragAlgo | null {
    return this.mDragger;
  }

  /** `Placer()` — h:238. */
  placer(): PnsPlacementAlgo | null {
    return this.mPlacer;
  }

  /** `GetWorld()` — h:186. Also `DpPlacerHost::world()`. */
  getWorld(): PnsNode | null {
    return this.mWorld;
  }

  /** `DpPlacerHost::world()`, which is `ROUTER::GetWorld()`. */
  world(): PnsNode {
    // The placers dereference `Router()->GetWorld()` without checking, exactly
    // as upstream does; a router with no world is a programming error, not a
    // state a placer is expected to survive.
    return this.mWorld as PnsNode;
  }

  /** `GetRuleResolver()` — h:202: straight through to the interface. */
  getRuleResolver(): PnsRuleResolver | null {
    return this.mIface ? this.mIface.getRuleResolver() : null;
  }

  /** `SetIterLimit( int )` — h:211. */
  setIterLimit(aX: number): void {
    this.mIterLimit = aX;
  }

  /** `GetIterLimit()` — h:212. */
  getIterLimit(): number {
    return this.mIterLimit;
  }

  /**
   * `Settings()` — h:214, `*m_settings`.
   *
   * Upstream dereferences a borrowed pointer that `LoadSettings` supplied; a
   * router used before `LoadSettings` is undefined behaviour there. Here it
   * throws, because silently handing back a default object would make
   * `toggleCornerMode` and `allowDrcViolations` read from a settings block
   * nobody owns.
   */
  settings(): RoutingSettings {
    if (!this.mSettings) throw new Error('PnsRouter.settings() before loadSettings()');

    return this.mSettings;
  }

  /**
   * `LoadSettings( ROUTING_SETTINGS* )` — h:228-231.
   *
   * Stores the pointer; it is **borrowed**, never owned. That matters for
   * {@link toggleCornerMode}, which mutates it in place.
   */
  loadSettings(aSettings: RoutingSettings | null): void {
    this.mSettings = aSettings;
  }

  /** `Sizes()` — h:233. */
  sizes(): PnsRouterSizes {
    return this.mSizes;
  }

  /** `SetFailureReason( const wxString& )` — h:235. `DpPlacerHost` member. */
  setFailureReason(aReason: string): void {
    this.mFailureReason = aReason;
  }

  /** `FailureReason()` — h:236. */
  failureReason(): string {
    return this.mFailureReason;
  }

  /** `SetVisibleViewArea( const BOX2I& )` — h:242. */
  setVisibleViewArea(aExtents: { x: number; y: number; width: number; height: number }): void {
    this.mVisibleViewArea = aExtents;
  }

  /** `VisibleViewArea()` — h:243. */
  visibleViewArea(): { x: number; y: number; width: number; height: number } {
    return this.mVisibleViewArea;
  }

  /** `GetLastCommittedLeaderSegments()` — cpp:937-940. */
  getLastCommittedLeaderSegments(): PnsItem[] {
    return this.mLeaderSegments;
  }

  // -- world ---------------------------------------------------------------

  /**
   * `ROUTER::SyncWorld()` — cpp:95-104.
   *
   * The bulk-add window matters: `BeginBulkAdd` suppresses the index rebuild
   * that every `AddItem` would otherwise trigger, and `FixupVirtualVias` can
   * only run once the joints exist.
   */
  syncWorld(): void {
    this.clearWorld();

    const world = new PnsNode();
    this.mWorld = world;

    world.beginBulkAdd();
    this.mIface?.syncWorld(world);
    world.finalizeBulkAdd();
    world.fixupVirtualVias();
  }

  /**
   * `ROUTER::ClearWorld()` — cpp:107-117.
   *
   * `m_placer.reset()` sits **outside** the `if( m_world )`, so clearing an
   * already-empty world still drops the placer. `m_dragger` is deliberately
   * *not* dropped here — only `StopRouting` does that — which means a
   * `ClearWorld` mid-drag leaves a dragger pointing at a freed world. Upstream;
   * both halves are reproduced verbatim.
   *
   * `SetRuleResolver( nullptr )` must precede `KillChildren()`: the children
   * unlink through the resolver on the way out.
   */
  clearWorld(): void {
    if (this.mWorld) {
      this.mWorld.setRuleResolver(null);
      this.mWorld.killChildren();
      this.mWorld = null;
    }

    this.mPlacer = null;
  }

  /** `RoutingInProgress()` — cpp:120-123. Any state but IDLE, drags included. */
  routingInProgress(): boolean {
    return this.mState !== PnsRouterState.IDLE;
  }

  /**
   * `ROUTER::QueryHoverItems( const VECTOR2I&, int aSlopRadius )` —
   * cpp:126-156.
   *
   * The node is the **placer's**, never the dragger's, so hover queries during
   * a drag run against the unmodified world. Upstream.
   *
   * With a slop radius the probe is a zero-length one-unit-wide segment on all
   * layers, queried with same-net collisions enabled
   * (`m_differentNetsOnly = false`) and the radius forced in as the clearance;
   * that is how "within N units of the cursor" is expressed as a collision
   * query. Without one it is a plain hit test.
   *
   * Bug #484 (`PnsLine.shape()` returns null, so line-vs-line `collide()` is
   * always false) does not reach this path: the probe is a `PnsSegment`, and
   * segment shapes are present.
   */
  queryHoverItems(aP: Vec2, aSlopRadius = 0): PnsItemSet {
    const node = this.mPlacer ? this.mPlacer.currentNode() : this.mWorld;
    const ret = new PnsItemSet();

    // wxCHECK( node, ret )
    if (!node) return ret;

    if (aSlopRadius > 0) {
      const obs = new ObstacleSet();
      const test = new PnsSegment({ a: aP, b: aP }, null);

      test.setWidth(1);
      test.setLayers(PnsLayerRange.all());

      node.queryColliding(test, obs, {
        differentNetsOnly: false,
        overrideClearance: aSlopRadius,
      });

      for (const obstacle of obs.items()) {
        if (obstacle.item) ret.add(obstacle.item, false);
      }

      return ret;
    }

    return node.hitTest(aP);
  }

  // -- dragging ------------------------------------------------------------

  /**
   * `ROUTER::StartDragging( const VECTOR2I&, ITEM*, int )` — cpp:159-163.
   *
   * Clears `m_leaderSegments`, then delegates to the set overload, which clears
   * it again. Harmless duplication, kept.
   */
  startDraggingItem(aP: Vec2, aItem: PnsItem, aDragMode: number = PnsDragMode.DM_ANY): boolean {
    this.mLeaderSegments = [];

    return this.startDragging(aP, new PnsItemSet(aItem), aDragMode);
  }

  /**
   * `ROUTER::StartDragging( const VECTOR2I&, ITEM_SET, int )` — cpp:166-219.
   *
   * Dispatch order, which is load-bearing:
   *  1. every item a `SOLID_T` → `COMPONENT_DRAGGER`, state `DRAG_COMPONENT`
   *  2. more than one `SEGMENT_T|ARC_T` → `MULTI_DRAGGER`, state `DRAG_SEGMENT`
   *  3. otherwise → `DRAGGER`, state `DRAG_SEGMENT`
   *
   * Test 1 cannot fire on an empty set — the `Empty()` guard above returns
   * first — so `0 === 0` is unreachable, which is why upstream can get away
   * with an equality test rather than a "and non-empty" test.
   *
   * The state is set **before** `Start()` is attempted, so a dragger that fails
   * to start leaves the router transiently in a drag state before the
   * `IDLE` reset. Observable only from inside `Start()`.
   */
  startDragging(
    aP: Vec2,
    aStartItems: PnsItemSet,
    aDragMode: number = PnsDragMode.DM_COMPONENT,
  ): boolean {
    this.mLeaderSegments = [];
    this.setFailureReason('');

    if (aStartItems.empty()) return false;

    this.getRuleResolver()?.clearCaches?.();

    let dragger: PnsDragAlgo | null;

    if (aStartItems.count(PnsKind.SOLID_T) === aStartItems.size()) {
      dragger = this.mFactory.componentDragger?.(this) ?? null;
      this.mState = PnsRouterState.DRAG_COMPONENT;
    } else if (aStartItems.count(PnsKind.SEGMENT_T | PnsKind.ARC_T) > 1) {
      // more than 1 track segment or arc to drag? launch the multisegment dragger
      dragger = this.mFactory.multiDragger?.(this) ?? null;
      this.mState = PnsRouterState.DRAG_SEGMENT;
    } else {
      dragger = this.mFactory.dragger?.(this) ?? null;
      this.mState = PnsRouterState.DRAG_SEGMENT;
    }

    // No dragger class is ported yet; a factory that cannot supply one lands on
    // the same failure path as a dragger whose Start() returns false.
    if (!dragger) {
      this.mState = PnsRouterState.IDLE;

      return false;
    }

    this.mDragger = dragger;

    dragger.setMode(aDragMode as PnsDragMode);
    dragger.setWorld(this.mWorld);
    dragger.setDebugDecorator(this.mIface?.getDebugDecorator?.());

    if (dragger.start(aP, aStartItems)) {
      return true;
    }

    this.mDragger = null;
    this.mState = PnsRouterState.IDLE;

    return false;
  }

  // -- starting a route ----------------------------------------------------

  /**
   * `ROUTER::isStartingPointRoutable( const VECTOR2I&, ITEM*, int )` —
   * cpp:222-431.
   *
   * Five gates, in order; the first that fails wins, and the first gate short
   * circuits the other four entirely.
   *
   * The candidate scan (gate 3) has a subtlety worth naming: `failureReason` is
   * cleared **only** by finding a routable candidate, which then `break`s. It is
   * never cleared between iterations otherwise, so among several unroutable
   * candidates the *last* one's message is the one reported. Upstream.
   *
   * Gates 4 and 5 both use the same trick: probe with a degenerate two-point
   * line at the start point; if it collides at the configured width, try again
   * at the board minimum, and only fail if *that* collides too. The comment
   * upstream explains why — "If the only reason we collide is track width; it's
   * better to allow the user to start anyway and just highlight the resulting
   * collisions, so they can change width later."
   *
   * Bug #484 blunts both probes: the dummy is a `PnsLine`, whose `shape()`
   * returns null, so it cannot collide with another line at all. Pads, vias and
   * segments still register. Not fixed here.
   */
  isStartingPointRoutable(aWhere: Vec2, aStartItem: PnsItem | null, aLayer: number): boolean {
    if (this.settings().allowDrcViolations) return true;

    if (this.mMode === PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR) {
      if (this.mSizes.diffPairGap < this.mSizes.minClearance) {
        this.setFailureReason('Diff pair gap is less than board minimum clearance.');

        return false;
      }
    }

    const candidates = this.queryHoverItems(aWhere);
    let failureReason = '';

    for (const item of candidates.items()) {
      // Edge cuts are put on all layers, but they're not *really* on all layers
      if (item.boardItem() && item.boardItem()?.layer === 'Edge.Cuts') continue;

      if (!item.layers().overlaps(aLayer)) continue;

      if (item.isRoutable()) {
        failureReason = '';
        break;
      }

      // Upstream reads the BOARD_ITEM's type here (NPTH pad / keepout rule area
      // / text); this tree's PnsBoardItem carries no type, so the iface owns
      // the classification. See PnsRouterIface.startPointUnroutableReason.
      const reason = this.mIface ? this.mIface.startPointUnroutableReason(item) : null;

      if (reason !== null) failureReason = reason;
    }

    if (failureReason !== '') {
      this.setFailureReason(failureReason);

      return false;
    }

    const startPoint = aWhere;

    if (this.mMode === PnsRouterMode.PNS_MODE_ROUTE_SINGLE) {
      const dummyStartLine = makeDummyLine(
        startPoint,
        aLayer,
        aStartItem ? aStartItem.net() : null,
      );
      dummyStartLine.setWidth(this.mSizes.trackWidth);

      if (this.mWorld?.checkColliding(dummyStartLine, PnsKind.ANY_T)) {
        // If the only reason we collide is track width; it's better to allow the user to start
        // anyway and just highlight the resulting collisions, so they can change width later.
        dummyStartLine.setWidth(this.mSizes.boardMinTrackWidth);

        if (this.mWorld.checkColliding(dummyStartLine, PnsKind.ANY_T)) {
          const dummyStartSet = new PnsItemSet(dummyStartLine);
          const highlightedItems: PnsItem[] = [];

          this.markViolations(this.mWorld, dummyStartSet, highlightedItems);

          for (const item of highlightedItems) this.mIface?.hideItem(item);

          this.setFailureReason('The routing start point violates DRC.');

          return false;
        }
      }
    } else if (this.mMode === PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR) {
      if (!aStartItem) {
        this.setFailureReason('Cannot start a differential pair in the middle of nowhere.');

        return false;
      }

      if (!this.mWorld) return false;

      const search = findDpPrimitivePair(this.mWorld, startPoint, aStartItem);

      if (!search.pair) {
        // `errorMsg` is a wxString upstream, empty rather than absent when the
        // search declines to explain itself.
        this.setFailureReason(search.errorMsg ?? '');

        return false;
      }

      const dpPair = search.pair;

      // Check if the gap at the start point is compatible with the configured diff pair settings.
      // This only applies when starting from track segments, where the gap between existing
      // tracks should match the configured diff pair gap. When starting from pads or vias,
      // the anchor-to-anchor distance is determined by pad/via placement, not routing rules.
      if (aStartItem.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
        const dx = dpPair.anchorP().x - dpPair.anchorN().x;
        const dy = dpPair.anchorP().y - dpPair.anchorN().y;
        const actualGap = Math.hypot(dx, dy);
        const configuredGap = this.mSizes.diffPairGap + this.mSizes.diffPairWidth;

        // Allow some tolerance (10%) for minor differences, but warn about significant mismatches
        // `configuredGap / 10` is C++ integer division on an int.
        const tolerance = Math.trunc(configuredGap / 10);

        if (Math.abs(actualGap - configuredGap) > tolerance) {
          this.setFailureReason(
            'The differential pair gap at the start point does not match the configured gap. ' +
              'This can occur in neckdown areas where tracks have narrower width and spacing. ' +
              'Adjust the differential pair settings or start from a location with the correct gap.',
          );

          return false;
        }
      }

      // `dpPair.PrimN()->Net()` upstream; `primN()` is nullable here and
      // upstream dereferences it unguarded, so a null primitive becomes the
      // null net rather than a crash.
      const dummyStartLineA = makeDummyLine(
        dpPair.anchorN(),
        aLayer,
        dpPair.primN()?.net() ?? null,
      );
      const dummyStartLineB = makeDummyLine(
        dpPair.anchorP(),
        aLayer,
        dpPair.primP()?.net() ?? null,
      );

      dummyStartLineA.setWidth(this.mSizes.diffPairWidth);
      dummyStartLineB.setWidth(this.mSizes.diffPairWidth);

      if (
        this.mWorld.checkColliding(dummyStartLineA, PnsKind.ANY_T) ||
        this.mWorld.checkColliding(dummyStartLineB, PnsKind.ANY_T)
      ) {
        dummyStartLineA.setWidth(this.mSizes.boardMinTrackWidth);
        dummyStartLineB.setWidth(this.mSizes.boardMinTrackWidth);

        if (
          this.mWorld.checkColliding(dummyStartLineA, PnsKind.ANY_T) ||
          this.mWorld.checkColliding(dummyStartLineB, PnsKind.ANY_T)
        ) {
          const dummyStartSet = new PnsItemSet();
          const highlightedItems: PnsItem[] = [];

          dummyStartSet.add(dummyStartLineA);
          dummyStartSet.add(dummyStartLineB);
          this.markViolations(this.mWorld, dummyStartSet, highlightedItems);

          for (const item of highlightedItems) this.mIface?.hideItem(item);

          this.setFailureReason('The routing start point violates DRC.');

          return false;
        }
      }
    }

    return true;
  }

  /**
   * `ROUTER::StartRouting( const VECTOR2I&, ITEM*, int )` — cpp:434-491.
   *
   * The mode switch is the one dispatch in this file that decides *which*
   * algorithm the whole session runs. Note that upstream's `default:` arm
   * returns without touching `m_placer`, so a stale placer from a previous
   * session survives an unknown mode — reproduced.
   *
   * The four setters run before `Start()`; the order matters because
   * `UpdateSizes` seeds the widths `Start()` then uses.
   */
  startRouting(aP: Vec2, aStartItem: PnsItem | null, aLayer: number): boolean {
    this.getRuleResolver()?.clearCaches?.();

    if (!this.isStartingPointRoutable(aP, aStartItem, aLayer)) return false;

    let placer: PnsPlacementAlgo | null;

    switch (this.mMode) {
      case PnsRouterMode.PNS_MODE_ROUTE_SINGLE:
        placer = this.mFactory.linePlacer?.(this) ?? null;
        break;

      case PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR:
        placer = this.mFactory.diffPairPlacer?.(this) ?? null;
        break;

      case PnsRouterMode.PNS_MODE_TUNE_SINGLE:
        placer = this.mFactory.meanderPlacer?.(this) ?? null;
        break;

      case PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR:
        placer = this.mFactory.dpMeanderPlacer?.(this) ?? null;
        break;

      case PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW:
        placer = this.mFactory.meanderSkewPlacer?.(this) ?? null;
        break;

      default:
        // Upstream's `default: return false` — m_placer is left alone.
        return false;
    }

    // A mode whose placer class is not ported yet (LINE_PLACER) reaches the
    // same `return false` as an unknown mode, and likewise leaves mPlacer be.
    if (!placer) return false;

    this.mPlacer = placer;

    placer.updateSizes?.(this.mSizes);
    placer.setLayer?.(aLayer);
    placer.setDebugDecorator?.(this.mIface?.getDebugDecorator?.());

    if (placer.start(aP, aStartItem)) {
      this.mState = PnsRouterState.ROUTE_TRACK;

      return true;
    }

    this.mState = PnsRouterState.IDLE;
    this.mPlacer = null;

    return false;
  }

  // -- moving --------------------------------------------------------------

  /**
   * `ROUTER::Move( const VECTOR2I&, ITEM* )` — cpp:494-515.
   *
   * **Upstream oddity, reproduced.** The two live cases `return` from inside
   * the switch, so `GetRuleResolver()->ClearTemporaryCaches()` at cpp:512 runs
   * *only* on the `default:` fall-through — that is, only when the router is
   * IDLE and there is nothing to clear. The temporary caches are never cleared
   * during actual routing.
   *
   * It reads exactly like a `break` that should have been a `return`, which is
   * why it is called out here and pinned by a test: writing this "sensibly"
   * silently changes clearance-cache lifetime for every move.
   */
  move(aP: Vec2, aEndItem: PnsItem | null): boolean {
    switch (this.mState) {
      case PnsRouterState.ROUTE_TRACK:
        return this.movePlacing(aP, aEndItem);

      case PnsRouterState.DRAG_SEGMENT:
      case PnsRouterState.DRAG_COMPONENT:
        return this.moveDragging(aP, aEndItem);

      default:
        break;
    }

    this.getRuleResolver()?.clearTemporaryCaches?.();

    return false;
  }

  /**
   * `ROUTER::moveDragging( const VECTOR2I&, ITEM* )` — cpp:656-667.
   *
   * The return value is `Drag()`'s, captured **before** the view update, so a
   * drag that failed still refreshes the preview.
   */
  private moveDragging(aP: Vec2, _aEndItem: PnsItem | null): boolean {
    this.mIface?.eraseView();

    if (!this.mDragger) return false;

    const ret = this.mDragger.drag(aP);
    const dragged = this.mDragger.traces();

    this.mLeaderSegments = this.mDragger.getLastCommittedLeaderSegments();

    this.updateView(this.mDragger.currentNode(), dragged, true);

    return ret;
  }

  /**
   * `ROUTER::movePlacing( const VECTOR2I&, ITEM* )` — cpp:786-827.
   *
   * Every `LINE` in the head is drawn with `PNS_HEAD_TRACE`, and so is its via
   * if it ends with one. The via's clearance is the larger of its own copper
   * clearance and the *excess* hole clearance — the hole's clearance minus the
   * annular ring, which is the part of the hole clearance that sticks out past
   * the copper. Drawing the copper clearance alone would under-report a via
   * whose drill rule is tighter than its copper rule.
   *
   * `annularWidth = max( 0, Diameter(layer) - Drill() ) / 2` is C++ integer
   * division on an int, so it truncates.
   *
   * The final `updateView` passes `aLoopsRemoved = true` and leaves `aDragging`
   * at its default `false` — the opposite of the drag path.
   */
  private movePlacing(aP: Vec2, aEndItem: PnsItem | null): boolean {
    this.mIface?.eraseView();

    if (!this.mPlacer) return false;

    const ret = this.mPlacer.move(aP, aEndItem);
    const current = this.mPlacer.traces();
    const resolver = this.getRuleResolver();

    for (const item of current.citems()) {
      if (!item.ofKind(PnsKind.LINE_T)) continue;

      const l = item as PnsLine;
      const clearance = clearanceOf(resolver, item);

      this.mIface?.displayItem(l, clearance, false, PNS_HEAD_TRACE);

      if (l.endsWithVia()) {
        const via = l.via();
        let viaClearance = clearanceOf(resolver, via);

        if (via.hasHole()) {
          const hole = via.hole();
          const holeClearance = hole ? clearanceOf(resolver, hole) : 0;
          const annularWidth = Math.trunc(Math.max(0, via.diameter(l.layer()) - via.drill()) / 2);
          const excessHoleClearance = holeClearance - annularWidth;

          if (excessHoleClearance > viaClearance) viaClearance = excessHoleClearance;
        }

        this.mIface?.displayItem(l.via(), viaClearance, false, PNS_HEAD_TRACE);
      }
    }

    this.updateView(this.mPlacer.currentNode(true), current);

    return ret;
  }

  /**
   * `ROUTER::markViolations( NODE*, ITEM_SET&, NODE::ITEM_VECTOR& )` —
   * cpp:670-739.
   *
   * Every obstacle the current head collides with is marked `MK_VIOLATION` and
   * drawn as a **clone**, so the marker and any layer override do not touch the
   * board's item. Three details carry weight:
   *
   *  - A multilayer obstacle (a pad, a via) hit by a single-layer head is
   *    re-layered onto the head's layer before display, so the highlight
   *    appears where the collision is rather than on every layer.
   *  - A compound-shape primitive (one aperture of a custom pad) is displayed
   *    but **not** added to `aRemoved`, so the rest of the pad stays visible.
   *  - Items in the dragger's own `Traces()` are skipped: "Don't mark items
   *    being dragged; only board items they collide with."
   *
   * A line's via is queried into the **same** obstacle set as the line, so a
   * via clearance violation is reported against the line that carries it.
   *
   * Bug #484: `PnsLine.shape()` returns null, so `queryColliding` on a `LINE_T`
   * head finds nothing to mark against other lines. Segment, via and pad
   * obstacles are unaffected. Not fixed here.
   */
  markViolations(aNode: PnsNode, aCurrent: PnsItemSet, aRemoved: PnsItem[]): void {
    const updateItem = (currentItem: PnsItem, itemToMark: PnsItem): void => {
      const tmp = itemToMark.clone();

      let removeOriginal = true;

      const clearance = aNode.getClearance(currentItem, itemToMark);

      if (itemToMark.layers().isMultilayer() && !currentItem.layers().isMultilayer()) {
        tmp.setLayer(currentItem.layer());
      }

      if (itemToMark.isCompoundShapePrimitive()) {
        // We're only highlighting one (or more) of several primitives so we don't
        // want all the other parts of the object to disappear
        removeOriginal = false;
      }

      this.mIface?.displayItem(tmp, clearance);

      if (removeOriginal) aRemoved.push(itemToMark);
    };

    for (const item of aCurrent.items()) {
      const obstacles = new ObstacleSet();

      aNode.queryColliding(item, obstacles);

      if (item.ofKind(PnsKind.LINE_T)) {
        const l = item as PnsLine;

        if (l.endsWithVia()) {
          const v = l.via().clone();
          aNode.queryColliding(v, obstacles);
        }
      }

      let draggedItems = new PnsItemSet();

      if (this.getDragger()) draggedItems = this.getDragger()?.traces() ?? draggedItems;

      for (const obs of obstacles.items()) {
        if (!obs.item) continue;

        // Don't mark items being dragged; only board items they collide with
        if (draggedItems.contains(obs.item)) continue;

        obs.item.mark(obs.item.marker() | LineMarker.MK_VIOLATION);
        updateItem(item, obs.item);
      }

      if (item.kind() === PnsKind.LINE_T) {
        const line = item as PnsLine & { getBlockingObstacle?(): PnsItem | null };

        // Show clearance on any blocking obstacles.
        //
        // `LINE::GetBlockingObstacle()` is not on this tree's PnsLine, so the
        // call is guarded rather than dropped: it becomes live the moment the
        // accessor lands, with no change here.
        const blocking = line.getBlockingObstacle?.() ?? null;

        if (blocking) updateItem(item, blocking);
      }
    }
  }

  /**
   * `ROUTER::updateView( NODE*, ITEM_SET&, bool aDragging )` — cpp:742-773.
   *
   * `markViolations` runs **only** in the two routing modes, never the three
   * tuning ones. Upstream's comment: "we only mark violations when routing, not
   * when length tuning - as the length tuner by design can never generate
   * clearance violations. Since markViolations() calls multiple
   * collision/clearance queries, it can be extremely expensive with certain
   * custom DRC rules (rule area/courtyard-based, see issue #24052)."
   *
   * The `removed` list is a C++ out-parameter that `GetUpdatedItems` **appends**
   * to, so it already carries whatever `markViolations` pushed and everything
   * ends up hidden together. This tree's `getUpdatedItems()` returns a fresh
   * object, so the concatenation is explicit — and its order (violations first,
   * then the node's own removals) is the upstream order.
   */
  private updateView(aNode: PnsNode | null, aCurrent: PnsItemSet, aDragging = false): void {
    const removed: PnsItem[] = [];

    if (!aNode) return;

    if (
      this.mMode === PnsRouterMode.PNS_MODE_ROUTE_SINGLE ||
      this.mMode === PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR
    ) {
      this.markViolations(aNode, aCurrent, removed);
    }

    const updated = aNode.getUpdatedItems();
    removed.push(...updated.removed);
    const added = updated.added;

    const resolver = this.getRuleResolver();
    resolver?.clearCacheForItems?.([...added]);

    for (const item of added) {
      const clearance = clearanceOf(resolver, item);
      this.mIface?.displayItem(item, clearance, aDragging);
    }

    for (const item of removed) this.mIface?.hideItem(item);
  }

  /**
   * `ROUTER::UpdateSizes( const SIZES_SETTINGS& )` — cpp:776-783.
   *
   * Pushed through to a live placer so the user can change track width
   * mid-route. The guard is on the **state**, not on `m_placer` being non-null.
   */
  updateSizes(aSizes: PnsRouterSizes): void {
    this.mSizes = aSizes;

    // Change track/via size settings
    if (this.mState === PnsRouterState.ROUTE_TRACK) this.mPlacer?.updateSizes?.(this.mSizes);
  }

  /**
   * `ROUTER::GetUpdatedItems( ... )` — cpp:830-856.
   *
   * **`DRAG_COMPONENT` produces nothing.** Only `ROUTE_TRACK` and
   * `DRAG_SEGMENT` are handled, so a component drag reports no changes at all.
   * Upstream, and upstream is unsure about it too: "There probably should be a
   * debugging assertion and possibly a PNS_LOGGER call here but I'm not sure
   * how to be proceed WLS." Reproduced and pinned.
   *
   * Heads are cloned; removed/added are the node's own items.
   */
  getUpdatedItems(): { removed: PnsItem[]; added: PnsItem[]; heads: PnsItem[] } {
    let node: PnsNode | null = null;
    let current = new PnsItemSet();

    if (this.mState === PnsRouterState.ROUTE_TRACK) {
      node = this.mPlacer?.currentNode(true) ?? null;
      current = this.mPlacer?.traces() ?? current;
    } else if (this.mState === PnsRouterState.DRAG_SEGMENT) {
      node = this.mDragger?.currentNode() ?? null;
      current = this.mDragger?.traces() ?? current;
    }

    if (!node) return { removed: [], added: [], heads: [] };

    const updated = node.getUpdatedItems();
    const heads: PnsItem[] = [];

    for (const item of current.citems()) heads.push(item.clone());

    return { removed: updated.removed, added: updated.added, heads };
  }

  // -- committing ----------------------------------------------------------

  /**
   * `ROUTER::CommitRouting( NODE* )` — cpp:859-909. Also
   * `DpPlacerHost::commitRouting`.
   *
   * The remove/add pairing is the whole point of this method. An item that was
   * removed and an item that was added **sharing the same `Parent()`** is not
   * two events but one edit, and reporting it as `UpdateItem` rather than
   * `RemoveItem` + `AddItem` is what preserves the board item's UUID and its
   * pad data across a reroute. The added entry is pulled out of `added` so it
   * is not reported twice.
   *
   * `IsVirtual()` is tested on the removed/added item itself, never on the
   * partner it was matched to.
   *
   * `m_world->Commit( aNode )` is last, after `m_iface->Commit()`: the board
   * edit lands before the router's own world folds the branch in.
   *
   * Returns void upstream; boolean here only because `DpPlacerHost` declares
   * `commitRouting(): boolean`. The value is always `true` when it ran.
   */
  commitRoutingTo(aNode: PnsNode): boolean {
    if (this.mState === PnsRouterState.ROUTE_TRACK && !this.mPlacer?.hasPlacedAnything?.()) {
      return false;
    }

    const updated = aNode.getUpdatedItems();
    const removed = updated.removed;
    const added = [...updated.added];
    const changed: PnsItem[] = [];

    for (const item of removed) {
      let isChanged = false;

      // Items in remove/add that share the same parent are just updated versions
      // We move them to the updated vector to preserve attributes such as UUID and pad data
      if (item.parent()) {
        for (let i = 0; i < added.length; i++) {
          const candidate = added[i];

          if (candidate?.parent() && candidate.parent() === item.parent()) {
            changed.push(candidate);
            added.splice(i, 1);
            isChanged = true;
            break;
          }
        }
      }

      if (!isChanged && !item.isVirtual()) this.mIface?.removeItem(item);
    }

    for (const item of added) {
      if (!item.isVirtual()) this.mIface?.addItem(item);
    }

    for (const item of changed) {
      if (!item.isVirtual()) this.mIface?.updateItem(item);
    }

    this.mIface?.commit();
    this.mWorld?.commit(aNode);

    return true;
  }

  /** `DpPlacerHost::commitRouting( PnsNode )`. */
  commitRouting(aNode: PnsNode): boolean {
    return this.commitRoutingTo(aNode);
  }

  /**
   * `ROUTER::FixRoute( const VECTOR2I&, ITEM*, bool, bool )` — cpp:912-935.
   *
   * Note the asymmetry: `aForceFinish` reaches only the placer and
   * `aForceCommit` only the dragger. And note what is *absent* — no state
   * change. Fixing a corner mid-track keeps the session in `ROUTE_TRACK`;
   * ending it is `CommitRouting()`'s job.
   */
  fixRoute(
    aP: Vec2,
    aEndItem: PnsItem | null,
    aForceFinish: boolean,
    aForceCommit: boolean,
  ): boolean {
    let rv = false;

    switch (this.mState) {
      case PnsRouterState.ROUTE_TRACK:
        rv = this.mPlacer?.fixRoute(aP, aEndItem, aForceFinish) ?? false;
        break;

      case PnsRouterState.DRAG_SEGMENT:
      case PnsRouterState.DRAG_COMPONENT:
        rv = this.mDragger?.fixRoute(aForceCommit) ?? false;
        break;

      default:
        break;
    }

    return rv;
  }

  /**
   * `ROUTER::UndoLastSegment()` — cpp:943-952.
   *
   * `RoutingInProgress()` is true in the two **drag** states as well, where
   * `m_placer` is null — so upstream dereferences a null pointer there. That is
   * undefined behaviour, not a behaviour, so there is nothing to be faithful
   * to; this returns null instead of throwing. Pinned by a test so the
   * divergence is deliberate and visible.
   */
  undoLastSegment(): Vec2 | null {
    if (!this.routingInProgress()) return null;

    return this.mPlacer?.unfixRoute?.() ?? null;
  }

  /** `ROUTER::CommitRouting()` — cpp:955-961. */
  commitRoutingSession(): void {
    if (this.mState === PnsRouterState.ROUTE_TRACK) this.mPlacer?.commitPlacement?.();

    this.stopRouting();
  }

  /**
   * `ROUTER::StopRouting()` — cpp:964-989.
   *
   * The ratsnest update runs **before** the `RoutingInProgress()` early return,
   * deliberately: stopping an already-idle router that still holds a placer
   * refreshes the nets anyway and leaves the placer in place. Both halves are
   * upstream and both are mutation targets — hoisting the guard to the top
   * would drop a ratsnest refresh that the UI depends on.
   */
  stopRouting(): void {
    // Update the ratsnest with new changes
    if (this.mPlacer) {
      const nets: NetHandle[] = [];
      this.mPlacer.getModifiedNets?.(nets);

      // Update the ratsnest with new changes
      for (const n of nets) this.mIface?.updateNet(n);
    }

    if (!this.routingInProgress()) return;

    this.mPlacer = null;
    this.mDragger = null;

    this.mIface?.eraseView();

    this.mState = PnsRouterState.IDLE;
    this.mWorld?.killChildren();
    this.mWorld?.clearRanks();
  }

  /** `ROUTER::ClearViewDecorations()` — cpp:992-995. */
  clearViewDecorations(): void {
    this.mIface?.eraseView();
  }

  // -- head manipulation ---------------------------------------------------

  /** `ROUTER::FlipPosture()` — cpp:998-1004. `ROUTE_TRACK` only. */
  flipPosture(): void {
    if (this.mState === PnsRouterState.ROUTE_TRACK) this.mPlacer?.flipPosture?.();
  }

  /** `ROUTER::SwitchLayer( int )` — cpp:1007-1013. `ROUTE_TRACK` only. */
  switchLayer(aLayer: number): boolean {
    if (this.mState === PnsRouterState.ROUTE_TRACK) {
      return this.mPlacer?.setLayer?.(aLayer) ?? false;
    }

    return false;
  }

  /**
   * `ROUTER::ToggleViaPlacement()` — cpp:1016-1026.
   *
   * Reads the placer's current answer and pushes the negation back — so the
   * placer, not the router, owns the flag.
   */
  toggleViaPlacement(): void {
    if (this.mState === PnsRouterState.ROUTE_TRACK) {
      const toggle = !this.mPlacer?.isPlacingVia?.();
      this.mPlacer?.toggleVia?.(toggle);
    }
  }

  /**
   * `ROUTER::SetOrthoMode( bool )` — cpp:1082-1088.
   *
   * Guards on `m_placer` being non-null, **not** on the state — unlike its four
   * neighbours above. So a stale placer left behind by a failed `StartRouting`
   * still accepts this. Upstream.
   */
  setOrthoMode(aEnable: boolean): void {
    if (!this.mPlacer) return;

    this.mPlacer.setOrthoMode?.(aEnable);
  }

  /** `ROUTER::IsPlacingVia()` — cpp:1057-1063. Guards on the placer, not state. */
  isPlacingVia(): boolean {
    if (!this.mPlacer) return false;

    return this.mPlacer.isPlacingVia?.() ?? false;
  }

  /**
   * `ROUTER::GetCurrentNets()` — cpp:1029-1037. Placer wins when both exist.
   */
  getCurrentNets(): NetHandle[] {
    if (this.mPlacer) return this.mPlacer.currentNets();
    if (this.mDragger) return this.mDragger.currentNets();

    return [];
  }

  /** `ROUTER::GetCurrentLayer()` — cpp:1040-1048. Placer wins; -1 for neither. */
  getCurrentLayer(): number {
    if (this.mPlacer) return this.mPlacer.currentLayer();
    if (this.mDragger) return this.mDragger.currentLayer();

    return -1;
  }

  /**
   * `ROUTER::ToggleCornerMode()` — cpp:1066-1079.
   *
   * A four-way cycle: `MITERED_45 → ROUNDED_45 → MITERED_90 → ROUNDED_90 →`
   * back to `MITERED_45`. Upstream initialises `mode` from the getter and then
   * reads the getter a second time in the switch head; the initialiser is dead
   * for every enumerator, and only matters if `CORNER_MODE` ever grows a fifth
   * value — at which point it becomes the identity fall-through. Kept, since
   * removing it changes what an out-of-range value does.
   *
   * `m_settings` is a **borrowed** pointer upstream, so writing through it is
   * visible to whoever owns the settings block. `RoutingSettings` here is a
   * plain data interface rather than a class with a setter, so this mutates the
   * field directly — same visibility, same aliasing.
   */
  toggleCornerMode(): void {
    const settings = this.settings();
    let mode: CornerMode = settings.cornerMode;

    switch (settings.cornerMode) {
      case CornerMode.MITERED_45:
        mode = CornerMode.ROUNDED_45;
        break;
      case CornerMode.ROUNDED_45:
        mode = CornerMode.MITERED_90;
        break;
      case CornerMode.MITERED_90:
        mode = CornerMode.ROUNDED_90;
        break;
      case CornerMode.ROUNDED_90:
        mode = CornerMode.MITERED_45;
        break;
    }

    settings.cornerMode = mode;
  }

  // -- ratsnest-driven finishing ------------------------------------------

  /**
   * `ROUTER::GetNearestRatnestAnchor( aOtherEnd, aOtherEndLayers, aOtherEndItem )`
   * — cpp:518-566.
   *
   * Two different lookups depending on whether the user has drawn anything
   * yet. With segments on the trace it is
   * `TOPOLOGY::NearestUnconnectedAnchorPoint( trace )`, which walks out from
   * the trace's own end. With a bare start point it is
   * `NearestUnconnectedItem` off the joint at the placer's start, and the
   * answer is that item's `Anchor( anchor )` plus its layer range.
   *
   * `FindJoint` is asked for `placer->CurrentNets()[0]` — upstream indexes
   * that vector without checking it is non-empty, but the `GetCurrentNets()`
   * guard at the top of the method has already rejected the empty case.
   *
   * The guards ahead of the lookup are ported exactly: no current nets, no
   * placer, no traces, or a first trace that is not a `LINE` all fail.
   */
  getNearestRatnestAnchor(): {
    otherEnd: Vec2;
    otherEndLayers: PnsLayerRange;
    otherEndItem: PnsItem;
  } | null {
    // Can't finish something with no connections
    if (this.getCurrentNets().length === 0) return null;

    const placer = this.placer();

    if (placer === null || placer.traces().size() === 0) return null;

    const first = placer.traces().at(0);
    const trace = first instanceof PnsLine ? first : null;

    if (trace === null) return null;

    const lastNode = placer.currentNode(true);

    if (!lastNode) return null;

    const topo = new PnsTopology(lastNode);

    // If the user has drawn a line, get the anchor nearest to the line end
    if (trace.segmentCount() > 0) {
      const found = topo.nearestUnconnectedAnchorPoint(trace);

      if (!found) return null;

      return { otherEnd: found.point, otherEndLayers: found.layers, otherEndItem: found.item };
    }

    // Otherwise, find the closest anchor to our start point

    // Get joint from placer start item
    const jt = lastNode.findJoint(
      placer.currentStart(),
      placer.currentLayer(),
      placer.currentNets()[0] ?? null,
    );

    if (!jt) return null;

    // Get unconnected item from joint
    const nearest = topo.nearestUnconnectedItem(jt);

    if (!nearest) return null;

    return {
      otherEnd: nearest.item.anchor(nearest.anchor),
      otherEndLayers: nearest.item.layers(),
      otherEndItem: nearest.item,
    };
  }

  /**
   * `ROUTER::Finish()` — cpp:569-614.
   *
   * Routes the rest of the way to the nearest ratsnest anchor by repeatedly
   * `Move`ing at it until the head stops changing, then fixing.
   *
   * The convergence loop is subtle and is ported literally:
   * `moveResultPoint` is assigned the end position **before** each `Move`, so
   * after the loop it holds the second-to-last end, not the last. The success
   * test therefore compares the *pre-final-move* position against the target.
   * A "cleanup" that hoists the assignment after the `Move` changes when this
   * succeeds. Pinned by a test.
   *
   * `triesLeft` starts at 5 and the loop also stops as soon as a `Move` fails
   * to change the end position.
   */
  finish(): boolean {
    if (this.mState !== PnsRouterState.ROUTE_TRACK) return false;

    const placer = this.placer();

    if (placer === null || placer.traces().size() === 0) return false;

    const first = placer.traces().at(0);

    if (!(first instanceof PnsLine)) return false;

    // Get our current line and position and nearest ratsnest to them if it exists
    const anchor = this.getNearestRatnestAnchor();

    if (!anchor) return false;

    // Keep moving until we don't change position or hit the limit
    let triesLeft = 5;
    let moveResultPoint: Vec2;

    do {
      moveResultPoint = placer.currentEnd();
      this.move(anchor.otherEnd, anchor.otherEndItem);
      triesLeft--;
    } while (!vecEqual(placer.currentEnd(), moveResultPoint) && triesLeft);

    // If we've made it, fix the route and we're done
    if (
      vecEqual(moveResultPoint, anchor.otherEnd) &&
      anchor.otherEndLayers.overlaps(this.getCurrentLayer())
    ) {
      const forceFinish = false;
      const allowViolations = false;

      return this.fixRoute(anchor.otherEnd, anchor.otherEndItem, forceFinish, allowViolations);
    }

    return false;
  }

  /**
   * `ROUTER::ContinueFromEnd( ITEM** )` — cpp:617-653.
   *
   * Commits what is drawn, then restarts routing from the *other* end of the
   * connection and moves back to where the user was — turning a track that got
   * stuck into one approached from the opposite side.
   *
   * `CommitRouting()` here is the no-argument one, which stops the session. If
   * the restart then fails, the work stays committed and the router stays
   * stopped — upstream returns false without trying to undo. Reproduced.
   *
   * Returns the new start item on success (upstream's `*aNewStartItem`
   * out-parameter), null on failure.
   */
  continueFromEnd(): { newStartItem: PnsItem } | null {
    const placer = this.placer();

    if (placer === null || placer.traces().size() === 0) return null;

    const first = placer.traces().at(0);

    if (!(first instanceof PnsLine)) return null;

    const currentLayer = this.getCurrentLayer();
    const currentEnd = placer.currentEnd();

    // Get the anchor nearest to the end of the trace the user is routing
    const anchor = this.getNearestRatnestAnchor();

    if (!anchor) return null;

    this.commitRoutingSession();

    // Commit whatever we've fixed and restart routing from the other end
    const nextLayer = anchor.otherEndLayers.overlaps(currentLayer)
      ? currentLayer
      : anchor.otherEndLayers.start();

    if (!this.startRouting(anchor.otherEnd, anchor.otherEndItem, nextLayer)) return null;

    // Attempt to route to our current position
    this.move(currentEnd, null);

    return { newStartItem: anchor.otherEndItem };
  }

  // `ROUTER::BreakSegmentOrArc( ITEM*, const VECTOR2I& )` (cpp:1103-1124) is
  // NOT ported. It exists only to call `LINE_PLACER::SplitAdjacentSegments` /
  // `SplitAdjacentArcs` on a scratch branch, and `LINE_PLACER` does not exist
  // in this tree. It is left absent rather than stubbed so that a caller cannot
  // invoke it and silently get nothing.
}

// ---------------------------------------------------------------------------
// helpers

const vecEqual = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * `GetRuleResolver()->Clearance( aItem, nullptr )` — pns_router.cpp:767, :799,
 * :806, :810.
 *
 * `PnsRuleResolver.clearance` declares its second parameter non-nullable even
 * though `PnsBoardRuleResolver` already accepts null and every upstream call
 * site in this file passes `nullptr`. Widening that shared interface is not
 * this port's to do, so the null is cast in exactly one place.
 */
function clearanceOf(aResolver: PnsRuleResolver | null, aItem: PnsItem): number {
  return aResolver ? aResolver.clearance(aItem, null as unknown as PnsItem) : 0;
}

/**
 * The degenerate probe line `isStartingPointRoutable` collides against —
 * cpp:309-318 and cpp:382-401.
 *
 * Two coincident points, appended with `aAllowDuplication = true` so the second
 * survives: a zero-length two-point chain, which is what gives the line a shape
 * to collide with at all while covering no area.
 */
function makeDummyLine(aP: Vec2, aLayer: number, aNet: NetHandle): PnsLine {
  const chain = new PnsLineChain();
  chain.appendPoint(aP);
  chain.appendPoint(aP, true);

  const line = new PnsLine();
  line.setShape(chain);
  line.setLayer(aLayer);
  line.setNet(aNet);

  return line;
}
