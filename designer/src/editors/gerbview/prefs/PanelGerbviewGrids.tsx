// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Grids — `PANEL_GRID_SETTINGS`, the shared
 * panel, constructed with `FRAME_GERBER`:
 *
 *     case PANEL_GBR_GRIDS:
 *     {
 *         GERBVIEW_SETTINGS* cfg = GetAppSettings<GERBVIEW_SETTINGS>( "gerbview" );
 *         EDA_BASE_FRAME*    frame = aKiway->Player( FRAME_GERBER, false );
 *         if( frame )
 *             SetUserUnits( frame->GetUserUnits() );
 *         return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_GERBER );
 *     }
 *     (gerbview/gerbview.cpp:82-90)
 *
 * Note which object is the `UNITS_PROVIDER`: gerbview passes `this`, the
 * KIFACE, which is `UNITS_PROVIDER( gerbIUScale, EDA_UNITS::MM )`
 * (`gerbview.cpp:60-61`) — and then overwrites its unit with the live frame's
 * before constructing the panel. So the scale is gerbview's own and the unit is
 * whatever the Units toolbar group is on, which is `system.units`.
 *
 * The frame type is the whole of gerbview's other contribution, and here it
 * subtracts rather than selects: `PANEL_GRID_SETTINGS`' constructor hides the
 * Grid Overrides heading, its rule and every row for `FRAME_GERBER`
 * (`common/dialogs/panel_grid_settings.cpp:62-90`), so this page is the Grids
 * list and Fast Grid Switching and nothing else. `grid_settings_rows.ts`'
 * `FRAME_GERBER: []` is that same statement from the panel's side.
 *
 * This is also the page `ACTIONS::gridProperties` opens: `COMMON_TOOLS::
 * GridProperties` is nothing but `ShowPreferences( _( "Grids" ), <frame name> )`
 * (`common/tool/common_tools.cpp:609-634`), which is what the grid selector's
 * "Edit Grids..." row does.
 */
import type { JSX } from 'react';
import { gerbIUScale } from '@ziroeda/common';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { toStatusUnits } from '../../../ui/app_settings_units.js';

export function PanelGerbviewGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { gerbview, upGbr } = ctx;
  return (
    <PanelGridSettings
      grid={gerbview.window.grid}
      update={(fn) => upGbr((s) => fn(s.window.grid))}
      frameType="FRAME_GERBER"
      units={toStatusUnits(gerbview.system.units)}
      // `gerbIUScale`, 1e5 IU per mm (`eda_units.ts:24`, `base_units.h`) — the
      // scale the KIFACE's own UNITS_PROVIDER carries, not the schematic's
      // 1e4 and not pl_editor's microns. It decides the precision each row is
      // printed to.
      iuScale={gerbIUScale}
      idPrefix="gbr"
    />
  );
}
