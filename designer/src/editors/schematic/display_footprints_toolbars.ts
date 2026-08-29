// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DISPLAY_FOOTPRINTS_TOOLBAR_SETTINGS::DefaultToolbarConfig`
 * (`cvpcb/toolbars_display_footprints.cpp`), the two toolbars of CVPCB's
 * footprint viewer — the frame the "View Selected Footprint" button opens.
 *
 * Transcribed entry for entry, in upstream's order, with `AppendSeparator()`
 * as `'sep'` and `AppendGroup()` as one cycling group (the same convention
 * `footprintToolbars.ts` and `pcbToolbars.ts` already use). RIGHT and TOP_AUX
 * `return std::nullopt` — this frame has neither, and it has no menu bar
 * either: `DISPLAY_FOOTPRINTS_FRAME` never calls `ReCreateMenuBar`.
 *
 * Every id here is an id one of the PCB toolbars already carries, so the icons
 * and the toggles come out of the shared tables in `toolbar_bitmaps.ts` and
 * `toolbar_action_state.ts` rather than a copy made for this window.
 *
 * `title` is `TOOL_ACTION::GetButtonTooltip()` (`common/tool/tool_action.cpp`):
 * the FriendlyName, then the Tooltip on the next line when the action declares
 * one. Hotkeys are left off, as they are everywhere else in this port.
 */

import type { ToolEntry } from '../../ui/toolbar_types.js';

const sep: ToolEntry = 'sep';

/**
 * The controls the frame renders into the top toolbar.
 * `ACTION_TOOLBAR_CONTROLS::gridSelect` and `::zoomSelect`, the two wxChoice
 * boxes `EDA_DRAW_FRAME` builds for every draw frame.
 */
export const DISPLAY_FP_CONTROL = {
  gridSelect: 'gridSelect',
  zoomSelect: 'zoomSelect',
} as const;

/** `TOOLBAR_LOC::TOP_MAIN`. */
export const DISPLAY_FP_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  // ACTIONS::zoomInCenter / zoomOutCenter, not zoomIn / zoomOut: the centred
  // pair is what every toolbar in the suite carries, and it is the pair the
  // PCB and footprint editors already spell `zoomIn` / `zoomOut` here.
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom In' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom Out' },
  {
    id: 'zoomFit',
    icon: 'zoomFit',
    title: 'Zoom to Fit\nZoom to worksheet area if exists or edited object',
  },
  {
    id: 'zoomTool',
    icon: 'zoomTool',
    title: 'Zoom to Selection Area\nZoom to an area selection created by a mouse drag',
    toggle: true,
  },
  sep,
  { id: 'threeDViewer', icon: 'threeDViewer', title: '3D Viewer\nShow 3D viewer window' },
  sep,
  { control: DISPLAY_FP_CONTROL.gridSelect },
  sep,
  { control: DISPLAY_FP_CONTROL.zoomSelect },
  sep,
  {
    id: 'fpAutoZoom',
    icon: 'fpAutoZoom',
    title: 'Automatic zoom\nAutomatic Zoom on footprint change',
    toggle: true,
  },
];

/** `TOOLBAR_LOC::LEFT`. */
export const DISPLAY_FP_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'selectionTool', icon: 'selectionTool', title: 'Select item(s)', toggle: true },
  {
    id: 'measureTool',
    icon: 'measureTool',
    title: 'Measure Tool\nInteractively measure distance between points',
    toggle: true,
  },
  sep,
  {
    id: 'toggleGrid',
    icon: 'toggleGrid',
    title: 'Show Grid\nDisplay background grid in the edit window',
    toggle: true,
  },
  {
    id: 'togglePolarCoords',
    icon: 'togglePolarCoords',
    title: 'Polar Coordinates\nSwitch between polar and cartesian coordinate systems',
    toggle: true,
  },
  // The two `AppendGroup`s. All six actions declare `.Flags( AF_NONE )` and no
  // ToolbarState, so `ACTION_TOOLBAR::AddGroup`'s `isToggleEntry` is false and
  // neither button can ever paint checked — `cycleOnClick` carries that, the
  // same as in every other editor that builds these two groups.
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
      {
        id: 'crosshairSmall',
        icon: 'crosshairSmall',
        title: 'Small crosshairs\nUse small crosshairs aligned at 0 and 90 degrees',
      },
      {
        id: 'crosshairFull',
        icon: 'crosshairFull',
        title: 'Full-Window Crosshairs\nDisplay full-window crosshairs aligned at 0 and 90 degrees',
      },
      {
        id: 'crosshair45',
        icon: 'crosshair45',
        title: '45 Degree Crosshairs\nDisplay full-window crosshairs aligned at 45 and 135 degrees',
      },
    ],
  },
  sep,
  { id: 'showPadNumbers', icon: 'showPadNumbers', title: 'Show Pad Numbers', toggle: true },
  {
    id: 'padDisplayMode',
    icon: 'padDisplayMode',
    title: 'Sketch Pads\nShow pads in outline mode',
    toggle: true,
  },
  {
    id: 'textOutlines',
    icon: 'textOutlines',
    title: 'Sketch Text Items\nShow footprint texts in line mode',
    toggle: true,
  },
  {
    id: 'graphicsOutlines',
    icon: 'graphicsOutlines',
    title: 'Sketch Graphic Items\nShow graphic items in outline mode',
    toggle: true,
  },
];
