// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_PROPERTIES_GRID_TABLE` (`pcbnew/zone_layer_properties_grid.h`, with
 * its methods in `pcbnew/zone_settings.cpp:379-500`) — the three-column
 * Layer / Offset X / Offset Y table for a zone's per-layer hatched-fill
 * offsets.
 *
 * It lives in `widgets/` for the same reason it is its own header upstream:
 * **two** call sites share one table, `panel_setup_zone_hatch_offsets.cpp`
 * (Board Setup > Board Stackup > Zone Hatch Offsets, the board defaults) and
 * `panel_zone_properties.cpp` (one zone's own overrides). Building the grid
 * inside the Board Setup panel would guarantee a second copy the day the zone
 * dialog needs it.
 *
 * Three details are the table's, not the form's:
 *
 *  - the column labels come from `GetColLabelValue()` and read **"Offset X" /
 *    "Offset Y"**, not the "X Offset" / "Y Offset" the wxFormBuilder base sets
 *    (`panel_setup_zone_hatch_offsets_base.cpp:47-48`). `SetTable()` replaces
 *    the default table the base configured, and the labels go with it;
 *  - column 0 is `SetReadOnly()` with a `GRID_CELL_LAYER_RENDERER`
 *    (`panel_setup_zone_hatch_offsets.cpp:50-54`), so the layer is a swatch and
 *    a name, never an editable cell;
 *  - a value reads and writes through `StringFromValue`/`ValueFromString`, so
 *    the cell text carries its unit.
 *
 * The table is the class upstream's is, on a WX_GRID with GRID_TRICKS.
 */

import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxGridCellAttr,
  type wxGridEvent,
  wxGridTableRequest,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { ZoneLayerPropertiesMap } from './dialogs/panel_setup_zone_hatch_offsets.js';
import { PCB_BACKGROUND } from './pcbTheme.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { layerChoice } from './pcb_layer_presentation.js';

/**
 * `GetColLabelValue()` (`zone_layer_properties_grid.h:48-57`). The base's
 * `SetColLabelValue` calls are overwritten by `SetTable`, so these are the
 * labels the page actually shows.
 */
export const ZONE_LAYER_GRID_COLUMNS = ['Layer', 'Offset X', 'Offset Y'] as const;

/**
 * `SetColSize( 0, 160 )`, `( 1, 120 )`, `( 2, 120 )`
 * (`panel_setup_zone_hatch_offsets_base.cpp:41-43`).
 *
 * [data] transcribed from that base, not chosen.
 */
export const ZONE_LAYER_GRID_COL_WIDTHS = [160, 120, 120] as const;

type Offset = { x: number; y: number };

/**
 * `LAYER_PROPERTIES_GRID_TABLE`: one row per layer, its hatching offset read
 * and written in the frame's units. The model keeps millimetres, as the file's
 * `(hatch_position (xy X Y))` does; the units provider works in IU. `hatching_offset.value_or( VECTOR2I() )`,
 * so an unset layer shows 0, and editing either axis sets the whole offset.
 */
export class LAYER_PROPERTIES_GRID_TABLE extends WX_GRID_TABLE_BASE {
  private m_items: [string, { hatchingOffset?: Offset }][] = [];

  constructor(private readonly m_frame: UNITS_PROVIDER) {
    super();
  }

  GetNumberRows(): number {
    return this.m_items.length;
  }
  GetNumberCols(): number {
    return 3;
  }
  override GetColLabelValue(aCol: number): string {
    return ZONE_LAYER_GRID_COLUMNS[aCol] ?? '';
  }

  GetValue(aRow: number, aCol: number): string {
    const offset = this.m_items[aRow]?.[1].hatchingOffset ?? { x: 0, y: 0 };

    switch (aCol) {
      case 1:
        return this.m_frame.StringFromValue(offset.x * pcbIUScale.IU_PER_MM, true);
      case 2:
        return this.m_frame.StringFromValue(offset.y * pcbIUScale.IU_PER_MM, true);
      default:
        return this.m_items[aRow]?.[0] ?? '';
    }
  }

  SetValue(aRow: number, aCol: number, aValue: string): void {
    const item = this.m_items[aRow];

    if (!item) return;

    const offset = { ...(item[1].hatchingOffset ?? { x: 0, y: 0 }) };

    if (aCol === 1) offset.x = this.m_frame.ValueFromString(aValue) / pcbIUScale.IU_PER_MM;
    else if (aCol === 2) offset.y = this.m_frame.ValueFromString(aValue) / pcbIUScale.IU_PER_MM;
    else return;

    item[1] = { ...item[1], hatchingOffset: offset };
  }

  AddItem(aLayer: string, aProps: { hatchingOffset?: Offset }): void {
    this.m_items.push([aLayer, aProps]);
    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1);
  }

  override DeleteRows(aPos = 0, aNumRows = 1): boolean {
    if (aPos < this.m_items.length && aPos + aNumRows <= this.m_items.length) {
      this.m_items.splice(aPos, aNumRows);
      this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aPos, aNumRows);
      return true;
    }

    return false;
  }

  GetItems(): readonly [string, { hatchingOffset?: Offset }][] {
    return this.m_items;
  }
}

