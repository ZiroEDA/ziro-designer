// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board bridge: a `Board` seen as a `PNS::NODE`.
 * Counterparts: `pcbnew/router/pns_kicad_iface.h` and `pns_kicad_iface.cpp`
 * (`PNS_KICAD_IFACE_BASE`, `PNS_KICAD_IFACE`). One class here, `PNS_KICAD_IFACE`:
 * the base's board-facing half and the derived class's view-facing half are
 * not split, because nothing else instantiates the base.
 *
 * `PnsRouterIface` — declared in `pns_router.ts`, which is the specification
 * this file satisfies — is the only thing standing between the router engine
 * and a real design. Everything else in `router/` computes on items that
 * somebody handed it; this is where the items come from and where routed
 * geometry is meant to go back.
 *
 * ## This is not a line-for-line port, and cannot be
 *
 * Upstream is 3293 lines, and roughly a third of them are `KIGFX::VIEW`,
 * `ROUTER_PREVIEW_ITEM` and `BOARD_COMMIT` — a preview layer that draws the
 * head of the route, a hidden-item set that un-hides itself, and an undo
 * transaction. None of those exist here. What is ported is the **sync** half:
 * the mapping from board geometry to `PNS::ITEM`s, plus the accessors the
 * engine calls on every mouse move. The view methods are no-ops and say so at
 * the site; `addItem`/`updateItem`/`removeItem`/`commit` record what a caller
 * asked for without writing to the board, because writing needs the editor's
 * commit machinery and that is a separate change.
 *
 * ## What a `PADSTACK` would have added, and why nothing is missing
 *
 * `syncPad` and `syncVia` upstream are dominated by `PADSTACK::Mode()`: a pad
 * or via may be a different size on every layer, so `ForEachUniqueLayer` can
 * produce several `SOLID`s for one pad. `PcbPad` and `PcbVia` in this tree have
 * no per-layer padstack at all, so every pad and via is upstream's
 * `MODE::NORMAL` — one solid per pad, one diameter per via — and the other two
 * arms of each switch are unreachable rather than dropped.
 *
 * ## Where it disagrees with `pns_obstacles.ts`
 *
 * `boardObstacleHulls` is the older, narrower board→router mapping the shipped
 * Route tool uses. The two now disagree in two places that change routes:
 * net 0 (see {@link PNS_KICAD_IFACE.netHandle}) and non-round pad shapes (see
 * {@link solidShapeForPad}). Both are documented at the site. Nothing here
 * touches that file or the tool that calls it.
 */
import { buildConvexHull } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import { Distance } from '@ziroeda/kimath/src/math/vector2.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { BOARD_STACKUP } from '../board_stackup_manager/board_stackup.js';
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { arcShape, padShapes } from '../drc/drc_engine_view.js';
import { padShapePos } from '../padstack.js';
import { DRC_ENGINE } from '../drc/drc_engine.js';
import { padIsOnLayer } from '../dialogs/dialog_enum_pads.js';
import { enabledCopperLayers, isCopperLayerName } from '../dialogs/dialog_swap_layers.js';
import { padFlashState, viaFlashState } from '../unused_pad_layers.js';
import { PnsArc } from './pns_arc.js';
import { PnsHole } from './pns_hole.js';
import { PnsKind, LineMarker } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PNS_UNDEFINED_LAYER } from './pns_drag_algo.js';
import { PnsSegment } from './pns_segment.js';
import { PnsSolid } from './pns_solid.js';
import { PnsVia } from './pns_via.js';
import type { Shape } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import type { DrcEvalItem, DrcRuleEngine } from '../drc/drc_rules_engine.js';
import type { Board, PcbArcTrack, PcbPad, PcbTrack, PcbVia } from '../types.js';
import { PnsConstraintType } from './pns_node.js';
import type { DpNetPair, PnsRuleResolver } from './pns_node.js';
import type { NetHandle } from './pns_item.js';
import type { PnsItem } from './pns_item.js';
import type { PnsItemSet } from './pns_itemset.js';
import type { PnsLineChain } from './pns_line.js';
import type { PnsNode } from './pns_node.js';
import type { PnsRouterIface, PnsRouterSizes } from './pns_router.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { evalDrcRules } from '../drc/drc_rules_engine.js';
import { itemHull } from './pns_utils.js';
import type { KeepoutResult, PnsConstraint } from './pns_node.js';
import type { DrcConstraintType } from '../drc/drc_rule_view.js';
import type { Hull } from './pns_utils.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { VIEW_GROUP } from '@ziroeda/common/view/view_group.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import {
  SHOW_WHILE_ROUTING,
  SHOW_WITH_VIA_ALWAYS,
  SHOW_WITH_VIA_WHILE_ROUTING,
  SHOW_WITH_VIA_WHILE_ROUTING_OR_DRAGGING,
} from '../pcbnew_settings.js';
import {
  PNS_SEMI_SOLID,
  ROUTER_PREVIEW_ITEM,
  type ROUTER_PREVIEW_IFACE,
} from './router_preview_item.js';

// ---------------------------------------------------------------------------
// Nets

/**
 * `NETINFO_ITEM`, reduced to the two fields `ROUTER_IFACE` reads off one.
 *
 * `PNS::NET_HANDLE` is `void*` and always a `NETINFO_ITEM*`. Identity is the
 * whole point — `ITEM::collideSimple` compares handles, never codes — so this
 * has to be an object interned per net code, not the code itself.
 */
export interface PnsBoardNet {
  code: number;
  name: string;
}

/**
 * `NETINFO_LIST::OrphanedItem()` (`netinfo.h:269`): a process-wide singleton
 * carrying `NETINFO_LIST::UNCONNECTED`, i.e. net code 0, and an empty name.
 *
 * It is deliberately **not** the same object as a board's own net-0 handle,
 * because upstream's `g_orphanedItem` is not the same pointer as
 * `board->FindNet( 0 )`. Code that compares two handles for equality — which
 * is most of the router — must see them as different nets, and it does.
 */
export const PNS_ORPHANED_NET: PnsBoardNet = { code: 0, name: '' };

// ---------------------------------------------------------------------------
// Layer names <-> PNS layer indices

/**
 * `PNS_KICAD_IFACE_BASE::GetPNSLayerFromBoardLayer` (cpp:3056-3068).
 *
 * Upstream is arithmetic on `PCB_LAYER_ID`, where `F_Cu = 0`, `B_Cu = 2` and
 * `In<N>.Cu = (N + 1) * 2`:
 *
 * ```
 * aLayer < 0 -> -1;  F_Cu -> 0;  B_Cu -> count - 1;  else -> (aLayer / 2) - 1
 * ```
 *
 * `(In N).Cu / 2 - 1 == N`, so in this tree's layer *names* the mapping is
 * F.Cu → 0, In<N>.Cu → N, B.Cu → count-1. A name that is not a copper layer
 * has no `PCB_LAYER_ID` to abuse, so it answers −1; upstream would return
 * nonsense there (`F.SilkS` is `PCB_LAYER_ID` 5, giving 1, i.e. In1.Cu) and
 * gets away with it only because every caller guards with `IsKicadCopperLayer`
 * first.
 */
export function pnsLayerFromBoardLayer(aLayer: string, aCopperLayerCount: number): number {
  if (aLayer === 'F.Cu') return 0;
  if (aLayer === 'B.Cu') return aCopperLayerCount - 1;

  const inner = /^In(\d+)\.Cu$/.exec(aLayer);

  return inner ? Number(inner[1]) : -1;
}

/**
 * `PNS_KICAD_IFACE_BASE::GetBoardLayerFromPNSLayer` (cpp:3041-3053).
 *
 * `UNDEFINED_LAYER` becomes the empty string, which `isCopperLayerName` and
 * every consumer here reject — the same role the sentinel plays upstream.
 *
 * Note the order: layer 0 is answered `F.Cu` *before* the `count - 1` test, so
 * a one-layer board's only layer is the front and not the back. Upstream's.
 */
export function boardLayerFromPnsLayer(aLayer: number, aCopperLayerCount: number): string {
  if (aLayer < 0 || aLayer >= aCopperLayerCount) return '';
  if (aLayer === 0) return 'F.Cu';
  if (aLayer === aCopperLayerCount - 1) return 'B.Cu';

  return `In${aLayer}.Cu`;
}

// ---------------------------------------------------------------------------
// Pad geometry

/** How finely a curved sub-shape is sampled when a multi-shape pad is hulled. */
const HULL_SAMPLES = 16;

/** Points that cover a shape, for the convex hull of a multi-shape pad. */
function shapeSamplePoints(aShape: Shape, aOut: Vec2[]): void {
  const circle = (c: Vec2, r: number): void => {
    for (let i = 0; i < HULL_SAMPLES; i++) {
      const a = (2 * Math.PI * i) / HULL_SAMPLES;
      aOut.push({ x: Math.round(c.x + r * Math.cos(a)), y: Math.round(c.y + r * Math.sin(a)) });
    }
  };

  switch (aShape.kind) {
    case 'circle':
      circle(aShape.c, aShape.r);
      break;

    case 'stadium':
      circle(aShape.a, aShape.r);
      circle(aShape.b, aShape.r);
      break;

    case 'arc': {
      for (let i = 0; i <= HULL_SAMPLES; i++) {
        const a = aShape.a0 + (aShape.sweep * i) / HULL_SAMPLES;
        circle(
          {
            x: Math.round(aShape.c.x + aShape.rad * Math.cos(a)),
            y: Math.round(aShape.c.y + aShape.rad * Math.sin(a)),
          },
          aShape.r,
        );
      }
      break;
    }

    case 'poly':
      if (aShape.r > 0) for (const p of aShape.pts) circle(p, aShape.r);
      else for (const p of aShape.pts) aOut.push({ x: p.x, y: p.y });
      break;
  }
}

/**
 * The one `SHAPE` a `SOLID` gets for a pad — `syncPad`'s tail (cpp:1712-1735).
 *
 * Upstream: if the effective shape has exactly one indexable subshape, clone
 * it; otherwise fall back to `GetEffectivePolygon( aLayer, ERROR_OUTSIDE )` and
 * take outline 0, with the comment that *"Multiple shapes have a tendency to
 * confuse the hull generator"* (kicad #15553).
 *
 * `padShapes` is this tree's `GetEffectiveShape`, and it returns more than one
 * shape for exactly the two cases upstream's polygon fallback exists for: a
 * chamfered round-rect (a polygon plus one circle per rounded corner) and a
 * custom pad (an anchor plus its primitives). There is no polygon union here,
 * so the fallback is the **convex hull** of the constituents.
 *
 * That is an over-approximation where upstream's outline is exact, so a route
 * near a concave custom pad is held slightly further off than KiCad would hold
 * it. It is still far tighter than `boardObstacleHulls`, which wraps *every*
 * non-round pad in an axis-aligned bounding box — a 45°-rotated rectangular pad
 * blocks its whole diagonal square there and only its own outline here.
 *
 * Null when the pad has no geometry at all, which is upstream's
 * `if( !solid->Shape( 0 ) ) return;` — the solid is dropped, not added shapeless.
 *
 * ## Why not `ITEM::shapes()`
 *
 * `pns_item.ts` grew `shapes( aLayer )` with the line-vs-line collide fix
 * (#494), and a `SOLID` overriding it could carry the constituents unreduced.
 * It deliberately does not: upstream's `SOLID` holds a single `m_shape`, and
 * `syncPad`'s whole tail exists to pick *one* — the indexable subshape when
 * there is exactly one, the polygon outline otherwise. Handing the router
 * several shapes for one pad would diverge from that, not complete it. The hull
 * is the reduction; `shapes()` is not the hook here.
 */
