// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol Fields Table data model. Counterpart: `eeschema/fields_data_model.cpp`
 * (FIELDS_EDITOR_GRID_DATA_MODEL), the engine behind KiCad's
 * DIALOG_SYMBOL_FIELDS_TABLE, its Edit view *and* its Export (BOM) view are
 * both this one model:
 *
 *   - columns are field names (plus the generated `${QUANTITY}` /
 *     `${ITEM_NUMBER}` and the `${DNP}` / `${EXCLUDE_FROM_…}` attributes), each
 *     carrying a BOM label, a "show" flag and a "group by" flag,
 *   - rows are groups of symbol references: units of one symbol always collapse
 *     together, and with grouping enabled every symbol whose group-by fields
 *     match joins the same row (expandable to its members),
 *   - cell values live in a data store keyed by symbol, so edits are held until
 *     they are applied to the schematic in one commit,
 *   - a cell whose group members disagree reads as {@link INDETERMINATE_STATE}.
 *
 * Values are edited as raw text; the exporter resolves `${…}` references
 * against the symbol the way SCH_FIELD::GetShownText does.
 */

import { strNumCmp, valueStringCompare } from '@ziroeda/common/src/string_utils.js';
import type { Schematic, SchSymbol } from '../types.js';
import { buildSheetTree } from '../project.js';
import { refId } from './hittest.js';
import { isMandatoryField, type SymbolAttrEdit } from './properties.js';
import { expandTextVars, type TextVarResolver } from '@ziroeda/common/src/text_vars.js';
import { refsShorthand, type BomOutputFormat } from '../exporters/bom.js';

/** FIELDS_EDITOR_GRID_DATA_MODEL::QUANTITY_VARIABLE. */
export const QUANTITY_VARIABLE = '${QUANTITY}';
/** FIELDS_EDITOR_GRID_DATA_MODEL::ITEM_NUMBER_VARIABLE. */
export const ITEM_NUMBER_VARIABLE = '${ITEM_NUMBER}';
/** INDETERMINATE_STATE (widgets/ui_common.h), a group's cells disagree. */
export const INDETERMINATE_STATE = '-- mixed values --';

/** IsGeneratedField (common/common.cpp): a name that is exactly one token. */
export const isGeneratedField = (name: string): boolean => /^\$\{\w*\}$/.test(name);

/** GetGeneratedFieldDisplayName, the token names with the `${}` stripped. */
export const generatedFieldDisplayName = (name: string): string =>
  expandTextVars(name, (token) => token);

/** FIELDS_EDITOR_GRID_DATA_MODEL::isAttribute, columns that write symbol flags. */
export const ATTRIBUTE_FIELDS = [
  '${DNP}',
  '${EXCLUDE_FROM_BOARD}',
  '${EXCLUDE_FROM_BOM}',
  '${EXCLUDE_FROM_POS_FILES}',
  '${EXCLUDE_FROM_SIM}',
] as const;

export const isAttributeField = (name: string): boolean =>
  (ATTRIBUTE_FIELDS as readonly string[]).includes(name);

/** GROUP_TYPE (widgets/wx_grid.h): what a row is in the grouped table. */
export type GroupType = 'singleton' | 'collapsed' | 'expanded' | 'child' | 'collapsed-during-sort';

/** One symbol instance in the table, our stand-in for SCH_REFERENCE. */
export interface FieldsRef {
  /** Sheet document basename the symbol lives in. */
  file: string;
  /** Symbol id within that document (refId of uuid/index). */
  id: string;
  /** Instance path of the sheet (SCH_SHEET_PATH), for scope filtering. */
  sheetPath: string;
  index: number;
  symbol: SchSymbol;
  /** Reference prefix, e.g. "R" of "R12" (SCH_REFERENCE::GetRef). */
  ref: string;
  /** Reference number as text, "?" when unannotated (GetRefNumber). */
  refNumber: string;
  unit: number;
}

/** DATA_MODEL_COL. */
export interface DataModelCol {
  fieldName: string;
  label: string;
  userAdded: boolean;
  show: boolean;
  group: boolean;
}

/** DATA_MODEL_ROW. */
export interface DataModelRow {
  itemNumber: number;
  flag: GroupType;
  refs: FieldsRef[];
}

/** FIELDS_EDITOR_GRID_DATA_MODEL::SCOPE. */
export type FieldsScope = 'all' | 'sheet' | 'sheet-recursive';

/** BOM_FIELD, one column of a BOM preset. */
export interface BomFieldSpec {
  name: string;
  label: string;
  show: boolean;
  groupBy: boolean;
}

/** BOM_PRESET, a named view of the table (columns, grouping, sort, filters). */
export interface BomPresetSpec {
  name: string;
  readOnly?: boolean;
  fieldsOrdered: BomFieldSpec[];
  sortField: string;
  sortAsc: boolean;
  filterString: string;
  groupSymbols: boolean;
  excludeDnp: boolean;
  includeExcludedFromBom: boolean;
}

