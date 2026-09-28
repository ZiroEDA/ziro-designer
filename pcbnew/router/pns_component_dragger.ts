// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::COMPONENT_DRAGGER`, dragging a footprint with its tracks attached.
 * Counterpart: `pcbnew/router/pns_component_dragger.{h,cpp}`.
 *
 * ## The classification `Start` performs, which is the whole algorithm
 *
 * Every track hanging off a dragged pad is one of two things:
 *
 * - **rigid** (`m_fixedItems`) — both of its ends land on pads that are *also*
 *   being dragged, so the track translates whole rather than being re-routed.
 *   A two-pad link inside the footprint is the obvious case, and it is tested
 *   twice: once on the raw item's far anchor, once on the whole assembled
 *   line's far joint.
 * - **a connection** (`m_conns`) — one end is on a dragged pad and the other is
 *   somewhere on the board, so the pad end is dragged and the rest of the line
 *   re-cut by `LINE::DragCorner`.
 *
 * Pads also pick up tracks that merely *touch* them without sharing a joint:
 * `Start` sweeps the pad's hull bounding box for single-link joints of the same
 * net whose item collides with the pad, and records the joint's offset from the
 * pad centre so the anchor can be recomputed each move.
 *
 * ## No shove, no walkaround, no branch reuse
 *
 * Unlike `DRAGGER`, this one re-branches **the world** on every `Drag` (after
 * `KillChildren()`), and never consults the collision engine until `FixRoute`.
 * Dragging a footprint is therefore always "successful"; only committing can
 * fail.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsArc } from './pns_arc.js';
import { PNS_UNDEFINED_LAYER, PnsDragAlgo, PnsDragMode } from './pns_drag_algo.js';
import { PnsKind, type PnsItem, type PnsLinkedItem } from './pns_item.js';
import { itemHull } from './pns_item_hull.js';
import { PnsItemSet } from './pns_itemset.js';
import type { PnsJoint } from './pns_joint.js';
import type { PnsLine } from './pns_line_item.js';
import { lineDragCorner } from './pns_line_drag.js';
import type { PnsNode } from './pns_node.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsSolid } from './pns_solid.js';

/** `COMPONENT_DRAGGER::DRAGGED_CONNECTION`. */
interface DraggedConnection {
  origLine: PnsLine;
  attachedPad: PnsSolid;
  pOrig: Vec2;
  pNext: Vec2;
  offset: Vec2;
}

/** `PNS::COMPONENT_DRAGGER`. */
export class PnsComponentDragger extends PnsDragAlgo {
  /** Pads being dragged. */
  private mSolids = new Set<PnsSolid>();
  /** Items being moved along with the pads. */
  private mFixedItems = new Set<PnsItem>();
  /** Lines being dragged with the pads. */
  private mConns: DraggedConnection[] = [];

  private mDragStatus = false;
  private mDraggedItems = new PnsItemSet();
  private mInitialDraggedItems = new PnsItemSet();
  private mCurrentNode: PnsNode | null = null;
  private mP0: Vec2 = { x: 0, y: 0 };

  override currentNode(): PnsNode | null {
    return this.mCurrentNode ? this.mCurrentNode : this.mWorld;
  }

  override traces(): PnsItemSet {
    return this.mDraggedItems;
  }

  /** Upstream returns an empty vector; component dragging has no "current net". */
  override currentNets(): NetHandle[] {
    return [];
  }

  /** Upstream answers `UNDEFINED_LAYER`; component dragging has no one layer. */
  override currentLayer(): number {
    return PNS_UNDEFINED_LAYER;
  }

  override mode(): PnsDragMode {
    return PnsDragMode.DM_COMPONENT;
  }

  /** Always false: this dragger has no mark-obstacles fallback to latch into. */
  override getForceMarkObstaclesMode(aDragStatus: { value: boolean }): boolean {
    aDragStatus.value = this.mDragStatus;

    return false;
  }

  /** The rigid set, for tests; upstream's is private. */
  fixedItems(): ReadonlySet<PnsItem> {
    return this.mFixedItems;
  }

  /** The dragged connections, for tests. */
  connections(): readonly DraggedConnection[] {
    return this.mConns;
  }

