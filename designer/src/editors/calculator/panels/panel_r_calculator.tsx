// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Resistor Calculator" panel, approximate a required value with 2 to 4
 * E-series resistors (series "+" / parallel "|").
 * Counterpart: KiCad `calculator_panels/panel_r_calculator.cpp` and its
 * wxFormBuilder base `panel_r_calculator_base.cpp`.
 *
 * The layout is that base file's, not an approximation of it: a fixed-width
 * "Inputs" box holding a 4x3 grid, a wxStaticLine and the E-series radio row;
 * a growing "Solutions" box holding a 6x5 grid, a wxStaticLine and the
 * Calculate button (which lives in SOLUTIONS, not in Inputs); and a "Help" box
 * below carrying `r_calculator_help.md` verbatim.
 */

import { type JSX, useState } from 'react';
import {
  ESERIES,
  ESeriesId,
  RES_EQUIV_FIRST_VALUE,
  RES_EQUIV_LAST_VALUE,
  RES_NOT_WORTH_USING,
  type Resistance,
  resApproximationText,
  resEquivCalc,
} from '@ziroeda/pcb_calculator';
import { MessageDialogOk } from '../../../ui/dialog_message.js';
import { parseNum } from '../fields.js';

// The resistor calculator offers only the coarser series (E1…E24).
const R_SERIES = ESERIES.filter((e) => e.id <= ESeriesId.E24);

// KiCad accepts targets a bit beyond the series span (panel_r_calculator.cpp:43).
const MIN_TARGET = RES_EQUIV_FIRST_VALUE / 4;
const MAX_TARGET = RES_EQUIV_LAST_VALUE * 4;

interface SolutionRow {
  formula: string;
  approxPct: string;
}

const emptyRow = (): SolutionRow => ({ formula: '', approxPct: '' });

// PANEL_R_CALCULATOR::OnCalculateESeries' showResult lambda
// (panel_r_calculator.cpp:136-162): an absent level reads "Not worth using"
// with an EMPTY error cell; otherwise "Exact", "<0.01" or a signed "%+.2f".
const rowOf = (s: Resistance | undefined, targetOhm: number): SolutionRow => {
  if (!s) return { formula: RES_NOT_WORTH_USING, approxPct: '' };
  return {
    formula: s.name,
    approxPct: resApproximationText((s.value / targetOhm - 1) * 100),
  };
};

export function PanelRCalculator(): JSX.Element {
  const [required, setRequired] = useState(''); // kΩ
  const [exclude1, setExclude1] = useState('');
  const [exclude2, setExclude2] = useState('');
  const [serie, setSerie] = useState<ESeriesId>(ESeriesId.E6);
  const [simple, setSimple] = useState<SolutionRow>(emptyRow);
  const [r3, setR3] = useState<SolutionRow>(emptyRow);
  const [r4, setR4] = useState<SolutionRow>(emptyRow);
  const [notice, setNotice] = useState('');

  const calculate = (): void => {
    const targetOhm = parseNum(required) * 1000;
    if (Number.isNaN(targetOhm) || targetOhm < MIN_TARGET || targetOhm > MAX_TARGET) {
      // wxMessageBox, not an inline label (panel_r_calculator.cpp:108).
      setNotice(`Incorrect required resistance value: ${required}`);
      return;
    }
    // As in KiCad: the required value itself is excluded (it needs replacing
    // precisely because it is not available), plus up to two entered values.
    const excl = [targetOhm, parseNum(exclude1) * 1000, parseNum(exclude2) * 1000];
    const res = resEquivCalc(targetOhm, serie, excl);
    if (!res) {
      setNotice(`Incorrect required resistance value: ${required}`);
      return;
    }
    setSimple(rowOf(res.s2r, targetOhm));
    setR3(rowOf(res.s3r, targetOhm));
    setR4(rowOf(res.s4r, targetOhm));
  };

  // One row of fgSizerESeriesResults: label | solution | "Approximation:" |
  // error | "%". The two field widths are wxFormBuilder's:
  // [px] the solution field runs x=679..1645 (it expands) off a 200 px minimum,
  // and the error field x=1770..1823, i.e. 54 px — which is
  // GetTextExtent( "XX" + "Exact" ) and is why a "+100.00" reads as "+100." on
  // screen in the real application too.
  const solutionRow = (label: string, row: SolutionRow): JSX.Element => (
    <>
      <span>{label}</span>
      <input className="calc-input ro rc-solution" readOnly value={row.formula} />
      <span className="rc-approx-label">Approximation:</span>
      <input className="calc-input ro rc-approx" readOnly value={row.approxPct} />
      <span>%</span>
    </>
  );

  const inputRow = (label: string, value: string, onChange: (v: string) => void): JSX.Element => (
    <>
      <span>{label}</span>
      <input
        className="calc-input rc-value"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <span>kΩ</span>
    </>
  );

  return (
    <div className="rc-panel">
      <div className="calc-row rc-middle">
        <fieldset className="calc-group rc-inputs">
          <legend>Inputs</legend>
          <div className="rc-input-grid">
            {inputRow('Required resistance:', required, setRequired)}
            {inputRow('Exclude value 1:', exclude1, setExclude1)}
            {inputRow('Exclude value 2:', exclude2, setExclude2)}
          </div>
          <hr className="calc-hr" />
          <div className="rc-series">
            {R_SERIES.map((e) => (
              <label key={e.id} className="calc-radio">
                <input
                  type="radio"
                  name="rcalc-serie"
                  checked={serie === e.id}
                  onChange={() => setSerie(e.id)}
                />
                {e.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="calc-group rc-solutions">
          <legend>Solutions</legend>
          <div className="rc-solution-grid">
            {solutionRow('Simple solution:', simple)}
            {solutionRow('3R solution:', r3)}
            {solutionRow('4R solution:', r4)}
          </div>
          <hr className="calc-hr" />
          {/* m_buttonEScalculate belongs to sbSizerESeriesSolutions
              (panel_r_calculator_base.cpp:168-169), not to Inputs. */}
          <button type="button" className="calc-btn" onClick={calculate}>
            Calculate
          </button>
        </fieldset>
      </div>

      {/* sbLowerSizerEseriesHelp holds an HTML_WINDOW showing
          `r_calculator_help.md` through ConvertMarkdown2Html. The text below is
          that file, line for line. */}
      <fieldset className="calc-group rc-help">
        <legend>Help</legend>
        <div className="rc-help-body">
          <ul>
            <li>
              This calculator finds combinations of standard E-series (between 10Ω and 1MΩ) to
              create arbitrary values.
            </li>
            <li>You can enter the required resistance from 0.0025 to 4000 kΩ.</li>
            <li>Solutions using up to 4 components are given.</li>
          </ul>
          <p>
            The requested value is always excluded from the solution set.
            <br />
            Optionally up to two additional values can be excluded in case of component availability
            problems.
          </p>
          <p>Solutions are given in the following formats:</p>
          <pre>
            {'R1 + R2 +...+ Rn\tresistors in series\n' +
              'R1 | R2 |...| Rn\tresistors in parallel\n' +
              'R1 + (R2|R3)...\t\tany combination of the above'}
          </pre>
        </div>
      </fieldset>

      {notice && <MessageDialogOk message={notice} onClose={() => setNotice('')} />}
    </div>
  );
}
