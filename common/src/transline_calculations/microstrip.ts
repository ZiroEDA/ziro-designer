// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Microstrip, faithful port of KiCad's `transline_calculations/microstrip.cpp`:
 * Hammerstad-Jensen static Z0/εeff with thickness correction, Kirschning-Jansen
 * dispersion, March covered-microstrip terms, and conductor/dielectric loss.
 * Cover height and surface roughness default to their no-cover / smooth limits
 * (the panel does not expose them), matching KiCad's default output.
 * Counterpart: KiCad `common/transline_calculations/microstrip.cpp`.
 */

import {
  C0,
  LOG2DB,
  type SoldermaskParams,
  type TcElectrical,
  ZF0,
  applySoldermaskCorrection,
  microstripSoldermaskDeltaQ,
  skinDepth,
  unitPropagationDelay,
  type TranslineAnalysis,
} from './tc_common.js';

export interface MicrostripPhysical {
  /** Trace width, m. */
  widthM: number;
  /** Substrate height, m. */
  heightM: number;
  /** Copper thickness, m. */
  thicknessM: number;
  /** Line length, m. */
  lengthM: number;
  /** Cover (top ground) height above the trace, m. Infinity = no cover. */
  coverHeightM?: number;
  /** RMS surface roughness, m (0 = smooth). */
  roughM?: number;
}

export interface MicrostripResult extends TranslineAnalysis {
  /** Static (undispersed) effective permittivity, for reference. */
  epsEffStatic: number;
  /** Static (undispersed) characteristic impedance, Ω (KiCad Z0_0). */
  z0Static: number;
}

// --- Hammerstad-Jensen building blocks (KiCad names kept) ---

function z0Homogeneous(u: number): number {
  const fu = 6.0 + (2.0 * Math.PI - 6.0) * Math.exp(-((30.666 / u) ** 0.7528));
  return (ZF0 / (2.0 * Math.PI)) * Math.log(fu / u + Math.sqrt(1.0 + 4.0 / (u * u)));
}

function fillingFactor(u: number, er: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const a =
    1.0 + Math.log((u4 + u2 / 2704) / (u4 + 0.432)) / 49.0 + Math.log(1.0 + u3 / 5929.741) / 18.7;
  const b = 0.564 * ((er - 0.9) / (er + 3.0)) ** 0.053;
  return (1.0 + 10.0 / u) ** (-a * b);
}

function deltaUThickness(u: number, tH: number, er: number): number {
  if (!(tH > 0.0)) return 0.0;
  let du =
    (tH / Math.PI) * Math.log(1.0 + (4.0 * Math.E * Math.tanh(Math.sqrt(6.517 * u)) ** 2) / tH);
  du = 0.5 * du * (1.0 + 1.0 / Math.cosh(Math.sqrt(er - 1.0)));
  return du;
}

const deltaQThickness = (u: number, tH: number): number =>
  ((2.0 * Math.log(2.0)) / Math.PI) * (tH / Math.sqrt(u));
const deltaQCover = (h2h: number): number => Math.tanh(1.043 + 0.121 * h2h - 1.164 / h2h);
const eREffective = (er: number, q: number): number => 0.5 * (er + 1.0) + 0.5 * q * (er - 1.0);

function deltaZ0Cover(u: number, h2h: number): number {
  const h2hp1 = 1.0 + h2h;
  const P = 270.0 * (1.0 - Math.tanh(0.28 + 1.2 * Math.sqrt(h2h)));
  const qArg = (0.48 * Math.sqrt(Math.max(0.0, u - 1.0))) / (h2hp1 * h2hp1);
  if (qArg >= 1.0) return P;
  return P * (1.0 - Math.atanh(qArg));
}

function eRDispersion(u: number, er: number, fn: number): number {
  const p1 =
    0.27488 + u * (0.6315 + 0.525 / (1.0 + 0.0157 * fn) ** 20.0) - 0.065683 * Math.exp(-8.7513 * u);
  const p2 = 0.33622 * (1.0 - Math.exp(-0.03442 * er));
  const p3 = 0.0363 * Math.exp(-4.6 * u) * (1.0 - Math.exp(-((fn / 38.7) ** 4.97)));
  const p4 = 1.0 + 2.751 * (1.0 - Math.exp(-((er / 15.916) ** 8.0)));
  return p1 * p2 * ((p3 * p4 + 0.1844) * fn) ** 1.5763;
}

