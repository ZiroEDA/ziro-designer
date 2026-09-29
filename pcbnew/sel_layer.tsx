// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_ONE_LAYER_SELECTOR` (`pcbnew/sel_layer.cpp`, its base
 * `DIALOG_LAYER_SELECTION_BASE` in `pcbnew/dialogs/dialog_layer_selection_base.cpp`)
 * and `PCB_BASE_FRAME::SelectOneLayer`, the entry point every caller uses.
 *
 * The sizer tree (`dialog_layer_selection_base.cpp:14-92`): one horizontal
 * `bSizerMain` holding one horizontal `bSizerUpper`, which holds the two
 * grids side by side, each `wxEXPAND|wxALL, 5`. Each grid: no row or column
 * labels (`SetColLabelSize( 0 )`, `SetRowLabelSize( 0 )`), no grid lines
 * (`EnableGridLines( false )`), not editable (`EnableEditing( false )`),
 * three columns sized `24 / 20 / 72`.
 *
 * The subclass repurposes those three base columns and appends a fourth
 * (`sel_layer.cpp:52-55,166`):
 *
 *     #define SELECT_COLNUM     0   // the base's col 0 (24px) - a checkbox,
 *                                    // always hidden by SelectOneLayer's
 *                                    // aHideCheckBoxes=true (sel_layer.cpp:345)
 *     #define COLOR_COLNUM      1   // the base's col 1 (20px) - the swatch
 *     #define LAYERNAME_COLNUM  2   // the base's col 2 (72px) - the name
 *     #define LAYER_HK_COLUMN   3   // appended, auto-sized - the hotkey,
 *                                    // left grid only
 *
 * `SelectOneLayer`'s only two real callers in 10.0.5
 * (`grep -rn "SelectOneLayer(" pcbnew include`) are
 * `ROUTER_TOOL::onViaCommand`'s interactive "select layer, then place a via"
 * flow (`router/router_tool.cpp:1210`) and `CONVERT_TOOL::CreateTracks`'s
 * target-layer prompt (`tools/convert_tool.cpp:1182`) - neither the
 * interactive router's via-layer prompt nor an interactive Convert tool is
 * built in this port yet (both are pure/logic-only here:
 * `pcbnew/convert_lines.ts`, `pcbnew/convert_shapes.ts`, and the router has
 * no via-placement UI), so this file has no call site to wire yet. It is
 * built and tested standalone; wiring follows whichever of those two lands
 * first.
 *
 * Not ported: `OnMouseMove`'s `wxEVT_UPDATE_UI` hover tracking, a wx
 * workaround for `wxGrid` not delivering plain mouse-move events
 * (`sel_layer.cpp:186-224`, comment there). Its only effect is letting a
 * layer hotkey act on whatever row the mouse last sat over without a click;
 * a real click always fires `OnLeftGridCellClick`/`OnRightGridCellClick`
 * regardless, so hover never changes what a click selects.
 */
