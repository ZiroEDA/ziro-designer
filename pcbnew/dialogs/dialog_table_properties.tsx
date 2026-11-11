// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLE_PROPERTIES` (pcbnew/dialogs/dialog_table_properties.cpp): the class is the
 * dialog's logic on a live PCB_TABLE; `DialogTableProperties` below is the window over
 * DIALOG_TABLE_PROPERTIES_BASE.
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
 * Upstream stores -1 as "no stroke" when both of a pair's flags are off, and
 * TransferDataToWindow then leaves the width box blank (`SetValue` only when
 * the width is >= 0); the window carries the -1 so the box can.
 */
import { type JSX, useReducer, useState } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { toCssColor } from '@ziroeda/common/gal/color4d.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { GRID_CELL_COLOR_RENDERER } from '@ziroeda/common/widgets/grid_color_swatch_helpers.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridStringTable } from '@ziroeda/wx/grid.js';
import { IsBackLayer } from '@ziroeda/common/layer_id.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { BOARD_COMMIT, SKIP_CONNECTIVITY } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_LAYER_BOX_SELECTOR } from '../pcb_layer_box_selector.js';
import { PCB_TEXT_SYNTAX_HELP } from '../pcb_text_help_md.js';
import { DIALOG_TABLE_PROPERTIES_BASE } from './dialog_table_properties_base.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { TransferResult } from './dialog_text_properties.js';
import type { LineStyleToken } from '@ziroeda/common/stroke_params.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';

/** Every control on the dialog, flattened. The cell texts are the grid. */
export interface TableValues {
  layer: string;
  locked: boolean;
  borderExternal: boolean;
  borderHeader: boolean;
  /** The stroke's width, IU; -1 (no stroke) is a blank box. */
  borderWidth: number;
  borderStyle: LineStyleToken;
  separatorRows: boolean;
  separatorCols: boolean;
  separatorWidth: number;
  separatorStyle: LineStyleToken;
  /** Cell text in *display* order: `[row][col]` as the grid shows it. */
  cellText: string[][];
}

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

  GetFrame(): PCB_BASE_EDIT_FRAME {
    return this.m_frame;
  }

  /** `onBorderChecked` / `onHeaderChecked`'s default: the board's line width on the layer. */
  DefaultLineThickness(aLayer: string): number {
    return this.m_frame.GetDesignSettings().GetLineThickness(LSET_NameToLayer(aLayer));
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
      borderWidth: border.GetWidth(),
      borderStyle: styleToken(border.GetLineStyle()),
      separatorRows: t.StrokeRows() && seps.GetWidth() >= 0,
      separatorCols: t.StrokeColumns() && seps.GetWidth() >= 0,
      separatorWidth: seps.GetWidth(),
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

    if (pushCommit) commit.Push(wxGetTranslation('Edit Table'), SKIP_CONNECTIVITY);

    return { ok: true };
  }
}

// ---- The window: DIALOG_TABLE_PROPERTIES over DIALOG_TABLE_PROPERTIES_BASE ----

/**
 * The covered cells' colour: `wxSYS_COLOUR_BTNFACE` (#373737 on Yaru-dark, the grid's label
 * face) `.ChangeLightness( 140 )`, which wx blends 40% toward white: 55 * 0.6 + 255 * 0.4 = 135.
 * [data] TransferDataToWindow's IsDarkTheme branch.
 */
const COVERED_CELL_COLOUR = 'rgb(135, 135, 135)';

/** `sizeGridToTable`'s target: m_gridSizer's 600 x 400 minimum. */
const GRID_CLIENT_WIDTH = 600;

export interface DialogTablePropertiesProps {
  dlg: DIALOG_TABLE_PROPERTIES;
  /** OK, after TransferDataFromWindow; false for Cancel. */
  onClose: (aOk: boolean) => void;
}

