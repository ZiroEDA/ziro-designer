// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_LIST_HOTKEYS (common/dialogs/dialog_hotkey_list.cpp), the window
 * Help > List Hotkeys opens.
 *
 * Upstream is a DIALOG_SHIM titled "Hotkey List" wrapping a
 * PANEL_HOTKEYS_EDITOR built read-only:
 *
 *     m_hk_list = new PANEL_HOTKEYS_EDITOR( aParent, this, true );
 *     ...
 *     main_sizer->SetMinSize( 600, 400 );
 *
 * and the panel is a filter box over a four-column tree, grouped by section:
 *
 *     m_filterSearch = CreateTextFilterBox( this, _( "Type filter text" ) );
 *     bMargins->Add( m_filterSearch, 0, wxEXPAND | wxTOP | wxRIGHT, 5 );
 *     m_hotkeyListCtrl = new WIDGET_HOTKEY_LIST( this, m_hotkeyStore, readOnly );
 *     bMargins->Add( m_hotkeyListCtrl, 1, wxEXPAND | wxTOP | wxRIGHT, 5 );
 *
 * WIDGET_HOTKEY_LIST is a wxTreeListCtrl of four columns, and the header of the
 * first depends on whether the panel is editable:
 *
 *     AppendColumn( command_header, 450, ... );   // "Command", read-only here
 *     AppendColumn( _( "Hotkey" ), 120, ... );
 *     AppendColumn( _( "Alternate" ), 120, ... );
 *     AppendColumn( _( "Description" ), 900, ... );
 *
 * The rows come from hotkeys_inventory.ts, which collects them from the menu
 * builders and toolbar tables rather than from a list typed out here.
 *
 * "Undo All Changes" and "Import Hotkeys..." work here, and it is worth being
 * precise about why, because "the list is read-only" suggests they should not.
 * `installButtons` adds both unconditionally, and `readOnly` is passed only to
 * WIDGET_HOTKEY_LIST, where it gates exactly three things:
 *
 *     if( readOnly ) command_header = _( "Command" );
 *     else           command_header = _( "Command (double-click to edit)" );
 *     ...
 *     if( !readOnly )
 *     {
 *         Bind( wxEVT_TREELIST_ITEM_ACTIVATED, ... );   // double-click to rebind
 *         Bind( wxEVT_TREELIST_ITEM_CONTEXT_MENU, ... );
 *         Bind( wxEVT_MENU, ... );
 *     }
 *
 * So the read-only list is read-only against the *mouse*: you cannot pick a row
 * and type a new key. Replacing every binding at once from a file, or throwing
 * the lot away, both still work, and OK still commits - DIALOG_LIST_HOTKEYS
 * forwards TransferDataFromWindow to the panel.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { buildHotkeySections, filterHotkeys, type HotkeyOverrides } from './hotkeys_inventory.js';
