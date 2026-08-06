// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The router's model of the board: every item, filed spatially, plus the joint
 * map that says which of them touch where.
 * Counterparts: `pcbnew/router/pns_node.h` and `pns_node.cpp` (`NODE`).
 *
 * This is the **root node only**. `Branch()`, `Commit()`, the override
 * fall-through to the root, line assembly and collision querying are the next
 * two changes; every site where one of them belongs carries a comment naming the
 * upstream lines, so the holes are marked rather than silently absent.
 *
 * ## Connected is not the same as touching
 *
 * Two items are connected iff they are linked to the same `JOINT`, which needs
 * **exactly equal integer positions**, the **same net handle**, and
 * **overlapping layer ranges**. There is no tolerance anywhere. A track ending
 * one nanometre from a pad centre is not connected to it, however much copper
 * they share; two tracks whose copper overlaps along their length but whose
 * endpoints differ are not connected either — they merely collide, which is a
 * different question asked of a different function.
 *
 * That is the exact opposite of `pcbnew/src/cleanup_connectivity.ts`, which
 * clusters by shape collision. The two answer different questions and neither
 * should be expressed in terms of the other.
 *
 * ## Items are objects, and their identity is load-bearing
 *
 * `m_override` is a set of items, `BelongsTo` is an owner comparison, a joint's
 * link list is searched by identity, and a collision never fires between an item
 * and itself because the two pointers are equal. All of that ports directly onto
 * JS reference identity — **but only while items stay the same objects.** An
 * item cloned by a `{...board}`-style spread is a different item to every `Set`
 * and `Map` in the router, and the breakage is silent. Do not sweep this
 * directory with a board-shaped refactor.
 *
 * ## The joint map's key
 *
 * Upstream is an `unordered_multimap` keyed on `(pos, net)` — **layers are not
 * in the key**, despite `pns_node.h:592-593` saying they are. Several joints
 * share one bucket with disjoint layer ranges, and layer overlap is a linear
 * filter over the bucket. That is not an accident: it is what lets a via
 * spanning many layers find, and merge, the single-layer joints of everything it
 * lands on.
 *
 * `NET_HANDLE` is opaque here (`unknown`), so it cannot be stringified into a
 * composite key. The map is therefore two levels: **the net is a `Map` key**,
 * whose SameValueZero lookup is the analogue of upstream's `void*` identity, and
 * **the position is an interpolated `"x,y"` string**, which is injective over
 * the integers a `VECTOR2I` holds. Buckets are arrays, which gives the
 * contiguity of equal keys that `FindJoint` and `touchJoint` rely on, and gives
 * deterministic iteration where upstream's hash order is unspecified.
 *
 * ## Private helper names
 *
 * Upstream distinguishes the public `Add`/`Remove` overloads from the private
 * `addSegment`/`addVia`/… by case, which TypeScript's conventions cannot. The
 * private per-kind helpers are therefore `doAddSegment`, `doAddSolid`,
 * `doAddVia`, `doAddArc`, `doAddHole`, and the private kind dispatcher `add` is
 * `addItem`. Everything else keeps upstream's name.
 */
import { getShapeCollider } from './pns_collision.js';
import { PnsIndex, type IndexVisitor } from './pns_index.js';
import { PnsJoint, type JointTag } from './pns_joint.js';
import { PnsItemSet } from './pns_itemset.js';
import { LineMarker, PnsKind, type PnsBoardItem, type PnsItem } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PNS_HULL_MARGIN } from './pns_line_item.js';
import { PnsArc } from './pns_arc.js';
import { PnsSegment } from './pns_segment.js';
import { PnsVVia } from './pns_via.js';
import type { CollisionNode, NetHandle, PnsRuleResolver } from './pns_collision.js';
import type { PnsLine } from './pns_line_item.js';
import type { PnsSolid } from './pns_solid.js';
import type { PnsVia, ViaHandle } from './pns_via.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `BOX2I`, to the extent `QueryJoints` needs one. `Contains` is inclusive. */
export interface PnsBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const boxContains = (aBox: PnsBox, aPoint: Vec2): boolean =>
  aPoint.x >= aBox.minX && aPoint.x <= aBox.maxX && aPoint.y >= aBox.minY && aPoint.y <= aBox.maxY;

/**
 * The two `PCB_TRACK` members `FixupVirtualVias` reads off a segment's parent.
 * Expressed structurally so no board type has to be invented, and so the call
 * sites stay a 1:1 read of upstream. A segment with no parent answers `false`
 * and `undefined`, which is what upstream's null `PCB_TRACK*` produces.
 */
interface PnsTrackBoardItem extends PnsBoardItem {
  hasSolderMask?: boolean;
  localSolderMaskMargin?: number;
}

/**
 * The joint map's position key. Injective over the integers a `VECTOR2I` holds,
 * and it maps `-0` and `0` onto the same string, which agrees with the `===`
 * that `jointTagsEqual` uses. Non-integer or `NaN` coordinates are not
 * positions and are outside the contract.
 */
const posKey = (aPos: Vec2): string => `${aPos.x},${aPos.y}`;

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** A zero-radius circle: upstream treats a point as an infinitely small one. */
const pointShape = (aPoint: Vec2): Shape => ({ kind: 'circle', c: aPoint, r: 0 });

/**
 * Keep the router "world" — all the tracks, vias and solids — in a hierarchical
 * and indexed way.
 */
export class PnsNode implements CollisionNode {
  /** `m_joints`: net → position → the joints there, in insertion order. */
  private mJoints = new Map<NetHandle, Map<string, PnsJoint[]>>();
  /** `m_joints.size()`: the number of joints, not the number of buckets. */
  private mJointCount = 0;

