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
export type EdaUnits = 'mm' | 'in' | 'mils' | 'um' | 'cm' | 'degrees' | 'percent' | 'unscaled';

/** `EDA_DATA_TYPE` (include/eda_units.h:44-53). */
export type EdaDataType = 'distance' | 'area' | 'volume' | 'unitless';

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
    case 'unscaled':
      label = '';
      break;
  }

  if (type === 'volume') label += '³';
  else if (type === 'area') label += '²';

  return label;
}

/** `EDA_UNIT_UTILS::UI::ToUserUnit` — one factor of the IU→display conversion. */
function toUserUnit(iuScale: EdaIuScale, units: EdaUnits, value: number): number {
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
