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
 * and the panel is a filter box over a two-column tree, grouped by section:
 *
 *     m_filterSearch = CreateTextFilterBox( this, _( "Type filter text" ) );
 *     bMargins->Add( m_filterSearch, 0, wxEXPAND | wxTOP | wxRIGHT, 5 );
 *     m_hotkeyListCtrl = new WIDGET_HOTKEY_LIST( this, m_hotkeyStore, readOnly );
 *     bMargins->Add( m_hotkeyListCtrl, 1, wxEXPAND | wxTOP | wxRIGHT, 5 );
 *
 * Left out: the panel's own button row, "Undo All Changes" and
 * "Import Hotkeys...". Both edit the hotkey configuration, and this dialog
 * builds the panel read-only precisely so nothing here can - upstream installs
 * them unconditionally because the same panel is also the Preferences page,
 * where they do work. There is no hotkey editor here to undo into, and carrying
 * two buttons that can never do anything is the noise we took out of the
 * template menu.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { HOTKEY_SECTIONS, filterHotkeys } from './hotkeys_table.js';

export function HotkeyListDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => filterHotkeys(HOTKEY_SECTIONS, filter), [filter]);
  const searchRef = useRef<HTMLInputElement>(null);

  // The filter box takes focus, which is what a dialog whose only control is a
  // filter should do.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const total = useMemo(() => HOTKEY_SECTIONS.reduce((n, s) => n + s.entries.length, 0), []);
  const showing = shown.reduce((n, s) => n + s.entries.length, 0);

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
            <div className="ze-hotkeys-head">
              <span className="cmd">Command</span>
              <span className="key">Hotkey</span>
            </div>
            {shown.length === 0 ? (
              <div className="ze-hotkeys-empty">No hotkeys match “{filter}”.</div>
            ) : (
              shown.map((s) => (
                <div className="ze-hotkeys-section" key={s.name}>
                  <div className="ze-hotkeys-sectionhead">{s.name}</div>
                  {s.entries.map((e) => (
                    <div className="ze-hotkeys-row" key={`${s.name}/${e.command}/${e.keys}`}>
                      <span className="cmd">{e.command}</span>
                      <span className="key">{e.keys}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="ze-modal-footer" style={{ justifyContent: 'space-between' }}>
          {/* Not upstream, which has nothing here. A filtered list that is
              simply short gives no clue whether it is short because the filter
              worked or because the list is thin. */}
          <span className="ze-hotkeys-count">
            {filter === '' ? `${total} commands` : `${showing} of ${total} commands`}
          </span>
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
