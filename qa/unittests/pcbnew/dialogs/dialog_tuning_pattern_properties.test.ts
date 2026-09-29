// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TUNING_PATTERN_PROPERTIES's own logic, over a plain
 * `PNS::MEANDER_SETTINGS` (no live BOARD item is involved — see the port's
 * own doc comment for why).
 */
import { describe, expect, it } from 'vitest';
import {
  IU_PER_PS,
  MEANDER_DELAY_UNCONSTRAINED,
  MEANDER_LENGTH_UNCONSTRAINED,
  MEANDER_SKEW_UNCONSTRAINED,
  MeanderStyle,
  defaultMeanderSettings,
  minOptMaxOpt,
  setTargetLength,
  setTargetLengthDelay,
  setTargetSkew,
  setTargetSkewDelay,
  type MeanderSettings,
} from '@ziroeda/pcbnew/router/pns_meander.js';
import { PnsRouterMode } from '@ziroeda/pcbnew/router/pns_router.js';
import { pcbMmToIU } from '@ziroeda/common/eda_units.js';
import {
  NULL_TUNING_CONSTRAINT,
  initialTuningPatternValues,
  psText,
  psValue,
  tuningPatternEnableState,
  tuningPatternOverrideToggled,
  tuningPatternRadioDelaySelected,
  tuningPatternRadioLengthSelected,
  tuningPatternSourceInfoText,
  tuningPatternTransferFromWindow,
  type TuningConstraintInput,
  type TuningPatternFormValues,
} from '@ziroeda/pcbnew/dialogs/dialog_tuning_pattern_properties.js';

const MM = (n: number): number => pcbMmToIU(n);
const UNITS = 'mm' as const;

function settings(patch: Partial<MeanderSettings> = {}): MeanderSettings {
  return { ...defaultMeanderSettings(), ...patch };
}

function ruleConstraint(patch: Partial<TuningConstraintInput> = {}): TuningConstraintInput {
  return {
    isNull: false,
    name: "rule 'max-length'",
    value: { opt: MM(50) },
    spaceDomain: true,
    ...patch,
  };
}

describe('psText / psValue', () => {
  it('round-trips a whole number of picoseconds', () => {
    expect(psText(500 * IU_PER_PS)).toBe('500');
    expect(psValue('500')).toBe(500 * IU_PER_PS);
  });

  it('trims trailing zeros on a fraction', () => {
    expect(psText(1.5 * IU_PER_PS)).toBe('1.5');
  });
});

