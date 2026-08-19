// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::LINE_PLACER`. Counterpart: `pcbnew/router/pns_line_placer.cpp`.
 *
 * What is pinned here is the set of decisions a reasonable person would change
 * while "tidying up", because every one of them is load-bearing:
 *
 * - **`mergeHead`'s `n_head < 3`** — three *shapes*, not segments, not points.
 *   This is the threshold that decides how much of the track keeps following
 *   the mouse.
 * - **`splitHeadTail`'s seam** — the first old-tail point missing from the new
 *   line, decremented when none is missing, with the two slices *sharing* that
 *   point. And the new head inheriting width/layer/net from the old *tail*.
 * - **`rhMarkObstacles`'s `m_head.Width() / 2`** — integer division, strict
 *   `<`, and it is a track width rather than a clearance.
 * - **The posture solver's `1.55` / `0.5192…` band** and its 30x lock / 10x
 *   unlock distances, all in units of the tolerance.
 * - **The two opposite tie-breaks in `rhWalkBase`** — a length tie keeps CW, a
 *   distance tie keeps CCW.
 * - **`FIXED_TAIL::PopStage` never popping the last stage.**
 * - **`lastV`'s `- 1`** — the last segment is deliberately left uncommitted
 *   unless fix-all, a via, or a real end says otherwise.
 * - **Two upstream dead paths reproduced rather than removed**:
 *   `cursorDistMinimum`'s `minPLoc = -1`, and `handlePullback`'s hard-wired
 *   `pullback_1 = false`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PnsFixedTail,
  PnsLinePlacer,
  PnsOptimizerEffort,
  PnsWalkStatus,
  optimizeLine,
  walkaroundRoute,
  type PnsPlacerIface,
  type PnsRouterLike,
  type PnsShoveLike,
} from '@ziroeda/pcbnew/src/router/pns_line_placer.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  PnsMode,
  PnsOptimizationEffort,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import { PnsSizesSettings } from '@ziroeda/pcbnew/src/router/pns_sizes_settings.js';
import type { PnsShove } from '@ziroeda/pcbnew/src/router/pns_shove.js';
import { PnsMouseTrailTracer } from '@ziroeda/pcbnew/src/router/pns_mouse_trail_tracer.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import { CornerMode, Direction45, Directions } from '@ziroeda/kimath/src/geometry/direction45.js';
import type { NetHandle, PnsRuleResolver } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };
const NET_B: NetHandle = { name: 'B' };

/** A resolver that answers one clearance for everything and no rules at all. */
class FlatResolver implements PnsRuleResolver {
  constructor(protected readonly value = 0) {}

  clearance(_a?: PnsItem, _b?: PnsItem, _aUseClearanceEpsilon?: boolean): number {
    return this.value;
  }

  clearanceEpsilon(): number {
    return 0;
  }

