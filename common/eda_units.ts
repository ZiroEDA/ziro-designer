// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Coordinate units. Counterpart: KiCad `include/base_units.h` (EDA_IU_SCALE and
 * the per-application scales built from it).
 *
 * Internal units (IU) are integers, and each application has its own scale:
 * eeschema counts 100 nm steps, pcbnew counts nanometres. Files store
 * millimetres as decimals (`161.29`); KiCad converts on load with
 * `KiROUND(mm * IU_PER_MM)` and works in integer IU thereafter (`VECTOR2I`).
 *
 * ZiroEDA mirrors this exactly. We deliberately do NOT keep coordinates as
 * floating point millimetres: integer IU is what makes grid snapping,
 * hit-testing and point equality exact and drift-free. Floats here would be the
 * shortcut that breaks connectivity later.
 *
 * Using the *schematic* scale on the board would quantise every board
 * coordinate to 100 nm, so a pcbnew file's `166.963652` would come back as
 * `166.9637`. Board code must take {@link pcbIUScale}.
 */

import type { MINOPTMAX } from '@ziroeda/core/minoptmax.js';
import { formatF, formatG } from './string_utils.js';

/** Gerbview IU is 10 nanometres. */

export const GERB_IU_PER_MM = 1e5;
/** Pcbnew IU is 1 nanometre. */
export const PCB_IU_PER_MM = 1e6;
/** Drawing-sheet internal units are microns. */
export const PL_IU_PER_MM = 1e3;
/** Schematic internal units, 1 = 100 nm. */
export const SCH_IU_PER_MM = 1e4;

/** EDA_IU_SCALE: one application's internal-unit scale and its conversions. */
export class EdaIuScale {
  readonly IU_PER_MM: number;
  readonly IU_PER_MILS: number;
  readonly MM_PER_IU: number;
  /** Internal time units are attoseconds (base_units.h:78). */
  readonly IU_PER_PS = 1e6;
  /** Internal delay units are attoseconds/mm (base_units.h:79). */
  readonly IU_PER_PS_PER_MM = 1e6;

  constructor(iuPerMM: number) {
    this.IU_PER_MM = iuPerMM;
    this.IU_PER_MILS = iuPerMM * 0.0254;
    this.MM_PER_IU = 1 / iuPerMM;
  }

  /** EDA_IU_SCALE::mmToIU, KiROUND's round-half-away-from-zero. */
  mmToIU(mm: number): number {
    return mm < 0 ? Math.ceil(mm * this.IU_PER_MM - 0.5) : Math.floor(mm * this.IU_PER_MM + 0.5);
  }

  /** EDA_IU_SCALE::IUTomm. */
  iuToMM(iu: number): number {
    return iu / this.IU_PER_MM;
  }

  /** EDA_IU_SCALE::MilsToIU. */
  milsToIU(mils: number): number {
    const x = mils * this.IU_PER_MILS;
    return x < 0 ? Math.ceil(x - 0.5) : Math.floor(x + 0.5);
  }

  /** EDA_IU_SCALE::IUToMils. */
  iuToMils(iu: number): number {
    const mils = iu / this.IU_PER_MILS;
    return mils < 0 ? Math.ceil(mils - 0.5) : Math.floor(mils + 0.5);
  }
}

export const gerbIUScale = new EdaIuScale(GERB_IU_PER_MM);
export const pcbIUScale = new EdaIuScale(PCB_IU_PER_MM);
export const drawSheetIUScale = new EdaIuScale(PL_IU_PER_MM);
export const schIUScale = new EdaIuScale(SCH_IU_PER_MM);
/** `unityScale` (base_units.h): a scale of 1, the plotters' independent scaling. */
export const unityScale = new EdaIuScale(1.0);

/**
 * `ARC_LOW_DEF_MM` / `ARC_HIGH_DEF_MM` and the board-IU forms of them
 * (`base_units.h:118-130`): how far a tessellated arc or curve may deviate from
 * the true one.
 *
 * `ARC_HIGH_DEF` is what `BOARD_DESIGN_SETTINGS::m_MaxError` defaults to, and
 * every caller that has no board to ask uses it directly. Upstream's own
 * warning is worth keeping: "too small values can create very long calculation
 * time in zone filling. 0.05 to 0.005 mm are reasonable values".
 *
 * These are *board* IU because upstream computes them with `pcbIUScale` even in
 * `base_units.h`, which is shared. A caller working in another editor's units
 * has to scale them itself — see `iu_scale_differs_per_editor`.
 */
