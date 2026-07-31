// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pouring copper zones. Counterpart: `pcbnew/zone_filler.cpp` (ZONE_FILLER),
 * whose shape this follows:
 *
 *   fill = smoothed outline
 *        - thermal reliefs around same-net pads
 *        - clearance around every other net's copper, and every hole
 *        + thermal spokes back to those same-net pads
 *   then islands that reach nothing on the net are dropped.
 *
 * Where upstream deflates and inflates SHAPE_POLY_SETs with Clipper, this
 * inflates a shape by unioning it with a stadium along each of its edges, which
 * needs booleans only. That covers every knockout; it does not give a general
 * polygon offsetter, so the parts of ZONE_FILLER that need one are not here:
 *
 *  - the min-thickness prune (postKnockoutMinWidthPrune deflates then inflates
 *    by half the min width to drop slivers), so thin necks upstream would remove
 *    survive here;
 *  - outline smoothing (chamfer/fillet corners);
 *  - hatch-pattern fill, copper thieving and teardrops;
 *  - custom-pad spoke templates, and via thermal connections (upstream only
 *    does those for hatched zones anyway).
 */

import polygonClipping, { type Geom, type MultiPolygon, type Ring } from 'polygon-clipping';
import { pcbIuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { fracture, type Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { padShapes } from './drc/drc_engine.js';
import type { Shape } from './drc/drc_geometry.js';
import { tessellateArc } from './read-board.js';
import type { Board, PcbPad, PcbZone, PcbZoneFill } from './types.js';

/** BOARD_DESIGN_SETTINGS::m_MaxError, the arc approximation limit (0.005 mm). */
const DEFAULT_MAX_ERROR = mmToIU(0.005);

export interface ZoneFillOptions {
  /**
   * Clearance in IU required between this zone and another net's copper. The
   * board's DRC clearance; defaults to the zone's own `(connect_pads
   * (clearance …))`, which is what a board with no rules resolves to.
   */
  clearanceOf?: (zone: PcbZone, otherNet: number) => number;
  /** Arc/circle approximation error (m_MaxError). */
  maxError?: number;
}

// ----- polygon helpers --------------------------------------------------------

const ringOf = (pts: Vec2[]): Ring => pts.map((p) => [p.x, p.y] as [number, number]);
const ptsOf = (ring: Ring): Vec2[] => ring.map(([x, y]) => ({ x, y }));

/** GetArcToSegmentCount: enough segments that the chord error stays under maxError. */
function segmentsForRadius(radius: number, maxError: number): number {
  if (radius <= 0) return 4;
  const argument = 1 - maxError / radius;
  const count =
    argument <= -1 ? 8 : Math.ceil((2 * Math.PI) / Math.acos(Math.max(-1, argument)) / 2);
  return Math.max(8, Math.min(64, count * 2));
}

/** A circle as a polygon, inscribed the way TransformCircleToPolygon does. */
function circlePoly(c: Vec2, r: number, maxError: number): Ring {
  const n = segmentsForRadius(r, maxError);
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]);
  }
  return ring;
}

/** A stadium (segment thickened by `r`) as a polygon. */
function stadiumPoly(a: Vec2, b: Vec2, r: number, maxError: number): Ring {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return circlePoly(a, r, maxError);
  const n = Math.max(4, segmentsForRadius(r, maxError) / 2);
  const ring: Ring = [];
  const base = Math.atan2(dy, dx);
  // Cap around b, then back around a.
  for (let i = 0; i <= n; i++) {
    const t = base - Math.PI / 2 + (Math.PI * i) / n;
    ring.push([b.x + r * Math.cos(t), b.y + r * Math.sin(t)]);
  }
  for (let i = 0; i <= n; i++) {
    const t = base + Math.PI / 2 + (Math.PI * i) / n;
    ring.push([a.x + r * Math.cos(t), a.y + r * Math.sin(t)]);
  }
  return ring;
}

/**
 * A DRC shape as a polygon grown by `gap`. Inflation is a union of the shape
 * with a stadium along each edge, which is what keeps this to booleans alone.
 */
function shapeToPolygon(shape: Shape, gap: number, maxError: number): Geom[] {
  switch (shape.kind) {
    case 'circle':
      return [[circlePoly(shape.c, shape.r + gap, maxError)]];
    case 'stadium':
      return [[stadiumPoly(shape.a, shape.b, shape.r + gap, maxError)]];
    case 'arc': {
      // The arc's centreline, thickened by its own half-width plus the gap.
      const out: Geom[] = [];
      const steps = segmentsForRadius(shape.rad, maxError);
      let prev: Vec2 | null = null;
      for (let i = 0; i <= steps; i++) {
        const a = shape.a0 + (shape.sweep * i) / steps;
        const p = {
          x: shape.c.x + shape.rad * Math.cos(a),
          y: shape.c.y + shape.rad * Math.sin(a),
        };
        if (prev) out.push([stadiumPoly(prev, p, shape.r + gap, maxError)]);
        prev = p;
      }
      return out;
    }
    case 'poly': {
      const grow = shape.r + gap;
      const out: Geom[] = [[ringOf(shape.pts)]];
      if (grow > 0) {
        for (let i = 0; i < shape.pts.length; i++) {
          const a = shape.pts[i]!;
          const b = shape.pts[(i + 1) % shape.pts.length]!;
          out.push([stadiumPoly(a, b, grow, maxError)]);
        }
      }
      return out;
    }
  }
}

