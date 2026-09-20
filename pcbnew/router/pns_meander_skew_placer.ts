// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::MEANDER_SKEW_PLACER` — differential-pair **skew** tuning. Counterpart:
 * `pcbnew/router/pns_meander_skew_placer.{h,cpp}`.
 *
 * Skew tuning is length tuning of *one* lane against the other. The class
 * therefore derives from {@link PnsMeanderPlacer}, not from the differential
 * pair placer: it meanders a single track exactly as that class does, and only
 * the *target* changes — instead of "make this line 50 mm", it is "make this
 * line as long as its partner, plus the skew you asked for".
 *
 * That substitution happens in one place, {@link PnsMeanderSkewPlacer.move},
 * which calls the inherited `doMove` with `coupledLength + targetSkew` in place
 * of a length target. Everything else here is the bookkeeping that makes
 * `m_coupledLength` mean what it says.
 *
 * ## Which lane is which
 *
 * `Start()` assembles the pair, works out whether the picked-up track is the P
 * or the N lane, and from then on *active* means the picked-up one and
 * *coupled* means the other. `m_lastLength` holds the active lane's length —
 * which is why {@link PnsMeanderSkewPlacer.tuningLengthResult} returns a
 * **skew** (`active - coupled`) where the base class returns a length, and why
 * the status readout in `doMove` compares against a skew window.
 *
 * ## Upstream oddities reproduced here
 *
 * Numbered continuing `pns_meander.ts` (1-6), `pns_meander_placer_base.ts`
 * (7-12), `pns_meander_placer.ts` (13-15) and `pns_dp_meander_placer.ts`
 * (16-20).
 *
 * 21. `Start()` assembles a trivial path into `m_tunedPath` and then
 *     **overwrites it** a few dozen lines later with the active lane's tuning
 *     path. The first assembly's only surviving effect is that a failure
 *     inside it fails the whole `Start()`.
 * 22. The chain aggregate is added to *both* `m_coupledLength` and
 *     `m_lastLength`, so it cancels out of every skew this class reports. It
 *     survives only in the absolute numbers, which is exactly why `Move()` has
 *     to subtract `chainNarrowingOffset()` from the target it passes down.
 * 23. `Move()` does **not** run the inherited chain-budget preamble (it does
 *     not call `MEANDER_PLACER::Move`), so `m_settings.m_signalExtraDelay` is
 *     never refreshed per cursor move in skew mode — it keeps whatever
 *     `Start()` left.
 * 24. Inherited from `doMove`, and only visible here: the early `TOO_LONG`
 *     bail tests the *length* target while the final verdict tests the skew
 *     window this class passes down. A pair whose absolute length exceeds
 *     `targetLength.Max()` bails before any skew tuning happens.
 *
 * The full porting spec is `/var/tmp/ziro-router-specs/pns_meander_placer_impl.md`.
 */
import { DiffPair } from './pns_diff_pair.js';
import { PnsItemSet } from './pns_itemset.js';
import { PnsKind } from './pns_item.js';
import { PnsMeanderPlacer } from './pns_meander_placer.js';
import { PnsTopology } from './pns_topology.js';
import { getSnappedStartPoint } from './pns_meander_placer_base.js';
import { minOptMaxMax, minOptMaxMin, minOptMaxOpt } from './pns_meander.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsItem, PnsLinkedItem } from './pns_item.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `MEANDER_SKEW_PLACER`: differential pair skew adjustment algorithm. */
export class PnsMeanderSkewPlacer extends PnsMeanderPlacer {
  private mOriginPair = new DiffPair();
  private mTunedPathP = new PnsItemSet();
  private mTunedPathN = new PnsItemSet();

  private mCoupledLength = 0;
  private mCoupledDelay = 0;
  private mPadToDieLengthP = 0;
  private mPadToDieLengthN = 0;
  private mPadToDieDelayP = 0;
  private mPadToDieDelayN = 0;

