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

import type { Geom, MultiPolygon, Ring } from 'polygon-clipping';
import { pcbIuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  booleanOp,
  BooleanOp,
  chamfer,
  CornerStrategy,
  fillet,
  fracture,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { getBoardPolygonOutlines } from './board_statistics.js';
import { defaultThermalSpokeAngle } from './padstack.js';
import { graphicShapes, padShapes } from './drc/drc_engine.js';
import { shapeDist, type Shape } from './drc/drc_geometry.js';
import { tessellateArc } from './read-board.js';
import { padShapePos } from './padstack.js';
import { textShapes } from './text_geometry.js';
import { barcodeGeometry, barcodeHullBoxes } from './barcode_geometry.js';
import type {
  Board,
  PadPrimitive,
  PcbFootprint,
  PcbPad,
  PcbVia,
  PcbZone,
  PcbZoneFill,
} from './types.js';
import type { ZoneConnection } from './zone_connection.js';

/** BOARD_DESIGN_SETTINGS::m_MaxError, the arc approximation limit (0.005 mm). */
const DEFAULT_MAX_ERROR = mmToIU(0.005);

/**
 * `ADVANCED_CFG::m_ExtraClearance` (advanced_config.cpp:244), the
 * `ExtraFillMargin` key: "A small extra clearance to be sure actual track
 * clearances are not smaller than requested clearance due to many
 * approximations in calculations, like arc to segment approx, rounding
 * issues, etc." `buildCopperItemClearances` adds it to EVERY gap it knocks
 * out — pads, holes, vias, tracks, arcs, graphics, text, the board edge,
 * other zones — and to nothing else: not a thermal relief, not a spoke, not
 * a rule area.
 *
 * Half a micron does not sound like a pour. It is the whole of what was
 * left between our fill and KiCad's on eleven of the twelve demo boards:
 * every knockout edge sat exactly 500 units inside upstream's, and the
 * slivers along thousands of them added up to the last 0.02–0.15 %.
 */
// [data] 0.0005 mm, ADVANCED_CFG's default; the user can change it in kicad_advanced.
const EXTRA_CLEARANCE = mmToIU(0.0005);

/** `DEFAULT_COPPEREDGECLEARANCE` (`include/board_design_settings.h:89`). */
// [data] 0.5 mm, "clearance between copper items and edge cuts".
const DEFAULT_EDGE_CLEARANCE = mmToIU(0.5);

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
  /**
   * `EDGE_CLEARANCE_CONSTRAINT` — Board Setup > Constraints' "Copper to edge
   * clearance", the gap the pour keeps from Edge.Cuts and Margin.
   *
   * `DEFAULT_COPPEREDGECLEARANCE` is 0.5 mm
   * (`include/board_design_settings.h:89`), which is what a board with no
   * rules resolves to and therefore the default here.
   */
  edgeClearance?: number;
  /**
   * `HOLE_CLEARANCE_CONSTRAINT` — Board Setup > Constraints' "Minimum hole
   * clearance", the gap the pour keeps from a DRILL as opposed to from the
   * copper around it. `knockoutPadClearance` maxes the hole's gap with it, and
   * for an NPTH it is the only ordinary clearance that applies at all.
   */
  holeClearance?: number;
  /**
   * `BOARD_DESIGN_SETTINGS::m_MinClearance` — Board Setup > Constraints'
   * "Minimum clearance". A pad's local clearance override is floored at it
   * ("Local overrides take precedence over everything *except* board min
   * clearance", drc_engine.cpp:1135). `clearanceOf` already folds it into
   * the ordinary answer; this is the one place the filler needs it on its own.
   */
  minClearance?: number;
}

/**
 * What `evalRulesForItems( CLEARANCE_CONSTRAINT, aZone, aItem, aLayer )` comes
 * back with, for a board carrying no custom rules.
 *
 * `DRC_ENGINE::EvalRules` (drc_engine.cpp:1902-1975) is explicit that this one
 * cannot be an implicit rule, "because they have to be max'ed with netclass
 * values": the netclass clearance is the base, a local clearance on either item
 * raises it (`if( localA > clearance )`), and the board minimum raises it
 * again. So it is the maximum of the four, and a zone whose own
 * `(connect_pads (clearance 0))` says nothing still keeps its netclass's gap —
 * which is most of what `multichannel_mixer` pours.
 */
export interface ClearanceRules {
  /** `BOARD_DESIGN_SETTINGS::m_MinClearance`, Board Setup > Constraints, IU. */
  minClearance?: number;
  /**
   * The effective netclass clearance of a net, IU — `netClassClearanceMM`
   * against the project's netclass table. Undefined for a net whose classes
   * state none.
   */
  netClassClearance?: (net: number) => number | undefined;
}

/** A `ZoneFillOptions.clearanceOf` built from a board's design rules. */
export function zoneClearanceOf(
  rules: ClearanceRules,
): (zone: PcbZone, otherNet: number) => number {
  // Resolving a net's class means matching it against every pattern in the
  // project, and the filler asks per item; a board with a few hundred nets does
  // it tens of thousands of times for a handful of distinct answers.
  const cache = new Map<number, number | undefined>();
  const netClass = (net: number): number | undefined => {
    if (!cache.has(net)) cache.set(net, rules.netClassClearance?.(net));
    return cache.get(net);
  };

  return (zone, otherNet) => {
    let clearance = 0;

    for (const net of [zone.net, otherNet]) {
      const nc = netClass(net);
      if (nc !== undefined && nc > clearance) clearance = nc;
    }

    if (zone.clearance !== undefined && zone.clearance > clearance) clearance = zone.clearance;
    if ((rules.minClearance ?? 0) > clearance) clearance = rules.minClearance ?? 0;

    return clearance;
  };
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

/**
 * The boolean ops, in the shapes this file already speaks, computed with
 * **Clipper** — the library `SHAPE_POLY_SET` itself uses.
 *
 * `polygon-clipping` is a different sweep-line implementation and it does not
 * survive a real board: on four of the twelve KiCad demos it threw "Unable to
 * find segment … in SweepLine tree" part-way through a pour, and a zone whose
 * fill throws is a zone that never fills at all. Clipper is integer-based, is
 * what upstream hands its polygons to, and answers.
 *
 * `FillRule::NonZero`, as `SHAPE_POLY_SET::booleanOp` declares. It matters
 * here and not elsewhere: the knockouts overlap each other constantly — two
 * pads of the same part, a track ending on a pad — and under even-odd an
 * overlap between two holes cancels back to copper.
 */
const clip = {
  union: (first: Geom, ...rest: Geom[]): MultiPolygon =>
    fromPolys(booleanOp(asPolys(first), rest.flatMap(asPolys), BooleanOp.ADD)),
  difference: (subject: Geom, ...clips: Geom[]): MultiPolygon =>
    fromPolys(booleanOp(asPolys(subject), clips.flatMap(asPolys), BooleanOp.SUBTRACT)),
  intersection: (subject: Geom, other: Geom): MultiPolygon =>
    fromPolys(booleanOp(asPolys(subject), asPolys(other), BooleanOp.INTERSECT)),
};

/**
 * `Geom` is a ring, a polygon (ring plus holes) or a multipolygon, told apart
 * by nesting depth — the same three shapes `polygon-clipping` accepts, so no
 * call site has to say which it is holding.
 */
function asPolys(g: Geom): Polygon[] {
  const a = g as unknown as unknown[][];
  if (a.length === 0) return [];
  const first = a[0]!;
  if (typeof first[0] === 'number') return [[ptsOf(a as unknown as Ring)]]; // a bare Ring
  if (typeof (first[0] as unknown[])[0] === 'number') return [(a as unknown as Ring[]).map(ptsOf)]; // one Polygon
  return (a as unknown as Ring[][]).map((poly) => poly.map(ptsOf)); // a MultiPolygon
}

const fromPolys = (polys: Polygon[]): MultiPolygon =>
  polys.map((poly) => poly.map(ringOf)) as MultiPolygon;

/**
 * The same ring with whole-IU corners, for anything on its way back INTO the
 * clipper. `inflate` works in floating point, so a pruned fill carries
 * fractional vertices; handing those to a second boolean is what the note on
 * `circlePoly` describes — the sweep line fails outright rather than answering
 * wrongly. KiCad never has the problem because `SHAPE_POLY_SET` is `VECTOR2I`.
 */
const intRingOf = (pts: Vec2[]): Ring =>
  dedupeRing(pts.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]));
const ptsOf = (ring: Ring): Vec2[] => ring.map(([x, y]) => ({ x, y }));

/**
 * `GetArcToSegmentCount` (geometry_utils.cpp:42): enough segments that the
 * sagitta — the gap between the middle of a chord and the arc — stays under
 * `maxError`.
 *
 * `arc_increment` is the angle one segment spans, floored at 360/8 so a tiny
 * radius still gets a recognisable circle, and the count is the arc over that,
 * ROUNDED rather than ceilinged.
 */
export function segmentsForRadius(radius: number, maxError: number, arcAngleDeg = 360): number {
  const r = Math.max(1, radius);
  const err = Math.max(1, maxError);
  const arcIncrement = Math.min(360 / 8, (180 / Math.PI) * Math.acos(1 - err / r) * 2 || 360 / 8);
  return Math.max(2, Math.round(Math.abs(arcAngleDeg) / arcIncrement));
}

