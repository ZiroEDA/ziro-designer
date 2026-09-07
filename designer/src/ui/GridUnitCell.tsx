// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A unitized WX_GRID cell — `WX_GRID::SetUnitValue` and `WX_GRID::GetUnitValue`
 * (`common/widgets/wx_grid.cpp:934-980`).
 *
 * The pair belongs to the BASE CLASS, not to any one dialog. A grid registers
 * its numeric columns (`SetUnitsProvider`, `SetAutoEvalCols`) and from then on
 * every cell in them holds
 *
 *     SetCellValue( row, col, unitsProvider->StringFromValue( value, true ) )
 *
 * — the number *and* the frame's unit word, so the cell reads "0.1 mm" — and
 * is read back with `ValueFromString`, which accepts a trailing unit
 * designator. That is why no KiCad grid writes "(mm)" into a column header:
 * the unit is in the cell, it follows the FRAME rather than the dialog, and it
 * changes under the user when the frame's units do.
 *
 * The draft is not a convenience either. A wxGrid cell is a painted string
 * until the grid cursor opens its editor; the editor commits when it leaves
 * the cell and Esc abandons it. Re-formatting on every keystroke would rewrite
 * "0." to "0" under the caret and make "0.15" untypeable.
 *
 * `size={1}`: a `wxTextCtrl` built with `wxDefaultSize` contributes almost
 * nothing to its sizer, so a column is sized by its header and by the painted
 * cell text — never by the editor. An `<input>`'s default `size` of 20 is a
 * width no wxGrid column has; see `UnitField`'s `size` for the same note.
 */
import { type JSX, useRef, useState } from 'react';
import { type EdaIuScale, pcbIUScale } from '@ziroeda/common';
import { type EdaUnits, parseUnitValue, stringFromValue } from './unit_binder.js';

export function GridUnitCell({
  value,
  units,
  iuScale = pcbIUScale,
  ariaLabel,
  onCommit,
  size = 1,
}: {
  /** The model value in millimetres — what `SetUnitValue` is handed. */
  value: number;
  /** The frame's display unit; the `UNITS_PROVIDER` half of the cell. */
  units: EdaUnits;
  /** The application's internal-unit scale, which quantises what is read back. */
  iuScale?: EdaIuScale;
  ariaLabel: string;
  /**
   * `GetUnitValue`'s result, on leaving the cell. Returning `false` REFUSES the
   * value: the settings keep what they had and the cell keeps the text that was
   * typed, which is what upstream's `TransferDataFromWindow` leaves behind when
   * it reports a parameter error and returns false.
   */
  onCommit: (mm: number) => boolean | void;
  size?: number;
}): JSX.Element {
  // `null` means "show the model"; a string is an editor that is open.
  const [text, setText] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const commit = (): void => {
    if (text === null) return;
    if (onCommit(parseUnitValue(text, units, iuScale)) === false) return;
    setText(null);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      size={size}
      aria-label={ariaLabel}
      value={text ?? stringFromValue(value, units, true, iuScale)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // The grid's own keys, not the editor's: Enter commits and Esc
        // abandons (`wxGridCellEditor::HandleReturn` / `Reset`). Everything
        // else stops here so the canvas below does not see it as a hotkey.
        e.stopPropagation();

        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'Escape') {
          setText(null);
        }
      }}
    />
  );
}
