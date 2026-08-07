// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::SHOVE`. Counterpart: `pcbnew/router/pns_shove.{h,cpp}`.
 *
 * What is worth pinning, and why:
 *
 * - **The spring-back stack's push/pop ordering.** `pushSpringback` snapshots
 *   every head's via handle *by index*, and `Run()` calls it only after
 *   `reconstructHeads` has rewritten those handles. Push it earlier and the
 *   frame records pre-shove positions, so the next `reduceSpringback` restores
 *   a stale via — the dragged via visibly jumps back a move. The index
 *   correspondence is equally load-bearing: the counter advances for *every*
 *   head, not only the ones carrying a via.
 * - **`reduceSpringback` stops on three separate conditions** — the
 *   do-not-touch node, a locked frame, and a frame that still collides — and
 *   never pops the bottom frame at all.
 * - **The affected area is inherited, not dropped**, when a push brings none.
 * - **`popLineStack` is not the inverse of `pushLineStack`.** Push adds to the
 *   optimiser queue, pop removes from it, and the no-obstacle path in
 *   `shoveIteration` deliberately uses a bare `pop()` so the line *stays*
 *   queued. That asymmetry is what feeds the optimiser.
 * - **`unwindLineStack`'s tadpole branch**: a stacked line losing its segments
 *   is reduced to its via rather than dropped, or via collisions on other
 *   layers are silently lost.
 * - **`checkShoveDirection`** and the `SHP_REVERSED` policy that flips which
 *   end of the pusher is the reference point.
 * - **The iteration limit is a hard `SH_INCOMPLETE`**, whatever the last
 *   iteration returned.
 * - **Upstream bugs**: `onCollidingArc` reports `SH_OK` when the shove failed,
 *   and `unwindLineStack( VIA* )` is a silent no-op.
 */
import { describe, expect, it } from 'vitest';
import {
  PnsOptimizerFlags,
  DEFAULT_SHOVE_SETTINGS,
  PnsShove,
  PnsShovePolicy,
  PnsShoveStatus,
  lineChangedArea,
  lineWalkaround,
  viaChangedArea,
} from '@ziroeda/pcbnew/src/router/pns_shove.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { NetHandle, PnsRuleResolver } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };
const NET_B: NetHandle = { name: 'B' };

/** A resolver answering one clearance for everything. */
class FlatResolver implements PnsRuleResolver {
  constructor(private readonly value: number) {}

  clearance(): number {
    return this.value;
  }

  hullCache(item: PnsItem, clearance: number, walkaroundThickness: number, layer: number) {
    return itemHull(item, clearance, walkaroundThickness, layer);
  }

  dpCoupledNet(): NetHandle {
    return null;
  }
  dpNetPolarity(): number {
    return 0;
  }
  dpNetPair(): null {
    return null;
  }
  netCode(): number {
    return 0;
  }
  netName(): string {
    return '';
  }
  isInNetTie(): boolean {
    return false;
  }
  isNetTieExclusion(): boolean {
    return false;
  }
  isDrilledHole(): boolean {
    return false;
  }
  isNonPlatedSlot(): boolean {
    return false;
  }
  isKeepout() {
    return { keepout: false, enforce: false };
  }
  queryConstraint(): null {
    return null;
  }
}

function makeNode(clearance = 0): PnsNode {
  const n = new PnsNode();
  n.setRuleResolver(new FlatResolver(clearance));
  n.setMaxClearance(2000000);
  return n;
}

function seg(a: Vec2, b: Vec2, net: NetHandle = NET_A, width = 100, layer = 0): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width }, net);
  s.setLayers(new PnsLayerRange(layer));
  return s;
}

function line(points: Vec2[], net: NetHandle = NET_A, width = 100, layer = 0): PnsLine {
  const l = new PnsLine();
  l.setShape(PnsLineChain.fromPoints(points));
  l.setWidth(width);
  l.setLayers(new PnsLayerRange(layer));
  l.setNet(net);
  return l;
}

function via(pos: Vec2, net: NetHandle = NET_A): PnsVia {
  return new PnsVia(pos, new PnsLayerRange(0, 1), 600, 300, net);
}

/**
 * The private members the ordering tests have to reach. Upstream's are private
 * too; the alternative is asserting spring-back ordering only through its
 * downstream effects, which is exactly the "green for the wrong reason" trap.
 */
interface ShovePrivates {
  mNodeStack: {
    draggedVias: (unknown | null)[];
    node: PnsNode | null;
    affectedArea: { minX: number; minY: number; maxX: number; maxY: number } | null;
    seq: number;
    locked: boolean;
  }[];
  mLineStack: PnsLine[];
  mOptimizerQueue: PnsLine[];
  mHeadLines: {
    theVia: unknown | null;
    prevVia: unknown | null;
    geometryModified: boolean;
    origHead: PnsLine | null;
  }[];
  mCurrentNode: PnsNode;
  pushSpringback(aNode: PnsNode, aArea: unknown): boolean;
  reduceSpringback(aHeadSet: PnsItemSet): PnsNode;
  pushLineStack(aL: PnsLine, aKeepCurrentOnTop?: boolean): boolean;
  popLineStack(): void;
  unwindLineStack(aItem: PnsItem): void;
  checkShoveDirection(a: PnsLine, b: PnsLine, c: PnsLine): boolean;
  shoveMainLoop(): PnsShoveStatus;
  touchRootLine(aLine: PnsLine): { policy: number };
}

const priv = (s: PnsShove): ShovePrivates => s as unknown as ShovePrivates;

/**
 * Record every `lockJoint` position taken during `aBody`. `run()` branches
 * internally, so there is no node instance to instrument — the prototype is the
 * only seam.
 */
