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
import { type JSX, useRef, useState } from 'react';
import {
  DoubleValueFromStringIn,
  type EdaDataType,
  pcbIUScale,
  stringFromValue as stringFromValueIU,
} from '@ziroeda/common/src/eda_units.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD_STACKUP } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import { Combo } from '../../../../ui/Combo.js';
import { bitmapUrl } from '../../../../ui/toolbarIcons.js';
import { StdBitmapButton } from '../../../../ui/StdBitmapButton.js';
import type { StatusUnits } from '../../../../ui/status_format.js';
import type {
  ProfileType,
  TuningProfile,
  TuningProfilesData,
  TuningProfileTrackEntry,
  TuningProfileViaOverride,
} from '../../board_settings.js';
import { pcbUnitTextMM, pcbUnitValueMM } from '../../pcb_unit_binder.js';
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

/**
 * A unitised cell for a type the frame's units decide through
 * `GetUnitsFromType` — a `LENGTH_DELAY` reads "ps/cm" or "ps/in", a `TIME`
 * "ps". The model is IU, as `SetUnitValue` / `GetUnitValue` are.
 */
function TypedUnitCell({
  value,
  provider,
  type,
  ariaLabel,
  onCommit,
}: {
  value: number;
  provider: UNITS_PROVIDER;
  type: EdaDataType;
  ariaLabel: string;
  onCommit: (iu: number) => void;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const units = provider.GetUnitsFromType(type);
  const shown = stringFromValueIU(pcbIUScale, units, value, true, type);

  const commit = (): void => {
    if (text === null) return;
    onCommit(KiROUND(DoubleValueFromStringIn(pcbIUScale, units, text, type)));
    setText(null);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      size={1}
      className="ze-grid-input ze-bare"
      aria-label={ariaLabel}
      value={text ?? shown}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

/** A distance cell whose model is millimetres (`GetUnitValue` over a DISTANCE column). */
function DistanceCell({
  mm,
  units,
  ariaLabel,
  onCommit,
}: {
  mm: number;
  units: StatusUnits;
  ariaLabel: string;
  onCommit: (mm: number) => void;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const commit = (): void => {
    if (text === null) return;
    onCommit(pcbUnitValueMM(text, units));
    setText(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      size={1}
      className="ze-grid-input ze-bare"
      aria-label={ariaLabel}
      value={text ?? pcbUnitTextMM(mm, units, true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

/**
 * `GRID_CELL_RUN_FUNCTION_EDITOR`'s button: `TEXT_BUTTON_RUN_FUNCTION` carries
 * `BITMAPS::small_refresh` (`grid_text_button_helpers.cpp:522`).
 */
function RunFunctionButton({ title, onRun }: { title: string; onRun: () => void }): JSX.Element {
  const url = bitmapUrl('small_refresh');
  return (
    <button
      type="button"
      className="ze-grid-cellbtn"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onRun}
    >
      {url ? <img src={url} alt="" draggable={false} /> : null}
    </button>
  );
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
            units={units}
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

/** `PANEL_SETUP_TUNING_PROFILE_INFO`, one notebook page. */
function ProfileInfoPage({
  profile,
  onChange,
  units,
  provider,
  layers,
  stackup,
  onError,
}: {
  profile: TuningProfile;
  onChange: (patch: Partial<TuningProfile>) => void;
  units: StatusUnits;
  provider: UNITS_PROVIDER;
  layers: readonly TuningLayer[];
  stackup: BOARD_STACKUP | null;
  onError: (message: string) => void;
}): JSX.Element {
  // `SetSelectionMode( wxGridSelectRows )` on each grid: one selected row.
  const [trackSel, setTrackSel] = useState<number | null>(null);
  const [viaSel, setViaSel] = useState<number | null>(null);
  const differential = profile.type === 'Differential';
  const layerOptions = layers.map((l) => ({ value: l.id, label: l.name }));
  const layerOptionsWithNone = [{ value: '', label: NONE_LAYER }, ...layerOptions];
  const first = layers[0]?.id ?? '';
  const last = layers[layers.length - 1]?.id ?? '';

  const setTrack = (i: number, patch: Partial<TuningProfileTrackEntry>): void =>
    onChange({
      trackEntries: profile.trackEntries.map((e, j) => (j === i ? { ...e, ...patch } : e)),
    });
  const setVia = (i: number, patch: Partial<TuningProfileViaOverride>): void =>
    onChange({
      viaOverrides: profile.viaOverrides.map((e, j) => (j === i ? { ...e, ...patch } : e)),
    });

  // ----- OnAddTrackRow: the next signal layer down, its neighbours as references
  const addTrackRow = (): void => {
    const rows = profile.trackEntries;
    const entry: TuningProfileTrackEntry = {
      signalLayer: '',
      topReference: '',
      bottomReference: '',
      widthMM: 0,
      diffPairGapMM: 0,
      delay: 0,
    };
    const setFrontRowLayers = (): void => {
      if (layers.length === 0) return;
      entry.signalLayer = layers[0]!.id;
      if (layers.length < 2) return;
      entry.bottomReference = layers[1]!.id;
    };
    if (rows.length === 0) {
      setFrontRowLayers();
    } else {
      const lastSignal = rows[rows.length - 1]!.signalLayer;
      const idx = layers.findIndex((l) => l.id === lastSignal);
      if (idx === -1) {
        // `nameItr == end()`: the row is added with no layers set.
      } else if (idx === layers.length - 1) {
        setFrontRowLayers();
      } else {
        entry.signalLayer = layers[idx + 1]!.id;
        entry.topReference = layers[idx]!.id;
        if (idx + 2 < layers.length) entry.bottomReference = layers[idx + 2]!.id;
      }
    }
    onChange({ trackEntries: [...rows, entry] });
  };
  const removeTrackRow = (): void => {
    if (trackSel === null || trackSel >= profile.trackEntries.length) return;
    onChange({ trackEntries: profile.trackEntries.filter((_, j) => j !== trackSel) });
    setTrackSel(null);
  };

  // ----- OnAddViaOverride: first layer to last, both pairs
  const addViaOverride = (): void => {
    onChange({
      viaOverrides: [
        ...profile.viaOverrides,
        {
          signalLayerFrom: first,
          signalLayerTo: last,
          viaLayerFrom: first,
          viaLayerTo: last,
          delay: 0,
        },
      ],
    });
  };
  const removeViaOverride = (): void => {
    if (viaSel === null || viaSel >= profile.viaOverrides.length) return;
    onChange({ viaOverrides: profile.viaOverrides.filter((_, j) => j !== viaSel) });
    setViaSel(null);
  };

  // ----- calculateTrackParametersForCell
  const layerId = (id: string): PCB_LAYER_ID | undefined => {
    if (id === '') return undefined;
    const l = LSET.NameToLayer(id);
    return l < 0 ? undefined : (l as PCB_LAYER_ID);
  };
  const calculate = (row: number, type: CalculationType): void => {
    const e = profile.trackEntries[row];
    if (!e || !stackup) return;
    const result = calculateTrackParameters(
      stackup,
      {
        signalLayer: layerId(e.signalLayer),
        topReference: layerId(e.topReference),
        bottomReference: layerId(e.bottomReference),
        width: e.widthMM > 0 ? pcbIUScale.mmToIU(e.widthMM) : undefined,
        gap: e.diffPairGapMM > 0 ? pcbIUScale.mmToIU(e.diffPairGapMM) : undefined,
      },
      differential,
      profile.targetImpedance,
      type,
    );
    if (!result.OK) {
      onError(result.ErrorMsg);
      return;
    }
    const patch: Partial<TuningProfileTrackEntry> = { delay: result.Delay };
    if (type === CalculationType.WIDTH) patch.widthMM = pcbIUScale.iuToMM(result.Width);
    else if (type === CalculationType.GAP && differential)
      patch.diffPairGapMM = pcbIUScale.iuToMM(result.DiffPairGap);
    setTrack(row, patch);
  };

  const layerCell = (
    id: string,
    options: { value: string; label: string }[],
    label: string,
    onPick: (id: string) => void,
  ): JSX.Element => (
    <td>
      <Combo value={id} ariaLabel={label} options={options} onChange={onPick} />
    </td>
  );

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
            <table className="ze-grid">
              <thead>
                <tr>
                  {TRACK_COLUMNS.map((c, i) =>
                    i === 4 && !differential ? null : <th key={c}>{c}</th>,
                  )}
                </tr>
              </thead>
              <tbody>
                {profile.trackEntries.map((e, i) => (
                  <tr
                    key={i}
                    className={trackSel === i ? 'selected' : undefined}
                    onMouseDown={() => setTrackSel(i)}
                  >
                    {layerCell(e.signalLayer, layerOptions, `Signal layer ${i + 1}`, (id) =>
                      setTrack(i, { signalLayer: id }),
                    )}
                    {layerCell(
                      e.topReference,
                      layerOptionsWithNone,
                      `Top reference ${i + 1}`,
                      (id) => setTrack(i, { topReference: id }),
                    )}
                    {layerCell(
                      e.bottomReference,
                      layerOptionsWithNone,
                      `Bottom reference ${i + 1}`,
                      (id) => setTrack(i, { bottomReference: id }),
                    )}
                    <td>
                      <span className="ze-tuneprof-calc">
                        <DistanceCell
                          mm={e.widthMM}
                          units={units}
                          ariaLabel={`Track width ${i + 1}`}
                          onCommit={(mm) => setTrack(i, { widthMM: mm })}
                        />
                        <RunFunctionButton
                          title="Calculate width"
                          onRun={() => calculate(i, CalculationType.WIDTH)}
                        />
                      </span>
                    </td>
                    {differential && (
                      <td>
                        <span className="ze-tuneprof-calc">
                          <DistanceCell
                            mm={e.diffPairGapMM}
                            units={units}
                            ariaLabel={`Diff pair gap ${i + 1}`}
                            onCommit={(mm) => setTrack(i, { diffPairGapMM: mm })}
                          />
                          <RunFunctionButton
                            title="Calculate gap"
                            onRun={() => calculate(i, CalculationType.GAP)}
                          />
                        </span>
                      </td>
                    )}
                    <td>
                      <span className="ze-tuneprof-calc">
                        <TypedUnitCell
                          value={e.delay}
                          provider={provider}
                          type="length_delay"
                          ariaLabel={`Unit delay ${i + 1}`}
                          onCommit={(iu) => setTrack(i, { delay: iu })}
                        />
                        <RunFunctionButton
                          title="Calculate delay"
                          onRun={() => calculate(i, CalculationType.DELAY)}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* bSizer9: add, 20 px, remove. */}
          <div className="ze-grid-btns">
            <StdBitmapButton
              bitmap="small_plus"
              title="Add track propagation row"
              tooltip={null}
              onClick={addTrackRow}
            />
            <span className="ze-tuneprof-btngap" />
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove track propagation row"
              tooltip={null}
              disabled={trackSel === null}
              onClick={removeTrackRow}
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
            <table className="ze-grid">
              <thead>
                <tr>
                  {VIA_COLUMNS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profile.viaOverrides.map((o, i) => (
                  <tr
                    key={i}
                    className={viaSel === i ? 'selected' : undefined}
                    onMouseDown={() => setViaSel(i)}
                  >
                    {layerCell(
                      o.signalLayerFrom,
                      layerOptions,
                      `Signal layer from ${i + 1}`,
                      (id) => setVia(i, { signalLayerFrom: id }),
                    )}
                    {layerCell(o.signalLayerTo, layerOptions, `Signal layer to ${i + 1}`, (id) =>
                      setVia(i, { signalLayerTo: id }),
                    )}
                    {layerCell(o.viaLayerFrom, layerOptions, `Via layer from ${i + 1}`, (id) =>
                      setVia(i, { viaLayerFrom: id }),
                    )}
                    {layerCell(o.viaLayerTo, layerOptions, `Via layer to ${i + 1}`, (id) =>
                      setVia(i, { viaLayerTo: id }),
                    )}
                    <td>
                      <TypedUnitCell
                        value={o.delay}
                        provider={provider}
                        type="time"
                        ariaLabel={`Via delay ${i + 1}`}
                        onCommit={(iu) => setVia(i, { delay: iu })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ze-grid-btns">
            <StdBitmapButton
              bitmap="small_plus"
              title="Add via delay override"
              tooltip={null}
              onClick={addViaOverride}
            />
            <span className="ze-tuneprof-btngap" />
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove via delay override"
              tooltip={null}
              disabled={viaSel === null}
              onClick={removeViaOverride}
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
