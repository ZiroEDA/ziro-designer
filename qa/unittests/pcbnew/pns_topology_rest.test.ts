// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::TOPOLOGY` past the trivial-path walk.
 * Counterpart: `pcbnew/router/pns_topology.cpp` (`ConnectedJoints`,
 * `NearestUnconnectedItem`, `NearestUnconnectedAnchorPoint`, `LeadingRatLine`,
 * `AssembleCluster`, `AssembleDiffPair`, `AssembleTuningPath`).
 *
 * `pns_topology.test.ts` next to this one covers `AssembleTrivialPath`.
 *
 * What is worth pinning here:
 *
 * - **`LeadingRatLine` reads the node's index, not a ratsnest.** Two earlier
 *   ports believed otherwise; the ratline test builds nothing but router items.
 * - **`AssembleCluster`'s area limit is checked before admission**, and the
 *   box it checks has already grown by the item being rejected.
 * - **`AssembleDiffPair` measures its gap after the polarity swap**, so the
 *   width subtracted is the other lane's.
 * - **`AssembleTuningPath` gates its `aStartPad`/`aEndPad` out-parameters on
 *   the end solid having a board `PAD` parent**, so with no host they are null
 *   even though the walk found the pad and stopped on it.
 */
import { describe, expect, it } from 'vitest';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsTopology } from '@ziroeda/pcbnew/src/router/pns_topology.js';
import type {
  PnsBoardPadHandle,
  PnsBoardViaHandle,
  PnsTuningHost,
} from '@ziroeda/pcbnew/src/router/pns_topology.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { PnsJoint } from '@ziroeda/pcbnew/src/router/pns_joint.js';
import type { NetHandle, PnsRuleResolver } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };
const NET_B: NetHandle = { name: 'B' };
const NET_P: NetHandle = { name: 'P' };
const NET_N: NetHandle = { name: 'N' };

/**
 * A resolver that answers zero clearance, a positive net code and one fixed
 * diff-pair coupling. `netCode` matters: `NearestUnconnectedAnchorPoint`
 * rejects a joint whose net code is `<= 0` before it does anything else.
 */
class TestResolver implements PnsRuleResolver {
  polarity = 0;
  netCodeValue = 1;

  clearance(): number {
    return 0;
  }
  dpCoupledNet(net: NetHandle): NetHandle {
    if (net === NET_P) return NET_N;
    if (net === NET_N) return NET_P;
    return null;
  }
  dpNetPolarity(): number {
    return this.polarity;
  }
  dpNetPair(): null {
    return null;
  }
  netCode(): number {
    return this.netCodeValue;
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

interface SegOpts {
  net?: NetHandle;
  layer?: number;
  width?: number;
}

function seg(a: Vec2, b: Vec2, opts: SegOpts = {}): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: opts.width ?? 100 }, opts.net ?? NET_A);
  s.setLayers(new PnsLayerRange(opts.layer ?? 0));
  return s;
}

function solid(at: Vec2, opts: { net?: NetHandle; layer?: number; r?: number } = {}): PnsSolid {
  const s = new PnsSolid();
  s.setNet(opts.net ?? NET_A);
  s.setLayers(new PnsLayerRange(opts.layer ?? 0));
  s.setShape({ kind: 'circle', c: V(0, 0), r: opts.r ?? 250 });
  s.setPos(at);
  return s;
}

function via(at: Vec2): PnsVia {
  return new PnsVia(at, new PnsLayerRange(0, 3), 400, 200, NET_A);
}

function track(points: Vec2[], opts: SegOpts = {}): PnsLine {
  const l = new PnsLine();
  l.setShape(PnsLineChain.fromPoints(points));
  l.setWidth(opts.width ?? 100);
  l.setLayers(new PnsLayerRange(opts.layer ?? 0));
  l.setNet(opts.net ?? NET_A);
  return l;
}

/** The path as a readable shape: kinds, with each LINE's endpoints. */
const shape = (set: { citems(): readonly PnsItem[] }): string[] =>
  set.citems().map((i) => {
    if (i.kind() !== PnsKind.LINE_T) return i.kind() === PnsKind.VIA_T ? 'via' : 'item';

    const l = i as PnsLine;

    return `line ${l.cPoint(0).x},${l.cPoint(0).y} -> ${l.cLastPoint().x},${l.cLastPoint().y}`;
  });