/** The per-sheet edits {@link FieldsDataModel.applyData} produces. */
export interface FieldsTableEdits {
  /** file → symbol refId → { field: newValue } (an empty value drops the field). */
  fields: Map<string, Map<string, Record<string, string>>>;
  /** file → symbol refId → changed attribute flags. */
  attrs: Map<string, Map<string, SymbolAttrEdit>>;
}

const fieldValue = (sym: SchSymbol, key: string): string | undefined =>
  sym.fields.find((f) => f.key === key)?.value;

/** SCH_REFERENCE::Split, "R12" → { ref: "R", refNumber: "12" }, "R?" → "?". */
function splitRef(reference: string): { ref: string; refNumber: string } {
  const m = /^(.*?)(\d+)$/.exec(reference);
  if (m) return { ref: m[1]!, refNumber: m[2]! };
  return { ref: reference.replace(/\?+$/, ''), refNumber: '?' };
}

/** SubReference, unit 1 → "A", 2 → "B" … (SCH_SYMBOL::SubReference). */
const subReference = (unit: number): string =>
  unit >= 1 ? String.fromCharCode('A'.charCodeAt(0) + ((unit - 1) % 26)) : '';

/**
 * Collect every non-power symbol of the hierarchy, once per sheet instance,
 * SCHEMATIC::Hierarchy().GetSymbols( …, SYMBOL_FILTER_NON_POWER ). Without a
 * root file the documents are walked in map order at the root path.
 */
export function buildFieldsReferences(
  docs: ReadonlyMap<string, Schematic>,
  rootFile?: string,
): FieldsRef[] {
  const out: FieldsRef[] = [];
  const collect = (file: string, sheetPath: string): void => {
    const doc = docs.get(file);
    if (!doc) return;
    doc.symbols.forEach((symbol, index) => {
      const reference = fieldValue(symbol, 'Reference') ?? '';
      // Power symbols carry a "#PWR…" reference and never list.
      if (!reference || reference.startsWith('#')) return;
      out.push({
        file,
        id: refId('symbol', symbol.uuid, index),
        sheetPath,
        index,
        symbol,
        ...splitRef(reference),
        unit: symbol.unit,
      });
    });
  };

  if (rootFile && docs.has(rootFile)) {
    const walk = (node: ReturnType<typeof buildSheetTree>): void => {
      collect(node.file, node.path);
      for (const child of node.children) walk(child);
    };
    walk(buildSheetTree(docs, rootFile));
  } else {
    for (const file of docs.keys()) collect(file, '/');
  }
  return out;
}

// ---------------------------------------------------------------------------

const storeKey = (ref: FieldsRef): string => `${ref.file}\0${ref.id}`;

/** The attribute flag a `${…}` attribute column reads/writes on a symbol. */
function attributeValue(sym: SchSymbol, name: string): string {
  switch (name) {
    case '${DNP}':
      return sym.dnp ? '1' : '0';
    case '${EXCLUDE_FROM_BOARD}':
      return sym.onBoard ? '0' : '1';
    case '${EXCLUDE_FROM_BOM}':
      return sym.inBom ? '0' : '1';
    case '${EXCLUDE_FROM_SIM}':
      return sym.excludedFromSim ? '1' : '0';
    case '${EXCLUDE_FROM_POS_FILES}':
      return sym.excludedFromPosFiles ? '1' : '0';
    default:
      return '0';
  }
}

/** The SymbolAttrEdit key a `${…}` attribute column writes. */
const ATTR_EDIT_KEY: Readonly<Record<string, keyof SymbolAttrEdit>> = {
  '${DNP}': 'dnp',
  '${EXCLUDE_FROM_BOARD}': 'excludedFromBoard',
  '${EXCLUDE_FROM_BOM}': 'excludedFromBom',
  '${EXCLUDE_FROM_SIM}': 'excludedFromSim',
  '${EXCLUDE_FROM_POS_FILES}': 'excludedFromPosFiles',
};

/**
 * SCH_SYMBOL::ResolveTextVar for the tokens we model, falling back to the
 * document/project resolver (title block, text variables, sheet tokens).
 */
