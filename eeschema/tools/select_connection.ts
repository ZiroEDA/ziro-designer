// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Select/Expand Connection" (Ctrl+4) and the connectivity walk behind it.
 * Counterpart: `SCH_SELECTION_TOOL::SelectConnection`,
 * `expandConnectionWithGraph` and `expandConnectionGraphically`
 * (eeschema/tools/sch_selection_tool.cpp), plus `SCH_SCREEN::MarkConnections`
 * for the graphical fallback.
 *
 * Pressing the key repeatedly widens the selection in three steps: first to the
 * wires up to the nearest junction, then up to the nearest pin, then to
 * everything electrically reachable. A step that pulls in nothing new is
 * skipped, so a wire with no junction on it jumps straight to the pin stop
 * rather than making the user press the key twice for no visible change.
 *
 * Items that carry no connectivity at all (notes lines, shapes) expand a
 * different way, by endpoints touching, which is what lets you select one
 * segment of a drawn outline and get the whole outline.
 */

import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { enumeratePins } from '../connectivity/nets.js';
import { refId, sheetPinId } from './hittest.js';
import { analyzePoint, isBusLabelText, isExplicitJunction } from './junction_helpers.js';

/**
 * How far a walk along a wire is allowed to run. `STOP_CONDITION` in
 * sch_selection_tool.h, and the order the three passes are tried in.
 */
export type StopCondition = 'junction' | 'pin' | 'never';

export const STOP_CONDITIONS: readonly StopCondition[] = ['junction', 'pin', 'never'];

const key = (p: Vec2): string => `${p.x},${p.y}`;
const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** p on segment [a,b], endpoints included. */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot >= 0 && dot <= len2;
}

/** The electrical layer an item sits on: a bus and a wire do not connect. */
type Layer = 'wire' | 'bus';

/** A connectable item as the connectivity walk sees it. */
interface ConnItem {
  id: string;
  kind: 'line' | 'busentry' | 'junction' | 'label' | 'sheetpin' | 'noconnect' | 'pin';
  /** SCH_ITEM::GetConnectionPoints. */
  points: Vec2[];
  layer: Layer;
  /** Wires and buses only: the segment, for the endpoint tests. */
  seg?: [Vec2, Vec2];
  /** Pins only: the id of the symbol carrying the pin. */
  symbolId?: string;
  /** Pins only: a no-connect pin propagates nothing (SCH_PIN::ConnectionPropagatesTo). */
  noConnect?: boolean;
  /** Labels only: the text is bus syntax, whether or not it sits on a bus. */
  busLabelText?: boolean;
}

/**
 * Every connectable item on the sheet, with the connection points the
 * connection graph indexes it by.
 *
 * A label or sheet pin whose text is bus syntax and which sits on a bus is a
 * bus item, the same rule `computeNetlist` uses to route it into the bus
 * subgraph rather than onto a wire net; everything else that is not a bus line
 * is a wire item.
 */
