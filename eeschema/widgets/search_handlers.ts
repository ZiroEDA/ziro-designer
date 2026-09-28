// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/widgets/search_handlers.cpp` + `sch_search_pane.cpp`: the four
 * `SCH_SEARCH_HANDLER` subclasses `SCH_SEARCH_PANE`'s constructor adds, in
 * this order — `SYMBOL_SEARCH_HANDLER`, `POWER_SEARCH_HANDLER`,
 * `TEXT_SEARCH_HANDLER`, `LABEL_SEARCH_HANDLER` — over the common
 * `SEARCH_HANDLER` contract (`common/widgets/search_pane.tsx`).
 *
 * The four share one implementation here (`SchSearchHandler`) because they
 * share one implementation upstream too: every `Search()` override calls the
 * same `FindAll` and differs only in its predicate and its columns, and the
 * predicates already live, tested, in `eeschema/tools/search_handlers.ts`
 * (`searchSchematic` classifies every hit into exactly one of `SearchKind`,
 * which the four handlers below only need to filter by). `Sort` and
 * `GetResultCell` are `SCH_SEARCH_HANDLER`'s own shared bodies
 * (search_handlers.cpp:69-100, :49-63) and are one method here for the same
 * reason.
 *
 * ## `GROUP_SEARCH_HANDLER` is not ported
 *
 * Upstream adds a fifth handler for `SCH_GROUP`. This engine's selection
 * model has no group entry: `ItemRef['kind']` (`eeschema/tools/hittest.ts`)
 * has no `'group'`, because `scene_bbox.ts` groups carry no geometry or
 * selectable identity of their own — "each member already contributes its
 * own box, so giving the group one too would double-count". A "Groups" tab
 * could still list hits, but `SelectItems` would have nothing on the canvas
 * to select or pan to: a tab that searches but cannot act on its own results
 * is worse than the honest gap, so it is left out rather than half-built.
 *
 * ## Wiring, not upstream
 *
 * `SelectItems` upstream reaches through `m_frame` for the tool manager, the
 * config and the canvas. This has none of those, so the callbacks and the
 * live selection it needs are handed in as `SchSearchWiring`, read through a
 * ref so the four handler objects stay the same instances across a
 * selection change — matching upstream's handlers, which are constructed
 * once and live for the frame's lifetime, not rebuilt on every pick.
 */
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import type { SearchColumn, SearchHandler } from '@ziroeda/common/widgets/search_pane_types.js';
import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import {
  hitsOfKind,
  searchSchematic,
  type SearchHit,
  type SearchKind,
  type ValueFormatter,
} from '../tools/search_handlers.js';

/**
 * `GetColumns()`'s `std::tuple<wxString, int, wxListColumnFormat>` for the
 * columns this engine actually produces cells for
 * (`eeschema/tools/search_handlers.ts`'s `SEARCH_COLUMNS`, which is missing
 * `Page` and the symbol tab's attribute/library columns — "the panel has
 * nowhere to put them yet"). Proportions and alignment are upstream's own
 * values for the columns kept, not renormalised or invented
 * (search_handlers.cpp:160-172, 259-263, 334-338, 422-426).
 */
const COLUMNS: Record<SearchKind, readonly SearchColumn[]> = {
  symbol: [
    { name: 'Reference', proportion: 2, align: 'left' },
    { name: 'Value', proportion: 6, align: 'left' },
    { name: 'Footprint', proportion: 10, align: 'left' },
    { name: 'X', proportion: 3, align: 'center' },
    { name: 'Y', proportion: 3, align: 'center' },
  ],
  power: [
    { name: 'Reference', proportion: 2, align: 'left' },
    { name: 'Value', proportion: 6, align: 'left' },
    { name: 'X', proportion: 3, align: 'center' },
    { name: 'Y', proportion: 3, align: 'center' },
  ],
  text: [
    { name: 'Type', proportion: 2, align: 'left' },
    { name: 'Text', proportion: 12, align: 'left' },
    { name: 'X', proportion: 3, align: 'center' },
    { name: 'Y', proportion: 3, align: 'center' },
  ],
  label: [
    { name: 'Type', proportion: 2, align: 'left' },
    { name: 'Name', proportion: 6, align: 'left' },
    { name: 'X', proportion: 3, align: 'center' },
    { name: 'Y', proportion: 3, align: 'center' },
  ],
};

/** `_HKI(...)` — `AddSearcher`'s order, `sch_search_pane.cpp:37-41`. */
const SPEC: readonly { name: string; kind: SearchKind }[] = [
  { name: 'Symbols', kind: 'symbol' },
  { name: 'Power', kind: 'power' },
  { name: 'Text', kind: 'text' },
  { name: 'Labels', kind: 'label' },
];

