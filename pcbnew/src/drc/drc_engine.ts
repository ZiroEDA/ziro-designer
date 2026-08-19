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
 *   - drc_test_provider_library_parity (lib_footprint_issues,
 *     lib_footprint_mismatch; see drc_library_parity.ts)
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

import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { chainIntersectChain } from '@ziroeda/kimath/src/geometry/seg.js';
import { segIntersect } from '@ziroeda/kimath/src/geometry/seg.js';
import type { NETLIST } from '../netlist_reader/pcb_netlist.js';
import { buildRatsnest } from '../ratsnest.js';
import { shapeToPolygon } from '../zone_filler.js';
import type { Geom } from 'polygon-clipping';
import { booleanAdd, type Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { shapeAsPolygon } from '../polygon_booleans.js';
import { findSliverPoints } from './drc_sliver.js';
import { findNecks } from './drc_connection_width.js';
import { evaluateDiffPair, matchDpSuffix, type DpTrack } from './drc_diff_pair.js';
import { creepageDistance } from './drc_creepage.js';
import { checkLibraryParity, type LibraryParityOptions } from './drc_library_parity.js';
import { boardEdgeShapes, boardSurface, copperShapesByNet } from './creepage_shapes.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import {
  allowsMissingCourtyard,
  buildCourtyard,
  chainOutlines,
  shapePoints,
} from '../courtyard.js';
import type {
  Board,
  PadPrimitive,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbVia,
  PcbZone,
} from '../types.js';
import {
  areaOutline,
  areasMatching,
  DRC_EPSILON,
  shapesEnclosedByArea,
  shapesIntersectArea,
} from './drc_areas.js';
import { type Shape, segSeg as segSegDist, shapeBBox, shapeDist } from './drc_geometry.js';
import type { DrcConstraintType, DrcDisallow, DrcRule, DrcRuleSet, MinOptMax } from './drc_rule.js';
import {
  buildDrcRuleEngine,
  collectAssertions,
  evalDrcRules,
  type DrcEvalItem,
  type DrcItemType,
} from './drc_rules_engine.js';

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
  /**
   * rules.min_resolved_spokes, Board Setup's "minimum thermal relief spoke
   * count". Zero turns the starved-thermal check off; the default is 2.
   */
  minResolvedSpokes?: number;
  /**
   * rules.min_silk_clearance (IU), Board Setup's silkscreen clearance. Used
   * for silk against the board edge; a negative value turns that off, as
   * upstream's `minClearance < 0` gate does.
   */
  minSilkClearance?: number;
  /**
   * The schematic netlist, for the PCB-to-schematic parity checks. Absent
   * means no schematic to compare against, and those checks do not run —
   * which is upstream's behaviour when no netlist is supplied.
   */
  netlist?: NETLIST;
  /**
   * The footprint libraries, for the library-parity checks. Absent means no
   * project is loaded and those checks do not run — upstream's `if( !project )`
   * "skipping library parity tests" bail, taken before any library is touched.
   */
  libraries?: LibraryParityOptions;
  /**
   * rules.min_copper_edge_clearance (IU), Board Setup's "copper to edge".
   * Absent means zero, i.e. copper may touch the board edge but not cross it;
   * a negative value turns the check off, as upstream's `minClearance >= 0`
   * gate does.
   */
  minCopperToEdge?: number;
  /**
   * rules.min_connection (IU), Board Setup's "minimum connection width". Zero
   * or absent turns the check off, which is also what upstream's default of 0
   * does — a board that has not set one is not asking for the test.
   */
  minConnectionWidth?: number;
  /**
   * `creepage` minimum (IU). Zero or absent turns the check off entirely, which
   * is also upstream's behaviour: `HasRulesForConstraintType( CREEPAGE_CONSTRAINT )`
   * gates the whole provider, so a board that has not asked for creepage never
   * pays for it. There is no sensible default — the required distance depends on
   * working voltage and pollution degree, which the board file does not record.
   */
  minCreepage?: number;
  /**
   * `diff_pair_gap` minimum (IU). Absent falls back to `minClearance`, which is
   * what upstream's implicit netclass rule sets it to.
   */
  diffPairGapMin?: number;
  /**
   * `diff_pair_gap` maximum (IU). Absent means no maximum — and that is the
   * default, because the implicit netclass rule sets only a min and an opt. A
   * board with nothing but netclasses never reports a gap for being *too wide*;
   * that needs a custom rule or a per-layer tuning entry.
   */
  diffPairGapMax?: number;
  /** `diff_pair_uncoupled` maximum (IU). Absent means the length is not checked. */
  diffPairMaxUncoupled?: number;
  /** Netclass clearance for a net code (IU); absent = 0 (the implicit
   *  netclass clearance rules of drc_engine.cpp). */
  clearanceOf?: (net: number) => number;
  /**
   * Parsed `.kicad_dru`. A matching user rule replaces the value the board
   * default and netclass would otherwise resolve to, which is upstream's
   * ordering: implicit rules load first, user rules after, last match wins.
   *
   * The board and netclass values still resolve by the existing path rather
   * than as implicit rules through the engine. That conversion is invisible to
   * a user — it produces the same numbers — so it is left for its own change.
   */
  customRules?: DrcRuleSet;
  /**
   * Netclass names for a net code, so `A.NetClass == '…'` can match. Without
   * it a rule keyed on netclass simply never fires.
   */
  netClassesOf?: (net: number) => readonly string[];
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

