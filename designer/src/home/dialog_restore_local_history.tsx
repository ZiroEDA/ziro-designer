// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_RESTORE_LOCAL_HISTORY`
 * (common/dialogs/dialog_restore_local_history.cpp), behind File >
 * "Restore Project from Local History...".
 *
 * The route there is `KICAD_MANAGER_ACTIONS::restoreLocalHistory`
 * (kicad/tools/kicad_manager_actions.cpp:235-240) ->
 * `KICAD_MANAGER_FRAME::RestoreLocalHistory` (kicad/files-io.cpp:101-104) ->
 * `LOCAL_HISTORY::ShowRestoreDialog` (common/local_history.cpp:2384-2404),
 * which loads the snapshots, shows this dialog, and on `wxID_OK` hands the
 * selected hash to `RestoreCommit` — the same call the pane's context menu
 * makes, so the confirmation, the pre-restore backup and the overlay are all
 * `restoreSnapshot`'s and are not repeated here.
 *
 * The layout is a `wxBoxSizer( wxVERTICAL )` of three things (:62-66):
 *
 *     m_list     proportion 1, wxEXPAND | wxALL, 5
 *     m_details  proportion 1, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 5
 *     buttons    proportion 0, wxEXPAND | wxALL, 5
 *
 * so the list and the details box split the height evenly and both grow.
 *
 * Three behaviours are easy to miss and all three are here:
 *
 *  - Restore starts DISABLED (:56) and is enabled only while a row is selected
 *    (:159-160); deselecting disables it again and clears the details (:144-152).
 *  - A double-click accepts (`wxEVT_LIST_ITEM_ACTIVATED`, :167-180): it selects
 *    the row, fills the details, and ends the dialog with `wxID_OK`.
 *  - The list is `wxLC_SINGLE_SEL`, and it is `wxLC_HRULES | wxLC_VRULES`
 *    (:45-46) where the Local History PANE's list is neither
 *    (kicad/local_history_pane.cpp:42) — the grid rules belong to this dialog
 *    alone.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  RESTORE_DIALOG_MIN_HEIGHT,
  RESTORE_DIALOG_MIN_WIDTH,
  RESTORE_DIALOG_TITLE,
  RESTORE_LIST_COLUMNS,
  restoreCountText,
  restoreDetailText,
  formatISOCombined,
  type Snapshot,
} from './local_history.js';
import { useModalEscape } from '../ui/useModalEscape.js';

export function RestoreLocalHistoryDialog({
  snapshots,
  onResult,
}: {
  /** `LoadSnapshots( aProjectPath )`, newest first. */
  snapshots: readonly Snapshot[];
  /** The chosen snapshot, or null for Cancel. */
  onResult: (snapshot: Snapshot | null) => void;
}): JSX.Element {
  // wxID_CANCEL is in the button sizer, so Esc is the cancel answer.
  useModalEscape(() => onResult(null));

  /** `m_selectedIndex`, which starts at `wxNOT_FOUND`. */
  const [selected, setSelected] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const chosen = selected >= 0 && selected < snapshots.length ? snapshots[selected] : undefined;

  /** `OnRestoreClicked` + `EndModal( wxID_OK )`; a no-op with nothing selected. */
  const accept = (index: number): void => {
    const s = snapshots[index];
    if (s) onResult(s);
  };

  return (
    <div className="ze-modal-backdrop">
      <div
        className="ze-modal ze-rlhist"
        role="dialog"
        aria-modal="true"
        style={{ minWidth: RESTORE_DIALOG_MIN_WIDTH, minHeight: RESTORE_DIALOG_MIN_HEIGHT }}
      >
        <div className="ze-modal-header">{RESTORE_DIALOG_TITLE}</div>

        <div className="ze-rlhist-body">
          {/* wxLC_REPORT with three columns, and the widths KiCad declares. */}
          <div className="ze-lhist-head cols3">
            {RESTORE_LIST_COLUMNS.map((c) => (
              <span key={c.key} className={c.key}>
                {c.label}
              </span>
            ))}
          </div>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the list IS the control. */}
          <div
            ref={listRef}
            className="ze-lhist-list rules"
            role="listbox"
            tabIndex={0}
            aria-label={RESTORE_DIALOG_TITLE}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((i) => Math.min(snapshots.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && selected >= 0) {
                e.preventDefault();
                accept(selected);
              }
            }}
          >
            {snapshots.map((s, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox owns the keys.
              <div
                key={s.id}
                role="option"
                aria-selected={i === selected}
                className={`ze-lhist-row cols3${i === selected ? ' selected' : ''}`}
                onClick={() => setSelected(i)}
                onDoubleClick={() => accept(i)}
              >
                <span className="time">{formatISOCombined(s.at)}</span>
                <span className="action">{s.title}</span>
                <span className="count">{restoreCountText(s.changed.length)}</span>
              </div>
            ))}
          </div>

          {/* m_details: wxTE_MULTILINE | wxTE_READONLY. */}
          <textarea
            className="ze-search ze-rlhist-details"
            readOnly
            value={chosen ? restoreDetailText(chosen) : ''}
          />
        </div>

        {/* wxStdDialogButtonSizer: Restore is wxID_OK and starts disabled. */}
        <div className="ze-choicedlg-buttons">
          <button type="button" className="ze-btn" onClick={() => onResult(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="ze-btn primary"
            disabled={!chosen}
            onClick={() => selected >= 0 && accept(selected)}
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
