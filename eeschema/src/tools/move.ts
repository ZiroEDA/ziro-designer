// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Move command: translate a set of selected items by a delta (internal units).
 *
 * Translating a symbol also moves its fields, matching KiCad (fields are
 * positioned in absolute coordinates and travel with their parent symbol).
 * The inverse of a move is simply a move by the negated delta, so undo/redo are
 * exact.
 */

import type {
  Schematic,
  SchSymbol,
  SchLine,
  SchJunction,
  SchLabel,
  SchDirectiveLabel,
  SchNoConnect,
  SchSheet,
  SchField,
  Vec2,
} from '../types.js';
import { refId, fieldId } from './hittest.js';
import { makeWireWithUuid, makeJunctionWithUuid } from './build.js';
import type { MoveSpec, StubWire } from './connect.js';
import type { EditCommand } from './command.js';

const add = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

function moveField(f: SchField, d: Vec2): SchField {
  return f.at ? { ...f, at: add(f.at, d) } : f;
}

function moveSymbol(s: SchSymbol, d: Vec2): SchSymbol {
  return { ...s, at: add(s.at, d), fields: s.fields.map((f) => moveField(f, d)) };
}
const moveLine = (l: SchLine, d: Vec2): SchLine => ({
  ...l,
  start: add(l.start, d),
  end: add(l.end, d),
});
const moveJunction = (j: SchJunction, d: Vec2): SchJunction => ({ ...j, at: add(j.at, d) });
const moveNoConnect = (nc: SchNoConnect, d: Vec2): SchNoConnect => ({ ...nc, at: add(nc.at, d) });
const moveLabel = (l: SchLabel, d: Vec2): SchLabel => ({ ...l, at: add(l.at, d) });
// A directive label's fields ride with it (they are positioned absolutely).
const moveDirectiveLabel = (l: SchDirectiveLabel, d: Vec2): SchDirectiveLabel => ({
  ...l,
  at: add(l.at, d),
  fields: l.fields.map((f) => (f.at ? { ...f, at: add(f.at, d) } : f)),
});
// A sheet moves as one rigid part: rectangle, fields, and pins (all absolute).
const moveSheet = (s: SchSheet, d: Vec2): SchSheet => ({
  ...s,
  at: add(s.at, d),
  fields: s.fields.map((f) => moveField(f, d)),
  pins: s.pins.map((p) => ({ ...p, at: add(p.at, d) })),
});

/**
 * A symbol under a move: the whole symbol if it is selected, otherwise only
 * those of its fields that are. KiCad makes SCH_FIELD independently movable
 * (SCH_COLLECTOR::MovableItems), so dragging a reference or footprint text
 * repositions just that text and leaves the symbol where it is.
 */
export function moveSymbolOrFields(
  s: SchSymbol,
  symId: string,
  ids: ReadonlySet<string>,
  d: Vec2,
): SchSymbol {
  if (ids.has(symId)) return moveSymbol(s, d);
  if (!s.fields.some((_f, k) => ids.has(fieldId(symId, k)))) return s;
  return {
    ...s,
    fields: s.fields.map((f, k) => (ids.has(fieldId(symId, k)) ? moveField(f, d) : f)),
  };
}

/** Create a command that moves every item in `ids` by `delta`. */
export function moveItems(ids: ReadonlySet<string>, delta: Vec2): EditCommand {
  return {
    label: 'Move',
    apply(doc: Schematic): Schematic {
      if (ids.size === 0 || (delta.x === 0 && delta.y === 0)) return doc;
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) =>
          moveSymbolOrFields(s, refId('symbol', s.uuid, i), ids, delta),
        ),
        lines: doc.lines.map((l, i) =>
          ids.has(refId('line', l.uuid, i)) ? moveLine(l, delta) : l,
        ),
        junctions: doc.junctions.map((j, i) =>
          ids.has(refId('junction', j.uuid, i)) ? moveJunction(j, delta) : j,
        ),
        noConnects: doc.noConnects.map((nc, i) =>
          ids.has(refId('noconnect', nc.uuid, i)) ? moveNoConnect(nc, delta) : nc,
        ),
        labels: doc.labels.map((l, i) =>
          ids.has(refId('label', l.uuid, i)) ? moveLabel(l, delta) : l,
        ),
        directiveLabels: (doc.directiveLabels ?? []).map((d, i) =>
          ids.has(refId('directive', d.uuid, i)) ? moveDirectiveLabel(d, delta) : d,
        ),
        sheets: doc.sheets.map((s, i) =>
          ids.has(refId('sheet', s.uuid, i)) ? moveSheet(s, delta) : s,
        ),
      };
    },
    invert(): EditCommand {
      return moveItems(ids, { x: -delta.x, y: -delta.y });
    },
  };
}

