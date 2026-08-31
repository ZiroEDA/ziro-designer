// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_DRAW_FRAME::AddStandardSubMenus` (`common/eda_draw_frame.cpp:709-726`),
 * with the two menus it installs: `ZOOM_MENU` (`common/tool/zoom_menu.cpp`)
 * and `GRID_MENU` (`common/tool/grid_menu.cpp`).
 *
 * This is the clearest case in the app of KiCad putting something in `common/`:
 * ONE method on the base frame, called from each editor's tool `Init()` —
 * `BOARD_EDITOR_CONTROL::Init` (`board_editor_control.cpp:414`),
 * `PCB_SELECTION_TOOL::Init` (`pcb_selection_tool.cpp:160, 235`),
 * `PL_SELECTION_TOOL`, gerbview's and the footprint editor's — so that the
 * bottom of every canvas context menu in KiCad is the same two rows. It is why
 * a user who learns "right-click, Grid" in the schematic finds it in the board.
 *
 * Ours had one copy, private to the Drawing Sheet Editor
 * (`editors/drawingsheet/ds_context_menu.ts`), and the PCB editor's context
 * menu simply had no Zoom or Grid rows at all.
 *
 *     aMenu.AddSeparator( 1000 );
 *     aMenu.AddMenu( zoomMenu.get(), SELECTION_CONDITIONS::ShowAlways, 1000 );
 *     aMenu.AddMenu( gridMenu.get(), SELECTION_CONDITIONS::ShowAlways, 1000 );
 *
 * Both are `ShowAlways`, so they are the one part of the menu that is there
 * whatever is selected — and order 1000 is what keeps them last.
 */
import type { MenuItem } from './menu_types.js';
import { type ConditionalEntry, menuEntry, menuSeparator } from './conditional_menu.js';
import { isZoomPresetChecked, zoomPresetLabel, type ZoomApp, ZOOM_LIST } from './zoom_settings.js';
import { gridChoiceLabel, type GridEntry } from './grid_settings.js';
import type { StatusUnits } from './status_format.js';

/** The order `AddStandardSubMenus` gives all three of its entries. */
export const STANDARD_SUBMENU_ORDER = 1000;

/**
 * `ZOOM_MENU` (`common/tool/zoom_menu.cpp:60-81`) — one row per preset of the
 * frame's own zoom table, the row at the current zoom ticked.
 */
export function zoomSubMenu(
  app: ZoomApp,
  zoom: number,
  setZoom: (factor: number) => void,
): MenuItem[] {
  return ZOOM_LIST[app].map((factor) => ({
    label: zoomPresetLabel(factor),
    checked: isZoomPresetChecked(factor, zoom),
    action: () => setZoom(factor),
  }));
}

export interface GridSubMenuSpec {
  /**
   * `GRID_SETTINGS::grids` — the list itself, which `GRID_MENU::update` reads
   * off the settings object rather than off `DefaultGridSizeList()`, so a
   * frame whose Preferences page can edit the grids passes what it has.
   */
  gridSizes: readonly GridEntry[];
  /** `grid.last_size_idx`, which decides which row is ticked. */
  gridIndex: number;
  /** `GetUnitPair`'s primary unit — the frame's display unit. */
  primaryUnits: StatusUnits;
  /**
   * The frame's own IU scale. It decides the row's precision: `short_form`
   * upstream is `IU_PER_MM == SCH_IU_PER_MM`, so pl_editor and pcbnew — which
   * are not that — print `196.85 mils (5.0000 mm)` where eeschema shortens.
   */
  iuPerMM: number;
  /** `ACTIONS::gridOrigin` (`actions.cpp:1102-1107`), GRID_MENU's first row. */
  gridOrigin: () => void;
  /** `ACTIONS::gridPreset` with one index of the grid table. */
  setGrid: (index: number) => void;
}

/** `GRID_MENU` (`common/tool/grid_menu.cpp`) as a submenu. */
export function gridSubMenu(spec: GridSubMenuSpec): MenuItem[] {
  return [
    { label: 'Grid Origin...', icon: 'gridOrigin', action: spec.gridOrigin },
    { sep: true },
    ...spec.gridSizes.map((sz, i) => ({
      label: gridChoiceLabel(sz, spec.primaryUnits, spec.iuPerMM, sz.name),
      checked: i === spec.gridIndex,
      action: () => spec.setGrid(i),
    })),
  ];
}

export interface StandardSubMenusSpec extends GridSubMenuSpec {
  /** Which frame's zoom table `ZOOM_MENU` shows. */
  zoomApp: ZoomApp;
  /** `GAL::GetZoomFactor()`. */
  zoom: number;
  /** `COMMON_TOOLS::doZoomToPreset` with one entry of the zoom table. */
  setZoom: (factor: number) => void;
}

/**
 * The three entries `AddStandardSubMenus` adds, at their upstream order, for a
 * caller to concatenate into its own `CONDITIONAL_MENU` before evaluating it.
 *
 * Returned as entries rather than as finished rows so that the separator obeys
 * the same elision rule as every other — `Evaluate` drops it when nothing
 * precedes it, which is what happens in a menu that is only these two rows.
 */
export function standardSubMenuEntries(spec: StandardSubMenusSpec): ConditionalEntry[] {
  return [
    menuSeparator(STANDARD_SUBMENU_ORDER),
    menuEntry(
      {
        label: 'Zoom',
        icon: 'zoomTool',
        submenu: zoomSubMenu(spec.zoomApp, spec.zoom, spec.setZoom),
      },
      STANDARD_SUBMENU_ORDER,
    ),
    menuEntry(
      { label: 'Grid', icon: 'toggleGrid', submenu: gridSubMenu(spec) },
      STANDARD_SUBMENU_ORDER,
    ),
  ];
}
