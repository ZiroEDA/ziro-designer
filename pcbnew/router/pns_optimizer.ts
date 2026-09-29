// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tidying a route after it has been found: the whole of `OPTIMIZER`.
 * Counterpart: `pcbnew/router/pns_optimizer.cpp`, whole — this file used to be
 * split into three (`pns_optimizer.ts`, `pns_optimizer_diff_pair.ts`,
 * `pns_smart_pads.ts`); merged back 2026-09-29 to match the single upstream
 * file (the router file-structure parity pass). Each section below keeps the
 * detailed doc comment it had as a standalone file.
 *
 * ## Section 1: the single-line merge passes (`mergeColinear`/`mergeObtuse`/
 * `mergeFull`/`optimize`)
 *
 * Walkaround produces a route that is *correct* and rarely one anybody would
 * draw: it hugs every hull it passes, so three obstacles come back as twenty
 * points, most of them tracing octagon corners that no longer matter once the
 * path is clear of them. This is the pass that takes those out.
 *
 * Cost is corners, not length: the thing being minimised is not how long the
 * track is. It is a tally over consecutive segment pairs — a straight join
 * costs 5, an obtuse bend 10, a right angle 30, an acute one 50 — so the
 * optimiser will happily accept a slightly *longer* route that turns less.
 * That is the right objective for a board: a track with fewer corners is
 * easier to follow, etches more predictably, and is what a person would have
 * drawn.
 *
 * Every candidate is re-checked against the obstacles: each pass proposes a
 * shortcut and then asks whether it collides before keeping it. Skipping that
 * would make the optimiser undo exactly the detours walkaround just went to
 * the trouble of finding — the shortest path between two points on either
 * side of a pad goes straight through the pad.
 *
 * The caller supplies the collision test, so the pure single-line passes know
 * nothing about boards or hulls, and the optimiser can be run against
 * whatever notion of "blocked" the caller has.
 *
 * ## Section 2: `SMART_PADS` and `FANOUT_CLEANUP`, and the breakout machinery
 * underneath them
 *
 * Counterparts (within `pns_optimizer.cpp`): `runSmartPads`, `smartPadsSingle`,
 * `computeBreakouts`, `circleBreakouts`, `rectBreakouts`, `customBreakouts`,
 * `findPadOrVia`, `fanoutCleanup`; plus `ApproximateSegmentAsRect`
 * (`pcbnew/router/pns_utils.cpp`).
 *
 * These need `NODE`'s joint model: the pass has to ask *what is at the end of
 * this line* before it can reroute the exit, and that question is
 * `NODE::FindJoint`. They are the difference between a route that is correct
 * and one that looks drawn by hand — a track leaving a pad on the diagonal
 * instead of clipping its corner. Unlike Section 1, these take a `PnsNode`
 * and a `PnsLine`, because a breakout depends on the *item* at the line's end
 * and its shape.
 *
 * Breakouts, and the one place Ziro's shape union forces a decision: upstream
 * dispatches on `SHAPE::Type()`: `SH_RECT` takes {@link rectBreakouts} (twelve
 * rays, with the diagonal ones offset along the pad's long axis so an oblong
 * pad is left along its length), `SH_CIRCLE` takes {@link circleBreakouts}
 * (eight rays at 45°), `SH_SEGMENT` is approximated as a rect first, and
 * `SH_SIMPLE` takes {@link customBreakouts}, which casts rays and keeps where
 * they cross the outline.
 *
 * Ziro has no rectangle shape — a rectangular pad arrives as a `poly`.
 * Sending every `poly` to `customBreakouts` would be the literal reading of
 * the union and the wrong one: it would give a plain rectangular pad eight
 * ray-cast breakouts where KiCad gives it twelve with the long-axis offset,
 * and oblong pads are exactly what this pass exists to serve. So an
 * axis-aligned four-point `poly` is recognised as a rectangle and routed to
 * {@link rectBreakouts}; anything else is a `SH_SIMPLE`. That recognition is
 * the only judgement in this file, and it is pinned by tests on both sides.
 *
 * Faithfully reproduced, not to be "fixed": `smartPadsSingle` refuses vias
 * outright — upstream's comment says they are always round "at the moment"
 * and the optimizer would mess up an intended via exit posture — so
 * {@link computeBreakouts} builds circle breakouts for a via that
 * `smartPadsSingle` then never asks for. Offset pads are refused too.
 * `fanoutCleanup` requires a `startPad` but accepts a missing `endPad` when
 * the line ends in a via, and its length threshold is ten times the track
 * width.
 *
 * ## Section 3: `OPTIMIZER::Optimize( DIFF_PAIR* )` — tidying a routed
 * differential pair
 *
 * Counterparts (within `pns_optimizer.cpp`): `findCoupledVertices`,
 * `verifyDpBypass`, `coupledBypass`, `checkDpColliding`, `mergeDpStep`,
 * `mergeDpSegments`, `Optimize( DIFF_PAIR* )`, lines 1157-1374.
 *
 * What this pass optimises, and why it is not the single-line one: Section 1
 * minimises **corners**: it will accept a longer route that turns less. That
 * objective is wrong for a pair. What matters here is *coupling* — how much
 * of the two lanes runs side by side at the intended gap — and a shortcut
 * that straightens one lane while the other keeps its detour has made the
 * pair worse even though it removed a corner. So the whole pass is built
 * around `DIFF_PAIR::CoupledLength` instead, and every candidate is scored as
 * a delta against the coupled length the pair already had, with a tolerance
 * of one tenth of it (`budget`, and upstream's *"fixme: come up with
 * something more intelligent here..."* stands).
 *
 * There are two ways a merge can pay for itself, and the order they are
 * tried in is the interesting part. First the pass looks for a matching
 * bypass on the *other* lane ({@link coupledBypass}), so both lanes shorten
 * together and the coupling survives. Only if no such bypass exists does it
 * consider shortening one lane alone, and then only if the coupled length it
 * loses fits in the budget. A found-but-unprofitable coupled bypass does
 * **not** fall back to the one-sided arm — upstream's `else if` — so the
 * pass would rather leave a corner in than break the pair up.
 *
 * The lane-versus-lane test used to be a local workaround: `verifyDpBypass`
 * opens by colliding the two candidate lanes against each other. That was
 * unconditionally `false` in this port until ZiroEDA issue #484 was fixed —
 * `PnsLine.shape()` answered null and `collideSimple` bailed at its
 * `if (!shapeI || !shapeH)` — so this section carried a `linesCollide` that
 * cut both lanes into `SEGMENT`s and collided those pairwise. `PnsItem.shapes()`
 * now gives the collision path the chain itself, so the workaround is gone
 * and the call site is upstream's plain `refLine.Collide( &coupledLine, ... )`.
 * Note that this is not merely equivalent but strictly closer: the
 * workaround asked the rule resolver about scratch `SEGMENT`s, where
 * upstream asks it about the two `LINE`s.
 *
 * Not ported from the same upstream file, and why: `Tighten`, `tightenSegment`
 * and `shovedArea` (`pns_optimizer.cpp:1378-1539`) are dead upstream: `Tighten`
 * has no declaration in any header and no caller anywhere in the tree, and
 * the other two exist only to serve it. They are the last thing in the file
 * and they are left there. {@link checkDpColliding} is in exactly the same
 * position — defined, declared nowhere, called nowhere — and *is* ported,
 * because the port of this file was asked for by name; it is labelled dead
 * at its site rather than quietly dropped.
 *
 * Not ported: the dimensions dialog is `pns_diff_pair_placer.cpp`'s concern,
 * not this file's.
 */
import { AngleType, Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { EuclideanNormI, type Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { intersectLines, segmentCount, type Seg } from './pns_line.js';
import type { Chain } from './pns_chain.js';
import { PnsLine, PnsLineChain } from './pns_line.js';
import { segApproxParallel, segLineProject } from './pns_seg_ops.js';
import type { DiffPair } from './pns_diff_pair.js';
import type { PnsNode } from './pns_node.js';
import { PnsKind, type PnsItem } from './pns_item.js';
import { PnsSolid } from './pns_solid.js';
import type { NetHandle } from './pns_collision.js';
import type { Shape } from '../drc/drc_geometry.js';

/** Does this candidate route hit anything? */
export type CollisionTest = (path: Chain) => boolean;

/**
 * `COST_ESTIMATOR::CornerCost` for one join.
 *
 * The numbers are upstream's and their *ordering* is the whole content: a
 * straight run is cheapest, then obtuse, then a right angle, then acute. An
 * undefined join — one of the segments has no direction, because it is
 * zero-length — costs most of all, so degenerate geometry is never chosen.
 */
export function cornerCost(a: Vec2, b: Vec2, c: Vec2): number {
  const dirA = Direction45.fromSeg(a, b);
  const dirB = Direction45.fromSeg(b, c);

  switch (dirA.angle(dirB)) {
    case AngleType.ANG_OBTUSE:
      return 10;
    case AngleType.ANG_STRAIGHT:
      return 5;
    case AngleType.ANG_ACUTE:
      return 50;
    case AngleType.ANG_RIGHT:
      return 30;
    case AngleType.ANG_HALF_FULL:
      return 60;
    default:
      return 100;
  }
}

/** `COST_ESTIMATOR::CornerCost` over a whole chain. */
export function chainCornerCost(chain: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i + 2 < chain.length; i++)
    total += cornerCost(chain[i]!, chain[i + 1]!, chain[i + 2]!);
  return total;
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const squaredLength = (a: Vec2, b: Vec2): number => (b.x - a.x) ** 2 + (b.y - a.y) ** 2;

/** Whether three points lie on one line. */
function collinear(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) === 0;
}

/**
 * `mergeColinear`: drop a point that sits in the middle of a straight run.
 *
 * Needs no collision check, which is what makes it the one pass that is always
 * safe to run: removing a point from a straight line does not move the line.
 * Zero-length segments are skipped rather than merged, since they have no
 * direction to be collinear with.
 */
export function mergeColinear(chain: Chain): Chain {
  const out = [...chain];

  for (let i = 0; i + 2 < out.length; ) {
    const a = out[i]!;
    const b = out[i + 1]!;
    const c = out[i + 2]!;

    if (squaredLength(a, b) === 0 || squaredLength(b, c) === 0) {
      i++;
      continue;
    }

    if (collinear(a, b, c)) out.splice(i + 1, 1);
    else i++;
  }

  return out;
}

/**
 * `mergeObtuse`: replace a run between two obtuse segments with their meeting
 * point.
 *
 * The span is tried widest-first — `step` counts down from nearly the whole
 * chain — because collapsing a long stretch in one move is worth far more than
 * collapsing several short ones, and a wide merge often makes the narrow ones
 * unnecessary. Restarting the scan after every success is upstream's, and it
 * matters: the chain has changed underneath, so the indices the loop was
 * holding no longer mean what they meant.
 */
export function mergeObtuse(chain: Chain, collides: CollisionTest): Chain {
  let current = [...chain];
  let step = current.length - 3;
  if (step < 0) return current;

  for (;;) {
    const nSegs = current.length - 1;
    if (step > nSegs - 2) step = nSegs - 2;

    // Upstream's floor of 2, and it is load-bearing for termination rather
    // than merely a cost cutoff. A step of 1 picks two *adjacent* segments,
    // whose lines meet at the point they already share, so the merge replaces
    // that point with itself: the chain never gets shorter, `found` is set
    // every pass, and the loop runs forever. Not testable without hanging the
    // suite, hence the note.
    if (step < 2) return current;

    let found = false;

    for (let n = 0; n < nSegs - step; n++) {
      const s1a = current[n]!;
      const s1b = current[n + 1]!;
      const s2a = current[n + step]!;
      const s2b = current[n + step + 1]!;

      if (!Direction45.fromSeg(s1a, s1b).isObtuse(Direction45.fromSeg(s2a, s2b))) continue;

      const ip = intersectLines({ a: s1a, b: s1b }, { a: s2a, b: s2b });
      if (!ip) continue;

      // The join must still be obtuse once the two are extended to meet;
      // otherwise the "shortcut" is a sharper turn than what it replaced.
      if (!Direction45.fromSeg(s1a, ip).isObtuse(Direction45.fromSeg(ip, s2b))) continue;

      if (collides([s1a, ip, s2b])) continue;

      current = [...current.slice(0, n + 1), ip, ...current.slice(n + step + 1)];
      found = true;
      break;
    }

    if (!found) {
      if (step <= 2) return current;
      step--;
    }
  }
}

/**
 * `mergeStep`: try to replace the run between two segments with a fresh
 * two-segment trace, keeping it only if it turns less.
 *
 * Both postures are tried — diagonal-first and axis-first — because which one
 * is cheaper depends on what the rest of the chain does either side, and there
 * is no local rule that decides it. Upstream builds both and compares, and so
 * does this.
 */
function mergeStep(current: Chain, step: number, collides: CollisionTest): Chain | null {
  const nSegs = current.length - 1;
  const costOrig = chainCornerCost(current);

  for (let n = 0; n < nSegs - step; n++) {
    const from = current[n]!;
    const to = current[n + step + 1]!;

    let best: Chain | null = null;
    let bestCost = costOrig;

    for (const startDiagonal of [false, true]) {
      const bypass = Direction45.of().buildInitialTrace(from, to, startDiagonal);
      const candidate = [
        ...current.slice(0, n),
        from,
        ...bypass.slice(1),
        ...current.slice(n + step + 2),
      ];
      const simplified = mergeColinear(candidate);

      if (collides(simplified)) continue;

      const cost = chainCornerCost(simplified);

      // Strictly cheaper, and like `mergeObtuse`'s floor of 2 this is what
      // makes the caller terminate rather than a matter of taste. `bestCost`
      // starts at the current chain's cost, so accepting an equal-cost rewrite
      // hands `mergeFull` a "better" chain that is no better; it loops on the
      // same span forever, finding the same tie every time.
      if (cost < bestCost) {
        bestCost = cost;
        best = simplified;
      }
    }

    if (best) return best;
  }

  return null;
}

/**
 * `mergeFull`: keep replacing runs with cheaper traces until nothing improves.
 *
 * Widest span first, narrowing only when a whole pass finds nothing, for the
 * same reason `mergeObtuse` does it: the big wins subsume the small ones and
 * finding them first saves the small ones being found at all.
 */
export function mergeFull(chain: Chain, collides: CollisionTest): Chain {
  let current = mergeColinear(chain);
  let step = current.length - 2;

  while (step >= 1) {
    if (step > current.length - 3) step = current.length - 3;
    if (step < 1) break;

    const merged = mergeStep(current, step, collides);

    if (merged) current = merged;
    else step--;
  }

  return current;
}

/** Which passes to run. Upstream's effort flags, minus the ones not ported. */
export interface OptimizeEffort {
  /** `MERGE_SEGMENTS`: replace runs with cheaper two-segment traces. */
  mergeSegments?: boolean;
  /** `MERGE_OBTUSE`: collapse obtuse pairs onto their meeting point. */
  mergeObtuse?: boolean;
  /** `MERGE_COLINEAR`: drop points inside straight runs. */
  mergeColinear?: boolean;
}

/**
 * `OPTIMIZER::Optimize`, in upstream's order: segments, then obtuse, then
 * collinear.
 *
 * The order is upstream's and, on the evidence, it is the only reason to keep
 * it: moving the collinear pass to the front changes no result I could find.
 * `mergeFull` already runs it on entry and on every candidate it builds, and a
 * search over 60k random chains never found a `mergeObtuse` merge that left a
 * straight run behind — obtuse merges produce obtuse corners by construction.
 * So the standalone collinear pass earns its place mainly when `mergeSegments`
 * is switched off. Kept in upstream's order anyway: it costs nothing, and
 * matching the C++ is worth more than a reordering nobody can observe.
 *
 * `SMART_PADS` and `FANOUT_CLEANUP` are the node-aware passes below
 * ({@link runSmartPads}, {@link fanoutCleanup}) — not run from here, the same
 * way upstream's callers invoke them as separate `OPTIMIZER` effort flags.
 */
export function optimize(
  chain: Chain,
  collides: CollisionTest,
  effort: OptimizeEffort = { mergeSegments: true, mergeObtuse: true, mergeColinear: true },
): Chain {
  let out = [...chain];

  if (out.length < 3) return out;

  if (effort.mergeSegments) out = mergeFull(out, collides);
  if (effort.mergeObtuse) out = mergeObtuse(out, collides);
  if (effort.mergeColinear) out = mergeColinear(out);

  // A pass may have collapsed the route onto a repeated point; the caller
  // expects a chain it can lay segments along.
  return out.filter((p, i) => i === 0 || !same(p, out[i - 1]!));
}

// ---------------------------------------------------------------------------
// Section 2: SMART_PADS / FANOUT_CLEANUP and the breakout machinery
// ---------------------------------------------------------------------------

/** `OPTIMIZER::BREAKOUT_LIST`: candidate exits, each a chain from the centre. */
export type BreakoutList = Vec2[][];

/**
 * The angles `smartPadsSingle` refuses between a breakout's last segment and
 * the connecting trace. Upstream spells the mask out at the top of the
 * function rather than reusing one.
 */
export const SMART_PADS_FORBIDDEN_ANGLES =
  AngleType.ANG_ACUTE | AngleType.ANG_RIGHT | AngleType.ANG_HALF_FULL | AngleType.ANG_UNDEFINED;

/** An axis-aligned rectangle, standing in for `SHAPE_RECT`. */
export interface BreakoutRect {
  pos: Vec2;
  size: Vec2;
}

/**
 * `ApproximateSegmentAsRect` (`pns_utils.cpp`).
 *
 * Note it grows *both* ends by half the width in *both* axes — it is the
 * bounding box of the segment inflated by a square, not a stadium, so a
 * diagonal segment gets a box far larger than the shape it stands for. That is
 * upstream's, and the only consumer is a breakout ray direction.
 */
export function approximateSegmentAsRect(aA: Vec2, aB: Vec2, aWidth: number): BreakoutRect {
  const d = Math.trunc(aWidth / 2);
  const p0 = { x: aA.x - d, y: aA.y - d };
  const p1 = { x: aB.x + d, y: aB.y + d };

  return {
    pos: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y) },
    size: { x: Math.abs(p1.x - p0.x), y: Math.abs(p1.y - p0.y) },
  };
}

