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
import { CheckBox } from '@ziroeda/common/wx/controls.js';
import type { JSX } from 'react';
import { validateUnitValue, type UnitRange } from '@ziroeda/common/widgets/unit_binder.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { PagedDialogError } from '@ziroeda/common/widgets/paged_dialog.js';
import { SpinCtrl } from '@ziroeda/common/widgets/spin_ctrl.js';
import { svgUrl } from '@ziroeda/bitmaps_png';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../board.js';

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
 * KiCad's own dark-theme constraint icons, vendored under assets/constraints
 * (GPL like this project, same pattern as assets/toolbar). Filenames are the
 * KiCad BITMAPS enum names assigned in panel_setup_constraints.cpp.
 */
// Constraint row -> KiCad bitmap file (SetBitmap(KiBitmapBundle(BITMAPS::…))).
const CON_ICON_FILE: Record<string, string> = {
  clearance: 'ps_diff_pair_gap',
  track: 'width_track',
  conn: 'width_conn',
  annular: 'via_annulus',
  viaDia: 'via_diameter',
  uviaDia: 'via_diameter',
  uviaHole: 'via_hole_diameter',
  copperHole: 'hole_to_copper_clearance',
  copperEdge: 'edge_to_copper_clearance',
  throughHole: 'via_hole_diameter',
  holeToHole: 'hole_to_hole_clearance',
  fillet: 'zone_fillet',
  spoke: 'thermal_spokes',
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
  ['minClearanceMM', 'Minimum clearance:', INCH_0_10],
  ['minConnectionMM', 'Minimum connection width:', INCH_0_10],
  ['minTrackMM', 'Minimum track width:', INCH_0_10],
  ['minAnnularMM', 'Minimum annular width:', INCH_0_10],
  ['minViaMM', 'Minimum via diameter:', INCH_0_10],
  ['copperToHoleMM', 'Copper to hole clearance:', INCH_0_10],
  ['copperToEdgeMM', 'Copper to edge clearance:', INCH_0_10],
  ['minThroughHoleMM', 'Minimum drill size:', MILS_2_1000],
  ['minHoleToHoleMM', 'Hole to hole clearance:', INCH_0_10],
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

function ConIcon({ name }: { name: string }): JSX.Element | null {
  const file = CON_ICON_FILE[name];
  const url = file ? svgUrl('constraints', file) : undefined;
  // [data] `KiBitmapBundle( BITMAPS::…, 24 )` — every bitmap on this page is
  // asked for at 24 (`panel_setup_constraints.cpp:61-73`). This drew them at 20.
  return url ? <img src={url} width={24} height={24} alt="" aria-hidden="true" /> : null;
}

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
   * `UNIT_BINDER::GetValue()` for a field the model holds in millimetres.
   *
   * Not `Number()`: the field shows the FRAME's unit, so on a mils board this
   * read 5.906 as 5.906 millimetres. It also honours a trailing designator, so
   * `0.15mm` typed into a mils field means 0.15 mm.
   */
  const num = (s: string): number => {
    const mm = pcbUnitValueMM(s, units);
    return Number.isFinite(mm) ? mm : 0;
  };

  const setCon = (key: keyof BoardConstraints, next: number | boolean): void =>
    onChange({ ...value, [key]: next });

  // A numeric constraint row of `fgFeatureConstraints`, the 4-column
  // `wxFlexGridSizer( 0, 4, 0, 0 )` the whole left half of the page is built
  // from (`panel_setup_constraints_base.cpp:26`): bitmap | label | wxTextCtrl |
  // units. Pass icon='' for the rows KiCad leaves un-iconed (Silk); the empty
  // cell keeps the column.
  const conRow = (icon: string, label: string, key: keyof BoardConstraints): JSX.Element => (
    <div className="ze-con-row" key={key}>
      <span className="ze-con-icon">{icon ? <ConIcon name={icon} /> : null}</span>
      <span className="lbl">{label}</span>
      <input
        id={constraintFieldId(key)}
        className="ze-search"
        value={pcbUnitTextMM(value[key] as number, units)}
        onChange={(e) => setCon(key, num(e.target.value))}
      />
      <span className="unit">{unitLabel(units)}</span>
    </div>
  );

  // A section heading of `fgFeatureConstraints`: the `wxStaticText` occupies
  // the FIRST column only (`Add( m_staticText23, 0, wxTOP|wxLEFT, 13 )`), and
  // the four `wxStaticLine`s under it fill the row. Making the heading span
  // instead left the bitmap column as narrow as a bitmap; in KiCad it is as
  // wide as "Copper", which is what indents the icons.
  const conHead = (title: string): JSX.Element[] => [
    <div className="ze-con-head" key={`h:${title}`}>
      {title}
    </div>,
    <hr className="ze-hr ze-con-hr" key={`r:${title}`} />,
  ];

  return (
    // `bScrolledSizer`, a horizontal box: `sbFeatureConstraints` on the left
    // and `sbFeatureRules` on the right (`:20-23`, `:379`).
    <div className="ze-con-cols">
      <div className="ze-con-grid">
        {conHead('Copper')}
        {conRow('clearance', 'Minimum clearance:', 'minClearanceMM')}
        {conRow('track', 'Minimum track width:', 'minTrackMM')}
        {conRow('conn', 'Minimum connection width:', 'minConnectionMM')}
        {conRow('annular', 'Minimum annular width:', 'minAnnularMM')}
        {conRow('viaDia', 'Minimum via diameter:', 'minViaMM')}
        {conRow('copperHole', 'Copper to hole clearance:', 'copperToHoleMM')}
        {conRow('copperEdge', 'Copper to edge clearance:', 'copperToEdgeMM')}
        {/* `m_minGrooveWidth*`, "Minimum groove for creepage:" (`:172-190`), is
            built and then `Show( false )` unless
            `ADVANCED_CFG::m_EnableCreepageSlot` — an advanced-config flag that
            is off by default, so a stock KiCad does not draw this row. */}

        {conHead('Holes')}
        {/* [data] `m_MinDrillTitle`, "Minimum drill size:" (`:214`). This read
            "Minimum through hole:", which is the v7 string. */}
        {conRow('throughHole', 'Minimum drill size:', 'minThroughHoleMM')}
        {conRow('holeToHole', 'Hole to hole clearance:', 'minHoleToHoleMM')}

        {conHead('uVias')}
        {conRow('uviaDia', 'Minimum uVia diameter:', 'minUViaMM')}
        {conRow('uviaHole', 'Minimum uVia hole:', 'minUViaHoleMM')}

        {conHead('Silk')}
        {conRow('', 'Minimum item clearance:', 'silkClearanceMM')}
        {conRow('', 'Minimum text height:', 'minTextHeightMM')}
        {conRow('', 'Minimum text thickness:', 'minTextThicknessMM')}
      </div>

      <div className="ze-con-rules">
        {/* [data] `m_stCircleToPolyOpt`, "Arc/Circle Approximations" (`:384`).
            This read "Arc/Circle Approximated by Segments", the v6 string. */}
        <div className="ze-pref-group-title">Arc/Circle Approximations</div>
        {/* `fgSizer2` (`:400`) is label | entry | units and has no bitmap
            column, so this row is NOT one of the left grid's. */}
        <div className="ze-con-dev">
          <span className="lbl">Maximum allowed deviation:</span>
          <input
            className="ze-search"
            value={pcbUnitTextMM(value.maxDeviationMM, units)}
            onChange={(e) => setCon('maxDeviationMM', num(e.target.value))}
          />
          <span className="unit">{unitLabel(units)}</span>
        </div>
        {/* `KIUI::GetSmallInfoFont( this ).Italic()`
            (`panel_setup_constraints.cpp:74`) — the info font TWO points down,
            which is `.ze-pref-hint`, not a grey 11px caption. */}
        <div className="ze-pref-hint">Note: zone filling can be slow when &lt; 0.005 mm.</div>

        <div className="ze-con-fill">
          <div className="ze-pref-group-title">Zone Fill Strategy</div>
          {/* `bSizer9` (`:437-445`): the bitmap and the checkbox are SIBLINGS in
              a horizontal box, so the icon sits outside the label. Inside it,
              the box-to-text gap stays the shared checkbox's. */}
          <div className="ze-con-check">
            <span className="ze-con-icon">
              <ConIcon name="fillet" />
            </span>
            <CheckBox
              label="Allow fillets/chamfers outside zone outline"
              checked={value.allowFilletsOutside}
              className="ze-pref-check"
              onChange={(aChecked) => setCon('allowFilletsOutside', aChecked)}
            />
          </div>
          <div className="ze-con-spoke">
            <span className="ze-con-icon">
              <ConIcon name="spoke" />
            </span>
            <span className="lbl">Minimum thermal relief spoke count:</span>
            {/* [data] `new wxSpinCtrl( …, wxSP_ARROW_KEYS, 0, 10, 0 )` (`:452`)
                — a spin control with the theme's two arrow buttons, which this
                drew as a plain 210 px text field. It carries no width: KiCad's
                one `SetSize` on it (`panel_setup_constraints.cpp:77-79`) is
                overridden by the sizer, which lays it out at its best size. */}
            <SpinCtrl
              value={value.minThermalSpokes}
              onChange={(n) => setCon('minThermalSpokes', n)}
              min={0}
              max={10}
              ariaLabel="Minimum thermal relief spoke count"
            />
          </div>
        </div>

        <div className="ze-pref-group-title">Length Tuning</div>
        <CheckBox
          label="Include stackup height in track length calculations"
          checked={value.includeStackupHeight}
          className="ze-pref-check"
          onChange={(aChecked) => setCon('includeStackupHeight', aChecked)}
        />
      </div>
    </div>
  );
}
