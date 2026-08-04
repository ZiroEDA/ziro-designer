// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The creepage graph: shortest path *over the board surface*.
 * Counterpart: `CREEPAGE_GRAPH`, `GRAPH_NODE`, `GRAPH_CONNECTION` and the
 * `CREEP_SHAPE::Paths` family (pcbnew/drc/drc_creepage_utils.*).
 *
 * Creepage is not clearance. Clearance is how far apart two things are through
 * the air; creepage is how far a leakage current would have to travel *across
 * the board's surface* to get from one to the other. The difference is what
 * slots are for: a cutout between two high-voltage nets does not move them
 * apart at all, but it makes the surface path go the long way round, and that
 * is the whole reason anyone mills one.
 *
 * So the measurement is a shortest-path problem, and this is the graph it runs
 * on. Nodes are points on board edges and on copper; an edge exists between two
 * nodes when a straight line between them stays on the board. Dijkstra over
 * that gives the surface distance, and a slot in the way shows up as the direct
 * connection simply not existing.
 *
 * ## What this file covers
 *
 * The straight-edge subset — points, board-edge segments and copper track
 * segments. Upstream also models circles and arcs, on both the board-edge and
 * the copper side, which is another thirty-odd pairwise path functions; those
 * come next. **Nothing here reports a violation**, deliberately: a creepage
 * check that silently under-reports because it cannot see a rounded pad is
 * worse than no check at all, since creepage is a safety property and a green
 * result is taken as permission to ship. The consumer lands with the geometry
 * it needs, not before.
 *
 * ## Weights are edge to edge
 *
 * A copper segment's path endpoints are pushed out of its centreline by half
 * its width, and the weight has both half-widths subtracted, floored at zero.
 * Creepage is measured between the *copper surfaces*, not between the
 * centrelines the router happens to store.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** One candidate straight hop, and what it costs. */
export interface PathConnection {
  a1: Vec2;
  a2: Vec2;
  weight: number;
}

/**
 * A point on a board edge — a corner, or the end of an edge segment.
 *
 * There is deliberately no board-edge *segment* shape, and upstream has none
 * either: a straight edge contributes only its two endpoints. That is not an
 * omission but the geometry — a shortest path across a polygonal surface bends
 * only at corners, so a node in the middle of a straight edge can never be on
 * one. (I had added such a shape and removed it again; it could only ever have
 * grown the graph without changing an answer.)
 */
export interface BePoint {
  kind: 'be-point';
  pos: Vec2;
}

/**
 * A round *cutout* — an obstacle a path goes around.
 *
 * The board-edge and copper circles are not the same shape wearing different
 * labels, and the difference is the most important thing in this file. A path
 * meeting a board-edge circle is going *round* it, so it leaves along a
 * tangent, and there are two of them — one either way round. A path meeting a
 * copper circle has *arrived*, so it comes in radially and there is one.
 */
export interface BeCircle {
  kind: 'be-circle';
  pos: Vec2;
  radius: number;
}

/** A copper track segment, which has width and so a surface rather than a line. */
export interface CuSegment {
  kind: 'cu-segment';
  start: Vec2;
  end: Vec2;
  width: number;
}

/** Round copper — a via, or a round pad. A target, not an obstacle. */
export interface CuCircle {
  kind: 'cu-circle';
  pos: Vec2;
  radius: number;
}

/**
 * A board-edge arc: a rounded corner, or a slot end.
 *
 * An arc is its circle where it exists and its endpoints where it does not,
 * which is the whole of what makes it different. Angles are radians, and
 * `endAngle` may exceed `startAngle` by up to a full turn — the span is the
 * half-open sweep from one to the other, not a pair of bare directions.
 */
export interface BeArc {
  kind: 'be-arc';
  pos: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  startPoint: Vec2;
  endPoint: Vec2;
}

/**
 * A copper arc: a curved track, so a *thick* arc.
 *
 * Where a board-edge arc is a line, this has two surfaces — an outer circle at
 * `radius + width/2` and an inner one at `radius - width/2` — and its ends are
 * round caps of the track's half-width. Which surface a path reaches depends on
 * whether it is coming from outside the curve or from within it.
 */
export interface CuArc {
  kind: 'cu-arc';
  pos: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  startPoint: Vec2;
  endPoint: Vec2;
  width: number;
}

export type CreepShape = BePoint | BeCircle | BeArc | CuSegment | CuCircle | CuArc;

/** Whether a shape is copper: only copper carries a half-width. */
export const isConductive = (s: CreepShape): boolean =>
  s.kind === 'cu-segment' || s.kind === 'cu-circle' || s.kind === 'cu-arc';

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const norm = (v: Vec2): number => Math.hypot(v.x, v.y);

/** `VECTOR2I::Resize`: same direction, given length. A zero vector stays zero. */
function resize(v: Vec2, len: number): Vec2 {
  const n = norm(v);
  if (n === 0) return { x: 0, y: 0 };
  return { x: Math.round((v.x * len) / n) || 0, y: Math.round((v.y * len) / n) || 0 };
}