/** A node whose resolver answers the diff-pair and net-code questions. */
function nodeWith(): { node: PnsNode; resolver: TestResolver } {
  const node = new PnsNode();
  const resolver = new TestResolver();

  node.setRuleResolver(resolver);

  return { node, resolver };
}

// ---------------------------------------------------------------------------------
describe('TOPOLOGY::ConnectedJoints', () => {
  it('walks a run of segments end to end', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));

    node.addSegment(a);
    node.addSegment(seg(V(1000, 0), V(2000, 0)));
    node.addSegment(seg(V(2000, 0), V(3000, 0)));

    const start = node.findJointForItem(V(0, 0), a);
    const joints = new PnsTopology(node).connectedJoints(start as PnsJoint);

    expect(joints.size).toBe(4);
    expect([...joints].map((j) => j.pos().x).sort((x, y) => x - y)).toEqual([0, 1000, 2000, 3000]);
  });

  it('crosses a via, because the via merged the two layers onto one joint', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0), { layer: 0 });

    node.addSegment(a);
    node.addSegment(seg(V(1000, 0), V(2000, 0), { layer: 3 }));
    node.addVia(via(V(1000, 0)));

    const start = node.findJointForItem(V(0, 0), a);
    const joints = new PnsTopology(node).connectedJoints(start as PnsJoint);

    // The via itself is never *walked* — only SEGMENT_T|ARC_T links are — but
    // `addVia` merged the layer-0 and layer-3 joints at (1000,0) into one, and
    // that shared joint is what carries the walk across.
    expect([...joints].map((j) => j.pos().x).sort((x, y) => x - y)).toEqual([0, 1000, 2000]);
  });

  it('does not reach a second run that only touches geometrically', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));

    node.addSegment(a);
    node.addSegment(seg(V(5000, 0), V(6000, 0)));

    const start = node.findJointForItem(V(0, 0), a);

    expect(new PnsTopology(node).connectedJoints(start as PnsJoint).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------------
describe('TOPOLOGY::NearestUnconnectedItem', () => {
  it('finds the nearest anchor of the nearest item not already joined', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    const far = seg(V(5000, 0), V(6000, 0));

    node.addSegment(a);
    node.addSegment(far);

    const start = node.findJointForItem(V(0, 0), a);
    const hit = new PnsTopology(node).nearestUnconnectedItem(start as PnsJoint);

    expect(hit?.item).toBe(far);
    // Anchor 0 is at 5000 and anchor 1 at 6000; the search reports the index,
    // not the point, and the caller resolves it back through `Anchor()`.
    expect(hit?.anchor).toBe(0);
  });

  it('answers null when everything on the net is already connected', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));

    node.addSegment(a);
    node.addSegment(seg(V(1000, 0), V(2000, 0)));

    const start = node.findJointForItem(V(0, 0), a);

    expect(new PnsTopology(node).nearestUnconnectedItem(start as PnsJoint)).toBeNull();
  });

  it('ignores items the kind mask excludes', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));

    node.addSegment(a);
    node.addSegment(seg(V(5000, 0), V(6000, 0)));
    node.addSolid(solid(V(9000, 0)));

    const start = node.findJointForItem(V(0, 0), a);
    const hit = new PnsTopology(node).nearestUnconnectedItem(start as PnsJoint, PnsKind.SOLID_T);

    // The segment at 5000 is nearer, and is not a candidate at all.
    expect(hit?.item.kind()).toBe(PnsKind.SOLID_T);
  });
});

