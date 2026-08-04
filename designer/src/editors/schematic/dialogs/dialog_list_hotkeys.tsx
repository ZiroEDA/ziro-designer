// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List dialog (Ctrl+F1, Help > List Hotkeys). Counterpart:
 * `DIALOG_LIST_HOTKEYS` showing a read-only `PANEL_HOTKEYS_EDITOR`.
 *
 * A thin renderer: the contents come from `buildHotkeyList`, which is where the
 * behaviour and the tests live. Upstream's panel is a tree of sections with an
 * editable key column; ours is read-only, since rebinding needs a hotkey store
 * we do not have.
 */

import type { JSX } from 'react';
import type { HotkeySection } from '../hotkey_list.js';

interface Props {
  sections: readonly HotkeySection[];
  onClose: () => void;
}

export function DialogListHotkeys({ sections, onClose }: Props): JSX.Element {
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 520, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Hotkey List
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ padding: '8px 12px', maxHeight: '60vh', overflowY: 'auto' }}>
          {sections.map((section) => (
            <div key={section.name} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{section.name}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={`${section.name}:${row.action}`}>
                      <td style={{ padding: '2px 8px 2px 0' }}>{row.action}</td>
                      <td
                        style={{
                          padding: '2px 0',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                          opacity: 0.8,
                        }}
                      >
                        {row.keys}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