const isCopper = (layer: string): boolean => /\.Cu$/.test(layer);
const padOnLayer = (pad: PcbPad, layer: string): boolean =>
  pad.layers.some((l) => l === layer || l === '*.Cu');

// ----- thermal spokes ---------------------------------------------------------

/**
 * ZONE_FILLER::buildThermalSpokes: square-ended segments from the pad centre out
 * past the thermal relief, four of them on the pad's own axes. The width is
 * clamped to the pad's minor axis and dropped entirely below the zone's min
 * thickness, since a stub thinner than that is not copper the pour can hold.
 */
function thermalSpokes(pad: PcbPad, zone: PcbZone): Geom[] {
  const gap = zone.thermalGap ?? mmToIU(0.5);
  const minor = Math.min(pad.size.x, pad.size.y);
  const width = Math.min(zone.thermalBridgeWidth ?? mmToIU(0.5), minor);
  if (width < (zone.minThickness ?? 0)) return [];

  // Long enough to cross the relief ring and land in the pour beyond it.
  const reach = Math.max(pad.size.x, pad.size.y) / 2 + gap + width;
  const angle = ((pad.angle ?? 0) * Math.PI) / 180;
  const out: Geom[] = [];

  for (let i = 0; i < 4; i++) {
    const a = angle + (i * Math.PI) / 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tip = { x: pad.at.x + dx * reach, y: pad.at.y + dy * reach };
    // Square ends: a stadium of half the width would round them, so build the
    // rectangle directly.
    const hx = (-dy * width) / 2;
    const hy = (dx * width) / 2;
    out.push([
      [
        [pad.at.x + hx, pad.at.y + hy],
        [tip.x + hx, tip.y + hy],
        [tip.x - hx, tip.y - hy],
        [pad.at.x - hx, pad.at.y - hy],
      ],
    ]);
  }
  return out;
}

// ----- the filler -------------------------------------------------------------

