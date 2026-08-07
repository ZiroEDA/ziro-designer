// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How much meander gets added, and how a chain is cut to put it there.
 * Counterpart: `pcbnew/router/pns_meander_placer_base.cpp`.
 *
 * `pns_meander.test.ts` pins the *shape* of a meander. This pins the *sizing*,
 * which is the other half of a correct tuning result and the half where a
 * plausible-looking change stays silent: a line whose meanders are all 5%
 * too tall still looks exactly like a tuned line.
 *
 * What each group is claiming:
 *
 *  - **binary search** — the failure code that is also an amplitude, the
 *    shared midpoint, the leaf tie-break, and that the left half wins;
 *  - **amplitude for length** — upstream's first-guess fast path, which
 *    validates against the *minimum*-amplitude shape and is therefore capable
 *    of returning an amplitude 122 229 IU off the target it was asked for;
 *  - **tuneLineLength** — the three passes, and above all that the third one
 *    re-divides the remaining overshoot every iteration, which is visible as
 *    the last meander of a tuned run carrying a slightly different amplitude
 *    from its siblings;
 *  - **chain splitting** — `SHAPE_LINE_CHAIN::Split`, including the reversal
 *    when the cursor is dragged backwards and the 2 IU candidacy threshold;
 *  - **placer base** — the two steppers, the clearance fallback that is a
 *    track width rather than zero, and the chain-extras bookkeeping whose
 *    "valid" flag is set even when the query failed.
 *
 * Lengths here are the port's own output, captured once and pinned. They are
 * checked against the geometry (`resize` to the returned amplitude, measure)
 * wherever the point of the test is that a number is *right*, rather than
 * merely stable.
 */
import { describe, expect, it } from 'vitest';
import {
  MeanderType,
  MeanderedLine,
  basicMeanderPlacer,
  defaultMeanderSettings,
} from '@ziroeda/pcbnew/src/router/pns_meander.js';
import type { MeanderSettings, MeanderShape } from '@ziroeda/pcbnew/src/router/pns_meander.js';
import {
  LENGTH_TARGET_TOLERANCE,
  PnsMeanderPlacerBase,
  PnsTuningStatus,
  chainSplitAt,
  chainSplitRange,
  findAmplitudeBinarySearch,
  findAmplitudeForLength,
  getSnappedStartPoint,
  segDistanceToPoint,
  segNearestPoint,
  segSide,
  tuneLineLength,
} from '@ziroeda/pcbnew/src/router/pns_meander_placer_base.js';
import type {
  MeanderPlacerHost,
  MeanderRouterIface,
} from '@ziroeda/pcbnew/src/router/pns_meander_placer_base.js';
import { PnsConstraintType } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };

/** A ten-millimetre baseline filled with default-settings meanders. */
function meanderedLine(aSettings: MeanderSettings = defaultMeanderSettings()): MeanderedLine {
  // `checkFit` says yes to everything: this is about sizing, not about DRC.
  const line = new MeanderedLine(
    basicMeanderPlacer(aSettings, 100000, () => true),
    false,
  );

  line.setWidth(200000);
  line.setBaselineOffset(0);
  line.meanderSegment({ a: V(0, 0), b: V(10000000, 0) }, false);

  return line;
}

/** Total elongation over the baseline, which is what `tuneLineLength` targets. */
const elongation = (aLine: MeanderedLine): number =>
  aLine.meanders().reduce((a, m) => a + (m.currentLength() - m.baselineLength()), 0);

const types = (aLine: MeanderedLine): MeanderType[] => aLine.meanders().map((m) => m.type());

/**
 * A stand-in shape whose length is a chosen function of amplitude.
 *
 * `findAmplitudeBinarySearch` touches a `MEANDER_SHAPE` through exactly two
 * methods, and its tie-break and failure code are properties of the *search*,
 * not of any geometry — a real meander cannot be made to straddle a target by
 * exactly equal errors on demand. This is the seam that makes those two
 * decisions observable directly.
 */
