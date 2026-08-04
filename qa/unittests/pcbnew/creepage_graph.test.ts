// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The creepage graph.
 * Counterpart: `CREEPAGE_GRAPH` and the `CREEP_SHAPE::Paths` family.
 *
 * Creepage is not clearance. Clearance is how far apart two things are through
 * the air; creepage is how far a leakage current has to crawl *across the
 * board's surface*. A slot between two high-voltage nets moves them no further
 * apart, but it makes the surface path go the long way round — which is the
 * whole reason anyone mills one, and the reason this is a shortest-path problem
 * rather than a distance calculation.
 *
 * The tests below are in three groups, matching the three things that have to
 * be right for that to work:
 *
 * - **the geometry**, where weights are surface to surface rather than
 *   centreline to centreline;
 * - **path validity**, which is what makes a slot block a route at all;
 * - **the search**, whose ordering has a specific trap in it.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  CreepageGraph,
  closestPointOnSegment,
  isConductive,
  isValidPath,
  pathsBetween,
  type BoardSurface,
  type CreepShape,
} from '@ziroeda/pcbnew/src/drc/creepage_graph.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });

const pt = (x: number, y: number): CreepShape => ({ kind: 'be-point', pos: P(x, y) });
const bc = (x: number, y: number, r: number): CreepShape => ({
  kind: 'be-circle',
  pos: P(x, y),
  radius: MM(r),
});
const cc = (x: number, y: number, r: number): CreepShape => ({
  kind: 'cu-circle',
  pos: P(x, y),
  radius: MM(r),
});
const cu = (x1: number, y1: number, x2: number, y2: number, w: number): CreepShape => ({
  kind: 'cu-segment',
  start: P(x1, y1),
  end: P(x2, y2),
  width: MM(w),
});

describe('what counts as copper', () => {
  it('is the track segment, and nothing on the board edge', () => {
    // Only copper has a width to measure from the surface of.
    expect(isConductive(cu(0, 0, 1, 0, 0.2))).toBe(true);
    expect(isConductive(cc(0, 0, 1))).toBe(true);
    expect(isConductive(pt(0, 0))).toBe(false);
    expect(isConductive(bc(0, 0, 1))).toBe(false);
  });
});

describe('closestPointOnSegment', () => {
  it('clamps to the segment rather than running off its line', () => {
    expect(closestPointOnSegment(P(0, 0), P(10, 0), P(5, 5))).toEqual(P(5, 0));
    expect(closestPointOnSegment(P(0, 0), P(10, 0), P(-5, 5))).toEqual(P(0, 0));
    expect(closestPointOnSegment(P(0, 0), P(10, 0), P(50, 5))).toEqual(P(10, 0));
  });

  it('survives a zero-length segment', () => {
    expect(closestPointOnSegment(P(3, 3), P(3, 3), P(9, 9))).toEqual(P(3, 3));
  });
});

describe('the distance between two shapes', () => {
  it('is the straight line between two points', () => {
    expect(pathsBetween(pt(0, 0), pt(5, 0), MM(10))[0]?.weight).toBe(MM(5));
  });

  it('is nothing at all once they are further apart than the search', () => {
    // The gate is what keeps the graph bounded: there is no point knowing about
    // a route longer than the creepage being asked for.
    expect(pathsBetween(pt(0, 0), pt(50, 0), MM(10))).toEqual([]);
  });

  it('is measured from the copper surface, not its centreline', () => {
    // A 1 mm track and a point 3 mm off its centreline: the leakage path starts
    // at the copper's edge, 0.5 mm out, so it is 2.5 mm long.
    const [path] = pathsBetween(cu(0, 0, 10, 0, 1), pt(5, 3), MM(10));

    expect(path?.weight).toBe(MM(2.5));
    expect(path?.a1).toEqual(P(5, 0.5));
    expect(path?.a2).toEqual(P(5, 3));
  });

  it('comes back the other way round when the shapes are given the other way round', () => {
    const [forward] = pathsBetween(cu(0, 0, 10, 0, 1), pt(5, 3), MM(10));
    const [reverse] = pathsBetween(pt(5, 3), cu(0, 0, 10, 0, 1), MM(10));

    expect(reverse?.a1).toEqual(forward?.a2);
    expect(reverse?.a2).toEqual(forward?.a1);
    expect(reverse?.weight).toBe(forward?.weight);
  });

  it('takes both half-widths off between two tracks', () => {
    // Centrelines 3 mm apart, both tracks 1 mm wide: 3 - 0.5 - 0.5.
    const [path] = pathsBetween(cu(0, 0, 10, 0, 1), cu(0, 3, 10, 3, 1), MM(10));

    expect(path?.weight).toBe(MM(2));
    expect(path?.a1).toEqual(P(0, 0.5));
    expect(path?.a2).toEqual(P(0, 2.5));
  });

  it('floors at zero rather than going negative when copper overlaps', () => {
    // Two 1 mm tracks half a millimetre apart overlap. A negative weight is
    // not merely wrong, it is something Dijkstra cannot take at all.
    expect(pathsBetween(cu(0, 0, 10, 0, 1), cu(0, 0.5, 10, 0.5, 1), MM(10))[0]?.weight).toBe(0);
  });

  it('finds the nearest approach of two tracks that are not parallel', () => {
    // The near ends, not the far ones: an L whose two arms nearly meet.
    const [path] = pathsBetween(cu(0, 0, 10, 0, 0), cu(12, 0, 12, 10, 0), MM(10));

    expect(path?.weight).toBe(MM(2));
  });

  it('drops two segments that are further apart than the search', () => {
    expect(pathsBetween(cu(0, 0, 10, 0, 1), cu(0, 80, 10, 80, 1), MM(10))).toEqual([]);
  });
});

