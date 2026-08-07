// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The router's own copy of a board item, and the rule that decides whether two
 * of them are too close. Counterparts: `pcbnew/router/pns_item.h` and
 * `pns_item.cpp` (`ITEM`, `OWNABLE_ITEM`, `ITEM_OWNER`, `LineMarker`,
 * `shouldWeConsiderHoleCollisions`), `pns_linked_item.h` (`LINKED_ITEM`) and
 * `pns_link_holder.h` (`LINK_HOLDER`).
 *
 * ## Why this one is a class hierarchy when the rest of `router/` is not
 *
 * `pns_chain.ts`, `pns_line.ts` and friends model geometry as plain arrays and
 * pure functions, because a polyline has no identity — two chains with the same
 * points are the same chain. An `ITEM` is the opposite. The whole point of the
 * router's world model is that a segment is a *thing*: a joint holds a list of
 * the items meeting at it, a node records which items it owns and which of its
 * parent's items it has overridden, and the shove algorithm marks items and
 * assigns them ranks and then reads those marks back later. Every one of those
 * is identity, and every one is mutation of state that outlives the call. So
 * `ITEM` is a class, and the copies upstream makes by value — layer ranges, and
 * the item's whole state in `Clone()` — are made explicitly here.
 *
 * ## The one thing an item does not carry: its hull
 *
 * Upstream gives `ITEM` a virtual `Hull()`, overridden per subclass, built on
 * `pns_utils.cpp`'s octagon builders. This repo already has those builders, as
 * pure functions over geometry, in `pns_hull.ts` — they were ported for the
 * walkaround driver. Re-exposing them as an item virtual would fork that
 * module, so `Hull` is deliberately absent here and hulls stay where they are.
 * The only upstream caller that would notice is `RULE_RESOLVER::HullCache`,
 * whose consumer (`NODE::NearestObstacle`) is not in this change either.
 *
 * ## Collision is upstream's, exactly, including its sharp edges
 *
 * `collideSimple` below is a line-for-line port, and a few of its lines look
 * like mistakes and are not:
 *
 * - The clearance epsilon **defaults to false** when no search context is
 *   given, even though the option's own default is true.
 * - A missing shape on the query layer returns *false* outright, throwing away
 *   collisions already recorded from the hole recursion above it.
 * - `IsFreePad` reads the parent pad/via's raw flag rather than recursing, so
 *   free-ness is inherited exactly one level.
 * - The two `IsKeepout` calls short-circuit, so when the first says yes it is
 *   the first call's `enforce` that decides between "exact boundary" and "no
 *   clearance at all".
 */
import {
  collideShapeLists,
  getRouterIface,
  hasNet,
  type CollisionNode,
  type CollisionSearchContext,
  type NetHandle,
  type PnsRuleResolver,
} from './pns_collision.js';
import { PnsLayerRange } from './pns_layerset.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `LineMarker`: the bits `Mark`/`Unmark` set on an item. Note 1, 2 and 4 are unused. */
export enum LineMarker {
  MK_HEAD = 1 << 0,
  MK_VIOLATION = 1 << 3,
  MK_LOCKED = 1 << 4,
  MK_DP_COUPLED = 1 << 5,
}

/** `ITEM::PnsKind`: a bit per type, so a mask can select several at once. */
export enum PnsKind {
  INVALID_T = 0,
  SOLID_T = 1,
  LINE_T = 2,
  JOINT_T = 4,
  SEGMENT_T = 8,
  ARC_T = 16,
  VIA_T = 32,
  DIFF_PAIR_T = 64,
  HOLE_T = 128,
  ANY_T = 0xffff,
  LINKED_ITEM_MASK_T = SOLID_T | SEGMENT_T | ARC_T | VIA_T | HOLE_T,
}

/**
 * `ITEM_OWNER`: upstream an empty base class whose only job is to be a type
 * that can be pointed at. Ownership is tested with `m_owner == aNode` and
 * nothing else, so the TS equivalent of "some object, compared by identity" is
 * the right shape. `NODE`, `ITEM_SET` and `ITEM` itself are all owners.
 */