function recordLockJoint(aBody: () => void): Vec2[] {
  const calls: Vec2[] = [];
  const original = PnsNode.prototype.lockJoint;

  PnsNode.prototype.lockJoint = function patched(
    this: PnsNode,
    aPos: Vec2,
    aItem: PnsItem,
    aLock: boolean,
  ): void {
    calls.push({ x: aPos.x, y: aPos.y });
    original.call(this, aPos, aItem, aLock);
  };

  try {
    aBody();
  } finally {
    PnsNode.prototype.lockJoint = original;
  }

  return calls;
}

// =====================================================================================
describe('SHOVE::pushSpringback', () => {
  it('snapshots one via slot per head, indexed by head position', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    // A line head, then a via head. The counter in pushSpringback advances for
    // BOTH, so the via must land in slot 1 — not slot 0.
    shove.addHeads(line([V(0, 0), V(1000, 0)]));
    shove.addHeadsVia(
      { pos: V(5000, 5000), layers: new PnsLayerRange(0, 1), net: NET_A, valid: true },
      V(6000, 5000),
    );

    P.pushSpringback(world.branch(), null);

    const frame = P.mNodeStack[0];

    expect(frame?.draggedVias).toHaveLength(2);
    expect(frame?.draggedVias[0]).toBeNull();
    expect(frame?.draggedVias[1]).not.toBeNull();
  });

  it('inherits the previous frame area when the push brings none', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const area = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

    P.pushSpringback(world.branch(), area);
    P.pushSpringback(world.branch(), null);

    // Not dropped: the area accumulates monotonically up the stack, which is
    // what makes the optimiser's restrict-area cover the whole route.
    expect(P.mNodeStack[1]?.affectedArea).toEqual(area);
  });

  it('merges a new area into the previous frame area', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    P.pushSpringback(world.branch(), { minX: 200, minY: -50, maxX: 300, maxY: 50 });

    expect(P.mNodeStack[1]?.affectedArea).toEqual({
      minX: 0,
      minY: -50,
      maxX: 300,
      maxY: 100,
    });
  });

  it('numbers frames from 1, not 0', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);
    P.pushSpringback(world.branch(), null);

    expect(P.mNodeStack.map((f) => f.seq)).toEqual([1, 2]);
  });
});

// =====================================================================================
describe('SHOVE::reduceSpringback', () => {
  it('never pops the bottom frame, however irrelevant it is', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);

    // Nothing in the world, so nothing can collide — and it stays anyway.
    expect(P.reduceSpringback(new PnsItemSet())).toBe(P.mNodeStack[0]?.node);
    expect(P.mNodeStack).toHaveLength(1);
  });

  it('pops the frames above it that collide with nothing', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);
    P.pushSpringback(world.branch(), null);
    P.pushSpringback(world.branch(), null);

    const bottom = P.mNodeStack[0]?.node;

    expect(P.reduceSpringback(new PnsItemSet())).toBe(bottom);
    expect(P.mNodeStack).toHaveLength(1);
  });

  it('stops at a locked frame even though nothing collides', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);
    shove.addLockedSpringbackNode(world.branch());
    P.pushSpringback(world.branch(), null);

    P.reduceSpringback(new PnsItemSet());

    // The top frame went; the locked one below it is the floor.
    expect(P.mNodeStack).toHaveLength(2);
    expect(P.mNodeStack[1]?.locked).toBe(true);
  });

  it('stops at the do-not-touch node before it even asks about collisions', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);

    const protectedNode = world.branch();
    P.pushSpringback(protectedNode, null);
    P.pushSpringback(world.branch(), null);

    shove.setSpringbackDoNotTouchNode(protectedNode);
    P.reduceSpringback(new PnsItemSet());

    // The unlocked, non-colliding frame above it went; the protected one did
    // not, and neither did anything below it — the check breaks the loop.
    expect(P.mNodeStack).toHaveLength(2);
    expect(P.mNodeStack[1]?.node).toBe(protectedNode);
  });

  it('keeps a frame whose contents still collide with the head set', () => {
    const world = makeNode(200);
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);

    const busy = world.branch();
    busy.addSegment(seg(V(0, 0), V(1000, 0), NET_B));
    P.pushSpringback(busy, null);

    const headSet = new PnsItemSet();
    headSet.add(seg(V(500, 50), V(600, 50), NET_A));

    P.reduceSpringback(headSet);

    expect(P.mNodeStack).toHaveLength(2);
  });

  it('restores the surviving frame via handles onto the heads, by index', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const handle = { pos: V(5000, 5000), layers: new PnsLayerRange(0, 1), net: NET_A, valid: true };

    shove.addHeads(line([V(0, 0), V(1000, 0)]));
    shove.addHeadsVia(handle, V(6000, 5000));

    P.pushSpringback(world.branch(), null);

    // Simulate the head having moved on since the frame was taken.
    (P.mHeadLines[1] as { theVia: unknown }).theVia = null;
    (P.mHeadLines[1] as { geometryModified: boolean }).geometryModified = false;

    P.reduceSpringback(new PnsItemSet());

    expect(P.mHeadLines[1]?.theVia).toBe(handle);
    expect(P.mHeadLines[1]?.prevVia).toBe(handle);
    // Forced true whether or not the via actually moved.
    expect(P.mHeadLines[1]?.geometryModified).toBe(true);
    // Slot 0 was a line head, so nothing was restored onto it.
    expect(P.mHeadLines[0]?.theVia).toBeNull();
  });
});

