// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/transline_calculations`: the `TRANSLINE_CALCULATION_BASE` objects
 * the Tuning Profiles calculator drives (`SetParameter` / `Synthesize` /
 * `Analyse` / `Get*Results`), over the same maths the Calculator Tools use.
 */
import { describe, expect, it } from 'vitest';
import { COUPLED_MICROSTRIP } from '@ziroeda/common/src/transline_calculations/coupled_microstrip.js';
import { COUPLED_STRIPLINE } from '@ziroeda/common/src/transline_calculations/coupled_stripline.js';
import { MICROSTRIP } from '@ziroeda/common/src/transline_calculations/microstrip.js';
import { STRIPLINE } from '@ziroeda/common/src/transline_calculations/stripline.js';
import {
  SYNTHESIZE_OPTS,
  TRANSLINE_CALCULATION_BASE,
  TRANSLINE_PARAMETERS as P,
  TRANSLINE_STATUS,
} from '@ziroeda/common/src/transline_calculations/transline_calculation_base.js';
import { microstripAnalyze, microstripSynthesize } from '@ziroeda/pcb_calculator';

const RHO = 1.72e-8;

/** A 0.1 mm FR4 microstrip at 1 GHz: the panel's own parameter table. */
function microstrip(aWidth: number): MICROSTRIP {
  const c = new MICROSTRIP();
  c.SetParameter(P.PHYS_WIDTH, aWidth);
  c.SetParameter(P.SIGMA, 1.0 / RHO);
  c.SetParameter(P.EPSILON_EFF, 1.0);
  c.SetParameter(P.SKIN_DEPTH, 1e-6);
  c.SetParameter(P.EPSILONR, 4.5);
  c.SetParameter(P.H_T, 1e20);
  c.SetParameter(P.H, 0.0001);
  c.SetParameter(P.T, 0.000035);
  c.SetParameter(P.Z0, 50);
  c.SetParameter(P.FREQUENCY, 1e9);
  c.SetParameter(P.ROUGH, 0);
  c.SetParameter(P.TAND, 0.02);
  c.SetParameter(P.PHYS_LEN, 10);
  c.SetParameter(P.MUR, 1);
  c.SetParameter(P.MURC, 1);
  c.SetParameter(P.ANG_L, 1);
  return c;
}

function coupledMicrostrip(aWidth: number, aGap: number): COUPLED_MICROSTRIP {
  const c = new COUPLED_MICROSTRIP();
  c.SetParameter(P.Z0_E, 45);
  c.SetParameter(P.Z0_O, 45);
  c.SetParameter(P.Z_DIFF, 90);
  c.SetParameter(P.PHYS_WIDTH, aWidth);
  c.SetParameter(P.PHYS_S, aGap);
  c.SetParameter(P.EPSILONR, 4.5);
  c.SetParameter(P.PHYS_LEN, 10);
  c.SetParameter(P.H, 0.0001);
  c.SetParameter(P.T, 0.000035);
  c.SetParameter(P.H_T, 1e20);
  c.SetParameter(P.FREQUENCY, 1e9);
  c.SetParameter(P.MURC, 1);
  c.SetParameter(P.SKIN_DEPTH, 1e-6);
  c.SetParameter(P.SIGMA, 1.0 / RHO);
  c.SetParameter(P.ROUGH, 0);
  c.SetParameter(P.TAND, 0.02);
  c.SetParameter(P.ANG_L, 1);
  return c;
}

function coupledStripline(aWidth: number, aGap: number): COUPLED_STRIPLINE {
  const c = new COUPLED_STRIPLINE();
  c.SetParameter(P.Z0_E, 45);
  c.SetParameter(P.Z0_O, 45);
  c.SetParameter(P.Z_DIFF, 90);
  c.SetParameter(P.PHYS_WIDTH, aWidth);
  c.SetParameter(P.PHYS_S, aGap);
  c.SetParameter(P.T, 0.000035);
  c.SetParameter(P.H, 0.0001 + 0.000035 + 0.0001);
  c.SetParameter(P.EPSILONR, 4.5);
  c.SetParameter(P.SKIN_DEPTH, 1e-6);
  c.SetParameter(P.PHYS_LEN, 1.0);
  c.SetParameter(P.FREQUENCY, 1e9);
  c.SetParameter(P.ANG_L, 1.0);
  c.SetParameter(P.SIGMA, 1.0 / RHO);
  c.SetParameter(P.MURC, 1);
  return c;
}