  /** `Start( aP, aStartItem )` (`cpp:62-181`). */
  override start(aP: Vec2, aStartItem: PnsItem | null): boolean {
    if (!aStartItem || !aStartItem.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
      this.mHost.setFailureReason('Please select a differential pair track you want to tune.');
      return false;
    }

    this.mInitialSegment = aStartItem as PnsLinkedItem;
    this.mCurrentNode = null;
    this.mCurrentStart = getSnappedStartPoint(this.mInitialSegment, aP);

    const world = this.mHost.world().branch();
    this.mWorld = world;
    this.mOriginLine = world.assembleLine(this.mInitialSegment);

    const topo = new PnsTopology(world);

    // **Oddity 21**: overwritten below; only its failure modes survive.
    this.mTunedPath = topo.assembleTrivialPath(this.mInitialSegment, null, true);

    const pair = this.mHost.assembleDiffPair(world, this.mInitialSegment);

    if (!(pair instanceof DiffPair)) {
      this.mHost.setFailureReason(
        'Unable to find complementary differential pair net for skew tuning. Make sure the ' +
          'names of the nets belonging to a differential pair end with either _N/_P or +/-.',
      );

      return false;
    }

    this.mOriginPair = pair;

    if (this.mOriginPair.gap() < 0) this.mOriginPair.setGap(this.mHost.diffPairGap());

    if (!this.mOriginPair.pLine().segmentCount() || !this.mOriginPair.nLine().segmentCount()) {
      return false;
    }

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

    world.removeLine(this.mOriginLine);

    this.mCurrentWidth = this.mOriginLine.width();
    this.mCurrentEnd = { x: 0, y: 0 };

    this.mNetClass = this.mHost.effectiveNetClass(aStartItem);
    this.mSettings.netClass = this.mNetClass;

    const pIsActive = this.mOriginPair.netP() === this.mOriginLine.net();

    const lenP =
      this.mPadToDieLengthP + this.lineLength(this.mTunedPathP, this.mStartPadP, this.mEndPadP);
    const lenN =
      this.mPadToDieLengthN + this.lineLength(this.mTunedPathN, this.mStartPadN, this.mEndPadN);
    const delayP =
      this.mPadToDieDelayP + this.lineDelay(this.mTunedPathP, this.mStartPadP, this.mEndPadP);
    const delayN =
      this.mPadToDieDelayN + this.lineDelay(this.mTunedPathN, this.mStartPadN, this.mEndPadN);

    // Aggregate chain contribution (other nets in the same chain). Upstream
    // *ignores the return value* and leaves both locals at their zero
    // initialisers when the query fails, which is what null means here.
    const aggregate = this.mHost
      .iface()
      .getSignalAggregate(this.mOriginPair.netP(), this.mOriginPair.netN());

    const extraSignalLen = aggregate ? aggregate.length : 0;
    const extraSignalDelay = aggregate ? aggregate.delay : 0;

    // **Oddity 22**: the aggregate goes on both sides and so cancels in the skew.
    if (pIsActive) {
      this.mCoupledLength = lenN + extraSignalLen;
      this.mLastLength = lenP + extraSignalLen;
      this.mCoupledDelay = delayN + extraSignalDelay;
      this.mLastDelay = delayP + extraSignalDelay;
      this.mTunedPath = this.mTunedPathP;
    } else {
      this.mCoupledLength = lenP + extraSignalLen;
      this.mLastLength = lenN + extraSignalLen;
      this.mCoupledDelay = delayP + extraSignalDelay;
      this.mLastDelay = delayN + extraSignalDelay;
      this.mTunedPath = this.mTunedPathN;
    }

    this.mBaselineLength = this.origPathLength();
    this.mBaselineDelay = this.mSettings.isTimeDomain ? this.origPathDelay() : 0;

    this.initChainExtras();

    this.calculateTimeDomainTargets();

    return true;
  }

  /**
   * `origPathLength()` (`cpp:184-190`): the **active** lane's, measured over
   * `m_tunedPath` — which `Start()` pointed at that lane.
   */
  protected override origPathLength(): number {
    if (this.mOriginPair.netP() === this.mOriginLine.net()) {
      return (
        this.mPadToDieLengthP + this.lineLength(this.mTunedPath, this.mStartPadP, this.mEndPadP)
      );
    }

    return this.mPadToDieLengthN + this.lineLength(this.mTunedPath, this.mStartPadN, this.mEndPadN);
  }

  /** `origPathDelay()` (`cpp:193-199`). */
  protected override origPathDelay(): number {
    if (this.mOriginPair.netP() === this.mOriginLine.net()) {
      return this.mPadToDieDelayP + this.lineDelay(this.mTunedPath, this.mStartPadP, this.mEndPadP);
    }

    return this.mPadToDieDelayN + this.lineDelay(this.mTunedPath, this.mStartPadN, this.mEndPadN);
  }

  /** `CurrentSkew()`: active minus coupled, chain aggregate included in both. */
  currentSkew(): number {
    return this.mLastLength - this.mCoupledLength;
  }

