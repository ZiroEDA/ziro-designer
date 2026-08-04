// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Turning a board into the shapes creepage is solved over.
 * Counterparts: `CREEPAGE_GRAPH::AddNetElements`, `Addshape` and
 * `BuildCreepageBoardEdges`.
 *
 * ## Board edges become corners, not lines
 *
 * A straight edge contributes only its two *endpoints*, because a shortest
 * path across a polygonal surface bends only at corners — a node in the middle
 * of a straight run can never lie on one. Curved edges are different: a path
 * can leave a curve anywhere along it, so an arc or a circle goes in whole.
 *
 * ## Everything conductive counts, including the pour
 *
 * Leaving a shape kind out does not make the check conservative, it makes it
 * *wrong in the dangerous direction*: fewer shapes means fewer routes, which
 * means a longer reported distance and a violation that never fires. So pads,
 * vias, tracks, arcs and zone fills all go in.
 *
 * A zone fill is a polygon of many points, and its boundary becomes one
 * zero-width segment per edge. That is the honest representation — a fill's
 * copper really does end at those edges — but it is also what makes this the
 * expensive part of the check, which is why the solver filters pairs by
 * bounding box before asking the geometry anything.
 */
import { arcCenter } from '../read-board.js';
import { chainOutlines, shapePoints } from '../courtyard.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { BoardSurface, CreepShape } from './creepage_graph.js';
import type { Board, PcbPad, PcbShape } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Chaining tolerance for Edge.Cuts, the board's own 0.01 mm. */
const OUTLINE_EPSILON = mmToIU(0.01);
/** Tessellation tolerance where a curve has to become points. */
const ARC_ERROR = mmToIU(0.05);

/** Twice the signed area of a ring; only its magnitude is used here. */
function ringArea(ring: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return Math.abs(a / 2);
}

/**
 * The board as an outline and its cutouts, or `null` when Edge.Cuts does not
 * close into anything.
 *
 * The largest ring is taken as the outline and the rest as holes. That is the
 * usual nesting rule and it is right for any board that is one connected
 * piece; a board milled into two separate pieces would need real containment
 * testing, and does not arise from a single Edge.Cuts outline.
 */
export function boardSurface(board: Board): BoardSurface | null {
  const edges = [...board.shapes, ...board.footprints.flatMap((fp) => fp.shapes)].filter(
    (s) => s.layer === 'Edge.Cuts',
  );

  const closed: Vec2[][] = [];
  const open: Vec2[][] = [];

  for (const s of edges) {
    const pts = shapePoints(s, ARC_ERROR);
    if (!pts) continue;
    (pts.closed ? closed : open).push(pts.pts);
  }

  const rings = [...closed, ...chainOutlines(open, OUTLINE_EPSILON).outlines];
  if (rings.length === 0) return null;

  let outer = rings[0]!;
  for (const ring of rings) if (ringArea(ring) > ringArea(outer)) outer = ring;

  return { outline: outer, holes: rings.filter((r) => r !== outer) };
}

/** The board-edge shapes a path can bend around. */
export function boardEdgeShapes(board: Board): CreepShape[] {
  const out: CreepShape[] = [];
  const edges = [...board.shapes, ...board.footprints.flatMap((fp) => fp.shapes)].filter(
    (s) => s.layer === 'Edge.Cuts',
  );

  const corner = (p: Vec2): void => {
    out.push({ kind: 'be-point', pos: p });
  };

  for (const s of edges) {
    switch (s.kind) {
      case 'line':
        // Endpoints only: the middle of a straight edge is never a turn.
        if (s.start && s.end) {
          corner(s.start);
          corner(s.end);
        }
        break;

      case 'rect':
        if (s.start && s.end) {
          corner(s.start);
          corner({ x: s.end.x, y: s.start.y });
          corner(s.end);
          corner({ x: s.start.x, y: s.end.y });
        }
        break;

      case 'poly':
        for (const p of s.pts ?? []) corner(p);
        break;

      case 'circle':
        if (s.center && s.end)
          out.push({
            kind: 'be-circle',
            pos: s.center,
            radius: Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y),
          });
        break;

      case 'arc': {
        const arc = beArcOf(s);
        if (arc) out.push(arc);
        break;
      }

      // A Bezier's control points are not its curve, so there is nothing here
      // that can be turned into an obstacle honestly.
      case 'curve':
        break;
    }
  }

  return out;
}

