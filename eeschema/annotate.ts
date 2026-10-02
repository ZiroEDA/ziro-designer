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

// ---------------------------------------------------------------------------
// The live model: `annotate.cpp`'s SCH_EDIT_FRAME members, mixed into SCH_EDIT_FRAME as
// files-io.ts' are. Everything above is the record model's, until S7.
//
// No SCH_SELECTION_TOOL on the live model yet (stage S5), so the selection these read is
// empty: ANNOTATE_SELECTION finds nothing, and no selected sheet joins a recursive scope.
// Left to the window: DIALOG_ERC::UpdateAnnotationWarning and UpdateNetHighlightStatus.
// ---------------------------------------------------------------------------

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  RPT_SEVERITY_ACTION as RPT_SEVERITY_ACTION_LIVE,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
  type Reporter as REPORTER,
} from '@ziroeda/common/reporter.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from './sch_commit.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import type { SCH_FIELD } from './sch_field.js';
import type { SCH_ITEM } from './sch_item.js';
import {
  ANNOTATE_SCOPE_T,
  type ANNOTATE_ALGO_T,
  type ANNOTATE_ORDER_T,
  type ANNOTATION_ERROR_HANDLER,
  SCH_REFERENCE_LIST,
  type SCH_MULTI_UNIT_REFERENCE_MAP,
} from './sch_reference_list.js';
import { SCH_SCREENS } from './sch_screen.js';
import type { SCH_SHEET } from './sch_sheet.js';
import { SCH_SHEET_LIST, type SCH_SHEET_PATH, SYMBOL_FILTER } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';

/** The selection annotate.cpp reads from SCH_SELECTION_TOOL: none yet (see above). */
function annotationSelection(_aFrame: SCH_EDIT_FRAME): EDA_ITEM[] {
  return [];
}

/** The symbols a selection names: selected symbols, their reference fields, group members. */
export function getInferredSymbols(aSelection: readonly EDA_ITEM[]): Set<SCH_SYMBOL> {
  const symbols = new Set<SCH_SYMBOL>();

  for (const item of aSelection) {
    switch (item.Type()) {
      case KICAD_T.SCH_FIELD_T: {
        const field = item as unknown as SCH_FIELD;

        if (
          field.GetId() === FIELD_T.REFERENCE &&
          field.GetParent()?.Type() === KICAD_T.SCH_SYMBOL_T
        )
          symbols.add(field.GetParent() as unknown as SCH_SYMBOL);

        break;
      }

      case KICAD_T.SCH_SYMBOL_T:
        symbols.add(item as unknown as SCH_SYMBOL);
        break;

      case KICAD_T.SCH_GROUP_T:
        (item as unknown as SCH_ITEM).RunOnChildren((aChild: SCH_ITEM) => {
          if (aChild.Type() === KICAD_T.SCH_SYMBOL_T) symbols.add(aChild as unknown as SCH_SYMBOL);
        }, RECURSE_MODE.RECURSE);
        break;

      default:
        break;
    }
  }

  return symbols;
}

/** The sheet paths within each sheet on \a aCurrentSheet's screen, relative to the full hierarchy. */
function subSheetsOf(aSheets: SCH_SHEET_LIST, aCurrentSheet: SCH_SHEET_PATH): SCH_SHEET_LIST {
  const subSheets = new SCH_SHEET_LIST();
  const tempSubSheets: SCH_ITEM[] = [];
  aCurrentSheet.LastScreen()!.GetSheets(tempSubSheets);

  for (const item of tempSubSheets) {
    const subSheetPath = aCurrentSheet.Clone();
    subSheetPath.push_back(item as unknown as SCH_SHEET);

    aSheets.GetSheetsWithinPath(subSheets, subSheetPath);
  }

  return subSheets;
}

export class SCH_ANNOTATE_MIXIN {
  /** Fill \a aMap with the full path of each annotated symbol and its reference (unit included). */
  mapExistingAnnotation(this: SCH_EDIT_FRAME, aMap: Map<string, string>): void {
    const references = new SCH_REFERENCE_LIST();
    this.Schematic().Hierarchy().GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

    for (let i = 0; i < references.GetCount(); i++) {
      const symbol = references.at(i).GetSymbol();
      const curr_sheetpath = references.at(i).GetSheetPath();
      const curr_full_uuid = curr_sheetpath.Path();

      curr_full_uuid.push_back(symbol.m_Uuid);

      const ref = symbol.GetRef(curr_sheetpath, true);

      if (symbol.IsAnnotated(curr_sheetpath)) aMap.set(curr_full_uuid.AsString(), ref);
    }
  }

