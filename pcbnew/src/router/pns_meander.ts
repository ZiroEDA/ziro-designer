// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The geometry of a length-tuning meander: one trombone, and a line made of
 * them.
 * Counterparts: `pcbnew/router/pns_meander.h` and `pns_meander.cpp`
 * (`MEANDER_SETTINGS`, `MEANDER_SHAPE`, `MEANDERED_LINE`).
 *
 * This is the whole of `pns_meander.{h,cpp}` and nothing else. The file has no
 * reference to `PNS::NODE`, which is why it can land before the router's world
 * model is finished: a meander is drawn from a base segment, a set of
 * dimensions and a turtle, and only the *placers* — every one of which drives a
 * `NODE` — need to know whether the result actually fits on a board.
 *
 * ## Classes here, not free functions
 *
 * The rest of this directory's geometry is plain data plus pure functions
 * (`Chain = Vec2[]`), and where that fits it is followed: {@link chainLength},
 * {@link lineChainCollideSeg} and everything in `pns_seg_ops.ts` /
 * `shape_arc_ops.ts` are free functions over existing types.
 *
 * `MEANDER_SHAPE` and `MEANDERED_LINE` are classes because upstream's are
 * genuinely stateful **and identity-bearing**, in a way the callers depend on.
 * A `MEANDERED_LINE` holds `MEANDER_SHAPE*`, hands them out through
 * `Meanders()`, and the tuner then walks that vector calling `Resize()` on the
 * shapes *in place* until the line comes out the right length. Rebuilding a
 * value each time would break the loop the placers are written as. The turtle
 * is stateful for the same reason: `forward`/`turn`/`miter` are a sequence of
 * mutations on a current position, direction and target chain, and that is what
 * makes the shape definitions read the way upstream's do.
 *
 * ## The placer is an interface, not a stub
 *
 * `MEANDER_SHAPE` and `MEANDERED_LINE` reach the placer for exactly four
 * things, and {@link MeanderPlacer} is those four. Everything else about
 * `MEANDER_PLACER_BASE` belongs to the PR that ports the placers.
 *
 * Note that `MEANDER_PLACER_BASE::CheckFit` returns **false** in the base class
 * (pns_meander_placer_base.h:120) — the real answer comes from a subclass that
 * asks a `NODE`. {@link basicMeanderPlacer} reproduces that default, so a
 * meandered line built on a bare placer comes out as corners only. That is not
 * a stub returning the wrong thing; it is upstream's answer.
 *
 * ## Board Setup already has *a* meander settings type, and it is not this one
 *
 * `designer/src/editors/pcb/board_settings.ts` defines `TuningPattern`: six
 * millimetre-valued fields, persisted in the project file, read by
 * `PANEL_SETUP_TUNING_PATTERNS`. It is the UI mirror of six of the fields
 * below and it cannot be reused here, because `designer` depends on `pcbnew`
 * and not the reverse — importing it would invert the dependency. The
 * conversion (mm → IU, `'Fillet' | 'Chamfer'` → {@link MeanderStyle}) belongs
 * in `designer` alongside the panel, and lands with the placer that needs it.
 *
 * ## Upstream oddities reproduced here
 *
 * Six, all documented at their sites. Four are observable and pinned by tests
 * in `qa/unittests/pcbnew/pns_meander.test.ts`; #3 and #6 are **not** — they
 * are unobservable through this file's surface, and no test here would fail if
 * a later change quietly "corrected" them. Flagged rather than papered over.
 *
 *  1. {@link setTargetSkewDelay} applies the *length* tolerance to a delay;
 *  2. {@link MeanderShape.minAmplitude}'s chamfer correction is
 *     `tan( 1 - tan 22.5° )` — a tangent of a number — where the same
 *     correction in {@link MeanderShape.cornerRadius} is the plain factor
 *     `1 - tan 22.5°`;
 *  3. `Fit`'s check-mode writes `m_baseSeg` twice, the first write dead;
 *  4. `Fit`'s check-mode **resets the base index to 0**, wiping what the caller
 *     set;
 *  5. `MeanderSegment`'s advance-on-failure subtracts a corner radius that is
 *     always zero;
 *  6. the `MT_TURN` / `MT_FINISH` re-fits inside the turning branch ignore
 *     their return value and add the shape regardless.
 */
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import { PnsLineChain } from './pns_line_item.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import { segSquaredDistanceToSeg } from '@ziroeda/kimath/src/geometry/seg.js';
import {
  ARC_POLYGONIZATION_MAX_ERROR,
  arcConvertToPolyline,
  arcLength,
  constructArcFromStartEndAngle,
  perpendicular,
  resizeD,
  truncVec,
} from './shape_arc_ops.js';
import { segApproxParallel, segContains, segLength, segLineProject } from './pns_seg_ops.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { MinOptMax } from '../drc/drc_rule.js';
import type { Seg } from './pns_line.js';
import type { ShapeArc } from './pns_arc.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ---------------------------------------------------------------------------
// Enums (pns_meander.h:40-64)

/** `MEANDER_TYPE`: the shapes a single meander can take. */
export enum MeanderType {
  /** `_|^|_`, single-sided. */
  MT_SINGLE = 'MT_SINGLE',
  /** `_|^|` — the first half of a run of turns. */
  MT_START = 'MT_START',
  /** `|^|_` — the last half. */
  MT_FINISH = 'MT_FINISH',
  /** `|^|` or `|_|` — one turn in the middle of a run. */
  MT_TURN = 'MT_TURN',
  /** Try fitting a start, but produce no line. */
  MT_CHECK_START = 'MT_CHECK_START',
  /** Try fitting a finish, but produce no line. */
  MT_CHECK_FINISH = 'MT_CHECK_FINISH',
  /** A line corner. */
  MT_CORNER = 'MT_CORNER',
  /** An arc corner. */
  MT_ARC = 'MT_ARC',
  /** No meander: a straight bypass. */
  MT_EMPTY = 'MT_EMPTY',
}

/** `MEANDER_STYLE`: how a meander's corners are cut. */
export enum MeanderStyle {
  /** A 90° arc. */
  MEANDER_STYLE_ROUND = 1,
  /** A 45° segment. */
  MEANDER_STYLE_CHAMFER = 2,
}

/** `MEANDER_SIDE`: which side the first meander of a segment goes to. */
export enum MeanderSide {
  MEANDER_SIDE_LEFT = -1,
  MEANDER_SIDE_DEFAULT = 0,
  MEANDER_SIDE_RIGHT = 1,
}

// ---------------------------------------------------------------------------
// MEANDER_SETTINGS (pns_meander.h:69, pns_meander.cpp:31-237)

/** `pcbIUScale.IU_PER_PS` (`include/base_units.h:76`): internal time units. */
export const IU_PER_PS = 1e6;

/** `MEANDER_SETTINGS::DEFAULT_LENGTH_TOLERANCE` — `mmToIU( 0.1 )`. */
export const MEANDER_DEFAULT_LENGTH_TOLERANCE = 0.1 * PCB_IU_PER_MM;

/** `MEANDER_SETTINGS::LENGTH_UNCONSTRAINED` — a kilometre of slack. */
export const MEANDER_LENGTH_UNCONSTRAINED = 1000000 * PCB_IU_PER_MM;

/** `MEANDER_SETTINGS::DEFAULT_DELAY_TOLERANCE` — `0.1 * IU_PER_PS`. */
export const MEANDER_DEFAULT_DELAY_TOLERANCE = 0.1 * IU_PER_PS;

/** `MEANDER_SETTINGS::DELAY_UNCONSTRAINED`. */
export const MEANDER_DELAY_UNCONSTRAINED = 1000000 * IU_PER_PS;

/** `MEANDER_SETTINGS::SKEW_UNCONSTRAINED` — `std::numeric_limits<int>::max()`. */
export const MEANDER_SKEW_UNCONSTRAINED = 2147483647;

/**
 * `MEANDER_SETTINGS`: the dimensions the meandering algorithm works to.
 *
 * `MINOPTMAX<T>` maps onto the repo's existing {@link MinOptMax}
 * (`pcbnew/src/drc/drc_rule.ts`), which is isomorphic: upstream pairs each
 * value with an `m_hasX` flag, and an absent optional field says the same
 * thing. The accessors below follow `core/minoptmax.h` exactly, including that
 * an absent `Opt` falls back to `Min` rather than to zero.
 *
 * `NETCLASS* m_netClass` becomes a class *name*: the geometry never reads it,
 * and only the placers — which resolve delay profiles through it — will.
 */
