// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol Editor toolbar layouts, transcribed from
 * `eeschema/symbol_editor/toolbars_symbol_editor.cpp`'s
 * `SYMBOL_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig` (KiCad 10.0.5 —
 * the header said 9.0, which is not the build we match). Separators mark
 * upstream's `AppendSeparator` calls; a group is one `AppendGroup`.
 *
 * A tool we have not built yet is `disabled` in its upstream POSITION rather
 * than left out, which is what the layer widget's context menu already does:
 * a bar that is two buttons short is a different bar, while a greyed button is
 * the same bar with one tool not yet working. The previous note here said
 * drawSymbolTextBox and drawBezier were absent because "the document model does
 * not yet represent text boxes or bezier body items" — half of that is stale,
 * `kind: 'bezier'` is in `eeschema/src/types.ts:196` — but neither has a tool,
 * so both are greyed rather than dropped.
 */

import type { ToolEntry } from '../../ui/toolbar_types.js';

const sep: ToolEntry = 'sep';

/**
 * `LISTBOX_WIDTH` (`toolbars_symbol_editor.cpp:43-47`), the width of both
 * `AppendControl` combos:
 *
 * ```cpp
 * #ifdef __UNIX__
 * #define LISTBOX_WIDTH 140
 * #else
 * #define LISTBOX_WIDTH 120
 * #endif
 * ```
 *
 * and then `new wxComboBox( …, wxSize( LISTBOX_WIDTH, -1 ), … )` for the unit
 * selector (`:170`) and the body-style selector (`:184`).
 *
 * [data] KiCad hardcodes it — it is not asked of GTK — so it stays a literal,
 * but it has to be KiCad's literal. This is the Linux build, so 140. Ours had
 * no width at all: two `<select>`s at their content width, which with a single
 * empty `<option>` collapsed to about a third of upstream's and made the top
 * bar visibly shorter than KiCad's.
 */
export const LISTBOX_WIDTH = 140;

/**
 * `ACTION_TOOLBAR_CONTROLS::bodyStyleSelector` and `::unitSelector`, the two
 * `AppendControl` slots on the top bar (`toolbars_symbol_editor.cpp:148,151`).
 * The frame supplies the widgets; this table only says where they go.
 */
export const SYM_CONTROL = {
  bodyStyleSelector: 'bodyStyleSelector',
  unitSelector: 'unitSelector',
} as const;

/**
 * The shape each drawing tool lays down — the `SCH_ACTIONS` name on the RIGHT
 * toolbar mapped to the `LibGraphic` kind it produces.
 *
 * This is a lookup and not a chain of `activeTool === '…'` tests inside
 * `SymbolCanvas.tsx` because the chain had drifted off the toolbar: the button
 * dispatched `drawSymbolLines` (the id `SCH_ACTIONS::drawSymbolLines` gives it)
 * while the canvas tested for `drawLines` (the SCHEMATIC's action, a different
 * one — see the note on the right toolbar below). Nothing matched, so the
 * toolbar's Draw Lines button armed a tool the canvas never recognised and the
 * status bar's Current Tool field went blank. Keeping the ids in one table next
 * to the toolbar that emits them is what makes that a test rather than a click.
 */
export const SYM_SHAPE_TOOLS = {
  drawRectangle: 'rectangle',
  drawCircle: 'circle',
  drawArc: 'arc',
  drawSymbolLines: 'lines',
  drawPolygon: 'polygon',
} as const;

/** The `LibGraphic` kinds `SYM_SHAPE_TOOLS` can produce. */
export type SymShapeKind = (typeof SYM_SHAPE_TOOLS)[keyof typeof SYM_SHAPE_TOOLS];

/**
 * Field 6 of the status bar, the "Current Tool" pane: `TOOLS_HOLDER::SetTool`
 * hands `TOOL_ACTION::GetFriendlyName()` to `EDA_DRAW_FRAME::DisplayToolMsg`
 * (`common/tool/tools_holder.cpp:72`). These are SCH_ACTIONS' names verbatim
 * (`eeschema/tools/sch_actions.cpp:376-426`, `:685-704`; the selection and
 * delete tools are ACTIONS' own, `common/tool/actions.cpp:416`, `:1230`).
 *
 * Keyed by the SAME id the toolbar dispatches, which is the property
 * `symbol_tool_ids.test.ts` pins — a name here that no button emits is a status
 * field that never fills in.
 */