export function runDrc(board: Board, opts: DrcOptions): DrcViolation[] {
  const out: DrcViolation[] = [];
  const clearanceOf = opts.clearanceOf ?? (() => 0);

  // The board and netclass *values* still come from the path below, so a
  // numeric match in the engine means "a custom rule overrides them". Rule
  // areas are the one implicit source loaded here, because a keepout has no
  // other way to be expressed.
  const implicitRules = ruleAreaRules(board);
  const ruleEngine =
    opts.customRules || implicitRules.length > 0
      ? buildDrcRuleEngine(implicitRules, opts.customRules ?? { version: 0, rules: [], errors: [] })
      : undefined;
  const netClassesOf = opts.netClassesOf ?? (() => []);

  /**
   * `A.intersectsArea('x')` and friends. The selector names zones by uuid or by
   * wildcard name; the caller-side geometry lives in drc_areas.ts.
   */
  const areaTest =
    (shapes: readonly Shape[], itemLayers: readonly string[]) =>
    (fn: string, fnArgs: string[]): boolean | undefined => {
      const name = fn.toLowerCase();
      // insideArea is upstream's deprecated spelling of intersectsArea, and
      // resolves to the same function — not to enclosure.
      const wantsEnclosure = name === 'enclosedbyarea';
      if (!wantsEnclosure && name !== 'intersectsarea' && name !== 'insidearea') return undefined;

      const selector = fnArgs[0];
      if (selector === undefined) return false;

      // `#N` is our own fallback for a zone that has no uuid yet — see
      // ruleAreaRules. It cannot collide with a uuid or a zone name.
      const byIndex = /^#(\d+)$/.exec(selector);
      const candidates = byIndex
        ? [board.zones[Number(byIndex[1])]].filter((z) => z !== undefined)
        : areasMatching(board.zones, selector);

      for (const area of candidates) {
        // An area never collides with itself, and shares a layer or it cannot
        // be reached at all.
        if (!area.layers.some((l) => itemLayers.includes(l))) continue;

        const outline = areaOutline(area);
        if (!outline) continue;

        if (
          wantsEnclosure
            ? shapesEnclosedByArea(shapes, outline)
            : shapesIntersectArea(shapes, outline)
        )
          return true;
      }

      return false;
    };

  const evalItem = (
    type: DrcItemType,
    net: number,
    layer: string | undefined,
    props?: Record<string, number | string>,
  ): DrcEvalItem => ({
    type,
    layer,
    netName: board.nets.get(net),
    netClasses: [...netClassesOf(net)],
    props,
  });

  /**
   * The value a custom rule resolves for this constraint, or undefined when
   * none matched. Callers fall back to their existing board/netclass value.
   */
  const customValue = (
    type: DrcConstraintType,
    a: DrcEvalItem | undefined,
    b: DrcEvalItem | undefined,
    layer?: string,
  ): { value: MinOptMax; rule: DrcRule } | undefined => {
    if (!ruleEngine) return undefined;
    const r = evalDrcRules(ruleEngine, type, a, b, layer);
    return r.rule ? { value: r.value, rule: r.rule } : undefined;
  };

  /** " (rule 'name')" for a message, so a custom limit says where it came from. */
  const ruleNote = (rule: DrcRule | undefined): string => (rule ? ` (rule '${rule.name}')` : '');
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
      track: { a: t.start, b: t.end },
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
          zone: z,
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
        const base = Math.max(opts.minClearance, clearanceOf(A.it.net), clearanceOf(B.it.net));
        const custom = customValue(
          'clearance',
          evalItem('Track', A.it.net, A.it.layer),
          evalItem('Track', B.it.net, B.it.layer),
          A.it.layer,
        );
        const required = custom?.value.min ?? base;
        if (required <= 0) continue;
        if (B.box.minY > A.box.maxY + required || A.box.minY > B.box.maxY + required) continue;

        // Two crossing tracks are their own violation, tested before the
        // clearance and reported instead of it: the centrelines actually
        // intersect, so "how close are they" is not the useful question.
        if (A.it.track && B.it.track) {
          const at = segIntersect(A.it.track, B.it.track);
          if (at) {
            out.push({
              code: 'tracks_crossing',
              message: 'Tracks crossing',
              pos: at,
              items: [
                { desc: A.it.desc, pos: A.it.pos },
                { desc: B.it.desc, pos: B.it.pos },
              ],
            });
            continue;
          }
        }

        const gap = shapeDist(A.it.shape, B.it.shape);
        if (gap >= required) continue;

        // Copper of two nets actually touching is a short, not a spacing
        // problem, and upstream says so in its own marker.
        if (gap === 0) {
          out.push({
            code: 'shorting_items',
            message: `Items shorting two nets (nets ${netName(A.it.net)} and ${netName(B.it.net)})`,
            pos: A.it.pos,
            items: [
              { desc: A.it.desc, pos: A.it.pos },
              { desc: B.it.desc, pos: B.it.pos },
            ],
          });
          continue;
        }

        out.push({
          code: 'clearance',
          message: `Clearance violation (clearance ${mm(required)}${ruleNote(custom?.rule)}; actual ${mm(gap)})`,
          pos: A.it.pos,
          items: [
            { desc: A.it.desc, pos: A.it.pos },
            { desc: B.it.desc, pos: B.it.pos },
          ],
        });
      }
    }
  }

  // ----- track_width -------------------------------------------------------
  // No board-default gate here any more: a rule can set a *maximum* even when
  // Board Setup's minimum is zero, so every track has to be looked at.
  for (const t of [...board.tracks, ...board.arcs]) {
    const custom = customValue(
      'track_width',
      evalItem('Track', t.net, t.layer, { Width: t.width }),
      undefined,
      t.layer,
    );
    const min = custom?.value.min ?? opts.minTrackWidth;
    const max = custom?.value.max;

    if (max !== undefined && t.width > max) {
      out.push({
        code: 'track_width',
        message: `Track width (max width ${mm(max)}${ruleNote(custom?.rule)}; actual ${mm(t.width)})`,
        pos: t.start,
        items: [{ desc: `Track [${netName(t.net)}] on ${t.layer}`, pos: t.start }],
      });
      continue;
    }

    if (min > 0 && t.width < min) {
      out.push({
        code: 'track_width',
        message: `Track width (min width ${mm(min)}${ruleNote(custom?.rule)}; actual ${mm(t.width)})`,
        pos: t.start,
        items: [{ desc: `Track [${netName(t.net)}] on ${t.layer}`, pos: t.start }],
      });
    }
  }

  // ----- via checks --------------------------------------------------------
  for (const v of vias) {
    const viaItem = evalItem('Via', v.net, v.layers[0]);
    const viaDia = customValue('via_diameter', viaItem, undefined, v.layers[0]);
    const minViaDiameter = viaDia?.value.min ?? opts.minViaDiameter;

    if (minViaDiameter > 0 && v.size < minViaDiameter) {
      out.push({
        code: 'via_diameter',
        message: `Via diameter (min diameter ${mm(minViaDiameter)}${ruleNote(viaDia?.rule)}; actual ${mm(v.size)})`,
        pos: v.at,
        items: [{ desc: `Via [${netName(v.net)}]`, pos: v.at }],
      });
    }
    const annulus = (v.size - v.drill) / 2;
    const annCustom = customValue('annular_width', viaItem, undefined, v.layers[0]);
    const minAnnulus = annCustom?.value.min ?? opts.minViaAnnulus;

    if (minAnnulus > 0 && annulus < minAnnulus) {
      out.push({
        code: 'annular_width',
        message: `Annular width (min annular width ${mm(minAnnulus)}${ruleNote(annCustom?.rule)}; actual ${mm(annulus)})`,
        pos: v.at,
        items: [{ desc: `Via [${netName(v.net)}]`, pos: v.at }],
      });
    }
    const holeCustom = customValue('hole_size', viaItem, undefined, v.layers[0]);
    const minHole = holeCustom?.value.min ?? opts.minThroughHole;
    const maxHole = holeCustom?.value.max;
    // A microvia's drill reports under its own code, so it can be given its own
    // severity — which is the whole reason upstream splits them.
    const holeCode = v.kind === 'micro' ? 'microvia_drill_out_of_range' : 'drill_out_of_range';

    if (minHole > 0 && v.drill < minHole) {
      out.push({
        code: holeCode,
        message: `Hole size out of range (min hole ${mm(minHole)}${ruleNote(holeCustom?.rule)}; actual ${mm(v.drill)})`,
        pos: v.at,
        items: [{ desc: `Via [${netName(v.net)}]`, pos: v.at }],
      });
    }

    // Only a rule can express a maximum drill.
    if (maxHole !== undefined && v.drill > maxHole) {
      out.push({
        code: holeCode,
        message: `Hole size out of range (max hole ${mm(maxHole)}${ruleNote(holeCustom?.rule)}; actual ${mm(v.drill)})`,
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

  // ----- copper to hole ----------------------------------------------------
  // The hole half of testSingleLayerItemAgainstItem. What separates it from
  // the copper clearance test is that it runs even at a clearance of zero,
  // "because the item cannot be inside (or intersect) the hole" — so with no
  // rule at all it still catches copper laid over someone else's drill.
  //
  // Same-net pairs are skipped, which is not obvious from the hole branch
  // itself: the RTree *filter* rejects them before the test is reached. Miss
  // that and every track entering its own through-hole pad is a violation.
  {
    // Sorted by minX so the scan below can stop early, as the clearance sweep
    // does. Without it this is copper × holes over the whole board.
    const holes = boardHoles(board, netName)
      .map((h) => ({ h, box: shapeBBox({ kind: 'stadium', a: h.a, b: h.b, r: h.width / 2 }) }))
      .sort((p, q) => p.box.minX - q.box.minX);
    // The widest clearance any rule can ask for, so the cheap box test below
    // can reject a pair before anything expensive runs.
    const hasHoleRules = ruleEngine?.byType.has('hole_clearance') ?? false;
    const maxHoleClearance = hasHoleRules
      ? (ruleEngine?.byType.get('hole_clearance') ?? []).reduce(
          (m, e) => Math.max(m, e.constraint.value.min ?? 0),
          0,
        )
      : 0;

    for (const [layer, items] of itemsByLayer) {
      for (const it of items) {
        const itBox = shapeBBox(it.shape);

        for (const { h, box } of holes) {
          if (box.minX > itBox.maxX + maxHoleClearance) break;

          // Same net, which also covers an item against its own hole: a pad's
          // copper always lies over its own drill.
          if (h.net === it.net) continue;

          // A via's hole only exists on the layers it spans.
          if (
            h.viaLayers &&
            !viaLayers({ layers: h.viaLayers } as PcbVia, copperOrder).includes(layer)
          )
            continue;

          // Box rejection first: evaluating the rule for every copper/hole
          // pair on a real board is the dominant cost otherwise.
          if (
            itBox.minX > box.maxX + maxHoleClearance ||
            box.minY > itBox.maxY + maxHoleClearance ||
            itBox.minY > box.maxY + maxHoleClearance
          )
            continue;

          // With no hole_clearance rule the limit is zero, and evaluating a
          // rule set that cannot match is the dominant cost on a real board —
          // it doubled the whole DRC run before this gate.
          const c = hasHoleRules
            ? customValue(
                'hole_clearance',
                evalItem('Via', it.net, layer),
                evalItem('Track', it.net, layer),
                layer,
              )
            : undefined;
          const required = Math.max(0, (c?.value.min ?? 0) - DRC_EPSILON);

          // Segment-to-shape: the hole carries a slot axis, so this follows a
          // milled oval as well as a round drill.
          const gap = Math.max(0, holeToShape(h, it.shape) - h.width / 2);

          if (gap > required) continue;
          if (required === 0 && gap > 0) continue;

          out.push({
            code: 'hole_clearance',
            message: `Hole clearance violation (clearance ${mm(c?.value.min ?? 0)}${ruleNote(c?.rule)}; actual ${mm(gap)})`,
            pos: h.c,
            items: [
              { desc: it.desc, pos: it.pos },
              { desc: h.desc, pos: h.c },
            ],
          });
        }
      }
    }
  }

  // ----- track segment length and angle ------------------------------------
  // Both are purely rule-driven: nothing in Board Setup expresses either, so
  // with no `.kicad_dru` neither runs at all.
  if (ruleEngine?.byType.has('track_segment_length')) {
    const lengths: { len: number; pos: Vec2; layer: string; net: number; desc: string }[] = [
      ...board.tracks.map((t) => ({
        len: Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y),
        // A straight track is marked at its midpoint, an arc at its start.
        pos: { x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 },
        layer: t.layer,
        net: t.net,
        desc: `Track [${netName(t.net)}] on ${t.layer}`,
      })),
      ...board.arcs.map((a) => {
        const s = arcShape(a.start, a.mid, a.end, a.width);
        return {
          // PCB_ARC::GetLength is the swept arc, not the chord.
          len:
            s.kind === 'arc'
              ? s.rad * Math.abs(s.sweep)
              : Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y),
          pos: a.start,
          layer: a.layer,
          net: a.net,
          desc: `Arc track [${netName(a.net)}] on ${a.layer}`,
        };
      }),
    ];

    for (const t of lengths) {
      const c = customValue(
        'track_segment_length',
        evalItem('Track', t.net, t.layer),
        undefined,
        t.layer,
      );
      if (!c) continue;

      if (c.value.min !== undefined && t.len < c.value.min)
        out.push(trackDim('min length', c.value.min, t.len, c.rule, t.desc, t.pos));
      if (c.value.max !== undefined && t.len > c.value.max)
        out.push(trackDim('max length', c.value.max, t.len, c.rule, t.desc, t.pos));
    }
  }

  if (ruleEngine?.byType.has('track_angle')) {
    const straight = board.tracks;

    for (let i = 0; i < straight.length; i++) {
      for (let j = i + 1; j < straight.length; j++) {
        const a = straight[i]!;
        const b = straight[j]!;

        // Upstream walks each track's *connected* tracks, which are same-net by
        // construction. One marker per pair: walking both directions would give
        // the same joint twice.
        if (a.layer !== b.layer || a.net !== b.net) continue;

        // `SEG::Intersect` resolves a collinear overlap to the midpoint of the
        // overlap region, so two segments meeting end-to-end already answer
        // here; `sharedEndpoint` remains for the pairs that miss entirely, which
        // is what makes a straight-through joint read 180° and a hairpin 0°
        // rather than both being skipped.
        const at =
          segIntersect({ a: a.start, b: a.end }, { a: b.start, b: b.end }) ?? sharedEndpoint(a, b);
        if (!at) continue;

        // A corner inside a pad is deliberate, not a mitre problem.
        if (padAtPoint(board, at, a.layer)) continue;

        const actual = jointAngle(a, b, at);
        const c = customValue(
          'track_angle',
          evalItem('Track', a.net, a.layer),
          evalItem('Track', b.net, b.layer),
          a.layer,
        );
        if (!c) continue;

        // Angles are degrees, which parseRuleValue passes through unscaled.
        const deg = (v: number): string => `${v.toFixed(1)}°`;

        if (c.value.min !== undefined && actual < c.value.min)
          out.push({
            code: 'track_angle',
            message: `Track angle (min angle ${deg(c.value.min)}${ruleNote(c.rule)}; actual ${deg(actual)})`,
            pos: at,
            items: [
              { desc: `Track [${netName(a.net)}] on ${a.layer}`, pos: a.start },
              { desc: `Track [${netName(b.net)}] on ${b.layer}`, pos: b.start },
            ],
          });

        if (c.value.max !== undefined && actual > c.value.max)
          out.push({
            code: 'track_angle',
            message: `Track angle (max angle ${deg(c.value.max)}${ruleNote(c.rule)}; actual ${deg(actual)})`,
            pos: at,
            items: [
              { desc: `Track [${netName(a.net)}] on ${a.layer}`, pos: a.start },
              { desc: `Track [${netName(b.net)}] on ${b.layer}`, pos: b.start },
            ],
          });
      }
    }
  }

  // ----- silkscreen over a solder mask opening -----------------------------
  // drc_test_provider_silk_clearance, the SILK_MASK_CLEARANCE half: silk
  // printed over a mask opening lands on bare metal, where it will not adhere
  // and can wick into the joint.
  //
  // The openings are the pads' — a pad's copper grown by its resolved solder
  // mask margin. KiCad's board-level mask expansion defaults to zero and is
  // not in our model, so a pad with no local margin opens at its copper
  // outline, which is what that default means.
  if ((opts.minSilkClearance ?? 0) >= 0) {
    const clearance = Math.max(0, (opts.minSilkClearance ?? 0) - DRC_EPSILON);

    const openings: { shape: Shape; side: 'F' | 'B'; desc: string }[] = [];

    for (const fp of board.footprints) {
      for (const pad of fp.pads) {
        const margin = pad.localSolderMaskMargin ?? fp.localSolderMaskMargin ?? 0;
        const sides: ('F' | 'B')[] = [];

        if (pad.layers.some((l) => l === 'F.Mask' || l === '*.Mask')) sides.push('F');
        if (pad.layers.some((l) => l === 'B.Mask' || l === '*.Mask')) sides.push('B');
        if (sides.length === 0) continue;

        for (const shape of padShapes(pad))
          for (const side of sides)
            openings.push({
              shape: inflateShape(shape, margin),
              side,
              desc: `Pad ${pad.number} of ${fp.reference ?? fp.lib}`,
            });
      }
    }

    if (openings.length > 0) {
      for (const s of [...board.shapes, ...board.footprints.flatMap((fp) => fp.shapes)]) {
        const side = s.layer === 'F.SilkS' ? 'F' : s.layer === 'B.SilkS' ? 'B' : undefined;
        if (!side) continue;

        let reported = false;

        for (const shape of graphicShapes(s)) {
          for (const o of openings) {
            if (o.side !== side) continue;
            if (shapeDist(shape, o.shape) > clearance) continue;

            const pos = s.start ?? s.center ?? s.pts?.[0] ?? { x: 0, y: 0 };
            out.push({
              code: 'silk_over_copper',
              message: `Silkscreen clipped by solder mask (clearance ${mm(opts.minSilkClearance ?? 0)}; actual ${mm(shapeDist(shape, o.shape))})`,
              pos,
              items: [
                { desc: `Graphic on ${s.layer}`, pos },
                { desc: o.desc, pos },
              ],
            });
            reported = true;
            break;
          }
          if (reported) break;
        }
      }
    }
  }

  // ----- via count ---------------------------------------------------------
  // The one constraint of drc_test_provider_matched_length that does not need
  // the length calculator. Rule-driven: with no `via_count` constraint there
  // is nothing to check.
  //
  // Upstream counts vias on the *optimised connection path*, which can drop a
  // via that contributes nothing to the route. We count the vias on the net.
  // For an ordinary point-to-point net the two agree; a net carrying stubs
  // could differ, and the length constraints are not ported for the same
  // reason — an approximate length would disagree with KiCad silently, where
  // an approximate count at least means what the rule's author asked for.
  // The has() test is an optimisation, not a behaviour gate: customValue
  // returns nothing without a matching rule anyway. It is here because the
  // per-net loop below would otherwise evaluate the rule set once per net.
  if (ruleEngine?.byType.has('via_count')) {
    const perNet = new Map<number, PcbVia[]>();

    for (const v of board.vias) {
      if (v.net <= 0) continue;
      const list = perNet.get(v.net);
      if (list) list.push(v);
      else perNet.set(v.net, [v]);
    }

    for (const [net, vias] of perNet) {
      const c = customValue('via_count', evalItem('Via', net, vias[0]!.layers[0]), undefined);
      if (!c) continue;

      const count = vias.length;
      const at = vias[0]!.at;

      if (c.value.max !== undefined && count > c.value.max) {
        out.push({
          code: 'too_many_vias',
          message: `Too many vias on a connection (max count ${c.value.max}${ruleNote(c.rule)}; actual ${count})`,
          pos: at,
          items: [{ desc: `Via [${netName(net)}]`, pos: at }],
        });
      } else if (c.value.min !== undefined && count < c.value.min) {
        out.push({
          code: 'too_many_vias',
          message: `Too few vias on a connection (min count ${c.value.min}${ruleNote(c.rule)}; actual ${count})`,
          pos: at,
          items: [{ desc: `Via [${netName(net)}]`, pos: at }],
        });
      }
    }
  }

  // ----- board outline -----------------------------------------------------
  // DRC_TEST_PROVIDER_MISC's outline tests. Two separate failures share the
  // code: graphics too small to build anything from, and an Edge.Cuts set that
  // will not chain into a closed shape.
  {
    const edges = [...board.shapes, ...board.footprints.flatMap((fp) => fp.shapes)].filter(
      (s) => s.layer === 'Edge.Cuts',
    );

    const outlineError = (detail: string, pos: Vec2): void => {
      out.push({
        code: 'invalid_outline',
        message: `Board has malformed outline ${detail}`,
        pos,
        items: [],
      });
    };

    if (edges.length === 0) {
      // Not every board in progress has an outline yet, but a board without
      // one cannot be fabricated, so upstream says so rather than staying
      // quiet.
      outlineError('(no edges found on Edge.Cuts layer)', { x: 0, y: 0 });
    } else {
      // A graphic a few nanometres across builds nothing and is invisible on
      // screen — the reason upstream calls it out by name.
      const MIN_GRAPHIC = mmToIU(0.001);
      let suspicious = false;

      for (const s of edges) {
        const size = edgeGraphicExtent(s);
        if (size !== undefined && size <= MIN_GRAPHIC) {
          suspicious = true;
          outlineError(
            '(Suspicious items found on Edge.Cuts layer)',
            s.start ?? s.center ?? s.pts?.[0] ?? { x: 0, y: 0 },
          );
          break;
        }
      }

      if (!suspicious) {
        // The same chaining the courtyard builder uses, at the board's own
        // epsilon: 0.01 mm rather than the courtyard's 0.02 mm, because an
        // outline gap this test misses becomes a gap in the 3D model and the
        // fabrication outline.
        const closed: Vec2[][] = [];
        const open: Vec2[][] = [];

        for (const s of edges) {
          const pts = shapePoints(s, mmToIU(0.05));
          if (!pts) continue;
          (pts.closed ? closed : open).push(pts.pts);
        }

        const chained = chainOutlines(open, mmToIU(0.01));

        if (chained.error)
          outlineError(chained.error, edges[0]?.start ?? edges[0]?.center ?? { x: 0, y: 0 });
        else if (closed.length === 0 && chained.outlines.length === 0)
          outlineError('(no edges found on Edge.Cuts layer)', { x: 0, y: 0 });
      }
    }
  }

  // ----- PCB to schematic parity -------------------------------------------
  // drc_test_provider_schematic_parity. Runs only when the caller supplies a
  // netlist — with no schematic there is nothing to be out of parity with.
  if (opts.netlist) {
    const nl = opts.netlist;

    // Duplicate references. `board_only` footprints are exempt: they exist on
    // the PCB by design and have no symbol to be duplicated from.
    const seen = new Map<string, PcbFootprint>();

    for (const fp of board.footprints) {
      const ref = (fp.reference ?? '').toLowerCase();
      if (!ref) continue;

      const first = seen.get(ref);
      if (!first) {
        seen.set(ref, fp);
        continue;
      }

      if (fp.attributes?.includes('board_only')) continue;

      out.push({
        code: 'duplicate_footprints',
        message: `Duplicate footprints ${fp.reference}`,
        pos: fp.at,
        items: [
          { desc: `Footprint ${fp.reference}`, pos: fp.at },
          { desc: `Footprint ${first.reference}`, pos: first.at },
        ],
      });
    }

    const byRef = new Map<string, PcbFootprint>();
    for (const fp of board.footprints) if (fp.reference) byRef.set(fp.reference, fp);

    const inNetlist = new Set<string>();

    for (let i = 0; i < nl.GetCount(); i++) {
      const c = nl.GetComponent(i);
      if (!c) continue;
      inNetlist.add(c.GetReference());

      const fp = byRef.get(c.GetReference());

      if (!fp) {
        out.push({
          code: 'missing_footprint',
          message: `Missing footprint ${c.GetReference()} (${c.GetValue()})`,
          pos: { x: 0, y: 0 },
          items: [],
        });
        continue;
      }

      const parity = (detail: string): void => {
        out.push({
          code: 'footprint_symbol_mismatch',
          message: detail,
          pos: fp.at,
          items: [{ desc: `Footprint ${fp.reference}`, pos: fp.at }],
        });
      };

      if (c.GetValue() !== (fp.value ?? ''))
        parity(`Value (${fp.value ?? ''}) doesn't match symbol value (${c.GetValue()})`);

      if (c.GetFPID() !== fp.lib)
        parity(`${fp.lib} doesn't match footprint given by symbol (${c.GetFPID()})`);

      // The two attribute flags the netlist carries as properties.
      const dnpSym = c.GetProperties().has('dnp');
      const dnpFp = fp.attributes?.includes('dnp') ?? false;
      if (dnpSym !== dnpFp) parity("'Do not populate' settings differ");

      const bomSym = c.GetProperties().has('exclude_from_bom');
      const bomFp = fp.attributes?.includes('exclude_from_bom') ?? false;
      if (bomSym !== bomFp) parity("'Exclude from bill of materials' settings differ");

      // Custom fields. Reference and Value are compared above as their own
      // things, and Footprint is the fpid — none of the three is a user field.
      // The board map keeps every stored field. Filtering the reserved
      // property names out of it would be unreachable — the loop below only
      // looks up names the *symbol* has — and in the one case it could fire, a
      // symbol carrying a field literally named `Sheetname`, it would report
      // that field missing rather than compare it.
      const fpFields = new Map<string, string>();
      for (const f of fp.fields ?? []) fpFields.set(f.name, f.value);

      for (const [name, value] of c.GetFields()) {
        if (name === 'Reference' || name === 'Value' || name === 'Footprint') continue;
        if (name === 'Component Class') continue;

        const onBoard = fpFields.get(name);

        if (onBoard === undefined) {
          out.push({
            code: 'footprint_symbol_field_mismatch',
            message: `Missing symbol field '${name}' in footprint`,
            pos: fp.at,
            items: [{ desc: `Footprint ${fp.reference}`, pos: fp.at }],
          });
          // Upstream reports the first mismatch and stops: a footprint whose
          // fields have drifted wholesale is one problem, not twenty.
          break;
        }

        if (onBoard !== value) {
          out.push({
            code: 'footprint_symbol_field_mismatch',
            message: `Field '${name}' differs (PCB: '${onBoard}', Schematic: '${value}')`,
            pos: fp.at,
            items: [{ desc: `Footprint ${fp.reference}`, pos: fp.at }],
          });
          break;
        }
      }

      // Pad nets against the schematic's.
      for (const pad of fp.pads) {
        if (!pad.number) continue;

        const schNet = c.GetNet(pad.number);
        const pcbNet = board.nets.get(pad.net ?? 0) ?? '';

        const conflict = (detail: string): void => {
          out.push({
            code: 'net_conflict',
            message: detail,
            pos: fp.at,
            items: [{ desc: `Pad ${pad.number} of ${fp.reference}`, pos: pad.at }],
          });
        };

        if (pcbNet !== '' && schNet.pinName === '') {
          conflict('No corresponding pin found in schematic');
        } else if (pcbNet === '' && schNet.netName !== '') {
          conflict(`Pad missing net given by schematic (${schNet.netName})`);
        } else if (pcbNet !== schNet.netName && !unconnectedAlias(pcbNet, schNet.netName)) {
          conflict(`Pad net (${pcbNet}) doesn't match net given by schematic (${schNet.netName})`);
        }
      }

      // …and the schematic's pins against the pads.
      const padNumbers = new Set(fp.pads.map((p) => p.number));

      for (let j = 0; j < c.GetNetCount(); j++) {
        const schNet = c.GetNetAt(j);
        if (!schNet.pinName || padNumbers.has(schNet.pinName)) continue;

        out.push({
          code: 'net_conflict',
          message: `No pad found in footprint for schematic pin ${schNet.pinName}`,
          pos: fp.at,
          items: [{ desc: `Footprint ${fp.reference}`, pos: fp.at }],
        });
      }
    }

    // Footprints on the board that no symbol accounts for. A `board_only`
    // footprint is there deliberately — fiducials, mounting hardware — and is
    // the whole reason the attribute exists.
    for (const fp of board.footprints) {
      if (!fp.reference || inNetlist.has(fp.reference)) continue;
      if (fp.attributes?.includes('board_only')) continue;

      out.push({
        code: 'extra_footprint',
        message: `Extra footprint ${fp.reference}`,
        pos: fp.at,
        items: [{ desc: `Footprint ${fp.reference}`, pos: fp.at }],
      });
    }
  }

  // ----- board footprints against their libraries ---------------------------
  // drc_test_provider_library_parity. Runs only when the caller has libraries
  // to compare against, which is upstream's "no project loaded" bail.
  if (opts.libraries) out.push(...checkLibraryParity(board, opts.libraries));

  // ----- footprint type vs its pads ----------------------------------------
  // FOOTPRINT::CheckFootprintAttributes. A footprint marked SMD that carries
  // through-hole pads is not a cosmetic problem: the position file feeds a
  // pick-and-place machine, and a part it cannot place should not be in it.
  for (const fp of board.footprints) {
    const set = fp.attributes?.includes('smd')
      ? 'SMD'
      : fp.attributes?.includes('through_hole')
        ? 'Through hole'
        : undefined;

    // Only a footprint that states a type can contradict itself; one with no
    // `(attr …)` at all is "unspecified", not wrong.
    if (!set) continue;

    const likely = likelyFootprintAttribute(fp);
    if (!likely || likely === set) continue;

    out.push({
      code: 'footprint_type_mismatch',
      message: `Footprint component type doesn't match footprint pads (expected '${likely}'; actual '${set}')`,
      pos: fp.at,
      items: [{ desc: `Footprint ${fp.reference ?? fp.lib}`, pos: fp.at }],
    });
  }

  // ----- padstack sanity ---------------------------------------------------
  // PAD::doCheckPad. Two codes with different weight: `padstack_invalid` is
  // geometry that cannot be built at all, `padstack` is a padstack that will
  // build but probably is not what was meant.
  for (const fp of board.footprints) {
    const ref = fp.reference ?? fp.lib;

    for (const pad of fp.pads) {
      const desc = `Pad ${pad.number} of ${ref}`;
      const bad = (code: 'padstack' | 'padstack_invalid', detail: string): void => {
        out.push({
          code,
          message: `${code === 'padstack' ? 'Padstack is questionable' : 'Padstack is not valid'} ${detail}`,
          pos: pad.at,
          items: [{ desc, pos: pad.at }],
        });
      };

      // A circle takes its diameter from x alone, so a zero y is legal there
      // and nowhere else.
      if (pad.shape !== 'custom') {
        if (pad.size.x <= 0 || (pad.size.y <= 0 && pad.shape !== 'circle'))
          bad('padstack_invalid', '(Pad must have a positive size)');
      }

      if (pad.drill) {
        // Four IU: below that a hole cannot be turned into a polygon at all.
        if (pad.drill.w <= 4 || (pad.drill.h || pad.drill.w) <= 4)
          bad('padstack_invalid', '(PTH pad hole size must be larger than 4 nm)');

        // An SMD pad is a surface feature; a hole in one is a contradiction.
        if (pad.type === 'smd' || pad.type === 'connect')
          bad('padstack_invalid', '(SMD pad has a hole)');
      }

      // Property/attribute pairings that upstream calls out by name.
      const prop = pad.padProperty;
      const plated = pad.type === 'thru_hole';

      if (prop === 'pad_prop_fiducial_glob' || prop === 'pad_prop_fiducial_loc') {
        if (pad.type === 'np_thru_hole') bad('padstack', "('fiducial' pads are normally plated)");
      }
      if (prop === 'pad_prop_testpoint' && pad.type === 'np_thru_hole')
        bad('padstack', "('testpoint' pads are normally plated)");
      if (prop === 'pad_prop_heatsink' && pad.type === 'np_thru_hole')
        bad('padstack', "('heatsink' pads are normally plated)");
      if (prop === 'pad_prop_castellated' && !plated)
        bad('padstack', "('castellated' pads are normally PTH)");
      if (prop === 'pad_prop_bga' && pad.type !== 'smd')
        bad('padstack', "('BGA' property is for SMD pads)");
      if (prop === 'pad_prop_mechanical' && !plated)
        bad('padstack', "('mechanical' pads are normally PTH)");
      if (prop === 'pad_prop_pressfit' && (!plated || pad.drill?.oblong))
        bad('padstack', "('press-fit' pads are normally PTH with round holes)");

      // A connector pad is an SMD pad that is deliberately not pasted.
      if (pad.type === 'connect' && pad.layers.some((l) => /\.Paste$/.test(l)))
        bad('padstack', '(connector pads normally have no solder paste; use a SMD pad instead)');

      if (pad.type === 'smd') {
        const cu = pad.layers.filter((l) => isCopper(l) || l === '*.Cu');
        const front = cu.some((l) => l === 'F.Cu' || l === '*.Cu');
        const back = cu.some((l) => l === 'B.Cu' || l === '*.Cu');

        if (front && back) bad('padstack', '(SMD pad has copper on both sides of the board)');
        else if (!front && !back) bad('padstack', '(SMD pad has no outer layers)');
      }

      // A negative local clearance is silently ignored by everything that
      // reads it, so saying so is more use than honouring it.
      if ((pad.localClearance ?? 0) < 0)
        bad('padstack', '(negative local clearance values have no effect)');

      const maskMargin = pad.localSolderMaskMargin;
      if (maskMargin !== undefined && maskMargin < 0 && pad.shape !== 'custom') {
        const abs = Math.abs(maskMargin);
        if (abs > pad.size.x || abs > pad.size.y)
          bad(
            'padstack',
            '(negative solder mask clearance is larger than pad; no solder mask will be generated)',
          );
      }

      // Paste is the pad grown by the margin plus a fraction of its own size.
      const pasteMargin = pad.localSolderPasteMargin ?? 0;
      const ratio = pad.localSolderPasteMarginRatio ?? 0;
      const pasteX = pad.size.x + pasteMargin + Math.round(pad.size.x * ratio);
      const pasteY = pad.size.y + pasteMargin + Math.round(pad.size.y * ratio);

      if (pasteX <= 0 || pasteY <= 0)
        bad(
          'padstack',
          '(negative solder paste margin is larger than pad; no solder paste mask will be generated)',
        );

      // The corner ratios are a deliberate divergence, and the only one here.
      // Upstream tests `GetRoundRectRadiusRatio() > 50.0`, but that getter
      // returns exactly the number the file stores — `(roundrect_rratio 0.25)`
      // — which is a 0..0.5 fraction, so the comparison can never fire. The
      // threshold that matches the message is half: a radius above half the
      // pad's smaller dimension is what makes it circular. Same for chamfer.
      if (pad.shape === 'roundrect') {
        const r = pad.roundrectRatio ?? 0;
        if (r < 0) bad('padstack_invalid', '(negative corner radius is not allowed)');
        else if (r > 0.5) bad('padstack', '(corner size will make pad circular)');
      } else if (pad.shape === 'trapezoid') {
        const dx = pad.delta?.x ?? 0;
        const dy = pad.delta?.y ?? 0;
        if (Math.abs(dx) > pad.size.y || Math.abs(dy) > pad.size.x)
          bad('padstack_invalid', '(trapezoid delta is too large)');
      }

      // A chamfer ratio lives alongside the roundrect one rather than
      // replacing it, so it is checked whatever the shape token says. Same
      // fraction-vs-50 divergence as above.
      const chamfer = pad.chamferRatio;
      if (chamfer !== undefined) {
        if (chamfer < 0) bad('padstack_invalid', '(negative corner chamfer is not allowed)');
        else if (chamfer > 0.5) bad('padstack_invalid', '(corner chamfer is too large)');
      }
    }
  }

  // ----- starved thermals --------------------------------------------------
  // drc_test_provider_zone_connections. A thermally-relieved pad is meant to
  // reach its zone through several spokes; if the pour could only form one,
  // the joint carries far less current and heat than the design implies.
  //
  // Spokes are counted geometrically, as upstream does: inflate the pad by
  // half the thermal gap, intersect that outline with the zone fill, and every
  // *pair* of crossings is one spoke passing through the relief ring.
  {
    const minSpokes = opts.minResolvedSpokes ?? 2;

    if (minSpokes > 0) {
      for (const z of board.zones) {
        if (z.ruleArea || z.net <= 0 || z.fills.length === 0) continue;

        for (const fill of z.fills) {
          if (!isCopper(fill.layer)) continue;

          for (const fp of board.footprints) {
            for (const pad of fp.pads) {
              if ((pad.net ?? 0) !== z.net) continue;
              if (!padOnLayer(pad, fill.layer)) continue;
              if (resolvedZoneConnection(pad, fp, z) !== 'thermal') continue;

              const midGap = (z.thermalGap ?? 0) / 2;
              const spokes = countThermalSpokes(pad, midGap, fill.polys);

              // Nothing at all is a connectivity question, not a thermal one.
              if (spokes === 0) continue;

              // A custom pad declares its own spokes with proxy segments, and
              // that count is what it should achieve.
              const custom = (pad.primitives ?? []).filter((p) => p.kind === 'gr_vector').length;
              const required = custom > 0 ? custom : minSpokes;

              if (spokes >= required) continue;

              out.push({
                code: 'starved_thermal',
                message: `Thermal relief connection to zone incomplete (layer ${fill.layer}; ${spokes} of ${required} spokes)`,
                pos: pad.at,
                items: [
                  { desc: `Pad ${pad.number} of ${fp.reference ?? fp.lib}`, pos: pad.at },
                  {
                    desc: z.name ? `Zone '${z.name}'` : `Zone [${netName(z.net)}]`,
                    pos: fill.polys[0]?.[0] ?? pad.at,
                  },
                ],
              });
            }
          }
        }
      }
    }
  }

  // ----- track not centered on via -----------------------------------------
  // A track that lands *inside* a via's copper but not on its centre. The via
  // still conducts, so this is a tidiness check — but an off-centre stub is
  // usually the sign of a track that was dragged and left behind.
  {
    const centred = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

    for (const t of [...board.tracks, ...board.arcs]) {
      for (const v of board.vias) {
        if (v.net !== t.net) continue;
        if (!viaLayers(v, copperOrder).includes(t.layer)) continue;

        const r = v.size / 2;
        const startInVia = Math.hypot(t.start.x - v.at.x, t.start.y - v.at.y) <= r;
        const endInVia = Math.hypot(t.end.x - v.at.x, t.end.y - v.at.y) <= r;
        if (!startInVia && !endInVia) continue;

        // If *any* track on this layer reaches the via's centre, the layer is
        // properly connected and a neighbour sitting off-centre is tolerated.
        const layerHasCentredTrack = [...board.tracks, ...board.arcs].some(
          (o) =>
            o.layer === t.layer &&
            o.net === v.net &&
            (centred(o.start, v.at) || centred(o.end, v.at)),
        );
        if (layerHasCentredTrack) continue;

        const offStart = startInVia && !centred(t.start, v.at);
        const offEnd = endInVia && !centred(t.end, v.at);
        if (!offStart && !offEnd) continue;

        const pos = offStart ? t.start : t.end;
        out.push({
          code: 'track_not_centered_on_via',
          message: 'Track endpoint not centered on via',
          pos,
          items: [
            { desc: `Track [${netName(t.net)}] on ${t.layer}`, pos },
            { desc: `Via [${netName(v.net)}]`, pos: v.at },
          ],
        });
        // One report per track, as upstream breaks out of the via loop.
        break;
      }
    }
  }

  // ----- isolated copper ---------------------------------------------------
  // The "starved zones" pass of drc_test_provider_connectivity: an island of
  // zone fill that reaches nothing on its net. The filler drops these under
  // ISLAND_REMOVAL_MODE ALWAYS, so what is left to report are the ones a board
  // set to NEVER or AREA deliberately kept.
  //
  // Isolation is tested by *collision* with same-net copper, not by a
  // containment test on anchor points. A thermally-relieved pad sits in a gap
  // in the fill, and once the fill is fractured that gap is cut out of the
  // ring — so its centre reads as outside the copper it is spoked to, and
  // every thermally-connected pour looks isolated.
  for (const z of board.zones) {
    if (z.ruleArea || z.net <= 0 || z.fills.length === 0) continue;

    // Upstream reports from m_ZoneIsolatedIslandsMap, which holds the islands
    // the filler *kept*. Under ALWAYS — the default — it removed them all, so
    // there is nothing to report and the whole scan is skipped. That is both
    // faithful and what keeps this off the critical path of a normal board.
    if ((z.islandRemovalMode ?? 'always') === 'always') continue;

    // Copper thieving is netless dummy copper by definition: every stamp is an
    // island, and that is the intended geometry.
    if (z.fillMode === 'thieving') continue;

    for (const fill of z.fills) {
      if (!isCopper(fill.layer)) continue;

      // A zone's own islands must not vouch for each other, so its own fill
      // polygons are excluded outright.
      const sameNet = (itemsByLayer.get(fill.layer) ?? []).filter(
        (c) => c.net === z.net && c.zone !== z,
      );
      const withBox = sameNet.map((c) => ({ c, box: shapeBBox(c.shape) }));

      for (const poly of fill.polys) {
        if (poly.length < 3) continue;

        const shape: Shape = { kind: 'poly', pts: poly, r: 0 };
        const box = shapeBBox(shape);
        const touches = withBox.some(
          ({ c, box: b2 }) =>
            !(
              b2.minX > box.maxX ||
              box.minX > b2.maxX ||
              b2.minY > box.maxY ||
              box.minY > b2.maxY
            ) && shapeDist(shape, c.shape) === 0,
        );

        if (touches) continue;

        out.push({
          code: 'isolated_copper',
          message: 'Isolated copper fill',
          pos: poly[0]!,
          items: [
            {
              desc: z.name ? `Zone '${z.name}'` : `Zone fill [${netName(z.net)}] on ${fill.layer}`,
              pos: poly[0]!,
            },
          ],
        });
      }
    }
  }

  // ----- copper slivers -----------------------------------------------------
  // DRC_TEST_PROVIDER_SLIVER_CHECKER. All the copper on a layer is merged into
  // one region first: a sliver is where a region doubles back on *itself*, so
  // two separate items that happen to form a narrow gap are a clearance
  // problem, not this one. The union is what turns "these touch" into "this is
  // one shape with a needle in it".
  {
    const byLayer = new Map<string, Polygon[]>();
    const add = (layer: string, poly: Polygon | null): void => {
      if (!poly || !isCopper(layer)) return;
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), poly]);
    };

    for (const z of board.zones) {
      if (z.ruleArea) continue;
      for (const fill of z.fills)
        for (const poly of fill.polys) if (poly.length >= 3) add(fill.layer, [poly]);
    }
    for (const sh of board.shapes) add(sh.layer, shapeAsPolygon(sh));

    for (const [layer, polys] of byLayer) {
      if (polys.length === 0) continue;
      // Union them into single regions before looking for needles.
      let merged: Polygon[] = [];
      for (const p of polys) merged = merged.length === 0 ? [p] : booleanAdd(merged, [p]);

      // Outer rings only, as upstream's `Outline( jj )` is. Holes are wound the
      // other way, and the sliver test reads winding to tell a finger of copper
      // from a slot — hand it a hole and it reports every slot as a sliver.
      for (const [outline] of merged) {
        if (!outline) continue;

        for (const pos of findSliverPoints(outline)) {
          out.push({
            code: 'copper_sliver',
            message: `Copper sliver on ${layer}`,
            pos,
            items: [{ desc: `Copper on ${layer}`, pos }],
          });
        }
      }
    }
  }

  // ----- minimum connection width -------------------------------------------
  // DRC_TEST_PROVIDER_CONNECTION_WIDTH. Grouped by *net* as well as layer,
  // unlike the sliver pass: a neck is a constriction in one net's own copper,
  // and two different nets running close together is a clearance question that
  // already has its own check.
  {
    /** ARC_LOW_DEF, the tolerance upstream polygonises copper at here. */
    const ARC_LOW_DEF = mmToIU(0.005);
    const minWidth = opts.minConnectionWidth ?? 0;

    if (minWidth > 0) {
      // Upstream's epsilon, and it is generous on purpose. A zone knockout is
      // an approximation of a curve and always carries extra clearance, so the
      // fill is already narrower than the geometry says; and a neck between
      // *two* knockouts loses that on each side, hence the doubling. Testing
      // the bare minimum would report every thermal relief on the board.
      const epsilon = 2 * (DRC_EPSILON + ARC_LOW_DEF);
      const testWidth = minWidth - epsilon;

      const byNetLayer = new Map<string, Polygon[]>();
      const add = (net: number, layer: string, polys: Polygon[]): void => {
        if (net <= 0 || !isCopper(layer)) return;
        const key = `${net}\u0000${layer}`;
        byNetLayer.set(key, [...(byNetLayer.get(key) ?? []), ...polys]);
      };

      // shapeToPolygon speaks polygon-clipping's [x, y] pairs; kimath's
      // booleans speak {x, y}. Converting is the boundary between the two, and
      // casting across it instead silently yields NaN coordinates that merge
      // into a polygon-shaped nothing.
      // polygon-clipping's Geom is a union broad enough to nest further; every
      // Geom shapeToPolygon builds is a flat list of rings of [x, y], so the
      // narrowing here is true even though the declared type cannot say so.
      const toKimath = (geoms: Geom[]): Polygon[] =>
        (geoms as [number, number][][][]).map((geom) =>
          geom.map((ring) => ring.map(([x, y]) => ({ x, y }))),
        );

      for (const [layer, items] of itemsByLayer)
        for (const item of items)
          add(item.net, layer, toKimath(shapeToPolygon(item.shape, 0, ARC_LOW_DEF)));

      for (const [key, polys] of byNetLayer) {
        if (polys.length === 0) continue;
        const layer = key.slice(key.indexOf('\u0000') + 1);

        let merged: Polygon[] = [];
        for (const poly of polys)
          merged = merged.length === 0 ? [poly] : booleanAdd(merged, [poly]);

        // Outer rings only, as with slivers: a hole's own narrow places are
        // gaps in the copper, not constrictions of it.
        for (const [outline] of merged) {
          if (!outline) continue;

          for (const neck of findNecks(outline, testWidth)) {
            out.push({
              code: 'connection_width',
              message: `Minimum connection width (min width ${mm(minWidth)}; actual ${mm(neck.width)}) on ${layer}`,
              pos: neck.at,
              items: [{ desc: `Copper on ${layer}`, pos: neck.at }],
            });
          }
        }
      }
    }
  }

  // ----- differential pair coupling -----------------------------------------
  // DRC_TEST_PROVIDER_DIFF_PAIR_COUPLING. Pairs are discovered by *name*: there
  // is no flag in the file saying two nets belong together, so `matchDpSuffix`
  // reads each name backwards for a polarity mark and a pair exists when both
  // halves name each other.
  {
    const gapMin = opts.diffPairGapMin ?? opts.minClearance;
    const limits = {
      gapMin,
      gapMax: opts.diffPairGapMax,
      maxUncoupled: opts.diffPairMaxUncoupled,
    };

    if (
      gapMin > 0 ||
      opts.diffPairGapMax !== undefined ||
      opts.diffPairMaxUncoupled !== undefined
    ) {
      const byNetName = new Map<string, DpTrack[]>();
      for (const t of board.tracks) {
        if (!isCopper(t.layer)) continue;
        const name = board.nets.get(t.net) ?? '';
        if (name === '') continue;
        byNetName.set(name, [
          ...(byNetName.get(name) ?? []),
          { a: t.start, b: t.end, width: t.width, layer: t.layer },
        ]);
      }

      const done = new Set<string>();

      for (const [name, pTracks] of byNetName) {
        const suffix = matchDpSuffix(name);
        // Only drive each pair from its positive half, so the pair is not
        // evaluated twice with P and N swapped.
        if (suffix.polarity !== 1) continue;

        const nTracks = byNetName.get(suffix.complement);
        if (!nTracks) continue;

        const key = `${name}\u0000${suffix.complement}`;
        if (done.has(key)) continue;
        done.add(key);

        const result = evaluateDiffPair(pTracks, nTracks, limits, DRC_EPSILON);

        if (result.uncoupledViolation) {
          const at = pTracks[0]?.a ?? nTracks[0]?.a;
          if (at)
            out.push({
              code: 'diff_pair_uncoupled_length_too_long',
              message: `Differential pair ${suffix.baseName} (maximum uncoupled length ${mm(
                opts.diffPairMaxUncoupled ?? 0,
              )}; actual ${mm(result.uncoupledLength)})`,
              pos: at,
              items: [{ desc: `Net ${name}`, pos: at }],
            });
        }

        for (const bad of result.gapViolations) {
          const at = {
            x: Math.round((bad.pClip.a.x + bad.pClip.b.x) / 2),
            y: Math.round((bad.pClip.a.y + bad.pClip.b.y) / 2),
          };
          const bound = bad.failedMin
            ? `minimum gap ${mm(limits.gapMin)}`
            : `maximum gap ${mm(limits.gapMax ?? 0)}`;
          out.push({
            code: 'diff_pair_gap_out_of_range',
            message: `Differential pair ${suffix.baseName} (${bound}; actual ${mm(bad.gap)})`,
            pos: at,
            items: [{ desc: `Net ${name}`, pos: at }],
          });
        }
      }
    }
  }

  // ----- creepage -----------------------------------------------------------
  // DRC_TEST_PROVIDER_CREEPAGE. Creepage is not clearance: it is how far a
  // leakage current must crawl across the board's *surface*, so a milled slot
  // between two nets lengthens it without moving them apart. That makes it a
  // shortest-path problem over the board rather than a distance between items.
  {
    // Creepage has no Board Setup field, here or upstream: the distance a
    // board needs depends on working voltage and pollution degree, which the
    // file does not record. It comes from a `.kicad_dru` rule or not at all,
    // which is what upstream's `HasRulesForConstraintType` gate amounts to.
    // The largest declared minimum is used, so the strictest rule on the board
    // is the one that has to be satisfied.
    const fromRules = (opts.customRules?.rules ?? [])
      .flatMap((rule) => rule.constraints)
      .filter((c) => c.type === 'creepage')
      .map((c) => c.value.min ?? 0);

    const minCreepage = opts.minCreepage ?? (fromRules.length > 0 ? Math.max(...fromRules) : 0);

    // A cost guard rather than a behavioural one: with a target of zero the
    // solver returns nothing anyway, so removing this changes no answer — it
    // just makes every DRC run extract every shape on the board to find that
    // out. Mutation testing calls it unobservable; a profiler would not.
    if (minCreepage > 0) {
      const surface = boardSurface(board);

      // With no closed outline there is no surface to crawl over, and the
      // board already has an invalid-outline violation saying so.
      if (surface) {
        const edges = boardEdgeShapes(board);

        for (const layer of board.layers) {
          if (!isCopper(layer.name)) continue;

          const copperByNet = copperShapesByNet(board, layer.name);
          const nets = [...copperByNet.keys()].sort((a, b) => a - b);

          for (let i = 0; i < nets.length; i++) {
            // Each unordered pair once. Comparing a net with itself would in
            // fact come back empty — the solver joins one net's shapes through
            // a single virtual node, leaving the other end unreachable — but
            // relying on that would be paying for an answer already known.
            for (let j = i + 1; j < nets.length; j++) {
              const netA = nets[i]!;
              const netB = nets[j]!;

              const result = creepageDistance(
                { surface, edges, copperByNet },
                netA,
                netB,
                minCreepage,
              );

              // No route within the distance asked for is the *good* answer:
              // nothing leaks that far.
              if (!result) continue;
              if (result.distance >= minCreepage) continue;

              const at = result.path[0] ?? { x: 0, y: 0 };
              out.push({
                code: 'creepage',
                message: `Creepage violation (creepage ${mm(minCreepage)}; actual ${mm(
                  Math.round(result.distance),
                )}) between ${board.nets.get(netA) ?? netA} and ${board.nets.get(netB) ?? netB} on ${layer.name}`,
                pos: at,
                items: [
                  { desc: `Net ${board.nets.get(netA) ?? netA}`, pos: at },
                  {
                    desc: `Net ${board.nets.get(netB) ?? netB}`,
                    pos: result.path[result.path.length - 1] ?? at,
                  },
                ],
              });
            }
          }
        }
      }
    }
  }

  // ----- zones intersect ---------------------------------------------------
  // DRC_TEST_PROVIDER_COPPER_CLEARANCE::testZonesToZones. Two same-net zones
  // overlapping is only a problem when neither can win: the filler resolves an
  // overlap by priority, so *distinct* priorities are perfectly legal and only
  // equal ones are ambiguous.
  for (let i = 0; i < board.zones.length; i++) {
    for (let j = i + 1; j < board.zones.length; j++) {
      const za = board.zones[i]!;
      const zb = board.zones[j]!;

      // "Rule areas may overlap at will."
      if (za.ruleArea || zb.ruleArea) continue;
      if (za.net !== zb.net || za.net < 0) continue;
      if ((za.priority ?? 0) !== (zb.priority ?? 0)) continue;
      if (!za.layers.some((l) => zb.layers.includes(l))) continue;

      const oa = za.outline;
      const ob = zb.outline;
      if (!oa || oa.length < 3 || !ob || ob.length < 3) continue;

      // The *outlines*, not the poured copper: two zones drawn overlapping are
      // ambiguous even before either is filled.
      if (shapeDist({ kind: 'poly', pts: oa, r: 0 }, { kind: 'poly', pts: ob, r: 0 }) > 0) continue;

      out.push({
        code: 'zones_intersect',
        message: 'Copper zones intersect (intersecting zones must have distinct priorities)',
        pos: oa[0]!,
        items: [
          { desc: za.name ? `Zone '${za.name}'` : `Zone [${netName(za.net)}]`, pos: oa[0]! },
          { desc: zb.name ? `Zone '${zb.name}'` : `Zone [${netName(zb.net)}]`, pos: ob[0]! },
        ],
      });
    }
  }

  // ----- copper to board edge ----------------------------------------------
  // drc_test_provider_edge_clearance. The edges are the graphics on Edge.Cuts
  // and Margin — board and footprint alike.
  const edgeShapes: Shape[] = [];

  for (const s of [...board.shapes, ...board.footprints.flatMap((fp) => fp.shapes)]) {
    if (s.layer !== 'Edge.Cuts' && s.layer !== 'Margin') continue;

    // An Edge.Cuts stroke has its width forced to zero: the cut follows the
    // centreline, not the edges of the line the user drew. Margin keeps its
    // width, being a real keep-out band.
    edgeShapes.push(...graphicShapes(s.layer === 'Edge.Cuts' ? { ...s, width: 0 } : s));
  }

  if (edgeShapes.length > 0 && (opts.minCopperToEdge ?? 0) >= 0) {
    // A castellated pad is meant to be cut through, so copper meeting an edge
    // inside its hole is intentional.
    const castellated: Shape[] = board.footprints
      .flatMap((fp) => fp.pads)
      .filter((p) => p.padProperty === 'pad_prop_castellated' && p.drill)
      .map((p) => ({
        kind: 'circle' as const,
        c: p.at,
        r: Math.min(p.drill!.w, p.drill!.h || p.drill!.w) / 2,
      }));

    // One violation per item: "don't report violations with multiple edges;
    // one is enough".
    const reported = new Set<number>();

    for (const [layer, items] of itemsByLayer) {
      for (const it of items) {
        if (reported.has(it.owner)) continue;

        const edgeCustom = customValue(
          'edge_clearance',
          evalItem('Track', it.net, layer),
          undefined,
          layer,
        );
        const minEdge = edgeCustom?.value.min ?? opts.minCopperToEdge ?? 0;
        if (minEdge < 0) continue;

        // The epsilon slack again: copper exactly at the clearance is legal.
        const clearance = Math.max(0, minEdge - DRC_EPSILON);

        for (const e of edgeShapes) {
          const actual = shapeDist(it.shape, e);
          // Inclusive, as SHAPE::Collide is: at a clearance of zero an actual
          // overlap still collides, which is the case that matters when Board
          // Setup asks for no clearance at all. The epsilon already taken off
          // `clearance` is what keeps exactly-at-clearance legal.
          if (actual > clearance) continue;

          // Inside a castellation, the collision is the point of the pad.
          if (castellated.some((h) => shapeDist(it.shape, h) === 0)) continue;

          reported.add(it.owner);
          out.push({
            code: 'copper_edge_clearance',
            message: `Board edge clearance violation (clearance ${mm(minEdge)}${ruleNote(edgeCustom?.rule)}; actual ${mm(actual)})`,
            pos: it.pos,
            items: [{ desc: it.desc, pos: it.pos }],
          });
          break;
        }
      }
    }

    // Silkscreen against the same edges, under its own code and its own
    // clearance. Silk running off the board edge is trimmed by the fab rather
    // than shorting anything, which is why it is a separate, usually gentler
    // severity — but it still loses the legend it was meant to print.
    const minSilk = opts.minSilkClearance ?? 0;

    if (minSilk >= 0) {
      const silkClearance = Math.max(0, minSilk - DRC_EPSILON);

      for (const s of [...board.shapes, ...board.footprints.flatMap((fp) => fp.shapes)]) {
        if (s.layer !== 'F.SilkS' && s.layer !== 'B.SilkS') continue;

        for (const shape of graphicShapes(s)) {
          let hit = false;

          for (const e of edgeShapes) {
            const actual = shapeDist(shape, e);
            if (actual > silkClearance) continue;

            const pos = s.start ?? s.center ?? s.pts?.[0] ?? { x: 0, y: 0 };
            out.push({
              code: 'silk_edge_clearance',
              message: `Silkscreen clipped by board edge (clearance ${mm(minSilk)}; actual ${mm(actual)})`,
              pos,
              items: [{ desc: `Graphic on ${s.layer}`, pos }],
            });
            hit = true;
            break;
          }

          if (hit) break;
        }
      }
    }
  }

  // ----- hole to hole ------------------------------------------------------
  // drc_test_provider_hole_to_hole. A hole is a SHAPE_SEGMENT, not a circle:
  // a round drill is a zero-length segment whose width is the diameter, and a
  // slot carries the milled axis, so one model covers both exactly.
  const h2hCustom = customValue('hole_to_hole', undefined, undefined, undefined);
  const minHoleToHole = h2hCustom?.value.min ?? opts.minHoleToHole;
  const holes = boardHoles(board, netName);

  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i]!;
      const b = holes[j]!;

      // Blind and buried vias are drilled before the stack is laminated, so
      // two that share no copper layer are never drilled into each other.
      if (a.viaLayers && b.viaLayers && !a.viaLayers.some((l) => b.viaLayers?.includes(l)))
        continue;

      // Co-located holes are their own violation, and *instead of* the
      // too-close one — upstream's branch is an else-if.
      if (Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) < DRC_EPSILON) {
        out.push({
          code: 'holes_co_located',
          message: 'Drilled holes co-located',
          pos: a.c,
          items: [
            { desc: a.desc, pos: a.c },
            { desc: b.desc, pos: b.c },
          ],
        });
        continue;
      }

      // Between the two axes, then back off the two half-widths.
      const actual = Math.max(0, segSegDist(a.a, a.b, b.a, b.b) - a.width / 2 - b.width / 2);
      // The epsilon slack keeps a hole placed exactly at the limit legal.
      const minClearance = Math.max(0, minHoleToHole - DRC_EPSILON);

      if (minClearance > 0 && actual < minClearance) {
        out.push({
          code: 'hole_to_hole',
          message: `Drilled hole too close to other hole (min ${mm(minClearance)}${ruleNote(h2hCustom?.rule)}; actual ${mm(actual)})`,
          pos: a.c,
          items: [
            { desc: a.desc, pos: a.c },
            { desc: b.desc, pos: b.c },
          ],
        });
      }
    }
  }

  // ----- text --------------------------------------------------------------
  // drc_test_provider_text_dims (rule-driven: no constraint, no test) and
  // drc_test_provider_text_mirroring (not rule-driven at all).
  const allTexts = [
    ...board.texts.map((t) => ({ t, desc: `Text '${t.text}'` })),
    ...board.footprints.flatMap((fp) =>
      fp.texts.map((t) => ({ t, desc: `Text '${t.text}' of ${fp.reference ?? fp.lib}` })),
    ),
  ];

  if (ruleEngine?.byType.has('text_height') || ruleEngine?.byType.has('text_thickness')) {
    for (const { t, desc } of allTexts) {
      const item = evalItem('Text', 0, t.layer, {
        Text_Height: t.size.y,
        Text_Width: t.size.x,
      });

      const height = customValue('text_height', item, undefined, t.layer);
      if (height) {
        const { min, max } = height.value;
        if (min !== undefined && t.size.y < min)
          out.push(textDim('text_height', 'min height', min, t.size.y, height.rule, desc, t.at));
        if (max !== undefined && t.size.y > max)
          out.push(textDim('text_height', 'max height', max, t.size.y, height.rule, desc, t.at));
      }

      const thickness = customValue('text_thickness', item, undefined, t.layer);
      if (thickness) {
        // The stroke-font branch. Upstream's other branch deflates each
        // TrueType glyph to find collapsed strokes; we have no glyph outlines,
        // so an outline font is simply not checked rather than mis-checked.
        const actual = effectiveTextPenWidth(t);
        const { min, max } = thickness.value;
        if (min !== undefined && actual < min)
          out.push(
            textDim('text_thickness', 'min thickness', min, actual, thickness.rule, desc, t.at),
          );
        if (max !== undefined && actual > max)
          out.push(
            textDim('text_thickness', 'max thickness', max, actual, thickness.rule, desc, t.at),
          );
      }
    }
  }

  // Mirroring. Text reading backwards on a front layer, or forwards on a back
  // one, is a plotting mistake rather than a spacing one.
  const FRONT_TEXT_LAYERS = new Set(['F.Cu', 'F.SilkS', 'F.Mask', 'F.Fab']);
  const BACK_TEXT_LAYERS = new Set(['B.Cu', 'B.SilkS', 'B.Mask', 'B.Fab']);

  for (const { t, desc } of allTexts) {
    if (t.hide) continue;

    if (t.mirror && FRONT_TEXT_LAYERS.has(t.layer)) {
      out.push({
        code: 'mirrored_text_on_front_layer',
        message: 'Mirrored text on front layer',
        pos: t.at,
        items: [{ desc, pos: t.at }],
      });
    }

    if (!t.mirror && BACK_TEXT_LAYERS.has(t.layer)) {
      out.push({
        code: 'nonmirrored_text_on_back_layer',
        message: 'Non-mirrored text on back layer',
        pos: t.at,
        items: [{ desc, pos: t.at }],
      });
    }
  }

  // ----- connectivity ------------------------------------------------------
  // drc_test_provider_connectivity. Not rule-driven: it asks the connectivity
  // model, which for us is the same ratsnest the canvas draws.

  // One marker per remaining airwire, which is precisely what an unconnected
  // net *is* — RunOnUnconnectedEdges over CN_EDGEs.
  for (const edge of buildRatsnest(board)) {
    const from = { x: edge.ax, y: edge.ay };
    const to = { x: edge.bx, y: edge.by };

    out.push({
      code: 'unconnected_items',
      message: `Missing connection between items [${netName(edge.net)}]`,
      pos: from,
      items: [
        { desc: `Item [${netName(edge.net)}]`, pos: from },
        { desc: `Item [${netName(edge.net)}]`, pos: to },
      ],
    });
  }

  // Dangling ends. `copperAt` answers "what same-net copper touches this
  // point", which is the CN_ITEM::ConnectedItems() walk in miniature.
  const danglingItems = danglingCopper(board, copperOrder);

  for (const t of [...board.tracks, ...board.arcs]) {
    const accuracy = Math.round(t.width / 2);
    const pos = danglingEnd(t.start, t.end, t.layer, t.net, accuracy, t, danglingItems);
    if (!pos) continue;

    out.push({
      code: 'track_dangling',
      message: 'Track has unconnected end',
      pos,
      items: [{ desc: `Track [${netName(t.net)}] on ${t.layer}`, pos }],
    });
  }

  for (const v of board.vias) {
    // A via is dangling when everything it touches sits on one layer — it is
    // then carrying a connection from a layer to itself.
    const touching = danglingItems.filter(
      (c) =>
        c.net === v.net &&
        c.item !== v &&
        shapeDist(c.shape, { kind: 'circle', c: v.at, r: v.size / 2 }) === 0,
    );

    // No connections at all is only an error when the via has a net.
    if (touching.length === 0 && v.net <= 0) continue;

    const layers = new Set(touching.map((c) => c.layer));
    if (layers.size > 1) continue;

    out.push({
      code: 'via_dangling',
      message: 'Via is not connected or is connected on only one layer',
      pos: v.at,
      items: [{ desc: `Via [${netName(v.net)}]`, pos: v.at }],
    });
  }

  // ----- miscellaneous -----------------------------------------------------
  // drc_test_provider_misc, plus the two that live with the items they check:
  // the text-on-Edge.Cuts test from the disallow provider, and PAD::CheckPads'
  // through-hole-without-a-hole.

  // The `(layers …)` table *is* the enabled set, so anything naming a copper
  // layer outside it is on a disabled layer. Only copper is tested.
  const enabled = new Set(board.layers.map((l) => l.name));
  const disabled = (layer: string | undefined): boolean =>
    layer !== undefined && isCopper(layer) && !enabled.has(layer);

  const onDisabledLayer = (desc: string, pos: Vec2, layer: string): void => {
    out.push({
      code: 'item_on_disabled_layer',
      message: `Item on a disabled copper layer (layer ${layer})`,
      pos,
      items: [{ desc, pos }],
    });
  };

  for (const t of board.tracks)
    if (disabled(t.layer)) onDisabledLayer(`Track [${netName(t.net)}]`, t.start, t.layer);
  for (const t of board.arcs)
    if (disabled(t.layer)) onDisabledLayer(`Track [${netName(t.net)}]`, t.start, t.layer);

  for (const v of board.vias) {
    // A via is tested at the two ends of its span, not everywhere between.
    const bad = v.layers.find((l) => disabled(l));
    if (bad) onDisabledLayer(`Via [${netName(v.net)}]`, v.at, bad);
  }

  for (const z of board.zones) {
    const bad = z.layers.find((l) => disabled(l));
    if (bad)
      onDisabledLayer(
        z.name ? `Zone '${z.name}'` : `Zone [${netName(z.net)}]`,
        z.outline?.[0] ?? { x: 0, y: 0 },
        bad,
      );
  }

  // Everything else is tested by its plain layer set, which for a graphic or a
  // text can name a copper layer just as a track's can.
  for (const s of board.shapes)
    if (disabled(s.layer))
      onDisabledLayer(`Graphic on ${s.layer}`, s.start ?? s.center ?? { x: 0, y: 0 }, s.layer);

  for (const t of [...board.texts, ...board.footprints.flatMap((fp) => fp.texts)])
    if (disabled(t.layer)) onDisabledLayer(`Text '${t.text}'`, t.at, t.layer);

  for (const fp of board.footprints) {
    const ref = fp.reference ?? fp.lib;

    for (const s of fp.shapes)
      if (disabled(s.layer))
        onDisabledLayer(`Graphic of ${ref}`, s.start ?? s.center ?? fp.at, s.layer);

    for (const p of fp.pads) {
      // A through-hole pad pierces every physical layer, so it is never on a
      // disabled one; only surface pads are tested.
      if (p.type === 'smd' || p.type === 'connect') {
        const bad = p.layers.find((l) => disabled(l));
        if (bad) onDisabledLayer(`Pad ${p.number} of ${ref}`, p.at, bad);
      }

      // PAD::CheckPads: a plated or unplated through-hole pad is expected to
      // have a hole. An oblong drill needs both dimensions.
      if (p.type === 'thru_hole' || p.type === 'np_thru_hole') {
        const noHole = !p.drill || p.drill.w <= 0 || (p.drill.oblong && p.drill.h <= 0);
        if (noHole) {
          out.push({
            code: 'through_hole_pad_without_hole',
            message: 'Through hole pad has no hole',
            pos: p.at,
            items: [{ desc: `Pad ${p.number} of ${ref}`, pos: p.at }],
          });
        }
      }
    }
  }

  // Text that plots geometry onto Edge.Cuts corrupts the board outline.
  // Graphics are *not* included: upstream's checkTextOnEdgeCuts answers true
  // only for text-like items.
  for (const t of [...board.texts, ...board.footprints.flatMap((fp) => fp.texts)]) {
    if (t.layer === 'Edge.Cuts') {
      out.push({
        code: 'text_on_edge_cuts',
        message: 'Text or graphic on Edge.Cuts layer',
        pos: t.at,
        items: [{ desc: `Text '${t.text}'`, pos: t.at }],
      });
    }
  }

  // A text variable the reader could not resolve is still spelled `${…}` in
  // the shown text, which is exactly upstream's `*${*}*` test.
  for (const t of [...board.texts, ...board.footprints.flatMap((fp) => fp.texts)]) {
    if (/\$\{[^}]*\}/.test(t.text)) {
      out.push({
        code: 'unresolved_variable',
        message: 'Unresolved text variable',
        pos: t.at,
        items: [{ desc: `Text '${t.text}'`, pos: t.at }],
      });
    }
  }

  // ----- courtyards --------------------------------------------------------
  // drc_test_provider_courtyard_clearance, plus the missing/malformed pair.
  // A courtyard is derived from the footprint's F.CrtYd / B.CrtYd graphics, so
  // this runs whatever the rule file says.
  const courtyards = board.footprints.map((fp) => ({
    fp,
    ref: fp.reference ?? fp.lib,
    front: buildCourtyard(fp, 'F.CrtYd'),
    back: buildCourtyard(fp, 'B.CrtYd'),
  }));

  for (const c of courtyards) {
    if (c.front.malformed || c.back.malformed) {
      out.push({
        code: 'malformed_courtyard',
        message: `Footprint has malformed courtyard ${c.front.error ?? c.back.error ?? ''}`.trim(),
        pos: c.fp.at,
        items: [{ desc: `Footprint ${c.ref}`, pos: c.fp.at }],
      });
      // Malformed and missing are exclusive: upstream reports the first and
      // never falls through to the second.
      continue;
    }

    if (c.front.outlines.length === 0 && c.back.outlines.length === 0) {
      if (allowsMissingCourtyard(c.fp)) continue;

      out.push({
        code: 'missing_courtyard',
        message: 'Footprint has no courtyard defined',
        pos: c.fp.at,
        items: [{ desc: `Footprint ${c.ref}`, pos: c.fp.at }],
      });
    }
  }

  for (let i = 0; i < courtyards.length; i++) {
    for (let j = i + 1; j < courtyards.length; j++) {
      const a = courtyards[i]!;
      const b = courtyards[j]!;

      // Courtyards only collide with their own side of the board.
      for (const side of ['front', 'back'] as const) {
        const outlinesA = a[side].outlines;
        const outlinesB = b[side].outlines;
        if (outlinesA.length === 0 || outlinesB.length === 0) continue;

        const clearance =
          customValue(
            'courtyard_clearance',
            evalItem('Footprint', 0, side === 'front' ? 'F.Cu' : 'B.Cu'),
            evalItem('Footprint', 0, side === 'front' ? 'F.Cu' : 'B.Cu'),
          )?.value.min ?? 0;

        const hit = outlinesA.some((oa) =>
          outlinesB.some(
            (ob) =>
              shapeDist({ kind: 'poly', pts: oa, r: 0 }, { kind: 'poly', pts: ob, r: 0 }) <=
              clearance,
          ),
        );

        if (!hit) continue;

        out.push({
          code: 'courtyards_overlap',
          message: 'Courtyards overlap',
          pos: a.fp.at,
          items: [
            { desc: `Footprint ${a.ref}`, pos: a.fp.at },
            { desc: `Footprint ${b.ref}`, pos: b.fp.at },
          ],
        });
        break;
      }

      // A drilled pad of one footprint inside the other's courtyard. Via holes
      // are deliberately not checked: "there is a presumption that a physical
      // object goes through a pad hole, which is not the case for via holes."
      for (const [owner, other] of [
        [a, b],
        [b, a],
      ] as const) {
        for (const pad of other.fp.pads) {
          // A heatsink pad is exempt, and only a drilled pad counts at all.
          if (pad.padProperty === 'pad_prop_heatsink') continue;
          if (pad.type !== 'thru_hole' && pad.type !== 'np_thru_hole') continue;
          if (!pad.drill) continue;

          const hole: Shape = {
            kind: 'circle',
            c: pad.at,
            r: Math.min(pad.drill.w, pad.drill.h || pad.drill.w) / 2,
          };

          const inside = [...owner.front.outlines, ...owner.back.outlines].some(
            (o) => shapeDist(hole, { kind: 'poly', pts: o, r: 0 }) === 0,
          );

          if (!inside) continue;

          out.push({
            code: pad.type === 'thru_hole' ? 'pth_inside_courtyard' : 'npth_inside_courtyard',
            message: pad.type === 'thru_hole' ? 'PTH inside courtyard' : 'NPTH inside courtyard',
            pos: pad.at,
            items: [
              { desc: `Pad ${pad.number} of ${other.ref}`, pos: pad.at },
              { desc: `Footprint ${owner.ref}`, pos: owner.fp.at },
            ],
          });
        }
      }
    }
  }

  // ----- disallow / assertion (every board item) ---------------------------
  // Both walk the whole board rather than copper pairs, and both are pure
  // rule-driven: with no .kicad_dru there is nothing to check and the sweep is
  // skipped entirely (HasRulesForConstraintType).
  if (ruleEngine && (ruleEngine.byType.has('disallow') || ruleEngine.byType.has('assertion'))) {
    for (const item of boardEvalItems(board, netName, netClassesOf)) {
      const itemLayers = item.eval.layers ?? (item.eval.layer ? [item.eval.layer] : []);
      const withShapes = (shapes: readonly Shape[]): DrcEvalItem => ({
        ...item.eval,
        test: areaTest(shapes, itemLayers),
      });

      if (ruleEngine.byType.has('disallow')) {
        // A drilled item is evaluated twice, as itself and as its hole, which
        // is how `(constraint disallow hole)` reaches a via or a plated pad.
        for (const holeProxy of item.hasHole ? [false, true] : [false]) {
          // The hole pass collides the hole alone, not the pad around it.
          const evalItem = withShapes(holeProxy ? (item.holeShapes ?? item.shapes) : item.shapes);

          const r = evalDrcRules(
            ruleEngine,
            'disallow',
            evalItem,
            undefined,
            item.eval.layer,
            undefined,
            holeProxy,
          );

          // An ignored severity makes no marker at all, as upstream checks
          // before reporting rather than filtering afterwards.
          if (!r.rule || !r.disallow || r.severity === 'ignore') continue;

          out.push({
            code: 'items_not_allowed',
            message: `Items not allowed${ruleNote(r.rule)}`,
            pos: item.pos,
            items: [{ desc: item.desc, pos: item.pos }],
          });
        }
      }

      if (ruleEngine.byType.has('assertion')) {
        const { results } = collectAssertions(ruleEngine, withShapes(item.shapes), item.eval.layer);

        for (const a of results) {
          if (a.passed) continue;

          out.push({
            code: 'assertion_failure',
            message: `Assertion failure${ruleNote(a.rule)}`,
            pos: item.pos,
            items: [{ desc: item.desc, pos: item.pos }],
          });
        }
      }
    }
  }

  return out;
}

