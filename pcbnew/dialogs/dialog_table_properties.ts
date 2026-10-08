// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @deprecated The plain-object (`PcbTable`) form, kept for the properties
 * dialog until it moves onto `PCB_TABLE` (#636 stage 6). The class port is
 * `pcb_table.ts`; new code uses that one.
 *
 * Reading and writing a table's properties.
 * Counterpart: `DIALOG_TABLE_PROPERTIES` (pcbnew/dialogs/dialog_table_properties.cpp).
 *
 * ## The grid is mirrored on a back layer
 *
 * `TransferDataFromWindow` reads the editing grid with
 * `GetCell(row, colCount - 1 - col)` when the table is on a back layer, and
 * `GetCell(row, col)` otherwise. A table on B.Cu is seen from the *other side*
 * of the board, so its leftmost visible column is the last one in storage.
 * Getting this wrong reverses the columns of every back-layer table the moment
 * anyone opens its dialog — and only on a back layer, so it would pass every
 * test written against a front one.
 *
 * ## The layer is set on the table *and* every cell
 *
 * Upstream assigns the chosen layer to each cell inside the same loop, then to
 * the table. A cell left behind on the old layer would still be drawn, just on
 * the wrong one.
 *
 * ## A stroke width is only meaningful while its flags are on
 *
 * Upstream stores -1 as "no stroke" when both of a pair's flags are off. That
 * sentinel never reaches the file — the serializer omits the whole stroke in
 * that case — so it is not modelled; the flags alone carry it, and the width is
 * kept so switching a border back on restores what was there.
 */
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { IsBackLayer } from '@ziroeda/common/layer_id.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { BOARD_COMMIT, SKIP_CONNECTIVITY } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { TransferResult } from './dialog_text_properties.js';
import type { LineStyleToken } from '@ziroeda/common/stroke_params.js';

/** Every control on the dialog, flattened. The cell texts are the grid. */
export interface TableValues {
  layer: string;
  locked: boolean;
  borderExternal: boolean;
  borderHeader: boolean;
  borderWidth: number;
  borderStyle: LineStyleToken;
  separatorRows: boolean;
  separatorCols: boolean;
  separatorWidth: number;
  separatorStyle: LineStyleToken;
  /** Cell text in *display* order: `[row][col]` as the grid shows it. */
  cellText: string[][];
}

/**
 * `BOARD::IsBackLayer` for the standard layer set: a back layer is one whose
 * name starts with `B.`.
 */
export function isBackLayer(layer: string): boolean {
  return layer.startsWith('B.');
}

/** `TransferDataToWindow`: the dialog's starting values. */
/** `TransferDataFromWindow`, plus the source patching that makes it stick. */
// ---------------------------------------------------------------------------
// DIALOG_TABLE_PROPERTIES over the live PCB_TABLE (#636 stage 6)

/** `lineTypeNames` index of a style, the first entry for anything out of range. */
const styleToken = (aStyle: LINE_STYLE): LineStyleToken =>
  LINE_STYLE_NAMES.find((d) => d.style === aStyle)?.value ?? 'solid';

const tokenStyle = (aToken: LineStyleToken): LINE_STYLE =>
  LINE_STYLE_NAMES.find((d) => d.value === aToken)?.style ?? LINE_STYLE.SOLID;

/**
 * `DIALOG_TABLE_PROPERTIES` (dialog_table_properties.cpp) on a live
 * PCB_TABLE: the cell grid (mirrored on a back layer — the layer the table
 * is on WHEN the dialog reads or writes it), layer and lock, the border and
 * separator strokes (-1 wide when both of a pair's flags are off). OK is one
 * BOARD_COMMIT, "Edit Table", with SKIP_CONNECTIVITY.
 */
export class DIALOG_TABLE_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_table: PCB_TABLE;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aTable: PCB_TABLE) {
    this.m_frame = aFrame;
    this.m_table = aTable;
  }

  private cellAt(aRow: number, aCol: number) {
    const t = this.m_table;

    return IsBackLayer(t.GetLayer())
      ? t.GetCell(aRow, t.GetColCount() - 1 - aCol)
      : t.GetCell(aRow, aCol);
  }

  /** The table the dialog edits. */
  GetTable(): PCB_TABLE {
    return this.m_table;
  }

  TransferDataToWindow(): TableValues {
    const board = this.m_frame.GetBoard()!;
    const t = this.m_table;
    const cellText: string[][] = [];

    for (let row = 0; row < t.GetRowCount(); ++row) {
      const line: string[] = [];

      for (let col = 0; col < t.GetColCount(); ++col) {
        const tableCell = this.cellAt(row, col)!;

        // A covered cell shows the grid's grey, not text.
        if (tableCell.GetColSpan() === 0 || tableCell.GetRowSpan() === 0) {
          line.push('');
          continue;
        }

        // show text variable cross-references in a human-readable format
        line.push(board.ConvertKIIDsToCrossReferences(tableCell.GetText()));
      }

      cellText.push(line);
    }

    const border = t.GetBorderStroke();
    const seps = t.GetSeparatorsStroke();

    return {
      layer: LSET_Name(t.GetLayer()),
      locked: t.IsLocked(),
      borderExternal: t.StrokeExternal(),
      borderHeader: t.StrokeHeaderSeparator(),
      borderWidth: Math.max(border.GetWidth(), 0),
      borderStyle: styleToken(border.GetLineStyle()),
      separatorRows: t.StrokeRows() && seps.GetWidth() >= 0,
      separatorCols: t.StrokeColumns() && seps.GetWidth() >= 0,
      separatorWidth: Math.max(seps.GetWidth(), 0),
      separatorStyle: styleToken(seps.GetLineStyle()),
      cellText,
    };
  }

  TransferDataFromWindow(v: TableValues): TransferResult {
    const board = this.m_frame.GetBoard()!;
    const t = this.m_table;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(t);

    // If no other command in progress, prepare undo command
    const pushCommit = t.GetEditFlags() === 0;

    if (!pushCommit) t.SetFlags(IN_EDIT);

    const layer = LSET_NameToLayer(v.layer);

    for (let row = 0; row < t.GetRowCount(); ++row) {
      for (let col = 0; col < t.GetColCount(); ++col) {
        const tableCell = this.cellAt(row, col)!;

        let txt = v.cellText[row]?.[col] ?? '';

        // Don't insert grey colour value back in to table cell
        if (tableCell.GetColSpan() === 0 || tableCell.GetRowSpan() === 0) txt = '';

        // convert any text variable cross-references to their UUIDs
        txt = board.ConvertCrossReferencesToKIIDs(txt).replace(/\r/g, '');

        tableCell.SetText(txt);
        tableCell.SetLayer(layer);
      }
    }

    t.SetLayer(layer);
    t.SetLocked(v.locked);

    t.SetStrokeExternal(v.borderExternal);
    t.SetStrokeHeaderSeparator(v.borderHeader);
    {
      const stroke = t.GetBorderStroke().clone();

      if (v.borderExternal || v.borderHeader) stroke.SetWidth(Math.max(0, v.borderWidth));
      else stroke.SetWidth(-1);

      stroke.SetLineStyle(tokenStyle(v.borderStyle));
      t.SetBorderStroke(stroke);
    }

    t.SetStrokeRows(v.separatorRows);
    t.SetStrokeColumns(v.separatorCols);
    {
      const stroke = t.GetSeparatorsStroke().clone();

      if (v.separatorRows || v.separatorCols) stroke.SetWidth(Math.max(0, v.separatorWidth));
      else stroke.SetWidth(-1);

      stroke.SetLineStyle(tokenStyle(v.separatorStyle));
      t.SetSeparatorsStroke(stroke);
    }

    if (pushCommit) commit.Push('Edit Table', SKIP_CONNECTIVITY);

    return { ok: true };
  }
}
