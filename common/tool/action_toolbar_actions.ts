// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three strings a toolbar button's tooltip is built from, per toolbar id.
 *
 * `ACTION_TOOLBAR` sets every button's tooltip to `aAction.GetButtonTooltip()`
 * (common/tool/action_toolbar.cpp:149), which is FriendlyName, then a tab and
 * the hotkey, then the action's `.Tooltip()` on a second line. So the parts are
 * three separate fields on the TOOL_ACTION, and a toolbar that stores one
 * pre-joined `title` string cannot produce them.
 *
 * **Why this is shared rather than per editor.** KiCad writes `ACTIONS::save`
 * once in `common/tool/actions.cpp` and every editor's toolbar points at that
 * one object, which is why Save's tooltip is identical in eeschema, pcbnew,
 * the symbol and footprint editors and GerbView. A per-editor copy of the
 * string is exactly the drift CLAUDE.md's central-value rule forbids. This is
 * the same shape as `toolbar_bitmaps.ts`, which holds every id's
 * `.Icon( BITMAPS::… )` for all editors in one map.
 *
 * **This is data, not chrome.** Every string is transcribed from the
 * `.FriendlyName()`, `.DefaultHotkey()` and `.Tooltip()` of the named
 * TOOL_ACTION — never invented, never reworded. An action with no `.Tooltip()`
 * has no `tip` here, and gets no second line.
 *
 * Hotkeys are the **Hotkey List** spelling, which is what the toolbar uses:
 * `GetButtonTooltip` calls `KeyNameFromKeyCode` (hotkeys_basic.cpp:169), whose
 * modifier order is Ctrl, Alt, Shift (`:192-205`) — so `Ctrl+Alt+F`, and
 * `Ctrl+Shift+G`. That is a different string from the same key in a GTK menu;
 * `ui/key_names.ts` is the whole of that split. Where an action's hotkey is
 * inside `#if defined( __WXMAC__ )`, the `#else` branch is the one recorded.
 */

import { buttonTooltipFor, translateTooltip } from './tool_action_tooltip.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** One TOOL_ACTION's tooltip parts. */
export interface ToolbarAction {
  /** `.FriendlyName()` — `GetFriendlyName()`, the tooltip's first line. */
  name: string;
  /** `KeyNameFromKeyCode( GetHotKey() )`, absent when the action declares none. */
  hotkey?: string;
  /** `.Tooltip()` — `GetTooltip( false )`, the second line. Absent means no second line. */
  tip?: string;
}

/**
 * Keyed by toolbar id, as `toolbar_bitmaps.ts` is.
 *
 * Only the ids this app's toolbars actually use are listed; an id that is
 * absent falls back to its button's own `title`, so an editor whose data has
 * not been converted yet is unaffected.
 */
