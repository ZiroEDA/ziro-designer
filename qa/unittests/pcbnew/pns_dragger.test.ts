// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::DRAGGER`. Counterpart: `pcbnew/router/pns_dragger.{h,cpp}`.
 *
 * What is worth pinning, and why:
 *
 * - **`m_mode` carries `DM_FREE_ANGLE` only between `SetMode` and `Start`.**
 *   `Start` latches the bit into `m_freeAngleMode` and the start-drag helpers
 *   then overwrite `m_mode` with a single mode bit. Read the bit any later and
 *   free-angle dragging silently stops working.
 * - **`startDragSegment`'s two comparisons differ**: `distA < w2 || distB < w2`
 *   decides *whether* it is a corner drag, `distB <= distA` decides *which*
 *   corner — so an exactly equidistant grab takes the far one.
 * - **`checkVirtualVia` tests A first, with `<=`.**
 * - **`dragMarkObstacles` returns true even when the result collides.** The
 *   status is carried by `m_dragStatus`, which is why `Drag`'s recovery path is
 *   unreachable in mark-obstacles mode and why `m_forceMarkObstaclesMode` is a
 *   one-way latch.
 * - **`Start` builds a SHOVE only in `RM_Shove` *and* not free-angle.**
 * - **`findViaFanoutByHandle` reverses a line whose seed is not its first
 *   segment**, and adds at most one via.
 * - **`FixRoute`'s third branch re-drags to `m_lastValidPoint`** before giving
 *   up, and `m_lastValidPoint` only advances on a successful drag.
 * - **`Drag`'s non-first failure rebuilds `m_lastNode` from its parent** and
 *   re-adds `m_lastDragSolution`.
 * - **`VIA::PushoutForce` fails on exhausting its iterations**, tested with the
 *   `iter == aMaxIterations` boundary.
 */
import { describe, expect, it } from 'vitest';
import { PnsDragger, viaPushoutForce } from '@ziroeda/pcbnew/src/router/pns_dragger.js';
import {
  PnsDragMode,
  makePnsRouterHost,
  type PnsRouterHost,
} from '@ziroeda/pcbnew/src/router/pns_drag_algo.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { type PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsArc } from '@ziroeda/pcbnew/src/router/pns_arc.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVVia, PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  PnsMode,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { NetHandle, PnsRuleResolver } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };
const NET_B: NetHandle = { name: 'B' };

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

function via(pos: Vec2, net: NetHandle = NET_A, diameter = 400): PnsVia {
  const v = new PnsVia(pos, new PnsLayerRange(0, 1), diameter, Math.trunc(diameter / 2), net);
  return v;
}

function solid(pos: Vec2, size = 600, net: NetHandle = NET_B, layer = 0): PnsSolid {
  const s = new PnsSolid();
  s.setPos(pos);
  s.setNet(net);
  s.setLayers(new PnsLayerRange(layer));
  s.setShape({
    kind: 'poly',
    pts: [
      V(pos.x - size / 2, pos.y - size / 2),
      V(pos.x + size / 2, pos.y - size / 2),
      V(pos.x + size / 2, pos.y + size / 2),
      V(pos.x - size / 2, pos.y + size / 2),
    ],
    r: 0,
  });
  return s;
}

interface Harness {
  dragger: PnsDragger;
  host: PnsRouterHost;
  committed: PnsNode[];
  failures: string[];
  settings: RoutingSettings;
}

function harness(aWorld: PnsNode, aSettings: Partial<RoutingSettings> = {}): Harness {
  const settings: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, ...aSettings };
  const committed: PnsNode[] = [];
  const failures: string[] = [];

  const host = makePnsRouterHost({
    settings: () => settings,
    commitRouting: (n) => committed.push(n),
    setFailureReason: (r) => failures.push(r),
  });

  const dragger = new PnsDragger(host);
  dragger.setWorld(aWorld);

  return { dragger, host, committed, failures, settings };
}

/** A straight three-segment track on net A, added to `n`. */
function track(n: PnsNode, pts: Vec2[], net: NetHandle = NET_A, width = 100): PnsSegment[] {
  const segs: PnsSegment[] = [];

  for (let i = 0; i + 1 < pts.length; i++) {
    const s = seg(pts[i] as Vec2, pts[i + 1] as Vec2, net, width);
    n.addSegment(s);
    segs.push(s);
  }

  return segs;
}

