// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/lib_fields_data_model.cpp`/`.h`: `LIB_FIELDS_EDITOR_GRID_DATA_MODEL`,
 * the Symbol Fields Table's *library*-mode engine — the counterpart of
 * `fields_data_model.ts`'s `FieldsDataModel` (`FIELDS_EDITOR_GRID_DATA_MODEL`,
 * the *schematic*-mode one), but grouping whole `LIB_SYMBOL`s of a library
 * instead of `SCH_SYMBOL` references of a schematic. There is no per-unit
 * splitting here (a `LIB_SYMBOL` is one row candidate, not several) and no
 * sheet-instance data, so the data store is keyed by symbol UUID directly.
 *
 * This has no caller yet: nothing in this tree opens a library-mode Symbol
 * Fields Table (`designer/src/editors/schematic/dialogs/
 * dialog_symbol_fields_table.tsx` is the schematic-mode dialog only). Ported
 * are the pieces that are genuinely pure data-model logic, independent of a
 * live `wxGrid`/library-write-back caller — the column model, the data
 * store, cell read/write, grouping, sorting and the checkbox-attribute
 * getters/setters — the same split `fields_data_model.ts` and its own
 * caller (`SchematicEditor`) already draw. Not ported: `RebuildRows`'s
 * `WX_GRID`/`wxGridTableMessage` notifications (view-only, no meaning
 * without a live grid), `ExpandRow`/`CollapseRow`/`CollapseForSort`/
 * `ExpandAfterSort` (expansion is UI row-visibility bookkeeping over the
 * same `rows` array this file already exposes), `ApplyData` (writes the
 * data store back onto the actual `LIB_SYMBOL`s and reports progress to a
 * caller-supplied handler — there being no caller, there is nothing for it
 * to report to), and `CreateDerivedSymbol`/`createActualDerivedSymbol`
 * (creates a brand new derived `LIB_SYMBOL` in the library, which needs the
 * library write path a real Symbol Editor window would provide).
 */

import { FieldNamesAreDuplicates } from '@ziroeda/common/template_fieldnames.js';
import { strNumCmp, wildCompareString } from '@ziroeda/common/string_utils.js';
import type { LIB_SYMBOL } from './lib_symbol.js';

/** `LIB_FIELDS_EDITOR_GRID_DATA_MODEL::SYMBOL_NAME`. */
export const SYMBOL_NAME = 'Symbol Name';
/** `LIB_FIELDS_EDITOR_GRID_DATA_MODEL::ITEM_NUMBER_VARIABLE`. */
export const ITEM_NUMBER_VARIABLE = '${ITEM_NUMBER}';
/** `INDETERMINATE_STATE` (widgets/ui_common.h): a group's cells disagree. */
export const INDETERMINATE_STATE = '-- mixed values --';

/** `GROUP_TYPE` (widgets/wx_grid.h). */
export type LibGroupType =
  | 'singleton'
  | 'collapsed'
  | 'expanded'
  | 'child'
  | 'collapsed-during-sort';

/** `LIB_DATA_MODEL_ROW`. */
export interface LibDataModelRow {
  itemNumber: number;
  flag: LibGroupType;
  /** The group's member symbols; `refs[0]` is the row's "first reference". */
  refs: LIB_SYMBOL[];
}

/** `LIB_DATA_MODEL_COL`. */
export interface LibDataModelCol {
  fieldName: string;
  label: string;
  userAdded: boolean;
  show: boolean;
  group: boolean;
  isCheckbox: boolean;
}

/** `LIB_DATA_ELEMENT`. */
export interface LibDataElement {
  originalData: string;
  currentData: string;
  originallyEmpty: boolean;
  currentlyEmpty: boolean;
  isModified: boolean;
}

/**
 * `getAttributeValue` (lib_fields_data_model.cpp:326-347): a checkbox
 * column's current value, "1"/"0", read straight off the symbol. Unknown
 * attribute names read as "0", as upstream's fallthrough does.
 */
export function getAttributeValue(aSymbol: LIB_SYMBOL, aAttributeName: string): '1' | '0' {
  switch (aAttributeName) {
    case '${DNP}':
      return aSymbol.GetDNP() ? '1' : '0';
    case '${EXCLUDE_FROM_BOARD}':
      return aSymbol.GetExcludedFromBoard() ? '1' : '0';
    case '${EXCLUDE_FROM_BOM}':
      return aSymbol.GetExcludedFromBOM() ? '1' : '0';
    case '${EXCLUDE_FROM_SIM}':
      return aSymbol.GetExcludedFromSim() ? '1' : '0';
    case 'Power':
      return aSymbol.IsPower() ? '1' : '0';
    case 'LocalPower':
      return aSymbol.IsLocalPower() ? '1' : '0';
    default:
      return '0';
  }
}

