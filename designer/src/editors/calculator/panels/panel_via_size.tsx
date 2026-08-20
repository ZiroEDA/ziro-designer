// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Via Size" panel, electrical, thermal and parasitic characteristics of a
 * plated through-hole via. Counterpart: KiCad `calculator_panels/panel_via_size.cpp`.
 */

import { useMemo, useState, type CSSProperties, type JSX } from 'react';
import {
  COPPER_PLATING_RESISTIVITY_OHM_M,
  printfG,
  STANDARD_EPSILON_R_LIST,
  STANDARD_RESISTIVITY_LIST,
  viaSize,
} from '@ziroeda/pcb_calculator';
import { SingleChoiceDialog } from '../../../ui/dialog_single_choice.js';
import { Field, Group, LEN_UNITS, NumField, RES_UNITS, ResultField } from '../fields.js';

/** Every result on this page is `wxString::Format( "%g", … )`. */
const g = (v: number | undefined | false | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? printfG(v) : '';

// KiCad's own dark-theme artwork (GPL), vendored under assets/.
const VIA_ART = import.meta.glob('../../../assets/calculator/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** m_viaBitmap, BITMAPS::viacalc drawn 1:1 (panel_via_size.cpp:63). */
function ViaDrawing(): JSX.Element {
  return (
    <img
      className="calc-art"
      src={VIA_ART['../../../assets/calculator/viacalc.svg']}
      alt=""
      width={204}
      height={212}
    />
  );
}

export function PanelViaSize(): JSX.Element {
  const [holeDiaM, setHoleDiaM] = useState(0.4e-3);
  const [platingM, setPlatingM] = useState(0.035e-3);
  const [lengthM, setLengthM] = useState(1.6e-3);
  const [padDiaM, setPadDiaM] = useState(0.6e-3);
  const [clearanceDiaM, setClearanceDiaM] = useState(1.0e-3);
  const [z0Ohm, setZ0Ohm] = useState(50);
  // The two `...` buttons (panel_via_size_base.cpp:136, 158). Each raises
  // wxGetSingleChoice and writes the chosen number into the field
  // (panel_via_size.cpp:87-110).
  const [picking, setPicking] = useState<'rho' | 'er' | null>(null);
  const [current, setCurrent] = useState('1');
  const [resistivity, setResistivity] = useState(String(COPPER_PLATING_RESISTIVITY_OHM_M));
  const [er, setEr] = useState('4.5');
  const [deltaT, setDeltaT] = useState('10');
  const [riseTimeS, setRiseTimeS] = useState(1e-9);

  // PANEL_VIA_SIZE::OnViaResetButtonClick (panel_via_size.cpp:130-149), which
  // writes each default through `wxString::Format( "%g", … )`.
  const resetDefaults = (): void => {
    setHoleDiaM(0.4e-3);
    setPlatingM(0.035e-3);
    setLengthM(1.6e-3);
    setPadDiaM(0.6e-3);
    setClearanceDiaM(1.0e-3);
    setZ0Ohm(50);
    setCurrent(printfG(1));
    setResistivity(printfG(1.72e-8));
    setEr(printfG(4.5));
    setDeltaT(printfG(10));
    setRiseTimeS(1e-9);
  };

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
    <div className="calc-page-body">
      <div className="calc-row">
        {/* fgSizerVS_Inputs: wxFlexGridSizer( 0, 3, 4, 0 ), AddGrowableCol( 1 )
            — label | entry | unit, the entry column taking the slack, a 4 px
            vertical gap (panel_via_size_base.cpp:25-27). */}
        <Group
          title="Parameters"
          className="calc-grid3 vs-params"
          style={{ '--calc-vgap': '4px' } as CSSProperties}
        >
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
            initialText="1.0"
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
            pick={() => setPicking('rho')}
            unit="Ω·m"
          />
          <Field
            label="Substrate relative permittivity:"
            title="Relative dielectric constant (epsilon r)"
            value={er}
            onChange={setEr}
            pick={() => setPicking('er')}
            unit=""
          />
          <Field
            label="Temperature rise:"
            title="Maximum acceptable rise in temperature"
            value={deltaT}
            onChange={setDeltaT}
            unit="°C"
          />
          {/* m_staticTextRiseTimeUnits is a wxStaticText reading "ns", with
              "nanoseconds" as its tooltip (panel_via_size_base.cpp:189-193).
              Ours had invented a unit selector here; this page has selectors
              only on the six length and impedance rows. */}
          <NumField
            label="Pulse rise time:"
            units={[{ label: 'ns', mult: 1e-9, title: 'nanoseconds' }]}
            title="Pulse rise time to calculate reactance"
            base={riseTimeS}
            onBase={setRiseTimeS}
          />
        </Group>
        <div className="calc-col">
          {/* fgSizerTW_Results11: the same shape with a 5 px vgap
              (panel_via_size_base.cpp:220-222). Its rows are wxStaticTexts,
              so a row is 23 px, not a 34 px control. */}
          <Group
            title="Results"
            className="calc-grid3"
            style={{ '--calc-vgap': '5px' } as CSSProperties}
          >
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
      {/* m_buttonViaReset, wxALIGN_RIGHT|wxALL 10
          (panel_via_size_base.cpp:365-366). It was missing entirely. */}
      <div className="calc-reset-row">
        <button type="button" className="calc-btn" onClick={resetDefaults}>
          Reset to Defaults
        </button>
      </div>

      {picking && (
        <SingleChoiceDialog
          caption={
            picking === 'rho' ? 'Electrical Resistivity in Ohm*m' : 'Relative Dielectric Constants'
          }
          choices={(picking === 'rho' ? STANDARD_RESISTIVITY_LIST : STANDARD_EPSILON_R_LIST).map(
            (e) => ({ value: e.value, label: `${e.value} \t${e.name}` }),
          )}
          onResult={(v) => {
            if (v !== null) {
              // wxGetSingleChoice returns the row's text; the handler splits at
              // the tab and writes the number verbatim (panel_via_size.cpp:95).
              const num = v.split('\t')[0] ?? v;
              if (picking === 'rho') setResistivity(num);
              else setEr(num);
            }
            setPicking(null);
          }}
        />
      )}

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
