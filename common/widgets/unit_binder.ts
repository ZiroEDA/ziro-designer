// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `UNIT_BINDER` — one numeric entry that follows the frame's display unit.
 *
 * Counterparts:
 *   - `UNIT_BINDER` (common/widgets/unit_binder.cpp) — the ctor takes
 *     `( aParent, aLabel, aValueCtrl, aUnitLabel )` where `aParent` is the
 *     frame acting as `UNITS_PROVIDER`, so the control, its label and the
 *     little unit word beside it are one object that re-reads and re-labels
 *     itself whenever the frame's unit changes.
 *   - `EDA_UNIT_UTILS::UI::ToUserUnit` / `FromUserUnit` / `StringFromValue` /
 *     `DoubleValueFromString` and `EDA_UNIT_UTILS::GetText` / `GetLabel`
 *     (common/eda_units.cpp).
 *
 * It lives here, not in an editor, for the same reason it lives in
 * `common/widgets/` upstream: every dialog with a distance in it wants one.
 * `status_format.ts` next door is the *other* half of `eda_units.cpp` — the
 * low-precision `MessageTextFromValue` a status bar and a message panel print.
 * This file is the high-precision `StringFromValue` an editable field needs,
 * which is why the two format the same number differently: a status bar shows
 * `X 984.2519`, the field the user types into shows `984.25197`.
 *
 * Everything here is a pure function over (value, unit, range). The React
 * field that draws them is `UnitField.tsx`; keeping the arithmetic out of it
 * is what lets the numbers be tested without a DOM.
 */

import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  DoubleValueFromStringIn,
  FromUserUnit,
  type EdaUnits as EDA_UNITS,
  stringFromValue as iuStringFromValue,
} from '../eda_units.js';
import { type EdaIuScale, SCH_IU_PER_MM, drawSheetIUScale } from '../index.js';
import { COORD_TYPES_T, type ORIGIN_TRANSFORMS } from '../origin_transforms.js';
import type { StatusUnits } from './kistatusbar_format.js';
import { INDETERMINATE_ACTION, INDETERMINATE_STATE } from './ui_common.js';

/**
 * `EDA_UNITS`, restricted to the three a drawing frame's toolbar offers. Same
 * spelling as the status bar's, so a frame has one unit variable and not two.
 */
export type EdaUnits = StatusUnits;

/**
 * `EDA_UNIT_UTILS::GetText( aUnits, DISTANCE )` (common/eda_units.cpp:144).
 * The leading space is upstream's and is why `StringFromValue( …, true )`
 * reads "10 mm" and not "10mm".
 */
export function unitText(units: EdaUnits): string {
  return units === 'mm' ? ' mm' : units === 'in' ? ' in' : ' mils';
}

/**
 * `EDA_UNIT_UTILS::GetLabel` (:180) — `GetText` with the leading space
 * trimmed. This is the word `UNIT_BINDER` writes into its unit static text
 * (unit_binder.cpp:109-110), i.e. what replaces the hardcoded "mm".
 */
export function unitLabel(units: EdaUnits): string {
  return unitText(units).trimStart();
}

/**
 * `EDA_UNIT_UTILS::UI::ToUserUnit` (:300) for a value already in millimetres.
 *
 * Upstream divides internal units by `IU_PER_MILS` (which is
 * `IU_PER_MM * 0.0254`), so the scale cancels and the conversion is the same
 * for every application: this is that expression with the scale divided out.
 */
export function toUserUnit(units: EdaUnits, mm: number): number {
  return units === 'mm' ? mm : units === 'mils' ? mm / 0.0254 : mm / 0.0254 / 1000;
}

/** `EDA_UNIT_UTILS::UI::FromUserUnit` (:296), back to millimetres. */
export function fromUserUnit(units: EdaUnits, value: number): number {
  return units === 'mm' ? value : units === 'mils' ? value * 0.0254 : value * 0.0254 * 1000;
}

/**
 * `removeTrailingZeros` (common/eda_units.cpp:32) — strip trailing zeros, and
 * the decimal separator too if that is all that is left before it.
 */
function removeTrailingZeros(text: string): string {
  let len = text.length;
  let removeLast = 0;

  while (--len > 0 && text[len] === '0') removeLast++;

  if (len >= 0 && (text[len] === '.' || text[len] === ',')) removeLast++;

  return text.slice(0, text.length - removeLast);
}

