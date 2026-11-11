// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Constraints. Counterpart:
 * `pcbnew/dialogs/panel_setup_constraints.cpp` over its `_base.cpp`
 * (`PANEL_SETUP_CONSTRAINTS`). The two-column layout, the row icons and the
 * `TransferDataFromWindow` validation below were the Constraints page of
 * `dialog_board_setup.tsx` until it was split out to the file KiCad keeps it in.
 */
import type { JSX } from 'react';
import { validateUnitValue, type UnitRange } from '@ziroeda/common/widgets/unit_binder.js';
import { ARC_HIGH_DEF, pcbIUScale, stringFromValue } from '@ziroeda/common/eda_units.js';
import type { PagedDialogError } from '@ziroeda/common/widgets/paged_dialog.js';
import { svgUrl } from '@ziroeda/bitmaps_png';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../board.js';
import {
  type CONSTRAINT_ROW,
  type FIELD,
  PANEL_SETUP_CONSTRAINTS_BASE,
  type PANEL_SETUP_CONSTRAINTS_BASE_PROPS,
} from './panel_setup_constraints_base.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The page's fields: BOARD_DESIGN_SETTINGS' minimums, in mm as the binders show them. */
export interface BoardConstraints {
  // Copper
  minClearanceMM: number;
  minTrackMM: number;
  minConnectionMM: number;
  minAnnularMM: number;
  minViaMM: number;
  minUViaMM: number;
  minUViaHoleMM: number;
  copperToHoleMM: number;
  copperToEdgeMM: number;
  /** m_MinGrooveWidth, the creepage slot width; its row is hidden unless the advanced flag is on. */
  minGrooveWidthMM: number;
  // Holes
  minThroughHoleMM: number;
  minHoleToHoleMM: number;
  // Silk
  silkClearanceMM: number;
  minTextHeightMM: number;
  minTextThicknessMM: number;
  // Arc/Circle approximation
  maxDeviationMM: number;
  // Zone fill strategy
  allowFilletsOutside: boolean;
  minThermalSpokes: number;
  // Length tuning
  includeStackupHeight: boolean;
}

/** [data] `MINIMUM_ERROR_SIZE_MM` and `MAXIMUM_ERROR_SIZE_MM`
 *  (`include/board_design_settings.h:97-98`), the range the arc approximation
 *  error is allowed to take. */
export const MIN_ERROR_SIZE_MM = 0.001;
export const MAX_ERROR_SIZE_MM = 0.1;

/**
 * `m_MaxError` as `PANEL_SETUP_CONSTRAINTS::TransferDataFromWindow` stores it:
 *
 *     m_BrdSettings->m_MaxError = KiROUND( std::clamp( m_maxError.GetValue(),
 *             pcbIUScale.IU_PER_MM * MINIMUM_ERROR_SIZE_MM,
 *             pcbIUScale.IU_PER_MM * MAXIMUM_ERROR_SIZE_MM ) );
 *
 * The clamp is not cosmetic: `GetArcToSegmentCount` divides by the error, so a
 * zero typed into the field is a division by zero in the zone filler, and a
 * large one collapses every arc on the board to a triangle.
 */
export function clampMaxErrorMM(mm: number): number {
  return Math.min(Math.max(mm, MIN_ERROR_SIZE_MM), MAX_ERROR_SIZE_MM);
}

