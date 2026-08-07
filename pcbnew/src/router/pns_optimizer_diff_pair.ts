// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OPTIMIZER::Optimize( DIFF_PAIR* )` — tidying a routed differential pair.
 * Counterparts: `pcbnew/router/pns_optimizer.cpp` (`findCoupledVertices`,
 * `verifyDpBypass`, `coupledBypass`, `checkDpColliding`, `mergeDpStep`,
 * `mergeDpSegments`, `Optimize( DIFF_PAIR* )`, lines 1157-1374).
 *
 * ## What this pass optimises, and why it is not the single-line one
 *
 * `pns_optimizer.ts` minimises **corners**: it will accept a longer route that
 * turns less. That objective is wrong for a pair. What matters here is
 * *coupling* — how much of the two lanes runs side by side at the intended gap
 * — and a shortcut that straightens one lane while the other keeps its detour
 * has made the pair worse even though it removed a corner. So the whole pass is
 * built around `DIFF_PAIR::CoupledLength` instead, and every candidate is scored
 * as a delta against the coupled length the pair already had, with a tolerance
 * of one tenth of it (`budget`, and upstream's *"fixme: come up with something
 * more intelligent here..."* stands).
 *
 * There are two ways a merge can pay for itself, and the order they are tried
 * in is the interesting part. First the pass looks for a matching bypass on the
 * *other* lane ({@link coupledBypass}), so both lanes shorten together and the
 * coupling survives. Only if no such bypass exists does it consider shortening
 * one lane alone, and then only if the coupled length it loses fits in the
 * budget. A found-but-unprofitable coupled bypass does **not** fall back to the
 * one-sided arm — upstream's `else if` — so the pass would rather leave a
 * corner in than break the pair up.
 *
 * ## Where it lives
 *
 * Not in `pns_optimizer.ts`, which is deliberately pure — chains in, chains
 * out, one collision callback, no world. These passes call
 * `NODE::CheckColliding` twice per candidate and build `LINE`s off the pair's
 * cached lanes, so they have the shape of `pns_smart_pads.ts` rather than of
 * the merge passes. Not in `pns_smart_pads.ts` either: that file is about pad
 * exits. A third module, and the pure optimizer stays callable with no world.
 *
 * ## Blocked by ZiroEDA issue #484, and worked around here
 *
 * `verifyDpBypass` opens by colliding the two candidate lanes against each
 * other. `PnsItem.shape()` returns `null` for a `PnsLine`, so `collideSimple`
 * bails at its `if (!shapeI || !shapeH)` and *line-versus-line* `collide()` is
 * unconditionally `false` in this port — `pns_shove.ts` has four calls with the
 * same silent hole. Fixing that is #484's job, not this change's, so
 * {@link linesCollide} does locally what upstream's chain-versus-chain
 * collision does: every segment of one lane against every segment of the other,
 * as `SEGMENT`s cut from the lines, which *do* carry a shape. The effective
 * clearance is the same quantity either way — upstream folds half of each
 * `LINE`'s width into the clearance and collides bare chains, while a
 * `SHAPE_SEGMENT` carries that width in its stadium radius.
 *
 * ## Not ported from the same file, and why
 *
 * `Tighten`, `tightenSegment` and `shovedArea` (`pns_optimizer.cpp:1378-1539`)
 * are dead upstream: `Tighten` has no declaration in any header and no caller
 * anywhere in the tree, and the other two exist only to serve it. They are the
 * last thing in the file and they are left there. {@link checkDpColliding} is
 * in exactly the same position — defined, declared nowhere, called nowhere —
 * and *is* ported, because the port of this file was asked for by name; it is
 * labelled dead at its site rather than quietly dropped.
 */
import { PnsLine, PnsLineChain } from './pns_line_item.js';
import { PnsSegment } from './pns_segment.js';
import { segApproxParallel, segLineProject } from './pns_seg_ops.js';
import { segmentCount } from './pns_line.js';
import { Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import type { DiffPair } from './pns_diff_pair.js';
import type { PnsNode } from './pns_node.js';
import type { Seg } from './pns_line.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * The `LINE::Collide( LINE* )` that issue #484 makes unreachable — see the
 * module note.
 *
 * Upstream's `LINE` collides as a `SHAPE_LINE_CHAIN`, which is segment-by-
 * segment underneath. Cutting the two lines into `SEGMENT`s and colliding those
 * pairwise computes the same thing through machinery this port does have.
 * `false` for a line with no segments, as an empty chain collides with nothing.
 */
export function linesCollide(aA: PnsLine, aB: PnsLine, aNode: PnsNode, aLayer: number): boolean {
  const chainA = aA.cLine();
  const chainB = aB.cLine();

  for (let i = 0; i < chainA.segmentCount(); i++) {
    const segA = PnsSegment.fromParentLine(aA, chainA.cSegment(i));

    for (let j = 0; j < chainB.segmentCount(); j++) {
      const segB = PnsSegment.fromParentLine(aB, chainB.cSegment(j));

      if (segA.collide(segB, aNode, aLayer)) return true;
    }
  }

  return false;
}

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
 * The first of the three tests is the one issue #484 blocks; see the module
 * note and {@link linesCollide}.
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

  if (linesCollide(refLine, coupledLine, aNode, refLine.layer())) return false;

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