export type PnsItemOwner = object;

/**
 * The board item a router item was made from. The router keeps it only to hand
 * back to the interface layer and to compare for identity — with a single
 * exception, the layer read in the castellation check, which is why the layer
 * is the one field named here.
 */
export interface PnsBoardItem {
  layer?: string;
}

/** `OWNABLE_ITEM`. */
export abstract class OwnableItem {
  protected mOwner: PnsItemOwner | null = null;

  /** The owner of this item, or null if there's none. */
  owner(): PnsItemOwner | null {
    return this.mOwner;
  }

  /** Set the node that owns this item. An item can belong to a single NODE or be unowned. */
  setOwner(aOwner: PnsItemOwner | null): void {
    this.mOwner = aOwner;
  }

  belongsTo(aNode: PnsItemOwner | null): boolean {
    return this.mOwner === aNode;
  }
}

/**
 * The two members `collideSimple` reads off an item it has decided is a `LINE`,
 * via `dyn_cast<const LINE*>`. `LINE` itself is not ported here; expressing the
 * branch structurally keeps the port exact without pulling it in, and any future
 * `LINE` satisfies this by construction.
 */
export interface PnsLineLike {
  endsWithVia(): boolean;
  via(): PnsItem;
  width(): number;
}

/** Likewise for the `dyn_cast<const VIA*>` inside the hole-collision pruning. */
export interface PnsViaLike {
  pos(): Vec2;
  drill(): number;
  net(): NetHandle;
  padstackMatches(other: PnsViaLike): boolean;
}

const asLine = (aItem: PnsItem): PnsLineLike | null =>
  aItem.kind() === PnsKind.LINE_T ? (aItem as unknown as PnsLineLike) : null;

const asVia = (aItem: PnsItem | null): PnsViaLike | null =>
  aItem !== null && aItem.kind() === PnsKind.VIA_T ? (aItem as unknown as PnsViaLike) : null;

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** The board layer the castellation check looks for. */
const EDGE_CUTS = 'Edge.Cuts';

/** `bool enforce = false;` before an `IsKeepout` that returned false. */
const NOT_KEEPOUT = { keepout: false, enforce: false } as const;

/**
 * Base class for PNS router board items.
 *
 * Implements the shared properties of all PCB items — net, spanned layers,
 * geometric shape and reference to owning model.
 */
export abstract class PnsItem extends OwnableItem {
  protected mKind: PnsKind;
  /** The parent board item, when there is a 1:1 map between the two. */
  protected mParent: PnsBoardItem | null = null;
  /**
   * The progenitor board item for when there is *not* a 1:1 map. Dragging a
   * track produces several segments, none of which maps back to the track.
   */
  protected mSourceItem: PnsBoardItem | null = null;
  protected mLayers: PnsLayerRange = new PnsLayerRange();
  protected mMovable = true;
  protected mNet: NetHandle = null;
  protected mMarker = 0;
  protected mRank = -1;
  protected mRoutable = true;
  protected mIsVirtual = false;
  protected mIsFreePad = false;
  protected mIsCompoundShapePrimitive = false;

  constructor(aKind: PnsKind) {
    super();
    this.mKind = aKind;
  }

  /**
   * `ITEM( const ITEM& )`: copy every field but the owner, which upstream
   * explicitly resets to null — a copy is not in anyone's node until it is
   * added to one.
   */
  protected copyFrom(aOther: PnsItem): void {
    this.mLayers = aOther.mLayers.clone();
    this.mNet = aOther.mNet;
    this.mMovable = aOther.mMovable;
    this.mKind = aOther.mKind;
    this.mParent = aOther.mParent;
    this.mSourceItem = aOther.mSourceItem;
    this.mOwner = null;
    this.mMarker = aOther.mMarker;
    this.mRank = aOther.mRank;
    this.mRoutable = aOther.mRoutable;
    this.mIsVirtual = aOther.mIsVirtual;
    this.mIsFreePad = aOther.mIsFreePad;
    this.mIsCompoundShapePrimitive = aOther.mIsCompoundShapePrimitive;
  }

