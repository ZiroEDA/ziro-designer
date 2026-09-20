// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::MEANDER_PLACER_BASE` — what the single-track, differential-pair and
 * skew length tuners share. Counterpart: `pcbnew/router/pns_meander_placer_base.{h,cpp}`.
 *
 * `pns_meander.ts` drew a meander; this decides **how much** meander to add.
 * That question has exactly one answer here — {@link tuneLineLength} — and it
 * is the only part of length tuning where a one-line change silently produces
 * a board whose traces are the wrong length. Everything in this file exists to
 * serve it.
 *
 * ## The shrink loop, in one paragraph
 *
 * `MeanderedLine.meanderSegment` fills a baseline with as many *full-amplitude*
 * meanders as geometry allows, which almost always overshoots the target.
 * {@link tuneLineLength} then walks that line three times: once to find the
 * meander where the run should stop (everything past it is emptied, and the one
 * it stops on is converted to an `MT_SINGLE`/`MT_FINISH` end cap), once to
 * measure how much the survivors overshoot by, and once to shrink each survivor
 * by its share of the overshoot. The third pass re-divides the *remaining*
 * overshoot by the *remaining* meander count on every iteration, so a meander
 * that cannot shrink as far as asked hands its shortfall to the ones after it.
 *
 * Shrinking one meander to a length is {@link findAmplitudeForLength}: a
 * half-the-difference first guess, then a bisection on amplitude
 * ({@link findAmplitudeBinarySearch}) that stops within
 * {@link LENGTH_TARGET_TOLERANCE} — 20 IU, hard-coded, and *not*
 * `MeanderSettings.lengthTolerance`.
 *
 * ## Upstream oddities reproduced here
 *
 * Numbered continuing `pns_meander.ts`'s six. All are pinned by
 * `qa/unittests/pcbnew/pns_meander_placer_base.test.ts`.
 *
 *  7. {@link findAmplitudeForLength} validates its first guess against the
 *     **minimum-amplitude** shape rather than against the guess itself
 *     (`pns_meander_placer_base.cpp:189` resizes to `minAmp`, not to
 *     `initialGuess`). The fast path therefore fires on a property of a shape
 *     it is not about to return.
 *  8. {@link findAmplitudeBinarySearch} uses **0 as its failure code**, which
 *     is also a legal amplitude; `tuneLineLength` cannot tell the two apart and
 *     clamps both up to the minimum amplitude.
 *  9. Its two recursive halves **share the midpoint**, so the bisection is not
 *     a partition and the midpoint amplitude is measured twice.
 * 10. Its leaf tie-break is `abs(minError) < abs(maxError)`, so an exactly
 *     straddled target resolves to the **larger** amplitude — while the
 *     left-half-first recursion prefers the smaller subtree. The two
 *     preferences point opposite ways and that is upstream's.
 * 11. {@link PnsMeanderPlacerBase.initChainExtras} sets `m_chainExtrasValid`
 *     even when the aggregate query **failed**, which is not the same as never
 *     having asked: it switches {@link PnsMeanderPlacerBase.chainNarrowingOffset}
 *     from a flat 0 to `0 + unmeasured`.
 * 12. {@link PnsMeanderPlacerBase.clearance} falls back to the **track width**
 *     when the clearance constraint has no minimum, not to zero
 *     (`cpp:124`, the `wxCHECK_MSG` default).
 *
 * ## What this file does not have, and where it went
 *
 * `PLACEMENT_ALGO` is not ported and **no substitute is created here** — the
 * sibling port of `LINE_PLACER` owns that decision. `PnsMeanderPlacerBase` is a
 * standalone abstract class carrying the same method names.
 *
 * `PNS::ROUTER`, `ROUTER_IFACE` and `TOPOLOGY::AssembleTuningPath` /
 * `AssembleDiffPair` do not exist in this tree either; they arrive as
 * {@link MeanderPlacerHost}. `SHAPE_LINE_CHAIN::Split` is not on
 * {@link PnsLineChain}, so both overloads live here as {@link chainSplitAt} /
 * {@link chainSplitRange} — the meander placers are their only callers.
 *
 * The full porting spec, with `file:line` for every claim, is
 * `/var/tmp/ziro-router-specs/pns_meander_placer_impl.md`.
 */
