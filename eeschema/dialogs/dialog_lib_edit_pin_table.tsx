// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_EDIT_PIN_TABLE` (eeschema/dialogs/dialog_lib_edit_pin_table.{h,cpp}): the symbol
 * editor's Pin Table. As in the .cpp: the column labels, PIN_INFO_FORMATTER (a pin's fields as text
 * and back), PIN_TABLE_DATA_MODEL (rows of one pin, or of the pins sharing a name), the CSV export
 * and import, then the dialog and its window.
 *
 * Not here: adjustGridColumns() (AutoSizeColumn and the scroll-bar width are not ported: the Number
 * column takes the slack instead).
 */
import { type JSX, useState } from 'react';
import { CANDIDATE } from '@ziroeda/common/eda_item_flags.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { CSV_WRITER, AutoDecodeCSV } from '@ziroeda/common/io/csv.js';
import {
  GetTabularDataFromClipboard,
  SaveTabularDataToClipboard,
} from '@ziroeda/common/clipboard.js';
import { type UnsavedChangesResult, handleUnsavedChanges } from '@ziroeda/common/confirm.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { PIN_NUMBERS } from '@ziroeda/common/pin_numbers.js';
import {
  type ELECTRICAL_PINTYPE,
  type GRAPHIC_PINSHAPE,
  PIN_ORIENTATION,
} from '@ziroeda/common/pin_type.js';
import {
  NULL_REPORTER,
  RPT_SEVERITY_ERROR,
  type Reporter,
  WX_STRING_REPORTER,
} from '@ziroeda/common/reporter.js';
import { AccumulateDescriptions, strNumCmp } from '@ziroeda/common/string_utils.js';
// libeval's NUMERIC_EVALUATOR is not ported; KiCad's NUMERIC_EVALUATOR_COMPAT stands in, as in
// TEXT_CTRL_EVAL.
import { NUMERIC_EVALUATOR_COMPAT as NUMERIC_EVALUATOR } from '@ziroeda/common/text_eval/text_eval_wrapper.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { GRID_CELL_COMBOBOX } from '@ziroeda/common/widgets/grid_combobox.js';
import {
  GRID_CELL_ICON_TEXT_POPUP,
  GRID_CELL_ICON_TEXT_RENDERER,
} from '@ziroeda/common/widgets/grid_icon_text_helpers.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  CsvFileExtension,
  csvFileWildcard,
  csvTsvFileWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import {
  wxALIGN_CENTER,
  wxFD_FILE_MUST_EXIST,
  wxFD_OPEN,
  wxFD_OVERWRITE_PROMPT,
  wxFD_SAVE,
} from '@ziroeda/wx/defs.js';
import { wxReadFileSync, wxWriteFileSync } from '@ziroeda/wx/filefn.js';
import {
  type wxGridEvent,
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxEVT_GRID_COL_SORT,
  wxEVT_GRID_EDITOR_SHOWN,
  wxGridCellAttr,
  wxGridCellBoolEditor,
  wxGridCellBoolRenderer,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { wxNOT_FOUND } from '@ziroeda/wx/listbox.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { LIB_SYMBOL } from '../lib_symbol.js';
import {
  PinOrientationIcons,
  PinOrientationIndex,
  PinOrientationNames,
  PinShapeIcons,
  PinShapeNames,
  PinTypeIcons,
  PinTypeNames,
} from '../pin_type.js';
import { SCH_PIN } from '../sch_pin.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import {
  DEMORGAN_ALL,
  DEMORGAN_ALT,
  DEMORGAN_STD,
  UNITS_ALL,
} from '../symbol_editor/symbol_edit_frame.js';
import { currentSymbolEditorSettings } from '../symbol_editor/symbol_editor_settings.js';
import { DIALOG_LIB_EDIT_PIN_TABLE_BASE } from './dialog_lib_edit_pin_table_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `COL_ORDER` (dialog_lib_edit_pin_table.h:28). */
export enum COL_ORDER {
  COL_PIN_COUNT,
  COL_NUMBER,
  COL_NAME,
  COL_TYPE,
  COL_SHAPE,
  COL_ORIENTATION,
  COL_NUMBER_SIZE,
  COL_NAME_SIZE,
  COL_LENGTH,
  COL_POSX,
  COL_POSY,
  COL_VISIBLE,
  COL_UNIT,
  COL_BODY_STYLE,

  COL_COUNT, // keep as last
}

const {
  COL_PIN_COUNT,
  COL_NUMBER,
  COL_NAME,
  COL_TYPE,
  COL_SHAPE,
  COL_ORIENTATION,
  COL_NUMBER_SIZE,
  COL_NAME_SIZE,
  COL_LENGTH,
  COL_POSX,
  COL_POSY,
  COL_VISIBLE,
  COL_UNIT,
  COL_BODY_STYLE,
  COL_COUNT,
} = COL_ORDER;

const BOOL_TRUE = 'True';
const BOOL_FALSE = 'False';

/** `GetPinTableColLabel( aCol )`: the column's label (not translated). */
export function GetPinTableColLabel(aCol: number): string {
  switch (aCol) {
    case COL_PIN_COUNT:
      return 'Count';
    case COL_NUMBER:
      return 'Number';
    case COL_NAME:
      return 'Name';
    case COL_TYPE:
      return 'Electrical Type';
    case COL_SHAPE:
      return 'Graphic Style';
    case COL_ORIENTATION:
      return 'Orientation';
    case COL_NUMBER_SIZE:
      return 'Number Text Size';
    case COL_NAME_SIZE:
      return 'Name Text Size';
    case COL_LENGTH:
      return 'Length';
    case COL_POSX:
      return 'X Position';
    case COL_POSY:
      return 'Y Position';
    case COL_VISIBLE:
      return 'Visible';
    case COL_UNIT:
      return 'Unit';
    case COL_BODY_STYLE:
      return 'Body Style';
    default:
      return ''; // wxFAIL
  }
}

/** `wxString::IsSameAs( aOther, aCaseSensitive )`. */
function isSameAs(aStr: string, aOther: string, aCaseSensitive: boolean): boolean {
  return aCaseSensitive ? aStr === aOther : aStr.toLowerCase() === aOther.toLowerCase();
}

/** `MatchTranslationOrNative()`: no translations here, so the native label. */
function MatchTranslationOrNative(
  aStr: string,
  aNativeLabel: string,
  aCaseSensitive: boolean,
): boolean {
  return (
    isSameAs(aNativeLabel, aStr, aCaseSensitive) || isSameAs(aStr, aNativeLabel, aCaseSensitive)
  );
}

/** `GetColTypeForString( aStr )`: the column a CSV header names, case ignored; COL_COUNT if none. */
export function GetColTypeForString(aStr: string): COL_ORDER {
  for (let i = 0; i < COL_COUNT; i++) {
    if (MatchTranslationOrNative(aStr, GetPinTableColLabel(i), false)) return i as COL_ORDER;
  }

  return COL_COUNT;
}

/** `wxArrayString::Index( aValue, bCase )`. */
function arrayIndex(aArray: readonly string[], aValue: string, aCase = true): number {
  return aArray.findIndex((s) => isSameAs(s, aValue, aCase));
}

export enum BOOL_FORMAT {
  ZERO_ONE,
  TRUE_FALSE,
}

/**
 * `PIN_INFO_FORMATTER`: a pin's fields as the strings the grid and CSV show, and back.
 */
export class PIN_INFO_FORMATTER {
  constructor(
    private readonly m_unitsProvider: UNITS_PROVIDER,
    private readonly m_includeUnits: boolean,
    private readonly m_boolFormat: BOOL_FORMAT,
    private readonly m_reporter: Reporter,
  ) {}

