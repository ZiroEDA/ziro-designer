// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkey List dialog (Ctrl+F1, Help > List Hotkeys). Counterpart:
 * `DIALOG_LIST_HOTKEYS`, which is a `PANEL_HOTKEYS_EDITOR` constructed with
 * `readOnly = true` — the same widget the Preferences page uses, with editing
 * switched off. This is that, so the two can never drift: rebinding happens in
 * Preferences > Hotkeys, and this shows the result.
 */

import type { JSX } from 'react';
import { PanelHotkeysEditor } from '../../../prefs/PanelHotkeysEditor.js';
import { settings } from '../../../prefs/settings.js';

export function DialogListHotkeys({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 560, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Hotkey List
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ padding: '8px 12px', maxHeight: '60vh', display: 'flex', minHeight: 0 }}>
          <PanelHotkeysEditor overrides={settings.hotkeys} readOnly />
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
