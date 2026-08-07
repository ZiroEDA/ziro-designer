// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What an item needs from the world in order to decide whether it collides.
 * Counterparts: `OBSTACLE`, `COLLISION_SEARCH_OPTIONS`, `COLLISION_SEARCH_CONTEXT`,
 * `RULE_RESOLVER`, `CONSTRAINT` and `CONSTRAINT_TYPE` — all declared in
 * `pcbnew/router/pns_node.h` — plus the slice of `ROUTER_IFACE` that
 * `ITEM::collideSimple` reaches for through the router singleton.
 *
 * These live in `pns_node.h` upstream because `NODE` is the only thing that
 * builds them, but they are *consumed* by `ITEM::Collide`, which is in this
 * change and `NODE` is not. Splitting them out is what lets the item model be
 * ported without dragging the whole node in; when `NODE` lands it implements
 * {@link CollisionNode} and re-exports these unchanged.
 *
 * ## Three seams, and why each is a seam rather than an import
 *
 * **`CollisionNode`** is not "a cut-down NODE". It is the exact set of three
 * members `collideSimple` calls on its `aNode` argument. Writing it out makes
 * the coupling auditable: if the real NODE port grows a fourth thing collision
 * needs, the interface has to change and the reviewer sees it.
 *
 * **The router interface** is a process-wide singleton upstream —
 * `ROUTER::GetInstance()->GetInterface()`, carrying a `fixme: this f***ing
 * singleton must go` in the source next to the call. It is modelled as one here
 * too, because faking it as a parameter would change which call sites can reach
 * it and quietly diverge from upstream's control flow.
 *
 * **The shape collider** has no upstream counterpart as a seam: upstream calls
 * `SHAPE::Collide`, which is `libs/kimath/src/geometry/shape_collisions.cpp` —
 * ~1000 lines of per-shape-pair special cases that this repo has not ported.
 * The default collider below reproduces the *verdict* exactly from the repo's
 * existing exact distance code, and is honest about the one thing it cannot
 * reproduce: the collision *location*. See {@link defaultShapeCollider}.
 */
import { shapeDist, type Shape } from '../drc/drc_geometry.js';
import type { MinOptMax } from '../drc/drc_rule.js';
import type { PnsItem } from './pns_item.js';
import type { PnsLayerRange } from './pns_layerset.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ----- nets --------------------------------------------------------------------

/**
 * `NET_HANDLE`: upstream is `typedef void*`, an opaque token whose innards
 * belong to the router interface. It stays opaque here — nothing in the item
 * model may look inside one, only compare two for identity.
 *
 * The one piece of structure upstream *does* rely on is that a handle can be
 * null, and `if( net )` is how it asks. `null`/`undefined` are that null; every
 * other value, **including the number 0**, is a real handle. That matters: a
 * future router interface that maps Ziro's numeric net codes onto handles must
 * not hand back `0` for "no net", or index buckets and same-net collision
 * skipping will both silently change behaviour.
 */
export type NetHandle = unknown;

/** The null handle — upstream's `nullptr` net. */
export const NO_NET: NetHandle = null;

/** Upstream's `if( net )` on a `NET_HANDLE`: is this anything but the null handle? */
export const hasNet = (aNet: NetHandle): boolean => aNet !== null && aNet !== undefined;

// ----- design rules ------------------------------------------------------------

/** `CONSTRAINT_TYPE`. */
export enum PnsConstraintType {
  CT_CLEARANCE = 1,
  CT_DIFF_PAIR_GAP = 2,
  CT_LENGTH = 3,
  CT_WIDTH = 4,
  CT_VIA_DIAMETER = 5,
  CT_VIA_HOLE = 6,
  CT_HOLE_CLEARANCE = 7,
  CT_EDGE_CLEARANCE = 8,
  CT_HOLE_TO_HOLE = 9,
  CT_DIFF_PAIR_SKEW = 10,
  CT_MAX_UNCOUPLED = 11,
  CT_PHYSICAL_CLEARANCE = 12,
  CT_PHYSICAL_HOLE_CLEARANCE = 13,
}

