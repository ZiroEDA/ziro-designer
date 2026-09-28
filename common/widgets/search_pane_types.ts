// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SEARCH_HANDLER`'s data types, split out of `search_pane.tsx` the way
 * `action_menu_types.ts` was split out of `action_menu_bar.tsx`: a per-editor
 * handler set — `eeschema/widgets/search_handlers.ts` — is a plain `.ts`
 * module in a package with no `--jsx`, and importing so much as a type from a
 * `.tsx` file fails its `tsc` (`TS6142`). Nothing here needs React; only the
 * widget that renders these types does.
 */

/** `wxListColumnFormat`, the three the base ctor is ever called with. */
export type SearchColumnAlign = 'left' | 'center' | 'right';

/**
 * One entry of `SEARCH_HANDLER::GetColumns()`'s
 * `std::tuple<wxString, int, wxListColumnFormat>`.
 *
 * `proportion` is upstream's raw column-width unit (`SEARCH_PANE_LISTVIEW::
 * RefreshColumnNames`: `SetColumnWidth( ii, (clientWidth / 10) * proportion )`
 * — search_pane_tab.cpp:299-314), carried over unscaled: a `<colgroup>`'s
 * percentage widths are renormalised to the table's own width by the CSS
 * table layout algorithm when they do not sum to 100, which is exactly what
 * upstream's "tenths of the client width" arithmetic is for, so the same
 * numbers reproduce the same ratios without inventing a second scale.
 */
export interface SearchColumn {
  readonly name: string;
  readonly proportion: number;
  readonly align: SearchColumnAlign;
}

/**
 * `SEARCH_HANDLER` (`include/widgets/search_pane.h:34-59`), the per-editor
 * data interface. One instance per notebook tab.
 */
export interface SearchHandler {
  /** `GetName()` — the tab's label, e.g. `_HKI( "Symbols" )`. */
  readonly name: string;
  /** `GetColumns()`. */
  readonly columns: readonly SearchColumn[];
  /** `Search( aQuery )`: (re)build the hitlist and return its length. */
  search(query: string): number;
  /** `GetResultCell( aRow, aCol )`. */
  getResultCell(row: number, col: number): string;
  /**
   * `Sort( aCol, aAscending, aSelection )`. Reorders the handler's own
   * hitlist and returns the given row indices remapped to their new
   * positions — upstream mutates `aSelection` in place; this returns it,
   * since a TS interface has no output parameters.
   */
  sort(col: number, ascending: boolean, selection: readonly number[]): number[];
  /** `SelectItems( aItemRows )`. Optional: the base class default is a no-op. */
  selectItems?(rows: readonly number[]): void;
  /** `ActivateItem( aItemRow )` (double-click / Enter). Optional; same default. */
  activateItem?(row: number): void;
  /**
   * Not in `SEARCH_HANDLER`. Upstream's listview owns its selection and only
   * ever pushes it *out* through `SelectItems` — nothing pushes a canvas pick
   * back in, so selecting a symbol on the sheet leaves its row unhighlighted.
   * eeschema's panel deliberately goes further (a decision from 2026-08-09,
   * pinned in `qa/unittests/eeschema/search_selection_ids.test.ts` and
   * `qa/unittests/designer/search_panel_selection.test.ts`): the row lights up
   * whichever way you picked the item, which needs the handler to answer
   * "is this row part of the live selection" rather than only ever emitting
   * one. Left unset, a row only ever shows the selection it made itself.
   */
  isRowSelected?(row: number): boolean;
}

/** `APP_SETTINGS_BASE::SEARCH_PANE` — `SEARCH_PANE_MENU`'s own state. */
export interface SearchPaneMenuState {
  /** `SELECTION_ZOOM`. */
  selectionZoom: 'none' | 'pan' | 'zoom';
  /** `search_pane.search_hidden_fields`. */
  searchHiddenFields: boolean;
  /** `search_pane.search_metadata`. */
  searchMetadata: boolean;
}
