// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OPTIMIZER::Optimize( DIFF_PAIR* )` and the passes underneath it.
 * Counterpart: `pcbnew/router/pns_optimizer.cpp:1157-1374`.
 *
 * The pass has exactly two ways to accept a merge, and telling them apart is
 * most of what is worth pinning:
 *
 *  - **the coupled arm**, where a matching bypass is found on the other lane
 *    and both lanes shorten together;
 *  - **the uni-lateral arm**, where no such bypass exists and one lane is
 *    shortened alone, but only if the coupled length it loses fits in a budget
 *    of one tenth of what the pair had.
 *
 * The fixtures below are the same staircase in all three states — merged on
 * both lanes, merged on one, and refused — because the difference between them
 * is entirely in what the *other* lane can do, and that is the decision the
 * whole pass exists to make.
 *
 * ## What these tests do NOT pin
 *
 * A run of ten mutants over `pns_optimizer_diff_pair.ts` and the `Replace` /
 * `Remove` half of `pns_line_item.ts`, plus two controls (an inert `n - 2` →
 * `n - 1 - 1` and an inert brace, both of which survived, as a control must),
 * killed eight. The two survivors:
 *
 *  - **`findCoupledVertices`: `dist = |proj - vertex| - Width()` flipped to
 *    `+ Width()`.** Unobservable at any realistic geometry, because
 *    `DIFF_PAIR::SetGap` builds a **±10000 IU** tolerance band and the width
 *    only moves the measured distance by twice the track width — 400 IU for a
 *    200-wide pair. To see the difference you would have to place the coupled
 *    lane within one track width of the band's edge, ten millimetres off the
 *    intended gap, which is not a differential pair. The subtraction is right
 *    and it is also, at these scales, inert.
 *  - **`coupledBypass`: `delta > 1` loosened to `delta > 0`.** A span of one
 *    builds a bypass between two *adjacent* vertices of the coupled lane, and
 *    `BuildInitialTrace` between two points already one 45° segment apart is
 *    that same segment. `Replace` then trims both coincident endpoints, the
 *    range collapses to nothing, and the "new" chain is identical to the old —
 *    so the extra candidate is geometrically inert. It is *not* provably inert:
 *    it still sets `bestLength`, which can suppress a later, real bypass that
 *    scores lower. Contriving a fixture where that ordering matters would pin
 *    the scoring accident rather than the guard, so it is named instead.
 */
import { describe, expect, it } from 'vitest';
import {
  checkDpColliding,
  coupledBypass,
  findCoupledVertices,
  linesCollide,
  mergeDpSegments,
  mergeDpStep,
  optimizeDiffPair,
  verifyDpBypass,
} from '@ziroeda/pcbnew/src/router/pns_optimizer_diff_pair.js';
import { DiffPair } from '@ziroeda/pcbnew/src/router/pns_diff_pair.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import type { NetHandle, PnsRuleResolver } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });
const NET_P: NetHandle = { name: 'P' };
const NET_N: NetHandle = { name: 'N' };
const NET_GND: NetHandle = { name: 'GND' };

/** Everything `collideSimple` reaches for, and a clearance the caller picks. */
class Resolver implements PnsRuleResolver {
  constructor(private readonly value = 0) {}