  /** Return a deep copy of the item. */
  abstract clone(): PnsItem;

  kind(): PnsKind {
    return this.mKind;
  }

  /** True if the item's type matches the mask. */
  ofKind(aKindMask: number): boolean {
    return (aKindMask & this.mKind) !== 0;
  }

  kindStr(): string {
    switch (this.mKind) {
      case PnsKind.ARC_T:
        return 'arc';
      case PnsKind.LINE_T:
        return 'line';
      case PnsKind.SEGMENT_T:
        return 'segment';
      case PnsKind.VIA_T:
        return 'via';
      case PnsKind.JOINT_T:
        return 'joint';
      case PnsKind.SOLID_T:
        return 'solid';
      case PnsKind.DIFF_PAIR_T:
        return 'diff-pair';
      case PnsKind.HOLE_T:
        return 'hole';
      default:
        return 'unknown';
    }
  }

  /** Setting a parent also seeds the source item, but only when non-null. */
  setParent(aParent: PnsBoardItem | null): void {
    this.mParent = aParent;

    if (this.mParent) this.mSourceItem = this.mParent;
  }

  parent(): PnsBoardItem | null {
    return this.mParent;
  }

  setSourceItem(aSourceItem: PnsBoardItem | null): void {
    this.mSourceItem = aSourceItem;
  }

  getSourceItem(): PnsBoardItem | null {
    return this.mSourceItem;
  }

  /** The board item, even if it's not the direct parent. */
  boardItem(): PnsBoardItem | null {
    return this.mParent;
  }

  setNet(aNet: NetHandle): void {
    this.mNet = aNet;
  }

  net(): NetHandle {
    return this.mNet;
  }

  /**
   * Upstream returns `const PNS_LAYER_RANGE&`. The instance is handed back, not
   * a copy, so the caller sees a joint widening its own span — but callers must
   * treat it as const. Use {@link setLayers}, which copies, to assign one.
   */
  layers(): PnsLayerRange {
    return this.mLayers;
  }

  setLayers(aLayers: PnsLayerRange): void {
    this.mLayers = aLayers.clone();
  }

  setLayer(aLayer: number): void {
    this.mLayers = new PnsLayerRange(aLayer, aLayer);
  }

  layer(): number {
    return this.layers().start();
  }

  /** True if the set of layers spanned by the other item overlaps ours. */
  layersOverlap(aOther: PnsItem): boolean {
    return this.layers().overlaps(aOther.layers());
  }

  /**
   * The geometrical shape of the item, used for collision detection and spatial
   * indexing. Items may have different shapes on different layers.
   */
  shape(_aLayer: number): Shape | null {
    return null;
  }

  /**
   * The same geometry as {@link shape}, as the list of primitives it is made of
   * — which is what collision, and only collision, asks for.
   *
   * Upstream has no counterpart because it does not need one: `Shape()` hands
   * back a `SHAPE*`, and a `SHAPE` is free to be composite. `LINE::Shape()`
   * returns its whole `SHAPE_LINE_CHAIN`; a pad's returns a `SHAPE_COMPOUND`.
   * This repo's `Shape` is a union of *primitives* — circle, stadium, arc,
   * closed poly — with no composite member and, in particular, no **open**
   * polyline: a `LINE` returned as `{ kind: 'poly' }` would silently close and
   * collide against an edge running from its last point back to its first.
   *
   * So the composite case is spelled as a list, and this is the accessor that
   * can express it. Every item whose shape is a single primitive inherits the
   * default and is unaffected; `PnsLine` overrides it and keeps answering null
   * from {@link shape}, because the spatial index takes a shape and upstream
   * does not index a `LINE` either.
   *
   * Null means the same thing it means for {@link shape} — "nothing on this
   * layer" — and `collideSimple` bails on it. An *empty* list is different and
   * is not the same as null: it is a real, empty geometry, which collides with
   * nothing. That is a chain with no segments.
   */
  shapes(aLayer: number): readonly Shape[] | null {
    const s = this.shape(aLayer);

    return s === null ? null : [s];
  }

