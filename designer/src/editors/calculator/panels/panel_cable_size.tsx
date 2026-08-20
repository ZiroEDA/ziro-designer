// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Cable Size" panel, KiCad's fully-linked wire model: every field (diameter,
 * area, linear resistance, 100%-skin-depth frequency, ampacity, DC resistance,
 * voltage drop, dissipated power) can be edited and back-solves the wire
 * radius; everything else recomputes. Includes the conductor material presets
 * (resistivity + temperature coefficient) from KiCad's common_data lists.
 * Counterpart: KiCad `calculator_panels/panel_cable_size.cpp`.
 */

import { useState, type JSX } from 'react';
import {
  AWG_NAMES,
  STANDARD_CABLE_CONDUCTOR_LIST,
  STANDARD_CABLE_TEMP_COEF_LIST,
  printfG,
  type CableParams,
  awgDiameterM,
  awgIndexToGauge,
  cableHotResistivity,
  cableRadiusFromAmpacity,
  cableRadiusFromArea,
  cableRadiusFromDiameter,
  cableRadiusFromFrequency,
  cableRadiusFromLinResistance,
  cableRadiusFromPower,
  cableRadiusFromResistanceDc,
  cableRadiusFromVDrop,
  cableUpdateAll,
} from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { SingleChoiceDialog } from '../../../ui/dialog_single_choice.js';
import { type UnitOpt, parseNum } from '../fields.js';

// Unit selectors, as in KiCad's UNIT_SELECTOR widgets (unit_selector.cpp).
const DIA_UNITS: UnitOpt[] = [
  { label: 'mm', mult: 1e-3 },
  { label: 'µm', mult: 1e-6 },
  { label: 'cm', mult: 1e-2 },
  { label: 'mil', mult: 25.4e-6 },
  { label: 'inch', mult: 25.4e-3 },
];
const LINR_UNITS: UnitOpt[] = [
  { label: 'Ω/m', mult: 1 },
  { label: 'Ω/km', mult: 1e-3 },
  { label: 'Ω/ft', mult: 1 / 0.3048 },
  { label: 'Ω/1000ft', mult: 1e-3 / 0.3048 },
];
const FREQ_UNITS: UnitOpt[] = [
  { label: 'GHz', mult: 1e9 },
  { label: 'MHz', mult: 1e6 },
  { label: 'kHz', mult: 1e3 },
  { label: 'Hz', mult: 1 },
];
const CABLE_LEN_UNITS: UnitOpt[] = [
  { label: 'cm', mult: 1e-2 },
  { label: 'm', mult: 1 },
  { label: 'km', mult: 1e3 },
  { label: 'inch', mult: 25.4e-3 },
  { label: 'feet', mult: 0.3048 },
];
const VDROP_UNITS: UnitOpt[] = [
  { label: 'mV', mult: 1e-3 },
  { label: 'V', mult: 1 },
];
const POWER_UNITS: UnitOpt[] = [
  { label: 'mW', mult: 1e-3 },
  { label: 'W', mult: 1 },
];

interface LinkedRowProps {
  label: string;
  field: string;
  /** Current SI value derived from the model. */
  si: number;
  units: UnitOpt[];
  unitIdx: number;
  onUnitIdx: (i: number) => void;
  /** Commit a new SI value typed by the user (already unit-scaled). */
  onCommit: (si: number) => void;
  editing: { field: string; text: string } | null;
  setEditing: (e: { field: string; text: string } | null) => void;
}

/**
 * Editable linked field: shows the model-derived value unless it is the field
 * being typed into (KiCad's m_updating* flags), commits on every keystroke.
 */
