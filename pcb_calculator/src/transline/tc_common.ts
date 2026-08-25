// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Shared constants and helpers for the transmission-line models, ported from
 * KiCad's `common/transline_calculations/` (units.h + transline_calculation_base).
 * These are faithful ports of the standard microwave formulas; results match
 * KiCad's calculator to the precision of the models.
 */

export const MU0 = 12.566370614e-7; // magnetic constant, H/m
export const E0 = 8.854e-12; // permittivity of free space, F/m
export const C0 = 299792458.0; // speed of light, m/s
// [data] `constexpr double ZF0 = 376.730313668` — the wave resistance in
// vacuum, and upstream's own comment points at where it came from:
// https://physics.nist.gov/cgi-bin/cuu/Value?z0
// (include/transline_calculations/units.h:64,70-71). We were carrying
// 376.730313412, the pre-2018 CODATA figure KiCad used to have, which put
// every transmission-line impedance out by 6.8e-10 relative — invisible in
// the panel, and exactly the size of the gap between our stripline and the
// C++ when they were finally compared digit for digit.
export const ZF0 = 376.730313668; // free-space wave impedance, Ω
export const LOG2DB = 20.0 / Math.log(10); // Nepers → dB (≈ 8.68589)
export const UNIT_MICRON = 1e-6;

/** Common electrical inputs shared by every line type. */
export interface TcElectrical {
  frequencyHz: number;
  /** Substrate/dielectric relative permittivity. */
  epsilonR: number;
  /** Dielectric loss tangent. */
  tanD: number;
  /** Conductor conductivity, S/m (copper ≈ 5.8e7). */
  sigma: number;
  /** Relative permeability of the dielectric (usually 1). */
  mur: number;
  /** Relative permeability of the conductor (usually 1). */
  murC: number;
}

/** Skin depth δ = 1/√(π·f·µrc·µ0·σ). */
export function skinDepth(el: TcElectrical): number {
  return 1.0 / Math.sqrt(Math.PI * el.frequencyHz * el.murC * MU0 * el.sigma);
}

/** Surface resistance Rs = √(π·f·µrc·µ0/σ). */
export function surfaceResistance(el: TcElectrical): number {
  return Math.sqrt((Math.PI * el.frequencyHz * el.murC * MU0) / el.sigma);
}

/** Propagation delay per unit length (ps/cm) from effective permittivity. */
export function unitPropagationDelay(epsilonEff: number): number {
  return Math.sqrt(epsilonEff) * (1.0e10 / 2.99e8);
}

export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Complete elliptic integrals of the first (K) and second (E) kind, computed by
 * the arithmetic-geometric mean, faithful to KiCad's
 * `TRANSLINE_CALCULATION_BASE::EllipticIntegral`. `arg` is the modulus squared
 * (m = k²). Returns `[K, E]`.
 */
export function ellipticIntegral(arg: number): [number, number] {
  const NR_EPSI = 2.2204460492503131e-16;
  const iMax = 16;

  if (arg === 1.0) return [Number.POSITIVE_INFINITY, 0];
  if (arg === Number.NEGATIVE_INFINITY) return [0, Number.POSITIVE_INFINITY];

  let fk = 1;
  let fe = 1;
  let da = arg;
  if (arg < 0) {
    fk = 1 / Math.sqrt(1 - arg);
    fe = Math.sqrt(1 - arg);
    da = -arg / (1 - arg);
  }

  let a = 1;
  let b = Math.sqrt(1 - da);
  let c = Math.sqrt(da);
  let fr = 0.5;
  let s = fr * c * c;
  let i = 0;
  for (; i < iMax; i++) {
    const t = (a + b) / 2;
    c = (a - b) / 2;
    b = Math.sqrt(a * b);
    a = t;
    fr *= 2;
    s += fr * c * c;
    if (c / a < NR_EPSI) break;
  }

  if (i >= iMax) return [0, 0];
  let k = Math.PI / 2 / a;
  let e = ((Math.PI / 2) * (1 - s)) / a;
  if (arg < 0) {
    k *= fk;
    e *= fe;
  }
  return [k, e];
}

/** K(k) for a modulus k (not k²), matching KiCad's `EllipticIntegral(k).first`. */
export const ellipticK = (k: number): number => ellipticIntegral(k * k)[0];

// ---------------------------------------------------------------------------
// Djordjevic-Sarkar causal wideband Debye dielectric model.
// Port of KiCad `common/transline_calculations/dielectric_djordjevic_sarkar.cpp`
// (Djordjevic et al., IEEE Trans. EMC 43(4):662-667, 2001, eqs. (8)-(11)).
// ---------------------------------------------------------------------------

export interface DjordjevicSarkarModel {
  lossless: boolean;
  epsInf: number;
  m: number;
  f1: number;
  f2: number;
}