export interface MeanderSettings {
  /** Minimum meandering amplitude. */
  minAmplitude: number;
  /** Maximum meandering amplitude. */
  maxAmplitude: number;
  /** Meandering period/spacing. */
  spacing: number;
  /** Amplitude/spacing adjustment step. */
  step: number;
  /** Length pad-to-die. */
  lenPadToDie: number;
  /** Pre-existing length contributed by other nets in the same logical chain. */
  signalExtraLength: number;
  /** Pre-existing delay contributed by other nets in the same logical chain. */
  signalExtraDelay: number;
  targetLength: MinOptMax;
  targetLengthDelay: MinOptMax;
  targetSignalLength: MinOptMax;
  targetSignalLengthDelay: MinOptMax;
  targetSkew: MinOptMax;
  targetSkewDelay: MinOptMax;
  overrideCustomRules: boolean;
  cornerStyle: MeanderStyle;
  /** Rounding percentage (0 - 100). */
  cornerRadiusPercentage: number;
  /** Place meanders on one side only. */
  singleSided: boolean;
  /** Initial side when placing meanders at a segment. */
  initialSide: MeanderSide;
  /** Allowable tuning error. */
  lengthTolerance: number;
  /** Keep vertices between the pre, tuned and post parts of the line. */
  keepEndpoints: boolean;
  isTimeDomain: boolean;
  /** The netclass this meander pattern belongs to, by name. */
  netClass: string | null;
}

/** `MINOPTMAX::Min()` — zero when absent. */
export const minOptMaxMin = (aV: MinOptMax): number => aV.min ?? 0;

/** `MINOPTMAX::Opt()` — falls back to `Min()`, not to zero. */
export const minOptMaxOpt = (aV: MinOptMax): number => aV.opt ?? minOptMaxMin(aV);

/** `MINOPTMAX::Max()` — the type's maximum when absent. */
export const minOptMaxMax = (aV: MinOptMax): number => aV.max ?? Number.MAX_SAFE_INTEGER;

/**
 * `MEANDER_SETTINGS::SetTargetLength( long long int )`.
 *
 * The unconstrained value is not just a big number: it takes its own branch,
 * where the window becomes `[0, unconstrained]` instead of `opt ± tolerance`.
 * A window of `unconstrained ± 0.1 mm` would refuse every line.
 */
export function setTargetLength(aSettings: MeanderSettings, aOpt: number): void {
  aSettings.targetLength = {
    opt: aOpt,
    min: aOpt === MEANDER_LENGTH_UNCONSTRAINED ? 0 : aOpt - MEANDER_DEFAULT_LENGTH_TOLERANCE,
    max: aOpt === MEANDER_LENGTH_UNCONSTRAINED ? aOpt : aOpt + MEANDER_DEFAULT_LENGTH_TOLERANCE,
  };
}

/** `MEANDER_SETTINGS::SetTargetLengthDelay( long long int )`. */
export function setTargetLengthDelay(aSettings: MeanderSettings, aOpt: number): void {
  aSettings.targetLengthDelay = {
    opt: aOpt,
    min: aOpt === MEANDER_DELAY_UNCONSTRAINED ? 0 : aOpt - MEANDER_DEFAULT_DELAY_TOLERANCE,
    max: aOpt === MEANDER_DELAY_UNCONSTRAINED ? aOpt : aOpt + MEANDER_DEFAULT_DELAY_TOLERANCE,
  };
}

/** `MEANDER_SETTINGS::SetTargetSignalLength( long long int )`. */
export function setTargetSignalLength(aSettings: MeanderSettings, aOpt: number): void {
  aSettings.targetSignalLength = {
    opt: aOpt,
    min: aOpt === MEANDER_LENGTH_UNCONSTRAINED ? 0 : aOpt - MEANDER_DEFAULT_LENGTH_TOLERANCE,
    max: aOpt === MEANDER_LENGTH_UNCONSTRAINED ? aOpt : aOpt + MEANDER_DEFAULT_LENGTH_TOLERANCE,
  };
}

/** `MEANDER_SETTINGS::SetTargetSignalLengthDelay( long long int )`. */
export function setTargetSignalLengthDelay(aSettings: MeanderSettings, aOpt: number): void {
  aSettings.targetSignalLengthDelay = {
    opt: aOpt,
    min: aOpt === MEANDER_DELAY_UNCONSTRAINED ? 0 : aOpt - MEANDER_DEFAULT_DELAY_TOLERANCE,
    max: aOpt === MEANDER_DELAY_UNCONSTRAINED ? aOpt : aOpt + MEANDER_DEFAULT_DELAY_TOLERANCE,
  };
}

/**
 * `MEANDER_SETTINGS::SetTargetSkew( int )`.
 *
 * Skew is a length, so the length tolerance is the right one here.
 */
export function setTargetSkew(aSettings: MeanderSettings, aOpt: number): void {
  aSettings.targetSkew = {
    opt: aOpt,
    min: aOpt === MEANDER_SKEW_UNCONSTRAINED ? 0 : aOpt - MEANDER_DEFAULT_LENGTH_TOLERANCE,
    max: aOpt === MEANDER_SKEW_UNCONSTRAINED ? aOpt : aOpt + MEANDER_DEFAULT_LENGTH_TOLERANCE,
  };
}

/**
 * `MEANDER_SETTINGS::SetTargetSkewDelay( int )`.
 *
 * **Upstream oddity #1.** This is a *delay*, and every other delay setter in
 * the file widens by `DEFAULT_DELAY_TOLERANCE`; this one uses
 * `DEFAULT_LENGTH_TOLERANCE` (pns_meander.cpp:222-223). The two constants
 * happen to have the same numeric value — 100000, being 0.1 mm at 1e6 IU/mm and
 * 0.1 ps at 1e6 IU/ps — so nothing observable follows *today*. It would the
 * moment either scale changed. Reproduced by constant name, not by value, so
 * the port breaks the same way upstream would.
 *
 * That also means no test can distinguish the two, and mutation testing agrees:
 * swapping this to `MEANDER_DEFAULT_DELAY_TOLERANCE` is an equivalent mutant
 * while the constants hold the same number. The test in
 * `pns_meander.test.ts` asserts that equality explicitly, so the day the
 * scales diverge it is the test that says so first.
 *
 * The unconstrained sentinel it tests against is `SKEW_UNCONSTRAINED`
 * (`INT_MAX`), not `DELAY_UNCONSTRAINED`, which is upstream's too.
 */
export function setTargetSkewDelay(aSettings: MeanderSettings, aOpt: number): void {
  aSettings.targetSkewDelay = {
    opt: aOpt,
    min: aOpt === MEANDER_SKEW_UNCONSTRAINED ? 0 : aOpt - MEANDER_DEFAULT_LENGTH_TOLERANCE,
    max: aOpt === MEANDER_SKEW_UNCONSTRAINED ? aOpt : aOpt + MEANDER_DEFAULT_LENGTH_TOLERANCE,
  };
}

/**
 * The `MINOPTMAX<int>` overload of each setter: take the constraint's `Opt`
 * through the scalar form above, then let an explicit min or max override the
 * tolerance window.
 */
function applyConstraint(
  aScalarSetter: (aSettings: MeanderSettings, aOpt: number) => void,
  aField: keyof Pick<
    MeanderSettings,
    | 'targetLength'
    | 'targetLengthDelay'
    | 'targetSignalLength'
    | 'targetSignalLengthDelay'
    | 'targetSkew'
    | 'targetSkewDelay'
  >,
  aSettings: MeanderSettings,
  aConstraint: MinOptMax,
): void {
  aScalarSetter(aSettings, minOptMaxOpt(aConstraint));

  if (aConstraint.min !== undefined) aSettings[aField].min = aConstraint.min;
  if (aConstraint.max !== undefined) aSettings[aField].max = aConstraint.max;
}

/** `SetTargetLength( const MINOPTMAX<int>& )`. */
export const setTargetLengthFromConstraint = (a: MeanderSettings, c: MinOptMax): void =>
  applyConstraint(setTargetLength, 'targetLength', a, c);

