// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import { describe, expect, it } from 'vitest';
import {
  approximateSegmentAsRect,
  circleBreakouts,
  computeBreakouts,
  countCorners,
  customBreakouts,
  findPadOrVia,
  polyAsAxisAlignedRect,
  rectBreakouts,
  SMART_PADS_FORBIDDEN_ANGLES,
} from '@ziroeda/pcbnew/src/router/pns_smart_pads.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Shape } from '@ziroeda/pcbnew/src/drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });
const NET_A: NetHandle = { name: 'A' };

/** The last point of each breakout, which is what the exit direction is read from. */
const tips = (list: Vec2[][]): Vec2[] => list.map((b) => b[b.length - 1] as Vec2);

const sortPts = (pts: Vec2[]): Vec2[] => [...pts].sort((a, b) => a.x - b.x || a.y - b.y);

describe('ApproximateSegmentAsRect', () => {
  it('inflates both ends by half the width in both axes, not by a stadium', () => {
    // Upstream subtracts (w/2, w/2) from A and adds it to B — a square grown on
    // each end, so a diagonal segment gets a box far larger than its real shape.
    // Reproduced because the only consumer is a breakout ray direction.
    const r = approximateSegmentAsRect(V(0, 0), V(100, 100), 20);

    expect(r.pos).toEqual({ x: -10, y: -10 });
    expect(r.size).toEqual({ x: 120, y: 120 });
  });

  it('does not merely normalise when the ends arrive reversed', () => {
    // The inflation signs are bound to A and B, not to min and max: A always
    // loses (w/2, w/2) and B always gains it. So swapping the ends shrinks the
    // box instead of producing the same one — (100,0)->(0,0) at width 20 spans
    // x from 10 to 90, where (0,0)->(100,0) spans -10 to 110. Upstream's, and
    // the reason the min/max at the end is not redundant.
    const fwd = approximateSegmentAsRect(V(0, 0), V(100, 0), 20);
    const rev = approximateSegmentAsRect(V(100, 0), V(0, 0), 20);

    expect(fwd.pos.x).toBe(-10);
    expect(fwd.size.x).toBe(120);
    expect(rev.pos.x).toBe(10);
    expect(rev.size.x).toBe(80);
  });
});

describe('circleBreakouts', () => {
  it('lays eight exits at 45 degrees, each a circumradius long', () => {
    // The reach is radius * sqrt(2), not radius: it is the circumradius of the
    // square around the circle, so a diagonal exit clears the corner that a
    // rectangular pad of the same size would have had.
    const b = circleBreakouts(0, V(0, 0), 1000);

    expect(b).toHaveLength(8);
    expect(b.every((c) => c.length === 2)).toBe(true);

    const reach = Math.trunc(1000 * Math.SQRT2);
    const t = tips(b);

    expect(t).toContainEqual({ x: reach, y: 0 });
    expect(t).toContainEqual({ x: -reach, y: 0 });
  });

  it('starts every exit at the centre', () => {
    const b = circleBreakouts(0, V(50, -20), 100);

    expect(b.every((c) => c[0]?.x === 50 && c[0]?.y === -20)).toBe(true);
  });
});

describe('rectBreakouts', () => {
  const square = { pos: V(-500, -500), size: V(1000, 1000) };

  it('gives four axis exits when diagonals are refused', () => {
    const b = rectBreakouts(100, square, false);

    expect(b).toHaveLength(4);
    expect(tips(b)).toContainEqual({ x: 600, y: 0 });
    expect(tips(b)).toContainEqual({ x: 0, y: -600 });
  });

  it('adds four diagonals when they are permitted', () => {
    expect(rectBreakouts(100, square, true)).toHaveLength(8);
  });

  it('offsets an oblong pad’s diagonals along its long axis', () => {
    // This is the whole point of the routine. A 4000x1000 pad has its diagonal
    // exits start 1500 along x — (4000-1000)/2 — so the track leaves near the
    // pad's end and follows its length, instead of paralleling the short side.
    const oblong = { pos: V(-2000, -500), size: V(4000, 1000) };
    const b = rectBreakouts(100, oblong, true);
    const mids = b.filter((c) => c.length === 3).map((c) => c[1] as Vec2);

    expect(mids).toContainEqual({ x: 1500, y: 0 });
    expect(mids).toContainEqual({ x: -1500, y: 0 });
  });

  it('offsets a tall pad along y instead', () => {
    const tall = { pos: V(-500, -2000), size: V(1000, 4000) };
    const mids = rectBreakouts(100, tall, true)
      .filter((c) => c.length === 3)
      .map((c) => c[1] as Vec2);

    expect(mids).toContainEqual({ x: 0, y: 1500 });
  });

  it('takes the wide and tall arms of upstream’s branch, which differ', () => {
    // Upstream writes the two arms with different sign patterns and comments
    // "fixme: this could be done more efficiently" on the second. They are not
    // mirror images, so a port that wrote one and transposed it would diverge.
    const wide = rectBreakouts(0, { pos: V(-200, -100), size: V(400, 200) }, true);
    const tall = rectBreakouts(0, { pos: V(-100, -200), size: V(200, 400) }, true);

    expect(sortPts(tips(wide))).not.toEqual(sortPts(tips(tall).map((p) => ({ x: p.y, y: p.x }))));
  });
});