function connectableItems(sch: Schematic, libById: Map<string, LibSymbol>): ConnItem[] {
  const out: ConnItem[] = [];
  const buses: [Vec2, Vec2][] = [];

  for (const l of sch.lines) {
    if (l.kind === 'bus') buses.push([l.start, l.end]);
  }
  const onAnyBus = (p: Vec2): boolean => buses.some(([a, b]) => onSegment(p, a, b));

  sch.lines.forEach((l, i) => {
    if (l.kind !== 'wire' && l.kind !== 'bus') return;
    out.push({
      id: refId('line', l.uuid, i),
      kind: 'line',
      points: [l.start, l.end],
      layer: l.kind === 'bus' ? 'bus' : 'wire',
      seg: [l.start, l.end],
    });
  });

  sch.junctions.forEach((j, i) => {
    // A junction takes the layer of whatever passes through it
    // (updateItemConnectivity's LAYER_BUS_JUNCTION switch).
    out.push({
      id: refId('junction', j.uuid, i),
      kind: 'junction',
      points: [j.at],
      layer: onAnyBus(j.at) ? 'bus' : 'wire',
    });
  });

  sch.noConnects.forEach((nc, i) => {
    out.push({
      id: refId('noconnect', nc.uuid, i),
      kind: 'noconnect',
      points: [nc.at],
      layer: 'wire',
    });
  });

  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return; // free text carries no connection
    out.push({
      id: refId('label', l.uuid, i),
      kind: 'label',
      points: [l.at],
      layer: isBusLabelText(l.text) && onAnyBus(l.at) ? 'bus' : 'wire',
      busLabelText: isBusLabelText(l.text),
    });
  });

  // Netclass directive labels connect at their anchor (SCH_DIRECTIVE_LABEL is
  // a label as far as connectivity is concerned, it just names no net).
  (sch.directiveLabels ?? []).forEach((d, i) => {
    out.push({
      id: refId('directive', d.uuid, i),
      kind: 'label',
      points: [d.at],
      layer: 'wire',
      busLabelText: false,
    });
  });

  sch.busEntries.forEach((e, i) => {
    const end = { x: e.at.x + e.size.x, y: e.at.y + e.size.y };
    out.push({
      id: refId('busentry', e.uuid, i),
      kind: 'busentry',
      points: [e.at, end],
      layer: 'wire',
    });
  });

  sch.sheets.forEach((sh, si) => {
    const shId = refId('sheet', sh.uuid, si);
    sh.pins.forEach((p, k) => {
      out.push({
        id: sheetPinId(shId, k),
        kind: 'sheetpin',
        points: [p.at],
        layer: isBusLabelText(p.name) && onAnyBus(p.at) ? 'bus' : 'wire',
      });
    });
  });

  // Symbol pins, including hidden ones: a hidden power pin connects.
  for (const pin of enumeratePins(sch, libById)) {
    out.push({
      id: pin.id,
      kind: 'pin',
      points: [pin.at],
      layer: 'wire',
      symbolId: pin.symId,
      noConnect: pin.electricalType === 'no_connect',
    });
  }

  return out;
}

/**
 * `SCH_ITEM::ConnectedItems`: the adjacency the connection graph builds in
 * `CONNECTION_GRAPH::updateItemConnectivity`.
 *
 * Items are indexed by their connection points and everything sharing a point
 * is mutually connected, with the three special cases upstream adds: a junction
 * also joins wires that merely pass through it (a wire dropped over an existing
 * dot without the topology being updated), a label sitting where two lines
 * overlap joins both rather than being assigned to one arbitrarily, and a bus
 * entry's bus end reaches the bus segment it touches even mid-segment, since
 * the junction algorithm does not split a bus where an entry lands on it.
 */
function buildAdjacency(sch: Schematic, items: ConnItem[]): Map<string, Set<string>> {
  const byId = new Map(items.map((it) => [it.id, it]));
  /** point -> item ids attached there. */
  const atPoint = new Map<string, string[]>();
  const add = (p: Vec2, id: string): void => {
    const k = key(p);
    const arr = atPoint.get(k);
    if (arr) {
      if (!arr.includes(id)) arr.push(id);
    } else {
      atPoint.set(k, [id]);
    }
  };

  for (const it of items) {
    for (const p of it.points) add(p, it.id);
  }

  const lines = items.filter((it) => it.kind === 'line');

  // A junction connects wires passing through it as midpoints.
  for (const j of items) {
    if (j.kind !== 'junction') continue;
    const p = j.points[0]!;
    for (const l of lines) {
      if (onSegment(p, l.seg![0], l.seg![1])) add(p, l.id);
    }
  }

  // A label over two or more overlapping lines connects to all of them.
  for (const lbl of items) {
    if (lbl.kind !== 'label') continue;
    const p = lbl.points[0]!;
    const overlapping = lines.filter((l) => onSegment(p, l.seg![0], l.seg![1]));
    if (overlapping.length < 2) continue;
    for (const l of overlapping) add(p, l.id);
  }

  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let s = adj.get(a);
    if (!s) {
      s = new Set();
      adj.set(a, s);
    }
    s.add(b);
  };

  for (const [k, ids] of atPoint) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const p = { x, y };
    // updateItemConnectivity's pre-scan: is there a bus at this point?
    const busHere = lines.some((l) => l.layer === 'bus' && onSegment(p, l.seg![0], l.seg![1]));

    for (const aId of ids) {
      const a = byId.get(aId)!;
      for (const bId of ids) {
        if (aId === bId) continue;
        const b = byId.get(bId)!;

        // A bus entry landing on a bus connects only to the bus there, so a
        // wire the user happened to overlap on that end is not shorted onto it.
        if (a.kind === 'busentry' && busHere && b.layer !== 'bus') continue;
        if (b.kind === 'busentry' && busHere && a.layer !== 'bus') continue;

        if (!propagatesTo(a, b) || !propagatesTo(b, a)) continue;

        link(aId, bId);
      }
    }
  }

  return adj;
}

