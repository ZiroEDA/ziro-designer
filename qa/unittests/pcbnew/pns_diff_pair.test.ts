// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The differential-pair geometry: how a pair leaves a pad, a via or an existing
 * track, and how the two lanes are measured against each other.
 * Counterpart: `pcbnew/router/pns_diff_pair.cpp`.
 *
 * What is worth pinning here is almost entirely *scoring* and *tie-breaks*. A
 * gateway with a plausible-but-wrong priority does not crash, does not fail a
 * shape assertion, and does not look wrong in isolation — it just makes every
 * pair on the board leave its pads by a different route. So:
 *
 * - the pad fan is priority **100** for the orthogonal spread and **99** for
 *   the diagonal one, and the spread distances come from the pad's own
 *   dimensions through `(w+1)*3/2` and `w-h`;
 * - continuing an existing pair is priority **100**, its 22.5° variants **20**,
 *   and the wiggle-room 23.5° ones **5**;
 * - `BuildGeneric`'s midpoint exit is **1** or **2** and its intersection exits
 *   **20** or **10**, switching on `padDist > 3 * gap` — in *opposite*
 *   directions;
 * - `FitGateways` charges **-3** for the non-preferred diagonal sense, and its
 *   `>=` means the **last** equally scored candidate wins;
 * - `BuildOrthoProjections` breaks a distance tie towards the **diagonal**.
 *
 * And three upstream oddities that a tidy reimplementation would lose:
 *
 * - `BuildInitial` runs its gap, self-intersection and crossing checks on the
 *   **bare initial traces**, never on the chains with the lead-ins spliced in;
 * - `CursorOrientation` reads `Anchor( 1 )` and then falls through to the
 *   non-segment path without re-reading `Anchor( 0 )`;
 * - `checkDiagonalAlignment` calls two **coincident** anchors aligned.
 */
import { describe, expect, it } from 'vitest';
import {
  chainLengthI,
  chainSelfIntersecting,
  chainsIntersect,
  DiffPair,
  DpGateway,
  DpGateways,
  DpPrimitivePair,
  makeGapVector,
  segCollinear,
  segIntersect,
  segIntersectLines,
} from '@ziroeda/pcbnew/src/router/pns_diff_pair.js';
import { segApproxParallel, segLineProject } from '@ziroeda/pcbnew/src/router/pns_seg_ops.js';
import { RangedNum } from '@ziroeda/pcbnew/src/router/ranged_num.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { AngleType, Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import { Perpendicular, ResizeI } from '@ziroeda/kimath/src/math/vector2.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

/** An axis-aligned rectangular pad, positioned and shaped at the same place. */
function pad(x: number, y: number, w: number, h: number): PnsSolid {
  const s = new PnsSolid();

  s.setPos(V(x, y));
  s.setShape({
    kind: 'poly',
    pts: [
      V(x - w / 2, y - h / 2),
      V(x + w / 2, y - h / 2),
      V(x + w / 2, y + h / 2),
      V(x - w / 2, y + h / 2),
    ],
    r: 0,
  });

  return s;
}

const anchors = (g: DpGateways): [Vec2, Vec2][] =>
  g.gateways().map((x) => [x.anchorP(), x.anchorN()]);

// ---------------------------------------------------------------------------

describe('RANGED_NUM', () => {
  it('is inclusive at both ends of an asymmetric band', () => {
    const r = new RangedNum(1000, 30, 10);

    expect(r.matches(990)).toBe(true);
    expect(r.matches(989)).toBe(false);
    expect(r.matches(1030)).toBe(true);
    expect(r.matches(1031)).toBe(false);
  });

  it('assigning a value keeps the band, as operator=( T ) does', () => {
    expect(new RangedNum(0, 5, 5).withValue(100).matches(96)).toBe(true);
    // ...and a plain constructor has no band at all.
    expect(new RangedNum(100).matches(99)).toBe(false);
  });
});