/**
 * Fit the model to the substrate spec (εr, tan δ at fSpec). Returns null for
 * invalid inputs, KiCad falls back to the constant model in that case.
 */
export function djordjevicSarkarFit(
  epsRSpec: number,
  tanDSpec: number,
  fSpec: number,
  f1 = 1.0e3,
  f2 = 1.0e12,
): DjordjevicSarkarModel | null {
  if (!(f1 > 0.0) || !(f2 > f1) || !(fSpec >= f1) || !(fSpec <= f2)) return null;

  if (tanDSpec === 0.0) return { lossless: true, epsInf: epsRSpec, m: 0.0, f1, f2 };

  // k = log((f2 + j·fSpec) / (f1 + j·fSpec))
  const kRe = 0.5 * Math.log((f2 * f2 + fSpec * fSpec) / (f1 * f1 + fSpec * fSpec));
  const kIm = Math.atan2(fSpec, f2) - Math.atan2(fSpec, f1);

  return {
    lossless: false,
    m: (-tanDSpec * epsRSpec) / kIm,
    epsInf: epsRSpec * (1.0 + (tanDSpec * kRe) / kIm),
    f1,
    f2,
  };
}

/** Complex ε(f), eq. (8): εinf + m·log((f2 + j·f)/(f1 + j·f)). */
function dsComplexEpsilonAt(ds: DjordjevicSarkarModel, f: number): [number, number] {
  if (ds.lossless) return [ds.epsInf, 0.0];
  const logRe = 0.5 * Math.log((ds.f2 * ds.f2 + f * f) / (ds.f1 * ds.f1 + f * f));
  const logIm = Math.atan2(f, ds.f2) - Math.atan2(f, ds.f1);
  return [ds.epsInf + ds.m * logRe, ds.m * logIm];
}

export const dsEpsilonRealAt = (ds: DjordjevicSarkarModel, f: number): number =>
  dsComplexEpsilonAt(ds, f)[0];

export function dsTanDeltaAt(ds: DjordjevicSarkarModel, f: number): number {
  if (ds.lossless) return 0.0;
  const [re, im] = dsComplexEpsilonAt(ds, f);
  return -im / re;
}

/** Panel-level dielectric model selection (KiCad DIELECTRIC_MODEL_SEL). */
export interface DielectricModelParams {
  model: 'constant' | 'djordjevic_sarkar';
  /** Frequency at which the substrate εr / tan δ are specified, Hz. */
  specFreqHz?: number;
}

/**
 * The substrate values an analysis should actually use, the constant inputs,
 * or the Djordjevic-Sarkar dispersion of them at the operating frequency
 * (KiCad UpdateDielectricModel + GetDispersedEpsilonR/TanDelta; invalid spec
 * frequency falls back to the constant model).
 */
export function dispersedSubstrate(
  el: TcElectrical,
  diel?: DielectricModelParams,
): { epsilonR: number; tanD: number } {
  if (diel?.model !== 'djordjevic_sarkar') return { epsilonR: el.epsilonR, tanD: el.tanD };
  const fSpec = diel.specFreqHz ?? NaN;
  if (!Number.isFinite(fSpec) || fSpec <= 0.0) return { epsilonR: el.epsilonR, tanD: el.tanD };
  const ds = djordjevicSarkarFit(el.epsilonR, el.tanD, fSpec);
  if (!ds) return { epsilonR: el.epsilonR, tanD: el.tanD };
  return {
    epsilonR: dsEpsilonRealAt(ds, el.frequencyHz),
    tanD: dsTanDeltaAt(ds, el.frequencyHz),
  };
}

// ---------------------------------------------------------------------------
// Solder mask overlay correction (Wan-Hoorfar 2000 / Svacina 1992 filling
// factor + Bahl-Stuchly 1980 air-replacement). Port of KiCad
// TRANSLINE_CALCULATION_BASE::WanHoorfarQ2 / ApplySoldermaskCorrection.
// ---------------------------------------------------------------------------

export interface SoldermaskParams {
  present: boolean;
  /** Cured mask thickness, m (typ. LPI 15-30 µm). */
  thicknessM: number;
  /** Mask relative permittivity (typ. LPI 3.3-3.8). */
  epsilonR: number;
  /** Mask loss tangent (typ. LPI 0.025-0.035). */
  tanD: number;
  /** CPW/CBCPW only: mask fills the coplanar slots. */
  fillsGaps: boolean;
}

