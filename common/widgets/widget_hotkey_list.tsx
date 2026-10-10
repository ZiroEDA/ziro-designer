// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WIDGET_HOTKEY_LIST` (`include/widgets/widget_hotkey_list.h`,
 * `common/widgets/widget_hotkey_list.cpp`): the command/hotkey tree inside
 * `PANEL_HOTKEYS_EDITOR`, with the `HK_PROMPT_DIALOG` it opens on a
 * double-click and its `resolveKeyConflicts` question.
 *
 * `ApplyFilterString` is the `filter` prop; the panel owns the search box.
 * Rebinding goes out through `onSet` (`changeHotkey`), and the panel owns the
 * overrides map, which is the `HOTKEY_STORE` both share upstream.
 */

import { Button } from '../wx/controls.js';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { filterHotkeys, hotkeyConflicts, type HotkeySection } from '../hotkey_store.js';
import { isBrowserReserved } from '../browser_hotkeys.js';
import { comboFromEvent, isReservedHotkey } from '../hotkeys_basic_keys.js';
import { useModalEscape } from '../dialog_shim.js';

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
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Modifiers alone are not a hotkey; upstream's MapKeypressToKeycode
      // returns 0 for them and the dialog keeps waiting.
      if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'OS'].includes(e.key)) return;
      // Escape is not a hotkey being assigned, it is the dialog's Cancel -
      // "the ESC key was used to close the dialog" in PromptForKey. The modal
      // stack owns it (see useModalEscape above), so leave it alone here
      // rather than race that listener for it.
      if (e.key === 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onPick(comboFromEvent(e));
    };
    // Capture, so the combo being assigned cannot also fire whatever it is
    // currently bound to on the way past.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onPick]);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
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
            <Button label="Clear assigned hotkey" onClick={() => onPick(null)} />
          </div>
        </div>
      </div>
    </div>
  );
}

export interface WidgetHotkeyListProps {
  /** Every section, with the overrides already applied (`m_hk_store`). */
  all: HotkeySection[];
  /** `ApplyFilterString( aFilterStr )`. */
  filter: string;
  /** `WIDGET_HOTKEY_LIST( ..., aReadOnly )`. */
  readOnly?: boolean;
  /**
   * `changeHotkey`: `keys` is the new combo, `null` clears it ("Clear
   * assigned hotkey").
   */
  onSet: (name: string, keys: string | null) => void;
}

export function WidgetHotkeyList({
  all,
  filter,
  readOnly,
  onSet,
}: WidgetHotkeyListProps): JSX.Element {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [conflict, setConflict] = useState<{ name: string; keys: string; message: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the dialog is up, so a
  // closed one does not sit on the stack swallowing the key.
  // The conflict box's Esc is its "No", the button that changes nothing.
  useModalEscape(() => setConflict(null), conflict !== null);
  useModalEscape(() => setError(null), error !== null);
  /** Every section starts expanded, as the tree does when the window opens. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /**
   * wxTL_SINGLE: the tree carries one selected row, drawn in the system
   * highlight. Without it the rows do not respond to a click at all, which is
   * the one way this list did not behave like a list.
   */
  const [selected, setSelected] = useState<string | null>(null);

  const shown = useMemo(() => filterHotkeys(all, filter), [all, filter]);

  const pick = (keys: string | null): void => {
    if (!prompt) return;
    const name = prompt.name;
    setPrompt(null);
    if (keys === null) {
      onSet(name, null);
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
    onSet(name, keys);
  };

  return (
    <>
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
                        /* No tooltip. `WIDGET_HOTKEY_LIST` calls SetToolTip on
                           nothing at all: the instruction lives in the COLUMN
                           HEADER, "Command (double-click to edit)"
                           (`widget_hotkey_list.cpp:534-541`), which is where a
                           reader meets it once instead of on every row. */
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
                        {/* A combo the browser keeps for itself reaches this
                            app only while it is fullscreen, and never in a
                            plain tab - Ctrl+N is ACTIONS::newProject and also
                            Chrome's new window. Saying so on the row is the
                            only place a user looking up a key would find out;
                            without it the list promises a key that opens
                            something else entirely. */}
                        <span
                          className={`key${isBrowserReserved(e.keys) ? ' taken' : ''}`}
                          title={
                            isBrowserReserved(e.keys)
                              ? `${e.keys} belongs to the browser and cannot be intercepted by a page. It reaches ZiroEDA only in fullscreen.`
                              : undefined
                          }
                        >
                          {e.keys}
                        </span>
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

      {prompt && <HotkeyPrompt prompt={prompt} onPick={pick} onCancel={() => setPrompt(null)} />}
      {error && (
        <div className="ze-modal-backdrop" onMouseDown={() => setError(null)}>
          <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">Hotkeys</div>
            <div style={{ padding: '12px 16px' }}>{error}</div>
            <div className="ze-modal-footer">
              <Button label="OK" isDefault onClick={() => setError(null)} />
            </div>
          </div>
        </div>
      )}
      {conflict && (
        <div className="ze-modal-backdrop" onMouseDown={() => setConflict(null)}>
          <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">Hotkey conflict</div>
            <div style={{ padding: '12px 16px' }}>{conflict.message}</div>
            <div className="ze-modal-footer">
              <Button label="No" onClick={() => setConflict(null)} />
              <Button
                label="Yes"
                isDefault
                onClick={() => {
                  onSet(conflict.name, conflict.keys);
                  setConflict(null);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