/**
 * `EDA_UNIT_UTILS::UI::StringFromValue` (:323) for a millimetre value.
 *
 * The digit counts are upstream's, and they are per-unit rather than uniform:
 * mils `%.5f`, inch `%.8f`, mm `%.10f`, each then stripped of trailing zeros.
 * `is_eeschema` (`IU_PER_MM == SCH_IU_PER_MM`) drops mils to `%.3f` and inch
 * to `%.6f`; the drawing sheet counts microns, so it takes the long form and
 * 25 mm shows as `984.25197` mils, exactly as a live `pl_editor` does.
 *
 * `toFixed` and glibc's `%.*f` can only disagree on an exact tie, which a unit
 * conversion of a decimal value does not produce.
 */
export function stringFromValue(
  mm: number,
  units: EdaUnits,
  addUnitsText = false,
  iuScale: EdaIuScale = drawSheetIUScale,
): string {
  const shortForm = iuScale.IU_PER_MM === SCH_IU_PER_MM;
  const value = toUserUnit(units, mm);
  const digits = units === 'mils' ? (shortForm ? 3 : 5) : units === 'in' ? (shortForm ? 6 : 8) : 10;

  let text = removeTrailingZeros(value.toFixed(digits));

  // A non-zero value that rounded away to nothing is re-printed at full
  // precision rather than shown as "0".
  if (value !== 0 && (text === '0' || text === '-0')) text = removeTrailingZeros(value.toFixed(10));

  return addUnitsText ? text + unitText(units) : text;
}

/**
 * `EDA_UNIT_UTILS::UI::DoubleValueFromString` (:430) followed by
 * `FromUserUnit`, i.e. what `UNIT_BINDER::GetValue()` reads out of the control.
 *
 * Three details of it are load-bearing and none of them is `Number()`:
 *  - only the LEADING numeric run is parsed, so "12abc" is 12 and — the case
 *    this exists for — an EMPTY field is 0, not "leave the model alone";
 *  - a trailing unit designator overrides the display unit, so "1.5mm" typed
 *    into a field showing mils means 1.5 mm;
 *  - the result is quantised to the frame's internal unit, because upstream
 *    assigns `toMM( binder.GetIntValue() )` and `GetIntValue()` is integer IU.
 *    That quantisation is what makes mm → mils → mm round-trip exactly instead
 *    of drifting by the display rounding.
 */
export function parseUnitValue(
  text: string,
  units: EdaUnits,
  iuScale: EdaIuScale = drawSheetIUScale,
): number {
  return iuScale.iuToMM(iuScale.mmToIU(parseUnitValueDouble(text, units)));
}

/**
 * `UNIT_BINDER::GetDoubleValue()` (unit_binder.cpp:262-291) — the SAME parse
 * without the integer quantisation, because that overload returns a `double`
 * and its only rounding is `setPrecision( …, false )`, a no-op unless the
 * binder was given a precision.
 *
 * Which of the two a caller wants is not a detail: `DIALOG_GRID_SETTINGS` reads
 * `m_gridSizeX.GetDoubleValue()` (`dialog_grid_settings.cpp:80`), so `2` typed
 * into a mils field is stored as exactly 0.0508 mm. Quantising it to the
 * drawing sheet's microns first would store 0.051 and print the grid back as
 * `2.01 mils` — a value the user never typed.
 */
export function parseUnitValueDouble(text: string, units: EdaUnits): number {
  const buf = text.trim().replace(/,/g, '.');

  let brk = 0;
  while (brk < buf.length) {
    const ch = buf[brk] as string;
    if (!((ch >= '0' && ch <= '9') || ch === '.' || ch === '-' || ch === '+')) break;
    brk++;
  }

  const parsed = Number.parseFloat(buf.slice(0, brk));
  const value = Number.isFinite(parsed) ? parsed : 0;

  // The 2-significant-character unit designator, lower-cased, as upstream
  // reads it. "mi"/"th" are mils/thou, "in" and a double quote are inches.
  const designator = buf.slice(brk).trimStart().slice(0, 2).toLowerCase();
  let entered = units;
  if (designator === 'mm') entered = 'mm';
  else if (designator === 'mi' || designator === 'th') entered = 'mils';
  else if (designator === 'in' || designator.startsWith('"')) entered = 'in';

  return fromUserUnit(entered, value);
}

/**
 * `valueDescriptionFromLabel` (unit_binder.cpp:356) — the field's own label
 * with its trailing colon removed, which is what the error message names.
 */
export function valueDescriptionFromLabel(label: string): string {
  return label.endsWith(':') ? label.slice(0, -1) : label;
}

/** A field's permitted range, in millimetres, as `validateMM` expresses it. */
export interface UnitRange {
  /** `aMin`, inclusive. */
  min: number;
  /** `aMax`, inclusive. */
  max: number;
}