  Format(aPin: SCH_PIN, aFieldId: number): string {
    switch (aFieldId) {
      case COL_NAME:
        return aPin.GetName();

      case COL_NUMBER:
        return aPin.GetNumber();

      case COL_TYPE:
        return PinTypeNames()[aPin.GetType() as number] ?? '';

      case COL_SHAPE:
        return PinShapeNames()[aPin.GetShape() as number] ?? '';

      case COL_ORIENTATION: {
        const index = PinOrientationIndex(aPin.GetOrientation());

        if (index >= 0) return PinOrientationNames()[index] ?? '';

        return '';
      }

      case COL_NUMBER_SIZE:
        return this.m_unitsProvider.StringFromValue(aPin.GetNumberTextSize(), this.m_includeUnits);

      case COL_NAME_SIZE:
        return this.m_unitsProvider.StringFromValue(aPin.GetNameTextSize(), this.m_includeUnits);

      case COL_LENGTH:
        return this.m_unitsProvider.StringFromValue(aPin.GetLength(), this.m_includeUnits);

      case COL_POSX:
        return this.m_unitsProvider.StringFromValue(aPin.GetPosition().x, this.m_includeUnits);

      case COL_POSY:
        return this.m_unitsProvider.StringFromValue(aPin.GetPosition().y, this.m_includeUnits);

      case COL_VISIBLE:
        return this.stringFromBool(aPin.IsVisible());

      case COL_UNIT: {
        const parent = aPin.GetParentSymbol();

        if (parent && !parent.IsMultiUnit()) return UNITS_ALL;

        if (aPin.GetUnit() === 0) return UNITS_ALL;

        return aPin.GetUnitDisplayName(aPin.GetUnit(), true);
      }

      case COL_BODY_STYLE: {
        const parent = aPin.GetParentSymbol();

        if (parent && !parent.IsMultiBodyStyle()) return UNITS_ALL;

        if (aPin.GetBodyStyle() === 0) return DEMORGAN_ALL;

        return aPin.GetBodyStyleDescription(aPin.GetBodyStyle(), true);
      }

      default:
        return ''; // wxFAIL_MSG( "Invalid field id" )
    }
  }

  /**
   * Update the pin from the given col/string.
   *
   * How much this should follow the format is debatable, but for now it's fairly permissive
   * (e.g. bools import as 0/1 and no/yes).
   */
  UpdatePin(aPin: SCH_PIN, aValue: string, aFieldId: number, aSymbol: LIB_SYMBOL): void {
    switch (aFieldId) {
      case COL_NUMBER:
        aPin.SetNumber(aValue);
        break;

      case COL_NAME:
        aPin.SetName(aValue);
        break;

      // The found test ignores case, the index taken does not (wxArrayString::Index's default):
      // a name in another case sets wxNOT_FOUND, as upstream.
      case COL_TYPE:
        if (arrayIndex(PinTypeNames(), aValue, false) !== wxNOT_FOUND)
          aPin.SetType(arrayIndex(PinTypeNames(), aValue) as ELECTRICAL_PINTYPE);

        break;

      case COL_SHAPE:
        if (arrayIndex(PinShapeNames(), aValue, false) !== wxNOT_FOUND)
          aPin.SetShape(arrayIndex(PinShapeNames(), aValue) as GRAPHIC_PINSHAPE);

        break;

      case COL_ORIENTATION:
        if (arrayIndex(PinOrientationNames(), aValue, false) !== wxNOT_FOUND)
          aPin.SetOrientation(arrayIndex(PinOrientationNames(), aValue) as PIN_ORIENTATION);

        break;

      case COL_NUMBER_SIZE:
        aPin.SetNumberTextSize(this.m_unitsProvider.ValueFromString(aValue));
        break;

      case COL_NAME_SIZE:
        aPin.SetNameTextSize(this.m_unitsProvider.ValueFromString(aValue));
        break;

      case COL_LENGTH:
        aPin.ChangeLength(this.m_unitsProvider.ValueFromString(aValue));
        break;

      case COL_POSX:
        aPin.SetPosition({
          x: this.m_unitsProvider.ValueFromString(aValue),
          y: aPin.GetPosition().y,
        });
        break;

      case COL_POSY:
        aPin.SetPosition({
          x: aPin.GetPosition().x,
          y: this.m_unitsProvider.ValueFromString(aValue),
        });
        break;

      case COL_VISIBLE:
        aPin.SetVisible(this.boolFromString(aValue, this.m_reporter));
        break;

      case COL_UNIT: {
        const parent = aPin.GetParentSymbol();

        if (parent && !parent.IsMultiUnit()) break;

        if (MatchTranslationOrNative(aValue, UNITS_ALL, false)) {
          aPin.SetUnit(0);
          break;
        }

        for (let i = 1; i <= aSymbol.GetUnitCount(); i++) {
          if (
            aValue === aPin.GetUnitDisplayName(i, true) ||
            aValue === aPin.GetUnitDisplayName(i, false)
          ) {
            aPin.SetUnit(i);
            break;
          }
        }

        break;
      }

      case COL_BODY_STYLE: {
        const parent = aPin.GetParentSymbol();

        if (parent && !parent.IsMultiBodyStyle()) break;

        if (MatchTranslationOrNative(aValue, DEMORGAN_ALL, false)) {
          aPin.SetBodyStyle(0);
          break;
        }

        for (let i = 1; i <= aSymbol.GetBodyStyleCount(); i++) {
          if (
            aValue === aPin.GetBodyStyleDescription(i, true) ||
            aValue === aPin.GetBodyStyleDescription(i, false)
          ) {
            aPin.SetBodyStyle(i);
            break;
          }
        }

        break;
      }

      default:
        break; // wxFAIL_MSG( "Invalid field id" )
    }
  }

  private stringFromBool(aValue: boolean): string {
    switch (this.m_boolFormat) {
      case BOOL_FORMAT.ZERO_ONE:
        return aValue ? '1' : '0';
      case BOOL_FORMAT.TRUE_FALSE:
        return aValue ? BOOL_TRUE : BOOL_FALSE;
    }
  }

  private boolFromString(aValue: string, aReporter: Reporter): boolean {
    if (aValue === '1') return true;
    else if (aValue === '0') return false;
    else if (MatchTranslationOrNative(aValue, BOOL_TRUE, false)) return true;
    else if (MatchTranslationOrNative(aValue, BOOL_FALSE, false)) return false;

    aReporter.Report(
      wxFormat(
        _(
          "The value '%s' can't be converted to boolean correctly, it has been interpreted as 'False'",
        ),
        aValue,
      ),
      RPT_SEVERITY_ERROR,
    );
    return false;
  }
}

/** `getSelectedArea( aGrid, &aRowStart, &aRowCount )`. */
export function getSelectedArea(aGrid: WX_GRID): { start: number; count: number } {
  const topLeft = aGrid.GetSelectionBlockTopLeft();
  const botRight = aGrid.GetSelectionBlockBottomRight();

  const cols = aGrid.GetSelectedCols();
  const rows = aGrid.GetSelectedRows();

  if (topLeft.length && botRight.length) {
    const start = topLeft[0]!.GetRow();
    return { start, count: botRight[0]!.GetRow() - start + 1 };
  } else if (cols.length) {
    return { start: 0, count: aGrid.GetNumberRows() };
  } else if (rows.length) {
    return { start: rows[0]!, count: rows.length };
  } else {
    const start = aGrid.GetGridCursorRow();
    return { start, count: start >= 0 ? 1 : 0 };
  }
}

/** What PIN_TABLE_DATA_MODEL asks of the dialog that owns it. */
export interface PIN_TABLE_OWNER {
  IsDisplayGrouped(): boolean;
  AddPin(aPin: SCH_PIN): void;
  RemovePin(aPin: SCH_PIN): void;
}