  /** The layers on which this item has a potentially different shape. */
  uniqueShapeLayers(): number[] {
    return [-1];
  }

  hasUniqueShapeLayers(): boolean {
    return false;
  }

  /**
   * The layers on which either item can have a unique shape — what to loop over
   * when hit-testing objects whose shape varies by layer (currently only VIA).
   *
   * `-1` is not a layer: it is the sentinel meaning "this item looks the same
   * everywhere, ask it once". So when *neither* side varies, the answer is the
   * single sentinel rather than the union of two sentinels.
   *
   * Upstream returns a `std::set<int>`, i.e. sorted and unique; a sorted, deduped
   * array is the same sequence to iterate.
   *
   * NOTE — the shortcut is currently unobservable, and is kept anyway. It fires
   * only when *both* items answer false to `hasUniqueShapeLayers()`, and the
   * only implementation paired with that answer is the base `uniqueShapeLayers()`
   * returning `[-1]`; the union of `[-1]` with `[-1]` is `[-1]`, so removing the
   * line changes no result. `VIA` — the one subclass that overrides either — is
   * also the one subclass that overrides both, upstream and here. The line is
   * the contract that keeps that pairing honest: a future subclass that declared
   * per-layer shapes while reporting that it has none would otherwise start
   * being hit-tested once per declared layer, silently. A mutation that deletes
   * it survives the suite by construction, and no test is written for a
   * configuration no class can currently be in.
   */
  relevantShapeLayers(aOther: PnsItem): number[] {
    const myLayers = this.uniqueShapeLayers();
    const otherLayers = aOther.uniqueShapeLayers();

    if (!this.hasUniqueShapeLayers() && !aOther.hasUniqueShapeLayers()) return [-1];

    return [...new Set([...myLayers, ...otherLayers])].sort((a, b) => a - b);
  }

  mark(aMarker: number): void {
    this.mMarker = aMarker;
  }

  /** Clear the given bits. The default -1 clears every bit. */
  unmark(aMarker = -1): void {
    this.mMarker &= ~aMarker;
  }

  marker(): number {
    return this.mMarker;
  }

  setRank(aRank: number): void {
    this.mRank = aRank;
  }

  rank(): number {
    return this.mRank;
  }

  anchor(_n: number): Vec2 {
    return { x: 0, y: 0 };
  }

  anchorCount(): number {
    return 0;
  }

  isLocked(): boolean {
    return (this.marker() & LineMarker.MK_LOCKED) !== 0;
  }

  setRoutable(aRoutable: boolean): void {
    this.mRoutable = aRoutable;
  }

  isRoutable(): boolean {
    return this.mRoutable;
  }

  setIsFreePad(aIsFreePad = true): void {
    this.mIsFreePad = aIsFreePad;
  }

  /**
   * A pad on a "free" pin has no net until it is used, and neither does its
   * hole. Note that the parent's *raw flag* is read, not its `isFreePad()`, so
   * this inherits exactly one level — upstream's, kept verbatim.
   */
  isFreePad(): boolean {
    return this.mIsFreePad || (this.parentPadVia()?.mIsFreePad ?? false);
  }

  parentPadVia(): PnsItem | null {
    return null;
  }

  isVirtual(): boolean {
    return this.mIsVirtual;
  }

  setIsCompoundShapePrimitive(): void {
    this.mIsCompoundShapePrimitive = true;
  }

  isCompoundShapePrimitive(): boolean {
    return this.mIsCompoundShapePrimitive;
  }

  hasHole(): boolean {
    return false;
  }

  hole(): PnsItem | null {
    return null;
  }

  setHole(_aHole: PnsItem | null): void {
    // Base class does nothing; VIA and SOLID own a hole.
  }

