// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Change Symbols / Update Symbols from Library. Counterpart:
 * `eeschema/dialogs/dialog_change_symbols.cpp` (`isMatch`,
 * `processMatchingSymbols`, `processSymbols`).
 *
 * Two modes share one implementation, which is why upstream has one dialog:
 *
 *  - **Update** re-reads each symbol's own library entry and pulls the changes
 *    back into the schematic. The library moved on; the schematic catches up.
 *  - **Change** does the same but against a *different* library entry, so the
 *    symbol becomes a different part while keeping its place, its reference
 *    and whatever fields you chose not to update.
 *
 * The choice of what to carry over is the point of the dialog, and its
 * defaults differ per mode: Change resets visibilities, sizes and positions
 * (you asked for a different part, so take its look), Update does not (you
 * only wanted the library's changes, not to lose your field placement).
 *
 * What is deliberately *not* reset by default: an empty field in the library
 * does not blank the schematic's copy, because a library part with no
 * Footprint set should not wipe the footprint you assigned.
 */

import type { LibSymbol, Schematic, SchField, SchSymbol } from '../types.js';
import type { EditCommand } from './command.js';
import { wildCompare } from './global_edit_text_and_graphics.js';
import { refId } from './hittest.js';

export type ChangeSymbolsMode = 'change' | 'update';

/** Which symbols the run applies to (the dialog's top radio group). */
export type SymbolMatchMode = 'all' | 'selected' | 'reference' | 'value' | 'libId';

export interface SymbolMatch {
  mode: SymbolMatchMode;
  /** The reference/value pattern, or the library id, depending on the mode. */
  text?: string;
  selected?: ReadonlySet<string>;
}

export interface ChangeSymbolsOptions {
  mode: ChangeSymbolsMode;
  match: SymbolMatch;
  /** Change mode only: the library id to change to. */
  newLibId?: string;
  /** Field names to update (the dialog's checklist). */
  updateFields: ReadonlySet<string>;
  removeExtraFields: boolean;
  /** Let an empty library field blank the schematic's copy. Off by default. */
  resetEmptyFields: boolean;
  resetFieldText: boolean;
  resetFieldVisibilities: boolean;
  resetFieldEffects: boolean;
  resetFieldPositions: boolean;
  /** Take the library part's excluded-from-sim/BOM/board/pos-files flags. */
  resetAttributes: boolean;
  /** Not applied: show-pin-names/numbers has no per-placement home in our
   *  model (see the note in `changeSymbols`). */
  resetPinTextVisibility: boolean;
  /** Let a power symbol's Value be overwritten from the library. */
  resetCustomPower: boolean;
}

/** The dialog's default option set for each mode (TransferDataToWindow). */
export function defaultChangeSymbolsOptions(mode: ChangeSymbolsMode): ChangeSymbolsOptions {
  const change = mode === 'change';
  return {
    mode,
    match: { mode: 'all' },
    updateFields: new Set(['Reference', 'Value', 'Footprint', 'Datasheet']),
    removeExtraFields: false,
    resetEmptyFields: false,
    resetFieldText: true,
    // Change takes the new part's look; Update leaves your placement alone.
    resetFieldVisibilities: change,
    resetFieldEffects: change,
    resetFieldPositions: change,
    resetAttributes: change,
    resetPinTextVisibility: change,
    resetCustomPower: false,
  };
}

export interface ChangeSymbolsMessage {
  text: string;
  severity: 'action' | 'error';
}

export interface ChangeSymbolsResult {
  doc: Schematic;
  messages: ChangeSymbolsMessage[];
  /** How many symbols were actually processed (upstream's matchesProcessed). */
  processed: number;
}

const fieldOf = (fields: readonly SchField[], key: string): SchField | undefined =>
  fields.find((f) => f.key === key);

/** The three fields every symbol has, which are matched by canonical name. */
const MANDATORY = new Set(['Reference', 'Value', 'Footprint', 'Datasheet']);

/** `UTIL::GetRefDesPrefix`: the reference without its trailing number. */
export function refDesPrefix(ref: string): string {
  return ref.replace(/\d+$/, '').replace(/\?+$/, '');
}

/** `UTIL::GetRefDesNumber`: the trailing number, or -1. */
export function refDesNumber(ref: string): number {
  const m = /(\d+)$/.exec(ref);
  return m ? Number(m[1]) : -1;
}

/** `SCH_SYMBOL::GetLibId` comparison, which is exact rather than wildcarded. */
const sameLibId = (a: string, b: string): boolean => a === b;

/** `DIALOG_CHANGE_SYMBOLS::isMatch`. */
export function symbolMatches(sym: SchSymbol, id: string, match: SymbolMatch): boolean {
  switch (match.mode) {
    case 'all':
      return true;
    case 'selected':
      return match.selected?.has(id) ?? false;
    case 'reference':
      return wildCompare(match.text ?? '', fieldOf(sym.fields, 'Reference')?.value ?? '');
    case 'value':
      return wildCompare(match.text ?? '', fieldOf(sym.fields, 'Value')?.value ?? '');
    case 'libId':
      return sameLibId(sym.libId, match.text ?? '');
    default:
      return false;
  }
}

/** Distinct unit count of a library part (SCH_SYMBOL::GetUnitCount). */
function unitCount(lib: LibSymbol): number {
  const units = new Set(lib.units.map((u) => u.unit).filter((u) => u > 0));
  return Math.max(1, units.size);
}

/**
 * Copy the parts of a library field onto a schematic field, following the
 * dialog's four independent switches. Position and visibility are handled
 * apart from the rest because SetAttributes() would otherwise carry them along
 * — upstream saves and restores both around that call.
 */
function updateField(
  field: SchField,
  libField: SchField,
  symbolAt: { x: number; y: number },
  isPower: boolean,
  refInstances: string[],
  o: ChangeSymbolsOptions,
): SchField {
  let next = field;

  // An empty library field only overwrites when you asked it to.
  const resetText = libField.value === '' ? o.resetEmptyFields : o.resetFieldText;

  if (resetText) {
    if (field.key === 'Reference') {
      // The number is kept and only the prefix comes from the library, so
      // updating R1 against a part called "RES" gives RES1, not RES.
      const prefix = refDesPrefix(libField.value);
      const number = refDesNumber(field.value);
      next = { ...next, value: number >= 0 ? `${prefix}${number}` : `${prefix}?` };
      refInstances.push(next.value);
    } else if (field.key === 'Value') {
      // A power symbol's value *is* its net name, so it is left alone unless
      // the user explicitly asked otherwise.
      if (!isPower || o.resetCustomPower) next = { ...next, value: libField.value };
    } else {
      next = { ...next, value: libField.value };
    }
  }

  if (o.resetFieldVisibilities) {
    const hidden = libField.effects?.hidden ?? false;
    next = { ...next, effects: { ...(next.effects ?? { hidden: false }), hidden } };
  }

  if (o.resetFieldEffects) {
    // Everything the library field's text carries, except the two things the
    // other switches own: whether it is visible, and where it sits.
    const keepHidden = next.effects?.hidden ?? false;
    next = {
      ...next,
      angle: libField.angle,
      effects: { ...(libField.effects ?? { hidden: false }), hidden: keepHidden },
      ...(libField.nameShown !== undefined ? { nameShown: libField.nameShown } : {}),
      ...(libField.doNotAutoplace !== undefined ? { doNotAutoplace: libField.doNotAutoplace } : {}),
    };
  }

  if (o.resetFieldPositions && libField.at) {
    // Library field positions are relative to the symbol origin.
    next = { ...next, at: { x: symbolAt.x + libField.at.x, y: symbolAt.y + libField.at.y } };
  }

  return next;
}

/**
 * Run the dialog over one sheet. Returns the same document when nothing
 * matched, plus the message list the dialog's report panel shows.
 */
export function changeSymbols(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  opts: ChangeSymbolsOptions,
): ChangeSymbolsResult {
  const messages: ChangeSymbolsMessage[] = [];
  let processed = 0;
  let changed = false;

  const symbols = doc.symbols.map((sym, i) => {
    const id = refId('symbol', sym.uuid, i);
    if (!symbolMatches(sym, id, opts.match)) return sym;

    const ref = fieldOf(sym.fields, 'Reference')?.value ?? '?';
    const targetId = opts.mode === 'change' ? (opts.newLibId ?? '') : sym.libId;

    const lib = libById.get(targetId);
    if (!lib) {
      messages.push({
        text: `${ref}: *** symbol not found in any library ***`,
        severity: 'error',
      });
      return sym;
    }
    if (unitCount(lib) < sym.unit) {
      messages.push({ text: `${ref}: *** new symbol has too few units ***`, severity: 'error' });
      return sym;
    }

    let next: SchSymbol = sym;
    if (targetId !== sym.libId) next = { ...next, libId: targetId };

    // "Update/reset symbol attributes": take the four flags from the library
    // part. Upstream reads them off the *flattened* symbol, since a derived one
    // does not declare its own — our reader flattens them the same way.
    //
    // A library that never wrote the token leaves the attribute undefined, and
    // an undefined attribute is left alone rather than being read as an
    // explicit "no": clearing a placement's real Do-Not-Populate because an old
    // library omitted `in_bom` would be a silent data loss.
    if (opts.resetAttributes) {
      if (lib.excludedFromSim !== undefined)
        next = { ...next, excludedFromSim: lib.excludedFromSim };
      if (lib.excludedFromBom !== undefined) next = { ...next, inBom: !lib.excludedFromBom };
      if (lib.excludedFromBoard !== undefined) next = { ...next, onBoard: !lib.excludedFromBoard };
      if (lib.excludedFromPosFiles !== undefined)
        next = { ...next, excludedFromPosFiles: lib.excludedFromPosFiles };
    }

    // `resetPinTextVisibility` is still not applied. Upstream copies the
    // library's show-pin-names/numbers onto the placement, but SCH_SYMBOL keeps
    // those on its *own* LIB_SYMBOL clone (`GetShowPinNames()` is
    // `m_part->GetShowPinNames()`), one per placement. We share a single
    // embedded definition per lib_id across every placement of that part, so
    // there is nowhere to put a per-placement answer — writing it would change
    // pin visibility on placements the dialog never matched.

    const libFields = lib.properties;
    const refInstances: string[] = [];
    let fields = next.fields;

    // Existing fields: update the ones on the list, drop the extras.
    const kept: SchField[] = [];
    for (const f of fields) {
      const wanted = opts.updateFields.has(f.key);
      const libField = libFields.find((lf) => lf.key === f.key);
      if (!wanted) {
        kept.push(f);
        continue;
      }
      if (libField) {
        kept.push(updateField(f, libField, next.at, lib.isPower, refInstances, opts));
        continue;
      }
      // A field the new part does not have at all.
      if (!MANDATORY.has(f.key) && opts.removeExtraFields) continue;
      kept.push(f);
    }

    // …then the library's own extra fields the schematic does not have yet.
    for (const lf of libFields) {
      if (MANDATORY.has(lf.key)) continue;
      if (!opts.updateFields.has(lf.key)) continue;
      if (kept.some((f) => f.key === lf.key)) continue;
      kept.push({
        ...lf,
        at: lf.at ? { x: next.at.x + lf.at.x, y: next.at.y + lf.at.y } : undefined,
      });
    }

    fields = kept;
    if (fields.length !== next.fields.length || fields.some((f, k) => f !== next.fields[k]))
      next = { ...next, fields };

    if (next === sym) return sym;
    changed = true;
    processed++;
    messages.push({
      text:
        opts.mode === 'change'
          ? `${ref}: ${sym.libId} -> ${targetId}: OK`
          : `${ref}: ${sym.libId}: OK`,
      severity: 'action',
    });
    return next;
  });

  if (!changed) {
    if (messages.length === 0)
      messages.push({ text: '*** No symbols matching criteria found ***', severity: 'error' });
    return { doc, messages, processed };
  }

  // The schematic's own copy of the library part is replaced too, so the file
  // stops carrying the old definition (upstream's SetLibSymbol on a flattened
  // copy, done before the symbol is re-appended to the screen).
  const libSymbols = [...doc.libSymbols];
  const wanted = new Set(symbols.map((s) => s.libId));
  for (const id of wanted) {
    const lib = libById.get(id);
    if (!lib) continue;
    const at = libSymbols.findIndex((l) => l.libId === id);
    if (at === -1) libSymbols.push(lib);
    else libSymbols[at] = lib;
  }

  return { doc: { ...doc, symbols, libSymbols }, messages, processed };
}

/** The undoable form: null when nothing was processed. */
export function changeSymbolsCommand(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  opts: ChangeSymbolsOptions,
): { command: EditCommand | null; messages: ChangeSymbolsMessage[]; processed: number } {
  const { doc: after, messages, processed } = changeSymbols(doc, libById, opts);
  if (after === doc) return { command: null, messages, processed };
  const label = opts.mode === 'change' ? 'Change Symbols' : 'Update Symbols from Library';
  const make = (target: Schematic): EditCommand => ({
    label,
    apply: () => target,
    invert: (before: Schematic) => make(before),
  });
  return { command: make(after), messages, processed };
}
