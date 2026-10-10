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
import { Button } from '@ziroeda/common/wx/controls.js';
import { type CSSProperties, type JSX, useEffect, useMemo, useState } from 'react';
import { DialogShim, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { hotkeyListKey } from '@ziroeda/common/tool/action_menu_key_names.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { LSET } from '@ziroeda/common/lset.js';
import { LSET_Name } from '@ziroeda/common/layer_ids.js';
import { IsCopperLayer, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { parseColor4d, swatchOverBackground, toCssColor } from '@ziroeda/common/gal/color4d.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_LEFT_CLICK,
  type wxGridEvent,
  wxGridTableRequest,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import { DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { LAYER_PAIR, LAYER_PAIR_INFO } from '@ziroeda/common/project/board_project_settings.js';
import type { BOARD } from './board.js';
import { PCB_LAYER_HOTKEYS, layerForHotkey } from './pcb_layer_box_selector.js';
import type { PcbColorTheme } from './pcbTheme.js';
import { LAYER_PAIR_SETTINGS } from './layer_pairs.js';

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

// ---------------------------------------------------------------------------
// `SELECT_COPPER_LAYERS_PAIR_DIALOG` (`sel_layer.cpp:646-789`), its
// `COPPER_LAYERS_PAIR_SELECTION_UI` (the two copper grids) and
// `COPPER_LAYERS_PAIR_PRESETS_UI` (the presets grid), and
// `ROUTER_TOOL::SelectCopperLayerPair`, the entry point. Opened by
// `PCB_ACTIONS::selectLayerPair` ("Set Layer Pair..."), Edit > Route and the
// aux toolbar (`pcb_edit_frame.ts`'s `SelectCopperLayerPair`).
//
// `DIALOG_COPPER_LAYER_PAIR_SELECTION_BASE`'s sizer
// (`dialog_layer_selection_base.cpp:107-262`): a vertical `bSizerMain`
// holding a horizontal `bSizerUpper` (top/bottom layer grids, each in its own
// labelled column, then the add-to-presets arrow, then the presets
// `wxStaticBoxSizer`) and the OK/Cancel row below it — unlike
// `PCB_ONE_LAYER_SELECTOR`, this dialog DOES have buttons, because a pair
// pick does not close it on its own (`onLeftGridRowSelected` only updates the
// selection; only OK commits).
//
// `TransferDataToWindow`/`TransferDataFromWindow` become a local draft
// (`LAYER_PAIR_SETTINGS.copyOf`) committed onto the frame's real settings on
// OK; Cancel/Escape/the backdrop just discard it, so nothing needs the
// `Bind( PCB_CURRENT_LAYER_PAIR_CHANGED, … )` upstream uses to keep the two
// grids and the presets grid in sync with a settings object other code could
// also be mutating — the draft is private to this dialog, so the one React
// state update every pair-changing call site here already makes has nothing
// else to race with.

/** `getLayerPairName` (`sel_layer.cpp:90-94`): "F.Cu / B.Cu". */
function layerPairName(pair: LAYER_PAIR, board: BOARD): string {
  return `${board.GetLayerName(pair.GetLayerA())} / ${board.GetLayerName(pair.GetLayerB())}`;
}

/**
 * `createLayerPairBitmapAtSize` (`common/widgets/layer_presentation.cpp:70-
 * 103`): a square split on the diagonal, top colour upper-left, bottom colour
 * lower-right, a stroked separator (there: white outline, black centre; here,
 * one seam — a decorative simplification, not a data value).
 */
function layerPairIconStyle(topCss: string, bottomCss: string): CSSProperties {
  return {
    background: `linear-gradient(135deg, ${topCss} 0%, ${topCss} 47%, var(--chrome-fg) 47%, var(--chrome-fg) 53%, ${bottomCss} 53%, ${bottomCss} 100%)`,
  };
}

/** `CU_LAYER_COLNUMS` (`sel_layer.cpp:527-532`): select / colour / name. */
const CU_PAIR_COL_WIDTHS = [24, 20, 72] as const;

/**
 * One copper-layer picker grid (`COPPER_LAYERS_PAIR_SELECTION_UI`'s left or
 * right half): every copper layer the board enables, in UI order — no
 * `aNotAllowedLayersMask` here, unlike `PCB_ONE_LAYER_SELECTOR`.
 */
class COPPER_PAIR_GRID_TABLE extends WX_GRID_TABLE_BASE {
  constructor(
    private m_layers: readonly PCB_LAYER_ID[],
    private readonly m_board: BOARD,
  ) {
    super();
  }
  SetLayers(layers: readonly PCB_LAYER_ID[]): void {
    this.m_layers = layers;
  }
  GetLayers(): readonly PCB_LAYER_ID[] {
    return this.m_layers;
  }
  GetNumberRows(): number {
    return this.m_layers.length;
  }
  GetNumberCols(): number {
    return 3;
  }
  GetValue(aRow: number, aCol: number): string {
    const layer = this.m_layers[aRow];
    if (layer === undefined) return '';
    if (aCol === 2) return ` ${this.m_board.GetLayerName(layer)}`;
    return '';
  }
  SetValue(): void {}
}

function orderedCopperLayers(board: BOARD): PCB_LAYER_ID[] {
  return [...board.GetEnabledLayers().UIOrder()].filter((l) => IsCopperLayer(l));
}

/**
 * `PRESETS_COLNUMS` (`sel_layer.cpp:427-433`): Enabled / (swatch, no label) /
 * Layers / Label. `USERNAME` is `SetupColumnAutosizer`'s column — `flexCol`.
 */
const PRESETS_COLUMNS = ['Enabled', '', 'Layers', 'Label'] as const;
const PRESETS_COL_WIDTHS = [48, 24, 80, 120] as const;
const PRESETS_USERNAME_COL = 3;

/**
 * `COPPER_LAYERS_PAIR_PRESETS_UI` folded into one `WX_GRID_TABLE_BASE`: a
 * live view over the dialog's draft `LAYER_PAIR_SETTINGS`, never a copied
 * array, so `AddLayerPair`/`RemoveLayerPair`'s own de-dup and "was this the
 * last manual pair" bookkeeping stays the one copy of that logic.
 */
class PRESETS_GRID_TABLE extends WX_GRID_TABLE_BASE {
  constructor(
    private readonly m_settings: LAYER_PAIR_SETTINGS,
    private readonly m_board: BOARD,
  ) {
    super();
  }
  GetNumberRows(): number {
    return this.m_settings.GetLayerPairs().length;
  }
  GetNumberCols(): number {
    return 4;
  }
  override GetColLabelValue(aCol: number): string {
    return PRESETS_COLUMNS[aCol] ?? '';
  }
  GetValue(aRow: number, aCol: number): string {
    const info = this.m_settings.GetLayerPairs()[aRow];
    if (!info) return '';
    switch (aCol) {
      case 0:
        return info.IsEnabled() ? '1' : '0';
      case 2:
        return layerPairName(info.GetLayerPair(), this.m_board);
      case 3:
        return info.GetName() ?? '';
      default:
        return '';
    }
  }
  SetValue(aRow: number, aCol: number, aValue: string): void {
    const info = this.m_settings.GetLayerPairs()[aRow];
    if (!info) return;
    if (aCol === 0) info.SetEnabled(aValue === '1');
    else if (aCol === 3) info.SetName(aValue);
  }
  /** `OnLayerPairAdded` (`sel_layer.cpp:415-410`): add, then tell the view. */
  AddCurrentPair(aPair: LAYER_PAIR): void {
    const added = this.m_settings.AddLayerPair(new LAYER_PAIR_INFO(aPair, true, undefined));
    if (added) this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1);
  }
  /** One row of `OnDeleteSelectedLayerPairs` (`sel_layer.cpp:427-436`). */
  DeletePresetRow(aRow: number): void {
    const info = this.m_settings.GetLayerPairs()[aRow];
    if (info && this.m_settings.RemoveLayerPair(info.GetLayerPair())) {
      this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aRow, 1);
    }
  }
}

export interface SelectCopperLayerPairDialogProps {
  board: BOARD;
  theme: PcbColorTheme;
  /** `m_boardPairSettings` — the frame's real, live `LAYER_PAIR_SETTINGS`. */
  layerPairSettings: LAYER_PAIR_SETTINGS;
  onClose: () => void;
}

/** `SELECT_COPPER_LAYERS_PAIR_DIALOG`. */
export function SelectCopperLayerPairDialog({
  board,
  theme,
  layerPairSettings,
  onClose,
}: SelectCopperLayerPairDialogProps): JSX.Element {
  useModalEscape(onClose);

  // `m_dialogPairSettings( aBoardSettings )` + `TransferDataToWindow`: one
  // draft, seeded once from the frame's real settings.
  const [dialogSettings] = useState(() => LAYER_PAIR_SETTINGS.copyOf(layerPairSettings));
  const [currentPair, setCurrentPairState] = useState<LAYER_PAIR>(() =>
    dialogSettings.GetCurrentLayerPair(),
  );

  const setCurrentPair = (pair: LAYER_PAIR): void => {
    dialogSettings.SetCurrentLayerPair(pair);
    setCurrentPairState(pair);
  };

  const layers = useMemo(() => orderedCopperLayers(board), [board]);

  const [{ leftGrid, leftTable, leftTricks }] = useState(() => {
    const table = new COPPER_PAIR_GRID_TABLE(layers, board);
    const grid = new WX_GRID();
    grid.SetTable(table, true);
    grid.EnableEditing(false);
    return { leftGrid: grid, leftTable: table, leftTricks: new GRID_TRICKS(grid) };
  });
  const [{ rightGrid, rightTable, rightTricks }] = useState(() => {
    const table = new COPPER_PAIR_GRID_TABLE(layers, board);
    const grid = new WX_GRID();
    grid.SetTable(table, true);
    grid.EnableEditing(false);
    return { rightGrid: grid, rightTable: table, rightTricks: new GRID_TRICKS(grid) };
  });
  leftTable.SetLayers(layers);
  rightTable.SetLayers(layers);

  useEffect(() => {
    const onLeft = (e: wxGridEvent): void => {
      const layer = leftTable.GetLayers()[e.GetRow()];
      if (layer !== undefined) setCurrentPair(new LAYER_PAIR(layer, currentPair.GetLayerB()));
    };
    leftGrid.Connect(wxEVT_GRID_CELL_LEFT_CLICK, onLeft);
    return () => leftGrid.Disconnect(wxEVT_GRID_CELL_LEFT_CLICK, onLeft);
    // biome-ignore lint/correctness/useExhaustiveDependencies: currentPair is read fresh via the closure rebuilt each render; the effect re-subscribes whenever it changes so the handler never sees a stale "other side"
  }, [leftGrid, leftTable, currentPair]);

  useEffect(() => {
    const onRight = (e: wxGridEvent): void => {
      const layer = rightTable.GetLayers()[e.GetRow()];
      if (layer !== undefined) setCurrentPair(new LAYER_PAIR(currentPair.GetLayerA(), layer));
    };
    rightGrid.Connect(wxEVT_GRID_CELL_LEFT_CLICK, onRight);
    return () => rightGrid.Disconnect(wxEVT_GRID_CELL_LEFT_CLICK, onRight);
    // biome-ignore lint/correctness/useExhaustiveDependencies: see onLeft above
  }, [rightGrid, rightTable, currentPair]);

  const [{ presetsGrid, presetsTable, presetsTricks }] = useState(() => {
    const table = new PRESETS_GRID_TABLE(dialogSettings, board);
    const grid = new WX_GRID();
    grid.SetTable(table, true);
    return { presetsGrid: grid, presetsTable: table, presetsTricks: new GRID_TRICKS(grid) };
  });

  const renderCopperCell =
    (table: COPPER_PAIR_GRID_TABLE, isCurrentRow: (aRow: number) => boolean) =>
    (aRow: number, aCol: number): JSX.Element | null => {
      const layer = table.GetLayers()[aRow];
      if (layer === undefined) return null;
      if (aCol === 0)
        return (
          <input type="checkbox" tabIndex={-1} readOnly checked={isCurrentRow(aRow)} aria-hidden />
        );
      if (aCol === 1) {
        const swatch = layerSwatch(layer, theme);
        return <span className="ze-combo-swatch" style={{ background: swatch }} />;
      }
      return null;
    };

  const onAddToPresets = (): void => presetsTable.AddCurrentPair(currentPair);
  const onDeleteSelectedPresets = (): void =>
    presetsGrid.OnDeleteRows((row) => presetsTable.DeletePresetRow(row));

  const onOK = (): void => {
    layerPairSettings.SetLayerPairs(dialogSettings.GetLayerPairs());
    layerPairSettings.SetCurrentLayerPair(dialogSettings.GetCurrentLayerPair());
    onClose();

    // `ROUTER_TOOL::SelectCopperLayerPair`'s post-`ShowModal` check
    // (`sel_layer.cpp:781-787`).
    if (
      dialogSettings.GetCurrentLayerPair().GetLayerA() ===
      dialogSettings.GetCurrentLayerPair().GetLayerB()
    )
      void DisplayInfoMessage('Warning: top and bottom layers are same.');
  };

  return (
    <DialogShim title="Select Copper Layer Pair" onClose={onClose} className="ze-copper-layer-pair">
      <div className="ze-modal-body ze-copper-layer-pair-body">
        <div className="ze-copper-layer-pair-col">
          <div className="ze-copper-layer-pair-label">Top/Front layer:</div>
          <div className="ze-grid-pane">
            <WxGridView
              grid={leftGrid}
              tricks={leftTricks}
              colLabels={false}
              className="ze-grid-no-lines"
              ariaLabel="Top layer"
              columns={CU_PAIR_COL_WIDTHS.map((width) => ({ width }))}
              renderCell={renderCopperCell(
                leftTable,
                (r) => leftTable.GetLayers()[r] === currentPair.GetLayerA(),
              )}
            />
          </div>
        </div>
        <div className="ze-copper-layer-pair-col">
          <div className="ze-copper-layer-pair-label">Bottom/Back layer:</div>
          <div className="ze-grid-pane">
            <WxGridView
              grid={rightGrid}
              tricks={rightTricks}
              colLabels={false}
              className="ze-grid-no-lines"
              ariaLabel="Bottom layer"
              columns={CU_PAIR_COL_WIDTHS.map((width) => ({ width }))}
              renderCell={renderCopperCell(
                rightTable,
                (r) => rightTable.GetLayers()[r] === currentPair.GetLayerB(),
              )}
            />
          </div>
        </div>
        <button
          type="button"
          className="ze-gridbtn ze-copper-layer-pair-add"
          title="Add current pair to presets"
          onClick={onAddToPresets}
        >
          <Icon name="arrowRight" />
        </button>
        <fieldset className="ze-copper-layer-pair-presets">
          <legend>Copper Layer Pair Presets</legend>
          <div className="ze-grid-pane">
            <WxGridView
              grid={presetsGrid}
              tricks={presetsTricks}
              flexCol={PRESETS_USERNAME_COL}
              columns={PRESETS_COL_WIDTHS.map((width) => ({ width }))}
              ariaLabel="Copper layer pair presets"
              renderCell={(aRow, aCol, aValue) => {
                if (aCol === 0)
                  return (
                    <input
                      type="checkbox"
                      checked={aValue === '1'}
                      onChange={(e) => {
                        presetsTable.SetValue(aRow, 0, e.target.checked ? '1' : '0');
                        presetsGrid.ForceRefresh();
                      }}
                    />
                  );
                if (aCol === 1) {
                  const info = dialogSettings.GetLayerPairs()[aRow];
                  if (!info) return null;
                  const pair = info.GetLayerPair();
                  return (
                    <span
                      className="ze-copper-layer-pair-icon"
                      style={layerPairIconStyle(
                        layerSwatch(pair.GetLayerA(), theme),
                        layerSwatch(pair.GetLayerB(), theme),
                      )}
                    />
                  );
                }
                return null;
              }}
            />
          </div>
          <button
            type="button"
            className="ze-gridbtn ze-copper-layer-pair-delete"
            title="Delete selected presets"
            onClick={onDeleteSelectedPresets}
          >
            <Icon name="delete" />
          </button>
        </fieldset>
      </div>
      <div className="ze-modal-footer">
        <Button label="Cancel" onClick={onClose} />
        <Button label="OK" isDefault onClick={onOK} />
      </div>
    </DialogShim>
  );
}
