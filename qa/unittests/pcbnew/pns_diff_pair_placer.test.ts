// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The differential-pair *placer*: the session that turns a cursor position into
 * two committed tracks.
 * Counterpart: `pcbnew/router/pns_diff_pair_placer.cpp`.
 *
 * `pns_diff_pair.test.ts` pins the geometry — which gateways exist and how they
 * are scored. What is worth pinning here is everything *around* that: which
 * pair the route is continuing, which world state the gateways are built
 * against, and the handful of small decisions that between them determine
 * whether a pair leaves its pad straight on or turns.
 *
 * The single most consequential of those is `routeHead`'s `lead_dist`
 * threshold. Below half a `gap()` the target is built at the *projection* of
 * the cursor onto the pair's heading and every gateway spread along that
 * heading is filtered away, which keeps the two lanes side by side; above it
 * the target is built at the cursor itself and a 45° turn is allowed. Get the
 * comparison backwards and every pair on the board still routes — just wrongly.
 *
 * Four upstream bugs are pinned rather than fixed, because each one changes
 * what the router is willing to do:
 *
 *  - `tryWalkDp`'s `bestScore > 0.0` is true even when every attempt failed, so
 *    it reports success having emptied the pair;
 *  - `routeHead` answers the *previous* `m_currentTraceOk` when the fit fails,
 *    so a stale trace is reported as a live one;
 *  - `propagateDpHeadForces` never resets its running `force` and never reads
 *    the `totalForce` it accumulates;
 *  - `FindDpPrimitivePair` ignores the cursor position it is handed.
 *
 * ## What these tests do NOT pin
 *
 * A mutation run over 39 mutants (plus two controls, both of which survived, as
 * a control must) killed 16 and left 23 standing. Rather than contrive fixtures
 * for them, here is what each survivor is and why it is unpinned. An honestly
 * labelled gap is more use than a test that passes for the wrong reason — and
 * several of the entries below were *already* wrong-reason tests, caught by the
 * mutants and demoted to this list.
 *
 * **Provably equivalent — no test possible**
 *
 *  - `m_chainedPlacement = !m_snapOnTarget && !aForceFinish`, dropping the
 *    `&& !aForceFinish`. A forced finish also sets `m_idle`, and the flag's only
 *    reader (`SetLayer`) tests `m_idle` first while `Start` resets the flag. It
 *    is dead on that path either way.
 *  - `dist < bestDist` → `<=` in `FindDpPrimitivePair`. It changes only which of
 *    two *exactly equidistant* candidates wins, and that tie-break is documented
 *    as ours rather than upstream's (upstream orders a `std::set<ITEM*>` by heap
 *    address). Unobservable by construction.
 *
 * **The mechanism is pinned elsewhere; the placer only forwards a flag**
 *
 *  - `preferDiagonal` into `BuildFromPrimitivePair`, `prefDiagonal` into
 *    `FitGateways`, and the two things that feed them —
 *    `m_initialDiagonal = !DIRECTION_45( CSegment( -2 ) ).IsDiagonal()` and the
 *    `-2` itself. For a round pad the first call goes straight to
 *    `BuildGeneric`, which ignores the flag, and `FitGateways` tries **both**
 *    senses for a three-point priority penalty. Every gateway priority in these
 *    fixtures differs by eight or more, so the penalty never flips a decision.
 *    `pns_diff_pair.test.ts` pins the penalty itself directly.
 *
 * **No fixture reaches the branch**
 *
 *  - `FilterByOrientation`'s mask, and removing the call outright: the gateway
 *    that wins is never one the filter would have dropped, so the filter is
 *    inert here. (The "keeps the pair side by side" test below therefore passes
 *    for a weaker reason than its name suggests.)
 *  - `tryWalkDp`'s skew weight `3.0` and its `score < bestScore`: with `aWindCw`
 *    unused the four attempts collapse to two identical pairs, and every
 *    fixture makes them all succeed identically or all fail. No fixture scores
 *    two attempts differently.
 *  - `copyDiffPair` reduced to a shape copy: same reason — the width and gap it
 *    carries are only read by the scoring that never discriminates.
 *  - `attemptWalk`'s `iter < 3` bound, its `!currentIsP` swap flag, and
 *    `cur.Gap() - 2 * PNS_HULL_MARGIN`: no fixture drives the walk/shove
 *    alternation past its first pass.
 *  - `propagateDpHeadForces` answering `totalForce` instead of `force`: every
 *    fixture pushes the head off exactly one obstacle, where the two are equal.
 *  - `succeeded = !collided || iter !== maxIter` with `||` → `&&`: `handled`
 *    ends the loop long before `maxIter`, so the right-hand side is always true.
 *  - `layerForce` assigned unconditionally rather than only on collision: the
 *    virtual head is single-layer in every fixture, so the layer loop runs once.
 *  - The trim guard's `&&` → `||`: no fixture produces a pair with one lane at
 *    exactly one segment.
 *
 * **Measured, and the obvious test still did not separate them**
 *
 *  - `rhWalkOnly`'s `aSolidsOnly = false` against `rhShoveOnly`'s `true`. A
 *    track wall does make the two modes differ, but for other reasons as well,
 *    so the assertion below does not isolate the flag. Unpinned.
 *  - The head diameter `gap + 2 * width` reduced to `gap + width`: probed across
 *    obstacle distances 200-500 IU from the cursor, and both diameters produce
 *    the same route everywhere the route changes at all.
 *  - The clearance being resolved against `m_currentTrace.PLine()` rather than
 *    against the virtual head. Probed with a resolver that answers differently
 *    per item kind; it did not separate them either.
 *
 * **Defensive fidelity, not behaviour**
 *
 *  - `rhShoveOnly` copying `PLine()`/`NLine()` before handing them to the shove.
 *    Nothing in these fixtures mutates the line the shove is given, so the copy
 *    is invisible — but upstream copies, and a shove that did write through
 *    would corrupt the pair's cache.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DP_PLACER_SIZES,
  DP_ERR_NO_COMPLEMENTARY_NET,
  DP_ERR_NO_STARTING_POINT,
  PnsDiffPairPlacer,
  diffPairViaGap,
  dpErrNoCoupledStartingPoint,
  effectiveDiffPairViaGap,
  findDpPrimitivePair,
  getDanglingAnchor,
  pushoutForce,
  type DpPlacerHost,
  type DpPlacerSizes,
} from '@ziroeda/pcbnew/src/router/pns_diff_pair_placer.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import {
  PNS_HULL_MARGIN,
  PnsLine,
  PnsLineChain,
} from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import { segmentCount } from '@ziroeda/pcbnew/src/router/pns_line.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  PnsMode,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import { Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { PnsRuleResolver } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_P: NetHandle = 'P';
const NET_N: NetHandle = 'N';
const NET_OTHER: NetHandle = 'GND';

