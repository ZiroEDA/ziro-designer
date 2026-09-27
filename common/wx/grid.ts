// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets 3.2.4 (wxWindows Library Licence).
/**
 * `<wx/grid.h>`: `wxGrid` without its window - the table, the attributes,
 * the grid cursor, the selection, the cell editor's lifecycle and the grid
 * events. This is what KiCad's `WX_GRID` and `GRID_TRICKS` call; a view
 * (`grid_ui.tsx`) draws it and feeds it the user's clicks and keys.
 *
 * Ported from wxWidgets 3.2.4's `src/generic/grid.cpp` and
 * `src/generic/gridsel.cpp` (the release the KiCad build links; source kept
 * at ~/wx-reference). The selection is wx's list of blocks, normalised per
 * selection mode, and `qa/probes/grid_selection_probe.cpp` holds wx's own
 * answers for it. Painting, sizing, scrolling and the native header are the
 * view's.
 */
import type { wxMenu } from './menu.js';
import {
  WXK,
  wxEVT_CHAR_HOOK,
  wxEVT_KEY_DOWN,
  wxEvent,
  wxEvtHandler,
  type wxEventType,
  type wxKeyEvent,
  wxMOD_CONTROL,
  wxMOD_NONE,
  wxMOD_SHIFT,
  wxNewEventType,
} from './wx_event.js';

// ---------------------------------------------------------------------------
// coordinates

/** `wxGridCellCoords`. */
export class wxGridCellCoords {
  constructor(
    public m_row = -1,
    public m_col = -1,
  ) {}

  GetRow(): number {
    return this.m_row;
  }
  SetRow(aRow: number): void {
    this.m_row = aRow;
  }
  GetCol(): number {
    return this.m_col;
  }
  SetCol(aCol: number): void {
    this.m_col = aCol;
  }
  Set(aRow: number, aCol: number): void {
    this.m_row = aRow;
    this.m_col = aCol;
  }
  equals(aOther: wxGridCellCoords): boolean {
    return this.m_row === aOther.m_row && this.m_col === aOther.m_col;
  }
}

/** `wxGridNoCellCoords`. */
export const wxGridNoCellCoords = (): wxGridCellCoords => new wxGridCellCoords(-1, -1);

export const wxHORIZONTAL = 0x0004;
export const wxVERTICAL = 0x0008;

/** `wxGridBlockCoords`: a rectangle of cells. */
export class wxGridBlockCoords {
  constructor(
    public m_topRow = -1,
    public m_leftCol = -1,
    public m_bottomRow = -1,
    public m_rightCol = -1,
  ) {}

  GetTopRow(): number {
    return this.m_topRow;
  }
  GetLeftCol(): number {
    return this.m_leftCol;
  }
  GetBottomRow(): number {
    return this.m_bottomRow;
  }
  GetRightCol(): number {
    return this.m_rightCol;
  }
  GetTopLeft(): wxGridCellCoords {
    return new wxGridCellCoords(this.m_topRow, this.m_leftCol);
  }
  GetBottomRight(): wxGridCellCoords {
    return new wxGridCellCoords(this.m_bottomRow, this.m_rightCol);
  }

  Canonicalize(): wxGridBlockCoords {
    const r = new wxGridBlockCoords(
      this.m_topRow,
      this.m_leftCol,
      this.m_bottomRow,
      this.m_rightCol,
    );

    if (r.m_topRow > r.m_bottomRow) [r.m_topRow, r.m_bottomRow] = [r.m_bottomRow, r.m_topRow];

    if (r.m_leftCol > r.m_rightCol) [r.m_leftCol, r.m_rightCol] = [r.m_rightCol, r.m_leftCol];

    return r;
  }

  Intersects(aOther: wxGridBlockCoords): boolean {
    return (
      this.m_topRow <= aOther.m_bottomRow &&
      this.m_bottomRow >= aOther.m_topRow &&
      this.m_leftCol <= aOther.m_rightCol &&
      this.m_rightCol >= aOther.m_leftCol
    );
  }

  /** Whether this block contains the cell, or fully contains the other block. */
  Contains(aOther: wxGridCellCoords | wxGridBlockCoords): boolean {
    if (aOther instanceof wxGridCellCoords)
      return (
        this.m_topRow <= aOther.m_row &&
        aOther.m_row <= this.m_bottomRow &&
        this.m_leftCol <= aOther.m_col &&
        aOther.m_col <= this.m_rightCol
      );

    return (
      this.m_topRow <= aOther.m_topRow &&
      aOther.m_bottomRow <= this.m_bottomRow &&
      this.m_leftCol <= aOther.m_leftCol &&
      aOther.m_rightCol <= this.m_rightCol
    );
  }

  /**
   * The parts of this block outside `aOther`, up to four (grid.cpp:1341):
   * wxHORIZONTAL splits whole-width bands above [0] and below [1], then the
   * left [2] and right [3] of the band `aOther` crosses; wxVERTICAL the same
   * turned on its side. A missing part is null.
   */
  Difference(aOther: wxGridBlockCoords, aSplitOrientation: number): (wxGridBlockCoords | null)[] {
    const parts: (wxGridBlockCoords | null)[] = [null, null, null, null];

    if (!this.Intersects(aOther)) {
      parts[0] = this;
      return parts;
    }

    if (aSplitOrientation === wxHORIZONTAL) {
      if (this.m_topRow < aOther.m_topRow)
        parts[0] = new wxGridBlockCoords(
          this.m_topRow,
          this.m_leftCol,
          aOther.m_topRow - 1,
          this.m_rightCol,
        );

      if (this.m_bottomRow > aOther.m_bottomRow)
        parts[1] = new wxGridBlockCoords(
          aOther.m_bottomRow + 1,
          this.m_leftCol,
          this.m_bottomRow,
          this.m_rightCol,
        );

      const maxTopRow = Math.max(this.m_topRow, aOther.m_topRow);
      const minBottomRow = Math.min(this.m_bottomRow, aOther.m_bottomRow);

      if (this.m_leftCol < aOther.m_leftCol)
        parts[2] = new wxGridBlockCoords(
          maxTopRow,
          this.m_leftCol,
          minBottomRow,
          aOther.m_leftCol - 1,
        );

      if (this.m_rightCol > aOther.m_rightCol)
        parts[3] = new wxGridBlockCoords(
          maxTopRow,
          aOther.m_rightCol + 1,
          minBottomRow,
          this.m_rightCol,
        );
    } else {
      if (this.m_leftCol < aOther.m_leftCol)
        parts[0] = new wxGridBlockCoords(
          this.m_topRow,
          this.m_leftCol,
          this.m_bottomRow,
          aOther.m_leftCol - 1,
        );

      if (this.m_rightCol > aOther.m_rightCol)
        parts[1] = new wxGridBlockCoords(
          this.m_topRow,
          aOther.m_rightCol + 1,
          this.m_bottomRow,
          this.m_rightCol,
        );

      const maxLeftCol = Math.max(this.m_leftCol, aOther.m_leftCol);
      const minRightCol = Math.min(this.m_rightCol, aOther.m_rightCol);

      if (this.m_topRow < aOther.m_topRow)
        parts[2] = new wxGridBlockCoords(
          this.m_topRow,
          maxLeftCol,
          aOther.m_topRow - 1,
          minRightCol,
        );

      if (this.m_bottomRow > aOther.m_bottomRow)
        parts[3] = new wxGridBlockCoords(
          aOther.m_bottomRow + 1,
          maxLeftCol,
          this.m_bottomRow,
          minRightCol,
        );
    }

    return parts;
  }

  equals(aOther: wxGridBlockCoords): boolean {
    return (
      this.m_topRow === aOther.m_topRow &&
      this.m_leftCol === aOther.m_leftCol &&
      this.m_bottomRow === aOther.m_bottomRow &&
      this.m_rightCol === aOther.m_rightCol
    );
  }
}

// ---------------------------------------------------------------------------
// events

export const wxEVT_GRID_CELL_LEFT_CLICK = wxNewEventType();
export const wxEVT_GRID_CELL_RIGHT_CLICK = wxNewEventType();
export const wxEVT_GRID_CELL_LEFT_DCLICK = wxNewEventType();
export const wxEVT_GRID_CELL_RIGHT_DCLICK = wxNewEventType();
export const wxEVT_GRID_LABEL_LEFT_CLICK = wxNewEventType();
export const wxEVT_GRID_LABEL_RIGHT_CLICK = wxNewEventType();
export const wxEVT_GRID_LABEL_LEFT_DCLICK = wxNewEventType();
export const wxEVT_GRID_LABEL_RIGHT_DCLICK = wxNewEventType();
export const wxEVT_GRID_CELL_CHANGING = wxNewEventType();
export const wxEVT_GRID_CELL_CHANGED = wxNewEventType();
export const wxEVT_GRID_SELECT_CELL = wxNewEventType();
export const wxEVT_GRID_EDITOR_SHOWN = wxNewEventType();
export const wxEVT_GRID_EDITOR_HIDDEN = wxNewEventType();
export const wxEVT_GRID_RANGE_SELECTED = wxNewEventType();
export const wxEVT_GRID_COL_MOVE = wxNewEventType();
export const wxEVT_GRID_COL_SORT = wxNewEventType();

