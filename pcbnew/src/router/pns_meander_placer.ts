// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::MEANDER_PLACER` — single-track length tuning. Counterpart:
 * `pcbnew/router/pns_meander_placer.{h,cpp}`.
 *
 * The user picks a track, drags a cursor along it, and the stretch between the
 * pick-up point and the cursor is replaced by meanders sized to hit a target
 * length. {@link PnsMeanderPlacer.start} captures the track and its baseline;
 * {@link PnsMeanderPlacer.move} runs on every cursor motion and rebuilds the
 * whole tuned stretch from scratch; {@link PnsMeanderPlacer.fixRoute} commits.
 *
 * ## `doMove` is the whole algorithm
 *
 * Split the origin line into `pre` / `tuned` / `post` at the two cursor points,
 * meander every segment of `tuned`, ask
 * {@link tuneLineLength} to shrink the result down to the target, and glue the
 * three parts back together. Everything else on this class is bookkeeping for
 * the status readout.
 *
 * ## Two asymmetries that look like bugs and are load-bearing
 *
 * **The early bail and the final verdict test different numbers.** `doMove`
 * bails to `TOO_LONG` when the *untuned* line already exceeds
 * `m_settings.m_targetLength.Max()`, but the verdict after tuning compares
 * against the `aTargetMax` argument. For this class they are the same value;
 * for {@link PnsMeanderSkewPlacer}, which passes `coupledLength + targetSkew`,
 * they are not — so a skew tune of an absolutely-long track bails before it
 * starts. Documented at the site; upstream's.
 *
 * **`m_lastLength === 0` means "unknown", not "zero".**
 * {@link PnsMeanderPlacer.tuningLengthResult} falls back to the original path
 * length whenever the last measurement was zero, so a genuinely zero-length
 * result is reported as the untuned length.
 *
 * ## Upstream oddities reproduced here
 *
 * Numbered continuing `pns_meander.ts` (1-6) and `pns_meander_placer_base.ts`
 * (7-12).
 *
 * 13. The arc arm of `doMove`'s segment loop advances `i` to `NextShape(i)` and
 *     then `continue`s, so the `for`'s own `i++` **also** fires and the segment
 *     immediately after an arc is never meandered.
 * 14. `Start()` fills the `_n` pad slots for its single net. The skew placer
 *     derives from this class and uses `_p`/`_n` for a real pair, so the same
 *     two fields mean different things in the two classes.
 * 15. `m_keepEndpoints` changes *where* `Simplify` runs, not whether: on the
 *     three parts separately, or once on their concatenation. The second can
 *     merge the last segment of `pre` into the first of `tuned` and move the
 *     endpoint the option exists to keep.
 *
 * The full porting spec is `/var/tmp/ziro-router-specs/pns_meander_placer_impl.md`.
 */
import {
  MeanderType,
  MeanderedLine,
  minOptMaxMax,
  minOptMaxMin,
  minOptMaxOpt,
} from './pns_meander.js';
import { MEANDER_LENGTH_UNCONSTRAINED, MEANDER_DELAY_UNCONSTRAINED } from './pns_meander.js';
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
import type { MeanderPlacerHost } from './pns_meander_placer_base.js';
import type { MeanderShape } from './pns_meander.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsItem, PnsLinkedItem } from './pns_item.js';
import type { PnsNode } from './pns_node.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const samepoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** `MEANDER_PLACER`: single track length matching/meandering tool. */
export class PnsMeanderPlacer extends PnsMeanderPlacerBase {
  /** Current routing start point (end of tail, beginning of head). */
  protected mCurrentStart: Vec2 = { x: 0, y: 0 };

  /** Current world state. Null until the first `move()`. */
  protected mCurrentNode: PnsNode | null = null;

  protected mOriginLine = new PnsLine();
  protected mCurrentTrace = new PnsLine();
  protected mTunedPath = new PnsItemSet();

  protected mFinalShape = new PnsLineChain();
  protected mResult: MeanderedLine;
  protected mInitialSegment: PnsLinkedItem | null = null;

  /** Total length/delay added by pad to die size. */
  protected mPadToDieLength = 0;
  protected mPadToDieDelay = 0;

  /** The netclass for the placed segments. */
  protected mNetClass: string | null = null;

  protected mLastLength = 0;
  protected mLastDelay = 0;
  protected mLastStatus: PnsTuningStatus = PnsTuningStatus.TOO_SHORT;

  constructor(aHost: MeanderPlacerHost) {
    super(aHost);
    this.mResult = new MeanderedLine(this, false);
  }

