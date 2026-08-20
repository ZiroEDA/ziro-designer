// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Electrical Spacing" panel, two calculators like KiCad: the IPC-2221
 * minimum-clearance table and the IEC 60664-1 insulation coordination
 * (clearance / creepage / groove width).
 * Counterparts: KiCad `calculator_panels/panel_electrical_spacing_ipc2221.cpp`
 * and `panel_electrical_spacing_iec60664.cpp`.
 */

import { type JSX, useMemo, useState } from 'react';
import {
  IPC2221_CASES,
  IPC2221_SPACING_MM,
  IPC2221_VOLTAGE_RANGES,
  type Iec60664Params,
  type InsulationType,
  type MaterialGroup,
  type OvervoltageCategory,
  type PollutionDegree,
  iec60664,
  printfG,
  ratedImpulseWithstandVoltageV,
} from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { Field, Group, fmt, parseNum } from '../fields.js';

// UNIT_SELECTOR_LEN (widgets/unit_selector.cpp:29-39): five entries, in this
// order, and the label really is "um" — the `en` catalogue leaves it alone
// (translation/pofiles/en.po), unlike UNIT_SELECTOR_THICKNESS which says "µm".
// GetUnitScale returns metres per unit (lines 47-58).
const SPACING_UNITS: readonly { label: string; scale: number }[] = [
  { label: 'mm', scale: 1e-3 },
  { label: 'um', scale: 1e-6 },
  { label: 'cm', scale: 1e-2 },
  { label: 'mil', scale: 25.4e-6 },
  { label: 'inch', scale: 25.4e-3 },
];

