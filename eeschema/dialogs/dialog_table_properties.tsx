// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLE_PROPERTIES` (eeschema/dialogs/dialog_table_properties.cpp) on a live SCH_TABLE,
 * over DIALOG_TABLE_PROPERTIES_BASE. Opened by DrawTable (a new table, discarded on Cancel) and by
 * SCH_EDIT_TOOL::Properties.
 *
 * The cell grid is a WX_GRID with no labels: a covered cell is read-only and filled with the
 * covered colour (GRID_CELL_COLOR_RENDERER), the others edit their text. The two widths go through
 * UNIT_BINDERs in the frame's units. Rules from the C++: a pair of line flags both off stores the
 * stroke -1 wide; a -1 stroke leaves its width box empty and shows a -1 separator's boxes unticked
 * whatever the flags say; the style is the combo index, Solid for anything out of range.
 *
 * Not carried over: GRID_CELL_STC_EDITOR's text-variable autocomplete (a plain cell editor here),
 * opening on the selected cell's editor (the CallAfter), and the row heights of sizeGridToTable
 * (the grid view sizes rows to their text; the column widths keep the table's proportions).
 *
 * Deliberately different: upstream's covered cell holds coveredColor.GetAsString() and
 * TransferDataFromWindow writes every cell back, so a covered cell's text becomes that colour
 * (theme-dependent, e.g. "rgb(135, 135, 135)") in the saved file. Here it is written as ''.
 */
import { type JSX, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { type WX_GRID, useStringGrid } from '@ziroeda/common/widgets/wx_grid.js';
import { GRID_CELL_COLOR_RENDERER } from '@ziroeda/common/widgets/grid_color_swatch_helpers.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_TABLE } from '../sch_table.js';
import { DIALOG_TABLE_PROPERTIES_BASE } from './dialog_table_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface SCH_TABLE_DIALOG_VALUES {
  /** One string per cell, row-major; a covered cell is ''. */
  cellText: readonly (readonly string[])[];
  /** Row-major: true where the cell is covered by a span. */
  covered: readonly (readonly boolean[])[];
  borderExternal: boolean;
  borderHeader: boolean;
  /** `m_borderWidth`'s text; empty for a -1 stroke. */
  borderWidth: string;
  /** `m_borderStyleCombo->GetSelection()`. */
  borderStyle: number;
  borderColor: Color4d;
  separatorRows: boolean;
  separatorCols: boolean;
  separatorWidth: string;
  separatorStyle: number;
  separatorColor: Color4d;
}

/** `m_borderStyleCombo->SetSelection( style )`: the first entry for anything out of range. */
const styleIndex = (aStyle: LINE_STYLE): number =>
  aStyle >= 0 && aStyle < LINE_STYLE_NAMES.length ? aStyle : 0;

/** `std::advance( lineTypeNames.begin(), selection )`: SOLID past the end. */
const indexStyle = (aIndex: number): LINE_STYLE =>
  LINE_STYLE_NAMES[aIndex]?.style ?? LINE_STYLE.SOLID;

export class DIALOG_TABLE_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_table: SCH_TABLE;
  private readonly m_borderWidth: UNIT_BINDER;
  private readonly m_separatorsWidth: UNIT_BINDER;

  constructor(aFrame: SCH_EDIT_FRAME, aTable: SCH_TABLE) {
    this.m_frame = aFrame;
    this.m_table = aTable;
    this.m_borderWidth = new UNIT_BINDER(aFrame, _('Width:'), (m) => DisplayErrorMessage(m));
    this.m_separatorsWidth = new UNIT_BINDER(aFrame, _('Width:'), (m) => DisplayErrorMessage(m));
  }

  /** `m_infoBar->ShowMessage( … )` when item colours are overridden in Preferences. */
  InfoBarMessage(): string | null {
    return this.m_frame.GetColorSettings().GetOverrideSchItemColors()
      ? _('Note: individual item colors overridden in Preferences.')
      : null;
  }

  /** `SetSwatchBackground( canvas )`: LAYER_SCHEMATIC_BACKGROUND behind both swatches. */
  SwatchBackground(): Color4d {
    return this.m_frame.GetDrawBgColor();
  }

  /**
   * `sizeGridToTable()`'s column widths: each column's share of the table's width, scaled to the
   * grid's width (`m_gridSizer`'s 600 px floor, which is what Fit() gives it).
   */
  ColumnWidths(aAvailableWidth = 600): number[] {
    const tableWidth = this.m_table.GetBoundingBox().GetWidth();
    const scalerX = tableWidth > 0 ? aAvailableWidth / tableWidth : 0;
    const widths: number[] = [];

    for (let col = 0; col < this.m_table.GetColCount(); ++col)
      widths.push(Math.floor(this.m_table.GetColWidth(col) * scalerX));

    return widths;
  }

  /** `onBorderChecked()`: a line run switched on with no width takes the default thickness. */
  DefaultWidthText(aWidthText: string, aOn: boolean, aWhich: 'border' | 'separators'): string {
    const binder = aWhich === 'border' ? this.m_borderWidth : this.m_separatorsWidth;
    binder.SetText(aWidthText);

    // 10.0.6 hands m_Drawing.default_line_thickness (stored in mils) straight to SetValue(),
    // which takes internal units; mirrored as written.
    if (aOn && binder.GetValue() < 0)
      binder.SetValue(this.m_frame.eeconfig()?.drawing.default_line_thickness ?? 0);

    return binder.GetText();
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): SCH_TABLE_DIALOG_VALUES {
    const t = this.m_table;
    const cellText: string[][] = [];
    const covered: boolean[][] = [];

    for (let row = 0; row < t.GetRowCount(); ++row) {
      const line: string[] = [];
      const coveredLine: boolean[] = [];

      for (let col = 0; col < t.GetColCount(); ++col) {
        const tableCell = t.GetCell(row, col)!;

        if (tableCell.GetColSpan() === 0 || tableCell.GetRowSpan() === 0) {
          line.push('');
          coveredLine.push(true);
          continue;
        }

        let text = tableCell.GetText();

        // show text variable cross-references in a human-readable format
        const schematic = tableCell.Schematic();
        if (schematic) text = schematic.ConvertKIIDsToRefs(text);

        line.push(text);
        coveredLine.push(false);
      }

      cellText.push(line);
      covered.push(coveredLine);
    }

    const border = t.GetBorderStroke();
    const seps = t.GetSeparatorsStroke();

    this.m_borderWidth.SetText('');
    if (border.GetWidth() >= 0) this.m_borderWidth.SetValue(border.GetWidth());

    this.m_separatorsWidth.SetText('');
    if (seps.GetWidth() >= 0) this.m_separatorsWidth.SetValue(seps.GetWidth());

    return {
      cellText,
      covered,
      borderExternal: t.StrokeExternal(),
      borderHeader: t.StrokeHeaderSeparator(),
      borderWidth: this.m_borderWidth.GetText(),
      borderStyle: styleIndex(border.GetLineStyle()),
      borderColor: border.GetColor(),
      separatorRows: t.StrokeRows() && seps.GetWidth() >= 0,
      separatorCols: t.StrokeColumns() && seps.GetWidth() >= 0,
      separatorWidth: this.m_separatorsWidth.GetText(),
      separatorStyle: styleIndex(seps.GetLineStyle()),
      separatorColor: seps.GetColor(),
    };
  }

  /** `TransferDataFromWindow()`: one 'Edit Table' commit unless the table is already in edit. */
  TransferDataFromWindow(aValues: SCH_TABLE_DIALOG_VALUES): boolean {
    const t = this.m_table;
    const commit = new SCH_COMMIT(this.m_frame);

    /* save table in undo list if not already in edit */
    if (t.GetEditFlags() === 0) commit.Modify(t, this.m_frame.GetScreen());

    for (let row = 0; row < t.GetRowCount(); ++row) {
      for (let col = 0; col < t.GetColCount(); ++col) {
        const tableCell = t.GetCell(row, col)!;
        let txt = aValues.cellText[row]?.[col] ?? '';

        // convert any text variable cross-references to their UUIDs
        const schematic = tableCell.Schematic();
        if (schematic) txt = schematic.ConvertRefsToKIIDs(txt);

        tableCell.SetText(txt);
      }
    }

    this.m_borderWidth.SetText(aValues.borderWidth);
    this.m_separatorsWidth.SetText(aValues.separatorWidth);

    t.SetStrokeExternal(aValues.borderExternal);
    t.SetStrokeHeaderSeparator(aValues.borderHeader);
    {
      const stroke = t.GetBorderStroke().clone();

      if (aValues.borderExternal || aValues.borderHeader)
        stroke.SetWidth(Math.max(0, this.m_borderWidth.GetIntValue()));
      else stroke.SetWidth(-1);

      stroke.SetLineStyle(indexStyle(aValues.borderStyle));
      stroke.SetColor(aValues.borderColor);

      t.SetBorderStroke(stroke);
    }

    t.SetStrokeRows(aValues.separatorRows);
    t.SetStrokeColumns(aValues.separatorCols);
    {
      const stroke = t.GetSeparatorsStroke().clone();

      if (aValues.separatorRows || aValues.separatorCols)
        stroke.SetWidth(Math.max(0, this.m_separatorsWidth.GetIntValue()));
      else stroke.SetWidth(-1);

      stroke.SetLineStyle(indexStyle(aValues.separatorStyle));
      stroke.SetColor(aValues.separatorColor);

      t.SetSeparatorsStroke(stroke);
    }

    if (!commit.Empty()) commit.Push(_('Edit Table'));

    return true;
  }
}

