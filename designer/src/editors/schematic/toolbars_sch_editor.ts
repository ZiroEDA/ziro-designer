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
  { id: 'save', icon: 'save', title: 'Save (Ctrl+S)' },
  sep,
  { id: 'schematicSetup', icon: 'setup', title: 'Schematic Setup...' },
  sep,
  { id: 'pageSettings', icon: 'page', title: 'Page Settings...' },
  { id: 'print', icon: 'print', title: 'Print... (Ctrl+P)' },
  { id: 'plot', icon: 'plot', title: 'Plot...' },
  sep,
  { id: 'paste', icon: 'paste', title: 'Paste (Ctrl+V)' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo (Ctrl+Z)' },
  { id: 'redo', icon: 'redo', title: 'Redo (Ctrl+Shift+Z)' },
  sep,
  { id: 'find', icon: 'find', title: 'Find (Ctrl+F)' },
  { id: 'findReplace', icon: 'replace', title: 'Find and Replace (Ctrl+Alt+F)' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh (Ctrl+R)' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom In' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom Out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to Fit (Home)' },
  { id: 'zoomFitObjects', icon: 'zoomFitObjects', title: 'Zoom to All Objects (Ctrl+Home)' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to Selection Area (Ctrl+F5)' },
  sep,
  { id: 'navBack', icon: 'navBack', title: 'Navigate Back (Alt+Left)' },
  { id: 'navUp', icon: 'navUp', title: 'Navigate Up (Alt+Up)' },
  { id: 'navFwd', icon: 'navFwd', title: 'Navigate Forward (Alt+Right)' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate Counterclockwise (R)' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate Clockwise (Shift+R)' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror Vertically (Y)' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror Horizontally (X)' },
  // Only Group / Ungroup live on the toolbar (toolbars_sch_editor.cpp); Add to
  // Group / Remove from Group are right-click-only (GROUP_CONTEXT_MENU).
  { id: 'group', icon: 'group', title: 'Group Items' },
  { id: 'ungroup', icon: 'ungroup', title: 'Ungroup Items' },
  sep,
  { id: 'symbolEditor', icon: 'symbolEditor', title: 'Symbol Editor' },
  { id: 'symbolBrowser', icon: 'symbolBrowser', title: 'Symbol Library Browser' },
  { id: 'footprintEditor', icon: 'footprintEditor', title: 'Footprint Editor' },
  sep,
  { id: 'annotate', icon: 'annotate', title: 'Annotate Schematic...' },
  { id: 'erc', icon: 'erc', title: 'Electrical Rules Checker' },
  { id: 'simulator', icon: 'simulator', title: 'Simulator', disabled: true },
  { id: 'assignFootprints', icon: 'assignFp', title: 'Assign Footprints...' },
  { id: 'editSymbolFields', icon: 'fields', title: 'Bulk Edit Symbol Fields...' },
  { id: 'bom', icon: 'bom', title: 'Generate Bill of Materials...' },
  sep,
  { id: 'showPcbNew', icon: 'showPcbNew', title: 'Switch to PCB Editor' },
];

/** Left vertical toolbar (TOOLBAR_LOC::LEFT, display/edit option toggles). */
export const LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'grid', title: 'Show Grid', toggle: true },
  {
    id: 'toggleGridOverrides',
    icon: 'gridOverride',
    title: 'Grid Overrides (Ctrl+Shift+G)',
    toggle: true,
  },
  // TOOLBAR_GROUP_CONFIG entries render as one button + long-press palette
  // (ACTION_TOOLBAR); group titles as in SCH_EDIT_TOOLBAR_SETTINGS.
  {
    group: 'Units',
    cycleOnClick: true,
    actions: [
      { id: 'unitsInches', icon: 'unitIn', title: 'Inches', toggle: true },
      { id: 'unitsMils', icon: 'unitMils', title: 'Mils', toggle: true },
      { id: 'unitsMm', icon: 'unitMm', title: 'Millimeters', toggle: true },
    ],
  },
  {
    group: 'Crosshair modes',
    cycleOnClick: true,
    actions: [
      { id: 'crosshairSmall', icon: 'crosshairSmall', title: 'Small crosshairs', toggle: true },
      { id: 'crosshairFull', icon: 'crosshairFull', title: 'Full-Window Crosshairs', toggle: true },
      { id: 'crosshair45', icon: 'crosshair45', title: '45 Degree Crosshairs', toggle: true },
    ],
  },
  sep,
  { id: 'toggleHiddenPins', icon: 'hiddenPins', title: 'Show Hidden Pins', toggle: true },
  sep,
  {
    group: 'Line modes',
    cycleOnClick: true,
    actions: [
      {
        id: 'lineModeFree',
        icon: 'lineFree',
        title: 'Line Mode for Wires and Buses: free angle',
        toggle: true,
      },
      {
        id: 'lineMode90',
        icon: 'line90',
        title: 'Line Mode for Wires and Buses: 90°',
        toggle: true,
      },
      {
        id: 'lineMode45',
        icon: 'line45',
        title: 'Line Mode for Wires and Buses: 45°',
        toggle: true,
      },
    ],
  },
  sep,
  { id: 'annotateAuto', icon: 'annotateAuto', title: 'Annotate Automatically', toggle: true },
  sep,
  { id: 'showHierarchy', icon: 'hierarchy', title: 'Hierarchy Navigator (Ctrl+H)', toggle: true },
  { id: 'showProperties', icon: 'properties', title: 'Properties', toggle: true },
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
      { id: 'select', icon: 'selectRect', title: 'Select item(s): Rectangle' },
      { id: 'selectLasso', icon: 'selectLasso', title: 'Select item(s): Lasso' },
    ],
  },
  { id: 'highlightNet', icon: 'highlightNet', title: 'Highlight Nets' },
  sep,
  { id: 'placeSymbol', icon: 'symbol', title: 'Place Symbols (A)' },
  { id: 'placePower', icon: 'power', title: 'Place Power Symbols (P)' },
  { id: 'drawWire', icon: 'wire', title: 'Draw Wires (W)' },
  { id: 'drawBus', icon: 'bus', title: 'Draw Buses (B)' },
  { id: 'busEntry', icon: 'busEntry', title: 'Place Wire to Bus Entries (Z)' },
  { id: 'noConnect', icon: 'noConnect', title: 'Place No Connect Flags (Q)' },
  { id: 'junction', icon: 'junction', title: 'Place Junctions (J)' },
  {
    group: 'Labels',
    actions: [
      { id: 'placeLabel', icon: 'labelLocal', title: 'Place Net Labels (L)' },
      { id: 'placeClassLabel', icon: 'labelClass', title: 'Place Directive Labels' },
      { id: 'placeGlobalLabel', icon: 'labelGlobal', title: 'Place Global Labels (Ctrl+L)' },
      { id: 'placeHierLabel', icon: 'labelHier', title: 'Place Hierarchical Labels (H)' },
    ],
  },
  { id: 'drawRuleArea', icon: 'ruleArea', title: 'Draw Rule Areas' },
  { id: 'drawSheet', icon: 'sheet', title: 'Draw Hierarchical Sheets (S)' },
  { id: 'sheetPin', icon: 'sheetPin', title: 'Place Pins from Sheet' },
  // The id has to be the one `onTopAction` dispatches on — it was
  // `syncAllSheetsPins` here and `syncAllSheetPins` in the handler, so the
  // button could never have worked even had it been enabled. The dialog it
  // opens has been implemented all along; only this button was held back.
  { id: 'syncAllSheetPins', icon: 'syncSheetPins', title: 'Sync All Sheet Pins...' },
  sep,
  // toolbars_sch_editor.cpp:136-145 appends every one of these with a plain
  // `AppendAction`. There is no TOOLBAR_GROUP_CONFIG anywhere on this stretch
  // of the bar, so no triangle and no palette: ten flat buttons.
  //
  // Ours had three groups here that upstream does not have — "Text objects"
  // (Text + Text Box), "Circle" (Circle + Ellipse) and "Arc" (Arc + Elliptical
  // Arc) — which showed three buttons where KiCad shows seven, each wearing a
  // triangle KiCad never draws.
  { id: 'placeText', icon: 'text', title: 'Draw Text (T)' },
  { id: 'textBox', icon: 'textBox', title: 'Draw Text Boxes' },
  { id: 'table', icon: 'table', title: 'Draw Tables' },
  { id: 'rectangle', icon: 'rectangle', title: 'Draw Rectangles' },
  { id: 'circle', icon: 'circle', title: 'Draw Circles' },
  { id: 'arc', icon: 'arc', title: 'Draw Arcs' },
  { id: 'bezier', icon: 'bezier', title: 'Draw Bezier Curve' },
  { id: 'lines', icon: 'lines', title: 'Draw Lines (I)' },
  { id: 'image', icon: 'image', title: 'Place Images' },
  { id: 'delete', icon: 'delete', title: 'Interactive Delete Tool' },
];