/** `SetTargetLengthDelay( const MINOPTMAX<int>& )`. */
export const setTargetLengthDelayFromConstraint = (a: MeanderSettings, c: MinOptMax): void =>
  applyConstraint(setTargetLengthDelay, 'targetLengthDelay', a, c);

/** `SetTargetSignalLength( const MINOPTMAX<int>& )`. */
export const setTargetSignalLengthFromConstraint = (a: MeanderSettings, c: MinOptMax): void =>
  applyConstraint(setTargetSignalLength, 'targetSignalLength', a, c);

/** `SetTargetSignalLengthDelay( const MINOPTMAX<int>& )`. */
export const setTargetSignalLengthDelayFromConstraint = (a: MeanderSettings, c: MinOptMax): void =>
  applyConstraint(setTargetSignalLengthDelay, 'targetSignalLengthDelay', a, c);

/** `SetTargetSkew( const MINOPTMAX<int>& )`. */
export const setTargetSkewFromConstraint = (a: MeanderSettings, c: MinOptMax): void =>
  applyConstraint(setTargetSkew, 'targetSkew', a, c);

/** `SetTargetSkewDelay( const MINOPTMAX<int>& )`. */
export const setTargetSkewDelayFromConstraint = (a: MeanderSettings, c: MinOptMax): void =>
  applyConstraint(setTargetSkewDelay, 'targetSkewDelay', a, c);

/** `MEANDER_SETTINGS::MEANDER_SETTINGS()` (pns_meander.cpp:40). */
export function defaultMeanderSettings(): MeanderSettings {
  const s: MeanderSettings = {
    minAmplitude: 200000,
    maxAmplitude: 1000000,
    spacing: 600000,
    step: 50000,
    lenPadToDie: 0,
    signalExtraLength: 0,
    signalExtraDelay: 0,
    targetLength: {},
    targetLengthDelay: {},
    targetSignalLength: {},
    targetSignalLengthDelay: {},
    targetSkew: {},
    targetSkewDelay: {},
    overrideCustomRules: false,
    cornerStyle: MeanderStyle.MEANDER_STYLE_ROUND,
    cornerRadiusPercentage: 80,
    singleSided: false,
    initialSide: MeanderSide.MEANDER_SIDE_LEFT,
    lengthTolerance: 0,
    keepEndpoints: false,
    isTimeDomain: false,
    netClass: null,
  };

  setTargetLength(s, MEANDER_LENGTH_UNCONSTRAINED);
  setTargetLengthDelay(s, MEANDER_DELAY_UNCONSTRAINED);
  setTargetSignalLength(s, MEANDER_LENGTH_UNCONSTRAINED);
  setTargetSignalLengthDelay(s, MEANDER_DELAY_UNCONSTRAINED);
  setTargetSkew(s, 0);
  setTargetSkewDelay(s, 0);

  return s;
}

/** A deep-enough copy for `flipInitialSide`'s copy-modify-push-back. */
export const copyMeanderSettings = (aS: MeanderSettings): MeanderSettings => ({
  ...aS,
  targetLength: { ...aS.targetLength },
  targetLengthDelay: { ...aS.targetLengthDelay },
  targetSignalLength: { ...aS.targetSignalLength },
  targetSignalLengthDelay: { ...aS.targetSignalLengthDelay },
  targetSkew: { ...aS.targetSkew },
  targetSkewDelay: { ...aS.targetSkewDelay },
});

// ---------------------------------------------------------------------------
// The placer, reduced to what the geometry asks of it

/** The four `MEANDER_PLACER_BASE` virtuals `pns_meander.cpp` calls. */
export interface MeanderPlacer {
  /** `MEANDER_PLACER_BASE::MeanderSettings()`. */
  meanderSettings(): MeanderSettings;
  /** `MEANDER_PLACER_BASE::UpdateSettings()`. */
  updateSettings(aSettings: MeanderSettings): void;
  /** `MEANDER_PLACER_BASE::Clearance()` — of the track being tuned, in IU. */
  clearance(): number;
  /** `MEANDER_PLACER_BASE::CheckFit()` — false in the base class. */
  checkFit(aShape: MeanderShape): boolean;
}

/**
 * A placer that answers from fixed settings.
 *
 * `checkFit` defaults to upstream's base-class answer, **false**. Pass one that
 * says otherwise to exercise the fitting loop before the real placers land.
 */
export function basicMeanderPlacer(
  aSettings: MeanderSettings = defaultMeanderSettings(),
  aClearance = 0,
  aCheckFit: (aShape: MeanderShape) => boolean = () => false,
): MeanderPlacer {
  let settings = aSettings;

  return {
    meanderSettings: () => settings,
    updateSettings: (s) => {
      settings = s;
    },
    clearance: () => aClearance,
    checkFit: aCheckFit,
  };
}

// ---------------------------------------------------------------------------
// SHAPE_LINE_CHAIN queries the meander needs, as free functions

/**
 * `SHAPE_LINE_CHAIN::Length()`.
 *
 * Segments that belong to an arc are skipped and each arc contributes its
 * **true** length instead — so a rounded corner measures along the curve, not
 * along the polyline that stands in for it. Summing the polyline instead
 * mis-reports every corner, and a length tuner that mis-reports its own corners
 * tunes to the wrong length.
 *
 * The accumulator is a `long long int` upstream while each arc's `GetLength()`
 * is a `double`, so **the running total is truncated toward zero on every arc
 * added**, not once at the end. For a four-cornered meander that is up to four
 * IU of shortfall, and it is the number the tuner compares against its target —
 * so it is reproduced rather than tidied into a float sum.
 */
export function chainLength(aChain: PnsLineChain): number {
  let l = 0;

  for (let i = 0; i < aChain.segmentCount(); i++) {
    if (!aChain.isArcSegment(i)) {
      const s = aChain.cSegment(i);
      // Both operands are integral already; the truncation is upstream's `+=`
      // onto an int64, written out so the arc loop below reads the same way.
      l = Math.trunc(l + segLength(s));
    }
  }

  for (let i = 0; i < aChain.arcCount(); i++) l = Math.trunc(l + arcLength(aChain.arc(i)));

  return l;
}

/**
 * `SHAPE_LINE_CHAIN_BASE::Collide( const SEG&, int aClearance )` for an open
 * chain, with neither the `aActual` nor the `aLocation` out-parameter.
 *
 * Note the comparison: `d² == 0 || d² < clearance²`. Touching collides, and so
 * does anything strictly inside the clearance — but a gap of *exactly* the
 * clearance does not. The closed-chain shortcut (a segment starting inside the
 * polygon) is skipped, because the meander's chains are open.
 */
export function lineChainCollideSeg(aChain: PnsLineChain, aSeg: Seg, aClearance: number): boolean {
  const clearanceSq = aClearance * aClearance;
  let closestSq = Number.POSITIVE_INFINITY;

  for (let i = 0; i < aChain.segmentCount(); i++) {
    const distSq = segSquaredDistanceToSeg(aChain.cSegment(i), aSeg);

    if (distSq < closestSq) {
      closestSq = distSq;

      if (closestSq === 0) break;

      // Upstream also breaks here when it is not asked for the actual distance.
      if (closestSq < clearanceSq) break;
    }
  }

  return closestSq === 0 || closestSq < clearanceSq;
}

// ---------------------------------------------------------------------------
// MEANDER_SHAPE

const DEG2RAD = (d: number): number => (d * Math.PI) / 180;

/** `tan( DEG2RAD( 22.5 ) )` — half of a 45° chamfer's turn. */
const TAN_22_5 = Math.tan(DEG2RAD(22.5));

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const euclideanNorm = (v: Vec2): number => Math.hypot(v.x, v.y);

/** `int / int` in C++ truncates toward zero. */
const idiv = (a: number, b: number): number => {
  const q = Math.trunc(a / b);
  return q === 0 ? 0 : q;
};

/** `std::clamp`. */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `VECTOR2I::operator/( int )` — per-component integer division. */
const halfPoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: idiv(a.x + b.x, 2),
  y: idiv(a.y + b.y, 2),
});