describe('DRAGGER::Start', () => {
  it('refuses an empty primitive set', () => {
    const n = makeNode();
    const { dragger } = harness(n);

    expect(dragger.start(V(0, 0), new PnsItemSet())).toBe(false);
  });

  it('refuses a start item that is neither segment, arc nor via', () => {
    const n = makeNode();
    const pad = solid(V(0, 0));
    n.addSolid(pad);

    const { dragger } = harness(n);

    expect(dragger.start(V(0, 0), new PnsItemSet(pad))).toBe(false);
  });

  it('branches the world once, and leaves the world alone', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n);

    dragger.start(V(500, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.preDragNode()).not.toBe(n);
    expect(dragger.preDragNode()?.getParent()).toBe(n);
    // No Drag() yet, so CurrentNode is still the world.
    expect(dragger.currentNode()).toBe(n);
  });

  it('picks DM_SEGMENT for a grab away from either end', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n);

    dragger.start(V(500, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.mode()).toBe(PnsDragMode.DM_SEGMENT);
  });

  it('picks DM_CORNER within half a width of an end, and bumps the index for the far end', () => {
    const n = makeNode();
    // Width 100, so w2 = 50.
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n);

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));
    expect(dragger.mode()).toBe(PnsDragMode.DM_CORNER);
    expect(dragger.draggedSegmentIndex()).toBe(0);

    const n2 = makeNode();
    const [s2] = track(n2, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const h2 = harness(n2);

    h2.dragger.start(V(980, 0), new PnsItemSet(s2 as PnsSegment));
    expect(h2.dragger.mode()).toBe(PnsDragMode.DM_CORNER);
    expect(h2.dragger.draggedSegmentIndex()).toBe(1);
  });

  it('gives an exactly equidistant grab the far corner (distB <= distA)', () => {
    const n = makeNode();
    // A 60-unit segment of width 100: w2 = 50, and the midpoint is 30 from each
    // end, so both `< w2` tests pass and the tie-break decides.
    const s = seg(V(0, 0), V(60, 0));
    n.addSegment(s);
    n.addSegment(seg(V(60, 0), V(1060, 0)));

    const { dragger } = harness(n);

    dragger.start(V(30, 0), new PnsItemSet(s));

    expect(dragger.mode()).toBe(PnsDragMode.DM_CORNER);
    expect(dragger.draggedSegmentIndex()).toBe(1);
  });

  it('latches the free-angle bit and then overwrites the mode', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n);

    dragger.setMode((PnsDragMode.DM_SEGMENT | PnsDragMode.DM_FREE_ANGLE) as PnsDragMode);
    dragger.start(V(500, 0), new PnsItemSet(s as PnsSegment));

    // Free angle turns a mid-segment grab into a corner drag.
    expect(dragger.mode()).toBe(PnsDragMode.DM_CORNER);
    expect(dragger.mode() & PnsDragMode.DM_FREE_ANGLE).toBe(0);
  });

  it('drags a virtual via found at the grabbed segment’s endpoint', () => {
    const n = makeNode();
    const s = seg(V(0, 0), V(1000, 0));
    n.addSegment(s);
    n.addSegment(seg(V(1000, 0), V(2000, 0)));

    const vvia = new PnsVVia(V(1000, 0), 0, 300, NET_A);
    n.addVia(vvia);

    const { dragger } = harness(n);

    dragger.start(V(980, 0), new PnsItemSet(s));

    expect(dragger.mode()).toBe(PnsDragMode.DM_VIA);
    expect(dragger.draggedVia().pos).toEqual(V(1000, 0));
  });

  it('prefers endpoint A when both are within half a width', () => {
    const n = makeNode();
    // A 60-unit segment again: the cursor at 40 is nearer B, but A is tested
    // first and both tests are `<=`.
    const s = seg(V(0, 0), V(60, 0));
    n.addSegment(s);
    n.addSegment(seg(V(60, 0), V(1060, 0)));

    const vviaA = new PnsVVia(V(0, 0), 0, 300, NET_A);
    const vviaB = new PnsVVia(V(60, 0), 0, 300, NET_A);
    n.addVia(vviaA);
    n.addVia(vviaB);

    const { dragger } = harness(n);

    dragger.start(V(40, 0), new PnsItemSet(s));

    expect(dragger.draggedVia().pos).toEqual(V(0, 0));
  });

  it('builds a SHOVE only in RM_Shove, and not in free-angle mode', () => {
    const build = (mode: PnsMode, freeAngle: boolean) => {
      const n = makeNode();
      const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
      const { dragger } = harness(n, { routingMode: mode });

      if (freeAngle) dragger.setMode(PnsDragMode.DM_FREE_ANGLE);
      dragger.start(V(500, 0), new PnsItemSet(s as PnsSegment));

      return dragger.shove();
    };

    expect(build(PnsMode.RM_MarkObstacles, false)).toBeNull();
    expect(build(PnsMode.RM_Walkaround, false)).toBeNull();
    expect(build(PnsMode.RM_Shove, false)).not.toBeNull();
    expect(build(PnsMode.RM_Shove, true)).toBeNull();
  });
});

