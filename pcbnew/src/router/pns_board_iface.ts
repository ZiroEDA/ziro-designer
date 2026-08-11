// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board bridge: a `Board` seen as a `PNS::NODE`.
 * Counterparts: `pcbnew/router/pns_kicad_iface.h` and `pns_kicad_iface.cpp`
 * (`PNS_KICAD_IFACE_BASE`, `PNS_KICAD_IFACE`).
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
 * net 0 (see {@link PnsBoardIface.netHandle}) and non-round pad shapes (see
 * {@link solidShapeForPad}). Both are documented at the site. Nothing here
 * touches that file or the tool that calls it.
 */
import { buildConvexHull } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { arcShape, padShapes } from '../drc/drc_engine.js';
import { padIsOnLayer } from '../pad_enumerate.js';
import { enabledCopperLayers, isCopperLayerName } from '../swap_layers.js';
import { padFlashState, viaFlashState } from '../unused_pad_layers.js';
import { PnsArc } from './pns_arc.js';
import { PnsHole } from './pns_hole.js';
import { PnsKind, LineMarker } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PnsBoardRuleResolver } from './pns_rule_resolver.js';
import { PnsSegment } from './pns_segment.js';
import { PnsSolid } from './pns_solid.js';
import { PnsVia } from './pns_via.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { DrcEvalItem, DrcRuleEngine } from '../drc/drc_rules_engine.js';
import type { Board, PcbArcTrack, PcbPad, PcbTrack, PcbVia } from '../types.js';
import type { NetHandle, PnsRuleResolver } from './pns_collision.js';
import type { PnsItem } from './pns_item.js';
import type { PnsItemSet } from './pns_itemset.js';
import type { PnsLineChain } from './pns_line_item.js';
import type { PnsNode } from './pns_node.js';
import type { PnsResolverHost } from './pns_rule_resolver.js';
import type { PnsRouterIface, PnsRouterSizes } from './pns_router.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

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
 * The drill offset is deliberately not applied — see the file header of
 * `pns_syncworld_impl.md` §7.9: nothing in this tree's geometry models it, so
 * applying it here alone would put the hole somewhere the DRC engine does not
 * think it is.
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
export interface PnsBoardIfaceDeps {
  /** `BOARD_DESIGN_SETTINGS::m_DRCEngine` — the compiled custom rules. */
  ruleEngine?: DrcRuleEngine | null;
  /** Every netclass a net belongs to, for the rule resolver's conditions. */
  netClassesOf?: (aNet: number) => readonly string[];
  /** `BOARD::GetMaxClearanceValue()`, the seed for `NODE::SetMaxClearance`. */
  maxClearance?: number;
  /**
   * `KIGFX::VIEW::IsLayerVisible`. Absent means everything is visible, which is
   * **not** upstream's no-view answer for `IsAnyLayerVisible` — see
   * {@link PnsBoardIface.isAnyLayerVisible}.
   */
  isLayerVisible?: (aBoardLayer: string) => boolean;
  /** `KIGFX::VIEW::IsVisible( BOARD_ITEM* )`. Absent means visible. */
  isItemVisible?: (aItem: PnsItem) => boolean;
  /**
   * Called at each end-of-transaction boundary with the batch being closed,
   * just before it is dropped — upstream's `BOARD_COMMIT::Push()`.
   *
   * A hook rather than a return value because {@link PnsBoardIface.commit} is
   * called by `ROUTER::CommitRouting` itself, from inside the placer's own
   * commit, with no caller of ours on the stack to hand anything back to.
   * Without it the changes the router decided on were recorded and then thrown
   * away, which is exactly how far the port had got: everything up to the
   * boundary, and nothing across it.
   */
  onCommit?: (aChanges: readonly PnsPendingChange[]) => void;
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
export class PnsBoardIface implements PnsRouterIface, PnsResolverHost {
  private readonly mBoard: Board;
  private readonly mDeps: PnsBoardIfaceDeps;
  private readonly mCopperLayers: string[];
  private readonly mNets = new Map<number, PnsBoardNet>();

