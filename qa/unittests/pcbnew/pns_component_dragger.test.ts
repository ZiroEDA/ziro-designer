// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::COMPONENT_DRAGGER`. Counterpart:
 * `pcbnew/router/pns_component_dragger.{h,cpp}`.
 *
 * What is worth pinning, and why:
 *
 * - **The rigid/connection split is the whole algorithm.** A track between two
 *   pads that are both being dragged translates whole; one with a free end is
 *   re-cut by `DragCorner`. Get it wrong and dragging a footprint either tears
 *   its internal links apart or drags the whole board with it.
 * - **`Drag` re-branches the world every move** (after `KillChildren`), so a
 *   move is never computed on top of the previous one.
 * - **A non-routable pad short-circuits before its connections' anchors are
 *   updated**, leaving them at whatever the previous move set — `(0, 0)` on the
 *   first.
 * - **`CLine().Find(...)` of −1 reaches `DragCorner` and is a no-op**, so the
 *   connection is removed and re-added unchanged rather than mangled.
 * - **`m_dragStatus` is never written**, so `GetForceMarkObstaclesMode` always
 *   reports false through its out-parameter.
 * - **`FixRoute` is the only place collisions are consulted**, and any one of
 *   three conditions is enough to commit.
 */
import { describe, expect, it } from 'vitest';
import { PnsComponentDragger } from '@ziroeda/pcbnew/src/router/pns_component_dragger.js';
import {
  PnsDragMode,
  PNS_UNDEFINED_LAYER,
  makePnsRouterHost,
} from '@ziroeda/pcbnew/src/router/pns_drag_algo.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import type { PnsLine } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { NetHandle, PnsRuleResolver } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };

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

function seg(a: Vec2, b: Vec2, net: NetHandle = NET_A, width = 100): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width }, net);
  s.setLayers(new PnsLayerRange(0));
  return s;
}

function pad(pos: Vec2, size = 400, net: NetHandle = NET_A): PnsSolid {
  const s = new PnsSolid();
  s.setPos(pos);
  s.setNet(net);
  s.setLayers(new PnsLayerRange(0));
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

function harness(aWorld: PnsNode, aSettings: Partial<RoutingSettings> = {}) {
  const settings: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, ...aSettings };
  const committed: PnsNode[] = [];

  const host = makePnsRouterHost({
    settings: () => settings,
    commitRouting: (n) => committed.push(n),
  });

  const dragger = new PnsComponentDragger(host);
  dragger.setWorld(aWorld);

  return { dragger, committed };
}

/**
 * Two pads of one "footprint", the track between them, and a track leaving the
 * first pad for a free end on the board.
 */
function twoPadFootprint(n: PnsNode) {
  const p1 = pad(V(0, 0));
  const p2 = pad(V(2000, 0));

  n.addSolid(p1);
  n.addSolid(p2);

  const internal = seg(V(0, 0), V(2000, 0));
  const external = seg(V(0, 0), V(0, -3000));

  n.addSegment(internal);
  n.addSegment(external);

  return { p1, p2, internal, external };
}

describe('COMPONENT_DRAGGER::Start', () => {
  it('classifies a pad-to-pad track as rigid and a free-ended one as a connection', () => {
    const n = makeNode();
    const { p1, p2, internal, external } = twoPadFootprint(n);
    const { dragger } = harness(n);

    const prims = new PnsItemSet();
    prims.add(p1);
    prims.add(p2);

    expect(dragger.start(V(0, 0), prims)).toBe(true);

    expect([...dragger.fixedItems()]).toContain(internal);
    expect([...dragger.fixedItems()]).not.toContain(external);

    expect(dragger.connections()).toHaveLength(1);
    expect(dragger.connections()[0]?.attachedPad).toBe(p1);
  });

  it('treats a pad-to-pad track as a connection when only one pad is selected', () => {
    const n = makeNode();
    const { p1, internal } = twoPadFootprint(n);
    const { dragger } = harness(n);

    // Only p1 is being dragged, so the internal track's far end is not on a
    // dragged pad and it becomes a re-routable connection.
    expect(dragger.start(V(0, 0), new PnsItemSet(p1))).toBe(true);

    expect([...dragger.fixedItems()]).not.toContain(internal);
    expect(dragger.connections()).toHaveLength(2);
  });

  it('skips fanout for a non-routable pad but still drags it', () => {
    const n = makeNode();
    const { p1 } = twoPadFootprint(n);

    p1.setRoutable(false);

    const { dragger } = harness(n);

    expect(dragger.start(V(0, 0), new PnsItemSet(p1))).toBe(true);
    expect(dragger.connections()).toHaveLength(0);
    expect(dragger.fixedItems().size).toBe(0);
  });

  it('answers the constants upstream answers', () => {
    const n = makeNode();
    const { dragger } = harness(n);

    expect(dragger.mode()).toBe(PnsDragMode.DM_COMPONENT);
    expect(dragger.currentLayer()).toBe(PNS_UNDEFINED_LAYER);
    expect(dragger.currentNets()).toEqual([]);
  });
});

