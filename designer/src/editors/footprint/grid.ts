// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The grid `FOOTPRINT_EDIT_FRAME` is working on, in internal units.
 *
 * Upstream nobody passes this around: `EDA_DRAW_FRAME::GetNearestGridPosition`
 * reads `GetCanvas()->GetGAL()->GetGridSize()` (`common/eda_draw_frame.cpp`),
 * and the GAL's grid size is set from `gridCfg.grids[ gridCfg.last_size_idx ]`
 * whenever the frame's settings are (re)applied. So the grid is *frame state
 * read from the settings object*, not an argument, and every snap, the drawn
 * grid, the grid combo on the top toolbar and the status bar's `grid` pane are
 * four readers of that one value.
 *
 * Ours is the same, with the settings manager standing in for the frame — the
 * shape `editors/symbol/grid.ts` already has for the symbol editor. Before
 * this, `FootprintEditor` held the grid in a `useState` seeded from a module
 * constant and offered a hardcoded list of its own, so Preferences > Footprint
 * Editor > Grids had nothing to change and the choice did not survive a reload.
 *
 * The default is unchanged by the move: `FPEDIT_DEFAULTS`' grid list is
 * `DefaultGridSizeList()`'s `else` row — pcbnew's — and its `last_size_idx` is
 * the `defaultGridIdx` of 15 that `common/settings/app_settings.cpp:463-481`
 * gives every file the switch does not name, which is `0.5 mm`.
 */
import { settings, type FpEditSettings } from '../../prefs/settings.js';
import { PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import { gridSizeToIU } from '../../ui/grid_settings.js';
import { gridSnappingEnabled } from '../../ui/grid_cursor.js';

/**
 * A grid string in **pcbnew's** internal units.
 *
 * `ui/grid_settings.ts`' `gridSizeToIU` takes the IU-per-millimetre of the
 * frame reading it, and getting it wrong is not a rounding error: `PCB_IU_PER_MM`
 * is 1e6 and `SCH_IU_PER_MM` is 1e4, a hundred apart. `prefs/settings.ts`
 * exports a one-argument `gridSizeToIU` that bakes in the schematic scale and
 * defaults a unitless string to mils; it is the wrong one for board geometry,
 * and calling it is what once had this editor's grid combo built at eeschema's
 * precision over pcbnew coordinates.
 */
const toIU = (size: string): number => gridSizeToIU(size, PCB_IU_PER_MM) ?? 0;

/**
 * `gridCfg.grids[ safeGrid( gridCfg.last_size_idx ) ]`, in IU.
 *
 * The clamp is `PANEL_GRID_SETTINGS::safeGrid`'s
 * (`common/dialogs/panel_grid_settings.cpp:232-243`) reason for existing: an
 * index can outlive the row it named — remove the last grid and `last_size_idx`
 * points past the end — and a frame that read `undefined` there would snap to
 * nothing at all.
 */
export function footprintGridIU(cfg: FpEditSettings = settings.fpEdit): number {
  const { sizes, last_size_idx } = cfg.window.grid;
  const idx = Math.max(0, Math.min(last_size_idx, sizes.length - 1));
  return toIU(sizes[idx]?.x ?? '0.5 mm') || toIU('0.5 mm');
}

/**
 * `GRID_HELPER::GetGrid( … , PCB_GRID_HELPER::GetItemGrid( item ) )` — the grid
 * an override puts one *kind* of item on, chosen here by the active tool the
 * way `FootprintCanvas` chooses it.
 *
 * `PCB_GRID_HELPER::GetItemGrid` (`pcbnew/tools/pcb_grid_helper.cpp:947-979`)
 * is a switch on the item type. Three of its five answers can occur inside a
 * `FOOTPRINT`:
 *
 *  - `PCB_PAD_T` (with `PCB_FOOTPRINT_T`) -> `GRID_CONNECTABLE`, which is the
 *    row `PANEL_GRID_SETTINGS` relabels `_( "Pads:" )` in this frame
 *    (`common/dialogs/panel_grid_settings.cpp:57`);
 *  - `PCB_TEXT_T`, `PCB_FIELD_T` -> `GRID_TEXT`;
 *  - `PCB_SHAPE_T`, `PCB_DIMENSION_T`, `PCB_REFERENCE_IMAGE_T`,
 *    `PCB_TEXTBOX_T`, `PCB_BARCODE_T` -> `GRID_GRAPHICS`.
 *
 * `GRID_WIRES` and `GRID_VIAS` need a track, an arc or a via, none of which a
 * footprint contains — which is exactly why the panel hides both rows for this
 * frame, so there is no override to read either.
 *
 * `overrides_enabled` is `ACTIONS::toggleGridOverrides`, the left toolbar's own
 * button — with it off every item is on the current grid
 * (`GRID_HELPER::GetGrid`, `common/tool/grid_helper.cpp`).
 */
export function footprintGridForTool(cfg: FpEditSettings, activeTool: string | undefined): number {
  const grid = cfg.window.grid;
  const base = footprintGridIU(cfg);
  if (!grid.overrides_enabled) return base;

  const pick = (o: { enabled: boolean; size: string }): number | null =>
    o.enabled ? toIU(o.size) || null : null;

  if (activeTool === 'placePad') return pick(grid.overrides.connected) ?? base;
  if (TEXT_TOOL_IDS.has(activeTool ?? '')) return pick(grid.overrides.text) ?? base;
  if (GRAPHICS_TOOL_IDS.has(activeTool ?? '')) return pick(grid.overrides.graphics) ?? base;
  // `select`, and anything else, is `GRID_CURRENT` — which is also what
  // `GetItemGrid` returns for a mixed selection (`:355-366` of the schematic's
  // equivalent) and for a null item (`:949-950`).
  return base;
}

/** The right toolbar's tools that lay down a `PCB_TEXT_T` or a `PCB_FIELD_T`. */
const TEXT_TOOL_IDS = new Set<string>(['placeText']);

/**
 * The right toolbar's tools that lay down anything `GetItemGrid` answers
 * `GRID_GRAPHICS` for — every shape, the dimensions, the text box, the table,
 * the reference image and the barcode.
 */
const GRAPHICS_TOOL_IDS = new Set<string>([
  'drawLine',
  'drawArc',
  'drawRectangle',
  'drawCircle',
  'drawPolygon',
  'drawBezier',
  'drawTextBox',
  'drawTable',
  'drawRuleArea',
  'placeImage',
  'placeBarcode',
  'drawOrthogonalDimension',
  'drawAlignedDimension',
  'drawCenterDimension',
  'drawRadialDimension',
  'drawLeader',
]);

/**
 * `KIGFX::GAL::GetGridSnapping()` asked with THIS editor's settings object.
 *
 * The predicate itself is `ui/grid_cursor.ts`' `gridSnappingEnabled`, beside
 * the rest of `GAL_DISPLAY_OPTIONS`, because upstream it is one method on the
 * GAL and every canvas calls the same one. This is the call, and naming the
 * settings object in it is the whole point: reading pcbnew's `snap` here is the
 * shape of bug that once had the symbol editor following `eeschema.json`.
 */
export function footprintSnappingEnabled(cfg: FpEditSettings): boolean {
  return gridSnappingEnabled(cfg.window.grid.snap, cfg.window.grid.show);
}
