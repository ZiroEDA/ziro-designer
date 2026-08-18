// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Resolve duplicate field names. Counterpart:
 * `eeschema/dialogs/dialog_resolve_field_case_conflicts.cpp`.
 *
 * The Symbol Fields Table has one column per field name, so a symbol carrying
 * both `MPN` and `mpn` has no honest place in it. Rather than picking a
 * spelling silently, the table refuses to open and this asks which one wins —
 * or offers to join both values into it.
 *
 * "Apply to all conflicts with the same name" is the reason this is bearable
 * on a real schematic: the same pair of spellings is usually the same mistake
 * repeated across a hundred symbols, and answering it once is enough.
 */
import { useState, type JSX } from 'react';
import { conflictKey, type FieldCaseAction, type FieldCaseConflict } from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  conflicts: readonly FieldCaseConflict[];
  /** Apply and Continue: the chosen action per conflict, plus the separator. */
  onApply: (actions: Map<string, FieldCaseAction>, separator: string) => void;
  onCancel: () => void;
}

export function DialogResolveFieldCaseConflicts({
  conflicts,
  onApply,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [actions, setActions] = useState<Record<string, FieldCaseAction>>({});
  const [bulk, setBulk] = useState(true);
  const [separator, setSeparator] = useState(', ');

  const actionOf = (c: FieldCaseConflict): FieldCaseAction =>
    actions[conflictKey(c.symbolId, c.caseFoldedKey)] ?? 'keepFirst';

  const choose = (c: FieldCaseConflict, action: FieldCaseAction): void =>
    setActions((prev) => {
      const next = { ...prev, [conflictKey(c.symbolId, c.caseFoldedKey)]: action };
      // findSiblingRows: the same case-folded name anywhere else in the list.
      if (bulk) {
        for (const other of conflicts) {
          if (other === c) continue;
          if (other.caseFoldedKey === c.caseFoldedKey)
            next[conflictKey(other.symbolId, other.caseFoldedKey)] = action;
        }
      }
      return next;
    });

  const apply = (): void => {
    const map = new Map<string, FieldCaseAction>();
    for (const c of conflicts) map.set(conflictKey(c.symbolId, c.caseFoldedKey), actionOf(c));
    onApply(map, separator);
  };

  const shown = (v: string): string => (v === '' ? '(empty)' : v);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal ze-label-dialog"
        style={{ minWidth: 720 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Resolve Duplicate Field Names
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <div>
            {conflicts.length} symbol{conflicts.length === 1 ? ' has' : 's have'} user fields whose
            names differ only in case. Choose how to resolve each before opening the table.
          </div>
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            <table className="ze-grid" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Symbol</th>
                  <th style={{ textAlign: 'left' }}>Fields</th>
                  <th style={{ textAlign: 'left' }}>Values</th>
                  <th style={{ textAlign: 'left' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const [a, b] = c.variants;
                  const key = conflictKey(c.symbolId, c.caseFoldedKey);
                  return (
                    <tr key={key}>
                      <td>{c.reference}</td>
                      <td>
                        {a?.name}
                        <br />
                        {b?.name}
                      </td>
                      <td>
                        {shown(a?.value ?? '')}
                        <br />
                        {shown(b?.value ?? '')}
                      </td>
                      <td>
                        <select
                          className="ze-select"
                          value={actionOf(c)}
                          onChange={(e) => choose(c, e.target.value as FieldCaseAction)}
                        >
                          <option value="keepFirst">Keep '{a?.name}'</option>
                          <option value="keepSecond">Keep '{b?.name}'</option>
                          <option value="join">Join values</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="row">
            <input type="checkbox" checked={bulk} onChange={(e) => setBulk(e.target.checked)} />
            <span>Apply to all conflicts with the same name</span>
          </label>
          <label className="row">
            <span>Join separator:</span>
            <input
              className="ze-search"
              style={{ width: 80 }}
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={apply}>
            Apply and Continue
          </button>
        </div>
      </div>
    </div>
  );
}