/** `wxGridEvent`: a cell event, vetoable. */
export class wxGridEvent extends wxEvent {
  private m_allowed = true;
  private m_string = '';

  constructor(
    aType: wxEventType,
    private readonly m_grid: wxGrid,
    private readonly m_row = -1,
    private readonly m_col = -1,
    private readonly m_modifiers = 0,
  ) {
    super(aType);
  }

  override GetEventObject(): wxGrid {
    return this.m_grid;
  }
  GetRow(): number {
    return this.m_row;
  }
  GetCol(): number {
    return this.m_col;
  }
  /** `wxKeyboardState::GetModifiers()`: the wxMOD_* flags of the click. */
  GetModifiers(): number {
    return this.m_modifiers;
  }
  GetString(): string {
    return this.m_string;
  }
  SetString(aString: string): void {
    this.m_string = aString;
  }
  Veto(): void {
    this.m_allowed = false;
  }
  Allow(): void {
    this.m_allowed = true;
  }
  IsAllowed(): boolean {
    return this.m_allowed;
  }
}

/** `wxGridRangeSelectEvent`. */
export class wxGridRangeSelectEvent extends wxEvent {
  constructor(
    aType: wxEventType,
    private readonly m_topLeft: wxGridCellCoords,
    private readonly m_bottomRight: wxGridCellCoords,
    private readonly m_selecting: boolean,
  ) {
    super(aType);
  }

  GetTopLeftCoords(): wxGridCellCoords {
    return this.m_topLeft;
  }
  GetBottomRightCoords(): wxGridCellCoords {
    return this.m_bottomRight;
  }
  Selecting(): boolean {
    return this.m_selecting;
  }
}

// ---------------------------------------------------------------------------
// cell renderers, editors and attributes

export const wxGRID_VALUE_STRING = 'string';
export const wxGRID_VALUE_BOOL = 'bool';
export const wxGRID_VALUE_NUMBER = 'long';
export const wxGRID_VALUE_FLOAT = 'double';
export const wxGRID_VALUE_CHOICE = 'choice';

/** `wxGridCellRenderer`: how a cell draws. The view reads the class. */
export class wxGridCellRenderer {}

/** `wxGridCellStringRenderer`. */
export class wxGridCellStringRenderer extends wxGridCellRenderer {}

/** `wxGridCellBoolRenderer`: a check box. */
export class wxGridCellBoolRenderer extends wxGridCellRenderer {}

/**
 * `wxGridCellEditor`: the control a cell is edited in. `BeginEdit` takes the
 * cell's value, the view edits {@link m_value}, `EndEdit` reports whether it
 * changed and `ApplyEdit` writes it back.
 */
export class wxGridCellEditor {
  /** The value the edit started from (`m_value` in wx's text editor). */
  protected m_startValue = '';
  /** What the control holds now. */
  m_value = '';

  BeginEdit(aRow: number, aCol: number, aGrid: wxGrid): void {
    this.m_startValue = aGrid.GetTable()!.GetValue(aRow, aCol);
    this.m_value = this.m_startValue;
  }

  /**
   * `EndEdit( row, col, grid, oldval, newval )`: false when nothing changed.
   */
  EndEdit(
    _aRow: number,
    _aCol: number,
    _aGrid: wxGrid,
    _aOldVal: string,
    aNewVal: { value: string },
  ): boolean {
    if (this.m_value === this.m_startValue) return false;

    aNewVal.value = this.m_value;
    return true;
  }

  ApplyEdit(aRow: number, aCol: number, aGrid: wxGrid): void {
    aGrid.GetTable()!.SetValue(aRow, aCol, this.m_value);
  }

  /** `Reset()`: back to the value the edit started from. */
  Reset(): void {
    this.m_value = this.m_startValue;
  }
}

/** `wxGridCellTextEditor`. */
export class wxGridCellTextEditor extends wxGridCellEditor {}

/** `wxGridCellBoolEditor`: "1" or "" in a string table. */
export class wxGridCellBoolEditor extends wxGridCellEditor {}

/** `wxGridCellChoiceEditor`: a combo over fixed choices. */
export class wxGridCellChoiceEditor extends wxGridCellEditor {
  constructor(
    public readonly m_choices: readonly string[] = [],
    public readonly m_allowOthers = false,
  ) {
    super();
  }
}

/** `wxGridCellAttr::wxAttrKind`. */
export enum wxAttrKind {
  Any,
  Cell,
  Row,
  Col,
  Default,
  Merged,
}

/** `wxGridCellAttr`: what a cell, row or column overrides. */
export class wxGridCellAttr {
  private m_readOnly: boolean | undefined;
  private m_editor: wxGridCellEditor | null = null;
  private m_renderer: wxGridCellRenderer | null = null;

  Clone(): wxGridCellAttr {
    const a = new wxGridCellAttr();
    a.m_readOnly = this.m_readOnly;
    a.m_editor = this.m_editor;
    a.m_renderer = this.m_renderer;
    return a;
  }

  SetReadOnly(aReadOnly = true): void {
    this.m_readOnly = aReadOnly;
  }
  IsReadOnly(): boolean {
    return this.m_readOnly === true;
  }
  HasReadWriteMode(): boolean {
    return this.m_readOnly !== undefined;
  }

  SetEditor(aEditor: wxGridCellEditor | null): void {
    this.m_editor = aEditor;
  }
  HasEditor(): boolean {
    return this.m_editor !== null;
  }
  GetEditorPtr(): wxGridCellEditor | null {
    return this.m_editor;
  }

  SetRenderer(aRenderer: wxGridCellRenderer | null): void {
    this.m_renderer = aRenderer;
  }
  HasRenderer(): boolean {
    return this.m_renderer !== null;
  }
  GetRendererPtr(): wxGridCellRenderer | null {
    return this.m_renderer;
  }

  /** `MergeWith( mergefrom )`: take what this attr does not set itself. */
  MergeWith(aFrom: wxGridCellAttr): void {
    if (!this.HasReadWriteMode() && aFrom.HasReadWriteMode()) this.m_readOnly = aFrom.m_readOnly;

    if (!this.HasEditor() && aFrom.HasEditor()) this.m_editor = aFrom.m_editor;

    if (!this.HasRenderer() && aFrom.HasRenderer()) this.m_renderer = aFrom.m_renderer;
  }
}

/**
 * `wxGridCellAttrProvider`: the cell, row and column attributes a table keeps,
 * merged cell first.
 */
export class wxGridCellAttrProvider {
  private m_cellAttrs = new Map<string, wxGridCellAttr>();
  private m_rowAttrs = new Map<number, wxGridCellAttr>();
  private m_colAttrs = new Map<number, wxGridCellAttr>();

  GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    const cell = this.m_cellAttrs.get(`${aRow},${aCol}`) ?? null;
    const row = this.m_rowAttrs.get(aRow) ?? null;
    const col = this.m_colAttrs.get(aCol) ?? null;

    switch (aKind) {
      case wxAttrKind.Cell:
        return cell;
      case wxAttrKind.Row:
        return row;
      case wxAttrKind.Col:
        return col;
      default: {
        const present = [cell, row, col].filter((a): a is wxGridCellAttr => a !== null);

        if (present.length === 0) return null;

        if (present.length === 1) return present[0]!;

        const merged = present[0]!.Clone();

        for (const a of present.slice(1)) merged.MergeWith(a);

        return merged;
      }
    }
  }

  SetAttr(aAttr: wxGridCellAttr | null, aRow: number, aCol: number): void {
    const key = `${aRow},${aCol}`;

    if (aAttr) this.m_cellAttrs.set(key, aAttr);
    else this.m_cellAttrs.delete(key);
  }

  SetRowAttr(aAttr: wxGridCellAttr | null, aRow: number): void {
    if (aAttr) this.m_rowAttrs.set(aRow, aAttr);
    else this.m_rowAttrs.delete(aRow);
  }

  SetColAttr(aAttr: wxGridCellAttr | null, aCol: number): void {
    if (aAttr) this.m_colAttrs.set(aCol, aAttr);
    else this.m_colAttrs.delete(aCol);
  }

  /** `UpdateAttrRows( pos, numRows )`: shift the row-keyed attributes. */
  UpdateAttrRows(aPos: number, aNumRows: number): void {
    const cells = new Map<string, wxGridCellAttr>();

    for (const [key, attr] of this.m_cellAttrs) {
      const [row, col] = key.split(',').map(Number) as [number, number];

      if (row < aPos) cells.set(key, attr);
      else if (aNumRows > 0 || row >= aPos - aNumRows) cells.set(`${row + aNumRows},${col}`, attr);
    }

    this.m_cellAttrs = cells;

    const rows = new Map<number, wxGridCellAttr>();

    for (const [row, attr] of this.m_rowAttrs) {
      if (row < aPos) rows.set(row, attr);
      else if (aNumRows > 0 || row >= aPos - aNumRows) rows.set(row + aNumRows, attr);
    }

    this.m_rowAttrs = rows;
  }

  /** `UpdateAttrCols( pos, numCols )`. */
  UpdateAttrCols(aPos: number, aNumCols: number): void {
    const cells = new Map<string, wxGridCellAttr>();

    for (const [key, attr] of this.m_cellAttrs) {
      const [row, col] = key.split(',').map(Number) as [number, number];

      if (col < aPos) cells.set(key, attr);
      else if (aNumCols > 0 || col >= aPos - aNumCols) cells.set(`${row},${col + aNumCols}`, attr);
    }

    this.m_cellAttrs = cells;

    const cols = new Map<number, wxGridCellAttr>();

    for (const [col, attr] of this.m_colAttrs) {
      if (col < aPos) cols.set(col, attr);
      else if (aNumCols > 0 || col >= aPos - aNumCols) cols.set(col + aNumCols, attr);
    }

    this.m_colAttrs = cols;
  }
}