describe('polyAsAxisAlignedRect', () => {
  it('recognises an axis-aligned four-point outline', () => {
    const r = polyAsAxisAlignedRect([V(0, 0), V(100, 0), V(100, 50), V(0, 50)]);

    expect(r).toEqual({ pos: { x: 0, y: 0 }, size: { x: 100, y: 50 } });
  });

  it('refuses a rotated quad', () => {
    // Four points, but three distinct x values — not axis aligned, so it is a
    // SH_SIMPLE and must go to the ray-casting path.
    expect(polyAsAxisAlignedRect([V(0, 0), V(50, -50), V(100, 0), V(50, 50)])).toBeNull();
  });

  it('refuses anything that is not four points', () => {
    expect(polyAsAxisAlignedRect([V(0, 0), V(1, 0), V(1, 1)])).toBeNull();
  });
});

describe('customBreakouts', () => {
  const octagon = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return V(Math.round(1000 * Math.cos(a)), Math.round(1000 * Math.sin(a)));
  });

  it('puts the breakout on the outline edge, not set back from it', () => {
    // Upstream carries two commented-out alternatives — a 40% setback and an
    // absolute 0.1 mm — and uses neither. The exit sits on the edge, which is
    // visible in every routed connection, so the choice is pinned.
    const b = customBreakouts(0, V(0, 0), octagon, true);

    expect(b.length).toBeGreaterThan(0);

    for (const c of b) {
      const tip = c[c.length - 1] as Vec2;
      expect(Math.hypot(tip.x, tip.y)).toBeLessThanOrEqual(1001);
    }
  });

  it('casts four rays without diagonals and eight with', () => {
    expect(customBreakouts(0, V(0, 0), octagon, false)).toHaveLength(4);
    expect(customBreakouts(0, V(0, 0), octagon, true)).toHaveLength(8);
  });

  it('drops a ray that crosses nothing rather than inventing a point', () => {
    // Upstream's comment: n == 0 "can not happen I think, but..." — and it
    // simply does not push a breakout. A degenerate outline reaches that arm.
    expect(customBreakouts(0, V(0, 0), [V(0, 0)], true)).toHaveLength(0);
  });
});

describe('computeBreakouts: the dispatch over Ziro’s shape union', () => {
  const solidWith = (shape: Shape): PnsSolid => {
    const s = new PnsSolid();
    s.setShape(shape);
    s.setLayers(new PnsLayerRange(0));
    s.setNet(NET_A);
    return s;
  };

  it('sends a rectangular pad to rectBreakouts, not to the ray caster', () => {
    // Ziro has no rectangle shape, so a rect pad arrives as a poly. Taking the
    // union literally would give it eight ray casts where KiCad gives twelve
    // with the long-axis offset — and oblong pads are what this pass is for.
    const pad = solidWith({
      kind: 'poly',
      pts: [V(-2000, -500), V(2000, -500), V(2000, 500), V(-2000, 500)],
      r: 0,
    });
    const b = computeBreakouts(100, pad, true);

    expect(b).toHaveLength(8);
    expect(b.filter((c) => c.length === 3).map((c) => c[1] as Vec2)).toContainEqual({
      x: 1500,
      y: 0,
    });
  });

  it('sends a rotated pad to the ray caster', () => {
    const pad = solidWith({
      kind: 'poly',
      pts: [V(0, -1000), V(1000, 0), V(0, 1000), V(-1000, 0)],
      r: 0,
    });

    // Ray casts produce two-point chains; rectBreakouts' diagonals are three.
    expect(computeBreakouts(100, pad, true).every((c) => c.length === 2)).toBe(true);
  });

  it('sends a round pad to circleBreakouts', () => {
    const pad = solidWith({ kind: 'circle', c: V(0, 0), r: 500 });

    expect(computeBreakouts(100, pad, true)).toHaveLength(8);
  });

  it('approximates a stadium pad as a rect first', () => {
    const pad = solidWith({ kind: 'stadium', a: V(-1000, 0), b: V(1000, 0), r: 250 });
    const b = computeBreakouts(100, pad, true);

    expect(b).toHaveLength(8);
  });
});

describe('findPadOrVia', () => {
  it('returns the first via or pad linked to the joint at that point', () => {
    const node = new PnsNode();
    const pad = new PnsSolid();
    pad.setShape({ kind: 'circle', c: V(0, 0), r: 500 } as never);
    pad.setLayers(new PnsLayerRange(0));
    pad.setNet(NET_A);
    pad.setPos(V(0, 0));
    node.addSolid(pad);

    expect(findPadOrVia(node, 0, NET_A, V(0, 0))).toBe(pad);
  });

  it('answers null where there is no joint at all', () => {
    expect(findPadOrVia(new PnsNode(), 0, NET_A, V(12345, 6789))).toBeNull();
  });
});

describe('countCorners against the forbidden-angle mask', () => {
  it('counts a right-angle corner and not a 45-degree one', () => {
    const right = [V(0, 0), V(1000, 0), V(1000, 1000)];
    const diag = [V(0, 0), V(1000, 0), V(2000, 1000)];

    expect(countCorners(right, SMART_PADS_FORBIDDEN_ANGLES)).toBe(1);
    expect(countCorners(diag, SMART_PADS_FORBIDDEN_ANGLES)).toBe(0);
  });

  it('counts nothing on a chain too short to have a corner', () => {
    expect(countCorners([V(0, 0), V(100, 0)], SMART_PADS_FORBIDDEN_ANGLES)).toBe(0);
  });
});
