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
import type { REFDES_TRACKER } from './refdes_tracker.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { ERCE_T } from './erc/erc_settings.js';
import type { LIB_SYMBOL } from './lib_symbol.js';
import { SCH_SHEET_PATH, SCH_SYMBOL_INSTANCE, type SCH_SHEET_LIST } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
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
  tracker?: REFDES_TRACKER;
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
    if (tracker && !tracker.GetReuseRefDes() && tracker.Contains(`${prefix}${n}`)) return false;
    tracker?.Insert(`${prefix}${n}`);
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
        tracker?.Insert(`${prefix}${n}`);
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

// =========================================================================================
// The live model (eeschema stage S2-1): `SCH_REFERENCE` and `SCH_REFERENCE_LIST` from
// sch_reference_list.h/.cpp, over live SCH_SYMBOLs and SCH_SHEET_PATHs. The record functions
// above stay until their callers switch.
// =========================================================================================

/** Schematic annotation scope options. */
export enum ANNOTATE_SCOPE_T {
  ANNOTATE_ALL, ///< Annotate the full schematic
  ANNOTATE_CURRENT_SHEET, ///< Annotate the current sheet
  ANNOTATE_SELECTION, ///< Annotate the selection
}

/** Schematic annotation order options. */
export enum ANNOTATE_ORDER_T {
  SORT_BY_X_POSITION, ///< Annotate by X position from left to right.
  SORT_BY_Y_POSITION, ///< Annotate by Y position from top to bottom.
  UNSORTED, ///< Annotate by position of symbol in the schematic sheet object list.
}

/** Schematic annotation type options. */
export enum ANNOTATE_ALGO_T {
  INCREMENTAL_BY_REF, ///< Annotate incrementally using the first free reference number.
  SHEET_NUMBER_X_100, ///< First free reference number starting at the sheet number * 100.
  SHEET_NUMBER_X_1000, ///< First free reference number starting at the sheet number * 1000.
}

/** `wxString::Cmp`: by code unit. */
const wxCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `wxString::CmpNoCase`: by code unit after `wxTolower` on each character. */
const wxCmpNoCase = (a: string, b: string): number => wxCmp(a.toLowerCase(), b.toLowerCase());

const isdigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/**
 * `SCH_REFERENCE`: a symbol's reference designator on one sheet path. A C++ value type -
 * lists hold copies - so lists clone what they are given (`Clone`).
 */
export class SCH_REFERENCE {
  /// Symbol reference prefix, without number (for IC1, this is IC) )
  m_ref = '';
  m_rootSymbol: SCH_SYMBOL | null = null; ///< The symbol associated the reference object.
  m_symbolPos: VECTOR2I = { x: 0, y: 0 }; ///< The physical position of the symbol in schematic
  m_unit = 0; ///< The unit number for symbol with multiple parts per package.
  m_value = ''; ///< The symbol value.
  m_footprint = ''; ///< The footprint assigned.
  m_sheetPath = new SCH_SHEET_PATH(); ///< The sheet path for this reference.
  m_isNew = false; ///< True if not yet annotated.
  m_sheetNum = 0; ///< The sheet number for the reference.
  m_symbolUuid: KIID = ''; ///< UUID of the symbol.
  m_numRef = 0; ///< The numeric part of the reference designator.
  m_numRefStr = ''; ///< The numeric part in original string form (may have leading zeroes).
  m_flag = 0;

  /** `SCH_REFERENCE( SCH_SYMBOL*, const SCH_SHEET_PATH& )` (sch_reference_list.cpp). */
  constructor(aSymbol?: SCH_SYMBOL, aSheetPath?: SCH_SHEET_PATH) {
    if (!aSymbol || !aSheetPath) return;

    this.m_rootSymbol = aSymbol;

    // Ensure the symbol has instance data for the current sheet path so that the unit selection
    // remains consistent even when loading a sheet without symbol instance records (for example
    // when editing a subsheet directly).
    const instance = new SCH_SYMBOL_INSTANCE();

    if (!aSymbol.GetInstance(instance, aSheetPath.Path(), false)) {
      instance.m_Path = aSheetPath.Path();
      instance.m_Reference = aSymbol.GetRef(aSheetPath, false);

      if (instance.m_Reference === '')
        instance.m_Reference = aSymbol.GetField(FIELD_T.REFERENCE)!.GetText();

      instance.m_Unit = aSymbol.GetUnit();
      aSymbol.AddHierarchicalReference(instance);
    }

    this.m_unit = aSymbol.GetUnitSelection(aSheetPath);
    this.m_footprint = aSymbol.GetFootprintFieldText(true, aSheetPath, false);
    this.m_sheetPath = new SCH_SHEET_PATH(aSheetPath);
    this.m_isNew = false;
    this.m_flag = 0;
    this.m_symbolUuid = aSymbol.m_Uuid;
    this.m_symbolPos = aSymbol.GetPosition();
    this.m_sheetNum = 0;

    if (aSymbol.GetRef(aSheetPath) === '') aSymbol.SetRef(aSheetPath, 'DefRef?');

    this.SetRef(aSymbol.GetRef(aSheetPath));
    this.m_numRef = -1;

    const value = aSymbol.GetValue(false, aSheetPath, false);
    this.m_value = value === '' ? '~' : value;
  }