/**
 * `UNIT_BINDER::Validate( aMin, aMax, EDA_UNITS::MM )` (unit_binder.cpp:375),
 * which `pagelayout_editor`'s `validateMM` (properties_frame.cpp:175-178)
 * wraps: the limits are always written in millimetres even though the field
 * is showing whatever unit the frame is in.
 *
 * Returns the error message, or `null` when the value is in range. The
 * comparison is done in integer internal units on the left and exact internal
 * units on the right, exactly as upstream compares `GetValue()` against
 * `FromUserUnit( scale, MM, aMin )`.
 *
 * The message quotes the LIMIT in the display unit — "must be less than
 * 393.70079 mils" for the 10 mm pen-width cap when the frame is in mils — so
 * the number it names is one the user could type back into the field.
 */
export function validateUnitValue(
  label: string,
  mm: number,
  range: UnitRange,
  units: EdaUnits,
  iuScale: EdaIuScale = drawSheetIUScale,
): string | null {
  const value = iuScale.mmToIU(mm);
  const desc = valueDescriptionFromLabel(label);

  if (value < range.min * iuScale.IU_PER_MM)
    return `${desc} must be at least ${stringFromValue(range.min, units, true, iuScale)}.`;

  if (value > range.max * iuScale.IU_PER_MM)
    return `${desc} must be less than ${stringFromValue(range.max, units, true, iuScale)}.`;

  return null;
}

// ---- UNIT_BINDER, the engine half -------------------------------------------

/** What a `UNIT_BINDER` asks its parent: `UNITS_PROVIDER`'s two answers. */
export interface UNIT_BINDER_UNITS_PROVIDER {
  GetUserUnits(): EDA_UNITS;
  GetIuScale(): EdaIuScale;
  /**
   * `m_originTransforms` (`m_units_provider->GetOriginTransforms()`): a frame
   * with a display origin answers; a drawing-sheet frame has none, which reads
   * as the base class's identity transform.
   */
  GetOriginTransforms?(): ORIGIN_TRANSFORMS;
}

/**
 * `UNIT_BINDER` (common/widgets/unit_binder.cpp) as a dialog's engine holds
 * it: the text in its `wxTextCtrl`, the label an error names, and whether it
 * is shown. Every read converts in the parent's CURRENT units, as upstream
 * reads `m_units` that `onUnitsChanged` keeps in step. No NUMERIC_EVALUATOR
 * yet: an expression reads as its leading number, as
 * `DIALOG_DRAW_LAYERS_SETTINGS` already notes.
 */
export class UNIT_BINDER {
  private readonly m_unitsProvider: UNIT_BINDER_UNITS_PROVIDER;
  /** `m_label->GetLabel()`: what an error message names. */
  private m_label: string;
  /** `m_units` after a `SetUnits( aUnits )`; null while it follows the parent's. */
  private m_unitsOverride: EDA_UNITS | null = null;
  /** `m_coordType`, set by `SetCoordType`. */
  private m_coordType: COORD_TYPES_T = COORD_TYPES_T.NOT_A_COORD;
  /** Where `delayedFocusHandler`'s `DisplayError` goes. */
  private readonly m_errorSink: ((aMessage: string) => void) | null;
  /** The `wxTextCtrl`'s text. */
  private m_value = '';
  private m_shown = true;
  private m_errorMessage = '';

  constructor(
    aUnitsProvider: UNIT_BINDER_UNITS_PROVIDER,
    aLabel: string,
    aErrorSink: ((aMessage: string) => void) | null = null,
  ) {
    this.m_unitsProvider = aUnitsProvider;
    this.m_label = aLabel;
    this.m_errorSink = aErrorSink;
  }

  GetLabel(): string {
    return this.m_label;
  }

  /** `SetLabel( aLabel )` (`unit_binder.cpp:691`): the label's text, which an error names. */
  SetLabel(aLabel: string): void {
    this.m_label = aLabel;
  }

  /** `m_units`: the parent's, read live, until `SetUnits` states another. */
  GetUnits(): EDA_UNITS {
    return this.m_unitsOverride ?? this.m_unitsProvider.GetUserUnits();
  }

  /** `SetUnits( aUnits )` (`:159`): `m_units`, and so the label beside the entry. */
  SetUnits(aUnits: EDA_UNITS): void {
    this.m_unitsOverride = aUnits;
  }

  /** `SetCoordType( aCoordType )`: how `m_originTransforms` treats the value. */
  SetCoordType(aCoordType: COORD_TYPES_T): void {
    this.m_coordType = aCoordType;
  }

  /** `m_originTransforms.ToDisplay( aValue, m_coordType )`; identity with no display origin. */
  private toDisplay(aValue: number): number {
    const ot = this.m_unitsProvider.GetOriginTransforms?.();
    return ot ? ot.ToDisplay(aValue, this.m_coordType) : aValue;
  }