  private mParent: PnsNode | null = null;
  private mRoot: PnsNode;
  /** `m_override`: root items this branch has deleted. Only written off-root. */
  private mOverride = new Set<PnsItem>();
  private mMaxClearance = 800000; // fixme: depends on how thick traces are.
  private mRuleResolver: PnsRuleResolver | null = null;
  private mIndex = new PnsIndex();
  private mDepth = 0;
  private mEdgeExclusions: Shape[] = [];
  /**
   * `m_garbageItems`: items nobody owns any more. Upstream frees them; a garbage
   * collector does that for us, so the set is kept — `Commit` clears it, and its
   * membership is the only witness that a removal orphaned an item — and the
   * frees are dropped.
   */
  private mGarbageItems = new Set<PnsItem>();

  constructor() {
    this.mRoot = this;
  }

  // ----- basics -----------------------------------------------------------------

  /**
   * `isRoot()` is `m_parent == nullptr`, **not** `m_root == this`. The two
   * coincide, but every branch in the source is written against the parent
   * pointer, so it is ported that way. Until `Branch()` lands it is always true.
   */
  private isRoot(): boolean {
    return this.mParent === null;
  }

  /** The number of parents in the inheritance chain. */
  depth(): number {
    return this.mDepth;
  }

  /** The number of joints. Note this only ever *grows* — see `unlinkJoint`. */
  jointCount(): number {
    return this.mJointCount;
  }

  /** The expected clearance between two items. */
  getClearance(aA: PnsItem, aB: PnsItem, aUseClearanceEpsilon = true): number {
    if (!this.mRuleResolver) return 100000;

    // Virtual items exist to give shove something to push on; they must touch,
    // not clear, so they get none.
    if (aA.isVirtual() || aB.isVirtual()) return 0;

    return this.mRuleResolver.clearance(aA, aB, aUseClearanceEpsilon);
  }

  /**
   * The pre-set worst case clearance between any pair of items, and the
   * proximity radius of *every* index query. Upstream's 0.8 mm default carries a
   * `fixme` and means real clearances above it are silently missed unless the
   * board setup calls {@link setMaxClearance}.
   */
  getMaxClearance(): number {
    return this.mMaxClearance;
  }

  setMaxClearance(aClearance: number): void {
    this.mMaxClearance = aClearance;
  }

  setRuleResolver(aFunc: PnsRuleResolver | null): void {
    this.mRuleResolver = aFunc;
  }

  getRuleResolver(): PnsRuleResolver | null {
    return this.mRuleResolver;
  }

  /** Does this branch hold an updated version of a root item? */
  overrides(aItem: PnsItem): boolean {
    return this.mOverride.has(aItem);
  }

  /** The port's stand-in for the items upstream would have deleted. */
  garbageItems(): ReadonlySet<PnsItem> {
    return this.mGarbageItems;
  }

  /** The spatial index. Read-only as far as callers outside this class go. */
  index(): PnsIndex {
    return this.mIndex;
  }

  /**
   * Defer spatial index insertion during bulk population; call
   * {@link finalizeBulkAdd} when done. Joints are linked eagerly either way, so
   * between the two calls the connectivity graph is complete while queries find
   * nothing.
   */
  beginBulkAdd(): void {
    this.mIndex.setDeferred(true);
  }

  finalizeBulkAdd(): void {
    this.mIndex.setDeferred(false);
    this.mIndex.buildSpatialIndex();
  }

  // ----- the joint map ------------------------------------------------------------

  private bucketFor(aNet: NetHandle, aPos: Vec2): PnsJoint[] | undefined {
    return this.mJoints.get(aNet)?.get(posKey(aPos));
  }

  private insertJoint(aTag: JointTag, aJoint: PnsJoint): void {
    let byPos = this.mJoints.get(aTag.net);

    if (!byPos) {
      byPos = new Map();
      this.mJoints.set(aTag.net, byPos);
    }

    const key = posKey(aTag.pos);
    const bucket = byPos.get(key);

    if (bucket) bucket.push(aJoint);
    else byPos.set(key, [aJoint]);

    this.mJointCount++;
  }

  /**
   * Erase one joint from its bucket. An emptied bucket is *deleted*, so that
   * "is there a bucket" answers upstream's `m_joints.find( tag ) == end()`
   * exactly — which is the test the tombstone in {@link rebuildJoint} turns on.
   */
  private eraseJointAt(aTag: JointTag, aIndex: number): void {
    const byPos = this.mJoints.get(aTag.net);

    if (!byPos) return;

    const key = posKey(aTag.pos);
    const bucket = byPos.get(key);

    if (!bucket) return;

    bucket.splice(aIndex, 1);
    this.mJointCount--;

    if (bucket.length === 0) byPos.delete(key);
  }

  /**
   * Every joint in this node, in insertion order.
   *
   * Upstream's `NODE::Dump` is `#if 0`'d out in full, so there is no parity
   * obligation here and no upstream counterpart. It exists because the joint map
   * is otherwise unobservable from outside, and because `FixupVirtualVias` and
   * `QueryJoints` both need to walk it.
   */
  allJoints(): PnsJoint[] {
    const out: PnsJoint[] = [];

    for (const byPos of this.mJoints.values()) {
      for (const bucket of byPos.values()) out.push(...bucket);
    }

    return out;
  }

  /**
   * The joint at a position, on a layer, on a net — or null.
   *
   * Two notes on the walk. Upstream runs from `find(tag)` to the *container's*
   * `end()` rather than the bucket's, which costs a scan of the rest of the map
   * but returns the same answer, because equal keys are contiguous in an
   * `unordered_multimap`. A bucket is the same sequence, so this is bucket-only
   * and parity is not lost. And the position/net re-test inside the loop is
   * upstream's, needed there precisely because the walk can run past the bucket;
   * here it is true by construction for every handle a caller can produce.
   */
  findJoint(aPos: Vec2, aLayer: number, aNet: NetHandle): PnsJoint | null {
    const bucket = this.bucketFor(aNet, aPos);

    // PR 3, `pns_node.cpp:1368-1372`: when the local bucket is empty and this is
    // not the root, the search restarts in the root's map. That fall-through is
    // what the tombstone in `rebuildJoint` exists to prevent.

    if (!bucket) return null;

    for (const j of bucket) {
      if (samePoint(j.pos(), aPos) && j.net() === aNet && j.layers().overlaps(aLayer)) return j;
    }

    return null;
  }