  /** The copy C++ makes on assignment and on `push_back`. */
  Clone(): SCH_REFERENCE {
    const c = new SCH_REFERENCE();
    Object.assign(c, this);
    c.m_symbolPos = { ...this.m_symbolPos };
    c.m_sheetPath = new SCH_SHEET_PATH(this.m_sheetPath);
    return c;
  }

  GetSymbol(): SCH_SYMBOL {
    return this.m_rootSymbol!;
  }

  GetLibPart(): LIB_SYMBOL | null {
    return this.m_rootSymbol!.GetLibSymbolRef();
  }

  GetSheetPath(): SCH_SHEET_PATH {
    return this.m_sheetPath;
  }

  GetUnit(): number {
    return this.m_unit;
  }

  SetUnit(aUnit: number): void {
    this.m_unit = aUnit;
  }

  IsMultiUnit(): boolean {
    return this.GetLibPart()!.GetUnitCount() > 1;
  }

  GetValue(): string {
    return this.m_value;
  }

  SetValue(aValue: string): void {
    this.m_value = aValue;
  }

  GetFootprint(): string {
    return this.m_footprint;
  }

  SetFootprint(aFP: string): void {
    this.m_footprint = aFP;
  }

  SetSheetNumber(aSheetNumber: number): void {
    this.m_sheetNum = aSheetNumber;
  }

  /** The sheet path containing the symbol item. */
  GetPath(): string {
    return this.m_sheetPath.PathAsString();
  }

  /** The full path of the symbol item. */
  GetFullPath(): string {
    return this.m_sheetPath.PathAsString() + this.m_symbolUuid;
  }

  /** `operator<`: by full path, for `std::set`. */
  lessThan(aRef: SCH_REFERENCE): boolean {
    return this.GetFullPath() < aRef.GetFullPath();
  }

  /** `Annotate()`: update the symbol's annotation from this reference's state. */
  Annotate(): void {
    if (this.m_numRef < 0) this.m_ref += '?';
    else this.m_ref = this.GetRef() + this.GetRefNumber();

    this.m_rootSymbol!.SetRef(this.m_sheetPath, this.m_ref);
    this.m_rootSymbol!.SetUnit(this.m_unit);
    this.m_rootSymbol!.SetUnitSelection(this.m_sheetPath, this.m_unit);
  }

  /** `AlwaysAnnotate()`: a power symbol, or a reference starting with '#'. */
  AlwaysAnnotate(): boolean {
    const sym = this.m_rootSymbol;

    // wxCHECK( m_rootSymbol && m_rootSymbol->GetLibSymbolRef() && !GetRef( &m_sheetPath ).IsEmpty(), false )
    if (!sym || !sym.GetLibSymbolRef() || sym.GetRef(this.m_sheetPath) === '') return false;

    return sym.GetLibSymbolRef()!.IsPower() || sym.GetRef(this.m_sheetPath)[0] === '#';
  }

  /**
   * `Split()`: split the reference into a name (U) and number (1). A last character '?' or
   * not a digit tags it as not annotated.
   */
  Split(): void {
    let refText = this.GetRefStr();

    this.m_numRef = -1;
    this.m_numRefStr = '';

    let ll = refText.length - 1;

    if (refText[ll] === '?') {
      this.m_isNew = true;
      refText = refText.slice(0, ll); // delete last char
      this.SetRefStr(refText);
    } else if (!isdigit(refText[ll])) {
      this.m_isNew = true;
    } else {
      while (ll >= 0) {
        const c = refText[ll]!;

        if (c <= ' ' || isdigit(c)) {
          ll--;
        } else {
          // atoi: the leading digits of what follows
          if (isdigit(refText[ll + 1])) this.m_numRef = Number.parseInt(refText.slice(ll + 1), 10);

          this.m_numRefStr = refText.slice(ll + 1);
          refText = refText.slice(0, ll + 1);
          break;
        }
      }

      this.SetRefStr(refText);
    }
  }

  /** `IsSplitNeeded()`: the reference ends in '?' or a digit. */
  IsSplitNeeded(): boolean {
    const refText = this.GetRefStr();

    if (refText === '') return false;

    const last = refText[refText.length - 1];

    return last === '?' || isdigit(last);
  }

  SetRef(aReference: string): void {
    this.m_ref = aReference;
  }

  GetRef(): string {
    return this.m_ref;
  }

  SetRefStr(aReference: string): void {
    this.m_ref = aReference;
  }

  GetRefStr(): string {
    return this.m_ref;
  }

  /** Reference name with unit altogether. */
  GetFullRef(aIncludeUnit = true): string {
    const refNum = this.m_numRefStr === '' ? String(this.m_numRef) : this.m_numRefStr;

    if (aIncludeUnit && this.GetSymbol().GetUnitCount() > 1)
      return this.GetRef() + refNum + this.GetSymbol().SubReference(this.GetUnit());

    return this.GetRef() + refNum;
  }

  GetRefNumber(): string {
    return this.m_numRef < 0 ? '?' : this.m_numRefStr;
  }

  CompareValue(item: SCH_REFERENCE): number {
    return wxCmp(this.m_value, item.m_value);
  }

  CompareRef(item: SCH_REFERENCE): number {
    return wxCmpNoCase(this.m_ref, item.m_ref);
  }