// ---------------------------------------------------------------------------
// the table

/** The table messages `wxGridTableBase` sends its view (`wxGridTableMessage`). */
export enum wxGridTableRequest {
  wxGRIDTABLE_NOTIFY_ROWS_INSERTED,
  wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
  wxGRIDTABLE_NOTIFY_ROWS_DELETED,
  wxGRIDTABLE_NOTIFY_COLS_INSERTED,
  wxGRIDTABLE_NOTIFY_COLS_APPENDED,
  wxGRIDTABLE_NOTIFY_COLS_DELETED,
}

/** `wxGridTableBase`: the data a grid shows. */
export abstract class wxGridTableBase {
  private m_view: wxGrid | null = null;
  private m_attrProvider: wxGridCellAttrProvider | null = null;

  abstract GetNumberRows(): number;
  abstract GetNumberCols(): number;
  abstract GetValue(aRow: number, aCol: number): string;
  abstract SetValue(aRow: number, aCol: number, aValue: string): void;

  IsEmptyCell(aRow: number, aCol: number): boolean {
    return this.GetValue(aRow, aCol) === '';
  }

  GetTypeName(_aRow: number, _aCol: number): string {
    return wxGRID_VALUE_STRING;
  }

  /** `CanGetValueAs`: a string table answers only strings. */
  CanGetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return aTypeName === this.GetTypeName(aRow, aCol) || aTypeName === wxGRID_VALUE_STRING;
  }

  CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }

  GetValueAsBool(_aRow: number, _aCol: number): boolean {
    return false;
  }

  SetValueAsBool(_aRow: number, _aCol: number, _aValue: boolean): void {}

  Clear(): void {}

  InsertRows(_aPos = 0, _aNumRows = 1): boolean {
    return false;
  }
  AppendRows(_aNumRows = 1): boolean {
    return false;
  }
  DeleteRows(_aPos = 0, _aNumRows = 1): boolean {
    return false;
  }
  InsertCols(_aPos = 0, _aNumCols = 1): boolean {
    return false;
  }
  AppendCols(_aNumCols = 1): boolean {
    return false;
  }
  DeleteCols(_aPos = 0, _aNumCols = 1): boolean {
    return false;
  }

  GetRowLabelValue(aRow: number): string {
    return String(aRow + 1);
  }

  /** `GetColLabelValue`: "A", "B", … "Z", "AA", … by default. */
  GetColLabelValue(aCol: number): string {
    let s = '';
    let n = aCol;

    for (;;) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);

      if (n === 0) break;

      n--;
    }

    return s;
  }

  SetRowLabelValue(_aRow: number, _aValue: string): void {}
  SetColLabelValue(_aCol: number, _aValue: string): void {}

  SetView(aGrid: wxGrid | null): void {
    this.m_view = aGrid;
  }
  GetView(): wxGrid | null {
    return this.m_view;
  }

  SetAttrProvider(aProvider: wxGridCellAttrProvider | null): void {
    this.m_attrProvider = aProvider;
  }
  GetAttrProvider(): wxGridCellAttrProvider | null {
    return this.m_attrProvider;
  }
  CanHaveAttributes(): boolean {
    if (!this.m_attrProvider) this.m_attrProvider = new wxGridCellAttrProvider();

    return true;
  }

  GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    return this.m_attrProvider ? this.m_attrProvider.GetAttr(aRow, aCol, aKind) : null;
  }

  SetAttr(aAttr: wxGridCellAttr | null, aRow: number, aCol: number): void {
    if (this.CanHaveAttributes()) this.m_attrProvider!.SetAttr(aAttr, aRow, aCol);
  }
  SetRowAttr(aAttr: wxGridCellAttr | null, aRow: number): void {
    if (this.CanHaveAttributes()) this.m_attrProvider!.SetRowAttr(aAttr, aRow);
  }
  SetColAttr(aAttr: wxGridCellAttr | null, aCol: number): void {
    if (this.CanHaveAttributes()) this.m_attrProvider!.SetColAttr(aAttr, aCol);
  }

  /** Send the view a table message (`GetView()->ProcessTableMessage( msg )`). */
  protected notify(aId: wxGridTableRequest, aInt: number, aInt2 = 0): void {
    this.m_view?.ProcessTableMessage(aId, aInt, aInt2);
  }
}

/** `wxGridStringTable`: a table of strings, what `CreateGrid` makes. */
export class wxGridStringTable extends wxGridTableBase {
  private m_data: string[][] = [];
  private m_numCols: number;
  private m_rowLabels: string[] = [];
  private m_colLabels: string[] = [];

  constructor(aNumRows = 0, aNumCols = 0) {
    super();
    this.m_numCols = aNumCols;
    this.m_data = Array.from({ length: aNumRows }, () => new Array<string>(aNumCols).fill(''));
  }

  GetNumberRows(): number {
    return this.m_data.length;
  }
  GetNumberCols(): number {
    return this.m_numCols;
  }
  GetValue(aRow: number, aCol: number): string {
    return this.m_data[aRow]?.[aCol] ?? '';
  }
  SetValue(aRow: number, aCol: number, aValue: string): void {
    const row = this.m_data[aRow];

    if (row && aCol >= 0 && aCol < this.m_numCols) row[aCol] = aValue;
  }

  override Clear(): void {
    for (const row of this.m_data) row.fill('');
  }

  override InsertRows(aPos = 0, aNumRows = 1): boolean {
    if (aPos >= this.m_data.length) return this.AppendRows(aNumRows);

    const rows = Array.from({ length: aNumRows }, () => new Array<string>(this.m_numCols).fill(''));
    this.m_data.splice(aPos, 0, ...rows);
    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_INSERTED, aPos, aNumRows);
    return true;
  }

  override AppendRows(aNumRows = 1): boolean {
    for (let i = 0; i < aNumRows; ++i) this.m_data.push(new Array<string>(this.m_numCols).fill(''));

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, aNumRows);
    return true;
  }

  override DeleteRows(aPos = 0, aNumRows = 1): boolean {
    const curNumRows = this.m_data.length;

    if (aPos >= curNumRows) return false;

    const num = Math.min(aNumRows, curNumRows - aPos);
    this.m_data.splice(aPos, num);
    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aPos, num);
    return true;
  }

  override AppendCols(aNumCols = 1): boolean {
    for (const row of this.m_data) row.push(...new Array<string>(aNumCols).fill(''));

    this.m_numCols += aNumCols;
    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_COLS_APPENDED, aNumCols);
    return true;
  }

  override GetRowLabelValue(aRow: number): string {
    return this.m_rowLabels[aRow] ?? super.GetRowLabelValue(aRow);
  }
  override GetColLabelValue(aCol: number): string {
    return this.m_colLabels[aCol] ?? super.GetColLabelValue(aCol);
  }
  override SetRowLabelValue(aRow: number, aValue: string): void {
    this.m_rowLabels[aRow] = aValue;
  }
  override SetColLabelValue(aCol: number, aValue: string): void {
    this.m_colLabels[aCol] = aValue;
  }
}

// ---------------------------------------------------------------------------
// the selection

/** `wxGrid::wxGridSelectionModes`. */
export enum wxGridSelectionModes {
  wxGridSelectCells,
  wxGridSelectRows,
  wxGridSelectColumns,
  wxGridSelectRowsOrColumns,
  wxGridSelectNone,
}

/** `wxGridSelection` (gridsel.cpp): the selected blocks, in the order made. */
class wxGridSelection {
  private m_selection: wxGridBlockCoords[] = [];

  constructor(
    private readonly m_grid: wxGrid,
    private m_selectionMode: wxGridSelectionModes,
  ) {}

  IsSelection(): boolean {
    return this.m_selection.length > 0;
  }

  IsInSelection(aRow: number, aCol: number): boolean {
    const cell = new wxGridCellCoords(aRow, aCol);
    return this.m_selection.some((b) => b.Contains(cell));
  }

  GetSelectionMode(): wxGridSelectionModes {
    return this.m_selectionMode;
  }

  SetSelectionMode(aSelmode: wxGridSelectionModes): void {
    if (aSelmode === this.m_selectionMode) return;

    if (aSelmode === wxGridSelectionModes.wxGridSelectNone) {
      this.ClearSelection();
      this.m_selectionMode = aSelmode;
      return;
    }

    if (this.m_selectionMode !== wxGridSelectionModes.wxGridSelectCells) {
      if (aSelmode !== wxGridSelectionModes.wxGridSelectCells) this.ClearSelection();

      this.m_selectionMode = aSelmode;
      return;
    }

    // Selection blocks that no longer fit the new mode are dropped.
    const lastCol = this.m_grid.GetNumberCols() - 1;
    const lastRow = this.m_grid.GetNumberRows() - 1;

    for (let n = this.m_selection.length; n > 0; ) {
      n--;
      const block = this.m_selection[n]!;
      const fullRows = block.GetLeftCol() === 0 && block.GetRightCol() === lastCol;
      const fullCols = block.GetTopRow() === 0 && block.GetBottomRow() === lastRow;
      let valid = false;

      switch (aSelmode) {
        case wxGridSelectionModes.wxGridSelectRows:
          valid = fullRows;
          break;
        case wxGridSelectionModes.wxGridSelectColumns:
          valid = fullCols;
          break;
        case wxGridSelectionModes.wxGridSelectRowsOrColumns:
          valid = fullRows || fullCols;
          break;
      }

      if (!valid) this.m_selection.splice(n, 1);
    }

    this.m_selectionMode = aSelmode;
  }