describe('DRAGGER::dragMarkObstacles', () => {
  it('moves the dragged corner and reports the new world', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.drag(V(0, 1000))).toBe(true);

    const traces = dragger.traces();
    expect(traces.size()).toBe(1);
    expect((traces.at(0) as PnsLine).cPoint(0)).toEqual(V(0, 1000));

    // The world is untouched; only the branch changed.
    expect(dragger.currentNode()).not.toBe(n);
  });

  it('returns true even when the result collides, and reports it via the status', () => {
    const n = makeNode(200);
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    // Something for the drag to run into, on another net.
    n.addSolid(solid(V(0, 1000)));

    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.drag(V(0, 1000))).toBe(true);

    const status = { value: true };
    expect(dragger.getForceMarkObstaclesMode(status)).toBe(false);
    expect(status.value).toBe(false);
  });

  it('reports success regardless of collisions when DRC violations are allowed', () => {
    const n = makeNode(200);
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    n.addSolid(solid(V(0, 1000)));

    const { dragger } = harness(n, {
      routingMode: PnsMode.RM_MarkObstacles,
      allowDrcViolations: true,
    });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));
    dragger.drag(V(0, 1000));

    const status = { value: false };
    dragger.getForceMarkObstaclesMode(status);
    expect(status.value).toBe(true);
  });

  it('rebuilds from the pre-drag node each move, not from the last one', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));

    dragger.drag(V(0, 1000));
    const first = dragger.currentNode();

    dragger.drag(V(0, 2000));
    const second = dragger.currentNode();

    expect(second).not.toBe(first);
    expect(second?.getParent()).toBe(dragger.preDragNode());
  });
});

describe('DRAGGER: the mode dispatch', () => {
  it('uses mark-obstacles for a free-angle drag whatever the routing mode', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_Shove });

    dragger.setMode(PnsDragMode.DM_FREE_ANGLE);
    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.shove()).toBeNull();
    expect(dragger.drag(V(17, 993))).toBe(true);

    // Free-angle drags put the corner exactly where asked.
    expect((dragger.traces().at(0) as PnsLine).cPoint(0)).toEqual(V(17, 993));
  });

  it('does not answer a mode it was never given', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n);

    dragger.start(V(500, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.currentLayer()).toBe(0);
    expect(dragger.currentNets()).toEqual([NET_A]);
  });

  it('answers the dragged via’s net in DM_VIA', () => {
    const n = makeNode();
    const v = via(V(0, 0), NET_B);
    n.addVia(v);

    const { dragger } = harness(n);

    dragger.start(V(0, 0), new PnsItemSet(v));

    expect(dragger.mode()).toBe(PnsDragMode.DM_VIA);
    expect(dragger.currentNets()).toEqual([NET_B]);
  });
});

describe('DRAGGER: DM_ARC control flow', () => {
  it('routes DM_ARC through the injected LINE::DragArc', () => {
    const n = makeNode();
    const s = seg(V(0, 0), V(1000, 0));
    n.addSegment(s);

    const calls: { p: Vec2; index: number }[] = [];
    const settings = { ...DEFAULT_ROUTING_SETTINGS };
    const host = makePnsRouterHost({
      settings: () => settings,
      dragArc: (l, p, index) => {
        calls.push({ p, index });
        // Stand in for the real geometry: move the last point.
        const pts = l.cLine().points();
        pts[pts.length - 1] = { ...p };
        l.setShape(PnsLineChain.fromPoints(pts));
      },
    });

    const dragger = new PnsDragger(host);
    dragger.setWorld(n);

    // Reach DM_ARC without an ARC item by driving the mode directly: Start
    // classifies, but the drag dispatch reads m_mode alone.
    dragger.start(V(500, 0), new PnsItemSet(s));
    dragger.setMode(PnsDragMode.DM_ARC);

    expect(dragger.drag(V(1000, 400))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.p).toEqual(V(1000, 400));
  });

  it('refuses an arc that is already near a half turn', () => {
    const n = makeNode();
    const { dragger, failures } = harness(n);

    // A near-semicircle: p0 (-1000,0), mid (0,-1000), p1 (1000,0) is exactly
    // 180°, which is past the 179° limit.
    const arc = new PnsArc(
      { p0: V(-1000, 0), arcMid: V(0, -1000), p1: V(1000, 0), width: 100 },
      NET_A,
    );
    arc.setLayers(new PnsLayerRange(0));
    n.addArc(arc);

    expect(dragger.start(V(0, -1000), new PnsItemSet(arc))).toBe(false);
    expect(failures[0]).toMatch(/Unable to drag arc tracks/);
  });
});