  /**
   * `FindJoint( aPos, const ITEM* )`: the joint at a position linked to an item.
   * Note it searches the item's **start layer only**, not its whole range.
   */
  findJointForItem(aPos: Vec2, aItem: PnsItem): PnsJoint | null {
    return this.findJoint(aPos, aItem.layers().start(), aItem.net());
  }

  /**
   * Find a joint, or make one — merging in every joint at the same position and
   * net whose layers overlap.
   *
   * Two things a caller must know. The returned joint is the one now *in* the
   * map, and every joint previously at that tag may have been erased, so any
   * `PnsJoint` held across a call to this is stale — which is why
   * {@link rebuildJoint} copies its link list up front.
   *
   * And the merge loop tests the **caller's** layer range, not the accumulating
   * joint's, which is what upstream writes.
   *
   * That distinction turns out to make no difference, and it is worth writing
   * down why rather than leaving the next reader to wonder. Joints sharing a tag
   * are pairwise disjoint in layers — anything overlapping would already have
   * been merged. `jt` is `aLayers` unioned with whatever has been absorbed, and
   * every absorbed range meets `aLayers`, so the union is one contiguous span
   * whose points all lie in `aLayers` or in some absorbed range. A candidate
   * meeting that union therefore meets `aLayers` or an absorbed range, and it
   * cannot meet an absorbed range without overlapping it. So it meets
   * `aLayers`, and testing `jt.layers()` instead would select exactly the same
   * joints. Upstream's spelling is kept because it is upstream's; a mutation
   * that swaps them is equivalent, not a bug found.
   */
  private touchJoint(aPos: Vec2, aLayers: PnsLayerRange, aNet: NetHandle): PnsJoint {
    const tag: JointTag = { pos: aPos, net: aNet };

    // PR 3, `pns_node.cpp:1406-1412`: a branch that has no bucket here first
    // copies the root's whole equal_range down into its own map.

    const jt = new PnsJoint(aPos, aLayers, aNet);
    let merged: boolean;

    do {
      merged = false;
      const bucket = this.bucketFor(aNet, aPos);

      if (!bucket) break;

      for (let i = 0; i < bucket.length; i++) {
        const other = bucket[i] as PnsJoint;

        if (aLayers.overlaps(other.layers())) {
          jt.merge(other);
          this.eraseJointAt(tag, i);
          merged = true;
          break;
        }
      }
    } while (merged);

    this.insertJoint(tag, jt);

    return jt;
  }

  private linkJoint(aPos: Vec2, aLayers: PnsLayerRange, aNet: NetHandle, aWhere: PnsItem): void {
    const jt = this.touchJoint(aPos, aLayers, aNet);

    jt.link(aWhere);
  }

  /**
   * Unlink an item from a joint.
   *
   * Upstream's `// fixme: remove dangling joints` sits on this function, and the
   * fixme must not be taken up. Going through `touchJoint` means unlinking from
   * a joint that does not exist **creates** one and then empties it, and the
   * emptied joint — layer range `(-1, -1)`, so it overlaps nothing and can never
   * be found or merged — stays in the map for good. On a branch that residue is
   * the only thing stopping `findJoint` falling through to the root and
   * reporting a segment the branch has just removed as still connected.
   */
  private unlinkJoint(aPos: Vec2, aLayers: PnsLayerRange, aNet: NetHandle, aWhere: PnsItem): void {
    const jt = this.touchJoint(aPos, aLayers, aNet);

    jt.unlink(aWhere);
  }

  /** Lock (or unlock) the joint at a position. **Creates** it if absent. */
  lockJoint(aPos: Vec2, aItem: PnsItem, aLock: boolean): void {
    const jt = this.touchJoint(aPos, aItem.layers(), aItem.net());

    jt.lock(aLock);
  }

