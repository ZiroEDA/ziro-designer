// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_DIMENSIONS` — "Default Properties for New Dimension Objects",
 * written **once**.
 *
 * Upstream this is `pcbnew/dialogs/panel_setup_dimensions.{h,cpp}` plus its
 * wxFormBuilder base, and it is a class of its own precisely because two
 * different dialogs embed it: Board Setup's Text & Graphics page, and
 * Preferences > Footprint Editor > Graphics Defaults, which constructs one into
 * its own sizer —
 *
 *     m_dimensionsPanel( std::make_unique<PANEL_SETUP_DIMENSIONS>(
 *             this, *m_unitProvider, m_designSettings ) )
 *     ...
 *     GetSizer()->Add( m_dimensionsPanel.get(), 0, wxEXPAND, 5 );
 *     (`pcbnew/dialogs/panel_fp_editor_graphics_defaults.cpp:68-86`)
 *
 * It takes a `BOARD_DESIGN_SETTINGS&` and touches eight of its fields, which is
 * why one class serves a board's settings and the footprint editor's alike
 * without knowing which it is looking at. Ours is the same shape: a component
 * over a {@link DimensionDefaults}, whichever settings object holds it.
 *
 * The sizer tree (`panel_setup_dimensions_base.cpp:14-114`) is a
 * `wxGridBagSizer( 0, 5 )` of four rows and two column-pairs, with a spacer
 * column between them:
 *
 *     (0,0) "Units:"          (0,1) m_dimensionUnits
 *     (0,3) "Text position:"  (0,4) m_dimensionTextPositionMode
 *     (1,0) "Units format:"   (1,1) m_dimensionUnitsFormat
 *     (1,3) m_dimensionTextKeepAligned                 spans 2
 *     (2,0) "Precision:"      (2,1) m_dimensionPrecision
 *     (2,3) "Arrow length:"   (2,4) entry   (2,5) unit
 *     (3,0) m_dimensionSuppressZeroes                  spans 2
 *     (3,3) "Extension line offset:" (3,4) entry (3,5) unit
 *
 * so the two checkboxes sit in the other column's row rather than under their
 * own label — a layout a uniform two-column grid would lose.
 *
 * `Board Setup > Text & Graphics` still draws its own copy inline
 * (`editors/pcb/dialogs/panels/panel_pcb_text_graphics.tsx`), which is the
 * duplication this file exists to end; that page keeps its own until it is
 * converted, and its `DimensionDefaults` is a different shape (label strings
 * rather than the stored enum ordinals), so the swap is a data change as well
 * as a component one.
 */
import type { JSX } from 'react';
import { Check, Num, Sel } from './widgets.js';
import type { StatusUnits } from '../../ui/status_format.js';

/**
 * The eight `BOARD_DESIGN_SETTINGS` fields this panel edits, as the settings
 * file stores them — enum ORDINALS, not labels, because that is what
 * `PARAM_ENUM` writes (`pcbnew/footprint_editor_settings.cpp:295-330`).
 */
export interface DimensionDefaults {
  /** `m_DimensionUnitsMode`, `DIM_UNITS_MODE`: INCH 0, MILS 1, MM 2, AUTOMATIC 3. */
  units: number;
  /** `m_DimensionPrecision`, `DIM_PRECISION`. The choice offers the first six. */
  precision: number;
  /** `m_DimensionUnitsFormat`, `DIM_UNITS_FORMAT`: NO_SUFFIX 0, BARE 1, PAREN 2. */
  units_format: number;
  /** `m_DimensionSuppressZeroes`. */
  suppress_zeroes: boolean;
  /** `m_DimensionTextPosition`, `DIM_TEXT_POSITION`: OUTSIDE 0, INLINE 1. */
  text_position: number;
  /** `m_DimensionKeepTextAligned`. */
  keep_text_aligned: boolean;
  /** `m_DimensionArrowLength`, in **internal units**. */
  arrow_length: number;
  /** `m_DimensionExtensionOffset`, in **internal units**. */
  extension_offset: number;
}

/** `m_dimensionUnitsChoices` (`panel_setup_dimensions_base.cpp:36`). */
export const DIM_UNITS_CHOICES: [number, string][] = [
  [0, 'Inches'],
  [1, 'Mils'],
  [2, 'Millimeters'],
  [3, 'Automatic'],
];

/** `m_dimensionUnitsFormatChoices` (`:63`). */
export const DIM_FORMAT_CHOICES: [number, string][] = [
  [0, '1234'],
  [1, '1234 mm'],
  [2, '1234 (mm)'],
];