describe('initialTuningPatternValues (TransferDataToWindow)', () => {
  it('single/diff-pair mode, length domain: shows the length, blanks the delay', () => {
    const s = settings();
    setTargetLength(s, MM(25));
    s.isTimeDomain = false;

    const v = initialTuningPatternValues(s, PnsRouterMode.PNS_MODE_TUNE_SINGLE, UNITS);

    expect(Number(v.targetLengthText)).toBeCloseTo(25, 6);
    expect(v.targetDelayText).toBe('');
    expect(v.lengthSelected).toBe(true);
  });

  it('an unconstrained length blanks the field instead of printing the sentinel', () => {
    const s = settings();
    setTargetLength(s, MEANDER_LENGTH_UNCONSTRAINED);
    s.isTimeDomain = false;

    const v = initialTuningPatternValues(s, PnsRouterMode.PNS_MODE_TUNE_SINGLE, UNITS);

    expect(v.targetLengthText).toBe('');
  });

  it('time domain: shows the delay, blanks the length', () => {
    const s = settings();
    setTargetLengthDelay(s, 250 * IU_PER_PS);
    s.isTimeDomain = true;

    const v = initialTuningPatternValues(s, PnsRouterMode.PNS_MODE_TUNE_SINGLE, UNITS);

    expect(v.targetDelayText).toBe('250');
    expect(v.targetLengthText).toBe('');
    expect(v.lengthSelected).toBe(false);
  });

  it('an unconstrained delay blanks the field', () => {
    const s = settings();
    setTargetLengthDelay(s, MEANDER_DELAY_UNCONSTRAINED);
    s.isTimeDomain = true;

    const v = initialTuningPatternValues(s, PnsRouterMode.PNS_MODE_TUNE_SINGLE, UNITS);

    expect(v.targetDelayText).toBe('');
  });

  it('skew mode reads m_targetSkew / m_targetSkewDelay, not the length fields', () => {
    const s = settings();
    setTargetSkew(s, MM(3));
    setTargetSkewDelay(s, 40 * IU_PER_PS);
    s.isTimeDomain = false;

    const v = initialTuningPatternValues(s, PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW, UNITS);

    expect(Number(v.targetLengthText)).toBeCloseTo(3, 6);
    expect(v.targetDelayText).toBe('');
  });

  it('carries amplitude, spacing, corner style/radius and single-sided through unchanged', () => {
    const s = settings({
      minAmplitude: MM(0.1),
      maxAmplitude: MM(0.6),
      spacing: MM(0.4),
      cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER,
      cornerRadiusPercentage: 55,
      singleSided: true,
    });

    const v = initialTuningPatternValues(s, PnsRouterMode.PNS_MODE_TUNE_SINGLE, UNITS);

    expect(v.minAmplitude).toBe(MM(0.1));
    expect(v.maxAmplitude).toBe(MM(0.6));
    expect(v.spacing).toBe(MM(0.4));
    expect(v.cornerStyle).toBe(MeanderStyle.MEANDER_STYLE_CHAMFER);
    expect(v.cornerRadiusPercentage).toBe(55);
    expect(v.singleSided).toBe(true);
  });
});

describe('tuningPatternEnableState', () => {
  it('no constraint: both radios and the domain field they select are enabled', () => {
    const e = tuningPatternEnableState(
      { overrideCustomRules: false, lengthSelected: true },
      NULL_TUNING_CONSTRAINT,
    );
    expect(e).toMatchObject({
      radioLengthEnabled: true,
      radioDelayEnabled: true,
      targetLengthEnabled: true,
      targetDelayEnabled: false,
      sourceInfoVisible: false,
    });
  });

  it('a constraint with override OFF locks the radios and shows the source line', () => {
    const e = tuningPatternEnableState(
      { overrideCustomRules: false, lengthSelected: true },
      ruleConstraint(),
    );
    expect(e.radioLengthEnabled).toBe(false);
    expect(e.radioDelayEnabled).toBe(false);
    expect(e.targetLengthEnabled).toBe(false);
    expect(e.sourceInfoVisible).toBe(true);
  });

  it('checking override unlocks the radios and hides the source line', () => {
    const e = tuningPatternEnableState(
      { overrideCustomRules: true, lengthSelected: true },
      ruleConstraint(),
    );
    expect(e.radioLengthEnabled).toBe(true);
    expect(e.targetLengthEnabled).toBe(true);
    expect(e.sourceInfoVisible).toBe(false);
  });

  it('delay radio selected flips which field is live', () => {
    const e = tuningPatternEnableState(
      { overrideCustomRules: false, lengthSelected: false },
      NULL_TUNING_CONSTRAINT,
    );
    expect(e.targetLengthEnabled).toBe(false);
    expect(e.targetDelayEnabled).toBe(true);
  });
});

describe('tuningPatternSourceInfoText', () => {
  it('wraps the constraint name in "(from %s)"', () => {
    expect(tuningPatternSourceInfoText(ruleConstraint({ name: "rule 'x'" }))).toBe(
      "(from rule 'x')",
    );
  });
});