describe('exact SEG arithmetic', () => {
  it('the chain length rounds the norm, where pns_seg_ops truncates it', () => {
    // `SEG::Length` is `( A - B ).EuclideanNorm()`, and the VECTOR2<int>
    // instantiation *rounds* — its return type is already int, so there is no
    // double left for `int Length()` to truncate. `pns_seg_ops.ts::segLength`
    // truncates, and the two part company as soon as the hypotenuse's fraction
    // reaches 0.5. Skew() is a difference of two of these, so the bias would
    // not cancel.
    expect(chainLengthI([V(0, 0), V(2, 3)])).toBe(4); // hypot 3.606, not 3
    expect(chainLengthI([V(0, 0), V(3, 4)])).toBe(5);
    // |x| == |y| takes the KiROUND( |x| * sqrt2 ) short cut: 707.106 -> 707.
    expect(chainLengthI([V(0, 0), V(500, 500)])).toBe(707);
  });

  it('Collinear tightens with the segment length, so 200-unit probes are exact', () => {
    const probe = { a: V(-100, 0), b: V(100, 0) };

    expect(segCollinear(probe, { a: V(500, 0), b: V(700, 0) })).toBe(true);
    // One unit of offset over a 200-unit baseline is already 200 > 1.
    expect(segCollinear(probe, { a: V(500, 1), b: V(700, 1) })).toBe(false);
  });

  it('IntersectLines answers the midpoint for two collinear lines', () => {
    // Upstream's placeholder, and BuildGeneric depends on it being non-null:
    // it discards the result with a Collinear test of its own.
    expect(segIntersectLines({ a: V(0, 0), b: V(10, 0) }, { a: V(100, 0), b: V(200, 0) })).toEqual(
      V(50, 0),
    );
    // Parallel but not collinear is a genuine miss.
    expect(segIntersectLines({ a: V(0, 0), b: V(10, 0) }, { a: V(0, 5), b: V(10, 5) })).toBeNull();
  });

  it('Intersect can ignore a shared endpoint', () => {
    const a = { a: V(0, 0), b: V(1000, 0) };
    const b = { a: V(1000, 0), b: V(1000, 1000) };

    expect(segIntersect(a, b)).toEqual(V(1000, 0));
    expect(segIntersect(a, b, true)).toBeNull();
  });

  it('LineProject rounds like rescale', () => {
    // t = 3414, l^2 = 2 -> (3414 + 1) / 2 = 1707 per component.
    expect(segLineProject({ a: V(0, 0), b: V(1, 1) }, V(2414, 1000))).toEqual(V(1707, 1707));
  });

  it('ApproxParallel is signed where ApproxCollinear is not', () => {
    // Two segments straddling the reference line at equal distance are
    // anti-parallel; dropping the sign would call them parallel.
    expect(
      segApproxParallel({ a: V(0, 0), b: V(1000, 0) }, { a: V(0, 500), b: V(1000, 500) }),
    ).toBe(true);
    expect(
      segApproxParallel({ a: V(0, 0), b: V(1000, 0) }, { a: V(0, 500), b: V(1000, -500) }),
    ).toBe(false);
  });
});

describe('makeGapVector', () => {
  it('lengthens until a symmetric pair spans the requested gap', () => {
    // Resize( 2 ) would leave 2*2 = 4 < 5, so the loop bumps to 3.
    expect(makeGapVector(V(1, 0), 5)).toEqual(V(3, 0));
    // An exact half needs no bump.
    expect(makeGapVector(V(1000, 0), 1000)).toEqual(V(500, 0));
  });

  it('uses the exact integer Resize on the diagonal', () => {
    // 500 * sqrt(1/2) = 353.55 -> 354, and |2 * (354,354)| = 1001 >= 1000.
    expect(makeGapVector(V(1000, 1000), 1000)).toEqual(V(354, 354));
  });

  it('seeds the search at the *truncated* half length, which can already fit', () => {
    // `int l = length / 2` truncates, so an odd length starts one below the
    // rounded half — and that lower seed is sometimes already enough, because
    // Resize rounds each component up. Seeding with a rounded half would skip
    // straight past it and return a vector a whole unit longer.
    // dir (3,4), length 13: Resize( 6 ) = (4,5) and |2*(4,5)| = 13 >= 13.
    expect(makeGapVector(V(3, 4), 13)).toEqual(V(4, 5));
    expect(makeGapVector(V(5, 12), 11)).toEqual(V(2, 5));
  });

  it('returns a zero direction unchanged and exits at once for a zero length', () => {
    expect(makeGapVector(V(0, 0), 5000)).toEqual(V(0, 0));
    expect(makeGapVector(V(1000, 0), 0)).toEqual(V(0, 0));
  });
});

describe('chain helpers', () => {
  it('Length sums integer segment lengths, so a balanced pair has zero skew', () => {
    // Two 45-degree runs of the same shape: the float sum would leave a
    // fractional residue in the difference.
    const p = [V(0, 0), V(500, 500), V(1000, 500)];
    const n = [V(0, 1000), V(500, 1500), V(1000, 1500)];

    expect(chainLengthI(p)).toBe(707 + 500);
    expect(chainLengthI(p) - chainLengthI(n)).toBe(0);
  });

  it('SelfIntersecting counts a near-touch, not only a crossing', () => {
    expect(chainSelfIntersecting([V(0, 0), V(1000, 0), V(1000, 1000)])).toBe(false);
    expect(
      chainSelfIntersecting([V(0, 0), V(1000, 0), V(1000, 1000), V(500, 1000), V(500, -500)]),
    ).toBe(true);
    // `Contains` is a squared-distance tolerance of 3, so within one unit counts.
    expect(chainSelfIntersecting([V(0, 0), V(1000, 0), V(1000, 500), V(500, 1)])).toBe(true);
  });

  it('Intersects counts a touch, because collinear-and-touching is not excluded', () => {
    expect(chainsIntersect([V(0, 0), V(1000, 0)], [V(0, 10), V(1000, 10)])).toBe(false);
    expect(chainsIntersect([V(0, 0), V(1000, 0)], [V(1000, 0), V(1000, 500)])).toBe(true);
    expect(chainsIntersect([V(0, 0), V(1000, 0)], [V(500, 0), V(2000, 0)])).toBe(true);
  });
});

describe('DP_GATEWAY', () => {
  it('reverses both lead-ins and keeps reporting that it has them', () => {
    const g = new DpGateway(V(0, 0), V(0, 1000), false);

    g.setEntryLines([V(-500, 0), V(0, 0)], []);
    g.reverse();

    expect(g.entryP()).toEqual([V(0, 0), V(-500, 0)]);
    expect(g.entryN()).toEqual([]);
    expect(g.hasEntryLines()).toBe(true);
  });

  it('Entry() builds a pair whose gap constraint has no tolerance', () => {
    const g = new DpGateway(V(0, 0), V(0, 1000), false);

    expect(g.entry().gapConstraint().matches(1)).toBe(false);
    expect(g.entry().gapConstraint().matches(0)).toBe(true);
  });

  it('defaults to obtuse entry angles and zero priority', () => {
    const g = new DpGateway(V(0, 0), V(0, 1000), true);

    expect(g.allowedAngles()).toBe(AngleType.ANG_OBTUSE);
    expect(g.priority()).toBe(0);
    expect(g.isDiagonal()).toBe(true);
  });
});