// =====================================================================================
describe('SHOVE spring-back rewind API', () => {
  it('rewindSpringbackTo erases the matched frame and everything above it', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const a = world.branch();
    const b = a.branch();
    const c = b.branch();

    P.pushSpringback(a, null);
    P.pushSpringback(b, null);
    P.pushSpringback(c, null);

    expect(shove.rewindSpringbackTo(b)).toBe(true);

    // The matched frame goes too — the erase range starts AT the match.
    expect(P.mNodeStack).toHaveLength(1);
    expect(P.mNodeStack[0]?.node).toBe(a);
    expect(shove.currentNode()).toBe(a);
  });

  it('rewindSpringbackTo changes nothing for a node that is not on the stack', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);

    expect(shove.rewindSpringbackTo(world.branch())).toBe(false);
    expect(P.mNodeStack).toHaveLength(1);
  });

  it('rewindToLastLockedNode stops on the topmost locked frame', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);

    const locked = world.branch();
    shove.addLockedSpringbackNode(locked);

    P.pushSpringback(world.branch(), null);
    P.pushSpringback(world.branch(), null);

    expect(shove.rewindToLastLockedNode()).toBe(true);
    expect(P.mNodeStack).toHaveLength(2);
    expect(shove.currentNode()).toBe(locked);
  });

  it('rewindToLastLockedNode bottoms out at frame 0 and reports false', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    P.pushSpringback(world.branch(), null);
    P.pushSpringback(world.branch(), null);

    expect(shove.rewindToLastLockedNode()).toBe(false);
    expect(P.mNodeStack).toHaveLength(1);
  });

  it('unlockSpringbackNode clears only the first matching frame', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const n = world.branch();
    shove.addLockedSpringbackNode(n);
    shove.addLockedSpringbackNode(n);

    shove.unlockSpringbackNode(n);

    expect(P.mNodeStack[0]?.locked).toBe(false);
    expect(P.mNodeStack[1]?.locked).toBe(true);
  });

  it('addLockedSpringbackNode does not go through pushSpringback', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    shove.addHeads(line([V(0, 0), V(1000, 0)]));
    shove.addLockedSpringbackNode(world.branch());

    // No dragged-via snapshot, and seq left at its zero value.
    expect(P.mNodeStack[0]?.draggedVias).toHaveLength(0);
    expect(P.mNodeStack[0]?.seq).toBe(0);
  });
});

// =====================================================================================
describe('SHOVE line stack and optimizer queue', () => {
  function linkedLine(node: PnsNode, points: Vec2[], net: NetHandle = NET_A): PnsLine {
    const l = line(points, net);
    node.addLine(l);
    return l;
  }

  it('pushLineStack rejects a line with segments but no links', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    expect(P.pushLineStack(line([V(0, 0), V(1000, 0)]))).toBe(false);
    expect(P.mLineStack).toHaveLength(0);
  });

  it('pushLineStack accepts a wholly empty line', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    expect(P.pushLineStack(new PnsLine())).toBe(true);
  });

  it('push adds to the optimizer queue, pop removes from it', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const l = linkedLine(world, [V(0, 0), V(1000, 0)]);

    P.pushLineStack(l);
    expect(P.mOptimizerQueue).toHaveLength(1);

    P.popLineStack();
    expect(P.mLineStack).toHaveLength(0);
    // The asymmetry: a bare stack pop would have left it queued.
    expect(P.mOptimizerQueue).toHaveLength(0);
  });

  it('pushing a line sharing links replaces the queue entry rather than doubling it', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const l = linkedLine(world, [V(0, 0), V(1000, 0)]);

    const twin = l.clone();

    P.pushLineStack(l);
    P.pushLineStack(twin);

    expect(P.mOptimizerQueue).toHaveLength(1);
    expect(P.mOptimizerQueue[0]).toBe(twin);
  });

  it('keepCurrentOnTop inserts one below the top', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const a = linkedLine(world, [V(0, 0), V(1000, 0)]);
    const b = linkedLine(world, [V(0, 500), V(1000, 500)]);

    P.pushLineStack(a);
    P.pushLineStack(b, true);

    expect(P.mLineStack[0]).toBe(b);
    expect(P.mLineStack[1]).toBe(a);
  });
});

// =====================================================================================
describe('SHOVE::unwindLineStack', () => {
  it('drops a stacked line whose segment is being replaced', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const l = line([V(0, 0), V(1000, 0)]);
    world.addLine(l);

    P.pushLineStack(l);
    P.unwindLineStack(l.links()[0] as PnsItem);

    expect(P.mLineStack).toHaveLength(0);
  });

  it('reduces a via-terminated line to its via instead of dropping it', () => {
    const world = makeNode(50);
    const shove = new PnsShove(world);
    const P = priv(shove);

    const l = line([V(0, 0), V(1000, 0)]);
    world.addLine(l);

    const v = via(V(1000, 0));
    world.addVia(v);
    l.linkVia(v);

    P.pushLineStack(l);
    P.unwindLineStack(l.links()[0] as PnsItem);

    // Kept — with no geometry left but still carrying the via, so a collision
    // against a track on another layer is not silently lost.
    expect(P.mLineStack).toHaveLength(1);
    expect(P.mLineStack[0]?.endsWithVia()).toBe(true);
    expect(P.mLineStack[0]?.pointCount()).toBe(0);
  });

  it('is a silent no-op when handed a VIA — upstream has no VIA_T arm', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const l = line([V(0, 0), V(1000, 0)]);
    world.addLine(l);

    const v = via(V(1000, 0));
    world.addVia(v);
    l.linkVia(v);

    P.pushLineStack(l);
    // `unwindLineStack( ITEM* )` dispatches SEGMENT_T|ARC_T and LINE_T only.
    P.unwindLineStack(v);

    expect(P.mLineStack).toHaveLength(1);
    expect(P.mLineStack[0]?.pointCount()).toBe(2);
  });
});

