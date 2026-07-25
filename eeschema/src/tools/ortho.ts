/**
 * Orthogonal ("rubber-band with bends") move, faithful to KiCad's
 * `SCH_MOVE_TOOL::orthoLineDrag`. In H/V line mode KiCad never lets a dragged
 * wire go diagonal: it keeps the wire on its own axis and adds a 90° bend segment
 * for the perpendicular part of the move.
 *
 * For each wire with a dragged endpoint:
 *   - both ends dragged  -> translate the whole wire by the delta.
 *   - horizontal wire    -> slide the dragged end by Δx (stays horizontal) and add
 *                           a vertical bend of Δy out to the pin.
 *   - vertical wire      -> slide the dragged end by Δy and add a horizontal bend.
 *   - parallel/diagonal  -> just move the endpoint (no bend needed/possible).
 */

import type { Schematic, SchLine, SchSymbol, SchJunction, SchLabel, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { makeWire, makeWireWithUuid, makeJunctionWithUuid } from './build.js';
import type { MoveSpec } from './connect.js';
import type { EditCommand } from './command.js';

const add = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

interface EndAdjust {
  id: string;
  which: 'start' | 'end';
  from: Vec2;
  to: Vec2;
}

function computeOrtho(
  sch: Schematic,
  spec: MoveSpec,
  delta: Vec2,
): { adjust: EndAdjust[]; bends: SchLine[] } {
  const adjust: EndAdjust[] = [];
  const bends: SchLine[] = [];

  // Rubber-band stubs anchored at a fixed pin/junction (see connect.ts). In H/V
  // line mode KiCad's orthoLineDrag never leaves a diagonal, so a stub whose drag
  // is diagonal becomes an orthogonal L-bend: one segment out from the fixed point
  // and a second turning to reach the dragged point. A pure H or V drag stays a
  // single segment. (In free mode moveWithConnections draws the straight stub.)
  for (const w of spec.newWires) {
    const moved = add(w.fixed, delta);
    if (delta.x !== 0 && delta.y !== 0) {
      const corner = { x: moved.x, y: w.fixed.y }; // horizontal-first, like the split X-then-Y move
      bends.push(makeWireWithUuid(w.fixed, corner, w.uuid));
      bends.push(makeWire(corner, moved));
    } else {
      bends.push(makeWireWithUuid(w.fixed, moved, w.uuid));
    }
  }

  sch.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    if (spec.fullIds.has(id)) return;
    const ds = spec.wireStart.has(id);
    const de = spec.wireEnd.has(id);
    if (!ds && !de) return;

    if (ds && de) {
      adjust.push({ id, which: 'start', from: l.start, to: add(l.start, delta) });
      adjust.push({ id, which: 'end', from: l.end, to: add(l.end, delta) });
      return;
    }

    const which = ds ? 'start' : 'end';
    const P = ds ? l.start : l.end; // dragged end (on the pin)
    const F = ds ? l.end : l.start; // fixed end
    const pin = add(P, delta);
    const horizontal = P.y === F.y && P.x !== F.x;
    const vertical = P.x === F.x && P.y !== F.y;

    if (horizontal && delta.y !== 0) {
      const corner = { x: P.x + delta.x, y: P.y };
      adjust.push({ id, which, from: P, to: corner });
      bends.push(makeWire(corner, pin));
    } else if (vertical && delta.x !== 0) {
      const corner = { x: P.x, y: P.y + delta.y };
      adjust.push({ id, which, from: P, to: corner });
      bends.push(makeWire(corner, pin));
    } else {
      adjust.push({ id, which, from: P, to: pin });
    }
  });

  return { adjust, bends };
}

const moveSymbol = (s: SchSymbol, d: Vec2): SchSymbol => ({
  ...s,
  at: add(s.at, d),
  fields: s.fields.map((f) => (f.at ? { ...f, at: add(f.at, d) } : f)),
});
const moveJunction = (j: SchJunction, d: Vec2): SchJunction => ({ ...j, at: add(j.at, d) });
const moveLabel = (l: SchLabel, d: Vec2): SchLabel => ({ ...l, at: add(l.at, d) });

