// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DRAG_NET_COLLISION_MONITOR` (`eeschema/tools/sch_drag_net_collision.cpp`).
 *
 * A drag can silently rewire a sheet: land a wire end on a junction that
 * already carries another net and the two merge, with nothing on screen to say
 * so. The monitor watches for exactly that and paints it while the drag is
 * still in flight — a red ring at each junction where two nets would meet, a
 * ring-and-line at each connection the drag has PULLED APART, and KiCad's
 * warning cursor for as long as either is showing.
 *
 * Two things make this portable to an immutable model:
 *
 *  - upstream keys its bookkeeping on `SCH_ITEM*` and calls it at the moment
 *    the items have already moved on the live screen. Ours takes the document
 *    twice — as it was when the drag began (`beginDragNetCollision`) and as the
 *    ghost currently shows it (`dragNetCollisionMarkers`) — and keys on
 *    `refId`, which a move preserves because it is the item's uuid;
 *  - `SCH_MOVE_TOOL` passes NO preview net assignments
 *    (`sch_move_tool.cpp:863` calls `Update( previewJunctions, selection )`,
 *    leaving `aPreviewAssignments` empty), so every net code in the analysis is
 *    the one the item had *before* the drag. That is the whole point: a merge
 *    is two ORIGINAL nets arriving at one point, and re-solving connectivity
 *    every frame would answer a different question — and cost a netlist per
 *    mouse move.
 */

import { refId } from './hittest.js';
import { computeNetlist } from '../connectivity/nets.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import { symbolPinPositions } from './connect.js';
import { isExplicitJunction } from './junction_helpers.js';
import type { LibSymbol, Schematic, Vec2 } from '../types.js';

/**
 * `SCH_JUNCTION::GetEffectiveDiameter()` for a junction `PreviewJunctions`
 * has just `new`ed up, in IU. [data]
 *
 * `getEffectiveShape` (`sch_junction.cpp:82-103`) resolves a diameter of 0
 * through `Schematic()->Settings().GetJunctionSize()` — but a preview junction
 * was never added to a screen, so `Schematic()` is null and it falls to
 * `schIUScale.MilsToIU( DEFAULT_JUNCTION_DIAM )`, and `DEFAULT_JUNCTION_DIAM`
 * is 36 (`eeschema/default_values.h:63`). The 170%-of-wire-width clamp below it
 * does apply (a fresh `SCH_ITEM` has `m_connectivity_dirty = false`), but it
 * clamps against `NETCLASS( "" )`'s own wire width, which is far under this.
 *
 * So the collision ring is the same size at every zoom and in every project,
 * and Schematic Setup's junction-dot size does not reach it.
 */
const PREVIEW_JUNCTION_DIAMETER_IU = 36 * 254;

/** `std::max( base * 1.5, 800.0 )`, `sch_drag_net_collision.cpp:426-427`. */
const COLLISION_MARKER_RADIUS_IU = Math.max(PREVIEW_JUNCTION_DIAMETER_IU * 1.5, 800);

/** `std::max( { 800.0, penWidthA, penWidthB } )`, `:565-567`. */
const DISCONNECTION_MARKER_MIN_RADIUS_IU = 800;

/** A junction the drag would merge two nets at. `radius` is upstream's. */
export interface DragNetCollisionRing {
  at: Vec2;
  radius: number;
}

/** A connection the drag has pulled apart: two rings and a line between them. */
export interface DragDisconnectionMark {
  a: Vec2;
  b: Vec2;
  radius: number;
}

export interface DragNetCollisionMarks {
  collisions: DragNetCollisionRing[];
  disconnections: DragDisconnectionMark[];
}

/** `m_originalConnections`: one endpoint of one item touching one of another. */
interface OriginalConnection {
  a: string;
  ai: number;
  b: string;
  bi: number;
}

/**
 * What `Initialize` recorded, to be read on every frame of the drag.
 *
 * `netByItem` is `m_itemNetCodes` and `connections` is `m_originalConnections`;
 * `sheetPath` is kept so the marker pass can say which sheet the codes came
 * from without being handed it again.
 */