describe('DP_PRIMITIVE_PAIR', () => {
  it('clones its primitives, so the pair outlives the originals', () => {
    const s = new PnsSegment({ a: V(0, 0), b: V(1000, 0) });
    const pair = DpPrimitivePair.fromItems(s, new PnsSegment({ a: V(0, 1000), b: V(1000, 1000) }));

    s.setEnds(V(9999, 9999), V(8888, 8888));

    expect(pair.anchorP()).toEqual(V(0, 0));
    expect(pair.primP()).not.toBe(s);
  });

  it('Directional() consults only the P primitive', () => {
    const seg = new PnsSegment({ a: V(0, 0), b: V(1000, 0) });

    expect(DpPrimitivePair.fromItems(seg, pad(0, 1000, 400, 400)).directional()).toBe(true);
    expect(DpPrimitivePair.fromItems(pad(0, 1000, 400, 400), seg).directional()).toBe(false);
    expect(DpPrimitivePair.fromAnchors(V(0, 0), V(0, 1000)).directional()).toBe(false);
  });

  it('the anchor direction points out of the anchor, away from the far end', () => {
    const p = new PnsSegment({ a: V(0, 0), b: V(1000, 0) });
    const n = new PnsSegment({ a: V(0, 1000), b: V(1000, 1000) });

    // Anchored at A: the direction is A - B, i.e. back down the track.
    expect(DpPrimitivePair.fromItems(p, n).dirP().toVector()).toEqual(V(-1, 0));

    const far = DpPrimitivePair.fromItems(p, n);

    far.setAnchors(V(1000, 0), V(1000, 1000));
    expect(far.dirP().toVector()).toEqual(V(1, 0));

    // A pad has no direction at all.
    expect(
      DpPrimitivePair.fromItems(pad(0, 0, 400, 400), pad(0, 1000, 400, 400))
        .dirP()
        .isDefined(),
    ).toBe(false);
  });

  it('two parallel segments keep their own heading, resized to the anchor spacing', () => {
    const pair = DpPrimitivePair.fromItems(
      new PnsSegment({ a: V(0, 0), b: V(1000, 0) }),
      new PnsSegment({ a: V(0, 1000), b: V(1000, 1000) }),
    );

    // Note the cursor is *behind* the pair and the direction is not flipped:
    // the parallel branch returns before the dot-product test.
    const r = pair.cursorOrientation(V(-50000, 0));

    expect(r.midpoint).toEqual(V(1000, 500));
    expect(r.direction).toEqual(V(1000, 0));
  });

  it('two non-parallel segments fall through still holding Anchor( 1 )', () => {
    // UPSTREAM ODDITY: the `else` that would re-read Anchor( 0 ) is only taken
    // when the primitives are *not* both segments, so the perpendicular
    // fallback runs on the far ends the parallel branch had already loaded.
    const pair = DpPrimitivePair.fromItems(
      new PnsSegment({ a: V(0, 0), b: V(1000, 0) }),
      new PnsSegment({ a: V(0, 1000), b: V(0, 2000) }),
    );

    const r = pair.cursorOrientation(V(10000, 10000));

    expect(r.midpoint).toEqual(V(500, 1000)); // not V(0, 500)
    expect(r.direction).toEqual(V(2000, 1000));
  });

  it('anything else uses Anchor( 0 ) and turns to face the cursor', () => {
    const pair = DpPrimitivePair.fromItems(pad(0, 0, 400, 400), pad(0, 1000, 400, 400));

    expect(pair.cursorOrientation(V(10000, 500))).toEqual({
      midpoint: V(0, 500),
      direction: Perpendicular(V(0, -1000)),
    });
    expect(pair.cursorOrientation(V(-10000, 500)).direction).toEqual(V(-1000, 0));
  });
});

describe('DP_GATEWAYS::checkDiagonalAlignment', () => {
  const g = new DpGateways(1000);

  it('accepts a common axis or a common 45-degree line', () => {
    expect(g.checkDiagonalAlignment(V(0, 0), V(0, 1000))).toBe(true);
    expect(g.checkDiagonalAlignment(V(0, 0), V(1000, 0))).toBe(true);
    expect(g.checkDiagonalAlignment(V(0, 0), V(1000, 1000))).toBe(true);
    expect(g.checkDiagonalAlignment(V(0, 0), V(1000, 500))).toBe(false);
  });

  it('calls two coincident anchors aligned, which is upstream oddity not intent', () => {
    // dx == dy == 0 satisfies the middle clause, even though the outer two are
    // written specifically to exclude the degenerate case.
    expect(g.checkDiagonalAlignment(V(7, 7), V(7, 7))).toBe(true);
  });
});

