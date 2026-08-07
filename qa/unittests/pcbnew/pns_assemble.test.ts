// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Line reconstitution: turning the node's loose segments back into the track a
 * user drew. Counterpart: `pcbnew/router/pns_node.cpp` (`followLine`,
 * `AssembleLine`, `FindLineEnds`, `FindLinesBetweenJoints`).
 *
 * What is worth pinning:
 *
 * - **Six separate reasons the walk stops**, and they are tested in a fixed
 *   order: no joint, the closed-loop guard, a locked joint, the array bound, a
 *   non-trivial joint, a width change.
 * - **A width change does not stop assembly by default.** The parameter
 *   defaults to *allowing* the mismatch, which is the opposite of what the name
 *   suggests on a first read.
 * - **The seed segment is written twice and linked once.** Both passes emit a
 *   corner for it; the identity guard in the emit loop links it one time.
 * - **A closed loop is assembled by one pass**, because the guard hit on the
 *   backward walk suppresses the forward one entirely.
 * - **Only duplicate points are removed, never colinear ones**, so the vertex
 *   count and the link count stay in step.
 * - **`FindLinesBetweenJoints` returns duplicates on purpose**, and its dead
 *   `FindLineEnds` call carries a live crash.
 */
import { describe, expect, it } from 'vitest';
import { PnsArc } from '@ziroeda/pcbnew/src/router/pns_arc.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { LineMarker } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { PnsLine } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };

interface SegOpts {
  net?: NetHandle;
  layer?: number;
  width?: number;
  locked?: boolean;
}

function seg(a: Vec2, b: Vec2, opts: SegOpts = {}): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: opts.width ?? 100 }, opts.net ?? NET_A);
  s.setLayers(new PnsLayerRange(opts.layer ?? 0));

  if (opts.locked) s.mark(LineMarker.MK_LOCKED);

  return s;
}

function arc(a: Vec2, mid: Vec2, b: Vec2, opts: SegOpts = {}): PnsArc {
  const x = new PnsArc({ p0: a, arcMid: mid, p1: b, width: opts.width ?? 100 }, opts.net ?? NET_A);
  x.setLayers(new PnsLayerRange(opts.layer ?? 0));
  return x;
}

function via(at: Vec2): PnsVia {
  return new PnsVia(at, new PnsLayerRange(0, 3), 400, 200, NET_A);
}

function solid(at: Vec2): PnsSolid {
  const s = new PnsSolid();
  s.setNet(NET_A);
  s.setLayers(new PnsLayerRange(0));
  s.setShape({ kind: 'circle', c: V(0, 0), r: 250 });
  s.setPos(at);
  return s;
}

/** The line's vertices, as plain tuples. */
const pts = (l: PnsLine): [number, number][] => {
  const out: [number, number][] = [];

  for (let i = 0; i < l.pointCount(); i++) {
    const p = l.cPoint(i);
    out.push([p.x, p.y]);
  }

  return out;
};

/** A straight run of `n` segments along X, 1000 apart, added to a fresh node. */
function chain(n: number, opts: SegOpts = {}): { node: PnsNode; segs: PnsSegment[] } {
  const node = new PnsNode();
  const segs: PnsSegment[] = [];

  for (let i = 0; i < n; i++) {
    const s = seg(V(i * 1000, 0), V((i + 1) * 1000, 0), opts);
    node.addSegment(s);
    segs.push(s);
  }

  return { node, segs };
}