/** A pin's identity, for `m_evalOriginal`'s key (upstream keys by the row's pointer vector). */
const s_pinIds = new WeakMap<SCH_PIN, number>();
let s_nextPinId = 1;

function pinsKey(aPins: readonly SCH_PIN[], aCol: number): string {
  return `${aCol}:${aPins
    .map((p) => {
      let id = s_pinIds.get(p);

      if (id === undefined) {
        id = s_nextPinId++;
        s_pinIds.set(p, id);
      }

      return id;
    })
    .join(',')}`;
}

/**
 * `PIN_TABLE_DATA_MODEL`: because the rows of the grid can either be a single pin or a group of
 * pins, the data model is a 2D vector. In the single pin case, each row holds a single pin.
 */
export class PIN_TABLE_DATA_MODEL extends WX_GRID_TABLE_BASE {
  private m_rows: SCH_PIN[][] = [];
  private m_unitFilter = -1; // -1 to show pins for all units
  private m_bodyStyleFilter = -1; // -1 to show all body styles
  private m_filterBySelection = false;
  private m_edited = false;
  private readonly m_eval: NUMERIC_EVALUATOR;
  private readonly m_evalOriginal = new Map<string, string>();

  constructor(
    private readonly m_frame: SYMBOL_EDIT_FRAME,
    private readonly m_pinTable: PIN_TABLE_OWNER,
    /** Parent symbol that the pins belong to. */
    private readonly m_symbol: LIB_SYMBOL,
    /** The pins in the symbol that are selected at dialog start. */
    private readonly m_origSelectedPins: readonly SCH_PIN[],
  ) {
    super();
    this.m_eval = new NUMERIC_EVALUATOR(this.m_frame.GetUserUnits());
  }

  /** `onUnitsChanged()` (EDA_EVT_UNITS_CHANGED): the grid redraws its values in the new units. */
  onUnitsChanged(): void {
    this.GetView()?.ForceRefresh();
  }

  SetUnitFilter(aFilter: number): void {
    this.m_unitFilter = aFilter;
  }

  SetBodyStyleFilter(aFilter: number): void {
    this.m_bodyStyleFilter = aFilter;
  }

  SetFilterBySelection(aFilter: boolean): void {
    this.m_filterBySelection = aFilter;
  }

  override GetNumberRows(): number {
    return this.m_rows.length;
  }

  override GetNumberCols(): number {
    return COL_COUNT;
  }

  override GetColLabelValue(aCol: number): string {
    return GetPinTableColLabel(aCol);
  }

  override IsEmptyCell(_row: number, _col: number): boolean {
    return false; // don't allow adjacent cell overflow, even if we are actually empty
  }

  override GetValue(aRow: number, aCol: number): string {
    const grid = this.GetView();

    if (
      grid &&
      grid.GetGridCursorRow() === aRow &&
      grid.GetGridCursorCol() === aCol &&
      grid.IsCellEditControlShown()
    ) {
      const original = this.m_evalOriginal.get(pinsKey(this.m_rows[aRow]!, aCol));

      if (original !== undefined) return original;
    }

    return PIN_TABLE_DATA_MODEL.GetPinsValue(
      this.m_rows[aRow]!,
      aCol,
      this.m_frame.GetUnitsProvider(),
    );
  }

  /** The static `GetValue( pins, aCol, aParentFrame )`: one row's text, INDETERMINATE when mixed. */
  static GetPinsValue(
    aPins: readonly SCH_PIN[],
    aCol: number,
    aParentFrame: UNITS_PROVIDER,
  ): string {
    let fieldValue = '';

    if (aPins.length === 0) return fieldValue;

    const reporter = new NULL_REPORTER();
    const formatter = new PIN_INFO_FORMATTER(aParentFrame, true, BOOL_FORMAT.ZERO_ONE, reporter);

    for (const pin of aPins) {
      let val = '';

      switch (aCol) {
        case COL_PIN_COUNT:
          val += String(aPins.length);
          break;
        default:
          val += formatter.Format(pin, aCol);
          break;
      }

      if (aCol === COL_NUMBER) {
        if (fieldValue.length) fieldValue += ', ';

        fieldValue += val;
      } else {
        if (!fieldValue.length) fieldValue = val;
        else if (val !== fieldValue) fieldValue = INDETERMINATE_STATE;
      }
    }

    return fieldValue;
  }

  override SetValue(aRow: number, aCol: number, aValue: string): void {
    if (aValue === INDETERMINATE_STATE) return;

    let value = aValue;

    switch (aCol) {
      case COL_NUMBER_SIZE:
      case COL_NAME_SIZE:
      case COL_LENGTH:
      case COL_POSX:
      case COL_POSY:
        this.m_eval.SetDefaultUnits(this.m_frame.GetUserUnits());

        if (this.m_eval.Process(value)) {
          this.m_evalOriginal.set(pinsKey(this.m_rows[aRow]!, aCol), value);
          value = this.m_eval.Result();
        }

        break;

      default:
        break;
    }

    const pins = [...this.m_rows[aRow]!];

    // If the NUMBER column is edited and the pins are grouped, renumber, and add or
    // remove pins based on the comma separated list of pins.
    if (aCol === COL_NUMBER && this.m_pinTable.IsDisplayGrouped()) {
      // wxStringTokenizer( value, "," ): wxTOKEN_DEFAULT, so empty tokens between commas count
      // but a trailing delimiter makes none.
      const tokens = value === '' ? [] : value.split(',');

      if (tokens.length > 0 && tokens[tokens.length - 1] === '' && value.endsWith(','))
        tokens.pop();

      let i = 0;

      for (const token of tokens) {
        // Trim whitespace from both ends of the string
        const pinName = token.trim();

        if (i < pins.length) {
          // Renumber the existing pins
          pins[i]!.SetNumber(pinName);
        } else {
          // Create new pins
          const newPin = new SCH_PIN(this.m_symbol);
          const last = pins[pins.length - 1]!;

          newPin.SetNumber(pinName);
          newPin.SetName(last.GetName());
          newPin.SetOrientation(last.GetOrientation());
          newPin.SetType(last.GetType());
          newPin.SetShape(last.GetShape());
          newPin.SetUnit(last.GetUnit());

          const pos = { ...last.GetPosition() };
          const cfg = currentSymbolEditorSettings();

          if (
            last.GetOrientation() === PIN_ORIENTATION.PIN_LEFT ||
            last.GetOrientation() === PIN_ORIENTATION.PIN_RIGHT
          ) {
            pos.y -= schIUScale.milsToIU(cfg.repeat.pin_step);
          } else {
            pos.x += schIUScale.milsToIU(cfg.repeat.pin_step);
          }

          newPin.SetPosition(pos);

          pins.push(newPin);
          this.m_pinTable.AddPin(newPin);
        }

        i++;
      }

      while (pins.length > i) {
        this.m_pinTable.RemovePin(pins[pins.length - 1]!);
        pins.pop();
      }

      this.m_rows[aRow] = pins;
      this.m_edited = true;

      return;
    }

    const reporter = new NULL_REPORTER();
    const formatter = new PIN_INFO_FORMATTER(
      this.m_frame.GetUnitsProvider(),
      true,
      BOOL_FORMAT.ZERO_ONE,
      reporter,
    );

    for (const pin of pins) formatter.UpdatePin(pin, value, aCol, this.m_symbol);

    this.m_edited = true;
  }

