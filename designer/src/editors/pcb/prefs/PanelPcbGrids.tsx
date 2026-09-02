// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Grids — `PANEL_GRID_SETTINGS`, constructed by
 * pcbnew for `PANEL_PCB_GRIDS`:
 *
 *     return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_PCB_EDITOR );
 *     (`pcbnew/pcbnew.cpp:404-418`)
 *
 * The same class the schematic and drawing-sheet pages build. The FRAME_T is
 * the whole of the difference: it picks which Grid Overrides rows show
 * (`panel_grid_settings.cpp:66-90` — pcbnew is the only frame that keeps the
 * Vias row) and which action the Fast Grid hotkeys come from. So this file is a
 * binding, not a panel, exactly as upstream's one line is.
 */
import type { JSX } from 'react';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { defaultUnits, toStatusUnits } from '../../../ui/app_settings_units.js';
import { pcbIUScale } from '@ziroeda/common';

export function PanelPcbGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { pcbnew, upP } = ctx;
  return (
    <PanelGridSettings
      grid={pcbnew.window.grid}
      update={(fn) => upP((s) => fn(s.window.grid))}
      frameType="FRAME_PCB_EDITOR"
      // The `UNITS_PROVIDER` is the frame. pcbnew's live display unit is
      // toolbar state rather than a key we model, so this is the unit the frame
      // OPENS on — `app_settings.cpp:228-238`'s branch, asked for by name.
      units={toStatusUnits(defaultUnits('pcbnew'))}
      // `pcbIUScale`, not the schematic's: a PCB IU is a nanometre and an
      // eeschema IU is 100 nm, so a grid row printed through the wrong scale is
      // wrong by a factor of a hundred.
      iuScale={pcbIUScale}
      idPrefix="pcb"
    />
  );
}
