// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Fusing Current" panel, copper track fuse designer. Pick the unknown
 * (width, thickness, current or time to fuse) with the radio, fill the rest,
 * and Calculate. Counterpart: KiCad `calculator_panels/panel_fusing_current.cpp`.
 */

import { useState, type JSX } from 'react';
import { type FusingSolveFor, fusingCurrent, printfF } from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { Field, LEN_UNITS, THICK_UNITS, type UnitOpt, parseNum } from '../fields.js';

/** Radio + numeric input + length-unit dropdown (value held in metres). */
function LenRow({
  label,
  solveFor,
  active,
  onActive,
  text,
  onText,
  unitIdx,
  setUnitIdx,
  units,
}: {
  label: string;
  solveFor: FusingSolveFor;
  active: FusingSolveFor;
  onActive: (s: FusingSolveFor) => void;
  text: string;
  onText: (v: string) => void;
  unitIdx: number;
  setUnitIdx: (i: number) => void;
  /** m_widthUnit is a UNIT_SELECTOR_LEN and m_thicknessUnit a
   *  UNIT_SELECTOR_THICKNESS (panel_fusing_current_base.cpp:38,53) — two
   *  different lists, where we had filtered one down to mm/µm/mil. */
  units: UnitOpt[];
}): JSX.Element {
  return (
    <>
      <input
        type="radio"
        name="fuse-solve"
        checked={active === solveFor}
        onChange={() => onActive(solveFor)}
      />
      <span className="calc-field-label">{label}</span>
      {/* Not read-only: KiCad's four value fields are plain wxTextCtrls and the
          solved one is simply overwritten (panel_fusing_current.cpp:162-199). */}
      <input
        className="calc-input"
        value={text}
        spellCheck={false}
        onChange={(e) => onText(e.target.value)}
      />
      <Combo
        style={{ minWidth: 62 }}
        value={String(unitIdx)}
        options={units.map((u, i) => ({ value: String(i), label: u.label }))}
        onChange={(v) => setUnitIdx(Number(v))}
      />
    </>
  );
}

/** Radio + numeric input + fixed unit text. */
function NumRow({
  label,
  solveFor,
  active,
  onActive,
  value,
  onValue,
  unit,
}: {
  label: string;
  solveFor: FusingSolveFor;
  active: FusingSolveFor;
  onActive: (s: FusingSolveFor) => void;
  value: string;
  onValue: (v: string) => void;
  unit: string;
}): JSX.Element {
  return (
    <>
      <input
        type="radio"
        name="fuse-solve"
        checked={active === solveFor}
        onChange={() => onActive(solveFor)}
      />
      <span className="calc-field-label">{label}</span>
      <input
        className="calc-input"
        value={value}
        spellCheck={false}
        onChange={(e) => onValue(e.target.value)}
      />
      <span className="calc-unit">{unit}</span>
    </>
  );
}