describe('a board-edge circle is an obstacle, not a target', () => {
  // The single most important distinction in the file. A path meeting a round
  // *cutout* is going round it, so it leaves along a tangent and there are two
  // of them. A path meeting round *copper* has arrived, so it comes in
  // radially and there is one. Getting these the same way round would either
  // let paths cut through cutouts or make them stop short of copper.

  it('costs the tangent length, not the gap to its rim', () => {
    // Centre 10 mm away, radius 6: the path travels 8 mm before it starts
    // turning — sqrt(10² − 6²) — where the *gap* to the rim is only 4.
    const paths = pathsBetween(pt(0, 0), bc(10, 0, 6), MM(50));

    expect(paths).toHaveLength(2);
    expect(paths[0]?.weight).toBeCloseTo(MM(8), -3);
  });

  it('offers a tangent either way round it', () => {
    // Which side is shorter is not a local question — it depends on what else
    // is in the way — so both are offered and the search decides.
    const [first, second] = pathsBetween(pt(0, 0), bc(10, 0, 6), MM(50));

    expect(first?.a2).toEqual(P(6.4, -4.8));
    expect(second?.a2).toEqual(P(6.4, 4.8));
  });

  it('has no tangent at all from a point inside it', () => {
    expect(pathsBetween(pt(10, 0), bc(10, 0, 6), MM(50))).toEqual([]);
  });

  it('turns round when the shapes are given the other way round', () => {
    const forward = pathsBetween(pt(0, 0), bc(10, 0, 6), MM(50));
    const reverse = pathsBetween(bc(10, 0, 6), pt(0, 0), MM(50));

    expect(reverse[0]?.a1).toEqual(forward[0]?.a2);
    expect(reverse[0]?.a2).toEqual(forward[0]?.a1);
  });
});

describe('round copper is a target', () => {
  it('costs the gap to its surface, and lands on it', () => {
    // The path starts at the point and ends on the copper's surface — the
    // *near* side of it, 4 mm away, not at its centre 10 mm away.
    const [path] = pathsBetween(pt(0, 0), cc(10, 0, 6), MM(50));

    expect(path?.weight).toBe(MM(4));
    expect(path?.a1).toEqual(P(0, 0));
    expect(path?.a2).toEqual(P(4, 0));
  });

  it('measures between two pieces of round copper along their centres', () => {
    const [path] = pathsBetween(cc(0, 0, 3), cc(20, 0, 4), MM(50));

    expect(path?.weight).toBe(MM(13));
    expect(path?.a1).toEqual(P(3, 0));
    expect(path?.a2).toEqual(P(16, 0));
  });

  it('reports nothing between two that overlap, which are one conductor', () => {
    expect(pathsBetween(cc(0, 0, 10), cc(12, 0, 5), MM(50))).toEqual([]);
  });

  it('reports nothing when one sits inside the other', () => {
    // There is no gap between them to measure.
    expect(pathsBetween(cc(0, 0, 10), cc(1, 0, 2), MM(50))).toEqual([]);
  });
});