  /**
   * `Move( aP, aEndItem )` (`cpp:202-245`).
   *
   * The whole class, in three arguments: the length window handed to `doMove`
   * is the *coupled lane's* length plus the requested skew, less the part of
   * the budget the chain already absorbs.
   *
   * `m_coupledLength` already carries the chain-extras aggregate captured at
   * `Start()`. Those extras, and any stub on the active net that the PNS
   * baseline did not measure, belong to the chain rather than to the meander —
   * so without the subtraction the meander over-corrects by exactly
   * {@link PnsMeanderPlacerBase.chainNarrowingOffset} whenever the pair is part
   * of a chain.
   */
  override move(aP: Vec2, aEndItem: PnsItem | null): boolean {
    this.calculateTimeDomainTargets();

    const offset = this.chainNarrowingOffset();

    return this.doMove(
      aP,
      aEndItem,
      this.mCoupledLength + minOptMaxOpt(this.mSettings.targetSkew) - offset,
      this.mCoupledLength + minOptMaxMin(this.mSettings.targetSkew) - offset,
      this.mCoupledLength + minOptMaxMax(this.mSettings.targetSkew) - offset,
    );
  }

  /**
   * `CurrentNets()` (`h:60-69`): **active lane first**, coupled second.
   *
   * The order is load-bearing at both call sites in the base class.
   * `chainNarrowingOffset()` asks the BOARD for `nets[0]`'s length, which must
   * be the lane being tuned; and `initChainExtras()` passes `(nets[0],
   * nets[1])` to `GetSignalAggregate`, which must exclude *both* lanes so that
   * the offset matches the `GetSignalAggregate( P, N, … )` already baked into
   * `m_coupledLength` at `Start()`.
   */
  override currentNets(): NetHandle[] {
    const pIsActive = this.mOriginPair.netP() === this.mOriginLine.net();

    const active = pIsActive ? this.mOriginPair.netP() : this.mOriginPair.netN();
    const coupled = pIsActive ? this.mOriginPair.netN() : this.mOriginPair.netP();

    return [active, coupled];
  }

  /** `TuningLengthResult()` — a **skew**, not a length. No zero-means-unknown. */
  override tuningLengthResult(): number {
    return this.mLastLength - this.mCoupledLength;
  }

  /** `TuningDelayResult()` — a skew delay. */
  override tuningDelayResult(): number {
    return this.mLastDelay - this.mCoupledDelay;
  }

  /**
   * `calculateTimeDomainTargets()` (`cpp:259-286`): turn a skew *delay* window
   * into the skew *length* window `move()` passes down.
   *
   * All three of min/opt/max are computed from the same unmodified
   * `m_lastDelay`, so they do not interact; and each is
   * `currentSkew + signedLengthForDelay( target - currentSkewDelay )`.
   * `CalculateLengthForDelay` only takes a non-negative delay, hence the
   * absolute value and the sign put back afterwards.
   */
  protected override calculateTimeDomainTargets(): void {
    if (!this.mSettings.isTimeDomain) return;

    const calculateTargetSkew = (aTargetSkewDelay: number): number => {
      const curSkewDelay = this.mLastDelay - this.mCoupledDelay;
      const skewDelayDifference = aTargetSkewDelay - curSkewDelay;

      let skewLengthDiff = this.mHost
        .iface()
        .calculateLengthForDelay(
          Math.abs(skewDelayDifference),
          this.mOriginPair.width(),
          true,
          this.mOriginPair.gap(),
          this.mHost.routerLayer(),
          this.mNetClass,
        );

      const curSkew = this.currentSkew();

      skewLengthDiff = skewDelayDifference > 0 ? skewLengthDiff : -skewLengthDiff;

      // `static_cast<int>`: truncation toward zero. The 32-bit wrap upstream
      // would also apply is not modelled — it needs a skew past 2 km.
      return Math.trunc(curSkew + skewLengthDiff);
    };

    this.mSettings.targetSkew.min = calculateTargetSkew(
      minOptMaxMin(this.mSettings.targetSkewDelay),
    );
    this.mSettings.targetSkew.opt = calculateTargetSkew(
      minOptMaxOpt(this.mSettings.targetSkewDelay),
    );
    this.mSettings.targetSkew.max = calculateTargetSkew(
      minOptMaxMax(this.mSettings.targetSkewDelay),
    );
  }
}
