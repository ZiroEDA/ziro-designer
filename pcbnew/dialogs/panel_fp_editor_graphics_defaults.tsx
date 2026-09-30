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
 * also embeds, which is why it is `panel_setup_dimensions.tsx` here
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
 * The grid is upstream's: a WX_GRID over its string table with GRID_TRICKS,
 * `SetUnitsProvider` + `SetAutoEvalCols` on the four size columns (so a cell
 * holds "0.1 mm" and is re-formatted when its editor closes), Italic a
 * read-only `wxGridCellBoolRenderer` cell that GRID_TRICKS toggles.
 *
 * **What reads it.** `FOOTPRINT_EDIT_FRAME`'s drawing tools take a new shape's
 * stroke and a new text's size from `m_DesignSettings`' layer class — the same
 * lookup `BOARD_DESIGN_SETTINGS::GetLineThickness( layer )` does — so this page
 * decides what the next line, circle or text item looks like.
 * `editors/footprint/graphics_defaults.ts` is that lookup.
 */
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanelSetupDimensions, type DimensionDefaults } from './panel_setup_dimensions.js';
import { PCB_IU_PER_MM, pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { stringFromValue } from '@ziroeda/common/widgets/unit_binder.js';
import { toStatusUnits } from '@ziroeda/common/settings/app_settings_units.js';
import {
  wxALIGN_CENTER,
  wxALIGN_LEFT,
  wxEVT_GRID_CELL_CHANGED,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  type wxGridEvent,
  wxGridStringTable,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import {
  GRAPHICS_ROWS,
  checkFpGraphicsRow,
  type FP_GRAPHICS_LINE_CLASS_LIKE as FpGraphicsLineClass,
  type FP_GRAPHICS_TEXT_CLASS_LIKE as FpGraphicsTextClass,
} from '../footprint_editor_settings.js';

/** `COL_*` (`panel_fp_editor_graphics_defaults.cpp:38-45`). */
const COL_LINE_THICKNESS = 0;
const COL_TEXT_WIDTH = 1;
const COL_TEXT_HEIGHT = 2;
const COL_TEXT_THICKNESS = 3;
const COL_TEXT_ITALIC = 4;

/** The base's `SetColLabelValue` calls (`_base.cpp:53-57`). */
const COL_LABELS = ['Line Thickness', 'Text Width', 'Text Height', 'Text Thickness', 'Italic'];

/**
 * `wxSYS_COLOUR_FRAMEBK`, which `disableCell` paints: the same enumerator as
 * `wxSYS_COLOUR_BTNFACE`, the grid's label colour.
 */
const DISABLED_COLOUR = 'var(--grid-label-bg)';

const toIU = (mm: number): number => Math.round(mm * PCB_IU_PER_MM);

/** The `FOOTPRINT_EDITOR_SETTINGS` members this page reads and writes. */
export interface PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_SLICE {
  system: { units: Parameters<typeof toStatusUnits>[0] };
  design_settings: {
    silk: FpGraphicsTextClass;
    copper: FpGraphicsTextClass;
    edges: FpGraphicsLineClass;
    courtyard: FpGraphicsLineClass;
    fab: FpGraphicsTextClass;
    others: FpGraphicsTextClass;
    dimensions: DimensionDefaults;
  };
}

export interface PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_CTX {
  fpEdit: PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_SLICE;
  upFp: (fn: (s: PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_SLICE) => void) => void;
}

export function PanelFpGraphicsDefaults({
  ctx,
}: {
  ctx: PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_CTX;
}): JSX.Element {
  const { fpEdit, upFp } = ctx;
  const upFpRef = useRef(upFp);
  upFpRef.current = upFp;
  const ds = fpEdit.design_settings;
  // `m_graphicsGrid->SetUnitsProvider( aUnitsProvider )` (`:73`) — the frame,
  // whose units the KIFACE sets from `frame->GetUserUnits()` before
  // constructing the panel (`pcbnew.cpp:369-372`).
  const units = toStatusUnits(fpEdit.system.units);
  const unitsRef = useRef(units);
  unitsRef.current = units;

  /**
   * `errorsMsg`. Upstream accumulates it across every row and shows it in one
   * `KIDIALOG` from `TransferDataFromWindow`; a `PAGED_DIALOG` page here has no
   * hook at OK time, so the check runs when a cell is COMMITTED and the
   * message lands beside the grid, as `PANEL_FP_USER_LAYER_NAMES`' does.
   */
  const [error, setError] = useState<string | null>(null);

  const [{ grid, tricks, provider }] = useState(() => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(GRAPHICS_ROWS.length, COL_LABELS.length), true);
    COL_LABELS.forEach((label, c) => {
      g.SetColLabelValue(c, label);
    });
    GRAPHICS_ROWS.forEach((r, i) => {
      g.SetRowLabelValue(i, r.label);
    });
    g.SetRowLabelAlignment(wxALIGN_LEFT);
    const p = new UNITS_PROVIDER(pcbIUScale, units);
    g.SetUnitsProvider(p);
    g.SetAutoEvalCols([COL_LINE_THICKNESS, COL_TEXT_WIDTH, COL_TEXT_HEIGHT, COL_TEXT_THICKNESS]);
    return { grid: g, tricks: new GRID_TRICKS(g), provider: p };
  });

  const written = useRef<string | null>(null);
  const key = JSON.stringify([units, GRAPHICS_ROWS.map((r) => ds[r.key])]);

  // `loadFPSettings` (`:95-150`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the rows' content and the units; the grid is stable
  useLayoutEffect(() => {
    if (key === written.current) return;

    provider.SetUserUnits(units);
    grid.BeginBatch();

    GRAPHICS_ROWS.forEach((r, i) => {
      const cls = ds[r.key] as FpGraphicsTextClass;
      grid.SetUnitValue(i, COL_LINE_THICKNESS, toIU(cls.line_width));

      if (!r.text) {
        // `disableCell`: read-only and painted wxSYS_COLOUR_FRAMEBK.
        for (const col of [COL_TEXT_WIDTH, COL_TEXT_HEIGHT, COL_TEXT_THICKNESS, COL_TEXT_ITALIC]) {
          grid.SetReadOnly(i, col);
          grid.SetCellBackgroundColour(i, col, DISABLED_COLOUR);
        }
      } else {
        grid.SetUnitValue(i, COL_TEXT_WIDTH, toIU(cls.text_size_h));
        grid.SetUnitValue(i, COL_TEXT_HEIGHT, toIU(cls.text_size_v));
        grid.SetUnitValue(i, COL_TEXT_THICKNESS, toIU(cls.text_thickness));
        grid.SetCellValue(i, COL_TEXT_ITALIC, cls.text_italic ? '1' : '');

        const attr = new wxGridCellAttr();
        attr.SetRenderer(new wxGridCellBoolRenderer());
        attr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
        attr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);
        grid.SetAttr(i, COL_TEXT_ITALIC, attr);
      }
    });

    grid.EndBatch();
    written.current = key;
  }, [key]);

  // `TransferDataFromWindow` (`:176-266`) for the row a committed cell is in.
  useEffect(() => {
    const onChanged = (e: wxGridEvent): void => {
      e.Skip();

      const i = e.GetRow();
      const meta = GRAPHICS_ROWS[i];

      if (!meta) return;

      const mm = (col: number): number => grid.GetUnitValue(i, col) / PCB_IU_PER_MM;
      const row: FpGraphicsTextClass = {
        line_width: mm(COL_LINE_THICKNESS),
        text_size_h: meta.text ? mm(COL_TEXT_WIDTH) : 0,
        text_size_v: meta.text ? mm(COL_TEXT_HEIGHT) : 0,
        text_thickness: meta.text ? mm(COL_TEXT_THICKNESS) : 0,
        // `wxGridCellBoolEditor::IsTrueValue( msg )`.
        text_italic: grid.GetCellValue(i, COL_TEXT_ITALIC) === '1',
      };
      const describe = (v: number): string =>
        stringFromValue(v, unitsRef.current, true, pcbIUScale);
      const checked = checkFpGraphicsRow(meta.label, row, meta.text, describe);

      // A thickness out of range is truncated in the cell, as `SetUnitValue` does.
      if (
        checked.store.text_thickness !== undefined &&
        checked.store.text_thickness !== row.text_thickness
      )
        grid.SetUnitValue(i, COL_TEXT_THICKNESS, toIU(checked.store.text_thickness));

      setError(checked.error);
      upFpRef.current((s) => {
        Object.assign(s.design_settings[meta.key], checked.store);
      });
    };
    grid.Connect(wxEVT_GRID_CELL_CHANGED, onChanged);
    return () => grid.Disconnect(wxEVT_GRID_CELL_CHANGED, onChanged);
  }, [grid]);

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
      <WxGridView
        grid={grid}
        tricks={tricks}
        rowLabels
        className="ze-fp-gfxgrid"
        ariaLabel="Default properties for new graphic items"
      />
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
