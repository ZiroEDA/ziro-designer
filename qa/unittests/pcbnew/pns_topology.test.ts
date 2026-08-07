// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The walk that carries on past the end of a single assembled line.
 * Counterpart: `pcbnew/router/pns_topology.cpp` (`AssembleTrivialPath`,
 * `followTrivialPath`, `followBranch`).
 *
 * What is worth pinning:
 *
 * - **A via start must be a non-fanout via**: exactly one via and two segments
 *   on its joint, or the whole call returns nothing.
 * - **A fanout is explored, not walked.** `followBranch` is a depth-first
 *   search that keeps the *longest* terminal path, so a T-junction contributes
 *   its longer arm and discards the shorter one entirely.
 * - **The timeout returns the best found so far**, which makes the answer
 *   depend on the machine. Pinned by forcing an immediate expiry rather than
 *   racing a real clock.
 * - **The left branch is prepended item by item**, so it lands reversed.
 */
import { describe, expect, it } from 'vitest';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsTopology } from '@ziroeda/pcbnew/src/router/pns_topology.js';
import type { PnsTerminalJoints } from '@ziroeda/pcbnew/src/router/pns_topology.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { PnsLine } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };

function seg(a: Vec2, b: Vec2, layer = 0): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: 100 }, NET_A);
  s.setLayers(new PnsLayerRange(layer));
  return s;
}

function via(at: Vec2): PnsVia {
  return new PnsVia(at, new PnsLayerRange(0, 3), 400, 200, NET_A);
}

/** The path as a readable shape: kinds, with each LINE's endpoints. */
const shape = (set: { citems(): readonly { kind(): number }[] }): string[] =>
  set.citems().map((i) => {
    if (i.kind() !== PnsKind.LINE_T) return i.kind() === PnsKind.VIA_T ? 'via' : 'item';

    const l = i as unknown as PnsLine;
    const a = l.cPoint(0);
    const b = l.cLastPoint();

    return `line ${a.x},${a.y} -> ${b.x},${b.y}`;
  });