/**
 * `OPTIMIZER::circleBreakouts`.
 *
 * Eight rays at 45°, each reaching `radius * sqrt(2)` — the circumradius of the
 * square around the circle, so a diagonal exit clears the corner a rectangular
 * pad of the same size would have. `aWidth` is accepted and unused, as upstream.
 */
export function circleBreakouts(_aWidth: number, aCentre: Vec2, aRadius: number): BreakoutList {
  const out: BreakoutList = [];

  for (let deg = 0; deg < 360; deg += 45) {
    const v = RotatePoint({ x: Math.trunc(aRadius * Math.SQRT2), y: 0 }, new EDA_ANGLE(-deg));
    out.push([{ ...aCentre }, { x: aCentre.x + v.x, y: aCentre.y + v.y }]);
  }

  return out;
}

/**
 * `OPTIMIZER::rectBreakouts`.
 *
 * Four axis exits, then — when diagonals are permitted — four more that step
 * along the pad's **long** axis first and only then turn 45°. That offset is
 * the whole point of the routine: on an oblong pad it makes the diagonal exit
 * leave from near the end rather than from the centre, so the track follows the
 * pad's preferential direction instead of paralleling its short side.
 *
 * Upstream's two arms differ only in which of the four diagonals get which
 * sign, and its own comment on the second says "fixme: this could be done more
 * efficiently". Both are transcribed as written.
 */