describe('TRANSLINE_CALCULATION_BASE', () => {
  it('a parameter never set reads 0, like `m_parameters[aParam]` on a map', () => {
    const c = new MICROSTRIP();
    expect(c.GetParameter(P.PHYS_WIDTH)).toBe(0);
    expect(c.GetParameter(P.TWISTEDPAIR_TWIST)).toBe(0);
    c.SetParameter(P.PHYS_WIDTH, 0.002);
    expect(c.GetParameter(P.PHYS_WIDTH)).toBe(0.002);
  });

  it('UnitPropagationDelay is √εeff · 1e10 / 2.99e8 ps/cm, on upstream’s rounded c', () => {
    // Not 299 792 458: upstream writes 2.99e8, so vacuum is 33.4448, not 33.3564.
    expect(TRANSLINE_CALCULATION_BASE.UnitPropagationDelay(1)).toBeCloseTo(33.44481605, 7);
    expect(TRANSLINE_CALCULATION_BASE.UnitPropagationDelay(4)).toBeCloseTo(66.8896321, 6);
  });

  it('MinimiseZ0Error1D starts a zero width at 0.001 and converges to m_maxError', () => {
    const c = microstrip(0);
    expect(c.Synthesize(SYNTHESIZE_OPTS.DEFAULT)).toBe(true);
    const w = c.GetParameter(P.PHYS_WIDTH);
    expect(w).toBeGreaterThan(0);
    // Read back through the functional analyser: |Z0 − 50| ≤ 1e-6
    const a = microstripAnalyze(
      { widthM: w, heightM: 0.0001, thicknessM: 0.000035, lengthM: 10 },
      { frequencyHz: 1e9, epsilonR: 4.5, tanD: 0.02, sigma: 1 / RHO, mur: 1, murC: 1 },
    );
    expect(Math.abs(a.z0 - 50)).toBeLessThanOrEqual(1e-6 + 1e-9);
    // And the same width the Calculator Tools' synthesis finds.
    const f = microstripSynthesize(
      { widthM: 0.001, heightM: 0.0001, thicknessM: 0.000035, lengthM: 10 },
      { frequencyHz: 1e9, epsilonR: 4.5, tanD: 0.02, sigma: 1 / RHO, mur: 1, murC: 1 },
      50,
      1,
    );
    expect(f).not.toBeNull();
    expect(w).toBeCloseTo(f!.widthM, 9);
  });

  it('a non-finite target sets the width NaN and fails', () => {
    const c = microstrip(0.001);
    c.SetParameter(P.Z0, Number.NaN);
    expect(c.Synthesize(SYNTHESIZE_OPTS.DEFAULT)).toBe(false);
    expect(Number.isNaN(c.GetParameter(P.PHYS_WIDTH))).toBe(true);
  });
});

describe('MICROSTRIP results', () => {
  it('synthesis: the width and delay are OK, the length is Z0-derived', () => {
    const c = microstrip(0);
    c.Synthesize(SYNTHESIZE_OPTS.DEFAULT);
    const r = c.GetSynthesisResults();
    expect(r.get(P.PHYS_WIDTH)![1]).toBe(TRANSLINE_STATUS.OK);
    expect(r.get(P.UNIT_PROP_DELAY)![1]).toBe(TRANSLINE_STATUS.OK);
    expect(r.get(P.UNIT_PROP_DELAY)![0]).toBeGreaterThan(33.3564095);
    // ANG_L = 1 rad at 1 GHz on FR4 is a few mm of line, not the 10 m set.
    expect(c.GetParameter(P.PHYS_LEN)).toBeLessThan(0.05);
  });

  it('analysis of a zero width flags the width, not the delay', () => {
    const c = microstrip(0);
    c.Analyse();
    const r = c.GetAnalysisResults();
    expect(r.get(P.PHYS_WIDTH)![1]).not.toBe(TRANSLINE_STATUS.OK);
  });
});

