// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The reference model and numbering core — `eeschema/sch_reference_list.cpp`
 * (`SCH_REFERENCE::Split`, `SCH_REFERENCE_LIST::Annotate` / `AnnotateByOptions`
 * / `CheckAnnotation`, plus the `ANNOTATE_ORDER_T` / `ANNOTATE_ALGO_T` /
 * `ANNOTATE_SCOPE_T` enums the header declares).
 *
 * `SCH_EDIT_FRAME::AnnotateSymbols` (`eeschema/annotate.ts`) is one call into
 * `Annotate`/`AnnotateByOptions` here — upstream is two functions, one on each
 * side of that call, and stays that way; our port made the frame-side wrapper
 * ({@link annotateSymbols}, the single-sheet form) and the numbering core
 * ({@link annotateHierarchy}) live in this one file because there is no
 * separate `SCH_REFERENCE_LIST` object here to build and hand across — a
 * schematic's symbols are collected, sorted, and renumbered in one pass. What
 * moved here is exactly upstream's *numbering* surface: `Split` (as
 * {@link splitReference}), `Annotate`/`AnnotateByOptions`
 * ({@link annotateHierarchy}) and `CheckAnnotation` ({@link checkAnnotation}).
 * `SCH_REFERENCE_LIST`'s bookkeeping methods with no numbering role —
 * `RemoveItem`, `Contains`, `FindItem`, the `sortBy*` comparators as
 * standalone functions, `FindRefByFullPath`, `GetSymbolInstances`, `Show` —
 * have no counterpart: there is no persistent `SCH_REFERENCE_LIST` instance to
 * hang them on, so their work is inlined into {@link annotateHierarchy}'s own
 * sort and reservation-map passes instead.
 *
 * `SCH_EDIT_FRAME::AnnotateSymbols`/`DeleteAnnotation`/`CheckAnnotate` (the
 * commands, undo wiring, and Annotation Messages report loop) stay in
 * `annotate.ts`, which imports the numbering core from here.
 */

import type { SchField, SchSymbol, Schematic, LibSymbol } from './types.js';
import type { RefDesTracker } from './refdes_tracker.js';
import { refId } from './tools/hittest.js';
import { str } from '@ziroeda/sexpr';
import type { SList } from '@ziroeda/sexpr';
import { Reporter, RPT_SEVERITY_ERROR, type ReportLine } from '@ziroeda/common/reporter.js';

/** ANNOTATE_ORDER_T. */
export type AnnotateOrder = 'x' | 'y' | 'unsorted';
/** ANNOTATE_ALGO_T. */
export type AnnotateAlgo = 'incremental' | 'sheet_100' | 'sheet_1000';
/** ANNOTATE_SCOPE_T. */
export type AnnotateScope = 'all' | 'current_sheet' | 'selection';

export interface AnnotateOptions {
  scope: AnnotateScope;
  order: AnnotateOrder;
  algo: AnnotateAlgo;
  /** aResetAnnotation: clear existing numbers and reassign from scratch. */
  resetExisting: boolean;
  /** aStartNumber (incremental algo only); the first assigned number is +1. */
  startNumber: number;
  /**
   * `aStartAtCurrent` (SCH_REFERENCE_LIST::Annotate): a reference that already
   * carries a number restarts the search at that number rather than at
   * `startNumber + 1`, so a re-annotated R5 stays R5 when 5 is free and becomes
   * R6 when it is not — it never drops back to R1.
   *
   * `ReannotateDuplicates` (sch_reference_list.cpp:359) is the only caller that
   * passes it, which is why paste's duplicate pass keeps numbers near where the
   * user copied them. `AnnotateByOptions` forces it off for the sheet-× algos
   * (`aStartAtCurrent = false; // Not implemented for sheet # * 100`), so it is
   * ignored there here too.
   */
  startAtCurrent?: boolean;
  /** The current sheet's number for the sheet-× algos; defaults to 1. */
  sheetNumber?: number;
  /** aRegroupUnits: don't collect the locked (already-shared) multi-unit sets,
   *  so units regroup freely by placement. Only meaningful with resetExisting. */
  regroupUnits?: boolean;
  /**
   * `SYMBOL_FILTER_T`: whether power symbols are numbered too.
   *
   * KiCad passes `SYMBOL_FILTER_NON_POWER` from the Annotate dialog, and
   * `SYMBOL_FILTER_ALL` when a newly placed symbol is annotated
   * (`sch_drawing_tools.cpp`), which is how a power symbol gets its `#PWR01`
   * without ever appearing in the dialog's report. Defaults to the dialog's
   * filter, so nothing changes for the paths that had no such option.
   */
  includePower?: boolean;
  /** REFDES_TRACKER (schematic.used_designators): with reuseRefDes false,
   *  previously-used-but-freed numbers are skipped; every accepted number is
   *  recorded (GetNextRefDesForUnits' m_allRefDes gate + insert). */
  tracker?: RefDesTracker;
}

