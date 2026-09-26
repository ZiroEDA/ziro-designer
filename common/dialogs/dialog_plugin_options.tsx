// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PLUGIN_OPTIONS` (common/dialogs/dialog_plugin_options.cpp) with its
 * `_base` folded in: what a library table's Options cell opens
 * (`optionsEditor`, panel_sym_lib_table.cpp:168-192) - "Options for Library
 * '<nickname>'", a two-column grid of the row's options, and on the right the
 * plugin's own Option Choices with their help.
 *
 * The sizer tree (dialog_plugin_options_base.cpp): "Plugin Options" box
 * (minimum 400 x 300, proportion 3) holding the WX_GRID (Option 120 /
 * Value 240) and the add / delete bitmap buttons with a 20 px spacer between;
 * "Option Choices" box holding the list, "<<    Append Selected Option", a
 * spacer and an HTML_WINDOW (280 x 100 minimum); then OK / Cancel.
 *
 * A KiCad-format library's plugin offers no choices
 * (`IO_BASE::GetLibraryOptions` appends none), so for those the right-hand
 * list is empty and only the grid matters - which is still upstream's dialog.
 */
import { useState, type JSX } from 'react';
import { StdDialogButtons } from '../dialog_shim.js';
import { formatLibraryTableOptions, parseLibraryTableOptions } from '../libraries/library_table.js';
import { HtmlWindow } from '../widgets/html_window.js';
import { Icon } from '../widgets/icons.js';
import { useModalEscape } from '../dialog_shim.js';

/** INITIAL_HELP (dialog_plugin_options.cpp:35-37). */
export const INITIAL_HELP =
  'Select an <b>Option Choice</b> in the listbox above, and then click the <b>Append Selected Option</b> button.';

type Row = { name: string; value: string };

/**
 * `TransferDataToWindow`: the options parsed into grid rows.
 *
 * Upstream's loop never advances `row` (dialog_plugin_options.cpp:101-107):
 * every option is written into row 0, so only the last survives and the other
 * appended rows stay blank. That is KiCad 10.0.5's behaviour, and the parity
 * target is the installed build, so it is kept - see the report of 09-26.
 */
export function pluginOptionsRows(aFormattedOptions: string): Row[] {
  const props = parseLibraryTableOptions(aFormattedOptions);
  const rows: Row[] = [{ name: '', value: '' }];
  if (props.size > 0) {
    while (rows.length < props.size) rows.push({ name: '', value: '' });
    const row = 0;
    for (const [key, value] of [...props.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      rows[row] = { name: key, value };
    }
  }
  return rows;
}

/** `TransferDataFromWindow`: every row with a name, trimmed, formatted. */
export function pluginOptionsResult(aRows: readonly Row[]): string {
  const props = new Map<string, string>();
  for (const r of aRows) {
    const name = r.name.trim();
    if (name.length) props.set(name, r.value.trim());
  }
  return formatLibraryTableOptions(props);
}

export function DIALOG_PLUGIN_OPTIONS({
  nickname,
  pluginOptions,
  formattedOptions,
  onResult,
}: {
  /** `aNickname`, for the title. */
  nickname: string;
  /** `aPluginOptions`: the plugin's choices, name -> help HTML. */
  pluginOptions: ReadonlyMap<string, string>;
  /** `aFormattedOptions`: the row's options string. */
  formattedOptions: string;
  /** `*aResult` on OK; `null` on Cancel. */
  onResult: (result: string | null) => void;
}): JSX.Element {
  const [rows, setRows] = useState<Row[]>(() => pluginOptionsRows(formattedOptions));
  const [sel, setSel] = useState<number | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  useModalEscape(() => onResult(null));

  const choices = [...pluginOptions.keys()].sort();
  const help = choice !== null ? (pluginOptions.get(choice) ?? INITIAL_HELP) : INITIAL_HELP;
  const setAt = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** `appendOption`: into the first row with an empty name, else a new one. */
  const appendOption = (): void => {
    if (choice === null) return;
    setRows((rs) => {
      const at = rs.findIndex((r) => r.name === '');
      if (at >= 0) return rs.map((r, j) => (j === at ? { ...r, name: choice } : r));
      return [...rs, { name: choice, value: '' }];
    });
  };

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-pluginopts" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{`Options for Library '${nickname}'`}</div>
        <div className="ze-pluginopts-upper">
          <fieldset className="ze-sbox ze-pluginopts-grid">
            <legend>Plugin Options</legend>
            <div className="ze-grid-pane ze-pluginopts-gridpane">
              <table className="ze-grid">
                <colgroup>
                  <col className="ze-pluginopts-col0" />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Option</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      // Rows are positional, as a wxGrid's are.
                      // biome-ignore lint/suspicious/noArrayIndexKey: grid row order is the identity
                      key={i}
                      className={i === sel ? 'selected' : undefined}
                      onMouseDown={() => setSel(i)}
                    >
                      <td>
                        <input
                          type="text"
                          aria-label={`Option ${i + 1}`}
                          value={r.name}
                          onChange={(e) => setAt(i, { name: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          aria-label={`Value ${i + 1}`}
                          value={r.value}
                          onChange={(e) => setAt(i, { value: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ze-grid-btns">
              <button
                type="button"
                className="ze-gridbtn"
                aria-label="Add row"
                onClick={() => {
                  setRows((rs) => [...rs, { name: '', value: '' }]);
                  setSel(rows.length);
                }}
              >
                <Icon name="plus" />
              </button>
              <span className="ze-pluginopts-btngap" />
              <button
                type="button"
                className="ze-gridbtn"
                aria-label="Delete row"
                disabled={sel === null}
                onClick={() => {
                  if (sel === null) return;
                  setRows((rs) => rs.filter((_, j) => j !== sel));
                  setSel(null);
                }}
              >
                <Icon name="delete" />
              </button>
            </div>
          </fieldset>
          <fieldset className="ze-sbox ze-pluginopts-choices">
            <legend>Option Choices</legend>
            <div
              className="ze-checklistbox ze-pluginopts-list"
              role="listbox"
              aria-label="Option Choices"
              title="Options supported by current plugin"
            >
              {choices.map((c) => (
                <div
                  key={c}
                  role="option"
                  aria-selected={c === choice}
                  className={`ze-pluginopts-choice${c === choice ? ' selected' : ''}`}
                  onClick={() => setChoice(c)}
                  onDoubleClick={() => {
                    setChoice(c);
                    appendOption();
                  }}
                >
                  {c}
                </div>
              ))}
            </div>
            <button type="button" className="ze-btn ze-pluginopts-append" onClick={appendOption}>
              {'<<    Append Selected Option'}
            </button>
            <span className="ze-pluginopts-spacer" />
            <HtmlWindow className="ze-pluginopts-html" html={help} />
          </fieldset>
        </div>
        <StdDialogButtons
          onCancel={() => onResult(null)}
          onOk={() => onResult(pluginOptionsResult(rows))}
        />
      </div>
    </div>
  );
}
