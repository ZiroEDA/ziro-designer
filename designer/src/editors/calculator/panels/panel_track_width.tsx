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

import { type JSX, useState } from 'react';
import {
  COPPER_RESISTIVITY_OHM_M,
  ipc2221CurrentA,
  printfG,
  trackWidth,
} from '@ziroeda/pcb_calculator';
import { Field, Group, LEN_UNITS, NumField, ResultField } from '../fields.js';

/** Which of the three inputs is driving the other two. */
type Controlling = 'current' | 'ext' | 'int';

const g = (v: number | undefined | null): string =>
  typeof v === 'number' && Number.isFinite(v) ? printfG(v) : '';

export function PanelTrackWidth(): JSX.Element {
  // pcb_calculator_settings.cpp:184-220 — "1.0", "10.0", "20" mm, 35 µm both.
  const [current, setCurrent] = useState('1.0');
  const [deltaT, setDeltaT] = useState('10.0');
  const [lengthM, setLengthM] = useState(20e-3);
  const [extThicknessM, setExtThicknessM] = useState(35e-6);
  const [intThicknessM, setIntThicknessM] = useState(35e-6);
  const [extWidthM, setExtWidthM] = useState(0.2e-3);
  const [intWidthM, setIntWidthM] = useState(0.2e-3);
  const [controlling, setControlling] = useState<Controlling>('current');

  const currentA = Number(current);
  const deltaTC = Number(deltaT);
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
  const shownCurrent = controlling === 'current' ? current : g(solvedCurrentA);

  const layerBox = (
    title: string,
    who: Controlling,
    r: ReturnType<typeof trackWidth> | null,
    widthM: number,
    setWidthM: (v: number) => void,
    thicknessM: number,
    setThicknessM: (v: number) => void,
    areaM2: number,
  ): JSX.Element => (
    <Group title={title}>
      <NumField
        label="Track width (W):"
        units={LEN_UNITS}
        defaultUnit="mm"
        base={widthM}
        bold={controlling === who}
        onBase={(v) => {
          setWidthM(v);
          setControlling(who);
        }}
      />
      <NumField
        label="Track thickness (H):"
        units={LEN_UNITS}
        defaultUnit="µm"
        base={thicknessM}
        onBase={setThicknessM}
      />
      <ResultField label="Cross-section area:" value={g(areaM2 * 1e6)} unit="mm²" />
      <ResultField label="Resistance:" value={g(r?.resistanceOhm)} unit="Ω" />
      <ResultField label="Voltage drop:" value={g(r?.voltageDrop)} unit="V" />
      <ResultField label="Power loss:" value={g(r?.powerLossW)} unit="W" />
    </Group>
  );

  return (
    <div className="tw-panel">
      <div className="calc-row">
        <Group title="Parameters">
          <Field
            label="Current (I):"
            value={shownCurrent}
            bold={controlling === 'current'}
            onChange={(v) => {
              setCurrent(v);
              setControlling('current');
            }}
            unit="A"
          />
          <Field label="Temperature rise (ΔT):" value={deltaT} onChange={setDeltaT} unit="°C" />
          <NumField
            label="Conductor length:"
            units={LEN_UNITS}
            defaultUnit="mm"
            base={lengthM}
            onBase={setLengthM}
          />
          {/* [px] the real field reads `1.72e-08`, i.e. `%g` — String() writes
              `1.72e-8`, one digit short in the exponent. */}
          <Field
            label="Copper resistivity:"
            value={printfG(COPPER_RESISTIVITY_OHM_M)}
            readOnly
            unit="Ω·m"
          />
        </Group>
        {layerBox(
          'External Layer Tracks',
          'ext',
          ext,
          shownExtWidthM,
          setExtWidthM,
          extThicknessM,
          setExtThicknessM,
          shownExtWidthM * extThicknessM,
        )}
        {layerBox(
          'Internal Layer Tracks',
          'int',
          int_,
          shownIntWidthM,
          setIntWidthM,
          intThicknessM,
          setIntThicknessM,
          shownIntWidthM * intThicknessM,
        )}
      </div>

      {/* sbSizerTW_Help's HTML_WINDOW, showing
          `tracks_width_versus_current_formula.md`. Carried here line for line. */}
      <fieldset className="calc-group tw-help">
        <div className="rc-help-body">
          <p>
            If you specify the maximum current, then the track widths will be calculated to suit.
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
          <p className="calc-formula">
            I = K · ΔT<sup>0.44</sup> · (W · H)<sup>0.725</sup>
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
      </fieldset>
    </div>
  );
}