export const EESCHEMA_TOOLBAR_ACTIONS: Readonly<Record<string, ToolbarAction>> = {
  findReplace: { name: 'Find and Replace', hotkey: 'Ctrl+Alt+F' },
  zoomFit: {
    name: _HKI('Zoom to Fit'),
    hotkey: 'Home',
    tip: _HKI('Zoom to worksheet area if exists or edited object'),
  },
  symbolEditor: {
    name: _HKI('Symbol Editor'),
    tip: _HKI('Create, delete and edit schematic symbols'),
  },
  symbolBrowser: { name: _HKI('Symbol Library Browser') },
  footprintEditor: {
    name: _HKI('Footprint Editor'),
    tip: _HKI('Create, delete and edit board footprints'),
  },
  unitsInches: { name: 'Inches' },
  unitsMils: { name: 'Mils' },
  unitsMm: { name: 'Millimeters' },
  crosshairSmall: {
    name: _HKI('Small crosshairs'),
    tip: _HKI('Use small crosshairs aligned at 0 and 90 degrees'),
  },
  crosshairFull: {
    name: _HKI('Full-Window Crosshairs'),
    tip: _HKI('Display full-window crosshairs aligned at 0 and 90 degrees'),
  },
  crosshair45: {
    name: _HKI('45 Degree Crosshairs'),
    tip: _HKI('Display full-window crosshairs aligned at 45 and 135 degrees'),
  },
  select: { name: 'Rectangle', tip: _HKI('Set selection mode to use rectangle') },
  selectLasso: { name: _HKI('Lasso'), tip: _HKI('Set selection mode to use polygon lasso') },

  // ---- eeschema/tools/sch_actions.cpp -----------------------------------
  schematicSetup: {
    name: _HKI('Schematic Setup...'),
    tip: _HKI('Edit schematic setup including annotation styles and electrical rules'),
  },
  navBack: {
    name: _HKI('Navigate Back'),
    hotkey: 'Alt+Left',
    tip: _HKI('Move backward in sheet navigation history'),
  },
  navUp: {
    name: _HKI('Navigate Up'),
    hotkey: 'Alt+Up',
    tip: _HKI('Navigate up one sheet in the hierarchy'),
  },
  navFwd: {
    name: _HKI('Navigate Forward'),
    hotkey: 'Alt+Right',
    tip: _HKI('Move forward in sheet navigation history'),
  },
  rotateCCW: { name: _HKI('Rotate Counterclockwise'), hotkey: 'R' },
  rotateCW: { name: _HKI('Rotate Clockwise'), hotkey: 'Shift+R' },
  mirrorV: {
    name: _HKI('Mirror Vertically'),
    hotkey: 'Y',
    tip: _HKI('Flips selected item(s) from top to bottom'),
  },
  mirrorH: {
    name: _HKI('Mirror Horizontally'),
    hotkey: 'X',
    tip: _HKI('Flips selected item(s) from left to right'),
  },
  annotate: {
    name: _HKI('Annotate Schematic...'),
    tip: _HKI('Fill in schematic symbol reference designators'),
  },
  erc: {
    name: _HKI('Electrical Rules Checker'),
    tip: _HKI('Show the electrical rules checker window'),
  },
  simulator: {
    name: _HKI('Simulator'),
    tip: _HKI('Show simulation window for running SPICE or IBIS simulations.'),
  },
  assignFootprints: {
    name: _HKI('Assign Footprints...'),
    tip: _HKI('Run footprint assignment tool'),
  },
  editSymbolFields: {
    name: _HKI('Bulk Edit Symbol Fields...'),
    tip: _HKI('Edit a table of fields from all symbols in the schematic'),
  },
  bom: {
    name: _HKI('Generate Bill of Materials...'),
    tip: _HKI('Generate a bill of materials for the current schematic'),
  },
  showPcbNew: { name: _HKI('Switch to PCB Editor'), tip: _HKI('Open PCB in board editor') },
  toggleHiddenPins: { name: _HKI('Show Hidden Pins') },
  // All three share one FriendlyName upstream and differ only in .Tooltip().
  lineModeFree: {
    name: _HKI('Line Mode for Wires and Buses'),
    tip: _HKI('Draw and drag at any angle'),
  },
  lineMode90: {
    name: _HKI('Line Mode for Wires and Buses'),
    tip: _HKI('Constrain drawing and dragging to horizontal or vertical motions'),
  },
  lineMode45: {
    name: _HKI('Line Mode for Wires and Buses'),
    tip: _HKI('Constrain drawing and dragging to horizontal, vertical, or 45-degree angle motions'),
  },
  annotateAuto: {
    name: _HKI('Annotate Automatically'),
    tip: _HKI('Toggle automatic annotation of new symbols'),
  },
  showHierarchy: {
    name: _HKI('Hierarchy Navigator'),
    hotkey: 'Ctrl+H',
    tip: _HKI('Show/hide the schematic sheet hierarchy navigator'),
  },
  highlightNet: { name: _HKI('Highlight Nets'), tip: _HKI('Highlight wires and pins of a net') },
  placeSymbol: { name: _HKI('Place Symbols'), hotkey: 'A' },
  placePower: { name: _HKI('Place Power Symbols'), hotkey: 'P' },
  drawWire: { name: _HKI('Draw Wires'), hotkey: 'W' },
  drawBus: { name: _HKI('Draw Buses'), hotkey: 'B' },
  busEntry: { name: _HKI('Place Wire to Bus Entries'), hotkey: 'Z' },
  noConnect: { name: _HKI('Place No Connect Flags'), hotkey: 'Q' },
  junction: { name: _HKI('Place Junctions'), hotkey: 'J' },
  placeLabel: { name: _HKI('Place Net Labels'), hotkey: 'L' },
  placeClassLabel: { name: _HKI('Place Directive Labels') },
  placeGlobalLabel: { name: _HKI('Place Global Labels'), hotkey: 'Ctrl+L' },
  placeHierLabel: { name: _HKI('Place Hierarchical Labels'), hotkey: 'H' },
  drawRuleArea: { name: _HKI('Draw Rule Areas') },
  drawSheet: { name: _HKI('Draw Hierarchical Sheets'), hotkey: 'S' },
  sheetPin: {
    name: _HKI('Place Pins from Sheet'),
    tip: _HKI('Add sheet pins from existing hierarchical labels found on that sheet'),
  },
  syncAllSheetPins: {
    name: _HKI('Sync All Sheet Pins...'),
    tip: _HKI('Synchronize all sheet pins and hierarchical labels'),
  },
  placeText: { name: _HKI('Draw Text'), hotkey: 'T' },
  textBox: { name: _HKI('Draw Text Boxes') },
  table: { name: _HKI('Draw Tables') },
  rectangle: { name: _HKI('Draw Rectangles') },
  circle: { name: _HKI('Draw Circles') },
  arc: { name: _HKI('Draw Arcs') },
  bezier: { name: _HKI('Draw Bezier Curve') },
  lines: { name: _HKI('Draw Lines'), hotkey: 'I' },
  image: { name: _HKI('Place Images') },
};

