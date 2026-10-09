// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Zone Hatch Offsets. Counterpart:
 * `pcbnew/dialogs/panel_setup_zone_hatch_offsets.cpp`
 * (PANEL_SETUP_ZONE_HATCH_OFFSETS) with
 * `panel_setup_zone_hatch_offsets_base.cpp` for the form.
 *
 * The whole panel is a caption, a rule and one grid:
 *
 *     mainSizer->Add( m_staticTextLabel, 0, wxTOP|wxRIGHT|wxLEFT, 13 );
 *     mainSizer->Add( 0, 2, 0, 0, 5 );
 *     mainSizer->Add( m_staticline1, 0, wxEXPAND|wxBOTTOM, 5 );
 *     mainSizer->Add( m_layerOffsetsGrid, 0, wxALL, 5 );
 *
 * and the grid is the SHARED `LAYER_PROPERTIES_GRID_TABLE`, not one built here
 * — `panel_zone_properties.cpp` puts the same table in the per-zone dialog, so
 * it lives in `zone_layer_properties_grid.tsx` (pcbnew root, as KiCad's .h).
 *
 * Which rows exist is `TransferDataToWindow()` (`:63-78`):
 *
 *     for( PCB_LAYER_ID layer : LSET::AllCuMask().UIOrder() )
 *         if( m_brdSettings->IsLayerEnabled( layer ) )
 *             AddItem( layer, … );
 *
 * — the board's ENABLED copper layers in `UIOrder()`, which for copper is
 * `CuStack()`: F.Cu, In1…InN, then B.Cu last. So this page's row set follows
 * the copper count, which is why the Physical Stackup page calls
 * `SyncCopperLayers()` on it as well as on the Board Editor Layers page.
 */

import type { JSX } from 'react';
import { ZoneLayerPropertiesGrid } from '../zone_layer_properties_grid.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { BOARD } from '../board.js';
import { ZONE_LAYER_PROPERTIES } from '../zone_settings.js';

/**
 * `ZONE_LAYER_PROPERTIES` (`pcbnew/zone_settings.h:50-55`) as a row: one
 * `std::optional<VECTOR2I>`, and the optional is load-bearing - the writer
 * skips a layer whose offset was never set ("Do not store the layer properties
 * if no value is actually set", `pcb_io_kicad_sexpr.cpp:3096-3101`). Offsets
 * are mm, as the grid shows them.
 */
export interface ZoneLayerProperties {
  /** `(hatch_position (xy X Y))`. Absent = never set, and never written. */
  hatchingOffset?: { x: number; y: number };
}

/** `BOARD_DESIGN_SETTINGS::m_ZoneLayerProperties`, keyed by canonical layer name. */
export type ZoneLayerPropertiesMap = Record<string, ZoneLayerProperties>;

/** PANEL_SETUP_ZONE_HATCH_OFFSETS's transfers (panel_setup_zone_hatch_offsets.cpp). */
export const PANEL_SETUP_ZONE_HATCH_OFFSETS = {
  /** A row per enabled copper layer. */
  TransferDataToWindow(aBoard: BOARD): ZoneLayerPropertiesMap {
    const bds = aBoard.GetDesignSettings();
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    const zlp: ZoneLayerPropertiesMap = {};
    for (const layer of LSET.AllCuMask().UIOrder()) {
      if (!bds.IsLayerEnabled(layer)) continue;
      const props = bds.m_ZoneLayerProperties.get(layer);
      zlp[LSET.Name(layer)] = props?.hatching_offset
        ? { hatchingOffset: { x: mm(props.hatching_offset.x), y: mm(props.hatching_offset.y) } }
        : {};
    }
    return zlp;
  },

  TransferDataFromWindow(v: ZoneLayerPropertiesMap, aBoard: BOARD): void {
    const bds = aBoard.GetDesignSettings();
    const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
    for (const [name, props] of Object.entries(v)) {
      const layer = LSET.NameToLayer(name) as PCB_LAYER_ID;
      if (layer < 0) continue;
      bds.m_ZoneLayerProperties.set(
        layer,
        new ZONE_LAYER_PROPERTIES(
          props.hatchingOffset
            ? { x: iu(props.hatchingOffset.x), y: iu(props.hatchingOffset.y) }
            : undefined,
        ),
      );
    }
  },
};

interface Props {
  /** The board's enabled copper layers, in `CuStack()` order. */
  copperLayers: readonly string[];
  value: ZoneLayerPropertiesMap;
  onChange: (next: ZoneLayerPropertiesMap) => void;
}

export function PanelPcbZoneHatchOffsets({ copperLayers, value, onChange }: Props): JSX.Element {
  return (
    <div className="ze-zone-hatch-offsets">
      {/* `m_staticTextLabel`, `wxTOP|wxRIGHT|wxLEFT, 13` — a plain
          `wxStaticText`, no SetFont, so the dialog's own font. */}
      <div className="ze-zone-hatch-caption">Zone Hatched Fill Offsets</div>
      {/* `Add( 0, 2, 0, 0, 5 )` then `m_staticline1`, `wxEXPAND|wxBOTTOM, 5`. */}
      <hr className="ze-zone-hatch-rule" />
      <ZoneLayerPropertiesGrid layers={copperLayers} value={value} onChange={onChange} />
    </div>
  );
}
