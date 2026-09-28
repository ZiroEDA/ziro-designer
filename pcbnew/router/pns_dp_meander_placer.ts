// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::DP_MEANDER_PLACER` — differential-pair length tuning. Counterpart:
 * `pcbnew/router/pns_dp_meander_placer.{h,cpp}`.
 *
 * A pair is tuned as *one* meandered line, not two: the meanders are laid on a
 * synthetic **baseline** running down the middle of the two lanes, and
 * `MEANDERED_LINE` in dual mode emits both lanes from it at once, offset by
 * half the gap plus half the width to either side. That is why this class
 * derives from `MEANDER_PLACER_BASE` rather than from the single-track placer:
 * only the tuning arithmetic is shared, the geometry is not.
 *
 * ## The three pieces
 *
 * 1. **Coupled segments.** `DIFF_PAIR::CoupledSegmentPairs` finds the stretches
 *    where P and N actually run parallel at the right distance. Only those get
 *    meanders; a pair that is uncoupled where the cursor is produces no result
 *    at all (an early `return false`, with the original lanes kept so the track
 *    does not vanish from the canvas).
 * 2. **The corner walk.** Between two coupled stretches the two lanes have to
 *    be copied across verbatim, in step, pairing arc with arc — which is what
 *    {@link PnsDpMeanderPlacer.move}'s `addCornersUntilIndex` does. It keeps
 *    one cursor per lane and advances them independently.
 * 3. **Tuning**, which is `MEANDER_PLACER_BASE::tuneLineLength` and identical
 *    to the single-track case, against a length that is the **longer** of the
 *    two lanes.
 *
 * ## Upstream oddities reproduced here
 *
 * Numbered continuing `pns_meander.ts` (1-6), `pns_meander_placer_base.ts`
 * (7-12) and `pns_meander_placer.ts` (13-15).
 *
 * 16. {@link PnsDpMeanderPlacer.checkFit} uses `w + w * 3` as its clearance —
 *     four track widths — and **ignores `m_settings.m_spacing` entirely**,
 *     unlike the single-track placer's `w + m_spacing`. So the spacing control
 *     does nothing to how densely a tuned pair meanders.
 * 17. `addCornersUntilIndex` reads `p_ok`/`n_ok` at the bottom of its loop
 *     *after* an inner arc-hunt may have reassigned them, so which cursor
 *     advances is decided by the inner walk's last test rather than the outer
 *     one's.
 * 18. The two early-exit arms disagree: the empty-tuned-section arm forces
 *     `TOO_SHORT`, the uncoupled arm runs the normal status test. Neither
 *     writes `m_lastDelay`.
 * 19. `HasPlacedAnything()` asks the **origin** pair, so it is true from
 *     `Start()` onwards — before anything has been placed.
 * 20. `TunedPath()` returns N's items before P's, the reverse of the order they
 *     were assembled and of the order `Traces()` uses.
 *
 * The full porting spec is `/var/tmp/ziro-router-specs/pns_meander_placer_impl.md`.
 */
import { DiffPair } from './pns_diff_pair.js';
import {
  MEANDER_DELAY_UNCONSTRAINED,
  MEANDER_LENGTH_UNCONSTRAINED,
  MeanderType,
  MeanderedLine,
  minOptMaxMax,
  minOptMaxMin,
  minOptMaxOpt,
} from './pns_meander.js';
import { PnsItemSet } from './pns_itemset.js';
import { PnsKind } from './pns_item.js';
import { PnsLine, PnsLineChain } from './pns_line_item.js';
import {
  PnsMeanderPlacerBase,
  PnsTuningStatus,
  chainSplitRange,
  getSnappedStartPoint,
  segSide,
  tuneLineLength,
} from './pns_meander_placer_base.js';
import type { CoupledSegments } from './pns_diff_pair.js';
import type { MeanderPlacerHost } from './pns_meander_placer_base.js';
import type { MeanderShape } from './pns_meander.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsItem, PnsLinkedItem } from './pns_item.js';
import type { PnsNode } from './pns_node.js';
import type { Seg } from './pns_line.js';
import type { ShapeArc } from './pns_arc.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * `( a + b ) / 2` on integers, truncating **the sum** toward zero — which
 * rounds a negative midpoint the opposite way to a floor. Upstream's
 * `VECTOR2I` arithmetic; the baseline a pair meanders about is built out of it.
 */
