// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A point where board items meet, and the list of what meets there.
 * Counterpart: `pcbnew/router/pns_joint.h` (`JOINT`), ported whole.
 *
 * A joint is what makes the router's world a *graph* rather than a pile of
 * shapes. Following a track from one end to the other is following joints; the
 * decision of where a line stops being one line is a question asked of a joint;
 * loop removal is finding two paths between the same pair of joints. Almost
 * every predicate below exists to answer one specific such question, and their
 * exact thresholds are the difference between a router that can pick up a track
 * and one that grabs a single segment of it.
 *
 * ## A joint is an ITEM, but not one you will find in the index
 *
 * It inherits `ITEM` for the layer range, the net and the marker, and its kind
 * is `JOINT_T` — but nothing adds a joint to a spatial index, and `Clone()`
 * asserts rather than returning anything. The inheritance is for the shared
 * fields, not for polymorphic use.
 *
 * ## Identity is position and net; layers are not part of it
 *
 * Two joints are `==` when their position and net match, layers ignored. But
 * `Overlaps` — which is what actually decides whether two joints *merge* — also
 * demands overlapping layers. So a via's joint at (x, y) on layers 0-31 and a
 * segment's joint at (x, y) on layer 0 are equal *and* overlapping and become
 * one; the same via against a segment on a net of its own is neither. The two
 * predicates are separate on purpose and are not interchangeable.
 *
 * ## Emptying a joint empties its layers
 *
 * `unlink` sets the layer range back to the nothing-range when the last link
 * goes, and since an empty range overlaps nothing, a dangling joint can no
 * longer merge with or be found by anything. That is how joints get collected
 * without anyone sweeping for them.
 */
import { PnsItemSet } from './pns_itemset.js';
import { PnsKind, PnsItem, type PnsLinkedItem } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import type { NetHandle } from './pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `JOINT::HASH_TAG`: what a joint is hashed by inside a node's joint map.
 * Linked items are, obviously, not hashed.
 *
 * The map itself belongs to `NODE` and is not in this change. The tag and its
 * equality are here because they are the joint's own identity.
 */
export interface JointTag {
  pos: Vec2;
  net: NetHandle;
}

/** `operator==( JOINT::HASH_TAG const&, JOINT::HASH_TAG const& )`. */
export const jointTagsEqual = (a: JointTag, b: JointTag): boolean =>
  a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.net === b.net;

/**
 * A 2D point on a given set of layers, belonging to a certain net, that links
 * together a number of board items.
 */
export class PnsJoint extends PnsItem {
  private mTag: JointTag;
  private mLinkedItems = new PnsItemSet();
  private mLocked = false;

  constructor(aPos?: Vec2, aLayers?: PnsLayerRange, aNet: NetHandle = null) {
    super(PnsKind.JOINT_T);

    this.mTag = { pos: aPos ? { x: aPos.x, y: aPos.y } : { x: 0, y: 0 }, net: aNet };

    if (aLayers) this.mLayers = aLayers.clone();
  }

  /**
   * Upstream's `Clone()` is an `assert( false ); return nullptr;` — a joint is
   * not a cloneable board item. {@link copy} is the copy constructor, which is
   * a different thing and *is* used, by every node that branches.
   */
  clone(): PnsItem {
    throw new Error('PNS: JOINT::Clone() is not supported');
  }

  /**
   * `JOINT( const JOINT& )`. The link list is copied by value — the new joint
   * holds the same items, in the same order, but its own list. Marker and rank
   * are *not* carried over; upstream's copy constructor does not touch them.
   */
  copy(): PnsJoint {
    const j = new PnsJoint();
    j.mLayers = this.mLayers.clone();
    j.mTag = { pos: { x: this.mTag.pos.x, y: this.mTag.pos.y }, net: this.mTag.net };
    j.mLinkedItems = this.mLinkedItems.clone();
    j.mLocked = this.mLocked;
    return j;
  }

  /**
   * Does this joint connect two segments of the same net, layer and width?
   *
   * @param aAllowLockedSegs treat joints between locked and unlocked segments
   *                         as trivial too.
   */
  isLineCorner(aAllowLockedSegs = false): boolean {
    if (
      this.mLinkedItems.size() === 2 &&
      this.mLinkedItems.count(PnsKind.SEGMENT_T | PnsKind.ARC_T) === 2
    ) {
      const seg1 = this.mLinkedItems.at(0) as PnsLinkedItem;
      const seg2 = this.mLinkedItems.at(1) as PnsLinkedItem;

      if (!aAllowLockedSegs && (seg1.isLocked() || seg2.isLocked())) return false;

      // joints between segments of different widths are not considered trivial.
      return seg1.width() === seg2.width();
    }

    if (
      this.mLinkedItems.size() > 2 &&
      this.mLinkedItems.count(PnsKind.SEGMENT_T | PnsKind.ARC_T) === 2
    ) {
      if (!aAllowLockedSegs) return false;

      // There will be multiple virtual vias on joints between two locked
      // segments, because we naively add one to each end of a locked segment.
      let seg1: PnsLinkedItem | null = null;
      let seg2: PnsLinkedItem | null = null;

      for (const item of this.mLinkedItems.citems()) {
        if (item.isVirtual()) continue;

        if (item.kind() === PnsKind.SEGMENT_T || item.kind() === PnsKind.ARC_T) {
          if (!seg1) seg1 = item as PnsLinkedItem;
          else seg2 = item as PnsLinkedItem;
        } else {
          return false;
        }
      }

      if (seg1 && seg2) return seg1.width() === seg2.width();
    }

    return false;
  }

