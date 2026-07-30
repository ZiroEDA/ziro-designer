// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol annotation. Counterpart: `eeschema/annotate.cpp`
 * (SCH_EDIT_FRAME::AnnotateSymbols / DeleteAnnotation / CheckAnnotate) + the
 * numbering core in `eeschema/sch_reference_list.cpp`
 * (SCH_REFERENCE_LIST::Annotate / AnnotateByOptions / CheckAnnotation).
 *
 * The pass runs over a whole hierarchy: symbols are collected from every sheet
 * in scope, sorted by prefix, then sheet number, then X- or Y-position (or left
 * unsorted), and each un-annotated symbol takes the first free number for its
 * prefix at or above the minimum (start number, or sheet-number × 100/1000).
 * Multi-unit symbols that already share a reference stay on one number unless
 * units are being regrouped, power symbols (`#`-prefixed) are never touched,
 * and symbols on out-of-scope sheets reserve their numbers (upstream's
 * additionalRefs) so a current-sheet or selection pass makes no duplicates.
 *
 * One model difference from upstream: a reference lives on the symbol, not per
 * sheet-instance path, so a sheet file instantiated twice shares one set of
 * references instead of getting a set per instance.
 */

import type { SchField, SchSymbol, Schematic, LibSymbol } from '../types.js';
import type { RefDesTracker } from './refdes_tracker.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';
import { str } from '@ziroeda/sexpr';
import type { SList } from '@ziroeda/sexpr';
import {
  Reporter,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  type ReportLine,
} from '@ziroeda/common/src/reporter.js';

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
  /** The current sheet's number for the sheet-× algos; defaults to 1. */
  sheetNumber?: number;
  /** aRegroupUnits: don't collect the locked (already-shared) multi-unit sets,
   *  so units regroup freely by placement. Only meaningful with resetExisting. */
  regroupUnits?: boolean;
  /** REFDES_TRACKER (schematic.used_designators): with reuseRefDes false,
   *  previously-used-but-freed numbers are skipped; every accepted number is
   *  recorded (GetNextRefDesForUnits' m_allRefDes gate + insert). */
  tracker?: RefDesTracker;
}

export const defaultAnnotateOptions = (): AnnotateOptions => ({
  scope: 'all',
  order: 'x',
  algo: 'incremental',
  resetExisting: false,
  startNumber: 0,
  sheetNumber: 1,
});

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

const referenceOf = (s: SchSymbol): SchField | undefined =>
  s.fields.find((f) => f.key === 'Reference');

/** Distinct unit count of a symbol's library part (SCH_SYMBOL::GetUnitCount). */
function unitCount(libId: string, libById: ReadonlyMap<string, LibSymbol>): number {
  const lib = libById.get(libId);
  if (!lib) return 1;
  const units = new Set(lib.units.map((u) => u.unit).filter((u) => u > 0));
  return Math.max(1, units.size);
}

