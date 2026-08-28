// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PGPROPERTY_DISTANCE — how a properties-grid cell turns internal units into
 * text and back.
 *
 * Counterpart: `common/properties/pg_properties.cpp`. Upstream this is ONE
 * implementation in `common/`, shared by every frame that docks a
 * PROPERTIES_PANEL: `PGPROPERTY_COORD` and `PGPROPERTY_SIZE` are both
 * PGPROPERTY_DISTANCE subclasses (`include/properties/pg_properties.h:104-165`)
 * and both render through `DistanceToString`. The only thing that differs
 * between eeschema and pcbnew is the frame the property asks — its display
 * units and its `EDA_IU_SCALE` — which is why those are parameters here and
 * not a per-editor copy of the formatter.
 *
 * It had already drifted: pcbnew called `StringFromValue` with the unit label
 * on, and eeschema had a local formatter that printed a bare `2100.00` where
 * KiCad prints `1900 mils`.
 */
import type { EdaIuScale } from '@ziroeda/common';
import type { StatusUnits } from '../ui/status_format.js';
import { parseUnitValue, stringFromValue } from '../ui/unit_binder.js';

/**
 * `PGPROPERTY_DISTANCE::DistanceToString` (pg_properties.cpp:346-389).
 *
 * Every branch of it ends in the same call:
 * `m_parentFrame->StringFromValue( distanceIU, true, EDA_DATA_TYPE::DISTANCE )`
 * (`:357`, `:388`). Two things follow, and both were wrong in eeschema:
 *
 *  - `aAddUnitsText` is **true**, so a distance cell carries its unit —
 *    `1900 mils`, `1.27 mm` — where the message panel's
 *    `MessageTextFromValue` row does too but at a different precision, and a
 *    bare number belongs to neither;
 *  - the precision is `StringFromValue`'s, the one an *editable* field needs
 *    (eeschema scale: `%.3f` mils, `%.6f` in, `%.10f` mm, trailing zeros then
 *    removed), not `MessageTextFromValue`'s readability precision.
 *
 * The `ORIGIN_TRANSFORMS::ToDisplay` step upstream applies before this is the
 * frame's local-origin offset; callers that have one apply it themselves.
 */
export function distanceToString(iu: number, units: StatusUnits, iuScale: EdaIuScale): string {
  return stringFromValue(iuScale.iuToMM(iu), units, true, iuScale);
}

/**
 * The way back: `PG_UNIT_EDITOR::GetValueFromControl` reads the cell through
 * `UNIT_BINDER`, i.e. `DoubleValueFromString` + `FromUserUnit`, so a trailing
 * unit designator overrides the display unit and `1.5mm` typed into a mils
 * cell means 1.5 mm.
 *
 * `null` is the rejected edit. A cell with no leading number at all is not
 * read as zero: `PGPROPERTY_COORD::DoGetValidator` (pg_properties.cpp:481)
 * hands the grid a numeric validator, and the grid refuses the value rather
 * than committing `UNIT_BINDER`'s empty-field 0.
 */
export function stringToDistance(
  text: string,
  units: StatusUnits,
  iuScale: EdaIuScale,
): number | null {
  if (!/^[+-]?(\d|[.,]\d)/.test(text.trim())) return null;
  return Math.round(iuScale.mmToIU(parseUnitValue(text, units, iuScale)));
}
