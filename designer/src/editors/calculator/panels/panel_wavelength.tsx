// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Wavelength" panel, frequency/period/wavelength conversions in a medium.
 * Counterpart: KiCad `calculator_panels/panel_wavelength.cpp` and its base.
 *
 * Seven rows in one flat grid — no group boxes, no explanatory note — each with
 * its own `UNIT_SELECTOR`, and `er:` carrying a `...` pick-list. All five of the
 * top rows are editable, including Speed in medium: `PANEL_WAVELENGTH::update`
 * guards each one with its own `m_updating*` flag, which is what "type in any of
 * them" means (panel_wavelength.cpp:85-125).
 */

import { type JSX, useState } from 'react';
import {
  STANDARD_EPSILON_R_LIST,
  type WavelengthState,
  fromFrequency,
  fromPeriod,
  fromWavelengthMedium,
  fromWavelengthVacuum,
  printfG,
} from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { SingleChoiceDialog } from '../../../ui/dialog_single_choice.js';
import { parseNum } from '../fields.js';

// The four UNIT_SELECTORs this page uses, in their declared order; each opens on
// index 0 (widgets/unit_selector.cpp:95, 205, 283, 311).
const FREQ = [
  { label: 'GHz', scale: 1e9 },
  { label: 'MHz', scale: 1e6 },
  { label: 'kHz', scale: 1e3 },
  { label: 'Hz', scale: 1 },
];
const TIME = [
  { label: 'ns', scale: 1e-9 },
  { label: 'ps', scale: 1e-12 },
];
const LEN = [
  { label: 'cm', scale: 1e-2 },
  { label: 'm', scale: 1 },
  { label: 'km', scale: 1e3 },
  { label: 'inch', scale: 25.4e-3 },
  { label: 'feet', scale: 0.3048 },
];
const SPEED = [
  { label: 'm/s', scale: 1 },
  { label: 'ft/s', scale: 0.3048 },
  { label: 'km/h', scale: 1 / 3.6 },
  { label: 'mi/h', scale: 0.44704 },
];

type Row = 'frequency' | 'period' | 'vacuum' | 'medium' | 'speed';

