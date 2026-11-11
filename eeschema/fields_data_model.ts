// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/fields_data_model.{h,cpp}`: the Symbol Fields Table's two grid tables.
 *
 *  - VIEW_CONTROLS_GRID_DATA_MODEL, the field list beside the grid (Field / Label / Include /
 *    Group By);
 *  - FIELDS_EDITOR_GRID_DATA_MODEL, the grid itself over a SCH_REFERENCE_LIST of live symbols:
 *    one column per field (plus the generated `${QUANTITY}` / `${ITEM_NUMBER}` and the attribute
 *    columns), rows grouped by unit and, with grouping on, by the group-by columns, edits held in a
 *    data store keyed by sheet path + symbol until ApplyData commits them.
 *
 * GRID_CELL_RESOLVED_TEXT_RENDERER is the grid window's: a text-variable cell renders
 * GetResolvedValue (the attribute this table asks for carries `resolvedText`).
 */
import { ExpandTextVars, IsGeneratedField } from '@ziroeda/common/common.js';
import { CombinedMatcherContext, EdaCombinedMatcher } from '@ziroeda/common/eda_pattern_match.js';
import { KIID_PATH } from '@ziroeda/common/kiid.js';
import type {
  BOM_FIELD,
  BOM_FMT_PRESET,
  BOM_PRESET,
} from '@ziroeda/common/settings/bom_settings.js';
import { IsURL, strNumCmp, valueStringCompare } from '@ziroeda/common/string_utils.js';
import {
  FieldNamesAreDuplicates,
  FIELD_T,
  GetCanonicalFieldName,
  GetDefaultFieldName,
  MANDATORY_FIELDS,
  type TEMPLATES,
} from '@ziroeda/common/template_fieldnames.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { GROUP_TYPE, WX_GRID_TABLE_BASE, type WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { GetTextExtent } from '@ziroeda/wx/controls.js';
import {
  type wxAttrKind,
  wxGRID_VALUE_BOOL,
  wxGRID_VALUE_STRING,
  type wxGrid,
  wxGridCellAttr,
  type wxGridCellDrawn,
  wxGridCellStringRenderer,
  wxGridTableRequest,
} from '@ziroeda/wx/grid.js';
import type { SCH_COMMIT } from './sch_commit.js';
import { SCH_FIELD } from './sch_field.js';
import { type SCH_REFERENCE, SCH_REFERENCE_LIST } from './sch_reference_list.js';
import { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import { _ } from '@ziroeda/wx/translation.js';

export { INDETERMINATE_STATE };

export const DISPLAY_NAME_COLUMN = 0; // The field name in the data model (translated)
export const LABEL_COLUMN = 1; // The field name's label for exporting (CSV, etc.)
export const SHOW_FIELD_COLUMN = 2;
export const GROUP_BY_COLUMN = 3;
export const VIEW_FIELDS_COL_COUNT = 4;

/**
 * Create a unique key for the data store by combining the KIID_PATH from the SCH_SHEET_PATH with
 * the symbol's UUID.
 */
function makeDataStoreKey(aSheetPath: SCH_SHEET_PATH, aSymbol: SCH_SYMBOL): string {
  const path = new KIID_PATH(aSheetPath.Path().AsString());
  path.push_back(aSymbol.m_Uuid);
  return path.AsString();
}

export class VIEW_CONTROLS_GRID_DATA_MODEL extends WX_GRID_TABLE_BASE {
  protected m_forBOM: boolean;
  protected m_fields: BOM_FIELD[] = [];

  constructor(aForBOM: boolean) {
    super();
    this.m_forBOM = aForBOM;
  }

  GetNumberRows(): number {
    return this.m_fields.length;
  }

  GetNumberCols(): number {
    return VIEW_FIELDS_COL_COUNT;
  }

  override GetColLabelValue(aCol: number): string {
    switch (aCol) {
      case DISPLAY_NAME_COLUMN:
        return 'Field';
      case LABEL_COLUMN:
        return this.m_forBOM ? _('BOM Name') : _('Label');
      case SHOW_FIELD_COLUMN:
        return 'Include';
      case GROUP_BY_COLUMN:
        return 'Group By';
      default:
        return 'unknown column';
    }
  }

  override IsEmptyCell(_aRow: number, _aCol: number): boolean {
    return false; // don't allow adjacent cell overflow, even if we are actually empty
  }

  override CanGetValueAs(_aRow: number, aCol: number, aTypeName: string): boolean {
    switch (aCol) {
      case DISPLAY_NAME_COLUMN:
      case LABEL_COLUMN:
        return aTypeName === wxGRID_VALUE_STRING;
      case SHOW_FIELD_COLUMN:
      case GROUP_BY_COLUMN:
        return aTypeName === wxGRID_VALUE_BOOL;
      default:
        return false;
    }
  }

  override CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }

  GetValue(aRow: number, aCol: number): string {
    if (aRow >= this.GetNumberRows()) return 'bad row!';

    const rowData = this.m_fields[aRow]!;

    switch (aCol) {
      case DISPLAY_NAME_COLUMN:
        for (const fieldId of MANDATORY_FIELDS) {
          if (GetDefaultFieldName(fieldId, false) === rowData.name)
            return GetDefaultFieldName(fieldId, true);
        }

        return rowData.name;

      case LABEL_COLUMN:
        return rowData.label;

      default:
        // we can't assert here because wxWidgets sometimes calls this without checking
        // the column type when trying to see if there's an overflow
        return 'bad wxWidgets!';
    }
  }

  override GetValueAsBool(aRow: number, aCol: number): boolean {
    if (aRow >= this.GetNumberRows()) return false;

    const rowData = this.m_fields[aRow]!;

    switch (aCol) {
      case SHOW_FIELD_COLUMN:
        return rowData.show;
      case GROUP_BY_COLUMN:
        return rowData.groupBy;
      default:
        return false;
    }
  }

  SetValue(aRow: number, aCol: number, aValue: string): void {
    if (aRow >= this.GetNumberRows()) return;

    const rowData = this.m_fields[aRow]!;

    switch (aCol) {
      case DISPLAY_NAME_COLUMN:
        // Not editable
        break;

      case LABEL_COLUMN:
        rowData.label = aValue;
        break;
    }

    this.GetView()?.Refresh();
  }

  override SetValueAsBool(aRow: number, aCol: number, aValue: boolean): void {
    if (aRow >= this.GetNumberRows()) return;

    const rowData = this.m_fields[aRow]!;

    switch (aCol) {
      case SHOW_FIELD_COLUMN:
        rowData.show = aValue;
        break;
      case GROUP_BY_COLUMN:
        rowData.groupBy = aValue;
        break;
    }
  }

  AppendRow(aFieldName: string, aBOMName: string, aShow: boolean, aGroupBy: boolean): void {
    this.m_fields.push({ name: aFieldName, label: aBOMName, show: aShow, groupBy: aGroupBy });

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1);
  }

  DeleteRow(aRow: number): void {
    if (aRow < 0 || aRow >= this.GetNumberRows()) return;

    this.m_fields.splice(aRow, 1);

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aRow, 1);
  }

  GetCanonicalFieldName(aRow: number): string {
    if (aRow < 0 || aRow >= this.GetNumberRows()) return '';

    return this.m_fields[aRow]!.name;
  }

  SetCanonicalFieldName(aRow: number, aName: string): void {
    if (aRow < 0 || aRow >= this.GetNumberRows()) return;

    this.m_fields[aRow]!.name = aName;
  }
}