/**
 * The `common/tool/actions.cpp` TOOL_ACTIONs that a toolbar reaches through a
 * MENU rather than through a button of its own.
 *
 * Every frame in the suite points at the one object — `ACTIONS::gridProperties`
 * is a single static — so the strings cannot differ between editors and must
 * not be written per editor. Looked up only when the app's own map has no entry
 * for the id, so an editor that gives an id its own meaning still wins.
 */
export const COMMON_TOOLBAR_ACTIONS: Readonly<Record<string, ToolbarAction>> = {
  // ---- the `common.*` actions, which every editor shares -----------------
  //
  // These were under `eeschema` and are `ACTIONS::` objects in
  // `common/tool/actions.cpp` — ONE TOOL_ACTION each, pointed at by every
  // frame's toolbar. Scoping them to one app is the drift the central-value
  // rule forbids, and it showed: the Symbol Editor's Toolbars page listed
  // "Toggle grid display" (the BUTTON's own title, the fallback) where KiCad
  // lists "Show Grid", because `TOOLBAR_ACTIONS['symbol_editor']` does not
  // exist and the lookup never reached here.
  // ---- common/tool/actions.cpp ------------------------------------------
  save: { name: 'Save', hotkey: 'Ctrl+S', tip: _HKI('Save changes') },
  pageSettings: {
    name: _HKI('Page Settings...'),
    tip: _HKI('Settings for paper size and title block info'),
  },
  print: { name: _HKI('Print...'), hotkey: 'Ctrl+P' },
  plot: { name: _HKI('Plot...') },
  paste: { name: 'Paste', hotkey: 'Ctrl+V', tip: _HKI('Paste item(s) from clipboard') },
  undo: { name: 'Undo', hotkey: 'Ctrl+Z' },
  // `#else` branch: Ctrl+Y off macOS (actions.cpp:292-302).
  redo: { name: 'Redo', hotkey: 'Ctrl+Y' },
  find: { name: 'Find', hotkey: 'Ctrl+F' },
  // `#else` branch: F5 off macOS (actions.cpp:705-716).
  zoomRedraw: { name: _HKI('Refresh'), hotkey: 'F5' },
  // The toolbar carries zoomInCenter / zoomOutCenter, which declare no hotkey;
  // F1 / F2 belong to ACTIONS::zoomIn / zoomOut, a different pair of actions.
  zoomIn: { name: 'Zoom In' },
  zoomOut: { name: 'Zoom Out' },
  zoomFitObjects: {
    name: _HKI('Zoom to All Objects'),
    hotkey: 'Ctrl+Home',
    tip: _HKI('Zoom to all objects on screen'),
  },
  zoomTool: {
    name: _HKI('Zoom to Selection Area'),
    hotkey: 'Ctrl+F5',
    tip: _HKI('Zoom to an area selection created by a mouse drag'),
  },
  group: {
    name: _HKI('Group Items'),
    tip: _HKI('Group the selected items so that they are treated as a single item'),
  },
  ungroup: { name: _HKI('Ungroup Items'), tip: _HKI('Ungroup any selected groups') },
  toggleGrid: { name: _HKI('Show Grid'), tip: _HKI('Display background grid in the edit window') },
  toggleGridOverrides: {
    name: _HKI('Grid Overrides'),
    hotkey: 'Ctrl+Shift+G',
    tip: _HKI('Enables item-specific grids that override the current grid'),
  },
  showProperties: { name: _HKI('Properties'), tip: _HKI('Show/hide the properties manager') },
  delete: { name: _HKI('Interactive Delete Tool'), tip: _HKI('Delete clicked items') },
  // actions.cpp:1095-1100. The FriendlyName is "Edit Grids...", NOT "Grid
  // Properties": the C++ identifier is `gridProperties` but the words the user
  // reads are not. `EDA_DRAW_FRAME::UpdateGridSelectBox` writes the same two
  // words as its own literal for the grid combo's last row
  // (`common/eda_draw_frame.cpp:466`) — upstream really does say it twice, and
  // ours transcribes the combo's copy separately in `ui/grid_settings.ts`.
  gridProperties: { name: _HKI('Edit Grids...'), tip: _HKI('Edit grid definitions') },
  // actions.cpp:1102-1107.
  gridOrigin: { name: _HKI('Grid Origin...'), tip: _HKI('Set the grid origin point') },
  // actions.cpp:968-973. No `.Tooltip()`, so the button gets no second line.
  showLibraryTree: { name: _HKI('Library Tree') },
  // The eeschema ones the Symbol Editor's left toolbar and its Toolbars page
  // both draw. They live here rather than under `symbol` because
  // `SCH_ACTIONS::showHiddenPins` and friends are one object shared by the
  // symbol editor and the symbol viewer, exactly as `showLibraryTree` is one
  // object shared by every frame with a tree.
  // sch_actions.cpp:307-313.
  showElectricalTypes: {
    name: _HKI('Show Pin Electrical Types'),
    tip: _HKI('Annotate pins with their electrical types'),
  },
  // sch_actions.cpp:347-352. No `.Tooltip()`.
  showHiddenPins: { name: _HKI('Show Hidden Pins') },
  // sch_actions.cpp:354-359. No `.Tooltip()`.
  showHiddenFields: { name: _HKI('Show Hidden Fields') },
};

