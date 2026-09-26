// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Gerber Viewer toolbar layouts — `GERBVIEW_TOOLBAR_SETTINGS::DefaultToolbarConfig`
 * (`gerbview/toolbars_gerber.cpp:39-116`), which declares exactly three of the
 * four possible bars:
 *
 *  - TOP_MAIN: clear / reload / the three openers | print | five zooms |
 *              the layer selector and the read-only text-info box;
 *  - TOP_AUX:  Cmp / Net / Attr / DCode choices | grid selector | zoom selector;
 *  - LEFT:     select and measure | grid, polar, the Units and Crosshair-mode
 *              GROUPS | the five display toggles | forced-opacity, XOR,
 *              high-contrast, flip | the layers manager;
 *  - RIGHT:    `std::nullopt` — there is no right-hand toolbar.
 *
 * Each list below quotes the `AppendAction` run it mirrors, because the order
 * is the parity target as much as the membership is.
 */

import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import type { ToolbarDefaults } from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { D_CODE } from './dcode.js';
import { SortedKeys } from './gerber_file_image.js';
import { gerbIUScale } from './gerbview.js';
import type { GERBVIEW_FRAME } from './gerbview_frame.js';

const sep: ToolEntry = 'sep';

/**
 * Control names, matching the `ACTION_TOOLBAR_CONTROL` identifiers upstream so
 * a reader can grep either tree for the same string. The first two are shared
 * controls registered by `EDA_DRAW_FRAME::configureToolbars`
 * (`common/eda_draw_frame.cpp:208-233`); the rest are GerbView's own
 * (`gerbview/toolbars_gerber.cpp:265-286`).
 */
export const GBR_CONTROL = {
  layerSelector: 'control.LayerSelector',
  textInfo: 'control.TextInfo',
  componentHighlight: 'control.ComponentHighlight',
  netHighlight: 'control.NetHighlight',
  appertureHighlight: 'control.AppertureHighlight',
  dcodeSelector: 'control.GerberDcodeSelector',
  gridSelect: 'control.GridSelector',
  zoomSelect: 'control.ZoomSelector',
} as const;

/**
 * TOP_MAIN, `toolbars_gerber.cpp:83-104`, verbatim:
 *
 *     config.AppendAction( clearAllLayers ).AppendAction( reloadAllLayers )
 *           .AppendAction( openAutodetected ).AppendAction( openGerber )
 *           .AppendAction( openDrillFile );
 *     config.AppendSeparator().AppendAction( ACTIONS::print );
 *     config.AppendSeparator().AppendAction( zoomRedraw ).AppendAction( zoomInCenter )
 *           .AppendAction( zoomOutCenter ).AppendAction( zoomFitScreen ).AppendAction( zoomTool );
 *     config.AppendSeparator().AppendControl( layerSelector ).AppendControl( textInfo );
 *
 * Three things this row is NOT. `openJobFile` and `openZipFile` are File-menu
 * entries only (`menubar.cpp:117,135`) - the toolbar offers "Open Autodetected",
 * which takes any of the four. `exportToPcbnew` is likewise menu-only
 * (`menubar.cpp:151`). And the clear/reload pair comes FIRST, not after the
 * openers. Ours had all three wrong.
 */
export const GBR_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'gerbClear', icon: 'gerbClear', title: 'Clear All Layers' },
  { id: 'gerbReload', icon: 'gerbReload', title: 'Reload All Layers' },
  {
    id: 'gerbOpenAutodetected',
    icon: 'gerbOpenAutodetected',
    title: 'Open Autodetected file(s) on a new layer.',
  },
  { id: 'gerbOpen', icon: 'gerbOpen', title: 'Open Gerber plot file(s) on a new layer.' },
  {
    id: 'gerbOpenDrill',
    icon: 'gerbOpenDrill',
    title: 'Open Excellon drill file(s) on a new layer.',
  },
  sep,
  { id: 'print', icon: 'print', title: 'Print...' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom In' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom Out' },
  {
    id: 'zoomFit',
    icon: 'zoomFit',
    title: 'Zoom to worksheet area if exists or edited object',
  },
  {
    // ACTIONS::zoomTool. Not a GerbView feature: ZOOM_TOOL is 174 lines in
    // `common/tool/zoom_tool.cpp` that ten frames register, GerbView at
    // `gerbview_frame.cpp:1097`. It is an AF_ACTIVATE action, so the button is
    // a radio like selectionTool and measureTool, not a check.
    id: 'zoomTool',
    icon: 'zoomTool',
    title: 'Zoom to an area selection created by a mouse drag',
  },
  sep,
  { control: GBR_CONTROL.layerSelector },
  { control: GBR_CONTROL.textInfo },
];

