// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fillet, chamfer and extend a corner formed by two segments.
 * Counterparts: `libs/kimath/src/geometry/corner_operations.cpp` and the
 * two-segment `SHAPE_ARC` constructor in `shape_arc.cpp`.
 *
 * All three take a pair of segments and answer with replacement geometry, or
 * with nothing when the pair cannot be worked on. Refusing is the common case
 * in a real selection — most pairs of lines in it do not meet at all — so
 * "cannot" is a normal answer here and not an error.
 */

import type { Vec2 } from '../math/vector2.js';

export interface Seg {
  a: Vec2;
  b: Vec2;
}

const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
const len = (v: Vec2): number => Math.hypot(v.x, v.y);
const segLength = (s: Seg): number => len(sub(s.b, s.a));
const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

/** KiCad's KiROUND: half away from zero. */
const kiRound = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/** Degrees into (-180, 180], `EDA_ANGLE::Normalize180`. */
const normalize180 = (deg: number): number => {
  let a = deg;
  while (a <= -180) a += 360;
  while (a > 180) a -= 360;
  return a;
};

/** `EDA_ANGLE( VECTOR2I )`, in degrees. */
const angleOf = (v: Vec2): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/**
 * `RotatePoint`: KiCad's rotation, which is clockwise on screen for a positive
 * angle because y grows downward. Mirrored here rather than using the standard
 * maths convention, since the arc midpoint below depends on the direction.
 */
