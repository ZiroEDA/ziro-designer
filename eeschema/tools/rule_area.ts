// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a schematic rule area actually *does*: apply a netclass to everything
 * inside it. Counterpart: `eeschema/sch_rule_area.cpp`
 * (`RefreshContainedItemsAndDirectives` / `GetResolvedNetclasses`) and
 * `CONNECTION_SUBGRAPH::GetNetclassesForDriver`, which merges what a rule area
 * says with what the item's own `Netclass` fields say.
 *
 * The mechanism has three parts, and this file is the first two:
 *
 *  1. **The directives on its border.** A rule area takes its netclass from the
 *     netclass directive labels *attached to its outline*, not from ones merely
 *     sitting inside it:
 *
 *         if( GetPolyShape().CollideEdge( labelConnectionPoints[0], nullptr, 5 ) )
 *             addDirective( label );
 *
 *  2. **The items it contains**, which is per item type rather than one blanket
 *     test — a wire counts if the polygon touches the segment at all, a pin or
 *     label if its connection point is inside, a symbol or sheet if the polygon
 *     meets its bounding box.
 *
 *  3. Feeding the result into the netlist, which happens at the call site: the
 *     assignments this produces join the ones directive labels make on their
 *     own, and `computeNetClassOverrides` resolves the lot.
 */

import type { LibGraphic, LibSymbol, Schematic, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { directiveNetclass } from './directive_label.js';
import { symbolPinPositions } from './connect.js';
import { symbolBodyBBox, type BBox } from './bbox.js';

/** A rule area with its index in `sch.graphics`, since graphics carry no uuid. */
export interface RuleArea {
  index: number;
  /** The closed outline, first vertex repeated or not. */
  points: readonly Vec2[];
}

/** Every rule area on the sheet. */
export function ruleAreas(sch: Schematic): RuleArea[] {
  const out: RuleArea[] = [];
  sch.graphics.forEach((g, index) => {
    if (g.ruleArea && g.kind === 'polyline' && g.points.length >= 3)
      out.push({ index, points: g.points });
  });
  return out;
}

/** Is `p` inside the polygon? Even-odd, matching SHAPE_POLY_SET::Collide( pt ). */
export function insidePolygon(points: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Distance from `p` to the segment a→b. */
function distToSegment(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * `SHAPE_POLY_SET::CollideEdge( aPt, nullptr, aClearance )`: is `p` on the
 * outline, within `clearance`? This is what attaches a directive label to a
 * rule area — it has to be *on the border*, not merely inside.
 */
export function onPolygonEdge(points: readonly Vec2[], p: Vec2, clearance: number): boolean {
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (distToSegment(points[j]!, points[i]!, p) <= clearance) return true;
  }
  return false;
}

/** Does the polygon touch the segment a→b — crossing it or containing it? */
function collidesSegment(points: readonly Vec2[], a: Vec2, b: Vec2): boolean {
  if (insidePolygon(points, a) || insidePolygon(points, b)) return true;
  // Otherwise the segment must cross an edge.
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (segmentsCross(points[j]!, points[i]!, a, b)) return true;
  }
  return false;
}

const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return (d1 > 0 !== d2 > 0 || d1 === 0 || d2 === 0) && (d3 > 0 !== d4 > 0 || d3 === 0 || d4 === 0);
}

/** Does the polygon touch this box — the SHAPE_RECT arm for symbols and sheets? */
function collidesBox(points: readonly Vec2[], b: BBox): boolean {
  const corners: Vec2[] = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  if (corners.some((c) => insidePolygon(points, c))) return true;
  // Or any vertex of the polygon is inside the box.
  if (points.some((p) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY))
    return true;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const c = corners[(i + 1) % corners.length]!;
    if (collidesSegment(points, a, c)) return true;
  }
  return false;
}

/**
 * `SCH_RULE_AREA::GetResolvedNetclasses`: the netclass names declared by the
 * directive labels attached to this area's border.
 *
 * Upstream reads the `Netclass` field of each attached directive; a directive
 * with no such field, or an empty one, contributes nothing.
 */
export function ruleAreaNetclasses(sch: Schematic, area: RuleArea): string[] {
  // `CollideEdge( pt, nullptr, 5 )` — five internal units of slack.
  const CLEARANCE = 5;
  const out: string[] = [];
  for (const flag of sch.directiveLabels ?? []) {
    if (!onPolygonEdge(area.points, flag.at, CLEARANCE)) continue;
    const netClass = directiveNetclass(flag);
    if (netClass) out.push(netClass);
  }
  return out;
}

/**
 * The ids of the items a rule area contains, by the per-type rules
 * `RefreshContainedItemsAndDirectives` uses.
 *
 * Only the connectable kinds matter for a netclass: wires and buses, pins,
 * labels, and the symbols and sheets whose boxes the area meets (a contained
 * symbol also contributes the pins of its own that fall inside).
 */
export function ruleAreaItems(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  area: RuleArea,
): string[] {
  const pts = area.points;
  const out: string[] = [];

  sch.lines.forEach((l, i) => {
    if (l.kind !== 'wire' && l.kind !== 'bus') return;
    if (collidesSegment(pts, l.start, l.end)) out.push(refId('line', l.uuid, i));
  });

  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return;
    if (insidePolygon(pts, l.at)) out.push(refId('label', l.uuid, i));
  });

  sch.symbols.forEach((s, i) => {
    const id = refId('symbol', s.uuid, i);
    const lib = libById?.get(s.libId);
    if (!collidesBox(pts, symbolBodyBBox(s, lib))) return;
    out.push(id);
    // "Add child pins which are within the rule area".
    symbolPinPositions(s, lib).forEach((p, k) => {
      if (insidePolygon(pts, p)) out.push(`${id}:pin${k}`);
    });
  });

  sch.sheets.forEach((sh, i) => {
    const box: BBox = {
      minX: sh.at.x,
      minY: sh.at.y,
      maxX: sh.at.x + sh.size.w,
      maxY: sh.at.y + sh.size.h,
    };
    if (collidesBox(pts, box)) out.push(refId('sheet', sh.uuid, i));
  });

  return out;
}

/**
 * Netclass assignments a sheet's rule areas make, in the shape
 * `computeNetClassOverrides` takes: every net with an item inside an area gets
 * that area's netclass.
 *
 * This is the rule-area half of `GetNetclassesForDriver`; the other half — a
 * netclass field on the driver itself — is what `directiveNetclassAssignments`
 * already produces, and the two lists are simply concatenated at the call site,
 * exactly as upstream concatenates them before sorting.
 */
export function ruleAreaNetclassAssignments(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  netlist:
    | { netByItem: ReadonlyMap<string, number>; nets: readonly { code: number; name: string }[] }
    | null
    | undefined,
): { pattern: string; netClass: string }[] {
  if (!netlist) return [];
  const out: { pattern: string; netClass: string }[] = [];
  const seen = new Set<string>();

  for (const area of ruleAreas(sch)) {
    const classes = ruleAreaNetclasses(sch, area);
    if (classes.length === 0) continue;
    const names = new Set<string>();
    for (const id of ruleAreaItems(sch, libById, area)) {
      const code = netlist.netByItem.get(id);
      if (code === undefined) continue;
      const net = netlist.nets.find((n) => n.code === code);
      if (net?.name) names.add(net.name);
    }
    for (const netClass of classes) {
      for (const pattern of names) {
        const key = `${pattern} ${netClass}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ pattern, netClass });
      }
    }
  }
  return out;
}

/** Convenience for a caller that only has the graphic. */
export function isRuleArea(g: LibGraphic): boolean {
  return !!g.ruleArea;
}
