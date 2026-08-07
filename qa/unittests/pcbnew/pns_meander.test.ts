// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The meander geometry: one trombone, and a line made of them.
 * Counterpart: `pcbnew/router/pns_meander.cpp` (`MEANDER_SHAPE`,
 * `MEANDERED_LINE`, `MEANDER_SETTINGS`).
 *
 * Coordinates are pinned here far more than they are in the walkaround tests,
 * and deliberately: a meander's *shape* is its whole contract. A tuner adds
 * length by making meanders taller and wider, so "the line got longer" is not
 * a property that distinguishes a correct meander from a wrong one — where the
 * corners land is.
 *
 * What each group is claiming:
 *
 *  - **dimensions** — `spacing`, `cornerRadius` and `minAmplitude` are the
 *    three numbers everything else is derived from, including two upstream
 *    oddities that survive here on purpose;
 *  - **shape** — the drawn outline of each meander type, and that a right-side
 *    meander really is the left-side one mirrored;
 *  - **fit** — that the amplitude search walks down from the maximum, that a
 *    corner radius under half the track width is refused, and that check-mode
 *    wipes the base index;
 *  - **line** — the state machine that fills a segment, and where it puts
 *    corners when nothing fits;
 *  - **self-intersection** — that only meanders on non-parallel baselines are
 *    even compared, and that the clearance comparison is strict;
 *  - **settings** — the unconstrained branch, and the delay setter that uses a
 *    length tolerance.
 */
import { describe, expect, it } from 'vitest';
import {
  MEANDER_DEFAULT_DELAY_TOLERANCE,
  MEANDER_DEFAULT_LENGTH_TOLERANCE,
  MEANDER_DELAY_UNCONSTRAINED,
  MEANDER_LENGTH_UNCONSTRAINED,
  MEANDER_SKEW_UNCONSTRAINED,
  MeanderShape,
  MeanderSide,
  MeanderStyle,
  MeanderType,
  MeanderedLine,
  basicMeanderPlacer,
  chainLength,
  defaultMeanderSettings,
  lineChainCollideSeg,
  setTargetLength,
  setTargetLengthFromConstraint,
  setTargetSkewDelay,
  type MeanderPlacer,
  type MeanderSettings,
} from '@ziroeda/pcbnew/src/router/pns_meander.js';
import {
  arcConvertToPolyline,
  arcCentralAngle,
  arcLength,
  arcRadius,
  constructArcFromStartEndAngle,
  resizeD,
  shapeArcCenter,
} from '@ziroeda/pcbnew/src/router/shape_arc_ops.js';
import {
  segApproxParallel,
  segContains,
  segLength,
  segLineProject,
  segReflectPoint,
} from '@ziroeda/pcbnew/src/router/pns_seg_ops.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Seg } from '@ziroeda/pcbnew/src/router/pns_line.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A 20 mm horizontal base segment, comfortably longer than any meander. */
const LONG: Seg = { a: { x: 0, y: 0 }, b: { x: 20000000, y: 0 } };

const WIDTH = 200000;
const CLEARANCE = 200000;

/** A placer that accepts every fit, i.e. an empty board. */
function permissive(aOverrides: Partial<MeanderSettings> = {}): MeanderPlacer {
  return basicMeanderPlacer({ ...defaultMeanderSettings(), ...aOverrides }, CLEARANCE, () => true);
}

const points = (aShape: MeanderShape, aLine = 0): Vec2[] => {
  const chain = aShape.cLine(aLine);
  const out: Vec2[] = [];

  for (let i = 0; i < chain.pointCount(); i++) out.push(chain.cPoint(i));

  return out;
};

const fitted = (
  aType: MeanderType,
  aPlacer: MeanderPlacer,
  aSide = false,
  aSeg: Seg = LONG,
): MeanderShape => {
  const m = new MeanderShape(aPlacer, WIDTH, false);

  expect(m.fit(aType, aSeg, aSeg.a, aSide)).toBe(true);

  return m;
};

// ---------------------------------------------------------------------------

