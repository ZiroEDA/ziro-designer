// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, expect, it } from 'vitest';
import {
  REGULATOR_DEFAULTS,
  REGULATOR_TYPE_CHOICES,
  RegulatorSolve,
  RegulatorType,
  printfG,
  solveRegulator,
} from '@ziroeda/pcb_calculator';

const lm317 = {
  type: RegulatorType.THREE_TERMINAL,
  vrefMin: 1.2,
  vrefTyp: 1.25,
  vrefMax: 1.3,
  iadjTyp: 50e-6,
  iadjMax: 100e-6,
  resTolPct: 1,
};

describe('regulator calculator', () => {
  it('solves Vout for the LM317 datasheet example (R1=240, R2=720)', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.VOUT,
      r1Typ: 240,
      r2Typ: 720,
      voutTyp: 0,
    });
    // Vout = 1.25 * (240+720)/240 + 50µ*720 = 5 + 0.036 = 5.036
    expect(r.vout.typ).toBeCloseTo(5.036, 3);
    expect(r.vout.min).toBeLessThan(r.vout.typ);
    expect(r.vout.max).toBeGreaterThan(r.vout.typ);
    expect(r.tolNegPct).toBeLessThan(0);
    expect(r.tolPosPct).toBeGreaterThan(0);
  });

  it('solves R2 and round-trips through Vout', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.R2,
      r1Typ: 240,
      r2Typ: 0,
      voutTyp: 5,
    });
    const back = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.VOUT,
      r1Typ: 240,
      r2Typ: r.r2.typ,
      voutTyp: 0,
    });
    expect(back.vout.typ).toBeCloseTo(5, 9);
  });

  it('solves R1 and round-trips through Vout', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.R1,
      r1Typ: 0,
      r2Typ: 720,
      voutTyp: 5,
    });
    const back = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.VOUT,
      r1Typ: r.r1.typ,
      r2Typ: 720,
      voutTyp: 0,
    });
    expect(back.vout.typ).toBeCloseTo(5, 9);
  });

  it('standard type uses Vout = Vref·(R1+R2)/R2 and ignores Iadj', () => {
    const r = solveRegulator({
      type: RegulatorType.STANDARD,
      solve: RegulatorSolve.VOUT,
      r1Typ: 3000,
      r2Typ: 1000,
      voutTyp: 0,
      vrefMin: 1.2,
      vrefTyp: 1.25,
      vrefMax: 1.3,
      iadjTyp: 50e-6,
      iadjMax: 100e-6,
      resTolPct: 0,
    });
    // 1.25 · (3000+1000) / 1000 = 5
    expect(r.vout.typ).toBeCloseTo(5, 9);
  });

  it('standard type solves R1 and R2 back (Vref·(R1+R2)/R2)', () => {
    const std = {
      type: RegulatorType.STANDARD,
      vrefMin: 1.2,
      vrefTyp: 1.25,
      vrefMax: 1.3,
      iadjTyp: 0,
      iadjMax: 0,
      resTolPct: 0,
    };
    const r1 = solveRegulator({
      ...std,
      solve: RegulatorSolve.R1,
      r1Typ: 0,
      r2Typ: 1000,
      voutTyp: 5,
    });
    expect(r1.r1.typ).toBeCloseTo(3000, 6);
    const r2 = solveRegulator({
      ...std,
      solve: RegulatorSolve.R2,
      r1Typ: 3000,
      r2Typ: 0,
      voutTyp: 5,
    });
    expect(r2.r2.typ).toBeCloseTo(1000, 6);
  });

  it('flags impossible targets', () => {
    const r = solveRegulator({
      ...lm317,
      solve: RegulatorSolve.R1,
      r1Typ: 0,
      r2Typ: 720,
      voutTyp: 1.0, // below Vref
    });
    expect(r.error).toBeTruthy();
  });
});

/**
 * The five guards KiCad checks, in KiCad's order, with KiCad's exact wording.
 * These strings go on screen verbatim in `m_RegulMessage`
 * (panel_regulator.cpp:398-437), so a reworded one is a parity defect even when
 * it says the same thing. Confirmed against the running 10.0.5 binary: entering
 * Vref typ = 0 there prints "Vref set to 0 !", space before the bang included.
 */
