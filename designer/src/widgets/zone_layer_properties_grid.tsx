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
 */

import type { JSX } from 'react';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { ZoneLayerPropertiesMap } from '../editors/pcb/board_settings.js';
import { PCB_BACKGROUND } from '../editors/pcb/pcbTheme.js';
import { LSET_NameToLayer } from '@ziroeda/pcbnew/src/layer_ids.js';
import { layerChoice } from './layer_presentation.js';
import { parseUnitValueDouble, stringFromValue } from '../ui/unit_binder.js';

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
  // `GetValue()`: `hatching_offset.value_or( VECTOR2I() )`, so an unset layer
  // shows 0 rather than an empty cell (`zone_settings.cpp:393-407`).
  const offsetOf = (layer: string): { x: number; y: number } =>
    value[layer]?.hatchingOffset ?? { x: 0, y: 0 };

  // `SetValue()` reads the whole offset, replaces one axis and assigns it back,
  // which is what gives a previously unset layer a value the moment either
  // field is edited (`:410-423`).
  const setAxis = (layer: string, axis: 'x' | 'y', text: string): void => {
    const next = { ...offsetOf(layer), [axis]: parseUnitValueDouble(text, 'mm') };
    onChange({ ...value, [layer]: { ...value[layer], hatchingOffset: next } });
  };

  const cell = (layer: string, axis: 'x' | 'y'): JSX.Element => (
    <td>
      <input
        className="ze-search"
        aria-label={`${layer} offset ${axis.toUpperCase()}`}
        value={stringFromValue(offsetOf(layer)[axis], 'mm', true, pcbIUScale)}
        onChange={(e) => setAxis(layer, axis, e.target.value)}
      />
    </td>
  );

  return (
    <div className="ze-grid-pane ze-zone-layer-grid">
      <table className="ze-grid">
        <colgroup>
          {ZONE_LAYER_GRID_COL_WIDTHS.map((w, i) => (
            <col key={ZONE_LAYER_GRID_COLUMNS[i]} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {ZONE_LAYER_GRID_COLUMNS.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {layers.map((layer) => {
            // `GRID_CELL_LAYER_RENDERER` on a read-only column: the swatch and
            // the layer's shown name, never an editor.
            const choice = layerChoice(LSET_NameToLayer(layer), PCB_BACKGROUND);
            return (
              <tr key={layer}>
                <td className="ze-zone-layer-name">
                  <span className="ze-combo-swatch" style={{ background: choice.swatch }} />
                  {choice.label}
                </td>
                {cell(layer, 'x')}
                {cell(layer, 'y')}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
