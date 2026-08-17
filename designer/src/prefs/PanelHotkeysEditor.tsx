// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_HOTKEYS_EDITOR` (common/dialogs/panel_hotkeys_editor.cpp), with the
 * `WIDGET_HOTKEY_LIST` inside it and the `HK_PROMPT_DIALOG` it opens.
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
import {
  buildHotkeySections,
  filterHotkeys,
  hotkeyConflicts,
  type HotkeyOverrides,
} from '../ui/hotkeys_inventory.js';
import { importOntoNames, parseHotkeyFile } from '../ui/hotkeys_file.js';
import { comboFromEvent, isReservedHotkey } from '../editors/schematic/hotkey_bindings.js';

interface Props {
  overrides: HotkeyOverrides;
  /** Absent from the map = the action keeps its default. */
  onChange?: (next: HotkeyOverrides) => void;
  /** `PANEL_HOTKEYS_EDITOR`'s own `readOnly` flag. */
  readOnly?: boolean;
  /** `GetBottomSizer()` - what a hosting dialog adds beside the panel's buttons. */
  children?: ReactNode;
}

/** A row being rebound: HK_PROMPT_DIALOG's subject. */
interface Prompt {
  name: string;
  command: string;
  current: string;
}

/**
 * HK_PROMPT_DIALOG. Captures the next keypress, or Esc to cancel, and offers
 * "Clear assigned hotkey" — the only route to an action with no key at all.
 */