/**
 * `SCH_ITEM::ConnectionPropagatesTo`: whether a connection at a shared point
 * carries from `a` into `b`. Sharing a point is not by itself a connection —
 * a wire meeting a bus is a connectivity change, not a net, and the bus entry
 * that spans that change is deliberately kept out of the graph on its bus end
 * (A[7..0] and A7 are different names for different things).
 */
function propagatesTo(a: ConnItem, b: ConnItem): boolean {
  if (a.kind === 'line') return b.kind !== 'line' || a.layer === b.layer;

  if (a.kind === 'busentry') {
    if (b.kind === 'line' && b.layer === 'bus') return false;
    if (b.kind === 'junction' && b.layer === 'bus') return false;
    if (b.kind === 'label' && b.busLabelText) return false;
    if (b.kind === 'busentry') return false;
  }

  // A no-connect pin is an end in itself.
  if (a.kind === 'pin' && a.noConnect) return false;

  return true;
}

/** The parent symbol id of a pin id, or null. */
export function symbolOfPin(id: string): string | null {
  const i = id.lastIndexOf(':pin');
  return i < 0 ? null : id.slice(0, i);
}

export interface ExpandOptions {
  /** Selection-filter predicate; ids it rejects never enter the selection. */
  passesFilter?: (id: string) => boolean;
}

/**
 * `SCH_SELECTION_TOOL::expandConnectionWithGraph`: walk out from the selected
 * connectable items and return everything reached, at one stop condition.
 */
