// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Symbol Library Links. Counterpart:
 * `eeschema/dialogs/dialog_edit_symbols_libid.cpp` (DIALOG_EDIT_SYMBOLS_LIBID).
 *
 * A schematic keeps a copy of every symbol it uses, so it still opens and
 * still prints when the libraries behind it have moved, been renamed, or are
 * simply not installed on this machine. What it cannot do is *update* those
 * symbols, because the link is broken. This dialog is where the links are
 * repaired: one row per distinct library id, listing the references that use
 * it, and a column for what it should say instead.
 *
 * A symbol whose library part cannot be found at all is an "orphan" and is
 * marked; the Map Orphans button tries to re-point each one by searching every
 * loaded library for a part of the same name. That usually works, because the
 * common cause is a library that was renamed or re-nicknamed rather than a
 * part that vanished.
 */

import { Reporter } from '@ziroeda/common/src/reporter.js';
import type { LibSymbol, Schematic, SchField, SchSymbol } from '../types.js';
import { flattenLibSymbol } from '../lib_symbol.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

/**
 * The characters `LIB_ID::isLegalChar` (common/lib_id.cpp) answers false for:
 * `:`, tab, newline and carriage return outright, and `\`, `<`, `>`, `"`
 * because `illegal_filename_chars_allowed` is a `bool const … = false` beside
 * the `space_allowed = true` that lets a space through.
 *
 * One table, read by both {@link isValidLibId} and {@link libIdParseOffset}.
 * LIB_ID itself is `common/`, and both of these belong in `common/src` the day
 * it is ported; until then the point of the rule is served by there being a
 * single copy of the set rather than one per caller.
 */
const FORBIDDEN = '<>"\\:\t\n\r';

/** One row of the grid: every symbol sharing a library id. */
export interface LibIdRow {
  /** The library id these symbols currently point at. */
  current: string;
  /** Their references, in schematic order, each listed once. */
  references: string[];
  /** No library part of this id could be found (SCH_SYMBOL::GetUnitCount() == 0). */
  orphan: boolean;
  /** refIds of the symbols in the row, which is what an edit is applied to. */
  symbolIds: string[];
}

const fieldOf = (fields: readonly SchField[], key: string): SchField | undefined =>
  fields.find((f) => f.key === key);

/** The item-name half of a library id ("Device:R" -> "R"). */
export function libItemName(libId: string): string {
  const i = libId.indexOf(':');
  return i === -1 ? libId : libId.slice(i + 1);
}

/** The nickname half ("Device:R" -> "Device"); '' when there is no nickname. */
export function libNickname(libId: string): string {
  const i = libId.indexOf(':');
  return i === -1 ? '' : libId.slice(0, i);
}

/**
 * `LIB_ID::HasIllegalChars`: **the offset of the first character a LIB_ID part
 * may not contain, or -1 when there is none.**
 *
 * The sign convention is upstream's and the rescuer reads it as a flag rather
 * than a position — `if( LIB_ID::HasIllegalChars( … ) == -1 )` guards the two
 * skips that would otherwise drop a symbol whose only fault is its name.
 */
export function libItemNameIllegalCharOffset(name: string): number {
  for (let i = 0; i < name.length; i++) if (FORBIDDEN.includes(name[i]!)) return i;
  return -1;
}

/**
 * `LIB_ID::Parse` followed by `IsValid`: a nickname and an item name, split by
 * the one colon they are allowed between them, and no forbidden characters in
 * either. This is why a colon is forbidden *inside* the parts — it is the
 * separator, so a second one is not a character, it is a parse error.
 */
export function isValidLibId(id: string): boolean {
  const at = id.indexOf(':');
  if (at <= 0 || at === id.length - 1) return false;
  const nickname = id.slice(0, at);
  const name = id.slice(at + 1);
  const clean = (s: string): boolean => ![...s].some((c) => FORBIDDEN.includes(c));
  return clean(nickname) && clean(name);
}

/**
 * `LIB_ID::Parse( aId, aFix = false )` on its own, without the `IsValid` that
 * {@link isValidLibId} folds in: **the offset of the first character that stops
 * the id being parseable, or -1 when it parses.**
 *
 * The odd return value is upstream's, and every call site tests its sign —
 * `if( fpid.Parse( data.GetText() ) >= 0 ) return 0;` in
 * `CVPCB_ASSOCIATION_TOOL::PasteAssoc`. Keeping the shape rather than returning
 * a boolean is what makes that line transcribable instead of re-derived.
 *
 * Two things it deliberately accepts that `isValidLibId` rejects, because
 * `Parse` and `IsValid` are separate questions upstream and the paste path asks
 * only the first:
 *
 *  - **no colon at all.** `Parse` leaves `partNdx` at 0 and the whole string is
 *    the item name, which is `IsLegacy()`, not invalid.
 *  - **the empty string**, for the same reason: `HasIllegalChars( "" )` returns
 *    -1, `SetLibItemName( "" )` cannot fail, so `Parse( "" )` succeeds and
 *    leaves an empty LIB_ID behind.
 *
 * Only the item name is checked, which is also upstream: the nickname goes
 * through `checkLibNickname`, and that is `aField.find_first_of( ":" )` alone —
 * a test the substring before the *first* colon can never fail.
 *
 * The offset counts UTF-16 code units where upstream counts UTF-8 bytes; the
 * two agree on -1, which is all any caller reads.
 */