const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: Math.trunc((a.x + b.x) / 2),
  y: Math.trunc((a.y + b.y) / 2),
});

/** What `getItem` reports about one shape of one lane. */
interface DpItemAt {
  arc: ShapeArc | null;
  startPt: Vec2;
  endPt: Vec2;
}

/** `DP_MEANDER_PLACER`: differential pair length-matching/meandering tool. */
export class PnsDpMeanderPlacer extends PnsMeanderPlacerBase {
  /** Current routing start point (end of tail, beginning of head). */
  private mCurrentStart: Vec2 = { x: 0, y: 0 };

  /** Current world state. */
  private mCurrentNode: PnsNode | null = null;

  private mOriginPair = new DiffPair();

  private mCurrentTraceP = new PnsLine();
  private mCurrentTraceN = new PnsLine();
  private mTunedPathP = new PnsItemSet();
  private mTunedPathN = new PnsItemSet();

  private mFinalShapeP = new PnsLineChain();
  private mFinalShapeN = new PnsLineChain();
  private mResult: MeanderedLine;
  private mInitialSegment: PnsLinkedItem | null = null;

  private mLastLength = 0;
  private mLastDelay = 0;
  private mPadToDieLengthP = 0;
  private mPadToDieLengthN = 0;
  private mPadToDieDelayP = 0;
  private mPadToDieDelayN = 0;
  private mLastStatus: PnsTuningStatus = PnsTuningStatus.TOO_SHORT;

  private mNetClass: string | null = null;

  constructor(aHost: MeanderPlacerHost) {
    super(aHost);
    this.mResult = new MeanderedLine(this, true);
  }

  /** `Trace()`: the P lane only. */
  trace(): PnsLine {
    return this.mCurrentTraceP;
  }

  /** `GetOriginPair()`. */
  getOriginPair(): DiffPair {
    return this.mOriginPair;
  }

  currentNode(_aLoopsRemoved = false): PnsNode | null {
    if (!this.mCurrentNode) return this.mWorld;

    return this.mCurrentNode;
  }

  /** `Start( aP, aStartItem )` (`cpp:88-176`). */
  start(aP: Vec2, aStartItem: PnsItem | null): boolean {
    if (!aStartItem || !aStartItem.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
      this.mHost.setFailureReason('Please select a track whose length you want to tune.');
      return false;
    }

    this.mInitialSegment = aStartItem as PnsLinkedItem;
    this.mCurrentNode = null;
    this.mCurrentStart = getSnappedStartPoint(this.mInitialSegment, aP);

    const world = this.mHost.world().branch();
    this.mWorld = world;

    const pair = this.mHost.assembleDiffPair(world, this.mInitialSegment);

    if (!(pair instanceof DiffPair)) {
      this.mHost.setFailureReason(
        'Unable to find complementary differential pair net for length tuning. Make sure the ' +
          'names of the nets belonging to a differential pair end with either _N/_P or +/-.',
      );

      return false;
    }

    this.mOriginPair = pair;

    if (this.mOriginPair.gap() < 0) this.mOriginPair.setGap(this.mHost.diffPairGap());

    if (!this.mOriginPair.pLine().segmentCount() || !this.mOriginPair.nLine().segmentCount()) {
      return false;
    }

    // `PLine().GetLink( 0 )`: upstream dereferences nothing and checks nothing,
    // so a lane with no links reaches the assembler as a null.
    const linkP = this.mOriginPair.pLine().getLink(0) ?? null;
    const linkN = this.mOriginPair.nLine().getLink(0) ?? null;

    const tuningP = this.mHost.assembleTuningPath(world, linkP);

    this.mTunedPathP = tuningP.path;
    this.mStartPadP = tuningP.startPad;
    this.mEndPadP = tuningP.endPad;

    this.mPadToDieLengthP = 0;
    this.mPadToDieDelayP = 0;

    if (this.mStartPadP) {
      this.mPadToDieLengthP += this.mStartPadP.getPadToDie();
      this.mPadToDieDelayP += this.mStartPadP.getPadToDieDelay();
    }

    if (this.mEndPadP) {
      this.mPadToDieLengthP += this.mEndPadP.getPadToDie();
      this.mPadToDieDelayP += this.mEndPadP.getPadToDieDelay();
    }

    const tuningN = this.mHost.assembleTuningPath(world, linkN);

    this.mTunedPathN = tuningN.path;
    this.mStartPadN = tuningN.startPad;
    this.mEndPadN = tuningN.endPad;

    this.mPadToDieLengthN = 0;
    this.mPadToDieDelayN = 0;

    if (this.mStartPadN) {
      this.mPadToDieLengthN += this.mStartPadN.getPadToDie();
      this.mPadToDieDelayN += this.mStartPadN.getPadToDieDelay();
    }

    if (this.mEndPadN) {
      this.mPadToDieLengthN += this.mEndPadN.getPadToDie();
      this.mPadToDieDelayN += this.mEndPadN.getPadToDieDelay();
    }

    world.removeLine(this.mOriginPair.pLine());
    world.removeLine(this.mOriginPair.nLine());

    this.mCurrentWidth = this.mOriginPair.width();

    this.mNetClass = this.mHost.effectiveNetClass(aStartItem);

    this.mBaselineLength = this.origPathLength();
    this.mBaselineDelay = this.mSettings.isTimeDomain ? this.origPathDelay() : 0;

    this.initChainExtras();

    this.calculateTimeDomainTargets();

    return true;
  }