export function expandConnectionWithGraph(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  selected: Iterable<string>,
  stop: StopCondition,
  opts: ExpandOptions = {},
): Set<string> {
  const passes = opts.passesFilter ?? ((): boolean => true);
  const items = connectableItems(sch, libById);
  const byId = new Map(items.map((it) => [it.id, it]));
  const selectedSet = new Set(selected);
  const added = new Set<string>();

  // A selected symbol starts the walk at each of its pins; a selected
  // connectable item starts at itself.
  const startItems: ConnItem[] = [];
  for (const id of selectedSet) {
    const item = byId.get(id);
    if (item) {
      startItems.push(item);
      continue;
    }
    for (const it of items) {
      if (it.kind === 'pin' && it.symbolId === id) startItems.push(it);
    }
  }
  if (startItems.length === 0) return added;

  // Symbols the walk started from: a pin-stopped walk may step away from one of
  // those without immediately bouncing back into it.
  const startSymbols = new Set<string>();
  for (const it of startItems) {
    if (it.symbolId) startSymbols.add(it.symbolId);
  }

  const pinPositions = new Set(
    items.filter((it) => it.kind === 'pin').map((it) => key(it.points[0]!)),
  );

  const isStopPoint = (p: Vec2): boolean => {
    if (stop === 'never') return false;
    if (pinPositions.has(key(p))) return true;
    if (stop === 'pin') return false;
    if (analyzePoint(sch, libById, p).isJunction || isExplicitJunction(sch, libById, p))
      return true;
    for (const it of items) {
      if (it.kind !== 'label' && it.kind !== 'sheetpin' && it.kind !== 'noconnect') continue;
      if (it.points.some((q) => eq(q, p))) return true;
    }
    return false;
  };

  // The first pass refuses to pull a whole symbol in unless the user already
  // had one selected: Ctrl+4 on a wire should give you the wire, not the parts
  // at either end of it.
  const shouldPullInSymbol = (): boolean => stop !== 'junction' || startSymbols.size > 0;

  const adj = buildAdjacency(sch, items);
  const queue: ConnItem[] = [];
  const visited = new Set<string>();
  const enqueue = (it: ConnItem | undefined): void => {
    if (!it || visited.has(it.id)) return;
    visited.add(it.id);
    queue.push(it);
  };
  for (const it of startItems) enqueue(it);

  while (queue.length > 0) {
    const item = queue.shift()!;

    if (item.kind === 'pin' && item.symbolId) {
      if (shouldPullInSymbol() && passes(item.symbolId) && !selectedSet.has(item.symbolId))
        added.add(item.symbolId);
    }

    // A wire gates the walk on its open ends; anything without distinct
    // endpoints passes the walk straight through.
    const isLine = item.kind === 'line';
    const openPoints: Vec2[] = [];
    if (isLine && stop !== 'never') {
      for (const p of item.seg!) {
        if (!isStopPoint(p)) openPoints.push(p);
      }
    }

    for (const nId of adj.get(item.id) ?? []) {
      const neighbor = byId.get(nId)!;

      if (neighbor.kind === 'pin' && neighbor.symbolId) {
        // A pin reached from a wire pulls its symbol in, and the walk does not
        // continue through the symbol to its other pins.
        if (
          shouldPullInSymbol() &&
          passes(neighbor.symbolId) &&
          !selectedSet.has(neighbor.symbolId)
        )
          added.add(neighbor.symbolId);
      }

      if (isLine && stop !== 'never') {
        const sharesOpenPoint = openPoints.some((p) => neighbor.points.some((q) => eq(q, p)));
        if (!sharesOpenPoint) continue;
      }

      enqueue(neighbor);
    }

    if (passes(item.id)) added.add(item.id);
  }

  return added;
}

/** Endpoints an item is joined by when it has no connectivity of its own. */
function graphicEndpoints(sch: Schematic, id: string): Vec2[] | null {
  for (let i = 0; i < sch.lines.length; i++) {
    const l = sch.lines[i]!;
    if (refId('line', l.uuid, i) !== id) continue;
    return l.points && l.points.length > 1 ? [...l.points] : [l.start, l.end];
  }
  for (let i = 0; i < sch.graphics.length; i++) {
    const g = sch.graphics[i]!;
    if (refId('graphic', undefined, i) !== id) continue;
    switch (g.kind) {
      case 'rectangle':
        return [g.start, { x: g.end.x, y: g.start.y }, g.end, { x: g.start.x, y: g.end.y }];
      case 'arc':
        return [g.start, g.end];
      case 'bezier':
        // The two ends of the curve, not its control points.
        return g.points.length > 1 ? [g.points[0]!, g.points[g.points.length - 1]!] : null;
      case 'polyline':
        return [...g.points];
      default:
        // A circle has no endpoints, so it never joins anything.
        return null;
    }
  }
  return null;
}

/**
 * `SCH_SCREEN::MarkConnections` with the second pass off: grow a set of
 * non-connectable items by shared endpoints, which is how a drawn outline
 * selects as a whole.
 */