export function solidShapeForPad(aPad: PcbPad): Shape | null {
  const shapes = padShapes(aPad);

  if (shapes.length === 0) return null;

  // MUTATION SURVIVOR: dropping this line — i.e. always returning `shapes[0]`
  // and never hulling — is not caught. `padShapes` puts the polygon first for
  // both multi-shape cases, so the first primitive is a `poly` of roughly the
  // right extent and the test's assertions (kind, non-zero extent, `r === 0`)
  // hold for it too. Distinguishing them needs a pad whose later primitives
  // stick out past the first — a custom pad with an off-anchor primitive — and
  // an assertion that a point inside that primitive is inside the result.
  if (shapes.length === 1) return shapes[0] as Shape;

  const pts: Vec2[] = [];
  for (const s of shapes) shapeSamplePoints(s, pts);

  if (pts.length < 3) return null;

  return { kind: 'poly', pts: buildConvexHull(pts), r: 0 };
}

/**
 * `PAD::GetEffectiveHoleShape()`. A round drill is a circle; an oblong one is
 * the stadium swept by a disc of the short radius along the long axis, which is
 * upstream's `SHAPE_SEGMENT`.
 *
 * The drill offset is not applied here, and that is upstream's own geometry:
 * `GetEffectiveHoleShape` builds the segment from `m_pos`. It is the pad's
 * COPPER that `(drill … (offset …))` moves, which `padShapePos` does for
 * `padShapes`.
 */
export function padHoleShape(aPad: PcbPad): Shape | null {
  const drill = aPad.drill;

  if (!drill || drill.w <= 0) return null;

  const h = drill.oblong && drill.h > 0 ? drill.h : drill.w;
  const r = Math.min(drill.w, h) / 2;
  const half = (Math.max(drill.w, h) - Math.min(drill.w, h)) / 2;

  if (half === 0) return { kind: 'circle', c: { ...aPad.at }, r };

  const a = (aPad.angle * Math.PI) / 180;
  const d =
    drill.w >= h
      ? { x: half * Math.cos(a), y: half * Math.sin(a) }
      : { x: -half * Math.sin(a), y: half * Math.cos(a) };

  return {
    kind: 'stadium',
    a: { x: Math.round(aPad.at.x - d.x), y: Math.round(aPad.at.y - d.y) },
    b: { x: Math.round(aPad.at.x + d.x), y: Math.round(aPad.at.y + d.y) },
    r,
  };
}

// ---------------------------------------------------------------------------
// The interface

/** What a host can tell the bridge that the `Board` itself does not carry. */
export interface PNS_KICAD_IFACE_DEPS {
  /** `BOARD_DESIGN_SETTINGS::m_DRCEngine` — the compiled custom rules. */
  ruleEngine?: DrcRuleEngine | null;
  /** Every netclass a net belongs to, for the rule resolver's conditions. */
  netClassesOf?: (aNet: number) => readonly string[];
  /** `BOARD::GetMaxClearanceValue()`, the seed for `NODE::SetMaxClearance`. */
  maxClearance?: number;
  /**
   * `KIGFX::VIEW::IsLayerVisible`. Absent means everything is visible, which is
   * **not** upstream's no-view answer for `IsAnyLayerVisible` — see
   * {@link PNS_KICAD_IFACE.isAnyLayerVisible}.
   */
  isLayerVisible?: (aBoardLayer: string) => boolean;
  /** `KIGFX::VIEW::IsVisible( BOARD_ITEM* )`. Absent means visible. */
  isItemVisible?: (aItem: PnsItem) => boolean;
  /**
   * Called at each end-of-transaction boundary with the batch being closed,
   * just before it is dropped — upstream's `BOARD_COMMIT::Push()`.
   *
   * A hook rather than a return value because {@link PNS_KICAD_IFACE.commit} is
   * called by `ROUTER::CommitRouting` itself, from inside the placer's own
   * commit, with no caller of ours on the stack to hand anything back to.
   * Without it the changes the router decided on were recorded and then thrown
   * away, which is exactly how far the port had got: everything up to the
   * boundary, and nothing across it.
   */
  onCommit?: (aChanges: readonly PnsPendingChange[]) => void;
  /**
   * `BOARD_DESIGN_SETTINGS`, as `ImportSizes` reads it. Absent is upstream's
   * `if( !m_board )` early-out: {@link PNS_KICAD_IFACE.importSizes} returns false
   * and the caller's sizes are left alone.
   */
  designSettings?: PnsDesignSettings | null;
  /**
   * `PNS_KICAD_IFACE::SetView( KIGFX::VIEW* )`: with a view the interface owns a
   * `VIEW_GROUP` on `LAYER_SELECT_OVERLAY` and `DisplayItem` puts a
   * `ROUTER_PREVIEW_ITEM` in it. Without one the preview calls do nothing.
   */
  view?: VIEW | null;
  /** `PCBNEW_SETTINGS::m_Display.m_TrackClearance`, read on every `DisplayItem`. */
  trackClearanceMode?: () => number;
}

/**
 * The `BOARD_DESIGN_SETTINGS` members `ImportSizes` reads, in IU.
 *
 * The four minimums, the two "inherit the width from the track I started on"
 * flags, and the whole size-selection block from
 * `board_design_settings_sizes.ts` — which is Board Setup > Pre-defined Sizes
 * plus the toolbar's choice.
 */
export interface PnsDesignSettings {
  /** `m_MinClearance`. */
  minClearance: number;
  /** `m_TrackMinWidth`. */
  trackMinWidth: number;
  /** `m_ViasMinSize`. */
  viasMinSize: number;
  /** `m_MinThroughDrill`. */
  minThroughDrill: number;
  /** `m_HoleToHoleMin`. */
  holeToHoleMin: number;
  /** `m_UseConnectedTrackWidth` — the "Use Existing Track Width" toggle. */
  useConnectedTrackWidth: boolean;
  /**
   * `m_TempOverrideTrackWidth`, set for one route when the user cycles the
   * width while `m_UseConnectedTrackWidth` is on
   * (`board_editor_control.cpp:1108-1112`).
   */
  tempOverrideTrackWidth: boolean;
  /** The real BOARD_DESIGN_SETTINGS: the indices, the overrides and the lists. */
  sizes: BOARD_DESIGN_SETTINGS;
  /**
   * `PNS_KICAD_IFACE_BASE::inheritTrackWidth` — the width of the track the
   * route starts on, or null when the start item carries none. A hook because
   * `inherit_track_width.ts` works on `Board` items and the router works on
   * `PNS::ITEM`s; the caller owns that translation.
   */
  inheritTrackWidth?: (aStartItem: PnsItem, aStartPosition: Vec2) => number | null;
  /**
   * `m_UseHeightForLengthCalcs` — Board Setup > Constraints' "Include stackup
   * height in track length calculations". False is upstream's own early return
   * from `StackupHeight`, not a stub.
   */
  useHeightForLengthCalcs?: boolean;
  /** `GetDesignSettings().GetStackupDescriptor()`, the live one. */
  stackup?: BOARD_STACKUP;
}

/** One board mutation the router asked for, held rather than applied. */
export interface PnsPendingChange {
  kind: 'add' | 'update' | 'remove';
  item: PnsItem;
}

/**
 * `PNS_KICAD_IFACE_BASE` + the parts of `PNS_KICAD_IFACE` that are not a
 * `KIGFX::VIEW`.
 *
 * Also its own {@link PnsResolverHost}, because upstream's
 * `PNS_PCBNEW_RULE_RESOLVER` is constructed with `( m_board, this )` and reads
 * the board through the interface for exactly the things this class already
 * knows — layer conversion, net codes, net names.
 */
export class PNS_KICAD_IFACE implements PnsRouterIface, PnsResolverHost, ROUTER_PREVIEW_IFACE {
  private readonly mBoard: Board;
  private readonly mDeps: PNS_KICAD_IFACE_DEPS;
  private readonly mCopperLayers: string[];
  private readonly mNets = new Map<number, PnsBoardNet>();

  /** Every pad a `SOLID` was built from, by the board object it points at. */
  private readonly mPads = new WeakMap<object, PcbPad>();

  private mWorld: PnsNode | null = null;
  private mRuleResolver: PNS_PCBNEW_RULE_RESOLVER | null = null;
  private mPending: PnsPendingChange[] = [];

  constructor(aBoard: Board, aDeps: PNS_KICAD_IFACE_DEPS = {}) {
    this.mBoard = aBoard;
    this.mDeps = aDeps;
    this.mCopperLayers = enabledCopperLayers(aBoard);
    if (aDeps.view) this.SetView(aDeps.view);
  }

  /** `m_view` and `m_previewItems`. */
  private mView: VIEW | null = null;
  private mPreviewItems: VIEW_GROUP | null = null;
  /** `m_hiddenItems`: what `HideItem` made invisible. */
  private readonly mHiddenItems = new Set<VIEW_ITEM>();

  /**
   * `PNS_KICAD_IFACE::SetView` (cpp:2968): the group the router's previews go
   * in, added to the view on `LAYER_SELECT_OVERLAY`.
   */
  SetView(aView: VIEW | null): void {
    this.Dispose();
    this.mView = aView;
    this.mPreviewItems = new VIEW_GROUP(aView);
    this.mPreviewItems.SetLayer(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);

    if (aView) aView.Add(this.mPreviewItems);
  }

  /** `~PNS_KICAD_IFACE`: free the preview items and take the group off the view. */
  Dispose(): void {
    if (this.mView) {
      for (const item of this.mHiddenItems) this.mView.SetVisible(item, true);
      this.mHiddenItems.clear();
    }

    if (this.mPreviewItems) {
      this.mPreviewItems.FreeItems();
      this.mView?.Remove(this.mPreviewItems);
    }

    this.mPreviewItems = null;
    this.mView = null;
  }

  /** The group `DisplayItem` fills; null without a view. */
  GetPreviewItems(): VIEW_GROUP | null {
    return this.mPreviewItems;
  }

  // ROUTER_PREVIEW_IFACE.
  GetBoardLayerFromPNSLayer(aPnsLayer: number): number {
    return LSET_NameToLayer(this.getBoardLayerFromPnsLayer(aPnsLayer));
  }

  GetNetCode(aNet: unknown): number {
    return this.getNetCode(aNet as NetHandle);
  }

  board(): Board {
    return this.mBoard;
  }

  /** `BOARD::GetCopperLayerCount()`. */
  copperLayerCount(): number {
    return this.mCopperLayers.length;
  }

  // ----- nets ----------------------------------------------------------------

  /**
   * `BOARD_CONNECTED_ITEM::GetNet()`: one interned handle per net code.
   *
   * **Net code 0 gets a handle too, and that is the point.** In KiCad every
   * unconnected copper item points at the same `NETINFO_ITEM`
   * (`NETINFO_LIST::UNCONNECTED == 0`, `netinfo_list.cpp:315`) and that pointer
   * is non-null, so `ITEM::collideSimple`'s same-net exemption —
   * `Net() == aHead->Net() && aHead->Net()` — fires between two pieces of
   * unconnected copper.
   *
   * `boardObstacleHulls` does the opposite on purpose (its `foreign()` reads
   * net 0 as never-same-net) and argues at its own site that the alternative
   * lets a route run through copper. Both cannot be upstream, and upstream is
   * this one. The consequence is real: rewiring the Route tool onto this bridge
   * changes which obstacles unconnected copper presents, which is why that is a
   * separate change with a human looking at the routes.
   */
  netHandle(aNetCode: number | undefined): NetHandle {
    const code = aNetCode ?? 0;
    const existing = this.mNets.get(code);

    if (existing) return existing;

    const net: PnsBoardNet = { code, name: this.mBoard.nets.get(code) ?? '' };
    this.mNets.set(code, net);

    return net;
  }

  /** `PNS_KICAD_IFACE::GetNetCode` (cpp:2998-3004). A null handle is −1. */
  getNetCode(aNet: NetHandle): number {
    return aNet ? (aNet as PnsBoardNet).code : -1;
  }