  /**
   * `origPathLength()` (`cpp:186-191`): the **longer** lane, pad-to-die
   * included. Not the average, and — unlike the single-track placer — with no
   * `m_signalExtraLength` term.
   */
  private origPathLength(): number {
    const totalP =
      this.mPadToDieLengthP + this.lineLength(this.mTunedPathP, this.mStartPadP, this.mEndPadP);
    const totalN =
      this.mPadToDieLengthN + this.lineLength(this.mTunedPathN, this.mStartPadN, this.mEndPadN);

    return Math.max(totalP, totalN);
  }

  /** `origPathDelay()` (`cpp:194-199`). */
  private origPathDelay(): number {
    const totalP =
      this.mPadToDieDelayP + this.lineDelay(this.mTunedPathP, this.mStartPadP, this.mEndPadP);
    const totalN =
      this.mPadToDieDelayN + this.lineDelay(this.mTunedPathN, this.mStartPadN, this.mEndPadN);

    return Math.max(totalP, totalN);
  }

  /**
   * `baselineSegment( aCoupledSegs )` (`cpp:202-208`): the segment the meanders
   * are actually laid on — the midline of one coupled stretch.
   */
  private baselineSegment(aCoupledSegs: CoupledSegments): Seg {
    return {
      a: midpoint(aCoupledSegs.coupledP.a, aCoupledSegs.coupledN.a),
      b: midpoint(aCoupledSegs.coupledP.b, aCoupledSegs.coupledN.b),
    };
  }

  /**
   * `pairOrientation( aPair )` (`cpp:211-218`): which side of P the pair's
   * midpoint falls on, i.e. whether N is left or right of P. It decides the
   * sign of the baseline offset, and so which lane comes out of the meander
   * generator as lane 0.
   */
  private pairOrientation(aPair: CoupledSegments): boolean {
    const midp = midpoint(aPair.coupledP.a, aPair.coupledN.a);

    return segSide(aPair.coupledP, midp) > 0;
  }