/** The fill polygons one zone would take, per layer (ZONE_FILLER::fillSingleZone). */
export function fillZone(
  board: Board,
  zoneIndex: number,
  opts: ZoneFillOptions = {},
): PcbZoneFill[] {
  const zone = board.zones[zoneIndex];
  if (!zone?.outline || zone.outline.length < 3) return [];

  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const clearanceOf = opts.clearanceOf ?? ((z: PcbZone) => z.clearance ?? mmToIU(0.5));
  const fills: PcbZoneFill[] = [];

  for (const layer of zone.layers) {
    if (!isCopper(layer)) continue;

    const outline: Geom = [ringOf(zone.outline)];
    const holes: Geom[] = [];
    const spokes: Geom[] = [];
    const connected: Vec2[] = []; // same-net anchors, for island removal

    const gapTo = (net: number): number => clearanceOf(zone, net);

    // Pads.
    for (const fp of board.footprints) {
      for (const pad of fp.pads) {
        if (!padOnLayer(pad, layer)) continue;
        const sameNet = (pad.net ?? 0) === zone.net && zone.net > 0;
        const shapes = padShapes(pad);

        if (sameNet) {
          connected.push(pad.at);
          const mode = zone.padConnection ?? 'thermal';
          if (mode === 'full') continue; // solid connection: nothing knocked out
          if (mode === 'thermal' || mode === 'thru_hole_only') {
            const reliefGap = zone.thermalGap ?? mmToIU(0.5);
            for (const s of shapes) holes.push(...shapeToPolygon(s, reliefGap, maxError));
            spokes.push(...thermalSpokes(pad, zone));
            continue;
          }
        }
        for (const s of shapes) holes.push(...shapeToPolygon(s, gapTo(pad.net ?? 0), maxError));
      }
      // Plated holes knock out of every layer regardless of net.
      for (const pad of fp.pads) {
        if (!pad.drill) continue;
        const r = Math.max(pad.drill.w, pad.drill.h) / 2;
        holes.push([circlePoly(pad.at, r + gapTo(pad.net ?? 0), maxError)]);
      }
    }

    // Tracks, arcs and vias on other nets.
    for (const t of board.tracks) {
      if (t.layer !== layer) continue;
      if (t.net === zone.net && zone.net > 0) {
        connected.push(t.start);
        continue;
      }
      holes.push([stadiumPoly(t.start, t.end, t.width / 2 + gapTo(t.net), maxError)]);
    }
    for (const a of board.arcs) {
      if (a.layer !== layer) continue;
      if (a.net === zone.net && zone.net > 0) {
        connected.push(a.start);
        continue;
      }
      const pts = tessellateArc(a.start, a.mid, a.end);
      for (let i = 1; i < pts.length; i++)
        holes.push([stadiumPoly(pts[i - 1]!, pts[i]!, a.width / 2 + gapTo(a.net), maxError)]);
    }
    for (const v of board.vias) {
      if (v.net === zone.net && zone.net > 0) {
        connected.push(v.at);
        continue;
      }
      holes.push([circlePoly(v.at, v.size / 2 + gapTo(v.net), maxError)]);
    }

    // Higher-priority zones on this layer knock this one out
    // (ZONE_FILLER::subtractHigherPriorityZones).
    board.zones.forEach((other, i) => {
      if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
      if (!other.layers.includes(layer)) return;
      if ((other.priority ?? 0) <= (zone.priority ?? 0)) return;
      if (other.net === zone.net) return;
      holes.push(
        ...shapeToPolygon({ kind: 'poly', pts: other.outline, r: 0 }, gapTo(other.net), maxError),
      );
    });

    let area: MultiPolygon =
      holes.length === 0
        ? (polygonClipping.union(outline) as MultiPolygon)
        : (polygonClipping.difference(outline, ...holes) as MultiPolygon);

    // Spokes are added back, then clipped to the outline so they never reach
    // outside the zone.
    if (spokes.length > 0 && area.length > 0) {
      const withSpokes = polygonClipping.union(area as Geom, ...spokes) as MultiPolygon;
      area = polygonClipping.intersection(withSpokes as Geom, outline) as MultiPolygon;
    }

    // Islands that reach nothing on the net are dropped
    // (ZONE_FILLER's island removal, ISLAND_REMOVAL_MODE::ALWAYS). The test is
    // on the outer ring; the polygon's holes travel with it.
    const kept: Polygon[] = [];
    for (const poly of area) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      const pts = ptsOf(outer);
      if (zone.net > 0 && connected.length > 0 && !connected.some((p) => pointInRing(p, pts)))
        continue;
      kept.push(poly.map(ptsOf));
    }

    // Fracture before storing, as ZONE_FILLER does through
    // SHAPE_POLY_SET::Fracture: a zone fill is written as simple closed rings,
    // each hole cut open to its outline with a zero-width slit. A reader that
    // fills every ring it finds, which KiCad is, then draws the pour correctly.
    const polys: Vec2[][] = fracture(kept);
    if (polys.length > 0) fills.push({ layer, polys });
  }

  return fills;
}

/** Ray-cast containment, for the island test. */
function pointInRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/**
 * Fill every zone on the board (ZONE_FILLER::Fill, the "Fill All Zones" action).
 * Zones set not to be filled keep whatever they have.
 */
export function fillZones(board: Board, opts: ZoneFillOptions = {}): Board {
  const zones = board.zones.map((z, i) => {
    if (z.filled === false) return z;
    const fills = fillZone(board, i, opts);
    return { ...z, fills, source: withFilledPolygons(z, fills) };
  });
  return { ...board, zones };
}

/** Rewrite a zone's `(filled_polygon …)` children from its new fills. */
function withFilledPolygons(zone: PcbZone, fills: PcbZoneFill[]): PcbZone['source'] {
  const kept = zone.source.items.filter(
    (it) => !(typeof it === 'object' && 'items' in it && headOf(it) === 'filled_polygon'),
  );
  const nodes = fills.flatMap((f) =>
    f.polys.map((poly) => ({
      kind: 'list' as const,
      items: [
        { kind: 'atom' as const, value: 'filled_polygon' },
        {
          kind: 'list' as const,
          items: [
            { kind: 'atom' as const, value: 'layer' },
            { kind: 'string' as const, value: f.layer },
          ],
        },
        {
          kind: 'list' as const,
          items: [
            { kind: 'atom' as const, value: 'pts' },
            ...poly.map((p) => ({
              kind: 'list' as const,
              items: [
                { kind: 'atom' as const, value: 'xy' },
                { kind: 'atom' as const, value: fmt(p.x) },
                { kind: 'atom' as const, value: fmt(p.y) },
              ],
            })),
          ],
        },
      ],
    })),
  );
  return { kind: 'list', items: [...kept, ...nodes] };
}

const headOf = (node: { items: unknown[] }): string | undefined => {
  const first = node.items[0] as { kind?: string; value?: string } | undefined;
  return first?.kind === 'atom' ? first.value : undefined;
};

/** Internal units -> the trimmed millimetre string the writer uses. */
function fmt(iu: number): string {
  const s = pcbIuToMM(iu).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-0' ? '0' : s;
}