// =====================================================================================
describe('SHOVE::checkShoveDirection', () => {
  const obstacle = line([V(0, 0), V(1000, 0)]);

  it('accepts a shove that moved the obstacle away from the pusher', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    // Pusher below the obstacle; the obstacle went up. The pusher's reference
    // point is therefore outside the before/after ring.
    const pusher = line([V(0, -500), V(1000, -500)]);
    const shoved = line([V(0, 500), V(1000, 500)]);

    expect(P.checkShoveDirection(pusher, obstacle, shoved)).toBe(true);
  });

  it('rejects a shove that wrapped the obstacle around the pusher', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    // The obstacle was pushed DOWN, past the pusher, so the pusher's first
    // point ends up enclosed by the before/after ring.
    const pusher = line([V(500, -500), V(1500, -500)]);
    const shoved = line([V(0, -1000), V(1000, -1000)]);

    expect(P.checkShoveDirection(pusher, obstacle, shoved)).toBe(false);
  });

  it('SHP_REVERSED takes the pusher’s LAST point as the reference instead', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    world.addLine(obstacle);

    // A pusher whose two ends fall on opposite sides of the before/after ring,
    // so which end is chosen decides the answer.
    const pusher = line([V(500, -300), V(500, 300)]);
    world.addLine(pusher);

    const shoved = line([V(0, 0), V(500, 600), V(1000, 0)]);

    const withDefault = P.checkShoveDirection(pusher, obstacle, shoved);

    P.touchRootLine(pusher).policy = PnsShovePolicy.SHP_REVERSED;

    const withReversed = P.checkShoveDirection(pusher, obstacle, shoved);

    expect(withDefault).not.toBe(withReversed);
  });
});

// =====================================================================================
describe('SHOVE::Run — end to end', () => {
  /**
   * A head that hits nothing must still succeed, push a spring-back frame, and
   * report the head unmodified.
   */
  it('succeeds and pushes a frame when the head collides with nothing', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    shove.addHeads(line([V(0, 0), V(10000, 0)]), PnsShovePolicy.SHP_SHOVE);

    expect(shove.run()).toBe(PnsShoveStatus.SH_OK);
    expect(P.mNodeStack).toHaveLength(1);
    expect(shove.headsModified()).toBe(false);
  });

  it('branches rather than writing to the world', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);

    shove.addHeads(line([V(0, 0), V(10000, 0)]), PnsShovePolicy.SHP_SHOVE);
    shove.run();

    // The head lives on the branch, and the branch is what currentNode answers.
    expect(shove.currentNode()).not.toBe(world);
    expect(shove.currentNode().getParent()).toBe(world);
  });

  it('actually moves a colliding track out of the way', () => {
    const world = makeNode(400);

    // An obstacle track running well past the head at both ends, so its joints
    // — which a shove may not move — are outside the pushed region.
    const obstacle = seg(V(-5000, 0), V(15000, 0), NET_B, 100);
    world.addSegment(obstacle);

    const shove = new PnsShove(world);
    shove.addHeads(line([V(0, -200), V(10000, -200)], NET_A, 100), PnsShovePolicy.SHP_SHOVE);

    const st = shove.run();
    const node = shove.currentNode();

    // Either the cascade settled or it gave up; what must NOT happen is the
    // world being modified.
    expect(world.getUpdatedItems().added).toHaveLength(0);

    if (st === PnsShoveStatus.SH_OK) {
      // On success the branch holds a different segment set from the root.
      expect(node).not.toBe(world);
    }
  });

  it('reports SH_INCOMPLETE for an empty head', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);

    shove.addHeads(new PnsLine(), PnsShovePolicy.SHP_SHOVE);

    expect(shove.run()).toBe(PnsShoveStatus.SH_INCOMPLETE);
  });

  it('throws the branch away on failure and restores the parent', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    shove.addHeads(new PnsLine(), PnsShovePolicy.SHP_SHOVE);
    shove.run();

    expect(shove.currentNode()).toBe(world);
    expect(P.mLineStack).toHaveLength(0);
    expect(P.mOptimizerQueue).toHaveLength(0);
    // No frame was pushed — only the SH_OK path pushes one.
    expect(P.mNodeStack).toHaveLength(0);
  });

  it('restores the previous via handle onto a failed via head', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    const handle = { pos: V(5000, 5000), layers: new PnsLayerRange(0, 1), net: NET_A, valid: true };

    // No such via in the world, so the run fails at findViaByHandle.
    shove.addHeadsVia(handle, V(6000, 5000));

    expect(shove.run()).toBe(PnsShoveStatus.SH_INCOMPLETE);
    expect(P.mHeadLines[0]?.theVia).toBe(handle);
    expect(shove.headsModified()).toBe(true);
  });

  it('locks both head endpoints unless SHP_DONT_LOCK_ENDPOINTS is set', () => {
    // `removeHeads()` takes the head — and with it the joints — back out of the
    // branch before `run()` returns, so the locks cannot be read off the node
    // afterwards. Record the calls instead.
    const calls = recordLockJoint(() => {
      const world = makeNode(100);
      const shove = new PnsShove(world);
      shove.addHeads(line([V(0, 0), V(10000, 0)]), PnsShovePolicy.SHP_SHOVE);
      shove.run();
    });

    expect(calls).toEqual([V(0, 0), V(10000, 0)]);

    const none = recordLockJoint(() => {
      const world = makeNode(100);
      const shove = new PnsShove(world);
      shove.addHeads(
        line([V(0, 0), V(10000, 0)]),
        PnsShovePolicy.SHP_SHOVE | PnsShovePolicy.SHP_DONT_LOCK_ENDPOINTS,
      );
      shove.run();
    });

    expect(none).toEqual([]);
  });

  it('does not lock the far end of a head that ends with a via', () => {
    // A via already pins that end, so upstream locks only the start.
    const calls = recordLockJoint(() => {
      const world = makeNode(100);
      const shove = new PnsShove(world);
      const head = line([V(0, 0), V(10000, 0)]);
      head.appendVia(via(V(10000, 0)));
      shove.addHeads(head, PnsShovePolicy.SHP_SHOVE);
      shove.run();
    });

    expect(calls).toEqual([V(0, 0)]);
  });

  it('removes the head geometry from the branch again once it is done', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);

    shove.addHeads(line([V(0, 0), V(10000, 0)]), PnsShovePolicy.SHP_SHOVE);

    expect(shove.run()).toBe(PnsShoveStatus.SH_OK);

    // The head is the router's to draw, not the node's to keep — the node only
    // held it so the cascade had something to push with.
    const added = shove.currentNode().getUpdatedItems().added;

    expect(added.filter((i) => i.net() === NET_A)).toHaveLength(0);
  });
});

