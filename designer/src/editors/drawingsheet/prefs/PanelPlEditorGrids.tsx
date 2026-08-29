// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Drawing Sheet Editor > Grids — `PANEL_GRID_SETTINGS`, the
 * shared panel, constructed with `FRAME_PL_EDITOR`:
 *
 *     case PANEL_DS_GRIDS:
 *         return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_PL_EDITOR );
 *     (pagelayout_editor/pl_editor.cpp:71-79)
 *
 * The frame type is the whole of what pl_editor contributes: it decides that
 * the Grid Overrides group here shows Text and Graphics and not the connected,
 * wires or vias rows (`common/dialogs/panel_grid_settings.cpp:62-82`).
 *
 * This is also the page `ACTIONS::gridProperties` opens — `COMMON_TOOLS::
 * GridProperties` for `FRAME_PL_EDITOR` is nothing but
 * `ShowPreferences( _( "Grids" ), _( "Drawing Sheet Editor" ) )`
 * (`common/tool/common_tools.cpp:609-634`).
 */
import type { JSX } from 'react';
import { drawSheetIUScale } from '@ziroeda/common';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { toStatusUnits } from '../../../ui/app_settings_units.js';

export function PanelPlEditorGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { plEditor, upPl } = ctx;
  return (
    <PanelGridSettings
      grid={plEditor.window.grid}
      update={(fn) => upPl((s) => fn(s.window.grid))}
      frameType="FRAME_PL_EDITOR"
      // The `UNITS_PROVIDER` is the FRAME (`pl_editor.cpp:71-79` passes
      // `frame`), so the rows and the Grid Settings dialog read in whatever
      // unit pl_editor is displaying — `system.units`, which opens on mils.
      units={toStatusUnits(plEditor.system.units)}
      // `drawSheetIUScale`, `base_units.h:113` — microns, not the schematic's
      // 100 nm. It is what makes a pl_editor row read `196.85 mils (5.0000 mm)`
      // rather than the eeschema short form.
      iuScale={drawSheetIUScale}
      idPrefix="ds"
    />
  );
}