/**
 * `setAttributeValue` (lib_fields_data_model.cpp:352-380): writes a checkbox
 * column's edited value back onto the symbol. `LocalPower`/`Power` off does
 * NOT clear the symbol back to a non-power symbol — "turning off local
 * power still leaves the global flag set", so `aValue === '0'` calls
 * `SetGlobalPower`/`SetNormal` respectively, exactly as upstream's `else`
 * arms do.
 */
export function setAttributeValue(
  aSymbol: LIB_SYMBOL,
  aAttributeName: string,
  aValue: string,
): void {
  switch (aAttributeName) {
    case '${DNP}':
      aSymbol.SetDNP(aValue === '1');
      break;
    case '${EXCLUDE_FROM_BOARD}':
      aSymbol.SetExcludedFromBoard(aValue === '1');
      break;
    case '${EXCLUDE_FROM_BOM}':
      aSymbol.SetExcludedFromBOM(aValue === '1');
      break;
    case '${EXCLUDE_FROM_SIM}':
      aSymbol.SetExcludedFromSim(aValue === '1');
      break;
    case 'LocalPower':
      if (aValue === '0') aSymbol.SetGlobalPower();
      else aSymbol.SetLocalPower();
      break;
    case 'Power':
      if (aValue === '0') aSymbol.SetNormal();
      else aSymbol.SetGlobalPower();
      break;
    default:
      // "Unknown attribute name" (wxLogDebug): silently ignored here too.
      break;
  }
}

export class LibFieldsDataModel {
  private cols: LibDataModelCol[] = [];
  private rows: LibDataModelRow[] = [];
  /** symbol UUID -> field name -> data element (`m_dataStore`). */
  private readonly dataStore = new Map<string, Map<string, LibDataElement>>();

  private symbolsList: readonly LIB_SYMBOL[];
  private filter = '';
  private groupingEnabled = false;
  private sortColumn = 0;
  private sortAscending = false;
  private edited = false;

  constructor(symbolsList: readonly LIB_SYMBOL[] = []) {
    this.symbolsList = symbolsList;
  }

  // --- columns -------------------------------------------------------------

  getColumns(): readonly LibDataModelCol[] {
    return this.cols;
  }

  getRows(): readonly LibDataModelRow[] {
    return this.rows;
  }

  isEdited(): boolean {
    return this.edited;
  }

  /** `ColIsSymbolName`. */
  colIsSymbolName(aCol: number): boolean {
    return this.cols[aCol]?.fieldName === SYMBOL_NAME;
  }

  /** `ColIsCheck`. */
  colIsCheck(aCol: number): boolean {
    return this.cols[aCol]?.isCheckbox ?? false;
  }

  /** `GetFieldNameCol`: matched the way `FieldNamesAreDuplicates` does. */
  getFieldNameCol(aFieldName: string): number {
    return this.cols.findIndex((c) => FieldNamesAreDuplicates(c.fieldName, aFieldName));
  }

  /**
   * `updateDataStoreSymbolField` (lib_fields_data_model.cpp:53-100): the
   * checkbox attribute value, else the field's raw text, else `Keywords`,
   * else the symbol name for the `SYMBOL_NAME` column, else empty.
   */
  private updateDataStoreSymbolField(aSymbol: LIB_SYMBOL, aFieldName: string): void {
    const col = this.getFieldNameCol(aFieldName);
    let fieldStore = this.dataStore.get(aSymbol.m_Uuid);
    if (!fieldStore) {
      fieldStore = new Map();
      this.dataStore.set(aSymbol.m_Uuid, fieldStore);
    }

    const field = aSymbol.GetField(aFieldName);

    if (col !== -1 && this.colIsCheck(col)) {
      const v = getAttributeValue(aSymbol, aFieldName);
      fieldStore.set(aFieldName, {
        originalData: v,
        currentData: v,
        originallyEmpty: false,
        currentlyEmpty: false,
        isModified: false,
      });
    } else if (field) {
      const text = field.GetText();
      fieldStore.set(aFieldName, {
        originalData: text,
        currentData: text,
        originallyEmpty: false,
        currentlyEmpty: false,
        isModified: false,
      });
    } else if (aFieldName === 'Keywords') {
      const kw = aSymbol.GetKeyWords();
      fieldStore.set(aFieldName, {
        originalData: kw,
        currentData: kw,
        originallyEmpty: false,
        currentlyEmpty: false,
        isModified: false,
      });
    } else if (col !== -1 && this.colIsSymbolName(col)) {
      const name = aSymbol.GetName();
      fieldStore.set(aFieldName, {
        originalData: name,
        currentData: name,
        originallyEmpty: false,
        currentlyEmpty: false,
        isModified: false,
      });
    } else {
      fieldStore.set(aFieldName, {
        originalData: '',
        currentData: '',
        originallyEmpty: true,
        currentlyEmpty: true,
        isModified: false,
      });
    }
  }