/**
 * One sheet taking part in an annotation pass, a SCH_SHEET_PATH plus its
 * screen. `scope` says how the pass treats it: 'full' annotates every symbol
 * (a sheet inside the scope), 'selected' only the selected ones (the current
 * sheet under ANNOTATE_SELECTION), and 'out' none, those symbols only reserve
 * their numbers, upstream's additionalRefs.
 */
export interface AnnotateSheet {
  /** Sheet file name; the key new symbol lists are returned under. */
  file: string;
  doc: Schematic;
  /** 1-based virtual page number in hierarchy order (SetSheetNumberAndCount). */
  sheetNumber: number;
  scope: 'full' | 'selected' | 'out';
}

/** `R12` → { prefix: 'R', num: 12 }; `R?` / `R` → { prefix: 'R' }
 *  (SCH_REFERENCE::Split). */
export function splitReference(ref: string): { prefix: string; num?: number } {
  const m = /^(.*?)(\d+)$/.exec(ref);
  if (m) return { prefix: m[1]!, num: Number(m[2]) };
  return { prefix: ref.replace(/\?+$/, '') };
}

export const referenceOf = (s: SchSymbol): SchField | undefined =>
  s.fields.find((f) => f.key === 'Reference');

/** Distinct unit count of a symbol's library part (SCH_SYMBOL::GetUnitCount). */
export function unitCount(libId: string, libById: ReadonlyMap<string, LibSymbol>): number {
  const lib = libById.get(libId);
  if (!lib) return 1;
  const units = new Set(lib.units.map((u) => u.unit).filter((u) => u > 0));
  return Math.max(1, units.size);
}

export const setFieldValue = (f: SchField, value: string): SchField => {
  const items = f.source.items.slice();
  items[2] = str(value);
  return { ...f, value, source: { kind: 'list', items } as SList };
};

interface Candidate {
  file: string;
  index: number;
  sheetNumber: number;
  sym: SchSymbol;
  prefix: string;
  num?: number;
  isNew: boolean;
  multiUnit: boolean;
  /** Original full reference (prefix+num) for multi-unit grouping, if numbered. */
  origFull?: string;
}

/** One unit's claim on a shared reference number (REFDES_TRACKER's view of a
 *  multi-unit occupant: library id + value + unit). */
interface UnitRec {
  lib: string;
  value: string;
  unit: number;
}

/**
 * Compute the new symbols array with references (re)assigned per `opts`.
 * `selectedIds` is required for scope 'selection'. Returns the same array
 * reference when nothing changes. The single-sheet form of
 * {@link annotateHierarchy}.
 */
export function annotateSymbols(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  opts: AnnotateOptions,
  selectedIds?: ReadonlySet<string>,
): readonly SchSymbol[] {
  const sheet: AnnotateSheet = {
    file: '',
    doc,
    sheetNumber: opts.sheetNumber ?? 1,
    scope: opts.scope === 'selection' ? 'selected' : 'full',
  };
  return annotateHierarchy([sheet], libById, opts, selectedIds).get('') ?? doc.symbols;
}

/**
 * Annotate across a hierarchy: one numbering pass over every sheet, returning
 * the new symbol list of each sheet whose symbols changed (SCH_EDIT_FRAME::
 * AnnotateSymbols over the SCH_REFERENCE_LIST built from the sheet list).
 */
