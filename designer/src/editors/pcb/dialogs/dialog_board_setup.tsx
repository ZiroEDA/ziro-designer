// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup dialog. Counterpart: `pcbnew/dialogs/dialog_board_setup.cpp`
 * (DIALOG_BOARD_SETUP), a PAGED_DIALOG whose tree mirrors pcbnew exactly:
 *   Board Stackup   : Board Editor Layers, Physical Stackup, Board Finish,
 *                     Solder Mask/Paste, Zone Hatch Offsets
 *   Text & Graphics : Defaults, Formatting, Text Variables
 *   Design Rules    : Constraints, Pre-defined Sizes, Teardrops,
 *                     Length-tuning Patterns, Tuning Profiles, Net Classes,
 *                     Component Classes, Custom Rules, Violation Severity
 *   Board Data      : Embedded Files
 *
 * Uses the shared PagedDialog shell. Board Setup has no "Reset to Defaults"
 * button (aShowReset=false) and an "Import Settings from Another Board..." aux
 * action, at wxSize(980, 600). Live pages: Constraints, Pre-defined Sizes
 * (PANEL_SETUP_TRACKS_AND_VIAS, Tracks / Vias / Differential Pairs), Net Classes
 * (shared PANEL_SETUP_NETCLASSES) and Text Variables (shared PANEL_TEXT_VARIABLES).
 * Values seed from the project's .kicad_pro and commit on OK.
 */
