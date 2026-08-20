// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Orthogonal ("rubber-band with bends") drag, ported from KiCad's
 * `SCH_MOVE_TOOL::orthoLineDrag` and the loop that drives it
 * (eeschema/tools/sch_move_tool.cpp).
 *
 * Upstream never lets a dragged wire go diagonal in H/V line mode, and the way
 * it manages that is specific: the move is split into an X step and a Y step,
 * and for each partially-dragged wire the *unselected* end is what gets special
 * treatment, the dragged end always follows the cursor exactly, so a wire on a
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
import { makeBus, makeWire, makeWireWithUuid, makeJunctionWithUuid } from './build.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import { symbolPinPositions } from './connect.js';
import { moveSymbolOrFields, moveRigidItems } from './move.js';
import type { MoveSpec } from './connect.js';
import type { EditCommand } from './command.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

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
  /** The wire this one was cloned from, its layer and stroke (SetLastResolvedState). */
  template: SchLine;
  start: Vec2;
  end: Vec2;
  /** STARTPOINT / ENDPOINT: which end the drag carries. */
  startFlag: boolean;
  endFlag: boolean;
  /** The angle the wire had when the drag began (SCH_LINE::StoreAngle). */
  storedAngle: Axis;
}

/**
 * One entry of `m_lineConnectionCache`, tagged with which end of the wire it
 * was found at.
 *
 * Upstream pools both ends into one list, and that pooling is load-bearing:
 * `foundAttachment` counts a pin at the *dragged* end, which is what makes a
 * wire running off a moving symbol bend at its far end instead of sliding
 * bodily. But the rest of orthoLineDrag reasons about the unselected end only,
 * "it's important that we only add items at the unselected end, since that is
 * the only end that is handled specially", and reading a pin or junction from
 * the wrong end there picks the wrong branch. Tagging lets both hold.
 */
type ConnKind = { type: 'line'; key: string } | { type: 'junction' } | { type: 'pin' };
type Conn = ConnKind & { far?: boolean };

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
    // Both ends, as upstream pools them, but each entry remembers whether it
    // came from the unselected ("far") end, which is the only end
    // orthoLineDrag's branch choice is about.
    const half = w.startFlag !== w.endFlag;
    const farPoint = half ? (w.startFlag ? w.end : w.start) : null;
    const conns: Conn[] = [];
    for (const p of [w.start, w.end]) {
      const far = farPoint !== null && same(p, farPoint);
      for (const c of lineKeyAt(p, key)) conns.push({ ...c, far });
      if (sch.junctions.some((j) => same(j.at, p))) conns.push({ type: 'junction', far });
      let pinHere = false;
      for (const sym of sch.symbols) {
        if (symbolPinPositions(sym, libById.get(schSymbolLibraryName(sym))).some((q) => same(q, p)))
          pinHere = true;
      }
      for (const sh of sch.sheets) if (sh.pins.some((q) => same(q.at, p))) pinHere = true;
      if (pinHere) conns.push({ type: 'pin', far });
    }
    cache.set(key, conns);
  }
  return cache;
}

/**
 * One wire, one axis-aligned step of the move, `SCH_MOVE_TOOL::orthoLineDrag`.
 * `bend` carries the per-drag bend counters upstream keeps in the caller.
 */