/**
 * TOP_AUX toolbar, `TOOLBAR_LOC::TOP_AUX`
 * (`gerbview/toolbars_gerber.cpp:107-115`), verbatim:
 *
 *     config.AppendControl( componentHighlight )
 *           .AppendSpacer( 5 )
 *           .AppendControl( netHighlight )
 *           .AppendSpacer( 5 )
 *           .AppendControl( appertureHighlight )
 *           .AppendSpacer( 5 )
 *           .AppendControl( dcodeSelector )
 *           .AppendSeparator()
 *           .AppendControl( gridSelect )
 *           .AppendSeparator()
 *           .AppendControl( zoomSelect );
 *
 * Note the asymmetry, which is upstream's and not a slip here: the four
 * highlight choices are parted by 5 px spacers, and only the grid and zoom
 * selectors get separator rules.
 */
export const GBR_TOP_AUX_TOOLBAR: ToolEntry[] = [
  { control: GBR_CONTROL.componentHighlight },
  { spacer: 5 },
  { control: GBR_CONTROL.netHighlight },
  { spacer: 5 },
  { control: GBR_CONTROL.appertureHighlight },
  { spacer: 5 },
  { control: GBR_CONTROL.dcodeSelector },
  sep,
  { control: GBR_CONTROL.gridSelect },
  sep,
  { control: GBR_CONTROL.zoomSelect },
];

/**
 * LEFT toolbar, `toolbars_gerber.cpp:50-81`, verbatim.
 *
 * Two structural things ours had wrong. `selectionTool` and `measureTool` head
 * this bar (`:51-52`) - we had them on a right-hand toolbar, and GerbView
 * returns `std::nullopt` for `TOOLBAR_LOC::RIGHT` (`:47-48`), so there is no
 * such bar. And the units and crosshair modes are `TOOLBAR_GROUP_CONFIG`s
 * (`:57-64`) - one button showing the selected member with a triangle in the
 * corner, not three buttons in a row.
 */
export const GBR_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select item(s)' },
  {
    id: 'measure',
    icon: 'measureTool',
    title: 'Interactively measure distance between points',
  },
  sep,
  {
    id: 'toggleGrid',
    icon: 'toggleGrid',
    title: 'Display background grid in the edit window',
    toggle: true,
  },
  {
    id: 'togglePolar',
    icon: 'togglePolar',
    title: 'Switch between polar and cartesian coordinate systems',
    toggle: true,
  },
  {
    // TOOLBAR_GROUP_CONFIG( _( "Units" ) ), in upstream's own order: mm first.
    group: 'Units',
    cycleOnClick: true,
    actions: [
      { id: 'unitsMm', icon: 'unitsMm', title: 'Millimeters' },
      { id: 'unitsInches', icon: 'unitsInches', title: 'Inches' },
      { id: 'unitsMils', icon: 'unitsMils', title: 'Mils' },
    ],
  },
  {
    // TOOLBAR_GROUP_CONFIG( _( "Crosshair modes" ) ).
    group: 'Crosshair modes',
    cycleOnClick: true,
    actions: [
      {
        id: 'crosshairSmall',
        icon: 'crosshairSmall',
        title: 'Use small crosshairs aligned at 0 and 90 degrees',
      },
      {
        id: 'crosshairFull',
        icon: 'crosshairFull',
        title: 'Display full-window crosshairs aligned at 0 and 90 degrees',
      },
      {
        id: 'crosshair45',
        icon: 'crosshair45',
        title: 'Display full-window crosshairs aligned at 45 and 135 degrees',
      },
    ],
  },
  sep,
  {
    id: 'flashedSketch',
    icon: 'flashedSketch',
    title: 'Show flashed items in outline mode',
    toggle: true,
  },
  { id: 'linesSketch', icon: 'linesSketch', title: 'Show lines in outline mode', toggle: true },
  {
    id: 'polygonsSketch',
    icon: 'polygonsSketch',
    title: 'Show polygons in outline mode',
    toggle: true,
  },
  {
    id: 'showNegativeObjects',
    icon: 'showNegativeObjects',
    title: 'Show negative objects in ghost color',
    toggle: true,
  },
  { id: 'showDcodes', icon: 'showDcodes', title: 'Show dcode numbers', toggle: true },
  sep,
  {
    // GERBVIEW_ACTIONS::toggleForceOpacityMode, live since the renderer
    // stopped compositing at a permanent 0.8 and started drawing opaque:
    // `GerberRenderOptions.layerOpacity` is 1 unless this is checked, and then
    // it is `m_Display.m_OpacityModeAlphaValue`, which is the alpha
    // `GERBVIEW_RENDER_SETTINGS::LoadColors` pushes into every gerber layer's
    // COLOR4D (`gerbview_painter.cpp:63-66`). The value itself is the
    // `Forced opacity:` spin control on Preferences > Gerber Viewer > Display
    // Options.
    id: 'forceOpacityMode',
    icon: 'forceOpacityMode',
    title: 'Show layers using opacity color forced mode',
    toggle: true,
  },
  {
    id: 'xorMode',
    icon: 'xorMode',
    title: 'Show layers in exclusive-or compare mode',
    toggle: true,
  },
  {
    id: 'highContrast',
    icon: 'gerbHighContrast',
    title: 'Toggle inactive layers between normal and dimmed',
    toggle: true,
  },
  { id: 'flipView', icon: 'flipView', title: 'Show as mirror image', toggle: true },
  sep,
  { id: 'showLayerManager', icon: 'showLayerManager', title: 'Show Layers Manager', toggle: true },
];