describe('two board-edge circles', () => {
  it('offer four tangents: two alongside and two crossing between', () => {
    const paths = pathsBetween(bc(0, 0, 3), bc(20, 0, 3), MM(50));

    expect(paths).toHaveLength(4);
  });

  it('make the alongside pair the length of the centre line for equal radii', () => {
    // Same radius, so the outer tangents run parallel to the centre line and
    // are exactly as long as it.
    const [outer] = pathsBetween(bc(0, 0, 3), bc(20, 0, 3), MM(50));

    expect(outer?.weight).toBeCloseTo(MM(20), -3);
    expect(outer?.a1).toEqual(P(0, 3));
    expect(outer?.a2).toEqual(P(20, 3));
  });

  it('make the crossing pair shorter, by the radius sum rather than difference', () => {
    // sqrt(20² − 6²) — the crossed tangents pass between the two circles.
    const crossed = pathsBetween(bc(0, 0, 3), bc(20, 0, 3), MM(50))[2];

    expect(crossed?.weight).toBeCloseTo(Math.sqrt(MM(20) ** 2 - MM(6) ** 2), -3);
  });
});

describe('round copper against a round cutout', () => {
  it('takes the tangent to the cutout and the radius off the copper', () => {
    // sqrt(20² − 6²) − 2: tangent to the obstacle, then in to the copper.
    const paths = pathsBetween(cc(0, 0, 2), bc(20, 0, 6), MM(50));

    expect(paths).toHaveLength(2);
    expect(paths[0]?.weight).toBeCloseTo(Math.sqrt(MM(20) ** 2 - MM(6) ** 2) - MM(2), -3);
  });

  it('goes straight out along the radius when the copper is inside the cutout', () => {
    // No external tangent exists from in there, so the nearest approach is
    // radial: 10 − 2 − 1.
    const paths = pathsBetween(cc(2, 0, 1), bc(0, 0, 10), MM(50));

    expect(paths[0]?.weight).toBe(MM(7));
    expect(paths[0]?.a1).toEqual(P(3, 0));
    expect(paths[0]?.a2).toEqual(P(10, 0));
  });

  it('still offers two entries in that case, because callers index by side', () => {
    // Upstream's own note. A single entry makes one side of a track silently
    // find nothing at all — see the straddling case below.
    expect(pathsBetween(cc(2, 0, 1), bc(0, 0, 10), MM(50))).toHaveLength(2);
  });
});

describe('a track against a circle', () => {
  it('leaves from its flank when the circle is alongside', () => {
    const [path] = pathsBetween(cu(0, 0, 20, 0, 2), cc(10, 10, 3), MM(50));

    expect(path?.weight).toBe(MM(6));
    expect(path?.a1).toEqual(P(10, 1));
    expect(path?.a2).toEqual(P(10, 7));
  });

  it('leaves from its end cap when the circle is past the end', () => {
    // The cap is a circle of the track's half-width, so the problem reduces to
    // one already solved rather than needing its own geometry.
    const [path] = pathsBetween(cu(0, 0, 20, 0, 2), cc(30, 0, 3), MM(50));

    expect(path?.weight).toBe(MM(6));
    expect(path?.a1).toEqual(P(21, 0));
  });

  it('takes both tangents off its flank against a cutout alongside it', () => {
    // The two tangents leave where the cutout's own extremes project onto the
    // track — which is why the projection is taken twice, shifted by the
    // radius each way.
    const paths = pathsBetween(cu(0, 0, 40, 0, 2), bc(20, 10, 3), MM(50));

    expect(paths).toHaveLength(2);
    expect(paths[0]?.a1).toEqual(P(17, 1));
    expect(paths[1]?.a1).toEqual(P(23, 1));
    expect(paths[0]?.weight).toBe(MM(9));
  });

  it('falls back to its end cap against a cutout past the end', () => {
    // Both tangents must come off the cap and be mirror images. Checking only
    // the first hides the failure: without the fallback the second entry is a
    // path that starts *beyond* the cutout, which is nonsense but has a
    // plausible-looking weight.
    const paths = pathsBetween(cu(0, 0, 10, 0, 2), bc(30, 0, 3), MM(50));
    const expected = Math.sqrt(MM(20) ** 2 - MM(3) ** 2) - MM(1);

    expect(paths).toHaveLength(2);
    expect(paths[0]?.weight).toBeCloseTo(expected, -3);
    expect(paths[1]?.weight).toBeCloseTo(expected, -3);
    expect(paths[1]?.a1).toEqual({ x: paths[0]!.a1.x, y: -paths[0]!.a1.y });
    expect(paths[1]?.a2).toEqual({ x: paths[0]!.a2.x, y: -paths[0]!.a2.y });
  });
});

