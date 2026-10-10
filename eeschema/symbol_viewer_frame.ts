// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_VIEWER_FRAME` (`eeschema/symbol_viewer_frame.cpp`), the Symbol
 * Library Browser's logic: the library/symbol filtering
 * (`ReCreateLibList`/`ReCreateSymbolList`) and the `SYMBOL_VIEWER_FRAME_APP`
 * seam the window (`symbol_viewer_frame_ui.tsx`) reads designer through.
 * `eeschema` never imports `designer`; the designer-side
 * `useSymbolViewerFrameApp()` (`designer/src/editors/schematic/eeschema_app.tsx`)
 * is the one file that answers this interface, the same job
 * `symbol_editor/symbol_edit_frame_app.ts` does for `SYMBOL_EDIT_FRAME_APP`.
 */
import type { ReactNode } from 'react';
import { EdaCombinedMatcher } from '@ziroeda/common';
import type { EESCHEMA_SETTINGS_STORE } from './browser/eeschema_app.js';
import type { Theme } from './sch_render_settings.js';
import type { LibSymbol } from './types.js';
import {
  symbolPinCount,
  symbolSearchTerms,
  type LibIndexEntry,
} from './libraries/symbol_library_adapter.js';

export interface SYMBOL_VIEWER_FRAME_APP {
  settings: EESCHEMA_SETTINGS_STORE;
  /** `SCH_RENDER_SETTINGS::LoadColors` of the active colour theme, for this render. */
  useSchematicTheme(): Theme;
  /** The hosted symbol library index. */
  loadIndex(): Promise<readonly LibIndexEntry[]>;
  /** Every symbol of one library, whole (the browser filters on more than names). */
  loadLibrarySymbols(library: string): Promise<LibSymbol[]>;
  /** LIBRARY_MANAGER::GetFullURI, for the frame title. */
  libraryUri(library: string): string;
  /** The "still loading" pane the library list shows. */
  LibraryLoadingPanel: (props: {
    kind?: 'symbols';
    fallback?: ReactNode;
    label?: string;
  }) => ReactNode;
}

/** LIB_SYMBOL::GetUnitCount, the highest unit number the symbol defines. */
export function unitCount(sym: LibSymbol): number {
  return Math.max(1, ...sym.units.map((u) => u.unit));
}

/** LIB_SYMBOL::HasDeMorganBodyStyles, a body style 2 (`_1_2`, `_2_2`, …) exists. */
export function hasDeMorgan(sym: LibSymbol): boolean {
  return sym.units.some((u) => u.bodyStyle === 2);
}

/** The tokenizer both filters use: whitespace-separated terms (wxTOKEN_STRTOK). */
export function filterTerms(filter: string): string[] {
  return filter.split(/[ \t\r\n]+/).filter(Boolean);
}

/** LIB_ID::GetLibItemName, the list shows names, not full ids. */
export function symbolName(sym: LibSymbol): string {
  return sym.libId.split(':').pop() ?? sym.libId;
}

/**
 * `SYMBOL_VIEWER_FRAME::ReCreateLibList`: every library the filter admits,
 * pinned ones first. A filter is a set of terms, each matched against every
 * library name; a library that any term matches is listed (upstream's
 * per-term sweep). One difference kept from before the move: upstream runs
 * `process( lib )` once per matching term with no de-duplication, so a library
 * two terms both match is appended twice; this lists it once.
 */
export function filterLibraries(
  index: readonly LibIndexEntry[],
  filter: string,
  pinned: readonly string[],
): LibIndexEntry[] {
  const terms = filterTerms(filter);
  let matches: LibIndexEntry[];
  if (terms.length === 0) {
    matches = [...index];
  } else {
    const seen = new Set<string>();
    matches = [];
    for (const term of terms) {
      const matcher = new EdaCombinedMatcher(term.toLowerCase());
      for (const lib of index) {
        if (matcher.find(lib.name.toLowerCase()) >= 0 && !seen.has(lib.name)) {
          seen.add(lib.name);
          matches.push(lib);
        }
      }
    }
  }
  return [
    ...matches.filter((l) => pinned.includes(l.name)),
    ...matches.filter((l) => !pinned.includes(l.name)),
  ];
}

/**
 * `SYMBOL_VIEWER_FRAME::ReCreateSymbolList`: each filter term must score
 * against the symbol's search terms (a term which is a number also matches
 * the pin count); a term that scores nothing excludes the symbol.
 */
export function filterSymbols(libSymbols: readonly LibSymbol[], filter: string): LibSymbol[] {
  const terms = filterTerms(filter);
  if (terms.length === 0) return [...libSymbols];
  const excludes = new Set<string>();
  for (const term of terms) {
    const lower = term.toLowerCase();
    const matcher = new EdaCombinedMatcher(lower);
    const asNumber = /^-?\d+$/.test(term) ? Number(term) : null;
    for (const sym of libSymbols) {
      let matched = matcher.scoreTerms(symbolSearchTerms(sym)).score;
      if (asNumber !== null && asNumber === symbolPinCount(sym)) matched++;
      if (!matched) excludes.add(sym.libId);
    }
  }
  return libSymbols.filter((s) => !excludes.has(s.libId));
}