/**
 * `m_dimensionPrecisionChoices` (`:78`) — SIX rows, though `DIM_PRECISION` has
 * ten. The four `V_*` variable-precision members are reachable on an item and
 * not from this panel, which is why the choice is shorter than the enum.
 */
export const DIM_PRECISION_CHOICES: [number, string][] = [
  [0, '0'],
  [1, '0.0'],
  [2, '0.00'],
  [3, '0.000'],
  [4, '0.0000'],
  [5, '0.00000'],
];

/**
 * `m_dimensionTextPositionModeChoices` (`:51`) — two rows.
 * `DIM_TEXT_POSITION::MANUAL` is deliberately outside the range, with
 * upstream's own note "excluding DIM_TEXT_POSITION::MANUAL from the valid range
 * here" on the param (`footprint_editor_settings.cpp:308-310`).
 */
export const DIM_POSITION_CHOICES: [number, string][] = [
  [0, 'Outside'],
  [1, 'Inline'],
];

export function PanelSetupDimensions({
  value,
  update,
  /**
   * `m_arrowLength` and `m_extensionOffset` are `UNIT_BINDER`s over the frame's
   * `UNITS_PROVIDER`, so both entries and the two "unit" labels beside them
   * print in whatever unit the frame is on.
   */
  units,
  iuPerMM,
}: {
  value: DimensionDefaults;
  update: (fn: (d: DimensionDefaults) => void) => void;
  units: StatusUnits;
  iuPerMM: number;
}): JSX.Element {
  /** IU -> the displayed number, and back. `UNIT_BINDER`'s two halves. */
  const perUnit =
    units === 'mm' ? iuPerMM : units === 'in' ? iuPerMM * 25.4 : (iuPerMM * 25.4) / 1000;
  const show = (iu: number): number => Number((iu / perUnit).toFixed(6));
  const store = (v: number): number => Math.round(v * perUnit);
  const unitLabel = units === 'mils' ? 'mils' : units;

  return (
    <div className="ze-pref-group">
      <div className="ze-pref-group-title">Default Properties for New Dimension Objects</div>
      {/* The `wxGridBagSizer`: two column-pairs side by side, each row of the
          left pair beside the corresponding row of the right. */}
      <div className="ze-pref-columns ze-gutter-25">
        <div className="ze-pref-group-body">
          <Sel
            label="Units:"
            value={value.units}
            options={DIM_UNITS_CHOICES}
            title='Default units for dimensions ("automatic" to follow the chosen UI units)'
            onChange={(v) =>
              update((d) => {
                d.units = v;
              })
            }
          />
          <Sel
            label="Units format:"
            value={value.units_format}
            options={DIM_FORMAT_CHOICES}
            onChange={(v) =>
              update((d) => {
                d.units_format = v;
              })
            }
          />
          <Sel
            label="Precision:"
            value={value.precision}
            options={DIM_PRECISION_CHOICES}
            title="How many digits of precision to show"
            onChange={(v) =>
              update((d) => {
                d.precision = v;
              })
            }
          />
          <Check
            label="Suppress trailing zeroes"
            checked={value.suppress_zeroes}
            title={
              'When checked, "1.2300" will be rendered as "1.23" even if precision is set to ' +
              'show more digits'
            }
            onChange={(v) =>
              update((d) => {
                d.suppress_zeroes = v;
              })
            }
          />
        </div>
        <div className="ze-pref-group-body">
          <Sel
            label="Text position:"
            value={value.text_position}
            options={DIM_POSITION_CHOICES}
            title="Where to position the dimension text relative to the dimension line"
            onChange={(v) =>
              update((d) => {
                d.text_position = v;
              })
            }
          />
          <Check
            label="Keep text aligned"
            checked={value.keep_text_aligned}
            title="When checked, dimension text will be kept aligned with dimension lines"
            onChange={(v) =>
              update((d) => {
                d.keep_text_aligned = v;
              })
            }
          />
          <Num
            label="Arrow length:"
            value={show(value.arrow_length)}
            unit={unitLabel}
            spin={false}
            width={80}
            onChange={(v) =>
              update((d) => {
                d.arrow_length = store(v);
              })
            }
          />
          <Num
            label="Extension line offset:"
            value={show(value.extension_offset)}
            unit={unitLabel}
            spin={false}
            width={80}
            onChange={(v) =>
              update((d) => {
                d.extension_offset = store(v);
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
