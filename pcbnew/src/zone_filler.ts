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
  booleanAdd,
  booleanIntersection,
  booleanOp,
  BooleanOp,
  booleanSubtract,
  chamfer,
  inflateWithLinkedHoles,
  CornerStrategy,
  fillet,
  fracture,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { getBoardPolygonOutlines } from './board_statistics.js';
import { type Vertex, VertexSet } from '@ziroeda/kimath/src/geometry/vertex_set.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { defaultThermalSpokeAngle } from './padstack.js';
import { graphicShapes, padShapes } from './drc/drc_engine.js';
import { shapeDist, type Shape } from './drc/drc_geometry.js';
import { tessellateArc } from './read-board.js';
import { padShapePos } from './padstack.js';
import { type FillOutline, isolatedIslands } from './zone_islands.js';
import { textTransformShapeToPolygon, textTransformTextToPolySet } from './text_to_polyset.js';
import {
  arcToPolygon,
  circlePoly,
  dedupeRing,
  segmentsForRadius,
  stadiumPoly,
} from './convert_basic_shapes_to_polygon.js';

export { segmentsForRadius };
import { barcodeGeometry, barcodeHullBoxes } from './barcode_geometry.js';
import {
  arcTrackTransformShapeToPolygon,
  edaShapeTransformShapeToPolygon,
  ErrorLoc,
  padTransformHoleToPolygon,
  padTransformShapeToPolygon,
  trackTransformShapeToPolygon,
  viaTransformShapeToPolygon,
} from './transform_shape_to_polygon.js';
import { transformCircleToPolygonSet } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type {
  Board,
  PadPrimitive,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
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
/** The implicit "barcode visual separation default" rule: 1 mm (drc_engine.cpp:261). */
const BARCODE_VISUAL_SEPARATION_DEFAULT = mmToIU(1.0);

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
   * `PHYSICAL_CLEARANCE_CONSTRAINT` / `PHYSICAL_HOLE_CLEARANCE_CONSTRAINT` as
   * resolved for the zone — a rule-only constraint, so a board with no
   * custom rules has none (`EvalRules` answers a null constraint, `Min()` 0).
   */
  physicalClearance?: number;
  physicalHoleClearance?: number;
  /** `m_HoleToHoleMin`, one of the terms of `GetBiggestClearanceValue`. */
  holeToHoleMin?: number;
  /**
   * `QueryWorstConstraint( CLEARANCE_CONSTRAINT )`: the largest clearance any
   * netclass or rule states, whether or not a net uses it.
   */
  worstNetClassClearance?: number;
  /**
   * `DUMP_POLYS_TO_COPPER_LAYER`: every intermediate poly set of
   * `fillCopperZone`, named as upstream names its debug layers, for a test
   * that holds KiCad's own `DebugZoneFiller` dumps.
   */
  onStage?: (name: string, layer: string, polys: Polygon[]) => void;
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
 * `PCB_SHAPE::GetBoundingBox`, near enough for the zone's own guard: the
 * shape's points widened by its stroke.
 */
function shapeBox(s: PcbShape): Box {
  const pts: Vec2[] = [];
  for (const p of [s.start, s.end, s.mid, s.center]) if (p) pts.push(p);
  if (s.pts) pts.push(...s.pts);
  let box = boxOf(pts.length ? pts : [{ x: 0, y: 0 }]);
  if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    box = boxInflate(boxOf([s.center]), r);
  }
  return boxInflate(box, Math.trunc(s.width / 2));
}

/** kimath polygons as the `Geom` list the knockout sets are collected in. */
const asGeoms = (polys: Polygon[]): Geom[] => polys.map((poly) => poly.map(ringOf) as Geom);

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
      // `TransformArcToPolygon( start, mid, end, width + 2 * clearance, … )` —
      // one polygon on the chord circle, when the arc came with its points.
      if (shape.chord)
        return [
          [
            arcToPolygon(
              shape.chord.s,
              shape.chord.m,
              shape.chord.e,
              2 * (shape.r + gap),
              maxError,
            ),
          ],
        ];
      // A full circle drawn as an arc: the centreline, thickened by its own
      // half-width plus the gap.
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
const angleCos = (deg: number): number => new EDA_ANGLE(deg).Cos();
const angleSin = (deg: number): number => new EDA_ANGLE(deg).Sin();

