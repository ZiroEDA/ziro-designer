// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table properties. Counterpart: `DIALOG_TABLE_PROPERTIES`
 * (eeschema/dialogs/dialog_table_properties.cpp).
 *
 * The dialog is not optional decoration on the table tool — `DrawTable` ends
 * with it, and cancelling it throws the table away:
 *
 *     table->Normalize();
 *     DIALOG_TABLE_PROPERTIES dlg( m_frame, table );
 *
 *     if( dlg.ShowQuasiModal() == wxID_OK ) { commit.Add( table, … ); … }
 *     else                                  { delete table; }
 *
 * so the drag decides the *shape* and the dialog decides everything else: the
 * text in each cell, whether the outer border and the header separator are
 * drawn, and the width, style and colour of the border and of the row/column
 * separators.
 *
 * Two rules here are easy to miss and are the reason this is a module rather
 * than a handful of lines in the dialog:
 *
 *  - **a width of −1 is how "no line" is stored.** Unticking both border boxes
 *    does not merely stop drawing them, it writes `-1`:
 *
 *        if( m_borderCheckbox->GetValue() || m_headerBorder->GetValue() )
 *            stroke.SetWidth( std::max( 0, m_borderWidth.GetIntValue() ) );
 *        else
 *            stroke.SetWidth( -1 );
 *
 *  - **and reading it back is asymmetric.** A table whose separator stroke is
 *    −1 wide shows its row/column boxes *unticked* even if the flags say
 *    otherwise, because the width is what actually decides:
 *
 *        bool rows = m_table->StrokeRows() && m_table->GetSeparatorsStroke().GetWidth() >= 0;
 *
 * The style list is `lineTypeNames`, which starts at Solid — there is no
 * "Default" entry — and a stored default (line style −1) selects Solid, since
 * the combo falls back to index 0 for anything out of range.
 */

import { tableRowCount } from '@ziroeda/common/src/table.js';
import type { Schematic, SchTable, Stroke } from '../types.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';

/** The five entries of `lineTypeNames`, in the order the combo lists them. */
export const TABLE_STROKE_STYLES = ['solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'] as const;
export type TableStrokeStyle = (typeof TABLE_STROKE_STYLES)[number];

/** RGBA as the file stores it: rgb 0-255, alpha 0-1. */
export type TableColor = readonly [number, number, number, number];

/** Everything the dialog can change about a table. */
export interface SchTableValues {
  /** One string per cell, in row-major display order. */
  readonly cellText: readonly (readonly string[])[];
  readonly borderExternal: boolean;
  readonly borderHeader: boolean;
  /** Border width in IU. Never negative here; −1 is expressed by the flags. */
  readonly borderWidth: number;
  readonly borderStyle: TableStrokeStyle;
  /** Undefined means "unspecified", i.e. the layer colour. */
  readonly borderColor?: TableColor;
  readonly separatorRows: boolean;
  readonly separatorCols: boolean;
  readonly separatorWidth: number;
  readonly separatorStyle: TableStrokeStyle;
  readonly separatorColor?: TableColor;
}


/**
 * The style a stored stroke selects in the combo.
 *
 *     int style = static_cast<int>( … GetLineStyle() );
 *     if( style >= 0 && style < (int) lineTypeNames.size() ) SetSelection( style );
 *     else                                                   SetSelection( 0 );
 *
 * `default` is LINE_STYLE::DEFAULT (−1), which is out of range, so it lands on
 * Solid — the combo has no "Default" row to land on.
 */
export function tableStrokeStyle(stroke: Stroke | undefined): TableStrokeStyle {
  const t = stroke?.type;
  return TABLE_STROKE_STYLES.includes(t as TableStrokeStyle) ? (t as TableStrokeStyle) : 'solid';
}