import { type JSX, useEffect, useMemo, useState } from 'react';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { hotkeyListKey } from '@ziroeda/common/tool/action_menu_key_names.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { LSET } from '@ziroeda/common/lset.js';
import { LSET_Name } from '@ziroeda/common/layer_ids.js';
import { IsCopperLayer, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { parseColor4d, swatchOverBackground, toCssColor } from '@ziroeda/common/gal/color4d.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import { wxEVT_GRID_CELL_LEFT_CLICK, type wxGridEvent } from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { BOARD } from './board.js';
import { PCB_LAYER_HOTKEYS, layerForHotkey } from './pcb_layer_box_selector.js';
import type { PcbColorTheme } from './pcbTheme.js';

/** One row of either grid: `buildList()`'s per-layer locals, kept as data. */
export interface LayerSelectorRow {
  layer: PCB_LAYER_ID;
  /** `wxT( " " ) + getLayerName( layerid )` - the leading space is upstream's. */
  name: string;
  swatch: string;
  /** `getLayerHotKey`'s " (PgUp)"/" (PgDn)", or "" - copper rows only. */
  hotkey: string;
}

/**
 * `PCB_LAYER_PRESENTATION::getLayerColor` + `DrawColorSwatch`
 * (`sel_layer.cpp:62-75`, `layer_presentation.cpp:36-62`): the layer's colour
 * alpha-blended over the background, both from the frame's LIVE colour
 * theme (`GetColorSettings()->GetColor()`), not the static default table
 * `pcb_layer_presentation.ts`'s `layerChoice()` reads - a user's Colors page
 * override, and a non-default theme, must show up in this swatch exactly as
 * they show up on the canvas.
 */
function layerSwatch(layerId: PCB_LAYER_ID, theme: PcbColorTheme): string {
  const bg = parseColor4d(theme.background);
  const fg = parseColor4d(theme.layerColors[LSET_Name(layerId)] ?? theme.background);
  return toCssColor(swatchOverBackground(fg, bg));
}

/** `getLayerHotKey( aLayer )` (`sel_layer.cpp:120-124`): `AddHotkeyName( "", code, IS_COMMENT )`. */
function hotkeySuffix(layerId: PCB_LAYER_ID): string {
  const accel = PCB_LAYER_HOTKEYS[LSET_Name(layerId)];
  return accel ? ` (${hotkeyListKey(accel)})` : '';
}

/**
 * `PCB_ONE_LAYER_SELECTOR::buildList()` (`sel_layer.cpp:256-315`): every
 * board-enabled layer in UI order, skipping `aNotAllowedLayersMask`, split by
 * `IsCopperLayer` into the left (copper) and right (non-copper) lists.
 */
export function buildOneLayerSelectorLists(
  board: BOARD,
  notAllowedLayersMask: LSET,
  theme: PcbColorTheme,
): { left: LayerSelectorRow[]; right: LayerSelectorRow[] } {
  const left: LayerSelectorRow[] = [];
  const right: LayerSelectorRow[] = [];

  for (const layerId of board.GetEnabledLayers().UIOrder()) {
    if (notAllowedLayersMask.Contains(layerId)) continue;

    const row: LayerSelectorRow = {
      layer: layerId,
      name: ` ${board.GetLayerName(layerId)}`,
      swatch: layerSwatch(layerId, theme),
      hotkey: IsCopperLayer(layerId) ? hotkeySuffix(layerId) : '',
    };

    if (IsCopperLayer(layerId)) left.push(row);
    else right.push(row);
  }

  return { left, right };
}

/**
 * `layerForHotKey` (`sel_layer.cpp:126-141`): the row among the currently
 * shown LEFT (copper) rows whose switch-layer hotkey matches, or null. Only
 * copper layers carry a hotkey (`PCB_LAYER_HOTKEYS`), and only a row this
 * dialog actually shows can be picked this way - a masked-out F.Cu must not
 * still answer to Page Up.
 */
function layerForRowHotkey(key: string, left: readonly LayerSelectorRow[]): PCB_LAYER_ID | null {
  const name = layerForHotkey(key);
  if (name === null) return null;

  const row = left.find((r) => LSET_Name(r.layer) === name);
  return row ? row.layer : null;
}

/** A `WX_GRID_TABLE_BASE` over a fixed `LayerSelectorRow[]` - never edited in place. */
class ONE_LAYER_SELECTOR_TABLE extends WX_GRID_TABLE_BASE {
  constructor(
    private m_rows: readonly LayerSelectorRow[],
    private readonly m_withHotkey: boolean,
  ) {
    super();
  }

  SetRows(rows: readonly LayerSelectorRow[]): void {
    this.m_rows = rows;
  }

  GetNumberRows(): number {
    return this.m_rows.length;
  }
  GetNumberCols(): number {
    return this.m_withHotkey ? 3 : 2;
  }
  GetValue(aRow: number, aCol: number): string {
    const row = this.m_rows[aRow];
    if (!row) return '';
    if (aCol === 1) return row.name;
    if (aCol === 2) return row.hotkey;
    return row.swatch;
  }
  // Read-only (`EnableEditing( false )`, `sel_layer.cpp` never edits a cell).
  SetValue(): void {}
}

/** `SetColSize` for the two visible columns; the hotkey column is unsized, i.e. `AutoSizeColumns()`. */
const SWATCH_COL_WIDTH = 20;
const NAME_COL_WIDTH = 72;

function useOneLayerSelectorGrid(
  rows: readonly LayerSelectorRow[],
  withHotkey: boolean,
): { grid: WX_GRID; tricks: GRID_TRICKS; table: ONE_LAYER_SELECTOR_TABLE } {
  const [state] = useState(() => {
    const table = new ONE_LAYER_SELECTOR_TABLE(rows, withHotkey);
    const grid = new WX_GRID();
    grid.SetTable(table, true);
    grid.EnableEditing(false);
    return { grid, table, tricks: new GRID_TRICKS(grid) };
  });

  state.table.SetRows(rows);

  return state;
}

/**
 * `OnLeftGridCellClick`/`OnRightGridCellClick` (`sel_layer.cpp:317-333`):
 * `m_layerSelected = m_layersId…Column[event.GetRow()]`, then `EndDialog( 1 )`
 * on the spot - there is no separate OK, and no dependency on which column
 * was clicked.
 */
function useLayerSelectorClick(
  grid: WX_GRID,
  rows: readonly LayerSelectorRow[],
  onSelect: (layer: PCB_LAYER_ID) => void,
): void {
  useEffect(() => {
    const handler = (e: wxGridEvent): void => {
      const row = rows[e.GetRow()];
      if (row) onSelect(row.layer);
    };
    grid.Connect(wxEVT_GRID_CELL_LEFT_CLICK, handler);
    return () => grid.Disconnect(wxEVT_GRID_CELL_LEFT_CLICK, handler);
  }, [grid, rows, onSelect]);
}

export interface PcbOneLayerSelectorProps {
  board: BOARD;
  theme: PcbColorTheme;
  /** `aNotAllowedLayersMask` - the layers left out of both lists entirely. */
  notAllowedLayersMask: LSET;
  /** `SelectOneLayer` always passes `true`; kept so a future caller with
   * checkboxes visible is not a second component. Unused while `true`. */
  onSelect: (layer: PCB_LAYER_ID) => void;
  onCancel: () => void;
}

/**
 * `PCB_ONE_LAYER_SELECTOR` (`sel_layer.cpp:102-333`). A click on either grid
 * fires `OnLeftGridCellClick`/`OnRightGridCellClick`, which is `wxID_OK` on
 * the spot - the base has no button sizer at all, matching
 * `dialog_layer_selection_base.cpp`'s single `bSizerUpper`.
 */
export function PcbOneLayerSelector({
  board,
  theme,
  notAllowedLayersMask,
  onSelect,
  onCancel,
}: PcbOneLayerSelectorProps): JSX.Element {
  useModalEscape(onCancel);

  const { left, right } = useMemo(
    () => buildOneLayerSelectorLists(board, notAllowedLayersMask, theme),
    [board, notAllowedLayersMask, theme],
  );

  const leftGrid = useOneLayerSelectorGrid(left, true);
  const rightGrid = useOneLayerSelectorGrid(right, false);
  useLayerSelectorClick(leftGrid.grid, left, onSelect);
  useLayerSelectorClick(rightGrid.grid, right, onSelect);

  const renderRow = (rows: readonly LayerSelectorRow[]) => (row: number, col: number) => {
    if (col !== 0) return null;
    const r = rows[row];
    return r ? <span className="ze-combo-swatch" style={{ background: r.swatch }} /> : null;
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={() => onCancel()}>
      <div
        className="ze-modal ze-one-layer-selector"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // `onCharHook` (`sel_layer.cpp:236-253`): a bound layer hotkey
          // selects and closes, same as a click; everything else falls
          // through to the grid (Escape is `useModalEscape`, above).
          const layer = layerForRowHotkey(e.key, left);
          if (layer !== null) {
            e.preventDefault();
            onSelect(layer);
          }
        }}
      >
        <div className="ze-modal-header">
          Select Layer
          <span className="x" title="Cancel" onClick={() => onCancel()}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-one-layer-selector-body">
          {left.length > 0 && (
            <div className="ze-grid-pane">
              <WxGridView
                grid={leftGrid.grid}
                tricks={leftGrid.tricks}
                colLabels={false}
                className="ze-grid-no-lines"
                ariaLabel="Copper layers"
                columns={[{ width: SWATCH_COL_WIDTH }, { width: NAME_COL_WIDTH }, {}]}
                renderCell={renderRow(left)}
                onUpdate={() => {}}
              />
            </div>
          )}
          {right.length > 0 && (
            <div className="ze-grid-pane">
              <WxGridView
                grid={rightGrid.grid}
                tricks={rightGrid.tricks}
                colLabels={false}
                className="ze-grid-no-lines"
                ariaLabel="Non-copper layers"
                columns={[{ width: SWATCH_COL_WIDTH }, { width: NAME_COL_WIDTH }]}
                renderCell={renderRow(right)}
                onUpdate={() => {}}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// `PCB_BASE_FRAME::SelectOneLayer` (`sel_layer.cpp:341-357`) reached the
// layer through a blocking `ShowModal()`; our dialogs are modeless React, so
// a caller owns the open/close state itself (the same shape every other
// pcb_edit_frame_ui.tsx dialog already uses) and reads the row click through
// `onSelect`/`onCancel` on `PcbOneLayerSelector` above instead of a return
// value. `aDefaultLayer` has no effect here beyond what a caller already
// tracks as "current" - the base dialog never pre-selects or scrolls to it
// (no `SetGridCursor` in `buildList()`), it only feeds
// `SetCellValue( …, SELECT_COLNUM, "1" )` on the hidden checkbox column - so
// it is not a prop of this component.