import { PnsConstraintType } from './pns_collision.js';
import { PnsKind } from './pns_item.js';
import type { PnsLineChain } from './pns_line_item.js';
import { MeanderType, copyMeanderSettings, defaultMeanderSettings } from './pns_meander.js';
import { segDistanceToPoint, segNearestPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import type { MeanderPlacer, MeanderSettings, MeanderShape, MeanderedLine } from './pns_meander.js';
import type { NetHandle, PnsConstraint } from './pns_collision.js';
import type { PnsItem, PnsLinkedItem } from './pns_item.js';
import type { PnsItemSet } from './pns_itemset.js';
import type { PnsNode } from './pns_node.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsSolid } from './pns_solid.js';
import type { Seg } from './pns_line.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ---------------------------------------------------------------------------
// The world outside the router core (pns_router.h, pns_topology.h)

/**
 * The `ROUTER_IFACE` calls the placers make.
 *
 * Every one of these needs the live `BOARD` and the stackup — the length and
 * delay of a routed path depend on layer, width and the net class's tuning
 * profile — which is why they are injected rather than ported. `pcbnew`'s
 * `length_delay_calculation/` has no counterpart in this tree yet.
 */
export interface MeanderRouterIface {
  /** `CalculateRoutedPathLength( aItems, aStartPad, aEndPad, aNetClass )`. */
  calculateRoutedPathLength(
    aLine: PnsItemSet,
    aStartPad: PnsSolid | null,
    aEndPad: PnsSolid | null,
    aNetClass: string | null,
  ): number;

  /** `CalculateRoutedPathDelay( … )`. */
  calculateRoutedPathDelay(
    aLine: PnsItemSet,
    aStartPad: PnsSolid | null,
    aEndPad: PnsSolid | null,
    aNetClass: string | null,
  ): number;

  /** `CalculateLengthForDelay( aDelay, aWidth, aIsDiffPair, aDiffPairGap, aPNSLayer, aNetClass )`. */
  calculateLengthForDelay(
    aDelay: number,
    aWidth: number,
    aIsDiffPair: boolean,
    aDiffPairGap: number,
    aLayer: number,
    aNetClass: string | null,
  ): number;

  /** `CalculateDelayForShapeLineChain( aShape, aWidth, aIsDiffPair, aDiffPairGap, aPNSLayer, aNetClass )`. */
  calculateDelayForShapeLineChain(
    aShape: PnsLineChain,
    aWidth: number,
    aIsDiffPair: boolean,
    aDiffPairGap: number,
    aLayer: number,
    aNetClass: string | null,
  ): number;

  /**
   * `GetSignalAggregate( aFirst, aSecond, aLength, aDelay )`: the length and
   * delay of the *other* nets in the same signal chain.
   *
   * Upstream returns a bool and writes two out-params; null here is that false.
   * The distinction matters — see oddity 11.
   */
  getSignalAggregate(
    aFirst: NetHandle,
    aSecond: NetHandle,
  ): { length: number; delay: number } | null;

  /** `GetNetBoardLength( aNet )`: the whole net's length as the BOARD sees it. */
  getNetBoardLength(aNet: NetHandle): number;
}

/**
 * `RULE_RESOLVER::QueryConstraint`, with the nullable second item upstream
 * passes.
 *
 * `PnsBoardRuleResolver` satisfies this structurally; the `PnsRuleResolver`
 * interface in `pns_collision.ts` declares `itemB` non-null, which
 * {@link PnsMeanderPlacerBase.clearance} needs to be null.
 */
export interface MeanderClearanceResolver {
  queryConstraint(
    type: PnsConstraintType,
    itemA: PnsItem | null,
    itemB: PnsItem | null,
    layer: number,
  ): PnsConstraint | null;
}

/** What `AssembleTuningPath` produces: a path plus the two pads it ends on. */
export interface TuningPathResult {
  path: PnsItemSet;
  startPad: PnsSolid | null;
  endPad: PnsSolid | null;
}

/**
 * `PNS::ROUTER` plus the two `TOPOLOGY` assemblers, as the placers use them.
 *
 * `pns_topology.ts` ports `AssembleTrivialPath` and says in its own docblock
 * that `AssembleTuningPath` is not ported; `AssembleDiffPair` likewise. Both
 * are host calls here rather than a fork of that file.
 */
export interface MeanderPlacerHost {
  iface(): MeanderRouterIface;
  /** `ROUTER::GetWorld()`. */
  world(): PnsNode;
  /** `ROUTER::Sizes().DiffPairGap()`. */
  diffPairGap(): number;
  /** `ROUTER::GetCurrentLayer()`. */
  routerLayer(): number;
  /** `ROUTER::GetRuleResolver()`. */
  ruleResolver(): MeanderClearanceResolver | null;
  /** `ROUTER::CommitRouting( aNode )`. */
  commitRouting(aNode: PnsNode): void;
  /** `ROUTER::SetFailureReason( aReason )`. */
  setFailureReason(aReason: string): void;
  /** `BOARD_CONNECTED_ITEM::GetEffectiveNetClass()` of the picked-up item. */
  effectiveNetClass(aItem: PnsItem): string | null;
  /**
   * `TOPOLOGY::AssembleTuningPath( iface, aItem, &aStartPad, &aEndPad )`.
   *
   * Nullable because the differential-pair placers hand it
   * `PLine().GetLink( 0 )`, which upstream passes straight through without
   * checking — a pair whose lanes carry no links reaches the assembler as a
   * null pointer there and as a null here.
   */
  assembleTuningPath(aNode: PnsNode, aItem: PnsLinkedItem | null): TuningPathResult;
  /**
   * `TOPOLOGY::AssembleDiffPair( aItem, aPair )` — null is upstream's false.
   * Typed loosely (`unknown`) so this file need not depend on `pns_diff_pair`;
   * the DP and skew placers narrow it.
   */
  assembleDiffPair(aNode: PnsNode, aItem: PnsLinkedItem): unknown;
}

// ---------------------------------------------------------------------------
// Small kimath / pns_helpers pieces the placers need and this tree lacks

/**
 * `SEG::NearestPoint( const VECTOR2I& )` and `SEG::Distance( const VECTOR2I& )`
 * are kimath's — upstream has one `SEG` and every caller uses it. They are
 * re-exported here so this module's existing importers and the pcbnew barrel
 * keep working.
 */
export {
  segDistanceToPoint,
  segNearestPoint,
} from '@ziroeda/kimath/src/geometry/seg.js';

/** `SEG::Side( aP )` — the sign of the cross product, `+1`/`0`/`-1`. */
export function segSide(aSeg: Seg, aP: Vec2): number {
  const c = (aSeg.b.x - aSeg.a.x) * (aP.y - aSeg.a.y) - (aSeg.b.y - aSeg.a.y) * (aP.x - aSeg.a.x);

  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

/**
 * `PNS::HELPERS::GetSnappedStartPoint` (`pns_helpers.cpp:187-208`).
 *
 * A segment snaps to its nearest point; an arc snaps to whichever **endpoint**
 * is nearer — never to a point on the curve. That asymmetry is why a tuning
 * session started mid-arc begins at the arc's end.
 */
export function getSnappedStartPoint(aStartItem: PnsLinkedItem, aStartPoint: Vec2): Vec2 {
  if (aStartItem.kind() === PnsKind.SEGMENT_T) {
    return segNearestPoint((aStartItem as PnsSegment).seg(), aStartPoint);
  }

  const a0 = aStartItem.anchor(0);
  const a1 = aStartItem.anchor(1);

  const d0 = (a0.x - aStartPoint.x) ** 2 + (a0.y - aStartPoint.y) ** 2;
  const d1 = (a1.x - aStartPoint.x) ** 2 + (a1.y - aStartPoint.y) ** 2;

  return d0 <= d1 ? { ...a0 } : { ...a1 };
}

/**
 * `SHAPE_LINE_CHAIN::Split( aP, aExact )` (`shape_line_chain.cpp:1181-1234`),
 * **mutating** `aChain` and returning the index of `aP` in it, or -1.
 *
 * The `min_dist = 2` seed is a threshold, not an initialiser: only a segment
 * whose integer distance to `aP` is 0 or 1 is a candidate at all. And the
 * candidate scan keeps the *lowest-indexed* segment once an exact vertex match
 * exists, but the plain lowest distance otherwise — `min_dist` is updated on
 * every improvement while `ii` is only assigned under the `found_index` test,
 * so a later, closer segment can update `min_dist` without becoming `ii`.
 * Reproduced verbatim.
 *
 * The arc arm calls `splitArc`, which this tree ports now that
 * `SHAPE_ARC::ConstructFromStartEndCenter` is ported. It goes through
 * `PnsLineChain.insertPointOnArcSegment`, the single shared copy of that arm —
 * `chainSplit` in `pns_line_drag.ts`, this tree's other port of `Split`, calls
 * the same method.
 */
export function chainSplitAt(aChain: PnsLineChain, aP: Vec2, aExact = false): number {
  let ii = -1;
  let minDist = 2;

  const foundIndex = aChain.find(aP);

  if (foundIndex >= 0 && aExact) return foundIndex;

  for (let s = 0; s < aChain.segmentCount(); s++) {
    const seg = aChain.cSegment(s);
    const dist = segDistanceToPoint(seg, aP);

    // "make sure we are not producing a 'slightly concave' primitive. This
    // might happen if aP lies very close to one of already existing points."
    if (
      dist < minDist &&
      !(seg.a.x === aP.x && seg.a.y === aP.y) &&
      !(seg.b.x === aP.x && seg.b.y === aP.y)
    ) {
      minDist = dist;

      if (foundIndex < 0) ii = s;
      else if (s < foundIndex) ii = s;
    }
  }

  if (ii < 0) ii = foundIndex;

  if (ii >= 0) {
    const at = aChain.cPoint(ii);

    // Don't create duplicate points.
    if (at.x === aP.x && at.y === aP.y) return ii;

    const newIndex = ii + 1;

    if (aChain.isArcSegment(ii)) aChain.insertPointOnArcSegment(ii, aP);
    else aChain.insertPoint(newIndex, aP);

    return newIndex;
  }

  return -1;
}

/** The three parts {@link chainSplitRange} hands back. */
export interface ChainSplit {
  pre: PnsLineChain;
  mid: PnsLineChain;
  post: PnsLineChain;
}

/**
 * `SHAPE_LINE_CHAIN::Split( aStart, aEnd, aPre, aMid, aPost )`
 * (`shape_line_chain.cpp:2877-2902`).
 *
 * Both cut points are first snapped onto the chain with `NearestPoint`, so a
 * cursor position off the track still cuts it. The chain is **reversed** when
 * the end lands before the start, which is why dragging a tuning cursor
 * backwards along a track produces the same three parts as dragging forwards —
 * and why `pre`/`post` are not "before the cursor"/"after it" in the original
 * chain's own direction.
 */
export function chainSplitRange(aChain: PnsLineChain, aStart: Vec2, aEnd: Vec2): ChainSplit {
  const n = aChain.nearestPoint(aEnd, false);
  const m = aChain.nearestPoint(aStart, false);

  let l = aChain.clone();

  chainSplitAt(l, n, true);
  chainSplitAt(l, m, true);

  let iStart = l.find(m);
  let iEnd = l.find(n);

  if (iStart > iEnd) {
    l = l.reverse();
    iStart = l.find(m);
    iEnd = l.find(n);
  }

  return {
    pre: l.slice(0, iStart),
    post: l.slice(iEnd, -1),
    mid: l.slice(iStart, iEnd),
  };
}

// ---------------------------------------------------------------------------
// MEANDER_PLACER_BASE

/** `MEANDER_PLACER_BASE::TUNING_STATUS` (`pns_meander_placer_base.h:47-51`). */
export enum PnsTuningStatus {
  TOO_SHORT = 0,
  TOO_LONG = 1,
  TUNED = 2,
}

/** `LENGTH_TARGET_TOLERANCE` (`pns_meander_placer_base.cpp:31`), in IU. */
export const LENGTH_TARGET_TOLERANCE = 20;

/**
 * `findAmplitudeBinarySearch` (`cpp:136-175`).
 *
 * Bisects amplitude looking for one whose meander is within
 * {@link LENGTH_TARGET_TOLERANCE} of `aTargetLength`. **Mutates `aCopy`** — it
 * resizes it on every probe and leaves it at whatever the last probe set.
 *
 * Returns `0` for "not found", which is also a legal amplitude (oddity 8), and
 * the two recursive halves share their midpoint (oddity 9). The leaf comparison
 * is strict, so an exact straddle answers `aMaxAmp` (oddity 10).
 *
 * The `minAmp + 1 === maxAmp` interval would recurse on itself forever, since
 * the midpoint is then `minAmp` and the right half is the same interval again.
 * It is unreachable because the tolerance leaf fires first for any interval
 * that tight, and no guard is added: one would be an improvement, not a port.
 */
export function findAmplitudeBinarySearch(
  aCopy: MeanderShape,
  aTargetLength: number,
  aMinAmp: number,
  aMaxAmp: number,
): number {
  if (aMinAmp === aMaxAmp) return aMaxAmp;

  aCopy.resize(aMinAmp);
  const minLen = aCopy.currentLength();

  aCopy.resize(aMaxAmp);
  const maxLen = aCopy.currentLength();

  if (minLen > aTargetLength) return 0;

  if (maxLen < aTargetLength) return 0;

  const minError = minLen - aTargetLength;
  const maxError = maxLen - aTargetLength;

  if (
    Math.abs(minError) < LENGTH_TARGET_TOLERANCE ||
    Math.abs(maxError) < LENGTH_TARGET_TOLERANCE
  ) {
    return Math.abs(minError) < Math.abs(maxError) ? aMinAmp : aMaxAmp;
  }

  const mid = Math.trunc((aMinAmp + aMaxAmp) / 2);

  const left = findAmplitudeBinarySearch(aCopy, aTargetLength, aMinAmp, mid);

  if (left) return left;

  const right = findAmplitudeBinarySearch(aCopy, aTargetLength, mid, aMaxAmp);

  if (right) return right;

  return 0;
}

/**
 * `findAmplitudeForLength` (`cpp:178-198`): the amplitude at which `aShape`
 * measures `aTargetLength`, or 0 if there is none in `[aMinAmp, aMaxAmp]`.
 *
 * The work happens on a **copy**, so `aShape` is left untouched; the caller
 * resizes it afterwards. The copy is pinned to the original's baseline length
 * so the search does not trade amplitude against baseline.
 *
 * `initialGuess` is a half-the-difference step: a meander that is `d` too long
 * loses roughly `d/2` of amplitude, because the excess is spent going out
 * *and* coming back. The division truncates toward zero, so it rounds
 * differently for a shape that is too short than for one that is too long.
 *
 * **Oddity 7 lives at the `resize(aMinAmp)` below.** Upstream resizes the copy
 * to the *minimum* amplitude and then asks whether *that* shape is within
 * tolerance of the target — and returns `initialGuess`, a different amplitude,
 * when it is. The fast path is therefore gated on a property of a shape it does
 * not return. Writing `resize(initialGuess)` here would be the obvious fix and
 * would change which amplitude comes back for most inputs, so it is not made.
 */
export function findAmplitudeForLength(
  aShape: MeanderShape,
  aTargetLength: number,
  aMinAmp: number,
  aMaxAmp: number,
): number {
  const copy = aShape.clone();

  // Try to keep the same baseline length.
  copy.setTargetBaselineLength(aShape.baselineLength());

  const initialGuess =
    aShape.amplitude() - Math.trunc((aShape.currentLength() - aTargetLength) / 2);

  if (initialGuess >= aMinAmp && initialGuess <= aMaxAmp) {
    copy.resize(aMinAmp);

    if (Math.abs(copy.currentLength() - aTargetLength) < LENGTH_TARGET_TOLERANCE) {
      return initialGuess;
    }
  }

  // The length is non-trivial, use binary search.
  return findAmplitudeBinarySearch(copy, aTargetLength, aMinAmp, aMaxAmp);
}

/**
 * `tuneLineLength( aTuned, aElongation )` (`cpp:201-283`): make the meanders in
 * `aTuned` add exactly `aElongation` to the baseline they were laid on.
 *
 * `aElongation` is a *delta*, not a length: the caller passes
 * `target - currentLineLength`, so a negative value means the line is already
 * too long and no meander survives.
 *
 * ### Pass 1 — where the meandering stops
 *
 * Walks forward accumulating how much each meander *would* add if the run
 * ended there (`end`, a copy re-typed as an end cap). The first meander at
 * which the running total would overshoot becomes the end cap for real, and
 * everything after it is emptied. A run that overshoots even at its **minimum**
 * tunable length is emptied too, so the line comes out short rather than long.
 *
 * The outer test is `>` and the inner one `>=`, and the two accumulators are
 * updated **after** the re-typing — so an emptied meander contributes its
 * emptied length to the totals the next iteration compares against. All three
 * are load-bearing.
 *
 * Note that `MT_EMPTY` is *not* skipped in this pass (only `MT_CORNER` and
 * `MT_ARC` are) while passes 2 and 3 do skip it.
 *
 * ### Passes 2 and 3 — divide the overshoot
 *
 * Pass 2 totals what the survivors actually add. If they add *less* than asked
 * the function returns having shrunk nothing, and the caller reports
 * `TOO_SHORT`. Otherwise pass 3 gives each survivor an equal share of the
 * overshoot to give back — recomputing `lenReductionLeft / meandersLeft` every
 * iteration, so the share grows for later meanders whenever an earlier one
 * bottomed out at its minimum amplitude. That redistribution is the difference
 * between a tuned line and one that is short by whatever the first meander
 * could not give up.
 */
export function tuneLineLength(aTuned: MeanderedLine, aElongation: number): void {
  let maxElongation = 0;
  let minElongation = 0;
  let finished = false;

  for (const m of aTuned.meanders()) {
    if (m.type() === MeanderType.MT_CORNER || m.type() === MeanderType.MT_ARC) continue;

    const end = m.clone();

    const endType =
      m.type() === MeanderType.MT_START || m.type() === MeanderType.MT_SINGLE
        ? MeanderType.MT_SINGLE
        : MeanderType.MT_FINISH;

    end.setType(endType);
    end.recalculate();

    const maxEndElongation = end.currentLength() - end.baselineLength();

    // NOT PINNED: `>` versus `>=` differ only when the running total lands
    // *exactly* on `aElongation`, and no test sits on that boundary. For the
    // default settings and a 10 mm baseline the discriminating elongation is
    // 1 587 964 IU, where `>` opens a START/FINISH run and `>=` lays a single
    // meander instead. A mutant flipping this survives the suite.
    if (maxElongation + maxEndElongation > aElongation) {
      if (!finished) {
        m.setType(endType);
        m.recalculate();

        if (endType === MeanderType.MT_SINGLE) {
          // Check if we need to fit this meander.
          const endMinElongation = m.minTunableLength() - m.baselineLength();

          // NOT PINNED, same exact-equality boundary as the outer test above:
          // the discriminating elongation for the default fixture is 228 316 IU,
          // where `>=` empties the end cap and `>` keeps it. A mutant flipping
          // this survives the suite.
          if (minElongation + endMinElongation >= aElongation) m.makeEmpty();
        }

        finished = true;
      } else {
        m.makeEmpty();
      }
    }

    maxElongation += m.currentLength() - m.baselineLength();
    minElongation += m.minTunableLength() - m.baselineLength();
  }

  const tunable = (m: MeanderShape): boolean =>
    m.type() !== MeanderType.MT_CORNER &&
    m.type() !== MeanderType.MT_ARC &&
    m.type() !== MeanderType.MT_EMPTY;

  let remainingElongation = aElongation;
  let meanderCount = 0;

  for (const m of aTuned.meanders()) {
    if (tunable(m)) {
      remainingElongation -= m.currentLength() - m.baselineLength();
      meanderCount++;
    }
  }

  let lenReductionLeft = -remainingElongation;
  let meandersLeft = meanderCount;

  if (lenReductionLeft < 0 || !meandersLeft) return;

  for (const m of aTuned.meanders()) {
    if (!tunable(m)) continue;

    const lenReductionHere = Math.trunc(lenReductionLeft / meandersLeft);
    const initialLen = m.currentLength();
    const minAmpl = m.minAmplitude();

    let amp = findAmplitudeForLength(m, initialLen - lenReductionHere, minAmpl, m.amplitude());

    // NOT PINNED, and it may be unreachable: a sweep of ~1 700 (baseline
    // length x max amplitude x spacing x elongation) combinations produced no
    // case where the search returns below the minimum amplitude. Pass 1 has
    // already emptied every meander whose *minimum* elongation overshoots, so
    // by the time pass 3 runs the per-meander target is above that minimum.
    // Kept because it is upstream's, and because it is the only thing standing
    // between the search's 0-means-failure return and a meander of no height.
    if (amp < minAmpl) amp = minAmpl;

    m.setTargetBaselineLength(m.baselineLength());
    m.resize(amp);

    lenReductionLeft -= initialLen - m.currentLength();
    meandersLeft--;

    if (!meandersLeft) break;
  }
}

/**
 * `MEANDER_PLACER_BASE`: the state and behaviour the three tuners share.
 *
 * Implements {@link MeanderPlacer}, so a subclass can be handed straight to
 * {@link MeanderedLine} — which is exactly what `doMove` does.
 */
export abstract class PnsMeanderPlacerBase implements MeanderPlacer {
  protected mHost: MeanderPlacerHost;

  /** Original path length/delay captured at `Start()`. */
  protected mBaselineLength = 0;
  protected mBaselineDelay = 0;

  /** Aggregate length/delay of other nets in the same chain, cached at `Start()`. */
  protected mChainExtrasLength = 0;
  protected mChainExtrasDelay = 0;
  protected mChainExtrasValid = false;

  /** World to search colliding items. Null until `Start()`. */
  protected mWorld: PnsNode | null = null;

  /** Width of the meandered trace(s). */
  protected mCurrentWidth = 0;

  protected mSettings: MeanderSettings = defaultMeanderSettings();

  protected mCurrentEnd: Vec2 = { x: 0, y: 0 };

  protected mStartPadP: PnsSolid | null = null;
  protected mEndPadP: PnsSolid | null = null;
  protected mStartPadN: PnsSolid | null = null;
  protected mEndPadN: PnsSolid | null = null;

  constructor(aHost: MeanderPlacerHost) {
    this.mHost = aHost;
  }

  // -- PLACEMENT_ALGO / MEANDER_PLACER_BASE pure virtuals ------------------

  abstract start(aP: Vec2, aStartItem: PnsItem | null): boolean;
  abstract move(aP: Vec2, aEndItem: PnsItem | null): boolean;
  abstract fixRoute(aP: Vec2, aEndItem: PnsItem | null, aForceFinish?: boolean): boolean;
  abstract commitPlacement(): boolean;
  abstract abortPlacement(): boolean;
  abstract hasPlacedAnything(): boolean;
  abstract currentNode(aLoopsRemoved?: boolean): PnsNode | null;
  abstract traces(): PnsItemSet;
  abstract tunedPath(): PnsItemSet;
  abstract currentStart(): Vec2;
  abstract currentNets(): NetHandle[];
  abstract currentLayer(): number;

  /** `TuningLengthResult()`: the resultant length or skew of the tuned traces. */
  abstract tuningLengthResult(): number;

  /** `TuningStatus()`. */
  abstract tuningStatus(): PnsTuningStatus;

  /** `TuningDelayResult()` — **0** in the base class (`h:60`). */
  tuningDelayResult(): number {
    return 0;
  }

  /** `CurrentEnd()`. */
  currentEnd(): Vec2 {
    return this.mCurrentEnd;
  }

  // -- concrete base behaviour --------------------------------------------

  /** `HasBaseline()` (`h:63`). */
  hasBaseline(): boolean {
    return this.mBaselineLength !== 0 || this.mBaselineDelay !== 0;
  }

  /** `TuningLengthDelta()` (`h:65`). */
  tuningLengthDelta(): number {
    return this.tuningLengthResult() - this.mBaselineLength;
  }

  /** `TuningDelayDelta()` (`h:66`). */
  tuningDelayDelta(): number {
    return this.tuningDelayResult() - this.mBaselineDelay;
  }

  /**
   * `initChainExtras()` (`cpp:49-73`).
   *
   * A single-net placer asks for the aggregate of `(net, net)` — `second`
   * falls back to `first` when there is only one net, it is not omitted.
   *
   * **Oddity 11**: `mChainExtrasValid` is set whether or not the query
   * succeeded. Only an *empty net list* leaves it false.
   */
  protected initChainExtras(): void {
    this.mChainExtrasLength = 0;
    this.mChainExtrasDelay = 0;
    this.mChainExtrasValid = false;

    const startNets = this.currentNets();

    if (startNets.length === 0) return;

    const first = startNets[0] as NetHandle;
    const second = (startNets.length >= 2 ? startNets[1] : startNets[0]) as NetHandle;

    const extra = this.mHost.iface().getSignalAggregate(first, second);

    if (extra) {
      this.mChainExtrasLength = extra.length;
      this.mChainExtrasDelay = extra.delay;
    }

    this.mChainExtrasValid = true;
  }

  /**
   * `chainNarrowingOffset()` (`cpp:76-92`): the length the *chain* already
   * absorbs, which the meander must therefore not add.
   *
   * Two parts: the sibling nets' aggregate, and the "unmeasured" stub — the
   * part of the tuned net that the BOARD counts but the PNS baseline did not,
   * clamped at zero so a baseline longer than the board length contributes
   * nothing rather than a negative.
   */
  protected chainNarrowingOffset(): number {
    if (!this.mChainExtrasValid) return 0;

    const nets = this.currentNets();

    let tunedNetBoardLen = 0;

    if (nets.length > 0) {
      tunedNetBoardLen = this.mHost.iface().getNetBoardLength(nets[0] as NetHandle);
    }

    const unmeasured = Math.max(0, tunedNetBoardLen - this.mBaselineLength);

    return this.mChainExtrasLength + unmeasured;
  }

  /**
   * `AmplitudeStep( aSign )` (`cpp:95-101`).
   *
   * `aSign` multiplies the step rather than being clamped to ±1, and the result
   * is floored at the *minimum* amplitude — never at zero.
   */
  amplitudeStep(aSign: number): void {
    let a = this.mSettings.maxAmplitude + aSign * this.mSettings.step;
    a = Math.max(a, this.mSettings.minAmplitude);

    this.mSettings.maxAmplitude = a;
  }

  /**
   * `SpacingStep( aSign )` (`cpp:104-109`): floored at one track width plus one
   * clearance, the closest two meander limbs may legally run.
   */
  spacingStep(aSign: number): void {
    let s = this.mSettings.spacing + aSign * this.mSettings.step;
    s = Math.max(s, this.mCurrentWidth + this.clearance());

    this.mSettings.spacing = s;
  }

  /**
   * `Clearance()` (`cpp:112-127`).
   *
   * Upstream's assumption, verbatim: *"All tracks are part of the same net
   * class. It shouldn't matter which track we pick."* — so the constraint is
   * queried for `Traces().CItems().front()` and nothing else.
   *
   * **Oddity 12**: the `wxCHECK_MSG` fallback when the constraint has no
   * minimum is `m_currentWidth`, not 0. A missing resolver, an item-less trace
   * set and an answerless query all take that same fallback here.
   */
  clearance(): number {
    const items = this.traces().citems();
    const itemToCheck = items[0];

    if (!itemToCheck) return this.mCurrentWidth;

    const resolver = this.mHost.ruleResolver();

    const constraint = resolver
      ? resolver.queryConstraint(
          PnsConstraintType.CT_CLEARANCE,
          itemToCheck,
          null,
          this.currentLayer(),
        )
      : null;

    if (!constraint || constraint.value.min === undefined) return this.mCurrentWidth;

    return constraint.value.min;
  }

  /** `MeanderSettings()` (`cpp:286-289`). */
  meanderSettings(): MeanderSettings {
    return this.mSettings;
  }

  /**
   * `UpdateSettings( aSettings )` (`cpp:130-133`).
   *
   * Upstream assigns the struct, which copies it. `MeanderedLine.meanderSegment`
   * relies on that: it reads the settings, flips `initialSide` on the copy and
   * writes it back, and would otherwise be mutating the object it just read.
   */
  updateSettings(aSettings: MeanderSettings): void {
    this.mSettings = copyMeanderSettings(aSettings);
  }

  /** `CheckFit()` — **false** in the base class (`h:118-121`). */
  checkFit(_aShape: MeanderShape): boolean {
    return false;
  }

  /** `lineLength( aLine, aStartPad, aEndPad )` (`cpp:292-299`). */
  protected lineLength(
    aLine: PnsItemSet,
    aStartPad: PnsSolid | null,
    aEndPad: PnsSolid | null,
  ): number {
    if (aLine.empty()) return 0;

    return this.mHost
      .iface()
      .calculateRoutedPathLength(aLine, aStartPad, aEndPad, this.mSettings.netClass);
  }

  /** `lineDelay( aLine, aStartPad, aEndPad )` (`cpp:302-309`). */
  protected lineDelay(
    aLine: PnsItemSet,
    aStartPad: PnsSolid | null,
    aEndPad: PnsSolid | null,
  ): number {
    if (aLine.empty()) return 0;

    return this.mHost
      .iface()
      .calculateRoutedPathDelay(aLine, aStartPad, aEndPad, this.mSettings.netClass);
  }
}
