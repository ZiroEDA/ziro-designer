// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_EDIT_FRAME's left-toolbar toggle state, as pure data and one function.
 *
 * Same shape, and the same reason, as `editors/gerbview/toggles.ts`,
 * `editors/symbol/toggles.ts` and `editors/schematic/toggles.ts`: this lived
 * inside `PcbEditor.tsx`, and `qa`'s tsconfig compiles `.ts` only — importing a
 * *value* out of a `.tsx` fails with TS6142 — so nothing in the suite could
 * read it, and two of its seven entries were on the wrong default. A table no
 * test can name is a table nobody checks.
 *
 * Only what the frame keeps in its own toggle set is here. `highContrast`,
 * `showRatsnest` and `toggleNetHighlight` are derived each render from the
 * Layer Display mode, the Objects tab's LAYER_RATSNEST row and the live net
 * highlight respectively (`leftToggles` in `PcbEditor.tsx`), exactly as
 * `highContrastCond` / `globalRatsnestCond` / `netHighlightCond` derive them
 * upstream (`pcbnew/pcb_edit_frame.cpp:1182-1188`).
 */

import { defaultUnitsToggle } from '../../ui/app_settings_units.js';

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`pcbnew/toolbars_pcb_editor.cpp:164-177`), in upstream's own order. The
 * units group leads with millimetres here and with inches in eeschema
 * (`eeschema/toolbars_sch_editor.cpp:82-84`), so the order is per-frame data,
 * not a shared constant: it is what the button cycles through on click.
 *
 * The zone-display pair is not an upstream group — those two are separate
 * `AppendAction`s (`toolbars_pcb_editor.cpp:186-188`) — but they read one
 * `ZONE_DISPLAY_MODE`, so only one can be in force.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
  ['zoneDisplayFilled', 'zoneDisplayOutline'],
];

/**
 * What a fresh PCB_EDIT_FRAME shows, entry by entry:
 *
 * - `toggleGrid` — `window.grid.show`, default `true`
 *   (`common/settings/app_settings.cpp:555-556`).
 * - the units button — the `APP_SETTINGS_BASE` branch
 *   (`app_settings.cpp:228-238`). `PCBNEW_SETTINGS` passes the filename
 *   `"pcbnew"` (`pcbnew/pcbnew_settings.cpp:50`), which is on neither imperial
 *   name, so the board opens in millimetres.
 * - `crosshairSmall` — `m_crossHairMode( CROSS_HAIR_MODE::SMALL_CROSS )`
 *   (`common/gal/gal_display_options.cpp:52`).
 * - `lineModeFree` — `m_AngleSnapMode( LEADER_MODE::DIRECT )`
 *   (`pcbnew/pcbnew_settings.cpp:59`), which
 *   `BOARD_EDITOR_CONTROL::OnAngleSnapModeChanged` maps to
 *   `PCB_ACTIONS::lineModeFree` (`pcbnew/tools/board_editor_control.cpp:364`).
 *   **This was `lineMode90`**, which is the DEG90 arm — a mode the board editor
 *   never starts in. The footprint editor's own default is DEG45
 *   (`pcbnew/footprint_editor_settings.cpp:55`), so the three pcbnew-family
 *   frames disagree on purpose and none of them may be copied from a neighbour.
 * - `zoneDisplayFilled` — `m_ZoneDisplayMode = ZONE_DISPLAY_MODE::SHOW_FILLED`
 *   (`include/pcb_display_options.h:35`).
 * - `showLayersManager` — `aui.show_layer_manager`, default `true`
 *   (`pcbnew/pcbnew_settings.cpp:78-79`).
 * - `showProperties` — `aui.show_properties`, default `true`
 *   (`pcbnew/pcbnew_settings.cpp:110-111`).
 *
 * And one entry that is deliberately ABSENT: `ratsnestLineMode` is checked off
 * `m_Display.m_DisplayRatsnestLinesCurved` (`curvedRatsnestCond`,
 * `pcbnew/pcb_edit_frame.cpp:1150-1155`), whose default is `false`
 * (`pcb_display.ratsnest_curved`, `pcbnew/pcbnew_settings.cpp:258-259`). Ours
 * listed it, so a fresh board drew **curved** ratsnest lines where KiCad draws
 * straight ones.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('pcbnew'),
  'crosshairSmall',
  'lineModeFree',
  'zoneDisplayFilled',
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