// ---------------------------------------------------------------------------------
describe('TOPOLOGY::LeadingRatLine', () => {
  it('points from the end of the track to the nearest unconnected anchor', () => {
    const { node } = nodeWith();

    node.addSegment(seg(V(5000, 0), V(6000, 0)));

    const ratLine = new PnsLineChain();
    const ok = new PnsTopology(node).leadingRatLine(track([V(0, 0), V(1000, 0)]), ratLine);

    // Nothing here is a board object: the answer comes out of NODE's own index.
    expect(ok).toBe(true);
    expect(ratLine.points()).toEqual([V(1000, 0), V(5000, 0)]);
  });

  it('stops at the joint itself when the track already landed on something', () => {
    const { node } = nodeWith();
    const target = seg(V(1000, 0), V(2000, 0));

    node.addSegment(target);

    const hit = new PnsTopology(node).nearestUnconnectedAnchorPoint(track([V(0, 0), V(1000, 0)]));

    // Two links on the joint — the track's own new segment and `target` — so
    // the "already connected" branch runs and reports the *joint's* position
    // and layers rather than the item's.
    expect(hit?.point).toEqual(V(1000, 0));
    expect(hit?.item).toBe(target);
  });

  it('leaves the caller’s chain alone when it fails', () => {
    const { node, resolver } = nodeWith();

    resolver.netCodeValue = 0;
    node.addSegment(seg(V(5000, 0), V(6000, 0)));

    const ratLine = PnsLineChain.fromPoints([V(7, 7)]);
    const ok = new PnsTopology(node).leadingRatLine(track([V(0, 0), V(1000, 0)]), ratLine);

    // `Clear()` is after the early return, so a stale ratline survives a
    // failure. Upstream's; both real callers pass a fresh chain.
    expect(ok).toBe(false);
    expect(ratLine.points()).toEqual([V(7, 7)]);
  });

  it('does not leave its scratch branch attached to the world', () => {
    const { node } = nodeWith();

    node.addSegment(seg(V(5000, 0), V(6000, 0)));
    new PnsTopology(node).nearestUnconnectedAnchorPoint(track([V(0, 0), V(1000, 0)]));

    expect(node.hasChildren()).toBe(false);
  });
});

