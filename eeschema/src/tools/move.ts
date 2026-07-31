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
  SchBusEntry,
  SchImage,
  SchTextBox,
  SchTable,
  LibGraphic,
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
// `at` is the entry's corner and `size` its signed extent, so only `at` moves.
const moveBusEntry = (b: SchBusEntry, d: Vec2): SchBusEntry => ({ ...b, at: add(b.at, d) });
const moveImage = (im: SchImage, d: Vec2): SchImage => ({ ...im, at: add(im.at, d) });
const moveTextBox = (tb: SchTextBox, d: Vec2): SchTextBox => ({
  ...tb,
  start: add(tb.start, d),
  end: add(tb.end, d),
});
// A table's geometry lives entirely in its cells' corners.
const moveTable = (t: SchTable, d: Vec2): SchTable => ({
  ...t,
  cells: t.cells.map((c) => ({ ...c, start: add(c.start, d), end: add(c.end, d) })),
});

/** A graphic shape, translated by whichever points its kind is defined by. */
function moveGraphic(g: LibGraphic, d: Vec2): LibGraphic {
  switch (g.kind) {
    case 'rectangle':
      return { ...g, start: add(g.start, d), end: add(g.end, d) };
    case 'circle':
      return { ...g, center: add(g.center, d) };
    case 'arc':
      return { ...g, start: add(g.start, d), mid: add(g.mid, d), end: add(g.end, d) };
    case 'polyline':
    case 'bezier':
      return { ...g, points: g.points.map((p) => add(p, d)) };
    case 'text':
      return { ...g, at: add(g.at, d) };
  }
}

/**
 * The items that translate rigidly: nothing rubber-bands to them, so a move is
 * a plain offset of their geometry, identical on all three move paths.
 *
 * They are shared here because the paths had drifted apart. Every one of these
 * is in `SCH_COLLECTOR::MovableItems` upstream and `SCH_MOVE_TOOL` translates
 * them all the same way, but the ortho drag path rewrote only symbols, wires,
 * junctions and labels, so dragging a sheet, a no-connect or a netclass flag
 * did nothing at all, and text boxes, bus entries, images, shapes and tables
 * would not move on any path.
 *
 * Returns only the arrays the move actually touched, to spread over the
 * document. A drag calls this on every pointer event and these arrays are
 * almost always untouched, so rebuilding them unconditionally would make each
 * one look changed to anything comparing by identity. An untouched optional
 * field like `directiveLabels` stays absent rather than becoming `[]`.
 */
export function moveRigidItems(
  doc: Schematic,
  ids: ReadonlySet<string>,
  d: Vec2,
): Partial<
  Pick<
    Schematic,
    | 'noConnects'
    | 'sheets'
    | 'directiveLabels'
    | 'busEntries'
    | 'images'
    | 'textBoxes'
    | 'tables'
    | 'graphics'
  >
> {
  /** The array with the selected entries moved, or null if none were. */
  function moved<T>(
    xs: readonly T[] | undefined,
    kind: Parameters<typeof refId>[0],
    uuidOf: (x: T) => string | undefined,
    mv: (x: T) => T,
  ): T[] | null {
    if (!xs) return null;
    let copy: T[] | null = null;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!;
      if (!ids.has(refId(kind, uuidOf(x), i))) continue;
      copy ??= xs.slice();
      copy[i] = mv(x);
    }
    return copy;
  }
  const uuid = (x: { uuid?: string }): string | undefined => x.uuid;

  const out: { -readonly [K in keyof Schematic]?: Schematic[K] } = {};
  const noConnects = moved(doc.noConnects, 'noconnect', uuid, (x) => moveNoConnect(x, d));
  if (noConnects) out.noConnects = noConnects;
  const sheets = moved(doc.sheets, 'sheet', uuid, (x) => moveSheet(x, d));
  if (sheets) out.sheets = sheets;
  const directives = moved(doc.directiveLabels, 'directive', uuid, (x) => moveDirectiveLabel(x, d));
  if (directives) out.directiveLabels = directives;
  const busEntries = moved(doc.busEntries, 'busentry', uuid, (x) => moveBusEntry(x, d));
  if (busEntries) out.busEntries = busEntries;
  const images = moved(doc.images, 'image', uuid, (x) => moveImage(x, d));
  if (images) out.images = images;
  const textBoxes = moved(doc.textBoxes, 'textbox', uuid, (x) => moveTextBox(x, d));
  if (textBoxes) out.textBoxes = textBoxes;
  const tables = moved(doc.tables, 'table', uuid, (x) => moveTable(x, d));
  if (tables) out.tables = tables;
  // Graphics are addressed by index alone: they carry no uuid of their own.
  const graphics = moved(
    doc.graphics,
    'graphic',
    () => undefined,
    (x) => moveGraphic(x, d),
  );
  if (graphics) out.graphics = graphics;
  return out;
}

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
        ...moveRigidItems(doc, ids, delta),
        symbols: doc.symbols.map((s, i) =>
          moveSymbolOrFields(s, refId('symbol', s.uuid, i), ids, delta),
        ),
        lines: doc.lines.map((l, i) =>
          ids.has(refId('line', l.uuid, i)) ? moveLine(l, delta) : l,
        ),
        junctions: doc.junctions.map((j, i) =>
          ids.has(refId('junction', j.uuid, i)) ? moveJunction(j, delta) : j,
        ),
        labels: doc.labels.map((l, i) =>
          ids.has(refId('label', l.uuid, i)) ? moveLabel(l, delta) : l,
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
    ...moveRigidItems(doc, spec.fullIds, delta),
    symbols: doc.symbols.map((s, i) =>
      moveSymbolOrFields(s, refId('symbol', s.uuid, i), spec.fullIds, delta),
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