export const SYM_TOOL_MSGS: Record<string, string> = {
  select: 'Select item(s)',
  placePin: 'Draw Pins',
  placeText: 'Draw Text',
  drawRectangle: 'Draw Rectangles',
  drawCircle: 'Draw Circles',
  drawArc: 'Draw Arcs',
  drawSymbolLines: 'Draw Lines',
  drawPolygon: 'Draw Polygons',
  placeAnchor: 'Move Symbol Anchor',
  deleteTool: 'Interactive Delete Tool',
};

/** Top horizontal toolbar (ReCreateHToolbar). */
export const SYM_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'newSymbol', icon: 'newSymbol', title: 'New symbol' },
  { id: 'saveAll', icon: 'saveAll', title: 'Save All' },
  // ACTIONS::save. Only saveAll is wired in this frame today.
  { id: 'save', icon: 'save', title: 'Save changes', disabled: true },
  sep,
  { id: 'undo', icon: 'undo', title: 'Undo' },
  { id: 'redo', icon: 'redo', title: 'Redo' },
  sep,
  // Its own separator group upstream (`toolbars_symbol_editor.cpp:122-124`),
  // between undo/redo and the zooms. Ours had neither action.
  { id: 'find', icon: 'find', title: 'Find', disabled: true },
  { id: 'findReplace', icon: 'findAndReplace', title: 'Find and Replace', disabled: true },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Redraw view' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit symbol' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to Selection Area', disabled: true },
  sep,
  { id: 'rotateCCW', icon: 'rotateCCW', title: 'Rotate counterclockwise' },
  { id: 'rotateCW', icon: 'rotateCW', title: 'Rotate clockwise' },
  { id: 'mirrorV', icon: 'mirrorV', title: 'Mirror vertically' },
  { id: 'mirrorH', icon: 'mirrorH', title: 'Mirror horizontally' },
  sep,
  { id: 'symbolProperties', icon: 'symbolProperties', title: 'Edit symbol properties' },
  { id: 'pinTable', icon: 'pinTable', title: 'Edit pins in a table' },
  sep,
  { id: 'showDatasheet', icon: 'showDatasheet', title: 'Show associated datasheet or document' },
  { id: 'checkSymbol', icon: 'checkSymbol', title: 'Check duplicate and off-grid pins' },
  sep,
  // `AppendControl( ACTION_TOOLBAR_CONTROLS::bodyStyleSelector )`
  // (`toolbars_symbol_editor.cpp:148`) — a CHOICE, not two toggle buttons.
  //
  // `showDeMorganStandard` and `showDeMorganAlternate` were ours: neither name
  // appears anywhere in KiCad 10.0.5. The one action that exists is
  // `SCH_ACTIONS::cycleBodyStyle`, FriendlyName "Cycle Body Style"
  // (`sch_actions.cpp:910-915`), and it is not on this toolbar at all — the
  // toolbar carries the selector instead. The `morgan1` bitmap our second
  // button used is in `bitmap_info.cpp`'s registry with no action referencing
  // it, which is what a bitmap for an action that does not exist looks like.
  { control: SYM_CONTROL.bodyStyleSelector },
  sep,
  // `AppendControl( ACTION_TOOLBAR_CONTROLS::unitSelector )` (`:151`), which
  // had been a bare comment here.
  { control: SYM_CONTROL.unitSelector },
  sep,
  { id: 'toggleSyncedPinsMode', icon: 'syncedPins', title: 'Synchronized pins mode', toggle: true },
  sep,
  { id: 'addSymbolToSchematic', icon: 'addSymbolToSchematic', title: 'Add symbol to schematic' },
];