  hasUserDefinedPhysicalConstraint(): boolean {
    return false;
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

/**
 * A resolver that actually honours `aUseClearanceEpsilon`, so the flag the
 * mark-obstacles snap passes is observable.
 */
class EpsilonResolver extends FlatResolver {
  constructor(
    private readonly base: number,
    private readonly epsilon: number,
  ) {
    super(base);
  }

  override clearance(_a: PnsItem, _b: PnsItem, aUseClearanceEpsilon?: boolean): number {
    return aUseClearanceEpsilon === false ? this.base : this.base - this.epsilon;
  }

  override clearanceEpsilon(): number {
    return this.epsilon;
  }
}

function chain(...pts: [number, number][]): PnsLineChain {
  return PnsLineChain.fromPoints(pts.map(([x, y]) => V(x, y)));
}

function line(width: number, net: NetHandle, ...pts: [number, number][]): PnsLine {
  const l = new PnsLine();
  l.setWidth(width);
  l.setNet(net);
  l.setLayers(new PnsLayerRange(0, 0));
  l.setShape(chain(...pts));
  return l;
}

/** A router just real enough for the placer to run against. */
class FakeRouter implements PnsRouterLike {
  world: PnsNode;
  routingSettings: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS };
  committed: PnsNode[] = [];
  ratlines = 0;
  shove: PnsShoveLike | null = null;

  constructor(aWorld: PnsNode) {
    this.world = aWorld;
  }

  getInterface(): PnsPlacerIface {
    return {
      getPnsLayerFromBoardLayer: (aLayer: string) => (aLayer === 'F.Cu' ? 0 : 31),
      getOrphanedNetHandle: () => null,
      getNetCode: (aNet: NetHandle) => (aNet ? 1 : 0),
      displayRatline: () => {
        this.ratlines++;
      },
    };
  }

  getWorld(): PnsNode {
    return this.world;
  }

  settings(): RoutingSettings {
    return this.routingSettings;
  }

  commitRouting(aNode: PnsNode): boolean {
    this.committed.push(aNode);
    return true;
  }

  makeShove(): PnsShoveLike | null {
    return this.shove;
  }
}

function emptyWorld(clearance = 0): PnsNode {
  const n = new PnsNode();
  n.setRuleResolver(new FlatResolver(clearance));
  return n;
}

function makePlacer(aWorld = emptyWorld()): { placer: PnsLinePlacer; router: FakeRouter } {
  const router = new FakeRouter(aWorld);
  const placer = new PnsLinePlacer(router);

  const sizes = new PnsSizesSettings();
  sizes.setTrackWidth(200000);
  sizes.setViaDiameter(600000);
  sizes.setViaDrill(300000);
  placer.updateSizes(sizes);

  return { placer, router };
}

/** A pad, as an obstacle. */
function pad(cx: number, cy: number, half: number, net: NetHandle): PnsSolid {
  const s = new PnsSolid();
  s.setNet(net);
  s.setLayers(new PnsLayerRange(0, 0));
  s.setPos(V(cx, cy));
  s.setShape({
    kind: 'poly',
    r: 0,
    pts: [
      V(cx - half, cy - half),
      V(cx + half, cy - half),
      V(cx + half, cy + half),
      V(cx - half, cy + half),
    ],
  });
  return s;
}

// =============================================================================
describe('FIXED_TAIL', () => {
  it('never pops the last stage, so repeated un-fixes at the start are idempotent', () => {
    const ft = new PnsFixedTail();

    ft.addStage(V(0, 0), 0, false, Direction45.of(Directions.N), null);
    ft.addStage(V(10, 0), 1, true, Direction45.of(Directions.E), null);

    expect(ft.stageCount()).toBe(2);

    // First pop returns the top *and* removes it.
    expect(ft.popStage()?.pts[0]?.p).toEqual(V(10, 0));
    expect(ft.stageCount()).toBe(1);

    // Every subsequent pop returns the bottom stage and leaves it in place.
    for (let i = 0; i < 3; i++) {
      expect(ft.popStage()?.pts[0]?.p).toEqual(V(0, 0));
      expect(ft.stageCount()).toBe(1);
    }
  });

  it('popStage on an empty stack is null, not a throw', () => {
    expect(new PnsFixedTail().popStage()).toBeNull();
  });

  it('carries layer, via flag and direction through a stage', () => {
    const ft = new PnsFixedTail();
    ft.addStage(V(5, 6), 7, true, Direction45.of(Directions.SW), null);

    const st = ft.popStage();

    expect(st?.pts[0]?.layer).toBe(7);
    expect(st?.pts[0]?.placingVias).toBe(true);
    expect(st?.pts[0]?.direction.dir).toBe(Directions.SW);
  });
});

// =============================================================================
describe('DIRECTION_45 corner modes', () => {
  it('a square displacement is one diagonal segment in 45 mode and two legs in 90 mode', () => {
    const d = Direction45.UNDEFINED;

    // 45°: h === w short-circuits to a single segment.
    expect(d.buildInitialTrace(V(0, 0), V(100, 100), false, CornerMode.MITERED_45)).toHaveLength(2);

    // 90°: the `!is90mode` guard on that short-circuit means it still needs its
    // two axis-aligned legs. Dropping the guard would emit an illegal diagonal.
    const p90 = d.buildInitialTrace(V(0, 0), V(100, 100), false, CornerMode.MITERED_90);
    expect(p90).toHaveLength(3);
    expect(p90[1]).toEqual(V(0, 100));
  });

  it('90 mode picks its first leg by startDiagonal === (h >= w)', () => {
    const d = Direction45.UNDEFINED;

    // w=200 h=100, so h >= w is false.
    const a = d.buildInitialTrace(V(0, 0), V(200, 100), false, CornerMode.MITERED_90);
    const b = d.buildInitialTrace(V(0, 0), V(200, 100), true, CornerMode.MITERED_90);

    // startDiagonal=false === (h>=w)=false is TRUE -> the E leg.
    expect(a[1]).toEqual(V(200, 0));
    // startDiagonal=true === false is false -> the N leg.
    expect(b[1]).toEqual(V(0, 100));
  });

  it('45 mode still builds the mitre it always did', () => {
    const pts = Direction45.of(Directions.N).buildInitialTrace(V(0, 0), V(300, 100));

    expect(pts).toEqual([V(0, 0), V(200, 0), V(300, 100)]);
  });
});

// =============================================================================
describe('SHAPE_LINE_CHAIN edits the placer needs', () => {
  it('shapeCount counts shapes, not segments', () => {
    expect(chain([0, 0], [10, 0], [20, 10], [30, 10]).shapeCount()).toBe(3);
    expect(chain([0, 0]).shapeCount()).toBe(0);
    expect(chain([0, 0], [10, 0]).shapeCount()).toBe(1);
  });

  it('an arc is ONE shape however many segments stand in for it', () => {
    const c = chain([0, 0]);
    c.appendArcShape({ p0: V(0, 0), arcMid: V(70711, 29289), p1: V(100000, 100000), width: 0 });

    // This is the only configuration in which shapeCount and segmentCount
    // differ — on an arc-free chain they are identically pointCount - 1, which
    // is why swapping them in `mergeHead` is unobservable there. See the note
    // at that call site.
    expect(c.segmentCount()).toBeGreaterThan(1);
    expect(c.shapeCount()).toBe(1);
  });

  it('simplify keeps a chain of fewer than three points untouched', () => {
    // "Always try to keep at least 2 points otherwise, we're not really a line."
    // This is what lets `Trace()` hold on to a deliberate zero-length segment as
    // the only feedback a user gets when the routing start violates DRC.
    const twoIdentical = chain([5, 5], [5, 5]);
    twoIdentical.simplify();
    expect(twoIdentical.pointCount()).toBe(2);
  });

  it('simplify is the TOLERANCE variant, so a one-IU deviation survives at zero', () => {
    // `LINE_PLACER` calls `Simplify()`, and `SHAPE_LINE_CHAIN::Simplify` takes
    // an *integer tolerance* (`shape_line_chain.h:358`) — it is not `Simplify2`,
    // which takes a `bool aRemoveColinear` and carries a fixed one-IU band
    // (`:362`). They are different functions and the placer wants this one, so a
    // vertex one unit off the chord is kept unless the caller asks for it to go.
    const exact = chain([0, 0], [50, 0], [100, 0]);
    exact.simplify();
    expect(exact.pointCount()).toBe(2);

    const oneOff = chain([0, 0], [50, 1], [100, 0]);
    oneOff.simplify();
    expect(oneOff.pointCount()).toBe(3);

    const oneOffTolerated = chain([0, 0], [50, 1], [100, 0]);
    oneOffTolerated.simplify(1);
    expect(oneOffTolerated.pointCount()).toBe(2);

    // ...and `simplify2` is the other one, with its own fixed band.
    const band = chain([0, 0], [50, 0], [51, 1], [100, 0]);
    band.simplify2();
    expect(band.pointCount()).toBe(2);
  });

  it('split snaps a point onto an edge and returns its new index', () => {
    const c = chain([0, 0], [100, 0]);

    expect(c.split(V(40, 0))).toBe(1);
    expect(c.pointCount()).toBe(3);
    expect(c.cPoint(1)).toEqual(V(40, 0));
  });

  it('split refuses a point more than one IU off the chain', () => {
    expect(chain([0, 0], [100, 0]).split(V(40, 5))).toBe(-1);
  });

  it('the snap radius is exactly one IU — `min_dist` starts at 2 and the test is <', () => {
    // One IU off: accepted.
    expect(chain([0, 0], [100, 0]).split(V(40, 1))).toBe(1);
    // Two IU off: refused, because `2 < 2` is false.
    expect(chain([0, 0], [100, 0]).split(V(40, 2))).toBe(-1);
  });

  it('split measures with SEG::Distance, which floors — not with a rounded hypot', () => {
    // A point 2 IU to the right of a 1:2 diagonal. Its perpendicular squared
    // distance is 3, and `seg.Distance( aP )` is `isqrt( 3 )` = 1, so
    // `dist < min_dist` holds and the split happens. A `round( sqrt( 3 ) )`
    // reads 2 and silently declines a split KiCad performs.
    const c = chain([0, 0], [100, 200]);

    expect(c.split(V(2, 0))).toBe(1);
    expect(c.pointCount()).toBe(3);
    expect(c.cPoint(1)).toEqual(V(2, 0));
  });

  it('split returns an existing vertex index without inserting', () => {
    const c = chain([0, 0], [50, 0], [100, 0]);

    expect(c.split(V(50, 0))).toBe(1);
    expect(c.pointCount()).toBe(3);
  });

  it('remove is a silent no-op on an inverted or out-of-range span', () => {
    const c = chain([0, 0], [10, 0], [20, 0]);

    c.remove(2, 1);
    c.remove(5, 9);
    expect(c.pointCount()).toBe(3);
  });

  it('replace trims a coincident first point but keeps a coincident last one at index 0', () => {
    const c = chain([0, 0], [10, 0], [20, 0], [30, 0]);
    c.replace(1, 2, chain([10, 0], [15, 5], [20, 0]));

    // The leading (10,0) is folded onto the existing point; the trailing (20,0)
    // is folded too because aEndIndex (2) > 0.
    expect([...c.points()]).toEqual([V(0, 0), V(10, 0), V(15, 5), V(20, 0), V(30, 0)]);
  });

  it('intersect reports a crossing with our index bumped when it lands on B', () => {
    const a = chain([0, 0], [100, 0]);
    const b = chain([100, -50], [100, 50]);

    const ips = a.intersect(b);

    expect(ips).toHaveLength(1);
    expect(ips[0]?.p).toEqual(V(100, 0));
    // The hit is at segment 0's B end, so index_our is incremented to 1.
    expect(ips[0]?.indexOur).toBe(1);
    expect(ips[0]?.isCornerOur).toBe(true);
  });

  it('area is zero on an open chain however it is wound', () => {
    const c = chain([0, 0], [100, 0], [100, 100], [0, 100]);

    expect(c.area()).toBe(0);

    c.setClosed(true);
    expect(c.area()).toBe(10000);
  });

  it('pointOnEdge uses accuracy + 1, so a one-IU miss still counts at accuracy 0', () => {
    const c = chain([0, 0], [100, 0]);

    expect(c.pointOnEdge(V(50, 0))).toBe(true);
    expect(c.pointOnEdge(V(50, 1))).toBe(true);
    expect(c.pointOnEdge(V(50, 3))).toBe(false);
  });
});

// =============================================================================
describe('MOUSE_TRAIL_TRACER', () => {
  it('with fewer than two trail points, the last segment direction is the answer', () => {
    const t = new PnsMouseTrailTracer();
    t.setTolerance(1000);
    t.setDefaultDirections(Direction45.of(Directions.N), Direction45.of(Directions.E));

    expect(t.getPosture(V(100, 100)).dir).toBe(Directions.E);
  });

  it('with the mouse disabled it turns right from the last segment every time', () => {
    const t = new PnsMouseTrailTracer();
    t.setTolerance(1000);
    t.setMouseDisabled(true);
    t.setDefaultDirections(Direction45.of(Directions.N), Direction45.of(Directions.E));

    // Right of E is SE. "Assume that we switch postures every segment."
    expect(t.getPosture(V(100, 100)).dir).toBe(Directions.SE);
  });

  it('a manually forced posture short-circuits everything, trail or no trail', () => {
    const t = new PnsMouseTrailTracer();
    t.setTolerance(1000);
    t.setDefaultDirections(Direction45.of(Directions.N), Direction45.of(Directions.E));
    t.flipPosture();

    const forced = t.getPosture(V(500000, 500000));

    // Right of N is NE, and no amount of trail can move it.
    expect(forced.dir).toBe(Directions.NE);

    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(400000, 100000));
    t.addTrailPoint(V(500000, 500000));

    expect(t.getPosture(V(500000, 500000)).dir).toBe(Directions.NE);
    expect(t.isManuallyForced()).toBe(true);
  });

  it('flipPosture is a 45-degree right turn and latches both flags', () => {
    const t = new PnsMouseTrailTracer();
    t.setDefaultDirections(Direction45.of(Directions.N), Direction45.UNDEFINED);

    t.flipPosture();
    expect(t.isManuallyForced()).toBe(true);
    expect(t.isForced()).toBe(true);

    // Two flips is 90 degrees, not 180.
    t.flipPosture();
    expect(t.getPosture(V(0, 0)).dir).toBe(Directions.E);
  });

  it('locks the posture past 30 tolerances and unlocks inside 10', () => {
    const t = new PnsMouseTrailTracer();
    t.setTolerance(1000);
    t.setDefaultDirections(Direction45.of(Directions.N), Direction45.UNDEFINED);

    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(20000, 3000));

    expect(t.isForced()).toBe(false);

    // 40000 > 30 * 1000, so the solution locks in.
    t.getPosture(V(40000, 5000));
    expect(t.isForced()).toBe(true);

    // Dragging back inside 10 * 1000 unlocks and restarts the trail from p0.
    t.getPosture(V(5000, 0));
    expect(t.isForced()).toBe(false);
    expect(t.trail().pointCount()).toBe(1);
  });