  /**
   * The node this item is really in: a hole's owner is its pad or via, so ask
   * that instead.
   */
  owningNode(): PnsItemOwner | null {
    const parentPadVia = this.parentPadVia();
    return parentPadVia ? parentPadVia.owner() : this.owner();
  }

  /**
   * Check for a clearance violation between us and `aHead`, taking layers,
   * nets and DRC rules into account.
   */
  collide(
    aHead: PnsItem,
    aNode: CollisionNode,
    aLayer: number,
    aCtx: CollisionSearchContext | null = null,
  ): boolean {
    return collideSimple(this, aHead, aNode, aLayer, aCtx);
  }
}

/**
 * Prune self-collisions, i.e. a via/pad annular ring against its own hole.
 *
 * The middle branch is the subtle one, and upstream's own comment calls it an
 * ugly heuristic: when a `LINE` carrying a via is checked against a node that
 * already contains that via, the line's via is a *copy*, so pointer identity
 * cannot see that they are the same object. Two via holes that sit at the same
 * point, on the same net, with the same padstack and the same drill are
 * therefore treated as one and not collided.
 */
function shouldWeConsiderHoleCollisions(aItem: PnsItem, aHead: PnsItem): boolean {
  const holeI = aItem.ofKind(PnsKind.HOLE_T) ? aItem : null;
  const holeH = aHead.ofKind(PnsKind.HOLE_T) ? aHead : null;

  if (holeI && holeH) {
    // hole-to-hole case
    const parentI = holeI.parentPadVia();
    const parentH = holeH.parentPadVia();

    if (!parentH || !parentI) return true;

    const parentViaI = asVia(parentI);
    const parentViaH = asVia(parentH);

    if (
      parentViaI &&
      parentViaH &&
      samePoint(parentViaI.pos(), parentViaH.pos()) &&
      parentViaI.padstackMatches(parentViaH) &&
      parentViaI.net() === parentViaH.net() &&
      parentViaI.drill() === parentViaH.drill()
    ) {
      return false;
    }

    return parentI !== parentH;
  }

  if (holeI) return holeI.parentPadVia() !== aHead;
  if (holeH) return holeH.parentPadVia() !== aItem;
  return true;
}

/**
 * `ITEM::collideSimple`, as a free function because upstream calls it on
 * *another* item (a line's via, a head's hole) from inside itself, which a
 * private method in TypeScript could not express any more clearly.
 *
 * Note: if `aItem` is a pad or a via then its hole is a separate item in the
 * node's index and there is no need to deal with it here. The same is *not*
 * true of the routing head, so the head's hole is handled explicitly.
 */