describe('DRAGGER::FixRoute', () => {
  it('commits when the last drag succeeded', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger, committed } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));
    dragger.drag(V(0, 1000));

    expect(dragger.fixRoute(false)).toBe(true);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toBe(dragger.currentNode());
  });

  it('dereferences the pre-drag node that Start never made (upstream crashes too)', () => {
    const { dragger, committed } = harness(makeNode());

    // CurrentNode() answers m_world, which is set, so FixRoute reaches its
    // third branch and re-drags. m_preDragNode is still null there, and
    // upstream's `m_preDragNode->Branch()` is a null dereference. Reproduced as
    // a throw rather than papered over with a guard upstream does not have.
    expect(() => dragger.fixRoute(false)).toThrow();
    expect(committed).toHaveLength(0);
  });

  it('only commits under force once mark-obstacles mode has latched', () => {
    const n = makeNode(200);
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    // A pad the walkaround cannot get past: it swallows the whole corner.
    n.addSolid(solid(V(0, 1000), 4000));

    const { dragger, committed } = harness(n, { routingMode: PnsMode.RM_Walkaround });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));
    dragger.drag(V(0, 1000));

    const status = { value: true };
    expect(dragger.getForceMarkObstaclesMode(status)).toBe(true);
    expect(status.value).toBe(false);

    expect(dragger.fixRoute(false)).toBe(false);
    expect(committed).toHaveLength(0);

    expect(dragger.fixRoute(true)).toBe(true);
    expect(committed).toHaveLength(1);
  });
});

describe('DRAGGER::Drag: the latch and the recovery', () => {
  it('latches force-mark-obstacles when the very first drag fails', () => {
    const n = makeNode(200);
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    n.addSolid(solid(V(0, 1000), 4000));

    const { dragger } = harness(n, { routingMode: PnsMode.RM_Walkaround });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));

    // The retry as mark-obstacles succeeds, so Drag reports true.
    expect(dragger.drag(V(0, 1000))).toBe(true);

    const status = { value: true };
    expect(dragger.getForceMarkObstaclesMode(status)).toBe(true);

    // Once latched, every later move goes to mark-obstacles.
    expect(dragger.drag(V(0, 1500))).toBe(true);
    expect(dragger.getForceMarkObstaclesMode(status)).toBe(true);
  });
});

describe('DRAGGER: DM_VIA in mark-obstacles mode', () => {
  /** A via with one track leaving it in each direction. */
  function viaFanout(n: PnsNode): PnsVia {
    const v = via(V(0, 0), NET_A, 400);
    n.addVia(v);
    n.addSegment(seg(V(0, 0), V(2000, 0)));
    n.addSegment(seg(V(0, 0), V(0, 2000)));

    return v;
  }

  it('moves the via and re-anchors every line leaving it', () => {
    const n = makeNode();
    const v = viaFanout(n);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    dragger.start(V(0, 0), new PnsItemSet(v));

    expect(dragger.drag(V(500, 500))).toBe(true);

    const traces = dragger.traces();
    const vias = traces.citems().filter((i) => i.kind() === PnsKind.VIA_T);
    const lines = traces.citems().filter((i) => i.kind() === PnsKind.LINE_T);

    expect(vias).toHaveLength(1);
    expect((vias[0] as PnsVia).pos()).toEqual(V(500, 500));

    // The fanout is reversed so the via's end is point 0 of each line, which is
    // what makes `Find( handle.pos )` a usable drag index.
    expect(lines).toHaveLength(2);
    for (const l of lines) expect((l as PnsLine).cPoint(0)).toEqual(V(500, 500));
  });

  it('adds at most one via from the joint, however many it carries', () => {
    const n = makeNode();
    const v = viaFanout(n);
    // A second via at the same joint.
    n.addVia(via(V(0, 0), NET_A, 300));

    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    dragger.start(V(0, 0), new PnsItemSet(v));
    dragger.drag(V(500, 500));

    expect(
      dragger
        .traces()
        .citems()
        .filter((i) => i.kind() === PnsKind.VIA_T),
    ).toHaveLength(1);
  });

  it('still succeeds when the handle has no line fanout', () => {
    const n = makeNode();
    const v = via(V(0, 0), NET_A, 400);
    n.addVia(v);

    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    dragger.start(V(0, 0), new PnsItemSet(v));

    expect(dragger.drag(V(500, 500))).toBe(true);
    expect(dragger.traces().size()).toBe(1);
  });
});

