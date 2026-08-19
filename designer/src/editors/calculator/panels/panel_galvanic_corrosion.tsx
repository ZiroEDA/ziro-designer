// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Galvanic Corrosion" memo panel, anodic-index difference matrix.
 * Counterpart: KiCad `calculator_panels/panel_galvanic_corrosion.cpp`.
 *
 * The table is in MILLIVOLTS, printed `%.0f`, and its cell colours carry the
 * information: a pair whose |difference| is at or below the threshold takes the
 * flat `color_ok` blue, and one above it fades along a blue or an orange ramp by
 * `226 - round(|diff| * 99)` (lines 361-388). Equal metals are a fixed light
 * blue. `Material names:` switches the row and column labels between chemical
 * symbols and full names; the threshold field is in mV and defaults to 0.
 */

import { type JSX, useState } from 'react';
import { CORROSION_METALS, corrosionSignedDeltaV } from '@ziroeda/pcb_calculator';
import { parseNum } from '../fields.js';

/** `color_ok`, panel_galvanic_corrosion.cpp:320. */
const COLOR_OK = 'rgb(122, 166, 194)';
/** The equal-potential cell, line 370. */
const COLOR_SAME = 'rgb(193, 231, 255)';

/** `getContrastingTextColour`: KiCad picks black or white off the luminance. */
const ink = (r: number, g: number, b: number): string =>
  0.299 * r + 0.587 * g + 0.114 * b > 128 ? '#000000' : '#ffffff';

function cellStyle(diffV: number, thresholdMv: number): { background: string; color: string } {
  const diffTemp = Math.round(Math.abs(diffV * 99));
  if (Math.abs(diffV) === 0) return { background: COLOR_SAME, color: ink(193, 231, 255) };
  if (Math.round(Math.abs(diffV * 1000)) > thresholdMv) {
    const [r, g, b] =
      diffV > 0
        ? [226 - diffTemp, 226 - diffTemp, 246 - diffTemp]
        : [255 - diffTemp, 222 - diffTemp, 199 - diffTemp];
    return { background: `rgb(${r}, ${g}, ${b})`, color: ink(r, g, b) };
  }
  return { background: COLOR_OK, color: ink(122, 166, 194) };
}

export function PanelGalvanicCorrosion(): JSX.Element {
  // pcb_calculator_settings.cpp:292 — the threshold defaults to "0".
  const [threshold, setThreshold] = useState('0');
  const [symbolic, setSymbolic] = useState(true);
  const thresholdMv = Number.isFinite(parseNum(threshold)) ? parseNum(threshold) : 0;
  const label = (m: (typeof CORROSION_METALS)[number]): string => (symbolic ? m.symbol : m.name);

  return (
    <div className="gc-panel">
      <div className="gc-scroll">
        <table className="calc-table gc-table">
          <thead>
            <tr>
              <th className="rowhead" />
              {CORROSION_METALS.map((m) => (
                <th key={m.name} className="gc-colhead">
                  <span>{label(m)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORROSION_METALS.map((row, i) => (
              <tr key={row.name}>
                <th className="rowhead">{label(row)}</th>
                {CORROSION_METALS.map((col, j) => {
                  const dv = corrosionSignedDeltaV(i, j);
                  return (
                    <td key={col.name} style={cellStyle(dv, thresholdMv)}>
                      {(dv * 1000).toFixed(0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="calc-field">
        <span>Threshold voltage:</span>
        <input
          className="calc-input"
          style={{ width: 70 }}
          value={threshold}
          spellCheck={false}
          onChange={(e) => setThreshold(e.target.value)}
        />
        <span className="calc-unit">mV</span>
      </div>

      <div className="calc-field">
        <span>Material names:</span>
        <label className="calc-radio">
          <input
            type="radio"
            name="gc-names"
            checked={symbolic}
            onChange={() => setSymbolic(true)}
          />
          Chemical symbols
        </label>
        <label className="calc-radio">
          <input
            type="radio"
            name="gc-names"
            checked={!symbolic}
            onChange={() => setSymbolic(false)}
          />
          Names
        </label>
      </div>
    </div>
  );
}
