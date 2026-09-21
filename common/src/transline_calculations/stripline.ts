// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Stripline, faithful port of KiCad's `transline_calculations/stripline.cpp`
 * (Wheeler/Cohn line impedance, the two halves combined in parallel).
 * Counterpart: KiCad `common/transline_calculations/stripline.cpp`.
 *
 * The strip is **not** assumed centred. `STRIPLINE_A_PRM` — the panel's `a`
 * row, "Distance between strip and top metal" (transline_ident.cpp,
 * STRIPLINE_TYPE) — is a parameter the user sets, and `Analyse` builds the two
 * half-lines from it: `2a + t` below and `2(h − a) − t` above (stripline.cpp:37-41).
 * This used to hardcode `a = (h − t)/2`, so the panel showed the row, took the
 * number and ignored it, and every stripline was symmetric no matter what the
 * user typed.
 */

import {
  C0,
  LOG2DB,
  type TcElectrical,
  type TranslineAnalysis,
  ZF0,
  skinDepth,
} from './tc_common.js';

export interface StriplinePhysical {
  /** Strip width, m. */
  widthM: number;
  /** Ground-to-ground spacing h, m. */
  heightM: number;
  /** Strip thickness, m. */
  thicknessM: number;
  /** Line length, m. */
  lengthM: number;
  /**
   * `a`, the distance from the strip to the top metal, m (STRIPLINE_A_PRM).
   *
   * Required, not defaulted: a caller that forgets it would silently get the
   * symmetric answer, which is the bug this replaced. `(h − t) / 2` is the
   * centred case — that is what `calcZ0SymmetricStripline` wants and what
   * c_stripline.ts passes.
   */
  offsetM: number;
}

/** KiCad STRIPLINE::lineImpedance, returns ZL and the conductor loss ac. */
function lineImpedance(
  aHeight: number,
  w: number,
  t: number,
  epsr: number,
  freq: number,
  sigma: number,
): { zl: number; ac: number } {
  const hmt = aHeight - t;
  let ac = Math.sqrt(freq / sigma / 17.2);
  let zl: number;

  if (w / hmt >= 0.35) {
    zl =
      w +
      (2.0 * aHeight * Math.log((2.0 * aHeight - t) / hmt) -
        t * Math.log((aHeight * aHeight) / hmt / hmt - 1.0)) /
        Math.PI;
    zl = (ZF0 * hmt) / Math.sqrt(epsr) / 4.0 / zl;

    ac *= (2.02e-6 * epsr * zl) / hmt;
    ac *=
      1.0 + (2.0 * w) / hmt + ((aHeight + t) / hmt / Math.PI) * Math.log((2.0 * aHeight) / t - 1.0);
  } else {
    let tdw = t / w;
    if (t / w > 1.0) tdw = w / t;
    let de = 1.0 + (tdw / Math.PI) * (1.0 + Math.log((4.0 * Math.PI) / tdw)) + 0.236 * tdw ** 1.65;
    de *= t / w > 1.0 ? t / 2.0 : w / 2.0;
    zl = (ZF0 / 2.0 / Math.PI / Math.sqrt(epsr)) * Math.log((4.0 * aHeight) / Math.PI / de);

    ac *= 0.01141 / zl / de;
    ac *=
      de / aHeight +
      0.5 +
      tdw / 2.0 / Math.PI +
      (0.5 / Math.PI) * Math.log((4.0 * Math.PI) / tdw) +
      0.1947 * tdw ** 0.65 -
      0.0767 * tdw ** 1.65;
  }
  return { zl, ac };
}

function analyseZ0(
  phys: StriplinePhysical,
  el: TcElectrical,
): { z0: number; ac1: number; ac2: number } {
  const { widthM: w, heightM: h, thicknessM: t, offsetM: a } = phys;
  const l1 = lineImpedance(2.0 * a + t, w, t, el.epsilonR, el.frequencyHz, el.sigma);
  const l2 = lineImpedance(2.0 * (h - a) - t, w, t, el.epsilonR, el.frequencyHz, el.sigma);
  const z0 = 2.0 / (1.0 / l1.zl + 1.0 / l2.zl);
  return { z0, ac1: l1.ac, ac2: l2.ac };
}

export function striplineAnalyze(phys: StriplinePhysical, el: TcElectrical): TranslineAnalysis {
  const { lengthM: len } = phys;
  const { z0, ac1, ac2 } = analyseZ0(phys, el);
  const angLRad = (2.0 * Math.PI * len * Math.sqrt(el.epsilonR) * el.frequencyHz) / C0;
  const dielectric =
    LOG2DB * len * (Math.PI / C0) * el.frequencyHz * Math.sqrt(el.epsilonR) * el.tanD;

  return {
    z0,
    epsEff: el.epsilonR,
    angleDeg: (angLRad * 180) / Math.PI,
    conductorLossDb: len * (ac1 + ac2),
    dielectricLossDb: dielectric,
    skinDepthM: skinDepth(el),
  };
}