  /**
   * `COMPONENT_DRAGGER::Start` (`:48-160`).
   *
   * `assert( m_world )` is upstream's first line and there is no null check
   * behind it, so a release build dereferences null immediately after. Kept as
   * an unguarded use.
   */
  override start(aP: Vec2, aPrimitives: PnsItemSet): boolean {
    const world = this.mWorld as PnsNode;

    this.mCurrentNode = null;
    this.mInitialDraggedItems = aPrimitives;
    this.mP0 = aP;

    const seenItems = new Set<PnsLinkedItem>();

    /**
     * `addLinked`. The two "goes straight between two dragged pads" tests are
     * the same question asked of two different things: first the raw link's far
     * anchor, then the whole assembled line's far end. A track can fail the
     * first and pass the second when the far pad is several segments away.
     */
    const addLinked = (
      aSolid: PnsSolid,
      aJoint: PnsJoint,
      aItem: PnsLinkedItem,
      aOffset: Vec2 = { x: 0, y: 0 },
    ): void => {
      if (seenItems.has(aItem)) return;

      seenItems.add(aItem);

      // Segments that go directly between two linked pads are special-cased.
      const otherEnd = samePoint(aJoint.pos(), aItem.anchor(0)) ? aItem.anchor(1) : aItem.anchor(0);
      const otherJoint = world.findJoint(otherEnd, aItem.layer(), aItem.net());

      if (otherJoint?.linkCount(PnsKind.SOLID_T)) {
        for (const otherItem of otherJoint.linkList()) {
          if (aPrimitives.contains(otherItem)) {
            this.mFixedItems.add(aItem);

            return;
          }
        }
      }

      const segIndex = { value: 0 };
      const origLine = world.assembleLine(aItem, segIndex);

      // Lines that go directly between two linked pads are also special-cased.
      const line = origLine.cLine();
      const jA = world.findJoint(line.cPoint(0), aItem.layer(), aItem.net());
      const jB = world.findJoint(line.cLastPoint(), aItem.layer(), aItem.net());

      // `wxASSERT( jA == aJoint || jB == aJoint )`: when it does not hold — the
      // assembled line's ends are not this joint — upstream's ternary still
      // picks `jB`, and the release build carries on with it.
      const jSearch = jA === aJoint ? jB : jA;

      if (jSearch?.linkCount(PnsKind.SOLID_T)) {
        for (const otherItem of jSearch.linkList()) {
          if (aPrimitives.contains(otherItem)) {
            for (const item of origLine.links()) this.mFixedItems.add(item);

            return;
          }
        }
      }

      this.mConns.push({
        origLine,
        attachedPad: aSolid,
        offset: aOffset,
        pOrig: { x: 0, y: 0 },
        pNext: { x: 0, y: 0 },
      });
    };

    for (const item of aPrimitives.items()) {
      if (item.kind() !== PnsKind.SOLID_T) continue;

      const solid = item as PnsSolid;

      this.mSolids.add(solid);

      if (!item.isRoutable()) continue;

      // `FindJoint( solid->Pos(), solid )` is dereferenced with no null check.
      const jt = world.findJointForItem(solid.pos(), solid) as PnsJoint;

      for (const link of jt.linkList()) {
        if (link.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
          addLinked(solid, jt, link as PnsLinkedItem);
        }
      }

      const extraJoints = world.queryJoints(
        hullBBox(itemHull(solid, 0, 0, PNS_UNDEFINED_LAYER)),
        solid.layers(),
        PnsKind.SEGMENT_T | PnsKind.ARC_T,
      );

      for (const extraJoint of extraJoints) {
        if (extraJoint.net() === jt.net() && extraJoint.linkCount() === 1) {
          const li = extraJoint.linkList()[0] as PnsLinkedItem;

          if (li.collide(solid, world, solid.layer())) {
            addLinked(solid, extraJoint, li, {
              x: extraJoint.pos().x - solid.pos().x,
              y: extraJoint.pos().y - solid.pos().y,
            });
          }
        }
      }
    }

    return true;
  }

