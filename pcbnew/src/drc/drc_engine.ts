// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRC engine. Counterparts: `pcbnew/drc/drc_engine.cpp` (constraint
 * resolution: the effective clearance between two items is the WORST,
 * largest, of the applicable rules: the board-setup minimum plus each
 * item's netclass clearance, mirroring the implicit per-netclass rules) and
 * the test providers:
 *   - drc_test_provider_copper_clearance (DRCE_CLEARANCE / clearance)
 *   - drc_test_provider_track_width (DRCE_TRACK_WIDTH / track_width)
 *   - drc_test_provider_annular_width (DRCE_ANNULAR_WIDTH / annular_width)
 *   - drc_test_provider_hole_size (drill_out_of_range, via_diameter)
 *   - drc_test_provider_hole_to_hole (hole_to_hole)
 *
 * Violation `code`s are the DRC_ITEM::GetSettingsKey() strings, so the
 * caller can look severities up directly in `rule_severities`.
 *
 * Geometry is EXACT (drc_geometry.ts mirrors the colliding SHAPE classes):
 * arc tracks use true arc collision, oval pads are stadiums, rect/trapezoid
 * pads are polygons, roundrect pads are deflated rectangles inflated by the
 * corner radius, custom pads collide primitive-by-primitive (gr_line/circle/
 * arc/poly/rect, an unfilled circle primitive is the exact stroked ring),
 * chamfered+rounded rects decompose into the exact chamfer-cut polygon plus
 * corner circles, and blind/micro vias exist only on their span layers.
 * Zone fills are not yet checked (TODO: zone provider).
 */

import { pcbIuToMM as iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { Board, PadPrimitive, PcbPad, PcbVia } from '../types.js';
import { type Shape, shapeBBox, shapeDist } from './drc_geometry.js';

// ---------------------------------------------------------------------------
// Public API.

export interface DrcOptions {
  /** rules.min_clearance (IU). */
  minClearance: number;
  /** rules.min_track_width (IU). */
  minTrackWidth: number;
  /** rules.min_via_diameter (IU). */
  minViaDiameter: number;
  /** rules.min_via_annular_width (IU). */
  minViaAnnulus: number;
  /** rules.min_through_hole_diameter (IU). */
  minThroughHole: number;
  /** rules.min_hole_to_hole (IU). */
  minHoleToHole: number;
  /** Netclass clearance for a net code (IU); absent = 0 (the implicit
   *  netclass clearance rules of drc_engine.cpp). */
  clearanceOf?: (net: number) => number;
}

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
  return { kind: 'arc', c, rad, a0, sweep, r: width / 2 };
}

/** The pad's copper shapes (board-absolute; pad.at/angle are absolute).
 *  Custom pads return the anchor plus one shape per primitive. */