  /** `PNS_KICAD_IFACE::GetNetName` (cpp:3007-3013). */
  getNetName(aNet: NetHandle): string {
    return aNet ? (aNet as PnsBoardNet).name : '';
  }

  /**
   * `PNS_KICAD_IFACE::UpdateNet` (cpp:3016-3019).
   *
   * Upstream's whole body is a `wxLogTrace`. The ratsnest is *not* recomputed
   * here — `BOARD_COMMIT` does that when the route is pushed — so a no-op is
   * the port, not a stub.
   */
  updateNet(_aNet: NetHandle): void {
    // Intentionally empty; see the doc comment.
  }

  /** `PNS_KICAD_IFACE_BASE::GetOrphanedNetHandle` (cpp:3022-3025). */
  getOrphanedNetHandle(): NetHandle {
    return PNS_ORPHANED_NET;
  }

  // ----- layers --------------------------------------------------------------

  getBoardLayerFromPnsLayer(aLayer: number): string {
    return boardLayerFromPnsLayer(aLayer, this.mCopperLayers.length);
  }

  getPnsLayerFromBoardLayer(aLayer: string): number {
    return pnsLayerFromBoardLayer(aLayer, this.mCopperLayers.length);
  }

  /**
   * `IsPNSCopperLayer` (cpp:2138-2141), written as upstream writes it: convert
   * to a board layer and ask whether *that* is copper. The out-of-stack
   * rejection therefore lives in one place, the conversion, rather than being
   * duplicated as a range test that could drift from it.
   */
  isPnsCopperLayer(aPnsLayer: number): boolean {
    return isCopperLayerName(this.getBoardLayerFromPnsLayer(aPnsLayer));
  }

  /**
   * `PNS_KICAD_IFACE::IsAnyLayerVisible` (cpp:2150-2162).
   *
   * Upstream returns **false** when there is no `VIEW`. Reproducing that would
   * make `TOOL_BASE::pickSingleItem` reject every candidate in a headless
   * build, since its third rejection is exactly this call. The no-view answer
   * is therefore "visible", and a host that has a view injects the predicate.
   */
  isAnyLayerVisible(aLayer: PnsLayerRange): boolean {
    const visible = this.mDeps.isLayerVisible;

    if (!visible) return true;

    for (let i = aLayer.start(); i <= aLayer.end(); i++) {
      if (visible(this.getBoardLayerFromPnsLayer(i))) return true;
    }

    return false;
  }

  /**
   * `PNS_KICAD_IFACE::IsItemVisible` (cpp:2255-2283).
   *
   * Upstream's first line is the one that survives here: an item with no
   * `BOARD_ITEM` parent has not been committed to the board yet and is always
   * visible. The rest is high-contrast mode, level-of-detail and the hidden-item
   * set, all `VIEW`.
   */
  isItemVisible(aItem: PnsItem): boolean {
    if (!aItem.parent()) return true;

    return this.mDeps.isItemVisible?.(aItem) ?? true;
  }

  /**
   * Both `IsFlashedOnLayer` overloads (cpp:2164-2255), collapsed onto one
   * method as `PnsRouterIface` declares it.
   *
   * The single-layer form short-circuits `aLayer < 0` to true ("default is all
   * layers"); the range form has no such escape and instead intersects the
   * item's own span with the range first, so an empty intersection is false.
   *
   * `padFlashState` / `viaFlashState` answer `'if-connected'` where upstream
   * consults `CONNECTIVITY_DATA::IsConnectedOnLayer`. There is no connectivity
   * graph here, so it reads as flashed — which is precisely
   * `PAD::CanFlashLayer`, upstream's own "may this layer be there?" reading,
   * and errs towards more copper rather than less.
   */
  isFlashedOnLayer(aItem: PnsItem, aLayer: number | PnsLayerRange): boolean {
    if (typeof aLayer === 'number') {
      if (aLayer < 0) return true;

      const flashes = this.parentFlashes(aItem, aLayer);
      if (flashes !== null) return flashes;

      if (aItem.kind() === PnsKind.VIA_T) return (aItem as PnsVia).connectsLayer(aLayer);

      return aItem.layers().overlaps(aLayer);
    }

    const test = aItem.layers().intersection(aLayer);
    const parent = aItem.parent();

    if (parent && (this.mPads.has(parent) || isBoardVia(parent))) {
      for (let layer = test.start(); layer <= test.end(); layer++) {
        if (this.parentFlashes(aItem, layer) === true) return true;
      }

      return false;
    }

    if (aItem.kind() === PnsKind.VIA_T) {
      const via = aItem as PnsVia;

      for (let layer = test.start(); layer <= test.end(); layer++) {
        if (via.connectsLayer(layer)) return true;
      }

      return false;
    }

    return test.start() <= test.end();
  }

  /**
   * `PAD::FlashLayer` / `PCB_VIA::FlashLayer` on the item's parent, or null
   * when the parent is neither — which is upstream's `default: break` falling
   * out of the switch into the via/layers tests below it.
   */
  private parentFlashes(aItem: PnsItem, aPnsLayer: number): boolean | null {
    const parent = aItem.parent();

    if (!parent) return null;

    const boardLayer = this.getBoardLayerFromPnsLayer(aPnsLayer);

    if (boardLayer === '') return null;

    const pad = this.mPads.get(parent);

    if (pad) return padFlashState(pad, boardLayer) !== 'removed';

    if (isBoardVia(parent)) {
      return viaFlashState(this.mBoard, parent as PcbVia, boardLayer) !== 'removed';
    }

    return null;
  }

  // ----- the world -----------------------------------------------------------

  /** `PNS_KICAD_IFACE_BASE::GetWorld()` — the node the last sync filled. */
  getWorld(): PnsNode | null {
    return this.mWorld;
  }

  /** `PNS_KICAD_IFACE_BASE::GetRuleResolver()` (cpp:3028-3031). Null before a sync. */
  getRuleResolver(): PnsRuleResolver | null {
    return this.mRuleResolver;
  }

  /**
   * `PNS_KICAD_IFACE_BASE::SyncWorld` (cpp:2289-2449).
   *
   * Upstream's order is drawings, zones, footprints (pads, then text, then
   * footprint zones, then graphics), then tracks/arcs/vias, then a **fresh**
   * rule resolver and `SetMaxClearance( worst + epsilon )`.
   *
   * Ported: pads, tracks, arcs, vias — the four item kinds this tree's `Board`
   * can produce copper from — plus the castellation edge exclusions and the
   * resolver. Left out, each because the geometry it needs is not in this tree:
   *
   *  - **`syncZone`** (cpp:1891-1951) syncs *rule areas only*, never filled
   *    copper, and syncs each as one `SOLID` **per triangle** of the outline's
   *    triangulation. There is no triangulator here, and approximating a
   *    keepout by its convex hull would block copper the keepout allows —
   *    wrong in the direction that silently refuses legal routes.
   *  - **`syncTextItem`** / **`syncGraphicalItem`** / **`syncDimension`** /
   *    **`syncBarcode`** all need `TransformShapeToPolygon` over stroked glyphs
   *    and graphics.
   *
   * The consequence is recorded at {@link startPointUnroutableReason}: two of
   * upstream's three unroutable classifications can never be reached, because
   * no item in this node carries a zone or a text as its parent.
   *
   * Note that the resolver is rebuilt on every sync. Upstream's comment at
   * cpp:2442 — *"if this were ever to become a long-lived object we would need
   * to dirty its clearance cache here"* — is the reason, and it holds here too:
   * `PNS_PCBNEW_RULE_RESOLVER` caches clearances by item identity.
   */
  syncWorld(aNode: PnsNode): void {
    let worstClearance = this.mDeps.maxClearance ?? 0;

    this.mWorld = aNode;

    for (const fp of this.mBoard.footprints) {
      for (const pad of fp.pads) {
        const solid = this.syncPad(pad);

        if (solid) aNode.addSolid(solid);

        if (pad.localClearance !== undefined) {
          worstClearance = Math.max(worstClearance, pad.localClearance);
        }

        // cpp:2365-2370: a castellated pad's hole is a board-edge exclusion, so
        // copper is allowed to run right up to it.
        if (pad.padProperty === 'pad_prop_castellated') {
          const hole = padHoleShape(pad);
          if (hole) aNode.addEdgeExclusion(hole);
        }
      }
    }

    for (const track of this.mBoard.tracks) {
      const segment = this.syncTrack(track);

      // cpp:2428 — `Add( segment, /*aAllowRedundant=*/true )`. A board may hold
      // two identical tracks and upstream keeps both; the redundancy check
      // exists for the router's own output, not for what it was handed.
      if (segment) aNode.addSegment(segment, true);
    }

    for (const arc of this.mBoard.arcs) {
      const item = this.syncArc(arc);

      if (item) aNode.addArc(item, true);
    }

    for (const via of this.mBoard.vias) {
      const item = this.syncVia(via);

      if (item) aNode.addVia(item);
    }

    this.mRuleResolver = new PNS_PCBNEW_RULE_RESOLVER(this);

    aNode.setRuleResolver(this.mRuleResolver);
    aNode.setMaxClearance(worstClearance + this.mRuleResolver.clearanceEpsilon());
  }

  /**
   * `PNS_KICAD_IFACE_BASE::syncPad` (cpp:1615-1743), for a board with no
   * per-layer padstacks.
   *
   * Upstream opens with `PNS_LAYER_RANGE layers( 0, copperCount - 1 )` and the
   * pad's copper stack, then:
   *
   * ```
   * if( lmsk.empty() && drill.x == 0 )  return {};   // not copper, no hole
   * PTH / NPTH : layers stays the whole stack
   * SMD / CONN : lmsk empty ? return {}
   *                         : layers = ( front, front )
   * default    : return {};
   * ```
   *
   * A through-hole pad therefore spans **every** copper layer whatever its
   * `(layers …)` says — the layer-specific truth is left to `IsFlashedOnLayer`,
   * with upstream's comment: *"We generate a single SOLID for a pad, so we have
   * to treat it as ALWAYS_FLASHED and then perform layer-specific flashing
   * tests internally."*
   *
   * The setter order below is upstream's and is load-bearing: `SOLID::SetPos`
   * **moves** the shape and the hole by the delta, so it must run while both
   * are still null. Moving it after `SetShape` would translate every pad by its
   * own position.
   */
  syncPad(aPad: PcbPad): PnsSolid | null {
    const count = this.mCopperLayers.length;
    const cuStack = this.mCopperLayers.filter((layer) => padIsOnLayer(aPad, layer));
    const hasDrill = (aPad.drill?.w ?? 0) > 0;

    if (cuStack.length === 0 && !hasDrill) return null;

    let layers = new PnsLayerRange(0, count - 1);

    if (aPad.type === 'smd' || aPad.type === 'connect') {
      if (cuStack.length === 0) return null;

      const front = this.getPnsLayerFromBoardLayer(cuStack[0] as string);
      layers = new PnsLayerRange(front, front);
    } else if (aPad.type !== 'thru_hole' && aPad.type !== 'np_thru_hole') {
      // Upstream's `default:` arm — an attribute the router does not know.
      return null;
    }

    const shape = solidShapeForPad(aPad);

    // cpp:1734 — `if( !solid->Shape( 0 ) ) return;`. A pad with no geometry is
    // dropped rather than added shapeless.
    if (!shape) return null;

    const solid = new PnsSolid();

    if (aPad.type === 'np_thru_hole') solid.setRoutable(false);

    solid.setLayers(layers);
    solid.setNet(this.netHandle(aPad.net));
    solid.setParent(asBoardItem(aPad));
    solid.setPadToDie(aPad.padToDieLength ?? 0);
    solid.setOrientation(new EDA_ANGLE(aPad.angle));

    // "solid->SetPos( c - offset ); solid->SetOffset( offset )" with
    // `c = aPad->ShapePos( aLayer )`, so the position is the pad's own — the
    // hole — and the offset is `GetOffset` turned by the orientation. The shape
    // above is absolute and already carries it (`padShapes` centres on
    // `ShapePos`); the offset is what tells the optimizer to leave an offset
    // pad's breakout alone.
    const shapePos = padShapePos(aPad);
    solid.setPos(aPad.at);
    solid.setOffset({ x: shapePos.x - aPad.at.x, y: shapePos.y - aPad.at.y });

    const holeShape = padHoleShape(aPad);

    if (holeShape) {
      solid.setHole(new PnsHole(holeShape));
      // cpp:1707 — the hole spans the whole board, not the pad's own layers,
      // and this assignment has to follow `SetHole`, which forces the hole onto
      // the solid's layers.
      //
      // MUTATION SURVIVOR: replacing the range with `layers` is not caught,
      // and is very nearly an equivalent mutant. A through-hole pad already
      // *has* `layers === (0, count - 1)` two dozen lines above, and a
      // through-hole pad is the only kind this tree normally drills. The one
      // input that separates them is an SMD or connector pad carrying a drill,
      // which the file format permits and no fixture contains.
      solid.hole()?.setLayers(new PnsLayerRange(0, count - 1));
    }

    solid.setShape(shape);

    this.mPads.set(aPad, aPad);

    return solid;
  }