/** The point of segment a→b nearest `p`, clamped to the segment. */
export function closestPointOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const d = sub(b, a);
  const len2 = dot(d, d);
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = dot(sub(p, a), d) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: Math.round(a.x + d.x * t), y: Math.round(a.y + d.y * t) };
}

const endpointsOf = (s: CuSegment): [Vec2, Vec2] => [s.start, s.end];

/** Rotate a unit-ish vector 90 degrees. `VECTOR2D::Perpendicular`. */
const perp = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

/** Unit vector, as a float pair — the tangent maths cannot round yet. */
function unit(v: Vec2): { x: number; y: number } {
  const n = norm(v);
  if (n === 0) return { x: 0, y: 0 };
  return { x: v.x / n, y: v.y / n };
}

/**
 * Round to internal units, collapsing negative zero.
 *
 * `Math.round(-0.2)` is `-0`, which compares equal to `0` but is not the same
 * value to a deep-equality check — so it survives every comparison until it
 * reaches a test or a file, and then looks like a real difference. The tangent
 * maths below produces it constantly, since half the constructions are
 * symmetric about an axis.
 */
const at = (x: number, y: number): Vec2 => ({ x: Math.round(x) || 0, y: Math.round(y) || 0 });

/**
 * A point and a board-edge circle: the two tangent lines, one either way round.
 *
 * The weight is the *tangent length*, `sqrt(d² - r²)`, not the gap to the rim.
 * That is the whole difference between rounding an obstacle and reaching a
 * target: the path does not stop at the circle, it grazes it and carries on, so
 * what it costs is how far it travels to get to the point where it starts
 * turning.
 */
function pointToBeCircle(pt: BePoint, circle: BeCircle, maxSquared: number): PathConnection[] {
  if (circle.radius <= 0) return [];

  const d = sub(pt.pos, circle.pos);
  const distSq = dot(d, d);
  const weightSq = distSq - circle.radius * circle.radius;
  if (weightSq > maxSquared) return [];
  // Inside the circle there is no tangent to find at all.
  if (weightSq < 0) return [];

  const dir1 = unit(d);
  const dir2 = perp(dir1);
  const dist = Math.sqrt(distSq);
  const value1 = (circle.radius * circle.radius) / dist;
  const value2 = Math.sqrt(Math.max(circle.radius * circle.radius - value1 * value1, 0));
  const weight = Math.sqrt(weightSq);

  return [
    {
      a1: pt.pos,
      a2: at(
        dir1.x * value1 + dir2.x * value2 + circle.pos.x,
        dir1.y * value1 + dir2.y * value2 + circle.pos.y,
      ),
      weight,
    },
    {
      a1: pt.pos,
      a2: at(
        dir1.x * value1 - dir2.x * value2 + circle.pos.x,
        dir1.y * value1 - dir2.y * value2 + circle.pos.y,
      ),
      weight,
    },
  ];
}

/** A point and round copper: straight in along the radius. */
function pointToCuCircle(pt: BePoint, circle: CuCircle, maxWeight: number): PathConnection[] {
  const dist = norm(sub(circle.pos, pt.pos));
  const weight = dist - circle.radius;
  if (weight > maxWeight) return [];

  return [
    {
      a1: addVec(circle.pos, resize(sub(pt.pos, circle.pos), circle.radius)),
      a2: pt.pos,
      weight: Math.max(weight, 0),
    },
  ];
}

/** Two pieces of round copper: along the line of centres. */
function cuCircleToCuCircle(c1: CuCircle, c2: CuCircle, maxWeight: number): PathConnection[] {
  const d = sub(c1.pos, c2.pos);
  const rDiff = c1.radius - c2.radius;
  // One entirely inside the other: there is no gap between them to measure.
  // Kept because upstream has it, but it decides nothing on its own — nesting
  // forces the weight below zero, so the negative test just below rejects the
  // same cases. Mutation testing confirmed removing it changes no answer.
  if (dot(d, d) < rDiff * rDiff) return [];

  const weight = norm(d) - c1.radius - c2.radius;
  // Overlapping copper is not a creepage path, it is one conductor.
  if (weight > maxWeight || weight < 0) return [];

  return [
    {
      a1: addVec(c1.pos, resize(sub(c2.pos, c1.pos), c1.radius)),
      a2: addVec(c2.pos, resize(sub(c1.pos, c2.pos), c2.radius)),
      weight: Math.max(weight, 0),
    },
  ];
}

/**
 * Two board-edge circles: up to four tangents.
 *
 * Two *straight* ones, running along the same side of both circles, whose
 * length falls out of the radius **difference**; and two *crossed* ones, which
 * pass between the circles and use the **sum**. A path may legitimately take
 * either, so both are offered and the search decides.
 */