/**
 * Keyed by app first, then by toolbar id.
 *
 * **A toolbar id is not globally unique, and the tooltip is where that bites.**
 * `placeText` is `SCH_ACTIONS::placeSchematicText` in eeschema — "Draw Text",
 * hotkey T — and `PCB_ACTIONS::placeText` in pcbnew — "Add Text",
 * Ctrl+Shift+T. A single flat map silently gave pcbnew's button eeschema's
 * name and key; the browser-reserved-combo test caught it, because
 * `Ctrl+Shift+T` vanished from the inventory.
 *
 * `toolbar_bitmaps.ts` gets away with one flat map because the two actions
 * happen to wear the same icon. Tooltips are not so lucky, so this is keyed the
 * way `ui/hotkey_apps.ts` already keys its registries.
 *
 * Only eeschema is transcribed so far. An app with no entry, or an id not in
 * its entry, falls back to the button's own `title`, so every other editor is
 * unaffected until its toolbars are transcribed too.
 */
export const TOOLBAR_ACTIONS: Readonly<Record<string, Readonly<Record<string, ToolbarAction>>>> = {
  eeschema: EESCHEMA_TOOLBAR_ACTIONS,
};

/**
 * A button's tooltip: `GetButtonTooltip()` for an id this app has transcribed,
 * else whatever the button already said.
 *
 * The fallback is what lets the mechanism land for every editor at once without
 * rewriting five toolbar inventories in one change.
 */