function orthoLineDrag(
  line: WorkLine,
  delta: Vec2,
  work: Map<string, WorkLine>,
  cache: Map<string, Conn[]>,
  bend: BendState,
  gridIU: number,
  newLine: (at: Vec2, template: SchLine) => WorkLine,
  /**
   * Where a wire's *span* ended up, when the bend handed it to a new segment:
   * old key -> new key. Upstream's
   * `m_specialCaseLabels[label].attachedLine = a`, at the end of this function.
   */
  handover: Map<string, string>,
  /** Labels that end up pinned to the dragged end (`trackMovingEnd`). */
  trackMovingEnd: Set<string>,
  /** Where each riding label sits, so the two cases above can be told apart. */
  labelAt: Map<string, Vec2>,
  ridersOf: Map<string, string[]>,
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
    // What sits at the *far* end decides which branch runs; a pin or junction
    // at the end being dragged says nothing about how to hold the other one.
    if (c.far === false) continue;
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

  if (!preferOriginalLine && foundJunction && !foundPin) {
    // A junction is special-cased to a single new segment leaving the tee.
    //
    // Upstream writes this branch as `!foundLine && foundJunction && !foundPin`
    //, a parallel neighbour, if there is one, absorbs the drag instead. At a
    // junction that is the wrong outcome and is the bug this fixes: a tee
    // almost always *has* a leg parallel to the drag (that is what a tee is),
    // so lengthening it pulls the junction point away from the tee's other
    // legs, stranding them and leaving the junction with nothing to hold. Drag
    // a symbol whose wire runs into a tee and the far branch is abandoned,
    // dangling, with the junction quietly cleaned away.
    //
    // A junction is an explicit statement that several conductors meet *here*,
    // so nothing attached to it may be moved out from under it: the new segment
    // takes the whole movement and every existing leg stays exactly where it
    // is. Deliberately stricter than the line above it in sch_move_tool.cpp.
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
    // A pin (or sheet pin, or anything else): two new segments make the 90 degree
    // bend, its elbow set back from the moved end so parallel drags do not
    // overlap.
    //
    //     int xMove = ( xLength - ( xBendCount * lineGrid.x ) )
    //                     * sign( selectedEnd.x - unselectedEnd.x );
    //     ...
    //     xBendCount += yMoveBit;
    //
    // Upstream advances these counters once per bending wire and never bounds
    // them, which it can afford: `doMoveSelection` moves by `m_cursor - prevPos`
    // — one frame's worth — mutates in place, and resets both counters to 1 each
    // frame. A wire that bent on one frame has a riser parallel to the next
    // frame's delta, so it takes the `foundLine` branch instead and never
    // returns here. Ours is a pure function re-derived from the untouched sheet
    // with the whole accumulated delta, so *every* connected wire arrives here
    // in one pass — 73 of them when U102 of the coldfire demo is dragged, and
    // the raw counter then sets the elbow back further than the wire is long,
    // flipping `xMove`'s sign and throwing it past the moving end. A 5 mm drag
    // moved a wire endpoint 77 mm that way.
    //
    // Clamping the set-back at the wire's length is worse than it looks: every
    // wire that runs out of room parks on the same offset, one grid from its
    // *anchored* end, which is exactly where a net label sits and where its text
    // starts. It put 61 of 73 elbows on that one offset and 33 of 74 risers
    // through label text.
    //
    // So the counter runs as upstream's does and is folded into the room this
    // particular wire has. That keeps the property the counter exists for —
    // "a group of wires all needing their offset one grid movement further out
    // from each other to not overlap" — for every neighbouring pair, since
    // consecutive wires in drag order differ by one step either way. Only wires
    // a whole cycle apart share an offset, and those are far apart on the sheet.
    const xLength = Math.abs(unselectedEnd.x - selectedEnd.x);
    const yLength = Math.abs(unselectedEnd.y - selectedEnd.y);
    const xDir = sign(selectedEnd.x - unselectedEnd.x);
    const yDir = sign(selectedEnd.y - unselectedEnd.y);

    /** Whole grid steps of set-back a wire this long can hold, at least one. */
    const room = (length: number): number => Math.max(1, Math.floor(length / gridIU) - 1);
    /** Upstream's count, folded back into that room. */
    const fold = (count: number, length: number): number => 1 + ((count - 1) % room(length));

    const xMove = (xLength - fold(bend.x, xLength) * gridIU) * xDir;
    const yMove = (yLength - fold(bend.y, yLength) * gridIU) * yDir;

    //     xBendCount += yMoveBit;
    //     yBendCount += xMoveBit;
    //
    // Each axis is stepped by the *other* axis's motion: a drag straight down
    // fans the elbows along x, and only a diagonal one fans both.
    if (delta.y !== 0) bend.x += 1;
    if (delta.x !== 0) bend.y += 1;

    const a = newLine(unselectedEnd, line.template);
    a.start = add(unselectedEnd, { x: xMove, y: yMove });
    a.end = unselectedEnd;
    const b = newLine(a.start, line.template);
    b.start = add(a.start, delta);
    b.end = a.start;
    work.set(a.key, a);
    work.set(b.key, b);

    const shift = { x: delta.x !== 0 ? delta.x : xMove, y: delta.y !== 0 ? delta.y : yMove };
    if (line.startFlag) line.end = add(line.end, shift);
    else line.start = add(line.start, shift);

    cache.set(a.key, conns);
    cache.set(b.key, [{ type: 'line', key: a.key }]);
    cache.set(line.key, [{ type: 'line', key: b.key }]);

    // `a` now covers the span the original wire had, and the original has
    // collapsed towards the pin. Upstream hands its labels over with it:
    //
    //     if( label->GetPosition() == selectedEnd )
    //         m_specialCaseLabels[label].trackMovingEnd = true;
    //     else {
    //         m_specialCaseLabels[label].attachedLine = a;
    //         m_specialCaseLabels[label].originalLineStart = a->GetStartPoint();
    //         ...
    //     }
    //
    // Without it a label keeps pointing at a wire that is no longer where it
    // was: our "put the label back on its wire" repair then dragged every
    // label on the sheet's incoming wires onto the stub beside the pin, one
    // grid step apart, which is the row of labels piling up on a moved sheet.
    for (const id of ridersOf.get(line.key) ?? []) {
      const at = labelAt.get(id);
      if (at && same(at, selectedEnd)) trackMovingEnd.add(id);
      else handover.set(line.key, a.key);
    }
    return;
  }

  if (!foundAttachment) {
    if (line.startFlag) line.end = add(line.end, delta);
    else line.start = add(line.start, delta);
  }
}

