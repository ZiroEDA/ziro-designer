// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The plain-object `Board` view's shape helpers, the last of the view DRC
 * engine. The engine itself (runDrc and its providers) is gone: DRC runs on
 * the live BOARD through `drc_engine.ts` + `drc_test_provider_*.ts`
 * (#636 stage 4d). What is left here is what the router, the zone filler,
 * the ratsnest, the footprint checker and the teardrop builder still read
 * from the view - `arcShape`, `padShapes`, `primitiveShapes`,
 * `graphicShapes`, `viaLayers`, `likelyFootprintAttribute`,
 * `ruleAreaRules` - and the `DrcViolation` record the view-side library
 * parity check emits. All of it goes when those move onto the classes
 * (stage 3 / 5).
 */
import { padShapePos } from '../padstack.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type {
  Board,
  PadPrimitive,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbVia,
  PcbZone,
} from '../types.js';
import type { Shape } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import type { DrcDisallow, DrcRule } from './drc_rule_view.js';
import { isSolidFill } from '../shape_fill.js';

// ---------------------------------------------------------------------------
// Public API.

/** An offending item reference (RC_ITEM main/aux item, resolvable for
 *  the dialog's click-to-locate like BOARD::ResolveItem + focus). */
export interface DrcItemRef {
  /** Short description of the item. */
  desc: string;
  /** The item's focus position (IU). */
  pos: Vec2;
}

export interface DrcViolation {
  /** DRC_ITEM settings key ('clearance', 'track_width', …). */
  code: string;
  /** Human message like DRC_ITEM::SetViolatingRule text. */
  message: string;
  /** Marker position (IU). */
  pos: Vec2;
  /** The offending item(s). */
  items: DrcItemRef[];
}

interface CopperItem {
  layer: string;
  net: number;
  shape: Shape;
  desc: string;
  pos: Vec2;
  /** Same-owner shapes (one pad's primitives) never collide with each other. */
  owner: number;
  /**
   * The centreline, straight tracks only. Upstream's crossing test is
   * PCB_TRACE_T against PCB_TRACE_T — an arc is not part of it.
   */
  track?: { a: Vec2; b: Vec2 };
  /**
   * The zone a fill polygon belongs to. The isolation test needs it: a zone's
   * own other islands must not count as its connection, or two disjoint
   * halves of one pour would vouch for each other.
   */
  zone?: PcbZone;
}

// ---------------------------------------------------------------------------
// Item shapes.

/** KiCad RotatePoint: PCB screen coords rotate clockwise for +angle. */
function rot(p: Vec2, deg: number): Vec2 {
  if (!deg) return p;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos };
}

/** Circumcenter of the arc through start/mid/end (null when collinear). */
function arcCenter(s: Vec2, m: Vec2, e: Vec2): Vec2 | null {
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
  if (d === 0) return null;
  const s2 = s.x * s.x + s.y * s.y;
  const m2 = m.x * m.x + m.y * m.y;
  const e2 = e.x * e.x + e.y * e.y;
  return {
    x: (s2 * (m.y - e.y) + m2 * (e.y - s.y) + e2 * (s.y - m.y)) / d,
    y: (s2 * (e.x - m.x) + m2 * (s.x - e.x) + e2 * (m.x - s.x)) / d,
  };
}

/** SHAPE_ARC from a track arc's start/mid/end + width. */
export function arcShape(s: Vec2, m: Vec2, e: Vec2, width: number): Shape {
  const c = arcCenter(s, m, e);
  if (!c) return { kind: 'stadium', a: s, b: e, r: width / 2 };
  const rad = Math.hypot(s.x - c.x, s.y - c.y);
  const a0 = Math.atan2(s.y - c.y, s.x - c.x);
  const am = Math.atan2(m.y - c.y, m.x - c.x);
  const a1 = Math.atan2(e.y - c.y, e.x - c.x);
  const TAU = 2 * Math.PI;
  const norm = (a: number): number => ((a % TAU) + TAU) % TAU;
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= TAU; // the mid point picks the direction
  return { kind: 'arc', c, rad, a0, sweep, r: width / 2, chord: { s, m, e } };
}