  /**
   * `calculateTimeDomainTargets()` (`cpp:594-641`).
   *
   * The same conversion as the single-track placer's, with the pair's width and
   * gap and the diff-pair flag set — see that one for the three details.
   */
  private calculateTimeDomainTargets(): void {
    if (!this.mSettings.isTimeDomain) return;

    const iface = this.mHost.iface();

    const curDelayChain = this.origPathDelay();
    const curDelayPair = curDelayChain - this.mSettings.signalExtraDelay; // subtract other nets

    const useSignalTarget =
      minOptMaxOpt(this.mSettings.targetSignalLengthDelay) !== MEANDER_DELAY_UNCONSTRAINED;

    const targetDelaySet = useSignalTarget
      ? this.mSettings.targetSignalLengthDelay
      : this.mSettings.targetLengthDelay;

    let desiredDelayMin = minOptMaxMin(targetDelaySet);
    let desiredDelayOpt = minOptMaxOpt(targetDelaySet);
    let desiredDelayMax = minOptMaxMax(targetDelaySet);

    if (useSignalTarget) {
      desiredDelayMin = Math.max(0, desiredDelayMin - this.mSettings.signalExtraDelay);
      desiredDelayOpt = Math.max(0, desiredDelayOpt - this.mSettings.signalExtraDelay);
      desiredDelayMax = Math.max(
        desiredDelayOpt,
        desiredDelayMax - this.mSettings.signalExtraDelay,
      );
    }

    const curDelay = useSignalTarget ? curDelayPair : curDelayChain;

    const delayDifferenceOpt = desiredDelayOpt - curDelay;

    const curLength = this.origPathLength();
    const width = this.getOriginPair().width();
    const gap = this.getOriginPair().gap();
    const layer = this.mHost.routerLayer();

    const lengthDiffMin = iface.calculateLengthForDelay(
      desiredDelayOpt - desiredDelayMin,
      width,
      true,
      gap,
      layer,
      this.mNetClass,
    );
    let lengthDiffOpt = iface.calculateLengthForDelay(
      Math.abs(delayDifferenceOpt),
      width,
      true,
      gap,
      layer,
      this.mNetClass,
    );
    const lengthDiffMax = iface.calculateLengthForDelay(
      desiredDelayMax - desiredDelayOpt,
      width,
      true,
      gap,
      layer,
      this.mNetClass,
    );

    lengthDiffOpt = delayDifferenceOpt > 0 ? lengthDiffOpt : -lengthDiffOpt;

    this.mSettings.targetLength.min = curLength + lengthDiffOpt - lengthDiffMin;
    this.mSettings.targetLength.opt = curLength + lengthDiffOpt;
    this.mSettings.targetLength.max = curLength + lengthDiffOpt + lengthDiffMax;
  }

