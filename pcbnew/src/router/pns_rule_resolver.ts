// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
import { evalDrcRules } from '../drc/drc_rules_engine.js';
import { itemHull } from './pns_item_hull.js';
import { PnsConstraintType, type PnsRuleResolver } from './pns_collision.js';
import { PnsKind } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import type { DrcEvalItem, DrcRuleEngine } from '../drc/drc_rules_engine.js';
import type { DrcConstraintType } from '../drc/drc_rule.js';
import type { Hull } from './pns_hull.js';
import type { PnsItem } from './pns_item.js';
import type { DpNetPair, KeepoutResult, NetHandle, PnsConstraint } from './pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

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
 * {@link PnsBoardRuleResolver.clearCaches} is for.
 */
export class PnsBoardRuleResolver implements PnsRuleResolver {
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
