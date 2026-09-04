// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint editor toolbar layouts, transcribed from KiCad pcbnew's
 * `toolbars_footprint_editor.cpp`
 * (FOOTPRINT_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig, TOOLBAR_LOC::LEFT /
 * RIGHT / TOP_MAIN). Separators mirror AppendSeparator; AppendGroup members are
 * listed consecutively as radio buttons, the same convention pcbToolbars.ts uses.
 * The three TOP_MAIN combo controls (grid / zoom / layer selectors) are rendered
 * by the frame, not as buttons here.
 */

import type { ToolEntry } from '../../ui/toolbar_types.js';

const sep: ToolEntry = 'sep';

/** TOP_MAIN toolbar (button portion; the grid/zoom/layer combos follow it). */
export const FP_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'newFootprint', icon: 'newFootprint', title: 'New footprint' },
  {
    id: 'createFootprint',
    icon: 'createFootprint',
    title: 'Create new footprint using the footprint wizard',
  },
  { id: 'save', icon: 'save', title: 'Save changes' },
  sep,
  { id: 'print', icon: 'print', title: 'Print footprint' },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit footprint' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate counterclockwise' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate clockwise' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror vertically' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror horizontally' },
  { id: 'group', icon: 'group', title: 'Group items' },
  { id: 'ungroup', icon: 'ungroup', title: 'Ungroup items' },
  sep,
  { id: 'footprintProperties', icon: 'footprintProperties', title: 'Edit footprint properties' },
  { id: 'padTable', icon: 'padTable', title: 'Show pad list' },
  {
    id: 'defaultPadProperties',
    icon: 'defaultPadProperties',
    title: 'Edit default pad properties',
  },
  { id: 'showDatasheet', icon: 'showDatasheet', title: 'Show datasheet' },
  { id: 'checkFootprint', icon: 'checkFootprint', title: 'Run footprint checker' },
  sep,
  { id: 'loadFpFromBoard', icon: 'loadFpFromBoard', title: 'Load footprint from current board' },
  { id: 'saveFpToBoard', icon: 'saveFpToBoard', title: 'Insert footprint into current board' },
];

/** LEFT (view options) toolbar. */
export const FP_LEFT_TOOLBAR: ToolEntry[] = [
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
  // Three AppendGroups, not nine buttons (`toolbars_footprint_editor.cpp:65-76`).
  // A group renders as ONE button showing the selected action with a triangle
  // in the corner; the palette opens on a 500 ms press or a drag off it.
  //
  // All nine actions declare `.Flags( AF_NONE )` and no ToolbarState, so
  // `AddGroup`'s `isToggleEntry` is false, the item is wxITEM_NORMAL, and the
  // button can never paint checked — it cycles and lights only under the
  // pointer. That is what `cycleOnClick` carries.
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
  { id: 'padDisplayMode', icon: 'padDisplayMode', title: 'Sketch pads', toggle: true },
  {
    id: 'graphicsOutlines',
    icon: 'graphicsOutlines',
    title: 'Show graphic items in outline mode',
    toggle: true,
  },
  {
    id: 'textOutlines',
    icon: 'textOutlines',
    title: 'Show text items in outline mode',
    toggle: true,
  },
  { id: 'highContrast', icon: 'highContrast', title: 'High-contrast display mode', toggle: true },
  sep,
  { id: 'showLibraryTree', icon: 'showLibraryTree', title: 'Show footprint tree', toggle: true },
  {
    id: 'showLayersManager',
    icon: 'showLayersManager',
    title: 'Show Appearance manager',
    toggle: true,
  },
  { id: 'showProperties', icon: 'showProperties', title: 'Show Properties panel', toggle: true },
];