/** One board item as the rule engine sees it, plus what a marker needs. */
interface BoardEvalItem {
  eval: DrcEvalItem;
  desc: string;
  pos: Vec2;
  /** Drilled, so it gets the second HOLE_PROXY pass. */
  hasHole: boolean;
  /** The item's copper geometry, for the area predicates. */
  shapes: Shape[];
  /** Its hole alone, which is what the HOLE_PROXY pass collides. */
  holeShapes?: Shape[];
}

/**
 * Every board item the rule-driven checks visit, mirroring
 * `forEachGeometryItem( {}, LSET::AllLayersMask(), … )`.
 *
 * `props` carries what a condition or an assertion can ask about — Width,
 * Orientation, the via span — because those are only reachable through the
 * expression language, never through a numeric constraint.
 */
function* boardEvalItems(
  board: Board,
  netName: (n: number) => string,
  netClassesOf: (net: number) => readonly string[],
): Generator<BoardEvalItem> {
  const classes = (net: number): string[] => [...netClassesOf(net)];

  for (const t of board.tracks) {
    yield {
      eval: {
        type: 'Track',
        layer: t.layer,
        netName: board.nets.get(t.net),
        netClasses: classes(t.net),
        props: { Width: t.width },
      },
      desc: `Track [${netName(t.net)}] on ${t.layer}`,
      pos: t.start,
      hasHole: false,
      shapes: [{ kind: 'stadium', a: t.start, b: t.end, r: t.width / 2 }],
    };
  }

  for (const t of board.arcs) {
    yield {
      eval: {
        type: 'Arc',
        layer: t.layer,
        netName: board.nets.get(t.net),
        netClasses: classes(t.net),
        props: { Width: t.width },
      },
      desc: `Track [${netName(t.net)}] on ${t.layer}`,
      pos: t.start,
      hasHole: false,
      shapes: [arcShape(t.start, t.mid, t.end, t.width)],
    };
  }

  for (const v of board.vias) {
    yield {
      eval: {
        type: 'Via',
        layer: v.layers[0],
        layers: [...v.layers],
        netName: board.nets.get(v.net),
        netClasses: classes(v.net),
        props: { viaKind: viaSpanKind(v), Width: v.size, Hole: v.drill },
      },
      desc: `Via [${netName(v.net)}]`,
      pos: v.at,
      hasHole: true,
      shapes: [{ kind: 'circle', c: v.at, r: v.size / 2 }],
      holeShapes: [{ kind: 'circle', c: v.at, r: v.drill / 2 }],
    };
  }

  for (const fp of board.footprints) {
    const ref = fp.reference ?? fp.lib;

    yield {
      eval: { type: 'Footprint', layer: fp.layer, props: { Orientation: fp.angle } },
      desc: `Footprint ${ref}`,
      pos: fp.at,
      hasHole: false,
      // A footprint collides through its *courtyard*, not its outline or its
      // pads (collidesWithArea's PCB_FOOTPRINT_T branch). One with no
      // courtyard collides with nothing, which is upstream's answer too — it
      // reports an error and returns false.
      shapes: [
        ...buildCourtyard(fp, 'F.CrtYd').outlines,
        ...buildCourtyard(fp, 'B.CrtYd').outlines,
      ].map((pts) => ({ kind: 'poly' as const, pts, r: 0 })),
    };

    for (const pad of fp.pads) {
      const net = pad.net ?? 0;
      yield {
        eval: {
          type: 'Pad',
          layer: pad.layers[0],
          layers: [...pad.layers],
          netName: board.nets.get(net),
          netClasses: classes(net),
          props: { Pad_Number: pad.number },
        },
        desc: `Pad ${pad.number} of ${ref}`,
        pos: pad.at,
        hasHole: pad.drill !== undefined,
        shapes: padShapes(pad),
        holeShapes: pad.drill
          ? [
              {
                kind: 'circle',
                c: pad.at,
                r: Math.min(pad.drill.w, pad.drill.h || pad.drill.w) / 2,
              },
            ]
          : undefined,
      };
    }
  }

  for (const z of board.zones) {
    yield {
      eval: {
        type: 'Zone',
        layer: z.layers[0],
        layers: [...z.layers],
        netName: board.nets.get(z.net),
        netClasses: classes(z.net),
        props: { teardrop: z.teardropType ? 1 : 0 },
      },
      desc: z.name ? `Zone '${z.name}'` : `Zone [${netName(z.net)}]`,
      // ZONE::GetPosition is the first outline corner.
      pos: z.outline?.[0] ?? z.fills[0]?.polys[0]?.[0] ?? { x: 0, y: 0 },
      hasHole: false,
      // A zone collides through its poured copper, not its outline: an unfilled
      // zone has no geometry to collide (collidesWithArea returns false for
      // !IsFilled).
      shapes: z.fills.flatMap((f) => f.polys.map((pts) => ({ kind: 'poly' as const, pts, r: 0 }))),
    };
  }

  for (const s of board.shapes) {
    yield {
      eval: { type: 'Graphic', layer: s.layer, props: { Width: s.width } },
      desc: `Graphic on ${s.layer}`,
      pos: s.start ?? s.center ?? s.pts?.[0] ?? { x: 0, y: 0 },
      hasHole: false,
      shapes: graphicShapes(s),
    };
  }

  for (const t of board.texts) {
    yield {
      eval: { type: 'Text', layer: t.layer, props: { Orientation: t.angle } },
      desc: `Text '${t.text}' on ${t.layer}`,
      pos: t.at,
      hasHole: false,
      // Text collides through its stroked glyphs, which we do not tessellate.
      shapes: [],
    };
  }
}

