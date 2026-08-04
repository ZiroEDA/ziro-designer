// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Navigator panel. Counterpart: the `m_netNavigator` tree built by
 * `SCH_EDIT_FRAME::MakeNetNavigatorNode` (eeschema/net_navigator.cpp).
 *
 * A node per net, a leaf per item on it, each leaf described in words by
 * `netNavigatorItemText`. Clicking a leaf selects the item it names, which is
 * the whole point: it is how you walk a net without hunting the canvas.
 *
 * The tree and the text live in `net_navigator.ts`, so the behaviour is tested
 * and this only renders and reports clicks.
 */

import { useMemo, useState, type JSX } from 'react';
import { buildNetNavigator, type NetNavigatorNet } from '@ziroeda/eeschema';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema';

interface Props {
  doc: Schematic;
  libById: Map<string, LibSymbol>;
  /** Formats an internal-unit distance for display. */
  fmt: (iu: number) => string;
  /** The selected item, so the tree can mark the row that names it. */
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function NetNavigatorPanel({ doc, libById, fmt, selectedId, onSelect }: Props): JSX.Element {
  const tree: NetNavigatorNet[] = useMemo(
    () => buildNetNavigator(doc, libById, fmt),
    [doc, libById, fmt],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  if (!tree.length) {
    return (
      <div className="ze-muted" style={{ padding: 8 }}>
        No nets
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      {tree.map((net) => (
        <div key={net.name}>
          <div
            className="ze-tree-item"
            style={{ cursor: 'pointer', fontWeight: 600 }}
            onClick={() => toggle(net.name)}
          >
            {collapsed.has(net.name) ? '▸' : '▾'} {net.name} ({net.items.length})
          </div>
          {!collapsed.has(net.name) &&
            net.items.map((item) => (
              <div
                key={item.id}
                className={`ze-tree-item ${selectedId === item.id ? 'active' : ''}`}
                style={{ cursor: 'pointer', paddingLeft: 18 }}
                onClick={() => onSelect(item.id)}
              >
                {item.text}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
