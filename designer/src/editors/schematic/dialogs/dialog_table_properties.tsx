// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table properties. Counterpart: `DIALOG_TABLE_PROPERTIES`
 * (eeschema/dialogs/dialog_table_properties.cpp).
 *
 * The decisions live in `eeschema/src/tools/sch_table_properties.ts` — which
 * controls are live, what a switched-off line stores, how a stored style maps
 * to the combo — so this file is layout.
 *
 * Cancel means *discard*, not "leave it as it was", when the table has just
 * been drawn: `DrawTable` ends with `else { delete table; }`. The caller
 * decides which of the two this is; the dialog only reports the choice.
 *
 * Left out: KiCad's Scintilla cell editor with text-variable auto-complete, and
 * the merged-cell shading (a cell with a zero span is drawn as a colour block
 * and made read-only). Neither changes what the dialog produces.
 */

import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  borderControlsEnabled,
  separatorControlsEnabled,
  TABLE_STROKE_STYLES,
  type SchTableValues,
  type TableColor,
  type TableStrokeStyle,
} from '@ziroeda/eeschema/src/tools/sch_table_properties.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/** The combo's labels, in `lineTypeNames` order. */
const STYLE_LABELS: Record<TableStrokeStyle, string> = {
  solid: 'Solid',
  dash: 'Dashed',
  dot: 'Dotted',
  dash_dot: 'Dash-Dot',
  dash_dot_dot: 'Dash-Dot-Dot',
};