/** `CONSTRAINT`. */
export interface PnsConstraint {
  type: PnsConstraintType;
  value: MinOptMax;
  allowed: boolean;
  ruleName: string;
  fromName: string;
  toName: string;
  isTimeDomain: boolean;
}

/** `RULE_RESOLVER::IsKeepout`'s two results: upstream returns one and writes the other. */
export interface KeepoutResult {
  keepout: boolean;
  /** Whether the keepout's rules actually exclude the item under test. */
  enforce: boolean;
}

/** `RULE_RESOLVER::DpNetPair`'s out-parameters; null when upstream returns false. */
export interface DpNetPair {
  netP: NetHandle;
  netN: NetHandle;
}

/**
 * `RULE_RESOLVER`: the design-rule oracle. The optional members are the ones
 * upstream gives a body to in the header — their absence here means exactly
 * upstream's default, which is why every read of them goes through `?? …`.
 *
 * `HullCache` is not here: it defaults to `ITEM::Hull`, and hulls are a
 * separate, already-existing module in this repo (`pns_hull.ts`) rather than an
 * item virtual. See the note in `pns_item.ts`.
 */
export interface PnsRuleResolver {
  clearance(a: PnsItem, b: PnsItem, useClearanceEpsilon?: boolean): number;
  /** Default false. When true, physical rules run even between same-net items. */
  hasUserDefinedPhysicalConstraint?(): boolean;

  dpCoupledNet(net: NetHandle): NetHandle;
  dpNetPolarity(net: NetHandle): number;
  dpNetPair(item: PnsItem): DpNetPair | null;

  netCode(net: NetHandle): number;
  netName(net: NetHandle): string;

  isInNetTie(a: PnsItem): boolean;
  isNetTieExclusion(item: PnsItem, collisionPos: Vec2, collidingItem: PnsItem): boolean;

  isDrilledHole(item: PnsItem): boolean;
  isNonPlatedSlot(item: PnsItem): boolean;

  isKeepout(obstacle: PnsItem, item: PnsItem): KeepoutResult;

  queryConstraint(
    type: PnsConstraintType,
    itemA: PnsItem,
    itemB: PnsItem,
    layer: number,
  ): PnsConstraint | null;

  clearCacheForItems?(items: PnsItem[]): void;
  clearCaches?(): void;
  clearTemporaryCaches?(): void;
  /** Default 0. */
  clearanceEpsilon?(): number;

  /**
   * `HullCache`: the obstacle's hull, grown by a clearance, memoised.
   *
   * Added by the collision-querying change. The docblock above says this was
   * left out because `Hull` is not an item virtual in this port and the only
   * consumer, `NODE::NearestObstacle`, had not landed — that consumer is now
   * here, and the dispatch lives in `pns_item_hull.ts`.
   *
   * It stays **optional**, and that is not laziness. Upstream gives it a body
   * in the header (`pns_node.h:176-182`) — an uncached `aItem->Hull(...)` — so
   * a resolver that does not implement it is a legal resolver, and the caller
   * must fall back rather than fail. What the caller must *not* do is invent a
   * fallback for a **missing resolver**: `NearestObstacle` dereferences
   * `ruleResolver` unguarded (`pns_node.cpp:335`) and crashes, even though
   * `GetClearance` two lines earlier tolerates a null one.
   */
  hullCache?(
    item: PnsItem,
    clearance: number,
    walkaroundThickness: number,
    layer: number,
  ): readonly Vec2[];
}

// ----- obstacles ---------------------------------------------------------------

/** `OBSTACLE`: something in the way, plus what was learned while finding it. */
export interface Obstacle {
  /** Line we search collisions against. */
  head: PnsItem | null;
  /** Item found to be colliding with {@link head}. */
  item: PnsItem | null;
  /** First intersection between head and the obstacle's hull. */
  ipFirst: Vec2;
  clearance: number;
  pos: Vec2;
  /** ... and the distance thereof. */
  distFirst: number;
  /** Worst case (largest) width of the tracks connected to the item. */
  maxFanoutWidth: number;
}