describe('DP_GATEWAYS::BuildForCursor', () => {
  it('stamps the loop variable, not the shape of the offset it built', () => {
    const g = new DpGateways(1000);

    g.setFitVias(false);
    g.buildForCursor(V(0, 0));

    // The `!diagonal` pass builds a (gap, gap) *diagonal* offset...
    expect(
      g
        .gateways()
        .slice(0, 4)
        .map((x) => x.isDiagonal()),
    ).toEqual([false, false, false, false]);
    expect(anchors(g).slice(0, 4)).toEqual([
      [V(-354, -354), V(354, 354)],
      [V(354, -354), V(-354, 354)],
      [V(-354, 354), V(354, -354)],
      [V(354, 354), V(-354, -354)],
    ]);

    // ...and the `diagonal` pass builds axis-aligned ones, at (gap + 1) / 2.
    expect(
      g
        .gateways()
        .slice(4)
        .map((x) => x.isDiagonal()),
    ).toEqual([true, true, true, true]);
    expect(anchors(g).slice(4)).toEqual([
      [V(500, 0), V(-500, 0)],
      [V(-500, 0), V(500, 0)],
      [V(0, 500), V(0, -500)],
      [V(0, -500), V(0, 500)],
    ]);
  });

  it('fitting vias uses the via gap plus the via diameter, and stamps nothing', () => {
    const g = new DpGateways(1000);

    g.setFitVias(true, 600, 400);
    g.buildForCursor(V(0, 0));

    // Everything now comes out of BuildGeneric, so the diagonal flag is
    // whatever the probe geometry said, and the count is not 8.
    expect(g.gateways().length).toBeGreaterThan(8);

    // A negative via gap falls back to the track gap.
    const h = new DpGateways(1000);

    h.setFitVias(true, 0, -1);
    h.buildForCursor(V(0, 0));
    expect(h.gateways().length).toBeGreaterThan(0);
  });
});

describe('DP_GATEWAYS::BuildGeneric', () => {
  /** The midpoint exit is the only one built with ANG_RIGHT. */
  const midpointExit = (g: DpGateways): DpGateway | undefined =>
    g.gateways().find((x) => x.allowedAngles() === AngleType.ANG_RIGHT);

  it('places a midpoint exit and four side-by exits when the anchors line up', () => {
    const g = new DpGateways(1000);

    g.buildGeneric(V(0, 0), V(0, 1000));

    expect(anchors(g).slice(0, 5)).toEqual([
      [V(0, 250), V(0, 750)],
      [V(0, -1000), V(-1000, -1000)],
      [V(0, -1000), V(1000, -1000)],
      [V(-1000, 2000), V(0, 2000)],
      [V(1000, 2000), V(0, 2000)],
    ]);
  });

  it('scores the midpoint exit 1 when the pads are close and 2 when they are far', () => {
    const near = new DpGateways(1000); // padDist 1000, 3 * gap 3000

    near.buildGeneric(V(0, 0), V(0, 1000));
    expect(midpointExit(near)?.priority()).toBe(1);

    const far = new DpGateways(100); // padDist 1000, 3 * gap 300

    far.buildGeneric(V(0, 0), V(0, 1000));
    expect(midpointExit(far)?.priority()).toBe(2);
  });

  it('scores the intersection exits the other way round: 20 when close, 10 when far', () => {
    const prios = (gap: number): number[] => {
      const g = new DpGateways(gap);

      g.buildGeneric(V(0, 0), V(0, 1000));

      return g
        .gateways()
        .filter((x) => x.allowedAngles() === AngleType.ANG_OBTUSE && x.priority() !== 0)
        .map((x) => x.priority());
    };

    expect(prios(1000)).toEqual([20, 20]);
    expect(prios(100)).toEqual([10, 10]);
  });

  it('builds the diagonal-diagonal exits at the gap over root two', () => {
    const g = new DpGateways(1000);

    g.buildGeneric(V(0, 0), V(0, 1000));

    const diag = g.gateways().filter((x) => x.priority() === 20);

    expect(diag.map((x) => [x.anchorP(), x.anchorN(), x.isDiagonal()])).toEqual([
      [V(1, -1), V(1, 1001), true],
      [V(-1, -1), V(-1, 1001), true],
    ]);
  });

  it('via mode suppresses the midpoint block and the straight-diagonal exits', () => {
    const plain = new DpGateways(1000);
    const viaMode = new DpGateways(1000);

    plain.buildGeneric(V(0, 0), V(0, 1000), false, false);
    viaMode.buildGeneric(V(0, 0), V(0, 1000), false, true);

    expect(midpointExit(plain)).toBeDefined();
    expect(midpointExit(viaMode)).toBeUndefined();
    expect(viaMode.gateways().length).toBeLessThan(plain.gateways().length);
  });

  it('lead-ins are only built on request, and reach back to the anchors', () => {
    const bare = new DpGateways(1000);
    const withEntries = new DpGateways(1000);

    bare.buildGeneric(V(0, 0), V(0, 1000), false);
    withEntries.buildGeneric(V(0, 0), V(0, 1000), true);

    expect(bare.gateways().every((x) => !x.hasEntryLines())).toBe(true);
    expect(withEntries.gateways().every((x) => x.hasEntryLines())).toBe(true);
    // The trace is built gateway-to-pad and then reversed, so it starts at the
    // pad and ends on the gateway anchor.
    for (const g of withEntries.gateways()) {
      expect(g.entryP()[0]).toEqual(V(0, 0));
      expect(g.entryP()[g.entryP().length - 1]).toEqual(g.anchorP());
    }
  });
});

