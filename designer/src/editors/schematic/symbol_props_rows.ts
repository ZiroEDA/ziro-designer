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
  source?: SchField['source'];
}

/**
 * The grid's initial rows: the symbol's fields, then any Field Name Template
 * not yet on the symbol as an empty row with the template's Visible flag.
 */
export function rowsFromSymbol(
  symbol: SchSymbol,
  fieldTemplates?: readonly FieldTemplate[],
): FieldRow[] {
  const out: FieldRow[] = symbol.fields.map((f) => ({
    key: f.key,
    value: f.value,
    at: f.at ? { x: f.at.x - symbol.at.x, y: f.at.y - symbol.at.y } : { x: 0, y: 0 },
    angle: ((f.angle % 180) + 180) % 180 === 90 ? 90 : 0,
    effects: f.effects ?? { hidden: false },
    nameShown: !!f.nameShown,
    doNotAutoplace: f.doNotAutoplace,
    showInChooser: f.showInChooser,
    source: f.source,
  }));
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
