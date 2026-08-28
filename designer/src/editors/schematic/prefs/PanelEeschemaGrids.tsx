// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Grids — `PANEL_GRID_SETTINGS`
 * (`common/dialogs/panel_grid_settings.cpp`), which upstream is **one class**
 * parameterised on the frame type; eeschema constructs it for `PANEL_SCH_GRIDS`
 * with `FRAME_SCH` (`eeschema/eeschema.cpp:310-325`).
 *
 * This file used to hold a private copy of that panel, with a header saying the
 * generalisation was follow-up work. It is now the call the C++ makes: the
 * panel lives in `dialogs/prefs/PanelGridSettings.tsx` — our `common/` — and
 * this says which settings object and which frame type it is for, and nothing
 * else. The Drawing Sheet Editor's Grids page is the same component with
 * `FRAME_PL_EDITOR`.
 */
import type { JSX } from 'react';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelEeschemaGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <PanelGridSettings
      grid={eeschema.window.grid}
      update={(fn) => upE((s) => fn(s.window.grid))}
      frameType="FRAME_SCH"
      // Ours, not KiCad's: `OnAddGrid` opens `DIALOG_GRID_SETTINGS` on an empty
      // grid and lets the user type one, which is the port this page still
      // owes. Until then a new row starts at a schematic-shaped size.
      newGridSize="25 mil"
      idPrefix="sch"
    />
  );
}
