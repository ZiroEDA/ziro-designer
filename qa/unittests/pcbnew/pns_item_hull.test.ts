// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ITEM::Hull` and `SHAPE_LINE_CHAIN::PathLength`.
 * Counterparts: `pns_utils.cpp` (`ArcHull`, `ConvexHull`,
 * `BuildHullForPrimitiveShape`), the five `Hull()` overrides, and
 * `shape_line_chain.cpp:1952`.
 *
 * `PathLength` is the one that repays a test: it is the distance measure
 * `NearestObstacle` sorts obstacles by, and three of its behaviours read like
 * bugs — a negative index means "segment 0" rather than "from the end", one
 * past the last segment is remapped onto the last, and running off the end
 * returns **-1**, which is *smaller* than every real distance and therefore
 * makes an obstacle look nearest rather than furthest.
 */
import { describe, expect, it } from 'vitest';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { PnsArc } from '@ziroeda/pcbnew/src/router/pns_arc.js';
import { PnsHole } from '@ziroeda/pcbnew/src/router/pns_hole.js';
import { PnsLine } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { arcHull, convexHull, itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import { segmentHull } from '@ziroeda/pcbnew/src/router/pns_hull.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const chain = (pts: Vec2[]): PnsLineChain => PnsLineChain.fromPoints(pts);

const bbox = (h: readonly Vec2[]) => ({
  minX: Math.min(...h.map((p) => p.x)),
  minY: Math.min(...h.map((p) => p.y)),
  maxX: Math.max(...h.map((p) => p.x)),
  maxY: Math.max(...h.map((p) => p.y)),
});

// ---------------------------------------------------------------------------------
describe('SHAPE_LINE_CHAIN::PathLength', () => {
  const c = chain([V(0, 0), V(1000, 0), V(1000, 500)]);

  it('sums whole segments before the named one, then the distance from its A end', () => {
    expect(c.pathLength(V(400, 0), 0)).toBe(400);
    expect(c.pathLength(V(1000, 200), 1)).toBe(1200);
  });

  it('treats a negative index as segment 0, not as counting back from the end', () => {
    // Every other negative index in this class means "from the end". This one
    // skips the index test entirely, so the first segment always matches.
    expect(c.pathLength(V(400, 0), -1)).toBe(400);
  });

  it('remaps one-past-the-last onto the last segment', () => {
    expect(c.pathLength(V(1000, 200), c.segmentCount())).toBe(1200);
  });

  it('returns -1 rather than a length when the index runs off the end', () => {
    // -1 is less than every real distance, so an obstacle reporting it looks
    // *nearest*. That is upstream's, not a defensive zero.
    expect(c.pathLength(V(0, 0), 7)).toBe(-1);
    expect(chain([V(0, 0)]).pathLength(V(0, 0), 0)).toBe(-1);
  });

  it('measures to the point given even when it is not on the segment', () => {
    expect(c.pathLength(V(0, 300), 0)).toBe(300);
  });
});

// ---------------------------------------------------------------------------------
describe('ITEM::Hull', () => {
  it('a segment hull is SegmentHull of its own geometry', () => {
    const s = new PnsSegment({ seg: { a: V(0, 0), b: V(1000, 0) }, width: 200 }, null);
    s.setLayers(new PnsLayerRange(0));

    expect(itemHull(s, 300, 100, 0)).toEqual(segmentHull(V(0, 0), V(1000, 0), 200, 300, 100));
  });

  it('a via hull is an octagon of its diameter, truncating half the walkaround thickness', () => {
    const v = new PnsVia(V(0, 0), new PnsLayerRange(0, 3), 400, 200, null);
    const h = itemHull(v, 100, 5, 0);

    // cl = 100 + trunc(5/2) = 102; the box is the 400 diameter grown by cl.
    expect(bbox(h)).toEqual({ minX: -302, minY: -302, maxX: 302, maxY: 302 });
  });

  it('a hole hull truncates the half-thickness where the generic builder rounds it up', () => {
    const hole = new PnsHole({ kind: 'circle', c: V(0, 0), r: 200 });
    hole.setLayers(new PnsLayerRange(0));

    const solid = new PnsSolid();
    solid.setLayers(new PnsLayerRange(0));
    solid.setShape({ kind: 'circle', c: V(0, 0), r: 200 });
    solid.setPos(V(0, 0));

    // Same circle, one internal unit apart, because HOLE::Hull writes
    // `wt / 2` and BuildHullForPrimitiveShape writes `(wt + 1) / 2`.
    expect(bbox(itemHull(hole, 100, 5, 0)).maxX).toBe(302);
    expect(bbox(itemHull(solid, 100, 5, 0)).maxX).toBe(303);
  });

  it('is empty for the kinds upstream gives no override', () => {
    const l = new PnsLine();
    l.setShape(chain([V(0, 0), V(1000, 0)]));
    l.setLayers(new PnsLayerRange(0));

    expect(itemHull(l, 100, 0, 0)).toEqual([]);
  });

  it('an arc hull wraps the arc and is wound clockwise', () => {
    // A 1 mm radius, in internal units. A micrometre-scale arc polygonises to
    // its bare chord at ARC_LOW_DEF and the hull degenerates to a segment's.
    const R = 1000000;
    const a = new PnsArc({ p0: V(-R, 0), arcMid: V(0, R), p1: V(R, 0), width: 200000 }, null);
    a.setLayers(new PnsLayerRange(0));

    const h = itemHull(a, 100000, 0, 0);
    const b = bbox(h);

    expect(h.length).toBeGreaterThan(8);
    // The hull contains the arc's own extent, grown.
    expect(b.minX).toBeLessThan(-R);
    expect(b.maxX).toBeGreaterThan(R);
    expect(b.maxY).toBeGreaterThan(R);
    // Walkaround picks a direction to traverse a hull in, so an arc hull that
    // came out the other way round from a segment hull would send paths round
    // the wrong side. Same sign as `segmentHull`, which guarantees clockwise.
    expect(Math.sign(signedArea(h))).toBe(
      Math.sign(signedArea(segmentHull(V(-R, 0), V(R, 0), 200000, 100000, 0))),
    );
  });

  it('treats a nearly-closed arc as a circle', () => {
    // Over 180° with a chord shorter than the clearance: there is no gap a
    // track could pass through, so the whole circle is the obstacle.
    const a = { p0: V(1000, 0), arcMid: V(-1000, 0), p1: V(1000, 10), width: 0 };
    const h = arcHull(a, 5000, 0);
    const b = bbox(h);

    // An octagon around the full radius, not a ribbon along the arc.
    expect(h).toHaveLength(8);
    expect(b.maxX - b.minX).toBe(b.maxY - b.minY);
  });
});

// ---------------------------------------------------------------------------------
describe('ConvexHull', () => {
  it('is an octagon whose axis-aligned sides come from the inflated bounding box', () => {
    const square = [V(0, 0), V(1000, 0), V(1000, 1000), V(0, 1000)];
    const h = convexHull(square, 100);

    expect(h).toHaveLength(8);
    expect(bbox(h)).toEqual({ minX: -100, minY: -100, maxX: 1100, maxY: 1100 });
  });

  it('cuts the corners back — it is not the plain box', () => {
    const square = [V(0, 0), V(1000, 0), V(1000, 1000), V(0, 1000)];
    const h = convexHull(square, 100);

    // No vertex sits on a corner of the bounding box.
    for (const p of h) {
      expect(Math.abs(p.x) === 100 && Math.abs(p.y) === 100).toBe(false);
    }
  });
});

/** Twice the signed area; negative is clockwise in KiCad's y-down space. */
function signedArea(h: readonly Vec2[]): number {
  let sum = 0;

  for (let i = 0; i < h.length; i++) {
    const a = h[i] as Vec2;
    const b = h[(i + 1) % h.length] as Vec2;
    sum += a.x * b.y - b.x * a.y;
  }

  return sum;
}
