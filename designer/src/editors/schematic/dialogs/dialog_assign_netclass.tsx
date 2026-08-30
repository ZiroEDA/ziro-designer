// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Netclass. Counterpart: `DIALOG_ASSIGN_NETCLASS`
 * (common/dialogs/dialog_assign_netclass.cpp).
 *
 * Upstream shows one editable pattern field plus a live "currently matching
 * nets" report. Ours lists the patterns the selection produced — they are
 * derived rather than typed, so there is nothing to edit and nothing to
 * re-match — and offers the netclass choice, which is the decision the dialog
 * exists to take.
 *
 * The patterns and the write both come from `assign_netclass.ts`, where the
 * behaviour is tested; this is the picker.
 */

import { useState, type JSX } from 'react';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  /** Patterns from `planNetclassAssignment`, already sorted and de-duplicated. */
  patterns: readonly string[];
  /** Netclass names from the project settings; the first is KiCad's Default. */
  netClasses: readonly string[];
  onOk: (netClass: string) => void;
  onCancel: () => void;
}

export function DialogAssignNetclass({ patterns, netClasses, onOk, onCancel }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [netClass, setNetClass] = useState(netClasses[0] ?? 'Default');

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Assign Netclass
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div style={{ padding: '10px 12px' }}>
          <div style={{ marginBottom: 8 }}>{patterns.length === 1 ? 'Pattern:' : 'Patterns:'}</div>
          <ul style={{ margin: '0 0 12px', paddingLeft: 20, maxHeight: 160, overflowY: 'auto' }}>
            {patterns.map((p) => (
              <li key={p}>
                <code>{p}</code>
              </li>
            ))}
          </ul>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Net class:
            <select value={netClass} onChange={(e) => setNetClass(e.target.value)}>
              {netClasses.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ze-modal-footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onOk(netClass)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
