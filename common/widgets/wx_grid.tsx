// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A unitized WX_GRID cell — `WX_GRID::SetUnitValue` and `WX_GRID::GetUnitValue`
 * (`common/widgets/wx_grid.cpp:934-980`).
 *
 * The pair belongs to the BASE CLASS, not to any one dialog. A grid registers
 * its numeric columns (`SetUnitsProvider`, `SetAutoEvalCols`) and from then on
 * every cell in them holds
 *
 *     SetCellValue( row, col, unitsProvider->StringFromValue( value, true ) )
 *
 * — the number *and* the frame's unit word, so the cell reads "0.1 mm" — and
 * is read back with `ValueFromString`, which accepts a trailing unit
 * designator. That is why no KiCad grid writes "(mm)" into a column header:
 * the unit is in the cell, it follows the FRAME rather than the dialog, and it
 * changes under the user when the frame's units do.
 *
 * The draft is not a convenience either. A wxGrid cell is a painted string
 * until the grid cursor opens its editor; the editor commits when it leaves
 * the cell and Esc abandons it. Re-formatting on every keystroke would rewrite
 * "0." to "0" under the caret and make "0.15" untypeable.
 *
 * `size={1}`: a `wxTextCtrl` built with `wxDefaultSize` contributes almost
 * nothing to its sizer, so a column is sized by its header and by the painted
 * cell text — never by the editor. An `<input>`'s default `size` of 20 is a
 * width no wxGrid column has; see `UnitField`'s `size` for the same note.
 */
import { type JSX, useRef, useState } from 'react';
import type { EdaDataType, EdaUnits as EDA_UNITS_T } from '../eda_units.js';
import { UNITS_PROVIDER } from '../units_provider.js';
import {
  type wxAttrKind,
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_CHANGING,
  wxEVT_GRID_COL_MOVE,
  wxEVT_GRID_EDITOR_HIDDEN,
  wxEVT_GRID_EDITOR_SHOWN,
  wxEVT_GRID_SELECT_CELL,
  wxGrid,
  type wxGridCellAttr,
  type wxGridEvent,
  wxGridSelectionModes,
  wxGridTableBase,
} from '../wx/grid.js';
import { type EdaIuScale, pcbIUScale } from '../index.js';
import { isNullableEditor } from './grid_text_helpers.js';
import { type EdaUnits, parseUnitValue, stringFromValue } from './unit_binder.js';