describe('DP_GATEWAYS::BuildFromPrimitivePair', () => {
  it('fans out of a rectangular pad at priority 100 then 99', () => {
    const g = new DpGateways(500);

    g.buildFromPrimitivePair(
      DpPrimitivePair.fromItems(pad(0, 0, 400, 800), pad(0, 2000, 400, 800)),
      false,
    );

    // w/h swapped to 800/400, so orthoFanDistance = (800 + 1) * 3 / 2 = 1201
    // and diagFanDistance = 800 - 400 = 400; the sideways shift is
    // max( 0, padDist - gap ) = 1500 on both axes.
    expect(
      g
        .gateways()
        .slice(0, 4)
        .map((x) => [x.anchorP(), x.anchorN(), x.priority()]),
    ).toEqual([
      [V(1351, 750), V(1351, 1250), 100],
      [V(-1351, 750), V(-1351, 1250), 100],
      [V(950, 750), V(950, 1250), 99],
      [V(-950, 750), V(-950, 1250), 99],
    ]);

    // The lead-in goes pad -> fan corner -> gateway anchor.
    expect(g.gateways()[0]?.entryP()).toEqual([V(0, 0), V(601, 0), V(1351, 750)]);
    expect(g.gateways()[2]?.entryP()).toEqual([V(0, 0), V(200, 0), V(950, 750)]);

    // ...and the generic fan is appended after it, not instead of it.
    expect(g.gateways().length).toBeGreaterThan(4);
  });

  it('a round pad short-circuits to the generic fan with no spread at all', () => {
    const round = new PnsSolid();

    round.setPos(V(0, 0));
    round.setShape({ kind: 'circle', c: V(0, 0), r: 200 });

    const other = new PnsSolid();

    other.setPos(V(0, 2000));
    other.setShape({ kind: 'circle', c: V(0, 2000), r: 200 });

    const g = new DpGateways(500);

    g.buildFromPrimitivePair(DpPrimitivePair.fromItems(round, other), false);

    expect(g.gateways().some((x) => x.priority() >= 99)).toBe(false);
  });

  it('a mixed pad/track pair produces nothing at all', () => {
    // Neither branch matches, so p0_p and p0_n are still the origin and the
    // null shape returns before anything is pushed. Upstream's, exactly.
    const g = new DpGateways(1000);

    g.buildFromPrimitivePair(
      DpPrimitivePair.fromItems(
        pad(0, 0, 400, 800),
        new PnsSegment({ a: V(0, 2000), b: V(1000, 2000) }),
      ),
      false,
    );

    expect(g.gateways()).toEqual([]);
  });

  it('a bare pair of points goes straight to the generic fan, with lead-ins', () => {
    const g = new DpGateways(1000);

    g.buildFromPrimitivePair(DpPrimitivePair.fromAnchors(V(0, 0), V(0, 1000)), false);

    expect(g.gateways().length).toBeGreaterThan(0);
    expect(g.gateways().every((x) => x.hasEntryLines())).toBe(true);
  });

  it('continuing a pair scores the straight-on gateway 100 and the tilts 20 and 5', () => {
    const pair = DpPrimitivePair.fromItems(
      new PnsSegment({ a: V(-1000, 0), b: V(0, 0) }),
      new PnsSegment({ a: V(-1000, 1000), b: V(0, 1000) }),
    );

    pair.setAnchors(V(0, 0), V(0, 1000));

    const g = new DpGateways(1000);

    g.buildFromPrimitivePair(pair, false);

    expect(g.gateways().map((x) => x.priority())).toEqual([100, 20, 20, 5, 5]);

    // sin(22.5) = 0.38268 and sin(23.5) = 0.39875 as decimal literals, times
    // the gap, rounded — and only *one* anchor moves per gateway.
    expect(g.gateways()[1]?.anchorP()).toEqual(V(383, 0));
    expect(g.gateways()[1]?.anchorN()).toEqual(V(0, 1000));
    expect(g.gateways()[2]?.anchorP()).toEqual(V(0, 0));
    expect(g.gateways()[2]?.anchorN()).toEqual(V(383, 1000));
    expect(g.gateways()[3]?.anchorP()).toEqual(V(399, 0));
    expect(g.gateways()[4]?.anchorN()).toEqual(V(399, 1000));

    // The one-sided gateways really are one-sided.
    expect(g.gateways()[1]?.entryN()).toEqual([]);
    expect(g.gateways()[2]?.entryP()).toEqual([]);
  });

  it('a pair that is not at a normal angle gets no tilted gateways', () => {
    const pair = DpPrimitivePair.fromItems(
      new PnsSegment({ a: V(-1000, 0), b: V(0, 0) }),
      new PnsSegment({ a: V(-1000, 1000), b: V(-300, 1000) }),
    );

    // delta = (300, -1000): no component under 5 IU and dx - dy is 1300.
    pair.setAnchors(V(0, 0), V(-300, 1000));

    const g = new DpGateways(1000);

    g.buildFromPrimitivePair(pair, false);

    expect(g.gateways().map((x) => x.priority())).toEqual([100]);
  });
});