function beCircleToBeCircle(c1: BeCircle, c2: BeCircle, maxSquared: number): PathConnection[] {
  const d = sub(c2.pos, c1.pos);
  const distSq = dot(d, d);
  const dist = Math.sqrt(distSq);
  if (dist === 0) return [];

  const { radius: r1 } = c1;
  const { radius: r2 } = c2;
  const out: PathConnection[] = [];

  const dir1 = unit(d);
  const dir2 = perp(dir1);

  const tangents = (ratio1: number, weightSq: number, crossed: boolean): void => {
    if (weightSq > maxSquared || weightSq < 0) return;
    const ratio2 = Math.sqrt(Math.max(1 - ratio1 * ratio1, 0));
    const weight = Math.sqrt(weightSq);
    const sign = crossed ? -1 : 1;

    for (const s of [1, -1]) {
      out.push({
        a1: at(
          c1.pos.x + dir1.x * r1 * ratio1 + s * dir2.x * r1 * ratio2,
          c1.pos.y + dir1.y * r1 * ratio1 + s * dir2.y * r1 * ratio2,
        ),
        a2: at(
          c2.pos.x + sign * (dir1.x * r2 * ratio1 + s * dir2.x * r2 * ratio2),
          c2.pos.y + sign * (dir1.y * r2 * ratio1 + s * dir2.y * r2 * ratio2),
        ),
        weight,
      });
    }
  };

  const rDiff = Math.abs(r1 - r2);
  tangents(rDiff === 0 ? 0 : (r1 - r2) / dist, distSq - rDiff * rDiff, false);
  tangents((r1 + r2) / dist, distSq - (r1 + r2) * (r1 + r2), true);

  return out;
}

/**
 * Round copper and a board-edge circle: two tangents, or a radial gap when the
 * copper sits *inside* the cutout.
 *
 * The inside case returns the same connection twice. That looks like a mistake
 * and is upstream's own note: callers pick a tangent by index, so a single
 * entry would make one side of a track silently find nothing.
 */
function cuCircleToBeCircle(cu: CuCircle, be: BeCircle, maxWeight: number): PathConnection[] {
  const d = sub(be.pos, cu.pos);
  const dist = norm(d);
  if (dist > maxWeight && dist > be.radius) return [];
  if (dist === 0) return [];

  const circleAngle = Math.atan2(d.y, d.x);

  if (dist <= be.radius) {
    // Inside the cutout, so there are no external tangents; the nearest
    // approach is straight out along the radius.
    const weight = Math.max(be.radius - dist - cu.radius, 0);
    if (weight > maxWeight) return [];

    const radial = circleAngle + Math.PI;
    const cx = Math.cos(radial);
    const cy = Math.sin(radial);
    const pc: PathConnection = {
      a1: at(cu.pos.x + cu.radius * cx, cu.pos.y + cu.radius * cy),
      a2: at(be.pos.x + be.radius * cx, be.pos.y + be.radius * cy),
      weight,
    };
    return [pc, pc];
  }

  const weight = Math.sqrt(dist * dist - be.radius * be.radius) - cu.radius;
  if (weight > maxWeight) return [];

  const theta = Math.asin(be.radius / dist);
  const psi = Math.acos(be.radius / dist);
  const w = Math.max(weight, 0);

  return [
    {
      a1: at(
        cu.pos.x + cu.radius * Math.cos(theta + circleAngle),
        cu.pos.y + cu.radius * Math.sin(theta + circleAngle),
      ),
      a2: at(
        be.pos.x + be.radius * Math.cos(circleAngle + Math.PI - psi),
        be.pos.y + be.radius * Math.sin(circleAngle + Math.PI - psi),
      ),
      weight: w,
    },
    {
      a1: at(
        cu.pos.x + cu.radius * Math.cos(circleAngle - theta),
        cu.pos.y + cu.radius * Math.sin(circleAngle - theta),
      ),
      a2: at(
        be.pos.x + be.radius * Math.cos(circleAngle + Math.PI + psi),
        be.pos.y + be.radius * Math.sin(circleAngle + Math.PI + psi),
      ),
      weight: w,
    },
  ];
}

/** Where a point projects onto a track, in distance along it from the start. */
function projectionAlong(seg: CuSegment, p: Vec2): { length: number; projected: number } {
  const d = sub(seg.end, seg.start);
  const length = norm(d);
  if (length === 0) return { length: 0, projected: 0 };
  const angle = Math.atan2(d.y, d.x);
  return {
    length,
    projected: Math.cos(angle) * (p.x - seg.start.x) + Math.sin(angle) * (p.y - seg.start.y),
  };
}

/** Which side of a track a point falls on: +1 or -1. */
const sideOf = (seg: CuSegment, p: Vec2): number => {
  const d = sub(seg.end, seg.start);
  const e = sub(p, seg.start);
  return d.x * e.y - d.y * e.x > 0 ? 1 : -1;
};

/** A track and round copper: the flat of the track, or its rounded end cap. */
function cuSegmentToCuCircle(
  seg: CuSegment,
  circle: CuCircle,
  maxWeight: number,
  maxSquared: number,
): PathConnection[] {
  const hw = seg.width / 2;
  const { length, projected } = projectionAlong(seg, circle.pos);

  // Past either end, the nearest copper is the end cap — which is a circle of
  // the track's half-width, so the problem reduces to one already solved.
  if (projected <= 0 || length === 0)
    return cuCircleToCuCircle({ kind: 'cu-circle', pos: seg.start, radius: hw }, circle, maxWeight);
  if (projected >= length)
    return cuCircleToCuCircle({ kind: 'cu-circle', pos: seg.end, radius: hw }, circle, maxWeight);

  const along = sub(seg.end, seg.start);
  const side = sideOf(seg, circle.pos);
  const a1 = addVec(addVec(seg.start, resize(along, projected)), resize(perp(along), hw * side));
  const a2 = addVec(circle.pos, resize(sub(a1, circle.pos), circle.radius));
  const weightSq = dot(sub(a2, a1), sub(a2, a1));
  if (weightSq > maxSquared) return [];

  return [{ a1, a2, weight: Math.sqrt(weightSq) }];
}