function shapeWithLength(aLengthOf: (aAmplitude: number) => number): {
  shape: MeanderShape;
  probes: number[];
} {
  const probes: number[] = [];
  let amplitude = 0;

  const stub = {
    resize(a: number): void {
      probes.push(a);
      amplitude = a;
    },
    currentLength(): number {
      return aLengthOf(amplitude);
    },
  };

  return { shape: stub as unknown as MeanderShape, probes };
}

// ---------------------------------------------------------------------------------

describe('findAmplitudeBinarySearch', () => {
  it('answers the maximum when the interval is a point', () => {
    const { shape, probes } = shapeWithLength(() => 0);

    // No measurement is taken at all: the degenerate interval returns first.
    expect(findAmplitudeBinarySearch(shape, 12345, 700, 700)).toBe(700);
    expect(probes).toEqual([]);
  });

  it('fails with 0 when the target is outside the reachable lengths', () => {
    const { shape } = shapeWithLength((a) => a * 10);

    // Below what the minimum amplitude already gives.
    expect(findAmplitudeBinarySearch(shape, 500, 100, 900)).toBe(0);
    // Above what the maximum amplitude can give.
    expect(findAmplitudeBinarySearch(shape, 100000, 100, 900)).toBe(0);
  });

  it('resolves an exactly straddled target upwards, not downwards', () => {
    const { shape } = shapeWithLength((a) => a);

    // Errors of -2 and +2 at the two ends: both inside the tolerance, equal in
    // magnitude. The comparison is strict (`<`), so the *larger* amplitude wins.
    expect(findAmplitudeBinarySearch(shape, 1500, 1498, 1502)).toBe(1502);

    // One unit off centre, and the nearer end wins as expected.
    expect(findAmplitudeBinarySearch(shape, 1499, 1498, 1502)).toBe(1498);
  });

  it('cannot distinguish a legitimate amplitude of 0 from its own failure', () => {
    // A degenerate interval at zero answers 0 because that is the amplitude...
    const { shape } = shapeWithLength(() => 12345);

    expect(findAmplitudeBinarySearch(shape, 12345, 0, 0)).toBe(0);

    // ...and a search that finds nothing answers 0 because that is the failure
    // code. `tuneLineLength`'s `if( amp < minAmpl )` clamp is what stands
    // between the two readings and a meander of no height.
    const { shape: other } = shapeWithLength((a) => a * 10);

    expect(findAmplitudeBinarySearch(other, 100000, 100, 900)).toBe(0);
  });

  it('measures the shared midpoint in both halves', () => {
    const { shape, probes } = shapeWithLength((a) => a);

    // The target is in the upper half, so the left half [0, 2000] fails and the
    // right half [2000, 4000] answers. 2000 is measured twice: once as the left
    // half's maximum and once as the right half's minimum.
    expect(findAmplitudeBinarySearch(shape, 3000, 0, 4000)).toBe(3000);
    expect(probes.filter((p) => p === 2000).length).toBeGreaterThan(1);
  });

  it('finds an amplitude within tolerance on a real meander', () => {
    const line = meanderedLine();
    const m = line.meanders()[1] as MeanderShape;

    const amp = findAmplitudeBinarySearch(m.clone(), 2200000, m.minAmplitude(), m.amplitude());

    expect(amp).toBe(834521);

    // And it really is within tolerance of what was asked for.
    const probe = m.clone();

    probe.resize(amp);
    expect(Math.abs(probe.currentLength() - 2200000)).toBeLessThan(LENGTH_TARGET_TOLERANCE);
  });
});

