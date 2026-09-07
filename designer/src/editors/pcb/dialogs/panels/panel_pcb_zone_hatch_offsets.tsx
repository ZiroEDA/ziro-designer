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
 * it lives in `widgets/zone_layer_properties_grid.tsx`.
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
import type { ZoneLayerPropertiesMap } from '../../board_settings.js';
import { ZoneLayerPropertiesGrid } from '../../../../widgets/zone_layer_properties_grid.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultZoneLayerProperties,
  type ZoneLayerProperties,
  type ZoneLayerPropertiesMap,
} from '../../board_settings.js';

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