function collideSimple(
  aItem: PnsItem,
  aHead: PnsItem,
  aNode: CollisionNode,
  aLayer: number,
  aCtx: CollisionSearchContext | null,
): boolean {
  let lineWidthI = 0;
  let lineWidthH = 0;

  const holeH = aHead.hole();
  const holeI = aItem.hole();
  let collisionsFound = false;

  if (aItem === aHead) return false; // we cannot be self-colliding

  if (!shouldWeConsiderHoleCollisions(aItem, aHead)) return false;

  const resolver: PnsRuleResolver | null = aNode.getRuleResolver();

  // Physical rules are net-blind, so when a user-defined physical_hole_clearance
  // rule exists we must let the hole-recursion below run for same-net pairs too.
  const runPhysicalOnly = resolver?.hasUserDefinedPhysicalConstraint?.() ?? false;

  // Special cases for "head" lines with vias attached at the end. Note that this
  // does not support head-line-via to head-line-via collisions, but you can't
  // route two independent tracks at once so it shouldn't come up.
  const lineI = asLine(aItem);

  if (lineI?.endsWithVia()) {
    collisionsFound = collideSimple(lineI.via(), aHead, aNode, aLayer, aCtx) || collisionsFound;
  }

  const lineH = asLine(aHead);

  if (lineH?.endsWithVia()) {
    collisionsFound = collideSimple(lineH.via(), aItem, aNode, aLayer, aCtx) || collisionsFound;
  }

  // And a special case for the "head" via's hole.
  if (aHead.hasHole() && holeH !== null && shouldWeConsiderHoleCollisions(aItem, holeH)) {
    // Skip the net check when doing hole-to-hole collisions, or when a user
    // physical rule may apply across nets.
    if (aItem.kind() === PnsKind.HOLE_T || aItem.net() !== holeH.net() || runPhysicalOnly) {
      collisionsFound = collideSimple(aItem, holeH, aNode, aLayer, aCtx) || collisionsFound;
    }
  }

  if (aItem.hasHole() && holeI !== null && shouldWeConsiderHoleCollisions(holeI, aHead)) {
    collisionsFound = collideSimple(holeI, aHead, aNode, aLayer, aCtx) || collisionsFound;
  }

  // Sadly collision routines ignore polyline widths, so we have to pass them in
  // as part of the clearance value.
  if (aItem.kind() === PnsKind.LINE_T && lineI) lineWidthI = Math.trunc(lineI.width() / 2);
  if (aHead.kind() === PnsKind.LINE_T && lineH) lineWidthH = Math.trunc(lineH.width() / 2);

  // Check if we are not on completely different layers first.
  if (!aItem.layers().overlaps(aHead.layers())) return false;

  const iface = getRouterIface();
  let differentNetsOnly = true;
  let clearance: number;

  if (aCtx) differentNetsOnly = aCtx.options.differentNetsOnly;

  // Hole-to-hole collisions don't have anything to do with nets.
  if (aItem.kind() === PnsKind.HOLE_T && aHead.kind() === PnsKind.HOLE_T) {
    differentNetsOnly = false;
  }

  // Same-net items and free-pad items normally skip clearance, but physical
  // rules are net-blind, so when one is defined we fall through to the resolver.
  //
  // The keepout tests are written out rather than hoisted because upstream's
  // `else if` chain never reaches them when an earlier branch matched, and a
  // rule resolver is entitled to be expensive (or to cache) on being asked.
  if (differentNetsOnly && aItem.net() === aHead.net() && hasNet(aHead.net()) && !runPhysicalOnly) {
    // same nets? no clearance!
    clearance = -1;
  } else if (differentNetsOnly && (aItem.isFreePad() || aHead.isFreePad()) && !runPhysicalOnly) {
    // a pad associated with a "free" pin (NIC) doesn't have a net until it's used
    clearance = -1;
  } else {
    // `IsKeepout( a, b ) || IsKeepout( b, a )` short-circuits, so when the first
    // says yes it is the first call's `enforce` that decides.
    let keepout = resolver?.isKeepout(aItem, aHead) ?? NOT_KEEPOUT;

    if (!keepout.keepout) keepout = resolver?.isKeepout(aHead, aItem) ?? NOT_KEEPOUT;

    if (keepout.keepout) {
      // keepouts are exact boundary; no clearance
      clearance = keepout.enforce ? 0 : -1;
    } else if (iface && !iface.isFlashedOnLayer(aItem, aHead.layers())) {
      clearance = -1;
    } else if (iface && !iface.isFlashedOnLayer(aHead, aItem.layers())) {
      clearance = -1;
    } else if (aCtx && aCtx.options.overrideClearance >= 0) {
      clearance = aCtx.options.overrideClearance;
    } else {
      clearance = aNode.getClearance(aItem, aHead, aCtx ? aCtx.options.useClearanceEpsilon : false);
    }
  }

  if (clearance >= 0) {
    // Note: castellation and net-tie processing can't happen in GetClearance()
    // because they depend on *where* the collision is.
    const parent = aItem.parent();
    const checkCastellation =
      (parent !== null && parent.layer === EDGE_CUTS) ||
      (resolver?.isNonPlatedSlot(aItem) ?? false);
    const checkNetTie = resolver?.isInNetTie(aItem) ?? false;

    const shapeI = aItem.shapes(aLayer);
    const shapeH = aHead.shapes(aLayer);

    if (!shapeI || !shapeH) return false;

    // The extra "1" accounts for hulls being built to exactly the clearance
    // distance, so there must be no collision when exactly at that distance.
    const effective = clearance + lineWidthH + lineWidthI - 1;
    const hit = collideShapeLists(shapeH, shapeI, effective);

    if (hit.collides) {
      if (checkCastellation || checkNetTie) {
        // Slow method: the answer depends on where the two shapes met.
        if (hit.location === null) {
          throw new Error(
            'PNS: castellation/net-tie collision needs a collision location; ' +
              'install a location-capable shape collider via setShapeCollider().',
          );
        }

        if (checkCastellation && aNode.queryEdgeExclusions(hit.location)) return false;

        if (checkNetTie && (resolver?.isNetTieExclusion(aHead, hit.location, aItem) ?? false)) {
          return false;
        }
      }

      if (aCtx) {
        collisionsFound = true;
        aCtx.obstacles.insert({
          head: aHead,
          item: aItem,
          ipFirst: { x: 0, y: 0 },
          clearance,
          pos: { x: 0, y: 0 },
          distFirst: 0,
          maxFanoutWidth: 0,
        });
      } else {
        return true;
      }
    }
  }

  return collisionsFound;
}

