// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Adjustable-regulator divider maths with worst-case (min/typ/max) analysis.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_regulator.cpp`
 * + `pcb_calculator/class_regulator_data.h`.
 *
 * 3-terminal type:  Vout = Vref · (R1 + R2) / R1 + Iadj · R2
 * Standard type:    Vout = Vref · (R1 + R2) / R2
 * (R1 from output to ADJ/FB, R2 from ADJ/FB to ground, as drawn on the panel.)
 */

export enum RegulatorType {
  STANDARD = 0,
  THREE_TERMINAL = 1,
}

export interface RegulatorData {
  name: string;
  vrefMin: number;
  vrefTyp: number;
  vrefMax: number;
  /** Adjust-pin current in amps (3-terminal type only). */
  iadjTyp: number;
  iadjMax: number;
  type: RegulatorType;
}

/** Ships with the tool, like KiCad's default `pcb_calculator.ini` datafile. */
export const BUILTIN_REGULATORS: readonly RegulatorData[] = [
  {
    name: 'LM317',
    vrefMin: 1.2,
    vrefTyp: 1.25,
    vrefMax: 1.3,
    iadjTyp: 50e-6,
    iadjMax: 100e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
  {
    name: 'LM1117',
    vrefMin: 1.225,
    vrefTyp: 1.25,
    vrefMax: 1.275,
    iadjTyp: 60e-6,
    iadjMax: 120e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
  {
    name: 'LT1086',
    vrefMin: 1.225,
    vrefTyp: 1.25,
    vrefMax: 1.27,
    iadjTyp: 55e-6,
    iadjMax: 120e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
  {
    name: 'LM2596',
    vrefMin: 1.193,
    vrefTyp: 1.23,
    vrefMax: 1.267,
    iadjTyp: 0,
    iadjMax: 0,
    type: RegulatorType.STANDARD,
  },
  {
    name: 'TL431',
    vrefMin: 2.44,
    vrefTyp: 2.495,
    vrefMax: 2.55,
    iadjTyp: 2e-6,
    iadjMax: 4e-6,
    type: RegulatorType.THREE_TERMINAL,
  },
];

/**
 * The two entries of `m_choiceRegType`, in the order wxFormBuilder declares them
 * — `{ _("Standard Type"), _("3 Terminal Type") }`, so Standard is index 0
 * (panel_regulator_base.cpp:33 and dialog_regulator_form_base.cpp:64). The
 * index IS the RegulatorType, and it is what gets saved to settings, so the
 * order is not cosmetic.
 */
export const REGULATOR_TYPE_CHOICES: readonly { value: RegulatorType; label: string }[] = [
  { value: RegulatorType.STANDARD, label: 'Standard Type' },
  { value: RegulatorType.THREE_TERMINAL, label: '3 Terminal Type' },
];

/**
 * What `Reset to Defaults` writes into each control, verbatim as strings,
 * because KiCad writes strings (`m_r1TypVal->SetValue( wxT( "0.240" ) )`) and
 * the field shows `0.240`, not `0.24`. The values are the DEFAULT_REGULATOR_*
 * macros in `pcb_calculator_settings.h:32-40`; the empty cells and the radio /
 * type selection are `PANEL_REGULATOR::OnRegulatorResetButtonClick`
 * (panel_regulator.cpp:72-102), which touches nothing else on the page — not
 * the regulator list, not the data file, not the power comment, not the
 * message.
 */
export const REGULATOR_DEFAULTS = {
  resTol: '1',
  r1Min: '',
  r1Typ: '0.240',
  r1Max: '',
  r2Min: '',
  r2Typ: '0.720',
  r2Max: '',
  vrefMin: '1.20',
  vrefTyp: '1.25',
  vrefMax: '1.30',
  voutMin: '',
  voutTyp: '5',
  voutMax: '',
  iadjTyp: '50',
  iadjMax: '100',
  tolMin: '',
  tolMax: '',
  type: RegulatorType.THREE_TERMINAL,
  solve: 2 as const, // RegulatorSolve.VOUT — declared below
} as const;

export enum RegulatorSolve {
  R1 = 0,
  R2 = 1,
  VOUT = 2,
}

export interface RegulatorParams {
  type: RegulatorType;
  /** Which quantity to solve for; the other two must carry `typ` values. */
  solve: RegulatorSolve;
  r1Typ: number; // ohms
  r2Typ: number; // ohms
  voutTyp: number; // volts
  vrefMin: number;
  vrefTyp: number;
  vrefMax: number;
  iadjTyp: number; // amps (0 for standard type)
  iadjMax: number; // amps
  /** Resistor tolerance in percent (e.g. 1). */
  resTolPct: number;
}

export interface RegulatorResult {
  r1: { min: number; typ: number; max: number };
  r2: { min: number; typ: number; max: number };
  vout: { min: number; typ: number; max: number };
  /** Overall output tolerance vs typ, percent (negative and positive side). */
  tolNegPct: number;
  tolPosPct: number;
  error?: string;
}

/**
 * Solve the divider and compute the min/typ/max columns, using KiCad's exact
 * per-type equations and worst-case corners:
 *   3-terminal: Vout = Vref·(R1+R2)/R1 + Iadj·R2
 *   standard:   Vout = Vref·(R1+R2)/R2
 * (`solve` picks which of R1/R2/Vout is derived from the other two typicals.)
 */
export function solveRegulator(p: RegulatorParams): RegulatorResult {
  let r1 = p.r1Typ;
  let r2 = p.r2Typ;
  let vout = p.voutTyp;
  const { vrefMin, vrefTyp, vrefMax, resTolPct } = p;
  const restol = resTolPct / 100;

  const fail = (msg: string): RegulatorResult => ({
    r1: nan3(),
    r2: nan3(),
    vout: nan3(),
    tolNegPct: NaN,
    tolPosPct: NaN,
    error: msg,
  });

  // KiCad's five guards, in KiCad's order, with KiCad's exact wording
  // (panel_regulator.cpp:398-437). The order is load-bearing: a page with both
  // Vout < Vref AND Vref = 0 shows the Vout message, not the Vref one, and
  // these strings go on screen verbatim.
  if ((vout < vrefMin || vout < vrefTyp || vout < vrefMax) && p.solve !== RegulatorSolve.VOUT)
    return fail('Vout must be greater than Vref');

  if (vrefMin === 0 || vrefTyp === 0 || vrefMax === 0) return fail('Vref set to 0 !');

  if (vrefMin > vrefTyp || vrefTyp > vrefMax) return fail('Vref must VrefMin < VrefTyp < VrefMax');

  if ((r1 < 0 && p.solve !== RegulatorSolve.R1) || (r2 <= 0 && p.solve !== RegulatorSolve.R2))
    return fail('Incorrect value for R1 R2');

  let voutMin: number;
  let voutMax: number;

  if (p.type === RegulatorType.THREE_TERMINAL) {
    const iadjTyp = p.iadjTyp;
    const iadjMax = p.iadjMax;
    if (iadjTyp > iadjMax) return fail('Iadj must IadjTyp < IadjMax');

    if (p.solve === RegulatorSolve.R1) {
      r1 = (vrefTyp * r2) / (vout - vrefTyp - r2 * iadjTyp);
    } else if (p.solve === RegulatorSolve.R2) {
      r2 = (vout - vrefTyp) / (iadjTyp + vrefTyp / r1);
    } else {
      vout = (vrefTyp * (r1 + r2)) / r1 + r2 * iadjTyp;
    }
    const r1min = r1 - r1 * restol;
    const r1max = r1 + r1 * restol;
    const r2min = r2 - r2 * restol;
    const r2max = r2 + r2 * restol;
    voutMin = (vrefMin * (r1max + r2min)) / r1max + r2min * iadjTyp;
    voutMax = (vrefMax * (r1min + r2max)) / r1min + r2max * iadjMax;
  } else {
    // Standard type: Vout = Vref·(R1+R2)/R2, no Iadj.
    if (p.solve === RegulatorSolve.R1) {
      r1 = (vout / vrefTyp - 1) * r2;
    } else if (p.solve === RegulatorSolve.R2) {
      r2 = r1 / (vout / vrefTyp - 1);
    } else {
      vout = (vrefTyp * (r1 + r2)) / r2;
    }

    const r1min = r1 - r1 * restol;
    const r1max = r1 + r1 * restol;
    const r2min = r2 - r2 * restol;
    const r2max = r2 + r2 * restol;
    voutMin = (vrefMin * (r1min + r2max)) / r2max;
    voutMax = (vrefMax * (r1max + r2min)) / r2min;
  }

  return {
    r1: { min: r1 - r1 * restol, typ: r1, max: r1 + r1 * restol },
    r2: { min: r2 - r2 * restol, typ: r2, max: r2 + r2 * restol },
    vout: { min: voutMin, typ: vout, max: voutMax },
    // KiCad's normalization: min vs typ, max vs itself.
    tolNegPct: ((voutMin - vout) / vout) * 100,
    tolPosPct: ((voutMax - vout) / voutMax) * 100,
  };
}

const nan3 = (): { min: number; typ: number; max: number } => ({
  min: NaN,
  typ: NaN,
  max: NaN,
});