/** The pad's copper shapes (board-absolute; pad.at/angle are absolute).
 *  Custom pads return the anchor plus one shape per primitive.
 *
 *  Every shape is centred on `PAD::ShapePos`, not on `pad.at`: a drill
 *  `(offset …)` moves the COPPER and leaves the hole on the pad position. */
export function padShapes(pad: PcbPad): Shape[] {
  const { x: w, y: h } = pad.size;
  const at = padShapePos(pad);
  const place = (p: Vec2): Vec2 => {
    const q = rot(p, pad.angle);
    return { x: at.x + q.x, y: at.y + q.y };
  };
  const rectPoly = (rw: number, rh: number, inflate: number): Shape => ({
    kind: 'poly',
    pts: [
      place({ x: -rw / 2, y: -rh / 2 }),
      place({ x: rw / 2, y: -rh / 2 }),
      place({ x: rw / 2, y: rh / 2 }),
      place({ x: -rw / 2, y: rh / 2 }),
    ],
    r: inflate,
  });

  if (pad.shape === 'circle') return [{ kind: 'circle', c: at, r: w / 2 }];
  if (pad.shape === 'oval') {
    const r = Math.min(w, h) / 2;
    const half = (Math.max(w, h) - Math.min(w, h)) / 2;
    const d = rot(w >= h ? { x: half, y: 0 } : { x: 0, y: half }, pad.angle);
    return [
      {
        kind: 'stadium',
        a: { x: at.x - d.x, y: at.y - d.y },
        b: { x: at.x + d.x, y: at.y + d.y },
        r,
      },
    ];
  }
  if (pad.shape === 'trapezoid') {
    const dx = pad.delta?.x ?? 0;
    const dy = pad.delta?.y ?? 0;
    return [
      {
        kind: 'poly',
        pts: [
          place({ x: -w / 2 - dy / 2, y: -h / 2 + dx / 2 }),
          place({ x: w / 2 + dy / 2, y: -h / 2 - dx / 2 }),
          place({ x: w / 2 - dy / 2, y: h / 2 + dx / 2 }),
          place({ x: -w / 2 + dy / 2, y: h / 2 - dx / 2 }),
        ],
        r: 0,
      },
    ];
  }
  if (pad.shape === 'roundrect' && !pad.chamfer?.length) {
    // Exact: the rectangle deflated by the corner radius, inflated back by it.
    const rr = Math.min((pad.roundrectRatio ?? 0.25) * Math.min(w, h), Math.min(w, h) / 2);
    return [rectPoly(w - 2 * rr, h - 2 * rr, rr)];
  }
  if (pad.shape === 'roundrect' && pad.chamfer?.length) {
    // EXACT as a union: one polygon whose chamfered corners are the straight
    // cuts on the full rectangle and whose rounded corners are the two arc
    // tangent points, plus one circle per rounded corner (radius rr at the
    // corner center) to fill the rounded bulge, the same area KiCad's
    // TransformShapeToPolygon covers.
    const rr = Math.min((pad.roundrectRatio ?? 0) * Math.min(w, h), Math.min(w, h) / 2);
    const cut = (pad.chamferRatio ?? 0.2) * Math.min(w, h);
    const hw = w / 2;
    const hh = h / 2;
    const has = (name: string): boolean => pad.chamfer!.includes(name);
    const pts: Vec2[] = [];
    const circles: Shape[] = [];
    // Corners clockwise from top-left in the pad frame: [sx, sy, name].
    const corners: [number, number, string][] = [
      [-1, -1, 'top_left'],
      [-1, 1, 'bottom_left'],
      [1, 1, 'bottom_right'],
      [1, -1, 'top_right'],
    ];
    for (const [sx, sy, name] of corners) {
      const cx = sx * hw;
      const cy = sy * hh;
      if (has(name)) {
        // The straight chamfer cut on the full rectangle.
        const p1 = { x: cx - sx * cut, y: cy };
        const p2 = { x: cx, y: cy - sy * cut };
        // Keep winding: emit in edge order around the outline.
        if ((sx === -1 && sy === -1) || (sx === 1 && sy === 1)) pts.push(p1, p2);
        else pts.push(p2, p1);
      } else if (rr > 0) {
        // Tangent points of the corner arc + the corner circle.
        const t1 = { x: cx - sx * rr, y: cy };
        const t2 = { x: cx, y: cy - sy * rr };
        if ((sx === -1 && sy === -1) || (sx === 1 && sy === 1)) pts.push(t1, t2);
        else pts.push(t2, t1);
        circles.push({ kind: 'circle', c: place({ x: cx - sx * rr, y: cy - sy * rr }), r: rr });
      } else {
        pts.push({ x: cx, y: cy });
      }
    }
    return [{ kind: 'poly', pts: pts.map(place), r: 0 }, ...circles];
  }
  if (pad.shape === 'custom') {
    const shapes: Shape[] = [
      // The anchor shape (rect or circle of `size`).
      w === h && pad.primitives?.length ? { kind: 'circle', c: at, r: w / 2 } : rectPoly(w, h, 0),
    ];
    for (const prim of pad.primitives ?? []) shapes.push(...primitiveShapes(prim, place));
    return shapes;
  }
  // rect
  return [rectPoly(w, h, 0)];
}

