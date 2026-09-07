// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Graphics Defaults —
 * `PANEL_FP_EDITOR_GRAPHICS_DEFAULTS`
 * (`pcbnew/dialogs/panel_fp_editor_graphics_defaults.cpp` and its `_base.cpp`),
 * constructed by pcbnew's KIFACE for `PANEL_FP_DEFAULT_GRAPHICS_VALUES`
 * (`pcbnew/pcbnew.cpp:361-375`).
 *
 * Two things stacked: a 6 x 5 grid, and a whole `PANEL_SETUP_DIMENSIONS` added
 * to this panel's own sizer (`:86`). The second is the shared class Board Setup
 * also embeds, which is why it is `dialogs/prefs/PanelSetupDimensions.tsx` here
 * rather than a second copy.
 *
 * The grid (`panel_fp_editor_graphics_defaults_base.cpp:26-57`):
 *
 *     rows    Silk Layers, Copper Layers, Edge Cuts, Courtyards,
 *             Fab Layers, Other Layers
 *     columns Line Thickness, Text Width, Text Height, Text Thickness, Italic
 *
 * **Five columns, not Board Setup's six.** `PANEL_SETUP_TEXT_AND_GRAPHICS`
 * adds a "Keep Upright" column (`panel_setup_text_and_graphics_base.cpp:39-59`)
 * and this one does not, because `FOOTPRINT_EDITOR_SETTINGS` registers no
 * `*_text_upright` param. The two grids are near-identical and are genuinely
 * different widgets upstream; this is the difference.
 *
 * **Edge Cuts and Courtyards carry a line width and nothing else.** The panel
 * calls `disableCell` on all four of their text columns (`:98-104`) and skips
 * them entirely on the way out (`:189-190`), because no `edge_text_*` or
 * `courtyard_text_*` param exists. `FpGraphicsLineClass` is that absence in the
 * type, so a row without text cannot be given one by accident.
 *
 * **The validation is upstream's and is not decoration.**
 * `TransferDataFromWindow` (`:176-266`) refuses a line width outside
 * [MINIMUM_LINE_WIDTH_MM, MAXIMUM_LINE_WIDTH_MM] and a text size outside
 * [TEXT_MIN_SIZE_MM, TEXT_MAX_SIZE_MM], and it CLAMPS text thickness to a
 * quarter of the smaller text dimension — "Text thickness cannot be > text size
 * /4 to be readable" — rewriting the cell rather than rejecting it. A bad
 * value leaves the old one in the settings and raises a `KIDIALOG`.
 * `checkFpGraphicsRow` is that whole body, and it runs when a CELL IS
 * COMMITTED rather than at OK: the editor closing is where a wxGrid validator
 * fires anyway, and the check cannot run per keystroke without fighting a
 * half-typed number.
 *
 * **What reads it.** `FOOTPRINT_EDIT_FRAME`'s drawing tools take a new shape's
 * stroke and a new text's size from `m_DesignSettings`' layer class — the same
 * lookup `BOARD_DESIGN_SETTINGS::GetLineThickness( layer )` does — so this page
 * decides what the next line, circle or text item looks like.
 * `editors/footprint/graphics_defaults.ts` is that lookup.
 */
import { type JSX, useState } from 'react';
import { PanelSetupDimensions } from '../../../dialogs/prefs/PanelSetupDimensions.js';
import { PCB_IU_PER_MM, pcbIUScale } from '@ziroeda/common';
import { GridUnitCell } from '../../../ui/GridUnitCell.js';
import { stringFromValue } from '../../../ui/unit_binder.js';
import { toStatusUnits } from '../../../ui/app_settings_units.js';
import { GRAPHICS_ROWS, checkFpGraphicsRow, type FpGraphicsRowKey } from '../graphics_defaults.js';
import type { FpGraphicsTextClass } from '../../../prefs/settings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `COL_*` (`panel_fp_editor_graphics_defaults.cpp:38-45`) and the base file's
 * labels. The unit is the frame's, so the header carries no unit of its own —
 * upstream's `WX_GRID::SetUnitsProvider` puts it in the CELL.
 */
const TEXT_COLS: {
  key: keyof Omit<FpGraphicsTextClass, 'line_width' | 'text_italic'>;
  label: string;
}[] = [
  { key: 'text_size_h', label: 'Text Width' },
  { key: 'text_size_v', label: 'Text Height' },
  { key: 'text_thickness', label: 'Text Thickness' },
];

