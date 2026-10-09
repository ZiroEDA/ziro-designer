// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLE_PROPERTIES` (eeschema/dialogs/dialog_table_properties.cpp) on a live SCH_TABLE,
 * over the form `common/dialogs/dialog_table_properties.tsx` shares with pcbnew. Opened by
 * DrawTable (a new table, discarded on Cancel) and by SCH_EDIT_TOOL::Properties.
 *
 * Two rules from the C++: a pair of line flags both off stores the stroke -1 wide, and reading a
 * -1 separator back shows its boxes unticked whatever the flags say. The style list is
 * `lineTypeNames`, Solid first; anything out of range selects it.
 */
import type { JSX } from 'react';
import { DialogTableProperties as SharedTableDialog } from '@ziroeda/common/dialogs/dialog_table_properties.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_TABLE } from '../sch_table.js';

export interface SCH_TABLE_DIALOG_VALUES {
  /** One string per cell, row-major; a covered cell is ''. */
  cellText: readonly (readonly string[])[];
  borderExternal: boolean;
  borderHeader: boolean;
  borderWidth: number;
  borderStyle: string;
  borderColor: Color4d;
  separatorRows: boolean;
  separatorCols: boolean;
  separatorWidth: number;
  separatorStyle: string;
  separatorColor: Color4d;
}

/** `m_borderWidth.Enable( StrokeExternal() || StrokeHeaderSeparator() )` and its siblings. */
const borderControlsEnabled = (v: SCH_TABLE_DIALOG_VALUES): boolean =>
  v.borderExternal || v.borderHeader;

/** `m_separatorsWidth.Enable( rows || cols )` and its siblings. */
const separatorControlsEnabled = (v: SCH_TABLE_DIALOG_VALUES): boolean =>
  v.separatorRows || v.separatorCols;

/** `m_borderStyleCombo->SetSelection( style )`: the first entry for anything out of range. */
const styleToken = (aStyle: LINE_STYLE): string =>
  LINE_STYLE_NAMES.find((d) => d.style === aStyle)?.value ?? LINE_STYLE_NAMES[0]!.value;

/** `std::advance( lineTypeNames.begin(), selection )`: SOLID past the end. */
const tokenStyle = (aToken: string): LINE_STYLE =>
  LINE_STYLE_NAMES.find((d) => d.value === aToken)?.style ?? LINE_STYLE.SOLID;

export class DIALOG_TABLE_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_table: SCH_TABLE;

  constructor(aFrame: SCH_EDIT_FRAME, aTable: SCH_TABLE) {
    this.m_frame = aFrame;
    this.m_table = aTable;
  }

  /** The column widths the grid keeps the proportions of (sizeGridToTable). */
  ColumnWidths(): number[] {
    const widths: number[] = [];

    for (let col = 0; col < this.m_table.GetColCount(); ++col)
      widths.push(this.m_table.GetColWidth(col));

    return widths;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): SCH_TABLE_DIALOG_VALUES {
    const t = this.m_table;
    const cellText: string[][] = [];

    for (let row = 0; row < t.GetRowCount(); ++row) {
      const line: string[] = [];

      for (let col = 0; col < t.GetColCount(); ++col) {
        const tableCell = t.GetCell(row, col)!;

        // A covered cell shows the grid's covered colour, not text.
        if (tableCell.GetColSpan() === 0 || tableCell.GetRowSpan() === 0) {
          line.push('');
          continue;
        }

        let text = tableCell.GetText();

        // show text variable cross-references in a human-readable format
        const schematic = tableCell.Schematic();
        if (schematic) text = schematic.ConvertKIIDsToRefs(text);

        line.push(text);
      }

      cellText.push(line);
    }

    const border = t.GetBorderStroke();
    const seps = t.GetSeparatorsStroke();

    return {
      cellText,
      borderExternal: t.StrokeExternal(),
      borderHeader: t.StrokeHeaderSeparator(),
      borderWidth: border.GetWidth() >= 0 ? border.GetWidth() : 0,
      borderStyle: styleToken(border.GetLineStyle()),
      borderColor: border.GetColor(),
      separatorRows: t.StrokeRows() && seps.GetWidth() >= 0,
      separatorCols: t.StrokeColumns() && seps.GetWidth() >= 0,
      separatorWidth: seps.GetWidth() >= 0 ? seps.GetWidth() : 0,
      separatorStyle: styleToken(seps.GetLineStyle()),
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

    t.SetStrokeExternal(aValues.borderExternal);
    t.SetStrokeHeaderSeparator(aValues.borderHeader);
    {
      const stroke = t.GetBorderStroke().clone();

      if (aValues.borderExternal || aValues.borderHeader)
        stroke.SetWidth(Math.max(0, aValues.borderWidth));
      else stroke.SetWidth(-1);

      stroke.SetLineStyle(tokenStyle(aValues.borderStyle));
      stroke.SetColor(aValues.borderColor);

      t.SetBorderStroke(stroke);
    }

    t.SetStrokeRows(aValues.separatorRows);
    t.SetStrokeColumns(aValues.separatorCols);
    {
      const stroke = t.GetSeparatorsStroke().clone();

      if (aValues.separatorRows || aValues.separatorCols)
        stroke.SetWidth(Math.max(0, aValues.separatorWidth));
      else stroke.SetWidth(-1);

      stroke.SetLineStyle(tokenStyle(aValues.separatorStyle));
      stroke.SetColor(aValues.separatorColor);

      t.SetSeparatorsStroke(stroke);
    }

    if (!commit.Empty()) commit.Push('Edit Table');

    return true;
  }
}

/** The shared form over DIALOG_TABLE_PROPERTIES, with eeschema's stroke colours. */
export function DialogTableProperties({
  dlg,
  initial,
  isNew,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_TABLE_PROPERTIES;
  initial: SCH_TABLE_DIALOG_VALUES;
  isNew: boolean;
  onOk: (aValues: SCH_TABLE_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <SharedTableDialog<SCH_TABLE_DIALOG_VALUES>
      initial={initial}
      iuScale={schIUScale}
      columnWidths={dlg.ColumnWidths()}
      isNew={isNew}
      borderEnabled={borderControlsEnabled}
      separatorEnabled={separatorControlsEnabled}
      renderColor={(key, enabled, v, set) => (
        <label className="row ze-tableprops-field">
          <span className="ze-tableprops-lbl">Color:</span>
          <ColorSwatch
            label="Color"
            disabled={!enabled}
            color={v[key]}
            onChange={(c) => set({ [key]: c } as Partial<SCH_TABLE_DIALOG_VALUES>)}
          />
        </label>
      )}
      onOk={onOk}
      onCancel={onCancel}
    />
  );
}