/**
 * A circle as a polygon, inscribed the way TransformCircleToPolygon does.
 *
 * The vertices are ROUNDED to whole internal units. KiCad's `SHAPE_POLY_SET`
 * is `VECTOR2I` — Clipper is an integer library and every polygon reaching it
 * has integer corners — and ours had been handing `polygon-clipping` raw
 * `cos`/`sin` output. Two knockouts whose arcs very nearly touch then differ in
 * the fifteenth decimal, and its sweep line fails outright with "Unable to find
 * segment … in SweepLine tree" rather than returning a wrong answer. Rounding
 * is both the faithful thing and the robust one.
 */
function circlePoly(c: Vec2, r: number, maxError: number): Ring {
  // "Round up to 8 to make segment approximations align properly at 45-degrees".
  const n = Math.floor((segmentsForRadius(r, maxError) + 7) / 8) * 8;

  // ERROR_OUTSIDE: "The outer radius should be radius+aError" — the polygon is
  // pushed out until it is TANGENT to the true circle at each edge's middle,
  // so a clearance knockout is never smaller than the clearance asked for.
  // Inscribing it instead, as this did, leaves the copper up to one maxError
  // too close on every arc; at the scale of a zone's minimum thickness that is
  // the difference between a web that survives the prune and one that does not.
  const alpha = Math.PI / n;
  const radius = r + Math.round(Math.abs(r * (1 - 1 / Math.cos(alpha))));

  const ring: Ring = [];
  // `for( angle = delta / 2; angle < ANGLE_360; angle += delta )` — the first
  // vertex is half a step round, which is what puts an edge MIDDLE on each
  // axis rather than a vertex.
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / n;
    ring.push([Math.round(c.x + radius * Math.cos(a)), Math.round(c.y + radius * Math.sin(a))]);
  }
  return dedupeRing(ring);
}

/**
 * Drop consecutive duplicates left by the rounding above, and the wrap-around
 * pair. `SHAPE_LINE_CHAIN::Append` does the same for the same reason: a
 * zero-length edge is not geometry, and a clipper is entitled to reject one.
 */
function dedupeRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) break;
    out.pop();
  }
  return out;
}

/**
 * `TransformOvalToPolygon` with ERROR_OUTSIDE: a segment thickened by `r`.
 *
 * The caps take the same outward radius correction as `circlePoly`, but the
 * straight SIDES do not — upstream builds the whole shape at the corrected
 * radius and then clips it back to a rectangle of the exact half-width, "to
 * avoid creating useless corner at segment ends". With the vertices at
 * half-step offsets the extreme cap vertex sits at exactly ±r, so that clip
 * takes nothing off the caps and this builds the clipped shape directly.
 */
function stadiumPoly(a: Vec2, b: Vec2, r: number, maxError: number): Ring {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return circlePoly(a, r, maxError);

  const n = Math.floor((segmentsForRadius(r, maxError) + 7) / 8) * 8;
  const alpha = Math.PI / n;
  const radius = r + Math.round(Math.abs(r * (1 - 1 / Math.cos(alpha))));
  const delta = (2 * Math.PI) / n;

  // The local frame upstream works in: x along the segment, y across it.
  const ux = dx / len;
  const uy = dy / len;
  const put = (lx: number, ly: number): [number, number] => [
    Math.round(a.x + lx * ux - ly * uy),
    Math.round(a.y + lx * uy + ly * ux),
  ];

  const ring: Ring = [];
  ring.push(put(len, r)); // right arc start
  for (let angle = delta / 2; angle < Math.PI; angle += delta)
    ring.push(put(len + radius * Math.sin(angle), radius * Math.cos(angle)));
  ring.push(put(len, -r)); // finish right arc
  ring.push(put(0, -r)); // left arc start
  for (let angle = delta / 2; angle < Math.PI; angle += delta)
    ring.push(put(-radius * Math.sin(angle), -radius * Math.cos(angle)));
  ring.push(put(0, r)); // finish left arc
  return dedupeRing(ring);
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

/** An axis-aligned box, as `BOX2I`. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxOf = (pts: readonly Vec2[]): Box => {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
};

const boxInflate = (b: Box, d: number): Box => ({
  x0: b.x0 - d,
  y0: b.y0 - d,
  x1: b.x1 + d,
  y1: b.y1 + d,
});

const boxesIntersect = (a: Box, b: Box): boolean =>
  a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** The extreme points of a DRC shape, enough for a bounding box. */
function shapeCorners(s: Shape): Vec2[] {
  switch (s.kind) {
    case 'circle':
      return [
        { x: s.c.x - s.r, y: s.c.y - s.r },
        { x: s.c.x + s.r, y: s.c.y + s.r },
      ];
    case 'stadium':
      return [
        { x: Math.min(s.a.x, s.b.x) - s.r, y: Math.min(s.a.y, s.b.y) - s.r },
        { x: Math.max(s.a.x, s.b.x) + s.r, y: Math.max(s.a.y, s.b.y) + s.r },
      ];
    case 'arc':
      return [
        { x: s.c.x - s.rad - s.r, y: s.c.y - s.rad - s.r },
        { x: s.c.x + s.rad + s.r, y: s.c.y + s.rad + s.r },
      ];
    case 'poly':
      return s.pts;
  }
}

const boxAround = (a: Vec2, b: Vec2, r: number): Box => boxInflate(boxOf([a, b]), r);

const isCopper = (layer: string): boolean => /\.Cu$/.test(layer);
const padOnLayer = (pad: PcbPad, layer: string): boolean =>
  pad.layers.some((l) => l === layer || l === '*.Cu');

/**
 * `PAD::BuildEffectiveShapes`' hole — a `SHAPE_SEGMENT`, not a circle.
 *
 *     half_width = min( half_size.x, half_size.y );
 *     half_len   = ( half_size.x - half_width, half_size.y - half_width );
 *     RotatePoint( half_len, GetOrientation() );
 *     SHAPE_SEGMENT( m_pos - half_len, m_pos + half_len, half_width * 2 )
 *
 * A round drill collapses to a point of half the diameter, which is the circle
 * again; an OBLONG one is a slot. Taking the larger of the two sizes as a
 * radius, as this did, knocks out a disc where the slot is — on StickHub's
 * 4.0 x 1.5 mm mounting slot that is 7.3 mm² of copper KiCad pours.
 */
function padHoleShape(pad: PcbPad, gap: number): Shape | null {
  if (!pad.drill) return null;

  const halfW = Math.min(pad.drill.w, pad.drill.h) / 2;
  const halfLen = rotate(
    { x: pad.drill.w / 2 - halfW, y: pad.drill.h / 2 - halfW },
    pad.angle ?? 0,
  );

  // The hole stays on the pad position. `GetEffectiveHoleShape` builds its
  // segment from `m_pos`; it is the pad's COPPER that a drill `(offset …)`
  // moves, which `padShapePos` does for `padShapes`.
  const at = pad.at;

  if (halfLen.x === 0 && halfLen.y === 0) return { kind: 'circle', c: at, r: halfW + gap };

  return {
    kind: 'stadium',
    a: { x: at.x - halfLen.x, y: at.y - halfLen.y },
    b: { x: at.x + halfLen.x, y: at.y + halfLen.y },
    r: halfW + gap,
  };
}

/**
 * `DRC_ENGINE::EvalRules( THERMAL_RELIEF_GAP_CONSTRAINT, pad, zone )`
 * (drc_engine.cpp:1223-1237, 2027-2042): the pad's own `(thermal_gap …)` when
 * it states one above zero — "Local override on %s; thermal relief gap" —
 * otherwise the zone's. There is no footprint-level value for this one, and
 * a rule area's `thermal_relief_gap` constraint is not modelled.
 *
 * A pad on StickHub says `(thermal_gap 0.25)` over a zone whose gap is 0.15;
 * the relief around it is 0.1 mm wider on every side than the zone's, and
 * this read the zone's for every pad.
 */
function thermalReliefGap(pad: PcbPad, zone: PcbZone): number {
  if (pad.thermalGap !== undefined && pad.thermalGap > 0) return pad.thermalGap;
  return zone.thermalGap ?? mmToIU(0.5);
}

/**
 * `DRC_ENGINE::EvalRules( THERMAL_SPOKE_WIDTH_CONSTRAINT, pad, zone )`
 * (drc_engine.cpp:1240-1265, 2044-2059): the pad's own
 * `(thermal_bridge_width …)` when it states one above zero, RAISED to the
 * zone's minimum thickness — "%s min thickness" — otherwise the zone's.
 *
 * The override sets only `Min`, and `buildThermalSpokes` reads `Opt()` and
 * then clamps to [Min, Max], so the value that comes out is the override.
 * The same StickHub pad says `(thermal_bridge_width 0.5)` over a 0.15 mm
 * zone: its four spokes are 0.5 wide, and this drew them 0.15.
 */
function thermalSpokeWidth(pad: PcbPad, zone: PcbZone): number {
  if (pad.thermalBridgeWidth !== undefined && pad.thermalBridgeWidth > 0)
    return Math.max(pad.thermalBridgeWidth, zone.minThickness ?? 0);
  return zone.thermalBridgeWidth ?? mmToIU(0.5);
}

/**
 * `PAD::GetClearanceOverrides` — the pad's own `(clearance …)`, or its
 * footprint's when the pad states none — and what `DRC_ENGINE::EvalRules`
 * does with it for CLEARANCE_CONSTRAINT and HOLE_CLEARANCE_CONSTRAINT
 * (drc_engine.cpp:1134-1203):
 *
 *     // Local overrides take precedence over everything *except* board min
 *     // clearance
 *
 * It does NOT merely raise the answer. When a pad states one above zero, that
 * value REPLACES the netclass and the zone's own clearance, floored at the
 * board minimum (or the board minimum hole clearance, for the hole). A zone
 * has no override of its own — `BOARD_CONNECTED_ITEM::GetClearanceOverrides`
 * is empty — so the pad's is the only one in play. A stated zero falls
 * through to the ordinary answer: `if( override_val )`.
 *
 * Measured, not read: pic_programmer's solder jumper carries `(clearance
 * 0.25)` on the footprint over a 0.508 mm GND pour. Refilled by KiCad with
 * that line, the relief is 0.25 from the pad; with it deleted, 0.508; with it
 * at 0.9, 0.9. This tree maxed the two and kept 0.508 — 1 mm² of copper too
 * little around the jumper, and the same on CM5's 1.7 mm mounting holes only
 * by luck, 1.7 being the larger there.
 */
function padClearanceOverride(pad: PcbPad, fp: PcbFootprint): number | undefined {
  const override = pad.localClearance ?? fp.localClearance;
  return override !== undefined && override > 0 ? override : undefined;
}

/**
 * `ZONE_CONNECTION_CONSTRAINT` for one pad, then `DRC_ENGINE::EvalZoneConnection`'s
 * rewrite of it.
 *
 * The constraint resolves pad → footprint → zone, `inherited` meaning "ask the
 * next one out". THT_THERMAL is not a fill mode of its own: it becomes THERMAL
 * on a plated through-hole pad and FULL on everything else, which is why an SMD
 * pad in a "thermal reliefs for PTH" zone is poured solid.
 */
function padZoneConnection(
  pad: PcbPad,
  fp: PcbFootprint,
  zone: PcbZone,
): 'none' | 'thermal' | 'full' {
  const inherited = (c: ZoneConnection | undefined): ZoneConnection | undefined =>
    c === undefined || c === 'inherited' ? undefined : c;

  const resolved: ZoneConnection =
    inherited(pad.zoneConnection) ??
    inherited(fp.zoneConnection) ??
    (zone.padConnection === 'thru_hole_only' ? 'tht_thermal' : (zone.padConnection ?? 'thermal'));

  if (resolved === 'tht_thermal') return pad.type === 'thru_hole' ? 'thermal' : 'full';
  return resolved === 'inherited' ? 'thermal' : resolved;
}

// ----- thermal spokes ---------------------------------------------------------

/**
 * ZONE_FILLER::buildThermalSpokes: square-ended segments from the pad centre out
 * past the thermal relief, four of them on the pad's own axes. The width is
 * clamped to the pad's minor axis and dropped entirely below the zone's min
 * thickness, since a stub thinner than that is not copper the pour can hold.
 */
/**
 * One thermal spoke: the copper, and the point that decides whether it is kept.
 *
 * `buildThermalSpokes` gives every spoke five points, and the fifth exists for
 * one reason — "The outside end has an extra center point (which must be at
 * idx 3) which is used for testing whether or not the spoke connects to copper
 * in the parent zone" (`zone_filler.cpp:3478-3481`).
 */
interface ThermalSpoke {
  geom: Geom;
  /** The spoke's own outline, for the spoke-hits-spoke fallback. */
  ring: Vec2[];
  /** `spoke.CPoint( 3 )`: the outer end, on the centreline. */
  tip: Vec2;
}

/**
 * `EDA_ANGLE::Cos` / `::Sin`, which answer EXACTLY on a cardinal angle rather
 * than letting `cos( M_PI / 2 )` come back as 6e-17. `intersectBBox`
 * short-circuits on `dx == 0`, so the difference is the difference between an
 * axis spoke and a very slightly diagonal one.
 */
function angleCos(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return 1;
  if (d === 90 || d === 270) return 0;
  if (d === 180) return -1;
  return Math.cos((d * Math.PI) / 180);
}

function angleSin(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0 || d === 180) return 0;
  if (d === 90) return 1;
  if (d === 270) return -1;
  return Math.sin((d * Math.PI) / 180);
}

