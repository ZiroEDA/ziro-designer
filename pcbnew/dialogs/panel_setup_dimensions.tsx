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
import { type JSX, useState } from 'react';
import { EdaIuScale } from '@ziroeda/common/eda_units.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import type {
  DIM_PRECISION,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from '../pcb_dimension.js';
import { PANEL_SETUP_DIMENSIONS_BASE } from './panel_setup_dimensions_base.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

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
  [0, _HKI('Inches')],
  [1, _HKI('Mils')],
  [2, _HKI('Millimeters')],
  [3, _HKI('Automatic')],
];

/** `m_dimensionUnitsFormatChoices` (`:63`). */
export const DIM_FORMAT_CHOICES: [number, string][] = [
  [0, '1234'],
  [1, _HKI('1234 mm')],
  [2, _HKI('1234 (mm)')],
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
  [0, _HKI('Outside')],
  [1, _HKI('Inline')],
];

/** PANEL_SETUP_DIMENSIONS's transfers over a BOARD_DESIGN_SETTINGS (panel_setup_dimensions.cpp). */
export const PANEL_SETUP_DIMENSIONS = {
  TransferDataToWindow(aBrdSettings: BOARD_DESIGN_SETTINGS): DimensionDefaults {
    return {
      units: aBrdSettings.m_DimensionUnitsMode,
      precision: aBrdSettings.m_DimensionPrecision,
      units_format: aBrdSettings.m_DimensionUnitsFormat,
      suppress_zeroes: aBrdSettings.m_DimensionSuppressZeroes,
      text_position: aBrdSettings.m_DimensionTextPosition,
      keep_text_aligned: aBrdSettings.m_DimensionKeepTextAligned,
      arrow_length: aBrdSettings.m_DimensionArrowLength,
      extension_offset: aBrdSettings.m_DimensionExtensionOffset,
    };
  },

  TransferDataFromWindow(d: DimensionDefaults, aBrdSettings: BOARD_DESIGN_SETTINGS): void {
    aBrdSettings.m_DimensionUnitsMode = d.units as DIM_UNITS_MODE;
    aBrdSettings.m_DimensionUnitsFormat = d.units_format as DIM_UNITS_FORMAT;
    aBrdSettings.m_DimensionPrecision = d.precision as DIM_PRECISION;
    aBrdSettings.m_DimensionSuppressZeroes = d.suppress_zeroes;
    aBrdSettings.m_DimensionTextPosition = d.text_position as DIM_TEXT_POSITION;
    aBrdSettings.m_DimensionKeepTextAligned = d.keep_text_aligned;
    aBrdSettings.m_DimensionArrowLength = d.arrow_length;
    aBrdSettings.m_DimensionExtensionOffset = d.extension_offset;
  },
};

/** PANEL_SETUP_DIMENSIONS's window: its base over the values, the two lengths UNIT_BINDERs. */
export function PanelSetupDimensions({
  value,
  update,
  units,
  iuPerMM,
}: {
  value: DimensionDefaults;
  update: (fn: (d: DimensionDefaults) => void) => void;
  /** The frame's units, which m_arrowLength and m_extensionOffset show. */
  units: StatusUnits;
  iuPerMM: number;
}): JSX.Element {
  const [, setTick] = useState(0);
  // m_arrowLength, m_extensionOffset: UNIT_BINDERs over the frame.
  const [binders] = useState(() => {
    const provider = { GetUserUnits: () => units, GetIuScale: () => new EdaIuScale(iuPerMM) };
    const arrow = new UNIT_BINDER(provider, _('Arrow length:'));
    const offset = new UNIT_BINDER(provider, _('Extension line offset:'));
    arrow.SetValue(value.arrow_length);
    offset.SetValue(value.extension_offset);
    return { arrow, offset };
  });

  const choice = (aKey: 'units' | 'units_format' | 'precision' | 'text_position') => ({
    value: value[aKey],
    onChange: (aIndex: number) =>
      update((d) => {
        d[aKey] = aIndex;
      }),
  });
  const check = (aKey: 'suppress_zeroes' | 'keep_text_aligned') => ({
    value: value[aKey],
    onChange: (aOn: boolean) =>
      update((d) => {
        d[aKey] = aOn;
      }),
  });
  const length = (b: UNIT_BINDER, aKey: 'arrow_length' | 'extension_offset') => ({
    value: b.GetText(),
    onChange: (aText: string) => {
      b.SetText(aText);
      const iu = b.GetIntValue();
      update((d) => {
        d[aKey] = iu;
      });
      setTick((t) => t + 1);
    },
    // UNIT_BINDER::onKillFocus: evaluated and shown in the binder's format.
    onBlur: () => {
      b.ChangeValue(b.GetValue());
      setTick((t) => t + 1);
    },
    units: unitLabel(units),
  });

  return (
    <PANEL_SETUP_DIMENSIONS_BASE
      m_dimensionUnits={choice('units')}
      m_dimensionTextPositionMode={choice('text_position')}
      m_dimensionUnitsFormat={choice('units_format')}
      m_dimensionTextKeepAligned={check('keep_text_aligned')}
      m_dimensionPrecision={choice('precision')}
      m_dimensionArrowLength={length(binders.arrow, 'arrow_length')}
      m_dimensionSuppressZeroes={check('suppress_zeroes')}
      m_dimensionExtensionOffset={length(binders.offset, 'extension_offset')}
    />
  );
}
