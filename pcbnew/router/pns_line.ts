// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The geometry the push-and-shove router drags a track with. Counterparts:
 * `pcbnew/router/pns_line.cpp` (LINE::DragCorner / LINE::DragSegment and their
 * helpers) over `libs/kimath/src/geometry/shape_line_chain.cpp`.
 *
 * A LINE is upstream's chain of connected same-net segments; here it is a plain
 * array of points, since the interactive drag never needs the arc machinery the
 * real SHAPE_LINE_CHAIN carries. Everything else, which corner moves, where the
 * 45° knees land, how the neighbours are re-cut, follows upstream exactly.
 *
 * Not ported: dragging arcs (LINE::DragArc) and the collision response the
 * router layers on top (shove / walk-around); this is the free-space geometry
 * that DM_MARK_OBSTACLES drags with.
 */

import { Direction45, AngleType } from '@ziroeda/kimath/src/geometry/direction45.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ----- SEG (libs/kimath/include/geometry/seg.h) --------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const equal = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const norm = (a: Vec2): number => Math.hypot(a.x, a.y);

export interface Seg {
  a: Vec2;
  b: Vec2;
}

/** SEG::IntersectLines, where the *infinite* lines meet, or null if parallel. */
export function intersectLines(s1: Seg, s2: Seg): Vec2 | null {
  const d1 = sub(s1.b, s1.a);
  const d2 = sub(s2.b, s2.a);
  const denom = cross(d1, d2);
  if (denom === 0) return null;
  const t = cross(sub(s2.a, s1.a), d2) / denom;
  return { x: s1.a.x + d1.x * t, y: s1.a.y + d1.y * t };
}

/** SEG::Intersect, the crossing point when it lies on *both* segments. */
export function intersectSegs(s1: Seg, s2: Seg): Vec2 | null {
  const d1 = sub(s1.b, s1.a);
  const d2 = sub(s2.b, s2.a);
  const denom = cross(d1, d2);
  if (denom === 0) return null;
  const t = cross(sub(s2.a, s1.a), d2) / denom;
  const u = cross(sub(s2.a, s1.a), d1) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: s1.a.x + d1.x * t, y: s1.a.y + d1.y * t };
}

/** SEG::LineDistance, distance from a point to the segment's infinite line. */
export function lineDistance(s: Seg, p: Vec2): number {
  const d = sub(s.b, s.a);
  const len = norm(d);
  if (len === 0) return norm(sub(p, s.a));
  return Math.abs(cross(d, sub(p, s.a))) / len;
}

/** Is `p` on segment a-b (within `tolerance`)? TestSegmentHit. */
function onSegment(p: Vec2, a: Vec2, b: Vec2, tolerance: number): boolean {
  const d = sub(b, a);
  const len2 = d.x * d.x + d.y * d.y;
  if (len2 === 0) return norm(sub(p, a)) <= tolerance;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2));
  return norm(sub(p, { x: a.x + d.x * t, y: a.y + d.y * t })) <= tolerance;
}

// ----- SHAPE_LINE_CHAIN, reduced to a point array -----------------------------

export type Chain = Vec2[];

export const segmentCount = (c: Chain): number => Math.max(0, c.length - 1);

/** CPoint, negative indices count back from the end. */
export const cpoint = (c: Chain, i: number): Vec2 => c[i < 0 ? c.length + i : i]!;

/** CSegment, negative indices count back from the end. */
export const csegment = (c: Chain, i: number): Seg => {
  const idx = i < 0 ? segmentCount(c) + i : i;
  return { a: c[idx]!, b: c[idx + 1]! };
};

/** Slice( a, b ), inclusive of both ends, -1 meaning the last point. */
export function slice(c: Chain, a: number, b: number): Chain {
  const end = b < 0 ? c.length + b : b;
  return c.slice(a, end + 1).map((p) => ({ ...p }));
}

export const reverse = (c: Chain): Chain => [...c].reverse().map((p) => ({ ...p }));

/** Append another chain, dropping the shared joint point. */
export function appendChain(c: Chain, other: Chain): Chain {
  if (c.length === 0) return other.map((p) => ({ ...p }));
  const rest = other.length > 0 && equal(cpoint(c, -1), other[0]!) ? other.slice(1) : other;
  return [...c, ...rest.map((p) => ({ ...p }))];
}

/** Insert a point before index `i` (SHAPE_LINE_CHAIN::Insert). */
export function insert(c: Chain, i: number, p: Vec2): Chain {
  const out = [...c];
  out.splice(i, 0, { ...p });
  return out;
}

