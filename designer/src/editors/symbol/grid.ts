// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The grid `SYMBOL_EDIT_FRAME` is working on, in internal units.
 *
 * Upstream nobody passes this around: `EDA_DRAW_FRAME::GetNearestGridPosition`
 * reads `GetCanvas()->GetGAL()->GetGridSize()` (`common/eda_draw_frame.cpp`),
 * and the GAL's grid size is set from `gridCfg.grids[ gridCfg.last_size_idx ]`
 * whenever the frame's settings are (re)applied. So the grid is *frame state
 * read from the settings object*, not an argument, and every snap, the drawn
 * grid and the status bar's `grid` pane are three readers of that one value.
 *
 * Ours is the same, with the settings manager standing in for the frame:
 * `edits.ts`' `snap`, `SymbolCanvas`' move delta and `SymbolEditor`'s status
 * bar all come through here, which is what makes Preferences > Symbol Editor >
 * Grids actually change something. Before this the three read a module constant
 * — `symbolRenderer.ts`' `GRID` — that no page could reach.
 *
 * The default is unchanged by the move: `SYMBOL_EDITOR_DEFAULTS`' grid list is
 * `DefaultGridSizeList()`'s symbol_editor row and its `last_size_idx` is the
 * `defaultGridIdx` of 1 that `common/settings/app_settings.cpp:463-466` gives
 * the file by name — 50 mil, which is exactly what `GRID` was.
 */
import { gridSizeToIU, settings, type SymbolEditorSettings } from '../../prefs/settings.js';
import { SYM_SHAPE_TOOLS } from './symbolToolbars.js';
import { gridSnappingEnabled } from '../../ui/grid_cursor.js';

/**
 * `gridCfg.grids[ safeGrid( gridCfg.last_size_idx ) ]`, in IU.
 *
 * The clamp is `PANEL_GRID_SETTINGS::safeGrid`'s
 * (`common/dialogs/panel_grid_settings.cpp:232-243`) reason for existing: an
 * index can outlive the row it named — remove the last grid and `last_size_idx`
 * points past the end — and a frame that read `undefined` there would snap to
 * nothing at all.
 */
export function symbolGridIU(cfg: SymbolEditorSettings = settings.symbolEditor): number {
  const { sizes, last_size_idx } = cfg.window.grid;
  const idx = Math.max(0, Math.min(last_size_idx, sizes.length - 1));
  // `gridSizeToIU` falls back to 50 mil for a string it cannot parse, which is
  // also the answer for an empty list.
  return gridSizeToIU(sizes[idx]?.x ?? '50 mil');
}

/**
 * `GRID_HELPER::GetGrid( … , EE_GRID_HELPER::GetItemGrid( item ) )` — the grid
 * an override puts one *kind* of item on, chosen here by the active tool the
 * way `SchematicCanvas` chooses it.
 *
 * `EE_GRID_HELPER::GetItemGrid` (`eeschema/tools/ee_grid_helper.cpp:370-411`)
 * is a switch on the item type, and only three of its answers can occur inside
 * a `LIB_SYMBOL`:
 *
 *  - `SCH_PIN_T` -> `GRID_CONNECTABLE` (with `LIB_SYMBOL_T` itself);
 *  - `SCH_FIELD_T`, `SCH_TEXT_T` -> `GRID_TEXT`;
 *  - `SCH_SHAPE_T`, `SCH_TEXTBOX_T` -> `GRID_GRAPHICS`.
 *
 * `GRID_WIRES` is reachable only through `SCH_LINE_T` that `IsConnectable()`,
 * junctions and bus entries — none of which a symbol contains. So the Wires row
 * on the Grids page is drawn (the symbol editor is one of the schematic frames,
 * and `PANEL_GRID_SETTINGS` keeps the row for all four) and never applies.
 * That is upstream's behaviour, not a gap here.
 *
 * `overrides_enabled` is `ACTIONS::toggleGridOverrides`, the toolbar button —
 * with it off every item is on the current grid
 * (`GRID_HELPER::GetGrid`, `common/tool/grid_helper.cpp`).
 */
export function symbolGridForTool(
  cfg: SymbolEditorSettings,
  activeTool: string | undefined,
): number {
  const grid = cfg.window.grid;
  const base = symbolGridIU(cfg);
  if (!grid.overrides_enabled) return base;

  const pick = (o: { enabled: boolean; size: string }): number | null =>
    o.enabled ? gridSizeToIU(o.size) : null;

  // The tools that lay down each kind. `select` covers dragging an existing
  // item, where upstream asks the SELECTION's own type; ours has no per-item
  // snap grid on a drag, so it stays on the current grid — which is what
  // `GetItemGrid` returns for a mixed selection anyway (`:355-366`).
  if (activeTool === 'placePin') return pick(grid.overrides.connected) ?? base;
  if (activeTool === 'placeText') return pick(grid.overrides.text) ?? base;
  if (SHAPE_TOOL_IDS.has(activeTool ?? '')) return pick(grid.overrides.graphics) ?? base;
  return base;
}

/**
 * The RIGHT toolbar's drawing tools, i.e. everything that produces a
 * `SCH_SHAPE_T`. `SYM_SHAPE_TOOLS`' keys plus the two the port has not built
 * yet but whose buttons exist, so the table does not silently go stale when
 * they land.
 */
const SHAPE_TOOL_IDS = new Set<string>([
  ...Object.keys(SYM_SHAPE_TOOLS),
  'drawSymbolTextBox',
  'bezier',
]);

/**
 * `KIGFX::GAL::GetGridSnapping()` asked with THIS editor's settings object.
 *
 * The predicate itself is `ui/grid_cursor.ts`' `gridSnappingEnabled`, beside
 * the rest of `GAL_DISPLAY_OPTIONS`, because upstream it is one method on the
 * GAL and every canvas calls the same one. This is the call, and naming the
 * settings object in it is the whole point: reading another app's `snap` here
 * is the shape of bug that had the symbol editor following `eeschema.json`.
 */
export function symbolSnappingEnabled(cfg: SymbolEditorSettings): boolean {
  return gridSnappingEnabled(cfg.window.grid.snap, cfg.window.grid.show);
}