export interface DragNetCollisionState {
  netByItem: ReadonlyMap<string, number>;
  connections: readonly OriginalConnection[];
  sheetPath: string;
  /**
   * Where every line ran before the drag.
   *
   * `SCH_MOVE_TOOL` hands `PreviewJunctions` more than the selection: it also
   * passes `m_newDragLines` and `m_changedDragLines` (`sch_move_tool.cpp:846-857`),
   * the rubber-band stubs a drag creates and the existing wires whose ends it
   * stretches. Neither is selected, so neither can be recognised from the
   * selection — but both are exactly "a line whose geometry is not what it was",
   * which is what this remembers.
   */
  lines: ReadonlyMap<string, { a: Vec2; b: Vec2 }>;
}

/**
 * The pens a disconnection ring is sized against — `SCH_ITEM::GetPenWidth()`,
 * which resolves through the schematic's settings and the netclass for every
 * kind that has a stroke.
 *
 * Held as three numbers rather than fetched per item because that is all the
 * kinds below need: a wire and a bus take the netclass pen
 * (`sch_line.cpp:354-372`), and a no-connect, a sheet border, a bus entry and a
 * netclass flag all fall back to `m_DefaultLineWidth`
 * (`sch_no_connect.cpp:94-100`, `sch_sheet.cpp:755-762`, `sch_label.cpp:1734`).
 * A symbol and a junction have no pen of their own and contribute 0, so the
 * 800 IU floor decides those.
 */
export interface DragPenWidths {
  /** `SCHEMATIC_SETTINGS::m_DefaultLineWidth`, IU. */
  defaultLineWidthIU: number;
  /** The default netclass's wire and bus pens, IU. */
  wireWidthIU: number;
  busWidthIU: number;
  /** Per-line netclass overrides, `refId -> width IU`, where a net has one. */
  lineOverrideIU?: ReadonlyMap<string, number>;
}

/** An item as this analysis needs it: where it connects, and how thick it is. */
interface ConnItem {
  id: string;
  /** `GetConnectionPoints()`, in upstream's order — the index is an identity. */
  points: Vec2[];
  /** Set for a line, whose `HitTest` counts a point ANYWHERE along it. */
  seg?: { a: Vec2; b: Vec2 };
  /** `GetPenWidth()`. */
  pen: number;
}

const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** p on segment [a,b], inclusive of the endpoints (`SCH_LINE::HitTest`). */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < 0) return false;
  return dot <= (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
}

/**
 * Every connectable item on the sheet with its connection points, in the order
 * `SCH_ITEM::GetConnectionPoints()` returns them.
 *
 * The set of kinds is `connect.ts`'s `connectionPoints` — `SCH_TEXT` never
 * overrides `IsConnectable()`, so plain graphic text is not here — and the
 * order within an item matters: `m_originalConnections` remembers a point by
 * its INDEX, and the marker pass looks it up again in the dragged document.
 */