describe('MEANDER_SHAPE dimensions', () => {
  it('spacing is the settings value unless the track needs more room', () => {
    // 200000 + 200000 clearance < 600000 default spacing.
    expect(new MeanderShape(permissive(), WIDTH, false).spacing()).toBe(600000);

    // A fat track pushes past it.
    expect(new MeanderShape(permissive(), 900000, false).spacing()).toBe(1100000);
  });

  it('a dual meander adds twice the baseline offset to the spacing', () => {
    const m = new MeanderShape(permissive(), WIDTH, true);

    m.setBaselineOffset(150000);

    // 200000 + 200000 + 2 * 150000 = 700000, past the 600000 default.
    expect(m.spacing()).toBe(700000);
  });

  it('a zero-amplitude meander has no corners at all', () => {
    // Load bearing far away: MeanderSegment asks a fresh shape for this when
    // deciding how far to skip after a failed fit. See the corner-skip test.
    expect(new MeanderShape(permissive(), WIDTH, false).cornerRadius()).toBe(0);

    // And the short circuit is doing real work, not duplicating what the rest
    // of the function would have said. Without an offset the clamps happen to
    // reach zero anyway; *with* one they land on half the offset instead.
    const dual = new MeanderShape(permissive(), WIDTH, true);

    dual.setBaselineOffset(150000);
    expect(dual.cornerRadius()).toBe(0);
  });

  it('the corner radius is the percentage of half the spacing, clamped', () => {
    const m = fitted(MeanderType.MT_SINGLE, permissive());

    // 600000 * 80 / 200 = 240000, inside [100000, 300000].
    expect(m.cornerRadius()).toBe(240000);
    expect(m.meanCornerRadius()).toBe(240000);

    const wide = fitted(MeanderType.MT_SINGLE, permissive({ cornerRadiusPercentage: 100 }));

    // 600000 * 100 / 200 = 300000, exactly the spacing bound.
    expect(wide.cornerRadius()).toBe(300000);

    const tight = fitted(MeanderType.MT_SINGLE, permissive({ cornerRadiusPercentage: 10 }));

    // 600000 * 10 / 200 = 30000, below the width floor of 100000.
    expect(tight.cornerRadius()).toBe(100000);
  });

  it('minAmplitude for a round corner is the offset plus a whole track width', () => {
    const m = new MeanderShape(permissive({ minAmplitude: 1 }), 1000000, false);

    expect(m.minAmplitude()).toBe(1000000);
  });

  it('minAmplitude for a chamfer uses tan( 1 - tan 22.5 ), an upstream slip', () => {
    const m = new MeanderShape(
      permissive({ minAmplitude: 1, cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER }),
      1000000,
      false,
    );

    // `m_width * tan( 1 - tan( DEG2RAD( 22.5 ) ) )`: a tangent applied to the
    // number 0.5857864, giving 0.6634703 — *not* the bare factor 0.5857864 that
    // cornerRadius() uses for the same correction. Pinned at the value, so a
    // well-meaning "fix" to `1 - tan 22.5` fails here.
    expect(m.minAmplitude()).toBe(663470);
    expect(m.minAmplitude()).not.toBe(585786);
  });
});

// ---------------------------------------------------------------------------

