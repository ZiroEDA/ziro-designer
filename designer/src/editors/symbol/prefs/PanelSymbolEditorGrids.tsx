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
 *  - **Fast Grid Switching** is the one pair still without a reader:
 *    `ACTIONS::gridFast1` / `gridFast2` have no binding in this frame yet, so
 *    the two choices store an index nothing acts on. They are left live rather
 *    than greyed because upstream's page has no per-row enable and greying
 *    them would be inventing a control state; the gap is the missing hotkey,
 *    not this page.
 */
import type { JSX } from 'react';
import { schIUScale } from '@ziroeda/common';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { defaultUnits, toStatusUnits } from '../../../ui/app_settings_units.js';

export function PanelSymbolEditorGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { symbolEditor, upSym } = ctx;
  return (
    <PanelGridSettings
      grid={symbolEditor.window.grid}
      update={(fn) => upSym((s) => fn(s.window.grid))}
      frameType="FRAME_SCH_SYMBOL_EDITOR"
      // The `UNITS_PROVIDER` is the frame, and the symbol editor's live display
      // unit is toolbar state rather than a key we model — `system.units` is
      // one of the `APP_SETTINGS_BASE` keys this port does not carry yet. So
      // this is the unit the frame OPENS on, which
      // `common/settings/app_settings.cpp:228-238` puts on the imperial side
      // for `symbol_editor` by name, asked for rather than written out.
      units={toStatusUnits(defaultUnits('symbol_editor'))}
      // `schIUScale`: SYMBOL_EDIT_FRAME is an SCH_BASE_FRAME, so its rows print
      // at eeschema's precision, not pcbnew's.
      iuScale={schIUScale}
      idPrefix="sym"
    />
  );
}
