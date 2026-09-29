// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/symbol_import_manager.cpp`/`.h`: `SYMBOL_IMPORT_MANAGER`, the
 * selection/dependency state machine behind "Import Symbol(s)" (choosing a
 * subset of a source library's symbols to bring in, auto-selecting a derived
 * symbol's ancestors, and flagging name conflicts with the destination
 * library). Upstream's own header calls this out as "designed to be
 * UI-independent for testability" — no `LIB_SYMBOL` methods are actually
 * called, only stored, so this file has no rendering/library dependency
 * either.
 *
 * `std::map<wxString, …>` iteration is name order (`wxString::operator<`, a
 * code-unit ordering); the methods that build a return value by iterating
 * `m_symbols` sort by that order explicitly, since a `Map` iterates by
 * insertion order instead. Likewise `GetAncestors`/`GetDescendants` return a
 * `std::set<wxString>` (always sorted); the `Set` this returns is built by
 * inserting in sorted order so a caller's `for…of` sees the same order.
 */

import type { LIB_SYMBOL } from './lib_symbol.js';

/** `wxString::operator<`: a code-unit ordering. */
const wxLess = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Information about a symbol available for import. */
export interface SYMBOL_IMPORT_INFO {
  /** Symbol name */
  m_name: string;
  /**
   * Loaded symbol (may be null). `unique_ptr<LIB_SYMBOL>` upstream; this file
   * only stores/returns it (never calls a `LIB_SYMBOL` method), so plain
   * ownership by reference stands in for the `unique_ptr`.
   */
  m_symbol: LIB_SYMBOL | null;
  /** Parent symbol name if derived */
  m_parentName: string;
  /** True if power symbol */
  m_isPower: boolean;
  /** True if symbol exists in destination library */
  m_existsInDest: boolean;
  /** User's manual selection state */
  m_checked: boolean;
  /** True if auto-selected as dependency */
  m_autoSelected: boolean;
}

/** Result of conflict resolution for a single symbol. */
export enum CONFLICT_RESOLUTION {
  /** Don't import this symbol */
  SKIP = 0,
  /** Overwrite existing symbol */
  OVERWRITE = 1,
}

/** `SYMBOL_EXISTS_FUNC`: true if `symbolName` already exists in the destination. */
export type SYMBOL_EXISTS_FUNC = (symbolName: string) => boolean;

/**
 * Manages the logic for selecting symbols to import from a library file.
 *
 * This class handles:
 * - Loading and tracking symbol metadata from source libraries
 * - Building dependency graphs for derived symbols
 * - Auto-selecting parent symbols when derived symbols are selected
 * - Tracking conflicts with existing symbols in destination library
 * - Filtering symbols by search criteria
 */
export class SYMBOL_IMPORT_MANAGER {
  /** All symbols available for import, keyed by name */
  private m_symbols = new Map<string, SYMBOL_IMPORT_INFO>();
  /** Map from symbol name to its parent name (for derived symbols) */
  private m_parentMap = new Map<string, string>();
  /** Map from parent name to list of direct derivative names */
  private m_derivativesMap = new Map<string, string[]>();

  /** `m_symbols` names, in `std::map` (code-unit) order. */
  private sortedNames(): string[] {
    return [...this.m_symbols.keys()].sort(wxLess);
  }

  /** `m_symbols` entries, in `std::map` (code-unit) order. */
  private sortedEntries(): [string, SYMBOL_IMPORT_INFO][] {
    return this.sortedNames().map((name) => [name, this.m_symbols.get(name)!]);
  }

  /** Clear all loaded symbols and reset state. */
  Clear(): void {
    this.m_symbols.clear();
    this.m_parentMap.clear();
    this.m_derivativesMap.clear();
  }

  /** Add a symbol to the import list. */
  AddSymbol(
    aName: string,
    aParentName: string,
    aIsPower: boolean,
    aSymbol: LIB_SYMBOL | null = null,
  ): void {
    this.m_symbols.set(aName, {
      m_name: aName,
      m_symbol: aSymbol,
      m_parentName: aParentName,
      m_isPower: aIsPower,
      m_existsInDest: false,
      m_checked: false,
      m_autoSelected: false,
    });
  }

