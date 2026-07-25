/**
 * Orthogonal ("rubber-band with bends") drag, ported from KiCad's
 * `SCH_MOVE_TOOL::orthoLineDrag` and the loop that drives it
 * (eeschema/tools/sch_move_tool.cpp).
 *
 * Upstream never lets a dragged wire go diagonal in H/V line mode, and the way
 * it manages that is specific: the move is split into an X step and a Y step,
 * and for each partially-dragged wire the *unselected* end is what gets special
 * treatment — the dragged end always follows the cursor exactly, so a wire on a
 * moving symbol pin stays on that pin with its own direction intact. At the far
 * end, in order of preference:
 *
 *   - a connected wire running along the move is lengthened or shortened, and
 *     no new segment appears at all;
 *   - a junction (with no pin) gets one new segment;
 *   - a pin, sheet pin or anything else gets the two-segment 90° bend, stepped
 *     one grid further out per wire so parallel drags don't overlap;
 *   - an unattached wire simply translates.
 *
 * Zero-length wires are a working state of the algorithm (upstream keeps them
 * live during the drag and its cleanup drops them); we drop them at commit.
 */

import type {
  LibSymbol,
  Schematic,
  SchLine,
  SchSymbol,
  SchJunction,
  SchLabel,
  Vec2,
} from '../types.js';
import { refId } from './hittest.js';
import { makeBus, makeWireWithUuid, makeJunctionWithUuid, newUuid } from './build.js';
import { symbolPinPositions } from './connect.js';
import type { MoveSpec } from './connect.js';
import type { EditCommand } from './command.js';

const add = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

interface EndAdjust {
  id: string;
  which: 'start' | 'end';
  from: Vec2;
  to: Vec2;
}

/** Which way a segment runs; a zero-length one counts as horizontal, as EDA_ANGLE does. */
type Axis = 'h' | 'v' | 'd';

function axisOf(a: Vec2, b: Vec2): Axis {
  if (a.y === b.y) return 'h';
  if (a.x === b.x) return 'v';
  return 'd';
}

const lengthOf = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** A wire as the drag works on it: the original ones, plus the segments it adds. */
interface WorkLine {
  key: string;
  uuid: string;
  isNew: boolean;
  /** The wire this one was cloned from — its layer and stroke (SetLastResolvedState). */
  template: SchLine;
  start: Vec2;
  end: Vec2;
  /** STARTPOINT / ENDPOINT: which end the drag carries. */
  startFlag: boolean;
  endFlag: boolean;
  /** The angle the wire had when the drag began (SCH_LINE::StoreAngle). */
  storedAngle: Axis;
}

/** One entry of `m_lineConnectionCache`. */
type Conn = { type: 'line'; key: string } | { type: 'junction' } | { type: 'pin' };

/** The connected-item cache for a dragged wire's endpoints (getConnectedItems). */
function buildCache(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  work: Map<string, WorkLine>,
  spec: MoveSpec,
): Map<string, Conn[]> {
  const cache = new Map<string, Conn[]>();
  const lineKeyAt = (p: Vec2, exclude: string): Conn[] => {
    const out: Conn[] = [];
    sch.lines.forEach((l, i) => {
      const key = refId('line', l.uuid, i);
      if (key === exclude) return;
      if (l.kind !== 'wire' && l.kind !== 'bus') return;
      const w = work.get(key);
      // Only the *unselected* end of another drag wire counts: its dragged end
      // moves normally and doesn't care about connections.
      if (w?.startFlag && same(p, l.start)) return;
      if (w?.endFlag && same(p, l.end)) return;
      if (same(p, l.start) || same(p, l.end)) out.push({ type: 'line', key });
    });
    return out;
  };

  for (const [key, w] of work) {
    if (w.isNew) continue;
    const conns: Conn[] = [];
    for (const p of [w.start, w.end]) {
      conns.push(...lineKeyAt(p, key));
      if (sch.junctions.some((j) => same(j.at, p))) conns.push({ type: 'junction' });
      let pinHere = false;
      sch.symbols.forEach((sym, i) => {
        if (spec.fullIds.has(refId('symbol', sym.uuid, i))) return;
        if (symbolPinPositions(sym, libById.get(sym.libId)).some((q) => same(q, p))) pinHere = true;
      });
      for (const sh of sch.sheets) if (sh.pins.some((q) => same(q.at, p))) pinHere = true;
      if (pinHere) conns.push({ type: 'pin' });
    }
    cache.set(key, conns);
  }
  return cache;
}

/**
 * One wire, one axis-aligned step of the move — `SCH_MOVE_TOOL::orthoLineDrag`.
 * `bend` carries the per-drag bend counters upstream keeps in the caller.
 */
