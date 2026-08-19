// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Via Size" panel, electrical, thermal and parasitic characteristics of a
 * plated through-hole via. Counterpart: KiCad `calculator_panels/panel_via_size.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import { COPPER_PLATING_RESISTIVITY_OHM_M, printfG, viaSize } from '@ziroeda/pcb_calculator';
import {
  Field,
  Group,
  LEN_UNITS,
  NumField,
  RES_UNITS,
  ResultField,
  TIME_UNITS,
} from '../fields.js';

/** Every result on this page is `wxString::Format( "%g", … )`. */
const g = (v: number | undefined | false | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? printfG(v) : '';

/** Via cross-section: gold plated barrel around the drilled hole, with D/T marks. */
function ViaDrawing(): JSX.Element {
  return (
    <svg className="calc-svg" width="260" height="240" viewBox="0 0 260 240">
      <circle cx="130" cy="130" r="86" fill="#e8a33d" stroke="#c07f1f" strokeWidth="1.5" />
      <circle cx="130" cy="130" r="70" fill="#3a3d43" stroke="#c07f1f" strokeWidth="1.5" />
      {/* D, hole diameter, across the top */}
      <g stroke="#4a86c5" strokeWidth="1.5" fill="none">
        <line x1="60" y1="44" x2="200" y2="44" />
        <path d="M60 44 l8 -4 M60 44 l8 4" />
        <path d="M200 44 l-8 -4 M200 44 l-8 4" />
        <line x1="60" y1="44" x2="60" y2="60" strokeDasharray="3 2" />
        <line x1="200" y1="44" x2="200" y2="60" strokeDasharray="3 2" />
      </g>
      <text x="126" y="38" fill="#e6e6e6" fontSize="14">
        D
      </text>
      {/* T, plating thickness, on the left edge */}
      <g stroke="#4a86c5" strokeWidth="1.5" fill="none">
        <line x1="30" y1="130" x2="44" y2="130" />
        <line x1="60" y1="130" x2="44" y2="130" />
      </g>
      <text x="24" y="150" fill="#e6e6e6" fontSize="14">
        T
      </text>
    </svg>
  );
}

export function PanelViaSize(): JSX.Element {
  const [holeDiaM, setHoleDiaM] = useState(0.4e-3);
  const [platingM, setPlatingM] = useState(0.035e-3);
  const [lengthM, setLengthM] = useState(1.6e-3);
  const [padDiaM, setPadDiaM] = useState(0.6e-3);
  const [clearanceDiaM, setClearanceDiaM] = useState(1.0e-3);
  const [z0Ohm, setZ0Ohm] = useState(50);
  const [current, setCurrent] = useState('1');
  const [resistivity, setResistivity] = useState(String(COPPER_PLATING_RESISTIVITY_OHM_M));
  const [er, setEr] = useState('4.5');
  const [deltaT, setDeltaT] = useState('10');
  const [riseTimeS, setRiseTimeS] = useState(1e-9);

  const r = useMemo(() => {
    const p = {
      holeDiaM,
      platingM,
      lengthM,
      padDiaM,
      clearanceDiaM,
      z0Ohm,
      epsilonR: Number(er) || 0,
      currentA: Number(current) || 0,
      resistivity: Number(resistivity) || 0,
      deltaTC: Number(deltaT) || 0,
      riseTimeS,
    };
    if (
      !(p.holeDiaM > 0) ||
      !(p.platingM > 0) ||
      !(p.lengthM > 0) ||
      !(p.deltaTC > 0) ||
      !(p.resistivity > 0) ||
      !(p.riseTimeS > 0)
    )
      return null;
    return viaSize(p);
  }, [
    holeDiaM,
    platingM,
    lengthM,
    padDiaM,
    clearanceDiaM,
    z0Ohm,
    er,
    current,
    resistivity,
    deltaT,
    riseTimeS,
  ]);

  return (
    <div>
      <div className="calc-row">
        <Group title="Parameters">
          <NumField
            label="Finished hole diameter (D):"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={holeDiaM}
            onBase={setHoleDiaM}
          />
          <NumField
            label="Plating thickness (T):"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={platingM}
            onBase={setPlatingM}
          />
          <NumField
            label="Via length:"
            title="Via length is the board thickness for through hole vias"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={lengthM}
            onBase={setLengthM}
          />
          <NumField
            label="Via pad diameter:"
            title="Diameter of pad surrounding via (annular ring)"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={padDiaM}
            onBase={setPadDiaM}
          />
          <NumField
            label="Clearance hole diameter:"
            title="Diameter of clearance hole in ground plane(s)"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={clearanceDiaM}
            onBase={setClearanceDiaM}
          />
          <NumField
            label="Z0:"
            title="Characteristic impedance of conductor"
            units={RES_UNITS}
            base={z0Ohm}
            onBase={setZ0Ohm}
          />
          <Field label="Applied current:" value={current} onChange={setCurrent} unit="A" />
          <Field
            label="Plating resistivity:"
            title="Specific resistance in ohms * meters"
            value={resistivity}
            onChange={setResistivity}
            unit="Ω·m"
          />
          <Field
            label="Substrate relative permittivity:"
            title="Relative dielectric constant (epsilon r)"
            value={er}
            onChange={setEr}
            unit=""
          />
          <Field
            label="Temperature rise:"
            title="Maximum acceptable rise in temperature"
            value={deltaT}
            onChange={setDeltaT}
            unit="°C"
          />
          <NumField
            label="Pulse rise time:"
            units={TIME_UNITS}
            defaultUnit="ns"
            title="Pulse rise time to calculate reactance"
            base={riseTimeS}
            onBase={setRiseTimeS}
          />
        </Group>
        <div className="calc-col">
          <Group title="Results">
            {/* Every one of these is a wxStaticText whose label is rewritten
                with "%g" (panel_via_size.cpp:276-300) — six significant
                figures, not four, and no entry box round it. */}
            <ResultField label="Resistance:" value={g(r?.resistanceOhm)} unit="Ω" />
            <ResultField label="Voltage drop:" value={g(r?.voltageDrop)} unit="V" />
            <ResultField label="Power loss:" value={g(r?.powerLossW)} unit="W" />
            <ResultField
              label="Thermal resistance:"
              title="Using thermal conductivity value 401 Watts/(meter-Kelvin)"
              value={g(r?.thermalResistance)}
              unit="°C/W"
            />
            <ResultField
              label="Estimated ampacity:"
              title="Based on temperature rise"
              value={g(r?.ampacityA)}
              unit="A"
            />
            <ResultField
              label="Capacitance:"
              title="pico-Farad"
              value={g(r && r.capacitanceF * 1e12)}
              unit="pF"
            />
            <ResultField
              label="Rise time degradation:"
              title="Rise time degradation for given Z0 and calculated capacitance"
              value={g(r && r.riseTimeDegradationS * 1e12)}
              unit="ps"
            />
            <ResultField
              label="Inductance:"
              title="nano-Henry"
              value={g(r && r.inductanceH * 1e9)}
              unit="nH"
            />
            <ResultField
              label="Reactance:"
              title="Inductive reactance for given rise time and calculated inductance"
              value={g(r?.reactanceOhm)}
              unit="Ω"
            />
          </Group>
          <ViaDrawing />
        </div>
      </div>
      {/* m_staticTextWarning (panel_via_size_base.cpp:201), shown when the pad
          swallows the clearance hole. */}
      {padDiaM >= clearanceDiaM && (
        <div className="calc-error calc-prewrap">
          {'Warning:\nVia pad diameter >= Clearance hole diameter.\n' +
            'Some parameters cannot be calculated for a via inside a copper zone.'}
        </div>
      )}
    </div>
  );
}