// ---------------------------------------------------------------------------------
describe('TOPOLOGY::AssembleCluster', () => {
  it('gathers everything touching the seed', () => {
    const node = new PnsNode();
    const pad = solid(V(0, 0), { net: NET_B });
    const touching = seg(V(0, 0), V(1000, 0));

    node.addSolid(pad);
    node.addSegment(touching);
    node.addSegment(seg(V(50000, 0), V(51000, 0)));

    const cluster = new PnsTopology(node).assembleCluster(pad, 0);

    expect(cluster.items).toEqual([pad, touching]);
    // `CLUSTER::m_key` is declared upstream and assigned by nothing.
    expect(cluster.key).toBeNull();
  });

  it('does not treat two crossing tracks on different nets as one cluster', () => {
    const node = new PnsNode();
    const a = seg(V(0, -1000), V(0, 1000), { net: NET_A });

    node.addSegment(a);
    node.addSegment(seg(V(-1000, 0), V(1000, 0), { net: NET_B }));

    expect(new PnsTopology(node).assembleCluster(a, 0).items).toEqual([a]);
  });

  it('skips the excluded net', () => {
    const node = new PnsNode();
    const pad = solid(V(0, 0), { net: NET_B });

    node.addSolid(pad);
    node.addSegment(seg(V(0, 0), V(1000, 0), { net: NET_A }));

    expect(new PnsTopology(node).assembleCluster(pad, 0, 0.0, NET_A).items).toEqual([pad]);
  });

  it('refuses to admit an item once the box has grown past the limit', () => {
    const node = new PnsNode();
    const pad = solid(V(0, 0), { net: NET_B });

    node.addSolid(pad);
    node.addSegment(seg(V(0, 0), V(1000000, 0)));

    // The box is merged *before* the limit is tested, so the very item that
    // blew the budget is the one that gets rejected. Without a limit it joins.
    expect(new PnsTopology(node).assembleCluster(pad, 0, 10.0).items).toEqual([pad]);
    expect(new PnsTopology(node).assembleCluster(pad, 0).items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------
describe('TOPOLOGY::AssembleDiffPair', () => {
  const buildPair = (): { node: PnsNode; resolver: TestResolver; p: PnsSegment; n: PnsSegment } => {
    const { node, resolver } = nodeWith();
    const p = seg(V(0, 0), V(10000, 0), { net: NET_P });
    const n = seg(V(0, 1000), V(10000, 1000), { net: NET_N });

    node.addSegment(p);
    node.addSegment(n);

    return { node, resolver, p, n };
  };

  it('recovers the coupled lane and measures the gap', () => {
    const { node, p } = buildPair();
    const pair = new PnsTopology(node).assembleDiffPair(p);

    expect(pair?.netP()).toBe(NET_P);
    expect(pair?.netN()).toBe(NET_N);
    expect(pair?.width()).toBe(100);
    // centre-to-centre 1000 minus one track width: the *gap*, not the pitch.
    expect(pair?.gap()).toBe(900);
  });

  it('swaps the lanes for a negative-polarity net', () => {
    const { node, resolver, p, n } = buildPair();

    resolver.polarity = -1;

    const pair = new PnsTopology(node).assembleDiffPair(p);

    expect(pair?.netP()).toBe(NET_N);
    // The links survive the copy, which is what `DP_MEANDER_PLACER::Start`
    // reads to seed its tuning path.
    expect(pair?.pLine().getLink(0)).toBe(n);
  });

  it('answers null when the net has no complement', () => {
    const { node } = nodeWith();
    const a = seg(V(0, 0), V(10000, 0), { net: NET_A });

    node.addSegment(a);

    expect(new PnsTopology(node).assembleDiffPair(a)).toBeNull();
  });

  it('will not couple lanes of different widths', () => {
    const { node } = nodeWith();
    const p = seg(V(0, 0), V(10000, 0), { net: NET_P, width: 100 });

    node.addSegment(p);
    node.addSegment(seg(V(0, 1000), V(10000, 1000), { net: NET_N, width: 200 }));

    expect(new PnsTopology(node).assembleDiffPair(p)).toBeNull();
  });

  it('will not couple lanes that are not parallel', () => {
    const { node } = nodeWith();
    const p = seg(V(0, 0), V(10000, 0), { net: NET_P });

    node.addSegment(p);
    node.addSegment(seg(V(0, 1000), V(10000, 6000), { net: NET_N }));

    expect(new PnsTopology(node).assembleDiffPair(p)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
describe('TOPOLOGY::AssembleTuningPath', () => {
  it('walks through a via by geometry, not by joint', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0), { layer: 0 });

    node.addSegment(a);
    node.addSegment(seg(V(1000, 0), V(2000, 0), { layer: 3 }));
    node.addVia(via(V(1000, 0)));

    const result = new PnsTopology(node).assembleTuningPath(null, a);

    expect(shape(result.path)).toEqual(['line 0,0 -> 1000,0', 'via', 'line 1000,0 -> 2000,0']);
  });

  it('stops on a pad but reports no start or end pad without a host', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    const pad = solid(V(1000, 0));

    node.addSegment(a);
    node.addSolid(pad);

    const result = new PnsTopology(node).assembleTuningPath(null, a);

    // The walk *did* find the pad — it is what ended the right-hand branch.
    // `*aEndPad` is assigned inside `bi->Type() == PCB_PAD_T` upstream, so a
    // SOLID with no board pad behind it is silently not reported.
    expect(shape(result.path)).toEqual(['line 0,0 -> 1000,0']);
    expect(result.startPad).toBeNull();
    expect(result.endPad).toBeNull();
  });

  it('reports the end pad, and clips inside it, once a host resolves one', () => {
    const node = new PnsNode();
    const a = seg(V(0, 0), V(1000, 0));
    const pad = solid(V(1000, 0));

    node.addSegment(a);
    node.addSolid(pad);

    const boardPad: PnsBoardPadHandle = { pad: 'U1-1' };
    const clipped: number[] = [];

    const host: PnsTuningHost = {
      getBoardLayerFromPNSLayer: (l) => l,
      boardVia: (): PnsBoardViaHandle | null => null,
      boardPad: (s) => (s === pad ? boardPad : null),
      isPointInsideViaPad: () => false,
      optimiseTraceInVia: () => {},
      optimiseTraceInPad: (line) => {
        clipped.push(line.pointCount());
      },
    };

    const result = new PnsTopology(node).assembleTuningPath(host, a);

    expect(result.endPad).toBe(pad);
    expect(result.startPad).toBeNull();
    // One line in the path, so exactly one clip call for the one board pad.
    expect(clipped).toEqual([2]);
  });

  it('returns nothing for a start item that is neither via, segment nor arc', () => {
    const node = new PnsNode();
    const pad = solid(V(0, 0));

    node.addSolid(pad);

    expect(new PnsTopology(node).assembleTuningPath(null, pad).path.size()).toBe(0);
  });

  it('takes a fanout via, which AssembleTrivialPath refuses', () => {
    const node = new PnsNode();
    const v = via(V(0, 0));

    node.addSegment(seg(V(0, 0), V(1000, 0), { layer: 0 }));
    node.addSegment(seg(V(0, 0), V(0, 1000), { layer: 0 }));
    node.addSegment(seg(V(0, 0), V(-1000, 0), { layer: 3 }));
    node.addVia(v);

    const topo = new PnsTopology(node);

    // `IsNonFanoutVia` is false, so `AssembleTrivialPath` gives up entirely —
    // the tuning path falls through to `findLinesFromVia` instead.
    expect(topo.assembleTrivialPath(v).size()).toBe(0);
    expect(topo.assembleTuningPath(null, v).path.size()).toBeGreaterThan(0);
  });
});