/**
 * `std::set<OBSTACLE>`: a set keyed on the `(head, item)` pair, so the same
 * collision reported twice — once per layer of a multilayer item, say — counts
 * once.
 *
 * Upstream's ordering is `operator<` on the two raw pointers, i.e. heap
 * addresses. That is not a semantic order, it is whatever the allocator did,
 * and it cannot be reproduced in a garbage-collected language. Insertion order
 * is used instead. This is observable in exactly one place — `NODE`'s
 * `CheckColliding` returns `*obstacles.begin()` when several were found — so a
 * future NODE port gets *a* colliding obstacle, deterministically, rather than
 * the same one a given C++ build happened to pick.
 */
export class ObstacleSet {
  private readonly byHead = new Map<PnsItem | null, Set<PnsItem | null>>();
  private readonly order: Obstacle[] = [];

  /** `std::set::insert`: a no-op if an obstacle with this `(head, item)` is present. */
  insert(aObstacle: Obstacle): boolean {
    let items = this.byHead.get(aObstacle.head);

    if (!items) {
      items = new Set();
      this.byHead.set(aObstacle.head, items);
    }

    if (items.has(aObstacle.item)) return false;

    items.add(aObstacle.item);
    this.order.push(aObstacle);
    return true;
  }

  size(): number {
    return this.order.length;
  }

  empty(): boolean {
    return this.order.length === 0;
  }

  /** `*begin()` — undefined on an empty set upstream, null here. */
  first(): Obstacle | null {
    return this.order[0] ?? null;
  }

  items(): readonly Obstacle[] {
    return this.order;
  }

  [Symbol.iterator](): Iterator<Obstacle> {
    return this.order[Symbol.iterator]();
  }
}

/** `COLLISION_SEARCH_OPTIONS`, with upstream's defaults. */
export interface CollisionSearchOptions {
  /** Default true: items on the same net do not collide. */
  differentNetsOnly?: boolean;
  /** Default -1, meaning "ask the rule resolver". */
  overrideClearance?: number;
  /** Default -1, meaning unlimited. */
  limitCount?: number;
  /** Default -1, all kinds. */
  kindMask?: number;
  /** Default true. */
  useClearanceEpsilon?: boolean;
  filter?: ((item: PnsItem) => boolean) | null;
  /** Default -1. */
  layer?: number;
}

/** Every field of {@link CollisionSearchOptions}, defaults filled in. */
export interface ResolvedCollisionSearchOptions {
  differentNetsOnly: boolean;
  overrideClearance: number;
  limitCount: number;
  kindMask: number;
  useClearanceEpsilon: boolean;
  filter: ((item: PnsItem) => boolean) | null;
  layer: number;
}

/** Apply the header's default member initialisers. */
export function resolveCollisionSearchOptions(
  aOpts?: CollisionSearchOptions | null,
): ResolvedCollisionSearchOptions {
  return {
    differentNetsOnly: aOpts?.differentNetsOnly ?? true,
    overrideClearance: aOpts?.overrideClearance ?? -1,
    limitCount: aOpts?.limitCount ?? -1,
    kindMask: aOpts?.kindMask ?? -1,
    useClearanceEpsilon: aOpts?.useClearanceEpsilon ?? true,
    filter: aOpts?.filter ?? null,
    layer: aOpts?.layer ?? -1,
  };
}

/** `COLLISION_SEARCH_CONTEXT`: the set being filled, and the options it is filled under. */
export interface CollisionSearchContext {
  obstacles: ObstacleSet;
  options: ResolvedCollisionSearchOptions;
}

