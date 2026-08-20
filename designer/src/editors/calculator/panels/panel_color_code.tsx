// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Color Code" memo panel, resistor band encoder + reference chart.
 * Counterpart: KiCad `calculator_panels/panel_color_code.cpp`.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  DIGIT_COLORS,
  MULTIPLIER_COLORS,
  TEMPCO_COLORS,
  TOLERANCE_COLORS,
  colorCode,
} from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';
import { Field, Group, fmt, parseNum } from '../fields.js';

/**
 * KiCad's Color Code page is a CHART, not a calculator: a `Tolerance` radio box
 * and six columns of coloured cells drawn as bitmaps
 * (`BITMAPS::color_code_value_and_name` and friends,
 * panel_color_code.cpp:43-50). The 4th Band column appears only for the
 * `<= 2%` selection, which is the 5-band part (`ToleranceSelection`, line 76).
 */
const BAND_ROWS: { name: string; css: string; digit?: number; mult: string; tol?: string }[] = [
  { name: 'Black', css: '#000000', digit: 0, mult: 'x    1' },
  { name: 'Brown', css: '#8b4513', digit: 1, mult: 'x   10', tol: '± 1%' },
  { name: 'Red', css: '#d40000', digit: 2, mult: 'x  100', tol: '± 2%' },
  { name: 'Orange', css: '#ff7f00', digit: 3, mult: 'x   1k' },
  { name: 'Yellow', css: '#f2d500', digit: 4, mult: 'x  10k' },
  { name: 'Green', css: '#00a651', digit: 5, mult: 'x 100k', tol: '± 0.5%' },
  { name: 'Blue', css: '#0072bc', digit: 6, mult: 'x   1M', tol: '± 0.25%' },
  { name: 'Violet', css: '#92278f', digit: 7, mult: 'x  10M', tol: '± 0.10%' },
  { name: 'Gray', css: '#808080', digit: 8, mult: 'x 100M', tol: '± 0.05%' },
  { name: 'White', css: '#ffffff', digit: 9, mult: 'x   1G' },
  { name: 'Gold', css: '#cfa227', mult: 'x  0.1', tol: '±    5%' },
  { name: 'Silver', css: '#c0c0c0', mult: 'x 0.01', tol: '± 10%' },
];