  /** Clear the current symbol annotation, in \a aAnnotateScope. */
  DeleteAnnotation(
    this: SCH_EDIT_FRAME,
    aAnnotateScope: ANNOTATE_SCOPE_T,
    aRecursive: boolean,
    aReporter: REPORTER,
  ): void {
    const sheets = this.Schematic().Hierarchy();
    const screen = this.GetScreen();
    const currentSheet = this.GetCurrentSheet();
    const commit = new SCH_COMMIT(this);

    const clearSymbolAnnotation = (
      aItem: EDA_ITEM,
      aScreen: typeof screen,
      aSheet: SCH_SHEET_PATH | null,
      aResetPrefixes: boolean,
    ) => {
      const symbol = aItem as unknown as SCH_SYMBOL;
      commit.Modify(aItem, aScreen);

      // aSheet == nullptr means all sheets
      if (!aSheet || symbol.IsAnnotated(aSheet)) {
        let msg: string;

        if (symbol.GetUnitCount() > 1) {
          msg = `Cleared annotation for ${symbol.GetValue(true, aSheet, false)} (unit ${symbol.SubReference(symbol.GetUnit(), false)}).`;
        } else {
          msg = `Cleared annotation for ${symbol.GetValue(true, aSheet, false)}.`;
        }

        symbol.ClearAnnotation(aSheet, aResetPrefixes);
        aReporter.Report(msg, RPT_SEVERITY_ACTION_LIVE);
      }
    };

    const clearSheetAnnotation = (
      aScreen: typeof screen,
      aSheet: SCH_SHEET_PATH,
      aResetPrefixes: boolean,
    ) => {
      for (const item of aScreen!.Items().OfType(KICAD_T.SCH_SYMBOL_T))
        clearSymbolAnnotation(item, aScreen, aSheet, aResetPrefixes);
    };

    switch (aAnnotateScope) {
      case ANNOTATE_SCOPE_T.ANNOTATE_ALL: {
        for (const sheet of sheets) clearSheetAnnotation(sheet.LastScreen(), sheet, false);

        break;
      }

      case ANNOTATE_SCOPE_T.ANNOTATE_CURRENT_SHEET: {
        clearSheetAnnotation(screen, currentSheet, false);

        if (aRecursive) {
          for (const sheet of subSheetsOf(sheets, currentSheet))
            clearSheetAnnotation(sheet.LastScreen(), sheet, false);
        }

        break;
      }

      case ANNOTATE_SCOPE_T.ANNOTATE_SELECTION: {
        const selectedSheets = new SCH_SHEET_LIST();

        for (const item of annotationSelection(this)) {
          if (item.Type() === KICAD_T.SCH_SYMBOL_T)
            clearSymbolAnnotation(item, screen, currentSheet, false);

          if (item.Type() === KICAD_T.SCH_SHEET_T && aRecursive) {
            const subSheetPath = currentSheet.Clone();
            subSheetPath.push_back(item as unknown as SCH_SHEET);

            sheets.GetSheetsWithinPath(selectedSheets, subSheetPath);
          }
        }

        for (const sheet of selectedSheets) clearSheetAnnotation(sheet.LastScreen(), sheet, false);

        break;
      }
    }

    // Update the references for the sheet that is currently being displayed.
    this.GetCurrentSheet().UpdateAllScreenReferences();

    commit.Push('Delete Annotation');
  }

  /**
   * Annotate the symbols in the schematic that are not currently annotated.
   *
   * Multi-unit symbols are annotated together. E.g. if two symbols were R8A and R8B, they may
   * become R3A and R3B, but not R3A and R3C or R3C and R4D.
   */
  AnnotateSymbols(
    this: SCH_EDIT_FRAME,
    aCommit: SCH_COMMIT,
    aAnnotateScope: ANNOTATE_SCOPE_T,
    aSortOption: ANNOTATE_ORDER_T,
    aAlgoOption: ANNOTATE_ALGO_T,
    aRecursive: boolean,
    aStartNumber: number,
    aResetAnnotation: boolean,
    aRegroupUnits: boolean,
    aRepairTimestamps: boolean,
    aReporter: REPORTER,
    aSymbolFilter: SYMBOL_FILTER,
  ): void {
    const selection = annotationSelection(this);

    const references = new SCH_REFERENCE_LIST();
    const screens = new SCH_SCREENS(this.Schematic().Root());
    const sheets = this.Schematic().Hierarchy();
    const currentSheet = this.GetCurrentSheet();

    // Store the selected sheets relative to the full hierarchy so we get the correct sheet numbers
    const selectedSheets = new SCH_SHEET_LIST();

    for (const item of selection) {
      if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const subSheetPath = currentSheet.Clone();
        subSheetPath.push_back(item as unknown as SCH_SHEET);

        sheets.GetSheetsWithinPath(selectedSheets, subSheetPath);
      }
    }

