// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three length tuners, driven end to end over a real `PNS::NODE`.
 * Counterparts: `pcbnew/router/pns_meander_placer.cpp`,
 * `pns_dp_meander_placer.cpp` and `pns_meander_skew_placer.cpp`.
 *
 * `pns_meander_placer_base.test.ts` pins the arithmetic in isolation. This
 * pins the pipeline: pick up a track, drag a cursor along it, and check that
 * what comes out is a longer track of the length that was asked for — and that
 * the three status verdicts are reached for the three reasons they exist.
 *
 * What is worth pinning:
 *
 *  - **`Start` is ordered.** The tuning path is measured before the origin line
 *    is taken out of the world, and the baseline after; both pads contribute
 *    pad-to-die, and the single-ended placer files its one net's pads in the
 *    `_n` slots.
 *  - **`doMove` bails on a target it can never meet**, and when it does, the
 *    final shape is the *original* geometry rather than an empty one.
 *  - **The clearance each placer checks a meander against is not the same
 *    number**: `w + spacing` single-ended, `w + 3w` for a pair, with the
 *    spacing setting ignored in the second.
 *  - **The skew placer subtracts the chain offset from its target**, so a pair
 *    that belongs to a chain does not get meandered twice for the same budget.
 *  - **A skew is not a length**: `TuningLengthResult` on the skew placer is a
 *    difference, and the chain aggregate cancels out of it.
 *
 * The host is a stub because `ROUTER_IFACE` measures against a live `BOARD`;
 * the length function here is the honest one — the summed length of the lines
 * in the item set — so the numbers below are real geometry, not fixtures.
 */
import { describe, expect, it } from 'vitest';
import { DiffPair } from '@ziroeda/pcbnew/src/router/pns_diff_pair.js';
import {
  MeanderType,
  defaultMeanderSettings,
  setTargetLength,
  setTargetSkew,
} from '@ziroeda/pcbnew/src/router/pns_meander.js';
import type { MeanderShape, MeanderSettings } from '@ziroeda/pcbnew/src/router/pns_meander.js';
import { PnsDpMeanderPlacer } from '@ziroeda/pcbnew/src/router/pns_dp_meander_placer.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsMeanderPlacer } from '@ziroeda/pcbnew/src/router/pns_meander_placer.js';
import { PnsMeanderSkewPlacer } from '@ziroeda/pcbnew/src/router/pns_meander_skew_placer.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsTuningStatus } from '@ziroeda/pcbnew/src/router/pns_meander_placer_base.js';
import type {
  MeanderPlacerHost,
  MeanderRouterIface,
} from '@ziroeda/pcbnew/src/router/pns_meander_placer_base.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { PnsItem, PnsLinkedItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { PnsNode as PnsNodeT } from '@ziroeda/pcbnew/src/router/pns_node.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const MM = 1000000;
const WIDTH = 250000;

const NET_P: NetHandle = { name: 'P' };
const NET_N: NetHandle = { name: 'N' };

function seg(a: Vec2, b: Vec2, aNet: NetHandle = NET_P): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: WIDTH }, aNet);

  s.setLayers(new PnsLayerRange(0));

  return s;
}

/** The summed length of every `LINE` in a set — what `CalculateRoutedPathLength` does. */
function setLength(aSet: PnsItemSet): number {
  let l = 0;

  for (const item of aSet.citems()) {
    if (item.kind() === PnsKind.LINE_T) l += (item as PnsLine).cLine().length();
  }

  return l;
}

interface HostOpts {
  world: PnsNode;
  pair?: DiffPair;
  /**
   * Answers for `AssembleTuningPath`, in call order. The differential-pair
   * fixtures need it: a `DIFF_PAIR` built by hand carries no links, so its
   * lanes reach the assembler as nulls (see the host method's own note) and
   * there is nothing for a real assembly to walk.
   */
  paths?: PnsItemSet[];
  aggregate?: { length: number; delay: number } | null;
  netBoardLength?: number;
  startPad?: PnsSolid | null;
  endPad?: PnsSolid | null;
  delayPerIu?: number;
}