describe('DP_GATEWAYS::FilterByOrientation', () => {
  it('drops the gateways whose spread axis makes a masked angle', () => {
    const g = new DpGateways(1000);

    g.setFitVias(false);
    g.buildForCursor(V(0, 0));
    // Orientation is AnchorP - AnchorN, so the axis-offset gateways built in
    // the second pass are the horizontal/vertical ones.
    g.filterByOrientation(AngleType.ANG_STRAIGHT, Direction45.fromVector(V(1, 0)));

    expect(g.gateways().every((x) => x.anchorP().x - x.anchorN().x !== 1000)).toBe(true);
    expect(g.gateways().length).toBe(7);
  });

  it('leaves a degenerate gateway alone, since ANG_UNDEFINED is in no mask', () => {
    const g = new DpGateways(1000);

    g.gateways().push(new DpGateway(V(5, 5), V(5, 5), false));
    g.filterByOrientation(
      AngleType.ANG_STRAIGHT | AngleType.ANG_OBTUSE | AngleType.ANG_RIGHT | AngleType.ANG_ACUTE,
      Direction45.fromVector(V(1, 0)),
    );

    expect(g.gateways().length).toBe(1);
  });
});

describe('DIFF_PAIR::BuildInitial', () => {
  const straightPair = (d: number, gap: number): boolean =>
    DiffPair.withGap(gap).buildInitial(
      new DpGateway(V(0, 0), V(0, d), false),
      new DpGateway(V(5000, 0), V(5000, d), false),
      false,
    );

  it('allows the lanes down to exactly gap - 100 apart and no closer', () => {
    expect(straightPair(900, 1000)).toBe(true);
    expect(straightPair(899, 1000)).toBe(false);
  });

  it('checks the bare traces, never the chains with the lead-ins spliced in', () => {
    // UPSTREAM ODDITY: these two lead-ins cross each other, and the assembled
    // pair therefore crosses too — but checkGap / SelfIntersecting / Intersects
    // all run on `p` and `n`, which are clean.
    const entry = new DpGateway(V(0, 0), V(0, 900), false);

    entry.setEntryLines([V(-1000, 900), V(0, 0)], [V(-1000, 0), V(0, 900)]);

    const dp = DiffPair.withGap(1000);

    expect(dp.buildInitial(entry, new DpGateway(V(5000, 0), V(5000, 900), false), false)).toBe(
      true,
    );
    expect(chainsIntersect(dp.cP(), dp.cN())).toBe(true);
  });

  it('rejects a lead-in that meets its trace at a right angle', () => {
    // The mask is AllowedAngles | STRAIGHT | OBTUSE, and the default allowed
    // set is OBTUSE, so a right-angled join fails.
    const entry = new DpGateway(V(0, 0), V(0, 2000), false);

    entry.setEntryLines([V(-2000, 2000), V(0, 0)], [V(-2000, 4000), V(0, 2000)]);

    const target = new DpGateway(V(10000, 3000), V(10000, 5000), false);

    // straight-first leaves the lead-in heading E off a NE lead: obtuse, fine.
    expect(DiffPair.withGap(1000).buildInitial(entry, target, false)).toBe(true);
    // diagonal-first leaves it heading SE: a right angle off NE, refused.
    expect(DiffPair.withGap(1000).buildInitial(entry, target, true)).toBe(false);
  });

  it('splices the entry in front and the reversed target behind', () => {
    const entry = new DpGateway(V(0, 0), V(0, 900), false);
    const target = new DpGateway(V(5000, 0), V(5000, 900), false);

    entry.setEntryLines([V(-1000, 0), V(0, 0)], [V(-1000, 900), V(0, 900)]);
    // A target's lead-ins are built pad-first, like an entry's; the copy is
    // reversed before it is read so that it runs *out* of the gateway.
    target.setEntryLines([V(6000, 0), V(5000, 0)], [V(6000, 900), V(5000, 900)]);

    const dp = DiffPair.withGap(1000);

    expect(dp.buildInitial(entry, target, false)).toBe(true);
    expect(dp.cP()).toEqual([V(-1000, 0), V(0, 0), V(5000, 0), V(6000, 0)]);

    // Without the reverse the lead-in would double back on the trace, and the
    // connection-angle check refuses it.
    const unreversed = new DpGateway(V(5000, 0), V(5000, 900), false);

    unreversed.setEntryLines([V(5000, 0), V(6000, 0)], [V(5000, 900), V(6000, 900)]);
    expect(DiffPair.withGap(1000).buildInitial(entry, unreversed, false)).toBe(false);
  });
});

describe('DIFF_PAIR::CheckConnectionAngle', () => {
  it('passes an empty lane unconditionally', () => {
    const a = new DiffPair([V(0, 0), V(1000, 0)], []);
    const b = new DiffPair([V(1000, 0), V(1000, 1000)], []);

    // The N lanes are empty, so only P is judged, and E vs S is a right angle.
    expect(a.checkConnectionAngle(b, AngleType.ANG_RIGHT)).toBe(true);
    expect(a.checkConnectionAngle(b, AngleType.ANG_OBTUSE)).toBe(false);
  });

  it('requires both lanes to pass', () => {
    const a = new DiffPair([V(0, 0), V(1000, 0)], [V(0, 500), V(1000, 500)]);
    const straight = new DiffPair([V(1000, 0), V(2000, 0)], [V(1000, 500), V(2000, 500)]);
    const bent = new DiffPair([V(1000, 0), V(2000, 0)], [V(1000, 500), V(1000, 1500)]);

    expect(a.checkConnectionAngle(straight, AngleType.ANG_STRAIGHT)).toBe(true);
    expect(a.checkConnectionAngle(bent, AngleType.ANG_STRAIGHT)).toBe(false);
  });
});