const rotate = (p: Vec2, deg: number): Vec2 => {
  const c = angleCos(deg);
  const s = angleSin(deg);
  // RotatePoint is clockwise in screen coordinates, which is what every other
  // rotation in the board model uses.
  return { x: Math.round(p.x * c + p.y * s), y: Math.round(-p.x * s + p.y * c) };
};

/**
 * `buildSpokesFromOrigin`: four spokes out of the origin, in the cardinal
 * directions offset by `deg`, each running to where its centreline leaves
 * `half`'s box.
 *
 * The five points are upstream's, and the fourth is the whole reason the chain
 * is not a plain rectangle — "The outside end has an extra center point (which
 * must be at idx 3) which is used for testing whether or not the spoke connects
 * to copper in the parent zone".
 */
function spokesFromOrigin(half: Vec2, deg: number, spokeHalfW: number): ThermalSpoke[] {
  const out: ThermalSpoke[] = [];

  for (let i = 0; i < 4; i++) {
    const a = deg + i * 90;
    const dx = angleCos(a);
    const dy = angleSin(a);

    let at: Vec2;
    let side: Vec2;

    if (dx === 0) {
      side = { x: spokeHalfW, y: 0 };
      at = { x: 0, y: Math.round(dy * half.y) };
    } else if (dy === 0) {
      side = { x: 0, y: spokeHalfW };
      at = { x: Math.round(dx * half.x), y: 0 };
    } else {
      // "We are going to intersect with one side or the other. Whichever we hit
      // first is the fraction of the spoke length we keep."
      const distX = half.x / Math.abs(dx);
      const distY = half.y / Math.abs(dy);

      if (distX < distY) {
        side = { x: 0, y: Math.round(spokeHalfW / angleSin(90 - a)) };
        at = { x: Math.round(dx * distX), y: Math.round(dy * distX) };
      } else {
        side = { x: Math.round(spokeHalfW / angleSin(a)), y: 0 };
        at = { x: Math.round(dx * distY), y: Math.round(dy * distY) };
      }
    }

    const ring: Vec2[] = [
      { x: side.x, y: side.y },
      { x: -side.x, y: -side.y },
      { x: at.x - side.x, y: at.y - side.y },
      { x: at.x, y: at.y }, // test pt, idx 3
      { x: at.x + side.x, y: at.y + side.y },
    ];
    out.push({ geom: [ringOf(ring)], ring, tip: { x: at.x, y: at.y } });
  }

  return out;
}

/** Move a spoke built at the origin onto the pad: rotate, then translate. */
function placeSpoke(spoke: ThermalSpoke, deg: number, to: Vec2): ThermalSpoke {
  const put = (p: Vec2): Vec2 => {
    const r = deg === 0 ? p : rotate(p, deg);
    return { x: r.x + to.x, y: r.y + to.y };
  };
  const ring = spoke.ring.map(put);
  return { geom: [ringOf(ring)], ring, tip: put(spoke.tip) };
}

function thermalSpokes(pad: PcbPad, zone: PcbZone, maxError: number): ThermalSpoke[] {
  const gap = thermalReliefGap(pad, zone);
  const minor = Math.min(pad.size.x, pad.size.y);
  // "ensure the spoke width is smaller than the pad minor size", then "Cannot
  // create stubs having a width < zone min thickness".
  const width = Math.min(thermalSpokeWidth(pad, zone), minor);
  if (width < (zone.minThickness ?? 0)) return [];

  // A custom pad can declare where its spokes attach, as `gr_vector` proxy
  // primitives. When it does, those replace the four axis spokes entirely.
  const templates = (pad.primitives ?? []).filter(
    (prim) => prim.kind === 'gr_vector' && prim.start && prim.end,
  );

  if (templates.length > 0) return customThermalSpokes(pad, zone, templates, width, maxError);

  // `PADSTACK::ThermalSpokeAngle`: 45° puts an X on a round pad, 90° a + on
  // everything else. Reading only the pad's ORIENTATION, as this did, gave a
  // round pad a + — the shape KiCad draws for a rectangle.
  const spokeAngle = pad.thermalSpokeAngle ?? defaultThermalSpokeAngle(pad.shape, pad.anchorShape);

  // "Add half the zone mininum width to the inflate amount to account for the
  // fact that the deflation procedure will shrink the results by half the half
  // the zone min width."
  const zoneHalfWidth =
    (zone.fillMode === 'hatch' ? (zone.hatchThickness ?? 0) : (zone.minThickness ?? 0)) / 2;
  const inflate = gap + maxError + zoneHalfWidth;

  // `dummy_pad.GetBoundingBox()` — the pad's own extent at orientation 0, with
  // no shape offset. A trapezoid's `(rect_delta …)` widens one axis as it
  // narrows the other, so the box takes the larger of the two ends.
  //
  // Not taken from a CUSTOM pad's primitives, which can reach past the anchor:
  // upstream's box would be larger there, and its spokes correspondingly
  // longer. A custom pad that says where its spokes go takes the branch above
  // instead, so this is only the ones that do not.
  const half: Vec2 = {
    x: pad.size.x / 2 + Math.abs(pad.delta?.y ?? 0) / 2 + inflate,
    y: pad.size.y / 2 + Math.abs(pad.delta?.x ?? 0) / 2 + inflate,
  };

  // "the bounding box for circles will overshoot the mark considerably when the
  // spokes are near a 45 degree increment. So we build the spokes at 0 degrees
  // and then rotate them" — a round pad's spoke is as long as an axis one,
  // pointed diagonally, not out to the box's corner.
  const circular = pad.shape === 'circle' || (pad.shape === 'oval' && pad.size.x === pad.size.y);
  const built = circular
    ? spokesFromOrigin(half, 0, Math.round(width / 2)).map((sp) =>
        placeSpoke(sp, spokeAngle, { x: 0, y: 0 }),
      )
    : spokesFromOrigin(half, spokeAngle, Math.round(width / 2));

  // "Spokes are from center of pad shape, not from hole" — a drill offset
  // moves the copper, and the spokes go with it.
  return built.map((sp) => placeSpoke(sp, pad.angle ?? 0, padShapePos(pad)));
}

