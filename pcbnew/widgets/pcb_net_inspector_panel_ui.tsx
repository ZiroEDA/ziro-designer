// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The docked Net Inspector (`PCB_NET_INSPECTOR_PANEL`, `pcb_net_inspector_panel.cpp`)
 * over its base `NET_INSPECTOR_PANEL`'s frame ({@link NetInspectorPanelView}):
 * the "Filter" control and the "Configure netlist inspector" button above the
 * list, and the list being a `wxGrid` here in place of the `wxDataViewCtrl`.
 *
 * The columns are the four counting ones of `m_columns` (`:112-147`): Name,
 * Netclass, Via Count and Pad Count. The length and delay columns are not
 * ported, deliberately, for the reason `pcb_net_inspector_panel.ts` gives. The
 * config popup (`OnConfigButton`) is not ported either, so the button is drawn
 * and does nothing.
 *
 * Selecting a row highlights that net, as `OnSelChanged` does.
 */
import { type JSX, useMemo, useRef, useState } from 'react';
import { useStringGrid, WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { Board } from '../types.js';
import { NetInspectorPanelView } from './net_inspector_panel.js';
import { type NetRow, netInspectorRows } from './pcb_net_inspector_panel.js';

/** `m_columns`' captions (`pcb_net_inspector_panel.cpp:112-147`), for the four columns ported. */
export const NET_INSPECTOR_COLUMNS = ['Name', 'Netclass', 'Via Count', 'Pad Count'] as const;

/** The list's rows once `aFilter` has been applied: a substring of the net name or the netclass. */
export function filterNetRows(aRows: readonly NetRow[], aFilter: string): NetRow[] {
  const needle = aFilter.trim().toLowerCase();

  if (needle === '') return [...aRows];

  return aRows.filter(
    (r) => r.name.toLowerCase().includes(needle) || r.netclass.toLowerCase().includes(needle),
  );
}

/** One grid row's cells. */
export function netRowCells(aRow: NetRow): string[] {
  return [aRow.name, aRow.netclass, String(aRow.viaCount), String(aRow.padCount)];
}

interface Props {
  board: Board;
  /** The netclass names a net belongs to, by stored net name. */
  netClassesOf: (aNetName: string) => readonly string[];
  /** `OnSelChanged`: the net codes of the selected rows. */
  onHighlightNets: (aNetCodes: readonly number[]) => void;
}

export function PcbNetInspectorPane({ board, netClassesOf, onHighlightNets }: Props): JSX.Element {
  const [filter, setFilter] = useState('');
  const rows = useMemo(
    () => filterNetRows(netInspectorRows(board, netClassesOf), filter),
    [board, netClassesOf, filter],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const lastSel = useRef('');

  const { grid, tricks, onUpdate } = useStringGrid<NetRow>({
    labels: NET_INSPECTOR_COLUMNS,
    rows,
    toCells: netRowCells,
    fromCells: (_c, i) => rowsRef.current[i]!,
    onChange: () => {},
    setup: (g) => g.EnableEditing(false),
  });

  return (
    <NetInspectorPanelView
      searchText={filter}
      onSearchTextChanged={setFilter}
      onConfigButton={() => {}}
    >
      <WxGridView
        grid={grid}
        tricks={tricks}
        colLabels
        ariaLabel="Net Inspector"
        columns={NET_INSPECTOR_COLUMNS.map(() => ({ width: 90 }))}
        flexCol={0}
        onUpdate={() => {
          onUpdate();

          const sel = grid.GetSelectedRows();
          const row = sel.length
            ? sel
            : grid.GetGridCursorRow() >= 0
              ? [grid.GetGridCursorRow()]
              : [];
          const key = row.join(',');

          if (key === lastSel.current) return;

          lastSel.current = key;
          onHighlightNets(row.map((i) => rowsRef.current[i]?.net).filter((n): n is number => !!n));
        }}
      />
    </NetInspectorPanelView>
  );
}