describe('whether a path may be taken', () => {
  const SOLID: BoardSurface = {
    outline: [P(0, 0), P(50, 0), P(50, 30), P(0, 30)],
    holes: [],
  };
  const SLOTTED: BoardSurface = {
    outline: [P(0, 0), P(50, 0), P(50, 30), P(0, 30)],
    holes: [[P(20, 5), P(25, 5), P(25, 25), P(20, 25)]],
  };
  /** A notch cut in from the top edge, so the gap is open rather than enclosed. */
  const NOTCHED: BoardSurface = {
    outline: [P(0, 0), P(50, 0), P(50, 30), P(30, 30), P(30, 10), P(20, 10), P(20, 30), P(0, 30)],
    holes: [],
  };

  it('is yes straight across solid board', () => {
    expect(isValidPath({ a1: P(10, 15), a2: P(40, 15), weight: 0 }, SOLID)).toBe(true);
  });

  it('is no straight across a slot', () => {
    // The entire point of the exercise: the slot does not move the two ends
    // apart, it makes this route not exist.
    expect(isValidPath({ a1: P(10, 15), a2: P(40, 15), weight: 0 }, SLOTTED)).toBe(false);
  });

  it('is no across an open notch, which no edge crossing would catch', () => {
    // The chord enters and leaves through the notch's mouth without properly
    // crossing an edge segment. Only the midpoint test rejects it — which is
    // why upstream tests the midpoint separately rather than trusting the
    // crossing test alone.
    expect(isValidPath({ a1: P(19, 20), a2: P(31, 20), weight: 0 }, NOTCHED)).toBe(false);
  });

  it('is yes for a path hugging the rim of a cutout', () => {
    // The most important kind of path there is here — going *round* the
    // obstacle is the whole route — and its midpoint lands exactly on the
    // boundary, where ray casting answers whichever way the rounding fell.
    // Upstream's `Contains || PointOnEdge` is what keeps it.
    expect(isValidPath({ a1: P(20, 12), a2: P(20, 28), weight: 0 }, NOTCHED)).toBe(true);
  });

  it('is yes for a path that merely touches an edge endpoint', () => {
    // Grazing a corner is legitimate; only a proper crossing is not.
    expect(isValidPath({ a1: P(10, 10), a2: P(20, 5), weight: 0 }, SLOTTED)).toBe(true);
  });

  it('is no for a path whose middle is off the board entirely', () => {
    expect(isValidPath({ a1: P(10, 15), a2: P(10, 45), weight: 0 }, SOLID)).toBe(false);
  });

  it('is no for a path lying wholly off the board, which crosses no edge at all', () => {
    // Never touches the outline, so nothing about crossings rejects it — only
    // asking where the midpoint *is* does.
    expect(isValidPath({ a1: P(60, 40), a2: P(70, 40), weight: 0 }, SOLID)).toBe(false);
  });

  it('is no for a path lying wholly inside a cutout', () => {
    // Same again for a hole: entirely within it, so it crosses none of its
    // edges. Without the hole half of the midpoint test this is a legal route
    // straight through a void.
    expect(isValidPath({ a1: P(21, 10), a2: P(24, 20), weight: 0 }, SLOTTED)).toBe(false);
  });
});