export function PanelFpGraphicsDefaults({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  const ds = fpEdit.design_settings;
  // `m_graphicsGrid->SetUnitsProvider( aUnitsProvider )` (`:73`) — the frame,
  // whose units the KIFACE sets from `frame->GetUserUnits()` before
  // constructing the panel (`pcbnew.cpp:369-372`).
  const units = toStatusUnits(fpEdit.system.units);
  /** `m_unitProvider->StringFromValue( v, true )`, for the error messages. */
  const describe = (mm: number): string => stringFromValue(mm, units, true, pcbIUScale);

  /**
   * `errorsMsg`. Upstream accumulates it across every row and shows it in one
   * `KIDIALOG` from `TransferDataFromWindow`; a `PAGED_DIALOG` page here has no
   * hook at OK time, so the check runs when a cell is COMMITTED — which is when
   * a wxGrid validator fires anyway, the editor closing rather than a keystroke
   * — and the message lands beside the grid, as `PANEL_FP_USER_LAYER_NAMES`'
   * does.
   */
  const [error, setError] = useState<string | null>(null);

  /**
   * `TransferDataFromWindow` for one row: run the checks over the row as the
   * commit would leave it, then store only what upstream would have stored.
   *
   * Returns false when the typed value was refused, which keeps it in the cell
   * for the user to correct — upstream leaves the bad text in the grid too, and
   * simply does not assign it.
   */
  const commit = (row: FpGraphicsRowKey, patch: Partial<FpGraphicsTextClass>): boolean => {
    const meta = GRAPHICS_ROWS.find((r) => r.key === row);
    if (!meta) return false;

    const next = { ...(ds[row] as FpGraphicsTextClass), ...patch };
    const checked = checkFpGraphicsRow(meta.label, next, meta.text, describe);

    setError(checked.error);
    upFp((s) => {
      Object.assign(s.design_settings[row], checked.store);
    });

    // Every key the commit touched has to have survived the check; a clamped
    // text thickness counts as accepted, because the cell is meant to be
    // rewritten with the truncated value.
    return Object.keys(patch).every((k) => k in checked.store);
  };

  const cell = (
    row: FpGraphicsRowKey,
    key: keyof Omit<FpGraphicsTextClass, 'text_italic'>,
    label: string,
  ): JSX.Element => (
    <GridUnitCell
      value={(ds[row] as FpGraphicsTextClass)[key]}
      units={units}
      iuScale={pcbIUScale}
      ariaLabel={label}
      onCommit={(mm) => commit(row, { [key]: mm })}
    />
  );

  return (
    <div className="ze-fp-gfxdefaults">
      {/* `defaultPropertiesLabel` followed by `m_staticline1`
          (`panel_fp_editor_graphics_defaults_base.cpp:25-31`) — this heading
          DOES carry a rule, unlike Footprint Defaults' and User Layer Names',
          so it is a `.ze-pref-group-title` and not a `.ze-fp-defaults-title`. */}
      <div className="ze-pref-group-title ze-fp-gfx-title">
        Default Properties for New Graphic Items
      </div>
      {/* No `.ze-grid-pane`: the grid is added straight to the sizer, and a
          wxGrid's own gridlines are its only border. */}
      <table className="ze-grid ze-fp-gfxgrid">
        <thead>
          <tr>
            {/* The corner above the row labels. It is not column 0 — the row
                gutter is, so `WX_GRID::DrawColLabel`'s left-align override
                belongs to the header after it. */}
            <th className="ze-grid-corner" />
            <th>Line Thickness</th>
            {TEXT_COLS.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th>Italic</th>
            {/* The grid window is wider than its columns; this is the strip
                past the last one, and it is what stops the browser sharing the
                slack out among the real columns. */}
            <th className="ze-grid-filler" />
          </tr>
        </thead>
        <tbody>
          {GRAPHICS_ROWS.map((r) => {
            const cls = ds[r.key];
            const hasText = r.text;
            return (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{cell(r.key, 'line_width', `${r.label} line thickness`)}</td>
                {TEXT_COLS.map((c) => (
                  // `disableCell( i, COL_* )` — read-only AND painted in
                  // `wxSYS_COLOUR_FRAMEBK`, so the four cells read as one
                  // blank block rather than as empty editable cells.
                  <td key={c.key} className={hasText ? undefined : 'ze-grid-disabled'}>
                    {hasText ? cell(r.key, c.key, `${r.label} ${c.label.toLowerCase()}`) : null}
                  </td>
                ))}
                <td className={hasText ? 'ze-grid-bool' : 'ze-grid-bool ze-grid-disabled'}>
                  {hasText && (
                    <input
                      type="checkbox"
                      checked={(cls as FpGraphicsTextClass).text_italic}
                      aria-label={`${r.label} italic`}
                      onChange={(e) => commit(r.key, { text_italic: e.target.checked })}
                    />
                  )}
                </td>
                <td className="ze-grid-filler" />
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* `PAGED_DIALOG::SetError` puts its message in the dialog's own error
          bar; ours is beside the grid it belongs to. */}
      {error && <div className="ze-prefs-error">{error}</div>}

      {/* `GetSizer()->Add( m_dimensionsPanel.get(), 0, wxEXPAND, 5 )` (`:86`) —
          the shared class, not a copy of its controls. */}
      <PanelSetupDimensions
        value={ds.dimensions}
        update={(fn) => upFp((s) => fn(s.design_settings.dimensions))}
        units={units}
        iuPerMM={PCB_IU_PER_MM}
      />
    </div>
  );
}