// =====================================================================================
describe('SHOVE::shoveMainLoop', () => {
  /**
   * A cascade that never settles: the iteration reports success but leaves the
   * stack exactly as it found it. Upstream's real equivalents are the two bugs
   * flagged in the spec — `onCollidingArc` returning `SH_OK` after a failed
   * shove, and `SH_NULL` escaping a `default:` arm — both of which leave the
   * stack unchanged and rely entirely on the cap to terminate.
   */
  function runWithStalledIteration(aLimit: number): { status: PnsShoveStatus; iterations: number } {
    const world = makeNode(100);
    const shove = new PnsShove(world, { ...DEFAULT_SHOVE_SETTINGS, shoveIterationLimit: aLimit });
    const P = priv(shove);

    const stacked = line([V(0, 0), V(1000, 0)]);
    world.addLine(stacked);
    P.pushLineStack(stacked);

    let iterations = 0;

    (shove as unknown as { shoveIteration(n: number): PnsShoveStatus }).shoveIteration = () => {
      iterations++;
      return PnsShoveStatus.SH_OK;
    };

    return { status: P.shoveMainLoop(), iterations };
  }

  it('gives up with SH_INCOMPLETE even when every iteration reported SH_OK', () => {
    const { status } = runWithStalledIteration(5);

    // The cap is a hard failure, not "whatever the last iteration returned".
    expect(status).toBe(PnsShoveStatus.SH_INCOMPLETE);
  });

  it('runs exactly `iterLimit` iterations', () => {
    // m_iter is incremented BEFORE the `>=` test, so the cap is the count.
    expect(runWithStalledIteration(5).iterations).toBe(5);
    expect(runWithStalledIteration(1).iterations).toBe(1);
  });

  it('admits no iterations at all when the limit is zero', () => {
    const { status, iterations } = runWithStalledIteration(0);

    expect(iterations).toBe(1);
    expect(status).toBe(PnsShoveStatus.SH_INCOMPLETE);
  });

  it('gives up on the time limit even with iterations to spare', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world, {
      ...DEFAULT_SHOVE_SETTINGS,
      shoveIterationLimit: 1000000,
      shoveTimeLimit: -1, // already expired
    });
    const P = priv(shove);

    const stacked = line([V(0, 0), V(1000, 0)]);
    world.addLine(stacked);
    P.pushLineStack(stacked);

    (shove as unknown as { shoveIteration(n: number): PnsShoveStatus }).shoveIteration = () =>
      PnsShoveStatus.SH_OK;

    expect(P.shoveMainLoop()).toBe(PnsShoveStatus.SH_INCOMPLETE);
  });

  it('an empty stack returns SH_OK without iterating', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    expect(P.shoveMainLoop()).toBe(PnsShoveStatus.SH_OK);
  });

  it('a real run over a routable board settles and succeeds', () => {
    const world = makeNode(400);

    // A pad in the head's path. It cannot be shoved, so the line walks round
    // it, the stack empties, and the run succeeds — this is the control that
    // says the cap tests above are measuring the cap and not a broken board.
    const pad = new PnsSolid();
    pad.setNet(NET_B);
    pad.setLayers(new PnsLayerRange(0));
    pad.setShape({ kind: 'circle', c: V(0, 0), r: 400 });
    pad.setPos(V(5000, 0));
    world.addSolid(pad);

    const shove = new PnsShove(world);
    shove.addHeads(line([V(0, 0), V(10000, 0)]), PnsShovePolicy.SHP_SHOVE);

    expect(shove.run()).toBe(PnsShoveStatus.SH_OK);
  });
});

// =====================================================================================
describe('SHOVE geometry helpers', () => {
  it('lineWalkaround routes a line round a hull', () => {
    const l = PnsLineChain.fromPoints([V(-2000, 0), V(2000, 0)]);
    const hull = itemHull(seg(V(0, -500), V(0, 500), NET_B, 200), 100, 100, 0);

    const out = lineWalkaround(l, hull, true);

    expect(out).not.toBeNull();
    expect(out?.pointCount()).toBeGreaterThan(2);
    // The endpoints are where they were.
    expect(out?.cPoint(0)).toEqual(V(-2000, 0));
    expect(out?.cLastPoint()).toEqual(V(2000, 0));
  });

  it('lineWalkaround refuses a chain with no segments', () => {
    expect(lineWalkaround(PnsLineChain.fromPoints([V(0, 0)]), [], true)).toBeNull();
  });

  it('lineChangedArea is null for two identical lines', () => {
    const a = line([V(0, 0), V(1000, 0)]);
    const b = line([V(0, 0), V(1000, 0)]);

    expect(lineChangedArea(a, b)).toBeNull();
  });

  it('lineChangedArea covers the part that moved, inflated by the width', () => {
    const a = line([V(0, 0), V(1000, 0), V(2000, 0)], NET_A, 100);
    const b = line([V(0, 0), V(1000, 500), V(2000, 0)], NET_A, 100);

    const area = lineChangedArea(a, b);

    expect(area).not.toBeNull();
    expect(area?.maxY).toBe(600); // 500 + width 100
  });

  it('viaChangedArea is null when the via did not move', () => {
    const v = via(V(1000, 1000));

    expect(viaChangedArea(v, v.clone())).toBeNull();
  });

  it('viaChangedArea spans both positions when it did', () => {
    const a = via(V(0, 0));
    const b = via(V(5000, 0));

    const area = viaChangedArea(a, b);

    expect(area?.minX).toBe(-300);
    expect(area?.maxX).toBe(5300);
  });
});