  CompareLibName(item: SCH_REFERENCE): number {
    return wxCmp(
      this.m_rootSymbol!.GetLibId().GetLibItemName(),
      item.m_rootSymbol!.GetLibId().GetLibItemName(),
    );
  }

  /** The same symbol instance (symbol and sheet), whatever the unit or designator now. */
  IsSameInstance(other: SCH_REFERENCE): boolean {
    // Only compare symbol and path.
    // We may have changed the unit number or the designator but
    // can still be referencing the same instance.
    return (
      this.GetSymbol() === other.GetSymbol() &&
      this.GetSheetPath().Path().equals(other.GetSheetPath().Path())
    );
  }

  IsUnitsLocked(): boolean {
    const lib = this.GetLibPart();

    return lib ? lib.UnitsLocked() : true; // Assume units locked when we don't have a library
  }

  SetRefNum(aNum: number): void {
    this.m_numRef = aNum;
    this.m_numRefStr = this.formatRefStr(aNum);
  }

  GetSymbolDNP(aVariant = ''): boolean {
    return this.m_rootSymbol ? this.m_rootSymbol.GetDNP(this.m_sheetPath, aVariant) : false;
  }

  GetSymbolExcludedFromBOM(aVariant = ''): boolean {
    return this.m_rootSymbol
      ? this.m_rootSymbol.GetExcludedFromBOM(this.m_sheetPath, aVariant)
      : false;
  }

  GetSymbolExcludedFromSim(aVariant = ''): boolean {
    return this.m_rootSymbol
      ? this.m_rootSymbol.GetExcludedFromSim(this.m_sheetPath, aVariant)
      : false;
  }

  GetSymbolExcludedFromBoard(): boolean {
    return this.m_rootSymbol ? this.m_rootSymbol.GetExcludedFromBoard() : false;
  }

  GetSymbolExcludedFromPosFiles(aVariant = ''): boolean {
    return this.m_rootSymbol
      ? this.m_rootSymbol.GetExcludedFromPosFiles(this.m_sheetPath, aVariant)
      : false;
  }

  SetSymbolDNP(aEnable: boolean, aVariant = ''): void {
    this.m_rootSymbol?.SetDNP(aEnable, this.m_sheetPath, aVariant);
  }

  SetSymbolExcludedFromBOM(aEnable: boolean, aVariant = ''): void {
    this.m_rootSymbol?.SetExcludedFromBOM(aEnable, this.m_sheetPath, aVariant);
  }

  SetSymbolExcludedFromSim(aEnable: boolean, aVariant = ''): void {
    this.m_rootSymbol?.SetExcludedFromSim(aEnable, this.m_sheetPath, aVariant);
  }

  SetSymbolExcludedFromBoard(aEnable: boolean): void {
    this.m_rootSymbol?.SetExcludedFromBoard(aEnable);
  }

  SetSymbolExcludedFromPosFiles(aEnable: boolean, aVariant = ''): void {
    this.m_rootSymbol?.SetExcludedFromPosFiles(aEnable, this.m_sheetPath, aVariant);
  }

  /**
   * `formatRefStr()`: to avoid a risk of duplicate, for power symbols the ref number is 0nnn
   * instead of nnn. Just because sometimes only power symbols are annotated.
   */
  formatRefStr(aNumber: number): string {
    if (this.m_rootSymbol && this.GetLibPart()?.IsPower()) return `0${aNumber}`;

    return String(aNumber);
  }
}

/** `ANNOTATION_ERROR_HANDLER`. */
export type ANNOTATION_ERROR_HANDLER = (
  aType: ERCE_T,
  aMsg: string,
  aItemA: SCH_REFERENCE | null,
  aItemB: SCH_REFERENCE | null,
) => void;

/**
 * `SCH_MULTI_UNIT_REFERENCE_MAP`: `std::map<wxString, SCH_REFERENCE_LIST>`, read in key order
 * (`multiUnitEntries`).
 */
export type SCH_MULTI_UNIT_REFERENCE_MAP = Map<string, SCH_REFERENCE_LIST>;

/** A multi-unit map's entries in `std::map` order. */
export function multiUnitEntries(
  aMap: SCH_MULTI_UNIT_REFERENCE_MAP,
): [string, SCH_REFERENCE_LIST][] {
  return [...aMap].sort((a, b) => wxCmp(a[0], b[0]));
}

/** buildFullReference: a full reference string of a SCH_REFERENCE item. */
function buildFullReference(aItem: SCH_REFERENCE, aUnitNumber = -1): string {
  return `${aItem.GetRef()}${aItem.GetRefNumber()}..${aUnitNumber < 0 ? aItem.GetUnit() : aUnitNumber}`;
}

/**
 * `SCH_REFERENCE_LIST`: the flattened list of symbol references - one per symbol per sheet
 * path - that annotation, netlisting and the BOM work over.
 */
export class SCH_REFERENCE_LIST {
  private m_flatList: SCH_REFERENCE[] = [];
  /// A list of previously used reference designators.
  private m_refDesTracker: REFDES_TRACKER | null = null;

  at(aIndex: number): SCH_REFERENCE {
    return this.m_flatList[aIndex]!;
  }

  Clear(): void {
    this.m_flatList = [];
  }

  GetCount(): number {
    return this.m_flatList.length;
  }

  GetItem(aIdx: number): SCH_REFERENCE {
    return this.m_flatList[aIdx]!;
  }