function orthoLineDrag(
  line: WorkLine,
  delta: Vec2,
  work: Map<string, WorkLine>,
  cache: Map<string, Conn[]>,
  bend: { x: number; y: number },
  gridIU: number,
  newLine: (at: Vec2, template: SchLine) => WorkLine,
): void {
  const deltaAxis: Axis = delta.x !== 0 ? 'h' : 'v';
  const parallel = (a: Axis): boolean => a === deltaAxis;
  const lineAxis = axisOf(line.start, line.end);
  if (parallel(lineAxis) && lengthOf(line.start, line.end) !== 0) return;

  const unselectedEnd = line.startFlag ? line.end : line.start;
  const selectedEnd = line.startFlag ? line.start : line.end;

  const conns = cache.get(line.key) ?? [];
  let foundAttachment = conns.length > 0;
  let foundJunction = false;
  let foundPin = false;
  let foundLine: WorkLine | null = null;

  for (const c of conns) {
    if (c.type === 'junction') {
      foundJunction = true;
      continue;
    }
    if (c.type === 'pin') {
      foundPin = true;
      continue;
    }
    const cl = work.get(c.key);
    if (!cl) continue;
    const len = lengthOf(cl.start, cl.end);
    // A matching angle on a non-zero-length wire means lengthen/shorten works.
    if (parallel(axisOf(cl.start, cl.end)) && len !== 0) foundLine = cl;
    // A wire this algorithm has already shortened to nothing works too, but a
    // real segment at the right angle is preferred.
    if (!foundLine && len === 0) foundLine = cl;
  }

  // Both the wire and its neighbour collapsed: extend whichever one still runs
  // along the move (the original, if that is the direction it started in).
  const preferOriginalLine =
    !!foundLine &&
    lengthOf(foundLine.start, foundLine.end) === 0 &&
    lengthOf(line.start, line.end) === 0 &&
    parallel(line.storedAngle);

  if (!preferOriginalLine && !foundLine && foundJunction && !foundPin) {
    // A junction alone is special-cased to a single new segment.
    const created = newLine(unselectedEnd, line.template);
    work.set(created.key, created);
    cache.set(created.key, conns);
    cache.set(line.key, [{ type: 'line', key: created.key }]);
    foundLine = created;
    foundAttachment = true;
  }

  if (foundLine && !preferOriginalLine) {
    if (same(foundLine.start, unselectedEnd)) foundLine.start = add(foundLine.start, delta);
    else if (same(foundLine.end, unselectedEnd)) foundLine.end = add(foundLine.end, delta);

    const foundConns = cache.get(foundLine.key) ?? [];
    const bendLine =
      foundConns.length === 1 && foundConns[0]!.type === 'line'
        ? (work.get((foundConns[0] as { type: 'line'; key: string }).key) ?? null)
        : null;

    // Re-merge segments this algorithm added when the pair has collapsed.
    if (foundLine.isNew && lengthOf(foundLine.start, foundLine.end) === 0 && bendLine?.isNew) {
      if (line.startFlag) line.end = bendLine.end;
      else line.start = bendLine.end;
      cache.set(line.key, cache.get(bendLine.key) ?? []);
      work.delete(bendLine.key);
      work.delete(foundLine.key);
      return;
    }
    // Otherwise the unselected end follows too.
    if (line.startFlag) line.end = add(line.end, delta);
    else line.start = add(line.start, delta);
    return;
  }

  if (lengthOf(line.start, line.end) === 0) return; // reuse the collapsed wire

  if (foundAttachment && lineAxis !== 'd') {
    // A pin (or sheet pin, or anything else): two new segments make the 90°
    // bend, offset one grid step per wire so parallel drags don't overlap.
    const xLength = Math.abs(unselectedEnd.x - selectedEnd.x);
    const yLength = Math.abs(unselectedEnd.y - selectedEnd.y);
    const xMove = (xLength - bend.x * gridIU) * sign(selectedEnd.x - unselectedEnd.x);
    const yMove = (yLength - bend.y * gridIU) * sign(selectedEnd.y - unselectedEnd.y);

    const a = newLine(unselectedEnd, line.template);
    a.start = add(unselectedEnd, { x: xMove, y: yMove });
    a.end = unselectedEnd;
    const b = newLine(a.start, line.template);
    b.start = add(a.start, delta);
    b.end = a.start;
    work.set(a.key, a);
    work.set(b.key, b);

    bend.x += delta.y !== 0 ? 1 : 0;
    bend.y += delta.x !== 0 ? 1 : 0;

    const shift = { x: delta.x !== 0 ? delta.x : xMove, y: delta.y !== 0 ? delta.y : yMove };
    if (line.startFlag) line.end = add(line.end, shift);
    else line.start = add(line.start, shift);

    cache.set(a.key, conns);
    cache.set(b.key, [{ type: 'line', key: a.key }]);
    cache.set(line.key, [{ type: 'line', key: b.key }]);
    return;
  }

  if (!foundAttachment) {
    if (line.startFlag) line.end = add(line.end, delta);
    else line.start = add(line.start, delta);
  }
}

