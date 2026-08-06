// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The router's world: the joint map, and every path that puts an item into it or
 * takes one out. Counterpart: `pcbnew/router/pns_node.cpp` (`NODE`), root node
 * only — branching, line assembly and collision querying are later changes.
 *
 * What is worth pinning here is mostly what the code deliberately does *not* do:
 *
 * - **Connectivity is exact.** One integer unit of gap makes two joints, not
 *   one. No tolerance, anywhere.
 * - **Layers are not in the joint key.** Two joints live at one position and net
 *   with disjoint layer spans, and a via that spans both collapses them into
 *   one. That collapse is the whole reason vias join tracks.
 * - **Dangling joints are never erased.** `jointCount()` only grows. The residue
 *   matches nothing — its layer span is emptied — and on a branch it is the only
 *   thing that stops a lookup falling through to the root and reporting an item
 *   that was just removed.
 * - **The tombstone.** Removing a via on a branch leaves a joint that answers no
 *   query, purely so the bucket is not empty. It cannot be reached through the
 *   public API until `Branch()` lands, so the tests that pin it construct the
 *   branch state by hand and say so.
 * - **No virtual via at a T-junction.** Upstream's `n_seg` counter is never
 *   incremented, so its `>= 3` test is dead. Reproduced; asserted.
 * - **Vias have no redundancy check, segments do, and arcs have no zero-length
 *   guard.** Three separate asymmetries, all upstream's.
 * - **`Add( LINE& )` adds arcs before segments and never adds the line's via**,
 *   while `Remove( LINE& )` does remove it.
 */
import { describe, expect, it } from 'vitest';
import { PnsArc } from '@ziroeda/pcbnew/src/router/pns_arc.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { LineMarker, PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };
const NET_B: NetHandle = { name: 'B' };

interface SegOpts {
  net?: NetHandle;
  layer?: number;
  layers?: PnsLayerRange;
  width?: number;
  locked?: boolean;
}

function seg(a: Vec2, b: Vec2, opts: SegOpts = {}): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: opts.width ?? 100 }, opts.net ?? NET_A);
  s.setLayers(opts.layers ?? new PnsLayerRange(opts.layer ?? 0));

  if (opts.locked) s.mark(LineMarker.MK_LOCKED);

  return s;
}

function via(at: Vec2, opts: { net?: NetHandle; layers?: PnsLayerRange; diameter?: number } = {}) {
  return new PnsVia(
    at,
    opts.layers ?? new PnsLayerRange(0, 3),
    opts.diameter ?? 400,
    200,
    opts.net ?? NET_A,
  );
}

function solid(
  at: Vec2,
  opts: { net?: NetHandle; layers?: PnsLayerRange; routable?: boolean } = {},
): PnsSolid {
  const s = new PnsSolid();
  s.setNet(opts.net ?? NET_A);
  s.setLayers(opts.layers ?? new PnsLayerRange(0));
  s.setShape({ kind: 'circle', c: V(0, 0), r: 250 });
  s.setPos(at);

  if (opts.routable === false) s.setRoutable(false);

  return s;
}

function arc(a: Vec2, mid: Vec2, b: Vec2, opts: SegOpts = {}): PnsArc {
  const x = new PnsArc({ p0: a, arcMid: mid, p1: b, width: opts.width ?? 100 }, opts.net ?? NET_A);
  x.setLayers(opts.layers ?? new PnsLayerRange(opts.layer ?? 0));
  return x;
}

/** Every item in the node's index, as a plain array. */
const indexed = (node: PnsNode): PnsItem[] => [...node.index()];

const kindsIn = (node: PnsNode, kind: PnsKind): PnsItem[] =>
  indexed(node).filter((i) => i.kind() === kind);

/**
 * Make a root node look like a branch, so the `!isRoot()` arms — the override
 * set and the `rebuildJoint` tombstone — can be exercised before `Branch()`
 * exists. `isRoot()` is `m_parent == nullptr` and nothing else, so setting a
 * parent is exactly what `Branch()` will do; `m_root` deliberately stays this
 * node, which is what makes `doRemove`'s "belongs to the root" arm fire.
 */
function asBranchOfItself(node: PnsNode): PnsNode {
  (node as unknown as { mParent: PnsNode | null }).mParent = new PnsNode();
  return node;
}