/**
 * The points that stand for a pad's own copper in the island test.
 *
 * `CN_CLUSTER::IsOrphaned()` is `m_originPad == nullptr` — a fill outline is
 * isolated only when NOTHING in its cluster is a PAD — so an outline that
 * merely overlaps its own pad is connected, spoke or no spoke.
 *
 * That is not a corner case. A thermal spoke starts at the pad CENTRE, and the
 * drill knockout takes its root out, leaving a fragment that sits on the pad's
 * copper and touches nothing else. KiCad keeps those; a test that knew only the
 * spoke TIPS dropped them — four of them on kit-dev's JP101 alone.
 */
function padAnchors(pad: PcbPad): Vec2[] {
  const shapes = padShapes(pad);
  const centre = padShapePos(pad);
  const out: Vec2[] = [centre];
  const inside = (p: Vec2): boolean =>
    shapes.some((s) => shapeDist({ kind: 'circle', c: p, r: 0 }, s) <= 0);

  // A 5 x 5 lattice over the pad's own extent, the ones that land on copper.
  // A point is all this test can ask, so the pad is covered by several rather
  // than spoken for by its centre — which, on a through pad, is inside the
  // drill and on no copper at all.
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (i === 0 && j === 0) continue;
      const local = rotate({ x: (i * pad.size.x) / 5, y: (j * pad.size.y) / 5 }, pad.angle ?? 0);
      const p = { x: centre.x + local.x, y: centre.y + local.y };
      if (inside(p)) out.push(p);
    }
  }

  return out;
}

/**
 * The points that stand for a via's copper in the island test.
 *
 * The connectivity engine's `CN_ITEM` for a via is its whole annulus, and a
 * fill outline is in the via's cluster when the two OVERLAP — anywhere. A
 * centre point cannot say that: on tinytapeout a 0.65 mm GND via sits with
 * its centre 0.1 mm outside a sliver of the pour and its rim 0.3 mm inside
 * it, and upstream keeps the sliver where this dropped it.
 *
 * The centre plus a ring of points just inside the rim. Sixteen is enough
 * that a piece of copper the via's rim crosses at all — one at least the
 * zone's minimum thickness wide — meets one of them.
 */
function viaAnchors(v: PcbVia): Vec2[] {
  const out: Vec2[] = [v.at];
  const r = v.size / 2 - 1;
  if (r <= 0) return out;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    out.push({ x: v.at.x + r * Math.cos(a), y: v.at.y + r * Math.sin(a) });
  }
  return out;
}