  /** `CurrentNode()`: the branch if there is one, else the world. */
  currentNode(_aLoopsRemoved = false): PnsNode | null {
    if (!this.mCurrentNode) return this.mWorld;

    return this.mCurrentNode;
  }

  /**
   * `Start( aP, aStartItem )` (`cpp:69-124`).
   *
   * Note the order: the tuning path is assembled from the world *before* the
   * origin line is removed from it, and the baseline is captured *after* — so
   * the baseline measures a path that the world no longer contains.
   */
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
    this.mOriginLine = world.assembleLine(this.mInitialSegment);

    const tuning = this.mHost.assembleTuningPath(world, this.mInitialSegment);

    this.mTunedPath = tuning.path;
    this.mStartPadN = tuning.startPad;
    this.mEndPadN = tuning.endPad;

    this.mPadToDieLength = 0;
    this.mPadToDieDelay = 0;

    if (this.mStartPadN) {
      this.mPadToDieLength += this.mStartPadN.getPadToDie();
      this.mPadToDieDelay += this.mStartPadN.getPadToDieDelay();
    }

    if (this.mEndPadN) {
      this.mPadToDieLength += this.mEndPadN.getPadToDie();
      this.mPadToDieDelay += this.mEndPadN.getPadToDieDelay();
    }

    world.removeLine(this.mOriginLine);

    this.mCurrentWidth = this.mOriginLine.width();
    this.mCurrentEnd = { x: 0, y: 0 };

    this.mNetClass = this.mHost.effectiveNetClass(aStartItem);

    this.mBaselineLength = this.origPathLength();
    this.mBaselineDelay = this.mSettings.isTimeDomain ? this.origPathDelay() : 0;

    this.initChainExtras();

    this.calculateTimeDomainTargets();