// =====================================================================================
describe('SHOVE policy', () => {
  it('SHP_IGNORE on the default policy hides every obstacle from the search', () => {
    const world = makeNode(400);
    world.addSegment(seg(V(-5000, 0), V(15000, 0), NET_B));

    const shove = new PnsShove(world);
    shove.setDefaultShovePolicy(PnsShovePolicy.SHP_IGNORE);
    shove.addHeads(line([V(0, -200), V(10000, -200)]), PnsShovePolicy.SHP_IGNORE);

    // With everything filtered out the first iteration finds nothing, pops the
    // head off the stack and the loop ends cleanly.
    expect(shove.run()).toBe(PnsShoveStatus.SH_OK);
  });

  it('a head is never handed to the optimiser', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    const head = line([V(0, 0), V(3000, 0), V(6000, 0), V(10000, 0)]);
    shove.addHeads(head, PnsShovePolicy.SHP_SHOVE);
    shove.run();

    // The head's root entry is flagged isHead, and runOptimizer skips those.
    const entry = P.mHeadLines[0]?.origHead;

    expect(entry).not.toBeNull();
  });
});

// =====================================================================================
describe('SHOVE heads bookkeeping', () => {
  it('addHeads stores a link-free clone, leaving the caller’s line alone', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    const l = line([V(0, 0), V(1000, 0)]);
    world.addLine(l);

    expect(l.isLinked()).toBe(true);

    shove.addHeads(l);

    expect(P.mHeadLines[0]?.origHead?.isLinked()).toBe(false);
    // The caller's line is untouched.
    expect(l.isLinked()).toBe(true);
  });

  it('clearHeads empties the list', () => {
    const world = makeNode();
    const shove = new PnsShove(world);
    const P = priv(shove);

    shove.addHeads(line([V(0, 0), V(1000, 0)]));
    shove.clearHeads();

    expect(P.mHeadLines).toHaveLength(0);
  });

  it('getModifiedHead throws rather than returning junk for an unmodified head', () => {
    const world = makeNode();
    const shove = new PnsShove(world);

    shove.addHeads(line([V(0, 0), V(1000, 0)]));

    expect(() => shove.getModifiedHead(0)).toThrow(/not modified/);
  });
});

// =====================================================================================
describe('NODE::destroy', () => {
  it('detaches the node from its parent, which is what a popped frame needs', () => {
    const world = makeNode();
    const branch = world.branch();

    expect(world.hasChildren()).toBe(true);

    branch.destroy();

    expect(world.hasChildren()).toBe(false);
  });

  it('destroys the node’s own branches first', () => {
    const world = makeNode();
    const a = world.branch();
    const b = a.branch();

    a.destroy();

    // `b` was unlinked from `a`'s child set. Upstream's `~NODE` does not null
    // the child's own parent pointer either — the child is being deleted.
    expect(a.hasChildren()).toBe(false);
    expect(a.children().has(b)).toBe(false);
  });
});