function z0Dispersion(u: number, er: number, eeff0: number, eefff: number, fn: number): number {
  const R1 = 0.03891 * er ** 1.4;
  const R2 = 0.267 * u ** 7.0;
  const R3 = 4.766 * Math.exp(-3.228 * u ** 0.641);
  const R4 = 0.016 + (0.0514 * er) ** 4.524;
  const R5 = (fn / 28.843) ** 12.0;
  const R6 = 22.2 * u ** 1.92;
  const R7 = 1.206 - 0.3144 * Math.exp(-R1) * (1.0 - Math.exp(-R2));
  const R8 = 1.0 + 1.275 * (1.0 - Math.exp(-0.004625 * R3 * er ** 1.674 * (fn / 18.365) ** 2.745));
  let tmpf = (er - 1.0) ** 6.0;
  const R9 =
    5.086 *
    R4 *
    (R5 / (0.3838 + 0.386 * R4)) *
    (Math.exp(-R6) / (1.0 + 1.2992 * R5)) *
    (tmpf / (1.0 + 10.0 * tmpf));
  const R10 = 0.00044 * er ** 2.136 + 0.0184;
  tmpf = (fn / 19.47) ** 6.0;
  const R11 = tmpf / (1.0 + 0.0962 * tmpf);
  const R12 = 1.0 / (1.0 + 0.00245 * u * u);
  const R13 = 0.9408 * eefff ** R8 - 0.9603;
  const R14 = (0.9408 - R9) * eeff0 ** R8 - 0.9603;
  const R15 = 0.707 * R10 * (fn / 12.3) ** 1.097;
  const R16 = 1.0 + 0.0503 * er * er * R11 * (1.0 - Math.exp(-((u / 15.0) ** 6.0)));
  const R17 = R7 * (1.0 - 1.1241 * (R12 / R16) * Math.exp(-0.026 * fn ** 1.15656 - R15));
  return (R13 / R14) ** R17;
}

interface MsInternal {
  z0Static: number;
  erEff0: number;
  z0h1: number;
  murEff: number;
}

/** KiCad mur_eff_ms + microstrip_Z0 (static impedance & effective permittivity). */
function staticZ0(phys: MicrostripPhysical, el: TcElectrical): MsInternal {
  const er = el.epsilonR;
  const h = phys.heightM;
  const w = phys.widthM;
  const h2 = phys.coverHeightM ?? Number.POSITIVE_INFINITY;
  const h2h = h2 / h;
  let u = w / h;
  const tH = phys.thicknessM / h;

  const murEff = (2.0 * el.mur) / (1.0 + el.mur + (1.0 - el.mur) * (1.0 + (10.0 * h) / w) ** -0.5);

  const deltaU1 = deltaUThickness(u, tH, 1.0);
  const z0h1 = z0Homogeneous(u + deltaU1);
  const deltaUr = deltaUThickness(u, tH, er);
  u += deltaUr;
  const z0hr = z0Homogeneous(u);

  const qInf = fillingFactor(u, er);
  const qC = deltaQCover(h2h);
  const qT = deltaQThickness(u, tH);
  const q = (qInf - qT) * qC;

  const erEffT = eREffective(er, q);
  const erEff = erEffT * (z0h1 / z0hr) ** 2;
  const z0Static = (z0hr - deltaZ0Cover(u, h2h)) / Math.sqrt(erEffT);

  return { z0Static, erEff0: erEff, z0h1, murEff };
}

