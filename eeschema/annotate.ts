// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol annotation. Counterpart: `eeschema/annotate.cpp`
 * (SCH_EDIT_FRAME::AnnotateSymbols / DeleteAnnotation / CheckAnnotate).
 *
 * The numbering core — sorting, reservation, and the actual reference
 * assignment (SCH_REFERENCE_LIST::Annotate / AnnotateByOptions /
 * CheckAnnotation) — lives in `sch_reference_list.ts`, imported here. This
 * file is the frame-side commands: undoable Annotate/Clear Annotation, the
 * Increment Annotations action, and the two report loops (Annotation
 * Messages, DeleteAnnotation's messages).
 *
 * One model difference from upstream: a reference lives on the symbol, not per
 * sheet-instance path, so a sheet file instantiated twice shares one set of
 * references instead of getting a set per instance.
 */

import type { SchSymbol, Schematic, LibSymbol } from './types.js';
import type { EditCommand } from './tools/command.js';
import { refId } from './tools/hittest.js';
import { Reporter, RPT_SEVERITY_ACTION, type ReportLine } from '@ziroeda/common/reporter.js';
import {
  annotateSymbols,
  referenceOf,
  splitReference,
  setFieldValue,
  unitCount,
  symValue,
  refOf,
  isAnnotated,
  defaultSubReference,
  type AnnotateOptions,
  type AnnotateScope,
} from './sch_reference_list.js';

export const defaultAnnotateOptions = (): AnnotateOptions => ({
  scope: 'all',
  order: 'x',
  algo: 'incremental',
  resetExisting: false,
  startNumber: 0,
  sheetNumber: 1,
});

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

/**
 * SCH_REFERENCE::IsSplitNeeded: the reference ends in a number or a `?`, so
 * there is something to split off. "R12" and "R?" qualify; "R" and "TP" do not.
 */
export function isSplitNeeded(ref: string): boolean {
  if (ref === '') return false;
  const last = ref[ref.length - 1]!;
  return last === '?' || (last >= '0' && last <= '9');
}

export interface IncrementAnnotationsOptions {
  /** The reference to start from, e.g. "R5": its prefix picks which symbols are
   *  touched and its number picks where in the run to start. */
  startRef: string;
  /** How much to add, 1..64 (the dialog's spin range). */
  increment: number;
}

/**
 * SCH_EDITOR_CONTROL::IncrementAnnotations: renumber a tail of one reference
 * prefix, so that room can be made in the middle of an existing run.
 *
 * Everything sharing the start reference's prefix and numbered at or above its
 * number moves up by `increment`; everything else is untouched. A start
 * reference with nothing to split ("R", "TP") is rejected upstream and is a
 * no-op here.
 *
 * Note that an unannotated "R?" reads as number 0, exactly as upstream's
 * atoi( GetRefNumber() ) does, so starting at "R?" renumbers the whole R run
 * including the unannotated ones.
 *
 * Returns the same array when nothing changed.
 */
export function incrementAnnotations(
  symbols: readonly SchSymbol[],
  opts: IncrementAnnotationsOptions,
): readonly SchSymbol[] {
  if (!isSplitNeeded(opts.startRef)) return symbols;
  const start = splitReference(opts.startRef);
  const startNum = start.num ?? 0;
  let changed = false;
  const out = symbols.map((sym) => {
    const field = referenceOf(sym);
    if (!field) return sym;
    const { prefix, num } = splitReference(field.value);
    if (prefix !== start.prefix) return sym;
    if ((num ?? 0) < startNum) return sym;
    changed = true;
    const next = `${prefix}${(num ?? 0) + opts.increment}`;
    return {
      ...sym,
      fields: sym.fields.map((f) => (f === field ? setFieldValue(f, next) : f)),
    };
  });
  return changed ? out : symbols;
}

// ----- reporting (the Annotation Messages panel) -----------------------------

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