    // Like above, store subsheets relative to full hierarchy for recursive annotation from current
    // sheet
    const subSheets = subSheetsOf(sheets, currentSheet);

    let selectedSymbols = new Set<SCH_SYMBOL>();

    if (aAnnotateScope === ANNOTATE_SCOPE_T.ANNOTATE_SELECTION)
      selectedSymbols = getInferredSymbols(selection);

    // Map of locked symbols
    const lockedSymbols: SCH_MULTI_UNIT_REFERENCE_MAP = new Map();

    // Map of previous annotation for building info messages
    const previousAnnotation = new Map<string, string>();

    // Test for and replace duplicate time stamps in symbols and sheets.  Duplicate time stamps
    // can happen with old schematics, schematic conversions, or manual editing of files.
    if (aRepairTimestamps) {
      const count = screens.ReplaceDuplicateTimeStamps();

      if (count)
        aReporter.ReportTail(
          `${count} duplicate time stamps were found and replaced.`,
          RPT_SEVERITY_WARNING,
        );
    }

    // Collect all the sets that must be annotated together. When regrouping, we skip this step
    // to allow fresh groupings based on symbol placement. When resetting without regrouping, we
    // collect locked symbols but then check for unit conflicts (duplicate units within a ref).
    if (!aRegroupUnits) {
      switch (aAnnotateScope) {
        case ANNOTATE_SCOPE_T.ANNOTATE_ALL:
          sheets.GetMultiUnitSymbols(lockedSymbols, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
          break;

        case ANNOTATE_SCOPE_T.ANNOTATE_CURRENT_SHEET:
          currentSheet.GetMultiUnitSymbols(lockedSymbols, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

          if (aRecursive)
            subSheets.GetMultiUnitSymbols(lockedSymbols, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

          break;

        case ANNOTATE_SCOPE_T.ANNOTATE_SELECTION:
          for (const symbol of selectedSymbols)
            currentSheet.AppendMultiUnitSymbol(lockedSymbols, symbol, aSymbolFilter);

          if (aRecursive) selectedSheets.GetMultiUnitSymbols(lockedSymbols, aSymbolFilter);

          break;
      }

      // When resetting annotations, check for and remove groups with unit conflicts (duplicate
      // units within the same reference designator). These will get fresh assignments.
      if (aResetAnnotation) {
        const conflictingRefs: string[] = [];

        for (const [refBase, refList] of lockedSymbols) {
          const seenUnits = new Set<number>();
          let hasConflict = false;

          for (let i = 0; i < refList.GetCount(); i++) {
            const ref = refList.at(i);

            if (seenUnits.has(ref.GetUnit())) {
              hasConflict = true;
              break;
            }

            seenUnits.add(ref.GetUnit());
          }

          if (hasConflict) conflictingRefs.push(refBase);
        }

        for (const ref of conflictingRefs) lockedSymbols.delete(ref);
      }
    }

    // Store previous annotations for building info messages
    this.mapExistingAnnotation(previousAnnotation);

    // Set sheet number and number of sheets.
    this.SetSheetNumberAndCount();

    // Build symbol list
    switch (aAnnotateScope) {
      case ANNOTATE_SCOPE_T.ANNOTATE_ALL:
        sheets.GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
        break;

      case ANNOTATE_SCOPE_T.ANNOTATE_CURRENT_SHEET:
        currentSheet.GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

        if (aRecursive)
          subSheets.GetSymbolsWithinPath(
            references,
            currentSheet,
            SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
            true,
          );

        break;

      case ANNOTATE_SCOPE_T.ANNOTATE_SELECTION:
        for (const symbol of selectedSymbols)
          currentSheet.AppendSymbol(references, symbol, aSymbolFilter, true);

        if (aRecursive)
          selectedSheets.GetSymbolsWithinPath(references, currentSheet, aSymbolFilter, true);

        break;
    }

    // Remove annotation only updates the "new" flag to indicate to the algorithm
    // that these references must be reannotated, but keeps the original reference
    // so that we can reannotate multi-unit symbols together.
    if (aResetAnnotation) references.RemoveAnnotation();

    // Build additional list of references to be used during reannotation
    // to avoid duplicate designators (no additional references when annotating
    // the full schematic)
    const additionalRefs = new SCH_REFERENCE_LIST();

    if (aAnnotateScope !== ANNOTATE_SCOPE_T.ANNOTATE_ALL) {
      const allRefs = new SCH_REFERENCE_LIST();
      sheets.GetSymbols(allRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

      for (let i = 0; i < allRefs.GetCount(); i++) {
        if (!references.Contains(allRefs.at(i))) additionalRefs.AddItem(allRefs.at(i));
      }
    }

    references.SetRefDesTracker(this.Schematic().Settings().m_refDesTracker);

    // Break full symbol reference into name (prefix) and number:
    // example: IC1 become IC, and 1
    references.SplitReferences();

    // Annotate all of the references we've collected by our options
    references.AnnotateByOptions(
      aSortOption,
      aAlgoOption,
      aStartNumber,
      lockedSymbols,
      additionalRefs,
      false,
    );

    for (let i = 0; i < references.GetCount(); i++) {
      const ref = references.at(i);
      const symbol = ref.GetSymbol();
      const sheet = ref.GetSheetPath();

      aCommit.Modify(symbol, sheet.LastScreen());
      ref.Annotate();

      const full_uuid = sheet.Path();
      full_uuid.push_back(symbol.m_Uuid);

      const prevRef = previousAnnotation.get(full_uuid.AsString()) ?? '';
      let newRef = symbol.GetRef(sheet);

      if (symbol.GetUnitCount() > 1) newRef += symbol.SubReference(symbol.GetUnitSelection(sheet));

      let msg: string;

      if (prevRef.length) {
        if (newRef === prevRef) continue;

        if (symbol.GetUnitCount() > 1) {
          msg = `Updated ${symbol.GetValue(true, sheet, false)} (unit ${symbol.SubReference(symbol.GetUnit(), false)}) from ${prevRef} to ${newRef}.`;
        } else {
          msg = `Updated ${symbol.GetValue(true, sheet, false)} from ${prevRef} to ${newRef}.`;
        }
      } else {
        if (symbol.GetUnitCount() > 1) {
          msg = `Annotated ${symbol.GetValue(true, sheet, false)} (unit ${symbol.SubReference(symbol.GetUnit(), false)}) as ${newRef}.`;
        } else {
          msg = `Annotated ${symbol.GetValue(true, sheet, false)} as ${newRef}.`;
        }
      }

      aReporter.Report(msg, RPT_SEVERITY_ACTION_LIVE);
    }

    // Final control (just in case ... ).
    if (
      !this.CheckAnnotate(
        (_aType, aMsg) => {
          aReporter.Report(aMsg, RPT_SEVERITY_ERROR);
        },
        aAnnotateScope,
        aRecursive,
        aSymbolFilter,
      )
    ) {
      aReporter.ReportTail('Annotation complete.', RPT_SEVERITY_ACTION_LIVE);
    }

    // Update on screen references, that can be modified by previous calculations:
    this.GetCurrentSheet().UpdateAllScreenReferences();
    this.SetSheetNumberAndCount();

    this.SyncView();
    this.GetCanvas()?.Refresh();
    this.OnModify();
  }

  /**
   * Check for annotation errors: symbols not annotated, duplicate references, units beyond the
   * symbol's count, different values between units of one reference.
   *
   * @return the number of errors found.
   */
  CheckAnnotate(
    this: SCH_EDIT_FRAME,
    aErrorHandler: ANNOTATION_ERROR_HANDLER,
    aAnnotateScope: ANNOTATE_SCOPE_T,
    aRecursive: boolean,
    aSymbolFilter: SYMBOL_FILTER,
  ): number {
    const referenceList = new SCH_REFERENCE_LIST();
    const sheets = this.Schematic().Hierarchy();
    const currentSheet = this.GetCurrentSheet();

    // Build the list of symbols
    switch (aAnnotateScope) {
      case ANNOTATE_SCOPE_T.ANNOTATE_ALL:
        sheets.GetSymbols(referenceList, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
        break;

      case ANNOTATE_SCOPE_T.ANNOTATE_CURRENT_SHEET:
        this.GetCurrentSheet().GetSymbols(referenceList, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);

        if (aRecursive) {
          for (const sheet of subSheetsOf(sheets, currentSheet))
            sheet.GetSymbols(referenceList, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);
        }

        break;

      case ANNOTATE_SCOPE_T.ANNOTATE_SELECTION: {
        const selection = annotationSelection(this);

        for (const symbol of getInferredSymbols(selection))
          this.GetCurrentSheet().AppendSymbol(referenceList, symbol, aSymbolFilter, true);

        if (aRecursive) {
          const selectedSheets = new SCH_SHEET_LIST();

          for (const item of selection) {
            if (item.Type() === KICAD_T.SCH_SHEET_T) {
              const subSheetPath = currentSheet.Clone();
              subSheetPath.push_back(item as unknown as SCH_SHEET);

              sheets.GetSheetsWithinPath(selectedSheets, subSheetPath);
            }
          }

          for (const sheet of selectedSheets) sheet.GetSymbols(referenceList, aSymbolFilter);
        }

        break;
      }
    }

    // Empty schematic does not need annotation
    if (referenceList.GetCount() === 0) return 0;

    return referenceList.CheckAnnotation(aErrorHandler);
  }
}
