// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Branch, commit and roll back. Counterpart: `pcbnew/router/pns_node.cpp`
 * (`NODE::Branch`, `Commit`, `KillChildren`, `releaseChildren`, `releaseGarbage`,
 * `GetUpdatedItems`) and the five read paths that fall through to the root.
 *
 * What is worth pinning here:
 *
 * - **An immediate child of the root copies nothing.** Its index, joint map and
 *   override set are empty and it reads through to the root. A *deeper* branch
 *   copies its parent's three containers, and still reads through to the
 *   **root** — never to the parent — so what its parent does afterwards is
 *   invisible to it.
 * - **The joints are copied, the items are shared.** Upstream's joint map holds
 *   `JOINT` by value, so a branch gets its own joint objects over the same
 *   items.
 * - **The tombstone, reached through a real `Branch()`.** Removing a via on a
 *   branch must leave the joint answering "nothing here". Without the dummy
 *   joint the lookup falls through to the root, which still links the via, and
 *   the via is simultaneously present and absent.
 * - **The fall-through triggers on an absent tag, not on a failed match.** A
 *   branch that has touched a tag at all has shadowed it wholesale.
 * - **Rollback is doing nothing.** A branch never writes to the root, so
 *   `killChildren` restores it by construction.
 * - **`Commit` removes before it adds**, clears every marker including
 *   `MK_LOCKED`, and destroys the node it just committed.
 */
import { describe, expect, it } from 'vitest';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
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

function via(at: Vec2, opts: { net?: NetHandle; layers?: PnsLayerRange } = {}): PnsVia {
  return new PnsVia(at, opts.layers ?? new PnsLayerRange(0, 3), 400, 200, opts.net ?? NET_A);
}

function solid(at: Vec2, opts: { net?: NetHandle; layers?: PnsLayerRange } = {}): PnsSolid {
  const s = new PnsSolid();
  s.setNet(opts.net ?? NET_A);
  s.setLayers(opts.layers ?? new PnsLayerRange(0));
  s.setShape({ kind: 'circle', c: V(0, 0), r: 250 });
  s.setPos(at);
  return s;
}

const indexed = (node: PnsNode): PnsItem[] => [...node.index()];