/**
 * `MEANDER_SHAPE`: the geometry of one meander.
 *
 * The two `m_shapes` are the two lines of a diff pair; a single-ended meander
 * uses only `[0]`, and `[1]` is still written by `MakeCorner`/`MakeArc` because
 * upstream writes it unconditionally.
 */
export class MeanderShape {
  private mType: MeanderType = MeanderType.MT_SINGLE;
  private mPlacer: MeanderPlacer;
  private mDual: boolean;
  private mWidth: number;
  private mAmplitude = 0;
  private mBaselineOffset = 0;
  private mMeanCornerRadius = 0;
  private mTargetBaseLen = 0;
  private mP0: Vec2 = { x: 0, y: 0 };
  private mBaseSeg: Seg = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  private mClippedBaseSeg: Seg = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  private mSide = false;
  private mShapes: [PnsLineChain, PnsLineChain] = [new PnsLineChain(), new PnsLineChain()];
  private mBaseIndex = 0;

  // The turtle's state.
  private mCurrentDir: Vec2 = { x: 0, y: 0 };
  private mCurrentPos: Vec2 = { x: 0, y: 0 };
  private mCurrentTarget: PnsLineChain | null = null;

  /**
   * `MEANDER_SHAPE( MEANDER_PLACER_BASE*, int aWidth, bool aIsDual )`.
   *
   * Every other member is zeroed in the body of upstream's constructor, and the
   * comment there says why: not to leave them uninitialised. The defaults above
   * are those values.
   */
  constructor(aPlacer: MeanderPlacer, aWidth: number, aIsDual = false) {
    this.mPlacer = aPlacer;
    this.mWidth = aWidth;
    this.mDual = aIsDual;
  }

  /** The C++ copy constructor, which `AddMeander( new MEANDER_SHAPE( m ) )` uses. */
  clone(): MeanderShape {
    const m = new MeanderShape(this.mPlacer, this.mWidth, this.mDual);

    m.mType = this.mType;
    m.mAmplitude = this.mAmplitude;
    m.mBaselineOffset = this.mBaselineOffset;
    m.mMeanCornerRadius = this.mMeanCornerRadius;
    m.mTargetBaseLen = this.mTargetBaseLen;
    m.mP0 = { ...this.mP0 };
    m.mBaseSeg = { a: { ...this.mBaseSeg.a }, b: { ...this.mBaseSeg.b } };
    m.mClippedBaseSeg = { a: { ...this.mClippedBaseSeg.a }, b: { ...this.mClippedBaseSeg.b } };
    m.mSide = this.mSide;
    m.mShapes = [this.mShapes[0].clone(), this.mShapes[1].clone()];
    m.mBaseIndex = this.mBaseIndex;
    m.mCurrentDir = { ...this.mCurrentDir };
    m.mCurrentPos = { ...this.mCurrentPos };
    // `m_currentTarget` points into a chain that is going out of scope; upstream
    // copies the raw pointer, and `genMeanderShape` nulls it before returning.
    m.mCurrentTarget = null;

    return m;
  }

  // ----- accessors ---------------------------------------------------------

  setType(aType: MeanderType): void {
    this.mType = aType;
  }

  type(): MeanderType {
    return this.mType;
  }

  setBaseIndex(aIndex: number): void {
    this.mBaseIndex = aIndex;
  }

  baseIndex(): number {
    return this.mBaseIndex;
  }

  amplitude(): number {
    return this.mAmplitude;
  }

  isDual(): boolean {
    return this.mDual;
  }

  /** True when the meander is to the *right* of its base segment. */
  side(): boolean {
    return this.mSide;
  }

  /** `End()`: the end vertex of the clipped base segment. */
  end(): Vec2 {
    return this.mClippedBaseSeg.b;
  }

  /** `CLine( aShape )`. */
  cLine(aShape: number): PnsLineChain {
    return this.mShapes[aShape === 0 ? 0 : 1];
  }

  /** `BaseSegment()`: the segment the meander was fitted to, clipped. */
  baseSegment(): Seg {
    return this.mClippedBaseSeg;
  }

  width(): number {
    return this.mWidth;
  }

  setBaselineOffset(aOffset: number): void {
    this.mBaselineOffset = aOffset;
  }

  baselineOffset(): number {
    return this.mBaselineOffset;
  }

  setTargetBaselineLength(aLength: number): void {
    this.mTargetBaseLen = aLength;
  }

  /** `Settings()`: the placer's, always — a shape has no settings of its own. */
  settings(): MeanderSettings {
    return this.mPlacer.meanderSettings();
  }

  /** The radius `genMeanderShape` last actually used. Read back by `Fit`. */
  meanCornerRadius(): number {
    return this.mMeanCornerRadius;
  }

  // ----- dimensions --------------------------------------------------------

  /**
   * `MEANDER_SHAPE::MinAmplitude()`.
   *
   * **Upstream oddity #2.** The chamfer branch computes
   * `m_width * tan( 1 - tan( DEG2RAD( 22.5 ) ) )` — a tangent applied to the
   * *number* `1 - tan 22.5° = 0.585786`, giving `tan( 0.585786 rad ) = 0.663470`.
   * The evident intent was the bare factor `0.585786`, which is exactly what
   * {@link cornerRadius} below uses for the same geometric correction, in the
   * same file, thirty lines later. Reproduced literally: this decides how far a
   * chamfered meander must bulge before it is allowed to exist, and correcting
   * it would move every chamfered meander KiCad has ever drawn.
   *
   * The rounded branch has no such correction — a 90° arc of radius
   * `|offset| + width` is the tightest that keeps the two lines of a pair
   * apart.
   */
  minAmplitude(): number {
    let minAmplitude = this.settings().minAmplitude;

    if (this.mPlacer.meanderSettings().cornerStyle === MeanderStyle.MEANDER_STYLE_ROUND) {
      minAmplitude = Math.max(minAmplitude, Math.abs(this.mBaselineOffset) + this.mWidth);
    } else {
      const correction = Math.trunc(this.mWidth * Math.tan(1 - TAN_22_5));

      minAmplitude = Math.max(minAmplitude, Math.abs(this.mBaselineOffset) + correction);
    }

    return minAmplitude;
  }

  /**
   * `MEANDER_SHAPE::cornerRadius()`.
   *
   * Four things decide the answer and the order matters:
   *
   *  - a zero-amplitude meander has no corners, and the **short circuit to 0
   *    here is load bearing far away**: `MEANDERED_LINE::MeanderSegment` asks a
   *    freshly-built shape for its corner radius when deciding how far to skip
   *    ahead after a failed fit, and that shape's amplitude is zero. See
   *    oddity #5 in {@link MeanderedLine.meanderSegment};
   *  - `minCr` is what keeps the two lines of a diff pair from touching round
   *    the outside of a corner;
   *  - `maxCr` is bounded both by the amplitude (a corner cannot be deeper than
   *    the bulge) and by the spacing (nor wider than the period);
   *  - and when those two cross — a tight amplitude against a fat track —
   *    upstream logs and returns `maxCr`, i.e. it prefers *violating the
   *    minimum* to violating the geometry.
   *
   * `m_width / 2` is an integer division that happens **before** the chamfer
   * factor multiplies it, so an odd width loses its half IU first.
   */
  cornerRadius(): number {
    if (this.mAmplitude === 0) return 0;

    let minCr = 0;

    if (this.mPlacer.meanderSettings().cornerStyle === MeanderStyle.MEANDER_STYLE_ROUND) {
      minCr = Math.abs(this.mBaselineOffset) + idiv(this.mWidth, 2);
    } else {
      minCr = Math.trunc(Math.abs(this.mBaselineOffset) + idiv(this.mWidth, 2) * (1 - TAN_22_5));
    }

    const maxCr1 = idiv(this.mAmplitude + Math.abs(this.mBaselineOffset), 2);
    const maxCr2 = idiv(this.spacing(), 2);
    const maxCr = Math.min(maxCr1, maxCr2);

    // `wxCHECK2_MSG( maxCr >= minCr, return maxCr, … )`: a diagnostic in a debug
    // build, a plain early return in a release one.
    if (maxCr < minCr) return maxCr;

    const rPercent = this.settings().cornerRadiusPercentage;
    // `spacing() * rPercent / 200` — 200 rather than 100 because the percentage
    // is of the *half* period. Integer division, truncating.
    const optCr = Math.trunc((this.spacing() * rPercent) / 200);

    return clamp(optCr, minCr, maxCr);
  }