  [Symbol.iterator](): Iterator<SCH_REFERENCE> {
    return this.m_flatList[Symbol.iterator]();
  }

  /** `FindItem()`: the entry for the same instance, or null. */
  FindItem(aItem: SCH_REFERENCE): SCH_REFERENCE | null {
    return this.m_flatList.find((r) => r.IsSameInstance(aItem)) ?? null;
  }

  /** `AddItem()`: a copy, as `push_back` makes. */
  AddItem(aItem: SCH_REFERENCE): void {
    this.m_flatList.push(aItem.Clone());
  }

  /** `RemoveItem()`. */
  RemoveItem(aIndex: number): void {
    if (aIndex < this.m_flatList.length) this.m_flatList.splice(aIndex, 1);
  }

  /** `Contains()`. */
  Contains(aItem: SCH_REFERENCE): boolean {
    return this.m_flatList.some((r) => r.IsSameInstance(aItem));
  }

  /** `SplitReferences()`. */
  SplitReferences(): void {
    for (const r of this.m_flatList) r.Split();
  }

  /** `RemoveAnnotation()`: treat every symbol as not annotated (the symbols are not touched). */
  RemoveAnnotation(): void {
    for (const r of this.m_flatList) r.m_isNew = true;
  }

  /** `UpdateAnnotation()`: write each reference back to its symbol. */
  UpdateAnnotation(): void {
    for (const r of this.m_flatList) r.Annotate();
  }

  /** `ReannotateByOptions()` (sch_reference_list.cpp:315). */
  ReannotateByOptions(
    aSortOption: ANNOTATE_ORDER_T,
    aAlgoOption: ANNOTATE_ALGO_T,
    aStartNumber: number,
    aAdditionalRefs: SCH_REFERENCE_LIST,
    aStartAtCurrent: boolean,
    aHierarchy: SCH_SHEET_LIST | null,
  ): void {
    this.SplitReferences();

    // All multi-unit symbols always locked to ensure consistent re-annotation
    const lockedSymbols: SCH_MULTI_UNIT_REFERENCE_MAP = new Map();

    for (const ref of this.m_flatList) {
      const refstr = ref.GetSymbol().GetRef(ref.GetSheetPath());

      // Update sheet numbers based on the reference's sheet's position within the full
      // hierarchy; we do this now before we annotate so annotation by sheet number * X
      // works correctly.
      if (aHierarchy) {
        const path = aHierarchy.FindSheetForPath(ref.GetSheetPath());

        // wxCHECK2_MSG( path, continue, "Attempting to annotate item on sheet not part of the hierarchy?" )
        if (!path) continue;

        ref.SetSheetNumber(path.GetPageNumberAsInt());
      }

      // Never lock unassigned references
      if (refstr[refstr.length - 1] === '?') continue;

      ref.m_isNew = true; // We want to reannotate all references

      const list = lockedSymbols.get(refstr) ?? new SCH_REFERENCE_LIST();
      list.AddItem(ref);
      lockedSymbols.set(refstr, list);
    }

    this.AnnotateByOptions(
      aSortOption,
      aAlgoOption,
      aStartNumber,
      lockedSymbols,
      aAdditionalRefs,
      aStartAtCurrent,
    );
  }

  /** `ReannotateDuplicates()`: Paste Unique's reannotation, not a general one. */
  ReannotateDuplicates(
    aAdditionalReferences: SCH_REFERENCE_LIST,
    aAlgoOption: ANNOTATE_ALGO_T,
  ): void {
    this.ReannotateByOptions(
      ANNOTATE_ORDER_T.UNSORTED,
      aAlgoOption,
      0,
      aAdditionalReferences,
      true,
      null,
    );
  }

  /** `AnnotateByOptions()`. */
  AnnotateByOptions(
    aSortOption: ANNOTATE_ORDER_T,
    aAlgoOption: ANNOTATE_ALGO_T,
    aStartNumber: number,
    aLockedUnitMap: SCH_MULTI_UNIT_REFERENCE_MAP,
    aAdditionalRefs: SCH_REFERENCE_LIST,
    aStartAtCurrent: boolean,
  ): void {
    switch (aSortOption) {
      case ANNOTATE_ORDER_T.SORT_BY_Y_POSITION:
        this.SortByYCoordinate();
        break;
      default: // SORT_BY_X_POSITION, and upstream's switch sends UNSORTED here too
        this.SortByXCoordinate();
        break;
    }

    let useSheetNum: boolean;
    let idStep: number;
    let startAtCurrent = aStartAtCurrent;

    switch (aAlgoOption) {
      case ANNOTATE_ALGO_T.SHEET_NUMBER_X_100:
        useSheetNum = true;
        idStep = 100;
        startAtCurrent = false; // Not implemented for sheet # * 100
        break;
      case ANNOTATE_ALGO_T.SHEET_NUMBER_X_1000:
        useSheetNum = true;
        idStep = 1000;
        startAtCurrent = false; // Not implemented for sheet # * 1000
        break;
      default: // INCREMENTAL_BY_REF
        useSheetNum = false;
        idStep = 1;
        break;
    }

    this.Annotate(
      useSheetNum,
      idStep,
      aStartNumber,
      aLockedUnitMap,
      aAdditionalRefs,
      startAtCurrent,
    );
  }