export function annotateHierarchy(
  sheets: readonly AnnotateSheet[],
  libById: ReadonlyMap<string, LibSymbol>,
  opts: AnnotateOptions,
  selectedIds?: ReadonlySet<string>,
): Map<string, readonly SchSymbol[]> {
  const result = new Map<string, readonly SchSymbol[]>();
  const candidates: Candidate[] = [];
  const symbolValue = (s: SchSymbol): string =>
    s.fields.find((f) => f.key === 'Value')?.value ?? '';
  // prefix → number → occupants. 'full' = a single-unit symbol owns the number
  // outright; a UnitRec list = multi-unit occupants that may share it.
  const reserved = new Map<string, Map<number, 'full' | UnitRec[]>>();
  const reserve = (prefix: string, n: number, rec?: UnitRec): void => {
    let nums = reserved.get(prefix);
    if (!nums) {
      nums = new Map();
      reserved.set(prefix, nums);
    }
    const cur = nums.get(n);
    if (!rec || cur === 'full') nums.set(n, 'full');
    else if (!cur) nums.set(n, [rec]);
    else cur.push(rec);
  };
  const unitRecOf = (sym: SchSymbol): UnitRec => ({
    lib: sym.libId,
    value: symbolValue(sym),
    unit: sym.unit,
  });

  for (const sheet of sheets) {
    sheet.doc.symbols.forEach((sym, index) => {
      const ref = referenceOf(sym);
      if (!ref) return;
      const { prefix, num } = splitReference(ref.value);
      // Power and flag symbols keep their references unless the caller asked
      // for SYMBOL_FILTER_ALL. Note this returns before the reservation below,
      // so with the filter on they also start reserving their numbers, which is
      // what stops a second #PWR being handed one that is taken.
      if (prefix.startsWith('#') && !opts.includePower) return;
      const multiUnit = unitCount(sym.libId, libById) > 1;
      const inScope =
        sheet.scope === 'full' ||
        (sheet.scope === 'selected' && !!selectedIds?.has(refId('symbol', sym.uuid, index)));
      if (!inScope) {
        // Out-of-scope symbols reserve their numbers (additionalRefs).
        if (num !== undefined) reserve(prefix, num, multiUnit ? unitRecOf(sym) : undefined);
        return;
      }
      const isNew = opts.resetExisting || num === undefined;
      candidates.push({
        file: sheet.file,
        index,
        sheetNumber: sheet.sheetNumber,
        sym,
        prefix,
        num,
        isNew,
        multiUnit,
        origFull: num !== undefined ? `${prefix}${num}` : undefined,
      });
      // A kept (not-new) reference reserves its number.
      if (!isNew && num !== undefined) reserve(prefix, num, multiUnit ? unitRecOf(sym) : undefined);
    });
  }

  if (candidates.length === 0) return result;

  // Sort by prefix, then sheet number, then position (x-then-y or y-then-x),
  // then uuid, the SCH_REFERENCE_LIST::sortByXPosition / sortByYPosition
  // comparators. Unsorted keeps document collection order.
  const ordered = candidates.slice();
  if (opts.order !== 'unsorted') {
    const primary = opts.order === 'x' ? 'x' : 'y';
    const secondary = opts.order === 'x' ? 'y' : 'x';
    ordered.sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix < b.prefix ? -1 : 1;
      if (a.sheetNumber !== b.sheetNumber) return a.sheetNumber - b.sheetNumber;
      if (a.sym.at[primary] !== b.sym.at[primary]) return a.sym.at[primary] - b.sym.at[primary];
      if (a.sym.at[secondary] !== b.sym.at[secondary])
        return a.sym.at[secondary] - b.sym.at[secondary];
      return (a.sym.uuid ?? '') < (b.sym.uuid ?? '') ? -1 : 1;
    });
  }

  // The sheet-× algos number from the symbol's own sheet (SCH_REFERENCE's
  // m_sheetNum), so sheet 2's parts start at 201 while sheet 1's start at 101.
  const minRefId = (c: Candidate): number => {
    switch (opts.algo) {
      case 'sheet_100':
        return c.sheetNumber * 100 + 1;
      case 'sheet_1000':
        return c.sheetNumber * 1000 + 1;
      default:
        // `if( aStartAtCurrent && ref_unit.m_numRef > 0 ) minRefId = ref_unit.m_numRef;`
        // — the search starts at the number the reference already carries.
        return opts.startAtCurrent && c.num !== undefined && c.num > 0
          ? c.num
          : opts.startNumber + 1;
    }
  };
  // REFDES_TRACKER::GetNextRefDesForUnits + areUnitsAvailable: the first
  // number ≥ min that is either unused, or (for a multi-unit symbol) occupied
  // only by units of the same library symbol and value with every required
  // unit slot still free, so two fresh ECC83 halves become U1A and U1B.
  const tracker = opts.tracker;
  const accept = (prefix: string, n: number): boolean => {
    // GetNextRefDesForUnits: a number not currently in use is taken only when
    // reuse is allowed or it was never used before; acceptance records it.
    if (tracker && !tracker.reuseRefDes && tracker.contains(`${prefix}${n}`)) return false;
    tracker?.insert(`${prefix}${n}`);
    return true;
  };
  const firstFree = (
    prefix: string,
    min: number,
    forUnits?: { lib: string; value: string; units: readonly number[] },
  ): number => {
    const nums = reserved.get(prefix);
    for (let n = min; ; n++) {
      const cur = nums?.get(n);
      if (!cur) {
        if (accept(prefix, n)) return n;
        continue;
      }
      if (cur === 'full' || !forUnits) continue;
      const free = forUnits.units.every((u) =>
        cur.every((r) => r.lib === forUnits.lib && r.value === forUnits.value && r.unit !== u),
      );
      // A number already in use by compatible units is shared, not newly
      // issued, the tracker records it without gating (it is "currently in
      // use", the branch upstream takes through areUnitsAvailable).
      if (free) {
        tracker?.insert(`${prefix}${n}`);
        return n;
      }
    }
  };

  // Multi-unit symbols that already shared a full reference keep sharing a
  // number (the aLockedUnitMap path): the group is renumbered together, onto
  // a number with room for all of its units. Regrouping skips the map so units
  // are free to re-pair by placement, and a reset drops any group that holds
  // the same unit twice (upstream's conflictingRefs sweep).
  const groupUnits = new Map<string, number[]>(); // origFull → member units
  if (!opts.regroupUnits) {
    for (const c of ordered) {
      if (c.isNew && c.multiUnit && c.origFull) {
        const arr = groupUnits.get(c.origFull) ?? [];
        arr.push(c.sym.unit);
        groupUnits.set(c.origFull, arr);
      }
    }
    if (opts.resetExisting) {
      for (const [ref, units] of groupUnits) {
        if (new Set(units).size !== units.length) groupUnits.delete(ref);
      }
    }
  }
  const grouped = (c: Candidate): string | undefined =>
    c.multiUnit && c.origFull && groupUnits.has(c.origFull) ? c.origFull : undefined;
  const groupNumber = new Map<string, number>(); // origFull → assigned number

  // file → (symbol index → new reference)
  const newRefFor = new Map<string, Map<number, string>>();
  for (const c of ordered) {
    if (!c.isNew) continue;
    const group = grouped(c);
    let n: number;
    if (group !== undefined && groupNumber.has(group)) {
      n = groupNumber.get(group)!;
    } else if (c.multiUnit) {
      const units = group !== undefined ? groupUnits.get(group)! : [c.sym.unit];
      n = firstFree(c.prefix, minRefId(c), {
        lib: c.sym.libId,
        value: symbolValue(c.sym),
        units,
      });
      if (group !== undefined) groupNumber.set(group, n);
    } else {
      n = firstFree(c.prefix, minRefId(c));
    }
    reserve(c.prefix, n, c.multiUnit ? unitRecOf(c.sym) : undefined);
    let perFile = newRefFor.get(c.file);
    if (!perFile) {
      perFile = new Map();
      newRefFor.set(c.file, perFile);
    }
    perFile.set(c.index, `${c.prefix}${n}`);
  }

  for (const sheet of sheets) {
    const perFile = newRefFor.get(sheet.file);
    if (!perFile || perFile.size === 0) continue;
    let changed = false;
    const next = sheet.doc.symbols.map((sym, i) => {
      const newRef = perFile.get(i);
      if (newRef === undefined) return sym;
      const ref = referenceOf(sym);
      if (!ref || ref.value === newRef) return sym;
      changed = true;
      return {
        ...sym,
        fields: sym.fields.map((f) => (f.key === 'Reference' ? setFieldValue(f, newRef) : f)),
      };
    });
    if (changed) result.set(sheet.file, next);
  }
  return result;
}

