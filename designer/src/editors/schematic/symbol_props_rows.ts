// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Properties fields grid's rows. Counterpart: `FIELDS_GRID_TABLE`
 * (eeschema/fields_grid_table.cpp) as `DIALOG_SYMBOL_PROPERTIES`'s
 * `TransferDataToWindow` fills it and `TransferDataFromWindow` reads it back.
 *
 * This is the grid's *data*, split out of the component so it can be compiled
 * and tested — qa's tsconfig compiles `.ts` only, so anything living in a
 * `.tsx` is untestable by construction (the same reason `menu_types.ts` and
 * `toolbar_types.ts` exist).
 *
 * It earns the split: the round trip through a row is where a field's flags go
 * missing. A row that does not carry a flag hands back an `EditedField` without
 * it, `applyFields` rebuilds the field from exactly that object, and
 * `patchProperty` then strips the token from the file — so opening the dialog
 * and pressing OK is enough to lose a setting the user never touched.
 */

import {
  isMandatoryField,
  MANDATORY_FIELDS,
  type LibSymbol,
  type SchField,
  type SchSymbol,
  type TextEffects,
} from '@ziroeda/eeschema';
import type { EditedField } from '@ziroeda/eeschema';
import type { FieldTemplate } from './schematic_settings.js';

/** One grid row: a field in the dialog's symbol-relative convention. */
export interface FieldRow {
  key: string;
  value: string;
  /** Symbol-relative position, IU — `TransferDataToWindow` offsets each copy
   *  by the symbol's position and `TransferDataFromWindow` puts it back. */
  at: { x: number; y: number };
  /** 0 (horizontal) or 90 (vertical); the grid offers no other angle. */
  angle: number;
  effects: TextEffects;
  nameShown: boolean;
  /** `FDC_ALLOW_AUTOPLACE`, stored inverted as the file token is. */
  doNotAutoplace?: boolean;
  /** `(show_in_chooser yes)`. No column — carried so OK cannot drop it. */
  showInChooser?: boolean;
  /** The bare `private` flag. No column either (KiCad's grid has none), and it
   *  moves the name and value slots in the file, so dropping it here would
   *  rename the field on the next save. */
  isPrivate?: boolean;
  source?: SchField['source'];
}

/**
 * The grid's initial rows: the symbol's fields, then any Field Name Template
 * not yet on the symbol as an empty row with the template's Visible flag.
 *
 * The five mandatory fields always come first, and always all five. That is
 * `SCH_SYMBOL`'s invariant rather than the dialog's: a `SCH_SYMBOL` built from
 * a `LIB_SYMBOL` copies the part's fields (`sch_symbol.cpp`), and `FIELD_T`'s
 * mandatory ids — REFERENCE, VALUE, FOOTPRINT, DATASHEET, DESCRIPTION — exist
 * on every symbol whether or not the file wrote them, which is why
 * `TransferDataToWindow` can push `m_symbol->GetFields()` straight into the
 * grid and get five rows. Our placer (`makeSymbol`, eeschema/src/tools/build.ts)
 * writes only Reference and Value, and a hand-edited file may carry fewer
 * still, so the missing ones are materialised here — from the library part's
 * own property, which is where a real placement's copy came from.
 */
export function rowsFromSymbol(
  symbol: SchSymbol,
  fieldTemplates?: readonly FieldTemplate[],
  lib?: LibSymbol,
): FieldRow[] {
  const rowOf = (f: SchField): FieldRow => ({
    key: f.key,
    value: f.value,
    at: f.at ? { x: f.at.x - symbol.at.x, y: f.at.y - symbol.at.y } : { x: 0, y: 0 },
    angle: ((f.angle % 180) + 180) % 180 === 90 ? 90 : 0,
    effects: f.effects ?? { hidden: false },
    nameShown: !!f.nameShown,
    doNotAutoplace: f.doNotAutoplace,
    showInChooser: f.showInChooser,
    isPrivate: f.isPrivate,
    source: f.source,
  });

  const byKey = new Map(symbol.fields.map((f) => [f.key, f]));
  const out: FieldRow[] = [];

  for (const name of MANDATORY_FIELDS) {
    const own = byKey.get(name);
    if (own) {
      out.push(rowOf(own));
      continue;
    }
    // Not on the placement: take the library part's property, the copy KiCad's
    // placement would have made. A part that has none either gets an empty,
    // hidden row — never a missing one, because the row is what makes the
    // field editable at all.
    const fromLib = lib?.properties.find((p) => p.key === name);
    out.push({
      key: name,
      value: fromLib?.value ?? '',
      at: { x: 0, y: 0 },
      angle: 0,
      effects: fromLib?.effects ?? { hidden: true },
      nameShown: !!fromLib?.nameShown,
    });
  }

  for (const f of symbol.fields) {
    if (!isMandatoryField(f.key)) out.push(rowOf(f));
  }

  const defined = new Set(out.map((r) => r.key));
  for (const t of fieldTemplates ?? []) {
    if (t.name && !defined.has(t.name)) {
      out.push({
        key: t.name,
        value: '',
        at: { x: 0, y: 0 },
        angle: 0,
        effects: { hidden: !t.visible },
        nameShown: false,
      });
    }
  }
  return out;
}