  /** `PNS_KICAD_IFACE_BASE::syncTrack` (cpp:1746-1764). */
  syncTrack(aTrack: PcbTrack): PnsSegment | null {
    const layer = this.getPnsLayerFromBoardLayer(aTrack.layer);

    // No upstream counterpart: every `PCB_TRACE_T` is on copper by
    // construction, so `GetPNSLayerFromBoardLayer` is never asked about a silk
    // layer there. A parsed file can carry one, and an item with layer −1 would
    // sit in the index with a span that overlaps nothing.
    if (layer < 0) return null;

    const segment = new PnsSegment(
      { seg: { a: { ...aTrack.start }, b: { ...aTrack.end } }, width: aTrack.width },
      this.netHandle(aTrack.net),
    );

    segment.setWidth(aTrack.width);
    segment.setLayer(layer);
    segment.setParent(aTrack);

    if (aTrack.locked) segment.mark(LineMarker.MK_LOCKED);

    return segment;
  }

  /** `PNS_KICAD_IFACE_BASE::syncArc` (cpp:1767-1785). */
  syncArc(aArc: PcbArcTrack): PnsArc | null {
    const layer = this.getPnsLayerFromBoardLayer(aArc.layer);

    if (layer < 0) return null;

    const arc = new PnsArc(
      {
        p0: { ...aArc.start },
        arcMid: { ...aArc.mid },
        p1: { ...aArc.end },
        width: aArc.width,
      },
      this.netHandle(aArc.net),
    );

    arc.setLayer(layer);
    arc.setParent(aArc);

    if (aArc.locked) arc.mark(LineMarker.MK_LOCKED);

    return arc;
  }

  /**
   * `PNS_KICAD_IFACE_BASE::syncVia` (cpp:1788-1888).
   *
   * The `PADSTACK::MODE` switch collapses to its `NORMAL` arm —
   * `SetDiameter( 0, GetWidth( ALL_LAYERS ) )` — because `PcbVia` carries one
   * size. Upstream's long comment on why `FRONT_INNER_BACK` cannot be used for
   * a blind or buried via is therefore moot here, and the two padstack arms are
   * unreachable rather than dropped.
   *
   * `SetLayersFromPCBNew( top, bottom )` (cpp:3165) maps both ends and lets
   * `PNS_LAYER_RANGE`'s constructor sort them, so a `(layers "B.Cu" "F.Cu")`
   * pair still gives `(0, n-1)`.
   */
  syncVia(aVia: PcbVia): PnsVia | null {
    const top = this.getPnsLayerFromBoardLayer(aVia.layers[0]);
    const bottom = this.getPnsLayerFromBoardLayer(aVia.layers[1]);

    // Same guard as syncTrack, and with no upstream counterpart for the same
    // reason.
    if (top < 0 || bottom < 0) return null;

    const layers = new PnsLayerRange(top, bottom);
    const via = new PnsVia(
      { ...aVia.at },
      layers,
      0,
      aVia.drill,
      this.netHandle(aVia.net),
      aVia.kind,
    );

    via.setUnconnectedLayerMode(aVia.unconnectedLayerMode ?? 'keep_all');
    via.setDiameter(0, aVia.size);
    via.setParent(asBoardItem(aVia));

    if (aVia.locked) via.mark(LineMarker.MK_LOCKED);

    via.setIsFree(false);
    via.setHole(
      PnsHole.makeCircularHole({ ...aVia.at }, Math.trunc(aVia.drill / 2), layers.clone()),
    );
    via.setHoleLayers(layers.clone());
    via.setSecondaryDrill(null);
    via.setSecondaryHoleLayers(null);

    return via;
  }

  // ----- routability ---------------------------------------------------------

  /**
   * The `switch( parent->Type() )` at `pns_router.cpp:257-295`, pushed behind
   * the interface because `PnsBoardItem` is `{ layer?: string }` and carries no
   * type.
   *
   * Upstream classifies three parents: an NPTH pad, a rule area with keepout
   * parameters (named or not), and a text/textbox/field. **Only the first is
   * reachable here**, because {@link syncWorld} does not sync zones or text —
   * so no item in the node can carry either as a parent, and the two missing
   * arms are unreachable rather than silently wrong. When `syncZone` lands, the
   * zone arm belongs here and nothing else moves.
   *
   * `null` is upstream's `default:` — no objection.
   */
  startPointUnroutableReason(aItem: PnsItem): string | null {
    const parent = aItem.parent();

    if (!parent) return null;

    const pad = this.mPads.get(parent);

    if (pad && pad.type === 'np_thru_hole') {
      return 'Cannot start routing from a non-plated hole.';
    }

    return null;
  }

  // ----- sizes and the stackup -----------------------------------------------

  /**
   * `PNS_KICAD_IFACE_BASE::StackupHeight` (cpp:1330-1339).
   *
   *     if( !m_board || !bds.m_UseHeightForLengthCalcs )
   *         return 0;
   *     return stackup.GetLayerDistance( board layer a, board layer b );
   *
   * Both early returns are upstream's, so a board whose Constraints page leaves
   * "Include stackup height in track length calculations" unticked really does
   * answer 0 — that is the setting doing its job, not the port giving up.
   *
   * The stackup is the live `BOARD_STACKUP`, passed in with the design
   * settings because the interface still sees the board through `Board`.
   */
  stackupHeight(aFirstLayer: number, aSecondLayer: number): number {
    const ds = this.mDeps.designSettings;

    // `if( !m_board || !m_board->GetDesignSettings().m_UseHeightForLengthCalcs )`
    if (!ds?.useHeightForLengthCalcs || !ds.stackup) return 0;

    const first = this.boardLayer(aFirstLayer);
    const second = this.boardLayer(aSecondLayer);

    if (!first || !second) return 0;

    return ds.stackup.GetLayerDistance(LSET.NameToLayer(first), LSET.NameToLayer(second));
  }

  /**
   * `PNS_KICAD_IFACE_BASE::ImportSizes` (`pns_kicad_iface.cpp:1098-1301`), the
   * one call that turns Board Setup into the numbers the router places copper
   * with. `ROUTER_TOOL` makes it before `StartRouting` and again on a size
   * change; `ROUTER` never does.
   *
   * The shape of it is the same three times over — track width, via, diff pair
   * — and it is worth stating once:
   *
   *  1. seed from the board's own MINIMUM (`m_TrackMinWidth`, `m_ViasMinSize`,
   *     `m_MinThroughDrill`, `m_MinClearance`);
   *  2. if the user is on "use netclass" for that dimension AND there is a
   *     start item to evaluate against, ask the rule engine and take
   *     `std::max( minimum, constraint.Opt() )`;
   *  3. otherwise take `GetCurrent…()`, which is the toolbar's preset, the
   *     custom value, or the netclass default — and STILL clamp it up to the
   *     board minimum for the track width, but NOT for the via, where upstream
   *     assigns `GetCurrentViaSize()` outright.
   *
   * That last asymmetry is upstream's and is kept.
   *
   * Absent by design: `SetClearance`, `SetClearanceSource` and the four
   * `Set…Source` strings. `SIZES_SETTINGS` carries them and `ROUTER_TOOL`'s
   * status bar reads them; {@link PnsRouterSizes} is the reduced shape `ROUTER`
   * itself reads, and a field nothing reads is a field nothing can pin. They
   * belong with the tool that displays them.
   *
   * Returns false with no design settings, which is upstream's `if( !m_board )`
   * early-out: the caller's sizes are left as they were.
   */
  /** Whether {@link PNS_KICAD_IFACE.importSizes} has a BOARD_DESIGN_SETTINGS to read. */
  get importSizesEnabled(): boolean {
    return this.mDeps.designSettings != null;
  }