/*
 * There is deliberately no GBR_RIGHT_TOOLBAR. GerbView's DefaultToolbarConfig
 * answers `TOOLBAR_LOC::RIGHT` with `return std::nullopt`
 * (`toolbars_gerber.cpp:46-48`) - the frame has no right-hand toolbar, and the
 * two actions ours put there, selectionTool and measureTool, are the first two
 * buttons of the LEFT bar (`:51-52`).
 */

/**
 * `GERBVIEW_TOOLBAR_SETTINGS::DefaultToolbarConfig`
 * (`gerbview/toolbars_gerber.cpp:39-122`), as one switch rather than three
 * exported lists.
 *
 * The three lists above are the toolbars; this is what answers "which toolbar
 * is which", and it is what both the frame (through `useToolbarEntries`) and
 * Preferences > Gerber Viewer > Toolbars ask. `RIGHT` is absent because
 * upstream's first case is `return std::nullopt` — see the note above.
 */
export const GBR_DEFAULT_TOOLBARS: ToolbarDefaults = {
  LEFT: GBR_LEFT_TOOLBAR,
  TOP_MAIN: GBR_TOP_TOOLBAR,
  TOP_AUX: GBR_TOP_AUX_TOOLBAR,
};

// ---- GERBVIEW_FRAME's select boxes (toolbars_gerber.cpp:320-520) -----------

/// `#define NO_SELECTION_STRING _( "<No selection>" )`
export const NO_SELECTION_STRING = '<No selection>';

/** `GERBVIEW_FRAME::updateDCodeSelectBox`: the active layer's apertures. */
export function updateDCodeSelectBox(this: GERBVIEW_FRAME): void {
  const selector = this.m_DCodeSelector!;

  selector.Clear();

  // Add an empty string to deselect net highlight
  selector.Append(NO_SELECTION_STRING);

  const layer = this.GetActiveLayer();
  const gerber = this.GetGbrImage(layer);

  if (!gerber || gerber.GetDcodesCount() === 0) {
    if (selector.GetSelection() !== 0) selector.SetSelection(0);

    return;
  }

  // Build the aperture list of the current layer, and add it to the combo box:
  const dcode_list: string[] = [];

  let scale = 1.0;
  let units = '';

  switch (this.GetUserUnits()) {
    case 'mm':
      scale = gerbIUScale.IU_PER_MM;
      units = 'mm';
      break;

    case 'in':
      scale = gerbIUScale.IU_PER_MILS * 1000;
      units = 'in';
      break;

    case 'mils':
      scale = gerbIUScale.IU_PER_MILS;
      units = 'mil';
      break;

    default:
      console.assert(false, 'Invalid units');
  }

  // std::map<int, D_CODE*>: walked in key order.
  for (const [, dcode] of [...gerber.m_ApertureList.entries()].sort((a, b) => a[0] - b[0])) {
    if (!dcode) continue;

    if (!dcode.m_InUse && !dcode.m_Defined) continue;

    let msg =
      `tool ${dcode.m_Num_Dcode} [${(dcode.m_Size.x / scale).toFixed(3)}x${(dcode.m_Size.y / scale).toFixed(3)} ${units}] ` +
      D_CODE.ShowApertureType(dcode.m_ApertType);

    if (dcode.m_AperFunction !== '') msg += `, ${dcode.m_AperFunction}`;

    dcode_list.push(msg);
  }

  selector.AppendDCodeList(dcode_list);
}