function HotkeyPrompt({
  prompt,
  onPick,
  onCancel,
}: {
  prompt: Prompt;
  onPick: (keys: string | null) => void;
  onCancel: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Modifiers alone are not a hotkey; upstream's MapKeypressToKeycode
      // returns 0 for them and the dialog keeps waiting.
      if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'OS'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') onCancel();
      else onPick(comboFromEvent(e));
    };
    // Capture, so the combo being assigned cannot also fire whatever it is
    // currently bound to on the way past.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onPick, onCancel]);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        style={{ width: 380, maxWidth: '92vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">Set Hotkey</div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            Press a new hotkey, or press Esc to cancel...
          </div>
          <hr style={{ border: 0, borderTop: '1px solid var(--ze-border, #444)' }} />
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <td style={{ padding: '3px 10px 3px 0' }}>Command:</td>
                <td style={{ fontWeight: 600 }}>{prompt.command}</td>
              </tr>
              <tr>
                <td style={{ padding: '3px 10px 3px 0' }}>Current key:</td>
                <td style={{ fontWeight: 600 }}>{prompt.current}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button type="button" className="ze-btn" onClick={() => onPick(null)}>
              Clear assigned hotkey
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PanelHotkeysEditor({
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
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [conflict, setConflict] = useState<{ name: string; keys: string; message: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** What the last import did, so a file that matched nothing says so. */
  const [imported, setImported] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Every section starts expanded, as the tree does when the window opens. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /**
   * wxTL_SINGLE: the tree carries one selected row, drawn in the system
   * highlight. Without it the rows do not respond to a click at all, which is
   * the one way this list did not behave like a list.
   */
  const [selected, setSelected] = useState<string | null>(null);

  const all = useMemo(() => buildHotkeySections(overrides), [overrides]);
  const shown = useMemo(() => filterHotkeys(all, filter), [all, filter]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const set = (name: string, keys: string | null | undefined): void => {
    const next: Record<string, string | null> = { ...overrides };
    if (keys === undefined) delete next[name];
    else next[name] = keys;
    onChange?.(next);
  };

  const pick = (keys: string | null): void => {
    if (!prompt) return;
    const name = prompt.name;
    setPrompt(null);
    if (keys === null) {
      set(name, null);
      return;
    }
    if (isReservedHotkey(keys)) {
      setError(`'${keys}' is a reserved hotkey and cannot be assigned.`);
      return;
    }
    // WIDGET_HOTKEY_LIST::resolveKeyConflicts — both bindings are kept, and only
    // one runs, so this warns rather than refusing.
    const taken = hotkeyConflicts(all, keys, name)[0];
    if (taken) {
      setConflict({
        name,
        keys,
        message: `'${keys}' is already assigned to '${taken.command}' in section '${taken.section}'. Both bindings are kept, but only one runs per key press. Continue?`,
      });
      return;
    }
    set(name, keys);
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

      <div className="ze-hotkeys-list">
        {/* AppendColumn( command_header, 450 ), ( "Hotkey", 120 ),
            ( "Alternate", 120 ), ( "Description", 900 ). */}
        <div className="ze-hotkeys-head">
          <span className="cmd">{readOnly ? 'Command' : 'Command (double-click to edit)'}</span>
          <span className="key">Hotkey</span>
          <span className="alt">Alternate</span>
          <span className="desc">Description</span>
        </div>
        {shown.length === 0 ? (
          <div className="ze-hotkeys-empty">No hotkeys match “{filter}”.</div>
        ) : (
          shown.map((s) => {
            // A filter that matched something opens the section it matched in,
            // so a search never hides its own results behind a twisty.
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
                  s.entries.map((e) => {
                    const rowKey = `${s.name}/${e.command}`;
                    // A PSEUDO_ACTION has no name and so cannot be rebound; a
                    // gesture is not a keystroke to reassign.
                    const editable = !readOnly && e.name !== '';
                    return (
                      <div
                        className={`ze-hotkeys-row${selected === rowKey ? ' selected' : ''}${
                          e.keys !== e.defaultKeys ? ' changed' : ''
                        }`}
                        key={rowKey}
                        title={editable ? 'Double-click to edit' : undefined}
                        onMouseDown={() => setSelected(rowKey)}
                        onDoubleClick={
                          editable
                            ? () =>
                                setPrompt({
                                  name: e.name,
                                  command: e.command,
                                  current: e.keys === '' ? '(none)' : e.keys,
                                })
                            : undefined
                        }
                      >
                        <span className="cmd">{e.command}</span>
                        <span className="key">{e.keys}</span>
                        <span className="alt">{e.alt}</span>
                        <span className="desc">{e.description}</span>
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {/* installButtons: two on the left (l_btn_defs, with an empty
          r_btn_defs), and a hosting dialog's OK/Cancel after them, which GTK
          lays out on the right. */}
      <div className="ze-modal-footer ze-hotkeys-foot">
        <div className="left">
          <button
            type="button"
            className="ze-btn"
            title="Undo all changes made so far in this dialog"
            onClick={undoAllChanges}
          >
            Undo All Changes
          </button>
          <button
            type="button"
            className="ze-btn"
            title="Import hotkey definitions from an external file, replacing the current values"
            onClick={() => fileRef.current?.click()}
          >
            Import Hotkeys…
          </button>
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

      {prompt && <HotkeyPrompt prompt={prompt} onPick={pick} onCancel={() => setPrompt(null)} />}
      {error && (
        <div className="ze-modal-backdrop" onMouseDown={() => setError(null)}>
          <div
            className="ze-modal"
            style={{ width: 400, maxWidth: '92vw' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ze-modal-header">Hotkeys</div>
            <div style={{ padding: '12px 16px' }}>{error}</div>
            <div className="ze-modal-footer">
              <button type="button" className="ze-btn primary" onClick={() => setError(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {conflict && (
        <div className="ze-modal-backdrop" onMouseDown={() => setConflict(null)}>
          <div
            className="ze-modal"
            style={{ width: 420, maxWidth: '92vw' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ze-modal-header">Hotkey conflict</div>
            <div style={{ padding: '12px 16px' }}>{conflict.message}</div>
            <div className="ze-modal-footer">
              <button type="button" className="ze-btn" onClick={() => setConflict(null)}>
                No
              </button>
              <button
                type="button"
                className="ze-btn primary"
                onClick={() => {
                  set(conflict.name, conflict.keys);
                  setConflict(null);
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