  clearance(): number {
    return this.value;
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

  netCode(): number {
    return 1;
  }

  netName(): string {
    return 'net';
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

  queryConstraint() {
    return null;
  }
}

function world(aClearance = 0): PnsNode {
  const n = new PnsNode();

  n.setRuleResolver(new Resolver(aClearance));
  n.setMaxClearance(10000);

  return n;
}

function pair(aP: Vec2[], aN: Vec2[]): DiffPair {
  const dp = new DiffPair(aP, aN);

  dp.setWidth(200);
  dp.setGap(500);
  dp.setNets(NET_P, NET_N);
  dp.setLayers(new PnsLayerRange(0));

  return dp;
}

function blocker(aAt: Vec2, aR = 400): PnsSolid {
  const s = new PnsSolid();

  s.setNet(NET_GND);
  s.setLayers(new PnsLayerRange(0));
  s.setShape({ kind: 'circle', c: V(0, 0), r: aR });
  s.setPos(aAt);

  return s;
}

/**
 * A staircase with an obtuse pair at segments 1 and 3: two runs east, a run
 * south, then a diagonal. Segment 1 is east and segment 3 is the diagonal, 45°
 * apart, which is what `mergeDpStep` looks for.
 */
const STAIRCASE = [V(0, 0), V(1000, 0), V(2000, 0), V(2000, 1000), V(3000, 2000), V(4000, 2000)];

/** The same staircase, offset by the pair's gap. */
const OFFSET = STAIRCASE.map((p) => V(p.x, p.y + 700));

/** What the staircase collapses to once segments 1..3 are bypassed. */
const MERGED = [V(0, 0), V(1000, 0), V(3000, 2000), V(4000, 2000)];

const MERGED_OFFSET = MERGED.map((p) => V(p.x, p.y + 700));

// ---------------------------------------------------------------------------

describe('findCoupledVertices', () => {
  it('records a segment whose parallel offset matches the pair gap plus the width', () => {
    // The distance tested is `|projection - vertex| - Width()`, and the gap
    // constraint is the ±10000 band `SetGap` builds. So a lane 700 away from a
    // 200-wide pair with a 500 gap matches: 700 - 200 = 500.
    const dp = pair([V(0, 0), V(1000, 0)], [V(0, 700), V(1000, 700)]);
    const coupled = PnsLineChain.fromPoints([V(0, 700), V(1000, 700), V(2000, 1700)]);

    expect(findCoupledVertices(V(0, 0), { a: V(0, 0), b: V(1000, 0) }, coupled, dp)).toEqual([0]);
  });

  it('skips a segment that is not approximately parallel to the reference', () => {
    // Segment 1 of the chain above is a diagonal; only the parallel segment 0
    // is a candidate, however close the diagonal happens to pass.
    const dp = pair([V(0, 0), V(1000, 0)], [V(0, 700), V(1000, 700)]);
    const coupled = PnsLineChain.fromPoints([V(0, 1700), V(1000, 700), V(2000, 700)]);

    expect(findCoupledVertices(V(0, 0), { a: V(0, 0), b: V(1000, 0) }, coupled, dp)).toEqual([1]);
  });

  it('measures to the infinite line, not to the segment', () => {
    // `SEG::LineProject` does not clamp, so a vertex well past the end of a
    // parallel segment still counts as coupled to it. Upstream's, and it is why
    // a short stub on the other lane can anchor a bypass that runs past it.
    const dp = pair([V(0, 0), V(1000, 0)], [V(0, 700), V(1000, 700)]);
    const coupled = PnsLineChain.fromPoints([V(50000, 700), V(51000, 700)]);

    expect(findCoupledVertices(V(0, 0), { a: V(0, 0), b: V(1000, 0) }, coupled, dp)).toEqual([0]);
  });

  it('rejects an offset outside the gap constraint band', () => {
    const dp = pair([V(0, 0), V(1000, 0)], [V(0, 700), V(1000, 700)]);
    const coupled = PnsLineChain.fromPoints([V(0, 40000), V(1000, 40000)]);

    expect(findCoupledVertices(V(0, 0), { a: V(0, 0), b: V(1000, 0) }, coupled, dp)).toEqual([]);
  });
});

describe('linesCollide (the local LINE::Collide( LINE* ), issue #484)', () => {
  it('answers true for two lines that cross', () => {
    // `PnsLine.collide()` itself cannot: `shape()` is null for a line, so
    // `collideSimple` bails before it ever looks at the geometry. That is
    // issue #484, and this helper is the local way round it.
    const dp = pair([V(0, 0), V(1000, 0)], [V(500, -500), V(500, 500)]);
    const w = world();

    const a = PnsLine.fromBase(dp.pLine(), PnsLineChain.fromPoints(dp.cP()));
    const b = PnsLine.fromBase(dp.nLine(), PnsLineChain.fromPoints(dp.cN()));

    expect(a.collide(b, w, a.layer())).toBe(false);
    expect(linesCollide(a, b, w, a.layer())).toBe(true);
  });

  it('answers false for two lines a clear distance apart', () => {
    const dp = pair([V(0, 0), V(1000, 0)], [V(0, 40000), V(1000, 40000)]);
    const w = world();

    const a = PnsLine.fromBase(dp.pLine(), PnsLineChain.fromPoints(dp.cP()));
    const b = PnsLine.fromBase(dp.nLine(), PnsLineChain.fromPoints(dp.cN()));

    expect(linesCollide(a, b, w, a.layer())).toBe(false);
  });

  it('respects the clearance the node resolves, not just the copper', () => {
    // Centre lines 700 apart, 200 wide: 500 of air. A clearance of 600 turns
    // that into a collision without either line moving.
    const dp = pair([V(0, 0), V(1000, 0)], [V(0, 700), V(1000, 700)]);

    const a = PnsLine.fromBase(dp.pLine(), PnsLineChain.fromPoints(dp.cP()));
    const b = PnsLine.fromBase(dp.nLine(), PnsLineChain.fromPoints(dp.cN()));

    expect(linesCollide(a, b, world(0), a.layer())).toBe(false);
    expect(linesCollide(a, b, world(600), a.layer())).toBe(true);
  });
});

describe('verifyDpBypass', () => {
  it('accepts two clear lanes', () => {
    const dp = pair(STAIRCASE, OFFSET);

    expect(
      verifyDpBypass(
        world(),
        dp,
        true,
        PnsLineChain.fromPoints(MERGED),
        PnsLineChain.fromPoints(MERGED_OFFSET),
      ),
    ).toBe(true);
  });

  it('refuses when the reference lane runs into something in the node', () => {
    const dp = pair(STAIRCASE, OFFSET);
    const w = world();

    w.addSolid(blocker(V(2000, 1000)));

    expect(
      verifyDpBypass(
        w,
        dp,
        true,
        PnsLineChain.fromPoints(MERGED),
        PnsLineChain.fromPoints(MERGED_OFFSET),
      ),
    ).toBe(false);
  });

  it('refuses when the two candidate lanes hit each other', () => {
    const dp = pair(STAIRCASE, OFFSET);

    expect(
      verifyDpBypass(
        world(),
        dp,
        true,
        PnsLineChain.fromPoints([V(0, 0), V(4000, 0)]),
        PnsLineChain.fromPoints([V(2000, -1000), V(2000, 1000)]),
      ),
    ).toBe(false);
  });
});

describe('coupledBypass', () => {
  it('finds the matching bypass on the other lane', () => {
    const dp = pair(STAIRCASE, OFFSET);
    const out = coupledBypass(
      world(),
      dp,
      true,
      PnsLineChain.fromPoints(MERGED),
      PnsLineChain.fromPoints([V(1000, 0), V(3000, 2000)]),
      PnsLineChain.fromPoints(OFFSET),
    );

    // Note what comes back: the *spliced* chain, not a tidied one. Vertex
    // (2000,1700) sits in the middle of the new diagonal and is collinear with
    // its neighbours; `mergeDpStep` runs `Simplify2` on the result before
    // storing it, and this function does not. Pinned as it is, because the
    // score `coupledBypass` ranks candidates by is computed on the raw bypass
    // and would move if this were simplified here.
    expect(out?.points()).toEqual([
      V(0, 700),
      V(1000, 700),
      V(2000, 1700),
      V(3000, 2700),
      V(4000, 2700),
    ]);
    expect(out?.simplify2().points()).toEqual(MERGED_OFFSET);
  });

  it('finds nothing when the other lane has no interior vertex far enough away', () => {
    // The `j` loop runs over interior vertices only and `delta > 1` throws away
    // spans of one, so a three-point coupled lane can offer no bypass at all.
    const dp = pair(STAIRCASE, [V(0, 700), V(1000, 700), V(3000, 2700)]);

    expect(
      coupledBypass(
        world(),
        dp,
        true,
        PnsLineChain.fromPoints(MERGED),
        PnsLineChain.fromPoints([V(1000, 0), V(3000, 2000)]),
        PnsLineChain.fromPoints(dp.cN()),
      ),
    ).toBeNull();
  });
});

describe('checkDpColliding', () => {
  // Dead upstream — defined, declared in no header, called from nowhere.
  // Ported by name; pinned so the port does not rot.
  it('reports what the node says about the chain worn as one lane', () => {
    const dp = pair(STAIRCASE, OFFSET);
    const w = world();

    w.addSolid(blocker(V(2000, 1000)));

    expect(checkDpColliding(w, dp, true, PnsLineChain.fromPoints(MERGED))).toBe(true);
    expect(
      checkDpColliding(w, dp, true, PnsLineChain.fromPoints([V(0, 40000), V(1000, 40000)])),
    ).toBe(false);
  });
});

describe('OPTIMIZER::mergeDpStep', () => {
  it('takes the coupled arm: both lanes shorten together', () => {
    const dp = pair(STAIRCASE, OFFSET);

    expect(mergeDpStep(world(), dp, true, 2)).toBe(true);
    expect(dp.cP()).toEqual(MERGED);
    expect(dp.cN()).toEqual(MERGED_OFFSET);
  });

  it('takes the uni-lateral arm when the other lane has no bypass to offer', () => {
    // The N lane is already in its merged shape and has only three points, so
    // `coupledBypass` can find nothing. The P merge is still accepted, because
    // it *gains* coupled length rather than losing any.
    const dp = pair(STAIRCASE, [V(0, 700), V(1000, 700), V(3000, 2700)]);

    expect(mergeDpStep(world(), dp, true, 2)).toBe(true);
    expect(dp.cP()).toEqual(MERGED);
    expect(dp.cN()).toEqual([V(0, 700), V(1000, 700), V(3000, 2700)]);
  });

  it('refuses when the bypass runs into an obstacle', () => {
    const dp = pair(STAIRCASE, OFFSET);
    const w = world();

    w.addSolid(blocker(V(2000, 1000)));

    expect(mergeDpStep(w, dp, false, 2)).toBe(false);
    expect(mergeDpStep(w, dp, true, 2)).toBe(false);
    expect(dp.cP()).toEqual(STAIRCASE);
    expect(dp.cN()).toEqual(OFFSET);
  });

  it('rewrites the N lane when aTryP is false', () => {
    // `SetShape`'s swap flag is `!aTryP`, which is what puts the rewritten
    // chain back where it came from. Swap it and the two lanes trade places.
    const dp = pair(OFFSET, STAIRCASE);

    expect(mergeDpStep(world(), dp, false, 2)).toBe(true);
    expect(dp.cN()).toEqual(MERGED);
    expect(dp.cP()).toEqual(MERGED_OFFSET);
  });

  it('never starts a merge at segment 0', () => {
    // `n` starts at 1 and the loop bound is `SegmentCount() - 1 - step`, so a
    // pair whose only obtuse join is at the very start is left alone. The
    // gateway lead-in is not the optimizer's to move.
    const p = [V(0, 0), V(1000, 0), V(2000, 1000), V(3000, 1000)];
    const dp = pair(
      p,
      p.map((q) => V(q.x, q.y + 700)),
    );

    expect(mergeDpStep(world(), dp, true, 1)).toBe(false);
    expect(dp.cP()).toEqual(p);
  });
});

describe('OPTIMIZER::mergeDpSegments / Optimize( DIFF_PAIR* )', () => {
  it('drives the staircase down to its merged form', () => {
    const dp = pair(STAIRCASE, OFFSET);

    expect(optimizeDiffPair(world(), dp)).toBe(true);
    expect(dp.cP()).toEqual(MERGED);
    expect(dp.cN()).toEqual(MERGED_OFFSET);
  });

  it('reports success even when it changed nothing', () => {
    // Upstream returns an unconditional `true` — it is not "did I improve
    // anything", it is "I ran". A caller reading it as the former would treat
    // an already-optimal pair as a failure.
    const p = [V(0, 0), V(1000, 0)];
    const dp = pair(p, [V(0, 700), V(1000, 700)]);

    expect(mergeDpSegments(world(), dp)).toBe(true);
    expect(dp.cP()).toEqual(p);
  });

  it('terminates on a pair with too few segments to step over', () => {
    const dp = pair([V(0, 0), V(1000, 0), V(2000, 1000)], [V(0, 700), V(1000, 700), V(2000, 1700)]);

    expect(optimizeDiffPair(world(), dp)).toBe(true);
  });

  it('leaves a pair alone when every candidate merge is blocked', () => {
    const dp = pair(STAIRCASE, OFFSET);
    const w = world();

    w.addSolid(blocker(V(2000, 1000)));

    expect(optimizeDiffPair(w, dp)).toBe(true);
    expect(dp.cP()).toEqual(STAIRCASE);
    expect(dp.cN()).toEqual(OFFSET);
  });
});