  /** Mark symbols that exist in the destination library. */
  CheckExistingSymbols(aExistsFunc: SYMBOL_EXISTS_FUNC): void {
    for (const [name, info] of this.sortedEntries()) info.m_existsInDest = aExistsFunc(name);
  }

  /** Build the dependency maps from parent relationships. Call after all symbols are added. */
  BuildDependencyMaps(): void {
    this.m_parentMap.clear();
    this.m_derivativesMap.clear();

    for (const [name, info] of this.sortedEntries()) {
      if (info.m_parentName !== '') {
        this.m_parentMap.set(name, info.m_parentName);

        const derivatives = this.m_derivativesMap.get(info.m_parentName);
        if (derivatives) derivatives.push(name);
        else this.m_derivativesMap.set(info.m_parentName, [name]);
      }
    }
  }

  /** Get all symbol names. */
  GetSymbolNames(): string[] {
    return this.sortedNames();
  }

  /** Get symbol info by name, or null if not found. */
  GetSymbolInfo(aName: string): SYMBOL_IMPORT_INFO | null {
    return this.m_symbols.get(aName) ?? null;
  }

  /** Get all ancestors of a symbol (full inheritance chain), sorted. */
  GetAncestors(aSymbolName: string): Set<string> {
    const ancestors: string[] = [];
    let current = aSymbolName;

    while (true) {
      const parent = this.m_parentMap.get(current);

      if (parent === undefined || parent === '') break;
      if (!this.m_symbols.has(parent)) break;

      ancestors.push(parent);
      current = parent;
    }

    return new Set(ancestors.sort(wxLess));
  }

  /** Get all descendants of a symbol (all derived symbols recursively), sorted. */
  GetDescendants(aSymbolName: string): Set<string> {
    const descendants = new Set<string>();
    const toProcess = [aSymbolName];

    while (toProcess.length > 0) {
      const current = toProcess.pop()!;
      const children = this.m_derivativesMap.get(current);

      if (children) {
        for (const child of children) {
          if (!descendants.has(child)) {
            descendants.add(child);
            toProcess.push(child);
          }
        }
      }
    }

    return new Set([...descendants].sort(wxLess));
  }

  /** Get the direct parent of a symbol, or '' if none. */
  GetParent(aSymbolName: string): string {
    return this.m_parentMap.get(aSymbolName) ?? '';
  }

  /** Get direct children (derivatives) of a symbol, in the order BuildDependencyMaps built them. */
  GetDirectDerivatives(aSymbolName: string): string[] {
    return [...(this.m_derivativesMap.get(aSymbolName) ?? [])];
  }

  /** Check if a symbol is derived from another. */
  IsDerived(aSymbolName: string): boolean {
    const parent = this.m_parentMap.get(aSymbolName);
    return parent !== undefined && parent !== '';
  }

  /**
   * Set the selection state of a symbol. This handles auto-selection of
   * ancestors.
   *
   * @returns the names of symbols whose auto-selection state changed:
   * exactly the newly-auto-selected ancestors when selecting, or every other
   * symbol name (a full recalculation ran) when deselecting.
   */
  SetSymbolSelected(aSymbolName: string, aSelected: boolean): string[] {
    const changedSymbols: string[] = [];
    const info = this.GetSymbolInfo(aSymbolName);

    if (!info) return changedSymbols;

    if (aSelected) {
      info.m_checked = true;
      info.m_autoSelected = false;

      for (const ancestor of this.GetAncestors(aSymbolName)) {
        const ancestorInfo = this.GetSymbolInfo(ancestor);

        if (ancestorInfo && !ancestorInfo.m_checked && !ancestorInfo.m_autoSelected) {
          ancestorInfo.m_autoSelected = true;
          changedSymbols.push(ancestor);
        }
      }
    } else {
      info.m_checked = false;
      info.m_autoSelected = false;

      this.recalculateAutoSelections();

      for (const name of this.sortedNames()) {
        if (name !== aSymbolName) changedSymbols.push(name);
      }
    }

    return changedSymbols;
  }

