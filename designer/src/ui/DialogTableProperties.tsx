// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table properties, for both editors.
 * Counterparts: `DIALOG_TABLE_PROPERTIES` in
 * `eeschema/dialogs/dialog_table_properties.cpp` and in
 * `pcbnew/dialogs/dialog_table_properties.cpp`.
 *
 * **Upstream these are two dialogs**, one per editor, over two unrelated item
 * classes (`SCH_TABLE : SCH_ITEM`, `PCB_TABLE : BOARD_ITEM_CONTAINER`) — and
 * they had grown apart here in the way two copies do: the board's had invented
 * four groupboxes, stacked them in one narrow column so the cell grid became a
 * single file of unusable inputs, and called the checkboxes "Header separator",
 * "Row separators" and "Column separators" where both upstream dialogs say
 * "Header border", "Row lines" and "Column lines". This is Akshay's call, made
 * with both on screen: one dialog, the schematic one, which was the good one.
 *
 * What actually differs between the two editors is small and is passed in:
 *
 *  - the **IU scale**, because a schematic internal unit is not a board one;
 *  - the board's **Layer** and **Locked** controls, which a schematic table has
 *    no equivalent of (`header`);
 *  - the schematic's **stroke colours**, which a board table takes from its
 *    layer (`renderColor`);
 *  - which controls a switched-off line greys out (`borderEnabled` /
 *    `separatorEnabled`), which is `sch_table_properties.ts`'s rule.
 *
 * Left out, as before: KiCad's Scintilla cell editor with text-variable
 * auto-complete, and the merged-cell shading (a cell with a zero span is drawn
 * as a colour block and made read-only). Neither changes what the dialog
 * produces.
 *
 * Cancel means *discard*, not "leave it as it was", when the table has just
 * been drawn: `DrawTable` ends with `else { delete table; }`. The caller decides
 * which of the two this is; the dialog only reports the choice.
 */

import { useState, type JSX, type ReactNode } from 'react';
import type { EdaIuScale } from '@ziroeda/common/src/eda_units.js';
import { LINE_STYLE_NAMES } from '@ziroeda/common/src/stroke_params.js';
import { Combo } from './Combo.js';
import { StdDialogButtons } from './StdDialogButtons.js';
import { useModalEscape } from './useModalEscape.js';

/**
 * The fields both editors' value objects carry, which is everything this dialog
 * edits on its own. Each editor's own type (`SchTableValues`, pcbnew's
 * `TableValues`) satisfies it structurally and keeps whatever else it needs.
 */
export interface SharedTableValues {
  cellText: readonly (readonly string[])[];
  borderExternal: boolean;
  borderHeader: boolean;
  /** In IU, through the caller's scale. */
  borderWidth: number;
  borderStyle: string;
  separatorRows: boolean;
  separatorCols: boolean;
  separatorWidth: number;
  separatorStyle: string;
}

export type WidthKey = 'borderWidth' | 'separatorWidth';
export type StyleKey = 'borderStyle' | 'separatorStyle';
export type ColorKey = 'borderColor' | 'separatorColor';

export interface DialogTablePropertiesProps<T extends SharedTableValues> {
  initial: T;
  /** `pcbIUScale` or `schIUScale` — the width fields are millimetres either way. */
  iuScale: EdaIuScale;
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
  /** Shown on Cancel's tooltip: a new table is discarded, not reverted. */
  isNew?: boolean;
  /**
   * Controls above the cell grid that belong to one editor only — the board's
   * Layer selector and Locked checkbox (`m_LayerSelectionCtrl`, `m_cbLocked`).
   * A schematic table has neither.
   */
  header?: (v: T, set: (patch: Partial<T>) => void) => ReactNode;
  /**
   * The stroke colour control, when the editor models one. eeschema's
   * `SCH_TABLE` carries a colour per stroke; a `PCB_TABLE` takes its layer's.
   */
  renderColor?: (
    key: ColorKey,
    enabled: boolean,
    v: T,
    set: (patch: Partial<T>) => void,
  ) => ReactNode;
  /** Whether the border controls are live; default always. */
  borderEnabled?: (v: T) => boolean;
  /** Whether the separator controls are live; default always. */
  separatorEnabled?: (v: T) => boolean;
  onOk: (v: T) => void;
  onCancel: () => void;
}

/** Narrowest a cell may get before the grid scrolls rather than squeezing. */
const MIN_CELL_PX = 130;
/** How much of the dialog the cell grid may take before it scrolls. */
const GRID_MAX_PX = 300;

