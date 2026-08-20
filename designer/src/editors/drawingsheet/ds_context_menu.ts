// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's canvas context menu.
 *
 * Three files build it upstream and they all feed one `CONDITIONAL_MENU`:
 *
 *   PL_SELECTION_TOOL::Init  (pl_selection_tool.cpp:54-75)
 *       separator @200, then drawLine / drawRectangle / placeText / placeImage
 *       @200, each conditioned on `SELECTION_CONDITIONS::Empty`
 *   PL_EDIT_TOOL::Init       (pl_edit_tool.cpp:85-93), into the *selection*
 *       tool's menu: move @250 (NotEmpty), separator @250, then cut / copy
 *       (NotEmpty), paste (ShowAlways) and doDelete (NotEmpty) @250
 *   EDA_DRAW_FRAME::AddStandardSubMenus (common/eda_draw_frame.cpp:709-726)
 *       separator @1000, then the Zoom and Grid submenus @1000
 *
 * `CONDITIONAL_MENU` keeps its entries sorted ascending by that order number
 * (`conditional_menu.cpp:210-221`) and `Evaluate` (:128-190) drops any entry
 * whose condition is false, then drops a separator that has no rows in front of
 * it (`if( menu_count ) AppendSeparator()`). Those two rules are the whole
 * shape of the menu, and they give exactly the two forms the driven audit
 * captured:
 *
 *   nothing selected   Draw Lines · Draw Rectangles · Draw Text ·
 *                      Place Bitmaps · — · Paste · — · Zoom ▸ · Grid ▸
 *   something selected Move · — · Cut · Copy · Paste · Delete · — ·
 *                      Zoom ▸ · Grid ▸
 *
 * Ours had no canvas context menu at all: a right-click added no element to the
 * DOM, and `PL_ACTIONS::move`'s M had no UI home anywhere in the editor.
 */
import type { MenuItem } from '../../ui/menu_types.js';
import { evaluateConditionalMenu, menuEntry, menuSeparator } from '../../ui/conditional_menu.js';
import {
  isZoomPresetChecked,
  zoomPresetLabel,
  type ZoomApp,
  ZOOM_LIST,
} from '../../ui/zoom_settings.js';
import { GRID_SIZE_LIST, gridSizeToMM, type GridApp } from '../../ui/grid_settings.js';
import { messageTextFromValue, unitText, type StatusUnits } from '../../ui/status_format.js';

/** The frame this menu belongs to. Both tables key on the same app name. */
const APP: ZoomApp & GridApp = 'pl_editor';

/** What each row runs. One per `TOOL_ACTION` the upstream menu carries. */
export interface DsContextMenuActions {
  /** `PL_ACTIONS::move` (pl_actions.cpp:80-88), hotkey M. */
  move: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  doDelete: () => void;
  drawLine: () => void;
  drawRectangle: () => void;
  placeText: () => void;
  placeImage: () => void;
  /** `ACTIONS::gridOrigin` (actions.cpp:1102-1107), GRID_MENU's first row. */
  gridOrigin: () => void;
  /** `COMMON_TOOLS::doZoomToPreset` with one entry of the zoom table. */
  setZoom: (factor: number) => void;
  /** `ACTIONS::gridPreset` with one index of the grid table. */
  setGrid: (index: number) => void;
}

export interface DsContextMenuState {
  hasSelection: boolean;
  /** `GAL::GetZoomFactor()`, which decides which Zoom row is ticked. */
  zoom: number;
  /** `grid.last_size_idx`, which decides which Grid row is ticked. */
  gridIndex: number;
  /** `GetUnitPair`'s primary unit — the frame's display unit. */
  primaryUnits: StatusUnits;
}

/**
 * `EDA_DRAW_FRAME::GetUnitPair` (`common/eda_draw_frame.cpp:1400-1420`): the
 * second unit a grid row is spelled in is always the other system's, so an
 * imperial frame quotes mm and a metric one quotes mils.
 */
export function secondaryUnits(primary: StatusUnits): StatusUnits {
  return primary === 'mm' ? 'mils' : 'mm';
}

/**
 * `GRID_MENU::BuildChoiceList` (`common/tool/grid_menu.cpp:89-112`):
 * `_( "%s%s (%s)" )` over the grid's `MessageText` in the primary and secondary
 * units, the leading `%s` being the grid's own name and empty for every entry
 * of the default list. Both numbers carry their unit label, so a pl_editor in
 * mils reads `19.69 mils (0.5000 mm)`.
 */