/**
 * A track and a board-edge circle.
 *
 * Off either end it reduces to the end cap against the circle. Alongside, the
 * two tangents leave the track's flank at the points where the circle's own
 * extremes project onto it — which is why the projection is taken twice, once
 * shifted by the radius each way.
 */
function cuSegmentToBeCircle(
  seg: CuSegment,
  be: BeCircle,
  maxWeight: number,
  maxSquared: number,
): PathConnection[] {
  const hw = seg.width / 2;
  const { length, projected } = projectionAlong(seg, be.pos);
  if (length === 0)
    return cuCircleToBeCircle({ kind: 'cu-circle', pos: seg.start, radius: hw }, be, maxWeight);

  const p1 = projected - be.radius;
  const p2 = projected + be.radius;

  if (p1 < 0 && p2 < 0)
    return cuCircleToBeCircle({ kind: 'cu-circle', pos: seg.start, radius: hw }, be, maxWeight);
  if (p1 > length && p2 > length)
    return cuCircleToBeCircle({ kind: 'cu-circle', pos: seg.end, radius: hw }, be, maxWeight);

  const along = sub(seg.end, seg.start);
  const side = sideOf(seg, be.pos);
  const flank = (dist: number): Vec2 =>
    addVec(addVec(seg.start, resize(along, dist)), resize(perp(along), hw * side));

  const out: PathConnection[] = [];

  if (p1 >= 0 && p1 <= length && p2 >= 0 && p2 <= length) {
    const a1 = flank(p1);
    const a2 = sub(be.pos, resize(along, be.radius));
    const wSq = dot(sub(a2, a1), sub(a2, a1));
    if (wSq < maxSquared) {
      out.push({ a1, a2, weight: Math.sqrt(wSq) });
      out.push({
        a1: flank(p2),
        a2: addVec(be.pos, resize(along, be.radius)),
        weight: Math.sqrt(wSq),
      });
    }
    return out;
  }

  // Straddling one end: one tangent comes off the end cap, the other off the
  // flank. Upstream picks the cap tangent by side, which is why the inside
  // case above must return two entries.
  const capAt = p1 < 0 ? seg.start : seg.end;
  const caps = cuCircleToBeCircle({ kind: 'cu-circle', pos: capAt, radius: hw }, be, maxWeight);
  if (caps.length < 2) return out;
  out.push(caps[side === 1 ? 1 : 0]!);

  const onFlank = p1 >= 0 && p1 <= length ? p1 : p2;
  const a1 = flank(onFlank);
  const a2 = sub(be.pos, resize(along, be.radius));
  const wSq = dot(sub(a2, a1), sub(a2, a1));
  if (wSq < maxSquared) out.push({ a1, a2, weight: Math.sqrt(wSq) });

  return out;
}

const TWO_PI = Math.PI * 2;

/**
 * `AngleBetweenStartAndEnd`: where a point sits in the arc's sweep.
 *
 * Wound *forward* from the start angle rather than normalised to [0, 2π), so
 * the answer can legitimately exceed a full turn. Comparing it against
 * `endAngle` then decides membership in one test, with none of the wrap-around
 * case analysis that a naive normalisation forces.
 */
export function angleBetweenStartAndEnd(
  arc: { pos: Vec2; startAngle: number; endAngle: number },
  p: Vec2,
): number {
  let angle = Math.atan2(p.y - arc.pos.y, p.x - arc.pos.x);
  while (angle < arc.startAngle) angle += TWO_PI;
  // Upstream's matching unwind. It cannot fire for an arc whose angles came
  // from a file — `atan2` returns at most π and the loop above only adds — so
  // mutation testing finds it unobservable. Kept as upstream's, since the only
  // thing standing between it and a runaway loop above is that assumption.
  while (angle > arc.endAngle + TWO_PI) angle -= TWO_PI;
  return angle;
}

/** Whether `p` lies within the arc's sweep. */
const onArc = (arc: { pos: Vec2; startAngle: number; endAngle: number }, p: Vec2): boolean =>
  angleBetweenStartAndEnd(arc, p) <= arc.endAngle;

/** Tolerance for "this intersection is really the segment's own endpoint", 50 IU. */
const TOUCH_TOLERANCE = 50;

/**
 * `segmentIntersectsArc`: does the hop cut *through* the arc?
 *
 * A path is allowed to *end* on an arc — that is what reaching a rounded corner
 * looks like — so an intersection at either of the segment's own endpoints is a
 * touch and does not count. Only an interior crossing does.
 */