export function DialogTableProperties<T extends SharedTableValues>({
  initial,
  iuScale,
  columnWidths,
  isNew,
  header,
  renderColor,
  borderEnabled,
  separatorEnabled,
  onOk,
  onCancel,
}: DialogTablePropertiesProps<T>): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [v, setV] = useState<T>(initial);
  // The width fields are held as text while they are being typed, so a half
  // typed "0." is not rounded away under the cursor.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const set = (patch: Partial<T>): void => setV((p) => ({ ...p, ...patch }));

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

  const borderOn = borderEnabled ? borderEnabled(v) : true;
  const sepOn = separatorEnabled ? separatorEnabled(v) : true;

  const widthField = (key: WidthKey, enabled: boolean): JSX.Element => (
    <label className="row ze-tableprops-field">
      <span className="ze-tableprops-lbl">Width:</span>
      <input
        type="text"
        className="ze-input ze-tableprops-width"
        disabled={!enabled}
        value={typed[key] ?? String(iuScale.iuToMM(v[key]))}
        onChange={(e) => {
          setTyped((p) => ({ ...p, [key]: e.target.value }));
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: iuScale.mmToIU(n) } as Partial<T>);
        }}
        onBlur={() => setTyped((p) => ({ ...p, [key]: undefined as unknown as string }))}
      />
      <span className="ze-muted ze-tableprops-unit">mm</span>
    </label>
  );

  const styleField = (key: StyleKey, enabled: boolean): JSX.Element => (
    <label className="row ze-tableprops-field">
      <span className="ze-tableprops-lbl">Style:</span>
      {/* `m_borderStyleCombo` / `m_separatorsStyleCombo` are wxBitmapComboBoxes,
          appended as `Append( lineStyleDesc.name, KiBitmapBundle(
          lineStyleDesc.bitmap ) )`. A native `<select>` carries neither the
          bitmap nor GTK's open-over-the-box placement. */}
      <Combo
        className="ze-tableprops-style"
        disabled={!enabled}
        value={v[key]}
        onChange={(next) => set({ [key]: next } as Partial<T>)}
        options={LINE_STYLE_NAMES.map((s) => ({
          value: s.value,
          label: s.label,
          ...(s.bitmap ? { bitmap: s.bitmap } : {}),
        }))}
      />
    </label>
  );

  const checkbox = (
    label: string,
    key: 'borderExternal' | 'borderHeader' | 'separatorRows' | 'separatorCols',
  ): JSX.Element => (
    <label className="row ze-tableprops-field">
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<T>)}
      />
      <span className="ze-tableprops-boxlbl">{label}</span>
    </label>
  );

  /**
   * One group of line controls, laid out as the grid-bag sizer lays them out:
   * the two checkboxes share a row, then Width and Color share the next, then
   * Style. Stacking each control on its own row makes the dialog taller than it
   * has any need to be.
   */
  const lineGroup = (
    legend: string,
    boxes: JSX.Element,
    widthKey: WidthKey,
    colorKey: ColorKey,
    styleKey: StyleKey,
    enabled: boolean,
  ): JSX.Element => (
    <fieldset className="ze-tableprops-group">
      <legend>{legend}</legend>
      <div className="ze-tableprops-boxes">{boxes}</div>
      <div className="ze-tableprops-line">
        {widthField(widthKey, enabled)}
        {renderColor?.(colorKey, enabled, v, set)}
      </div>
      <div className="ze-tableprops-line">{styleField(styleKey, enabled)}</div>
    </fieldset>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      {/* Wide, and only as tall as it needs to be: `.ze-modal` is 860x580 by
          default, which for this dialog meant a narrow box with the cell grid
          squeezed into it. The grid is the only thing that scrolls. */}
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Table Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-label-dialog-body ze-tableprops-body">
          {header?.(v, set)}

          {/* `minWidth: 0` on both the fieldset and the scroller: without it a
              flex child is sized by its content, the scroll box grows to the
              full width of the grid, and the overflow escapes to the dialog
              instead of scrolling inside. */}
          <fieldset className="ze-tableprops-cells">
            <legend>Cell contents</legend>
            {/* The one scroller in the dialog, in both directions.
                `width: max-content` is what makes that work: a table told to be
                100% wide never overflows, it just divides the dialog between
                however many columns there are, and forty columns leaves each
                one too narrow to type into. */}
            <div className="ze-tableprops-scroll" style={{ maxHeight: GRID_MAX_PX }}>
              <table className="ze-props-grid ze-tableprops-grid">
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
                            style={{ width: cellPx[col] ?? MIN_CELL_PX }}
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
          <div className="ze-tableprops-groups">
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

        <StdDialogButtons
          onCancel={onCancel}
          onOk={() => onOk(v)}
          {...(isNew ? { cancelTitle: 'Discard the table' } : {})}
        />
      </div>
    </div>
  );
}