function PanelIpc2221(): JSX.Element {
  // pcb_calculator_settings.cpp:66-70 — unit index 0 (mm), voltage "500".
  const [unitIdx, setUnitIdx] = useState(0);
  const [voltage, setVoltage] = useState('500');
  const [shownVoltage, setShownVoltage] = useState(500);

  const scale = SPACING_UNITS[unitIdx]?.scale ?? 1e-3;

  // ElectricalSpacingUpdateData (panel_electrical_spacing_ipc2221.cpp:161-196):
  // an empty field means 500, anything under 500 is clamped to 500, and the
  // clamped value is written BACK into the field with "%g" before the grid is
  // refilled. The table holds metres, so a cell is printed as value/unitScale.
  const applyVoltage = (): number => {
    const txt = voltage.trim();
    let v = txt === '' ? 500 : parseNum(txt);
    if (!(v >= 500)) v = 500;
    setVoltage(printfG(v));
    setShownVoltage(v);
    return v;
  };

  const cell = (mm: number): string => printfG((mm * 1e-3) / scale);

  const rows = useMemo(() => {
    const body = IPC2221_SPACING_MM.slice(0, IPC2221_SPACING_MM.length - 1).map((r) => [...r]);
    // The last row is computed: the 301..500 V row plus the per-volt row times
    // the volts above 500.
    const base = IPC2221_SPACING_MM[IPC2221_SPACING_MM.length - 2] ?? [];
    const perVolt = IPC2221_SPACING_MM[IPC2221_SPACING_MM.length - 1] ?? [];
    body.push(base.map((b, j) => b + (perVolt[j] ?? 0) * (shownVoltage - 500)));
    return body;
  }, [shownVoltage]);

  return (
    <div className="es-ipc">
      <div className="es-ipc-left">
        <span>Unit:</span>
        <Combo
          ariaLabel="Unit"
          value={String(unitIdx)}
          options={SPACING_UNITS.map((u, i) => ({ value: String(i), label: u.label }))}
          onChange={(v) => setUnitIdx(Number(v))}
        />
        <hr className="calc-hr" />
        <span>Voltage &gt; 500 V:</span>
        <input
          className="calc-input"
          value={voltage}
          spellCheck={false}
          onChange={(e) => setVoltage(e.target.value)}
        />
        <button type="button" className="calc-btn" onClick={applyVoltage}>
          Update Values
        </button>
      </div>

      <div className="es-ipc-right">
        {/* m_staticTextElectricalSpacing, centred, bold ITALIC
            (panel_electrical_spacing_ipc2221_base.cpp:51-55). */}
        <div className="es-ipc-note">Note: Values are minimal values (from IPC 2221)</div>
        <table className="calc-table es-ipc-grid">
          <thead>
            <tr>
              <th />
              {IPC2221_CASES.map((c) => (
                <th key={c.id}>{c.id}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={IPC2221_VOLTAGE_RANGES[i]}>
                <th className="es-ipc-rowhead">{IPC2221_VOLTAGE_RANGES[i]}</th>
                {r.map((mm, j) => (
                  <td key={IPC2221_CASES[j]?.id ?? j}>{cell(mm)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {/* m_stHelp, one wxStaticText of "*  ID - description" lines
            (panel_electrical_spacing_ipc2221_base.cpp:117). */}
        <pre className="es-ipc-help">
          {IPC2221_CASES.map((c) => `*  ${c.id} - ${c.description}`).join('\n')}
        </pre>
      </div>
    </div>
  );
}

// panel_electrical_spacing_iec60664_base.cpp:43,56,121,136,151,166,181,196,211,223
const TIP_RATED = 'Voltage of the mains supply';
const TIP_OVC =
  'OVC I: Equipment with no direct connection to mains supply\n\n' +
  'OVC II: Energy-consuming equipment to be supplied from the fixed installation. ' +
  '(eg: appliances, portable tools, household loads). OVCIII applies if there are ' +
  'reliability and availability requirements\n\n' +
  'OVC III :  Equipment in fixed installations with reliability and availability ' +
  'requirements. (eg: electrical switches, equipment for industrial use)\n\n' +
  'OVC IV: Equipment at the origin of the installation (eg: electricity meters, ' +
  'primary overcurrent protection devices)';
const TIP_IMPULSE =
  'Given the rated voltage and the overvoltage category, a device should withstand this ' +
  'value without a breakdown of insulation. This impulse voltage is a standard 1.2/50µs wave';
const TIP_RMS = 'Expected RMS voltage.';
const TIP_TRANSIENT =
  'Transient overvoltages due to:\n\n' +
  '- Atmospheric disturbances transmitted by the mains supply (eg: a lightning strike)\n' +
  '- Switching loads in the main supplys\n- External circuits\n- Internal generation\n\n' +
  'Events that last for a few milliseconds or less.';
const TIP_PEAK =
  '- Steady-state voltage value\n- Temporary overvoltage\n- Recurring peak voltage\n\n' +
  'Events of relatively long duration.';
const TIP_INSULATION =
  'Functional: insulation is necessary only for the functioning of the equipment\n\n' +
  'Basic: Insulation of hazardous-live parts.\n\n' +
  'Reinforced: Single insulation that provides a degree of protection equivalent to a ' +
  'double insulation. ( which is two separate basic insulations, in case one of them fails  ).';
const TIP_PD =
  'PD1: No pollution or only dry, non-conductive pollution occurs\n\n' +
  'PD2: Only non-conductive pollution occurs . Condensation may occur.\n\n' +
  'PD3: Conductive pollution occurs, or non-conductive pollution occurs which becomes ' +
  'conductive due to expected condensation.\n\n' +
  'PD4: Continuous conductivity occurs due to conductive dust, rain, ...';
const TIP_MATERIAL =
  'Materials with a high comparative tracking index (CTI) are better at providing ' +
  'isolation.\n\nMaterial group I: 600 <= CTI\nMaterial group II: 400 <= CTI < 600\n' +
  'Material group IIIa: 175 <= CTI < 400\nMaterial group IIIb: 100 <= CTI < 175';
const TIP_PCB =
  'Printed wiring material can benefit of a creepage distance reduction for RMS voltages ' +
  'lower than 1000V';
const TIP_ALTITUDE =
  'Coating and potting allows for clearance and creepage distances reduction. Not supported ' +
  'by the calculator.\n\nA coating that could easily delaminate in the lifespan of the ' +
  'product (such as a soldermask) should not be considered for a reduction.';

const OVC: { label: string; v: OvervoltageCategory }[] = [
  { label: 'OVC I', v: 1 },
  { label: 'OVC II', v: 2 },
  { label: 'OVC III', v: 3 },
  { label: 'OVC IV', v: 4 },
];
const PD: { label: string; v: PollutionDegree }[] = [
  { label: 'PD1', v: 1 },
  { label: 'PD2', v: 2 },
  { label: 'PD3', v: 3 },
  { label: 'PD4', v: 4 },
];
const MG: { label: string; v: MaterialGroup }[] = [
  { label: 'I', v: 'I' },
  { label: 'II', v: 'II' },
  { label: 'IIIa', v: 'IIIa' },
  { label: 'IIIb', v: 'IIIb' },
];
const INSUL: { label: string; v: InsulationType }[] = [
  { label: 'Functional', v: 'functional' },
  { label: 'Basic', v: 'basic' },
  { label: 'Reinforced', v: 'reinforced' },
];

function Select<T>({
  label,
  options,
  value,
  onChange,
  title,
}: {
  label: string;
  options: { label: string; v: T }[];
  value: T;
  onChange: (v: T) => void;
  title?: string;
}): JSX.Element {
  const idx = options.findIndex((o) => o.v === value);
  return (
    <label className="calc-field" title={title}>
      <span className="calc-field-label">{label}</span>
      <Combo
        value={String(idx)}
        options={options.map((o, i) => ({ value: String(i), label: o.label }))}
        onChange={(v) => onChange(options[Number(v)]!.v)}
      />
    </label>
  );
}

/**
 * m_bitmapIEC60664 plus its legend: two pads on a substrate with the clearance
 * drawn solid and the creepage dashed
 * (panel_electrical_spacing_iec60664_base.cpp, BITMAPS::iec60664insulation).
 */
function CreepageDrawing(): JSX.Element {
  return (
    <div className="es-iec-figure">
      <svg viewBox="0 0 220 130" width="220" height="130" aria-hidden="true">
        <g fill="#d0d0d0" stroke="#3a3a3a">
          <path d="M14 62 L60 40 L104 40 L104 100 L58 122 L14 122 Z" />
          <path d="M116 40 L162 18 L206 18 L206 78 L160 100 L116 100 Z" />
        </g>
        <g fill="#f5a623" stroke="#8a5a10">
          <path d="M24 56 L62 38 L96 38 L96 56 L58 74 L24 74 Z" />
          <path d="M126 34 L164 16 L198 16 L198 34 L160 52 L126 52 Z" />
        </g>
        <path d="M96 47 L126 43" stroke="#2f7fd0" strokeWidth="3" fill="none" />
        <path
          d="M96 60 L104 70 L116 70 L126 56"
          stroke="#2f7fd0"
          strokeWidth="3"
          strokeDasharray="4 4"
          fill="none"
        />
      </svg>
      <div className="es-iec-legend">
        solid: clearance
        <br />
        dashed: creepage
      </div>
    </div>
  );
}

function PanelIec60664(): JSX.Element {
  // pcb_calculator_settings.cpp:73-101, every one of them.
  const [ratedVoltage, setRatedVoltage] = useState('230');
  const [ovc, setOvc] = useState<OvervoltageCategory>(1);
  const [rms, setRms] = useState('230');
  const [transient, setTransient] = useState('1');
  const [peak, setPeak] = useState('0.5');
  const [insul, setInsul] = useState<InsulationType>('functional');
  const [pd, setPd] = useState<PollutionDegree>(1);
  const [mg, setMg] = useState<MaterialGroup>('I');
  const [pcb, setPcb] = useState(true);
  const [altitude, setAltitude] = useState('2000');

  const impulseKv = useMemo(() => {
    const r = ratedImpulseWithstandVoltageV(parseNum(ratedVoltage), ovc);
    return r < 0 ? -1 : r / 1000;
  }, [ratedVoltage, ovc]);

  const result = useMemo(() => {
    const p: Iec60664Params = {
      ratedVoltageV: parseNum(ratedVoltage),
      overvoltageCategory: ovc,
      pollutionDegree: pd,
      materialGroup: mg,
      insulationType: insul,
      field: 'inhomogeneous',
      pcbMaterial: pcb,
      altitudeM: parseNum(altitude),
      rmsVoltageV: parseNum(rms),
      peakVoltageKv: parseNum(peak),
      transientVoltageKv: parseNum(transient),
    };
    return iec60664(p);
  }, [ratedVoltage, ovc, pd, mg, insul, pcb, altitude, rms, peak, transient]);

  const dist = (mm: number): string => {
    if (pd === 4) return 'N/A';
    return mm >= 0 ? fmt(mm, 5) : 'Out of range';
  };

  return (
    // m_stTitle, bold and centred over the whole page, then TWO
    // wxStaticBoxSizers each laid out HORIZONTALLY: inputs on the left of the
    // box, outputs on the right of the same box
    // (panel_electrical_spacing_iec60664_base.cpp:24-31, 109).
    <div className="es-iec">
      <div className="es-iec-title">Insulation for equipment within low-voltage supply systems</div>

      <fieldset className="calc-group">
        <legend>Determine the transient impulse voltage to withstand</legend>
        <div className="es-iec-split">
          <div className="es-iec-form">
            <Field
              label="Rated Voltage (RMS or DC):"
              title={TIP_RATED}
              value={ratedVoltage}
              onChange={setRatedVoltage}
              unit="V"
            />
            <Select
              label="Overvoltage category:"
              title={TIP_OVC}
              options={OVC}
              value={ovc}
              onChange={setOvc}
            />
          </div>
          <div className="es-iec-form">
            <Field
              label="Impulse voltage:"
              title={TIP_IMPULSE}
              value={impulseKv < 0 ? 'Out of range' : fmt(impulseKv, 4)}
              readOnly
              unit="kV"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="calc-group">
        <legend>Compute the clearance and creepage distances</legend>
        <div className="es-iec-split">
          <div className="es-iec-form">
            <Field label="RMS Voltage:" title={TIP_RMS} value={rms} onChange={setRms} unit="V" />
            <Field
              label="Transient overvoltage:"
              title={TIP_TRANSIENT}
              value={transient}
              onChange={setTransient}
              unit="kV"
            />
            <Field
              label="Recurring peak voltage:"
              title={TIP_PEAK}
              value={peak}
              onChange={setPeak}
              unit="kV"
            />
            <Select
              label="Type of insulation:"
              title={TIP_INSULATION}
              options={INSUL}
              value={insul}
              onChange={setInsul}
            />
            <Select
              label="Pollution Degree:"
              title={TIP_PD}
              options={PD}
              value={pd}
              onChange={setPd}
            />
            <Select
              label="Material group:"
              title={TIP_MATERIAL}
              options={MG}
              value={mg}
              onChange={setMg}
            />
            <label className="calc-field" title={TIP_PCB}>
              <span className="calc-field-label">PCB material:</span>
              <input type="checkbox" checked={pcb} onChange={(e) => setPcb(e.target.checked)} />
            </label>
            <Field
              label="Max altitude:"
              title={TIP_ALTITUDE}
              value={altitude}
              onChange={setAltitude}
              unit="m"
            />
          </div>
          <div className="es-iec-form">
            <Field label="Clearance:" value={dist(result.clearanceMm)} readOnly unit="mm" />
            <Field label="Creepage:" value={dist(result.creepageMm)} readOnly unit="mm" />
            <Field
              label="Min groove width:"
              value={dist(result.grooveWidthMm)}
              readOnly
              unit="mm"
            />
            <CreepageDrawing />
          </div>
        </div>
      </fieldset>

      {/* sbSizerHelp's HTML_WINDOW, showing `iec60664_help.md` through
          ConvertMarkdown2Html. Carried here line for line. */}
      <fieldset className="calc-group calc-help es-iec-help">
        <legend>Help</legend>
        <div className="calc-help-body">
          <p>
            The goal of the IEC60664-1 is to provide guidance on designing insulation for products
            that have a connection to mains supply.
          </p>
          <p>However some cases are not covered by this calculator:</p>
          <ul>
            <li>
              For frequencies higher than 30kHz, the dielectric performances are degraded.
              IEC60664-4 covers those cases
            </li>
            <li>
              When using a conformal coating or a potting in order to protect for pollution, if all
              conditions specified by IEC60664-3 are met, the clearance and creepage distances can
              be reduced. Soldermask is usually not considered as a conformal coating.
            </li>
            <li>
              Insulations trough liquids, compressed air or gases other than air are not in the
              scope of IEC60664
            </li>
          </ul>
        </div>
      </fieldset>
    </div>
  );
}

export function PanelElectricalSpacing(): JSX.Element {
  const [tab, setTab] = useState<'ipc' | 'iec'>('ipc');
  return (
    // A wxNotebook is the whole page — there is no heading above it
    // (panel_electrical_spacing_base.cpp:15-21), and the two pages are named
    // "IPC 2221" and "IEC 60664", without the hyphen and without the "-1".
    <div className="es-panel">
      <div className="calc-tabs">
        <button
          type="button"
          className={`calc-tab${tab === 'ipc' ? ' active' : ''}`}
          onClick={() => setTab('ipc')}
        >
          IPC 2221
        </button>
        <button
          type="button"
          className={`calc-tab${tab === 'iec' ? ' active' : ''}`}
          onClick={() => setTab('iec')}
        >
          IEC 60664
        </button>
      </div>
      {tab === 'ipc' ? <PanelIpc2221 /> : <PanelIec60664 />}
    </div>
  );
}