const hex = (c: TableColor | undefined): string =>
  c
    ? `#${[c[0], c[1], c[2]].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
    : '#ffffff';

const fromHex = (s: string): TableColor => [
  Number.parseInt(s.slice(1, 3), 16),
  Number.parseInt(s.slice(3, 5), 16),
  Number.parseInt(s.slice(5, 7), 16),
  1,
];

interface Props {
  initial: SchTableValues;
  /**
   * The table's own column widths, in IU.
   *
   * `sizeGridToTable` scales the cell grid to the table's shape, so a column
   * that is twice as wide on the sheet is twice as wide here:
   *
   *     double scalerX = availableGridSize.x / tableBBox.GetWidth();
   *     … m_grid->SetColSize( col, m_table->GetColWidth( col ) * scalerX );
   *
   * We keep the proportion but not the scaling down: upstream's dialog is
   * resizable, so a squeezed column can be widened; ours would leave you typing
   * into a two-pixel box. Below `MIN_CELL_PX` the grid stops shrinking and
   * scrolls instead.
   */
  columnWidths?: readonly number[];
  /** Shown on the OK button's sibling: a new table is discarded, not reverted. */
  isNew?: boolean;
  onOk: (v: SchTableValues) => void;
  onCancel: () => void;
}

/** Narrowest a cell may get before the grid scrolls rather than squeezing. */
const MIN_CELL_PX = 130;
/** How much of the dialog the cell grid may take before it scrolls. */
const GRID_MAX_PX = 300;

export function DialogTableProperties({
  initial,
  columnWidths,
  isNew,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [v, setV] = useState<SchTableValues>(initial);
  // The width fields are held as text while they are being typed, so a half
  // typed "0." is not rounded away under the cursor.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const set = (patch: Partial<SchTableValues>): void => setV((p) => ({ ...p, ...patch }));

  const setCell = (row: number, col: number, value: string): void =>
    setV((p) => ({
      ...p,
      cellText: p.cellText.map((line, r) =>
        r === row ? line.map((cur, c) => (c === col ? value : cur)) : line,
      ),
    }));

  // Column widths in pixels: upstream's proportions, floored so every cell stays
  // wide enough to type in. The grid then scrolls in both directions rather
  // than compressing forty columns into the dialog's width.
  const cols = v.cellText[0]?.length ?? 1;
  const cellPx = ((): number[] => {
    const widths = columnWidths?.length === cols ? columnWidths : null;
    if (!widths) return Array.from({ length: cols }, () => MIN_CELL_PX);
    const total = widths.reduce((a, b) => a + b, 0) || 1;
    return widths.map((w) => Math.max(MIN_CELL_PX, Math.round((w / total) * cols * MIN_CELL_PX)));
  })();

  const borderOn = borderControlsEnabled(v);
  const sepOn = separatorControlsEnabled(v);

  const widthField = (key: 'borderWidth' | 'separatorWidth', enabled: boolean): JSX.Element => (
    <label className="row" style={{ flex: '0 0 auto' }}>
      <span style={{ width: 44 }}>Width:</span>
      <input
        type="text"
        className="ze-input"
        style={{ width: 76 }}
        disabled={!enabled}
        value={typed[key] ?? String(iuToMM(v[key]))}
        onChange={(e) => {
          setTyped((p) => ({ ...p, [key]: e.target.value }));
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: mmToIU(n) } as Partial<SchTableValues>);
        }}
        onBlur={() => setTyped((p) => ({ ...p, [key]: undefined as unknown as string }))}
      />
      <span className="ze-muted" style={{ width: 'auto' }}>
        mm
      </span>
    </label>
  );

  const styleField = (key: 'borderStyle' | 'separatorStyle', enabled: boolean): JSX.Element => (
    <label className="row" style={{ flex: '0 0 auto' }}>
      <span style={{ width: 44 }}>Style:</span>
      <select
        className="ze-input"
        style={{ width: 170 }}
        disabled={!enabled}
        value={v[key]}
        onChange={(e) =>
          set({ [key]: e.target.value as TableStrokeStyle } as Partial<SchTableValues>)
        }
      >
        {TABLE_STROKE_STYLES.map((s) => (
          <option key={s} value={s}>
            {STYLE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );

  const colorField = (key: 'borderColor' | 'separatorColor', enabled: boolean): JSX.Element => (
    <label className="row" style={{ flex: '0 0 auto' }}>
      <span style={{ width: 44 }}>Color:</span>
      <input
        type="color"
        disabled={!enabled}
        value={hex(v[key])}
        onChange={(e) => set({ [key]: fromHex(e.target.value) } as Partial<SchTableValues>)}
      />
      {/* An unset colour is KiCad's COLOR4D::UNSPECIFIED: draw it in the
          layer's own colour. The swatch has no way to express that, so the
          button is how you get back to it. */}
      <button
        type="button"
        className="ze-btn"
        disabled={!enabled || !v[key]}
        onClick={() => set({ [key]: undefined } as Partial<SchTableValues>)}
        title="Use the schematic's own colour for this line"
      >
        Default
      </button>
    </label>
  );

  const checkbox = (
    label: string,
    key: 'borderExternal' | 'borderHeader' | 'separatorRows' | 'separatorCols',
  ): JSX.Element => (
    <label className="row" style={{ flex: '0 0 auto' }}>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<SchTableValues>)}
      />
      <span style={{ width: 'auto' }}>{label}</span>
    </label>
  );

  /**
   * One group of line controls, laid out as the grid-bag sizer lays them out:
   * the two checkboxes share a row, then Width and Color share the next, then
   * Style. Stacking each control on its own row — which is what this did — made
   * the dialog taller than it has any need to be.
   */
  const lineGroup = (
    legend: string,
    boxes: JSX.Element,
    widthKey: 'borderWidth' | 'separatorWidth',
    colorKey: 'borderColor' | 'separatorColor',
    styleKey: 'borderStyle' | 'separatorStyle',
    enabled: boolean,
  ): JSX.Element => (
    <fieldset style={{ flex: '1 1 0', minWidth: 0 }}>
      <legend>{legend}</legend>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>{boxes}</div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 6 }}>
        {widthField(widthKey, enabled)}
        {colorField(colorKey, enabled)}
      </div>
      <div style={{ marginTop: 6 }}>{styleField(styleKey, enabled)}</div>
    </fieldset>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      {/* Wide, and only as tall as it needs to be: `.ze-modal` is 860x580 by
          default, which for this dialog meant a narrow box with the cell grid
          squeezed into it. The grid is the only thing that scrolls. */}
      <div
        className="ze-modal ze-label-dialog"
        style={{ width: 1080, maxWidth: '96vw', height: 'auto', maxHeight: '88vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Table Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div
          className="ze-label-dialog-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minHeight: 0,
            // The body itself never scrolls; the cell grid does.
            overflow: 'hidden',
          }}
        >
          {/* `minWidth: 0` on both the fieldset and the scroller: without it a
              flex child is sized by its content, the scroll box grows to the
              full width of the grid, and the overflow escapes to the dialog
              instead of scrolling inside. */}
          <fieldset style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
            <legend>Cell contents</legend>
            {/* The one scroller in the dialog, in both directions.
                `width: max-content` is what makes that work: a table told to be
                100% wide never overflows, it just divides the dialog between
                however many columns there are, and forty columns leaves each
                one too narrow to type into. */}
            <div
              style={{
                maxHeight: GRID_MAX_PX,
                overflow: 'auto',
                minHeight: 0,
                minWidth: 0,
                width: '100%',
              }}
            >
              <table className="ze-props-grid" style={{ width: 'max-content' }}>
                <tbody>
                  {v.cellText.map((line, row) => (
                    <tr key={`row${row}`}>
                      {/* The grid is fixed-shape: a cell has no identity
                          beyond its position, so the position is the key. */}
                      {line.map((cellValue, col) => (
                        <td key={`col${col}`} style={{ width: cellPx[col] ?? MIN_CELL_PX }}>
                          <input
                            type="text"
                            className="ze-input"
                            style={{ width: cellPx[col] ?? MIN_CELL_PX, boxSizing: 'border-box' }}
                            value={cellValue}
                            onChange={(e) => setCell(row, col, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>

          {/* Border and Separators side by side: upstream lays both groups out
              in one grid-bag sizer, four rows tall, not two stacked panels. */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {lineGroup(
              'Border',
              <>
                {checkbox('External border', 'borderExternal')}
                {checkbox('Header border', 'borderHeader')}
              </>,
              'borderWidth',
              'borderColor',
              'borderStyle',
              borderOn,
            )}
            {lineGroup(
              'Separators',
              <>
                {checkbox('Row lines', 'separatorRows')}
                {checkbox('Column lines', 'separatorCols')}
              </>,
              'separatorWidth',
              'separatorColor',
              'separatorStyle',
              sepOn,
            )}
          </div>
        </div>

        <div className="ze-modal-footer">
          <button
            type="button"
            className="ze-btn"
            onClick={onCancel}
            title={isNew ? 'Discard the table' : undefined}
          >
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={() => onOk(v)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
