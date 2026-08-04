// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Obstacle hulls.
 * Counterparts: `OctagonalHull`, `SegmentHull`, `BuildHullForPrimitiveShape`,
 * `VIA::Hull`.
 *
 * A hull is the obstacle grown by the clearance the rules demand *plus half the
 * width of the track being routed*, so a path whose centreline touches the hull
 * leaves a track whose edge sits exactly at the clearance. That arithmetic is
 * the first group of tests, because everything the router does above this layer
 * assumes it.
 *
 * Two things beyond the arithmetic matter enough to lead with:
 *
 * - **Winding is stable.** The hull comes out clockwise whichever end of the
 *   segment was given first. Walkaround chooses a direction to traverse it in,
 *   so a hull that flipped with the segment would send paths round the wrong
 *   side of the obstacle.
 * - **A very short segment is snapped before it is used.** Its direction is
 *   rounding noise and the perpendicular taken from it produces a twisted hull.
 *   This is not a pathological case: every corner a router lays down leaves a
 *   tiny segment behind while the cursor is between grid points.
 */
import { describe, expect, it } from 'vitest';
import {
  circleHull,
  isSegment45Degree,
  octagonalHull,
  rectHull,
  segmentHull,
  viaHull,
  type Hull,
} from '@ziroeda/pcbnew/src/router/pns_hull.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const P = (x: number, y: number): Vec2 => ({ x, y });

/** Twice the signed area; only the sign is read, as the winding. */
const signedArea = (h: Hull): number => {
  let s = 0;
  for (let i = 0; i < h.length; i++) {
    const q = h[(i + 1) % h.length]!;
    s += h[i]!.x * q.y - q.x * h[i]!.y;
  }
  return s / 2;
};

const bounds = (h: Hull) => ({
  minX: Math.min(...h.map((p) => p.x)),
  minY: Math.min(...h.map((p) => p.y)),
  maxX: Math.max(...h.map((p) => p.x)),
  maxY: Math.max(...h.map((p) => p.y)),
});

describe('the octagon', () => {
  it('is a plain rectangle when nothing is chamfered', () => {
    expect(octagonalHull(P(0, 0), P(100, 100), 10, 0)).toEqual([
      P(-10, -10),
      P(110, -10),
      P(110, 110),
      P(-10, 110),
    ]);
  });

  it('cuts each corner back by the chamfer', () => {
    // All eight, because checking two leaves three corners free to be wrong.
    expect(octagonalHull(P(0, 0), P(100, 100), 10, 20)).toEqual([
      P(-10, 10),
      P(10, -10),
      P(90, -10),
      P(110, 10),
      P(110, 90),
      P(90, 110),
      P(10, 110),
      P(-10, 90),
    ]);
  });

  it('grows the box by the clearance on every side', () => {
    expect(bounds(octagonalHull(P(0, 0), P(100, 50), 10, 0))).toEqual({
      minX: -10,
      minY: -10,
      maxX: 110,
      maxY: 60,
    });
  });
});

describe('recognising an axis or a diagonal', () => {
  it('accepts an exact one', () => {
    expect(isSegment45Degree(P(0, 0), P(100, 100))).toBe(true);
    expect(isSegment45Degree(P(0, 0), P(100, 0))).toBe(true);
  });

  it('accepts one that misses by a single internal unit', () => {
    // The whole point of the tolerance: a 45° segment the user drew will be a
    // nanometre off after rounding, and calling that a general direction is
    // what produces the twisted hulls the kink rule exists to prevent.
    expect(isSegment45Degree(P(0, 0), P(100, 99))).toBe(true); // near-diagonal
    expect(isSegment45Degree(P(0, 0), P(100, 1))).toBe(true); // near-horizontal
    expect(isSegment45Degree(P(0, 0), P(1, 100))).toBe(true); // near-vertical
  });

  it('rejects a genuinely oblique one', () => {
    expect(isSegment45Degree(P(0, 0), P(100, 50))).toBe(false);
  });
});

