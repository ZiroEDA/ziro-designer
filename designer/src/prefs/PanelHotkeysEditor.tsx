// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Hotkeys preference page. Counterparts: `PANEL_HOTKEYS_EDITOR`
 * (common/dialogs/panel_hotkeys_editor.cpp), the `WIDGET_HOTKEY_LIST` inside it,
 * and the `HK_PROMPT_DIALOG` it opens to capture a keypress.
 *
 * Upstream builds one panel and passes `readOnly` to it: the Preferences page is
 * the editable instance and `DIALOG_LIST_HOTKEYS` (Ctrl+F1) is the same panel
 * with editing switched off. This is that panel, and the read-only dialog
 * renders it the same way.
 *
 * What it edits is a map of *overrides* — an action absent from the map keeps
 * its `DefaultHotkey`. See `hotkey_bindings.ts` for how one reaches the editor's
 * key handler.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import { buildHotkeyList, hotkeyConflicts } from '../editors/schematic/hotkey_list.js';
import {
  comboFromEvent,
  isReservedHotkey,
  type HotkeyOverrides,
} from '../editors/schematic/hotkey_bindings.js';

interface Props {
  overrides: HotkeyOverrides;
  /** Absent from the map = the action keeps its default. */
  onChange?: (next: HotkeyOverrides) => void;
  /** `PANEL_HOTKEYS_EDITOR`'s own `readOnly` flag. */
  readOnly?: boolean;
}

/** A row being rebound: HK_PROMPT_DIALOG's subject. */
interface Prompt {
  id: string;
  action: string;
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
                <td style={{ fontWeight: 600 }}>{prompt.action}</td>
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

export function PanelHotkeysEditor({ overrides, onChange, readOnly }: Props): JSX.Element {
  const [filter, setFilter] = useState('');
  // ResetAllHotkeys(false) — "Undo All Changes" goes back to what was *stored*
  // when the page opened, not to the defaults. Restoring the defaults is the
  // dialog's own "Reset to Defaults" (RESETTABLE_PANEL::ResetPanel).
  const [opened] = useState<HotkeyOverrides>(() => ({ ...overrides }));
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [conflict, setConflict] = useState<{ id: string; keys: string; message: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => buildHotkeyList(overrides), [overrides]);
  const needle = filter.trim().toLowerCase();
  const shown = sections
    .map((s) => ({
      ...s,
      rows: s.rows.filter(
        (r) =>
          needle === '' ||
          r.action.toLowerCase().includes(needle) ||
          r.keys.toLowerCase().includes(needle),
      ),
    }))
    .filter((s) => s.rows.length > 0);

  const set = (id: string, keys: string | null | undefined): void => {
    const next: Record<string, string | null> = { ...overrides };
    if (keys === undefined) delete next[id];
    else next[id] = keys;
    onChange?.(next);
  };

  const pick = (keys: string | null): void => {
    if (!prompt) return;
    const id = prompt.id;
    setPrompt(null);
    if (keys === null) {
      set(id, null);
      return;
    }
    if (isReservedHotkey(keys)) {
      setError(`'${keys}' is a reserved hotkey and cannot be assigned.`);
      return;
    }
    // WIDGET_HOTKEY_LIST::resolveKeyConflicts — both bindings are kept, and only
    // one runs, so this warns rather than refusing.
    const taken = hotkeyConflicts(keys, id, overrides)[0];
    if (taken) {
      setConflict({
        id,
        keys,
        message: `'${keys}' is already assigned to '${taken.action}' in section '${taken.section}'. Both bindings are kept, but only one runs per key press. Continue?`,
      });
      return;
    }
    set(id, keys);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <input
        className="ze-input"
        placeholder="Type filter text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        // The panel lives inside the editor, whose global handler would treat
        // every character typed here as a hotkey.
        onKeyDown={(e) => e.stopPropagation()}
        style={{ marginBottom: 6 }}
      />
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {shown.map((section) => (
          <div key={section.name} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, margin: '4px 0' }}>{section.name}</div>
            <table className="ze-pref-hotkeys">
              <tbody>
                {section.rows.map((row) => {
                  const changed = row.keys !== row.defaultKeys;
                  return (
                    <tr
                      key={row.id}
                      title={readOnly ? undefined : 'Double-click to edit'}
                      onDoubleClick={
                        readOnly
                          ? undefined
                          : () =>
                              setPrompt({
                                id: row.id,
                                action: row.action,
                                current: row.keys === '' ? '(none)' : row.keys,
                              })
                      }
                    >
                      <td>{row.action}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: changed ? 600 : undefined }}>
                        {row.keys === '' ? '' : row.keys}
                      </td>
                      {!readOnly && (
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <button
                            type="button"
                            className="ze-btn"
                            title="Clear Assigned Hotkey"
                            disabled={row.keys === ''}
                            onClick={() => set(row.id, null)}
                          >
                            Clear
                          </button>{' '}
                          <button
                            type="button"
                            className="ze-btn"
                            title="Restore Default"
                            disabled={!changed}
                            onClick={() => set(row.id, undefined)}
                          >
                            Default
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {shown.length === 0 && <div className="ze-muted">No commands match the filter.</div>}
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button type="button" className="ze-btn" onClick={() => onChange?.({ ...opened })}>
            Undo All Changes
          </button>
        </div>
      )}
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
                  set(conflict.id, conflict.keys);
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
