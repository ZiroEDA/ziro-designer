// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIST_HOTKEYS` (common/dialogs/dialog_hotkey_list.cpp): Help > List
 * Hotkeys. PANEL_HOTKEYS_EDITOR, built read-only, with OK and Cancel in its
 * bottom sizer. The frame supplies its actions list and the stored hotkeys,
 * and OK writes them back (`WriteHotKeyConfig`); the app's host that opens it
 * on ACTIONS::listHotKeys is `designer/src/ui/hotkey_list_host.tsx`.
 */
import { useState, type JSX } from 'react';
import { PanelHotkeysEditor } from './panel_hotkeys_editor.js';
import type { HotkeyOverrides, HotkeySection } from '../hotkey_store.js';
import { useModalEscape } from './use_modal_escape.js';

export function HotkeyListDialog({
  actions,
  overrides,
  onApply,
  onClose,
}: {
  /** The frame's actions list, as PANEL_HOTKEYS_EDITOR takes it. */
  actions: (overrides: HotkeyOverrides) => HotkeySection[];
  /** The stored hotkeys when the dialog opens. */
  overrides: HotkeyOverrides;
  /** `WriteHotKeyConfig`: what OK commits. */
  onApply: (next: HotkeyOverrides) => void;
  onClose: () => void;
}): JSX.Element {
  /**
   * `HOTKEY::m_EditKeycode` - the pending value the tree shows, which OK
   * commits and Cancel drops. The stored binding does not move until
   * TransferDataFromWindow, which is why the dialog holds a copy rather than
   * writing settings as the user goes.
   */
  const [edit, setEdit] = useState<HotkeyOverrides>(() => ({ ...overrides }));

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  /** DIALOG_LIST_HOTKEYS::TransferDataFromWindow, forwarded to the panel. */
  const onOk = (): void => {
    onApply(edit);
    onClose();
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-hotkeys" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Hotkey List
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-hotkeys-body">
          {/* PANEL_HOTKEYS_EDITOR( aParent, this, true ) - the same panel the
              Preferences page shows, built read-only. */}
          <PanelHotkeysEditor actions={actions} readOnly overrides={edit} onChange={setEdit}>
            {/* sdb_sizer, added to the panel's GetBottomSizer(). */}
            <button type="button" className="ze-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="ze-btn" onClick={onOk}>
              OK
            </button>
          </PanelHotkeysEditor>
        </div>
      </div>
    </div>
  );
}