  /** `AddColumn`: a no-op if the field already has a column. */
  addColumn(aFieldName: string, aLabel: string, aAddedByUser: boolean, aIsCheckbox: boolean): void {
    if (this.getFieldNameCol(aFieldName) !== -1) return;

    this.cols.push({
      fieldName: aFieldName,
      label: aLabel,
      userAdded: aAddedByUser,
      show: false,
      group: false,
      isCheckbox: aIsCheckbox,
    });

    for (const symbol of this.symbolsList) this.updateDataStoreSymbolField(symbol, aFieldName);
  }

  /** `RemoveColumn`. */
  removeColumn(aCol: number): void {
    const fieldName = this.cols[aCol]?.fieldName;
    if (fieldName === undefined) return;

    for (const symbol of this.symbolsList) this.dataStore.get(symbol.m_Uuid)?.delete(fieldName);

    this.cols.splice(aCol, 1);

    if (this.sortColumn === aCol) this.sortColumn = 0;
    else if (this.sortColumn > aCol) this.sortColumn--;

    this.edited = true;
  }

  /** `RenameColumn`. */
  renameColumn(aCol: number, aNewName: string): void {
    const col = this.cols[aCol];
    if (!col) return;

    for (const symbol of this.symbolsList) {
      const fieldStore = this.dataStore.get(symbol.m_Uuid);
      const element = fieldStore?.get(col.fieldName);
      if (fieldStore && element) {
        fieldStore.delete(col.fieldName);
        element.isModified = true;
        fieldStore.set(aNewName, element);
      }
    }

    col.fieldName = aNewName;
    col.label = aNewName;
    this.edited = true;
  }

  /**
   * `MoveColumn`: shifts `[aCol, aNewPos]` left, or `[aNewPos, aCol]` right,
   * by one - the same rotation `std::rotate` performs, not a swap. A
   * remove-then-reinsert-at-`aNewPos` produces the identical result in both
   * directions (verified against `std::rotate`'s two branches by hand).
   */
  moveColumn(aCol: number, aNewPos: number): void {
    if (aCol < 0 || aCol >= this.cols.length || aCol === aNewPos) return;

    const [moved] = this.cols.splice(aCol, 1);
    this.cols.splice(aNewPos, 0, moved!);
  }

  /** `SetFieldsOrder`: reorders `cols` to match `aNewOrder`'s field names, left to right. */
  setFieldsOrder(aNewOrder: readonly string[]): void {
    let foundCount = 0;

    for (const newField of aNewOrder) {
      for (let i = foundCount; i < this.cols.length; i++) {
        if (this.cols[i]!.fieldName === newField) {
          [this.cols[foundCount], this.cols[i]] = [this.cols[i]!, this.cols[foundCount]!];
          foundCount++;
          break;
        }
      }
    }
  }

  /** `IsExpanderColumn`: true for the first *visible* column. */
  isExpanderColumn(aCol: number): boolean {
    for (let col = 0; col < aCol; col++) {
      if (this.cols[col]?.show) return false;
    }
    return true;
  }

  // --- cells -----------------------------------------------------------------

  /** `GetValue( const LIB_DATA_MODEL_ROW&, int )`. */
  getGroupValue(group: LibDataModelRow, aCol: number): string {
    const col = this.cols[aCol];
    if (!col) return INDETERMINATE_STATE;

    const listMixedValues = this.colIsSymbolName(aCol);
    const mixedValues = new Set<string>();
    let fieldValue = INDETERMINATE_STATE;

    for (const ref of group.refs) {
      const stored = this.dataStore.get(ref.m_Uuid)?.get(col.fieldName);
      if (!stored) return INDETERMINATE_STATE;

      const refFieldValue = stored.currentData;

      if (listMixedValues) {
        mixedValues.add(refFieldValue);
      } else if (ref === group.refs[0]) {
        fieldValue = refFieldValue;
      } else if (fieldValue !== refFieldValue) {
        return INDETERMINATE_STATE;
      }
    }

    if (listMixedValues) {
      fieldValue = '';
      for (const value of mixedValues) {
        if (value === '') continue;
        fieldValue = fieldValue === '' ? value : `${fieldValue},${value}`;
      }
    }

    return fieldValue;
  }

  /** `GetValue( int, int )`, minus the `SetReadOnly` view call. */
  getValue(aRow: number, aCol: number): string {
    const row = this.rows[aRow];
    return row ? this.getGroupValue(row, aCol) : INDETERMINATE_STATE;
  }