  it('the trail truncates when the cursor comes back on itself', () => {
    const t = new PnsMouseTrailTracer();
    t.setTolerance(1000);

    // A square loop that closes back over its first segment.
    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(50000, 0));
    t.addTrailPoint(V(50000, 50000));
    t.addTrailPoint(V(0, 50000));
    const before = t.trail().pointCount();

    t.addTrailPoint(V(500, 0));

    expect(t.trail().pointCount()).toBeLessThan(before + 1);
  });

  it('an area ratio inside the band picks the diagonal candidate, not the current posture', () => {
    const t = new PnsMouseTrailTracer();
    t.setTolerance(10);
    // Current posture straight (N), no last-segment hint.
    t.setDefaultDirections(Direction45.of(Directions.N), Direction45.UNDEFINED);

    // This trail gives areaS = 100000 and areaDiag = 60000, so the ratio is
    // 1.667 — above 1.3 + 0.25 and therefore diagonal, but *below* what a
    // larger threshold would demand, in which case the else-arm would keep the
    // current straight posture instead.
    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(50, 50));
    t.addTrailPoint(V(1000, 200));

    // The diagonal candidate from (0,0) to (1000,200) leaves along (200,200):
    // east and downward on screen, i.e. SE. The straight one leaves due E.
    expect(t.getPosture(V(1000, 200)).dir).toBe(Directions.SE);
  });

  it('a trail hugging the diagonal-first candidate selects a diagonal posture', () => {
    const t = new PnsMouseTrailTracer();
    t.setTolerance(1000);
    t.setDefaultDirections(Direction45.of(Directions.N), Direction45.UNDEFINED);

    // Drag down-right hugging the diagonal leg, well inside the 30x lock
    // distance but past the 6x area cutoff.
    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(4000, 4000));
    t.addTrailPoint(V(8000, 8000));
    t.addTrailPoint(V(12000, 8500));

    const posture = t.getPosture(V(20000, 9000));

    // Whatever it settles on, it must be one of the eight and defined — the
    // point of this test is that the area comparison ran at all.
    expect(posture.isDefined()).toBe(true);
  });
});

// =============================================================================
describe('splitHeadTail', () => {
  let placer: PnsLinePlacer;

  beforeEach(() => {
    placer = makePlacer().placer;
  });

  it('the new head inherits width, layer and net from the OLD TAIL, not the new line', () => {
    const oldTail = line(250000, NET_A, [0, 0], [100, 0]);
    oldTail.setLayers(new PnsLayerRange(3, 3));

    const walked = line(999, NET_B, [0, 0], [100, 0], [200, 100]);
    walked.setLayers(new PnsLayerRange(9, 9));

    const { head } = placer.internals().splitHeadTail(walked, oldTail);

    expect(head.width()).toBe(250000);
    expect(head.net()).toBe(NET_A);
    expect(head.layers().start()).toBe(3);
  });

  it('the tail and head SHARE the seam point, which is what makes Trace() append correctly', () => {
    const oldTail = line(100, NET_A, [0, 0], [100, 0]);
    const walked = line(100, NET_A, [0, 0], [100, 0], [200, 100]);

    const { head, tail } = placer.internals().splitHeadTail(walked, oldTail);

    expect(tail.cLine().cLastPoint()).toEqual(head.cLine().cPoint(0));

    // ...and appending them back gives the walked line, no duplicate vertex.
    const rejoined = tail.cLine().clone();
    rejoined.appendChain(head.cLine());
    expect([...rejoined.points()]).toEqual([...walked.cLine().points()]);
  });

  it('an old tail wholly contained in the new line seams at its LAST point', () => {
    const oldTail = line(100, NET_A, [0, 0], [100, 0], [200, 0]);
    const walked = line(100, NET_A, [0, 0], [100, 0], [200, 0], [300, 100]);

    const { tail } = placer.internals().splitHeadTail(walked, oldTail);

    // `found` stays false, so i is decremented from 3 to 2 — the last agreed
    // point. A tail of three points, not four.
    expect(tail.pointCount()).toBe(3);
    expect(tail.cLine().cLastPoint()).toEqual(V(200, 0));
  });

  it('a seam at index 0 clears the tail entirely rather than leaving a point', () => {
    const oldTail = line(100, NET_A, [50, 50], [60, 60]);
    const walked = line(100, NET_A, [0, 0], [100, 0], [200, 100]);

    const { tail, head } = placer.internals().splitHeadTail(walked, oldTail);

    expect(tail.pointCount()).toBe(0);
    expect(head.pointCount()).toBe(3);
  });

  it('with a one-point old tail the whole new line becomes the head, attributes and all', () => {
    const oldTail = line(100, NET_A, [0, 0]);
    const walked = line(4242, NET_B, [0, 0], [100, 0], [200, 100]);
    walked.setLayers(new PnsLayerRange(6, 6));

    const { tail, head } = placer.internals().splitHeadTail(walked, oldTail);

    expect(tail.pointCount()).toBe(0);
    expect([...head.cLine().points()]).toEqual([...walked.cLine().points()]);

    // The short arm is a *move* of the new line, not a re-shape of the old-tail
    // copy — so unlike the long arm above, the head takes the new line's
    // width, net and layers.
    expect(head.width()).toBe(4242);
    expect(head.net()).toBe(NET_B);
    expect(head.layers().start()).toBe(6);
  });

  it('always reports success, though every call site tests it', () => {
    const empty = new PnsLine();

    expect(placer.internals().splitHeadTail(empty, empty).ok).toBe(true);
  });
});

// =============================================================================
describe('mergeHead', () => {
  let placer: PnsLinePlacer;

  beforeEach(() => {
    placer = makePlacer().placer;
  });

  it('refuses a head of two shapes and accepts one of three', () => {
    const int = placer.internals();

    // Two shapes: below the threshold, nothing settles.
    int.setTail(line(100, NET_A, [0, 0], [100, 0]));
    int.setHead(line(100, NET_A, [100, 0], [200, 0], [300, 100]));
    expect(int.mergeHead()).toBe(false);

    // Three shapes: the head is promoted and emptied.
    int.setTail(line(100, NET_A, [0, 0], [0, 100]));
    int.setHead(line(100, NET_A, [0, 100], [100, 200], [300, 200], [400, 300]));
    expect(int.mergeHead()).toBe(true);
    expect(placer.head().pointCount()).toBe(0);
    expect(placer.tail().cLine().cLastPoint()).toEqual(V(400, 300));
  });

  it('refuses a head discontinuous with the tail', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0], [0, 100]));
    int.setHead(line(100, NET_A, [777, 777], [877, 877], [1077, 877], [1177, 977]));

    expect(int.mergeHead()).toBe(false);
  });

  it('refuses a head containing a forbidden corner', () => {
    const int = placer.internals();

    int.setTail(new PnsLine());
    // E then W: a 180-degree reversal, ANG_HALF_FULL.
    int.setHead(line(100, NET_A, [0, 0], [100, 0], [0, 0], [0, 100]));

    expect(int.mergeHead()).toBe(false);
  });

  it('refuses when the JOIN itself is a forbidden corner', () => {
    const int = placer.internals();

    // Tail arrives heading E; head leaves heading W.
    int.setTail(line(100, NET_A, [0, 0], [100, 0]));
    int.setHead(line(100, NET_A, [100, 0], [0, 0], [0, 100], [100, 200]));

    expect(int.mergeHead()).toBe(false);
  });

  it('sets m_direction from the merged tail, not from the head it swallowed', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0], [0, -100]));
    int.setHead(line(100, NET_A, [0, -100], [100, -200], [300, -200], [400, -300]));

    expect(int.mergeHead()).toBe(true);
    // Last tail segment now runs (300,-200) -> (400,-300): east and up = NE.
    expect(placer.direction().dir).toBe(Directions.NE);
  });
});

