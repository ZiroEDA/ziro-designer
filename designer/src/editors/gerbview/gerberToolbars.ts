// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Gerber Viewer toolbar layouts, following GerbView's toolbar configuration
 * (`gerbview/toolbars_gerber.cpp` GERBVIEW_TOOLBAR_SETTINGS::DefaultToolbarConfig):
 *
 *  - TOP:    load group (Gerber / job / drill / zip) | clear-all | export to
 *            PCB | print | zoom group | measure | (layer / DCode / highlight
 *            selectors render as combos next to the buttons);
 *  - LEFT:   grid | units radio | polar coords | full crosshair | flashed /
 *            lines / polygons sketch-mode toggles | show DCodes | show negative
 *            objects | diff mode | high-contrast | flip view | layer manager.
 *  - RIGHT:  selection tool | measure tool.
 */

import type { ToolEntry } from '../../ui/toolbar_types.js';

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

/** TOP main toolbar (button portion; the combos render separately). */
export const GBR_TOP_TOOLBAR: ToolEntry[] = [
  { id: 'gerbOpen', icon: 'gerbOpen', title: 'Open Gerber file(s)' },
  { id: 'gerbOpenJob', icon: 'gerbOpenJob', title: 'Open Gerber job file' },
  { id: 'gerbOpenDrill', icon: 'gerbOpenDrill', title: 'Open Excellon drill file(s)' },
  { id: 'gerbOpenZip', icon: 'gerbOpenZip', title: 'Open zip archive of Gerber/drill files' },
  sep,
  { id: 'gerbClear', icon: 'gerbClear', title: 'Clear all layers' },
  { id: 'gerbReload', icon: 'gerbReload', title: 'Reload all layers' },
  { id: 'gerbExportToPcb', icon: 'gerbExportToPcb', title: 'Export to Pcbnew' },
  sep,
  { id: 'print', icon: 'print', title: 'Print layers' },
  sep,
  { id: 'zoomRedraw', icon: 'zoomRedraw', title: 'Refresh' },
  { id: 'zoomIn', icon: 'zoomIn', title: 'Zoom in' },
  { id: 'zoomOut', icon: 'zoomOut', title: 'Zoom out' },
  { id: 'zoomFit', icon: 'zoomFit', title: 'Zoom to fit' },
  { id: 'zoomTool', icon: 'zoomTool', title: 'Zoom to selection' },
  // `.AppendSeparator().AppendControl( layerSelector ).AppendControl( textInfo )`
  // (`toolbars_gerber.cpp:99-103`). The layer selector is a bare
  // GBR_LAYER_BOX_SELECTOR with no label of its own, and the text info is a
  // read-only wxTextCtrl carrying UpdateTitleAndInfo's format line.
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

/** LEFT display-options toolbar. */
export const GBR_LEFT_TOOLBAR: ToolEntry[] = [
  { id: 'toggleGrid', icon: 'toggleGrid', title: 'Show grid', toggle: true },
  sep,
  { id: 'unitsMm', icon: 'unitsMm', title: 'Display units in millimetres', toggle: true },
  { id: 'unitsInches', icon: 'unitsInches', title: 'Display units in inches', toggle: true },
  { id: 'unitsMils', icon: 'unitsMils', title: 'Display units in mils', toggle: true },
  sep,
  { id: 'togglePolar', icon: 'gerbTogglePolar', title: 'Display polar coordinates', toggle: true },
  {
    id: 'crosshairFull',
    icon: 'crosshairFull',
    title: 'Show full-window crosshair',
    toggle: true,
  },
  sep,
  {
    id: 'flashedSketch',
    icon: 'gerbFlashedSketch',
    title: 'Show flashed items in outline (sketch) mode',
    toggle: true,
  },
  {
    id: 'linesSketch',
    icon: 'gerbLinesSketch',
    title: 'Show lines in outline (sketch) mode',
    toggle: true,
  },
  {
    id: 'polygonsSketch',
    icon: 'gerbPolygonsSketch',
    title: 'Show polygons in outline (sketch) mode',
    toggle: true,
  },
  sep,
  {
    id: 'showDcodes',
    icon: 'gerbShowDcodes',
    title: 'Show DCode numbers',
    toggle: true,
  },
  {
    id: 'showNegativeObjects',
    icon: 'gerbNegativeObjects',
    title: 'Show negative objects in a ghost colour',
    toggle: true,
  },
  sep,
  {
    id: 'diffMode',
    icon: 'gerbDiffMode',
    title: 'Show layers in differential mode',
    toggle: true,
  },
  {
    id: 'highContrast',
    icon: 'gerbHighContrast',
    title: 'Enable high-contrast mode (dim inactive layers)',
    toggle: true,
  },
  {
    id: 'flipView',
    icon: 'gerbFlipView',
    title: 'Flip view (mirror horizontally)',
    toggle: true,
  },
  sep,
  {
    id: 'showLayerManager',
    icon: 'gerbLayerManager',
    title: 'Show/hide the layers manager',
    toggle: true,
  },
];

/** RIGHT tool toolbar: selection and measure. */
export const GBR_RIGHT_TOOLBAR: ToolEntry[] = [
  { id: 'select', icon: 'select', title: 'Select item' },
  sep,
  { id: 'measure', icon: 'gerbMeasure', title: 'Measure distance between two points' },
];