  /** `findRow( aRowSet, aName )`: the row whose first pin has \a aName. */
  static findRow(aRowSet: readonly (readonly SCH_PIN[])[], aName: string): number {
    for (let i = 0; i < aRowSet.length; ++i) {
      if (aRowSet[i]![0] && aRowSet[i]![0]!.GetName() === aName) return i;
    }

    return -1;
  }

  /** `compare( lhs, rhs, sortCol, ascending, parentFrame )`: rows by a column, then by number. */
  static compare(
    lhs: readonly SCH_PIN[],
    rhs: readonly SCH_PIN[],
    aSortCol: number,
    ascending: boolean,
    parentFrame: UNITS_PROVIDER,
  ): boolean {
    let sortCol = aSortCol;
    let lhStr = PIN_TABLE_DATA_MODEL.GetPinsValue(lhs, sortCol, parentFrame);
    let rhStr = PIN_TABLE_DATA_MODEL.GetPinsValue(rhs, sortCol, parentFrame);

    if (lhStr === rhStr) {
      // Secondary sort key is always COL_NUMBER
      sortCol = COL_NUMBER;
      lhStr = PIN_TABLE_DATA_MODEL.GetPinsValue(lhs, sortCol, parentFrame);
      rhStr = PIN_TABLE_DATA_MODEL.GetPinsValue(rhs, sortCol, parentFrame);
    }

    // N.B. To meet the iterator sort conditions, we cannot simply invert the truth
    // to get the opposite sort.  i.e. ~(a<b) != (a>b)
    const cmp = (a: number, b: number): boolean => (ascending ? a < b : b < a);

    switch (sortCol) {
      case COL_NUMBER:
      case COL_NAME:
        return cmp(PIN_NUMBERS.Compare(lhStr, rhStr), 0);

      case COL_NUMBER_SIZE:
      case COL_NAME_SIZE:
        return cmp(parentFrame.ValueFromString(lhStr), parentFrame.ValueFromString(rhStr));

      case COL_LENGTH:
      case COL_POSX:
      case COL_POSY:
        return cmp(parentFrame.ValueFromString(lhStr), parentFrame.ValueFromString(rhStr));

      default:
        return cmp(strNumCmp(lhStr, rhStr), 0);
    }
  }

  /** `RebuildRows( aPins, groupByName, groupBySelection )`. */
  RebuildRows(aPins: readonly SCH_PIN[], groupByName: boolean, groupBySelection: boolean): void {
    const grid = this.GetView() as WX_GRID | null;
    const clear_flags: SCH_PIN[] = [];

    if (grid) {
      if (groupBySelection) {
        for (const pin of aPins) pin.ClearTempFlags();

        const { start: firstSelectedRow, count: selectedRowCount } = getSelectedArea(grid);

        for (let ii = 0; ii < selectedRowCount; ++ii) {
          for (const pin of this.m_rows[firstSelectedRow + ii] ?? []) {
            pin.SetFlags(CANDIDATE);
            clear_flags.push(pin);
          }
        }
      }

      // Commit any pending in-place edits before the row gets moved out from under
      // the editor.
      grid.CommitPendingChanges(true);

      grid.ProcessTableMessage(
        wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED,
        0,
        this.m_rows.length,
      );
    }

    this.m_rows = [];

    if (groupBySelection) this.m_rows.push([]);

    const selectedNumbers = new Set<string>();

    for (const pin of this.m_origSelectedPins) selectedNumbers.add(pin.GetNumber());

    const pinIsInEditorSelection = (pin: SCH_PIN): boolean => {
      // Quick check before we iterate the whole thing in N^2 time.
      // (3000^2 = FPGAs causing issues down the road).
      if (!selectedNumbers.has(pin.GetNumber())) return false;

      for (const selectedPin of this.m_origSelectedPins) {
        // The selected pin is in the editor, but the pins in the table
        // are copies. We will mark the pin as selected if it's a match
        // on the critical items.
        if (
          selectedPin.GetNumber() === pin.GetNumber() &&
          selectedPin.GetName() === pin.GetName() &&
          selectedPin.GetUnit() === pin.GetUnit() &&
          selectedPin.GetBodyStyle() === pin.GetBodyStyle()
        ) {
          return true;
        }
      }

      return false;
    };

    for (const pin of aPins) {
      const includedByUnit =
        this.m_unitFilter === -1 || pin.GetUnit() === 0 || pin.GetUnit() === this.m_unitFilter;
      const includedByBodyStyle =
        this.m_bodyStyleFilter === -1 || pin.GetBodyStyle() === this.m_bodyStyleFilter;
      const includedBySelection = !this.m_filterBySelection || pinIsInEditorSelection(pin);

      if (includedByUnit && includedByBodyStyle && includedBySelection) {
        let rowIndex = -1;

        if (groupByName) rowIndex = PIN_TABLE_DATA_MODEL.findRow(this.m_rows, pin.GetName());
        else if (groupBySelection && pin.GetFlags() & CANDIDATE) rowIndex = 0;

        if (rowIndex < 0) {
          this.m_rows.push([]);
          rowIndex = this.m_rows.length - 1;
        }

        this.m_rows[rowIndex]!.push(pin);
      }
    }

    let sortCol = 0;
    let ascending = true;

    if (this.GetView() && this.GetView()!.GetSortingColumn() !== wxNOT_FOUND) {
      sortCol = this.GetView()!.GetSortingColumn();
      ascending = this.GetView()!.IsSortOrderAscending();
    }

    for (const row of this.m_rows) this.SortPins(row);

    if (!groupBySelection) this.SortRows(sortCol, ascending);

    if (this.GetView()) {
      this.GetView()!.ProcessTableMessage(
        wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
        this.m_rows.length,
        0,
      );

      if (groupBySelection) this.GetView()!.SelectRow(0);
    }

    for (const pin of clear_flags) pin.ClearFlags(CANDIDATE);
  }

  /** `SortRows( aSortCol, ascending )`: std::sort with compare() as the less-than. */
  SortRows(aSortCol: number, ascending: boolean): void {
    this.m_rows.sort((lhs, rhs) => {
      if (
        PIN_TABLE_DATA_MODEL.compare(lhs, rhs, aSortCol, ascending, this.m_frame.GetUnitsProvider())
      )
        return -1;
      if (
        PIN_TABLE_DATA_MODEL.compare(rhs, lhs, aSortCol, ascending, this.m_frame.GetUnitsProvider())
      )
        return 1;
      return 0;
    });
  }

  /** `SortPins( aRow )`: a row's pins by number. */
  SortPins(aRow: SCH_PIN[]): void {
    aRow.sort((lhs, rhs) => PIN_NUMBERS.Compare(lhs.GetNumber(), rhs.GetNumber()));
  }

  AppendRow(aPin: SCH_PIN): void {
    this.m_rows.push([aPin]);

    this.GetView()?.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1, 0);
  }

  RemoveRow(aRow: number): SCH_PIN[] {
    const removedRow = this.m_rows[aRow]!;

    this.m_rows.splice(aRow, 1);

    this.GetView()?.ProcessTableMessage(
      wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED,
      aRow,
      1,
    );

    return removedRow;
  }

  GetRowPins(aRow: number): SCH_PIN[] {
    return this.m_rows[aRow]!;
  }

  IsEdited(): boolean {
    return this.m_edited;
  }
}

/** The columns PIN_TABLE_EXPORT writes, in order. */
const EXPORT_COLS = [
  COL_NUMBER,
  COL_NAME,
  COL_TYPE,
  COL_SHAPE,
  COL_ORIENTATION,
  COL_NUMBER_SIZE,
  COL_NAME_SIZE,
  COL_LENGTH,
  COL_POSX,
  COL_POSY,
  COL_VISIBLE,
  COL_UNIT,
  COL_BODY_STYLE,
];