const setFieldValue = (f: SchField, value: string): SchField => {
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
      if (prefix.startsWith('#')) return; // power / flag symbols keep their refs
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
        return opts.startNumber + 1;
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

/** Annotate as an undoable command (SCH_EDIT_FRAME::AnnotateSymbols + commit). */
export function annotateCommand(
  libById: ReadonlyMap<string, LibSymbol>,
  opts: AnnotateOptions,
  selectedIds?: ReadonlySet<string>,
): EditCommand {
  return {
    label: 'Annotate Schematic',
    apply(doc: Schematic): Schematic {
      const symbols = annotateSymbols(doc, libById, opts, selectedIds);
      return symbols === doc.symbols ? doc : { ...doc, symbols };
    },
    invert(before: Schematic): EditCommand {
      return restoreSymbols(before.symbols);
    },
  };
}

/**
 * Clear Annotation (SCH_EDIT_FRAME::DeleteAnnotation): reset each in-scope
 * non-power symbol's reference to its bare prefix + '?'. Undoable.
 */
export function clearAnnotationCommand(
  scope: AnnotateScope,
  selectedIds?: ReadonlySet<string>,
): EditCommand {
  return {
    label: 'Clear Annotation',
    apply(doc: Schematic): Schematic {
      let changed = false;
      const symbols = doc.symbols.map((sym, i) => {
        if (scope === 'selection' && !selectedIds?.has(refId('symbol', sym.uuid, i))) return sym;
        const ref = referenceOf(sym);
        if (!ref) return sym;
        const { prefix } = splitReference(ref.value);
        if (prefix.startsWith('#')) return sym;
        const cleared = `${prefix}?`;
        if (ref.value === cleared) return sym;
        changed = true;
        return {
          ...sym,
          fields: sym.fields.map((f) => (f.key === 'Reference' ? setFieldValue(f, cleared) : f)),
        };
      });
      return changed ? { ...doc, symbols } : doc;
    },
    invert(before: Schematic): EditCommand {
      return restoreSymbols(before.symbols);
    },
  };
}

function restoreSymbols(symbols: readonly SchSymbol[]): EditCommand {
  return {
    label: 'Annotate Schematic',
    apply(doc: Schematic): Schematic {
      return { ...doc, symbols };
    },
    invert(before: Schematic): EditCommand {
      return restoreSymbols(before.symbols);
    },
  };
}

/** Replace a sheet's symbols wholesale, the per-sheet half of a hierarchy pass. */
export function setSymbolsCommand(symbols: readonly SchSymbol[], label: string): EditCommand {
  return {
    label,
    apply(doc: Schematic): Schematic {
      return { ...doc, symbols };
    },
    invert(before: Schematic): EditCommand {
      return setSymbolsCommand(before.symbols, label);
    },
  };
}

// ----- reporting (the Annotation Messages panel) -----------------------------

/** SCH_SYMBOL::SubReference, 1 → "A", 2 → "B"… (the default notation). */
const defaultSubReference = (unit: number): string => {
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
function isAnnotated(ref: string): boolean {
  if (ref.includes('?')) return false;
  return splitReference(ref).num !== undefined;
}

const symValue = (sym: SchSymbol): string => sym.fields.find((f) => f.key === 'Value')?.value ?? '';
const refOf = (sym: SchSymbol): string => referenceOf(sym)?.value ?? '';

/** A sheet before/after an annotation pass, for building its messages. */
export interface AnnotateDiff {
  before: Schematic;
  after: Schematic;
}

/**
 * The Annotation Messages of a completed pass (AnnotateSymbols' report loop):
 * one ACTION line per symbol whose reference changed, worded by whether the
 * symbol had been annotated before.
 */
export function annotationReport(
  diffs: readonly AnnotateDiff[],
  libById: ReadonlyMap<string, LibSymbol>,
  subReference: (unit: number) => string = defaultSubReference,
): ReportLine[] {
  const reporter = new Reporter();
  for (const { before, after } of diffs) {
    after.symbols.forEach((sym, i) => {
      const prevSym = before.symbols[i];
      if (!prevSym) return;
      const newRefBase = refOf(sym);
      const prevRefBase = refOf(prevSym);
      if (splitReference(newRefBase).prefix.startsWith('#')) return;
      const multiUnit = unitCount(sym.libId, libById) > 1;
      const sub = multiUnit ? subReference(sym.unit) : '';
      const newRef = `${newRefBase}${sub}`;
      const value = symValue(sym);

      if (isAnnotated(prevRefBase)) {
        const prevRef = `${prevRefBase}${sub}`;
        if (newRef === prevRef) return;
        reporter.report(
          multiUnit
            ? `Updated ${value} (unit ${sub}) from ${prevRef} to ${newRef}.`
            : `Updated ${value} from ${prevRef} to ${newRef}.`,
          RPT_SEVERITY_ACTION,
        );
      } else {
        if (newRefBase === prevRefBase) return;
        reporter.report(
          multiUnit
            ? `Annotated ${value} (unit ${sub}) as ${newRef}.`
            : `Annotated ${value} as ${newRef}.`,
          RPT_SEVERITY_ACTION,
        );
      }
    });
  }
  return reporter.lines;
}

/** DeleteAnnotation's messages: one ACTION line per symbol actually cleared. */
export function clearAnnotationReport(
  diffs: readonly AnnotateDiff[],
  libById: ReadonlyMap<string, LibSymbol>,
  subReference: (unit: number) => string = defaultSubReference,
): ReportLine[] {
  const reporter = new Reporter();
  for (const { before, after } of diffs) {
    after.symbols.forEach((sym, i) => {
      const prevSym = before.symbols[i];
      if (!prevSym || refOf(sym) === refOf(prevSym)) return;
      const value = symValue(sym);
      reporter.report(
        unitCount(sym.libId, libById) > 1
          ? `Cleared annotation for ${value} (unit ${subReference(sym.unit)}).`
          : `Cleared annotation for ${value}.`,
        RPT_SEVERITY_ACTION,
      );
    });
  }
  return reporter.lines;
}

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