  /** `Annotate()` (sch_reference_list.cpp:405): set the references not yet annotated. */
  Annotate(
    aUseSheetNum: boolean,
    aSheetIntervalId: number,
    aStartNumber: number,
    aLockedUnitMap: SCH_MULTI_UNIT_REFERENCE_MAP,
    aAdditionalRefs: SCH_REFERENCE_LIST,
    aStartAtCurrent = false,
  ): void {
    // wxLogError( "No reference tracker set for SCH_REFERENCE_LIST::Annotate()" )
    if (!this.m_refDesTracker) return;

    if (this.m_flatList.length === 0) return;

    const originalSize = this.GetCount();

    // For multi units symbols, store the list of already used full references.
    // The algorithm tries to allocate the new reference to symbols having the same
    // old reference.
    // This algo works fine as long as the previous annotation has no duplicates.
    // But when a hierarchy is reannotated with this option, the previous annotation can
    // have duplicate references, and obviously we must fix these duplicate.
    // therefore do not try to allocate a full reference more than once when trying
    // to keep this order of multi units.
    // inUseRefs keep trace of previously allocated references
    const inUseRefs = new Set<string>();

    for (const original of aAdditionalRefs.m_flatList) {
      const additionalRef = original.Clone();
      additionalRef.Split();

      // Add the additional reference to the multi-unit set if annotated
      if (!additionalRef.m_isNew) inUseRefs.add(buildFullReference(additionalRef));

      // We don't want to reannotate the additional references even if not annotated
      // so we change the m_isNew flag to be false after splitting
      additionalRef.m_isNew = false;
      this.AddItem(additionalRef); //add to this container
    }

    let LastReferenceNumber = 0;

    /* calculate index of the first symbol with the same reference prefix
     * than the current symbol.  All symbols having the same reference
     * prefix will receive a reference number with consecutive values:
     * IC .. will be set to IC4, IC4, IC5 ...
     */
    let first = 0;

    // calculate the last used number for this reference prefix:
    // when using sheet number, ensure ref number >= sheet number* aSheetIntervalId
    let minRefId = aUseSheetNum
      ? this.m_flatList[first]!.m_sheetNum * aSheetIntervalId + 1
      : aStartNumber + 1;

    const lockedEntries = multiUnitEntries(aLockedUnitMap);

    for (let ii = 0; ii < this.m_flatList.length; ii++) {
      const ref_unit = this.m_flatList[ii]!;

      if (ref_unit.m_flag) continue;

      // Check whether this symbol is in aLockedUnitMap.
      let lockedList: SCH_REFERENCE_LIST | null = null;

      for (const [, list] of lockedEntries) {
        if (list.m_flatList.some((thisRef) => thisRef.IsSameInstance(ref_unit))) {
          lockedList = list;
          break;
        }
      }

      if (
        this.m_flatList[first]!.CompareRef(ref_unit) !== 0 ||
        (aUseSheetNum && this.m_flatList[first]!.m_sheetNum !== ref_unit.m_sheetNum)
      ) {
        // New reference found: we need a new ref number for this reference
        first = ii;

        // when using sheet number, ensure ref number >= sheet number* aSheetIntervalId
        minRefId = aUseSheetNum ? ref_unit.m_sheetNum * aSheetIntervalId + 1 : aStartNumber + 1;
      }

      // Find references greater than current reference (unless not annotated)
      if (aStartAtCurrent && ref_unit.m_numRef > 0) minRefId = ref_unit.m_numRef;

      // wxCHECK( ref_unit.GetLibPart(), void )
      if (!ref_unit.GetLibPart()) return;

      // Annotation of one part per package symbols (trivial case).
      if (ref_unit.GetLibPart()!.GetUnitCount() <= 1) {
        if (ref_unit.m_isNew) {
          LastReferenceNumber = this.FindFirstUnusedReference(ref_unit, minRefId, []);
          ref_unit.m_numRef = LastReferenceNumber;
          ref_unit.m_numRefStr = ref_unit.formatRefStr(LastReferenceNumber);
        }

        ref_unit.m_flag = 1;
        ref_unit.m_isNew = false;
        continue;
      }

      // If this symbol is in aLockedUnitMap, copy the annotation to all
      // symbols that are not it
      if (lockedList !== null) {
        const units = lockedList.GetUnitsMatchingRef(ref_unit);

        if (ref_unit.m_isNew) {
          LastReferenceNumber = this.FindFirstUnusedReference(ref_unit, minRefId, units);
          ref_unit.m_numRef = LastReferenceNumber;
          ref_unit.m_numRefStr = ref_unit.formatRefStr(LastReferenceNumber);
          ref_unit.m_isNew = false;
          ref_unit.m_flag = 1;
        }

        for (const lockedRef of lockedList.m_flatList) {
          if (lockedRef.IsSameInstance(ref_unit)) {
            // This is the symbol we're currently annotating. Hold the unit!
            ref_unit.m_unit = lockedRef.m_unit;

            // lock this new full reference
            inUseRefs.add(buildFullReference(ref_unit));
          }

          if (lockedRef.CompareValue(ref_unit) !== 0) continue;

          if (lockedRef.CompareLibName(ref_unit) !== 0) continue;

          // Find the matching symbol
          for (let jj = ii + 1; jj < this.m_flatList.length; jj++) {
            const other = this.m_flatList[jj]!;

            if (!lockedRef.IsSameInstance(other)) continue;

            const ref_candidate = buildFullReference(ref_unit, lockedRef.m_unit);

            // propagate the new reference and unit selection to the "old" symbol,
            // if this new full reference is not already used (can happens when initial
            // multiunits symbols have duplicate references)
            if (!inUseRefs.has(ref_candidate)) {
              other.m_numRef = ref_unit.m_numRef;
              other.m_numRefStr = ref_unit.m_numRefStr;
              other.m_isNew = false;
              other.m_flag = 1;

              // lock this new full reference
              inUseRefs.add(ref_candidate);
              break;
            }
          }
        }
      } else if (ref_unit.m_isNew) {
        // Reference belonging to multi-unit symbol that has not yet been annotated. We don't
        // know what group this might belong to, so just find the first unused reference for
        // this specific unit. The other units will be annotated in the following passes.
        const units = [ref_unit.GetUnit()];
        LastReferenceNumber = this.FindFirstUnusedReference(ref_unit, minRefId, units);
        ref_unit.m_numRef = LastReferenceNumber;
        ref_unit.m_numRefStr = ref_unit.formatRefStr(LastReferenceNumber);
        ref_unit.m_isNew = false;
        ref_unit.m_flag = 1;
      }
    }

    // Remove aAdditionalRefs references
    this.m_flatList.length = originalSize;
  }