export function padShapes(pad: PcbPad): Shape[] {
  const { x: w, y: h } = pad.size;
  const at = pad.at;
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

function primitiveShapes(prim: PadPrimitive, place: (p: Vec2) => Vec2): Shape[] {
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
function viaLayers(v: PcbVia, copperOrder: string[]): string[] {
  const i0 = copperOrder.indexOf(v.layers[0]);
  const i1 = copperOrder.indexOf(v.layers[1]);
  if (i0 === -1 || i1 === -1) return copperOrder;
  return copperOrder.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
}

// ---------------------------------------------------------------------------
// The engine.

export function runDrc(board: Board, opts: DrcOptions): DrcViolation[] {
  const out: DrcViolation[] = [];
  const clearanceOf = opts.clearanceOf ?? (() => 0);
  // The (layers …) table lists copper front-to-back (CuStack order).
  const copperOrder = board.layers.map((l) => l.name).filter(isCopper);
  const netName = (n: number): string => board.nets.get(n) || `net ${n}`;
  const mm = (iu: number): string =>
    `${iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} mm`;

  // ----- collect copper items per layer ------------------------------------
  let ownerSeq = 0;
  const itemsByLayer = new Map<string, CopperItem[]>();
  const push = (item: CopperItem): void => {
    const list = itemsByLayer.get(item.layer);
    if (list) list.push(item);
    else itemsByLayer.set(item.layer, [item]);
  };

  for (const t of board.tracks) {
    push({
      layer: t.layer,
      net: t.net,
      shape: { kind: 'stadium', a: t.start, b: t.end, r: t.width / 2 },
      desc: `Track [${netName(t.net)}] on ${t.layer}`,
      pos: t.start,
      owner: ownerSeq++,
    });
  }
  for (const a of board.arcs) {
    push({
      layer: a.layer,
      net: a.net,
      shape: arcShape(a.start, a.mid, a.end, a.width),
      desc: `Arc track [${netName(a.net)}] on ${a.layer}`,
      pos: a.start,
      owner: ownerSeq++,
    });
  }
  const vias: PcbVia[] = board.vias;
  for (const v of vias) {
    const owner = ownerSeq++;
    for (const layer of viaLayers(v, copperOrder)) {
      push({
        layer,
        net: v.net,
        shape: { kind: 'circle', c: v.at, r: v.size / 2 },
        desc: `Via [${netName(v.net)}]`,
        pos: v.at,
        owner,
      });
    }
  }
  for (const z of board.zones) {
    // Filled zone copper (PcbZoneFill polygons; any simple polygon). A
    // zone's own fills never collide with each other, and KiCad checks
    // filled copper against other nets like any other copper.
    const owner = ownerSeq++;
    for (const fill of z.fills) {
      for (const poly of fill.polys) {
        if (poly.length < 3) continue;
        push({
          layer: fill.layer,
          net: z.net,
          shape: { kind: 'poly', pts: poly, r: 0 },
          desc: `Zone fill [${netName(z.net)}] on ${fill.layer}`,
          pos: poly[0]!,
          owner,
        });
      }
    }
  }
  const pads: { pad: PcbPad; ref: string }[] = [];
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      pads.push({ pad, ref: fp.reference ?? fp.lib });
      const owner = ownerSeq++;
      const shapes = padShapes(pad);
      for (const layer of copperOrder) {
        if (!padOnLayer(pad, layer)) continue;
        for (const shape of shapes) {
          push({
            layer,
            net: pad.net ?? 0,
            shape,
            desc: `Pad ${pad.number} [${netName(pad.net ?? 0)}] of ${fp.reference ?? fp.lib}`,
            pos: pad.at,
            owner,
          });
        }
      }
    }
  }

  // ----- clearance (copper pairs, per layer) -------------------------------
  for (const [, items] of itemsByLayer) {
    const withBox = items.map((it) => ({ it, box: shapeBBox(it.shape) }));
    withBox.sort((p, q) => p.box.minX - q.box.minX);
    let maxClearance = opts.minClearance;
    for (const i of items) maxClearance = Math.max(maxClearance, clearanceOf(i.net));
    for (let i = 0; i < withBox.length; i++) {
      const A = withBox[i]!;
      for (let j = i + 1; j < withBox.length; j++) {
        const B = withBox[j]!;
        if (B.box.minX > A.box.maxX + maxClearance) break;
        if (A.it.owner === B.it.owner) continue;
        if (A.it.net === B.it.net && A.it.net !== 0) continue;
        const required = Math.max(opts.minClearance, clearanceOf(A.it.net), clearanceOf(B.it.net));
        if (required <= 0) continue;
        if (B.box.minY > A.box.maxY + required || A.box.minY > B.box.maxY + required) continue;
        const gap = shapeDist(A.it.shape, B.it.shape);
        if (gap < required) {
          out.push({
            code: 'clearance',
            message: `Clearance violation (clearance ${mm(required)}; actual ${mm(gap)})`,
            pos: A.it.pos,
            items: [
              { desc: A.it.desc, pos: A.it.pos },
              { desc: B.it.desc, pos: B.it.pos },
            ],
          });
        }
      }
    }
  }

  // ----- track_width -------------------------------------------------------
  if (opts.minTrackWidth > 0) {
    for (const t of [...board.tracks, ...board.arcs]) {
      if (t.width < opts.minTrackWidth) {
        out.push({
          code: 'track_width',
          message: `Track width (min width ${mm(opts.minTrackWidth)}; actual ${mm(t.width)})`,
          pos: t.start,
          items: [{ desc: `Track [${netName(t.net)}] on ${t.layer}`, pos: t.start }],
        });
      }
    }
  }

  // ----- via checks --------------------------------------------------------
  for (const v of vias) {
    if (opts.minViaDiameter > 0 && v.size < opts.minViaDiameter) {
      out.push({
        code: 'via_diameter',
        message: `Via diameter (min diameter ${mm(opts.minViaDiameter)}; actual ${mm(v.size)})`,
        pos: v.at,
        items: [{ desc: `Via [${netName(v.net)}]`, pos: v.at }],
      });
    }
    const annulus = (v.size - v.drill) / 2;
    if (opts.minViaAnnulus > 0 && annulus < opts.minViaAnnulus) {
      out.push({
        code: 'annular_width',
        message: `Annular width (min annular width ${mm(opts.minViaAnnulus)}; actual ${mm(annulus)})`,
        pos: v.at,
        items: [{ desc: `Via [${netName(v.net)}]`, pos: v.at }],
      });
    }
    if (opts.minThroughHole > 0 && v.drill < opts.minThroughHole) {
      out.push({
        code: 'drill_out_of_range',
        message: `Hole size out of range (min hole ${mm(opts.minThroughHole)}; actual ${mm(v.drill)})`,
        pos: v.at,
        items: [{ desc: `Via [${netName(v.net)}]`, pos: v.at }],
      });
    }
  }
  if (opts.minThroughHole > 0) {
    for (const { pad, ref } of pads) {
      if (!pad.drill) continue;
      const d = Math.min(pad.drill.w, pad.drill.h || pad.drill.w);
      if (d < opts.minThroughHole) {
        out.push({
          code: 'drill_out_of_range',
          message: `Hole size out of range (min hole ${mm(opts.minThroughHole)}; actual ${mm(d)})`,
          pos: pad.at,
          items: [{ desc: `Pad ${pad.number} of ${ref}`, pos: pad.at }],
        });
      }
    }
  }

  // ----- hole_to_hole (any layer; hole edge to hole edge) ------------------
  if (opts.minHoleToHole > 0) {
    const holes: { c: Vec2; r: number; desc: string }[] = [
      ...vias.map((v) => ({ c: v.at, r: v.drill / 2, desc: `Via [${netName(v.net)}]` })),
      ...pads
        .filter(({ pad }) => pad.drill)
        .map(({ pad, ref }) => ({
          c: pad.at,
          r: Math.min(pad.drill!.w, pad.drill!.h || pad.drill!.w) / 2,
          desc: `Pad ${pad.number} of ${ref}`,
        })),
    ];
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const a = holes[i]!;
        const b = holes[j]!;
        const gap = Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) - a.r - b.r;
        if (gap < opts.minHoleToHole && gap > -Math.min(a.r, b.r)) {
          out.push({
            code: 'hole_to_hole',
            message: `Drilled hole too close to other hole (min ${mm(opts.minHoleToHole)}; actual ${mm(Math.max(0, gap))})`,
            pos: a.c,
            items: [
              { desc: a.desc, pos: a.c },
              { desc: b.desc, pos: b.c },
            ],
          });
        }
      }
    }
  }

  return out;
}