import { importOntoNames, parseHotkeyFile } from './hotkeys_file.js';
import { toRowNames, toStoredKeys } from './hotkey_key_space.js';
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
  const [filter, setFilter] = useState('');
  /**
   * `HOTKEY::m_EditKeycode` - the pending value, which the tree shows and OK
   * commits. Upstream keeps it beside `m_Actions[0]->GetHotKey()` in the store
   * for exactly this reason: everything the dialog does happens to the edit
   * copy, and the stored binding does not move until TransferDataFromWindow.
   */
  const [edit, setEdit] = useState<HotkeyOverrides>(() => toRowNames(settings.hotkeys));
  /**
   * What the bindings were when the dialog opened, which is what
   * `ResetAllHotkeysToOriginal` - "Undo All Changes" - puts back. Note it is
   * *not* the defaults; that is `ResetAllHotkeysToDefault`, the other argument
   * to ResetAllHotkeys, which only the row context menu reaches.
   */
  const [opened] = useState<HotkeyOverrides>(() => toRowNames(settings.hotkeys));
  /** What the last import did, so a file that matched nothing says so. */
  const [imported, setImported] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => buildHotkeySections(edit), [edit]);
  const shown = useMemo(() => filterHotkeys(all, filter), [all, filter]);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Every section starts expanded, as the tree does when the dialog opens. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /**
   * wxTL_SINGLE: the tree carries one selected row, drawn in the system
   * highlight. Nothing here acts on the selection - the list is read-only - but
   * without it the rows do not respond to a click at all, which is the one way
   * this window did not behave like a list.
   */
  const [selected, setSelected] = useState<string | null>(null);

  // The filter box takes focus, which is what a dialog whose only control is a
  // filter should do.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /**
   * `m_hotkeyListCtrl->ResetAllHotkeys( false )` - back to what was stored when
   * this window opened, not to the defaults.
   */
  const undoAllChanges = (): void => {
    setEdit({ ...opened });
    setImported('');
  };

  /**
   * `ImportHotKeys`. `wxFileSelector( _( "Import Hotkeys File:" ), ... )` is a
   * hidden file input here - the one way a browser lets a page read a file the
   * user picked, and it needs the click to come from the button, which it does.
   */
  const onFilePicked = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const parsed = parseHotkeyFile(await file.text());
    const names = all.flatMap((s) => s.entries.map((e) => e.name)).filter((n) => n !== '');
    const result = importOntoNames(parsed, names);

    // The overlay is onto the *edit* copy, so an import is undone by Undo All
    // Changes and discarded by Cancel, as upstream's is.
    setEdit((prev) => ({ ...prev, ...result.overrides }));
    setImported(
      result.matched === 0
        ? `${file.name}: none of its ${result.total} commands are ones this app has.`
        : `${file.name}: ${result.matched} of ${result.total} commands applied.`,
    );
  };

  /** DIALOG_LIST_HOTKEYS::TransferDataFromWindow, forwarded to the panel. */
  const onOk = (): void => {
    settings.setHotkeys(toStoredKeys(edit));
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
          {/* CreateTextFilterBox( this, _( "Type filter text" ) ) - a
              wxSearchCtrl, so it carries the same magnifier the template
              selector's does. */}
          <div className="ze-tplsel-searchwrap ze-hotkeys-filter">
            <span className="mag" aria-hidden="true" />
            <input
              ref={searchRef}
              id="ze-hotkeys-filter"
              className="ze-tplsel-nameinput ze-bare"
              type="text"
              placeholder="Type filter text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter !== '' && (
              <span className="cancel" title="Clear the filter" onClick={() => setFilter('')} />
            )}
          </div>

          <div className="ze-hotkeys-list">
            {/* WIDGET_HOTKEY_LIST is a wxTreeListCtrl with two columns,
                "Command" and "Hotkey", and one collapsible row per section. */}
            {/* AppendColumn( "Command", 450 ), ( "Hotkey", 120 ),
                ( "Alternate", 120 ), ( "Description", 900 ). The header reads
                "Command" rather than "Command (double-click to edit)" because
                this dialog builds the panel read-only. */}
            <div className="ze-hotkeys-head">
              <span className="cmd">Command</span>
              <span className="key">Hotkey</span>
              <span className="alt">Alternate</span>
              <span className="desc">Description</span>
            </div>
            {shown.length === 0 ? (
              <div className="ze-hotkeys-empty">No hotkeys match “{filter}”.</div>
            ) : (
              shown.map((s) => {
                // A filter that matched something opens the section it matched
                // in, so a search never hides its own results behind a twisty.
                const shut = filter === '' && collapsed.has(s.name);
                return (
                  <div className="ze-hotkeys-section" key={s.name}>
                    <div
                      className="ze-hotkeys-sectionhead"
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.name)) next.delete(s.name);
                          else next.add(s.name);
                          return next;
                        })
                      }
                    >
                      <span className={`twisty expandable${shut ? '' : ' open'}`} />
                      {s.name}
                    </div>
                    {!shut &&
                      s.entries.map((e) => (
                        <div
                          className={`ze-hotkeys-row${
                            selected === `${s.name}/${e.command}` ? ' selected' : ''
                          }`}
                          key={`${s.name}/${e.command}`}
                          onMouseDown={() => setSelected(`${s.name}/${e.command}`)}
                        >
                          <span className="cmd">{e.command}</span>
                          <span className="key">{e.keys}</span>
                          <span className="alt">{e.alt}</span>
                          <span className="desc">{e.description}</span>
                        </div>
                      ))}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANEL_HOTKEYS_EDITOR::installButtons puts its two on the left
            (BUTTON_ROW_PANEL's l_btn_defs, with an empty r_btn_defs), and
            DIALOG_LIST_HOTKEYS adds the wxStdDialogButtonSizer after it, which
            GTK lays out on the right. Ours had all four bunched right with the
            count where the left pair belongs. */}
        <div className="ze-modal-footer ze-hotkeys-foot">
          <div className="left">
            {/* The two BTN_DEF_LIST entries, with their tooltips verbatim. */}
            <button
              className="ze-btn"
              title="Undo all changes made so far in this dialog"
              onClick={undoAllChanges}
            >
              Undo All Changes
            </button>
            <button
              className="ze-btn"
              title="Import hotkey definitions from an external file, replacing the current values"
              onClick={() => fileRef.current?.click()}
            >
              Import Hotkeys…
            </button>
            <input
              ref={fileRef}
              type="file"
              // FILEEXT::HotkeyFileExtension.
              accept=".hotkeys,text/plain"
              hidden
              onChange={(e) => {
                void onFilePicked(e.target.files?.[0]);
                // So picking the same file twice fires twice.
                e.target.value = '';
              }}
            />
            {imported !== '' && <span className="ze-hotkeys-imported">{imported}</span>}
          </div>
          <div className="right">
            <button className="ze-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="ze-btn" onClick={onOk}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
