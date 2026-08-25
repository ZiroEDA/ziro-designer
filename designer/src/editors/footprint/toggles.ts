// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FOOTPRINT_EDIT_FRAME's left-toolbar toggle state, as pure data and one
 * function.
 *
 * Same shape, and the same reason, as `editors/gerbview/toggles.ts` and the
 * other three: `qa`'s tsconfig compiles `.ts` only, so anything a `.tsx`
 * declares is invisible to the suite. The defaults had already been pulled out
 * to `footprintToolbars.ts` for that reason; they live here now beside the
 * groups and the reducer, which were still inside `FootprintEditor.tsx` — and
 * a reducer only a component can call is a reducer nothing checks. That has
 * cost this repo a real bug before: gerbview's crosshair group could be
 * disabled outright without failing one test.
 */

import { defaultUnitsToggle } from '../../ui/app_settings_units.js';

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`pcbnew/toolbars_footprint_editor.cpp`), in upstream's order, which is
 * pcbnew's (millimetres first) rather than eeschema's.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];

/**
 * The left toolbar's state when the frame opens — every one of these is a
 * setting `FOOTPRINT_EDITOR_SETTINGS` seeds, not a preference of ours.
 *
 * The line mode is the one that was wrong: `lineMode45`, because
 * `FOOTPRINT_EDITOR_SETTINGS::FOOTPRINT_EDITOR_SETTINGS()` seeds
 * `m_AngleSnapMode( LEADER_MODE::DEG45 )`
 * (`pcbnew/footprint_editor_settings.cpp:55`) and
 * `FOOTPRINT_EDITOR_CONTROL::OnAngleSnapModeChanged`
 * (`pcbnew/tools/footprint_editor_control.cpp:1031-1048`) maps DEG45 to
 * `PCB_ACTIONS::lineMode45`. pcbnew's own default is DIRECT
 * (`pcbnew/pcbnew_settings.cpp:59`) and the schematic's is different again, so
 * this is exactly the per-frame value that gets taken from the wrong
 * neighbour — ours was `lineMode90`, which is neither frame's.
 *
 * The three panels are shown because the frame calls
 * `m_auimgr.GetPane( … ).Show( … )` off `m_AuiPanels`
 * (`footprint_edit_frame.cpp:262-264`), all of which default true.
 *
 * `toggleGrid` is `window.grid.show`, default `true`
 * (`common/settings/app_settings.cpp:555-556`), and `crosshairSmall` is
 * `m_crossHairMode( CROSS_HAIR_MODE::SMALL_CROSS )`
 * (`common/gal/gal_display_options.cpp:52`).
 *
 * The units entry is NOT written here. `system.units`' default is one branch in
 * `APP_SETTINGS_BASE` (`common/settings/app_settings.cpp:228-238`), and
 * `FOOTPRINT_EDITOR_SETTINGS` passes the filename `"fpedit"`
 * (`pcbnew/footprint_editor_settings.cpp:46`, through
 * `PCB_VIEWERS_SETTINGS_BASE`'s forwarding constructor,
 * `pcbnew/pcbnew_settings.h:123-124`), which is not on the imperial side — so
 * this frame opens in millimetres.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('fpedit'),
  'crosshairSmall',
  'lineMode45',
  'showLibraryTree',
  'showLayersManager',
  'showProperties',
]);

/**
 * Activating `id`, given what is currently on.
 *
 * A member of a radio group REPLACES its group — including itself, so
 * re-activating the member already on leaves it on rather than turning it off.
 * Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  const group = RADIO_GROUPS.find((g) => g.includes(id));

  if (group) {
    for (const g of group) next.delete(g);
    next.add(id);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}
