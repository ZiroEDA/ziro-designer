// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Grids — `PANEL_GRID_SETTINGS`
 * (`common/dialogs/panel_grid_settings.cpp`), which is **one class** upstream
 * parameterised on the frame type. eeschema's KIFACE constructs it for
 * `PANEL_SYM_EDIT_GRIDS` with the symbol editor's own settings object and
 * `FRAME_SCH_SYMBOL_EDITOR`:
 *
 *     APP_SETTINGS_BASE* cfg = GetAppSettings<SYMBOL_EDITOR_SETTINGS>( "symbol_editor" );
 *     EDA_BASE_FRAME*    frame = aKiway->Player( FRAME_SCH_SYMBOL_EDITOR, false );
 *     ...
 *     return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_SCH_SYMBOL_EDITOR );
 *     (`eeschema/eeschema.cpp:254-268`)
 *
 * So this file is that call and nothing else: which settings object, which
 * frame type, which units provider. The panel itself is
 * `dialogs/prefs/PanelGridSettings.tsx` — our `common/` — and the frame type
 * already has its Grid Overrides row in `grid_settings_rows.ts`'
 * `OVERRIDE_ROWS`, transcribed from the C++ constructor's visibility switch:
 * connected, wires, text and graphics, the same four the schematic shows,
 * because the symbol editor is one of the four schematic frames that keep the
 * connected and wires rows.
 *
 * **What reads it**, control by control — because until this landed nothing
 * did. The symbol editor snapped, drew and reported on the module constant
 * `GRID` (`render/symbolRenderer.ts`, `1.27 * MM` — 50 mil), which no page
 * could reach; `editors/symbol/grid.ts` is now the one place that answers
 * "which grid is this frame on", exactly as `EDA_DRAW_FRAME` asks the GAL.
 *
 *  - **the grid list and the current selection** (`sizes`, `last_size_idx`) ->
 *    `symbolGridIU()`, read by `SymbolCanvas`' `snap` and its move delta, by
 *    the drawn grid (`SymbolViewOptions.gridSizeIU`) and by the status bar's
 *    `grid` pane, which is `EDA_DRAW_FRAME::DisplayGridMsg`;
 *  - **the four Grid Overrides rows** -> `symbolGridForTool()`, which is
 *    `EE_GRID_HELPER::GetItemGrid` chosen by the active tool: pins on
 *    Connected items, text on Text, the drawing tools on Graphics. The Wires
 *    row is drawn and never applies, because no item inside a `LIB_SYMBOL`
 *    maps to `GRID_WIRES` — that is upstream's behaviour, not a gap;
 *  - **Fast Grid Switching** -> `fastGridIndex` in `ui/grid_settings.ts`, which
 *    is `COMMON_TOOLS::GridFast1` / `GridFast2` / `GridFastCycle`, bound to
 *    Alt+1 / Alt+2 / Alt+4 in this frame's key chain. The two choices are
 *    0-based indices into the list above them, as `GridPreset`'s
 *    `std::clamp( idx, 0, size - 1 )` reads them.
 */
import type { JSX } from 'react';
import { schIUScale } from '@ziroeda/common';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { toStatusUnits } from '../../../ui/app_settings_units.js';

export function PanelSymbolEditorGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { symbolEditor, upSym } = ctx;
  return (
    <PanelGridSettings
      grid={symbolEditor.window.grid}
      update={(fn) => upSym((s) => fn(s.window.grid))}
      frameType="FRAME_SCH_SYMBOL_EDITOR"
      // The `UNITS_PROVIDER` is the FRAME (`eeschema.cpp:254-268` passes it),
      // so these rows print in whatever unit the toolbar is on — switch to mm
      // and every grid row is mm. This read `defaultUnits('symbol_editor')`, a
      // constant, so the page said mils however the frame was set; the fix was
      // `system.units`, which every `APP_SETTINGS_BASE` stores and this app's
      // settings object was missing.
      units={toStatusUnits(symbolEditor.system.units)}
      // `schIUScale`: SYMBOL_EDIT_FRAME is an SCH_BASE_FRAME, so its rows print
      // at eeschema's precision, not pcbnew's.
      iuScale={schIUScale}
      idPrefix="sym"
    />
  );
}
