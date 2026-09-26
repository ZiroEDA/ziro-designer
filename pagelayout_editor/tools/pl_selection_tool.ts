// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How close the cursor has to be for pl_editor to consider it on something.
 *
 * [data] Three different numbers, each hardcoded upstream at its own call
 * site. Ours had one number — 6 — at all three, which is not any of them: a
 * click was twice as forgiving as KiCad's on an item and a quarter less on an
 * edit handle.
 */

import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import {
  evaluateConditionalMenu,
  menuEntry,
  menuSeparator,
} from '@ziroeda/common/tool/conditional_menu.js';
import type { ZoomApp } from '@ziroeda/common/settings/zoom_settings.js';
import { standardSubMenuEntries } from '@ziroeda/common/eda_draw_frame_submenus.js';
import { PL_IU_PER_MM } from '@ziroeda/common';
import {
  // One copy, in the shared module. This file had its own `secondaryUnits` and
  // `gridChoiceLabel`, a per-editor copy of a `common/` helper — and the copy
  // could not print a non-square grid at all, because it took a single size
  // where `GRID` has an x and a y. The Zoom and Grid submenus themselves went
  // the same way afterwards, into `ui/standard_submenus.ts`.
  gridSizeToMM,
  secondaryUnits,
  type GridApp,
  type GridEntry,
} from '@ziroeda/common/settings/grid_settings_ui.js';
import {
  messageTextFromValue,
  unitText,
  type StatusUnits,
} from '@ziroeda/common/widgets/kistatusbar_format.js';

/**
 * `HITTEST_THRESHOLD_PIXELS` in `pl_selection_tool.cpp:44` — the ordinary
 * click, the right-click hover selection and the box-drag's click fallback all
 * go through `SelectPoint`.
 */
export const SELECT_THRESHOLD_PX = 3;

/**
 * `HITTEST_THRESHOLD_PIXELS` in `pl_edit_tool.cpp:414`, a *different* constant
 * with the same name, used by `InteractiveDelete`'s motion handler
 * (`:443`). The delete tool is deliberately more forgiving than the pointer.
 */
export const DELETE_THRESHOLD_PX = 5;

/**
 * `EDIT_POINT::POINT_SIZE` (`include/tool/edit_points.h:194`), which
 * `EDIT_POINTS::FindPoint` converts to world units and hands to
 * `WithinPoint` (`common/tool/edit_points.cpp:58-78`).
 */
export const EDIT_POINT_SIZE_PX = 8;

/**
 * `EDIT_POINT::WithinPoint` (`common/tool/edit_points.cpp:37-45`):
 *
 *     VECTOR2I topLeft     = GetPosition() - aSize;
 *     VECTOR2I bottomRight = GetPosition() + aSize;
 *     return ( aPoint.x > topLeft.x && aPoint.y > topLeft.y &&
 *              aPoint.x < bottomRight.x && aPoint.y < bottomRight.y );
 *
 * A square, not a circle, and the comparisons are STRICT — a cursor exactly on
 * the box edge is outside it.
 */
export function withinPoint(
  point: { x: number; y: number },
  at: { x: number; y: number },
  size: number,
): boolean {
  return (
    at.x > point.x - size && at.y > point.y - size && at.x < point.x + size && at.y < point.y + size
  );
}

/**
 * A screen-pixel threshold in world units, which is what every call site
 * actually wants: `KiROUND( getView()->ToWorld( HITTEST_THRESHOLD_PIXELS ) )`
 * (pl_edit_tool.cpp:443) and the same shape in `FindPoint`.
 *
 * `dpr` is GAL's `m_scaleFactor`: our view scale is device pixels per world
 * unit, so a threshold quoted in logical pixels has to be scaled before it is
 * divided down.
 */
export function thresholdToWorld(px: number, viewScale: number, dpr = 1): number {
  return (px * dpr) / viewScale;
}

/**
 * Does arming this right-toolbar tool clear the selection?
 *
 * Both placement entry points open with `m_toolMgr->RunAction(
 * ACTIONS::selectionClear )` — `PL_DRAWING_TOOLS::PlaceItem`
 * (pl_drawing_tools.cpp:77) and `::DrawShape` (:243). Nothing else does:
 * `ZOOM_TOOL::Main` only pushes itself (zoom_tool.cpp:65), and
 * `PL_EDIT_TOOL::InteractiveDelete` runs a `PICKER_TOOL` that adds its own
 * hover pick to the selection rather than emptying it (pl_edit_tool.cpp:417-440).
 *
 * So picking Draw Lines with a rectangle selected empties the Properties pane
 * in a real pl_editor; ours left the rectangle selected under the new tool.
 */
export function toolClearsSelection(toolId: string): boolean {
  return PLACEMENT_TOOLS.has(toolId);
}

/** The four `PL_ACTIONS` that route to `PlaceItem` / `DrawShape`. */
const PLACEMENT_TOOLS: ReadonlySet<string> = new Set([
  'dsAddLine', // PL_ACTIONS::drawLine
  'dsAddRect', // PL_ACTIONS::drawRectangle
  'dsAddText', // PL_ACTIONS::placeText
  'dsAddBitmap', // PL_ACTIONS::placeImage
]);

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
  /**
   * `GRID_SETTINGS::grids` — the list itself, which `GRID_MENU::update`
   * (`common/tool/grid_menu.cpp`) reads off the settings object and not off
   * `DefaultGridSizeList()`. The distinction became visible once Preferences >
   * Drawing Sheet Editor > Grids could edit it.
   */
  gridSizes: readonly GridEntry[];
  /** `GetUnitPair`'s primary unit — the frame's display unit. */
  primaryUnits: StatusUnits;
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

    // EDA_DRAW_FRAME::AddStandardSubMenus (eda_draw_frame.cpp:709-726), from
    // the shared module — the same three entries the PCB editor's menu ends
    // with, because upstream they are the same method on the base frame.
    ...standardSubMenuEntries({
      zoomApp: APP,
      zoom: state.zoom,
      setZoom: actions.setZoom,
      gridSizes: state.gridSizes,
      gridIndex: state.gridIndex,
      primaryUnits: state.primaryUnits,
      // pl_editor's own IU scale (`drawSheetIUScale`, base_units.h:113), not
      // the schematic's.
      iuPerMM: PL_IU_PER_MM,
      gridOrigin: actions.gridOrigin,
      setGrid: actions.setGrid,
    }),
  ]);
}