export function libIdParseOffset(id: string): number {
  const at = id.indexOf(':');
  const name = at === -1 ? id : id.slice(at + 1);
  const chars = [...name];
  for (let i = 0; i < chars.length; i++) {
    if (FORBIDDEN.includes(chars[i]!)) return i;
  }
  return -1;
}

/**
 * The grid, as `initDlg` builds it: symbols grouped by library id, the groups
 * sorted by that id, and each group's references listed in the order they were
 * found.
 */
export function symbolLibIdRows(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
): LibIdRow[] {
  const byLibId = new Map<string, LibIdRow>();

  doc.symbols.forEach((sym, i) => {
    const id = refId('symbol', sym.uuid, i);
    const ref = fieldOf(sym.fields, 'Reference')?.value ?? '';
    let row = byLibId.get(schSymbolLibraryName(sym));
    if (!row) {
      row = {
        current: sym.libId,
        references: [],
        // A symbol with no library part behind it has no units to draw.
        orphan: !libById.has(sym.libId),
        symbolIds: [],
      };
      byLibId.set(sym.libId, row);
    }
    // The same reference can appear more than once in a hierarchy (one entry
    // per sheet instance); it is listed once.
    if (ref !== '' && !row.references.includes(ref)) row.references.push(ref);
    row.symbolIds.push(id);
  });

  return [...byLibId.values()].sort((a, b) =>
    a.current < b.current ? -1 : a.current > b.current ? 1 : 0,
  );
}

/**
 * `onClickOrphansButton`: the library ids that carry a part of this name.
 *
 * The search is by item name across every loaded library, because a broken
 * link is nearly always a library that was renamed rather than a part that was
 * deleted. More than one hit is genuine ambiguity — upstream asks which one —
 * so all of them are returned in library order and the caller decides.
 */
export function orphanCandidates(
  currentLibId: string,
  libById: ReadonlyMap<string, LibSymbol>,
): string[] {
  const name = libItemName(currentLibId);
  const out: string[] = [];
  for (const libId of libById.keys()) {
    if (libItemName(libId) === name && libId !== currentLibId) out.push(libId);
  }
  return out.sort();
}

export interface LibIdChangeResult {
  doc: Schematic;
  /** How many symbols were re-pointed. */
  changed: number;
  errors: string[];
}

/**
 * Apply the grid's edits: `changes` maps a current library id to the new one.
 *
 * Two things travel with the link. The schematic's own copy of the part is
 * replaced, so the file stops carrying a definition nothing points at; and a
 * Value field that was only ever echoing the part's name follows the rename,
 * because that value was never a value the user typed — it is what a symbol
 * gets when it is placed and left alone.
 */
export function applyLibIdChanges(
  doc: Schematic,
  librarySymbols: ReadonlyMap<string, LibSymbol>,
  changes: ReadonlyMap<string, string>,
): LibIdChangeResult {
  const errors: string[] = [];
  let changed = 0;

  // `candidate.m_Symbol->SetLibSymbol( symbol->Flatten().release() )`
  // (dialog_edit_symbols_libid.cpp:766): re-pointing a placement caches the
  // flattened part, never the derived one — the schematic has nowhere to put
  // the parent it would otherwise need.
  const reporter = new Reporter();
  const libById = new Map<string, LibSymbol>();
  for (const [id, lib] of librarySymbols) libById.set(id, flattenLibSymbol(lib, reporter));
  for (const line of reporter.lines) if (!errors.includes(line.message)) errors.push(line.message);

  const symbols = doc.symbols.map((sym) => {
    const next = changes.get(schSymbolLibraryName(sym));
    if (next === undefined || next === '' || next === sym.libId) return sym;

    if (!isValidLibId(next)) {
      const msg = `Symbol library identifier ${next} is not valid.`;
      if (!errors.includes(msg)) errors.push(msg);
      return sym;
    }

    const lib = libById.get(next);
    if (!lib) {
      const msg = `Error loading symbol ${libItemName(next)} from library ${libNickname(next)}.`;
      if (!errors.includes(msg)) errors.push(msg);
      return sym;
    }

    changed++;
    let out: SchSymbol = { ...sym, libId: next };

    // A Value that is a proxy for the part's name follows the new name.
    const value = fieldOf(sym.fields, 'Value');
    if (value && value.value === libItemName(sym.libId)) {
      out = {
        ...out,
        fields: out.fields.map((f) => (f === value ? { ...f, value: libItemName(next) } : f)),
      };
    }
    return out;
  });

  if (changed === 0) return { doc, changed, errors };

  // Re-point the schematic's embedded library copies at the new parts, and drop
  // the definitions nothing uses any more.
  const used = new Set(symbols.map((s) => s.libId));
  const libSymbols = doc.libSymbols.filter((l) => used.has(l.libId));
  for (const id of used) {
    if (libSymbols.some((l) => l.libId === id)) continue;
    const lib = libById.get(id);
    if (lib) libSymbols.push(lib);
  }

  return { doc: { ...doc, symbols, libSymbols }, changed, errors };
}

/** The undoable form: null when no symbol was re-pointed. */
export function libIdChangeCommand(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  changes: ReadonlyMap<string, string>,
): { command: EditCommand | null; changed: number; errors: string[] } {
  const { doc: after, changed, errors } = applyLibIdChanges(doc, libById, changes);
  if (after === doc) return { command: null, changed, errors };
  const label = 'Change Symbol Library Identifier';
  const make = (target: Schematic): EditCommand => ({
    label,
    apply: () => target,
    invert: (before: Schematic) => make(before),
  });
  return { command: make(after), changed, errors };
}