  importSizes(
    aSizes: PnsRouterSizes,
    aStartItem: PnsItem | null,
    _aNet: NetHandle,
    aStartPosition: Vec2,
  ): boolean {
    const ds = this.mDeps.designSettings;

    if (!ds) return false;

    const resolver = this.mRuleResolver;

    aSizes.minClearance = ds.minClearance;
    aSizes.clearance = ds.minClearance;
    aSizes.clearanceSource = 'board minimum clearance';

    // `startAnchor`: which end of a segment the pointer is nearer, so the dummy
    // track below sits where the user actually started.
    let startAnchor = 0;

    if (aStartItem && aStartItem.kind() === PnsKind.SEGMENT_T) {
      const d0 = Distance(aStartPosition, aStartItem.anchor(0));
      const d1 = Distance(aStartPosition, aStartItem.anchor(1));

      if (d1 < d0) startAnchor = 1;
    }

    const startLayer = aStartItem ? aStartItem.layer() : 0;

    /** `PNS::SEGMENT dummyTrack` on the start anchor, for the rule engine. */
    const dummyTrack = (aNet: NetHandle, aAnchor = startAnchor): PnsSegment => {
      const p = aStartItem ? aStartItem.anchor(aAnchor) : { x: 0, y: 0 };
      const seg = new PnsSegment({ a: p, b: p }, aNet);
      seg.setLayer(startLayer);
      return seg;
    };

    const optOf = (
      aType: PnsConstraintType,
      aA: PnsItem,
      aB: PnsItem | null,
      aLayer: number,
    ): number | null => {
      const c = resolver?.queryConstraint(aType, aA, aB, aLayer) ?? null;
      return c?.value.opt ?? null;
    };

    // ----- track width -----------------------------------------------------
    let trackWidth = ds.trackMinWidth;
    let found = false;

    aSizes.widthSource = 'board minimum track width';

    // `if( bds.m_UseConnectedTrackWidth && !bds.m_TempOverrideTrackWidth && aStartItem )`
    if (ds.useConnectedTrackWidth && !ds.tempOverrideTrackWidth && aStartItem) {
      const inherited = ds.inheritTrackWidth?.(aStartItem, aStartPosition) ?? null;

      if (inherited !== null) {
        trackWidth = inherited;
        found = true;
        aSizes.widthSource = 'existing track';
      }
    }

    if (!found && ds.sizes.UseNetClassTrack() && aStartItem) {
      const c = resolver?.queryConstraint(
        PnsConstraintType.CT_WIDTH,
        dummyTrack(aStartItem.net()),
        null,
        startLayer,
      );

      if (c?.value.opt !== undefined) {
        trackWidth = Math.max(trackWidth, c.value.opt);
        found = true;

        // `if( trackWidth == constraint.m_Value.Opt() )` — the rule only gets
        // the credit when it actually won the max.
        if (trackWidth === c.value.opt) aSizes.widthSource = c.ruleName;
      }
    }

    if (!found) {
      const current = ds.sizes.GetCurrentTrackWidth();
      trackWidth = Math.max(trackWidth, current);

      if (ds.sizes.UseNetClassTrack()) aSizes.widthSource = "netclass 'Default'";
      else if (trackWidth === current) aSizes.widthSource = 'user choice';
    }

    aSizes.trackWidth = trackWidth;
    aSizes.boardMinTrackWidth = ds.trackMinWidth;
    aSizes.trackWidthIsExplicit = !ds.useConnectedTrackWidth || ds.tempOverrideTrackWidth;

    // ----- via -------------------------------------------------------------
    let viaDiameter = ds.viasMinSize;
    let viaDrill = ds.minThroughDrill;

    const dummyVia = (): PnsVia => {
      const via = new PnsVia();
      if (aStartItem) via.setNet(aStartItem.net());
      return via;
    };
    const coupledVia = (): PnsVia => {
      const via = new PnsVia();
      if (aStartItem) via.setNet(resolver?.dpCoupledNet(aStartItem.net()) ?? null);
      return via;
    };

    if (ds.sizes.UseNetClassVia() && aStartItem) {
      const dia = optOf(PnsConstraintType.CT_VIA_DIAMETER, dummyVia(), null, startLayer);
      if (dia !== null) viaDiameter = Math.max(viaDiameter, dia);

      const hole = optOf(PnsConstraintType.CT_VIA_HOLE, dummyVia(), null, startLayer);
      if (hole !== null) viaDrill = Math.max(viaDrill, hole);
    } else {
      // Not `std::max` — upstream assigns, so a preset SMALLER than the board
      // minimum reaches the router and DRC is what complains about it.
      viaDiameter = ds.sizes.GetCurrentViaSize();
      viaDrill = ds.sizes.GetCurrentViaDrill();
    }

    aSizes.viaDiameter = viaDiameter;
    aSizes.viaDrill = viaDrill;

    // ----- differential pair ------------------------------------------------
    let diffPairWidth = ds.trackMinWidth;
    let diffPairGap = ds.minClearance;
    let diffPairViaGap = ds.minClearance;

    aSizes.diffPairWidthSource = 'board minimum track width';
    aSizes.diffPairGapSource = 'board minimum clearance';

    found = false;

    // The width inherits from the starting track under the SAME flag as above,
    // but WITHOUT the `m_TempOverrideTrackWidth` half of the test.
    if (ds.useConnectedTrackWidth && aStartItem) {
      const inherited = ds.inheritTrackWidth?.(aStartItem, aStartPosition) ?? null;

      if (inherited !== null) {
        diffPairWidth = inherited;
        found = true;
      }
    }

    if (ds.sizes.UseNetClassDiffPair() && aStartItem) {
      const net = aStartItem.net();
      const coupled = resolver?.dpCoupledNet(net) ?? null;
      const a = dummyTrack(net, 0);
      const b = dummyTrack(coupled, 0);

      if (!found) {
        const c = resolver?.queryConstraint(PnsConstraintType.CT_WIDTH, a, b, startLayer);

        if (c?.value.opt !== undefined) {
          diffPairWidth = Math.max(diffPairWidth, c.value.opt);
          if (diffPairWidth === c.value.opt) aSizes.diffPairWidthSource = c.ruleName;
        }
      }

      const gap = resolver?.queryConstraint(PnsConstraintType.CT_DIFF_PAIR_GAP, a, b, startLayer);

      if (gap?.value.opt !== undefined) {
        diffPairGap = Math.max(diffPairGap, gap.value.opt);
        diffPairViaGap = Math.max(diffPairViaGap, gap.value.opt);
        if (diffPairGap === gap.value.opt) aSizes.diffPairGapSource = gap.ruleName;
      }
    } else {
      diffPairWidth = ds.sizes.GetCurrentDiffPairWidth();
      diffPairGap = ds.sizes.GetCurrentDiffPairGap();
      diffPairViaGap = ds.sizes.GetCurrentDiffPairViaGap();

      aSizes.diffPairWidthSource = 'user choice';
      aSizes.diffPairGapSource = 'user choice';
    }

    aSizes.diffPairWidth = diffPairWidth;
    aSizes.diffPairGap = diffPairGap;
    aSizes.diffPairViaGap = diffPairViaGap;
    aSizes.diffPairViaGapSameAsTraceGap = false;

    // ----- hole to hole -----------------------------------------------------
    // `SetHoleToHole` then `SetDiffPairHoleToHole( max( holeToHoleMin, … ) )`.
    // The second query is the same type against the COUPLED via, so a rule
    // written for the pair can widen it past the single-via answer.
    let holeToHole = ds.holeToHoleMin;
    const single = resolver?.queryConstraint(
      PnsConstraintType.CT_HOLE_TO_HOLE,
      dummyVia(),
      dummyVia(),
      PNS_UNDEFINED_LAYER,
    );

    if (single?.value.min !== undefined) holeToHole = single.value.min;

    aSizes.holeToHole = holeToHole;

    const pairHoleToHole = holeToHole;
    const coupled = resolver?.queryConstraint(
      PnsConstraintType.CT_HOLE_TO_HOLE,
      dummyVia(),
      coupledVia(),
      PNS_UNDEFINED_LAYER,
    );

    aSizes.diffPairHoleToHole = Math.max(coupled?.value.min ?? pairHoleToHole, pairHoleToHole);

    return true;
  }

  // ----- length and delay ----------------------------------------------------

  /**
   * `CalculateRoutedPathLength` (cpp:3171-3193), reduced to geometry.
   *
   * Upstream hands the items to `LENGTH_DELAY_CALCULATION` with
   * `InferViaInPad` on and the pad-to-die lengths of the two end pads folded
   * in. That class is not ported. What is portable — and what dominates the
   * answer — is the sum of the segment and arc lengths plus the two pad-to-die
   * stubs, so that is what this returns. It does **not** include via stackup
   * height (see {@link stackupHeight}) or the in-pad path optimisations.
   */
  calculateRoutedPathLength(
    aLine: PnsItemSet,
    aStartPad: PnsSolid | null,
    aEndPad: PnsSolid | null,
    _aNetClass: string | null,
  ): number {
    let length = 0;

    for (const item of aLine.citems()) {
      if (item.kind() === PnsKind.SEGMENT_T) {
        const seg = (item as PnsSegment).seg();
        length += Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      } else if (item.kind() === PnsKind.ARC_T) {
        const a = (item as PnsArc).cArc();
        const g = arcShape(a.p0, a.arcMid, a.p1, a.width);

        length +=
          g.kind === 'arc'
            ? Math.abs(g.sweep) * g.rad
            : Math.hypot(a.p1.x - a.p0.x, a.p1.y - a.p0.y);
      }
    }

    length += aStartPad?.getPadToDie() ?? 0;
    length += aEndPad?.getPadToDie() ?? 0;

    return length;
  }

  /**
   * `CalculateRoutedPathDelay` — **not implemented**, returns 0.
   *
   * Propagation delay needs `LENGTH_DELAY_CALCULATION`'s per-layer velocity
   * table, which needs the `BOARD_STACKUP` dielectric constants this tree does
   * not model. Every caller is a length tuner, which is out of scope for the
   * board bridge; a wrong number here would be worse than none.
   */
  calculateRoutedPathDelay(
    _aLine: PnsItemSet,
    _aStartPad: PnsSolid | null,
    _aEndPad: PnsSolid | null,
    _aNetClass: string | null,
  ): number {
    return 0;
  }

  /** `CalculateLengthForDelay` — not implemented; see {@link calculateRoutedPathDelay}. */
  calculateLengthForDelay(
    _aDelay: number,
    _aWidth: number,
    _aIsDiffPair: boolean,
    _aDiffPairGap: number,
    _aLayer: number,
    _aNetClass: string | null,
  ): number {
    return 0;
  }

  /** `CalculateDelayForShapeLineChain` — not implemented; see above. */
  calculateDelayForShapeLineChain(
    _aShape: PnsLineChain,
    _aWidth: number,
    _aIsDiffPair: boolean,
    _aDiffPairGap: number,
    _aLayer: number,
    _aNetClass: string | null,
  ): number {
    return 0;
  }

  /**
   * `GetSignalAggregate` (cpp:3070-3105) — **not implemented**, returns null.
   *
   * Upstream walks `NETINFO_ITEM::GetNetChain()`, the "signal" a net belongs to
   * across series components. `Board.nets` is a code→name map with no chain, so
   * there is nothing to walk. Null is upstream's `return false`.
   */
  getSignalAggregate(
    _aFirst: NetHandle,
    _aSecond: NetHandle,
  ): { length: number; delay: number } | null {
    return null;
  }

  /** `GetNetBoardLength` — not implemented; needs the same length calculator. */
  getNetBoardLength(_aNet: NetHandle): number {
    return 0;
  }

  // ----- the board mutations, held rather than applied ------------------------

  /**
   * The pending `AddItem`/`UpdateItem`/`RemoveItem` calls since the last
   * {@link commit}, in the order the router made them.
   *
   * Upstream turns each into a `PCB_TRACK`/`PCB_ARC`/`PCB_VIA` and stages it on
   * a `BOARD_COMMIT` (cpp:2650-2900). Building a board item here means
   * synthesising its `source: SList`, and pushing it means the editor's undo
   * stack — both of which belong with the commit wiring, not with the sync. So
   * the calls are recorded, exactly, and a caller that wants to drive them can
   * read them back; nothing is written to the `Board`.
   */
  pendingChanges(): readonly PnsPendingChange[] {
    return this.mPending;
  }

  /** `AddItem( ITEM* )`. Recorded; see {@link pendingChanges}. */
  addItem(aItem: PnsItem): void {
    this.mPending.push({ kind: 'add', item: aItem });
  }

  /** `UpdateItem( ITEM* )`. Recorded; see {@link pendingChanges}. */
  updateItem(aItem: PnsItem): void {
    this.mPending.push({ kind: 'update', item: aItem });
  }

  /** `RemoveItem( ITEM* )`. Recorded; see {@link pendingChanges}. */
  removeItem(aItem: PnsItem): void {
    this.mPending.push({ kind: 'remove', item: aItem });
  }

  /**
   * `Commit()`: upstream pushes the `BOARD_COMMIT` at the undo stack and opens
   * a fresh one. Here the batch goes to {@link PNS_KICAD_IFACE_DEPS.onCommit} and
   * a fresh one is opened — the same end-of-transaction boundary, with somebody
   * on the other side of it at last.
   *
   * An empty batch still fires nothing: `ROUTER::CommitRouting` calls this on
   * every commit path, including the ones that decided to change nothing.
   */
  commit(): void {
    const batch = this.mPending;
    this.mPending = [];

    if (batch.length > 0) this.mDeps.onCommit?.(batch);
  }

  // ----- the view, which does not exist here ---------------------------------

  /**
   * `PNS_KICAD_IFACE::DisplayItem` (cpp:2475): a `ROUTER_PREVIEW_ITEM` in the
   * preview group, clearance shown as `m_TrackClearance` says.
   */
  displayItem(aItem: PnsItem, aClearance: number, aEdit = false, aFlags = 0): void {
    const view = this.mView;
    const group = this.mPreviewItems;

    if (!view || !group) return;

    if (aItem.isVirtual()) return;

    // A rule area is a semi-solid: sketched, not filled, until it collides.
    if ((aItem.parent() as { ruleArea?: unknown } | null)?.ruleArea !== undefined)
      aFlags |= PNS_SEMI_SOLID;

    const pitem = new ROUTER_PREVIEW_ITEM(aItem, this, view, aFlags);

    // Note: SEGMENT_T is used for placed tracks; LINE_T is used for the routing head
    const kind = aItem.kind();
    const tracks = kind === PnsKind.SEGMENT_T || kind === PnsKind.ARC_T || kind === PnsKind.LINE_T;
    const tracksOrVias = tracks || kind === PnsKind.VIA_T;

    if (aClearance >= 0) {
      pitem.SetClearance(aClearance);

      switch (this.mDeps.trackClearanceMode?.() ?? SHOW_WITH_VIA_ALWAYS) {
        case SHOW_WITH_VIA_ALWAYS:
        case SHOW_WITH_VIA_WHILE_ROUTING_OR_DRAGGING:
          pitem.ShowClearance(tracksOrVias);
          break;

        case SHOW_WITH_VIA_WHILE_ROUTING:
          pitem.ShowClearance(tracksOrVias && !aEdit);
          break;

        case SHOW_WHILE_ROUTING:
          pitem.ShowClearance(tracks && !aEdit);
          break;

        default:
          pitem.ShowClearance(false);
          break;
      }
    }

    group.Add(pitem);
    view.Update(group);
  }