/** DIALOG_TABLE_PROPERTIES' window: the base, its WX_GRID, and the onBorderChecked enables. */
export function DialogTableProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_TABLE_PROPERTIES;
  initial: SCH_TABLE_DIALOG_VALUES;
  /** The frame's units, which the two UNIT_BINDERs label their entries with. */
  units: StatusUnits;
  /** Kept for DrawTable's caller; a new table is discarded on Cancel either way. */
  isNew?: boolean;
  onOk: (aValues: SCH_TABLE_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [v, setV] = useState<SCH_TABLE_DIALOG_VALUES>(initial);
  const set = (patch: Partial<SCH_TABLE_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));

  const cols = initial.cellText[0]?.length ?? 0;
  const { grid, tricks, onUpdate } = useStringGrid<readonly string[]>({
    labels: Array.from({ length: cols }, () => ''),
    rows: v.cellText,
    toCells: (line) => line,
    fromCells: (cells) => [...cells],
    onChange: (rows) => set({ cellText: rows }),
    setup: (aGrid: WX_GRID) => {
      initial.covered.forEach((line, row) => {
        line.forEach((isCovered, col) => {
          if (isCovered) aGrid.SetReadOnly(row, col);
        });
      });
    },
  });

  const borderOn = v.borderExternal || v.borderHeader;
  const sepOn = v.separatorRows || v.separatorCols;

  /** `onBorderChecked()`, which both runs' four checkboxes are connected to. */
  const onBorderChecked = (patch: Partial<SCH_TABLE_DIALOG_VALUES>): void => {
    const n = { ...v, ...patch };
    set({
      ...patch,
      borderWidth: dlg.DefaultWidthText(
        n.borderWidth,
        n.borderExternal || n.borderHeader,
        'border',
      ),
      separatorWidth: dlg.DefaultWidthText(
        n.separatorWidth,
        n.separatorRows || n.separatorCols,
        'separators',
      ),
    });
  };

  const background = dlg.SwatchBackground();
  const widths = dlg.ColumnWidths();

  return (
    <DIALOG_TABLE_PROPERTIES_BASE
      m_infoBar={dlg.InfoBarMessage()}
      m_grid={
        <WxGridView
          grid={grid}
          tricks={tricks}
          rowLabels={false}
          colLabels={false}
          columns={widths.map((width) => ({ width }))}
          renderCell={(row, col) =>
            // `SetCellValue( row, col, coveredColor.GetAsString() )` drawn by its
            // GRID_CELL_COLOR_RENDERER; the colour is the theme's (--grid-covered-bg).
            initial.covered[row]?.[col] ? (
              <GRID_CELL_COLOR_RENDERER color="var(--grid-covered-bg)" />
            ) : null
          }
          onUpdate={onUpdate}
          ariaLabel={_('Cell contents')}
        />
      }
      m_borderCheckbox={{
        value: v.borderExternal,
        onChange: (on) => onBorderChecked({ borderExternal: on }),
      }}
      m_headerBorder={{
        value: v.borderHeader,
        onChange: (on) => onBorderChecked({ borderHeader: on }),
      }}
      m_borderWidth={{
        text: v.borderWidth,
        onChange: (t) => set({ borderWidth: t }),
        units: unitLabel(units),
        enabled: borderOn,
      }}
      m_borderColorSwatch={{
        color: v.borderColor,
        background,
        enabled: borderOn,
        onChange: (c) => set({ borderColor: c }),
      }}
      m_borderStyleCombo={{
        value: v.borderStyle,
        enabled: borderOn,
        onChange: (i) => set({ borderStyle: i }),
      }}
      m_rowSeparators={{
        value: v.separatorRows,
        onChange: (on) => onBorderChecked({ separatorRows: on }),
      }}
      m_colSeparators={{
        value: v.separatorCols,
        onChange: (on) => onBorderChecked({ separatorCols: on }),
      }}
      m_separatorsWidth={{
        text: v.separatorWidth,
        onChange: (t) => set({ separatorWidth: t }),
        units: unitLabel(units),
        enabled: sepOn,
      }}
      m_separatorsColorSwatch={{
        color: v.separatorColor,
        background,
        enabled: sepOn,
        onChange: (c) => set({ separatorColor: c }),
      }}
      m_separatorsStyleCombo={{
        value: v.separatorStyle,
        enabled: sepOn,
        onChange: (i) => set({ separatorStyle: i }),
      }}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}