describe('tuningPatternOverrideToggled', () => {
  const base: TuningPatternFormValues = {
    targetLengthText: '12',
    targetDelayText: '',
    overrideCustomRules: true,
    lengthSelected: true,
    minAmplitude: MM(0.2),
    maxAmplitude: MM(1),
    spacing: MM(0.6),
    cornerStyle: MeanderStyle.MEANDER_STYLE_ROUND,
    cornerRadiusPercentage: 80,
    singleSided: false,
  };

  it('checking touches neither text field', () => {
    const next = tuningPatternOverrideToggled(base, true, ruleConstraint(), UNITS);
    expect(next.targetLengthText).toBe('12');
    expect(next.targetDelayText).toBe('');
  });

  it('unchecking with a space-domain rule fills the length field and blanks the delay', () => {
    const next = tuningPatternOverrideToggled(
      base,
      false,
      ruleConstraint({ value: { opt: MM(30) }, spaceDomain: true }),
      UNITS,
    );
    expect(Number(next.targetLengthText)).toBeCloseTo(30, 6);
    expect(next.targetDelayText).toBe('');
  });

  it('unchecking with a time-domain rule fills the delay field and blanks the length', () => {
    const next = tuningPatternOverrideToggled(
      base,
      false,
      ruleConstraint({ value: { opt: 75 * IU_PER_PS }, spaceDomain: false }),
      UNITS,
    );
    expect(next.targetDelayText).toBe('75');
    expect(next.targetLengthText).toBe('');
  });

  it('unchecking with no constraint leaves the fields alone', () => {
    const next = tuningPatternOverrideToggled(base, false, NULL_TUNING_CONSTRAINT, UNITS);
    expect(next.targetLengthText).toBe('12');
  });
});

describe('tuningPatternRadioLengthSelected / DelaySelected', () => {
  it('select length', () => {
    const v = tuningPatternRadioLengthSelected({
      ...defaultFormValues(),
      lengthSelected: false,
    });
    expect(v.lengthSelected).toBe(true);
  });

  it('select delay', () => {
    const v = tuningPatternRadioDelaySelected({
      ...defaultFormValues(),
      lengthSelected: true,
    });
    expect(v.lengthSelected).toBe(false);
  });
});

