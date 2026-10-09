// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Symbol Properties command, ported from KiCad's
 * DIALOG_SYMBOL_PROPERTIES::TransferDataFromWindow (dialog_symbol_properties.cpp).
 *
 * The dialog edits a copy of the symbol's fields (positions symbol-relative) plus
 * unit / orientation / mirror / attribute flags; OK applies everything as one
 * undoable commit. KiCad's post-processing rules are reproduced exactly:
 *   - a field with an empty name AND empty value is dropped,
 *   - a field with an empty name but a value is renamed "untitled",
 *   - field positions convert from symbol-relative back to absolute,
 *   - mandatory fields (Reference, Value, Footprint, Datasheet, Description)
 *     are never dropped.
 */

import type { Schematic, SchSymbol, SchField, LibSymbol } from '../types.js';
import { buildPropertyNode } from '../sch_io/sexpr/write-schematic.js';
import { refId } from './hittest.js';
import type { EditCommand } from './command.js';

/** KiCad SCH_FIELD::IsMandatory, by canonical name (we have no FIELD_T ids). */
export const MANDATORY_FIELDS = ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description'];

export const isMandatoryField = (key: string): boolean => MANDATORY_FIELDS.includes(key);

/**
 * `FieldNamesAreDuplicates` (common/template_fieldnames.cpp:99-125).
 *
 * Two names collide when they are equal, and ALSO when they differ only in case
 * AND one of them is a mandatory canonical name: "reference" collides with
 * "Reference" because the s-expression parser folds mandatory names
 * case-insensitively, while "partno" and "PartNo" are two distinct user fields.
 *
 * That asymmetry is the whole function — a plain `CmpNoCase` would refuse a
 * legal pair of user fields, and a plain `==` would let a symbol be written
 * with two Reference fields.
 */
export function fieldNamesAreDuplicates(lhs: string, rhs: string): boolean {
  if (lhs === rhs) return true;

  // If they don't even match case-insensitively they can't both be variants of
  // the same canonical mandatory field name.
  if (lhs.toLowerCase() !== rhs.toLowerCase()) return false;

  return MANDATORY_FIELDS.some((name) => lhs.toLowerCase() === name.toLowerCase());
}

/** A field as edited in the dialog: `at` is symbol-relative, `source` optional (new fields). */
export type EditedField = Omit<SchField, 'source'> & { readonly source?: SchField['source'] };

/**
 * Bulk field edit (the Symbol Fields Table's edit view,
 * dialog_symbol_fields_table.cpp): set field *values* on many symbols in one
 * undoable commit. `edits` maps a symbol's refId to `{ fieldName: newValue }`;
 * an existing field updates in place, a missing one is appended (KiCad adds it
 * at the symbol origin). An empty value on a non-mandatory field removes it.
 */
export function bulkEditFieldsCommand(
  edits: ReadonlyMap<string, Readonly<Record<string, string>>>,
): EditCommand {
  return {
    label: 'Edit Symbol Fields',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => {
          const edit = edits.get(refId('symbol', s.uuid, i));
          if (!edit) return s;
          let fields: SchField[] = [...s.fields];
          for (const [key, value] of Object.entries(edit)) {
            const idx = fields.findIndex((f) => f.key === key);
            if (idx !== -1) {
              if (value === '' && !isMandatoryField(key)) fields.splice(idx, 1);
              else {
                const f = fields[idx]!;
                fields[idx] = { ...f, value, source: buildPropertyNode({ ...f, value }) };
              }
            } else if (value !== '') {
              const nf = { key, value, at: s.at, angle: 0 };
              fields = [...fields, { ...nf, source: buildPropertyNode(nf) }];
            }
          }
          return { ...s, fields };
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.symbols.map((s, i) => [refId('symbol', s.uuid, i), s] as const);
      return restoreSymbols(new Map(prev.filter(([rid]) => edits.has(rid))));
    },
  };
}

/** The symbol attribute flags the fields table edits through its `${DNP}` /
 *  `${EXCLUDE_FROM_*}` columns (FIELDS_EDITOR_GRID_DATA_MODEL::setAttributeValue).
 *  Omitted keys are left alone. */
export interface SymbolAttrEdit {
  readonly dnp?: boolean;
  readonly excludedFromBom?: boolean;
  readonly excludedFromBoard?: boolean;
  readonly excludedFromSim?: boolean;
  readonly excludedFromPosFiles?: boolean;
}

/**
 * Bulk attribute edit, the attribute half of the Symbol Fields Table's apply
 * (`FIELDS_EDITOR_GRID_DATA_MODEL::setAttributeValue`): the `${DNP}` and
 * `${EXCLUDE_FROM_…}` columns write symbol flags rather than fields. `edits`
 * maps a symbol's refId to the flags to change.
 */
export function bulkEditSymbolAttributesCommand(
  edits: ReadonlyMap<string, SymbolAttrEdit>,
): EditCommand {
  return {
    label: 'Edit Symbol Fields',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => {
          const edit = edits.get(refId('symbol', s.uuid, i));
          if (!edit) return s;
          const next = { ...s } as { -readonly [K in keyof SchSymbol]: SchSymbol[K] };
          if (edit.dnp !== undefined) next.dnp = edit.dnp;
          if (edit.excludedFromBom !== undefined) next.inBom = !edit.excludedFromBom;
          if (edit.excludedFromBoard !== undefined) next.onBoard = !edit.excludedFromBoard;
          if (edit.excludedFromSim !== undefined) next.excludedFromSim = edit.excludedFromSim;
          if (edit.excludedFromPosFiles !== undefined)
            next.excludedFromPosFiles = edit.excludedFromPosFiles;
          return next;
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.symbols.map((s, i) => [refId('symbol', s.uuid, i), s] as const);
      return restoreSymbols(new Map(prev.filter(([rid]) => edits.has(rid))));
    },
  };
}

/** Restore captured symbols verbatim (the inverse of a properties edit). */
export function restoreSymbols(
  saved: ReadonlyMap<string, SchSymbol>,
  // The cached definitions as they were, when the edit touched any. Undo has to
  // put these back too: the pin-text flags live on lib_symbols, so restoring
  // only the placements left "Show pin numbers" off after an undo.
  savedLibs?: ReadonlyMap<string, LibSymbol>,
): EditCommand {
  return {
    label: 'Edit Symbol Properties',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        ...(savedLibs && savedLibs.size > 0
          ? { libSymbols: doc.libSymbols.map((l) => savedLibs.get(l.libId) ?? l) }
          : {}),
        symbols: doc.symbols.map((s, i) => saved.get(refId('symbol', s.uuid, i)) ?? s),
      };
    },
    invert(before: Schematic): EditCommand {
      const ids = new Set(saved.keys());
      const prev = before.symbols.map((s, i) => [refId('symbol', s.uuid, i), s] as const);
      const libs = savedLibs
        ? new Map(before.libSymbols.filter((l) => savedLibs.has(l.libId)).map((l) => [l.libId, l]))
        : undefined;
      return restoreSymbols(new Map(prev.filter(([rid]) => ids.has(rid))), libs);
    },
  };
}