  /** `m_originTransforms.FromDisplay( aValue, m_coordType )`. */
  private fromDisplay(aValue: number): number {
    const ot = this.m_unitsProvider.GetOriginTransforms?.();
    return ot ? ot.FromDisplay(aValue, this.m_coordType) : aValue;
  }

  /**
   * `SetDoubleValue( aValue )` (`unit_binder.cpp:434-444`): IU into the field,
   * through the display origin (`getTextForDoubleValue`), no unit label.
   */
  SetDoubleValue(aValue: number): void {
    this.m_value = iuStringFromValue(
      this.m_unitsProvider.GetIuScale(),
      this.GetUnits(),
      this.toDisplay(aValue),
      false,
    );
  }

  /** `SetValue( long long )`. */
  SetValue(aValue: number): void {
    this.SetDoubleValue(aValue);
  }

  /** `ChangeValue( int )`: as `SetValue`; there is no change event to withhold here. */
  ChangeValue(aValue: number): void {
    this.SetDoubleValue(aValue);
  }

  /**
   * `SetAngleValue( aValue )` (`:447`):
   * `SetDoubleValue( m_originTransforms.ToDisplay( aValue, m_coordType ) )` -
   * which takes the display origin a second time, as upstream does.
   */
  SetAngleValue(aValue: EDA_ANGLE): void {
    const ot = this.m_unitsProvider.GetOriginTransforms?.();

    this.SetDoubleValue(ot ? ot.ToDisplay(aValue, this.m_coordType) : aValue.AsDegrees());
  }

  /** The field's text, as the control holds it. */
  GetText(): string {
    return this.m_value;
  }

  /** The user typing into the control. */
  SetText(aText: string): void {
    this.m_value = aText;
  }

  /** `GetDoubleValue()`: the text in the parent's units, to IU, out of the display origin. */
  GetDoubleValue(): number {
    return this.fromDisplay(
      DoubleValueFromStringIn(this.m_unitsProvider.GetIuScale(), this.GetUnits(), this.m_value),
    );
  }

  /**
   * `GetAngleValue()` (`:634`):
   * `m_originTransforms.FromDisplay( EDA_ANGLE( GetDoubleValue(), DEGREES_T ), m_coordType )`.
   */
  GetAngleValue(): EDA_ANGLE {
    const ot = this.m_unitsProvider.GetOriginTransforms?.();
    const angle = new EDA_ANGLE(this.GetDoubleValue());

    return ot ? ot.FromDisplay(angle, this.m_coordType) : angle;
  }

  /** `GetValue()` (`:554-600`): `ValueFromString`, `KiROUND` to IU. */
  GetValue(): number {
    return KiROUND(this.GetDoubleValue());
  }

  /** `GetIntValue()`: `(int) GetValue()`. */
  GetIntValue(): number {
    return Math.trunc(this.GetValue());
  }

  /** `IsIndeterminate()`: the entry holds "-- mixed values --" or "-- leave unchanged --". */
  IsIndeterminate(): boolean {
    const text = this.GetText();

    return text === INDETERMINATE_STATE || text === INDETERMINATE_ACTION;
  }

  /**
   * `Validate( aMin, aMax, aUnits )` (`:375-419`). Out of range, the message
   * names the limit in the field's own unit, and `delayedFocusHandler` shows it
   * - here straight to the sink, the page's modal.
   */
  Validate(aMin: number, aMax: number, aUnits: EDA_UNITS): boolean {
    // An indeterminate field ("-- leave unchanged --", "<...>") has no value to range-check.
    if (this.IsIndeterminate()) return true;

    const scale = this.m_unitsProvider.GetIuScale();
    const desc = valueDescriptionFromLabel(this.m_label);

    const fail = (aWhat: string, aLimitIU: number): boolean => {
      const limit = iuStringFromValue(scale, this.GetUnits(), aLimitIU, true);
      this.m_errorMessage = `${desc} must be ${aWhat} ${limit}.`;
      this.m_errorSink?.(this.m_errorMessage);
      return false;
    };

    if (this.GetValue() < FromUserUnit(scale, aUnits, aMin))
      return fail('at least', FromUserUnit(scale, aUnits, aMin));

    if (this.GetValue() > FromUserUnit(scale, aUnits, aMax))
      return fail('less than', FromUserUnit(scale, aUnits, aMax));

    return true;
  }

  /** The last message `Validate` raised. */
  GetErrorMessage(): string {
    return this.m_errorMessage;
  }

  /** `Show( aShow )`: the label, the control and the units together. */
  Show(aShow: boolean): void {
    this.m_shown = aShow;
  }

  IsShown(): boolean {
    return this.m_shown;
  }
}