// ---------------------------------------------------------------------------------
describe('PnsNode: AssembleLine', () => {
  it('rebuilds a straight run from any of its segments', () => {
    const { node, segs } = chain(3);

    for (const s of segs) {
      const l = node.assembleLine(s);

      expect(pts(l)).toEqual([
        [0, 0],
        [1000, 0],
        [2000, 0],
        [3000, 0],
      ]);
      expect(l.links()).toEqual(segs);
      expect(l.width()).toBe(100);
      expect(l.net()).toBe(NET_A);
      expect(l.owner()).toBe(node);
    }
  });

  it('links the seed segment once although both passes emit a corner for it', () => {
    const { node, segs } = chain(1);
    const l = node.assembleLine(segs[0] as PnsSegment);

    // Two corners, one link. The identity guard `prev_seg != li` is what makes
    // the difference, and getting it wrong duplicates the link.
    expect(pts(l)).toEqual([
      [0, 0],
      [1000, 0],
    ]);
    expect(l.links()).toEqual([segs[0]]);
  });

  it('does not remove colinear points, only duplicate ones', () => {
    const { node, segs } = chain(4);
    const l = node.assembleLine(segs[0] as PnsSegment);

    // Every one of these is colinear and every one survives: the chain's
    // vertices must stay in 1:1 correspondence with the links.
    expect(l.pointCount()).toBe(5);
    expect(l.segmentCount()).toBe(4);
    expect(l.links()).toHaveLength(4);
  });

  it('stops at a fanout', () => {
    const { node, segs } = chain(3);

    node.addSegment(seg(V(2000, 0), V(2000, 1000)));

    const l = node.assembleLine(segs[0] as PnsSegment);

    // `JOINT::nextSegment` sees two candidates at (2000,0) and gives up.
    expect(pts(l)).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);
  });

  it('stops at a via and at a pad', () => {
    const { node, segs } = chain(3);

    node.addVia(via(V(1000, 0)));
    node.addSolid(solid(V(3000, 0)));

    const l = node.assembleLine(segs[1] as PnsSegment);

    expect(pts(l)).toEqual([
      [1000, 0],
      [2000, 0],
      [3000, 0],
    ]);
    expect(l.links()).toEqual([segs[1], segs[2]]);
  });

  it('stops at a net change and at a layer change', () => {
    const { node, segs } = chain(2);

    node.addSegment(seg(V(2000, 0), V(3000, 0), { net: { name: 'B' } }));
    node.addSegment(seg(V(0, 0), V(-1000, 0), { layer: 5 }));

    expect(pts(node.assembleLine(segs[0] as PnsSegment))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);
  });

  it('walks through a width change by default, and stops at one when asked not to', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0), { width: 100 });
    const b = seg(V(1000, 0), V(2000, 0), { width: 250 });

    node.addSegment(a);
    node.addSegment(b);

    // `aAllowSegmentSizeMismatch` defaults to TRUE — the default is permissive,
    // which reads backwards from the parameter name.
    expect(pts(node.assembleLine(a))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);

    expect(pts(node.assembleLine(a, null, false, false, false))).toEqual([
      [0, 0],
      [1000, 0],
    ]);
  });

  it('stops at the first width change, however far along the walk it is', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0), { width: 100 });
    const b = seg(V(1000, 0), V(2000, 0), { width: 100 });
    const c = seg(V(2000, 0), V(3000, 0), { width: 250 });

    node.addSegment(a);
    node.addSegment(b);
    node.addSegment(c);

    // Walking a→b→c with the check on: b matches, c does not.
    //
    // The comparison upstream writes is against the *seed's* width, and this
    // deliberately does NOT try to distinguish that from comparing against the
    // previous segment's — the two are provably equivalent, because a segment
    // only becomes `current` after passing this same test, so `current`'s width
    // always equals the seed's. See the note on `followLine`.
    expect(pts(node.assembleLine(a, null, false, false, false))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);
  });

  it('handles a segment stored with its endpoints the other way round', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    // Same geometry, endpoints swapped: `prevReversed` is what copes with it.
    const b = seg(V(2000, 0), V(1000, 0));

    node.addSegment(a);
    node.addSegment(b);

    expect(pts(node.assembleLine(a))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);
    expect(pts(node.assembleLine(b))).toEqual([
      [2000, 0],
      [1000, 0],
      [0, 0],
    ]);
  });

  it('assembles a closed loop in a single pass', () => {
    const node = new PnsNode();
    const corners = [V(0, 0), V(1000, 0), V(1000, 1000), V(0, 1000)];
    const segs: PnsSegment[] = [];

    for (let i = 0; i < 4; i++) {
      const s = seg(corners[i] as Vec2, corners[(i + 1) % 4] as Vec2);
      node.addSegment(s);
      segs.push(s);
    }

    const l = node.assembleLine(segs[0] as PnsSegment);

    // The guard fires when the walk comes back to where it started; the forward
    // pass is then skipped altogether, so the loop is emitted once.
    expect(l.links()).toHaveLength(4);
    expect(l.pointCount()).toBe(5);
    expect(pts(l)[0]).toEqual(pts(l)[4]);
  });

  it('stops at a locked joint only when told to', () => {
    const { node, segs } = chain(3);

    node.lockJoint(V(2000, 0), segs[1] as PnsSegment, true);

    expect(pts(node.assembleLine(segs[0] as PnsSegment))).toHaveLength(4);
    expect(pts(node.assembleLine(segs[0] as PnsSegment, null, true))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);
  });

  it('walks through a locked segment only when told to', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    const b = seg(V(1000, 0), V(2000, 0), { locked: true });

    node.addSegment(a);
    node.addSegment(b);

    expect(pts(node.assembleLine(a))).toEqual([
      [0, 0],
      [1000, 0],
    ]);
    expect(pts(node.assembleLine(a, null, false, true))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);
  });

  it('reports the seed as a point index, clamped to a segment index', () => {
    const { node, segs } = chain(3);
    const idx = { value: -1 };

    node.assembleLine(segs[2] as PnsSegment, idx);

    // Written as `pointCount() - 1` at the moment the seed is linked, then
    // clamped against `segmentCount()`. Both halves are upstream's, TODO and all.
    expect(idx.value).toBe(2);

    const first = { value: -1 };

    node.assembleLine(segs[0] as PnsSegment, first);
    expect(first.value).toBe(0);
  });

  it('carries the seed segment source item onto the line', () => {
    const { node, segs } = chain(1);
    const parent = { layer: 'F.Cu' };

    (segs[0] as PnsSegment).setSourceItem(parent);

    const l = node.assembleLine(segs[0] as PnsSegment);

    expect(l.getSourceItem()).toBe(parent);
    expect(l.parent()).toBeNull();
  });

  it('assembles through an arc', () => {
    const node = new PnsNode();
    // A 10 mm quarter circle: the sagitta has to clear ARC_HIGH_DEF/2 or
    // `ConvertToPolyline` collapses the arc to a single chord.
    const a = seg(V(-1000000, 0), V(0, 0));
    const c = arc(V(0, 0), V(7071068, 2928932), V(10000000, 10000000));
    const b = seg(V(10000000, 10000000), V(10000000, 20000000));

    node.addSegment(a);
    node.addArc(c);
    node.addSegment(b);

    const l = node.assembleLine(a);

    expect(l.links()).toEqual([a, c, b]);
    // The arc contributes a polyline, so there are more vertices than links.
    expect(l.pointCount()).toBeGreaterThan(4);
    expect(pts(l)[0]).toEqual([-1000000, 0]);
    expect(pts(l)[l.pointCount() - 1]).toEqual([10000000, 20000000]);
    expect(l.cLine().arcCount()).toBe(1);
  });

  it('collapses an arc whose sagitta is under half the max error', () => {
    const node = new PnsNode();
    // Sagitta ~293 IU against a 2500 IU half-budget: upstream's `n = 0` arm.
    const c = arc(V(0, 0), V(707, 293), V(1000, 1000));

    node.addArc(c);

    const l = node.assembleLine(c);

    expect(l.pointCount()).toBe(2);
    expect(pts(l)).toEqual([
      [0, 0],
      [1000, 1000],
    ]);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: FindLineEnds', () => {
  it('returns the joints at both ends, as copies', () => {
    const { node, segs } = chain(2);
    const l = node.assembleLine(segs[0] as PnsSegment);
    const { a, b } = node.findLineEnds(l);

    expect(a.pos()).toEqual(V(0, 0));
    expect(b.pos()).toEqual(V(2000, 0));
    expect(a).not.toBe(node.findJoint(V(0, 0), 0, NET_A));
    expect(a.linkList()).toEqual([segs[0]]);
  });

  it('throws when an end has no joint, as upstream dereferences null', () => {
    const { node, segs } = chain(1);
    const l = node.assembleLine(segs[0] as PnsSegment);

    node.removeSegment(segs[0] as PnsSegment);

    // Unlinking left an emptied joint whose layer span matches nothing, so the
    // lookup answers null and upstream would dereference it.
    expect(() => node.findLineEnds(l)).toThrow(/dangling end/);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: FindLinesBetweenJoints', () => {
  it('clips the assembled line to the stretch between the two joints', () => {
    const { node } = chain(4);

    // Terminate the run at both ends. A *third* segment or a via is needed —
    // two segments at a joint is a corner, and assembly walks straight through.
    node.addVia(via(V(0, 0)));
    node.addVia(via(V(4000, 0)));

    const a = node.findJoint(V(1000, 0), 0, NET_A);
    const b = node.findJoint(V(3000, 0), 0, NET_A);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    const lines = node.findLinesBetweenJoints(a!, b!);

    // `a` is a line corner, so both of its links assemble to the same line and
    // the caller gets it twice. That is wanted, not a defect.
    expect(lines).toHaveLength(2);

    for (const l of lines) {
      expect(pts(l)).toEqual([
        [1000, 0],
        [2000, 0],
        [3000, 0],
      ]);
    }
  });

  it('reproduces the ClipVertexRange link bug when the clip starts mid-line', () => {
    const { node, segs } = chain(4);

    node.addVia(via(V(0, 0)));
    node.addVia(via(V(4000, 0)));

    const a = node.findJoint(V(1000, 0), 0, NET_A);
    const b = node.findJoint(V(3000, 0), 0, NET_A);
    const [line] = node.findLinesBetweenJoints(a!, b!);

    // The chain is right — vertices 1000, 2000, 3000, i.e. segments 1 and 2.
    // The link list is not. `std::rotate( begin, begin + firstLink,
    // begin + lastLink )` leaves the element at `lastLink` out of the rotation,
    // so `links[2]` never reaches the kept prefix and `links[0]` — a segment
    // outside the clip entirely — is still in it.
    expect(line?.links()).toEqual([segs[1], segs[0]]);
    expect(line?.links()).not.toContain(segs[2]);
  });

  it('gets the links right when the clip starts at the line start', () => {
    const { node, segs } = chain(3);

    node.addVia(via(V(0, 0)));
    node.addVia(via(V(3000, 0)));

    const a = node.findJoint(V(0, 0), 0, NET_A);
    const b = node.findJoint(V(2000, 0), 0, NET_A);
    const [line] = node.findLinesBetweenJoints(a!, b!);

    // `firstLink` is 0, so the faulty rotate is a no-op and the truncation
    // alone gives the right answer. That is why the bug above survives.
    expect(line?.links()).toEqual([segs[0], segs[1]]);
  });

  it('skips a link whose line does not share layers with the far joint', () => {
    const node = new PnsNode();
    const onZero = seg(V(0, 0), V(1000, 0), { layer: 0 });
    const onFive = seg(V(0, 0), V(0, 1000), { layer: 5 });

    node.addSegment(onZero);
    node.addSegment(onFive);

    const a = node.findJoint(V(0, 0), 0, NET_A);
    const far = node.findJoint(V(0, 1000), 5, NET_A);

    expect(node.findLinesBetweenJoints(a!, far!)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------
describe('PnsNode: assembling on a branch', () => {
  it('walks the root through the fall-through', () => {
    const { node, segs } = chain(3);
    const b = node.branch();

    expect(pts(b.assembleLine(segs[0] as PnsSegment))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
      [3000, 0],
    ]);
  });

  it('stops where the branch removed a segment, without touching the root', () => {
    const { node, segs } = chain(3);
    const b = node.branch();

    b.removeSegment(segs[2] as PnsSegment);

    expect(pts(b.assembleLine(segs[0] as PnsSegment))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
    ]);
    expect(pts(node.assembleLine(segs[0] as PnsSegment))).toHaveLength(4);
  });

  it('does not walk through a via the branch removed', () => {
    const { node, segs } = chain(3);
    const v = via(V(1000, 0));

    node.addVia(v);

    // With the via there, assembly stops at it.
    expect(pts(node.assembleLine(segs[1] as PnsSegment))).toHaveLength(3);

    const b = node.branch();

    b.removeVia(v);

    // On the branch the via is gone, so the walk continues through — and this
    // only works because the tombstone stopped the joint lookup falling through
    // to the root, where the via is still linked.
    expect(pts(b.assembleLine(segs[1] as PnsSegment))).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
      [3000, 0],
    ]);
  });
});