  /**
   * Split one joint back into the several it was merged from, after the
   * multi-layer item that merged them is removed.
   *
   * Upstream's own comment: *"As I'm a lazy bastard, I simply delete the
   * via/solid and all its links and re-insert them."* The link list is copied by
   * value first, because the erase/insert below invalidates every reference into
   * the map.
   *
   * ### The tombstone at `pns_node.cpp:911-917`
   *
   * The `!isRoot()` block below inserts a joint with layer range `(-1, -1)`,
   * which overlaps nothing and therefore answers **no** `findJoint` query. It
   * reads exactly like garbage, and deleting it is the single most dangerous
   * thing a porter can do to this file.
   *
   * It is a tombstone. `findJoint` falls through to the root only when the local
   * bucket is *empty* (`pns_node.cpp:1368`); a bucket holding an entry that
   * matches nothing means "this tag is answered here, and the answer is
   * nothing". Without it, a branch that removed a via would fall through and get
   * the **root's** joint back — which still links the via it just removed — and
   * a shove rollback would produce a board where that via is simultaneously
   * present and absent. `AssembleLine` would walk through a deleted via and
   * `findRedundantSegment` would reuse a deleted segment.
   *
   * `completelyErased` then also suppresses the `unlinkJoint` for the removed
   * item itself. If it did not, `unlinkJoint` would `touchJoint` a *second*
   * joint into the bucket beside the tombstone, carrying the removed item's own
   * layer range — and that one would match.
   *
   * **It looks dead in this change and it is:** `isRoot()` is always true until
   * `Branch()` lands in PR 3, so the block never runs yet. It is written now
   * because it belongs to `rebuildJoint`, not to branching, and because writing
   * it later — after the fall-through exists — is how the bug ships.
   *
   * ### The split only survives on a branch
   *
   * Worth knowing before reading this as "removing a via re-splits its joint".
   * The relink loop does split it — each surviving item is re-linked under its
   * *own* narrow layer range. But on the **root**, `completelyErased` is false,
   * so the loop finishes by unlinking the removed item, and that call goes
   * through `touchJoint` with the removed item's **whole span** and merges the
   * fresh pieces straight back together. A via removed from the root therefore
   * leaves one joint still claiming the via's layer range, holding whatever is
   * left. On a branch the tombstone suppresses that final unlink and the split
   * stands. That difference is the tombstone's only observable effect here, and
   * it is what the tests turn on.
   *
   * ### The multi-erase loop
   *
   * The loop can erase several joints at one tag while restoring only
   * `aJoint`'s links, so any other erased joint's links are lost. I could not
   * reach that through the add/remove API: two joints share a tag only when
   * their layer ranges are disjoint, and the item being removed merged
   * everything overlapping its own span when it was *added*. It is reachable
   * only by widening an item's layer range while it sits in the node, which also
   * defeats `PnsIndex.remove`. Ported verbatim as the defensive loop it is.
   */
  private rebuildJoint(aJoint: PnsJoint | null, aItem: PnsItem): void {
    if (!aJoint) return;

    const links = [...aJoint.linkList()];
    const net = aItem.net();
    const tag: JointTag = { pos: { x: aJoint.pos().x, y: aJoint.pos().y }, net };

    let split: boolean;

    do {
      split = false;
      const bucket = this.bucketFor(tag.net, tag.pos);

      if (!bucket) break;

      // find and remove all joints containing the via to be removed
      for (let i = 0; i < bucket.length; i++) {
        if (aItem.layersOverlap(bucket[i] as PnsJoint)) {
          this.eraseJointAt(tag, i);
          split = true;
          break;
        }
      }
    } while (split);

    let completelyErased = false;

    if (!this.isRoot() && this.bucketFor(tag.net, tag.pos) === undefined) {
      this.insertJoint(tag, new PnsJoint(tag.pos, new PnsLayerRange(-1), tag.net));
      completelyErased = true;
    }

    // and re-link them, using the former via's link list
    for (const link of links) {
      if (link !== aItem) this.linkJoint(tag.pos, link.layers(), net, link);
      else if (!completelyErased) this.unlinkJoint(tag.pos, link.layers(), net, link);
    }
  }

  /**
   * Every joint in a box, on overlapping layers, with at least one link of the
   * given kind.
   *
   * Upstream fills a caller-supplied vector and returns the count; an array is
   * the same thing. The joints are the live ones, not copies.
   */
  queryJoints(
    aBox: PnsBox,
    aLayerMask: PnsLayerRange = PnsLayerRange.all(),
    aKindMask: number = PnsKind.ANY_T,
  ): PnsJoint[] {
    const out: PnsJoint[] = [];

    for (const j of this.allJoints()) {
      if (!j.layers().overlaps(aLayerMask)) continue;

      if (boxContains(aBox, j.pos()) && j.linkCount(aKindMask)) out.push(j);
    }

    // PR 3, `pns_node.cpp:1796-1809`: the root's joints are appended too,
    // filtered by `!Overrides( &j.second )` — a test that is always true, since
    // `m_override` holds removed *items* and a JOINT is never one of them.

    return out;
  }

  // ----- adding -------------------------------------------------------------------

  /**
   * The private kind dispatcher, `NODE::add`. No redundancy check, no LINE path
   * — upstream asserts on `LINE_T` and `JOINT_T`, and its `aAllowRedundant`
   * parameter is accepted and never read.
   */
  private addItem(aItem: PnsItem, _aAllowRedundant = false): void {
    switch (aItem.kind()) {
      case PnsKind.ARC_T:
        this.doAddArc(aItem as PnsArc);
        break;
      case PnsKind.SEGMENT_T:
        this.doAddSegment(aItem as PnsSegment);
        break;
      case PnsKind.VIA_T:
        this.doAddVia(aItem as PnsVia);
        break;
      case PnsKind.SOLID_T:
        this.doAddSolid(aItem as PnsSolid);
        break;
      case PnsKind.HOLE_T:
        // added by parent VIA_T or SOLID_T (pad)
        break;
      default:
        throw new Error(`PNS: NODE::add() of an unsupported kind ${aItem.kindStr()}`);
    }
  }

  /** `AddRaw`: straight to the private dispatcher, no checks. */
  addRaw(aItem: PnsItem, aAllowRedundant = false): void {
    this.addItem(aItem, aAllowRedundant);
  }

  private doAddSolid(aSolid: PnsSolid): void {
    const hole = aSolid.hole();

    if (aSolid.hasHole() && hole) {
      if (!hole.belongsTo(aSolid)) throw new Error('PNS: solid hole does not belong to its solid');

      this.doAddHole(hole);
    }

    // A pad the interface layer has marked unroutable is an obstacle but never a
    // connection point, so it is indexed and not linked. `removeSolidIndex`
    // makes the same test, which is what keeps the two in step.
    if (aSolid.isRoutable()) {
      this.linkJoint(aSolid.pos(), aSolid.layers(), aSolid.net(), aSolid);
    }

    aSolid.setOwner(this);
    this.mIndex.add(aSolid);
  }

  /** `Add( std::unique_ptr<SOLID> )`. Sets the owner, which `doAddSolid` then does again. */
  addSolid(aSolid: PnsSolid): void {
    aSolid.setOwner(this);
    this.doAddSolid(aSolid);
  }

  private doAddVia(aVia: PnsVia): void {
    const hole = aVia.hole();

    if (aVia.hasHole() && hole) {
      if (!hole.belongsTo(aVia)) throw new Error('PNS: via hole does not belong to its via');

      this.doAddHole(hole);
    }

    // One link, spanning the via's *whole* layer range. That single multi-layer
    // link is what merges the joints of every layer the via lands on, and what
    // forces `rebuildJoint` to split them again on removal.
    this.linkJoint(aVia.pos(), aVia.layers(), aVia.net(), aVia);
    aVia.setOwner(this);

    this.mIndex.add(aVia);
  }

