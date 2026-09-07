// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The lines a dimension draws as.
 * Counterparts: `PCB_DIM_*::updateGeometry` and `PCB_DIMENSION_BASE::drawAnArrow`.
 *
 * The arrowhead maths is where a silent mirror would hide: upstream composes
 * `RotatePoint(v, -EDA_ANGLE(u) ± 27.5°)`, and `RotatePoint` is *clockwise* in
 * maths terms because y points down. Rebuilding that from unit vectors is only
 * equivalent if the sign survives, so the equivalence is pinned at the angles
 * `EDA_ANGLE` itself special-cases (0, ±90, ±180, ±45) rather than assumed.
 *
 * Fixtures are in millimetres. The geometry rounds to whole IU, so a fixture in
 * raw IU would be nanometres across and rounding would dominate every number.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PcbDimension, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';
import {
  ARROW_ANGLE_DEG,
  INWARD_ARROW_LENGTH_TO_HEAD_RATIO,
  arrowSegments,
  dimensionBBox,
  dimensionSegments,
  distanceToDimension,
  hitTestDimension,
  measuredValue,
  resize,
  textKnockoutPoly,
  type DimSegment,
} from '@ziroeda/pcbnew/src/dimension_geometry.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number): { x: number; y: number } => ({ x: MM(x), y: MM(y) });

const text = (x: number, y: number): PcbTextItem => ({
  kind: 'user',
  text: '10',
  at: P(x, y),
  angle: 0,
  layer: 'Dwgs.User',
  size: { x: MM(1), y: MM(1) },
  source: EMPTY,
});

const dim = (over: Partial<PcbDimension> = {}): PcbDimension => ({
  kind: 'aligned',
  layer: 'Dwgs.User',
  start: P(0, 0),
  end: P(10, 0),
  height: MM(5),
  style: {
    thickness: MM(0.15),
    arrowLength: MM(1.27),
    textPositionMode: 0,
    arrowDirection: 'outward',
    extensionHeight: MM(0.58642),
    extensionOffset: MM(0.5),
  },
  source: EMPTY,
  ...over,
});