function connectableItems(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  pens: DragPenWidths,
): ConnItem[] {
  const out: ConnItem[] = [];
  const linePen = (id: string, kind: string, strokeWidth: number | undefined): number => {
    if (strokeWidth !== undefined && strokeWidth > 0) return strokeWidth;
    const override = pens.lineOverrideIU?.get(id);
    if (override !== undefined) return override;
    if (kind === 'wire') return pens.wireWidthIU;
    if (kind === 'bus') return pens.busWidthIU;
    return pens.defaultLineWidthIU;
  };
  sch.symbols.forEach((s, i) => {
    out.push({
      id: refId('symbol', s.uuid, i),
      points: symbolPinPositions(s, libById.get(schSymbolLibraryName(s))),
      pen: 0,
    });
  });
  sch.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    out.push({
      id,
      points: [l.start, l.end],
      seg: { a: l.start, b: l.end },
      pen: linePen(id, l.kind, l.stroke?.width),
    });
  });
  sch.junctions.forEach((j, i) => {
    out.push({ id: refId('junction', j.uuid, i), points: [j.at], pen: 0 });
  });
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return;
    out.push({ id: refId('label', l.uuid, i), points: [l.at], pen: 0 });
  });
  (sch.directiveLabels ?? []).forEach((d, i) => {
    out.push({ id: refId('directive', d.uuid, i), points: [d.at], pen: pens.defaultLineWidthIU });
  });
  sch.noConnects.forEach((nc, i) => {
    out.push({
      id: refId('noconnect', nc.uuid, i),
      points: [nc.at],
      pen: Math.max(pens.defaultLineWidthIU, 1),
    });
  });
  sch.sheets.forEach((sh, i) => {
    out.push({
      id: refId('sheet', sh.uuid, i),
      points: sh.pins.map((p) => p.at),
      pen: sh.stroke && sh.stroke.width > 0 ? sh.stroke.width : pens.defaultLineWidthIU,
    });
  });
  sch.busEntries.forEach((be, i) => {
    const id = refId('busentry', be.uuid, i);
    out.push({
      id,
      points: [be.at, { x: be.at.x + be.size.x, y: be.at.y + be.size.y }],
      pen: linePen(id, 'busentry', be.stroke?.width),
    });
  });
  return out;
}

/** `SCH_ITEM::IsConnected( p )`, plus a line's own `HitTest` along its length. */
function touches(item: ConnItem, p: Vec2): boolean {
  for (const q of item.points) if (eq(q, p)) return true;
  return item.seg ? onSegment(p, item.seg.a, item.seg.b) : false;
}

/**
 * `SCH_DRAG_NET_COLLISION_MONITOR::Initialize` (`:66-92`).
 *
 * Two things are frozen here, both from the document as it stands *before* the
 * first pixel of movement: which net every item is on, and which items were
 * touching each other. Everything the drag then paints is a comparison against
 * these, never against a re-solved graph.
 */
export function beginDragNetCollision(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  selection: ReadonlySet<string>,
  opts: { sheetPath?: string; pens: DragPenWidths },
): DragNetCollisionState {
  const sheetPath = opts.sheetPath ?? '/';
  // `recordItemNet` asks each item for `Connection( &m_sheetPath )->NetCode()`.
  // A netlist over the whole sheet answers that for every item at once, and an
  // item with no net is simply absent — upstream's `std::nullopt`.
  const netByItem = new Map<string, number>(
    computeNetlist(sch as Schematic, libById as Map<string, LibSymbol>, { sheetPath }).netByItem,
  );
  const lines = new Map<string, { a: Vec2; b: Vec2 }>();
  sch.lines.forEach((l, i) => {
    lines.set(refId('line', l.uuid, i), { a: l.start, b: l.end });
  });
  return {
    netByItem,
    connections: recordOriginalConnections(sch, libById, selection, opts.pens),
    sheetPath,
    lines,
  };
}

/**
 * `previewItems` (`sch_move_tool.cpp:846-857`): the selection, plus the lines
 * the drag has created or reshaped.
 *
 * A stub the drag added is a line the pre-drag document did not have; a
 * stretched wire is one it had, at other coordinates. Upstream keeps two
 * vectors of pointers for the same two things.
 */
export function movedPreviewItems(
  state: DragNetCollisionState,
  preview: Schematic,
  selection: ReadonlySet<string>,
): Set<string> {
  const moved = new Set(selection);
  preview.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    const was = state.lines.get(id);
    if (!was || !eq(was.a, l.start) || !eq(was.b, l.end)) moved.add(id);
  });
  return moved;
}

/**
 * `recordOriginalConnections` (`:474-566`): for every connection point of a
 * selected item, every other connectable item touching that same point.
 *
 * The pair is stored with the two items in a stable order so the same touch is
 * not recorded twice from each side — upstream sorts on the POINTER, which is
 * arbitrary but consistent within one drag; a refId comparison is the same
 * relation and survives being written down.
 *
 * A selection holding anything new or pasted records nothing at all (`:487-503`):
 * those items were not connected to the sheet a moment ago, so every "broken"
 * connection the pass would find is one that never existed.
 */
