// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Grids — `PANEL_GRID_SETTINGS`
 * (`common/dialogs/panel_grid_settings.cpp`), which is **one class** upstream
 * parameterised on the frame type. pcbnew's KIFACE constructs it for
 * `PANEL_FP_GRIDS` with the footprint editor's own settings object and
 * `FRAME_FOOTPRINT_EDITOR`:
 *
 *     FOOTPRINT_EDITOR_SETTINGS* cfg = GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" );
 *     EDA_BASE_FRAME*            frame = aKiway->Player( FRAME_FOOTPRINT_EDITOR, false );
 *     ...
 *     return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_FOOTPRINT_EDITOR );
 *     (`pcbnew/pcbnew.cpp:308-323`)
 *
 * So this file is that call and nothing else: which settings object, which
 * frame type, which units provider. The panel itself is
 * `dialogs/prefs/PanelGridSettings.tsx` — our `common/` — and the frame type
 * already has its Grid Overrides row in `grid_settings_rows.ts`'
 * `OVERRIDE_ROWS`: pads, text and graphics, which is what
 * `panel_grid_settings.cpp:53-92` leaves standing once vias is hidden outside
 * pcbnew and connected/wires outside the schematic frames — except that
 * connected is re-shown at `:57` under the label `_( "Pads:" )`.
 *
 * **What reads it.** Until this landed nothing could: `FootprintEditor` held
 * its grid in a `useState` seeded from a module constant and offered a
 * hardcoded list, so the Grids page had no way to reach the canvas and the
 * canvas had no way to remember. `editors/footprint/grid.ts` is now the one
 * place that answers "which grid is this frame on", exactly as
 * `EDA_DRAW_FRAME` asks the GAL:
 *
 *  - **the grid list and the current selection** (`sizes`, `last_size_idx`) ->
 *    `footprintGridIU()`, read by the top toolbar's grid combo, by
 *    `FootprintCanvas`' snap and its move delta, by the drawn grid
 *    (`pcbGridOptions`' `sizeIU`) and by the status bar's `grid` pane, which is
 *    `EDA_DRAW_FRAME::DisplayGridMsg`;
 *  - **the three Grid Overrides rows** -> `footprintGridForTool()`, which is
 *    `PCB_GRID_HELPER::GetItemGrid` chosen by the active tool: the pad tool on
 *    Pads, the text tools on Text, the drawing tools on Graphics;
 *  - **Fast Grid Switching** -> `fastGridIndex` in `ui/grid_settings.ts`, which
 *    is `COMMON_TOOLS::GridFast1` / `GridFast2` / `GridFastCycle`, bound to
 *    Alt+1 / Alt+2 / Alt+4 in this frame's key chain. The two choices are
 *    0-based indices into the list above them, as `GridPreset`'s
 *    `std::clamp( idx, 0, size - 1 )` reads them.
 */
import type { JSX } from 'react';
import { pcbIUScale } from '@ziroeda/common';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { toStatusUnits } from '../../../ui/app_settings_units.js';

export function PanelFpGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  return (
    <PanelGridSettings
      grid={fpEdit.window.grid}
      update={(fn) => upFp((s) => fn(s.window.grid))}
      frameType="FRAME_FOOTPRINT_EDITOR"
      // The `UNITS_PROVIDER` is the FRAME — `pcbnew.cpp:311-321` looks one up
      // and calls `SetUnits( frame->GetUserUnits() )` before constructing the
      // panel — so these rows print in whatever unit the toolbar is on.
      units={toStatusUnits(fpEdit.system.units)}
      // `pcbIUScale`: FOOTPRINT_EDIT_FRAME is a PCB_BASE_FRAME, so its rows
      // print at pcbnew's precision and not eeschema's.
      iuScale={pcbIUScale}
      idPrefix="fp"
    />
  );
}
