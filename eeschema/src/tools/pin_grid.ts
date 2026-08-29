// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Properties dialog's **Pin Functions** grid. Counterpart:
 * `SCH_PIN_TABLE_DATA_MODEL` in eeschema/dialogs/dialog_symbol_properties.cpp.
 *
 * Five columns — Number, Base Name, Alternate Assignment, Electrical Type,
 * Graphic Style — of which only the third is editable, and then only from its
 * own list of choices ("don't accept random values; must use the popup to
 * change to a known alternate", `CanSetValueAs` returning false).
 *
 * Two details of the Alternate Assignment cell are easy to get wrong and are
 * what the tests pin:
 *
 *  - a pin whose library declares **no** alternates shows an *empty* cell, not
 *    its own name. The cell means "which of the pin's functions is in force",
 *    and a pin with one function has no such choice to display;
 *  - selecting the **base name** clears the alternate rather than storing it
 *    (`if( aValue == pin.GetLibPin()->GetName() ) pin.SetAlt( "" )`). Storing
 *    it would be the very value the file format works around.
 *
 * Type and Style follow the selection, because `SCH_PIN::GetType`/`GetShape`
 * consult the alternate first — picking a function changes what the pin *is*,
 * not just what it is called.
 */

import { pinNumbersCompare } from '@ziroeda/common';
import type { LibPin, LibSymbol, SchSymbol, SchSymbolPin } from '../types.js';
import { isUsableAlternate, resolvePin, symbolPin } from './pin_alternates.js';

/** The grid's columns, in upstream's order. */
export const PIN_GRID_COLUMNS = [
  'Number',
  'Base Name',
  'Alternate Assignment',
  'Electrical Type',
  'Graphic Style',
] as const;

/** One row of the grid; type and shape are tokens, the UI names them. */
export interface PinGridRow {
  readonly number: string;
  readonly baseName: string;
  /** The cell's text: '' when the pin has no alternates to choose between. */
  readonly alternate: string;
  /** What the cell offers, base name first. Empty when there is no choice. */
  readonly choices: readonly string[];
  readonly electricalType: string;
  readonly shape: string;
}

/**
 * The pins of the placement's unit and body style, in library order.
 *
 * A symbol shows only the unit it is placed as — upstream's `GetPins()` for a
 * given sheet path does the same — so a multi-unit part does not list every
 * unit's pins under one reference.
 */
export function unitPins(sym: SchSymbol, lib: LibSymbol | undefined): readonly LibPin[] {
  if (!lib) return [];
  return lib.units
    .filter((u) => (u.unit === 0 || u.unit === sym.unit) && u.bodyStyle === sym.bodyStyle)
    .flatMap((u) => u.pins);
}

/**
 * The rows the grid shows for a placement, in the order it shows them.
 *
 * `m_dataModel->SortRows( COL_NUMBER, true )` runs once as the dialog is built
 * (dialog_symbol_properties.cpp:369) and again after every unit change (:1192),
 * so the table is never in library order — it is in ascending pin-number order,
 * by `PIN_NUMBERS::Compare` rather than by string, which is why pin 10 follows
 * pin 9 and not pin 1.
 *
 * `SCH_PIN_TABLE_DATA_MODEL::compare` falls back to COL_NUMBER as the secondary
 * key; sorting on COL_NUMBER itself makes that fallback a no-op, so the initial
 * sort is exactly this one comparison.
 */
export function pinGridRows(sym: SchSymbol, lib: LibSymbol | undefined): PinGridRow[] {
  return unitPins(sym, lib)
    .slice()
    .sort((a, b) => pinNumbersCompare(a.number, b.number))
    .map((pin) => {
      const resolved = resolvePin(sym, pin);
      const alts = pin.alternates ?? [];
      return {
        number: pin.number,
        baseName: pin.name,
        // Empty for a pin with nothing to choose; otherwise the function in force,
        // which for an unset pin is its base name.
        alternate: alts.length === 0 ? '' : (resolved.alternate ?? pin.name),
        choices: alts.length === 0 ? [] : [pin.name, ...alts.map((a) => a.name)],
        electricalType: resolved.electricalType,
        shape: resolved.shape,
      };
    });
}

/**
 * Set (or clear) one pin's alternate, as `SetValue( row, COL_ALT_NAME )` does.
 *
 * Choosing the base name clears the alternate. A value the library does not
 * declare is ignored rather than stored — the grid can only offer known names,
 * and a stale one would only be cleared again by the next library update.
 *
 * The placement may have no entry for the pin at all (a file that never listed
 * its pins); one is created, without a uuid, since only KiCad's own writer
 * mints those and inventing one would claim an identity the file never had.
 */
export function setPinAlternate(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  number: string,
  value: string,
): SchSymbol {
  const pin = unitPins(sym, lib).find((p) => p.number === number);
  if (!pin) return sym;
  const clearing = value === '' || value === pin.name;
  if (!clearing && !isUsableAlternate(pin, value)) return sym;

  const existing = symbolPin(sym, number);
  if (!existing && clearing) return sym;
  if (existing?.alternate === (clearing ? undefined : value)) return sym;

  const updated: SchSymbolPin = clearing
    ? { number: existing?.number ?? number, ...(existing?.uuid ? { uuid: existing.uuid } : {}) }
    : { ...(existing ?? { number }), alternate: value };
  const pins = existing
    ? sym.pins!.map((p) => (p.number === number ? updated : p))
    : [...(sym.pins ?? []), updated];
  return { ...sym, pins };
}