export function PanelFusingCurrent(): JSX.Element {
  const [ambient, setAmbient] = useState('25');
  const [melting, setMelting] = useState('1084'); // copper
  // The panel's state IS the text in the fields, as it is in wx. That matters
  // here: KiCad re-reads the ROUNDED "%f" string on the next Calculate, so
  // solving for width and then back for current gives 10.000029 A, not 10 A.
  // Holding a full-precision number instead hides that feedback.
  const [width, setWidth] = useState(printfF(0.1));
  const [widthUnit, setWidthUnit] = useState(0);
  const [thickness, setThickness] = useState(printfF(0.035));
  const [thicknessUnit, setThicknessUnit] = useState(0);
  // panel_fusing_current.cpp:47-53 — the two temperatures with "%i" and the
  // four values with "%f"; and the first radio of the group, Track width, is
  // the one wx selects (the base file marks none of the four).
  const [current, setCurrent] = useState(printfF(10));
  const [time, setTime] = useState(printfF(0.01));
  const [solveFor, setSolveFor] = useState<FusingSolveFor>('width');
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');

  const calculate = (): void => {
    setError('');
    setComment('');
    const widthM = parseNum(width) * (LEN_UNITS[widthUnit]?.mult ?? 1e-3);
    const thicknessM = parseNum(thickness) * (THICK_UNITS[thicknessUnit]?.mult ?? 1e-3);
    const r = fusingCurrent({
      ambientC: parseNum(ambient),
      meltingC: parseNum(melting),
      widthM,
      thicknessM,
      currentA: parseNum(current),
      timeS: parseNum(time),
      solveFor,
    });
    if (r.error) {
      // KiCad writes the literal string "Error" into the field it was solving
      // for and shows nothing else (panel_fusing_current.cpp:166,179,191,203).
      if (solveFor === 'current') setCurrent('Error');
      else if (solveFor === 'time') setTime('Error');
      else if (solveFor === 'width') setWidth('Error');
      else setThickness('Error');
      setError('');
      return;
    }
    setComment(r.comment ?? '');
    if (solveFor === 'width') setWidth(printfF(r.widthM / (LEN_UNITS[widthUnit]?.mult ?? 1e-3)));
    else if (solveFor === 'thickness')
      setThickness(printfF(r.thicknessM / (THICK_UNITS[thicknessUnit]?.mult ?? 1e-3)));
    else if (solveFor === 'current') setCurrent(printfF(r.currentA));
    else setTime(printfF(r.timeS));
  };

  return (
    <div className="calc-page-body">
      {/* fgSizer11: wxFlexGridSizer( 0, 4, 0, 0 ) - radio | label | entry | unit.
          The two rows that have no radio put an EMPTY static text (m_dummy1,
          m_dummy2) in the first column, which is why every label on the page
          starts at the same x whether or not its row is selectable
          (panel_fusing_current_base.cpp:22-29, 46). Ours were independent rows,
          so the plain labels sat at x=246 and the radio ones at 279. */}
      <div className="fc-grid">
        <span />
        <span className="calc-field-label">Ambient temperature:</span>
        <input
          className="calc-input"
          value={ambient}
          spellCheck={false}
          onChange={(e) => setAmbient(e.target.value)}
        />
        <span className="calc-unit">°C</span>

        <span />
        <span className="calc-field-label" title="Copper">
          Melting point:
        </span>
        <input
          className="calc-input"
          value={melting}
          spellCheck={false}
          onChange={(e) => setMelting(e.target.value)}
        />
        <span className="calc-unit">°C</span>

        <LenRow
          label="Track width:"
          solveFor="width"
          active={solveFor}
          onActive={setSolveFor}
          text={width}
          onText={setWidth}
          unitIdx={widthUnit}
          setUnitIdx={setWidthUnit}
          units={LEN_UNITS}
        />
        <LenRow
          label="Track thickness:"
          solveFor="thickness"
          active={solveFor}
          onActive={setSolveFor}
          text={thickness}
          onText={setThickness}
          unitIdx={thicknessUnit}
          setUnitIdx={setThicknessUnit}
          units={THICK_UNITS}
        />
        <NumRow
          label="Current:"
          solveFor="current"
          active={solveFor}
          onActive={setSolveFor}
          value={current}
          onValue={setCurrent}
          unit="A"
        />
        <NumRow
          label="Time to fuse:"
          solveFor="time"
          active={solveFor}
          onActive={setSolveFor}
          value={time}
          onValue={setTime}
          unit="s"
        />
      </div>
      {/* bSizer3: the button with wxBOTTOM|wxRIGHT|wxLEFT 5 inside a sizer
          added with wxTOP|wxBOTTOM 10 (base:126-133). */}
      <div style={{ margin: '10px 0' /* [data] bSizer3's wxTOP|wxBOTTOM 10 */, paddingLeft: 5 }}>
        <button type="button" className="calc-btn" onClick={calculate}>
          Calculate
        </button>
        {error && <div className="calc-error">{error}</div>}
        {comment && <div className="calc-note">{comment}</div>}
      </div>

      {/* m_helpSizer's HTML_WINDOW, showing `fusing_current_help.md`. */}
      <fieldset className="calc-group calc-help fc-help">
        <legend>Help</legend>
        <div className="calc-help-body">
          <p>
            You can use this calculator to check if a small track can handle a large current for a
            short period of time.
            <br />
            This tool allows you to design a track fuse but should be used as an estimate only.
          </p>
          <p>
            The calculator estimates the energy required to heat the wire up
            <br />
            to its melting point as well as the energy required for the change of phase.
            <br />
            This energy is then compared to the one dissipated by the wire resistance.
          </p>
        </div>
      </fieldset>
    </div>
  );
}