export function gridChoiceLabel(size: string, primary: StatusUnits): string {
  const mm = gridSizeToMM(size);
  if (mm === null) return size;
  const secondary = secondaryUnits(primary);
  const one = (u: StatusUnits): string => messageTextFromValue(mm, u) + unitText(u);
  return `${one(primary)} (${one(secondary)})`;
}

/** `ZOOM_MENU` (common/tool/zoom_menu.cpp) as a submenu. */
export function dsZoomSubmenu(zoom: number, setZoom: (factor: number) => void): MenuItem[] {
  return ZOOM_LIST[APP].map((factor) => ({
    label: zoomPresetLabel(factor),
    checked: isZoomPresetChecked(factor, zoom),
    action: () => setZoom(factor),
  }));
}

/** `GRID_MENU` (common/tool/grid_menu.cpp) as a submenu. */
export function dsGridSubmenu(
  gridIndex: number,
  primaryUnits: StatusUnits,
  gridOrigin: () => void,
  setGrid: (index: number) => void,
): MenuItem[] {
  return [
    { label: 'Grid Origin…', icon: 'gridOrigin', action: gridOrigin },
    { sep: true },
    ...GRID_SIZE_LIST[APP].map((size, i) => ({
      label: gridChoiceLabel(size, primaryUnits),
      checked: i === gridIndex,
      action: () => setGrid(i),
    })),
  ];
}

/**
 * The whole menu, as the three `Init()`s declare it and `Evaluate` resolves it.
 *
 * The entries are written with their upstream order numbers and conditions
 * rather than with the evaluated shape, so `evaluateConditionalMenu` decides
 * which rows and which rules survive — the same division of labour as the C++,
 * and the reason the @200 rule and the @250 rule behave differently from each
 * other without either being special-cased here.
 */
export function buildDsContextMenu(
  state: DsContextMenuState,
  actions: DsContextMenuActions,
): MenuItem[] {
  const empty = !state.hasSelection;
  const notEmpty = state.hasSelection;

  return evaluateConditionalMenu([
    // PL_SELECTION_TOOL::Init (pl_selection_tool.cpp:60-64).
    menuSeparator(200),
    menuEntry({ label: 'Draw Lines', icon: 'dsAddLine', action: actions.drawLine }, 200, empty),
    menuEntry(
      { label: 'Draw Rectangles', icon: 'dsAddRect', action: actions.drawRectangle },
      200,
      empty,
    ),
    menuEntry({ label: 'Draw Text', icon: 'dsAddText', action: actions.placeText }, 200, empty),
    menuEntry(
      { label: 'Place Bitmaps', icon: 'dsAddBitmap', action: actions.placeImage },
      200,
      empty,
    ),

    // PL_EDIT_TOOL::Init, into the selection tool's menu (pl_edit_tool.cpp:88-93).
    // BITMAPS::move has no SVG among our toolbar assets, so this row carries no
    // icon; GTK draws none in any of these menus anyway (audit DSP-11).
    menuEntry({ label: 'Move', shortcut: 'M', action: actions.move }, 250, notEmpty),
    menuSeparator(250),
    menuEntry(
      { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', action: actions.cut },
      250,
      notEmpty,
    ),
    menuEntry(
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', action: actions.copy },
      250,
      notEmpty,
    ),
    menuEntry(
      {
        // Ctrl+V is carried out by the browser's own paste event, not by us —
        // see MenuItem.nativeShortcut.
        label: 'Paste',
        icon: 'paste',
        shortcut: 'Ctrl+V',
        nativeShortcut: true,
        action: actions.paste,
      },
      250,
    ),
    menuEntry(
      { label: 'Delete', icon: 'dsDelete', shortcut: 'Delete', action: actions.doDelete },
      250,
      notEmpty,
    ),

    // EDA_DRAW_FRAME::AddStandardSubMenus (eda_draw_frame.cpp:714-725).
    menuSeparator(1000),
    menuEntry(
      { label: 'Zoom', icon: 'zoomTool', submenu: dsZoomSubmenu(state.zoom, actions.setZoom) },
      1000,
    ),
    menuEntry(
      {
        label: 'Grid',
        icon: 'toggleGrid',
        submenu: dsGridSubmenu(
          state.gridIndex,
          state.primaryUnits,
          actions.gridOrigin,
          actions.setGrid,
        ),
      },
      1000,
    ),
  ]);
}