describe('findAmplitudeForLength', () => {
  it('leaves the shape it was asked about untouched', () => {
    const line = meanderedLine();
    const m = line.meanders()[1] as MeanderShape;

    findAmplitudeForLength(m, 2200000, m.minAmplitude(), m.amplitude());

    expect(m.amplitude()).toBe(1000000);
    expect(m.currentLength()).toBe(2530973);
  });

  it('agrees with the bisection when the first guess is rejected', () => {
    const line = meanderedLine();
    const m = line.meanders()[1] as MeanderShape;

    expect(findAmplitudeForLength(m, 2200000, m.minAmplitude(), m.amplitude())).toBe(834521);
  });

  it('validates its first guess against the wrong shape (upstream oddity 7)', () => {
    const line = meanderedLine();
    const m = line.meanders()[1] as MeanderShape;

    // The length this meander has at its *minimum* amplitude.
    const atMin = m.clone();

    atMin.setTargetBaselineLength(m.baselineLength());
    atMin.resize(m.minAmplitude());
    expect(atMin.currentLength()).toBe(1111237);

    // Ask for exactly that length. The right answer is the minimum amplitude,
    // and the bisection alone finds it.
    const bisected = m.clone();

    bisected.setTargetBaselineLength(m.baselineLength());
    expect(findAmplitudeBinarySearch(bisected, 1111237, m.minAmplitude(), m.amplitude())).toBe(
      200000,
    );

    // But the fast path fires — because it measures the minimum-amplitude
    // shape, which is trivially at the target — and returns the half-difference
    // guess instead, whose length is 122 229 IU too long.
    const amp = findAmplitudeForLength(m, 1111237, m.minAmplitude(), m.amplitude());

    expect(amp).toBe(290132);

    const probe = m.clone();

    probe.setTargetBaselineLength(m.baselineLength());
    probe.resize(amp);
    expect(probe.currentLength()).toBe(1233466);
    expect(probe.currentLength() - 1111237).toBe(122229);
  });

  it('pins the copy to the original baseline before searching', () => {
    const line = meanderedLine();
    const m = line.meanders()[1] as MeanderShape;

    // With the baseline pinned there is no amplitude that reaches 1 000 000,
    // so the search fails outright...
    expect(findAmplitudeForLength(m, 1000000, m.minAmplitude(), m.amplitude())).toBe(0);

    // ...while the same bisection on an unpinned copy trades baseline for
    // amplitude and claims to have found one.
    expect(findAmplitudeBinarySearch(m.clone(), 1000000, m.minAmplitude(), m.amplitude())).toBe(
      215478,
    );
  });
});