export function rectBreakouts(
  aWidth: number,
  aRect: BreakoutRect,
  aPermitDiagonal: boolean,
): BreakoutList {
  const s = aRect.size;
  const c = {
    x: aRect.pos.x + Math.trunc(s.x / 2),
    y: aRect.pos.y + Math.trunc(s.y / 2),
  };

  const dOffset = {
    x: s.x > s.y ? Math.trunc((s.x - s.y) / 2) : 0,
    y: s.x < s.y ? Math.trunc((s.y - s.x) / 2) : 0,
  };
  const dVert = { x: 0, y: Math.trunc(s.y / 2) + aWidth };
  const dHoriz = { x: Math.trunc(s.x / 2) + aWidth, y: 0 };

  const add = (v: Vec2): Vec2 => ({ x: c.x + v.x, y: c.y + v.y });
  const sub = (v: Vec2): Vec2 => ({ x: c.x - v.x, y: c.y - v.y });

  const out: BreakoutList = [
    [{ ...c }, add(dHoriz)],
    [{ ...c }, sub(dHoriz)],
    [{ ...c }, add(dVert)],
    [{ ...c }, sub(dVert)],
  ];

  if (!aPermitDiagonal) return out;

  const l = aWidth + Math.trunc(Math.min(s.x, s.y) / 2);
  const plus = add(dOffset);
  const minus = sub(dOffset);
  const off = (p: Vec2, dx: number, dy: number): Vec2 => ({ x: p.x + dx, y: p.y + dy });

  if (s.x >= s.y) {
    out.push([{ ...c }, plus, off(plus, l, l)]);
    out.push([{ ...c }, plus, off(plus, -l, -l)]);
    out.push([{ ...c }, minus, off(minus, -l, l)]);
    out.push([{ ...c }, minus, off(minus, l, -l)]);
  } else {
    out.push([{ ...c }, plus, off(plus, l, l)]);
    out.push([{ ...c }, minus, off(minus, -l, l)]);
    out.push([{ ...c }, plus, off(plus, -l, l)]);
    out.push([{ ...c }, minus, off(minus, l, -l)]);
  }

  return out;
}

