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
 *
 * The grid is a WX_GRID with GRID_TRICKS, rows selected whole; column 0 is
 * autosized with a 72 px floor and column 1 takes the rest (`onUpdateUI`).
 */
import { StaticBox } from '../wx/controls.js';
import { useState, type JSX } from 'react';
import { DialogShim, StdDialogButtons } from '../dialog_shim.js';
import { formatLibraryTableOptions, parseLibraryTableOptions } from '../libraries/library_table.js';
import { HtmlWindow } from '../widgets/html_window.js';
import { StdBitmapButton } from '../widgets/std_bitmap_button.js';
import type { WX_GRID } from '../widgets/wx_grid.js';
import { useModalEscape } from '../dialog_shim.js';
import { wxGridSelectionModes } from '../wx/grid.js';
import { useStringGrid, WxGridView } from '../wx/grid_ui.js';

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
  const [choice, setChoice] = useState<string | null>(null);

  const { grid, tricks, onUpdate } = useStringGrid<Row>({
    labels: ['Option', 'Value'],
    mode: wxGridSelectionModes.wxGridSelectRows,
    rows,
    toCells: (r) => [r.name, r.value],
    fromCells: (c) => ({ name: c[0]!, value: c[1]! }),
    onChange: setRows,
  });

  const choices = [...pluginOptions.keys()].sort();
  const help = choice !== null ? (pluginOptions.get(choice) ?? INITIAL_HELP) : INITIAL_HELP;

  /** `appendRow`. */
  const appendRow = (aGrid: WX_GRID): number => {
    aGrid.AppendRows(1);
    return aGrid.GetNumberRows() - 1;
  };

  /** `appendOption`: into the first row with an empty name, else a new one. */
  const appendOption = (aChoice: string | null = choice): number => {
    let row = -1;

    if (aChoice !== null) {
      for (row = 0; row < grid.GetNumberRows(); ++row) if (!grid.GetCellValue(row, 0)) break;

      if (row === grid.GetNumberRows()) row = appendRow(grid);

      grid.SetCellValue(row, 0, aChoice);
    }

    return row;
  };

  return (
    <DialogShim
      title={`Options for Library '${nickname}'`}
      onClose={() => onResult(null)}
      className="ze-pluginopts"
    >
      <div className="ze-pluginopts-upper">
        <StaticBox label="Plugin Options" className="ze-pluginopts-grid">
          <div className="ze-grid-pane ze-pluginopts-gridpane">
            <WxGridView
              grid={grid}
              tricks={tricks}
              columns={[{ width: 72 }]}
              flexCol={1}
              onUpdate={onUpdate}
              ariaLabel="Plugin options"
            />
          </div>
          <div className="ze-grid-btns">
            <StdBitmapButton
              bitmap="small_plus"
              title="Add row"
              tooltip={null}
              onClick={() => grid.OnAddRow(() => [appendRow(grid), 0])}
            />
            <span className="ze-pluginopts-btngap" />
            <StdBitmapButton
              bitmap="small_trash"
              title="Delete row"
              tooltip={null}
              onClick={() => grid.OnDeleteRows((row) => grid.DeleteRows(row, 1))}
            />
          </div>
        </StaticBox>
        <StaticBox label="Option Choices" className="ze-pluginopts-choices">
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
                  appendOption(c);
                }}
              >
                {c}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="ze-btn ze-pluginopts-append"
            onClick={() => grid.OnAddRow(() => [appendOption(), -1])}
          >
            {'<<    Append Selected Option'}
          </button>
          <span className="ze-pluginopts-spacer" />
          <HtmlWindow className="ze-pluginopts-html" html={help} />
        </StaticBox>
      </div>
      <StdDialogButtons
        onCancel={() => onResult(null)}
        onOk={() => {
          if (!grid.CommitPendingChanges()) return;
          onResult(
            pluginOptionsResult(
              Array.from({ length: grid.GetNumberRows() }, (_, r) => ({
                name: grid.GetCellValue(r, 0),
                value: grid.GetCellValue(r, 1),
              })),
            ),
          );
        }}
      />
    </DialogShim>
  );
}