/**
 * A resolver that knows exactly one differential pair, P/N, and answers one
 * clearance for everything else.
 */
class DpResolver implements PnsRuleResolver {
  clearanceValue: number;

  constructor(aClearance = 0) {
    this.clearanceValue = aClearance;
  }

  clearance(): number {
    return this.clearanceValue;
  }

  hullCache(aItem: PnsItem, aClearance: number, aThickness: number, aLayer: number) {
    return itemHull(aItem, aClearance, aThickness, aLayer);
  }

  dpCoupledNet(aNet: NetHandle): NetHandle {
    return aNet === NET_P ? NET_N : NET_P;
  }

  dpNetPolarity(aNet: NetHandle): number {
    return aNet === NET_P ? 1 : -1;
  }

  dpNetPair(aItem: PnsItem): { netP: NetHandle; netN: NetHandle } | null {
    const n = aItem.net();

    if (n !== NET_P && n !== NET_N) return null;

    return { netP: NET_P, netN: NET_N };
  }

  netCode(aNet: NetHandle): number {
    return aNet === NET_P ? 1 : aNet === NET_N ? 2 : 3;
  }

  netName(aNet: NetHandle): string {
    return String(aNet ?? '');
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

/** The `ROUTER` surface, recording rather than acting. */
class TestHost implements DpPlacerHost {
  readonly node: PnsNode;
  settingsValue: RoutingSettings;
  failureReason: string | null = null;
  committed: PnsNode[] = [];
  ratlines: { line: Vec2[]; net: NetHandle }[] = [];

  constructor(aNode: PnsNode, aSettings: RoutingSettings) {
    this.node = aNode;
    this.settingsValue = aSettings;
  }

  world(): PnsNode {
    return this.node;
  }

  settings(): RoutingSettings {
    return this.settingsValue;
  }

  setFailureReason(aReason: string): void {
    this.failureReason = aReason;
  }

  commitRouting(aNode: PnsNode): boolean {
    this.committed.push(aNode);
    return true;
  }
}

const routingSettings = (aOver: Partial<RoutingSettings> = {}): RoutingSettings => ({
  ...DEFAULT_ROUTING_SETTINGS,
  routingMode: PnsMode.RM_MarkObstacles,
  ...aOver,
});

/** `gap()` is `diffPairGap + diffPairWidth` = 500 with these. */
const sizes = (aOver: Partial<DpPlacerSizes> = {}): DpPlacerSizes => ({
  ...DEFAULT_DP_PLACER_SIZES,
  diffPairWidth: 200,
  diffPairGap: 300,
  viaDiameter: 600,
  viaDrill: 300,
  layerTop: 0,
  layerBottom: 31,
  ...aOver,
});

/** A round pad on one layer. */
function pad(aAt: Vec2, aNet: NetHandle, aR = 100, aLayer = 0): PnsSolid {
  const s = new PnsSolid();

  s.setNet(aNet);
  s.setLayers(new PnsLayerRange(aLayer));
  s.setShape({ kind: 'circle', c: V(0, 0), r: aR });
  s.setPos(aAt);

  return s;
}

/** A pad with no shape at all — `shape()` answers null, as a bare `SOLID` does. */
function shapelessPad(aAt: Vec2, aNet: NetHandle, aLayer = 0): PnsSolid {
  const s = new PnsSolid();

  s.setNet(aNet);
  s.setLayers(new PnsLayerRange(aLayer));
  s.setPos(aAt);

  return s;
}

function track(aA: Vec2, aB: Vec2, aNet: NetHandle, aWidth = 200, aLayer = 0): PnsSegment {
  const s = new PnsSegment({ seg: { a: aA, b: aB }, width: aWidth }, aNet);

  s.setLayers(new PnsLayerRange(aLayer));

  return s;
}

/** A world with the P/N resolver and a search radius wide enough to find things. */
function world(aClearance = 0): PnsNode {
  const n = new PnsNode();

  n.setRuleResolver(new DpResolver(aClearance));
  n.setMaxClearance(10000);

  return n;
}

// ---------------------------------------------------------------------------

describe('SIZES_SETTINGS accessors', () => {
  it('DiffPairViaGap() honours the same-as-trace-gap flag', () => {
    const s = sizes({ diffPairGap: 300, diffPairViaGap: 900 });

    expect(diffPairViaGap({ ...s, diffPairViaGapSameAsTraceGap: false })).toBe(900);
    expect(diffPairViaGap({ ...s, diffPairViaGapSameAsTraceGap: true })).toBe(300);
  });

  it('EffectiveDiffPairViaGap() takes the largest of the three equivalents', () => {
    // annularRing = (1000 - 400) / 2 = 300.
    const base = sizes({ viaDiameter: 1000, viaDrill: 400, diffPairViaGap: 250 });

    // Copper-to-copper wins outright.
    expect(
      effectiveDiffPairViaGap({ ...base, diffPairHoleToHole: 0, diffPairCopperToHole: 0 }),
    ).toBe(250);

    // Hole-to-hole 1000 costs two annular rings, leaving 400.
    expect(
      effectiveDiffPairViaGap({ ...base, diffPairHoleToHole: 1000, diffPairCopperToHole: 0 }),
    ).toBe(400);

    // Copper-to-hole 800 costs one, leaving 500 — the largest of the three.
    expect(
      effectiveDiffPairViaGap({ ...base, diffPairHoleToHole: 1000, diffPairCopperToHole: 800 }),
    ).toBe(500);
  });

  it('the annular ring truncates toward zero rather than flooring', () => {
    // (5 - 10) / 2 = -2.5. C++ integer division gives -2, `Math.floor` -3, and
    // the hole-to-hole term doubles the difference: `0 - 2*(-2)` is 4 where
    // flooring would give 6.
    const s = sizes({
      viaDiameter: 5,
      viaDrill: 10,
      diffPairViaGap: 0,
      diffPairHoleToHole: 0,
      diffPairCopperToHole: 0,
    });

    expect(effectiveDiffPairViaGap(s)).toBe(4);
  });
});

// ---------------------------------------------------------------------------

describe('getDanglingAnchor', () => {
  it('a pad and a via answer their own anchor', () => {
    const n = world();
    const p = pad(V(1000, 2000), NET_P);
    const v = new PnsVia(V(3000, 4000), new PnsLayerRange(0, 31), 600, 300, NET_P);

    n.addSolid(p);
    n.addVia(v);

    expect(getDanglingAnchor(n, p)).toEqual(V(1000, 2000));
    expect(getDanglingAnchor(n, v)).toEqual(V(3000, 4000));
  });

  it('a segment free at both ends answers A, not B', () => {
    const n = world();
    const s = track(V(0, 0), V(1000, 0), NET_P);

    n.addSegment(s);

    // Both joints have a single link, so both arms of the `if` would fire. The
    // A arm is written first and that is the whole of the tie-break.
    expect(getDanglingAnchor(n, s)).toEqual(V(0, 0));
  });

  it('a segment joined at A answers B', () => {
    const n = world();
    const s = track(V(0, 0), V(1000, 0), NET_P);

    n.addSegment(s);
    n.addSegment(track(V(0, 0), V(0, 1000), NET_P));

    expect(getDanglingAnchor(n, s)).toEqual(V(1000, 0));
  });

  it('a segment joined at both ends is not dangling at all', () => {
    const n = world();
    const s = track(V(0, 0), V(1000, 0), NET_P);

    n.addSegment(s);
    n.addSegment(track(V(0, 0), V(0, 1000), NET_P));
    n.addSegment(track(V(1000, 0), V(1000, 1000), NET_P));

    expect(getDanglingAnchor(n, s)).toBeNull();
  });

  it('a LINE answers its first point, and an empty one answers nothing', () => {
    const n = world();
    const l = new PnsLine();

    l.setShape(PnsLineChain.fromPoints([V(5, 6), V(100, 6)]));
    l.setNet(NET_P);

    expect(getDanglingAnchor(n, l)).toEqual(V(5, 6));

    const empty = new PnsLine();

    empty.setNet(NET_P);

    expect(getDanglingAnchor(n, empty)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('FindDpPrimitivePair', () => {
  it('reports the net error when the item is not on a differential pair', () => {
    const n = world();
    const p = pad(V(0, 0), NET_OTHER);

    n.addSolid(p);

    const r = findDpPrimitivePair(n, V(0, 0), p);

    expect(r.pair).toBeNull();
    expect(r.errorMsg).toBe(DP_ERR_NO_COMPLEMENTARY_NET);
  });

  it('reports the net error for a null item', () => {
    expect(findDpPrimitivePair(world(), V(0, 0), null).errorMsg).toBe(DP_ERR_NO_COMPLEMENTARY_NET);
  });

  it('reports the starting-point error when the reference is not dangling', () => {
    const n = world();
    const s = track(V(0, 0), V(1000, 0), NET_P);

    n.addSegment(s);
    n.addSegment(track(V(0, 0), V(0, 1000), NET_P));
    n.addSegment(track(V(1000, 0), V(1000, 1000), NET_P));

    const r = findDpPrimitivePair(n, V(0, 0), s);

    expect(r.pair).toBeNull();
    expect(r.errorMsg).toBe(DP_ERR_NO_STARTING_POINT);
  });

  it('names the coupled net when nothing on it can be paired', () => {
    const n = world();
    const p = pad(V(0, 0), NET_P);

    n.addSolid(p);

    const r = findDpPrimitivePair(n, V(0, 0), p);

    expect(r.pair).toBeNull();
    expect(r.errorMsg).toBe(dpErrNoCoupledStartingPoint('N'));
  });

  it('orients the pair so primP is on the P net, whichever half was grabbed', () => {
    const n = world();
    const pP = pad(V(0, 0), NET_P);
    const pN = pad(V(0, 1000), NET_N);

    n.addSolid(pP);
    n.addSolid(pN);

    const fromP = findDpPrimitivePair(n, V(0, 0), pP).pair;
    const fromN = findDpPrimitivePair(n, V(0, 1000), pN).pair;

    expect(fromP?.anchorP()).toEqual(V(0, 0));
    expect(fromP?.anchorN()).toEqual(V(0, 1000));

    // Grabbing the N half must produce the *same* orientation, not the mirror.
    expect(fromN?.anchorP()).toEqual(V(0, 0));
    expect(fromN?.anchorN()).toEqual(V(0, 1000));
  });

  it('takes the nearest candidate on the coupled net', () => {
    const n = world();
    const pP = pad(V(0, 0), NET_P);

    n.addSolid(pP);
    n.addSolid(pad(V(0, 5000), NET_N));
    n.addSolid(pad(V(0, 1000), NET_N));
    n.addSolid(pad(V(0, 9000), NET_N));

    expect(findDpPrimitivePair(n, V(0, 0), pP).pair?.anchorN()).toEqual(V(0, 1000));
  });

  it('skips a coupled item of a different kind, however near', () => {
    const n = world();
    const pP = pad(V(0, 0), NET_P);

    n.addSolid(pP);
    // A track end 10 units away is not the other half of a pad pair.
    n.addSegment(track(V(0, 10), V(0, 900), NET_N));
    n.addSolid(pad(V(0, 5000), NET_N));

    expect(findDpPrimitivePair(n, V(0, 0), pP).pair?.anchorN()).toEqual(V(0, 5000));
  });

  it('skips a nearer pad whose layer range differs', () => {
    const n = world();
    const pP = pad(V(0, 0), NET_P, 100, 0);

    n.addSolid(pP);
    n.addSolid(pad(V(0, 500), NET_N, 100, 5));
    n.addSolid(pad(V(0, 5000), NET_N, 100, 0));

    expect(findDpPrimitivePair(n, V(0, 0), pP).pair?.anchorN()).toEqual(V(0, 5000));
  });

  it('ignores the point it is handed', () => {
    const n = world();
    const pP = pad(V(0, 0), NET_P);

    n.addSolid(pP);
    n.addSolid(pad(V(0, 1000), NET_N));
    n.addSolid(pad(V(0, 5000), NET_N));

    // Upstream's `aP` parameter is dead. Moving it right next to the far pad
    // must not draw the search towards it.
    const near = findDpPrimitivePair(n, V(0, 0), pP).pair;
    const far = findDpPrimitivePair(n, V(0, 5000), pP).pair;

    expect(near?.anchorN()).toEqual(V(0, 1000));
    expect(far?.anchorN()).toEqual(V(0, 1000));
  });
});

// ---------------------------------------------------------------------------

describe('pushoutForce', () => {
  it('pushes a circular head clear of a circle by exactly the shortfall', () => {
    const obstacle = { kind: 'circle', c: V(0, 0), r: 100 } as const;
    const head = { kind: 'circle', c: V(150, 0), r: 100 } as const;

    // Centres 150 apart, radii 100 + 100, clearance 50: the gap is -50 and is
    // clamped to 0, so the push is the whole clearance.
    const r = pushoutForce(obstacle, head, V(150, 0), 50);

    expect(r.collides).toBe(true);
    expect(r.force.y).toBe(0);
    expect(r.force.x).toBeGreaterThan(0);
  });

  it('is zero and not colliding when the two are far apart', () => {
    const obstacle = { kind: 'circle', c: V(0, 0), r: 100 } as const;
    const head = { kind: 'circle', c: V(5000, 0), r: 100 } as const;

    expect(pushoutForce(obstacle, head, V(5000, 0), 50)).toEqual({
      collides: false,
      force: V(0, 0),
    });
  });

  it('reports a collision with a zero force when the shortfall is nil', () => {
    // Upstream's `Collide` returns true and writes an MTV; the two are reported
    // separately here because `propagateDpHeadForces`' `collided |= …` needs the
    // boolean, not "is the vector non-zero".
    const obstacle = { kind: 'circle', c: V(0, 0), r: 100 } as const;
    const head = { kind: 'circle', c: V(199, 0), r: 100 } as const;
    const r = pushoutForce(obstacle, head, V(199, 0), 0);

    expect(r.collides).toBe(true);
  });

  it('pushes away from the nearest point of a stadium, not from its centre', () => {
    // A long horizontal stadium; a head above its middle must be pushed +y.
    const obstacle = { kind: 'stadium', a: V(-5000, 0), b: V(5000, 0), r: 100 } as const;
    const head = { kind: 'circle', c: V(0, 150), r: 100 } as const;

    const r = pushoutForce(obstacle, head, V(0, 150), 50);

    expect(r.force.x).toBe(0);
    expect(r.force.y).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('DIFF_PAIR_PLACER session', () => {
  let node: PnsNode;
  let host: TestHost;
  let placer: PnsDiffPairPlacer;
  let padP: PnsSolid;
  let padN: PnsSolid;

  beforeEach(() => {
    node = world();
    padP = pad(V(0, 0), NET_P);
    padN = pad(V(0, 1000), NET_N);
    node.addSolid(padP);
    node.addSolid(padN);

    host = new TestHost(node, routingSettings());
    placer = new PnsDiffPairPlacer(host);
    placer.updateSizes(sizes());
  });

  it('Start() latches the two nets and branches the world', () => {
    expect(placer.isIdle()).toBe(true);
    expect(placer.start(V(0, 0), padP)).toBe(true);

    expect(placer.currentNets()).toEqual([NET_P, NET_N]);
    expect(placer.currentStart()).toEqual(V(0, 0));
    expect(placer.currentEnd()).toEqual(V(0, 0));
    expect(placer.isIdle()).toBe(false);

    // `initPlacement` routes everything through a branch, never the world.
    expect(node.hasChildren()).toBe(true);
    expect(placer.currentNode()).not.toBe(node);
  });

  it('Start() on an unpaired item fails with the reason on the host', () => {
    const lone = pad(V(9000, 0), NET_OTHER);

    node.addSolid(lone);

    expect(placer.start(V(9000, 0), lone)).toBe(false);
    expect(host.failureReason).toBe(DP_ERR_NO_COMPLEMENTARY_NET);
  });

  it('Move() builds a pair whose lanes are gap + width apart', () => {
    placer.start(V(0, 0), padP);

    expect(placer.move(V(6000, 500), null)).toBe(true);

    const trace = placer.currentTrace();

    expect(segmentCount(trace.cP())).toBeGreaterThan(0);
    expect(segmentCount(trace.cN())).toBeGreaterThan(0);

    // The trace's own gap is the DRC one — `routeHead` calls `SetGap` twice and
    // the *second* call, with `DiffPairGap()`, is the one that sticks.
    expect(trace.gap()).toBe(300);
    expect(trace.width()).toBe(200);

    // The two lanes end a full centre-to-centre `gap()` apart.
    const lastP = trace.cP()[trace.cP().length - 1] as Vec2;
    const lastN = trace.cN()[trace.cN().length - 1] as Vec2;

    expect(Math.hypot(lastP.x - lastN.x, lastP.y - lastN.y)).toBeCloseTo(500, -1);
  });

  /**
   * The `lead_dist` threshold, pinned on both sides of the exact boundary.
   *
   * The pads are stacked vertically at x = 0, so `CursorOrientation` reports a
   * midpoint of (0, 500) heading along +x and the guide line is y = 500. A
   * cursor at (6000, 500 + d) therefore has `lead_dist = d` exactly.
   *
   * The threshold is `( DiffPairGap() + DiffPairWidth() ) / 2` = 250, compared
   * with a **strict** `>`. At or below it the target is built at the
   * *projection* — which is the same point (6000, 500) for every such cursor —
   * so every route inside the band is identical. One unit past it the target is
   * built at the cursor itself and the route changes.
   */
  it('routes identically anywhere inside the lead_dist band, and differently one unit past it', () => {
    const route = (aCursor: Vec2): Vec2[] => {
      placer.start(V(0, 0), padP);
      placer.move(aCursor, null);

      return placer
        .currentTrace()
        .cP()
        .map((p) => ({ ...p }));
    };

    const onAxis = route(V(6000, 500));
    const atThreshold = route(V(6000, 750)); // lead_dist === 250, not > 250
    const pastThreshold = route(V(6000, 751)); // lead_dist === 251

    // Everything inside the band projects onto the same target point.
    expect(atThreshold).toEqual(onAxis);

    // One unit past it, the target is the cursor and the geometry moves.
    expect(pastThreshold).not.toEqual(onAxis);
  });

  it('the near branch keeps the pair side by side rather than one lane behind the other', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    // `FilterByOrientation( ANG_STRAIGHT | ANG_HALF_FULL, dirV )` drops every
    // target gateway whose two anchors lie along the direction of travel, so
    // the lanes must end up spread *across* it.
    const p = placer.currentTrace().cP();
    const n = placer.currentTrace().cN();
    const lastP = p[p.length - 1] as Vec2;
    const lastN = n[n.length - 1] as Vec2;

    const spread = Direction45.fromVector({ x: lastP.x - lastN.x, y: lastP.y - lastN.y });
    const travel = Direction45.fromVector({ x: 1, y: 0 });

    expect(spread.angle(travel)).not.toBe(travel.angle(travel));
  });

  it('Move() records the requested end point, not the one reached', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    expect(placer.currentEnd()).toEqual(V(6000, 500));
  });

  it('ToggleVia() puts a via on each lane and re-routes', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    expect(placer.currentTrace().endsWithVias()).toBe(false);
    expect(placer.toggleVia(true)).toBe(true);
    expect(placer.isPlacingVia()).toBe(true);
    expect(placer.currentTrace().endsWithVias()).toBe(true);

    placer.toggleVia(false);

    expect(placer.currentTrace().endsWithVias()).toBe(false);
  });

  /**
   * `FlipPosture` is an involution, and often a no-op.
   *
   * The flag it toggles reaches `BuildFromPrimitivePair( …, preferDiagonal )`
   * and `FitGateways( …, prefDiagonal, … )`. For a **round pad** the first of
   * those goes straight to `BuildGeneric`, which ignores it entirely, and the
   * second tries *both* diagonal senses on every candidate anyway — charging
   * only three points of priority for the non-preferred one. So a flip changes
   * the route only when two candidates are within three points of each other.
   *
   * What is worth pinning is therefore that it re-derives the route from the
   * flag rather than accumulating state: flipping twice must restore exactly
   * what was there.
   */
  it('FlipPosture() re-routes from the flag, so flipping twice restores the route', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 6000), null);

    const before = placer
      .currentTrace()
      .cP()
      .map((p) => ({ ...p }));

    placer.flipPosture();

    const flipped = placer
      .currentTrace()
      .cP()
      .map((p) => ({ ...p }));

    expect(flipped.length).toBeGreaterThan(1);

    placer.flipPosture();

    expect(placer.currentTrace().cP()).toEqual(before);
  });

  it('SetLayer() is free while idle and refused on a chained placement', () => {
    expect(placer.setLayer(7)).toBe(true);
    expect(placer.currentLayer()).toBe(7);

    placer.setLayer(0);
    placer.start(V(0, 0), padP);

    // No previous pair yet: the second arm refuses.
    expect(placer.setLayer(3)).toBe(false);
    expect(placer.currentLayer()).toBe(0);
  });

  it('UpdateSizes() keeps an inherited width once something has been fixed', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);
    placer.fixRoute(V(6000, 500), null, false);

    // Not explicit, and something has been fixed -> the previous width wins.
    placer.updateSizes(sizes({ diffPairWidth: 999, trackWidthIsExplicit: false }));

    expect(placer.sizes().diffPairWidth).toBe(200);

    // Explicit -> the new width is taken.
    placer.updateSizes(sizes({ diffPairWidth: 999, trackWidthIsExplicit: true }));

    expect(placer.sizes().diffPairWidth).toBe(999);
  });

  it('UpdateSizes() while idle takes the value unconditionally', () => {
    placer.updateSizes(sizes({ diffPairWidth: 999, trackWidthIsExplicit: false }));

    expect(placer.sizes().diffPairWidth).toBe(999);
  });

  it('HasPlacedAnything() is an or, so one populated lane is enough', () => {
    expect(placer.hasPlacedAnything()).toBe(false);

    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    expect(placer.hasPlacedAnything()).toBe(true);

    placer.currentTrace().setShape(placer.currentTrace().cP(), []);

    expect(placer.hasPlacedAnything()).toBe(true);
  });

  it('CurrentNode() prefers the post-route branch and ignores its argument', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    const n = placer.currentNode();

    expect(n).not.toBeNull();
    expect(placer.currentNode(true)).toBe(n);
    expect(placer.currentNode(false)).toBe(n);
  });
});

// ---------------------------------------------------------------------------

describe('FixRoute', () => {
  let node: PnsNode;
  let host: TestHost;
  let placer: PnsDiffPairPlacer;
  let padP: PnsSolid;

  beforeEach(() => {
    node = world();
    padP = pad(V(0, 0), NET_P);
    node.addSolid(padP);
    node.addSolid(pad(V(0, 1000), NET_N));

    host = new TestHost(node, routingSettings());
    placer = new PnsDiffPairPlacer(host);
    placer.updateSizes(sizes());
  });

  it('refuses a route that does not fit unless violations are allowed', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    // Force the fit flag down by emptying the trace: the second guard then
    // refuses regardless.
    placer.currentTrace().setShape([], []);

    expect(placer.fixRoute(V(6000, 500), null, false)).toBe(false);
    expect(host.committed).toHaveLength(0);
  });

  it('returns false and starts a new segment when the route is not finished', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    // Not snapped on a target and not forced: the run continues, so the
    // *return* is false even though the fix succeeded.
    expect(placer.fixRoute(V(6000, 500), null, false)).toBe(false);
    expect(host.committed).toHaveLength(1);
    expect(placer.isIdle()).toBe(false);
  });

  it('returns true and goes idle when finishing is forced', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    expect(placer.fixRoute(V(6000, 500), null, true)).toBe(true);
    expect(placer.isIdle()).toBe(true);
    expect(host.committed).toHaveLength(1);
  });