/** `GERBVIEW_FRAME::updateComponentListSelectBox`: every image's components. */
export function updateComponentListSelectBox(this: GERBVIEW_FRAME): void {
  const box = this.m_SelComponentBox!;

  box.Clear();

  // Build the full list of component names from the partial lists stored in each file image
  const full_list = new Map<string, number>();

  for (let layer = 0; layer < this.GetImagesList().ImagesMaxCount(); ++layer) {
    const gerber = this.GetImagesList().GetGbrImage(layer);

    if (gerber === null)
      // Graphic layer not yet used
      continue;

    for (const [k, v] of gerber.m_ComponentsList) if (!full_list.has(k)) full_list.set(k, v);
  }

  // Add an empty string to deselect net highlight
  box.Append(NO_SELECTION_STRING);

  // Now copy the list to the choice box
  for (const entry of SortedKeys(full_list)) box.Append(entry);

  box.SetSelection(0);
}

/** `GERBVIEW_FRAME::updateNetnameListSelectBox`: every image's nets, unescaped. */
export function updateNetnameListSelectBox(this: GERBVIEW_FRAME): void {
  const box = this.m_SelNetnameBox!;

  box.Clear();

  // Build the full list of netnames from the partial lists stored in each file image
  const full_list = new Map<string, number>();

  for (let layer = 0; layer < this.GetImagesList().ImagesMaxCount(); ++layer) {
    const gerber = this.GetImagesList().GetGbrImage(layer);

    if (gerber === null)
      // Graphic layer not yet used
      continue;

    for (const [k, v] of gerber.m_NetnamesList) if (!full_list.has(k)) full_list.set(k, v);
  }

  // Add an empty string to deselect net highlight
  box.Append(NO_SELECTION_STRING);

  // Now copy the list to the choice box
  for (const entry of SortedKeys(full_list)) box.Append(unescapeString(entry));

  box.SetSelection(0);
}

/** `GERBVIEW_FRAME::updateAperAttributesSelectBox`: every used aperture function. */
export function updateAperAttributesSelectBox(this: GERBVIEW_FRAME): void {
  const box = this.m_SelAperAttributesBox!;

  box.Clear();

  // Build the full list of netnames from the partial lists stored in each file image
  const full_list = new Map<string, number>();

  for (let layer = 0; layer < this.GetImagesList().ImagesMaxCount(); ++layer) {
    const gerber = this.GetImagesList().GetGbrImage(layer);

    if (gerber === null)
      // Graphic layer not yet used
      continue;

    if (gerber.GetDcodesCount() === 0) continue;

    for (const aperture of gerber.m_ApertureList.values()) {
      if (aperture === null) continue;

      if (!aperture.m_InUse && !aperture.m_Defined) continue;

      if (aperture.m_AperFunction !== '' && !full_list.has(aperture.m_AperFunction))
        full_list.set(aperture.m_AperFunction, 0);
    }
  }

  // Add an empty string to deselect net highlight
  box.Append(NO_SELECTION_STRING);

  // Now copy the list to the choice box
  for (const entry of SortedKeys(full_list)) box.Append(entry);

  box.SetSelection(0);
}

/**
 * `GERBVIEW_FRAME::OnUpdateSelectDCode`: keep the D-code box on the active
 * image's selected tool. Returns the `aEvent.Enable( gerber != nullptr )`.
 */
export function OnUpdateSelectDCode(this: GERBVIEW_FRAME): boolean {
  if (!this.m_DCodeSelector) return false;

  const layer = this.GetActiveLayer();
  const gerber = this.GetGbrImage(layer);
  const selected = gerber ? gerber.m_Selected_Tool : 0;

  if (this.m_DCodeSelector.GetSelectedDCodeId() !== selected) {
    this.m_DCodeSelector.SetDCodeSelection(selected);
    // Be sure the selection can be made. If no, set to
    // a correct value
    if (gerber) gerber.m_Selected_Tool = this.m_DCodeSelector.GetSelectedDCodeId();
  }

  return gerber !== null;
}