  /**
   * `MEANDER_SHAPE::spacing()`: the meander period, never closer than the
   * track can legally come to itself.
   *
   * For a diff pair the two lines sit `2 * |offset|` apart across the baseline,
   * and that whole span has to clear the neighbouring meander — hence the extra
   * term rather than a second clearance.
   */
  spacing(): number {
    if (!this.mDual) {
      return Math.max(this.mWidth + this.mPlacer.clearance(), this.settings().spacing);
    }

    const sp = this.mWidth + this.mPlacer.clearance() + 2 * Math.abs(this.mBaselineOffset);

    return Math.max(sp, this.settings().spacing);
  }

  // ----- the turtle --------------------------------------------------------

  /** `start()`: point the turtle, and clear whatever it was drawing on. */
  private start(aTarget: PnsLineChain, aWhere: Vec2, aDir: Vec2): void {
    this.mCurrentTarget = aTarget;
    this.mCurrentTarget.clear();
    // `Append( const VECTOR2I& )` with a VECTOR2D argument: the conversion
    // truncates toward zero.
    this.mCurrentTarget.appendPoint(truncVec(aWhere));
    this.mCurrentDir = { ...aDir };
    this.mCurrentPos = { ...aWhere };
  }

  /**
   * `forward()`: step along the current direction.
   *
   * The `< 5` guard is upstream's, and its comment says only "very small
   * segments cause problems". Two consequences worth naming: it silently drops
   * a **negative** step, which is how a `top` or `startSide` that has gone
   * negative under a tight amplitude fails to shorten the shape; and it makes
   * the turtle's position and the chain's last point diverge for exactly the
   * skipped move — the position is *not* advanced either, so nothing is lost,
   * only unrepresented.
   */
  private forward(aLength: number): void {
    if (aLength < 5) return;

    this.mCurrentPos = add(this.mCurrentPos, resizeD(this.mCurrentDir, aLength));
    (this.mCurrentTarget as PnsLineChain).appendPoint(truncVec(this.mCurrentPos));
  }

  /** `turn()`: rotate the heading. The VECTOR2D overload does not round. */
  private turn(aAngle: EDA_ANGLE): void {
    this.mCurrentDir = RotatePointD(this.mCurrentDir, aAngle);
  }

  /**
   * `miter()`: draw a corner of the configured style and turn 90°.
   *
   * A non-positive radius draws *nothing at all* and only turns — which is what
   * makes a meander with `cornerRadius() == 0` come out as square corners
   * rather than as a degenerate curve.
   *
   * ## That arm is unreachable for any track of positive width
   *
   * Untested on purpose, and mutation testing says so: swapping the two turn
   * directions inside it changes no result. The algebra is that
   * `genMeanderShape` only ever passes `sCorner = cr - offset` or
   * `uCorner = cr + offset`, and `cornerRadius()`'s floor is
   * `minCr = |offset| + width/2`, which strictly exceeds `|offset|` whenever
   * the width is positive. The one escape from that floor is the
   * `maxCr < minCr` early return, and `maxCr` is bounded below by
   * `spacing()/2 >= (width + clearance)/2 + |offset|` — again strictly past
   * `|offset|`. So both corners stay strictly positive, and only a
   * **zero-width** line can reach the branch. Left as upstream writes it rather
   * than pinned by a test of a track that cannot exist.
   *
   * Note the order: the turtle is moved to the corner's far end **before** the
   * corner is appended, and the turn happens between the two. Upstream's, and
   * it matters only in that `m_currentPos` is the *integer* last point of the
   * mitre chain from here on, so the accumulated double position is re-snapped
   * to the grid at every corner.
   */
  private miter(aRadius: number, aSide: boolean): void {
    if (aRadius <= 0) {
      this.turn(aSide ? ANGLE_90 : ANGLE_90.negate());
      return;
    }

    const dir = resizeD(this.mCurrentDir, aRadius);
    const lc = this.makeMiterShape(this.mCurrentPos, dir, aSide);

    this.mCurrentPos = { ...lc.cLastPoint() };
    this.turn(aSide ? ANGLE_90 : ANGLE_90.negate());

    (this.mCurrentTarget as PnsLineChain).appendChain(lc);
  }

  /** `uShape()`: side, corner, top, corner, side. */
  private uShape(aSides: number, aCorner: number, aTop: number): void {
    this.forward(aSides);
    this.miter(aCorner, true);
    this.forward(aTop);
    this.miter(aCorner, true);
    this.forward(aSides);
  }

  /**
   * `makeMiterShape()`: one corner, as an arc or as a chamfer.
   *
   * `aDir` is already scaled to the corner radius by {@link miter}, so it is
   * both the heading and the size. A zero-length one has no corner to make and
   * degenerates to the point itself.
   *
   * The chamfer's correction only exists for diff pairs, and only on corners
   * bigger than the shape's mean radius: the *outer* line of a pair travels
   * further round a chamfered corner than the inner one, and pulling its
   * entry point back by `2 * |offset| * tan 22.5°` is what keeps the two the
   * same length. `m_meanCornerRadius` is written by `genMeanderShape` before
   * any mitre runs, so the comparison is against this shape's own radius.
   */
  private makeMiterShape(aP: Vec2, aDir: Vec2, aSide: boolean): PnsLineChain {
    const lc = new PnsLineChain();

    if (euclideanNorm(aDir) === 0.0) {
      lc.appendPoint(truncVec(aP));
      return lc;
    }

    const dirU = aDir;
    const dirV = perpendicular(aDir);
    const s = aSide ? -1.0 : 1.0;

    const endPoint = {
      x: aP.x + dirU.x + dirV.x * s,
      y: aP.y + dirU.y + dirV.y * s,
    };

    lc.appendPoint(truncVec(aP));

    switch (this.mPlacer.meanderSettings().cornerStyle) {
      case MeanderStyle.MEANDER_STYLE_ROUND: {
        const arcEnd = truncVec(endPoint);
        const arc = constructArcFromStartEndAngle(
          truncVec(aP),
          arcEnd,
          aSide ? ANGLE_90.negate() : ANGLE_90,
        );

        lc.appendArc(arc, arcConvertToPolyline(arc, ARC_POLYGONIZATION_MAX_ERROR));
        break;
      }

      case MeanderStyle.MEANDER_STYLE_CHAMFER: {
        const radius = euclideanNorm(aDir);
        let correction = 0;

        if (this.mDual && radius > this.mMeanCornerRadius) {
          correction = -2 * Math.abs(this.mBaselineOffset) * TAN_22_5;
        }

        const dirCu = resizeD(dirU, correction);
        const dirCv = resizeD(dirV, correction);

        lc.appendPoint(truncVec(sub(aP, dirCu)));
        lc.appendPoint(
          truncVec({
            x: aP.x + dirU.x + (dirV.x + dirCv.x) * s,
            y: aP.y + dirU.y + (dirV.y + dirCv.y) * s,
          }),
        );
        lc.appendPoint(truncVec(endPoint));
        break;
      }

      default:
        break;
    }

    return lc;
  }

  // ----- the shapes --------------------------------------------------------

