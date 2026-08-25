// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Track Width" panel, IPC-2221 current capacity for external and internal
 * layers. Counterpart: KiCad `calculator_panels/panel_track_width.cpp`.
 *
 * The page has THREE entry points, not one. `TransferDataFromControls` reads
 * whichever of current / external width / internal width the user last typed
 * in, marks it the controlling value by bolding its label AND its field
 * (panel_track_width.cpp:340-392), and derives the other two from it. Ours had
 * made the two widths read-only, so half the calculator was missing.
 */

import { type JSX, useState, type CSSProperties } from 'react';
import {
  COPPER_RESISTIVITY_OHM_M,
  ipc2221CurrentA,
  printfG,
  trackWidth,
} from '@ziroeda/pcb_calculator';
import {
  Field,
  Group,
  LEN_UNITS,
  NumField,
  parseNum,
  ResultField,
  THICK_UNITS,
  type UnitOpt,
} from '../fields.js';
import { useCalcSaveSettings } from '../calc_settings.js';
import { settings, type PcbCalculatorTrackWidth } from '../../../prefs/settings.js';

/** Which of the three inputs is driving the other two. */
type Controlling = 'current' | 'ext' | 'int';

const g = (v: number | undefined | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? printfG(v) : '';

/** The field's number times its selector's scale — KiCad's `GetUnitScale()`. */
const si = (text: string, units: UnitOpt[], idx: number): number =>
  parseNum(text) * (units[idx]?.mult ?? 1);

/**
 * `OnTWResetButtonClick` (panel_track_width.cpp:237-258).
 *
 * The two thicknesses go back to 35 at selector index **1** — µm, the second
 * entry of `UNIT_SELECTOR_THICKNESS` — and both widths to 0.2 mm. Current is
 * set last, which is what makes Current the controlling value again.
 * `m_TWResistivity` is rewritten too even though it is disabled, and the panel
 * saves whatever it then holds.
 */
const TRACK_WIDTH_RESET: PcbCalculatorTrackWidth = {
  current: printfG(1.0),
  delta_tc: printfG(10.0),
  track_len: printfG(20.0),
  track_len_units: 0,
  resistivity: printfG(COPPER_RESISTIVITY_OHM_M),
  ext_track_width: printfG(0.2),
  ext_track_width_units: 0,
  ext_track_thickness: printfG(35.0),
  ext_track_thickness_units: 1,
  int_track_width: printfG(0.2),
  int_track_width_units: 0,
  int_track_thickness: printfG(35.0),
  int_track_thickness_units: 1,
};

export function PanelTrackWidth(): JSX.Element {
  // PANEL_TRACK_WIDTH::LoadSettings / SaveSettings (panel_track_width.cpp).
  const [tw, setTw] = useState<PcbCalculatorTrackWidth>(() => ({
    ...settings.pcbCalculator.track_width,
  }));
  const set = <K extends keyof PcbCalculatorTrackWidth>(
    k: K,
    v: PcbCalculatorTrackWidth[K],
  ): void => setTw((p) => ({ ...p, [k]: v }));
  // `m_TWMode` starts at TW_MASTER_CURRENT (panel_track_width.cpp:52) and is
  // not persisted, so a reopened panel is always driven by the current — and
  // the stored widths are immediately overwritten by the calculation unless the
  // user makes one of them the master again.
  const [controlling, setControlling] = useState<Controlling>('current');

  const resetDefaults = (): void => {
    setTw({ ...TRACK_WIDTH_RESET });
    setControlling('current');
  };

  const lengthM = si(tw.track_len, LEN_UNITS, tw.track_len_units);
  const extThicknessM = si(tw.ext_track_thickness, THICK_UNITS, tw.ext_track_thickness_units);
  const intThicknessM = si(tw.int_track_thickness, THICK_UNITS, tw.int_track_thickness_units);
  const extWidthM = si(tw.ext_track_width, LEN_UNITS, tw.ext_track_width_units);
  const intWidthM = si(tw.int_track_width, LEN_UNITS, tw.int_track_width_units);
  const extScale = LEN_UNITS[tw.ext_track_width_units]?.mult ?? 1e-3;
  const intScale = LEN_UNITS[tw.int_track_width_units]?.mult ?? 1e-3;

  const currentA = Number(tw.current);
  const deltaTC = Number(tw.delta_tc);
  const ok = currentA > 0 && deltaTC > 0 && extThicknessM > 0 && intThicknessM > 0;

  // Whichever value is controlling, resolve the current first, then derive
  // both widths from it — exactly the order KiCad's OnTWCalculate* handlers use.
  let solvedCurrentA = currentA;
  if (ok && controlling === 'ext') {
    solvedCurrentA = ipc2221CurrentA(extWidthM * extThicknessM, deltaTC, true);
  } else if (ok && controlling === 'int') {
    solvedCurrentA = ipc2221CurrentA(intWidthM * intThicknessM, deltaTC, false);
  }

  const ext = ok
    ? trackWidth({ currentA: solvedCurrentA, deltaTC, lengthM, thicknessM: extThicknessM }, true)
    : null;
  const int_ = ok
    ? trackWidth({ currentA: solvedCurrentA, deltaTC, lengthM, thicknessM: intThicknessM }, false)
    : null;

  const shownExtWidthM = controlling === 'ext' ? extWidthM : (ext?.widthM ?? Number.NaN);
  const shownIntWidthM = controlling === 'int' ? intWidthM : (int_?.widthM ?? Number.NaN);
  // `TWDisplayValues` writes `%g` of the value divided by the selector's scale
  // into every field that is not the master (panel_track_width.cpp:262-290).
  const shownExtWidth =
    controlling === 'ext' ? tw.ext_track_width : g((ext?.widthM ?? Number.NaN) / extScale);
  const shownIntWidth =
    controlling === 'int' ? tw.int_track_width : g((int_?.widthM ?? Number.NaN) / intScale);
  const shownCurrent = controlling === 'current' ? tw.current : g(solvedCurrentA);

  // `SaveSettings` is `GetValue()` on each control, so it stores what the panel
  // is *showing* — a derived width included — not only what was typed.
  useCalcSaveSettings((s) => {
    s.track_width = {
      ...tw,
      current: shownCurrent,
      ext_track_width: shownExtWidth,
      int_track_width: shownIntWidth,
      // m_TWResistivity is disabled and always holds copper's value, and
      // SaveSettings reads it back anyway (panel_track_width.cpp).
      resistivity: printfG(COPPER_RESISTIVITY_OHM_M),
    };
  });

  const layerBox = (
    title: string,
    who: Controlling,
    r: ReturnType<typeof trackWidth> | null,
    widthM: number,
    widthText: string,
    widthKey: 'ext_track_width' | 'int_track_width',
    widthUnitKey: 'ext_track_width_units' | 'int_track_width_units',
    thicknessM: number,
    thicknessKey: 'ext_track_thickness' | 'int_track_thickness',
    thicknessUnitKey: 'ext_track_thickness_units' | 'int_track_thickness_units',
    areaM2: number,
    widthScale: number,
  ): JSX.Element => (
    <Group
      title={title}
      className="calc-grid3"
      style={{ '--calc-vgap': '0px' /* [data] wxFlexGridSizer( 4, 3, 0, 0 ) */ } as CSSProperties}
    >
      <NumField
        label="Track width (W):"
        units={LEN_UNITS}
        base={widthM}
        bold={controlling === who}
        text={widthText}
        onText={(t) => {
          set(widthKey, t);
          setControlling(who);
        }}
        unitIdx={tw[widthUnitKey]}
        onUnitIdx={(i) => set(widthUnitKey, i)}
      />
      {/* m_ExtTrackThicknessUnit / m_IntTrackThicknessUnit are
          UNIT_SELECTOR_THICKNESS, not LEN (panel_track_width_base.cpp:123,221):
          six entries ending in oz/ft², and this list spells the micron µm.
          The entry is added wxALL 5 and the selector wxTOP|wxBOTTOM 5, so this
          row alone carries a border above AND below (base:121,123). */}
      <NumField
        className="tw-pad-y"
        label="Track thickness (H):"
        units={THICK_UNITS}
        base={thicknessM}
        text={tw[thicknessKey]}
        onText={(t) => set(thicknessKey, t)}
        unitIdx={tw[thicknessUnitKey]}
        onUnitIdx={(i) => set(thicknessUnitKey, i)}
      />
      {/* m_staticline3/4/5: one wxStaticLine per column, between the two
          entries and the four results (panel_track_width_base.cpp:126-134). */}
      <span className="calc-hline" />
      <span className="calc-hline" />
      <span className="calc-hline" />
      {/* fgSizerTW_Results is wxFlexGridSizer( 0, 3, 0, 0 ) — vgap ZERO — so the
          whole vertical rhythm is each item's own wxTOP/wxBOTTOM 5, and it is
          not uniform (panel_track_width_base.cpp:105-182):
            Track width      no vertical border at all
            Track thickness  wxALL 5           → 5 above, 5 below
            the three rules  wxBOTTOM 5        → 5 below
            Cross-section    wxALL 5           → 5 above, 5 below
            Resistance       wxBOTTOM 5        → 5 below
            Voltage drop     wxBOTTOM 5        → 5 below
            Power loss       wxRIGHT 5 only    → none
          A single row-gap cannot say that, which is why ours read too tight
          once the boxes grew. */}
      {/* `(aExtWidth * aExtThickness) / (extScale * extScale)`, and the unit
          label is `m_TW_ExtTrackWidth_choiceUnit->GetUnitName() + "²"`
          (panel_track_width.cpp:275-303). The area is therefore in the WIDTH
          selector's unit squared, which follows that selector; ours divided by
          a fixed 1e-6 and printed a fixed "mm²", so switching the width to mils
          left the area reading square millimetres of the wrong number. */}
      <ResultField
        className="tw-pad-y"
        label="Cross-section area:"
        value={g(areaM2 / (widthScale * widthScale))}
        unit={`${LEN_UNITS[who === 'ext' ? tw.ext_track_width_units : tw.int_track_width_units]?.label ?? 'mm'}²`}
      />
      <ResultField className="tw-pad-b" label="Resistance:" value={g(r?.resistanceOhm)} unit="Ω" />
      <ResultField className="tw-pad-b" label="Voltage drop:" value={g(r?.voltageDrop)} unit="V" />
      <ResultField label="Power loss:" value={g(r?.powerLossW)} unit="W" />
    </Group>
  );

  return (
    <div className="tw-panel calc-page-body">
      {/* bSizerTrackWidth is HORIZONTAL: a left column holding Parameters and
          then the formula window with proportion 1, and a right column holding
          External above Internal and the Reset button under them
          (panel_track_width_base.cpp:16-21, 83-86, 283-292). Ours put the three
          boxes side by side and the help pane underneath. */}
      <div className="calc-row tw-row">
        <div className="tw-left">
          {/* fgSizerTWprms: wxFlexGridSizer( 4, 3, 0, 0 ). The box spans the
            left column (wxEXPAND) but the GRID inside it is added with
            proportion 0 to a HORIZONTAL static box sizer, so the entries keep
            their own width and the box's right half is empty
            (panel_track_width_base.cpp:22-26, 80). */}
          <Group
            title="Parameters"
            className="calc-grid3 tw-params"
            style={{ '--calc-vgap': '0px' } as CSSProperties}
          >
            <Field
              label="Current (I):"
              value={shownCurrent}
              bold={controlling === 'current'}
              onChange={(v) => {
                set('current', v);
                setControlling('current');
              }}
              unit="A"
            />
            <Field
              label="Temperature rise (ΔT):"
              value={tw.delta_tc}
              onChange={(v) => set('delta_tc', v)}
              unit="°C"
            />
            <NumField
              label="Conductor length:"
              units={LEN_UNITS}
              base={lengthM}
              text={tw.track_len}
              onText={(t) => set('track_len', t)}
              unitIdx={tw.track_len_units}
              onUnitIdx={(i) => set('track_len_units', i)}
            />
            {/* [px] the real field reads `1.72e-08`, i.e. `%g` — String() writes
              `1.72e-8`, one digit short in the exponent. */}
            {/* m_TWResistivity is wxTE_READONLY *and* Enable( false )
              (panel_track_width_base.cpp:70-71), so GTK paints it as a DISABLED
              entry - [px] face rgb(42,42,42) with dim ink - not as the
              3DLIGHT read-only grey the Regulators cells use. */}
            <Field
              label="Copper resistivity:"
              value={printfG(COPPER_RESISTIVITY_OHM_M)}
              readOnly
              disabled
              unit="Ω·m"
            />
          </Group>
          {/* m_htmlWinFormulas, showing
            `tracks_width_versus_current_formula.md`. Carried here line for line.
            It is added STRAIGHT to bSizeLeft with wxEXPAND|wxALL 8 - there is no
            wxStaticBoxSizer round it (panel_track_width_base.cpp:85-86) - so it
            must not be a `.calc-group`, which paints a rule KiCad does not. */}
          <div className="calc-help tw-help">
            <div className="calc-help-body">
              <p>
                If you specify the maximum current, then the track widths will be calculated to
                suit.
              </p>
              <p>
                If you specify one of the track widths, the maximum current it can handle will be
                calculated. The width for the other track to also handle this current will then be
                calculated.
              </p>
              <p>The controlling value is shown in bold.</p>
              <p>
                The calculations are valid for currents up to 35 A (external) or 17.5 A (internal),
                temperature rises up to 100 °C, and widths of up to 400 mils (10 mm).
              </p>
              <p>The formula, from IPC 2221, is</p>
              {/* `<center>___I = K &middot; …___</center>`
                  (tracks_width_versus_current_formula.md:10). `___…___` is
                  markdown for strong AND em, so the line is bold *italic* -
                  every other `___…___` on this page renders <b><i>, and this
                  one had lost the italic. */}
              <p className="calc-formula">
                <i>
                  I = K · ΔT<sup>0.44</sup> · (W · H)<sup>0.725</sup>
                </i>
              </p>
              <p>
                where:
                <br />
                <b>
                  <i>I</i>
                </b>{' '}
                is maximum current in A
                <br />
                <b>
                  <i>ΔT</i>
                </b>{' '}
                is temperature rise above ambient in °C
                <br />
                <b>
                  <i>W</i>
                </b>{' '}
                is width in mils
                <br />
                <b>
                  <i>H</i>
                </b>{' '}
                is thickness (height) in mils
                <br />
                <b>
                  <i>K</i>
                </b>{' '}
                is 0.024 for internal tracks or 0.048 for external tracks
              </p>
            </div>
          </div>
        </div>
        <div className="tw-right">
          {layerBox(
            'External Layer Tracks',
            'ext',
            ext,
            shownExtWidthM,
            shownExtWidth,
            'ext_track_width',
            'ext_track_width_units',
            extThicknessM,
            'ext_track_thickness',
            'ext_track_thickness_units',
            shownExtWidthM * extThicknessM,
            extScale,
          )}
          {layerBox(
            'Internal Layer Tracks',
            'int',
            int_,
            shownIntWidthM,
            shownIntWidth,
            'int_track_width',
            'int_track_width_units',
            intThicknessM,
            'int_track_thickness',
            'int_track_thickness_units',
            shownIntWidthM * intThicknessM,
            intScale,
          )}
          {/* m_buttonTrackWidthReset, wxALIGN_RIGHT|wxALL 5 — the last child of
            the RIGHT column (panel_track_width_base.cpp:288-289). */}
          <div className="calc-reset-row">
            <button type="button" className="calc-btn" onClick={resetDefaults}>
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
