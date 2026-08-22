// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB editor toolbar layouts, transcribed from KiCad pcbnew's
 * `toolbars_pcb_editor.cpp` (PCB_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig,
 * TOOLBAR_LOC::LEFT / RIGHT / TOP_MAIN). Separators mirror AppendSeparator;
 * AppendGroup entries become ToolGroup palette buttons (ACTION_TOOLBAR
 * groups: one button showing the selected action, long-press for the rest).
 */

import type { ToolEntry } from '../../ui/toolbar_types.js';

const sep: ToolEntry = 'sep';

/**
 * Not yet implemented in the web canvas, shown greyed in its upstream
 * position (repo convention) until each tool is ported end-to-end.
 */
const todo = { disabled: true } as const;

/**
 * The `AppendControl` slots. The frame supplies each widget through
 * `Toolbar`'s `controls` prop, exactly as KiCad registers a factory per
 * control with `RegisterCustomToolbarControlFactory`
 * (`toolbars_pcb_editor.cpp:417,434,453` and `eda_draw_frame.cpp:233,256`).
 */
export const PCB_CONTROL = {
  currentVariant: 'currentVariant',
  trackWidth: 'trackWidth',
  viaDiameter: 'viaDiameter',
  layerSelector: 'layerSelector',
  gridSelect: 'gridSelect',
  zoomSelect: 'zoomSelect',
  overrideLocks: 'overrideLocks',
} as const;