  /**
   * `CheckAnnotation()` (sch_reference_list.cpp:602): unannotated symbols, units beyond the
   * library's count, duplicates, differing unit counts and differing values between units.
   * Returns the number of errors.
   */
  CheckAnnotation(aHandler: ANNOTATION_ERROR_HANDLER): number {
    let error = 0;

    this.SortByRefAndValue();

    // Split reference designators into name (prefix) and number: IC1 becomes IC, and 1.
    this.SplitReferences();

    // count not yet annotated items or annotation error.
    for (const item of this.m_flatList) {
      if (item.m_isNew) {
        // Not yet annotated
        const tmp = item.m_numRef >= 0 ? item.m_numRefStr : '?';
        const msg =
          item.m_unit > 0 && item.m_unit < 0x7fffffff && item.GetLibPart()!.GetUnitCount() > 1
            ? `Item not annotated: ${item.GetRef()}${tmp} (unit ${item.m_unit})`
            : `Item not annotated: ${item.GetRef()}${tmp}`;

        aHandler(ERCE_T.ERCE_UNANNOTATED, msg, item, null);
        error++;
        break;
      }

      // Error if unit number selected does not exist (greater than the  number of units in
      // the symbol).  This can happen if a symbol has changed in a library after a
      // previous annotation.
      if (Math.max(item.GetLibPart()!.GetUnitCount(), 1) < item.m_unit) {
        const tmp = item.m_numRef >= 0 ? item.m_numRefStr : '?';
        const msg = `Error: symbol ${item.GetRef()}${tmp}${item.GetSymbol().SubReference(item.GetUnit())} (unit ${item.m_unit}) exceeds units defined (${item.GetLibPart()!.GetUnitCount()})`;

        aHandler(ERCE_T.ERCE_EXTRA_UNITS, msg, item, null);
        error++;
        break;
      }
    }

    // count the duplicated elements (if all are annotated)
    const imax = this.m_flatList.length - 1;

    for (let ii = 0; ii < imax; ii++) {
      const first = this.m_flatList[ii]!;
      const second = this.m_flatList[ii + 1]!;

      if (first.CompareRef(second) !== 0 || first.m_numRef !== second.m_numRef) continue;

      // Same reference found. If same unit, error!
      if (first.m_unit === second.m_unit) {
        const tmp = first.m_numRef >= 0 ? first.m_numRefStr : '?';
        const unit =
          first.GetLibPart()!.GetUnitCount() > 1
            ? first.GetSymbol().SubReference(first.GetUnit())
            : '';

        aHandler(
          ERCE_T.ERCE_DUPLICATE_REFERENCE,
          `Duplicate items ${first.GetRef()}${tmp}${unit}\n`,
          first,
          second,
        );
        error++;
        continue;
      }

      /* Test error if units are different but number of parts per package
       * too high (ex U3 ( 1 part) and we find U3B this is an error) */
      if (first.GetLibPart()!.GetUnitCount() !== second.GetLibPart()!.GetUnitCount()) {
        const tmp = first.m_numRef >= 0 ? first.m_numRefStr : '?';
        const tmp2 = second.m_numRef >= 0 ? second.m_numRefStr : '?';
        const msg = `Differing unit counts for item ${first.GetRef()}${tmp}${first.GetSymbol().SubReference(first.GetUnit())} and ${second.GetRef()}${tmp2}${first.GetSymbol().SubReference(second.GetUnit())}\n`;

        aHandler(ERCE_T.ERCE_DUPLICATE_REFERENCE, msg, first, second);
        error++;
        continue;
      }

      // Error if values are different between units, for the same reference
      if (first.CompareValue(second) !== 0) {
        const msg = `Different values for ${first.GetRef()}${first.m_numRef}${first.GetSymbol().SubReference(first.GetUnit())} (${first.m_value}) and ${second.GetRef()}${second.m_numRef}${first.GetSymbol().SubReference(second.GetUnit())} (${second.m_value})`;

        aHandler(ERCE_T.ERCE_DIFFERENT_UNIT_VALUE, msg, first, second);
        error++;
      }
    }

    return error;
  }

