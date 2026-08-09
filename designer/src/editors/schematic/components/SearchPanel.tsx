// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Search panel (Ctrl+G). Counterpart: `SEARCH_PANE` / `SEARCH_PANE_TAB`
 * (common/widgets) driven by eeschema's four `SEARCH_HANDLER`s.
 *
 * A thin consumer: the queries, the tab split and the columns all come from
 * `searchSchematic`, which is where the behaviour and the tests live. This
 * renders rows and reports clicks.
 *
 * Tabs with no hits are still shown, with their count, because upstream's
 * notebook keeps every tab present — a tab that vanished when it found nothing
 * would make "no results" indistinguishable from "that tab does not exist".
 */

import { useMemo, useState, type JSX } from 'react';
import {
  SEARCH_COLUMNS,
  hitsOfKind,
  searchSchematic,
  type SearchHit,
  type SearchKind,
} from '@ziroeda/eeschema';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema';

const TABS: { kind: SearchKind; label: string }[] = [
  { kind: 'symbol', label: 'Symbols' },
  { kind: 'power', label: 'Power' },
  { kind: 'text', label: 'Text' },
  { kind: 'label', label: 'Labels' },
];

interface Props {
  doc: Schematic;
  libById: ReadonlyMap<string, LibSymbol>;
  /** Formats an internal-unit distance for display (mm or mils). */
  fmt: (iu: number) => string;
  /** Select the clicked item (SEARCH_HANDLER::SelectItems). */
  onSelect: (id: string) => void;
  /** Centre the view on it (ACTIONS::centerSelection). */
  onCenter?: (id: string, at: Vec2) => void;
  /** Fit the view to it (ACTIONS::zoomFitSelection). */
  onZoomFit?: (id: string, at: Vec2) => void;
  /**
   * APP_SETTINGS_BASE::SEARCH_PANE::selection_zoom — what picking a row does to
   * the view. Upstream's default is `pan`, so a single click centres the sheet
   * on the hit; that is the whole point of the pane, and it happens on the
   * *first* click, not a double one.
   */
  selectionZoom?: 'none' | 'pan' | 'zoom';
  /** SEARCH_PANE_MENU's two checkboxes; unchecking both leaves 'none'. */
  onSelectionZoomChange?: (mode: 'none' | 'pan' | 'zoom') => void;
  /**
   * The editor's selection, which is what draws a row selected.
   *
   * **A deliberate superset of upstream.** `SEARCH_PANE_LISTVIEW` owns its own
   * selection and only pushes it out (`OnUpdateUI` → `SelectItems`); nothing in
   * KiCad pushes a canvas selection back into the list, so picking a symbol on
   * the sheet leaves its row alone there. Driving the highlight from the shared
   * set instead makes it agree in both directions, which is what this project
   * wants: the row for the symbol you clicked lights up wherever you clicked it.
   */
  selection?: ReadonlySet<string>;
  /**
   * Clicking the blank area below the rows clears the selection, which *is*
   * upstream: a click on empty space in a wxListCtrl deselects every row, and
   * the empty selection is pushed out through `SelectItems` like any other.
   */
  onClearSelection?: () => void;
}

export function SearchPanel({
  doc,
  libById,
  fmt,
  onSelect,
  onCenter,
  onZoomFit,
  selectionZoom = 'pan',
  onSelectionZoomChange,
  selection,
  onClearSelection,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [searchHidden, setSearchHidden] = useState(false);
  const [tab, setTab] = useState<SearchKind>('symbol');

  const hits = useMemo(
    () => searchSchematic(doc, libById, query, searchHidden, fmt),
    [doc, libById, query, searchHidden, fmt],
  );
  const rows: SearchHit[] = hitsOfKind(hits, tab);
  const columns = SEARCH_COLUMNS[tab];

  return (
    // `minWidth: 0` throughout: this pane lives in a 240px dock, and a flex
    // item's default `min-width: auto` refuses to shrink below its content, so
    // without it the search box alone is wider than the dock and the whole
    // panel gets a horizontal scrollbar.
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '4px 6px',
          alignItems: 'center',
          minWidth: 0,
        }}
      >
        <input
          // SEARCH_PANE::FocusSearch — ToggleSearch focuses the box whenever
          // the pane is shown, and the pane mounts exactly then.
          // biome-ignore lint/a11y/noAutofocus: matches ToggleSearch's FocusSearch
          autoFocus
          value={query}
          placeholder="Search…"
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        {/* SEARCH_PANE_MENU: "Zoom to Selection" and "Pan to Selection" are two
            checkboxes over one tri-state, so ticking one unticks the other and
            unticking both means NONE. There is no pane gear button here, so they
            sit in the header where the Hidden toggle already is. */}
        {onSelectionZoomChange && (
          <select
            title="What picking a result does to the view"
            value={selectionZoom}
            onChange={(e) => onSelectionZoomChange(e.target.value as 'none' | 'pan' | 'zoom')}
            style={{ flexShrink: 0, maxWidth: 78 }}
          >
            <option value="pan">Pan</option>
            <option value="zoom">Zoom</option>
            <option value="none">None</option>
          </select>
        )}
        <label
          title="Search hidden fields too"
          style={{ display: 'flex', gap: 4, flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          <input
            type="checkbox"
            checked={searchHidden}
            onChange={(e) => {
              setSearchHidden(e.target.checked);
            }}
          />
          Hidden
        </label>
      </div>

      <div className="ze-erc-tabs compact" style={{ padding: '0 6px' }}>
        {TABS.map((t) => (
          <div
            key={t.kind}
            className={`tab${tab === t.kind ? ' active' : ''}`}
            onClick={() => setTab(t.kind)}
          >
            {t.label} ({hitsOfKind(hits, t.kind).length})
          </div>
        ))}
      </div>

      {/* The blank area below the rows is part of the list: clicking it
          deselects, as it does in the wxListCtrl. Guarded on the target so a
          click that landed on a row (and bubbled up) is not read as a click on
          nothing. */}
      <div
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClearSelection?.();
        }}
      >
        {rows.length === 0 ? (
          <div className="ze-muted" style={{ padding: 8 }}>
            {query ? 'No matches' : 'Type to search'}
          </div>
        ) : (
          // `table-layout: fixed` is what keeps the pane inside the dock: an
          // auto table is at least as wide as its widest unbreakable cell, and
          // one footprint name ("Capacitor_SMD:C_0805_2012Metric") is already
          // wider than 240px. Fixed splits the width evenly and the cells
          // ellipsise, with the full text on hover — the columns upstream shows
          // in a resizable wxListCtrl, in the room this dock actually has.
          <table
            style={{
              width: '100%',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              fontSize: '0.9em',
            }}
          >
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    title={c}
                    style={{
                      textAlign: 'left',
                      padding: '2px 6px',
                      opacity: 0.7,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr
                  key={h.id}
                  className={`ze-search-row${selection?.has(h.id) ? ' selected' : ''}`}
                  onClick={() => {
                    // SCH_SEARCH_HANDLER::SelectItems: select the hits, then move
                    // the view according to the pane's selection_zoom.
                    onSelect(h.id);
                    if (selectionZoom === 'pan') onCenter?.(h.id, h.at);
                    else if (selectionZoom === 'zoom') onZoomFit?.(h.id, h.at);
                  }}
                >
                  {h.cells.map((cell, i) => (
                    <td
                      key={`${h.id}:${columns[i] ?? i}`}
                      title={cell}
                      style={{
                        padding: '2px 6px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
