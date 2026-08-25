// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Via Size" panel, electrical, thermal and parasitic characteristics of a
 * plated through-hole via. Counterpart: KiCad `calculator_panels/panel_via_size.cpp`.
 */

import { useMemo, useState, type CSSProperties, type JSX } from 'react';
import {
  printfG,
  STANDARD_EPSILON_R_LIST,
  STANDARD_RESISTIVITY_LIST,
  viaSize,
} from '@ziroeda/pcb_calculator';
import { SingleChoiceDialog } from '../../../ui/dialog_single_choice.js';
import {
  Field,
  Group,
  LEN_UNITS,
  NumField,
  parseNum,
  RES_UNITS,
  ResultField,
  type UnitOpt,
} from '../fields.js';
import { useCalcSaveSettings } from '../calc_settings.js';
import { settings, type PcbCalculatorViaSize } from '../../../prefs/settings.js';

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

/**
 * `OnViaResetButtonClick` (panel_via_size.cpp:126-149).
 *
 * Not the same strings as the settings defaults, and deliberately so: Reset
 * writes each number through `wxString::Format( "%g", … )`, so the clearance
 * diameter comes back as "1" where `via_size.clearance_diameter` opens as
 * "1.0" (pcb_calculator_settings.cpp:265). Every selector goes back to index 0
 * — `DEFAULT_UNIT_SEL_MM` / `DEFAULT_UNIT_SEL_OHM`.
 */
const VIA_SIZE_RESET: PcbCalculatorViaSize = {
  hole_diameter: printfG(0.4),
  hole_diameter_units: 0,
  thickness: printfG(0.035),
  thickness_units: 0,
  length: printfG(1.6),
  length_units: 0,
  pad_diameter: printfG(0.6),
  pad_diameter_units: 0,
  clearance_diameter: printfG(1.0),
  clearance_diameter_units: 0,
  characteristic_impedance: printfG(50.0),
  characteristic_impedance_units: 0,
  applied_current: printfG(1.0),
  plating_resistivity: printfG(1.72e-8),
  permittivity: printfG(4.5),
  temp_rise: printfG(10.0),
  pulse_rise_time: printfG(1.0),
};

/** The field's number times its selector's scale — KiCad's `GetUnitScale()`. */
const si = (text: string, units: UnitOpt[], idx: number): number =>
  parseNum(text) * (units[idx]?.mult ?? 1);

/** `m_staticTextRiseTimeUnits` is a static "ns" with a "nanoseconds" tooltip,
 *  not a selector (panel_via_size_base.cpp:189-193). */
const NS_UNIT: UnitOpt[] = [{ label: 'ns', mult: 1e-9, title: 'nanoseconds' }];

