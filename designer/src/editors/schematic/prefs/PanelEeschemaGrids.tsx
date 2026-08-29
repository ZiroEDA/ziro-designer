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
import { schIUScale } from '@ziroeda/common';
import { PanelGridSettings } from '../../../dialogs/prefs/PanelGridSettings.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { defaultUnits, toStatusUnits } from '../../../ui/app_settings_units.js';

export function PanelEeschemaGrids({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { eeschema, upE } = ctx;
  return (
    <PanelGridSettings
      grid={eeschema.window.grid}
      update={(fn) => upE((s) => fn(s.window.grid))}
      frameType="FRAME_SCH"
      // The `UNITS_PROVIDER` is the frame, and eeschema's live display unit is
      // toolbar state rather than a key in `EeschemaSettings` — `system.units`
      // is one of the APP_SETTINGS_BASE keys we do not model yet. So this is
      // the unit the frame OPENS on, `app_settings.cpp:228-238`'s imperial
      // branch, asked for by name rather than written out.
      units={toStatusUnits(defaultUnits('eeschema'))}
      // `schIUScale` — eeschema is the `is_eeschema` short form, so its rows
      // print one digit fewer than the drawing sheet's.
      iuScale={schIUScale}
      idPrefix="sch"
    />
  );
}