interface HostSpy {
  host: MeanderPlacerHost;
  committed: PnsNodeT[];
  failures: string[];
}

/**
 * A `ROUTER` + `ROUTER_IFACE` stub. Lengths are measured for real; delays are a
 * linear function of length so the time-domain arms have something monotone to
 * work with.
 */
function makeHost(aOpts: HostOpts): HostSpy {
  const committed: PnsNodeT[] = [];
  const failures: string[] = [];
  const perIu = aOpts.delayPerIu ?? 0;
  const queued = [...(aOpts.paths ?? [])];

  const iface: MeanderRouterIface = {
    calculateRoutedPathLength: (line) => setLength(line),
    calculateRoutedPathDelay: (line) => setLength(line) * perIu,
    calculateLengthForDelay: (delay) => (perIu === 0 ? 0 : Math.trunc(delay / perIu)),
    calculateDelayForShapeLineChain: (chain) => chain.length() * perIu,
    getSignalAggregate: () => aOpts.aggregate ?? null,
    getNetBoardLength: () => aOpts.netBoardLength ?? 0,
  };

  const host: MeanderPlacerHost = {
    iface: () => iface,
    world: () => aOpts.world,
    diffPairGap: () => 200000,
    routerLayer: () => 0,
    ruleResolver: () => null,
    commitRouting: (node) => {
      committed.push(node);
    },
    setFailureReason: (reason) => {
      failures.push(reason);
    },
    effectiveNetClass: () => 'Default',
    assembleTuningPath: (node, item) => ({
      path: queued.length
        ? (queued.shift() as PnsItemSet)
        : item
          ? new PnsItemSet(node.assembleLine(item))
          : new PnsItemSet(),
      startPad: aOpts.startPad ?? null,
      endPad: aOpts.endPad ?? null,
    }),
    assembleDiffPair: () => aOpts.pair ?? null,
  };

  return { host, committed, failures };
}

/** A one-item tuning path holding a straight line of the given length. */
function pathOfLength(aLength: number, aNet: NetHandle): PnsItemSet {
  const l = new PnsLine();

  l.setShape(PnsLineChain.fromPoints([V(0, 0), V(aLength, 0)]));
  l.setWidth(WIDTH);
  l.setNet(aNet);

  return new PnsItemSet(l);
}

/** Settings with a length target and enough room to meander. */
function tuningSettings(aTarget: number): MeanderSettings {
  const s = defaultMeanderSettings();

  setTargetLength(s, aTarget);

  return s;
}

/** A straight 20 mm track, and the placer already `Start`ed on it. */
function straightTrack(
  aSettings: MeanderSettings,
  aOpts: Partial<HostOpts> & { startAt?: Vec2 } = {},
) {
  const world = new PnsNode();
  const track = seg(V(0, 0), V(20 * MM, 0));

  world.addSegment(track);

  const spy = makeHost({ world, ...aOpts });
  const placer = new PnsMeanderPlacer(spy.host);

  placer.updateSettings(aSettings);

  const started = placer.start(aOpts.startAt ?? V(0, 0), track);

  return { world, track, placer, started, ...spy };
}

const finalLength = (aPlacer: { traces(): PnsItemSet }): number => setLength(aPlacer.traces());

// ---------------------------------------------------------------------------------