export function symbolTextVarResolver(
  ref: FieldsRef,
  docResolver?: TextVarResolver,
  /**
   * The RESOLVED template field names (`TEMPLATES::GetTemplateFieldNames()`),
   * for the branch below. Absent = none, which is what a caller with no
   * schematic settings to hand has.
   */
  templateFieldNames: readonly { name: string }[] = [],
): TextVarResolver {
  const sym = ref.symbol;
  return (token) => {
    for (const f of sym.fields) {
      if (f.key.toLowerCase() === token.toLowerCase()) {
        if (f.key === 'Reference') return ref.ref + ref.refNumber;
        // A field whose value is just its own reference doesn't recurse.
        if (f.value.replace(/\s/g, '') === `\${${f.key}}`) return '';
        return f.value;
      }
    }
    switch (token) {
      case 'DNP':
        return sym.dnp ? 'DNP' : '';
      case 'EXCLUDE_FROM_BOM':
        return sym.inBom ? '' : 'Excluded from BOM';
      case 'EXCLUDE_FROM_BOARD':
        return sym.onBoard ? '' : 'Excluded from board';
      case 'EXCLUDE_FROM_SIM':
        return sym.excludedFromSim ? 'Excluded from simulation' : '';
      case 'FOOTPRINT_LIBRARY':
        return (fieldValue(sym, 'Footprint') ?? '').split(':')[0] ?? '';
      case 'FOOTPRINT_NAME': {
        const parts = (fieldValue(sym, 'Footprint') ?? '').split(':');
        return parts.length > 1 ? (parts[1] ?? '') : '';
      }
      case 'UNIT':
        return subReference(ref.unit);
      case 'SHORT_REFERENCE':
        return ref.ref + ref.refNumber;
      case 'SYMBOL_LIBRARY':
        return sym.libId.split(':')[0] ?? '';
      case 'SYMBOL_NAME': {
        const parts = sym.libId.split(':');
        return parts.length > 1 ? (parts[1] ?? '') : sym.libId;
      }
      default:
        /*
         * A token naming a TEMPLATE field the symbol does not carry resolves to
         * empty, rather than being left for the document resolver and printed
         * as `${MPN}`:
         *
         *     for( const TEMPLATE_FIELDNAME& templateFieldname : …GetTemplateFieldNames() )
         *         if( token->IsSameAs( templateFieldname.m_Name )
         *             || token->IsSameAs( templateFieldname.m_Name.Upper() ) )
         *         {
         *             // If we didn't find it in the fields list then it isn't set
         *             // on this symbol. Just return an empty string.
         *             *token = wxEmptyString;
         *             return true;
         *         }
         *     (`eeschema/sch_symbol.cpp:1967-1978`)
         *
         * The loop above has already answered for a field the symbol DOES
         * carry, so reaching here means it does not. Upstream matches the name
         * as written or fully upper-cased, and nothing in between.
         */
        for (const t of templateFieldNames)
          if (token === t.name || token === t.name.toUpperCase()) return '';
        return docResolver?.(token);
    }
  };
}

/**
 * DIALOG_SYMBOL_FIELDS_TABLE::LoadFieldNames, seed the model's columns from a
 * union of every field name in use: the mandatory fields first, then the
 * generated `${QUANTITY}` / `${ITEM_NUMBER}`, then user fields, then any
 * template fieldname not already present. Returns the names in that order,
 * which is the order the dialog's field list keeps (columns themselves are
 * re-ordered by presets and by dragging).
 */