/** Wan-Hoorfar 2000 q2: field fraction between h and the boundary hBarTop·h. */
export function wanHoorfarQ2(u: number, hBarTop: number): number {
  // Eq. (4): Hammerstad-style effective strip width for wide strips.
  const wBarEff = u + (2.0 / Math.PI) * Math.log(17.08 * (0.5 * u + 0.92));

  // Eq. (5): v-bar parametrises the field contraction above the strip.
  const denom = wBarEff * Math.PI - 4.0;
  if (denom <= 0.0 || !Number.isFinite(denom)) return 0.0;

  const vBar = (2.0 / Math.PI) * Math.atan(((2.0 * Math.PI) / denom) * (hBarTop - 1.0));
  const halfPi = 0.5 * Math.PI * vBar;

  if (u >= 1.0) {
    // Wide strip: q1 from eq (2), q2 from the improved eq (12).
    const q1 = 1.0 - Math.log(wBarEff * Math.PI - 1.0) / (2.0 * wBarEff);
    const inner =
      (2.0 * wBarEff * Math.cos(halfPi)) / (2.0 * hBarTop - 1.0 + vBar) + Math.sin(halfPi);
    if (inner <= 0.0 || !Number.isFinite(inner)) return 0.0;
    const correction = ((1.0 - vBar) / (2.0 * wBarEff)) * Math.log(inner);
    return Math.max(0.0, 1.0 - q1 - correction);
  }

  // Narrow strip: eqs (6), (7), (8), (13).
  const logEighth = Math.log(0.125 * u);
  if (!Number.isFinite(logEighth) || logEighth === 0.0) return 0.0;

  const q1 = 0.5 + 0.9 / (Math.PI * logEighth);
  const bj = (hBarTop + 1.0) / (hBarTop + 0.25 * u - 1.0);
  if (bj <= 0.0 || !Number.isFinite(bj)) return 0.0;

  const acosArg = Math.sqrt(bj / hBarTop) * (hBarTop - 1.0 + 0.125 * u);
  if (acosArg < -1.0 || acosArg > 1.0) return 0.0;

  const correction = (Math.log(bj) * Math.acos(acosArg)) / (4.0 * logEighth);
  return Math.max(0.0, 1.0 - q1 - correction);
}

/** Microstrip / coupled-microstrip incremental filling factor (KiCad override). */
export function microstripSoldermaskDeltaQ(wOverH: number, cOverH: number): number {
  if (wOverH <= 0.0 || cOverH <= 0.0) return 0.0;
  const q2Coated = wanHoorfarQ2(wOverH, 1.0 + cOverH);
  const q2Base = wanHoorfarQ2(wOverH, 1.0);
  return Math.max(0.0, q2Coated - q2Base);
}

/** CPW / CBCPW empirical adaptation of the microstrip factor (KiCad override). */
export function coplanarSoldermaskDeltaQ(
  wOverH: number,
  cOverH: number,
  backMetal: boolean,
  fillsGaps: boolean,
): number {
  const microstripDelta = microstripSoldermaskDeltaQ(wOverH, cOverH);
  const halfSpace = backMetal ? 0.25 : 0.5;
  const slotCoverage = fillsGaps ? 1.0 : 0.4;
  return halfSpace * slotCoverage * microstripDelta;
}

/**
 * Blend the mask into the uncoated effective permittivity / loss tangent.
 * Mirrors KiCad's ApplySoldermaskCorrection guard rails: any missing or
 * non-physical ingredient takes the bit-identical no-op path.
 */
export function applySoldermaskCorrection(
  mask: SoldermaskParams | undefined,
  hM: number,
  epsEffUncoated: number,
  tanDSubstrate: number,
  epsRSubstrate: number,
  deltaQ: number,
): { epsEff: number; tanD: number; changed: boolean } {
  const noop = { epsEff: epsEffUncoated, tanD: tanDSubstrate, changed: false };
  if (!mask?.present) return noop;

  const C = mask.thicknessM;
  if (!(C > 0.0) || !(hM > 0.0) || !Number.isFinite(C) || !Number.isFinite(hM)) return noop;
  if (!Number.isFinite(mask.epsilonR) || mask.epsilonR <= 1.0) return noop;
  if (!Number.isFinite(mask.tanD) || mask.tanD < 0.0) return noop;
  if (epsRSubstrate <= 1.0 || !Number.isFinite(epsRSubstrate)) return noop;
  if (deltaQ <= 0.0) return noop;

  // Air-replacement decomposition (Bahl-Stuchly 1980, d → ∞ limit).
  const epsEffCoated = epsEffUncoated + deltaQ * (mask.epsilonR - 1.0);

  const qSub = Math.min(1.0, Math.max(0.0, (epsEffUncoated - 1.0) / (epsRSubstrate - 1.0)));
  const deltaQCapped = Math.min(deltaQ, Math.max(0.0, 1.0 - qSub));

  let tanDCoated = tanDSubstrate;
  if (epsEffCoated > 0.0) {
    tanDCoated =
      (qSub * epsRSubstrate * tanDSubstrate + deltaQCapped * mask.epsilonR * mask.tanD) /
      epsEffCoated;
  }

  return { epsEff: epsEffCoated, tanD: tanDCoated, changed: epsEffCoated !== epsEffUncoated };
}