export function segmentIntersectsArc(
  a1: Vec2,
  a2: Vec2,
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
): boolean {
  const d = sub(a2, a1);
  const f = sub(a1, center);
  const a = dot(d, d);
  if (a === 0) return false;

  const b = 2 * dot(f, d);
  const c = dot(f, f) - radius * radius;
  const disc = b * b - 4 * a * c;
  // No real root: the line misses the circle entirely. Removing this happens
  // to give the same answer — the NaNs that follow compare false against
  // everything — so mutation testing calls it unobservable. It stays because
  // relying on NaN comparison semantics to be accidentally right is not a
  // property worth depending on.
  if (disc < 0) return false;

  const sq = Math.sqrt(disc);
  const tol2 = TOUCH_TOLERANCE * TOUCH_TOLERANCE;

  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0 || t > 1) continue;
    const hit = { x: a1.x + d.x * t, y: a1.y + d.y * t };
    const near = (q: Vec2): boolean => (hit.x - q.x) ** 2 + (hit.y - q.y) ** 2 <= tol2;
    if (near(a1) || near(a2)) continue;
    if (onArc({ pos: center, startAngle, endAngle }, hit)) return true;
  }

  return false;
}

const beCircleOf = (arc: BeArc): BeCircle => ({
  kind: 'be-circle',
  pos: arc.pos,
  radius: arc.radius,
});

/**
 * Any shape against a board-edge arc.
 *
 * Upstream writes this out per source shape; the body is the same each time, so
 * it is written once here. Take the paths against the arc's full circle, keep
 * those that actually land on the arc, and — when some were lost — offer the
 * arc's two *endpoints* instead, minus any that would cut through the arc on
 * the way. That last filter is what stops a path tunnelling through a rounded
 * corner to reach the far end of it.
 */
function shapeToBeArc(
  src: CreepShape,
  arc: BeArc,
  maxWeight: number,
  viaCircle: (c: BeCircle) => PathConnection[],
  viaPoint: (p: BePoint) => PathConnection[],
): PathConnection[] {
  const centerDistance = norm(sub(srcPos(src), arc.pos));
  // Wholly swallowed by the source shape: there is no path to its surface.
  if (centerDistance + arc.radius < srcRadius(src)) return [];

  const out: PathConnection[] = [];
  const fromCircle = viaCircle(beCircleOf(arc));

  for (const pc of fromCircle) if (onArc(arc, pc.a2)) out.push(pc);

  // Every tangent landed on the arc, so it behaved as a whole circle and the
  // endpoints add nothing.
  if (out.length > 0 && out.length === fromCircle.length) return out;

  for (const end of [arc.startPoint, arc.endPoint]) {
    for (const pc of viaPoint({ kind: 'be-point', pos: end })) {
      if (!segmentIntersectsArc(pc.a1, pc.a2, arc.pos, arc.radius, arc.startAngle, arc.endAngle))
        out.push(pc);
    }
  }

  return out.filter((pc) => pc.weight <= maxWeight);
}

/** The centre a shape's paths radiate from, for the containment shortcut. */
function srcPos(s: CreepShape): Vec2 {
  switch (s.kind) {
    case 'be-point':
      return s.pos;
    case 'be-circle':
    case 'cu-circle':
    case 'be-arc':
    case 'cu-arc':
      return s.pos;
    default:
      return s.start;
  }
}

/** A shape's own radius, or zero for those that have none. */
function srcRadius(s: CreepShape): number {
  switch (s.kind) {
    case 'be-circle':
    case 'cu-circle':
    case 'be-arc':
    case 'cu-arc':
      return s.radius;
    default:
      return 0;
  }
}

/**
 * A copper arc against a point.
 *
 * The thickness is the whole complication. If the point lies within the arc's
 * sweep, the nearest copper is a surface of the curve — the *outer* circle when
 * the point is outside the radius, the *inner* one when it is within, because
 * a curved track has copper on both sides of its centreline. If the point is
 * off the end of the sweep, the nearest copper is a round end cap instead.
 */
function cuArcToPoint(arc: CuArc, pt: BePoint, maxWeight: number): PathConnection[] {
  const half = arc.width / 2;
  const angle = angleBetweenStartAndEnd(arc, pt.pos);

  if (angle < arc.endAngle) {
    const d = sub(pt.pos, arc.pos);
    // Outside the curve, so the near face is the outer surface. Every branch
    // here returns a1 on the *copper* and a2 at the point; the dispatch flips
    // the pair when the caller asked the other way round. Two of the three
    // branches once swapped here as well, which cancelled the dispatch's flip
    // and left half the paths pointing the opposite way to the other half.
    if (dot(d, d) > arc.radius * arc.radius)
      return pointToCuCircle(
        pt,
        { kind: 'cu-circle', pos: arc.pos, radius: arc.radius + half },
        maxWeight,
      );

    const weight = Math.max(arc.radius - half - norm(d), 0);
    if (weight <= 0 || weight >= maxWeight) return [];
    return [{ a1: addVec(arc.pos, resize(d, arc.radius - half)), a2: pt.pos, weight }];
  }

  const caps: PathConnection[] = [];
  for (const end of [arc.startPoint, arc.endPoint])
    caps.push(...pointToCuCircle(pt, { kind: 'cu-circle', pos: end, radius: half }, maxWeight));

  // Upstream keeps the shortest of the two caps rather than offering both: an
  // end cap is a target, not an obstacle, so there is no "either way round".
  let best: PathConnection | null = null;
  for (const pc of caps) if (!best || (best.weight > pc.weight && pc.weight > 0)) best = pc;
  return best ? [best] : [];
}

