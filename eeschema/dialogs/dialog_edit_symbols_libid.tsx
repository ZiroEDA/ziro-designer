// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Symbol Library Links. Counterpart:
 * `eeschema/dialogs/dialog_edit_symbols_libid.cpp` and its `_base.cpp`
 * (DIALOG_EDIT_SYMBOLS_LIBID).
 *
 * A WX_GRID of three columns with GRID_TRICKS, rows selected whole — the
 * references using a library id (auto-wrapped), the id itself, and what it
 * should say instead. The first two are read-only; an orphan's current id is
 * drawn bold italic (`AddRowToGrid`). Map Orphans fills an orphan's new-id
 * cell by searching every loaded library for a part of the same name, asks
 * which one when there is more than one, and reports the count.
 *
 * Not ported: the cell editor's browse button (`GRID_CELL_SYMBOL_ID_EDITOR`)
 * and the double-click browse, which need a symbol chooser this dialog is not
 * handed; the new id is typed.
 */
import { type JSX, useState } from 'react';
import { isValidLibId, type LibIdRow } from '../index.js';
import { DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { SingleChoiceDialog } from '@ziroeda/common/dialogs/dialog_single_choice.js';
import { wxGridSelectionModes } from '@ziroeda/common/wx/grid.js';
import { useStringGrid, WxGridView } from '@ziroeda/common/wx/grid_ui.js';

const COL_REFS = 0;
const COL_CURR_LIBID = 1;
const COL_NEW_LIBID = 2;

interface Props {
  rows: readonly LibIdRow[];
  /** Candidate library ids for an orphan row, by name match. */
  candidatesFor: (currentLibId: string) => string[];
  /** current lib id -> new lib id, for the rows the user filled in. */
  onApply: (changes: Map<string, string>) => void;
  onClose: () => void;
  /** Errors from the last apply; the dialog stays open on them. */
  errors: readonly string[];
}

type GridRow = { refs: string; current: string; next: string };

export function DialogEditSymbolsLibId({
  rows,
  candidatesFor,
  onApply,
  onClose,
  errors,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.

  const [gridRows, setGridRows] = useState<GridRow[]>(() =>
    rows.map((r) => ({ refs: r.references.join(', '), current: r.current, next: '' })),
  );
  /** The `wxSingleChoiceDialog` Map Orphans is waiting on. */
  const [choice, setChoice] = useState<{
    current: string;
    candidates: string[];
    resolve: (v: string | null) => void;
  } | null>(null);

  /** `m_OrphansRowIndexes`. */
  const orphanRows = rows.flatMap((r, i) => (r.orphan ? [i] : []));

  const { grid, tricks, onUpdate } = useStringGrid<GridRow>({
    labels: ['Symbols', 'Current Library Reference', 'New Library Reference'],
    mode: wxGridSelectionModes.wxGridSelectRows,
    rows: gridRows,
    toCells: (r) => [r.refs, r.current, r.next],
    fromCells: (c) => ({ refs: c[0]!, current: c[1]!, next: c[2]! }),
    onChange: setGridRows,
    setup: (g) => {
      for (let row = 0; row < g.GetNumberRows(); ++row) {
        g.SetReadOnly(row, COL_REFS);
        g.SetReadOnly(row, COL_CURR_LIBID);
      }
    },
  });

  /** `onClickOrphansButton`. */
  const onClickOrphansButton = async (): Promise<void> => {
    let fixesCount = 0;

    for (const orphanRow of orphanRows) {
      const current = grid.GetCellValue(orphanRow, COL_CURR_LIBID);
      const candidates = candidatesFor(current);

      if (candidates.length === 0) continue;

      // Uses the first found. Most of time, it is alone.
      grid.SetCellValue(orphanRow, COL_NEW_LIBID, candidates[0]!);
      fixesCount++;

      // If more than one LIB_ID candidate, ask for selection between candidates.
      if (candidates.length > 1) {
        grid.SelectRow(orphanRow);
        const picked = await new Promise<string | null>((resolve) =>
          setChoice({ current, candidates, resolve }),
        );
        setChoice(null);

        if (picked !== null) grid.SetCellValue(orphanRow, COL_NEW_LIBID, picked);
      }
    }

    if (fixesCount < orphanRows.length)
      await DisplayInfoMessage(
        `${fixesCount} link(s) mapped, ${orphanRows.length - fixesCount} not found`,
      );
    else await DisplayInfoMessage(`All ${fixesCount} link(s) resolved`);
  };

  /** `validateLibIds`: an invalid new id is reported and its editor reopened. */
  const validateLibIds = async (): Promise<boolean> => {
    if (!grid.CommitPendingChanges()) return false;

    for (let row = 0; row < grid.GetNumberRows(); ++row) {
      const newLibId = grid.GetCellValue(row, COL_NEW_LIBID).trim();

      if (newLibId === '') continue;

      if (!isValidLibId(newLibId)) {
        await DisplayInfoMessage(`Symbol library identifier ${newLibId} is not valid.`);
        grid.SetGridCursor(row, COL_NEW_LIBID);
        grid.EnableCellEditControl(true);
        return false;
      }
    }

    return true;
  };

  const apply = async (): Promise<void> => {
    if (!(await validateLibIds())) return;

    const changes = new Map<string, string>();

    for (let row = 0; row < grid.GetNumberRows(); ++row) {
      const current = grid.GetCellValue(row, COL_CURR_LIBID);
      const next = grid.GetCellValue(row, COL_NEW_LIBID).trim();

      if (next !== '' && next !== current) changes.set(current, next);
    }

    onApply(changes);
  };

  return (
    <>
      <DialogShim title="Symbol Library References" onClose={onClose} className="ze-label-dialog">
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {errors.length > 0 && (
            <div className="ze-props-error">
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
          {/* `m_grid->SetMinSize( wxSize( -1, 300 ) )`. */}
          <div
            className="ze-grid-pane"
            style={{
              // [data] m_grid->SetMinSize( wxSize( -1, 300 ) ) (_base.cpp:51)
              minHeight: 300,
              maxHeight: '55vh',
            }}
          >
            <WxGridView
              grid={grid}
              tricks={tricks}
              columns={[{ width: 280 }, { width: 280 }, { width: 280 }]}
              flexCol={COL_NEW_LIBID}
              onUpdate={onUpdate}
              ariaLabel="Symbol library references"
              renderCell={(row, col, value) => {
                // `m_autoWrapRenderer` on the references.
                if (col === COL_REFS)
                  return (
                    <span className="ze-grid-text" style={{ whiteSpace: 'normal' }}>
                      {value}
                    </span>
                  );

                // An orphan's id: `font.MakeBold(); font.MakeItalic()`.
                if (col === COL_CURR_LIBID && rows[row]?.orphan)
                  return (
                    <span
                      className="ze-grid-text"
                      style={{ fontWeight: 'bold', fontStyle: 'italic' }}
                    >
                      {value}
                    </span>
                  );

                return null;
              }}
            />
          </div>
        </div>
        <div className="ze-modal-footer">
          <button
            type="button"
            className="ze-btn"
            onClick={() => void onClickOrphansButton()}
            disabled={orphanRows.length === 0}
            title={
              'If some symbols are orphaned (the linked symbol is not found anywhere),\n' +
              'try to find a candidate having the same name in one of loaded symbol libraries.'
            }
          >
            Map Orphans
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={() => void apply()}>
            OK
          </button>
        </div>
      </DialogShim>
      {choice && (
        <SingleChoiceDialog
          caption={`Candidates count ${choice.candidates.length} `}
          message={`Available Candidates for ${choice.current} `}
          choices={choice.candidates.map((c) => ({ value: c, label: c }))}
          onResult={choice.resolve}
        />
      )}
    </>
  );
}
