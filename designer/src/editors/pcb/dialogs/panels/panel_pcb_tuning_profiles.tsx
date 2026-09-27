// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Tuning Profiles.
 *
 * `PANEL_SETUP_TUNING_PROFILES` (`panel_setup_tuning_profiles_base.cpp`): a
 * wxNotebook with one `PANEL_SETUP_TUNING_PROFILE_INFO` page per profile and
 * an add / remove button pair under it. Each page
 * (`panel_setup_tuning_profile_info_base.cpp`) is the Name / Type / Target
 * impedance row, the "Enable time domain tuning" box over a rule, and a
 * horizontal splitter: the Track Propagation grid (Signal Layer, Top
 * Reference, Bottom Reference, Track Width, Diff Pair Gap, Unit Delay) above
 * the Via Propagation pane (Global unit delay, the Via delay overrides grid).
 *
 * The layer columns are `wxGridCellChoiceEditor`s over the copper stack's
 * names (`UpdateLayerNames`); the three numeric track columns carry a
 * `GRID_CELL_RUN_FUNCTION_EDITOR` whose button runs
 * `calculateTrackParametersForCell` — `tuning_profile_calc.ts` here — against
 * the board's stackup. Diff Pair Gap is hidden while the type is Single.
 *
 * NO FONT SIZES AND NO COLOURS: the tab strip is `.ze-nb-tabs`, the grids are
 * `.ze-grid`, the buttons `.ze-gridbtn`; the widths stated are transcribed
 * from the base file and from `setColumnWidths`.
 */
import { type JSX, useLayoutEffect, useRef, useState } from 'react';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { GRID_CELL_RUN_FUNCTION_EDITOR } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxGridCellAttr,
  wxGridCellChoiceEditor,
  wxGridSelectionModes,
  wxGridStringTable,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import {
  DoubleValueFromStringIn,
  pcbIUScale,
  stringFromValue as stringFromValueIU,
} from '@ziroeda/common/eda_units.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD_STACKUP } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type {
  ProfileType,
  TuningProfile,
  TuningProfilesData,
  TuningProfileTrackEntry,
  TuningProfileViaOverride,
} from '../../board_settings.js';
import { CalculationType, calculateTrackParameters } from '../tuning_profile_calc.js';

// The aggregate model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export type { TuningProfile, TuningProfilesData } from '../../board_settings.js';

/** `m_typeChoices` (`_base.cpp:41`). */
const PROFILE_TYPES: readonly ProfileType[] = ['Single', 'Differential'];

/** `layerNamesWithNone[0]` (`panel_setup_tuning_profile_info.cpp:299`). */
const NONE_LAYER = '<None>';

/** The Track Propagation grid's columns, in TRACK_GRID_* order. */
const TRACK_COLUMNS = [
  'Signal Layer',
  'Top Reference',
  'Bottom Reference',
  'Track Width',
  'Diff Pair Gap',
  'Unit Delay',
] as const;

/** The Via delay overrides grid's columns, in VIA_GRID_* order. */
const VIA_COLUMNS = [
  'Signal Layer From',
  'Signal Layer To',
  'Via Layer From',
  'Via Layer To',
  'Delay',
] as const;

/** One copper layer as the page names it: its canonical id and the board's name. */
export interface TuningLayer {
  id: string;
  name: string;
}

interface Props {
  value: TuningProfilesData;
  onChange: (next: TuningProfilesData) => void;
  /** The frame's display units; the page's `UNITS_PROVIDER`. */
  units: StatusUnits;
  /**
   * `SyncCopperLayers`: the copper stack, F.Cu first, with the board's layer
   * names — what the choice editors list.
   */
  layers: readonly TuningLayer[];
  /** `m_board->GetStackupOrDefault()`, what the calculators read; null disables them. */
  stackup: BOARD_STACKUP | null;
  /** `DisplayErrorMessage( m_dlg, … )`. */
  onError: (message: string) => void;
}