  /** `Add( std::unique_ptr<VIA> )`. **No redundancy check** — two coincident vias are allowed. */
  addVia(aVia: PnsVia): void {
    this.doAddVia(aVia);
  }

  private doAddHole(aHole: PnsItem): void {
    // do we need holes in the connection graph?
    // this.linkJoint( aHole.pos(), aHole.layers(), aHole.net(), aHole );

    aHole.setOwner(this);
    this.mIndex.add(aHole);
  }

  private doAddSegment(aSeg: PnsSegment): void {
    aSeg.setOwner(this);

    this.linkJoint(aSeg.seg().a, aSeg.layers(), aSeg.net(), aSeg);
    this.linkJoint(aSeg.seg().b, aSeg.layers(), aSeg.net(), aSeg);

    this.mIndex.add(aSeg);
  }

  /**
   * `Add( std::unique_ptr<SEGMENT>, bool )`.
   *
   * @returns false, having added nothing, for a zero-length segment or — unless
   *          redundancy is allowed — one that duplicates a segment already here.
   */
  addSegment(aSegment: PnsSegment, aAllowRedundant = false): boolean {
    if (samePoint(aSegment.seg().a, aSegment.seg().b)) {
      // attempting to add a segment with same end coordinates, ignoring.
      return false;
    }

    if (!aAllowRedundant && this.findRedundantSegmentFor(aSegment)) return false;

    this.doAddSegment(aSegment);

    return true;
  }

  private doAddArc(aArc: PnsArc): void {
    aArc.setOwner(this);

    this.linkJoint(aArc.anchor(0), aArc.layers(), aArc.net(), aArc);
    this.linkJoint(aArc.anchor(1), aArc.layers(), aArc.net(), aArc);

    this.mIndex.add(aArc);
  }

  /** `Add( std::unique_ptr<ARC>, bool )`. Note there is **no** zero-length guard. */
  addArc(aArc: PnsArc, aAllowRedundant = false): boolean {
    const arc = aArc.cArc();

    if (!aAllowRedundant && this.findRedundantArc(arc.p0, arc.p1, aArc.layers(), aArc.net())) {
      return false;
    }

    this.doAddArc(aArc);

    return true;
  }

  /**
   * `Add( LINE&, bool )`: decompose a line into the primitives that *are* items,
   * add those, and record back-references in the line.
   *
   * Five differences from adding the constituent segments yourself, every one of
   * them observable:
   *
   *  1. **All arcs first, then all segments.** `links()` is therefore not in
   *     geometric order for a line containing arcs.
   *  2. The new primitives take the line's width, layers, net, marker and rank.
   *  3. A redundant primitive already in the node is **reused and linked**
   *     rather than duplicated, and the inner add is then told redundancy is
   *     allowed so it does not check again.
   *  4. **The line's via is not added.** `removeLine` does remove it. Callers
   *     add the via themselves; "fixing" this gives every existing caller two
   *     coincident vias, which nothing rejects.
   *  5. Zero-length segments are dropped silently, so `links().length` can be
   *     less than the chain's segment count.
   */
  addLine(aLine: PnsLine, aAllowRedundant = false): void {
    if (aLine.isLinked()) throw new Error('PNS: NODE::Add( LINE& ) of an already-linked line');

    const l = aLine.line();

    for (let i = 0; i < l.arcCount(); i++) {
      const s = l.arc(i);
      const rarc = aAllowRedundant
        ? null
        : this.findRedundantArc(s.p0, s.p1, aLine.layers(), aLine.net());

      if (rarc) {
        aLine.link(rarc);
      } else {
        const newarc = PnsArc.fromParentLine(aLine, s);
        aLine.link(newarc);
        this.addArc(newarc, true);
      }
    }

    for (let i = 0; i < l.segmentCount(); i++) {
      if (l.isArcSegment(i)) continue;

      const s = l.cSegment(i);

      if (samePoint(s.a, s.b)) continue;

      const rseg = aAllowRedundant
        ? null
        : this.findRedundantSegment(s.a, s.b, aLine.layers(), aLine.net());

      if (rseg) {
        // another line could be referencing this segment too :(
        if (!aLine.containsLink(rseg)) aLine.link(rseg);
      } else {
        const newseg = PnsSegment.fromParentLine(aLine, s);
        aLine.link(newseg);
        this.addSegment(newseg, true);
      }
    }
  }

  // ----- edge exclusions -----------------------------------------------------------

  addEdgeExclusion(aShape: Shape): void {
    this.mEdgeExclusions.push(aShape);
  }

  /**
   * Is this point inside a castellation cut-out? A linear scan, as upstream.
   *
   * Note for PR 3: `Branch()` does **not** copy `m_edgeExclusions`, so a branch
   * has none, and whether a castellation exclusion is honoured then depends on
   * which node reached `Collide`.
   */
  queryEdgeExclusions(aPos: Vec2): boolean {
    const p = pointShape(aPos);

    for (const edgeExclusion of this.mEdgeExclusions) {
      if (getShapeCollider()(edgeExclusion, p, 0).collides) return true;
    }

    return false;
  }

  // ----- removing ------------------------------------------------------------------