/** Segment-vs-segment intersection, for the ray casts `customBreakouts` makes. */
function raySegIntersect(aP0: Vec2, aP1: Vec2, aA: Vec2, aB: Vec2): Vec2 | null {
  const rx = aP1.x - aP0.x;
  const ry = aP1.y - aP0.y;
  const sx = aB.x - aA.x;
  const sy = aB.y - aA.y;
  const denom = rx * sy - ry * sx;

  if (denom === 0) return null;

  const t = ((aA.x - aP0.x) * sy - (aA.y - aP0.y) * sx) / denom;
  const u = ((aA.x - aP0.x) * ry - (aA.y - aP0.y) * rx) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: Math.round(aP0.x + t * rx), y: Math.round(aP0.y + t * ry) };
}

/**
 * `OPTIMIZER::customBreakouts`.
 *
 * Casts a ray from the pad's position out past its bounding box and keeps the
 * point where it crosses the outline. Upstream carries two commented-out
 * alternatives — a breakout set back by 40% of the centre-to-edge distance, and
 * an absolute 0.1 mm — and uses neither; the breakout sits **on** the edge.
 * That is left as-is, comments and all, because the choice is visible in every
 * routed exit.
 *
 * The ray is `max(w, h) / 2 + 5` long, upstream's "must be large enough to
 * guarantee intersecting the convex polygon". Rays that hit nothing are
 * dropped — upstream notes `n == 0` "can not happen I think, but...".
 */