/** SCH_SYMBOL::SubReference, 1 → "A", 2 → "B"… (the default notation). */
export const defaultSubReference = (unit: number): string => {
  let suffix = '';
  let n = unit;
  do {
    const u = (n - 1) % 26;
    suffix = String.fromCharCode(65 + u) + suffix;
    n = Math.trunc((n - u) / 26);
  } while (n > 0);
  return suffix;
};

/** SCH_SYMBOL::IsAnnotated, a reference with a number and no '?' placeholder. */
export function isAnnotated(ref: string): boolean {
  if (ref.includes('?')) return false;
  return splitReference(ref).num !== undefined;
}

export const symValue = (sym: SchSymbol): string =>
  sym.fields.find((f) => f.key === 'Value')?.value ?? '';
export const refOf = (sym: SchSymbol): string => referenceOf(sym)?.value ?? '';

/**
 * SCH_REFERENCE_LIST::CheckAnnotation, the final control pass: the first
 * un-annotated symbol or over-range unit, then every duplicated reference,
 * differing unit count and differing value among units of one reference.
 * Power symbols are left out: this build never renumbers them.
 */
export function checkAnnotation(
  docs: readonly Schematic[],
  libById: ReadonlyMap<string, LibSymbol>,
  subReference: (unit: number) => string = defaultSubReference,
): ReportLine[] {
  const reporter = new Reporter();
  interface Entry {
    prefix: string;
    num?: number;
    unit: number;
    units: number;
    value: string;
    isNew: boolean;
  }
  const list: Entry[] = [];
  for (const doc of docs) {
    for (const sym of doc.symbols) {
      const ref = refOf(sym);
      if (!ref) continue;
      const { prefix, num } = splitReference(ref);
      if (prefix.startsWith('#')) continue;
      list.push({
        prefix,
        num,
        unit: sym.unit,
        units: unitCount(sym.libId, libById),
        value: symValue(sym),
        isNew: !isAnnotated(ref),
      });
    }
  }
  if (list.length === 0) return reporter.lines;

  // SortByRefAndValue: reference prefix, then number, then value, then unit.
  list.sort(
    (a, b) =>
      (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0) ||
      (a.num ?? -1) - (b.num ?? -1) ||
      (a.value < b.value ? -1 : a.value > b.value ? 1 : 0) ||
      a.unit - b.unit,
  );

  for (const e of list) {
    if (e.isNew) {
      const tmp = e.num !== undefined ? String(e.num) : '?';
      reporter.report(
        e.unit > 0 && e.units > 1
          ? `Item not annotated: ${e.prefix}${tmp} (unit ${e.unit})`
          : `Item not annotated: ${e.prefix}${tmp}`,
        RPT_SEVERITY_ERROR,
      );
      break;
    }
    if (Math.max(e.units, 1) < e.unit) {
      const tmp = e.num !== undefined ? String(e.num) : '?';
      reporter.report(
        `Error: symbol ${e.prefix}${tmp}${subReference(e.unit)} (unit ${e.unit}) exceeds units defined (${e.units})`,
        RPT_SEVERITY_ERROR,
      );
      break;
    }
  }

  for (let i = 0; i < list.length - 1; i++) {
    const first = list[i]!;
    const second = list[i + 1]!;
    if (first.prefix !== second.prefix || first.num !== second.num) continue;
    const tmp = first.num !== undefined ? String(first.num) : '?';

    if (first.unit === second.unit) {
      reporter.report(
        `Duplicate items ${first.prefix}${tmp}${first.units > 1 ? subReference(first.unit) : ''}`,
        RPT_SEVERITY_ERROR,
      );
      continue;
    }
    if (first.units !== second.units) {
      const tmp2 = second.num !== undefined ? String(second.num) : '?';
      reporter.report(
        `Differing unit counts for item ${first.prefix}${tmp}${subReference(first.unit)} and ` +
          `${second.prefix}${tmp2}${subReference(second.unit)}`,
        RPT_SEVERITY_ERROR,
      );
      continue;
    }
    if (first.value !== second.value) {
      reporter.report(
        `Different values for ${first.prefix}${first.num}${subReference(first.unit)} (${first.value}) and ` +
          `${second.prefix}${second.num}${subReference(second.unit)} (${second.value})`,
        RPT_SEVERITY_ERROR,
      );
    }
  }

  return reporter.lines;
}
