// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_LIST_DIALOG` (`common/dialogs/eda_list_dialog.cpp` +
 * `eda_list_dialog_base.cpp`) — KiCad's "pick one row from a report list"
 * dialog: a label, a `wxListCtrl` in `wxLC_REPORT` with column headers and
 * rules, an optional filter box under it, then Cancel / OK. Double-clicking a
 * row is `onListItemActivated`, which accepts and closes.
 *
 * One component, because wx has one dialog. Board Setup raises it twice — from
 * `PANEL_SETUP_LAYERS::addUserDefinedLayer` ("Add User-defined Layer", one
 * "Layers" column, filter hidden) and from PANEL_SETUP_BOARD_STACKUP's
 * add/remove dielectric pickers — and both had grown their own copy built
 * around a native `<select size=8>`. A native list box is drawn by the
 * operating system and takes Chrome's own selection blue, exactly like the
 * native `<select>` popup `ui/Combo.tsx` exists to replace; and two hand-built
 * copies are how two dialogs of the same wx class come to look different.
 *
 * Not `SingleChoiceDialog`: that one is `wxGetSingleChoice`, a different wx
 * dialog with no headers, no filter and no report columns.
 */
import { Button } from '../wx/controls.js';
import { useEffect, useRef, useState, type JSX } from 'react';
import { DialogShim } from '../dialog_shim.js';

export interface EdaListRow {
  /** Handed back to `onResult`; `GetTextSelection()` is the first column. */
  value: string;
  /** One cell per header. */
  cells: readonly string[];
}

export function EdaListDialog({
  title,
  headers,
  rows,
  listLabel = 'Items:',
  showFilter = false,
  initialValue,
  okLabel = 'OK',
  nameRow,
  onResult,
}: {
  /** The window title. */
  title: string;
  /** `EDA_LIST_DIALOG( …, headers, … )` — one per report column. */
  headers: readonly string[];
  rows: readonly EdaListRow[];
  /** `SetListLabel()`; the base's own default is "Items:". */
  listLabel?: string;
  /** The inverse of `HideFilter()`, which both Board Setup call sites use. */
  showFilter?: boolean;
  initialValue?: string;
  /** `SetOKLabel()`; OK by default. */
  okLabel?: string;
  /**
   * The name row `SAVE_AS_DIALOG` (footprint_libraries_utils.cpp:995-1055)
   * prepends: a label and a text control whose `wxTextValidator` excludes
   * `excludeChars`. Its trimmed text is `onResult`'s second argument.
   */
  nameRow?: { label: string; value: string; excludeChars: string };
  /** `null` on Cancel — `GetTextSelection()` empty. */
  onResult: (value: string | null, name?: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const [name, setName] = useState(nameRow?.value ?? '');
  const [sel, setSel] = useState<string>(() => initialValue ?? rows[0]?.value ?? '');
  const listRef = useRef<HTMLDivElement>(null);

  const shown = filter
    ? rows.filter((r) => r.cells.some((c) => c.toLowerCase().includes(filter.toLowerCase())))
    : rows;

  // The selected row must stay in view when the arrows move it, which is what a
  // wxListCtrl does for free.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const move = (delta: number): void => {
    const i = shown.findIndex((r) => r.value === sel);
    const next = shown[Math.min(shown.length - 1, Math.max(0, (i === -1 ? 0 : i) + delta))];
    if (next) setSel(next.value);
  };

  const accept = (): void =>
    onResult(shown.some((r) => r.value === sel) ? sel : null, nameRow ? name.trim() : undefined);

  return (
    <DialogShim title={title} onClose={() => onResult(null)} className="ze-list-dialog">
      <div className="ze-modal-body ze-list-dialog-body">
        {nameRow && (
          <label className="ze-list-dialog-name">
            <span>{nameRow.label}</span>
            <input
              className="ze-search"
              autoFocus
              value={name}
              onChange={(e) =>
                setName(
                  [...e.target.value].filter((c) => !nameRow.excludeChars.includes(c)).join(''),
                )
              }
            />
          </label>
        )}
        <div className="ze-list-dialog-label">{listLabel}</div>
        {/* `wxLC_REPORT|wxLC_HRULES|wxLC_VRULES|wxBORDER_SIMPLE` — the same
          report list `.ze-grid` already draws for every other WX_GRID in
          the app, so the rules and the header come from there. */}
        <div className="ze-grid-pane ze-list-dialog-list" ref={listRef}>
          <table className="ze-grid">
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.value}
                  aria-selected={r.value === sel}
                  className={r.value === sel ? 'selected' : undefined}
                  onMouseDown={() => setSel(r.value)}
                  onDoubleClick={() => onResult(r.value, nameRow ? name.trim() : undefined)}
                >
                  {r.cells.map((c, i) => (
                    <td key={headers[i] ?? i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showFilter && (
          <input
            className="ze-search"
            value={filter}
            placeholder="Filter"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') move(1);
              else if (e.key === 'ArrowUp') move(-1);
              else return;
              e.preventDefault();
            }}
          />
        )}
      </div>
      <div className="ze-modal-footer">
        <Button label="Cancel" onClick={() => onResult(null)} />
        <Button label={okLabel} isDefault disabled={shown.length === 0} onClick={accept} />
      </div>
    </DialogShim>
  );
}