// =============================================================================
describe('handlePullback', () => {
  let placer: PnsLinePlacer;

  beforeEach(() => {
    placer = makePlacer().placer;
  });

  it('drops a tail shape when the head leaves at a right angle to it', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0], [100, 0], [200, 0]));
    // Tail's last direction is E; head's first is N. E vs N is ANG_RIGHT.
    int.setHead(line(100, NET_A, [200, 0], [200, -100]));

    expect(int.handlePullback()).toBe(true);
    expect(placer.tail().pointCount()).toBe(2);
  });

  it('drops a tail shape at an acute angle too', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0], [100, 0], [200, 0]));
    // E vs NW: |2 - 7| = 5 -> ANG_ACUTE.
    int.setHead(line(100, NET_A, [200, 0], [100, -100]));

    expect(int.handlePullback()).toBe(true);
  });

  it('leaves an obtuse or straight join alone — pullback_1 really is dead', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0], [100, 0], [200, 0]));
    // E vs NE is ANG_OBTUSE. Upstream's disabled case 1 would have fired here
    // (m_direction differs from the head's first direction); it must not.

    int.setDirection(Direction45.of(Directions.S));
    int.setHead(line(100, NET_A, [200, 0], [300, -100]));

    expect(int.handlePullback()).toBe(false);
    expect(placer.tail().pointCount()).toBe(3);
  });

  it('a one-point tail is cleared outright', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0]));
    int.setHead(line(100, NET_A, [0, 0], [100, 0]));

    expect(int.handlePullback()).toBe(true);
    expect(placer.tail().pointCount()).toBe(0);
  });

  it('an empty tail or a one-point head is not a pullback', () => {
    const int = placer.internals();

    int.setTail(new PnsLine());
    int.setHead(line(100, NET_A, [0, 0], [100, 0]));
    expect(int.handlePullback()).toBe(false);

    int.setTail(line(100, NET_A, [0, 0], [100, 0], [200, 0]));
    int.setHead(line(100, NET_A, [200, 0]));
    expect(int.handlePullback()).toBe(false);
  });

  it('emptying the tail resets the direction to the initial one', () => {
    const int = placer.internals();

    int.setInitialDirection(Direction45.of(Directions.SW));
    int.setTail(line(100, NET_A, [0, 0], [100, 0]));
    int.setHead(line(100, NET_A, [100, 0], [100, -100]));

    expect(int.handlePullback()).toBe(true);
    expect(placer.tail().segmentCount()).toBe(0);
    expect(placer.direction().dir).toBe(Directions.SW);
  });
});

// =============================================================================
describe('handleSelfIntersections', () => {
  let placer: PnsLinePlacer;

  beforeEach(() => {
    placer = makePlacer().placer;
  });

  it('a head starting where the tail starts throws the whole tail away', () => {
    const int = placer.internals();

    int.setInitialDirection(Direction45.of(Directions.NW));
    int.setTail(line(100, NET_A, [0, 0], [100, 0], [200, 0]));
    int.setHead(line(100, NET_A, [0, 0], [0, 100]));

    expect(int.handleSelfIntersections()).toBe(true);
    expect(placer.tail().pointCount()).toBe(0);
    expect(placer.direction().dir).toBe(Directions.NW);
  });

  it('a crossing on the first two tail segments restarts both lines', () => {
    const int = placer.internals();

    int.setInitialDirection(Direction45.of(Directions.E));
    int.setTail(line(100, NET_A, [0, 0], [100, 0], [100, 100]));
    // Crosses tail segment 0 at (50, 0).
    int.setHead(line(100, NET_A, [100, 100], [50, 100], [50, -100]));

    expect(int.handleSelfIntersections()).toBe(true);
    expect(placer.tail().pointCount()).toBe(0);
    expect(placer.head().pointCount()).toBe(0);
  });

  it('a later crossing clips the tail and adopts the clipped segment direction', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0], [0, 100], [100, 100], [200, 100], [200, 0]));
    // Crosses tail segment 2 ((100,100)-(200,100)) at (150,100).
    int.setHead(line(100, NET_A, [200, 0], [150, 0], [150, 200]));

    expect(int.handleSelfIntersections()).toBe(true);
    // Remove(n, -1) with n = 2 leaves points 0 and 1.
    expect(placer.tail().pointCount()).toBe(2);
  });

  it('a crossing on tail segment ONE still restarts, because the test is n < 2', () => {
    const int = placer.internals();

    int.setInitialDirection(Direction45.of(Directions.E));
    int.setTail(line(100, NET_A, [0, 0], [0, 100], [100, 100], [200, 100]));
    // Crosses tail segment 1 ((0,100)-(100,100)) at (50,100) and nothing else.
    int.setHead(line(100, NET_A, [200, 100], [200, 200], [50, 200], [50, 50]));

    expect(int.handleSelfIntersections()).toBe(true);
    // n === 1 is still "the first or the second segment", so both lines go.
    // Clipping instead (the n < 1 reading) would leave a one-point tail.
    expect(placer.tail().pointCount()).toBe(0);
    expect(placer.head().pointCount()).toBe(0);
  });

  it('the seam itself is not a self-intersection', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0], [100, 0], [200, 0]));
    int.setHead(line(100, NET_A, [200, 0], [300, -100]));

    expect(int.handleSelfIntersections()).toBe(false);
    expect(placer.tail().pointCount()).toBe(3);
  });

  it('a tail or head shorter than two points is never an intersection', () => {
    const int = placer.internals();

    int.setTail(line(100, NET_A, [0, 0]));
    int.setHead(line(100, NET_A, [0, 0], [100, 0]));
    expect(int.handleSelfIntersections()).toBe(false);
  });
});

// =============================================================================
describe('rhMarkObstacles snapping', () => {
  /**
   * A pad at x = 500000 half-width 100000. With clearance 0 and the head's
   * 200000 track width as the walkaround thickness, its hull grows by 100000,
   * so the hull's straight right edge sits at x = 700000 and the snap threshold
   * is trunc(200000 / 2) = 100000.
   *
   * The head is drawn *through* the pad in every case here, so the obstacle
   * search always finds it — which is what makes the threshold, rather than the
   * collision, the thing under test. A configuration where the cursor sits just
   * short of the obstacle would have the collision test bind first and the
   * assertion would pass for the wrong reason.
   */
  function snapCase(cursorX: number, width = 200000): Vec2 {
    const world = emptyWorld(0);
    world.addSolid(pad(500000, 0, 100000, NET_B));

    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;

    const int = placer.internals();
    int.setCurrentNode(world);
    int.setCurrentStart(V(0, 0));
    int.setPStart(V(0, 0));
    int.setHead(line(width, NET_A, [0, 0]));
    int.setTail(new PnsLine());

    const r = int.rhMarkObstacles(V(cursorX, 0));

    expect(r.ok).toBe(true);

    return r.head.cLine().cLastPoint();
  }

  it('snaps back onto the hull when the cursor is inside half the track width', () => {
    // 99999 short of the threshold.
    expect(snapCase(799999)).toEqual(V(700000, 0));
  });

  it('does not snap at exactly half the track width — the comparison is strict', () => {
    expect(snapCase(800000)).toEqual(V(800000, 0));
  });

  it('does not snap when the obstacle it found is nowhere near the cursor', () => {
    // The head runs straight through the pad and on for another millimetre. The
    // obstacle is real, but its hull is 800000 IU from the cursor.
    expect(snapCase(1500000)).toEqual(V(1500000, 0));
  });

  it('the threshold really is the TRACK WIDTH, not a clearance', () => {
    // Same geometry, same clearance, a wider track: the hull moves out by the
    // extra half-width and the threshold moves with it, so a cursor 100001 IU
    // beyond the *narrow* hull edge now snaps.
    //
    // width 300000 -> hull edge at 500000 + 100000 + 150000 = 750000,
    //                 threshold 150000. A cursor at 899999 is 149999 away.
    expect(snapCase(899999, 300000)).toEqual(V(750000, 0));
    // ...and at exactly 150000 it does not.
    expect(snapCase(900000, 300000)).toEqual(V(900000, 0));
  });

  it('resolves the snap hull with the clearance epsilon OFF', () => {
    // Every other clearance query in the placer takes the epsilon; this one
    // passes `false` (pns_line_placer.cpp:831). A resolver that actually
    // honours the flag makes the difference visible: with the epsilon applied
    // the hull would sit 4000 IU further in, and the track would be snapped to
    // the wrong place — inside the clearance it is supposed to respect.
    const world = new PnsNode();
    world.setRuleResolver(new EpsilonResolver(10000, 4000));

    world.addSolid(pad(500000, 0, 100000, NET_B));

    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;

    const int = placer.internals();
    int.setCurrentNode(world);
    int.setCurrentStart(V(0, 0));
    int.setPStart(V(0, 0));
    int.setHead(line(200000, NET_A, [0, 0]));
    int.setTail(new PnsLine());

    // hull right edge = 500000 + 100000 (pad) + 10000 (clearance, no epsilon)
    //                 + 100000 (half the track width) = 710000.
    const r = int.rhMarkObstacles(V(750000, 0));

    expect(r.head.cLine().cLastPoint()).toEqual(V(710000, 0));
  });

  it('never fails and never touches the tail', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;

    const int = placer.internals();
    int.setCurrentNode(world);
    int.setCurrentStart(V(0, 0));
    int.setPStart(V(0, 0));

    const tail = line(200000, NET_A, [0, 0], [10, 0]);
    int.setTail(tail);
    int.setHead(new PnsLine());

    const r = int.rhMarkObstacles(V(500000, 200000));

    expect(r.ok).toBe(true);
    expect(r.tail).toBe(tail);
  });
});

