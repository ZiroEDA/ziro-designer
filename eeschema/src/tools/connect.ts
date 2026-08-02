// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Connection-aware move planning ("rubber-banding").
 *
 * Grounded in KiCad's `SCH_MOVE_TOOL::getConnectedDragItems`: when an item moves,
 * any wire whose endpoint coincides exactly with one of the moved item's
 * connection points has *that endpoint* dragged along, so the wire stretches and
 * the connection stays intact. Coincidence is exact integer-IU equality, as in
 * KiCad (pins and wire ends land on the grid).
 *
 * `getConnectedDragItems` also handles the case where the *fixed* item at a moved
 * connection point is a symbol pin or a junction rather than another wire: since
 * those can't stretch, it inserts a brand-new zero-length wire there (`makeNewWire`,
 * flagged `SELECTED_BY_DRAG | STARTPOINT`) with one end anchored at the fixed pin
 * and the other end following the drag, the rubber-band stub that keeps a moved
 * wire (or symbol) attached to a fixed pin instead of pulling free of it.
 */

import { symbolTransform, localToWorld } from '@ziroeda/common/src/transform.js';
import type { LibSymbol, SchSymbol, Schematic, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { newUuid } from './build.js';

function unitMatches(
  unit: number,
  bodyStyle: number,
  u: { unit: number; bodyStyle: number },
): boolean {
  return (u.unit === 0 || u.unit === unit) && (u.bodyStyle === 0 || u.bodyStyle === bodyStyle);
}

/** World positions of a placed symbol's pins (its electrical connection points). */
export function symbolPinPositions(sym: SchSymbol, lib: LibSymbol | undefined): Vec2[] {
  if (!lib) return [];
  const t = symbolTransform(sym.angle, sym.mirror);
  const out: Vec2[] = [];
  for (const u of lib.units) {
    if (!unitMatches(sym.unit, sym.bodyStyle, u)) continue;
    for (const pin of u.pins) out.push(localToWorld(sym.at, t, pin.at));
  }
  return out;
}

/** A new rubber-band stub wire anchored at a fixed pin/junction, tracking the drag. */
export interface StubWire {
  uuid: string;
  fixed: Vec2;
}

/**
 * A wire split under a dragged label: the label sat mid-span, so the wire is
 * cut at that point, a junction is dropped there, and a stub wire takes the
 * label away (getConnectedDragItems' label branch → makeNewWire /
 * makeNewJunction).
 */
export interface LineSplit {
  /** The wire being cut. */
  lineUuid: string;
  /** The cut point, the label's anchor. */
  at: Vec2;
  /** Uuid of the far half. */
  newUuid: string;
  /** Uuid of the junction added at the cut. */
  junctionUuid: string;
  /** The original end point, restored on undo. */
  originalEnd: Vec2;
}

/**
 * An unselected label carried by a moved wire (KiCad's SPECIAL_CASE_LABEL_INFO).
 * A wire moving whole takes its labels with it; a wire with only one end
 * dragged leaves them where they are, upstream moves them by the *fixed*
 * end's delta, and only pulls them back onto the wire if it shrank past them.
 */
export interface LabelRide {
  /** The label's stable id. */
  id: string;
  /** The carrying wire's uuid. */
  lineUuid: string;
  /** Whether the whole wire moves (both ends) rather than stretching. */
  rigid: boolean;
}

/** A plan for a connection-aware move: which items move whole, which wire ends drag. */
export interface MoveSpec {
  /** Items (any kind) that move in their entirety. */
  fullIds: ReadonlySet<string>;
  /** Wire ids whose start point should be dragged. */
  wireStart: ReadonlySet<string>;
  /** Wire ids whose end point should be dragged. */
  wireEnd: ReadonlySet<string>;
  /** New stub wires to insert, anchored at a fixed pin/junction not being moved. */
  newWires: readonly StubWire[];
  /** Unselected labels riding a moved wire's body. */
  labelRides: readonly LabelRide[];
  /** Wires cut under a dragged label, each with its junction and far half. */
  splits: readonly LineSplit[];
}

const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * `SCH_ITEM::GetConnectionPoints()` over a set of items: every point at which
 * they make an electrical connection.
 *
 * Only *connectable* items contribute. `SCH_TEXT` never overrides
 * `SCH_ITEM::IsConnectable()` (which returns false), so plain graphic text has
 * no electrical anchor — `getConnectedDragItems` skips it for exactly that
 * reason, and so does the junction/trim pass.
 */
export function connectionPoints(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  ids: ReadonlySet<string>,
): Vec2[] {
  const out: Vec2[] = [];
  sch.symbols.forEach((s, i) => {
    if (ids.has(refId('symbol', s.uuid, i)))
      for (const p of symbolPinPositions(s, libById.get(s.libId))) out.push(p);
  });
  sch.lines.forEach((l, i) => {
    if (ids.has(refId('line', l.uuid, i))) {
      out.push(l.start);
      out.push(l.end);
    }
  });
  sch.junctions.forEach((j, i) => {
    if (ids.has(refId('junction', j.uuid, i))) out.push(j.at);
  });
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return;
    if (ids.has(refId('label', l.uuid, i))) out.push(l.at);
  });
  // Netclass flags connect like labels (getConnectedDragItems groups
  // SCH_DIRECTIVE_LABEL_T with the label types).
  (sch.directiveLabels ?? []).forEach((d, i) => {
    if (ids.has(refId('directive', d.uuid, i))) out.push(d.at);
  });
  sch.noConnects.forEach((nc, i) => {
    if (ids.has(refId('noconnect', nc.uuid, i))) out.push(nc.at);
  });
  // A sheet's pins and a bus entry's two ends are its connection points.
  sch.sheets.forEach((sh, i) => {
    if (ids.has(refId('sheet', sh.uuid, i))) for (const p of sh.pins) out.push(p.at);
  });
  sch.busEntries.forEach((be, i) => {
    if (ids.has(refId('busentry', be.uuid, i))) {
      out.push(be.at);
      out.push({ x: be.at.x + be.size.x, y: be.at.y + be.size.y });
    }
  });
  return out;
}