/** `TransferDataToWindow`: the table's current state as dialog values. */
export function collectSchTableValues(t: SchTable): SchTableValues {
  const cols = Math.max(1, t.columnCount);
  const rows = tableRowCount(t);
  const cellText: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: string[] = [];
    for (let c = 0; c < cols; c++) line.push(t.cells[r * cols + c]?.text ?? '');
    cellText.push(line);
  }

  const borderW = t.borderStroke?.width ?? 0;
  const sepW = t.separatorsStroke?.width ?? 0;
  // A −1 width means the line is off, whatever the flag says.
  const rowsOn = t.separatorRows && sepW >= 0;
  const colsOn = t.separatorCols && sepW >= 0;

  const values: {
    -readonly [K in keyof SchTableValues]: SchTableValues[K];
  } = {
    cellText,
    borderExternal: t.borderExternal,
    borderHeader: t.borderHeader,
    // The field keeps its previous contents when the stored width is negative
    // (`if( … GetWidth() >= 0 ) m_borderWidth.SetValue( … )`), which for a fresh
    // dialog means zero — "use the default width".
    borderWidth: borderW >= 0 ? borderW : 0,
    borderStyle: tableStrokeStyle(t.borderStroke),
    separatorRows: rowsOn,
    separatorCols: colsOn,
    separatorWidth: sepW >= 0 ? sepW : 0,
    separatorStyle: tableStrokeStyle(t.separatorsStroke),
  };
  if (t.borderStroke?.color) values.borderColor = t.borderStroke.color;
  if (t.separatorsStroke?.color) values.separatorColor = t.separatorsStroke.color;
  return values;
}

/**
 * Whether the border's width/colour/style controls are live.
 *
 *     m_borderWidth.Enable( m_table->StrokeExternal() || m_table->StrokeHeaderSeparator() );
 */
export const borderControlsEnabled = (v: SchTableValues): boolean =>
  v.borderExternal || v.borderHeader;

/** The same for the separators: `m_separatorsWidth.Enable( rows || cols );` */
export const separatorControlsEnabled = (v: SchTableValues): boolean =>
  v.separatorRows || v.separatorCols;

/** The stroke a group of dialog values describes, −1 wide when it is off. */
function strokeFor(
  on: boolean,
  width: number,
  style: TableStrokeStyle,
  color?: TableColor,
): Stroke {
  const stroke: { -readonly [K in keyof Stroke]: Stroke[K] } = {
    width: on ? Math.max(0, Math.round(width)) : -1,
    type: style,
  };
  if (color) stroke.color = color;
  return stroke;
}

/** The table these values describe, applied to `t`. */
export function tableWithValues(t: SchTable, v: SchTableValues): SchTable {
  const cols = Math.max(1, t.columnCount);
  return {
    ...t,
    cells: t.cells.map((cell, i) => {
      const text = v.cellText[Math.floor(i / cols)]?.[i % cols];
      return text === undefined || text === cell.text ? cell : { ...cell, text };
    }),
    borderExternal: v.borderExternal,
    borderHeader: v.borderHeader,
    borderStroke: strokeFor(borderControlsEnabled(v), v.borderWidth, v.borderStyle, v.borderColor),
    separatorRows: v.separatorRows,
    separatorCols: v.separatorCols,
    separatorsStroke: strokeFor(
      separatorControlsEnabled(v),
      v.separatorWidth,
      v.separatorStyle,
      v.separatorColor,
    ),
  };
}

/** `TransferDataFromWindow`: apply the dialog to the table at `index`. */
export function applySchTableValues(index: number, v: SchTableValues): EditCommand {
  return {
    label: 'Edit Table',
    apply(doc: Schematic): Schematic {
      const t = doc.tables[index];
      if (!t) return doc;
      const next = tableWithValues(t, v);
      return { ...doc, tables: doc.tables.map((x, i) => (i === index ? next : x)) };
    },
    invert(before: Schematic): EditCommand {
      const t = before.tables[index];
      return t ? restoreTable(index, t) : applySchTableValues(index, v);
    },
  };
}

function restoreTable(index: number, table: SchTable): EditCommand {
  return {
    label: 'Edit Table',
    apply: (doc: Schematic): Schematic => ({
      ...doc,
      tables: doc.tables.map((x, i) => (i === index ? table : x)),
    }),
    invert: (before: Schematic) => restoreTable(index, before.tables[index] ?? table),
  };
}

/**
 * The table a selection names, if it names exactly one.
 *
 * `SCH_EDIT_TOOL::Properties` opens this dialog for a single SCH_TABLE_T; a
 * selected *cell* opens the cell dialog instead, which is why only whole-table
 * ids count here.
 */
export function tableAt(doc: Schematic, selection: Iterable<string>): number | null {
  const ids = [...selection];
  if (ids.length !== 1) return null;
  const idx = doc.tables.findIndex((t, i) => refId('table', t.uuid, i) === ids[0]);
  return idx === -1 ? null : idx;
}