/** KiCad's connected-items grid (50 mil), the step bends are offset by. */
const BEND_GRID_IU = 12700;

/**
 * `doMoveSelection`'s two bend counters, threaded through `performItemMove` into
 * every `orthoLineDrag` of one pass:
 *
 *     // Used for tracking how far off a drag end should have its 90 degree elbow added
 *     int xBendCount = 1;
 *     int yBendCount = 1;
 */
interface BendState {
  x: number;
  y: number;
}

function computeOrtho(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  spec: MoveSpec,
  delta: Vec2,
): {
  adjust: EndAdjust[];
  bends: SchLine[];
  /** Label id -> the uuid of the wire that ended up carrying its span. */
  carrierOf: Map<string, string>;
  /** Label ids pinned to the dragged end, which therefore move with it. */
  trackMovingEnd: Set<string>;
} {
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
      uuid: newKiid(),
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
  const bend: BendState = { x: 1, y: 1 };

  // Which labels ride which wire, by working-set key, so a handover knows what
  // it is carrying (upstream reads this off `m_lineConnectionCache[line]`).
  const ridersOf = new Map<string, string[]>();
  const labelAt = new Map<string, Vec2>();
  for (const ride of spec.labelRides) {
    const key = [...work.keys()].find((k) => work.get(k)!.uuid === ride.lineUuid);
    if (!key) continue;
    ridersOf.set(key, [...(ridersOf.get(key) ?? []), ride.id]);
  }
  sch.labels.forEach((l, i) => labelAt.set(refId('label', l.uuid, i), l.at));
  (sch.directiveLabels ?? []).forEach((d, i) => labelAt.set(refId('directive', d.uuid, i), d.at));
  const handover = new Map<string, string>();
  const trackMovingEnd = new Set<string>();

  /**
   * The order `performItemMove` walks the selection in:
   *
   *     for( EDA_ITEM* item : aSelection.GetItemsSortedByTypeAndXY( ( aDelta.x >= 0 ),
   *                                                                 ( aDelta.y >= 0 ) ) )
   *
   * `SELECTION::GetItemsSortedByTypeAndXY` sorts by X, then Y, each in the
   * direction of the drag, tie-breaking on uuid; a line sorts by its *midpoint*
   * (`SCH_LINE::GetSortPosition`).
   *
   * That order is what turns the bend counter into a *linear* fan: dragging
   * downwards, the lowest wire takes the first set-back and the highest the
   * last, so the risers step monotonically one grid apart and never cross. We
   * walked the document instead, which handed the counter an arbitrary
   * sequence — the risers came out in file order, crossing each other, which is
   * the tangle rather than the comb.
   */
  const leftBeforeRight = delta.x >= 0;
  const topBeforeBottom = delta.y >= 0;
  const sortPos = (w: WorkLine): Vec2 => ({
    x: (w.start.x + w.end.x) / 2,
    y: (w.start.y + w.end.y) / 2,
  });
  const inDragOrder = [...work.values()].sort((a, b) => {
    const pa = sortPos(a);
    const pb = sortPos(b);
    if (pa.x !== pb.x) return leftBeforeRight ? pa.x - pb.x : pb.x - pa.x;
    if (pa.y !== pb.y) return topBeforeBottom ? pa.y - pb.y : pb.y - pa.y;
    return a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0;
  });

  for (const step of steps) {
    for (const w of inDragOrder) {
      if (w.isNew || (w.startFlag && w.endFlag) || (!w.startFlag && !w.endFlag)) continue;
      orthoLineDrag(
        w,
        step,
        work,
        cache,
        bend,
        BEND_GRID_IU,
        newLine,
        handover,
        trackMovingEnd,
        labelAt,
        ridersOf,
      );
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
  // Rubber-band stubs from the plan: the wire that keeps a connection alive when
  // a pin, junction or label is pulled away from what it was touching.
  //
  // Upstream flags these IS_NEW | SELECTED_BY_DRAG, which orthoLineDrag skips,
  // so in master they stay straight, but a diagonal wire appearing out of a
  // junction is exactly what H/V line mode exists to prevent, and it is not
  // what the desktop app puts on screen. In this mode we bend the stub into an
  // L (out along X, then Y); free line mode keeps the straight run.
  for (const w of spec.newWires) {
    const moved = add(w.fixed, delta);
    if (delta.x !== 0 && delta.y !== 0) {
      // Leave along the axis that isn't already occupied, so the stub doesn't
      // run back along a wire that is still attached at that point.
      const occupied = (dx: number, dy: number): boolean =>
        sch.lines.some((l) => {
          if (l.kind !== 'wire' && l.kind !== 'bus') return false;
          const other = same(l.start, w.fixed) ? l.end : same(l.end, w.fixed) ? l.start : null;
          if (!other) return false;
          return dx !== 0
            ? other.y === w.fixed.y && Math.sign(other.x - w.fixed.x) === Math.sign(dx)
            : other.x === w.fixed.x && Math.sign(other.y - w.fixed.y) === Math.sign(dy);
        });
      const xFirst = !occupied(delta.x, 0) || occupied(0, delta.y);
      const corner = xFirst ? { x: moved.x, y: w.fixed.y } : { x: w.fixed.x, y: moved.y };
      bends.push(makeWireWithUuid(w.fixed, corner, w.uuid));
      bends.push(makeWire(corner, moved));
    } else {
      bends.push(makeWireWithUuid(w.fixed, moved, w.uuid));
    }
  }
  for (const [, w] of work) {
    if (!w.isNew || same(w.start, w.end)) continue;
    const base =
      w.template.kind === 'bus'
        ? makeBus(w.start, w.end)
        : makeWireWithUuid(w.start, w.end, w.uuid);
    bends.push(w.template.kind === 'bus' ? { ...base, uuid: w.uuid } : base);
  }
  // Resolve each riding label to the wire that ended up with its span, following
  // a chain of handovers (a wire can be handed on more than once, since the move
  // runs as an X step and then a Y step).
  const carrierOf = new Map<string, string>();
  for (const ride of spec.labelRides) {
    let key = [...work.keys()].find((k) => work.get(k)!.uuid === ride.lineUuid);
    if (!key) continue;
    const seen = new Set<string>();
    while (handover.has(key) && !seen.has(key)) {
      seen.add(key);
      key = handover.get(key)!;
    }
    const w = work.get(key);
    if (w) carrierOf.set(ride.id, w.uuid);
  }

  return { adjust, bends, carrierOf, trackMovingEnd };
}

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
  /** Label id -> uuid of the wire that ended up carrying its span. */
  carrierOf: ReadonlyMap<string, string>,
  /** Label ids pinned to the dragged end, which move with it. */
  trackMovingEnd: ReadonlySet<string>,
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
  // The bends are in here too: a handover points a label at the new segment
  // that took over its wire's span, and that segment is one of them.
  for (const l of [...lines, ...splitHalves, ...addBends])
    if (l.uuid !== undefined) movedByUuid.set(l.uuid, l);
  const rideFor = new Map(spec.labelRides.map((r) => [r.id, r]));

  return {
    ...doc,
    // Sheets, no-connects, netclass flags, text boxes, bus entries, images,
    // shapes and tables translate rigidly and identically on every move path.
    ...moveRigidItems(doc, fullIds, delta),
    // A field picked on its own moves inside a symbol that stays put; the whole
    // symbol moves when the symbol itself is selected.
    symbols: doc.symbols.map((s, i) =>
      moveSymbolOrFields(s, refId('symbol', s.uuid, i), fullIds, delta),
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
      if (!ride) return l;
      // Pinned to the end that is being dragged: it follows it.
      if (trackMovingEnd.has(id)) return moveLabel(l, delta);
      // The span may have been handed to a segment the bend created.
      const carrier = movedByUuid.get(carrierOf.get(id) ?? ride.lineUuid);
      if (!carrier) return l;
      if (ride.rigid) return moveLabel(l, delta);
      // The carrier collapsed to nothing. Upstream sees this coming and
      // re-parents the label to the segment that took over the original span
      // (`m_specialCaseLabels[label].attachedLine = a` at the end of
      // orthoLineDrag), and that segment lies exactly where the old wire was —
      // so the label is still on copper and must not be touched. Snapping it to
      // the nearest point of a zero-length segment put it on the moved pin,
      // which is the label teleporting across the sheet when a part is dragged.
      if (carrier.start.x === carrier.end.x && carrier.start.y === carrier.end.y) return l;
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

/** SEG::NearestPoint, where a label lands when its wire shrank past it. */
function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: Math.round(a.x + t * dx), y: Math.round(a.y + t * dy) };
}

/** Everything `computeOrtho` worked out, carried to both directions of the command. */
interface OrthoPlan {
  adjust: EndAdjust[];
  bends: SchLine[];
  carrierOf: ReadonlyMap<string, string>;
  trackMovingEnd: ReadonlySet<string>;
}

function forward(spec: MoveSpec, delta: Vec2, plan: OrthoPlan): EditCommand {
  return {
    label: 'Move',
    apply: (doc) =>
      applyMove(
        doc,
        spec,
        delta,
        plan.adjust,
        plan.bends,
        new Set(),
        false,
        plan.carrierOf,
        plan.trackMovingEnd,
      ),
    invert: () => inverse(spec, delta, plan),
  };
}

function inverse(spec: MoveSpec, delta: Vec2, plan: OrthoPlan): EditCommand {
  const neg = { x: -delta.x, y: -delta.y };
  const back = plan.adjust.map((a) => ({ ...a, to: a.from, from: a.to }));
  const bendIds = new Set(plan.bends.map((b) => b.uuid!));
  return {
    label: 'Move',
    apply: (doc) =>
      applyMove(doc, spec, neg, back, [], bendIds, true, plan.carrierOf, plan.trackMovingEnd),
    invert: () => forward(spec, delta, plan),
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
  return forward(spec, delta, computeOrtho(sch, libById, spec, delta));
}
