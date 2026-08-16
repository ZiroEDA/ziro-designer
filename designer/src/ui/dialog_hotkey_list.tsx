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
import { buildHotkeySections, filterHotkeys } from './hotkeys_inventory.js';
import { onShowHotkeyList } from './hotkey_list_action.js';

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
  const all = useMemo(() => buildHotkeySections(), []);
  const shown = useMemo(() => filterHotkeys(all, filter), [all, filter]);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Every section starts expanded, as the tree does when the dialog opens. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // The filter box takes focus, which is what a dialog whose only control is a
  // filter should do.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const total = useMemo(() => all.reduce((n, s) => n + s.entries.length, 0), [all]);
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
                        <div className="ze-hotkeys-row" key={`${s.name}/${e.command}`}>
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

        <div className="ze-modal-footer" style={{ justifyContent: 'space-between' }}>
          {/* Not upstream, which has nothing here. A filtered list that is
              simply short gives no clue whether it is short because the filter
              worked or because the list is thin. */}
          <span className="ze-hotkeys-count">
            {filter === '' ? `${total} commands` : `${showing} of ${total} commands`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* PANEL_HOTKEYS_EDITOR::installButtons puts these two on the left
                and DIALOG_LIST_HOTKEYS adds OK/Cancel on the right. Both edit
                the hotkey configuration, which this dialog builds the panel
                read-only to prevent, so they are here in their own slots and
                disabled rather than absent - the shape of the window is the
                thing being matched, and a hotkey editor is its own feature. */}
            <button className="ze-btn" disabled title="Editing hotkeys is not built yet">
              Undo All Changes
            </button>
            <button className="ze-btn" disabled title="Editing hotkeys is not built yet">
              Import Hotkeys…
            </button>
            <button className="ze-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="ze-btn" onClick={onClose}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