function applyConnectedMove(
  doc: Schematic,
  spec: MoveSpec,
  delta: Vec2,
  stubs: readonly SchLine[],
  removeStubIds: ReadonlySet<string>,
): Schematic {
  const undoing = removeStubIds.size > 0 || stubs.length === 0;
  const splitByUuid = new Map(spec.splits.map((sp) => [sp.lineUuid, sp]));
  const splitAdded = new Set(spec.splits.map((sp) => sp.newUuid));
  const splitJunctions = new Set(spec.splits.map((sp) => sp.junctionUuid));

  const lines = doc.lines
    .filter(
      (l) =>
        !(
          l.uuid !== undefined &&
          (removeStubIds.has(l.uuid) || (undoing && splitAdded.has(l.uuid)))
        ),
    )
    .map((l, i) => {
      const id = refId('line', l.uuid, i);
      // A wire cut under a dragged label ends at the cut; undo restores it.
      const split = l.uuid !== undefined ? splitByUuid.get(l.uuid) : undefined;
      if (split) return { ...l, end: undoing ? split.originalEnd : split.at };
      if (spec.fullIds.has(id)) return moveLine(l, delta);
      const ms = spec.wireStart.has(id);
      const me = spec.wireEnd.has(id);
      if (!ms && !me) return l;
      return {
        ...l,
        start: ms ? add(l.start, delta) : l.start,
        end: me ? add(l.end, delta) : l.end,
      };
    });
  // The far halves and their junctions, added with the split and removed on undo.
  const splitHalves = undoing
    ? []
    : spec.splits.map((sp) => makeWireWithUuid(sp.at, sp.originalEnd, sp.newUuid));
  const splitDots = undoing
    ? []
    : spec.splits.map((sp) => makeJunctionWithUuid(sp.at, sp.junctionUuid));
  // Riding labels stay at the same parametric spot on their carrier wire
  // (SPECIAL_CASE_LABEL_INFO): translate rigidly with a fully-moved wire and
  // slide proportionally along a stretching one.
  const movedByUuid = new Map<string, SchLine>();
  for (const l of lines) if (l.uuid !== undefined) movedByUuid.set(l.uuid, l);
  const rideFor = new Map(spec.labelRides.map((r) => [r.id, r]));

  return {
    ...doc,
    symbols: doc.symbols.map((s, i) =>
      moveSymbolOrFields(s, refId('symbol', s.uuid, i), spec.fullIds, delta),
    ),
    noConnects: doc.noConnects.map((nc, i) =>
      spec.fullIds.has(refId('noconnect', nc.uuid, i)) ? moveNoConnect(nc, delta) : nc,
    ),
    labels: doc.labels.map((l, i) => {
      const id = refId('label', l.uuid, i);
      if (spec.fullIds.has(id)) return moveLabel(l, delta);
      const ride = rideFor.get(id);
      const carrier = ride ? movedByUuid.get(ride.lineUuid) : undefined;
      if (!ride || !carrier) return l;
      // The whole wire moved: the label goes with it.
      if (ride.rigid) return moveLabel(l, delta);
      // One end was dragged: upstream moves the label by the *fixed* end's
      // delta, zero, and only puts it back on the wire when the wire shrank
      // past it (SCH_MOVE_TOOL's special-case label handling).
      return onSegment(l.at, carrier.start, carrier.end)
        ? l
        : { ...l, at: nearestOnSegment(l.at, carrier.start, carrier.end) };
    }),
    sheets: doc.sheets.map((s, i) =>
      spec.fullIds.has(refId('sheet', s.uuid, i)) ? moveSheet(s, delta) : s,
    ),
    junctions: [
      ...doc.junctions
        .filter((j) => !(undoing && j.uuid !== undefined && splitJunctions.has(j.uuid)))
        .map((j, i) =>
          spec.fullIds.has(refId('junction', j.uuid, i)) ? moveJunction(j, delta) : j,
        ),
      ...splitDots,
    ],
    lines: [...lines, ...stubs, ...splitHalves],
  };
}

/** Is `p` on the segment a→b (KiCad's SCH_LINE::HitTest with 1 IU accuracy)? */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return len2 > 0 && dot >= 0 && dot <= len2;
}

/** SEG::NearestPoint, where a label lands when its wire shrank past it. */
function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: Math.round(a.x + t * dx), y: Math.round(a.y + t * dy) };
}

/**
 * Connection-aware move: moves `spec.fullIds` entirely, drags the coincident
 * endpoints of connected wires (`spec.wireStart` / `spec.wireEnd`), and inserts a
 * rubber-band stub wire (`spec.newWires`, ported from KiCad's `getConnectedDragItems`
 * / `makeNewWire`) anchored at each fixed pin/junction a moved point lands on, so
 * the connection doesn't pull free. Undo removes those stub wires outright rather
 * than negating their length (a zero-length wire is not the same as "never added").
 */
export function moveWithConnections(spec: MoveSpec, delta: Vec2): EditCommand {
  const stubs = spec.newWires.map((w: StubWire) =>
    makeWireWithUuid(w.fixed, add(w.fixed, delta), w.uuid),
  );
  return {
    label: 'Move',
    apply: (doc) =>
      delta.x === 0 && delta.y === 0 && stubs.length === 0
        ? doc
        : applyConnectedMove(doc, spec, delta, stubs, new Set()),
    invert(): EditCommand {
      const neg = { x: -delta.x, y: -delta.y };
      const stubIds = new Set(spec.newWires.map((w) => w.uuid));
      return {
        label: 'Move',
        apply: (doc) => applyConnectedMove(doc, spec, neg, [], stubIds),
        invert: () => moveWithConnections(spec, delta),
      };
    },
  };
}