/** KiCad's connected-items grid (50 mil), the step bends are offset by. */
const BEND_GRID_IU = 12700;

function computeOrtho(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  spec: MoveSpec,
  delta: Vec2,
): { adjust: EndAdjust[]; bends: SchLine[] } {
  const work = new Map<string, WorkLine>();
  const originals = new Map<string, SchLine>();

  // Every wire is in the working set, not just the dragged ones: upstream's
  // connection cache holds real lines, and orthoLineDrag lengthens or shortens
  // an *unselected* neighbour that runs along the move rather than adding a bend.
  sch.lines.forEach((l, i) => {
    if (l.kind !== 'wire' && l.kind !== 'bus') return;
    const key = refId('line', l.uuid, i);
    const full = spec.fullIds.has(key);
    const ds = full || spec.wireStart.has(key);
    const de = full || spec.wireEnd.has(key);
    originals.set(key, l);
    work.set(key, {
      key,
      uuid: l.uuid ?? key,
      isNew: false,
      template: l,
      start: l.start,
      end: l.end,
      startFlag: ds,
      endFlag: de,
      storedAngle: axisOf(l.start, l.end),
    });
  });

  const cache = buildCache(sch, libById, work, spec);

  let created = 0;
  const newLine = (at: Vec2, template: SchLine): WorkLine => {
    const key = `new:${created++}`;
    return {
      key,
      uuid: newUuid(),
      isNew: true,
      template,
      start: at,
      end: at,
      startFlag: false,
      endFlag: false,
      storedAngle: 'h',
    };
  };

  // Upstream splits the move into an X step and a Y step so nothing ever goes
  // diagonal, and runs the whole drag for each.
  const steps: Vec2[] = [
    { x: delta.x, y: 0 },
    { x: 0, y: delta.y },
  ].filter((d) => d.x !== 0 || d.y !== 0);
  const bend = { x: 0, y: 0 };

  for (const step of steps) {
    for (const [, w] of [...work]) {
      if (w.isNew || (w.startFlag && w.endFlag) || (!w.startFlag && !w.endFlag)) continue;
      orthoLineDrag(w, step, work, cache, bend, BEND_GRID_IU, newLine);
    }
    // Then every selected item moves, including the dragged end of a partially
    // selected wire (the `moveItem` call after orthoLineDrag).
    for (const [, w] of work) {
      if (w.isNew) continue;
      if (w.startFlag) w.start = add(w.start, step);
      if (w.endFlag) w.end = add(w.end, step);
    }
  }

  // Hand back the endpoint changes and the surviving new segments; a segment
  // that ended up with no length is dropped, as the post-move cleanup does.
  const adjust: EndAdjust[] = [];
  for (const [key, w] of work) {
    if (w.isNew) continue;
    const orig = originals.get(key)!;
    if (spec.fullIds.has(key)) continue; // translated wholesale by applyMove
    if (!same(orig.start, w.start))
      adjust.push({ id: key, which: 'start', from: orig.start, to: w.start });
    if (!same(orig.end, w.end)) adjust.push({ id: key, which: 'end', from: orig.end, to: w.end });
  }
  const bends: SchLine[] = [];
  // Rubber-band stubs from the plan (a fixed pin/junction, or a label dragged
  // off a wire). Upstream flags them SELECTED_BY_DRAG | IS_NEW, which
  // orthoLineDrag skips outright — only their start is pinned, so they run
  // straight to the dragged point in H/V mode too.
  for (const w of spec.newWires) {
    bends.push(makeWireWithUuid(w.fixed, add(w.fixed, delta), w.uuid));
  }
  for (const [, w] of work) {
    if (!w.isNew || same(w.start, w.end)) continue;
    const base =
      w.template.kind === 'bus'
        ? makeBus(w.start, w.end)
        : makeWireWithUuid(w.start, w.end, w.uuid);
    bends.push(w.template.kind === 'bus' ? { ...base, uuid: w.uuid } : base);
  }
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
export function orthoMove(
  sch: Schematic,
  spec: MoveSpec,
  delta: Vec2,
  libById: Map<string, LibSymbol> = new Map(),
): EditCommand {
  const { adjust, bends } = computeOrtho(sch, libById, spec, delta);
  return forward(spec, delta, adjust, bends);
}