describe('MEANDER_PLACER', () => {
  it('refuses anything that is not a track', () => {
    const world = new PnsNode();
    const { host, failures } = makeHost({ world });
    const placer = new PnsMeanderPlacer(host);

    expect(placer.start(V(0, 0), null)).toBe(false);
    expect(placer.start(V(0, 0), new PnsSolid())).toBe(false);
    expect(failures).toEqual([
      'Please select a track whose length you want to tune.',
      'Please select a track whose length you want to tune.',
    ]);
  });

  it('captures the baseline before it starts, pads included', () => {
    const startPad = new PnsSolid();
    const endPad = new PnsSolid();

    startPad.setPadToDie(300000);
    endPad.setPadToDie(500000);

    const s = tuningSettings(25 * MM);

    s.signalExtraLength = 70000;

    const { placer, started } = straightTrack(s, { startPad, endPad });

    expect(started).toBe(true);
    expect(placer.hasBaseline()).toBe(true);
    // 20 mm of track, both pads' pad-to-die, and the extra signal length.
    expect(placer.tuningLengthResult()).toBe(20 * MM + 300000 + 500000 + 70000);
  });

  it('takes the origin line out of its private branch, not out of the world', () => {
    const { world, placer, track } = straightTrack(tuningSettings(25 * MM));

    // The root still holds the track...
    expect(world.allItemsInNet(NET_P).has(track)).toBe(true);
    // ...and the branch the placer works on does not.
    expect(placer.currentNode()?.allItemsInNet(NET_P).has(track)).toBe(false);
  });

  it('reports the layer of the picked-up segment and its one net', () => {
    const { placer } = straightTrack(tuningSettings(25 * MM));

    expect(placer.currentLayer()).toBe(0);
    expect(placer.currentNets()).toEqual([NET_P]);
  });

  it('does nothing when the cursor has not left the start point', () => {
    const { placer } = straightTrack(tuningSettings(25 * MM));

    expect(placer.move(V(0, 0), null)).toBe(false);
  });

  it('meanders a straight track up to the length asked for', () => {
    const { placer } = straightTrack(tuningSettings(25 * MM));

    expect(placer.move(V(20 * MM, 0), null)).toBe(true);
    expect(placer.tuningStatus()).toBe(PnsTuningStatus.TUNED);

    // The tuned result really is 25 mm of copper — to 24 IU, which is the
    // amplitude search's own 20 IU tolerance showing through, not slack in the
    // test. Pinned exactly so a change in the sizing arithmetic cannot hide
    // inside a range.
    expect(placer.tuningLengthResult()).toBe(25 * MM + 24);
    expect(finalLength(placer)).toBe(25 * MM + 24);
  });

  it('reports TOO_SHORT when the whole track cannot be stretched that far', () => {
    // 20 mm of baseline cannot become a metre.
    const { placer } = straightTrack(tuningSettings(1000 * MM));

    placer.move(V(20 * MM, 0), null);

    expect(placer.tuningStatus()).toBe(PnsTuningStatus.TOO_SHORT);
    // Everything that would fit is used, so the result is the *maximum* the
    // geometry allows, not the target and not the original.
    expect(placer.tuningLengthResult()).toBeGreaterThan(20 * MM);
  });

  it('bails to TOO_LONG before tuning, leaving the original geometry alone', () => {
    // A target below the untuned length: the early bail fires and the meanders
    // that were generated are discarded rather than being appended.
    const { placer } = straightTrack(tuningSettings(5 * MM));

    placer.move(V(20 * MM, 0), null);

    expect(placer.tuningStatus()).toBe(PnsTuningStatus.TOO_LONG);
    expect(placer.tuningLengthResult()).toBe(20 * MM);
    expect(finalLength(placer)).toBe(20 * MM);
  });

  it('places nothing until the route is fixed, then commits the branch', () => {
    const { placer, committed } = straightTrack(tuningSettings(25 * MM));

    expect(placer.hasPlacedAnything()).toBe(false);

    placer.move(V(20 * MM, 0), null);

    // `Traces()` rebuilds the current trace as a side effect, which is what
    // makes `HasPlacedAnything` true even before a fix.
    placer.traces();
    expect(placer.hasPlacedAnything()).toBe(true);

    const branch = placer.currentNode();

    expect(placer.fixRoute(V(20 * MM, 0), null)).toBe(true);
    expect(committed).toEqual([branch]);
    // After the commit there is no branch left, so the world answers instead.
    expect(placer.currentNode()).not.toBe(branch);
  });

  it('will not fix a route it never moved', () => {
    const { placer } = straightTrack(tuningSettings(25 * MM));

    expect(placer.fixRoute(V(20 * MM, 0), null)).toBe(false);
  });

  it('keeps the endpoints out of the simplification when asked (oddity 15)', () => {
    // Tuned from 2 mm to 18 mm, so there is untuned track either side and the
    // joins between the three parts are real vertices.
    const run = (aKeep: boolean): Vec2[] => {
      const s = tuningSettings(22 * MM);

      s.keepEndpoints = aKeep;

      const { placer } = straightTrack(s, { startAt: V(2 * MM, 0) });

      placer.move(V(18 * MM, 0), null);

      return (placer.traces().citems()[0] as PnsLine).cLine().points();
    };

    const plain = run(false);
    const kept = run(true);

    const has18mm = (aPts: Vec2[]): boolean => aPts.some((q) => q.x === 18 * MM && q.y === 0);

    // The vertex where the tuned stretch rejoins the track is colinear with the
    // run after it, so simplifying the *concatenation* dissolves it — and the
    // endpoint the user asked to keep moves 2 mm. Simplifying the three parts
    // one at a time cannot see across the join, so it survives.
    expect(has18mm(kept)).toBe(true);
    expect(has18mm(plain)).toBe(false);
    expect(kept.length).toBe(plain.length + 1);
  });

  it('will not meander through an obstacle', () => {
    const { world, track } = (() => {
      const w = new PnsNode();
      const t = seg(V(0, 0), V(20 * MM, 0));

      w.addSegment(t);

      // Walls 0.4 mm either side of the track, on other nets: there is nowhere
      // for a meander of any amplitude to go.
      w.addSegment(seg(V(0, -400000), V(20 * MM, -400000), { name: 'above' }));
      w.addSegment(seg(V(0, 400000), V(20 * MM, 400000), { name: 'below' }));

      return { world: w, track: t };
    })();

    const spy = makeHost({ world });
    const placer = new PnsMeanderPlacer(spy.host);

    placer.updateSettings(tuningSettings(25 * MM));
    placer.start(V(0, 0), track);
    placer.move(V(20 * MM, 0), null);

    // Nothing fits, so the track comes back its original length.
    expect(placer.tuningStatus()).toBe(PnsTuningStatus.TOO_SHORT);
    expect(finalLength(placer)).toBe(20 * MM);
  });

  it('narrows a chain-wide target down to this net s share', () => {
    const s = tuningSettings(25 * MM);

    // A chain target of 30 mm, of which 4 mm belongs to sibling nets and
    // 1 mm is an unmeasured stub on this net.
    s.targetSignalLength = { min: 29 * MM, opt: 30 * MM, max: 31 * MM };
    s.targetLength = {
      min: 1000000 * MM,
      opt: 1000000 * MM,
      max: 1000000 * MM,
    };

    const { placer } = straightTrack(s, {
      aggregate: { length: 4 * MM, delay: 0 },
      netBoardLength: 21 * MM,
    });

    placer.move(V(20 * MM, 0), null);

    // 30 mm - (4 mm siblings + 1 mm stub) = 25 mm for the meander.
    expect(placer.meanderSettings().targetLength).toEqual({
      min: 24 * MM,
      opt: 25 * MM,
      max: 26 * MM,
    });
    expect(placer.tuningLengthResult()).toBe(25 * MM + 24);
  });

  it('checks a meander against one width plus one spacing', () => {
    const { placer } = straightTrack(tuningSettings(25 * MM));

    placer.move(V(20 * MM, 0), null);

    const shape = spyOnSelfIntersections(placer);

    expect(placer.checkFit(shape.shape)).toBe(true);
    expect(shape.clearances).toEqual([WIDTH + defaultMeanderSettings().spacing]);
  });
});

