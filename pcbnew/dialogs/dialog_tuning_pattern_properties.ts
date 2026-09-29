// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Length Tuning Settings, over the `_base.cpp` sizer tree ported in
 * `dialog_tuning_pattern_properties_ui.tsx`. Counterpart:
 * `pcbnew/dialogs/dialog_tuning_pattern_properties.cpp`.
 *
 * The dialog edits a router session's live `PNS::MEANDER_SETTINGS`
 * ({@link MeanderSettings}, `pns_meander.ts`) — not a board item — so there is
 * no `TransferDataToWindow` reading a `BOARD_ITEM`; the values below ARE the
 * form state, and `tuningPatternTransferFromWindow` is the only place that
 * writes back into a settings object.
 *
 * `ShowPropertiesDialog` (`generators/pcb_tuning_pattern.cpp`, the "Length
 * Tuning Settings" button/hotkey while an interactive meander placer is
 * active) is `PCB_TUNING_PATTERN`'s tool half, which is unbuilt here —
 * `generators/pcb_tuning_pattern.ts`'s own header says so, pending #636 stage
 * 3 (`GENERATOR_TOOL`). This file and its `_ui.tsx` are ported and tested
 * standalone, same as `dialog_reference_image_properties.ts`'s courtyard
 * cousins were before their tools landed.
 */

import {
  IU_PER_PS,
  MEANDER_DELAY_UNCONSTRAINED,
  MEANDER_LENGTH_UNCONSTRAINED,
  MEANDER_SKEW_UNCONSTRAINED,
  MeanderStyle,
  type MeanderSettings,
  minOptMaxOpt,
  setTargetLength,
  setTargetLengthDelay,
  setTargetLengthDelayFromConstraint,
  setTargetLengthFromConstraint,
  setTargetSkew,
  setTargetSkewDelay,
  setTargetSkewDelayFromConstraint,
} from '../router/pns_meander.js';
import { PnsRouterMode } from '../router/pns_router.js';
import type { MinOptMax } from '../drc/drc_rule_view.js';
import { pcbUnitText, pcbUnitValue } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';

/** The three tuning modes `DIALOG_TUNING_PATTERN_PROPERTIES` is built for. */
export type TuningPatternMode =
  | PnsRouterMode.PNS_MODE_TUNE_SINGLE
  | PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR
  | PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW;

/**
 * The slice of `DRC_CONSTRAINT` (`pcbnew/drc/drc_rule.h`) this dialog reads:
 * whether a custom rule is pinning the target, its display name
 * (`GetName()` — the caller formats the `rule '%s'` wrapping, since that is
 * `DRC_RULE::IsImplicit()` reaching outside the constraint itself), its
 * value, and which domain (length vs. delay) it constrains
 * (`GetOption( OPTIONS::SPACE_DOMAIN )`).
 */
export interface TuningConstraintInput {
  isNull: boolean;
  name: string;
  value: MinOptMax;
  spaceDomain: boolean;
}

/** `DRC_CONSTRAINT()` — `IsNull()` true, nothing else read. */
export const NULL_TUNING_CONSTRAINT: TuningConstraintInput = {
  isNull: true,
  name: '',
  value: {},
  spaceDomain: false,
};

/** The dialog's form state — one field per control the `_base.cpp` owns. */
export interface TuningPatternFormValues {
  /** `m_targetLengthCtrl->GetValue()` — board length units, or `''`. */
  targetLengthText: string;
  /** `m_targetDelayCtrl->GetValue()` — picoseconds, or `''`. */
  targetDelayText: string;
  overrideCustomRules: boolean;
  /** `m_radioBtnLength->GetValue()`. `!lengthSelected` is `m_isTimeDomain`. */
  lengthSelected: boolean;
  minAmplitude: number;
  maxAmplitude: number;
  spacing: number;
  cornerStyle: MeanderStyle;
  /** 0-100(+), unscaled — `EDA_UNITS::PERCENT` carries no length scale. */
  cornerRadiusPercentage: number;
  singleSided: boolean;
}

/** `UNIT_BINDER::StringFromValue` for a field pinned to `EDA_UNITS::PS`. */
export function psText(iu: number): string {
  const ps = iu / IU_PER_PS;
  // Trim to 6 significant decimals and drop trailing zeros, the way
  // `Double2Str` drops them, without pulling in the mm-specific formatter.
  return String(Number(ps.toFixed(6)));
}

