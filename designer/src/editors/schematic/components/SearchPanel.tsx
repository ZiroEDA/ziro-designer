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
  /** Centre the view on it, as a double-click does upstream. */
  onFocus?: (id: string, at: Vec2) => void;
}

export function SearchPanel({ doc, libById, fmt, onSelect, onFocus }: Props): JSX.Element {
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, padding: '4px 6px', alignItems: 'center' }}>
        <input
          value={query}
          placeholder="Search…"
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <label title="Search hidden fields too" style={{ display: 'flex', gap: 4 }}>
          <input
            type="checkbox"
            checked={searchHidden}
            onChange={(e) => setSearchHidden(e.target.checked)}
          />
          Hidden
        </label>
      </div>

      <div className="ze-erc-tabs" style={{ padding: '0 6px' }}>
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

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <div className="ze-muted" style={{ padding: 8 }}>
            {query ? 'No matches' : 'Type to search'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} style={{ textAlign: 'left', padding: '2px 6px', opacity: 0.7 }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr
                  key={h.id}
                  onClick={() => onSelect(h.id)}
                  onDoubleClick={() => onFocus?.(h.id, h.at)}
                  style={{ cursor: 'pointer' }}
                >
                  {h.cells.map((cell, i) => (
                    <td key={`${h.id}:${columns[i] ?? i}`} style={{ padding: '2px 6px' }}>
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