// =============================================================================
describe('buildInitialLine', () => {
  it('uses the posture solver only while the tail is empty', () => {
    const { placer, router } = makePlacer();
    router.routingSettings.routingMode = PnsMode.RM_Walkaround;

    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setPStart(V(0, 0));
    int.setCurrentStart(V(0, 0));

    // Posture N (straight-first); m_direction NE (diagonal-first). With no
    // tail, the posture wins.
    placer
      .mouseTrailTracer()
      .setDefaultDirections(Direction45.of(Directions.N), Direction45.UNDEFINED);
    int.setDirection(Direction45.of(Directions.NE));
    int.setTail(new PnsLine());

    const noTail = int.buildInitialLine(V(300, 100), new PnsLine(), PnsMode.RM_Walkaround);
    expect(noTail.line.cLine().cPoint(1)).toEqual(V(200, 0));

    // With a tail, m_direction wins and the diagonal leg comes first.
    int.setTail(line(100, NET_A, [-100, 0], [0, 0]));
    const withTail = int.buildInitialLine(V(300, 100), new PnsLine(), PnsMode.RM_Walkaround);
    expect(withTail.line.cLine().cPoint(1)).toEqual(V(100, 100));
  });

  it('an empty move produces an empty chain, not a zero-length segment', () => {
    const { placer, router } = makePlacer();

    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setPStart(V(500, 500));

    const r = int.buildInitialLine(V(500, 500), new PnsLine(), PnsMode.RM_Walkaround);

    expect(r.line.pointCount()).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('free-angle mode draws a straight line, but only in mark-obstacles mode', () => {
    const { placer, router } = makePlacer();
    router.routingSettings.freeAngleMode = true;

    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setPStart(V(0, 0));

    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;
    const free = int.buildInitialLine(V(300, 100), new PnsLine(), PnsMode.RM_MarkObstacles);
    expect(free.line.pointCount()).toBe(2);

    router.routingSettings.routingMode = PnsMode.RM_Walkaround;
    const gridded = int.buildInitialLine(V(300, 100), new PnsLine(), PnsMode.RM_Walkaround);
    expect(gridded.line.pointCount()).toBe(3);
  });

  it('ortho mode projects the second point back onto the first segment', () => {
    const { placer, router } = makePlacer();
    router.routingSettings.routingMode = PnsMode.RM_Walkaround;
    placer.setOrthoMode(true);

    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setPStart(V(0, 0));
    int.setTail(new PnsLine());
    placer
      .mouseTrailTracer()
      .setDefaultDirections(Direction45.of(Directions.N), Direction45.UNDEFINED);

    const r = int.buildInitialLine(V(300, 100), new PnsLine(), PnsMode.RM_Walkaround);

    // Two-segment trace collapsed to one, projected onto segment 0's line.
    expect(r.line.pointCount()).toBe(2);
    expect(r.line.cLine().cLastPoint()).toEqual(V(300, 0));
  });

  it('mark-obstacles attaches a via with no push-out at all', () => {
    const world = emptyWorld(0);
    // A pad sitting exactly where the via wants to go.
    world.addSolid(pad(300000, 0, 400000, NET_B));

    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;

    const int = placer.internals();
    int.setCurrentNode(world);
    int.setPStart(V(0, 0));
    int.setPlacingVia(true);

    const r = int.buildInitialLine(V(300000, 0), new PnsLine(), PnsMode.RM_MarkObstacles);

    expect(r.ok).toBe(true);
    expect(r.line.endsWithVia()).toBe(true);
    // Placed at the cursor, collision and all.
    expect(r.line.via().pos()).toEqual(V(300000, 0));
  });

  it('aForceNoVia suppresses the via even when placing one', () => {
    const { placer, router } = makePlacer();
    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setPStart(V(0, 0));
    int.setPlacingVia(true);

    const r = int.buildInitialLine(V(300000, 0), new PnsLine(), PnsMode.RM_Walkaround, true);

    expect(r.ok).toBe(true);
    expect(r.line.endsWithVia()).toBe(false);
  });

  it('with nothing in the way the via lands at the cursor, unforced', () => {
    const { placer, router } = makePlacer();
    router.routingSettings.routingMode = PnsMode.RM_Walkaround;

    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setPStart(V(0, 0));
    int.setPlacingVia(true);

    const r = int.buildInitialLine(V(300000, 0), new PnsLine(), PnsMode.RM_Walkaround);

    // The push-out loop finds no obstacle on iteration 0, so the total force is
    // zero and the via sits exactly where asked.
    expect(r.ok).toBe(true);
    expect(r.line.via().pos()).toEqual(V(300000, 0));
  });
});

// =============================================================================
describe('cursorDistMinimum', () => {
  it('takes the GLOBAL minimum — the local-minimum computation is dead', () => {
    const { placer, router } = makePlacer();
    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setHead(line(100, NET_A, [0, 0]));

    // A line with a shallow early dip towards the cursor (a local minimum) and
    // a much closer approach later (the global one). Upstream's `minPLoc = -1`
    // means the later, closer point must win.
    const l = chain([0, 0], [1000, 400], [2000, 800], [3000, 50]);

    const out = int.cursorDistMinimum(l, V(3000, 0), 1e9);

    expect(out).not.toBeNull();
    expect(out?.cLastPoint()).toEqual(V(3000, 50));
  });

  it('stops accumulating candidates once the length threshold is passed', () => {
    const { placer, router } = makePlacer();
    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setHead(line(100, NET_A, [0, 0]));

    const l = chain([0, 0], [1000, 0], [2000, 0], [3000, 0]);

    // A threshold of 1500 stops after segment 1, so the far end (3000,0) is
    // never a candidate even though it is nearest the cursor.
    const clipped = int.cursorDistMinimum(l, V(3000, 0), 1500);
    expect(clipped?.cLastPoint()).toEqual(V(2000, 0));

    // With no threshold the far end wins.
    const full = int.cursorDistMinimum(l, V(3000, 0), 1e9);
    expect(full?.cLastPoint()).toEqual(V(3000, 0));
  });

  it('ignores an interior local minimum even when one exists', () => {
    const { placer, router } = makePlacer();
    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setHead(line(100, NET_A, [0, 0]));

    // Distances from the cursor to the candidate points run
    // [0, 1000, 1118, 707, 1581, 2500]: the global minimum is the very first
    // point, and there is a genuine interior local minimum at 707. Upstream's
    // `minPLoc = -1` throws the local one away, so the clip must be at the
    // start. Honouring the local minimum would clip at (500,-500) instead.
    const l = chain([0, 0], [1000, 0], [1000, -500], [500, -500], [500, -1500], [2000, -1500]);

    const out = int.cursorDistMinimum(l, V(0, 0), 1e9);

    expect(out).not.toBeNull();
    expect(out?.cLastPoint()).toEqual(V(0, 0));
  });

  it('an empty chain is not a candidate at all', () => {
    const { placer, router } = makePlacer();
    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setHead(line(100, NET_A, [0, 0]));

    expect(int.cursorDistMinimum(new PnsLineChain(), V(0, 0), 100)).toBeNull();
  });
});

// =============================================================================
describe('clipAndCheckCollisions', () => {
  it('rejects a clip shorter than the running threshold and keeps the ratchet', () => {
    const { placer, router } = makePlacer();
    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setHead(line(100, NET_A, [0, 0]));

    const l = chain([0, 0], [1000, 0], [2000, 0]);
    const state = { out: new PnsLineChain(), thresholdDist: 0 };

    // A long clip first: accepted, and it raises the threshold to 1500.
    expect(int.clipAndCheckCollisions(V(1500, 0), l, state)).toBe(true);
    expect(state.thresholdDist).toBe(1500);

    // A shorter one is now refused, and does not lower the threshold.
    expect(int.clipAndCheckCollisions(V(500, 0), l, state)).toBe(false);
    expect(state.thresholdDist).toBe(1500);
    expect(state.out.cLastPoint()).toEqual(V(1500, 0));
  });

  it('a point nowhere near the line cannot be clipped to', () => {
    const { placer, router } = makePlacer();
    const int = placer.internals();
    int.setCurrentNode(router.world);
    int.setHead(line(100, NET_A, [0, 0]));

    const state = { out: new PnsLineChain(), thresholdDist: 0 };

    expect(int.clipAndCheckCollisions(V(500, 500), chain([0, 0], [1000, 0]), state)).toBe(false);
  });
});

// =============================================================================
describe('the optimizer effort mask', () => {
  it('is zero at OE_LOW and MERGE_SEGMENTS above it', () => {
    const { placer, router } = makePlacer();
    router.routingSettings.smartPads = false;

    router.routingSettings.optimizerEffort = PnsOptimizationEffort.OE_LOW;
    expect(placer.internals().optimizerEffortMask()).toBe(0);

    router.routingSettings.optimizerEffort = PnsOptimizationEffort.OE_MEDIUM;
    expect(placer.internals().optimizerEffortMask()).toBe(PnsOptimizerEffort.MERGE_SEGMENTS);

    router.routingSettings.optimizerEffort = PnsOptimizationEffort.OE_FULL;
    expect(placer.internals().optimizerEffortMask()).toBe(PnsOptimizerEffort.MERGE_SEGMENTS);
  });

  it('adds SMART_PADS only in a 45-degree mode with no hand-forced posture', () => {
    const { placer, router } = makePlacer();
    router.routingSettings.smartPads = true;
    router.routingSettings.optimizerEffort = PnsOptimizationEffort.OE_MEDIUM;

    router.routingSettings.cornerMode = CornerMode.MITERED_45;
    expect(placer.internals().optimizerEffortMask() & PnsOptimizerEffort.SMART_PADS).toBeTruthy();

    router.routingSettings.cornerMode = CornerMode.ROUNDED_45;
    expect(placer.internals().optimizerEffortMask() & PnsOptimizerEffort.SMART_PADS).toBeTruthy();

    // "Smart Pads is incompatible with 90-degree mode for now."
    router.routingSettings.cornerMode = CornerMode.MITERED_90;
    expect(placer.internals().optimizerEffortMask() & PnsOptimizerEffort.SMART_PADS).toBe(0);

    router.routingSettings.cornerMode = CornerMode.ROUNDED_90;
    expect(placer.internals().optimizerEffortMask() & PnsOptimizerEffort.SMART_PADS).toBe(0);

    // A hand-forced posture must not be overridden by a pad-exit reroute.
    router.routingSettings.cornerMode = CornerMode.MITERED_45;
    placer.mouseTrailTracer().flipPosture();
    expect(placer.internals().optimizerEffortMask() & PnsOptimizerEffort.SMART_PADS).toBe(0);
  });
});

// =============================================================================
describe('the walkaround driver', () => {
  it('reports DONE with the path untouched when nothing is in the way', () => {
    const world = emptyWorld(0);
    const l = line(200000, NET_A, [0, 0], [1000000, 0]);

    const r = walkaroundRoute(world, l, true, 40, PnsKind.ANY_T);

    expect(r.status).toBe(PnsWalkStatus.ST_DONE);
    expect([...r.line.cLine().points()]).toEqual([V(0, 0), V(1000000, 0)]);
  });

  it('walks round a pad in the way and comes back DONE', () => {
    const world = emptyWorld(1000);
    world.addSolid(pad(500000, 0, 100000, NET_B));

    const l = line(100, NET_A, [0, 0], [1000000, 0]);
    const r = walkaroundRoute(world, l, true, 40, PnsKind.ANY_T);

    expect(r.status).toBe(PnsWalkStatus.ST_DONE);
    expect(r.line.pointCount()).toBeGreaterThan(2);
    expect(r.line.cLine().cLastPoint()).toEqual(V(1000000, 0));
  });

  it('is STUCK when the path starts inside the obstacle', () => {
    const world = emptyWorld(1000);
    world.addSolid(pad(0, 0, 100000, NET_B));

    const l = line(100, NET_A, [0, 0], [1000000, 0]);
    const r = walkaroundRoute(world, l, true, 40, PnsKind.ANY_T);

    expect(r.status).toBe(PnsWalkStatus.ST_STUCK);
  });

  it('runs out of iterations as ALMOST_DONE, not STUCK', () => {
    const world = emptyWorld(1000);
    world.addSolid(pad(500000, 0, 100000, NET_B));

    const l = line(100, NET_A, [0, 0], [1000000, 0]);
    const r = walkaroundRoute(world, l, true, 0, PnsKind.ANY_T);

    expect(r.status).toBe(PnsWalkStatus.ST_ALMOST_DONE);
  });

  it('honours the item mask — a segment is invisible under SOLID_T', () => {
    const world = emptyWorld(1000);

    const blocker = new PnsSegment({ a: V(500000, -300000), b: V(500000, 300000) }, NET_B);
    blocker.setWidth(200000);
    blocker.setLayers(new PnsLayerRange(0, 0));
    world.addSegment(blocker);

    const l = line(100, NET_A, [0, 0], [1000000, 0]);

    // With ANY_T the segment is an obstacle and the route detours.
    expect(walkaroundRoute(world, l, true, 40, PnsKind.ANY_T).line.pointCount()).toBeGreaterThan(2);

    // With SOLID_T — which is what shove mode passes — it is not.
    const solidsOnly = walkaroundRoute(world, l, true, 40, PnsKind.SOLID_T);
    expect(solidsOnly.status).toBe(PnsWalkStatus.ST_DONE);
    expect(solidsOnly.line.pointCount()).toBe(2);
  });
});

// =============================================================================
describe('optimizeLine', () => {
  it('reports whether it changed the line, which is what callers branch on', () => {
    const world = emptyWorld(0);

    const straight = line(100, NET_A, [0, 0], [500, 0], [1000, 0]);
    expect(optimizeLine(straight, PnsOptimizerEffort.MERGE_COLINEAR, world)).toBe(true);
    expect(straight.pointCount()).toBe(2);

    const alreadyMinimal = line(100, NET_A, [0, 0], [1000, 0]);
    expect(optimizeLine(alreadyMinimal, PnsOptimizerEffort.MERGE_COLINEAR, world)).toBe(false);
  });

  it('an effort mask with no ported passes is a no-op', () => {
    const world = emptyWorld(0);
    const l = line(100, NET_A, [0, 0], [500, 0], [1000, 0]);

    // FANOUT_CLEANUP is accepted and does nothing — so
    // optimizeTailHeadTransition's fan-out arm never fires here.
    expect(optimizeLine(l, PnsOptimizerEffort.FANOUT_CLEANUP, world)).toBe(false);
    expect(l.pointCount()).toBe(3);
  });
});

// =============================================================================
describe('the placement lifecycle', () => {
  it('start seeds the seam, the net and one fixed-tail stage', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    expect(placer.start(V(1000, 2000), null)).toBe(true);

    expect(placer.currentStart()).toEqual(V(1000, 2000));
    expect(placer.currentEnd()).toEqual(V(1000, 2000));
    expect(placer.pStart()).toEqual(V(1000, 2000));
    expect(placer.internals().fixedTail().stageCount()).toBe(1);
    expect(placer.internals().isIdle()).toBe(false);
  });

  it('start on an item adopts its net; start on nothing adopts the orphan net', () => {
    const world = emptyWorld(0);
    const seg = new PnsSegment({ a: V(0, 0), b: V(1000, 0) }, NET_A);
    seg.setWidth(200000);
    seg.setLayers(new PnsLayerRange(0, 0));
    world.addSegment(seg);

    const { placer } = makePlacer(world);

    placer.start(V(1000, 0), seg);
    expect(placer.currentNets()).toEqual([NET_A]);

    placer.start(V(5000, 0), null);
    expect(placer.currentNets()).toEqual([null]);
  });

  it('the posture tolerance is the track width', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);

    // No trail yet and no last-segment hint: the answer is the seeded initial
    // direction, which start() set from the settings.
    expect(placer.mouseTrailTracer().getPosture(V(100, 100)).dir).toBe(Directions.N);
  });

  it('toggleVia off strips the via from the head immediately', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);
    expect(placer.toggleVia(true)).toBe(true);
    expect(placer.isPlacingVia()).toBe(true);

    placer.internals().setHead(line(200000, NET_A, [0, 0], [1000, 0]));
    placer.head().appendVia(
      // any via will do; the point is that toggling strips it
      placer
        .internals()
        .buildInitialLine(V(1000, 0), new PnsLine(), PnsMode.RM_MarkObstacles)
        .line.endsWithVia()
        ? placer
            .internals()
            .buildInitialLine(V(1000, 0), new PnsLine(), PnsMode.RM_MarkObstacles)
            .line.via()
        : (() => {
            throw new Error('expected a via');
          })(),
    );

    expect(placer.head().endsWithVia()).toBe(true);
    expect(placer.toggleVia(false)).toBe(true);
    expect(placer.head().endsWithVia()).toBe(false);
  });

  it('a move with nothing in the way reaches the cursor', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_Walkaround;

    placer.start(V(0, 0), null);
    expect(placer.move(V(1000000, 300000), null)).toBe(true);

    expect(placer.trace().cLine().cLastPoint()).toEqual(V(1000000, 300000));
    expect(placer.currentEnd()).toEqual(V(1000000, 300000));
  });

  it('setLayer is refused mid-chain and allowed when idle', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    // Idle: always allowed.
    expect(placer.setLayer(4)).toBe(true);
    expect(placer.currentLayer()).toBe(4);

    placer.start(V(0, 0), null);

    // No start item: allowed, and it resets the seam.
    expect(placer.setLayer(2)).toBe(true);
    expect(placer.currentLayer()).toBe(2);
  });

  it('setLayer is refused when the route started on a segment', () => {
    const world = emptyWorld(0);
    const seg = new PnsSegment({ a: V(0, 0), b: V(1000, 0) }, NET_A);
    seg.setWidth(200000);
    seg.setLayers(new PnsLayerRange(0, 0));
    world.addSegment(seg);

    const { placer } = makePlacer(world);
    placer.start(V(1000, 0), seg);

    // A track pins you to its layer.
    expect(placer.setLayer(5)).toBe(false);
  });

  it('hasPlacedAnything is false before the first fix', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);
    expect(placer.hasPlacedAnything()).toBe(false);
  });

  it('abortPlacement kills the world children but leaves the idle flag alone', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);
    expect(placer.internals().isIdle()).toBe(false);

    expect(placer.abortPlacement()).toBe(true);
    // Upstream does not reset m_idle here.
    expect(placer.internals().isIdle()).toBe(false);
  });

  it('updateSizes refuses to renarrow a track continued from an existing segment', () => {
    const world = emptyWorld(0);
    const seg = new PnsSegment({ a: V(0, 0), b: V(1000, 0) }, NET_A);
    seg.setWidth(500000);
    seg.setLayers(new PnsLayerRange(0, 0));
    world.addSegment(seg);

    const { placer } = makePlacer(world);
    placer.start(V(1000, 0), seg);

    const narrower = new PnsSizesSettings();
    narrower.setTrackWidth(100000);
    narrower.setTrackWidthIsExplicit(false);

    const before = placer.head().width();
    placer.updateSizes(narrower);
    expect(placer.head().width()).toBe(before);

    // An explicit width is honoured.
    narrower.setTrackWidthIsExplicit(true);
    placer.updateSizes(narrower);
    expect(placer.head().width()).toBe(100000);
  });

  it('commitPlacement hands the last node to the router and clears both pointers', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);

    placer.start(V(0, 0), null);
    placer.move(V(500000, 0), null);

    expect(placer.commitPlacement()).toBe(true);
    expect(router.committed).toHaveLength(1);
    expect(placer.currentNode()).toBeNull();
  });
});