export function customBreakouts(
  _aWidth: number,
  aPos: Vec2,
  aOutline: readonly Vec2[],
  aPermitDiagonal: boolean,
): BreakoutList {
  const out: BreakoutList = [];

  if (aOutline.length < 2) return out;

  const xs = aOutline.map((p) => p.x);
  const ys = aOutline.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const length = Math.trunc(Math.max(w, h) / 2) + 5;
  const increment = aPermitDiagonal ? 45 : 90;

  for (let deg = 0; deg < 360; deg += increment) {
    const v = RotatePoint({ x: aPos.x + length, y: aPos.y }, aPos, new EDA_ANGLE(-deg));

    let hit: Vec2 | null = null;

    for (let i = 0; i < aOutline.length && !hit; i++) {
      const a = aOutline[i] as Vec2;
      const b = aOutline[(i + 1) % aOutline.length] as Vec2;
      hit = raySegIntersect(aPos, v, a, b);
    }

    if (hit) out.push([{ ...aPos }, hit]);
  }

  return out;
}

/**
 * An axis-aligned four-point `poly` read back as a rectangle.
 *
 * Ziro's `Shape` union has no rectangle, so this is how a `SH_RECT` pad reaches
 * {@link rectBreakouts} rather than being demoted to a ray-cast `SH_SIMPLE`.
 * Anything rotated, or with any other vertex count, is not a rectangle.
 */
export function polyAsAxisAlignedRect(aPts: readonly Vec2[]): BreakoutRect | null {
  if (aPts.length !== 4) return null;

  const xs = [...new Set(aPts.map((p) => p.x))];
  const ys = [...new Set(aPts.map((p) => p.y))];

  if (xs.length !== 2 || ys.length !== 2) return null;

  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);

  return { pos: { x: x0, y: y0 }, size: { x: Math.max(...xs) - x0, y: Math.max(...ys) - y0 } };
}

/** `OPTIMIZER::computeBreakouts`, over Ziro's shape union. */
export function computeBreakouts(
  aWidth: number,
  aItem: PnsItem,
  aPermitDiagonal: boolean,
): BreakoutList {
  const shape: Shape | null = aItem.shape(-1);

  if (!shape) return [];

  if (aItem.kind() === PnsKind.VIA_T) {
    // Upstream reads the via's layer-0 shape and notes a padstack TODO.
    return shape.kind === 'circle' ? circleBreakouts(aWidth, shape.c, shape.r) : [];
  }

  if (aItem.kind() !== PnsKind.SOLID_T) return [];

  switch (shape.kind) {
    case 'circle':
      return circleBreakouts(aWidth, shape.c, shape.r);
    case 'stadium':
      // `SH_SEGMENT` -> ApproximateSegmentAsRect -> rectBreakouts.
      return rectBreakouts(
        aWidth,
        approximateSegmentAsRect(shape.a, shape.b, shape.r * 2),
        aPermitDiagonal,
      );
    case 'poly': {
      const rect = polyAsAxisAlignedRect(shape.pts);

      if (rect) return rectBreakouts(aWidth, rect, aPermitDiagonal);

      const pos = aItem instanceof PnsSolid ? aItem.pos() : shape.pts[0];

      return pos ? customBreakouts(aWidth, pos, shape.pts, aPermitDiagonal) : [];
    }
    default:
      return [];
  }
}

/**
 * `OPTIMIZER::findPadOrVia`.
 *
 * The joint at the line's end, and the first via or pad linked to it. Note it
 * returns the *first* such link rather than the nearest or the largest — link
 * order is the answer.
 */
export function findPadOrVia(
  aNode: PnsNode,
  aLayer: number,
  aNet: NetHandle,
  aP: Vec2,
): PnsItem | null {
  const jt = aNode.findJoint(aP, aLayer, aNet);

  if (!jt) return null;

  for (const item of jt.linkList()) {
    if (item.ofKind(PnsKind.VIA_T | PnsKind.SOLID_T)) return item;
  }

  return null;
}

/** The corner count of a chain against a forbidden-angle mask. `LINE::CountCorners`. */
export function countCorners(aChain: readonly Vec2[], aAngles: number): number {
  let count = 0;

  for (let i = 0; i < aChain.length - 2; i++) {
    const a = Direction45.fromSeg(aChain[i] as Vec2, aChain[i + 1] as Vec2);
    const b = Direction45.fromSeg(aChain[i + 1] as Vec2, aChain[i + 2] as Vec2);

    if (a.angle(b) & aAngles) count++;
  }

  return count;
}

const chainLength = (c: readonly Vec2[]): number => {
  let l = 0;
  for (let i = 0; i + 1 < c.length; i++)
    l += Math.hypot(
      (c[i + 1] as Vec2).x - (c[i] as Vec2).x,
      (c[i + 1] as Vec2).y - (c[i] as Vec2).y,
    );
  return l;
};

/** A candidate rerouted exit, as `smartPadsSingle`'s `RtVariant` tuple. */
interface PadVariant {
  p: number;
  breakoutLength: number;
  chain: Vec2[];
}

/**
 * `OPTIMIZER::smartPadsSingle`.
 *
 * Tries every breakout against every one of the first three vertices, in both
 * postures, and keeps the cheapest that collides with nothing. The tie-break is
 * the part worth reading: **at equal corner cost the longer breakout wins**,
 * because on an oblong pad that is the exit that follows the pad's length
 * rather than paralleling its short side.
 *
 * The baseline is the line the user drew, so a route already good enough is
 * left alone. Vias and offset pads are refused outright.
 */
