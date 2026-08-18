// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Change Symbols / Update Symbols from Library. Counterpart:
 * `eeschema/dialogs/dialog_change_symbols_base.cpp` (DIALOG_CHANGE_SYMBOLS),
 * which is one dialog in two modes — the title, the field-box label and the
 * defaults change, the machinery does not.
 *
 * Update pulls each symbol's own library entry back in; Change swaps the
 * symbols for a different library part. The checklist in the middle is the
 * real decision: which fields the library is allowed to overwrite. Its
 * defaults differ per mode, because changing to a different part should bring
 * that part's look, while updating should leave your field placement alone.
 */
import { useState, type JSX } from 'react';
import {
  defaultChangeSymbolsOptions,
  type ChangeSymbolsMessage,
  type ChangeSymbolsMode,
  type ChangeSymbolsOptions,
  type SymbolMatchMode,
} from '@ziroeda/eeschema';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  mode: ChangeSymbolsMode;
  /** Field names offered in the checklist (every field in use, plus the
   *  mandatory ones), in the order the dialog lists them. */
  fieldNames: readonly string[];
  hasSelection: boolean;
  /** Report lines from the last run; the dialog stays open to show them. */
  messages: readonly ChangeSymbolsMessage[];
  onApply: (o: ChangeSymbolsOptions) => void;
  onClose: () => void;
}

const MATCH_LABELS: { mode: SymbolMatchMode; label: string; needsText: boolean }[] = [
  { mode: 'all', label: 'Update all symbols in schematic', needsText: false },
  { mode: 'selected', label: 'Update selected symbol(s)', needsText: false },
  { mode: 'reference', label: 'Update symbols matching reference designator:', needsText: true },
  { mode: 'value', label: 'Update symbols matching value:', needsText: true },
  { mode: 'libId', label: 'Update symbols matching library identifier:', needsText: true },
];

export function DialogChangeSymbols({
  mode,
  fieldNames,
  hasSelection,
  messages,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [opts, setOpts] = useState<ChangeSymbolsOptions>(() => defaultChangeSymbolsOptions(mode));
  const [matchText, setMatchText] = useState('');
  const [newLibId, setNewLibId] = useState('');

  const set = <K extends keyof ChangeSymbolsOptions>(k: K, v: ChangeSymbolsOptions[K]): void =>
    setOpts((o) => ({ ...o, [k]: v }));

  const toggleField = (name: string): void =>
    setOpts((o) => {
      const next = new Set(o.updateFields);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...o, updateFields: next };
    });

  // The two words the Change-mode SetLabel block swaps out.
  const part = mode === 'change' ? 'new symbol' : 'library symbol';
  const upd = mode === 'change' ? 'Update' : 'Update/reset';

  const check = (label: string, k: keyof ChangeSymbolsOptions, note?: string): JSX.Element => (
    <label className="row">
      <input
        type="checkbox"
        checked={Boolean(opts[k])}
        onChange={(e) => set(k, e.target.checked as never)}
      />
      <span>{label}</span>
      {note && <span className="ze-muted">{note}</span>}
    </label>
  );

  const apply = (): void => {
    onApply({
      ...opts,
      match: {
        mode: opts.match.mode,
        ...(matchText ? { text: matchText } : {}),
      },
      ...(mode === 'change' ? { newLibId } : {}),
    });
  };

  const title = mode === 'change' ? 'Change Symbols' : 'Update Symbols from Library';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal ze-label-dialog"
        style={{ minWidth: 560 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {title}
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          <fieldset className="ze-props-group">
            <legend>Scope</legend>
            {MATCH_LABELS.map((m) => (
              <label className="row" key={m.mode}>
                <input
                  type="radio"
                  name="ze-change-symbols-scope"
                  checked={opts.match.mode === m.mode}
                  disabled={m.mode === 'selected' && !hasSelection}
                  onChange={() => set('match', { mode: m.mode })}
                />
                <span>{mode === 'change' ? m.label.replace('Update', 'Change') : m.label}</span>
                {m.needsText && (
                  <input
                    className="ze-search"
                    value={opts.match.mode === m.mode ? matchText : ''}
                    onChange={(e) => {
                      setMatchText(e.target.value);
                      set('match', { mode: m.mode });
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                )}
              </label>
            ))}
          </fieldset>

          {mode === 'change' && (
            <label className="row">
              <span>New library identifier:</span>
              <input
                className="ze-search"
                value={newLibId}
                onChange={(e) => setNewLibId(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
          )}

          <fieldset className="ze-props-group">
            <legend>{mode === 'change' ? 'Update Fields' : 'Update/reset Fields'}</legend>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {fieldNames.map((name) => (
                <label className="row" key={name}>
                  <input
                    type="checkbox"
                    checked={opts.updateFields.has(name)}
                    onChange={() => toggleField(name)}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button
                className="ze-btn"
                onClick={() => set('updateFields', new Set(fieldNames))}
                type="button"
              >
                Select All
              </button>
              <button
                className="ze-btn"
                onClick={() => set('updateFields', new Set())}
                type="button"
              >
                Deselect All
              </button>
            </div>
            {/* Change mode relabels most of these (the SetLabel block at the
                top of DIALOG_CHANGE_SYMBOLS's ctor): "new symbol" for "library
                symbol", and plain "Update" for "Update/reset". Two have no
                Change-mode override and read the same in both. */}
            {check(`Remove fields if not in ${part}`, 'removeExtraFields')}
            {check(`Reset fields if empty in ${part}`, 'resetEmptyFields')}
            {check(`${upd} field text`, 'resetFieldText')}
            {check(`${upd} field visibilities`, 'resetFieldVisibilities')}
            {check(`${upd} field sizes and styles`, 'resetFieldEffects')}
            {check(`${upd} field positions`, 'resetFieldPositions')}
            {check(
              `${upd} pin name/number visibilities`,
              'resetPinTextVisibility',
              '(not applied yet)',
            )}
            {check('Reset alternate pin functions', 'resetAlternatePin')}
            {check(`${upd} symbol attributes`, 'resetAttributes')}
            {check('Update/reset pin map overrides', 'resetPinMapOverrides')}
            {check('Reset custom power symbols', 'resetCustomPower')}
          </fieldset>

          {messages.length > 0 && (
            <fieldset className="ze-props-group">
              <legend>Messages</legend>
              <div style={{ maxHeight: 160, overflowY: 'auto', fontFamily: 'monospace' }}>
                {messages.map((m, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: report lines have no id
                    key={i}
                    style={{ color: m.severity === 'error' ? 'var(--ze-error, #c33)' : undefined }}
                  >
                    {m.text}
                  </div>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button
            className="ze-btn primary"
            onClick={apply}
            disabled={mode === 'change' && newLibId.trim() === ''}
          >
            {mode === 'change' ? 'Change' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  );
}