/**
 * Distance from a hole's *axis* to a shape.
 *
 * The caller backs off the hole's half-width afterwards, which is what turns
 * the axis distance into an edge-to-edge one — and follows a milled slot along
 * its length rather than treating it as a circle at its centre.
 */
function holeToShape(h: BoardHole, s: Shape): number {
  return shapeDist({ kind: 'stadium', a: h.a, b: h.b, r: 0 }, s);
}

/**
 * ZONE_CONNECTION resolution: a pad's own setting wins, then its footprint's,
 * then the zone's. `inherited` at any level means "ask the next one up".
 */
function resolvedZoneConnection(
  pad: PcbPad,
  fp: PcbFootprint,
  zone: PcbZone,
): 'thermal' | 'none' | 'full' | 'thru_hole_only' {
  const fromPad = pad.zoneConnection;
  if (fromPad && fromPad !== 'inherited') return fromPad;

  const fromFp = fp.zoneConnection;
  if (fromFp && fromFp !== 'inherited') return fromFp;

  return zone.padConnection ?? 'thermal';
}

/**
 * How many thermal spokes reach a pad, counted the way upstream counts them.
 *
 * The pad outline inflated by half the thermal gap sits in the middle of the
 * relief ring. A spoke crosses that ring, so it cuts the inflated outline
 * *twice* — which is why the count is intersections / 2 rather than
 * intersections. Coincident crossings are collapsed first, or a spoke landing
 * exactly on a vertex would be counted twice over — carried from upstream; no
 * test covers it, because forcing two crossings onto the identical coordinate
 * against a polygonised offset outline is not something a fixture can arrange.
 *
 * Upstream additionally discounts spokes to an island that connects to nothing
 * else, since such a spoke carries no current anywhere. That needs the filler's
 * island bookkeeping, which we do not keep, so those spokes are counted here.
 */