describe('DIFF_PAIR measurements', () => {
  const pair = (): DiffPair => {
    const dp = new DiffPair([V(0, 0), V(5000, 0)], [V(0, 1000), V(3000, 1000)]);

    dp.setWidth(200);
    dp.setGap(1000);

    return dp;
  };

  it('Skew is the P lane less the N lane, and TotalLength their mean', () => {
    expect(pair().skew()).toBe(2000);
    expect(pair().totalLength()).toBe(4000);
  });

  it('CoupledLength measures the overlap, not the whole segment', () => {
    // The lanes only run together over x in [0, 3000].
    expect(pair().coupledLength()).toBe(3000);
    expect(pair().coupledLengthFactor()).toBeCloseTo(3000 / 4000);
  });

  it('a zero-length pair has a coupled length factor of zero, not a NaN', () => {
    expect(new DiffPair([V(0, 0)], [V(0, 1000)]).coupledLengthFactor()).toBe(0);
  });

  it('a coupled pair records both parent segments and their indices', () => {
    const pairs = pair().coupledSegmentPairs();

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.indexP).toBe(0);
    expect(pairs[0]?.indexN).toBe(0);
    expect(pairs[0]?.parentP).toEqual({ a: V(0, 0), b: V(5000, 0) });
    expect(pairs[0]?.coupledP).toEqual({ a: V(0, 0), b: V(3000, 0) });
  });

  it('the gap constraint gates the pairing, and SetGap is what opens it', () => {
    const dp = new DiffPair([V(0, 0), V(5000, 0)], [V(0, 90000), V(5000, 90000)]);

    dp.setWidth(200);
    // A constructor gap has *no* tolerance, so 89800 does not match 1000.
    expect(new DiffPair(dp.cP(), dp.cN(), 1000).coupledSegmentPairs()).toHaveLength(0);

    // SetGap opens a +/- 10000 band; 89800 is still far outside it.
    dp.setGap(1000);
    expect(dp.coupledSegmentPairs()).toHaveLength(0);

    dp.setGap(89800);
    expect(dp.coupledSegmentPairs()).toHaveLength(1);
  });

  it('Empty() is true when *either* lane has no segments', () => {
    expect(new DiffPair([V(0, 0), V(1, 0)], [V(0, 1), V(1, 1)]).empty()).toBe(false);
    expect(new DiffPair([V(0, 0), V(1, 0)], [V(0, 1)]).empty()).toBe(true);
  });

  it('Append joins both lanes and Clear empties them', () => {
    const dp = new DiffPair([V(0, 0), V(1000, 0)], [V(0, 500), V(1000, 500)]);

    dp.append(new DiffPair([V(1000, 0), V(2000, 0)], [V(1000, 500), V(2000, 500)]));
    expect(dp.cP()).toEqual([V(0, 0), V(1000, 0), V(2000, 0)]);

    dp.clear();
    expect(dp.cP()).toEqual([]);
  });

  it('SetShape can swap the lanes', () => {
    const dp = new DiffPair();

    dp.setShape([V(0, 0)], [V(9, 9)], true);
    expect(dp.cP()).toEqual([V(9, 9)]);
  });
});

describe('DIFF_PAIR vias and lines', () => {
  const chainPair = (): DiffPair => {
    const dp = new DiffPair([V(0, 0), V(1000, 0)], [V(0, 1000), V(1000, 1000)]);

    dp.setWidth(200);
    dp.setLayers(new PnsLayerRange(3, 5));

    return dp;
  };

  it('PLine takes the pair width, net and *start* layer', () => {
    const dp = chainPair();
    const net = { name: 'P' };

    dp.setNets(net, { name: 'N' });

    expect(dp.pLine().width()).toBe(200);
    expect(dp.pLine().net()).toBe(net);
    expect(dp.pLine().layers().start()).toBe(3);
    expect(dp.pLine().layers().end()).toBe(3);
  });

  it('the ending primitives are the last segment of each lane, anchored at its far end', () => {
    const ending = chainPair().endingPrimitives();

    expect(ending.anchorP()).toEqual(V(1000, 0));
    expect(ending.anchorN()).toEqual(V(1000, 1000));
    expect(ending.directional()).toBe(true);
  });

  it('with vias attached the ending primitives are the vias', () => {
    const dp = chainPair();

    dp.appendVias(
      new PnsVia(V(1000, 0), new PnsLayerRange(0, 31), 600, 300),
      new PnsVia(V(1000, 1000), new PnsLayerRange(0, 31), 600, 300),
    );

    expect(dp.endsWithVias()).toBe(true);
    expect(dp.endingPrimitives().anchorP()).toEqual(V(1000, 0));
    expect(dp.endingPrimitives().directional()).toBe(false);
    expect(dp.pLine().endsWithVia()).toBe(true);
  });

  it('RemoveVias clears the flag and the lines, but keeps the vias themselves', () => {
    const dp = chainPair();

    dp.appendVias(
      new PnsVia(V(1000, 0), new PnsLayerRange(0, 31), 600, 300),
      new PnsVia(V(1000, 1000), new PnsLayerRange(0, 31), 600, 300),
    );
    dp.pLine();
    dp.removeVias();

    expect(dp.endsWithVias()).toBe(false);
    expect(dp.pLine().endsWithVia()).toBe(false);
    // Upstream's asymmetry: the stored vias are untouched, so setting a
    // diameter still reaches them.
    dp.setViaDiameter(800);
    dp.setViaDrill(400);
    expect(dp.endingPrimitives().anchorP()).toEqual(V(1000, 0));
  });

  it('appended vias are copies, not the caller’s objects', () => {
    const dp = chainPair();
    const via = new PnsVia(V(1000, 0), new PnsLayerRange(0, 31), 600, 300);

    dp.appendVias(via, new PnsVia(V(1000, 1000), new PnsLayerRange(0, 31), 600, 300));
    dp.setViaDiameter(800);

    expect(via.diameter(PnsVia.ALL_LAYERS)).toBe(600);
  });

  it('Clone() is refused, as upstream asserts', () => {
    expect(() => new DiffPair().clone()).toThrow();
  });
});