describe('tuneLineLength', () => {
  it('empties every meander when nothing may be added', () => {
    const line = meanderedLine();

    expect(elongation(line)).toBe(26703712);

    tuneLineLength(line, 0);

    expect(elongation(line)).toBe(0);
    expect(types(line).filter((t) => t !== MeanderType.MT_CORNER)).toEqual(
      Array<MeanderType>(15).fill(MeanderType.MT_EMPTY),
    );
  });

  it('empties everything for a negative elongation too', () => {
    const line = meanderedLine();

    tuneLineLength(line, -100);

    expect(elongation(line)).toBe(0);
  });

  it('leaves the line alone when even full amplitude falls short', () => {
    const line = meanderedLine();

    tuneLineLength(line, 40000000);

    // Pass 2 sees a negative reduction and returns before pass 3 runs.
    expect(elongation(line)).toBe(26703712);
    expect(
      line.meanders().every((m) => m.type() === MeanderType.MT_CORNER || m.amplitude() === 1000000),
    ).toBe(true);
  });

  it('closes a run with an end cap and empties the rest', () => {
    const line = meanderedLine();

    tuneLineLength(line, 5000000);

    expect(types(line)).toEqual([
      MeanderType.MT_CORNER,
      MeanderType.MT_START,
      MeanderType.MT_TURN,
      MeanderType.MT_FINISH,
      ...Array<MeanderType>(12).fill(MeanderType.MT_EMPTY),
      MeanderType.MT_CORNER,
    ]);

    expect(elongation(line)).toBe(4999998);
  });

  it('hands each meander its share of the overshoot, recomputed as it goes', () => {
    const line = meanderedLine();

    tuneLineLength(line, 5000000);

    const amps = line
      .meanders()
      .filter((m) => m.type() !== MeanderType.MT_CORNER && m.type() !== MeanderType.MT_EMPTY)
      .map((m) => m.amplitude());

    // The first two shrink to the same amplitude; the last is *different*,
    // because the share is re-divided after each one and it absorbs what the
    // first two could not give back exactly. A share computed once up front
    // would make all three equal.
    expect(amps).toEqual([970677, 970677, 970689]);
  });

  it('collapses a lone end cap that cannot shrink far enough', () => {
    const line = meanderedLine();

    // Small enough that one MT_SINGLE at its minimum tunable length would
    // already overshoot: the inner `>=` test empties it instead.
    tuneLineLength(line, 100000);

    expect(elongation(line)).toBe(0);
    expect(types(line)[1]).toBe(MeanderType.MT_EMPTY);
  });

  it('keeps a single meander when one fits', () => {
    const line = meanderedLine();

    tuneLineLength(line, 1000000);

    expect(types(line)[1]).toBe(MeanderType.MT_SINGLE);
    expect(elongation(line)).toBe(1000010);
    // Within the search's own 20 IU tolerance of the target, not exact.
    expect(Math.abs(elongation(line) - 1000000)).toBeLessThan(LENGTH_TARGET_TOLERANCE);
  });

  it('does not touch corners or arcs', () => {
    const line = meanderedLine();
    const corners = line.meanders().filter((m) => m.type() === MeanderType.MT_CORNER);

    expect(corners.length).toBe(2);

    tuneLineLength(line, 5000000);

    expect(line.meanders().filter((m) => m.type() === MeanderType.MT_CORNER).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------

describe('geometry helpers', () => {
  it('segNearestPoint clamps to the endpoints', () => {
    const s = { a: V(0, 0), b: V(1000, 0) };

    expect(segNearestPoint(s, V(500, 400))).toEqual(V(500, 0));
    expect(segNearestPoint(s, V(-100, 50))).toEqual(V(0, 0));
    expect(segNearestPoint(s, V(9999, 50))).toEqual(V(1000, 0));
    // A degenerate segment answers its own A end.
    expect(segNearestPoint({ a: V(7, 7), b: V(7, 7) }, V(0, 0))).toEqual(V(7, 7));
  });

  it('segDistanceToPoint floors, it does not round', () => {
    // Distance is exactly sqrt(2) ~ 1.414.
    expect(segDistanceToPoint({ a: V(0, 0), b: V(10, 0) }, V(5, 1))).toBe(1);
    expect(segDistanceToPoint({ a: V(0, 0), b: V(10, 0) }, V(5, 2))).toBe(2);
  });

  it('segSide reports a sign', () => {
    const s = { a: V(0, 0), b: V(1000, 0) };

    expect(segSide(s, V(500, 100))).toBe(1);
    expect(segSide(s, V(500, -100))).toBe(-1);
    expect(segSide(s, V(500, 0))).toBe(0);
  });

  it('getSnappedStartPoint snaps a segment anywhere and an arc to an end', () => {
    const s = new PnsSegment({ seg: { a: V(0, 0), b: V(1000, 0) }, width: 100 }, NET_A);

    expect(getSnappedStartPoint(s, V(400, 900))).toEqual(V(400, 0));
  });
});

describe('chainSplitAt', () => {
  const straight = (): PnsLineChain => PnsLineChain.fromPoints([V(0, 0), V(1000, 0), V(2000, 0)]);

  it('inserts a vertex at a point on a segment', () => {
    const c = straight();

    expect(chainSplitAt(c, V(500, 0))).toBe(1);
    expect(c.pointCount()).toBe(4);
    expect(c.cPoint(1)).toEqual(V(500, 0));
  });

  it('returns an existing vertex without duplicating it', () => {
    const c = straight();

    expect(chainSplitAt(c, V(1000, 0), true)).toBe(1);
    expect(c.pointCount()).toBe(3);
  });

  it('refuses a point more than a hair off the chain', () => {
    const c = straight();

    // The candidacy threshold is `dist < 2`, so 1 IU away is still a candidate
    // and 2 IU away is not.
    expect(chainSplitAt(c.clone(), V(500, 1))).toBe(1);
    expect(chainSplitAt(c, V(500, 2))).toBe(-1);
    expect(c.pointCount()).toBe(3);
  });

  it('will not split at a point that is already a segment end', () => {
    const c = straight();

    // `seg.A != aP && seg.B != aP` rules out both segments, so with no exact
    // match requested the vertex index is found and returned unchanged.
    expect(chainSplitAt(c, V(1000, 0))).toBe(1);
    expect(c.pointCount()).toBe(3);
  });
});

describe('chainSplitRange', () => {
  const straight = (): PnsLineChain =>
    PnsLineChain.fromPoints([V(0, 0), V(3000, 0), V(3000, 3000)]);

  it('cuts a chain into three at two on-chain points', () => {
    const { pre, mid, post } = chainSplitRange(straight(), V(1000, 0), V(2000, 0));

    expect(pre.points()).toEqual([V(0, 0), V(1000, 0)]);
    expect(mid.points()).toEqual([V(1000, 0), V(2000, 0)]);
    expect(post.points()).toEqual([V(2000, 0), V(3000, 0), V(3000, 3000)]);
  });

  it('snaps cut points that are off the chain', () => {
    const { mid } = chainSplitRange(straight(), V(1000, 700), V(2000, -700));

    expect(mid.points()).toEqual([V(1000, 0), V(2000, 0)]);
  });

  it('reverses the chain when the end lands before the start', () => {
    // The same two points in the other order: `pre` and `post` swap, because
    // the chain itself is reversed rather than the indices being sorted.
    const { pre, mid, post } = chainSplitRange(straight(), V(2000, 0), V(1000, 0));

    expect(pre.points()).toEqual([V(3000, 3000), V(3000, 0), V(2000, 0)]);
    expect(mid.points()).toEqual([V(2000, 0), V(1000, 0)]);
    expect(post.points()).toEqual([V(1000, 0), V(0, 0)]);
  });

  it('leaves the chain it was given alone', () => {
    const c = straight();

    chainSplitRange(c, V(1000, 0), V(2000, 0));

    expect(c.pointCount()).toBe(3);
  });
});

// ---------------------------------------------------------------------------------

/** A host that answers zero to everything, with hooks for the tests that care. */
function stubHost(aOver: Partial<MeanderPlacerHost & MeanderRouterIface> = {}): MeanderPlacerHost {
  const iface: MeanderRouterIface = {
    calculateRoutedPathLength: () => 0,
    calculateRoutedPathDelay: () => 0,
    calculateLengthForDelay: () => 0,
    calculateDelayForShapeLineChain: () => 0,
    getSignalAggregate: () => null,
    getNetBoardLength: () => 0,
    ...(aOver as Partial<MeanderRouterIface>),
  };

  return {
    iface: () => iface,
    world: () => new PnsNode(),
    diffPairGap: () => 0,
    routerLayer: () => 0,
    ruleResolver: () => null,
    commitRouting: () => undefined,
    setFailureReason: () => undefined,
    effectiveNetClass: () => null,
    assembleTuningPath: () => ({ path: new PnsItemSet(), startPad: null, endPad: null }),
    assembleDiffPair: () => null,
    ...(aOver as Partial<MeanderPlacerHost>),
  };
}

/** The smallest concrete `MEANDER_PLACER_BASE` the abstract methods allow. */
class BareBase extends PnsMeanderPlacerBase {
  traceItems = new PnsItemSet();
  nets: NetHandle[] = [NET_A];
  layer = 3;

  setWidth(aWidth: number): void {
    this.mCurrentWidth = aWidth;
  }

  setBaseline(aLength: number, aDelay = 0): void {
    this.mBaselineLength = aLength;
    this.mBaselineDelay = aDelay;
  }

  settingsRef(): MeanderSettings {
    return this.mSettings;
  }

  extras(): { length: number; delay: number; valid: boolean } {
    return {
      length: this.mChainExtrasLength,
      delay: this.mChainExtrasDelay,
      valid: this.mChainExtrasValid,
    };
  }

  runInitChainExtras(): void {
    this.initChainExtras();
  }

  offset(): number {
    return this.chainNarrowingOffset();
  }

  start(): boolean {
    return false;
  }
  move(): boolean {
    return false;
  }
  fixRoute(): boolean {
    return false;
  }
  commitPlacement(): boolean {
    return false;
  }
  abortPlacement(): boolean {
    return false;
  }
  hasPlacedAnything(): boolean {
    return false;
  }
  currentNode(): PnsNode | null {
    return null;
  }
  traces(): PnsItemSet {
    return this.traceItems;
  }
  tunedPath(): PnsItemSet {
    return new PnsItemSet();
  }
  currentStart(): Vec2 {
    return V(0, 0);
  }
  currentNets(): NetHandle[] {
    return this.nets;
  }
  currentLayer(): number {
    return this.layer;
  }
  tuningLengthResult(): number {
    return 4242;
  }
  tuningStatus(): PnsTuningStatus {
    return PnsTuningStatus.TUNED;
  }
}

function track(): PnsSegment {
  const s = new PnsSegment({ seg: { a: V(0, 0), b: V(1000, 0) }, width: 250000 }, NET_A);

  s.setLayers(new PnsLayerRange(0));

  return s;
}

describe('MEANDER_PLACER_BASE', () => {
  it('steps the amplitude by whole steps and floors it at the minimum', () => {
    const b = new BareBase(stubHost());

    b.amplitudeStep(1);
    expect(b.settingsRef().maxAmplitude).toBe(1050000);

    // The sign is a multiplier, not a direction flag.
    b.amplitudeStep(-3);
    expect(b.settingsRef().maxAmplitude).toBe(900000);

    // Driven all the way down, it stops at m_minAmplitude — not at zero.
    for (let i = 0; i < 50; i++) b.amplitudeStep(-1);

    expect(b.settingsRef().maxAmplitude).toBe(200000);
  });

  it('floors the spacing at one width plus one clearance', () => {
    const b = new BareBase(stubHost());

    b.setWidth(250000);
    b.traceItems = new PnsItemSet(track());

    // No rule resolver, so Clearance() falls back to the track width: the floor
    // is 250 000 + 250 000.
    for (let i = 0; i < 50; i++) b.spacingStep(-1);

    expect(b.settingsRef().spacing).toBe(500000);

    b.spacingStep(2);
    expect(b.settingsRef().spacing).toBe(600000);
  });

  it('falls back to the track width when there is no minimum clearance (oddity 12)', () => {
    const b = new BareBase(stubHost());

    b.setWidth(250000);
    b.traceItems = new PnsItemSet(track());

    // No resolver at all.
    expect(b.clearance()).toBe(250000);

    // A resolver that answers, but with no minimum.
    const noMin = new BareBase(
      stubHost({
        ruleResolver: () => ({
          queryConstraint: () => ({
            type: PnsConstraintType.CT_CLEARANCE,
            value: {},
            allowed: true,
            ruleName: '',
            fromName: '',
            toName: '',
            isTimeDomain: false,
          }),
        }),
      }),
    );

    noMin.setWidth(250000);
    noMin.traceItems = new PnsItemSet(track());
    expect(noMin.clearance()).toBe(250000);
  });

  it('asks the resolver about the first trace, on the placer layer', () => {
    const asked: { type: PnsConstraintType; itemB: PnsItem | null; layer: number }[] = [];

    const b = new BareBase(
      stubHost({
        ruleResolver: () => ({
          queryConstraint: (type, _a, itemB, layer) => {
            asked.push({ type, itemB, layer });

            return {
              type,
              value: { min: 123456 },
              allowed: true,
              ruleName: '',
              fromName: '',
              toName: '',
              isTimeDomain: false,
            };
          },
        }),
      }),
    );

    b.setWidth(250000);
    b.traceItems = new PnsItemSet(track());

    expect(b.clearance()).toBe(123456);
    expect(asked).toEqual([{ type: PnsConstraintType.CT_CLEARANCE, itemB: null, layer: 3 }]);
  });

  it('reports no baseline only when both length and delay are zero', () => {
    const b = new BareBase(stubHost());

    expect(b.hasBaseline()).toBe(false);

    b.setBaseline(0, 5);
    expect(b.hasBaseline()).toBe(true);

    b.setBaseline(5, 0);
    expect(b.hasBaseline()).toBe(true);
  });

  it('takes both deltas against the captured baseline', () => {
    const b = new BareBase(stubHost());

    b.setBaseline(4000, 90);

    expect(b.tuningLengthDelta()).toBe(4242 - 4000);
    // TuningDelayResult() is 0 in the base class, so the delay delta is -90.
    expect(b.tuningDelayResult()).toBe(0);
    expect(b.tuningDelayDelta()).toBe(-90);
  });

  it('refuses every fit in the base class', () => {
    const b = new BareBase(stubHost());

    expect(b.checkFit({} as unknown as MeanderShape)).toBe(false);
  });

  it('copies the settings it is given rather than aliasing them', () => {
    const b = new BareBase(stubHost());
    const mine = defaultMeanderSettings();

    b.updateSettings(mine);
    b.amplitudeStep(1);

    expect(mine.maxAmplitude).toBe(1000000);
    expect(b.settingsRef().maxAmplitude).toBe(1050000);
  });

  describe('chain extras', () => {
    it('asks about (net, net) when there is only one net', () => {
      const asked: NetHandle[][] = [];

      const b = new BareBase(
        stubHost({
          getSignalAggregate: (a, c) => {
            asked.push([a, c]);

            return { length: 700, delay: 8 };
          },
        }),
      );

      b.runInitChainExtras();

      expect(asked).toEqual([[NET_A, NET_A]]);
      expect(b.extras()).toEqual({ length: 700, delay: 8, valid: true });
    });

    it('asks about the first two when there are two', () => {
      const netB: NetHandle = { name: 'B' };
      const asked: NetHandle[][] = [];

      const b = new BareBase(
        stubHost({
          getSignalAggregate: (a, c) => {
            asked.push([a, c]);

            return null;
          },
        }),
      );

      b.nets = [NET_A, netB, { name: 'C' }];
      b.runInitChainExtras();

      expect(asked).toEqual([[NET_A, netB]]);
    });

    it('stays invalid only when there are no nets at all', () => {
      const b = new BareBase(stubHost());

      b.nets = [];
      b.runInitChainExtras();

      expect(b.extras().valid).toBe(false);
      expect(b.offset()).toBe(0);
    });

    it('counts as valid even when the query failed (oddity 11)', () => {
      const b = new BareBase(stubHost({ getNetBoardLength: () => 9000 }));

      b.setBaseline(1000);
      b.runInitChainExtras();

      expect(b.extras()).toEqual({ length: 0, delay: 0, valid: true });

      // Which is not the same as never having asked: the offset is now the
      // unmeasured stub rather than a flat zero.
      expect(b.offset()).toBe(8000);
    });

    it('adds the unmeasured stub to the siblings aggregate, clamped at zero', () => {
      const b = new BareBase(
        stubHost({
          getSignalAggregate: () => ({ length: 500, delay: 0 }),
          getNetBoardLength: () => 9000,
        }),
      );

      b.setBaseline(1000);
      b.runInitChainExtras();
      expect(b.offset()).toBe(500 + 8000);

      // A baseline longer than the board length contributes nothing, not a
      // negative.
      b.setBaseline(12000);
      expect(b.offset()).toBe(500);
    });
  });
});