export {
  ARC_HIGH_DEF,
  ARC_HIGH_DEF_MM,
  ARC_LOW_DEF,
  ARC_LOW_DEF_MM,
} from '@ziroeda/kimath/src/base_units.js';

/**
 * Schematic millimetres to IU. Board code wants {@link pcbIUScale} instead;
 * these two keep the schematic's scale so eeschema reads unchanged.
 */
export function mmToIU(mm: number): number {
  return schIUScale.mmToIU(mm);
}

/** Schematic IU back to millimetres. */
export function iuToMM(iu: number): number {
  return schIUScale.iuToMM(iu);
}

/** Board millimetres to IU (1 nm), the pcbnew scale. */
export function pcbMmToIU(mm: number): number {
  return pcbIUScale.mmToIU(mm);
}

/** Board IU back to millimetres. */
export function pcbIuToMM(iu: number): number {
  return pcbIUScale.iuToMM(iu);
}

// ---------------------------------------------------------------------------
// EDA_UNIT_UTILS — the display formatters, from `common/eda_units.cpp`.
//
// These live here, beside EDA_IU_SCALE, because that is where KiCad keeps them:
// one implementation that every frame, every dialog and every message panel
// calls. A per-editor copy is the drift CLAUDE.md's central-value rule forbids,
// and it has already happened once — the message panel printed bare numbers
// because it had its own formatter that could not add a unit label.
// ---------------------------------------------------------------------------

/** `EDA_UNITS` (include/eda_units.h), the members our frames can display. */
export type EdaUnits =
  | 'mm'
  | 'in'
  | 'mils'
  | 'um'
  | 'cm'
  | 'degrees'
  | 'percent'
  | 'unscaled'
  | 'fs'
  | 'ps'
  | 'ps/in'
  | 'ps/cm'
  | 'ps/mm';

/**
 * `EDA_UNIT_UTILS::FetchUnitsFromString( aTextValue, aUnits )` (common/eda_units.cpp:88):
 * the unit designator after the number in a text, or null when it names none
 * (the C++ returns false and leaves `aUnits` alone).
 */
export function FetchUnitsFromString(aTextValue: string): EdaUnits | null {
  const buf = aTextValue.trim();
  let brk_point = 0;

  while (brk_point < buf.length) {
    const c = buf[brk_point]!;

    if (!((c >= '0' && c <= '9') || c === '.' || c === ',' || c === '-' || c === '+')) break;

    ++brk_point;
  }

  // Check the unit designator (2 ch significant)
  const unit = buf.slice(brk_point).trimStart().slice(0, 2).toLowerCase();

  let aUnits: EdaUnits | null = null;

  //check for um, μm (µ is MICRO SIGN) and µm (µ is GREEK SMALL LETTER MU) for micrometre
  if (unit === 'um' || unit === '\u00B5m' || unit === '\u03BCm') aUnits = 'um';
  else if (unit === 'mm') aUnits = 'mm';

  if (unit === 'cm') aUnits = 'cm';
  else if (unit === 'mi' || unit === 'th')
    // "mils" or "thou"
    aUnits = 'mils';
  else if (unit === 'in' || unit === '"') aUnits = 'in';
  else if (unit === 'de' || unit === 'ra')
    // "deg" or "rad"
    aUnits = 'degrees';
  else if (unit === 'fs') aUnits = 'fs';
  else if (unit === 'ps') {
    const timeUnit = buf.slice(brk_point).trimStart().slice(0, 5).toLowerCase();

    if (timeUnit === 'ps') aUnits = 'ps';
    else if (timeUnit === 'ps/in') aUnits = 'ps/in';
    else if (timeUnit === 'ps/cm') aUnits = 'ps/cm';
    else if (timeUnit === 'ps/mm') aUnits = 'ps/mm';
    else return null;
  } else return aUnits === 'um' || aUnits === 'mm' ? aUnits : null;

  return aUnits;
}