export function DialogTableProperties({ dlg, onClose }: DialogTablePropertiesProps): JSX.Element {
  const frame = dlg.GetFrame();
  const table = dlg.GetTable();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [syntaxHelp, setSyntaxHelp] = useState(false);

  // The constructor and TransferDataToWindow, once.
  const [init] = useState(() => {
    const w = dlg.TransferDataToWindow();
    const rows = table.GetRowCount();
    const cols = table.GetColCount();
    const grid = new WX_GRID();
    grid.SetTable(new wxGridStringTable(rows, cols), true);
    grid.EnableEditing(true);
    const tricks = new GRID_TRICKS(grid);

    // TransferDataToWindow's cell contents, in the grid's (mirrored on the back) order.
    const covered = new Set<string>();

    for (let row = 0; row < rows; ++row) {
      for (let col = 0; col < cols; ++col) {
        const cell = IsBackLayer(table.GetLayer())
          ? table.GetCell(row, cols - 1 - col)!
          : table.GetCell(row, col)!;

        if (cell.GetColSpan() === 0 || cell.GetRowSpan() === 0) {
          covered.add(`${row},${col}`);
          grid.SetCellValue(row, col, COVERED_CELL_COLOUR);
          grid.SetReadOnly(row, col);
        } else {
          grid.SetCellValue(row, col, w.cellText[row]?.[col] ?? '');
        }
      }
    }

    const borderWidth = new UNIT_BINDER(frame, wxGetTranslation('Width:'));
    const separatorsWidth = new UNIT_BINDER(frame, wxGetTranslation('Width:'));

    if (w.borderWidth >= 0) borderWidth.SetValue(w.borderWidth);
    if (w.separatorWidth >= 0) separatorsWidth.SetValue(w.separatorWidth);

    // "footprints are built outside the current board and so we may need to show all layers if
    // the text is on an unactivated layer."
    const layerBox = new PCB_LAYER_BOX_SELECTOR();

    if (!frame.GetBoard()!.IsLayerEnabled(table.GetLayer())) layerBox.ShowNonActivatedLayers(true);

    layerBox.SetLayersHotkeys(false);
    layerBox.SetBoardFrame(frame);
    layerBox.Resync();

    // sizeGridToTable: each column's share of the table's width, floored.
    const tableWidth = table.GetBoundingBox().GetWidth() || 1;
    const columns = Array.from({ length: cols }, (_, col) => ({
      width: Math.floor(table.GetColWidth(col) * (GRID_CLIENT_WIDTH / tableWidth)),
    }));

    return { w, grid, tricks, covered, borderWidth, separatorsWidth, layerBox, columns };
  });
  const { grid, tricks, covered, borderWidth, separatorsWidth, layerBox, columns } = init;

  const [w, setW] = useState<TableValues>(init.w);
  const userUnits = unitLabel(frame.GetUserUnits());

  /** onBorderChecked / onHeaderChecked: the two are the same body upstream. */
  const onBorderChecked = (aPatch: Partial<TableValues>): void => {
    const next = { ...w, ...aPatch };
    const defaultLineThickness = dlg.DefaultLineThickness(next.layer);
    const border = next.borderExternal || next.borderHeader;
    const seps = next.separatorRows || next.separatorCols;

    if (border && borderWidth.GetValue() < 0) borderWidth.SetValue(defaultLineThickness);

    if (seps && separatorsWidth.GetValue() < 0) separatorsWidth.SetValue(defaultLineThickness);

    setW(next);
  };

  const borderOn = w.borderExternal || w.borderHeader;
  const sepsOn = w.separatorRows || w.separatorCols;
  const styleIndex = (aToken: LineStyleToken): number =>
    Math.max(
      0,
      LINE_STYLE_NAMES.findIndex((d) => d.value === aToken),
    );

  const unit = (aBinder: UNIT_BINDER, aEnabled: boolean) => ({
    value: aBinder.GetText(),
    enabled: aEnabled,
    units: userUnits,
    onChange: (aText: string) => {
      aBinder.SetText(aText);
      bump();
    },
  });

  const onOK = (): void => {
    if (!grid.CommitPendingChanges()) return;

    // A covered cell's colour text goes back too; TransferDataFromWindow drops it.
    const cellText = Array.from({ length: table.GetRowCount() }, (_, row) =>
      Array.from({ length: table.GetColCount() }, (_, col) => grid.GetCellValue(row, col)),
    );

    const r = dlg.TransferDataFromWindow({
      ...w,
      cellText,
      // `std::max( 0, m_borderWidth.GetIntValue() )`: a blank box is 0.
      borderWidth: borderWidth.GetIntValue(),
      separatorWidth: separatorsWidth.GetIntValue(),
    });

    if (r.ok) onClose(true);
  };

  return (
    <>
      <DIALOG_TABLE_PROPERTIES_BASE
        m_grid={grid}
        gridTricks={tricks}
        gridColumns={columns}
        // GRID_CELL_COLOR_RENDERER: a covered cell is its colour.
        renderCell={(aRow, aCol, aValue) =>
          covered.has(`${aRow},${aCol}`) ? <GRID_CELL_COLOR_RENDERER color={aValue} /> : null
        }
        onSyntaxHelp={() => setSyntaxHelp(true)}
        layerRows={layerBox.GetRows().map((r) => ({
          value: LSET_Name(r.layerid),
          label: r.name,
          swatch: r.swatch ? toCssColor(r.swatch) : undefined,
        }))}
        layer={w.layer}
        onLayerChange={(aLayer) => setW({ ...w, layer: aLayer })}
        m_cbLocked={{ value: w.locked, onChange: (v) => setW({ ...w, locked: v }) }}
        // Do not allow locking items in the footprint editor
        lockedShown={!table.GetParentFootprint()}
        m_borderCheckbox={{
          value: w.borderExternal,
          onChange: (v) => onBorderChecked({ borderExternal: v }),
        }}
        m_headerBorder={{
          value: w.borderHeader,
          onChange: (v) => onBorderChecked({ borderHeader: v }),
        }}
        m_borderWidth={unit(borderWidth, borderOn)}
        m_borderStyleCombo={{
          value: styleIndex(w.borderStyle),
          enabled: borderOn,
          onChange: (i) => setW({ ...w, borderStyle: LINE_STYLE_NAMES[i]?.value ?? 'solid' }),
        }}
        m_rowSeparators={{
          value: w.separatorRows,
          onChange: (v) => onBorderChecked({ separatorRows: v }),
        }}
        m_colSeparators={{
          value: w.separatorCols,
          onChange: (v) => onBorderChecked({ separatorCols: v }),
        }}
        m_separatorsWidth={unit(separatorsWidth, sepsOn)}
        m_separatorsStyleCombo={{
          value: styleIndex(w.separatorStyle),
          enabled: sepsOn,
          onChange: (i) => setW({ ...w, separatorStyle: LINE_STYLE_NAMES[i]?.value ?? 'solid' }),
        }}
        styleRows={LINE_STYLE_NAMES.map((d, i) => ({
          value: String(i),
          label: d.label,
          ...(d.bitmap ? { bitmap: bitmapUrl(d.bitmap) } : {}),
        }))}
        onOK={onOK}
        onCancel={() => onClose(false)}
      />
      {syntaxHelp && (
        <HtmlMessageBox
          caption={wxGetTranslation('Syntax Help')}
          className="ze-syntaxhelp"
          html={PCB_TEXT_SYNTAX_HELP}
          onClose={() => setSyntaxHelp(false)}
        />
      )}
    </>
  );
}