  /**
   * `MEANDER_SHAPE::genMeanderShape()`: the trombone itself.
   *
   * Read the five derived lengths as a budget for the meander's outline:
   *
   * ```
   *          top = spc - 2*cr
   *        ┌───────────────┐
   *        │               │  startSide = amplitude - 2*cr + |offset|
   *        │               │
   *   ─────┘               └─────   sCorner = cr - offset  (the entry mitres)
   *                                 uCorner = cr + offset  (the two top mitres)
   * ```
   *
   * `offset` is signed and flips with the side, which is the whole mechanism by
   * which the two lines of a diff pair get different corner radii on the inside
   * and the outside of the same bend: the inner line's corners shrink by the
   * offset exactly as much as the outer line's grow.
   *
   * The three clamps before `m_meanCornerRadius` is recorded bound the radius
   * by the amplitude, then by the spacing, then floor it at the offset.
   *
   * **The first two commute**, and mutation testing confirms it: swapping them
   * changes nothing, because each writes `floor(bound / 2)` and so leaves
   * `2 * cr <= bound` behind it. Whichever runs second therefore sees a value
   * already inside the first bound, and both orders land on
   * `min( cr, floor(K/2), floor(spc/2) )`. Kept in upstream's order for
   * readability against the source, not because it decides anything — an
   * earlier draft of this comment claimed it was load bearing and that was
   * wrong. The **third** clamp does not commute with either: it raises `cr`
   * rather than lowering it.
   *
   * `targetBaseLen` is the resizing hook: when set, each type stretches its
   * `top` so that the meander spans a *given* baseline length rather than the
   * natural `2 * spc`. Each type computes that stretch differently because each
   * accounts for a different number of corners.
   *
   * Finally, a right-side meander is generated on the left and **mirrored**
   * about the base line. That is why every arc in the chain has to survive the
   * mirror as an arc — see `PnsLineChain.mirror`.
   */
  private genMeanderShape(
    aP: Vec2,
    aDir: Vec2,
    aSide: boolean,
    aType: MeanderType,
    aBaselineOffset = 0,
  ): PnsLineChain {
    let cr = this.cornerRadius();
    let offset = aBaselineOffset;
    const spc = this.spacing();
    const amplitude = this.mAmplitude;
    const targetBaseLen = this.mTargetBaseLen;

    if (aSide) offset *= -1;

    const dirUb = resizeD(aDir, offset);
    const dirVb = perpendicular(dirUb);

    if (2 * cr > amplitude + Math.abs(offset)) cr = idiv(amplitude + Math.abs(offset), 2);

    if (2 * cr > spc) cr = idiv(spc, 2);

    if (cr - offset < 0) cr = offset;

    this.mMeanCornerRadius = cr;

    const sCorner = cr - offset;
    const uCorner = cr + offset;
    const startSide = amplitude - 2 * cr + Math.abs(offset);
    const turnSide = amplitude - cr;
    let top = spc - 2 * cr;

    const lc = new PnsLineChain();

    this.start(lc, add(aP, dirVb), aDir);

    switch (aType) {
      case MeanderType.MT_EMPTY:
        lc.appendPoint(truncVec(add(add(aP, dirVb), aDir)));
        break;

      case MeanderType.MT_START:
        if (targetBaseLen) top = Math.max(top, targetBaseLen - sCorner - uCorner * 2 + offset);

        this.miter(sCorner, false);
        this.uShape(startSide, uCorner, top);
        this.forward(Math.min(sCorner, uCorner));
        this.forward(Math.abs(offset));
        break;

      case MeanderType.MT_FINISH: {
        if (targetBaseLen) top = Math.max(top, targetBaseLen - cr - spc);

        // A second `start()`, which clears the chain — the header `start()`
        // above is discarded for this type and for MT_TURN.
        this.start(lc, sub(aP, dirUb), aDir);
        this.turn(ANGLE_90.negate());
        this.forward(Math.min(sCorner, uCorner));
        this.forward(Math.abs(offset));
        this.uShape(startSide, uCorner, top);
        this.miter(sCorner, false);

        const reach = targetBaseLen >= spc + cr ? targetBaseLen : 2 * spc - cr;

        lc.appendPoint(truncVec(add(add(aP, dirVb), resizeD(aDir, reach))));
        break;
      }

      case MeanderType.MT_TURN:
        if (targetBaseLen) top = Math.max(top, targetBaseLen - uCorner * 2 + offset * 2);

        this.start(lc, sub(aP, dirUb), aDir);
        this.turn(ANGLE_90.negate());
        this.forward(Math.abs(offset));
        this.uShape(turnSide, uCorner, top);
        this.forward(Math.abs(offset));
        break;

      case MeanderType.MT_SINGLE:
        if (targetBaseLen) top = Math.max(top, idiv(targetBaseLen - sCorner * 2 - uCorner * 2, 2));

        this.miter(sCorner, false);
        this.uShape(startSide, uCorner, top);
        this.miter(sCorner, false);
        lc.appendPoint(truncVec(add(add(aP, dirVb), resizeD(aDir, 2 * spc))));
        break;

      default:
        break;
    }

    if (aSide) {
      const axis: Seg = { a: truncVec(aP), b: truncVec(add(aP, aDir)) };

      lc.mirror(axis);
    }

    // Upstream clears the pointer to avoid it dangling once `lc` goes out of
    // scope. Kept, because it is what makes a later stray `forward()` a crash
    // rather than a silent write into a dead chain.
    this.mCurrentTarget = null;

    return lc;
  }

  /**
   * `MEANDER_SHAPE::Fit()`: find the largest amplitude that fits, or fail.
   *
   * The two `MT_CHECK_*` types are not shapes; they are the question "could a
   * `START` here be followed by a `TURN`, and would both fit?". They are asked
   * before committing to a run of turns, because a start with nowhere to turn
   * leaves a half-meander hanging off the end of a segment.
   *
   * The search walks the amplitude **down** from the maximum in `m_step`
   * increments, so the first fit found is the largest — a meander wants to be
   * as tall as it is allowed, since a taller one buys more length per unit of
   * baseline. Upstream has no guard against a zero `m_step`, which would spin
   * here forever; neither does this, deliberately.
   */
  fit(aType: MeanderType, aSeg: Seg, aP: Vec2, aSide: boolean): boolean {
    const st = this.settings();

    let checkMode = false;
    let prim1 = MeanderType.MT_EMPTY;
    let prim2 = MeanderType.MT_EMPTY;

    if (aType === MeanderType.MT_CHECK_START) {
      prim1 = MeanderType.MT_START;
      prim2 = MeanderType.MT_TURN;
      checkMode = true;
    } else if (aType === MeanderType.MT_CHECK_FINISH) {
      prim1 = MeanderType.MT_TURN;
      prim2 = MeanderType.MT_FINISH;
      checkMode = true;
    }

    if (checkMode) {
      const m1 = new MeanderShape(this.mPlacer, this.mWidth, this.mDual);
      const m2 = new MeanderShape(this.mPlacer, this.mWidth, this.mDual);

      m1.setBaselineOffset(this.mBaselineOffset);
      m2.setBaselineOffset(this.mBaselineOffset);

      const c1 = m1.fit(prim1, aSeg, aP, aSide);
      // The second probe starts where the first ended, on the *other* side.
      const c2 = c1 ? m2.fit(prim2, aSeg, m1.end(), !aSide) : false;

      if (c1 && c2) {
        this.mType = prim1;
        this.mShapes[0] = m1.mShapes[0];
        this.mShapes[1] = m1.mShapes[1];
        // **Upstream oddity #3.** Overwritten four lines down by
        // `m_baseSeg = m1.m_baseSeg`, which holds the same segment. Dead, and
        // kept so the port reads like the source.
        this.mBaseSeg = aSeg;
        this.mP0 = aP;
        this.mSide = aSide;
        this.mAmplitude = m1.amplitude();
        this.mDual = m1.mDual;
        this.mBaseSeg = m1.mBaseSeg;
        // **Upstream oddity #4.** `m1` was default-constructed, so its base
        // index is 0 — and this *wipes* whatever `SetBaseIndex()` put here.
        // Every meander produced through a check-mode fit therefore reports
        // base index 0, whichever segment of the line it actually sits on.
        this.mBaseIndex = m1.mBaseIndex;
        this.updateBaseSegment();
        this.mBaselineOffset = m1.mBaselineOffset;
        return true;
      }

      return false;
    }

    const minAmpl = this.minAmplitude();
    const maxAmpl = Math.max(st.maxAmplitude, minAmpl);

    // Calculate the minimum acceptable corner radius for visible rounding. Use
    // at least half the track width so curves are noticeably rounded — smaller
    // values leave corners that look nearly square, which is a problem for
    // high-speed nets where a 90° corner causes reflections. (Upstream's
    // comment, for issue #8629.)
    const minCornerRadius = idiv(this.mWidth, 2);

    for (let ampl = maxAmpl; ampl >= minAmpl; ampl -= st.step) {
      this.mAmplitude = ampl;

      const dir = sub(aSeg.b, aSeg.a);

      if (this.mDual) {
        this.mShapes[0] = this.genMeanderShape(aP, dir, aSide, aType, this.mBaselineOffset);
        this.mShapes[1] = this.genMeanderShape(aP, dir, aSide, aType, -this.mBaselineOffset);
      } else {
        this.mShapes[0] = this.genMeanderShape(aP, dir, aSide, aType, 0);
      }

      this.mType = aType;
      this.mBaseSeg = aSeg;
      this.mP0 = aP;
      this.mSide = aSide;

      this.updateBaseSegment();

      // `m_meanCornerRadius` is what `genMeanderShape` actually used, after its
      // three clamps — not what `cornerRadius()` asked for.
      if (this.mMeanCornerRadius < minCornerRadius) continue;

      if (this.mPlacer.checkFit(this)) return true;
    }

    return false;
  }

