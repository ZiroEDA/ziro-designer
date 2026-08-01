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
import { buildRatsnest } from '../ratsnest.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { allowsMissingCourtyard, buildCourtyard } from '../courtyard.js';
import type { Board, PadPrimitive, PcbPad, PcbShape, PcbTextItem, PcbVia } from '../types.js';
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
        const gap = shapeDist(A.it.shape, B.it.shape);
        if (gap < required) {
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
function graphicShapes(s: PcbShape): Shape[] {
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