/** `UNIT_BINDER::GetIntValue()` for the same PS-pinned field. */
export function psValue(text: string): number {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? Math.round(n * IU_PER_PS) : 0;
}

/** `TransferDataToWindow`. */
export function initialTuningPatternValues(
  settings: MeanderSettings,
  mode: TuningPatternMode,
  units: StatusUnits,
): TuningPatternFormValues {
  let targetLengthText = '';
  let targetDelayText = '';

  if (mode === PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW) {
    if (settings.isTimeDomain) {
      const v = minOptMaxOpt(settings.targetSkewDelay);
      targetDelayText = v === MEANDER_DELAY_UNCONSTRAINED ? '' : psText(v);
    } else {
      const v = minOptMaxOpt(settings.targetSkew);
      targetLengthText = v === MEANDER_LENGTH_UNCONSTRAINED ? '' : pcbUnitText(v, units);
    }
  } else {
    if (settings.isTimeDomain) {
      const v = minOptMaxOpt(settings.targetLengthDelay);
      targetDelayText = v === MEANDER_DELAY_UNCONSTRAINED ? '' : psText(v);
    } else {
      const v = minOptMaxOpt(settings.targetLength);
      targetLengthText = v === MEANDER_LENGTH_UNCONSTRAINED ? '' : pcbUnitText(v, units);
    }
  }

  return {
    targetLengthText,
    targetDelayText,
    overrideCustomRules: settings.overrideCustomRules,
    lengthSelected: !settings.isTimeDomain,
    minAmplitude: settings.minAmplitude,
    maxAmplitude: settings.maxAmplitude,
    spacing: settings.spacing,
    cornerStyle: settings.cornerStyle,
    cornerRadiusPercentage: settings.cornerRadiusPercentage,
    singleSided: settings.singleSided,
  };
}

/** The four controls whose enabled state upstream recomputes on every edit. */
export interface TuningPatternEnableState {
  targetLengthEnabled: boolean;
  targetDelayEnabled: boolean;
  radioLengthEnabled: boolean;
  radioDelayEnabled: boolean;
  sourceInfoVisible: boolean;
}

/**
 * `targetLength.Enable(...)` / `targetDelay.Enable(...)` /
 * `radioBtnLength.Enable(...)` / `radioBtnDelay.Enable(...)` /
 * `sourceInfo->Show(...)`, all four of which upstream recomputes from the
 * same two inputs both at `TransferDataToWindow` and inside
 * `onOverrideCustomRules` — a pure function of the current form state.
 */
export function tuningPatternEnableState(
  values: Pick<TuningPatternFormValues, 'overrideCustomRules' | 'lengthSelected'>,
  constraint: TuningConstraintInput,
): TuningPatternEnableState {
  const unlocked = values.overrideCustomRules || constraint.isNull;
  const isTimeDomain = !values.lengthSelected;

  return {
    targetLengthEnabled: unlocked && !isTimeDomain,
    targetDelayEnabled: unlocked && isTimeDomain,
    radioLengthEnabled: unlocked,
    radioDelayEnabled: unlocked,
    sourceInfoVisible: !constraint.isNull && !values.overrideCustomRules,
  };
}

/** `(from %s)`, `DIALOG_TUNING_PATTERN_PROPERTIES::TransferDataToWindow`. */
export function tuningPatternSourceInfoText(constraint: TuningConstraintInput): string {
  return `(from ${constraint.name})`;
}

/**
 * `onOverrideCustomRules`: besides the enable recompute (the caller re-derives
 * that from {@link tuningPatternEnableState}), UNCHECKING while a rule is
 * pinning the target rewrites the two text fields from the rule's own value —
 * into whichever field matches its domain — and CHECKING touches neither.
 */
export function tuningPatternOverrideToggled(
  values: TuningPatternFormValues,
  checked: boolean,
  constraint: TuningConstraintInput,
  units: StatusUnits,
): TuningPatternFormValues {
  const next: TuningPatternFormValues = { ...values, overrideCustomRules: checked };

  if (!checked && !constraint.isNull) {
    const optText = constraint.spaceDomain
      ? pcbUnitText(minOptMaxOpt(constraint.value), units)
      : psText(minOptMaxOpt(constraint.value));

    if (constraint.spaceDomain) {
      next.targetLengthText = optText;
      next.targetDelayText = '';
    } else {
      next.targetLengthText = '';
      next.targetDelayText = optText;
    }
  }

  return next;
}