/**
 * Swap the placer's `MEANDERED_LINE` for a recorder, and hand back a meander
 * shape to feed it.
 *
 * The clearance a placer checks a meander at is not visible in its output —
 * `CheckSelfIntersections` either passes or does not — so it is read off the
 * call itself. The two placers pass different formulas and that difference is
 * the whole of upstream oddity 16.
 */
function spyOnSelfIntersections(aPlacer: object): {
  shape: MeanderShape;
  clearances: number[];
} {
  const clearances: number[] = [];
  const line = new PnsLine();

  line.setWidth(WIDTH);

  const shape = {
    cLine: () => line.cLine(),
    width: () => WIDTH,
    type: () => MeanderType.MT_SINGLE,
  } as unknown as MeanderShape;

  (aPlacer as { mResult: unknown }).mResult = {
    checkSelfIntersections: (_s: MeanderShape, aClearance: number) => {
      clearances.push(aClearance);

      return true;
    },
  };

  return { shape, clearances };
}

// ---------------------------------------------------------------------------------

/**
 * Two lanes 400 000 IU apart, running 20 mm along X.
 *
 * The lanes are deliberately *not* added to the node: upstream's `Start()`
 * removes the pair from its branch before any meander is fitted, and a
 * hand-built `DIFF_PAIR` has no links for `Remove` to follow. Leaving them out
 * puts the branch in the state the real flow reaches.
 */