describe('STRIPLINE results', () => {
  it('a track thicker than the dielectric is geometryInvalid: Z0 is written twice, WARNING last', () => {
    const c = new STRIPLINE();
    c.SetParameter(P.PHYS_WIDTH, 0.0002);
    c.SetParameter(P.EPSILONR, 4.5);
    c.SetParameter(P.T, 0.0003);
    c.SetParameter(P.STRIPLINE_A, 0.0001);
    c.SetParameter(P.H, 0.000235);
    c.SetParameter(P.Z0, 50);
    c.SetParameter(P.PHYS_LEN, 1);
    c.SetParameter(P.FREQUENCY, 1e9);
    c.SetParameter(P.TAND, 0.02);
    c.SetParameter(P.ANG_L, 1);
    c.SetParameter(P.SIGMA, 1 / RHO);
    c.SetParameter(P.MURC, 1);
    c.Analyse();
    // Upstream sets Z0 to TS_ERROR and then, four lines later, to WARNING.
    expect(c.GetAnalysisResults().get(P.Z0)![1]).toBe(TRANSLINE_STATUS.WARNING);
    expect(c.GetAnalysisResults().get(P.STRIPLINE_A)![1]).toBe(TRANSLINE_STATUS.WARNING);
    c.SetParameter(P.T, 0.000035);
    c.Analyse();
    expect(c.GetAnalysisResults().get(P.Z0)![1]).toBe(TRANSLINE_STATUS.OK);
  });
});

describe('COUPLED_MICROSTRIP', () => {
  it('DEFAULT synthesis is the 2-D Newton on both modes: Z0_E and Z0_O both land', () => {
    const c = coupledMicrostrip(0, 0);
    c.SetParameter(P.Z0_E, 60);
    c.SetParameter(P.Z0_O, 40);
    expect(c.Synthesize(SYNTHESIZE_OPTS.DEFAULT)).toBe(true);
    const w = c.GetParameter(P.PHYS_WIDTH);
    const s = c.GetParameter(P.PHYS_S);
    expect(w).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(0);
    // Synthesize restored the targets; analysing the result reproduces them.
    const check = coupledMicrostrip(w, s);
    check.Analyse();
    expect(check.GetParameter(P.Z0_E)).toBeCloseTo(60, 3);
    expect(check.GetParameter(P.Z0_O)).toBeCloseTo(40, 3);
    // The length is the geometric mean of the two modes' ANG_L = 1 lengths:
    // l = c / (f √εeff) · ANG_L / 2π for each mode, then √(le·lo).
    const r = c.GetSynthesisResults();
    const lenOf = (aEps: number): number => ((299792458 / 1e9 / Math.sqrt(aEps)) * 1) / 2 / Math.PI;
    const le = lenOf(r.get(P.EPSILON_EFF_EVEN)![0]);
    const lo = lenOf(r.get(P.EPSILON_EFF_ODD)![0]);
    expect(le).not.toBeCloseTo(lo, 6);
    expect(c.GetParameter(P.PHYS_LEN)).toBeCloseTo(Math.sqrt(le * lo), 12);
  });

  it('FIX_SPACING moves only the width, FIX_WIDTH only the gap, both onto Z0_O', () => {
    const a = coupledMicrostrip(0, 0.00015);
    expect(a.Synthesize(SYNTHESIZE_OPTS.FIX_SPACING)).toBe(true);
    expect(a.GetParameter(P.PHYS_S)).toBe(0.00015);
    expect(Math.abs(a.GetParameter(P.Z0_O) - 45)).toBeLessThanOrEqual(1e-6);
    const r = a.GetSynthesisResults();
    expect(r.get(P.PHYS_WIDTH)![1]).toBe(TRANSLINE_STATUS.OK);
    expect(r.get(P.PHYS_S)![1]).toBe(TRANSLINE_STATUS.OK);
    expect(r.get(P.UNIT_PROP_DELAY_ODD)![1]).toBe(TRANSLINE_STATUS.OK);
    expect(r.get(P.UNIT_PROP_DELAY_ODD)![0]).toBeGreaterThan(33.3564095);

    const b = coupledMicrostrip(0.0002, 0);
    expect(b.Synthesize(SYNTHESIZE_OPTS.FIX_WIDTH)).toBe(true);
    expect(b.GetParameter(P.PHYS_WIDTH)).toBe(0.0002);
    expect(Math.abs(b.GetParameter(P.Z0_O) - 45)).toBeLessThanOrEqual(1e-6);
  });

  it('analysis of a zero gap is a WARNING on the gap, an error on nothing else', () => {
    const c = coupledMicrostrip(0.0002, 0);
    c.Analyse();
    const r = c.GetAnalysisResults();
    expect(r.get(P.PHYS_S)![1]).toBe(TRANSLINE_STATUS.WARNING);
    expect(r.get(P.PHYS_WIDTH)![1]).toBe(TRANSLINE_STATUS.OK);
  });

  it('an impedance that came out NaN is an ERROR in analysis and a WARNING in synthesis', () => {
    // Inputs and outputs swap roles: what was typed in is only a warning when
    // analysing, what was solved for is only a warning when synthesising.
    const a = coupledMicrostrip(0, 0.00015);
    a.Analyse();
    expect(Number.isFinite(a.GetParameter(P.Z0_O))).toBe(false);
    expect(a.GetAnalysisResults().get(P.Z0_O)![1]).toBe(TRANSLINE_STATUS.TS_ERROR);
    expect(a.GetAnalysisResults().get(P.PHYS_WIDTH)![1]).toBe(TRANSLINE_STATUS.WARNING);

    const s = coupledMicrostrip(0, 0.00015);
    s.SetParameter(P.Z0_O, Number.NaN);
    expect(s.Synthesize(SYNTHESIZE_OPTS.FIX_SPACING)).toBe(false);
    expect(s.GetSynthesisResults().get(P.Z0_O)![1]).toBe(TRANSLINE_STATUS.WARNING);
    expect(s.GetSynthesisResults().get(P.PHYS_WIDTH)![1]).toBe(TRANSLINE_STATUS.TS_ERROR);
  });
});