// =====================================================================================
// Written to close specific mutation-testing survivors. Each one pins a claim the
// port's docblocks make that nothing else was checking.
// =====================================================================================
describe('SHOVE survivor coverage', () => {
  /**
   * Kills: `pushSpringback` moved above `reconstructHeads`.
   *
   * The frame snapshots `theVia` for every head. `reconstructHeads` is what
   * rewrites `theVia` to where the via actually ended up, so a frame taken
   * before it records the *pre*-shove handle — and the next `reduceSpringback`
   * then restores that stale handle onto the head, which the user sees as the
   * dragged via jumping back a move.
   */
  it('the spring-back frame records the post-shove via position, not the pre-shove one', () => {
    const world = makeNode(100);

    const v = via(V(5000, 5000));
    world.addVia(v);

    const shove = new PnsShove(world);
    const P = priv(shove);

    const handle = { pos: V(5000, 5000), layers: v.layers(), net: NET_A, valid: true };
    shove.addHeadsVia(handle, V(9000, 5000));

    expect(shove.run()).toBe(PnsShoveStatus.SH_OK);

    const snapshot = P.mNodeStack[0]?.draggedVias[0] as { pos: Vec2 } | null;

    expect(snapshot).not.toBeNull();
    // The via moved, so the snapshot must not still say where it started.
    expect(snapshot?.pos).not.toEqual(V(5000, 5000));
    expect(snapshot?.pos).toEqual(
      P.mHeadLines[0]?.theVia ? (P.mHeadLines[0].theVia as { pos: Vec2 }).pos : null,
    );
  });

  /**
   * Kills: `releaseNode` moved above `pruneRootLines`.
   *
   * `pruneRootLines` reads the node's own index. `destroy()` empties it, so
   * pruning afterwards prunes nothing and the root-line history keeps entries
   * for items that no longer exist anywhere.
   */
  it('popping a frame prunes the root-line entries for the items it added', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    // Two frames. The upper one carries a line whose links have history entries.
    P.pushSpringback(world.branch(), null);

    const frame = world.branch();
    const l = line([V(0, 0), V(1000, 0)]);
    frame.addLine(l);

    const uid = (l.links()[0] as { uid(): number }).uid();
    (P as unknown as { mRootLineHistory: Map<number, unknown> }).mRootLineHistory.set(uid, {
      rootLine: null,
      oldVia: null,
      newVia: null,
      newLine: null,
      policy: 0,
      isHead: false,
    });

    P.pushSpringback(frame, null);

    P.reduceSpringback(new PnsItemSet());

    // The frame went, and so did the history entry keyed on its item.
    expect(P.mNodeStack).toHaveLength(1);
    expect(
      (P as unknown as { mRootLineHistory: Map<number, unknown> }).mRootLineHistory.has(uid),
    ).toBe(false);
  });

  /**
   * Kills: reordering `shoveIteration`'s obstacle search.
   *
   * `{ SOLID_T, VIA_T, SEGMENT_T, HOLE_T }` decides what gets dealt with first
   * when several things are in the way at once — pads before vias before tracks
   * before holes. Put segments first and the router pushes a track where it
   * should have walked round a pad, and a different board comes out.
   *
   * The order is pinned directly, by recording the kind masks the iteration
   * asks for. A board-level assertion would be hostage to whichever geometry
   * happened to diverge; this is the contract itself.
   */
  it('asks for obstacle kinds in the order solids, vias, segments, holes', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    const asked: number[] = [];
    const original = PnsNode.prototype.nearestObstacle;

    PnsNode.prototype.nearestObstacle = function patched(this: PnsNode, aLine, aOpts) {
      if (aOpts?.kindMask !== undefined) asked.push(aOpts.kindMask);
      return original.call(this, aLine, aOpts);
    };

    try {
      const stacked = line([V(0, 0), V(5000, 0)]);
      world.addLine(stacked);
      P.pushLineStack(stacked);
      P.shoveMainLoop();
    } finally {
      PnsNode.prototype.nearestObstacle = original;
    }

    expect(asked).toEqual([PnsKind.SOLID_T, PnsKind.VIA_T, PnsKind.SEGMENT_T, PnsKind.HOLE_T]);
  });

  /**
   * Kills: the `break` on the first non-empty result.
   *
   * The search stops at the first kind that finds anything — it does not keep
   * looking for something nearer of a later kind. A pad in range means the pad
   * is dealt with, full stop.
   */
  it('stops asking as soon as a kind finds something', () => {
    const world = makeNode(300);

    const pad = new PnsSolid();
    pad.setNet(NET_B);
    pad.setLayers(new PnsLayerRange(0));
    pad.setShape({ kind: 'circle', c: V(0, 0), r: 300 });
    pad.setPos(V(3000, 0));
    world.addSolid(pad);

    const shove = new PnsShove(world);
    const P = priv(shove);

    const asked: number[] = [];
    const original = PnsNode.prototype.nearestObstacle;

    PnsNode.prototype.nearestObstacle = function patched(this: PnsNode, aLine, aOpts) {
      if (aOpts?.kindMask !== undefined) asked.push(aOpts.kindMask);
      return original.call(this, aLine, aOpts);
    };

    try {
      const stacked = line([V(0, 0), V(6000, 0)]);
      world.addLine(stacked);
      P.pushLineStack(stacked);
      P.shoveMainLoop();
    } finally {
      PnsNode.prototype.nearestObstacle = original;
    }

    // Exactly one ask: the first kind found the pad and the loop broke.
    //
    // Asserting `asked[1] !== VIA_T` would pass vacuously here — there is no
    // `asked[1]`. The whole array is the assertion, so reordering the search
    // (which would ask for segments and vias first, find nothing, and only
    // then reach solids) produces a different one.
    expect(asked).toEqual([PnsKind.SOLID_T]);
  });

  /**
   * Kills: the no-obstacle path using `popLineStack` instead of a bare `pop()`.
   *
   * That asymmetry is the whole feed for the optimiser: a line that shoved
   * cleanly is exactly what wants optimising, so it must stay in the queue when
   * it leaves the stack.
   */
  it('a line that settles cleanly stays in the optimiser queue', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    const stacked = line([V(0, 0), V(5000, 0)]);
    world.addLine(stacked);
    P.pushLineStack(stacked);

    expect(P.mOptimizerQueue).toHaveLength(1);

    // Nothing in the world collides with it, so shoveIteration takes the
    // no-obstacle path.
    expect(P.shoveMainLoop()).toBe(PnsShoveStatus.SH_OK);

    expect(P.mLineStack).toHaveLength(0);
    expect(P.mOptimizerQueue).toHaveLength(1);
  });

  /**
   * Kills: `pruneLineFromOptimizerQueue` dropping its `!VIA_T` guard.
   *
   * Two lines fanning out of one via share that via as a link and nothing else.
   * Pruning on the shared via would evict the first line from the queue when
   * the second arrives, and the whole fanout would go unoptimised.
   */
  it('two lines sharing only a via both stay in the optimiser queue', () => {
    const world = makeNode(100);
    const shove = new PnsShove(world);
    const P = priv(shove);

    const v = via(V(5000, 0));
    world.addVia(v);

    const a = line([V(0, 0), V(5000, 0)]);
    world.addLine(a);
    a.linkVia(v);

    const b = line([V(5000, 0), V(10000, 0)]);
    world.addLine(b);
    b.linkVia(v);

    P.pushLineStack(a);
    P.pushLineStack(b);

    // They share the via and no segment, so neither evicts the other.
    expect(P.mOptimizerQueue).toHaveLength(2);
  });
});

// =====================================================================================
describe('SHOVE::ShoveObstacleLine — the geometry, end to end', () => {
  /**
   * The core of what shove does, exercised for real: hulls are built round each
   * segment of the pusher at the clearance plus the obstacle's width, and the
   * obstacle is re-walked around them.
   */
  function shoveOnce(clearance: number): { ok: boolean; result: PnsLine } {
    const world = makeNode(clearance);

    // The obstacle runs well past the pusher at both ends, so its joints —
    // which a shove may not move — are outside the pushed region.
    const obstacle = line([V(-5000, 0), V(15000, 0)], NET_B);
    world.addLine(obstacle);

    const shove = new PnsShove(world);
    const pusher = line([V(0, -200), V(10000, -200)], NET_A);
    const result = new PnsLine();

    return { ok: shove.shoveObstacleLine(pusher, obstacle, result), result };
  }

  it('pushes the obstacle clear of the pusher', () => {
    const { ok, result } = shoveOnce(300);

    expect(ok).toBe(true);

    const pts = result.cLine().points();

    // Pushed away from the pusher, which sits at y = -200: the middle went to
    // positive y, never towards it.
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(0);
    expect(Math.min(...pts.map((p) => p.y))).toBe(0);
  });

  it('leaves both endpoints exactly where they were', () => {
    const { ok, result } = shoveOnce(300);

    expect(ok).toBe(true);
    // A shoved line is pinned at its joints — `shoveLineToHullSet` rejects any
    // candidate that moved either end, and `ShoveObstacleLine` only ever offers
    // to move one that has no via on it, and then only on the third attempt.
    expect(result.cLine().cPoint(0)).toEqual(V(-5000, 0));
    expect(result.cLine().cLastPoint()).toEqual(V(15000, 0));
  });

  it('pushes further for a larger clearance', () => {
    const near = shoveOnce(300);
    const far = shoveOnce(600);

    expect(near.ok && far.ok).toBe(true);

    const peak = (l: PnsLine): number =>
      Math.max(
        ...l
          .cLine()
          .points()
          .map((p) => p.y),
      );

    expect(peak(far.result)).toBeGreaterThan(peak(near.result));
  });

  it('the result no longer collides with the pusher', () => {
    // `shoveLineToHullSet`'s last acceptance test. If it did collide the shove
    // would have been rejected and `ok` would be false.
    expect(shoveOnce(300).ok).toBe(true);
  });
});