/** Is `p` inside `poly`'s outer ring and outside every hole? */
function pointInPolygon(poly: Polygon, p: Vec2): boolean {
  const outer = poly[0];
  if (!outer || !pointInRing(p, outer)) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i]!)) return false;
  return true;
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
  maxError: number,
): ThermalSpoke[] {
  const angle = ((pad.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // "seg.A += pad->ShapePos( aLayer )".
  const centre = padShapePos(pad);
  const place = (p: Vec2): Vec2 => ({
    x: centre.x + p.x * cos - p.y * sin,
    y: centre.y + p.x * sin + p.y * cos,
  });

  const gap = thermalReliefGap(pad, zone);
  const reach = zone.minThickness ?? 0;
  const halfW = width / 2;
  const out: ThermalSpoke[] = [];

  for (const prim of templates) {
    let a = place(prim.start!);
    let b = place(prim.end!);

    // seg.A must be the end inside the pad; upstream reverses if it is not, and
    // skips the template when neither end is.
    const inside = (p: Vec2): boolean =>
      Math.hypot(p.x - centre.x, p.y - centre.y) <= Math.max(pad.size.x, pad.size.y) / 2;
    if (!inside(a)) {
      if (!inside(b)) continue;
      [a, b] = [b, a];
    }

    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;

    // `trimToOutline` runs the far end out to the THERMAL OUTLINE — the pad
    // inflated by the relief gap — because a spoke has to cross the relief to
    // reach the pour at all. This extended it by the zone's minimum thickness
    // past the template's own end instead, which on any pad whose template
    // stops at the copper edge leaves the spoke buried inside the relief hole,
    // connecting nothing. It went unnoticed because the spoke was unioned in
    // regardless; the tip test above is what surfaces it.
    const extent = (Math.abs(dx) > Math.abs(dy) ? pad.size.x : pad.size.y) / 2;
    const need = extent + gap + maxError;
    const have = Math.hypot(b.x - centre.x, b.y - centre.y);
    const grow = Math.max(reach, need - have);
    const tip = { x: b.x + dx * grow, y: b.y + dy * grow };
    const hx = -dy * halfW;
    const hy = dx * halfW;
    const ring: Vec2[] = [
      { x: a.x + hx, y: a.y + hy },
      { x: tip.x + hx, y: tip.y + hy },
      { x: tip.x - hx, y: tip.y - hy },
      { x: a.x - hx, y: a.y - hy },
    ];

    out.push({ geom: [ringOf(ring)], ring, tip });
  }

  return out;
}

// ----- the filler -------------------------------------------------------------

/** The fill polygons one zone would take, per layer (ZONE_FILLER::fillSingleZone). */
/**
 * Points along a same-net segment's centreline, as connectivity anchors.
 *
 * One point per item is not enough: a track's ends usually sit inside the
 * relief holes of the pads it lands on, so its START anchors whichever region
 * that hole happens to be in — or none.
 */
function alongSegment(a: Vec2, b: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 4; i++)
    out.push({ x: a.x + ((b.x - a.x) * i) / 4, y: a.y + ((b.y - a.y) * i) / 4 });
  return out;
}

/**
 * `ZONE::HigherPriority` (zone.cpp:453).
 *
 * Three tests, in order: a teardrop outranks anything that is not one, then the
 * priority number, and then — the part that is easy to miss — the UUID. Two
 * ordinary zones of equal priority on different nets are NOT peers: one of them
 * wins and knocks the other out. Treating equal priority as "no knockout either
 * way", as this did, leaves both pours filling the overlap, which is a short.
 */
function higherPriority(a: PcbZone, b: PcbZone): boolean {
  const aTeardrop = a.teardropType !== undefined;
  const bTeardrop = b.teardropType !== undefined;
  if (aTeardrop !== bTeardrop) return aTeardrop;

  const ap = a.priority ?? 0;
  const bp = b.priority ?? 0;
  if (ap !== bp) return ap > bp;

  // `m_Uuid > aOther->m_Uuid` — KIID compares the bytes, and the canonical
  // lowercase hex form compares the same way as a string.
  return (a.uuid ?? '') > (b.uuid ?? '');
}

/**
 * `ZONE_FILLER::subtractHigherPriorityZones` (zone_filler.cpp:2676).
 *
 * Every zone on this layer that shares this zone's net code and carries a
 * STRICTLY greater assigned priority takes its own outline away from this
 * fill. Three details that a reading of the different-net knockout would get
 * wrong:
 *
 *  - `HigherPriority()` is deliberately NOT used — "we only want explicitly-
 *    higher priorities, not equal-priority zones", so the teardrop and UUID
 *    tie-breaks play no part and two same-net zones of equal priority both
 *    keep the overlap.
 *  - the knockout is the zone's raw outline (`appendZoneOutlineWithoutArcs`),
 *    not its smoothed outline and not its filled copper, and no clearance is
 *    added to it.
 *  - a teardrop area never knocks anything out here.
 *
 * `SameNet` is bare net-code equality, so two no-net zones qualify as well.
 */
function subtractHigherPriorityZones(
  fill: Polygon[],
  board: Board,
  zoneIndex: number,
  layer: string,
  near: (box: Box) => boolean,
): Polygon[] {
  if (fill.length === 0) return fill;

  const zone = board.zones[zoneIndex]!;
  const knockouts: Ring[][] = [];

  board.zones.forEach((other, i) => {
    if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
    if (other.net !== zone.net) return;
    if ((other.priority ?? 0) <= (zone.priority ?? 0)) return;
    if (other.teardropType !== undefined) return;
    if (!other.layers.includes(layer)) return;
    // "if( aKnockout->GetBoundingBox().Intersects( zoneBBox ) )".
    if (!near(boxOf(other.outline))) return;
    knockouts.push([intRingOf(other.outline)]);
  });

  if (knockouts.length === 0) return fill;

  const kept = clip.difference(
    fill.map((poly) => poly.map(intRingOf)).filter((poly) => poly[0]!.length >= 3) as Geom,
    knockouts as unknown as Geom,
  ) as MultiPolygon;
  return kept.map((poly) => poly.map(ptsOf));
}

/**
 * One zone's copper, per layer, BEFORE the island pass — with the anchors that
 * pass will need.
 *
 * `ZONE_FILLER::Fill` pours every zone and only then calls
 * `FillIsolatedIslandsMap`, so what decides an island is the finished board,
 * not the board as it stood when this zone's turn came. Splitting the two is
 * what lets `fillZones` ask the question in upstream's order.
 */
interface ZoneFillParts {
  layer: string;
  polys: Vec2[][];
  /** Points where same-net copper reaches this layer's pour. */
  connected: Vec2[];
}

function fillZoneParts(
  board: Board,
  zoneIndex: number,
  opts: ZoneFillOptions = {},
): ZoneFillParts[] {
  const zone = board.zones[zoneIndex];
  if (!zone?.outline || zone.outline.length < 3) return [];

  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const clearanceOf = opts.clearanceOf ?? ((z: PcbZone) => z.clearance ?? mmToIU(0.5));
  const fills: ZoneFillParts[] = [];

  // `ZONE_FILLER::Fill`'s `m_brdOutlinesValid = GetBoardPolygonOutlines( … )`,
  // handed to `BuildSmoothedPoly` as `aBoardOutline` and used there for one
  // line: `aSmoothedPoly.BooleanIntersection( boardOutline )` (zone.cpp:1594).
  //
  // This is the OTHER half of keeping the pour on the board, and knocking the
  // Edge.Cuts graphics out at the edge clearance is not a substitute for it.
  // A knockout only removes a band along each edge line; a zone outline drawn
  // past the board keeps every square millimetre beyond that band. On a real
  // board that was 28% more copper than KiCad pours — most of it outside the
  // board entirely.
  //
  // `success` false means the outline did not close, and upstream then passes
  // a null pointer and skips the intersection rather than clipping to a
  // half-built polygon.
  const brd = getBoardPolygonOutlines(board);
  const boardOutline: Geom | null =
    brd.success && brd.polygons.length > 0
      ? brd.polygons.map((poly) => [ringOf(poly.outline), ...poly.holes.map(ringOf)])
      : null;

  for (const layer of zone.layers) {
    if (!isCopper(layer)) continue;

    // ZONE::BuildSmoothedPoly: the outline, clipped to the board and with its
    // corners chamfered or filleted, before anything is knocked out of it.
    const outline: Geom = buildSmoothedPoly(board, zoneIndex, layer, boardOutline, maxError);
    if ((outline as MultiPolygon).length === 0) continue;
    const holes: Geom[] = [];
    const spokes: ThermalSpoke[] = [];
    // `knockoutThermalReliefs` keeps its reliefs in a set of its OWN and
    // subtracts them there and then. They are not part of `clearanceHoles`, so
    // they are never subtracted again — which is what lets a spoke, added
    // after them, cross the relief it is there to bridge.
    const reliefHoles: Geom[] = [];
    // Subtracted last of all, after the spokes and the prune (zone_filler.cpp:3130).
    const thermalHoles: Geom[] = [];
    const connected: Vec2[] = []; // same-net anchors, for island removal

    const gapTo = (net: number): number => clearanceOf(zone, net);

    // `BOX2I zone_boundingbox = aZone->GetBoundingBox(); zone_boundingbox.Inflate(
    // m_worstClearance + extra_margin )`, and every knockout below is guarded by
    // `…->GetBoundingBox().Intersects( zone_boundingbox )`. Without the guard a
    // small pour still polygonises every pad and every track on the board:
    // `m_worstClearance` is `BOARD::GetMaxClearanceValue`, the largest gap any
    // rule can ask for, so nothing that could reach the zone is skipped.
    let worstClearance = 0;
    for (const net of board.nets.keys()) worstClearance = Math.max(worstClearance, gapTo(net));
    worstClearance = Math.max(
      worstClearance,
      zone.thermalGap ?? 0,
      opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE,
    );
    // `GetMaxClearanceValue` walks the items too, and a local override on one
    // pad can be larger than any netclass on the board.
    for (const fp of board.footprints) {
      if (fp.localClearance !== undefined)
        worstClearance = Math.max(worstClearance, fp.localClearance);
      for (const pad of fp.pads) {
        if (pad.localClearance !== undefined)
          worstClearance = Math.max(worstClearance, pad.localClearance);
        if (pad.thermalGap !== undefined) worstClearance = Math.max(worstClearance, pad.thermalGap);
      }
    }
    // `GetMaxClearanceValue` walks the zones too: another zone's own
    // `(clearance …)` is a gap this pour has to keep.
    for (const z of board.zones)
      if (!z.ruleArea && z.clearance !== undefined)
        worstClearance = Math.max(worstClearance, z.clearance);
    const zoneBox = boxInflate(boxOf(zone.outline), worstClearance + EXTRA_CLEARANCE);
    const near = (b: Box): boolean => boxesIntersect(b, zoneBox);

    // Pads (`ZONE_FILLER::knockoutThermalReliefs` and, for the ones it hands on,
    // `knockoutPadClearance`).
    for (const fp of board.footprints) {
      for (const pad of fp.pads) {
        // "NPTH pads with a drill hole affect all copper layers even when they
        // carry no copper on that layer": everything else off this layer is
        // skipped outright, hole and all.
        const npthWithHole = pad.type === 'np_thru_hole' && pad.drill !== undefined;
        if (!padOnLayer(pad, layer) && !npthWithHole) continue;

        // "padBBox.Inflate( m_worstClearance ); if( !padBBox.Intersects(
        // aZone->GetBoundingBox() ) ) continue".
        const reach = Math.max(
          pad.size.x,
          pad.size.y,
          pad.drill ? Math.max(pad.drill.w, pad.drill.h) : 0,
        );
        // The copper sits at `ShapePos` and the hole at `pad.at`; the guard has
        // to cover both, so it spans the two.
        const shapeAt = padShapePos(pad);
        if (!near(boxAround(pad.at, shapeAt, reach))) continue;

        const shapes = padShapes(pad);
        const holeRadius = pad.drill ? Math.max(pad.drill.w, pad.drill.h) / 2 : 0;

        // `noConnection`: a different net, or any pad at all on a zone with no
        // net of its own.
        const sameNet = (pad.net ?? 0) === zone.net && zone.net > 0;
        const mode = sameNet ? padZoneConnection(pad, fp, zone) : 'none';

        if (mode === 'full') {
          // A solid connection knocks out nothing — not the pad, and not its
          // hole either — so the pour runs straight over the pad's copper.
          connected.push(...padAnchors(pad));
          continue;
        }

        if (mode === 'thermal') {
          // A thermally-relieved pad's own copper sits INSIDE the relief hole;
          // what touches the pour is its spokes, so its anchors are added with
          // them below.
          const reliefGap = thermalReliefGap(pad, zone);
          for (const s of shapes) reliefHoles.push(...shapeToPolygon(s, reliefGap, maxError));
          spokes.push(...thermalSpokes(pad, zone, maxError));
          // The pad is in the cluster whether or not a spoke survives, so any
          // copper left standing on it is connected copper.
          connected.push(...padAnchors(pad));

          // "Ensure additive changes (thermal stubs …) do not add copper …
          // inside the clearance holes": the drill of every thermally
          // connected pad is knocked out at gap ZERO, and only at the END —
          // after the spokes have been added and the min-width prune has run.
          // The spokes all start at the pad centre, so without this the four
          // of them fill the middle of the pad's own hole.
          const drill = padHoleShape(pad, 0);
          if (drill) thermalHoles.push(...shapeToPolygon(drill, 0, maxError));
          continue;
        }

        // NONE, and every different-net pad. `knockoutPadClearance` treats the
        // copper and the hole as two separate knockouts with two different
        // gaps.
        //
        // "if( flashLayer && gap >= 0 ) addKnockout( … )" — the COPPER only
        // goes when the pad HAS copper on this layer, and an NPTH whose drill
        // fills its pad has none ("NPTH do not need copper clearance gaps to
        // their holes"). Knocking its shape out as well takes away copper
        // KiCad pours.
        const override = padClearanceOverride(pad, fp);
        const npth = pad.type === 'np_thru_hole';

        // `CLEARANCE_CONSTRAINT( aZone, aPad )`: the override, floored at the
        // board minimum, or else the ordinary net-based answer.
        const copperGap =
          override !== undefined ? Math.max(override, opts.minClearance ?? 0) : gapTo(pad.net ?? 0);
        // `HOLE_CLEARANCE_CONSTRAINT( aZone, aPad )`: the same override,
        // floored at the board's hole clearance instead.
        const holeClearance =
          override !== undefined
            ? Math.max(override, opts.holeClearance ?? 0)
            : (opts.holeClearance ?? 0);

        if (padOnLayer(pad, layer) && !npth) {
          for (const s of shapes)
            holes.push(...shapeToPolygon(s, copperGap + EXTRA_CLEARANCE, maxError));
        }

        // The hole's own gap: the board's hole clearance, and — "oblong NPTH
        // holes are milled rather than drilled, so they need edge clearance in
        // addition to hole clearance" — the edge clearance for a slot. A plated
        // hole also takes the ordinary clearance; an NPTH does not.
        let holeGap = holeClearance;
        if (!npth) holeGap = Math.max(holeGap, copperGap);
        if (npth && pad.drill && pad.drill.w !== pad.drill.h)
          holeGap = Math.max(holeGap, opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE);

        const hole = padHoleShape(pad, holeGap + EXTRA_CLEARANCE);
        if (hole) holes.push(...shapeToPolygon(hole, 0, maxError));
      }
    }

    // Tracks, arcs and vias on other nets.
    for (const t of board.tracks) {
      if (t.layer !== layer) continue;
      if (!near(boxAround(t.start, t.end, t.width))) continue;
      if (t.net === zone.net && zone.net > 0) {
        connected.push(...alongSegment(t.start, t.end));
        continue;
      }
      holes.push([
        stadiumPoly(t.start, t.end, t.width / 2 + gapTo(t.net) + EXTRA_CLEARANCE, maxError),
      ]);
    }
    for (const a of board.arcs) {
      if (a.layer !== layer) continue;
      if (!near(boxInflate(boxOf([a.start, a.mid, a.end]), a.width))) continue;
      if (a.net === zone.net && zone.net > 0) {
        const pts = tessellateArc(a.start, a.mid, a.end);
        for (let i = 1; i < pts.length; i++) connected.push(...alongSegment(pts[i - 1]!, pts[i]!));
        continue;
      }
      const pts = tessellateArc(a.start, a.mid, a.end);
      for (let i = 1; i < pts.length; i++)
        holes.push([
          stadiumPoly(pts[i - 1]!, pts[i]!, a.width / 2 + gapTo(a.net) + EXTRA_CLEARANCE, maxError),
        ]);
    }
    for (const v of board.vias) {
      // "viaBBox.Inflate( m_worstClearance )".
      if (!near(boxAround(v.at, v.at, v.size))) continue;
      if (v.net === zone.net && zone.net > 0) {
        connected.push(...viaAnchors(v));
        continue;
      }
      holes.push([circlePoly(v.at, v.size / 2 + gapTo(v.net) + EXTRA_CLEARANCE, maxError)]);
    }

    // Other zones on this layer knock this one out
    // (ZONE_FILLER::knockoutZoneClearance).
    board.zones.forEach((other, i) => {
      if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
      if (!other.layers.includes(layer)) return;
      // "if( aKnockout->GetBoundingBox().Intersects( zone_boundingbox ) )".
      if (!near(boxOf(other.outline))) return;

      // A rule area is tested first and never takes part in the priority or
      // same-net logic below: it forbids copper outright, whatever its
      // priority or net. The knockout is its SMOOTHED outline — upstream calls
      // `TransformSmoothedOutlineToPolygon` with a clearance of 0 — and a
      // teardrop is exempt, being generated copper the user never placed
      // inside the area.
      if (other.ruleArea) {
        if (other.ruleArea.copperPour && !zone.teardropType) {
          // "We like keepouts just the way they are" — `BuildSmoothedPoly`
          // hands a rule area's outline back untouched, whatever smoothing it
          // states.
          holes.push(...shapeToPolygon({ kind: 'poly', pts: other.outline, r: 0 }, 0, maxError));
        }
        return;
      }

      if (!higherPriority(other, zone) || other.net === zone.net) return;

      // `ZONE::TransformShapeToPolygon` takes the other zone's FILLED areas,
      // not its outline — "if( !m_FilledPolysList.count( aLayer ) ) return", so
      // a zone with nothing poured on this layer knocks nothing out. Using the
      // outline instead removes copper from everywhere the other zone COULD
      // have reached, which on a board of overlapping pours is most of it.
      //
      // ERROR_OUTSIDE adds one maxError to the clearance before inflating.
      const otherFill = other.fills.find((f) => f.layer === layer);
      if (!otherFill || otherFill.polys.length === 0) return;

      // `EvalRules( CLEARANCE_CONSTRAINT, aZone, otherZone )`: "Local
      // clearance on %s" is asked of BOTH items, and the larger wins — so the
      // other zone's own `(clearance …)` raises this gap as much as ours does
      // (drc_engine.cpp:1908-1953; `ZONE::GetLocalClearance` is
      // `m_ZoneClearance`). This asked only ours: on One-Air-Max the 0.1 mm
      // BAT- pour ran to within 0.1 mm of a PGND pour that says 0.5, which
      // is 3.3 mm² of copper KiCad keeps clear.
      const gap = Math.max(gapTo(other.net), other.clearance ?? 0);
      if (gap < 0) return; // "Negative clearance permits zones to short"

      const inflated = inflate(
        otherFill.polys.map((poly) => [poly]),
        gap + EXTRA_CLEARANCE + maxError,
        CornerStrategy.ROUND_ALL_CORNERS,
        segmentsForRadius(gap + EXTRA_CLEARANCE + maxError, maxError),
      );
      for (const poly of inflated) holes.push(poly.map(ringOf) as Geom);
    });

    // Board graphics, and the BOARD EDGE (`zone_filler.cpp:2400-2440`).
    //
    // "A item on the Edge_Cuts or Margin is always seen as on any layer", so
    // the board outline knocks copper out of every zone on every layer — and
    // it is the one item measured against `EDGE_CLEARANCE_CONSTRAINT` rather
    // than the ordinary clearance. That gap is the inset a filled board has
    // all the way round its edge, and this filler had no board-graphics
    // knockout at all: the pour ran to the outline the user drew, straight
    // over the edge and over every copper graphic on its own layer.
    //
    // `ignoreLineWidths = true` for Edge.Cuts and only for Edge.Cuts: the
    // outline graphic's stroke is a drawing convention, and the board edge is
    // its CENTRELINE. Margin keeps its width.
    for (const s of [...board.shapes, ...board.footprints.flatMap((f) => f.shapes ?? [])]) {
      const onLayer = s.layer === layer;
      const isEdge = s.layer === 'Edge.Cuts';
      const isMargin = s.layer === 'Margin';
      if (!onLayer && !isEdge && !isMargin) continue;

      // "if( !aZone->IsTeardropArea() && aZone->GetNetCode() == 0 ) sameNet =
      // false" — a zone with no net is never the same net as anything.
      const sameNet = (s.net ?? 0) === zone.net && zone.net > 0;

      // The CLEARANCE_CONSTRAINT upgrade applies only to a different-net item
      // on this layer; everything else falls back to the physical clearance,
      // which is 0 on a board with no rules.
      const gap =
        isEdge || isMargin
          ? (opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE)
          : sameNet
            ? 0
            : gapTo(s.net ?? 0);

      for (const sh of graphicShapes(isEdge ? { ...s, width: 0 } : s))
        holes.push(...shapeToPolygon(sh, gap + EXTRA_CLEARANCE, maxError));
    }

    // Copper TEXT, which `knockoutGraphicClearance` treats exactly like a
    // graphic — `addKnockout` has a `PCB_TEXT_T` case
    // (zone_filler.cpp:1735-1760). Without it the pour ran straight through the
    // lettering on a copper layer: on complex_hierarchy a two-line B.Cu label
    // is 140 mm² of copper we filled and KiCad does not, which is not a
    // cosmetic difference but a short.
    for (const t of [...board.texts, ...board.footprints.flatMap((f) => f.texts)]) {
      const onLayer = t.layer === layer;
      const isEdge = t.layer === 'Edge.Cuts';
      const isMargin = t.layer === 'Margin';
      if (!onLayer && !isEdge && !isMargin) continue;

      const shapes = textShapes(t);
      if (shapes.length === 0) continue;
      if (!near(boxOf(shapes.flatMap(shapeCorners)))) continue;

      // Text carries no net, so it is never the same net as the pour: `shapeNet`
      // is -1 for anything that is not a PCB_SHAPE.
      const gap = isEdge || isMargin ? (opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE) : gapTo(0);

      for (const sh of shapes) holes.push(...shapeToPolygon(sh, gap + EXTRA_CLEARANCE, maxError));
    }

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
            gapTo(0) + EXTRA_CLEARANCE,
            maxError,
          ),
        );
      }
    }

    // `buildCopperItemClearances` ends with `aHoles.Simplify()`: the knockouts
    // become ONE poly set, which is then subtracted three times over — before
    // the spokes, after them, and again after the re-inflate. Keeping them as a
    // list and re-feeding it to the clipper at each of those is the same answer
    // at several times the cost.
    const holeSet: MultiPolygon =
      holes.length === 0 ? [] : (clip.union(holes[0]!, ...holes.slice(1)) as MultiPolygon);

    let area: MultiPolygon =
      holeSet.length === 0 && reliefHoles.length === 0
        ? (clip.union(outline) as MultiPolygon)
        : (clip.difference(
            outline,
            ...(holeSet.length > 0 ? [holeSet as Geom] : []),
            ...reliefHoles,
          ) as MultiPolygon);

    // Spokes are added back — but only the ones that reach real copper.
    //
    // `zone_filler.cpp:2936-3016`. KiCad builds a throwaway `testAreas` — the
    // pour with EVERY clearance hole already subtracted, then run through the
    // same min-width deflate/inflate the finished fill gets — and keeps a
    // spoke only if its outer end lands inside that. A spoke pointing at a
    // neighbouring pad's clearance hole has its tip in the hole, not on
    // copper, and is dropped.
    //
    // That is the whole reason a KiCad pad beside another pad gets THREE
    // spokes and not four. Adding all four unconditionally, as this did,
    // drives a bridge of copper straight across the neighbour's clearance —
    // which is not a cosmetic difference, it is a short.
    //
    // The second arm is upstream's own fallback: a spoke whose tip is inside
    // ANOTHER spoke is kept too, tested both ways round "to avoid interactions
    // with round-off errors" (kicad#13316). That is how two pads facing each
    // other across a gap too narrow for the pour still connect.
    if (spokes.length > 0 && area.length > 0) {
      const testAreas = spokeTestAreas(
        area.map((poly) => poly.map(ptsOf)),
        zone,
        maxError,
      );
      const onCopper = (p: Vec2): boolean => testAreas.some((poly) => pointInPolygon(poly, p));
      const insideSpoke = (spoke: ThermalSpoke, p: Vec2): boolean => pointInRing(p, spoke.ring);

      const kept = spokes.filter(
        (spoke) =>
          onCopper(spoke.tip) ||
          spokes.some(
            (other) =>
              other !== spoke && insideSpoke(other, spoke.tip) && insideSpoke(spoke, other.tip),
          ),
      );

      if (kept.length > 0) {
        // A kept spoke's tip is by construction ON the copper it bridges to,
        // which makes it the anchor for the pad it belongs to. A dropped one
        // is not — and a pad whose spokes were all dropped connects to
        // nothing, so it anchors nothing.
        for (const k of kept) connected.push(k.tip);

        // "the 'real' subtract-clearance-holes has to be done after the spokes
        // are added" (zone_filler.cpp:3020). A spoke runs from the pad centre
        // out past the relief, straight through whatever sits in between; the
        // holes are what stop it short of a neighbour's clearance.
        //
        // Every spoke goes in, then the holes come out ONCE. Trimming each
        // spoke on its own is the same copper, but it re-feeds the whole hole
        // set to the clipper per spoke — on a ground plane with hundreds of
        // relieved pads that never finishes.
        const withSpokes = clip.union(area as Geom, ...kept.map((k) => k.geom)) as MultiPolygon;
        const trimmedFill =
          holeSet.length > 0
            ? (clip.difference(withSpokes as Geom, holeSet as Geom) as MultiPolygon)
            : withSpokes;
        area = clip.intersection(trimmedFill as Geom, outline) as MultiPolygon;
      }
    }

    // Prune anything thinner than the zone's minimum thickness, then fracture,
    // as `fillCopperZone` does — and only THEN look for islands.
    //
    // The order is the whole point. `ZONE_FILLER::Fill` calls
    // `FillIsolatedIslandsMap` after every `fillCopperZone` has returned, so
    // what it sees is the finished, fractured poly set: each outline is one
    // disjoint piece of copper, holes already cut by slits. Asking earlier
    // reads a different board. On ecc83-pp four regions hang off the pour by
    // necks thinner than its 0.381 mm minimum; the deflate/inflate severs them,
    // and 212 mm² of copper KiCad drops as islands survived here because at the
    // time we asked they were still attached.
    // Three points, not four: polygon-clipping hands back OPEN rings, so a
    // triangle is three of them and a `>= 4` guard threw it away. That is not a
    // degenerate case — a straight zone corner cut off by one straight
    // clearance edge IS a triangle, and on One-Air-Max a diagonal track slices
    // 5.9 mm² of the PGND pour into exactly that shape, which upstream fills
    // and this dropped before the prune ever saw it.
    let pruned = postKnockoutMinWidthPrune(
      area.map((poly) => poly.map(ptsOf)).filter((poly) => (poly[0]?.length ?? 0) >= 3),
      zone,
      maxError,
    );

    // `BooleanIntersection( aMaxExtents )` then `BooleanSubtract( clearanceHoles )`
    // once more (zone_filler.cpp:3136-3139): re-inflating pushes copper back
    // out over the edges the prune had cleared, and the thermal pads' own
    // drills join the holes only here.
    if (pruned.length > 0 && (thermalHoles.length > 0 || holeSet.length > 0)) {
      const trimmed = clip.difference(
        clip.intersection(
          pruned.map((poly) => poly.map(intRingOf)).filter((poly) => poly[0]!.length >= 3) as Geom,
          outline,
        ) as Geom,
        ...(holeSet.length > 0 ? [holeSet as Geom] : []),
        ...thermalHoles,
      ) as MultiPolygon;
      pruned = trimmed.map((poly) => poly.map(ptsOf));
    }

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

    // "Lastly give any same-net but higher-priority zones control over their
    // own area" — `ZONE_FILLER::subtractHigherPriorityZones`, the last thing
    // `fillCopperZone` does before it fractures.
    //
    // This is NOT the different-net knockout above. That one keeps a clearance
    // gap and uses the other zone's filled copper; this one takes the other
    // zone's raw OUTLINE, with no gap at all, because the two pours are the
    // same net and may touch — what is being decided is only which zone's fill
    // parameters (thermal relief, minimum thickness, hatching) govern the
    // overlap. Without it a lower-priority pour fills its whole outline and the
    // overlap ends up poured twice, under the wrong rules: on One-Air-Max the
    // +3V3 zone of priority 9 ran 146 mm² past where KiCad stops it, which is
    // the entire span it shares with the priority-24 zone beside it.
    pruned = subtractHigherPriorityZones(pruned, board, zoneIndex, layer, near);

    fills.push({ layer, polys: fracture(pruned), connected });
  }

  return fills;
}