/** Synthesis: solve the strip width for the target Z0 (KiCad MinimiseZ0Error1D). */
export function striplineSynthesize(
  phys: StriplinePhysical,
  el: TcElectrical,
  z0Target: number,
  angleDeg: number,
): StriplinePhysical | null {
  const z0Of = (w: number): number => analyseZ0({ ...phys, widthM: w }, el).z0;
  // Z0 falls monotonically with width; bracket from a sliver to very wide.
  let lo = phys.heightM * 1e-4;
  let hi = phys.heightM * 50;
  const target = z0Target;
  if ((z0Of(lo) - target) * (z0Of(hi) - target) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (z0Of(mid) > target) lo = mid;
    else hi = mid;
  }
  const w = (lo + hi) / 2;
  const lambda = C0 / (el.frequencyHz * Math.sqrt(el.epsilonR));
  return { ...phys, widthM: w, lengthM: (angleDeg / 360) * lambda };
}

// ---------------------------------------------------------------------------
// `class STRIPLINE : public TRANSLINE_CALCULATION_BASE` (stripline.h)

import {
  type SYNTHESIZE_OPTS,
  TRANSLINE_CALCULATION_BASE,
  TRANSLINE_PARAMETERS as TCP,
  TRANSLINE_STATUS,
} from './transline_calculation_base.js';

export class STRIPLINE extends TRANSLINE_CALCULATION_BASE {
  private unit_prop_delay = 0.0;

  constructor() {
    super([
      TCP.SKIN_DEPTH,
      TCP.EPSILON_EFF,
      TCP.EPSILONR,
      TCP.T,
      TCP.STRIPLINE_A,
      TCP.H,
      TCP.Z0,
      TCP.PHYS_LEN,
      TCP.LOSS_CONDUCTOR,
      TCP.LOSS_DIELECTRIC,
      TCP.FREQUENCY,
      TCP.TAND,
      TCP.ANG_L,
      TCP.PHYS_WIDTH,
      TCP.SIGMA,
      TCP.MURC,
    ]);
  }

  override Analyse(): void {
    const el: TcElectrical = {
      frequencyHz: this.GetParameter(TCP.FREQUENCY),
      epsilonR: this.GetParameter(TCP.EPSILONR),
      tanD: this.GetParameter(TCP.TAND),
      sigma: this.GetParameter(TCP.SIGMA),
      mur: 1,
      murC: this.GetParameter(TCP.MURC),
    };
    const r = striplineAnalyze(
      {
        widthM: this.GetParameter(TCP.PHYS_WIDTH),
        heightM: this.GetParameter(TCP.H),
        thicknessM: this.GetParameter(TCP.T),
        lengthM: this.GetParameter(TCP.PHYS_LEN),
        offsetM: this.GetParameter(TCP.STRIPLINE_A),
      },
      el,
    );
    this.SetParameter(TCP.SKIN_DEPTH, r.skinDepthM);
    this.SetParameter(TCP.EPSILON_EFF, this.GetParameter(TCP.EPSILONR)); // no dispersion
    this.SetParameter(TCP.Z0, r.z0);
    this.SetParameter(TCP.LOSS_CONDUCTOR, r.conductorLossDb);
    this.SetParameter(TCP.LOSS_DIELECTRIC, r.dielectricLossDb);
    this.SetParameter(TCP.ANG_L, (r.angleDeg * Math.PI) / 180.0); // in radians
    this.unit_prop_delay = TRANSLINE_CALCULATION_BASE.UnitPropagationDelay(
      this.GetParameter(TCP.EPSILON_EFF),
    );
  }

  override Synthesize(_aOpts: SYNTHESIZE_OPTS): boolean {
    return this.MinimiseZ0Error1D(TCP.PHYS_WIDTH, TCP.Z0);
  }

  /** `STRIPLINE_A + T >= H`: the strip does not fit between the planes. */
  private geometryInvalid(): boolean {
    return (
      this.GetParameter(TCP.STRIPLINE_A) + this.GetParameter(TCP.T) >= this.GetParameter(TCP.H)
    );
  }