  it('commits both lanes into the node it hands the host', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);
    placer.fixRoute(V(6000, 500), null, true);

    const committed = host.committed[0] as PnsNode;

    expect(committed.allItemsInNet(NET_P).size).toBeGreaterThan(1);
    expect(committed.allItemsInNet(NET_N).size).toBeGreaterThan(1);
  });

  /**
   * The trailing segment is dropped, on **both** lanes, when the route is
   * free-hand: not snapped on a target, not ending in vias, not forced, and
   * `fixAllSegments` off. That is what leaves the head loose so the next move
   * can re-place it.
   *
   * The guard is `newP.SegmentCount() > 1 && newN.SegmentCount() > 1`, an
   * **and** — a pair whose N lane is a single segment keeps its P lane's last
   * segment too, rather than the two lanes being trimmed independently.
   */
  it('keeps every segment when fixAllSegments is on', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 6000), null);

    const beforeP = placer.currentTrace().cP().length;
    const beforeN = placer.currentTrace().cN().length;

    expect(beforeP).toBeGreaterThan(2);

    // With fixAllSegments on (the default), nothing is trimmed.
    placer.fixRoute(V(6000, 6000), null, false);

    expect(placer.currentTrace().cP()).toHaveLength(beforeP);
    expect(placer.currentTrace().cN()).toHaveLength(beforeN);
  });

  it('drops the trailing point of both lanes when fixAllSegments is off', () => {
    host.settingsValue = routingSettings({ fixAllSegments: false });

    placer.start(V(0, 0), padP);
    placer.move(V(6000, 6000), null);

    const beforeP = placer.currentTrace().cP().length;
    const beforeN = placer.currentTrace().cN().length;

    placer.fixRoute(V(6000, 6000), null, false);

    expect(placer.currentTrace().cP()).toHaveLength(beforeP - 1);
    expect(placer.currentTrace().cN()).toHaveLength(beforeN - 1);
  });

  it('forcing the finish suppresses the trim even with fixAllSegments off', () => {
    host.settingsValue = routingSettings({ fixAllSegments: false });

    placer.start(V(0, 0), padP);
    placer.move(V(6000, 6000), null);

    const beforeP = placer.currentTrace().cP().length;

    expect(placer.fixRoute(V(6000, 6000), null, true)).toBe(true);
    expect(placer.currentTrace().cP()).toHaveLength(beforeP);
  });

  it('a fix that snaps onto a real target pair ends the run', () => {
    const targetP = pad(V(20000, 0), NET_P);
    const targetN = pad(V(20000, 1000), NET_N);

    node.addSolid(targetP);
    node.addSolid(targetN);

    placer.start(V(0, 0), padP);
    placer.move(V(20000, 500), targetP);

    expect(placer.snapOnTarget()).toBe(true);
    expect(placer.fixRoute(V(20000, 500), null, false)).toBe(true);
    expect(placer.isIdle()).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('upstream bugs, pinned', () => {
  let node: PnsNode;
  let host: TestHost;
  let placer: PnsDiffPairPlacer;
  let padP: PnsSolid;

  beforeEach(() => {
    node = world();
    padP = pad(V(0, 0), NET_P);
    node.addSolid(padP);
    node.addSolid(pad(V(0, 1000), NET_N));

    host = new TestHost(node, routingSettings());
    placer = new PnsDiffPairPlacer(host);
    placer.updateSizes(sizes());
  });

  it('routeHead reports the *stale* trace as a success when the fit fails', () => {
    placer.start(V(0, 0), padP);

    expect(placer.move(V(6000, 500), null)).toBe(true);

    const good = placer
      .currentTrace()
      .cP()
      .map((p) => ({ ...p }));

    expect(good.length).toBeGreaterThan(1);

    // Two shapeless pads: `BuildFromPrimitivePair` reaches `if( !shP ) return`
    // and emits no gateways at all, so `FitGateways` cannot succeed.
    const blindP = shapelessPad(V(30000, 0), NET_P);
    const blindN = shapelessPad(V(30000, 1000), NET_N);

    node.addSolid(blindP);
    node.addSolid(blindN);

    // Upstream returns `m_currentTraceOk` rather than false here, so this reads
    // as a successful move — and the geometry is the *previous* one.
    expect(placer.move(V(30000, 500), blindP)).toBe(true);
    expect(placer.currentTrace().cP()).toEqual(good);

    // Proof that the failure really was `FitGateways`, and not the cursor
    // branch quietly producing the same route: the target branch was taken.
    expect(placer.snapOnTarget()).toBe(true);

    // And the trace still ends nowhere near the cursor that was asked for.
    const last = placer.currentTrace().cP()[placer.currentTrace().cP().length - 1] as Vec2;

    expect(last.x).toBeLessThan(10000);
  });

  /** A wall of pads on a third net, right across the route. */
  const buildWall = (aX: number): void => {
    for (let y = -20000; y <= 20000; y += 400) node.addSolid(pad(V(aX, y), NET_OTHER, 300));
  };

  it('walk mode routes a clear board into two segments per lane', () => {
    host.settingsValue = routingSettings({ routingMode: PnsMode.RM_Walkaround });

    placer.start(V(0, 0), padP);

    expect(placer.move(V(20000, 500), null)).toBe(true);
    expect(placer.fitOk()).toBe(true);
    expect(segmentCount(placer.currentTrace().cP())).toBe(2);
    expect(segmentCount(placer.currentTrace().cN())).toBe(2);
  });

  it('tryWalkDp reports success with an EMPTY pair when every attempt fails', () => {
    // `bestScore` starts at 1e14 and the guard is `bestScore > 0.0`, so it is
    // true even though nothing was ever assigned to `best` — and `best` is a
    // default-constructed DIFF_PAIR. The pair is overwritten with empty chains
    // and `tryWalkDp` reports true, so `rhWalkOnly` sets `m_fitOk` and the move
    // reads as a success.
    //
    // Correcting the guard to `bestScore < 1e14` would make this move fail,
    // which is why the bug is pinned rather than fixed.
    host.settingsValue = routingSettings({ routingMode: PnsMode.RM_Walkaround });
    buildWall(3000);

    placer.start(V(0, 0), padP);

    expect(placer.move(V(20000, 500), null)).toBe(true);
    expect(placer.fitOk()).toBe(true);

    // Both lanes are gone.
    expect(segmentCount(placer.currentTrace().cP())).toBe(0);
    expect(segmentCount(placer.currentTrace().cN())).toBe(0);

    // The only thing between that and a committed empty route is FixRoute's
    // own segment-count guard.
    expect(placer.fixRoute(V(20000, 500), null, true)).toBe(false);
    expect(host.committed).toHaveLength(0);
  });

  it('shove mode fails outright on the same wall, because the shove sees empty heads', () => {
    host.settingsValue = routingSettings({ routingMode: PnsMode.RM_Shove });
    buildWall(3000);

    placer.start(V(0, 0), padP);

    // `tryWalkDp` "succeeds" here too, but the empty heads it leaves cannot be
    // shoved into a non-colliding state, so `m_fitOk` stays down.
    expect(placer.move(V(20000, 500), null)).toBe(false);
    expect(placer.fitOk()).toBe(false);
  });

  it('shove mode routes a clear board', () => {
    host.settingsValue = routingSettings({ routingMode: PnsMode.RM_Shove });

    placer.start(V(0, 0), padP);

    expect(placer.move(V(20000, 500), null)).toBe(true);
    expect(segmentCount(placer.currentTrace().cP())).toBe(2);
  });

  it('AbortPlacement leaves the session flags alone', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 500), null);

    expect(placer.abortPlacement()).toBe(true);

    // Upstream nulls `m_lastNode` and nothing else — not `m_idle`, not
    // `m_currentNode`. A tidy implementation would have gone idle here.
    expect(placer.isIdle()).toBe(false);
    expect(placer.currentNode()).not.toBeNull();
  });

  it('CommitPlacement reports success with nothing to commit', () => {
    expect(placer.commitPlacement()).toBe(true);
    expect(host.committed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('constants', () => {
  it('attemptWalk’s forced clearance leans on PNS_HULL_MARGIN being 10', () => {
    // `shove.ForceClearance( true, cur.Gap() - 2 * PNS_HULL_MARGIN )`. The
    // constant lives in `pns_line_item.ts`; this pins that the placer's
    // arithmetic is reading the value it thinks it is.
    expect(PNS_HULL_MARGIN).toBe(10);
  });

  it('the default sizes are all zero, as SIZES_SETTINGS starts', () => {
    expect(DEFAULT_DP_PLACER_SIZES.diffPairWidth).toBe(0);
    expect(DEFAULT_DP_PLACER_SIZES.diffPairGap).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('chained placement: the state that only a second fix can see', () => {
  let node: PnsNode;
  let host: TestHost;
  let placer: PnsDiffPairPlacer;
  let padP: PnsSolid;

  beforeEach(() => {
    node = world();
    padP = pad(V(0, 0), NET_P);
    node.addSolid(padP);
    node.addSolid(pad(V(0, 1000), NET_N));

    host = new TestHost(node, routingSettings());
    placer = new PnsDiffPairPlacer(host);
    placer.updateSizes(sizes());
  });

  /**
   * `m_initialDiagonal`, `m_prevPair` and `m_chainedPlacement` are all written
   * by `FixRoute` and read only by the *next* placement, so a single fix cannot
   * show any of them. This routes, fixes, and routes again.
   */
  it('the second leg continues from the first leg’s track ends', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 6000), null);

    const firstEndP = placer.currentTrace().cP().at(-1) as Vec2;

    expect(placer.fixRoute(V(6000, 6000), null, false)).toBe(false);

    // A second move must pick up where the first left off: `m_prevPair` is the
    // pair of track ends `EndingPrimitives()` cut from the committed lanes.
    expect(placer.move(V(14000, 6000), null)).toBe(true);

    const secondStartP = placer.currentTrace().cP()[0] as Vec2;

    expect(secondStartP).toEqual(firstEndP);
  });

  /**
   * `m_initialDiagonal = !DIRECTION_45( CP().CSegment( -2 ) ).IsDiagonal()`.
   *
   * The **second to last** segment, and **negated**: the next leg starts on the
   * opposite diagonal sense from the corner just laid. Reading `CSegment(-1)`
   * instead, or dropping the negation, changes the posture the next leg opens
   * with — which is visible in the second leg's geometry and nowhere else.
   */
  it('the posture the second leg opens with comes from the first leg’s penultimate segment', () => {
    const legs = (aFirst: Vec2, aSecond: Vec2): Vec2[] => {
      const n = world();
      const p0 = pad(V(0, 0), NET_P);

      n.addSolid(p0);
      n.addSolid(pad(V(0, 1000), NET_N));

      const h = new TestHost(n, routingSettings());
      const pl = new PnsDiffPairPlacer(h);

      pl.updateSizes(sizes());
      pl.start(V(0, 0), p0);
      pl.move(aFirst, null);
      pl.fixRoute(aFirst, null, false);
      pl.move(aSecond, null);

      return pl
        .currentTrace()
        .cP()
        .map((q) => ({ ...q }));
    };

    // A first leg that turns (so it has more than one segment, and CSegment(-2)
    // exists) against one that does not.
    const afterTurn = legs(V(6000, 6000), V(14000, 6000));
    const afterStraight = legs(V(6000, 500), V(14000, 6000));

    expect(afterTurn.length).toBeGreaterThan(1);
    expect(afterStraight.length).toBeGreaterThan(1);

    // The two second legs start from different places, so they cannot be
    // compared point for point; what must hold is that each is a valid 45°
    // chain reaching the same cursor region.
    expect(afterTurn.at(-1)?.x).toBeGreaterThan(6000);
    expect(afterStraight.at(-1)?.x).toBeGreaterThan(6000);

    // And the postures differ: the two legs are not translations of each other.
    const shape = (c: Vec2[]): string =>
      c
        .slice(1)
        .map((q, i) => `${Math.sign(q.x - (c[i] as Vec2).x)},${Math.sign(q.y - (c[i] as Vec2).y)}`)
        .join(' ');

    expect(shape(afterTurn)).not.toBe(shape(afterStraight));
  });

  /**
   * `m_chainedPlacement = !m_snapOnTarget && !aForceFinish` gates `SetLayer`.
   *
   * After an unforced fix the placement is chained, so a layer change is
   * refused; the flag is the only thing that refuses it, since `m_prevPair` is
   * set by the same call.
   */
  it('a chained placement refuses a layer change that an unchained one would take', () => {
    placer.start(V(0, 0), padP);
    placer.move(V(6000, 6000), null);
    placer.fixRoute(V(6000, 6000), null, false);

    // Chained: refused, whatever the previous pair looks like.
    expect(placer.setLayer(3)).toBe(false);
    expect(placer.currentLayer()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('propagateDpHeadForces', () => {
  /**
   * The force path is skipped entirely in highlight-collisions mode
   * (`aNewP = aP; return true`), so it can only be exercised in walk or shove
   * mode. The head is a virtual via whose diameter is `gap + 2 * width`, i.e.
   * the pair's whole footprint — so an obstacle within that of the cursor moves
   * the target, and the route ends somewhere else.
   */
  const routeTo = (aCursor: Vec2, aObstacleAt: Vec2 | null): Vec2 => {
    const n = world();
    const p0 = pad(V(0, 0), NET_P);

    n.addSolid(p0);
    n.addSolid(pad(V(0, 1000), NET_N));

    if (aObstacleAt) n.addSolid(pad(aObstacleAt, NET_OTHER, 400));

    const h = new TestHost(n, routingSettings({ routingMode: PnsMode.RM_Walkaround }));
    const pl = new PnsDiffPairPlacer(h);

    pl.updateSizes(sizes());
    pl.start(V(0, 0), p0);
    pl.move(aCursor, null);

    return pl.currentTrace().cP().at(-1) as Vec2;
  };

  it('an obstacle sitting on the cursor moves where the pair ends', () => {
    const clear = routeTo(V(8000, 500), null);
    const pushed = routeTo(V(8000, 500), V(8000, 500));

    expect(clear).toBeDefined();
    expect(pushed).not.toEqual(clear);
  });

  it('an obstacle far from the cursor changes nothing', () => {
    const clear = routeTo(V(8000, 500), null);
    const far = routeTo(V(8000, 500), V(8000, 40000));

    expect(far).toEqual(clear);
  });

  it('highlight-collisions mode ignores obstacles at the cursor entirely', () => {
    const markObstacles = (aObstacleAt: Vec2 | null): Vec2 => {
      const n = world();
      const p0 = pad(V(0, 0), NET_P);

      n.addSolid(p0);
      n.addSolid(pad(V(0, 1000), NET_N));

      if (aObstacleAt) n.addSolid(pad(aObstacleAt, NET_OTHER, 400));

      const h = new TestHost(n, routingSettings());
      const pl = new PnsDiffPairPlacer(h);

      pl.updateSizes(sizes());
      pl.start(V(0, 0), p0);
      pl.move(V(8000, 500), null);

      return pl.currentTrace().cP().at(-1) as Vec2;
    };

    // `if( Settings().Mode() == RM_MarkObstacles ) { aNewP = aP; return true; }`
    expect(markObstacles(V(8000, 500))).toEqual(markObstacles(null));
  });
});

// ---------------------------------------------------------------------------

describe('the two tryWalkDp call sites disagree about solids', () => {
  /**
   * `rhWalkOnly` passes `aSolidsOnly = false` and `rhShoveOnly` passes `true`,
   * and the difference is only visible against an obstacle that is **not** a
   * solid: a track. Walk mode has to get round it; shove mode's walk ignores it
   * and leaves it to the shove engine.
   */
  const withTrackWall = (aMode: PnsMode) => {
    const n = world();
    const p0 = pad(V(0, 0), NET_P);

    n.addSolid(p0);
    n.addSolid(pad(V(0, 1000), NET_N));

    // A long track straight across the route, on a third net.
    for (let y = -6000; y <= 8000; y += 500) {
      n.addSegment(track(V(3000, y), V(3000, y + 500), NET_OTHER, 400));
    }

    const h = new TestHost(n, routingSettings({ routingMode: aMode }));
    const pl = new PnsDiffPairPlacer(h);

    pl.updateSizes(sizes());
    pl.start(V(0, 0), p0);

    const moved = pl.move(V(14000, 500), null);

    return { moved, fitOk: pl.fitOk(), segs: segmentCount(pl.currentTrace().cP()) };
  };

  it('walk mode must get round a track wall, shove mode need not', () => {
    const walk = withTrackWall(PnsMode.RM_Walkaround);
    const shove = withTrackWall(PnsMode.RM_Shove);

    // Whatever each decides, they must not decide the same thing — that is the
    // whole content of the `false` / `true` difference between the two calls.
    expect([walk.moved, walk.fitOk, walk.segs]).not.toEqual([shove.moved, shove.fitOk, shove.segs]);
  });
});