/** `RotatePoint( VECTOR2I&, const EDA_ANGLE& )` — the integer one, KiROUND. */
const rotate = (p: Vec2, deg: number): Vec2 => RotatePoint(p, new EDA_ANGLE(deg));

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
      at = { x: KiROUND(0.0), y: KiROUND(dy * half.y) };
    } else if (dy === 0) {
      side = { x: 0, y: spokeHalfW };
      at = { x: KiROUND(dx * half.x), y: KiROUND(0.0) };
    } else {
      // "We are going to intersect with one side or the other. Whichever we hit
      // first is the fraction of the spoke length we keep."
      const distX = half.x / Math.abs(dx);
      const distY = half.y / Math.abs(dy);

      if (distX < distY) {
        side = { x: KiROUND(0.0), y: KiROUND(spokeHalfW / angleSin(90 - a)) };
        at = { x: KiROUND(dx * distX), y: KiROUND(dy * distX) };
      } else {
        side = { x: KiROUND(spokeHalfW / angleSin(a)), y: KiROUND(0.0) };
        at = { x: KiROUND(dx * distY), y: KiROUND(dy * distY) };
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
  // `half_size = KiROUND( box.GetWidth() / 2.0, box.GetHeight() / 2.0 )`,
  // the box being `size / 2` (integer halves, plus `trap_delta / 2` for a
  // trapezoid) inflated by the gap.
  const half: Vec2 = {
    x: KiROUND(
      (2 * (Math.trunc(pad.size.x / 2) + Math.abs(Math.trunc((pad.delta?.y ?? 0) / 2))) +
        2 * inflate) /
        2.0,
    ),
    y: KiROUND(
      (2 * (Math.trunc(pad.size.y / 2) + Math.abs(Math.trunc((pad.delta?.x ?? 0) / 2))) +
        2 * inflate) /
        2.0,
    ),
  };

  // "the bounding box for circles will overshoot the mark considerably when the
  // spokes are near a 45 degree increment. So we build the spokes at 0 degrees
  // and then rotate them" — a round pad's spoke is as long as an axis one,
  // pointed diagonally, not out to the box's corner.
  const circular = pad.shape === 'circle' || (pad.shape === 'oval' && pad.size.x === pad.size.y);
  const built = circular
    ? spokesFromOrigin(half, 0, Math.trunc(width / 2)).map((sp) =>
        spokeAngle !== 0 ? placeSpoke(sp, spokeAngle, { x: 0, y: 0 }) : sp,
      )
    : spokesFromOrigin(half, spokeAngle, Math.trunc(width / 2));

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

  return booleanSubtract(
    fill,
    knockouts.map((poly) => poly.map(ptsOf)),
  );
}

/**
 * `SHAPE_POLY_SET::Inflate( aAmount, aCornerStrategy, aMaxError, aSimplify )`:
 * the segment count is `GetArcToSegmentCount( |aAmount|, aMaxError, 360° )`.
 */
function inflateKi(
  polys: Polygon[],
  amount: number,
  strategy: CornerStrategy,
  maxError: number,
  simplify = false,
): Polygon[] {
  return inflate(polys, amount, strategy, segmentsForRadius(Math.abs(amount), maxError), simplify);
}

/** The `islandExtents.GetSizeMax()` of `fillCopperZone`'s blob test. */
function islandExtentMax(poly: Polygon): number {
  const outer = poly[0];
  if (!outer || outer.length === 0) return 0;
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
  return Math.max(maxX - minX, maxY - minY);
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
  /**
   * `m_preKnockoutFillCache`: the fill BEFORE the different-net zone
   * knockouts, which the iterative refill starts over from.
   */
  preKnockout: Polygon[];
}

function fillZoneParts(
  board: Board,
  zoneIndex: number,
  opts: ZoneFillOptions = {},
  onlyLayers?: ReadonlySet<string>,
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
    if (onlyLayers && !onlyLayers.has(layer)) continue;

    // `ZONE::BuildSmoothedPoly( maxExtents, aLayer, boardOutline, &smoothedPoly )`:
    // the fill STARTS from the outline with its apron, and is trimmed back to
    // `maxExtents` only at the end (zone_filler.cpp:3126).
    const smoothed = buildSmoothedPoly(board, zoneIndex, layer, boardOutline, maxError);
    if (smoothed.maxExtents.length === 0) continue;
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
    // `BOARD_DESIGN_SETTINGS::GetBiggestClearanceValue`: the board minimum
    // clearance, hole clearance, hole-to-hole and copper-to-edge, then the
    // worst of every clearance rule and netclass.
    //
    // `QueryWorstConstraint( PHYSICAL_CLEARANCE_CONSTRAINT )` counts every rule
    // whatever its condition, and `loadImplicitRules` always adds "barcode
    // visual separation default", a 1 mm physical clearance on
    // `A.Type == 'Barcode'` (drc_engine.cpp:259-263). So the worst clearance
    // on any board is at least 1 mm, and a board edge 0.6 mm from a pour is
    // knocked out where a smaller guard would have skipped it.
    let worstClearance = Math.max(
      opts.minClearance ?? 0,
      opts.holeClearance ?? 0,
      opts.holeToHoleMin ?? 0,
      opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE,
      opts.worstNetClassClearance ?? 0,
      BARCODE_VISUAL_SEPARATION_DEFAULT,
    );
    for (const net of board.nets.keys()) worstClearance = Math.max(worstClearance, gapTo(net));
    // `GetMaxClearanceValue` walks the items too, and a local override on one
    // pad can be larger than any netclass on the board.
    for (const fp of board.footprints) {
      for (const pad of fp.pads) {
        // `pad->GetClearanceOverrides( nullptr )`: the pad's own, else its
        // footprint's.
        const override = pad.localClearance ?? fp.localClearance;
        if (override !== undefined) worstClearance = Math.max(worstClearance, override);
      }
    }
    // `GetMaxClearanceValue` walks the zones too: another zone's own
    // `(clearance …)` is a gap this pour has to keep.
    for (const z of board.zones)
      if (!z.ruleArea && z.clearance !== undefined)
        worstClearance = Math.max(worstClearance, z.clearance);
    const zoneBox = boxInflate(boxOf(zone.outline), worstClearance + EXTRA_CLEARANCE);
    const near = (b: Box): boolean => boxesIntersect(b, zoneBox);

    const stage = (name: string, polys: Polygon[]): void => {
      if (opts.onStage) opts.onStage(name, layer, polys);
    };

    let fill: Polygon[] = smoothed.smoothed;
    stage('smoothed-outline', fill);

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
          reliefHoles.push(
            ...asGeoms(
              padTransformShapeToPolygon(pad, reliefGap, maxError, ErrorLoc.ERROR_OUTSIDE),
            ),
          );
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
          thermalHoles.push(
            ...asGeoms(padTransformHoleToPolygon(pad, 0, maxError, ErrorLoc.ERROR_OUTSIDE)),
          );
          continue;
        }

        if (sameNet && mode === 'none') {
          // A same-net pad with NO connection is knocked out right here in
          // `knockoutThermalReliefs`, into the same set as the reliefs: the
          // gap is the physical clearance or the zone's own, whichever is
          // larger, with NO `m_ExtraClearance`, and a flashed pad's hole is
          // not knocked out separately (zone_filler.cpp:1955-1980).
          const padClearance = Math.max(opts.physicalClearance ?? 0, zone.clearance ?? 0);
          if (padOnLayer(pad, layer) && pad.type !== 'np_thru_hole') {
            reliefHoles.push(
              ...asGeoms(
                padTransformShapeToPolygon(pad, padClearance, maxError, ErrorLoc.ERROR_OUTSIDE),
              ),
            );
          } else if (pad.drill) {
            const holeClearance = Math.max(opts.physicalHoleClearance ?? 0, padClearance);
            reliefHoles.push(
              ...asGeoms(
                padTransformHoleToPolygon(pad, holeClearance, maxError, ErrorLoc.ERROR_OUTSIDE),
              ),
            );
          }
          continue;
        }

        // Every different-net pad. `knockoutPadClearance` treats the copper
        // and the hole as two separate knockouts with two different gaps.
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
          holes.push(
            ...asGeoms(
              padTransformShapeToPolygon(
                pad,
                copperGap + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
        }

        // The hole's own gap: the board's hole clearance, and — "oblong NPTH
        // holes are milled rather than drilled, so they need edge clearance in
        // addition to hole clearance" — the edge clearance for a slot. A plated
        // hole also takes the ordinary clearance; an NPTH does not.
        let holeGap = holeClearance;
        if (!npth) holeGap = Math.max(holeGap, copperGap);
        if (npth && pad.drill && pad.drill.w !== pad.drill.h)
          holeGap = Math.max(holeGap, opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE);

        holes.push(
          ...asGeoms(
            padTransformHoleToPolygon(
              pad,
              holeGap + EXTRA_CLEARANCE,
              maxError,
              ErrorLoc.ERROR_OUTSIDE,
            ),
          ),
        );
      }
    }

    /* ---------------------------------------------------------------------
     * Knockout thermal reliefs: `aFill.BooleanSubtract( holes )`, the reliefs
     * and the same-net no-connection pads, and nothing else.
     */
    fill = booleanSubtract(fill, reliefHoles.flatMap(asPolys));
    stage('minus-thermal-reliefs', fill);

    // `buildCopperItemClearances` walks the board in ONE order, and the
    // order is not cosmetic: the knockouts are unioned into a single poly
    // set, and where a ring of Clipper's answer STARTS depends on the order
    // its inputs arrived in. `Fracture` then bridges each hole from its
    // first leftmost vertex, so a ring rotated by one vertex is a slit
    // landing on a different corner, and a fill that is the same copper
    // with different vertices. Tracks, arcs and vias come in the file's own
    // interleaving (`m_board->Tracks()`); then per footprint the reference,
    // the value and its graphical items in file order; then the board's
    // drawings in file order; then the zones.
    const fileOrder = new Map<unknown, number>();
    board.source.items.forEach((node, i) => fileOrder.set(node, i));
    const at = (item: { source: unknown }): number =>
      fileOrder.get(item.source) ?? Number.MAX_SAFE_INTEGER;

    const copperItems: { at: number; run: () => void }[] = [];
    // Tracks, arcs and vias on other nets.
    for (const t of board.tracks)
      copperItems.push({
        at: at(t),
        run: () => {
          if (t.layer !== layer) return;
          if (!near(boxAround(t.start, t.end, t.width))) return;
          if (t.net === zone.net && zone.net > 0) {
            connected.push(...alongSegment(t.start, t.end));
            return;
          }
          holes.push(
            ...asGeoms(
              trackTransformShapeToPolygon(
                t,
                gapTo(t.net) + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
        },
      });
    for (const a of board.arcs)
      copperItems.push({
        at: at(a),
        run: () => {
          if (a.layer !== layer) return;
          if (!near(boxInflate(boxOf([a.start, a.mid, a.end]), a.width))) return;
          if (a.net === zone.net && zone.net > 0) {
            const pts = tessellateArc(a.start, a.mid, a.end);
            for (let i = 1; i < pts.length; i++)
              connected.push(...alongSegment(pts[i - 1]!, pts[i]!));
            return;
          }
          // `PCB_TRACK::TransformShapeToPolygon`, PCB_ARC_T: "width = m_width + ( 2
          // * aClearance )" into `TransformArcToPolygon`.
          holes.push(
            ...asGeoms(
              arcTrackTransformShapeToPolygon(
                a,
                gapTo(a.net) + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
        },
      });
    for (const v of board.vias)
      copperItems.push({
        at: at(v),
        run: () => {
          // "viaBBox.Inflate( m_worstClearance )".
          if (!near(boxAround(v.at, v.at, v.size))) return;
          if (v.net === zone.net && zone.net > 0) {
            connected.push(...viaAnchors(v));
            return;
          }
          // `knockoutTrackClearance`, PCB_VIA_T: the copper at the clearance, and
          // the DRILL at the larger of that and the hole clearance
          // (zone_filler.cpp:2303-2320) — a second circle, usually inside the
          // first, in the same set.
          const viaGap = gapTo(v.net);
          holes.push(
            ...asGeoms(
              viaTransformShapeToPolygon(
                v,
                viaGap + EXTRA_CLEARANCE,
                maxError,
                ErrorLoc.ERROR_OUTSIDE,
              ),
            ),
          );
          const drillGap = Math.max(viaGap, opts.holeClearance ?? 0);
          holes.push([
            transformCircleToPolygonSet(
              v.at,
              Math.trunc(v.drill / 2) + drillGap + EXTRA_CLEARANCE,
              maxError,
              ErrorLoc.ERROR_OUTSIDE,
            ).map((p) => [p.x, p.y] as [number, number]),
          ]);
        },
      });
    copperItems.sort((p, q) => p.at - q.at);
    for (const item of copperItems) item.run();

    // Footprints: courtyard (no physical clearance rule, so nothing), the
    // reference, the value, then the graphical items in file order; then the
    // board's own drawings in file order.
    const knockoutGraphic = (s: PcbShape): void => {
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
      const onLayer = s.layer === layer;
      const isEdge = s.layer === 'Edge.Cuts';
      const isMargin = s.layer === 'Margin';
      if (!onLayer && !isEdge && !isMargin) return;
      // "if( aItem->GetBoundingBox().Intersects( zone_boundingbox ) )" — the
      // top edge of a board whose pour sits well below it is not knocked out,
      // and so never joins the other three edges into one band.
      if (!near(shapeBox(s))) return;

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

      holes.push(
        ...asGeoms(
          edaShapeTransformShapeToPolygon(
            s,
            gap + EXTRA_CLEARANCE,
            maxError,
            ErrorLoc.ERROR_OUTSIDE,
            isEdge,
          ),
        ),
      );
    };

    const knockoutText = (t: PcbTextItem): void => {
      // Copper TEXT, which `knockoutGraphicClearance` treats exactly like a
      // graphic — `addKnockout` has a `PCB_TEXT_T` case
      // (zone_filler.cpp:1735-1760). Without it the pour ran straight through the
      // lettering on a copper layer: on complex_hierarchy a two-line B.Cu label
      // is 140 mm² of copper we filled and KiCad does not, which is not a
      // cosmetic difference but a short.
      const onLayer = t.layer === layer;
      const isEdge = t.layer === 'Edge.Cuts';
      const isMargin = t.layer === 'Margin';
      if (!onLayer && !isEdge && !isMargin) return;

      // Text carries no net, so it is never the same net as the pour: `shapeNet`
      // is -1 for anything that is not a PCB_SHAPE.
      const gap = isEdge || isMargin ? (opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE) : gapTo(0);

      // `if( text->IsVisible() )` — and then the rendered hull,
      // `text->TransformShapeToPolygon( aHoles, aLayer, aGap, m_maxError,
      // ERROR_OUTSIDE )`, or for knockout text the rendered strokes themselves.
      if (t.hide) return;
      const polys = t.knockout
        ? textTransformTextToPolySet(t, 0, maxError, ErrorLoc.ERROR_INSIDE)
        : textTransformShapeToPolygon(t, gap + EXTRA_CLEARANCE, maxError, ErrorLoc.ERROR_OUTSIDE);
      if (polys.length === 0) return;
      // `aItem->GetBoundingBox().Intersects( zone_boundingbox )`
      if (!near(boxOf(polys.flatMap((poly) => poly[0]!)))) return;
      holes.push(...asGeoms(polys));
    };

    const fpOrder = (fp: PcbFootprint): Map<unknown, number> => {
      const m = new Map<unknown, number>();
      fp.source.items.forEach((node, i) => m.set(node, i));
      return m;
    };
    const isField = (t: PcbTextItem): boolean =>
      t.kind === 'reference' ||
      t.kind === 'value' ||
      headOf(t.source as { items: unknown[] }) === 'property';

    for (const fp of board.footprints) {
      const ref = fp.texts.find((t) => t.kind === 'reference');
      const val = fp.texts.find((t) => t.kind === 'value');
      if (ref) knockoutText(ref);
      if (val) knockoutText(val);
      const order = fpOrder(fp);
      const items: { at: number; run: () => void }[] = [];
      for (const s of fp.shapes ?? [])
        items.push({
          at: order.get(s.source) ?? Number.MAX_SAFE_INTEGER,
          run: () => knockoutGraphic(s),
        });
      // `GraphicalItems()` holds every text that is not a field.
      for (const t of fp.texts)
        if (!isField(t))
          items.push({
            at: order.get(t.source) ?? Number.MAX_SAFE_INTEGER,
            run: () => knockoutText(t),
          });
      items.sort((p, q) => p.at - q.at);
      for (const item of items) item.run();
    }

    const drawings: { at: number; run: () => void }[] = [];
    for (const s of board.shapes) drawings.push({ at: at(s), run: () => knockoutGraphic(s) });
    for (const t of board.texts) drawings.push({ at: at(t), run: () => knockoutText(t) });
    drawings.sort((p, q) => p.at - q.at);
    for (const item of drawings) item.run();

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

    // `ADVANCED_CFG::m_ZoneFillIterativeRefill` is true by default, and it
    // changes the shape of the fill: `buildCopperItemClearances( …,
    // aIncludeZoneClearances = false )` leaves the other zones OUT of the
    // clearance holes. The keepouts join them separately (and the set is
    // simplified a second time when any did); the different-net higher
    // priority zones become `zoneClearances`, a set of their own, subtracted
    // from the spoke test areas and, after the trim to the clearance holes,
    // from the fill — followed by `postKnockoutMinWidthPrune`.
    const keepoutHoles: Polygon[] = [];
    const zoneClearances: Polygon[] = [];
    board.zones.forEach((other, i) => {
      if (i === zoneIndex || !other.outline || other.outline.length < 3) return;
      if (!other.layers.includes(layer)) return;
      // "if( aKnockout->GetBoundingBox().Intersects( zone_boundingbox ) )".
      if (!near(boxOf(other.outline))) return;

      // `isZoneFillKeepout`: a rule area with the copper-pour keepout set. Its
      // knockout is `TransformSmoothedOutlineToPolygon( …, 0, … )` — for a
      // rule area `BuildSmoothedPoly` hands the outline back untouched
      // ("We like keepouts just the way they are"), and no clearance means no
      // inflate, so it is the outline, fractured. A teardrop is exempt.
      if (other.ruleArea) {
        if (other.ruleArea.copperPour && !zone.teardropType)
          keepoutHoles.push(...fracture([[other.outline]]).map((r) => [r]));
        return;
      }

      if (!higherPriority(other, zone) || other.net === zone.net) return;

      // `ZONE::TransformShapeToPolygon` takes the other zone's FILLED areas,
      // not its outline — "if( !m_FilledPolysList.count( aLayer ) ) return", so
      // a zone with nothing poured on this layer knocks nothing out — and
      // grows them with `InflateWithLinkedHoles`: unfractured, inflated,
      // fractured again. ERROR_OUTSIDE adds one maxError to the clearance.
      const otherFill = other.fills.find((f) => f.layer === layer);
      if (!otherFill || otherFill.polys.length === 0) return;

      // `EvalRules( CLEARANCE_CONSTRAINT, aZone, otherZone )`: "Local
      // clearance on %s" is asked of BOTH items, and the larger wins — so the
      // other zone's own `(clearance …)` raises this gap as much as ours does
      // (drc_engine.cpp:1908-1953; `ZONE::GetLocalClearance` is
      // `m_ZoneClearance`).
      const gap = Math.max(gapTo(other.net), other.clearance ?? 0);
      if (gap < 0) return; // "Negative clearance permits zones to short"

      const amount = gap + EXTRA_CLEARANCE + maxError;
      for (const ring of inflateWithLinkedHoles(
        otherFill.polys.map((poly) => [poly]),
        amount,
        CornerStrategy.ROUND_ALL_CORNERS,
        segmentsForRadius(amount, maxError),
      ))
        zoneClearances.push([ring]);
    });

    // `buildCopperItemClearances` ends with `aHoles.Simplify()`: the knockouts
    // become ONE poly set. `Simplify` is `splitCollinearOutlines` — which
    // finds nothing to split in a set of simple shapes — and then a union with
    // an empty set.
    stage('input:clearance-holes', holes.flatMap(asPolys));
    let clearanceHoles: Polygon[] = booleanAdd(holes.flatMap(asPolys), []);
    if (keepoutHoles.length > 0)
      clearanceHoles = booleanAdd([...clearanceHoles, ...keepoutHoles], []);
    stage('clearance-holes', clearanceHoles);
    // `buildDifferentNetZoneClearances` ends with its own `Simplify()`.
    const zoneKnockouts: Polygon[] =
      zoneClearances.length > 0 ? booleanAdd(zoneClearances, []) : [];

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
    if (spokes.length > 0) {
      let testAreas = booleanSubtract(fill, clearanceHoles);
      if (zoneKnockouts.length > 0) testAreas = booleanSubtract(testAreas, zoneKnockouts);
      stage('minus-clearance-holes', testAreas);
      testAreas = spokeTestAreas(testAreas, zone, maxError, stage);
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
      stage(
        'spokes',
        kept.map((k) => [k.ring]),
      );

      // A kept spoke's tip is by construction ON the copper it bridges to,
      // which makes it the anchor for the pad it belongs to. A dropped one
      // is not — and a pad whose spokes were all dropped connects to
      // nothing, so it anchors nothing.
      for (const k of kept) connected.push(k.tip);

      // `aFillPolys.AddOutline( spoke )`: a kept spoke is one more OUTLINE of
      // the fill's poly set, and no boolean runs until the next line.
      fill = [...fill, ...kept.map((k) => [k.ring])];
    }

    // "the 'real' subtract-clearance-holes has to be done after the spokes
    // are added" (zone_filler.cpp:3020). A spoke runs from the pad centre
    // out past the relief, straight through whatever sits in between; the
    // holes are what stop it short of a neighbour's clearance.
    stage('input:after-spoke-trimming:subject', fill);
    stage('input:after-spoke-trimming:clip', clearanceHoles);
    fill = booleanSubtract(fill, clearanceHoles);
    stage('after-spoke-trimming', fill);

    /* ---------------------------------------------------------------------
     * Prune features that don't meet minimum-width criteria, then fracture,
     * as `fillCopperZone` does — and only THEN look for islands.
     *
     * The order is the whole point. `ZONE_FILLER::Fill` calls
     * `FillIsolatedIslandsMap` after every `fillCopperZone` has returned, so
     * what it sees is the finished, fractured poly set: each outline is one
     * disjoint piece of copper, holes already cut by slits. Asking earlier
     * reads a different board. On ecc83-pp four regions hang off the pour by
     * necks thinner than its 0.381 mm minimum; the deflate/inflate severs them,
     * and 212 mm² of copper KiCad drops as islands survived here because at the
     * time we asked they were still attached.
     */
    const halfMinWidth = Math.trunc((zone.minThickness ?? 0) / 2);
    const epsilon = mmToIU(0.001);
    const prune = halfMinWidth - epsilon > epsilon;

    if (prune)
      fill = inflateKi(
        fill,
        -(halfMinWidth - epsilon),
        CornerStrategy.CHAMFER_ALL_CORNERS,
        maxError,
      );

    // "Min-thickness is the web thickness. On the other hand, a blob
    // min-thickness by min-thickness is not useful" — an island whose whole
    // extent, deflated, is under the min thickness is deleted.
    fill = fill.filter((poly) => islandExtentMax(poly) >= (zone.minThickness ?? 0));
    stage('deflated', fill);

    if (zone.fillMode === 'hatch') {
      // A hatched zone keeps only its webbing (ZONE_FILLER::addHatchFillTypeOnZone),
      // "note that we do this while deflated".
      fill = addHatchFillTypeOnZone(
        fill,
        zone,
        maxError,
        hatchingOffsetFor(layer, opts.hatchingOffsets, zone.layerProperties),
      );
    } else {
      // "Connect nearby polygons with zero-width lines in order to ensure
      // correct re-inflation" — `aFillPolys.Fracture(); connect_nearby_polys(
      // aFillPolys, aZone->GetMinThickness() )`, in the deflated state.
      fill = connectNearbyPolys(fracture(fill), zone.minThickness ?? 0).map((ring) => [ring]);
      stage('connected-nearby-polys', fill);
    }

    /* ---------------------------------------------------------------------
     * Finish minimum-width pruning by re-inflating
     */
    if (prune)
      fill = inflateKi(
        fill,
        halfMinWidth - epsilon,
        CornerStrategy.ROUND_ALL_CORNERS,
        maxError,
        true,
      );

    // "The deflation/inflation process can leave notches in the outline.
    // Remove these by doing a union with the original ring" —
    // `BooleanAdd( thermalRings )`, which is empty for a solid zone but is a
    // pass through the clipper all the same.
    fill = booleanAdd(fill, []);
    stage('after-reinflating', fill);

    /* ---------------------------------------------------------------------
     * Ensure additive changes (thermal stubs and inflating acute corners) do
     * not add copper outside the zone boundary, inside the clearance holes, or
     * between otherwise isolated islands
     */

    // "for( BOARD_ITEM* item : thermalConnectionPads ) addHoleKnockout( pad, 0,
    // clearanceHoles )": the drills join the SIMPLIFIED set as extra outlines.
    clearanceHoles = [...clearanceHoles, ...thermalHoles.flatMap(asPolys)];

    fill = booleanIntersection(fill, smoothed.maxExtents);
    stage('after-trim-to-outline', fill);
    fill = booleanSubtract(fill, clearanceHoles);
    stage('after-trim-to-clearance-holes', fill);

    // "Cache the pre-knockout fill for iterative refill optimization (issue
    // 21746)": what the refill starts over from, BEFORE the zone-to-zone
    // knockouts.
    const preKnockout = fill;
    if (zoneKnockouts.length > 0) {
      fill = booleanSubtract(fill, zoneKnockouts);
      // "Re-prune minimum-width violations introduced by different-net zone
      // knockouts. This must run BEFORE subtracting same-net higher-priority
      // zones."
      fill = postKnockoutMinWidthPrune(fill, zone, maxError);
    }
    stage('after-post-knockout-min-width', fill);

    if (zone.fillMode === 'thieving') fill = addCopperThievingPattern(fill, zone, maxError);

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
    fill = subtractHigherPriorityZones(fill, board, zoneIndex, layer, near);
    stage('minus-higher-priority-zones', fill);

    fills.push({ layer, polys: fracture(fill), connected, preKnockout });
  }

  return fills;
}

/**
 * One zone's finished copper.
 *
 * `ZONE_FILLER::Fill` over this one zone: it is poured against the fills the
 * other zones are carrying, and its own islands are judged on that board.
 * `fillZones` is the one that pours everything in upstream's order.
 */
export function fillZone(
  board: Board,
  zoneIndex: number,
  opts: ZoneFillOptions = {},
): PcbZoneFill[] {
  const zone = board.zones[zoneIndex];
  if (!zone) return [];
  const parts = fillZoneParts(board, zoneIndex, opts);
  const fills = parts.map((part) => ({ layer: part.layer, polys: part.polys }));
  const zones = [...board.zones];
  zones[zoneIndex] = { ...zone, fills };
  const working = { ...board, zones };
  const islands = isolatedIslands(working, fillOutlinesOf(working, [zoneIndex]));
  const zoneIslands = islands.get(zoneIndex) ?? new Map<string, number[]>();
  // "skip island removal on layers where every outline is an island
  // (unconnected pour — must be preserved as-is)": a zone every layer of
  // which is wholly isolated is left alone.
  const allLayersFullyIsolated = fills.every(
    (f) => (zoneIslands.get(f.layer) ?? []).length === f.polys.length,
  );
  if (allLayersFullyIsolated) return fills.filter((f) => f.polys.length > 0);
  return removeIslandsOf(zone, fills, zoneIslands, false).filter((f) => f.polys.length > 0);
}

/** Every fill outline of the given zones, as the connectivity items they are. */
function fillOutlinesOf(board: Board, zoneIndices: Iterable<number>): FillOutline[] {
  const out: FillOutline[] = [];
  for (const zi of zoneIndices) {
    const z = board.zones[zi]!;
    for (const f of z.fills)
      f.polys.forEach((ring, index) => out.push({ zone: zi, layer: f.layer, index, ring }));
  }
  return out;
}

/**
 * The `ISLAND_REMOVAL_MODE` switch of `ZONE_FILLER::Fill`
 * (zone_filler.cpp:990-1041), given which outlines are isolated.
 *
 * `initiallyFullyIsolated` is the loop's preservation of "legitimately
 * unconnected pours": when set, a layer on which EVERY outline is still an
 * island is left alone. On the first pass it is the ZONE that is skipped
 * when every layer is fully isolated — that decision is the caller's.
 */
function removeIslandsOf(
  zone: PcbZone,
  fills: PcbZoneFill[],
  isolated: ReadonlyMap<string, number[]>,
  preserveFullyIsolatedLayers: boolean,
): PcbZoneFill[] {
  const mode = zone.islandRemovalMode ?? 'always';
  // `island_area_min` is stored in mm², so the comparison happens there too.
  const iuPerMM = mmToIU(1);
  const minArea = (zone.islandAreaMin ?? 10) * iuPerMM * iuPerMM;
  return fills.map((f) => {
    const islands = isolated.get(f.layer) ?? [];
    if (islands.length === 0) return f;
    if (preserveFullyIsolatedLayers && islands.length === f.polys.length) return f;
    const drop = new Set<number>();
    for (const idx of islands) {
      if (mode === 'always') drop.add(idx);
      else if (mode === 'area' && Math.abs(ringArea(f.polys[idx]!)) < minArea) drop.add(idx);
    }
    return { layer: f.layer, polys: f.polys.filter((_, i) => !drop.has(i)) };
  });
}

/**
 * `SHAPE_POLY_SET::Inflate` on a zone's stored (fractured) fill, as
 * `refillZoneFromCache` grows a different-net knockout: `inflatedFill.Inflate(
 * gap + extra_margin + m_maxError, ROUND_ALL_CORNERS, m_maxError )` — the
 * fractured rings straight in, no unfracture.
 */
function inflateFractured(rings: Vec2[][], amount: number, maxError: number): Polygon[] {
  return inflateKi(
    rings.map((r) => [r]),
    amount,
    CornerStrategy.ROUND_ALL_CORNERS,
    maxError,
  );
}

const zoneBox = (z: PcbZone): Box => boxOf(z.outline ?? []);

/**
 * Fill every zone on the board — `ZONE_FILLER::Fill` (zone_filler.cpp:414),
 * the "Fill All Zones" action, in its order:
 *
 *  1. every fill is cleared, and the (zone, layer) pairs are poured in
 *     dependency WAVES: a pair waits for every higher-priority different-net
 *     zone on that layer whose outline collides with its own within the
 *     worst clearance, because that zone's FILL is what knocks it out;
 *  2. `FillIsolatedIslandsMap` once over the finished board, and the island
 *     removal mode applied — a zone every layer of which is wholly isolated
 *     is left alone;
 *  3. the iterative refill (`m_ZoneFillIterativeRefill`, on by default):
 *     every zone-layer that lost islands, plus every lower zone overlapping
 *     a higher SAME-net zone, seeds a wave of `refillZoneFromCache` — the
 *     pre-knockout fill minus the higher zones' fills as they stood before
 *     the wave — with island detection again and a hash comparison, until
 *     nothing changes or eight passes have run;
 *  4. outlines of at least 3 × min-thickness² that lie more than half
 *     outside the board outline are dropped.
 */
export function fillZones(board: Board, opts: ZoneFillOptions = {}): Board {
  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const clearanceOf = opts.clearanceOf ?? ((z: PcbZone) => z.clearance ?? mmToIU(0.5));

  // The zones `Fill` is handed: everything but rule areas and degenerate
  // outlines. Teardrops keep the fill their generator produced (see
  // `fillZoneParts`' comment on them).
  const pourable = (z: PcbZone): boolean =>
    !z.ruleArea && !z.teardropType && !!z.outline && z.outline.length > 2;

  // `m_worstClearance = m_board->GetMaxClearanceValue()`, the same number
  // `fillZoneParts` derives for its knockout box.
  let worstClearance = Math.max(
    opts.minClearance ?? 0,
    opts.holeClearance ?? 0,
    opts.holeToHoleMin ?? 0,
    opts.edgeClearance ?? DEFAULT_EDGE_CLEARANCE,
    opts.worstNetClassClearance ?? 0,
    BARCODE_VISUAL_SEPARATION_DEFAULT,
  );
  for (const z of board.zones)
    for (const net of board.nets.keys())
      worstClearance = Math.max(worstClearance, clearanceOf(z, net));
  for (const fp of board.footprints)
    for (const pad of fp.pads) {
      const override = pad.localClearance ?? fp.localClearance;
      if (override !== undefined) worstClearance = Math.max(worstClearance, override);
    }
  for (const z of board.zones)
    if (!z.ruleArea && z.clearance !== undefined)
      worstClearance = Math.max(worstClearance, z.clearance);

  // "Remove existing fill first"
  let working: Board = {
    ...board,
    zones: board.zones.map((z) => (pourable(z) ? { ...z, fills: [] } : z)),
  };
  const setFill = (zi: number, layer: string, polys: Vec2[][]): void => {
    const zones = [...working.zones];
    const z = zones[zi]!;
    const fills = z.fills.filter((f) => f.layer !== layer);
    fills.push({ layer, polys });
    zones[zi] = { ...z, fills };
    working = { ...working, zones };
  };

  interface Item {
    zone: number;
    layer: string;
  }
  const toFill: Item[] = [];
  working.zones.forEach((z, zi) => {
    if (!pourable(z)) return;
    for (const layer of z.layers) if (isCopper(layer)) toFill.push({ zone: zi, layer });
  });

  // `zone_fill_dependency( aZone, aLayer, aOtherZone, true )`
  const dependsOn = (waiter: Item, dep: Item): boolean => {
    if (waiter.zone === dep.zone || waiter.layer !== dep.layer) return false;
    const z = working.zones[waiter.zone]!;
    const o = working.zones[dep.zone]!;
    if (o.ruleArea || !o.outline || o.outline.length <= 2) return false;
    if (!o.layers.includes(waiter.layer)) return false;
    if (higherPriority(z, o)) return false;
    if (o.net === z.net) return false;
    if (!boxesIntersect(boxInflate(zoneBox(z), worstClearance), zoneBox(o))) return false;
    // `aZone->Outline()->Collide( aOtherZone->Outline(), m_worstClearance )`
    return (
      shapeDist({ kind: 'poly', pts: z.outline!, r: 0 }, { kind: 'poly', pts: o.outline!, r: 0 }) <
      worstClearance
    );
  };

  const preKnockout = new Map<string, Polygon[]>();
  const keyOf = (it: Item): string => `${it.zone}:${it.layer}`;

  // `run_fill_waves`: Kahn's algorithm over the dependency DAG, the initial
  // wave in item order and every next wave in the order successors free up.
  const runWaves = (items: Item[], fillFn: (it: Item) => void, anyDeps: boolean): void => {
    const successors: number[][] = items.map(() => []);
    const inDegree: number[] = items.map(() => 0);
    if (anyDeps)
      for (let i = 0; i < items.length; i++)
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          if (dependsOn(items[j]!, items[i]!)) {
            successors[i]!.push(j);
            inDegree[j]!++;
          }
        }
    let wave: number[] = [];
    items.forEach((_, i) => {
      if (inDegree[i] === 0) wave.push(i);
    });
    while (wave.length) {
      for (const idx of wave) fillFn(items[idx]!);
      const next: number[] = [];
      for (const idx of wave)
        for (const succ of successors[idx]!) if (--inDegree[succ]! === 0) next.push(succ);
      wave = next;
    }
  };

  runWaves(
    toFill,
    (it) => {
      const parts = fillZoneParts(working, it.zone, opts, new Set([it.layer]));
      const part = parts.find((p) => p.layer === it.layer);
      if (!part) return;
      preKnockout.set(keyOf(it), part.preKnockout);
      setFill(it.zone, it.layer, part.polys);
    },
    true,
  );

  // "Now update the connectivity to check for isolated copper islands"
  const pouredZones = [...new Set(toFill.map((it) => it.zone))];
  const islandsMap = isolatedIslands(working, fillOutlinesOf(working, pouredZones));

  const removedIslandLayers = new Set<string>();
  const initiallyFullyIsolated = new Set<string>();
  for (const zi of pouredZones) {
    const z = working.zones[zi]!;
    const zoneIslands = islandsMap.get(zi) ?? new Map<string, number[]>();
    let allLayersFullyIsolated = true;
    for (const f of z.fills) {
      const isolated = zoneIslands.get(f.layer) ?? [];
      if (isolated.length === f.polys.length) initiallyFullyIsolated.add(`${zi}:${f.layer}`);
      else allLayersFullyIsolated = false;
    }
    if (allLayersFullyIsolated) continue;
    const after = removeIslandsOf(z, z.fills, zoneIslands, false);
    after.forEach((f, k) => {
      if (f.polys.length !== z.fills[k]!.polys.length) removedIslandLayers.add(`${zi}:${f.layer}`);
    });
    const zones = [...working.zones];
    zones[zi] = { ...z, fills: after };
    working = { ...working, zones };
  }

  // "Iterative refill: when islands are removed, overlapping zones may be able
  // to reclaim the freed space."
  const sameNetOverlapSeeds = new Set<string>();
  for (const zi of pouredZones) {
    const lower = working.zones[zi]!;
    working.zones.forEach((higher, hi) => {
      if (hi === zi || higher.ruleArea || higher.teardropType) return;
      if (higher.net !== lower.net) return;
      if ((higher.priority ?? 0) <= (lower.priority ?? 0)) return;
      if (!boxesIntersect(zoneBox(lower), zoneBox(higher))) return;
      for (const layer of lower.layers) {
        if (!isCopper(layer) || !higher.layers.includes(layer)) continue;
        const lf = lower.fills.find((f) => f.layer === layer);
        const hf = higher.fills.find((f) => f.layer === layer);
        if (lf && lf.polys.length > 0 && hf && hf.polys.length > 0)
          sameNetOverlapSeeds.add(`${zi}:${layer}`);
      }
    });
  }

  let changed = new Set<string>([...removedIslandLayers, ...sameNetOverlapSeeds]);
  const maxIterations = 8;
  for (let iteration = 0; iteration < maxIterations && changed.size > 0; ++iteration) {
    const zonesToRefill: Item[] = [];
    const seen = new Set<string>();
    for (const key of changed) {
      const [czStr, changedLayer] = key.split(':') as [string, string];
      const czi = Number(czStr);
      const changedZone = working.zones[czi]!;
      const bbox = boxInflate(zoneBox(changedZone), worstClearance);
      for (const zi of pouredZones) {
        const z = working.zones[zi]!;
        if (!z.layers.includes(changedLayer)) continue;
        if (zi !== czi && !higherPriority(changedZone, z) && changedZone.net !== z.net) continue;
        if (!boxesIntersect(zoneBox(z), bbox)) continue;
        const k = `${zi}:${changedLayer}`;
        if (!seen.has(k)) {
          seen.add(k);
          zonesToRefill.push({ zone: zi, layer: changedLayer });
        }
      }
    }
    if (zonesToRefill.length === 0) break;

    const before = new Map<string, string>();
    for (const it of zonesToRefill)
      before.set(
        keyOf(it),
        fillHash(working.zones[it.zone]!.fills.find((f) => f.layer === it.layer)?.polys ?? []),
      );

    // "Snapshot fills before the wave": every refill reads the higher zones'
    // fills as they stood here.
    const snapshot = working;

    // `refillZoneFromCache`
    const refill = (it: Item): void => {
      const cached = preKnockout.get(keyOf(it));
      if (!cached) return;
      const zone = snapshot.zones[it.zone]!;
      const box = boxInflate(zoneBox(zone), worstClearance + EXTRA_CLEARANCE);
      const diffNet: Polygon[] = [];
      const sameNet: Polygon[] = [];
      snapshot.zones.forEach((other, oi) => {
        if (oi === it.zone || !other.layers.includes(it.layer)) return;
        if (other.teardropType && other.net === zone.net) return;
        if (!higherPriority(other, zone)) return;
        if (!boxesIntersect(zoneBox(other), box)) return;
        const fill = other.fills.find((f) => f.layer === it.layer);
        if (!fill || fill.polys.length === 0) return;
        if (other.net === zone.net) {
          for (const ring of fill.polys) sameNet.push([ring]);
        } else {
          const gap = Math.max(clearanceOf(zone, other.net), other.clearance ?? 0);
          if (gap < 0) return;
          diffNet.push(...inflateFractured(fill.polys, gap + EXTRA_CLEARANCE + maxError, maxError));
        }
      });
      let polys = cached;
      if (diffNet.length > 0) {
        polys = booleanSubtract(polys, diffNet);
        polys = postKnockoutMinWidthPrune(polys, zone, maxError);
      }
      if (sameNet.length > 0) polys = booleanSubtract(polys, sameNet);
      setFill(it.zone, it.layer, fracture(polys));
    };
    runWaves(zonesToRefill, refill, false);

    // "Island detection on the refilled zones only."
    const refilledZones = [...new Set(zonesToRefill.map((it) => it.zone))];
    const refillIslands = isolatedIslands(working, fillOutlinesOf(working, refilledZones));
    for (const zi of refilledZones) {
      const z = working.zones[zi]!;
      const zoneIslands = refillIslands.get(zi) ?? new Map<string, number[]>();
      const layersHere = new Set(
        zonesToRefill.filter((it) => it.zone === zi).map((it) => it.layer),
      );
      const after = z.fills.map((f) => {
        if (!layersHere.has(f.layer)) return f;
        return removeIslandsOf(
          z,
          [f],
          zoneIslands,
          initiallyFullyIsolated.has(`${zi}:${f.layer}`),
        )[0]!;
      });
      const zones = [...working.zones];
      zones[zi] = { ...z, fills: after };
      working = { ...working, zones };
    }

    // "Convergence check"
    const next = new Set<string>();
    for (const it of zonesToRefill) {
      const now = fillHash(
        working.zones[it.zone]!.fills.find((f) => f.layer === it.layer)?.polys ?? [],
      );
      if (now !== before.get(keyOf(it))) next.add(keyOf(it));
    }
    changed = next;
  }

  // "Now remove islands which are either outside the board edge or fail to
  // meet the minimum area requirements": an outline of at least 3 ×
  // min-thickness² whose intersection with the board outline is under half
  // its area goes.
  // `GetBoardPolygonOutlines( m_boardOutline, aInferOutlineIfNecessary = true )`:
  // when the edges do not close, `m_brdOutlinesValid` is false (so the pour
  // was not clipped to them) but `m_boardOutline` still holds the inferred
  // rectangle — the Edge.Cuts bounding box, or the board's — and it is THAT
  // this pass measures against.
  const brd = getBoardPolygonOutlines(working);
  let boardOutline: Polygon[] = brd.polygons.map((poly) => [poly.outline, ...poly.holes]);
  if (!brd.success || boardOutline.length === 0) {
    const edgePts: Vec2[] = [];
    for (const sh of [...working.shapes, ...working.footprints.flatMap((f) => f.shapes ?? [])])
      if (sh.layer === 'Edge.Cuts')
        for (const pt of [sh.start, sh.end, sh.center, sh.mid, ...(sh.pts ?? [])])
          if (pt) edgePts.push(pt);
    let bb = edgePts.length ? boxOf(edgePts) : { x0: 0, y0: 0, x1: 0, y1: 0 };
    if (bb.x1 - bb.x0 === 0 || bb.y1 - bb.y0 === 0) {
      const all: Vec2[] = [];
      for (const z of working.zones) all.push(...(z.outline ?? []));
      for (const t of working.tracks) all.push(t.start, t.end);
      for (const v of working.vias) all.push(v.at);
      for (const fp of working.footprints) for (const pad of fp.pads) all.push(pad.at);
      if (all.length) bb = boxOf(all);
    }
    if (bb.x1 - bb.x0 === 0 || bb.y1 - bb.y0 === 0) bb = boxInflate(bb, mmToIU(1.0));
    boardOutline = [
      [
        [
          { x: bb.x0, y: bb.y0 },
          { x: bb.x0, y: bb.y1 },
          { x: bb.x1, y: bb.y1 },
          { x: bb.x1, y: bb.y0 },
        ],
      ],
    ];
  }
  for (const zi of pouredZones) {
    const z = working.zones[zi]!;
    const minArea = (z.minThickness ?? 0) * (z.minThickness ?? 0) * 3;
    const fills = z.fills.map((f) => ({
      layer: f.layer,
      polys: f.polys.filter((ring) => {
        const islandArea = Math.abs(ringArea(ring));
        if (islandArea < minArea) return true;
        const intersection = booleanIntersection(boardOutline, [[ring]]);
        return polysArea(intersection) >= islandArea / 2.0;
      }),
    }));
    // A layer with no copper writes no `(filled_polygon …)`, so it has no
    // entry, as a board read back would not; and `zone->SetIsFilled( true )`
    // is unconditional — a zone saved `(fill no …)` is poured all the same.
    const nonEmpty = fills.filter((f) => f.polys.length > 0);
    const zones = [...working.zones];
    zones[zi] = { ...z, filled: true, fills: nonEmpty, source: withFilledPolygons(z, nonEmpty) };
    working = { ...working, zones };
  }
  return working;
}

/** `ZONE::BuildHashValue`'s purpose: does the fill differ? A structural key. */
function fillHash(polys: Vec2[][]): string {
  let h = 0;
  let n = 0;
  for (const r of polys)
    for (const p of r) {
      h = (h * 31 + p.x) % 2147483647;
      h = (h * 31 + p.y) % 2147483647;
      n++;
    }
  return `${polys.length}:${n}:${h}`;
}

/** `SHAPE_POLY_SET::Area` — outlines less holes. */
function polysArea(polys: Polygon[]): number {
  let a = 0;
  for (const poly of polys)
    poly.forEach((ring, i) => (a += (i === 0 ? 1 : -1) * Math.abs(ringArea(ring))));
  return a;
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
 * `ZONE_FILLER::addHatchFillTypeOnZone` (zone_filler.cpp:3826-4053): cut a
 * grid of holes out of the DEFLATED fill so only its webbing is left.
 *
 * The grid pitch is the web thickness plus the gap; each hole is a square of
 * `gap + minThickness`, optionally chamfered (level 1) or filleted (level 2+)
 * by half the gap scaled by the smoothing value. The holes are clipped to the
 * fill deflated by what the web thickness exceeds the minimum by, and to the
 * zone outline deflated by the minimum thickness, and any hole left smaller
 * than `hatchHoleMinArea` of a full one is dropped.
 *
 * `maxError` is a LOCAL upstream reassigns while smoothing the hole, and the
 * reassigned value is what the two deflates below then use.
 *
 * The per-layer `hatching_offset` shifts the whole grid — the Board Setup >
 * Zone Hatch Offsets page's value for this layer, or the zone's own override.
 *
 * Not ported: the thermal-ring protection of a hatched zone's thermal pads
 * (`aThermalRings`, from `buildHatchZoneThermalRings`).
 */
function addHatchFillTypeOnZone(
  fill: Polygon[],
  zone: PcbZone,
  boardMaxError: number,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): Polygon[] {
  // obviously line thickness must be > zone min thickness.
  const thickness = Math.max(zone.hatchThickness ?? 0, (zone.minThickness ?? 0) + mmToIU(0.001));
  const gridsize = thickness + (zone.hatchGap ?? 0);
  let maxError = boardMaxError;
  if (gridsize <= 0) return fill;

  const orientation = new EDA_ANGLE(zone.hatchOrientation ?? 0);
  const minus = new EDA_ANGLE(-orientation.AsDegrees());

  // Use a area that contains the rotated bbox by orientation
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const poly of fill)
    for (const ring of poly)
      for (const pt of ring) {
        const r = orientation.IsZero() ? pt : RotatePoint(pt, minus);
        if (r.x < x0) x0 = r.x;
        if (r.y < y0) y0 = r.y;
        if (r.x > x1) x1 = r.x;
        if (r.y > y1) y1 = r.y;
      }
  if (!Number.isFinite(x0)) return fill;

  // Build hole shape
  const hole_size = (zone.hatchGap ?? 0) + (zone.minThickness ?? 0);
  let hole_base: Vec2[] = [
    { x: 0, y: 0 },
    { x: hole_size, y: 0 },
    { x: hole_size, y: hole_size },
    { x: 0, y: hole_size },
  ];

  // Calculate minimal area of a grid hole.
  const minimal_hole_area = Math.abs(chainArea(hole_base)) * (zone.hatchHoleMinArea ?? 0.3);

  // Now convert this hole to a smoothed shape:
  if ((zone.hatchSmoothingLevel ?? 0) > 0) {
    let smooth_value = KiROUND(((zone.hatchGap ?? 0) * (zone.hatchSmoothingValue ?? 0)) / 2);
    const SMOOTH_MIN_VAL_MM = 0.02;
    const SMOOTH_SMALL_VAL_MM = 0.04;

    if (smooth_value > mmToIU(SMOOTH_MIN_VAL_MM)) {
      let smooth_level = zone.hatchSmoothingLevel ?? 0;
      if (smooth_value < mmToIU(SMOOTH_SMALL_VAL_MM) && smooth_level > 1) smooth_level = 1;

      // Use a larger smooth_value to compensate the outline tickness
      smooth_value += Math.trunc((zone.minThickness ?? 0) / 2);
      // smooth_value cannot be bigger than the half size oh the hole:
      smooth_value = Math.min(smooth_value, Math.trunc((zone.hatchGap ?? 0) / 2));
      // the error to approximate a circle by segments when smoothing corners by a arc
      maxError = Math.max(maxError * 2, Math.trunc(smooth_value / 20));

      switch (smooth_level) {
        case 1:
          hole_base = chamfer([[hole_base]], smooth_value)[0]![0]!;
          break;
        case 0:
          break;
        default:
          if ((zone.hatchSmoothingLevel ?? 0) > 2) maxError = Math.trunc(maxError / 2); // Force better smoothing
          hole_base = fillet([[hole_base]], smooth_value, maxError)[0]![0]!;
          break;
      }
    }
  }

  // Build holes
  const holes: Polygon[] = [];
  const x_offset = x0 - (x0 % gridsize) - gridsize;
  const y_offset = y0 - (y0 % gridsize) - gridsize;
  const shift = { x: offset.x % gridsize, y: offset.y % gridsize };

  for (let xx = x_offset; xx <= x1; xx += gridsize) {
    for (let yy = y_offset; yy <= y1; yy += gridsize) {
      const hole = hole_base.map((p) => {
        let q: Vec2 = { x: p.x + xx, y: p.y + yy };
        if (!orientation.IsZero()) q = RotatePoint(q, orientation);
        return { x: q.x + shift.x, y: q.y + shift.y };
      });
      holes.push([hole]);
    }
  }

  // Don't let thickness drop below maxError * 2 or it might not get reinflated.
  const deflated_thickness = Math.max(
    (zone.hatchThickness ?? 0) - (zone.minThickness ?? 0),
    maxError * 2,
  );

  // The fill has already been deflated to ensure GetMinThickness() so we just
  // have to account for anything beyond that.
  const deflatedFilledPolys = inflateKi(
    fill,
    -deflated_thickness,
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  let clipped = booleanIntersection(holes, deflatedFilledPolys);

  const deflatedOutline = inflateKi(
    [[zone.outline!.map((p) => ({ x: p.x, y: p.y }))]],
    -(zone.minThickness ?? 0),
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  clipped = booleanIntersection(clipped, deflatedOutline);

  // Now filter truncated holes to avoid small holes in pattern
  clipped = clipped.filter((poly) => Math.abs(chainArea(poly[0]!)) >= minimal_hole_area);

  // create grid. Useto generate strictly simple polygons needed by Gerber
  // files and Fracture()
  return booleanSubtract(fill, clipped);
}

/** `SHAPE_LINE_CHAIN::Area( true )`. */
function chainArea(ring: Vec2[]): number {
  let area = 0.0;
  const size = ring.length;
  for (let i = 0, j = size - 1; i < size; ++i) {
    area += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
    j = i;
  }
  return Math.abs(area * 0.5);
}

/** Twice the signed area of a ring, halved: the enclosed area. */
function ringArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);
  return a / 2;
}

/**
 * `ZONE::BuildSmoothedPoly( aSmoothedPoly, aLayer, aBoardOutline,
 * aSmoothedPolyWithApron )` (zone.cpp:1470-1627), both of its answers:
 *
 * - `maxExtents` is `aSmoothedPoly`: the outline, unioned with every
 *   colliding same-net zone (so a corner shared with one is not smoothed
 *   into a divot), clipped to the board, smoothed, and clipped back to the
 *   flattened outline.
 * - `smoothed` is `aSmoothedPolyWithApron`, which is what `fillCopperZone`
 *   STARTS from: the smoothed poly clipped to the outline inflated by the
 *   minimum thickness within the same-net envelope — "we pre-inflate the
 *   contour by the min-thickness within the same-net-intersecting-zones
 *   envelope" so the deflate/inflate cycle cannot dig divots at a same-net
 *   border either. The final `BooleanIntersection( aMaxExtents )` takes the
 *   apron off again.
 *
 * `m_ZoneKeepExternalFillets` is false on every board this reads
 * (board_design_settings.cpp:215; the setting has no UI), so that branch is
 * not taken.
 */
function buildSmoothedPoly(
  board: Board,
  zoneIndex: number,
  layer: string,
  boardOutline: Geom | null,
  maxError: number,
): { smoothed: Polygon[]; maxExtents: Polygon[] } {
  const zone = board.zones[zoneIndex]!;
  const flattened: Polygon[] = [[zone.outline!.map((p) => ({ x: p.x, y: p.y }))]];
  if (zone.ruleArea) return { smoothed: flattened, maxExtents: flattened };

  const mode = zone.cornerSmoothing ?? 'none';
  const radius = zone.cornerRadius ?? 0;
  const smoothRequested =
    (mode === 'chamfer' || mode === 'fillet') && zone.teardropType === undefined;

  const smooth = (polys: Polygon[]): Polygon[] => {
    if (!smoothRequested) return polys;
    return mode === 'chamfer' ? chamfer(polys, radius) : fillet(polys, radius, maxError);
  };

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
      const grown = inflate([[zone.outline!]], epsilon, CornerStrategy.ROUND_ALL_CORNERS);
      if (grown.length > 0 && booleanIntersection(grown, [[other.outline]]).length > 0)
        sameNet.push(other);
    } else {
      diffNet.push(other);
    }
  });

  let smoothedPoly: Polygon[] = flattened;

  for (const neighbour of sameNet) {
    // "The same-net intersecting zone *might* get knocked out along the
    // border by a higher-priority, different-net zone" — and if those enclose
    // THIS zone completely, the neighbour is not really adjoining it.
    const nBox = boxOf(neighbour.outline!);
    let diffNetPoly: Polygon[] = [];
    for (const d of diffNet)
      if (higherPriority(d, neighbour) && boxesIntersect(boxOf(d.outline!), nBox))
        diffNetPoly = booleanAdd(diffNetPoly, [[d.outline!]]);
    let isolated = false;
    if (diffNetPoly.length > 0) isolated = booleanSubtract(flattened, diffNetPoly).length === 0;
    if (!isolated) smoothedPoly = booleanAdd(smoothedPoly, [[neighbour.outline!]]);
  }

  if (boardOutline) smoothedPoly = booleanIntersection(smoothedPoly, asPolys(boardOutline));

  const withSameNetIntersectingZones = smoothedPoly;

  smoothedPoly = smooth(smoothedPoly);

  // The apron.
  let poly = inflateKi(
    flattened,
    zone.minThickness ?? 0,
    CornerStrategy.ROUND_ALL_CORNERS,
    maxError,
  );
  poly = booleanIntersection(poly, withSameNetIntersectingZones);
  const smoothed = booleanIntersection(smoothedPoly, poly);

  const maxExtents = booleanIntersection(smoothedPoly, flattened);

  return { smoothed, maxExtents };
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
function spokeTestAreas(
  fill: Polygon[],
  zone: PcbZone,
  maxError: number,
  stage: (name: string, polys: Polygon[]) => void = () => {},
): Polygon[] {
  const halfMinWidth = Math.trunc((zone.minThickness ?? 0) / 2);
  const epsilon = mmToIU(0.001);
  if (halfMinWidth - epsilon <= epsilon) return fill;

  let testAreas = inflateKi(
    fill,
    -(halfMinWidth - epsilon),
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  stage('spoke-test-deflated', testAreas);
  testAreas = inflateKi(
    testAreas,
    halfMinWidth - epsilon,
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  stage('spoke-test-reinflated', testAreas);
  return testAreas;
}

/**
 * `ZONE_FILLER::connect_nearby_polys` (zone_filler.cpp:2712-2757) and the
 * `VERTEX_CONNECTOR` it runs on (:94-230), over kimath's `VERTEX_SET`.
 *
 * The deflate that prunes anything thinner than the minimum width also
 * severs every NECK thinner than it, and a severed neck is not what the
 * user drew: two pieces of copper that were one. So, in the deflated state,
 * upstream looks for pairs of convex vertices on different outlines (or far
 * apart along the same one) within `minThickness` of each other, and joins
 * them with a zero-width spike — `line.Insert( vertex + 1, pt1 );
 * line.Insert( vertex + 1, pt2 )` on the first outline — that the round
 * re-inflate turns into a bar one minimum thickness wide.
 *
 * The search is upstream's own: the vertices are threaded onto ONE circular
 * list in outline order, simplified at `m_TriangulateSimplificationLevel`
 * (50 units, squared), Morton-sorted, and a candidate is looked for by
 * walking that z-order both ways within the ±distance box — which is what
 * decides between two candidates at the same distance.
 */
function connectNearbyPolys(rings: Vec2[][], distance: number): Vec2[][] {
  if (rings.length < 1) return rings;

  // `VERTEX_SET( ADVANCED_CFG::GetCfg().m_TriangulateSimplificationLevel )`
  const vs = new VertexSet(50);
  // `aPolys.BBoxFromCaches()`
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const r of rings)
    for (const p of r) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  vs.setBoundingBox({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });

  const outlineDistances: number[][] = [];
  let tail: Vertex | null = null;
  rings.forEach((outline, i) => {
    const distances: number[] = [0.0];
    for (let j = 0; j < outline.length; j++) {
      const a = outline[j]!;
      const b = outline[(j + 1) % outline.length]!;
      distances.push(
        distances[distances.length - 1]! + EuclideanNormI({ x: b.x - a.x, y: b.y - a.y }),
      );
    }
    outlineDistances.push(distances);
    tail = vs.createList(outline, tail, i);
  });
  if (tail) (tail as Vertex).updateList();
  if (vs.vertices.length === 0) return rings;

  const limit2 = distance * distance;
  const getPoint = (aPt: Vertex): Vertex | null => {
    // z-order range for the current point ± limit bounding box
    const maxZ = vs.zOrder(aPt.x + distance, aPt.y + distance);
    const minZ = vs.zOrder(aPt.x - distance, aPt.y - distance);

    let min_dist = Number.POSITIVE_INFINITY;
    let retval: Vertex | null = null;

    const check_pt = (p: Vertex): void => {
      // A nearby point along the same contour is already connected and would
      // consume the visited-point suppression before a contour-distant point
      // across a neck is considered.
      if (p.userData === aPt.userData) {
        const distances = outlineDistances[p.userData]!;
        const directDistance = Math.abs(distances[p.i]! - distances[aPt.i]!);
        const contourDistance = Math.min(
          directDistance,
          distances[distances.length - 1]! - directDistance,
        );
        if (contourDistance < distance) return;
      }
      const dx = p.x - aPt.x;
      const dy = p.y - aPt.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > 0 && dist2 < limit2 && dist2 < min_dist && p.isEar(true)) {
        min_dist = dist2;
        retval = p;
      }
    };

    let p = aPt.nextZ;
    while (p && p.z <= maxZ) {
      check_pt(p);
      p = p.nextZ;
    }
    p = aPt.prevZ;
    while (p && p.z >= minZ) {
      check_pt(p);
      p = p.prevZ;
    }
    return retval;
  };

  // `FindResults`
  const front = vs.vertices[0]!;
  const visited = new Set<Vertex>();
  const seen = new Set<string>();
  const results: { o1: number; o2: number; v1: number; v2: number }[] = [];
  let p = front.next;
  while (p !== front) {
    // Skip points that are concave
    if (!p.isEar()) {
      p = p.next;
      continue;
    }
    const q = visited.has(p) ? null : getPoint(p);
    if (q) {
      visited.add(p);
      const key = `${p.userData},${q.userData},${p.i},${q.i}`;
      if (!visited.has(q) && !seen.has(key)) {
        seen.add(key);
        results.push({ o1: p.userData, o2: q.userData, v1: p.i, v2: q.i });
        // We don't want to connect multiple points in the same vicinity, so
        // skip 2 points before and after each point and match.
        visited.add(p.prev);
        visited.add(p.prev.prev);
        visited.add(p.next);
        visited.add(p.next.next);
        visited.add(q.prev);
        visited.add(q.prev.prev);
        visited.add(q.next);
        visited.add(q.next.next);
        visited.add(q);
      }
    }
    p = p.next;
  }
  if (results.length === 0) return rings;

  // `std::set<RESULTS>` iterates in (outline1, outline2, vertex1, vertex2) order.
  results.sort((a, b) => a.o1 - b.o1 || a.o2 - b.o2 || a.v1 - b.v1 || a.v2 - b.v2);
  const insertions = new Map<number, { vertex: number; pt: Vec2 }[]>();
  for (const r of results) {
    const pt1 = rings[r.o1]![r.v1]!;
    const pt2 = rings[r.o2]![r.v2]!;
    const list = insertions.get(r.o1) ?? [];
    // "insert the existing point first so that we can place the new point
    // between the two points at the same location"
    list.push({ vertex: r.v1, pt: pt1 }, { vertex: r.v1, pt: pt2 });
    insertions.set(r.o1, list);
  }

  const out = rings.map((r) => [...r]);
  for (const [outline, vertices] of insertions) {
    // "Stable sort here because we want to make sure that we are inserting
    // pt1 first and pt2 second but still sorting the rest of the indices
    // from highest to lowest."
    const sorted = vertices
      .map((v, k) => ({ ...v, k }))
      .sort((a, b) => b.vertex - a.vertex || a.k - b.k);
    const line = out[outline]!;
    for (const { vertex, pt } of sorted) {
      // `SHAPE_LINE_CHAIN::Insert( aVertex, aP )`: past the end it is an
      // `Append`, which drops a point equal to the last one.
      if (vertex + 1 === line.length) {
        const l = line[line.length - 1]!;
        if (l.x !== pt.x || l.y !== pt.y) line.push({ x: pt.x, y: pt.y });
      } else line.splice(vertex + 1, 0, { x: pt.x, y: pt.y });
    }
  }
  return out;
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
 * `ZONE_FILLER::postKnockoutMinWidthPrune` (zone_filler.cpp:2757-2796): the
 * min-width cycle run again after a different-net zone knockout — deflate
 * (CHAMFER), fracture, connect nearby polys, cull the blobs, re-inflate
 * (ROUND, the second union), and clip back to what it started from.
 */
function postKnockoutMinWidthPrune(fill: Polygon[], zone: PcbZone, maxError: number): Polygon[] {
  const half_min_width = Math.trunc((zone.minThickness ?? 0) / 2);
  const epsilon = mmToIU(0.001);
  if (half_min_width - epsilon <= epsilon) return fill;

  const preDeflate = fill;
  let polys = inflateKi(
    fill,
    -(half_min_width - epsilon),
    CornerStrategy.CHAMFER_ALL_CORNERS,
    maxError,
  );
  polys = connectNearbyPolys(fracture(polys), zone.minThickness ?? 0).map((ring) => [ring]);
  polys = polys.filter((poly) => islandExtentMax(poly) >= (zone.minThickness ?? 0));
  polys = inflateKi(
    polys,
    half_min_width - epsilon,
    CornerStrategy.ROUND_ALL_CORNERS,
    maxError,
    true,
  );
  return booleanIntersection(polys, preDeflate);
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