/**
 * What `SCH_SEARCH_HANDLER::SelectItems` reaches through `m_frame` for
 * (search_handlers.cpp:103-154): the live selection, the pan/zoom setting,
 * and the callbacks that stand in for `ACTIONS::selectItems` /
 * `centerSelection` / `zoomFitSelection`.
 */
export interface SchSearchWiring {
  /** `APP_SETTINGS_BASE::SEARCH_PANE::selection_zoom`. */
  selectionZoom: 'none' | 'pan' | 'zoom';
  /** `ACTIONS::selectItems`. */
  onSelect: (id: string) => void;
  /** `ACTIONS::centerSelection`, only for `selectionZoom === 'pan'`. */
  onCenter?: (id: string, at: Vec2) => void;
  /** `ACTIONS::zoomFitSelection`, only for `selectionZoom === 'zoom'`. */
  onZoomFit?: (id: string, at: Vec2) => void;
  /** `ACTIONS::selectionClear`, run when the row list is empty. */
  onClearSelection?: () => void;
  /** The editor's live selection — see `SearchHandler.isRowSelected`. */
  selection?: ReadonlySet<string>;
}

/** `SCH_SEARCH_HANDLER`. One instance per tab, sharing `Search`'s predicate. */
class SchSearchHandler implements SearchHandler {
  private hitlist: SearchHit[] = [];

  constructor(
    readonly name: string,
    private readonly kind: SearchKind,
    readonly columns: readonly SearchColumn[],
    private readonly runSearch: (query: string) => readonly SearchHit[],
    private readonly wiring: { current: SchSearchWiring },
  ) {}

  /** `SYMBOL_SEARCH_HANDLER::Search` &c: `FindAll` then the tab's predicate. */
  search(query: string): number {
    this.hitlist = hitsOfKind(this.runSearch(query), this.kind);
    return this.hitlist.length;
  }

  /** `SCH_SEARCH_HANDLER::GetResultCell` (search_handlers.cpp:49-63). */
  getResultCell(row: number, col: number): string {
    return this.hitlist[row]?.cells[col] ?? '';
  }

  /** `SCH_SEARCH_HANDLER::Sort` (search_handlers.cpp:69-100). */
  sort(col: number, ascending: boolean, selection: readonly number[]): number[] {
    const selected = new Set(
      selection.map((i) => this.hitlist[i]).filter((h): h is SearchHit => h !== undefined),
    );
    // "Provide a stable order by sorting on first column if no sort column
    // provided."
    const c = Math.max(0, col);
    const cellOf = (h: SearchHit): string => h.cells[c] ?? '';

    this.hitlist = [...this.hitlist].sort((a, b) =>
      ascending ? strNumCmp(cellOf(a), cellOf(b), true) : strNumCmp(cellOf(b), cellOf(a), true),
    );

    const remapped: number[] = [];
    this.hitlist.forEach((h, i) => {
      if (selected.has(h)) remapped.push(i);
    });
    return remapped;
  }

  /**
   * `SCH_SEARCH_HANDLER::SelectItems` (search_handlers.cpp:103-154), minus
   * the "all hits on the same sheet" branch: this engine searches one open
   * sheet at a time (`eeschema/tools/search_handlers.ts` walks `sch`
   * directly, not a whole hierarchy of screens), so every hit is already on
   * it.
   */
  selectItems(rows: readonly number[]): void {
    const wiring = this.wiring.current;
    const hits = rows.map((r) => this.hitlist[r]).filter((h): h is SearchHit => h !== undefined);

    if (hits.length === 0) {
      wiring.onClearSelection?.();
      return;
    }

    const hit = hits[0]!;
    wiring.onSelect(hit.id);

    if (wiring.selectionZoom === 'pan') wiring.onCenter?.(hit.id, hit.at);
    else if (wiring.selectionZoom === 'zoom') wiring.onZoomFit?.(hit.id, hit.at);
  }

  /** The cross-highlight superset — see `SearchHandler.isRowSelected`. */
  isRowSelected(row: number): boolean {
    const hit = this.hitlist[row];
    return hit !== undefined && (this.wiring.current.selection?.has(hit.id) ?? false);
  }
}

/**
 * `SCH_SEARCH_PANE`'s constructor: one `SchSearchHandler` per tab, in
 * upstream's order, sharing one `runSearch` closure over the open sheet.
 */
export function makeSchSearchHandlers(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  fmt: ValueFormatter,
  searchHiddenFields: boolean,
  wiring: { current: SchSearchWiring },
): SearchHandler[] {
  const runSearch = (query: string): SearchHit[] =>
    searchSchematic(doc, libById, query, searchHiddenFields, fmt);

  return SPEC.map(
    ({ name, kind }) => new SchSearchHandler(name, kind, COLUMNS[kind], runSearch, wiring),
  );
}