/** PANEL_SETUP_CONSTRAINTS's transfers (panel_setup_constraints.cpp). */
export const PANEL_SETUP_CONSTRAINTS = {
  TransferDataToWindow(aBoard: BOARD): BoardConstraints {
    const bds = aBoard.GetDesignSettings();
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    return {
      minClearanceMM: mm(bds.m_MinClearance),
      minTrackMM: mm(bds.m_TrackMinWidth),
      minConnectionMM: mm(bds.m_MinConn),
      minAnnularMM: mm(bds.m_ViasMinAnnularWidth),
      minViaMM: mm(bds.m_ViasMinSize),
      minUViaMM: mm(bds.m_MicroViasMinSize),
      minUViaHoleMM: mm(bds.m_MicroViasMinDrill),
      copperToHoleMM: mm(bds.m_HoleClearance),
      copperToEdgeMM: mm(bds.m_CopperEdgeClearance),
      minGrooveWidthMM: mm(bds.m_MinGrooveWidth),
      minThroughHoleMM: mm(bds.m_MinThroughDrill),
      minHoleToHoleMM: mm(bds.m_HoleToHoleMin),
      silkClearanceMM: mm(bds.m_SilkClearance),
      minTextHeightMM: mm(bds.m_MinSilkTextHeight),
      minTextThicknessMM: mm(bds.m_MinSilkTextThickness),
      maxDeviationMM: mm(bds.m_MaxError),
      allowFilletsOutside: bds.m_ZoneKeepExternalFillets,
      minThermalSpokes: bds.m_MinResolvedSpokes,
      includeStackupHeight: bds.m_UseHeightForLengthCalcs,
    };
  },

  /** "All stored in project file, not board". */
  TransferDataFromWindow(c: BoardConstraints, aBoard: BOARD): void {
    const bds = aBoard.GetDesignSettings();
    const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
    bds.m_UseHeightForLengthCalcs = c.includeStackupHeight;
    bds.m_MaxError = KiROUND(iu(clampMaxErrorMM(c.maxDeviationMM)));
    bds.m_ZoneKeepExternalFillets = c.allowFilletsOutside;
    bds.m_MinResolvedSpokes = c.minThermalSpokes;
    bds.m_MinClearance = iu(c.minClearanceMM);
    bds.m_MinConn = iu(c.minConnectionMM);
    bds.m_TrackMinWidth = iu(c.minTrackMM);
    bds.m_ViasMinAnnularWidth = iu(c.minAnnularMM);
    bds.m_ViasMinSize = iu(c.minViaMM);
    bds.m_HoleClearance = iu(c.copperToHoleMM);
    bds.m_CopperEdgeClearance = iu(c.copperToEdgeMM);
    bds.m_MinGrooveWidth = iu(c.minGrooveWidthMM);
    bds.m_MinThroughDrill = iu(c.minThroughHoleMM);
    bds.m_HoleToHoleMin = iu(c.minHoleToHoleMM);
    bds.m_MicroViasMinSize = iu(c.minUViaMM);
    bds.m_MicroViasMinDrill = iu(c.minUViaHoleMM);
    bds.m_SilkClearance = iu(c.silkClearanceMM);
    bds.m_MinSilkTextHeight = iu(c.minTextHeightMM);
    bds.m_MinSilkTextThickness = iu(c.minTextThicknessMM);
  },
};

/**
 * `PANEL_SETUP_CONSTRAINTS::TransferDataFromWindow` validates ten of the page's
 * fields with `UNIT_BINDER::Validate` and returns false on the FIRST failure,
 * before storing anything (`panel_setup_constraints.cpp:126-165`) — so a bad
 * value keeps the dialog open on this page with the control selected, and none
 * of the page's other edits are committed either.
 *
 * The limits are written in inches and mils upstream and compared in internal
 * units; this page displays millimetres, so they are stated here in the
 * millimetres the message will quote back. The uVia, Silk and deviation fields
 * are deliberately absent: upstream validates none of them, and the deviation
 * is clamped instead ({@link clampMaxErrorMM}).
 */
// [data] `Validate( 0, 10, EDA_UNITS::INCH )` — 10 inch.
const INCH_0_10: UnitRange = { min: 0, max: 25.4 * 10 };
// [data] `Validate( 2, 1000, EDA_UNITS::MILS )`, upstream's own comment being
// "#107 to 1 inch".
const MILS_2_1000: UnitRange = { min: 0.0254 * 2, max: 0.0254 * 1000 };

const CONSTRAINT_RANGES: readonly (readonly [keyof BoardConstraints, string, UnitRange])[] = [
  ['minClearanceMM', _HKI('Minimum clearance:'), INCH_0_10],
  ['minConnectionMM', _HKI('Minimum connection width:'), INCH_0_10],
  ['minTrackMM', _HKI('Minimum track width:'), INCH_0_10],
  ['minAnnularMM', _HKI('Minimum annular width:'), INCH_0_10],
  ['minViaMM', _HKI('Minimum via diameter:'), INCH_0_10],
  ['copperToHoleMM', _HKI('Copper to hole clearance:'), INCH_0_10],
  ['copperToEdgeMM', _HKI('Copper to edge clearance:'), INCH_0_10],
  ['minGrooveWidthMM', _HKI('Minimum groove for creepage:'), INCH_0_10],
  ['minThroughHoleMM', _HKI('Minimum drill size:'), MILS_2_1000],
  ['minHoleToHoleMM', _HKI('Hole to hole clearance:'), INCH_0_10],
];

/** `document.getElementById` handle for one constraint entry, so PAGED_DIALOG
 *  can focus and select the field `Validate` refused. */
export function constraintFieldId(key: keyof BoardConstraints): string {
  return `ze-constraint-${key}`;
}

/** The first `Validate` failure on the page, or null. */
export function validateConstraints(c: BoardConstraints): PagedDialogError | null {
  for (const [key, label, range] of CONSTRAINT_RANGES) {
    const message = validateUnitValue(label, c[key] as number, range, 'mm', pcbIUScale);
    if (message) return { message, page: 'constraints', focusId: constraintFieldId(key) };
  }
  return null;
}