/**
 * One zone's finished copper.
 *
 * The island pass here sees only the fills the other zones are already
 * carrying — the file's, when nothing has re-poured them. `fillZones` is the
 * one that asks it the way `ZONE_FILLER::Fill` does, with every zone poured.
 */
export function fillZone(
  board: Board,
  zoneIndex: number,
  opts: ZoneFillOptions = {},
): PcbZoneFill[] {
  const zone = board.zones[zoneIndex];
  if (!zone) return [];
  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;

  return fillZoneParts(board, zoneIndex, opts)
    .map((part) => ({
      layer: part.layer,
      polys: removeIslands(
        part.polys,
        zone,
        part.connected,
        sameNetZoneTouch(board, zoneIndex, part.layer, maxError),
      ),
    }))
    .filter((f) => f.polys.length > 0);
}

/**
 * Does this outline touch another zone's copper of the same net?
 *
 * `CN_CLUSTER::IsOrphaned()` asks whether anything in a fill outline's cluster
 * is a pad, and a cluster is built by the connectivity engine over ALL copper:
 * two same-net zone fills that meet on a layer are one piece of copper, so a
 * pad on either of them speaks for both. Nothing in the point model can see
 * that — the two pours touch along a shared edge and neither has an item of
 * its own inside the other.
 *
 * It is exactly the case a priority knockout creates. On One-Air-Max the PGND
 * pour of priority 15 is cut along the priority-4 pour's outline, and the
 * 5.9 mm² corner left over reaches nothing of its own; upstream keeps it,
 * because it is welded to the other pour along that cut. The same reading, run
 * the other way, is what finally drops the 9.1 mm² strip of the +3V3 pour on
 * In1.Cu: the rest of that zone turns out to be connected through its
 * neighbour, so the layer is no longer "unconnected pour, preserve as-is".
 *
 * The touch is tested with a `maxError` of slack because upstream's `Collide`
 * counts a shared edge as a collision, and a boolean over two polygons that
 * share an edge exactly answers with zero area.
 */
