/**
 * "Resistor Calculator" panel, approximate a required value with 2 to 4
 * E-series resistors (series "+" / parallel "|").
 * Counterpart: KiCad `calculator_panels/panel_r_calculator.cpp`.
 *
 * Inputs are in kΩ; the required value (and up to two more) are excluded from
 * the search, and the Simple/3R/4R solutions are computed on Calculate.
 */

import { useState, type JSX } from 'react';
import {
  ESERIES,
  ESeriesId,
  RES_EQUIV_FIRST_VALUE,
  RES_EQUIV_LAST_VALUE,
  type Resistance,
  resEquivCalc,
} from '@ziroeda/pcb_calculator';
import { parseNum } from '../fields.js';

// The resistor calculator offers only the coarser series (E1…E24).
const R_SERIES = ESERIES.filter((e) => e.id <= ESeriesId.E24);

// KiCad accepts targets a bit beyond the series span (panel_r_calculator.cpp).
const MIN_TARGET = RES_EQUIV_FIRST_VALUE / 4;
const MAX_TARGET = RES_EQUIV_LAST_VALUE * 4;

interface SolutionRow {
  formula: string;
  approxPct: string;
}
interface Solutions {
  simple: SolutionRow;
  r3: SolutionRow;
  r4: SolutionRow;
}

const emptyRow = (): SolutionRow => ({ formula: '', approxPct: '' });

// Mirrors KiCad's showResult: absent level → "Not worth using"; error text is
// "Exact", "<0.01" or a signed percentage with two decimals.
const rowOf = (s: Resistance | undefined, targetOhm: number): SolutionRow => {
  if (!s) return { formula: 'Not worth using', approxPct: '' };
  const errorPct = (s.value / targetOhm - 1) * 100;
  let approxPct: string;
  if (Math.abs(errorPct) < 1e-12) approxPct = 'Exact';
  else if (Math.abs(errorPct) < 0.01) approxPct = '<0.01';
  else approxPct = `${errorPct >= 0 ? '+' : ''}${errorPct.toFixed(2)}`;
  return { formula: s.name, approxPct };
};

export function PanelRCalculator(): JSX.Element {
  const [required, setRequired] = useState(''); // kΩ
  const [exclude1, setExclude1] = useState('');
  const [exclude2, setExclude2] = useState('');
  const [serie, setSerie] = useState<ESeriesId>(ESeriesId.E6);
  const [sol, setSol] = useState<Solutions | null>(null);
  const [error, setError] = useState('');

  const calculate = (): void => {
    setError('');
    setSol(null);
    const targetOhm = parseNum(required) * 1000;
    if (Number.isNaN(targetOhm) || targetOhm < MIN_TARGET || targetOhm > MAX_TARGET) {
      setError(`Incorrect required resistance value: ${required}`);
      return;
    }
    // As in KiCad: the required value itself is excluded (it needs replacing
    // precisely because it is not available), plus up to two entered values.
    const excl = [targetOhm, parseNum(exclude1) * 1000, parseNum(exclude2) * 1000];
    const res = resEquivCalc(targetOhm, serie, excl);
    if (!res) {
      setError('No solution in range (10 Ω … 1 MΩ).');
      return;
    }
    setSol({
      simple: rowOf(res.s2r, targetOhm),
      r3: rowOf(res.s3r, targetOhm),
      r4: rowOf(res.s4r, targetOhm),
    });
  };

  const solutionRow = (label: string, row: SolutionRow): JSX.Element => (
    <div className="calc-field">
      <span className="calc-field-label" style={{ minWidth: 100 }}>
        {label}
      </span>
      <input
        className="calc-input ro"
        readOnly
        style={{ flex: 1, fontFamily: 'monospace' }}
        value={row.formula}
      />
      <span className="calc-unit" style={{ minWidth: 92 }}>
        Approximation:
      </span>
      <input className="calc-input ro" readOnly style={{ width: 70 }} value={row.approxPct} />
      <span className="calc-unit">%</span>
    </div>
  );

  const shown = sol ?? { simple: emptyRow(), r3: emptyRow(), r4: emptyRow() };

  return (
    <div>
      <div className="calc-row">
        <fieldset className="calc-group" style={{ minWidth: 340 }}>
          <legend>Inputs</legend>
          <label className="calc-field">
            <span className="calc-field-label">Required resistance:</span>
            <input
              className="calc-input"
              value={required}
              spellCheck={false}
              onChange={(e) => setRequired(e.target.value)}
            />
            <span className="calc-unit">kΩ</span>
          </label>
          <label className="calc-field">
            <span className="calc-field-label">Exclude value 1:</span>
            <input
              className="calc-input"
              value={exclude1}
              spellCheck={false}
              onChange={(e) => setExclude1(e.target.value)}
            />
            <span className="calc-unit">kΩ</span>
          </label>
          <label className="calc-field">
            <span className="calc-field-label">Exclude value 2:</span>
            <input
              className="calc-input"
              value={exclude2}
              spellCheck={false}
              onChange={(e) => setExclude2(e.target.value)}
            />
            <span className="calc-unit">kΩ</span>
          </label>
          <div className="calc-field" style={{ marginTop: 6 }}>
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
          <div style={{ marginTop: 8 }}>
            <button type="button" className="calc-btn primary" onClick={calculate}>
              Calculate
            </button>
          </div>
        </fieldset>

        <fieldset className="calc-group" style={{ flex: 1 }}>
          <legend>Solutions</legend>
          {solutionRow('Simple solution:', shown.simple)}
          {solutionRow('3R solution:', shown.r3)}
          {solutionRow('4R solution:', shown.r4)}
          {error && <div className="calc-error">{error}</div>}
        </fieldset>
      </div>

      <fieldset className="calc-group">
        <legend>Help</legend>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            Finds combinations of standard E-series resistors (10 Ω … 1 MΩ) for an arbitrary value.
          </li>
          <li>Enter the required resistance in kΩ; solutions use up to 4 components.</li>
          <li>
            The required value is always excluded; up to two more can be excluded for availability.
          </li>
        </ul>
        <div className="calc-note" style={{ marginTop: 8 }}>
          Formats: <code>R1 + R2</code> resistors in series · <code>R1 | R2</code> in parallel ·{' '}
          <code>R1 + (R2 | R3)</code> any combination.
        </div>
      </fieldset>
    </div>
  );
}
