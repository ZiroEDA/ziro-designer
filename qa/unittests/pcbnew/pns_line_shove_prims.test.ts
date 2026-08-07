// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `LINE` and `SHAPE_LINE_CHAIN` primitives `PNS::SHOVE` is built out of.
 * Counterparts: `pcbnew/router/pns_line.cpp` (`LinkVia`, `Mark`, `Unmark`,
 * `Marker`, `SetRank`, `Rank`, `HasLoops`, `HasLockedSegments`,
 * `CompareGeometry`) and `libs/kimath/src/geometry/shape_line_chain.cpp`
 * (`Simplify`, `Simplify2`, `CompareGeometry`, `SelfIntersecting`,
 * `NearestPoint`).
 *
 * These are pinned separately from shove itself because shove's behaviour is
 * only as faithful as they are, and every one of them has a detail that reads
 * as a mistake until you find the caller that depends on it:
 *
 * - `LinkVia` **reverses the line** when the via lands on its first point.
 * - `Rank` is the **minimum** over the links, not the line's own field.
 * - `Unmark` zeroes the line's marker outright while only clearing bits on the
 *   links.
 * - `Simplify2` leaves a chain of fewer than three points completely alone.
 * - `CompareGeometry` runs `Simplify` first, so re-vertexing is not a change.
 */
import { describe, expect, it } from 'vitest';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { LineMarker } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { constructArcFromStartEndAngle } from '@ziroeda/pcbnew/src/router/shape_arc_ops.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const NET: NetHandle = { id: 1 } as unknown as NetHandle;

const chain = (...pts: [number, number][]): PnsLineChain =>
  PnsLineChain.fromPoints(pts.map(([x, y]) => ({ x, y })));

function line(...pts: [number, number][]): PnsLine {
  const l = new PnsLine();
  l.setShape(chain(...pts));
  l.setWidth(1000);
  l.setNet(NET);
  l.setLayers(new PnsLayerRange(0, 0));
  return l;
}

function seg(a: Vec2, b: Vec2): PnsSegment {
  const s = new PnsSegment({ a, b }, NET);
  s.setWidth(1000);
  s.setLayers(new PnsLayerRange(0, 0));
  return s;
}

function via(pos: Vec2): PnsVia {
  return new PnsVia(pos, new PnsLayerRange(0, 1), 600000, 300000, NET);
}

describe('LINE::LinkVia', () => {
  it('links the via and attaches it, leaving an end-anchored line alone', () => {
    const l = line([0, 0], [1000, 0], [2000, 0]);
    const v = via({ x: 2000, y: 0 });

    l.linkVia(v);

    expect(l.endsWithVia()).toBe(true);
    expect(l.via()).toBe(v);
    expect(l.containsLink(v)).toBe(true);
    expect(l.cPoint(0)).toEqual({ x: 0, y: 0 });
  });

  it('reverses the line when the via sits on its first point', () => {
    const l = line([0, 0], [1000, 0], [2000, 0]);
    const v = via({ x: 0, y: 0 });

    l.linkVia(v);

    // The via is by convention at the end, so the chain turned round.
    expect(l.cPoint(0)).toEqual({ x: 2000, y: 0 });
    expect(l.cLastPoint()).toEqual({ x: 0, y: 0 });
  });

  it('leaves a single-point line alone — there is no other end', () => {
    const l = line([0, 0]);
    const v = via({ x: 0, y: 0 });

    l.linkVia(v);

    expect(l.cPoint(0)).toEqual({ x: 0, y: 0 });
    expect(l.endsWithVia()).toBe(true);
  });
});