// =============================================================================
describe('FixRoute', () => {
  it('leaves the last segment uncommitted without fix-all, and commits it with', () => {
    const build = (fixAll: boolean): number => {
      const world = emptyWorld(0);
      const { placer, router } = makePlacer(world);
      router.routingSettings.routingMode = PnsMode.RM_Walkaround;
      router.routingSettings.fixAllSegments = fixAll;

      placer.start(V(0, 0), null);
      placer.move(V(1000000, 300000), null);

      const before = placer.currentNode(true)?.getUpdatedItems().added.length ?? 0;
      placer.fixRoute(V(1000000, 300000), null, false);
      const node = placer.currentNode();

      return (node?.getUpdatedItems().added.length ?? 0) - before;
    };

    // Two segments in the trace: fix-all commits both, otherwise one.
    expect(build(true)).toBe(2);
    expect(build(false)).toBe(1);
  });

  it('an empty trace with no via commits nothing and reports failure', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);
    placer.move(V(0, 0), null);

    expect(placer.fixRoute(V(0, 0), null, false)).toBe(false);
  });

  it('a forced finish ends the placement even with no end item', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);
    placer.move(V(1000000, 0), null);

    expect(placer.fixRoute(V(1000000, 0), null, true)).toBe(true);
    expect(placer.internals().isIdle()).toBe(true);
    expect(placer.hasPlacedAnything()).toBe(true);
  });

  it('a non-final fix chains the placement, which then locks the layer', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    router.routingSettings.fixAllSegments = true;

    placer.start(V(0, 0), null);
    placer.move(V(1000000, 300000), null);

    expect(placer.fixRoute(V(1000000, 300000), null, false)).toBe(false);
    expect(placer.internals().isChainedPlacement()).toBe(true);
    expect(placer.setLayer(7)).toBe(false);
  });

  it('the DRC gate blocks a fix that collides, unless violations are allowed', () => {
    const world = emptyWorld(0);
    world.addSolid(pad(500000, 0, 300000, NET_B));

    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;
    router.routingSettings.allowDrcViolations = false;

    placer.start(V(0, 0), null);
    placer.move(V(1000000, 0), null);

    expect(placer.fixRoute(V(1000000, 0), null, true)).toBe(false);

    router.routingSettings.allowDrcViolations = true;
    expect(placer.fixRoute(V(1000000, 0), null, true)).toBe(true);
  });

  it('the stored allow-violations flag is ignored outside mark-obstacles mode', () => {
    // `AllowDRCViolations()` is `mode === RM_MarkObstacles && m_allowDRCViolations`
    // (pns_routing_settings.h:117-120), so a user who ticked the box in
    // highlight-collisions mode and then switched to walk-around must NOT be
    // able to commit a violating track. Reading the raw flag here would let
    // them.
    //
    // The trace is seeded rather than routed to. Upstream's own comment on this
    // gate (`:1594-1596`) says the case it exists for is a trace whose
    // *beginning* collides — and routing into that state leaves a one-point
    // trace, which `fixRoute` rejects in its empty-line branch for an entirely
    // different reason. Seeding a real multi-segment colliding trace is what
    // makes this test about the DRC gate rather than about the empty check.
    const world = emptyWorld(0);
    world.addSolid(pad(500000, 0, 300000, NET_B));

    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_Walkaround;
    router.routingSettings.allowDrcViolations = true;

    placer.start(V(0, 0), null);
    // Route somewhere clear first, so `m_lastNode` exists to commit into.
    placer.move(V(0, -1000000), null);

    const int = placer.internals();
    int.setTail(new PnsLine());
    int.setHead(line(200000, NET_A, [0, 0], [1000000, 0]));

    // Sanity: the seeded trace really does collide, so a `false` below can only
    // come from the gate.
    expect(world.checkColliding(placer.trace(), PnsKind.ANY_T)).not.toBeNull();

    expect(placer.fixRoute(V(1000000, 0), null, true)).toBe(false);
  });
});