/** `PIN_TABLE_EXPORT`: the pins as a table, to a CSV file or the clipboard as tab-separated text. */
export class PIN_TABLE_EXPORT {
  constructor(private readonly m_unitsProvider: UNITS_PROVIDER) {}

  /** `ExportData( aPins, aToFile )`: an empty \a aToFile is the clipboard. */
  ExportData(aPins: readonly SCH_PIN[], aToFile: string): void {
    const exportTable: string[][] = [];

    exportTable.push(EXPORT_COLS.map((col) => GetPinTableColLabel(col)));

    const reporter = new NULL_REPORTER();
    const formatter = new PIN_INFO_FORMATTER(
      this.m_unitsProvider,
      false,
      BOOL_FORMAT.TRUE_FALSE,
      reporter,
    );

    for (const pin of aPins) exportTable.push(EXPORT_COLS.map((col) => formatter.Format(pin, col)));

    if (aToFile !== '') {
      const os: string[] = [];
      const writer = new CSV_WRITER(os);
      writer.WriteLines(exportTable);
      wxWriteFileSync(aToFile, new TextEncoder().encode(os.join('')));
    } else {
      SaveTabularDataToClipboard(exportTable);
    }
  }
}

/** `PIN_TABLE_IMPORT`: pins from a CSV/TSV file or the clipboard, columns matched by header. */
export class PIN_TABLE_IMPORT {
  constructor(
    private readonly m_frame: UNITS_PROVIDER,
    private readonly m_reporter: Reporter,
    /**
     * `promptForFile()`: `wxFileDialog( …, "Select pin data file", …, CsvTsvFileWildcard(),
     * wxFD_OPEN | wxFD_FILE_MUST_EXIST )`, the path or "" on Cancel.
     */
    private readonly m_promptForFile: () => Promise<string> = async () => '',
  ) {}

  /** `ImportData( aFromFile, aSym )`. */
  async ImportData(aFromFile: boolean, aSym: LIB_SYMBOL): Promise<SCH_PIN[]> {
    let path = '';

    if (aFromFile) {
      path = await this.m_promptForFile();

      if (path === '') return [];
    }

    const csvData: string[][] = [];
    let ok = false;

    if (path !== '') {
      // Read file content
      const bytes = wxReadFileSync(path);
      const csvFileContent = bytes ? new TextDecoder().decode(bytes) : '';
      ok = AutoDecodeCSV(csvFileContent, csvData);
    } else {
      ok = GetTabularDataFromClipboard(csvData);
    }

    const pins: SCH_PIN[] = [];

    const formatter = new PIN_INFO_FORMATTER(
      this.m_frame,
      false,
      BOOL_FORMAT.TRUE_FALSE,
      this.m_reporter,
    );

    if (ok) {
      // The first thing we need to do is map the CSV columns to the pin table columns
      // (in case the user reorders them)
      const headerCols = this.getColOrderFromCSV(csvData[0]!);

      for (let i = 1; i < csvData.length; ++i) {
        const cols = csvData[i]!;

        const pin = new SCH_PIN(aSym);

        // Ignore cells that stick out to the right of the headers
        const maxCol = Math.min(headerCols.length, cols.length);

        for (let j = 0; j < maxCol; ++j) {
          // Skip unrecognised columns
          if (headerCols[j] === COL_COUNT) continue;

          formatter.UpdatePin(pin, cols[j]!, headerCols[j]!, aSym);
        }

        pins.push(pin);
      }
    }

    return pins;
  }

  private getColOrderFromCSV(aHeaderRow: readonly string[]): COL_ORDER[] {
    const colOrder: COL_ORDER[] = [];
    const unknownHeaders: string[] = [];

    for (const header of aHeaderRow) {
      const col = GetColTypeForString(header);

      if (col >= COL_COUNT) unknownHeaders.push(header);

      colOrder.push(col);
    }

    if (unknownHeaders.length) {
      this.m_reporter.Report(
        wxFormat(
          _('Unknown columns in data: %s. These columns will be ignored.'),
          AccumulateDescriptions(unknownHeaders),
        ),
        RPT_SEVERITY_ERROR,
      );
    }

    return colOrder;
  }
}

/** The pin table's controls, apart from the grid. */
export interface PIN_TABLE_STATE {
  m_pin_numbers_summary: string;
  m_pin_count: string;
  m_duplicate_pins: string;
  m_cbGroup: boolean;
  /** m_groupSelected->Enable(): more than one row selected (OnUpdateUI). */
  groupSelectedEnabled: boolean;
  m_cbFilterByUnit: { value: boolean; enabled: boolean };
  unitFilterChoices: string[];
  m_unitFilter: { value: number; enabled: boolean };
  m_cbFilterByBodyStyle: { value: boolean; enabled: boolean };
  bodyStyleFilterChoices: string[];
  m_bodyStyleFilter: { value: number; enabled: boolean };
  m_cbFilterSelected: boolean;
  /** m_rbExportAllPins, else m_rbExportOnlyShownPins. */
  exportAllPins: boolean;
  /** m_rbReplaceAll, else "Append to existing pins". */
  replaceAll: boolean;
  /** "Read Only": the symbol is not editable here, or is derived. */
  readOnly: boolean;
}

/** `OnMenu`'s one item. */
export const ID_CROSSPROBE = 4206;

export class DIALOG_LIB_EDIT_PIN_TABLE implements PIN_TABLE_OWNER {
  readonly m_editFrame: SYMBOL_EDIT_FRAME;
  readonly m_symbol: LIB_SYMBOL;
  readonly m_grid = new WX_GRID();
  readonly m_dataModel: PIN_TABLE_DATA_MODEL;
  readonly m_gridTricks: GRID_TRICKS;
  /** A copy of the pins owned by the dialog. */
  m_pins: SCH_PIN[] = [];
  m_initialized = false;
  /** True when there are unsaved changes. */
  m_modified = false;
  m_state: PIN_TABLE_STATE;

  /**
   * `wxMessageBox( msg, "Errors", wxOK | wxCANCEL | wxICON_ERROR )`: true on OK. The window shows
   * it; with none, OK.
   */
  ShowErrors: (aMessage: string) => Promise<boolean> = () => Promise.resolve(true);