  /** `DisplayPathLine` — pure view. Not ported. */
  displayPathLine(_aLine: PnsLineChain, _aImportance: number): void {
    // Intentionally empty: pure view.
  }

  /** `DisplayRatline` — pure view. Not ported. */
  displayRatline(_aRatline: PnsLineChain, _aNet: NetHandle): void {
    // Intentionally empty: pure view.
  }

  /**
   * `HideItem` (cpp:2589): the board item behind `aItem` is hidden in the view
   * while the shove shows its replacement; `EraseView` shows it again.
   */
  hideItem(aItem: PnsItem): void {
    const view = this.mView;

    if (!view) return;

    const parent = (aItem.parent() as { k?: VIEW_ITEM } | null)?.k;

    if (parent && view.HasItem(parent)) {
      if (view.IsVisible(parent)) this.mHiddenItems.add(parent);

      view.SetVisible(parent, false);
    }
  }

  /** `EraseView` (cpp:2451). */
  eraseView(): void {
    const view = this.mView;

    if (view) {
      for (const item of this.mHiddenItems) view.SetVisible(item, true);
      this.mHiddenItems.clear();

      if (this.mPreviewItems) {
        this.mPreviewItems.FreeItems();
        view.Update(this.mPreviewItems);
      }
    }
  }

  // ----- PnsResolverHost -----------------------------------------------------

  /** `BOARD_DESIGN_SETTINGS::m_DRCEngine`. */
  engine(): DrcRuleEngine | null {
    return this.mDeps.ruleEngine ?? null;
  }

  /** `ROUTER_IFACE::GetBoardLayerFromPNSLayer`, as the resolver wants it. */
  boardLayer(aPnsLayer: number): string | undefined {
    const layer = this.getBoardLayerFromPnsLayer(aPnsLayer);

    return layer === '' ? undefined : layer;
  }

  /**
   * `PNS_PCBNEW_RULE_RESOLVER::getBoardItem` plus the `DRC_ENGINE` view of it.
   *
   * Upstream manufactures a dummy `PCB_TRACK` or `PCB_VIA` for a router item
   * with no board counterpart, so the rules engine always has something to
   * evaluate. Same here: the `DrcEvalItem` is built from the parent board item
   * when there is one and from the `PNS::ITEM` itself when there is not, and
   * the two agree field for field with `boardEvalItems` in `drc_engine.ts` —
   * which matters, because a router that resolved a *different* clearance from
   * DRC would route boards that fail the checker.
   */
  evalItem(aItem: PnsItem): DrcEvalItem | null {
    const net = aItem.net() as PnsBoardNet | null;
    const netName = net ? net.name : undefined;
    const netClasses = [...(this.mDeps.netClassesOf?.(net?.code ?? 0) ?? [])];
    const layer = this.boardLayer(aItem.layers().start());

    switch (aItem.kind()) {
      case PnsKind.SEGMENT_T:
        return {
          type: 'Track',
          layer,
          netName,
          netClasses,
          props: { Width: (aItem as PnsSegment).width() },
        };

      case PnsKind.ARC_T:
        return {
          type: 'Arc',
          layer,
          netName,
          netClasses,
          props: { Width: (aItem as PnsArc).width() },
        };

      case PnsKind.LINE_T:
        // A `LINE` is a view over segments, not a board item; upstream's dummy
        // proxy for it is a `PCB_TRACK` of the line's width.
        return { type: 'Track', layer, netName, netClasses };

      case PnsKind.VIA_T: {
        const via = aItem as PnsVia;
        const span = via.layers();

        return {
          type: 'Via',
          layer,
          layers: layerNames(this, span),
          netName,
          netClasses,
          props: { Width: via.diameter(span.start()), Hole: via.drill() },
        };
      }

      case PnsKind.SOLID_T: {
        const parent = aItem.parent();
        const pad = parent ? this.mPads.get(parent) : undefined;

        return {
          type: 'Pad',
          layer: pad ? pad.layers[0] : layer,
          layers: pad ? [...pad.layers] : layerNames(this, aItem.layers()),
          netName,
          netClasses,
          props: pad ? { Pad_Number: pad.number } : undefined,
        };
      }

      case PnsKind.HOLE_T:
        return {
          type: 'Via',
          layer,
          layers: layerNames(this, aItem.layers()),
          netName,
          netClasses,
        };

      default:
        return null;
    }
  }

  /** `NETINFO_ITEM::GetNetCode`, as the resolver's optional hook. */
  netCode(aNet: NetHandle): number {
    return this.getNetCode(aNet);
  }

  /** `NETINFO_ITEM::GetNetname`, as the resolver's optional hook. */
  netName(aNet: NetHandle): string {
    return this.getNetName(aNet);
  }

  /**
   * `BOARD::FindNet( const wxString& )` — a handle for a net looked up by NAME.
   *
   * The board keeps code -> name; this is the only place that needs the other
   * direction, and it is the differential pair that needs it: the complement of
   * `/USB_D_P` is a NAME, and the router works in handles.
   */
  findNetByName(aName: string): NetHandle {
    for (const [code, name] of this.mBoard.nets) {
      if (name === aName) return this.netHandle(code);
    }

    return null;
  }

  /**
   * `BOARD::DpCoupledNet` (`pcbnew/board.cpp`) — the other half of a pair, by
   * name, or null when this net is not half of one.
   */
  dpCoupledNet(aNet: NetHandle): NetHandle {
    const name = this.getNetName(aNet);

    if (!name) return null;

    const suffix = DRC_ENGINE.MatchDpSuffix(name);

    return suffix.polarity === 0 ? null : this.findNetByName(suffix.complementNet);
  }

  /**
   * `PNS_PCBNEW_RULE_RESOLVER::DpNetPair` (`pns_kicad_iface.cpp:2790-2823`) —
   * an item's pair, ORIENTED so that `netP` is the positive half whichever one
   * the user grabbed:
   *
   *     int r = m_board->MatchDpSuffix( netNameP, netNameCoupled );
   *     if( r == 0 )       return false;
   *     else if( r == 1 )  netNameN = netNameCoupled;          // we hold P
   *     else             { netNameN = netNameP;                // we hold N
   *                        netNameP = netNameCoupled; }
   *
   * Both halves must exist on the board — `if( !netInfoP || !netInfoN ) return
   * false` — so a `/CLK_P` with no `/CLK_N` anywhere is not a pair.
   *
   * Without this hook `findDpPrimitivePair` answers "unable to find
   * complementary differential pair nets" for every item, which is where
   * differential-pair routing stopped: the placer was ported, the router asked
   * for the pair, and nothing could name it.
   */
  dpNetPair(aItem: PnsItem): DpNetPair | null {
    const net = aItem.net();

    if (!net) return null;

    const name = this.getNetName(net);
    const suffix = DRC_ENGINE.MatchDpSuffix(name);

    if (suffix.polarity === 0) return null;

    // `r == 1` means the name we hold IS the positive half.
    const nameP = suffix.polarity === 1 ? name : suffix.complementNet;
    const nameN = suffix.polarity === 1 ? suffix.complementNet : name;

    const netP = this.findNetByName(nameP);
    const netN = this.findNetByName(nameN);

    if (!netP || !netN) return null;

    return { netP, netN };
  }

  /**
   * `PNS_PCBNEW_RULE_RESOLVER::DpNetPolarity` — +1 for the positive half, −1
   * for the negative, 0 for a net that is not half of a pair. It is
   * `MatchDpSuffix`'s own return value.
   */
  dpNetPolarity(aNet: NetHandle): number {
    return DRC_ENGINE.MatchDpSuffix(this.getNetName(aNet)).polarity;
  }
}

/**
 * `ITEM::SetParent( BOARD_ITEM* )` for a board object that is not on one layer.
 *
 * `PnsBoardItem` is `{ layer?: string }` — every member optional — so TypeScript
 * refuses a `PcbPad` or a `PcbVia` outright under its weak-type check: they have
 * no property in common with it, since a pad and a via each carry `layers`
 * rather than `layer`. Widening `PnsBoardItem` would make that check useless for
 * every other caller, and the parent really is the board object: identity is
 * what `commitRoutingTo` pairs removes against adds by, and what
 * {@link PNS_KICAD_IFACE.startPointUnroutableReason} looks up. So the cast is the
 * honest expression of "this interface is a nominal handle, not a shape".
 *
 * Exported because every caller that wants to ask a node for the items made
 * from a given pad or via — `NODE::findItemsByParent`, which the tests do a lot
 * of — hits the same wall on the way in.
 */
export const asBoardItem = (aItem: object): { layer?: string } => aItem as { layer?: string };

/** Every board layer name a PNS span covers, for a `DrcEvalItem`. */
function layerNames(aIface: PNS_KICAD_IFACE, aSpan: PnsLayerRange): string[] {
  const out: string[] = [];

  for (let i = aSpan.start(); i <= aSpan.end(); i++) {
    const name = aIface.getBoardLayerFromPnsLayer(i);
    if (name !== '') out.push(name);
  }

  return out;
}

/**
 * Is this board object a `PCB_VIA`? `PnsBoardItem` carries no type, so the
 * discriminator is the shape of `PcbVia` — a two-element `layers` tuple beside
 * a `drill`, which no other board item has.
 */
function isBoardVia(aParent: object): aParent is PcbVia {
  const via = aParent as Partial<PcbVia>;

  return typeof via.drill === 'number' && Array.isArray(via.layers) && via.layers.length === 2;
}

// ============================================================================
// Folded in from pns_rule_resolver.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================
/**
 * The router's design-rule oracle, over this repo's DRC rules engine.
 * Counterpart: `PNS_PCBNEW_RULE_RESOLVER` (`pcbnew/router/pns_kicad_iface.cpp`,
 * `:92-330` for the cache keys, `:349-535` for the board predicates, `:537-790`
 * for `QueryConstraint`, `:792-981` for the caches and `Clearance`).
 *
 * `NODE::GetClearance` is three lines and delegates everything to this. So this
 * is where a routed track's actual clearance comes from, and where the router
 * stops being a geometry library and starts being a DRC client.
 *
 * ## It is a client of `drc_rules_engine.ts`, not a second rules engine
 *
 * Every number below arrives through `evalDrcRules`, the same call DRC itself
 * makes, so a clearance the router honours and a clearance DRC flags cannot
 * disagree. That is the whole reason for wiring it this way rather than
 * re-deriving clearances from netclasses: a router that keeps a *different*
 * clearance from the checker produces boards that pass routing and fail DRC,
 * which is the worst of both.
 *
 * ## Three caches, and why they are not one
 *
 * - **The clearance cache** is keyed on the two items' *identities*. It is for
 *   real board items, which live as long as the routing session.
 * - **The temporary clearance cache** is keyed on the two items'
 *   *properties* — board item, net, layer span, kind, free-pad flag — because
 *   the router manufactures throwaway items constantly and they would otherwise
 *   miss the cache every time. Upstream's comment: *"Items with the same
 *   properties get the same clearance from the rules, so they share one cache
 *   entry."* This is the mechanism that makes the scratch-segment reuse in
 *   `NODE::NearestObstacle` cheap as well as deduplicating.
 * - **The hull cache** is keyed on `(item, clearance, walkaroundThickness,
 *   layer)` and holds geometry, not numbers.
 *
 * They are cleared on different schedules — `ClearTemporaryCaches` drops only
 * the middle one, `ClearCacheForItems` only touches the first and third — and
 * merging any two of them changes when a stale answer can be returned.
 *
 * ## Where upstream sorts pointers, this sorts ordinals
 *
 * `CLEARANCE_CACHE_KEY` stores `(min(A,B), max(A,B))` *by address*, purely so
 * that `Clearance(a, b)` and `Clearance(b, a)` hit the same entry. Addresses do
 * not exist here, so each item is given a stable ordinal on first sight and the
 * ordinals are sorted instead. The property that matters — symmetry — is
 * preserved exactly; the property that does not — which of two unrelated pairs
 * hashes first — was never meaningful.
 */