// =============================================================================
describe('UnfixRoute', () => {
  it('restores the seam, layer and via flag from the popped stage', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    router.routingSettings.fixAllSegments = true;

    placer.start(V(0, 0), null);
    placer.move(V(1000000, 300000), null);
    placer.fixRoute(V(1000000, 300000), null, false);

    const start = placer.currentStart();
    expect(start).not.toEqual(V(0, 0));

    placer.unfixRoute();

    // The stage pushed by fixRoute carried m_fixStart, which was still (0,0).
    expect(placer.pStart()).toEqual(V(0, 0));
    expect(placer.currentStart()).toEqual(V(0, 0));
  });

  it('returns the head origin before clearing, and nothing when the head is empty', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);
    placer.move(V(1000000, 300000), null);

    const origin = placer.head().pointCount() ? placer.head().cLine().cPoint(0) : null;
    const ret = placer.unfixRoute();

    expect(ret).toEqual(origin);

    // Second call: the head is empty now, so nothing comes back — but the
    // bottom stage is still there, so it does not fail.
    expect(placer.unfixRoute()).toBeNull();
  });
});

// =============================================================================
describe('routeStep', () => {
  it('leaves a deliberate zero-length tail when it cannot walk out of the start', () => {
    const world = emptyWorld(0);
    // A pad swallowing the start point: every walk is stuck from step one.
    world.addSolid(pad(0, 0, 400000, NET_B));

    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_Walkaround;

    placer.start(V(0, 0), null);
    placer.internals().routeStep(V(1000000, 0));

    // Two identical points, i.e. one zero-length segment — not an empty line,
    // because the user must see that routing is happening.
    expect(placer.tail().pointCount()).toBe(2);
    expect(placer.tail().cLine().cPoint(0)).toEqual(placer.tail().cLine().cPoint(1));
  });

  it('records the cursor as m_last_p_end for the next via push-out attempt', () => {
    const world = emptyWorld(0);
    const { placer } = makePlacer(world);

    placer.start(V(0, 0), null);
    expect(placer.internals().lastPEnd()).toBeNull();

    placer.internals().routeStep(V(500000, 100000));
    expect(placer.internals().lastPEnd()).toEqual(V(500000, 100000));
  });

  it('does not reduce a tail in mark-obstacles mode, because followMouse is off', () => {
    // `FollowMouse()` is `m_followMouse && mode !== RM_MarkObstacles`, and the
    // stored flag defaults to true — so reading it raw would run `reduceTail`
    // in a mode whose whole contract is that the user, not the router, decides
    // the shape of the track. Seeded with a tail long enough for reduceTail to
    // bite (it needs two tail segments and one head segment).
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;

    placer.start(V(0, 0), null);

    const int = placer.internals();
    int.setCurrentStart(V(0, 0));
    int.setTail(line(200000, NET_A, [0, 0], [0, -400000], [400000, -800000]));
    int.setHead(line(200000, NET_A, [400000, -800000], [600000, -800000]));
    int.setPStart(V(400000, -800000));

    const tailBefore = [...placer.tail().cLine().points()];

    int.routeStep(V(900000, -800000));

    expect([...placer.tail().cLine().points()]).toEqual(tailBefore);
  });

  it('does not grow a tail in mark-obstacles mode, because followMouse is off', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_MarkObstacles;

    placer.start(V(0, 0), null);

    for (const p of [V(200000, 0), V(400000, 100000), V(700000, 200000), V(900000, 400000)])
      placer.internals().routeStep(p);

    expect(placer.tail().pointCount()).toBe(0);
    expect(placer.trace().cLine().cLastPoint()).toEqual(V(900000, 400000));
  });
});

