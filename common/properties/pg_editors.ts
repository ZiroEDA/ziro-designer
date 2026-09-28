// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/properties/pg_editors.cpp` with `include/properties/pg_editors.h`:
 * the property-grid cell EDITORS - what reads an activated cell's control
 * back into a value. The controls themselves are drawn by the panel widget
 * (`properties_panel.tsx`); what they commit is decided here, once, for every
 * frame.
 *
 * Not ported: `PG_RATIO_EDITOR` (no ratio cell is built yet) and
 * `PG_URL_EDITOR` (the Datasheet button: neither of its bitmaps, `www` and
 * `small_folder`, is vendored). `PG_UNIT_EDITOR::CreateControls` calls
 * `RequireEval()` on its binder, so KiCad evaluates `1+2` typed into a cell;
 * our binder has no evaluator wired yet, so an expression is rejected here as
 * text with no leading number.
 */

import { COLOR4D_UNSPECIFIED, type Color4d, parseColor4d } from '../gal/color4d.js';
import { parseUnitValue } from '../widgets/unit_binder.js';
import type { PG_FRAME } from './pg_properties.js';

/**
 * `PG_UNIT_EDITOR`: a text control bound to a `PROPERTY_EDITOR_UNIT_BINDER`
 * at the frame's user units.
 */
export const PG_UNIT_EDITOR = {
  EDITOR_NAME: 'KiCadUnitEditor',

  /** `BuildEditorName`: one editor instance per frame, named after it. */
  BuildEditorName(aFrameName: string | null): string {
    if (aFrameName === null) return `${PG_UNIT_EDITOR.EDITOR_NAME}NoFrame`;

    return PG_UNIT_EDITOR.EDITOR_NAME + aFrameName;
  },

  /**
   * `GetValueFromControl` for a distance property: the cell's text read
   * through `UNIT_BINDER` (`DoubleValueFromString` + `FromUserUnit`), so a
   * trailing unit designator overrides the display unit and `1.5mm` typed
   * into a mils cell means 1.5 mm.
   *
   * Returns the new value in internal units; `null` for an emptied
   * `std::optional<int>` cell (`m_unitBinder->IsNull()`, "no value"); and
   * `undefined` when the grid refuses the text - `<...>`, the mixed-values
   * placeholder, which upstream turns into a null (unspecified) variant, and
   * text with no leading number, which `PGPROPERTY_COORD::DoGetValidator`'s
   * numeric validator rejects rather than letting the binder read it as 0.
   */
  GetValueFromControl(
    aText: string,
    aOptional: boolean,
    aFrame: PG_FRAME,
  ): number | null | undefined {
    if (aText === '<...>') return undefined;

    if (aOptional && aText.trim() === '') return null;

    if (!/^[+-]?(\d|[.,]\d)/.test(aText.trim())) return undefined;

    return Math.round(aFrame.iuScale.mmToIU(parseUnitValue(aText, aFrame.units, aFrame.iuScale)));
  },
};

/**
 * `PG_CHECKBOX_EDITOR`: wx's checkbox editor, except that activating an
 * unspecified (mixed) checkbox sets it rather than leaving it indeterminate.
 */
export const PG_CHECKBOX_EDITOR = {
  EDITOR_NAME: 'KiCadCheckboxEditor',

  /**
   * The value a click commits. `CreateControls` sets an unspecified value to
   * false first, and the base class's toggle then makes it true.
   */
  ToggledValue(aValue: boolean | null): boolean {
    return !(aValue ?? false);
  },
};

/** `PG_COLOR_EDITOR`: a `COLOR_SWATCH` filling the activated cell. */
export const PG_COLOR_EDITOR = {
  EDITOR_NAME: 'KiCadColorEditor',

  /**
   * `colorFromVariant`: the property's colour, or `COLOR4D::UNSPECIFIED`
   * when the value holds none (here, the empty string).
   */
  colorFromVariant(aValue: string | null): Color4d {
    if (aValue === null || aValue === '') return COLOR4D_UNSPECIFIED;

    return parseColor4d(aValue);
  },
};

/**
 * `PG_FPID_EDITOR`: a text control plus a `wxPGMultiButton` carrying
 * `BITMAPS::small_library`, whose button opens FRAME_FOOTPRINT_CHOOSER on the
 * cell's text and commits the pick through `ChangePropertyValue` - the
 * property's own commit, not a separate write.
 */
export const PG_FPID_EDITOR = {
  EDITOR_NAME: 'KiCadFpidEditor',

  BuildEditorName(aFrameName: string | null): string {
    if (aFrameName === null) return `${PG_FPID_EDITOR.EDITOR_NAME}NoFrame`;

    return PG_FPID_EDITOR.EDITOR_NAME + aFrameName;
  },
};

/** `PG_RATIO_EDITOR::EDITOR_NAME`, `PG_URL_EDITOR::EDITOR_NAME` - registered names only. */
export const PG_RATIO_EDITOR_NAME = 'KiCadRatioEditor';
export const PG_URL_EDITOR_NAME = 'KiCadUrlEditor';