/**
 * SHAPE_LINE_CHAIN::Simplify( 0 ), greedily drop every run of points that lies
 * on the straight segment between the points bounding it, which removes both
 * duplicates and collinear knees.
 */
export function simplify(c: Chain, tolerance = 0): Chain {
  if (c.length < 3) return c.map((p) => ({ ...p }));

  const out: Chain = [];
  let start = 0;
  while (start < c.length) {
    out.push({ ...c[start]! });
    if (start === c.length - 2) break;

    let end = start + 2;
    let last = start + 1;
    while (end < c.length) {
      let ok = true;
      for (let test = start + 1; test < end; test++) {
        if (!onSegment(c[test]!, c[start]!, c[end]!, tolerance)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      last = end;
      end++;
    }
    start = last;
  }
  if (!equal(out[out.length - 1]!, c[c.length - 1]!)) out.push({ ...c[c.length - 1]! });
  return out;
}

export const chainLength = (c: Chain): number => {
  let len = 0;
  for (let i = 0; i < segmentCount(c); i++) len += norm(sub(c[i + 1]!, c[i]!));
  return len;
};

// ----- snapping ---------------------------------------------------------------

/**
 * LINE::snapDraggedCorner, pull a dragged corner onto the intersection of two
 * nearby obtuse neighbours, so a drag that nearly closes a knee closes it.
 */
export function snapDraggedCorner(c: Chain, p: Vec2, index: number, threshold: number): Vec2 {
  if (threshold <= 0) return p;

  const first = Math.max(index - 2, 0);
  const last = Math.min(index + 2, segmentCount(c) - 1);
  let bestDist = Number.POSITIVE_INFINITY;
  let best = p;

  for (let i = first; i <= last; i++) {
    const a = csegment(c, i);
    for (let j = first; j < i; j++) {
      const b = csegment(c, j);
      if (!Direction45.fromSeg(a.a, a.b).isObtuse(Direction45.fromSeg(b.a, b.b))) continue;
      const ip = intersectLines(a, b);
      if (!ip) continue;
      const dist = norm(sub(ip, p));
      if (dist < threshold && dist < bestDist) {
        bestDist = dist;
        best = ip;
      }
    }
  }
  return best;
}

/**
 * LINE::snapToNeighbourSegments, a dragged segment snaps flush with the
 * same-direction segment two along, so dragging back into line with a neighbour
 * removes the jog instead of leaving a sliver.
 */
export function snapToNeighbourSegments(c: Chain, p: Vec2, index: number, threshold: number): Vec2 {
  if (threshold === 0) return p;

  const dragged = csegment(c, index);
  const dragDir = Direction45.fromSeg(dragged.a, dragged.b);
  const snapP: (Vec2 | null)[] = [null, null];
  const snapD: number[] = [-1, -1];

  if (index >= 2) {
    const s = csegment(c, index - 2);
    if (Direction45.fromSeg(s.a, s.b).equals(dragDir)) snapD[0] = lineDistance(s, p);
    snapP[0] = s.a;
  }
  if (index < segmentCount(c) - 2) {
    const s = csegment(c, index + 2);
    if (Direction45.fromSeg(s.a, s.b).equals(dragDir)) snapD[1] = lineDistance(s, p);
    snapP[1] = s.a;
  }

  let best = p;
  let minDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 2; i++) {
    if (snapD[i]! >= 0 && snapD[i]! < minDist && snapD[i]! <= threshold) {
      minDist = snapD[i]!;
      best = snapP[i]!;
    }
  }
  return best;
}

// ----- corner drags -----------------------------------------------------------

/**
 * dragCornerInternal, re-route the tail of `origin` to land on `p`, walking
 * back from the end for a knee whose leading direction still agrees with the
 * segment it replaces (or, failing that, one that leaves an obtuse corner).
 */
export function dragCornerInternal(
  origin: Chain,
  p: Vec2,
  preferredEndingDirection: Direction45 = Direction45.UNDEFINED,
): Chain {
  if (origin.length === 1) return Direction45.UNDEFINED.buildInitialTrace(origin[0]!, p);

  if (segmentCount(origin) === 1) {
    const dir = Direction45.fromVector(sub(cpoint(origin, 0), cpoint(origin, 1)));
    return Direction45.UNDEFINED.buildInitialTrace(cpoint(origin, 0), p, dir.isDiagonal());
  }

  let picked: Chain | null = null;
  let i = segmentCount(origin) - 1;

  for (; i >= 0; i--) {
    const seg = csegment(origin, i);
    const dStart = Direction45.fromSeg(seg.a, seg.b);
    const pStart = cpoint(origin, i);
    const dPrev =
      i > 0
        ? Direction45.fromSeg(csegment(origin, i - 1).a, csegment(origin, i - 1).b)
        : Direction45.UNDEFINED;

    const paths: Chain[] = [];
    const dirs: Direction45[] = [];
    for (let j = 0; j < 2; j++) {
      const path = dStart.buildInitialTrace(pStart, p, j === 1);
      if (segmentCount(path) < 1) continue;
      paths.push(path);
      dirs.push(Direction45.fromSeg(csegment(path, 0).a, csegment(path, 0).b));
    }

    // A caller may name the direction it wants the *last* segment of the new
    // knee to leave in; MULTI_DRAGGER asks for the primary line's direction so
    // a whole bundle ends up parallel. Upstream guards the whole block on the
    // hint being defined, so an absent hint is not "match UNDEFINED".
    //
    // Note what the hint can and cannot do. `buildInitialTrace` reads
    // `startDiagonal` only when *its own* direction is undefined, and `dStart`
    // here always comes from a real segment — so the two candidates built above
    // are the same chain, and the hint can never choose between them. What it
    // does is let a *lower* `i` win: without it this iteration only picks when
    // the trace leaves along `dStart` or turns obtusely off `dPrev`, and
    // otherwise the scan walks further back and re-cuts more of the line.
    if (preferredEndingDirection.isDefined()) {
      for (let j = 0; j < paths.length; j++) {
        const last = csegment(paths[j]!, -1);
        if (Direction45.fromSeg(last.a, last.b).equals(preferredEndingDirection)) {
          picked = paths[j]!;
          break;
        }
      }
    }

    if (!picked) {
      for (let j = 0; j < dirs.length; j++) {
        if (dirs[j]!.equals(dStart)) {
          picked = paths[j]!;
          break;
        }
      }
    }
    if (picked) break;

    for (let j = 0; j < dirs.length; j++) {
      if (dirs[j]!.isObtuse(dPrev)) {
        picked = paths[j]!;
        break;
      }
    }
    if (picked) break;
  }

  if (picked) return appendChain(slice(origin, 0, i), picked);

  const dir = Direction45.fromVector(sub(cpoint(origin, -1), cpoint(origin, -2)));
  return Direction45.UNDEFINED.buildInitialTrace(cpoint(origin, 0), p, dir.isDiagonal());
}

/** LINE::dragCornerFree, the corner simply follows the cursor. */
export function dragCornerFree(c: Chain, p: Vec2, index: number): Chain {
  const out = [...c.map((q) => ({ ...q }))];
  out[index] = { ...p };
  return simplify(out);
}

/** LINE::dragCorner45. */
export function dragCorner45(
  c: Chain,
  p: Vec2,
  index: number,
  snapThreshold = 0,
  preferredEndingDirection: Direction45 = Direction45.UNDEFINED,
): Chain {
  const snapped = snapDraggedCorner(c, p, index, snapThreshold);
  let path: Chain;

  if (index === 0) {
    path = reverse(dragCornerInternal(reverse(c), snapped, preferredEndingDirection));
  } else if (index === segmentCount(c)) {
    path = dragCornerInternal(c, snapped, preferredEndingDirection);
  } else {
    path = dragCornerInternal(slice(c, 0, index), snapped, preferredEndingDirection);
    const rev = reverse(
      dragCornerInternal(reverse(slice(c, index, -1)), snapped, preferredEndingDirection),
    );
    path = appendChain(path, rev);
  }
  return simplify(path);
}

/** LINE::DragCorner. */
export function dragCorner(
  c: Chain,
  p: Vec2,
  index: number,
  freeAngle: boolean,
  snapThreshold = 0,
  preferredEndingDirection: Direction45 = Direction45.UNDEFINED,
): Chain {
  return freeAngle
    ? dragCornerFree(c, p, index)
    : dragCorner45(c, p, index, snapThreshold, preferredEndingDirection);
}

// ----- segment drag -----------------------------------------------------------

/**
 * LINE::dragSegment45, slide one segment sideways, re-cutting the neighbours on
 * either side against the guides its own direction allows. Of the four
 * guide pairings the shortest resulting path wins, which is what makes a dragged
 * trace collapse its knees instead of growing them.
 */
export function dragSegment45(c: Chain, p: Vec2, index: number, snapThreshold = 0): Chain {
  let path = c.map((q) => ({ ...q }));
  const target = snapToNeighbourSegments(path, p, index, snapThreshold);
  const origSegmentCount = segmentCount(c);
  let idx = index;

  // A valid previous and next segment is required, so a zero-length one is
  // inserted at either end of the line when the drag is on the first or last.
  if (idx === 0) {
    path = insert(path, 0, cpoint(path, idx));
    idx++;
  }
  if (idx === segmentCount(path) - 1) {
    path = insert(path, path.length - 1, cpoint(path, -1));
  }

  let dragged = csegment(path, idx);
  const dragDir = Direction45.fromSeg(dragged.a, dragged.b);

  let dirPrev = Direction45.fromSeg(csegment(path, idx - 1).a, csegment(path, idx - 1).b);
  let dirNext = Direction45.fromSeg(csegment(path, idx + 1).a, csegment(path, idx + 1).b);

  if (dirPrev.equals(dragDir)) {
    dirPrev = dirPrev.left();
    path = insert(path, idx, cpoint(path, idx));
    idx++;
  } else if (!dirPrev.isDefined()) {
    dirPrev = dragDir.left();
  }

  if (dirNext.equals(dragDir)) {
    dirNext = dirNext.right();
    path = insert(path, idx + 1, cpoint(path, idx + 1));
  } else if (!dirNext.isDefined()) {
    dirNext = dragDir.right();
  }

  const sPrev = csegment(path, idx - 1);
  const sNext = csegment(path, idx + 1);
  dragged = csegment(path, idx);

  const guideA: Seg[] = [];
  const guideB: Seg[] = [];

  if (index === 0) {
    guideA[0] = { a: dragged.a, b: add(dragged.a, dragDir.right().toVector()) };
    guideA[1] = { a: dragged.a, b: add(dragged.a, dragDir.left().toVector()) };
  } else if (dirPrev.angle(dragDir) & (AngleType.ANG_OBTUSE | AngleType.ANG_HALF_FULL)) {
    guideA[0] = { a: sPrev.a, b: add(sPrev.a, dragDir.left().toVector()) };
    guideA[1] = { a: sPrev.a, b: add(sPrev.a, dragDir.right().toVector()) };
  } else {
    guideA[0] = { a: dragged.a, b: add(dragged.a, dirPrev.toVector()) };
    guideA[1] = guideA[0];
  }

  if (index === origSegmentCount - 1) {
    guideB[0] = { a: dragged.b, b: add(dragged.b, dragDir.right().toVector()) };
    guideB[1] = { a: dragged.b, b: add(dragged.b, dragDir.left().toVector()) };
  } else if (dirNext.angle(dragDir) & (AngleType.ANG_OBTUSE | AngleType.ANG_HALF_FULL)) {
    guideB[0] = { a: sNext.b, b: add(sNext.b, dragDir.left().toVector()) };
    guideB[1] = { a: sNext.b, b: add(sNext.b, dragDir.right().toVector()) };
  } else {
    guideB[0] = { a: dragged.b, b: add(dragged.b, dirNext.toVector()) };
    guideB[1] = guideB[0];
  }

  const sCurrent: Seg = { a: target, b: add(target, dragDir.toVector()) };

  let bestLen = Number.POSITIVE_INFINITY;
  let best: Chain | null = null;

  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const ip1 = intersectLines(sCurrent, guideA[i]!);
      const ip2 = intersectLines(sCurrent, guideB[j]!);
      if (!ip1 || !ip2) continue;

      const s1: Seg = { a: sPrev.a, b: ip1 };
      const s3: Seg = { a: ip2, b: sNext.b };

      // The re-cut run, collapsing to a single knee whenever the new leading or
      // trailing leg already crosses the neighbour it would otherwise meet.
      const ipNext = intersectSegs(s1, sNext);
      const ipPrev = ipNext ? null : intersectSegs(s3, sPrev);
      const ipMid = ipNext || ipPrev ? null : intersectSegs(s1, s3);

      let np: Chain;
      if (ipNext) np = [s1.a, ipNext, sNext.b];
      else if (ipPrev) np = [sPrev.a, ipPrev, s3.b];
      else if (ipMid) np = [sPrev.a, ipMid, sNext.b];
      else np = [sPrev.a, ip1, ip2, sNext.b];

      const len = chainLength(np);
      if (len < bestLen) {
        bestLen = len;
        best = np;
      }
    }
  }

  if (!best) return c;
  if (c.length === 1) return simplify(best);

  // Replace( aIndex, aIndex + 1, best ) on the *original* line: the two points of
  // the dragged segment give way to the re-cut run. (Upstream spells the first
  // and last segment as Replace(0,1) / Replace(-2,-1), which is the same pair.)
  const startIdx = index === origSegmentCount - 1 ? c.length - 2 : index;
  return simplify([...c.slice(0, startIdx), ...best, ...c.slice(startIdx + 2)]);
}