describe('DP_GATEWAYS::BuildOrthoProjections', () => {
  it('breaks a distance tie towards the diagonal guide', () => {
    // At (2414, 1000) both projections are 1000 units away after integer
    // rounding, and the comparison is a strict `<` on the straight one.
    const entries = new DpGateways(1000);

    entries.gateways().push(new DpGateway(V(-500, -500), V(500, 500), false));

    const g = new DpGateways(1000);

    g.setFitVias(false);
    g.buildOrthoProjections(entries, V(2414, 1000), 7);

    // BuildForCursor at the diagonal projection (1707, 1707), not (2414, 0).
    expect(g.gateways()).toHaveLength(8);
    expect(g.gateways()[0]?.anchorP()).toEqual(V(1707 - 354, 1707 - 354));
    expect(g.gateways().every((x) => x.priority() === 7)).toBe(true);
  });

  it('takes the straight projection when it really is nearer', () => {
    const entries = new DpGateways(1000);

    entries.gateways().push(new DpGateway(V(-500, -500), V(500, 500), false));

    const g = new DpGateways(1000);

    g.setFitVias(false);
    g.buildOrthoProjections(entries, V(9000, 100), 3);

    expect(g.gateways()[0]?.anchorP()).toEqual(V(9000 - 354, -354));
  });
});

describe('DP_GATEWAYS::FitGateways', () => {
  /** An entry whose *preferred* (diagonal) build fails on the entry angle. */
  const failingDiagonal = (prio: number): DpGateway => {
    const g = new DpGateway(V(0, 0), V(0, 2000), false);

    g.setEntryLines([V(-2000, 2000), V(0, 0)], [V(-2000, 4000), V(0, 2000)]);
    g.setPriority(prio);

    return g;
  };

  const plain = (y: number, prio: number): DpGateway => {
    const g = new DpGateway(V(0, y), V(0, y + 2000), false);

    g.setPriority(prio);

    return g;
  };

  const targets = (): DpGateways => {
    const t = new DpGateways(1000);

    t.gateways().push(new DpGateway(V(10000, 3000), V(10000, 5000), false));

    return t;
  };

  const fit = (entryGateways: DpGateway[]): DiffPair | null => {
    const entry = new DpGateways(1000);

    entry.gateways().push(...entryGateways);

    const dp = new DiffPair();

    return new DpGateways(1000).fitGateways(entry, targets(), true, dp) ? dp : null;
  };

  it('charges three points of priority for the non-preferred diagonal sense', () => {
    // X (priority 3) can only be routed the non-preferred way, so its best
    // score is 3 - 3 = 0. Y (priority 2) routes the preferred way for 2, and
    // 2 > 0 wins. Without the penalty X would score 3 and keep the route.
    const dp = fit([failingDiagonal(3), plain(-4000, 2)]);

    expect(dp?.cP()[0]).toEqual(V(0, -4000));
  });

  it('a priority that clears the penalty keeps the non-preferred route', () => {
    const dp = fit([failingDiagonal(6), plain(-4000, 2)]);

    expect(dp?.cP()[0]).toEqual(V(-2000, 2000)); // the failing entry’s lead-in
  });

  it('among equally scored candidates the last one tried wins', () => {
    // `score >= bestScore`, not `>`. Both gateways score 2 in the preferred
    // sense, and the second one overwrites the first.
    expect(fit([plain(-4000, 2), plain(-6000, 2)])?.cP()[0]).toEqual(V(0, -6000));
    expect(fit([plain(-6000, 2), plain(-4000, 2)])?.cP()[0]).toEqual(V(0, -4000));
  });

  it('sets the gap on the pair it fills in, and reports failure by returning false', () => {
    const entry = new DpGateways(1000);

    entry.gateways().push(plain(-4000, 0));

    const dp = new DiffPair();

    expect(new DpGateways(1000).fitGateways(entry, targets(), true, dp)).toBe(true);
    expect(dp.gap()).toBe(1000);

    // Nothing to fit against.
    const empty = new DiffPair();

    expect(new DpGateways(1000).fitGateways(new DpGateways(1000), targets(), true, empty)).toBe(
      false,
    );
    expect(empty.cP()).toEqual([]);
  });
});

describe('ResizeI', () => {
  it('is zero for a zero vector and for a zero length', () => {
    expect(ResizeI(V(0, 0), 500)).toEqual(V(0, 0));
    expect(ResizeI(V(1000, 0), 0)).toEqual(V(0, 0));
  });

  it('flips the direction for a negative length', () => {
    expect(ResizeI(V(1000, 0), -300)).toEqual(V(-300, 0));
  });

  it('keeps each component’s sign', () => {
    expect(ResizeI(V(-1000, 1000), 500)).toEqual(V(-354, 354));
    expect(ResizeI(V(300, -400), 1000)).toEqual(V(600, -800));
  });
});