function makePair(aGap = 150000): { pair: DiffPair; world: PnsNode; track: PnsSegment } {
  const world = new PnsNode();
  const trackP = seg(V(0, 0), V(20 * MM, 0), NET_P);

  const pair = new DiffPair();

  pair.setWidth(WIDTH);
  pair.setGap(aGap);
  pair.setNets(NET_P, NET_N);
  pair.setShape([V(0, 0), V(20 * MM, 0)], [V(0, 400000), V(20 * MM, 400000)]);

  return { pair, world, track: trackP };
}

/** The two lanes' tuning paths, P first as `Start()` asks for them. */
const pairPaths = (aLenP = 20 * MM, aLenN = 20 * MM): PnsItemSet[] => [
  pathOfLength(aLenP, NET_P),
  pathOfLength(aLenN, NET_N),
];

describe('DP_MEANDER_PLACER', () => {
  it('refuses a track with no complementary net', () => {
    const world = new PnsNode();
    const track = seg(V(0, 0), V(20 * MM, 0));

    world.addSegment(track);

    const { host, failures } = makeHost({ world });
    const placer = new PnsDpMeanderPlacer(host);

    expect(placer.start(V(0, 0), track)).toBe(false);
    expect(failures[0]).toContain('complementary differential pair');
    expect(failures[0]).toContain('length tuning');
  });

  it('meanders both lanes of a coupled pair', () => {
    const { pair, world, track } = makePair();
    const { host } = makeHost({ world, pair, paths: pairPaths() });
    const placer = new PnsDpMeanderPlacer(host);

    placer.updateSettings(tuningSettings(25 * MM));
    expect(placer.start(V(0, 0), track)).toBe(true);
    expect(placer.move(V(20 * MM, 0), null)).toBe(true);

    const traces = placer.traces().citems();

    expect(traces.length).toBe(2);

    const lp = (traces[0] as PnsLine).cLine();
    const ln = (traces[1] as PnsLine).cLine();

    // Both lanes are meandered, and both are longer than the 20 mm they started
    // as.
    expect(lp.length()).toBeGreaterThan(20 * MM);
    expect(ln.length()).toBeGreaterThan(20 * MM);

    // The two lanes are distinct geometry, offset from the shared baseline.
    expect(lp.points()).not.toEqual(ln.points());
  });

  it('keeps the original lanes when the pair is not coupled where the cursor is', () => {
    // Lanes 8 mm apart: nothing the gap constraint will accept as a pair.
    const world = new PnsNode();
    const trackP = seg(V(0, 0), V(20 * MM, 0), NET_P);

    const pair = new DiffPair();

    pair.setWidth(WIDTH);
    pair.setGap(150000);
    pair.setNets(NET_P, NET_N);
    pair.setShape([V(0, 0), V(20 * MM, 0)], [V(0, 8 * MM), V(20 * MM, 8 * MM)]);

    const { host } = makeHost({ world, pair, paths: pairPaths() });
    const placer = new PnsDpMeanderPlacer(host);

    placer.updateSettings(tuningSettings(25 * MM));
    placer.start(V(0, 0), trackP);

    expect(placer.move(V(20 * MM, 0), null)).toBe(false);

    // The track does not vanish: the finals are the originals.
    const traces = placer.traces().citems();

    expect((traces[0] as PnsLine).cLine().points()).toEqual([V(0, 0), V(20 * MM, 0)]);
    expect(placer.tuningStatus()).toBe(PnsTuningStatus.TOO_SHORT);
  });

  it('claims to have placed something from the moment it starts (oddity 19)', () => {
    const { pair, world, track } = makePair();
    const { host } = makeHost({ world, pair, paths: pairPaths() });
    const placer = new PnsDpMeanderPlacer(host);

    placer.updateSettings(tuningSettings(25 * MM));
    placer.start(V(0, 0), track);

    expect(placer.hasPlacedAnything()).toBe(true);
  });

  it('returns N before P from TunedPath and P before N from Traces (oddity 20)', () => {
    const { pair, world, track } = makePair();
    const { host } = makeHost({ world, pair, paths: pairPaths() });
    const placer = new PnsDpMeanderPlacer(host);

    placer.updateSettings(tuningSettings(25 * MM));
    placer.start(V(0, 0), track);
    placer.move(V(20 * MM, 0), null);

    expect(placer.currentNets()).toEqual([NET_P, NET_N]);
    expect(
      placer
        .traces()
        .citems()
        .map((i) => i.net()),
    ).toEqual([NET_P, NET_N]);
    // The tuning paths were assembled P first; they come back N first.
    expect(
      placer
        .tunedPath()
        .citems()
        .map((i) => i.net()),
    ).toEqual([NET_N, NET_P]);
  });

  it('checks a meander against four track widths, ignoring the spacing (oddity 16)', () => {
    const { pair, world, track } = makePair();
    const { host } = makeHost({ world, pair, paths: pairPaths() });
    const placer = new PnsDpMeanderPlacer(host);

    const s = tuningSettings(25 * MM);

    // Deliberately not the default: it must make no difference.
    s.spacing = 4321000;

    placer.updateSettings(s);
    placer.start(V(0, 0), track);
    placer.move(V(20 * MM, 0), null);

    const shape = spyOnSelfIntersections(placer);

    expect(placer.checkFit(shape.shape)).toBe(true);
    expect(shape.clearances).toEqual([WIDTH * 4]);
  });
});