export function expandConnectionGraphically(
  sch: Schematic,
  selected: Iterable<string>,
  opts: ExpandOptions = {},
): Set<string> {
  const passes = opts.passesFilter ?? ((): boolean => true);
  const added = new Set<string>();

  // Every candidate with endpoints, and the layer it draws on: a bus is never
  // joined to a wire this way either.
  const candidates: { id: string; pts: Vec2[]; layer: string }[] = [];
  sch.lines.forEach((l, i) => {
    candidates.push({
      id: refId('line', l.uuid, i),
      pts: graphicEndpoints(sch, refId('line', l.uuid, i)) ?? [],
      layer: l.kind,
    });
  });
  sch.graphics.forEach((_g, i) => {
    const id = refId('graphic', undefined, i);
    const pts = graphicEndpoints(sch, id);
    if (pts) candidates.push({ id, pts, layer: 'notes' });
  });

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const stack: string[] = [];
  const processed = new Set<string>();
  for (const id of selected) {
    const c = byId.get(id);
    if (c && c.pts.length > 0) stack.push(id);
  }

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (processed.has(id)) continue;
    processed.add(id);
    const item = byId.get(id)!;

    for (const cand of candidates) {
      if (processed.has(cand.id) || cand.id === id) continue;
      if (cand.pts.length === 0) continue;
      if (cand.layer !== item.layer) continue;
      const sharesEndpoint = cand.pts.some((p) => item.pts.some((q) => eq(p, q)));
      if (!sharesEndpoint) continue;
      stack.push(cand.id);
      if (passes(cand.id)) added.add(cand.id);
    }
  }

  return added;
}

/**
 * The ids Ctrl+4 operates on: `expandConnectionGraphTypes`, everything with
 * connectivity plus the symbols and drawn items the two walks can grow.
 */
export function expandableIds(sch: Schematic, libById: Map<string, LibSymbol>): Set<string> {
  const ids = new Set<string>();
  for (const it of connectableItems(sch, libById)) ids.add(it.id);
  sch.symbols.forEach((s, i) => ids.add(refId('symbol', s.uuid, i)));
  sch.lines.forEach((l, i) => {
    if (l.kind !== 'wire' && l.kind !== 'bus') ids.add(refId('line', l.uuid, i));
  });
  sch.graphics.forEach((_g, i) => ids.add(refId('graphic', undefined, i)));
  return ids;
}

/**
 * `SCH_SELECTION_TOOL::SelectConnection` (Ctrl+4): the new selection.
 *
 * The three stop conditions are tried in order and the first that actually
 * grows the selection wins, so pressing the key again always does something
 * visible rather than repeating a stage that had nothing left to add. The
 * original selection is always part of the result.
 */
export function selectConnection(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  selected: Iterable<string>,
  opts: ExpandOptions = {},
): Set<string> {
  // RequestSelection( expandConnectionGraphTypes ): only items the walk knows
  // what to do with survive the action; a sheet or an image in the selection is
  // dropped by it rather than carried along.
  const expandable = expandableIds(sch, libById);
  const original = new Set([...selected].filter((id) => expandable.has(id)));
  if (original.size === 0) return original;

  // Split the selection: items that carry connectivity are walked through the
  // graph, drawn ones (notes lines, shapes) by touching endpoints.
  const connectable = new Set<string>();
  const graphical = new Set<string>();
  const drawnIds = new Set<string>();
  sch.lines.forEach((l, i) => {
    if (l.kind !== 'wire' && l.kind !== 'bus') drawnIds.add(refId('line', l.uuid, i));
  });
  sch.graphics.forEach((_g, i) => drawnIds.add(refId('graphic', undefined, i)));
  for (const id of original) {
    if (drawnIds.has(id)) graphical.add(id);
    else connectable.add(id);
  }

  let graphAdded = new Set<string>();
  if (connectable.size > 0) {
    for (const stop of STOP_CONDITIONS) {
      graphAdded = expandConnectionWithGraph(sch, libById, connectable, stop, opts);
      let grew = false;
      for (const id of graphAdded) {
        if (!connectable.has(id)) {
          grew = true;
          break;
        }
      }
      if (grew) break;
    }
  }

  // When the graph found nothing at all, fall back to the graphical walk for
  // those items too rather than leaving the selection unchanged.
  let graphicalStart = graphical;
  if (graphAdded.size === 0 && connectable.size > 0) {
    graphicalStart = new Set([...connectable, ...graphical]);
  }
  const graphicalAdded = expandConnectionGraphically(sch, graphicalStart, opts);

  const out = new Set<string>(original);
  for (const id of graphAdded) out.add(id);
  for (const id of graphicalAdded) out.add(id);
  return out;
}