describe('regulator validation messages are KiCad’s, character for character', () => {
  const base = {
    ...lm317,
    solve: RegulatorSolve.R1,
    r1Typ: 240,
    r2Typ: 720,
    voutTyp: 5,
  };

  it('Vout below any of the three Vrefs, when not solving for Vout', () => {
    expect(solveRegulator({ ...base, voutTyp: 1 }).error).toBe('Vout must be greater than Vref');
  });

  it('...and that check does NOT run when Vout is the unknown', () => {
    expect(
      solveRegulator({ ...base, solve: RegulatorSolve.VOUT, voutTyp: 1 }).error,
    ).toBeUndefined();
  });

  it('any of the three Vref cells at zero', () => {
    expect(solveRegulator({ ...base, vrefTyp: 0 }).error).toBe('Vref set to 0 !');
    expect(solveRegulator({ ...base, vrefMin: 0 }).error).toBe('Vref set to 0 !');
    expect(solveRegulator({ ...base, vrefMax: 0 }).error).toBe('Vref set to 0 !');
  });

  it('Vout is checked BEFORE Vref = 0, so the Vout message wins a tie', () => {
    expect(solveRegulator({ ...base, voutTyp: 1, vrefTyp: 0 }).error).toBe(
      'Vout must be greater than Vref',
    );
  });

  it('Vref out of order', () => {
    expect(solveRegulator({ ...base, vrefMin: 1.4 }).error).toBe(
      'Vref must VrefMin < VrefTyp < VrefMax',
    );
  });

  it('R2 at or below zero while R2 is not the unknown', () => {
    expect(solveRegulator({ ...base, r2Typ: 0 }).error).toBe('Incorrect value for R1 R2');
    expect(solveRegulator({ ...base, solve: RegulatorSolve.R2, r2Typ: 0 }).error).toBeUndefined();
  });

  it('R1 below zero while R1 is not the unknown', () => {
    expect(solveRegulator({ ...base, solve: RegulatorSolve.R2, r1Typ: -1 }).error).toBe(
      'Incorrect value for R1 R2',
    );
  });

  it('Iadj out of order — three-terminal only', () => {
    expect(solveRegulator({ ...base, iadjTyp: 200e-6 }).error).toBe('Iadj must IadjTyp < IadjMax');
    expect(
      solveRegulator({ ...base, type: RegulatorType.STANDARD, iadjTyp: 200e-6 }).error,
    ).toBeUndefined();
  });

  it('the defaults compute, and print exactly what the real binary prints', () => {
    // Driven side by side against pcb_calculator 10.0.5: defaults, 3 Terminal
    // Type, solving for R1, Calculate -> R1 0.24/0.242/0.245 kΩ,
    // R2 0.713/0.72/0.727 kΩ, Vout 4.73/5/5.313 V, tolerance -5.39/5.9 %.
    const r = solveRegulator(base);
    expect(r.error).toBeUndefined();
    const g = (v: number, step = 0.001): string =>
      printfG(Number((Math.round(v / step) * step).toPrecision(12)));
    expect([g(r.r1.min / 1000), g(r.r1.typ / 1000), g(r.r1.max / 1000)]).toStrictEqual([
      '0.24',
      '0.242',
      '0.245',
    ]);
    expect([g(r.r2.min / 1000), g(r.r2.typ / 1000), g(r.r2.max / 1000)]).toStrictEqual([
      '0.713',
      '0.72',
      '0.727',
    ]);
    expect([g(r.vout.min), g(r.vout.typ), g(r.vout.max)]).toStrictEqual(['4.73', '5', '5.313']);
    expect([g(r.tolNegPct, 0.01), g(r.tolPosPct, 0.01)]).toStrictEqual(['-5.39', '5.9']);
  });
});

describe('the Type choice and the Reset defaults are KiCad’s, not ours', () => {
  it('Standard Type is index 0 and 3 Terminal Type index 1', () => {
    expect(REGULATOR_TYPE_CHOICES.map((c) => c.label)).toStrictEqual([
      'Standard Type',
      '3 Terminal Type',
    ]);
    expect(REGULATOR_TYPE_CHOICES.map((c) => c.value)).toStrictEqual([
      RegulatorType.STANDARD,
      RegulatorType.THREE_TERMINAL,
    ]);
  });

  it('Reset to Defaults writes the DEFAULT_REGULATOR_* strings verbatim', () => {
    // pcb_calculator_settings.h:32-40. They are STRINGS in KiCad and the field
    // shows "0.240", not "0.24" — a numeric default would lose the zero.
    expect(REGULATOR_DEFAULTS.r1Typ).toBe('0.240');
    expect(REGULATOR_DEFAULTS.r2Typ).toBe('0.720');
    expect(REGULATOR_DEFAULTS.vrefMin).toBe('1.20');
    expect(REGULATOR_DEFAULTS.vrefTyp).toBe('1.25');
    expect(REGULATOR_DEFAULTS.vrefMax).toBe('1.30');
    expect(REGULATOR_DEFAULTS.voutTyp).toBe('5');
    expect(REGULATOR_DEFAULTS.iadjTyp).toBe('50');
    expect(REGULATOR_DEFAULTS.iadjMax).toBe('100');
    expect(REGULATOR_DEFAULTS.resTol).toBe('1');
  });

  it('Reset clears the six computed cells and both tolerances', () => {
    for (const k of [
      'r1Min',
      'r1Max',
      'r2Min',
      'r2Max',
      'voutMin',
      'voutMax',
      'tolMin',
      'tolMax',
    ] as const)
      expect(REGULATOR_DEFAULTS[k]).toBe('');
  });

  it('Reset selects 3 Terminal Type and the Vout radio', () => {
    // panel_regulator.cpp:99-101: SetSelection( 1 ), and m_rbRegulVout true.
    expect(REGULATOR_DEFAULTS.type).toBe(RegulatorType.THREE_TERMINAL);
    expect(REGULATOR_DEFAULTS.solve).toBe(RegulatorSolve.VOUT);
  });
});