  /**
   * `Move( aP, aEndItem )` (`cpp:221-576`) — everything, in one method, as
   * upstream writes it.
   *
   * The chain-budget preamble is a **verbatim twin** of
   * `MEANDER_PLACER::Move`'s and is duplicated here rather than hoisted into
   * the base class, because upstream duplicates it and the two copies could
   * legitimately diverge (this class derives from the base, not from the
   * single-track placer).
   */
  move(aP: Vec2, _aEndItem: PnsItem | null): boolean {
    const extraDelay = this.mChainExtrasValid ? this.mChainExtrasDelay : 0;

    this.mSettings.signalExtraDelay = extraDelay;

    if (minOptMaxOpt(this.mSettings.targetSignalLength) !== MEANDER_LENGTH_UNCONSTRAINED) {
      const otherLen = this.chainNarrowingOffset();

      const budgetMin = Math.max(0, minOptMaxMin(this.mSettings.targetSignalLength) - otherLen);
      const budgetOpt = Math.max(0, minOptMaxOpt(this.mSettings.targetSignalLength) - otherLen);
      const budgetMax = Math.max(
        budgetOpt,
        minOptMaxMax(this.mSettings.targetSignalLength) - otherLen,
      );

      if (minOptMaxOpt(this.mSettings.targetLength) === MEANDER_LENGTH_UNCONSTRAINED) {
        this.mSettings.targetLength.min = budgetMin;
        this.mSettings.targetLength.opt = budgetOpt;
        this.mSettings.targetLength.max = budgetMax;
      } else {
        this.mSettings.targetLength.min = Math.max(
          minOptMaxMin(this.mSettings.targetLength),
          budgetMin,
        );
        this.mSettings.targetLength.opt = Math.min(
          minOptMaxOpt(this.mSettings.targetLength),
          budgetOpt,
        );
        this.mSettings.targetLength.max = Math.min(
          minOptMaxMax(this.mSettings.targetLength),
          budgetMax,
        );
      }
    }

    this.calculateTimeDomainTargets();

    if (samePoint(this.mCurrentStart, aP)) return false;

    if (this.mCurrentNode) this.mCurrentNode.destroy();

    const world = this.mWorld;

    if (!world) return false;

    this.mCurrentNode = world.branch();

    const splitP = chainSplitRange(
      PnsLineChain.fromPoints(this.mOriginPair.cP()),
      this.mCurrentStart,
      aP,
    );
    const splitN = chainSplitRange(
      PnsLineChain.fromPoints(this.mOriginPair.cN()),
      this.mCurrentStart,
      aP,
    );

    const preP = splitP.pre;
    const postP = splitP.post;
    const preN = splitN.pre;
    const postN = splitN.post;

    let tunedP = splitP.mid;
    let tunedN = splitN.mid;

    tunedP.simplify();
    tunedN.simplify();

    // "Bail out early if the tuned sections are empty (issue #22041). This can
    // happen when the split points are too close together or outside the line
    // chain."
    if (tunedP.pointCount() === 0 || tunedN.pointCount() === 0) {
      this.mFinalShapeP = PnsLineChain.fromPoints(this.mOriginPair.cP());
      this.mFinalShapeN = PnsLineChain.fromPoints(this.mOriginPair.cN());
      this.mLastLength = this.origPathLength();
      this.mLastStatus = PnsTuningStatus.TOO_SHORT;

      return false;
    }

    const updateStatus = (): void => {
      if (this.mLastLength > minOptMaxMax(this.mSettings.targetLength)) {
        this.mLastStatus = PnsTuningStatus.TOO_LONG;
      } else if (this.mLastLength < minOptMaxMin(this.mSettings.targetLength)) {
        this.mLastStatus = PnsTuningStatus.TOO_SHORT;
      } else {
        this.mLastStatus = PnsTuningStatus.TUNED;
      }
    };

    const tuned = DiffPair.copyOf(this.mOriginPair);

    tuned.setShape(tunedP.points(), tunedN.points());

    const coupledSegments = tuned.coupledSegmentPairs();

    if (coupledSegments.length === 0) {
      // "Tuning started at an uncoupled area of the DP; we won't get a valid
      // result until the cursor is moved far enough along a coupled area.
      // Prevent the track from disappearing and the length from being zero by
      // just using the original."
      this.mFinalShapeP = PnsLineChain.fromPoints(this.mOriginPair.cP());
      this.mFinalShapeN = PnsLineChain.fromPoints(this.mOriginPair.cN());
      this.mLastLength = this.origPathLength();
      updateStatus();

      return false;
    }

    this.mResult = new MeanderedLine(this, true);
    this.mResult.setWidth(tuned.width());

    let offset = Math.trunc((tuned.gap() + tuned.width()) / 2);

    if (this.pairOrientation(coupledSegments[0] as CoupledSegments)) offset *= -1;

    this.mResult.setBaselineOffset(offset);

    // `getItem`: an arc segment reports the whole arc and its two ends, a plain
    // one reports the segment's A and B. `aLastIndex` is a parameter upstream
    // never reads, so it is not one here.
    const getItem = (aChain: PnsLineChain, aIndex: number): DpItemAt => {
      if (aChain.isArcSegment(aIndex)) {
        const arc = aChain.arc(aChain.arcIndex(aIndex));

        return { arc, startPt: arc.p0, endPt: arc.p1 };
      }

      const seg = aChain.cSegment(aIndex);

      return { arc: null, startPt: seg.a, endPt: seg.b };
    };

    let curIndexP = 0;
    let curIndexN = 0;

    /**
     * Copy both lanes across, in step, up to the given per-lane index —
     * pairing arcs with arcs. **Oddity 17** lives in the two `p_ok`/`n_ok`
     * variables: they are reassigned by the inner arc hunts and then read again
     * at the bottom to decide which cursor advances.
     */
    const addCornersUntilIndex = (aLastIndexP: number, aLastIndexN: number): void => {
      for (;;) {
        let pOk = curIndexP <= aLastIndexP && curIndexP !== -1;
        let nOk = curIndexN <= aLastIndexN && curIndexN !== -1;

        if (!pOk && !nOk) break;

        let pItem = getItem(tunedP, curIndexP);
        let nItem = getItem(tunedN, curIndexN);

        if (!pItem.arc && !nItem.arc) {
          this.mResult.addCorner(pItem.startPt, nItem.startPt);
        } else if (pItem.arc && nItem.arc) {
          this.mResult.addArc(pItem.arc, nItem.arc);
        } else if (pItem.arc && !nItem.arc) {
          this.mResult.addCorner(pItem.startPt, nItem.startPt);

          // Find arc in N.
          for (;;) {
            nOk = curIndexN <= aLastIndexN && curIndexN !== -1;

            if (!nOk) break;

            curIndexN = tunedN.nextShape(curIndexN);
            nItem = getItem(tunedN, curIndexN);

            if (nItem.arc) {
              this.mResult.addArc(pItem.arc, nItem.arc);
              break;
            }

            this.mResult.addCorner(pItem.startPt, nItem.startPt);
          }
        } else if (!pItem.arc && nItem.arc) {
          this.mResult.addCorner(pItem.startPt, nItem.startPt);

          // Find arc in P.
          for (;;) {
            pOk = curIndexP <= aLastIndexP && curIndexP !== -1;

            if (!pOk) break;

            curIndexP = tunedP.nextShape(curIndexP);
            pItem = getItem(tunedP, curIndexP);

            if (pItem.arc) {
              this.mResult.addArc(pItem.arc, nItem.arc);
              break;
            }

            this.mResult.addCorner(pItem.startPt, nItem.startPt);
          }
        }

        if (pOk) curIndexP = tunedP.nextShape(curIndexP);

        if (nOk) curIndexN = tunedN.nextShape(curIndexN);
      }
    };

    for (const sp of coupledSegments) {
      const base = this.baselineSegment(sp);

      const side =
        this.mSettings.initialSide === 0 ? segSide(base, aP) < 0 : this.mSettings.initialSide < 0;

      addCornersUntilIndex(sp.indexP, sp.indexN);

      this.mResult.meanderSegment(base, side);
    }

    addCornersUntilIndex(tunedP.pointCount() - 1, tunedN.pointCount() - 1);

    this.mResult.addCorner(tunedP.cLastPoint(), tunedN.cLastPoint());

    const dpLen = this.origPathLength();
    const dpDelay = this.origPathDelay();

    this.mLastStatus = PnsTuningStatus.TUNED;

    if (dpLen > minOptMaxMax(this.mSettings.targetLength)) {
      this.mLastStatus = PnsTuningStatus.TOO_LONG;
      this.mLastLength = dpLen;
      this.mLastDelay = dpDelay;
    } else {
      this.mLastLength = dpLen - Math.max(tunedP.length(), tunedN.length());

      if (this.mSettings.isTimeDomain) {
        this.mLastDelay = dpDelay - Math.max(this.delayOf(tunedP), this.delayOf(tunedN));
      }

      tuneLineLength(this.mResult, minOptMaxOpt(this.mSettings.targetLength) - dpLen);
    }

    if (this.mLastStatus !== PnsTuningStatus.TOO_LONG) {
      tunedP = new PnsLineChain();
      tunedN = new PnsLineChain();

      for (const m of this.mResult.meanders()) {
        if (m.type() !== MeanderType.MT_EMPTY) {
          tunedP.appendChain(m.cLine(0));
          tunedN.appendChain(m.cLine(1));
        }
      }

      this.mLastLength += Math.max(tunedP.length(), tunedN.length());

      if (this.mSettings.isTimeDomain) {
        this.mLastDelay += Math.max(this.delayOf(tunedP), this.delayOf(tunedN));
      }

      updateStatus();
    }

    this.mFinalShapeP = new PnsLineChain();
    this.mFinalShapeN = new PnsLineChain();

    if (this.mSettings.keepEndpoints) {
      preP.simplify();
      tunedP.simplify();
      postP.simplify();

      this.mFinalShapeP.appendChain(preP);
      this.mFinalShapeP.appendChain(tunedP);
      this.mFinalShapeP.appendChain(postP);

      preN.simplify();
      tunedN.simplify();
      postN.simplify();

      this.mFinalShapeN.appendChain(preN);
      this.mFinalShapeN.appendChain(tunedN);
      this.mFinalShapeN.appendChain(postN);
    } else {
      this.mFinalShapeP.appendChain(preP);
      this.mFinalShapeP.appendChain(tunedP);
      this.mFinalShapeP.appendChain(postP);
      this.mFinalShapeP.simplify();

      this.mFinalShapeN.appendChain(preN);
      this.mFinalShapeN.appendChain(tunedN);
      this.mFinalShapeN.appendChain(postN);
      this.mFinalShapeN.simplify();
    }

    return true;
  }