export function microstripAnalyze(
  phys: MicrostripPhysical,
  el: TcElectrical,
  soldermask?: SoldermaskParams,
): MicrostripResult {
  const er = el.epsilonR;
  const stat = staticZ0(phys, el);
  let { z0Static, erEff0 } = stat;
  const { z0h1, murEff } = stat;
  const u = phys.widthM / phys.heightM;

  // Solder mask cover correction on the static εeff and Z0 before dispersion
  // and losses consume them (KiCad MICROSTRIP::Analyse; no-op when disabled).
  let tanDEff = el.tanD;
  const sm = applySoldermaskCorrection(
    soldermask,
    phys.heightM,
    erEff0,
    el.tanD,
    er,
    soldermask?.present ? microstripSoldermaskDeltaQ(u, soldermask.thicknessM / phys.heightM) : 0.0,
  );
  if (sm.changed) {
    z0Static *= Math.sqrt(erEff0 / sm.epsEff);
    erEff0 = sm.epsEff;
    tanDEff = sm.tanD;
  }

  // Dispersion (Kirschning-Jansen). f_n in GHz·mm.
  const fn = (el.frequencyHz * phys.heightM) / 1e6;
  const P = eRDispersion(u, er, fn);
  const erEffF = er - (er - erEff0) / (1.0 + P);
  const D = z0Dispersion(u, er, erEff0, erEffF, fn);
  const z0F = z0Static * D;

  // Electrical length uses the dispersed εeff and effective µ.
  const v = C0 / Math.sqrt(erEffF * murEff);
  const lambdaG = v / el.frequencyHz;
  const angLRad = (2.0 * Math.PI * phys.lengthM) / lambdaG;

  // Losses use the static εeff (KiCad).
  const delta = skinDepth(el);
  const rough = phys.roughM ?? 0.0;
  let alphaC = 0.0;
  if (el.frequencyHz > 0.0) {
    const K = Math.exp(-1.2 * (z0h1 / ZF0) ** 0.7);
    let rs = 1.0 / (el.sigma * delta);
    rs *= 1.0 + (2.0 / Math.PI) * Math.atan(1.4 * (rough / delta) ** 2);
    const qc = (Math.PI * z0h1 * phys.widthM * el.frequencyHz) / (rs * C0 * K);
    alphaC = (((20.0 * Math.PI) / Math.log(10.0)) * el.frequencyHz * Math.sqrt(erEff0)) / (C0 * qc);
  }
  const alphaD =
    ((20.0 * Math.PI) / Math.log(10.0)) *
    (el.frequencyHz / C0) *
    (er / Math.sqrt(erEff0)) *
    ((erEff0 - 1.0) / (er - 1.0)) *
    tanDEff;

  return {
    z0: z0F,
    epsEff: erEffF,
    epsEffStatic: erEff0,
    z0Static,
    angleDeg: (angLRad * 180) / Math.PI,
    conductorLossDb: alphaC * phys.lengthM,
    dielectricLossDb: alphaD * phys.lengthM,
    skinDepthM: delta,
  };
}

/** `MICROSTRIP::mur_eff_ms()`: the effective permeability the length calculation divides by. */
export function microstripMurEff(phys: MicrostripPhysical, el: TcElectrical): number {
  return staticZ0(phys, el).murEff;
}

/** Initial width guess (KiCad SynthesizeWidth, Wheeler). */
export function synthesizeWidth(z0: number, er: number, h: number): number {
  const a =
    (z0 / ZF0 / 2 / Math.PI) * Math.sqrt((er + 1) / 2) + ((er - 1) / (er + 1)) * (0.23 + 0.11 / er);
  const b = ((ZF0 / 2) * Math.PI) / (z0 * Math.sqrt(er));
  let wh: number;
  if (a > 1.52) wh = (8 * Math.exp(a)) / (Math.exp(2 * a) - 2);
  else
    wh =
      (2 / Math.PI) *
      (b - 1 - Math.log(2 * b - 1) + ((er - 1) / (2 * er)) * (Math.log(b - 1) + 0.39 - 0.61 / er));
  return h > 0 ? wh * h : 0;
}

/** Synthesis: solve width for target Z0 (dispersed), then length for the angle. */
export function microstripSynthesize(
  phys: MicrostripPhysical,
  el: TcElectrical,
  z0Target: number,
  angleDeg: number,
): MicrostripPhysical | null {
  const guess = synthesizeWidth(z0Target, el.epsilonR, phys.heightM);
  const z0Of = (w: number): number => microstripAnalyze({ ...phys, widthM: w }, el).z0;
  // Z0 decreases with width; bracket around the Wheeler guess.
  let lo = Math.max(guess * 0.05, phys.heightM * 1e-4);
  let hi = Math.max(guess * 20, phys.heightM * 100);
  if ((z0Of(lo) - z0Target) * (z0Of(hi) - z0Target) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (z0Of(mid) > z0Target) lo = mid;
    else hi = mid;
  }
  const w = (lo + hi) / 2;
  const r = microstripAnalyze({ ...phys, widthM: w }, el);
  const murEff = staticZ0({ ...phys, widthM: w }, el).murEff;
  const len =
    ((C0 / el.frequencyHz / Math.sqrt(r.epsEff * murEff)) * ((angleDeg * Math.PI) / 180)) /
    (2 * Math.PI);
  return { ...phys, widthM: w, lengthM: len };
}

// ---------------------------------------------------------------------------
// `class MICROSTRIP : public TRANSLINE_CALCULATION_BASE` (microstrip.h)