/** The class's SetBitmap( KiBitmapBundle( BITMAPS::…, 24 ) ). */
const BITMAPS: Partial<Record<CONSTRAINT_ROW | 'fillet' | 'spoke', string>> = {
  fillet: 'zone_fillet',
  spoke: 'thermal_spokes',
  minClearance: 'ps_diff_pair_gap',
  trackMinWidth: 'width_track',
  minConn: 'width_conn',
  viaMinAnnulus: 'via_annulus',
  viaMinSize: 'via_diameter',
  throughHoleMin: 'via_hole_diameter',
  uviaMinSize: 'via_diameter',
  uviaMinDrill: 'via_hole_diameter',
  holeClearance: 'hole_to_copper_clearance',
  holeToHoleMin: 'hole_to_hole_clearance',
  edgeClearance: 'edge_to_copper_clearance',
};

/** Each UNIT_BINDER's row, and the field it edits. */
const ROW_FIELD: Record<CONSTRAINT_ROW, keyof BoardConstraints> = {
  minClearance: 'minClearanceMM',
  trackMinWidth: 'minTrackMM',
  minConn: 'minConnectionMM',
  viaMinAnnulus: 'minAnnularMM',
  viaMinSize: 'minViaMM',
  holeClearance: 'copperToHoleMM',
  edgeClearance: 'copperToEdgeMM',
  minGrooveWidth: 'minGrooveWidthMM',
  throughHoleMin: 'minThroughHoleMM',
  holeToHoleMin: 'minHoleToHoleMM',
  uviaMinSize: 'minUViaMM',
  uviaMinDrill: 'minUViaHoleMM',
  silkClearance: 'silkClearanceMM',
  minTextHeight: 'minTextHeightMM',
  minTextThickness: 'minTextThicknessMM',
};

/** PANEL_SETUP_CONSTRAINTS's window: its base over the board's minimums, in the frame's units. */
export function PanelSetupConstraints({
  value,
  units,
  onChange,
}: {
  value: BoardConstraints;
  /** The frame's display units. */
  units: StatusUnits;
  onChange: (next: BoardConstraints) => void;
}): JSX.Element {
  /**
   * `UNIT_BINDER::GetValue()` for a field the model holds in millimetres: the field shows the
   * frame's unit, and a trailing designator (`0.15mm` in a mils field) is honoured.
   */
  const num = (s: string): number => {
    const mm = pcbUnitValueMM(s, units);
    return Number.isFinite(mm) ? mm : 0;
  };
  const setCon = (key: keyof BoardConstraints, next: number | boolean): void =>
    onChange({ ...value, [key]: next });
  const field = (aKey: keyof BoardConstraints): FIELD => ({
    value: pcbUnitTextMM(value[aKey] as number, units),
    onChange: (aText) => setCon(aKey, num(aText)),
    id: constraintFieldId(aKey),
  });

  const fields = Object.fromEntries(
    (Object.keys(ROW_FIELD) as CONSTRAINT_ROW[]).map((row) => [row, field(ROW_FIELD[row])]),
  ) as Record<CONSTRAINT_ROW, FIELD>;
  const bitmaps = Object.fromEntries(
    Object.entries(BITMAPS).map(([k, file]) => [k, svgUrl('constraints', file!)]),
  ) as PANEL_SETUP_CONSTRAINTS_BASE_PROPS['bitmaps'];

  return (
    <PANEL_SETUP_CONSTRAINTS_BASE
      fields={fields}
      units={unitLabel(units)}
      bitmaps={bitmaps}
      // ADVANCED_CFG::m_EnableCreepageSlot, off by default.
      grooveShown={false}
      m_maxError={field('maxDeviationMM')}
      // TransferDataToWindow: Printf( label, m_Frame->StringFromValue( ARC_HIGH_DEF, true ) ).
      m_stCircleToPolyWarning={`Note: zone filling can be slow when < ${stringFromValue(pcbIUScale, units, ARC_HIGH_DEF, true)}.`}
      m_allowExternalFilletsOpt={{
        value: value.allowFilletsOutside,
        onChange: (aOn) => setCon('allowFilletsOutside', aOn),
      }}
      m_minResolvedSpokeCountCtrl={{
        value: value.minThermalSpokes,
        onChange: (n) => setCon('minThermalSpokes', n),
      }}
      m_useHeightForLengthCalcs={{
        value: value.includeStackupHeight,
        onChange: (aOn) => setCon('includeStackupHeight', aOn),
      }}
    />
  );
}