  SelectRow(aRow: number): void {
    if (
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectColumns ||
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectNone
    )
      return;

    this.Select(new wxGridBlockCoords(aRow, 0, aRow, this.m_grid.GetNumberCols() - 1), true);
  }

  SelectCol(aCol: number): void {
    if (
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectRows ||
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectNone
    )
      return;

    this.Select(new wxGridBlockCoords(0, aCol, this.m_grid.GetNumberRows() - 1, aCol), true);
  }

  SelectBlock(
    aTopRow: number,
    aLeftCol: number,
    aBottomRow: number,
    aRightCol: number,
    aSendEvent = true,
  ): void {
    let topRow = aTopRow;
    let leftCol = aLeftCol;
    let bottomRow = aBottomRow;
    let rightCol = aRightCol;
    let allowed = false;

    switch (this.m_selectionMode) {
      case wxGridSelectionModes.wxGridSelectCells:
        allowed = true;
        break;
      case wxGridSelectionModes.wxGridSelectRows:
        leftCol = 0;
        rightCol = this.m_grid.GetNumberCols() - 1;
        allowed = true;
        break;
      case wxGridSelectionModes.wxGridSelectColumns:
        topRow = 0;
        bottomRow = this.m_grid.GetNumberRows() - 1;
        allowed = true;
        break;
      case wxGridSelectionModes.wxGridSelectRowsOrColumns:
        allowed =
          (topRow === 0 && bottomRow === this.m_grid.GetNumberRows() - 1) ||
          (leftCol === 0 && rightCol === this.m_grid.GetNumberCols() - 1);
        break;
      case wxGridSelectionModes.wxGridSelectNone:
        allowed = false;
        break;
    }

    if (!allowed) return;

    this.Select(
      new wxGridBlockCoords(topRow, leftCol, bottomRow, rightCol).Canonicalize(),
      aSendEvent,
    );
  }

  SelectAll(): void {
    this.m_selection = [];

    const numRows = this.m_grid.GetNumberRows();
    const numCols = this.m_grid.GetNumberCols();

    if (numRows && numCols)
      this.Select(new wxGridBlockCoords(0, 0, numRows - 1, numCols - 1), true);
  }

  DeselectBlock(aBlock: wxGridBlockCoords): void {
    if (this.m_selectionMode === wxGridSelectionModes.wxGridSelectNone) return;

    const canonical = aBlock.Canonicalize();

    // The parts re-added below go on the end, past `count`: they are not
    // looked at again (gridsel.cpp's loop bound).
    let count = this.m_selection.length;

    for (let n = 0; n < count; n++) {
      const selBlock = this.m_selection[n]!;

      if (!selBlock.Intersects(canonical)) continue;

      let splitOrientation: number;

      switch (this.m_selectionMode) {
        case wxGridSelectionModes.wxGridSelectRows:
          splitOrientation = wxHORIZONTAL;
          break;
        case wxGridSelectionModes.wxGridSelectColumns:
          splitOrientation = wxVERTICAL;
          break;
        default:
          splitOrientation =
            selBlock.GetLeftCol() === 0 &&
            selBlock.GetRightCol() === this.m_grid.GetNumberCols() - 1
              ? wxHORIZONTAL
              : wxVERTICAL;
      }

      const result = selBlock.Difference(canonical, splitOrientation);

      this.m_selection.splice(n, 1);
      n--;
      count--;

      for (let i = 0; i < 2; ++i) {
        const part = result[i];

        if (part) this.SelectBlockNoEvent(part);
      }

      // The side parts: a row- or column-selection cannot hold them.
      for (let i = 2; i < 4; ++i) {
        const part = result[i];

        if (part && this.m_selectionMode === wxGridSelectionModes.wxGridSelectCells)
          this.SelectBlockNoEvent(part);
      }
    }

    this.m_grid.sendRangeSelected(canonical, false);
  }

  ClearSelection(): void {
    this.m_selection = [];

    this.m_grid.sendRangeSelected(
      new wxGridBlockCoords(0, 0, this.m_grid.GetNumberRows() - 1, this.m_grid.GetNumberCols() - 1),
      false,
    );
  }

  /** `UpdateRows( pos, numRows )`: shift or trim the blocks over an insert or delete. */
  UpdateRows(aPos: number, aNumRows: number): void {
    for (let n = 0; n < this.m_selection.length; n++) {
      const block = this.m_selection[n]!;
      const row1 = block.m_topRow;
      const row2 = block.m_bottomRow;

      if (row2 < aPos) continue;

      if (aNumRows > 0) {
        block.m_bottomRow = row2 + aNumRows;

        if (row1 >= aPos) block.m_topRow = row1 + aNumRows;
      } else if (aNumRows < 0) {
        if (row2 >= aPos - aNumRows) {
          block.m_bottomRow = row2 + aNumRows;

          if (row1 >= aPos) block.m_topRow = Math.max(row1 + aNumRows, aPos);
        } else if (row1 >= aPos) {
          this.m_selection.splice(n, 1);
          n--;
        } else {
          block.m_bottomRow = aPos;
        }
      }
    }
  }

  /** `UpdateCols( pos, numCols )`. */
  UpdateCols(aPos: number, aNumCols: number): void {
    for (let n = 0; n < this.m_selection.length; n++) {
      const block = this.m_selection[n]!;
      const col1 = block.m_leftCol;
      const col2 = block.m_rightCol;

      if (col2 < aPos) continue;

      if (aNumCols > 0) {
        block.m_rightCol = col2 + aNumCols;

        if (col1 >= aPos) block.m_leftCol = col1 + aNumCols;
      } else if (aNumCols < 0) {
        if (col2 >= aPos - aNumCols) {
          block.m_rightCol = col2 + aNumCols;

          if (col1 >= aPos) block.m_leftCol = Math.max(col1 + aNumCols, aPos);
        } else if (col1 >= aPos) {
          this.m_selection.splice(n, 1);
          n--;
        } else {
          block.m_rightCol = aPos;
        }
      }
    }
  }

  /**
   * `ExtendCurrentBlock( blockStart, blockEnd )`: grow or shrink the last
   * block from its anchor corner - the keyboard's Shift+arrow.
   */
  ExtendCurrentBlock(aBlockStart: wxGridCellCoords, aBlockEnd: wxGridCellCoords): boolean {
    if (this.m_selectionMode === wxGridSelectionModes.wxGridSelectNone) return false;

    const cursor = this.m_grid.GetGridCursorCoords();

    if (!this.IsInSelection(cursor.m_row, cursor.m_col)) {
      this.SelectBlock(aBlockStart.m_row, aBlockStart.m_col, aBlockEnd.m_row, aBlockEnd.m_col);
      return true;
    }

    const block = this.m_selection[this.m_selection.length - 1]!;
    const newBlock = new wxGridBlockCoords(
      block.m_topRow,
      block.m_leftCol,
      block.m_bottomRow,
      block.m_rightCol,
    );
    let canChangeRow = false;
    let canChangeCol = false;

    switch (this.m_selectionMode) {
      case wxGridSelectionModes.wxGridSelectCells:
        canChangeRow = true;
        canChangeCol = true;
        break;
      case wxGridSelectionModes.wxGridSelectColumns:
        canChangeCol = true;
        break;
      case wxGridSelectionModes.wxGridSelectRows:
        canChangeRow = true;
        break;
      case wxGridSelectionModes.wxGridSelectRowsOrColumns:
        if (block.m_topRow !== 0 || block.m_bottomRow !== this.m_grid.GetNumberRows() - 1)
          canChangeRow = true;
        else if (block.m_leftCol !== 0 || block.m_rightCol !== this.m_grid.GetNumberCols() - 1)
          canChangeCol = true;
        else {
          canChangeRow = true;
          canChangeCol = true;
        }
        break;
    }

    if (canChangeRow) {
      if (aBlockStart.m_row === block.m_topRow) newBlock.m_bottomRow = aBlockEnd.m_row;
      else if (aBlockStart.m_row === block.m_bottomRow) newBlock.m_topRow = aBlockEnd.m_row;
      else {
        const top = Math.min(aBlockStart.m_row, aBlockEnd.m_row);
        const bottom = Math.max(aBlockStart.m_row, aBlockEnd.m_row);

        if (top < newBlock.m_topRow) newBlock.m_topRow = top;
        if (bottom > newBlock.m_bottomRow) newBlock.m_bottomRow = bottom;
      }
    }

    if (canChangeCol) {
      if (aBlockStart.m_col === block.m_leftCol) newBlock.m_rightCol = aBlockEnd.m_col;
      else if (aBlockStart.m_col === block.m_rightCol) newBlock.m_leftCol = aBlockEnd.m_col;
      else {
        const left = Math.min(aBlockStart.m_col, aBlockEnd.m_col);
        const right = Math.max(aBlockStart.m_col, aBlockEnd.m_col);

        if (left < newBlock.m_leftCol) newBlock.m_leftCol = left;
        if (right > newBlock.m_rightCol) newBlock.m_rightCol = right;
      }
    }

    const canonical = newBlock.Canonicalize();

    if (canonical.equals(block)) return false;

    this.m_selection[this.m_selection.length - 1] = canonical;
    this.m_grid.sendRangeSelected(canonical, true);
    return true;
  }