/** A drawn arc as the creepage shape, or null when it is degenerate. */
function beArcOf(s: PcbShape): CreepShape | null {
  if (!s.start || !s.mid || !s.end) return null;
  const c = arcCenter(s.start, s.mid, s.end);
  if (!c) return null;

  const radius = Math.hypot(s.start.x - c.x, s.start.y - c.y);
  if (radius <= 0) return null;

  const { startAngle, endAngle } = sweepOf(c, s.start, s.mid, s.end);
  return {
    kind: 'be-arc',
    pos: c,
    radius,
    startAngle,
    endAngle,
    startPoint: s.start,
    endPoint: s.end,
  };
}

/**
 * The sweep from `start` to `end` the way round that passes through `mid`.
 *
 * Wound forward from the start so `endAngle` can exceed it by up to a full
 * turn, which is the convention every arc predicate here expects.
 */
export function sweepOf(
  center: Vec2,
  start: Vec2,
  mid: Vec2,
  end: Vec2,
): { startAngle: number; endAngle: number } {
  const TWO_PI = Math.PI * 2;
  const angleOf = (p: Vec2): number => Math.atan2(p.y - center.y, p.x - center.x);

  const startAngle = angleOf(start);
  let midAngle = angleOf(mid);
  let endAngle = angleOf(end);

  while (midAngle < startAngle) midAngle += TWO_PI;
  while (endAngle < midAngle) endAngle += TWO_PI;

  return { startAngle, endAngle };
}

/** Whether a pad is a plain circle, which the geometry models exactly. */
const isRoundPad = (pad: PcbPad): boolean =>
  pad.shape === 'circle' || (pad.shape === 'oval' && pad.size.x === pad.size.y);

/** A polygon ring as zero-width copper segments — the boundary of a fill or pad. */
function ringAsCopper(ring: readonly Vec2[], out: CreepShape[]): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a.x === b.x && a.y === b.y) continue;
    out.push({ kind: 'cu-segment', start: a, end: b, width: 0 });
  }
}

/**
 * Every net's copper on one layer, keyed by net code.
 *
 * Net 0 is skipped: it is the absence of a net, not a net, and creepage is a
 * question about two named conductors.
 */
export function copperShapesByNet(board: Board, layer: string): Map<number, CreepShape[]> {
  const byNet = new Map<number, CreepShape[]>();
  const add = (net: number, shape: CreepShape): void => {
    if (net <= 0) return;
    const list = byNet.get(net);
    if (list) list.push(shape);
    else byNet.set(net, [shape]);
  };

  for (const t of board.tracks) {
    if (t.layer !== layer) continue;
    add(t.net, { kind: 'cu-segment', start: t.start, end: t.end, width: t.width });
  }

  for (const a of board.arcs) {
    if (a.layer !== layer) continue;
    const c = arcCenter(a.start, a.mid, a.end);
    if (!c) continue;
    const radius = Math.hypot(a.start.x - c.x, a.start.y - c.y);
    if (radius <= 0) continue;
    const { startAngle, endAngle } = sweepOf(c, a.start, a.mid, a.end);
    add(a.net, {
      kind: 'cu-arc',
      pos: c,
      radius,
      startAngle,
      endAngle,
      startPoint: a.start,
      endPoint: a.end,
      width: a.width,
    });
  }

  for (const v of board.vias) {
    // A via is copper on every layer of its span; the annulus is what a path
    // reaches, so its outer diameter is the circle.
    add(v.net, { kind: 'cu-circle', pos: v.at, radius: v.size / 2 });
  }

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!pad.layers.some((l) => l === layer || l === '*.Cu')) continue;

      if (isRoundPad(pad)) {
        add(pad.net ?? 0, { kind: 'cu-circle', pos: pad.at, radius: pad.size.x / 2 });
      } else {
        // Anything else goes in as its outline. A rectangular pad's boundary
        // really is straight segments, so this is exact for the common case
        // and a fair approximation of a rounded one.
        const shapes: CreepShape[] = [];
        ringAsCopper(padRing(pad), shapes);
        for (const s of shapes) add(pad.net ?? 0, s);
      }
    }
  }

  for (const z of board.zones) {
    if (z.ruleArea) continue;
    for (const fill of z.fills) {
      if (fill.layer !== layer) continue;
      for (const poly of fill.polys) {
        if (poly.length < 3) continue;
        const shapes: CreepShape[] = [];
        ringAsCopper(poly, shapes);
        for (const s of shapes) add(z.net, s);
      }
    }
  }

  return byNet;
}

/** A pad's outline as a ring, at its own rotation. */
function padRing(pad: PcbPad): Vec2[] {
  const hx = pad.size.x / 2;
  const hy = pad.size.y / 2;
  const a = ((pad.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);

  return [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
    { x: -hx, y: hy },
  ].map((p) => ({
    x: Math.round(pad.at.x + p.x * cos - p.y * sin),
    y: Math.round(pad.at.y + p.x * sin + p.y * cos),
  }));
}
