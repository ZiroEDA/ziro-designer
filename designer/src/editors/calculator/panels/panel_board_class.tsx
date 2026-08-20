// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Board Classes" memo panel, typical fabrication limits per class.
 * Counterpart: KiCad `calculator_panels/panel_board_class.cpp` +
 * `panel_board_class_base.cpp`.
 *
 * `bSizerBoardClass` is wxHORIZONTAL (base:12): the UNIT_SELECTOR_LEN is a
 * column of its OWN on the left, and everything else — the note, the grid and
 * an empty filler panel — is the right column. Ours stacked the selector above
 * the grid, which put the grid's left edge where KiCad puts the selector.
 *
 * Missing values are the two-character `--` (`NO_VALUE`) and present ones go
 * through `%g` (panel_board_class.cpp:130-135).
 */

import { BOARD_CLASS_COUNT, BOARD_CLASS_ROWS, printfG } from '@ziroeda/pcb_calculator';
import { type JSX, useState } from 'react';
import { Combo } from '../../../ui/Combo.js';
import { LEN_UNITS } from '../fields.js';

export function PanelBoardClass(): JSX.Element {
  const [unitIdx, setUnitIdx] = useState(0);
  /** `m_BoardClassesUnitsSelector->GetUnitScale()`, a scale in METRES, and the
   *  table's own values are metres too (`0.8*UNIT_MM`). */
  const scale = LEN_UNITS[unitIdx]?.mult ?? 1e-3;
  const conv = (mm: number): string => (Number.isNaN(mm) ? '--' : printfG((mm * 1e-3) / scale));

  return (
    <div className="bc-panel">
      {/* bSizerUnitsMargins: the selector alone in a vertical sizer, its own
          wxTOP|wxBOTTOM|wxRIGHT 32, and the sizer added wxLEFT 10 (base:17-19).
          [px] that puts KiCad's selector at x 246..311, y 59..90 — level with
          the grid's column-label strip rather than above the grid. */}
      <div className="bc-units">
        <Combo
          ariaLabel="Unit"
          value={String(unitIdx)}
          options={LEN_UNITS.map((u, i) => ({ value: String(i), label: u.label }))}
          onChange={(v) => setUnitIdx(Number(v))}
        />
      </div>
      <div className="bc-right">
        {/* m_staticTextBrdClass: bold ITALIC, and `wxALL|wxALIGN_CENTER_HORIZONTAL`
            (base:31) — centred in the right column, not right-aligned against
            the page as ours was. [px] KiCad's ink runs x 987..1208, centre 1097,
            against a right column running 340..1843 whose centre is 1091. */}
        <div className="bc-note">Note: Values are minimal values</div>
        <table className="calc-table bc-grid">
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
        {/* m_panelShowClassPrms, an empty wxPanel added proportion 1 wxEXPAND
            (base:73). It draws nothing; it exists to take the slack, which is
            what keeps the grid pinned to the top of the column. */}
        <div className="bc-filler" />
      </div>
    </div>
  );
}