  /**
   * `GetExtensionAnchor`: the corner of the last block opposite the cursor,
   * which Shift+arrow moves.
   */
  GetExtensionAnchor(): wxGridCellCoords {
    const coords = this.m_grid.GetGridCursorCoords();

    if (!this.IsInSelection(coords.m_row, coords.m_col)) return coords;

    const block = this.m_selection[this.m_selection.length - 1]!;

    if (block.m_topRow === coords.m_row) coords.m_row = block.m_bottomRow;
    else if (block.m_bottomRow === coords.m_row) coords.m_row = block.m_topRow;

    if (block.m_leftCol === coords.m_col) coords.m_col = block.m_rightCol;
    else if (block.m_rightCol === coords.m_col) coords.m_col = block.m_leftCol;

    return coords;
  }

  GetCellSelection(): wxGridCellCoords[] {
    if (this.m_selectionMode !== wxGridSelectionModes.wxGridSelectCells) return [];

    return this.m_selection
      .filter((b) => b.m_topRow === b.m_bottomRow && b.m_leftCol === b.m_rightCol)
      .map((b) => b.GetTopLeft());
  }

  GetBlockSelectionTopLeft(): wxGridCellCoords[] {
    return this.m_selection.map((b) => b.GetTopLeft());
  }

  GetBlockSelectionBottomRight(): wxGridCellCoords[] {
    return this.m_selection.map((b) => b.GetBottomRight());
  }

  /** `GetRowSelection`: every row a full-width block covers, sorted, once. */
  GetRowSelection(): number[] {
    if (
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectColumns ||
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectNone
    )
      return [];

    const rows = new Set<number>();

    for (const b of this.m_selection)
      if (b.m_leftCol === 0 && b.m_rightCol === this.m_grid.GetNumberCols() - 1)
        for (let r = b.m_topRow; r <= b.m_bottomRow; ++r) rows.add(r);

    return [...rows].sort((a, b) => a - b);
  }

  /** `GetColSelection`: every column a full-height block covers, sorted, once. */
  GetColSelection(): number[] {
    if (
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectRows ||
      this.m_selectionMode === wxGridSelectionModes.wxGridSelectNone
    )
      return [];

    const cols = new Set<number>();

    for (const b of this.m_selection)
      if (b.m_topRow === 0 && b.m_bottomRow === this.m_grid.GetNumberRows() - 1)
        for (let c = b.m_leftCol; c <= b.m_rightCol; ++c) cols.add(c);

    return [...cols].sort((a, b) => a - b);
  }

  private SelectBlockNoEvent(aBlock: wxGridBlockCoords): void {
    this.SelectBlock(
      aBlock.m_topRow,
      aBlock.m_leftCol,
      aBlock.m_bottomRow,
      aBlock.m_rightCol,
      false,
    );
  }

  /** `Select( block )`: really select it, whatever the mode. */
  private Select(aBlock: wxGridBlockCoords, aSendEvent: boolean): void {
    if (this.m_grid.GetNumberRows() === 0 || this.m_grid.GetNumberCols() === 0) return;

    this.m_selection.push(aBlock);

    if (aSendEvent) this.m_grid.sendRangeSelected(aBlock, true);
  }
}

// ---------------------------------------------------------------------------
// the grid

/** `wxGrid::EventResult`. */
enum EventResult {
  Event_Vetoed = -1,
  Event_Unhandled,
  Event_Handled,
  Event_CellDeleted,
}

/**
 * `wxGrid`, headless. A view subscribes with {@link SetRefreshListener} and
 * redraws when the model says so (`Refresh`, `ForceRefresh`).
 */
export class wxGrid extends wxEvtHandler {
  private m_table: wxGridTableBase | null = null;
  private m_ownTable = false;
  private m_numRows = 0;
  private m_numCols = 0;
  private m_currentCellCoords = wxGridNoCellCoords();
  private m_selection: wxGridSelection | null = null;
  private m_editable = true;
  protected m_cellEditCtrlEnabled = false;
  private m_hiddenCols = new Set<number>();
  private m_batchCount = 0;
  private m_defaultCellAttr = (() => {
    const a = new wxGridCellAttr();
    a.SetReadOnly(false);
    return a;
  })();
  /**
   * `wxGridTypeRegistry`: one editor and one renderer per data type, shared by
   * every cell of that type - so asking a cell for its editor again mid-edit
   * (`WX_GRID::CommitPendingChanges` does) gets the editor that holds the edit.
   */
  private m_typeEditors = new Map<string, wxGridCellEditor>([
    [wxGRID_VALUE_STRING, new wxGridCellTextEditor()],
    [wxGRID_VALUE_BOOL, new wxGridCellBoolEditor()],
  ]);
  private m_typeRenderers = new Map<string, wxGridCellRenderer>([
    [wxGRID_VALUE_STRING, new wxGridCellStringRenderer()],
    [wxGRID_VALUE_BOOL, new wxGridCellBoolRenderer()],
  ]);
  /** The editor of the cell being edited, kept for the edit's life. */
  private m_currentEditor: wxGridCellEditor | null = null;
  private m_refreshListener: (() => void) | null = null;

  // ---- creation --------------------------------------------------------

  /** `CreateGrid( numRows, numCols, selmode )`: a string table of our own. */
  CreateGrid(
    aNumRows: number,
    aNumCols: number,
    aSelmode = wxGridSelectionModes.wxGridSelectCells,
  ): boolean {
    return this.SetTable(new wxGridStringTable(aNumRows, aNumCols), true, aSelmode);
  }

  /** `SetTable( table, takeOwnership, selmode )`. */
  SetTable(
    aTable: wxGridTableBase | null,
    aTakeOwnership = false,
    aSelmode = wxGridSelectionModes.wxGridSelectCells,
  ): boolean {
    if (this.m_table) {
      this.m_table.SetView(null);
      this.m_table = null;
      this.m_selection = null;
      this.m_numRows = 0;
      this.m_numCols = 0;
    }

    this.m_currentCellCoords = wxGridNoCellCoords();
    this.m_hiddenCols.clear();

    if (aTable) {
      this.m_numRows = aTable.GetNumberRows();
      this.m_numCols = aTable.GetNumberCols();
      this.m_table = aTable;
      this.m_table.SetView(this);
      this.m_ownTable = aTakeOwnership;
      this.m_selection = new wxGridSelection(this, aSelmode);
      this.UpdateCurrentCellOnRedim();
    }

    this.Refresh();
    return true;
  }

  GetTable(): wxGridTableBase | null {
    return this.m_table;
  }

  /** Whether the table was handed over with `SetTable( table, true )`. */
  OwnsTable(): boolean {
    return this.m_ownTable;
  }

  GetNumberRows(): number {
    return this.m_numRows;
  }
  GetNumberCols(): number {
    return this.m_numCols;
  }

  /** `ProcessTableMessage` / `Redimension`: the table grew or shrank. */
  ProcessTableMessage(aId: wxGridTableRequest, aInt: number, aInt2: number): boolean {
    this.HideCellEditControl();

    const attrs = this.m_table?.GetAttrProvider() ?? null;

    switch (aId) {
      case wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_INSERTED:
        this.m_numRows += aInt2;
        this.m_selection?.UpdateRows(aInt, aInt2);
        attrs?.UpdateAttrRows(aInt, aInt2);
        break;
      case wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED:
        this.m_numRows += aInt;
        break;
      case wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED:
        this.m_numRows -= aInt2;
        this.m_selection?.UpdateRows(aInt, -aInt2);
        attrs?.UpdateAttrRows(aInt, -aInt2);
        break;
      case wxGridTableRequest.wxGRIDTABLE_NOTIFY_COLS_INSERTED:
        this.m_numCols += aInt2;
        this.m_selection?.UpdateCols(aInt, aInt2);
        attrs?.UpdateAttrCols(aInt, aInt2);
        break;
      case wxGridTableRequest.wxGRIDTABLE_NOTIFY_COLS_APPENDED:
        this.m_numCols += aInt;
        break;
      case wxGridTableRequest.wxGRIDTABLE_NOTIFY_COLS_DELETED:
        this.m_numCols -= aInt2;
        this.m_selection?.UpdateCols(aInt, -aInt2);
        attrs?.UpdateAttrCols(aInt, -aInt2);
        break;
    }

    this.UpdateCurrentCellOnRedim();
    this.Refresh();
    return true;
  }