  constructor(aParent: SYMBOL_EDIT_FRAME, aSymbol: LIB_SYMBOL, aSelectedPins: readonly SCH_PIN[]) {
    this.m_editFrame = aParent;
    this.m_symbol = aSymbol;
    this.m_dataModel = new PIN_TABLE_DATA_MODEL(aParent, this, aSymbol, aSelectedPins);

    this.m_grid.SetTable(this.m_dataModel, false, wxGridSelectionModes.wxGridSelectCells);
    this.m_gridTricks = new GRID_TRICKS(this.m_grid, () => this.OnAddRow());
    this.m_grid.ShowHideColumns('0 1 2 3 4 5 9 10');

    // Set special attributes
    let attr = new wxGridCellAttr();
    attr.SetReadOnly(true);
    this.m_dataModel.SetColAttr(attr, COL_PIN_COUNT);

    attr = new wxGridCellAttr();
    const typeNames = [...PinTypeNames(), INDETERMINATE_STATE];
    attr.SetRenderer(new GRID_CELL_ICON_TEXT_RENDERER(PinTypeIcons(), typeNames));
    attr.SetEditor(new GRID_CELL_ICON_TEXT_POPUP(PinTypeIcons(), typeNames));
    this.m_dataModel.SetColAttr(attr, COL_TYPE);

    attr = new wxGridCellAttr();
    const shapeNames = [...PinShapeNames(), INDETERMINATE_STATE];
    attr.SetRenderer(new GRID_CELL_ICON_TEXT_RENDERER(PinShapeIcons(), shapeNames));
    attr.SetEditor(new GRID_CELL_ICON_TEXT_POPUP(PinShapeIcons(), shapeNames));
    this.m_dataModel.SetColAttr(attr, COL_SHAPE);

    attr = new wxGridCellAttr();
    const orientationNames = [...PinOrientationNames(), INDETERMINATE_STATE];
    attr.SetRenderer(new GRID_CELL_ICON_TEXT_RENDERER(PinOrientationIcons(), orientationNames));
    attr.SetEditor(new GRID_CELL_ICON_TEXT_POPUP(PinOrientationIcons(), orientationNames));
    this.m_dataModel.SetColAttr(attr, COL_ORIENTATION);

    attr = new wxGridCellAttr();
    const unitNames = [UNITS_ALL];

    for (let i = 1; i <= aSymbol.GetUnitCount(); i++)
      unitNames.push(aSymbol.GetUnitDisplayName(i, true));

    attr.SetEditor(new GRID_CELL_COMBOBOX(unitNames));
    this.m_dataModel.SetColAttr(attr, COL_UNIT);

    attr = new wxGridCellAttr();
    const bodyStyleNames = [DEMORGAN_ALL];

    if (aSymbol.HasDeMorganBodyStyles()) {
      bodyStyleNames.push(DEMORGAN_STD);
      bodyStyleNames.push(DEMORGAN_ALT);
    } else {
      for (const body_style_name of aSymbol.GetBodyStyleNames())
        bodyStyleNames.push(body_style_name);
    }

    attr.SetEditor(new GRID_CELL_COMBOBOX(bodyStyleNames));
    this.m_dataModel.SetColAttr(attr, COL_BODY_STYLE);

    attr = new wxGridCellAttr();
    attr.SetRenderer(new wxGridCellBoolRenderer());
    attr.SetEditor(new wxGridCellBoolEditor());
    attr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);
    this.m_dataModel.SetColAttr(attr, COL_VISIBLE);

    this.m_state = {
      m_pin_numbers_summary: '0',
      m_pin_count: '0',
      m_duplicate_pins: '0',
      m_cbGroup: false,
      groupSelectedEnabled: false,
      m_cbFilterByUnit: { value: false, enabled: true },
      unitFilterChoices: [],
      m_unitFilter: { value: -1, enabled: true },
      m_cbFilterByBodyStyle: { value: false, enabled: true },
      bodyStyleFilterChoices: [],
      m_bodyStyleFilter: { value: -1, enabled: true },
      m_cbFilterSelected: false,
      exportAllPins: true,
      replaceAll: true,
      readOnly: false,
    };

    const s = this.m_state;

    if (aSymbol.IsMultiUnit()) {
      s.unitFilterChoices.push(UNITS_ALL);

      for (let ii = 0; ii < aSymbol.GetUnitCount(); ++ii)
        s.unitFilterChoices.push(LIB_SYMBOL.LetterSubReference(ii + 1, 'A'));

      s.m_unitFilter.value = -1;
    } else {
      s.m_cbFilterByUnit.enabled = false;
      s.m_unitFilter.enabled = false;
    }

    if (aSymbol.HasDeMorganBodyStyles()) {
      s.bodyStyleFilterChoices.push(DEMORGAN_ALL, DEMORGAN_STD, DEMORGAN_ALT);
      s.m_bodyStyleFilter.value = -1;
    } else if (aSymbol.IsMultiBodyStyle()) {
      s.bodyStyleFilterChoices.push(DEMORGAN_ALL);

      for (const bodyStyle of aSymbol.GetBodyStyleNames()) s.bodyStyleFilterChoices.push(bodyStyle);

      s.m_bodyStyleFilter.value = -1;
    } else {
      s.m_cbFilterByBodyStyle.enabled = false;
      s.m_bodyStyleFilter.enabled = false;
    }

    if (!aParent.IsSymbolEditable() || aParent.IsSymbolAlias()) s.readOnly = true;

    this.m_initialized = true;
    this.m_modified = false;