function applyMove(
  doc: Schematic,
  spec: MoveSpec,
  delta: Vec2,
  adjust: EndAdjust[],
  addBends: SchLine[],
  removeBendIds: ReadonlySet<string>,
  undoing: boolean,
): Schematic {
  const fullIds = spec.fullIds;
  const splitByUuid = new Map(spec.splits.map((sp) => [sp.lineUuid, sp]));
  const splitAdded = new Set(spec.splits.map((sp) => sp.newUuid));
  const splitJunctions = new Set(spec.splits.map((sp) => sp.junctionUuid));

  const lines = doc.lines
    .filter((l, i) => !removeBendIds.has(refId('line', l.uuid, i)))
    .filter((l) => !(undoing && l.uuid !== undefined && splitAdded.has(l.uuid)))
    .map((l, i) => {
      const id = refId('line', l.uuid, i);
      // A wire cut under a dragged label (see connect.ts); undo restores it.
      const split = l.uuid !== undefined ? splitByUuid.get(l.uuid) : undefined;
      if (split) return { ...l, end: undoing ? split.originalEnd : split.at };
      if (fullIds.has(id)) return { ...l, start: add(l.start, delta), end: add(l.end, delta) };
      let nl = l;
      for (const a of adjust) if (a.id === id) nl = { ...nl, [a.which]: a.to };
      return nl;
    });
  const splitHalves = undoing
    ? []
    : spec.splits.map((sp) => makeWireWithUuid(sp.at, sp.originalEnd, sp.newUuid));
  const splitDots = undoing
    ? []
    : spec.splits.map((sp) => makeJunctionWithUuid(sp.at, sp.junctionUuid));

  const movedByUuid = new Map<string, SchLine>();
  for (const l of [...lines, ...splitHalves]) if (l.uuid !== undefined) movedByUuid.set(l.uuid, l);
  const rideFor = new Map(spec.labelRides.map((r) => [r.id, r]));

  return {
    ...doc,
    symbols: doc.symbols.map((s, i) =>
      fullIds.has(refId('symbol', s.uuid, i)) ? moveSymbol(s, delta) : s,
    ),
    junctions: [
      ...doc.junctions
        .filter((j) => !(undoing && j.uuid !== undefined && splitJunctions.has(j.uuid)))
        .map((j, i) => (fullIds.has(refId('junction', j.uuid, i)) ? moveJunction(j, delta) : j)),
      ...splitDots,
    ],
    labels: doc.labels.map((l, i) => {
      const id = refId('label', l.uuid, i);
      if (fullIds.has(id)) return moveLabel(l, delta);
      // Labels carried by a moved wire, as in moveWithConnections: rigid with a
      // wire that moved whole, otherwise left in place and only pulled back on
      // when the wire no longer runs through them.
      const ride = rideFor.get(id);
      const carrier = ride ? movedByUuid.get(ride.lineUuid) : undefined;
      if (!ride || !carrier) return l;
      if (ride.rigid) return moveLabel(l, delta);
      return onSegment(l.at, carrier.start, carrier.end)
        ? l
        : { ...l, at: nearestOnSegment(l.at, carrier.start, carrier.end) };
    }),
    lines: [...lines, ...addBends, ...splitHalves],
  };
}

/** Is `p` on the segment a→b (SCH_LINE::HitTest with 1 IU accuracy)? */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return len2 > 0 && dot >= 0 && dot <= len2;
}

/** SEG::NearestPoint — where a label lands when its wire shrank past it. */
function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: Math.round(a.x + t * dx), y: Math.round(a.y + t * dy) };
}

function forward(spec: MoveSpec, delta: Vec2, adjust: EndAdjust[], bends: SchLine[]): EditCommand {
  return {
    label: 'Move',
    apply: (doc) => applyMove(doc, spec, delta, adjust, bends, new Set(), false),
    invert: () => inverse(spec, delta, adjust, bends),
  };
}

function inverse(spec: MoveSpec, delta: Vec2, adjust: EndAdjust[], bends: SchLine[]): EditCommand {
  const neg = { x: -delta.x, y: -delta.y };
  const back = adjust.map((a) => ({ ...a, to: a.from, from: a.to }));
  const bendIds = new Set(bends.map((b) => b.uuid!));
  return {
    label: 'Move',
    apply: (doc) => applyMove(doc, spec, neg, back, [], bendIds, true),
    invert: () => forward(spec, delta, adjust, bends),
  };
}

/**
 * Build an orthogonal move command: moves the selected items and keeps connected
 * wires orthogonal by sliding their dragged ends along-axis and adding 90° bends.
 * Computed against `sch`; undo is exact (it removes the bends and reverses).
 */
export function orthoMove(sch: Schematic, spec: MoveSpec, delta: Vec2): EditCommand {
  const { adjust, bends } = computeOrtho(sch, spec, delta);
  return forward(spec, delta, adjust, bends);
}