/** `GetProfile()` on a page just added: `"Profile "`, Single, 0 ohms, time-domain on. */
function newProfile(): TuningProfile {
  return {
    name: 'Profile ',
    type: 'Single',
    targetImpedance: 0,
    enableTimeDomain: true,
    viaPropDelay: 0,
    trackEntries: [],
    viaOverrides: [],
  };
}

export function PanelPcbTuningProfiles({
  value,
  onChange,
  units,
  layers,
  stackup,
  onError,
}: Props): JSX.Element {
  const [sel, setSel] = useState(0);
  const profiles = value.profiles;
  const page = Math.min(sel, Math.max(0, profiles.length - 1));
  const cur = profiles[page];
  const provider = useRef(new UNITS_PROVIDER(pcbIUScale, units));
  provider.current = new UNITS_PROVIDER(pcbIUScale, units);

  const setProfiles = (next: TuningProfile[]): void => onChange({ profiles: next });
  const setCur = (patch: Partial<TuningProfile>): void => {
    if (!cur) return;
    setProfiles(profiles.map((p, j) => (j === page ? { ...p, ...patch } : p)));
  };

  // ----- OnAddTuningProfileClick / OnRemoveTuningProfileClick
  const addProfile = (): void => {
    setProfiles([...profiles, newProfile()]);
    setSel(profiles.length);
  };
  const removeProfile = (): void => {
    if (!cur) return;
    setProfiles(profiles.filter((_, j) => j !== page));
    setSel(Math.max(0, page - 1));
  };

  return (
    <div className="ze-tuneprof">
      {/* `m_tuningProfiles`, the wxNotebook: a tab per page, named by `UpdateProfileName`. */}
      {profiles.length > 0 && (
        <div className="ze-nb-tabs">
          {profiles.map((p, i) => (
            <button
              key={i}
              type="button"
              className={i === page ? 'active' : undefined}
              onClick={() => setSel(i)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="ze-tuneprof-page">
        {cur ? (
          <ProfileInfoPage
            key={page}
            profile={cur}
            onChange={setCur}
            provider={provider.current}
            layers={layers}
            stackup={stackup}
            onError={onError}
          />
        ) : (
          <div className="ze-tuneprof-empty" />
        )}
      </div>

      {/* `bSizer91`: add, a 20 px growable spacer, remove. */}
      <div className="ze-grid-btns ze-tuneprof-btns">
        <StdBitmapButton
          bitmap="small_plus"
          title="Add tuning profile"
          tooltip={null}
          onClick={addProfile}
        />
        <span className="ze-tuneprof-btngap" />
        <StdBitmapButton
          bitmap="small_trash"
          title="Remove tuning profile"
          tooltip={null}
          disabled={!cur}
          onClick={removeProfile}
        />
      </div>
    </div>
  );
}

/** TRACK_GRID_* and VIA_GRID_* (`panel_setup_tuning_profile_info.h`). */
const TRACK_GRID_SIGNAL_LAYER = 0;
const TRACK_GRID_TOP_REFERENCE = 1;
const TRACK_GRID_BOTTOM_REFERENCE = 2;
const TRACK_GRID_TRACK_WIDTH = 3;
const TRACK_GRID_TRACK_GAP = 4;
const TRACK_GRID_DELAY = 5;
const VIA_GRID_SIGNAL_LAYER_FROM = 0;
const VIA_GRID_SIGNAL_LAYER_TO = 1;
const VIA_GRID_VIA_LAYER_FROM = 2;
const VIA_GRID_VIA_LAYER_TO = 3;
const VIA_GRID_DELAY = 4;

function makeGrid(aLabels: readonly string[]): { grid: WX_GRID; tricks: GRID_TRICKS } {
  const grid = new WX_GRID();
  grid.SetTable(
    new wxGridStringTable(0, aLabels.length),
    true,
    wxGridSelectionModes.wxGridSelectRows,
  );
  aLabels.forEach((label, c) => {
    grid.SetColLabelValue(c, label);
  });
  return { grid, tricks: new GRID_TRICKS(grid) };
}

const choiceAttr = (aChoices: readonly string[]): wxGridCellAttr => {
  const attr = new wxGridCellAttr();
  attr.SetEditor(new wxGridCellChoiceEditor(aChoices, false));
  return attr;
};

/** `PANEL_SETUP_TUNING_PROFILE_INFO`, one notebook page. */
function ProfileInfoPage({
  profile,
  onChange,
  provider,
  layers,
  stackup,
  onError,
}: {
  profile: TuningProfile;
  onChange: (patch: Partial<TuningProfile>) => void;
  provider: UNITS_PROVIDER;
  layers: readonly TuningLayer[];
  stackup: BOARD_STACKUP | null;
  onError: (message: string) => void;
}): JSX.Element {
  const differential = profile.type === 'Differential';
  const ctx = useRef({ profile, onChange, provider, layers, stackup, onError });
  ctx.current = { profile, onChange, provider, layers, stackup, onError };

  /** `m_layerNames` and `m_layerNamesToIDs`. */
  const layerNames = layers.map((l) => l.name);
  const nameOf = (id: string): string => layers.find((l) => l.id === id)?.name ?? '';
  const idOf = (name: string): string => ctx.current.layers.find((l) => l.name === name)?.id ?? '';

  const [track] = useState(() => {
    const t = makeGrid(TRACK_COLUMNS);
    // `SetAutoEvalColUnits` + `SetAutoEvalCols` (`:89-99`).
    t.grid.SetUnitsProvider(provider);
    t.grid.SetAutoEvalColUnits(
      TRACK_GRID_DELAY,
      provider.GetUnitsFromType('length_delay'),
      'length_delay',
    );
    t.grid.SetAutoEvalColUnits(TRACK_GRID_TRACK_WIDTH, provider.GetUnitsFromType('distance'));
    t.grid.SetAutoEvalColUnits(TRACK_GRID_TRACK_GAP, provider.GetUnitsFromType('distance'));
    t.grid.SetAutoEvalCols([TRACK_GRID_DELAY, TRACK_GRID_TRACK_WIDTH, TRACK_GRID_TRACK_GAP]);

    // The calculation editors (`:101-130`).
    for (const col of [TRACK_GRID_TRACK_WIDTH, TRACK_GRID_TRACK_GAP, TRACK_GRID_DELAY]) {
      const attr = new wxGridCellAttr();
      attr.SetEditor(
        new GRID_CELL_RUN_FUNCTION_EDITOR((row, c) => calculateTrackParametersForCell(row, c)),
      );
      t.grid.SetColAttr(col, attr);
    }

    return t;
  });
  const [via] = useState(() => {
    const v = makeGrid(VIA_COLUMNS);
    v.grid.SetUnitsProvider(provider);
    v.grid.SetAutoEvalColUnits(VIA_GRID_DELAY, provider.GetUnitsFromType('time'), 'time');
    v.grid.SetAutoEvalCols([VIA_GRID_DELAY]);
    return v;
  });

  // `UpdateLayerNames`: the choice editors over the copper stack's names.
  const layerKey = JSON.stringify(layerNames);
  // biome-ignore lint/correctness/useExhaustiveDependencies: layerKey is layerNames' content; the grids are stable
  useLayoutEffect(() => {
    const withNone = [NONE_LAYER, ...layerNames];
    track.grid.SetColAttr(TRACK_GRID_SIGNAL_LAYER, choiceAttr(layerNames));
    track.grid.SetColAttr(TRACK_GRID_TOP_REFERENCE, choiceAttr(withNone));
    track.grid.SetColAttr(TRACK_GRID_BOTTOM_REFERENCE, choiceAttr(withNone));

    for (const col of [
      VIA_GRID_SIGNAL_LAYER_FROM,
      VIA_GRID_SIGNAL_LAYER_TO,
      VIA_GRID_VIA_LAYER_FROM,
      VIA_GRID_VIA_LAYER_TO,
    ])
      via.grid.SetColAttr(col, choiceAttr(layerNames));
  }, [layerKey]);

  // `onChangeProfileType`: Diff Pair Gap shows only for a differential profile.
  useLayoutEffect(() => {
    track.grid.CommitPendingChanges();
    via.grid.CommitPendingChanges();

    if (differential) track.grid.ShowCol(TRACK_GRID_TRACK_GAP);
    else track.grid.HideCol(TRACK_GRID_TRACK_GAP);
  }, [track, via, differential]);

  // `LoadProfile` (`:158-206`), whenever the rows change from outside the grids.
  const written = useRef<{ track: string; via: string }>({ track: '', via: '' });
  const trackKey = JSON.stringify(profile.trackEntries);
  const viaKey = JSON.stringify(profile.viaOverrides);

  // biome-ignore lint/correctness/useExhaustiveDependencies: trackKey is the rows' content; the grid is stable
  useLayoutEffect(() => {
    if (trackKey === written.current.track) return;

    const g = track.grid;
    g.BeginBatch();
    g.ClearRows();

    for (const e of profile.trackEntries) {
      const row = g.GetNumberRows();
      g.AppendRows(1);
      g.SetCellValue(row, TRACK_GRID_SIGNAL_LAYER, nameOf(e.signalLayer));
      g.SetCellValue(row, TRACK_GRID_TOP_REFERENCE, nameOf(e.topReference) || NONE_LAYER);
      g.SetCellValue(row, TRACK_GRID_BOTTOM_REFERENCE, nameOf(e.bottomReference) || NONE_LAYER);
      g.SetUnitValue(row, TRACK_GRID_TRACK_WIDTH, pcbIUScale.mmToIU(e.widthMM));
      g.SetUnitValue(row, TRACK_GRID_TRACK_GAP, pcbIUScale.mmToIU(e.diffPairGapMM));
      g.SetUnitValue(row, TRACK_GRID_DELAY, e.delay);
    }

    g.EndBatch();
    written.current.track = trackKey;
  }, [trackKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: viaKey is the rows' content; the grid is stable
  useLayoutEffect(() => {
    if (viaKey === written.current.via) return;

    const g = via.grid;
    g.BeginBatch();
    g.ClearRows();

    for (const o of profile.viaOverrides) {
      const row = g.GetNumberRows();
      g.AppendRows(1);
      g.SetCellValue(row, VIA_GRID_SIGNAL_LAYER_FROM, nameOf(o.signalLayerFrom));
      g.SetCellValue(row, VIA_GRID_SIGNAL_LAYER_TO, nameOf(o.signalLayerTo));
      g.SetCellValue(row, VIA_GRID_VIA_LAYER_FROM, nameOf(o.viaLayerFrom));
      g.SetCellValue(row, VIA_GRID_VIA_LAYER_TO, nameOf(o.viaLayerTo));
      g.SetUnitValue(row, VIA_GRID_DELAY, o.delay);
    }

    g.EndBatch();
    written.current.via = viaKey;
  }, [viaKey]);

  /** `GetProfile()`'s two grid loops (`:225-285`), after every change a grid draws. */
  const readTrack = (): TuningProfileTrackEntry[] => {
    const g = track.grid;
    return Array.from({ length: g.GetNumberRows() }, (_, row) => ({
      signalLayer: idOf(g.GetCellValue(row, TRACK_GRID_SIGNAL_LAYER)),
      topReference: idOf(g.GetCellValue(row, TRACK_GRID_TOP_REFERENCE)),
      bottomReference: idOf(g.GetCellValue(row, TRACK_GRID_BOTTOM_REFERENCE)),
      widthMM: pcbIUScale.iuToMM(g.GetUnitValue(row, TRACK_GRID_TRACK_WIDTH)),
      diffPairGapMM: pcbIUScale.iuToMM(g.GetUnitValue(row, TRACK_GRID_TRACK_GAP)),
      delay: g.GetUnitValue(row, TRACK_GRID_DELAY),
    }));
  };
  const transferTrack = (): void => {
    const rows = readTrack();
    const key = JSON.stringify(rows);

    if (key === written.current.track) return;

    written.current.track = key;
    ctx.current.onChange({ trackEntries: rows });
  };
  const transferVia = (): void => {
    const g = via.grid;
    const rows: TuningProfileViaOverride[] = Array.from(
      { length: g.GetNumberRows() },
      (_, row) => ({
        signalLayerFrom: idOf(g.GetCellValue(row, VIA_GRID_SIGNAL_LAYER_FROM)),
        signalLayerTo: idOf(g.GetCellValue(row, VIA_GRID_SIGNAL_LAYER_TO)),
        viaLayerFrom: idOf(g.GetCellValue(row, VIA_GRID_VIA_LAYER_FROM)),
        viaLayerTo: idOf(g.GetCellValue(row, VIA_GRID_VIA_LAYER_TO)),
        delay: g.GetUnitValue(row, VIA_GRID_DELAY),
      }),
    );
    const key = JSON.stringify(rows);

    if (key === written.current.via) return;

    written.current.via = key;
    ctx.current.onChange({ viaOverrides: rows });
  };

  /** `calculateTrackParametersForCell` (`:702-800`), from a cell's run-function button. */
  function calculateTrackParametersForCell(aRow: number, aCol: number): void {
    const { stackup: brdStackup, profile: cur, onError: reportError } = ctx.current;
    const g = track.grid;
    g.CommitPendingChanges(true);
    const e = readTrack()[aRow];

    if (!e || !brdStackup) return;

    const layerId = (id: string): PCB_LAYER_ID | undefined => {
      if (id === '') return undefined;
      const l = LSET.NameToLayer(id);
      return l < 0 ? undefined : (l as PCB_LAYER_ID);
    };
    const isDiff = cur.type === 'Differential';
    const type =
      aCol === TRACK_GRID_TRACK_GAP
        ? CalculationType.GAP
        : aCol === TRACK_GRID_DELAY
          ? CalculationType.DELAY
          : CalculationType.WIDTH;
    const result = calculateTrackParameters(
      brdStackup,
      {
        signalLayer: layerId(e.signalLayer),
        topReference: layerId(e.topReference),
        bottomReference: layerId(e.bottomReference),
        width: e.widthMM > 0 ? pcbIUScale.mmToIU(e.widthMM) : undefined,
        gap: e.diffPairGapMM > 0 ? pcbIUScale.mmToIU(e.diffPairGapMM) : undefined,
      },
      isDiff,
      cur.targetImpedance,
      type,
    );

    if (!result.OK) {
      reportError(result.ErrorMsg);
      return;
    }

    if (type === CalculationType.WIDTH) g.SetUnitValue(aRow, TRACK_GRID_TRACK_WIDTH, result.Width);
    else if (type === CalculationType.GAP && isDiff)
      g.SetUnitValue(aRow, TRACK_GRID_TRACK_GAP, result.DiffPairGap);

    g.SetUnitValue(aRow, TRACK_GRID_DELAY, result.Delay);
  }

  /** `OnAddTrackRow` (`:517-568`): the next signal layer down, its neighbours as references. */
  const onAddTrackRow = (): void => {
    const g = track.grid;
    const numRows = g.GetNumberRows();
    g.InsertRows(numRows);

    const setFrontRowLayers = (row: number): void => {
      if (layerNames.length === 0) return;
      g.SetCellValue(row, TRACK_GRID_SIGNAL_LAYER, layerNames[0]!);
      if (layerNames.length < 2) return;
      g.SetCellValue(row, TRACK_GRID_BOTTOM_REFERENCE, layerNames[1]!);
    };

    if (numRows === 0) {
      setFrontRowLayers(0);
    } else {
      const idx = layerNames.indexOf(g.GetCellValue(numRows - 1, TRACK_GRID_SIGNAL_LAYER));

      if (idx === layerNames.length - 1) {
        setFrontRowLayers(numRows);
      } else if (idx !== -1) {
        g.SetCellValue(numRows, TRACK_GRID_SIGNAL_LAYER, layerNames[idx + 1]!);
        g.SetCellValue(numRows, TRACK_GRID_TOP_REFERENCE, layerNames[idx]!);

        if (idx + 2 < layerNames.length)
          g.SetCellValue(numRows, TRACK_GRID_BOTTOM_REFERENCE, layerNames[idx + 2]!);
      }
    }

    g.SetUnitValue(numRows, TRACK_GRID_TRACK_WIDTH, 0);
    g.SetUnitValue(numRows, TRACK_GRID_TRACK_GAP, 0);
    g.SetUnitValue(numRows, TRACK_GRID_DELAY, 0);
  };

  /** `OnAddViaOverride` (`:581-593`): first layer to last, both pairs. */
  const onAddViaOverride = (): void => {
    const g = via.grid;
    const numRows = g.GetNumberRows();
    g.InsertRows(numRows);
    g.SetUnitValue(numRows, VIA_GRID_DELAY, 0);
    g.SetCellValue(numRows, VIA_GRID_SIGNAL_LAYER_FROM, layerNames[0] ?? '');
    g.SetCellValue(numRows, VIA_GRID_SIGNAL_LAYER_TO, layerNames[layerNames.length - 1] ?? '');
    g.SetCellValue(numRows, VIA_GRID_VIA_LAYER_FROM, layerNames[0] ?? '');
    g.SetCellValue(numRows, VIA_GRID_VIA_LAYER_TO, layerNames[layerNames.length - 1] ?? '');
  };

  /** `OnRemoveTrackRow` / `OnRemoveViaOverride`: exactly one selected row goes. */
  const removeSelected = (g: WX_GRID): void => {
    const selRows = g.GetSelectedRows();

    if (selRows.length === 1) g.DeleteRows(selRows[0]!, 1);
  };

  return (
    <div className="ze-tuneprof-info">
      {/* fgSizer2: Name, spacer, Type, spacer, Target impedance + ohms. */}
      <div className="ze-tuneprof-head">
        <span className="lbl">Name:</span>
        <input
          className="ze-search ze-tuneprof-name"
          aria-label="Name"
          value={profile.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <span className="ze-tuneprof-spacer" />
        <span className="lbl">Type:</span>
        <Combo
          value={profile.type}
          ariaLabel="Type"
          options={PROFILE_TYPES.map((t) => ({ value: t, label: t }))}
          onChange={(t) => onChange({ type: t as ProfileType })}
        />
        <span className="ze-tuneprof-spacer" />
        <span className="lbl">Target impedance:</span>
        <input
          className="ze-search ze-tuneprof-impedance"
          aria-label="Target impedance"
          maxLength={15}
          value={String(profile.targetImpedance)}
          onChange={(e) => {
            const z = Number.parseFloat(e.target.value);
            onChange({ targetImpedance: Number.isFinite(z) ? z : 0 });
          }}
        />
        <span className="unit">ohms</span>
      </div>

      {/* gbSizer1: the checkbox over a wxStaticLine. */}
      <label className="ze-check ze-tuneprof-enable">
        <input
          type="checkbox"
          checked={profile.enableTimeDomain}
          onChange={(e) => onChange({ enableTimeDomain: e.target.checked })}
        />
        Enable time domain tuning
      </label>
      <hr className="ze-tuneprof-rule" />

      {/* m_splitter1, SplitHorizontally at 200. */}
      <div className="ze-tuneprof-split">
        <div className="ze-tuneprof-track">
          <span className="ze-tuneprof-title">Track Propagation</span>
          <div className="ze-grid-pane ze-tuneprof-grid">
            <WxGridView
              grid={track.grid}
              tricks={track.tricks}
              onUpdate={transferTrack}
              ariaLabel="Track propagation"
            />
          </div>
          {/* bSizer9: add, 20 px, remove. */}
          <div className="ze-grid-btns">
            <StdBitmapButton
              bitmap="small_plus"
              title="Add track propagation row"
              tooltip={null}
              onClick={onAddTrackRow}
            />
            <span className="ze-tuneprof-btngap" />
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove track propagation row"
              tooltip={null}
              onClick={() => removeSelected(track.grid)}
            />
          </div>
        </div>

        <div className="ze-tuneprof-via">
          {/* bSizer8: label, spacer, "Global unit delay:", field, units, spacer(50). */}
          <div className="ze-tuneprof-viahead">
            <span className="ze-tuneprof-title">Via Propagation</span>
            <span className="ze-tuneprof-spacer" />
            <span className="lbl">Global unit delay:</span>
            <GlobalDelayField
              value={profile.viaPropDelay}
              provider={provider}
              onCommit={(iu) => onChange({ viaPropDelay: iu })}
            />
            <span className="ze-tuneprof-spacer ze-tuneprof-spacer50" />
          </div>
          <span className="ze-tuneprof-sublabel">Via delay overrides:</span>
          <div className="ze-grid-pane ze-tuneprof-grid">
            <WxGridView
              grid={via.grid}
              tricks={via.tricks}
              onUpdate={transferVia}
              ariaLabel="Via delay overrides"
            />
          </div>
          <div className="ze-grid-btns">
            <StdBitmapButton
              bitmap="small_plus"
              title="Add via delay override"
              tooltip={null}
              onClick={onAddViaOverride}
            />
            <span className="ze-tuneprof-btngap" />
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove via delay override"
              tooltip={null}
              onClick={() => removeSelected(via.grid)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `m_viaPropagationUnits`, a `UNIT_BINDER` of `EDA_DATA_TYPE::LENGTH_DELAY`:
 * the field holds the number, its `wxStaticText` the unit — ps/cm or ps/inch
 * by the frame's units (`initPanel`).
 */
function GlobalDelayField({
  value,
  provider,
  onCommit,
}: {
  value: number;
  provider: UNITS_PROVIDER;
  onCommit: (iu: number) => void;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const units = provider.GetUnitsFromType('length_delay');
  const commit = (): void => {
    if (text === null) return;
    onCommit(KiROUND(DoubleValueFromStringIn(pcbIUScale, units, text, 'length_delay')));
    setText(null);
  };
  return (
    <>
      <input
        className="ze-search ze-tuneprof-viadelay"
        aria-label="Global unit delay"
        value={text ?? stringFromValueIU(pcbIUScale, units, value, false, 'length_delay')}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <span className="unit">{units === 'ps/in' ? 'ps/inch' : units}</span>
    </>
  );
}

/**
 * `PANEL_SETUP_TUNING_PROFILES::Validate` — `ValidateProfile( i )` on every
 * page: a name, and no signal layer twice. Returns the message and the page
 * it belongs to, or null.
 */
export function validateTuningProfiles(
  aData: TuningProfilesData,
): { message: string; page: number } | null {
  for (const [i, p] of aData.profiles.entries()) {
    if (p.name === '') return { message: 'Tuning profile must have a name', page: i };

    const layerNames = new Set<string>();

    for (const e of p.trackEntries) {
      if (layerNames.has(e.signalLayer))
        return { message: 'Duplicated signal layer configuration in tuning profile', page: i };

      layerNames.add(e.signalLayer);
    }
  }

  return null;
}

/** `GetDelayProfileNames`: every page's name that is not blank, for the netclass panel. */
export function delayProfileNames(aData: TuningProfilesData): string[] {
  return aData.profiles.map((p) => p.name).filter((n) => n !== '');
}
