// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SEARCH_PANE_TAB` + `SEARCH_PANE_LISTVIEW` (`include/widgets/
 * search_pane_tab.h`, `common/widgets/search_pane_tab.cpp`): one notebook
 * page, a `wxListView( wxLC_REPORT | wxLC_VIRTUAL )` over its handler's
 * hitlist.
 *
 * Ported: `RefreshColumnNames` (the column widths), `OnColClicked` (sort
 * toggling and the selection remap), `OnItemSelected`/`OnItemActivated`
 * (`SelectItems`/`ActivateItem`), and the blank-area click that
 * `search_panel_selection.test.ts` documents as upstream (a click on empty
 * list space deselects every row in a `wxListCtrl`).
 *
 * Not ported, to keep this to the panel's stated contract: `OnChar`'s
 * Ctrl+A/Ctrl+C/arrow-key row navigation and `CopySelectionToClipboard`. None
 * of eeschema's four handlers are wired to more than a single-row click today
 * (`SearchPanel.tsx`), so porting keyboard multi-select here would be an
 * untested surface with nothing exercising it.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { SearchColumnAlign, SearchHandler } from './search_pane_types.js';

const ALIGN: Record<SearchColumnAlign, 'left' | 'center' | 'right'> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

export function SearchPaneTab({
  handler,
  query,
  onActivate,
}: {
  handler: SearchHandler;
  query: string;
  onActivate?: (row: number) => void;
}): JSX.Element {
  const [sortCol, setSortCol] = useState(-1);
  const [sortAscending, setSortAscending] = useState(true);
  const [count, setCount] = useState(0);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  // Read inside the search effect without making the sort toggle re-run it —
  // `OnColClicked` below already re-sorts and re-selects on its own, so the
  // effect only needs whichever sort was already in effect the moment a new
  // search runs (`SEARCH_PANE_TAB::Search` calls the columnless `Sort()`).
  const sortRef = useRef({ col: sortCol, ascending: sortAscending });
  sortRef.current = { col: sortCol, ascending: sortAscending };

  // `SEARCH_PANE_TAB::Search( query )`, run on mount (a fresh tab, matching
  // `OnNotebookPageChanged`) and whenever the query changes (`RefreshSearch`,
  // from `OnSearchTextEntry`).
  useEffect(() => {
    const n = handler.search(query);
    const col = Math.max(0, sortRef.current.col); // "stable order… if no sort column provided"
    handler.sort(col, sortRef.current.ascending, []);
    setCount(n);
    setSelectedRow(null);
  }, [handler, query]);

  const onColClicked = (col: number): void => {
    const ascending = col === sortCol ? !sortAscending : true;
    setSortCol(col);
    setSortAscending(ascending);

    const selection = selectedRow !== null ? [selectedRow] : [];
    const remapped = handler.sort(col, ascending, selection);
    setSelectedRow(remapped[0] ?? null);
  };

  const selectRow = (row: number): void => {
    setSelectedRow(row);
    handler.selectItems?.([row]);
  };

  return (
    // A click on the blank area below the rows deselects every row: a click
    // in the empty space of a wxListCtrl clears its selection, and the empty
    // selection is pushed out through SelectItems like any other. Guarded on
    // the target, or a click that bubbled up from a row (or a header cell)
    // would immediately undo the selection it just made.
    <div
      className="ze-search-pane-body"
      style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSelectedRow(null);
          handler.selectItems?.([]);
        }
      }}
    >
      {count === 0 ? (
        <div className="ze-muted" style={{ padding: 8 }}>
          {query ? 'No matches' : 'Type to search'}
        </div>
      ) : (
        <table
          style={{
            width: '100%',
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: '0.9em',
          }}
        >
          <colgroup>
            {handler.columns.map((c) => (
              <col key={c.name} style={{ width: `${c.proportion}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {handler.columns.map((c, col) => (
                <th
                  key={c.name}
                  title={c.name}
                  onClick={() => onColClicked(col)}
                  style={{
                    textAlign: ALIGN[c.align],
                    padding: '2px 6px',
                    opacity: 0.7,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'default',
                  }}
                >
                  {c.name}
                  {/* `SEARCH_PANE_LISTVIEW::ShowSortIndicator` — a decorative
                      marker only; the sort itself is `handler.sort()`'s. */}
                  {sortCol === col && (sortAscending ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: count }, (_, row) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: the row index
                // IS the identity SEARCH_HANDLER::GetResultCell is keyed on.
                key={row}
                className={`ze-search-row${
                  (handler.isRowSelected ? handler.isRowSelected(row) : selectedRow === row)
                    ? ' selected'
                    : ''
                }`}
                onClick={() => selectRow(row)}
                onDoubleClick={() => {
                  handler.activateItem?.(row);
                  onActivate?.(row);
                }}
              >
                {handler.columns.map((c, col) => {
                  const cell = handler.getResultCell(row, col);
                  return (
                    <td
                      key={c.name}
                      title={cell}
                      style={{
                        textAlign: ALIGN[c.align],
                        padding: '2px 6px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