/** TOP_MAIN toolbar. */
export const PCB_TOP_TOOLBAR: ToolEntry[] = [
  // doNew/open appear only when Kiface().IsSingle(), standalone pcbnew. This
  // editor is project-hosted (KiCad project mode), so they are not shown.
  { id: 'save', icon: 'save', title: 'Save' },
  sep,
  { id: 'boardSetup', icon: 'boardSetup', title: 'Board setup' },
  sep,
  { id: 'pageSettings', icon: 'pageSettings', title: 'Page settings' },
  { id: 'print', icon: 'print', title: 'Print' },
  { id: 'plot', icon: 'plot', title: 'Plot' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  { id: 'find', icon: 'find', title: 'Find' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit board' },
  { id: 'zoomFitObjects', icon: 'zoomFitObjects', title: 'Zoom to fit objects' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate counterclockwise' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate clockwise' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror vertically' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror horizontally' },
  // Only Group / Ungroup live on the toolbar (toolbars_pcb_editor.cpp); Add to
  // Group / Remove from Group are right-click-only (GROUP_CONTEXT_MENU).
  { id: 'group', icon: 'group', title: 'Group items' },
  { id: 'ungroup', icon: 'ungroup', title: 'Ungroup items' },
  { id: 'lock', icon: 'lock', title: 'Lock' },
  { id: 'unlock', icon: 'unlock', title: 'Unlock' },
  sep,
  { id: 'footprintEditor', icon: 'footprintEditor', title: 'Footprint Editor' },
  { id: 'footprintBrowser', icon: 'footprintBrowser', title: 'Footprint Library Browser' },
  { id: 'threeDViewer', icon: 'threeDViewer', title: '3D Viewer' },
  sep,
  { id: 'updatePcbFromSch', icon: 'updatePcbFromSch', title: 'Update PCB from schematic' },
  { id: 'runDRC', icon: 'runDRC', title: 'Design Rules Checker' },
  sep,
  { id: 'showEeschema', icon: 'showEeschema', title: 'Open schematic in Schematic Editor' },
  // `AppendControl( PCB_ACTION_TOOLBAR_CONTROLS::currentVariant )`
  // (`toolbars_pcb_editor.cpp:360`), a wxChoice with no separator before it.
  // A comment here used to claim the editor rendered this as the toolbar's
  // trailing control; it passed no such prop and the dropdown was simply absent.
  { control: PCB_CONTROL.currentVariant },
  // `AppendControl( ACTION_TOOLBAR_CONTROLS::ipcScripting )` (`:361`) follows,
  // and renders NOTHING here. Its factory (`:458-484`) emits a separator and
  // PCB_ACTIONS::showPythonConsole only `if( scriptingAvailable ||
  // haveApiPlugins )`, where scriptingAvailable is `SCRIPTING::IsWxAvailable()`.
  // A desktop KiCad built with wxPython shows the console button; a build
  // without it ends the bar here, and so does a browser port with neither
  // wxPython nor an IPC plugin manager. This is the branch, not an omission.
];

/**
 * TOP_AUX toolbar (`toolbars_pcb_editor.cpp:365-386`): five controls, two
 * actions and five separators. This is a real toolbar upstream — an
 * `ACTION_TOOLBAR` docked at `.Top().Layer(5)` — not a strip of loose widgets.
 */
export const PCB_AUX_TOOLBAR: ToolEntry[] = [
  { control: PCB_CONTROL.trackWidth },
  {
    id: 'autoTrackWidth',
    icon: 'autoTrackWidth',
    title:
      'Automatically select track width\nWhen routing from an existing track use its width instead of the current width setting',
    toggle: true,
    ...todo,
  },
  sep,
  { control: PCB_CONTROL.viaDiameter },
  sep,
  { control: PCB_CONTROL.layerSelector },
  {
    id: 'selectLayerPair',
    icon: 'selectLayerPair',
    title: 'Set Layer Pair...\nChange active layer pair for routing',
    ...todo,
  },
  sep,
  { control: PCB_CONTROL.gridSelect },
  sep,
  { control: PCB_CONTROL.zoomSelect },
  sep,
  { control: PCB_CONTROL.overrideLocks },
];

/** LEFT (view options) toolbar. */
export const PCB_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Show grid', toggle: true },
  {
    id: 'toggleGridOverrides',
    icon: 'toggleGridOverrides',
    title: 'Toggle grid overrides',
    toggle: true,
  },
  {
    id: 'togglePolarCoords',
    icon: 'togglePolarCoords',
    title: 'Display polar coordinates',
    toggle: true,
  },
  // None of these nine actions is a toggle upstream, so none of the three
  // group buttons can ever paint checked — they cycle and light only on hover.
  // `millimetersUnits` / `inchesUnits` / `milsUnits` (`actions.cpp:1113-1131`),
  // `cursorSmallCrosshairs` / `cursorFullCrosshairs` / `cursor45Crosshairs`
  // (`:1182-1201`) and `lineModeFree` / `lineMode90` / `lineMode45`
  // (`pcb_actions.cpp:1501-1520`) all declare `.Flags( AF_NONE )` and no
  // `ToolbarState`, so `AddGroup`'s `isToggleEntry` is false and the item is
  // wxITEM_NORMAL. The tool groups further down — selection modes, routing,
  // tuning — are the opposite case and DO stay lit, because their actions
  // declare `TOOLBAR_STATE::TOGGLE`.
  {
    group: 'Units',
    cycleOnClick: true,
    actions: [
      { id: 'unitsMm', icon: 'unitsMm', title: 'Units in millimetres' },
      { id: 'unitsInches', icon: 'unitsInches', title: 'Units in inches' },
      { id: 'unitsMils', icon: 'unitsMils', title: 'Units in mils' },
    ],
  },
  {
    group: 'Crosshair modes',
    cycleOnClick: true,
    actions: [
      { id: 'crosshairSmall', icon: 'crosshairSmall', title: 'Small crosshairs' },
      { id: 'crosshairFull', icon: 'crosshairFull', title: 'Full-window crosshairs' },
      { id: 'crosshair45', icon: 'crosshair45', title: '45° crosshairs' },
    ],
  },
  sep,
  {
    group: 'Line modes',
    cycleOnClick: true,
    actions: [
      { id: 'lineModeFree', icon: 'lineModeFree', title: 'Line mode: free angle' },
      { id: 'lineMode90', icon: 'lineMode90', title: 'Line mode: 90°' },
      { id: 'lineMode45', icon: 'lineMode45', title: 'Line mode: 45°' },
    ],
  },
  sep,
  { id: 'showRatsnest', icon: 'showRatsnest', title: 'Show ratsnest', toggle: true },
  {
    id: 'ratsnestLineMode',
    icon: 'ratsnestLineMode',
    title: 'Curved ratsnest lines',
    toggle: true,
  },
  sep,
  { id: 'highContrast', icon: 'highContrast', title: 'High-contrast display mode', toggle: true },
  {
    id: 'toggleNetHighlight',
    icon: 'toggleNetHighlight',
    title: 'Toggle net highlighting',
    toggle: true,
  },
  sep,
  {
    id: 'zoneDisplayFilled',
    icon: 'zoneDisplayFilled',
    title: 'Show filled areas of zones',
    toggle: true,
  },
  {
    id: 'zoneDisplayOutline',
    icon: 'zoneDisplayOutline',
    title: 'Show only zone boundaries',
    toggle: true,
  },
  sep,
  { id: 'padDisplayMode', icon: 'padDisplayMode', title: 'Sketch pads', toggle: true },
  { id: 'viaDisplayMode', icon: 'viaDisplayMode', title: 'Sketch vias', toggle: true },
  { id: 'trackDisplayMode', icon: 'trackDisplayMode', title: 'Sketch tracks', toggle: true },
  sep,
  {
    id: 'showLayersManager',
    icon: 'showLayersManager',
    title: 'Show Appearance manager',
    toggle: true,
  },
  { id: 'showProperties', icon: 'showProperties', title: 'Show Properties panel', toggle: true },
];

/**
 * RIGHT (tools) toolbar. Entries and grouping transcribed 1:1 from
 * PCB_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig, TOOLBAR_LOC::RIGHT.
 * Titles are TOOL_ACTION::GetButtonTooltip(): friendly name, default
 * hotkey in parentheses, then the tooltip line.
 */
export const PCB_RIGHT_TOOLBAR: ToolEntry[] = [
  {
    group: 'Selection modes',
    actions: [
      {
        id: 'selectSetRect',
        icon: 'selectSetRect',
        title: 'Rectangle\nSet selection mode to use rectangle',
      },
      {
        id: 'selectSetLasso',
        icon: 'selectSetLasso',
        title: 'Lasso\nSet selection mode to use polygon lasso',
        ...todo,
      },
    ],
  },
  {
    id: 'localRatsnestTool',
    icon: 'localRatsnestTool',
    title: 'Local Ratsnest\nToggle ratsnest display of selected item(s)',
  },
  sep,
  { id: 'placeFootprint', icon: 'placeFootprint', title: 'Place Footprints (A)', ...todo },
  {
    group: 'Track routing tools',
    actions: [
      {
        id: 'routeSingleTrack',
        icon: 'routeSingleTrack',
        title: 'Route Single Track (X)\nRoute tracks',
      },
      {
        id: 'routeDiffPair',
        icon: 'routeDiffPair',
        title: 'Route Differential Pair (6)\nRoute differential pairs',
        ...todo,
      },
    ],
  },
  {
    group: 'Track tuning tools',
    actions: [
      {
        id: 'tuneSingleTrack',
        icon: 'tuneSingleTrack',
        title: 'Tune Length of a Single Track (7)',
        ...todo,
      },
      {
        id: 'tuneDiffPair',
        icon: 'tuneDiffPair',
        title: 'Tune Length of a Differential Pair (8)',
        ...todo,
      },
      { id: 'tuneSkew', icon: 'tuneSkew', title: 'Tune Skew of a Differential Pair (9)', ...todo },
    ],
  },
  {
    id: 'drawVia',
    icon: 'drawVia',
    title: 'Place Vias (Ctrl+Shift+X)\nPlace free-standing vias',
  },
  { id: 'drawZone', icon: 'drawZone', title: 'Draw Filled Zones (Ctrl+Shift+Z)' },
  { id: 'drawRuleArea', icon: 'drawRuleArea', title: 'Draw Rule Areas (Ctrl+Shift+K)', ...todo },
  sep,
  { id: 'drawLine', icon: 'drawLine', title: 'Draw Lines (Ctrl+Shift+L)' },
  { id: 'drawArc', icon: 'drawArc', title: 'Draw Arcs (Ctrl+Shift+A)' },
  { id: 'drawRectangle', icon: 'drawRectangle', title: 'Draw Rectangles' },
  { id: 'drawCircle', icon: 'drawCircle', title: 'Draw Circles (Ctrl+Shift+C)' },
  { id: 'drawPolygon', icon: 'drawPolygon', title: 'Draw Polygons (Ctrl+Shift+P)' },
  { id: 'drawBezier', icon: 'drawBezier', title: 'Draw Bezier Curve (Ctrl+Shift+B)', ...todo },
  {
    id: 'placeReferenceImage',
    icon: 'placeReferenceImage',
    title:
      'Place Reference Images\nAdd bitmap images to be used as reference (images will not be included in any output)',
  },
  { id: 'placeText', icon: 'placeText', title: 'Draw Text (Ctrl+Shift+T)' },
  { id: 'drawTextBox', icon: 'drawTextBox', title: 'Draw Text Boxes' },
  { id: 'drawTable', icon: 'drawTable', title: 'Draw Tables' },
  {
    group: 'Dimension objects',
    actions: [
      {
        id: 'drawOrthogonalDimension',
        icon: 'drawOrthogonalDimension',
        title: 'Draw Orthogonal Dimensions (Ctrl+Shift+H)',
      },
      {
        id: 'drawAlignedDimension',
        icon: 'drawAlignedDimension',
        title: 'Draw Aligned Dimensions',
      },
      {
        id: 'drawCenterDimension',
        icon: 'drawCenterDimension',
        title: 'Draw Center Dimensions',
      },
      {
        id: 'drawRadialDimension',
        icon: 'drawRadialDimension',
        title: 'Draw Radial Dimensions',
      },
      { id: 'drawLeader', icon: 'drawLeader', title: 'Draw Leaders' },
    ],
  },
  { id: 'placeBarcode', icon: 'placeBarcode', title: 'Add Barcode\nAdd a barcode', ...todo },
  { id: 'deleteTool', icon: 'deleteTool', title: 'Interactive Delete Tool\nDelete clicked items' },
  sep,
  {
    group: 'PCB origins and points',
    actions: [
      {
        id: 'gridSetOrigin',
        icon: 'gridSetOrigin',
        title: 'Grid Origin\nPlace the grid origin point',
        ...todo,
      },
      {
        id: 'drillOrigin',
        icon: 'drillOrigin',
        title:
          'Drill/Place File Origin\nPlace origin point for drill files and component placement files',
        ...todo,
      },
    ],
  },
  {
    id: 'placePoint',
    icon: 'placePoint',
    title: 'Place Point\nAdd reference/snap points',
    ...todo,
  },
  {
    id: 'measureTool',
    icon: 'measureTool',
    title: 'Measure Tool (Ctrl+Shift+M)\nInteractively measure distance between points',
  },
];

/**
 * Selection Filter categories, transcribed from pcbnew
 * panel_selection_filter_base.cpp. Rendered two columns row-major with the
 * "All items" checkbox occupying cell (0,0), which reproduces the exact
 * wxGridBagSizer positions: Locked items (0,1), Footprints (1,0), Text (1,1),
 * Tracks (2,0), Vias (2,1), Pads (3,0), Graphics (3,1), Zones (4,0),
 * Rule Areas (4,1), Dimensions (5,0), Other items (5,1), Points (6,0).
 * Keys follow PCB_SELECTION_FILTER_OPTIONS member names.
 */
export const PCB_FILTER_CATS: { key: string; label: string; tooltip?: string }[] = [
  { key: 'lockedItems', label: 'Locked items', tooltip: 'Allow selection of locked items' },
  { key: 'footprints', label: 'Footprints' },
  { key: 'text', label: 'Text' },
  { key: 'tracks', label: 'Tracks' },
  { key: 'vias', label: 'Vias' },
  { key: 'pads', label: 'Pads' },
  { key: 'graphics', label: 'Graphics' },
  { key: 'zones', label: 'Zones' },
  { key: 'keepouts', label: 'Rule Areas' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'otherItems', label: 'Other items' },
  { key: 'points', label: 'Points' },
];