/**
 * `PCBNEW_LAYER_ID_START` and `PCB_LAYER_ID_COUNT - 1` (`include/layer_ids.h:167,170`).
 *
 * Note what upstream does with these: it intersects a **PNS** layer range with
 * a range built from **board** layer ids. The two numbering schemes are not the
 * same thing — `ROUTER_IFACE` exists to convert between them — so this is a
 * namespace confusion in the source. Its only real effect is to clamp away the
 * `-1`s, which is what the comment beside it (*"Normalize layer range (no -1
 * magic numbers)"*) says it is for, so it is ported literally rather than
 * corrected into a copper-layer count this port would have to invent.
 */
const LAYER_ID_START = 0;
const LAYER_ID_END = 127;

/**
 * What the resolver needs from the board and the interface layer. Everything
 * that reads a `BOARD_ITEM`, a `ZONE` or a `NETINFO_ITEM` upstream is here;
 * everything that is pure PNS arithmetic is in the resolver itself.
 *
 * The optional members have upstream-faithful fallbacks, which are *not*
 * neutral: a host that does not answer `isEdge` produces a board with no edge
 * clearance rule, and one that does not answer `isOnCopperLayer` gets
 * upstream's `!Parent()` reading, i.e. **everything counts as copper**.
 */
export interface PnsResolverHost {
  /** The compiled rule set — `BOARD_DESIGN_SETTINGS::m_DRCEngine`. */
  engine(): DrcRuleEngine | null;
  /** `ROUTER_IFACE::GetBoardLayerFromPNSLayer`. */
  boardLayer(pnsLayer: number): string | undefined;
  /** A router item as the rules engine sees it — upstream's `BoardItem()` plus
   * the dummy `PCB_TRACK`/`PCB_VIA` proxies `getBoardItem` manufactures for
   * items that have no board counterpart. Null means "no A item", which makes
   * `queryConstraint` return nothing at all. */
  evalItem(item: PnsItem): DrcEvalItem | null;

  /** `BOARD_DESIGN_SETTINGS::GetDRCEpsilon()`. Default 0. */
  clearanceEpsilon?(): number;
  /** `DRC_ENGINE::HasUserDefinedPhysicalConstraint()`. Default false. */
  hasUserDefinedPhysicalConstraint?(): boolean;

  /** `isCopper`: `!Parent() || Parent()->IsOnCopperLayer()`. Default **true**. */
  isOnCopperLayer?(item: PnsItem): boolean;
  /** `isEdge`: a `PCB_SHAPE` on `Edge.Cuts` or `Margin`. Default false. */
  isEdge?(item: PnsItem): boolean;
  /** `BOARD_ITEM::HasDrilledHole()` on the hole's parent. Default false. */
  hasDrilledHole?(item: PnsItem): boolean;
  /** An NPTH pad whose two drill sizes differ. Default false. */
  isNonPlatedSlot?(item: PnsItem): boolean;

  isInNetTie?(item: PnsItem): boolean;
  isNetTieExclusion?(item: PnsItem, collisionPos: Vec2, collidingItem: PnsItem): boolean;
  isKeepout?(obstacle: PnsItem, item: PnsItem): KeepoutResult;

  netCode?(net: NetHandle): number;
  netName?(net: NetHandle): string;
  dpCoupledNet?(net: NetHandle): NetHandle;
  dpNetPolarity?(net: NetHandle): number;
  dpNetPair?(item: PnsItem): DpNetPair | null;
}

/** `CONSTRAINT_TYPE` → this repo's `DRC_CONSTRAINT_T` name. */
const HOST_TYPE: Partial<Record<PnsConstraintType, DrcConstraintType>> = {
  [PnsConstraintType.CT_CLEARANCE]: 'clearance',
  [PnsConstraintType.CT_WIDTH]: 'track_width',
  [PnsConstraintType.CT_DIFF_PAIR_GAP]: 'diff_pair_gap',
  [PnsConstraintType.CT_LENGTH]: 'length',
  [PnsConstraintType.CT_DIFF_PAIR_SKEW]: 'skew',
  [PnsConstraintType.CT_MAX_UNCOUPLED]: 'diff_pair_uncoupled',
  [PnsConstraintType.CT_VIA_DIAMETER]: 'via_diameter',
  [PnsConstraintType.CT_VIA_HOLE]: 'hole_size',
  [PnsConstraintType.CT_HOLE_CLEARANCE]: 'hole_clearance',
  [PnsConstraintType.CT_EDGE_CLEARANCE]: 'edge_clearance',
  [PnsConstraintType.CT_HOLE_TO_HOLE]: 'hole_to_hole',
  [PnsConstraintType.CT_PHYSICAL_CLEARANCE]: 'physical_clearance',
  [PnsConstraintType.CT_PHYSICAL_HOLE_CLEARANCE]: 'physical_hole_clearance',
};

/** One entry of the long-lived clearance cache, kept whole so it can be swept. */
interface ClearanceEntry {
  a: PnsItem;
  b: PnsItem | null;
  value: number;
}

interface HullEntry {
  item: PnsItem;
  hull: Hull;
}

/** `isHole`: `aItem->OfKind( HOLE_T )`, with upstream's null guard. */
const isHole = (aItem: PnsItem | null): boolean => {
  if (aItem === null) return false;

  return aItem.ofKind(PnsKind.HOLE_T);
};

/**
 * `PNS_PCBNEW_RULE_RESOLVER`.
 *
 * Construct one per routing session and hand it to
 * {@link PnsNode.setRuleResolver}. It holds caches keyed on live items, so it
 * must not outlive the node tree it was built for — that is what
 * {@link PNS_PCBNEW_RULE_RESOLVER.clearCaches} is for.
 */
export class PNS_PCBNEW_RULE_RESOLVER implements PnsRuleResolver {
  private readonly mHost: PnsResolverHost;

  /** Stable stand-in for `(uintptr_t) pointer`, handed out on first sight. */
  private readonly mOrdinals = new WeakMap<object, number>();
  private mNextOrdinal = 0;

  private mClearanceCache = new Map<string, ClearanceEntry>();
  private mTempClearanceCache = new Map<string, number>();
  private mHullCache = new Map<string, HullEntry>();

  /** `std::optional<bool> m_hasUserPhysicalConstraint`. */
  private mHasUserPhysicalConstraint: boolean | undefined;

  constructor(aHost: PnsResolverHost) {
    this.mHost = aHost;
  }

  // ----- identity ------------------------------------------------------------------

  /** The ordinal standing in for an object's address. Primitives key on themselves. */
  private token(aValue: unknown): string {
    if (aValue === null || aValue === undefined) return 'n';

    if (typeof aValue !== 'object' && typeof aValue !== 'function') {
      return `p${typeof aValue}:${String(aValue)}`;
    }

    const obj = aValue as object;
    let ord = this.mOrdinals.get(obj);

    if (ord === undefined) {
      ord = this.mNextOrdinal++;
      this.mOrdinals.set(obj, ord);
    }

    return `o${ord}`;
  }

  private ordinalOf(aItem: PnsItem | null): number {
    if (!aItem) return -1;

    let ord = this.mOrdinals.get(aItem);

    if (ord === undefined) {
      ord = this.mNextOrdinal++;
      this.mOrdinals.set(aItem, ord);
    }

    return ord;
  }

  /** `CLEARANCE_CACHE_KEY( aA, aB, aFlag )`, symmetric in its first two arguments. */
  private clearanceKey(aA: PnsItem, aB: PnsItem | null, aFlag: boolean): string {
    const oa = this.ordinalOf(aA);
    const ob = this.ordinalOf(aB);
    const lo = oa < ob ? oa : ob;
    const hi = oa < ob ? ob : oa;

    return `${lo}/${hi}/${aFlag ? 1 : 0}`;
  }

  /**
   * `TEMP_CLEARANCE_CACHE_KEY::SIDE` — the six properties upstream decided are
   * enough to determine a clearance, in the order its `operator<` compares them.
   */
  private tempSide(aItem: PnsItem | null): string[] {
    if (!aItem) return ['n', 'n', '-1', '-1', '0', '0'];

    return [
      this.token(aItem.boardItem()),
      this.token(aItem.net()),
      String(aItem.layers().start()),
      String(aItem.layers().end()),
      String(aItem.kind()),
      aItem.isFreePad() ? '1' : '0',
    ];
  }

  private tempClearanceKey(aA: PnsItem, aB: PnsItem | null, aFlag: boolean): string {
    const sa = this.tempSide(aA);
    const sb = this.tempSide(aB);

    // `if( sb < sa ) swap` — a field-by-field lexicographic compare, so the key
    // is symmetric in (A, B) exactly as the pointer sort makes the other one.
    let swap = false;

    for (let i = 0; i < sa.length; i++) {
      if (sa[i] === sb[i]) continue;

      swap = (sb[i] as string) < (sa[i] as string);
      break;
    }

    const [first, second] = swap ? [sb, sa] : [sa, sb];

    return `${first.join('|')}#${second.join('|')}#${aFlag ? 1 : 0}`;
  }

  // ----- the board predicates ---------------------------------------------------------

  hasUserDefinedPhysicalConstraint(): boolean {
    if (this.mHasUserPhysicalConstraint === undefined) {
      this.mHasUserPhysicalConstraint = this.mHost.hasUserDefinedPhysicalConstraint?.() ?? false;
    }

    return this.mHasUserPhysicalConstraint;
  }

  dpCoupledNet(aNet: NetHandle): NetHandle {
    return this.mHost.dpCoupledNet?.(aNet) ?? null;
  }

  dpNetPolarity(aNet: NetHandle): number {
    return this.mHost.dpNetPolarity?.(aNet) ?? 0;
  }

  dpNetPair(aItem: PnsItem): DpNetPair | null {
    return this.mHost.dpNetPair?.(aItem) ?? null;
  }

  netCode(aNet: NetHandle): number {
    return this.mHost.netCode?.(aNet) ?? 0;
  }

  netName(aNet: NetHandle): string {
    return this.mHost.netName?.(aNet) ?? '';
  }

  isInNetTie(aA: PnsItem): boolean {
    return this.mHost.isInNetTie?.(aA) ?? false;
  }

  isNetTieExclusion(aItem: PnsItem, aCollisionPos: Vec2, aCollidingItem: PnsItem): boolean {
    return this.mHost.isNetTieExclusion?.(aItem, aCollisionPos, aCollidingItem) ?? false;
  }

  /**
   * `IsDrilledHole`: a hole whose owning pad or via is actually drilled.
   *
   * Note the two-step parent lookup — the hole's own parent, falling back to
   * its pad/via's — and that a non-`HOLE_T` item is rejected outright, so
   * asking this of a via answers **false** even though the via has a drill.
   */
  isDrilledHole(aItem: PnsItem): boolean {
    if (!isHole(aItem)) return false;

    return this.mHost.hasDrilledHole?.(aItem) ?? false;
  }

