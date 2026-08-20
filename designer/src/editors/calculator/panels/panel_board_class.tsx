// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Board Classes" memo panel, typical fabrication limits per class.
 * Counterpart: KiCad `calculator_panels/panel_board_class.cpp`.
 *
 * A `UNIT_SELECTOR_LEN` with no label, a bold-italic right-aligned note, and a
 * read-only wxGrid whose row labels are the parameter names. Missing values are
 * the two-character `--` (`NO_VALUE`, panel_board_class.cpp:130) and present
 * ones go through `%g`.
 */

import { type JSX, useState } from 'react';
import { BOARD_CLASS_COUNT, BOARD_CLASS_ROWS, printfG } from '@ziroeda/pcb_calculator';
import { Combo } from '../../../ui/Combo.js';

// UNIT_SELECTOR_LEN again — the same five entries, opening on mm.
const UNITS = [
  { label: 'mm', scale: 1 },
  { label: 'um', scale: 1e-3 },
  { label: 'cm', scale: 10 },
  { label: 'mil', scale: 25.4e-3 },
  { label: 'inch', scale: 25.4 },
];

export function PanelBoardClass(): JSX.Element {
  const [unitIdx, setUnitIdx] = useState(0);
  const scale = UNITS[unitIdx]?.scale ?? 1;
  const conv = (mm: number): string => (Number.isNaN(mm) ? '--' : printfG(mm / scale));

  return (
    <div className="bc-panel">
      <div className="bc-top">
        <Combo
          ariaLabel="Unit"
          style={{ minWidth: 78 }}
          value={String(unitIdx)}
          options={UNITS.map((u, i) => ({ value: String(i), label: u.label }))}
          onChange={(v) => setUnitIdx(Number(v))}
        />
        {/* m_staticTextBrdClass: bold italic, wxALIGN_RIGHT
            (panel_board_class_base.cpp:33). */}
        <div className="bc-note">Note: Values are minimal values</div>
      </div>
      <table className="calc-table">
        <thead>
          <tr>
            {/* A wxGrid's corner cell carries no text. */}
            <th className="rowhead" />
            {Array.from({ length: BOARD_CLASS_COUNT }, (_, i) => (
              <th key={`c${i + 1}`}>Class {i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD_CLASS_ROWS.map((row) => (
            <tr key={row.label}>
              <th className="rowhead">{row.label}</th>
              {row.mm.map((v, i) => (
                <td key={`${row.label}-${i}`}>{conv(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