/**
 * Build a move plan for a selection: collect the connection points of the
 * selected items, then attach the coincident endpoints of any *unselected* wire,
 * and plan a rubber-band stub for any moved point that lands on a fixed
 * (unselected) symbol pin or junction, so that connection isn't pulled apart.
 */
export function planMove(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  ids: ReadonlySet<string>,
): MoveSpec {
  // The moved items' own connection points. A selected no-connect contributes
  // none: getConnectedDragItems treats no-connects as *candidates to join the
  // drag* (below), never as anchors that pull other wires along.
  const anchorIds = new Set(ids);
  sch.noConnects.forEach((nc, i) => anchorIds.delete(refId('noconnect', nc.uuid, i)));
  const points = new Set(connectionPoints(sch, libById, anchorIds).map(key));

  const fullIds = new Set(ids);

  // Unselected no-connect flags and bus entries connected at a moved point
  // join the drag outright (SCH_NO_CONNECT_T / SCH_BUS_*_ENTRY_T branches);
  // a dragged entry's far end carries its own connections along.
  sch.noConnects.forEach((nc, i) => {
    if (fullIds.has(refId('noconnect', nc.uuid, i))) return;
    if (points.has(key(nc.at))) fullIds.add(refId('noconnect', nc.uuid, i));
  });
  sch.busEntries.forEach((be, i) => {
    const id = refId('busentry', be.uuid, i);
    if (fullIds.has(id)) return;
    const end = { x: be.at.x + be.size.x, y: be.at.y + be.size.y };
    if (points.has(key(be.at)) || points.has(key(end))) {
      fullIds.add(id);
      points.add(key(be.at));
      points.add(key(end));
    }
  });

  // An unselected junction at a moved point isolates the drag there: the
  // neighbour wires stay put and only a stub to the junction is made
  // (ptHasUnselectedJunction, the SCH_LINE_T branch breaks early).
  const junctionPts = new Set<string>();
  sch.junctions.forEach((j, i) => {
    if (ids.has(refId('junction', j.uuid, i))) return;
    const k = key(j.at);
    if (points.has(k)) junctionPts.add(k);
  });

  const wireStart = new Set<string>();
  const wireEnd = new Set<string>();
  sch.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    if (fullIds.has(id)) return; // already moving in full
    if (points.has(key(l.start)) && !junctionPts.has(key(l.start))) wireStart.add(id);
    if (points.has(key(l.end)) && !junctionPts.has(key(l.end))) wireEnd.add(id);
  });

  // Fixed (unselected) symbol pins, junctions and sheet pins at a moved point
  // each get one rubber-band stub (KiCad: `if (test->IsConnected(aPoint) &&
  // !newWire)`, a single new wire per point, regardless of how many fixed
  // items touch it there).
  const fixedPoints = new Set<string>(junctionPts);
  sch.symbols.forEach((s, i) => {
    if (ids.has(refId('symbol', s.uuid, i))) return;
    for (const p of symbolPinPositions(s, libById.get(s.libId))) {
      const k = key(p);
      if (points.has(k)) fixedPoints.add(k);
    }
  });
  sch.sheets.forEach((sh, i) => {
    if (ids.has(refId('sheet', sh.uuid, i))) return;
    for (const p of sh.pins) {
      const k = key(p.at);
      if (points.has(k)) fixedPoints.add(k);
    }
  });

  const onSpan = (p: Vec2, a: Vec2, b: Vec2): boolean => {
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross !== 0) return false;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    return len2 > 0 && dot >= 0 && dot <= len2;
  };
  const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

  // A *selected* label sitting along an unselected wire keeps its connection:
  // upstream builds a stub wire at that point and, when the label was mid-span,
  // cuts the wire there and drops a junction (getConnectedDragItems' label
  // branch). A label on a wire's endpoint needs none of this, that wire end is
  // already being dragged with it.
  const splits: LineSplit[] = [];
  const stubPoints = new Set<string>();
  const draggedOnWire = [
    // Free text is not connectable, so it never cuts the wire it happens to
    // lie over (SCH_TEXT::IsConnectable() is false).
    ...sch.labels
      .filter((l, i) => l.kind !== 'text' && ids.has(refId('label', l.uuid, i)))
      .map((l) => l.at),
    ...(sch.directiveLabels ?? [])
      .filter((d, i) => ids.has(refId('directive', d.uuid, i)))
      .map((d) => d.at),
  ];
  draggedOnWire.forEach((labelAt) => {
    for (let li = 0; li < sch.lines.length; li++) {
      const ln = sch.lines[li]!;
      if (ln.kind !== 'wire' && ln.kind !== 'bus') continue;
      const lid = refId('line', ln.uuid, li);
      if (fullIds.has(lid) || wireStart.has(lid) || wireEnd.has(lid)) continue;
      if (samePoint(labelAt, ln.start) || samePoint(labelAt, ln.end)) continue;
      if (!onSpan(labelAt, ln.start, ln.end)) continue;
      stubPoints.add(key(labelAt));
      if (ln.uuid !== undefined) {
        splits.push({
          lineUuid: ln.uuid,
          at: labelAt,
          newUuid: newUuid(),
          junctionUuid: newUuid(),
          originalEnd: ln.end,
        });
      }
      break; // one new wire per point, as upstream does
    }
  });

  const newWires: StubWire[] = [...fixedPoints, ...stubPoints].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { uuid: newUuid(), fixed: { x: x!, y: y! } };
  });

  // Unselected labels carried by a moved wire. A wire moving whole takes them
  // along; a stretching wire leaves them where they are (upstream moves them by
  // the fixed end's delta) and only pulls them back on if it shrank past them.
  const labelRides: LabelRide[] = [];
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return; // not connectable: it never rides a wire
    const id = refId('label', l.uuid, i);
    if (fullIds.has(id)) return;
    sch.lines.forEach((ln, li) => {
      if (ln.uuid === undefined) return;
      const lid = refId('line', ln.uuid, li);
      const rigid = fullIds.has(lid);
      const moving = rigid || wireStart.has(lid) || wireEnd.has(lid);
      if (!moving || !onSpan(l.at, ln.start, ln.end)) return;
      if (labelRides.some((r) => r.id === id)) return; // one carrier per label
      labelRides.push({ id, lineUuid: ln.uuid, rigid });
    });
  });

  return { fullIds, wireStart, wireEnd, newWires, labelRides, splits };
}
