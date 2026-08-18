// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Symbol Library Links. Counterpart:
 * `eeschema/dialogs/dialog_edit_symbols_libid_base.cpp`
 * (DIALOG_EDIT_SYMBOLS_LIBID).
 *
 * A grid of three columns — the references using a library id, the id itself,
 * and what it should say instead. Rows whose library part cannot be found are
 * marked, and Map Orphans fills their new-id cell by searching every loaded
 * library for a part of the same name, which is usually all a renamed library
 * needs.
 */
import { useMemo, useState, type JSX } from 'react';
import { isValidLibId, type LibIdRow } from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

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

export function DialogEditSymbolsLibId({
  rows,
  candidatesFor,
  onApply,
  onClose,
  errors,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [newIds, setNewIds] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);

  const orphanRows = useMemo(() => rows.filter((r) => r.orphan), [rows]);

  const mapOrphans = (): void => {
    // onClickOrphansButton: take the first candidate for each orphan and
    // report how many could not be resolved at all.
    const next = { ...newIds };
    let fixed = 0;
    let ambiguous = 0;
    for (const row of orphanRows) {
      const candidates = candidatesFor(row.current);
      if (candidates.length === 0) continue;
      next[row.current] = candidates[0]!;
      fixed++;
      if (candidates.length > 1) ambiguous++;
    }
    setNewIds(next);
    const missing = orphanRows.length - fixed;
    setNote(
      missing > 0
        ? `${fixed} link(s) mapped, ${missing} not found`
        : `All ${fixed} link(s) resolved` +
            (ambiguous > 0
              ? ` — ${ambiguous} had more than one candidate; the first was taken, pick another from the list if it is wrong`
              : ''),
    );
  };

  const apply = (): void => {
    const changes = new Map<string, string>();
    for (const [current, next] of Object.entries(newIds)) {
      if (next.trim() !== '' && next !== current) changes.set(current, next.trim());
    }
    onApply(changes);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal ze-label-dialog"
        style={{ minWidth: 680 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Symbol Library References
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
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
          {note && (
            <div className="ze-muted" onClick={() => setNote(null)}>
              {note}
            </div>
          )}
          <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            <table className="ze-grid" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Symbols</th>
                  <th style={{ textAlign: 'left' }}>Current Library Reference</th>
                  <th style={{ textAlign: 'left' }}>New Library Reference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const value = newIds[row.current] ?? '';
                  const bad = value.trim() !== '' && !isValidLibId(value.trim());
                  const candidates = row.orphan ? candidatesFor(row.current) : [];
                  return (
                    <tr key={row.current}>
                      <td>{row.references.join(', ')}</td>
                      <td
                        // Orphan rows are marked, as upstream colours the cell.
                        style={row.orphan ? { color: 'var(--ze-error, #c33)' } : undefined}
                        title={row.orphan ? 'No library part of this id was found' : undefined}
                      >
                        {row.current}
                        {row.orphan && ' (orphan)'}
                      </td>
                      <td>
                        <input
                          className="ze-search"
                          style={{
                            width: '100%',
                            ...(bad ? { borderColor: 'var(--ze-error, #c33)' } : {}),
                          }}
                          value={value}
                          list={candidates.length > 0 ? `ze-cand-${row.current}` : undefined}
                          onChange={(e) =>
                            setNewIds((s) => ({ ...s, [row.current]: e.target.value }))
                          }
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                        {candidates.length > 0 && (
                          <datalist id={`ze-cand-${row.current}`}>
                            {candidates.map((c) => (
                              <option key={c} value={c} />
                            ))}
                          </datalist>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="ze-modal-footer">
          <button
            className="ze-btn"
            onClick={mapOrphans}
            disabled={orphanRows.length === 0}
            title={
              orphanRows.length === 0
                ? 'Every symbol has a library part'
                : 'Look for a part of the same name in the loaded libraries'
            }
          >
            Map Orphans
          </button>
          <span style={{ flex: 1 }} />
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={apply}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