export function loadFieldNames(
  model: FieldsDataModel,
  refs: readonly FieldsRef[],
  templateFieldNames: readonly { name: string }[] = [],
): string[] {
  const order: string[] = [];
  const add = (name: string, label: string): void => {
    if (model.getFieldNameCol(name) !== -1) return;
    model.addColumn(name, label, false);
    order.push(name);
  };

  for (const name of ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description'])
    add(name, name);
  add(QUANTITY_VARIABLE, 'Qty');
  add(ITEM_NUMBER_VARIABLE, '#');

  // User field names are matched case-sensitively (KiCad issue #24021), so each
  // distinct spelling gets its own column.
  const userFieldNames = new Set<string>();
  for (const ref of refs) {
    for (const f of ref.symbol.fields) {
      if (!isMandatoryField(f.key)) userFieldNames.add(f.key);
    }
  }
  for (const name of [...userFieldNames].sort()) add(name, generatedFieldDisplayName(name));
  for (const tfn of templateFieldNames) {
    if (tfn.name && !userFieldNames.has(tfn.name))
      add(tfn.name, generatedFieldDisplayName(tfn.name));
  }
  return order;
}

/**
 * The table's columns × grouped rows, with a data store of pending cell edits.
 * A live object rather than immutable state: the dialog mutates it and redraws,
 * exactly as the wxGrid table does upstream.
 */
export class FieldsDataModel {
  private readonly refs: readonly FieldsRef[];

  private readonly templateFieldNames: readonly { name: string }[];
  private cols: DataModelCol[] = [];
  private rows: DataModelRow[] = [];
  /** symbol key → field name → pending value. */
  private readonly store = new Map<string, Map<string, string>>();
  private readonly docResolver?: (ref: FieldsRef) => TextVarResolver | undefined;

  private filter = '';
  private scope: FieldsScope = 'all';
  private path = '/';
  private groupingEnabled = false;
  private excludeDNP = false;
  private includeExcluded = false;
  private rebuildsEnabled = true;
  private sortColumn = 0;
  private sortAscending = false;
  private edited = false;

  constructor(
    refs: readonly FieldsRef[],
    docResolver?: (ref: FieldsRef) => TextVarResolver | undefined,
    /** The resolved template field names — see {@link symbolTextVarResolver}. */
    templateFieldNames: readonly { name: string }[] = [],
  ) {
    this.refs = refs;
    this.docResolver = docResolver;
    this.templateFieldNames = templateFieldNames;
  }

  // --- columns -------------------------------------------------------------

  getColumns(): readonly DataModelCol[] {
    return this.cols;
  }

  getRows(): readonly DataModelRow[] {
    return this.rows;
  }

  getColsCount(): number {
    return this.cols.length;
  }

  getNumberRows(): number {
    return this.rows.length;
  }

  getColFieldName(col: number): string {
    return this.cols[col]?.fieldName ?? '';
  }

  getColLabelValue(col: number): string {
    return this.cols[col]?.label ?? '';
  }

  setColLabelValue(col: number, label: string): void {
    const c = this.cols[col];
    if (c) c.label = label;
  }

  /** GetFieldNameCol, KiCad matches names case-insensitively here. */
  getFieldNameCol(fieldName: string): number {
    return this.cols.findIndex((c) => c.fieldName.toLowerCase() === fieldName.toLowerCase());
  }

  addColumn(fieldName: string, label: string, userAdded: boolean): void {
    if (this.getFieldNameCol(fieldName) !== -1) return;
    this.cols.push({ fieldName, label, userAdded, show: false, group: false });
    for (const ref of this.refs) this.updateDataStoreSymbolField(ref, fieldName);
  }

  removeColumn(col: number): void {
    const name = this.cols[col]?.fieldName;
    if (name === undefined) return;
    for (const ref of this.refs) this.store.get(storeKey(ref))?.delete(name);
    this.cols.splice(col, 1);
  }

  renameColumn(col: number, newName: string): void {
    const c = this.cols[col];
    if (!c) return;
    for (const ref of this.refs) {
      const fields = this.store.get(storeKey(ref));
      if (!fields || !fields.has(c.fieldName)) continue;
      fields.set(newName, fields.get(c.fieldName)!);
      fields.delete(c.fieldName);
    }
    c.fieldName = newName;
    c.label = newName;
  }

  moveColumn(col: number, newPos: number): void {
    if (col === newPos || col < 0 || col >= this.cols.length) return;
    const [moved] = this.cols.splice(col, 1);
    this.cols.splice(newPos, 0, moved!);
  }

  setFieldsOrder(order: readonly string[]): void {
    let foundCount = 0;
    for (const name of order) {
      if (foundCount >= this.cols.length) break;
      const idx = this.cols.findIndex((c) => c.fieldName === name);
      if (idx === -1) continue;
      const tmp = this.cols[foundCount]!;
      this.cols[foundCount] = this.cols[idx]!;
      this.cols[idx] = tmp;
      foundCount++;
    }
  }

  getFieldsOrdered(): BomFieldSpec[] {
    return this.cols.map((c) => ({
      name: c.fieldName,
      label: c.label,
      show: c.show,
      groupBy: c.group,
    }));
  }

  colIsReference(col: number): boolean {
    return this.getColFieldName(col) === 'Reference';
  }

  colIsValue(col: number): boolean {
    return this.getColFieldName(col) === 'Value';
  }

  colIsQuantity(col: number): boolean {
    return this.getColFieldName(col) === QUANTITY_VARIABLE;
  }

  colIsItemNumber(col: number): boolean {
    return this.getColFieldName(col) === ITEM_NUMBER_VARIABLE;
  }

  colIsAttribute(col: number): boolean {
    return isAttributeField(this.getColFieldName(col));
  }

  /** IsExpanderColumn, the first *shown* column carries the group triangle. */
  isExpanderColumn(col: number): boolean {
    for (let i = 0; i < col; i++) {
      if (this.cols[i]?.show) return false;
    }
    return true;
  }

  getShowColumn(col: number): boolean {
    return this.cols[col]?.show ?? false;
  }

  setShowColumn(col: number, show: boolean): void {
    const c = this.cols[col];
    if (c) c.show = show;
  }

  getGroupColumn(col: number): boolean {
    return this.cols[col]?.group ?? false;
  }

  setGroupColumn(col: number, group: boolean): void {
    const c = this.cols[col];
    if (c) c.group = group;
  }

  // --- view options --------------------------------------------------------

  setFilter(filter: string): void {
    this.filter = filter;
  }

  getFilter(): string {
    return this.filter;
  }

  setScope(scope: FieldsScope): void {
    this.scope = scope;
  }

  getScope(): FieldsScope {
    return this.scope;
  }

  setPath(path: string): void {
    this.path = path;
  }

  setGroupingEnabled(group: boolean): void {
    this.groupingEnabled = group;
  }

  getGroupingEnabled(): boolean {
    return this.groupingEnabled;
  }

  setExcludeDNP(exclude: boolean): void {
    this.excludeDNP = exclude;
  }

  getExcludeDNP(): boolean {
    return this.excludeDNP;
  }

  setIncludeExcludedFromBOM(include: boolean): void {
    this.includeExcluded = include;
  }

  getIncludeExcludedFromBOM(): boolean {
    return this.includeExcluded;
  }

  setSorting(col: number, ascending: boolean): void {
    if (col < 0 || col >= this.cols.length) return;
    this.sortColumn = col;
    this.sortAscending = ascending;
  }

  getSortCol(): number {
    return this.sortColumn;
  }

  getSortAsc(): boolean {
    return this.sortAscending;
  }

  isEdited(): boolean {
    return this.edited;
  }

  enableRebuilds(): void {
    this.rebuildsEnabled = true;
  }

  disableRebuilds(): void {
    this.rebuildsEnabled = false;
  }

  // --- data store ----------------------------------------------------------

  private updateDataStoreSymbolField(ref: FieldsRef, fieldName: string): void {
    const key = storeKey(ref);
    let fields = this.store.get(key);
    if (!fields) {
      fields = new Map();
      this.store.set(key, fields);
    }
    if (isAttributeField(fieldName)) {
      fields.set(fieldName, attributeValue(ref.symbol, fieldName));
      return;
    }
    const value = fieldValue(ref.symbol, fieldName);
    if (value !== undefined) fields.set(fieldName, value);
    // Generated fields absent from the symbol keep their token, which the
    // exporter resolves (e.g. ${QUANTITY}).
    else if (isGeneratedField(fieldName)) fields.set(fieldName, fieldName);
    else fields.set(fieldName, '');
  }

  private storedValue(ref: FieldsRef, fieldName: string): string | undefined {
    return this.store.get(storeKey(ref))?.get(fieldName);
  }

  private resolverFor(ref: FieldsRef): TextVarResolver {
    return symbolTextVarResolver(ref, this.docResolver?.(ref), this.templateFieldNames);
  }

  /** getFieldShownText, the field's resolved text straight off the symbol. */
  private getFieldShownText(ref: FieldsRef, fieldName: string): string {
    const value = fieldValue(ref.symbol, fieldName);
    if (value !== undefined) return expandTextVars(value, this.resolverFor(ref));
    if (isGeneratedField(fieldName)) return expandTextVars(fieldName, this.resolverFor(ref));
    return '';
  }

  // --- rows ----------------------------------------------------------------

  /** SCH_SYMBOL::ResolveExcludedFromBOM et al. for a reference. */
  private refIsDNP(ref: FieldsRef): boolean {
    return ref.symbol.dnp;
  }

  private refIsExcludedFromBOM(ref: FieldsRef): boolean {
    return !ref.symbol.inBom;
  }

  private inScope(ref: FieldsRef): boolean {
    if (this.scope === 'sheet') return ref.sheetPath === this.path;
    if (this.scope === 'sheet-recursive') return ref.sheetPath.startsWith(this.path);
    return true;
  }

  /** unitMatch, units of one annotated symbol always share a row. */
  private unitMatch(lh: FieldsRef, rh: FieldsRef): boolean {
    if (lh.refNumber === '?') return false;
    return lh.ref === rh.ref && lh.refNumber === rh.refNumber;
  }

  /** groupMatch, every group-by column must agree (and at least one exists). */
  private groupMatch(lh: FieldsRef, rh: FieldsRef): boolean {
    const refCol = this.getFieldNameCol('Reference');
    if (refCol === -1) return false;
    let matchFound = false;
    if (this.cols[refCol]!.group) {
      // Grouping by reference means only the prefix must match.
      if (lh.ref !== rh.ref) return false;
      matchFound = true;
    }
    for (let i = 0; i < this.cols.length; i++) {
      if (i === refCol) continue;
      const col = this.cols[i]!;
      if (!col.group) continue;
      const lhStored = this.storedValue(lh, col.fieldName) ?? '';
      const rhStored = this.storedValue(rh, col.fieldName) ?? '';
      const lhs =
        isGeneratedField(col.fieldName) || isGeneratedField(lhStored)
          ? this.getFieldShownText(lh, col.fieldName)
          : lhStored;
      const rhs =
        isGeneratedField(col.fieldName) || isGeneratedField(rhStored)
          ? this.getFieldShownText(rh, col.fieldName)
          : rhStored;
      if (lhs !== rhs) return false;
      matchFound = true;
    }
    return matchFound;
  }

  rebuildRows(): void {
    if (!this.rebuildsEnabled) return;
    this.rows = [];
    const needle = this.filter.trim().toLowerCase();

    for (const ref of this.refs) {
      const fullRef = ref.ref + ref.refNumber;
      if (needle && !fullRef.toLowerCase().includes(needle)) continue;
      if (this.excludeDNP && this.refIsDNP(ref)) continue;
      if (!this.includeExcluded && this.refIsExcludedFromBOM(ref)) continue;
      if (!this.inScope(ref)) continue;

      let matchFound = false;
      for (const row of this.rows) {
        const rowRef = row.refs[0]!;
        if (this.unitMatch(ref, rowRef)) {
          matchFound = true;
          row.refs.push(ref);
          break;
        }
        if (this.groupingEnabled && this.groupMatch(ref, rowRef)) {
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

  /** cmp, sort column first, reference second (empty rows sink). */
  private cmp(lh: DataModelRow, rh: DataModelRow): boolean {
    if (lh.refs.length === 0) return true;
    if (rh.refs.length === 0) return false;
    const localCmp = (v: number): boolean => (this.sortAscending ? v < 0 : v > 0);
    let sortCol = this.sortColumn;
    if (sortCol < 0 || sortCol >= this.cols.length) sortCol = 0;
    const lhs = this.getGroupValue(lh, sortCol, ', ', '-', true).trim();
    const rhs = this.getGroupValue(rh, sortCol, ', ', '-', true).trim();
    if (lhs === rhs || this.colIsReference(sortCol)) {
      const lhRef = lh.refs[0]!.ref + lh.refs[0]!.refNumber;
      const rhRef = rh.refs[0]!.ref + rh.refs[0]!.refNumber;
      return localCmp(strNumCmp(lhRef, rhRef, true));
    }
    return localCmp(valueStringCompare(lhs, rhs));
  }

  private sort(): void {
    this.collapseForSort();
    const byRef = (a: FieldsRef, b: FieldsRef): number =>
      strNumCmp(a.ref + a.refNumber, b.ref + b.refNumber, true);
    for (const row of this.rows) row.refs.sort(byRef);
    this.rows.sort((a, b) => (this.cmp(a, b) ? -1 : this.cmp(b, a) ? 1 : 0));
    let itemNumber = 1;
    for (const row of this.rows) row.itemNumber = itemNumber++;
    this.expandAfterSort();
  }

  expandRow(row: number): void {
    const group = this.rows[row];
    if (!group) return;
    const children: DataModelRow[] = [];
    for (const ref of group.refs) {
      let matchFound = false;
      for (const child of children) {
        if (this.unitMatch(ref, child.refs[0]!)) {
          matchFound = true;
          child.refs.push(ref);
          break;
        }
      }
      if (!matchFound) children.push({ itemNumber: 0, flag: 'child', refs: [ref] });
    }
    if (children.length < 2) return;
    children.sort((a, b) => (this.cmp(a, b) ? -1 : this.cmp(b, a) ? 1 : 0));
    group.flag = 'expanded';
    this.rows.splice(row + 1, 0, ...children);
  }

  collapseRow(row: number): void {
    const group = this.rows[row];
    if (!group) return;
    let deleted = 0;
    while (this.rows[row + 1 + deleted]?.flag === 'child') deleted++;
    group.flag = 'collapsed';
    this.rows.splice(row + 1, deleted);
  }

  expandCollapseRow(row: number): void {
    const flag = this.rows[row]?.flag;
    if (flag === 'collapsed') this.expandRow(row);
    else if (flag === 'expanded') this.collapseRow(row);
  }

  private collapseForSort(): void {
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i]!.flag === 'expanded') {
        this.collapseRow(i);
        this.rows[i]!.flag = 'collapsed-during-sort';
      }
    }
  }

  private expandAfterSort(): void {
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i]!.flag === 'collapsed-during-sort') this.expandRow(i);
    }
  }

  // --- values --------------------------------------------------------------

  /**
   * FIELDS_EDITOR_GRID_DATA_MODEL::GetValue for a group: the shared value of
   * the group's symbols, {@link INDETERMINATE_STATE} when they disagree (or,
   * for the export, every distinct value joined by commas).
   */
  getGroupValue(
    group: DataModelRow,
    col: number,
    refDelimiter = ', ',
    refRangeDelimiter = '-',
    resolveVars = false,
    listMixedValues = false,
  ): string {
    const column = this.cols[col];
    if (!column) return '';
    const references: FieldsRef[] = [];
    const mixedValues = new Set<string>();
    let fieldText = '';
    const listy = this.colIsReference(col) || this.colIsQuantity(col) || this.colIsItemNumber(col);

    for (const ref of group.refs) {
      if (listy) {
        references.push(ref);
        continue;
      }
      let refFieldValue = this.storedValue(ref, column.fieldName);
      if (refFieldValue === undefined) return INDETERMINATE_STATE;
      if (resolveVars) {
        if (isGeneratedField(column.fieldName)) {
          refFieldValue = this.getFieldShownText(ref, column.fieldName);
        } else if (refFieldValue.includes('${')) {
          refFieldValue = expandTextVars(refFieldValue, this.resolverFor(ref));
        }
      }
      if (listMixedValues) mixedValues.add(refFieldValue);
      else if (ref === group.refs[0]) fieldText = refFieldValue;
      else if (fieldText !== refFieldValue) return INDETERMINATE_STATE;
    }

    if (listMixedValues) {
      fieldText = [...mixedValues].filter((v) => v !== '').join(',');
    }

    if (listy) {
      // Other units of a multi-unit part count once.
      references.sort((a, b) => strNumCmp(a.ref + a.refNumber, b.ref + b.refNumber, true));
      const unique: FieldsRef[] = [];
      for (const ref of references) {
        const prev = unique[unique.length - 1];
        if (
          prev &&
          prev.refNumber !== '?' &&
          prev.ref + prev.refNumber === ref.ref + ref.refNumber
        ) {
          continue;
        }
        unique.push(ref);
      }
      if (this.colIsReference(col)) {
        return refsShorthand(
          unique.map((r) => r.ref + r.refNumber),
          refDelimiter,
          refRangeDelimiter,
        );
      }
      if (this.colIsQuantity(col)) return String(unique.length);
      if (this.colIsItemNumber(col) && group.flag !== 'child') return String(group.itemNumber);
      return '';
    }
    return fieldText;
  }

  /** The raw (unresolved) cell text the grid edits. */
  getValue(row: number, col: number): string {
    const group = this.rows[row];
    return group ? this.getGroupValue(group, col) : '';
  }

  /** The cell text with `${…}` references resolved, for display/tooltips. */
  getResolvedValue(row: number, col: number): string {
    const group = this.rows[row];
    return group ? this.getGroupValue(group, col, ', ', '-', true, false) : '';
  }

  /** GetExportValue, resolved, and mixed group values listed rather than hidden. */
  getExportValue(
    row: number,
    col: number,
    refDelimiter: string,
    refRangeDelimiter: string,
  ): string {
    const group = this.rows[row];
    return group ? this.getGroupValue(group, col, refDelimiter, refRangeDelimiter, true, true) : '';
  }

  /** SetValue, write one value to every symbol of the row. */
  setValue(row: number, col: number, value: string): void {
    const column = this.cols[col];
    const group = this.rows[row];
    if (!column || !group) return;
    // References and generated (non-attribute) columns are read-only.
    if (
      this.colIsReference(col) ||
      (isGeneratedField(column.fieldName) && !this.colIsAttribute(col))
    )
      return;
    if (value === INDETERMINATE_STATE) return;
    for (const ref of group.refs) {
      let fields = this.store.get(storeKey(ref));
      if (!fields) {
        fields = new Map();
        this.store.set(storeKey(ref), fields);
      }
      fields.set(column.fieldName, value);
    }
    this.edited = true;
  }

  /** GetDataWidth, the longest cell text of a column, in characters. */
  getDataWidth(col: number): number {
    const column = this.cols[col];
    if (!column) return 0;
    let width = 0;
    if (this.colIsReference(col)) {
      for (let row = 0; row < this.rows.length; row++)
        width = Math.max(width, this.getValue(row, col).length);
    } else {
      for (const ref of this.refs)
        width = Math.max(width, (this.storedValue(ref, column.fieldName) ?? '').length);
    }
    return width;
  }

  // --- presets -------------------------------------------------------------

  applyBomPreset(preset: BomPresetSpec): void {
    for (let i = 0; i < this.cols.length; i++) {
      this.setShowColumn(i, false);
      this.setGroupColumn(i, false);
    }
    const seen = new Set<string>();
    const order: string[] = [];
    for (const field of preset.fieldsOrdered) {
      if (!field.name || seen.has(field.name)) continue;
      seen.add(field.name);
      order.push(field.name);
      let col = this.getFieldNameCol(field.name);
      if (col === -1) {
        // Missing fields are added; with no data entered they never reach the symbols.
        this.addColumn(field.name, field.label, true);
        col = this.getFieldNameCol(field.name);
      } else {
        this.setColLabelValue(col, field.label);
      }
      this.setGroupColumn(col, field.groupBy);
      this.setShowColumn(col, field.show);
    }
    this.setGroupingEnabled(preset.groupSymbols);
    this.setFieldsOrder(order);
    let sortCol = this.getFieldNameCol(preset.sortField);
    if (sortCol === -1) sortCol = this.getFieldNameCol('Reference');
    this.setSorting(sortCol, preset.sortAsc);
    this.setFilter(preset.filterString);
    this.setExcludeDNP(preset.excludeDnp);
    this.setIncludeExcludedFromBOM(preset.includeExcludedFromBom);
    this.rebuildRows();
  }

  getBomSettings(): BomPresetSpec {
    return {
      name: '',
      readOnly: false,
      fieldsOrdered: this.getFieldsOrdered(),
      sortField:
        this.sortColumn >= 0 && this.sortColumn < this.cols.length
          ? this.getColFieldName(this.sortColumn)
          : '',
      sortAsc: this.sortAscending,
      filterString: this.filter,
      groupSymbols: this.groupingEnabled,
      excludeDnp: this.excludeDNP,
      includeExcludedFromBom: this.includeExcluded,
    };
  }

  /** FIELDS_EDITOR_GRID_DATA_MODEL::Export, the shown columns, delimited. */
  export(settings: BomOutputFormat): string {
    if (this.cols.length === 0) return '';
    let lastCol = -1;
    for (let col = 0; col < this.cols.length; col++) {
      if (this.cols[col]!.show) lastCol = col;
    }
    if (lastCol === -1) return '';

    const formatField = (field: string, last: boolean): string => {
      let out = field;
      if (!settings.keepLineBreaks) out = out.replace(/[\r\n]/g, '');
      if (!settings.keepTabs) out = out.replace(/\t/g, '');
      if (settings.stringDelimiter !== '')
        out = out.split(settings.stringDelimiter).join(settings.stringDelimiter.repeat(2));
      return (
        settings.stringDelimiter +
        out +
        settings.stringDelimiter +
        (last ? '\n' : settings.fieldDelimiter)
      );
    };

    let out = '';
    for (let col = 0; col < this.cols.length; col++) {
      if (!this.cols[col]!.show) continue;
      out += formatField(this.cols[col]!.label, col === lastCol);
    }
    for (let row = 0; row < this.rows.length; row++) {
      if (this.rows[row]!.flag === 'child') continue; // child rows never export
      for (let col = 0; col < this.cols.length; col++) {
        if (!this.cols[col]!.show) continue;
        out += formatField(
          this.getExportValue(row, col, settings.refDelimiter, settings.refRangeDelimiter),
          col === lastCol,
        );
      }
    }
    return out;
  }

  // --- apply ---------------------------------------------------------------

  /**
   * ApplyData, the store's changed cells as per-sheet edits. Field values that
   * differ from the symbol are written; a tracked field the store no longer
   * carries (its column was removed) is cleared, which drops it from the
   * symbol; attribute columns become symbol flag changes.
   */
  applyData(): FieldsTableEdits {
    const fields = new Map<string, Map<string, Record<string, string>>>();
    const attrs = new Map<string, Map<string, SymbolAttrEdit>>();

    const fieldEdit = (ref: FieldsRef, name: string, value: string): void => {
      let perFile = fields.get(ref.file);
      if (!perFile) {
        perFile = new Map();
        fields.set(ref.file, perFile);
      }
      const cur = perFile.get(ref.id) ?? {};
      cur[name] = value;
      perFile.set(ref.id, cur);
    };
    const attrEdit = (ref: FieldsRef, key: keyof SymbolAttrEdit, value: boolean): void => {
      let perFile = attrs.get(ref.file);
      if (!perFile) {
        perFile = new Map();
        attrs.set(ref.file, perFile);
      }
      perFile.set(ref.id, { ...(perFile.get(ref.id) ?? {}), [key]: value });
    };

    const seen = new Set<string>();
    for (const ref of this.refs) {
      const key = storeKey(ref);
      // Instances of one file share the symbol, so apply each symbol once.
      if (seen.has(key)) continue;
      seen.add(key);
      const stored = this.store.get(key);
      if (!stored) continue;

      for (const [name, value] of stored) {
        if (isAttributeField(name)) {
          if (value !== attributeValue(ref.symbol, name)) {
            attrEdit(ref, ATTR_EDIT_KEY[name]!, value === '1');
          }
          continue;
        }
        // Generated fields (${QUANTITY} …) are read-only.
        if (isGeneratedField(name)) continue;
        // Reference is not editable from this dialog.
        if (name === 'Reference') continue;
        const col = this.getFieldNameCol(name);
        const userAdded = col !== -1 && this.cols[col]!.userAdded;
        const previous = fieldValue(ref.symbol, name);
        if (previous === undefined) {
          // A field the symbol lacks is created when it has a value (or the
          // user added the column deliberately).
          if (value !== '' || userAdded) fieldEdit(ref, name, value);
        } else if (previous !== value) {
          fieldEdit(ref, name, value);
        }
      }

      // Fields dropped from the table (column removed) are removed from the symbol.
      for (const f of ref.symbol.fields) {
        if (isMandatoryField(f.key)) continue;
        if (!stored.has(f.key)) fieldEdit(ref, f.key, '');
      }
    }

    this.edited = false;
    return { fields, attrs };
  }
}