/**
 * A copper arc's reachable surfaces, as the circles they are.
 *
 * `sweptOnly` marks the curve itself: a path may only reach it where the sweep
 * actually goes, while the two end caps are always there to be reached.
 */
function cuArcCircles(arc: CuArc): { circle: CuCircle; sweptOnly: boolean }[] {
  const half = arc.width / 2;
  return [
    { circle: { kind: 'cu-circle', pos: arc.pos, radius: arc.radius + half }, sweptOnly: true },
    { circle: { kind: 'cu-circle', pos: arc.startPoint, radius: half }, sweptOnly: false },
    { circle: { kind: 'cu-circle', pos: arc.endPoint, radius: half }, sweptOnly: false },
  ];
}

/**
 * The candidate paths between two shapes, or none when they are further apart
 * than `maxWeight`.
 *
 * A *list*, because a circle offers a path either way round it. The search then
 * decides which side is actually shorter once the obstacles are accounted for —
 * which is the point: whether to go left or right of a cutout is not a local
 * question.
 *
 * An arc reaches this as its circle filtered to its own sweep, plus its
 * endpoints where the sweep runs out — which is why every arc case below
 * delegates rather than computing anything new.
 */
export function pathsBetween(s1: CreepShape, s2: CreepShape, maxWeight: number): PathConnection[] {
  const maxSquared = maxWeight * maxWeight;
  const flip = (paths: PathConnection[]): PathConnection[] =>
    paths.map((pc) => ({ a1: pc.a2, a2: pc.a1, weight: pc.weight }));

  // Point to point: the straight line, and the gate is on the *squared*
  // distance so the square root is only paid for a path that survives.
  if (s1.kind === 'be-point' && s2.kind === 'be-point') {
    const d = sub(s1.pos, s2.pos);
    const weightSq = dot(d, d);
    if (weightSq > maxSquared) return [];
    return [{ a1: s1.pos, a2: s2.pos, weight: Math.sqrt(weightSq) }];
  }

  // ----- arcs: circle where the sweep covers, endpoints where it does not -----
  if (s2.kind === 'be-arc')
    return shapeToBeArc(
      s1,
      s2,
      maxWeight,
      (c) => pathsBetween(s1, c, maxWeight),
      (pt) => pathsBetween(s1, pt, maxWeight),
    );
  if (s1.kind === 'be-arc')
    return flip(
      shapeToBeArc(
        s2,
        s1,
        maxWeight,
        (c) => pathsBetween(s2, c, maxWeight),
        (pt) => pathsBetween(s2, pt, maxWeight),
      ),
    );

  if (s1.kind === 'cu-arc' && s2.kind === 'be-point') return cuArcToPoint(s1, s2, maxWeight);
  if (s1.kind === 'be-point' && s2.kind === 'cu-arc') return flip(cuArcToPoint(s2, s1, maxWeight));

  // Anything else against a copper arc: its outer surface and its two end
  // caps are all circles, so the shortest path to any of them is the answer.
  if (s1.kind === 'cu-arc' || s2.kind === 'cu-arc') {
    const arc = (s1.kind === 'cu-arc' ? s1 : s2) as CuArc;
    const other = s1.kind === 'cu-arc' ? s2 : s1;
    const candidates: PathConnection[] = [];

    for (const { circle, sweptOnly } of cuArcCircles(arc)) {
      for (const pc of pathsBetween(other, circle, maxWeight)) {
        // A path to the curve's own surface only counts where the sweep
        // actually reaches; the end caps are always there.
        if (sweptOnly && !onArc(arc, pc.a2)) continue;
        candidates.push(pc);
      }
    }

    let best: PathConnection | null = null;
    for (const pc of candidates) if (!best || pc.weight < best.weight) best = pc;
    if (!best) return [];
    return s1.kind === 'cu-arc' ? flip([best]) : [best];
  }

  if (s1.kind === 'be-point' && s2.kind === 'be-circle') return pointToBeCircle(s1, s2, maxSquared);
  if (s1.kind === 'be-circle' && s2.kind === 'be-point')
    return flip(pointToBeCircle(s2, s1, maxSquared));

  if (s1.kind === 'be-point' && s2.kind === 'cu-circle')
    return flip(pointToCuCircle(s1, s2, maxWeight));
  if (s1.kind === 'cu-circle' && s2.kind === 'be-point') return pointToCuCircle(s2, s1, maxWeight);

  if (s1.kind === 'cu-circle' && s2.kind === 'cu-circle')
    return cuCircleToCuCircle(s1, s2, maxWeight);

  if (s1.kind === 'be-circle' && s2.kind === 'be-circle')
    return beCircleToBeCircle(s1, s2, maxSquared);

  if (s1.kind === 'cu-circle' && s2.kind === 'be-circle')
    return cuCircleToBeCircle(s1, s2, maxWeight);
  if (s1.kind === 'be-circle' && s2.kind === 'cu-circle')
    return flip(cuCircleToBeCircle(s2, s1, maxWeight));

  if (s1.kind === 'cu-segment' && s2.kind === 'cu-circle')
    return cuSegmentToCuCircle(s1, s2, maxWeight, maxSquared);
  if (s1.kind === 'cu-circle' && s2.kind === 'cu-segment')
    return flip(cuSegmentToCuCircle(s2, s1, maxWeight, maxSquared));

  if (s1.kind === 'cu-segment' && s2.kind === 'be-circle')
    return cuSegmentToBeCircle(s1, s2, maxWeight, maxSquared);
  if (s1.kind === 'be-circle' && s2.kind === 'cu-segment')
    return flip(cuSegmentToBeCircle(s2, s1, maxWeight, maxSquared));

  // Point to track: the nearest point on the centreline, pushed out to the
  // copper's surface.
  if (s1.kind === 'be-point' || s2.kind === 'be-point') {
    const pt = (s1.kind === 'be-point' ? s1 : s2) as BePoint;
    const seg = (s1.kind === 'be-point' ? s2 : s1) as CuSegment;
    const hw = seg.width / 2;

    const onSeg = closestPointOnSegment(seg.start, seg.end, pt.pos);
    const dist = norm(sub(onSeg, pt.pos));
    const weight = Math.max(dist - hw, 0);
    if (weight > maxWeight) return [];

    const pushed = hw > 0 ? addVec(onSeg, resize(sub(pt.pos, onSeg), hw)) : onSeg;
    const conn: PathConnection = { a1: pushed, a2: pt.pos, weight };
    return [s1.kind === 'be-point' ? { a1: conn.a2, a2: conn.a1, weight } : conn];
  }

  // Track to track. Four candidate approaches — each endpoint of each against
  // the other — and the nearest wins. Overlapping copper would give a negative
  // weight, which the floor turns into a legal zero-cost hop rather than
  // something Dijkstra cannot take.
  const segA = s1 as CuSegment;
  const segB = s2 as CuSegment;
  const [a, b] = endpointsOf(segA);
  const [c, d] = endpointsOf(segB);
  const hw1 = segA.width / 2;
  const hw2 = segB.width / 2;

  const candidates: [Vec2, Vec2][] = [
    [closestPointOnSegment(a, b, c), c],
    [closestPointOnSegment(a, b, d), d],
    [a, closestPointOnSegment(c, d, a)],
    [b, closestPointOnSegment(c, d, b)],
  ];

  let best = candidates[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [p, q] of candidates) {
    const dd = sub(p, q);
    const dist2 = dot(dd, dd);
    if (dist2 < bestDist) {
      bestDist = dist2;
      best = [p, q];
    }
  }

  const [closest1, closest2] = best;
  const weight = Math.max(Math.sqrt(bestDist) - hw1 - hw2, 0);
  if (weight > maxWeight) return [];

  return [
    {
      a1: addVec(closest1, resize(sub(closest2, closest1), hw1)),
      a2: addVec(closest2, resize(sub(closest1, closest2), hw2)),
      weight,
    },
  ];
}

