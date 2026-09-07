// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `UNIT_BINDER`, bound to the board's internal unit.
 * Counterpart: `common/widgets/unit_binder.cpp`, constructed with the frame as
 * its `UNITS_PROVIDER` — which is what every distance field in every pcbnew
 * dialog is.
 *
 * `ui/unit_binder.ts` is the port; the only thing added here is the board's
 * `EDA_IU_SCALE`. That matters twice and both are silent when wrong:
 *
 *  - `StringFromValue`'s digit count is chosen from `IU_PER_MM`, so a board
 *    value formatted with the drawing sheet's scale prints a schematic's three
 *    decimals where pcbnew prints five;
 *  - `ValueFromString` quantises to the frame's internal unit, and the board's
 *    is a nanometre. That quantisation is what makes mm -> mils -> mm
 *    round-trip exactly instead of drifting by the display rounding.
 *
 * A dialog that reaches for `pcbIuToMM` and a literal "mm" instead is the
 * defect `qa/unittests/designer/dialog_units_follow_frame.test.ts` scans for:
 * it shows 1.5 on a board whose own status bar reads mils.
 */

import { pcbIuToMM, pcbIUScale, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { parseUnitValue, stringFromValue } from '../../ui/unit_binder.js';
import type { StatusUnits } from '../../ui/status_format.js';

export { unitLabel } from '../../ui/unit_binder.js';

/** `UNIT_BINDER::SetValue`: board IU out, in the frame's units. */
export function pcbUnitText(iu: number, units: StatusUnits): string {
  return stringFromValue(pcbIuToMM(iu), units, false, pcbIUScale);
}

/**
 * `UNIT_BINDER::GetValue()`, i.e. `GetIntValue()`: the frame's units in, board
 * IU out, quantised.
 *
 * Not `Number()`. Only the leading numeric run is parsed, so an empty field is
 * 0 rather than "leave it alone"; a trailing designator overrides the display
 * unit, so `1.5mm` typed into a mils field means 1.5 mm; and the result is
 * rounded to whole nanometres.
 */
export function pcbUnitValue(text: string, units: StatusUnits): number {
  return pcbMmToIU(parseUnitValue(text, units, pcbIUScale));
}

/**
 * The same binder for a field whose MODEL is millimetres rather than IU.
 *
 * Board Setup keeps its constraints that way — `maxDeviationMM` and the rest of
 * `BoardConstraints` — because the `.kicad_pro` stores them in mm, so there is
 * no IU to convert from. The display and the parse still belong to the frame's
 * units, and the board's scale still decides the digit count, which is why
 * these are here rather than calling `ui/unit_binder.ts` with a default scale.
 *
 * `addUnits` is off by default because a `UNIT_BINDER` puts the unit in its own
 * `wxStaticText` beside the field, not inside it. A `WX_GRID` cell is the other
 * case: `SetUnitValue` writes `StringFromValue( …, true )` into the cell, which
 * is why Board Setup's Pre-defined Sizes grids read "0.5 mm" and its
 * Constraints fields read "0.5" with a label after them.
 */
export function pcbUnitTextMM(mm: number, units: StatusUnits, addUnits = false): string {
  return stringFromValue(mm, units, addUnits, pcbIUScale);
}

/** The mm-valued half of `UNIT_BINDER::GetValue()`. */
export function pcbUnitValueMM(text: string, units: StatusUnits): number {
  return parseUnitValue(text, units, pcbIUScale);
}