  /**
   * `COMPONENT_DRAGGER::Drag` (`:163-247`).
   *
   * Two upstream details worth keeping in view:
   *
   * - **A non-routable pad short-circuits before its connections' anchors are
   *   updated.** Any `DRAGGED_CONNECTION` attached to it therefore keeps
   *   whatever `p_orig`/`p_next` the previous move left — `(0, 0)` on the first
   *   move, since the struct is value-initialised.
   * - **`CLine().Find( cn.p_orig )` is −1 whenever the anchor is not a vertex**
   *   of the assembled line, and upstream hands that straight to `DragCorner`,
   *   whose `wxCHECK_RET( aIndex >= 0 )` makes the call a no-op. The line is
   *   then removed and re-added unchanged.
   */
  override drag(aP: Vec2): boolean {
    const world = this.mWorld as PnsNode;

    world.killChildren();
    this.mCurrentNode = world.branch();

    for (const item of this.mInitialDraggedItems.items()) this.mCurrentNode.removeItem(item);

    this.mDraggedItems.clear();

    const delta = { x: aP.x - this.mP0.x, y: aP.y - this.mP0.y };

    for (const s of this.mSolids) {
      const pNext = { x: delta.x + s.pos().x, y: delta.y + s.pos().y };
      const snew = s.clone();

      snew.setPos(pNext);

      this.mDraggedItems.add(snew);
      this.mCurrentNode.addSolid(snew);

      if (!s.isRoutable()) continue;

      for (const l of this.mConns) {
        if (l.attachedPad === s) {
          l.pOrig = { x: s.pos().x + l.offset.x, y: s.pos().y + l.offset.y };
          l.pNext = { x: pNext.x + l.offset.x, y: pNext.y + l.offset.y };
        }
      }
    }

    for (const item of this.mFixedItems) {
      this.mCurrentNode.removeItem(item);

      switch (item.kind()) {
        case PnsKind.SEGMENT_T: {
          const s = item as PnsSegment;
          const sNew = s.clone();
          const orig = s.seg();

          sNew.setEnds(
            { x: delta.x + orig.a.x, y: delta.y + orig.a.y },
            { x: delta.x + orig.b.x, y: delta.y + orig.b.y },
          );

          this.mDraggedItems.add(sNew);
          this.mCurrentNode.addSegment(sNew);

          break;
        }

        case PnsKind.ARC_T: {
          const a = item as PnsArc;
          const aNew = a.clone();
          const arc = aNew.arc();

          // `SHAPE_ARC::Move( aVector )`.
          aNew.setArc({
            p0: { x: arc.p0.x + delta.x, y: arc.p0.y + delta.y },
            arcMid: { x: arc.arcMid.x + delta.x, y: arc.arcMid.y + delta.y },
            p1: { x: arc.p1.x + delta.x, y: arc.p1.y + delta.y },
            width: arc.width,
          });

          this.mDraggedItems.add(aNew);
          this.mCurrentNode.addArc(aNew);

          break;
        }

        default:
          // `wxFAIL_MSG( "Unexpected item type in COMPONENT_DRAGGER::m_fixedItems" )`:
          // a debug-only assert, and the release build simply drops the item —
          // which it has already been removed from the node, so it disappears.
          break;
      }
    }

    for (const cn of this.mConns) {
      const lNew = cn.origLine.clone();

      lNew.unmark();
      lNew.clearLinks();
      lineDragCorner(lNew, cn.pNext, cn.origLine.cLine().find(cn.pOrig));

      this.mDraggedItems.addLine(lNew);

      const lOrig = cn.origLine.clone();

      this.mCurrentNode.removeLine(lOrig);
      this.mCurrentNode.addLine(lNew);
    }

    return true;
  }

  /**
   * `COMPONENT_DRAGGER::FixRoute` (`:250-263`).
   *
   * Note `m_dragStatus` is never written by this class — it is initialised
   * false in the constructor and reported by `GetForceMarkObstaclesMode`
   * unchanged, forever. Upstream's; not a transcription slip.
   */
  override fixRoute(aForceCommit: boolean): boolean {
    const node = this.currentNode();

    if (node) {
      if (
        this.settings().allowDrcViolations ||
        aForceCommit ||
        !node.checkColliding(this.mDraggedItems)
      ) {
        this.mRouter.commitRouting(node);

        return true;
      }
    }

    return false;
  }
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** `SHAPE_LINE_CHAIN::BBox()` over a hull's points. */
function hullBBox(aHull: readonly Vec2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (aHull.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const p of aHull) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}