interface Props {
  /**
   * The rows, in order — `TransferDataToWindow()` walks
   * `LSET::AllCuMask().UIOrder()` and keeps the layers the board enables
   * (`panel_setup_zone_hatch_offsets.cpp:64-74`), so the caller decides which
   * layers exist and this draws them.
   */
  layers: readonly string[];
  value: ZoneLayerPropertiesMap;
  onChange: (next: ZoneLayerPropertiesMap) => void;
}

export function ZoneLayerPropertiesGrid({ layers, value, onChange }: Props): JSX.Element {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  const [{ grid, table, tricks }] = useState(() => {
    const g = new WX_GRID();
    const t = new LAYER_PROPERTIES_GRID_TABLE(new UNITS_PROVIDER(pcbIUScale, 'mm'));
    g.SetTable(t, true);
    const attr = new wxGridCellAttr();
    attr.SetReadOnly();
    g.SetColAttr(0, attr);
    return { grid: g, table: t, tricks: new GRID_TRICKS(g) };
  });

  // TransferDataToWindow.
  const key = JSON.stringify([layers, layers.map((l) => value[l]?.hatchingOffset ?? null)]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the rows' content; the table is stable
  useLayoutEffect(() => {
    grid.BeginBatch();
    table.DeleteRows(0, table.GetNumberRows());
    for (const layer of layers) table.AddItem(layer, { ...valueRef.current[layer] });
    grid.EndBatch();
  }, [key]);

  // TransferDataFromWindow, on each change.
  useEffect(() => {
    const onChanged = (e: wxGridEvent): void => {
      const next: ZoneLayerPropertiesMap = { ...valueRef.current };

      for (const [layer, props] of table.GetItems())
        next[layer] = {
          ...next[layer],
          ...(props.hatchingOffset ? { hatchingOffset: props.hatchingOffset } : {}),
        };

      onChangeRef.current(next);
      e.Skip();
    };
    grid.Connect(wxEVT_GRID_CELL_CHANGED, onChanged);
    return () => grid.Disconnect(wxEVT_GRID_CELL_CHANGED, onChanged);
  }, [grid, table]);

  return (
    <div className="ze-grid-pane ze-zone-layer-grid">
      <WxGridView
        grid={grid}
        tricks={tricks}
        columns={ZONE_LAYER_GRID_COL_WIDTHS.map((width) => ({ width }))}
        ariaLabel="Zone layer properties"
        renderCell={(_row, col, layer) => {
          if (col !== 0) return null;

          // `GRID_CELL_LAYER_RENDERER` on a read-only column: the swatch and
          // the layer's shown name, never an editor.
          const choice = layerChoice(LSET_NameToLayer(layer), PCB_BACKGROUND);
          return (
            <span className="ze-grid-text ze-zone-layer-name">
              <span className="ze-combo-swatch" style={{ background: choice.swatch }} />
              {choice.label}
            </span>
          );
        }}
      />
    </div>
  );
}