  /** `UpdateCurrentCellOnRedim`: keep the cursor on a cell that exists. */
  private UpdateCurrentCellOnRedim(): void {
    if (this.m_currentCellCoords.equals(wxGridNoCellCoords())) {
      if (this.m_numCols > 0 && this.m_numRows > 0) this.SetCurrentCell(0, 0);
    } else if (this.m_numCols === 0 || this.m_numRows === 0) {
      this.m_currentCellCoords = wxGridNoCellCoords();
    } else {
      const updated = new wxGridCellCoords(
        Math.min(this.m_currentCellCoords.m_row, this.m_numRows - 1),
        Math.min(this.m_currentCellCoords.m_col, this.m_numCols - 1),
      );

      if (!updated.equals(this.m_currentCellCoords)) {
        this.m_currentCellCoords = wxGridNoCellCoords();
        this.SetCurrentCell(updated.m_row, updated.m_col);
      }
    }
  }

  InsertRows(aPos = 0, aNumRows = 1): boolean {
    if (!this.m_table) return false;

    this.DisableCellEditControl();
    return this.m_table.InsertRows(aPos, aNumRows);
  }

  AppendRows(aNumRows = 1): boolean {
    return this.m_table ? this.m_table.AppendRows(aNumRows) : false;
  }

  DeleteRows(aPos = 0, aNumRows = 1): boolean {
    if (!this.m_table) return false;

    this.DisableCellEditControl();
    return this.m_table.DeleteRows(aPos, aNumRows);
  }

  ClearGrid(): void {
    if (this.m_table) {
      this.DisableCellEditControl();
      this.m_table.Clear();
      this.Refresh();
    }
  }

  // ---- values and labels -------------------------------------------------

  GetCellValue(aRow: number, aCol: number): string {
    return this.m_table ? this.m_table.GetValue(aRow, aCol) : '';
  }

  SetCellValue(aRow: number, aCol: number, aValue: string): void {
    if (this.m_table) {
      this.m_table.SetValue(aRow, aCol, aValue);
      this.Refresh();
    }
  }

  GetColLabelValue(aCol: number): string {
    return this.m_table ? this.m_table.GetColLabelValue(aCol) : '';
  }
  SetColLabelValue(aCol: number, aValue: string): void {
    this.m_table?.SetColLabelValue(aCol, aValue);
    this.Refresh();
  }
  GetRowLabelValue(aRow: number): string {
    return this.m_table ? this.m_table.GetRowLabelValue(aRow) : '';
  }
  SetRowLabelValue(aRow: number, aValue: string): void {
    this.m_table?.SetRowLabelValue(aRow, aValue);
    this.Refresh();
  }

  // ---- columns -----------------------------------------------------------

  IsColShown(aCol: number): boolean {
    return !this.m_hiddenCols.has(aCol);
  }
  ShowCol(aCol: number): void {
    this.m_hiddenCols.delete(aCol);
    this.Refresh();
  }
  HideCol(aCol: number): void {
    this.m_hiddenCols.add(aCol);
    this.Refresh();
  }

  // ---- attributes, editors, renderers ------------------------------------

  IsEditable(): boolean {
    return this.m_editable;
  }

  EnableEditing(aEdit: boolean): void {
    if (aEdit !== this.m_editable) {
      if (!aEdit) this.DisableCellEditControl();

      this.m_editable = aEdit;
    }
  }

  /** `GetCellAttrPtr`: the table's attribute merged over the default. */
  GetCellAttr(aRow: number, aCol: number): wxGridCellAttr {
    const attr = this.m_table?.GetAttr(aRow, aCol, wxAttrKind.Any) ?? null;
    const merged = attr ? attr.Clone() : new wxGridCellAttr();
    merged.MergeWith(this.m_defaultCellAttr);
    return merged;
  }

  IsReadOnly(aRow: number, aCol: number): boolean {
    return this.GetCellAttr(aRow, aCol).IsReadOnly();
  }

  SetReadOnly(aRow: number, aCol: number, aIsReadOnly = true): void {
    if (!this.m_table?.CanHaveAttributes()) return;

    const attr = this.m_table.GetAttr(aRow, aCol, wxAttrKind.Cell)?.Clone() ?? new wxGridCellAttr();
    attr.SetReadOnly(aIsReadOnly);
    this.m_table.SetAttr(attr, aRow, aCol);
  }

  SetColAttr(aCol: number, aAttr: wxGridCellAttr | null): void {
    this.m_table?.SetColAttr(aAttr, aCol);
    this.Refresh();
  }

  SetCellEditor(aRow: number, aCol: number, aEditor: wxGridCellEditor): void {
    if (!this.m_table?.CanHaveAttributes()) return;

    const attr = this.m_table.GetAttr(aRow, aCol, wxAttrKind.Cell)?.Clone() ?? new wxGridCellAttr();
    attr.SetEditor(aEditor);
    this.m_table.SetAttr(attr, aRow, aCol);
  }

  SetCellRenderer(aRow: number, aCol: number, aRenderer: wxGridCellRenderer): void {
    if (!this.m_table?.CanHaveAttributes()) return;

    const attr = this.m_table.GetAttr(aRow, aCol, wxAttrKind.Cell)?.Clone() ?? new wxGridCellAttr();
    attr.SetRenderer(aRenderer);
    this.m_table.SetAttr(attr, aRow, aCol);
  }

  /** `RegisterDataType( typeName, renderer, editor )`. */
  RegisterDataType(
    aTypeName: string,
    aRenderer: wxGridCellRenderer,
    aEditor: wxGridCellEditor,
  ): void {
    this.m_typeRenderers.set(aTypeName, aRenderer);
    this.m_typeEditors.set(aTypeName, aEditor);
  }

  /** `GetCellEditor`: the attribute's, else the one for the cell's type. */
  GetCellEditor(aRow: number, aCol: number): wxGridCellEditor {
    const attr = this.GetCellAttr(aRow, aCol);

    if (attr.HasEditor()) return attr.GetEditorPtr()!;

    const type = this.m_table?.GetTypeName(aRow, aCol) ?? wxGRID_VALUE_STRING;
    return this.m_typeEditors.get(type) ?? this.m_typeEditors.get(wxGRID_VALUE_STRING)!;
  }

  /** `GetCellRenderer`: the attribute's, else the one for the cell's type. */
  GetCellRenderer(aRow: number, aCol: number): wxGridCellRenderer {
    const attr = this.GetCellAttr(aRow, aCol);

    if (attr.HasRenderer()) return attr.GetRendererPtr()!;

    const type = this.m_table?.GetTypeName(aRow, aCol) ?? wxGRID_VALUE_STRING;
    return this.m_typeRenderers.get(type) ?? this.m_typeRenderers.get(wxGRID_VALUE_STRING)!;
  }

  // ---- the grid cursor -----------------------------------------------------

  GetGridCursorRow(): number {
    return this.m_currentCellCoords.m_row;
  }
  GetGridCursorCol(): number {
    return this.m_currentCellCoords.m_col;
  }
  GetGridCursorCoords(): wxGridCellCoords {
    return new wxGridCellCoords(this.m_currentCellCoords.m_row, this.m_currentCellCoords.m_col);
  }

  /** `SetGridCursor( row, col )`: `SetCurrentCell`. */
  SetGridCursor(aRow: number, aCol: number): void {
    this.SetCurrentCell(aRow, aCol);
  }

  /** `GoToCell`: the cursor, and (in a view) scroll it into sight. */
  GoToCell(aRow: number, aCol: number): void {
    this.SetCurrentCell(aRow, aCol);
  }

  /**
   * `SetCurrentCell`: `wxEVT_GRID_SELECT_CELL` may veto the move; otherwise
   * the edit in progress is accepted and the cursor moves. The selection is
   * left as it is.
   */
  SetCurrentCell(aRow: number, aCol: number): boolean {
    switch (this.SendEvent(wxEVT_GRID_SELECT_CELL, aRow, aCol)) {
      case EventResult.Event_Vetoed:
      case EventResult.Event_CellDeleted:
        return false;
    }

    if (!this.m_currentCellCoords.equals(wxGridNoCellCoords())) this.DisableCellEditControl();

    this.m_currentCellCoords = new wxGridCellCoords(aRow, aCol);
    this.Refresh();
    return true;
  }

  // ---- the selection -------------------------------------------------------

  GetSelectionMode(): wxGridSelectionModes {
    return this.m_selection
      ? this.m_selection.GetSelectionMode()
      : wxGridSelectionModes.wxGridSelectCells;
  }

  SetSelectionMode(aSelmode: wxGridSelectionModes): void {
    this.m_selection?.SetSelectionMode(aSelmode);
    this.Refresh();
  }

  SelectRow(aRow: number, aAddToSelected = false): void {
    if (!this.m_selection) return;

    if (!aAddToSelected) this.ClearSelection();

    this.m_selection.SelectRow(aRow);
    this.Refresh();
  }

  SelectCol(aCol: number, aAddToSelected = false): void {
    if (!this.m_selection) return;

    if (!aAddToSelected) this.ClearSelection();

    this.m_selection.SelectCol(aCol);
    this.Refresh();
  }

  SelectBlock(
    aTopRow: number,
    aLeftCol: number,
    aBottomRow: number,
    aRightCol: number,
    aAddToSelected = false,
  ): void {
    if (!this.m_selection) return;

    if (!aAddToSelected) this.ClearSelection();

    this.m_selection.SelectBlock(aTopRow, aLeftCol, aBottomRow, aRightCol);
    this.Refresh();
  }

  SelectAll(): void {
    this.m_selection?.SelectAll();
    this.Refresh();
  }