const len = (s: DimSegment): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
/** Angle of a segment in degrees, measured as EDA_ANGLE does: atan2(y, x). */
const angleOf = (s: DimSegment): number =>
  (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;

describe('resizing a vector', () => {
  it('keeps the direction and sets the length', () => {
    expect(resize({ x: MM(3), y: MM(4) }, MM(10))).toEqual({ x: MM(6), y: MM(8) });
  });

  it('reverses on a negative length', () => {
    // The aligned crossbar arithmetic depends on this.
    expect(resize({ x: MM(1), y: 0 }, MM(-5))).toEqual({ x: MM(-5), y: 0 });
  });

  it('leaves a zero vector at zero, having no direction to keep', () => {
    expect(resize({ x: 0, y: 0 }, MM(5))).toEqual({ x: 0, y: 0 });
  });
});

describe('the arrowhead', () => {
  it('opens 27.5 degrees either side of the direction', () => {
    // Stated as a literal, not as ARROW_ANGLE_DEG: an expectation computed from
    // the constant it is checking moves with it and proves nothing.
    const [pos, neg] = arrowSegments({ x: 0, y: 0 }, { x: MM(1), y: 0 }, MM(2));

    expect(angleOf(pos!)).toBeCloseTo(-27.5, 1);
    expect(angleOf(neg!)).toBeCloseTo(27.5, 1);
    expect(ARROW_ANGLE_DEG).toBe(27.5);
  });

  it('makes both barbs the arrow length', () => {
    const segs = arrowSegments({ x: 0, y: 0 }, { x: MM(1), y: MM(1) }, MM(2));

    for (const s of segs) expect(len(s) / MM(2)).toBeCloseTo(1, 3);
  });

  it('follows the direction it is given, not the axis', () => {
    // Pointing straight down (+y on screen): the barbs must straddle 90°, not 0°.
    const [pos, neg] = arrowSegments({ x: 0, y: 0 }, { x: 0, y: MM(1) }, MM(2));

    expect(angleOf(pos!)).toBeCloseTo(90 - ARROW_ANGLE_DEG, 1);
    expect(angleOf(neg!)).toBeCloseTo(90 + ARROW_ANGLE_DEG, 1);
  });

  it('straddles the direction at every angle EDA_ANGLE special-cases', () => {
    // 0, ±90, ±180 and ±45 are hard-coded upstream to dodge float error; if the
    // rotation sign were flipped, the two barbs would swap and this is where it
    // would show.
    for (const [dx, dy, expected] of [
      [1, 0, 0],
      [0, 1, 90],
      [0, -1, -90],
      [-1, 0, 180],
      [1, 1, 45],
      [1, -1, -45],
    ] as const) {
      const [pos, neg] = arrowSegments({ x: 0, y: 0 }, { x: MM(dx), y: MM(dy) }, MM(2));
      const norm = (a: number): number => ((((a - expected) % 360) + 540) % 360) - 180;

      expect(norm(angleOf(pos!)), `${dx},${dy}`).toBeCloseTo(-ARROW_ANGLE_DEG, 1);
      expect(norm(angleOf(neg!)), `${dx},${dy}`).toBeCloseTo(ARROW_ANGLE_DEG, 1);
    }
  });

  it('adds no tail unless asked', () => {
    expect(arrowSegments({ x: 0, y: 0 }, { x: MM(1), y: 0 }, MM(2))).toHaveLength(2);
  });

  it('adds a tail of the asked-for length, along the direction', () => {
    const segs = arrowSegments({ x: 0, y: 0 }, { x: MM(1), y: 0 }, MM(2), MM(4));

    expect(segs).toHaveLength(3);
    expect(segs[0]!.b).toEqual({ x: MM(4), y: 0 });
  });

  it('keeps the head its own length when a tail is added', () => {
    // The tail is a multiple of the head, not a replacement for it.
    const segs = arrowSegments({ x: 0, y: 0 }, { x: MM(1), y: 0 }, MM(2), MM(4));

    expect(len(segs[1]!) / MM(2)).toBeCloseTo(1, 3);
    expect(len(segs[2]!) / MM(2)).toBeCloseTo(1, 3);
  });
});

describe('what a dimension measures', () => {
  it('is the distance between the feature points when aligned', () => {
    expect(measuredValue(dim({ start: P(0, 0), end: P(3, 4) }))).toBe(MM(5));
  });

  it('is one axis only when orthogonal', () => {
    // The whole point of an orthogonal dimension: a diagonal pair still
    // measures the horizontal or vertical span, never the diagonal.
    const diag = { start: P(0, 0), end: P(3, 4) };

    expect(measuredValue(dim({ ...diag, kind: 'orthogonal', orientation: 0 }))).toBe(MM(3));
    expect(measuredValue(dim({ ...diag, kind: 'orthogonal', orientation: 1 }))).toBe(MM(4));
  });

  it('is never negative', () => {
    expect(
      measuredValue(dim({ kind: 'orthogonal', orientation: 0, start: P(10, 0), end: P(0, 0) })),
    ).toBe(MM(10));
  });

  it('is nothing for a centre mark, which measures nothing', () => {
    expect(measuredValue(dim({ kind: 'center' }))).toBe(0);
  });
});

describe('an aligned dimension', () => {
  it('draws two extension lines, a crossbar and two arrow pairs', () => {
    // 2 extensions + 1 crossbar + 2 barbs at each end.
    expect(dimensionSegments(dim())).toHaveLength(2 + 1 + 4);
  });

  it('puts the crossbar the height away, on the side the sign picks', () => {
    // Upstream picks the perpendicular by the sign: `(-v.y, v.x)` for a
    // positive height, which for a left-to-right dimension points +y. So a
    // positive height puts the crossbar *below* on screen, not above.
    const up = dimensionSegments(dim({ height: MM(5) }))[2]!;
    const down = dimensionSegments(dim({ height: MM(-5) }))[2]!;

    expect(up.a.y).toBe(MM(5));
    expect(down.a.y).toBe(MM(-5));
  });

  it('spans the crossbar between the feature points', () => {
    const bar = dimensionSegments(dim())[2]!;

    expect(bar.a.x).toBe(MM(0));
    expect(bar.b.x).toBe(MM(10));
    expect(bar.a.y).toBe(bar.b.y);
  });

  it('starts the extension lines offset from the feature points', () => {
    // The offset is what stops the line touching the thing being measured.
    const ext = dimensionSegments(dim())[0]!;

    expect(ext.a).toEqual({ x: MM(0), y: MM(0.5) });
  });

  it('runs the extension lines past the crossbar', () => {
    // |height| - offset + extensionHeight, so the line overshoots by
    // extensionHeight, which is what makes the corner look finished.
    const ext = dimensionSegments(dim())[0]!;

    expect(len(ext) / MM(5 - 0.5 + 0.58642)).toBeCloseTo(1, 4);
  });

  it('points outward arrows away from the measurement', () => {
    const segs = dimensionSegments(dim({ style: { ...dim().style, arrowDirection: 'outward' } }));
    // The pair at the crossbar start opens towards +x, so the point is outward.
    expect(Math.cos((angleOf(segs[3]!) * Math.PI) / 180)).toBeGreaterThan(0);
  });

  it('points inward arrows the other way, and gives them tails', () => {
    const out = dimensionSegments(dim({ style: { ...dim().style, arrowDirection: 'outward' } }));
    const inw = dimensionSegments(dim({ style: { ...dim().style, arrowDirection: 'inward' } }));

    expect(inw.length).toBe(out.length + 2); // one tail at each end
    expect(Math.cos((angleOf(inw[4]!) * Math.PI) / 180)).toBeLessThan(0);
  });

  it('makes the inward tail twice the arrow length', () => {
    // Literal 2, not the constant, for the same reason as the arrow angle.
    const inw = dimensionSegments(dim({ style: { ...dim().style, arrowDirection: 'inward' } }));
    const tail = inw[3]!;

    expect(len(tail) / (MM(1.27) * 2)).toBeCloseTo(1, 3);
    expect(INWARD_ARROW_LENGTH_TO_HEAD_RATIO).toBe(2);
  });
});

describe('an orthogonal dimension', () => {
  const ortho = (over: Partial<PcbDimension> = {}): PcbDimension =>
    dim({ kind: 'orthogonal', orientation: 0, start: P(0, 0), end: P(10, 3), ...over });

  it('draws a crossbar along one axis only', () => {
    // Horizontal: the crossbar is level even though the feature points are not.
    const bar = dimensionSegments(ortho())[2]!;

    expect(bar.a.y).toBe(bar.b.y);
    expect(bar.a.x).toBe(MM(0));
    expect(bar.b.x).toBe(MM(10));
  });

  it('draws a vertical crossbar when the orientation says so', () => {
    const bar = dimensionSegments(ortho({ orientation: 1 }))[2]!;

    expect(bar.a.x).toBe(bar.b.x);
    expect(bar.a.y).toBe(MM(0));
    expect(bar.b.y).toBe(MM(3));
  });

  it('reaches the second extension line back to its feature point', () => {
    // The second extension spans the crossbar-to-feature-point gap, which is
    // not `height` — the two feature points are at different heights.
    const segs = dimensionSegments(ortho());
    const ext2 = segs[1]!;

    expect(len(ext2)).toBeGreaterThan(0);
    // It lies on the second feature point's x.
    expect(ext2.a.x).toBe(MM(10));
  });

  it('measures the axis the orientation names, not the diagonal', () => {
    expect(measuredValue(ortho())).toBe(MM(10));
    expect(measuredValue(ortho({ orientation: 1 }))).toBe(MM(3));
  });
});

describe('a centre dimension', () => {
  it('draws a cross of two arms', () => {
    expect(dimensionSegments(dim({ kind: 'center', start: P(0, 0), end: P(2, 0) }))).toHaveLength(
      2,
    );
  });

  it('centres both arms on the first feature point', () => {
    const [a, b] = dimensionSegments(dim({ kind: 'center', start: P(5, 5), end: P(7, 5) }));

    expect(a!.a).toEqual({ x: MM(3), y: MM(5) });
    expect(a!.b).toEqual({ x: MM(7), y: MM(5) });
    expect(b!.a).toEqual({ x: MM(5), y: MM(3) });
    expect(b!.b).toEqual({ x: MM(5), y: MM(7) });
  });

  it('makes the arms perpendicular', () => {
    const [a, b] = dimensionSegments(dim({ kind: 'center', start: P(0, 0), end: P(3, 4) }));
    const dot = (a!.b.x - a!.a.x) * (b!.b.x - b!.a.x) + (a!.b.y - a!.a.y) * (b!.b.y - b!.a.y);

    expect(Math.abs(dot) / MM(1) ** 2).toBeCloseTo(0, 3);
  });

  it('takes the arm length from the feature vector, not the arrow length', () => {
    const arms = dimensionSegments(dim({ kind: 'center', start: P(0, 0), end: P(9, 0) }));

    expect(len(arms[0]!)).toBe(MM(18)); // ±arm about the centre
  });
});

describe('a radial dimension', () => {
  const radial = dim({
    kind: 'radial',
    start: P(0, 0),
    end: P(10, 0),
    leaderLength: MM(3),
    text: text(20, 0),
  });

  it('draws a centre cross, a leader, a line to the text and an arrow', () => {
    expect(dimensionSegments(radial)).toHaveLength(2 + 1 + 1 + 2);
  });

  it('sizes the centre cross by the arrow length', () => {
    const arm = dimensionSegments(radial)[0]!;

    expect(len(arm)).toBe(MM(1.27) * 2);
  });

  it('runs the leader outward from the measured point by its own length', () => {
    const leader = dimensionSegments(radial)[2]!;

    expect(leader.a).toEqual({ x: MM(10), y: 0 });
    expect(leader.b).toEqual({ x: MM(13), y: 0 });
  });

  it('joins the leader tip to the text, stopping at the label', () => {
    // `CollectKnockedOutSegments( polyBox, textSeg, m_shapes )`: the run out to
    // the label stops where it meets the label's box, so the line never reaches
    // under the glyphs. The stop is therefore the box's near edge, not the text
    // anchor — which is where this used to end, because the knockout was not
    // ported.
    const toText = dimensionSegments(radial)[3]!;
    const poly = textKnockoutPoly(radial)!;
    const leftEdge = Math.min(...poly.map((p) => p.x));

    expect(toText.a).toEqual({ x: MM(13), y: 0 });
    expect(toText.b).toEqual({ x: leftEdge, y: 0 });
    // and it really is short of the anchor, so the assertion above is not
    // vacuously true for a box that happens to start at the text position.
    expect(toText.b.x).toBeLessThan(MM(20));
  });

  it('runs the whole way when the label is too far off to be hit', () => {
    // The other half of the knockout: `if( !containsA && !containsB &&
    // !endpointA && !endpointB )` puts the segment back whole. Without this
    // branch a label that never touches the line would still cut it.
    const far = dim({
      kind: 'radial',
      start: P(0, 0),
      end: P(10, 0),
      leaderLength: MM(3),
      text: { ...text(20, 0), at: P(20, 40) },
    });
    const toText = dimensionSegments(far)[3]!;

    expect(toText.a).toEqual({ x: MM(13), y: 0 });
    expect(toText.b.y).toBeLessThan(MM(40)); // stopped at the label it does reach
    const straight = dimensionSegments(far)[2]!;
    expect(straight.b).toEqual({ x: MM(13), y: 0 }); // the leader itself is untouched
  });

  it('measures the radius', () => {
    expect(measuredValue(radial)).toBe(MM(10));
  });
});

describe('a leader dimension', () => {
  const leader = dim({
    kind: 'leader',
    start: P(0, 0),
    end: P(10, 10),
    text: text(20, 10),
    style: { ...dim().style, textFrame: 0 },
  });

  it('draws the leader, a line to the text and an arrow', () => {
    expect(dimensionSegments(leader)).toHaveLength(1 + 1 + 2);
  });

  it('offsets the leader from the feature point', () => {
    // So the arrow does not sit on top of the thing it points at.
    const line = dimensionSegments(leader)[0]!;

    expect(line.a.x).toBeGreaterThan(0);
    expect(Math.hypot(line.a.x, line.a.y) / MM(0.5)).toBeCloseTo(1, 2);
  });

  it('points the arrow back at the feature point', () => {
    // The barbs open away from the start, so the point of the V is at the start
    // — a leader calls something out rather than measuring it.
    const segs = dimensionSegments(leader);
    const barb = segs[2]!;

    expect(barb.b.x).toBeGreaterThan(barb.a.x);
  });
});

describe('the bounding box', () => {
  it('covers every line', () => {
    const b = dimensionBBox(dim());

    expect(b.minX).toBeLessThanOrEqual(MM(0));
    expect(b.maxX).toBeGreaterThanOrEqual(MM(10));
  });

  it('adds half the stroke on every side', () => {
    // A line is drawn centred on its path, so its ink reaches half a width past
    // the endpoints.
    const thin = dimensionBBox(dim({ style: { ...dim().style, thickness: MM(0.1) } }));
    const thick = dimensionBBox(dim({ style: { ...dim().style, thickness: MM(1) } }));

    expect(thin.minX - thick.minX).toBeCloseTo(MM(0.45), -3);
  });
});

describe('hit testing', () => {
  it('hits a point on the crossbar', () => {
    const d = dim();
    const bar = dimensionSegments(d)[2]!;

    expect(hitTestDimension(d, { x: MM(5), y: bar.a.y })).toBe(true);
  });

  it('misses a point in the empty middle', () => {
    // Halfway between the feature line (y=0) and the crossbar (y=5), away from
    // either extension line: nothing is drawn there. This is the case a
    // bounding-box test would get wrong.
    expect(hitTestDimension(dim(), { x: MM(5), y: MM(2.5) })).toBe(false);
  });

  it('hits that point once the accuracy is widened enough', () => {
    // 2.5 mm from the crossbar, so 3 mm of slop reaches it and 2 mm does not.
    expect(hitTestDimension(dim(), { x: MM(5), y: MM(2.5) }, MM(3))).toBe(true);
    expect(hitTestDimension(dim(), { x: MM(5), y: MM(2.5) }, MM(2))).toBe(false);
  });

  it('measures the distance to the nearest line, not the first', () => {
    // The extension lines come first in the list; a point next to the crossbar
    // must still report the crossbar's distance.
    const d = dim();

    expect(distanceToDimension(d, { x: MM(5), y: MM(5) })).toBe(0);
    expect(distanceToDimension(d, { x: MM(5), y: MM(4) }) / MM(1)).toBeCloseTo(1, 3);
  });

  it('grows the hit area with the stroke', () => {
    // 1.5 mm off the crossbar: a 4 mm stroke reaches it, a 0.1 mm one does not.
    const thin = dim({ style: { ...dim().style, thickness: MM(0.1) } });
    const thick = dim({ style: { ...dim().style, thickness: MM(4) } });
    const p = { x: MM(5), y: MM(3.5) };

    expect(hitTestDimension(thin, p)).toBe(false);
    expect(hitTestDimension(thick, p)).toBe(true);
  });
});