describe('DRAGGER::Drag: restoring the previous solution', () => {
  it('rebuilds the node from its parent rather than latching, after the first move', () => {
    const n = makeNode(200);
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    // Far enough away that the first drag is clear, big enough that the second
    // one cannot be walked around.
    n.addSolid(solid(V(0, 4000), 6000));

    const { dragger } = harness(n, { routingMode: PnsMode.RM_Walkaround });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.drag(V(0, 500))).toBe(true);

    const status = { value: false };
    expect(dragger.getForceMarkObstaclesMode(status)).toBe(false);

    const afterFirst = dragger.currentNode();

    // Into the pad: walkaround fails, and because this is not the first drag
    // the dragger keeps the previous solution rather than latching.
    expect(dragger.drag(V(0, 4000))).toBe(false);
    expect(dragger.getForceMarkObstaclesMode(status)).toBe(false);
    expect(dragger.currentNode()).not.toBe(afterFirst);
    expect(dragger.traces().size()).toBe(0);
  });
});

describe('DRAGGER: shove mode', () => {
  it('takes m_lastNode from the shove’s own node, not from the pre-drag branch', () => {
    const n = makeNode();
    const [s] = track(n, [V(0, 0), V(1000, 0), V(2000, 0)]);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_Shove });

    dragger.start(V(20, 0), new PnsItemSet(s as PnsSegment));

    expect(dragger.shove()).not.toBeNull();
    expect(dragger.drag(V(0, 1000))).toBe(true);

    expect(dragger.currentNode()?.getParent()).toBe(dragger.shove()?.currentNode());
  });
});

describe('VIA::PushoutForce', () => {
  it('answers no force when the via is already clear', () => {
    const n = makeNode(0);
    const v = via(V(0, 0));

    expect(viaPushoutForce(n, v, V(0, 0), PnsKind.ANY_T, 40)).toEqual(V(0, 0));
  });

  it('pushes a via out of a pad it is too close to', () => {
    const n = makeNode(100);
    n.addSolid(solid(V(500, 0), 600, NET_B));

    const v = via(V(0, 0), NET_A, 400);
    const force = viaPushoutForce(n, v, V(-1000, 0), PnsKind.ANY_T, 40);

    expect(force).toEqual(V(-100, 0));
  });

  it('gives up when the via centre is inside the obstacle, where the MTV is zero', () => {
    const n = makeNode(0);
    // The pad swallows the via's centre, so there is no separating direction.
    n.addSolid(solid(V(100, 0), 600, NET_B));

    const v = via(V(0, 0), NET_A, 400);

    expect(viaPushoutForce(n, v, V(-1000, 0), PnsKind.ANY_T, 40)).toBeNull();
  });

  it('clamps a step whose EuclideanNorm rounds up past its own truncation', () => {
    // `forceMag` is `force.EuclideanNorm()` (`pns_via.cpp:178`), and
    // `VECTOR2<int>::EuclideanNorm()` is `KiROUND( hypot( x, y ) )`
    // (`vector2d.h:283`) — it rounds. This geometry produces a per-step force
    // of (-48, -48), whose length is 67.88, against a threshold of
    // `Diameter / 4` = 67. Rounded that is 68, so the step is over the
    // threshold and gets resized to 67, which is (-47, -47). Truncated it is
    // 67, not over, and the whole (-48, -48) is applied.
    const n = makeNode(110);
    n.addSolid(solid(V(425, 425), 600));

    const v = via(V(0, 0), NET_A, 268);

    expect(viaPushoutForce(n, v, V(-1000, -1000), PnsKind.ANY_T, 40)).toEqual(V(-47, -47));
  });

  it('fails on exhausting its iterations even when the last one escaped', () => {
    const n = makeNode(100);
    n.addSolid(solid(V(500, 0), 600, NET_B));

    const v = via(V(0, 0), NET_A, 400);

    // The single iteration clears the via, but `iter == aMaxIterations` is
    // tested *after* the loop, so it is still a failure.
    expect(viaPushoutForce(n, v, V(-1000, 0), PnsKind.ANY_T, 1)).toBeNull();
  });
});