  DeselectRow(aRow: number): void {
    if (aRow < 0 || aRow >= this.m_numRows) return;

    this.m_selection?.DeselectBlock(new wxGridBlockCoords(aRow, 0, aRow, this.m_numCols - 1));
    this.Refresh();
  }

  DeselectCol(aCol: number): void {
    if (aCol < 0 || aCol >= this.m_numCols) return;

    this.m_selection?.DeselectBlock(new wxGridBlockCoords(0, aCol, this.m_numRows - 1, aCol));
    this.Refresh();
  }

  DeselectCell(aRow: number, aCol: number): void {
    if (aRow < 0 || aRow >= this.m_numRows || aCol < 0 || aCol >= this.m_numCols) return;

    this.m_selection?.DeselectBlock(new wxGridBlockCoords(aRow, aCol, aRow, aCol));
    this.Refresh();
  }

  ClearSelection(): void {
    this.m_selection?.ClearSelection();
    this.Refresh();
  }

  IsSelection(): boolean {
    return this.m_selection?.IsSelection() ?? false;
  }

  IsInSelection(aRow: number, aCol: number): boolean {
    return this.m_selection?.IsInSelection(aRow, aCol) ?? false;
  }

  GetSelectedCells(): wxGridCellCoords[] {
    return this.m_selection?.GetCellSelection() ?? [];
  }
  GetSelectionBlockTopLeft(): wxGridCellCoords[] {
    return this.m_selection?.GetBlockSelectionTopLeft() ?? [];
  }
  GetSelectionBlockBottomRight(): wxGridCellCoords[] {
    return this.m_selection?.GetBlockSelectionBottomRight() ?? [];
  }
  GetSelectedRows(): number[] {
    return this.m_selection?.GetRowSelection() ?? [];
  }
  GetSelectedCols(): number[] {
    return this.m_selection?.GetColSelection() ?? [];
  }

  /** @internal `wxEVT_GRID_RANGE_SELECTED` for a block (de)selected. */
  sendRangeSelected(aBlock: wxGridBlockCoords, aSelecting: boolean): void {
    this.ProcessEvent(
      new wxGridRangeSelectEvent(
        wxEVT_GRID_RANGE_SELECTED,
        aBlock.GetTopLeft(),
        aBlock.GetBottomRight(),
        aSelecting,
      ),
    );
  }

  // ---- the cell editor -------------------------------------------------------

  IsCellEditControlEnabled(): boolean {
    return this.m_cellEditCtrlEnabled;
  }

  /** A view shows the control whenever it is enabled. */
  IsCellEditControlShown(): boolean {
    return this.m_cellEditCtrlEnabled && this.m_currentEditor !== null;
  }

  IsCurrentCellReadOnly(): boolean {
    return this.IsReadOnly(this.m_currentCellCoords.m_row, this.m_currentCellCoords.m_col);
  }

  CanEnableCellControl(): boolean {
    return (
      this.m_editable &&
      !this.m_currentCellCoords.equals(wxGridNoCellCoords()) &&
      !this.IsCurrentCellReadOnly()
    );
  }

  /** The editor of the cell being edited, for the view to bind to. */
  GetCurrentEditor(): wxGridCellEditor | null {
    return this.m_cellEditCtrlEnabled ? this.m_currentEditor : null;
  }

  EnableCellEditControl(aEnable = true): void {
    if (!this.m_editable) return;

    if (aEnable !== this.m_cellEditCtrlEnabled) {
      if (aEnable) {
        if (!this.CanEnableCellControl()) return;

        this.DoEnableCellEditControl();
      } else {
        this.DoDisableCellEditControl();
      }
    }
  }

  DisableCellEditControl(): void {
    this.EnableCellEditControl(false);
  }

  private DoEnableCellEditControl(): boolean {
    switch (this.SendCurrentCellEvent(wxEVT_GRID_EDITOR_SHOWN)) {
      case EventResult.Event_Vetoed:
      case EventResult.Event_CellDeleted:
        return false;
    }

    const { m_row: row, m_col: col } = this.m_currentCellCoords;
    this.m_currentEditor = this.GetCellEditor(row, col);
    this.m_currentEditor.BeginEdit(row, col, this);
    this.m_cellEditCtrlEnabled = true;
    this.Refresh();
    return true;
  }

  private DoDisableCellEditControl(): void {
    this.SendCurrentCellEvent(wxEVT_GRID_EDITOR_HIDDEN);
    this.DoAcceptCellEditControl();
  }

  HideCellEditControl(): void {
    if (this.IsCellEditControlEnabled()) this.DoHideCellEditControl();
  }

  private DoHideCellEditControl(): void {
    this.Refresh();
  }

  AcceptCellEditControlIfShown(): void {
    if (this.IsCellEditControlShown()) this.DoAcceptCellEditControl();
  }

  private DoAcceptCellEditControl(): void {
    // Reset it first to avoid recursion through DisableCellEditControl() from
    // the user's handlers.
    this.m_cellEditCtrlEnabled = false;

    this.DoHideCellEditControl();
    this.DoSaveEditControlValue();
    this.m_currentEditor = null;
  }

  SaveEditControlValue(): void {
    if (this.IsCellEditControlEnabled()) this.DoSaveEditControlValue();
  }

  /**
   * `DoSaveEditControlValue`: if the value changed, `wxEVT_GRID_CELL_CHANGING`
   * may veto it; otherwise it is applied and `wxEVT_GRID_CELL_CHANGED` sent,
   * which may still veto it and put the old value back.
   */
  private DoSaveEditControlValue(): void {
    const editor = this.m_currentEditor;

    if (!editor) return;

    const { m_row: row, m_col: col } = this.m_currentCellCoords;
    const oldval = this.GetCellValue(row, col);
    const newval = { value: '' };

    if (!editor.EndEdit(row, col, this, oldval, newval)) return;

    switch (this.SendEvent(wxEVT_GRID_CELL_CHANGING, row, col, newval.value)) {
      case EventResult.Event_Vetoed:
      case EventResult.Event_CellDeleted:
        break;
      default:
        editor.ApplyEdit(row, col, this);

        if (this.SendEvent(wxEVT_GRID_CELL_CHANGED, row, col, oldval) === EventResult.Event_Vetoed)
          this.SetCellValue(row, col, oldval);
    }
  }

  // ---- the keyboard -----------------------------------------------------------

  /**
   * One step along a row or column from `aCoords`, past hidden columns
   * (`wxGridForward/BackwardOperations::TryToAdvance`); null at the edge.
   */
  private advance(aCoords: wxGridCellCoords, aDir: 'up' | 'down' | 'left' | 'right'): boolean {
    if (aDir === 'up' || aDir === 'down') {
      const step = aDir === 'down' ? 1 : -1;
      const row = aCoords.m_row + step;

      if (row < 0 || row >= this.m_numRows) return false;

      aCoords.m_row = row;
      return true;
    }

    const step = aDir === 'right' ? 1 : -1;

    for (let col = aCoords.m_col + step; col >= 0 && col < this.m_numCols; col += step) {
      if (this.IsColShown(col)) {
        aCoords.m_col = col;
        return true;
      }
    }

    return false;
  }

  /**
   * `DoMoveCursor`: with Shift, extend the selection from its anchor; without,
   * clear it and move the cursor. (Ctrl+arrow's `DoMoveCursorByBlock`, the
   * jump to the edge of the filled cells, moves one cell here.)
   */
  private DoMoveCursor(aExpand: boolean, aDir: 'up' | 'down' | 'left' | 'right'): boolean {
    if (this.m_currentCellCoords.equals(wxGridNoCellCoords())) return false;

    if (aExpand) {
      if (!this.m_selection) return false;

      const coords = this.m_selection.GetExtensionAnchor();

      if (!this.advance(coords, aDir)) return false;

      if (this.m_selection.ExtendCurrentBlock(this.GetGridCursorCoords(), coords)) this.Refresh();
    } else {
      this.ClearSelection();

      const coords = this.GetGridCursorCoords();

      if (!this.advance(coords, aDir)) return false;

      this.GoToCell(coords.m_row, coords.m_col);
    }

    return true;
  }

  MoveCursorUp(aExpandSelection: boolean): boolean {
    return this.DoMoveCursor(aExpandSelection, 'up');
  }
  MoveCursorDown(aExpandSelection: boolean): boolean {
    return this.DoMoveCursor(aExpandSelection, 'down');
  }
  MoveCursorLeft(aExpandSelection: boolean): boolean {
    return this.DoMoveCursor(aExpandSelection, 'left');
  }
  MoveCursorRight(aExpandSelection: boolean): boolean {
    return this.DoMoveCursor(aExpandSelection, 'right');
  }

  /** `DoGridProcessTab` with the default `Tab_Stop`: along the row, then stop. */
  DoGridProcessTab(aShift: boolean): void {
    if (!aShift) {
      if (this.GetGridCursorCol() < this.GetNumberCols() - 1) {
        this.MoveCursorRight(false);
        return;
      }
    } else if (this.GetGridCursorCol()) {
      this.MoveCursorLeft(false);
      return;
    }

    this.DisableCellEditControl();
  }

