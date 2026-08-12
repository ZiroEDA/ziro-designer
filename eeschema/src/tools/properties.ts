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

import type { Schematic, SchSymbol, SchSymbolPin, SchField, LibSymbol } from '../types.js';
import { buildPropertyNode } from '../sch_io/sexpr/write-schematic.js';
import { refId } from './hittest.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import type { EditCommand } from './command.js';

/** KiCad SCH_FIELD::IsMandatory, by canonical name (we have no FIELD_T ids). */
export const MANDATORY_FIELDS = ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description'];

export const isMandatoryField = (key: string): boolean => MANDATORY_FIELDS.includes(key);

/** A field as edited in the dialog: `at` is symbol-relative, `source` optional (new fields). */
export type EditedField = Omit<SchField, 'source'> & { readonly source?: SchField['source'] };

/** The symbol-level results of the properties dialog. */
export interface SymbolEdit {
  readonly fields: readonly EditedField[];
  readonly angle: number;
  readonly mirror?: 'x' | 'y';
  readonly unit: number;
  /** Body style, 1-based; 2 is KiCad's "De Morgan" alternate. */
  readonly bodyStyle: number;
  readonly inBom: boolean;
  readonly onBoard: boolean;
  readonly dnp: boolean;
  readonly excludedFromSim?: boolean;
  /** `(in_pos_files no)`; undefined leaves the token as the file had it. */
  readonly excludedFromPosFiles?: boolean;
  /** The Pin Functions page's alternate selections. Undefined leaves the
   *  placement's pin list exactly as the file had it. */
  readonly pins?: readonly SchSymbolPin[];
  /**
   * The dialog's "Show pin numbers" / "Show pin names".
   *
   * `TransferDataFromWindow` writes these onto the placement's cached library
   * symbol (`m_symbol->SetShowPinNumbers(...)`), not onto the placement, so one
   * symbol can hide its pin text without every other use of the same part
   * changing. Undefined leaves the cached copy exactly as it was.
   */
  readonly showPinNumbers?: boolean;
  readonly showPinNames?: boolean;
}

/** TransferDataFromWindow's field post-processing + rel→abs position conversion. */
function applyFields(sym: SchSymbol, edited: readonly EditedField[]): readonly SchField[] {
  const out: SchField[] = [];
  for (const f of edited) {
    if (f.key === '' && f.value === '') continue; // dropped, as in KiCad
    const key = f.key === '' ? 'untitled' : f.key;
    const at = f.at ? { x: f.at.x + sym.at.x, y: f.at.y + sym.at.y } : undefined;
    const base = { ...f, key, at };
    out.push(f.source ? (base as SchField) : { ...base, source: buildPropertyNode(base) });
  }
  return out;
}

/** Apply the Symbol Properties dialog's result to the symbol with `id`, undoably. */
export function editSymbolProperties(id: string, edit: SymbolEdit): EditCommand {
  return {
    label: 'Edit Symbol Properties',
    apply(doc: Schematic): Schematic {
      // The pin-text flags live on the sheet's cached definition, not on the
      // placement: TransferDataFromWindow calls m_symbol->SetShowPinNumbers,
      // and SCH_SYMBOL forwards it to the LIB_SYMBOL it owns a copy of. So they
      // are applied to lib_symbols, and only to the definition this placement
      // uses — hiding one symbol's pin numbers must not change every other use
      // of the same part.
      const target = doc.symbols.find((s, i) => refId('symbol', s.uuid, i) === id);
      const pinFlags = edit.showPinNumbers !== undefined || edit.showPinNames !== undefined;
      const libSymbols =
        target && pinFlags
          ? doc.libSymbols.map((l) =>
              l.libId === schSymbolLibraryName(target)
                ? {
                    ...l,
                    ...(edit.showPinNumbers !== undefined
                      ? { pinNumbersHidden: !edit.showPinNumbers }
                      : {}),
                    ...(edit.showPinNames !== undefined
                      ? { pinNamesHidden: !edit.showPinNames }
                      : {}),
                  }
                : l,
            )
          : doc.libSymbols;
      return {
        ...doc,
        libSymbols,
        symbols: doc.symbols.map((s, i) => {
          if (refId('symbol', s.uuid, i) !== id) return s;
          const next: SchSymbol = {
            ...s,
            angle: edit.angle,
            unit: edit.unit,
            bodyStyle: edit.bodyStyle,
            inBom: edit.inBom,
            onBoard: edit.onBoard,
            dnp: edit.dnp,
            fields: applyFields(s, edit.fields),
          };
          const m = { ...next } as { -readonly [K in keyof SchSymbol]: SchSymbol[K] };
          if (edit.mirror) m.mirror = edit.mirror;
          else delete m.mirror;
          if (edit.excludedFromSim !== undefined) m.excludedFromSim = edit.excludedFromSim;
          if (edit.excludedFromPosFiles !== undefined)
            m.excludedFromPosFiles = edit.excludedFromPosFiles;
          if (edit.pins !== undefined) m.pins = edit.pins;
          return m;
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      const prev = before.symbols.map((s, i) => [refId('symbol', s.uuid, i), s] as const);
      const target = before.symbols.find((s, i) => refId('symbol', s.uuid, i) === id);
      const pinFlags = edit.showPinNumbers !== undefined || edit.showPinNames !== undefined;
      const libs =
        target && pinFlags
          ? new Map(
              before.libSymbols
                .filter((l) => l.libId === schSymbolLibraryName(target))
                .map((l) => [l.libId, l] as const),
            )
          : undefined;
      return restoreSymbols(new Map(prev.filter(([rid]) => rid === id)), libs);
    },
  };
}

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
function restoreSymbols(
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