describe('COUPLED_STRIPLINE', () => {
  it('FIX_SPACING / FIX_WIDTH land Z0_O; Z_DIFF is 2·Z0_O; ANG_L is 2πL/λg', () => {
    const a = coupledStripline(0, 0.00015);
    expect(a.Synthesize(SYNTHESIZE_OPTS.FIX_SPACING)).toBe(true);
    expect(Math.abs(a.GetParameter(P.Z0_O) - 45)).toBeLessThanOrEqual(1e-6);
    const r = a.GetSynthesisResults();
    expect(r.get(P.Z_DIFF)![0]).toBeCloseTo(2 * a.GetParameter(P.Z0_O), 9);
    expect(r.get(P.PHYS_WIDTH)![1]).toBe(TRANSLINE_STATUS.OK);
    expect(r.get(P.UNIT_PROP_DELAY_ODD)![1]).toBe(TRANSLINE_STATUS.OK);
    // 1 m of FR4 stripline at 1 GHz: εeff = εr = 4.5, λg = c/(f√4.5) ≈ 0.1413 m
    const lambda = 299792458 / 1e9 / Math.sqrt(4.5);
    expect(r.get(P.ANG_L)![0]).toBeCloseTo((2 * Math.PI * 1.0) / lambda, 6);
    expect(r.get(P.EPSILON_EFF_ODD)![0]).toBe(4.5);

    // 0.2 mm on a 0.235 mm stripline cannot reach 45 Ω odd at any gap: false.
    expect(coupledStripline(0.0002, 0).Synthesize(SYNTHESIZE_OPTS.FIX_WIDTH)).toBe(false);

    const b = coupledStripline(0.00005, 0);
    expect(b.Synthesize(SYNTHESIZE_OPTS.FIX_WIDTH)).toBe(true);
    expect(b.GetParameter(P.PHYS_WIDTH)).toBe(0.00005);
    expect(Math.abs(b.GetParameter(P.Z0_O) - 45)).toBeLessThanOrEqual(1e-6);
  });

  it('DEFAULT synthesis solves both modes and restores the targets', () => {
    const c = coupledStripline(0, 0);
    c.SetParameter(P.Z0_E, 55);
    c.SetParameter(P.Z0_O, 40);
    expect(c.Synthesize(SYNTHESIZE_OPTS.DEFAULT)).toBe(true);
    expect(c.GetParameter(P.Z0_E)).toBe(55);
    expect(c.GetParameter(P.Z0_O)).toBe(40);
    const check = coupledStripline(c.GetParameter(P.PHYS_WIDTH), c.GetParameter(P.PHYS_S));
    check.Analyse();
    expect(check.GetParameter(P.Z0_E)).toBeCloseTo(55, 2);
    expect(check.GetParameter(P.Z0_O)).toBeCloseTo(40, 2);
  });

  it('a synthesis result table uses the swapped statuses: outputs warn, inputs error', () => {
    const c = coupledStripline(0.0002, 0.00015);
    c.SetParameter(P.PHYS_LEN, -1);
    c.Analyse();
    expect(c.GetAnalysisResults().get(P.PHYS_LEN)![1]).toBe(TRANSLINE_STATUS.WARNING);
    c.Synthesize(SYNTHESIZE_OPTS.FIX_SPACING);
    expect(c.GetSynthesisResults().get(P.PHYS_LEN)![1]).toBe(TRANSLINE_STATUS.TS_ERROR);
  });
});