// ---------------------------------------------------------------------------------
describe('PnsNode: construction and clearance', () => {
  it('starts as a root with no joints, no items and upstream defaults', () => {
    const n = new PnsNode();

    expect(n.depth()).toBe(0);
    expect(n.jointCount()).toBe(0);
    expect(n.index().size()).toBe(0);
    // 800000 IU = 0.8 mm, upstream's `fixme`-flagged default.
    expect(n.getMaxClearance()).toBe(800000);
    expect(n.getRuleResolver()).toBeNull();
  });

  it('falls back to 0.1 mm with no rule resolver, and to zero for virtual items', () => {
    const n = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    const b = seg(V(0, 500), V(1000, 500));

    expect(n.getClearance(a, b)).toBe(100000);

    n.setRuleResolver({
      clearance: () => 12345,
      dpCoupledNet: () => null,
      dpNetPolarity: () => 0,
      dpNetPair: () => null,
      netCode: () => 0,
      netName: () => '',
      isInNetTie: () => false,
      isNetTieExclusion: () => false,
      isDrilledHole: () => false,
      isNonPlatedSlot: () => false,
      isKeepout: () => ({ keepout: false, enforce: false }),
      queryConstraint: () => null,
    });

    expect(n.getClearance(a, b)).toBe(12345);

    // A virtual via must touch what it anchors, so it gets no clearance at all.
    n.fixupVirtualVias();
    const vv = via(V(0, 0));
    (vv as unknown as { mIsVirtual: boolean }).mIsVirtual = true;
    expect(n.getClearance(vv, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: the joint map', () => {
  it('links a joint at each end of a segment', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    expect(n.addSegment(s)).toBe(true);
    expect(n.jointCount()).toBe(2);

    const jA = n.findJoint(V(0, 0), 0, NET_A);
    const jB = n.findJoint(V(1000, 0), 0, NET_A);

    expect(jA?.linkList()).toEqual([s]);
    expect(jB?.linkList()).toEqual([s]);
    expect(s.owner()).toBe(n);
  });

  it('joins two segments that share an exact endpoint', () => {
    const n = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    const b = seg(V(1000, 0), V(2000, 0));

    n.addSegment(a);
    n.addSegment(b);

    const j = n.findJoint(V(1000, 0), 0, NET_A);

    expect(j?.linkCount()).toBe(2);
    expect(j?.isLineCorner()).toBe(true);
    expect(n.jointCount()).toBe(3);
  });

  it('does NOT join two segments one unit apart — connectivity is exact', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0)));
    n.addSegment(seg(V(1001, 0), V(2000, 0)));

    expect(n.jointCount()).toBe(4);
    expect(n.findJoint(V(1000, 0), 0, NET_A)?.linkCount()).toBe(1);
    expect(n.findJoint(V(1001, 0), 0, NET_A)?.linkCount()).toBe(1);
  });

  it('does not join segments of different nets at the same point', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0), { net: NET_A }));
    n.addSegment(seg(V(1000, 0), V(2000, 0), { net: NET_B }));

    expect(n.findJoint(V(1000, 0), 0, NET_A)?.linkCount()).toBe(1);
    expect(n.findJoint(V(1000, 0), 0, NET_B)?.linkCount()).toBe(1);
    expect(n.jointCount()).toBe(4);
  });

  it('keeps joints on disjoint layers apart at one position and net', () => {
    const n = new PnsNode();
    const lo = seg(V(0, 0), V(1000, 0), { layer: 0 });
    const hi = seg(V(0, 0), V(0, 1000), { layer: 5 });

    n.addSegment(lo);
    n.addSegment(hi);

    const j0 = n.findJoint(V(0, 0), 0, NET_A);
    const j5 = n.findJoint(V(0, 0), 5, NET_A);

    expect(j0).not.toBe(j5);
    expect(j0?.linkList()).toEqual([lo]);
    expect(j5?.linkList()).toEqual([hi]);
    // Nothing lives on layer 3, between the two.
    expect(n.findJoint(V(0, 0), 3, NET_A)).toBeNull();
  });

  it('distinguishes positions whose digits would run together in a naive key', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(1, 23), V(1000, 0)));
    n.addSegment(seg(V(12, 3), V(2000, 0)));

    expect(n.findJoint(V(1, 23), 0, NET_A)?.linkCount()).toBe(1);
    expect(n.findJoint(V(12, 3), 0, NET_A)?.linkCount()).toBe(1);
    expect(n.jointCount()).toBe(4);
  });

  it('findJointForItem searches the item start layer only', () => {
    const n = new PnsNode();
    const wide = seg(V(0, 0), V(1000, 0), { layers: new PnsLayerRange(2, 4) });

    n.addSegment(wide);

    // A probe starting on layer 0 does not see a joint that lives on 2..4.
    const probe = seg(V(0, 0), V(0, 1000), { layers: new PnsLayerRange(0, 9) });

    expect(n.findJointForItem(V(0, 0), probe)).toBeNull();
    expect(n.findJointForItem(V(0, 0), wide)).not.toBeNull();
  });

  it('lockJoint creates the joint when it is absent', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    n.lockJoint(V(500, 500), s, true);

    expect(n.jointCount()).toBe(1);
    expect(n.findJoint(V(500, 500), 0, NET_A)?.isLocked()).toBe(true);

    n.lockJoint(V(500, 500), s, false);
    expect(n.findJoint(V(500, 500), 0, NET_A)?.isLocked()).toBe(false);
    // Still one joint: touchJoint merged rather than added.
    expect(n.jointCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: touchJoint merging', () => {
  it('a via spanning two single-layer joints collapses all three into one', () => {
    const n = new PnsNode();
    const lo = seg(V(0, 0), V(1000, 0), { layer: 0 });
    const hi = seg(V(0, 0), V(0, 1000), { layer: 3 });

    n.addSegment(lo);
    n.addSegment(hi);
    expect(n.jointCount()).toBe(4);

    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });
    n.addVia(v);

    const j0 = n.findJoint(V(0, 0), 0, NET_A);
    const j3 = n.findJoint(V(0, 0), 3, NET_A);

    // One joint now answers on both layers, spanning the union.
    expect(j0).toBe(j3);
    expect(j0?.layers().start()).toBe(0);
    expect(j0?.layers().end()).toBe(3);
    expect(j0?.linkList()).toEqual([lo, hi, v]);
    expect(j0?.isNonFanoutVia()).toBe(true);
    // Two of the four joints became one.
    expect(n.jointCount()).toBe(3);
  });

  it('leaves a joint outside the via span alone', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0), { layer: 0 }));
    const far = seg(V(0, 0), V(0, 1000), { layer: 9 });
    n.addSegment(far);
    n.addVia(via(V(0, 0), { layers: new PnsLayerRange(0, 3) }));

    expect(n.findJoint(V(0, 0), 9, NET_A)?.linkList()).toEqual([far]);
    expect(n.findJoint(V(0, 0), 0, NET_A)?.linkCount()).toBe(2);
  });

  it('carries a lock across a merge', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0), { layer: 0 });

    n.addSegment(s);
    n.lockJoint(V(0, 0), s, true);

    n.addVia(via(V(0, 0), { layers: new PnsLayerRange(0, 3) }));

    expect(n.findJoint(V(0, 0), 2, NET_A)?.isLocked()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: adding', () => {
  it('rejects a zero-length segment and adds nothing', () => {
    const n = new PnsNode();

    expect(n.addSegment(seg(V(10, 10), V(10, 10)))).toBe(false);
    expect(n.index().size()).toBe(0);
    expect(n.jointCount()).toBe(0);
  });

  it('rejects a redundant segment unless redundancy is allowed', () => {
    const n = new PnsNode();

    expect(n.addSegment(seg(V(0, 0), V(1000, 0)))).toBe(true);
    // Same endpoints the other way round is still redundant.
    expect(n.addSegment(seg(V(1000, 0), V(0, 0)))).toBe(false);
    expect(n.index().size()).toBe(1);

    expect(n.addSegment(seg(V(1000, 0), V(0, 0)), true)).toBe(true);
    expect(n.index().size()).toBe(2);
  });

  it('matches a redundant segment on the start layer only, not on overlap', () => {
    const n = new PnsNode();

    // A via spans 0..3, so one joint at the origin answers on every layer of it.
    n.addVia(via(V(0, 0), { layers: new PnsLayerRange(0, 3) }));
    n.addSegment(seg(V(0, 0), V(1000, 0), { layers: new PnsLayerRange(1, 1) }));

    // Same endpoints, overlapping layers, but a different *start* layer: not
    // redundant, so it goes in.
    expect(n.addSegment(seg(V(0, 0), V(1000, 0), { layers: new PnsLayerRange(0, 3) }))).toBe(true);
    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(2);

    // ... and one that shares the start layer is rejected.
    expect(n.addSegment(seg(V(0, 0), V(1000, 0), { layers: new PnsLayerRange(0, 9) }))).toBe(false);
  });

  it('has no zero-length guard on arcs', () => {
    const n = new PnsNode();
    const degenerate = arc(V(0, 0), V(0, 0), V(0, 0));

    expect(n.addArc(degenerate)).toBe(true);
    expect(kindsIn(n, PnsKind.ARC_T)).toHaveLength(1);
  });

  it('rejects a redundant arc unless redundancy is allowed', () => {
    const n = new PnsNode();

    expect(n.addArc(arc(V(0, 0), V(500, 500), V(1000, 0)))).toBe(true);
    expect(n.addArc(arc(V(1000, 0), V(500, 500), V(0, 0)))).toBe(false);
    expect(n.addArc(arc(V(1000, 0), V(500, 500), V(0, 0)), true)).toBe(true);
    expect(kindsIn(n, PnsKind.ARC_T)).toHaveLength(2);
  });

  it('has NO redundancy check on vias — two coincident vias both go in', () => {
    const n = new PnsNode();
    const v1 = via(V(0, 0));
    const v2 = via(V(0, 0));

    n.addVia(v1);
    n.addVia(v2);

    expect(kindsIn(n, PnsKind.VIA_T)).toHaveLength(2);

    const j = n.findJoint(V(0, 0), 0, NET_A);

    expect(j?.linkList()).toEqual([v1, v2]);
    // Two vias at one point is a fanout as far as the joint is concerned.
    expect(j?.isNonFanoutVia()).toBe(false);
  });

  it('indexes a via and its hole, and links one joint spanning the whole via', () => {
    const n = new PnsNode();
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addVia(v);

    expect(n.index().contains(v)).toBe(true);
    expect(n.index().contains(v.hole() as PnsItem)).toBe(true);
    expect(v.hole()?.owner()).toBe(n);
    expect(n.jointCount()).toBe(1);
    expect(n.findJoint(V(0, 0), 3, NET_A)?.linkList()).toEqual([v]);
  });

  it('indexes an unroutable solid but never links it into the graph', () => {
    const n = new PnsNode();
    const pad = solid(V(0, 0), { routable: false });

    n.addSolid(pad);

    expect(n.index().contains(pad)).toBe(true);
    expect(n.jointCount()).toBe(0);
    expect(n.findJoint(V(0, 0), 0, NET_A)).toBeNull();
  });

  it('links a routable solid', () => {
    const n = new PnsNode();
    const pad = solid(V(0, 0));

    n.addSolid(pad);

    expect(n.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([pad]);
    expect(pad.owner()).toBe(n);
  });

  it('addRaw ignores a hole and refuses a line', () => {
    const n = new PnsNode();
    const v = via(V(0, 0));

    n.addVia(v);
    const before = n.index().size();

    n.addRaw(v.hole() as PnsItem);
    expect(n.index().size()).toBe(before);

    expect(() => n.addRaw(new PnsLine())).toThrow(/unsupported kind/);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: Add( LINE& )', () => {
  const line = (pts: Vec2[], opts: SegOpts = {}): PnsLine => {
    const l = new PnsLine();
    l.setNet(opts.net ?? NET_A);
    l.setLayers(opts.layers ?? new PnsLayerRange(opts.layer ?? 0));
    l.setWidth(opts.width ?? 100);
    l.setShape(PnsLineChain.fromPoints(pts));
    return l;
  };

  it('decomposes a chain into segments and links them back', () => {
    const n = new PnsNode();
    const l = line([V(0, 0), V(1000, 0), V(1000, 1000)]);

    n.addLine(l);

    expect(l.links()).toHaveLength(2);
    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(2);
    expect(n.findJoint(V(1000, 0), 0, NET_A)?.linkCount()).toBe(2);
  });

  it('copies the line width, layers, net, marker and rank into each primitive', () => {
    const n = new PnsNode();
    const l = line([V(0, 0), V(1000, 0)], { width: 250, layers: new PnsLayerRange(2, 2) });
    l.mark(LineMarker.MK_HEAD);
    l.setRank(7);

    n.addLine(l);

    const s = l.links()[0] as PnsSegment;

    expect(s.width()).toBe(250);
    expect(s.layers().start()).toBe(2);
    expect(s.net()).toBe(NET_A);
    expect(s.marker()).toBe(LineMarker.MK_HEAD);
    expect(s.rank()).toBe(7);
    // The segment does not map back to a board track, but the source item does.
    expect(s.parent()).toBeNull();
  });

  it('skips zero-length segments silently', () => {
    const n = new PnsNode();
    const l = line([V(0, 0), V(1000, 0), V(1000, 0), V(2000, 0)]);

    n.addLine(l);

    expect(l.line().segmentCount()).toBe(3);
    expect(l.links()).toHaveLength(2);
  });

  it('reuses a segment already in the node instead of duplicating it', () => {
    const n = new PnsNode();
    const existing = seg(V(0, 0), V(1000, 0));
    n.addSegment(existing);

    const l = line([V(0, 0), V(1000, 0), V(1000, 1000)]);
    n.addLine(l);

    expect(l.links()[0]).toBe(existing);
    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(2);

    // With redundancy allowed the existing one is ignored and a copy is made.
    const l2 = line([V(0, 0), V(1000, 0)]);
    n.addLine(l2, true);
    expect(l2.links()[0]).not.toBe(existing);
    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(3);
  });

  it('adds every arc before any segment, so links are not in geometric order', () => {
    const n = new PnsNode();
    const l = new PnsLine();
    l.setNet(NET_A);
    l.setLayers(new PnsLayerRange(0));
    l.setWidth(100);

    const chain = new PnsLineChain();
    chain.appendPoint(V(0, 0));
    // A straight run, then an arc, then another straight run. The arc's polyline
    // is supplied directly — see the note in pns_line_item.ts.
    chain.appendPoint(V(1000, 0));
    chain.appendArc({ p0: V(1000, 0), arcMid: V(1300, 300), p1: V(1000, 600), width: 100 }, [
      V(1000, 0),
      V(1300, 300),
      V(1000, 600),
    ]);
    chain.appendPoint(V(0, 600));
    l.setShape(chain);

    n.addLine(l);

    // Geometric order would be seg, arc, seg. Upstream's order is arc first.
    expect(l.links().map((i) => i.kind())).toEqual([
      PnsKind.ARC_T,
      PnsKind.SEGMENT_T,
      PnsKind.SEGMENT_T,
    ]);
    // The two points spanned by the arc do not also become a straight segment.
    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(2);
    expect(kindsIn(n, PnsKind.ARC_T)).toHaveLength(1);
  });

  it('does not add the line via, though Remove( LINE& ) removes one', () => {
    const n = new PnsNode();
    const l = line([V(0, 0), V(1000, 0)]);
    const v = via(V(1000, 0));
    l.appendVia(v);

    n.addLine(l);

    expect(kindsIn(n, PnsKind.VIA_T)).toHaveLength(0);
    expect(l.links()).toHaveLength(1);
  });

  it('refuses a line that is already linked', () => {
    const n = new PnsNode();
    const l = line([V(0, 0), V(1000, 0)]);

    n.addLine(l);
    expect(() => n.addLine(l)).toThrow(/already-linked/);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: removing', () => {
  it('unlinks both of a segment joints and orphans the item', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    n.addSegment(s);
    n.removeSegment(s);

    expect(n.index().contains(s)).toBe(false);
    expect(s.owner()).toBeNull();
    expect(n.garbageItems().has(s)).toBe(true);
    expect(n.findJoint(V(0, 0), 0, NET_A)).toBeNull();
    expect(n.findJoint(V(1000, 0), 0, NET_A)).toBeNull();
  });

  it('leaves the emptied joints behind — the count never goes back down', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    n.addSegment(s);
    expect(n.jointCount()).toBe(2);

    n.removeSegment(s);

    // Dangling joints are never erased. They are still there and still counted,
    // with an emptied layer range that overlaps nothing.
    expect(n.jointCount()).toBe(2);

    const dangling = n.allJoints();

    expect(dangling).toHaveLength(2);
    for (const j of dangling) {
      expect(j.linkCount()).toBe(0);
      expect(j.layers().start()).toBe(-1);
      expect(j.layers().end()).toBe(-1);
    }
  });

  it('unlinking from a joint that does not exist creates one and empties it', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    // Never added, so there are no joints at all.
    n.removeSegment(s);

    expect(n.jointCount()).toBe(2);
    expect(n.findJoint(V(0, 0), 0, NET_A)).toBeNull();
  });

  it('drops the via link but does NOT re-split the joint, at the root', () => {
    const n = new PnsNode();
    const lo = seg(V(0, 0), V(1000, 0), { layer: 0 });
    const hi = seg(V(0, 0), V(0, 1000), { layer: 3 });
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addSegment(lo);
    n.addSegment(hi);
    n.addVia(v);
    expect(n.findJoint(V(0, 0), 0, NET_A)).toBe(n.findJoint(V(0, 0), 3, NET_A));

    n.removeVia(v);

    const j0 = n.findJoint(V(0, 0), 0, NET_A);
    const j3 = n.findJoint(V(0, 0), 3, NET_A);

    // rebuildJoint really does split them — it re-links `lo` on layer 0 and
    // `hi` on layer 3 as two separate joints. But on the *root* nothing was
    // tombstoned, so `completelyErased` is false and the last thing it does is
    // unlink the via itself, which goes through touchJoint with the *via's*
    // whole layer span and merges the two straight back together.
    //
    // So at the root a removed via leaves one joint still spanning 0..3, minus
    // the via. Only on a branch, where the tombstone suppresses that final
    // unlink, does the split survive.
    expect(j0).toBe(j3);
    expect(j0?.layers().start()).toBe(0);
    expect(j0?.layers().end()).toBe(3);
    expect(j0?.linkList()).toEqual([lo, hi]);
    expect(n.index().contains(v)).toBe(false);
    expect(n.index().contains(v.hole() as PnsItem)).toBe(false);
  });

  it('survives a via whose joint is missing rather than asserting', () => {
    const n = new PnsNode();
    const v = via(V(0, 0));

    // Never added: FindJoint returns null and rebuildJoint returns immediately.
    expect(() => n.removeVia(v)).not.toThrow();
    expect(n.jointCount()).toBe(0);
  });

  it('skips the joint rebuild entirely for an unroutable solid', () => {
    const n = new PnsNode();
    const pad = solid(V(0, 0), { routable: false });

    n.addSolid(pad);
    n.removeSolid(pad);

    expect(n.index().contains(pad)).toBe(false);
    // No joint was ever made, and none was made on the way out either.
    expect(n.jointCount()).toBe(0);
  });

  it('reparents a via hole on the way out', () => {
    const n = new PnsNode();
    const v = via(V(0, 0));
    const hole = v.hole() as PnsItem;

    n.addVia(v);
    expect(hole.owner()).toBe(n);

    n.removeVia(v);
    expect(hole.owner()).toBe(v);
  });

  it('Remove( ITEM* ) on a hole or a joint is a silent no-op', () => {
    const n = new PnsNode();
    const v = via(V(0, 0));

    n.addVia(v);
    const before = n.index().size();

    n.removeItem(v.hole() as PnsItem);

    expect(n.index().size()).toBe(before);
  });

  it('Remove( ITEM* ) on a LINE leaves the line links and owner intact', () => {
    const n = new PnsNode();
    const l = new PnsLine();
    l.setNet(NET_A);
    l.setLayers(new PnsLayerRange(0));
    l.setWidth(100);
    l.setShape(PnsLineChain.fromPoints([V(0, 0), V(1000, 0)]));
    l.setOwner(n);

    n.addLine(l);
    n.removeItem(l);

    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(0);
    // The ITEM* path does not detach the line.
    expect(l.links()).toHaveLength(1);
    expect(l.owner()).toBe(n);
  });

  it('Remove( LINE& ) also removes the via, and detaches the line', () => {
    const n = new PnsNode();
    const l = new PnsLine();
    l.setNet(NET_A);
    l.setLayers(new PnsLayerRange(0, 3));
    l.setWidth(100);
    l.setShape(PnsLineChain.fromPoints([V(0, 0), V(1000, 0)]));
    l.setOwner(n);

    n.addLine(l);

    const v = via(V(1000, 0));
    n.addVia(v);
    l.link(v);

    n.removeLine(l);

    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(0);
    expect(kindsIn(n, PnsKind.VIA_T)).toHaveLength(0);
    expect(l.links()).toHaveLength(0);
    expect(l.owner()).toBeNull();
  });

  it('removeByMarker takes out exactly the marked items', () => {
    const n = new PnsNode();
    const keep = seg(V(0, 0), V(1000, 0));
    const drop = seg(V(0, 1000), V(1000, 1000));
    drop.mark(LineMarker.MK_VIOLATION);

    n.addSegment(keep);
    n.addSegment(drop);
    n.removeByMarker(LineMarker.MK_VIOLATION);

    expect(indexed(n)).toEqual([keep]);
  });

  it('clearRanks resets ranks and clears only the masked marker bits', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));
    s.setRank(4);
    s.mark(LineMarker.MK_HEAD | LineMarker.MK_LOCKED);

    n.addSegment(s);
    n.clearRanks();

    expect(s.rank()).toBe(-1);
    // MK_HEAD is in the default mask, MK_LOCKED is not.
    expect(s.marker()).toBe(LineMarker.MK_LOCKED);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: replacing', () => {
  it('replaces one segment with exactly one segment', () => {
    const n = new PnsNode();
    const oldSeg = seg(V(0, 0), V(1000, 0));
    const newSeg = seg(V(0, 0), V(1000, 500));

    n.addSegment(oldSeg);
    n.replaceItem(oldSeg, newSeg);

    expect(kindsIn(n, PnsKind.SEGMENT_T)).toEqual([newSeg]);
    expect(n.findJoint(V(1000, 500), 0, NET_A)?.linkList()).toEqual([newSeg]);
    expect(n.findJoint(V(1000, 0), 0, NET_A)).toBeNull();
  });

  it('replaceLine mutates the old line as it goes', () => {
    const n = new PnsNode();
    const mk = (pts: Vec2[]): PnsLine => {
      const l = new PnsLine();
      l.setNet(NET_A);
      l.setLayers(new PnsLayerRange(0));
      l.setWidth(100);
      l.setShape(PnsLineChain.fromPoints(pts));
      return l;
    };

    const oldLine = mk([V(0, 0), V(1000, 0)]);
    n.addLine(oldLine);
    oldLine.setOwner(n);

    const newLine = mk([V(0, 0), V(1000, 500)]);
    n.replaceLine(oldLine, newLine);

    expect(oldLine.links()).toHaveLength(0);
    expect(oldLine.owner()).toBeNull();
    expect(newLine.links()).toHaveLength(1);
    expect(kindsIn(n, PnsKind.SEGMENT_T)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: rebuildJoint on a branch — the tombstone', () => {
  it('leaves a joint that answers nothing, so a lookup cannot fall through', () => {
    const n = new PnsNode();
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addVia(v);
    expect(n.jointCount()).toBe(1);

    asBranchOfItself(n);
    n.removeVia(v);

    // The bucket is NOT empty: a dummy joint with an emptied layer range sits
    // there. That is the whole mechanism — an empty bucket is what makes
    // FindJoint consult the root, and the root still links the removed via.
    const joints = n.allJoints();

    expect(joints).toHaveLength(1);
    expect(joints[0]?.layers().start()).toBe(-1);
    expect(joints[0]?.layers().end()).toBe(-1);
    expect(joints[0]?.linkCount()).toBe(0);

    // It matches no query, on any layer of the via it replaced.
    expect(n.findJoint(V(0, 0), 0, NET_A)).toBeNull();
    expect(n.findJoint(V(0, 0), 3, NET_A)).toBeNull();
    expect(n.findViaByHandle(v.makeHandle())).toBeNull();
  });

  it('suppresses the self-unlink, so no second joint joins the tombstone', () => {
    const n = new PnsNode();
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addVia(v);
    asBranchOfItself(n);
    n.removeVia(v);

    // Were the unlink not suppressed, touchJoint would have inserted a second
    // joint carrying the via's own layer range — and that one WOULD match.
    expect(n.jointCount()).toBe(1);
    expect(n.findJoint(V(0, 0), 1, NET_A)).toBeNull();
  });

  it('erases only the joints the removed item overlaps', () => {
    const n = new PnsNode();
    const far = seg(V(0, 0), V(0, 1000), { layer: 9 });
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addSegment(far);
    n.addVia(v);
    asBranchOfItself(n);
    n.removeVia(v);

    // The layer-9 joint shares the tag but not the span, so the erase loop
    // leaves it exactly as it was.
    expect(n.findJoint(V(0, 0), 9, NET_A)?.linkList()).toEqual([far]);
    expect(n.findJoint(V(0, 0), 0, NET_A)).toBeNull();
  });

  it('relinks the surviving items rather than tombstoning, when the via had company', () => {
    const n = new PnsNode();
    const lo = seg(V(0, 0), V(1000, 0), { layer: 0 });
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addSegment(lo);
    n.addVia(v);
    asBranchOfItself(n);
    n.removeVia(v);

    // The bucket emptied, so a tombstone went in — and then the segment was
    // re-linked beside it, which is a joint that DOES match.
    expect(n.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([lo]);
    expect(n.findJoint(V(0, 0), 3, NET_A)).toBeNull();
  });

  it('is what makes a branch differ from the root at all', () => {
    const build = (branch: boolean): PnsNode => {
      const n = new PnsNode();
      const lo = seg(V(0, 0), V(1000, 0), { layer: 0 });
      const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

      n.addSegment(lo);
      n.addVia(v);

      if (branch) asBranchOfItself(n);

      n.removeVia(v);
      return n;
    };

    const root = build(false);
    const branch = build(true);

    // Root: no tombstone, so the trailing self-unlink runs, goes through
    // touchJoint with the via's 0..3 span, and swallows the layer-0 joint back
    // up. The joint at the origin still claims layers 0..3 although only a
    // layer-0 segment is left on it.
    expect(root.findJoint(V(0, 0), 3, NET_A)).not.toBeNull();
    expect(root.findJoint(V(0, 0), 3, NET_A)?.linkCount()).toBe(1);

    // Branch: the bucket emptied, so a tombstone went in, the self-unlink was
    // suppressed, and the re-linked segment kept its own narrow span. Layer 3
    // now correctly answers "nothing here".
    expect(branch.findJoint(V(0, 0), 3, NET_A)).toBeNull();
    expect(branch.findJoint(V(0, 0), 0, NET_A)?.linkCount()).toBe(1);
  });

  it('tombstones the removal of a routable solid too', () => {
    const n = new PnsNode();
    const pad = solid(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addSolid(pad);
    asBranchOfItself(n);
    n.removeSolid(pad);

    expect(n.allJoints()).toHaveLength(1);
    expect(n.findJoint(V(0, 0), 0, NET_A)).toBeNull();
  });

  it('records a removed root item in the override set instead of unindexing it', () => {
    const n = new PnsNode();
    const v = via(V(0, 0));

    n.addVia(v);
    asBranchOfItself(n);
    n.removeVia(v);

    // doRemove case 1: the item belongs to the root and this is not the root, so
    // it is masked rather than deleted — and its hole is masked with it.
    expect(n.overrides(v)).toBe(true);
    expect(n.overrides(v.hole() as PnsItem)).toBe(true);
    expect(n.index().contains(v)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: rebuildJoint erases exactly one joint', () => {
  it('erases one joint for every removal the public API can build', () => {
    const cases: (() => PnsNode)[] = [
      () => {
        const n = new PnsNode();
        n.addSegment(seg(V(0, 0), V(1000, 0), { layer: 0 }));
        n.addSegment(seg(V(0, 0), V(0, 1000), { layer: 3 }));
        n.addVia(via(V(0, 0), { layers: new PnsLayerRange(0, 3) }));
        return n;
      },
      () => {
        const n = new PnsNode();
        n.addSolid(solid(V(0, 0), { layers: new PnsLayerRange(0, 1) }));
        n.addSolid(solid(V(0, 0), { layers: new PnsLayerRange(2, 3) }));
        n.addVia(via(V(0, 0), { layers: new PnsLayerRange(0, 3) }));
        return n;
      },
      () => {
        const n = new PnsNode();
        n.addSegment(seg(V(0, 0), V(1000, 0), { layer: 9 }));
        n.addVia(via(V(0, 0), { layers: new PnsLayerRange(0, 3) }));
        return n;
      },
    ];

    for (const build of cases) {
      const n = build();
      const v = kindsIn(n, PnsKind.VIA_T)[0] as PnsVia;
      const tagged = n
        .allJoints()
        .filter((j) => j.pos().x === 0 && j.pos().y === 0 && v.layersOverlap(j));

      // Everything the via spans has already been merged into one joint, so
      // there is only ever one for rebuildJoint to erase.
      expect(tagged).toHaveLength(1);
    }
  });

  it('erases two, and loses a link, only when an item layer span is widened in place', () => {
    const n = new PnsNode();
    const pad = solid(V(0, 0), { layers: new PnsLayerRange(2, 3) });
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 1) });

    n.addSolid(pad);
    n.addVia(v);

    // Two joints at one tag, disjoint spans — the only way they coexist.
    expect(n.allJoints()).toHaveLength(2);

    // Widen the via past the pad's joint without re-running touchJoint. Nothing
    // in the router does this, which is why the multi-erase arm is unreachable
    // through the add/remove API; it is defensive, not dead.
    v.setLayers(new PnsLayerRange(0, 3));
    n.removeVia(v);

    // Both joints were erased, and only the via's own link list was restored, so
    // the pad's link is gone.
    expect(n.findJoint(V(0, 0), 2, NET_A)).toBeNull();
    expect(n.allJoints().every((j) => !j.linkList().includes(pad))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: FixupVirtualVias', () => {
  const vvias = (n: PnsNode): PnsItem[] => indexed(n).filter((i) => i.isVirtual());

  it('creates none at a T-junction — upstream never increments n_seg', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0)));
    n.addSegment(seg(V(0, 0), V(-1000, 0)));
    n.addSegment(seg(V(0, 0), V(0, 1000)));

    expect(n.findJoint(V(0, 0), 0, NET_A)?.linkCount()).toBe(3);

    n.fixupVirtualVias();

    // Three segments meet here and the `n_seg >= 3` disjunct is dead, so nothing
    // is created. Adding the missing `++` would change IsLineCorner,
    // IsNonFanoutVia and NextSegment at every junction on every board.
    expect(vvias(n)).toHaveLength(0);
  });

  it('creates one where a track changes width', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0), { width: 100 }));
    n.addSegment(seg(V(1000, 0), V(2000, 0), { width: 250 }));

    n.fixupVirtualVias();

    const made = vvias(n);

    expect(made).toHaveLength(1);
    expect((made[0] as PnsVia).pos()).toEqual(V(1000, 0));
    // max_w + 2 * PNS_HULL_MARGIN
    expect((made[0] as PnsVia).diameter(0)).toBe(250 + 20);
  });

  it('creates none where a via or a solid is already anchoring the joint', () => {
    for (const anchor of ['via', 'solid'] as const) {
      const n = new PnsNode();

      n.addSegment(seg(V(0, 0), V(1000, 0), { width: 100 }));
      n.addSegment(seg(V(1000, 0), V(2000, 0), { width: 250 }));

      if (anchor === 'via') n.addVia(via(V(1000, 0), { layers: new PnsLayerRange(0, 0) }));
      else n.addSolid(solid(V(1000, 0)));

      n.fixupVirtualVias();

      expect(vvias(n)).toHaveLength(0);
    }
  });

  it('creates four for a lone locked segment — one at each end, twice over', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0), { locked: true }));
    n.fixupVirtualVias();

    const made = vvias(n) as PnsVia[];

    // Each of the two joints makes one at itself and one at the segment's far
    // end. Upstream's own comment: "we naively add a VVIA to each end".
    expect(made).toHaveLength(4);
    expect(made.filter((v) => v.pos().x === 0)).toHaveLength(2);
    expect(made.filter((v) => v.pos().x === 1000)).toHaveLength(2);
  });

  it('lets the LAST segment examined decide the lock, not any of them', () => {
    const at = V(1000, 0);
    const lockedFirst = new PnsNode();
    const lockedLast = new PnsNode();

    // Same joint, same two segments, opposite link order.
    lockedFirst.addSegment(seg(V(0, 0), at, { locked: true }));
    lockedFirst.addSegment(seg(at, V(2000, 0)));

    lockedLast.addSegment(seg(at, V(2000, 0)));
    lockedLast.addSegment(seg(V(0, 0), at, { locked: true }));

    lockedFirst.fixupVirtualVias();
    lockedLast.fixupVirtualVias();

    // is_locked is assigned, not accumulated: at the shared joint the last link
    // examined decides. With the locked segment first, the unlocked one wipes
    // its verdict and that joint contributes nothing; with it last, the joint
    // contributes two (one at itself, one at the segment's far end).
    //
    // Both boards also get two from the joint at the locked segment's lone end,
    // so the totals are 2 and 4. Accumulating the flag instead would make the
    // first board produce 4 as well.
    expect(vvias(lockedFirst)).toHaveLength(2);
    expect(vvias(lockedLast)).toHaveLength(4);

    const atJoint = (n: PnsNode): PnsItem[] =>
      vvias(n).filter((i) => (i as PnsVia).pos().x === at.x && (i as PnsVia).pos().y === at.y);

    expect(atJoint(lockedFirst)).toHaveLength(1);
    expect(atJoint(lockedLast)).toHaveLength(2);
  });

  it('ignores multilayer joints', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0), { width: 100 }));
    n.addSegment(seg(V(1000, 0), V(2000, 0), { width: 250 }));
    // A via spanning layers merges the joint into a multilayer one, which the
    // fixup skips outright.
    n.addVia(via(V(1000, 0), { layers: new PnsLayerRange(0, 3) }));
    n.removeVia(kindsIn(n, PnsKind.VIA_T)[0] as PnsVia);

    // Re-merge without leaving a via behind: widen by hand via a multilayer pad.
    const n2 = new PnsNode();
    n2.addSegment(seg(V(0, 0), V(1000, 0), { width: 100, layers: new PnsLayerRange(0, 2) }));
    n2.addSegment(seg(V(1000, 0), V(2000, 0), { width: 250, layers: new PnsLayerRange(0, 2) }));

    expect(n2.findJoint(V(1000, 0), 0, NET_A)?.layers().isMultilayer()).toBe(true);

    n2.fixupVirtualVias();

    expect(vvias(n2)).toHaveLength(0);
  });

  it('does not see arcs at all', () => {
    const n = new PnsNode();

    // An arc and a segment of very different widths. An ARC is not a SEGMENT to
    // the downcast, so it contributes neither to max_w nor to is_width_change.
    n.addSegment(seg(V(0, 0), V(1000, 0), { width: 100 }));
    n.addArc(arc(V(1000, 0), V(1500, 500), V(2000, 0), { width: 900 }));

    n.fixupVirtualVias();

    expect(vvias(n)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: HitTest', () => {
  it('reports a multilayer item once per layer, with no deduplication', () => {
    const n = new PnsNode();
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addVia(v);

    const hits = n.hitTest(V(0, 0));
    const viaHits = hits.items().filter((i) => i === v);

    // Four sub-indices hold it, so four hits. Callers that need unique items
    // dedup at the call site; callers that count hits depend on the repeats.
    expect(viaHits).toHaveLength(4);
  });

  it('applies no kind, layer or net filter', () => {
    const n = new PnsNode();
    const a = seg(V(-1000, 0), V(1000, 0), { net: NET_A, layer: 0 });
    const b = seg(V(0, -1000), V(0, 1000), { net: NET_B, layer: 7 });

    n.addSegment(a);
    n.addSegment(b);

    const hits = n.hitTest(V(0, 0)).items();

    expect(hits).toContain(a);
    expect(hits).toContain(b);
  });

  it('misses a point outside every shape', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0), { width: 100 }));

    expect(n.hitTest(V(500, 5000)).size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: bulk queries', () => {
  it('queryJoints filters by box, layers and link kind', () => {
    const n = new PnsNode();

    n.addSegment(seg(V(0, 0), V(1000, 0), { layer: 0 }));
    n.addSegment(seg(V(5000, 0), V(6000, 0), { layer: 7 }));

    const box = { minX: -1, minY: -1, maxX: 2000, maxY: 2000 };

    expect(n.queryJoints(box)).toHaveLength(2);
    expect(n.queryJoints(box, new PnsLayerRange(7, 7))).toHaveLength(0);
    expect(n.queryJoints(box, PnsLayerRange.all(), PnsKind.VIA_T)).toHaveLength(0);
    expect(n.queryJoints({ minX: -1, minY: -1, maxX: 10000, maxY: 10000 })).toHaveLength(4);
  });

  it('allItemsInNet skips unroutable items', () => {
    const n = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));
    const pad = solid(V(2000, 0), { routable: false });

    n.addSegment(s);
    n.addSolid(pad);

    const items = n.allItemsInNet(NET_A);

    expect(items.has(s)).toBe(true);
    expect(items.has(pad)).toBe(false);
    expect(n.allItemsInNet(NET_A, PnsKind.VIA_T).size).toBe(0);
  });

  it('findViaByHandle goes through the joint map', () => {
    const n = new PnsNode();
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    n.addVia(v);

    expect(n.findViaByHandle(v.makeHandle())).toBe(v);
    expect(
      n.findViaByHandle({ valid: true, pos: V(5, 5), layers: new PnsLayerRange(0, 3), net: NET_A }),
    ).toBeNull();
  });

  it('findItemsByParent matches on board item identity', () => {
    const n = new PnsNode();
    const parent = { layer: 'F.Cu' };
    const a = seg(V(0, 0), V(1000, 0));
    const b = seg(V(1000, 0), V(2000, 0));
    a.setParent(parent);

    n.addSegment(a);
    n.addSegment(b);

    expect(n.findItemsByParent(parent)).toEqual([a]);
  });

  it('bulk mode links joints eagerly while the spatial index stays empty', () => {
    const n = new PnsNode();

    n.beginBulkAdd();
    n.addSegment(seg(V(0, 0), V(1000, 0)));

    expect(n.jointCount()).toBe(2);
    expect(n.hitTest(V(500, 0)).size()).toBe(0);

    n.finalizeBulkAdd();

    expect(n.hitTest(V(500, 0)).size()).toBe(1);
  });

  it('edge exclusions are a linear point-in-shape scan', () => {
    const n = new PnsNode();

    expect(n.queryEdgeExclusions(V(0, 0))).toBe(false);

    n.addEdgeExclusion({ kind: 'circle', c: V(0, 0), r: 500 });

    expect(n.queryEdgeExclusions(V(100, 0))).toBe(true);
    expect(n.queryEdgeExclusions(V(5000, 0))).toBe(false);
  });
});
