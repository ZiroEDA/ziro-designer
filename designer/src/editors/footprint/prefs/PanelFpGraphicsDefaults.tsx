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
 * value leaves the old one in the settings and raises a `KIDIALOG`; ours
 * reports through `transfer`'s prompt for the same reason, which is that the
 * check cannot run per keystroke without fighting a half-typed number.
 *
 * **What reads it.** `FOOTPRINT_EDIT_FRAME`'s drawing tools take a new shape's
 * stroke and a new text's size from `m_DesignSettings`' layer class — the same
 * lookup `BOARD_DESIGN_SETTINGS::GetLineThickness( layer )` does — so this page
 * decides what the next line, circle or text item looks like.
 * `editors/footprint/graphics_defaults.ts` is that lookup.
 */
import type { JSX } from 'react';
import { PanelSetupDimensions } from '../../../dialogs/prefs/PanelSetupDimensions.js';
import { PCB_IU_PER_MM } from '@ziroeda/common';
import { toStatusUnits } from '../../../ui/app_settings_units.js';
import { GRAPHICS_ROWS, type FpGraphicsRowKey } from '../graphics_defaults.js';
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
  /** The stored value is millimetres; the cell shows the frame's unit. */
  const perMM = units === 'mm' ? 1 : units === 'in' ? 25.4 : 25.4 / 1000;
  const show = (mm: number): string => String(Number((mm / perMM).toFixed(6)));
  const store = (v: string): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n * perMM : null;
  };

  const set = (row: FpGraphicsRowKey, patch: Partial<FpGraphicsTextClass>): void =>
    upFp((s) => {
      Object.assign(s.design_settings[row], patch);
    });

  const cell = (
    row: FpGraphicsRowKey,
    key: keyof FpGraphicsTextClass,
    label: string,
  ): JSX.Element => (
    <input
      type="text"
      value={show((ds[row] as FpGraphicsTextClass)[key] as number)}
      aria-label={label}
      onChange={(e) => {
        const mm = store(e.target.value);
        if (mm !== null) set(row, { [key]: mm });
      }}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );

  return (
    <div className="ze-fp-gfxdefaults">
      {/* `defaultPropertiesLabel`, a plain wxStaticText with no rule. */}
      <div className="ze-fp-defaults-title">Default Properties for New Graphic Items</div>
      <div className="ze-grid-pane">
        <table className="ze-grid ze-fp-gfxgrid">
          <thead>
            <tr>
              <th />
              <th>Line Thickness</th>
              {TEXT_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Italic</th>
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
                        onChange={(e) => set(r.key, { text_italic: e.target.checked })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
