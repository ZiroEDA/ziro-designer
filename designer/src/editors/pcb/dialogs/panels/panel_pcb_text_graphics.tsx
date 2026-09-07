// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Text & Graphics > Defaults. Counterparts:
 * `pcbnew/dialogs/panel_setup_text_and_graphics_base.cpp` (the layer-class grid,
 * "Default Properties for New Graphics and Text") and
 * `pcbnew/dialogs/panel_setup_dimensions_base.cpp` ("Default Properties for New
 * Dimension Objects"), which KiCad stacks on the same Defaults page.
 *
 * The grid rows are layer classes (Silk / Copper / Edge Cuts / Courtyards / Fab /
 * Other). Edge Cuts and Courtyards are graphics-only, so their Text Width/Height/
 * Thickness/Italic/Keep-Upright cells are blank and disabled, as upstream.
 *
 * Both headings carry a `wxStaticLine` under them
 * (`panel_setup_text_and_graphics_base.cpp:27`,
 * `panel_setup_dimensions_base.cpp:24`), which is `.ze-pref-group-title`; ours
 * drew bare 12.5px text with no rule at all. The dimension block is ONE
 * `wxGridBagSizer( 0, 5 )` six columns wide, not two side-by-side grids, which
 * is why upstream's "Text position:" lines up with "Units:" and its arrow-length
 * entry lines up with the Precision choice. No SetFont anywhere in either panel.
 */

import type { JSX } from 'react';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { Combo } from '../../../../ui/Combo.js';
import { parseUnitValueDouble, stringFromValue } from '../../../../ui/unit_binder.js';
import type { DimensionDefaults, TextGfxDefaults, TextGfxRow } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultTextGraphics,
  type DimensionDefaults,
  type TextGfxDefaults,
  type TextGfxRow,
} from '../../board_settings.js';

// Row labels + whether the row carries text (Edge Cuts / Courtyards do not).
const ROWS: { label: string; text: boolean }[] = [
  { label: 'Silk Layers', text: true },
  { label: 'Copper Layers', text: true },
  { label: 'Edge Cuts', text: false },
  { label: 'Courtyards', text: false },
  { label: 'Fab Layers', text: true },
  { label: 'Other Layers', text: true },
];

// Dimension choice lists (panel_setup_dimensions_base.cpp).
const DIM_UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'];
const DIM_FORMATS = ['1234', '1234 mm', '1234 (mm)'];
const DIM_PRECISION = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'];
const DIM_POSITION = ['Outside', 'Inline'];

interface Props {
  value: TextGfxDefaults;
  onChange: (next: TextGfxDefaults) => void;
}

// Text columns (blank for graphics-only rows); Line Thickness is always shown.
/** Column keys, for the <colgroup> widths above. */
const COL_KEYS = ['line', 'w', 'h', 'th', 'italic', 'upright'] as const;

const TEXT_COLS: { label: string; key: 'textWidth' | 'textHeight' | 'textThickness' }[] = [
  { label: 'Text Width', key: 'textWidth' },
  { label: 'Text Height', key: 'textHeight' },
  { label: 'Text Thickness', key: 'textThickness' },
];

