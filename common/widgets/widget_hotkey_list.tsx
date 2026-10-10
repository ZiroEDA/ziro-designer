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

import { Button, StaticLine } from '../wx/controls.js';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { filterHotkeys, hotkeyConflicts, type HotkeySection } from '../hotkey_store.js';
import { isBrowserReserved } from '../browser_hotkeys.js';
import { comboFromEvent, isReservedHotkey } from '../hotkeys_basic_keys.js';
import { DialogShim } from '../dialog_shim.js';
import { DisplayErrorMessage, ShowKicadMessageDialog } from '../confirm.js';
import { wxNO_DEFAULT, wxYES_NO } from '../wx/defs.js';
import { wxID_YES } from '../wx/menu.js';

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
      // Escape is not a hotkey being assigned, it is the dialog's Cancel -
      // "the ESC key was used to close the dialog" in PromptForKey. The modal
      // dialog (DialogShim) owns it, so leave it alone here
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

  // HK_PROMPT_DIALOG's sizer tree (widget_hotkey_list.cpp:87-135); the borders are its Add()s.
  return (
    <DialogShim title="Set Hotkey" onClose={onCancel} className="ze-hkprompt">
      {/* inst_label, wxALIGN_CENTRE_HORIZONTAL: wxALL 10 */}
      <span className="ze-hkprompt-inst">Press a new hotkey, or press Esc to cancel...</span>
      {/* new wxStaticLine: wxALL|wxEXPAND 2 */}
      <StaticLine className="ze-hkprompt-line" />
      {/* panelDisplayCurrent: wxALL|wxEXPAND 5, a two-column wxFlexGridSizer */}
      <div className="ze-hkprompt-current">
        <span>Command:</span>
        <span className="ze-hkprompt-bold">{prompt.command}</span>
        <span>Current key:</span>
        <span className="ze-hkprompt-bold">{prompt.current}</span>
      </div>
      {/* resetButton: wxALL|wxALIGN_CENTRE_HORIZONTAL 5 */}
      <Button
        label="Clear assigned hotkey"
        className="ze-hkprompt-reset"
        onClick={() => onPick(null)}
      />
    </DialogShim>
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

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the dialog is up, so a
  // closed one does not sit on the stack swallowing the key.
  // The conflict box's Esc is its "No", the button that changes nothing.
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
      DisplayErrorMessage(`'${keys}' is a reserved hotkey in KiCad and cannot be assigned.`);
      return;
    }
    // WIDGET_HOTKEY_LIST::resolveKeyConflicts — both bindings are kept, and only
    // one runs, so this warns rather than refusing.
    const taken = hotkeyConflicts(all, keys, name)[0];
    if (taken) {
      // KICAD_MESSAGE_DIALOG( …, wxYES_NO | wxNO_DEFAULT ).ShowModal() == wxID_YES.
      void ShowKicadMessageDialog({
        message: `'${keys}' is already assigned to '${taken.command}' in section '${taken.section}'. Both bindings are kept, but only one runs per key press. Continue?`,
        caption: 'Hotkey conflict',
        style: wxYES_NO | wxNO_DEFAULT,
      }).then((aAnswer) => {
        if (aAnswer === wxID_YES) onSet(name, keys);
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
    </>
  );
}