  /** `SortByXCoordinate()`: reference, sheet number, X, Y, then uuid. */
  SortByXCoordinate(): void {
    this.m_flatList.sort((a, b) =>
      SCH_REFERENCE_LIST.order(SCH_REFERENCE_LIST.sortByXPosition, a, b),
    );
  }

  /** `SortByYCoordinate()`: reference, sheet number, Y, X, then uuid. */
  SortByYCoordinate(): void {
    this.m_flatList.sort((a, b) =>
      SCH_REFERENCE_LIST.order(SCH_REFERENCE_LIST.sortByYPosition, a, b),
    );
  }

  /** `SortByTimeStamp()`: sheet path, then uuid. */
  SortByTimeStamp(): void {
    this.m_flatList.sort((a, b) =>
      SCH_REFERENCE_LIST.order(SCH_REFERENCE_LIST.sortByTimeStamp, a, b),
    );
  }

  /** `SortByRefAndValue()`: reference, value, unit, sheet number, X, Y, then uuid. */
  SortByRefAndValue(): void {
    this.m_flatList.sort((a, b) =>
      SCH_REFERENCE_LIST.order(SCH_REFERENCE_LIST.sortByRefAndValue, a, b),
    );
  }

  /** `SortByReferenceOnly()`: the reference (StrNumCmp), unit, then uuid. */
  SortByReferenceOnly(): void {
    this.m_flatList.sort((a, b) =>
      SCH_REFERENCE_LIST.order(SCH_REFERENCE_LIST.sortByReferenceOnly, a, b),
    );
  }

  /**
   * `SortBySymbolPtr()`: upstream orders by the symbols' addresses, which only groups the
   * references of one symbol together; here they are grouped by first appearance.
   */
  SortBySymbolPtr(): void {
    const firstSeen = new Map<SCH_SYMBOL, number>();

    for (const r of this.m_flatList)
      if (!firstSeen.has(r.GetSymbol())) firstSeen.set(r.GetSymbol(), firstSeen.size);

    this.m_flatList.sort((a, b) => firstSeen.get(a.GetSymbol())! - firstSeen.get(b.GetSymbol())!);
  }

  /** `FindRef()`: the index of the first reference \a aRef, or -1. */
  FindRef(aRef: string): number {
    return this.m_flatList.findIndex((r) => r.GetRef() === aRef);
  }

  /** `FindRefByFullPath()`: the index of the symbol at \a aFullPath, or -1. */
  FindRefByFullPath(aFullPath: string): number {
    return this.m_flatList.findIndex((r) => r.GetFullPath() === aFullPath);
  }

  /** `GetRefsInUse()`: the reference numbers >= \a aMinRefId in use for that prefix, sorted. */
  GetRefsInUse(aIndex: number, aIdList: number[], aMinRefId: number): void {
    aIdList.length = 0;

    for (const ref of this.m_flatList) {
      // Don't add new references to the list as we will reannotate those
      if (
        this.m_flatList[aIndex]!.CompareRef(ref) === 0 &&
        ref.m_numRef >= aMinRefId &&
        !ref.m_isNew
      )
        aIdList.push(ref.m_numRef);
    }

    // Ensure each reference number appears only once.  If there are symbols with
    // multiple parts per package the same number will be stored for each part.
    const unique = [...new Set(aIdList)].sort((a, b) => a - b);
    aIdList.length = 0;
    aIdList.push(...unique);
  }

  /** `GetUnitsMatchingRef()`: the units used by references matching \a aRef. */
  GetUnitsMatchingRef(aRef: SCH_REFERENCE): number[] {
    // Always add this reference to the list
    const unitsList = [aRef.m_unit];

    for (const original of this.m_flatList) {
      // iterated by value upstream: a copy, which the Split below must not reach the list
      const ref = original.Clone();

      if (ref.CompareValue(aRef) !== 0) continue;

      if (ref.CompareLibName(aRef) !== 0) continue;

      // Split if needed before comparing ref and number
      if (ref.IsSplitNeeded()) ref.Split();

      if (ref.CompareRef(aRef) !== 0) continue;

      if (ref.m_numRef !== aRef.m_numRef) continue;

      unitsList.push(ref.m_unit);
    }

    // Ensure each reference number appears only once.  If there are symbols with
    // multiple parts per package the same number will be stored for each part.
    return [...new Set(unitsList)].sort((a, b) => a - b);
  }

  /**
   * `FindFirstUnusedReference()`: the first reference number from \a aMinValue for \a aRef's
   * prefix that leaves \a aRequiredUnits free (through the REFDES_TRACKER).
   */
  FindFirstUnusedReference(
    aRef: SCH_REFERENCE,
    aMinValue: number,
    aRequiredUnits: readonly number[],
  ): number {
    // Create a map of references indexed by reference number, only including those with the same
    // reference prefix as aRef
    const refNumberMap = new Map<number, SCH_REFERENCE[]>();

    for (const ref of this.m_flatList) {
      // search only for the current reference prefix:
      if (ref.CompareRef(aRef) !== 0) continue;

      if (ref.m_isNew) continue; // It will be reannotated

      const list = refNumberMap.get(ref.m_numRef) ?? [];
      list.push(ref.Clone());
      refNumberMap.set(ref.m_numRef, list);
    }

    return this.m_refDesTracker!.GetNextRefDesForUnits(
      aRef,
      refNumberMap,
      aRequiredUnits,
      aMinValue,
    );
  }