function sameNetZoneTouch(
  board: Board,
  zoneIndex: number,
  layer: string,
  maxError: number,
): (ring: Vec2[]) => boolean {
  const zone = board.zones[zoneIndex]!;
  if (zone.net <= 0) return () => false;

  const neighbours: Vec2[][] = [];
  board.zones.forEach((other, i) => {
    if (i === zoneIndex || other.ruleArea || other.net !== zone.net) return;
    const fill = other.fills.find((f) => f.layer === layer);
    if (!fill) return;
    for (const poly of fill.polys) if (poly.length >= 3) neighbours.push(poly);
  });
  if (neighbours.length === 0) return () => false;

  const boxes = neighbours.map(boxOf);
  const geom = neighbours.map((poly) => [intRingOf(poly)]) as unknown as Geom;

  return (ring: Vec2[]): boolean => {
    const box = boxOf(ring);
    const grownBox = boxInflate(box, maxError);
    if (!boxes.some((b) => boxesIntersect(b, grownBox))) return false;
    const grown = inflate([[ring]], maxError, maxError);
    if (grown.length === 0) return false;
    return (clip.intersection(fromPolys(grown), geom) as MultiPolygon).length > 0;
  };
}

/**
 * The island pass of `ZONE_FILLER::Fill` — `FillIsolatedIslandsMap` followed by
 * the `ISLAND_REMOVAL_MODE` switch (zone_filler.cpp:955-1041).
 *
 * It runs on the **fractured** fill, so every entry is one disjoint piece of
 * copper and a hole is already a slit rather than a nested ring. An outline is
 * isolated when no same-net copper touches it; `connected` carries the points
 * that copper actually reaches the pour at — kept spoke tips, the centre of a
 * solidly-connected pad, a via, samples along each same-net track and arc.
 *
 * ALWAYS drops every isolated outline, AREA drops the ones under
 * `island_area_min` (`outline.Area( true ) < minArea`), NEVER keeps them all
 * and is the only mode a zone with no net can have.
 */
