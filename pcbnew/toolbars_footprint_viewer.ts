// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/toolbars_footprint_viewer.cpp`: the Footprint Library Browser's
 * `FOOTPRINT_VIEWER_TOOLBAR_SETTINGS::DefaultToolbarConfig` and, in the same
 * upstream file, `FOOTPRINT_VIEWER_FRAME::doReCreateMenuBar`.
 *
 * Transcribed entry for entry in upstream's order: `AppendSeparator()` is
 * `'sep'`, `AppendGroup()` one cycling group, `AppendControl()` a control slot
 * the frame fills. RIGHT and TOP_AUX `return std::nullopt` — this frame has
 * neither. `ADVANCED_CFG::m_DrawBoundingBoxes` is off by default, so
 * `ACTIONS::toggleBoundingBoxes` is not on the LEFT bar.
 *
 * The ids are the ones the PCB toolbars and CVPCB's display frame already use
 * for the same actions, so the icons come out of the shared
 * `bitmap_store_actions.ts` table. `title` is `TOOL_ACTION::GetButtonTooltip()`
 * (`common/tool/tool_action.cpp`): the FriendlyName, then the Tooltip on the
 * next line when the action declares one, both from `common/tool/actions.cpp`
 * and `pcbnew/tools/pcb_actions.cpp`.
 */
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import type { ToolbarDefaults } from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import type { Menu, MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { addClose } from '@ziroeda/common/tool/action_menu.js';
import { standardHelpMenu } from '@ziroeda/common/eda_base_frame_help_menu.js';

const sep: ToolEntry = 'sep';

/**
 * `ACTION_TOOLBAR_CONTROLS::gridSelect` / `::zoomSelect`, the two wxChoice
 * boxes every draw frame builds; the frame renders them into these slots.
 */
export const FPVIEWER_CONTROL = {
  gridSelect: 'gridSelect',
  zoomSelect: 'zoomSelect',
} as const;

/** `TOOLBAR_LOC::TOP_MAIN` (`toolbars_footprint_viewer.cpp:50-71`). */
export const FPVIEWER_TOP_TOOLBAR: ToolEntry[] = [
  // `PCB_ACTIONS::previousFootprint` / `nextFootprint` (pcb_actions.cpp:975-987).
  { id: 'previousFootprint', icon: 'previousFootprint', title: 'Display previous footprint' },
  { id: 'nextFootprint', icon: 'nextFootprint', title: 'Display next footprint' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  { id: 'zoomInCenter', icon: 'zoomIn', title: 'Zoom In' },
  { id: 'zoomOutCenter', icon: 'zoomOut', title: 'Zoom Out' },
  {
    id: 'zoomFitScreen',
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
  { id: 'show3DViewer', icon: 'threeDViewer', title: '3D Viewer\nShow 3D viewer window' },
  // `PCB_ACTIONS::saveFpToBoard` (pcb_actions.cpp:968-973).
  {
    id: 'saveFpToBoard',
    icon: 'saveFpToBoard',
    title: 'Insert footprint into PCB\nInsert footprint into current board',
  },
  sep,
  { control: FPVIEWER_CONTROL.gridSelect },
  sep,
  // No separator between the zoom box and Automatic zoom: the C++ appends the
  // action straight after the control (`:68-70`).
  { control: FPVIEWER_CONTROL.zoomSelect },
  {
    id: 'fpAutoZoom',
    icon: 'fpAutoZoom',
    title: 'Automatic zoom\nAutomatic Zoom on footprint change',
    toggle: true,
  },
];

/** `TOOLBAR_LOC::LEFT` (`toolbars_footprint_viewer.cpp:73-99`). */
export const FPVIEWER_LEFT_TOOLBAR: ToolEntry[] = [
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
  // Both groups' actions declare `.Flags( AF_NONE )` and no ToolbarState, so
  // `ACTION_TOOLBAR::AddGroup`'s `isToggleEntry` is false: the button cycles
  // and never paints checked — `cycleOnClick`, as in every other editor.
  {
    group: 'Units',
    cycleOnClick: true,
    actions: [
      { id: 'unitsMm', icon: 'unitsMm', title: 'Millimeters' },
      { id: 'unitsInches', icon: 'unitsInches', title: 'Inches' },
      { id: 'unitsMils', icon: 'unitsMils', title: 'Mils' },
    ],
  },
  // `.AppendSeparator()` between the two groups (`:83`) — CVPCB's viewer has
  // none there; this one does.
  sep,
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

/** `FOOTPRINT_VIEWER_TOOLBAR_SETTINGS::DefaultToolbarConfig`, every location. */
export const FPVIEWER_DEFAULT_TOOLBARS: ToolbarDefaults = {
  LEFT: FPVIEWER_LEFT_TOOLBAR,
  TOP_MAIN: FPVIEWER_TOP_TOOLBAR,
};

/** What the menu rows run. The ids are the toolbar's for the same action. */
export interface FootprintViewerMenuHandlers {
  /** `EVT_MENU( wxID_CLOSE, FOOTPRINT_VIEWER_FRAME::CloseFootprintViewer )`. */
  close: () => void;
  /** A View-menu action, by its toolbar id. */
  action: (id: string) => void;
  /** `ACTIONS::listHotKeys`, through the shared Help menu. */
  showHotkeys: () => void;
  /** `ACTIONS::about`, through the shared Help menu. */
  showAbout: () => void;
}

/**
 * `FOOTPRINT_VIEWER_FRAME::doReCreateMenuBar` (`toolbars_footprint_viewer.cpp:108-144`).
 *
 * File holds `AddClose( _( "Footprint Viewer" ) )` and nothing else — there
 * is no Open, no Save, no Quit. View OPENS with a separator
 * (`viewMenu->AppendSeparator()` is its first line), which is ported as
 * written. Accelerators are the actions' `DefaultHotkey`s: none on the two
 * centred zooms, Home, F5 and Alt+3 on the rest (`common/tool/actions.cpp`).
 */
export function footprintViewerMenus(h: FootprintViewerMenuHandlers): Menu[] {
  const act = (label: string, id: string, icon: string, extra: Partial<MenuItem> = {}) => ({
    label,
    icon,
    action: () => h.action(id),
    ...extra,
  });

  return [
    { label: 'File', items: [addClose('Footprint Viewer', h.close)] },
    {
      label: 'View',
      items: [
        { sep: true },
        act('Zoom In', 'zoomInCenter', 'zoomIn'),
        act('Zoom Out', 'zoomOutCenter', 'zoomOut'),
        act('Zoom to Fit', 'zoomFitScreen', 'zoomFit', { shortcut: 'Home' }),
        act('Refresh', 'zoomRedraw', 'zoomRedraw', { shortcut: 'F5' }),
        { sep: true },
        act('3D Viewer', 'show3DViewer', 'threeDViewer', { shortcut: 'Alt+3' }),
      ],
    },
    // `AddStandardHelpMenu( menuBar )`.
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
