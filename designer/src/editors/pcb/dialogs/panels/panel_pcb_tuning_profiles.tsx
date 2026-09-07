// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Tuning Profiles. Counterpart:
 * `pcbnew/dialogs/panel_setup_tuning_profiles_base.cpp` (PANEL_SETUP_TUNING_PROFILES),
 * a notebook of tuning profiles (add/remove at the bottom), each tab a
 * PANEL_SETUP_TUNING_PROFILE_INFO form: Name, Type (single/differential), target
 * impedance, frequency, and, when time-domain tuning is enabled, the track/via
 * propagation delay settings. The deep via-delay-override matrix is not modelled
 * here yet.
 *
 * NO FONT SIZES AND NO COLOURS. The tab strip is `.ze-nb-tabs`, the shared
 * wxNotebook strip — its metrics were measured off a real Yaru notebook (see
 * the rule) — not the bordered 12.5px boxes this drew, which are a widget GTK
 * does not have. The form rows are `.ze-pref-row` in a `.ze-pref-group-body`,
 * so their label column is the sizer's, and the units are the dialog's own ink
 * rather than a dimmed grey.
 */

import { useState, type JSX } from 'react';
import { Combo } from '../../../../ui/Combo.js';
import { Icon } from '../../../../ui/icons.js';
import type {
  FreqUnit,
  ProfileType,
  TuningProfile,
  TuningProfilesData,
} from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultTuningProfiles,
  type FreqUnit,
  type ProfileType,
  type TuningProfile,
  type TuningProfilesData,
} from '../../board_settings.js';

const FREQ_UNITS: FreqUnit[] = ['Hz', 'kHz', 'MHz', 'GHz'];
const PROFILE_TYPES: ProfileType[] = ['Single', 'Differential'];

function blankProfile(name: string): TuningProfile {
  return {
    name,
    type: 'Single',
    targetImpedance: 50,
    frequency: 1,
    frequencyUnit: 'GHz',
    enableTimeDomain: false,
    modelSolderMask: true,
    globalUnitDelay: 0,
  };
}

interface Props {
  value: TuningProfilesData;
  onChange: (next: TuningProfilesData) => void;
}

export function PanelPcbTuningProfiles({ value, onChange }: Props): JSX.Element {
  const [sel, setSel] = useState(0);
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const profiles = value.profiles;
  const cur = profiles[Math.min(sel, profiles.length - 1)];

  const setProfiles = (next: TuningProfile[]): void => onChange({ profiles: next });
  const set = <K extends keyof TuningProfile>(k: K, v: TuningProfile[K]): void => {
    if (!cur) return;
    const i = Math.min(sel, profiles.length - 1);
    setProfiles(profiles.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  };
  const add = (): void => {
    setProfiles([...profiles, blankProfile(`Profile ${profiles.length + 1}`)]);
    setSel(profiles.length);
  };
  const remove = (): void => {
    if (!profiles.length) return;
    const i = Math.min(sel, profiles.length - 1);
    setProfiles(profiles.filter((_, j) => j !== i));
    setSel(Math.max(0, i - 1));
  };

  return (
    <div className="ze-tuneprof">
      {/* `m_tuningProfiles`, a wxNotebook (`:23`) — the shared tab strip. */}
      {profiles.length > 0 && (
        <div className="ze-nb-tabs">
          {profiles.map((p, i) => (
            <button
              key={i}
              type="button"
              className={i === sel ? 'active' : undefined}
              onClick={() => setSel(i)}
            >
              {p.name || '(unnamed)'}
            </button>
          ))}
        </div>
      )}

      {/* The selected page — PANEL_SETUP_TUNING_PROFILE_INFO — or an empty
          state when the notebook has no pages. */}
      <div className="ze-tuneprof-page">
        {cur ? (
          <div className="ze-pref-group-body">
            <div className="ze-pref-row">
              <span className="lbl">Name:</span>
              <input
                className="ze-search"
                value={cur.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="ze-pref-row">
              <span className="lbl">Type:</span>
              <Combo
                value={cur.type}
                ariaLabel="Profile type"
                options={PROFILE_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(t) => set('type', t as ProfileType)}
              />
            </div>
            <div className="ze-pref-row">
              <span className="lbl">Target impedance:</span>
              <input
                className="ze-search"
                value={cur.targetImpedance}
                onChange={(e) => set('targetImpedance', num(e.target.value))}
              />
              <span className="unit">ohms</span>
            </div>
            <div className="ze-pref-row">
              <span className="lbl">Frequency:</span>
              <input
                className="ze-search"
                value={cur.frequency}
                onChange={(e) => set('frequency', num(e.target.value))}
              />
              <Combo
                value={cur.frequencyUnit}
                ariaLabel="Frequency unit"
                options={FREQ_UNITS.map((u) => ({ value: u, label: u }))}
                onChange={(u) => set('frequencyUnit', u as FreqUnit)}
              />
            </div>

            <label className="ze-pref-check ze-border-top">
              <input
                type="checkbox"
                checked={cur.enableTimeDomain}
                onChange={(e) => set('enableTimeDomain', e.target.checked)}
              />
              Enable time domain tuning
            </label>

            {cur.enableTimeDomain && (
              <div className="ze-tuneprof-timedomain ze-pref-group-body">
                <label className="ze-pref-check">
                  <input
                    type="checkbox"
                    checked={cur.modelSolderMask}
                    onChange={(e) => set('modelSolderMask', e.target.checked)}
                  />
                  Model Solder Mask
                </label>
                <div className="ze-pref-row">
                  <span className="lbl">Global unit delay:</span>
                  <input
                    className="ze-search"
                    value={cur.globalUnitDelay}
                    onChange={(e) => set('globalUnitDelay', num(e.target.value))}
                  />
                  <span className="unit">ps/cm</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="ze-tuneprof-empty">
            No tuning profiles defined. Use the + button below to add one.
          </div>
        )}
      </div>

      {/* Add / remove profile */}
      <div className="ze-grid-btns">
        <button className="ze-gridbtn" title="Add tuning profile" onClick={add}>
          <Icon name="plus" />
        </button>
        {/* [data] `bSizer91->Add( 20, 0, 1, wxEXPAND )` between the two. */}
        <span className="ze-tuneprof-btngap" />
        <button
          className="ze-gridbtn"
          title="Remove tuning profile"
          disabled={!profiles.length}
          onClick={remove}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
}
