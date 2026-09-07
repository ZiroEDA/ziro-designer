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
import {
  chamfer,
  CornerStrategy,
  fillet,
  fracture,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { padShapes } from './drc/drc_engine.js';
import type { Shape } from './drc/drc_geometry.js';
import { tessellateArc } from './read-board.js';
import { barcodeGeometry, barcodeHullBoxes } from './barcode_geometry.js';
import type { Board, PadPrimitive, PcbPad, PcbZone, PcbZoneFill } from './types.js';

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
  /**
   * `BOARD_DESIGN_SETTINGS::m_ZoneLayerProperties[ aLayer ].hatching_offset` —
   * the Board Setup > Zone Hatch Offsets page, in IU, keyed by canonical layer
   * name. `ZONE_FILLER::addHatchFillTypeOnZone` reads it as the BOARD default
   * and lets a zone's own `LayerProperties()` override it per layer
   * (`zone_filler.cpp:3929-3936`).
   *
   * Optional because this module is used without a board design settings
   * object; absent means every layer's offset is (0, 0), which is
   * `value_or( VECTOR2I() )`.
   */
  hatchingOffsets?: Readonly<Record<string, { x: number; y: number }>>;
}

/**
 * The offset a hatched fill uses on one layer — the board default, overridden
 * by the zone's own if it has one for that layer:
 *
 *     VECTOR2I offset = defaultOffsets[aLayer].hatching_offset.value_or( VECTOR2I() );
 *     if( localOffsets.contains( aLayer ) && localOffsets.at( aLayer ).hatching_offset.has_value() )
 *         offset = localOffsets.at( aLayer ).hatching_offset.value();
 *
 * One function because the per-zone dialog resolves it the same way; the rule
 * is "the zone's own value wins ONLY when it has one", which is not the same as
 * merging the two maps.
 */
export function hatchingOffsetFor(
  aLayer: string,
  aBoardDefaults: Readonly<Record<string, { x: number; y: number }>> | undefined,
  aZoneLocal: Readonly<Record<string, { x: number; y: number }>> | undefined,
): { x: number; y: number } {
  return aZoneLocal?.[aLayer] ?? aBoardDefaults?.[aLayer] ?? { x: 0, y: 0 };
}

// ----- polygon helpers --------------------------------------------------------

const ringOf = (pts: Vec2[]): Ring => pts.map((p) => [p.x, p.y] as [number, number]);
const ptsOf = (ring: Ring): Vec2[] => ring.map(([x, y]) => ({ x, y }));