  isNonPlatedSlot(aItem: PnsItem): boolean {
    if (!isHole(aItem)) return false;

    return this.mHost.isNonPlatedSlot?.(aItem) ?? false;
  }

  isKeepout(aObstacle: PnsItem, aItem: PnsItem): KeepoutResult {
    return this.mHost.isKeepout?.(aObstacle, aItem) ?? { keepout: false, enforce: false };
  }

  clearanceEpsilon(): number {
    return this.mHost.clearanceEpsilon?.() ?? 0;
  }

  // ----- constraints ------------------------------------------------------------------

  /**
   * `QueryConstraint`.
   *
   * ### Two arms of upstream's implementation are missing, deliberately
   *
   * 1. **Segment-by-segment evaluation of multi-segment `LINE`s.** When
   *    `DRC_ENGINE::HasGeometryDependentRules()` and one or both items is a
   *    `LINE` with more than one segment and no board item, upstream walks the
   *    chain, builds a dummy `PCB_TRACK` per segment, evaluates every segment
   *    (or, when both sides are lines, every *pair* within a proximity
   *    threshold) and keeps the **smallest** constraint, breaking out as soon as
   *    one resolves to `<= 0`. That needs a `PCB_TRACK` proxy and a
   *    `HasGeometryDependentRules` on this repo's engine, and neither exists.
   *    Consequence: a `.kicad_dru` rule whose condition is geometry-dependent
   *    (`intersectsCourtyard`, `insideArea`) is resolved once against the whole
   *    line rather than per segment, which can yield a *larger* clearance than
   *    upstream — the safe direction, but a real divergence.
   * 2. **The tuning-profile exception to the ignore-severity branch.** Upstream
   *    returns `min = -1` for an ignored constraint *unless* it came from an
   *    implicit tuning-profile rule. This repo's engine has no notion of an
   *    implicit source, so every ignored constraint takes the `-1` path.
   *
   * ### What is exact
   *
   * The type mapping, the "no A item means no answer at all" early exit, the
   * `-1` for an ignored severity, and — the one that matters for clearance —
   * that a type with no mapping returns nothing rather than falling through to
   * a default.
   */
  queryConstraint(
    aType: PnsConstraintType,
    aItemA: PnsItem | null,
    aItemB: PnsItem | null,
    aLayer: number,
  ): PnsConstraint | null {
    const engine = this.mHost.engine();

    if (!engine) return null;

    const hostType = HOST_TYPE[aType];

    if (!hostType) return null;

    const evalA = aItemA ? this.mHost.evalItem(aItemA) : null;
    const evalB = aItemB ? this.mHost.evalItem(aItemB) : null;
    const boardLayer = this.mHost.boardLayer(aLayer);

    // `if( parentA ) hostConstraint = drcEngine->EvalRules(...)` — with no A
    // item there is no evaluation and the constraint stays null.
    if (!evalA) return null;

    const resolved = evalDrcRules(
      engine,
      hostType,
      evalA,
      evalB ?? undefined,
      boardLayer,
      undefined,
      false,
    );

    // `DRC_CONSTRAINT::IsNull()`: nothing matched, so there is no constraint —
    // as opposed to a constraint whose value happens to be zero.
    if (!resolved.rule) return null;

    if (resolved.severity === 'ignore') {
      return {
        type: aType,
        value: { min: -1 },
        // Upstream's `PNS::CONSTRAINT constraint;` is default-initialised at
        // block scope, so `m_Allowed` is indeterminate on every path through
        // this function and no caller on the clearance path reads it. Zero is
        // what value-initialisation would have given.
        allowed: false,
        ruleName: resolved.rule.name,
        fromName: '',
        toName: '',
        isTimeDomain: false,
      };
    }

    return {
      type: aType,
      value: resolved.value,
      allowed: false,
      ruleName: resolved.rule.name,
      fromName: '',
      toName: '',
      // `DRC_CONSTRAINT::OPTIONS::TIME_DOMAIN` has no counterpart here.
      isTimeDomain: false,
    };
  }

  // ----- clearance --------------------------------------------------------------------

  /**
   * `PNS_PCBNEW_RULE_RESOLVER::Clearance`.
   *
   * ### The shape of the answer
   *
   * `rv` starts at 0 and only ever climbs: every constraint that resolves is
   * folded in with `if( min > rv ) rv = min`, so a query that returns *nothing*
   * leaves the running value alone rather than zeroing it. The loop runs over
   * every layer in the overlap and keeps the worst case across all of them —
   * not a per-layer answer.
   *
   * ### Which constraints are asked, in which order
   *
   * The net-aware block is skipped entirely for same-net and free-pad pairs.
   * Inside it, hole-to-hole and hole clearance are an `if/else if` — two
   * drilled holes ask for hole-to-hole and *not* hole clearance — but there is
   * deliberately **no** `else` before the copper clearance test, because a
   * plated hole must collect both. The physical clearances that follow are
   * outside the block: they are net-blind and apply to same-net pairs too.
   *
   * ### The two escapes at the end
   *
   * `(sameNet || freePad) && rv == 0` becomes **-1**, which is
   * `collideSimple`'s "no clearance at all, do not even test". A positive `rv`
   * survives, which is how a `physical_clearance` rule reaches across a net.
   * Then the epsilon is subtracted, floored at zero, and **only from a strictly
   * positive value** — so a -1 stays -1 rather than becoming -1 minus epsilon.
   */
  clearance(aA: PnsItem, aB: PnsItem | null, aUseClearanceEpsilon = true): number {
    const bothOwned = !!aA && !!aB && !!aA.owner() && !!aB.owner();

    if (bothOwned) {
      const hit = this.mClearanceCache.get(this.clearanceKey(aA, aB, aUseClearanceEpsilon));

      if (hit) return hit.value;
    } else if (aA && aB) {
      const hit = this.mTempClearanceCache.get(this.tempClearanceKey(aA, aB, aUseClearanceEpsilon));

      if (hit !== undefined) return hit;
    }

    let rv = 0;
    let layers: PnsLayerRange;

    if (!aB) layers = aA.layers();
    else if (this.isEdge(aA)) layers = aB.layers();
    else if (this.isEdge(aB)) layers = aA.layers();
    else layers = aA.layers().intersection(aB.layers());

    // Normalize layer range (no -1 magic numbers).
    layers = layers.intersection(new PnsLayerRange(LAYER_ID_START, LAYER_ID_END));

    const sameNet = !!aA && !!aB && !!aA.net() && aA.net() === aB.net();
    const freePad = !!aA && !!aB && (aA.isFreePad() || aB.isFreePad());

    const fold = (type: PnsConstraintType, layer: number): void => {
      const c = this.queryConstraint(type, aA, aB, layer);

      if (!c) return;

      const min = c.value.min ?? 0;

      if (min > rv) rv = min;
    };

    for (let layer = layers.start(); layer <= layers.end(); ++layer) {
      if (!sameNet && !freePad) {
        if (this.isDrilledHole(aA) && aB !== null && this.isDrilledHole(aB)) {
          fold(PnsConstraintType.CT_HOLE_TO_HOLE, layer);
        } else if (isHole(aA) || isHole(aB)) {
          fold(PnsConstraintType.CT_HOLE_CLEARANCE, layer);
        }

        // No 'else'; plated holes get both HOLE_CLEARANCE and CLEARANCE.
        if (this.isCopper(aA) && (!aB || this.isCopper(aB))) {
          fold(PnsConstraintType.CT_CLEARANCE, layer);
        }

        if (this.isEdge(aA) || this.isEdge(aB)) {
          fold(PnsConstraintType.CT_EDGE_CLEARANCE, layer);
        }
      }

      // Physical clearances are net-blind: a physical_clearance rule applies
      // regardless.
      if (isHole(aA) || isHole(aB)) {
        fold(PnsConstraintType.CT_PHYSICAL_HOLE_CLEARANCE, layer);
      }

      fold(PnsConstraintType.CT_PHYSICAL_CLEARANCE, layer);
    }

    // Same-net pairs short-circuit clearance unless a physical_clearance rule
    // gave a positive value.
    if ((sameNet || freePad) && rv === 0) rv = -1;

    if (aUseClearanceEpsilon && rv > 0) rv = Math.max(0, rv - this.clearanceEpsilon());

    if (bothOwned) {
      this.mClearanceCache.set(this.clearanceKey(aA, aB, aUseClearanceEpsilon), {
        a: aA,
        b: aB,
        value: rv,
      });
    } else if (aA && aB) {
      this.mTempClearanceCache.set(this.tempClearanceKey(aA, aB, aUseClearanceEpsilon), rv);
    }

    return rv;
  }

  /** `isCopper`: an item with **no parent counts as copper**. */
  private isCopper(aItem: PnsItem | null): boolean {
    if (!aItem) return false;

    if (!aItem.parent()) return true;

    return this.mHost.isOnCopperLayer?.(aItem) ?? true;
  }

  /** `isEdge`: a board shape on `Edge.Cuts` or `Margin`. */
  private isEdge(aItem: PnsItem | null): boolean {
    if (!aItem) return false;

    return this.mHost.isEdge?.(aItem) ?? false;
  }

  // ----- the hull cache ----------------------------------------------------------------

  /**
   * `HullCache`. Upstream returns a **reference into the map**, and the
   * base-class fallback in `pns_node.h:176-182` is worse — it returns a
   * reference to a function-local `static`, so two live references alias each
   * other. Neither is reproducible; a value is returned instead. Nothing
   * observable is lost, because the only caller (`NODE::NearestObstacle`)
   * copies into its own `hullData[i]` on the next line.
   *
   * The cached hull is *not* deep-copied on the way out. Callers must not
   * mutate it — `NearestObstacle` only reads, and `makeHull` builds a fresh
   * chain when it simplifies.
   */
  hullCache(
    aItem: PnsItem,
    aClearance: number,
    aWalkaroundThickness: number,
    aLayer: number,
  ): Hull {
    const key = `${this.ordinalOf(aItem)}/${aClearance}/${aWalkaroundThickness}/${aLayer}`;
    const hit = this.mHullCache.get(key);

    if (hit) return hit.hull;

    const hull = itemHull(aItem, aClearance, aWalkaroundThickness, aLayer);

    this.mHullCache.set(key, { item: aItem, hull });

    return hull;
  }

  // ----- cache lifetimes ----------------------------------------------------------------

  /**
   * Drop everything that mentions any of these items.
   *
   * Note the two asymmetries. The clearance sweep tests **both** sides of each
   * key, the hull sweep only its single item. And the **temporary** clearance
   * cache is not touched at all — it is keyed on properties rather than
   * identities, so a dead item does not make an entry wrong.
   *
   * The empty-list early return is upstream's and is not just a fast path: it
   * is what makes `NODE::releaseGarbage` cheap on the overwhelmingly common
   * commit that orphaned nothing.
   */
  clearCacheForItems(aItems: PnsItem[]): void {
    if (aItems.length === 0) return;

    const dirty = new Set(aItems);

    for (const [key, entry] of this.mClearanceCache) {
      if (dirty.has(entry.a) || (entry.b !== null && dirty.has(entry.b))) {
        this.mClearanceCache.delete(key);
      }
    }

    for (const [key, entry] of this.mHullCache) {
      if (dirty.has(entry.item)) this.mHullCache.delete(key);
    }
  }

  /** Everything, including the memoised physical-constraint answer. */
  clearCaches(): void {
    this.mClearanceCache = new Map();
    this.mTempClearanceCache = new Map();
    this.mHullCache = new Map();
    this.mHasUserPhysicalConstraint = undefined;
  }

  /** **Only** the property-keyed cache — the one holding answers about items
   * the router made up and has now thrown away. */
  clearTemporaryCaches(): void {
    this.mTempClearanceCache = new Map();
  }
}