  /** `CalculateDelayForShapeLineChain` for one lane of the pair. */
  private delayOf(aChain: PnsLineChain): number {
    return this.mHost
      .iface()
      .calculateDelayForShapeLineChain(
        aChain,
        this.getOriginPair().width(),
        true,
        this.getOriginPair().gap(),
        this.mHost.routerLayer(),
        this.mNetClass,
      );
  }

  /** `FixRoute()` (`cpp:579-590`) — note there is no null check on the node. */
  fixRoute(_aP: Vec2, _aEndItem: PnsItem | null, _aForceFinish = false): boolean {
    const lP = PnsLine.fromBase(this.mOriginPair.pLine(), this.mFinalShapeP);
    const lN = PnsLine.fromBase(this.mOriginPair.nLine(), this.mFinalShapeN);

    this.mCurrentNode?.addLine(lP);
    this.mCurrentNode?.addLine(lN);

    this.commitPlacement();

    return true;
  }

  abortPlacement(): boolean {
    this.mWorld?.killChildren();

    return true;
  }

  /** **Oddity 19**: the *origin* pair, so true from `start()` onwards. */
  hasPlacedAnything(): boolean {
    return this.mOriginPair.cP().length - 1 > 0 || this.mOriginPair.cN().length - 1 > 0;
  }