function countThermalSpokes(pad: PcbPad, midGap: number, polys: readonly Vec2[][]): number {
  // ARC_LOW_DEF, the same tolerance the pad polygonisation uses upstream.
  const outlines = padShapes(pad).flatMap((sh) => shapeToPolygon(sh, midGap, mmToIU(0.005)));

  let spokes = 0;

  for (const poly of polys) {
    if (poly.length < 3) continue;
    // chainIntersectChain walks poly as an open chain, so the closing edge is
    // added back or a spoke crossing it would be missed.
    const closed = [...poly, poly[0]!];

    for (const geom of outlines) {
      // shapeToPolygon hands back polygon-clipping rings: [x, y] pairs.
      const raw = geom[0] as [number, number][] | undefined;
      if (!raw || raw.length < 3) continue;

      const ring = raw.map(([x, y]) => ({ x, y }));
      const hits = chainIntersectChain([...ring, ring[0]!], closed);
      const unique: Vec2[] = [];

      for (const h of hits)
        if (!unique.some((u) => u.x === h.p.x && u.y === h.p.y)) unique.push(h.p);

      if (unique.length >= 2) spokes += Math.floor(unique.length / 2);
    }
  }

  return spokes;
}

/**
 * Grow a shape by a margin, for a pad's solder mask opening.
 *
 * Every Shape kind already carries a radius the collision code adds, so the
 * margin folds into it rather than needing the outline re-offset.
 */