export function PanelPcbTextGraphics({ value, onChange }: Props): JSX.Element {
  // `StringFromValue( …, true )` / `ValueFromString` — a wxGrid numeric cell's
  // text carries its unit, which is why the column labels do not.
  const show = (v: number): string => stringFromValue(v, 'mm', true, pcbIUScale);
  const num = (s: string): number => parseUnitValueDouble(s, 'mm');
  const setCell = (i: number, patch: Partial<TextGfxRow>): void =>
    onChange({ ...value, rows: value.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setDim = <K extends keyof DimensionDefaults>(k: K, val: DimensionDefaults[K]): void =>
    onChange({ ...value, dimensions: { ...value.dimensions, [k]: val } });
  const d = value.dimensions;

  // Graphics-only cells: no gridlines + the outside-table grey, so Edge Cuts /
  // Courtyards read as one blank block like KiCad (not empty bordered cells).
  const blankCell: React.CSSProperties = { border: 'none', background: 'var(--chrome-bg)' };

  return (
    <div className="ze-pref-page-natural">
      {/* PANEL_SETUP_TEXT_AND_GRAPHICS */}
      <div className="ze-pref-group-title">Default Properties for New Graphics and Text</div>
      <div className="ze-grid-pane ze-tg-grid-pane" style={{ maxHeight: '48vh' }}>
        <table className="ze-grid" style={{ whiteSpace: 'nowrap' }}>
          {/* [data] `SetColSize` 140/140/140/140/80/120
              (`panel_setup_text_and_graphics_base.cpp:46-51`). The row-label
              column is the grid's own and takes what its labels need. This
              table had NO column widths and `width: 100%`, so every column
              stretched to its header — and the headers were the invented
              "Line Thickness (mm)" form, which is the longest string on the
              page. Between them they made the dialog ~260 px too wide. */}
          <colgroup>
            <col />
            {[140, 140, 140, 140, 80, 120].map((w, i) => (
              <col key={COL_KEYS[i]} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0 }} />
              {/* `SetColLabelValue` carries NO unit: upstream puts the unit in
                  each CELL, via `StringFromValue( …, true )`. */}
              <th>Line Thickness</th>
              {TEXT_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Italic</th>
              <th>Keep Upright</th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((r, i) => {
              const hasText = ROWS[i]!.text;
              return (
                <tr key={i}>
                  <th
                    style={{ textAlign: 'left', padding: '0 8px', background: 'var(--chrome-bg2)' }}
                  >
                    {ROWS[i]!.label}
                  </th>
                  <td>
                    <input
                      type="text"
                      value={show(r.lineThickness)}
                      onChange={(e) => setCell(i, { lineThickness: num(e.target.value) })}
                    />
                  </td>
                  {TEXT_COLS.map((c) => (
                    <td key={c.key} style={hasText ? undefined : blankCell}>
                      {hasText ? (
                        <input
                          type="text"
                          value={show(r[c.key])}
                          onChange={(e) => setCell(i, { [c.key]: num(e.target.value) })}
                        />
                      ) : null}
                    </td>
                  ))}
                  <td
                    style={
                      hasText ? { textAlign: 'center' } : { ...blankCell, textAlign: 'center' }
                    }
                  >
                    {hasText && (
                      <input
                        type="checkbox"
                        checked={r.italic}
                        onChange={(e) => setCell(i, { italic: e.target.checked })}
                      />
                    )}
                  </td>
                  <td
                    style={
                      hasText ? { textAlign: 'center' } : { ...blankCell, textAlign: 'center' }
                    }
                  >
                    {hasText && (
                      <input
                        type="checkbox"
                        checked={r.keepUpright}
                        onChange={(e) => setCell(i, { keepUpright: e.target.checked })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PANEL_SETUP_DIMENSIONS — one `wxGridBagSizer( 0, 5 )`, six columns
          wide, whose right half starts at column 3. */}
      <div className="ze-pref-group-title ze-tg-dimtitle">
        Default Properties for New Dimension Objects
      </div>
      <div className="ze-tg-dimgrid">
        {/* Row 0 */}
        <span>Units:</span>
        <Combo
          value={d.units}
          ariaLabel="Dimension units"
          options={DIM_UNITS.map((u) => ({ value: u, label: u }))}
          onChange={(u) => setDim('units', u)}
        />
        {/* (0,2) is an empty spacer cell upstream. */}
        <span />
        <span className="ze-tg-dimright">Text position:</span>
        <Combo
          value={d.textPosition}
          ariaLabel="Dimension text position"
          options={DIM_POSITION.map((x) => ({ value: x, label: x }))}
          onChange={(x) => setDim('textPosition', x)}
        />
        <span />

        {/* Row 1 */}
        <span>Units format:</span>
        <Combo
          value={d.format}
          ariaLabel="Dimension units format"
          options={DIM_FORMATS.map((f) => ({ value: f, label: f }))}
          onChange={(f) => setDim('format', f)}
        />
        <span />
        <label className="ze-pref-check ze-tg-dimright ze-tg-span2">
          <input
            type="checkbox"
            checked={d.keepTextAligned}
            onChange={(e) => setDim('keepTextAligned', e.target.checked)}
          />
          Keep text aligned
        </label>
        <span />

        {/* Row 2 */}
        <span>Precision:</span>
        <Combo
          value={d.precision}
          ariaLabel="Dimension precision"
          options={DIM_PRECISION.map((x) => ({ value: x, label: x }))}
          onChange={(x) => setDim('precision', x)}
        />
        <span />
        <span className="ze-tg-dimright">Arrow length:</span>
        <input
          className="ze-search"
          value={d.arrowLengthMM}
          onChange={(e) => setDim('arrowLengthMM', num(e.target.value))}
        />
        <span className="unit">mm</span>

        {/* Row 3 */}
        <label className="ze-pref-check ze-tg-span2">
          <input
            type="checkbox"
            checked={d.suppressTrailingZeroes}
            onChange={(e) => setDim('suppressTrailingZeroes', e.target.checked)}
          />
          Suppress trailing zeroes
        </label>
        <span />
        <span className="ze-tg-dimright">Extension line offset:</span>
        <input
          className="ze-search"
          value={d.extLineOffsetMM}
          onChange={(e) => setDim('extLineOffsetMM', num(e.target.value))}
        />
        <span className="unit">mm</span>
      </div>
    </div>
  );
}