  /** `OnKeyDown`, the class handler: the cursor keys, Enter, Esc, Tab, Home/End, Space. */
  OnKeyDown(aEvent: wxKeyEvent): void {
    const shift = aEvent.state.ShiftDown();
    const ctrl = aEvent.state.ControlDown();

    switch (aEvent.GetKeyCode()) {
      case WXK.WXK_UP:
        this.DoMoveCursor(shift, 'up');
        break;
      case WXK.WXK_DOWN:
        this.DoMoveCursor(shift, 'down');
        break;
      case WXK.WXK_LEFT:
        this.DoMoveCursor(shift, 'left');
        break;
      case WXK.WXK_RIGHT:
        this.DoMoveCursor(shift, 'right');
        break;
      case WXK.WXK_RETURN:
      case WXK.WXK_NUMPAD_ENTER:
        if (ctrl) {
          aEvent.Skip(); // to let the edit control have the return
        } else {
          this.DisableCellEditControl();
          this.MoveCursorDown(shift);
        }
        break;
      case WXK.WXK_ESCAPE:
        this.ClearSelection();
        break;
      case WXK.WXK_TAB:
        this.DoGridProcessTab(shift);
        break;
      case WXK.WXK_HOME:
      case WXK.WXK_END:
        if (!this.m_currentCellCoords.equals(wxGridNoCellCoords())) {
          const toStart = aEvent.GetKeyCode() === WXK.WXK_HOME;
          let row: number;

          if (ctrl) row = toStart ? 0 : this.m_numRows - 1;
          else if (this.m_selection && shift) row = this.m_selection.GetExtensionAnchor().m_row;
          else row = this.m_currentCellCoords.m_row;

          let col: number;

          if (toStart) for (col = 0; col < this.m_numCols && !this.IsColShown(col); ++col);
          else for (col = this.m_numCols - 1; col >= 0 && !this.IsColShown(col); --col);

          if (shift) {
            this.m_selection?.ExtendCurrentBlock(
              this.GetGridCursorCoords(),
              new wxGridCellCoords(row, col),
            );
            this.Refresh();
          } else {
            this.ClearSelection();
            this.GoToCell(row, col);
          }
        }
        break;
      case ' '.charCodeAt(0): {
        if (!this.m_selection) {
          aEvent.Skip();
          break;
        }

        const anchor = this.m_selection.GetExtensionAnchor();
        let selStart: wxGridCellCoords | null = null;
        let selEnd: wxGridCellCoords | null = null;

        switch (aEvent.GetModifiers()) {
          case wxMOD_CONTROL:
            selStart = new wxGridCellCoords(0, this.m_currentCellCoords.m_col);
            selEnd = new wxGridCellCoords(this.m_numRows - 1, anchor.m_col);
            break;
          case wxMOD_SHIFT:
            selStart = new wxGridCellCoords(this.m_currentCellCoords.m_row, 0);
            selEnd = new wxGridCellCoords(anchor.m_row, this.m_numCols - 1);
            break;
          case wxMOD_CONTROL | wxMOD_SHIFT:
            selStart = new wxGridCellCoords(0, 0);
            selEnd = new wxGridCellCoords(this.m_numRows - 1, this.m_numCols - 1);
            break;
          case wxMOD_NONE:
            if (!this.IsEditable()) {
              this.MoveCursorRight(false);
              break;
            }
            aEvent.Skip();
            break;
          default:
            aEvent.Skip();
        }

        if (selStart && selEnd) {
          this.m_selection.ExtendCurrentBlock(selStart, selEnd);
          this.Refresh();
        }
        break;
      }
      default:
        aEvent.Skip();
    }
  }

  /**
   * `OnChar`: F2, or a key the editor takes, opens the editor on the cursor;
   * a typed character becomes its text (`wxGridCellTextEditor::StartingKey`).
   */
  OnChar(aEvent: wxKeyEvent): void {
    if (this.IsCellEditControlEnabled() || !this.CanEnableCellControl()) {
      aEvent.Skip();
      return;
    }

    const specialEditKey = aEvent.GetKeyCode() === WXK.WXK_F2 && !aEvent.state.HasAnyModifiers();
    const ch = aEvent.GetUnicodeKey();
    const accepted =
      !aEvent.state.ControlDown() && !aEvent.state.AltDown() && ch >= 0x20 && ch !== 0x7f;

    if (specialEditKey || accepted) {
      if (this.DoEnableCellEditControl() && !specialEditKey && this.m_currentEditor)
        this.m_currentEditor.m_value = String.fromCodePoint(ch);
    } else {
      aEvent.Skip();
    }
  }

  /**
   * `wxGridCellEditorEvtHandler::OnKeyDown`, the open editor's own keys: Esc
   * abandons, Tab moves along, Enter goes to the grid's handler.
   *
   * @return true when the editor's key was handled here.
   */
  EditorKeyDown(aEvent: wxKeyEvent): boolean {
    switch (aEvent.GetKeyCode()) {
      case WXK.WXK_ESCAPE:
        this.m_currentEditor?.Reset();
        this.DisableCellEditControl();
        return true;
      case WXK.WXK_TAB:
        this.DisableCellEditControl();
        this.DoGridProcessTab(aEvent.state.ShiftDown());
        return true;
      case WXK.WXK_RETURN:
      case WXK.WXK_NUMPAD_ENTER:
        if (!this.ProcessEvent(aEvent)) this.OnKeyDown(aEvent);
        return !aEvent.GetSkipped();
      default:
        return false;
    }
  }

  /**
   * A key as wx routes it: `wxEVT_CHAR_HOOK` first (GRID_TRICKS' hook),
   * then - with the editor open - the editor's own handler, otherwise the
   * `wxEVT_KEY_DOWN` handlers and the class's `OnKeyDown`, and last `OnChar`.
   *
   * @return true when something handled it (the view prevents the default).
   */
  HandleKey(aEvent: wxKeyEvent): boolean {
    aEvent.SetEventType(wxEVT_CHAR_HOOK);

    if (this.ProcessEvent(aEvent)) return true;

    if (this.IsCellEditControlEnabled()) {
      aEvent.SetEventType(wxEVT_KEY_DOWN);
      return this.EditorKeyDown(aEvent);
    }

    aEvent.SetEventType(wxEVT_KEY_DOWN);

    if (this.ProcessEvent(aEvent)) return true;

    aEvent.Skip(false);
    this.OnKeyDown(aEvent);

    if (!aEvent.GetSkipped()) return true;

    aEvent.Skip(false);
    this.OnChar(aEvent);
    return !aEvent.GetSkipped();
  }

  // ---- events and refresh ------------------------------------------------------

  private SendCurrentCellEvent(aType: wxEventType): EventResult {
    return this.SendEvent(aType, this.m_currentCellCoords.m_row, this.m_currentCellCoords.m_col);
  }

  /** `SendEvent( type, row, col, string )`: vetoed, deleted, handled or not. */
  SendEvent(aType: wxEventType, aRow: number, aCol: number, aString = ''): EventResult {
    const evt = new wxGridEvent(aType, this, aRow, aCol);
    evt.SetString(aString);
    return this.DoSendEvent(evt);
  }

  /** `DoSendEvent`. */
  DoSendEvent(aEvent: wxGridEvent): EventResult {
    const claimed = this.ProcessEvent(aEvent);

    if (!aEvent.IsAllowed()) return EventResult.Event_Vetoed;

    if (aEvent.GetRow() >= this.GetNumberRows() || aEvent.GetCol() >= this.GetNumberCols())
      return EventResult.Event_CellDeleted;

    return claimed ? EventResult.Event_Handled : EventResult.Event_Unhandled;
  }

  BeginBatch(): void {
    this.m_batchCount++;
  }
  EndBatch(): void {
    if (this.m_batchCount > 0) {
      this.m_batchCount--;

      if (this.m_batchCount === 0) this.Refresh();
    }
  }
  GetBatchCount(): number {
    return this.m_batchCount;
  }

  private m_popupPresenter: ((aMenu: wxMenu, aOnSelect: (aId: number) => void) => void) | null =
    null;
  private m_navigateHandler: (() => void) | null = null;

  /** The view's context menu: shows `aMenu`, calls back with the chosen item's id. */
  SetPopupMenuPresenter(
    aPresenter: ((aMenu: wxMenu, aOnSelect: (aId: number) => void) => void) | null,
  ): void {
    this.m_popupPresenter = aPresenter;
  }

  /**
   * `PopupMenu( menu )`: wx's is modal and dispatches the choice as a menu
   * event; a page's menu is not, so the choice comes back through `aOnSelect`.
   */
  PopupMenu(aMenu: wxMenu, aOnSelect: (aId: number) => void): void {
    this.m_popupPresenter?.(aMenu, aOnSelect);
  }

  /** The view's focus move out of the grid (Ctrl+Tab). */
  SetNavigateHandler(aHandler: (() => void) | null): void {
    this.m_navigateHandler = aHandler;
  }

  /** `Navigate()`: focus the next control after the grid. */
  Navigate(): void {
    this.m_navigateHandler?.();
  }

  /** The view's redraw, called whenever the model changes outside a batch. */
  SetRefreshListener(aListener: (() => void) | null): void {
    this.m_refreshListener = aListener;
  }

  Refresh(): void {
    if (this.m_batchCount === 0) this.m_refreshListener?.();
  }

  /** `ForceRefresh`: redraw even inside a batch. */
  ForceRefresh(): void {
    this.m_refreshListener?.();
  }
}

export { EventResult as wxGridEventResult };