/** `DATA_MODEL_ROW`: the references one grid row stands for. */
export class DATA_MODEL_ROW {
  m_ItemNumber: number;
  m_Flag: GROUP_TYPE;
  m_Refs: SCH_REFERENCE[];

  constructor(aFirstReference: SCH_REFERENCE, aType: GROUP_TYPE) {
    this.m_ItemNumber = 0;
    this.m_Refs = [aFirstReference];
    this.m_Flag = aType;
  }
}

/** `DATA_MODEL_COL` */
export interface DATA_MODEL_COL {
  m_fieldName: string;
  m_label: string;
  m_userAdded: boolean;
  m_show: boolean;
  m_group: boolean;
}

/**
 * `GRID_CELL_RESOLVED_TEXT_RENDERER`: a cell renderer that shows the expanded result of text
 * variables (e.g. "${VALUE}" is displayed as "10K"). The actual cell still stores the raw
 * variable so it can be edited directly.
 */
export class GRID_CELL_RESOLVED_TEXT_RENDERER
  extends wxGridCellStringRenderer
  implements wxGridCellDrawn
{
  DrawValue(aValue: string, aGrid: wxGrid, aRow: number, aCol: number): { label: string } {
    const model = aGrid.GetTable();

    return {
      label:
        model instanceof FIELDS_EDITOR_GRID_DATA_MODEL
          ? model.GetResolvedValue(aRow, aCol)
          : aValue,
    };
  }
}

/** The theme-dependent tints GetAttr picks (wxSYS_COLOUR_WINDOW dark or light). */
const VARIANT_HIGHLIGHT = { dark: '#505028', light: '#ffffc8' }; // [data] wxColour( 80, 80, 40 ) / ( 255, 255, 200 )
const TEXT_VAR_TINT = { dark: '#50461e', light: '#fffcc8' }; // [data] wxColour( 80, 70, 30 ) / ( 255, 252, 200 )

export class FIELDS_EDITOR_GRID_DATA_MODEL extends WX_GRID_TABLE_BASE {
  static readonly QUANTITY_VARIABLE = '${QUANTITY}';
  static readonly ITEM_NUMBER_VARIABLE = '${ITEM_NUMBER}';

  static readonly SCOPE = { SCOPE_ALL: 0, SCOPE_SHEET: 1, SCOPE_SHEET_RECURSIVE: 2 } as const;

  protected m_symbolsList: SCH_REFERENCE_LIST;
  protected m_edited = false;
  protected m_sortColumn = 0;
  protected m_sortAscending = false;
  protected m_filter = '';
  protected m_scope: number = FIELDS_EDITOR_GRID_DATA_MODEL.SCOPE.SCOPE_ALL;
  protected m_path = new SCH_SHEET_PATH();
  protected m_groupingEnabled = false;
  protected m_excludeDNP = false;
  protected m_includeExcluded = false;
  protected m_rebuildsEnabled = true;
  protected m_urlEditor: wxGridCellAttr | null;
  protected m_currentVariant = '';
  protected m_variantNames: string[] = [];
  protected m_textVarRenderer: GRID_CELL_RESOLVED_TEXT_RENDERER | null = null;

  protected m_cols: DATA_MODEL_COL[] = [];
  protected m_rows: DATA_MODEL_ROW[] = [];

  /** Data store: the KIID_PATH (sheet path + symbol UUID) to field name to value. */
  protected m_dataStore = new Map<string, Map<string, string>>();

  /** Whether the window draws dark (wxSYS_COLOUR_WINDOW's brightness, which GetAttr reads). */
  private m_isDark: () => boolean;

  constructor(
    aSymbolsList: SCH_REFERENCE_LIST,
    aURLEditor: wxGridCellAttr | null,
    aIsDark: () => boolean = () => true,
  ) {
    super();
    this.m_symbolsList = aSymbolsList;
    this.m_urlEditor = aURLEditor;
    this.m_isDark = aIsDark;
    this.m_symbolsList.SplitReferences();
  }

  private store(aKey: string): Map<string, string> {
    let fields = this.m_dataStore.get(aKey);

    if (!fields) {
      fields = new Map();
      this.m_dataStore.set(aKey, fields);
    }

    return fields;
  }

  AddColumn(aFieldName: string, aLabel: string, aAddedByUser: boolean): void {
    // Don't add a field twice
    if (this.GetFieldNameCol(aFieldName) !== -1) return;

    this.m_cols.push({
      m_fieldName: aFieldName,
      m_label: aLabel,
      m_userAdded: aAddedByUser,
      m_show: false,
      m_group: false,
    });

    for (let i = 0; i < this.m_symbolsList.GetCount(); ++i)
      this.updateDataStoreSymbolField(this.m_symbolsList.GetItem(i), aFieldName);
  }

  protected updateDataStoreSymbolField(aSymbolRef: SCH_REFERENCE, aFieldName: string): void {
    const symbol = aSymbolRef.GetSymbol();

    if (!symbol) return;

    const fields = this.store(makeDataStoreKey(aSymbolRef.GetSheetPath(), symbol));

    if (this.isAttribute(aFieldName)) {
      fields.set(aFieldName, this.getAttributeValue(aSymbolRef, aFieldName, this.m_currentVariant));
      return;
    }

    const field = symbol.GetField(aFieldName);

    if (field) {
      if (field.IsPrivate()) {
        fields.set(aFieldName, '');
        return;
      }

      fields.set(
        aFieldName,
        symbol
          .Schematic()!
          .ConvertKIIDsToRefs(field.GetText(aSymbolRef.GetSheetPath(), this.m_currentVariant)),
      );
    } else if (IsGeneratedField(aFieldName)) {
      // Handle generated fields with variables as names (e.g. ${QUANTITY}) that are not present
      // in the symbol by giving them the correct value
      fields.set(aFieldName, aFieldName);
    } else {
      fields.set(aFieldName, '');
    }
  }