  /**
   * The shared tail of every removal. Three *independent* questions, not a chain:
   *
   *  1. is it the root's, and am I not the root? → tombstone it in the override
   *     set, along with its hole, but leave it where it is;
   *  2. otherwise → physically unindex it, and its hole;
   *  3. **separately** — do I own it? → orphan it and put it on the root's
   *     garbage list, unindexing the hole if step 2 did not already.
   *
   * Cases 1 and 2 are mutually exclusive; case 3 is orthogonal to both. At the
   * root, case 1 never fires and case 2's condition is always true.
   *
   * Note that case 3 reads `hole()` directly rather than asking `hasHole()`, so
   * a virtual via — which owns a hole but reports having none — has that hole
   * unindexed here even though it was never indexed in the first place.
   */
  private doRemove(aItem: PnsItem): void {
    let holeRemoved = false; // fixme: better logic, I don't like this

    // case 1: removing an item that is stored in the root node from any branch:
    // mark it as overridden, but do not remove
    if (aItem.belongsTo(this.mRoot) && !this.isRoot()) {
      this.mOverride.add(aItem);

      const hole = aItem.hole();

      if (aItem.hasHole() && hole) this.mOverride.add(hole);
    }

    // case 2: the item belongs to this branch or a parent, non-root branch,
    // or the root itself and we are the root: remove from the index
    else if (!aItem.belongsTo(this.mRoot) || this.isRoot()) {
      this.mIndex.remove(aItem);

      const hole = aItem.hole();

      if (aItem.hasHole() && hole) {
        this.mIndex.remove(hole);
        holeRemoved = true;
      }
    }

    // the item belongs to this particular branch: un-reference it
    if (aItem.belongsTo(this)) {
      aItem.setOwner(null);
      this.mRoot.mGarbageItems.add(aItem);

      const hole = aItem.hole();

      if (hole) {
        // the hole is not directly owned by the NODE but by the parent SOLID/VIA
        if (!holeRemoved) this.mIndex.remove(hole);

        hole.setOwner(aItem);
      }
    }
  }

  /** Despite the name this touches only the joints; `doRemove` does the index. */
  private removeSegmentIndex(aSeg: PnsSegment): void {
    this.unlinkJoint(aSeg.seg().a, aSeg.layers(), aSeg.net(), aSeg);
    this.unlinkJoint(aSeg.seg().b, aSeg.layers(), aSeg.net(), aSeg);
  }

  private removeArcIndex(aArc: PnsArc): void {
    this.unlinkJoint(aArc.anchor(0), aArc.layers(), aArc.net(), aArc);
    this.unlinkJoint(aArc.anchor(1), aArc.layers(), aArc.net(), aArc);
  }

  /**
   * A via merged the joints of every layer it landed on, so removing it has to
   * split them again.
   *
   * Upstream asserts the joint exists; in a release build a missing one reaches
   * `rebuildJoint`, which returns immediately and leaves the links uncleaned.
   * That release behaviour is what is ported — this must not throw.
   */
  private removeViaIndex(aVia: PnsVia): void {
    const jt = this.findJoint(aVia.pos(), aVia.layers().start(), aVia.net());

    this.rebuildJoint(jt, aVia);
  }

  private removeSolidIndex(aSolid: PnsSolid): void {
    if (!aSolid.isRoutable()) return;

    // fixme: redundant code
    const jt = this.findJoint(aSolid.pos(), aSolid.layers().start(), aSolid.net());

    this.rebuildJoint(jt, aSolid);
  }

  removeSolid(aSolid: PnsSolid): void {
    this.removeSolidIndex(aSolid);
    this.doRemove(aSolid);
  }

  removeVia(aVia: PnsVia): void {
    this.removeViaIndex(aVia);
    this.doRemove(aVia);
  }

  removeSegment(aSegment: PnsSegment): void {
    this.removeSegmentIndex(aSegment);
    this.doRemove(aSegment);
  }

  removeArc(aArc: PnsArc): void {
    this.removeArcIndex(aArc);
    this.doRemove(aArc);
  }

  /**
   * `Remove( ITEM* )`: the kind dispatcher.
   *
   * Two oddities are upstream's and are kept. The solid and via arms call
   * `Remove` on their hole first, which falls straight through to the default
   * arm and **does nothing** — the hole is actually unindexed by `doRemove`;
   * the call only exists to be followed by re-setting the hole's owner. And
   * removing a `HOLE` or a `JOINT` directly is a silent no-op.
   *
   * The `LINE_T` arm removes the links but does **not** clear the line's link
   * list or null its owner, which is exactly where it differs from
   * {@link removeLine}.
   */
  removeItem(aItem: PnsItem): void {
    switch (aItem.kind()) {
      case PnsKind.ARC_T:
        this.removeArc(aItem as PnsArc);
        break;

      case PnsKind.SOLID_T: {
        const solid = aItem as PnsSolid;
        const hole = solid.hole();

        if (solid.hasHole() && hole) {
          this.removeItem(hole);
          hole.setOwner(solid);
        }

        this.removeSolid(solid);
        break;
      }

      case PnsKind.SEGMENT_T:
        this.removeSegment(aItem as PnsSegment);
        break;

      case PnsKind.LINE_T: {
        const l = aItem as PnsLine;

        for (const s of l.links()) this.removeItem(s);

        break;
      }

      case PnsKind.VIA_T: {
        const via = aItem as PnsVia;
        const hole = via.hole();

        if (via.hasHole() && hole) {
          this.removeItem(hole);
          hole.setOwner(via);
        }

        this.removeVia(via);
        break;
      }

      default:
        break;
    }
  }

  /**
   * `Remove( LINE& )`: the other line removal path.
   *
   * Unlike the `LINE_T` arm of {@link removeItem}, this one also removes the
   * line's **via**, and it detaches the line afterwards — owner nulled, links
   * cleared. The asymmetry between the two is real and both are kept, because
   * shove holds line objects across node operations and relies on the links
   * surviving in some paths.
   */
  removeLine(aLine: PnsLine): void {
    // LINE does not have a separate remover, as LINEs are never truly a member
    // of the tree.
    for (const li of aLine.links()) {
      if (li.ofKind(PnsKind.SEGMENT_T)) this.removeSegment(li as PnsSegment);
      else if (li.ofKind(PnsKind.ARC_T)) this.removeArc(li as PnsArc);
      else if (li.ofKind(PnsKind.VIA_T)) this.removeVia(li as PnsVia);
    }

    aLine.setOwner(null);
    aLine.clearLinks();
  }

  // ----- replacing -------------------------------------------------------------------