  commitPlacement(): boolean {
    if (this.mCurrentNode) this.mHost.commitRouting(this.mCurrentNode);

    this.mCurrentNode = null;

    return true;
  }

  /**
   * `CheckFit( aShape )` (`cpp:614-629`).
   *
   * **Oddity 16**: `clearance = w + w * 3`. The spacing setting plays no part.
   */
  override checkFit(aShape: MeanderShape): boolean {
    const l1 = PnsLine.fromBase(this.mOriginPair.pLine(), aShape.cLine(0));
    const l2 = PnsLine.fromBase(this.mOriginPair.nLine(), aShape.cLine(1));

    if (this.mCurrentNode?.checkColliding(l1)) return false;

    if (this.mCurrentNode?.checkColliding(l2)) return false;

    const w = aShape.width();
    const clearance = w + w * 3;

    return this.mResult.checkSelfIntersections(aShape, clearance);
  }

  /** `Traces()`: P then N, rebuilding both as a side effect. */
  traces(): PnsItemSet {
    this.mCurrentTraceP = PnsLine.fromBase(this.mOriginPair.pLine(), this.mFinalShapeP);
    this.mCurrentTraceN = PnsLine.fromBase(this.mOriginPair.nLine(), this.mFinalShapeN);

    const traces = new PnsItemSet();

    traces.add(this.mCurrentTraceP);
    traces.add(this.mCurrentTraceN);

    return traces;
  }

  /** **Oddity 20**: N's items first, then P's. */
  tunedPath(): PnsItemSet {
    const lines = new PnsItemSet();

    for (const item of this.mTunedPathN.items()) lines.add(item);

    for (const item of this.mTunedPathP.items()) lines.add(item);

    return lines;
  }

  currentStart(): Vec2 {
    return this.mCurrentStart;
  }

  /** `CurrentNets()`: P then N. */
  currentNets(): NetHandle[] {
    return [this.mOriginPair.netP(), this.mOriginPair.netN()];
  }

  currentLayer(): number {
    return this.mInitialSegment ? this.mInitialSegment.layers().start() : 0;
  }

  /** `totalLength()` is declared upstream and never defined; not ported. */
  tuningLengthResult(): number {
    if (this.mLastLength) return this.mLastLength;

    return this.origPathLength();
  }

  override tuningDelayResult(): number {
    if (this.mLastDelay) return this.mLastDelay;

    return this.origPathDelay();
  }

  tuningStatus(): PnsTuningStatus {
    return this.mLastStatus;
  }
}