export function smartPadsSingle(
  aLine: PnsLine,
  aPad: PnsItem,
  aEnd: boolean,
  aEndVertex: number,
  aCollides: (chain: readonly Vec2[]) => boolean,
): { chain: Vec2[]; vertex: number } | null {
  const solid = aPad instanceof PnsSolid ? aPad : null;

  // Offset pads: the breakout geometry is built around the pad's position, so
  // an offset one would exit from the wrong place.
  if (solid) {
    const o = solid.offset();
    if (o.x !== 0 || o.y !== 0) return null;
  }

  // Vias are always round at the moment and the optimizer would possibly mess
  // up an intended via exit posture.
  if (aPad.kind() === PnsKind.VIA_T) return null;

  const breakouts = computeBreakouts(aLine.width(), aPad, true);
  const base = aLine.cLine().points();
  const line = aEnd ? [...base].reverse() : [...base];
  const pEnd = Math.min(aEndVertex, Math.min(3, line.length - 1));
  const variants: PadVariant[] = [];
  const lineLen = chainLength(line);

  // Start at 1: 0 is the pad connection itself.
  for (let p = 1; p <= pEnd; p++) {
    for (const breakout of breakouts) {
      for (let diag = 0; diag < 2; diag++) {
        const last = breakout[breakout.length - 1] as Vec2;
        const connect = Direction45.UNDEFINED.buildInitialTrace(last, line[p] as Vec2, diag === 0);

        if (connect.length < 2) continue;

        const dirBreakout = Direction45.fromSeg(breakout[breakout.length - 2] ?? last, last);
        const dirConnect = Direction45.fromSeg(connect[0] as Vec2, connect[1] as Vec2);

        if (dirBreakout.angle(dirConnect) & SMART_PADS_FORBIDDEN_ANGLES) continue;

        const breakoutLen = chainLength(breakout);

        if (breakoutLen > lineLen) continue;

        const v = [...breakout, ...connect];

        for (let i = p + 1; i < line.length; i++) v.push(line[i] as Vec2);

        if (countCorners(v, SMART_PADS_FORBIDDEN_ANGLES) !== 0) continue;

        variants.push({ p, breakoutLength: breakoutLen, chain: aEnd ? [...v].reverse() : v });
      }
    }
  }

  let minCost = chainCornerCost(base);
  let maxLength = 0;
  let best: PadVariant | null = null;

  for (const vp of variants) {
    const cost = chainCornerCost(vp.chain);

    if (aCollides(vp.chain)) continue;

    if (cost < minCost || (cost === minCost && vp.breakoutLength > maxLength)) {
      best = vp;

      if (cost <= minCost) maxLength = Math.max(vp.breakoutLength, maxLength);

      minCost = Math.min(cost, minCost);
    }
  }

  return best ? { chain: best.chain, vertex: best.p } : null;
}

/**
 * `OPTIMIZER::runSmartPads`.
 *
 * Both ends, start first. The second call's vertex budget depends on whether
 * the first found anything — upstream passes `PointCount() - 1` when it did
 * not, and `PointCount() - 1 - vtx` when it did, so a start reroute that ate
 * three vertices leaves the end pass three fewer to work with.
 */
export function runSmartPads(
  aLine: PnsLine,
  aNode: PnsNode,
  aCollides: (chain: readonly Vec2[]) => boolean,
): boolean {
  if (aLine.pointCount() < 3) return false;

  const pStart = aLine.cPoint(0);
  const pEnd = aLine.cLastPoint();
  const layer = aLine.layers().start();
  const startPad = findPadOrVia(aNode, layer, aLine.net(), pStart);
  const endPad = findPadOrVia(aNode, layer, aLine.net(), pEnd);

  let vtx = -1;

  if (startPad) {
    const r = smartPadsSingle(aLine, startPad, false, 3, aCollides);

    if (r) {
      aLine.setShape(PnsLineChain.fromPoints(r.chain));
      vtx = r.vertex;
    }
  }

  if (endPad) {
    const budget = vtx < 0 ? aLine.pointCount() - 1 : aLine.pointCount() - 1 - vtx;
    const r = smartPadsSingle(aLine, endPad, true, budget, aCollides);

    if (r) aLine.setShape(PnsLineChain.fromPoints(r.chain));
  }

  return true;
}

/**
 * `OPTIMIZER::fanoutCleanup`.
 *
 * A short line between two pads, or a pad and a via, is replaced outright by a
 * two-segment trace if either posture is clear. "Short" is ten times the track
 * width, which is why a fanout escape gets straightened and a real route does
 * not.
 *
 * Note the asymmetry: a missing `startPad` refuses immediately, but a missing
 * `endPad` is still accepted when the line ends in a via — upstream falls back
 * to `EndsWithVia()` there and to nothing at the start.
 */