const addVec = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

/** Whether two segments properly cross (touching at an endpoint does not count). */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);

  // A *proper* crossing: each segment must have the other's endpoints strictly
  // on opposite sides. A zero determinant means an endpoint lies on the other
  // segment, which is touching, not crossing — and touching is exactly what a
  // path hugging the rim of a cutout does at every corner it rounds. Testing
  // `(d1 > 0) !== (d2 > 0)` instead reads a zero as "not positive" and rejects
  // those paths, which is the whole route.
  const opposite = (x: number, y: number): boolean => (x > 0 && y < 0) || (x < 0 && y > 0);
  return opposite(d1, d2) && opposite(d3, d4);
}

/** Distance from a point to a segment, for the on-edge tolerance. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const c = closestPointOnSegment(a, b, p);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

/**
 * `SHAPE_POLY_SET::PointOnEdge`, with a tolerance.
 *
 * Load bearing rather than defensive: the paths creepage most cares about are
 * the ones hugging the rim of a cutout, and their midpoints land exactly on the
 * boundary — where ray casting answers whichever way the rounding fell.
 */
function pointOnEdge(p: Vec2, rings: readonly (readonly Vec2[])[], tolerance: number): boolean {
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      if (distToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!) <= tolerance) return true;
    }
  }
  return false;
}

/** Ray-cast containment for a simple ring. */
function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** The board: an outer outline and any number of cutouts. */
export interface BoardSurface {
  outline: readonly Vec2[];
  holes: readonly (readonly Vec2[])[];
}

/**
 * `PATH_CONNECTION::isValid`: may this straight hop be taken?
 *
 * Two conditions, and both matter for the same reason — a leakage path runs
 * *on* the board:
 *
 * 1. It must not cross a board edge. Crossing one means leaving the board and
 *    coming back, which is through the air, and that is clearance's business.
 * 2. Its midpoint must be on the board. This is what stops a hop straight
 *    across a cutout, whose two ends are both on copper but whose middle is
 *    over nothing. Upstream tests the midpoint specifically, with a 100 nm
 *    tolerance so a path running along the very rim still counts.
 *
 * The midpoint test is not redundant with the crossing test: a chord across a
 * *concave* notch can enter and leave through the notch's mouth without ever
 * properly crossing an edge segment.
 */