  /** `MEANDER_SHAPE::Recalculate()`: redraw at the current parameters. */
  recalculate(): void {
    const dir = sub(this.mBaseSeg.b, this.mBaseSeg.a);

    this.mShapes[0] = this.genMeanderShape(
      this.mP0,
      dir,
      this.mSide,
      this.mType,
      this.mDual ? this.mBaselineOffset : 0,
    );

    if (this.mDual) {
      this.mShapes[1] = this.genMeanderShape(
        this.mP0,
        dir,
        this.mSide,
        this.mType,
        -this.mBaselineOffset,
      );
    }

    this.updateBaseSegment();
  }

  /**
   * `MEANDER_SHAPE::Resize()`: change the amplitude and redraw.
   *
   * A negative amplitude is refused outright rather than clamped, so the shape
   * keeps whatever it had. The floor at `MinAmplitude()` is issue #8629's fix:
   * shrinking past it produces corner radii too small to round.
   */
  resize(aAmpl: number): void {
    if (aAmpl < 0) return;

    this.mAmplitude = Math.max(aAmpl, this.minAmplitude());

    this.recalculate();
  }

  /**
   * `MEANDER_SHAPE::MakeEmpty()`: replace the meander with a straight bypass.
   *
   * `updateBaseSegment()` runs **first**, off the shapes that are about to be
   * thrown away — that is how the bypass learns how much baseline the meander
   * used to span. It is deliberately *not* re-run afterwards, so the clipped
   * base segment continues to describe the old extent.
   */
  makeEmpty(): void {
    this.updateBaseSegment();

    const dir = sub(this.mClippedBaseSeg.b, this.mClippedBaseSeg.a);

    this.mType = MeanderType.MT_EMPTY;
    this.mAmplitude = 0;

    this.mShapes[0] = this.genMeanderShape(
      this.mP0,
      dir,
      this.mSide,
      this.mType,
      this.mDual ? this.mBaselineOffset : 0,
    );

    if (this.mDual) {
      this.mShapes[1] = this.genMeanderShape(
        this.mP0,
        dir,
        this.mSide,
        this.mType,
        -this.mBaselineOffset,
      );
    }
  }

  /**
   * `MEANDER_SHAPE::MakeCorner()`: a dummy meander marking a line corner.
   *
   * The clipped base segment collapses to a *zero-length* segment at `aP1`,
   * which is what makes a corner contribute no baseline and lets
   * `MEANDERED_LINE` splice corners between meanders without moving anything.
   * `aP2` is written into shape 1 whether or not this is a dual meander.
   */
  makeCorner(aP1: Vec2, aP2: Vec2 = { x: 0, y: 0 }): void {
    this.setType(MeanderType.MT_CORNER);
    this.mShapes[0].clear();
    this.mShapes[1].clear();
    this.mShapes[0].appendPoint(aP1);
    this.mShapes[1].appendPoint(aP2);
    this.mClippedBaseSeg = { a: { ...aP1 }, b: { ...aP1 } };
  }

  /**
   * `MEANDER_SHAPE::MakeArc()`: a dummy meander carrying an existing arc track,
   * so the arc survives length tuning and can be put back afterwards.
   *
   * Two things upstream does that look like slips and are not: the type is
   * `MT_CORNER`, **not** `MT_ARC` — so `CheckSelfIntersections` skips it along
   * with the other corners — and the clipped base segment anchors at
   * `aArc1.GetP1()`, the arc's *end*, not its start.
   */
  makeArc(
    aArc1: ShapeArc,
    aArc2: ShapeArc = { p0: { x: 0, y: 0 }, arcMid: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, width: 0 },
  ): void {
    this.setType(MeanderType.MT_CORNER);
    this.mShapes[0].clear();
    this.mShapes[1].clear();
    this.mShapes[0].appendArc(aArc1, arcConvertToPolyline(aArc1, ARC_POLYGONIZATION_MAX_ERROR));
    this.mShapes[1].appendArc(aArc2, arcConvertToPolyline(aArc2, ARC_POLYGONIZATION_MAX_ERROR));
    this.mClippedBaseSeg = { a: { ...aArc1.p1 }, b: { ...aArc1.p1 } };
  }

  /** `BaselineLength()`: how much of the base segment the meander spans. */
  baselineLength(): number {
    return segLength(this.mClippedBaseSeg);
  }

  /** `CurrentLength()`: the drawn length of line 0, arcs measured as arcs. */
  currentLength(): number {
    return chainLength(this.cLine(0));
  }

  /**
   * `MinTunableLength()`: the length this meander would have at its minimum
   * amplitude *while still spanning the same baseline*.
   *
   * The baseline is pinned first, on a **copy**, precisely so that shrinking
   * the amplitude does not also shrink the footprint — the question being asked
   * is "how little length can this meander contribute without moving its
   * neighbours", and a meander that shrank its baseline would move them.
   */
  minTunableLength(): number {
    const copy = this.clone();

    copy.setTargetBaselineLength(this.baselineLength());
    copy.resize(copy.minAmplitude());

    return copy.currentLength();
  }