    return true;
  }

  /**
   * `origPathLength()` (`cpp:127-131`). Unlike the differential-pair placer's,
   * this one adds `m_signalExtraLength`.
   */
  protected origPathLength(): number {
    return (
      this.mPadToDieLength +
      this.mSettings.signalExtraLength +
      this.lineLength(this.mTunedPath, this.mStartPadN, this.mEndPadN)
    );
  }

  /** `origPathDelay()` (`cpp:134-138`). */
  protected origPathDelay(): number {
    return (
      this.mPadToDieDelay +
      this.mSettings.signalExtraDelay +
      this.lineDelay(this.mTunedPath, this.mStartPadN, this.mEndPadN)
    );
  }

  /**
   * `calculateTimeDomainTargets()` (`cpp:141-190`): turn a *delay* target into
   * the length target `doMove` actually tunes to. A no-op unless
   * `m_isTimeDomain`.
   *
   * Which delay target is used, and what it is measured against, move together:
   * a chain-level (`targetSignalLengthDelay`) target is compared to the
   * per-net delay with the siblings' contribution taken out of both sides,
   * while a per-net target is compared to the aggregate as-is.
   *
   * Three details:
   *
   *  - the chain-level maximum is clamped to `desiredDelayOpt`, not to 0, so a
   *    maximum that falls below the optimum after subtracting the siblings
   *    collapses onto the optimum rather than inverting the window;
   *  - `lengthDiffOpt` is computed from `|delayDifferenceOpt|` and *then* given
   *    the difference's sign back, because `CalculateLengthForDelay` is only
   *    defined for a non-negative delay;
   *  - a difference of exactly 0 takes the negative branch (`> 0` is false),
   *    which negates a zero and is therefore a no-op.
   */
  protected calculateTimeDomainTargets(): void {
    if (!this.mSettings.isTimeDomain) return;

    const iface = this.mHost.iface();

    // curDelayChain includes other nets (chain aggregate). curDelayNet excludes extras.
    const curDelayChain = this.origPathDelay();
    const curDelayNet = curDelayChain - this.mSettings.signalExtraDelay;

    // Prefer chain-level target if explicitly set.
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

    const curDelay = useSignalTarget ? curDelayNet : curDelayChain;

    const delayDifferenceOpt = desiredDelayOpt - curDelay;

    const curLength = this.origPathLength();
    const layer = this.mHost.routerLayer();
    const gap = this.mHost.diffPairGap();

    const lengthDiffMin = iface.calculateLengthForDelay(
      desiredDelayOpt - desiredDelayMin,
      this.mCurrentWidth,
      false,
      gap,
      layer,
      this.mNetClass,
    );
    let lengthDiffOpt = iface.calculateLengthForDelay(
      Math.abs(delayDifferenceOpt),
      this.mCurrentWidth,
      false,
      gap,
      layer,
      this.mNetClass,
    );
    const lengthDiffMax = iface.calculateLengthForDelay(
      desiredDelayMax - desiredDelayOpt,
      this.mCurrentWidth,
      false,
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
   * `Move( aP, aEndItem )` (`cpp:193-232`).
   *
   * Before tuning, the *chain* budget is turned into a per-net one: a target
   * covering the whole signal chain has to lose whatever the sibling nets and
   * the unmeasured stub already account for
   * ({@link PnsMeanderPlacerBase.chainNarrowingOffset}). Without it the meander
   * over-corrects by exactly that amount.
   *
   * The two arms are not the same operation. With no per-net target the budget
   * *replaces* the window; with one, the two windows are **intersected** — `max`
   * on the minimum and `min` on both the optimum and the maximum. The
   * intersection can come out inverted (min > max) and upstream does not
   * repair it; the status readout then simply reports `TOO_LONG` or
   * `TOO_SHORT` for every cursor position.
   */
  move(aP: Vec2, aEndItem: PnsItem | null): boolean {
    // Reuse the chain-extras aggregate captured at Start(): other nets in the
    // chain are not edited during a tuning session.
    const extraDelay = this.mChainExtrasValid ? this.mChainExtrasDelay : 0;

    // signalExtraDelay is needed for calculateTimeDomainTargets().
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

    return this.doMove(
      aP,
      aEndItem,
      minOptMaxOpt(this.mSettings.targetLength),
      minOptMaxMin(this.mSettings.targetLength),
      minOptMaxMax(this.mSettings.targetLength),
    );
  }

  /**
   * `doMove( aP, aEndItem, aTargetLength, aTargetMin, aTargetMax )`
   * (`cpp:235-380`).
   *
   * The target arrives as three arguments rather than being read from the
   * settings because {@link PnsMeanderSkewPlacer} passes a *skew* window
   * instead — which is why the early `TOO_LONG` bail below, which reads the
   * settings directly, is not the same test as the final verdict.
   */
  protected doMove(
    aP: Vec2,
    _aEndItem: PnsItem | null,
    aTargetLength: number,
    aTargetMin: number,
    aTargetMax: number,
  ): boolean {
    if (samepoint(this.mCurrentStart, aP)) return false;

    if (this.mCurrentNode) this.mCurrentNode.destroy();

    const world = this.mWorld;

    if (!world) return false;

    this.mCurrentNode = world.branch();

    const split = chainSplitRange(this.mOriginLine.cLine(), this.mCurrentStart, aP);
    const pre = split.pre;
    let tuned = split.mid;
    const post = split.post;

    this.mResult = new MeanderedLine(this, false);
    this.mResult.setWidth(this.mOriginLine.width());
    this.mResult.setBaselineOffset(0);

    for (let i = 0; i < tuned.segmentCount(); i++) {
      if (tuned.isArcSegment(i)) {
        this.mResult.addArc(tuned.arc(tuned.arcIndex(i)));

        // **Oddity 13.** `i` is advanced here *and* by the loop's own `i++`
        // when the `continue` fires, so the shape after an arc is skipped.
        i = tuned.nextShape(i);

        // NextShape will return -1 if last shape.
        if (i < 0) i = tuned.segmentCount();

        continue;
      }

      const s = tuned.cSegment(i);

      const side =
        this.mSettings.initialSide === 0 ? segSide(s, aP) < 0 : this.mSettings.initialSide < 0;

      this.mResult.addCorner(s.a);
      this.mResult.meanderSegment(s, side);
      this.mResult.addCorner(s.b);
    }

    const lineLen = this.origPathLength();
    const lineDelay = this.origPathDelay();

    this.mLastLength = lineLen;
    this.mLastDelay = lineDelay;
    this.mLastStatus = PnsTuningStatus.TUNED;

    // NOT PINNED: this is the documented asymmetry — the bail reads the
    // settings, the verdict below reads `aTargetMax` — and the two are the same
    // number for this class, so only a skew fixture can tell them apart. No
    // test here builds one where they differ, and a mutant substituting
    // `aTargetMax` survives the suite.
    if (lineLen > minOptMaxMax(this.mSettings.targetLength)) {
      this.mLastStatus = PnsTuningStatus.TOO_LONG;
    } else {
      this.mLastLength = lineLen - tuned.length();

      if (this.mSettings.isTimeDomain) {
        this.mLastDelay = lineDelay - this.delayOf(tuned);
      }

      tuneLineLength(this.mResult, aTargetLength - lineLen);
    }

    if (this.mLastStatus !== PnsTuningStatus.TOO_LONG) {
      tuned = new PnsLineChain();

      for (const m of this.mResult.meanders()) {
        if (m.type() !== MeanderType.MT_EMPTY) tuned.appendChain(m.cLine(0));
      }

      this.mLastLength += tuned.length();

      if (this.mSettings.isTimeDomain) this.mLastDelay += this.delayOf(tuned);

      if (this.mLastLength > aTargetMax) this.mLastStatus = PnsTuningStatus.TOO_LONG;
      else if (this.mLastLength < aTargetMin) this.mLastStatus = PnsTuningStatus.TOO_SHORT;
      else this.mLastStatus = PnsTuningStatus.TUNED;
    }

    this.mFinalShape = new PnsLineChain();

    // **Oddity 15**: `keepEndpoints` moves the `Simplify`, it does not remove it.
    if (this.mSettings.keepEndpoints) {
      pre.simplify();
      tuned.simplify();
      post.simplify();

      this.mFinalShape.appendChain(pre);
      this.mFinalShape.appendChain(tuned);
      this.mFinalShape.appendChain(post);
    } else {
      this.mFinalShape.appendChain(pre);
      this.mFinalShape.appendChain(tuned);
      this.mFinalShape.appendChain(post);
      this.mFinalShape.simplify();
    }

    return true;
  }

  /** `CalculateDelayForShapeLineChain` for a single-ended trace. */
  private delayOf(aChain: PnsLineChain): number {
    return this.mHost
      .iface()
      .calculateDelayForShapeLineChain(
        aChain,
        this.mCurrentWidth,
        false,
        this.mHost.diffPairGap(),
        this.mHost.routerLayer(),
        this.mNetClass,
      );
  }

  /** `FixRoute()` (`cpp:383-392`). */
  fixRoute(_aP: Vec2, _aEndItem: PnsItem | null, _aForceFinish = false): boolean {
    if (!this.mCurrentNode) return false;

    this.mCurrentTrace = PnsLine.fromBase(this.mOriginLine, this.mFinalShape);
    this.mCurrentNode.addLine(this.mCurrentTrace);
    this.commitPlacement();

    return true;
  }

  /** `AbortPlacement()`: drop every branch of the world, keeping the world. */
  abortPlacement(): boolean {
    this.mWorld?.killChildren();

    return true;
  }

  /** `HasPlacedAnything()` — the *current trace*, so false until `fixRoute`. */
  hasPlacedAnything(): boolean {
    return this.mCurrentTrace.segmentCount() > 0;
  }

  /** `CommitPlacement()`. */
  commitPlacement(): boolean {
    if (this.mCurrentNode) this.mHost.commitRouting(this.mCurrentNode);

    this.mCurrentNode = null;

    return true;
  }

  /**
   * `CheckFit( aShape )` (`cpp:412-423`): the answer `MEANDERED_LINE` asks for
   * before keeping a meander.
   *
   * Two tests, and the second is the one that makes runs of meanders legal at
   * all: the shape must not collide with the *world*, and must clear every
   * meander already placed by `m_spacing` on top of its own width. Note the
   * differential-pair placer uses `w + w * 3` instead and ignores the spacing
   * setting entirely.
   */
  override checkFit(aShape: MeanderShape): boolean {
    const l = PnsLine.fromBase(this.mOriginLine, aShape.cLine(0));

    if (this.mCurrentNode?.checkColliding(l)) return false;

    const w = aShape.width();
    const clearance = w + this.mSettings.spacing;

    return this.mResult.checkSelfIntersections(aShape, clearance);
  }

  /** `Traces()` — rebuilds `m_currentTrace` as a side effect, as upstream does. */
  traces(): PnsItemSet {
    this.mCurrentTrace = PnsLine.fromBase(this.mOriginLine, this.mFinalShape);

    return new PnsItemSet(this.mCurrentTrace);
  }

  /** `TunedPath()`. */
  tunedPath(): PnsItemSet {
    return this.mTunedPath;
  }

  currentStart(): Vec2 {
    return this.mCurrentStart;
  }

  /** `CurrentNets()`: one entry, the origin line's net. */
  currentNets(): NetHandle[] {
    return [this.mOriginLine.net()];
  }

  /** `CurrentLayer()`. */
  currentLayer(): number {
    return this.mInitialSegment ? this.mInitialSegment.layers().start() : 0;
  }

  /** `TuningLengthResult()` — zero means "not measured yet", not "zero long". */
  tuningLengthResult(): number {
    if (this.mLastLength) return this.mLastLength;

    return this.origPathLength();
  }

  /** `TuningDelayResult()`, same zero-means-unknown reading. */
  override tuningDelayResult(): number {
    if (this.mLastDelay) return this.mLastDelay;

    return this.origPathDelay();
  }

  tuningStatus(): PnsTuningStatus {
    return this.mLastStatus;
  }
}