/** RIGHT (tools) toolbar. */
export const FP_RIGHT_TOOLBAR: ToolEntry[] = [
  // `AppendGroup( TOOLBAR_GROUP_CONFIG( _( "Selection modes" ) ) )`
  // (`toolbars_footprint_editor.cpp:94-96`). NOT a cycling group: both actions
  // are activations and declare TOOLBAR_STATE::TOGGLE, so the button IS a check
  // item and `activeTool` is what lights it.
  {
    group: 'Selection modes',
    actions: [
      { id: 'selectSetRect', icon: 'selectSetRect', title: 'Select items' },
      { id: 'selectSetLasso', icon: 'selectSetLasso', title: 'Select with lasso' },
    ],
  },
  sep,
  { id: 'placePad', icon: 'placePad', title: 'Add pad' },
  { id: 'drawRuleArea', icon: 'drawRuleArea', title: 'Add a rule area (keepout)' },
  sep,
  { id: 'drawLine', icon: 'drawLine', title: 'Draw lines' },
  { id: 'drawArc', icon: 'drawArc', title: 'Draw arcs' },
  { id: 'drawRectangle', icon: 'drawRectangle', title: 'Draw rectangles' },
  { id: 'drawCircle', icon: 'drawCircle', title: 'Draw circles' },
  { id: 'drawPolygon', icon: 'drawPolygon', title: 'Draw graphic polygons' },
  { id: 'drawBezier', icon: 'drawBezier', title: 'Draw beziers' },
  { id: 'placeImage', icon: 'placeImage', title: 'Place reference images' },
  { id: 'placeText', icon: 'placeText', title: 'Add text' },
  { id: 'drawTextBox', icon: 'drawTextBox', title: 'Add text boxes' },
  { id: 'drawTable', icon: 'drawTable', title: 'Add tables' },
  // `AppendGroup( TOOLBAR_GROUP_CONFIG( _( "Dimension objects" ) ) )`
  // (`toolbars_footprint_editor.cpp:124-129`) — five tools behind one button,
  // in upstream's order: orthogonal, aligned, center, radial, leader.
  {
    group: 'Dimension objects',
    actions: [
      {
        id: 'drawOrthogonalDimension',
        icon: 'drawOrthogonalDimension',
        title: 'Add orthogonal dimensions',
      },
      { id: 'drawAlignedDimension', icon: 'drawAlignedDimension', title: 'Add aligned dimensions' },
      { id: 'drawCenterDimension', icon: 'drawCenterDimension', title: 'Add center dimensions' },
      { id: 'drawRadialDimension', icon: 'drawRadialDimension', title: 'Add radial dimensions' },
      { id: 'drawLeader', icon: 'drawLeader', title: 'Add leaders' },
    ],
  },
  { id: 'deleteTool', icon: 'deleteTool', title: 'Interactive delete tool' },
  sep,
  // `PCB_ACTIONS::placePoint`'s Tooltip is "Add reference/snap points"
  // (`pcb_actions.cpp:191-198`) — one action, one tooltip, whichever frame's
  // toolbar it lands on. "Place points" was ours.
  { id: 'placePoint', icon: 'placePoint', title: 'Add reference/snap points' },
  { id: 'setAnchor', icon: 'setAnchor', title: 'Set the footprint anchor' },
  // `ACTIONS::gridSetOrigin` (`toolbars_footprint_editor.cpp:136`) — the
  // click-to-place TOOL. This carried the id `gridOrigin`, which is a
  // *different* action: `ACTIONS::gridOrigin` is the WX_PT_ENTRY_DIALOG on the
  // Show Grid button's right-click menu. Same alias bug the measure tool had:
  // the button lit and the canvas, listening for the action's own name, heard
  // nothing.
  { id: 'gridSetOrigin', icon: 'gridSetOrigin', title: 'Set the grid origin point' },
  // `ACTIONS::measureTool` (toolbars_footprint_editor.cpp:137). The id is the
  // ACTION's name, which is what `FootprintCanvas` arms its ruler on: as
  // `measure` this button lit up and did nothing at all, because the canvas
  // was listening for `measureTool` — the name pcbnew and the footprint viewer
  // both already used.
  { id: 'measureTool', icon: 'measureTool', title: 'Measure distance' },
];

/**
 * [data] `TOOL_ACTION::GetFriendlyName()` for the tools this frame can arm —
 * the string `TOOLS_HOLDER::PushTool` puts in status-bar pane 6
 * (`common/tool/tools_holder.cpp:56-74`).
 *
 * Transcribed from `common/tool/actions.cpp` and `pcbnew/tools/pcb_actions.cpp`,
 * never reworded: `ACTIONS::selectSetRect` is "Rectangle" and not "Select
 * items" (that is its *Tooltip*, which is what the button above carries), and
 * `ACTIONS::selectionTool` is "Select item(s)".
 *
 * These are the same strings the Place menu rows carry, because a menu row's
 * label is a FriendlyName too. The shared home for them is
 * `ui/toolbar_actions.ts`, which holds every id's FriendlyName/hotkey/tooltip
 * for eeschema already and has no pcbnew map yet; when that map lands this
 * table is what folds into it.
 */
export const FP_TOOL_FRIENDLY_NAMES: Readonly<Record<string, string>> = {
  selectionTool: 'Select item(s)',
  selectSetRect: 'Rectangle',
  selectSetLasso: 'Lasso',
  placePad: 'Add Pad',
  drawLine: 'Draw Lines',
  drawArc: 'Draw Arcs',
  drawRectangle: 'Draw Rectangles',
  drawCircle: 'Draw Circles',
  drawPolygon: 'Draw Polygons',
  drawBezier: 'Draw Bezier Curve',
  drawRuleArea: 'Draw Rule Areas',
  placeText: 'Draw Text',
  drawTextBox: 'Draw Text Boxes',
  drawTable: 'Draw Tables',
  placePoint: 'Place Point',
  placeImage: 'Place Reference Images',
  setAnchor: 'Place the Footprint Anchor',
  gridSetOrigin: 'Grid Origin',
  deleteTool: 'Interactive Delete Tool',
  measureTool: 'Measure Tool',
  zoomTool: 'Zoom to Selection Area',
};

/**
 * Status-bar pane 6, `DisplayToolMsg` — the tool *stack*, not the active tool.
 *
 * `PushTool` writes the arriving action's FriendlyName; `PopTool` writes
 * `ACTIONS::selectionTool.GetFriendlyName()` only once the stack has emptied
 * (`tools_holder.cpp:82-116`). Nothing is pushed at construction, so the pane
 * is **blank** on a freshly opened frame even though the selection tool is the
 * one that is live — which is exactly what real pcbnew shows. Ours put the
 * active layer name in this pane, which upstream never does anywhere.
 *
 * `aArmed` is whether any tool has been pushed since the frame opened.
 */
export function footprintToolMsg(aActiveTool: string, aArmed: boolean): string {
  if (!aArmed) return '';
  return FP_TOOL_FRIENDLY_NAMES[aActiveTool] ?? '';
}