/** Left vertical options toolbar (ReCreateOptToolbar). */
export const SYM_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Toggle grid display', toggle: true },
  {
    id: 'toggleGridOverrides',
    icon: 'toggleGridOverrides',
    title: 'Toggle grid overrides',
    toggle: true,
  },
  // `AppendGroup( TOOLBAR_GROUP_CONFIG( _( "Units" ) ) ... )` and the same for
  // crosshair modes (`toolbars_symbol_editor.cpp:72-79`) — ONE button with a
  // triangle each, not three flat ones, and mm comes first.
  //
  // The crosshair group replaces `toggleCursorStyle`, which is not an action:
  // `grep -rn toggleCursorStyle` over the whole reference returns nothing, and
  // the `cursor_shape` bitmap it used is in `bitmap_info.cpp`'s registry with
  // no action referencing it. It was ours.
  {
    group: 'Units',
    cycleOnClick: true,
    actions: [
      { id: 'unitsMm', icon: 'unitsMm', title: 'Millimeters' },
      { id: 'unitsInches', icon: 'unitsInches', title: 'Inches' },
      { id: 'unitsMils', icon: 'unitsMils', title: 'Mils' },
    ],
  },
  {
    group: 'Crosshair modes',
    cycleOnClick: true,
    actions: [
      { id: 'crosshairSmall', icon: 'crosshairSmall', title: 'Small crosshairs' },
      { id: 'crosshairFull', icon: 'crosshairFull', title: 'Full-Window Crosshairs' },
      { id: 'crosshair45', icon: 'crosshair45', title: '45 Degree Crosshairs' },
    ],
  },
  sep,
  {
    id: 'showElectricalTypes',
    icon: 'showElectricalTypes',
    title: 'Show pin electrical types',
    toggle: true,
  },
  { id: 'showHiddenPins', icon: 'toggleHiddenPins', title: 'Show hidden pins', toggle: true },
  { id: 'showHiddenFields', icon: 'showHiddenFields', title: 'Show hidden fields', toggle: true },
  sep,
  { id: 'showLibraryTree', icon: 'showLibraryTree', title: 'Show library tree', toggle: true },
  { id: 'showProperties', icon: 'showProperties', title: 'Show properties manager', toggle: true },
];

/** Right vertical drawing toolbar (ReCreateVToolbar). */
export const SYM_RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select item(s)' },
  sep,
  { id: 'placePin', icon: 'placePin', title: 'Add a pin' },
  { id: 'placeText', icon: 'placeText', title: 'Draw Text' },
  // `drawSymbolTextBox` and `drawBezier` (`toolbars_symbol_editor.cpp:101-107`)
  // were both missing, so the bar was two buttons short.
  //
  // The ids matter as much as the buttons. An id here IS the upstream action
  // name, and the hotkey inventory keys on it the way HOTKEY_STORE keys on
  // `action->GetName()` — so an action reached from two frames must carry ONE
  // id or it is listed twice. `drawBezier` and `findAndReplace` are shared with
  // the schematic and take the ids that frame already uses; `drawSymbolLines`
  // and `drawSymbolTextBox` are DIFFERENT actions from the schematic's
  // `drawLines` / `drawTextBox` and keep their own, even though upstream gives
  // both members of each pair the same FriendlyName.
  { id: 'drawSymbolTextBox', icon: 'drawSymbolTextBox', title: 'Draw Text Boxes', disabled: true },
  { id: 'drawRectangle', icon: 'rectangle', title: 'Add a rectangle' },
  { id: 'drawCircle', icon: 'circle', title: 'Add a circle' },
  { id: 'drawArc', icon: 'arc', title: 'Add an arc' },
  { id: 'bezier', icon: 'drawBezier', title: 'Draw Bezier Curve', disabled: true },
  { id: 'drawSymbolLines', icon: 'lines', title: 'Draw Lines' },
  { id: 'drawPolygon', icon: 'polygon', title: 'Add a polygon' },
  { id: 'placeAnchor', icon: 'placeAnchor', title: 'Move the symbol anchor' },
  { id: 'deleteTool', icon: 'delete', title: 'Interactive delete' },
];