describe('LINE rank and marker propagation', () => {
  it('SetRank writes through to every link', () => {
    const l = line([0, 0], [1000, 0]);
    const s = seg({ x: 0, y: 0 }, { x: 1000, y: 0 });
    l.link(s);

    l.setRank(42);

    expect(s.rank()).toBe(42);
    expect(l.rank()).toBe(42);
  });

  it('Rank is the MINIMUM over the links, not the line field', () => {
    const l = line([0, 0], [1000, 0], [2000, 0]);
    const s1 = seg({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const s2 = seg({ x: 1000, y: 0 }, { x: 2000, y: 0 });
    l.link(s1);
    l.link(s2);

    l.setRank(100);
    s2.setRank(7);

    // A line is only as high-ranking as its weakest segment.
    expect(l.rank()).toBe(7);
  });

  it('falls back to the line field when unlinked', () => {
    const l = line([0, 0], [1000, 0]);
    l.setRank(5);
    expect(l.rank()).toBe(5);
  });

  it('Marker ORs the line field with every link', () => {
    const l = line([0, 0], [1000, 0]);
    const s = seg({ x: 0, y: 0 }, { x: 1000, y: 0 });
    l.link(s);

    s.mark(LineMarker.MK_LOCKED);

    expect(l.marker() & LineMarker.MK_LOCKED).toBeTruthy();
  });

  it('Mark ASSIGNS to every link, wiping bits the link already carried', () => {
    const l = line([0, 0], [1000, 0]);
    const s = seg({ x: 0, y: 0 }, { x: 1000, y: 0 });
    l.link(s);

    s.mark(LineMarker.MK_LOCKED | LineMarker.MK_VIOLATION);
    l.mark(LineMarker.MK_HEAD);

    // `m_marker = aMarker`, not `|=`. The link's MK_LOCKED is gone — which is
    // why `SHOVE` never marks a line it intends to keep locked segments on.
    expect(s.marker()).toBe(LineMarker.MK_HEAD);
  });

  it('Unmark clears the named bits on the links', () => {
    const l = line([0, 0], [1000, 0]);
    const s = seg({ x: 0, y: 0 }, { x: 1000, y: 0 });
    l.link(s);

    s.mark(LineMarker.MK_LOCKED | LineMarker.MK_VIOLATION);
    l.unmark(LineMarker.MK_VIOLATION);

    expect(s.marker()).toBe(LineMarker.MK_LOCKED);
  });

  it('Unmark zeroes the line field outright, whatever bits were named', () => {
    // No links, so `Marker()` reports only the line's own field and the
    // `m_marker = 0` at the end of `LINE::Unmark` is observable on its own.
    const l = line([0, 0], [1000, 0]);

    l.mark(LineMarker.MK_HEAD);
    expect(l.marker()).toBe(LineMarker.MK_HEAD);

    // Clearing a bit the line does not even have still zeroes it: upstream
    // assigns 0 rather than `&= ~aMarker`.
    l.unmark(LineMarker.MK_VIOLATION);
    expect(l.marker()).toBe(0);
  });
});

describe('LINE::HasLoops / HasLockedSegments', () => {
  it('finds a point repeated at least two indices apart', () => {
    expect(line([0, 0], [1000, 0], [1000, 1000], [0, 0]).hasLoops()).toBe(true);
  });

  it('does not treat adjacent duplicates as a loop', () => {
    // j starts at i + 2, so a repeated *neighbour* is invisible to it.
    expect(line([0, 0], [0, 0], [1000, 0]).hasLoops()).toBe(false);
  });

  it('reports a locked link', () => {
    const l = line([0, 0], [1000, 0]);
    const s = seg({ x: 0, y: 0 }, { x: 1000, y: 0 });
    l.link(s);

    expect(l.hasLockedSegments()).toBe(false);
    s.mark(LineMarker.MK_LOCKED);
    expect(l.hasLockedSegments()).toBe(true);
  });
});

describe('SHAPE_LINE_CHAIN::Simplify2', () => {
  it('leaves a chain of fewer than three points completely alone', () => {
    const c = chain([0, 0], [0, 0]);
    c.simplify2();
    // Even an exact duplicate survives — the early return fires first.
    expect(c.pointCount()).toBe(2);
  });

  it('removes only a leading duplicate at exactly three points', () => {
    const c = chain([0, 0], [0, 0], [1000, 0]);
    c.simplify2();
    expect(c.pointCount()).toBe(2);

    const d = chain([0, 0], [1000, 0], [1000, 0]);
    d.simplify2();
    // The trailing duplicate is NOT removed — upstream only tests points 0 and 1.
    expect(d.pointCount()).toBe(3);
  });

  it('collapses duplicate runs and collinear runs', () => {
    const c = chain([0, 0], [0, 0], [1000, 0], [2000, 0], [3000, 0], [3000, 1000]);
    c.simplify2();

    expect(c.points()).toEqual([
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 1000 },
    ]);
  });

  it('keeps collinear points when asked not to remove them', () => {
    const c = chain([0, 0], [1000, 0], [2000, 0], [2000, 1000]);
    c.simplify2(false);
    expect(c.pointCount()).toBe(4);
  });
});

describe('SHAPE_LINE_CHAIN::CompareGeometry', () => {
  it('ignores a redundant collinear mid-point', () => {
    const a = chain([0, 0], [2000, 0]);
    const b = chain([0, 0], [1000, 0], [2000, 0]);

    // This is what makes reconstructHeads say "unmodified" for a re-vertexed head.
    expect(a.compareGeometry(b)).toBe(true);
  });

  it('sees a genuinely different route', () => {
    const a = chain([0, 0], [2000, 0]);
    const b = chain([0, 0], [1000, 1000], [2000, 0]);

    expect(a.compareGeometry(b)).toBe(false);
  });
});

describe('SHAPE_LINE_CHAIN::SelfIntersecting', () => {
  it('finds a crossing between non-adjacent segments', () => {
    const c = chain([0, 0], [2000, 0], [2000, 2000], [1000, -1000]);
    expect(c.selfIntersecting()).not.toBeNull();
  });

  it('does not report a plain open path', () => {
    expect(chain([0, 0], [1000, 0], [1000, 1000]).selfIntersecting()).toBeNull();
  });

  it('does not report two segments merely sharing a vertex', () => {
    expect(chain([0, 0], [1000, 0], [1000, 1000]).selfIntersecting()).toBeNull();
  });
});

describe('SHAPE_LINE_CHAIN::NearestPoint', () => {
  it('projects onto the nearest segment', () => {
    const c = chain([0, 0], [2000, 0], [2000, 2000]);
    expect(c.nearestPoint({ x: 1000, y: 500 })).toEqual({ x: 1000, y: 0 });
  });

  it('clamps to an endpoint when the projection falls outside', () => {
    const c = chain([0, 0], [2000, 0]);
    expect(c.nearestPoint({ x: -500, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('is unchanged by the arc-snapping flag on a chain with no arcs', () => {
    const c = chain([0, 0], [2000, 0], [2000, 2000]);

    expect(c.nearestPoint({ x: 1000, y: 500 }, false)).toEqual({ x: 1000, y: 0 });
  });

  it('snaps out to an arc end when internal shape points are not allowed', () => {
    // A quarter arc, preceded by a straight run: upstream's `nearest > 0` guard
    // means an arc that *starts* the chain is never snapped, so the arc has to
    // come second. The radius is in millimetres because a smaller one
    // polygonises to a straight line and stops being an arc at all.
    const c = new PnsLineChain();

    c.appendPoint({ x: -1000000, y: 0 });
    c.appendArcShape(
      constructArcFromStartEndAngle({ x: 0, y: 0 }, { x: 1000000, y: 1000000 }, new EDA_ANGLE(90)),
    );

    // Allowed internal points: the answer lies on the arc's own polyline.
    expect(c.nearestPoint({ x: 300000, y: 800000 }, true)).toEqual({ x: 829809, y: 445992 });
    expect(c.nearestPoint({ x: 100000, y: 400000 }, true)).toEqual({ x: 176040, y: 17718 });

    // Disallowed: pushed out to whichever end of the arc is nearer, so that a
    // cut made there never has to bisect the arc.
    expect(c.nearestPoint({ x: 300000, y: 800000 }, false)).toEqual({ x: 1000000, y: 1000000 });
    expect(c.nearestPoint({ x: 100000, y: 400000 }, false)).toEqual({ x: 0, y: 0 });
  });
});