/**
 * `onRadioBtnTargetLengthClick` / `onRadioBtnTargetDelayClick`: only fire
 * `if( event.IsChecked() )`, i.e. only the radio being turned ON acts — a
 * radio group in this UI never delivers the "turned off" event, so the
 * caller only ever calls the matching one of these two.
 */
export function tuningPatternRadioLengthSelected(
  values: TuningPatternFormValues,
): TuningPatternFormValues {
  return { ...values, lengthSelected: true };
}

export function tuningPatternRadioDelaySelected(
  values: TuningPatternFormValues,
): TuningPatternFormValues {
  return { ...values, lengthSelected: false };
}

/**
 * `TransferDataFromWindow`. Returns a new `MeanderSettings` — the caller owns
 * committing it back to the router session.
 *
 * Each of the four target fields has the same shape: if the typed value
 * differs from the constraint's own `Opt()`, call the scalar setter (a fresh
 * tolerance window around the typed value); if it matches, call the
 * `MINOPTMAX` overload (`*FromConstraint` here) with the constraint's own
 * value, which keeps the constraint's explicit min/max where it set one.
 *
 * **One exception, ported literally.** In skew mode, the length field's
 * "matches" branch is `m_settings.m_targetSkew = m_constraint.GetValue();` —
 * a direct field assignment, not `SetTargetSkew( m_constraint.GetValue() )`.
 * The other three matching branches go through their setter; this one
 * bypasses it, so the constraint's min/max lands in `targetSkew` exactly as
 * given rather than merged over a tolerance window first.
 */
export function tuningPatternTransferFromWindow(
  values: TuningPatternFormValues,
  mode: TuningPatternMode,
  radioLengthEnabled: boolean,
  settings: MeanderSettings,
  constraint: TuningConstraintInput,
  units: StatusUnits,
): MeanderSettings {
  const next: MeanderSettings = { ...settings };
  const constraintOpt = minOptMaxOpt(constraint.value);

  if (mode === PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW) {
    const lastSkew =
      values.targetLengthText === ''
        ? MEANDER_SKEW_UNCONSTRAINED
        : pcbUnitValue(values.targetLengthText, units);

    if (lastSkew !== constraintOpt) setTargetSkew(next, lastSkew);
    // Direct field assignment (`m_settings.m_targetSkew = m_constraint.GetValue();`),
    // NOT the setter: it replaces the whole min/opt/max with the constraint's
    // own, rather than recomputing a tolerance window around just its `Opt()`.
    else next.targetSkew = { ...constraint.value };

    const lastSkewDelay =
      values.targetDelayText === '' ? MEANDER_SKEW_UNCONSTRAINED : psValue(values.targetDelayText);

    if (lastSkewDelay !== constraintOpt) setTargetSkewDelay(next, lastSkewDelay);
    else setTargetSkewDelayFromConstraint(next, constraint.value);
  } else {
    const lastTarget =
      values.targetLengthText === ''
        ? MEANDER_LENGTH_UNCONSTRAINED
        : pcbUnitValue(values.targetLengthText, units);

    if (lastTarget !== constraintOpt) setTargetLength(next, lastTarget);
    else setTargetLengthFromConstraint(next, constraint.value);

    const lastTargetDelay =
      values.targetDelayText === '' ? MEANDER_DELAY_UNCONSTRAINED : psValue(values.targetDelayText);

    if (lastTargetDelay !== constraintOpt) setTargetLengthDelay(next, lastTargetDelay);
    else setTargetLengthDelayFromConstraint(next, constraint.value);
  }

  next.overrideCustomRules = values.overrideCustomRules;

  if (radioLengthEnabled) next.isTimeDomain = !values.lengthSelected;

  next.minAmplitude = values.minAmplitude;
  next.maxAmplitude = values.maxAmplitude;
  next.spacing = values.spacing;
  next.cornerStyle = values.cornerStyle;
  next.cornerRadiusPercentage = values.cornerRadiusPercentage;
  next.singleSided = values.singleSided;

  return next;
}