/**
 * `FIELDS_GRID_TABLE::getVisibleRowCount` / `getField`
 * (eeschema/fields_grid_table.cpp:474-516): in the *schematic* editor a
 * `private` field is not a row at all. It stays in the table's vector — which
 * is why this returns indices into `rows` rather than a filtered copy: dropping
 * it here would drop the field on OK, and `private` is exactly the flag the
 * simulator writes.
 */
export const gridRowIndices = (rows: readonly FieldRow[]): number[] =>
  rows.map((_, i) => i).filter((i) => !rows[i]?.isPrivate);

/**
 * `FIELDS_GRID_TABLE::GetMandatoryRowCount`. Positional, not per-row: the
 * mandatory fields are the leading block, and every row rule below counts
 * against the size of that block rather than asking each row what it is.
 */
export const mandatoryRowCount = (rows: readonly FieldRow[]): number =>
  rows.filter((r) => isMandatoryField(r.key)).length;

/** `OnDeleteField`'s filter: `row < GetMandatoryRowCount()` is refused. */
export const canDeleteRow = (rows: readonly FieldRow[], row: number): boolean =>
  row >= mandatoryRowCount(rows) && row < rows.length;

/** `OnMoveUp`'s filter, `row > GetMandatoryRowCount()` — strictly greater, so
 *  the first user field cannot be moved up into the mandatory block. */
export const canMoveRowUp = (rows: readonly FieldRow[], row: number): boolean =>
  row > 0 && row > mandatoryRowCount(rows);

/** `OnMoveDown`'s filter, `row >= GetMandatoryRowCount()`, plus `WX_GRID`'s own
 *  `i + 1 < GetNumberRows()`. */
export const canMoveRowDown = (rows: readonly FieldRow[], row: number): boolean =>
  row + 1 < rows.length && row >= mandatoryRowCount(rows);

/** `FIELDS_GRID_TABLE::GetAttr`, FDC_NAME: a mandatory field's name is
 *  read-only (`attr->SetReadOnly( true )`, fields_grid_table.cpp:592-597). */
export const isNameReadOnly = (row: FieldRow): boolean => isMandatoryField(row.key);

/**
 * `FIELDS_GRID_TABLE::GetAttr`, FDC_VALUE: the Footprint of a *power* symbol
 * gets `m_readOnlyAttr` — "Power symbols do not appear in the board, so don't
 * allow a footprint" (fields_grid_table.cpp:617-631). Nothing else in this
 * dialog's value column is read-only.
 */
export const isValueReadOnly = (row: FieldRow, isPowerSymbol: boolean): boolean =>
  isPowerSymbol && row.key === 'Footprint';

/** How a cell draws when it is not being edited, which is what separates a
 *  wxGridCellBoolRenderer (always a checkbox) from a wxGridCellChoiceEditor
 *  (plain text until the cell is opened). */
export type FieldsGridCellKind = 'text' | 'choice' | 'bool' | 'color' | 'font';

/** One column of `FIELDS_GRID_TABLE`, as the grid is built and labelled. */
export interface FieldsGridColumn {
  /** `FIELDS_DATA_COL_ORDER`'s name, lower-cased (fields_grid_table.h:62-85). */
  readonly id: string;
  /** `FIELDS_GRID_TABLE::GetColLabelValue` (fields_grid_table.cpp:521-543). */
  readonly label: string;
  readonly kind: FieldsGridCellKind;
  /** `SetColSize` in dialog_symbol_properties_base.cpp:40-53. Column 14 has
   *  none, so it keeps wxGrid's default — 80 px, asked of a real wxGrid by
   *  `qa/probes/fields_grid_probe.cpp`. */
  readonly width: number;
  /** `SetAlignment( wxALIGN_CENTER, wxALIGN_CENTER )` on the attr
   *  (fields_grid_table.cpp:341, 349, 357, 364); everything else takes the
   *  grid's `SetDefaultCellAlignment( wxALIGN_LEFT, … )`. */
  readonly center: boolean;
  /** A `wxGridCellChoiceEditor`'s items, in its order. */
  readonly choices?: readonly string[];
}

