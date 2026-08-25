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
import {
  CORROSION_METALS,
  corrosionCellColour,
  corrosionInk,
  corrosionSignedDeltaV,
} from '@ziroeda/pcb_calculator';
import { useCalcSaveSettings } from '../calc_settings.js';
import { settings } from '../../../prefs/settings.js';
import { parseNum } from '../fields.js';

/**
 * The fills and the ink both live in the engine now, beside the potential
 * table, because both are behaviour and neither was pinned by anything: the
 * BT.601-vs-BT.709 ink bug moved ZERO existing expectations when it was fixed.
 * See `qa/unittests/pcb_calculator/memo.test.ts`.
 */
function cellStyle(diffV: number, thresholdMv: number): { background: string; color: string } {
  const [r, g, b] = corrosionCellColour(diffV, thresholdMv);
  return { background: `rgb(${r}, ${g}, ${b})`, color: corrosionInk(r, g, b) };
}

export function PanelGalvanicCorrosion(): JSX.Element {
  // PANEL_GALVANIC_CORROSION::LoadSettings / SaveSettings —
  // `m_CorrosionTable.threshold_voltage` (a string, default "0") and
  // `.show_symbols` (panel_galvanic_corrosion.cpp).
  const [threshold, setThreshold] = useState(
    () => settings.pcbCalculator.corrosion_table.threshold_voltage,
  );
  const [symbolic, setSymbolic] = useState(
    () => settings.pcbCalculator.corrosion_table.show_symbols,
  );
  useCalcSaveSettings((s) => {
    s.corrosion_table.threshold_voltage = threshold;
    s.corrosion_table.show_symbols = symbolic;
  });
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

      {/* m_helpText, an HTML_WINDOW with SetMinSize( 400, 110 ), added
          proportion 0 wxALL|wxEXPAND 5 BETWEEN the grid and the bottom row
          (base:41-43). Its five lines are galvanic_corrosion_help.md, one
          paragraph broken by <br>. The page had none of it. */}
      <div className="calc-help-body gc-help">
        <p>
          This table shows the difference in electrochemical potential between various metals and
          alloys. Galvanic corrosion affects different metals in contact and under certain
          conditions.
          <br />
          The anode of an electrochemical pair gets oxidized and eaten away, while the cathode gets
          dissolved metals plated onto it but stays protected.
          <br />A positive number indicates that the row is anodic (-) and the column is cathodic
          (+), cold and warm coloring hues also indicate rows' potential.
          <br />
          EN 50310 suggests a voltage difference below 300mV. Known practices make use of a third
          interface metal in between the main pair(ie the ENIG surface finish).
          <br />
          Selected cells shown with the default system's coloring choice after a table refill.
        </p>
      </div>

      {/* bSizerBottom, wxHORIZONTAL (base:44): the threshold group, a VERTICAL
          wxStaticLine, and the material-names group, all on one row. Ours had
          them as two stacked rows with no separator between them. */}
      <div className="gc-bottom">
        <div className="calc-field gc-voltage">
          <span>Threshold voltage:</span>
          <input
            className="calc-input gc-threshold"
            value={threshold}
            spellCheck={false}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <span className="calc-unit">mV</span>
        </div>
        {/* m_staticline, wxLI_VERTICAL, wxEXPAND|wxRIGHT|wxLEFT 10 (base:68). */}
        <div className="gc-rule" />
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
    </div>
  );
}
