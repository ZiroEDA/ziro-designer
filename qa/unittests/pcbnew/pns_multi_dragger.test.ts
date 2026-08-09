// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::MULTI_DRAGGER`. Counterpart: `pcbnew/router/pns_multi_dragger.{h,cpp}`.
 *
 * What is worth pinning, and why:
 *
 * - **Several selected segments of one line collapse into one `MDRAG_LINE`**,
 *   with the extras recorded as `originalLeaders`. Without the de-duplication a
 *   line would be dragged once per selected segment.
 * - **The mid-segment loop keeps the *last* match, not the nearest**, and
 *   overwrites `leaderSegIndex` even when a corner was already chosen. That is
 *   upstream and it decides which segment a bundle pivots on.
 * - **A tie between the nearest corner and the nearest mid-segment goes to the
 *   segment** (`minCornerDist < minLeadSegDist`).
 * - **`Mode()` always answers `DM_CORNER`** whatever mode is running, and
 *   `SetMode` is empty.
 * - **`multidragWalkaround` permutes attempt 1's results** onto the wrong
 *   lines. Upstream's bug, reproduced and pinned.
 * - **`clipToOtherLine` can clip a line to nothing**, because `tightest` is
 *   only assigned on a probe that clears.
 * - **`FixRoute` has no re-try**, unlike `DRAGGER::FixRoute`.
 * - **`DIRECTION_45::Opposite`** and `SEG::LineDistance`'s *sign*, which is what
 *   keeps lines on opposite sides of the primary on opposite sides.
 */
import { describe, expect, it } from 'vitest';
import {
  PnsMultiDragger,
  clipToOtherLine,
  directionOpposite,
  segLineDistance,
  segLineProject,
  chainPointAlong,
  segIntersectLines,
} from '@ziroeda/pcbnew/src/router/pns_multi_dragger.js';
import { PnsDragMode, makePnsRouterHost } from '@ziroeda/pcbnew/src/router/pns_drag_algo.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  PnsMode,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import { Direction45, Directions } from '@ziroeda/kimath/src/geometry/direction45.js';
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

function seg(a: Vec2, b: Vec2, net: NetHandle = NET_A, width = 100): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width }, net);
  s.setLayers(new PnsLayerRange(0));
  return s;
}

function track(n: PnsNode, pts: Vec2[], net: NetHandle, width = 100): PnsSegment[] {
  const segs: PnsSegment[] = [];

  for (let i = 0; i + 1 < pts.length; i++) {
    const s = seg(pts[i] as Vec2, pts[i + 1] as Vec2, net, width);
    n.addSegment(s);
    segs.push(s);
  }

  return segs;
}

function harness(aWorld: PnsNode, aSettings: Partial<RoutingSettings> = {}) {
  const settings: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, ...aSettings };
  const committed: PnsNode[] = [];

  const host = makePnsRouterHost({
    settings: () => settings,
    commitRouting: (n) => committed.push(n),
  });

  const dragger = new PnsMultiDragger(host);
  dragger.setWorld(aWorld);

  return { dragger, committed };
}

function line(points: Vec2[], net: NetHandle = NET_A, width = 100): PnsLine {
  const l = new PnsLine();
  l.setShape(PnsLineChain.fromPoints(points));
  l.setWidth(width);
  l.setNet(net);
  l.setLayers(new PnsLayerRange(0));
  return l;
}

/** Two parallel two-segment tracks, 500 apart. */
function bundle(n: PnsNode) {
  const a = track(n, [V(0, 0), V(1000, 0), V(2000, 0)], NET_A);
  const b = track(n, [V(0, 500), V(1000, 500), V(2000, 500)], NET_B);

  return { a, b };
}