/**
 * The fields grid's columns. `FDC_SCH_EDIT_COUNT` is 15, so the schematic
 * editor's grid has fifteen — the base file's `CreateGrid( 4, 14 )` is
 * overridden the moment `SetTable` hands it `FIELDS_GRID_TABLE`, whose
 * `getColumnCount` returns `FDC_SCH_EDIT_COUNT` for `FRAME_SCH`.
 * FDC_PRIVATE is the symbol *editor*'s sixteenth and is not here.
 */
export const FIELDS_GRID_COLUMNS: readonly FieldsGridColumn[] = [
  { id: 'name', label: 'Name', kind: 'text', width: 72, center: false },
  { id: 'value', label: 'Value', kind: 'text', width: 10, center: false },
  { id: 'shown', label: 'Show', kind: 'bool', width: 48, center: true },
  { id: 'show_name', label: 'Show Name', kind: 'bool', width: 84, center: true },
  {
    id: 'h_align',
    label: 'H Align',
    kind: 'choice',
    width: 66,
    center: true,
    choices: ['Left', 'Center', 'Right'],
  },
  {
    id: 'v_align',
    label: 'V Align',
    kind: 'choice',
    width: 66,
    center: true,
    choices: ['Top', 'Center', 'Bottom'],
  },
  { id: 'italic', label: 'Italic', kind: 'bool', width: 48, center: true },
  { id: 'bold', label: 'Bold', kind: 'bool', width: 48, center: true },
  { id: 'text_size', label: 'Text Size', kind: 'text', width: 84, center: false },
  {
    id: 'orientation',
    label: 'Orientation',
    kind: 'choice',
    width: 84,
    center: true,
    choices: ['Horizontal', 'Vertical'],
  },
  { id: 'posx', label: 'X Position', kind: 'text', width: 84, center: false },
  { id: 'posy', label: 'Y Position', kind: 'text', width: 84, center: false },
  { id: 'font', label: 'Font', kind: 'font', width: 10, center: false },
  { id: 'color', label: 'Color', kind: 'color', width: 48, center: false },
  { id: 'allow_autoplace', label: 'Allow Autoplacement', kind: 'bool', width: 80, center: true },
];

/**
 * `m_fieldsGrid->ShowHideColumns( "0 1 2 3 4 5 6 7" )`
 * (dialog_symbol_properties.cpp:341): Name through Bold. The rest are hidden
 * until the user turns them on from the column-label context menu
 * (`GRID_TRICKS::onGridLabelRightClick`, common/grid_tricks.cpp:362-374), and
 * the set is not persisted — the constructor states it again on every open.
 */
export const DEFAULT_SHOWN_COLUMNS = '0 1 2 3 4 5 6 7';

/** That string as the set the grid starts with. */
export const defaultShownColumns = (): Set<number> =>
  new Set(DEFAULT_SHOWN_COLUMNS.split(/\s+/).map(Number));

/**
 * The rows read back, as `TransferDataFromWindow` reads the grid: names are
 * trimmed and a row that is both nameless and valueless is dropped.
 */
export function fieldsFromRows(rows: readonly FieldRow[]): EditedField[] {
  return rows
    .filter((r) => !(r.key.trim() === '' && r.value === ''))
    .map((r) => ({
      key: r.key.trim(),
      value: r.value,
      at: r.at,
      angle: r.angle,
      effects: r.effects,
      nameShown: r.nameShown || undefined,
      doNotAutoplace: r.doNotAutoplace,
      showInChooser: r.showInChooser,
      isPrivate: r.isPrivate,
      source: r.source,
    }));
}

/**
 * `Validate()`: a non-mandatory row with a value but no name is an error.
 * Nameless *and* valueless rows are dropped silently instead, which is why
 * this is not simply "every row needs a name".
 */
export function validateRows(rows: readonly FieldRow[]): string | null {
  for (const r of rows) {
    if (!isMandatoryField(r.key) && r.key.trim() === '' && r.value !== '') {
      return 'Fields must have a name.';
    }
  }
  return null;
}

/** `#RRGGBB` for the colour cell; KiCad's swatch drops alpha the same way. */
export const colorHex = (c: TextEffects['color']): string =>
  c
    ? `#${[c[0], c[1], c[2]].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
    : '';

/** The inverse: a swatch value back to the model's `[r,g,b,a]`. */
export function colorFromHex(hex: string): TextEffects['color'] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 16);
  // Alpha 1: KiCad writes a fully opaque text colour, and an alpha-0 colour is
  // how "no colour" is spelled — so a swatch must never produce one.
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 1];
}