  /** `GetSymbolInstances()`. */
  GetSymbolInstances(): SCH_SYMBOL_INSTANCE[] {
    return this.m_flatList.map((ref) => {
      const instance = new SCH_SYMBOL_INSTANCE();
      instance.m_Path = ref.GetSheetPath().Path();
      instance.m_Reference = ref.GetRef();
      instance.m_Unit = ref.GetUnit();
      return instance;
    });
  }

  /**
   * `Shorthand()`: the references as "R1, R2, R4 - R7, U1" (\a refDelimiter between items,
   * \a refRangeDelimiter in a run of three or more).
   */
  static Shorthand(
    aList: readonly SCH_REFERENCE[],
    refDelimiter: string,
    refRangeDelimiter: string,
  ): string {
    let retVal = '';
    let i = 0;

    while (i < aList.length) {
      const ref = aList[i]!.GetRef();
      const numRef = aList[i]!.m_numRef;
      let range = 1;

      while (
        i + range < aList.length &&
        aList[i + range]!.GetRef() === ref &&
        aList[i + range]!.m_numRef === numRef + range
      ) {
        range++;

        if (range === 2 && refRangeDelimiter === '') break;
      }

      if (retVal !== '') retVal += refDelimiter;

      if (range === 1) {
        retVal += ref + aList[i]!.GetRefNumber();
      } else if (range === 2 || refRangeDelimiter === '') {
        retVal += ref + aList[i]!.GetRefNumber();
        retVal += refDelimiter;
        retVal += ref + aList[i + 1]!.GetRefNumber();
      } else {
        retVal += ref + aList[i]!.GetRefNumber();
        retVal += refRangeDelimiter;
        retVal += ref + aList[i + (range - 1)]!.GetRefNumber();
      }

      i += range;
    }

    return retVal;
  }

  GetRefDesTracker(): REFDES_TRACKER | null {
    return this.m_refDesTracker;
  }

  SetRefDesTracker(aTracker: REFDES_TRACKER | null): void {
    this.m_refDesTracker = aTracker;
  }

  /** The strict-weak orderings below as a comparator, as std::sort uses them. */
  private static order(
    aLess: (a: SCH_REFERENCE, b: SCH_REFERENCE) => boolean,
    a: SCH_REFERENCE,
    b: SCH_REFERENCE,
  ): number {
    return aLess(a, b) ? -1 : aLess(b, a) ? 1 : 0;
  }

  private static sortByXPosition(item1: SCH_REFERENCE, item2: SCH_REFERENCE): boolean {
    let ii = item1.CompareRef(item2);
    if (ii === 0) ii = item1.m_sheetNum - item2.m_sheetNum;
    if (ii === 0) ii = item1.m_symbolPos.x - item2.m_symbolPos.x;
    if (ii === 0) ii = item1.m_symbolPos.y - item2.m_symbolPos.y;
    if (ii === 0) return item1.m_symbolUuid < item2.m_symbolUuid; // ensure a deterministic sort
    return ii < 0;
  }

  private static sortByYPosition(item1: SCH_REFERENCE, item2: SCH_REFERENCE): boolean {
    let ii = item1.CompareRef(item2);
    if (ii === 0) ii = item1.m_sheetNum - item2.m_sheetNum;
    if (ii === 0) ii = item1.m_symbolPos.y - item2.m_symbolPos.y;
    if (ii === 0) ii = item1.m_symbolPos.x - item2.m_symbolPos.x;
    if (ii === 0) return item1.m_symbolUuid < item2.m_symbolUuid; // ensure a deterministic sort
    return ii < 0;
  }

  private static sortByRefAndValue(item1: SCH_REFERENCE, item2: SCH_REFERENCE): boolean {
    let ii = item1.CompareRef(item2);
    if (ii === 0) ii = item1.CompareValue(item2);
    if (ii === 0) ii = item1.m_unit - item2.m_unit;
    if (ii === 0) ii = item1.m_sheetNum - item2.m_sheetNum;
    if (ii === 0) ii = item1.m_symbolPos.x - item2.m_symbolPos.x;
    if (ii === 0) ii = item1.m_symbolPos.y - item2.m_symbolPos.y;
    if (ii === 0) return item1.m_symbolUuid < item2.m_symbolUuid; // ensure a deterministic sort
    return ii < 0;
  }

  private static sortByReferenceOnly(item1: SCH_REFERENCE, item2: SCH_REFERENCE): boolean {
    let ii = strNumCmp(item1.GetRef(), item2.GetRef(), false);
    if (ii === 0) ii = item1.m_unit - item2.m_unit;
    if (ii === 0) return item1.m_symbolUuid < item2.m_symbolUuid; // ensure a deterministic sort
    return ii < 0;
  }

  private static sortByTimeStamp(item1: SCH_REFERENCE, item2: SCH_REFERENCE): boolean {
    const ii = item1.m_sheetPath.Cmp(item2.m_sheetPath);
    if (ii === 0) return item1.m_symbolUuid < item2.m_symbolUuid; // ensure a deterministic sort
    return ii < 0;
  }
}