// ---------------------------------------------------------------------------------
describe('PnsNode: Branch()', () => {
  it('links parent and child, and deepens by one', () => {
    const root = new PnsNode();

    expect(root.getParent()).toBeNull();
    expect(root.hasChildren()).toBe(false);

    const b = root.branch();

    expect(b.getParent()).toBe(root);
    expect(b.depth()).toBe(1);
    expect(root.hasChildren()).toBe(true);
    expect([...root.children()]).toEqual([b]);

    const g = b.branch();

    expect(g.getParent()).toBe(b);
    expect(g.depth()).toBe(2);
  });

  it('carries the rule resolver and the max clearance down', () => {
    const root = new PnsNode();
    const resolver = { clearance: () => 4242 } as unknown as Parameters<
      PnsNode['setRuleResolver']
    >[0];

    root.setRuleResolver(resolver);
    root.setMaxClearance(123456);

    const b = root.branch();

    expect(b.getRuleResolver()).toBe(resolver);
    expect(b.getMaxClearance()).toBe(123456);
    expect(b.branch().getMaxClearance()).toBe(123456);
  });

  it('gives an immediate child of the root nothing at all', () => {
    const root = new PnsNode();

    root.addSegment(seg(V(0, 0), V(1000, 0)));
    root.addVia(via(V(1000, 0)));

    const b = root.branch();

    // Upstream: "Immediate offspring of the root branch needs not copy
    // anything." Everything it can see, it sees through the root.
    expect(b.index().size()).toBe(0);
    expect(b.jointCount()).toBe(0);
    expect(b.allJoints()).toEqual([]);
  });

  it('gives a deeper branch a copy of its parent index, joints and overrides', () => {
    const root = new PnsNode();
    const rootSeg = seg(V(0, 0), V(1000, 0));

    root.addSegment(rootSeg);

    const b = root.branch();
    const branchSeg = seg(V(0, 2000), V(1000, 2000));

    b.addSegment(branchSeg);
    b.removeSegment(rootSeg); // a root item -> the override set

    const g = b.branch();

    expect(indexed(g)).toEqual([branchSeg]);
    expect(g.jointCount()).toBe(b.jointCount());
    expect(g.overrides(rootSeg)).toBe(true);

    // A grandchild of the root is still branched off `b`, but its `m_root` is
    // the root, not `b`: `child->m_root = isRoot() ? this : m_root`.
    expect(g.findJoint(V(0, 2000), 0, NET_A)?.linkList()).toEqual([branchSeg]);
  });

  it('copies the joints rather than sharing them', () => {
    const root = new PnsNode();

    root.addSegment(seg(V(0, 0), V(1000, 0)));

    const b = root.branch();
    // Force `b` to hold its own joint at the origin, then branch again.
    b.addSegment(seg(V(0, 0), V(0, 1000)));

    const g = b.branch();
    const inB = b.findJoint(V(0, 0), 0, NET_A);
    const inG = g.findJoint(V(0, 0), 0, NET_A);

    expect(inB).not.toBeNull();
    expect(inG).not.toBeNull();
    // Same content, different objects — upstream's map holds JOINT by value.
    expect(inG).not.toBe(inB);
    expect(inG?.linkList()).toEqual(inB?.linkList());

    // And therefore a link made on the grandchild does not reach the parent.
    g.addSegment(seg(V(0, 0), V(-1000, 0)));
    expect(g.findJoint(V(0, 0), 0, NET_A)?.linkCount()).toBe(3);
    expect(b.findJoint(V(0, 0), 0, NET_A)?.linkCount()).toBe(2);
  });

  it('does not copy the edge exclusions', () => {
    const root = new PnsNode();

    root.addEdgeExclusion({ kind: 'circle', c: V(0, 0), r: 500 });

    expect(root.queryEdgeExclusions(V(0, 0))).toBe(true);
    // Upstream's, and a real consequence: which node answered the collision
    // query decides whether a castellation cut-out is honoured.
    expect(root.branch().queryEdgeExclusions(V(0, 0))).toBe(false);
  });

  it('leaves a grandchild blind to what its parent does afterwards', () => {
    const root = new PnsNode();
    const b = root.branch();
    const g = b.branch();

    b.addSegment(seg(V(5000, 0), V(6000, 0)));

    // The fall-through goes to `m_root`, skipping every node in between, and
    // `g` copied `b` before this segment existed.
    expect(g.findJoint(V(5000, 0), 0, NET_A)).toBeNull();
    expect(b.findJoint(V(5000, 0), 0, NET_A)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: the root fall-through', () => {
  it('findJoint reads the root when the branch has no bucket at that tag', () => {
    const root = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    root.addSegment(s);

    const b = root.branch();

    expect(b.jointCount()).toBe(0);
    expect(b.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([s]);
    // Still the root's own joint object — nothing was copied down.
    expect(b.findJoint(V(0, 0), 0, NET_A)).toBe(root.findJoint(V(0, 0), 0, NET_A));
  });

  it('a branch that has touched a tag shadows the root there wholesale', () => {
    const root = new PnsNode();
    const onZero = seg(V(0, 0), V(1000, 0), { layer: 0 });
    const onNine = seg(V(0, 0), V(0, 1000), { layer: 9 });

    root.addSegment(onZero);
    root.addSegment(onNine);

    const b = root.branch();

    // Touching layer 0 copies the *whole* tag down, layer 9 included.
    b.addSegment(seg(V(0, 0), V(-1000, 0), { layer: 0 }));

    expect(b.findJoint(V(0, 0), 9, NET_A)?.linkList()).toEqual([onNine]);

    // …and the copy is the branch's own, not the root's.
    expect(b.findJoint(V(0, 0), 9, NET_A)).not.toBe(root.findJoint(V(0, 0), 9, NET_A));
  });

  it('touchJoint copies the root down without mutating it', () => {
    const root = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    root.addSegment(s);

    const b = root.branch();
    const added = seg(V(0, 0), V(0, 1000));

    b.addSegment(added);

    expect(b.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([s, added]);
    expect(root.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([s]);
  });

  it('hitTest merges the root, minus what the branch overrides', () => {
    const root = new PnsNode();
    const a = solid(V(0, 0));
    const bSolid = solid(V(10000, 0));

    root.addSolid(a);
    root.addSolid(bSolid);

    const br = root.branch();

    expect(br.hitTest(V(0, 0)).items()).toContain(a);

    br.removeSolid(a);

    expect(br.hitTest(V(0, 0)).items()).not.toContain(a);
    // The root itself is untouched.
    expect(root.hitTest(V(0, 0)).items()).toContain(a);
    // And an item the branch did not remove still comes through.
    expect(br.hitTest(V(10000, 0)).items()).toContain(bSolid);
  });

  it('allItemsInNet merges the root, minus what the branch overrides', () => {
    const root = new PnsNode();
    const s1 = seg(V(0, 0), V(1000, 0));
    const s2 = seg(V(2000, 0), V(3000, 0));

    root.addSegment(s1);
    root.addSegment(s2);

    const b = root.branch();
    const s3 = seg(V(4000, 0), V(5000, 0));

    b.addSegment(s3);
    b.removeSegment(s1);

    expect(b.allItemsInNet(NET_A)).toEqual(new Set([s3, s2]));
    expect(root.allItemsInNet(NET_A)).toEqual(new Set([s1, s2]));
  });

  it('queryJoints appends the root, duplicates and all', () => {
    const root = new PnsNode();

    root.addSegment(seg(V(0, 0), V(1000, 0)));

    const b = root.branch();
    const box = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

    // Nothing local: exactly the root's joint.
    expect(b.queryJoints(box)).toHaveLength(1);

    // Copy the tag down, and the branch's copy and the root's original are both
    // reported. Upstream does the same; the filter that might have caught it is
    // `Overrides( &j.second )`, which is asked about a JOINT and never true.
    b.addSegment(seg(V(0, 0), V(0, 1000)));

    expect(b.queryJoints(box)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: the tombstone, driven through a real Branch()', () => {
  it('a via removed on a branch is gone there and present in the root', () => {
    const root = new PnsNode();
    const track = seg(V(0, 0), V(1000, 0), { layer: 0 });
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    root.addSegment(track);
    root.addVia(v);

    // The root sees one joint spanning 0..3 with both items on it.
    expect(root.findJoint(V(0, 0), 3, NET_A)?.linkList()).toEqual([track, v]);

    const b = root.branch();

    b.removeVia(v);

    // Layer 3 is where the via was the only thing: on the branch that tag is
    // answered locally, and the answer is nothing. If the fall-through fired
    // here it would hand back the ROOT's joint — which still links `v` — and
    // the via would be both removed and present.
    expect(b.findJoint(V(0, 0), 3, NET_A)).toBeNull();
    expect(b.findViaByHandle(v.makeHandle())).toBeNull();

    // Layer 0 still has the track, under its own narrow span, on the branch's
    // own joint object.
    expect(b.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([track]);
    expect(b.findJoint(V(0, 0), 0, NET_A)?.layers().end()).toBe(0);

    // The root is untouched, which is what makes the branch a rollback point.
    expect(root.findJoint(V(0, 0), 3, NET_A)?.linkList()).toEqual([track, v]);
    expect(root.findViaByHandle(v.makeHandle())).toBe(v);
  });

  it('leaves a bucket holding only a joint that matches nothing', () => {
    const root = new PnsNode();
    const v = via(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    root.addVia(v);

    const b = root.branch();

    b.removeVia(v);

    const local = b.allJoints();

    expect(local).toHaveLength(1);
    expect(local[0]?.layers().start()).toBe(-1);
    expect(local[0]?.linkCount()).toBe(0);

    // Every layer the via spanned now answers "nothing" on the branch…
    for (const layer of [0, 1, 2, 3]) expect(b.findJoint(V(0, 0), layer, NET_A)).toBeNull();

    // …while the root still has it.
    expect(root.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([v]);
  });

  it('does the same for a routable solid', () => {
    const root = new PnsNode();
    const pad = solid(V(0, 0), { layers: new PnsLayerRange(0, 3) });

    root.addSolid(pad);

    const b = root.branch();

    b.removeSolid(pad);

    expect(b.findJoint(V(0, 0), 0, NET_A)).toBeNull();
    expect(root.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([pad]);
  });

  it('a segment removed on a branch is gone there too', () => {
    const root = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    root.addSegment(s);

    const b = root.branch();

    b.removeSegment(s);

    // Not the tombstone — this is `unlinkJoint`'s emptied residue, whose layer
    // range `unlink` collapses to `(-1)` — but the same mechanism: the bucket
    // is non-empty, so the lookup is answered locally, and the answer is
    // nothing.
    expect(b.allJoints()).toHaveLength(2); // one per endpoint
    expect(b.allJoints().every((j) => j.layers().start() === -1)).toBe(true);
    expect(b.findJoint(V(0, 0), 0, NET_A)).toBeNull();
    expect(b.allItemsInNet(NET_A).has(s)).toBe(false);
    expect(root.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([s]);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: rollback', () => {
  it('killChildren restores nothing, because a branch never wrote to the root', () => {
    const root = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    root.addSegment(s);

    const before = indexed(root);
    const b = root.branch();

    b.removeSegment(s);
    b.addSegment(seg(V(5000, 0), V(6000, 0)));
    b.addVia(via(V(5000, 0)));

    root.killChildren();

    expect(indexed(root)).toEqual(before);
    expect(root.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([s]);
    expect(root.hasChildren()).toBe(false);
  });

  it('destroys grandchildren too, depth first', () => {
    const root = new PnsNode();
    const b = root.branch();
    const g = b.branch();

    g.addSegment(seg(V(0, 0), V(1000, 0)));

    root.killChildren();

    expect(root.hasChildren()).toBe(false);
    expect(b.hasChildren()).toBe(false);
    // `~NODE` clears the joint map and drops the index; the node is dead.
    expect(g.jointCount()).toBe(0);
    expect(g.index().size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: GetUpdatedItems', () => {
  it('is empty on the root', () => {
    const root = new PnsNode();

    root.addSegment(seg(V(0, 0), V(1000, 0)));

    expect(root.getUpdatedItems()).toEqual({ removed: [], added: [] });
  });

  it('reports the override set as removed and the whole local index as added', () => {
    const root = new PnsNode();
    const s1 = seg(V(0, 0), V(1000, 0));

    root.addSegment(s1);

    const b = root.branch();
    const s2 = seg(V(2000, 0), V(3000, 0));

    b.addSegment(s2);
    b.removeSegment(s1);

    expect(b.getUpdatedItems()).toEqual({ removed: [s1], added: [s2] });
  });

  it("counts a grandchild's inherited index entries as additions", () => {
    const root = new PnsNode();
    const b = root.branch();
    const s = seg(V(0, 0), V(1000, 0));

    b.addSegment(s);

    const g = b.branch();

    // `s` was added by `b`, but `g` cloned `b`'s index, so `g` reports it too.
    expect(g.getUpdatedItems().added).toEqual([s]);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: Commit', () => {
  it('is a no-op when handed the root', () => {
    const root = new PnsNode();
    const other = new PnsNode();

    other.addSegment(seg(V(0, 0), V(1000, 0)));
    root.commit(other);

    expect(root.index().size()).toBe(0);
  });

  it('applies a branch: its removals, then its additions', () => {
    const root = new PnsNode();
    const old = seg(V(0, 0), V(1000, 0));

    root.addSegment(old);

    const b = root.branch();
    const fresh = seg(V(0, 0), V(1000, 1000));

    b.removeSegment(old);
    b.addSegment(fresh);

    root.commit(b);

    expect(indexed(root)).toEqual([fresh]);
    expect(root.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([fresh]);
    expect(fresh.belongsTo(root)).toBe(true);
  });

  it('removes before it adds, which matters when the same item is both', () => {
    const root = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    root.addSegment(s);

    const b = root.branch();

    // Remove the root's segment and put the very same object back on the
    // branch — `Replace` applied to one item, which is a shape shove produces.
    // The override set now names an item the branch's index also holds.
    b.removeSegment(s);
    b.addSegment(s);

    expect(b.overrides(s)).toBe(true);
    expect(indexed(b)).toEqual([s]);

    root.commit(b);

    // Removal first: the root un-indexes an item it no longer owns (a silent
    // no-op) and then re-adds it. Adding first would index it, and the removal
    // would then find it owned by the root and take it straight back out.
    expect(indexed(root)).toEqual([s]);
    expect(root.findJoint(V(0, 0), 0, NET_A)?.linkList()).toEqual([s]);
  });

  it('clears the rank and every marker, MK_LOCKED included', () => {
    const root = new PnsNode();
    const b = root.branch();
    const s = seg(V(0, 0), V(1000, 0), { locked: true });

    s.mark(LineMarker.MK_LOCKED | LineMarker.MK_HEAD);
    s.setRank(7);
    b.addSegment(s);

    root.commit(b);

    // `Unmark()`'s default argument is -1, so `m_marker &= ~(-1)` is zero.
    expect(s.marker()).toBe(0);
    expect(s.isLocked()).toBe(false);
    expect(s.rank()).toBe(-1);
  });

  it('reparents a via hole to its via, and then immediately un-does it', () => {
    const root = new PnsNode();
    const b = root.branch();
    const v = via(V(0, 0));

    b.addVia(v);

    const hole = v.hole();

    expect(hole).not.toBeNull();
    expect(hole?.owner()).toBe(b);

    root.commit(b);

    // `Commit` does `item->Hole()->SetOwner( item )` — and then `add( item )`
    // reaches `addVia` → `addHole`, whose first statement is
    // `aHole->SetOwner( this )`. The reparenting is overwritten within the same
    // loop iteration, so the hole ends up owned by the committing node.
    //
    // The line is not dead, though. `addVia` asserts the hole belongs to its
    // via before it gets there (`pns_node.cpp:627-631`, a throw here), and the
    // hole is still owned by the *branch* at that moment. The reparenting
    // exists to satisfy that check and is then discarded.
    expect(hole?.owner()).toBe(root);
    expect(indexed(root)).toContain(v);
  });

  it('destroys the committed node, and every other child', () => {
    const root = new PnsNode();
    const b = root.branch();
    const sibling = root.branch();

    b.addSegment(seg(V(0, 0), V(1000, 0)));
    sibling.addSegment(seg(V(9000, 0), V(9000, 1000)));

    root.commit(b);

    expect(root.hasChildren()).toBe(false);
    // Upstream leaves the caller holding a dangling pointer; here the node is
    // simply emptied, which is the same contract stated out loud.
    expect(b.index().size()).toBe(0);
    expect(sibling.index().size()).toBe(0);
  });

  it('goes through the private add: no redundancy check', () => {
    const root = new PnsNode();
    const original = seg(V(0, 0), V(1000, 0));

    root.addSegment(original);

    const b = root.branch();
    const dup = seg(V(0, 0), V(1000, 0));

    // The branch cannot add this itself — `findRedundantSegment` falls through
    // to the root and finds `original`.
    expect(b.addSegment(dup)).toBe(false);

    b.addRaw(dup);
    root.commit(b);

    // `Commit` uses `add()`, which never checks, so the root ends up with both.
    expect(indexed(root)).toEqual([original, dup]);
  });

  it('empties the root garbage list', () => {
    const root = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    root.addSegment(s);

    const b = root.branch();

    b.removeSegment(s);
    root.commit(b);

    // `doRemove` case 3 orphaned `s` onto the root's garbage list; committing
    // sweeps it. There is nothing to free here, so what is pinned is the sweep.
    expect(root.garbageItems().size).toBe(0);
    expect(s.owner()).toBeNull();
  });

  it('does not check that the node it is handed is a descendant', () => {
    const root = new PnsNode();
    const stranger = new PnsNode().branch();
    const s = seg(V(0, 0), V(1000, 0));

    stranger.addSegment(s);

    // The header doc says "calling on a non-root branch will fail"; no such
    // check is written, and `stranger` has nothing to do with `root`.
    root.commit(stranger);

    expect(indexed(root)).toEqual([s]);
    expect(s.belongsTo(root)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: the override set on a branch', () => {
  it('holds the removed item and its hole', () => {
    const root = new PnsNode();
    const v = via(V(0, 0));

    root.addVia(v);

    const b = root.branch();
    const hole = v.hole();

    b.removeVia(v);

    expect(b.overrides(v)).toBe(true);
    expect(hole && b.overrides(hole)).toBe(true);
    // The root's index is untouched: the item is tombstoned, not unindexed.
    expect(indexed(root)).toContain(v);
    expect(b.index().size()).toBe(0);
  });

  it('does not tombstone an item the branch itself added', () => {
    const root = new PnsNode();
    const b = root.branch();
    const s = seg(V(0, 0), V(1000, 0));

    b.addSegment(s);
    b.removeSegment(s);

    // `doRemove` case 2: it never belonged to the root, so it is physically
    // unindexed rather than overridden.
    expect(b.overrides(s)).toBe(false);
    expect(b.index().size()).toBe(0);
    expect(root.garbageItems().has(s)).toBe(true);
  });

  it('keeps a removed via out of the branch hit test but leaves it in the root', () => {
    const root = new PnsNode();
    const v = via(V(0, 0));

    root.addVia(v);

    const b = root.branch();

    b.removeVia(v);

    expect(
      b
        .hitTest(V(0, 0))
        .items()
        .filter((i) => i.kind() === PnsKind.VIA_T),
    ).toEqual([]);
    expect(root.hitTest(V(0, 0)).items()).toContain(v);
  });
});
