// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic editor toolbar layouts. Counterpart: `eeschema/
 * toolbars_sch_editor.cpp` (SCH_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig),
 * transcribed exactly for the project-manager case (our editors always live
 * under the launcher, like KiCad frames under the project manager, so no
 * New/Open on the top toolbar). Separators mark AppendSeparator groups;
 * TOOLBAR_GROUP_CONFIG entries render as ACTION_GROUP buttons, one visible
 * action with a corner triangle, long-press (or click, for option radio
 * groups) opening the palette with the rest.
 *
 * Titles are the upstream action FriendlyNames with the default hotkey in
 * parentheses, matching KiCad's tooltips. Buttons whose feature is not
 * implemented yet are `disabled` (greyed in place, like the menu bar).
 */

import type { ToolEntry } from '../../ui/toolbar_types.js';

const sep: ToolEntry = 'sep';

/** Top horizontal toolbar (TOOLBAR_LOC::TOP_MAIN). */
export const TOP_TOOLBAR: ToolEntry[] = [
  { id: 'save', icon: 'save' },
  sep,
  { id: 'schematicSetup', icon: 'setup' },
  sep,
  { id: 'pageSettings', icon: 'page' },
  { id: 'print', icon: 'print' },
  { id: 'plot', icon: 'plot' },
  sep,
  { id: 'paste', icon: 'paste' },
  sep,
  { id: 'undo', icon: 'undo' },
  { id: 'redo', icon: 'redo' },
  sep,
  { id: 'find', icon: 'find' },
  { id: 'findReplace', icon: 'replace' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw' },
  { id: 'zoomIn', icon: 'zoomIn' },
  { id: 'zoomOut', icon: 'zoomOut' },
  { id: 'zoomFit', icon: 'zoomFit' },
  { id: 'zoomFitObjects', icon: 'zoomFitObjects' },
  { id: 'zoomTool', icon: 'zoomTool' },
  sep,
  { id: 'navBack', icon: 'navBack' },
  { id: 'navUp', icon: 'navUp' },
  { id: 'navFwd', icon: 'navFwd' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW' },
  { id: 'rotateCW', icon: 'rotateCW' },
  { id: 'mirrorV', icon: 'mirrorV' },
  { id: 'mirrorH', icon: 'mirrorH' },
  // Only Group / Ungroup live on the toolbar (toolbars_sch_editor.cpp); Add to
  // Group / Remove from Group are right-click-only (GROUP_CONTEXT_MENU).
  { id: 'group', icon: 'group' },
  { id: 'ungroup', icon: 'ungroup' },
  sep,
  { id: 'symbolEditor', icon: 'symbolEditor' },
  { id: 'symbolBrowser', icon: 'symbolBrowser' },
  { id: 'footprintEditor', icon: 'footprintEditor' },
  sep,
  { id: 'annotate', icon: 'annotate' },
  { id: 'erc', icon: 'erc' },
  { id: 'simulator', icon: 'simulator', disabled: true },
  { id: 'assignFootprints', icon: 'assignFp' },
  { id: 'editSymbolFields', icon: 'fields' },
  { id: 'bom', icon: 'bom' },
  sep,
  { id: 'showPcbNew', icon: 'showPcbNew' },
];

/** Left vertical toolbar (TOOLBAR_LOC::LEFT, display/edit option toggles). */
export const LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'grid', toggle: true },
  {
    id: 'toggleGridOverrides',
    icon: 'gridOverride',
    toggle: true,
  },
  // TOOLBAR_GROUP_CONFIG entries render as one button + long-press palette
  // (ACTION_TOOLBAR); group titles as in SCH_EDIT_TOOLBAR_SETTINGS.
  //
  // No `toggle` on a group member, here or anywhere: whether a group button can
  // paint checked is `isToggleEntry` in `ACTION_TOOLBAR::AddGroup`, an OR over
  // the ACTIONS' own `TOOLBAR_STATE::TOGGLE`, and that lives once in
  // `ui/toolbar_action_state.ts`. These nine rows carried `toggle: true` while
  // the seven other editors' copies of the SAME actions did not, which is how
  // the schematic editor alone drew a permanently lit "mil" button.
  {
    group: 'Units',
    cycleOnClick: true,
    actions: [
      { id: 'unitsInches', icon: 'unitIn' },
      { id: 'unitsMils', icon: 'unitMils' },
      { id: 'unitsMm', icon: 'unitMm' },
    ],
  },
  {
    group: 'Crosshair modes',
    cycleOnClick: true,
    actions: [
      { id: 'crosshairSmall', icon: 'crosshairSmall' },
      { id: 'crosshairFull', icon: 'crosshairFull' },
      { id: 'crosshair45', icon: 'crosshair45' },
    ],
  },
  sep,
  { id: 'toggleHiddenPins', icon: 'hiddenPins', toggle: true },
  sep,
  {
    group: 'Line modes',
    cycleOnClick: true,
    actions: [
      { id: 'lineModeFree', icon: 'lineFree' },
      { id: 'lineMode90', icon: 'line90' },
      { id: 'lineMode45', icon: 'line45' },
    ],
  },
  sep,
  { id: 'annotateAuto', icon: 'annotateAuto', toggle: true },
  sep,
  { id: 'showHierarchy', icon: 'hierarchy', toggle: true },
  { id: 'showProperties', icon: 'properties', toggle: true },
];

/** Right vertical toolbar (TOOLBAR_LOC::RIGHT, drawing/placement tools). */
/**
 * Right-toolbar ids that are commands, not tools.
 *
 * Everything else on this toolbar is an AF_ACTIVATE placement tool: clicking it
 * arms a cursor and the next click on the canvas does the work. Sync All Sheet
 * Pins is not one of those — `SCH_DRAWING_TOOLS::SyncAllSheetsPins` collects
 * the sheet paths, opens `DIALOG_SYNC_SHEET_PINS` and returns 0 without ever
 * entering a tool loop:
 *
 *     if( sheetPaths.size() == 0 ) { … ShowInfoBarMsg( … ); return 0; }
 *     return doSyncSheetsPins( std::move( sheetPaths ), selectedSheet );
 *
 * Routing it through the tool selector instead set `activeTool` to an id no
 * tool answers to, which is why it changed the cursor and opened nothing.
 */
export const RIGHT_TOOLBAR_COMMANDS: ReadonlySet<string> = new Set(['syncAllSheetPins']);

export const RIGHT_TOOLBAR: ToolEntry[] = [
  {
    group: 'Selection modes',
    actions: [
      { id: 'select', icon: 'selectRect' },
      { id: 'selectLasso', icon: 'selectLasso' },
    ],
  },
  { id: 'highlightNet', icon: 'highlightNet' },
  sep,
  { id: 'placeSymbol', icon: 'symbol' },
  { id: 'placePower', icon: 'power' },
  { id: 'drawWire', icon: 'wire' },
  { id: 'drawBus', icon: 'bus' },
  { id: 'busEntry', icon: 'busEntry' },
  { id: 'noConnect', icon: 'noConnect' },
  { id: 'junction', icon: 'junction' },
  {
    group: 'Labels',
    actions: [
      { id: 'placeLabel', icon: 'labelLocal' },
      { id: 'placeClassLabel', icon: 'labelClass' },
      { id: 'placeGlobalLabel', icon: 'labelGlobal' },
      { id: 'placeHierLabel', icon: 'labelHier' },
    ],
  },
  { id: 'drawRuleArea', icon: 'ruleArea' },
  { id: 'drawSheet', icon: 'sheet' },
  { id: 'sheetPin', icon: 'sheetPin' },
  // The id has to be the one `onTopAction` dispatches on — it was
  // `syncAllSheetsPins` here and `syncAllSheetPins` in the handler, so the
  // button could never have worked even had it been enabled. The dialog it
  // opens has been implemented all along; only this button was held back.
  { id: 'syncAllSheetPins', icon: 'syncSheetPins' },
  sep,
  // toolbars_sch_editor.cpp:136-145 appends every one of these with a plain
  // `AppendAction`. There is no TOOLBAR_GROUP_CONFIG anywhere on this stretch
  // of the bar, so no triangle and no palette: ten flat buttons.
  //
  // Ours had three groups here that upstream does not have — "Text objects"
  // (Text + Text Box), "Circle" (Circle + Ellipse) and "Arc" (Arc + Elliptical
  // Arc) — which showed three buttons where KiCad shows seven, each wearing a
  // triangle KiCad never draws.
  { id: 'placeText', icon: 'text' },
  { id: 'textBox', icon: 'textBox' },
  { id: 'table', icon: 'table' },
  { id: 'rectangle', icon: 'rectangle' },
  { id: 'circle', icon: 'circle' },
  { id: 'arc', icon: 'arc' },
  { id: 'bezier', icon: 'bezier' },
  { id: 'lines', icon: 'lines' },
  { id: 'image', icon: 'image' },
  { id: 'delete', icon: 'delete' },
];