describe('the search', () => {
  it('finds the shortest route, not the first one', () => {
    const g = new CreepageGraph();
    const a = g.addNode(P(0, 0), 1);
    const b = g.addNode(P(10, 0));
    const c = g.addNode(P(20, 0), 2);
    g.connect(a, c, MM(30)); // the direct hop, but the long way
    g.connect(a, b, MM(10));
    g.connect(b, c, MM(10));

    expect(g.solve(a, c).weight).toBe(MM(20));
  });

  it('reports the route it took, so a marker can be drawn on it', () => {
    const g = new CreepageGraph();
    const a = g.addNode(P(0, 0), 1);
    const b = g.addNode(P(10, 0));
    const c = g.addNode(P(20, 0), 2);
    g.connect(a, c, MM(30));
    g.connect(a, b, MM(10));
    g.connect(b, c, MM(10));

    expect(g.solve(a, c).path.map((n) => n.pos)).toEqual([P(0, 0), P(10, 0), P(20, 0)]);
  });

  it('takes a later, shorter route rather than keeping the first one found', () => {
    // The decrease-key case. The long way is discovered first and must be
    // replaced, and the stale queue entry left behind must not undo that.
    const g = new CreepageGraph();
    const a = g.addNode(P(0, 0));
    const mid = g.addNode(P(1, 0));
    const b = g.addNode(P(2, 0));
    g.connect(a, b, MM(100));
    g.connect(a, mid, MM(1));
    g.connect(mid, b, MM(1));

    expect(g.solve(a, b).weight).toBe(MM(2));
  });

  it('reports infinity when there is no route at all', () => {
    // Which is the *good* answer for creepage: no leakage path exists.
    const g = new CreepageGraph();
    const a = g.addNode(P(0, 0), 1);
    const island = g.addNode(P(99, 99), 2);

    expect(g.solve(a, island).weight).toBe(Number.POSITIVE_INFINITY);
    expect(g.solve(a, island).path).toEqual([]);
  });

  it('costs nothing to get where you already are', () => {
    const g = new CreepageGraph();
    const a = g.addNode(P(0, 0));

    expect(g.solve(a, a).weight).toBe(0);
  });

  it('refuses a negative weight rather than storing one Dijkstra cannot take', () => {
    // Upstream logs and skips these during traversal; refusing them at the door
    // means the graph never holds an edge no search over it can use.
    const g = new CreepageGraph();
    const a = g.addNode(P(0, 0));
    const b = g.addNode(P(10, 0));
    g.connect(a, b, -MM(5));

    expect(g.solve(a, b).weight).toBe(Number.POSITIVE_INFINITY);
  });

  it('goes both ways down a connection', () => {
    const g = new CreepageGraph();
    const a = g.addNode(P(0, 0));
    const b = g.addNode(P(10, 0));
    g.connect(a, b, MM(10));

    expect(g.solve(b, a).weight).toBe(MM(10));
  });

  it('counts the nodes it holds', () => {
    const g = new CreepageGraph();
    g.addNode(P(0, 0));
    g.addNode(P(1, 1));

    expect(g.nodeCount).toBe(2);
  });
});

describe('a slot lengthening the route', () => {
  it('is the whole point, end to end', () => {
    // Two nets 30 mm apart on a board with a slot between them, open at the
    // bottom edge and closed 5 mm short of the top. Built the way the real
    // thing will be: candidate hops kept only when they stay on the board.
    const SLOTTED: BoardSurface = {
      outline: [P(0, 0), P(50, 0), P(50, 30), P(0, 30)],
      holes: [[P(20, 0), P(25, 0), P(25, 25), P(20, 25)]],
    };

    const g = new CreepageGraph();
    const nA = g.addNode(P(10, 15), 1);
    const nB = g.addNode(P(40, 15), 2);
    // Two waypoints above the slot's closed end — the way round.
    const w1 = g.addNode(P(18, 27));
    const w2 = g.addNode(P(27, 27));

    const hops: [Vec2, Vec2, number, number][] = [
      [P(10, 15), P(40, 15), nA.id, nB.id],
      [P(10, 15), P(18, 27), nA.id, w1.id],
      [P(18, 27), P(27, 27), w1.id, w2.id],
      [P(27, 27), P(40, 15), w2.id, nB.id],
    ];

    const nodes = [nA, nB, w1, w2];
    let directWasRejected = false;

    for (const [from, to, id1, id2] of hops) {
      const [path] = pathsBetween(
        { kind: 'be-point', pos: from },
        { kind: 'be-point', pos: to },
        MM(200),
      );
      if (!path) continue;
      if (!isValidPath(path, SLOTTED)) {
        if (id1 === nA.id && id2 === nB.id) directWasRejected = true;
        continue;
      }
      g.connect(nodes.find((n) => n.id === id1)!, nodes.find((n) => n.id === id2)!, path.weight);
    }

    // The slot is doing its job: straight across is not an option.
    expect(directWasRejected).toBe(true);

    const result = g.solve(nA, nB);

    // ...so the answer is the way round, which is longer than the 30 mm gap.
    expect(result.weight).toBeGreaterThan(MM(30));
    expect(result.path).toHaveLength(4);
  });

  it('leaves the direct route alone once the slot is gone', () => {
    const SOLID: BoardSurface = {
      outline: [P(0, 0), P(50, 0), P(50, 30), P(0, 30)],
      holes: [],
    };
    const [direct] = pathsBetween(
      { kind: 'be-point', pos: P(10, 15) },
      { kind: 'be-point', pos: P(40, 15) },
      MM(200),
    );

    expect(isValidPath(direct!, SOLID)).toBe(true);
    expect(direct?.weight).toBe(MM(30));
  });
});