/** GetArcToSegmentCount: enough segments that the chord error stays under maxError. */
export function segmentsForRadius(radius: number, maxError: number): number {
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
export function shapeToPolygon(shape: Shape, gap: number, maxError: number): Geom[] {
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

  // A custom pad can declare where its spokes attach, as `gr_vector` proxy
  // primitives. When it does, those replace the four axis spokes entirely.
  const templates = (pad.primitives ?? []).filter(
    (prim) => prim.kind === 'gr_vector' && prim.start && prim.end,
  );

  if (templates.length > 0) return customThermalSpokes(pad, zone, templates, width);

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

/**
 * The custom-pad half of ZONE_FILLER::buildThermalSpokes: a pad whose primitives
 * carry `gr_vector` proxy segments says where its spokes go, instead of taking
 * the four on its own axes.
 *
 * Each template segment is placed into board coordinates, oriented so it starts
 * inside the pad (and dropped if neither end is), then widened into a spoke of
 * the bridge width and run out past the relief by the zone's minimum thickness,
 * which is what gives the connection its full width.
 *
 * Upstream additionally trims each spoke and both of its edges against the pad
 * and thermal outlines, dropping a spoke whose edges miss; that trimming needs
 * polygon/segment intersection this layer does not have, so a template that
 * points outward is used as drawn.
 */
function customThermalSpokes(
  pad: PcbPad,
  zone: PcbZone,
  templates: PadPrimitive[],
  width: number,
): Geom[] {
  const angle = ((pad.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = (p: Vec2): Vec2 => ({
    x: pad.at.x + p.x * cos - p.y * sin,
    y: pad.at.y + p.x * sin + p.y * cos,
  });

  const reach = zone.minThickness ?? 0;
  const halfW = width / 2;
  const out: Geom[] = [];

  for (const prim of templates) {
    let a = place(prim.start!);
    let b = place(prim.end!);

    // seg.A must be the end inside the pad; upstream reverses if it is not, and
    // skips the template when neither end is.
    const inside = (p: Vec2): boolean =>
      Math.hypot(p.x - pad.at.x, p.y - pad.at.y) <= Math.max(pad.size.x, pad.size.y) / 2;
    if (!inside(a)) {
      if (!inside(b)) continue;
      [a, b] = [b, a];
    }

    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;

    // Run the far end past the relief so the spoke lands in the pour.
    const tip = { x: b.x + dx * reach, y: b.y + dy * reach };
    const hx = -dy * halfW;
    const hy = dx * halfW;

    out.push([
      [
        [a.x + hx, a.y + hy],
        [tip.x + hx, tip.y + hy],
        [tip.x - hx, tip.y - hy],
        [a.x - hx, a.y - hy],
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

    // ZONE::BuildSmoothedPoly: chamfer or fillet the outline's corners before
    // anything is knocked out of it. Rule areas and teardrops are left alone
    // upstream; so is a zone with no smoothing set, which is the default.
    const smoothed = smoothOutline(zone.outline, zone, maxError);
    const outline: Geom = [ringOf(smoothed)];
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

    // Other zones on this layer knock this one out
    // (ZONE_FILLER::knockoutZoneClearance).
    board.zones.forEach((other, i) => {
      if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
      if (!other.layers.includes(layer)) return;

      // A rule area is tested first and never takes part in the priority or
      // same-net logic below: it forbids copper outright, whatever its
      // priority or net. The knockout is its bare outline — upstream passes a
      // clearance of 0 — and a teardrop is exempt, being generated copper the
      // user never placed inside the area.
      if (other.ruleArea) {
        if (other.ruleArea.copperPour && !zone.teardropType)
          holes.push(...shapeToPolygon({ kind: 'poly', pts: other.outline, r: 0 }, 0, maxError));
        return;
      }

      if ((other.priority ?? 0) <= (zone.priority ?? 0)) return;
      if (other.net === zone.net) return;
      holes.push(
        ...shapeToPolygon({ kind: 'poly', pts: other.outline, r: 0 }, gapTo(other.net), maxError),
      );
    });

    // A barcode on this layer knocks the pour out — `ZONE_FILLER::…`'s
    // `case PCB_BARCODE_T` (`zone_filler.cpp:1765-1770`):
    //
    //     barcode->GetBoundingHull( aHoles, aLayer, aGap, m_maxError, ERROR_OUTSIDE );
    //
    // `GetBoundingHull`, NOT `TransformShapeToPolygon`. Every other item hands
    // the filler its own outline; a barcode hands it two RECTANGLES, one round
    // the symbol and one round the text. So copper is kept out of the whole
    // box rather than threaded between the modules — which is the only useful
    // answer, since a pour reaching into a QR code's light squares would make
    // it unreadable.
    for (const bc of [...board.barcodes, ...board.footprints.flatMap((f) => f.barcodes)]) {
      if (bc.layer !== layer) continue;

      const g = barcodeGeometry(bc);
      for (const hull of barcodeHullBoxes(g, bc)) {
        holes.push(
          ...shapeToPolygon(
            {
              kind: 'poly',
              pts: [
                { x: hull.x1, y: hull.y1 },
                { x: hull.x2, y: hull.y1 },
                { x: hull.x2, y: hull.y2 },
                { x: hull.x1, y: hull.y2 },
              ],
              r: 0,
            },
            gapTo(0),
            maxError,
          ),
        );
      }
    }

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

    // Islands that reach nothing on the net (ZONE_FILLER's island removal).
    // ISLAND_REMOVAL_MODE decides their fate: ALWAYS drops them, NEVER keeps
    // them all, AREA keeps the ones at or above the limit. The test is on the
    // outer ring; the polygon's holes travel with it.
    const islandMode = zone.islandRemovalMode ?? 'always';
    // island_area_min is stored in mm², so the comparison happens there too.
    const iuPerMM = mmToIU(1);
    const minIslandArea = (zone.islandAreaMin ?? 10) * iuPerMM * iuPerMM;

    const kept: Polygon[] = [];
    for (const poly of area) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      const pts = ptsOf(outer);
      const island =
        zone.net > 0 && connected.length > 0 && !connected.some((p) => pointInRing(p, pts));

      if (island && islandMode === 'always') continue;
      if (island && islandMode === 'area' && Math.abs(ringArea(pts)) < minIslandArea) continue;

      kept.push(poly.map(ptsOf));
    }

    // Prune anything thinner than the zone's minimum thickness, then fracture
    // before storing, as ZONE_FILLER does.
    let pruned = postKnockoutMinWidthPrune(kept, zone, maxError);

    // A hatched zone keeps only its webbing (ZONE_FILLER::addHatchFillTypeOnZone),
    // and a thieving zone keeps only its stamps.
    if (zone.fillMode === 'hatch')
      pruned = addHatchFillTypeOnZone(
        pruned,
        zone,
        maxError,
        hatchingOffsetFor(layer, opts.hatchingOffsets, zone.layerProperties),
      );
    else if (zone.fillMode === 'thieving')
      pruned = addCopperThievingPattern(pruned, zone, maxError);
    const polys: Vec2[][] = fracture(pruned);
    if (polys.length > 0) fills.push({ layer, polys });
  }

  return fills;
}

/**
 * ZONE_FILLER::addCopperThievingPattern: replace the fill with a field of small
 * stamps, the copper added to even out plating density.
 *
 * Dots and squares are stamped on a grid of `elementSize + gap`, but only where
 * a whole stamp fits: the fill is deflated by the stamp's half-extent first, and
 * a centre outside that inset region is skipped, so no stamp is ever clipped by
 * an obstacle or the zone edge. Rows stagger by half a stride when asked.
 *
 * The crosshatch pattern is the inverse: square voids on a `lineWidth + gap`
 * grid, clipped to the fill deflated by the line width so the border survives,
 * then subtracted, leaving a connected mesh.
 *
 * Not ported: the per-layer `hatching_offset` phase, which needs board design
 * settings this layer has no access to.
 */
function addCopperThievingPattern(fill: Polygon[], zone: PcbZone, maxError: number): Polygon[] {
  const settings = zone.thieving;
  if (!settings || fill.length === 0) return fill;

  const needsElementSize = settings.pattern !== 'hatch';
  const needsLineWidth = settings.pattern === 'hatch';
  // A zero gap would spin the grid loop forever; a malformed file gets no fill.
  if (
    settings.gap <= 0 ||
    (needsElementSize && settings.elementSize <= 0) ||
    (needsLineWidth && settings.lineWidth <= 0)
  )
    return [];

  const orientation = (settings.orientation * Math.PI) / 180;
  const rot = (p: Vec2, a: number): Vec2 => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  });
  const multi = (ps: Polygon[]): MultiPolygon =>
    ps.map((poly) => poly.map((ring) => ring.map((p) => [p.x, p.y] as [number, number])));

  // The grid iterates axis-aligned in the pattern's own frame; stamps rotate back.
  const unrotated = fill.map((poly) => poly.map((ring) => ring.map((p) => rot(p, -orientation))));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const poly of unrotated) {
    for (const p of poly[0] ?? []) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return fill;

  const minThickness = zone.minThickness ?? 0;

  if (settings.pattern === 'hatch') {
    const lineStride = settings.lineWidth + settings.gap;
    const voidSize = settings.gap;
    // Deflating by the line width keeps a border, and stops a narrow fragment
    // being eaten whole by the voids.
    const interior = inflate(fill, -settings.lineWidth, CornerStrategy.CHAMFER_ALL_CORNERS);
    if (interior.length === 0) return fill;

    let xVoid = minX - (minX % lineStride) + lineStride / 2;
    let yVoid = minY - (minY % lineStride) + lineStride / 2;
    while (xVoid - voidSize / 2 > minX) xVoid -= lineStride;
    while (yVoid - voidSize / 2 > minY) yVoid -= lineStride;

    const voids: Geom[] = [];
    for (let yy = yVoid; yy <= maxY + voidSize; yy += lineStride) {
      for (let xx = xVoid; xx <= maxX + voidSize; xx += lineStride) {
        const rect = [
          { x: xx - voidSize / 2, y: yy - voidSize / 2 },
          { x: xx + voidSize / 2, y: yy - voidSize / 2 },
          { x: xx + voidSize / 2, y: yy + voidSize / 2 },
          { x: xx - voidSize / 2, y: yy + voidSize / 2 },
        ].map((p) => rot(p, orientation));
        voids.push([rect.map((p) => [p.x, p.y] as [number, number])]);
      }
    }
    if (voids.length === 0) return fill;

    const clipped = polygonClipping.intersection(
      polygonClipping.union(voids[0]!, ...voids.slice(1)) as Geom,
      multi(interior) as Geom,
    ) as MultiPolygon;
    if (clipped.length === 0) return fill;

    const out = polygonClipping.difference(multi(fill) as Geom, clipped as Geom) as MultiPolygon;
    return out.map((poly) => poly.map(ptsOf));
  }

  // Dots and squares. The radius is pre-compensated for the min-width prune's
  // re-inflate, so the finished stamp measures elementSize.
  const dotStride = settings.elementSize + settings.gap;
  const halfMinWidth = Math.floor(minThickness / 2);
  const dotRadius = Math.max(Math.floor(settings.elementSize / 2) - halfMinWidth, 1);
  const sideLen = Math.max(settings.elementSize - minThickness, 1);
  const containmentInset =
    (settings.pattern === 'squares' ? Math.floor(sideLen / 2) : dotRadius) + 1;

  // Centres where a whole stamp fits without touching the boundary.
  const region = inflate(fill, -containmentInset, CornerStrategy.CHAMFER_ALL_CORNERS);
  if (region.length === 0) return [];
  const regionUnrotated = region.map((poly) =>
    poly.map((ring) => ring.map((p) => rot(p, -orientation))),
  );

  const inRegion = (p: Vec2): boolean => {
    for (const poly of regionUnrotated) {
      const outer = poly[0];
      if (!outer || !pointInRing(p, outer)) continue;
      // Inside the outline: only counts if it is not inside one of its holes.
      if (poly.slice(1).some((hole) => pointInRing(p, hole))) continue;
      return true;
    }
    return false;
  };

  const xStart = minX - (minX % dotStride);
  const yStart = minY - (minY % dotStride);
  const stamps: Geom[] = [];
  let rowIndex = 0;

  for (let yy = yStart; yy <= maxY + dotRadius; yy += dotStride) {
    const rowOffset = settings.stagger && rowIndex % 2 === 1 ? dotStride / 2 : 0;
    for (let xx = xStart + rowOffset; xx <= maxX + dotRadius; xx += dotStride) {
      const centre = { x: xx, y: yy };
      if (!inRegion(centre)) continue;

      const ring =
        settings.pattern === 'squares'
          ? [
              { x: centre.x - sideLen / 2, y: centre.y - sideLen / 2 },
              { x: centre.x + sideLen / 2, y: centre.y - sideLen / 2 },
              { x: centre.x + sideLen / 2, y: centre.y + sideLen / 2 },
              { x: centre.x - sideLen / 2, y: centre.y + sideLen / 2 },
            ]
          : ptsOf(circlePoly(centre, dotRadius, maxError));

      stamps.push([
        ring.map((p) => rot(p, orientation)).map((p) => [p.x, p.y] as [number, number]),
      ]);
    }
    rowIndex++;
  }

  if (stamps.length === 0) return [];
  const merged = polygonClipping.union(stamps[0]!, ...stamps.slice(1)) as MultiPolygon;
  return merged.map((poly) => poly.map(ptsOf));
}

/**
 * ZONE_FILLER::addHatchFillTypeOnZone: cut a grid of holes out of a finished
 * fill so only its webbing is left.
 *
 * The grid pitch is the web thickness plus the gap; each hole is a square of
 * `gap + minThickness`, optionally chamfered (level 1) or filleted (level 2+) by
 * half the gap scaled by the smoothing value. Holes are clipped to the fill
 * deflated by the web thickness, so the zone keeps a solid border, and any hole
 * left smaller than `hatchHoleMinArea` of a full one is dropped rather than
 * leaving a speck.
 *
 * The per-layer `hatching_offset` shifts the whole grid — the Board Setup >
 * Zone Hatch Offsets page's value for this layer, or the zone's own override.
 *
 * Not ported: the board-outline deflation (pcbnew clips holes to the board edge,
 * which needs an Edge.Cuts outline this layer does not have) and the thermal
 * ring interaction, which belongs with hatched thermal reliefs.
 */
function addHatchFillTypeOnZone(
  fill: Polygon[],
  zone: PcbZone,
  maxError: number,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): Polygon[] {
  if (fill.length === 0) return fill;

  const minThickness = zone.minThickness ?? 0;
  const gap = zone.hatchGap ?? 0;
  if (gap <= 0) return fill;

  // The webbing must be at least the min thickness; the micron of margin is
  // upstream's, to keep Gerber rounding from closing the gap.
  const thickness = Math.max(zone.hatchThickness ?? 0, minThickness + mmToIU(0.001));
  const gridsize = thickness + gap;
  if (gridsize <= 0) return fill;

  const orientation = ((zone.hatchOrientation ?? 0) * Math.PI) / 180;

  // The hole is larger than the gap because the webbing has width of its own.
  const holeSize = gap + minThickness;
  let holeBase: Polygon = [
    [
      { x: 0, y: 0 },
      { x: holeSize, y: 0 },
      { x: holeSize, y: holeSize },
      { x: 0, y: holeSize },
    ],
  ];

  const level = zone.hatchSmoothingLevel ?? 0;
  if (level > 0) {
    const smoothValue = Math.round((gap * (zone.hatchSmoothingValue ?? 0)) / 2);
    // Upstream skips smoothing below 0.02 mm, and prefers a chamfer under
    // 0.04 mm even when a fillet was asked for, to save segments.
    if (smoothValue > mmToIU(0.02)) {
      holeBase =
        level === 1 || smoothValue <= mmToIU(0.04)
          ? chamfer([holeBase], smoothValue)[0]!
          : fillet([holeBase], smoothValue, level > 2 ? maxError / 2 : maxError)[0]!;
    }
  }

  const minimalHoleArea = Math.abs(ringArea(holeBase[0]!)) * (zone.hatchHoleMinArea ?? 0.3);

  // The grid is laid out in the un-rotated frame and each hole rotated back, so
  // the pattern lines up however the zone is turned.
  const rot = (p: Vec2, a: number): Vec2 => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  });
  const unrotated = fill.map((poly) => poly.map((ring) => ring.map((p) => rot(p, -orientation))));

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const poly of unrotated) {
    for (const p of poly[0] ?? []) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return fill;

  const xOffset = minX - (minX % gridsize) - gridsize;
  const yOffset = minY - (minY % gridsize) - gridsize;

  const holes: Geom[] = [];
  for (let xx = xOffset; xx <= maxX; xx += gridsize) {
    for (let yy = yOffset; yy <= maxY; yy += gridsize) {
      // `hole.Move( xx, yy )`, `hole.Rotate( orientation )`, THEN
      // `hole.Move( offset.x % gridsize, offset.y % gridsize )` — the offset is
      // applied in the ROTATED frame, after the grid placement, and modulo the
      // pitch because the pattern repeats (`zone_filler.cpp:3943-3958`).
      const moved = holeBase[0]!.map((p) => {
        const r = rot({ x: p.x + xx, y: p.y + yy }, orientation);
        return { x: r.x + (offset.x % gridsize), y: r.y + (offset.y % gridsize) };
      });
      holes.push([moved.map((p) => [p.x, p.y] as [number, number])]);
    }
  }
  if (holes.length === 0) return fill;

  // Clip the holes to the fill pulled in by the web thickness: that inset is
  // what leaves a solid border around the hatching.
  const deflatedBy = Math.max((zone.hatchThickness ?? 0) - minThickness, maxError * 2);
  const inner = inflate(fill, -deflatedBy, CornerStrategy.CHAMFER_ALL_CORNERS);
  if (inner.length === 0) return fill;

  const multi = (ps: Polygon[]): MultiPolygon =>
    ps.map((poly) => poly.map((ring) => ring.map((p) => [p.x, p.y] as [number, number])));

  const clipped = polygonClipping.intersection(
    polygonClipping.union(holes[0]!, ...holes.slice(1)) as Geom,
    multi(inner) as Geom,
  ) as MultiPolygon;

  // A hole clipped down to a speck is dropped rather than pitting the copper.
  const kept = clipped.filter(
    (poly) => Math.abs(ringArea(poly[0]!.map(([x, y]) => ({ x, y })))) >= minimalHoleArea,
  );
  if (kept.length === 0) return fill;

  const out = polygonClipping.difference(multi(fill) as Geom, kept as Geom) as MultiPolygon;
  return out.map((poly) => poly.map(ptsOf));
}

/** Twice the signed area of a ring, halved: the enclosed area. */
function ringArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return a / 2;
}

/**
 * ZONE::BuildSmoothedPoly's `smooth` lambda: the outline with its corners
 * chamfered or filleted by the zone's corner radius. SMOOTHING_NONE, a zero
 * radius, and shapes too small to smooth all fall through unchanged.
 */
function smoothOutline(outline: Vec2[], zone: PcbZone, maxError: number): Vec2[] {
  const mode = zone.cornerSmoothing ?? 'none';
  const radius = zone.cornerRadius ?? 0;
  if (mode === 'none' || radius <= 0 || outline.length < 3) return outline;

  const smoothed =
    mode === 'chamfer' ? chamfer([[outline]], radius) : fillet([[outline]], radius, maxError);

  return smoothed[0]?.[0] ?? outline;
}

/**
 * ZONE_FILLER::postKnockoutMinWidthPrune: deflate by half the minimum thickness,
 * drop what is left of anything too small to survive, then inflate back and clip
 * to where we started. Copper narrower than min thickness vanishes in the
 * deflate and never comes back, which is how upstream removes slivers and
 * hairline necks without touching the rest of the pour.
 *
 * Upstream deflates with CHAMFER_ALL_CORNERS and re-inflates with
 * ROUND_ALL_CORNERS, which is not symmetric on purpose: inflating with a miter
 * would throw spikes off acute corners.
 */
function postKnockoutMinWidthPrune(fill: Polygon[], zone: PcbZone, maxError: number): Polygon[] {
  const halfMinWidth = Math.floor((zone.minThickness ?? 0) / 2);
  const epsilon = mmToIU(0.001);
  if (halfMinWidth - epsilon <= epsilon) return fill;
  if (fill.length === 0) return fill;

  const segs = segmentsForRadius(halfMinWidth, maxError);
  const preDeflate = fill;

  let polys = inflate(fill, -(halfMinWidth - epsilon), CornerStrategy.CHAMFER_ALL_CORNERS, segs);

  // Islands whose whole extent is under the min thickness cannot hold copper.
  const minThickness = zone.minThickness ?? 0;
  polys = polys.filter((poly) => {
    const outer = poly[0];
    if (!outer || outer.length < 3) return false;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of outer) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return Math.max(maxX - minX, maxY - minY) >= minThickness;
  });

  if (polys.length === 0) return [];

  polys = inflate(polys, halfMinWidth - epsilon, CornerStrategy.ROUND_ALL_CORNERS, segs);

  // The re-inflate can push past where the fill started, so clip back to it.
  // Both sides are one multipolygon each: intersecting them flat would demand
  // every piece overlap every other.
  const multi = (ps: Polygon[]): MultiPolygon =>
    ps.map((poly) => poly.map((ring) => ring.map((p) => [p.x, p.y] as [number, number])));
  const a = multi(polys);
  const b = multi(preDeflate);
  if (a.length === 0 || b.length === 0) return [];
  const clipped = polygonClipping.intersection(a as Geom, b as Geom) as MultiPolygon;
  return clipped.map((poly) => poly.map(ptsOf));
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

    // Teardrops keep the fill their generator produced. Upstream *does* run the
    // filler over them, but under a pile of special cases — pad connection
    // forced to FULL, no keepout knockouts, same-net higher-priority zones
    // skipped — whose net effect is the outline it already has. Pouring one
    // like an ordinary zone instead opens a thermal relief in the flare and
    // eats the very copper the teardrop exists to add.
    if (z.teardropType) return z;

    // A rule area is not copper and is never poured. Without this it goes
    // through the pour like any other zone, and on a board whose island
    // removal is set to NEVER that lays filled copper inside the keepout.
    if (z.ruleArea) return z;

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