function inflateShape(s: Shape, margin: number): Shape {
  if (margin === 0) return s;

  switch (s.kind) {
    case 'circle':
      return { ...s, r: Math.max(0, s.r + margin) };
    case 'stadium':
      return { ...s, r: Math.max(0, s.r + margin) };
    case 'arc':
      return { ...s, r: Math.max(0, s.r + margin) };
    case 'poly':
      return { ...s, r: Math.max(0, s.r + margin) };
  }
}

/**
 * How big an Edge.Cuts graphic is, for the degenerate-shape test.
 *
 * TestBoardOutlinesGraphicItems measures each kind the way it is drawn: a
 * segment or rectangle by its diagonal, a circle by its radius, an arc by the
 * two chords from its middle. A polygon or Bezier is not measured — upstream
 * checks those for point count instead, which our reader has already enforced.
 */
function edgeGraphicExtent(s: PcbShape): number | undefined {
  const len = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

  switch (s.kind) {
    case 'line':
    case 'rect':
      return s.start && s.end ? len(s.start, s.end) : undefined;

    case 'circle':
      return s.center && s.end ? len(s.center, s.end) : undefined;

    case 'arc':
      return s.start && s.mid && s.end ? len(s.start, s.mid) + len(s.mid, s.end) : undefined;

    default:
      return undefined;
  }
}