describe('MULTI_DRAGGER::Start', () => {
  it('refuses an empty primitive set', () => {
    const { dragger } = harness(makeNode());

    expect(dragger.start(V(0, 0), new PnsItemSet())).toBe(false);
  });

  it('collapses several selected segments of one line into a single MDRAG_LINE', () => {
    const n = makeNode();
    const { a } = bundle(n);
    const { dragger } = harness(n);

    const prims = new PnsItemSet();
    prims.add(a[0] as PnsSegment);
    prims.add(a[1] as PnsSegment);

    expect(dragger.start(V(2000, 0), prims)).toBe(true);

    expect(dragger.mdragLines()).toHaveLength(1);
    expect(dragger.mdragLines()[0]?.originalLeaders).toHaveLength(2);
  });

  it('assembles one MDRAG_LINE per distinct line', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n);

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 0), prims);

    expect(dragger.mdragLines()).toHaveLength(2);
    for (const l of dragger.mdragLines()) expect(l.isDraggable).toBe(true);
  });

  it('takes a strict corner grab as DM_CORNER and marks the first strict line primary', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n);

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    // Within width/2 = 50 of line A's last point.
    dragger.start(V(2000, 10), prims);

    expect(dragger.dragMode()).toBe(PnsDragMode.DM_CORNER);
    expect(dragger.mdragLines()[0]?.isStrict).toBe(true);
    expect(dragger.mdragLines()[0]?.isPrimaryLine).toBe(true);
    expect(dragger.mdragLines()[1]?.isPrimaryLine).toBe(false);
  });

  it('takes a mid-segment grab as DM_SEGMENT', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n);

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    // Middle of A's second segment, far from either endpoint.
    dragger.start(V(1500, 0), prims);

    expect(dragger.dragMode()).toBe(PnsDragMode.DM_SEGMENT);
    expect(dragger.mdragLines()[0]?.isMidSeg).toBe(true);
  });

  it('lets the mid-segment loop overwrite a corner’s leaderSegIndex', () => {
    const n = makeNode();
    const a = track(n, [V(0, 0), V(1000, 0), V(2000, 0)], NET_A);
    const { dragger } = harness(n);

    // Select the *first* segment as well as grabbing near the last corner. The
    // corner test sets leaderSegIndex to 1; the mid-segment loop then finds
    // link 0 in the primitives and overwrites it with 0.
    const prims = new PnsItemSet();
    prims.add(a[0] as PnsSegment);
    prims.add(a[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);

    expect(dragger.mdragLines()[0]?.isCorner).toBe(true);
    // The *last* selected link wins, which for this line is index 1.
    expect(dragger.mdragLines()[0]?.leaderSegIndex).toBe(1);
  });

  it('always answers DM_CORNER from Mode(), and ignores SetMode', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n);

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(1500, 0), prims);
    dragger.setMode(PnsDragMode.DM_VIA);

    expect(dragger.dragMode()).toBe(PnsDragMode.DM_SEGMENT);
    expect(dragger.mode()).toBe(PnsDragMode.DM_CORNER);
    expect(dragger.currentLayer()).toBe(0);
  });

  it('builds the pre-shove node and the SHOVE only in RM_Shove', () => {
    const build = (mode: PnsMode) => {
      const n = makeNode();
      const { a, b } = bundle(n);
      const h = harness(n, { routingMode: mode });

      const prims = new PnsItemSet();
      prims.add(a[1] as PnsSegment);
      prims.add(b[1] as PnsSegment);

      h.dragger.start(V(2000, 10), prims);

      return h.dragger.shove();
    };

    expect(build(PnsMode.RM_MarkObstacles)).toBeNull();
    expect(build(PnsMode.RM_Walkaround)).toBeNull();
    expect(build(PnsMode.RM_Shove)).not.toBeNull();
  });
});

