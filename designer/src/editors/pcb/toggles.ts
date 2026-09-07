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
import type { CrosshairMode } from '../../ui/grid_cursor.js';
import type { PcbnewSettings } from '../../prefs/settings.js';

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

/**
 * {@link DEFAULT_TOGGLES}, but with the three entries that have a stored value
 * taken FROM that value — `EDA_DRAW_FRAME::LoadSettings` reading
 * `m_Window.grid.show`, `m_Window.cursor.cross_hair_mode` and the frame's unit
 * back out of `pcbnew.json` on open (`common/eda_draw_frame.cpp`).
 *
 * Preferences > PCB Editor > Display Options edits the crosshair shape and the
 * Grids page the rest of `window.grid`; a frame that booted from a hardcoded
 * set would show a choice the canvas never took. `editors/drawingsheet/
 * toggles.ts`' `togglesFromSettings` is the same function for pl_editor.
 *
 * The other four entries stay literal because no key of `PcbnewSettings` backs
 * them yet — inventing one to derive them from would be the opposite of this.
 */
export function pcbTogglesFromSettings(cfg: PcbnewSettings): Set<string> {
  const out = new Set(DEFAULT_TOGGLES);

  out.delete('toggleGrid');
  if (cfg.window.grid.show) out.add('toggleGrid');

  for (const id of ['crosshairSmall', 'crosshairFull', 'crosshair45']) out.delete(id);
  out.add(crosshairToggleId(cfg.window.cursor.crosshair));

  // `curvedRatsnestCond` reads `m_Display.m_DisplayRatsnestLinesCurved`
  // (`pcbnew/pcb_edit_frame.cpp:1150-1155`), which Preferences > PCB Editor >
  // Editing Options is the other control over.
  out.delete('ratsnestLineMode');
  if (cfg.pcb_display.ratsnest_curved) out.add('ratsnestLineMode');

  // `BOARD_EDITOR_CONTROL::OnAngleSnapModeChanged` maps `m_AngleSnapMode` onto
  // one of the three Line mode buttons (`board_editor_control.cpp:360-368`), so
  // the toolbar group and Editing Options' "Constrain actions to H, V, 45
  // degrees" are ONE value.
  for (const id of ['lineModeFree', 'lineMode45', 'lineMode90']) out.delete(id);
  out.add(lineModeToggleId(cfg.editing.pcb_angle_snap_mode));

  return out;
}

/** `LEADER_MODE` -> the left toolbar's button id. DIRECT 0, DEG45 1, DEG90 2. */
export function lineModeToggleId(mode: number): string {
  return mode === 1 ? 'lineMode45' : mode === 2 ? 'lineMode90' : 'lineModeFree';
}

/** …and back. */
export function lineModeOf(id: string): 0 | 1 | 2 | null {
  if (id === 'lineModeFree') return 0;
  if (id === 'lineMode45') return 1;
  if (id === 'lineMode90') return 2;
  return null;
}

/** `CROSS_HAIR_MODE` -> the left toolbar's button id. */
export function crosshairToggleId(mode: CrosshairMode): string {
  return mode === 'full' ? 'crosshairFull' : mode === '45' ? 'crosshair45' : 'crosshairSmall';
}

/** …and back, for a click on one of the three. */
export function crosshairModeOf(id: string): CrosshairMode | null {
  if (id === 'crosshairFull') return 'full';
  if (id === 'crosshair45') return '45';
  if (id === 'crosshairSmall') return 'small';
  return null;
}

/**
 * Fold a toolbar activation back into `pcbnew.json`, so the button and
 * Preferences are one value rather than two that drift.
 *
 * `GAL_DISPLAY_OPTIONS`' setters write straight through to the settings object
 * upstream — `PCB_BASE_FRAME::SaveSettings` then persists it — which is why
 * flipping the crosshair from the toolbar and reopening Preferences shows the
 * new shape selected. Returns true when it took the click, so the caller knows
 * not to treat it as canvas-only state.
 */
export function foldPcbToggle(cfg: PcbnewSettings, id: string): boolean {
  const mode = crosshairModeOf(id);

  if (mode !== null) {
    cfg.window.cursor.crosshair = mode;
    return true;
  }

  const line = lineModeOf(id);

  if (line !== null) {
    cfg.editing.pcb_angle_snap_mode = line;
    return true;
  }

  if (id === 'toggleGrid') {
    cfg.window.grid.show = !cfg.window.grid.show;
    return true;
  }

  if (id === 'ratsnestLineMode') {
    cfg.pcb_display.ratsnest_curved = !cfg.pcb_display.ratsnest_curved;
    return true;
  }

  if (id === 'togglePolarCoords') {
    cfg.editing.polar_coords = !cfg.editing.polar_coords;
    return true;
  }

  return false;
}

/** Whether {@link foldPcbToggle} would write the file for this id. */
export function isStoredPcbToggle(id: string): boolean {
  return (
    crosshairModeOf(id) !== null ||
    lineModeOf(id) !== null ||
    id === 'toggleGrid' ||
    id === 'ratsnestLineMode' ||
    id === 'togglePolarCoords'
  );
}