/**
 * `LINKED_ITEM`: an item a joint can hold on to. The unique id is upstream's
 * escape from pointer identity — a cloned segment is a different object with the
 * same uid, which is how a branch's copy is matched back to the root's.
 */
export abstract class PnsLinkedItem extends PnsItem {
  protected mUid: number;

  constructor(aKind: PnsKind) {
    super(aKind);
    this.mUid = genNextUid();
  }

  resetUid(): void {
    this.mUid = genNextUid();
  }

  uid(): number {
    return this.mUid;
  }

  setWidth(_aWidth: number): void {
    // Base does nothing.
  }

  width(): number {
    return 0;
  }
}

let uidCount = 0;

/** `LINKED_ITEM::genNextUid`: upstream's function-local static counter. */
function genNextUid(): number {
  return uidCount++;
}

/**
 * `LINK_HOLDER`: an item assembled out of items that live in a node — a line
 * made of the node's segments, a diff pair made of two lines. The links are
 * *references into* the node; the holder never owns them.
 */
export abstract class PnsLinkHolder extends PnsItem {
  protected mLinks: PnsLinkedItem[] = [];

  /** Add a reference to an item registered in a node that is part of this line. */
  link(aLink: PnsLinkedItem): void {
    if (this.mLinks.includes(aLink)) return; // upstream logs and returns

    this.mLinks.push(aLink);
  }

  /** Upstream asserts and returns when asked to unlink something not linked. */
  unlink(aLink: PnsLinkedItem): void {
    const i = this.mLinks.indexOf(aLink);

    if (i < 0) return;

    this.mLinks.splice(i, 1);
  }

  links(): PnsLinkedItem[] {
    return this.mLinks;
  }

  isLinked(): boolean {
    return this.mLinks.length !== 0;
  }

  /** Check if the item is a part of the line. */
  containsLink(aItem: PnsLinkedItem): boolean {
    return this.mLinks.includes(aItem);
  }

  /** Negative indices count back from the end. */
  getLink(aIndex: number): PnsLinkedItem | undefined {
    return this.mLinks[aIndex < 0 ? aIndex + this.mLinks.length : aIndex];
  }

  /** Erase the linking information, detaching the holder from the owning node. */
  clearLinks(): void {
    this.mLinks = [];
  }

  /** The number of segments that were assembled together to form this line. */
  linkCount(): number {
    return this.mLinks.length;
  }

  /** `copyLinks`: share the parent's link list. */
  protected copyLinks(aParent: PnsLinkHolder): void {
    this.mLinks = [...aParent.mLinks];
  }
}