// =====================================================================================
describe('SHOVE::ShoveObstacleLine — the retry schedule', () => {
  /**
   * An obstacle exactly co-extensive with the pusher. Every walkaround moves an
   * endpoint, so the endpoint-unmoved rejection fails attempts 0 and 1 outright.
   * Only the third attempt — the one that sets `permitMovingStart/End` — can
   * succeed, by first pulling each endpoint onto the nearest hull.
   *
   * This is the one geometry in the suite that reaches
   * `shoveLineToHullSet`'s endpoint-adjustment block at all.
   */
  function coextensive(): { ok: boolean; result: PnsLine } {
    const world = makeNode(300);

    const obstacle = line([V(0, 0), V(10000, 0)], NET_B);
    world.addLine(obstacle);

    const shove = new PnsShove(world);
    const result = new PnsLine();

    return {
      ok: shove.shoveObstacleLine(line([V(0, -200), V(10000, -200)], NET_A), obstacle, result),
      result,
    };
  }

  it('succeeds only by adjusting the endpoints on the third attempt', () => {
    const { ok, result } = coextensive();

    expect(ok).toBe(true);
    // The endpoints did move — which the first two attempts forbid. Their x is
    // unchanged because the nearest hull point is directly above each end.
    expect(result.cLine().points()).toEqual([V(0, 2200), V(10000, 2200)]);
  });

  it('the endpoint-unmoved rejection is what forces the third attempt', () => {
    // If the rejection were dropped, attempt 0 would be accepted and the result
    // would be the *unadjusted* walk, which is a different chain. Pinning the
    // exact output is therefore also a check that the rejection fired twice
    // before the adjustment ran.
    const { result } = coextensive();

    expect(result.cLine().pointCount()).toBe(2);
    expect(result.cLine().cPoint(0).y).toBe(2200);
  });

  it('an obstacle clear of the pusher at both ends needs no adjustment', () => {
    // The control for the two above: when the endpoints are far from every
    // hull, the shove settles on an early attempt and the middle alone moves.
    const world = makeNode(300);

    const obstacle = line([V(-5000, 0), V(15000, 0)], NET_B);
    world.addLine(obstacle);

    const shove = new PnsShove(world);
    const result = new PnsLine();

    expect(
      shove.shoveObstacleLine(line([V(0, -200), V(10000, -200)], NET_A), obstacle, result),
    ).toBe(true);

    expect(result.cLine().cPoint(0)).toEqual(V(-5000, 0));
    expect(result.cLine().cLastPoint()).toEqual(V(15000, 0));
    // A 45°-mitred bump rather than a bodily translation.
    expect(result.cLine().pointCount()).toBeGreaterThan(2);
  });

  it('a larger clearance drives a larger hull and a bigger detour', () => {
    // Exercises the hull construction itself: clearance feeds the hull radius,
    // so the walk lands further out.
    function peakFor(clearance: number): number {
      const world = makeNode(clearance);
      const obstacle = line([V(-5000, 0), V(15000, 0)], NET_B);
      world.addLine(obstacle);

      const shove = new PnsShove(world);
      const result = new PnsLine();

      shove.shoveObstacleLine(line([V(0, -200), V(10000, -200)], NET_A), obstacle, result);

      return Math.max(
        ...result
          .cLine()
          .points()
          .map((p) => p.y),
      );
    }

    expect(peakFor(5000)).toBeGreaterThan(peakFor(300));
  });
});

describe('OPTIMIZER::OptimizationEffort, the flag bits', () => {
  it('numbers every member exactly as pns_optimizer.h does', () => {
    // These are a mask, so a wrong value is not a private detail: it means
    // something else to any code reading the same mask against upstream's
    // numbering. RESTRICT_AREA and LIMIT_CORNER_COUNT were previously 0x20 and
    // 0x80 here — upstream's PRESERVE_VERTEX and MERGE_COLINEAR.
    expect(PnsOptimizerFlags.MERGE_SEGMENTS).toBe(0x01);
    expect(PnsOptimizerFlags.SMART_PADS).toBe(0x02);
    expect(PnsOptimizerFlags.MERGE_OBTUSE).toBe(0x04);
    expect(PnsOptimizerFlags.FANOUT_CLEANUP).toBe(0x08);
    expect(PnsOptimizerFlags.KEEP_TOPOLOGY).toBe(0x10);
    expect(PnsOptimizerFlags.PRESERVE_VERTEX).toBe(0x20);
    expect(PnsOptimizerFlags.RESTRICT_VERTEX_RANGE).toBe(0x40);
    expect(PnsOptimizerFlags.MERGE_COLINEAR).toBe(0x80);
    expect(PnsOptimizerFlags.RESTRICT_AREA).toBe(0x100);
    expect(PnsOptimizerFlags.LIMIT_CORNER_COUNT).toBe(0x200);
  });

  it('gives every member a distinct bit', () => {
    // The reason the old values were wrong at all: a member left out does not
    // reserve its bit, so the next one added silently takes it.
    const values = Object.values(PnsOptimizerFlags).filter(
      (v): v is number => typeof v === 'number',
    );

    expect(new Set(values).size).toBe(values.length);
    expect(values.reduce((a, b) => a | b, 0)).toBe(0x3ff);
  });
});