  /** A via with exactly one track in and one out — nothing fans out from it. */
  isNonFanoutVia(): boolean {
    let vias = 0;
    let segs = 0;
    let realItems = 0;

    for (const item of this.mLinkedItems.citems()) {
      if (item.isVirtual()) continue;

      if (item.kind() === PnsKind.VIA_T) vias++;
      else if (item.kind() === PnsKind.SEGMENT_T || item.kind() === PnsKind.ARC_T) segs++;

      realItems++;
    }

    return realItems === 3 && vias === 1 && segs === 2;
  }

  /** A via with nothing else attached: a stitching via, not part of a route. */
  isStitchingVia(): boolean {
    return this.mLinkedItems.size() === 1 && this.mLinkedItems.count(PnsKind.VIA_T) === 1;
  }

  isTrivialEndpoint(): boolean {
    // fixme: Arcs & trivial endpoint vias
    return this.mLinkedItems.size() === 1 && this.mLinkedItems.count(PnsKind.SEGMENT_T) === 1;
  }

  /** Two segments of *different* width meeting — where a track changes gauge. */
  isTraceWidthChange(): boolean {
    if (this.mLinkedItems.count(PnsKind.SEGMENT_T) !== 2) return false;

    let seg1: PnsLinkedItem | null = null;
    let seg2: PnsLinkedItem | null = null;

    for (const item of this.mLinkedItems.citems()) {
      if (item.isVirtual()) continue;

      if (item.kind() === PnsKind.VIA_T) {
        return false;
      }

      if (item.kind() === PnsKind.SEGMENT_T || item.kind() === PnsKind.ARC_T) {
        if (!seg1) seg1 = item as PnsLinkedItem;
        else seg2 = item as PnsLinkedItem;
      }
    }

    if (!seg1 || !seg2) return false;

    return seg1.width() !== seg2.width();
  }

  /** Link the joint to a board item, when it is added to a node. */
  link(aItem: PnsItem): void {
    if (this.mLinkedItems.contains(aItem)) return;

    this.mLinkedItems.add(aItem);
  }

  /**
   * Unlink a board item, upon its removal from a node.
   *
   * @returns true if the joint became dangling.
   */
  unlink(aItem: PnsItem): boolean {
    this.mLinkedItems.erase(aItem);

    if (this.mLinkedItems.size() === 0) this.mLayers = new PnsLayerRange(-1);

    return this.mLinkedItems.size() === 0;
  }

  /**
   * For trivial joints, the segment adjacent to `aCurrent`; for non-trivial
   * ones, null, meaning the line ends here.
   *
   * Any solid or (non-skipped) via ends the line outright, and so does a second
   * candidate segment — a fork is not something a line can be followed through.
   */
  nextSegment(aCurrent: PnsLinkedItem, aAllowLockedSegs = false): PnsLinkedItem | null {
    let otherItem: PnsLinkedItem | null = null;

    for (const item of this.mLinkedItems.citems()) {
      if (item === aCurrent) continue;

      if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
        if (item.net() === aCurrent.net() && item.layers().overlaps(aCurrent.layers())) {
          if (otherItem) return null;

          if (!item.isLocked() || aAllowLockedSegs) otherItem = item as PnsLinkedItem;
        }
      } else if (item.ofKind(PnsKind.SOLID_T | PnsKind.VIA_T)) {
        if (item.kind() === PnsKind.VIA_T && item.isVirtual() && aAllowLockedSegs) {
          // A virtual via sits at the joint between an unlocked and a locked seg.
          continue;
        }

        return null;
      }
    }

    return otherItem;
  }

  /** The first via linked here, if any. */
  via(): PnsItem | null {
    for (const item of this.mLinkedItems.citems()) {
      if (item.ofKind(PnsKind.VIA_T)) return item;
    }

    return null;
  }

  tag(): JointTag {
    return this.mTag;
  }

  pos(): Vec2 {
    return this.mTag.pos;
  }

  /** The joint's net lives in its tag, not in `ITEM::m_net`. */
  override net(): NetHandle {
    return this.mTag.net;
  }

  linkList(): readonly PnsItem[] {
    return this.mLinkedItems.citems();
  }

  cLinks(): PnsItemSet {
    return this.mLinkedItems;
  }

  links(): PnsItemSet {
    return this.mLinkedItems;
  }

  linkCount(aMask = -1): number {
    return this.mLinkedItems.count(aMask);
  }

  /** Position and net only — layers are deliberately not part of identity. */
  equals(aRhs: PnsJoint): boolean {
    return jointTagsEqual(this.mTag, aRhs.mTag);
  }

  /**
   * Absorb another joint: widen the layer span, inherit its lock, and take on
   * its links. Note that the links are appended *without* the duplicate check
   * `link()` does, which is upstream's behaviour and means merging a joint into
   * itself would double its list.
   */
  merge(aJoint: PnsJoint): void {
    if (!this.overlaps(aJoint)) return;

    this.mLayers.merge(aJoint.mLayers);

    if (aJoint.isLocked()) this.mLocked = true;

    for (const item of aJoint.linkList()) {
      this.mLinkedItems.add(item);
    }
  }

  /** Same point, same net, *and* touching layers — the merge precondition. */
  overlaps(aRhs: PnsJoint): boolean {
    return (
      this.mTag.pos.x === aRhs.mTag.pos.x &&
      this.mTag.pos.y === aRhs.mTag.pos.y &&
      this.mTag.net === aRhs.mTag.net &&
      this.mLayers.overlaps(aRhs.mLayers)
    );
  }

  lock(aLock = true): void {
    this.mLocked = aLock;
  }

  /**
   * A joint's lock is its own flag, not the `MK_LOCKED` marker bit `ITEM`
   * reads. Shadowing the base deliberately, as upstream does.
   */
  override isLocked(): boolean {
    return this.mLocked;
  }
}