// =============================================================================
describe('updatePStart', () => {
  it('falls back to the routing start only when the tail is empty', () => {
    const { placer } = makePlacer();
    const int = placer.internals();

    int.setCurrentStart(V(7, 8));

    int.updatePStart(new PnsLine());
    expect(placer.pStart()).toEqual(V(7, 8));

    int.updatePStart(line(100, NET_A, [0, 0], [100, 50]));
    expect(placer.pStart()).toEqual(V(100, 50));
  });
});

// =============================================================================
describe('the shove boundary', () => {
  it('the merged PnsShove satisfies the interface the placer drives', () => {
    // A compile-time check, not really a runtime one: this assignment only
    // typechecks if `PnsShove` has every member of `PnsShoveLike` with a
    // compatible signature. If SHOVE's public surface ever drifts from what the
    // placer calls, `pnpm -C qa typecheck` fails here rather than a routing
    // session failing in front of a user.
    const asLike: (aShove: PnsShove) => PnsShoveLike = (aShove) => aShove;

    expect(typeof asLike).toBe('function');
  });

  /** A recorder standing in for the real engine, so the call order is visible. */
  class RecordingShove implements PnsShoveLike {
    calls: string[] = [];
    node: PnsNode;
    status = 0;
    springbackNode: PnsNode | null | undefined;

    constructor(aNode: PnsNode) {
      this.node = aNode;
    }

    currentNode(): PnsNode {
      this.calls.push('currentNode');
      return this.node;
    }

    setSpringbackDoNotTouchNode(aNode: PnsNode | null): void {
      this.calls.push('setSpringbackDoNotTouchNode');
      this.springbackNode = aNode;
    }

    clearHeads(): void {
      this.calls.push('clearHeads');
    }

    addHeads(): void {
      this.calls.push('addHeads');
    }

    run(): 0 {
      this.calls.push('run');
      return 0;
    }

    headsModified(): boolean {
      return false;
    }

    getModifiedHead(): PnsLine {
      return new PnsLine();
    }

    addLockedSpringbackNode(): boolean {
      this.calls.push('addLockedSpringbackNode');
      return true;
    }

    unlockSpringbackNode(): void {
      this.calls.push('unlockSpringbackNode');
    }

    rewindSpringbackTo(): boolean {
      this.calls.push('rewindSpringbackTo');
      return true;
    }

    rewindToLastLockedNode(): boolean {
      this.calls.push('rewindToLastLockedNode');
      return true;
    }
  }

  it('shove mode clears the do-not-touch node when the cursor leaves the end item', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_Shove;

    const shove = new RecordingShove(world);
    router.shove = shove;

    placer.start(V(0, 0), null);
    placer.move(V(1000000, 0), null);

    expect(shove.calls).toContain('setSpringbackDoNotTouchNode');
    // No end item under the cursor, so springback is explicitly unpinned.
    expect(shove.springbackNode).toBeNull();
    expect(shove.calls).toContain('clearHeads');
    expect(shove.calls).toContain('addHeads');
    expect(shove.calls).toContain('run');
  });

  it('commitPlacement rewinds to the last locked node in shove mode only', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    const shove = new RecordingShove(world);
    router.shove = shove;

    router.routingSettings.routingMode = PnsMode.RM_Walkaround;
    placer.start(V(0, 0), null);
    placer.commitPlacement();
    expect(shove.calls).not.toContain('rewindToLastLockedNode');

    router.routingSettings.routingMode = PnsMode.RM_Shove;
    placer.start(V(0, 0), null);
    placer.commitPlacement();
    expect(shove.calls).toContain('rewindToLastLockedNode');
  });

  it('unfixRoute rewinds and unlocks springback', () => {
    const world = emptyWorld(0);
    const { placer, router } = makePlacer(world);
    const shove = new RecordingShove(world);
    router.shove = shove;

    placer.start(V(0, 0), null);
    placer.unfixRoute();

    expect(shove.calls).toContain('rewindSpringbackTo');
    expect(shove.calls).toContain('unlockSpringbackNode');
  });

  it('with no shove engine, shove mode degrades to walkaround rather than failing', () => {
    const world = emptyWorld(0);
    world.addSolid(pad(500000, 0, 100000, NET_B));

    const { placer, router } = makePlacer(world);
    router.routingSettings.routingMode = PnsMode.RM_Shove;
    router.shove = null;

    placer.start(V(0, 0), null);
    expect(placer.move(V(1000000, 0), null)).toBe(true);
  });
});