function LinkedRow(p: LinkedRowProps): JSX.Element {
  const mult = p.units[p.unitIdx]?.mult ?? 1;
  const text =
    p.editing?.field === p.field
      ? p.editing.text
      : Number.isFinite(p.si)
        ? printfG(p.si / mult)
        : '';
  return (
    <div className="calc-field">
      <span className="calc-field-label" style={{ minWidth: 190 }}>
        {p.label}
      </span>
      <input
        className="calc-input"
        value={text}
        spellCheck={false}
        onFocus={() => p.setEditing({ field: p.field, text })}
        onBlur={() => p.setEditing(null)}
        onChange={(e) => {
          p.setEditing({ field: p.field, text: e.target.value });
          const v = parseNum(e.target.value) * mult;
          if (Number.isFinite(v) && v > 0) p.onCommit(v);
        }}
      />
      {p.units.length > 1 ? (
        <Combo
          style={{ minWidth: 62 }}
          value={String(p.unitIdx)}
          options={p.units.map((u, i) => ({ value: String(i), label: u.label }))}
          onChange={(v) => p.onUnitIdx(Number(v))}
        />
      ) : (
        <span className="calc-unit">{p.units[0]?.label}</span>
      )}
    </div>
  );
}

export function PanelCableSize(): JSX.Element {
  // panel_cable_size_base.cpp:71, 95, 177, 203
  const TIP_RESISTIVITY = 'Specific resistance in Ohm*m at 20 deg C';
  const TIP_TEMPCOEF = 'Thermal coefficient at 20 deg C';
  const TIP_CABLE_TEMP = 'Off-Load max conductor temp. Reference: 20 deg C';
  const TIP_LENGTH = 'Length includes the return path';
  const TIP_RESDC = 'DC Resistance of the conductor';

  // Central model state, as in KiCad: the wire radius plus the plain inputs.
  const [radiusM, setRadiusM] = useState(0.0005); // 1 mm diameter
  const [awgSel, setAwgSel] = useState(-1);
  // [px] the real fields read `1.72e-08` and `3.93e-3` — the first is written by
  // `%g`, the second is the pick-list's own string.
  const [rho20Text, setRho20Text] = useState(printfG(1.72e-8));
  const [alphaText, setAlphaText] = useState('3.93e-3');
  const [temp, setTemp] = useState('20');
  const [density, setDensity] = useState(3);
  const [current, setCurrent] = useState('1');
  // Every UNIT_SELECTOR on this page opens on index 0
  // (panel_cable_size_base.cpp:55,123,135,212,237,249): mm, Ω/m, GHz, cm, mV,
  // mW — and the length default is 100 cm, not 1 m.
  const [lengthText, setLengthText] = useState('100');
  const [lengthUnit, setLengthUnit] = useState(0); // cm
  const [editing, setEditing] = useState<{ field: string; text: string } | null>(null);

  const [diaUnit, setDiaUnit] = useState(0);
  const [linRUnit, setLinRUnit] = useState(0);
  const [freqUnit, setFreqUnit] = useState(0); // GHz
  const [vdropUnit, setVdropUnit] = useState(0); // mV
  const [powerUnit, setPowerUnit] = useState(0); // mW
  const [picking, setPicking] = useState<'rho' | 'alpha' | null>(null);

  const params: CableParams = {
    rho20: parseNum(rho20Text),
    alpha: parseNum(alphaText),
    temperatureC: parseNum(temp),
    ampPerMm2: density,
    currentA: parseNum(current),
    lengthM: parseNum(lengthText) * (CABLE_LEN_UNITS[lengthUnit]?.mult ?? 1),
  };
  const valid =
    params.rho20 > 0 && Number.isFinite(params.alpha) && Number.isFinite(params.temperatureC);
  const s = valid ? cableUpdateAll(radiusM, params) : null;
  const rhoHot = valid ? cableHotResistivity(params.rho20, params.alpha, params.temperatureC) : NaN;

  // Any wire-property edit clears the AWG selection, as in KiCad.
  const commitRadius = (r: number): void => {
    if (Number.isFinite(r) && r > 0) {
      setRadiusM(r);
      setAwgSel(-1);
    }
  };

  const pickAwg = (idx: number): void => {
    setAwgSel(idx);
    if (idx >= 0) setRadiusM(awgDiameterM(awgIndexToGauge(idx)) / 2);
  };

  const linked = (
    label: string,
    field: string,
    si: number,
    units: UnitOpt[],
    unitIdx: number,
    onUnitIdx: (i: number) => void,
    onCommit: (v: number) => void,
  ): JSX.Element => (
    <LinkedRow
      label={label}
      field={field}
      si={si}
      units={units}
      unitIdx={unitIdx}
      onUnitIdx={onUnitIdx}
      onCommit={onCommit}
      editing={editing}
      setEditing={setEditing}
    />
  );

  return (
    <div>
      <div className="calc-row">
        <fieldset className="calc-group" style={{ minWidth: 420 }}>
          <legend>Wire properties</legend>
          <div className="calc-field">
            <span className="calc-field-label" style={{ minWidth: 190 }}>
              Standard Size:
            </span>
            <Combo
              value={String(awgSel)}
              options={[
                // m_sizeChoice's first entry is blank, not "---".
                { value: '-1', label: '' },
                ...AWG_NAMES.map((n, i) => ({ value: String(i), label: n })),
              ]}
              onChange={(v) => pickAwg(Number(v))}
            />
          </div>
          {linked('Diameter:', 'dia', s?.diameterM ?? NaN, DIA_UNITS, diaUnit, setDiaUnit, (v) =>
            commitRadius(cableRadiusFromDiameter(v)),
          )}
          {linked(
            'Area:',
            'area',
            (s?.areaM2 ?? NaN) * 1e6,
            [{ label: 'mm²', mult: 1 }],
            0,
            () => {},
            (v) => commitRadius(cableRadiusFromArea(v / 1e6)),
          )}
          {/* KiCad has no "Conductor material" row: the material is chosen
              through the `...` buttons, which drop a wxGetSingleChoice list and
              write the picked number into the field
              (panel_cable_size.cpp:238-274). */}
          <div className="calc-field">
            <span className="calc-field-label" style={{ minWidth: 190 }} title={TIP_RESISTIVITY}>
              Conductor resistivity:
            </span>
            <input
              className="calc-input"
              value={rho20Text}
              spellCheck={false}
              onChange={(e) => setRho20Text(e.target.value)}
            />
            <button
              type="button"
              className="calc-btn exactfit"
              aria-label="Electrical Resistivity in Ohm*m at 20 deg C"
              onClick={() => setPicking('rho')}
            >
              …
            </button>
            <span className="calc-unit">Ω·m</span>
          </div>
          <div className="calc-field">
            <span className="calc-field-label" style={{ minWidth: 190 }} title={TIP_TEMPCOEF}>
              Temperature Coefficient:
            </span>
            <input
              className="calc-input"
              value={alphaText}
              spellCheck={false}
              onChange={(e) => setAlphaText(e.target.value)}
            />
            <button
              type="button"
              className="calc-btn exactfit"
              aria-label="Temperature coefficient"
              onClick={() => setPicking('alpha')}
            >
              …
            </button>
            {/* KiCad puts NO unit label after this field. */}
          </div>
          {linked(
            'Linear resistance:',
            'linr',
            s?.linearResistance ?? NaN,
            LINR_UNITS,
            linRUnit,
            setLinRUnit,
            (v) => commitRadius(cableRadiusFromLinResistance(v, rhoHot)),
          )}
          {linked(
            'Frequency for 100% skin depth:',
            'freq',
            s?.maxFrequencyHz ?? NaN,
            FREQ_UNITS,
            freqUnit,
            setFreqUnit,
            (v) => commitRadius(cableRadiusFromFrequency(v, rhoHot)),
          )}
          {linked(
            'Ampacity:',
            'amp',
            s?.ampacityA ?? NaN,
            [{ label: 'A', mult: 1 }],
            0,
            () => {},
            (v) => commitRadius(cableRadiusFromAmpacity(v, density)),
          )}
          <div className="calc-field">
            <span className="calc-field-label" style={{ minWidth: 190 }}>
              Current density:
            </span>
            {/* wxSL_AUTOTICKS|wxSL_LABELS|wxSL_VALUE_LABEL, 3..12
                (panel_cable_size_base.cpp:153): the current value is drawn above
                the thumb and the two endpoints under the ends. */}
            <div className="cs-slider">
              <span className="cs-slider-value" style={{ left: `${((density - 3) / 9) * 100}%` }}>
                {density}
              </span>
              <input
                type="range"
                min={3}
                max={12}
                step={1}
                value={density}
                aria-label="Current density"
                onChange={(e) => setDensity(Number(e.target.value))}
              />
              <span className="cs-slider-min">3</span>
              <span className="cs-slider-max">12</span>
            </div>
            <span className="calc-unit">A/mm²</span>
          </div>
        </fieldset>

        <fieldset className="calc-group" style={{ minWidth: 380 }}>
          <legend>Application</legend>
          <div className="calc-field">
            <span className="calc-field-label" style={{ minWidth: 190 }} title={TIP_CABLE_TEMP}>
              Cable temperature:
            </span>
            <input
              className="calc-input"
              value={temp}
              spellCheck={false}
              onChange={(e) => setTemp(e.target.value)}
            />
            <span className="calc-unit">°C</span>
          </div>
          <div className="calc-field">
            <span className="calc-field-label" style={{ minWidth: 190 }}>
              Current:
            </span>
            <input
              className="calc-input"
              value={current}
              spellCheck={false}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <span className="calc-unit">A</span>
          </div>
          <div className="calc-field">
            <span className="calc-field-label" style={{ minWidth: 190 }} title={TIP_LENGTH}>
              Length:
            </span>
            <input
              className="calc-input"
              value={lengthText}
              spellCheck={false}
              onChange={(e) => setLengthText(e.target.value)}
            />
            <Combo
              style={{ minWidth: 62 }}
              value={String(lengthUnit)}
              options={CABLE_LEN_UNITS.map((u, i) => ({ value: String(i), label: u.label }))}
              onChange={(v) => setLengthUnit(Number(v))}
            />
          </div>
          {linked(
            'Resistance DC:',
            'rdc',
            s?.resistanceDcOhm ?? NaN,
            [{ label: 'Ω', mult: 1 }],
            0,
            () => {},
            (v) => commitRadius(cableRadiusFromResistanceDc(v, rhoHot, params.lengthM)),
          )}
          {linked(
            'Voltage drop:',
            'vdrop',
            s?.voltageDropV ?? NaN,
            VDROP_UNITS,
            vdropUnit,
            setVdropUnit,
            (v) => commitRadius(cableRadiusFromVDrop(v, rhoHot, params.lengthM, params.currentA)),
          )}
          {linked(
            'Dissipated power:',
            'power',
            s?.dissipatedPowerW ?? NaN,
            POWER_UNITS,
            powerUnit,
            setPowerUnit,
            (v) => commitRadius(cableRadiusFromPower(v, rhoHot, params.lengthM, params.currentA)),
          )}
          {s && params.currentA > s.ampacityA && (
            <div className="calc-error">Current exceeds the ampacity for this density.</div>
          )}
        </fieldset>
      </div>
      {!valid && (
        <div className="calc-error">Enter a positive resistivity and valid temperature.</div>
      )}

      {picking && (
        <SingleChoiceDialog
          caption={
            picking === 'rho'
              ? 'Electrical Resistivity in Ohm*m at 20 deg C'
              : 'Temperature coefficient'
          }
          choices={(picking === 'rho'
            ? STANDARD_CABLE_CONDUCTOR_LIST
            : STANDARD_CABLE_TEMP_COEF_LIST
          ).map((e) => ({ value: e.value, label: `${e.value} \t${e.name}` }))}
          onResult={(v) => {
            if (v !== null) {
              if (picking === 'rho') setRho20Text(v);
              else setAlphaText(v);
            }
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