  /** Every pad a `SOLID` was built from, by the board object it points at. */
  private readonly mPads = new WeakMap<object, PcbPad>();

  private mWorld: PnsNode | null = null;
  private mRuleResolver: PnsBoardRuleResolver | null = null;
  private mPending: PnsPendingChange[] = [];

  constructor(aBoard: Board, aDeps: PnsBoardIfaceDeps = {}) {
    this.mBoard = aBoard;
    this.mDeps = aDeps;
    this.mCopperLayers = enabledCopperLayers(aBoard);
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
   * `PnsBoardRuleResolver` caches clearances by item identity.
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

    this.mRuleResolver = new PnsBoardRuleResolver(this);

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

    // `PAD::GetOffset` shifts a pad's copper relative to its hole. Nothing in
    // this tree's geometry models it — `padShapes` and the DRC engine both
    // centre the copper on `pad.at` — so applying it here alone would put the
    // router's idea of the pad somewhere DRC does not agree with. Zero, and
    // wrong in exactly the way the rest of the tree already is.
    solid.setPos(aPad.at);
    solid.setOffset({ x: 0, y: 0 });

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
   * Upstream returns 0 unless `m_UseHeightForLengthCalcs` is set *and* a
   * `BOARD_STACKUP` describes the dielectric thicknesses. This tree models
   * neither — `Board.thickness` is one number for the whole board, not a
   * per-layer distance — so 0 is upstream's own default answer rather than a
   * stub standing in for one.
   */
  stackupHeight(_aFirstLayer: number, _aSecondLayer: number): number {
    return 0;
  }

  /**
   * `PNS_KICAD_IFACE::ImportSizes` — **not implemented**, returns false.
   *
   * Upstream reads track width, via size, via drill and the four diff-pair
   * dimensions out of the net's netclass and the board design settings, which
   * means a `NETCLASS`, a `BOARD_DESIGN_SETTINGS` and the "use netclass values"
   * flags. `ROUTER` never calls it; `ROUTER_TOOL` does, before `StartRouting`.
   * False leaves the caller's sizes untouched, which is what upstream's own
   * early-out does when there is no board.
   */
  importSizes(
    _aSizes: PnsRouterSizes,
    _aStartItem: PnsItem | null,
    _aNet: NetHandle,
    _aStartPosition: Vec2,
  ): boolean {
    return false;
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
   * a fresh one. Here the batch goes to {@link PnsBoardIfaceDeps.onCommit} and
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

  /** `DisplayItem` — `ROUTER_PREVIEW_ITEM` on a `KIGFX::VIEW`. Not ported. */
  displayItem(_aItem: PnsItem, _aClearance: number, _aEdit?: boolean, _aFlags?: number): void {
    // Intentionally empty: pure view.
  }

  /** `DisplayPathLine` — pure view. Not ported. */
  displayPathLine(_aLine: PnsLineChain, _aImportance: number): void {
    // Intentionally empty: pure view.
  }

  /** `DisplayRatline` — pure view. Not ported. */
  displayRatline(_aRatline: PnsLineChain, _aNet: NetHandle): void {
    // Intentionally empty: pure view.
  }

  /** `HideItem` — pure view. Not ported. */
  hideItem(_aItem: PnsItem): void {
    // Intentionally empty: pure view.
  }

  /** `EraseView` — pure view. Not ported. */
  eraseView(): void {
    // Intentionally empty: pure view.
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
 * {@link PnsBoardIface.startPointUnroutableReason} looks up. So the cast is the
 * honest expression of "this interface is a nominal handle, not a shape".
 *
 * Exported because every caller that wants to ask a node for the items made
 * from a given pad or via — `NODE::findItemsByParent`, which the tests do a lot
 * of — hits the same wall on the way in.
 */
export const asBoardItem = (aItem: object): { layer?: string } => aItem as { layer?: string };

/** Every board layer name a PNS span covers, for a `DrcEvalItem`. */
function layerNames(aIface: PnsBoardIface, aSpan: PnsLayerRange): string[] {
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