// ---------------------------------------------------------------------------------
describe('PnsTopology: AssembleTrivialPath', () => {
  it('carries the path through a layer-changing via', () => {
    const node = new PnsNode();
    const s0 = seg(V(0, 0), V(1000, 0), 0);
    const s1 = seg(V(1000, 0), V(2000, 0), 3);
    const v = via(V(1000, 0));

    node.addSegment(s0);
    node.addSegment(s1);
    node.addVia(v);

    const terminals: PnsTerminalJoints = { a: null, b: null };
    const path = new PnsTopology(node).assembleTrivialPath(s0, terminals);

    // `AssembleLine` alone stops dead at the via; this walks through it.
    expect(shape(path)).toEqual(['line 0,0 -> 1000,0', 'via', 'line 1000,0 -> 2000,0']);
    expect(terminals.a?.pos()).toEqual(V(0, 0));
    expect(terminals.b?.pos()).toEqual(V(2000, 0));
  });

  it('starts from the via itself when the via is not a fanout', () => {
    const node = new PnsNode();
    const s0 = seg(V(0, 0), V(1000, 0), 0);
    const s1 = seg(V(1000, 0), V(2000, 0), 3);
    const v = via(V(1000, 0));

    node.addSegment(s0);
    node.addSegment(s1);
    node.addVia(v);

    const path = new PnsTopology(node).assembleTrivialPath(v);

    // The seed is the first seg/arc link on the via's joint, so the path is the
    // same one, assembled from a different starting point.
    expect(shape(path)).toHaveLength(3);
    expect(shape(path)).toContain('via');
  });

  it('gives up on a fanout via', () => {
    const node = new PnsNode();
    const v = via(V(0, 0));

    node.addSegment(seg(V(0, 0), V(1000, 0), 0));
    node.addSegment(seg(V(0, 0), V(0, 1000), 0));
    node.addSegment(seg(V(0, 0), V(-1000, 0), 3));
    node.addVia(v);

    // Four items on the joint, so `IsNonFanoutVia` is false and the whole call
    // returns nothing at all — not a partial path.
    expect(new PnsTopology(node).assembleTrivialPath(v).size()).toBe(0);
  });

  it('gives up on a stitching via with nothing attached', () => {
    const node = new PnsNode();
    const v = via(V(0, 0));

    node.addVia(v);

    expect(new PnsTopology(node).assembleTrivialPath(v).size()).toBe(0);
  });

  it('gives up on anything that is not a via, a segment or an arc', () => {
    const node = new PnsNode();
    const pad = new PnsSolid();

    pad.setNet(NET_A);
    pad.setLayers(new PnsLayerRange(0));
    pad.setShape({ kind: 'circle', c: V(0, 0), r: 250 });
    pad.setPos(V(0, 0));
    node.addSolid(pad);

    expect(new PnsTopology(node).assembleTrivialPath(pad).size()).toBe(0);
  });

  it('is just the seed line when both ends are already terminal', () => {
    const node = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    node.addSegment(s);

    const path = new PnsTopology(node).assembleTrivialPath(s);

    expect(shape(path)).toEqual(['line 0,0 -> 1000,0']);
  });

  it('takes the longer arm of a fanout and drops the shorter', () => {
    const node = new PnsNode();
    const seed = seg(V(0, 0), V(1000, 0));

    node.addSegment(seed);
    // Three segments meet at (1000,0): a fanout, which AssembleLine stops at.
    node.addSegment(seg(V(1000, 0), V(1500, 0)));
    node.addSegment(seg(V(1000, 0), V(9000, 0)));

    const path = new PnsTopology(node).assembleTrivialPath(seed);

    // Only the longest terminal path survives; the 500-unit stub is discarded.
    expect(shape(path)).toEqual(['line 0,0 -> 1000,0', 'line 1000,0 -> 9000,0']);
  });

  it('extends both ends, prepending the left result', () => {
    const node = new PnsNode();
    const seed = seg(V(0, 0), V(1000, 0));

    node.addSegment(seed);

    // Fanouts on both sides of the seed.
    node.addSegment(seg(V(0, 0), V(-5000, 0)));
    node.addSegment(seg(V(0, 0), V(0, -500)));
    node.addSegment(seg(V(1000, 0), V(6000, 0)));
    node.addSegment(seg(V(1000, 0), V(1000, 500)));

    const path = new PnsTopology(node).assembleTrivialPath(seed);

    expect(shape(path)).toEqual([
      'line 0,0 -> -5000,0',
      'line 0,0 -> 1000,0',
      'line 1000,0 -> 6000,0',
    ]);
  });

  it('does not walk back into the seed line', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    const b = seg(V(1000, 0), V(2000, 0));

    node.addSegment(a);
    node.addSegment(b);
    // A fanout at (2000,0) so the seed line ends there.
    node.addSegment(seg(V(2000, 0), V(5000, 0)));
    node.addSegment(seg(V(2000, 0), V(2000, 500)));

    const path = new PnsTopology(node).assembleTrivialPath(a);

    // The seed line is 0..2000 and its links are in the global visited set, so
    // the branch search cannot re-enter it.
    expect(shape(path)).toEqual(['line 0,0 -> 2000,0', 'line 2000,0 -> 5000,0']);
  });

  it('breaks a length tie in favour of the branch explored first', () => {
    const node = new PnsNode();
    const seed = seg(V(0, 0), V(1000, 0));

    node.addSegment(seed);
    node.addSegment(seg(V(1000, 0), V(2000, 0)));
    node.addSegment(seg(V(1000, 0), V(1000, 1000)));

    const path = new PnsTopology(node).assembleTrivialPath(seed);

    // Both arms are 1000 long and the comparison is a strict `>`, so the first
    // terminal to be *reached* keeps `best` — and the stack is LIFO, so that is
    // the branch pushed **last**, i.e. the last one on the joint's link list.
    expect(shape(path)).toEqual(['line 0,0 -> 1000,0', 'line 1000,0 -> 1000,1000']);
  });

  it('returns the best found so far when the timeout expires', () => {
    const node = new PnsNode();
    const seed = seg(V(0, 0), V(1000, 0));

    node.addSegment(seed);
    node.addSegment(seg(V(1000, 0), V(9000, 0)));
    node.addSegment(seg(V(1000, 0), V(1000, 500)));

    // A negative budget expires on the first stack pop, so nothing is explored.
    // This is upstream's behaviour, not a degenerate case: on a big enough
    // graph the 500 ms default does the same thing on a slow machine.
    const path = new PnsTopology(node, -1).assembleTrivialPath(seed);

    expect(shape(path)).toEqual(['line 0,0 -> 1000,0']);
  });

  it('stores copies of the lines, not the assembled objects', () => {
    const node = new PnsNode();
    const s = seg(V(0, 0), V(1000, 0));

    node.addSegment(s);

    const path = new PnsTopology(node).assembleTrivialPath(s);
    const line = path.at(0) as unknown as PnsLine;

    // `ITEM_SET::Add( const LINE& )` clones; the set owns its copy.
    expect(line.owner()).toBe(path);
    expect(line.links()).toEqual([s]);
  });
});