describe('tuningPatternTransferFromWindow (TransferDataFromWindow)', () => {
  it('writes a typed length, blank delay, in single mode', () => {
    const v: TuningPatternFormValues = {
      ...defaultFormValues(),
      targetLengthText: '40',
      lengthSelected: true,
    };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_SINGLE,
      true,
      settings(),
      NULL_TUNING_CONSTRAINT,
      UNITS,
    );
    expect(minOptMaxOpt(next.targetLength)).toBe(MM(40));
    expect(next.isTimeDomain).toBe(false);
  });

  it('an empty length field writes LENGTH_UNCONSTRAINED', () => {
    const v: TuningPatternFormValues = { ...defaultFormValues(), targetLengthText: '' };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_SINGLE,
      true,
      settings(),
      NULL_TUNING_CONSTRAINT,
      UNITS,
    );
    expect(minOptMaxOpt(next.targetLength)).toBe(MEANDER_LENGTH_UNCONSTRAINED);
  });

  it('a typed delay in delay domain writes SetTargetLengthDelay', () => {
    const v: TuningPatternFormValues = {
      ...defaultFormValues(),
      targetDelayText: '90',
      lengthSelected: false,
    };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_SINGLE,
      true,
      settings(),
      NULL_TUNING_CONSTRAINT,
      UNITS,
    );
    expect(minOptMaxOpt(next.targetLengthDelay)).toBe(90 * IU_PER_PS);
    expect(next.isTimeDomain).toBe(true);
  });

  it('does not flip isTimeDomain when the radios are locked (a rule owns the domain)', () => {
    const v: TuningPatternFormValues = { ...defaultFormValues(), lengthSelected: false };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_SINGLE,
      /* radioLengthEnabled */ false,
      settings({ isTimeDomain: false }),
      ruleConstraint(),
      UNITS,
    );
    expect(next.isTimeDomain).toBe(false);
  });

  it('matching the constraint by length keeps the constraint min/max via the FromConstraint setter', () => {
    const constraint = ruleConstraint({ value: { min: MM(10), opt: MM(30), max: MM(60) } });
    const v: TuningPatternFormValues = { ...defaultFormValues(), targetLengthText: '30' };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_SINGLE,
      true,
      settings(),
      constraint,
      UNITS,
    );
    expect(next.targetLength).toEqual({ min: MM(10), opt: MM(30), max: MM(60) });
  });

  it('not matching the constraint uses a fresh tolerance window instead of the constraint bounds', () => {
    const constraint = ruleConstraint({ value: { min: MM(10), opt: MM(30), max: MM(60) } });
    const v: TuningPatternFormValues = { ...defaultFormValues(), targetLengthText: '31' };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_SINGLE,
      true,
      settings(),
      constraint,
      UNITS,
    );
    expect(next.targetLength.max).not.toBe(MM(60));
  });

  it('skew mode, matching the constraint: direct field assignment keeps the constraint object verbatim', () => {
    const constraint = ruleConstraint({ value: { min: MM(1), opt: MM(5) } }); // no explicit max
    const v: TuningPatternFormValues = {
      ...defaultFormValues(),
      targetLengthText: '5',
    };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW,
      true,
      settings(),
      constraint,
      UNITS,
    );
    // The direct-assignment quirk: max is left undefined, not tolerance-filled.
    expect(next.targetSkew).toEqual({ min: MM(1), opt: MM(5) });
  });

  it('skew mode, matching the constraint on the DELAY field: goes through the setter (tolerance-filled unless the constraint states its own)', () => {
    const constraint = ruleConstraint({ value: { opt: 20 * IU_PER_PS } });
    const v: TuningPatternFormValues = {
      ...defaultFormValues(),
      targetDelayText: '20',
    };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW,
      true,
      settings(),
      constraint,
      UNITS,
    );
    expect(next.targetSkewDelay.opt).toBe(20 * IU_PER_PS);
    expect(next.targetSkewDelay.max).toBeGreaterThan(20 * IU_PER_PS);
  });

  it('an empty skew field writes SKEW_UNCONSTRAINED, not LENGTH_UNCONSTRAINED', () => {
    const v: TuningPatternFormValues = { ...defaultFormValues(), targetLengthText: '' };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW,
      true,
      settings(),
      NULL_TUNING_CONSTRAINT,
      UNITS,
    );
    expect(minOptMaxOpt(next.targetSkew)).toBe(MEANDER_SKEW_UNCONSTRAINED);
  });

  it('carries override, amplitude, spacing, corner style/radius and single-sided', () => {
    const v: TuningPatternFormValues = {
      ...defaultFormValues(),
      overrideCustomRules: true,
      minAmplitude: MM(0.15),
      maxAmplitude: MM(0.9),
      spacing: MM(0.5),
      cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER,
      cornerRadiusPercentage: 33,
      singleSided: true,
    };
    const next = tuningPatternTransferFromWindow(
      v,
      PnsRouterMode.PNS_MODE_TUNE_SINGLE,
      true,
      settings(),
      NULL_TUNING_CONSTRAINT,
      UNITS,
    );
    expect(next).toMatchObject({
      overrideCustomRules: true,
      minAmplitude: MM(0.15),
      maxAmplitude: MM(0.9),
      spacing: MM(0.5),
      cornerStyle: MeanderStyle.MEANDER_STYLE_CHAMFER,
      cornerRadiusPercentage: 33,
      singleSided: true,
    });
  });
});

function defaultFormValues(): TuningPatternFormValues {
  return {
    targetLengthText: '',
    targetDelayText: '',
    overrideCustomRules: false,
    lengthSelected: true,
    minAmplitude: MM(0.2),
    maxAmplitude: MM(1),
    spacing: MM(0.6),
    cornerStyle: MeanderStyle.MEANDER_STYLE_ROUND,
    cornerRadiusPercentage: 80,
    singleSided: false,
  };
}