export function PanelWavelength(): JSX.Element {
  // pcb_calculator_settings.cpp: frequency 1e9, permittivity 4.5, permeability 1.
  const [er, setEr] = useState('4.5');
  const [mur, setMur] = useState('1');
  const [state, setState] = useState<WavelengthState>(() => fromFrequency(1e9, 4.5, 1));
  const [editing, setEditing] = useState<{ row: Row; text: string } | null>(null);
  const [picking, setPicking] = useState(false);

  const [freqUnit, setFreqUnit] = useState(0);
  const [periodUnit, setPeriodUnit] = useState(0);
  const [vacUnit, setVacUnit] = useState(0);
  const [medUnit, setMedUnit] = useState(0);
  const [speedUnit, setSpeedUnit] = useState(0);

  const erN = parseNum(er) > 0 ? parseNum(er) : 1;
  const murN = parseNum(mur) > 0 ? parseNum(mur) : 1;

  const shown = (row: Row, si: number, scale: number): string =>
    editing?.row === row ? editing.text : Number.isFinite(si) ? printfG(si / scale) : '';

  const commit = (row: Row, text: string, next: WavelengthState | null): void => {
    setEditing({ row, text });
    if (next) setState(next);
  };

  const rows: {
    row: Row;
    label: string;
    si: number;
    units: typeof FREQ;
    unitIdx: number;
    setUnitIdx: (i: number) => void;
    onText: (v: string) => void;
  }[] = [
    {
      row: 'frequency',
      label: 'Frequency:',
      si: state.frequencyHz,
      units: FREQ,
      unitIdx: freqUnit,
      setUnitIdx: setFreqUnit,
      onText: (v) => {
        const f = parseNum(v) * (FREQ[freqUnit]?.scale ?? 1);
        commit('frequency', v, f > 0 ? fromFrequency(f, erN, murN) : null);
      },
    },
    {
      row: 'period',
      label: 'Period:',
      si: state.periodS,
      units: TIME,
      unitIdx: periodUnit,
      setUnitIdx: setPeriodUnit,
      onText: (v) => {
        const p = parseNum(v) * (TIME[periodUnit]?.scale ?? 1);
        commit('period', v, p > 0 ? fromPeriod(p, erN, murN) : null);
      },
    },
    {
      row: 'vacuum',
      label: 'Wavelength in vacuum:',
      si: state.wavelengthVacuumM,
      units: LEN,
      unitIdx: vacUnit,
      setUnitIdx: setVacUnit,
      onText: (v) => {
        const l = parseNum(v) * (LEN[vacUnit]?.scale ?? 1);
        commit('vacuum', v, l > 0 ? fromWavelengthVacuum(l, erN, murN) : null);
      },
    },
    {
      row: 'medium',
      label: 'Wavelength in medium:',
      si: state.wavelengthMediumM,
      units: LEN,
      unitIdx: medUnit,
      setUnitIdx: setMedUnit,
      onText: (v) => {
        const l = parseNum(v) * (LEN[medUnit]?.scale ?? 1);
        commit('medium', v, l > 0 ? fromWavelengthMedium(l, erN, murN) : null);
      },
    },
    {
      row: 'speed',
      label: 'Speed in medium:',
      si: state.speedM,
      units: SPEED,
      unitIdx: speedUnit,
      setUnitIdx: setSpeedUnit,
      // Editing the speed changes the MEDIUM, not the frequency: KiCad keeps
      // c/sqrt(er*mur) and the frequency fixed, so the wavelength in medium
      // follows. Ours does the same by holding the frequency and re-deriving.
      onText: (v) => {
        const s = parseNum(v) * (SPEED[speedUnit]?.scale ?? 1);
        commit('speed', v, s > 0 ? fromWavelengthMedium(s / state.frequencyHz, erN, murN) : null);
      },
    },
  ];

  const setMedium = (nextEr: string, nextMur: string): void => {
    setEr(nextEr);
    setMur(nextMur);
    const e = parseNum(nextEr);
    const m = parseNum(nextMur);
    if (e > 0 && m > 0) {
      setEditing(null);
      setState(fromFrequency(state.frequencyHz, e, m));
    }
  };

  return (
    <div className="wl-grid">
      {rows.map((r) => (
        <div className="wl-row" key={r.row}>
          <span className="calc-field-label">{r.label}</span>
          <input
            className="calc-input"
            value={shown(r.row, r.si, r.units[r.unitIdx]?.scale ?? 1)}
            spellCheck={false}
            onChange={(e) => r.onText(e.target.value)}
          />
          <Combo
            ariaLabel={r.label}
            style={{ minWidth: 78 }}
            value={String(r.unitIdx)}
            options={r.units.map((u, i) => ({ value: String(i), label: u.label }))}
            onChange={(v) => {
              setEditing(null);
              r.setUnitIdx(Number(v));
            }}
          />
        </div>
      ))}

      <div className="wl-row">
        <span className="calc-field-label" title="relative permittivity (dielectric constant)">
          er:
        </span>
        <input
          className="calc-input"
          value={er}
          spellCheck={false}
          onChange={(e) => setMedium(e.target.value, mur)}
        />
        {/* `new wxButton( ..., _("..."), ..., 0 )` — style ZERO
            (panel_wavelength_base.cpp:96). This is the ONLY "..." button in the
            launcher without wxBU_EXACTFIT; Cable Size's two, Via Size's two and
            Transmission Lines' three all have it. So it is a full-size wxButton
            and takes wxButton's minimum width, not the 15 px an EXACTFIT one
            shrinks to: [px] KiCad's runs x 522..606 = 85 while ours was 39.
            Its label is three full stops, not the ellipsis character we used. */}
        <button
          type="button"
          className="calc-btn"
          aria-label="Relative Dielectric Constants"
          onClick={() => setPicking(true)}
        >
          ...
        </button>
      </div>

      <div className="wl-row">
        <span className="calc-field-label" title="relative permeability">
          mur:
        </span>
        <input
          className="calc-input"
          value={mur}
          spellCheck={false}
          onChange={(e) => setMedium(er, e.target.value)}
        />
      </div>

      {picking && (
        <SingleChoiceDialog
          caption="Relative Dielectric Constants"
          choices={STANDARD_EPSILON_R_LIST.map((e) => ({
            value: e.value,
            label: `${e.value} \t${e.name}`,
          }))}
          onResult={(v) => {
            if (v !== null) setMedium(v, mur);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