  RemoveColumn(aCol: number): void {
    for (let i = 0; i < this.m_symbolsList.GetCount(); ++i) {
      const ref = this.m_symbolsList.GetItem(i);
      const symbol = ref.GetSymbol();

      if (symbol)
        this.store(makeDataStoreKey(ref.GetSheetPath(), symbol)).delete(
          this.m_cols[aCol]!.m_fieldName,
        );
    }

    this.m_cols.splice(aCol, 1);

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_COLS_DELETED, aCol, 1);
  }

  RenameColumn(aCol: number, newName: string): void {
    for (let i = 0; i < this.m_symbolsList.GetCount(); ++i) {
      const ref = this.m_symbolsList.GetItem(i);
      const fields = this.store(makeDataStoreKey(ref.GetSheetPath(), ref.GetSymbol()!));
      const oldName = this.m_cols[aCol]!.m_fieldName;

      // Careful; field may have already been renamed from another sheet instance
      if (fields.has(oldName)) {
        const value = fields.get(oldName)!;
        fields.delete(oldName);
        fields.set(newName, value);
      }
    }

    this.m_cols[aCol]!.m_fieldName = newName;
    this.m_cols[aCol]!.m_label = newName;
  }

  MoveColumn(aCol: number, aNewPos: number): void {
    if (aCol < 0 || aCol >= this.m_cols.length || aCol === aNewPos) return;

    const [col] = this.m_cols.splice(aCol, 1);
    this.m_cols.splice(aNewPos, 0, col!);
  }

  GetNumberRows(): number {
    return this.m_rows.length;
  }

  GetNumberCols(): number {
    return this.m_cols.length;
  }

  override SetColLabelValue(aCol: number, aLabel: string): void {
    if (aCol < 0 || aCol >= this.m_cols.length) return;

    this.m_cols[aCol]!.m_label = aLabel;
  }

  override GetColLabelValue(aCol: number): string {
    if (aCol < 0 || aCol >= this.m_cols.length) return '';

    return this.m_cols[aCol]!.m_label;
  }

  GetColFieldName(aCol: number): string {
    if (aCol < 0 || aCol >= this.m_cols.length) return '';

    return this.m_cols[aCol]!.m_fieldName;
  }

  GetFieldNameCol(aFieldName: string): number {
    for (let i = 0; i < this.m_cols.length; i++) {
      if (FieldNamesAreDuplicates(this.m_cols[i]!.m_fieldName, aFieldName)) return i;
    }

    return -1;
  }

  GetFieldsOrdered(): BOM_FIELD[] {
    return this.m_cols.map((col) => ({
      name: col.m_fieldName,
      label: col.m_label,
      show: col.m_show,
      groupBy: col.m_group,
    }));
  }

  SetFieldsOrder(aNewOrder: readonly string[]): void {
    let foundCount = 0;

    for (const newField of aNewOrder) {
      if (foundCount >= this.m_cols.length) break;

      for (let i = 0; i < this.m_cols.length; i++) {
        if (this.m_cols[i]!.m_fieldName === newField) {
          [this.m_cols[foundCount], this.m_cols[i]] = [this.m_cols[i]!, this.m_cols[foundCount]!];
          foundCount++;
          break;
        }
      }
    }
  }

  override IsEmptyCell(_aRow: number, _aCol: number): boolean {
    return false; // don't allow adjacent cell overflow, even if we are actually empty
  }

  override IsExpanderColumn(aCol: number): boolean {
    // Check if aCol is the first visible column
    for (let col = 0; col < aCol; ++col) {
      if (this.m_cols[col]!.m_show) return false;
    }

    return true;
  }

  /** `GetValue( aRow, aCol )` and `GetValue( group, aCol, ... )`. */
  GetValue(aRow: number, aCol: number): string;
  GetValue(
    group: DATA_MODEL_ROW,
    aCol: number,
    refDelimiter?: string,
    refRangeDelimiter?: string,
    resolveVars?: boolean,
    listMixedValues?: boolean,
  ): string;
  GetValue(
    a: number | DATA_MODEL_ROW,
    aCol: number,
    refDelimiter = ', ',
    refRangeDelimiter = '-',
    resolveVars = false,
    listMixedValues = false,
  ): string {
    if (typeof a === 'number') {
      this.GetView()?.SetReadOnly(
        a,
        aCol,
        this.IsExpanderColumn(aCol) || this.rowAttributeInheritedFromSheet(this.m_rows[a]!, aCol),
      );
      return this.GetValue(this.m_rows[a]!, aCol);
    }

    const group = a;
    let references: SCH_REFERENCE[] = [];
    const mixedValues = new Set<string>();
    let fieldValue = '';
    const fieldName = this.m_cols[aCol]!.m_fieldName;

    for (const ref of group.m_Refs) {
      if (this.ColIsReference(aCol) || this.ColIsQuantity(aCol) || this.ColIsItemNumber(aCol)) {
        references.push(ref);
      } else {
        // Other columns are either a single value or ROW_MULTI_ITEMS
        const fields = this.m_dataStore.get(makeDataStoreKey(ref.GetSheetPath(), ref.GetSymbol()!));

        if (!fields || !fields.has(fieldName)) return INDETERMINATE_STATE;

        let refFieldValue = fields.get(fieldName)!;

        // Show the effective state when a sheet forces it on, but do not change
        // the stored value so the symbol is never stamped on apply.
        if (this.ColIsAttribute(aCol) && this.attributeInheritedFromSheet(ref, fieldName))
          refFieldValue = '1';

        if (resolveVars) {
          if (IsGeneratedField(fieldName)) {
            // Generated fields (e.g. ${QUANTITY}) can't have un-applied values as they're
            // read-only.  Resolve them against the field.
            refFieldValue = this.getFieldShownText(ref, fieldName);
          } else if (refFieldValue.includes('${')) {
            // Resolve variables in the un-applied value using the parent symbol and instance
            // data.
            refFieldValue = ExpandTextVars(refFieldValue, (token) =>
              ref.GetSymbol()!.ResolveTextVar(ref.GetSheetPath(), token, this.m_currentVariant),
            );
          }
        }

        if (listMixedValues) mixedValues.add(refFieldValue);
        else if (ref === group.m_Refs[0]) fieldValue = refFieldValue;
        else if (fieldValue !== refFieldValue) return INDETERMINATE_STATE;
      }
    }

    if (listMixedValues) {
      fieldValue = '';

      for (const value of [...mixedValues].sort()) {
        if (value === '') continue;
        else if (fieldValue === '') fieldValue = value;
        else fieldValue += `,${value}`;
      }
    }

    if (this.ColIsReference(aCol) || this.ColIsQuantity(aCol) || this.ColIsItemNumber(aCol)) {
      // Remove duplicates (other units of multi-unit parts)
      const fullRef = (r: SCH_REFERENCE) => r.GetRef() + r.GetRefNumber();
      references.sort((l, r) => strNumCmp(fullRef(l), fullRef(r), true));

      const unique: SCH_REFERENCE[] = [];

      for (const ref of references) {
        const last = unique.at(-1);

        // If unannotated then we can't tell what units belong together
        // so we have to leave them all
        if (last && last.GetRefNumber() !== '?' && fullRef(last) === fullRef(ref)) continue;

        unique.push(ref);
      }

      references = unique;
    }

    if (this.ColIsReference(aCol))
      fieldValue = SCH_REFERENCE_LIST.Shorthand(references, refDelimiter, refRangeDelimiter);
    else if (this.ColIsQuantity(aCol)) fieldValue = `${references.length}`;
    else if (this.ColIsItemNumber(aCol) && group.m_Flag !== GROUP_TYPE.CHILD_ITEM)
      fieldValue = `${group.m_ItemNumber}`;

    return fieldValue;
  }

  GetResolvedValue(aRow: number, aCol: number): string {
    return this.GetValue(this.m_rows[aRow]!, aCol, ', ', '-', true, false);
  }

  override GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    let attr: wxGridCellAttr | null = null;
    let needsUrlEditor = false;
    let needsVariantHighlight = false;
    let needsTextVarRenderer = false;
    let highlightColor = '';

    // Check if we need URL editor
    if (
      this.GetColFieldName(aCol) === GetCanonicalFieldName(FIELD_T.DATASHEET) ||
      IsURL(this.GetValue(this.m_rows[aRow]!, aCol))
    ) {
      if (this.m_urlEditor) needsUrlEditor = true;
    }

    // Check if the raw value contains a text variable that should be resolved for display
    if (
      aRow >= 0 &&
      aRow < this.m_rows.length &&
      aCol >= 0 &&
      aCol < this.m_cols.length &&
      !this.ColIsReference(aCol) &&
      !this.ColIsQuantity(aCol) &&
      !this.ColIsItemNumber(aCol)
    ) {
      if (this.GetValue(this.m_rows[aRow]!, aCol).includes('${')) needsTextVarRenderer = true;
    }

    // Check if we need variant highlighting
    if (
      this.m_currentVariant !== '' &&
      aRow >= 0 &&
      aRow < this.m_rows.length &&
      aCol >= 0 &&
      aCol < this.m_cols.length
    ) {
      const fieldName = this.m_cols[aCol]!.m_fieldName;

      // Skip Reference and generated fields (like ${QUANTITY}) for highlighting
      if (!this.ColIsReference(aCol) && !this.ColIsQuantity(aCol) && !this.ColIsItemNumber(aCol)) {
        // Check if any symbol in this row has a variant-specific value
        for (const ref of this.m_rows[aRow]!.m_Refs) {
          const defaultValue = this.getDefaultFieldValue(ref, fieldName);
          const symbol = ref.GetSymbol();
          const symbolKey = symbol ? makeDataStoreKey(ref.GetSheetPath(), symbol) : '';
          const currentValue = this.m_dataStore.get(symbolKey)?.get(fieldName) ?? '';

          if (currentValue !== defaultValue) {
            needsVariantHighlight = true;

            // Use a subtle highlight color that works in both light and dark themes
            highlightColor = this.m_isDark() ? VARIANT_HIGHLIGHT.dark : VARIANT_HIGHLIGHT.light;
            break;
          }
        }
      }
    }

    // If we don't need any custom attributes, use the base class behavior
    if (!needsUrlEditor && !needsVariantHighlight && !needsTextVarRenderer)
      return super.GetAttr(aRow, aCol, aKind);

    // URL cells: use m_urlEditor as base, potentially with variant highlight overlay
    if (needsUrlEditor) {
      attr = this.m_urlEditor!.Clone();

      if (needsVariantHighlight) attr.SetBackgroundColour(highlightColor);

      return this.enhanceAttr(attr, aRow, aCol, aKind);
    }

    // Non-URL cells: start with column attributes if they exist.
    // This preserves checkbox renderers and other column-specific settings.
    const colAttr = this.m_colAttrs.get(aCol);
    attr = colAttr ? colAttr.Clone() : new wxGridCellAttr();

    if (needsVariantHighlight) attr.SetBackgroundColour(highlightColor);

    if (needsTextVarRenderer) {
      this.m_textVarRenderer ??= new GRID_CELL_RESOLVED_TEXT_RENDERER();
      attr.SetRenderer(this.m_textVarRenderer);

      // Tint text-var cells if not already highlighted by variant
      if (!needsVariantHighlight)
        attr.SetBackgroundColour(this.m_isDark() ? TEXT_VAR_TINT.dark : TEXT_VAR_TINT.light);
    }

    return this.enhanceAttr(attr, aRow, aCol, aKind);
  }

  GetExportValue(
    aRow: number,
    aCol: number,
    refDelimiter: string,
    refRangeDelimiter: string,
  ): string {
    return this.GetValue(this.m_rows[aRow]!, aCol, refDelimiter, refRangeDelimiter, true, true);
  }

  SetValue(aRow: number, aCol: number, aValue: string): void {
    if (aCol < 0 || aCol >= this.m_cols.length) return;

    const fieldName = this.m_cols[aCol]!.m_fieldName;

    // Can't modify references or generated fields (e.g. ${QUANTITY})
    if (this.ColIsReference(aCol) || (IsGeneratedField(fieldName) && !this.ColIsAttribute(aCol)))
      return;

    if (aValue === INDETERMINATE_STATE) return;

    const editedSymbols = new Set<SCH_SYMBOL>();

    for (const ref of this.m_rows[aRow]!.m_Refs) {
      editedSymbols.add(ref.GetSymbol()!);
      this.store(makeDataStoreKey(ref.GetSheetPath(), ref.GetSymbol()!)).set(fieldName, aValue);
    }

    // ApplyData walks every path a symbol is reachable through, so an edit to storage those
    // paths have in common must also reach the ones the current scope and filter hide
    if (this.storageIsSharedAcrossPaths(fieldName)) {
      for (let ii = 0; ii < this.m_symbolsList.GetCount(); ++ii) {
        const ref = this.m_symbolsList.GetItem(ii);

        if (!editedSymbols.has(ref.GetSymbol()!)) continue;

        this.store(makeDataStoreKey(ref.GetSheetPath(), ref.GetSymbol()!)).set(fieldName, aValue);
      }
    }

    this.m_edited = true;
  }

  GetRowFlags(aRow: number): GROUP_TYPE {
    return this.m_rows[aRow]!.m_Flag;
  }

  GetRowReferences(aRow: number): SCH_REFERENCE[] {
    if (aRow < 0 || aRow >= this.m_rows.length) return [];

    return [...this.m_rows[aRow]!.m_Refs];
  }

  ColIsReference(aCol: number): boolean {
    if (aCol < 0 || aCol >= this.m_cols.length) return false;
    return this.m_cols[aCol]!.m_fieldName === GetCanonicalFieldName(FIELD_T.REFERENCE);
  }

  ColIsValue(aCol: number): boolean {
    if (aCol < 0 || aCol >= this.m_cols.length) return false;
    return this.m_cols[aCol]!.m_fieldName === GetCanonicalFieldName(FIELD_T.VALUE);
  }

  ColIsQuantity(aCol: number): boolean {
    if (aCol < 0 || aCol >= this.m_cols.length) return false;
    return this.m_cols[aCol]!.m_fieldName === FIELDS_EDITOR_GRID_DATA_MODEL.QUANTITY_VARIABLE;
  }

  ColIsItemNumber(aCol: number): boolean {
    if (aCol < 0 || aCol >= this.m_cols.length) return false;
    return this.m_cols[aCol]!.m_fieldName === FIELDS_EDITOR_GRID_DATA_MODEL.ITEM_NUMBER_VARIABLE;
  }

  ColIsAttribute(aCol: number): boolean {
    if (aCol < 0 || aCol >= this.m_cols.length) return false;
    return this.isAttribute(this.m_cols[aCol]!.m_fieldName);
  }

  override GetGroupType(aRow: number): GROUP_TYPE {
    return this.m_rows[aRow]!.m_Flag;
  }

  SetSorting(aCol: number, ascending: boolean): void {
    if (aCol < 0 || aCol >= this.m_cols.length) return;

    this.m_sortColumn = aCol;
    this.m_sortAscending = ascending;
  }

  GetSortCol(): number {
    return this.m_sortColumn;
  }

  GetSortAsc(): boolean {
    return this.m_sortAscending;
  }

  /** `cmp( lhGroup, rhGroup, dataModel, sortCol, ascending )`: a strict weak order (true = lhs first). */
  private static cmp(
    lhGroup: DATA_MODEL_ROW,
    rhGroup: DATA_MODEL_ROW,
    dataModel: FIELDS_EDITOR_GRID_DATA_MODEL,
    sortCol: number,
    ascending: boolean,
  ): boolean {
    // Empty rows always go to the bottom, whether ascending or descending
    if (lhGroup.m_Refs.length === 0) return true;
    else if (rhGroup.m_Refs.length === 0) return false;

    // N.B. To meet the iterator sort conditions, we cannot simply invert the truth
    // to get the opposite sort.  i.e. ~(a<b) != (a>b)
    const local_cmp = (a: number, b: number): boolean => (ascending ? a < b : a > b);

    // Primary sort key is sortCol; secondary is always REFERENCE (column 0)
    if (sortCol < 0 || sortCol >= dataModel.GetNumberCols()) sortCol = 0;

    const lhs = dataModel.GetValue(lhGroup, sortCol, ', ', '-', true).trim();
    const rhs = dataModel.GetValue(rhGroup, sortCol, ', ', '-', true).trim();

    if (lhs === rhs || dataModel.ColIsReference(sortCol)) {
      const lhRef = lhGroup.m_Refs[0]!.GetRef() + lhGroup.m_Refs[0]!.GetRefNumber();
      const rhRef = rhGroup.m_Refs[0]!.GetRef() + rhGroup.m_Refs[0]!.GetRefNumber();
      return local_cmp(strNumCmp(lhRef, rhRef, true), 0);
    }

    return local_cmp(valueStringCompare(lhs, rhs), 0);
  }

  /** std::sort over a `cmp`-style predicate. */
  private sortRows(aRows: DATA_MODEL_ROW[]): void {
    aRows.sort((l, r) =>
      FIELDS_EDITOR_GRID_DATA_MODEL.cmp(l, r, this, this.m_sortColumn, this.m_sortAscending)
        ? -1
        : FIELDS_EDITOR_GRID_DATA_MODEL.cmp(r, l, this, this.m_sortColumn, this.m_sortAscending)
          ? 1
          : 0,
    );
  }

  /** `Sort()` (fields_data_model.cpp:787). */
  Sort(): void {
    this.CollapseForSort();

    // We're going to sort the rows based on their first reference, so the first reference
    // had better be the lowest one.
    for (const row of this.m_rows) {
      row.m_Refs.sort((lhs, rhs) =>
        strNumCmp(lhs.GetRef() + lhs.GetRefNumber(), rhs.GetRef() + rhs.GetRefNumber(), true),
      );
    }

    this.sortRows(this.m_rows);

    // Time to renumber the item numbers
    let itemNumber = 1;

    for (const row of this.m_rows) row.m_ItemNumber = itemNumber++;

    this.ExpandAfterSort();
  }

  private unitMatch(lhRef: SCH_REFERENCE, rhRef: SCH_REFERENCE): boolean {
    // If items are unannotated then we can't tell if they're units of the same symbol or not
    if (lhRef.GetRefNumber() === '?') return false;

    return lhRef.GetRef() === rhRef.GetRef() && lhRef.GetRefNumber() === rhRef.GetRefNumber();
  }

  private groupMatch(lhRef: SCH_REFERENCE, rhRef: SCH_REFERENCE): boolean {
    const refCol = this.GetFieldNameCol(GetCanonicalFieldName(FIELD_T.REFERENCE));
    let matchFound = false;

    if (refCol === -1) return false;

    // First check the reference column.  This can be done directly out of the
    // SCH_REFERENCEs as the references can't be edited in the grid.
    if (this.m_cols[refCol]!.m_group) {
      // if we're grouping by reference, then only the prefix must match
      if (lhRef.GetRef() !== rhRef.GetRef()) return false;

      matchFound = true;
    }

    const lhFields = this.store(makeDataStoreKey(lhRef.GetSheetPath(), lhRef.GetSymbol()!));
    const rhFields = this.store(makeDataStoreKey(rhRef.GetSheetPath(), rhRef.GetSymbol()!));

    // Now check all the other columns.
    for (let i = 0; i < this.m_cols.length; ++i) {
      //Handled already
      if (i === refCol) continue;

      const col = this.m_cols[i]!;

      if (!col.m_group) continue;

      // If the field is generated (e.g. ${QUANTITY}), we need to resolve it through the symbol
      // to get the actual current value; otherwise we need to pull it out of the store so the
      // refresh can regroup based on values that haven't been applied to the schematic yet.
      const lhStored = lhFields.get(col.m_fieldName) ?? '';
      const rhStored = rhFields.get(col.m_fieldName) ?? '';
      const lh =
        IsGeneratedField(col.m_fieldName) || IsGeneratedField(lhStored)
          ? this.getFieldShownText(lhRef, col.m_fieldName)
          : lhStored;
      const rh =
        IsGeneratedField(col.m_fieldName) || IsGeneratedField(rhStored)
          ? this.getFieldShownText(rhRef, col.m_fieldName)
          : rhStored;

      if (lh !== rh) return false;

      matchFound = true;
    }

    return matchFound;
  }

  private getFieldShownText(aRef: SCH_REFERENCE, aFieldName: string): string {
    const field = aRef.GetSymbol()!.GetField(aFieldName);

    if (field) {
      if (field.IsPrivate()) return '';

      return field.GetShownText(aRef.GetSheetPath(), false, 0, this.m_currentVariant);
    }

    // Handle generated fields with variables as names (e.g. ${QUANTITY}) that are not present in
    // the symbol by giving them the correct value by resolving against the symbol
    if (IsGeneratedField(aFieldName)) {
      const depth = 0;
      const path = aRef.GetSheetPath();

      return ExpandTextVars(aFieldName, (token) =>
        aRef.GetSymbol()!.ResolveTextVar(path, token, this.m_currentVariant, depth + 1),
      );
    }

    return '';
  }

  private isAttribute(aFieldName: string): boolean {
    return (
      aFieldName === '${DNP}' ||
      aFieldName === '${EXCLUDE_FROM_BOARD}' ||
      aFieldName === '${EXCLUDE_FROM_BOM}' ||
      aFieldName === '${EXCLUDE_FROM_POS_FILES}' ||
      aFieldName === '${EXCLUDE_FROM_SIM}'
    );
  }

  private storageIsSharedAcrossPaths(aFieldName: string): boolean {
    // Variant edits are kept on the symbol instance, but SCH_REFERENCE has no variant form of
    // the board exclusion so that one always lands on the symbol
    if (aFieldName === '${EXCLUDE_FROM_BOARD}') return true;

    return this.m_currentVariant === '';
  }

  private getAttributeValue(
    aRef: SCH_REFERENCE,
    aAttributeName: string,
    aVariantName: string,
  ): string {
    const b = (v: boolean) => (v ? '1' : '0');

    if (aAttributeName === '${DNP}') return b(aRef.GetSymbolDNP(aVariantName));
    if (aAttributeName === '${EXCLUDE_FROM_BOARD}') return b(aRef.GetSymbolExcludedFromBoard());
    if (aAttributeName === '${EXCLUDE_FROM_BOM}')
      return b(aRef.GetSymbolExcludedFromBOM(aVariantName));
    if (aAttributeName === '${EXCLUDE_FROM_SIM}')
      return b(aRef.GetSymbolExcludedFromSim(aVariantName));
    if (aAttributeName === '${EXCLUDE_FROM_POS_FILES}')
      return b(aRef.GetSymbolExcludedFromPosFiles(aVariantName));

    return '0';
  }

  private attributeInheritedFromSheet(aRef: SCH_REFERENCE, aAttributeName: string): boolean {
    const path = aRef.GetSheetPath();

    if (aAttributeName === '${DNP}') return path.GetDNP(this.m_currentVariant);
    else if (aAttributeName === '${EXCLUDE_FROM_BOARD}')
      return path.GetExcludedFromBoard(this.m_currentVariant);
    else if (aAttributeName === '${EXCLUDE_FROM_BOM}')
      return path.GetExcludedFromBOM(this.m_currentVariant);
    else if (aAttributeName === '${EXCLUDE_FROM_SIM}')
      return path.GetExcludedFromSim(this.m_currentVariant);

    return false;
  }

  private rowAttributeInheritedFromSheet(aGroup: DATA_MODEL_ROW, aCol: number): boolean {
    if (!this.ColIsAttribute(aCol) || aGroup.m_Refs.length === 0) return false;

    // Lock the cell only when every symbol in the row inherits it, so a mixed group
    // stays editable and shows the indeterminate state.
    for (const ref of aGroup.m_Refs) {
      if (!this.attributeInheritedFromSheet(ref, this.m_cols[aCol]!.m_fieldName)) return false;
    }

    return true;
  }

  private getDefaultFieldValue(aRef: SCH_REFERENCE, aFieldName: string): string {
    const symbol = aRef.GetSymbol();

    if (!symbol) return '';

    // For attributes, get the default (non-variant) value
    if (this.isAttribute(aFieldName)) return this.getAttributeValue(aRef, aFieldName, '');

    // For regular fields, get the text without variant override
    const field = symbol.GetField(aFieldName);

    if (field) {
      if (field.IsPrivate()) return '';

      return symbol.Schematic()!.ConvertKIIDsToRefs(field.GetText(aRef.GetSheetPath(), ''));
    }

    // For generated fields, return the field name itself
    if (IsGeneratedField(aFieldName)) return aFieldName;

    return '';
  }

  private setAttributeValue(
    aRef: SCH_REFERENCE,
    aAttributeName: string,
    aValue: string,
    aVariantName: string,
  ): boolean {
    let attrChanged = false;
    const newValue = aValue === '1';

    if (aAttributeName === '${DNP}') {
      attrChanged = aRef.GetSymbolDNP(aVariantName) !== newValue;
      if (attrChanged) aRef.SetSymbolDNP(newValue, aVariantName);
    } else if (aAttributeName === '${EXCLUDE_FROM_BOARD}') {
      attrChanged = aRef.GetSymbolExcludedFromBoard() !== newValue;
      if (attrChanged) aRef.SetSymbolExcludedFromBoard(newValue);
    } else if (aAttributeName === '${EXCLUDE_FROM_BOM}') {
      attrChanged = aRef.GetSymbolExcludedFromBOM(aVariantName) !== newValue;
      if (attrChanged) aRef.SetSymbolExcludedFromBOM(newValue, aVariantName);
    } else if (aAttributeName === '${EXCLUDE_FROM_SIM}') {
      attrChanged = aRef.GetSymbolExcludedFromSim(aVariantName) !== newValue;
      if (attrChanged) aRef.SetSymbolExcludedFromSim(newValue, aVariantName);
    } else if (aAttributeName === '${EXCLUDE_FROM_POS_FILES}') {
      attrChanged = aRef.GetSymbolExcludedFromPosFiles(aVariantName) !== newValue;
      if (attrChanged) aRef.SetSymbolExcludedFromPosFiles(newValue, aVariantName);
    }

    return attrChanged;
  }

  EnableRebuilds(): void {
    this.m_rebuildsEnabled = true;
  }

  DisableRebuilds(): void {
    this.m_rebuildsEnabled = false;
  }

  /** `RebuildRows()` (fields_data_model.cpp:1099). */
  RebuildRows(): void {
    if (!this.m_rebuildsEnabled) return;

    const view = this.GetView();

    if (view) {
      // Commit any pending in-place edits before the row gets moved out from under
      // the editor.
      (view as WX_GRID).CommitPendingChanges?.(true);

      this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, 0, this.m_rows.length);
    }

    this.m_rows = [];

    const matcher = new EdaCombinedMatcher(
      this.m_filter.toLowerCase(),
      CombinedMatcherContext.SEARCH,
    );

    for (let i = 0; i < this.m_symbolsList.GetCount(); ++i) {
      const ref = this.m_symbolsList.GetItem(i);

      if (this.m_filter !== '' && matcher.find(ref.GetFullRef().toLowerCase()) < 0) continue;

      const symbol = ref.GetSymbol()!;
      const path = ref.GetSheetPath();
      const variants = this.m_variantNames.length ? this.m_variantNames : [this.m_currentVariant];

      if (this.m_excludeDNP) {
        const isDNP = variants.some((v) => symbol.ResolveDNP(path, v) || path.GetDNP(v));

        if (isDNP) continue;
      }

      if (!this.m_includeExcluded) {
        const isExcluded = variants.some(
          (v) => symbol.ResolveExcludedFromBOM(path, v) || path.GetExcludedFromBOM(v),
        );

        if (isExcluded) continue;
      }

      // Check if the symbol if on the current sheet or, in the sheet path somewhere
      // depending on scope
      if (
        (this.m_scope === FIELDS_EDITOR_GRID_DATA_MODEL.SCOPE.SCOPE_SHEET &&
          !path.equals(this.m_path)) ||
        (this.m_scope === FIELDS_EDITOR_GRID_DATA_MODEL.SCOPE.SCOPE_SHEET_RECURSIVE &&
          !path.IsContainedWithin(this.m_path))
      ) {
        continue;
      }

      let matchFound = false;

      // Performance optimization for ungrouped case to skip the N^2 for loop
      if (!this.m_groupingEnabled && !ref.IsMultiUnit()) {
        this.m_rows.push(new DATA_MODEL_ROW(ref, GROUP_TYPE.GROUP_SINGLETON));
        continue;
      }

      // See if we already have a row which this symbol fits into
      for (const row of this.m_rows) {
        // all group members must have identical refs so just use the first one
        const rowRef = row.m_Refs[0]!;

        if (this.unitMatch(ref, rowRef)) {
          matchFound = true;
          row.m_Refs.push(ref);
          break;
        } else if (this.m_groupingEnabled && this.groupMatch(ref, rowRef)) {
          matchFound = true;
          row.m_Refs.push(ref);
          row.m_Flag = GROUP_TYPE.GROUP_COLLAPSED;
          break;
        }
      }

      if (!matchFound) this.m_rows.push(new DATA_MODEL_ROW(ref, GROUP_TYPE.GROUP_SINGLETON));
    }

    if (view) this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, this.m_rows.length);

    this.Sort();
  }

  ExpandRow(aRow: number): void {
    const children: DATA_MODEL_ROW[] = [];

    for (const ref of this.m_rows[aRow]!.m_Refs) {
      let matchFound = false;

      // See if we already have a child group which this symbol fits into
      for (const child of children) {
        // group members are by definition all matching, so just check
        // against the first member
        if (this.unitMatch(ref, child.m_Refs[0]!)) {
          matchFound = true;
          child.m_Refs.push(ref);
          break;
        }
      }

      if (!matchFound) children.push(new DATA_MODEL_ROW(ref, GROUP_TYPE.CHILD_ITEM));
    }

    if (children.length < 2) return;

    this.sortRows(children);

    this.m_rows[aRow]!.m_Flag = GROUP_TYPE.GROUP_EXPANDED;
    this.m_rows.splice(aRow + 1, 0, ...children);

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_INSERTED, aRow, children.length);
  }

  CollapseRow(aRow: number): void {
    let deleted = 0;

    while (
      aRow + 1 + deleted < this.m_rows.length &&
      this.m_rows[aRow + 1 + deleted]!.m_Flag === GROUP_TYPE.CHILD_ITEM
    ) {
      deleted++;
    }

    this.m_rows[aRow]!.m_Flag = GROUP_TYPE.GROUP_COLLAPSED;
    this.m_rows.splice(aRow + 1, deleted);

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aRow + 1, deleted);
  }

  ExpandCollapseRow(aRow: number): void {
    const group = this.m_rows[aRow]!;

    if (group.m_Flag === GROUP_TYPE.GROUP_COLLAPSED) this.ExpandRow(aRow);
    else if (group.m_Flag === GROUP_TYPE.GROUP_EXPANDED) this.CollapseRow(aRow);
  }

  CollapseForSort(): void {
    for (let i = 0; i < this.m_rows.length; ++i) {
      if (this.m_rows[i]!.m_Flag === GROUP_TYPE.GROUP_EXPANDED) {
        this.CollapseRow(i);
        this.m_rows[i]!.m_Flag = GROUP_TYPE.GROUP_COLLAPSED_DURING_SORT;
      }
    }
  }

  ExpandAfterSort(): void {
    for (let i = 0; i < this.m_rows.length; ++i) {
      if (this.m_rows[i]!.m_Flag === GROUP_TYPE.GROUP_COLLAPSED_DURING_SORT) this.ExpandRow(i);
    }
  }

  /** `ApplyData( aCommit, aTemplateFieldnames, aVariantName )` (fields_data_model.cpp:1326). */
  ApplyData(aCommit: SCH_COMMIT, aTemplateFieldnames: TEMPLATES, aVariantName: string): void {
    let symbolModified = false;
    let symbolCopy: SCH_SYMBOL | null = null;

    for (let i = 0; i < this.m_symbolsList.GetCount(); i++) {
      const ref = this.m_symbolsList.GetItem(i);
      const symbol = ref.GetSymbol()!;
      const nextSymbol =
        i + 1 < this.m_symbolsList.GetCount()
          ? this.m_symbolsList.GetItem(i + 1).GetSymbol()
          : null;

      if (i === 0) symbolCopy = symbol.Clone() as SCH_SYMBOL;

      const fieldStore = this.store(makeDataStoreKey(ref.GetSheetPath(), symbol));

      for (const [srcName, srcValue] of fieldStore) {
        // Attributes bypass the field logic, so handle them first
        if (this.isAttribute(srcName)) {
          symbolModified =
            this.setAttributeValue(ref, srcName, srcValue, aVariantName) || symbolModified;
          continue;
        }

        // Skip generated fields with variables as names (e.g. ${QUANTITY});
        // they can't be edited
        if (IsGeneratedField(srcName)) continue;

        let destField = symbol.GetField(srcName);

        if (destField?.IsPrivate()) {
          if (srcValue === '') continue;
          else destField.SetPrivate(false);
        }

        const col = this.GetFieldNameCol(srcName);
        const userAdded = col !== -1 && this.m_cols[col]!.m_userAdded;

        // Add a not existing field if it has a value for this symbol
        const createField = !destField && (srcValue !== '' || userAdded);

        if (createField) {
          destField = symbol.AddField(new SCH_FIELD(symbol, FIELD_T.USER, srcName));
          destField.SetTextAngle(symbol.GetField(FIELD_T.REFERENCE)!.GetTextAngle());

          const srcTemplate = aTemplateFieldnames.GetFieldName(srcName);

          if (srcTemplate) destField.SetVisible(srcTemplate.m_Visible);
          else destField.SetVisible(false);

          destField.SetTextPos(symbol.GetPosition());
          symbolModified = true;
        }

        if (!destField) continue;

        // Reference is not editable from this dialog
        if (destField.GetId() === FIELD_T.REFERENCE) continue;

        const previousValue = destField.GetText(ref.GetSheetPath(), aVariantName);

        destField.SetText(
          symbol.Schematic()!.ConvertRefsToKIIDs(srcValue),
          ref.GetSheetPath(),
          aVariantName,
        );

        if (!createField && previousValue !== srcValue) symbolModified = true;
      }

      const fields = symbol.GetFields();

      for (let ii = fields.length - 1; ii >= 0; ii--) {
        const field = fields[ii]!;

        if (field.IsMandatory() || field.IsPrivate()) continue;

        if (!fieldStore.has(field.GetName())) {
          symbol.RemoveField(field);
          symbolModified = true;
        }
      }

      if (symbolModified && symbol !== nextSymbol)
        aCommit.Modified(symbol, symbolCopy!, ref.GetSheetPath().LastScreen());

      // Only reset the modified flag and next symbol copy if the next symbol is different from
      // the current one.
      if (symbol !== nextSymbol) {
        symbolCopy = nextSymbol ? (nextSymbol.Clone() as SCH_SYMBOL) : null;
        symbolModified = false;
      }
    }

    this.m_edited = false;
  }

  IsEdited(): boolean {
    return this.m_edited;
  }

  GetDataWidth(aCol: number): number {
    let width = 0;

    if (this.ColIsReference(aCol)) {
      for (let row = 0; row < this.GetNumberRows(); ++row)
        width = Math.max(width, GetTextExtent(this.GetValue(row, aCol)));
    } else {
      const fieldName = this.GetColFieldName(aCol); // symbol fieldName or Qty string

      for (let i = 0; i < this.m_symbolsList.GetCount(); ++i) {
        const ref = this.m_symbolsList.GetItem(i);
        const text =
          this.store(makeDataStoreKey(ref.GetSheetPath(), ref.GetSymbol()!)).get(fieldName) ?? '';

        width = Math.max(width, GetTextExtent(text));
      }
    }

    return width;
  }

  SetFilter(aFilter: string): void {
    this.m_filter = aFilter;
  }
  GetFilter(): string {
    return this.m_filter;
  }

  SetScope(aScope: number): void {
    this.m_scope = aScope;
  }
  GetScope(): number {
    return this.m_scope;
  }

  SetPath(aPath: SCH_SHEET_PATH): void {
    this.m_path = aPath;
  }
  GetPath(): SCH_SHEET_PATH {
    return this.m_path;
  }

  SetGroupingEnabled(group: boolean): void {
    this.m_groupingEnabled = group;
  }
  GetGroupingEnabled(): boolean {
    return this.m_groupingEnabled;
  }

  SetIncludeExcludedFromBOM(include: boolean): void {
    this.m_includeExcluded = include;
  }
  GetIncludeExcludedFromBOM(): boolean {
    return this.m_includeExcluded;
  }

  SetExcludeDNP(exclude: boolean): void {
    this.m_excludeDNP = exclude;
  }
  GetExcludeDNP(): boolean {
    return this.m_excludeDNP;
  }

  SetGroupColumn(aCol: number, group: boolean): void {
    if (aCol < 0 || aCol >= this.m_cols.length) return;
    this.m_cols[aCol]!.m_group = group;
  }
  GetGroupColumn(aCol: number): boolean {
    if (aCol < 0 || aCol >= this.m_cols.length) return false;
    return this.m_cols[aCol]!.m_group;
  }

  SetShowColumn(aCol: number, show: boolean): void {
    if (aCol < 0 || aCol >= this.m_cols.length) return;
    this.m_cols[aCol]!.m_show = show;
  }
  GetShowColumn(aCol: number): boolean {
    if (aCol < 0 || aCol >= this.m_cols.length) return false;
    return this.m_cols[aCol]!.m_show;
  }

  /** `ApplyBomPreset( aPreset )` (fields_data_model.cpp:1472). */
  ApplyBomPreset(aPreset: BOM_PRESET): void {
    // Hide and un-group everything by default
    for (let i = 0; i < this.m_cols.length; i++) {
      this.SetShowColumn(i, false);
      this.SetGroupColumn(i, false);
    }

    const seen = new Set<string>();
    const order: string[] = [];

    // Set columns that are present and shown
    for (const field of aPreset.fieldsOrdered) {
      // Ignore empty fields
      if (!field.name || seen.has(field.name)) continue;

      seen.add(field.name);
      order.push(field.name);

      let col = this.GetFieldNameCol(field.name);

      // Add any missing fields, if the user doesn't add any data
      // they won't be saved to the symbols anyway
      if (col === -1) {
        this.AddColumn(field.name, field.label, true);
        col = this.GetFieldNameCol(field.name);
      } else {
        this.SetColLabelValue(col, field.label);
      }

      this.SetGroupColumn(col, field.groupBy);
      this.SetShowColumn(col, field.show);
    }

    // Set grouping columns
    this.SetGroupingEnabled(aPreset.groupSymbols);

    this.SetFieldsOrder(order);

    // Set our sorting
    let sortCol = this.GetFieldNameCol(aPreset.sortField);

    if (sortCol === -1) sortCol = this.GetFieldNameCol(GetCanonicalFieldName(FIELD_T.REFERENCE));

    this.SetSorting(sortCol, aPreset.sortAsc);

    this.SetFilter(aPreset.filterString);
    this.SetExcludeDNP(aPreset.excludeDNP);
    this.SetIncludeExcludedFromBOM(aPreset.includeExcludedFromBOM);

    this.RebuildRows();
  }

  GetBomSettings(): BOM_PRESET {
    return {
      name: '',
      readOnly: false,
      fieldsOrdered: this.GetFieldsOrdered(),
      sortField:
        this.GetSortCol() >= 0 && this.GetSortCol() < this.GetNumberCols()
          ? this.GetColFieldName(this.GetSortCol())
          : '',
      sortAsc: this.GetSortAsc(),
      filterString: this.GetFilter(),
      groupSymbols: this.GetGroupingEnabled(),
      excludeDNP: this.GetExcludeDNP(),
      includeExcludedFromBOM: this.GetIncludeExcludedFromBOM(),
    };
  }

  /** `Export( settings )` (fields_data_model.cpp:1552). */
  Export(settings: BOM_FMT_PRESET): string {
    let out = '';

    if (this.m_cols.length === 0) return out;

    let last_col = -1;

    // Find the location for the line terminator
    for (let col = 0; col < this.m_cols.length; col++) {
      if (this.m_cols[col]!.m_show) last_col = col;
    }

    // No shown columns
    if (last_col === -1) return out;

    const formatField = (aField: string, last: boolean): string => {
      let field = aField;

      if (!settings.keepLineBreaks) field = field.replaceAll('\r', '').replaceAll('\n', '');

      if (!settings.keepTabs) field = field.replaceAll('\t', '');

      if (settings.stringDelimiter !== '')
        field = field.replaceAll(
          settings.stringDelimiter,
          settings.stringDelimiter + settings.stringDelimiter,
        );

      return (
        settings.stringDelimiter +
        field +
        settings.stringDelimiter +
        (last ? '\n' : settings.fieldDelimiter)
      );
    };

    // Column names
    for (let col = 0; col < this.m_cols.length; col++) {
      if (!this.m_cols[col]!.m_show) continue;

      out += formatField(this.m_cols[col]!.m_label, col === last_col);
    }

    // Data rows
    for (let row = 0; row < this.m_rows.length; row++) {
      // Don't output child rows
      if (this.GetRowFlags(row) === GROUP_TYPE.CHILD_ITEM) continue;

      for (let col = 0; col < this.m_cols.length; col++) {
        if (!this.m_cols[col]!.m_show) continue;

        // Get the unannotated version of the field, e.g. no ">   " or "v   " by
        out += formatField(
          this.GetExportValue(row, col, settings.refDelimiter, settings.refRangeDelimiter),
          col === last_col,
        );
      }
    }

    return out;
  }

  AddReferences(aRefs: SCH_REFERENCE_LIST): void {
    let refListChanged = false;

    for (const ref of aRefs) {
      if (!this.m_symbolsList.Contains(ref)) {
        const symbol = ref.GetSymbol()!;

        this.m_symbolsList.AddItem(ref);

        const fields = this.store(makeDataStoreKey(ref.GetSheetPath(), symbol));

        // Update the fields of every reference
        for (const field of symbol.GetFields()) {
          if (!field.IsPrivate())
            fields.set(
              field.GetCanonicalName(),
              symbol.Schematic()!.ConvertKIIDsToRefs(field.GetText()),
            );
        }

        for (const col of this.m_cols)
          if (!fields.has(col.m_fieldName)) fields.set(col.m_fieldName, '');

        refListChanged = true;
      }
    }

    if (refListChanged) this.m_symbolsList.SortBySymbolPtr();
  }

  RemoveSymbol(aSymbol: SCH_SYMBOL): void {
    // The schematic event listener passes us the symbol after it has been removed, so we can't
    // just work with a SCH_REFERENCE_LIST like the other handlers as the references are already
    // gone. Instead we need to prune our list.
    const uuid = aSymbol.m_Uuid;

    for (const key of [...this.m_dataStore.keys()]) {
      if (key.endsWith(uuid)) this.m_dataStore.delete(key);
    }

    for (let i = this.m_symbolsList.GetCount() - 1; i >= 0; i--) {
      if (this.m_symbolsList.GetItem(i).GetSymbol()!.m_Uuid === uuid)
        this.m_symbolsList.RemoveItem(i);
    }
  }

  RemoveReferences(aRefs: SCH_REFERENCE_LIST): void {
    for (const ref of aRefs) {
      const index = this.m_symbolsList.FindRefByFullPath(ref.GetFullPath());

      if (index !== -1) {
        this.m_dataStore.delete(makeDataStoreKey(ref.GetSheetPath(), ref.GetSymbol()!));
        this.m_symbolsList.RemoveItem(index);
      }
    }
  }

  UpdateReferences(aRefs: SCH_REFERENCE_LIST): void {
    let refListChanged = false;

    for (const ref of aRefs) {
      // Update the fields of every reference. Do this by iterating through the data model
      // columns; we must have all fields in the symbol added to the data model at this point,
      // and some of the data model columns may be variables that are not present in the symbol
      for (const col of this.m_cols) this.updateDataStoreSymbolField(ref, col.m_fieldName);

      const listRef = this.m_symbolsList.FindItem(ref);

      if (listRef) {
        Object.assign(listRef, ref);
      } else {
        this.m_symbolsList.AddItem(ref);
        refListChanged = true;
      }
    }

    if (refListChanged) this.m_symbolsList.SortBySymbolPtr();
  }

  override HasUndoStateSerialization(): boolean {
    return true;
  }

  override SerializeUndoState(): string {
    // Serialize the un-applied edit store keyed by symbol identity (sheet path + UUID), so that
    // restoring it is independent of the current row grouping/order.
    const j: Record<string, Record<string, string>> = {};

    for (const [key, fields] of this.m_dataStore) j[key] = Object.fromEntries(fields);

    return JSON.stringify(j);
  }

  override RestoreUndoState(aState: string): void {
    let j: unknown;

    try {
      j = JSON.parse(aState);
    } catch {
      return;
    }

    if (!j || typeof j !== 'object' || Array.isArray(j)) return;

    for (const [key, value] of Object.entries(j as Record<string, Record<string, string>>)) {
      const fields = this.store(key);

      for (const [name, v] of Object.entries(value)) fields.set(name, v);
    }

    this.m_edited = true;
    this.RebuildRows();

    this.GetView()?.ForceRefresh();
  }

  override DeleteRows(aPosition = 0, aNumRows = 1): boolean {
    const curNumRows = this.m_rows.length;

    if (aPosition >= curNumRows) return false;

    if (aNumRows > curNumRows - aPosition) aNumRows = curNumRows - aPosition;

    if (aNumRows >= curNumRows) {
      this.m_rows = [];
      this.m_dataStore.clear();
    } else {
      const dataMapRefs = this.m_rows[aPosition]!.m_Refs;
      this.m_rows.splice(aPosition, aNumRows);

      for (const ref of dataMapRefs) this.m_dataStore.delete(ref.GetSheetPath().Path().AsString());
    }

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aPosition, aNumRows);

    return true;
  }

  GetReferenceList(): SCH_REFERENCE_LIST {
    return this.m_symbolsList;
  }

  SetCurrentVariant(aVariantName: string): void {
    this.m_currentVariant = aVariantName;
  }
  GetCurrentVariant(): string {
    return this.m_currentVariant;
  }

  SetVariantNames(aVariantNames: readonly string[]): void {
    this.m_variantNames = [...aVariantNames];
  }
  GetVariantNames(): readonly string[] {
    return this.m_variantNames;
  }
}