describe('a track segment’s hull', () => {
  // 1000 long, 100 wide, 50 of clearance: half the width plus the clearance
  // makes 100 of growth in every direction.
  const HORIZ = segmentHull(P(0, 0), P(1000, 0), 100, 50, 0);

  it('grows by half the width plus the clearance', () => {
    expect(bounds(HORIZ)).toEqual({ minX: -100, minY: -100, maxX: 1100, maxY: 100 });
  });

  it('is an octagon, so the router’s 45° geometry can follow it', () => {
    expect(HORIZ).toHaveLength(8);
  });

  it('comes out clockwise, whichever end was given first', () => {
    // Walkaround traverses the hull in a chosen direction, so *which* way it
    // is wound is the contract — not merely that two hulls agree with each
    // other. Dropping the correction leaves both consistently anticlockwise,
    // which a same-sign test cannot see.
    const reversed = segmentHull(P(1000, 0), P(0, 0), 100, 50, 0);
    const diagonal = segmentHull(P(0, 0), P(1000, 1000), 100, 50, 0);

    // Positive shoelace area is clockwise in the y-down board coordinates.
    expect(signedArea(HORIZ)).toBeGreaterThan(0);
    expect(signedArea(reversed)).toBeGreaterThan(0);
    expect(signedArea(diagonal)).toBeGreaterThan(0);

    expect(new Set(reversed.map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(HORIZ.map((p) => `${p.x},${p.y}`)),
    );
  });

  it('takes only half the routed track’s width into the growth', () => {
    // The other half lies on the far side of that track's own centreline, so
    // the edge-to-edge separation still comes out at exactly the clearance.
    const past200 = segmentHull(P(0, 0), P(1000, 0), 100, 50, 200);

    expect(bounds(past200).maxY).toBe(bounds(HORIZ).maxY + 100);
  });

  it('becomes an octagon about its own square when it has no length', () => {
    const dot = segmentHull(P(0, 0), P(0, 0), 100, 50, 0);

    expect(dot).toHaveLength(8);
    expect(bounds(dot)).toEqual({ minX: -100, minY: -100, maxX: 100, maxY: 100 });
  });
});

describe('the kink rule', () => {
  it('snaps a stubby near-horizontal segment flat before using its direction', () => {
    // Three units long against a clearance of 100: far below the tenth-of-
    // clearance threshold, so the one unit of rise is noise. The hull comes
    // out symmetric about the x axis, which it would not if the raw direction
    // had been used.
    const h = segmentHull(P(0, 0), P(3, 1), 100, 100, 0);
    const b = bounds(h);

    expect(b.minY).toBe(-b.maxY);
  });

  it('snaps a stubby near-vertical segment upright too', () => {
    // The mirror of the case above, and a separate branch: one unit of run
    // against three of rise. Without it the hull leans.
    const h = segmentHull(P(0, 0), P(1, 3), 100, 100, 0);
    const b = bounds(h);

    expect(b.minX).toBe(-b.maxX);
  });

  it('leaves a long segment alone however oblique it is', () => {
    // Well past the threshold, so its direction is real and must be kept.
    const h = segmentHull(P(0, 0), P(3000, 1000), 100, 100, 0);
    const b = bounds(h);

    expect(b.minY).not.toBe(-b.maxY);
  });

  it('is scaled by the clearance, not a fixed distance', () => {
    // A tenth of the clearance: the same segment is stubby against a large
    // clearance and ordinary against a small one.
    const tiny = segmentHull(P(0, 0), P(3, 1), 100, 100, 0);
    const notTiny = segmentHull(P(0, 0), P(3, 1), 100, 10, 0);

    expect(bounds(tiny).minY).toBe(-bounds(tiny).maxY);
    expect(bounds(notTiny).minY).not.toBe(-bounds(notTiny).maxY);
  });
});

describe('vias and pads', () => {
  it('gives a via an octagon around its diameter', () => {
    const h = viaHull(P(0, 0), 600, 200, 0);

    expect(h).toHaveLength(8);
    expect(bounds(h)).toEqual({ minX: -500, minY: -500, maxX: 500, maxY: 500 });
  });

  it('gives a round pad exactly the same hull as a via of that size', () => {
    // Upstream writes the two chamfers as different expressions —
    // 2(1−√½)(r + cl) and (2cl + d)(1−√½) — which are the same rule, because
    // d = 2r. I had assumed they differed until the numbers said otherwise.
    expect(circleHull(P(0, 0), 300, 200)).toEqual(viaHull(P(0, 0), 600, 200, 0));
  });

  it('gives a rectangular pad square corners', () => {
    // The true offset is rounded there, so a square corner stays *outside* it —
    // wrong in the safe direction.
    const h = rectHull(P(0, 0), P(400, 200), 100);

    expect(h).toHaveLength(4);
    expect(h).toEqual([P(-100, -100), P(500, -100), P(500, 300), P(-100, 300)]);
  });

  it('grows a via by the routed track’s half width as well', () => {
    const bare = bounds(viaHull(P(0, 0), 600, 200, 0));
    const past = bounds(viaHull(P(0, 0), 600, 200, 200));

    expect(past.maxX).toBe(bare.maxX + 100);
  });
});