  protected override SetAnalysisResults(): void {
    const { OK, WARNING, TS_ERROR } = TRANSLINE_STATUS;
    this.SetAnalysisResult(TCP.EPSILON_EFF, this.GetParameter(TCP.EPSILON_EFF));
    this.SetAnalysisResult(TCP.UNIT_PROP_DELAY, this.unit_prop_delay);
    this.SetAnalysisResult(TCP.LOSS_CONDUCTOR, this.GetParameter(TCP.LOSS_CONDUCTOR));
    this.SetAnalysisResult(TCP.LOSS_DIELECTRIC, this.GetParameter(TCP.LOSS_DIELECTRIC));
    this.SetAnalysisResult(TCP.SKIN_DEPTH, this.GetParameter(TCP.SKIN_DEPTH));

    const Z0 = this.GetParameter(TCP.Z0);
    const ANG_L = this.GetParameter(TCP.ANG_L);
    const L = this.GetParameter(TCP.PHYS_LEN);
    const W = this.GetParameter(TCP.PHYS_WIDTH);
    const Z0_invalid = !Number.isFinite(Z0) || Z0 < 0;
    const ANG_L_invalid = !Number.isFinite(ANG_L) || ANG_L < 0;
    const L_invalid = !Number.isFinite(L) || L < 0;
    const W_invalid = !Number.isFinite(W) || W <= 0;
    const invalid = this.geometryInvalid();

    this.SetAnalysisResult(TCP.Z0, Z0, Z0_invalid || invalid ? TS_ERROR : OK);
    this.SetAnalysisResult(TCP.ANG_L, ANG_L, ANG_L_invalid ? TS_ERROR : OK);
    this.SetAnalysisResult(TCP.PHYS_LEN, L, L_invalid ? WARNING : OK);
    this.SetAnalysisResult(TCP.PHYS_WIDTH, W, W_invalid ? WARNING : OK);
    this.SetAnalysisResult(
      TCP.STRIPLINE_A,
      this.GetParameter(TCP.STRIPLINE_A),
      invalid ? WARNING : OK,
    );
    this.SetAnalysisResult(TCP.T, this.GetParameter(TCP.T), invalid ? WARNING : OK);
    this.SetAnalysisResult(TCP.H, this.GetParameter(TCP.H), invalid ? WARNING : OK);
    this.SetAnalysisResult(TCP.Z0, this.GetParameter(TCP.Z0), invalid ? WARNING : OK);
  }

  protected override SetSynthesisResults(): void {
    const { OK, WARNING, TS_ERROR } = TRANSLINE_STATUS;
    this.SetSynthesisResult(TCP.EPSILON_EFF, this.GetParameter(TCP.EPSILON_EFF));
    this.SetSynthesisResult(TCP.UNIT_PROP_DELAY, this.unit_prop_delay);
    this.SetSynthesisResult(TCP.LOSS_CONDUCTOR, this.GetParameter(TCP.LOSS_CONDUCTOR));
    this.SetSynthesisResult(TCP.LOSS_DIELECTRIC, this.GetParameter(TCP.LOSS_DIELECTRIC));
    this.SetSynthesisResult(TCP.SKIN_DEPTH, this.GetParameter(TCP.SKIN_DEPTH));

    const Z0 = this.GetParameter(TCP.Z0);
    const ANG_L = this.GetParameter(TCP.ANG_L);
    const L = this.GetParameter(TCP.PHYS_LEN);
    const W = this.GetParameter(TCP.PHYS_WIDTH);
    const Z0_invalid = !Number.isFinite(Z0) || Z0 < 0;
    const ANG_L_invalid = !Number.isFinite(ANG_L) || ANG_L < 0;
    const L_invalid = !Number.isFinite(L) || L < 0;
    const W_invalid = !Number.isFinite(W) || W <= 0;
    const invalid = this.geometryInvalid();

    this.SetSynthesisResult(TCP.Z0, Z0, Z0_invalid ? WARNING : OK);
    this.SetSynthesisResult(TCP.ANG_L, ANG_L, ANG_L_invalid ? WARNING : OK);
    this.SetSynthesisResult(TCP.PHYS_LEN, L, L_invalid ? TS_ERROR : OK);
    this.SetSynthesisResult(TCP.PHYS_WIDTH, W, W_invalid || invalid ? TS_ERROR : OK);
    this.SetSynthesisResult(
      TCP.STRIPLINE_A,
      this.GetParameter(TCP.STRIPLINE_A),
      invalid ? WARNING : OK,
    );
    this.SetSynthesisResult(TCP.T, this.GetParameter(TCP.T), invalid ? WARNING : OK);
    this.SetSynthesisResult(TCP.H, this.GetParameter(TCP.H), invalid ? WARNING : OK);
  }
}