  /**
   * `Replace( ITEM*, std::unique_ptr<ITEM> )`. The new item goes in through the
   * private dispatcher, so there is no redundancy check and no LINE support, and
   * nothing carries the old item's rank or marker across.
   */
  replaceItem(aOldItem: PnsItem, aNewItem: PnsItem): void {
    this.removeItem(aOldItem);
    this.addItem(aNewItem);
  }

  /** `Replace( LINE&, LINE&, bool )`. **`aOldLine` is mutated** — see {@link removeLine}. */
  replaceLine(aOldLine: PnsLine, aNewLine: PnsLine, aAllowRedundantSegments = false): void {
    this.removeLine(aOldLine);
    this.addLine(aNewLine, aAllowRedundantSegments);
  }

  // ----- redundancy ---------------------------------------------------------------

  /**
   * A segment already in the node with the same unordered endpoint pair.
   *
   * The search goes through the joint at `A`, which is sufficient because any
   * coincident segment necessarily shares that joint. Note the layer test is
   * `start() === start()` — **not** the full range and **not** an overlap.
   */
  private findRedundantSegment(
    aA: Vec2,
    aB: Vec2,
    aLayers: PnsLayerRange,
    aNet: NetHandle,
  ): PnsSegment | null {
    const jtStart = this.findJoint(aA, aLayers.start(), aNet);

    if (!jtStart) return null;

    for (const item of jtStart.linkList()) {
      if (item.ofKind(PnsKind.SEGMENT_T)) {
        const seg2 = item as PnsSegment;
        const a2 = seg2.seg().a;
        const b2 = seg2.seg().b;

        if (
          seg2.layers().start() === aLayers.start() &&
          ((samePoint(aA, a2) && samePoint(aB, b2)) || (samePoint(aA, b2) && samePoint(aB, a2)))
        ) {
          return seg2;
        }
      }
    }

    return null;
  }

  private findRedundantSegmentFor(aSeg: PnsSegment): PnsSegment | null {
    return this.findRedundantSegment(aSeg.seg().a, aSeg.seg().b, aSeg.layers(), aSeg.net());
  }

  /** The arc counterpart, anchored at `Anchor(0)` / `Anchor(1)`. */
  private findRedundantArc(
    aA: Vec2,
    aB: Vec2,
    aLayers: PnsLayerRange,
    aNet: NetHandle,
  ): PnsArc | null {
    const jtStart = this.findJoint(aA, aLayers.start(), aNet);

    if (!jtStart) return null;

    for (const item of jtStart.linkList()) {
      if (item.ofKind(PnsKind.ARC_T)) {
        const seg2 = item as PnsArc;
        const a2 = seg2.anchor(0);
        const b2 = seg2.anchor(1);

        if (
          seg2.layers().start() === aLayers.start() &&
          ((samePoint(aA, a2) && samePoint(aB, b2)) || (samePoint(aA, b2) && samePoint(aB, a2)))
        ) {
          return seg2;
        }
      }
    }

    return null;
  }

  // ----- queries -------------------------------------------------------------------

  /**
   * Every item whose shape contains the point.
   *
   * There is **no kind, layer or net filter**, and there is no deduplication: a
   * multilayer item is filed once per layer and is therefore reported once per
   * layer. A through-via on 32 layers appears 32 times. That is upstream's, and
   * callers that need unique hits must dedup at the call site rather than here,
   * because callers that count hits depend on the repeats.
   */
  hitTest(aPoint: Vec2): PnsItemSet {
    const items = new PnsItemSet();

    // fixme: we treat a point as an infinitely small circle - this is inefficient.
    const s = pointShape(aPoint);
    const collide = getShapeCollider();

    const visitor: IndexVisitor = (aItem: PnsItem): boolean => {
      const cp = pointShape(aPoint);
      const cl = 0;

      // TODO(JE) padstacks -- this may not work
      const shape = aItem.shape(-1);

      // Upstream dereferences the shape unconditionally; an item with none on
      // the merged layer is simply not a hit here.
      if (shape && collide(shape, cp, cl).collides) items.add(aItem);

      return true;
    };

    this.mIndex.queryShape(s, this.mMaxClearance, visitor);

    // PR 3, `pns_node.cpp:583-595`: a branch queries the root's index with a
    // second, separate visitor and merges everything it does not override. Note
    // the `visitor.SetWorld( m_root, nullptr )` at `:586` is dead even upstream
    // — the root pass uses the other visitor, which is never given a world.

    return items;
  }

  /**
   * Every routable item on a net.
   *
   * Note the `isRoutable()` filter, which the collision queries do **not**
   * apply: an unroutable pad is an obstacle but is not "on the net" for the
   * purposes of connectivity.
   */
  allItemsInNet(aNet: NetHandle, aKindMask = -1): Set<PnsItem> {
    const items = new Set<PnsItem>();
    const lCur = this.mIndex.getItemsForNet(aNet);

    if (lCur) {
      for (const item of lCur) {
        if (item.ofKind(aKindMask) && item.isRoutable()) items.add(item);
      }
    }

    // PR 3, `pns_node.cpp:1666-1678`: the root's net list too, filtered by
    // `!Overrides( item )`.

    return items;
  }

  /**
   * Clear every item's rank and the given marker bits.
   *
   * `ITEM::Mark` **assigns** rather than ORs, which is why this reads the marker
   * back out and masks it by hand rather than calling `unmark`.
   */
  clearRanks(aMarkerMask: number = LineMarker.MK_HEAD | LineMarker.MK_VIOLATION): void {
    for (const item of this.mIndex) {
      item.setRank(-1);
      item.mark(item.marker() & ~aMarkerMask);
    }
  }

  /** Remove every item carrying any of the given marker bits. */
  removeByMarker(aMarker: number): void {
    const garbage: PnsItem[] = [];

    for (const item of this.mIndex) {
      if (item.marker() & aMarker) garbage.push(item);
    }

    for (const item of garbage) this.removeItem(item);
  }