// ---------------------------------------------------------------------------------

describe('MEANDER_SKEW_PLACER', () => {
  /** A pair whose N lane is 2 mm longer than its P lane, picked up on P. */
  function skewSetup(aOpts: Partial<HostOpts> = {}) {
    // Only the active lane goes into the node: it is the one `Start()`
    // assembles and then removes. The coupled lane reaches the placer as a
    // length, through its tuning path, and never as geometry.
    const world = new PnsNode();
    const trackP = seg(V(0, 0), V(20 * MM, 0), NET_P);

    world.addSegment(trackP);

    const pair = new DiffPair();

    pair.setWidth(WIDTH);
    pair.setGap(150000);
    pair.setNets(NET_P, NET_N);
    pair.setShape([V(0, 0), V(20 * MM, 0)], [V(0, 400000), V(22 * MM, 400000)]);

    const spy = makeHost({
      world,
      pair,
      paths: [pathOfLength(20 * MM, NET_P), pathOfLength(22 * MM, NET_N)],
      ...aOpts,
    });
    const placer = new PnsMeanderSkewPlacer(spy.host);

    return { world, trackP, pair, placer, ...spy };
  }

  it('refuses a track with no complementary net, with its own wording', () => {
    const world = new PnsNode();
    const track = seg(V(0, 0), V(20 * MM, 0));

    world.addSegment(track);

    const { host, failures } = makeHost({ world });
    const placer = new PnsMeanderSkewPlacer(host);

    expect(placer.start(V(0, 0), track)).toBe(false);
    expect(failures[0]).toContain('skew tuning');
  });

  it('reports the active net first, coupled second', () => {
    const { placer, trackP } = skewSetup();

    placer.updateSettings(defaultMeanderSettings());
    placer.start(V(0, 0), trackP);

    expect(placer.currentNets()).toEqual([NET_P, NET_N]);
  });

  it('reports a skew, not a length, and starts at the pair s own mismatch', () => {
    const { placer, trackP } = skewSetup();

    placer.updateSettings(defaultMeanderSettings());
    placer.start(V(0, 0), trackP);

    // P is 20 mm, N is 22 mm: the active lane is 2 mm short.
    expect(placer.currentSkew()).toBe(-2 * MM);
    expect(placer.tuningLengthResult()).toBe(-2 * MM);
  });

  it('cancels the chain aggregate out of the skew (oddity 22)', () => {
    const { placer, trackP } = skewSetup({ aggregate: { length: 6 * MM, delay: 0 } });

    placer.updateSettings(defaultMeanderSettings());
    placer.start(V(0, 0), trackP);

    // The aggregate went on to both sides, so the skew is unchanged.
    expect(placer.currentSkew()).toBe(-2 * MM);
  });

  it('meanders the short lane up to the requested skew', () => {
    const { placer, trackP } = skewSetup();
    const s = defaultMeanderSettings();

    setTargetSkew(s, 0);
    placer.updateSettings(s);
    placer.start(V(0, 0), trackP);
    placer.move(V(20 * MM, 0), null);

    expect(placer.tuningStatus()).toBe(PnsTuningStatus.TUNED);
    // Four IU short of dead level, which is the amplitude search's tolerance.
    expect(placer.tuningLengthResult()).toBe(-4);
    // Which means the P lane grew by the 2 mm it was short.
    expect(finalLength(placer)).toBe(22 * MM - 4);
  });

  it('a non-zero skew target leaves exactly that much difference', () => {
    const { placer, trackP } = skewSetup();
    const s = defaultMeanderSettings();

    setTargetSkew(s, 1 * MM);
    placer.updateSettings(s);
    placer.start(V(0, 0), trackP);
    placer.move(V(20 * MM, 0), null);

    expect(placer.tuningLengthResult()).toBe(1 * MM - 18);
    expect(finalLength(placer)).toBe(23 * MM - 18);
  });

  it('subtracts the chain offset from the target it tunes to', () => {
    // 3 mm of the budget is absorbed by sibling nets and a further 1 mm by a
    // stub the PNS baseline did not measure, so the meander must add 4 mm less.
    const { placer, trackP } = skewSetup({
      aggregate: { length: 3 * MM, delay: 0 },
      netBoardLength: 21 * MM,
    });
    const s = defaultMeanderSettings();

    setTargetSkew(s, 0);
    placer.updateSettings(s);
    placer.start(V(0, 0), trackP);
    placer.move(V(20 * MM, 0), null);

    // Coupled length is 22 + 3 = 25 mm; the target handed down is
    // 25 - 4 = 21 mm, so the P lane ends up 1 mm longer than it started.
    expect(finalLength(placer)).toBe(21 * MM + 10);
  });
});