describe('MEANDER_SHAPE geometry', () => {
  it('a chamfered single meander is a trombone with eight corners', () => {
    const m = fitted(
      MeanderType.MT_SINGLE,
      permissive({ cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER }),
    );

    // amplitude 1000000, spacing 600000, cr 240000:
    //   sCorner = uCorner = 240000, startSide = 520000, top = 120000.
    expect(points(m)).toEqual([
      { x: 0, y: 0 },
      { x: 240000, y: 240000 },
      { x: 240000, y: 760000 },
      { x: 480000, y: 1000000 },
      { x: 600000, y: 1000000 },
      { x: 840000, y: 760000 },
      { x: 840000, y: 240000 },
      { x: 1080000, y: 0 },
      { x: 1200000, y: 0 },
    ]);

    // The baseline it spans is exactly two spacings.
    expect(m.baseSegment()).toEqual({ a: { x: 0, y: 0 }, b: { x: 1200000, y: 0 } });
    expect(m.baselineLength()).toBe(1200000);
  });

  it('a rounded single meander carries four arcs, and measures along them', () => {
    const m = fitted(MeanderType.MT_SINGLE, permissive());

    expect(m.cLine(0).arcCount()).toBe(4);

    // Two entry mitres and the two at the top of the U.
    // 4 quarter-circles of r = 240000, two sides of 520000, top and tail of
    // 120000 each.
    const byHand = 4 * ((240000 * Math.PI) / 2) + 2 * 520000 + 2 * 120000;

    expect(m.currentLength()).toBeCloseTo(byHand, -1);

    // Rounded corners are shorter than the square path they replace, so the
    // chamfered version of the same meander is longer.
    const chamfer = fitted(
      MeanderType.MT_SINGLE,
      permissive({ cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER }),
    );

    expect(m.currentLength()).toBeGreaterThan(chamfer.currentLength());
  });

  it('the right-side meander is the left-side one mirrored about the baseline', () => {
    const placer = permissive({ cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER });
    const left = fitted(MeanderType.MT_SINGLE, placer, false);
    const right = fitted(MeanderType.MT_SINGLE, placer, true);

    // `-0` is a different value to `0` under deep equality, and the mirror
    // produces the latter, so the expectation has to say so too.
    expect(points(right)).toEqual(points(left).map((p) => ({ x: p.x, y: p.y === 0 ? 0 : -p.y })));

    // Same length, opposite bulge — the mirror is exact, not approximate.
    expect(right.currentLength()).toBe(left.currentLength());
    expect(right.baseSegment()).toEqual(left.baseSegment());
  });

  it('a dual meander puts its two lines either side of the baseline', () => {
    const m = new MeanderShape(permissive(), WIDTH, true);

    m.setBaselineOffset(150000);
    expect(m.fit(MeanderType.MT_SINGLE, LONG, LONG.a, false)).toBe(true);

    expect(points(m, 0)[0]).toEqual({ x: 0, y: 150000 });
    expect(points(m, 1)[0]).toEqual({ x: 0, y: -150000 });

    // The clipped base segment is the *midline*, so it lands back on y = 0 and
    // spans two of the (widened) dual spacings.
    expect(m.baseSegment()).toEqual({ a: { x: 0, y: 0 }, b: { x: 1400000, y: 0 } });
  });

  it('the dual baseline comes from a *truncated* midpoint of the two lines', () => {
    // On a diagonal base segment the two lines' endpoints no longer sum to an
    // even number, so `(a + b) / 2` on a VECTOR2I loses a half unit — toward
    // zero, not to nearest. The projection of that midpoint is what the tuner
    // then measures its baseline against.
    const m = new MeanderShape(permissive(), WIDTH, true);
    const diagonal: Seg = { a: { x: 0, y: 0 }, b: { x: 5000001, y: 12000007 } };

    m.setBaselineOffset(150000);
    expect(m.fit(MeanderType.MT_SINGLE, diagonal, diagonal.a, false)).toBe(true);

    const last0 = m.cLine(0).cLastPoint();
    const last1 = m.cLine(1).cLastPoint();

    expect((last0.x + last1.x) % 2).toBe(1);
    expect((last0.y + last1.y) % 2).toBe(1);

    expect(m.baseSegment()).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 538461, y: 1292307 },
    });
  });

  it('MT_START, MT_TURN and MT_FINISH span different baselines', () => {
    const placer = permissive();

    // start: two mitres in, one spacing plus a corner of run-out.
    expect(fitted(MeanderType.MT_START, placer).baseSegment().b.x).toBe(840000);
    // turn: exactly one spacing.
    expect(fitted(MeanderType.MT_TURN, placer).baseSegment().b.x).toBe(600000);
    // finish: the mirror of start, plus the trailing Resize.
    expect(fitted(MeanderType.MT_FINISH, placer).baseSegment().b.x).toBe(960000);
  });

  it('drops a forward step shorter than five units', () => {
    // Tuned so the U's sides come out exactly 2 IU long: amplitude 200002
    // against a corner radius of 100000, so `startSide = amplitude - 2 * cr`
    // is 2. Upstream refuses to draw it — "very small segments cause problems"
    // — and the U is a flat-bottomed shape with no sides at all.
    const placer = basicMeanderPlacer(
      {
        ...defaultMeanderSettings(),
        spacing: 400000,
        minAmplitude: 200002,
        maxAmplitude: 200002,
        cornerRadiusPercentage: 50,
      },
      0,
      () => true,
    );
    const m = new MeanderShape(placer, WIDTH, false);

    expect(m.fit(MeanderType.MT_SINGLE, LONG, LONG.a, false)).toBe(true);
    expect(m.amplitude() - 2 * m.meanCornerRadius()).toBe(2);

    // No plain segment shorter than the guard survives into the chain. Arc
    // segments are exempt: they are the polygonization of a curve, and its
    // chords are as short as the error budget makes them.
    const chain = m.cLine(0);

    for (let i = 0; i < chain.segmentCount(); i++) {
      if (!chain.isArcSegment(i)) expect(segLength(chain.cSegment(i))).toBeGreaterThanOrEqual(5);
    }

    expect(chain.pointCount()).toBe(31);
  });

  it('MakeEmpty replaces the meander with the straight bypass it spanned', () => {
    const m = fitted(MeanderType.MT_SINGLE, permissive());

    m.makeEmpty();

    expect(m.type()).toBe(MeanderType.MT_EMPTY);
    expect(m.amplitude()).toBe(0);
    expect(points(m)).toEqual([
      { x: 0, y: 0 },
      { x: 1200000, y: 0 },
    ]);
    // The clipped baseline still describes the extent the meander had, because
    // MakeEmpty deliberately does not re-run updateBaseSegment afterwards.
    expect(m.baselineLength()).toBe(1200000);
  });

  it('Resize refuses a negative amplitude and floors at the minimum', () => {
    const m = fitted(MeanderType.MT_SINGLE, permissive());

    expect(m.amplitude()).toBe(1000000);

    m.resize(400000);
    expect(m.amplitude()).toBe(400000);

    m.resize(-5);
    expect(m.amplitude()).toBe(400000);

    // minAmplitude here is max( 200000, 0 + 200000 ) = 200000.
    m.resize(1);
    expect(m.amplitude()).toBe(200000);
  });

  it('MinTunableLength shrinks the amplitude without shrinking the footprint', () => {
    const m = fitted(MeanderType.MT_SINGLE, permissive());
    const before = m.baselineLength();
    const min = m.minTunableLength();

    expect(min).toBeLessThan(m.currentLength());
    // Asking the question must not have changed the shape: it works on a copy.
    expect(m.amplitude()).toBe(1000000);
    expect(m.baselineLength()).toBe(before);
    // And it is still at least as long as the baseline it has to span.
    expect(min).toBeGreaterThan(before);
  });

  it('a corner is a zero-length baseline at its own point', () => {
    const m = new MeanderShape(permissive(), WIDTH, true);

    m.makeCorner({ x: 5, y: 7 }, { x: 9, y: 11 });

    expect(m.type()).toBe(MeanderType.MT_CORNER);
    expect(m.baseSegment()).toEqual({ a: { x: 5, y: 7 }, b: { x: 5, y: 7 } });
    // The second point is written even though nothing dual asked for it.
    expect(points(m, 0)).toEqual([{ x: 5, y: 7 }]);
    expect(points(m, 1)).toEqual([{ x: 9, y: 11 }]);
  });

  it('an arc corner reports MT_CORNER and anchors at the arc *end*', () => {
    const arc = {
      p0: { x: 0, y: 0 },
      arcMid: { x: 100000, y: 41421 },
      p1: { x: 200000, y: 0 },
      width: 0,
    };
    const m = new MeanderShape(permissive(), WIDTH, false);

    m.makeArc(arc);

    // Not MT_ARC — which is why CheckSelfIntersections skips it with the
    // other corners.
    expect(m.type()).toBe(MeanderType.MT_CORNER);
    expect(m.baseSegment()).toEqual({ a: { x: 200000, y: 0 }, b: { x: 200000, y: 0 } });
    expect(m.cLine(0).arcCount()).toBe(1);
    // It measures as an arc, not as its chord.
    expect(m.currentLength()).toBeGreaterThan(200000);
  });
});