function recordOriginalConnections(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  selection: ReadonlySet<string>,
  pens: DragPenWidths,
): OriginalConnection[] {
  const items = connectableItems(sch, libById, pens);
  const out: OriginalConnection[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!selection.has(item.id)) continue;
    item.points.forEach((point, index) => {
      for (const other of items) {
        if (other.id === item.id) continue;
        if (!touches(other, point)) continue;
        const oi = other.points.findIndex((q) => eq(q, point));
        // `candidateIndex == npos`: the point is on the other item's length but
        // is not one of its own connection points, so there is nothing to
        // remember an index for.
        if (oi < 0) continue;
        const swap = other.id < item.id || (other.id === item.id && oi < index);
        const rec: OriginalConnection = swap
          ? { a: other.id, ai: oi, b: item.id, bi: index }
          : { a: item.id, ai: index, b: other.id, bi: oi };
        const key = `${rec.a}#${rec.ai}|${rec.b}#${rec.bi}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
    });
  }
  return out;
}

/**
 * `PreviewJunctions` (`junction_helpers.cpp:252-328`), as positions.
 *
 * The candidate points are the connection points of the items that have moved,
 * plus any *existing* connection point the dragged wire now passes over — that
 * second half is what catches a wire dropped ACROSS a pin rather than onto it.
 * Each candidate is then the ordinary junction question, asked of the document
 * as the drag currently leaves it.
 */
export function previewJunctionPoints(
  preview: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  moved: ReadonlySet<string>,
  pens: DragPenWidths,
): Vec2[] {
  const items = connectableItems(preview, libById, pens);
  const movedItems = items.filter((i) => moved.has(i.id));
  if (movedItems.length === 0) return [];

  // `aScreen->GetConnections()`: every connection point of everything NOT
  // moving, deduped (`sch_screen.cpp:1362-1386`).
  const still: Vec2[] = [];
  const stillSeen = new Set<string>();
  for (const item of items) {
    if (moved.has(item.id)) continue;
    for (const p of item.points) {
      const k = `${p.x},${p.y}`;
      if (stillSeen.has(k)) continue;
      stillSeen.add(k);
      still.push(p);
    }
  }

  const pts: Vec2[] = [];
  for (const item of movedItems) {
    for (const p of item.points) pts.push(p);
    if (item.seg) {
      for (const p of still) if (onSegment(p, item.seg.a, item.seg.b)) pts.push(p);
    }
  }

  const out: Vec2[] = [];
  const seen = new Set<string>();
  for (const p of pts) {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (isExplicitJunction(preview, libById, p)) out.push(p);
  }
  return out;
}

/**
 * `analyzeJunction` (`:239-441`), for one preview-junction position.
 *
 * Every item touching the point contributes the net code it had *before* the
 * drag, split by whether it is one of the items being dragged. Two conditions
 * then raise the ring, and they are not the same test:
 *
 *  - `previewCollision`, two or more distinct nets at the point with at least
 *    one of them arriving on a dragged item — the merge about to happen;
 *  - `originalCollision`, a dragged item and a stationary one that were on
 *    DIFFERENT nets, which fires even where one of the two has no live net code
 *    left, and is how a drag that pulls a wire off its driver still warns.
 */
function analyzeJunction(
  point: Vec2,
  items: readonly ConnItem[],
  netByItem: ReadonlyMap<string, number>,
  selection: ReadonlySet<string>,
): DragNetCollisionRing | null {
  const allNets = new Set<number>();
  const movedNets = new Set<number>();
  const movedOriginals = new Set<number>();
  const stationaryOriginals = new Set<number>();

  for (const item of items) {
    if (!touches(item, point)) continue;
    const net = netByItem.get(item.id);
    const selected = selection.has(item.id);
    if (net !== undefined) {
      allNets.add(net);
      if (selected) movedNets.add(net);
      if (selected) movedOriginals.add(net);
      else stationaryOriginals.add(net);
    }
  }

  const previewCollision = movedNets.size > 0 && allNets.size >= 2;
  let originalCollision = false;
  for (const moved of movedOriginals) {
    for (const still of stationaryOriginals) {
      if (moved !== still) {
        originalCollision = true;
        break;
      }
    }
    if (originalCollision) break;
  }

  if (!previewCollision && !originalCollision) return null;
  return { at: point, radius: COLLISION_MARKER_RADIUS_IU };
}

/**
 * `collectDisconnectedMarkers` (`:522-580`): the recorded touches that the drag
 * has separated.
 *
 * A pair is still connected when the two points coincide, or when either item
 * is a line the other's point still lands on — dragging along a wire slides the
 * contact rather than breaking it, and only a pair that fails both is marked.
 */
function collectDisconnections(
  state: DragNetCollisionState,
  items: readonly ConnItem[],
  selection: ReadonlySet<string>,
): DragDisconnectionMark[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: DragDisconnectionMark[] = [];
  for (const c of state.connections) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (!a || !b) continue;
    const pa = a.points[c.ai];
    const pb = b.points[c.bi];
    if (!pa || !pb) continue;
    let connected = eq(pa, pb);
    if (!connected && b.seg) connected = onSegment(pa, b.seg.a, b.seg.b);
    if (!connected && a.seg) connected = onSegment(pb, a.seg.a, a.seg.b);
    if (connected) continue;
    if (!selection.has(a.id) && !selection.has(b.id)) continue;
    out.push({
      a: pa,
      b: pb,
      radius: Math.max(DISCONNECTION_MARKER_MIN_RADIUS_IU, a.pen, b.pen),
    });
  }
  return out;
}

/**
 * `SCH_DRAG_NET_COLLISION_MONITOR::Update` (`:95-197`) without the drawing:
 * the markers the overlay should be showing for this frame of the drag.
 *
 * `preview` is the document as the ghost has it — the items already moved —
 * which is the state upstream's live screen is in when `Update` runs.
 */
export function dragNetCollisionMarkers(
  state: DragNetCollisionState,
  preview: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  selection: ReadonlySet<string>,
  pens: DragPenWidths,
): DragNetCollisionMarks {
  const items = connectableItems(preview, libById, pens);
  const moved = movedPreviewItems(state, preview, selection);
  const collisions: DragNetCollisionRing[] = [];
  for (const point of previewJunctionPoints(preview, libById, moved, pens)) {
    const ring = analyzeJunction(point, items, state.netByItem, selection);
    if (ring) collisions.push(ring);
  }
  return { collisions, disconnections: collectDisconnections(state, items, selection) };
}

/** `markers.empty() && disconnections.empty()` inverted — `m_hasCollision`,
 *  which is the whole of what `AdjustCursor` reads. */
export function hasDragNetCollision(marks: DragNetCollisionMarks): boolean {
  return marks.collisions.length > 0 || marks.disconnections.length > 0;
}

/**
 * The overlay's pen, in DEVICE pixels: `std::max( cfg->m_Selection.
 * drag_net_collision_width, 1 )` (`:181-183`), which the monitor then puts
 * through `m_view->ToWorld` so it is that many pixels at any zoom.
 */
export function dragNetCollisionPenPx(configured: number): number {
  return Math.max(configured, 1);
}

/**
 * The two alphas the overlay strokes and fills with, from the theme colour's
 * own (`:167-171`).
 *
 * `baseAlpha <= 0` is read as 1 — a fully transparent marker would be no
 * marker at all — and both results are clamped to at least 0.05.
 */
export function dragNetCollisionAlphas(baseAlpha: number): { fill: number; stroke: number } {
  const a = baseAlpha <= 0 ? 1 : baseAlpha;
  const clamp = (v: number): number => Math.min(Math.max(v, 0.05), 1);
  return { fill: clamp(a * 0.35), stroke: clamp(a) };
}