  /** Get selected descendants that would be orphaned if a symbol is deselected. */
  GetSelectedDescendants(aSymbolName: string): string[] {
    const selectedDescendants: string[] = [];

    for (const desc of this.GetDescendants(aSymbolName)) {
      const info = this.GetSymbolInfo(desc);
      if (info?.m_checked) selectedDescendants.push(desc);
    }

    return selectedDescendants;
  }

  /** Force deselection of a symbol and all its descendants, after a confirmed cascade. */
  DeselectWithDescendants(aSymbolName: string): void {
    const info = this.GetSymbolInfo(aSymbolName);

    if (info) {
      info.m_checked = false;
      info.m_autoSelected = false;
    }

    for (const desc of this.GetDescendants(aSymbolName)) {
      const descInfo = this.GetSymbolInfo(desc);

      if (descInfo) {
        descInfo.m_checked = false;
        descInfo.m_autoSelected = false;
      }
    }

    this.recalculateAutoSelections();
  }

  /** Select all symbols (optionally filtered). */
  SelectAll(aFilter?: (name: string) => boolean): void {
    for (const [name, info] of this.sortedEntries()) {
      if (!aFilter || aFilter(name)) {
        info.m_checked = true;
        info.m_autoSelected = false;
      }
    }

    this.recalculateAutoSelections();
  }

  /** Deselect all symbols (optionally filtered). */
  DeselectAll(aFilter?: (name: string) => boolean): void {
    for (const [name, info] of this.sortedEntries()) {
      if (!aFilter || aFilter(name)) {
        info.m_checked = false;
        info.m_autoSelected = false;
      }
    }

    this.recalculateAutoSelections();
  }

  /** Get list of all symbols that will be imported (checked + auto-selected). */
  GetSymbolsToImport(): string[] {
    return this.sortedEntries()
      .filter(([, info]) => info.m_checked || info.m_autoSelected)
      .map(([name]) => name);
  }

  /** Get count of manually selected symbols. */
  GetManualSelectionCount(): number {
    let count = 0;
    for (const info of this.m_symbols.values()) if (info.m_checked) count++;
    return count;
  }

  /** Get count of auto-selected symbols (dependencies). */
  GetAutoSelectionCount(): number {
    let count = 0;
    for (const info of this.m_symbols.values()) if (info.m_autoSelected && !info.m_checked) count++;
    return count;
  }

  /** Get list of symbols that will conflict (selected and exist in destination). */
  GetConflicts(): string[] {
    return this.sortedEntries()
      .filter(([, info]) => (info.m_checked || info.m_autoSelected) && info.m_existsInDest)
      .map(([name]) => name);
  }

  /** Check if a symbol name matches a filter string (case-insensitive contains). */
  static MatchesFilter(aSymbolName: string, aFilter: string): boolean {
    if (aFilter === '') return true;
    return aSymbolName.toLowerCase().includes(aFilter.toLowerCase());
  }

  /** Get total number of symbols. */
  GetSymbolCount(): number {
    return this.m_symbols.size;
  }

  /** Recalculate auto-selection state for all symbols based on current manual selections. */
  private recalculateAutoSelections(): void {
    // Clear all auto-selections
    for (const info of this.m_symbols.values()) info.m_autoSelected = false;

    // Re-apply auto-selections for all checked symbols
    for (const [name, info] of this.sortedEntries()) {
      if (info.m_checked) {
        for (const ancestor of this.GetAncestors(name)) {
          const ancestorInfo = this.GetSymbolInfo(ancestor);
          if (ancestorInfo && !ancestorInfo.m_checked) ancestorInfo.m_autoSelected = true;
        }
      }
    }
  }
}