import {
  type SYNTHESIZE_OPTS,
  TC_C0,
  TRANSLINE_CALCULATION_BASE,
  TRANSLINE_PARAMETERS as TCP,
  TRANSLINE_STATUS,
} from './transline_calculation_base.js';

export class MICROSTRIP extends TRANSLINE_CALCULATION_BASE {
  /** `mur_eff`, kept by `mur_eff_ms()` for the length calculation. */
  private mur_eff = 1.0;

  constructor() {
    super([
      TCP.EPSILONR,
      TCP.H_T,
      TCP.H,
      TCP.PHYS_WIDTH,
      TCP.T,
      TCP.Z0,
      TCP.FREQUENCY,
      TCP.EPSILON_EFF,
      TCP.SKIN_DEPTH,
      TCP.SIGMA,
      TCP.ROUGH,
      TCP.TAND,
      TCP.PHYS_LEN,
      TCP.MUR,
      TCP.MURC,
      TCP.ANG_L,
      TCP.UNIT_PROP_DELAY,
      TCP.ATTEN_COND,
      TCP.ATTEN_DILECTRIC,
    ]);
  }

  private physical(): MicrostripPhysical {
    return {
      widthM: this.GetParameter(TCP.PHYS_WIDTH),
      heightM: this.GetParameter(TCP.H),
      thicknessM: this.GetParameter(TCP.T),
      lengthM: this.GetParameter(TCP.PHYS_LEN),
      coverHeightM: this.GetParameter(TCP.H_T),
      roughM: this.GetParameter(TCP.ROUGH),
    };
  }

  private electrical(): TcElectrical {
    return {
      frequencyHz: this.GetParameter(TCP.FREQUENCY),
      epsilonR: this.GetParameter(TCP.EPSILONR),
      tanD: this.GetParameter(TCP.TAND),
      sigma: this.GetParameter(TCP.SIGMA),
      mur: this.GetParameter(TCP.MUR),
      murC: this.GetParameter(TCP.MURC),
    };
  }

  /** `mur_eff_ms`, `microstrip_Z0`, `dispersion`, `line_angle`, `attenuation`. */
  override Analyse(): void {
    const phys = this.physical();
    const el = this.electrical();
    this.mur_eff = microstripMurEff(phys, el);
    const r = microstripAnalyze(phys, el);
    this.SetParameter(TCP.Z0, r.z0);
    this.SetParameter(TCP.EPSILON_EFF, r.epsEff);
    this.SetParameter(TCP.ANG_L, (r.angleDeg * Math.PI) / 180.0);
    this.SetParameter(TCP.ATTEN_COND, r.conductorLossDb);
    this.SetParameter(TCP.ATTEN_DILECTRIC, r.dielectricLossDb);
    this.SetParameter(TCP.SKIN_DEPTH, r.skinDepthM);
    this.SetParameter(
      TCP.UNIT_PROP_DELAY,
      TRANSLINE_CALCULATION_BASE.UnitPropagationDelay(r.epsEff),
    );
  }

  override Synthesize(_aOpts: SYNTHESIZE_OPTS): boolean {
    const z0_dest = this.GetParameter(TCP.Z0);
    const angl_dest = this.GetParameter(TCP.ANG_L);

    // Calculate width and use for initial value in Newton's method
    this.SetParameter(TCP.PHYS_WIDTH, this.SynthesizeWidth());

    // Optimise Z0, varying width
    if (!this.MinimiseZ0Error1D(TCP.PHYS_WIDTH, TCP.Z0)) return false;

    // Re-calculate with required output parameters
    this.SetParameter(TCP.Z0, z0_dest);
    this.SetParameter(TCP.ANG_L, angl_dest);
    const er_eff = this.GetParameter(TCP.EPSILON_EFF);
    const length = (): number =>
      ((TC_C0 / this.GetParameter(TCP.FREQUENCY) / Math.sqrt(er_eff * this.mur_eff)) *
        this.GetParameter(TCP.ANG_L)) /
      2.0 /
      Math.PI; /* in m */
    this.SetParameter(TCP.PHYS_LEN, length());
    this.Analyse();

    // Set the output parameters
    this.SetParameter(TCP.Z0, z0_dest);
    this.SetParameter(TCP.ANG_L, angl_dest);
    this.SetParameter(TCP.PHYS_LEN, length());

    return true;
  }