export function fanoutCleanup(
  aLine: PnsLine,
  aNode: PnsNode,
  aCollides: (chain: readonly Vec2[]) => boolean,
): boolean {
  if (aLine.pointCount() < 3) return false;

  const pStart = aLine.cPoint(0);
  const pEnd = aLine.cLastPoint();
  const layer = aLine.layers().start();
  const startPad = findPadOrVia(aNode, layer, aLine.net(), pStart);
  const endPad = findPadOrVia(aNode, layer, aLine.net(), pEnd);

  if (!startPad) return false;

  const thr = aLine.width() * 10;
  const len = chainLength(aLine.cLine().points());
  const startMatch = startPad.ofKind(PnsKind.VIA_T | PnsKind.SOLID_T);
  const endMatch = endPad ? endPad.ofKind(PnsKind.VIA_T | PnsKind.SOLID_T) : aLine.endsWithVia();

  if (!(startMatch && endMatch && len < thr)) return false;

  for (let i = 0; i < 2; i++) {
    // Upstream passes ROUTER::Settings().GetCornerMode() here. buildInitialTrace
    // takes no corner-mode argument yet — only the mitered-45 arm is written —
    // so this is the mitered-45 behaviour, which is the default and the only
    // mode that currently builds geometry. Thread the mode through when the
    // 90-degree arm lands.
    const l2 = Direction45.UNDEFINED.buildInitialTrace(pStart, pEnd, i === 1);

    if (!aCollides(l2)) {
      aLine.setShape(PnsLineChain.fromPoints(l2));
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Section 3: OPTIMIZER::Optimize( DIFF_PAIR* ) — the differential-pair pass
// ---------------------------------------------------------------------------

/**
 * `findCoupledVertices`: which vertices of the *other* lane sit at the pair's
 * gap from this one, measured along a parallel segment.
 *
 * Two things upstream does here are kept rather than tidied:
 *
 *  - **the returned index is a segment index, used everywhere as a point
 *    index.** The loop runs over `SegmentCount()` and records `i`, and every
 *    caller then reads `aCoupled.CPoint( i )` — which is that segment's *start*
 *    point. It works, and it is not what the variable name says;
 *  - **the distance is measured to the infinite line**, not to the segment:
 *    `LineProject` projects onto the segment's line with no clamping, so a
 *    vertex well past the end of a parallel segment still counts as coupled to
 *    it if the perpendicular distance matches.
 *
 * Upstream's buffer is `int vStartIdx[1024]` with a `// fixme: possible
 * overflow` comment, and a 1025th match is undefined behaviour. There is no
 * defined behaviour to reproduce, so this returns a plain growable array.
 */
export function findCoupledVertices(
  aVertex: Vec2,
  aOrigSeg: Seg,
  aCoupled: PnsLineChain,
  aPair: DiffPair,
): number[] {
  const out: number[] = [];

  for (let i = 0; i < aCoupled.segmentCount(); i++) {
    const s = aCoupled.cSegment(i);
    const projOverCoupled = segLineProject(s, aVertex);

    if (segApproxParallel(s, aOrigSeg)) {
      const dist =
        EuclideanNormI({ x: projOverCoupled.x - aVertex.x, y: projOverCoupled.y - aVertex.y }) -
        aPair.width();

      if (aPair.gapConstraint().matches(dist)) out.push(i);
    }
  }

  return out;
}

/**
 * `verifyDpBypass`: are these two candidate lanes clear of each other and of
 * everything else in the node?
 *
 * `aRefIsP` says which lane the reference chain belongs to, and it decides only
 * which cached `LINE` each chain is dressed in — the net, width, layers and
 * links come from there, and they are what the collision tests actually read.
 *
 * The first of the three tests was dead until issue #484 was fixed; see the
 * module note.
 */
export function verifyDpBypass(
  aNode: PnsNode,
  aPair: DiffPair,
  aRefIsP: boolean,
  aNewRef: PnsLineChain,
  aNewCoupled: PnsLineChain,
): boolean {
  const refLine = PnsLine.fromBase(aRefIsP ? aPair.pLine() : aPair.nLine(), aNewRef);
  const coupledLine = PnsLine.fromBase(aRefIsP ? aPair.nLine() : aPair.pLine(), aNewCoupled);

  if (refLine.collide(coupledLine, aNode, refLine.layer())) return false;

  if (aNode.checkColliding(refLine)) return false;

  if (aNode.checkColliding(coupledLine)) return false;

  return true;
}

/**
 * `coupledBypass`: given a shortcut just taken on one lane, find the matching
 * shortcut on the other.
 *
 * Upstream's out-parameter plus `bool` is a nullable return here — it sets
 * `aNewCoupled` only when it found something, which is the same contract.
 *
 * The search is a full cross product of "where the bypass could start" (the
 * vertices {@link findCoupledVertices} says are at the right gap) against
 * "where it could end" (every vertex of the coupled lane except the first and
 * **the last** — the loop bound is `PointCount() - 1`, exclusive). Spans of one
 * vertex or less are skipped by `delta > 1`, which also rules out the
 * degenerate `si == ei`.
 *
 * Three faithful details that each change the answer:
 *
 *  - `dir` is built from the reference bypass's first segment and is therefore
 *    *defined*, so `BuildInitialTrace` uses **its** posture and ignores the
 *    `dir.IsDiagonal()` argument upstream passes it. The argument is passed
 *    here too, and is just as inert;
 *  - the score is `CoupledLength( aRef, bypass )` — against the raw bypass, not
 *    against the spliced-together `newCoupled` that would actually be kept. The
 *    thing being ranked is not the thing being stored;
 *  - `verifyDpBypass` sits on the right of `&&`, so a candidate that does not
 *    beat the best score so far is never validated at all. That is only an
 *    ordering artefact when a later candidate scores lower, but it means the
 *    number of collision queries depends on the order the candidates come in.
 */
export function coupledBypass(
  aNode: PnsNode,
  aPair: DiffPair,
  aRefIsP: boolean,
  aRef: PnsLineChain,
  aRefBypass: PnsLineChain,
  aCoupled: PnsLineChain,
): PnsLineChain | null {
  const vStartIdx = findCoupledVertices(
    aRefBypass.cPoint(0),
    aRefBypass.cSegment(0),
    aCoupled,
    aPair,
  );
  const dir = Direction45.fromSeg(aRefBypass.cSegment(0).a, aRefBypass.cSegment(0).b);

  let bestLength = -1;
  let bestBypass: PnsLineChain | null = null;

  for (let i = 0; i < vStartIdx.length; i++) {
    for (let j = 1; j < aCoupled.pointCount() - 1; j++) {
      const delta = Math.abs((vStartIdx[i] as number) - j);

      if (delta > 1) {
        const vs = aCoupled.cPoint(vStartIdx[i] as number);
        const bypass = PnsLineChain.fromPoints(
          dir.buildInitialTrace(vs, aCoupled.cPoint(j), dir.isDiagonal()),
        );

        const coupledLength = aPair.coupledLengthOfChains(aRef.points(), bypass.points());

        const newCoupled = aCoupled.clone();

        const si = vStartIdx[i] as number;
        const ei = j;

        if (si < ei) newCoupled.replace(si, ei, bypass);
        else newCoupled.replace(ei, si, bypass.reverse());

        if (coupledLength > bestLength && verifyDpBypass(aNode, aPair, aRefIsP, aRef, newCoupled)) {
          bestBypass = newCoupled;
          bestLength = coupledLength;
        }
      }
    }
  }

  return bestBypass;
}

/**
 * `checkDpColliding`: does this chain, worn as one lane of the pair, hit
 * anything in the node?
 *
 * **Dead upstream** — defined at `pns_optimizer.cpp:1260`, declared in no
 * header, called from nowhere in the tree. Ported because it was asked for by
 * name; see the module note.
 */
export function checkDpColliding(
  aNode: PnsNode,
  aPair: DiffPair,
  aIsP: boolean,
  aPath: PnsLineChain,
): boolean {
  const tmp = PnsLine.fromBase(aIsP ? aPair.pLine() : aPair.nLine(), aPath);

  return aNode.checkColliding(tmp) !== null;
}

/**
 * `OPTIMIZER::mergeDpStep`: try to bypass a `step`-wide span of one lane, and
 * keep it only if the pair stays coupled enough.
 *
 * Faithfully odd, all of it upstream's:
 *
 *  - **`n` starts at 1**, so the first segment of a lane is never a merge
 *    start — a diff pair's first segment is its gateway lead-in and moving it
 *    would unhook the pair from whatever it left;
 *  - **`n_segs` is `SegmentCount() - 1`**, one short of what the single-line
 *    `mergeStep` uses, so the last segment is out of reach at the far end too;
 *  - **`deltaUni` is computed before {@link coupledBypass} runs** and read only
 *    on the branch where that failed. On the taken branch it is a wasted
 *    `CoupledLength` over the whole lane;
 *  - **the tolerance is added, not subtracted**: `delta = new - old + budget`,
 *    so `delta >= 0` accepts a candidate that loses up to `budget` of coupled
 *    length. It is a permit, not a hurdle;
 *  - **`SetShape`'s swap flag is `!aTryP`**, which is what puts the rewritten
 *    chain back in the lane it was taken from.
 *
 * Returns `true` on the first span it accepts, having already written the pair.
 */
export function mergeDpStep(
  aNode: PnsNode,
  aPair: DiffPair,
  aTryP: boolean,
  aStep: number,
): boolean {
  let n = 1;

  const currentPath = PnsLineChain.fromPoints(aTryP ? aPair.cP() : aPair.cN());
  const coupledPath = PnsLineChain.fromPoints(aTryP ? aPair.cN() : aPair.cP());

  const nSegs = currentPath.segmentCount() - 1;

  const clenPre = aPair.coupledLengthOfChains(currentPath.points(), coupledPath.points());
  const budget = Math.trunc(clenPre / 10); // fixme: come up with something more intelligent here...

  while (n < nSegs - aStep) {
    const s1 = currentPath.cSegment(n);
    const s2 = currentPath.cSegment(n + aStep);

    const dir1 = Direction45.fromSeg(s1.a, s1.b);
    const dir2 = Direction45.fromSeg(s2.a, s2.b);

    if (dir1.isObtuse(dir2)) {
      const bypass = PnsLineChain.fromPoints(
        Direction45.of().buildInitialTrace(s1.a, s2.b, dir1.isDiagonal()),
      );

      // `SEG::Index()` is the segment's own index in the chain it was cut
      // from, which `CSegment( i )` sets to `i`.
      const newRef = currentPath.clone();
      newRef.replace(n, n + aStep, bypass);

      const deltaUni =
        aPair.coupledLengthOfChains(newRef.points(), coupledPath.points()) - clenPre + budget;

      const newCoup = coupledBypass(aNode, aPair, aTryP, newRef, bypass, coupledPath);

      if (newCoup) {
        const deltaCoupled =
          aPair.coupledLengthOfChains(newRef.points(), newCoup.points()) - clenPre + budget;

        if (deltaCoupled >= 0) {
          newRef.simplify2();
          newCoup.simplify2();

          aPair.setShape(newRef.points(), newCoup.points(), !aTryP);
          return true;
        }
      } else if (deltaUni >= 0 && verifyDpBypass(aNode, aPair, aTryP, newRef, coupledPath)) {
        newRef.simplify2();
        coupledPath.simplify2();

        aPair.setShape(newRef.points(), coupledPath.points(), !aTryP);
        return true;
      }
    }

    n++;
  }

  return false;
}

/**
 * `OPTIMIZER::mergeDpSegments`: widest span first, on both lanes, until
 * nothing is left to merge.
 *
 * The two steps are independent counters but share one decrement, so a lane
 * that keeps finding merges holds the *other* lane's step high as well. That is
 * upstream's, and it is not obviously wrong: a merge on one lane changes what
 * the other lane can usefully do.
 *
 * Termination does not rest on the decrement. A successful {@link mergeDpStep}
 * replaces a span of `step > 1` segments with a bypass of at most two, so the
 * lane strictly shortens and the `max_step` clamp at the top of every iteration
 * drives the counters down regardless.
 *
 * Note the dead iteration: the loop exits when **both** steps are `< 1`, but a
 * step is only *used* when it is `> 1`, so a pass with both steps at exactly 1
 * runs, does nothing, decrements, and only then exits.
 *
 * Returns `true` unconditionally, as upstream does.
 */
export function mergeDpSegments(aNode: PnsNode, aPair: DiffPair): boolean {
  let stepP = segmentCount(aPair.cP()) - 2;
  let stepN = segmentCount(aPair.cN()) - 2;

  for (;;) {
    const nSegsP = segmentCount(aPair.cP());
    const nSegsN = segmentCount(aPair.cN());

    const maxStepP = nSegsP - 2;
    const maxStepN = nSegsN - 2;

    if (stepP > maxStepP) stepP = maxStepP;

    if (stepN > maxStepN) stepN = maxStepN;

    if (stepP < 1 && stepN < 1) break;

    let foundAnythingP = false;
    let foundAnythingN = false;

    if (stepP > 1) foundAnythingP = mergeDpStep(aNode, aPair, true, stepP);

    if (stepN > 1) foundAnythingN = mergeDpStep(aNode, aPair, false, stepN);

    if (!foundAnythingN && !foundAnythingP) {
      stepN--;
      stepP--;
    }
  }

  return true;
}

/**
 * `OPTIMIZER::Optimize( DIFF_PAIR* aPair )`.
 *
 * One line upstream, and worth saying what is *not* in it: no effort flags, no
 * constraints, no cache, no `SMART_PADS`, no collinear or obtuse pass. The
 * whole diff-pair optimizer is {@link mergeDpSegments}, and it always reports
 * success whether or not it changed anything.
 */
export function optimizeDiffPair(aNode: PnsNode, aPair: DiffPair): boolean {
  return mergeDpSegments(aNode, aPair);
}