import { useState, type JSX } from 'react';
import {
  PagedDialog,
  type PagedDialogError,
  type PagedDialogSection,
} from '../../../ui/PagedDialog.js';
import { validateUnitValue, type UnitRange } from '../../../ui/unit_binder.js';
import { pcbIUScale, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { validateViaParameters } from '@ziroeda/pcbnew/src/pcb_track.js';
import { Icon } from '../../../ui/icons.js';
import { SpinCtrl } from '../../../ui/SpinCtrl.js';

/**
 * KiCad's own dark-theme constraint icons, vendored under assets/constraints
 * (GPL like this project, same pattern as assets/toolbar). Filenames are the
 * KiCad BITMAPS enum names assigned in panel_setup_constraints.cpp.
 */
const CON_ICON_URLS = import.meta.glob('../../../assets/constraints/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

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

/** `document.getElementById` handle for one grid cell, so PAGED_DIALOG can
 *  focus the cell `Validate()` refused — `SetError( …, grid, row, col )`. */
export function sizeCellId(grid: string, row: number, col: string): string {
  return `ze-size-${grid.replace(/\s+/g, '-').toLowerCase()}-${row}-${col}`;
}

/**
 * `std::sort` over the row struct, which is `operator<` and not the first
 * column: `VIA_DIMENSION` compares diameter then drill, `DIFF_PAIR_DIMENSION`
 * width then gap then via gap (`board_design_settings.h:144`, `:187`).
 */
export function sortSizeRows<T>(rows: readonly T[], keys: readonly (keyof T)[]): T[] {
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const d = (a[k] as number) - (b[k] as number);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/**
 * `PANEL_SETUP_TRACKS_AND_VIAS::TransferDataFromWindow` (`:290-345`): a row
 * whose FIRST column is empty is dropped, and what survives is sorted.
 *
 * Both halves are unconditional. The Sort button is a convenience; OK sorts
 * whether or not it was pressed, which is why a board file's lists are always
 * in increasing order.
 */
export function normalizeSizeRows<T>(rows: readonly T[], keys: readonly (keyof T)[]): T[] {
  const first = keys[0]!;
  return sortSizeRows(
    rows.filter((r) => (r[first] as number) > 0),
    keys,
  );
}

/**
 * `PANEL_SETUP_TRACKS_AND_VIAS::Validate()` (`:376-433`), which is the page's
 * own refusal and runs before anything is stored.
 *
 * The via half is `PCB_VIA::ValidateViaParameters` (`pcb_track.cpp:1769-1817`)
 * with every layer argument `std::nullopt`, so five of its checks apply. A
 * value of zero is this page's empty cell, which is upstream's "has no value"
 * — so "no hole size defined" is a diameter with a zero drill beside it, not a
 * separate rule.
 *
 * Returns the message and the cell to focus, or null.
 */
export function validateSizes(v: {
  viaSizesMM: readonly ViaSize[];
  diffPairsMM: readonly DiffPairSize[];
}): { message: string; row: number; grid: string; col: string } | null {
  for (const [row, via] of v.viaSizesMM.entries()) {
    // `PCB_VIA::ValidateViaParameters`, shared with the Custom Track/Via Size
    // dialog so the two refuse the same values in the same words. A zero is
    // this page's empty cell, which is upstream's empty `std::optional`.
    const bad = validateViaParameters(
      via.diameter > 0 ? pcbMmToIU(via.diameter) : undefined,
      via.drill > 0 ? pcbMmToIU(via.drill) : undefined,
    );

    if (bad) return { message: bad.message, row, grid: 'Vias', col: bad.field };
  }

  // "No differential pair gap defined." — a width with no gap. A via gap is
  // optional and is not checked.
  for (const [row, dp] of v.diffPairsMM.entries()) {
    if (dp.width > 0 && !(dp.gap > 0))
      return {
        message: 'No differential pair gap defined.',
        row,
        grid: 'Differential Pairs',
        col: 'gap',
      };
  }

  return null;
}

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
function validateConstraints(c: BoardConstraints): PagedDialogError | null {
  for (const [key, label, range] of CONSTRAINT_RANGES) {
    const message = validateUnitValue(label, c[key] as number, range, 'mm', pcbIUScale);
    if (message) return { message, page: 'constraints', focusId: constraintFieldId(key) };
  }
  return null;
}

function ConIcon({ name }: { name: string }): JSX.Element | null {
  const file = CON_ICON_FILE[name];
  const url = file ? CON_ICON_URLS[`../../../assets/constraints/${file}.svg`] : undefined;
  // [data] `KiBitmapBundle( BITMAPS::…, 24 )` — every bitmap on this page is
  // asked for at 24 (`panel_setup_constraints.cpp:61-73`). This drew them at 20.
  return url ? <img src={url} width={24} height={24} alt="" aria-hidden="true" /> : null;
}
import { PanelTextVariables } from '../../../dialogs/panels/panel_text_variables.js';
import { PanelSetupNetclasses } from '../../../dialogs/panels/panel_setup_netclasses.js';
import { PanelEmbeddedFiles } from '../../../dialogs/panels/panel_embedded_files.js';
import { PanelPcbSeverities } from './panels/panel_pcb_severities.js';
import { PanelPcbTextGraphics } from './panels/panel_pcb_text_graphics.js';
import { PanelPcbFormatting } from './panels/panel_pcb_formatting.js';
import { PanelPcbMaskPaste } from './panels/panel_pcb_mask_paste.js';
import { PanelPcbZones } from './panels/panel_pcb_zones.js';
import { PanelPcbLayers, layerNameInputId, testLayerNames } from './panels/panel_pcb_layers.js';
import { PanelPcbZoneHatchOffsets } from './panels/panel_pcb_zone_hatch_offsets.js';
import { PanelPcbTeardrops } from './panels/panel_pcb_teardrops.js';
import { PanelPcbTuning } from './panels/panel_pcb_tuning.js';
import { PanelPcbTuningProfiles } from './panels/panel_pcb_tuning_profiles.js';
import { PanelPcbBoardFinish } from './panels/panel_pcb_board_finish.js';
import { PanelPcbStackup } from './panels/panel_pcb_stackup.js';
import { PanelPcbComponentClasses } from './panels/panel_pcb_component_classes.js';
import { PanelPcbCustomRules } from './panels/panel_pcb_custom_rules.js';
import { clampMaxErrorMM, copperStackNames, syncCopperLayers } from '../board_settings.js';
import type {
  BoardConstraints,
  BoardSetupValues,
  DiffPairSize,
  ViaSize,
} from '../board_settings.js';
import { readBoardSetupProText } from '../project_settings.js';
import { applyBoardFileSetup } from '../board_file_settings.js';
import { DialogImportSettings, type ImportSettingsOpts } from './dialog_import_settings.js';
import { pcbUnitTextMM, pcbUnitValueMM, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';

// The aggregate model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so dialog users keep importing from the dialog module.
export {
  defaultBoardSetup,
  type BoardConstraints,
  type BoardSetupValues,
  type DiffPairSize,
  type ViaSize,
} from '../board_settings.js';

type PageId =
  | 'layers'
  | 'physicalStackup'
  | 'boardFinish'
  | 'maskPaste'
  | 'zoneHatchOffsets'
  | 'defaults'
  | 'formatting'
  | 'textVars'
  | 'constraints'
  | 'sizes'
  | 'teardrops'
  | 'tuningPatterns'
  | 'tuningProfiles'
  | 'netclasses'
  | 'componentClasses'
  | 'customRules'
  | 'severities'
  | 'embedded';

interface Props {
  value: BoardSetupValues;
  /**
   * The frame's display units. Board Setup's constraints are `UNIT_BINDER`s
   * upstream like every other distance field; ours held them in millimetres and
   * said so on the page.
   */
  units: StatusUnits;
  initialPage?: PageId;
  onOk: (next: BoardSetupValues) => void;
  onClose: () => void;
}

export function DialogBoardSetup({ value, units, initialPage, onOk, onClose }: Props): JSX.Element {
  const [v, setV] = useState<BoardSetupValues>(() => structuredClone(value));
  const [importOpen, setImportOpen] = useState(false);
  // `SetSelectionMode( wxGridSelectRows )` on the three Pre-defined Sizes
  // grids: one selected row per grid, and it is what the remove button deletes.
  const [sizeSel, setSizeSel] = useState<Record<string, number | null>>({});
  // The one open cell editor, keyed grid|row|column. A wxGrid has exactly one.
  const [cellEdit, setCellEdit] = useState<{ key: string; text: string } | null>(null);

  // DIALOG_BOARD_SETUP::onAuxiliaryAction: parse the other project's files
  // and copy the selected groups into the working values (each panel's
  // ImportSettingsFrom). Layers, physical stackup and board finish are
  // linked and import together, like upstream.
  const applyImport = (files: { name: string; text: string }[], opts: ImportSettingsOpts): void => {
    const pcb = files.find((f) => /\.kicad_pcb$/i.test(f.name));
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
    const dru = files.find((f) => /\.kicad_dru$/i.test(f.name));
    if (!pcb || !pro) {
      // KiCad refuses when the associated project file cannot be loaded.
      window.alert(
        'Error importing settings from board:\n' +
          `Associated ${pcb ? 'project (.kicad_pro)' : 'board (.kicad_pcb)'} file could not be loaded`,
      );
      return;
    }
    const other = readBoardSetupProText(pro.text);
    if (!applyBoardFileSetup(pcb.text, other)) {
      window.alert(`Error loading board file:\n${pcb.name}`);
      return;
    }
    if (dru) other.customRules.text = dru.text;

    // PANEL_SETUP_LAYERS::CheckCopperLayerCount: warn when the import would
    // drop inner copper layers of the current board.
    if (opts.layers && other.physicalStackup.copperCount < v.physicalStackup.copperCount) {
      const ok = window.confirm(
        'Imported settings have fewer copper layers than the current board. ' +
          'Items on the vanishing layers will be deleted.\n\nContinue?',
      );
      if (!ok) return;
    }

    const next = structuredClone(v);
    if (opts.layers) {
      // Stackup, layers and board finish import together (they are linked).
      next.physicalStackup = structuredClone(other.physicalStackup);
      next.layers = structuredClone(other.layers);
      next.boardFinish = structuredClone(other.boardFinish);
    }
    if (opts.textAndGraphics) next.textGraphics = structuredClone(other.textGraphics);
    if (opts.formatting) next.formatting = structuredClone(other.formatting);
    if (opts.constraints) next.constraints = structuredClone(other.constraints);
    if (opts.netclasses) next.netClasses = structuredClone(other.netClasses);
    if (opts.componentClasses) next.componentClasses = structuredClone(other.componentClasses);
    if (opts.tracksAndVias) {
      next.trackWidthsMM = [...other.trackWidthsMM];
      next.viaSizesMM = structuredClone(other.viaSizesMM);
      next.diffPairsMM = structuredClone(other.diffPairsMM);
    }
    if (opts.zones) next.zones = structuredClone(other.zones);
    if (opts.teardrops) next.teardrops = structuredClone(other.teardrops);
    if (opts.tuningPatterns) next.tuning = structuredClone(other.tuning);
    if (opts.maskAndPaste) next.maskPaste = structuredClone(other.maskPaste);
    if (opts.customRules) next.customRules = structuredClone(other.customRules);
    if (opts.severities) next.drcSeverities = structuredClone(other.drcSeverities);
    if (opts.tuningProfiles) next.tuningProfiles = structuredClone(other.tuningProfiles);
    setV(next);
    setImportOpen(false);
  };

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

  const setCon = (key: keyof BoardConstraints, value: number | boolean): void =>
    setV({ ...v, constraints: { ...v.constraints, [key]: value } });

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
        value={pcbUnitTextMM(v.constraints[key] as number, units)}
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

  const constraintsPanel = (): JSX.Element => (
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
            value={pcbUnitTextMM(v.constraints.maxDeviationMM, units)}
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
            <label className="ze-pref-check">
              <input
                type="checkbox"
                checked={v.constraints.allowFilletsOutside}
                onChange={(e) => setCon('allowFilletsOutside', e.target.checked)}
              />
              Allow fillets/chamfers outside zone outline
            </label>
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
              value={v.constraints.minThermalSpokes}
              onChange={(n) => setCon('minThermalSpokes', n)}
              min={0}
              max={10}
              ariaLabel="Minimum thermal relief spoke count"
            />
          </div>
        </div>

        <div className="ze-pref-group-title">Length Tuning</div>
        <label className="ze-pref-check">
          <input
            type="checkbox"
            checked={v.constraints.includeStackupHeight}
            onChange={(e) => setCon('includeStackupHeight', e.target.checked)}
          />
          Include stackup height in track length calculations
        </label>
      </div>
    </div>
  );

  /**
   * One pre-defined-size grid (Tracks / Vias / Differential Pairs), and the
   * three of them are the whole of `PANEL_SETUP_TRACKS_AND_VIAS`.
   *
   * A cell is a `WX_GRID` cell with `SetUnitsProvider( m_Frame )` and
   * `SetAutoEvalCols`, so it holds TEXT, not a number: `SetUnitValue` writes
   * `StringFromValue( iu, true )` — "0.5 mm" — and `GetUnitValue` parses it
   * back. Two consequences the previous version got wrong. The cell shows its
   * unit, and a zero is written as an EMPTY cell, because
   * `AppendViaSize`/`AppendDiffPairs` only call `SetUnitValue` for a drill,
   * gap or via gap that is `> 0` (`panel_setup_tracks_and_vias.cpp:446-472`) —
   * that empty cell is what `<= 0 means use Netclass` looks like to the user.
   */
  const sizeGrid = <T,>(
    title: string,
    cols: { label: string; key: keyof T }[],
    rows: T[],
    setRows: (next: T[]) => void,
    blank: T,
  ): JSX.Element => {
    const sel = sizeSel[title] ?? null;
    const setSel = (i: number | null): void => setSizeSel({ ...sizeSel, [title]: i });

    // The cell the user is typing in. A wxGrid has exactly one open editor, and
    // the value commits when it closes — which is why this holds TEXT: driving
    // the model off every keystroke turns "0." into 0 and rewrites the field
    // under the caret before the second digit arrives.
    const cellKey = (i: number, key: keyof T): string => `${title}|${i}|${String(key)}`;
    const shown = (i: number, key: keyof T): string => {
      const k = cellKey(i, key);
      if (cellEdit?.key === k) return cellEdit.text;
      const mm = rows[i]?.[key] as number;
      // `SetUnitValue` writes the unit INTO the cell, unlike a UNIT_BINDER,
      // which puts it in a label beside the field.
      return mm > 0 ? pcbUnitTextMM(mm, units, true) : '';
    };
    const commit = (i: number, key: keyof T, text: string): void => {
      const arr = [...rows];
      arr[i] = { ...arr[i]!, [key]: pcbUnitValueMM(text, units) };
      setRows(arr);
      setCellEdit(null);
    };

    return (
      <div className="ze-sizes-col">
        {/* [data] `bSizerTracks->Add( stTracksLabel, 0, wxALL, 5 )`. */}
        <div className="ze-sizes-title">{title}</div>
        <div className="ze-grid-pane ze-sizes-pane">
          <table className="ze-grid">
            {/* The columns are 120 wide and the grid WINDOW is wider; the
                trailing filler is the empty grid area to their right, which a
                wxGrid paints and a table otherwise would not. */}
            <colgroup>
              {cols.map((c) => (
                <col key={String(c.key)} className="ze-sizes-col-w" />
              ))}
              <col />
            </colgroup>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={String(c.key)} className="ze-sticky-head">
                    {c.label}
                  </th>
                ))}
                <th className="ze-sticky-head" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // `SetSelectionMode( wxGridSelectRows )` on all three grids
                // (`panel_setup_tracks_and_vias.cpp:88-90`): the unit of
                // selection is a ROW, which is what the remove button deletes.
                <tr
                  key={i}
                  className={i === sel ? 'selected' : undefined}
                  onFocusCapture={() => setSel(i)}
                  onMouseDown={() => setSel(i)}
                >
                  {cols.map((c) => (
                    <td key={String(c.key)}>
                      <input
                        type="text"
                        id={sizeCellId(title, i, String(c.key))}
                        value={shown(i, c.key)}
                        onFocus={() =>
                          setCellEdit({ key: cellKey(i, c.key), text: shown(i, c.key) })
                        }
                        onChange={(e) =>
                          setCellEdit({ key: cellKey(i, c.key), text: e.target.value })
                        }
                        onBlur={(e) => commit(i, c.key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(i, c.key, e.currentTarget.value);
                        }}
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ze-grid-btns">
          {/* `OnAddRow` appends a row of ZEROS — `AppendTrackWidth( 0 )`,
              `AppendViaSize( 0, 0 )`, `AppendDiffPairs( 0, 0, 0 )` — and puts
              the cursor in its first column. It does not invent a size. */}
          <button
            className="ze-gridbtn ze-gridbtn-add"
            title="Add"
            onClick={() => {
              setRows([...rows, blank]);
              setSel(rows.length);
              setCellEdit(null);
              const first = cols[0]!.key;
              window.setTimeout(
                () =>
                  document.getElementById(sizeCellId(title, rows.length, String(first)))?.focus(),
                0,
              );
            }}
          >
            <Icon name="plus" />
          </button>
          {/* `std::sort` over the whole struct — `VIA_DIMENSION::operator<`
              compares diameter then drill, `DIFF_PAIR_DIMENSION::operator<`
              width then gap then via gap (`board_design_settings.h:144`,
              `:187`). Sorting on the first column alone left two rows of the
              same diameter in whatever order they were typed. The button is
              not disabled: upstream's handler returns early under two rows. */}
          <button
            className="ze-gridbtn ze-gridbtn-sort"
            title="Sort ascending"
            onClick={() =>
              setRows(
                sortSizeRows(
                  rows,
                  cols.map((c) => c.key),
                ),
              )
            }
          >
            <Icon name="arrowDown" />
          </button>
          {/* `WX_GRID::OnDeleteRows` deletes the SELECTED rows. This deleted
              the last row of the grid whatever was selected. */}
          <button
            className="ze-gridbtn ze-gridbtn-remove"
            title="Remove"
            disabled={sel === null}
            onClick={() => {
              if (sel === null) return;
              setRows(rows.filter((_, j) => j !== sel));
              setSel(rows.length - 1 > sel ? sel : sel - 1 >= 0 ? sel - 1 : null);
              setCellEdit(null);
            }}
          >
            <Icon name="delete" />
          </button>
        </div>
      </div>
    );
  };

  const sizesPanel = (): JSX.Element => (
    // `bMainSizer`, horizontal: three columns at proportion 1
    // (`panel_setup_tracks_and_vias_base.cpp:71`, `:130`, `:198`), so they
    // split the page in thirds whatever their grids need.
    <div className="ze-sizes-cols">
      {/* [data] the column labels, which carry no unit: `SetColLabelValue( 0,
          _("Width") )` and friends (`_base.cpp:41`, `:96-97`, `:165-167`).
          These read "Width (mm)" — the unit is in the CELL, not the header. */}
      {sizeGrid<{ width: number }>(
        'Tracks',
        [{ label: 'Width', key: 'width' }],
        v.trackWidthsMM.map((width) => ({ width })),
        (rows) => setV({ ...v, trackWidthsMM: rows.map((r) => r.width) }),
        { width: 0 },
      )}
      {sizeGrid<ViaSize>(
        'Vias',
        [
          { label: 'Diameter', key: 'diameter' },
          { label: 'Hole', key: 'drill' },
        ],
        v.viaSizesMM,
        (rows) => setV({ ...v, viaSizesMM: rows }),
        { diameter: 0, drill: 0 },
      )}
      {sizeGrid<DiffPairSize>(
        'Differential Pairs',
        [
          { label: 'Width', key: 'width' },
          { label: 'Gap', key: 'gap' },
          { label: 'Via Gap', key: 'viaGap' },
        ],
        v.diffPairsMM,
        (rows) => setV({ ...v, diffPairsMM: rows }),
        { width: 0, gap: 0, viaGap: 0 },
      )}
    </div>
  );

  // The upstream page tree (DIALOG_BOARD_SETUP::DIALOG_BOARD_SETUP).
  const sections: PagedDialogSection[] = [
    {
      label: 'Board Stackup',
      pages: [
        {
          id: 'layers',
          label: 'Board Editor Layers',
          render: () => (
            <PanelPcbLayers value={v.layers} onChange={(layers) => setV({ ...v, layers })} />
          ),
        },
        {
          id: 'physicalStackup',
          label: 'Physical Stackup',
          render: () => (
            <PanelPcbStackup
              value={v.physicalStackup}
              // `DIALOG_BOARD_SETUP::OnPageChange` fans `SyncCopperLayers( m_physicalStackup
              // ->GetCopperLayerCount() )` out to the Layers, Tuning Profiles and Zone Hatch
              // Offsets pages (`dialog_board_setup.cpp:306-330`). Our pages read their rows
              // from this value, so the fan-out is one call on the count changing rather
              // than three overrides fired on navigation.
              onChange={(physicalStackup) =>
                setV(
                  physicalStackup.copperCount === v.physicalStackup.copperCount
                    ? { ...v, physicalStackup }
                    : syncCopperLayers({ ...v, physicalStackup }, physicalStackup.copperCount),
                )
              }
              finish={v.boardFinish}
            />
          ),
        },
        {
          id: 'boardFinish',
          label: 'Board Finish',
          render: () => (
            <PanelPcbBoardFinish
              value={v.boardFinish}
              onChange={(boardFinish) => setV({ ...v, boardFinish })}
            />
          ),
        },
        {
          id: 'maskPaste',
          label: 'Solder Mask/Paste',
          render: () => (
            <PanelPcbMaskPaste
              value={v.maskPaste}
              onChange={(maskPaste) => setV({ ...v, maskPaste })}
            />
          ),
        },
        {
          // `m_zoneHatchOffsetsPage` (`dialog_board_setup.cpp:132-138`), the
          // fifth child of Board Stackup. Its rows are the board's enabled
          // copper layers, so it reads the stackup's count rather than holding
          // a copper list of its own.
          id: 'zoneHatchOffsets',
          label: 'Zone Hatch Offsets',
          render: () => (
            <PanelPcbZoneHatchOffsets
              copperLayers={copperStackNames(v.physicalStackup.copperCount)}
              value={v.zoneLayerProperties}
              onChange={(zoneLayerProperties) => setV({ ...v, zoneLayerProperties })}
            />
          ),
        },
      ],
    },
    {
      label: 'Text & Graphics',
      pages: [
        {
          id: 'defaults',
          label: 'Defaults',
          // `PANEL_SETUP_DEFAULTS` is THREE panels in one scrolled window:
          // text & graphics, a 10 px spacer, dimensions, another spacer, then
          // zones (`panel_setup_defaults.cpp:39-48`). The first two are
          // `PanelPcbTextGraphics`; the third was a tree row of its own here,
          // which is a page KiCad's Board Setup does not have.
          render: () => (
            <div className="ze-pcb-defaults">
              <PanelPcbTextGraphics
                value={v.textGraphics}
                onChange={(textGraphics) => setV({ ...v, textGraphics })}
              />
              <PanelPcbZones value={v.zones} onChange={(zones) => setV({ ...v, zones })} />
            </div>
          ),
        },
        {
          id: 'formatting',
          label: 'Formatting',
          render: () => (
            <PanelPcbFormatting
              value={v.formatting}
              onChange={(formatting) => setV({ ...v, formatting })}
            />
          ),
        },
        {
          id: 'textVars',
          label: 'Text Variables',
          render: () => (
            <PanelTextVariables
              vars={v.textVars}
              onChange={(textVars) => setV({ ...v, textVars })}
            />
          ),
        },
      ],
    },
    {
      label: 'Design Rules',
      pages: [
        { id: 'constraints', label: 'Constraints', render: constraintsPanel },
        { id: 'sizes', label: 'Pre-defined Sizes', render: sizesPanel },
        {
          id: 'teardrops',
          label: 'Teardrops',
          render: () => (
            <PanelPcbTeardrops
              value={v.teardrops}
              onChange={(teardrops) => setV({ ...v, teardrops })}
            />
          ),
        },
        {
          id: 'tuningPatterns',
          label: 'Length-tuning Patterns',
          render: () => (
            <PanelPcbTuning value={v.tuning} onChange={(tuning) => setV({ ...v, tuning })} />
          ),
        },
        {
          id: 'tuningProfiles',
          label: 'Tuning Profiles',
          render: () => (
            <PanelPcbTuningProfiles
              value={v.tuningProfiles}
              onChange={(tuningProfiles) => setV({ ...v, tuningProfiles })}
            />
          ),
        },
        {
          id: 'netclasses',
          label: 'Net Classes',
          render: () => (
            <PanelSetupNetclasses
              value={v.netClasses}
              onChange={(netClasses) => setV({ ...v, netClasses })}
            />
          ),
        },
        {
          id: 'componentClasses',
          label: 'Component Classes',
          render: () => (
            <PanelPcbComponentClasses
              value={v.componentClasses}
              onChange={(componentClasses) => setV({ ...v, componentClasses })}
            />
          ),
        },
        {
          id: 'customRules',
          label: 'Custom Rules',
          render: () => (
            <PanelPcbCustomRules
              value={v.customRules}
              onChange={(customRules) => setV({ ...v, customRules })}
            />
          ),
        },
        {
          id: 'severities',
          label: 'Violation Severity',
          render: () => (
            <PanelPcbSeverities
              value={v.drcSeverities}
              onChange={(drcSeverities) => setV({ ...v, drcSeverities })}
            />
          ),
        },
      ],
    },
    {
      label: 'Board Data',
      pages: [
        {
          id: 'embedded',
          label: 'Embedded Files',
          render: () => (
            <PanelEmbeddedFiles
              value={v.embeddedFiles}
              onChange={(embeddedFiles) => setV({ ...v, embeddedFiles })}
            />
          ),
        },
      ],
    },
  ];

  return (
    <>
      <PagedDialog
        title="Board Setup"
        sections={sections}
        initialPage={initialPage}
        // [data] `PAGED_DIALOG( …, wxSize( 980, 600 ) )`, dialog_board_setup.cpp:63.
        initialSize={{ width: 980, height: 600 }}
        auxiliaryAction="Import Settings from Another Board..."
        onAuxiliaryAction={() => setImportOpen(true)}
        // `PANEL_SETUP_LAYERS::TransferDataFromWindow` runs `testLayerNames()`
        // first and returns false on a bad name, which keeps the dialog open
        // and leaves PAGED_DIALOG showing the message (`panel_setup_layers.cpp:975`).
        // Each page's `Validate()` / `TransferDataFromWindow` in TREE order,
        // which is the order `DIALOG_SHIM::TransferDataFromWindow` walks the
        // book: Board Editor Layers, then Constraints, then Pre-defined Sizes.
        // Which message the user sees first is that order.
        onOk={() => {
          const bad = testLayerNames(v.layers);
          if (bad)
            return {
              message: bad.message,
              page: 'layers',
              focusId: layerNameInputId(bad.layerId),
            };

          const outOfRange = validateConstraints(v.constraints);
          if (outOfRange) return outOfRange;

          const badSize = validateSizes(v);
          if (badSize)
            return {
              message: badSize.message,
              page: 'sizes',
              focusId: sizeCellId(badSize.grid, badSize.row, badSize.col),
            };
          // `TransferDataFromWindow` clamps m_MaxError on the way out
          // (`panel_setup_constraints.cpp:161-165`); it is the one value on
          // Constraints that is not stored as typed.
          onOk({
            ...v,
            constraints: {
              ...v.constraints,
              maxDeviationMM: clampMaxErrorMM(v.constraints.maxDeviationMM),
            },
            // `TransferDataFromWindow` drops the empty rows and sorts what is
            // left, every time — not only when the Sort button was pressed.
            trackWidthsMM: normalizeSizeRows(
              v.trackWidthsMM.map((width) => ({ width })),
              ['width'],
            ).map((r) => r.width),
            viaSizesMM: normalizeSizeRows(v.viaSizesMM, ['diameter', 'drill']),
            diffPairsMM: normalizeSizeRows(v.diffPairsMM, ['width', 'gap', 'viaGap']),
          });
        }}
        onCancel={onClose}
      />
      {importOpen && (
        <DialogImportSettings onImport={applyImport} onClose={() => setImportOpen(false)} />
      )}
    </>
  );
}