export function primitiveShapes(prim: PadPrimitive, place: (p: Vec2) => Vec2): Shape[] {
  const r = prim.width / 2;
  if (prim.kind === 'gr_line' && prim.start && prim.end)
    return [{ kind: 'stadium', a: place(prim.start), b: place(prim.end), r }];
  if (prim.kind === 'gr_circle' && prim.center && prim.end) {
    const rad = Math.hypot(prim.end.x - prim.center.x, prim.end.y - prim.center.y);
    // Filled: a disc out to the stroke's outer edge. Unfilled: the exact
    // ring, a full-sweep arc stroked at width/2.
    if (prim.fill) return [{ kind: 'circle', c: place(prim.center), r: rad + r }];
    return [{ kind: 'arc', c: place(prim.center), rad, a0: 0, sweep: 2 * Math.PI, r }];
  }
  if (prim.kind === 'gr_arc' && prim.start && prim.mid && prim.end) {
    const s = arcShape(place(prim.start), place(prim.mid), place(prim.end), prim.width);
    return [s];
  }
  if (prim.kind === 'gr_rect' && prim.start && prim.end) {
    const { start: a, end: b } = prim;
    return [
      {
        kind: 'poly',
        pts: [
          place({ x: a.x, y: a.y }),
          place({ x: b.x, y: a.y }),
          place({ x: b.x, y: b.y }),
          place({ x: a.x, y: b.y }),
        ],
        r,
      },
    ];
  }
  if (prim.kind === 'gr_poly' && prim.pts && prim.pts.length >= 3)
    return [{ kind: 'poly', pts: prim.pts.map(place), r }];
  return [];
}

const isCopper = (layer: string): boolean => /\.Cu$/.test(layer);
const padOnLayer = (pad: PcbPad, layer: string): boolean =>
  pad.layers.includes(layer) || (pad.layers.includes('*.Cu') && isCopper(layer));

/** The copper layers a via exists on: its span in board stack order. */
export function viaLayers(v: PcbVia, copperOrder: string[]): string[] {
  const i0 = copperOrder.indexOf(v.layers[0]);
  const i1 = copperOrder.indexOf(v.layers[1]);
  if (i0 === -1 || i1 === -1) return copperOrder;
  return copperOrder.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
}

// ---------------------------------------------------------------------------
// The engine.

/** A board graphic's collision geometry, PCB_SHAPE::GetEffectiveShape. */
/** The closed outline of `pts` as one stadium per side, each of radius `r`. */
function strokedRing(pts: readonly { x: number; y: number }[], r: number): Shape[] {
  const out: Shape[] = [];
  for (let i = 0; i < pts.length; i++)
    out.push({ kind: 'stadium', a: pts[i]!, b: pts[(i + 1) % pts.length]!, r });
  return out;
}