    this.m_grid.Connect(wxEVT_GRID_COL_SORT, (aEvent: wxGridEvent) => this.OnColSort(aEvent));
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGED, () => this.OnCellEdited());
    // The base's m_grid->Connect()s: a click or an opened editor cross-probes the row's pin.
    this.m_grid.Connect(wxEVT_GRID_CELL_LEFT_CLICK, (aEvent: wxGridEvent) =>
      this.OnCellSelected(aEvent.GetRow()),
    );
    this.m_grid.Connect(wxEVT_GRID_EDITOR_SHOWN, (aEvent: wxGridEvent) =>
      this.OnCellSelected(aEvent.GetRow()),
    );
  }

  /** A copy of the control state, for the window to draw. */
  snapshot(): PIN_TABLE_STATE {
    return structuredClone(this.m_state);
  }

  /** `TransferDataToWindow()`: a copy of each pin, the rows, the summary. */
  TransferDataToWindow(): PIN_TABLE_STATE {
    // Make a copy of the pins for editing
    for (const pin of this.m_symbol.GetGraphicalPins(0, 0)) this.m_pins.push(SCH_PIN.copyOf(pin));

    this.m_dataModel.RebuildRows(this.m_pins, this.m_state.m_cbGroup, false);

    this.updateSummary();

    return this.snapshot();
  }

  /** `TransferDataFromWindow()`: the symbol's pins replaced by the table's. */
  TransferDataFromWindow(): boolean {
    if (!this.m_grid.CommitPendingChanges()) return false;

    // Delete the part's pins
    for (const pin of this.m_symbol.GetGraphicalPins(0, 0)) this.m_symbol.RemoveDrawItem(pin);

    // Transfer our pins to the part
    for (const pin of this.m_pins) this.m_symbol.AddDrawItem(pin);

    this.m_pins = [];

    return true;
  }

  /** `OnColSort()`. */
  OnColSort(aEvent: wxGridEvent): void {
    const sortCol = aEvent.GetCol();

    // This is bonkers, but wxWidgets doesn't tell us ascending/descending in the
    // event, and if we ask it will give us pre-event info.
    const ascending = this.m_grid.IsSortingBy(sortCol)
      ? // same column; invert ascending
        !this.m_grid.IsSortOrderAscending()
      : // different column; start with ascending
        true;

    this.m_dataModel.SortRows(sortCol, ascending);
  }

  /** `OnAddRow()`: a pin like the last, a pin_step on. */
  OnAddRow(): void {
    this.m_grid.OnAddRow((): [number, number] => {
      const newPin = new SCH_PIN(this.m_symbol);

      // Copy the settings of the last pin onto the new pin.
      if (this.m_pins.length > 0) {
        const last = this.m_pins[this.m_pins.length - 1]!;

        newPin.SetOrientation(last.GetOrientation());
        newPin.SetType(last.GetType());
        newPin.SetShape(last.GetShape());
        newPin.SetUnit(last.GetUnit());
        newPin.SetBodyStyle(last.GetBodyStyle());

        const pos = { ...last.GetPosition() };
        const cfg = this.m_editFrame.GetSettings() ?? currentSymbolEditorSettings();

        if (
          last.GetOrientation() === PIN_ORIENTATION.PIN_LEFT ||
          last.GetOrientation() === PIN_ORIENTATION.PIN_RIGHT
        ) {
          pos.y -= schIUScale.milsToIU(cfg.repeat.pin_step);
        } else {
          pos.x += schIUScale.milsToIU(cfg.repeat.pin_step);
        }

        newPin.SetPosition(pos);
      }

      this.m_pins.push(newPin);

      this.m_dataModel.AppendRow(this.m_pins[this.m_pins.length - 1]!);
      this.updateSummary();

      return [this.m_dataModel.GetNumberRows() - 1, COL_NUMBER];
    });
  }

  /** `AddPin()`. */
  AddPin(pin: SCH_PIN): void {
    this.m_pins.push(pin);
    this.updateSummary();
  }

  /** `OnDeleteRow()`: the row's pins leave the table. */
  OnDeleteRow(): void {
    this.m_grid.OnDeleteRows((row) => {
      const removedRow = this.m_dataModel.RemoveRow(row);

      for (const pin of removedRow) this.m_pins.splice(this.m_pins.indexOf(pin), 1);
    });

    this.updateSummary();
  }

  /** `RemovePin()`. */
  RemovePin(pin: SCH_PIN): void {
    this.m_pins.splice(this.m_pins.indexOf(pin), 1);
    this.updateSummary();
  }

  /** `OnCellEdited()`. */
  OnCellEdited(): void {
    this.updateSummary();
  }

  /**
   * `OnCellSelected()`: with Highlight on Cross-probe, the editor focuses the symbol's pin that
   * the row's single pin numbers (nothing for a group).
   */
  OnCellSelected(aRow: number): void {
    let pin: SCH_PIN | null = null;

    if (aRow >= 0 && aRow < this.m_dataModel.GetNumberRows()) {
      const pins = this.m_dataModel.GetRowPins(aRow);
      const curSymbol = this.m_editFrame.GetCurSymbol();

      if (pins.length === 1 && curSymbol) {
        for (const candidate of curSymbol.GetGraphicalPins(0, 0)) {
          if (candidate.GetNumber() === pins[0]!.GetNumber()) {
            pin = candidate;
            break;
          }
        }
      }
    }

    const cfg = this.m_editFrame.GetSettings() ?? currentSymbolEditorSettings();

    if (cfg.pin_table.crossprobe_on_selection) {
      this.m_editFrame.FocusOnItem(pin);
      this.m_editFrame.GetCanvas()?.Refresh();
    }
  }

  IsDisplayGrouped(): boolean {
    return this.m_state.m_cbGroup;
  }

  /** `OnGroupSelected()`: the selected rows become one group. */
  OnGroupSelected(): PIN_TABLE_STATE {
    this.m_state.m_cbGroup = false;

    this.m_dataModel.RebuildRows(this.m_pins, false, true);

    this.m_grid.ShowCol(COL_PIN_COUNT);

    return this.snapshot();
  }

  /** `OnRebuildRows()`: a cell edit that will not commit stops it. */
  OnRebuildRows(): PIN_TABLE_STATE {
    if (!this.m_grid.CommitPendingChanges()) return this.snapshot();

    this.m_dataModel.RebuildRows(this.m_pins, this.m_state.m_cbGroup, false);

    if (this.m_state.m_cbGroup) this.m_grid.ShowCol(COL_PIN_COUNT);

    return this.snapshot();
  }

  /** `OnMenu()`'s menu: one check item. */
  MenuItems(): { id: number; label: string; help: string; checked: boolean }[] {
    const cfg = this.m_editFrame.GetSettings() ?? currentSymbolEditorSettings();

    return [
      {
        id: ID_CROSSPROBE,
        label: _('Highlight on Cross-probe'),
        help: _('Highlight corresponding pin on canvas when it is selected in the table'),
        checked: cfg.pin_table.crossprobe_on_selection,
      },
    ];
  }

  /** `OnMenu()`: \a aMenuId is GetPopupMenuSelectionFromUser's answer (wxID_NONE when dismissed). */
  OnMenu(aMenuId: number): void {
    const cfg = this.m_editFrame.GetSettings() ?? currentSymbolEditorSettings();

    if (aMenuId === 0 || aMenuId === ID_CROSSPROBE)
      cfg.pin_table.crossprobe_on_selection = !cfg.pin_table.crossprobe_on_selection;
  }

  /** `OnFilterCheckBox()`: one of the three filter boxes, then the rows rebuilt. */
  OnFilterCheckBox(
    aBox: 'm_cbFilterByUnit' | 'm_cbFilterByBodyStyle' | 'm_cbFilterSelected',
    aChecked: boolean,
  ): PIN_TABLE_STATE {
    const s = this.m_state;

    if (aBox === 'm_cbFilterByUnit') {
      s.m_cbFilterByUnit.value = aChecked;

      if (aChecked) {
        if (s.m_unitFilter.value === -1) s.m_unitFilter.value = 0;

        this.m_dataModel.SetUnitFilter(s.m_unitFilter.value);
      } else {
        this.m_dataModel.SetUnitFilter(-1);
        s.m_unitFilter.value = -1;
      }
    } else if (aBox === 'm_cbFilterByBodyStyle') {
      s.m_cbFilterByBodyStyle.value = aChecked;

      if (aChecked) {
        if (s.m_bodyStyleFilter.value === -1) s.m_bodyStyleFilter.value = 0;

        this.m_dataModel.SetBodyStyleFilter(s.m_bodyStyleFilter.value);
      } else {
        this.m_dataModel.SetBodyStyleFilter(-1);
        s.m_bodyStyleFilter.value = -1;
      }
    } else {
      s.m_cbFilterSelected = aChecked;
      this.m_dataModel.SetFilterBySelection(aChecked);
    }

    return this.OnRebuildRows();
  }

  /** `OnFilterChoice()`: choosing turns its box on. */
  OnFilterChoice(
    aChoice: 'm_unitFilter' | 'm_bodyStyleFilter',
    aSelection: number,
  ): PIN_TABLE_STATE {
    const s = this.m_state;

    if (aChoice === 'm_unitFilter') {
      s.m_unitFilter.value = aSelection;
      s.m_cbFilterByUnit.value = true;
      this.m_dataModel.SetUnitFilter(aSelection);
    } else {
      s.m_bodyStyleFilter.value = aSelection;
      s.m_cbFilterByBodyStyle.value = true;
      this.m_dataModel.SetBodyStyleFilter(aSelection);
    }

    return this.OnRebuildRows();
  }

  /** `OnImportButtonClick()`: from a file or the clipboard; errors may cancel it. */
  async OnImportButtonClick(aFromFile: boolean): Promise<PIN_TABLE_STATE> {
    const replaceAll = this.m_state.replaceAll;

    const reporter = new WX_STRING_REPORTER();
    const importer = new PIN_TABLE_IMPORT(
      this.m_editFrame.GetUnitsProvider(),
      reporter,
      async () => {
        const path = await this.m_editFrame.FileDialog(
          _('Select pin data file'),
          '',
          '',
          [csvTsvFileWildcard()],
          wxFD_OPEN | wxFD_FILE_MUST_EXIST,
        );
        return path ?? '';
      },
    );

    const newPins = await importer.ImportData(aFromFile, this.m_symbol);

    if (reporter.HasMessage()) {
      // Give the user the option to cancel the import on errors.
      if (!(await this.ShowErrors(reporter.GetMessages()))) return this.snapshot();
    }

    if (!newPins.length) return this.snapshot();

    if (replaceAll) this.m_pins = [];

    for (const newPin of newPins) this.m_pins.push(newPin);

    this.m_state.m_cbGroup = false;
    this.m_dataModel.RebuildRows(this.m_pins, false, false);

    this.updateSummary();

    return this.snapshot();
  }

  /** `OnExportButtonClick()`: all pins or the shown ones, to a CSV file or the clipboard. */
  async OnExportButtonClick(aToFile: boolean): Promise<void> {
    const onlyShown = !this.m_state.exportAllPins;

    let filePath = '';

    if (aToFile) {
      const path = await this.m_editFrame.FileDialog(
        _('Select pin data file'),
        '',
        `${this.m_symbol.GetName()}.${CsvFileExtension}`,
        [csvFileWildcard()],
        wxFD_SAVE | wxFD_OVERWRITE_PROMPT,
      );

      if (path === null) return;

      filePath = path;
    }

    let pinsToExport: SCH_PIN[] = [];

    if (onlyShown) {
      for (let i = 0; i < this.m_dataModel.GetNumberRows(); ++i) {
        for (const pin of this.m_dataModel.GetRowPins(i)) pinsToExport.push(pin);
      }
    } else {
      pinsToExport = this.m_pins;
    }

    new PIN_TABLE_EXPORT(this.m_editFrame.GetUnitsProvider()).ExportData(pinsToExport, filePath);
  }

  /** `OnUpdateUI()`: Group Selected Pins wants more than one selected row. */
  OnUpdateUI(): PIN_TABLE_STATE {
    const { count: selectedRowCount } = getSelectedArea(this.m_grid);

    this.m_state.groupSelectedEnabled = selectedRowCount > 1;

    return this.snapshot();
  }

  /**
   * `OnClose()` / `OnCancel()`: unedited, the dialog closes as cancelled; edited, \a aAsk is the
   * unsaved-changes question, and Save applies it. @return the return code, or null to stay open.
   */
  async OnClose(aAsk: () => Promise<UnsavedChangesResult>): Promise<number | null> {
    // This is a cancel, so commit quietly as we're going to throw the results away anyway.
    this.m_grid.CommitPendingChanges(true);

    let retval = wxID_CANCEL;

    if (this.m_dataModel.IsEdited()) {
      const result = await aAsk();

      if (
        handleUnsavedChanges(result, () => {
          if (this.TransferDataFromWindow()) {
            retval = wxID_OK;
            return true;
          }

          return false;
        })
      ) {
        return retval;
      }

      return null;
    }

    // No change in dialog: we can close it
    return retval;
  }

  /** `updateSummary()`: the numbers, the count, the duplicates. */
  updateSummary(): void {
    const pinNumbers = new PIN_NUMBERS();

    for (const pin of this.m_pins) {
      if (pin.GetNumber().length) pinNumbers.insert(pin.GetNumber());
    }

    this.m_state.m_pin_numbers_summary = pinNumbers.GetSummary();
    this.m_state.m_pin_count = String(this.m_pins.length);
    this.m_state.m_duplicate_pins = pinNumbers.GetDuplicates();
  }
}