/** `EDA_DATA_TYPE` (include/eda_units.h:37-45): DISTANCE, AREA, VOLUME, UNITLESS, TIME, LENGTH_DELAY. */
export type EdaDataType = 'distance' | 'area' | 'volume' | 'unitless' | 'time' | 'length_delay';

/**
 * `EDA_UNIT_UTILS::GetText` (common/eda_units.cpp:143-176) — the unit suffix
 * appended when `aAddUnitsText` is true, plus the `²`/`³` exponent the data
 * type adds. **Data**: this is KiCad's own table, transcribed, not invented.
 *
 * It carries its own leading space for the unit names, so `"1.27" + " mm"`.
 * `°` and `%` have none, which is also upstream's.
 */
export function unitLabelText(units: EdaUnits, type: EdaDataType = 'distance'): string {
  let label: string;

  switch (units) {
    case 'um':
      label = ' µm';
      break;
    case 'mm':
      label = ' mm';
      break;
    case 'cm':
      label = ' cm';
      break;
    case 'degrees':
      label = '°';
      break;
    case 'mils':
      label = ' mils';
      break;
    case 'in':
      label = ' in';
      break;
    case 'percent':
      label = '%';
      break;
    case 'fs':
      label = ' fs';
      break;
    case 'ps':
      label = ' ps';
      break;
    case 'ps/in':
      label = ' ps/in';
      break;
    case 'ps/cm':
      label = ' ps/cm';
      break;
    case 'ps/mm':
      label = ' ps/mm';
      break;
    case 'unscaled':
      label = '';
      break;
  }

  if (type === 'volume') label += '³';
  else if (type === 'area') label += '²';

  return label;
}

/**
 * `EDA_UNIT_UTILS::GetLabel` (common/eda_units.cpp:178-181) —
 * {@link unitLabelText} with its leading space trimmed.
 *
 * This is the one a WIDGET's units `wxStaticText` takes, not the message-panel
 * one: `UNIT_BINDER::SetUnits` writes `GetLabel( m_units, m_dataType )` into
 * `m_unitLabel` (`common/widgets/unit_binder.cpp:110`), so every entry bound to
 * `EDA_UNITS::DEGREES` is followed by `°` — never the word `deg`, which is only
 * the wxFormBuilder placeholder the binder overwrites.
 */
export function unitLabel(units: EdaUnits, type: EdaDataType = 'distance'): string {
  return unitLabelText(units, type).trimStart();
}

/** `EDA_UNIT_UTILS::UI::ToUserUnit` — one factor of the IU→display conversion. */
export function toUserUnit(iuScale: EdaIuScale, units: EdaUnits, value: number): number {
  switch (units) {
    case 'mm':
      return value / iuScale.IU_PER_MM;
    case 'um':
      return (value / iuScale.IU_PER_MM) * 1e3;
    case 'cm':
      return value / iuScale.IU_PER_MM / 10;
    case 'mils':
      return value / iuScale.IU_PER_MILS;
    case 'in':
      return value / (iuScale.IU_PER_MILS * 1000);
    default:
      return value;
  }
}

/**
 * `EDA_UNIT_UTILS::UI::MessageTextFromValue` (common/eda_units.cpp:417-508),
 * the lower-precision "for readability" formatter.
 *
 * Three details that are easy to lose and all three have bitten us:
 *
 *  - `aAddUnitsText` defaults to **true** (include/eda_units.h:226-232). Every
 *    message-panel row takes that default, which is why upstream's rows read
 *    `0.25 mm` and ours read `0.25`.
 *  - `short_form` is true when the scale is eeschema's **or** the data type is
 *    an area or a volume (`:425-426`), so a board area prints `%.3f`, not
 *    `%.4f`.
 *  - AREA converts twice and VOLUME three times, by falling through the switch
 *    (`:431-443`).
 */