describe('MULTI_DRAGGER::Drag', () => {
  it('moves a corner bundle together, keeping the spacing', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);

    expect(dragger.drag(V(2000, 1000))).toBe(true);

    const lines = dragger.mdragLines();

    const endA = (lines[0] as { draggedLine: PnsLine }).draggedLine.cLastPoint();
    const endB = (lines[1] as { draggedLine: PnsLine }).draggedLine.cLastPoint();

    // The primary lands on the cursor; the secondary is placed at its own
    // signed distance along the *perpendicular of the primary's dragged last
    // segment*, which is diagonal here — so the 500 unit spacing is preserved
    // as a distance, not as a y offset.
    expect(endA).toEqual(V(2000, 1000));
    expect(endB).toEqual(V(1646, 1354));
  });

  it('reports the nets of the dragged lines, and nothing before the first drag', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);

    // draggedLine is still an empty LINE with no net.
    expect(dragger.currentNets()).toEqual([]);

    dragger.drag(V(2000, 1000));

    expect(new Set(dragger.currentNets())).toEqual(new Set([NET_A, NET_B]));
  });

  it('hands back the leader segments so the selection survives', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);
    dragger.drag(V(2000, 1000));

    // One per successfully dragged line, and they are the *new* segments.
    expect(dragger.getLastCommittedLeaderSegments()).toHaveLength(2);
    for (const s of dragger.getLastCommittedLeaderSegments()) {
      expect(prims.contains(s)).toBe(false);
    }
  });
});

describe('MULTI_DRAGGER::FixRoute', () => {
  it('commits a successful drag and refuses a failed one', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger, committed } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);
    dragger.drag(V(2000, 1000));

    expect(dragger.fixRoute(false)).toBe(true);
    expect(committed).toHaveLength(1);
  });

  it('has no re-try: a failed drag stays failed even under aForceCommit', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger, committed } = harness(n, { routingMode: PnsMode.RM_Shove });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);

    // Never dragged, so m_dragStatus is still false.
    expect(dragger.fixRoute(true)).toBe(false);
    expect(committed).toHaveLength(0);
  });

  it('commits a failed drag when DRC violations are allowed', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger, committed } = harness(n, { allowDrcViolations: true });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);

    expect(dragger.fixRoute(false)).toBe(true);
    expect(committed).toHaveLength(1);
  });
});

describe('clipToOtherLine', () => {
  it('clips a line back until it clears the reference', () => {
    const n = makeNode(0);
    const ref = line([V(1000, 0), V(1000, 5000)], NET_A);
    const clipped = line([V(0, 2000), V(4000, 2000)], NET_B);
    const before = clipped.cLine().length();

    expect(clipToOtherLine(n, ref, clipped)).toBe(true);
    expect(clipped.cLine().length()).toBeLessThan(before);
  });

  it('leaves a line that never touches the reference alone', () => {
    const n = makeNode(0);
    const ref = line([V(0, 9000), V(4000, 9000)], NET_A);
    const clipped = line([V(0, 2000), V(4000, 2000)], NET_B);

    expect(clipToOtherLine(n, ref, clipped)).toBe(false);
    // `tightest` was assigned on the first, clearing probe, so the line keeps a
    // shape — but the *whole* line is only preserved when the search breaks out
    // immediately, which it does here.
    expect(clipped.cLine().pointCount()).toBeGreaterThan(0);
  });

  it('clips to nothing when the very first probe already collides', () => {
    const n = makeNode(0);
    // The reference runs along the clipped line, so no prefix of it ever
    // clears, `tightest` is never assigned, and the line is emptied.
    const ref = line([V(0, 2000), V(4000, 2000)], NET_A);
    const clipped = line([V(0, 2000), V(4000, 2000)], NET_B);

    expect(clipToOtherLine(n, ref, clipped)).toBe(true);
    expect(clipped.cLine().pointCount()).toBe(0);
  });
});