function removeIslands(
  polys: Vec2[][],
  zone: PcbZone,
  connected: Vec2[],
  touchesSameNetZone: (ring: Vec2[]) => boolean = () => false,
): Vec2[][] {
  const mode = zone.islandRemovalMode ?? 'always';
  if (mode === 'never' || zone.net <= 0 || polys.length === 0) return polys;

  // island_area_min is stored in mm², so the comparison happens there too.
  const iuPerMM = mmToIU(1);
  const minIslandArea = (zone.islandAreaMin ?? 10) * iuPerMM * iuPerMM;

  const isolated = polys.filter(
    (ring) => !connected.some((p) => pointInPolygon([ring], p)) && !touchesSameNetZone(ring),
  );

  // "skip island removal on layers where every outline is an island
  // (unconnected pour — must be preserved as-is)" (zone_filler.cpp:988-1004).
  // A pour that reaches nothing at all is a deliberate one, not a mistake.
  if (isolated.length === polys.length) return polys;

  const drop = new Set(
    mode === 'always'
      ? isolated
      : isolated.filter((ring) => Math.abs(ringArea(ring)) < minIslandArea),
  );

  return polys.filter((ring) => !drop.has(ring));
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

    const clipped = clip.intersection(
      clip.union(voids[0]!, ...voids.slice(1)) as Geom,
      multi(interior) as Geom,
    ) as MultiPolygon;
    if (clipped.length === 0) return fill;

    const out = clip.difference(multi(fill) as Geom, clipped as Geom) as MultiPolygon;
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
  const merged = clip.union(stamps[0]!, ...stamps.slice(1)) as MultiPolygon;
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

  const clipped = clip.intersection(
    clip.union(holes[0]!, ...holes.slice(1)) as Geom,
    multi(inner) as Geom,
  ) as MultiPolygon;

  // A hole clipped down to a speck is dropped rather than pitting the copper.
  const kept = clipped.filter(
    (poly) => Math.abs(ringArea(poly[0]!.map(([x, y]) => ({ x, y })))) >= minimalHoleArea,
  );
  if (kept.length === 0) return fill;

  const out = clip.difference(multi(fill) as Geom, kept as Geom) as MultiPolygon;
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
 * `ZONE::BuildSmoothedPoly` (zone.cpp:1470-1626), the outline a pour starts
 * from, in upstream's order:
 *
 *  1. the flattened outline — and for a rule area, nothing more: "We like
 *     keepouts just the way they are";
 *  2. UNIONED with every same-net zone on this layer whose outline collides
 *     with it, "which keeps us from smoothing corners at an intersection
 *     (which often produces undesired divots between the intersecting
 *     zones)". A same-net zone that a higher-priority different-net zone cuts
 *     off completely is left out ("treat the enclosed zone as isolated");
 *  3. INTERSECTED with the board outline — before the smoothing, not after;
 *  4. the `smooth` lambda, chamfer or fillet by the corner radius; a teardrop
 *     is never smoothed;
 *  5. INTERSECTED with `maxExtents`, the flattened outline, so an external
 *     fillet at a concave corner is cut back off (`m_ZoneKeepExternalFillets`
 *     is false by default) and the same-net neighbours' area goes again.
 *
 * Step 2 is what makes a filleted zone that abuts another zone of its net
 * keep a SQUARE corner where the two meet: the corner is not a corner of the
 * union. CM5's 0.5 mm-fillet +3V3 pours meet other +3V3 pours edge to edge,
 * and this filleted them anyway, losing 0.11 mm² of copper at each corner.
 *
 * Step 5 is why a fillet never adds copper: `chamferFilletPolygon` rounds a
 * concave corner OUTWARD, and upstream keeps that only in the 5.1 mode.
 */
function buildSmoothedPoly(
  board: Board,
  zoneIndex: number,
  layer: string,
  boardOutline: Geom | null,
  maxError: number,
): Geom {
  const zone = board.zones[zoneIndex]!;
  const flattened: Geom = [[intRingOf(zone.outline!)]];
  if (zone.ruleArea) return flattened;

  const mode = zone.cornerSmoothing ?? 'none';
  const radius = zone.cornerRadius ?? 0;
  const smoothRequested =
    (mode === 'chamfer' || mode === 'fillet') && radius > 0 && zone.teardropType === undefined;

  // `GetInteractingZones`: same-net zones whose outline collides, and the
  // different-net ones whose bounding box touches.
  const epsilon = mmToIU(0.001);
  const bbox = boxInflate(boxOf(zone.outline!), epsilon);
  const sameNet: PcbZone[] = [];
  const diffNet: PcbZone[] = [];
  board.zones.forEach((other, i) => {
    if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
    if (!other.layers.includes(layer)) return;
    if (other.ruleArea || other.teardropType !== undefined) return;
    if (!boxesIntersect(boxOf(other.outline), bbox)) return;
    if (other.net === zone.net) {
      // `m_Poly->Collide( candidate->m_Poly )` — touching along an edge counts,
      // which a plain intersection reads as nothing, so the outline is grown
      // by the same epsilon before it is asked.
      const grown = inflate([[zone.outline!]], epsilon, epsilon);
      if (
        grown.length > 0 &&
        (clip.intersection(fromPolys(grown), [[intRingOf(other.outline)]] as Geom) as MultiPolygon)
          .length > 0
      )
        sameNet.push(other);
    } else {
      diffNet.push(other);
    }
  });

  let poly: Geom = flattened;

  for (const neighbour of sameNet) {
    // "The same-net intersecting zone *might* get knocked out along the
    // border by a higher-priority, different-net zone" — and if those enclose
    // THIS zone completely, the neighbour is not really adjoining it.
    const nBox = boxOf(neighbour.outline!);
    const cutters: Ring[][] = [];
    for (const d of diffNet)
      if (higherPriority(d, neighbour) && boxesIntersect(boxOf(d.outline!), nBox))
        cutters.push([intRingOf(d.outline!)]);
    if (cutters.length > 0) {
      const left = clip.difference(flattened, cutters as unknown as Geom) as MultiPolygon;
      if (left.length === 0) continue;
    }
    poly = clip.union(poly, [[intRingOf(neighbour.outline!)]] as Geom) as MultiPolygon;
  }

  if (boardOutline) {
    poly = clip.intersection(poly, boardOutline) as MultiPolygon;
    if ((poly as MultiPolygon).length === 0) return poly;
  }

  if (smoothRequested) {
    const polys = asPolys(poly);
    const smoothed = mode === 'chamfer' ? chamfer(polys, radius) : fillet(polys, radius, maxError);
    poly = smoothed
      .map((q) => q.map(intRingOf))
      .filter((q) => q[0]!.length >= 3) as unknown as MultiPolygon;
  }

  return clip.intersection(poly, flattened) as MultiPolygon;
}

/**
 * The throwaway `testAreas` a spoke's tip is hit-tested against
 * (zone_filler.cpp:2936-2965): the fill minus every clearance hole, deflated
 * and re-inflated by half the minimum width — with `fastCornerStrategy`,
 * CHAMFER_ALL_CORNERS, on BOTH legs, and neither the tiny-island cull nor the
 * clip back to the starting copper that the real prune gets.
 *
 * The corner strategy is the whole difference. At a reflex corner of the
 * copper — where a track's clearance band meets a pad's relief arc — a
 * round re-inflate leaves a fillet that a chamfered one does not, and a
 * spoke aimed into that corner has its tip inside one and outside the other.
 * On complex_hierarchy a GND pad's 45° spoke lands 0.02 mm from such a
 * corner: upstream keeps it, and the real prune's rounded test dropped it,
 * 0.6 mm² of copper and one fewer connection to the pad.
 */
function spokeTestAreas(fill: Polygon[], zone: PcbZone, maxError: number): Polygon[] {
  const halfMinWidth = Math.floor((zone.minThickness ?? 0) / 2);
  const epsilon = mmToIU(0.001);
  if (halfMinWidth - epsilon <= epsilon || fill.length === 0) return fill;

  const segs = segmentsForRadius(halfMinWidth, maxError);
  const deflated = inflate(
    fill,
    -(halfMinWidth - epsilon),
    CornerStrategy.CHAMFER_ALL_CORNERS,
    segs,
  );
  if (deflated.length === 0) return [];
  return inflate(deflated, halfMinWidth - epsilon, CornerStrategy.CHAMFER_ALL_CORNERS, segs);
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
  const clipped = clip.intersection(a as Geom, b as Geom) as MultiPolygon;
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
  // `ZONE_FILLER::Fill` runs the zones through a dependency DAG
  // (`fill_item_dependency`) so a zone is poured only after the ones that knock
  // it out: `knockoutZoneClearance` subtracts the other zone's FILLED area, and
  // an unfilled one subtracts nothing. Pouring in board order instead means a
  // zone sees whatever fill its neighbour happened to be carrying — the file's,
  // or none.
  //
  // The dependency is exactly `HigherPriority`, so ordering by it is the same
  // topological order.
  const order = board.zones
    .map((_, i) => i)
    .sort((a, b) => (higherPriority(board.zones[a]!, board.zones[b]!) ? -1 : 1));

  let working = board;
  const poured: { index: number; parts: ZoneFillParts[] }[] = [];

  for (const i of order) {
    const z = working.zones[i]!;

    // Teardrops keep the fill their generator produced. Upstream *does* run the
    // filler over them, but under a pile of special cases — pad connection
    // forced to FULL, no keepout knockouts, same-net higher-priority zones
    // skipped — whose net effect is the outline it already has. Pouring one
    // like an ordinary zone instead opens a thermal relief in the flare and
    // eats the very copper the teardrop exists to add.
    //
    // A rule area is not copper and is never poured either; without that guard
    // it goes through the pour like any other zone, and on a board whose island
    // removal is set to NEVER that lays filled copper inside the keepout.
    if (z.filled === false || z.teardropType || z.ruleArea) continue;
    const parts = fillZoneParts(working, i, opts);
    poured.push({ index: i, parts });

    // The next zone down knocks itself out of these, so they have to be on the
    // board before it is poured — islands and all.
    const fills = parts.map((part) => ({ layer: part.layer, polys: part.polys }));
    const zones = [...working.zones];
    zones[i] = { ...z, fills, source: withFilledPolygons(z, fills) };
    working = { ...working, zones };
  }

  // "m_connAlgo->SearchClusters(); for each zone, for each layer …" —
  // `ZONE_FILLER::Fill` runs `FillIsolatedIslandsMap` once, over the finished
  // board, and only then deletes. Asking per zone as it was poured reads a
  // different board: a zone still to be poured carries the file's fill or
  // none, so a pour that is welded to its neighbour looks isolated, and one
  // whose neighbour has since been cut back looks connected.
  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const finished = poured.map(({ index, parts }) => ({
    index,
    fills: parts
      .map((part) => ({
        layer: part.layer,
        polys: removeIslands(
          part.polys,
          working.zones[index]!,
          part.connected,
          sameNetZoneTouch(working, index, part.layer, maxError),
        ),
      }))
      .filter((f) => f.polys.length > 0),
  }));

  const zones = [...working.zones];
  for (const { index, fills } of finished) {
    const z = zones[index]!;
    zones[index] = { ...z, fills, source: withFilledPolygons(z, fills) };
  }

  return { ...working, zones };
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
