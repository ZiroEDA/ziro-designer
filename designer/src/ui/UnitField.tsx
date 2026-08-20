// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The control half of `UNIT_BINDER` (common/widgets/unit_binder.cpp): a text
 * entry holding a distance, with the frame's unit word beside it.
 *
 * Upstream a `UNIT_BINDER` is constructed as
 * `UNIT_BINDER( aParent, aLabel, aValueCtrl, aUnitLabel )` — the frame is the
 * `UNITS_PROVIDER`, so the value is displayed in whatever unit the frame is
 * currently in and the static text beside it is re-labelled to match
 * (unit_binder.cpp:109-110). Nothing in a panel hardcodes a unit; the "mm" in
 * `properties_frame_base.cpp` is only the designer's placeholder, replaced the
 * moment the binder is built.
 *
 * The entry is a plain `wxTextCtrl`, not a spin control, and that matters:
 * `DoubleValueFromString` accepts a unit designator after the number, so
 * "1.5mm" typed into a field showing mils is 1.5 mm. A `type="number"` input
 * would discard that text before we ever saw it.
 *
 * All the arithmetic — conversion, formatting, parsing, range checking — is in
 * `unit_binder.ts`; this file only wires it to a DOM node.
 */

import { type JSX, useRef, useState } from 'react';
import {
  type EdaUnits,
  type UnitRange,
  parseUnitValue,
  stringFromValue,
  unitLabel,
  validateUnitValue,
} from './unit_binder.js';

export function UnitField({
  label,
  value,
  units,
  range,
  onCommit,
  onError,
  width,
  title,
}: {
  /**
   * The field's own label, colon included — `UNIT_BINDER`'s `aLabel`. It is
   * not drawn here (the panel draws it); it is what names the field in the
   * out-of-range message, via `valueDescriptionFromLabel`.
   */
  label: string;
  /** The model value, in millimetres, as every `.kicad_wks` distance is. */
  value: number;
  /** The frame's display unit — the `UNITS_PROVIDER` half of the binder. */
  units: EdaUnits;
  /**
   * `validateMM`'s limits in millimetres. Omitted for the fields upstream
   * deliberately does not check, which is most of them: positions, end
   * positions, text constraints, repeat steps and all four page margins.
   */
  range?: UnitRange;
  onCommit: (mm: number) => void;
  /**
   * `DisplayErrorMessage` — shown when `Validate` fails. Without it a failed
   * entry is still refused, it is just refused silently.
   */
  onError?: (message: string) => void;
  /**
   * An explicit width. Left unset the field EXPANDS to fill its column, which
   * is what every `wxTextCtrl` in `properties_frame_base.cpp` does — each one
   * is added `wxEXPAND` into a sizer with a growable value column
   * (`AddGrowableCol( 1 )`, :183/:379/:395). Ours was a fixed 62 px, so the
   * value column stopped a third of the way across the pane.
   */
  width?: number | string;
  title?: string;
}): JSX.Element {
  // The panel applies on focus-lost (PROPERTIES_FRAME::onTextFocusLost sets
  // m_propertiesDirty, and OnUpdateUI then runs OnAcceptPrms). While the field
  // is being typed into it holds its own text; `null` means "show the model".
  const [text, setText] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const commit = (): void => {
    if (text === null) return;

    const mm = parseUnitValue(text, units);
    const error = range ? validateUnitValue(label, mm, range, units) : null;

    if (error) {
      // UNIT_BINDER::Validate: select the text, re-focus the control and skip
      // the assignment, so nothing is applied and the bad entry stays put for
      // the user to correct. The focus is posted rather than taken directly
      // because we are inside the blur that triggered the check.
      onError?.(error);
      setTimeout(() => {
        ref.current?.focus();
        ref.current?.select();
      }, 0);
      return;
    }

    if (mm !== value) onCommit(mm);
    setText(null);
  };

  return (
    <>
      <input
        ref={ref}
        className="ze-search"
        type="text"
        inputMode="decimal"
        style={width === undefined ? { flex: '1 1 auto', minWidth: 0 } : { width }}
        title={title}
        value={text ?? stringFromValue(value, units)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
      {/* The binder's unit static text, re-labelled with the frame's unit. */}
      <span className="ze-muted ze-unit-label">{unitLabel(units)}</span>
    </>
  );
}