/** The base's column widths (SetColSize 0..13). [data] */
const PIN_TABLE_COLUMNS = [
  { width: 60, center: true },
  { width: 66 },
  { width: 84 },
  { width: 140 },
  { width: 140 },
  { width: 100 },
  { width: 110 },
  { width: 110 },
  { width: 84 },
  { width: 84 },
  { width: 84 },
  { width: 84, center: true },
  { width: 100 },
  { width: 100 },
];

/** DIALOG_LIB_EDIT_PIN_TABLE's window over its base; onClose carries wxID_OK / wxID_CANCEL. */
export function DialogLibEditPinTable({
  dlg,
  onClose,
  askUnsaved,
  showErrors,
  showMenu,
}: {
  dlg: DIALOG_LIB_EDIT_PIN_TABLE;
  onClose: (aRetval: number) => void;
  /** `HandleUnsavedChanges( this, "Save changes?", … )`'s question. */
  askUnsaved: (aMessage: string) => Promise<UnsavedChangesResult>;
  /** `wxMessageBox( msg, "Errors", wxOK | wxCANCEL | wxICON_ERROR )`: true on OK. */
  showErrors: (aMessage: string) => Promise<boolean>;
  /** `GetPopupMenuSelectionFromUser( menu )` under the menu button: the id, or 0. */
  showMenu: (aItems: ReturnType<DIALOG_LIB_EDIT_PIN_TABLE['MenuItems']>) => Promise<number>;
}): JSX.Element {
  const [state, setState] = useState<PIN_TABLE_STATE>(() => {
    dlg.TransferDataToWindow();
    return dlg.OnUpdateUI();
  });
  dlg.ShowErrors = showErrors;

  // A grid redrew: the idle OnUpdateUI, keeping the state when nothing moved (WxGridView calls
  // this after every render).
  const sync = (): void => {
    const next = dlg.OnUpdateUI();
    setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  const update = (aNext?: PIN_TABLE_STATE): void => {
    if (aNext) dlg.m_state = aNext;
    setState(dlg.OnUpdateUI());
  };
  const close = (): void => {
    void dlg
      .OnClose(() => askUnsaved(_('Save changes?')))
      .then((r) => {
        if (r !== null) onClose(r);
      });
  };

  return (
    <DIALOG_LIB_EDIT_PIN_TABLE_BASE
      m_pin_numbers_summary={state.m_pin_numbers_summary}
      m_pin_count={state.m_pin_count}
      m_duplicate_pins={state.m_duplicate_pins}
      m_grid={
        <WxGridView
          grid={dlg.m_grid}
          columns={PIN_TABLE_COLUMNS}
          flexCol={COL_NUMBER}
          onUpdate={sync}
          ariaLabel="Pins"
        />
      }
      m_cbGroup={{
        value: state.m_cbGroup,
        onChange: (on) => {
          dlg.m_state.m_cbGroup = on;
          update(dlg.OnRebuildRows());
        },
      }}
      groupSelectedEnabled={state.groupSelectedEnabled}
      onGroupSelected={() => update(dlg.OnGroupSelected())}
      onRebuildRows={() => update(dlg.OnRebuildRows())}
      onMenu={() => {
        void showMenu(dlg.MenuItems()).then((id) => {
          dlg.OnMenu(id);
          update();
        });
      }}
      m_cbFilterByUnit={{
        ...state.m_cbFilterByUnit,
        onChange: (on) => update(dlg.OnFilterCheckBox('m_cbFilterByUnit', on)),
      }}
      unitFilterChoices={state.unitFilterChoices}
      m_unitFilter={{
        ...state.m_unitFilter,
        onChange: (i) => update(dlg.OnFilterChoice('m_unitFilter', i)),
      }}
      m_cbFilterByBodyStyle={{
        ...state.m_cbFilterByBodyStyle,
        onChange: (on) => update(dlg.OnFilterCheckBox('m_cbFilterByBodyStyle', on)),
      }}
      bodyStyleFilterChoices={state.bodyStyleFilterChoices}
      m_bodyStyleFilter={{
        ...state.m_bodyStyleFilter,
        onChange: (i) => update(dlg.OnFilterChoice('m_bodyStyleFilter', i)),
      }}
      m_cbFilterSelected={{
        value: state.m_cbFilterSelected,
        onChange: (on) => update(dlg.OnFilterCheckBox('m_cbFilterSelected', on)),
      }}
      exportAllPins={state.exportAllPins}
      onExportAllPins={(all) => update({ ...dlg.m_state, exportAllPins: all })}
      onExportToFile={() => void dlg.OnExportButtonClick(true)}
      onExportToClipboard={() => void dlg.OnExportButtonClick(false)}
      replaceAll={state.replaceAll}
      onReplaceAll={(replace) => update({ ...dlg.m_state, replaceAll: replace })}
      onImportFromFile={() => void dlg.OnImportButtonClick(true).then(update)}
      onImportFromClipboard={() => void dlg.OnImportButtonClick(false).then(update)}
      onAddRow={() => {
        dlg.OnAddRow();
        update();
      }}
      onDeleteRow={() => {
        dlg.OnDeleteRow();
        update();
      }}
      readOnly={state.readOnly}
      onOK={() => {
        if (dlg.TransferDataFromWindow()) onClose(wxID_OK);
      }}
      // OnCancel: Close(), which is OnClose
      onCancel={close}
    />
  );
}