describe('COMPONENT_DRAGGER::Drag', () => {
  it('translates the pads and the rigid track, and re-cuts the connection', () => {
    const n = makeNode();
    const { p1, p2 } = twoPadFootprint(n);
    const { dragger } = harness(n);

    const prims = new PnsItemSet();
    prims.add(p1);
    prims.add(p2);

    dragger.start(V(0, 0), prims);

    expect(dragger.drag(V(0, 1000))).toBe(true);

    const traces = dragger.traces();
    const solids = traces.citems().filter((i) => i.kind() === PnsKind.SOLID_T) as PnsSolid[];
    const segs = traces.citems().filter((i) => i.kind() === PnsKind.SEGMENT_T) as PnsSegment[];
    const lines = traces.citems().filter((i) => i.kind() === PnsKind.LINE_T) as PnsLine[];

    expect(solids.map((s) => s.pos())).toEqual([V(0, 1000), V(2000, 1000)]);

    // The rigid track moved whole.
    expect(segs).toHaveLength(1);
    expect(segs[0]?.seg()).toEqual({ a: V(0, 1000), b: V(2000, 1000) });

    // The connection kept its free end and moved only the pad end.
    expect(lines).toHaveLength(1);
    expect((lines[0] as PnsLine).cLine().find(V(0, -3000))).toBeGreaterThanOrEqual(0);
    expect((lines[0] as PnsLine).cLine().find(V(0, 0))).toBe(-1);
  });

  it('re-branches the world every move rather than stacking branches', () => {
    const n = makeNode();
    const { p1 } = twoPadFootprint(n);
    const { dragger } = harness(n);

    dragger.start(V(0, 0), new PnsItemSet(p1));

    dragger.drag(V(0, 1000));
    const first = dragger.currentNode();

    dragger.drag(V(0, 2000));
    const second = dragger.currentNode();

    expect(second).not.toBe(first);
    expect(second?.getParent()).toBe(n);
    // KillChildren() dropped the previous branch.
    expect([...n.children()]).toEqual([second]);
  });

  it('leaves a non-routable pad’s connection alone, because its anchors are stale', () => {
    const n = makeNode();
    const p1 = pad(V(0, 0));
    n.addSolid(p1);
    const s = seg(V(0, 0), V(0, -3000));
    n.addSegment(s);

    const { dragger } = harness(n);

    dragger.start(V(0, 0), new PnsItemSet(p1));
    expect(dragger.connections()).toHaveLength(1);

    // Make the pad non-routable *after* Start, so the connection exists but the
    // Drag loop short-circuits before updating its anchors.
    p1.setRoutable(false);

    dragger.drag(V(0, 1000));

    const lines = dragger
      .traces()
      .citems()
      .filter((i) => i.kind() === PnsKind.LINE_T);

    // p_orig is still (0, 0) from value-initialisation; the assembled line has
    // no such vertex any more than it has p_next, so Find() is −1 and
    // DragCorner is a no-op.
    expect(lines).toHaveLength(1);
    expect((lines[0] as PnsLine).cLine().points()).toEqual([V(0, 0), V(0, -3000)]);
  });

  it('never writes m_dragStatus', () => {
    const n = makeNode();
    const { p1 } = twoPadFootprint(n);
    const { dragger } = harness(n);

    dragger.start(V(0, 0), new PnsItemSet(p1));
    dragger.drag(V(0, 1000));

    const status = { value: true };
    expect(dragger.getForceMarkObstaclesMode(status)).toBe(false);
    expect(status.value).toBe(false);
  });
});

describe('COMPONENT_DRAGGER::FixRoute', () => {
  it('commits a clean drag', () => {
    const n = makeNode();
    const { p1 } = twoPadFootprint(n);
    const { dragger, committed } = harness(n);

    dragger.start(V(0, 0), new PnsItemSet(p1));
    dragger.drag(V(0, 1000));

    expect(dragger.fixRoute(false)).toBe(true);
    expect(committed).toHaveLength(1);
  });

  it('refuses a colliding drag, but takes either escape hatch', () => {
    const build = (settings: Partial<RoutingSettings>) => {
      const n = makeNode(500);
      const { p1 } = twoPadFootprint(n);
      // Something on another net for the dragged pad to land on.
      const blocker = pad(V(0, 1000), 400, { name: 'B' });
      n.addSolid(blocker);

      const h = harness(n, settings);

      h.dragger.start(V(0, 0), new PnsItemSet(p1));
      h.dragger.drag(V(0, 1000));

      return h;
    };

    const plain = build({});
    expect(plain.dragger.fixRoute(false)).toBe(false);
    expect(plain.committed).toHaveLength(0);

    const forced = build({});
    expect(forced.dragger.fixRoute(true)).toBe(true);

    const permissive = build({ allowDrcViolations: true });
    expect(permissive.dragger.fixRoute(false)).toBe(true);
  });
});
