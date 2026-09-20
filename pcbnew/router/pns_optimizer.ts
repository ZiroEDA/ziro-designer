// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tidying a route after it has been found.
 * Counterparts: `COST_ESTIMATOR::CornerCost`, `OPTIMIZER::mergeColinear`,
 * `mergeObtuse`, `mergeStep` and `mergeFull` (pcbnew/router/pns_optimizer.cpp).
 *
 * Walkaround produces a route that is *correct* and rarely one anybody would
 * draw: it hugs every hull it passes, so three obstacles come back as twenty
 * points, most of them tracing octagon corners that no longer matter once the
 * path is clear of them. This is the pass that takes those out.
 *
 * ## Cost is corners, not length
 *
 * The thing being minimised is not how long the track is. It is a tally over
 * consecutive segment pairs — a straight join costs 5, an obtuse bend 10, a
 * right angle 30, an acute one 50 — so the optimiser will happily accept a
 * slightly *longer* route that turns less. That is the right objective for a
 * board: a track with fewer corners is easier to follow, etches more
 * predictably, and is what a person would have drawn.
 *
 * ## Every candidate is re-checked against the obstacles
 *
 * Each pass proposes a shortcut and then asks whether it collides before
 * keeping it. Skipping that would make the optimiser undo exactly the detours
 * walkaround just went to the trouble of finding — the shortest path between
 * two points on either side of a pad goes straight through the pad.
 *
 * The caller supplies the collision test, so this file knows nothing about
 * boards or hulls, and the optimiser can be run against whatever notion of
 * "blocked" the caller has.
 */
import { AngleType, Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import { intersectLines } from './pns_line.js';
import type { Chain } from './pns_chain.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

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
 * Not ported: `SMART_PADS` (rerouting pad exits, which needs the joint model)
 * and `FANOUT_CLEANUP`. Both need to know what a route is connected to, which
 * is `PNS::NODE`'s business.
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