function rotateAbout(p: Vec2, c: Vec2, deg: number): Vec2 {
  const rad = (deg * Math.PI) / 180;
  const s = Math.sin(rad);
  const cs = Math.cos(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {
    x: kiRound(dy * s + dx * cs) + c.x,
    y: kiRound(dy * cs - dx * s) + c.y,
  };
}

/** `KIGEOM::GetSharedEndpoint`: the corner the two segments meet at, if any. */
export function sharedEndpoint(a: Seg, b: Seg): Vec2 | null {
  if (same(a.a, b.a) || same(a.a, b.b)) return a.a;
  if (same(a.b, b.a) || same(a.b, b.b)) return a.b;
  return null;
}

/** `KIGEOM::GetOtherEnd`: whichever end of `s` is not `pt`. */
export function otherEnd(s: Seg, pt: Vec2): Vec2 {
  return same(s.a, pt) ? s.b : s.a;
}

/** Where the *infinite* lines meet, or null when parallel. `SEG::IntersectLines`. */
export function intersectLines(s1: Seg, s2: Seg): Vec2 | null {
  const d1 = sub(s1.b, s1.a);
  const d2 = sub(s2.b, s2.a);
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (denom === 0) return null;
  const t = ((s2.a.x - s1.a.x) * d2.y - (s2.a.y - s1.a.y) * d2.x) / denom;
  return { x: s1.a.x + d1.x * t, y: s1.a.y + d1.y * t };
}

/** Whether the two segments cross or touch within both their extents. */
export function segmentsIntersect(s1: Seg, s2: Seg): boolean {
  const d1 = sub(s1.b, s1.a);
  const d2 = sub(s2.b, s2.a);
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (denom === 0) return false;
  const t = ((s2.a.x - s1.a.x) * d2.y - (s2.a.y - s1.a.y) * d2.x) / denom;
  const u = ((s2.a.x - s1.a.x) * d1.y - (s2.a.y - s1.a.y) * d1.x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** `SEG::LineProject`: the foot of the perpendicular onto the infinite line. */
export function lineProject(s: Seg, p: Vec2): Vec2 {
  const d = sub(s.b, s.a);
  const l2 = d.x * d.x + d.y * d.y;
  if (l2 === 0) return { x: s.a.x, y: s.a.y };
  const t = ((p.x - s.a.x) * d.x + (p.y - s.a.y) * d.y) / l2;
  return { x: kiRound(s.a.x + d.x * t), y: kiRound(s.a.y + d.y * t) };
}

/** Whether `p` lies on `s` within `tol`. */
export function pointOnSegment(s: Seg, p: Vec2, tol: number): boolean {
  const d = sub(s.b, s.a);
  const l2 = d.x * d.x + d.y * d.y;
  if (l2 === 0) return len(sub(p, s.a)) <= tol;
  let t = ((p.x - s.a.x) * d.x + (p.y - s.a.y) * d.y) / l2;
  t = Math.max(0, Math.min(1, t));
  const near = { x: s.a.x + d.x * t, y: s.a.y + d.y * t };
  return len(sub(p, near)) <= tol;
}

/** `SHAPE_ARC::MIN_PRECISION_IU`. */
export const ARC_MIN_PRECISION_IU = 4;

export interface ArcPoints {
  start: Vec2;
  mid: Vec2;
  end: Vec2;
}

/**
 * The arc of the given radius tangent to both segments — the two-segment
 * `SHAPE_ARC` constructor.
 *
 * Both segments are extended to where their infinite lines meet, the centre is
 * placed along the bisector at `radius / |sin(alpha/2)|` from that point, and
 * the tangent points fall out as perpendicular projections onto each line.
 *
 * Returns null when the lines are parallel or a segment has no length: there is
 * no corner to round.
 */
export function arcTangentToSegments(a: Seg, b: Seg, radius: number): ArcPoints | null {
  if (segLength(a) === 0 || segLength(b) === 0) return null;

  const p = intersectLines(a, b);
  if (!p) return null;

  // Point away from the intersection along each segment. The far end is used
  // unless it *is* the intersection, in which case the near end gives the same
  // direction — upstream falls back the same way.
  let pToA = sub(a.b, p);
  let pToB = sub(b.b, p);
  if (len(pToA) === 0) pToA = sub(a.a, p);
  if (len(pToB) === 0) pToB = sub(b.a, p);

  const angA = angleOf(pToA);
  const alpha = normalize180(angA - angleOf(pToB));

  const halfSin = Math.abs(Math.sin((alpha * Math.PI) / 360));
  if (halfSin === 0) return null; // collinear: no corner

  const distPC = radius / halfSin;
  const angPC = ((angA - alpha / 2) * Math.PI) / 180;

  const center = {
    x: p.x + kiRound(distPC * Math.cos(angPC)),
    y: p.y + kiRound(distPC * Math.sin(angPC)),
  };

  const start = lineProject(a, center);
  const end = lineProject(b, center);

  const midRot = normalize180(angleOf(sub(start, center)) - angleOf(sub(end, center))) / 2;

  return { start, mid: rotateAbout(start, center, midRot), end };
}

export interface FilletResult {
  arc: ArcPoints;
  /** The shortened originals; null when the fillet consumed one entirely. */
  updatedA: Seg | null;
  updatedB: Seg | null;
}

/**
 * `LINE_FILLET_ROUTINE::ProcessLinePair`.
 *
 * The pair has to share an endpoint and not be parallel, and — the check worth
 * having — *both* ends of the resulting arc must land on the segments they came
 * from. A radius larger than the corner will happily produce an arc whose
 * tangent points lie beyond the far ends, which would silently lengthen the
 * lines instead of rounding them.
 */
export function filletLinePair(a: Seg, b: Seg, radius: number): FilletResult | null {
  if (segLength(a) === 0 || segLength(b) === 0) return null;

  const corner = sharedEndpoint(a, b);
  if (!corner) return null;

  // Parallel lines have no corner to round.
  const arc = arcTangentToSegments(a, b, radius);
  if (!arc) return null;

  // Each arc end must sit on one of the two segments. Upstream tests each end
  // against both, so it does not matter which way round they come out.
  const onEither = (p: Vec2): boolean =>
    pointOnSegment(a, p, ARC_MIN_PRECISION_IU) || pointOnSegment(b, p, ARC_MIN_PRECISION_IU);

  if (!onEither(arc.start) || !onEither(arc.end)) return null;

  // The originals keep their far ends and stop where the arc begins.
  const farA = otherEnd(a, corner);
  const farB = otherEnd(b, corner);

  // Whichever arc end belongs to which segment.
  const startOnA = pointOnSegment(a, arc.start, ARC_MIN_PRECISION_IU);
  const newAEnd = startOnA ? arc.start : arc.end;
  const newBEnd = startOnA ? arc.end : arc.start;

  return {
    arc,
    updatedA: same(farA, newAEnd) ? null : { a: farA, b: newAEnd },
    updatedB: same(farB, newBEnd) ? null : { a: farB, b: newBEnd },
  };
}

export interface ChamferResult {
  chamfer: Seg;
  updatedA: Seg | null;
  updatedB: Seg | null;
}

/**
 * `ComputeChamferPoints`.
 *
 * A setback of zero on *one* side is allowed — it adds a collinear point, which
 * is odd but well-defined. Zero on both is refused, because there would be
 * nothing to do. Upstream spells that with an `&&` and says so in a comment.
 */
export function chamferLinePair(
  a: Seg,
  b: Seg,
  setbackA: number,
  setbackB: number,
): ChamferResult | null {
  if (setbackA === 0 && setbackB === 0) return null;

  // A setback longer than the line it is measured along has nowhere to land.
  if (segLength(a) < setbackA || segLength(b) < setbackB) return null;

  const corner = sharedEndpoint(a, b);
  if (!corner) return null;

  const farA = otherEnd(a, corner);
  const farB = otherEnd(b, corner);

  const along = (from: Vec2, to: Vec2, dist: number): Vec2 => {
    const d = sub(to, from);
    const l = len(d);
    if (l === 0) return { x: from.x, y: from.y };
    return { x: kiRound(from.x + (d.x * dist) / l), y: kiRound(from.y + (d.y * dist) / l) };
  };

  const chamfer: Seg = {
    a: along(corner, farA, setbackA),
    b: along(corner, farB, setbackB),
  };

  return {
    chamfer,
    updatedA: same(farA, chamfer.a) ? null : { a: farA, b: chamfer.a },
    updatedB: same(farB, chamfer.b) ? null : { a: farB, b: chamfer.b },
  };
}

/**
 * How far a coordinate may be pushed by an extension, in IU.
 * `GetClampedCoords`' padding in `LINE_EXTENSION_ROUTINE`: "the drawing tool has
 * COORDS_PADDING of 20mm, but we need a larger buffer or we are not able to
 * select the generated segments".
 */
export const EXTENSION_PADDING_IU = 200_000_000;

const clampCoord = (v: number): number => {
  const limit = 2147483647 - EXTENSION_PADDING_IU;
  return Math.max(-limit, Math.min(limit, v));
};

export interface ExtensionResult {
  /** Null where that segment already reached the meeting point. */
  updatedA: Seg | null;
  updatedB: Seg | null;
}

/**
 * `LINE_EXTENSION_ROUTINE::ProcessLinePair`: grow both lines until they meet.
 *
 * Lines that already cross are left alone — there is nothing to extend — and
 * parallel lines are refused, since they never meet. Each line keeps the end
 * *further* from the meeting point and moves the nearer one onto it, which is
 * what makes the operation stable when run twice.
 */
export function extendLinePair(a: Seg, b: Seg): ExtensionResult | null {
  if (segLength(a) === 0 || segLength(b) === 0) return null;
  if (segmentsIntersect(a, b)) return null;

  const meet = intersectLines(a, b);
  if (!meet) return null;

  const target = { x: clampCoord(kiRound(meet.x)), y: clampCoord(kiRound(meet.y)) };

  const extended = (s: Seg): Seg | null => {
    if (pointOnSegment(s, target, 0)) return null;
    const far = len(sub(target, s.a)) < len(sub(target, s.b)) ? s.b : s.a;
    return { a: far, b: target };
  };

  return { updatedA: extended(a), updatedB: extended(b) };
}