export function toolbarButtonTooltip(
  app: string | undefined,
  id: string,
  fallback?: string,
): string {
  // Through `actionFor` for the same reason the label is: half these ids are
  // `ACTIONS::` objects living in `COMMON_TOOLBAR_ACTIONS`, and looking only at
  // the app's own table drops the tooltip for every one of them.
  const a = actionFor(app, id);
  // An untranscribed button's own `title` is English too, joined the way GetButtonTooltip
  // joins it - name, hotkey, then the tooltip on a second line - so it is read line by line.
  if (!a) return translateTooltip(fallback ?? '');
  return buttonTooltipFor(a.name, a.hotkey, a.tip);
}

/**
 * The single-line label for `aria-label`, where a tab and a newline would be
 * read aloud as punctuation. `GetFriendlyName()` alone, which is the name a
 * screen reader wants.
 */
export function toolbarButtonLabel(app: string | undefined, id: string, fallback?: string): string {
  // Through `actionFor`, so `COMMON_TOOLBAR_ACTIONS` is behind the app's own
  // table. `toggleGrid` is `common.Control.toggleGrid` and its FriendlyName is
  // "Show Grid"; looking only at `TOOLBAR_ACTIONS[app]` missed it and fell
  // through to the button's `title`, which is why the Toolbars page listed
  // "Toggle grid display" where KiCad lists "Show Grid".
  const a = actionFor(app, id);
  // An untranscribed button's own `title` is joined like GetButtonTooltip: read line by line.
  return a ? _(a.name) : translateTooltip(fallback ?? '');
}

/**
 * The TOOL_ACTION behind an id, for the call sites that are not buttons.
 *
 * A toolbar BUTTON deliberately falls back to its own `title` when the app has
 * not been transcribed, so an untranscribed editor keeps working; a MENU row
 * has no such fallback to offer, and its label has to come from the action or
 * not exist. So this is the lookup with `COMMON_TOOLBAR_ACTIONS` behind it and
 * no per-call-site string in the way.
 */
export function actionFor(app: string | undefined, id: string): ToolbarAction | undefined {
  return (app ? TOOLBAR_ACTIONS[app]?.[id] : undefined) ?? COMMON_TOOLBAR_ACTIONS[id];
}

/**
 * A menu row's label — `TOOL_ACTION::GetMenuItem()`, which is what
 * `ACTION_MENU::Add( const TOOL_ACTION& )` puts on the item
 * (`common/tool/action_menu.cpp:186-189`).
 *
 * Falls back to the id itself rather than to an empty row, so a menu that names
 * an untranscribed action is visibly wrong instead of silently blank.
 */
export function toolbarActionMenuLabel(app: string | undefined, id: string): string {
  return actionFor(app, id)?.name ?? id;
}

/**
 * A menu row's help string — `aAction.GetTooltip()`, the third argument to the
 * `wxMenuItem` `ACTION_MENU::Add` builds (`action_menu.cpp:188`). Empty when
 * the action declares no `.Tooltip()`, which is how upstream leaves it too.
 */
export function toolbarActionTooltip(app: string | undefined, id: string): string {
  return actionFor(app, id)?.tip ?? '';
}