  /**
   * Every item made from a given board item. Local index only — never the root,
   * so on a fresh branch (whose index is empty) this is always empty.
   *
   * `FindItemByParent` — its single-result sibling — is **not** ported: it
   * narrows by `BOARD_ITEM::IsConnected()` and `GetNet()`, neither of which
   * `PnsBoardItem` models here, and scanning the whole index instead would find
   * net-null items that upstream's net-map narrowing misses.
   */
  findItemsByParent(aParent: PnsBoardItem | null): PnsItem[] {
    const ret: PnsItem[] = [];

    for (const item of this.mIndex) {
      if (item.parent() === aParent) ret.push(item);
    }

    return ret;
  }

  /**
   * The via a handle refers to. Handles exist because a pointer does not survive
   * branching; the lookup goes through the joint map, and therefore through
   * whatever `findJoint` can see.
   */
  findViaByHandle(aHandle: ViaHandle): PnsVia | null {
    const jt = this.findJoint(aHandle.pos, aHandle.layers.start(), aHandle.net);

    if (!jt) return null;

    for (const item of jt.linkList()) {
      if (item.ofKind(PnsKind.VIA_T)) {
        if (item.net() === aHandle.net && item.layers().overlaps(aHandle.layers)) {
          return item as PnsVia;
        }
      }
    }

    return null;
  }

  // ----- virtual vias ---------------------------------------------------------------

  /**
   * Drop a virtual via at every joint that shove needs something to push on.
   *
   * A VVIA is not on the board. It exists so that force propagation has an
   * object with a *position* where otherwise there would only be two segments
   * meeting. It is virtual, so `getClearance` gives it zero and collision
   * searches skip it as a head — but it **is** a joint link, so it changes what
   * `isLineCorner`, `isNonFanoutVia` and `nextSegment` answer.
   *
   * ### `n_seg` is never incremented, and must not be
   *
   * Upstream declares `int n_seg = 0` (`pns_node.cpp:1282`) and tests
   * `n_seg >= 3` (`:1333`). Those are the only two occurrences of the variable
   * in the entire file: **nothing increments it.** The disjunct is dead, and no
   * virtual via is ever created at a T-junction — they come only from a
   * width-or-mask change and from locked segments.
   *
   * Adding the `++` is a one-character "obvious fix" and it is not one. A VVIA
   * would then appear at every three-way junction, changing what `isLineCorner`,
   * `isNonFanoutVia` and `nextSegment` return there, making `assembleLine`
   * terminate at junctions it currently walks through, and altering shove's
   * force propagation on **every board with a T**. Reproduced dead.
   *
   * ### Three more things kept as they are
   *
   *  - `is_locked` and `locked_seg` are **assigned, not accumulated**, so only
   *    the last segment link examined decides. A locked segment followed by an
   *    unlocked one leaves `is_locked` false.
   *  - `locked_seg` is declared **outside** the joint loop, so in principle a
   *    previous joint's segment could reach the `is_locked` block. It cannot:
   *    `is_locked` *is* per-joint and is only ever set in the same branch that
   *    sets `locked_seg`, so whenever it is true the segment is this joint's.
   *    The placement is kept because a later upstream edit could make it matter.
   *  - **Arcs are invisible here.** The branches test `VIA_T`, then `SOLID_T`,
   *    then a downcast to `SEGMENT`; an `ARC` matches none of them and
   *    contributes to neither `max_w` nor `is_width_change`.
   */
  fixupVirtualVias(): void {
    let lockedSeg: PnsSegment | null = null;
    const vvias: PnsVVia[] = [];

    // Upstream copies each joint by value; the loop only reads it, and the vvias
    // are added after the walk, so the copy is unobservable and is not made.
    for (const joint of this.allJoints()) {
      if (joint.layers().isMultilayer()) continue;

      // Upstream writes `int n_seg = 0;` and never increments it — see the
      // docblock. It is `const` here only because nothing assigns to it, which
      // is precisely the bug being reproduced; do not "restore" the counter.
      const nSeg = 0;
      let nSolid = 0;
      let nVias = 0;
      let prevW = -1;
      let prevMask = false;
      let prevMaskMargin: number | undefined;
      let maxW = -1;
      let isWidthChange = false;
      let isLocked = false;

      for (const item of joint.linkList()) {
        if (item.ofKind(PnsKind.VIA_T)) {
          nVias++;
        } else if (item.ofKind(PnsKind.SOLID_T)) {
          nSolid++;
        } else if (item.kind() === PnsKind.SEGMENT_T) {
          const t = item as PnsSegment;
          const w = t.width();
          let mask = false;
          let maskMargin: number | undefined;
          const track = t.parent() as PnsTrackBoardItem | null;

          if (track) {
            mask = track.hasSolderMask ?? false;
            maskMargin = track.localSolderMaskMargin;
          }

          if (prevW < 0) {
            prevW = w;
            prevMask = mask;
            prevMaskMargin = maskMargin;
          } else if (w !== prevW || mask !== prevMask || maskMargin !== prevMaskMargin) {
            isWidthChange = true;
          }

          maxW = Math.max(w, maxW);
          prevW = w;

          isLocked = t.isLocked();
          lockedSeg = t;
        }
      }

      if ((isWidthChange || nSeg >= 3 || isLocked) && nSolid === 0 && nVias === 0) {
        // fixme: the hull margin here is an ugly temporary workaround. The real
        // fix is to use octagons for via force propagation.
        vvias.push(
          new PnsVVia(joint.pos(), joint.layers().start(), maxW + 2 * PNS_HULL_MARGIN, joint.net()),
        );
      }

      if (isLocked && lockedSeg) {
        const seg = lockedSeg.seg();
        const secondPos = samePoint(seg.a, joint.pos()) ? seg.b : seg.a;

        vvias.push(
          new PnsVVia(secondPos, joint.layers().start(), maxW + 2 * PNS_HULL_MARGIN, joint.net()),
        );
      }
    }

    for (const vvia of vvias) this.addVia(vvia);
  }
}
