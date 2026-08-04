// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table properties.
 * Counterpart: `pcbnew/dialogs/dialog_table_properties.cpp`.
 *
 * The decisions live in `pcbnew/src/table_properties.ts`; this is layout.
 *
 * The cell grid shows the table as it appears on the board, which on a back
 * layer means the columns are mirrored — the engine maps display columns to
 * stored ones, so this file only ever indexes `cellText[row][col]` in display
 * order and never has to know.
 *
 * Left out: KiCad's per-cell font and alignment controls, which live in the
 * separate cell dialog, and its row/column insert and delete buttons — those
 * change the grid's shape rather than its contents.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { TableValues } from '@ziroeda/pcbnew/src/table_properties.js';
import type { StrokeType } from '@ziroeda/pcbnew/src/types.js';

const STROKE_STYLES: StrokeType[] = ['solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'];

interface Props {
  initial: TableValues;
  layers: readonly string[];
  onApply: (v: TableValues) => void;
  onClose: () => void;
}

export function DialogTableProperties({ initial, layers, onApply, onClose }: Props): JSX.Element {
  const [v, setV] = useState<TableValues>(initial);
  const [text, setText] = useState<Record<string, string>>({});
  const set = (patch: Partial<TableValues>): void => setV((p) => ({ ...p, ...patch }));

  const setCell = (row: number, col: number, value: string): void =>
    setV((p) => ({
      ...p,
      cellText: p.cellText.map((line, r) =>
        r === row ? line.map((cur, c) => (c === col ? value : cur)) : line,
      ),
    }));

  const mmField = (label: string, key: 'borderWidth' | 'separatorWidth'): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={text[key] ?? String(pcbIuToMM(v[key]))}
        onChange={(e) => {
          setText((p) => ({ ...p, [key]: e.target.value }));
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<TableValues>);
        }}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  const check = (
    label: string,
    key: 'locked' | 'borderExternal' | 'borderHeader' | 'separatorRows' | 'separatorCols',
  ): JSX.Element => (
    <label>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<TableValues>)}
      />
      {label}
    </label>
  );

  const styleSelect = (label: string, key: 'borderStyle' | 'separatorStyle'): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <select
        className="ze-tvp-select"
        value={v[key]}
        onChange={(e) => set({ [key]: e.target.value as StrokeType } as Partial<TableValues>)}
      >
        {STROKE_STYLES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-graphic-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Table Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Table</legend>
            <label>
              <span className="ze-tvp-label">Layer:</span>
              <select
                className="ze-tvp-select"
                value={v.layer}
                onChange={(e) => set({ layer: e.target.value })}
              >
                {layers.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {check('Locked', 'locked')}
          </fieldset>

          <fieldset>
            <legend>Cells</legend>
            {/* Display order: on a back layer the engine has already mirrored
                the columns, so row/col here are what the user sees. */}
            <table className="ze-table-grid">
              <tbody>
                {v.cellText.map((line, row) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the grid is
                  // fixed-shape; rows have no identity beyond their position.
                  <tr key={row}>
                    {line.map((cellValue, col) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                      <td key={col}>
                        <input
                          type="text"
                          className="ze-tvp-input"
                          value={cellValue}
                          onChange={(e) => setCell(row, col, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>

          <fieldset>
            <legend>Border</legend>
            {check('External border', 'borderExternal')}
            {check('Header separator', 'borderHeader')}
            {mmField('Width:', 'borderWidth')}
            {styleSelect('Style:', 'borderStyle')}
          </fieldset>

          <fieldset>
            <legend>Separators</legend>
            {check('Row separators', 'separatorRows')}
            {check('Column separators', 'separatorCols')}
            {mmField('Width:', 'separatorWidth')}
            {styleSelect('Style:', 'separatorStyle')}
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onApply(v)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