  protected override SetAnalysisResults(): void {
    this.SetAnalysisResult(TCP.EPSILON_EFF, this.GetParameter(TCP.EPSILON_EFF));
    this.SetAnalysisResult(TCP.UNIT_PROP_DELAY, this.GetParameter(TCP.UNIT_PROP_DELAY));
    this.SetAnalysisResult(TCP.ATTEN_COND, this.GetParameter(TCP.ATTEN_COND));
    this.SetAnalysisResult(TCP.ATTEN_DILECTRIC, this.GetParameter(TCP.ATTEN_DILECTRIC));
    this.SetAnalysisResult(TCP.SKIN_DEPTH, this.GetParameter(TCP.SKIN_DEPTH));

    const Z0 = this.GetParameter(TCP.Z0);
    const ANG_L = this.GetParameter(TCP.ANG_L);
    const L = this.GetParameter(TCP.PHYS_LEN);
    const W = this.GetParameter(TCP.PHYS_WIDTH);
    const Z0_invalid = !Number.isFinite(Z0) || Z0 < 0;
    const ANG_L_invalid = !Number.isFinite(ANG_L) || ANG_L < 0;
    const L_invalid = !Number.isFinite(L) || L < 0;
    const W_invalid = !Number.isFinite(W) || W <= 0;

    this.SetAnalysisResult(
      TCP.Z0,
      Z0,
      Z0_invalid ? TRANSLINE_STATUS.TS_ERROR : TRANSLINE_STATUS.OK,
    );
    this.SetAnalysisResult(
      TCP.ANG_L,
      ANG_L,
      ANG_L_invalid ? TRANSLINE_STATUS.TS_ERROR : TRANSLINE_STATUS.OK,
    );
    this.SetAnalysisResult(
      TCP.PHYS_LEN,
      L,
      L_invalid ? TRANSLINE_STATUS.WARNING : TRANSLINE_STATUS.OK,
    );
    this.SetAnalysisResult(
      TCP.PHYS_WIDTH,
      W,
      W_invalid ? TRANSLINE_STATUS.WARNING : TRANSLINE_STATUS.OK,
    );
  }

  protected override SetSynthesisResults(): void {
    this.SetSynthesisResult(TCP.EPSILON_EFF, this.GetParameter(TCP.EPSILON_EFF));
    this.SetSynthesisResult(TCP.UNIT_PROP_DELAY, this.GetParameter(TCP.UNIT_PROP_DELAY));
    this.SetSynthesisResult(TCP.ATTEN_COND, this.GetParameter(TCP.ATTEN_COND));
    this.SetSynthesisResult(TCP.ATTEN_DILECTRIC, this.GetParameter(TCP.ATTEN_DILECTRIC));
    this.SetSynthesisResult(TCP.SKIN_DEPTH, this.GetParameter(TCP.SKIN_DEPTH));

    const Z0 = this.GetParameter(TCP.Z0);
    const ANG_L = this.GetParameter(TCP.ANG_L);
    const L = this.GetParameter(TCP.PHYS_LEN);
    const W = this.GetParameter(TCP.PHYS_WIDTH);
    const Z0_invalid = !Number.isFinite(Z0) || Z0 < 0;
    const ANG_L_invalid = !Number.isFinite(ANG_L) || ANG_L < 0;
    const L_invalid = !Number.isFinite(L) || L < 0;
    const W_invalid = !Number.isFinite(W) || W <= 0;

    this.SetSynthesisResult(
      TCP.Z0,
      Z0,
      Z0_invalid ? TRANSLINE_STATUS.WARNING : TRANSLINE_STATUS.OK,
    );
    this.SetSynthesisResult(
      TCP.ANG_L,
      ANG_L,
      ANG_L_invalid ? TRANSLINE_STATUS.WARNING : TRANSLINE_STATUS.OK,
    );
    this.SetSynthesisResult(
      TCP.PHYS_LEN,
      L,
      L_invalid ? TRANSLINE_STATUS.TS_ERROR : TRANSLINE_STATUS.OK,
    );
    this.SetSynthesisResult(
      TCP.PHYS_WIDTH,
      W,
      W_invalid ? TRANSLINE_STATUS.TS_ERROR : TRANSLINE_STATUS.OK,
    );
  }

  /** `SynthesizeWidth`: Wheeler's guess for Z0 (`microstrip.cpp:131`). */
  private SynthesizeWidth(): number {
    return synthesizeWidth(
      this.GetParameter(TCP.Z0),
      this.GetParameter(TCP.EPSILONR),
      this.GetParameter(TCP.H),
    );
  }
}
