// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_LIST_HOTKEYS (common/dialogs/dialog_hotkey_list.cpp), the window
 * Help > List Hotkeys opens.
 *
 * Upstream is a thin frame - a DIALOG_SHIM titled "Hotkey List" around a
 * PANEL_HOTKEYS_EDITOR built read-only, with OK and Cancel put into the panel's
 * own button row:
 *
 *     m_hk_list = new PANEL_HOTKEYS_EDITOR( aParent, this, true );
 *     ...
 *     wxStdDialogButtonSizer* sdb_sizer = new wxStdDialogButtonSizer;
 *     sdb_sizer->AddButton( new wxButton( m_hk_list, wxID_OK ) );
 *     sdb_sizer->AddButton( new wxButton( m_hk_list, wxID_CANCEL ) );
 *     sdb_sizer->Realize();
 *     m_hk_list->GetBottomSizer()->Add( sdb_sizer, ... );
 *
 *     main_sizer->SetMinSize( 600, 400 );
 *
 * and everything else - the filter box, the four-column tree, the sections,
 * "Undo All Changes", "Import Hotkeys..." - belongs to the panel, which is also
 * the Hotkeys preference page. This file is that frame and nothing more; it had
 * been a second implementation of the panel.
 *
 * The list it shows is every action the app has, collected by
 * hotkeys_inventory.ts from the menu builders, the toolbar tables and the
 * schematic's action registry.
 */
import { useEffect, useState, type JSX } from 'react';
import { PanelHotkeysEditor } from '../prefs/PanelHotkeysEditor.js';
import { buildHotkeySections, type HotkeyOverrides } from './hotkeys_inventory.js';
import { claimBrowserHotkeys, lockReservedKeysWhileFullscreen } from './browser_hotkeys.js';
import { onShowHotkeyList } from './hotkey_list_action.js';
import { settings } from '../prefs/settings.js';

/**
 * The host for ACTIONS::listHotKeys. One of these is mounted above the app, so
 * the action and its Ctrl+F1 are global exactly as `.Scope( AS_GLOBAL )` says -
 * the registry it subscribes to lives in hotkey_list_action.ts, which the menu
 * builders can import without pulling JSX into qa's typecheck.
 */
export function HotkeyListHost(): JSX.Element | null {
  const [open, setOpen] = useState(false);

  /**
   * Stop the browser acting on the keys the app has bound.
   *
   * Mounted here because this component is already the one thing above the
   * whole app, and because the set it claims comes from the same inventory the
   * Hotkey List shows - so a command that appears in that window with a key
   * beside it is a command whose key the browser has been told to leave alone.
   * Rebuilt when the overrides change, since a rebound command claims a
   * different combo.
   *
   * See ui/browser_hotkeys.ts for what a page can and cannot take. The short
   * version is that Ctrl+N is `ACTIONS::newProject` and also Chrome's new
   * window, and no page can have it.
   */
  useEffect(() => {
    const { release } = claimBrowserHotkeys(
      buildHotkeySections(settings.hotkeys).flatMap((s) => s.entries.map((e) => e.keys)),
    );
    // And take the ones no page is given, for as long as the app is fullscreen,
    // which is the only circumstance a browser permits it.
    const unwatch = lockReservedKeysWhileFullscreen();
    return () => {
      release();
      unwatch();
    };
  }, []);

  useEffect(() => {
    const off = onShowHotkeyList(() => setOpen(true));
    // Upstream registers this accelerator with the tool manager once, not in
    // each frame's key handler.
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'F1') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return open ? <HotkeyListDialog onClose={() => setOpen(false)} /> : null;
}

export function HotkeyListDialog({ onClose }: { onClose: () => void }): JSX.Element {
  /**
   * `HOTKEY::m_EditKeycode` - the pending value the tree shows, which OK
   * commits and Cancel drops. The stored binding does not move until
   * TransferDataFromWindow, which is why the dialog holds a copy rather than
   * writing settings as the user goes.
   */
  const [edit, setEdit] = useState<HotkeyOverrides>(() => ({ ...settings.hotkeys }));

  /** DIALOG_LIST_HOTKEYS::TransferDataFromWindow, forwarded to the panel. */
  const onOk = (): void => {
    settings.setHotkeys(edit);
    onClose();
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal ze-hotkeys"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="ze-modal-header">
          Hotkey List
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-hotkeys-body">
          {/* PANEL_HOTKEYS_EDITOR( aParent, this, true ) - the same panel the
              Preferences page shows, built read-only. */}
          <PanelHotkeysEditor readOnly overrides={edit} onChange={setEdit}>
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
