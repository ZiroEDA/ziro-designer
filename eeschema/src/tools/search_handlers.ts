// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Search panel's result sets. Counterpart:
 * `eeschema/widgets/search_handlers.cpp` — `SYMBOL_SEARCH_HANDLER`,
 * `POWER_SEARCH_HANDLER`, `TEXT_SEARCH_HANDLER` and `LABEL_SEARCH_HANDLER`.
 *
 * Each handler is a query over the sheet plus the columns its tab shows, and
 * that pairing is the whole of the panel's behaviour — the widget only renders
 * rows and selects what you click. So the handlers live here, testable, and the
 * panel is a consumer.
 *
 * Two rules from upstream are easy to get backwards and are what the tests pin:
 *
 *  - **Symbols and power symbols are disjoint.** `SYMBOL_SEARCH_HANDLER`
 *    rejects `IsPower()` and `POWER_SEARCH_HANDLER` requires it, so a power
 *    symbol appears on exactly one tab rather than both.
 *  - **The query is matched permissively**, not as a substring: upstream sets
 *    `EDA_SEARCH_MATCH_MODE::PERMISSIVE`, which tries regex, then wildcard,
 *    then substring, so `R?` and `^R1$` both work without a mode selector.
 */

import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { matchesText, type SchSearchData, defaultSearchData } from './sch_find_replace_tool.js';

/** Which tab a hit belongs to (one handler each). */
export type SearchKind = 'symbol' | 'power' | 'text' | 'label';

export interface SearchHit {
  kind: SearchKind;
  /** The item's stable id, for selecting it when the row is clicked. */
  id: string;
  /** The row's cells, in the order that tab's columns are declared. */
  cells: string[];
  /** Where to centre the view on a double-click (SEARCH_HANDLER::FocusItem). */
  at: Vec2;
}

/** The columns each tab shows, in upstream's order. */
export const SEARCH_COLUMNS: Record<SearchKind, readonly string[]> = {
  // The full symbol tab has twelve columns upstream; the attribute and library
  // ones are omitted here because the panel has nowhere to put them yet, and a
  // column that is always blank is worse than none.
  symbol: ['Reference', 'Value', 'Footprint', 'X', 'Y'],
  power: ['Reference', 'Value', 'X', 'Y'],
  text: ['Type', 'Text', 'X', 'Y'],
  label: ['Type', 'Name', 'X', 'Y'],
};

/** The panel's search data: everything default except the mode and field scope. */
export function searchPaneData(query: string, searchHiddenFields = false): SchSearchData {
  return {
    ...defaultSearchData(),
    findString: query,
    // "Try to handle whatever the user throws at us."
    matchMode: 'permissive',
    searchAllFields: searchHiddenFields,
    // The panel searches the whole hierarchy, not the open sheet.
    searchCurrentSheetOnly: false,
  };
}

/**
 * X and Y are shown in the user's units, as upstream's
 * `MessageTextFromValue` does; the caller injects the formatter for the same
 * reason the message panel does — the engine has no notion of the frame's unit
 * setting. Raw internal units is the fallback, not the intent.
 */
export type ValueFormatter = (iu: number) => string;

/** The label kinds' display names, as the Type column shows them. */
const LABEL_TYPE: Record<string, string> = {
  label: 'Local',
  global_label: 'Global',
  hierarchical_label: 'Hierarchical',
};

/**
 * Every hit for `query`, across all four handlers.
 *
 * An empty query returns nothing rather than everything: upstream's
 * `matchesText` bails on an empty `findString`, and a panel that lists the
 * whole schematic the moment it opens is not a search result.
 */
export function searchSchematic(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  query: string,
  searchHiddenFields = false,
  fmt: ValueFormatter = (n) => String(n),
): SearchHit[] {
  const d = searchPaneData(query, searchHiddenFields);
  if (!d.findString) return [];
  const hits: SearchHit[] = [];

  sch.symbols.forEach((sym, i) => {
    const lib = libById.get(sym.libId);
    // IsPower depends on a resolved library symbol; an unresolved one is not
    // treated as power, which is upstream's !IsMissingLibSymbol() guard.
    const isPower = lib?.isPower ?? false;
    const field = (key: string): string => sym.fields.find((f) => f.key === key)?.value ?? '';
    // A field is searched when it is visible, or when hidden fields are in
    // scope (searchAllFields).
    const searchable = sym.fields.filter((f) => searchHiddenFields || !f.effects?.hidden);
    if (!searchable.some((f) => matchesText(f.value, d))) return;
    const at = [fmt(sym.at.x), fmt(sym.at.y)];
    hits.push(
      isPower
        ? {
            kind: 'power',
            id: refId('symbol', sym.uuid, i),
            cells: [field('Reference'), field('Value'), ...at],
            at: sym.at,
          }
        : {
            kind: 'symbol',
            id: refId('symbol', sym.uuid, i),
            cells: [field('Reference'), field('Value'), field('Footprint'), ...at],
            at: sym.at,
          },
    );
  });

  sch.labels.forEach((l, i) => {
    if (!matchesText(l.text, d)) return;
    const at = [fmt(l.at.x), fmt(l.at.y)];
    // Free text is the text handler's; the three label kinds are the label
    // handler's. Upstream splits them the same way.
    hits.push(
      l.kind === 'text'
        ? { kind: 'text', id: refId('label', l.uuid, i), cells: ['Text', l.text, ...at], at: l.at }
        : {
            kind: 'label',
            id: refId('label', l.uuid, i),
            cells: [LABEL_TYPE[l.kind] ?? l.kind, l.text, ...at],
            at: l.at,
          },
    );
  });

  sch.textBoxes.forEach((tb, i) => {
    if (!matchesText(tb.text, d)) return;
    hits.push({
      kind: 'text',
      id: refId('textbox', tb.uuid, i),
      cells: ['Text Box', tb.text, fmt(tb.start.x), fmt(tb.start.y)],
      at: tb.start,
    });
  });

  return hits;
}

/** The hits for one tab, in document order. */
export const hitsOfKind = (hits: readonly SearchHit[], kind: SearchKind): SearchHit[] =>
  hits.filter((h) => h.kind === kind);