export function GridUnitCell({
  value,
  units,
  iuScale = pcbIUScale,
  ariaLabel,
  onCommit,
  size = 1,
}: {
  /** The model value in millimetres — what `SetUnitValue` is handed. */
  value: number;
  /** The frame's display unit; the `UNITS_PROVIDER` half of the cell. */
  units: EdaUnits;
  /** The application's internal-unit scale, which quantises what is read back. */
  iuScale?: EdaIuScale;
  ariaLabel: string;
  /**
   * `GetUnitValue`'s result, on leaving the cell. Returning `false` REFUSES the
   * value: the settings keep what they had and the cell keeps the text that was
   * typed, which is what upstream's `TransferDataFromWindow` leaves behind when
   * it reports a parameter error and returns false.
   */
  onCommit: (mm: number) => boolean | void;
  size?: number;
}): JSX.Element {
  // `null` means "show the model"; a string is an editor that is open.
  const [text, setText] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const commit = (): void => {
    if (text === null) return;
    if (onCommit(parseUnitValue(text, units, iuScale)) === false) return;
    setText(null);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      size={size}
      aria-label={ariaLabel}
      value={text ?? stringFromValue(value, units, true, iuScale)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // The grid's own keys, not the editor's: Enter commits and Esc
        // abandons (`wxGridCellEditor::HandleReturn` / `Reset`). Everything
        // else stops here so the canvas below does not see it as a hotkey.
        e.stopPropagation();

        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'Escape') {
          setText(null);
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// `include/widgets/wx_grid.h` + `common/widgets/wx_grid.cpp`: WX_GRID and
// WX_GRID_TABLE_BASE over the headless wxGrid (`common/wx/grid.ts`). The
// drawing (DrawColLabel, the autosizer, GetVisibleWidth) is the view's; the
// NUMERIC_EVALUATOR behind the auto-eval columns is not ported (UNIT_BINDER
// has the same gap), so an auto-eval column reads its text as typed - but it
// is still re-formatted in the column's units when its editor closes.

/** `GROUP_TYPE`: how a row of a grouped table shows. */
export enum GROUP_TYPE {
  GROUP_SINGLETON,
  GROUP_COLLAPSED,
  GROUP_COLLAPSED_DURING_SORT,
  GROUP_EXPANDED,
  CHILD_ITEM,
}

/**
 * `WX_GRID_TABLE_BASE`: a table whose column attributes it keeps itself,
 * merged under whatever the attribute provider adds (`enhanceAttr`).
 */
export abstract class WX_GRID_TABLE_BASE extends wxGridTableBase {
  protected m_colAttrs = new Map<number, wxGridCellAttr | null>();

  override SetColAttr(aAttr: wxGridCellAttr | null, aCol: number): void {
    this.m_colAttrs.set(aCol, aAttr);
  }

  override GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    return this.enhanceAttr(this.m_colAttrs.get(aCol) ?? null, aRow, aCol, aKind);
  }

  IsExpanderColumn(_aCol: number): boolean {
    return false;
  }

  GetGroupType(_aRow: number): GROUP_TYPE {
    return GROUP_TYPE.GROUP_SINGLETON;
  }

  HasUndoStateSerialization(): boolean {
    return false;
  }
  SerializeUndoState(): string {
    return '';
  }
  RestoreUndoState(_aState: string): void {}

  override Clear(): void {
    if (this.GetNumberRows()) this.DeleteRows(0, this.GetNumberRows());
  }

  /** `enhanceAttr`: the provider's attribute, merged over the input one. */
  protected enhanceAttr(
    aInputAttr: wxGridCellAttr | null,
    aRow: number,
    aCol: number,
    aKind: wxAttrKind,
  ): wxGridCellAttr | null {
    const provider = this.GetAttrProvider();
    const providerAttr = provider?.GetAttr(aRow, aCol, aKind) ?? null;

    if (!providerAttr) return aInputAttr;

    const attr = aInputAttr ? aInputAttr.Clone() : providerAttr.Clone();

    if (aInputAttr) attr.MergeWith(providerAttr);

    return attr;
  }
}

/** `WX_GRID`: KiCad's grid - wxGrid plus the helpers every grid dialog uses. */
export class WX_GRID extends wxGrid {
  private m_weOwnTable = false;
  private m_unitsProviders = new Map<number, UNITS_PROVIDER>();
  private m_autoEvalCols: number[] = [];
  private m_autoEvalColsUnits = new Map<number, [EDA_UNITS_T, EdaDataType]>();
  private m_altRowColors = false;
  /** `DIALOG_SHIM::OnModify()` of the dialog the grid sits in. */
  private m_onModify: (() => void) | null = null;

  private readonly onGridCellSelectHandler = (aEvent: wxGridEvent): void =>
    this.onGridCellSelect(aEvent);
  /** `m_evalBeforeAfter`: what was typed and what it was re-formatted to. */
  private m_evalBeforeAfter = new Map<string, [string, string]>();
  private readonly onCellEditorShownHandler = (aEvent: wxGridEvent): void =>
    this.onCellEditorShown(aEvent);
  private readonly onCellEditorHiddenHandler = (aEvent: wxGridEvent): void =>
    this.onCellEditorHidden(aEvent);
  private readonly onGridColMoveHandler = (): void => {
    // wxWidgets won't move an open editor, so better just to close it
    this.CommitPendingChanges(true);
  };

  constructor() {
    super();
    this.Connect(wxEVT_GRID_EDITOR_SHOWN, this.onCellEditorShownHandler);
    this.Connect(wxEVT_GRID_EDITOR_HIDDEN, this.onCellEditorHiddenHandler);
  }

  /** `onCellEditorShown`: an auto-eval cell reopens on what was typed. */
  private onCellEditorShown(aEvent: wxGridEvent): void {
    if (this.m_autoEvalCols.includes(aEvent.GetCol())) {
      const row = aEvent.GetRow();
      const col = aEvent.GetCol();
      const beforeAfter = this.m_evalBeforeAfter.get(`${row},${col}`);

      if (beforeAfter && this.GetCellValue(row, col) === beforeAfter[1])
        this.SetCellValue(row, col, beforeAfter[0]);
    }

    aEvent.Skip();
  }

  /**
   * `onCellEditorHidden`: once the edit is applied (`CallAfter`), an auto-eval
   * cell is re-read in its column's units and written back formatted; a nullable
   * cell (`GRID_CELL_MARK_AS_NULLABLE`) keeps an empty entry empty. The evaluator
   * itself is not ported.
   */
  private onCellEditorHidden(aEvent: wxGridEvent): void {
    const col = aEvent.GetCol();

    if (this.m_autoEvalCols.includes(col)) {
      const row = aEvent.GetRow();
      const unitsProvider = this.getUnitsProvider(col);
      const [, cellDataType] = this.getColumnUnits(col);

      // Determine if this cell is marked as holding nullable values
      const cellEditor = this.GetCellEditor(row, col);
      const isNullable = isNullableEditor(cellEditor) && cellEditor.IsNullable();

      queueMicrotask(() => {
        if (row >= this.GetNumberRows() || col >= this.GetNumberCols()) return;

        const stringValue = this.GetCellValue(row, col);
        let evalValue: string;

        if (isNullable) {
          const val = unitsProvider.OptionalValueFromString(stringValue, cellDataType);
          evalValue = unitsProvider.StringFromOptionalValue(val, true, cellDataType);
        } else {
          const val = unitsProvider.ValueFromString(stringValue, cellDataType);
          evalValue = unitsProvider.StringFromValue(val, true, cellDataType);
        }

        if (stringValue !== evalValue) {
          this.SetCellValue(row, col, evalValue);
          this.m_evalBeforeAfter.set(`${row},${col}`, [stringValue, evalValue]);
        }
      });
    }

    aEvent.Skip();
  }

  /** The dialog's `OnModify`, which a committed change calls. */
  SetModifyHandler(aOnModify: (() => void) | null): void {
    this.m_onModify = aOnModify;
  }

  /**
   * `SetTable( table, takeOwnership )`: also stripes the rows when the
   * appearance setting asks (`grid_striping`), and connects the
   * cell-select highlight.
   */
  override SetTable(
    aTable: wxGridTableBase | null,
    aTakeOwnership = false,
    aSelmode = wxGridSelectionModes.wxGridSelectCells,
    aGridStriping = false,
  ): boolean {
    super.SetTable(aTable, aTakeOwnership, aSelmode);

    if (aTable) this.EnableAlternateRowColors(aGridStriping);

    this.Disconnect(wxEVT_GRID_COL_MOVE, this.onGridColMoveHandler);
    this.Disconnect(wxEVT_GRID_SELECT_CELL, this.onGridCellSelectHandler);
    this.Connect(wxEVT_GRID_COL_MOVE, this.onGridColMoveHandler);
    this.Connect(wxEVT_GRID_SELECT_CELL, this.onGridCellSelectHandler);

    this.m_weOwnTable = aTakeOwnership;
    return true;
  }

  /** `DestroyTable`: commit quietly, disconnect, drop the table. */
  DestroyTable(_aTable: wxGridTableBase | null): void {
    this.CommitPendingChanges(true);
    this.Disconnect(wxEVT_GRID_COL_MOVE, this.onGridColMoveHandler);
    this.Disconnect(wxEVT_GRID_SELECT_CELL, this.onGridCellSelectHandler);
    super.SetTable(null);
    this.m_weOwnTable = false;
  }

  WeOwnTable(): boolean {
    return this.m_weOwnTable;
  }

  EnableAlternateRowColors(aEnable = true): void {
    this.m_altRowColors = aEnable;
    this.Refresh();
  }

  /** Whether the view stripes the rows. */
  AlternateRowColors(): boolean {
    return this.m_altRowColors;
  }

  /**
   * `onGridCellSelect`: select the cell the cursor lands on - or its row, or
   * its column, as the selection mode allows - so it can be seen.
   */
  private onGridCellSelect(aEvent: wxGridEvent): void {
    const row = aEvent.GetRow();
    const col = aEvent.GetCol();

    if (row >= 0 && row < this.GetNumberRows() && col >= 0 && col < this.GetNumberCols()) {
      const mode = this.GetSelectionMode();

      if (mode === wxGridSelectionModes.wxGridSelectCells)
        this.SelectBlock(row, col, row, col, false);
      else if (
        mode === wxGridSelectionModes.wxGridSelectRows ||
        mode === wxGridSelectionModes.wxGridSelectRowsOrColumns
      )
        this.SelectBlock(row, 0, row, this.GetNumberCols() - 1, false);
      else if (mode === wxGridSelectionModes.wxGridSelectColumns)
        this.SelectBlock(0, col, this.GetNumberRows() - 1, col, false);
    }

    aEvent.Skip();
  }

  GetShownColumnsAsString(): string {
    const shown: number[] = [];

    for (let i = 0; i < this.GetNumberCols(); ++i) if (this.IsColShown(i)) shown.push(i);

    return shown.join(' ');
  }

  /** `GetShownColumns()`, the bitset as booleans. */
  GetShownColumns(): boolean[] {
    return Array.from({ length: this.GetNumberCols() }, (_, i) => this.IsColShown(i));
  }

  ShowHideColumns(aShownColumns: string): void {
    for (let i = 0; i < this.GetNumberCols(); ++i) this.HideCol(i);

    for (const token of aShownColumns.split(/[ \t\r\n]+/)) {
      if (token === '') continue;

      // wxString::ToLong: the leading digits, 0 when there are none.
      const colNumber = Number.parseInt(token, 10);
      const col = Number.isNaN(colNumber) ? 0 : colNumber;

      if (col >= 0 && col < this.GetNumberCols()) this.ShowCol(col);
    }
  }

  /**
   * `CommitPendingChanges( aQuietMode )`: close the cell editor, applying what
   * it holds. Quiet mode sends no events and cannot be vetoed.
   *
   * @return false if a handler vetoed the change.
   */
  CommitPendingChanges(aQuietMode = false): boolean {
    if (!this.IsCellEditControlEnabled()) return true;

    const row = this.GetGridCursorRow();
    const col = this.GetGridCursorCol();

    if (!aQuietMode && this.SendEvent(wxEVT_GRID_EDITOR_HIDDEN, row, col) === -1) return false;

    this.HideCellEditControl();
    // do it after HideCellEditControl()
    this.m_cellEditCtrlEnabled = false;

    const oldval = this.GetCellValue(row, col);
    const newval = { value: '' };
    const editor = this.GetCellEditor(row, col);
    const changed = editor.EndEdit(row, col, this, oldval, newval);

    if (changed) {
      if (!aQuietMode && this.SendEvent(wxEVT_GRID_CELL_CHANGING, row, col, newval.value) === -1)
        return false;

      editor.ApplyEdit(row, col, this);

      if (!aQuietMode && this.SendEvent(wxEVT_GRID_CELL_CHANGED, row, col, oldval) === -1) {
        // Event has been vetoed, set the data back.
        this.SetCellValue(row, col, oldval);
        return false;
      }

      this.m_onModify?.();
    }

    this.Refresh();
    return true;
  }

  /** `CancelPendingChanges`: close the cell editor, dropping what it holds. */
  CancelPendingChanges(): boolean {
    if (!this.IsCellEditControlEnabled()) return true;

    this.HideCellEditControl();
    // do it after HideCellEditControl()
    this.m_cellEditCtrlEnabled = false;

    const row = this.GetGridCursorRow();
    const col = this.GetGridCursorCol();
    const editor = this.GetCellEditor(row, col);
    editor.EndEdit(row, col, this, this.GetCellValue(row, col), { value: '' });
    editor.Reset();
    this.Refresh();
    return true;
  }

  /**
   * `OnAddRow( aAdder )`: commit, add (the adder answers the new row and the
   * column to edit, or -1), put the cursor there and open its editor.
   */
  OnAddRow(aAdder: () => [number, number]): void {
    if (!this.CommitPendingChanges()) return;

    const [row, editCol] = aAdder();

    this.GoToCell(row, Math.max(editCol, 0));
    this.SetGridCursor(row, Math.max(editCol, 0));

    if (editCol >= 0) this.EnableCellEditControl(true);
  }

  /**
   * `OnDeleteRows( aFilter, aDeleter )`: every row the selection touches (or
   * the cursor's), if the filter allows them all; the cursor goes to the row
   * above the lowest, and the rows are deleted from the bottom up.
   */
  OnDeleteRows(
    aFilterOrDeleter: (aRow: number) => boolean | void,
    aDeleter?: (aRow: number) => void,
  ): void {
    const filter = aDeleter ? (aFilterOrDeleter as (aRow: number) => boolean) : () => true;
    const deleter = aDeleter ?? (aFilterOrDeleter as (aRow: number) => void);

    const selectedRows = this.GetSelectedRows();
    const addSelectedRow = (aRow: number): void => {
      if (!selectedRows.includes(aRow)) selectedRows.push(aRow);
    };

    const topLeft = this.GetSelectionBlockTopLeft();
    const botRight = this.GetSelectionBlockBottomRight();

    for (let i = 0; i < Math.min(topLeft.length, botRight.length); ++i)
      for (let row = topLeft[i]!.GetRow(); row <= botRight[i]!.GetRow(); ++row) addSelectedRow(row);

    for (const cell of this.GetSelectedCells()) addSelectedRow(cell.GetRow());

    if (selectedRows.length === 0 && this.GetGridCursorRow() >= 0)
      selectedRows.push(this.GetGridCursorRow());

    if (selectedRows.length === 0) return;

    for (const row of selectedRows) if (!filter(row)) return;

    if (!this.CommitPendingChanges()) return;

    // Reverse sort so deleting a row doesn't change the indexes of the other rows.
    selectedRows.sort((a, b) => b - a);

    const nextSelRow = selectedRows[selectedRows.length - 1]! - 1;

    if (nextSelRow >= 0) {
      this.GoToCell(nextSelRow, this.GetGridCursorCol());
      this.SetGridCursor(nextSelRow, this.GetGridCursorCol());
    }

    for (const row of selectedRows) deleter(row);
  }

  SwapRows(aRowA: number, aRowB: number): void {
    for (let col = 0; col < this.GetNumberCols(); ++col) {
      const temp = this.GetCellValue(aRowA, col);
      this.SetCellValue(aRowA, col, this.GetCellValue(aRowB, col));
      this.SetCellValue(aRowB, col, temp);
    }
  }

  /** `OnMoveRowUp( [aFilter,] aMover )`: false when there is no row above (`wxBell`). */
  OnMoveRowUp(
    aFilterOrMover: (aRow: number) => boolean | void,
    aMover?: (aRow: number) => void,
  ): boolean {
    const filter = aMover ? (aFilterOrMover as (aRow: number) => boolean) : () => true;
    const mover = aMover ?? (aFilterOrMover as (aRow: number) => void);

    if (!this.CommitPendingChanges()) return false;

    const i = this.GetGridCursorRow();

    if (i > 0 && filter(i)) {
      mover(i);
      this.SetGridCursor(i - 1, this.GetGridCursorCol());
      return true;
    }

    return false;
  }

  /** `OnMoveRowDown( [aFilter,] aMover )`: false when there is no row below (`wxBell`). */
  OnMoveRowDown(
    aFilterOrMover: (aRow: number) => boolean | void,
    aMover?: (aRow: number) => void,
  ): boolean {
    const filter = aMover ? (aFilterOrMover as (aRow: number) => boolean) : () => true;
    const mover = aMover ?? (aFilterOrMover as (aRow: number) => void);

    if (!this.CommitPendingChanges()) return false;

    const i = this.GetGridCursorRow();

    if (i + 1 < this.GetNumberRows() && filter(i)) {
      mover(i);
      this.SetGridCursor(i + 1, this.GetGridCursorCol());
      return true;
    }

    return false;
  }

  private m_waitForSlowClick = false;

  /**
   * `ShowEditorOnMouseUp`: open the cell editor when the click that asked for
   * it lets go - wx's "slow click" (GRID_TRICKS::showEditor explains why).
   */
  ShowEditorOnMouseUp(): void {
    this.m_waitForSlowClick = true;
  }
  CancelShowEditorOnMouseUp(): void {
    this.m_waitForSlowClick = false;
  }
  /** The view's mouse-up asks this, and clears it by opening the editor. */
  IsWaitingForSlowClick(): boolean {
    return this.m_waitForSlowClick;
  }

  ClearRows(): void {
    if (this.GetNumberRows() > 0) this.DeleteRows(0, this.GetNumberRows());
  }

  // ---- unit columns ------------------------------------------------------------

  SetUnitsProvider(aProvider: UNITS_PROVIDER, aCol = 0): void {
    this.m_unitsProviders.set(aCol, aProvider);
  }

  SetAutoEvalCols(aCols: number[]): void {
    this.m_autoEvalCols = aCols;
  }

  SetAutoEvalColUnits(aCol: number, aUnit: EDA_UNITS_T, aUnitType?: EdaDataType): void {
    const type = aUnitType ?? (UNITS_PROVIDER.GetTypeFromUnits(aUnit) as EdaDataType);
    this.m_autoEvalColsUnits.set(aCol, [aUnit, type]);
  }

  private getUnitsProvider(aCol: number): UNITS_PROVIDER {
    return this.m_unitsProviders.get(aCol) ?? this.m_unitsProviders.values().next().value!;
  }

  private getColumnUnits(aCol: number): [EDA_UNITS_T, EdaDataType] {
    return (
      this.m_autoEvalColsUnits.get(aCol) ?? [this.getUnitsProvider(aCol).GetUserUnits(), 'distance']
    );
  }

  GetUnitValue(aRow: number, aCol: number): number {
    const [, cellDataType] = this.getColumnUnits(aCol);
    return this.getUnitsProvider(aCol).ValueFromString(this.GetCellValue(aRow, aCol), cellDataType);
  }

  GetOptionalUnitValue(aRow: number, aCol: number): number | null {
    const [, cellDataType] = this.getColumnUnits(aCol);
    return this.getUnitsProvider(aCol).OptionalValueFromString(
      this.GetCellValue(aRow, aCol),
      cellDataType,
    );
  }

  SetUnitValue(aRow: number, aCol: number, aValue: number): void {
    const cellDataType = this.m_autoEvalColsUnits.get(aCol)?.[1] ?? 'distance';
    this.SetCellValue(
      aRow,
      aCol,
      this.getUnitsProvider(aCol).StringFromValue(aValue, true, cellDataType),
    );
  }

  SetOptionalUnitValue(aRow: number, aCol: number, aValue: number | null): void {
    const cellDataType = this.m_autoEvalColsUnits.get(aCol)?.[1] ?? 'distance';
    this.SetCellValue(
      aRow,
      aCol,
      this.getUnitsProvider(aCol).StringFromOptionalValue(aValue, true, cellDataType),
    );
  }
}