/** KiCad draws each cell's text in black or white against its own fill. */
const bandInk = (css: string): string => {
  const n = Number.parseInt(css.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 128 ? '#000000' : '#ffffff';
};

function BandColumn({
  title,
  render,
  rows,
}: {
  title: string;
  render: (row: (typeof BAND_ROWS)[number]) => string;
  rows: typeof BAND_ROWS;
}): JSX.Element {
  return (
    <div className="cc-col">
      <div className="cc-colhead">{title}</div>
      <div className="cc-cells">
        {rows.map((row) => (
          <div
            key={row.name}
            className="cc-cell"
            style={{ background: row.css, color: bandInk(row.css) }}
          >
            {render(row)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ColorCodeChart(): JSX.Element {
  // m_rbToleranceSelection: "10% / 5%" is index 0 and hides the 4th band.
  const [tol2, setTol2] = useState(false);
  const digitRows = BAND_ROWS.filter((r) => r.digit !== undefined);
  return (
    <div className="cc-chart">
      <Group title="Tolerance" className="cc-tolbox">
        <label className="calc-radio">
          <input type="radio" name="cc-tol" checked={!tol2} onChange={() => setTol2(false)} />
          10% / 5%
        </label>
        <label className="calc-radio">
          <input type="radio" name="cc-tol" checked={tol2} onChange={() => setTol2(true)} />
          &lt;= 2%
        </label>
      </Group>
      <BandColumn
        title="1st Band"
        rows={BAND_ROWS}
        render={(r) => (r.digit === undefined ? r.name : `${r.name}   ${r.digit}`)}
      />
      <BandColumn title="2nd Band" rows={digitRows} render={(r) => String(r.digit)} />
      <BandColumn title="3rd Band" rows={digitRows} render={(r) => String(r.digit)} />
      {tol2 && <BandColumn title="4th Band" rows={digitRows} render={(r) => String(r.digit)} />}
      <BandColumn title="Multiplier" rows={BAND_ROWS} render={(r) => r.mult} />
      <BandColumn title="Tolerance" rows={BAND_ROWS} render={(r) => r.tol ?? ''} />
    </div>
  );
}

export function PanelColorCode(): JSX.Element {
  const [value, setValue] = useState('4700');
  const [tolerance, setTolerance] = useState(5);
  const [bands, setBands] = useState<4 | 5 | 6>(4);
  const [tempco, setTempco] = useState(100);

  const r = useMemo(
    () => colorCode(parseNum(value), tolerance, bands, tempco),
    [value, tolerance, bands, tempco],
  );

  const allBands = r.error
    ? []
    : [
        ...r.digits,
        r.multiplier,
        ...(r.tolerance ? [r.tolerance] : []),
        ...(r.tempco ? [r.tempco] : []),
      ];

  return (
    <div>
      <ColorCodeChart />
      {/* SUPERSET, not in pcb_calculator 10.0.5: an encoder that turns a
          resistance into its band sequence. KiCad's page is the chart alone. */}
      <Group title="Resistor">
        <Field label="Resistance:" value={value} onChange={setValue} unit="Ω" />
        <div className="calc-field">
          <span className="calc-field-label">Tolerance:</span>
          <Combo
            value={String(tolerance)}
            options={TOLERANCE_COLORS.map((t) => ({
              value: String(t.pct),
              label: `±${t.pct} % (${t.name})`,
            }))}
            onChange={(v) => setTolerance(Number(v))}
          />
        </div>
        <div className="calc-field">
          <span className="calc-field-label">Bands:</span>
          <label className="calc-radio">
            <input
              type="radio"
              name="cc-bands"
              checked={bands === 4}
              onChange={() => setBands(4)}
            />
            4 band (2 digits)
          </label>
          <label className="calc-radio">
            <input
              type="radio"
              name="cc-bands"
              checked={bands === 5}
              onChange={() => setBands(5)}
            />
            5 band (3 digits)
          </label>
          <label className="calc-radio">
            <input
              type="radio"
              name="cc-bands"
              checked={bands === 6}
              onChange={() => setBands(6)}
            />
            6 band (+ tempco)
          </label>
        </div>
        {bands === 6 && (
          <div className="calc-field">
            <span className="calc-field-label">Temp. coefficient:</span>
            <Combo
              value={String(tempco)}
              options={TEMPCO_COLORS.map((t) => ({
                value: String(t.ppm),
                label: `${t.ppm} ppm/K (${t.name})`,
              }))}
              onChange={(v) => setTempco(Number(v))}
            />
          </div>
        )}
      </Group>

      {r.error ? (
        <div className="calc-error">{r.error}</div>
      ) : (
        <>
          <div className="cc-resistor" data-testid="cc-bands">
            {allBands.map((b, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <span key={i} className="cc-band" style={{ background: b.css }} title={b.name} />
            ))}
          </div>
          <div className="calc-note">
            {allBands.map((b) => b.name).join(', ')} → encodes {fmt(r.encodedOhms, 6)} Ω ±
            {tolerance} %
          </div>
        </>
      )}

      <Group title="Chart">
        <table className="calc-table">
          <thead>
            <tr>
              <th>Color</th>
              <th>Digit</th>
              <th>Multiplier</th>
              <th>Tolerance</th>
            </tr>
          </thead>
          <tbody>
            {MULTIPLIER_COLORS.map((m) => {
              const digit = DIGIT_COLORS.findIndex((d) => d.name === m.name);
              const tol = TOLERANCE_COLORS.find((t) => t.name === m.name);
              return (
                <tr key={m.name}>
                  <td className="rowhead">
                    <span
                      style={{
                        display: 'inline-block',
                        width: 12,
                        height: 12,
                        background: m.css,
                        border: '1px solid #333',
                        marginRight: 6,
                        verticalAlign: 'middle',
                      }}
                    />
                    {m.name}
                  </td>
                  <td>{digit >= 0 ? digit : ''}</td>
                  <td>×10{m.exp === 0 ? '⁰' : sup(m.exp)}</td>
                  <td>{tol ? `±${tol.pct} %` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Group>
    </div>
  );
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sup(n: number): string {
  const neg = n < 0 ? '⁻' : '';
  return (
    neg +
    String(Math.abs(n))
      .split('')
      .map((c) => SUP[Number(c)])
      .join('')
  );
}