export function isValidPath(pc: PathConnection, surface: BoardSurface): boolean {
  const rings = [surface.outline, ...surface.holes];

  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const e1 = ring[i]!;
      const e2 = ring[(i + 1) % ring.length]!;
      if (segmentsCross(pc.a1, pc.a2, e1, e2)) return false;
    }
  }

  const mid = { x: Math.round((pc.a1.x + pc.a2.x) / 2), y: Math.round((pc.a1.y + pc.a2.y) / 2) };

  // Upstream's `Contains( mid ) || PointOnEdge( mid )`, at its 100 nm
  // tolerance. The second half is not a rounding nicety: a path running along
  // the rim of a cutout has its midpoint *on* the boundary, and that is the
  // most important kind of path there is here.
  if (pointOnEdge(mid, rings, ON_EDGE_TOLERANCE)) return true;

  if (!pointInRing(mid, surface.outline)) return false;
  for (const hole of surface.holes) if (pointInRing(mid, hole)) return false;

  return true;
}

/** Upstream's midpoint tolerance: 100 nm. */
const ON_EDGE_TOLERANCE = 100;

/** A node in the graph: a point, and which net's copper it belongs to. */
export interface GraphNode {
  id: number;
  pos: Vec2;
  /** -1 for a board-edge node, which belongs to no net. */
  net: number;
}

interface Connection {
  n1: number;
  n2: number;
  weight: number;
}

/**
 * The graph, and Dijkstra over it.
 *
 * The queue holds the tentative distance *captured at push time* rather than
 * reading the live distance map. Upstream carries a comment about why: a
 * comparator that read live distances would have its ordering silently
 * corrupted by a decrease-key reinsertion, and the target could then be popped
 * on a path that is not the shortest — at which point the early exit returns
 * the wrong answer. Stale entries are skipped instead, on the way out.
 */
export class CreepageGraph {
  private readonly nodes: GraphNode[] = [];
  private readonly adjacency = new Map<number, Connection[]>();

  addNode(pos: Vec2, net = -1): GraphNode {
    const node: GraphNode = { id: this.nodes.length, pos, net };
    this.nodes.push(node);
    this.adjacency.set(node.id, []);
    return node;
  }

  /**
   * Join two nodes.
   *
   * A negative weight is dropped rather than stored: Dijkstra cannot take one,
   * and upstream logs and ignores it at traversal time. Refusing it here means
   * the graph never holds an edge no algorithm over it can use.
   */
  connect(n1: GraphNode, n2: GraphNode, weight: number): void {
    if (weight < 0) return;
    this.adjacency.get(n1.id)?.push({ n1: n1.id, n2: n2.id, weight });
    this.adjacency.get(n2.id)?.push({ n1: n2.id, n2: n1.id, weight });
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  /**
   * The shortest surface distance between two nodes, and the path taken.
   *
   * `Infinity` when there is no path at all — which is the *good* answer for
   * creepage: it means no leakage route exists within the distance searched.
   */
  solve(from: GraphNode, to: GraphNode): { weight: number; path: GraphNode[] } {
    if (from.id === to.id) return { weight: 0, path: [from] };

    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    for (const n of this.nodes) dist.set(n.id, Number.POSITIVE_INFINITY);
    dist.set(from.id, 0);

    // A sorted array standing in for the priority queue: the graphs here are
    // small and bounded by the creepage distance, and a real heap would be
    // more machinery than the problem needs.
    const queue: { d: number; id: number }[] = [{ d: 0, id: from.id }];

    while (queue.length > 0) {
      queue.sort((x, y) => (x.d === y.d ? x.id - y.id : x.d - y.d));
      const { d, id } = queue.shift()!;

      // Left behind by a decrease-key push; its shorter copy already ran. This
      // is an optimisation and not a correctness guard, which is worth saying
      // because it looks like one: the relaxation below reads the *current*
      // distance rather than the `d` popped here, so re-processing a stale
      // entry recomputes the same answers. Mutation testing confirmed removing
      // it changes no result — only how much work is done.
      if (d > (dist.get(id) ?? Number.POSITIVE_INFINITY)) continue;
      if (id === to.id) break;

      for (const conn of this.adjacency.get(id) ?? []) {
        const alt = (dist.get(id) ?? Number.POSITIVE_INFINITY) + conn.weight;
        if (alt < (dist.get(conn.n2) ?? Number.POSITIVE_INFINITY)) {
          dist.set(conn.n2, alt);
          prev.set(conn.n2, id);
          queue.push({ d: alt, id: conn.n2 });
        }
      }
    }

    const weight = dist.get(to.id) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(weight)) return { weight: Number.POSITIVE_INFINITY, path: [] };

    const path: GraphNode[] = [];
    let step: number | undefined = to.id;
    while (step !== undefined) {
      path.unshift(this.nodes[step]!);
      if (step === from.id) break;
      step = prev.get(step);
    }

    return { weight, path };
  }
}