  /** `SetValue`: a no-op on the (uneditable) symbol-name column. */
  setValue(aRow: number, aCol: number, aValue: string): void {
    const col = this.cols[aCol];
    const row = this.rows[aRow];
    if (!col || !row) return;
    if (this.colIsSymbolName(aCol)) return;

    for (const ref of row.refs) {
      let fieldStore = this.dataStore.get(ref.m_Uuid);
      if (!fieldStore) {
        fieldStore = new Map();
        this.dataStore.set(ref.m_Uuid, fieldStore);
      }

      const existing = fieldStore.get(col.fieldName);
      const originalData = existing?.originalData ?? '';

      fieldStore.set(col.fieldName, {
        originalData,
        currentData: aValue,
        originallyEmpty: existing?.originallyEmpty ?? false,
        currentlyEmpty: false,
        isModified: aValue !== originalData,
      });
    }

    this.edited = true;
  }

  // --- grouping / sorting ------------------------------------------------

  /**
   * `groupMatch`: every `group`-flagged column's stored current value must
   * agree between the two symbols, and at least one such column must exist.
   */
  groupMatch(lhRef: LIB_SYMBOL, rhRef: LIB_SYMBOL): boolean {
    let matchFound = false;

    for (const col of this.cols) {
      if (!col.group) continue;

      const lhs = this.dataStore.get(lhRef.m_Uuid)?.get(col.fieldName)?.currentData;
      const rhs = this.dataStore.get(rhRef.m_Uuid)?.get(col.fieldName)?.currentData;

      if (lhs !== rhs) return false;

      matchFound = true;
    }

    return matchFound;
  }

  /**
   * `cmp` (lib_fields_data_model.cpp:636-668): empty rows always sink; the
   * primary key is `sortCol`, the secondary (when the primary ties on a
   * multi-member group) is `refs[1]`'s symbol name.
   */
  private cmp(lhGroup: LibDataModelRow, rhGroup: LibDataModelRow): boolean {
    if (lhGroup.refs.length === 0) return true;
    if (rhGroup.refs.length === 0) return false;

    const localCmp = (a: string, b: string): boolean => (this.sortAscending ? a < b : a > b);

    const lhs = this.getGroupValue(lhGroup, this.sortColumn).trim();
    const rhs = this.getGroupValue(rhGroup, this.sortColumn).trim();

    if (lhs === rhs && lhGroup.refs.length > 1 && rhGroup.refs.length > 1) {
      return localCmp(lhGroup.refs[1]!.GetName(), rhGroup.refs[1]!.GetName());
    }

    return localCmp(lhs, rhs);
  }

  /** `Sort`: per-row member order by `StrNumCmp` of `GetRef`, then the rows by `cmp`. */
  sort(): void {
    for (const row of this.rows) {
      row.refs.sort((lhs, rhs) => strNumCmp(lhs.GetRef(null), rhs.GetRef(null), true));
    }

    // `std::sort` with a strict-weak-ordering predicate; Array.prototype.sort
    // wants a three-way comparator, so `cmp(a,b)` (a < b) becomes -1/1/0.
    this.rows.sort((lhs, rhs) => {
      if (this.cmp(lhs, rhs)) return -1;
      if (this.cmp(rhs, lhs)) return 1;
      return 0;
    });

    let itemNumber = 1;
    for (const row of this.rows) row.itemNumber = itemNumber++;
  }

  /**
   * `RebuildRows`, minus the `WX_GRID` notifications: re-groups
   * `symbolsList` into rows from scratch (filtered, then grouped if
   * `groupingEnabled`), and sorts.
   */
  rebuildRows(): void {
    this.rows = [];

    for (const ref of this.symbolsList) {
      if (this.filter !== '') {
        let match = false;
        const fieldStore = this.dataStore.get(ref.m_Uuid);

        for (const col of this.cols) {
          const stored = fieldStore?.get(col.fieldName);
          if (stored && wildCompareString(this.filter, stored.currentData, false)) {
            match = true;
            break;
          }
        }

        if (!match) continue;
      }

      if (!this.groupingEnabled) {
        this.rows.push({ itemNumber: 0, flag: 'singleton', refs: [ref] });
        continue;
      }

      let matchFound = false;

      for (const row of this.rows) {
        const rowRef = row.refs[0]!;

        if (this.groupMatch(ref, rowRef)) {
          matchFound = true;
          row.refs.push(ref);
          row.flag = 'collapsed';
          break;
        }
      }

      if (!matchFound) this.rows.push({ itemNumber: 0, flag: 'singleton', refs: [ref] });
    }

    this.sort();
  }

  // --- filter / grouping toggles -------------------------------------------

  setFilter(aFilter: string): void {
    this.filter = aFilter;
  }

  setGroupingEnabled(aEnabled: boolean): void {
    this.groupingEnabled = aEnabled;
  }

  setSorting(aCol: number, aAscending: boolean): void {
    this.sortColumn = aCol;
    this.sortAscending = aAscending;
  }

  setSymbolsList(aSymbolsList: readonly LIB_SYMBOL[]): void {
    this.symbolsList = aSymbolsList;
  }
}