export function messageTextFromValue(
  iuScale: EdaIuScale,
  units: EdaUnits,
  value: number,
  addUnitsText = true,
  type: EdaDataType = 'distance',
): string {
  const shortForm = iuScale.IU_PER_MM === SCH_IU_PER_MM || type === 'volume' || type === 'area';

  let v = value;

  if (type === 'volume') v = toUserUnit(iuScale, units, v);
  if (type === 'volume' || type === 'area') v = toUserUnit(iuScale, units, v);
  if (type !== 'unitless') v = toUserUnit(iuScale, units, v);

  let digits: number;

  switch (units) {
    case 'cm':
      digits = shortForm ? 3 : 5;
      break;
    case 'mils':
      digits = shortForm ? 0 : 2;
      break;
    case 'mm':
    case 'in':
      digits = shortForm ? 3 : 4;
      break;
    case 'degrees':
      digits = 3;
      break;
    case 'unscaled':
      digits = 0;
      break;
    // `default:` in the C++ switch labels the UM case (`:456-457`), so PERCENT
    // — the only other member that reaches here — takes UM's precision, not
    // mm's. Reading the switch as "default = mm" is the easy mistake.
    default:
      digits = shortForm ? 0 : 1;
      break;
  }

  let text = v.toFixed(digits);

  // A non-zero value that prints as all zeros falls back to "%.3e" (:475-493).
  // C pads the exponent to two digits and always signs it; JS does neither.
  if (v !== 0 && !/[1-9]/.test(text)) text = cFormatE3(v);

  // Trim to 2-1/2 digits after the decimal place for short-form mm (:496-503).
  if (shortForm && units === 'mm') {
    const n = text.length;
    if (n > 4 && text[n - 4] === '.' && text[n - 1] === '0') text = text.slice(0, n - 1);
  }

  return addUnitsText ? text + unitLabelText(units, type) : text;
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
 * `EDA_UNIT_UTILS::UI::StringFromValue` (`eda_units.cpp:323`), the full-precision
 * dialog-field formatter over internal units.
 *
 * The digit counts are per unit: mils `%.5f`, inch `%.8f`, everything else
 * `%.10f`, each then stripped of trailing zeros; `is_eeschema`
 * (`IU_PER_MM == SCH_IU_PER_MM`) drops mils to `%.3f` and inch to `%.6f`.
 */
export function stringFromValue(
  aIuScale: EdaIuScale,
  aUnits: EdaUnits,
  aValue: number,
  aAddUnitsText = false,
  aType: EdaDataType = 'distance',
): string {
  let value_to_print = aValue;
  const is_eeschema = aIuScale.IU_PER_MM === SCH_IU_PER_MM;

  switch (aType) {
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH
    case 'volume':
      value_to_print = toUserUnit(aIuScale, aUnits, value_to_print);
    // KI_FALLTHROUGH;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH
    case 'area':
      value_to_print = toUserUnit(aIuScale, aUnits, value_to_print);
    // KI_FALLTHROUGH;

    case 'distance':
      value_to_print = toUserUnit(aIuScale, aUnits, value_to_print);
      break;

    case 'unitless':
      break;
  }

  let digits: number;

  switch (aUnits) {
    case 'mils':
      digits = is_eeschema ? 3 : 5;
      break;
    case 'in':
      digits = is_eeschema ? 6 : 8;
      break;
    case 'degrees':
      digits = 4;
      break;
    default:
      digits = 10;
      break;
  }

  let text = removeTrailingZeros(value_to_print.toFixed(digits));

  if (value_to_print !== 0.0 && (text === '0' || text === '-0')) {
    text = removeTrailingZeros(value_to_print.toFixed(10));
  }

  if (aAddUnitsText) text += unitLabelText(aUnits, aType);

  return text;
}

/** `EDA_UNIT_UTILS::UI::MessageTextFromMinOptMax` (`eda_units.cpp:513`). */
export function messageTextFromMinOptMax(
  aIuScale: EdaIuScale,
  aUnits: EdaUnits,
  aValue: MINOPTMAX,
): string {
  let msg = '';

  if (aValue.HasMin() && aValue.Min() > 0) {
    msg += `min ${messageTextFromValue(aIuScale, aUnits, aValue.Min())}`;
  }

  if (aValue.HasOpt()) {
    if (msg !== '') msg += '; ';

    msg += `opt ${messageTextFromValue(aIuScale, aUnits, aValue.Opt())}`;
  }

  if (aValue.HasMax()) {
    if (msg !== '') msg += '; ';

    msg += `max ${messageTextFromValue(aIuScale, aUnits, aValue.Max())}`;
  }

  return msg;
}

/**
 * The `EDA_ANGLE` overload (common/eda_units.cpp:407-413): `"%.1f°"`, or
 * `"%.1f"` without the label. Note the one decimal — an angle row is not
 * formatted like a distance row.
 */
export function messageTextFromAngle(degrees: number, addUnitLabel = true): string {
  return degrees.toFixed(1) + (addUnitLabel ? '°' : '');
}

/**
 * `wxString::Format( "%.3e", v )`, which is C's conversion: a signed exponent
 * of at least two digits. `Number.prototype.toExponential` writes `1.000e-9`
 * where C writes `1.000e-09`, and the message panel shows the C spelling.
 */
function cFormatE3(value: number): string {
  const js = value.toExponential(3);
  const at = js.indexOf('e');
  const mantissa = js.slice(0, at);
  const exponent = Number(js.slice(at + 1));
  const sign = exponent < 0 ? '-' : '+';
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// EDA_UNIT_UTILS — the FILE formatters (common/eda_units.cpp:186-233), the
// exact text KiCad writes a length or an angle as. `{:.10g}` for everything
// except a non-zero length at or below 0.0001 mm, which takes `{:.10f}` with
// its trailing zeros removed so it never comes out in exponent form.
// ---------------------------------------------------------------------------

/** `EDA_UNIT_UTILS::FormatAngle`: degrees through `{:.10g}`. */
export function FormatAngle(degrees: number): string {
  return formatG(degrees, 10);
}

/** `EDA_UNIT_UTILS::GetScaleForInternalUnitType`. */
function GetScaleForInternalUnitType(iuScale: EdaIuScale, dataType: FileDataType): number {
  switch (dataType) {
    case 'time':
      return iuScale.IU_PER_PS;
    case 'length_delay':
      return iuScale.IU_PER_PS_PER_MM;
    case 'unitless':
      return 1.0;
    default:
      return iuScale.IU_PER_MM;
  }
}

/** `EDA_DATA_TYPE` as the file formatter distinguishes it. */
export type FileDataType = 'distance' | 'time' | 'length_delay' | 'unitless';

/** `EDA_UNIT_UTILS::FormatInternalUnits( aIuScale, aValue, aDataType )`. */
export function FormatInternalUnits(
  iuScale: EdaIuScale,
  value: number,
  dataType: FileDataType = 'distance',
): string {
  // `aValue` is an int: it has no negative zero, and neither may the quotient.
  const scale = GetScaleForInternalUnitType(iuScale, dataType);
  if (scale === 1e6 && Number.isInteger(value) && Math.abs(value) < 1e10) {
    // The board-file case, exactly: an integer count of nanometres below
    // 10 m has at most ten significant digits, so `{:.10g}` of `iu / 1e6`
    // is the decimal iu/1e6 itself, trailing zeros trimmed (and `%g` cannot
    // reach its exponent forms: those need |x| < 1e-4, handled below, or
    // |x| >= 1e10). Written with integer arithmetic, this is the formatter's
    // hot path on a large board.
    if (value === 0) return '0';
    const neg = value < 0;
    const v = neg ? -value : value;
    const whole = Math.floor(v / 1e6);
    const frac = v - whole * 1e6;
    if (frac === 0) return neg ? `-${whole}` : String(whole);
    if (frac < 100) {
      // |x| <= 0.0001 with a zero whole part takes the fixed-notation branch
      // below; with a non-zero whole part it is an ordinary decimal.
      if (whole === 0) {
        let buf = formatF(v / 1e6, 10);
        while (buf.length > 0 && buf.endsWith('0')) buf = buf.slice(0, -1);
        if (buf.endsWith('.')) buf = buf.slice(0, -1);
        return neg ? `-${buf}` : buf;
      }
    }
    let digits = String(frac).padStart(6, '0');
    let end = digits.length;
    while (digits.charCodeAt(end - 1) === 0x30) end--;
    digits = digits.slice(0, end);
    return `${neg ? '-' : ''}${whole}.${digits}`;
  }
  const engUnits = (value === 0 ? 0 : value) / scale;
  if (engUnits !== 0.0 && Math.abs(engUnits) <= 0.0001) {
    let buf = formatF(engUnits, 10);
    // remove trailing zeros
    while (buf.length > 0 && buf.endsWith('0')) buf = buf.slice(0, -1);
    // if the value was really small we may have just stripped all the zeros
    // after the decimal
    if (buf.endsWith('.')) buf = buf.slice(0, -1);
    return buf;
  }
  return formatG(engUnits, 10);
}

/** `EDA_UNIT_UTILS::FormatInternalUnits( aIuScale, aPoint )`: `"x y"`. */
export function FormatInternalUnitsPoint(
  iuScale: EdaIuScale,
  point: { x: number; y: number },
): string {
  return `${FormatInternalUnits(iuScale, point.x)} ${FormatInternalUnits(iuScale, point.y)}`;
}

/**
 * `EDA_UNIT_UTILS::UI::FromUserUnit( aIuScale, aUnits, aValue )`
 * (common/eda_units.cpp:544): a value in aUnits to internal units.
 */
export function FromUserUnit(aIuScale: EdaIuScale, aUnits: EdaUnits, aValue: number): number {
  switch (aUnits) {
    case 'um':
      return (aValue / 1000.0) * aIuScale.IU_PER_MM; // MM_TO_IU
    case 'mm':
      return aValue * aIuScale.IU_PER_MM;
    case 'cm':
      return aValue * 10 * aIuScale.IU_PER_MM;
    case 'mils':
      return aValue * aIuScale.IU_PER_MILS; // MILS_TO_IU
    case 'in':
      return aValue * aIuScale.IU_PER_MILS * 1000; // IN_TO_IU
    case 'fs':
      return (aValue / 1000.0) * aIuScale.IU_PER_PS; // PS_TO_IU
    case 'ps':
      return aValue * aIuScale.IU_PER_PS;
    case 'ps/in':
      return (aValue / 25.4) * aIuScale.IU_PER_PS_PER_MM; // PS_PER_MM_TO_IU
    case 'ps/cm':
      return (aValue / 10) * aIuScale.IU_PER_PS_PER_MM;
    case 'ps/mm':
      return aValue * aIuScale.IU_PER_PS_PER_MM;
    default:
      // case EDA_UNITS::DEGREES: case EDA_UNITS::UNSCALED: case EDA_UNITS::PERCENT:
      return aValue;
  }
}

/**
 * The numeric part of a text: `buf.Left( brk_point ).ToDouble( &dtmp )` after
 * the C++'s decimal-separator normalisation (both `.` and `,` become the
 * locale's point, which is `.` here). `ToDouble` fails on an empty or
 * malformed prefix and leaves 0.
 */
function numericPrefix(aTextValue: string): { value: number; brk_point: number; buf: string } {
  const decimal_point = '.';
  let buf = aTextValue.trim();

  // Convert any entered decimal point separators to the 'right' one
  buf = buf.replaceAll('.', decimal_point).replaceAll(',', decimal_point);

  // Find the end of the numeric part
  let brk_point = 0;

  while (brk_point < buf.length) {
    const ch = buf[brk_point]!;

    if (!((ch >= '0' && ch <= '9') || ch === decimal_point || ch === '-' || ch === '+')) break;

    ++brk_point;
  }

  // Extract the numeric part: wxString::ToDouble is strtod over the WHOLE
  // string, so "1.5.3" or "+-3" fails and leaves 0
  const numeric = buf.slice(0, brk_point);
  const value = /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(numeric) ? Number.parseFloat(numeric) : 0;

  return { value, brk_point, buf };
}

/**
 * `EDA_UNIT_UTILS::UI::DoubleValueFromString( const wxString& aTextValue )`
 * (common/eda_units.cpp:567): the leading number of a text, no units.
 */
export function DoubleValueFromString(aTextValue: string): number {
  return numericPrefix(aTextValue).value;
}

/**
 * `EDA_UNIT_UTILS::UI::DoubleValueFromString( aIuScale, aUnits, aTextValue, aType )`
 * (common/eda_units.cpp:604): the text in aUnits, unless it carries its own
 * unit designator, to internal units.
 */
export function DoubleValueFromStringIn(
  aIuScale: EdaIuScale,
  aUnitsIn: EdaUnits,
  aTextValue: string,
  aType: EdaDataType | 'time' | 'length_delay' = 'distance',
): number {
  let aUnits = aUnitsIn;
  const { value, brk_point, buf } = numericPrefix(aTextValue);
  let dtmp = value;

  // Check the optional unit designator (2 ch significant)
  const unit = buf.slice(brk_point).trimStart().slice(0, 2).toLowerCase();

  if (
    aUnits === 'um' ||
    aUnits === 'mm' ||
    aUnits === 'cm' ||
    aUnits === 'mils' ||
    aUnits === 'in'
  ) {
    //check for um, μm (µ is MICRO SIGN) and µm (µ is GREEK SMALL LETTER MU) for micrometre
    if (unit === 'um' || unit === 'µm' || unit === 'μm') {
      aUnits = 'um';
    } else if (unit === 'mm') {
      aUnits = 'mm';
    } else if (unit === 'cm') {
      aUnits = 'cm';
    } else if (unit === 'mi' || unit === 'th') {
      aUnits = 'mils';
    } else if (unit === 'in' || unit === '"') {
      aUnits = 'in';
    } else if (unit === 'oz') {
      // 1 oz = 1.37 mils
      aUnits = 'mils';
      dtmp *= 1.37;
    }
  } else if (aUnits === 'degrees') {
    if (unit === 'ra')
      // Radians
      dtmp *= 180.0 / Math.PI;
  } else if (
    aUnits === 'fs' ||
    aUnits === 'ps' ||
    aUnits === 'ps/in' ||
    aUnits === 'ps/cm' ||
    aUnits === 'ps/mm'
  ) {
    const timeUnit = buf.slice(brk_point).trimStart().slice(0, 5).toLowerCase();

    if (timeUnit === 'fs') aUnits = 'fs';
    if (timeUnit === 'ps') aUnits = 'ps';
    else if (timeUnit === 'ps/in') aUnits = 'ps/in';
    else if (timeUnit === 'ps/cm') aUnits = 'ps/cm';
    else if (timeUnit === 'ps/mm') aUnits = 'ps/mm';
  }

  switch (aType) {
    case 'volume':
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      break;

    case 'area':
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      break;

    case 'distance':
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      break;

    case 'unitless':
      break;

    case 'time':
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      break;

    case 'length_delay':
      dtmp = FromUserUnit(aIuScale, aUnits, dtmp);
      break;
  }

  return dtmp;
}

/**
 * `bool EDA_UNIT_UTILS::UI::DoubleValueFromString( aIuScale, aTextValue, aDoubleValue )`
 * (common/eda_units.cpp:724): a text WITH a unit designator to internal units;
 * null (false) when there is no number or the designator is not one of ours.
 * "If it quacks like a duck, it is a duck": PCBEXPR reads a string property
 * through this to see whether it is really a dimension.
 */
export function DoubleValueFromStringWithUnits(
  aIuScale: EdaIuScale,
  aTextValue: string,
): number | null {
  const { value, brk_point, buf } = numericPrefix(aTextValue);
  let dtmp = value;

  if (brk_point === 0) return null;

  // Check the unit designator
  const unit = buf.slice(brk_point).trim().toLowerCase();
  let units: EdaUnits = 'mm'; // Make gcc quiet

  //check for um, μm (µ is MICRO SIGN) and µm (µ is GREEK SMALL LETTER MU) for micrometre
  if (unit === 'um' || unit === 'µm' || unit === 'μm') {
    units = 'um';
  } else if (unit === 'mm') {
    units = 'mm';
  } else if (unit === 'cm') {
    units = 'cm';
  } else if (unit === 'mil' || unit === 'mils' || unit === 'thou') {
    units = 'mils';
  } else if (unit === 'in' || unit === '"') {
    units = 'in';
  } else if (unit === 'oz') {
    // 1 oz = 1.37 mils
    units = 'mils';
    dtmp *= 1.37;
  } else if (unit === 'ra') {
    // Radians
    dtmp *= 180.0 / Math.PI;
  } else if (unit === 'fs') {
    units = 'fs';
  } else if (unit === 'ps') {
    units = 'ps';
  } else if (unit === 'ps/in') {
    units = 'ps/in';
  } else if (unit === 'ps/cm') {
    units = 'ps/cm';
  } else if (unit === 'ps/mm') {
    units = 'ps/mm';
  } else {
    return null;
  }

  return FromUserUnit(aIuScale, units, dtmp);
}