/**
 * The two net names KiCad treats as the same despite differing text.
 *
 * A pad the schematic leaves unconnected gets a generated name, and the board
 * carries a longer form of it — `unconnected-(U1-Pad1)` against the schematic's
 * stem. Comparing the strings directly reports every no-connect pin on the
 * board as a net conflict.
 */
function unconnectedAlias(pcbNet: string, schNet: string): boolean {
  if (schNet === '') return false;
  if (pcbNet.startsWith('unconnected-') && pcbNet.startsWith(schNet)) return true;
  // A no-connect pad's board net is the schematic name with a suffix.
  return pcbNet.startsWith(`${schNet}_`);
}

/**
 * FOOTPRINT::GetLikelyAttribute — the type a footprint's pads imply.
 *
 * Through-hole wins outright when any plated through-hole pad is present:
 * upstream's reasoning is that such a part "might not be auto-placed", so a
 * mixed footprint is through-hole even if most of its pads are surface mount.
 *
 * Four pad properties are excluded from the vote entirely. A fiducial,
 * heatsink, castellated or mechanical pad says nothing about how the component
 * is fitted, so counting them would make a mechanical hole turn an SMD part
 * into a through-hole one.
 */
export function likelyFootprintAttribute(fp: PcbFootprint): 'SMD' | 'Through hole' | undefined {
  const ABSTAINS = new Set([
    'pad_prop_fiducial_glob',
    'pad_prop_fiducial_loc',
    'pad_prop_heatsink',
    'pad_prop_castellated',
    'pad_prop_mechanical',
  ]);

  let tht = 0;
  let smd = 0;

  for (const pad of fp.pads) {
    if (pad.padProperty && ABSTAINS.has(pad.padProperty)) continue;

    if (pad.type === 'thru_hole') tht++;
    // An SMD pad only counts as surface mount if it is actually on copper.
    else if (pad.type === 'smd' && pad.layers.some((l) => isCopper(l) || l === '*.Cu')) smd++;
  }

  if (tht > 0) return 'Through hole';
  if (smd > 0) return 'SMD';
  return undefined;
}

/** One track-segment-length violation. */
function trackDim(
  what: string,
  limit: number,
  actual: number,
  rule: DrcRule | undefined,
  desc: string,
  pos: Vec2,
): DrcViolation {
  const mm = (iu: number): string =>
    `${iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} mm`;

  return {
    code: 'track_segment_length',
    message: `Track segment length (${what} ${mm(limit)}${rule ? ` (rule '${rule.name}')` : ''}; actual ${mm(actual)})`,
    pos,
    items: [{ desc, pos }],
  };
}