  /**
   * `updateBaseSegment()`: re-derive the clipped base segment by projecting the
   * drawn shape's two ends back onto the base line.
   *
   * For a diff pair the projection is of the *midpoint* between the two lines,
   * which is the only point that is on the baseline for both. `(a + b) / 2` is
   * `VECTOR2I`'s integer division, truncating toward zero per component — so
   * the midpoint of -1 and 0 is 0, not -1.
   */
  private updateBaseSegment(): void {
    if (this.mDual) {
      const midpA = halfPoint(this.cLine(0).cPoint(0), this.cLine(1).cPoint(0));
      const midpB = halfPoint(this.cLine(0).cLastPoint(), this.cLine(1).cLastPoint());

      this.mClippedBaseSeg = {
        a: segLineProject(this.mBaseSeg, midpA),
        b: segLineProject(this.mBaseSeg, midpB),
      };
    } else {
      this.mClippedBaseSeg = {
        a: segLineProject(this.mBaseSeg, this.cLine(0).cPoint(0)),
        b: segLineProject(this.mBaseSeg, this.cLine(0).cLastPoint()),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// MEANDERED_LINE

/**
 * `MEANDERED_LINE`: the meanders and corners fitted over one line, in order.
 *
 * Upstream owns raw `MEANDER_SHAPE*` and deletes them in `Clear()` and the
 * destructor; here the array simply drops them. What is *not* dropped is the
 * aliasing that ownership implies: {@link meanders} hands back the live array,
 * and the tuner resizes the shapes in it in place.
 */
export class MeanderedLine {
  private mLast: Vec2 = { x: 0, y: 0 };
  private mPlacer: MeanderPlacer;
  private mMeanders: MeanderShape[] = [];
  private mDual: boolean;
  private mWidth = 0;
  private mBaselineOffset = 0;

  constructor(aPlacer: MeanderPlacer, aIsDual = false) {
    this.mPlacer = aPlacer;
    this.mDual = aIsDual;
  }

  /** `Settings()`: the placer's. */
  settings(): MeanderSettings {
    return this.mPlacer.meanderSettings();
  }

  setWidth(aWidth: number): void {
    this.mWidth = aWidth;
  }

  setBaselineOffset(aOffset: number): void {
    this.mBaselineOffset = aOffset;
  }

  /** `Meanders()`: the live array, as upstream hands back a reference. */
  meanders(): MeanderShape[] {
    return this.mMeanders;
  }

  /** The last point the line has reached — `m_last`. */
  last(): Vec2 {
    return this.mLast;
  }

  /** `AddCorner()`. Note it moves `m_last` to `aA`, not past it. */
  addCorner(aA: Vec2, aB: Vec2 = { x: 0, y: 0 }): void {
    const m = new MeanderShape(this.mPlacer, this.mWidth, this.mDual);

    m.makeCorner(aA, aB);
    this.mLast = { ...aA };

    this.mMeanders.push(m);
  }

  /** `AddArc()`. `m_last` goes to the arc's **start**, unlike `MakeArc`'s anchor. */
  addArc(aArc1: ShapeArc, aArc2?: ShapeArc): void {
    const m = new MeanderShape(this.mPlacer, this.mWidth, this.mDual);

    m.makeArc(aArc1, aArc2);
    this.mLast = { ...aArc1.p0 };

    this.mMeanders.push(m);
  }

  /** `AddArcAndPt()`: a zero-radius arc stands in for the second line's point. */
  addArcAndPt(aArc1: ShapeArc, aPt2: Vec2): void {
    this.addArc(aArc1, { p0: { ...aPt2 }, arcMid: { ...aPt2 }, p1: { ...aPt2 }, width: 0 });
  }

  /** `AddPtAndArc()`. */
  addPtAndArc(aPt1: Vec2, aArc2: ShapeArc): void {
    this.addArc({ p0: { ...aPt1 }, arcMid: { ...aPt1 }, p1: { ...aPt1 }, width: 0 }, aArc2);
  }

  /** `AddMeander()`: `m_last` jumps to the end of the shape's base segment. */
  addMeander(aShape: MeanderShape): void {
    this.mLast = { ...aShape.baseSegment().b };
    this.mMeanders.push(aShape);
  }

  /** `Clear()`. */
  clear(): void {
    this.mMeanders = [];
  }

  /**
   * `MEANDERED_LINE::CheckSelfIntersections()`: would `aShape` collide with a
   * meander already on this line?
   *
   * Both walks run **backwards**, which is not cosmetic: the meanders nearest
   * the new shape are the ones most likely to hit it, and the loop returns on
   * the first hit, so searching from the end finds it soonest.
   *
   * The `ApproxParallel` skip is what makes this cheap and correct at once. Two
   * meanders on the *same* base segment share a baseline and are laid out not
   * to overlap by construction; only meanders on segments running at an angle
   * to each other — at a corner of the routed line — can genuinely intersect.
   * Corners and emptied meanders have no body to hit and are skipped outright.
   */
  checkSelfIntersections(aShape: MeanderShape, aClearance: number): boolean {
    for (let i = this.mMeanders.length - 1; i >= 0; i--) {
      const m = this.mMeanders[i] as MeanderShape;

      if (m.type() === MeanderType.MT_EMPTY || m.type() === MeanderType.MT_CORNER) continue;

      const b1 = aShape.baseSegment();
      const b2 = m.baseSegment();

      if (segApproxParallel(b1, b2)) continue;

      const n = m.cLine(0).segmentCount();

      for (let j = n - 1; j >= 0; j--) {
        if (lineChainCollideSeg(aShape.cLine(0), m.cLine(0).cSegment(j), aClearance)) return false;
      }
    }

    return true;
  }

  /**
   * `MEANDERED_LINE::MeanderSegment()`: fill one base segment with as many
   * meanders as will fit.
   *
   * The state machine is two flags. `turning` says a run of alternating turns
   * is open and must be finished before the segment ends; `started` says at
   * least one meander of the current run has been laid, which is what decides
   * whether flipping to the other side counts as choosing the *initial* side
   * (and so should be written back into the settings) or merely as this
   * meander going the other way.
   *
   * Three thresholds carve up the remaining baseline, and they are not the same
   * number:
   *
   *  - `< m_step` — nothing worth doing, stop;
   *  - `> 3 * spacing` — room for a start *and* the turn that must follow it,
   *    so open or continue a run;
   *  - `> 2 * spacing` — room for one standalone meander only.
   *
   * Between `2 * spacing` and `3 * spacing` with a run open, the run is closed
   * with an `MT_FINISH` and the segment ends there — a run cannot be left
   * hanging.
   */
  meanderSegment(aBase: Seg, aSide: boolean, aBaseIndex = 0): void {
    const baseLen = segLength(aBase);

    const singleSided = this.settings().singleSided;
    let side = aSide;
    const dir = sub(aBase.b, aBase.a);

    if (!this.mDual) this.addCorner(aBase.a);

    let turning = false;
    let started = false;

    this.mLast = { ...aBase.a };

    for (;;) {
      const m = new MeanderShape(this.mPlacer, this.mWidth, this.mDual);

      m.setBaselineOffset(this.mBaselineOffset);
      m.setBaseIndex(aBaseIndex);

      const thr = m.spacing();

      let fail = false;
      let remaining = baseLen - euclideanNorm(sub(this.mLast, aBase.a));

      // Push the *initial* side back into the placer's settings, so the next
      // segment of the line starts where this one had to go.
      const flipInitialSide = (): void => {
        const settings = copyMeanderSettings(this.mPlacer.meanderSettings());
        settings.initialSide = -settings.initialSide as MeanderSide;
        this.mPlacer.updateSettings(settings);
      };

      const addSingleIfFits = (): void => {
        fail = true;

        if (m.fit(MeanderType.MT_SINGLE, aBase, this.mLast, side)) {
          this.addMeander(m.clone());
          fail = false;
          started = false;
        }

        if (fail && !singleSided) {
          if (m.fit(MeanderType.MT_SINGLE, aBase, this.mLast, !side)) {
            if (!started) flipInitialSide();

            this.addMeander(m.clone());
            fail = false;
            started = false;
            side = !side;
          }
        }
      };

      if (remaining < this.settings().step) break;

      if (!singleSided && remaining > 3.0 * thr) {
        if (!turning) {
          for (let i = 0; i < 2; i++) {
            const checkSide = i === 0 ? side : !side;

            if (m.fit(MeanderType.MT_CHECK_START, aBase, this.mLast, checkSide)) {
              if (!started && checkSide !== side) flipInitialSide();

              turning = true;
              this.addMeander(m.clone());
              side = !checkSide;
              started = true;
              break;
            }
          }

          if (!turning) addSingleIfFits();
        } else {
          const rv = m.fit(MeanderType.MT_CHECK_FINISH, aBase, this.mLast, side);

          if (rv) {
            // **Upstream oddity #6.** The return value is discarded: if this
            // re-fit fails, `m` still holds whatever the CHECK_FINISH probe
            // left in it, and it is added anyway.
            m.fit(MeanderType.MT_TURN, aBase, this.mLast, side);
            this.addMeander(m.clone());
            side = !side;
            started = true;
          } else {
            m.fit(MeanderType.MT_FINISH, aBase, this.mLast, side);
            started = false;
            this.addMeander(m.clone());
            turning = false;
          }
        }
      } else if (!singleSided && started) {
        const rv = m.fit(MeanderType.MT_FINISH, aBase, this.mLast, side);

        if (rv) this.addMeander(m.clone());

        break;
      } else if (!turning && remaining > thr * 2.0) {
        addSingleIfFits();
      } else {
        fail = true;
      }

      // Recomputed: `addMeander` has moved `m_last` if anything was placed.
      remaining = baseLen - euclideanNorm(sub(this.mLast, aBase.a));

      if (remaining < this.settings().step) break;

      if (fail) {
        const tmp = new MeanderShape(this.mPlacer, this.mWidth, this.mDual);

        tmp.setBaselineOffset(this.mBaselineOffset);
        tmp.setBaseIndex(aBaseIndex);

        // **Upstream oddity #5.** `tmp` is freshly built, so its amplitude is
        // zero and `cornerRadius()` short-circuits to 0 — the `- 2 * …` term is
        // dead and the advance is always `spacing() + m_step`. Reproduced
        // rather than "fixed": the skip distance decides where the corner that
        // marks a failed stretch of baseline goes, and changing it would move
        // every such corner.
        const nextP = tmp.spacing() - 2 * tmp.cornerRadius() + this.settings().step;
        const pn = truncVec(add(this.mLast, resizeD(dir, nextP)));

        if (segContains(aBase, pn) && !this.mDual) this.addCorner(pn);
        else break;
      }
    }

    if (!this.mDual) this.addCorner(aBase.b);
  }
}