export function PanelViaSize(): JSX.Element {
  // PANEL_VIA_SIZE::LoadSettings / SaveSettings, all seventeen of them
  // (panel_via_size.cpp:152-198). The panel's state IS the field text plus the
  // selector index, which is what upstream stores.
  const [vs, setVs] = useState<PcbCalculatorViaSize>(() => ({
    ...settings.pcbCalculator.via_size,
  }));
  useCalcSaveSettings((s) => {
    s.via_size = { ...vs };
  });
  const set = <K extends keyof PcbCalculatorViaSize>(k: K, v: PcbCalculatorViaSize[K]): void =>
    setVs((p) => ({ ...p, [k]: v }));

  // The two `...` buttons (panel_via_size_base.cpp:136, 158). Each raises
  // wxGetSingleChoice and writes the chosen number into the field
  // (panel_via_size.cpp:87-110).
  const [picking, setPicking] = useState<'rho' | 'er' | null>(null);

  const holeDiaM = si(vs.hole_diameter, LEN_UNITS, vs.hole_diameter_units);
  const platingM = si(vs.thickness, LEN_UNITS, vs.thickness_units);
  const lengthM = si(vs.length, LEN_UNITS, vs.length_units);
  const padDiaM = si(vs.pad_diameter, LEN_UNITS, vs.pad_diameter_units);
  const clearanceDiaM = si(vs.clearance_diameter, LEN_UNITS, vs.clearance_diameter_units);
  const z0Ohm = si(vs.characteristic_impedance, RES_UNITS, vs.characteristic_impedance_units);
  const riseTimeS = si(vs.pulse_rise_time, NS_UNIT, 0);

  const resetDefaults = (): void => setVs({ ...VIA_SIZE_RESET });

  const r = useMemo(() => {
    const p = {
      holeDiaM,
      platingM,
      lengthM,
      padDiaM,
      clearanceDiaM,
      z0Ohm,
      epsilonR: Number(vs.permittivity) || 0,
      currentA: Number(vs.applied_current) || 0,
      resistivity: Number(vs.plating_resistivity) || 0,
      deltaTC: Number(vs.temp_rise) || 0,
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
    vs.permittivity,
    vs.applied_current,
    vs.plating_resistivity,
    vs.temp_rise,
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
          style={
            { '--calc-vgap': '4px' /* [data] wxFlexGridSizer( 0, 3, 4, 0 ) */ } as CSSProperties
          }
        >
          <NumField
            label="Finished hole diameter (D):"
            units={LEN_UNITS}
            base={holeDiaM}
            text={vs.hole_diameter}
            onText={(t) => set('hole_diameter', t)}
            unitIdx={vs.hole_diameter_units}
            onUnitIdx={(i) => set('hole_diameter_units', i)}
          />
          <NumField
            label="Plating thickness (T):"
            units={LEN_UNITS}
            base={platingM}
            text={vs.thickness}
            onText={(t) => set('thickness', t)}
            unitIdx={vs.thickness_units}
            onUnitIdx={(i) => set('thickness_units', i)}
          />
          <NumField
            label="Via length:"
            title="Via length is the board thickness for through hole vias"
            units={LEN_UNITS}
            base={lengthM}
            text={vs.length}
            onText={(t) => set('length', t)}
            unitIdx={vs.length_units}
            onUnitIdx={(i) => set('length_units', i)}
          />
          <NumField
            label="Via pad diameter:"
            title="Diameter of pad surrounding via (annular ring)"
            units={LEN_UNITS}
            base={padDiaM}
            text={vs.pad_diameter}
            onText={(t) => set('pad_diameter', t)}
            unitIdx={vs.pad_diameter_units}
            onUnitIdx={(i) => set('pad_diameter_units', i)}
          />
          <NumField
            label="Clearance hole diameter:"
            title="Diameter of clearance hole in ground plane(s)"
            units={LEN_UNITS}
            base={clearanceDiaM}
            text={vs.clearance_diameter}
            onText={(t) => set('clearance_diameter', t)}
            unitIdx={vs.clearance_diameter_units}
            onUnitIdx={(i) => set('clearance_diameter_units', i)}
          />
          <NumField
            label="Z0:"
            title="Characteristic impedance of conductor"
            units={RES_UNITS}
            base={z0Ohm}
            text={vs.characteristic_impedance}
            onText={(t) => set('characteristic_impedance', t)}
            unitIdx={vs.characteristic_impedance_units}
            onUnitIdx={(i) => set('characteristic_impedance_units', i)}
          />
          <Field
            label="Applied current:"
            value={vs.applied_current}
            onChange={(t) => set('applied_current', t)}
            unit="A"
          />
          <Field
            label="Plating resistivity:"
            title="Specific resistance in ohms * meters"
            value={vs.plating_resistivity}
            onChange={(t) => set('plating_resistivity', t)}
            pick={() => setPicking('rho')}
            unit="Ω·m"
          />
          <Field
            label="Substrate relative permittivity:"
            title="Relative dielectric constant (epsilon r)"
            value={vs.permittivity}
            onChange={(t) => set('permittivity', t)}
            pick={() => setPicking('er')}
            unit=""
          />
          <Field
            label="Temperature rise:"
            title="Maximum acceptable rise in temperature"
            value={vs.temp_rise}
            onChange={(t) => set('temp_rise', t)}
            unit="°C"
          />
          {/* m_staticTextRiseTimeUnits is a wxStaticText reading "ns", with
              "nanoseconds" as its tooltip (panel_via_size_base.cpp:189-193).
              Ours had invented a unit selector here; this page has selectors
              only on the six length and impedance rows. */}
          <NumField
            label="Pulse rise time:"
            units={NS_UNIT}
            title="Pulse rise time to calculate reactance"
            base={riseTimeS}
            text={vs.pulse_rise_time}
            onText={(t) => set('pulse_rise_time', t)}
          />
        </Group>
        <div className="calc-col">
          {/* fgSizerTW_Results11: the same shape with a 5 px vgap
              (panel_via_size_base.cpp:220-222). Its rows are wxStaticTexts,
              so a row is 23 px, not a 34 px control. */}
          <Group
            title="Results"
            className="calc-grid3"
            style={
              { '--calc-vgap': '5px' /* [data] wxFlexGridSizer( 0, 3, 5, 0 ) */ } as CSSProperties
            }
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
              if (picking === 'rho') set('plating_resistivity', num);
              else set('permittivity', num);
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