// ---------------------------------------------------------------------------

describe('MEANDER_SHAPE::Fit', () => {
  it('takes the largest amplitude the placer will accept', () => {
    const seen: number[] = [];
    const placer = basicMeanderPlacer(defaultMeanderSettings(), CLEARANCE, (s) => {
      seen.push(s.amplitude());
      return s.amplitude() <= 700000;
    });
    const m = new MeanderShape(placer, WIDTH, false);

    expect(m.fit(MeanderType.MT_SINGLE, LONG, LONG.a, false)).toBe(true);

    // Walked down from maxAmplitude in m_step increments and stopped at the
    // first acceptance.
    expect(seen).toEqual([1000000, 950000, 900000, 850000, 800000, 750000, 700000]);
    expect(m.amplitude()).toBe(700000);
  });

  it('fails when nothing in the amplitude range is accepted', () => {
    const m = new MeanderShape(
      basicMeanderPlacer(defaultMeanderSettings(), CLEARANCE),
      WIDTH,
      false,
    );

    // The base class's CheckFit returns false, so this is upstream's answer for
    // a placer that has not been specialised.
    expect(m.fit(MeanderType.MT_SINGLE, LONG, LONG.a, false)).toBe(false);
  });

  it('refuses a corner radius under half the track width (issue #8629)', () => {
    // Reaching this at all takes a chamfer, because a *round* meander's
    // minAmplitude is a whole track width and the amplitude bound on the radius
    // is then never the binding one. With a chamfer the floor drops to
    // 0.663 * width, so the radius is bounded at 0.331 * width — below the half
    // width the fit insists on.
    const asked: number[] = [];
    const placer = basicMeanderPlacer(
      {
        ...defaultMeanderSettings(),
        cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER,
        minAmplitude: 1,
        maxAmplitude: 1,
      },
      CLEARANCE,
      (s) => {
        asked.push(s.amplitude());
        return true;
      },
    );
    const m = new MeanderShape(placer, 1000000, false);

    expect(m.fit(MeanderType.MT_SINGLE, LONG, LONG.a, false)).toBe(false);
    // The placer was never even consulted: the one candidate amplitude was
    // rejected on the radius before CheckFit could say yes.
    expect(asked).toEqual([]);
  });

  it('check mode requires *both* halves of a turn to fit', () => {
    const placer = basicMeanderPlacer(
      defaultMeanderSettings(),
      CLEARANCE,
      (s) =>
        // Accept a start, refuse the turn that would have to follow it.
        s.type() === MeanderType.MT_START,
    );
    const m = new MeanderShape(placer, WIDTH, false);

    expect(m.fit(MeanderType.MT_CHECK_START, LONG, LONG.a, false)).toBe(false);
  });

  it('check mode wipes the base index the caller set — upstream oddity', () => {
    const placer = permissive();
    const m = new MeanderShape(placer, WIDTH, false);

    m.setBaseIndex(7);

    // A direct fit keeps it.
    expect(m.fit(MeanderType.MT_SINGLE, LONG, LONG.a, false)).toBe(true);
    expect(m.baseIndex()).toBe(7);

    // A check-mode fit copies it back from a default-constructed probe, whose
    // base index is 0.
    expect(m.fit(MeanderType.MT_CHECK_START, LONG, LONG.a, false)).toBe(true);
    expect(m.type()).toBe(MeanderType.MT_START);
    expect(m.baseIndex()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('MEANDERED_LINE::MeanderSegment', () => {
  const meandered = (aPlacer: MeanderPlacer, aSeg: Seg, aBaseIndex = 0): MeanderedLine => {
    const line = new MeanderedLine(aPlacer, false);

    line.setWidth(WIDTH);
    line.meanderSegment(aSeg, false, aBaseIndex);

    return line;
  };

  it('opens with a start, runs turns, and closes with a finish', () => {
    const line = meandered(permissive(), LONG, 3);
    const types = line.meanders().map((m) => m.type());

    expect(types[0]).toBe(MeanderType.MT_CORNER);
    expect(types[1]).toBe(MeanderType.MT_START);
    expect(types.at(-2)).toBe(MeanderType.MT_FINISH);
    expect(types.at(-1)).toBe(MeanderType.MT_CORNER);
    expect(new Set(types.slice(2, -2))).toEqual(new Set([MeanderType.MT_TURN]));

    // The turns tile the baseline at exactly one spacing each, with no gaps.
    const turns = line.meanders().filter((m) => m.type() === MeanderType.MT_TURN);

    for (const t of turns) {
      expect(t.baseSegment().b.x - t.baseSegment().a.x).toBe(600000);
    }

    // Only the FINISH — fitted directly rather than through a check — keeps the
    // caller's base index. Everything from a check-mode fit reports 0.
    expect(line.meanders()[1]?.baseIndex()).toBe(0);
    expect(line.meanders().at(-2)?.baseIndex()).toBe(3);
  });

  it('a single-sided line lays independent meanders, never a turn', () => {
    const line = meandered(permissive({ singleSided: true }), {
      a: { x: 0, y: 0 },
      b: { x: 5000000, y: 0 },
    });
    const inner = line.meanders().slice(1, -1);

    expect(inner.map((m) => m.type())).toEqual(Array(4).fill(MeanderType.MT_SINGLE));
    // Each one occupies two spacings, back to back.
    expect(inner.map((m) => m.baseSegment().a.x)).toEqual([0, 1200000, 2400000, 3600000]);
    // All on the side it was asked for.
    expect(inner.every((m) => m.side() === false)).toBe(true);
  });

  it('records the side it had to flip to as the *initial* side', () => {
    const settings = defaultMeanderSettings();
    // Refuse anything drawn on the left.
    const placer = basicMeanderPlacer(settings, CLEARANCE, (s) => s.side());

    expect(placer.meanderSettings().initialSide).toBe(MeanderSide.MEANDER_SIDE_LEFT);

    const line = meandered(placer, LONG);

    expect(placer.meanderSettings().initialSide).toBe(MeanderSide.MEANDER_SIDE_RIGHT);

    const bodies = line.meanders().filter((m) => m.type() !== MeanderType.MT_CORNER);

    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((m) => m.side())).toBe(true);
  });

  it('walks forward one spacing plus a step when nothing fits', () => {
    // The base placer refuses everything, so the segment fills with corners.
    const line = meandered(basicMeanderPlacer(defaultMeanderSettings(), CLEARANCE), {
      a: { x: 0, y: 0 },
      b: { x: 3000000, y: 0 },
    });

    expect(line.meanders().map((m) => m.baseSegment().a.x)).toEqual([
      0, 650000, 1300000, 1950000, 2600000, 3000000,
    ]);
  });

  it('the skip distance ignores the corner radius — upstream oddity', () => {
    // `nextP = tmp.spacing() - 2 * tmp.cornerRadius() + m_step`, and `tmp` is
    // freshly constructed so its amplitude — and therefore its corner radius —
    // is zero. Changing the radius percentage must move nothing.
    const positions = (aPct: number): number[] => {
      const s = defaultMeanderSettings();

      s.cornerRadiusPercentage = aPct;

      return meandered(basicMeanderPlacer(s, CLEARANCE), {
        a: { x: 0, y: 0 },
        b: { x: 3000000, y: 0 },
      })
        .meanders()
        .map((m) => m.baseSegment().a.x);
    };

    expect(positions(10)).toEqual(positions(80));
    expect(positions(100)).toEqual(positions(80));
  });

  it('AddCorner stops at its point, AddArc at the arc *start*', () => {
    const line = new MeanderedLine(permissive(), false);
    const arc = {
      p0: { x: 10, y: 20 },
      arcMid: { x: 60, y: 45 },
      p1: { x: 110, y: 20 },
      width: 0,
    };

    line.setWidth(WIDTH);

    line.addCorner({ x: 3, y: 4 });
    expect(line.last()).toEqual({ x: 3, y: 4 });

    line.addArc(arc);
    // `m_last = aArc1.GetP0()` in AddArc, while MakeArc anchored the shape's
    // baseline at GetP1(). The two disagree on purpose.
    expect(line.last()).toEqual({ x: 10, y: 20 });
    expect(line.meanders().at(-1)?.baseSegment().a).toEqual({ x: 110, y: 20 });

    // A point stands in for the other line as a zero-radius arc.
    line.addPtAndArc({ x: 1, y: 2 }, arc);
    expect(line.last()).toEqual({ x: 1, y: 2 });

    line.addArcAndPt(arc, { x: 7, y: 8 });
    expect(line.last()).toEqual({ x: 10, y: 20 });

    expect(line.meanders()).toHaveLength(4);
    line.clear();
    expect(line.meanders()).toHaveLength(0);
  });

  it('stops rather than walking past the end of the base segment', () => {
    // Shorter than one skip, so the loop never places a second corner.
    const line = meandered(basicMeanderPlacer(defaultMeanderSettings(), CLEARANCE), {
      a: { x: 0, y: 0 },
      b: { x: 400000, y: 0 },
    });

    expect(line.meanders().map((m) => m.baseSegment().a)).toEqual([
      { x: 0, y: 0 },
      { x: 400000, y: 0 },
    ]);
  });

  it('a dual line gets no bracketing corners', () => {
    const line = new MeanderedLine(permissive(), true);

    line.setWidth(WIDTH);
    line.setBaselineOffset(150000);
    line.meanderSegment(LONG, false, 0);

    expect(line.meanders().some((m) => m.type() === MeanderType.MT_CORNER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('MEANDERED_LINE::CheckSelfIntersections', () => {
  const withHorizontal = (): { line: MeanderedLine; placer: MeanderPlacer } => {
    const placer = permissive();
    const line = new MeanderedLine(placer, false);

    line.setWidth(WIDTH);
    line.addMeander(fitted(MeanderType.MT_SINGLE, placer));

    return { line, placer };
  };

  const perpendicularAt = (aPlacer: MeanderPlacer, aY: number): MeanderShape =>
    fitted(MeanderType.MT_SINGLE, aPlacer, false, {
      a: { x: 300000, y: aY },
      b: { x: 300000, y: aY + 10000000 },
    });

  it('rejects a crossing meander and accepts a distant one', () => {
    const { line, placer } = withHorizontal();

    expect(line.checkSelfIntersections(perpendicularAt(placer, -400000), 0)).toBe(false);
    expect(line.checkSelfIntersections(perpendicularAt(placer, 0), 0)).toBe(false);
    expect(line.checkSelfIntersections(perpendicularAt(placer, 3000000), 0)).toBe(true);
  });

  it('never compares meanders whose baselines are parallel', () => {
    const { line, placer } = withHorizontal();
    // The identical meander, laid on the identical baseline. Geometrically it
    // overlaps completely; the parallel test skips it before any collision
    // check runs, because meanders on one baseline are tiled, not stacked.
    const twin = fitted(MeanderType.MT_SINGLE, placer);

    expect(line.checkSelfIntersections(twin, 0)).toBe(true);
  });

  it('skips corners and emptied meanders, which have nothing to hit', () => {
    const placer = permissive();
    const line = new MeanderedLine(placer, false);

    line.setWidth(WIDTH);

    const emptied = fitted(MeanderType.MT_SINGLE, placer);

    emptied.makeEmpty();
    line.addMeander(emptied);
    line.addCorner({ x: 300000, y: 0 });

    // The crossing meander from the test above now finds nothing to collide
    // with, because both entries are skipped by type.
    expect(line.checkSelfIntersections(perpendicularAt(placer, 0), 0)).toBe(true);
  });

  it('the clearance comparison is strict: exactly the clearance does not hit', () => {
    const m = fitted(MeanderType.MT_SINGLE, permissive());
    const chain = m.cLine(0);
    // The top of the U sits at y = 1000000 between x = 480000 and x = 600000.
    const touching: Seg = { a: { x: 600000, y: 1000000 }, b: { x: 600000, y: 2000000 } };
    const tenAway: Seg = { a: { x: 600000, y: 1000010 }, b: { x: 600000, y: 2000000 } };

    expect(lineChainCollideSeg(chain, touching, 0)).toBe(true);
    expect(lineChainCollideSeg(chain, tenAway, 0)).toBe(false);
    expect(lineChainCollideSeg(chain, tenAway, 10)).toBe(false);
    expect(lineChainCollideSeg(chain, tenAway, 11)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('MEANDER_SETTINGS', () => {
  it('the unconstrained value opens the window instead of centring on it', () => {
    const s = defaultMeanderSettings();

    expect(s.targetLength).toEqual({
      opt: MEANDER_LENGTH_UNCONSTRAINED,
      min: 0,
      max: MEANDER_LENGTH_UNCONSTRAINED,
    });
    expect(s.targetLengthDelay).toEqual({
      opt: MEANDER_DELAY_UNCONSTRAINED,
      min: 0,
      max: MEANDER_DELAY_UNCONSTRAINED,
    });

    setTargetLength(s, 50000000);
    expect(s.targetLength).toEqual({
      opt: 50000000,
      min: 50000000 - MEANDER_DEFAULT_LENGTH_TOLERANCE,
      max: 50000000 + MEANDER_DEFAULT_LENGTH_TOLERANCE,
    });
  });

  it('an explicit min or max overrides the tolerance window', () => {
    const s = defaultMeanderSettings();

    setTargetLengthFromConstraint(s, { opt: 50000000, max: 60000000 });

    expect(s.targetLength).toEqual({
      opt: 50000000,
      min: 50000000 - MEANDER_DEFAULT_LENGTH_TOLERANCE,
      max: 60000000,
    });

    // A constraint with no opt takes its min as the opt, per MINOPTMAX::Opt().
    const t = defaultMeanderSettings();

    setTargetLengthFromConstraint(t, { min: 1000 });
    expect(t.targetLength.opt).toBe(1000);
    expect(t.targetLength.min).toBe(1000);
  });

  it('the skew-delay setter widens by the *length* tolerance — upstream oddity', () => {
    const s = defaultMeanderSettings();

    setTargetSkewDelay(s, 4000);

    // pns_meander.cpp:222 reads DEFAULT_LENGTH_TOLERANCE where every other
    // delay setter reads DEFAULT_DELAY_TOLERANCE. The two constants happen to
    // hold the same number today, so this pins the intent rather than a
    // difference: it is here so the oddity is not silently "corrected".
    expect(MEANDER_DEFAULT_LENGTH_TOLERANCE).toBe(MEANDER_DEFAULT_DELAY_TOLERANCE);
    expect(s.targetSkewDelay).toEqual({
      opt: 4000,
      min: 4000 - MEANDER_DEFAULT_LENGTH_TOLERANCE,
      max: 4000 + MEANDER_DEFAULT_LENGTH_TOLERANCE,
    });

    // ...and its unconstrained sentinel is the *skew* one, not the delay one.
    setTargetSkewDelay(s, MEANDER_SKEW_UNCONSTRAINED);
    expect(s.targetSkewDelay.min).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('the SEG and SHAPE_ARC operations underneath', () => {
  it('SEG::Length truncates the norm rather than rounding it', () => {
    expect(segLength({ a: { x: 0, y: 0 }, b: { x: 3, y: 4 } })).toBe(5);
    // hypot(2, 2) = 2.828: truncated to 2, where rounding would say 3.
    expect(segLength({ a: { x: 0, y: 0 }, b: { x: 2, y: 2 } })).toBe(2);
    expect(segLength({ a: { x: 0, y: 0 }, b: { x: 5, y: 5 } })).toBe(7);
  });

  it('SEG::Contains allows three square IU of slop and no more', () => {
    const s: Seg = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } };

    expect(segContains(s, { x: 500, y: 0 })).toBe(true);
    expect(segContains(s, { x: 500, y: 1 })).toBe(true);
    expect(segContains(s, { x: 500, y: 2 })).toBe(false);
    // Past the end, measured from the endpoint.
    expect(segContains(s, { x: 1001, y: 1 })).toBe(true);
    expect(segContains(s, { x: 1002, y: 0 })).toBe(false);
  });

  it('LineProject lands on the infinite line, and a degenerate seg answers A', () => {
    const s: Seg = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } };

    expect(segLineProject(s, { x: 400, y: 900 })).toEqual({ x: 400, y: 0 });
    // Past the end: the *line*, not the segment.
    expect(segLineProject(s, { x: 5000, y: 3 })).toEqual({ x: 5000, y: 0 });
    expect(segLineProject({ a: { x: 7, y: 9 }, b: { x: 7, y: 9 } }, { x: 0, y: 0 })).toEqual({
      x: 7,
      y: 9,
    });
  });

  it('ReflectPoint returns a zero-length segment its own point, not a flip', () => {
    const s: Seg = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } };

    expect(segReflectPoint(s, { x: 400, y: 900 })).toEqual({ x: 400, y: -900 });
    expect(segReflectPoint({ a: { x: 7, y: 9 }, b: { x: 7, y: 9 } }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('ApproxParallel is signed, so a crossing segment is not parallel', () => {
    const base: Seg = { a: { x: 0, y: 0 }, b: { x: 10000, y: 0 } };

    expect(segApproxParallel(base, { a: { x: 0, y: 50 }, b: { x: 10000, y: 50 } })).toBe(true);
    expect(segApproxParallel(base, { a: { x: 0, y: 0 }, b: { x: 0, y: 10000 } })).toBe(false);
    // Equal magnitudes, opposite signs: crossing, not parallel.
    expect(segApproxParallel(base, { a: { x: 5000, y: -500 }, b: { x: 5001, y: 500 } })).toBe(
      false,
    );
  });

  it('Resize keeps the sign of the length and collapses on zero', () => {
    expect(resizeD({ x: 3, y: 4 }, 10)).toEqual({ x: 6, y: 8 });
    expect(resizeD({ x: 3, y: 4 }, -10)).toEqual({ x: -6, y: -8 });
    expect(resizeD({ x: 3, y: 4 }, 0)).toEqual({ x: 0, y: 0 });
    expect(resizeD({ x: 0, y: 0 }, 10)).toEqual({ x: 0, y: 0 });

    // The |x| == |y| special case is exact rather than two square roots.
    const diag = resizeD({ x: 100, y: -100 }, 200);

    expect(diag.x).toBeCloseTo(200 * Math.SQRT1_2, 12);
    expect(diag.y).toBeCloseTo(-200 * Math.SQRT1_2, 12);
  });

  it('ConstructFromStartEndAngle puts the mid point on the swept side', () => {
    const cw = constructArcFromStartEndAngle({ x: 0, y: 0 }, { x: 1000, y: 1000 }, ANGLE_90);
    const ccw = constructArcFromStartEndAngle(
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      ANGLE_90.negate(),
    );

    // Same chord, opposite bulge.
    expect(cw.arcMid.x).toBeGreaterThan(500);
    expect(ccw.arcMid.x).toBeLessThan(500);
    expect(shapeArcCenter(cw)).not.toEqual(shapeArcCenter(ccw));

    // A quarter turn of a circle through both endpoints.
    expect(Math.abs(arcCentralAngle(cw).AsDegrees())).toBeCloseTo(90, 3);
    expect(arcLength(cw)).toBeCloseTo((arcRadius(cw) * Math.PI) / 2, 6);
  });

  it('ConvertToPolyline keeps the exact endpoints and stays inside the budget', () => {
    const arc = constructArcFromStartEndAngle({ x: 0, y: 0 }, { x: 240000, y: 240000 }, ANGLE_90);
    const poly = arcConvertToPolyline(arc, 1000);

    expect(poly[0]).toEqual(arc.p0);
    expect(poly.at(-1)).toEqual(arc.p1);
    expect(poly.length).toBeGreaterThan(2);

    // Every interior point sits within the error budget of the true circle.
    const c = shapeArcCenter(arc);
    const r = arcRadius(arc);

    for (const p of poly) {
      expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)).toBeLessThan(1000);
    }

    // A polyline is not a substitute for the arc's length, and — because the
    // radius is grown by half the achieved error so the chords straddle the
    // curve rather than cutting inside it — it comes out slightly *longer*
    // here, not shorter. The naive intuition is the wrong way round.
    let chordSum = 0;

    for (let i = 1; i < poly.length; i++) {
      chordSum += Math.hypot(poly[i]!.x - poly[i - 1]!.x, poly[i]!.y - poly[i - 1]!.y);
    }

    expect(chordSum).toBeGreaterThan(arcLength(arc));
    expect(chordSum - arcLength(arc)).toBeLessThan(1000);
  });

  it('chainLength measures arcs as arcs and plain segments as segments', () => {
    const m = fitted(MeanderType.MT_SINGLE, permissive());
    const chain = m.cLine(0);

    let straightSum = 0;
    let polylineSum = 0;
    let arcSegments = 0;

    for (let i = 0; i < chain.segmentCount(); i++) {
      polylineSum += segLength(chain.cSegment(i));

      if (chain.isArcSegment(i)) arcSegments++;
      else straightSum += segLength(chain.cSegment(i));
    }

    // Upstream accumulates into an int64, so each arc's fractional length is
    // dropped as it is added — not once at the end.
    let total = straightSum;

    for (let i = 0; i < chain.arcCount(); i++) total = Math.trunc(total + arcLength(chain.arc(i)));

    expect(arcSegments).toBeGreaterThan(0);
    expect(Number.isInteger(chainLength(chain))).toBe(true);
    expect(chainLength(chain)).toBe(total);
    // And that is *not* the same as summing the polyline, which over-reports
    // here because the polygonized chords straddle the true curve.
    expect(chainLength(chain)).not.toBe(polylineSum);
  });
});