/** Build a context the way upstream's constructor does. */
export function makeCollisionSearchContext(
  aObstacles: ObstacleSet,
  aOpts?: CollisionSearchOptions | null,
): CollisionSearchContext {
  return { obstacles: aObstacles, options: resolveCollisionSearchOptions(aOpts) };
}

// ----- the node surface collision needs ----------------------------------------

/**
 * Exactly the three members `ITEM::collideSimple` calls on the `NODE` it is
 * given. `PNS::NODE` will satisfy this without changes.
 */
export interface CollisionNode {
  getRuleResolver(): PnsRuleResolver | null;
  getClearance(a: PnsItem, b: PnsItem, useClearanceEpsilon?: boolean): number;
  queryEdgeExclusions(pos: Vec2): boolean;
}

// ----- the router interface singleton ------------------------------------------

/** The slice of `ROUTER_IFACE` the item model reaches through the singleton. */
export interface PnsRouterIface {
  /**
   * Whether the item actually has copper on the given layer(s) — a through-hole
   * pad with "remove unused layers" set is present but unflashed on the inner
   * ones, and must not collide there.
   */
  isFlashedOnLayer(item: PnsItem, layers: PnsLayerRange | number): boolean;
}

let routerIface: PnsRouterIface | null = null;

/**
 * `ROUTER::GetInstance()->GetInterface()`. Null when no router is running,
 * which upstream also allows for and branches on.
 */
export const getRouterIface = (): PnsRouterIface | null => routerIface;

/** Install (or, with null, tear down) the router interface singleton. */
export function setRouterIface(aIface: PnsRouterIface | null): void {
  routerIface = aIface;
}

// ----- the shape collision seam ------------------------------------------------

/** One `SHAPE::Collide( other, clearance, &actual, &location )` result. */
export interface ShapeCollision {
  collides: boolean;
  /** The measured gap, clamped at 0 when the shapes touch or overlap. */
  actual: number;
  /**
   * Where the collision happened. Null when the collider cannot say — see
   * {@link defaultShapeCollider}.
   */
  location: Vec2 | null;
}

export type ShapeCollider = (a: Shape, b: Shape, clearance: number) => ShapeCollision;

/**
 * The stand-in for `SHAPE::Collide`.
 *
 * The **verdict** is exact. Upstream's generic answer, repeated at the bottom of
 * every pair-specific routine in `shape_collisions.cpp`, is
 * `closest_dist == 0 || closest_dist < aClearance`, over a distance that is
 * clamped at zero when the shapes overlap. `shapeDist` from the DRC geometry is
 * that same clamped distance, computed exactly for every pair of shapes this
 * repo models, so the condition transfers verbatim. Note the consequence at the
 * boundary: a *zero* clearance still collides on touching shapes but not on
 * shapes exactly one unit apart, and that asymmetry is upstream's, not a typo.
 *
 * The **location** is not exact and is therefore not guessed. Upstream's
 * `aLocation` is defined per shape pair and is frequently not the point of
 * closest approach at all — circle against circle hands back the midpoint of the
 * two *centres*, which can lie well outside both. Inventing a plausible point
 * would put a number into `QueryEdgeExclusions` and `IsNetTieExclusion` that
 * looks right and answers wrong. So this collider reports `location: null`, and
 * {@link PnsItem.collide} throws rather than proceed if a rule resolver claims a
 * castellation or net-tie case that needs one. Installing a location-capable
 * collider — the job of a real `shape_collisions` port — makes that path work
 * with no change to the item model.
 */
export const defaultShapeCollider: ShapeCollider = (a, b, clearance) => {
  const d = shapeDist(a, b);
  return { collides: d === 0 || d < clearance, actual: d, location: null };
};

let shapeCollider: ShapeCollider = defaultShapeCollider;

export const getShapeCollider = (): ShapeCollider => shapeCollider;

/** Install a collider; passing null restores {@link defaultShapeCollider}. */
export function setShapeCollider(aCollider: ShapeCollider | null): void {
  shapeCollider = aCollider ?? defaultShapeCollider;
}