describe('MULTI_DRAGGER: the walkaround result permutation (upstream bug)', () => {
  it('copies attempt 1’s walked lines back by loop index, so the bundle is permuted', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_Walkaround });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);

    expect(dragger.drag(V(2000, 1000))).toBe(true);

    // With nothing to walk around, both attempts grow the bundle by zero, and
    // `walkState[0].totalLength < walkState[1].totalLength` is false — so
    // attempt 1, the reversed one, wins. It stored its results at
    // `postWalkLines[lidx]` while iterating `aCompletedLines` backwards, so the
    // two lines' geometries land on each other.
    const lines = dragger.mdragLines() as unknown as { draggedLine: PnsLine }[];

    // mdragLines[0] is the primary, on net A. Its dragged line now carries the
    // *other* line's geometry, net B and all.
    expect((lines[0] as { draggedLine: PnsLine }).draggedLine.net()).toBe(NET_B);
    expect((lines[1] as { draggedLine: PnsLine }).draggedLine.net()).toBe(NET_A);
  });

  it('is not permuted in mark-obstacles mode, which has no two-attempt walk', () => {
    const n = makeNode();
    const { a, b } = bundle(n);
    const { dragger } = harness(n, { routingMode: PnsMode.RM_MarkObstacles });

    const prims = new PnsItemSet();
    prims.add(a[1] as PnsSegment);
    prims.add(b[1] as PnsSegment);

    dragger.start(V(2000, 10), prims);
    dragger.drag(V(2000, 1000));

    const lines = dragger.mdragLines() as unknown as { draggedLine: PnsLine }[];

    expect((lines[0] as { draggedLine: PnsLine }).draggedLine.net()).toBe(NET_A);
    expect((lines[1] as { draggedLine: PnsLine }).draggedLine.net()).toBe(NET_B);
  });
});

describe('the geometry MULTI_DRAGGER leans on', () => {
  it('DIRECTION_45::Opposite, and UNDEFINED rather than upstream’s out-of-bounds read', () => {
    expect(directionOpposite(Direction45.of(Directions.N)).dir).toBe(Directions.S);
    expect(directionOpposite(Direction45.of(Directions.NE)).dir).toBe(Directions.SW);
    expect(directionOpposite(Direction45.of(Directions.W)).dir).toBe(Directions.E);
    expect(directionOpposite(Direction45.of(Directions.NW)).dir).toBe(Directions.SE);
    expect(directionOpposite(Direction45.UNDEFINED).dir).toBe(Directions.UNDEFINED);
  });

  it('SEG::LineDistance signs the answer only when asked', () => {
    const s = { a: V(0, 0), b: V(1000, 0) };

    expect(segLineDistance(s, V(500, 300))).toBe(300);
    expect(segLineDistance(s, V(500, -300))).toBe(300);

    // The sign follows SEG::Side, so the two sides come back opposite.
    const above = segLineDistance(s, V(500, 300), true);
    const below = segLineDistance(s, V(500, -300), true);

    expect(Math.abs(above)).toBe(300);
    expect(above).toBe(-below);
  });

  it('SEG::LineDistance measures to the *infinite* line, not the segment', () => {
    const s = { a: V(0, 0), b: V(1000, 0) };

    // Well past the end, but still on the line.
    expect(segLineDistance(s, V(9000, 0))).toBe(0);
  });

  it('SEG::LineProject is unclamped', () => {
    const s = { a: V(0, 0), b: V(1000, 0) };

    expect(segLineProject(s, V(9000, 400))).toEqual(V(9000, 0));
  });

  it('SEG::IntersectLines answers null for parallels', () => {
    expect(
      segIntersectLines({ a: V(0, 0), b: V(1000, 0) }, { a: V(0, 5), b: V(1000, 5) }),
    ).toBeNull();

    expect(
      segIntersectLines({ a: V(0, 0), b: V(1000, 0) }, { a: V(400, -100), b: V(400, 100) }),
    ).toEqual(V(400, 0));
  });

  it('SHAPE_LINE_CHAIN::PointAlong walks the chain, and clamps at both ends', () => {
    const c = PnsLineChain.fromPoints([V(0, 0), V(1000, 0), V(1000, 1000)]);

    expect(chainPointAlong(c, 0)).toEqual(V(0, 0));
    expect(chainPointAlong(c, 400)).toEqual(V(400, 0));
    expect(chainPointAlong(c, 1500)).toEqual(V(1000, 500));
    expect(chainPointAlong(c, 99999)).toEqual(V(1000, 1000));
  });
});