/** Is there a pad covering this point on this layer? */
function padAtPoint(board: Board, p: Vec2, layer: string): boolean {
  const probe: Shape = { kind: 'circle', c: p, r: 0 };

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!pad.layers.includes(layer) && !(pad.layers.includes('*.Cu') && isCopper(layer)))
        continue;
      if (padShapes(pad).some((s) => shapeDist(s, probe) === 0)) return true;
    }
  }

  return false;
}

/**
 * The point two segments share, if any.
 *
 * Only endpoints are considered. A partial collinear *overlap* — two tracks
 * lying along each other rather than meeting — is a shorting or clearance
 * problem, and those tests own it.
 */
function sharedEndpoint(a: { start: Vec2; end: Vec2 }, b: { start: Vec2; end: Vec2 }): Vec2 | null {
  const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

  for (const p of [a.start, a.end]) for (const q of [b.start, b.end]) if (same(p, q)) return p;

  return null;
}

/**
 * The angle between two track segments meeting at `at`.
 *
 * Both directions are taken *away* from the joint, so a straight-through pair
 * reads 180° and a hairpin reads 0°. When the joint is not an endpoint of one
 * of them — a T junction — upstream folds an obtuse reading back below 90°,
 * because the two arms of the crossed track are the same line and only the
 * sharper side is a manufacturing problem.
 */
function jointAngle(
  a: { start: Vec2; end: Vec2 },
  b: { start: Vec2; end: Vec2 },
  at: Vec2,
): number {
  const unit = (from: Vec2, to: Vec2): Vec2 => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };
  const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

  let da = unit(a.start, a.end);
  let db = unit(b.start, b.end);
  let belowNinety = false;

  if (same(a.end, at)) da = { x: -da.x, y: -da.y };
  else if (!same(a.start, at)) belowNinety = true;

  if (same(b.end, at)) db = { x: -db.x, y: -db.y };
  else if (!same(b.start, at)) belowNinety = true;

  const dot = Math.max(-1, Math.min(1, da.x * db.x + da.y * db.y));
  let actual = (Math.acos(dot) * 180) / Math.PI;

  if (belowNinety && actual > 90) actual -= 90;

  return actual;
}

/** One drilled hole, as the SHAPE_SEGMENT upstream models it. */
interface BoardHole {
  /** The slot axis; a and b coincide for a round drill. */
  a: Vec2;
  b: Vec2;
  /** The drill diameter, i.e. the segment's width. */
  width: number;
  /** The hole centre, for the marker. */
  c: Vec2;
  desc: string;
  /** Copper layers, vias only: two blind vias sharing none never interfere. */
  viaLayers?: string[];
  /** Net code, so same-net pairs can be skipped as the RTree filter does. */
  net: number;
}

/** Every drilled hole on the board: via drills and pad drills. */
function boardHoles(board: Board, netName: (n: number) => string): BoardHole[] {
  const out: BoardHole[] = [];

  for (const v of board.vias)
    out.push({
      a: v.at,
      b: v.at,
      width: v.drill,
      c: v.at,
      desc: `Via [${netName(v.net)}]`,
      viaLayers: [...v.layers],
      net: v.net,
    });

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!pad.drill) continue;

      // An oblong drill is a slot: the axis runs along its longer dimension,
      // and the width is the shorter one.
      const { w, h, oblong } = pad.drill;
      const width = oblong ? Math.min(w, h || w) : w;
      const half = oblong ? Math.max(0, (Math.max(w, h || w) - width) / 2) : 0;
      const along = rot(w >= (h || w) ? { x: half, y: 0 } : { x: 0, y: half }, pad.angle);

      out.push({
        a: { x: pad.at.x - along.x, y: pad.at.y - along.y },
        b: { x: pad.at.x + along.x, y: pad.at.y + along.y },
        width,
        c: pad.at,
        desc: `Pad ${pad.number} of ${fp.reference ?? fp.lib}`,
        net: pad.net ?? 0,
      });
    }
  }

  return out;
}

/**
 * EDA_TEXT::GetEffectiveTextPenWidth.
 *
 * A stored thickness of 0 or 1 means "auto": bold is 1/5 of the text width,
 * normal 1/8. The result is then clamped to a quarter of the smaller text
 * dimension, so a hairline-thin setting on tiny text cannot report a pen wider
 * than the glyphs it draws.
 */
function effectiveTextPenWidth(t: PcbTextItem): number {
  let pen = t.thickness ?? 0;

  if (pen <= 1) {
    pen = t.bold
      ? Math.round(Math.min(t.size.x, t.size.y) / 5)
      : Math.round(Math.min(t.size.x, t.size.y) / 8);
  }

  return Math.min(pen, Math.round(Math.min(Math.abs(t.size.x), Math.abs(t.size.y)) * 0.25));
}

/** One text-dimension violation, in upstream's "(min height X; actual Y)" form. */
function textDim(
  code: string,
  what: string,
  limit: number,
  actual: number,
  rule: DrcRule | undefined,
  desc: string,
  pos: Vec2,
): DrcViolation {
  const mm = (iu: number): string =>
    `${iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} mm`;

  return {
    code,
    message: `Text ${code === 'text_height' ? 'height' : 'thickness'} (${what} ${mm(limit)}${rule ? ` (rule '${rule.name}')` : ''}; actual ${mm(actual)})`,
    pos,
    items: [{ desc, pos }],
  };
}

/** One piece of copper the dangling test can connect to. */
interface DanglingCopper {
  net: number;
  layer: string;
  shape: Shape;
  /** Identity, so an item never counts as connected to itself. */
  item: unknown;
  /** Pads and vias are the two kinds a track may sit *inside* rather than end on. */
  padLike: boolean;
  /** A zone fill: a track with both ends in one is redundant, never dangling. */
  zone: boolean;
  /**
   * getMinDist's reference points: a track or arc measures to its nearer
   * *endpoint*, everything else to its position. Measuring to the shape
   * instead reads zero anywhere inside a fat track, which ties the
   * both-ends-hit test and invents dangling ends on short stubs.
   */
  anchors: Vec2[];
}

/** getMinDist: distance from a point to the item's nearest anchor. */
const minDistTo = (c: DanglingCopper, p: Vec2): number =>
  Math.min(...c.anchors.map((a) => Math.hypot(a.x - p.x, a.y - p.y)));

/**
 * Every copper item a track end could be connected to.
 *
 * Layers are resolved to concrete copper here: a `*.Cu` pad is on all of them
 * and a via spans its whole range, so matching the file's tokens literally
 * would miss every track that ends on one.
 */
function danglingCopper(board: Board, copperOrder: string[]): DanglingCopper[] {
  const out: DanglingCopper[] = [];

  for (const t of board.tracks)
    out.push({
      net: t.net,
      layer: t.layer,
      shape: { kind: 'stadium', a: t.start, b: t.end, r: t.width / 2 },
      item: t,
      padLike: false,
      zone: false,
      anchors: [t.start, t.end],
    });

  for (const t of board.arcs)
    out.push({
      net: t.net,
      layer: t.layer,
      shape: arcShape(t.start, t.mid, t.end, t.width),
      item: t,
      padLike: false,
      zone: false,
      anchors: [t.start, t.end],
    });

  for (const v of board.vias)
    for (const layer of viaLayers(v, copperOrder))
      out.push({
        net: v.net,
        layer,
        shape: { kind: 'circle', c: v.at, r: v.size / 2 },
        item: v,
        padLike: true,
        zone: false,
        anchors: [v.at],
      });

  for (const fp of board.footprints)
    for (const pad of fp.pads)
      for (const shape of padShapes(pad))
        for (const layer of copperOrder)
          if (padOnLayer(pad, layer))
            out.push({
              net: pad.net ?? 0,
              layer,
              shape,
              item: pad,
              padLike: true,
              zone: false,
              anchors: [pad.at],
            });

  for (const z of board.zones)
    for (const fill of z.fills)
      for (const poly of fill.polys)
        out.push({
          net: z.net,
          layer: fill.layer,
          shape: { kind: 'poly', pts: poly, r: 0 },
          item: z,
          padLike: false,
          zone: true,
          anchors: [poly[0] ?? { x: 0, y: 0 }],
        });

  return out;
}

/**
 * CONNECTIVITY_DATA::TestTrackEndpointDangling, with `aIgnoreTracksInPads`.
 *
 * A track is dangling when one of its ends reaches nothing. The subtlety
 * upstream warns about is a short segment connected to the *same* item at both
 * ends — that is still dangling, so a hit that covers both ends is credited to
 * whichever end is nearer rather than to both.
 *
 * Returns the unconnected end, or undefined when both ends are connected.
 */
function danglingEnd(
  start: Vec2,
  end: Vec2,
  layer: string,
  net: number,
  accuracy: number,
  self: unknown,
  copper: readonly DanglingCopper[],
): Vec2 | undefined {
  let startCount = 0;
  let endCount = 0;

  const startProbe: Shape = { kind: 'circle', c: start, r: accuracy };
  const endProbe: Shape = { kind: 'circle', c: end, r: accuracy };

  for (const c of copper) {
    if (c.item === self || c.layer !== layer || c.net !== net) continue;

    const hitStart = shapeDist(c.shape, startProbe) === 0;
    const hitEnd = shapeDist(c.shape, endProbe) === 0;

    if (hitStart && hitEnd) {
      // Both ends in a zone: the track may be redundant, but it is not
      // dangling. Both ends under one pad or via: the caller asked us to
      // ignore that too.
      if (c.zone || c.padLike) return undefined;

      // A tie goes to the end, as upstream's strict `<` does.
      if (minDistTo(c, start) < minDistTo(c, end)) startCount++;
      else endCount++;
    } else if (hitStart) {
      startCount++;
    } else if (hitEnd) {
      endCount++;
    }

    if (startCount > 0 && endCount > 0) return undefined;
  }

  return startCount === 0 ? start : end;
}

/** A board graphic's collision geometry, PCB_SHAPE::GetEffectiveShape. */
export function graphicShapes(s: PcbShape): Shape[] {
  const r = s.width / 2;

  switch (s.kind) {
    case 'line':
      return s.start && s.end ? [{ kind: 'stadium', a: s.start, b: s.end, r }] : [];

    case 'circle': {
      if (!s.center || !s.end) return [];
      const rad = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
      // A filled circle is the disc; an unfilled one is the stroked ring, and
      // the ring's *interior* is not part of the shape.
      return s.fill
        ? [{ kind: 'circle', c: s.center, r: rad + r }]
        : [{ kind: 'arc', c: s.center, rad, a0: 0, sweep: 2 * Math.PI, r }];
    }

    case 'arc':
      return s.start && s.mid && s.end ? [arcShape(s.start, s.mid, s.end, s.width)] : [];

    case 'rect':
      if (!s.start || !s.end) return [];
      return [
        {
          kind: 'poly',
          pts: [s.start, { x: s.end.x, y: s.start.y }, s.end, { x: s.start.x, y: s.end.y }],
          r,
        },
      ];

    case 'poly':
      return s.pts && s.pts.length >= 3 ? [{ kind: 'poly', pts: s.pts, r }] : [];

    // A Bezier is stored by its control points; colliding the hull would
    // over-report, so it is left out rather than approximated.
    case 'curve':
      return [];
  }
}

/**
 * The implicit `disallow` rules a board's rule areas imply, as
 * `DRC_ENGINE::loadImplicitRules` builds them: one rule per area, conditioned
 * on the item intersecting it, carrying the area's keepout flags.
 *
 * Upstream gives the rule a whole layer *set*; a DrcRule names one layer, so a
 * multi-layer area becomes one rule per layer — the same thing said longer.
 */
export function ruleAreaRules(board: Board): DrcRule[] {
  const rules: DrcRule[] = [];

  board.zones.forEach((zone, index) => {
    const ko = zone.ruleArea;
    if (!ko || !zone.outline || zone.outline.length < 3) return;

    const disallow: DrcDisallow[] = [];
    if (ko.tracks) disallow.push('track');
    if (ko.vias) disallow.push('via');
    if (ko.pads) disallow.push('pad');
    if (ko.copperPour) disallow.push('zone');
    if (ko.footprints) disallow.push('footprint');

    if (disallow.length === 0) return;

    // The uuid is what upstream keys the condition on. A zone built in memory
    // may not have one yet, so it falls back to its index — which addresses
    // exactly one zone and never collides with a real uuid.
    const selector = zone.uuid ?? `#${index}`;
    const name = zone.name ? `keepout area '${zone.name}'` : 'keepout area';

    for (const layer of zone.layers.length > 0 ? zone.layers : [undefined]) {
      rules.push({
        name,
        layer,
        condition: `A.intersectsArea('${selector}')`,
        constraints: [{ type: 'disallow', value: {}, disallow }],
      });
    }
  });

  return rules;
}

/**
 * PCB_VIA::IsBlindVia / IsBuriedVia. The file has one token for both, so the
 * two are told apart by the span: exactly one outer layer is blind, neither is
 * buried.
 */
function viaSpanKind(v: PcbVia): string {
  if (v.kind === 'micro') return 'micro';
  if (v.kind === 'through') return 'through';

  const outer = (l: string): boolean => l === 'F.Cu' || l === 'B.Cu';
  const [start, end] = v.layers;

  if (outer(start) !== outer(end)) return 'blind';
  if (!outer(start) && !outer(end)) return 'buried';
  return 'through';
}
