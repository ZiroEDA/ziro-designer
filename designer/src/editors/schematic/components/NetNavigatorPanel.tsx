// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Navigator panel. Counterpart: `SCH_EDIT_FRAME::RefreshNetNavigator`
 * and `MakeNetNavigatorNode` (eeschema/net_navigator.cpp).
 *
 * The shape is upstream's, and it is not a flat list:
 *
 *  - with no net highlighted the root is **"Nets"**, expanded, with one node per
 *    net and the items under it;
 *  - with a net highlighted the root **is** that net, and nothing else is shown
 *    (`m_netNavigator->AddRoot( UnescapeString( m_highlightedConn ) )`);
 *  - a filter box sits above the tree and is disabled while a net is
 *    highlighted (`m_netNavigatorFilter->Enable( m_highlightedConn.IsEmpty() )`).
 *    Its default mode is wildcard: a pattern with no `*` or `?` is wrapped in
 *    both, and matching is case-insensitive.
 *
 * Net names are shown through `UnescapeString`, and a net node carries no item
 * count — upstream appends the name and nothing else.
 *
 * The tree and the item text live in `net_navigator.ts`, so the behaviour is
 * tested there and this only renders and reports clicks.
 */

import { useMemo, useState, type JSX } from 'react';
import { buildNetNavigator, type NetNavigatorNet } from '@ziroeda/eeschema';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema';

/**
 * `WildCompareString( pattern, text, false )`: `*` and `?`, case-insensitive.
 * A pattern with neither is wrapped in `*` on both sides, which is what
 * RefreshNetNavigator does before calling it.
 */
function wildMatch(pattern: string, text: string): boolean {
  const p = /[*?]/.test(pattern) ? pattern : `*${pattern}*`;
  const rx = new RegExp(
    `^${p
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  );
  return rx.test(text);
}

interface Props {
  doc: Schematic;
  libById: Map<string, LibSymbol>;
  /** Formats an internal-unit distance for display. */
  fmt: (iu: number) => string;
  /** The selected item, so the tree can mark the row that names it. */
  selectedId?: string;
  /** The highlighted net, if any: it becomes the root and the filter goes away. */
  highlightedNet?: string | null;
  /**
   * The label of the sheet the items sit on — the root sheet's name, or its file
   * name when it has none. `MakeNetNavigatorNode` always appends a sheet node,
   * even for a single-sheet schematic, so the tree is Nets > net > sheet > item.
   */
  sheetLabel?: string;
  /**
   * The tree, already built across the hierarchy. The frame builds it because
   * only the frame can see every sheet; without one this falls back to the open
   * sheet alone, which is the single-sheet case upstream also produces.
   */
  prebuilt?: NetNavigatorNet[];
  onSelect: (id: string) => void;
}

export function NetNavigatorPanel({
  doc,
  libById,
  fmt,
  selectedId,
  highlightedNet,
  sheetLabel = '',
  prebuilt,
  onSelect,
}: Props): JSX.Element {
  const tree: NetNavigatorNet[] = useMemo(
    () => prebuilt ?? buildNetNavigator(doc, libById, fmt, sheetLabel),
    [prebuilt, doc, libById, fmt, sheetLabel],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState('');
  const toggle = (name: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  // A highlighted net is the whole tree; otherwise the filter narrows the list.
  const shown = useMemo(() => {
    if (highlightedNet) return tree.filter((n) => n.name === highlightedNet);
    if (!filter.trim()) return tree;
    return tree.filter((n) => wildMatch(filter.trim(), unescapeString(n.name)));
  }, [tree, filter, highlightedNet]);

  /** A net node, its sheet nodes, and the items under each. */
  const netNode = (net: NetNavigatorNet, indent: number): JSX.Element => {
    const netOpen = !collapsed.has(net.name);
    return (
      <div key={net.name}>
        <div
          className="ze-tree-item"
          style={{ cursor: 'default', paddingLeft: indent }}
          onClick={() => toggle(net.name)}
        >
          <span className={`twisty expandable${netOpen ? ' open' : ''}`} />
          {unescapeString(net.name)}
        </div>
        {netOpen &&
          net.sheets.map((sheet) => {
            const key = `${net.name}\u0000${sheet.label}`;
            const sheetOpen = !collapsed.has(key);
            return (
              <div key={key}>
                <div
                  className="ze-tree-item"
                  style={{ cursor: 'default', paddingLeft: indent + 14 }}
                  onClick={() => toggle(key)}
                >
                  <span className={`twisty expandable${sheetOpen ? ' open' : ''}`} />
                  {sheet.label}
                </div>
                {sheetOpen &&
                  sheet.items.map((item) => (
                    <div
                      key={item.id}
                      className={`ze-tree-item ${selectedId === item.id ? 'active' : ''}`}
                      style={{ cursor: 'default', paddingLeft: indent + 42 }}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.text}
                    </div>
                  ))}
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Disabled while a net is highlighted, exactly as
          `m_netNavigatorFilter->Enable( m_highlightedConn.IsEmpty() )` does. */}
      <input
        value={filter}
        disabled={!!highlightedNet}
        placeholder="Filter nets…"
        onChange={(e) => setFilter(e.target.value)}
        style={{ margin: '4px 6px', minWidth: 0 }}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tree.length === 0 ? (
          <div className="ze-muted" style={{ padding: 8 }}>
            No nets
          </div>
        ) : highlightedNet ? (
          // The highlighted net *is* the root; there is no "Nets" wrapper.
          shown.map((net) => netNode(net, 4))
        ) : (
          <>
            <div
              className="ze-tree-item"
              style={{ cursor: 'default' }}
              onClick={() => toggle('\u0000root')}
            >
              <span className={`twisty expandable${collapsed.has('\u0000root') ? '' : ' open'}`} />
              Nets
            </div>
            {!collapsed.has('\u0000root') && shown.map((net) => netNode(net, 14))}
          </>
        )}
      </div>
    </div>
  );
}
