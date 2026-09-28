// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_HOTKEYS_EDITOR` (common/dialogs/panel_hotkeys_editor.cpp). The
 * `WIDGET_HOTKEY_LIST` inside it, and the `HK_PROMPT_DIALOG` that opens, are
 * `common/widgets/widget_hotkey_list.tsx`.
 *
 * There is one of this panel and two windows show it:
 *
 *     // DIALOG_LIST_HOTKEYS, Help > List Hotkeys
 *     m_hk_list = new PANEL_HOTKEYS_EDITOR( aParent, this, true );
 *     // PANEL_HOTKEYS_EDITOR as a Preferences page
 *     ... new PANEL_HOTKEYS_EDITOR( aFrame, aParent, false );
 *
 * which is the whole reason `readOnly` is a parameter rather than two widgets.
 * We had grown the two widgets: a Preferences page over the schematic's 98
 * actions in menu-named sections, and a Hotkey List over the whole app in
 * upstream's app-named ones. Each had a half of this - the page could rebind
 * and could not see the app, the list could see the app and could not rebind -
 * and the halves disagreed about what a command is called, which is how an
 * override written in one became invisible to the other.
 *
 * `readOnly` gates exactly what it gates upstream:
 *
 *     if( readOnly ) command_header = _( "Command" );
 *     else           command_header = _( "Command (double-click to edit)" );
 *     ...
 *     if( !readOnly ) Bind( wxEVT_TREELIST_ITEM_ACTIVATED, ... );
 *
 * so the first column's header, double-click to rebind, and the context menu.
 * The two buttons below are added by `installButtons` unconditionally, in both
 * windows - a read-only list still imports a file and still discards changes.
 *
 * `children` is `GetBottomSizer()`, which is how DIALOG_LIST_HOTKEYS puts its
 * OK and Cancel in the panel's own button row rather than under it.
 */

import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { HotkeyOverrides, HotkeySection } from '../hotkey_store.js';
import { importOntoNames, parseHotkeyFile } from '../hotkeys_basic_file.js';
import { WidgetHotkeyList } from '../widgets/widget_hotkey_list.js';
import { ButtonRowPanel } from '../widgets/button_row_panel.js';

interface Props {
  /**
   * `m_actions`, the actions list: every program's TOOL_ACTIONs, which the
   * frame collects (`kiface->GetActions( hotkeysPanel->ActionsList() )`) and
   * the panel's HOTKEY_STORE folds into sections with the overrides applied.
   */
  actions: (overrides: HotkeyOverrides) => HotkeySection[];
  overrides: HotkeyOverrides;
  /** Absent from the map = the action keeps its default. */
  onChange?: (next: HotkeyOverrides) => void;
  /** `PANEL_HOTKEYS_EDITOR`'s own `readOnly` flag. */
  readOnly?: boolean;
  /** `GetBottomSizer()` - what a hosting dialog adds beside the panel's buttons. */
  children?: ReactNode;
}

export function PanelHotkeysEditor({
  actions,
  overrides,
  onChange,
  readOnly,
  children,
}: Props): JSX.Element {
  const [filter, setFilter] = useState('');
  /**
   * `ResetAllHotkeys( false )` is `ResetAllHotkeysToOriginal` — back to what was
   * stored when this window opened, not to the defaults. Restoring the defaults
   * is `ResetAllHotkeysToDefault`, which only the row context menu reaches.
   */
  const [opened] = useState<HotkeyOverrides>(() => ({ ...overrides }));
  /** What the last import did, so a file that matched nothing says so. */
  const [imported, setImported] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => actions(overrides), [actions, overrides]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const set = (name: string, keys: string | null | undefined): void => {
    const next: Record<string, string | null> = { ...overrides };
    if (keys === undefined) delete next[name];
    else next[name] = keys;
    onChange?.(next);
  };

  /** `m_hotkeyListCtrl->ResetAllHotkeys( false )`. */
  const undoAllChanges = (): void => {
    onChange?.({ ...opened });
    setImported('');
  };

  /**
   * `ImportHotKeys`. `wxFileSelector( _( "Import Hotkeys File:" ), ...,
   * FILEEXT::HotkeyFileExtension, FILEEXT::HotkeyFileWildcard(), wxFD_OPEN )`
   * is a hidden file input here — the one way a browser lets a page read a file
   * the user picked, and it needs the click to come from the button.
   */
  const onFilePicked = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const parsed = parseHotkeyFile(await file.text());
    const names = all.flatMap((s) => s.entries.map((e) => e.name)).filter((n) => n !== '');
    const result = importOntoNames(parsed, names);
    onChange?.({ ...overrides, ...result.overrides });
    setImported(
      result.matched === 0
        ? `${file.name}: none of its ${result.total} commands are ones this app has.`
        : `${file.name}: ${result.matched} of ${result.total} commands applied.`,
    );
  };

  return (
    <div className="ze-hotkeys-panel">
      {/* CreateTextFilterBox( this, _( "Type filter text" ) ) - a wxSearchCtrl,
          so it carries the same magnifier the template selector's does. */}
      <div className="ze-tplsel-searchwrap ze-hotkeys-filter">
        <span className="mag" aria-hidden="true" />
        <input
          ref={searchRef}
          className="ze-tplsel-nameinput ze-bare"
          type="text"
          placeholder="Type filter text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          // The panel can live inside the editor, whose global handler would
          // treat every character typed here as a hotkey.
          onKeyDown={(e) => e.stopPropagation()}
        />
        {filter !== '' && (
          <span className="cancel" title="Clear the filter" onClick={() => setFilter('')} />
        )}
      </div>

      <WidgetHotkeyList all={all} filter={filter} readOnly={readOnly} onSet={set} />

      {/* installButtons: two on the left (l_btn_defs, with an empty
          r_btn_defs), and a hosting dialog's OK/Cancel after them, which GTK
          lays out on the right. */}
      <div className="ze-modal-footer ze-hotkeys-foot">
        <div className="left">
          <ButtonRowPanel
            left={[
              {
                text: 'Undo All Changes',
                tooltip: 'Undo all changes made so far in this dialog',
                onClick: undoAllChanges,
              },
              {
                text: 'Import Hotkeys...',
                tooltip:
                  'Import hotkey definitions from an external file, replacing the current values',
                onClick: () => fileRef.current?.click(),
              },
            ]}
          />
          <input
            ref={fileRef}
            type="file"
            // FILEEXT::HotkeyFileWildcard() is "Hotkey file (*.hotkeys)" and
            // nothing else, so this offers nothing else either.
            accept=".hotkeys"
            hidden
            onChange={(e) => {
              void onFilePicked(e.target.files?.[0]);
              // So picking the same file twice fires twice.
              e.target.value = '';
            }}
          />
          {imported !== '' && <span className="ze-hotkeys-imported">{imported}</span>}
        </div>
        <div className="right">{children}</div>
      </div>
    </div>
  );
}
