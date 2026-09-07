// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB Editor: the pcbnew frame replicated, menu bar (menubar_pcb_editor.cpp),
 * top/left/right toolbars (toolbars_pcb_editor.cpp), the docked Appearance
 * manager with Layers / Objects / Nets tabs and layer presets
 * (widgets/appearance_controls.cpp), the Selection Filter panel, and the
 * PCB_PAINTER canvas (renderBoard.ts). Board editing tools are staged; the
 * viewer pipeline, layer/object controls and presets are fully functional.
 */

import { PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import { editPointColors } from '@ziroeda/common/src/color4d.js';
import { galPenWidth, galSnapPx } from '@ziroeda/common/src/gal_pixel_grid.js';
import {
  EDIT_POINT_BORDER_SIZE,
  EDIT_POINT_HOVER_SIZE,
  EDIT_POINT_SIZE,
} from '@ziroeda/common/src/preview_items/edit_points.js';
import {
  commonInputPrefs,
  dragGesture,
  dragZoomScale,
  makeAutoPan,
  makeMotionPan,
  makeZoomController,
  wheelAction,
  zoomFitScale,
} from '../../ui/view_controls.js';
import { DockSash } from '../../ui/DockSash.js';
import { applyCanvasSize, canvasBackingSize, isMeasured } from '../../ui/canvas_size.js';
import { appearanceNetRows } from './appearance_nets.js';
import { useStatusReadout } from '../../ui/useStatusReadout.js';

/**
 * `BASE_SCREEN::m_LocalOrigin`, the point pane 3's dx/dy/dist measures from.
 * A module constant so its identity is stable across renders.
 */
const PCB_LOCAL_ORIGIN = { x: 0, y: 0 };
import { drawRulerItem, rulerEnd } from '../../ui/ruler_item.js';
import { boardToolCursor } from './cursors.js';
import {
  groupBoxSegments,
  groupLabelAnchor,
  groupLabelFits,
  groupLabelTextSize,
} from './group_box.js';
import { appearanceLayerRows, layerTooltip } from '../../widgets/appearance_layers.js';
import {
  ZOOM_AUTO_LABEL,
  ZOOM_LIST,
  isZoomSelectPreset,
  zoomSelectLabel,
} from '../../ui/zoom_settings.js';

import type { FitType } from '../../ui/view_controls.js';
import { pcbIUScale, pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  boardHitCandidates,
  boardItemsInBox,
  allBoardItemIds,
  boardItemBBox,
  parseBoardItemId,
  pcbMsgPanelInfo,
  moveBoardItems,
  dragBoardItems,
  connectedTrackEnds,
  boardItemId,
  subsetBoardItems,
  deleteBoardItems,
  rotateBoardItemsBy,
  duplicateBoardItems,
  mirrorBoardItems,
  groupBoardItems,
  ungroupBoardItems,
  addToGroupItems,
  removeFromGroupItems,
  expandGroupIds,
  filterSelectionForFreePads,
  filterSelectionForDelete,
  startTrackDrag,
  updateTrackDrag,
  trackDragSegments,
  applyTrackDrag,
  type TrackDrag,
  groupContaining,
  setBoardItemsLocked,
  isBoardItemLocked,
  isCopperLayerName,
  setBoardPageSettings,
  serializeBoard,
  buildRatsnest,
  prepareLocalRatsnest,
  type LocalRatsnest,
  addBoardShape,
  addBoardTrack,
  addBoardVia,
  addBoardText,
  addBoardPoint,
  addBoardZone,
  setBoardOrigin,
  DEFAULT_POINT_SIZE,
  type RatsnestEdge,
  type Board,
  type BoardBBox,
  type BoardItemKind,
  type PcbFootprint,
  type PcbShape,
  type PcbPad,
  runDrc,
  DEFAULT_SELECTION_FILTER,
  filterSelection,
  distributeBoardItems,
  type DistributeAction,
  moveExact,
  defaultRotationAnchor,
  boardSelectionBBox,
  itemAnchorPoint,
  positionRelative,
  boardGridOrigin,
  convertToPoly,
  convertToZone,
  modifyLines,
  modifiableLineCount,
  type LineModification,
  polygonBoolean,
  booleanableShapeCount,
  type PolygonBoolean,
  outsetItems,
  createArray,
  convertToLines,
  segmentToArc,
  type DrcViolation,
  type SelectionFilter,
  BOARD_NETLIST_UPDATER,
  spreadBoardFootprints,
  type NETLIST,
  fillZones,
  boardEditHandles,
  dragBoardHandle,
  type BoardEditHandle,
  addBoardDimension,
  addBoardTextBox,
  addBoardTable,
  clickDimension,
  dimensionSegments,
  dimensionSnapsToGrid,
  moveDimension,
  startDimension,
  type DimensionDraw,
  type DimensionKind,
  type PcbTable,
  type PcbTextBox,
  addBoardImage,
  applyImageValues,
  collectImageValues,
  imageAt,
  type ImageValues,
  cancelPlaceImage,
  clickImage,
  boardAuxOrigin,
  fileChosen,
  imageBBox,
  moveImage,
  startPlaceImage,
  type ImagePlaceState,
  crossProbeSelection,
  boardSyncSelectionParts,
  crossProbeHighlightNet,
  crossProbeViewChange,
  crossProbeFlashSelection,
  CROSS_PROBE_FLASH_INTERVAL_MS,
  CROSS_PROBE_FLASH_LAST_PHASE,
  addBoardBarcode,
  setBoardBarcode,
  type PcbBarcode,
} from '@ziroeda/pcbnew';
import {
  applyBarcodeValues,
  barcodeAt,
  barcodeValues,
} from '@ziroeda/pcbnew/src/barcode_properties.js';
import { DialogBarcodeProperties } from './dialogs/dialog_barcode_properties.js';
import { GetLayerName } from '@ziroeda/pcbnew/src/layer_ids.js';
import {
  boardIsEmpty,
  hasLockedItems,
  hasUnlockedItems,
} from '@ziroeda/pcbnew/src/pcb_selection_conditions.js';
import { Icon } from '../../ui/icons.js';
import { posturePath, routedPath as routeDecision } from './route_tool.js';
import { ReferenceImageCache } from './image_cache.js';
import { Viewer3DFrame } from './Viewer3DFrame.js';
import { dimensionDefaultsFrom, dimensionToolKind } from './dimension_tools.js';
import { DialogDimensionProperties } from './dialogs/dialog_dimension_properties.js';
import { DialogTextBoxProperties } from './dialogs/dialog_textbox_properties.js';
import { DialogReferenceImageProperties } from './dialogs/dialog_reference_image_properties.js';
import { DialogTableProperties } from '../../ui/DialogTableProperties.js';
import {
  applyTableValues,
  collectTableValues,
  tableAt,
  type TableValues,
} from '@ziroeda/pcbnew/src/table_properties.js';
import {
  applyTextBoxValues,
  collectTextBoxValues,
  textBoxAt,
  type TextBoxValues,
} from '@ziroeda/pcbnew/src/textbox_properties.js';
import { isDrawableTextBox, newTextBox } from '@ziroeda/pcbnew/src/draw_textbox.js';
import { newTable, type TableDefaults } from '@ziroeda/pcbnew/src/draw_table.js';

/** An empty source node, for an item that has not been saved yet. */
const EMPTY_SLIST = { kind: 'list' as const, items: [] };

/** Stable empty/`toggleOrtho`-only sets for the 3D toolbar's `toggled` prop. */
const EMPTY_IDS: ReadonlySet<string> = new Set();
const ORTHO_ON: ReadonlySet<string> = new Set(['toggleOrtho']);
import {
  applyDimensionValues,
  collectDimensionValues,
  dimensionAt,
  type DimensionValues,
} from '@ziroeda/pcbnew/src/dimension_properties.js';
import { Reporter, type ReportLine } from '@ziroeda/common';
import { MenuBar, ContextMenu, type Menu, type MenuItem } from '../../ui/MenuBar.js';
import { Combo } from '../../ui/Combo.js';
import { layerBoxLabel, layerForHotkey } from './layer_box_label.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { PCB_FRAME_NAME, pcbFrameTitle } from './frame_title.js';
import { withSaveEnablement } from '../../ui/save_enablement.js';
import {
  copySelectionToClipboardText,
  cutSelectionToClipboardText,
  parseClipboardText,
  pasteIntoBoard,
  type PasteMode,
} from '@ziroeda/pcbnew/src/pcb_clipboard.js';
import { DialogPasteSpecial, type PasteSpecialMode } from '../../dialogs/dialog_paste_special.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { MsgPanel, type MsgPanelItem } from '../../ui/MsgPanel.js';
import {
  gridMsg,
  messageTextFromValue,
  scaleForZoomFactor,
  type StatusUnits,
  unitsMsg,
  unitText,
  zoomFactorForScale,
  zoomMsg,
} from '../../ui/status_format.js';
import { DialogPcbFind, DEFAULT_PCB_FIND, type PcbFindOptions } from './dialogs/dialog_find.js';
import { DialogPageSettings } from '../../dialogs/dialog_page_settings.js';
import { pageSettingsValue, toPaperToken } from '../../dialogs/page_settings_model.js';
import { pcbZoomFitBox } from './document_extents.js';
import { DialogPcbPrint } from './dialogs/dialog_print_pcb.js';
import { DialogPcbPlot } from './dialogs/dialog_plot_pcb.js';
import {
  DialogBoardSetup,
  defaultBoardSetup,
  type BoardSetupValues,
} from './dialogs/dialog_board_setup.js';
import {
  druFileName,
  findProjectDru,
  findProjectPro,
  readBoardSetupPro,
  writeBoardSetupProText,
} from './project_settings.js';
import type { TextGfxRow } from './board_settings.js';
import { applyBoardFileSetup, writeBoardFileSetup } from './board_file_settings.js';
import { DialogDrc } from './dialogs/dialog_drc.js';
import { DialogUpdatePcb, type UpdatePcbOptions } from './dialogs/dialog_update_pcb.js';
import { DialogGlobalEditTeardrops } from './dialogs/dialog_global_edit_teardrops.js';
import { DialogFilterSelection } from './dialogs/dialog_filter_selection.js';
import { DialogMoveExact, type MoveExactValues } from './dialogs/dialog_move_exact.js';
import { DialogLineModification } from './dialogs/dialog_line_modification.js';
import { DialogCreateArray } from './dialogs/dialog_create_array.js';
import { DEFAULT_ARRAY_SETTINGS, arraySpecFrom, type ArraySettings } from './array_settings.js';
import { handleAtPoint, handleDragTarget, handleTolerance } from './point_edit_canvas.js';
import { DialogOutsetItems } from './dialogs/dialog_outset_items.js';
import { DialogPnsSettings } from './dialogs/dialog_pns_settings.js';
import {
  DEFAULT_OUTSET_SETTINGS,
  outsetOptionsFrom,
  type OutsetSettings,
} from './outset_settings.js';
import {
  DialogPositionRelative,
  type PositionRelativeValues,
} from './dialogs/dialog_position_relative.js';
import { DialogInspectConstraints } from './dialogs/dialog_inspect_constraints.js';
import { inspectSelection, describeSelected } from './inspect_selection.js';
import { netClassFor, netclassesForNet } from './netclass_resolve.js';
// APPEARANCE_CONTROLS is ONE widget that PCB_EDIT_FRAME and
// FOOTPRINT_EDIT_FRAME both construct, so the panel, its Objects table and its
// presets live in `widgets/` and this frame supplies only its own data.
import { AppearanceControls, type AppearanceTab } from '../../widgets/appearance_controls.js';
import {
  DEFAULT_OBJECTS,
  DEFAULT_OPACITY,
  OBJECT_ROWS,
  toggleObject,
  type ObjectOpacity,
  type ObjectState,
} from '../../widgets/appearance_objects.js';
import {
  BUILTIN_PRESETS,
  matchPresetName,
  presetComboItems,
  PRESET_SEPARATOR,
  viewportComboItems,
} from '../../widgets/appearance_presets.js';
import {
  DEFAULT_SELECTION_FILTER_OPTIONS,
  SelectionFilterOnlyMenu,
  SelectionFilterPanel,
  type SelectionFilterItem,
} from '../../widgets/panel_selection_filter.js';
import { align, type PcbGridState } from '@ziroeda/pcbnew/src/pcb_grid_helper.js';
import {
  bestDragOrigin,
  bestSnapAnchor,
  type BoardCursorSnap,
  snapToBoardCopper,
} from '@ziroeda/pcbnew/src/pcb_cursor_snap.js';
import { inheritTrackWidth } from '@ziroeda/pcbnew/src/inherit_track_width.js';
import { moveDelta } from './pcb_grid.js';
import { contextMenuPick } from './pcb_context_selection.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import { DialogTrackViaProperties } from './dialogs/dialog_track_via_properties.js';
import { DialogCopperZones } from './dialogs/dialog_copper_zones.js';
import { DialogFootprintProperties } from './dialogs/dialog_footprint_properties.js';
import {
  applyFootprintValues,
  collectFootprintValues,
  footprintAt,
  type FootprintValues,
} from '@ziroeda/pcbnew/src/footprint_properties.js';
import { flipBoardItems, modificationPoint } from '@ziroeda/pcbnew/src/edit-board.js';
import { zoneItemDescription } from '@ziroeda/pcbnew/src/item_description.js';
import { DialogPadProperties } from './dialogs/dialog_pad_properties.js';
import {
  DialogShapeProperties,
  DialogTextProperties,
} from './dialogs/dialog_graphic_properties.js';
import {
  applyShapeValues,
  applyTextValues,
  collectShapeValues,
  collectTextValues,
  shapeAt,
  textAt,
  type ShapeValues,
  type TextValues,
} from '@ziroeda/pcbnew/src/graphic_properties.js';
import {
  applyPadValues,
  collectPadValues,
  // `padAt` is taken by the local hit-test helper below.
  padAt as selectedPadAt,
  type PadRef,
  type PadValues,
} from '@ziroeda/pcbnew/src/pad_properties.js';
import {
  applyZoneValues,
  collectZoneValues,
  zoneAt,
  type ZoneValues,
} from '@ziroeda/pcbnew/src/zone_properties.js';
import {
  applyTrackViaValues,
  hasTrackOrVia,
  trackViaSelection,
  type TrackViaValues,
} from '@ziroeda/pcbnew/src/track_via_properties.js';
import {
  applyGlobalTeardropEdit,
  type GlobalTeardropEditOptions,
} from '@ziroeda/pcbnew/src/teardrop_global_edit.js';
import {
  applyTeardrops,
  boardHasTeardrops,
  defaultTeardropParametersList,
  teardropInputsChanged,
  type TeardropParametersList,
} from '@ziroeda/pcbnew/src/teardrop.js';
import { fetchNetlistFromSchematic } from './netlist_from_schematic.js';
import { loadFootprint } from '../../widgets/footprint_list.js';
import { preloadBoardLibraries } from './preload.js';
import { parseFootprint } from '../footprint/footprintBoard.js';
import {
  buildScene,
  buildDrawSteps,
  drawAnchors,
  drawBoard,
  drawDrawingSheet,
  hitTestBoardDrawingSheet,
  drawPageLimits,
  drawNetNames,
  drawOriginMarkers,
  drawDrcMarkers,
  boardTextPath,
  PCB_DEFAULT_GRID_IU,
  PCB_DEFAULT_GRID_ORIGIN,
  pcbGridOptions,
  DEFAULT_DRAW_OPTIONS,
  DOM_PATH_FACTORY,
  type BoardScene,
  type PcbDrawOptions,
  type DrcMarkerDraw,
  type ScenePathFactory,
  type SceneFilter,
} from './renderBoard.js';
import { PcbGl } from '../../render/gl/pcb_gl.js';
import { GL_PATH_FACTORY } from '../../render/gl/gl_path.js';
import {
  applyToggle,
  crosshairToggleId,
  foldPcbToggle,
  isStoredPcbToggle,
  lineModeToggleId,
  pcbTogglesFromSettings,
} from './toggles.js';
import {
  layerColor,
  pcbThemeWithOverrides,
  PCB_BACKGROUND,
  PCB_CURSOR,
  PCB_OBJECT_COLORS,
  PCB_SPECIAL,
} from './pcbTheme.js';
import { PcbPropertiesPanel } from './PcbPropertiesPanel.js';
import {
  pcbItemFriendlyName,
  pcbPropertiesFor,
  type PcbPropRow,
} from '@ziroeda/pcbnew/src/properties_panel.js';
import { drawGrid, drawCrosshair, gridSnappingEnabled } from '../../ui/grid_cursor.js';
import { GRID_SIZE_LIST, gridEntryOf, gridSizeToIU, gridSizesIU } from '../../ui/grid_settings.js';
import {
  type ConditionalEntry,
  evaluateConditionalMenu,
  menuEntry,
  menuSeparator,
} from '../../ui/conditional_menu.js';
import { standardSubMenuEntries } from '../../ui/standard_submenus.js';
import { PCB_CONTROL, PCB_DEFAULT_TOOLBARS } from './pcbToolbars.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import '../../ui/shell.css';
import { AboutDialog } from '../../home/dialogs/dialog_about.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { standardHelpMenu } from '../../ui/help_menu.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { ABOUT_TITLES } from '../../ui/about_titles.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { addQuitOrClose } from '../../ui/action_menu.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '../../ui/menu_hotkeys.js';
import { isTypingTarget, wasBrowserSuppressed, type FocusLike } from '../../ui/browser_hotkeys.js';
import { settings } from '../../prefs/settings.js';
import { usePcbnewSettings, useUserColors, useUserThemes } from '../../prefs/useSettings.js';
import { ColorSwatch } from '../../ui/ColorSwatch.js';
import {
  COLOR4D_UNSPECIFIED,
  parseColor4d,
  toCssColor,
  type Color4d,
} from '@ziroeda/common/src/color4d.js';
import { HomeLink } from '../../ui/HomeLink.js';

const MM = PCB_IU_PER_MM; // pcbnew IU is 1 nm (base_units.h)

/** A node with no children, for an item that has never been in a file. */
const EMPTY_SOURCE = { kind: 'list' as const, items: [] };

/**
 * `PCB_BARCODE`'s constructor (`pcb_barcode.cpp:61-72`), for the item the
 * barcode tool creates before opening its dialog. The layer, position and text
 * height are the tool's and are filled in by the caller; everything here is
 * the item's own default.
 */
const NEW_BARCODE = {
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'Dwgs.User',
  width: 40 * MM,
  height: 40 * MM,
  text: '',
  textHeight: 1.27 * MM,
  kind: 'qr' as const,
  ecc: 'L' as const,
  showText: true,
  knockout: false,
  margin: { x: 0, y: 0 },
};

/**
 * The WebGL board renderer, on by default; `?renderer=canvas` opts out.
 *
 * The schematic's flag was left opt-in past the point of decision and the
 * result was that improvements got reported against a renderer that was not
 * running (`SchematicCanvas.tsx`). So this one is on from the start, and the
 * opt-out is kept for the two reasons that flag is still worth having: a
 * renderer swap should be reversible without a deploy, and a browser with no
 * WebGL2 has to keep working anyway — `PcbGl.create` returns null and every
 * frame falls back to the raster path below.
 */

/**
 * `?perf=1` publishes what each frame cost and which path drew it, on
 * `window.__pcbPerf`.
 *
 * #481's own rule is that renderer numbers measured from Node mean nothing:
 * everything in the port so far was provable off-screen, and this last step is
 * not. A blank canvas and a correct board are indistinguishable to every test
 * that can be written for it, so the only honest measurement is one taken in a
 * browser against the 1,544 ms baseline in the issue.
 */
const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

interface PcbPerfCounters {
  /** Frames drawn by each path. */
  gl: number;
  raster: number;
  /** GL re-records: the expensive half, and the one that should stay rare. */
  records: number;
  lastRecordMs: number;
  totalMs: number;
  maxMs: number;
  /** The last 40 frame times, in ms. */
  last: number[];
}

const pcbPerf: PcbPerfCounters = {
  gl: 0,
  raster: 0,
  records: 0,
  lastRecordMs: 0,
  totalMs: 0,
  maxMs: 0,
  last: [],
};
if (PERF && typeof window !== 'undefined') {
  (window as unknown as { __pcbPerf: PcbPerfCounters }).__pcbPerf = pcbPerf;
}

/** Record one frame: which path drew it, and how long it took. */
function notePcbPaint(path: 'gl' | 'raster', t0: number): void {
  if (!PERF) return;
  const ms = performance.now() - t0;
  pcbPerf[path]++;
  pcbPerf.totalMs += ms;
  if (ms > pcbPerf.maxMs) pcbPerf.maxMs = ms;
  pcbPerf.last.push(Math.round(ms * 10) / 10);
  if (pcbPerf.last.length > 40) pcbPerf.last.shift();
}

// pcb_painter.cpp getColor: a selected item is drawn in its layer colour
// Brightened(0.8) (per channel c·0.2 + 0.8), i.e. pushed 80% toward white.

// Snapping lives in pcb_grid.ts; see the note there on the board grid origin.

// pcbnew's grid presets, as the module DEFAULT: `DefaultGridSizeList()`'s
// non-eeschema row, which the footprint editor shares. The table lives in
// ui/grid_settings.ts because it is common/ code upstream.
//
// It is the seed, not the answer. The live list is `window.grid.sizes`, which
// `PANEL_GRID_SETTINGS` edits on Preferences > PCB Editor > Grids — a canvas
// that kept reading the table would make every row on that page a control
// nothing obeys, which is exactly what it was before that page existed.
const PCB_GRIDS: number[] = gridSizesIU('pcbnew', MM);

/** The stored grid list, in IU — `window.grid.sizes` rather than the table. */
function pcbGridSizesIU(cfg: typeof settings.pcbnew): number[] {
  return cfg.window.grid.sizes.map((g) => gridSizeToIU(g.x, MM) ?? 0).filter((v) => v > 0);
}

/** The grid the frame opens on: `window.grid.last_size_idx` into that list. */
function storedPcbGridIU(): number {
  const cfg = settings.pcbnew;
  return pcbGridSizesIU(cfg)[cfg.window.grid.last_size_idx] ?? PCB_DEFAULT_GRID_IU;
}

/** The aux bar's `toggled` sets, hoisted so a render does not build a new one
 *  each time and re-run the toolbar's memo. */
const EMPTY_TOGGLED: ReadonlySet<string> = new Set();
const AUTO_TRACK_WIDTH_ON: ReadonlySet<string> = new Set(['autoTrackWidth']);

/**
 * A GAL zoom factor turned into our view scale, and back.
 *
 * These are what the zoom selector and the status bar's `Z` field mean, and
 * both are KiCad numbers rather than free-floating ones: `COMMON_TOOLS::
 * doZoomToPreset` passes a preset straight to `VIEW::SetScale`, and
 * `EDA_DRAW_FRAME::GetZoomLevelIndicator` prints `GAL::GetZoomFactor`. GAL
 * relates the two by `worldScale = screenDPI · worldUnitLength · zoomFactor`
 * (graphics_abstraction_layer.h `computeWorldScale`), with `worldUnitLength`
 * one internal unit in inches — pcbnew's IU is 1 nm, so 1e-9/0.0254.
 *
 * `scale` here is *device* pixels per IU while GAL's is physical screen pixels,
 * so the device-pixel ratio divides out; on a HiDPI display GAL renders into a
 * larger framebuffer without changing the zoom it reports.
 *
 * The old mapping was `scale · 1000`, which is dimensionless nonsense: it put
 * preset "Zoom 2.20" at 2200 px/mm where pcbnew puts it at 7.9, so choosing a
 * preset landed inside a single pad and the status bar read `Z 0.00` on a board
 * that pcbnew calls `Z 2.10`.
 */

// The graphic-shape drawing tools (DRAWING_TOOL) and the PcbShape kind each
// one creates.
const DRAW_SHAPE_TOOLS: Record<string, PcbShape['kind']> = {
  drawLine: 'line',
  drawArc: 'arc',
  drawRectangle: 'rect',
  drawCircle: 'circle',
  drawPolygon: 'poly',
};

// Friendly names for the "Current Tool" status-bar field (field 6), shown while
// a right-toolbar tool is active (EDA_DRAW_FRAME::DisplayToolMsg). The selection
// tool leaves the field blank, exactly like KiCad.
const PCB_TOOL_MSGS: Record<string, string> = {
  // The selection tool shows "Select item(s)" (PCB_SELECTION_TOOL's tool message).
  selectSetRect: 'Select item(s)',
  selectSetLasso: 'Select item(s)',
  routeSingleTrack: 'Route Single Track',
  drawVia: 'Add Via',
  drawZone: 'Add Filled Zone',
  drawLine: 'Draw Line',
  drawArc: 'Draw Arc',
  drawRectangle: 'Draw Rectangle',
  drawCircle: 'Draw Circle',
  drawPolygon: 'Draw Polygon',
  placeText: 'Add Text',
  // `TOOL_ACTION::GetFriendlyName()`, which `TOOLS_HOLDER::PushTool` puts in
  // pane 6 — "Place Point" (`pcb_actions.cpp:194`), not the tooltip.
  placePoint: 'Place Point',
  placeBarcode: 'Add Barcode',
  // `ACTIONS::gridSetOrigin` is "Grid Origin" (`actions.cpp:1057`) and
  // `PCB_ACTIONS::drillOrigin` "Drill/Place File Origin"
  // (`pcb_actions.cpp:1472`) — the FriendlyName, not the tooltip.
  gridSetOrigin: 'Grid Origin',
  drillOrigin: 'Drill/Place File Origin',
  measureTool: 'Measure Tool',
  deleteTool: 'Delete Items',
  localRatsnestTool: 'Local Ratsnest',
};

// Tools that act on plain clicks and take no drag/box-select gestures.
const isClickTool = (t: string): boolean =>
  t === 'deleteTool' ||
  t === 'localRatsnestTool' ||
  t === 'routeSingleTrack' ||
  t === 'drawVia' ||
  t === 'placeText' ||
  t === 'drawZone' ||
  t === 'measureTool' ||
  // `POINT_PLACER::SnapItem` calls `BestSnapAnchor` and then
  // `ForceCursorPosition( true, cursorPos )` (drawing_tool.cpp:895-906) — a
  // snap point that could not land on another item's anchor would be a poor
  // snap point.
  t === 'placePoint' ||
  // `DRAWING_TOOL::DrawBarcode` snaps through `PCB_GRID_HELPER::BestSnapAnchor`
  // with `GRID_TEXT` (`drawing_tool.cpp:1478-1481`) before the click, exactly
  // as the text tool does.
  t === 'placeBarcode' ||
  // `PCB_PICKER_TOOL::Main` runs the cursor through `BestSnapAnchor` on every
  // motion (`pcb_picker_tool.cpp`), which is what lets an origin be dropped
  // exactly on a pad or a track end.
  t === 'gridSetOrigin' ||
  t === 'drillOrigin' ||
  !!DRAW_SHAPE_TOOLS[t];

// Default graphic line widths per layer class, in IU
// (board_design_settings.h DEFAULT_*_WIDTH, in mm).
const defaultShapeWidth = (layer: string): number => {
  if (/\.SilkS$/.test(layer)) return 0.1 * MM;
  if (/\.Cu$/.test(layer)) return 0.2 * MM;
  if (layer === 'Edge.Cuts' || /\.CrtYd$/.test(layer)) return 0.05 * MM;
  return 0.1 * MM;
};

type AlignAction = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

const bboxCenter = (b: BoardBBox): { x: number; y: number } => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

const bboxContainsPoint = (b: BoardBBox, p: { x: number; y: number }): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

// Circumcenter of three points, or null when they are (nearly) collinear.
const circumcenter = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): { x: number; y: number } | null => {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-3) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
};

// Trace the arc through start→mid→end on the 2D context (world coords).
const traceArc3 = (
  ctx: CanvasRenderingContext2D,
  s: { x: number; y: number },
  m: { x: number; y: number },
  e: { x: number; y: number },
): void => {
  const o = circumcenter(s, m, e);
  if (!o) {
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    return;
  }
  const r = Math.hypot(s.x - o.x, s.y - o.y);
  const a0 = Math.atan2(s.y - o.y, s.x - o.x);
  const a1 = Math.atan2(m.y - o.y, m.x - o.x);
  const a2 = Math.atan2(e.y - o.y, e.x - o.x);
  // Pick the sweep direction that passes through the mid point.
  const ccwSpan = (from: number, to: number): number => {
    let d = from - to;
    while (d < 0) d += Math.PI * 2;
    return d;
  };
  const ccw = ccwSpan(a0, a1) <= ccwSpan(a0, a2);
  ctx.moveTo(s.x, s.y);
  ctx.arc(o.x, o.y, r, a0, a2, ccw);
};

// The left toolbar's radio groups, its opening state and its reducer are in
// `toggles.ts` rather than here, because `qa`'s tsconfig compiles `.ts` only:
// a default written in a `.tsx` is one no test can read, and two of the seven
// were on the wrong arm of pcbnew's own settings.

// `rebuildLayers()`'s non_cu_seq order and its tooltips now live in
// `widgets/appearance_layers.ts`, because APPEARANCE_CONTROLS is ONE widget
// that both PCB_EDIT_FRAME and FOOTPRINT_EDIT_FRAME construct - the table was
// restated here, and the footprint editor, unable to import it out of a `.tsx`,
// had invented an order of its own.

// The user-facing name of a layer is BOARD::GetLayerName's, which every
// upstream caller goes through: the board's own name for it when the file
// carries one, and LayerName()'s standard English name otherwise. Both halves
// live in @ziroeda/pcbnew/src/layer_ids.ts — the table used to be restated
// here, and this copy had no way to reach the board's names at all.

// Routing dimensions of a net class (NETCLASS factory defaults, in IU), the
// last-resort fallback when even the Default class carries no value.
interface ClassDims {
  trackWidth: number;
  viaDiameter: number;
  viaDrill: number;
}
const DEFAULT_CLASS_DIMS: ClassDims = {
  trackWidth: 0.25 * MM,
  viaDiameter: 0.8 * MM,
  viaDrill: 0.4 * MM,
};

/**
 * The selection an EDIT_TOOL command actually operates on: groups expanded to
 * their members, and pads replaced by their parent footprints, the
 * FilterCollectorForHierarchy + FilterCollectorForFreePads pair every command
 * (Move, Drag, Rotate, Mirror, Remove, …) runs its collector through.
 *
 * `selection` is what RequestSelection leaves selected afterwards: it hands the
 * filtered collector back, so a promoted pad leaves its footprint selected. It
 * is null when nothing was promoted, so group ids stay selected as groups.
 */
// EDIT_POINT's screen sizes and colours come from the shared modules the symbol,
// schematic and drawing-sheet canvases already use — `preview_items/edit_points`
// for the metrics and `editPointColors` for the palette. This file used to
// restate all six locally, and both halves were wrong for it:
//
//   * the sizes were 3 and 6, which is upstream's `#ifdef __WXMAC__` arm. The
//     parity target is the GTK build on this machine, where they are 2 and 5, so
//     every handle here carried a border half again too heavy.
//   * the colours were a hardcoded white fill with two grey borders, which is
//     what `editPointColors` happens to derive for a white LAYER_AUX_ITEMS — so
//     the handles ignored the board theme entirely.

/** The board's metadata with none of its items, the shell an overlay is drawn in. */
function emptyBoardLike(board: Board): Board {
  return {
    ...board,
    footprints: [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    textBoxes: [],
    tables: [],
    groups: [],
  };
}

function promotePadsForCommand(
  board: Board,
  sel: ReadonlySet<string>,
): { items: Set<string>; selection: Set<string> | null } {
  const items = filterSelectionForFreePads(expandGroupIds(board, sel));
  const hadPad = [...sel].some((id) => parseBoardItemId(id)?.kind === 'pad');
  return { items, selection: hadPad ? filterSelectionForFreePads(sel) : null };
}

export function PcbEditor({
  fileName,
  text,
  onExit,
  onShowSchematic,
  onShowFootprintEditor,
  onSaveBoard,
  onBoardChange,
  registerAutosaveFlush,
  openNonce,
  projectName,
  projectFiles,
  rootPro,
  onPersistFiles,
  onOutputFile,
  crossProbeNet,
  syncSelection,
  onSyncSelectionToSch,
  onCrossProbeNetToSch,
  updateFromSchematic,
  readOnlyNotice,
  readOnly,
}: {
  fileName: string;
  text: string;
  onExit: () => void;
  onShowSchematic?: () => void;
  /** Open the Footprint Editor (the top-toolbar button / Tools menu). */
  onShowFootprintEditor?: () => void;
  /** Save the board into the project (cloud/file-manager storage); when
   *  absent, Save falls back to a local download. */
  onSaveBoard?: (text: string) => void;
  /** Debounced autosave sink (the app's coalesced project autosave): board
   *  edits sync automatically like the schematic's. */
  onBoardChange?: (text: string) => void;
  /**
   * Hand the host a "serialise the board NOW" callback, the same contract
   * eeschema has had.
   *
   * Without it the board's own 1 s autosave debounce was unreachable: the
   * host's flush — leaving for the home screen, `visibilitychange`, `pagehide`,
   * the crash-recovery zip — could force the schematic out and had nothing at
   * all for pcbnew, so the last second of board work was lost by every one of
   * those paths.
   */
  registerAutosaveFlush?: (fn: (() => void) | null) => void;
  /**
   * Bumped by the host once per deliberate project open, and by nothing else.
   *
   * `text` is a LIVE prop: the host mirrors this editor's own autosaved output
   * back into the open project so a reopen or a remount sees the work rather
   * than the file. Reloading the board whenever that string changed would
   * therefore reparse the board on every autosave and throw the session away
   * on every reopen, so the reload is keyed on the open instead — KiCad calls
   * `OpenProjectFiles` when something asks it to, not because a data structure
   * changed identity.
   */
  openNonce?: number;
  /** Project name shown as "<project>, PCB Editor" in the menu bar. */
  projectName?: string;
  /** The open project's files (name + text), lets the 3D viewer resolve
   *  ${KIPRJMOD}/relative model references to project-bundled files. */
  projectFiles?: { name: string; text: string }[];
  /** Base name of the active `.kicad_pro` (scopes multi-project folders). */
  rootPro?: string;
  /** Persist project files immediately (Board Setup writes the `.kicad_pro`
   *  and `.kicad_dru` through this, same flow as the schematic editor). */
  onPersistFiles?: (files: { name: string; text: string }[]) => void;
  /** Write a generated output file (plot / drill) into the project's file
   *  manager; the path is relative to the project folder. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  /** Net highlighted in the schematic editor, cross-probed here (KiCad's
   *  SCH_EDIT_FRAME::SendCrossProbeConnection -> pcbnew's "$NET:" handler);
   *  null clears the highlight (SendCrossProbeClearHighlight). */
  crossProbeNet?: string | null;
  /** Select on PCB from the schematic: the `$SELECT:` parts to resolve against
   *  this board (pcbnew's own handler, `FindItemsFromSyncSelection` then
   *  `syncSelection`). The nonce makes a repeat of the same request arrive. */
  syncSelection?: { parts: readonly string[]; nonce: number } | null;
  /**
   * The other direction: this board's selection, as the `$SELECT:` parts the
   * schematic resolves — `PCB_EDIT_FRAME::SendSelectItemsToSch`
   * (`pcbnew/cross-probing.cpp:349`). The nonce is what makes selecting the
   * same items twice arrive twice, since it is an event rather than a state.
   */
  onSyncSelectionToSch?: (sel: { parts: readonly string[]; nonce: number }) => void;
  /**
   * This board's highlighted net, as KiCad's `$NET: "<name>"` —
   * `PCB_EDIT_FRAME::SendCrossProbeNetName` (`pcbnew/cross-probing.cpp:405`).
   * null is `SendCrossProbeClearHighlight`.
   */
  onCrossProbeNetToSch?: (net: string | null) => void;
  /** A strip to show above the canvas, e.g. "this demo is not being saved". */
  readOnlyNotice?: JSX.Element | null;
  /**
   * `!fn.IsFileWritable()` — the `[Read Only]` half of the frame title
   * (pcb_edit_frame.cpp:2186-2187). A browser has no per-file writable bit;
   * the condition that stands in for one here is the demo project, which is
   * exactly what {@link readOnlyNotice} already announces above the canvas.
   * The schematic editor has taken the same prop, from the same call site in
   * `App.tsx`, since its title was rebuilt on the shared rule.
   */
  readOnly?: boolean;
  /** Bumped by the schematic editor's Tools > Update PCB from Schematic (F8),
   *  which switches here and then runs the same dialog this frame's own F8 does
   *  (KiCad's SCH_EDIT_FRAME::doUpdatePcb hands off to pcbnew the same way). */
  updateFromSchematic?: number | null;
}): JSX.Element {
  /**
   * `EDA_BASE_FRAME::RecreateToolbars` (`common/eda_base_frame.cpp:1728-1843`):
   * the frame asks `GetToolbarConfig( loc, m_CustomToolbars )` for each bar and
   * never reads `DefaultToolbarConfig` itself, which is what lets Preferences >
   * Toolbars change what is drawn.
   */
  const pcbTopBar = useToolbarEntries('pcbnew', 'TOP_MAIN', PCB_DEFAULT_TOOLBARS);
  const pcbAuxBar = useToolbarEntries('pcbnew', 'TOP_AUX', PCB_DEFAULT_TOOLBARS);
  const pcbLeftBar = useToolbarEntries('pcbnew', 'LEFT', PCB_DEFAULT_TOOLBARS);
  const pcbRightBar = useToolbarEntries('pcbnew', 'RIGHT', PCB_DEFAULT_TOOLBARS);
  const [board, setBoard] = useState<Board | null>(null);
  // Unsaved-changes flag: '*' in the title while modified, Save greys when
  // clean (KiCad's IsContentModified / m_infoBar save affordance).
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const [activeLayer, setActiveLayer] = useState('F.Cu');
  // `getView()->GetTopLayer()`, which every snap reads to prefer items on the
  // layer being worked on. A ref because `draw` reads it without wanting to be
  // rebuilt when the layer changes.
  const activeLayerRef = useRef(activeLayer);
  activeLayerRef.current = activeLayer;
  // Selected layer preset; '---' is the separator row, the default selection
  // like rebuildLayerPresetsWidget.
  const [tab, setTab] = useState<'Layers' | 'Objects' | 'Nets'>('Layers');
  /**
   * `pcbnew.json`, live. `PCB_EDIT_FRAME::CommonSettingsChanged` is what makes
   * an OK on Preferences reach the canvas upstream; subscribing here is that
   * call, and it is why Display Options' Grid Display, Cursor, Annotations and
   * Clearance Outlines groups take effect without a reload.
   */
  const pcbCfg = usePcbnewSettings();
  /**
   * `PANEL_GAL_OPTIONS`' two groups, mirrored into a ref because `draw` is
   * memoised on `startCrispRender` alone and must not be rebuilt whenever a
   * setting moves — the same shape `FootprintCanvas` uses for the same reason.
   */
  const galRef = useRef({
    ...pcbCfg.window.grid,
    ...pcbCfg.window.cursor,
    ...pcbCfg.pcb_display,
  });
  galRef.current = { ...pcbCfg.window.grid, ...pcbCfg.window.cursor, ...pcbCfg.pcb_display };
  /**
   * `EDA_DRAW_FRAME::GetRotationAngle()` in degrees — `editing.rotation_angle`
   * is tenths. A ref because the rotate command is a long-lived keydown
   * handler.
   */
  const rotationStepRef = useRef(90);
  rotationStepRef.current = pcbCfg.editing.rotation_angle / 10;
  /** `MAGNETIC_SETTINGS`, for the snap path, which is not a React consumer. */
  const magneticRef = useRef({ pads: 1, tracks: 1 });
  magneticRef.current = {
    pads: pcbCfg.editing.magnetic_pads,
    tracks: pcbCfg.editing.magnetic_tracks,
  };
  /** `m_ESCClearsNetHighlight` — whether Escape drops the net highlight. */
  const escClearsHighlightRef = useRef(true);
  escClearsHighlightRef.current = pcbCfg.editing.esc_clears_net_highlight;
  /** `GAL::GetGridSnapping()` — Snap to grid, against `window.grid.show`. */
  const gridSnapRef = useRef(true);
  gridSnapRef.current = gridSnappingEnabled(pcbCfg.window.grid.snap, pcbCfg.window.grid.show);
  // …and the other direction: Preferences moved the stored crosshair or Show
  // Grid, so the left toolbar's buttons have to follow. `EDA_DRAW_FRAME::
  // CommonSettingsChanged` re-reads both and the toolbar's conditions repaint
  // off them; this is that, with the toggle set as our condition store.
  const storedCrosshair = pcbCfg.window.cursor.crosshair;
  const storedShowGrid = pcbCfg.window.grid.show;
  const storedCurvedRats = pcbCfg.pcb_display.ratsnest_curved;
  const storedLineMode = pcbCfg.editing.pcb_angle_snap_mode;
  const storedPolar = pcbCfg.editing.polar_coords;
  useEffect(() => {
    setToggles((prev) => {
      const next = new Set(prev);
      for (const id of ['crosshairSmall', 'crosshairFull', 'crosshair45']) next.delete(id);
      next.add(crosshairToggleId(storedCrosshair));
      for (const id of ['lineModeFree', 'lineMode45', 'lineMode90']) next.delete(id);
      next.add(lineModeToggleId(storedLineMode));
      const flag = (id: string, on: boolean): void => {
        if (on) next.add(id);
        else next.delete(id);
      };
      flag('toggleGrid', storedShowGrid);
      flag('ratsnestLineMode', storedCurvedRats);
      flag('togglePolarCoords', storedPolar);
      return next;
    });
  }, [storedCrosshair, storedShowGrid, storedCurvedRats, storedLineMode, storedPolar]);
  // `EDA_DRAW_FRAME::LoadSettings` — the frame opens on what the file holds,
  // not on a hardcoded set. Seeded once: after that the toolbar owns the state
  // and folds its own clicks back into the file (`foldPcbToggle`).
  const [toggles, setToggles] = useState<Set<string>>(() =>
    pcbTogglesFromSettings(settings.pcbnew),
  );
  const unitLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  /**
   * The three status panes that follow the pointer, written through refs.
   *
   * `PCB_BASE_FRAME::UpdateStatusBar` (pcb_base_frame.cpp:761) runs on every
   * cursor motion and calls `SetStatusText`; nothing else on the frame
   * repaints. This frame instead held the cursor in React state and set it
   * from `onPointerMove` — with a fresh `{ x, y }` object, so `Object.is` never
   * matched and React could never bail out. Every mouse move re-rendered the
   * whole editor: both toolbars, the Appearance notebook, the Properties grid,
   * the Selection Filter and the status bar, all before the
   * `requestAnimationFrame` that actually moves the crosshair. That is why the
   * crosshair trailed the pointer here and not in eeschema, which was this
   * hook's only caller. (`setScale( v.scale )` at the end of `draw` is a
   * NUMBER, so React does bail out of that one — which is why zoom never had
   * the same problem.)
   *
   * `localOrigin` is `BASE_SCREEN::m_LocalOrigin`, which pane 3 measures from.
   * There is no Set Local Origin here yet, so it is the page origin — as a
   * module constant, because the hook's repaint effect depends on its identity.
   */
  /**
   * `PCB_BASE_FRAME::GetUserOrigin()` — Preferences > PCB Editor > Origins &
   * Axes' Display Origin group turned into a point:
   *
   *     PCB_ORIGIN_PAGE  -> ( 0, 0 )
   *     PCB_ORIGIN_AUX   -> GetDesignSettings().GetAuxOrigin()
   *     PCB_ORIGIN_GRID  -> GetDesignSettings().GetGridOrigin()
   *
   * Only the frame can answer the last two, which is why the hook takes the
   * point rather than the enum. `boardAuxOrigin` walks the raw s-expression, so
   * it is memoised on the board and not called per pointer move.
   */
  const userOrigin = useMemo(() => {
    if (!board) return PCB_LOCAL_ORIGIN;
    if (pcbCfg.pcb_display.origin_mode === 1) return boardAuxOrigin(board);
    if (pcbCfg.pcb_display.origin_mode === 2) return boardGridOrigin(board);
    return PCB_LOCAL_ORIGIN;
  }, [board, pcbCfg.pcb_display.origin_mode]);
  const statusReadout = useStatusReadout({
    units: unitLabel,
    localOrigin: PCB_LOCAL_ORIGIN,
    devicePixelRatio: window.devicePixelRatio || 1,
    iuPerMM: PCB_IU_PER_MM,
    // `GetShowPolarCoords()` — the same pane, the other branch.
    polar: toggles.has('togglePolarCoords'),
    // Preferences > PCB Editor > Origins & Axes, all three of it.
    userOrigin,
    invertX: pcbCfg.pcb_display.origin_invert_x_axis,
    invertY: pcbCfg.pcb_display.origin_invert_y_axis,
  });
  // Properties pane width. KiCad's PCB_PROPERTIES_PANEL docks at BestSize 300,
  // MinSize 240 (pcb_edit_frame.cpp), and the pane is user-resizable.
  const [propWidth, setPropWidth] = useState(300);
  const [objects, setObjects] = useState<ObjectState>(DEFAULT_OBJECTS);
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  // Appearance pane width: KiCad's LayersManager AUI pane (BestSize ~220, but
  // our rows carry a swatch + eye + label + slider, so start a little wider so
  // the opacity sliders and the net-display radios fit on one line).
  const [appWidth, setAppWidth] = useState(255);
  // High-contrast (inactive layer) mode: HIGH_CONTRAST_MODE Normal/Dim/Hide.
  const [contrast, setContrast] = useState<'normal' | 'dim' | 'hide'>('normal');
  // "Flip board view" (PCB_ACTIONS::flipBoard): mirror the view horizontally.
  const [flipView, setFlipView] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // "Layer Display Options" collapsible pane state (collapsed by default).
  const [layerOptsOpen, setLayerOptsOpen] = useState(false);
  // Layer right-click context menu position (rightClickHandler).
  const [layerMenu, setLayerMenu] = useState<{ x: number; y: number } | null>(null);
  // User layer presets (saved from "Save preset...").
  const [userPresets, setUserPresets] = useState<{ name: string; layers: string[] }[]>([]);
  // Viewports (APPEARANCE_CONTROLS::m_viewports): named view transforms.
  const [viewports, setViewports] = useState<
    { name: string; view: { tx: number; ty: number; scale: number } }[]
  >([]);
  const [viewportSel, setViewportSel] = useState('---');
  // "Delete preset/viewport..." chooser popup.
  const [deleteChooser, setDeleteChooser] = useState<'presets' | 'viewports' | null>(null);
  // Nets tab state: per-net / per-class colors, ratsnest visibility, and the
  // Net Display Options modes (appearance_controls.cpp net display pane).
  const [hiddenNets, setHiddenNets] = useState<ReadonlySet<number>>(new Set());
  const [classColors, setClassColors] = useState<ReadonlyMap<string, string>>(new Map());
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<string>>(new Set());
  const [netColorMode, setNetColorMode] = useState<'all' | 'ratsnest' | 'off'>('ratsnest');
  const [ratsnestMode, setRatsnestMode] = useState<'all' | 'visible' | 'off'>('all');
  const [netOptsOpen, setNetOptsOpen] = useState(false);
  // Pads whose local ratsnest is forced on, keyed `fp:pad`, the tool works at
  // PAD level (BOARD_INSPECTION_TOOL::LocalRatsnestTool toggles
  // PAD::SetLocalRatsnestVisible; a footprint click sets all its pads).
  const [localRats, setLocalRats] = useState<ReadonlySet<string>>(new Set());
  // PROJECT_LOCAL_SETTINGS' `board.selection_filter` defaults, which are the
  // shared table's: everything but "Locked items"
  // (common/project/project_local_settings.cpp:160-172). Ours ticked all
  // twelve, so a fresh board would select locked items.
  const [selFilter, setSelFilter] = useState<Set<string>>(
    new Set(DEFAULT_SELECTION_FILTER_OPTIONS),
  );
  // Right-click "Only <category>" popup of the Selection Filter panel
  // (PANEL_SELECTION_FILTER::onRightClick).
  const [filterMenu, setFilterMenu] = useState<{
    x: number;
    y: number;
    item: SelectionFilterItem;
  } | null>(null);
  // Net highlight (BOARD_INSPECTION_TOOL): the set of net codes currently
  // highlighted. When non-empty the whole board dims and these nets' copper
  // pops (pcb_painter.cpp getColor: highlighted → Brightened, else Darkened).
  // Picked with the backtick hotkey / cleared with '~'; the left-toolbar
  // "Toggle Net Highlight" button shows/hides the last highlight set.
  const [highlightNets, setHighlightNets] = useState<ReadonlySet<number>>(new Set());
  const highlightNetsRef = useRef<ReadonlySet<number>>(highlightNets);
  highlightNetsRef.current = highlightNets;
  // The previously-shown highlight set, restored by the toggle button/Alt+`
  // (BOARD_INSPECTION_TOOL::m_lastHighlighted).
  const lastHighlightRef = useRef<ReadonlySet<number>>(new Set());
  // Cross-probe from the schematic's net highlight: the net name arrives here
  // and is resolved against the board's net table, exactly as pcbnew's
  // "$NET: <name>" express-mail handler does.
  useEffect(() => {
    if (crossProbeNet === undefined) return;
    const brd = boardRef.current;
    if (!brd) return;
    // null is "$NET:" refused because auto_highlight is off
    // (pcbnew/cross-probing.cpp:140): the probe returns before touching the
    // highlight, so whatever is lit stays lit. 0 is "no such net", which does
    // clear it.
    const code = crossProbeHighlightNet(settings.pcbnew.cross_probing, brd, crossProbeNet);
    if (code === null) return;
    setHighlightNets((prev) => {
      if (code <= 0) return prev.size === 0 ? prev : new Set();
      if (prev.size === 1 && prev.has(code)) return prev;
      return new Set([code]);
    });
  }, [crossProbeNet]);
  const [activeTool, setActiveTool] = useState('selectSetRect');
  // Selected board items (PCB_SELECTION_TOOL's selection), by `${kind}:${index}` id.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());

  /**
   * `SendCrossProbeNetName` / `SendCrossProbeClearHighlight`: the board's
   * highlight, named, going the other way.
   *
   * One net, because the packet carries one — a multi-net highlight
   * (`$NETS:`) has no schematic-side equivalent here, so the first is sent, as
   * the schematic side already does when a CHAIN is highlighted.
   */
  useEffect(() => {
    if (!onCrossProbeNetToSch) return;
    const brd = boardRef.current;
    if (!brd) return;
    const first = [...highlightNets][0];
    onCrossProbeNetToSch(first === undefined ? null : (brd.nets.get(first) ?? null));
  }, [highlightNets, onCrossProbeNetToSch]);

  /**
   * Send this selection to the schematic — `PCB_EDIT_FRAME::SendSelectItemsToSch`,
   * which `PCB_SELECTION_TOOL` calls whenever the selection settles.
   *
   * The nonce comes from the parts themselves rather than a counter: re-sending
   * an identical packet is what upstream's `aForce` is for, and this side never
   * forces, so a selection that has not changed has nothing to say. An empty
   * selection still sends — that is how the schematic learns to clear its own.
   */
  const lastPartsRef = useRef<string>('');
  const syncNonceRef = useRef(0);
  useEffect(() => {
    if (!onSyncSelectionToSch) return;
    const brd = boardRef.current;
    if (!brd) return;
    const parts = boardSyncSelectionParts(brd, selection);
    const key = parts.join(',');
    if (key === lastPartsRef.current) return;
    lastPartsRef.current = key;
    syncNonceRef.current += 1;
    onSyncSelectionToSch({ parts, nonce: syncNonceRef.current });
  }, [selection, onSyncSelectionToSch]);
  // Disambiguation menu (PCB_SELECTION_TOOL::doSelectionMenu): shown at a click
  // that hits several equally-plausible items so the user can pick one.
  const [disambig, setDisambig] = useState<{
    x: number;
    y: number;
    ids: string[];
    additive: boolean;
  } | null>(null);
  const [show3D, setShow3D] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  /** DIALOG_PASTE_SPECIAL, opened only by `ACTIONS::pasteSpecial`. */
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moveExactOpen, setMoveExactOpen] = useState(false);
  const [posRelOpen, setPosRelOpen] = useState(false);
  // Fillet / chamfer prompts. Upstream keeps the last value in a
  // function-static, so it reopens on whatever was typed last.
  const [lineModOpen, setLineModOpen] = useState<'fillet' | 'chamfer' | 'dogbone' | null>(null);
  const [outsetOpen, setOutsetOpen] = useState(false);
  const [pnsSettingsOpen, setPnsSettingsOpen] = useState(false);
  const [arrayOpen, setArrayOpen] = useState(false);
  // Kept across openings, as upstream persists its ARRAY_OPTIONS.
  const [arraySettings, setArraySettings] = useState<ArraySettings>(DEFAULT_ARRAY_SETTINGS);
  // Kept across openings, as upstream keeps its PARAMETERS on the tool.
  const [outsetSettings, setOutsetSettings] = useState<OutsetSettings>(DEFAULT_OUTSET_SETTINGS);
  const [filletRadius, setFilletRadius] = useState(1_000_000);
  const [chamferSetback, setChamferSetback] = useState(1_000_000);
  const [dogboneRadius, setDogboneRadius] = useState(1_000_000);
  // The reference item for Position Relative, chosen by clicking the canvas
  // (upstream arms PCB_PICKER_TOOL for this). Kept across openings, as upstream
  // keeps its dialog alive between calls.
  const [posRelRef, setPosRelRef] = useState<{ id: string; label: string } | null>(null);
  const pickingRefItem = useRef(false);
  // Mirrors the ref for rendering: the click handler needs a ref (it is not
  // rebuilt per render), the banner needs state.
  const [pickingRefShown, setPickingRefShown] = useState(false);
  // The Filter Selection *dialog*'s options — distinct from `selFilter` above,
  // which is the toolbar panel deciding what a click can pick up. This one
  // narrows an existing selection once, and is kept across openings as
  // PCB_SELECTION_TOOL keeps its OPTIONS on the tool.
  const [filterOpts, setFilterOpts] = useState<SelectionFilter>(DEFAULT_SELECTION_FILTER);
  // Live (world) cursor position read by draw()'s crosshair pass without
  // re-creating the callback; null when the pointer is off the canvas.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  // The two snap modifiers, as the tool events carry them.
  //
  // Shift disables snapping to *items*, leaving the plain grid
  // (`m_gridHelper->SetSnap( !aEvent.Modifier( MD_SHIFT ) )`); Ctrl disables
  // the *grid*, which is `TOOL_EVENT::DisableGridSnapping()` — literally
  // `Modifier( MD_CTRL )` (tool_event.h:367) — and every tool feeds it to
  // `SetUseGrid( GetGridSnapping() && !evt->DisableGridSnapping() )`.
  //
  // Both are tracked on key events as well as pointer events. Sampling them
  // only on pointer move means pressing or releasing a modifier with the mouse
  // held still changes nothing until the pointer is jiggled, and upstream
  // reacts at once because the modifier arrives as its own tool event.
  const shiftDownRef = useRef(false);
  /** `GetUserUnits()`, for the paint pass — `unitLabel` is computed far below. */
  const unitsRef = useRef<StatusUnits>('mm');
  const ctrlDownRef = useRef(false);
  const [scale, setScale] = useState(0);
  // Active grid size (the TOP_AUX grid selector; EDA_DRAW_FRAME's grid list).
  //
  // Seeded from `window.grid.last_size_idx` and written back on every change,
  // which is what carries the choice across a reload: `COMMON_TOOLS::GridPreset`
  // takes an `int&` straight into the settings object and mutates it in place
  // (`common_tools.cpp:536`), so upstream never writes it explicitly either.
  const [gridIU, setGridIU] = useState(() => storedPcbGridIU());
  const gridIURef = useRef(gridIU);
  gridIURef.current = gridIU;
  /** {@link setGridIU}, plus the write-back that makes the choice survive. */
  const setGridIUStored = useCallback((iu: number) => {
    setGridIU(iu);
    settings.updatePcbnew((s) => {
      const idx = pcbGridSizesIU(s).indexOf(iu);
      if (idx >= 0) s.window.grid.last_size_idx = idx;
    });
  }, []);
  // The board's own grid origin (`(setup (grid_origin))`), which pcbnew hands
  // to the GAL on open (pcb_base_edit_frame.cpp) and which both the dots and
  // the snap are measured from. A ref because `draw` and the pointer handlers
  // read it without wanting to be rebuilt when the board object is replaced.
  const gridOriginRef = useRef<{ x: number; y: number }>(PCB_DEFAULT_GRID_ORIGIN);
  gridOriginRef.current = useMemo(
    () => (board ? boardGridOrigin(board) : PCB_DEFAULT_GRID_ORIGIN),
    [board],
  );
  // `GRID_HELPER::m_auxAxis` — the point the current gesture started from, kept
  // reachable for its whole duration so an off-grid item can be put back
  // exactly where it came from. Set at the start of a move/drag and cleared
  // when it ends, as `ROUTER_TOOL` (router_tool.cpp:2190, :2654) and
  // `EDIT_TOOL` (edit_tool_move_fct.cpp:1401) do.
  const auxAxisRef = useRef<{ x: number; y: number } | null>(null);
  // `PCB_GRID_HELPER`'s state, as the ported Align / AlignToSegment /
  // AlignToArc read it. Rebuilt per call rather than held, because the two
  // flags upstream pokes onto a long-lived helper (`SetUseGrid`, `SetSnap`)
  // are both derived here: grid snapping follows the toggle, and `enableSnap`
  // is cleared while Shift is held, exactly as `TOOL_BASE::updateEndItem` does
  // with `SetSnap( !aEvent.Modifier( MD_SHIFT ) )`.
  const gridState = (): PcbGridState => ({
    size: gridIURef.current,
    origin: gridOriginRef.current,
    // `PCB_GRID_HELPER::canUseGrid()` = `GetGridSnapping()` AND no Ctrl.
    // `GAL::GetGridSnapping` is the Snap to grid choice on Display Options —
    // ALWAYS, WITH_GRID (only while the grid is shown) or NEVER — which is why
    // the predicate is shared with every other editor rather than being the
    // modifier alone, as it was here.
    enableGrid: gridSnapRef.current && !ctrlDownRef.current,
    enableSnap: !shiftDownRef.current,
    auxAxis: auxAxisRef.current,
  });
  /**
   * What the drawing sheet is drawn from — `DS_PROXY_VIEW_ITEM`'s properties.
   *
   * One function because two callers must not disagree: the painter, and the
   * double-click hit test that opens Page Settings. A hit test built from a
   * different title block than the one on screen answers about a sheet the user
   * cannot see.
   */
  const sheetInfoOf = (
    brd: Board,
  ): { paper?: string; titleBlock?: Board['titleBlock']; fileName: string } => ({
    paper: brd.paper,
    titleBlock: brd.titleBlock,
    fileName,
  });

  // Every grid snap in the editor, through the one function upstream uses.
  // Calling `computeNearest` directly anywhere would bypass the auxiliary axis
  // and quantise the gesture's origin away again — which is the bug this is
  // here to prevent, so there is deliberately no other route to the grid.
  const snapToGrid = (p: { x: number; y: number }): { x: number; y: number } =>
    align(p, gridState());
  // Where the routing crosshair actually goes — `controls()->ForceCursorPosition(
  // true, m_endSnapPoint )` at the end of `TOOL_BASE::updateEndItem`. `draw` is
  // memoised long before `copperAt` exists, so it reads the live one off a ref
  // that is re-pointed below once `copperAt` is in scope.
  const routeSnapRef =
    useRef<(w: { x: number; y: number }) => { x: number; y: number }>(snapToGrid);
  // The crosshair sticks to copper only while routing. In pcbnew the general
  // cursor does not: a track contributes its two ends as `CORNER | SNAPPABLE`
  // anchors and its midpoint as `ORIGIN` *without* `SNAPPABLE`
  // (pcb_grid_helper.cpp:1796-1808), and `BestSnapAnchor` weighs only the
  // snappable ones — so nothing there can pull the selection cursor onto the
  // middle of a track. That behaviour belongs to the router alone.
  // Held in a ref, like everything else `draw` reads: `draw` is a useCallback,
  // and closing over a function rebuilt each render would put it in the
  // dependency list and rebuild the whole draw pass on every keystroke.
  const cursorSnapRef =
    useRef<(w: { x: number; y: number }) => { x: number; y: number }>(snapToGrid);
  cursorSnapRef.current = (w) => {
    if (activeToolRef.current === 'routeSingleTrack' || routeRef.current)
      return routeSnapRef.current(w);

    // The plain selection tool does not snap to items on hover in pcbnew:
    // nothing in `PCB_SELECTION_TOOL`'s motion path calls `BestSnapAnchor`,
    // while the drawing, placement, picker and move tools all do.
    if (!isClickTool(activeToolRef.current)) return snapToGrid(w);

    const brd = boardRef.current;

    if (!brd) return snapToGrid(w);

    return bestSnapAnchor(brd, w, gridState(), {
      // `view->ToWorld( 25 )` and `view->ToWorld( m_SnapHysteresis )`.
      snapScale: 25 / viewRef.current.scale,
      hysteresis: 5 / viewRef.current.scale,
      visibleGrid: gridIURef.current,
      layer: activeLayerRef.current,
      // `MAGNETIC_SETTINGS` — Preferences > PCB Editor > Editing Options'
      // Magnetic Points group. `bestSnapAnchor` already took these three and
      // defaulted them to CAPTURE_ALWAYS, so "Snap to pads: Never" captured
      // anyway; this is the frame finally passing what it was asked.
      //
      // The intermediate value is CAPTURE_CURSOR_IN_TRACK_TOOL, and this is
      // NOT the track tool — the router has its own snap path
      // (`routeSnapRef`) — so it reads here as off, which is what
      // `PCB_GRID_HELPER::computeAnchors`' `== CAPTURE_ALWAYS` test does.
      magneticPads: magneticRef.current.pads,
      magneticTracks: magneticRef.current.tracks,
    });
  };
  // TOP_AUX track-width / via-size selections: index 0 = "use netclass",
  // 1.. = the pre-defined list entries (BOARD_DESIGN_SETTINGS m_TrackWidthList /
  // m_ViasDimensionsList; ours come from the project's netclasses).
  const [trackSel, setTrackSel] = useState(0);
  const [viaSel, setViaSel] = useState(0);
  /**
   * `BOARD_DESIGN_SETTINGS::m_UseConnectedTrackWidth` — the TOP_AUX
   * "Automatically select track width" toggle, `false` in the constructor
   * (board_design_settings.cpp:71). The button's checked state is this value
   * (pcb_edit_frame.cpp:1250), and the router reads it through
   * `inheritTrackWidth`.
   */
  const [autoTrackWidth, setAutoTrackWidth] = useState(false);
  const autoTrackWidthRef = useRef(autoTrackWidth);
  autoTrackWidthRef.current = autoTrackWidth;
  const trackSelRef = useRef(trackSel);
  trackSelRef.current = trackSel;
  const viaSelRef = useRef(viaSel);
  viaSelRef.current = viaSel;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0, flipX: false });
  const boardRef = useRef<Board | null>(null);
  // Live selection read by draw()'s overlay pass without re-creating the callback.
  const selForDrawRef = useRef<ReadonlySet<string>>(selection);
  selForDrawRef.current = selection;
  // The in-progress rubber-band marquee (world coords), read by the overlay pass.
  const boxRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  // Live drag-move offset (world units) applied to the selection highlight while
  // a move gesture is in flight; committed on pointer-up (PCB_MOVE_TOOL preview).
  const moveDeltaRef = useRef<{ x: number; y: number } | null>(null);
  const movingRef = useRef(false);
  // Move (M / left-drag) leaves the routing behind; Drag (G) stretches the
  // traces attached to the moving footprints (EDIT_TOOL Move vs Drag). Drag mode
  // is on only while a 'drag' gesture actually has footprints to carry traces.
  const moveKindRef = useRef<'move' | 'drag'>('move');
  const dragModeRef = useRef(false);
  // The exact selection captured at gesture start (applySelect is async) plus,
  // for a drag, the ids excluded from the backdrop raster (part + its traces),
  // and the world grab origin the delta is measured from.
  const movingSelRef = useRef<ReadonlySet<string>>(new Set());
  const dragAffectedRef = useRef<ReadonlySet<string>>(new Set());
  // A router drag of a trace (EDIT_TOOL::Drag → PNS::DRAGGER): the whole line is
  // re-cut every frame rather than translated, so it runs beside the move refs.
  const trackDragRef = useRef<TrackDrag | null>(null);
  // `TOOL_BASE::m_startItem` — the one segment the drag grabbed, and the whole
  // of `pickSingleItem`'s `aAvoidItems`. Its *neighbours* stay snappable on
  // purpose: they still hold the line's original geometry, so bringing the
  // cursor back over them lands it on the centreline the trace started on.
  const dragSeedIdRef = useRef<string | null>(null);
  /** The net highlight to restore when a track drag ends, or null if none. */
  const dragHighlightRestoreRef = useRef<ReadonlySet<number> | null>(null);
  // Zone outline editing (PCB_POINT_EDITOR): the handles of the one selected
  // item, which handle the cursor is over, and the drag in flight.
  const editHandlesRef = useRef<BoardEditHandle[]>([]);
  /** The item the handles belong to, as a board item id. */
  const editHandleItemRef = useRef<string | null>(null);
  const hoveredEditHandleRef = useRef<BoardEditHandle | null>(null);
  const editHandleDragRef = useRef<{
    handle: BoardEditHandle;
    origin: { x: number; y: number };
  } | null>(null);
  /** The reshaped board while a handle drag is in flight, committed on release. */
  const pointEditPreviewRef = useRef<Board | null>(null);
  const moveOriginRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * `grid.BestDragOrigin( originalMousePos, sel_items, … )` — the anchor **on
   * the selection** that a move measures itself from, and the whole reason
   * dragging a part in KiCad lines it up with the next one.
   *
   * `EDIT_TOOL::Move` warps the pointer onto this point ("Warp mouse to origin
   * of moved object", on by default) and then only ever moves the selection by
   * `BestSnapAnchor( mousePos ) - prevPos` with `prevPos` starting here — so the
   * anchor lands *absolutely* on a grid node or another item's anchor. A
   * delta-based move cannot do that: quantising the travel keeps whatever
   * sub-grid offset the part already had, forever.
   *
   * We cannot warp a browser pointer, and do not need to: with the warp,
   * upstream's mouse position is this anchor plus the motion since the grab, so
   * {@link updateMove} adds that motion here and snaps the result instead.
   */
  const moveAnchorRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * `controls->ForceCursorPosition( true, m_cursor )` (edit_tool_move_fct.cpp:1174):
   * while a move is in flight the drawn crosshair is the *move's* cursor — the
   * point the drag anchor has been snapped to — and not the pointer's own grid
   * round. Upstream the two are the same point because the pointer was warped
   * onto the anchor; here they differ by the grab offset, so the crosshair has
   * to be told which one to draw or it marks a place nothing is going.
   */
  const forcedCursorRef = useRef<{ x: number; y: number } | null>(null);
  // Keyboard grab (M/G): the selection follows the cursor until a click commits
  // or Esc cancels, SCH/PCB move tool. Distinct from a left-button drag.
  const grabbingRef = useRef(false);
  /**
   * `WX_VIEW_CONTROLS::m_panTimer` and the AUTO_PANNING state, per canvas.
   *
   * `enabled` is `m_autoPanEnabled`, which upstream every move and drawing
   * tool brackets its loop with (`SetAutoPan( true/false )`) — so autopan
   * runs while an item is in flight or a rubber band is being framed, and
   * never on an idle hover.
   */
  const autoPanRef = useRef(
    makeAutoPan({
      viewportPx: () => ({
        width: canvasRef.current?.width ?? 0,
        height: canvasRef.current?.height ?? 0,
      }),
      enabled: () => movingRef.current || grabbingRef.current || boxRef.current !== null,
      // `SetCenter( center + dir )`: the centre moves WITH dir, so the
      // translation moves against it.
      panBy: (dx, dy) => {
        const v = viewRef.current;
        v.tx -= dx;
        v.ty -= dy;
        requestDraw();
      },
    }),
  );
  // While a move is in flight the base raster is the board with the moving items
  // removed; this scene holds just those items, painted live at the drag offset
  // so the real geometry follows the cursor (not merely its bounding box).
  const moveSceneRef = useRef<BoardScene | null>(null);
  // Selected items, compiled on their own so they can be repainted brightened
  // over the raster, KiCad's selection is the item's colour Brightened(0.8),
  // not a bounding box (pcb_painter.cpp getColor).
  const selSceneRef = useRef<BoardScene | null>(null);
  // Whole-board snapshot undo/redo (EDIT_TOOL's SaveCopyInUndoList).
  const undoRef = useRef<Board[]>([]);
  const redoRef = useRef<Board[]>([]);
  // The rows the disambiguation menu is pointing at, and their geometry.
  //
  // `doSelectionMenu` answers TA_CHOICE_MENU_UPDATE with
  // `highlight( item, BRIGHTENED, &highlightGroup )` — the item itself,
  // repainted brighter on the select overlay. A set, not one id, because
  // pointing at "Select All" brightens every candidate at once.
  const hoverRef = useRef<ReadonlySet<string> | null>(null);
  const hoverSceneRef = useRef<BoardScene | null>(null);
  // Mirror of `disambig` open-state for the global Escape handler (no re-subscribe).
  const disambigRef = useRef(false);
  disambigRef.current = !!disambig;
  // Mirror of the active right-toolbar tool for the pointer/Escape handlers.
  const activeToolRef = useRef('selectSetRect');
  activeToolRef.current = activeTool;
  // Leaving the local ratsnest tool clears the forced-on set, like upstream.
  useEffect(() => {
    if (activeTool !== 'localRatsnestTool') setLocalRats(new Set());
  }, [activeTool]);
  // In-flight graphic shape (DRAWING_TOOL): the points clicked so far.
  const drawingRef = useRef<{ x: number; y: number }[]>([]);
  // In-flight route (ROUTER_TOOL): net, copper layer, last committed point,
  // and the net class routing dimensions picked up at start.
  const routeRef = useRef<{
    net: number;
    layer: string;
    last: { x: number; y: number };
    dims: ClassDims;
  } | null>(null);
  // Pending "Add Text" dialog: where the text will be placed.
  // Page Settings / Print dialogs (DIALOG_PAGES_SETTINGS / DIALOG_PRINT_PCBNEW).
  // The tab title (PCB_EDIT_FRAME::UpdateTitle): the board file, its project,
  // and a leading * while there are unsaved changes.
  useDocumentTitle(
    'pcb',
    formatTitle(
      PCB_FRAME_NAME,
      projectName ? `${fileName.split('/').pop()!} [${projectName}]` : fileName,
      dirty,
    ),
  );

  const [pageDlgOpen, setPageDlgOpen] = useState(false);
  const [printDlgOpen, setPrintDlgOpen] = useState(false);
  const [plotDlgOpen, setPlotDlgOpen] = useState(false);
  // Folders that already exist in the project, relative to the project's own
  // folder, the Plot dialog's "Output directory:" choices (the cloud file
  // manager stands in for upstream's wxDirDialog).
  const projectFolders = useMemo(() => {
    const files = projectFiles ?? [];
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name))?.name.replace(/\\/g, '/');
    const prefix = pro?.includes('/') ? pro.slice(0, pro.lastIndexOf('/') + 1) : '';
    const dirs = new Set<string>();
    for (const f of files) {
      const p = f.name.replace(/\\/g, '/');
      if (prefix && !p.startsWith(prefix)) continue;
      const rel = p.slice(prefix.length);
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (dir) dirs.add(dir);
    }
    return [...dirs];
  }, [projectFiles]);
  // Board Setup (DIALOG_BOARD_SETUP). Hydrated from the project's .kicad_pro
  // + the board file's setup sections + the .kicad_dru; committed back to all
  // three on OK (see commitBoardSetup below).
  const [boardSetupOpen, setBoardSetupOpen] = useState(false);
  // ShowBoardSetupDialog( _( "Net Classes" ) ) — the Appearance panel's wrench
  // opens Board Setup already on that page, not on its first one.
  const [boardSetupPage, setBoardSetupPage] = useState<'netclasses' | undefined>(undefined);
  // DRC dialog (DIALOG_DRC), the engine runs in-browser over the live board.
  // The dialog is modeless like upstream; the violations become PCB_MARKERs
  // that stay on the board until the next run / Delete All Markers, and the
  // active violation is the brightened (highlighted) marker.
  const [drcOpen, setDrcOpen] = useState(false);
  // Edit Teardrops (DIALOG_GLOBAL_EDIT_TEARDROPS).
  const [teardropsOpen, setTeardropsOpen] = useState(false);
  // Track & Via Properties (DIALOG_TRACK_VIA_PROPERTIES), opened by E or a
  // double-click on a copper item.
  const [trackViaOpen, setTrackViaOpen] = useState(false);
  // Copper Zone Properties (DIALOG_COPPER_ZONE), on the selected zone.
  const [zonePropsIndex, setZonePropsIndex] = useState<number | null>(null);
  // Footprint Properties (DIALOG_FOOTPRINT_PROPERTIES), board side.
  const [fpPropsIndex, setFpPropsIndex] = useState<number | null>(null);
  // Pad Properties (DIALOG_PAD_PROPERTIES), board side.
  const [padPropsRef, setPadPropsRef] = useState<PadRef | null>(null);
  // Text / Shape properties for board graphics.
  const [textPropsIndex, setTextPropsIndex] = useState<number | null>(null);
  const [shapePropsIndex, setShapePropsIndex] = useState<number | null>(null);
  const [dimensionPropsIndex, setDimensionPropsIndex] = useState<number | null>(null);
  const [textBoxPropsIndex, setTextBoxPropsIndex] = useState<number | null>(null);
  const [imagePropsIndex, setImagePropsIndex] = useState<number | null>(null);
  const [tablePropsIndex, setTablePropsIndex] = useState<number | null>(null);
  /**
   * A text box drawn but not yet confirmed. Upstream opens the properties
   * dialog straight after the second click and throws the box away if it is
   * cancelled, so it is not on the board until OK.
   */
  const [pendingTextBox, setPendingTextBox] = useState<Omit<PcbTextBox, 'source'> | null>(null);
  /** The first corner of a text box being drawn. */
  const textBoxStartRef = useRef<{ x: number; y: number } | null>(null);
  /** A table drawn but not yet confirmed; its dialog decides whether it stays. */
  const [pendingTable, setPendingTable] = useState<Omit<PcbTable, 'source'> | null>(null);
  /** The first corner of a table being drawn. */
  const tableStartRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * The same fact as `tableStartRef`, as state, because the cursor is chosen at
   * render time and a ref does not re-render. `DrawTable`'s `setCursor` swaps
   * PENCIL for MOVING the moment the first corner is down.
   */
  const [tableDragging, setTableDragging] = useState(false);
  /** Set both together, so the cursor can never disagree with the preview. */
  const setTableStart = (at: { x: number; y: number } | null): void => {
    tableStartRef.current = at;
    setTableDragging(at !== null);
  };
  // Update PCB from Schematic (DIALOG_UPDATE_PCB). The netlist is fetched from the
  // project's schematic before the dialog opens, together with every footprint it
  // names, the updater itself is synchronous, exactly like upstream, so the
  // libraries have to be in hand first (upstream's adapter->BlockUntilLoaded).
  const [updatePcb, setUpdatePcb] = useState<{
    netlist: NETLIST;
    library: Map<string, PcbFootprint>;
  } | null>(null);
  const [updatePcbBusy, setUpdatePcbBusy] = useState(false);
  const [updatePcbError, setUpdatePcbError] = useState<{
    message: string;
    details?: string;
  } | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. An OK-only message box still cancels on Esc: wx sends
  // wxID_CANCEL whether or not a Cancel button exists.
  useModalEscape(() => setUpdatePcbError(null), updatePcbError !== null);
  const [drcResults, setDrcResults] = useState<DrcViolation[] | null>(null);
  const [drcSelected, setDrcSelected] = useState<number | null>(null);
  const drcMarkersRef = useRef<DrcMarkerDraw[]>([]);
  const drcDialogRef = useRef<HTMLDivElement | null>(null);
  const [boardSetup, setBoardSetup] = useState<BoardSetupValues>(defaultBoardSetup);
  // Latest texts this editor wrote for project-side files: the projectFiles
  // prop is a load-time snapshot (App persists to storage without refreshing
  // the prop), so without this overlay a hydrate after a board save, or a
  // second dialog OK, would read/merge stale text. Each entry remembers the
  // prop text it was derived from (`base`): it applies only while the prop
  // still holds that text, and drops automatically when a genuine reload
  // delivers fresh content.
  const projectFileEditsRef = useRef<Map<string, { base: string; text: string }>>(new Map());
  const projectFilesNow = useCallback((): { name: string; text: string }[] => {
    const edits = projectFileEditsRef.current;
    return (projectFiles ?? []).map((f) => {
      const entry = edits.get(f.name);
      if (!entry) return f;
      if (entry.base !== f.text && entry.text !== f.text) {
        edits.delete(f.name); // the prop moved on: our overlay is obsolete
        return f;
      }
      return { name: f.name, text: entry.text };
    });
  }, [projectFiles]);
  // `BOARD_DESIGN_SETTINGS::m_ZoneLayerProperties` as the zone filler wants it:
  // IU, keyed by canonical layer name. The Board Setup > Zone Hatch Offsets page
  // edits it in mm, which is this module's convention for a settings slice.
  const hatchingOffsets = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [layer, props] of Object.entries(boardSetup.zoneLayerProperties)) {
      if (props.hatchingOffset)
        out[layer] = {
          x: Math.round(props.hatchingOffset.x * MM),
          y: Math.round(props.hatchingOffset.y * MM),
        };
    }
    return out;
  }, [boardSetup.zoneLayerProperties]);
  const boardSetupRef = useRef(boardSetup);
  boardSetupRef.current = boardSetup;

  // BOARD_DESIGN_SETTINGS::GetLayerClass, the Text & Graphics Defaults row
  // for a layer (silk / copper / edges / courtyard / fab / other).
  const layerClassRow = (layer: string): TextGfxRow => {
    const rows = boardSetupRef.current.textGraphics.rows;
    const i = /\.SilkS$/.test(layer)
      ? 0
      : /\.Cu$/.test(layer)
        ? 1
        : layer === 'Edge.Cuts'
          ? 2
          : /\.CrtYd$/.test(layer)
            ? 3
            : /\.Fab$/.test(layer)
              ? 4
              : 5;
    return rows[i] ?? rows[5]!;
  };
  // GetLineThickness(layer): the Board Setup default width for new graphics,
  // with the factory constant as a safety net for a zeroed row.
  const shapeWidthIU = (layer: string): number =>
    Math.round(layerClassRow(layer).lineThickness * MM) || defaultShapeWidth(layer);
  // Find dialog (DIALOG_FIND): query, options, hit cursor + status line.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findOpts, setFindOpts] = useState<PcbFindOptions>(DEFAULT_PCB_FIND);
  const [findStatus, setFindStatus] = useState('');
  const findHitsRef = useRef<{ id: string; pos: { x: number; y: number } }[]>([]);
  const findCursorRef = useRef(-1);
  // A query/options change restarts the search (DIALOG_FIND::search(true)).
  const findDirtyRef = useRef(true);
  const [textDialog, setTextDialog] = useState<{ x: number; y: number } | null>(null);
  /**
   * The barcode properties dialog. `at` is where the click landed for a new
   * one; `index` names an existing barcode being edited instead
   * (`EDIT_TOOL::Properties`).
   */
  const [barcodeDialog, setBarcodeDialog] = useState<{
    at: { x: number; y: number };
    index?: number;
  } | null>(null);
  const [textDraft, setTextDraft] = useState('');
  // Pending "Copper Zone Properties" dialog: the zone's first corner.
  const [zoneDialog, setZoneDialog] = useState<{ x: number; y: number } | null>(null);
  const [zoneNet, setZoneNet] = useState(0);
  const [zoneLayer, setZoneLayer] = useState('F.Cu');
  // In-flight zone outline (DRAWING_TOOL::DrawZone after the dialog).
  const zoneRef = useRef<{ net: number; layer: string; pts: { x: number; y: number }[] } | null>(
    null,
  );
  // Measure tool ruler: first point, and the frozen second point once clicked.
  const measureRef = useRef<{
    a: { x: number; y: number };
    b: { x: number; y: number } | null;
  } | null>(null);
  /** The dimension being placed (DRAWING_TOOL::DrawDimension's in-flight item). */
  const dimensionRef = useRef<DimensionDraw | null>(null);
  /** The reference image being placed (`DRAWING_TOOL::PlaceReferenceImage`). */
  const placeImageRef = useRef<ImagePlaceState>(startPlaceImage());
  /**
   * Decoded reference-image pixels. A ref, not state: the map is mutated in
   * place and the redraw is what publishes it, so making it state would rebuild
   * the draw options on every decode for no gain.
   */
  const imageCacheRef = useRef(new ReferenceImageCache());
  // Switching tools abandons the in-flight shape/route/zone/ruler/dimension.
  useEffect(() => {
    drawingRef.current = [];
    routeRef.current = null;
    zoneRef.current = null;
    measureRef.current = null;
    dimensionRef.current = null;
    textBoxStartRef.current = null;
    setTableStart(null);
    placeImageRef.current = startPlaceImage();
  }, [activeTool]);
  const sceneRef = useRef<BoardScene | null>(null);
  /**
   * The WebGL layer, and whether it is the one drawing.
   *
   * `glOkRef` is what the *scene compiler* keys off, not `glRef.current`: a
   * scene built through `GL_PATH_FACTORY` holds paths a 2D canvas cannot draw,
   * and one built through `Path2D` holds paths the recorder reads as empty. So
   * the two have to be decided together, and a context loss has to rebuild the
   * scene rather than just switch the draw path — otherwise the fallback shows
   * an empty board with no error, which is the failure mode this whole layer is
   * most able to hide.
   */
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<PcbGl | null>(null);
  const glOkRef = useRef(false);
  /**
   * Everything drawn *above* the board: selection, ratsnest, previews, markers,
   * the crosshair.
   *
   * The board's own canvas keeps the background, the grid and the drawing
   * sheet, which sit *below* it. Splitting the two is what lets a retained
   * layer go between them at all, and the cut is exactly where the raster blit
   * used to be, so nothing changes order. Mounted only with the GL renderer;
   * without it `draw` gets the one context back and paints as it always did.
   */
  const overCanvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * This board carries a reference image, so it stays on the 2D canvas.
   *
   * `GlRecorder.drawImage` is a no-op — the recorder has no way to put a bitmap
   * in a vertex buffer — so a board with a picture on it would simply lose the
   * picture. One-way on purpose: deleting the last image does not hand the
   * board back to the GPU until the editor is reopened, which is worth it to
   * keep every scene rebuild a single compile rather than a speculative one
   * followed by a corrective one.
   */
  const glBlockedRef = useRef(false);
  /** Whether the scene on hand was compiled with GL paths (drawn by the GPU). */
  const sceneIsGlRef = useRef(false);
  const sceneFactory = (): ScenePathFactory =>
    glOkRef.current && !glBlockedRef.current ? GL_PATH_FACTORY : DOM_PATH_FACTORY;
  /**
   * Compile the board for whichever backend is drawing it.
   *
   * Only the *main* scene goes through this. The selection, move, highlight and
   * net-colour scenes stay `Path2D`: they are painted onto the 2D overlay, they
   * are small subsets, and the move overlay needs a translated view that the
   * retained buffer has no way to express.
   */
  /**
   * GetOwnClearance for the pad-clearance outlines, the common-case rule: the
   * net's class clearance (first matching assignment, else Default), floored
   * by the board's minimum-clearance rule. Values come from Board Setup, so
   * boards whose Default class is not netclass.cpp's 0.2 mm draw their rings
   * at the size pcbnew does (this demo's Default says 0.15 mm).
   */
  const clearanceForNet = (netName: string): number => {
    const nc = boardSetupRef.current.netClasses;
    const minClr = (boardSetupRef.current.constraints.minClearanceMM ?? 0) * MM;
    const className = netClassFor(netName, nc.assignments);
    const cls = nc.classes.find((c) => c.name === className) ?? nc.classes[0];
    const clr = Number.parseFloat(cls?.clearance ?? '');
    return Math.max(Number.isFinite(clr) ? clr * MM : 0.2 * MM, minClr);
  };
  /**
   * `BOARD::ResolveTextVar` (`pcbnew/board.cpp`), reached from
   * `PCB_TEXT::GetShownText`: the project's text variables — the Text Variables
   * page's rows — plus the two board tokens that need no title block.
   * Unresolved names are left verbatim by `expandTextVars`, as upstream leaves
   * them.
   *
   * Not resolved here: the title-block tokens (ISSUE_DATE, REVISION, COMPANY,
   * COMMENT1-9) and `LAYER`, which is per drawn item rather than per board.
   */
  const resolveTextVar = (token: string): string | undefined => {
    const vars = boardSetupRef.current.textVars;
    const hit = vars.find((v) => v.name === token);
    if (hit) return hit.value;
    if (token === 'PROJECTNAME') return projectName || undefined;
    if (token === 'FILENAME') return fileName || undefined;
    return undefined;
  };

  const buildBoardScene = (b: Board, filter: SceneFilter = {}): BoardScene => {
    if (!filter.clearanceForNet) filter = { ...filter, clearanceForNet };
    if (!filter.resolveTextVar) filter = { ...filter, resolveTextVar };
    const scene = buildScene(b, filter, sceneFactory());
    sceneIsGlRef.current = sceneFactory() === GL_PATH_FACTORY;
    if (scene.images.length === 0 || !glOkRef.current || glBlockedRef.current) return scene;
    // Handing this scene to the raster path instead would be the worst of the
    // three outcomes: GL paths draw as nothing on a 2D canvas, so the board
    // would come up empty with no error at all. Recompile it for real.
    glBlockedRef.current = true;
    sceneIsGlRef.current = false;
    return buildScene(b, filter, DOM_PATH_FACTORY);
  };
  const rafRef = useRef(0);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // Auto-sync: a moment after any edit, serialize into the app's coalesced
  // autosave. The title's '*' shows while the write is pending and clears once
  // handed off, every change reaches the project storage without Ctrl+S.
  useEffect(() => {
    if (!dirty || !onBoardChange) return;
    const id = setTimeout(() => {
      const brd = boardRef.current;
      if (brd) {
        onBoardChange(serializeBoard(brd));
        setDirty(false);
      }
    }, 1000);
    return () => clearTimeout(id);
  }, [dirty, board, onBoardChange]);

  // The same 1 s debounce, forced out. `SCH_EDIT_FRAME`'s equivalent has been
  // registered since autosave existed; pcbnew's never was, which is why leaving
  // the frame, hiding the tab, unloading the page or crashing all lost the last
  // second of board work with nothing to say so.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!registerAutosaveFlush) return;
    registerAutosaveFlush(() => {
      const brd = boardRef.current;
      // Not dirty means the last serialization already reached the host, and
      // re-serializing a large board on every tab hide is not free.
      if (!brd || !dirtyRef.current || !onBoardChange) return;
      onBoardChange(serializeBoard(brd));
      setDirty(false);
    });
    return () => registerAutosaveFlush(null);
  }, [registerAutosaveFlush, onBoardChange]);

  const showAppearance = toggles.has('showLayersManager');
  const showProperties = toggles.has('showProperties');

  // Draw options derived from the Objects tab + zone display mode.
  /** `PCBNEW_SETTINGS::m_Display` + `m_ViewersDisplay`, this page's slice. */
  const display = pcbCfg.pcb_display;
  /**
   * `::GetColorSettings( cfg->m_ColorTheme )` with the user's overrides on top
   * — Preferences > PCB Editor > Colors, and the footprint editor's page too,
   * because both write the `board` namespace.
   *
   * `drawOpts.theme` was left undefined here, so every colour came from
   * `pcbTheme.ts`' built-in constants and the Colors page had nothing behind
   * it. `PCB_DRAW_PANEL_GAL`'s painter is loaded from the same call
   * (`pcb_draw_panel_gal.cpp:780-790`), and `CommonSettingsChanged` re-runs it,
   * which is what the settings subscription above is.
   */
  const userColors = useUserColors();
  const userThemes = useUserThemes();
  const theme = useMemo(
    () => pcbThemeWithOverrides(pcbCfg.appearance.color_theme, userColors, userThemes),
    [pcbCfg.appearance.color_theme, userColors, userThemes],
  );
  const drawOpts = useMemo<PcbDrawOptions>(
    () => ({
      ...DEFAULT_DRAW_OPTIONS,
      tracks: objects.tracks,
      vias: objects.vias,
      pads: objects.pads,
      zones: objects.zones,
      points: objects.points,
      fpValues: objects.fpValues,
      fpReferences: objects.fpReferences,
      fpText: objects.fpText,
      drawingSheet: objects.drawingSheet,
      trackOpacity: opacity.tracks,
      viaOpacity: opacity.vias,
      padOpacity: opacity.pads,
      zoneOpacity: opacity.zones,
      zoneOutline: toggles.has('zoneDisplayOutline'),
      // Display-mode toggles: on = sketch (outline) = fill off (m_Display*Fill).
      trackFill: !toggles.has('trackDisplayMode'),
      viaFill: !toggles.has('viaDisplayMode'),
      padFill: !toggles.has('padDisplayMode'),
      filledShapeOpacity: opacity.filledShapes,
      contrastMode: contrast,
      activeLayer,
      theme,
      // Preferences > PCB Editor > Display Options. `m_Display.m_NetNames` is
      // ONE 4-valued choice that gates three different items at three
      // thresholds — `pcb_painter.cpp:1403` for a pad, `:1118` for a via, and
      // the track branch for the rest — so it fans out here rather than being
      // stored three times.
      netNames: display.net_names_mode >= 2,
      padNetNames: display.net_names_mode === 1 || display.net_names_mode === 3,
      viaNetNames: display.net_names_mode !== 0,
      padNumbers: display.pad_numbers,
      padClearance: display.pad_clearance,
      viaColorForThPads: display.pad_use_via_color_for_normal_th_padstacks,
      trackClearanceMode: display.track_clearance_mode,
      // `LAYER_BOARD_OUTLINE_AREA` — the Objects tab's "Board Area Shadow"
      // row, which had a checkbox and nothing behind it.
      boardOutlineArea: objects.boardAreaShadow,
      // Identity-stable: the cache mutates the map and asks for a redraw, and
      // the paint pass reads it then. Nothing here needs to change for a decode
      // to become visible.
      imageBitmaps: imageCacheRef.current.bitmaps,
    }),
    [objects, opacity, toggles, contrast, activeLayer, display, theme],
  );

  /**
   * The same options for the SELECTION overlay, which paints only the items
   * that are selected.
   *
   * `PCB_FIELD::ViewGetLOD` (`pcbnew/pcb_field.cpp:246-260`) returns LOD_SHOW
   * for a field whose parent footprint is selected — BEFORE the Render tab's
   * `LAYER_FP_VALUES` / `LAYER_FP_REFERENCES` checks — when
   * `m_ForceShowFieldsWhenFPSelected` is set. That early return is what this
   * is: the overlay pass is the only place the predicate "parent footprint is
   * selected" is already true for everything it draws, so lifting the two
   * switches there and nowhere else says exactly what upstream says.
   */
  const selDrawOpts = useMemo<PcbDrawOptions>(
    () =>
      display.force_show_fields_when_fp_selected
        ? { ...drawOpts, fpReferences: true, fpValues: true }
        : drawOpts,
    [drawOpts, display.force_show_fields_when_fp_selected],
  );

  // The left-toolbar high-contrast button reflects the Layer Display mode.
  const leftToggles = useMemo(() => {
    const s = new Set(toggles);
    if (contrast !== 'normal') s.add('highContrast');
    else s.delete('highContrast');
    if (objects.ratsnest) s.add('showRatsnest');
    else s.delete('showRatsnest');
    // The button is checked whenever a net highlight is active (netHighlightCond
    // = IsNetHighlightSet()).
    if (highlightNets.size > 0) s.add('toggleNetHighlight');
    else s.delete('toggleNetHighlight');
    return s;
  }, [toggles, contrast, objects.ratsnest, highlightNets]);

  // `text` is live (see the `openNonce` prop): the host mirrors this editor's
  // own autosaved board back into the open project, so reading it as a
  // dependency would reparse the board on every autosave — and, on a reopen,
  // replace the board being edited with the copy the host happened to hold.
  // Read at open time only.
  const textRef = useRef(text);
  textRef.current = text;

  // Parse after the first paint so "Loading…" is visible for big boards.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      try {
        const b = { ...readBoard(parse(textRef.current)), fileName };
        if (cancelled) return;
        boardRef.current = b;
        sceneRef.current = buildBoardScene(b);
        setBoard(b);
        setVisible(new Set(b.layers.map((l) => l.name)));
        // `PCB_EDIT_FRAME::OpenProjectFiles`' preload (pcbnew/files.cpp:610):
        // the footprint libraries are paid for now, in the background. See
        // ./preload.ts.
        preloadBoardLibraries(b);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [openNonce, fileName]);

  /**
   * The `.kicad_pro` / `.kicad_dru` content Board Setup is derived from.
   *
   * Keyed on the CONTENT rather than on the `projectFiles` array, which now
   * changes identity on every autosave tick: re-deriving the whole of Board
   * Setup and re-rendering the frame once a second, for files that had not
   * moved, is not something the user should pay for.
   */
  const setupSourceKey = useMemo(
    () =>
      projectFilesNow()
        .filter((f) => /\.(kicad_pro|kicad_dru)$/i.test(f.name))
        .map((f) => `${f.name} ${f.text}`)
        .join(''),
    [projectFilesNow],
  );

  // Hydrate Board Setup from the loaded project: the .kicad_pro slices
  // (design settings, netclasses, component classes, tuning profiles, text
  // variables), the board file's setup sections and the .kicad_dru rules,
  // the same load KiCad does in BOARD::SetProject + LoadProjectSettings.
  useEffect(() => {
    const files = projectFilesNow();
    const s = readBoardSetupPro(files, rootPro);
    applyBoardFileSetup(textRef.current, s);
    const dru = findProjectDru(files, rootPro);
    if (dru) s.customRules.text = dru.text;
    setBoardSetup(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupSourceKey, rootPro, openNonce]);

  // Commit Board Setup on dialog OK, KiCad's DIALOG_BOARD_SETUP flow: the
  // project-side slices merge into the .kicad_pro (+ .kicad_dru), persisted
  // immediately; the board-side slices patch the current board text, which is
  // reloaded into the editor and saved through the normal board-save path.
  const commitBoardSetup = useCallback(
    (next: BoardSetupValues) => {
      setBoardSetup(next);

      // .kicad_pro + .kicad_dru (merge-writes preserve unowned keys).
      const files = projectFilesNow();
      const baseOf = (name: string): string =>
        (projectFiles ?? []).find((f) => f.name === name)?.text ?? '';
      const persist: { name: string; text: string }[] = [];
      const pro = findProjectPro(files, rootPro);
      if (pro) {
        const updated = writeBoardSetupProText(pro.text, next);
        if (updated !== null && updated !== pro.text)
          persist.push({ name: pro.name, text: updated });
        const druName = druFileName(pro.name);
        const dru = findProjectDru(files, rootPro);
        if (dru ? next.customRules.text !== dru.text : next.customRules.text.trim() !== '') {
          persist.push({ name: dru?.name ?? druName, text: next.customRules.text });
        }
      }
      if (persist.length) {
        for (const f of persist)
          projectFileEditsRef.current.set(f.name, { base: baseOf(f.name), text: f.text });
        onPersistFiles?.(persist);
      }

      // Board file: patch the *current* board serialization (not the original
      // text, live edits must survive), then reload so the editor's board
      // model, layer list and future saves all see the new setup.
      const current = boardRef.current ? serializeBoard(boardRef.current) : text;
      const patched = writeBoardFileSetup(current, next);
      if (patched !== null && patched !== current) {
        try {
          const b = { ...readBoard(parse(patched)), fileName };
          boardRef.current = b;
          sceneRef.current = buildBoardScene(b);
          setBoard(b);
          // Newly enabled layers become visible; existing choices stay.
          setVisible((prev) => {
            const nextVisible = new Set(prev);
            const before = new Set(board?.layers.map((l) => l.name) ?? []);
            for (const l of b.layers) if (!before.has(l.name)) nextVisible.add(l.name);
            return nextVisible;
          });
          if (onSaveBoard) onSaveBoard(patched);
          else setDirty(true);
        } catch {
          // A patch that fails to re-parse would corrupt the session: keep the
          // old board and skip the board-file write.
        }
      }
    },
    [projectFilesNow, projectFiles, rootPro, onPersistFiles, onSaveBoard, text, fileName, board],
  );

  // PCB_POINT_EDITOR shows its points for a *single* selected item: a handle per
  // corner or vertex, plus one at each edge midpoint. Which items have any is
  // the engine's business, not this component's.
  useEffect(() => {
    const brd = boardRef.current;
    const id = selection.size === 1 ? [...selection][0]! : null;
    const handles = brd && id ? boardEditHandles(brd, id) : [];

    if (handles.length === 0) {
      editHandlesRef.current = [];
      editHandleItemRef.current = null;
      hoveredEditHandleRef.current = null;
      requestDrawRef.current();
      return;
    }
    editHandlesRef.current = handles;
    editHandleItemRef.current = id;
    requestDrawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, board]);

  // Whether the board raster is painted dimmed (a net highlight is active).
  // Read by the raster job; toggling it re-renders the raster.
  const dimmedRef = useRef(false);

  // "Footprints Front/Back" hide whole footprints: rebuild the scene.
  useEffect(() => {
    if (!boardRef.current) return;
    sceneRef.current = buildBoardScene(boardRef.current, {
      hideFrontFootprints: !objects.footprintsFront,
      hideBackFootprints: !objects.footprintsBack,
    });
    sceneDirtyRef.current = true;
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects.footprintsFront, objects.footprintsBack]);

  // pcbnew rasterises into a backing store; the same here. A crisp raster is
  // built off-screen (time-sliced so a 20k-track board never blocks the UI),
  // and every frame the current view blits that raster with a delta transform.
  // Crucially the crisp render is NOT cancelled or debounced while the user is
  // interacting: it runs to completion, promotes itself, and, if the view has
  // moved on, immediately starts another. So the picture continuously
  // re-sharpens *during* a zoom/pan instead of only after it stops.
  const cacheRef = useRef<{
    canvas: HTMLCanvasElement;
    view: { scale: number; tx: number; ty: number; flipX?: boolean };
  } | null>(null);
  const renderingRef = useRef(false);
  const viewChangedRef = useRef(true);
  // The scene/board changed since the cached raster was built, so it needs a
  // fresh render even though the view matches. We keep the (stale) raster on
  // screen and re-render into a new canvas in the background, swapping when
  // ready, so an edit/undo/toggle never blanks the board for a frame.
  const sceneDirtyRef = useRef(true);

  const viewMatchesCache = (): boolean => {
    const c = cacheRef.current;
    const v = viewRef.current;
    const canvas = canvasRef.current;
    return (
      !!c &&
      !!canvas &&
      c.view.scale === v.scale &&
      c.view.tx === v.tx &&
      c.view.ty === v.ty &&
      c.view.flipX === v.flipX &&
      c.canvas.width === canvas.width &&
      c.canvas.height === canvas.height
    );
  };

  const startCrispRender = useCallback(() => {
    if (renderingRef.current) return; // in flight, it re-checks the view on completion
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene || canvas.width < 2) return;
    if (viewMatchesCache() && !sceneDirtyRef.current) {
      viewChangedRef.current = false;
      return;
    }
    renderingRef.current = true;
    viewChangedRef.current = false;
    // Capture the current scene into this render; further edits re-dirty it.
    sceneDirtyRef.current = false;
    const work = document.createElement('canvas');
    work.width = canvas.width;
    work.height = canvas.height;
    const cctx = work.getContext('2d');
    if (!cctx) {
      renderingRef.current = false;
      return;
    }
    const jobView = { ...viewRef.current };
    // The drawing sheet is drawn separately (unflipped) in draw(), like KiCad's
    // DS_PROXY_VIEW_ITEM which un-mirrors itself, so it stays readable and the
    // title block keeps its corner under a flipped view. So the raster omits it.
    // Decode any reference image we have not seen; each decode asks for one
    // more frame, so the picture appears as soon as it is ready rather than at
    // the next unrelated redraw.
    for (const img of scene.images) imageCacheRef.current.ensure(img.data, requestDraw);

    const steps = buildDrawSteps(
      cctx,
      scene,
      jobView,
      visible,
      work.width,
      work.height,
      drawOpts,
      undefined,
      false,
      // A net highlight darkens everything that is not on it (pcb_painter.cpp
      // GetColor: Darkened(1 - m_highlightFactor)); the highlighted copper is
      // repainted brightened over this raster in draw().
      dimmedRef.current ? 'dimmed' : 'none',
    );
    let i = 0;
    const run = (): void => {
      const t0 = performance.now();
      while (i < steps.length && performance.now() - t0 < 12) steps[i++]!();
      if (i < steps.length) {
        requestAnimationFrame(run);
      } else {
        cacheRef.current = { canvas: work, view: jobView };
        renderingRef.current = false;
        requestDraw();
        // The view moved or the scene changed while we were rendering: keep
        // chasing it so the image keeps sharpening / catches the latest edit.
        if (viewChangedRef.current || sceneDirtyRef.current || !viewMatchesCache())
          startCrispRender();
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, drawOpts]);

  /**
   * The board's drill/place file origin, cached per board object.
   *
   * `boardAuxOrigin` walks the raw s-expression, and the root's child list is
   * every item on the board, so this is not something to repeat per frame.
   */
  const auxOriginRef = useRef<{ board: Board | null; at: { x: number; y: number } }>({
    board: null,
    at: { x: 0, y: 0 },
  });
  const auxOriginOf = (): { x: number; y: number } => {
    const brd = boardRef.current;
    if (auxOriginRef.current.board !== brd)
      auxOriginRef.current = { board: brd, at: brd ? boardAuxOrigin(brd) : { x: 0, y: 0 } };
    return auxOriginRef.current.at;
  };

  const draw = useCallback(() => {
    const __t0 = PERF ? performance.now() : 0;
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return;
    // The background, the grid and the drawing sheet: everything the board is
    // drawn *over*. With the GL renderer the board itself lands on a layer
    // between this and `ctx`; without one the raster blits here, exactly where
    // it always did.
    const bctx = canvas.getContext('2d');
    if (!bctx) return;
    // Everything above the board. Its own canvas when the GL layer is mounted,
    // and the same context as `bctx` when it is not — which is what keeps the
    // Canvas2D path a single-canvas paint in the order it has always used.
    const over = overCanvasRef.current;
    const ctx = over?.getContext('2d') ?? bctx;
    const v = viewRef.current;
    // Signed X scale for the flipped (mirrored) view; world→screen X uses this.
    const sx = v.flipX ? -v.scale : v.scale;
    /** Whether the GPU draws the board this frame. */
    const gl = glRef.current;
    const useGl =
      gl !== null &&
      !gl.isLost &&
      glOkRef.current &&
      !glBlockedRef.current &&
      // Belt and braces with `glBlockedRef`, and the invariant that actually
      // matters: a scene holding images was compiled through `Path2D` and has
      // no vertices for the recorder to find.
      scene.images.length === 0;
    // A device that dies *between* events — evicted by a starved Chrome, or
    // flagged unhealthy by its own first-frames probe — never fires
    // `webglcontextlost`, so the fallback in that listener never runs and the
    // 2D path would be handed a scene full of GL paths it draws as nothing
    // (that shipped once as a board with strokes but no fills). Do the same
    // recovery here, keyed on what the scene was actually compiled with.
    if (!useGl && sceneIsGlRef.current) {
      glRef.current?.dispose();
      glRef.current = null;
      glOkRef.current = false;
      sceneIsGlRef.current = false;
      console.warn('WebGL device unhealthy; drawing the board with Canvas2D');
      // A dead context cannot clear its canvas; resizing it can.
      const gcv = glCanvasRef.current;
      if (gcv) {
        const w = gcv.width;
        gcv.width = 0;
        gcv.width = w;
      }
      const brd = boardRef.current;
      if (brd) {
        rebuildSceneRef.current(brd);
        requestDrawRef.current();
        return;
      }
    }
    // The retained buffer is keyed on the content, not on the view, so a pan or
    // a zoom is a uniform update and there is nothing to chase.
    if (!useGl && (!viewMatchesCache() || sceneDirtyRef.current)) {
      viewChangedRef.current = true;
      startCrispRender();
    }
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.fillStyle = 'rgb(0,16,35)';
    bctx.fillRect(0, 0, canvas.width, canvas.height);
    if (ctx !== bctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Grid sits behind the board (GAL GRID_DEPTH), painted crisply at the live
    // view every frame so it stays sharp during pan/zoom. The raster is drawn on
    // top with a transparent background so the grid shows through empty areas.
    drawGrid(
      bctx,
      v,
      canvas.width,
      canvas.height,
      pcbGridOptions({
        show: objects.grid && toggles.has('toggleGrid'),
        sizeIU: gridIURef.current,
        origin: gridOriginRef.current,
        color: drawOpts.theme?.grid,
        devicePixelRatio: dpr,
        // `PANEL_GAL_OPTIONS`' Grid Display group, through `window.grid`.
        style: galRef.current.style,
        lineWidthPx: galRef.current.line_width,
        minSpacingPx: galRef.current.min_spacing,
      }),
    );
    // Drawing sheet, drawn behind the board with the UN-flipped transform so the
    // page frame and title block stay in place and readable when the board is
    // flipped (KiCad's DS_PROXY_VIEW_ITEM un-mirrors itself). tx is recovered by
    // mirroring back about the viewport centre.
    if (drawOpts.drawingSheet && boardRef.current) {
      const sheetColor = drawOpts.theme?.special.drawingSheet ?? PCB_SPECIAL.drawingSheet;
      const sheetTx = v.flipX ? canvas.width - v.tx : v.tx;
      bctx.setTransform(v.scale, 0, 0, v.scale, sheetTx, v.ty);
      bctx.lineCap = 'round';
      bctx.lineJoin = 'round';
      // The sheet keeps its colour under a net highlight: DS_PROXY_VIEW_ITEM
      // reads GetLayerColor(LAYER_DRAWINGSHEET), the raw layer colour, not the
      // item-aware GetColor that does the brighten/darken.
      const sheetInfo = sheetInfoOf(boardRef.current);
      // The paper edge first, in its own colour, the way DrawBorder runs after
      // the sheet's items in DS_PROXY_VIEW_ITEM::ViewDraw. This is the call the
      // board actually makes: the GL recorder disables the sheet
      // (`drawingSheet: false`) because it stays on this 2D layer, so anything
      // added to `buildDrawSteps` alone never reaches the screen.
      // One device pixel, as the world width that is one pixel at this zoom.
      //
      // CAIRO_GAL_BASE::syncLineWidth floors every stroke at a pixel:
      //
      //   double w = floor( xform( m_lineWidth ) + 0.5 );
      //   if( w <= 1.0 ) { w = 1.0; ... }
      //
      // The sheet's own pen is 0.15 mm and pcbnew's on-screen default pen is 0,
      // so at any normal board zoom the frame is well under a pixel wide. KiCad
      // draws it as a crisp one-pixel line; we drew it at its true 0.6 px and
      // got a dim half-transparent grey, which is the whole of why the frame
      // looked washed out next to KiCad's.
      const hairline = v.scale > 0 ? 1 / v.scale : 0;
      // `m_ShowPageLimits` — Editing Options' "Show page limits", "Draw an
      // outline to show the sheet size". `LAYER_PAGE_LIMITS` is drawn only when
      // it is set (`pcb_draw_panel_gal.cpp`), and this drew it always.
      if (galRef.current.show_page_borders)
        drawPageLimits(
          bctx,
          sheetInfo,
          drawOpts.theme?.special.pageLimits ?? PCB_SPECIAL.pageLimits,
          hairline,
        );
      drawDrawingSheet(bctx, sheetInfo, sheetColor, undefined, hairline);
      bctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Footprint anchors (LAYER_ANCHOR), *under* the board rather than over it.
    //
    // They belong here rather than on the overlay because that is where pcbnew
    // puts them in practice: with the copper pours switched on its anchors all
    // but disappear — a translucent zone fill washes the magenta out to a faint
    // grey tick you only find by zooming right in — and they come back cleanly
    // the moment the pours are hidden. Drawn on the overlay they sat above the
    // pours, the silkscreen and the footprint text, so a whole-board view was
    // covered in crosses that pcbnew does not show.
    // What an in-place GPU drag has shifted so far, for the passes drawn per
    // frame from `scene` rather than from the buffer the GPU translated: the
    // anchor crosses and the pad numbers / net names. Null unless such a drag
    // is in flight — the overlay path takes the moving items out of `scene`
    // altogether and draws their own copy, so it needs no offset here.
    const inPlaceShift = inPlaceMoveRef.current
      ? {
          ids: dragAffectedRef.current,
          dx: inPlaceMoveRef.current.x,
          dy: inPlaceMoveRef.current.y,
        }
      : null;
    if (objects.anchors) {
      drawAnchors(
        bctx,
        scene,
        v,
        visible,
        canvas.width,
        canvas.height,
        drawOpts,
        dimmedRef.current ? 'dimmed' : 'none',
        dpr,
        inPlaceShift,
      );
      bctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // The board itself: one uniform and three draw calls on the GPU, or the
    // raster blit it replaces.
    //
    // Every field of the content key is compared by *reference*, so each one has
    // to be identity-stable across frames or the whole board re-records on every
    // pointer move and shows up only as "it is still slow". `scene` is replaced
    // on an edit and not otherwise; `visible` is state; `drawOpts` is memoised;
    // the emphasis is a string. Do not inline an object or a `new Set` here.
    if (useGl) {
      // The back-side names are laid out for this frame and handed to the GPU
      // as geometry, so they can be drawn *between* the board's layers rather
      // than over them. Only labels past their zoom gate and inside the
      // viewport contribute, so this is a few hundred segments a frame.
      gl.recordInner((rec) => {
        drawNetNames(
          rec,
          scene,
          v,
          visible,
          canvas.width,
          canvas.height,
          { ...drawOpts, minPenWidth: 0 },
          dimmedRef.current ? 'dimmed' : 'none',
          dpr,
          'under',
          inPlaceShift,
        );
      }, v.scale);
      // And the pass drawn over it — track and via names and through-hole pad
      // text. On the GPU rather than on the 2D overlay because these are the
      // labels KiCad draws with `BitmapText`, and a distance-field atlas needs
      // a shader to decode: Canvas2D has nowhere to put one.
      gl.recordText((rec) => {
        drawNetNames(
          rec,
          scene,
          v,
          visible,
          canvas.width,
          canvas.height,
          { ...drawOpts, minPenWidth: 0 },
          dimmedRef.current ? 'dimmed' : 'none',
          dpr,
          'over',
          inPlaceShift,
        );
      }, v.scale);
      gl.render(
        {
          scene,
          visible,
          opts: drawOpts,
          // A net highlight darkens everything that is not on it
          // (pcb_painter.cpp GetColor: Darkened(1 - m_highlightFactor)); the
          // highlighted copper is repainted brightened on the overlay below.
          emphasis: dimmedRef.current ? 'dimmed' : 'none',
        },
        v,
      );
      if (PERF) {
        pcbPerf.records = gl.recordCount;
        pcbPerf.lastRecordMs = gl.lastRecordMs;
      }
      // The health probe inside upload/draw may have just condemned the
      // device; come straight back for the Canvas2D recovery frame rather
      // than leaving this half-drawn one up until the next interaction.
      if (gl.isLost) requestDrawRef.current();
    } else {
      // The GL layer sits *above* the background and below everything else, so
      // a buffer left on it from an earlier frame keeps showing through: a
      // stale second copy of the board under the live one.
      gl?.clear();
      const c = cacheRef.current;
      if (c) {
        const k = v.scale / c.view.scale;
        bctx.setTransform(k, 0, 0, k, v.tx - c.view.tx * k, v.ty - c.view.ty * k);
        // While the crisp cache catches up: keep upscale (zoom-in) sharp with
        // nearest-neighbour, but let downscale (zoom-out) stay smooth to avoid
        // aliasing shimmer on thin traces.
        bctx.imageSmoothingEnabled = k < 1;
        bctx.drawImage(c.canvas, 0, 0);
        bctx.imageSmoothingEnabled = true;
        bctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // The drill/place file origin marker, screen-space like the anchors and,
    // like them, drawn above the board (LAYER_GP_OVERLAY).
    drawOriginMarkers(
      ctx,
      { aux: auxOriginOf(), grid: gridOriginRef.current },
      v,
      canvas.width,
      canvas.height,
      dpr,
      drawOpts.theme,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Back and inner net names. On the GPU they were recorded into the board's
    // own draw at the depth pcbnew files them at (see the `recordInner` call
    // above), so nothing is drawn here. The Canvas2D path has no such depth to
    // draw into, so it keeps the attenuated stand-in — dimmed by what pcbnew
    // stacks over them, which is the best a single flat raster can do.
    if (!useGl) {
      drawNetNames(
        ctx,
        scene,
        v,
        visible,
        canvas.width,
        canvas.height,
        drawOpts,
        dimmedRef.current ? 'dimmed' : 'none',
        dpr,
        'under',
        inPlaceShift,
      );
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Net-color overlay (net colors mode "All"): copper items of colored nets
    // repainted in their net color over the raster.
    for (const cs of coloredScenesRef.current) {
      ctx.save();
      drawBoard(
        ctx,
        cs.scene,
        v,
        visible,
        canvas.width,
        canvas.height,
        { ...drawOpts, colorOverride: cs.color },
        undefined,
        true,
      );
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Ratsnest airwires (RATSNEST_VIEW_ITEM): thin lines over the copper,
    // curved when the left toolbar's curved-ratsnest mode is on.
    {
      const rats = ratsDrawRef.current;
      if (rats.length > 0) {
        const curved = toggles.has('ratsnestLineMode');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // `m_Display.m_RatsnestThickness` — Editing Options' "Ratsnest line
        // thickness", a MULTIPLIER on the one-pixel default and not a distance
        // (`wxSpinCtrlDouble( …, 0.5, 10, 0.5, 0.5 )`). It was a hardcoded 1.
        ctx.lineWidth = Math.max(1, dpr) * galRef.current.ratsnest_thickness;
        for (const { e, color } of rats) {
          const x1 = e.ax * sx + v.tx;
          const y1 = e.ay * v.scale + v.ty;
          const x2 = e.bx * sx + v.tx;
          const y2 = e.by * v.scale + v.ty;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          if (curved) {
            // Bow the line ~15% of its length to the side, like the curved
            // ratsnest render.
            const mx = (x1 + x2) / 2 - (y2 - y1) * 0.15;
            const my = (y1 + y2) / 2 + (x2 - x1) * 0.15;
            ctx.quadraticCurveTo(mx, my, x2, y2);
          } else {
            ctx.lineTo(x2, y2);
          }
          ctx.stroke();
        }
      }
    }
    // Umbilical lines (pcb_painter.cpp draw(PCB_TEXT): "Draw the umbilical
    // line for texts in footprints"): every SELECTED footprint text draws a
    // solid line in the LAYER_ANCHOR color (the theme's pink) back to its
    // parent footprint's position. Selecting a footprint selects its child
    // texts too, so clicking a footprint shows the umbilicals to its
    // reference/value/other texts. Follows an in-flight drag.
    {
      const sel = selForDrawRef.current;
      const brd = boardRef.current;
      if (brd) {
        const md = moveDeltaRef.current;
        const off = !dragModeRef.current && md ? md : { x: 0, y: 0 };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = PCB_SPECIAL.anchor;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        const umbilical = (fp: PcbFootprint, t: PcbFootprint['texts'][number]): void => {
          if (t.hide) return;
          ctx.moveTo((t.at.x + off.x) * sx + v.tx, (t.at.y + off.y) * v.scale + v.ty);
          ctx.lineTo((fp.at.x + off.x) * sx + v.tx, (fp.at.y + off.y) * v.scale + v.ty);
        };
        for (const id of sel) {
          const r = parseBoardItemId(id);
          if (r?.kind === 'fptext') {
            const fp = brd.footprints[r.index];
            const t = fp?.texts[r.sub ?? 0];
            // An individually selected text keeps its own anchor: only the text
            // end follows the drag, not the footprint position.
            if (fp && t && !t.hide) {
              ctx.moveTo((t.at.x + off.x) * sx + v.tx, (t.at.y + off.y) * v.scale + v.ty);
              ctx.lineTo(fp.at.x * sx + v.tx, fp.at.y * v.scale + v.ty);
            }
          } else if (r?.kind === 'footprint') {
            const fp = brd.footprints[r.index];
            if (fp) for (const t of fp.texts) umbilical(fp, t);
          }
        }
        ctx.stroke();
      }
    }
    // Point-editor handles (PCB_POINT_EDITOR): a single selected item gets a
    // square on each corner or vertex and a circle at each edge midpoint, drawn at
    // a fixed screen size in LAYER_AUX_ITEMS white with a darker border
    // (EDIT_POINTS::ViewDraw; POINT_SIZE 8, BORDER_SIZE 3, HOVER_SIZE 6).
    {
      const handles = editHandlesRef.current;
      if (handles.length > 0 && !moveDeltaRef.current) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const half = (EDIT_POINT_SIZE / 2) * dpr;
        const hovered = hoveredEditHandleRef.current;
        const colors = editPointColors(
          drawOpts.theme?.special.auxItems ?? PCB_SPECIAL.auxItems,
          drawOpts.theme?.background ?? PCB_BACKGROUND,
        );
        ctx.fillStyle = colors.fill;
        for (const h of handles) {
          const active = hovered?.kind === h.kind && hovered?.index === h.index;
          const pen = galPenWidth((active ? EDIT_POINT_HOVER_SIZE : EDIT_POINT_BORDER_SIZE) * dpr);
          // GAL quantises the stroke and snaps the geometry to the same pixel
          // grid (kicad_vert.glsl:69-77). Without the snap a handle's border
          // straddles two columns at half strength each and reads soft next to
          // pcbnew's, which is exactly how these looked.
          const x = galSnapPx(h.at.x * sx + v.tx, pen);
          const y = galSnapPx(h.at.y * v.scale + v.ty, pen);
          ctx.strokeStyle = active ? colors.highlight : colors.border;
          ctx.lineWidth = pen;
          ctx.beginPath();
          if (h.kind === 'line') ctx.arc(x, y, half, 0, Math.PI * 2);
          else ctx.rect(x - half, y - half, half * 2, half * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    // Selection / move overlay: the selected items repainted brightened over the
    // raster, KiCad draws a selected item in its layer colour Brightened(0.8),
    // not a bounding box (pcb_painter.cpp getColor). While a move is in flight the
    // moving items are excluded from the raster and this overlay follows the
    // cursor at the drag offset (EDIT_TOOL::Move's GAL overlay); otherwise it
    // sits exactly over the raster so the selection just lights up in place.
    // Net highlight (BOARD_INSPECTION_TOOL::HighlightNet): the whole board dims
    // and the highlighted net's copper pops. pcb_painter.cpp getColor darkens
    // every non-highlighted item by (1−highlightFactor)=0.5 and brightens the
    // highlighted ones by highlightFactor=0.5. We reproduce the darken with a
    // 50%-black wash over the raster (source-over: dst·0.5, exactly Darkened
    // (0.5)), then repaint the highlighted net Brightened(0.5) on top. Skipped
    // while dragging (the move overlay owns the frame).
    {
      const hs = highlightSceneRef.current;
      // A router drag keeps the highlight up (that is the whole point of
      // highlightNets during performDragging); any other gesture drops it.
      if (hs && (!moveDeltaRef.current || trackDragRef.current)) {
        // The rest of the board is already dimmed in the raster, so this pass
        // only repaints the highlighted copper Brightened(m_highlightFactor).
        ctx.save();
        drawBoard(
          ctx,
          hs,
          v,
          visible,
          canvas.width,
          canvas.height,
          drawOpts,
          undefined,
          true,
          'highlighted',
        );
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    {
      const md = moveDeltaRef.current;
      const os = moveSceneRef.current ?? selSceneRef.current;
      if (os) {
        // A drag overlay, a stretched footprint drag or a re-cut router drag ,
        // is already at its absolute coords; only a move overlay is the static
        // subset that has to be translated by the drag delta.
        const absolute = dragModeRef.current || trackDragRef.current !== null;
        const off = absolute ? { x: 0, y: 0 } : (md ?? { x: 0, y: 0 });
        const offView = {
          scale: v.scale,
          flipX: v.flipX,
          tx: v.tx + off.x * sx,
          ty: v.ty + off.y * v.scale,
        };
        ctx.save();
        // The router draws its in-flight line as a preview item at 80% alpha
        // (ROUTER_PREVIEW_ITEM's ctor: m_color.a = 0.8).
        if (trackDragRef.current) ctx.globalAlpha = 0.8;
        drawBoard(
          ctx,
          os,
          offView,
          visible,
          canvas.width,
          canvas.height,
          selDrawOpts,
          undefined,
          true,
          // The router's preview line keeps the plain layer color, the net
          // highlight is what lifts the rest of the net (DisplayItem passes no
          // flags for a drag, so getLayerColor returns the layer color as-is).
          trackDragRef.current ? 'none' : 'selected',
        );
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // A selected group's own frame and name tab (`PCB_PAINTER::draw( const
    // PCB_GROUP* )`, the LAYER_ANCHOR arm). The members are already brightened
    // by the overlay above; this is what the *group* draws, and without it
    // selecting one looked like nothing had happened at all.
    {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (brd && sel.size > 0 && !moveDeltaRef.current) {
        const groups = [...sel]
          .map((id) => parseBoardItemId(id))
          .filter((r) => r?.kind === 'group')
          .map((r) => ({ idx: r!.index, g: brd.groups[r!.index] }))
          .filter((x) => x.g);
        if (groups.length > 0) {
          // `SetLineWidth( m_outlineWidth * 2.0f )` with `m_outlineWidth = 1`
          // *internal unit* (`render_settings.cpp:43`) — nothing at any zoom, so
          // what reaches the screen is GAL's one-device-pixel minimum.
          const pen = galPenWidth(Math.max(1, dpr));
          const textSize = groupLabelTextSize(1 / v.scale);
          ctx.save();
          ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
          ctx.strokeStyle = drawOpts.theme?.special.anchor ?? PCB_SPECIAL.anchor;
          ctx.lineWidth = pen / v.scale;
          for (const { idx, g } of groups) {
            const members = expandGroupIds(brd, new Set([boardItemId('group', idx)]));
            const box = boardSelectionBBox(brd, members);
            if (!box) continue;
            ctx.beginPath();
            for (const seg of groupBoxSegments(box, g!.name ?? '', textSize)) {
              ctx.moveTo(seg.a.x, seg.a.y);
              ctx.lineTo(seg.b.x, seg.b.y);
            }
            ctx.stroke();

            if (groupLabelFits(g!.name ?? '', box, textSize)) {
              const at = groupLabelAnchor(box, textSize);
              // `attrs.m_Italic = true`, centre/bottom, `GetPenSizeForNormal`.
              const label = boardTextPath({
                kind: 'user',
                text: g!.name ?? '',
                at,
                angle: 0,
                layer: 'F.Cu',
                size: { x: textSize, y: textSize },
                italic: true,
                justify: ['bottom'],
                source: EMPTY_SLIST,
              });
              if (label) {
                ctx.lineWidth = Math.max(label.thickness, pen / v.scale);
                ctx.stroke(label.path);
                ctx.lineWidth = pen / v.scale;
              }
            }
          }
          ctx.restore();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
    }
    // In-flight route preview (ROUTER_TOOL): the 45° two-segment path from the
    // last committed point to the snapped cursor, at the net class track width.
    {
      const r = routeRef.current;
      const cur0 = cursorRef.current;
      if (r && cur0) {
        // The same point the crosshair is drawn at, so the preview ends under
        // it rather than beside it.
        const end = cursorSnapRef.current(cur0);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(r.layer);
        ctx.lineWidth = r.dims.trackWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(r.last.x, r.last.y);
        for (const p of routedPath(r.last, end)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Table preview: the grid this drag would produce, drawn from the engine's
    // own cells so the shape shown is the shape committed.
    {
      const first = tableStartRef.current;
      const cur0 = cursorRef.current;
      if (first && cur0) {
        const preview = newTable(first, snapToGrid(cur0), tableDefaults());
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(activeLayer);
        ctx.lineWidth = Math.max(1, dpr) / v.scale;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        for (const c of preview.cells) {
          if (!c.start || !c.end) continue;
          ctx.rect(c.start.x, c.start.y, c.end.x - c.start.x, c.end.y - c.start.y);
        }
        ctx.stroke();
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Text box preview: the rectangle being dragged out, before the dialog.
    {
      const first = textBoxStartRef.current;
      const cur0 = cursorRef.current;
      if (first && cur0) {
        const p = snapToGrid(cur0);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(activeLayer);
        ctx.lineWidth = Math.max(1, dpr) / v.scale;
        ctx.globalAlpha = 0.9;
        ctx.strokeRect(first.x, first.y, p.x - first.x, p.y - first.y);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Reference image preview: the extent the picture will occupy, centred on
    // the cursor. The same outline the renderer draws for a placed image —
    // which is all either can draw until the raster pass exists.
    {
      const ps = placeImageRef.current;
      const cur0 = cursorRef.current;
      if (ps.step === 'placing' && ps.image && cur0) {
        const box = imageBBox(moveImage(ps, snapToGrid(cur0)).image!);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(ps.image.layer);
        ctx.lineWidth = Math.max(1, dpr) / v.scale;
        ctx.globalAlpha = 0.9;
        ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Dimension preview (DRAWING_TOOL::DrawDimension): the real geometry the
    // engine would produce, so what you see while placing is what you commit.
    {
      const dr = dimensionRef.current;
      const cur0 = cursorRef.current;
      if (dr && cur0) {
        const live = moveDimension(dr, dimensionCursor(dr, cur0), {
          userUnits: unitsRef.current,
        }).dimension;
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(live.layer);
        ctx.lineWidth = Math.max(live.style.thickness, Math.max(1, dpr) / v.scale);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        for (const seg of dimensionSegments(live)) {
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
        }
        ctx.stroke();
        // The label, from the same layout the committed item gets. Upstream's
        // preview is the real `PCB_DIMENSION_BASE` in a `VIEW_GROUP`, so the
        // measurement counts up as you drag; without this the preview is a bare
        // set of lines and the number only appears after the last click.
        if (live.text && !live.text.hide) {
          const label = boardTextPath(live.text);
          if (label) {
            ctx.lineWidth = Math.max(label.thickness, Math.max(1, dpr) / v.scale);
            ctx.stroke(label.path);
          }
        }
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Zone outline preview (DRAWING_TOOL::DrawZone): a thin polyline in the
    // zone layer's color, plus the closing hint back to the first corner.
    {
      const z = zoneRef.current;
      const cur0 = cursorRef.current;
      if (z && z.pts.length > 0 && cur0) {
        const p = snapToGrid(cur0);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(z.layer);
        ctx.lineWidth = Math.max(1, dpr) / v.scale;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(z.pts[0]!.x, z.pts[0]!.y);
        for (let i = 1; i < z.pts.length; i++) ctx.lineTo(z.pts[i]!.x, z.pts[i]!.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (z.pts.length >= 2) {
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(z.pts[0]!.x, z.pts[0]!.y);
          ctx.stroke();
        }
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // `KIGFX::PREVIEW::RULER_ITEM`, the item ACTIONS::measureTool puts up.
    // The shared painter, beside its own arithmetic: this frame used to draw a
    // `rgba(120,230,255)` line with a 6px end tick and one invented
    // `dist (dx dy)` string — no graduations, no LAYER_AUX_ITEMS colour, and
    // no `x / y / r / theta` block, which are the four strings upstream shows.
    {
      const m = measureRef.current;
      const cur0 = cursorRef.current;
      if (m && (m.b || cur0)) {
        drawRulerItem(ctx, {
          origin: m.a,
          end: m.b ?? rulerEnd(m.a, snapToGrid(cur0!), shiftDownRef.current ? 'deg45' : 'direct'),
          toPx: (p) => ({ x: p.x * sx + v.tx, y: p.y * v.scale + v.ty }),
          // The flipped board view carries a negative X scale; the painter
          // takes the magnitude for the graduation spacing.
          worldScale: v.scale,
          iuPerMm: PCB_IU_PER_MM,
          units: unitsRef.current,
          color: drawOpts.theme?.special.auxItems ?? PCB_SPECIAL.auxItems,
          devicePixelRatio: dpr,
          canvasWidth: ctx.canvas.width,
          canvasHeight: ctx.canvas.height,
        });
      }
    }
    // Place Point's preview item.
    //
    // `doInteractiveItemPlacement` with `IPO_SINGLE_CLICK` calls `makeNewItem`
    // *before* the event loop (`pcb_tool_base.cpp:119-120`), so there is always
    // a live `PCB_POINT` on the preview VIEW_GROUP following the cursor — the
    // click commits that item rather than creating one. It is the real marker,
    // drawn by the same `draw( const PCB_POINT* )`, which is why this mirrors
    // `addPoint` in renderBoard rather than inventing a placeholder glyph.
    if (activeToolRef.current === 'placePoint' && cursorRef.current) {
      const at = cursorSnapRef.current(cursorRef.current);
      const half = DEFAULT_POINT_SIZE / 2;
      ctx.save();
      ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
      ctx.lineWidth = 1 / v.scale;
      ctx.beginPath();
      ctx.moveTo(at.x - half, at.y - half);
      ctx.lineTo(at.x + half, at.y + half);
      ctx.moveTo(at.x + half, at.y - half);
      ctx.lineTo(at.x - half, at.y + half);
      ctx.strokeStyle = drawOpts.theme?.special.points ?? PCB_SPECIAL.points;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(at.x, at.y, half / 2, 0, Math.PI * 2);
      ctx.strokeStyle = layerColor(activeLayer);
      ctx.stroke();
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // In-flight drawing preview (DRAWING_TOOL's live outline): the committed
    // points plus the snapped cursor, stroked in the active layer's color at
    // the layer's default line width.
    {
      const kind = DRAW_SHAPE_TOOLS[activeToolRef.current];
      const pts = drawingRef.current;
      const cur0 = cursorRef.current;
      if (kind && pts.length > 0 && cur0) {
        const p = snapToGrid(cur0);
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        ctx.strokeStyle = layerColor(activeLayer);
        ctx.lineWidth = shapeWidthIU(activeLayer);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        switch (kind) {
          case 'line': {
            const end = constrainLineEnd(pts[0]!, p);
            ctx.moveTo(pts[0]!.x, pts[0]!.y);
            ctx.lineTo(end.x, end.y);
            break;
          }
          case 'rect': {
            const a = pts[0]!;
            ctx.rect(
              Math.min(a.x, p.x),
              Math.min(a.y, p.y),
              Math.abs(p.x - a.x),
              Math.abs(p.y - a.y),
            );
            break;
          }
          case 'circle': {
            const a = pts[0]!;
            const r = Math.hypot(p.x - a.x, p.y - a.y);
            ctx.moveTo(a.x + r, a.y);
            ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
            break;
          }
          case 'arc': {
            if (pts.length === 1) {
              ctx.moveTo(pts[0]!.x, pts[0]!.y);
              ctx.lineTo(p.x, p.y);
            } else {
              traceArc3(ctx, pts[0]!, p, pts[1]!);
            }
            break;
          }
          case 'poly': {
            ctx.moveTo(pts[0]!.x, pts[0]!.y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
            ctx.lineTo(p.x, p.y);
            break;
          }
          default:
            break;
        }
        ctx.stroke();
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    const brd = boardRef.current;
    // Rubber-band marquee: KiCad tints it blue for a left→right window
    // (contained) select, green for a right→left crossing select.
    const box = boxRef.current;
    if (box) {
      const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: p.x * sx + v.tx,
        y: p.y * v.scale + v.ty,
      });
      const p0 = toPx(box.a),
        p1 = toPx(box.b);
      const rightward = box.b.x >= box.a.x;
      ctx.strokeStyle = rightward ? 'rgba(120,170,255,0.9)' : 'rgba(120,255,150,0.9)';
      ctx.fillStyle = rightward ? 'rgba(120,170,255,0.12)' : 'rgba(120,255,150,0.12)';
      ctx.lineWidth = dpr;
      const x = Math.min(p0.x, p1.x),
        y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x),
        h = Math.abs(p1.y - p0.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    // Disambiguation hover: the pointed-at items repainted BRIGHTENED, which is
    // `highlight( current, BRIGHTENED, &highlightGroup )` — their own geometry
    // in their own colours, lifted. A bounding box was what stood here, and on
    // the case this menu exists for it says nothing at all: three pours stacked
    // through a board share a bounding box almost exactly, so every row of the
    // menu drew the same rectangle and none of them told you which pour it was.
    if (hoverSceneRef.current) {
      ctx.save();
      drawBoard(
        ctx,
        hoverSceneRef.current,
        v,
        visible,
        canvas.width,
        canvas.height,
        drawOpts,
        undefined,
        true,
        'highlighted',
      );
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // DRC markers (PCB_MARKER, GAL overlay target): painted above the board
    // and every editing overlay, under the cursor. The ref holds the already
    // severity-filtered set (the Objects tab's DRC visibility rows gate them
    // like BOARD::IsElementVisible in pcb_painter.cpp draw(PCB_MARKER)).
    drawDrcMarkers(ctx, drcMarkersRef.current, v, dpr, {
      background: PCB_BACKGROUND,
      ...PCB_SPECIAL,
    });
    // `GRID_HELPER::m_viewAxis` (pcb_grid_helper.cpp:167-172): the auxiliary
    // axis, drawn at the origin of the gesture in progress as a CROSS in the
    // aux-items colour at 40% alpha. `SetSize( 20000 )` is in *screen* pixels
    // (`ORIGIN_VIEWITEM::ViewDraw` puts it through `ToWorld`), so at any real
    // zoom it spans the whole canvas. It is the cue that says this point is
    // still reachable however far the cursor wanders off the grid.
    const aux = auxAxisRef.current;
    if (aux) {
      const ax = aux.x * sx + v.tx;
      const ay = aux.y * v.scale + v.ty;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = PCB_CURSOR;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      ctx.moveTo(0, ay);
      ctx.lineTo(canvas.width, ay);
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, canvas.height);
      ctx.stroke();
      ctx.restore();
    }
    // Crosshair cursor (GAL::blitCursor): the LAYER_CURSOR cross at the
    // grid-snapped cursor, drawn topmost, by the shared painter.
    const cur = cursorRef.current;
    if (cur && activeToolRef.current !== 'localRatsnestTool') {
      const snapped = forcedCursorRef.current ?? cursorSnapRef.current(cur);
      drawCrosshair(
        ctx,
        { x: snapped.x * sx + v.tx, y: snapped.y * v.scale + v.ty },
        canvas.width,
        canvas.height,
        {
          // `GAL_DISPLAY_OPTIONS::m_gridStyle`'s sibling `m_crossHairMode`,
          // read from the file rather than from the button set so Display
          // Options and the toolbar cannot disagree.
          mode: galRef.current.crosshair,
          color: PCB_CURSOR,
          // pcbnew's tools call ShowCursor(true) as soon as one is active; with
          // the selection tool the crosshair is there only because "Always show
          // crosshairs" forced it, and a forced cursor is dimmed upstream.
          toolWantsCursor: activeToolRef.current !== 'select',
          // `GAL_DISPLAY_OPTIONS::m_forceDisplayCursor`, the Cursor group's
          // second control. Hardcoded true here, so switching it off on
          // Display Options changed nothing.
          alwaysShow: galRef.current.always_show_cursor,
          devicePixelRatio: dpr,
        },
      );
    }
    notePcbPaint(useGl ? 'gl' : 'raster', __t0);
    setScale(v.scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCrispRender]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);
  // Ref mirror so long-lived handlers (global keydown) never call a stale draw.
  const requestDrawRef = useRef(requestDraw);
  requestDrawRef.current = requestDraw;

  // Layer/object changes invalidate the raster.
  useEffect(() => {
    sceneDirtyRef.current = true;
    requestDraw();
  }, [visible, drawOpts, requestDraw]);

  // Rebuild the DRC marker overlay when the results, the active violation,
  // the severity settings, or the Objects-tab DRC visibility rows change.
  // Severity resolves like PCB_MARKER::GetSeverity via the Board Setup
  // severities (error unless set to warning; ignored ones never get markers).
  useEffect(() => {
    const sev = boardSetup.drcSeverities;
    drcMarkersRef.current = (drcResults ?? []).flatMap((vio, i) => {
      const severity: DrcMarkerDraw['severity'] = sev[vio.code] === 'warning' ? 'warning' : 'error';
      const shown = severity === 'warning' ? objects.drcWarnings : objects.drcErrors;
      if (!shown) return [];
      return [{ pos: vio.pos, severity, active: i === drcSelected }];
    });
    requestDraw();
  }, [
    drcResults,
    drcSelected,
    boardSetup.drcSeverities,
    objects.drcErrors,
    objects.drcWarnings,
    requestDraw,
  ]);

  // Recompile the selected items into their own scene, so the overlay can paint
  // them brightened over the raster (KiCad's selection look).
  //
  // Through `expandGroupIds`, like every *editing* command already was. A group
  // id names no item of its own, so `subsetBoardItems` matched nothing for one
  // and the overlay came out empty: selecting a group — the board stackup table,
  // say — highlighted nothing at all, while KiCad brightens all 153 members.
  // `PCB_SELECTION_TOOL::select` puts the members in the selection too
  // (`GROUP::RunOnChildren`), so the drawing and the editing want the same set.
  const rebuildSelScene = useCallback(() => {
    const brd = boardRef.current;
    const sel = brd ? expandGroupIds(brd, selForDrawRef.current) : selForDrawRef.current;
    selSceneRef.current =
      brd && sel.size > 0
        ? buildScene(subsetBoardItems(brd, sel), {
            hideFrontFootprints: !objects.footprintsFront,
            hideBackFootprints: !objects.footprintsBack,
          })
        : null;
  }, [objects.footprintsFront, objects.footprintsBack]);

  // The selection / disambiguation hover live only in the overlay, recompile the
  // selection scene and repaint.
  useEffect(() => {
    rebuildSelScene();
    requestDraw();
  }, [selection, disambig, requestDraw, rebuildSelScene]);

  /**
   * Point the disambiguation menu at some items (`null` = at none).
   *
   * Compiling their geometry here rather than in the paint keeps the per-frame
   * cost where it belongs: this runs once per row the pointer crosses, and the
   * overlay then draws a scene that is already built.
   */
  const setDisambigHover = useCallback(
    (ids: ReadonlySet<string> | null) => {
      const brd = boardRef.current;
      hoverRef.current = ids && ids.size > 0 ? ids : null;
      // Same expansion as the selection scene: hovering a group's row in the
      // disambiguation menu has to light the group up.
      hoverSceneRef.current =
        brd && hoverRef.current
          ? buildScene(subsetBoardItems(brd, expandGroupIds(brd, hoverRef.current)), {
              hideFrontFootprints: !objects.footprintsFront,
              hideBackFootprints: !objects.footprintsBack,
            })
          : null;
      requestDraw();
    },
    [objects.footprintsFront, objects.footprintsBack, requestDraw],
  );

  // ----- board model mutation (edits + undo/redo) -----------------------------

  /**
   * Generation counter for the off-critical-path scene rebuild a drag starts.
   * Any newer rebuild supersedes an older one, so a stale result cannot land
   * on top of a committed edit and two drags cannot race.
   */
  const baseRebuildRef = useRef(0);
  /**
   * The delta already applied to the retained buffer, when a move is running
   * in place instead of through a rebuild. `null` means the gesture is using
   * the rebuild path (Canvas2D, a router drag, or items with no ranges).
   */
  const inPlaceMoveRef = useRef<{ x: number; y: number } | null>(null);
  /** The moving items' airwires, bucketed once at grab and only moved after. */
  const localRatsRef = useRef<LocalRatsnest | null>(null);
  const ratsOtherRef = useRef<RatsnestEdge[]>([]);

  // Recompile the render scene for a new board and repaint (edits change geometry).
  const rebuildScene = useCallback(
    (b: Board) => {
      // Supersede anything a drag left in flight, so it cannot land on top of
      // this scene a moment later.
      baseRebuildRef.current++;
      sceneRef.current = buildBoardScene(b, {
        hideFrontFootprints: !objects.footprintsFront,
        hideBackFootprints: !objects.footprintsBack,
      });
      rebuildSelScene();
      sceneDirtyRef.current = true;
      requestDraw();
    },
    [objects.footprintsFront, objects.footprintsBack, requestDraw, rebuildSelScene],
  );

  const rebuildSceneRef = useRef(rebuildScene);
  rebuildSceneRef.current = rebuildScene;

  /**
   * Bring the GL device up once its layer is mounted.
   *
   * A null device means this browser or this moment cannot give us WebGL2, and
   * every frame then takes the raster path exactly as before: an editor that
   * renders is worth more than one that renders quickly.
   *
   * `glOkRef` is set *before* anything compiles a scene — the board is parsed
   * on a 30 ms timer and mount effects run well ahead of that — so the first
   * scene is already built through the right factory.
   */
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas || glRef.current) return;
    glRef.current = PcbGl.create(canvas);
    glOkRef.current = glRef.current !== null;
    if (!glOkRef.current) console.warn('WebGL2 unavailable; drawing the board with Canvas2D');
    // The bitmap-font sheet is fetched and decoded asynchronously, and the
    // board is normally on screen before it lands. Glyph runs are skipped until
    // it does, so the frame that finally shows the net names has to be asked
    // for; without this they wait for the next pan or zoom.
    if (glRef.current) glRef.current.onAtlasLoaded = () => requestDrawRef.current();
    // A lost context is not something we can prevent, only something we can
    // survive. Dropping the device is not enough: the scene on hand is full of
    // GL paths that a 2D canvas draws as nothing, so it has to be recompiled
    // through Path2D before the fallback can paint anything at all.
    const onLost = (e: Event): void => {
      e.preventDefault();
      glRef.current?.dispose();
      glRef.current = null;
      glOkRef.current = false;
      const brd = boardRef.current;
      if (brd) rebuildSceneRef.current(brd);
      requestDrawRef.current();
    };
    /**
     * ...and then come back. `preventDefault()` above asks the browser to
     * restore the context; with no listener for it, that request was made and
     * ignored, so a transient loss - a GPU reset, a driver update, the tab
     * reclaimed while backgrounded - left this editor on the raster path
     * permanently, until a reload. GerberCanvas and DrawingSheetCanvas have
     * restored theirs all along.
     *
     * The new device's buffers are empty, so the scene is rebuilt rather than
     * merely redrawn, and `glOkRef` goes back up - it is what the scene
     * compiler keys off, not `glRef.current`.
     */
    const onRestored = (): void => {
      glRef.current = PcbGl.create(canvas);
      glOkRef.current = !!glRef.current;
      const brd = boardRef.current;
      if (brd) rebuildSceneRef.current(brd);
      requestDrawRef.current();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      glRef.current?.dispose();
      glRef.current = null;
      glOkRef.current = false;
    };
  }, []);

  const setBoardModel = useCallback(
    (b: Board) => {
      boardRef.current = b;
      setBoard(b);
      rebuildScene(b);
    },
    [rebuildScene],
  );

  /**
   * Does anything on the board ask for teardrops?
   *
   * The refresh below is a full rebuild, so it is worth one cheap scan to skip
   * it entirely — which is what happens on every board that has never opened
   * the Edit Teardrops dialog.
   */
  // teardropParamsList is defined further down (it needs boardSetup); commitBoard
  // reaches it through a ref so its own identity stays stable.
  const teardropListRef = useRef<() => TeardropParametersList>(defaultTeardropParametersList);
  // BOARD_DESIGN_SETTINGS::m_SolderMaskExpansion, for the mask zone a teardrop
  // grows when its track opens the mask.
  const teardropMaskExpansionRef = useRef(0);

  const boardWantsTeardrops = (b: Board): boolean =>
    b.vias.some((v) => v.teardrops?.enabled) ||
    b.footprints.some((f) => f.pads.some((p) => p.teardrops?.enabled)) ||
    b.zones.some((z) => z.teardropType !== undefined);

  /**
   * Commit an edit: snapshot the current board for undo, then swap in the next.
   *
   * BOARD_COMMIT::Push refreshes teardrops on every commit that touched a
   * track, pad, via or footprint — teardrops in pcbnew are live, they follow
   * your routing rather than waiting for you to re-run a command. We rebuild
   * the whole set rather than tracking dirty items; that is the same answer,
   * and the scan above keeps boards without teardrops from paying for it.
   *
   * `skipTeardrops` is upstream's SKIP_TEARDROPS flag: the teardrop commands
   * have already built the zones they want, and re-running here would be
   * redundant work on a board that just did it.
   */
  const commitBoard = useCallback(
    (next: Board, opts: { skipTeardrops?: boolean } = {}) => {
      const prev = boardRef.current;
      if (prev) undoRef.current.push(prev);
      redoRef.current = [];
      setDirty(true);
      const refresh =
        !opts.skipTeardrops &&
        boardHasTeardrops(next) &&
        (!prev || teardropInputsChanged(prev, next));

      setBoardModel(refresh ? applyTeardrops(next, { list: teardropListRef.current() }) : next);
    },
    [setBoardModel],
  );

  // ----- Update PCB from Schematic (BOARD_EDITOR_CONTROL::UpdatePCBFromSchematic) --

  /**
   * FetchNetlistFromSchematic, then load every footprint the netlist names so the
   * synchronous updater can run: the hosted libraries plus any `.pretty` the project
   * carries (FOOTPRINT_LIBRARY_ADAPTER's project rows). A bare footprint name with no
   * library nickname searches the libraries alphabetically, as
   * LoadFootprintWithOptionalNickname does.
   */
  const openUpdatePcb = useCallback(async (): Promise<void> => {
    setUpdatePcbError(null);
    const files = projectFilesNow();

    const fetched = fetchNetlistFromSchematic(
      files,
      'Updating PCB requires a fully annotated schematic.',
      rootPro,
    );

    if (!fetched.ok) {
      setUpdatePcbError({
        message: fetched.error,
        ...(fetched.details ? { details: fetched.details } : {}),
      });
      return;
    }

    setUpdatePcbBusy(true);
    try {
      // Project-local `.kicad_mod` files, keyed by "<pretty dir>:<name>".
      const projectFootprints = new Map<string, string>();
      for (const file of files) {
        const norm = file.name.replace(/\\/g, '/');
        const match = /([^/]+)\.pretty\/([^/]+)\.kicad_mod$/i.exec(norm);
        if (match) projectFootprints.set(`${match[1]}:${match[2]}`, file.text);
      }

      const wanted = new Set<string>();
      for (const component of fetched.netlist.Components()) {
        const fpid = component.GetFPID();
        if (fpid !== '') wanted.add(fpid);
      }

      const library = new Map<string, PcbFootprint>();
      await Promise.all(
        [...wanted].map(async (fpid) => {
          const local = projectFootprints.get(fpid);
          if (local) {
            const parsed = parseFootprint(local);
            if (parsed) {
              library.set(fpid, parsed);
              return;
            }
          }
          const fromLibrary = await loadFootprint(fpid);
          if (fromLibrary) library.set(fpid, fromLibrary);
        }),
      );

      setUpdatePcb({ netlist: fetched.netlist, library });
    } finally {
      setUpdatePcbBusy(false);
    }
  }, [projectFilesNow, rootPro]);

  // Tools > Update PCB from Schematic, invoked from the schematic editor: the
  // app switches to this frame and bumps the nonce, and the same dialog opens
  // as for this frame's own F8. Skipped on mount so merely opening the PCB
  // editor does not pop it.
  const updateReqRef = useRef<number | null | undefined>(updateFromSchematic);
  useEffect(() => {
    if (updateFromSchematic === updateReqRef.current) return;
    updateReqRef.current = updateFromSchematic;
    if (updateFromSchematic != null) void openUpdatePcb();
  }, [updateFromSchematic, openUpdatePcb]);

  /**
   * DIALOG_UPDATE_PCB::PerformUpdate. A dry run only reports; a real run commits the
   * new board, then spreads the footprints it added and selects them,
   * PCB_EDIT_FRAME::OnNetlistChanged's SpreadFootprints + selectItems, which is what
   * leaves the new parts ready to be dragged into place.
   */
  const performNetlistUpdate = useCallback(
    (options: UpdatePcbOptions, dryRun: boolean): readonly ReportLine[] => {
      const brd = boardRef.current;
      if (!brd || !updatePcb) return [];

      const reporter = new Reporter();
      const updater = new BOARD_NETLIST_UPDATER(
        brd,
        reporter,
        (fpid) => {
          const direct = updatePcb.library.get(fpid);
          if (direct) return direct;
          if (fpid.includes(':')) return null;
          for (const key of [...updatePcb.library.keys()].sort()) {
            if (key.slice(key.indexOf(':') + 1) === fpid) return updatePcb.library.get(key) ?? null;
          }
          return null;
        },
        {
          isDryRun: dryRun,
          // SetFindByTimeStamp( !relink ) / SetLookupByTimestamp( !relink ).
          lookupByTimestamp: !options.relinkFootprints,
          replaceFootprints: options.updateFootprints,
          deleteUnusedFootprints: options.deleteExtraFootprints,
          overrideLocks: options.overrideLocks,
          updateFields: options.updateFields,
          removeExtraFields: options.removeExtraFields,
          transferGroups: options.transferGroups,
        },
      );

      const result = updater.UpdateNetlist(updatePcb.netlist);

      if (!dryRun) {
        const spread =
          result.addedFootprints.length > 0
            ? spreadBoardFootprints(result.board, result.addedFootprints)
            : result.board;
        commitBoard(spread);
        const added = new Set(result.addedFootprints.map((i) => boardItemId('footprint', i)));
        setSelection(added);
        // `*aRunDragCommand = true` (`netlist.cpp:152`), acted on by the dialog's
        // destructor: the spread cluster follows the cursor until you click.
        startPostUpdateMoveRef.current(added);
      }

      return reporter.lines;
    },
    [updatePcb, commitBoard],
  );

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev || !boardRef.current) return;
    redoRef.current.push(boardRef.current);
    setDirty(true);
    setBoardModel(prev);
    setSelection(new Set());
  }, [setBoardModel]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next || !boardRef.current) return;
    undoRef.current.push(boardRef.current);
    setDirty(true);
    setBoardModel(next);
    setSelection(new Set());
  }, [setBoardModel]);

  // Selection-filter predicate ref (assigned once passesFilter is defined), so
  // the stable Select All callback can honour the live filter.
  const passesFilterRef = useRef<(id: string) => boolean>(() => true);

  // Delete the selected items (EDIT_TOOL::Remove). Reads the live selection ref
  // so the keyboard shortcut and menu both act on the current selection.
  // Deleting a group deletes its members too (the id set keeps the group id so
  // the group node itself is dropped as well).
  const deleteSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    // EDIT_TOOL::Remove refuses outright when the free-pad filter would take a
    // whole footprint with a selected pad; upstream rings the bell, and there is
    // no bell to ring here, so the command simply does nothing.
    const items = filterSelectionForDelete(new Set([...sel, ...expandGroupIds(brd, sel)]));
    if (!items) return;
    commitBoard(deleteBoardItems(brd, items));
    setSelection(new Set());
  }, [commitBoard]);

  // Select All / Unselect All (ACTIONS::selectAll / unselectAll). Select All
  // honours the Selection Filter, like PCB_SELECTION_TOOL::selectAll.
  const selectAllSel = useCallback(() => {
    const brd = boardRef.current;
    if (!brd) return;
    setSelection(new Set(allBoardItemIds(brd).filter(passesFilterRef.current)));
  }, []);
  const unselectAllSel = useCallback(() => setSelection(new Set()), []);

  /**
   * `EDIT_TOOL::updateModificationPoint` — what Rotate and Mirror turn the
   * selection about. **One item turns about its own anchor**
   * (`BOARD_ITEM::GetPosition`, a footprint's origin cross), and only a
   * multi-item selection turns about the grid-snapped centre of its box.
   *
   * We passed no centre at all, so both commands fell back to the bounding-box
   * centre for every selection. On a footprint that is not the same point: the
   * box is grown by the silkscreen and the courtyard, so rotating a part
   * translated it by half the offset between its origin and its box centre —
   * a different amount for every part, and it drifted further on every R.
   */
  const modPoint = useCallback((brd: Board, items: ReadonlySet<string>) => {
    // `grid.BestSnapAnchor( refPt, nullptr )`, the multi-item branch's snap.
    return (
      modificationPoint(brd, items, (p) =>
        bestSnapAnchor(brd, p, gridState(), {
          snapScale: 25 / viewRef.current.scale,
          hysteresis: 5 / viewRef.current.scale,
          visibleGrid: gridIURef.current,
          layer: activeLayerRef.current,
        }),
      ) ?? undefined
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rotate the selection ±90° (EDIT_TOOL::Rotate). Keeps the selection so it
  // can be rotated repeatedly. Groups rotate as their members.
  const rotateSel = useCallback(
    (ccw: boolean) => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      const { items, selection } = promotePadsForCommand(brd, sel);
      if (selection) setSelection(selection);
      // `EDIT_TOOL::Rotate`: `rotateAngle = TOOL_EVT_UTILS::GetEventRotationAngle(
      // *frame(), aEvent )`, which is `frame->GetRotationAngle()` — Preferences
      // > PCB Editor > Editing Options' "Step for rotate commands", stored in
      // tenths of a degree. This was a hardcoded ±90.
      const step = rotationStepRef.current;
      commitBoard(rotateBoardItemsBy(brd, items, ccw ? step : -step, modPoint(brd, items)));
    },
    [commitBoard, modPoint],
  );

  // Mirror the selection (EDIT_TOOL::Mirror; mirrorV = flip top/bottom,
  // mirrorH = left/right), about the same modification point as Rotate
  // (edit_tool.cpp:2451). Footprints are skipped, like KiCad.
  const mirrorSel = useCallback(
    (direction: 'v' | 'h') => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      const { items, selection } = promotePadsForCommand(brd, sel);
      if (selection) setSelection(selection);
      commitBoard(mirrorBoardItems(brd, items, direction, modPoint(brd, items)));
    },
    [commitBoard, modPoint],
  );

  // Group / ungroup the selection (ACTIONS::group / ungroup).
  const groupSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    // ACTIONS::group is enabled only for >= 2 selected items (GROUP_TOOL::update
    // -> Enable( group, selectionCount >= 2 )); grouping a lone item is a no-op.
    if (!brd || sel.size < 2) return;
    const { board: next, id } = groupBoardItems(brd, sel);
    if (!id) return;
    commitBoard(next);
    setSelection(new Set([id]));
  }, [commitBoard]);
  const ungroupSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    // The members stay selected after dissolving their group, like KiCad.
    const members = expandGroupIds(brd, sel);
    commitBoard(ungroupBoardItems(brd, sel));
    setSelection(members);
  }, [commitBoard]);
  // Add the selected items to the one selected group (ACTIONS::addToGroup); the
  // group stays selected afterwards, like GROUP_TOOL::AddToGroup.
  const addToGroupSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    const next = addToGroupItems(brd, sel);
    if (next === brd) return;
    const gid = [...sel].find((id) => parseBoardItemId(id)?.kind === 'group');
    commitBoard(next);
    if (gid) setSelection(new Set([gid]));
  }, [commitBoard]);
  // Remove the selected items from their parent groups (ACTIONS::removeFromGroup).
  const removeFromGroupSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    const next = removeFromGroupItems(brd, sel);
    if (next === brd) return;
    commitBoard(next);
  }, [commitBoard]);

  // Group-edit context (SELECTION_TOOL::EnterGroup): double-clicking a group
  // "enters" it so its members become individually selectable; Esc or double-
  // clicking empty space leaves. Held as the group's uuid so it survives edits.
  const [enteredGroup, setEnteredGroup] = useState<string | null>(null);
  const enteredGroupRef = useRef<string | null>(null);
  enteredGroupRef.current = enteredGroup;
  // Drop out if the entered group is dissolved (ungroup / remove-from-group).
  useEffect(() => {
    if (enteredGroup && board && !board.groups.some((g) => g.uuid === enteredGroup))
      setEnteredGroup(null);
  }, [board, enteredGroup]);
  const enteredGroupName = useMemo(() => {
    if (!enteredGroup || !board) return null;
    const g = board.groups.find((x) => x.uuid === enteredGroup);
    return g ? g.name || 'Anonymous Group' : null;
  }, [enteredGroup, board]);

  // Canvas right-click menu (PCB_SELECTION_TOOL TOOL_MENU) position, or null.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // Lock / unlock the selection (PCB_ACTIONS::lock / unlock).
  const lockSel = useCallback(
    (locked: boolean | 'toggle') => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      commitBoard(setBoardItemsLocked(brd, sel, locked));
    },
    [commitBoard],
  );

  // Duplicate the selection 1 mm off (EDIT_TOOL::Duplicate) and select the copies.
  const duplicateSel = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    const { board: next, ids } = duplicateBoardItems(brd, expandGroupIds(brd, sel), {
      x: MM,
      y: MM,
    });
    commitBoard(next);
    setSelection(new Set(ids));
  }, [commitBoard]);

  // Align selected items like ALIGN_DISTRIBUTE_TOOL: choose the target item
  // under the cursor when there is one, otherwise the first selected item in
  // KiCad's sorted order, then move each item's own bounding box to that target.
  const alignSelection = useCallback(
    (action: AlignAction) => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length < 2) return;

      const entries = sel
        .map((id) => {
          const bbox = boardItemBBox(brd, id);
          return bbox ? { id, bbox } : null;
        })
        .filter((entry): entry is { id: string; bbox: BoardBBox } => !!entry);
      if (entries.length < 2) return;

      const effective =
        flipView && action === 'left' ? 'right' : flipView && action === 'right' ? 'left' : action;
      const sorted = [...entries].sort((a, b) => {
        switch (effective) {
          case 'left':
            return a.bbox.minX - b.bbox.minX;
          case 'right':
            return b.bbox.maxX - a.bbox.maxX;
          case 'top':
            return a.bbox.minY - b.bbox.minY;
          case 'bottom':
            return b.bbox.maxY - a.bbox.maxY;
          case 'centerX':
            return bboxCenter(a.bbox).x - bboxCenter(b.bbox).x;
          case 'centerY':
            return bboxCenter(a.bbox).y - bboxCenter(b.bbox).y;
        }
        return 0;
      });
      const cursorHit = cursorRef.current
        ? sorted.find((entry) => bboxContainsPoint(entry.bbox, cursorRef.current!))
        : undefined;
      const target = cursorHit ?? sorted[0];
      if (!target) return;

      const targetCenter = bboxCenter(target.bbox);
      let next = brd;
      let changed = false;
      for (const entry of entries) {
        const center = bboxCenter(entry.bbox);
        let delta = { x: 0, y: 0 };
        switch (effective) {
          case 'left':
            delta = { x: target.bbox.minX - entry.bbox.minX, y: 0 };
            break;
          case 'right':
            delta = { x: target.bbox.maxX - entry.bbox.maxX, y: 0 };
            break;
          case 'top':
            delta = { x: 0, y: target.bbox.minY - entry.bbox.minY };
            break;
          case 'bottom':
            delta = { x: 0, y: target.bbox.maxY - entry.bbox.maxY };
            break;
          case 'centerX':
            delta = { x: targetCenter.x - center.x, y: 0 };
            break;
          case 'centerY':
            delta = { x: 0, y: targetCenter.y - center.y };
            break;
        }
        if (delta.x !== 0 || delta.y !== 0) {
          next = moveBoardItems(next, new Set([entry.id]), delta);
          changed = true;
        }
      }
      if (changed) commitBoard(next);
    },
    [commitBoard, flipView],
  );

  /** EDIT_TOOL::MoveExact, once the dialog has the numbers. */
  const applyMoveExact = useCallback(
    (v: MoveExactValues) => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length === 0) return;

      const next = moveExact(brd, sel, {
        translation: v.translation,
        rotation: v.rotation,
        anchor: v.anchor,
        // Both origins are the board origin here: we have no user-settable
        // local or drill/place origin yet, so those two anchors turn about
        // (0,0) rather than silently doing nothing.
        userOrigin: { x: 0, y: 0 },
        auxOrigin: { x: 0, y: 0 },
      });
      if (next !== brd) commitBoard(next);
      setMoveExactOpen(false);
    },
    [commitBoard],
  );

  /** POSITION_RELATIVE_TOOL::RelativeItemSelectionMove, once the dialog has
   *  the reference and the offset. */
  const applyPositionRelative = useCallback(
    (v: PositionRelativeValues) => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length === 0) return;

      const next = positionRelative(brd, sel, v);
      if (next !== brd) commitBoard(next);
      setPosRelOpen(false);
    },
    [commitBoard],
  );

  /** CONVERT_TOOL::CreatePolys — to a filled graphic, a zone, or a rule area. */
  const convertSelection = useCallback(
    (to: 'poly' | 'zone' | 'ruleArea' | 'lines' | 'tracks' | 'arc') => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length === 0) return;

      const layer = activeLayer;
      let next = brd;

      if (to === 'poly') {
        next = convertToPoly(brd, sel, { layer }).board;
      } else if (to === 'zone' || to === 'ruleArea') {
        next = convertToZone(brd, sel, { layer, ruleArea: to === 'ruleArea' }).board;
      } else if (to === 'lines' || to === 'tracks') {
        next = convertToLines(brd, sel, {
          layer,
          target: to === 'tracks' ? 'track' : 'graphic',
        }).board;
      } else {
        // Create Arc acts on one item, upstream's selection.Front().
        next = segmentToArc(brd, sel[0]!).board;
      }

      if (next !== brd) commitBoard(next);
    },
    [commitBoard, activeLayer],
  );

  /** EDIT_TOOL::ModifyLines — fillet, chamfer or extend the selected lines. */
  const applyLineModification = useCallback(
    (op: LineModification, valueIU?: number) => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length < 2) return;

      const res = modifyLines(brd, sel, op, {
        radius: valueIU,
        setback: valueIU,
        dogboneRadius: valueIU,
        // Without slots, an acute corner yields a pocket no cutter can reach.
        // Upstream offers the choice; taking the usable one is the better
        // default, and the engine reports which case it hit either way.
        addSlots: true,
      });
      if (res.board !== brd) commitBoard(res.board);
      setLineModOpen(null);
    },
    [commitBoard],
  );

  /** POLYGON_BOOLEAN_ROUTINE — merge, subtract or intersect the selection. */
  const applyPolygonBoolean = useCallback(
    (op: PolygonBoolean) => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length < 2) return;

      const res = polygonBoolean(brd, sel, op);
      if (res.board !== brd) {
        commitBoard(res.board);
        // The sources are gone and the result is new, so the old ids name
        // nothing (or worse, something else). Clearing is the honest answer.
        setSelection(new Set());
      }
    },
    [commitBoard],
  );

  /** OUTSET_ROUTINE — draw the selection again, a fixed distance outside. */
  const applyOutset = useCallback(
    (settings: OutsetSettings) => {
      setOutsetSettings(settings);
      setOutsetOpen(false);

      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length === 0) return;

      const res = outsetItems(brd, sel, outsetOptionsFrom(settings));
      if (res.board !== brd) commitBoard(res.board);
    },
    [commitBoard],
  );

  /** ARRAY_TOOL::CreateArray. */
  const applyArray = useCallback(
    (settings: ArraySettings) => {
      setArraySettings(settings);
      setArrayOpen(false);

      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length === 0) return;

      const res = createArray(brd, sel, arraySpecFrom(settings));
      if (res.board !== brd) commitBoard(res.board);
    },
    [commitBoard],
  );

  /** ALIGN_DISTRIBUTE_TOOL::DistributeItems. */
  const distributeSelection = useCallback(
    (action: DistributeAction) => {
      const brd = boardRef.current;
      const sel = [...selForDrawRef.current];
      if (!brd || sel.length < 3) return;

      const next = distributeBoardItems(brd, sel, action);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard],
  );

  /**
   * `ALIGN_DISTRIBUTE_TOOL`'s submenu (align_distribute_tool.cpp:66-88), built
   * ONCE.
   *
   * It had been written out by hand in the Edit menu, and left out of the
   * selection context menu, which is the one place upstream actually hangs it
   * (`selToolMenu.AddMenu( m_placementMenu, MoreThan( 1 ), 100 )`, :87-88;
   * `menubar_pcb_editor.cpp` has no align rows at all). The hand-written copy
   * had drifted too: "Distribute Horizontally by Gaps" against the action's own
   * "Distribute Horizontally with Even Gaps" (pcb_actions.cpp:2304-2307). One
   * builder is how that stops happening - the editor fills in the data, it does
   * not re-lay the menu.
   *
   * `canAlign` is `MoreThan( 1 )`; `canDistribute` is `MoreThan( 2 )` and the
   * rule above the distribute group carries `canDistribute` itself (:78), so at
   * two items the submenu ends after Align to Bottom rather than on a rule with
   * four dead rows beneath it.
   */
  const alignDistributeSubmenu = (): MenuItem[] => {
    const align = (label: string, action: AlignAction): MenuItem => ({
      label,
      action: () => alignSelection(action),
    });
    const distribute = (label: string, action: DistributeAction): MenuItem => ({
      label,
      action: () => distributeSelection(action),
    });
    return [
      align('Align to Left', 'left'),
      align('Align to Horizontal Center', 'centerX'),
      align('Align to Right', 'right'),
      { sep: true },
      align('Align to Top', 'top'),
      align('Align to Vertical Center', 'centerY'),
      align('Align to Bottom', 'bottom'),
      ...(selection.size > 2
        ? [
            { sep: true } as MenuItem,
            distribute('Distribute Horizontally by Centers', 'horizontallyCenters'),
            distribute('Distribute Horizontally with Even Gaps', 'horizontallyGaps'),
            distribute('Distribute Vertically by Centers', 'verticallyCenters'),
            distribute('Distribute Vertically with Even Gaps', 'verticallyGaps'),
          ]
        : []),
    ];
  };

  // Fit the view to a world-space box (shared by Zoom-to-Fit variants and the
  // interactive zoom tool).
  const fitWorldBox = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number, fitType: FitType = 'all') => {
      const canvas = canvasRef.current;
      if (!canvas || maxX <= minX || maxY <= minY) return;
      // COMMON_TOOLS::doZoomFit's margin_scale_factor, not our own 5 mm pad.
      const s = zoomFitScale(
        { minX, minY, maxX, maxY },
        { width: canvas.width, height: canvas.height },
        'pcb',
        fitType,
      );
      if (s === null) return;
      const flipX = viewRef.current.flipX;
      viewRef.current = {
        scale: s,
        flipX,
        tx: canvas.width / 2 - ((minX + maxX) / 2) * (flipX ? -s : s),
        ty: canvas.height / 2 - ((minY + maxY) / 2) * s,
      };
      requestDraw();
    },
    [requestDraw],
  );

  // ACTIONS::zoomFitScreen (Home): fit the page frame + objects.
  // ACTIONS::zoomFitObjects (Ctrl+Home): fit the objects only, ignoring the
  // drawing sheet.
  //
  // Which box that is — and, on a board with nothing in it, the fact that there
  // is a box at all — is `pcbZoomFitBox`; see `document_extents.ts` for the
  // `GetBoardBoundingBox` fallback it ports. Before it, an empty board's null
  // scene box returned here and the button did nothing.
  const zoomToFitImpl = useCallback(
    (includeSheet: boolean) => {
      const box = pcbZoomFitBox(sceneRef.current?.bbox ?? null, {
        paper: boardRef.current?.paper,
        drawingSheetVisible: objects.drawingSheet,
        includeSheet,
      });
      if (!box) return;
      fitWorldBox(box.minX, box.minY, box.maxX, box.maxY, includeSheet ? 'all' : 'objects');
    },
    [fitWorldBox, objects.drawingSheet],
  );
  const zoomToFit = useCallback(() => zoomToFitImpl(true), [zoomToFitImpl]);
  const zoomFitObjects = useCallback(() => zoomToFitImpl(false), [zoomToFitImpl]);

  // Select on PCB, arriving from the schematic frame: pcbnew's "$SELECT:"
  // handler, `FindItemsFromSyncSelection` then `doSyncSelection` — replace the
  // selection with what the parts name, then move the view onto it.
  //
  // Every step is one of pcbnew's own `cross_probing.*` settings, and it is
  // *pcbnew's* copy that applies: upstream the frame that RECEIVES a probe is
  // the one whose settings decide what it does (pcbnew/cross-probing.cpp:734
  // reads `GetPcbNewSettings()`), so the schematic's copy has no say here.
  //
  // Keyed on the nonce alone: the parts of a repeated request are equal, and
  // re-running on every render would fight the user's own clicks.
  const syncNonce = syncSelection?.nonce;
  const syncPartsRef = useRef(syncSelection?.parts);
  syncPartsRef.current = syncSelection?.parts;
  // The flash run in progress (pcb_edit_frame.cpp:665-679): the ids to restore
  // and the interval handle, kept out of state so a phase tick does not have to
  // survive a re-render to be cancellable.
  const flashRef = useRef<{ ids: readonly string[]; timer: number } | null>(null);
  useEffect(() => {
    if (syncNonce === undefined) return;
    const brd = boardRef.current;
    const canvas = canvasRef.current;
    if (!brd) return;
    const cfg = settings.pcbnew.cross_probing;
    // null is `case MAIL_SELECTION: if( !...on_selection ) break;` — the packet
    // is dropped whole, so the existing selection stays as the user left it.
    const ids = crossProbeSelection(cfg, brd, syncPartsRef.current ?? []);
    if (ids === null) return;
    setSelection(new Set(ids));

    // A fresh probe restarts any flash still running (`m_crossProbeFlashTimer.Stop()`).
    if (flashRef.current) {
      clearInterval(flashRef.current.timer);
      flashRef.current = null;
    }
    if (cfg.flash_selection && ids.length > 0) {
      let phase = 0;
      const timer = window.setInterval(() => {
        setSelection(new Set(crossProbeFlashSelection(phase, ids)));
        phase++;
        if (phase > CROSS_PROBE_FLASH_LAST_PHASE) {
          if (flashRef.current) clearInterval(flashRef.current.timer);
          flashRef.current = null;
          setSelection(new Set(ids));
        }
      }, CROSS_PROBE_FLASH_INTERVAL_MS);
      flashRef.current = { ids, timer };
    }

    if (ids.length === 0 || !canvas) return;

    let box: BoardBBox | null = null;
    for (const id of ids) {
      const b = boardItemBBox(brd, id);
      if (!b) continue;
      box = box
        ? {
            minX: Math.min(box.minX, b.minX),
            minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX),
            maxY: Math.max(box.maxY, b.maxY),
          }
        : b;
    }

    const view = viewRef.current;
    // Where the view is looking now. The zoom changes first and keeps this
    // point (`VIEW::SetScale` scales about the centre), so it is read off the
    // old scale and re-applied under the new one.
    const next = crossProbeViewChange(
      cfg,
      box,
      {
        scale: view.scale,
        cx: (canvas.width / 2 - view.tx) / (view.flipX ? -view.scale : view.scale),
        cy: (canvas.height / 2 - view.ty) / view.scale,
      },
      { width: canvas.width, height: canvas.height },
    );
    if (!next) return;

    viewRef.current = {
      scale: next.scale,
      flipX: view.flipX,
      tx: canvas.width / 2 - next.cx * (view.flipX ? -next.scale : next.scale),
      ty: canvas.height / 2 - next.cy * next.scale,
    };
    requestDraw();
  }, [syncNonce, requestDraw]);
  // Never leave a flash interval behind when the board editor unmounts.
  useEffect(
    () => () => {
      if (flashRef.current) clearInterval(flashRef.current.timer);
      flashRef.current = null;
    },
    [],
  );

  // DIALOG_FIND::search: collect hits in upstream order, footprint reference
  // designators, footprint values, other text items (footprint text, board
  // text, zone names), then net names, and walk the list with Find Next /
  // Find Previous, wrapping when enabled. Each hit selects the item and
  // centres the view on it (FocusOnLocation).
  const runFind = useCallback(
    (dir: 'next' | 'prev' | 'restart') => {
      const brd = boardRef.current;
      if (!brd) return;
      const q = findQuery;
      const matches = (s0: string): boolean => {
        if (!q) return false;
        const s = findOpts.matchCase ? s0 : s0.toLowerCase();
        const needle = findOpts.matchCase ? q : q.toLowerCase();
        if (findOpts.wildcard) {
          const rx = new RegExp(
            `^${needle
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.')}$`,
          );
          return rx.test(s);
        }
        if (findOpts.wholeWord) {
          const rx = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
          return rx.test(s);
        }
        return s.includes(needle);
      };

      if (findDirtyRef.current || dir === 'restart') {
        const hits: { id: string; pos: { x: number; y: number } }[] = [];
        brd.footprints.forEach((fp, i) => {
          const refIdx = fp.texts.findIndex((t) => t.kind === 'reference');
          const valIdx = fp.texts.findIndex((t) => t.kind === 'value');
          if (findOpts.includeReferences && matches(fp.reference ?? ''))
            hits.push({
              id: refIdx >= 0 ? boardItemId('fptext', i, refIdx) : boardItemId('footprint', i),
              pos: refIdx >= 0 ? fp.texts[refIdx]!.at : fp.at,
            });
          if (findOpts.includeValues && matches(fp.value ?? ''))
            hits.push({
              id: valIdx >= 0 ? boardItemId('fptext', i, valIdx) : boardItemId('footprint', i),
              pos: valIdx >= 0 ? fp.texts[valIdx]!.at : fp.at,
            });
          if (findOpts.includeTexts)
            fp.texts.forEach((t, ti) => {
              if (t.kind === 'user' && (findOpts.includeHidden || !t.hide) && matches(t.text))
                hits.push({ id: boardItemId('fptext', i, ti), pos: t.at });
            });
        });
        if (findOpts.includeTexts) {
          brd.texts.forEach((t, i) => {
            if (matches(t.text)) hits.push({ id: boardItemId('text', i), pos: t.at });
          });
          brd.zones.forEach((z, i) => {
            const p = z.outline?.[0] ?? z.fills[0]?.polys[0]?.[0];
            if (z.netName && p && matches(z.netName))
              hits.push({ id: boardItemId('zone', i), pos: p });
          });
        }
        if (findOpts.includeNets) {
          for (const [code, name] of brd.nets) {
            if (code === 0 || !matches(name)) continue;
            // Focus the first copper item carrying the net.
            const t = brd.tracks.findIndex((x) => x.net === code);
            if (t >= 0) {
              hits.push({ id: boardItemId('track', t), pos: brd.tracks[t]!.start });
              continue;
            }
            const v = brd.vias.findIndex((x) => x.net === code);
            if (v >= 0) hits.push({ id: boardItemId('via', v), pos: brd.vias[v]!.at });
          }
        }
        findHitsRef.current = hits;
        findCursorRef.current = -1;
        findDirtyRef.current = false;
      }

      const hits = findHitsRef.current;
      if (hits.length === 0) {
        setFindStatus(q ? `"${q}" not found` : '');
        return;
      }
      let cur = findCursorRef.current;
      if (dir === 'prev') cur -= 1;
      else cur += 1;
      if (findOpts.wrap) cur = ((cur % hits.length) + hits.length) % hits.length;
      else cur = Math.max(0, Math.min(hits.length - 1, cur));
      findCursorRef.current = cur;
      const hit = hits[cur]!;
      setFindStatus(`Hit(s): ${cur + 1} of ${hits.length}`);
      setSelection(new Set([hit.id]));
      // FocusOnLocation: centre the view on the hit at the current zoom.
      const canvas = canvasRef.current;
      if (canvas) {
        const v = viewRef.current;
        const sx = v.flipX ? -v.scale : v.scale;
        v.tx = canvas.width / 2 - hit.pos.x * sx;
        v.ty = canvas.height / 2 - hit.pos.y * v.scale;
        requestDraw();
      }
    },
    [findQuery, findOpts, requestDraw],
  );
  // Query/options edits restart the search on the next Find. Board edits do
  // too: `board` gets a fresh object identity on every mutation, so the cached
  // hit list is invalidated whenever the board changes (matching the always-
  // live schematic Find) rather than going stale until Restart Search.
  useEffect(() => {
    findDirtyRef.current = true;
  }, [findQuery, findOpts, board]);

  // EDA_DRAW_FRAME::FocusOnLocation for the DRC dialog's click-to-locate:
  // centre the view only when the position is off the current view or within
  // 10% of its edge (the viewport deflated by width/10 on every side), or
  // when it sits behind, or within 10% of, the modeless DRC dialog.
  const drcFocusOn = useCallback(
    (pos: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const sx = v.flipX ? -v.scale : v.scale;
      const px = pos.x * sx + v.tx;
      const py = pos.y * v.scale + v.ty;
      const margin = canvas.width / 10;
      let center =
        px < margin || px > canvas.width - margin || py < margin || py > canvas.height - margin;
      const dlg = drcDialogRef.current;
      if (!center && dlg) {
        const dr = dlg.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        const k = cr.width > 0 ? canvas.width / cr.width : 1; // device px per CSS px
        const inflate = (dr.width * k) / 10;
        center =
          px >= (dr.left - cr.left) * k - inflate &&
          px <= (dr.right - cr.left) * k + inflate &&
          py >= (dr.top - cr.top) * k - inflate &&
          py <= (dr.bottom - cr.top) * k + inflate;
      }
      if (center) {
        v.tx = canvas.width / 2 - pos.x * sx;
        v.ty = canvas.height / 2 - pos.y * v.scale;
      }
      requestDraw();
    },
    [requestDraw],
  );

  // The TOP_AUX zoom selector: set an absolute zoom about the viewport centre,
  // as COMMON_TOOLS::doZoomToPreset does with VIEW::SetScale.
  const setZoomPreset = useCallback(
    (z: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const target = scaleForZoomFactor(z, window.devicePixelRatio || 1);
      const px = canvas.width / 2;
      const py = canvas.height / 2;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale = target;
      v.tx = px - wx * (v.flipX ? -target : target);
      v.ty = py - wy * target;
      requestDraw();
    },
    [requestDraw],
  );

  const zoomStep = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const px = canvas.width / 2;
      const py = canvas.height / 2;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale *= factor;
      v.tx = px - wx * (v.flipX ? -v.scale : v.scale);
      v.ty = py - wy * v.scale;
      requestDraw();
    },
    [requestDraw],
  );

  // Size the canvas to its container (device pixels) and fit on first layout.
  const fittedRef = useRef(false);
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      // `canvasBackingSize`, shared with the schematic canvas, and the reason
      // this frame used to shimmer while a dock was dragged: it measured with
      // `getBoundingClientRect()`, whose width is fractional, and put a rounded
      // backing store behind a fractional CSS size — so the browser resampled
      // the whole board on every frame of the drag. See `ui/canvas_size.ts`.
      //
      // `applyCanvasSize` keeps the "only assign canvas.width on a REAL change"
      // rule: assigning it clears the bitmap even when the value is unchanged,
      // and this effect re-runs (and re-observes, firing an initial callback)
      // whenever the draw options change, so a left-toolbar toggle would
      // otherwise blank the view for a frame.
      //
      // The GL and overlay layers are sized with the board canvas. The GL one's
      // drawing buffer *is* the viewport its shaders project into, so a stale
      // size shows up as a board drawn at the wrong scale rather than as
      // nothing at all.
      const size = canvasBackingSize(wrap, dpr);
      const changed = applyCanvasSize([canvas, glCanvasRef.current, overCanvasRef.current], size);
      // Only a fit against a viewport that exists counts.
      //
      // The frames stay mounted and are toggled with CSS, so this observer also
      // fires while the board editor is hidden behind the schematic, and a
      // hidden element measures 0 x 0 — which `Math.max(1, …)` above turns into
      // a 1 x 1 canvas. Fitting to that produced a scale and an offset that
      // meant nothing, and recording it as done meant the real layout, when the
      // user finally switched over, never fitted at all: an empty sheet with the
      // origin marker sitting in it until they pressed Zoom to Fit themselves.
      if (!fittedRef.current && sceneRef.current && isMeasured(size)) {
        fittedRef.current = true;
        zoomToFit();
      } else if (changed) {
        sceneDirtyRef.current = true;
        requestDraw();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dpr, requestDraw, zoomToFit, board]);

  // The other half of the same race: a board can finish parsing after the last
  // resize the observer will ever see, and then nothing is left to trigger the
  // first fit. Runs on the frame after the board changes, does nothing once a
  // real fit has happened, and does nothing while the frame is hidden — so the
  // fit lands on whichever of the two events happens last.
  useEffect(() => {
    if (!board) return;
    let raf = 0;
    const tryFit = (): void => {
      if (fittedRef.current || !sceneRef.current) return;
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return;
      fittedRef.current = true;
      zoomToFit();
    };
    raf = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(raf);
  }, [board, zoomToFit]);

  // Flip board view (PCB_ACTIONS::flipBoard → VIEW::SetMirror on X): toggle the
  // view's horizontal mirror, re-centring so the board stays put, and rebuild
  // the raster (which bakes in the mirror).
  const toggleFlip = useCallback(() => {
    const v = viewRef.current;
    const canvas = canvasRef.current;
    v.flipX = !v.flipX;
    // Mirror tx about the viewport centre so the visible board doesn't jump.
    if (canvas) v.tx = canvas.width - v.tx;
    setFlipView(v.flipX);
    sceneDirtyRef.current = true;
    requestDraw();
  }, [requestDraw]);

  // WX_VIEW_CONTROLS::onWheel; drag to pan (left or middle button).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const v = viewRef.current;
      const action = wheelAction(
        e,
        commonInputPrefs(),
        { width: canvas.width, height: canvas.height },
        zoomCtlRef.current,
      );
      if (action.kind === 'none') return;
      if (action.kind === 'pan') {
        v.tx += action.dx;
        v.ty += action.dy;
        requestDraw();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * dpr;
      const py = (e.clientY - rect.top) * dpr;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale *= action.factor;
      v.tx = px - wx * (v.flipX ? -v.scale : v.scale);
      v.ty = py - wy * v.scale;
      requestDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [dpr, requestDraw]);

  // World coordinate under a pointer event (device pixels → board units).
  const worldAt = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      return {
        x: ((clientX - rect.left) * dpr - v.tx) / (v.flipX ? -v.scale : v.scale),
        y: ((clientY - rect.top) * dpr - v.ty) / v.scale,
      };
    },
    [dpr],
  );

  // Middle-button pan (KiCad reserves the left button for select/move).
  const panRef = useRef<{ x: number; y: number } | null>(null);
  /** `WX_VIEW_CONTROLS::m_metaPanning` / `m_metaPanStart`, per canvas. */
  const motionPanRef = useRef(makeMotionPan());
  /**
   * `WX_VIEW_CONTROLS::m_zoomController` — this canvas's own, because upstream
   * each `WX_VIEW_CONTROLS` owns one and the accelerating one has history.
   */
  const zoomCtlRef = useRef(makeZoomController());
  /**
   * A DRAG_ZOOMING gesture: the last pointer y, and `m_zoomStartPoint` --
   * where the button went down, held fixed for the whole drag
   * (`wx_view_controls.cpp:562`, `:386`).
   */
  const dragZoomRef = useRef<{
    lastClientY: number;
    anchor: { x: number; y: number };
  } | null>(null);
  // The left press in progress: origin, world origin, the item it landed on (if
  // any), and whether it has moved. Still = click; moved on an item = drag-move;
  // moved on empty = box-select.
  const downRef = useRef<{
    x: number;
    y: number;
    world: { x: number; y: number } | null;
    hitId: string | null;
    onItem: boolean;
    moved: boolean;
    shift: boolean;
  } | null>(null);

  // Does an item of this kind pass the Selection Filter panel? (KiCad's
  // SELECTION_FILTER_OPTIONS, track/arc→Tracks, shape→Graphics, etc.)
  const filterKeyOf = (kind: BoardItemKind): string | null =>
    kind === 'track' || kind === 'arc'
      ? 'tracks'
      : kind === 'via'
        ? 'vias'
        : kind === 'footprint'
          ? 'footprints'
          : kind === 'pad'
            ? 'pads'
            : kind === 'zone'
              ? 'zones'
              : kind === 'shape'
                ? 'graphics'
                : kind === 'text' || kind === 'fptext'
                  ? 'text'
                  : // `case PCB_POINT_T: if( !m_filter.points ) …`
                    // (`pcb_selection_tool.cpp:3511-3518`) — points have a
                    // category box of their own, unlike dimensions.
                    kind === 'point'
                    ? 'points'
                    : // `case PCB_BARCODE_T: default: if( !m_filter.otherItems )`
                      // (`pcb_selection_tool.cpp:3522-3530`) — a barcode shares
                      // the catch-all box with targets and the rest, rather
                      // than counting as a graphic.
                      kind === 'barcode'
                      ? 'otherItems'
                      : null;
  const passesFilter = (id: string): boolean => {
    const r = parseBoardItemId(id);
    if (!r) return false;
    // Locked items are selectable only with the "Locked items" filter checked
    // (PCB_SELECTION_FILTER_OPTIONS::lockedItems; KiCad defaults it off).
    const brd = boardRef.current;
    if (brd && !selFilter.has('lockedItems') && isBoardItemLocked(brd, id)) return false;
    const key = filterKeyOf(r.kind);
    return key ? selFilter.has(key) : true;
  };
  passesFilterRef.current = passesFilter;

  // Hit candidates at a board point, KiCad's selectPoint pipeline: collect
  // with exact hit distances, Selection Filter, then GuessSelectionCandidates
  // (slop pruning, the 1.5× coverage-area heuristic, active-layer preference),
  // all transcribed in boardHitCandidates. One id = unambiguous click; several
  // = KiCad would pop the disambiguation menu. Finally, a hit on a group
  // member resolves to its top-level group (PCB_GROUP::TopLevelGroup).
  const hitCandidates = (w: { x: number; y: number }, excludeZoneFills = false): string[] => {
    const brd = boardRef.current;
    if (!brd) return [];
    const canvas = canvasRef.current;
    const v = viewRef.current;
    const cands = boardHitCandidates(brd, w, tolOf(), {
      filter: passesFilter,
      activeLayer,
      visibleLayers: visible,
      viewportIU: canvas ? { w: canvas.width / v.scale, h: canvas.height / v.scale } : undefined,
      excludeZoneFills,
    });
    const out: string[] = [];
    for (const id of cands) {
      const resolved = groupContaining(brd, id, enteredGroupRef.current ?? undefined) ?? id;
      if (!out.includes(resolved)) out.push(resolved);
    }
    return out;
  };

  const tolOf = (): number => (5 * dpr) / viewRef.current.scale; // ~5px, like COLLECTORS_GUIDE

  // Set the selection to (or toggle) a single item id (null clears).
  const applySelect = (id: string | null, additive: boolean): void => {
    setSelection((prev) => {
      const next = new Set(additive ? prev : []);
      if (id) {
        if (additive && next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  // PCB_SELECTION_TOOL::selectPoint: pick the best filtered candidate under the
  // cursor. When several items are equally plausible (same priority tier after
  // guessSelectionCandidates drops the obvious container), pop the
  // disambiguation menu instead of guessing. Shift adds/toggles.
  const clickSelect = (clientX: number, clientY: number, additive: boolean): void => {
    const w = worldAt(clientX, clientY);
    const brd = boardRef.current;
    if (!w || !brd) return;
    const cands = hitCandidates(w);
    if (cands.length === 0) {
      applySelect(null, additive);
      return;
    }
    // GuessSelectionCandidates already pruned the list; a single survivor is
    // selected outright, several raise the disambiguation menu (selectPoint:
    // "If still more than one item we're going to have to ask the user").
    if (cands.length === 1) {
      applySelect(cands[0]!, additive);
      return;
    }
    setDisambig({ x: clientX, y: clientY, ids: cands, additive });
  };

  // Double-click enters the group under the cursor (SELECTION_TOOL::EnterGroup):
  // a member of the entered group that is itself a sub-group enters one level
  // deeper; double-clicking empty space leaves the current group.
  const onCanvasDoubleClick = (e: React.MouseEvent): void => {
    if (e.button !== 0) return;
    const w = worldAt(e.clientX, e.clientY);
    const brd = boardRef.current;
    if (!w || !brd) return;
    const top = hitCandidates(w)[0];
    const r = top ? parseBoardItemId(top) : null;
    if (r?.kind === 'group') {
      setEnteredGroup(brd.groups[r.index]?.uuid ?? null);
      setSelection(new Set());
    } else if (top && (r?.kind === 'track' || r?.kind === 'arc' || r?.kind === 'via')) {
      // EDIT_TOOL::Properties on a copper item.
      setSelection((prev) => (prev.has(top) ? prev : new Set([top])));
      setTrackViaOpen(true);
    } else if (top && r?.kind === 'zone') {
      setSelection((prev) => (prev.has(top) ? prev : new Set([top])));
      setZonePropsIndex(r.index);
    } else if (top && r?.kind === 'text') {
      setSelection((prev) => (prev.has(top) ? prev : new Set([top])));
      setTextPropsIndex(r.index);
    } else if (top && r?.kind === 'barcode') {
      setSelection((prev) => (prev.has(top) ? prev : new Set([top])));
      const bc = brd.barcodes[r.index];
      if (bc) setBarcodeDialog({ at: bc.at, index: r.index });
    } else if (top && r?.kind === 'shape') {
      setSelection((prev) => (prev.has(top) ? prev : new Set([top])));
      setShapePropsIndex(r.index);
    } else if (top && r?.kind === 'pad') {
      setSelection((prev) => (prev.has(top) ? prev : new Set([top])));
      setPadPropsRef({ footprint: r.index, pad: r.sub ?? 0 });
    } else if (top && r?.kind === 'footprint') {
      setSelection((prev) => (prev.has(top) ? prev : new Set([top])));
      setFpPropsIndex(r.index);
    } else if (!top) {
      setEnteredGroup(null);
      /**
       * `EDIT_TOOL::Properties`'s last branch (edit_tool.cpp:2153-2161):
       *
       *     else if( selection.Size() == 0 && getView()->IsLayerVisible( LAYER_DRAWINGSHEET ) )
       *     {
       *         DS_PROXY_VIEW_ITEM* ds = editFrame->GetCanvas()->GetDrawingSheet();
       *         VECTOR2D cursorPos = getViewControls()->GetCursorPosition( false );
       *
       *         if( ds && ds->HitTestDrawingSheetItems( getView(), cursorPos ) )
       *             m_toolMgr->PostAction( ACTIONS::pageSettings );
       *
       * The board editor has this and eeschema has the same thing
       * (sch_edit_tool.cpp:2580); only ours was missing it, so double-clicking
       * the page frame or the title block did nothing here while it opened Page
       * Settings in the schematic. Empty paper *inside* the frame hits no item,
       * so this cannot fire from a double-click on blank canvas.
       */
      if (objects.drawingSheet) {
        const hit = hitTestBoardDrawingSheet(
          sheetInfoOf(brd),
          // The painter passes no project `.kicad_wks` either; the two must
          // agree or the hit test answers for a sheet nobody can see.
          undefined,
          w,
          // `aView->ToWorld( 5.0 )` — five screen pixels at this zoom.
          (5 * dpr) / viewRef.current.scale,
        );
        if (hit) setPageDlgOpen(true);
      }
    }
    requestDraw();
  };

  /**
   * Right-click opens the context menu for **the selection**
   * (`PCB_SELECTION_TOOL::Main`, pcb_selection_tool.cpp:359-379):
   *
   *     else if( evt->IsClick( BUT_RIGHT ) )
   *     {
   *         …
   *         if( m_selection.Empty() )
   *         {
   *             selectPoint( evt->Position(), false, &selectionCancelled );
   *             m_selection.SetIsHover( true );
   *         }
   *         …
   *         m_menu->ShowContextMenu( m_selection );
   *     }
   *
   * The re-pick is gated on an **empty** selection and on nothing else. With
   * something selected the item under the cursor is irrelevant: right-clicking
   * a footprint's reference text while the footprint is selected gives the
   * footprint's menu, because the selection was never touched.
   *
   * Ours re-picked whenever the top hit was not itself in the selection, which
   * is a different rule and the one the user hits: every field, pad and silk
   * line inside a selected footprint stole the selection on right-click and
   * opened its own menu. Note this is deliberately *not* eeschema's rule —
   * `SCH_SELECTION_TOOL` (sch_selection_tool.cpp:643-672) additionally re-picks
   * when the click is more than a grid square outside the selection's bounding
   * box, and pcbnew has no such branch.
   */
  const onCanvasContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    const w = worldAt(e.clientX, e.clientY);
    const brd = boardRef.current;
    if (!w || !brd) {
      setCtxMenu(null);
      return;
    }
    const pick = contextMenuPick(selForDrawRef.current, hitCandidates(w)[0] ?? null);
    if (pick) applySelect(pick, false);
    // The menu always opens on a non-empty board (Select All is shown even with
    // nothing selected, per noItemsCondition = board && !IsEmpty).
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  /**
   * The canvas context menu. Four `Init()`s feed one `CONDITIONAL_MENU`
   * upstream, and this states their rows with the same order numbers and
   * conditions rather than with the evaluated shape, so
   * `evaluateConditionalMenu` decides which rows and which rules survive:
   *
   *   BOARD_EDITOR_CONTROL::Init (board_editor_control.cpp:430-440), into the
   *       SELECTION tool's menu: getAndPlace (inactiveStateCondition) and a
   *       separator at the default order, then LOCK_CONTEXT_MENU @100 and
   *       ZONE_CONTEXT_MENU @100
   *   EDIT_TOOL::Init (edit_tool.cpp:750-832): properties, the rotate/mirror
   *       rows and the footprint rows at the default order; separator @100 and
   *       the shape-modification / positioning submenus @100; separator @150
   *       with cut / copy / paste / pasteSpecial / duplicate / doDelete; then
   *       separator @150 with selectAll / unselectAll
   *   PCB_SELECTION_TOOL::Init (pcb_selection_tool.cpp:214-235): separator @1
   *       and the @1/@2 rows, then AddStandardSubMenus
   *   EDA_DRAW_FRAME::AddStandardSubMenus (eda_draw_frame.cpp:709-726):
   *       separator @1000 and the Zoom and Grid submenus @1000
   *
   * `CONDITIONAL_MENU::ANY_ORDER` is **-1** (conditional_menu.h:45), so the
   * un-numbered rows sort BEFORE the numbered ones — which is why upstream's
   * empty-canvas menu opens on Get and Move Footprint and not on Paste.
   *
   * What ours had: Select All and Unselect All and nothing else on an empty
   * canvas, with no Zoom or Grid submenu anywhere, and Unselect All greyed on
   * an empty selection. That last one is not upstream's condition —
   * `noItemsCondition` (edit_tool.cpp:732-735) is
   * `frame()->GetBoard() && !frame()->GetBoard()->IsEmpty()`, about the BOARD
   * and not about the selection, and it gates both rows identically.
   */
  /**
   * `PCB_CONTROL::CopyToClipboard` / `CutToClipboard` / `Paste`
   * (`pcbnew/tools/pcb_control.cpp`). The payload itself is built and parsed by
   * `pcbnew/src/pcb_clipboard.ts`; only the system-clipboard I/O and the drop
   * point are here, because those are the two things a pure function cannot do.
   *
   * The reference point is upstream's `grid.BestDragOrigin` — the anchor the
   * payload is written relative to. We use the selection's bounding-box origin,
   * so a paste with no offset lands the items exactly where they were copied
   * from, which is what `placeBoardItems` does before its interactive move.
   */
  const clipboardRef = (): { x: number; y: number } => {
    const brd = boardRef.current;
    const bb = brd ? boardSelectionBBox(brd, selForDrawRef.current) : null;
    return bb ? { x: bb.minX, y: bb.minY } : { x: 0, y: 0 };
  };

  const copySel = useCallback(() => {
    const brd = boardRef.current;
    if (!brd) return;
    const text = copySelectionToClipboardText(brd, selForDrawRef.current, clipboardRef());
    // "dont even start if the selection is empty" — leave whatever is on the
    // system clipboard alone rather than blanking it.
    if (text === '') return;
    void navigator.clipboard?.writeText(text);
  }, []);

  const cutSel = useCallback(() => {
    const brd = boardRef.current;
    if (!brd) return;
    const res = cutSelectionToClipboardText(brd, selForDrawRef.current, clipboardRef());
    if (res.text === '') return;
    void navigator.clipboard?.writeText(res.text);
    commitBoard(res.board);
    setSelection(new Set());
  }, [commitBoard]);

  /**
   * The paste half. `mode` and `clearNets` come from DIALOG_PASTE_SPECIAL for
   * `ACTIONS::pasteSpecial`; a plain `ACTIONS::paste` never opens it and takes
   * `KEEP_ANNOTATIONS` with nets mapped (`pcb_control.cpp:1208-1209`).
   */
  const pasteText = useCallback(
    (text: string, mode: PasteMode = 'keep_annotations', clearNets = false) => {
      const brd = boardRef.current;
      if (!brd) return;
      const parsed = parseClipboardText(text);
      // Not a board or footprint payload: upstream falls through to its
      // bitmap/plain-text branches, which we have not ported. Do nothing
      // rather than clobber the board.
      if (!parsed) return;
      const res = pasteIntoBoard(brd, parsed, { mode, clearNets });
      commitBoard(res.board);
      setSelection(new Set(res.newIds));
    },
    [commitBoard],
  );

  /**
   * The system clipboard's own events, so Ctrl+X / Ctrl+C / Ctrl+V work and not
   * only the menu rows. Same shape as the schematic editor's, for the same
   * reason: the browser will only hand a page the clipboard from inside one of
   * these three events.
   *
   * The editors all stay mounted behind `display: none`, so only the visible
   * frame may own them — `App` stamps the active view on `document.body` and
   * every frame checks it. Without that, the PCB editor would answer a copy
   * pressed in the schematic.
   */
  useEffect(() => {
    const hidden = (): boolean => document.body.dataset.activeView !== 'pcb';
    // `isTypingTarget` is the shared predicate, and its own doc comment names
    // Ctrl+C / Ctrl+X / Ctrl+V as the reason it exists: while a field has
    // focus the FIELD's copy must win, not the board's. Building a synthetic
    // Ctrl+C to ask `focusBlocksHotkey` instead put a hand-written modifier
    // comparison in a converted frame, which is the one thing
    // `menu_hotkey_coverage.test.ts` forbids — and it caught it.
    const typing = (): boolean => isTypingTarget(document.activeElement as FocusLike | null);

    const onCopy = (e: ClipboardEvent): void => {
      if (hidden() || typing() || selForDrawRef.current.size === 0) return;
      const brd = boardRef.current;
      if (!brd) return;
      const text = copySelectionToClipboardText(brd, selForDrawRef.current, clipboardRef());
      if (text === '') return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent): void => {
      if (hidden() || typing() || selForDrawRef.current.size === 0) return;
      const brd = boardRef.current;
      if (!brd) return;
      const res = cutSelectionToClipboardText(brd, selForDrawRef.current, clipboardRef());
      if (res.text === '') return;
      e.clipboardData?.setData('text/plain', res.text);
      e.preventDefault();
      commitBoard(res.board);
      setSelection(new Set());
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (hidden() || typing()) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!parseClipboardText(text)) return;
      e.preventDefault();
      pasteText(text);
    };

    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [commitBoard, pasteText]);

  const buildPcbContextMenu = (): MenuItem[] => {
    const brd = board;
    let groupCount = 0;
    let hasUngrouped = false;
    let hasMember = false;
    let anyLocked = false;
    let anyUnlocked = false;
    for (const id of selection) {
      const r = parseBoardItemId(id);
      if (!r) continue;
      if (brd) {
        if (isBoardItemLocked(brd, id)) anyLocked = true;
        else anyUnlocked = true;
      }
      if (r.kind === 'group') {
        groupCount++;
        if (brd && groupContaining(brd, id)) hasMember = true;
      } else if (r.kind === 'pad' || r.kind === 'fptext') {
        // children: not groupable on their own
      } else {
        if (brd && groupContaining(brd, id)) hasMember = true;
        else hasUngrouped = true;
      }
    }
    const A = (label: string, actionId: string, disabled?: boolean): MenuItem => ({
      label,
      icon: actionId,
      disabled,
      action: () => onTopAction(actionId),
    });

    // ---- the conditions the upstream rows are gated on -------------------
    const notEmpty = selection.size > 0;
    const moreThanOne = selection.size > 1;
    // `noItemsCondition` (edit_tool.cpp:732-735): the BOARD has items. It is
    // not about the selection, and it gates Select All and Unselect All alike.
    const boardHasItems = brd !== null && !boardIsEmpty(brd);
    const zoneIdx = brd ? zoneAt(brd, selection) : null;
    const fpIdx = brd ? footprintAt(brd, selection) : null;
    const padIdx = brd ? selectedPadAt(brd, selection) : null;
    const textIdx = brd ? textAt(brd, selection) : null;
    const shapeIdx = brd ? shapeAt(brd, selection) : null;
    const barcodeIdx = brd ? barcodeAt(brd, selection) : null;
    const copper = brd ? hasTrackOrVia(trackViaSelection(brd, selection)) : false;
    // `propertiesCondition` — something the properties dialog can open on.
    const editable =
      copper ||
      zoneIdx !== null ||
      fpIdx !== null ||
      padIdx !== null ||
      textIdx !== null ||
      shapeIdx !== null ||
      // `EDIT_TOOL::Properties` lists `PCB_BARCODE_T` with the items whose
      // dialog it opens (`edit_tool.cpp:2785`).
      barcodeIdx !== null;
    // `singleFootprintCondition` / `multipleFootprintsCondition`
    // (edit_tool.cpp), which gate the whole footprint block.
    let footprintCount = 0;
    for (const id of selection) if (parseBoardItemId(id)?.kind === 'footprint') footprintCount++;
    const oneFootprint = footprintCount === 1;
    const anyFootprint = footprintCount > 0;
    // `frame()->ToolStackIsEmpty()` — no tool has been pushed, so the
    // selection tool is all that is running. Ours spells the idle state as the
    // `selectSetRect` tool id, NOT `select`: every other id here is a pushed
    // tool. This gates Paste, Paste Special and Get and Move Footprint, and
    // comparing against the wrong id hides all three at once.
    const toolStackIsEmpty = activeTool === 'selectSetRect';
    /**
     * `isRoutable` (edit_tool.cpp:742-743):
     * `NotEmpty && HasTypes( routableTypes ) && notMoving && !inFootprintEditor`,
     * where `routableTypes` (edit_tool.cpp:130) is
     * `{ PCB_TRACE_T, PCB_ARC_T, PCB_VIA_T, PCB_PAD_T, PCB_FOOTPRINT_T }`.
     *
     * `HasTypes` is ANY, not ONLY — and a FOOTPRINT is in the list, which is
     * why KiCad offers Route Selected on a footprint. Reading this as "copper
     * is selected" would have hidden all five router rows on the one selection
     * a user reaches for most.
     */
    const routableKinds = new Set(['track', 'arc', 'via', 'pad', 'footprint']);
    let routable = false;
    /**
     * `canMirror` (edit_tool.cpp:649-655): false when the selection is ONLY
     * pads, else `selectionMirrorable` — at least one item whose type is in
     * `EDIT_TOOL::MirrorableItems` (edit_tool.cpp:2417-2420):
     *
     *     PCB_SHAPE_T, PCB_FIELD_T, PCB_TEXT_T, PCB_TEXTBOX_T, PCB_ZONE_T,
     *     PCB_PAD_T, PCB_TRACE_T, PCB_ARC_T, PCB_VIA_T, PCB_GROUP_T,
     *     PCB_GENERATOR_T, PCB_POINT_T, PCB_TABLE_T
     *
     * A FOOTPRINT is deliberately not in it — `nonMirrorableTypes`
     * (edit_tool.cpp:135-137) names it — so KiCad shows no Mirror row on a
     * selected footprint. Ours used a `hasNonPad` flag that was true for a
     * footprint and so offered both.
     */
    const mirrorableKinds = new Set([
      'shape',
      'fptext',
      'text',
      'textbox',
      'zone',
      'pad',
      'track',
      'arc',
      'via',
      'group',
      'table',
    ]);
    /**
     * `GENERAL_COLLECTOR::DraggableItems` (collectors.cpp:145-150), exactly:
     * `{ PCB_TRACE_T, PCB_VIA_T, PCB_FOOTPRINT_T, PCB_ARC_T }`. A pad, a zone,
     * a text or a shape is not draggable, so neither drag row belongs on one.
     */
    const draggableKinds = new Set(['track', 'via', 'footprint', 'arc']);
    /**
     * `propertiesCondition` (edit_tool.cpp:616-642) reads a good deal narrower
     * than "something is selected": one item always qualifies, but a MULTI
     * selection qualifies only when every item is a `PCB_TRACK` — and PCB_ARC
     * and PCB_VIA both derive from it, which is why the `dynamic_cast` there
     * takes all three. Anything else and the row is GONE, not greyed; KiCad
     * draws no Properties row over seven footprints, and ours drew a dead one.
     */
    const trackKinds = new Set(['track', 'arc', 'via']);
    /**
     * Two conditions that both mean "connectable", and are NOT the same list.
     *
     * `connectedTypes` (edit_tool.cpp:128) — `{ PCB_TRACE_T, PCB_ARC_T,
     * PCB_VIA_T, PCB_PAD_T, PCB_ZONE_T }` — gates Assign Netclass.
     * `showNetMenuFunc` (board_inspection_tool.cpp:101-131) takes those five
     * AND a `PCB_SHAPE` that `IsOnCopperLayer()`, and gates the Net Inspection
     * Tools submenu. A pad satisfies both, which is why KiCad's menu over a pad
     * carries two rows ours had neither of.
     */
    const connectedKinds = new Set(['track', 'arc', 'via', 'pad', 'zone']);
    const shapeOnCopper = (id: string): boolean => {
      const idx = parseBoardItemId(id)?.index;
      const shape = idx === undefined ? undefined : brd?.shapes[idx];
      return !!shape && isCopperLayerName(shape.layer);
    };
    let anyMirrorable = false;
    let onlyPads = selection.size > 0;
    let onlyDraggable = selection.size > 0;
    let onlyTracks = selection.size > 0;
    let onlyConnected = selection.size > 0;
    let netInspectable = selection.size > 0;
    for (const id of selection) {
      const kind = parseBoardItemId(id)?.kind;
      if (kind === undefined) continue;
      if (!connectedKinds.has(kind)) {
        onlyConnected = false;
        if (!(kind === 'shape' && shapeOnCopper(id))) netInspectable = false;
      }
      if (routableKinds.has(kind)) routable = true;
      if (mirrorableKinds.has(kind)) anyMirrorable = true;
      if (kind !== 'pad') onlyPads = false;
      if (!draggableKinds.has(kind)) onlyDraggable = false;
      if (!trackKinds.has(kind)) onlyTracks = false;
    }
    // The empty case is upstream's drawing-sheet hit test, which we have no
    // properties dialog for, so it stays false here.
    const propertiesCondition = selection.size === 1 || (moreThanOne && onlyTracks);
    const canMirror = !onlyPads && anyMirrorable;
    /**
     * `drag45Degree` (edit_tool.cpp:776-777) is `Count( 1 ) && OnlyTypes(
     * DraggableItems )`. `dragFreeAngle` (edit_tool.cpp:778-780) is that AND
     * `!OnlyTypes( footprintTypes )` (edit_tool.cpp:120) — a footprint drags on
     * 45s only, so over one KiCad offers Drag 45 Degree Mode and no Drag Free
     * Angle. Both rows were gated on `notEmpty` here, which is [px] the extra
     * row our menu carried against the installed build's over a footprint, and
     * two rows that should not appear at all over a pad or a zone.
     */
    const canDrag45 = selection.size === 1 && onlyDraggable;
    const canDragFree = canDrag45 && footprintCount === 0;

    /**
     * Shown in its upstream position, greyed until the command exists — the
     * same thing this frame does with Grid Origin and Route > Single Track.
     *
     * The accelerator is deliberately NOT a parameter here. It has to stay a
     * literal at the row, because `menu_hotkey_coverage.test.ts` scrapes this
     * file as TEXT for the accelerator field, and a key funnelled through a
     * parameter is one that ratchet cannot see — which is the silent drift it
     * exists to catch. It caught this helper's first draft, and then caught
     * the field name written out inside this very comment.
     */
    const TODO = (label: string): MenuItem => ({ label, disabled: true });

    return evaluateConditionalMenu([
      // ---- PCB_SELECTION_TOOL::Init (pcb_selection_tool.cpp:214) ---------
      menuEntry(
        {
          label: 'Select',
          submenu: [
            TODO('Filter Selected Items...'),
            { sep: true },
            TODO('Items in Same Hierarchical Sheet'),
            TODO('Items with Same Component Class'),
            TODO('All Tracks in Net'),
          ],
        },
        -1,
        notEmpty,
      ),

      // ---- BOARD_EDITOR_CONTROL::Init (board_editor_control.cpp:431-432) -
      // `inactiveStateCondition`: the tool stack is empty AND nothing is
      // selected, which is why this heads the empty-canvas menu and vanishes
      // the moment something is picked.
      menuEntry(
        { label: 'Get and Move Footprint', shortcut: 'T', disabled: true },
        -1,
        toolStackIsEmpty && !notEmpty,
      ),
      menuSeparator(-1),

      // ---- EDIT_TOOL::Init (edit_tool.cpp:763-810) -----------------------
      menuEntry(
        { label: 'Move', shortcut: 'M', action: () => grabStartRef.current('move') },
        -1,
        notEmpty,
      ),
      menuEntry(TODO('Move with Reference...'), -1, notEmpty),
      // `PCB_ACTIONS::moveIndividually` (pcb_actions.cpp:601-605): the friendly
      // name carries NO ellipsis - it starts an interactive move, it does not
      // open a dialog - and it does carry Ctrl+M.
      menuEntry(
        { label: 'Move Individually', shortcut: 'Ctrl+M', disabled: true },
        -1,
        moreThanOne,
      ),

      menuEntry({ label: 'Route Selected', shortcut: 'Shift+X', disabled: true }, -1, routable),
      menuEntry(
        { label: 'Route Selected From Other End', shortcut: 'Shift+E', disabled: true },
        -1,
        routable,
      ),
      menuEntry(TODO('Unroute Selected'), -1, routable),
      menuEntry({ label: 'Unroute Segment', shortcut: 'Backspace', disabled: true }, -1, routable),
      menuEntry(
        { label: 'Attempt Finish Selected (Autoroute)', shortcut: 'Shift+F', disabled: true },
        -1,
        routable,
      ),

      menuEntry(
        {
          label: 'Drag 45 Degree Mode',
          shortcut: 'D',
          action: () => grabStartRef.current('drag45'),
        },
        -1,
        canDrag45,
      ),
      menuEntry(
        { label: 'Drag Free Angle', shortcut: 'G', action: () => grabStartRef.current('drag') },
        -1,
        canDragFree,
      ),

      menuEntry({ ...A('Rotate Counterclockwise', 'rotateCCW'), shortcut: 'R' }, -1, notEmpty),
      menuEntry({ ...A('Rotate Clockwise', 'rotateCW'), shortcut: 'Shift+R' }, -1, notEmpty),
      menuEntry(
        { label: 'Change Side / Flip', shortcut: 'F', action: () => flipSelection() },
        -1,
        notEmpty,
      ),
      menuEntry(A('Mirror Horizontally', 'mirrorH'), -1, canMirror),
      menuEntry(A('Mirror Vertically', 'mirrorV'), -1, canMirror),
      // `PCB_ACTIONS::swap` carries Alt+S (pcb_actions.cpp:704-708).
      menuEntry({ label: 'Swap', shortcut: 'Alt+S', disabled: true }, -1, moreThanOne),
      // `packAndMoveFootprints` (edit_tool.cpp:794-795), on
      // `MoreThan( 1 ) && HasType( PCB_FOOTPRINT_T )` — ANY footprint in the
      // selection, not only footprints. P (pcb_actions.cpp:727-731). Shown in
      // its upstream position and greyed, like Grid Origin and Single Track:
      // the row was missing outright, which is a row of the height difference.
      menuEntry(
        { label: 'Pack and Move Footprints', shortcut: 'P', disabled: true },
        -1,
        moreThanOne && anyFootprint,
      ),

      menuEntry(
        {
          label: 'Properties...',
          shortcut: 'E',
          disabled: !editable,
          action: () => {
            if (copper) setTrackViaOpen(true);
            else if (zoneIdx !== null) setZonePropsIndex(zoneIdx);
            else if (padIdx !== null) setPadPropsRef(padIdx);
            else if (textIdx !== null) setTextPropsIndex(textIdx);
            else if (shapeIdx !== null) setShapePropsIndex(shapeIdx);
            else if (barcodeIdx !== null) {
              const bc = boardRef.current?.barcodes[barcodeIdx];
              if (bc) setBarcodeDialog({ at: bc.at, index: barcodeIdx });
            } else setFpPropsIndex(fpIdx);
          },
        },
        -1,
        propertiesCondition,
      ),
      // `assignNetClass` (edit_tool.cpp:799-800), between Properties and the
      // clearance inspector, on `OnlyTypes( connectedTypes ) &&
      // !inFootprintEditor`. It opens DIALOG_ASSIGN_NETCLASS, which we do not
      // have, so it is greyed in position rather than missing: over a pad or a
      // track KiCad prints this row and ours printed nothing.
      menuEntry(TODO('Assign Netclass...'), -1, onlyConnected),
      menuEntry(
        {
          label: selection.size === 2 ? 'Clearance Resolution...' : 'Constraints Resolution...',
          action: () => setInspectOpen(true),
        },
        -1,
        selection.size === 2,
      ),

      // The footprint block (edit_tool.cpp:803-809), after its own separator.
      menuSeparator(-1),
      menuEntry(
        { ...A('Open in Footprint Editor', 'footprintEditor'), shortcut: 'Ctrl+E' },
        -1,
        oneFootprint,
      ),
      menuEntry(TODO('Update Footprint...'), -1, oneFootprint),
      // `PCB_ACTIONS::updateFootprints` (pcb_actions.cpp:998-1002) is
      // "Update Footprints from Library...", not the plural of the single-item
      // row above it — the two rows are different commands with different
      // names, and only the singular one is "Update Footprint...".
      menuEntry(TODO('Update Footprints from Library...'), -1, anyFootprint && !oneFootprint),
      menuEntry(TODO('Change Footprint...'), -1, oneFootprint),
      menuEntry(TODO('Change Footprints...'), -1, anyFootprint && !oneFootprint),
      menuEntry(
        {
          label: 'Attributes',
          submenu: [TODO('Exclude from Bill of Materials'), TODO('Exclude from Position Files')],
        },
        -1,
        anyFootprint,
      ),

      // ---- the @100 band ------------------------------------------------
      // Nobody owns this band. Seven different tools drop a submenu into it
      // from their own Init(), and because ties keep their insertion order
      // (conditional_menu.cpp:210-221, and our own evaluateConditionalMenu),
      // the on-screen order is the order those tools are REGISTERED in
      // `PCB_EDIT_FRAME::setupTools` (pcb_edit_frame.cpp:947-979):
      //
      //   EDIT_TOOL (:953)             separator, [Shape Modification],
      //                                Position          (edit_tool.cpp:812-814)
      //   PCB_EDIT_TABLE_TOOL (:954)   seven separators with the table-cell rows
      //                                between them  (edit_table_tool_base.h:94-115)
      //   BOARD_EDITOR_CONTROL (:961)  Locking, [Zone]
      //                                       (board_editor_control.cpp:437-439)
      //   BOARD_INSPECTION_TOOL (:962) Net Inspection Tools
      //   ALIGN_DISTRIBUTE_TOOL (:964) [Align/Distribute], on MoreThan( 1 )
      //   CONVERT_TOOL (:972)          Create from Selection (convert_tool.cpp:333)
      //   PCB_GROUP_TOOL (:973)        Grouping           (group_tool.cpp:138)
      //
      // So it reads Position | Locking, Create from Selection, Grouping — not
      // the tidier grouping ours had invented (Create from Selection, Position,
      // Grouping, Locking), which put the two footprint-placement submenus on
      // opposite sides of the band. [px] confirmed against the installed
      // pcbnew, one footprint selected (2026-08-31).
      menuSeparator(100),
      menuEntry(
        {
          label: 'Position',
          submenu: [
            { label: 'Move Exactly...', shortcut: 'Shift+M', action: () => setMoveExactOpen(true) },
            {
              label: 'Position Relative To...',
              shortcut: 'Shift+P',
              action: () => setPosRelOpen(true),
            },
            { label: 'Outset Items...', action: () => setOutsetOpen(true) },
          ],
        },
        100,
        notEmpty,
      ),
      // EDIT_TABLE_TOOL_BASE::addMenus (edit_table_tool_base.h:94-115) opens
      // and closes each of its five groups with its own `AddSeparator( 100 )`.
      // We have no table-cell editing in the PCB editor, so all its ROWS
      // condition away and separator elision collapses the whole band to the
      // single rule this stands for — which is exactly what the installed
      // build draws between Position and Locking over a footprint. It is a
      // real KiCad rule, not decoration: when the table rows land they go
      // here, between these separators.
      menuSeparator(100),
      // LOCK_CONTEXT_MENU (board_editor_control.cpp:303), @100 on NotEmpty.
      menuEntry(
        {
          label: 'Locking',
          icon: 'lock',
          submenu: [
            A('Lock', 'lock', !anyUnlocked),
            A('Unlock', 'unlock', !anyLocked),
            A('Toggle Lock', 'toggleLock'),
          ],
        },
        100,
        notEmpty,
      ),
      // ALIGN_DISTRIBUTE_TOOL::Init (align_distribute_tool.cpp:66-88). Its own
      // rows split into three groups: align X, align Y, and distribute — and
      // the two rules between them are conditional, `AddSeparator( canAlign )`
      // and `AddSeparator( canDistribute )`, so the distribute group and the
      // rule above it appear only from THREE items up (`MoreThan( 2 )`) while
      // the submenu itself opens from two (`MoreThan( 1 )`).
      //
      // NET_CONTEXT_MENU (board_inspection_tool.cpp:68-82), @100 on
      // `showNetMenuFunc` — every selected item connectable. Four rows around
      // one rule; Clear Net Highlighting carries `~` (pcb_actions.cpp:1575).
      menuEntry(
        {
          label: 'Net Inspection Tools',
          submenu: [
            {
              label: 'Show Net in Ratsnest',
              action: () =>
                setHiddenNets((prev) => {
                  const next = new Set(prev);
                  for (const net of selectedNetsRef.current) next.delete(net);
                  return next;
                }),
            },
            {
              label: 'Hide Net in Ratsnest',
              action: () =>
                setHiddenNets((prev) => {
                  const next = new Set(prev);
                  for (const net of selectedNetsRef.current) next.add(net);
                  return next;
                }),
            },
            { sep: true },
            // `highlightNetSelection` — "highlight all copper items on the
            // selected net(s)". The SELECTION's nets, not the item under the
            // cursor, which is what the backtick row does; and it is not the
            // toolbar button's toggle either.
            {
              label: 'Highlight Net',
              action: () => setHighlightNets(new Set(selectedNetsRef.current)),
            },
            {
              label: 'Clear Net Highlighting',
              shortcut: '~',
              action: () => clearHighlightRef.current(),
            },
          ],
        },
        100,
        netInspectable,
      ),
      // The rows are the real ones: the engine has been here all along, wired
      // to an Edit-menu submenu that upstream does not have. See
      // `alignDistributeSubmenu`.
      menuEntry({ label: 'Align/Distribute', submenu: alignDistributeSubmenu() }, 100, moreThanOne),
      menuEntry(
        {
          label: 'Create from Selection',
          submenu: [
            { label: 'Create Polygon from Selection...', action: () => convertSelection('poly') },
            { label: 'Create Zone from Selection...', action: () => convertSelection('zone') },
            {
              label: 'Create Rule Area from Selection...',
              action: () => convertSelection('ruleArea'),
            },
            { label: 'Create Lines from Selection...', action: () => convertSelection('lines') },
            { label: 'Outset Items...', action: () => setOutsetOpen(true) },
            { sep: true },
            { label: 'Create Tracks from Selection...', action: () => convertSelection('tracks') },
            { label: 'Create Arc from Selection...', action: () => convertSelection('arc') },
            { sep: true },
            { label: 'Create Array...', action: () => setArrayOpen(true) },
          ],
        },
        100,
        notEmpty,
      ),
      menuEntry(
        {
          label: 'Grouping',
          icon: 'group',
          submenu: [
            A('Group Items', 'group', selection.size < 2),
            A('Ungroup Items', 'ungroup', groupCount === 0),
            A('Add Items', 'addToGroup', !(groupCount === 1 && hasUngrouped)),
            A('Remove Items', 'removeFromGroup', !hasMember),
          ],
        },
        100,
        notEmpty,
      ),

      // ---- EDIT_TOOL's @150 clipboard group (edit_tool.cpp:817-827) ------
      menuSeparator(150),
      menuEntry({ label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', action: cutSel }, 150, notEmpty),
      menuEntry(
        { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', action: copySel },
        150,
        notEmpty,
      ),
      menuEntry(TODO('Copy with Reference...'), 150, notEmpty),
      // `noActiveToolCondition` — Paste is offered whatever is selected, and
      // only hidden while another tool is running.
      menuEntry(
        {
          label: 'Paste',
          icon: 'paste',
          shortcut: 'Ctrl+V',
          // Ctrl+V itself is the browser's own paste event, not ours — see
          // MenuItem.nativeShortcut, the same as the drawing sheet's row.
          nativeShortcut: true,
          action: () => {
            void navigator.clipboard?.readText().then((text) => pasteText(text));
          },
        },
        150,
        toolStackIsEmpty,
      ),
      menuEntry(
        {
          label: 'Paste Special...',
          shortcut: 'Shift+Ctrl+V',
          action: () => setPasteSpecialOpen(true),
        },
        150,
        toolStackIsEmpty,
      ),
      menuEntry(
        { ...A('Duplicate', 'duplicate'), shortcut: 'Ctrl+D', action: duplicateSel },
        150,
        notEmpty,
      ),
      menuEntry(
        { label: 'Delete', icon: 'delete', shortcut: 'Delete', action: deleteSel },
        150,
        notEmpty,
      ),

      // ---- EDIT_TOOL::Init (edit_tool.cpp:829-831) -----------------------
      menuSeparator(150),
      menuEntry(
        { label: 'Select All', shortcut: 'Ctrl+A', action: selectAllSel },
        150,
        boardHasItems,
      ),
      menuEntry(
        { label: 'Unselect All', shortcut: 'Shift+Ctrl+A', action: unselectAllSel },
        150,
        boardHasItems,
      ),

      // ---- EDA_DRAW_FRAME::AddStandardSubMenus, from the shared module ---
      ...standardSubMenuEntries({
        zoomApp: 'pcbnew',
        zoom: zoomNow,
        setZoom: setZoomPreset,
        gridSizes: GRID_SIZE_LIST.pcbnew.map(gridEntryOf),
        gridIndex: PCB_GRIDS.indexOf(gridIU),
        primaryUnits: unitLabel,
        iuPerMM: MM,
        // `COMMON_TOOLS::GridOrigin` is a WX_PT_ENTRY_DIALOG we do not have;
        // shown in its upstream position and greyed, which is what the Place
        // menu's own Grid Origin row and the Show Grid button's menu do.
        gridOrigin: () => {},
        setGrid: (i) => {
          const iu = PCB_GRIDS[i];
          if (iu !== undefined) {
            setGridIUStored(iu);
            requestDraw();
          }
        },
      }),
    ]);
  };

  // ----- graphic shape drawing (DRAWING_TOOL) ---------------------------------

  // Constrain a line segment's end per the left-toolbar line mode: 90 snaps to
  // the nearer axis, 45 to the nearest 45° multiple, free leaves it alone.
  const constrainLineEnd = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { x: number; y: number } => {
    if (toggles.has('lineModeFree')) return to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (toggles.has('lineMode90'))
      return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    // 45°: project onto the nearest multiple of 45°.
    const ang = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
    const len = Math.abs(Math.cos(ang)) > 0.5 ? dx / Math.cos(ang) : dy / Math.sin(ang);
    return snapToGrid({ x: from.x + len * Math.cos(ang), y: from.y + len * Math.sin(ang) });
  };

  // One left click of an active drawing tool (DRAWING_TOOL::drawShape's click
  // sequence). Returns having updated the in-flight point list or committed a
  // finished shape to the board.
  const handleDrawClick = (world: { x: number; y: number }): void => {
    const kind = DRAW_SHAPE_TOOLS[activeToolRef.current];
    const brd = boardRef.current;
    if (!kind || !brd) return;
    const pts = drawingRef.current;
    const p = snapToGrid(world);
    const same = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
      a.x === b.x && a.y === b.y;
    // Commit leaves the new shape unselected and the tool active, like
    // DRAWING_TOOL (draw the next shape right away).
    const commit = (shape: Omit<PcbShape, 'source'>): void => {
      commitBoard(addBoardShape(brd, shape).board);
    };
    const width = shapeWidthIU(activeLayer);
    const base = { width, fillMode: 'none', layer: activeLayer } as const;

    switch (kind) {
      case 'line': {
        if (pts.length === 0) {
          drawingRef.current = [p];
        } else {
          const start = pts[0]!;
          const end = constrainLineEnd(start, p);
          if (same(start, end)) {
            // Clicking in place ends the chain.
            drawingRef.current = [];
          } else {
            commit({ kind: 'line', start, end, ...base });
            // Chain: the next segment starts where this one ended.
            drawingRef.current = [end];
          }
        }
        break;
      }
      case 'rect': {
        if (pts.length === 0) drawingRef.current = [p];
        else if (!same(pts[0]!, p)) {
          commit({ kind: 'rect', start: pts[0]!, end: p, ...base });
          drawingRef.current = [];
        }
        break;
      }
      case 'circle': {
        if (pts.length === 0) drawingRef.current = [p];
        else if (!same(pts[0]!, p)) {
          commit({ kind: 'circle', center: pts[0]!, end: p, ...base });
          drawingRef.current = [];
        }
        break;
      }
      case 'arc': {
        // Clicks: start, end, then the curvature point (the arc's mid).
        if (pts.length < 2) {
          if (pts.length === 0 || !same(pts[pts.length - 1]!, p)) drawingRef.current = [...pts, p];
        } else {
          commit({ kind: 'arc', start: pts[0]!, mid: p, end: pts[1]!, ...base });
          drawingRef.current = [];
        }
        break;
      }
      case 'poly': {
        const tol = tolOf();
        const closeToFirst = pts.length >= 3 && Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) <= tol;
        if (closeToFirst || (pts.length >= 3 && same(pts[pts.length - 1]!, p))) {
          commit({ kind: 'poly', pts: [...pts], ...base });
          drawingRef.current = [];
        } else if (pts.length === 0 || !same(pts[pts.length - 1]!, p)) {
          drawingRef.current = [...pts, p];
        }
        break;
      }
      default:
        break;
    }
    requestDraw();
  };

  // ----- interactive routing (ROUTER_TOOL, highlight mode) --------------------

  // The pad under a board point (board-absolute centres), for net pickup and
  // snapping route ends onto pads.
  const padAt = (w: { x: number; y: number }): PcbPad | null => {
    const brd = boardRef.current;
    if (!brd) return null;
    for (const fp of brd.footprints) {
      for (const pad of fp.pads) {
        if (Math.hypot(w.x - pad.at.x, w.y - pad.at.y) <= Math.max(pad.size.x, pad.size.y) / 2)
          return pad;
      }
    }
    return null;
  };

  // Net + snap point of the copper item under the cursor —
  // `TOOL_BASE::updateStartItem` / `updateEndItem`. The decision itself lives
  // in pcbnew so it can be tested against a real board; this is only the
  // component's view of the world handed to it.
  const copperAt = (w: { x: number; y: number }): BoardCursorSnap | null => {
    const brd = boardRef.current;
    if (!brd) return null;
    return snapToBoardCopper(brd, w, gridState(), {
      tol: tolOf(),
      // `pickSingleItem`'s `tl`, the view's top layer. A preference, not a
      // filter: an item elsewhere is still picked when this layer has none.
      layer: /\.Cu$/.test(activeLayerRef.current) ? activeLayerRef.current : undefined,
    });
  };

  /**
   * `TOOL_BASE::updateStartItem` / `updateEndItem` for a drag: the snapped
   * cursor, over copper when there is any and on the grid otherwise.
   *
   * `aAvoid` is `pickSingleItem`'s `aAvoidItems` — the line being dragged, so
   * the gesture cannot snap to itself.
   */
  const dragSnap = (
    w: { x: number; y: number },
    aAvoid: ReadonlySet<string> | null,
  ): { x: number; y: number } => {
    const brd = boardRef.current;
    if (!brd) return snapToGrid(w);
    return (
      snapToBoardCopper(brd, w, gridState(), {
        tol: tolOf(),
        layer: /\.Cu$/.test(activeLayerRef.current) ? activeLayerRef.current : undefined,
        avoid: aAvoid ?? undefined,
      })?.snap ?? snapToGrid(w)
    );
  };

  // `copperAt` exists now, so the crosshair can reach it (see `routeSnapRef`).
  routeSnapRef.current = (w) => copperAt(w)?.snap ?? snapToGrid(w);

  /**
   * The route from `from` to `to`, bent around anything in the way.
   *
   * The decision lives in `route_tool.ts` so it can be tested; this is the
   * component's view of the world handed to it.
   */
  const routedPath = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { x: number; y: number }[] => {
    const brd = boardRef.current;
    const r = routeRef.current;
    if (!brd || !r) return posturePath(from, to);

    return routeDecision(from, to, {
      board: brd,
      net: r.net,
      layer: r.layer,
      width: r.dims.trackWidth,
      clearance: netclassInfo.classClearance.get(netClassOf.get(r.net) ?? 'Default') ?? 0,
    });
  };

  // Routing dimensions for a net: its net class dims, overridden by the
  // TOP_AUX track-width / via-size selections when they're not "use netclass"
  // (BOARD_DESIGN_SETTINGS::GetCurrentTrackWidth / GetCurrentViaSize).
  const routeDims = (
    net: number,
    // `ImportSizes`'s `aStartItem` and `aStartPosition`: what the route is
    // starting on, and where the pointer was. Absent for a route that is not
    // starting from an existing item, where inheritance cannot apply.
    startItem?: BoardCursorSnap | null,
    startLayer?: string,
    cursor?: { x: number; y: number },
  ): ClassDims => {
    const base = netclassInfo.classDims.get(netClassOf.get(net) ?? 'Default') ?? DEFAULT_CLASS_DIMS;
    const tw = trackWidthListRef.current[trackSelRef.current - 1];
    const vs = viaSizeListRef.current[viaSelRef.current - 1];
    // `PNS_KICAD_IFACE_BASE::ImportSizes` (pns_kicad_iface.cpp:1146-1152): the
    // existing item's width wins over both the toolbar choice and the netclass,
    // and only under the toggle.
    //
    //     if( bds.m_UseConnectedTrackWidth && … && aStartItem != nullptr )
    //         found = inheritTrackWidth( aStartItem, &trackWidth, startPosInt );
    const brd = boardRef.current;
    const inherited =
      autoTrackWidthRef.current && startItem && brd
        ? inheritTrackWidth(
            brd,
            { kind: startItem.kind, width: startItem.width, at: startItem.snap },
            startLayer ?? activeLayerRef.current,
            cursor ?? null,
          )
        : null;
    return {
      trackWidth: inherited ?? tw ?? base.trackWidth,
      viaDiameter: vs?.diameter ?? base.viaDiameter,
      viaDrill: vs?.drill ?? base.viaDrill,
    };
  };

  // One left click of the Route Single Track tool.
  const handleRouteClick = (world: { x: number; y: number }): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const r = routeRef.current;
    if (!r) {
      // Start: pick the net (and snap) from the copper item under the cursor;
      // route on the active copper layer.
      const c = copperAt(world);
      const layer = /\.Cu$/.test(activeLayer) ? activeLayer : 'F.Cu';
      if (layer !== activeLayer) setActiveLayer(layer);
      routeRef.current = {
        net: c?.net ?? 0,
        layer,
        last: c?.snap ?? snapToGrid(world),
        dims: routeDims(c?.net ?? 0, c, layer, world),
      };
    } else {
      const target = copperAt(world);
      const landed = target !== null && target.net === r.net && r.net > 0;
      const end = landed ? target.snap : snapToGrid(world);
      let b = brd;
      let prev = r.last;
      for (const p of routedPath(r.last, end)) {
        if (p.x !== prev.x || p.y !== prev.y) {
          b = addBoardTrack(b, {
            start: prev,
            end: p,
            width: r.dims.trackWidth,
            layer: r.layer,
            net: r.net,
          }).board;
          prev = p;
        }
      }
      if (b !== brd) commitBoard(b);
      // Landing on a same-net item finishes the route; otherwise keep going.
      routeRef.current = landed ? null : { ...r, last: end };
    }
    requestDraw();
  };

  // 'V' while routing: commit up to the cursor, drop a via there, and continue
  // on the other copper layer (ROUTER_TOOL::onViaCommand).
  const routeViaSwitch = (): void => {
    const r = routeRef.current;
    const brd = boardRef.current;
    const cur = cursorRef.current;
    if (!r || !brd || !cur) return;
    const end = snapToGrid(cur);
    let b = brd;
    let prev = r.last;
    for (const p of routedPath(r.last, end)) {
      if (p.x !== prev.x || p.y !== prev.y) {
        b = addBoardTrack(b, {
          start: prev,
          end: p,
          width: r.dims.trackWidth,
          layer: r.layer,
          net: r.net,
        }).board;
        prev = p;
      }
    }
    b = addBoardVia(b, {
      at: end,
      size: r.dims.viaDiameter,
      drill: r.dims.viaDrill,
      layers: ['F.Cu', 'B.Cu'],
      kind: 'through',
      net: r.net,
    }).board;
    commitBoard(b);
    const other = r.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    setActiveLayer(other);
    routeRef.current = { ...r, layer: other, last: end };
    requestDraw();
  };
  const routeViaSwitchRef = useRef(routeViaSwitch);
  routeViaSwitchRef.current = routeViaSwitch;

  /**
   * The barcode the properties dialog edits: an existing one when the dialog
   * was opened by double-click, otherwise the item `DRAWING_TOOL::DrawBarcode`
   * builds before opening it (`drawing_tool.cpp:1528-1532`) —
   *
   *     barcode = new PCB_BARCODE( m_frame->GetModel() );
   *     barcode->SetLayer( layer );
   *     barcode->SetPosition( cursorPos );
   *     barcode->SetTextSize( bds.GetTextSize( layer ).y );
   *
   * so everything else is `PCB_BARCODE`'s constructor, and the text height is
   * the layer class's Board Setup value rather than `EDA_TEXT`'s default.
   */
  const barcodeUnderEdit = (): PcbBarcode | null => {
    const brd = boardRef.current;
    if (!brd || !barcodeDialog) return null;
    if (barcodeDialog.index !== undefined) return brd.barcodes[barcodeDialog.index] ?? null;
    return {
      ...NEW_BARCODE,
      at: barcodeDialog.at,
      layer: activeLayer,
      textHeight: Math.round((layerClassRow(activeLayer).textHeight ?? 1) * MM),
      source: EMPTY_SOURCE,
    };
  };

  // Commit the "Add Text" dialog: a user gr_text at the clicked point on the
  // active layer, at the layer class's default size/thickness.
  const commitPlacedText = (): void => {
    const brd = boardRef.current;
    const at = textDialog;
    const content = textDraft.trim();
    setTextDialog(null);
    setTextDraft('');
    if (!brd || !at || !content) return;
    // The layer class's Board Setup text defaults (GetTextSize/GetTextThickness).
    const row = layerClassRow(activeLayer);
    commitBoard(
      addBoardText(brd, {
        kind: 'user',
        text: content,
        at,
        angle: 0,
        layer: activeLayer,
        size: { x: Math.round(row.textWidth * MM), y: Math.round(row.textHeight * MM) },
        thickness: Math.round(row.textThickness * MM),
      }).board,
    );
  };

  // One left click of the Draw Filled Zones tool: the first click opens the
  // Copper Zone Properties dialog; afterwards clicks collect the outline,
  // closing back on the first corner commits the (unfilled) zone.
  /**
   * A click with a dimension tool active (DRAWING_TOOL::DrawDimension).
   *
   * The first click starts one; later clicks advance it. Aligned and orthogonal
   * take a third click for the crossbar, the other three finish on the second —
   * the engine decides, this only commits when it says `done`.
   */
  /**
   * The cursor as `DrawDimension` sees it: snapped to the grid, except while
   * placing the crossbar of a dimension that is not cardinal — see
   * `dimensionSnapsToGrid`, upstream's `grid.SetUseGrid( false )`.
   */
  const dimensionCursor = (
    draw: DimensionDraw,
    world: { x: number; y: number },
  ): { x: number; y: number } => (dimensionSnapsToGrid(draw) ? snapToGrid(world) : world);

  const handleDimensionClick = (world: { x: number; y: number }, kind: DimensionKind): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const cur = dimensionRef.current;
    const p = cur ? dimensionCursor(cur, world) : snapToGrid(world);
    // `DIM_UNITS_MODE::AUTOMATIC` reads `GetBoard()->GetUserUnits()`, so the
    // label cannot be derived without the frame's display units.
    const opts = { userUnits: unitsRef.current };

    if (!cur) {
      const tg = boardSetupRef.current.textGraphics;
      const row = layerClassRow(activeLayer);
      dimensionRef.current = startDimension(
        kind,
        p,
        dimensionDefaultsFrom(tg.dimensions, activeLayer, shapeWidthIU(activeLayer), {
          // `GetTextSize/Thickness/Italic( layer )` all index the *layer class*.
          // This used to read `rows[0]`, the silkscreen row, whatever the layer.
          textWidth: Math.round(row.textWidth * MM),
          textHeight: Math.round(row.textHeight * MM),
          textThickness: Math.round(row.textThickness * MM),
          italic: row.italic,
        }),
        opts,
      );
      requestDraw();
      return;
    }

    const next = clickDimension(cur, p, opts);
    if (next.done) {
      const added = addBoardDimension(brd, next.dimension);
      commitBoard(added.board);
      dimensionRef.current = null;
      // `m_toolMgr->RunAction<EDA_ITEM*>( ACTIONS::selectItem, dimension )` —
      // the placed dimension is left selected, so the properties panel and Del
      // act on what was just drawn.
      setSelection(new Set([added.id]));
      // "Run the edit immediately to set the leader text": a leader shows typed
      // text, so upstream opens its properties dialog the moment it lands
      // (drawing_tool.cpp:1791-1793). Without this the label is stuck on the
      // constructor's "Leader".
      if (kind === 'leader') setDimensionPropsIndex(brd.dimensions.length);
    } else {
      dimensionRef.current = next;
    }
    requestDraw();
  };

  /**
   * A click with the text box tool active (DRAWING_TOOL::DrawRectangle with
   * isTextBox). Two corners, then the properties dialog decides whether the box
   * is kept at all.
   */
  /**
   * Board Setup values a freshly-drawn table takes, shared by preview and commit.
   *
   * The font size is `bds.GetTextSize( table->GetLayer() )`
   * (`drawing_tool.cpp:1353`) — the **layer class's** row, like every other
   * `GetTextSize( layer )`. This read `rows[0]`, the silkscreen row, whatever
   * layer the table was going on, and the font size is not cosmetic here: it is
   * what sizes the whole table. `colCount = requestedSize.x / (fontSize.x * 15)`
   * and `rowCount = requestedSize.y / (fontSize.y * 3)`, so a font one third
   * short of the real one gives half again as many rows, each of them that much
   * shorter — which is exactly "our boxes are tiny compared to KiCad's".
   */
  const tableDefaults = (): TableDefaults => {
    const row = layerClassRow(activeLayer);
    return {
      layer: activeLayer,
      fontWidth: Math.round(row.textWidth * MM),
      fontHeight: Math.round(row.textHeight * MM),
      textThickness: Math.round(row.textThickness * MM),
      lineThickness: shapeWidthIU(activeLayer),
      gridPitch: gridIURef.current,
    };
  };

  /**
   * The two controls the *board's* table dialog has and the schematic's does
   * not: `m_LayerSelectionCtrl` and `m_cbLocked`
   * (`pcbnew/dialogs/dialog_table_properties_base.h:45-46`). A `SCH_TABLE` has
   * neither — it has no layer and eeschema has no lock — so they are passed
   * into the shared dialog rather than living in it.
   *
   * `m_LayerSelectionCtrl` is a PCB_LAYER_BOX_SELECTOR, which draws each
   * layer's colour swatch through `LAYER_PRESENTATION::DrawColorSwatch`; a
   * plain list of names is not that control.
   */
  const tableDialogHeader = (
    v: TableValues,
    set: (patch: Partial<TableValues>) => void,
  ): JSX.Element => (
    <div className="ze-tableprops-header">
      <label className="row ze-tableprops-field">
        <span className="ze-tableprops-lbl">Layer:</span>
        <Combo
          value={v.layer}
          onChange={(layer) => set({ layer })}
          options={(board?.layers ?? []).map((l) => ({
            value: l.name,
            label: l.name,
            swatch: layerColor(l.name),
          }))}
        />
      </label>
      <label className="row ze-tableprops-field">
        <input
          type="checkbox"
          checked={v.locked}
          onChange={(e) => set({ locked: e.target.checked })}
        />
        <span className="ze-tableprops-boxlbl">Locked</span>
      </label>
    </div>
  );

  /**
   * A click with the table tool active (DRAWING_TOOL::DrawTable). Two clicks,
   * then the properties dialog decides whether the table is kept at all.
   */
  const handleTableClick = (world: { x: number; y: number }): void => {
    const p = snapToGrid(world);
    const first = tableStartRef.current;
    if (!first) {
      setTableStart(p);
      requestDraw();
      return;
    }
    setPendingTable(newTable(first, p, tableDefaults()));
    setTableStart(null);
    requestDraw();
  };

  const handleTextBoxClick = (world: { x: number; y: number }): void => {
    const p = snapToGrid(world);
    const first = textBoxStartRef.current;
    if (!first) {
      textBoxStartRef.current = p;
      requestDraw();
      return;
    }
    // A rectangle with no width or height is not a box; keep waiting.
    if (!isDrawableTextBox(first, p)) return;

    const tg = boardSetupRef.current.textGraphics;
    setPendingTextBox(
      newTextBox(first, p, {
        layer: activeLayer,
        textSize: Math.round((tg.rows[0]?.textHeight ?? 1) * MM),
        textThickness: Math.round((tg.rows[0]?.textThickness ?? 0.15) * MM),
        borderWidth: shapeWidthIU(activeLayer),
        borderStyle: 'solid',
      }),
    );
    textBoxStartRef.current = null;
    requestDraw();
  };

  /**
   * Ask for a PNG and hand back its base64 payload.
   *
   * Upstream opens a `wxFileDialog` from inside the tool's event loop and
   * `continue`s if it is cancelled. The browser equivalent is a hidden file
   * input; cancelling resolves to null, which leaves the tool armed exactly as
   * the `continue` does.
   *
   * KiCad accepts any format wxImage can read and converts to PNG internally.
   * We take PNG only, because `pngPixelSize`/`pngPPI` — which decide how much
   * board the image covers — read the PNG header directly. Accepting a JPEG we
   * could not measure would place an item of the fallback size, which looks
   * like a scaling bug rather than an unsupported format.
   */
  const askForPng = (): Promise<string | null> =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png';
      input.onchange = (): void => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onerror = (): void => {
          resolve(null);
        };
        reader.onload = (): void => {
          // A data: URL is "data:image/png;base64,<payload>"; the model holds
          // the payload alone, as the file's own quoted strings do.
          const url = String(reader.result ?? '');
          const comma = url.indexOf(',');
          resolve(comma < 0 ? null : url.slice(comma + 1));
        };
        reader.readAsDataURL(file);
      };
      // Cancelling a file input fires no event in every browser, so nothing
      // else resolves this promise. That is deliberate: an abandoned pick
      // leaves the tool armed, which is what upstream's `continue` does too.
      input.click();
    });

  /**
   * A click with the reference image tool active
   * (`DRAWING_TOOL::PlaceReferenceImage`). The first opens the file dialog and
   * puts the picture on the cursor; the second drops it.
   */
  const handleImageClick = (world: { x: number; y: number }): void => {
    const p = snapToGrid(world);
    const state = placeImageRef.current;

    if (state.step === 'awaiting-file') {
      void askForPng().then((data) => {
        if (data === null) return;
        // The tool may have been switched away while the dialog was open.
        if (activeToolRef.current !== 'placeReferenceImage') return;
        const at = cursorRef.current ? snapToGrid(cursorRef.current) : p;
        placeImageRef.current = fileChosen(placeImageRef.current, data, at, activeLayer);
        requestDraw();
      });
      return;
    }

    const brd = boardRef.current;
    const { state: next, commit } = clickImage(state, p);
    placeImageRef.current = next;
    if (commit && brd) {
      const { board: withImage, id } = addBoardImage(brd, commit);
      commitBoard(withImage);
      setSelection(new Set([id]));
    }
    requestDraw();
  };

  const handleZoneClick = (world: { x: number; y: number }): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const p = snapToGrid(world);
    const z = zoneRef.current;
    if (!z) {
      setZoneNet(copperAt(world)?.net ?? 0);
      setZoneLayer(/\.Cu$/.test(activeLayer) ? activeLayer : 'F.Cu');
      setZoneDialog(p);
      return;
    }
    const closeToFirst =
      z.pts.length >= 3 && Math.hypot(p.x - z.pts[0]!.x, p.y - z.pts[0]!.y) <= tolOf();
    const sameAsLast =
      z.pts.length >= 3 && p.x === z.pts[z.pts.length - 1]!.x && p.y === z.pts[z.pts.length - 1]!.y;
    if (closeToFirst || sameAsLast) {
      // Border style/pitch from Board Setup > Zones (ZONE_SETTINGS defaults).
      const zoneDflts = boardSetupRef.current.zones;
      commitBoard(
        addBoardZone(brd, {
          net: z.net,
          netName: brd.nets.get(z.net) ?? '',
          layers: [z.layer],
          outline: [...z.pts],
          hatchStyle:
            zoneDflts.outlineDisplay === 'Fully hatched'
              ? 'full'
              : zoneDflts.outlineDisplay === 'Line'
                ? 'none'
                : 'edge',
          hatchPitch: Math.round(zoneDflts.outlineHatchPitchMM * MM) || 0.5 * MM,
        }).board,
      );
      zoneRef.current = null;
    } else if (
      z.pts.length === 0 ||
      p.x !== z.pts[z.pts.length - 1]!.x ||
      p.y !== z.pts[z.pts.length - 1]!.y
    ) {
      zoneRef.current = { ...z, pts: [...z.pts, p] };
    }
    requestDraw();
  };

  // Measure tool (ACTIONS::measureTool): two clicks pin the ruler; the next
  // click starts a new measurement.
  const handleMeasureClick = (world: { x: number; y: number }): void => {
    const p = snapToGrid(world);
    const m = measureRef.current;
    if (!m || m.b) measureRef.current = { a: p, b: null };
    // `twoPtMgr.SetAngleSnap( evt->Modifier( MD_SHIFT ) ? LEADER_MODE::DEG45
    // : LEADER_MODE::DIRECT )` — pcb_viewer_tools.cpp:383-388, set on every
    // motion AND carried into the point the second click pins. Snapping the
    // preview but not the commit would let go of a ruler that jumps.
    else
      measureRef.current = {
        a: m.a,
        b: rulerEnd(m.a, p, shiftDownRef.current ? 'deg45' : 'direct'),
      };
    requestDraw();
  };

  // Free-standing via placement (PCB_ACTIONS::drawVia): each click drops a via,
  // picking up the net of the copper item underneath.
  const handleViaClick = (world: { x: number; y: number }): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const c = copperAt(world);
    const at = c?.snap ?? snapToGrid(world);
    const dims = routeDims(c?.net ?? 0);
    commitBoard(
      addBoardVia(brd, {
        at,
        size: dims.viaDiameter,
        drill: dims.viaDrill,
        layers: ['F.Cu', 'B.Cu'],
        kind: 'through',
        net: c?.net ?? 0,
      }).board,
    );
  };

  /**
   * Place a snap point (`DRAWING_TOOL::PlacePoint`, drawing_tool.cpp:914-930).
   *
   * `POINT_PLACER::CreateItem` makes a default `PCB_POINT` and sets exactly one
   * thing on it, `SetLayer( m_frame.GetActiveLayer() )` — so the size is the
   * constructor's 1 mm and the position is whatever `SnapItem` forced the
   * cursor to, which is `cursorSnapRef` here.
   *
   * `IPO_REPEAT` means the tool re-arms after each placement rather than
   * falling back to the selection tool, so this handler does not clear
   * `activeTool`; `IPO_SINGLE_CLICK` is why one click both creates and commits
   * (the preview item exists before the first click, see `pointPreviewRef`).
   */
  const handlePointClick = (world: { x: number; y: number }): void => {
    const brd = boardRef.current;
    if (!brd) return;
    commitBoard(
      addBoardPoint(brd, {
        at: cursorSnapRef.current(world),
        size: DEFAULT_POINT_SIZE,
        layer: activeLayerRef.current,
      }).board,
    );
  };

  /**
   * The two origin pickers: Grid Origin and Drill/Place File Origin.
   *
   * `PCB_CONTROL::GridPlaceOrigin` (`pcb_control.cpp:769-800`) and
   * `BOARD_EDITOR_CONTROL::DrillOrigin` (`board_editor_control.cpp:2288-2330`)
   * are the same shape: `Activate()` to deactivate whatever else is running,
   * `picker->SetCursor( KICURSOR::PLACE )`, one click handler, and
   * `ACTIONS::pickerTool`. Both handlers end
   *
   *     return false;   // drill origin is a one-shot; don't continue with tool
   *
   * so the tool pops after a single click — unlike Place Point, which is
   * `IPO_REPEAT`. That `false` is why `setActiveTool` returns to the selection
   * tool here rather than leaving the button lit.
   *
   * What each writes is one design setting: `SetGridOrigin` /
   * `SetAuxOrigin`, which the file spells `(setup (grid_origin …))` and
   * `(setup (aux_axis_origin …))`.
   */
  const handleOriginClick = (
    which: 'grid_origin' | 'aux_axis_origin',
    world: { x: number; y: number },
  ): void => {
    const brd = boardRef.current;
    if (!brd) return;
    commitBoard(setBoardOrigin(brd, which, cursorSnapRef.current(world)));
    // `PopTool` — the picker is a one-shot.
    setActiveTool('selectSetRect');
  };

  /**
   * `PCB_CONTROL::GridResetOrigin` (`:803-808`) and `drillResetOrigin`
   * (`board_editor_control.cpp:2290-2295`): the same setter with (0, 0), and
   * no picker at all — a menu row, not a tool.
   */
  const resetOrigin = (which: 'grid_origin' | 'aux_axis_origin'): void => {
    const brd = boardRef.current;
    if (brd) commitBoard(setBoardOrigin(brd, which, { x: 0, y: 0 }));
  };

  // ----- interactive move / drag (EDIT_TOOL Move vs Drag) ---------------------

  const sceneFilter = (): { hideFrontFootprints: boolean; hideBackFootprints: boolean } => ({
    hideFrontFootprints: !objects.footprintsFront,
    hideBackFootprints: !objects.footprintsBack,
  });

  // Start a move/drag of `sel` from world grab point `origin`. 'move' leaves the
  // routing behind; 'drag' stretches the traces attached to moving footprints.
  // Splits the scene into a backdrop (everything else) + a live moving overlay.
  /**
   * Rebuild the board scene without `affected`, off the critical path.
   *
   * This is the expensive half of starting a drag and none of it is needed to
   * *start* one — only to stop the original showing under the preview.
   */
  const scheduleBaseWithout = (brd: Board, affected: ReadonlySet<string>): void => {
    const token = ++baseRebuildRef.current;
    setTimeout(() => {
      if (token !== baseRebuildRef.current) return;
      if (movingSelRef.current.size === 0) return; // the drag already finished
      sceneRef.current = buildBoardScene(deleteBoardItems(brd, affected), sceneFilter());
      sceneDirtyRef.current = true;
      requestDraw();
    }, 0);
  };

  const beginMove = (
    sel0: ReadonlySet<string>,
    kind: 'move' | 'drag',
    origin: { x: number; y: number },
  ): void => {
    const brd = boardRef.current;
    if (!brd || sel0.size === 0) return;
    // A grabbed group moves as its members (the move commands know items only),
    // and a grabbed pad moves its whole footprint, EDIT_TOOL::doMoveSelection
    // runs FilterCollectorForHierarchy then FilterCollectorForFreePads over the
    // selection before it moves anything.
    const { items: sel, selection } = promotePadsForCommand(brd, sel0);
    movingSelRef.current = sel;
    if (selection) setSelection(selection);
    moveKindRef.current = kind;
    moveOriginRef.current = origin;
    // `m_cursor = grid.BestDragOrigin( originalMousePos, sel_items, … )`
    // (edit_tool_move_fct.cpp:1311) — "use the mouse position over cursor, as
    // otherwise large grids will allow only snapping to items that are closest
    // to grid points", so the *raw* grab point, not the snapped one.
    //
    // Cleared first so the anchor is chosen without a stale axis biasing it,
    // then installed as the axis for the rest of the gesture, which is
    // upstream's `grid.SetAuxAxes( true, dragOrigin )` (:1335). The axis is what
    // keeps the part's *original* off-grid position reachable, so a move that
    // changes its mind can put it back exactly.
    auxAxisRef.current = null;
    const dragOrigin = bestDragOrigin(brd, sel, origin, { gridSize: gridIURef.current });
    moveAnchorRef.current = dragOrigin;
    auxAxisRef.current = dragOrigin;
    const fpIdx = new Set<number>();
    for (const id of sel) {
      const r = parseBoardItemId(id);
      if (r?.kind === 'footprint') fpIdx.add(r.index);
    }
    dragModeRef.current = kind === 'drag' && fpIdx.size > 0;
    const affected = new Set<string>(sel);
    if (dragModeRef.current) {
      for (const e of connectedTrackEnds(brd, fpIdx)) affected.add(boardItemId(e.kind, e.index));
    }
    dragAffectedRef.current = affected;
    moveDeltaRef.current = { x: 0, y: 0 };
    // The fast path, and what KiCad does: the items keep their place in the
    // retained buffer and their vertices are shifted there each frame, so
    // nothing is rebuilt, re-recorded or drawn twice. Only when the GPU cannot
    // address every moving item — a router drag re-cuts geometry rather than
    // translating it, and the Canvas2D fallback has no buffer at all — does
    // the old rebuild-and-preview path run.
    const gl = glRef.current;
    const inPlace =
      !dragModeRef.current &&
      gl !== null &&
      !gl.isLost &&
      glOkRef.current &&
      !glBlockedRef.current &&
      sceneIsGlRef.current &&
      gl.canMoveItems(affected);
    inPlaceMoveRef.current = inPlace ? { x: 0, y: 0 } : null;
    if (inPlace && liveRatsRef.current) {
      // Bucket once here and only translate afterwards, which is what
      // `calculateSelectionRatsnest` does: build the moving items' connectivity
      // on the first frame, block them out of the board's own graph, then only
      // `Move( aDelta )` for the rest of the gesture.
      const local = prepareLocalRatsnest(
        deleteBoardItems(brd, affected),
        subsetBoardItems(brd, affected),
      );
      localRatsRef.current = local;
      ratsOtherRef.current = ratsnestEdgesRef.current.filter((e) => !local.nets.has(e.net));
    } else {
      localRatsRef.current = null;
    }
    if (inPlace) {
      moveSceneRef.current = null;
      requestDraw();
      return;
    }
    startOverlayMove(brd, sel, affected);
  };

  /**
   * Set the drag up the slow way: the moving items as an overlay that follows
   * the cursor, and the board rebuilt without them underneath.
   *
   * Its own function because there are TWO ways in. `beginMove` takes it when
   * the GPU cannot address the selection, and `updateMove` has to take it when
   * `moveItems` fails PART WAY THROUGH a gesture that started in place — which
   * it did not, and that is the bug this became. `beginMove`'s in-place branch
   * returns before any of this, quite correctly: the GPU is moving the item's
   * own vertices, so there is nothing to hide and nothing to preview. But when
   * the GPU then refused, the drag was left with neither — the original still
   * in the retained scene at its old position and never translated, and no
   * overlay of its own. All that followed the cursor was the selection copy,
   * while the part itself (its pink courtyard, its silkscreen, all of it) sat
   * still until the drop committed the board and it "respawned" at the new
   * place.
   */
  const startOverlayMove = (
    brd: Board,
    sel: ReadonlySet<string>,
    affected: ReadonlySet<string>,
  ): void => {
    // The moving items first, because they are the cheap half and the drag
    // cannot start without them: one footprint compiles in about 2 ms.
    moveSceneRef.current = dragModeRef.current
      ? null
      : buildScene(subsetBoardItems(brd, sel), sceneFilter());
    sceneDirtyRef.current = true;
    requestDraw();
    // The expensive half — the whole board again, minus what is moving — is
    // what made grabbing a part freeze the editor: measured at 589 ms on the
    // coldfire demo (160 footprints, 2935 tracks) before the GPU re-record on
    // top, all to take one footprint out of a retained buffer. It is not
    // needed to *start* the drag, only to stop the original showing under the
    // preview, so it runs off the critical path and swaps in when ready.
    scheduleBaseWithout(brd, affected);
  };

  /**
   * Start a router drag of the track under the cursor (EDIT_TOOL::Drag →
   * PNS::DRAGGER). The gesture works on the whole *line* the segment belongs to,
   * so its neighbours are re-cut as it moves rather than left behind. Returns
   * false when the seed is not draggable, so the caller can fall back to a move.
   */
  const beginTrackDrag = (
    trackIndex: number,
    origin: { x: number; y: number },
    freeAngle: boolean,
  ): boolean => {
    const brd = boardRef.current;
    if (!brd) return false;
    // `ROUTER_TOOL::performDragging` starts the drag at `m_startSnapPoint` —
    // the *snapped* cursor from `updateStartItem`, not the raw pointer. Both
    // ends of the gesture must use the same snap or the geometry can never be
    // reproduced: a raw origin with grid-snapped updates jumps the line onto
    // the grid the instant you move, and no cursor position afterwards gets
    // back to where the track actually was.
    // Cleared first so the origin is snapped without a stale axis biasing it,
    // then installed as the axis for the rest of the gesture — upstream's
    // `SetAuxAxes( true, m_startSnapPoint )`.
    auxAxisRef.current = null;
    const start = dragSnap(origin, null);
    const drag = startTrackDrag(brd, trackIndex, start, { freeAngle });
    if (!drag) return false;

    auxAxisRef.current = start;
    dragSeedIdRef.current = boardItemId('track', trackIndex);

    trackDragRef.current = drag;
    moveKindRef.current = 'drag';
    moveOriginRef.current = origin;
    // A router drag re-cuts the line against the cursor rather than translating
    // a selection, so it has no `BestDragOrigin` anchor of its own.
    moveAnchorRef.current = null;
    dragModeRef.current = false;
    // ROUTER_TOOL::performDragging highlights the dragged item's net for the
    // duration of the drag (router_tool.cpp → TOOL_BASE::highlightNets), so the
    // whole net lifts to the highlight color while everything else dims. An
    // existing highlight that already covers this net is kept on the way out;
    // otherwise the previous one is restored (TOOL_BASE::m_startHighlightNetcodes).
    if (drag.line.net > 0) {
      const current = highlightNetsRef.current;
      dragHighlightRestoreRef.current = current.has(drag.line.net) ? current : new Set();
      setHighlightNets(new Set([drag.line.net]));
    }
    const affected = new Set(drag.line.tracks.map((i) => boardItemId('track', i)));
    movingSelRef.current = affected;
    dragAffectedRef.current = affected;
    sceneRef.current = buildBoardScene(deleteBoardItems(brd, affected), sceneFilter());
    moveSceneRef.current = buildScene(subsetBoardItems(brd, affected), sceneFilter());
    moveDeltaRef.current = { x: 0, y: 0 };
    sceneDirtyRef.current = true;
    return true;
  };

  /**
   * The cursor while a point/handle is being dragged —
   * `grid.BestSnapAnchor( pos, snapLayers, GetItemGrid( item ), { item } )`
   * (pcb_point_editor.cpp:2644).
   *
   * The point editor snapped to the bare grid before this, which meant a
   * reshaped point could neither land on a pad centre or another track's end,
   * nor go back to an off-grid position it started at.
   */
  const handleSnap = (w: { x: number; y: number }): { x: number; y: number } => {
    const brd = boardRef.current;
    if (!brd) return snapToGrid(w);
    const id = editHandleItemRef.current;
    return bestSnapAnchor(brd, w, gridState(), {
      snapScale: 25 / viewRef.current.scale,
      hysteresis: 5 / viewRef.current.scale,
      visibleGrid: gridIURef.current,
      layer: activeLayerRef.current,
      avoid: id ? new Set([id]) : undefined,
    });
  };

  /** The handle under a world point (EDIT_POINTS::FindPoint). */
  const editHandleAt = (p: { x: number; y: number }): BoardEditHandle | null =>
    handleAtPoint(
      editHandlesRef.current,
      p,
      handleTolerance(EDIT_POINT_SIZE, viewRef.current.scale),
    );

  /**
   * Fill All Zones (PCB_ACTIONS::zoneFillAll, the B key): re-pour every zone
   * from the current copper. ZONE_FILLER::Fill runs over the whole board rather
   * than one zone, so an edit anywhere re-flows everything that touches it.
   */
  const fillAllZones = useCallback(() => {
    const brd = boardRef.current;
    if (!brd || brd.zones.length === 0) return;
    commitBoard(fillZones(brd, { hatchingOffsets }));
  }, [commitBoard]);
  // The global key handler is stable, so it reaches the action through a ref.
  const fillAllZonesRef = useRef(fillAllZones);
  fillAllZonesRef.current = fillAllZones;

  /**
   * The board's TEARDROP_PARAMETERS_LIST, built from the Board Setup panel's
   * millimetre/percentage values. The scope and enable flags live in the
   * project file's `teardrop_options`, which Board Setup preserves but does not
   * model, so the dialog owns them for the length of the edit.
   */
  const teardropParamsList = useCallback((): TeardropParametersList => {
    const base = defaultTeardropParametersList();
    const targets = boardSetup.teardrops.targets;
    const shape = (s: (typeof boardSetup)['teardrops']['round']) => ({
      enabled: true,
      allowUseTwoTracks: s.allowSpanTwoSegments,
      tdOnPadsInZones: !s.preferZoneConnection,
      bestLengthRatio: s.bestLengthPct / 100,
      tdMaxLen: Math.round(s.maxLengthMM * MM),
      bestWidthRatio: s.bestWidthPct / 100,
      tdMaxWidth: Math.round(s.maxWidthMM * MM),
      curvedEdges: s.curvedEdges,
      widthtoSizeFilterRatio: s.trackWidthLimitPct / 100,
    });
    return {
      ...base,
      round: shape(boardSetup.teardrops.round),
      rect: shape(boardSetup.teardrops.rect),
      track: shape(boardSetup.teardrops.trackToTrack),
      targetVias: targets.vias,
      targetPTHPads: targets.pthPads,
      targetSMDPads: targets.smdPads,
      targetTrack2Track: targets.trackToTrack,
      useRoundShapesOnly: targets.roundShapesOnly,
    };
  }, [boardSetup]);
  teardropListRef.current = teardropParamsList;
  teardropMaskExpansionRef.current = Math.round(boardSetup.maskPaste.maskExpansionMM * MM);

  /**
   * EDIT_TOOL::Properties: open Track & Via Properties on the selection.
   * Upstream refuses when the selection has nothing it can edit.
   */
  const openTrackViaProperties = useCallback(() => {
    const brd = boardRef.current;
    if (!brd) return;
    const sel = selForDrawRef.current;

    if (hasTrackOrVia(trackViaSelection(brd, sel))) {
      setTrackViaOpen(true);
      return;
    }

    const zi = zoneAt(brd, sel);
    if (zi !== null) {
      setZonePropsIndex(zi);
      return;
    }

    const pi = selectedPadAt(brd, sel);
    if (pi !== null) {
      setPadPropsRef(pi);
      return;
    }

    const ti = textAt(brd, sel);
    if (ti !== null) {
      setTextPropsIndex(ti);
      return;
    }

    const si = shapeAt(brd, sel);
    if (si !== null) {
      setShapePropsIndex(si);
      return;
    }

    const di = dimensionAt(brd, sel);
    if (di !== null) {
      setDimensionPropsIndex(di);
      return;
    }

    const bi = textBoxAt(brd, sel);
    if (bi !== null) {
      setTextBoxPropsIndex(bi);
      return;
    }

    const tbi = tableAt(brd, sel);
    if (tbi !== null) {
      setTablePropsIndex(tbi);
      return;
    }

    const ii = imageAt(brd, sel);
    if (ii !== null) {
      setImagePropsIndex(ii);
      return;
    }

    const fi = footprintAt(brd, sel);
    if (fi !== null) setFpPropsIndex(fi);
  }, []);
  /** DIALOG_TRACK_VIA_PROPERTIES::TransferDataFromWindow. */
  const applyTrackViaEdit = useCallback(
    (values: TrackViaValues) => {
      const brd = boardRef.current;
      setTrackViaOpen(false);
      if (!brd) return;
      const sel = trackViaSelection(brd, selForDrawRef.current);
      const next = applyTrackViaValues(brd, sel, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard],
  );

  /**
   * Change Side / Flip (EDIT_TOOL::Flip, F). Not Mirror: upstream refuses to
   * mirror a footprint and points you here, because flipping has to swap every
   * child's layer as well as mirror the geometry.
   */
  const flipSelection = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
    if (!brd || sel.size === 0) return;
    const next = flipBoardItems(brd, sel);
    if (next !== brd) commitBoard(next);
  }, [commitBoard]);
  /** DIALOG_TEXT_PROPERTIES / DIALOG_SHAPE_PROPERTIES::TransferDataFromWindow. */
  const applyTextEdit = useCallback(
    (values: TextValues) => {
      const brd = boardRef.current;
      const index = textPropsIndex;
      setTextPropsIndex(null);
      if (!brd || index === null) return;
      const next = applyTextValues(brd, index, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, textPropsIndex],
  );

  /** DIALOG_TABLE_PROPERTIES::TransferDataFromWindow. */
  const applyTableEdit = useCallback(
    (values: TableValues) => {
      const brd = boardRef.current;
      const index = tablePropsIndex;
      setTablePropsIndex(null);
      if (!brd || index === null) return;
      const next = applyTableValues(brd, index, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, tablePropsIndex],
  );

  /** DIALOG_TEXTBOX_PROPERTIES::TransferDataFromWindow. */
  const applyTextBoxEdit = useCallback(
    (values: TextBoxValues) => {
      const brd = boardRef.current;
      const index = textBoxPropsIndex;
      setTextBoxPropsIndex(null);
      if (!brd || index === null) return;
      const next = applyTextBoxValues(brd, index, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, textBoxPropsIndex],
  );

  /** DIALOG_REFERENCE_IMAGE_PROPERTIES::TransferDataFromWindow. */
  const applyImageEdit = useCallback(
    (values: ImageValues) => {
      const brd = boardRef.current;
      const index = imagePropsIndex;
      setImagePropsIndex(null);
      if (!brd || index === null) return;
      const next = applyImageValues(brd, index, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, imagePropsIndex],
  );

  /** DIALOG_DIMENSION_PROPERTIES::TransferDataFromWindow. */
  const applyDimensionEdit = useCallback(
    (values: DimensionValues) => {
      const brd = boardRef.current;
      const index = dimensionPropsIndex;
      setDimensionPropsIndex(null);
      if (!brd || index === null) return;
      const next = applyDimensionValues(brd, index, values, unitsRef.current);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, dimensionPropsIndex],
  );

  const applyShapeEdit = useCallback(
    (values: ShapeValues) => {
      const brd = boardRef.current;
      const index = shapePropsIndex;
      setShapePropsIndex(null);
      if (!brd || index === null) return;
      const next = applyShapeValues(brd, index, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, shapePropsIndex],
  );

  /** DIALOG_PAD_PROPERTIES::TransferDataFromWindow. */
  const applyPadEdit = useCallback(
    (values: PadValues) => {
      const brd = boardRef.current;
      const ref = padPropsRef;
      setPadPropsRef(null);
      if (!brd || !ref) return;
      const next = applyPadValues(brd, ref, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, padPropsRef],
  );

  /** DIALOG_FOOTPRINT_PROPERTIES::TransferDataFromWindow. */
  const applyFootprintEdit = useCallback(
    (values: FootprintValues) => {
      const brd = boardRef.current;
      const index = fpPropsIndex;
      setFpPropsIndex(null);
      if (!brd || index === null) return;
      const next = applyFootprintValues(brd, index, values);
      if (next !== brd) commitBoard(next);
    },
    [commitBoard, fpPropsIndex],
  );

  /** PANEL_ZONE_PROPERTIES::TransferDataFromWindow. */
  const applyZoneEdit = useCallback(
    (values: ZoneValues) => {
      const brd = boardRef.current;
      const index = zonePropsIndex;
      setZonePropsIndex(null);
      if (!brd || index === null) return;
      const next = applyZoneValues(brd, index, values);
      // A changed zone has to be re-poured; its fill was built from the old
      // clearances (ZONE_FILLER runs on the commit that closes the dialog).
      if (next !== brd) commitBoard(fillZones(next, { hatchingOffsets }));
    },
    [commitBoard, zonePropsIndex],
  );

  /** DIALOG_GLOBAL_EDIT_TEARDROPS::TransferDataFromWindow. */
  const applyTeardropEdit = useCallback(
    (options: GlobalTeardropEditOptions) => {
      const brd = boardRef.current;
      setTeardropsOpen(false);
      if (!brd) return;

      const selected = selection;
      const next = applyGlobalTeardropEdit(brd, options, {
        list: teardropParamsList(),
        solderMaskExpansion: teardropMaskExpansionRef.current,
        // NETCLASS::ContainsNetclassWithName searches every constituent, so a
        // net in two classes has to answer to a filter on either.
        netclassOf: (net) =>
          netclassesForNet(brd.nets.get(net) ?? '', boardSetupRef.current.netClasses.assignments),
        isSelected: (item) => {
          // Pads are selected as `pad:<footprint>:<index>`, vias as `via:<index>`.
          for (let fi = 0; fi < brd.footprints.length; fi++) {
            const pads = brd.footprints[fi]!.pads;
            for (let pi = 0; pi < pads.length; pi++) {
              if (pads[pi] === item) return selected.has(`pad:${fi}:${pi}`);
            }
          }
          const vi = brd.vias.indexOf(item as (typeof brd.vias)[number]);
          return vi >= 0 && selected.has(`via:${vi}`);
        },
      });

      commitBoard(next.board, { skipTeardrops: true });

      // The scope checkboxes are project state (`teardrop_options`), so they
      // survive the dialog closing and the next reload.
      commitBoardSetup({
        ...boardSetupRef.current,
        teardrops: {
          ...boardSetupRef.current.teardrops,
          targets: {
            vias: next.list.targetVias,
            pthPads: next.list.targetPTHPads,
            smdPads: next.list.targetSMDPads,
            trackToTrack: next.list.targetTrack2Track,
            roundShapesOnly: next.list.useRoundShapesOnly,
          },
        },
      });
    },
    [commitBoard, commitBoardSetup, selection, teardropParamsList],
  );

  /** Put the net highlight back the way a track drag found it. */
  const restoreDragHighlight = (): void => {
    const restore = dragHighlightRestoreRef.current;
    if (!restore) return;
    dragHighlightRestoreRef.current = null;
    setHighlightNets(restore);
  };

  /**
   * The track a routable selection drags, or null. Upstream's test is
   * `(segs >= 1 || arcs >= 1 || vias == 1) && segs + arcs + vias == size`, the
   * selection must be nothing but routing. Only a lone track segment is dragged
   * here; multi-segment and via drags still fall back to a move.
   */
  const routableTrackSeed = (sel: ReadonlySet<string>): number | null => {
    if (sel.size !== 1) return null;
    const r = parseBoardItemId([...sel][0]!);
    return r?.kind === 'track' ? r.index : null;
  };

  /**
   * `EDIT_TOOL::Move`'s per-frame cursor, as a delta for the selection.
   *
   * Upstream (edit_tool_move_fct.cpp:1144-1177):
   *
   *     m_cursor = grid.BestSnapAnchor( mousePos, layers, selectionGrid, sel_items );
   *     movement = m_cursor - prevPos;
   *     …
   *     prevPos = m_cursor;
   *
   * with `prevPos` seeded to the drag origin. Summed over the gesture that is
   * `anchor + Σmovement = BestSnapAnchor( mousePos )`: the anchor's new position
   * is **absolute**, which is what puts a part on the grid however far off it
   * started. `sel_items` is `aSkip`, so the gesture cannot snap to itself.
   *
   * The pointer warp we cannot perform is why the anchor and the raw grab point
   * are both kept: upstream's `mousePos` is the anchor plus the motion since the
   * grab, and that is exactly what is reconstructed here.
   */
  const moveSnap = (raw: { x: number; y: number }): { x: number; y: number } => {
    const brd = boardRef.current;
    if (!brd) return snapToGrid(raw);
    return bestSnapAnchor(brd, raw, gridState(), {
      snapScale: 25 / viewRef.current.scale,
      hysteresis: 5 / viewRef.current.scale,
      visibleGrid: gridIURef.current,
      layer: activeLayerRef.current,
      avoid: dragAffectedRef.current,
    });
  };

  // Track the in-flight gesture to the snapped cursor. A drag rebuilds the
  // stretched geometry each frame (traces don't translate uniformly).
  const updateMove = (cur: { x: number; y: number }): void => {
    const brd = boardRef.current;
    const origin = moveOriginRef.current;
    if (!brd || !origin) return;
    const anchor = moveAnchorRef.current ?? origin;
    const delta = moveDelta(anchor, origin, cur, moveSnap);
    moveDeltaRef.current = delta;
    forcedCursorRef.current = { x: anchor.x + delta.x, y: anchor.y + delta.y };
    const applied = inPlaceMoveRef.current;
    if (applied) {
      // Only the change since the last frame: the buffer already holds the rest.
      const gl = glRef.current;
      if (gl && gl.moveItems(dragAffectedRef.current, delta.x - applied.x, delta.y - applied.y)) {
        inPlaceMoveRef.current = delta;
        // The airwires follow the part, as they do in pcbnew — the shortcut
        // past the rebuild must not skip this, or the ratsnest stays pinned to
        // where the footprint used to be.
        const local = localRatsRef.current;
        if (local) {
          ratsDrawRef.current = filterRatsRef.current(
            [...ratsOtherRef.current, ...local.at(delta)],
            local.nets,
          );
        }
        requestDraw();
        return;
      }
      // The GPU could not take it after all; fall back for the rest of the drag.
      //
      // Falling back is not just clearing the flag. The gesture started in
      // place, so it has no overlay and the board still holds the originals —
      // set both up now, exactly as `beginMove` would have. Whatever the GPU
      // did manage before it refused goes away with the rebuild, which is why
      // the base has to be rebuilt rather than merely left alone.
      inPlaceMoveRef.current = null;
      startOverlayMove(brd, movingSelRef.current, dragAffectedRef.current);
    }
    if (trackDragRef.current) {
      // The line is re-cut from scratch against the cursor each frame: a router
      // drag is not a translation, so the overlay carries the new absolute
      // geometry and the draw path applies no offset to it.
      const drag = trackDragRef.current;
      // `updateEndItem` again, with the dragged line in `aAvoidItems` so the
      // cursor cannot snap to the thing it is moving. Snapping to the line's
      // own collinear neighbours is what lets a trace go back exactly where it
      // came from, which a grid-only cursor cannot do for off-grid copper.
      const seed = dragSeedIdRef.current;
      const at = dragSnap(cur, seed ? new Set([seed]) : null);
      // The router forces the cursor to its own snap point too
      // (`ROUTER_TOOL`: `controls->ForceCursorPosition( true, m_endSnapPoint )`).
      forcedCursorRef.current = at;
      const chain = updateTrackDrag(drag, at);
      const line = trackDragSegments(brd, drag, chain);
      moveSceneRef.current = buildScene({ ...emptyBoardLike(brd), tracks: line }, sceneFilter());
      if (liveRatsRef.current) {
        ratsDrawRef.current = filterRatsRef.current(
          buildRatsnest(applyTrackDrag(brd, drag, chain)),
          selectedNetsRef.current,
        );
      }
      requestDraw();
      return;
    }
    if (dragModeRef.current) {
      const dragged = dragBoardItems(brd, movingSelRef.current, delta);
      moveSceneRef.current = buildScene(
        subsetBoardItems(dragged, dragAffectedRef.current),
        sceneFilter(),
      );
    }
    // Live ratsnest (KiCad recomputes airwires while dragging): recompute from
    // the moved geometry so the airwires follow the part. Skipped on very large
    // boards where a per-frame recompute would stall.
    if (liveRatsRef.current) {
      const preview = dragModeRef.current
        ? dragBoardItems(brd, movingSelRef.current, delta)
        : moveBoardItems(brd, movingSelRef.current, delta);
      ratsDrawRef.current = filterRatsRef.current(buildRatsnest(preview), selectedNetsRef.current);
    }
    requestDraw();
  };

  // Commit the gesture (drop). A zero net delta just restores the full scene.
  const commitMove = (): void => {
    const brd = boardRef.current;
    const delta = moveDeltaRef.current;
    const kind = moveKindRef.current;
    const sel = movingSelRef.current;
    const hadOverlay =
      moveSceneRef.current !== null || dragModeRef.current || inPlaceMoveRef.current !== null;
    inPlaceMoveRef.current = null;
    localRatsRef.current = null;
    const trackDrag = trackDragRef.current;
    trackDragRef.current = null;
    dragModeRef.current = false;
    moveDeltaRef.current = null;
    moveSceneRef.current = null;
    moveOriginRef.current = null;
    moveAnchorRef.current = null;
    // `ForceCursorPosition( false )` — the crosshair goes back to the pointer.
    forcedCursorRef.current = null;
    // The gesture is over: `SetAuxAxes( false )`.
    auxAxisRef.current = null;
    if (trackDrag) {
      const cur = cursorRef.current;
      const seed = dragSeedIdRef.current;
      dragSeedIdRef.current = null;
      restoreDragHighlight();
      if (brd && cur && delta && (delta.x !== 0 || delta.y !== 0)) {
        // The same snap the preview used. A grid-only snap here would commit
        // geometry the user never saw, and would land off the copper the
        // preview was sitting on.
        const at = dragSnap(cur, seed ? new Set([seed]) : null);
        commitBoard(applyTrackDrag(brd, trackDrag, updateTrackDrag(trackDrag, at)));
      } else if (brd) {
        rebuildScene(brd);
      }
      return;
    }
    if (brd && delta && (delta.x !== 0 || delta.y !== 0)) {
      commitBoard(
        kind === 'drag' ? dragBoardItems(brd, sel, delta) : moveBoardItems(brd, sel, delta),
      );
    } else if (hadOverlay && brd) {
      rebuildScene(brd);
    }
  };

  // Abandon the gesture without committing (Esc), restoring the full scene.
  const cancelMove = (): void => {
    const brd = boardRef.current;
    trackDragRef.current = null;
    restoreDragHighlight();
    // An in-place move only ever shifted vertices, so undoing it is the same
    // shift back — far cheaper than rebuilding a board that never changed.
    const applied = inPlaceMoveRef.current;
    inPlaceMoveRef.current = null;
    localRatsRef.current = null;
    if (applied && (applied.x !== 0 || applied.y !== 0)) {
      glRef.current?.moveItems(dragAffectedRef.current, -applied.x, -applied.y);
    }
    dragModeRef.current = false;
    moveDeltaRef.current = null;
    moveSceneRef.current = null;
    moveOriginRef.current = null;
    moveAnchorRef.current = null;
    // `ForceCursorPosition( false )` — the crosshair goes back to the pointer.
    forcedCursorRef.current = null;
    // The gesture is over: `SetAuxAxes( false )`.
    auxAxisRef.current = null;
    // Undo the live-ratsnest preview (the board didn't change). Back at rest,
    // so the moving items' airwires go away with the gesture.
    if (liveRatsRef.current) ratsDrawRef.current = filterRatsRef.current(ratsnestEdgesRef.current);
    if (applied) {
      moveSceneRef.current = null;
      moveOriginRef.current = null;
      // The gesture is over: `SetAuxAxes( false )`.
      auxAxisRef.current = null;
      requestDraw();
      return;
    }
    if (brd) rebuildScene(brd);
  };

  // Keyboard grab: M = Move (PCB_ACTIONS::move, routing left behind), D = Drag
  // 45° (drag45Degree) and G = Drag free angle (dragFreeAngle). On a trace the
  // two drags run the router's dragger; on anything else EDIT_TOOL::Drag falls
  // through to doMoveSelection, which is the move with the traces rubber-banded.
  // Routed through refs so the stable global key handler always calls the latest
  // closures.
  const grabStartRef = useRef<(kind: 'move' | 'drag' | 'drag45') => void>(() => {});
  grabStartRef.current = (kind) => {
    const sel = selForDrawRef.current;
    const cur = cursorRef.current;
    if (sel.size === 0 || !cur || movingRef.current || grabbingRef.current) return;
    if (kind !== 'move') {
      const seed = routableTrackSeed(sel);
      if (seed !== null && beginTrackDrag(seed, cur, kind === 'drag')) {
        grabbingRef.current = true;
        requestDraw();
        return;
      }
    }
    beginMove(sel, kind === 'move' ? 'move' : 'drag', cur);
    grabbingRef.current = true;
    requestDraw();
  };
  /**
   * `DIALOG_UPDATE_PCB::~DIALOG_UPDATE_PCB` (`dialog_update_pcb.cpp:65-85`): once
   * the update has spread the new footprints, KiCad hands the whole cluster to
   * the cursor as a move, so you drop it where you want it.
   *
   *     if( m_runDragCommand )
   *     {
   *         // Set the reference point to (0,0) where the new footprints were
   *         // spread. This ensures the move tool knows where the items are
   *         // located, preventing an offset when the "warp cursor to origin of
   *         // moved object" preference is disabled.
   *         if( selection.Size() > 0 )
   *             selection.SetReferencePoint( VECTOR2I( 0, 0 ) );
   *         …
   *     }
   *
   * `netlist.cpp:149` spreads to `{ 0, 0 }`, which is why the reference point is
   * that and not the cluster's own corner. Without this the cluster is simply
   * left at the page origin — the top-left of the sheet — which is not where
   * anybody wants their board.
   *
   * A ref because the update handler is a `useCallback` and `beginMove` is
   * rebuilt every render; capturing it directly would freeze the first one.
   */
  const startPostUpdateMoveRef = useRef<(sel: ReadonlySet<string>) => void>(() => {});
  startPostUpdateMoveRef.current = (sel) => {
    if (sel.size === 0 || movingRef.current || grabbingRef.current) return;
    beginMove(sel, 'move', { x: 0, y: 0 });
    grabbingRef.current = true;
    requestDraw();
  };

  const grabCancelRef = useRef<() => void>(() => {});
  grabCancelRef.current = () => {
    if (!grabbingRef.current) return;
    grabbingRef.current = false;
    cancelMove();
    requestDraw();
  };

  // Net highlight actions (BOARD_INSPECTION_TOOL). Held in refs so the global
  // keydown handler stays subscribed without re-binding every render.
  // `highlightNet` (backtick): highlight the net of the copper item under the
  // cursor; re-invoking on the same (sole) net toggles it off, like KiCad.
  const highlightNetRef = useRef<() => void>(() => {});
  highlightNetRef.current = () => {
    const cur = cursorRef.current;
    if (!cur) return;
    const net = copperAt(cur)?.net ?? 0;
    setHighlightNets((prev) => {
      if (prev.size > 0) lastHighlightRef.current = prev;
      // Empty spot, or clicking the already-highlighted sole net: clear.
      if (net <= 0 || (prev.size === 1 && prev.has(net))) return new Set();
      return new Set([net]);
    });
  };
  // `~` (Clear Net Highlighting).
  const clearHighlightRef = useRef<() => void>(() => {});
  clearHighlightRef.current = () => {
    setHighlightNets((prev) => {
      if (prev.size === 0) return prev;
      lastHighlightRef.current = prev;
      return new Set();
    });
  };
  // Toggle Net Highlight (the left-toolbar button / Alt+`). If a highlight is
  // showing, hide it (KiCad's `turnOn = highlighted.empty() && …`). Otherwise
  // highlight the net(s) of the current selection, PCB_ACTIONS::
  // highlightNetSelection, "highlight all copper items on the selected net(s)"
  // - falling back to the last highlighted set when nothing carries a net.
  const toggleHighlightRef = useRef<() => void>(() => {});
  toggleHighlightRef.current = () => {
    setHighlightNets((prev) => {
      if (prev.size > 0) {
        lastHighlightRef.current = prev;
        return new Set();
      }
      const sel = selectedNetsRef.current;
      const next = sel.size > 0 ? new Set(sel) : new Set(lastHighlightRef.current);
      if (next.size > 0) lastHighlightRef.current = next;
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    // `WX_VIEW_CONTROLS::onButton` (`wx_view_controls.cpp:546-569`): the
    // middle button starts what Preferences > Mouse and Touchpad > Drag
    // Gestures says, and NONE is neither branch -- the press falls through to
    // the tools.
    if (e.button === 1) {
      const gesture = dragGesture(e.button, commonInputPrefs());
      if (gesture !== 'none') {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        if (gesture === 'zoom') {
          const r = canvasRef.current?.getBoundingClientRect() ?? new DOMRect();
          dragZoomRef.current = {
            lastClientY: e.clientY,
            anchor: { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr },
          };
        } else {
          panRef.current = { x: e.clientX, y: e.clientY };
        }
        return;
      }
    }
    if (e.button === 0) {
      // A left click during a keyboard grab (M/G) drops the selection there.
      if (grabbingRef.current) {
        grabbingRef.current = false;
        commitMove();
        requestDraw();
        return;
      }
      const w = worldAt(e.clientX, e.clientY);
      const brd = boardRef.current;
      // A handle under the cursor takes the press: PCB_POINT_EDITOR runs ahead
      // of the selection tool, so grabbing a point reshapes the item rather
      // than starting a move of it.
      if (w && !isClickTool(activeToolRef.current)) {
        const handle = editHandleAt(w);
        if (handle) {
          // `PCB_POINT_EDITOR` puts the auxiliary axis on the point's *original
          // position* — `SetAuxAxes( true, m_original.GetPosition() )`
          // (pcb_point_editor.cpp:2366) — not on the cursor. So a handle that
          // started off-grid stays reachable for the whole drag, and a track
          // endpoint or zone corner can be put back exactly where it was.
          auxAxisRef.current = { x: handle.at.x, y: handle.at.y };
          editHandleDragRef.current = { handle, origin: handleSnap(w) };
          // Reshaping touches one item, so split the board the same way a move
          // drag does: the rest of it is recorded once here and stays in the
          // cached raster, and the item being reshaped rides the live overlay.
          // Rebuilding the whole scene per pointermove instead costs a full
          // buildScene *and* a full re-raster on every mouse event.
          const id = editHandleItemRef.current;
          if (brd && id) {
            const only = new Set([id]);
            // The base goes through `buildBoardScene` so it is compiled for
            // whichever backend draws it; the overlay stays `buildScene`,
            // because it is painted onto the 2D layer and needs real `Path2D`.
            // Getting this pair the wrong way round is silent: a GL scene drawn
            // by the raster path, or a `Path2D` scene handed to the recorder,
            // both come out as an empty board with no error at all. Neither of
            // the two changes that met here shows it on its own.
            sceneRef.current = buildBoardScene(deleteBoardItems(brd, only), sceneFilter());
            moveSceneRef.current = buildScene(subsetBoardItems(brd, only), sceneFilter());
            // The overlay is drawn at absolute coords: a reshape moves points,
            // not the item, so it carries no drag delta.
            moveDeltaRef.current = { x: 0, y: 0 };
            sceneDirtyRef.current = true;
          }
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
      }
      // The zoom tool always rubber-bands: never grab the item under the cursor.
      //
      // What the press *grabs* is not what a click on it would *select*. The
      // drag branch of PCB_SELECTION_TOOL::Main runs selectPoint through
      // `zoneFilledAreaFilter` — "Don't allow starting a drag from a zone
      // filled area that isn't already selected" — and its other branch,
      // selectionContains, asks ZONE::HitTest, which is corner-or-edge too. So
      // a pour is grabbable only by its outline either way, while a plain click
      // anywhere inside it still selects it (and M then moves it). Without this
      // a stray drag over a ground pour picked the pour up and slid it off the
      // board, which is not something pcbnew will let you do.
      const hitId =
        activeToolRef.current !== 'zoomTool' && w && brd
          ? (hitCandidates(w, true)[0] ?? null)
          : null;
      downRef.current = {
        x: e.clientX,
        y: e.clientY,
        world: w,
        hitId,
        onItem: !!hitId,
        moved: false,
        shift: e.shiftKey,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    shiftDownRef.current = e.shiftKey;
    ctrlDownRef.current = e.ctrlKey || e.metaKey;
    // `if( m_autoPanEnabled && m_autoPanSettingEnabled ) isAutoPanning =
    // handleAutoPanning( aEvent )` (`wx_view_controls.cpp:304-305`).
    {
      const apr = canvasRef.current?.getBoundingClientRect();
      if (apr)
        autoPanRef.current.motion(
          { x: (e.clientX - apr.left) * dpr, y: (e.clientY - apr.top) * dpr },
          {
            settingEnabled: commonInputPrefs().autoPan,
            acceleration: commonInputPrefs().autoPanAcceleration,
          },
        );
    }
    // `onMotion`'s meta-pan (`wx_view_controls.cpp:288-311`), which comes
    // FIRST and returns: with the Drag Gestures key held, a bare pointer move
    // pans and nothing else in this handler runs.
    const meta = motionPanRef.current.update(e, commonInputPrefs().motionPanModifier, dpr);
    if (meta) {
      const v = viewRef.current;
      v.tx += meta.dx;
      v.ty += meta.dy;
      requestDraw();
      return;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      // Signed X so the crosshair tracks the physical cursor under a flipped view.
      const wx = ((e.clientX - rect.left) * dpr - v.tx) / (v.flipX ? -v.scale : v.scale);
      const wy = ((e.clientY - rect.top) * dpr - v.ty) / v.scale;
      statusReadout.setCursor({ x: wx, y: wy });
      cursorRef.current = { x: wx, y: wy };
      // Repaint so the crosshair follows even on a plain hover (no pan/drag).
      requestDraw();
    }
    if (panRef.current) {
      const v = viewRef.current;
      v.tx += (e.clientX - panRef.current.x) * dpr;
      v.ty += (e.clientY - panRef.current.y) * dpr;
      panRef.current = { x: e.clientX, y: e.clientY };
      requestDraw();
      return;
    }
    const dz = dragZoomRef.current;
    if (dz) {
      // DRAG_ZOOMING (`wx_view_controls.cpp:363-405`) — the wheel's own
      // zoom-about-a-point arithmetic, flipX included, at `m_zoomStartPoint`.
      const v = viewRef.current;
      const f = dragZoomScale(dz.lastClientY - e.clientY, commonInputPrefs());
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (dz.anchor.x - v.tx) / sx;
      const wy = (dz.anchor.y - v.ty) / v.scale;
      v.scale *= f;
      v.tx = dz.anchor.x - wx * (v.flipX ? -v.scale : v.scale);
      v.ty = dz.anchor.y - wy * v.scale;
      dz.lastClientY = e.clientY;
      requestDraw();
      return;
    }
    // Dragging a handle: reshape the item live. A corner follows the cursor; an
    // edge handle carries its whole edge, so it is moved by the cursor's delta
    // from where it was grabbed rather than snapped onto the cursor — grabbing
    // an edge slightly off its midpoint should not jump it.
    const handleDrag = editHandleDragRef.current;
    if (handleDrag) {
      const cur = worldAt(e.clientX, e.clientY);
      const brd = boardRef.current;
      const id = editHandleItemRef.current;
      if (cur && brd && id) {
        const to = handleSnap(cur);
        const target = handleDragTarget(handleDrag.handle, handleDrag.origin, to);
        const next = dragBoardHandle(brd, id, handleDrag.handle, target);
        pointEditPreviewRef.current = next;
        editHandlesRef.current = boardEditHandles(next, id);
        // Only the reshaped item is re-recorded; the base scene was captured
        // without it at drag start and is not dirtied, so the raster survives.
        // Under the GL renderer that is also what keeps the content key
        // unchanged, so a handle drag stays a uniform update instead of a full
        // re-record per mouse event. `buildScene`, not `buildBoardScene`: the
        // move overlay is painted onto the 2D layer and needs real `Path2D`.
        moveSceneRef.current = buildScene(subsetBoardItems(next, new Set([id])), sceneFilter());
        requestDraw();
      }
      return;
    }
    // Hovering a handle thickens its border (EDIT_POINT::IsHover).
    if (!downRef.current && editHandlesRef.current.length > 0) {
      const cur = worldAt(e.clientX, e.clientY);
      const hit = cur ? editHandleAt(cur) : null;
      const prev = hoveredEditHandleRef.current;
      if (hit?.kind !== prev?.kind || hit?.index !== prev?.index) {
        hoveredEditHandleRef.current = hit;
        requestDraw();
      }
    }
    // Keyboard grab (M/G) in flight: the selection follows the cursor freely
    // until a click commits it (no button held).
    if (grabbingRef.current) {
      const cur = worldAt(e.clientX, e.clientY);
      if (cur) updateMove(cur);
      return;
    }
    const d = downRef.current;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3 * dpr) d.moved = true;
      // Click-driven tools (delete, local ratsnest, drawing, routing, vias,
      // text) take no drag-move or box-select gestures.
      if (isClickTool(activeToolRef.current)) return;
      if (d.moved && d.world) {
        const cur = worldAt(e.clientX, e.clientY);
        if (!cur) return;
        if (d.onItem) {
          // On the first move, ensure the grabbed item is selected, then start
          // the gesture so the real geometry tracks the cursor.
          if (!movingRef.current) {
            movingRef.current = true;
            let movingSel: ReadonlySet<string> = selForDrawRef.current;
            if (d.hitId && !movingSel.has(d.hitId)) {
              movingSel = new Set([d.hitId]);
              applySelect(d.hitId, false);
            }
            // pcb_selection_tool.cpp: a routable selection (tracks/arcs/vias and
            // nothing else) left-drags as a router *drag*, PCBNEW_SETTINGS'
            // m_TrackDragAction, which defaults to TRACK_DRAG_ACTION::DRAG, the
            // 45° one. Everything else runs PCB_ACTIONS::move, which leaves the
            // routing behind.
            const seed = routableTrackSeed(movingSel);
            if (seed === null || !beginTrackDrag(seed, d.world, false))
              beginMove(movingSel, 'move', d.world);
          }
          updateMove(cur);
        } else {
          // Drag from empty space rubber-bands a selection box.
          boxRef.current = { a: d.world, b: cur };
          requestDraw();
        }
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    // Finish a point edit: commit the reshaped board, or put the scene back if
    // the handle never moved.
    if (editHandleDragRef.current) {
      const preview = pointEditPreviewRef.current;
      editHandleDragRef.current = null;
      // The gesture is over: `SetAuxAxes( false )`.
      auxAxisRef.current = null;
      pointEditPreviewRef.current = null;
      // Drop the reshape overlay: both paths below rebuild a full base scene
      // that contains the item again, so leaving it up would double-draw it.
      moveSceneRef.current = null;
      if (preview) commitBoard(preview);
      else if (boardRef.current) rebuildScene(boardRef.current);
      requestDraw();
      return;
    }
    const d = downRef.current;
    const box = boxRef.current;
    const moved = movingRef.current;
    panRef.current = null;
    // DRAG_ZOOMING and DRAG_PANNING share one release (`:575-588`).
    dragZoomRef.current = null;
    downRef.current = null;
    boxRef.current = null;
    movingRef.current = false;
    if (d) {
      // Zoom-to-selection (ZOOM_TOOL::Main): a dragged box zooms into it, a
      // plain click zooms in a step about the clicked point; either way the
      // tool returns to selection after one use.
      if (activeToolRef.current === 'zoomTool') {
        if (box) {
          fitWorldBox(
            Math.min(box.a.x, box.b.x),
            Math.min(box.a.y, box.b.y),
            Math.max(box.a.x, box.b.x),
            Math.max(box.a.y, box.b.y),
            'selection',
          );
        } else if (!d.moved) {
          zoomStep(1.3);
        }
        setActiveTool('selectSetRect');
        requestDraw();
        return;
      }
      if (!d.moved) {
        // Arming the Position Relative reference picker (PCB_PICKER_TOOL): the
        // next click names an item and does *not* touch the selection, which is
        // the thing being positioned.
        if (pickingRefItem.current) {
          const w = worldAt(e.clientX, e.clientY);
          const hit = w ? hitCandidates(w)[0] : undefined;
          if (hit) {
            const brd0 = boardRef.current;
            setPosRelRef({
              id: hit,
              label: (brd0 && describeSelected(brd0, hit)?.desc) || hit,
            });
            pickingRefItem.current = false;
            setPickingRefShown(false);
            setPosRelOpen(true);
            requestDraw();
          }
          return;
        }
        // Interactive Delete Tool (PCB_CONTROL::DeleteItemCursor): each click
        // deletes the item under the cursor, honouring the selection filter.
        if (activeToolRef.current === 'deleteTool') {
          const w = worldAt(e.clientX, e.clientY);
          const brd = boardRef.current;
          if (w && brd) {
            const hit = hitCandidates(w)[0];
            if (hit) {
              commitBoard(deleteBoardItems(brd, new Set([hit])));
              setSelection(new Set());
            }
          }
        } else if (activeToolRef.current === 'localRatsnestTool') {
          // BOARD_INSPECTION_TOOL::LocalRatsnestTool: try a PAD under the
          // cursor first (PadFilter), then a FOOTPRINT; clicking empty space
          // clears every local override back to the global ratsnest setting.
          const w = worldAt(e.clientX, e.clientY);
          const brd = boardRef.current;
          if (w && brd) {
            const refs = boardHitCandidates(brd, w, tolOf()).map((id) => parseBoardItemId(id));
            const padHit2 = refs.find((r) => r?.kind === 'pad');
            const fpHit = refs.find((r) => r?.kind === 'footprint');
            setLocalRats((prev) => {
              const next = new Set(prev);
              if (padHit2) {
                const key = `${padHit2.index}:${padHit2.sub ?? 0}`;
                if (next.has(key)) next.delete(key);
                else next.add(key);
              } else if (fpHit) {
                const fp = brd.footprints[fpHit.index];
                if (fp && fp.pads.length > 0) {
                  // enable = !firstPad.GetLocalRatsnestVisible()
                  const enable = !next.has(`${fpHit.index}:0`);
                  fp.pads.forEach((_, pi) => {
                    const key = `${fpHit.index}:${pi}`;
                    if (enable) next.add(key);
                    else next.delete(key);
                  });
                }
              } else {
                next.clear();
              }
              return next;
            });
          }
        } else if (DRAW_SHAPE_TOOLS[activeToolRef.current]) {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleDrawClick(w);
        } else if (activeToolRef.current === 'routeSingleTrack') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleRouteClick(w);
        } else if (activeToolRef.current === 'drawVia') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleViaClick(w);
        } else if (activeToolRef.current === 'placeText') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) setTextDialog(snapToGrid(w));
        } else if (activeToolRef.current === 'drawTable') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleTableClick(w);
        } else if (activeToolRef.current === 'drawTextBox') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleTextBoxClick(w);
        } else if (activeToolRef.current === 'placeReferenceImage') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleImageClick(w);
        } else if (dimensionToolKind(activeToolRef.current)) {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleDimensionClick(w, dimensionToolKind(activeToolRef.current)!);
        } else if (activeToolRef.current === 'drawZone') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleZoneClick(w);
        } else if (activeToolRef.current === 'gridSetOrigin') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleOriginClick('grid_origin', w);
        } else if (activeToolRef.current === 'drillOrigin') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleOriginClick('aux_axis_origin', w);
        } else if (activeToolRef.current === 'placeBarcode') {
          const w = worldAt(e.clientX, e.clientY);
          // `DrawBarcode` creates the item, opens the dialog, and only commits
          // if it returns OK (`drawing_tool.cpp:1528-1560`) — so nothing is
          // added here, and Cancel leaves the board untouched.
          if (w) setBarcodeDialog({ at: cursorSnapRef.current(w) });
        } else if (activeToolRef.current === 'placePoint') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handlePointClick(w);
        } else if (activeToolRef.current === 'measureTool') {
          const w = worldAt(e.clientX, e.clientY);
          if (w) handleMeasureClick(w);
        } else {
          clickSelect(e.clientX, e.clientY, d.shift);
        }
      } else if (moved) {
        // Drop the left-drag move (EDIT_TOOL Move); a zero net delta restores.
        commitMove();
      } else if (box && boardRef.current) {
        // Left→right = window (contained); right→left = crossing (touching).
        const contained = box.b.x >= box.a.x;
        const ids = boardItemsInBox(
          boardRef.current,
          box.a.x,
          box.a.y,
          box.b.x,
          box.b.y,
          contained,
        ).filter(passesFilter);
        setSelection((prev) => {
          const next = new Set(d.shift ? prev : []);
          for (const id of ids) next.add(id);
          return next;
        });
      }
    }
    requestDraw();
  };
  // Pointer left the canvas, drop the crosshair.
  const onPointerLeave = (): void => {
    cursorRef.current = null;
    statusReadout.setCursor(null);
    requestDraw();
  };

  /**
   * The menu tree, mirrored for the key chain below - `menus` is rebuilt every
   * render, and the chain has to dispatch off the live one so a row's
   * `disabled` (which moves with the selection) is honoured. Same reason
   * `useMenuHotkeys` holds a ref rather than a dependency.
   */
  const menusRef = useRef<Menu[]>([]);

  // One chain, in ACTION_MANAGER::RunHotKey order: the context actions this
  // canvas owns, then the menus. See ui/menu_hotkeys.ts for why there is not a
  // second listener beside this one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'pcb') !== 'pcb') return;
      // The 3D viewer overlay claims every unmodified key while it is up.
      // `defaultPrevented` means someone already acted on this key - EXCEPT
      // when it was our own browser suppressor, which runs in the capture phase
      // and cancels every combo the app claims purely to stop the browser.
      // Reading that as "handled" is what made every hotkey in the app stop
      // working once the dispatcher landed (c4a00590).
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      // tool_dispatcher.cpp:654-670 - an editable entry takes every key, a
      // read-only one keeps Ctrl+C. dispatchMenuHotkey re-applies this for the
      // menus; here it gates the context branches.
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      const mod = e.ctrlKey || e.metaKey;

      // --- context: what the live tool / selection owns ---------------------
      // ACTIONS::highContrastModeCycle (H): Normal -> Dim -> Hide -> Normal.
      if (!mod && (e.key === 'h' || e.key === 'H')) {
        setContrast((c) => (c === 'normal' ? 'dim' : c === 'dim' ? 'hide' : 'normal'));
        return;
      }
      // V while routing: place a via and switch copper layer (ROUTER_TOOL).
      // The clearest context action in the frame - it claims V only while
      // there is a route in progress, and otherwise leaves the key alone.
      if (!mod && (e.key === 'v' || e.key === 'V') && routeRef.current) {
        e.preventDefault();
        routeViaSwitchRef.current();
        return;
      }
      if (!mod && (e.key === 'r' || e.key === 'R')) {
        rotateSel(!e.shiftKey);
        return;
      } // R = CCW, Shift+R = CW (PCB_ACTIONS::rotateCcw / rotateCw, no row)
      // M = Move (routing left behind), G = Drag (attached traces follow), a
      // keyboard grab that follows the cursor and commits on click (EDIT_TOOL).
      // Shift is excluded because Shift+M is Move Exactly, which *has* a row:
      // `e.key` is already 'M' whenever shift is held, so without the guard
      // this would swallow the row's accelerator before it reached the menu.
      if (!mod && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        grabStartRef.current('move');
        return;
      }
      if (!mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        grabStartRef.current('drag');
        return;
      }
      // Bare D is drag45; Ctrl+D is Edit > Duplicate and belongs to its row.
      if (!mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        grabStartRef.current('drag45');
        return;
      }
      // PgUp / PgDn: `PCB_ACTIONS::layerTop` and `layerBottom`
      // (pcb_actions.cpp:1873, :2129). These are the two hotkeys the aux bar's
      // layer selector advertises in its own entries — "F.Cu (PgUp)" — so the
      // selector was naming keys that did nothing here.
      if (!mod) {
        const toLayer = layerForHotkey(e.key);
        // Only a layer the board actually has: `SetActiveLayer` on a layer that
        // is not enabled is not a thing upstream can do either.
        if (toLayer && (boardRef.current?.layers ?? []).some((l) => l.name === toLayer)) {
          e.preventDefault();
          setActiveLayer(toLayer);
          return;
        }
      }
      // B = Fill All Zones (PCB_ACTIONS::zoneFillAll), no row.
      if (!mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        fillAllZonesRef.current();
        return;
      }
      // ACTIONS::zoomFitScreen: WXK_HOME off macOS, Ctrl+0 on it
      // (actions.cpp:719-724). Home is the only spelling bound, and the View
      // menu row now prints it.
      if (!mod && e.key === 'Home') {
        e.preventDefault();
        zoomToFit();
        return;
      }
      // Net highlight (BOARD_INSPECTION_TOOL). `~` clears; Alt+` toggles the last
      // highlight on/off; a bare ` highlights the net under the cursor.
      if (!mod && e.key === '~') {
        e.preventDefault();
        clearHighlightRef.current();
        return;
      }
      if (e.key === '`') {
        e.preventDefault();
        if (e.altKey) toggleHighlightRef.current();
        else highlightNetRef.current();
        return;
      }
      if (e.key === 'Escape') {
        // Escape cancels an in-flight grab first, then the disambiguation menu,
        // then clears the selection.
        if (grabbingRef.current) {
          grabCancelRef.current();
          return;
        }
        if (disambigRef.current) {
          hoverRef.current = null;
          hoverSceneRef.current = null;
          setDisambig(null);
        } else if (routeRef.current) {
          // Esc ends the route in progress; committed segments stay.
          routeRef.current = null;
          requestDrawRef.current();
        } else if (tableStartRef.current) {
          setTableStart(null);
          requestDrawRef.current();
        } else if (textBoxStartRef.current) {
          textBoxStartRef.current = null;
          requestDrawRef.current();
        } else if (placeImageRef.current.step === 'placing') {
          // Esc drops the picture on the cursor but stays in the tool, ready
          // for another file — upstream's `cleanup()` without the `PopTool`.
          // Falling through to the tool-exit branch below instead would make
          // picking the wrong file cost a re-activation.
          placeImageRef.current = cancelPlaceImage(placeImageRef.current).state;
          requestDrawRef.current();
        } else if (dimensionRef.current) {
          dimensionRef.current = null;
          requestDrawRef.current();
        } else if (zoneRef.current) {
          zoneRef.current = null;
          requestDrawRef.current();
        } else if (measureRef.current) {
          measureRef.current = null;
          requestDrawRef.current();
        } else if (drawingRef.current.length > 0) {
          // First Esc abandons the in-flight shape; the tool stays active.
          drawingRef.current = [];
          requestDrawRef.current();
        } else if (enteredGroupRef.current) {
          // Esc leaves the entered group first (SELECTION_TOOL groupLeave).
          setEnteredGroup(null);
          requestDrawRef.current();
        } else if (activeToolRef.current !== 'selectSetRect') {
          // Esc in a tool returns to the selection tool (TOOL_MANAGER).
          setActiveTool('selectSetRect');
        } else {
          setShow3D(false);
          setSelection(new Set());
          // `m_ESCClearsNetHighlight` — Editing Options' "<ESC> clears net
          // highlighting". `PCB_CONTROL::ClearHighlight` is bound to Escape
          // only when it is set (`pcb_edit_frame.cpp`), so with it off a
          // highlighted net survives the key that clears the selection. Ours
          // never cleared it at all, which is the other half of the same gap.
          if (escClearsHighlightRef.current) clearHighlightRef.current();
        }
        return;
      }

      // --- global: the menu accelerators ------------------------------------
      if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit, rotateSel]);

  // The snap modifiers, tracked on the keyboard as well as the pointer.
  // Upstream a modifier arrives as its own `TOOL_EVENT`, so pressing Shift or
  // Ctrl changes the snap immediately; sampling them only on pointer move
  // leaves the snap stale until the mouse is nudged. A repaint follows so the
  // crosshair and any in-flight preview move the moment the key does.
  useEffect(() => {
    const sync = (e: KeyboardEvent): void => {
      const shift = e.shiftKey;
      const ctrl = e.ctrlKey || e.metaKey;
      if (shift === shiftDownRef.current && ctrl === ctrlDownRef.current) return;
      shiftDownRef.current = shift;
      ctrlDownRef.current = ctrl;
      requestDrawRef.current();
    };
    // A window that loses focus mid-chord never sees the keyup, which would
    // otherwise leave snapping disabled until the key is pressed and released
    // again.
    const clear = (): void => {
      shiftDownRef.current = false;
      ctrlDownRef.current = false;
    };
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // ----- appearance data ------------------------------------------------------

  /**
   * BOARD::GetLayerName for this board — the one place the frame turns a layer
   * into text for the user. The Appearance list, the aux-bar layer selector
   * and the readout all go through it, the way every upstream caller goes
   * through BOARD::GetLayerName rather than spelling the name itself.
   */
  const layerName = useCallback(
    (name: string): string => GetLayerName(board?.layers ?? [], name),
    [board],
  );

  const copperLayers = useMemo(
    () => (board ? board.layers.filter((l) => /\.Cu$/.test(l.name)).map((l) => l.name) : []),
    [board],
  );
  // Copper layers first, then the technical layers in rebuildLayers()'s
  // non_cu_seq order, then any remaining - the shared rule, in
  // `widgets/appearance_layers.ts`.
  const layerRows = useMemo(
    () =>
      board
        ? appearanceLayerRows(
            copperLayers,
            board.layers.map((l) => l.name),
          )
        : [],
    [board, copperLayers],
  );

  /**
   * Which entry the presets combo shows. Derived every render, never stored:
   * syncLayerPresetSelection searches the presets for one matching the view
   * and selects the separator when none does, so there is no state to keep in
   * step and no "(unsaved)" sentinel — that entry is in the wxFormBuilder stub
   * and Clear() removes it before the combo is ever seen.
   */
  const preset = useMemo(
    () =>
      matchPresetName({
        visibleLayers: visible,
        objectsAtDefault: OBJECT_ROWS.every(
          (r) => r === 'sep' || objects[r.key] === DEFAULT_OBJECTS[r.key],
        ),
        flipBoard: flipView,
        allLayers: board?.layers.map((l) => l.name) ?? [],
        copperLayers,
        userPresets,
      }),
    [visible, objects, flipView, board, copperLayers, userPresets],
  );

  const toggleLayer = (name: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const applyPreset = (name: string): void => {
    const user = userPresets.find((x) => x.name === name);
    if (user) {
      setVisible(new Set(user.layers));
      return;
    }
    const p = BUILTIN_PRESETS.find((x) => x.name === name);
    if (!p || !board) return;
    const all = board.layers.map((l) => l.name);
    setVisible(new Set(p.layers(all, copperLayers).filter((l) => all.includes(l))));
    // doApplyLayerPreset also carries the preset's flipBoard and activeLayer.
    setFlipView(p.flipBoard);
    if (p.activeLayer && all.includes(p.activeLayer)) setActiveLayer(p.activeLayer);
  };

  // Layer right-click context menu ops (APPEARANCE_CONTROLS::onLayerContextMenu).
  const nonCopperLayers = useMemo(
    () => (board ? board.layers.map((l) => l.name).filter((n) => !/\.Cu$/.test(n)) : []),
    [board],
  );
  const setVisibleUnsaved = (names: Iterable<string>): void => {
    setVisible(new Set(names));
  };
  const layerMenuItems = (): { label: string; run: () => void }[][] => {
    if (!board) return [];
    const all = board.layers.map((l) => l.name);
    const has = (n: string): boolean => all.includes(n);
    const applyNamed = (name: string, active?: string): void => {
      const p = BUILTIN_PRESETS.find((x) => x.name === name);
      if (!p) return;
      setVisibleUnsaved(p.layers(all, copperLayers).filter(has));
      if (active && has(active)) setActiveLayer(active);
    };
    const groups: { label: string; run: () => void }[][] = [
      [
        {
          label: 'Show All Copper Layers',
          run: () => setVisibleUnsaved([...visible, ...copperLayers]),
        },
        {
          label: 'Hide All Copper Layers',
          run: () => setVisibleUnsaved([...visible].filter((n) => !/\.Cu$/.test(n))),
        },
      ],
      [{ label: 'Hide All Layers But Active', run: () => setVisibleUnsaved([activeLayer]) }],
      [
        {
          label: 'Show All Non Copper Layers',
          run: () => setVisibleUnsaved([...visible, ...nonCopperLayers]),
        },
        {
          label: 'Hide All Non Copper Layers',
          run: () => setVisibleUnsaved([...visible].filter((n) => /\.Cu$/.test(n))),
        },
      ],
      [
        { label: 'Show All Layers', run: () => setVisibleUnsaved(all) },
        { label: 'Hide All Layers', run: () => setVisibleUnsaved([]) },
      ],
      [
        {
          label: 'Show Only Front Assembly Layers',
          run: () => applyNamed('Front Assembly View', 'F.SilkS'),
        },
        { label: 'Show Only Front Layers', run: () => applyNamed('Front Layers', 'F.Cu') },
        ...(copperLayers.length > 2
          ? [
              {
                label: 'Show Only Inner Layers',
                run: () => applyNamed('Inner Copper Layers', copperLayers[1]),
              },
            ]
          : []),
        { label: 'Show Only Back Layers', run: () => applyNamed('Back Layers', 'B.Cu') },
        {
          label: 'Show Only Back Assembly Layers',
          run: () => applyNamed('Back Assembly View', 'B.SilkS'),
        },
      ],
    ];
    return groups;
  };

  // Presets combo (rebuildLayerPresetsWidget): the built-ins alphabetically,
  // then the user's, then --- / Save preset... / Delete preset...
  const onPresetChoice = (value: string): void => {
    if (value === PRESET_SEPARATOR) return;
    if (value === 'Save preset...') {
      const name = window.prompt('Layer preset name:')?.trim();
      if (!name) return;
      setUserPresets((p) => [...p.filter((x) => x.name !== name), { name, layers: [...visible] }]);
      return;
    }
    if (value === 'Delete preset...') {
      setDeleteChooser('presets');
      return;
    }
    applyPreset(value);
  };

  // Viewports combo (rebuildViewportsWidget): saved viewports, then
  // --- / Save viewport... / Delete viewport...
  const onViewportChoice = (value: string): void => {
    if (value === '---') return;
    if (value === 'Save viewport...') {
      const name = window.prompt('Viewport name:')?.trim();
      if (!name) return;
      const v = { ...viewRef.current };
      setViewports((p) => [...p.filter((x) => x.name !== name), { name, view: v }]);
      setViewportSel(name);
      return;
    }
    if (value === 'Delete viewport...') {
      setDeleteChooser('viewports');
      return;
    }
    const vp = viewports.find((x) => x.name === value);
    if (!vp) return;
    viewRef.current.tx = vp.view.tx;
    viewRef.current.ty = vp.view.ty;
    viewRef.current.scale = vp.view.scale;
    setViewportSel(value);
    requestDraw();
  };

  // `NET_GRID_TABLE::Rebuild`'s filter and sort, in a module qa can import;
  // see appearance_nets.ts for both decisions and what each one got wrong.
  const nets = useMemo(() => (board ? appearanceNetRows(board.nets) : []), [board]);

  // ----- ratsnest + net classes ----------------------------------------------

  // Net classes from Board Setup, the single source of truth (hydrated from
  // the project's net_settings, updated live when the dialog commits). A blank
  // per-class cell inherits the Default class, which itself falls back to the
  // NETCLASS factory constants (netclass resolution).
  /**
   * The selection as Clearance / Constraints Resolution sections.
   *
   * Built from the same rule set DRC runs with, through the same walk, so the
   * explanation cannot disagree with the markers it exists to explain.
   */
  const inspectSections = useMemo(() => {
    if (!board || !inspectOpen) return [];

    return inspectSelection(board, selection, parseDrcRules(boardSetup.customRules.text), (net) =>
      netclassesForNet(net, boardSetup.netClasses.assignments),
    );
  }, [
    board,
    inspectOpen,
    selection,
    boardSetup.customRules.text,
    boardSetup.netClasses.assignments,
  ]);

  const netclassInfo = useMemo(() => {
    const rows = boardSetup.netClasses.classes;
    const mmVal = (s: string): number | undefined => {
      const v = parseFloat(s);
      return Number.isFinite(v) && v > 0 ? Math.round(v * MM) : undefined;
    };
    const dflt = rows[0];
    const dfltDims: ClassDims = {
      trackWidth: mmVal(dflt?.trackWidth ?? '') ?? DEFAULT_CLASS_DIMS.trackWidth,
      viaDiameter: mmVal(dflt?.viaSize ?? '') ?? DEFAULT_CLASS_DIMS.viaDiameter,
      viaDrill: mmVal(dflt?.viaHole ?? '') ?? DEFAULT_CLASS_DIMS.viaDrill,
    };
    const dfltClearance = mmVal(dflt?.clearance ?? '') ?? 0;
    const classes: string[] = [];
    const classColors = new Map<string, string>();
    const classDims = new Map<string, ClassDims>();
    const classClearance = new Map<string, number>();
    for (const c of rows) {
      if (!c.name || classes.includes(c.name)) continue;
      classes.push(c.name);
      if (c.pcbColor) classColors.set(c.name, c.pcbColor);
      classDims.set(c.name, {
        trackWidth: mmVal(c.trackWidth) ?? dfltDims.trackWidth,
        viaDiameter: mmVal(c.viaSize) ?? dfltDims.viaDiameter,
        viaDrill: mmVal(c.viaHole) ?? dfltDims.viaDrill,
      });
      classClearance.set(c.name, mmVal(c.clearance) ?? dfltClearance);
    }
    if (!classes.includes('Default')) classes.unshift('Default');
    const patterns = boardSetup.netClasses.assignments.filter((a) => a.pattern && a.netClass);
    return { classes, classColors, classDims, classClearance, patterns };
  }, [boardSetup.netClasses]);

  // TOP_AUX pre-defined size lists = BOARD_DESIGN_SETTINGS m_TrackWidthList /
  // m_ViasDimensionsList (Board Setup > Pre-defined Sizes, in stored order;
  // upstream's [0] "use netclass" sentinel is the dropdowns' first option).
  const trackWidthList = useMemo(
    () => boardSetup.trackWidthsMM.filter((w) => w > 0).map((w) => Math.round(w * MM)),
    [boardSetup.trackWidthsMM],
  );
  const viaSizeList = useMemo(
    () =>
      boardSetup.viaSizesMM
        .filter((v) => v.diameter > 0)
        .map((v) => ({ diameter: Math.round(v.diameter * MM), drill: Math.round(v.drill * MM) })),
    [boardSetup.viaSizesMM],
  );
  // A shrunken list drops an out-of-range selection back to "use netclass".
  useEffect(() => {
    if (trackSel > trackWidthList.length) setTrackSel(0);
  }, [trackWidthList, trackSel]);
  useEffect(() => {
    if (viaSel > viaSizeList.length) setViaSel(0);
  }, [viaSizeList, viaSel]);
  const trackWidthListRef = useRef(trackWidthList);
  trackWidthListRef.current = trackWidthList;
  const viaSizeListRef = useRef(viaSizeList);
  viaSizeListRef.current = viaSizeList;
  // net code -> net class name, via the project's netclass_patterns.
  const netClassOf = useMemo(() => {
    const m = new Map<number, string>();
    if (board) {
      for (const [code, name] of board.nets) m.set(code, netClassFor(name, netclassInfo.patterns));
    }
    return m;
  }, [board, netclassInfo]);
  const classColorOf = useCallback(
    (cls: string): string | undefined => classColors.get(cls) ?? netclassInfo.classColors.get(cls),
    [classColors, netclassInfo],
  );

  // ----- what APPEARANCE_CONTROLS is handed ------------------------------------
  //
  // The widget draws; this frame supplies. Each of these is one of the model
  // structs the C++ builds inside the panel because there it *is* the frame's
  // neighbour: NET_GRID_TABLE's rows, m_netclassSettings, and the two combos.

  /** NET_GRID_TABLE's rows (appearance_controls.h:48-62). */
  /**
   * The per-net colour overrides, by net code.
   *
   * Not state of this frame's own: `PCB_EDIT_FRAME::LoadProjectSettings` fills
   * the painter's map from `NET_SETTINGS::GetNetColorAssignments()`
   * (pcbnew_config.cpp:95-105), which is `net_settings.net_colors` in the
   * .kicad_pro — a NAME to colour map, resolved to net codes through the
   * board's own net list. This was a `useState( new Map() )` that only the
   * colour picker ever wrote, so a board whose project assigns colours opened
   * with every net unspecified, and a colour set here was gone on reload.
   */
  const netColors = useMemo(() => {
    const byCode = new Map<number, string>();
    if (!board) return byCode;
    for (const [code, name] of board.nets.entries()) {
      const css = boardSetup.netClasses.netColors[name];
      if (css) byCode.set(code, css);
    }
    return byCode;
  }, [board, boardSetup.netClasses.netColors]);

  /**
   * The picker's write, straight back into the project slice it came from.
   *
   * `#rrggbb`, because that is the form every colour in a BoardSetupValues
   * takes — `kicadColorToCss` normalises the file's `rgb(...)` into it and
   * `cssColorToKicad` only accepts it back (project_settings.ts:196-209). An
   * `rgb(...)` string handed in here would be written out as the UNSET
   * sentinel, i.e. silently dropped.
   *
   * COLOR4D::UNSPECIFIED (alpha 0) clears the assignment rather than storing a
   * transparent black, which is what upstream's `if( color != UNSPECIFIED )`
   * does on the way in (pcbnew_config.cpp:99).
   */
  const setNetColor = useCallback(
    (code: number, picked: Color4d): void => {
      const name = board?.nets.get(code);
      if (!name) return;
      const next = { ...(boardSetupRef.current.netClasses.netColors ?? {}) };
      if (picked.a > 0) {
        const ch = (v: number): string =>
          Math.round(Math.min(1, Math.max(0, v)) * 255)
            .toString(16)
            .padStart(2, '0');
        next[name] = `#${ch(picked.r)}${ch(picked.g)}${ch(picked.b)}`;
      } else {
        delete next[name];
      }
      commitBoardSetup({
        ...boardSetupRef.current,
        netClasses: { ...boardSetupRef.current.netClasses, netColors: next },
      });
    },
    [board, commitBoardSetup],
  );

  const netRows = useMemo(
    () =>
      nets.map(([code, name]) => ({
        code,
        name,
        color: netColors.get(code),
        visible: !hiddenNets.has(code),
      })),
    [nets, netColors, hiddenNets],
  );

  /** m_netclassSettings, in Board Setup order. */
  const netclassRows = useMemo(
    () =>
      netclassInfo.classes.map((name) => ({
        name,
        color: classColorOf(name),
        visible: !hiddenClasses.has(name),
      })),
    [netclassInfo, classColorOf, hiddenClasses],
  );

  const presetItems = useMemo(
    () => presetComboItems(userPresets.map((u) => u.name)),
    [userPresets],
  );
  const viewportItems = useMemo(
    () => viewportComboItems(viewports.map((v) => v.name)),
    [viewports],
  );

  // The airwires (CONNECTIVITY_DATA::GetRatsnest), recomputed on every edit.
  const ratsnestEdges = useMemo(() => (board ? buildRatsnest(board) : []), [board]);
  const ratsnestEdgesRef = useRef<RatsnestEdge[]>(ratsnestEdges);
  ratsnestEdgesRef.current = ratsnestEdges;

  // Nets of the current selection, their airwires are always shown (even when
  // the global ratsnest is off), so clicking a pad/footprint/track reveals the
  // thin airwires to what it connects to (PCB_SELECTION_TOOL local ratsnest).
  const selectedNets = useMemo(() => {
    const nets = new Set<number>();
    if (!board) return nets;
    for (const id of selection) {
      const r = parseBoardItemId(id);
      if (!r) continue;
      if (r.kind === 'footprint' || r.kind === 'fptext') {
        const fp = board.footprints[r.index];
        if (fp) for (const p of fp.pads) if (p.net && p.net > 0) nets.add(p.net);
      } else if (r.kind === 'pad') {
        const p = board.footprints[r.index]?.pads[r.sub ?? 0];
        if (p?.net && p.net > 0) nets.add(p.net);
      } else if (r.kind === 'track') {
        const t = board.tracks[r.index];
        if (t && t.net > 0) nets.add(t.net);
      } else if (r.kind === 'arc') {
        const a = board.arcs[r.index];
        if (a && a.net > 0) nets.add(a.net);
      } else if (r.kind === 'via') {
        const v = board.vias[r.index];
        if (v && v.net > 0) nets.add(v.net);
      }
    }
    return nets;
  }, [selection, board]);
  const selectedNetsRef = useRef<ReadonlySet<number>>(selectedNets);
  selectedNetsRef.current = selectedNets;

  // "Toggle Net Highlight" is greyed unless a net is designated for highlight
  // (KiCad's enableNetHighlightCond = IsNetHighlightSet). We enable it whenever
  // the selection carries a net (so a click highlights that net) or a highlight
  // is already active (so a click can toggle it off).
  const leftDisabled = useMemo(() => {
    const s = new Set<string>();
    if (selectedNets.size === 0 && highlightNets.size === 0) s.add('toggleNetHighlight');
    // The Show Grid button's right-click menu carries `ACTIONS::gridOrigin`
    // under `ACTIONS::gridProperties` (`pcbnew/toolbars_pcb_editor.cpp:150-161`).
    // `COMMON_TOOLS::GridOrigin` is a WX_PT_ENTRY_DIALOG that writes
    // `SetGridOrigin` (`common/tool/common_tools.cpp:637-651`), and we do not
    // have it: the Place menu's own Grid Origin row is greyed for the same
    // reason. Shown in its upstream position rather than dropped, which is what
    // the rest of this frame does with an entry it cannot run yet.
    s.add('gridOrigin');
    return s;
  }, [selectedNets, highlightNets]);

  // Highlight scene: every copper item on the highlighted nets, painted
  // Brightened(0.5) over the dimmed board, BOARD_INSPECTION_TOOL net highlight
  // (pcb_painter.cpp: highlighted items brighten, the rest darken).
  //
  // "Every copper item" includes the *pads*: PAD is a BOARD_CONNECTED_ITEM and
  // draw(PAD) runs the same GetColor, so the net's pads lift with its tracks.
  // Leaving them out was what made a highlighted net look half-lit.
  const highlightSceneRef = useRef<BoardScene | null>(null);
  useEffect(() => {
    const brd = boardRef.current;
    if (!brd || highlightNets.size === 0) {
      highlightSceneRef.current = null;
      if (dimmedRef.current) {
        dimmedRef.current = false;
        sceneDirtyRef.current = true; // repaint the board at full brightness
      }
      requestDraw();
      return;
    }
    const ids = new Set<string>();
    brd.tracks.forEach((t, i) => {
      if (highlightNets.has(t.net)) ids.add(boardItemId('track', i));
    });
    brd.arcs.forEach((a, i) => {
      if (highlightNets.has(a.net)) ids.add(boardItemId('arc', i));
    });
    brd.vias.forEach((vv, i) => {
      if (highlightNets.has(vv.net)) ids.add(boardItemId('via', i));
    });
    brd.zones.forEach((z, i) => {
      if (highlightNets.has(z.net)) ids.add(boardItemId('zone', i));
    });
    brd.footprints.forEach((fp, fi) => {
      fp.pads.forEach((p, pi) => {
        if (p.net !== undefined && highlightNets.has(p.net)) ids.add(boardItemId('pad', fi, pi));
      });
    });
    // The line a router drag has in flight is drawn by the move overlay, so it
    // must not also appear here at its old position (upstream HideItem()s it).
    if (trackDragRef.current) for (const id of dragAffectedRef.current) ids.delete(id);
    highlightSceneRef.current = ids.size > 0 ? buildScene(subsetBoardItems(brd, ids)) : null;
    // The raster carries the dimming, so it has to be re-rendered when the
    // highlight comes and goes.
    if (dimmedRef.current !== (highlightSceneRef.current !== null)) {
      dimmedRef.current = highlightSceneRef.current !== null;
      sceneDirtyRef.current = true;
    }
    requestDraw();
  }, [highlightNets, requestDraw]);

  // Only recompute the ratsnest live during a drag on boards small enough that
  // a per-frame buildRatsnest stays smooth (bigger boards update on drop).
  const liveRatsRef = useRef(false);
  liveRatsRef.current = board
    ? board.footprints.reduce((n, f) => n + f.pads.length, 0) + board.vias.length <= 1500
    : false;

  // Filter + color a raw airwire list for display (the Nets-tab visibility, the
  // Net Display Options modes, and the Local Ratsnest set). Shared by the
  // steady-state effect and the live recompute during a move.
  const filterRats = useCallback(
    (
      edges: RatsnestEdge[],
      forcedLocalNets?: ReadonlySet<number>,
    ): { e: RatsnestEdge; color: string }[] => {
      const brd = boardRef.current;
      if (!brd) return [];
      const anyCuVisible = [...visible].some((l) => /\.Cu$/.test(l));
      const layerOn = (l: string): boolean => (l === 'through' ? anyCuVisible : visible.has(l));
      const localNets = new Set<number>(forcedLocalNets);
      for (const key of localRats) {
        const [fi, pi] = key.split(':').map(Number);
        const pad = brd.footprints[fi ?? -1]?.pads[pi ?? -1];
        if (pad?.net && pad.net > 0) localNets.add(pad.net);
      }
      const globalOn = objects.ratsnest && ratsnestMode !== 'off';
      const list: { e: RatsnestEdge; color: string }[] = [];
      for (const e of edges) {
        const isLocal = localNets.has(e.net);
        if (!globalOn && !isLocal) continue;
        const cls = netClassOf.get(e.net) ?? 'Default';
        if (!isLocal) {
          if (hiddenNets.has(e.net) || hiddenClasses.has(cls)) continue;
          if (ratsnestMode === 'visible' && !layerOn(e.aLayer) && !layerOn(e.bLayer)) continue;
        }
        let color: string = PCB_SPECIAL.ratsnest;
        if (netColorMode !== 'off') color = netColors.get(e.net) ?? classColorOf(cls) ?? color;
        list.push({ e, color });
      }
      return list;
    },
    [
      objects.ratsnest,
      ratsnestMode,
      hiddenNets,
      hiddenClasses,
      netColors,
      netColorMode,
      classColorOf,
      netClassOf,
      visible,
      localRats,
    ],
  );
  const filterRatsRef = useRef(filterRats);
  filterRatsRef.current = filterRats;

  // Airwires filtered/colored for display, kept in a ref for the draw pass.
  const ratsDrawRef = useRef<{ e: RatsnestEdge; color: string }[]>([]);
  useEffect(() => {
    // No forced nets at rest. KiCad's local ratsnest is *dynamic* — its own
    // comment calls it "the ratsnest for objects that may be currently being
    // moved" — and `updateLocalRatsnest` is posted only by the move tool and by
    // the Local Ratsnest tool, never by a selection change. Passing the
    // selection here made simply clicking a footprint light up its airwires
    // with the ratsnest switched off, which pcbnew does not do.
    ratsDrawRef.current = filterRats(ratsnestEdges);
    requestDraw();
  }, [ratsnestEdges, filterRats, requestDraw]);

  // Net colors mode "All": copper items of explicitly-colored nets get an
  // overlay tint (tracks/arcs/vias/zones; pads keep their layer color for now).
  const coloredScenesRef = useRef<{ color: string; scene: BoardScene }[]>([]);
  useEffect(() => {
    const brd = boardRef.current;
    const list: { color: string; scene: BoardScene }[] = [];
    if (brd && netColorMode === 'all') {
      const colorFor = new Map<number, string>();
      for (const [code] of brd.nets) {
        if (code === 0) continue;
        const c = netColors.get(code) ?? classColorOf(netClassOf.get(code) ?? 'Default');
        if (c) colorFor.set(code, c);
      }
      for (const [net, color] of colorFor) {
        const ids = new Set<string>();
        brd.tracks.forEach((t, i) => {
          if (t.net === net) ids.add(boardItemId('track', i));
        });
        brd.arcs.forEach((a, i) => {
          if (a.net === net) ids.add(boardItemId('arc', i));
        });
        brd.vias.forEach((vv, i) => {
          if (vv.net === net) ids.add(boardItemId('via', i));
        });
        brd.zones.forEach((z, i) => {
          if (z.net === net) ids.add(boardItemId('zone', i));
        });
        if (ids.size > 0) list.push({ color, scene: buildScene(subsetBoardItems(brd, ids)) });
      }
    }
    coloredScenesRef.current = list;
    requestDraw();
  }, [board, netColorMode, netColors, classColorOf, netClassOf, requestDraw]);

  // ----- toolbar handlers -----------------------------------------------------

  const onLeftToggle = (id: string): void => {
    // The Show Grid button's right-click menu, not a button
    // (`pcbnew/toolbars_pcb_editor.cpp:149-161`): upstream runs its rows
    // through the same TOOL_MANAGER the button goes through, so they arrive
    // here. `COMMON_TOOLS::GridProperties` for FRAME_PCB_EDITOR is
    // `ShowPreferences( _( "Grids" ), _( "PCB Editor" ) )`
    // (`common/tool/common_tools.cpp:625`); that page is not in our book yet,
    // so the dialog opens without naming one.
    if (id === 'gridProperties') {
      setPrefsOpen(true);
      return;
    }
    // The high-contrast button maps onto the Layer Display Options mode
    // (ACTIONS::highContrastMode toggles Normal <-> Dim).
    if (id === 'highContrast') {
      setContrast((c) => (c === 'normal' ? 'dim' : 'normal'));
      return;
    }
    // Ratsnest visibility is the Objects tab's LAYER_RATSNEST, single source.
    if (id === 'showRatsnest') {
      setObjects((p) => ({ ...p, ratsnest: !p.ratsnest }));
      return;
    }
    // Toggle Net Highlight: show/hide the last-highlighted net set.
    if (id === 'toggleNetHighlight') {
      toggleHighlightRef.current();
      return;
    }
    // The three crosshair shapes and Show Grid are stored settings, so the
    // button and Preferences are one value: `foldPcbToggle` writes the file and
    // the subscription above brings it back as a re-render.
    if (isStoredPcbToggle(id)) settings.updatePcbnew((c) => void foldPcbToggle(c, id));
    setToggles((prev) => applyToggle(prev, id));
  };

  const saveCopy = useCallback((): void => {
    // Serialize the (possibly edited) board; fall back to the original text if
    // it never parsed. serializeBoard is lossless for unedited boards.
    const out = boardRef.current ? serializeBoard(boardRef.current) : text;
    const blob = new Blob([out], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [text, fileName]);

  const onTopAction = (id: string): void => {
    switch (id) {
      case 'save':
        // Save writes into the project's file manager (cloud storage); users
        // download from there. "Save a Copy…" keeps the local download.
        if (onSaveBoard) onSaveBoard(boardRef.current ? serializeBoard(boardRef.current) : text);
        else saveCopy();
        setDirty(false);
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'rotateCCW':
        rotateSel(true);
        break;
      case 'rotateCW':
        rotateSel(false);
        break;
      /**
       * `BOARD_EDITOR_CONTROL::AutoTrackWidth` (board_editor_control.cpp:1332-1344):
       *
       *     if( bds.UseCustomTrackViaSize() )
       *     {
       *         bds.UseCustomTrackViaSize( false );
       *         bds.m_UseConnectedTrackWidth = true;
       *     }
       *     else
       *     {
       *         bds.m_UseConnectedTrackWidth = !bds.m_UseConnectedTrackWidth;
       *     }
       *
       * The first branch is not a flourish: a custom track/via size and
       * inheriting an existing one are mutually exclusive, so turning this on
       * while a custom size is in force clears that size rather than toggling.
       * Our equivalent of `UseCustomTrackViaSize()` is a non-zero selection in
       * the track-width combo, which is what `GetCurrentTrackWidth` reads.
       */
      case 'autoTrackWidth':
        if (trackSelRef.current !== 0) {
          setTrackSel(0);
          setAutoTrackWidth(true);
        } else {
          setAutoTrackWidth((v) => !v);
        }
        break;
      case 'pageSettings':
        setPageDlgOpen(true);
        break;
      case 'runDRC':
        setDrcOpen(true);
        break;
      case 'boardSetup':
        setBoardSetupPage(undefined);
        setBoardSetupOpen(true);
        break;
      case 'print':
        setPrintDlgOpen(true);
        break;
      case 'plot':
        setPlotDlgOpen(true);
        break;
      case 'mirrorV':
        mirrorSel('v');
        break;
      case 'mirrorH':
        mirrorSel('h');
        break;
      case 'group':
        groupSel();
        break;
      case 'ungroup':
        ungroupSel();
        break;
      case 'addToGroup':
        addToGroupSel();
        break;
      case 'removeFromGroup':
        removeFromGroupSel();
        break;
      case 'lock':
        lockSel(true);
        break;
      case 'unlock':
        lockSel(false);
        break;
      case 'toggleLock':
        lockSel('toggle');
        break;
      case 'find':
        setFindOpen(true);
        break;
      case 'zoomRedraw':
        sceneDirtyRef.current = true;
        requestDraw();
        break;
      case 'zoomIn':
        zoomStep(1.3);
        break;
      case 'zoomOut':
        zoomStep(1 / 1.3);
        break;
      case 'zoomFit':
        zoomToFit();
        break;
      case 'zoomFitObjects':
        zoomFitObjects();
        break;
      case 'zoomTool':
        // ACTIONS::zoomTool: drag a rectangle to zoom into it; reverts to the
        // selection tool after one use (handled on pointer-up).
        setActiveTool('zoomTool');
        break;
      case 'footprintEditor':
        onShowFootprintEditor?.();
        break;
      case 'showEeschema':
        onShowSchematic?.();
        break;
      case 'updatePcbFromSch':
        void openUpdatePcb();
        break;
      case 'threeDViewer':
        setShow3D(true);
        break;
      default:
        break; // other editing actions are staged
    }
  };

  // ----- menus (menubar_pcb_editor.cpp structure, working subset active) ------

  const dis = true;
  // The corner operations work on pairs of straight graphics, so the count that
  // matters is how many of the selection actually are ones — a selection of two
  // rectangles has nothing to fillet.
  const lineModDisabled = !board || modifiableLineCount(board, selection) < 2;
  // Likewise counted on what the selection actually holds: two polygons, not
  // two items.
  const polyBoolDisabled = !board || booleanableShapeCount(board, selection) < 2;
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New Board', disabled: dis },
        { label: 'Open...', disabled: dis },
        { sep: true },
        {
          label: 'Save',
          action: () => onTopAction('save'),
          shortcut: 'Ctrl+S',
        },
        { label: 'Save a Copy...', action: saveCopy },
        { sep: true },
        { label: 'Import', disabled: dis },
        { label: 'Export', disabled: dis },
        { label: 'Fabrication Outputs', disabled: dis },
        { sep: true },
        addQuitOrClose('PCB Editor', onExit),
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', action: undo, shortcut: 'Ctrl+Z' },
        { label: 'Redo', action: redo, shortcut: 'Ctrl+Y' },
        { sep: true },
        { label: 'Duplicate', action: duplicateSel, shortcut: 'Ctrl+D' },
        { label: 'Delete', action: deleteSel, shortcut: 'Delete' },
        { sep: true },
        // No Align/Distribute here. `menubar_pcb_editor.cpp` has no align rows
        // at all - ALIGN_DISTRIBUTE_TOOL hangs its one submenu off the
        // selection context menu and nowhere else (align_distribute_tool.cpp:87-88),
        // which is where ours now is, built by `alignDistributeSubmenu`.
        {
          label: 'Convert',
          submenu: [
            {
              label: 'Create Polygon from Selection...',
              action: () => convertSelection('poly'),
              disabled: selection.size === 0,
            },
            {
              label: 'Create Zone from Selection...',
              action: () => convertSelection('zone'),
              disabled: selection.size === 0,
            },
            {
              label: 'Create Rule Area from Selection...',
              action: () => convertSelection('ruleArea'),
              disabled: selection.size === 0,
            },
            { sep: true },
            {
              label: 'Create Lines from Selection...',
              action: () => convertSelection('lines'),
              disabled: selection.size === 0,
            },
            {
              label: 'Create Tracks from Selection',
              action: () => convertSelection('tracks'),
              disabled: selection.size === 0,
            },
            {
              label: 'Create Arc from Selection',
              action: () => convertSelection('arc'),
              disabled: selection.size === 0,
            },
          ],
        },
        {
          label: 'Polygons',
          submenu: [
            {
              label: 'Merge Polygons',
              action: () => applyPolygonBoolean('merge'),
              disabled: polyBoolDisabled,
            },
            {
              label: 'Subtract Polygons',
              action: () => applyPolygonBoolean('subtract'),
              disabled: polyBoolDisabled,
            },
            {
              label: 'Intersect Polygons',
              action: () => applyPolygonBoolean('intersect'),
              disabled: polyBoolDisabled,
            },
          ],
        },
        {
          label: 'Create Array...',
          action: () => {
            // A circular array turns about a point, and the selection's own
            // centre is the only sensible one to open on — (0,0) would fling
            // the copies across the board.
            const brd = boardRef.current;
            const bb = brd ? boardSelectionBBox(brd, selection) : null;
            if (bb) {
              setArraySettings((prev) => ({
                ...prev,
                centreXIU: Math.round((bb.minX + bb.maxX) / 2),
                centreYIU: Math.round((bb.minY + bb.maxY) / 2),
              }));
            }
            setArrayOpen(true);
          },
          disabled: selection.size === 0,
        },
        {
          label: 'Outset Items...',
          action: () => setOutsetOpen(true),
          disabled: selection.size === 0,
        },
        {
          label: 'Modify Lines',
          submenu: [
            {
              label: 'Fillet Lines...',
              action: () => setLineModOpen('fillet'),
              disabled: lineModDisabled,
            },
            {
              label: 'Chamfer Lines...',
              action: () => setLineModOpen('chamfer'),
              disabled: lineModDisabled,
            },
            {
              label: 'Dogbone Corners...',
              action: () => setLineModOpen('dogbone'),
              disabled: lineModDisabled,
            },
            {
              label: 'Extend Lines to Meet',
              action: () => applyLineModification('extend'),
              disabled: lineModDisabled,
            },
          ],
        },
        { sep: true },
        {
          label: 'Move Exactly...',
          action: () => setMoveExactOpen(true),
          shortcut: 'Shift+M',
          disabled: selection.size === 0,
        },
        {
          label: 'Position Relative To...',
          action: () => setPosRelOpen(true),
          shortcut: 'Shift+P',
          disabled: selection.size === 0,
        },
        {
          label: 'Filter Selection...',
          action: () => setFilterOpen(true),
          disabled: selection.size === 0,
        },
        { sep: true },
        { label: 'Find', action: () => setFindOpen(true), shortcut: 'Ctrl+F' },
        { sep: true },
        { label: 'Properties...', action: () => openTrackViaProperties(), shortcut: 'E' },
        { label: 'Change Side / Flip', action: () => flipSelection(), shortcut: 'F' },
        { sep: true },
        { label: 'Edit Teardrops...', action: () => setTeardropsOpen(true) },
        { sep: true },
        { label: 'Global Deletions...', disabled: dis },
      ],
    },
    {
      label: 'View',
      items: [
        // `menubar_pcb_editor.cpp:234-236` adds zoomInCenter, zoomOutCenter and
        // zoomFitScreen. The first two carry NO DefaultHotkey on any platform
        // (`actions.cpp:769-779`), so these rows show no accelerator; the third
        // is WXK_HOME off macOS, and Home is the key this frame already handles.
        // The Ctrl++ / Ctrl+- / Ctrl+0 these printed were the macOS branch, and
        // none of the three was bound here at all.
        { label: 'Zoom In', action: () => zoomStep(1.3) },
        { label: 'Zoom Out', action: () => zoomStep(1 / 1.3) },
        { label: 'Zoom to Fit', action: zoomToFit, shortcut: 'Home' },
        {
          label: 'Redraw',
          action: () => {
            sceneDirtyRef.current = true;
            requestDraw();
          },
          shortcut: 'F5',
        },
        { sep: true },
        { label: 'Show Appearance Manager', action: () => onLeftToggle('showLayersManager') },
        { sep: true },
        { label: 'Flip Board View', disabled: dis },
        { label: '3D Viewer', disabled: dis },
      ],
    },
    {
      label: 'Place',
      items: [
        { label: 'Footprint...', disabled: dis },
        { label: 'Via', disabled: dis },
        { label: 'Zone', disabled: dis },
        { label: 'Text', disabled: dis },
        // `placeMenu->Add( PCB_ACTIONS::placePoint )`
        // (`menubar_pcb_editor.cpp:314`), which upstream files after Draw Table
        // and before Add Barcode — between Text and the Dimensions submenu in
        // the rows this abridged menu carries.
        {
          label: 'Place Point',
          disabled: dis,
          action: () => setActiveTool('placePoint'),
        },
        { sep: true },
        // `menubar_pcb_editor.cpp:317-326`: a "Draw Dimensions" submenu after a
        // separator, in this order — orthogonal first. This used to be a dead
        // `{ label: 'Dimension' }` row with no action and no accelerator, which
        // is *why* Ctrl+Shift+H did nothing: `ui/menu_hotkeys.ts` dispatches the
        // `shortcut` on a menu row, so a tool with no row has no key.
        {
          label: 'Draw Dimensions',
          icon: 'drawAlignedDimension',
          disabled: dis,
          submenu: [
            {
              label: 'Draw Orthogonal Dimensions',
              icon: 'drawOrthogonalDimension',
              // The only one of the five with a `.DefaultHotkey()`
              // (`pcb_actions.cpp:301`); the other four have none upstream
              // either, so none is invented for them here.
              shortcut: 'Ctrl+Shift+H',
              action: () => setActiveTool('drawOrthogonalDimension'),
            },
            {
              label: 'Draw Aligned Dimensions',
              icon: 'drawAlignedDimension',
              action: () => setActiveTool('drawAlignedDimension'),
            },
            {
              label: 'Draw Center Dimensions',
              icon: 'drawCenterDimension',
              action: () => setActiveTool('drawCenterDimension'),
            },
            {
              label: 'Draw Radial Dimensions',
              icon: 'drawRadialDimension',
              action: () => setActiveTool('drawRadialDimension'),
            },
            {
              label: 'Draw Leaders',
              icon: 'drawLeader',
              action: () => setActiveTool('drawLeader'),
            },
          ],
        },
        { sep: true },
        // `menubar_pcb_editor.cpp:333-336`, in this order: the two setters each
        // followed by their reset.
        {
          label: 'Drill/Place File Origin',
          disabled: dis,
          action: () => setActiveTool('drillOrigin'),
        },
        {
          label: 'Reset Drill Origin',
          disabled: dis,
          action: () => resetOrigin('aux_axis_origin'),
        },
        { label: 'Grid Origin', disabled: dis, action: () => setActiveTool('gridSetOrigin') },
        {
          label: 'Reset Grid Origin',
          disabled: dis,
          action: () => resetOrigin('grid_origin'),
        },
      ],
    },
    {
      label: 'Route',
      items: [
        // `PCB_ACTIONS::routeSingleTrack`, X (`pcb_actions.cpp`). Same gap as
        // Measure Tool above: a row with an accelerator and no action.
        {
          label: 'Single Track',
          disabled: dis,
          shortcut: 'X',
          action: () => setActiveTool('routeSingleTrack'),
        },
        { label: 'Differential Pair', disabled: dis },
        { sep: true },
        { label: 'Tune Length of a Single Track', disabled: dis },
        { label: 'Tune Length of a Differential Pair', disabled: dis },
        { label: 'Tune Skew of a Differential Pair', disabled: dis },
        { sep: true },
        {
          label: 'Interactive Router Settings...',
          action: () => setPnsSettingsOpen(true),
        },
      ],
    },
    {
      label: 'Inspect',
      items: [
        // `ACTIONS::measureTool`, Ctrl+Shift+M (`common/tool/actions.cpp:1238`).
        // The row printed the accelerator but carried no `action`, and
        // `ui/menu_hotkeys.ts` presses the *row* — so the key was decoration.
        // The tool itself was already wired to the canvas.
        {
          label: 'Measure Tool',
          disabled: dis,
          shortcut: 'Ctrl+Shift+M',
          action: () => setActiveTool('measureTool'),
        },
        { label: 'Board Statistics', disabled: dis },
        { sep: true },
        // Upstream names these by what is being resolved, and which one you
        // get depends on how many items are selected.
        {
          label: 'Clearance Resolution...',
          disabled: dis || selection.size !== 2,
          action: () => setInspectOpen(true),
        },
        {
          label: 'Constraints Resolution...',
          disabled: dis || selection.size !== 1,
          action: () => setInspectOpen(true),
        },
        { sep: true },
        { label: 'Design Rules Checker', disabled: dis },
      ],
    },
    {
      label: 'Tools',
      items: [
        {
          label: 'Update PCB from Schematic...',
          action: () => void openUpdatePcb(),
          disabled: !onShowSchematic,
          shortcut: 'F8',
        },
        { label: 'Update Footprints from Library...', disabled: dis },
        { sep: true },
        { label: 'Remove Unused Pads...', disabled: dis },
        { label: 'Cleanup Tracks & Vias...', disabled: dis },
      ],
    },
    {
      label: 'Preferences',
      // EDA_BASE_FRAME::ShowPreferences — one dialog for the whole application,
      // reachable from every frame's Preferences menu, not a per-editor one.
      items: [{ label: 'Preferences...', action: () => setPrefsOpen(true), shortcut: 'Ctrl+,' }],
    },
    standardHelpMenu({ showHotkeys: showHotkeyList, showAbout: () => setAboutOpen(true) }),
  ];

  // The chain above reads the tree through this ref; see `menusRef`.
  menusRef.current = menus;

  // ----- unit display ---------------------------------------------------------

  // MessageTextFromValue at the pcbnew IU scale (PCB_IU_PER_MM), which is the
  // long form: mm %.4f, mils %.2f, inches %.4f.
  unitsRef.current = unitLabel;
  const fmtCoord = (iu: number): string =>
    messageTextFromValue(iuToMM(iu), unitLabel, PCB_IU_PER_MM);

  // ----- PCB_PROPERTIES_PANEL -------------------------------------------------

  const propRows = useMemo<PcbPropRow[]>(
    () => (board ? pcbPropertiesFor(board, selection, { layerColor }) : []),
    [board, selection],
  );

  // `PROPERTIES_PANEL::rebuildProperties` captions a single selection with
  // `aSelection.Front()->GetFriendlyName()` — the item's TYPE.
  const propFriendlyName = useMemo<string | undefined>(() => {
    if (!board || selection.size !== 1) return undefined;
    return pcbItemFriendlyName(board, [...selection][0] as string);
  }, [board, selection]);
  const gridText = gridMsg(fmtCoord(gridIU));
  // TOP_AUX combo formatting (PCB_EDIT_FRAME::ComboBoxUnits): mm at %.3f,
  // mils at %.2f.
  const auxMM = (iu: number): string => iuToMM(iu).toFixed(3);
  const auxMils = (iu: number): string => ((iuToMM(iu) / 25.4) * 1000).toFixed(2);
  // Zoom selector value (EDA_DRAW_FRAME::OnUpdateSelectZoom): the preset the
  // zoom IS, else the live zoom as a custom entry. Upstream compares with `==`
  // and `isZoomSelectPreset` is that comparison, widened only by the float
  // round-trip our scale storage forces - see its doc. It was a 1% snap, which
  // reported a hand-dragged 2.21 as the 2.20 preset where KiCad shows 2.21.
  const zoomNow = zoomFactorForScale(scale, window.devicePixelRatio || 1);
  const zoomPreset = ZOOM_LIST.pcbnew.find((z) => isZoomSelectPreset(z, zoomNow));
  const zoomCustom = scale > 0 && zoomPreset === undefined ? Number(zoomNow.toFixed(2)) : null;
  const zoomSelValue: string | number = zoomPreset ?? zoomCustom ?? 'auto';
  // Field 6 (EDA_DRAW_FRAME::DisplayToolMsg, the "Current Tool" panel): the
  // friendly name of the active right-toolbar tool, blank in the selection tool.
  const toolMsg = PCB_TOOL_MSGS[activeTool] ?? '';
  // Field 7 (DisplayConstraintsMsg): the line-constraint hint shown while a
  // line/track drawing tool is active (COMMON_TOOLS line mode).
  const constraintMsg =
    routeRef.current || DRAW_SHAPE_TOOLS[activeTool]
      ? toggles.has('lineMode45')
        ? 'Constrain to H, V, 45'
        : toggles.has('lineMode90')
          ? 'Constrain to H, V'
          : ''
      : '';
  /**
   * `PCB_CONTROL::UpdateMessagePanel` (pcbnew/tools/pcb_control.cpp:2377) and
   * the `GetMsgPanelInfo` virtuals it dispatches to — all of them in
   * `pcbnew/src/msg_panel.ts`, because upstream they hang off the board items
   * and not off the frame. The footprint editor reaches the same module with
   * `frame: 'footprint_edit'`, which is how a footprint gets Library /
   * Footprint Name / Pads there and Board Side / Rotation / Status here off
   * one implementation.
   */
  const messagePanelItems: MsgPanelItem[] = useMemo(() => {
    if (!board)
      return [
        { upper: 'Pads', lower: '0' },
        { upper: 'Vias', lower: '0' },
        { upper: 'Track Segments', lower: '0' },
        { upper: 'Nets', lower: '0' },
        { upper: 'Unrouted', lower: '0' },
      ];

    return pcbMsgPanelInfo(
      {
        board,
        units: unitLabel,
        frame: 'pcb_edit',
        netClassOf,
        unconnectedCount: ratsnestEdges.length,
      },
      { ids: [...selection], describe: (id) => describeBoardItem(board, id) },
    );
  }, [board, ratsnestEdges.length, selection, netClassOf, unitLabel]);

  // Top-toolbar enablement. Save follows the dirty flag; the toolbar's Group /
  // Ungroup grey out per GROUP_TOOL::update, Group needs >= 2 selected items,
  // Ungroup needs a selected group. (Add / Remove to Group are right-click-only
  // in KiCad; they live in the grouping context menu, not the toolbar.)
  /**
   * `PCB_EDIT_FRAME::setupUIConditions` (`pcb_edit_frame.cpp:1036-1058`), the
   * four the top toolbar reads.
   *
   * Save is not one of them upstream — pcbnew declares
   * `ENABLE( SELECTION_CONDITIONS::ShowAlways )` — and it is not one of them
   * here either: it is added afterwards by `withSaveEnablement`, the one place
   * this app's autosave divergence from that is written down, so the Schematic
   * and PCB editors cannot drift apart on it again.
   */
  /**
   * `PCB_EDIT_FRAME::UpdateTitle` (pcb_edit_frame.cpp:2168-2194), built by the
   * shared rule rather than restated here — see `frame_title.ts`.
   */
  const pcbTitle = useMemo(
    () => pcbFrameTitle({ fileName, modified: dirty, readOnly }),
    [fileName, dirty, readOnly],
  );

  const topDisabled = useMemo(() => {
    const s = new Set<string>();
    let groupCount = 0;
    for (const id of selection) {
      if (parseBoardItemId(id)?.kind === 'group') groupCount++;
    }
    // ACTIONS::group = MoreThan( 1 ); ACTIONS::ungroup = HasTypes( groupTypes ).
    if (selection.size < 2) s.add('group');
    if (groupCount === 0) s.add('ungroup');
    // PCB_ACTIONS::lock = HasUnlockedItems; ::unlock = HasLockedItems. Both
    // false on an empty selection, so both grey out with nothing selected —
    // ours were lit unconditionally.
    if (board === null || !hasUnlockedItems(board, selection)) s.add('lock');
    if (board === null || !hasLockedItems(board, selection)) s.add('unlock');
    return s;
  }, [selection, board]);

  return (
    <div className="ze-app">
      <MenuBar
        menus={menus}
        leftSlot={<HomeLink onClick={onExit} />}
        title={
          <>
            <b>
              {pcbTitle.modified}
              {pcbTitle.document}
            </b>
            {pcbTitle.separator}
            {pcbTitle.frameName}
          </>
        }
      />
      <Toolbar
        entries={pcbTopBar}
        orientation="horizontal"
        disabledIds={withSaveEnablement(topDisabled, dirty)}
        onActivate={onTopAction}
        controls={{
          /**
           * `UpdateVariantSelectionCtrl` (`toolbars_pcb_editor.cpp:503`) fills
           * this from `BOARD::GetVariantNamesForUI()`, which is
           * `GetDefaultVariantName()` plus the board's own variant names,
           * sorted with the default pinned first (`board.cpp`, `string_utils.cpp:1864`).
           * `< Default >` is that name, spelled exactly (`string_utils.cpp:57`).
           *
           * Our board model carries no variant names, so the list is the
           * default alone — which is also what a stock KiCad board shows, and
           * what a live pcbnew on the ecc83 demo shows. Design variants are
           * not ported, so the control does not pretend to switch anything.
           */
          /* A wxChoice like the five on the bar below, so it takes the same
             GTK metrics — the border, the radius, the chevron and the face.
             As a bare `<select>` it was drawing the browser's widget: no
             border at all, a heavier chevron and a lighter fill.

             Only `< Default >`, because design variants are not modelled here
             yet; that is a missing *list*, not a missing control, so the
             control is present and shows the one variant every board has. */
          [PCB_CONTROL.currentVariant]: (
            <Combo
              title="Select the current variant to display and edit."
              value="default"
              options={[{ value: 'default', label: '< Default >' }]}
              onChange={() => {}}
            />
          ),
        }}
      />

      {/* TOP_AUX toolbar (toolbars_pcb_editor.cpp:365-386). A real
          ACTION_TOOLBAR upstream, docked at .Top().Layer(5) — not a strip of
          loose widgets, which is what this was: a bare flex div writing its own
          gap, padding, face and a 1px #333 bottom rule the shared toolbar rule
          suppresses between two stacked bars. Its three "buttons" read
          "auto" / "pair" / "locks" in the user-agent font because a bare
          <button> takes it. The five combos are AppendControl slots and are
          supplied through `controls`, as KiCad supplies them through
          RegisterCustomToolbarControlFactory. */}
      <Toolbar
        entries={pcbAuxBar}
        orientation="horizontal"
        onActivate={onTopAction}
        /* `PCB_EDIT_FRAME`'s check for `PCB_ACTIONS::autoTrackWidth`:
           `return GetDesignSettings().m_UseConnectedTrackWidth;`
           (pcb_edit_frame.cpp:1250). */
        toggled={autoTrackWidth ? AUTO_TRACK_WIDTH_ON : EMPTY_TOGGLED}
        controls={{
          /* Every one of these five was a bare `<select>`, so GTK's wxChoice
             metrics — the height, the padding, the chevron and its gutter, the
             font — were the *browser's* instead of ours, and the whole bar sat
             visibly narrower and shorter than pcbnew's. `Combo` is the widget
             that carries those tokens, and GerbView's identical TOP_AUX has
             used it all along; this bar was the one that never got it. */
          [PCB_CONTROL.trackWidth]: (
            <Combo
              title="Select the default width for new tracks. Note that this width can be overridden by the board minimum width, or by the width of an existing track if the 'Use Existing Track Width' feature is enabled."
              value={String(trackSel)}
              options={[
                { value: '0', label: 'Track: use netclass width' },
                ...trackWidthList.map((w, i) => ({
                  value: String(i + 1),
                  label: `Track: ${auxMM(w)} mm (${auxMils(w)} mils)`,
                })),
              ]}
              onChange={(v) => setTrackSel(Number(v))}
            />
          ),
          [PCB_CONTROL.viaDiameter]: (
            <Combo
              title="Via size"
              value={String(viaSel)}
              options={[
                { value: '0', label: 'Via: use netclass sizes' },
                ...viaSizeList.map((v, i) => ({
                  value: String(i + 1),
                  label:
                    v.drill > 0
                      ? `Via: ${auxMM(v.diameter)} / ${auxMM(v.drill)} mm (${auxMils(v.diameter)} / ${auxMils(v.drill)} mils)`
                      : `Via: ${auxMM(v.diameter)} mm (${auxMils(v.diameter)} mils)`,
                })),
              ]}
              onChange={(v) => setViaSel(Number(v))}
            />
          ),
          /* `PCB_LAYER_BOX_SELECTOR::Resync` (pcb_layer_box_selector.cpp:90-101):
             the layer's colour swatch, its name, and — through
             `AddHotkeyName( layername, action->GetHotKey(), IS_COMMENT )` — the
             hotkey of the action that switches to it, in parentheses. Only
             `layerTop` and `layerBottom` carry a default hotkey
             (pcb_actions.cpp:1873, :2129), so F.Cu and B.Cu read "(PgUp)" and
             "(PgDn)" and every inner layer reads as its bare name, which is
             `AddHotkeyName`'s own empty-keyname branch.

             The swatch is `Combo`'s, not a span of ours: its `swatch` option is
             modelled on this very call (see ComboOption). */
          [PCB_CONTROL.layerSelector]: (
            <Combo
              ariaLabel="Active layer"
              value={activeLayer}
              options={(board?.layers ?? []).map((l) => ({
                value: l.name,
                label: layerBoxLabel(layerName(l.name), l.name),
                swatch: layerColor(l.name),
              }))}
              onChange={(v) => setActiveLayer(v)}
            />
          ),
          /* GRID_MENU::BuildChoiceList: `"%s%s (%s)"`, both halves formatted by
             GRID::MessageText with aDisplayUnits true, so both carry the unit
             suffix EDA_UNIT_UTILS::GetText gives — which is "mils", plural.
             This wrote a singular "mil". */
          [PCB_CONTROL.gridSelect]: (
            <Combo
              title="Grid"
              value={String(gridIU)}
              options={[
                ...PCB_GRIDS.map((g) => ({
                  value: String(g),
                  label: `${fmtCoord(g)}${unitText(unitLabel)} (${
                    toggles.has('unitsMils')
                      ? `${auxMM(g)}${unitText('mm')}`
                      : `${auxMils(g)}${unitText('mils')}`
                  })`,
                })),
                ...(PCB_GRIDS.includes(gridIU)
                  ? []
                  : [
                      { value: String(gridIU), label: `${fmtCoord(gridIU)}${unitText(unitLabel)}` },
                    ]),
              ]}
              onChange={(v) => {
                setGridIUStored(Number(v));
                requestDraw();
              }}
            />
          ),
          [PCB_CONTROL.zoomSelect]: (
            <Combo
              title="Zoom"
              value={String(zoomSelValue)}
              options={[
                { value: 'auto', label: ZOOM_AUTO_LABEL },
                ...(zoomCustom !== null
                  ? [{ value: String(zoomCustom), label: zoomSelectLabel(zoomCustom) }]
                  : []),
                ...ZOOM_LIST.pcbnew.map((z) => ({
                  value: String(z),
                  label: zoomSelectLabel(z),
                })),
              ]}
              onChange={(v) => {
                if (v === 'auto') zoomToFit();
                else setZoomPreset(Number(v));
              }}
            />
          ),
          /* A wxCheckBox labelled "Override locks" (eda_draw_frame.cpp:240),
             not a button. Its command is not ported, so it is disabled.

             `.ze-check` is the shared wxCheckBox row — it centres the indicator
             against its label and sets the gap between them from
             --check-margin, both of which GTK does for a real one. Stating
             nothing, this was an inline `<input>` sitting on the text baseline,
             so the box rode visibly high beside the words and the gap was the
             browser's, not the theme's. */
          [PCB_CONTROL.overrideLocks]: (
            <label className="ze-check">
              <input type="checkbox" disabled />
              Override locks
            </label>
          ),
        }}
      />

      <div className="ze-body">
        {/* KiCad docks the Properties pane outermost-left (Layer 5), then the
            left options toolbar (Layer 3), then the canvas. */}
        {showProperties && (
          <>
            <div className="ze-leftdock" style={{ width: propWidth, minWidth: 240 }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">
                  <span>Properties</span>
                  {/* `.CloseButton( true )` on this pane and this pane alone —
                      Appearance and Selection Filter are both
                      `.CloseButton( false )` (pcb_edit_frame.cpp:356,365,387),
                      which is why only this caption gets the box. The same
                      `.ze-pane-close` eeschema's palettes use; closing a pane
                      is the state the View > Panels check item drives, so it
                      goes through the same toggle. */}
                  <button
                    type="button"
                    className="ze-pane-close"
                    onClick={() => onLeftToggle('showProperties')}
                    title="Close"
                  >
                    ⊠
                  </button>
                </div>
                <div className="ze-panel-body">
                  {/* The empty and multi-selection captions are PROPERTIES_PANEL's
                    own (properties_panel.cpp:196-210), so the panel renders them
                    rather than the frame swapping in a placeholder. */}
                  <PcbPropertiesPanel
                    rows={propRows}
                    selectionCount={selection.size}
                    friendlyName={propFriendlyName}
                    units={unitLabel}
                    onCommand={commitBoard}
                  />
                </div>
              </div>
            </div>
            {/* A SIBLING of the pane, not a child of it. wxAUI puts the sash
              BETWEEN two docks and gives it its own 5px - [px] pcbnew at
              y=1000, the pane ends at x=365 and the left toolbar starts at
              x=371. Inside `.ze-leftdock`, which is a column, a `width`-only
              rule gets a flex-basis of auto and no height, so the bar was
              there in the markup and nowhere on screen: the pane butted
              straight into the toolbar and the strip read 5px narrow.

              Clamps unchanged: KiCad's PCB_PROPERTIES_PANEL MinSize 240, and
              600 past which the canvas suffers. */}
            <DockSash edge="right" width={propWidth} min={240} max={600} onResize={setPropWidth} />
          </>
        )}

        <Toolbar
          entries={pcbLeftBar}
          app="pcbnew"
          orientation="vertical"
          side="left"
          toggled={leftToggles}
          disabledIds={leftDisabled}
          onActivate={onLeftToggle}
        />

        {/* `CreateInfoBar()` puts WX_INFOBAR at AUI layer 1: its own pane ABOVE
            the canvas, not something drawn inside it. That distinction is load
            bearing here, because this frame's <canvas> is `position: absolute;
            inset: 0` in the wrap - so a strip rendered as its sibling was
            painted over the moment the board had anything to draw, and only
            showed while the canvas was still empty. The column gives the bar
            its own height and leaves everything inside the wrap positioned
            against the wrap exactly as before. */}
        <div
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          {readOnlyNotice}
          <div
            className="ze-canvas-wrap"
            ref={wrapRef}
            style={{ position: 'relative', flex: 1, minHeight: 0 }}
          >
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                inset: 0,
                // A real cursor, always.
                //
                // This was `none` for every tool but the picker, on the grounds
                // that KiCad draws its own crosshair on the canvas, which it does
                // (the crosshair pass is below). But desktop KiCad draws that
                // crosshair *and* keeps the window's pointer: the crosshair marks
                // the snapped point, the pointer shows where the mouse is.
                //
                // With `none` there is no pointer at all, so the only thing on
                // screen that follows the mouse is painted by us, and it can move
                // no faster than a frame. A native cursor is composited by the
                // OS and tracks the mouse whatever the page is doing. That is the
                // whole of the difference between a cursor that feels attached to
                // your hand and one that feels dragged through mud, and no amount
                // of renderer work reaches it.
                //
                // Picker tools keep `crosshair`: KICURSOR::BULLSEYE resolves to
                // the stock wxCURSOR_BULLSEYE on GTK (IsStockCursorOk), the
                // system crosshair, which is what CSS `crosshair` is too.
                //
                // The two tools that DO name a cursor name KiCad's own art,
                // through the one CURSOR_STORE: `ZOOM_TOOL::Main` sets
                // KICURSOR::ZOOM_IN (`zoom_tool.cpp:65-69`) and
                // `PCB_VIEWER_TOOLS::MeasureTool` KICURSOR::MEASURE
                // (`pcb_viewer_tools.cpp:292`). This frame had neither and
                // showed the plain arrow for both.
                cursor: boardToolCursor(activeTool, { tableDragging }),
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
              onDoubleClick={onCanvasDoubleClick}
              onContextMenu={onCanvasContextMenu}
            />
            {/* The board, on the GPU (#481). Transparent, so the background, the
              grid and the drawing sheet painted on the canvas below show
              through — the grid's spacing adapts to the zoom, which is the one
              thing that genuinely cannot live in a retained buffer. Takes no
              events, like the overlay above it, so pointer captures still land
              on the canvas underneath. */}
            {
              <canvas
                ref={glCanvasRef}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              />
            }
            {/* Everything above the board: selection, ratsnest, umbilicals, the
              in-flight previews, DRC markers and the crosshair. Split out only
              because the GL layer has to go between it and the background;
              without the GL renderer `draw` paints all of it onto the one
              canvas as before. */}
            {
              <canvas
                ref={overCanvasRef}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              />
            }
            {ctxMenu && (
              <ContextMenu
                x={ctxMenu.x}
                y={ctxMenu.y}
                items={buildPcbContextMenu()}
                onClose={() => setCtxMenu(null)}
              />
            )}
            {enteredGroupName && (
              <div className="ze-group-editing" onMouseDown={(e) => e.stopPropagation()}>
                <span>
                  Editing group: <b>{enteredGroupName}</b>
                </span>
                <button type="button" onClick={() => setEnteredGroup(null)}>
                  Leave (Esc)
                </button>
              </div>
            )}
            {!board && !error && (
              <div className="ze-canvas-loading">
                <span className="ze-spinner" />
                <span>Loading board... (large boards can take a while)</span>
              </div>
            )}
            {error && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#ff8080',
                }}
              >
                Couldn’t open board: {error}
              </div>
            )}
          </div>
        </div>

        <Toolbar
          entries={pcbRightBar}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={setActiveTool}
        />

        {/* LayersManager + SelectionFilter dock: Right().Layer(4), outside the
            Right().Layer(3) toolbar (pcb_edit_frame.cpp AUI setup), i.e. at the
            window edge with the toolbar between it and the canvas. */}
        {showAppearance && (
          <>
            {/* The same sash GerbView's layers pane uses; wxAUI gives every dock
              one, so it belongs in ui/ rather than here. It is a sibling of
              the pane for the reason the Properties one is - see there - and
              it comes FIRST because this dock's canvas-facing edge is its
              left. The clamps are unchanged: MinSize 200, and 500 past which
              the canvas suffers. */}
            <DockSash edge="left" width={appWidth} min={200} max={500} onResize={setAppWidth} />
            <div className="ze-rightdock" style={{ width: appWidth }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">Appearance</div>
                {/* APPEARANCE_CONTROLS. The identical widget the footprint editor
                  builds; everything below is data this frame supplies. */}
                <AppearanceControls
                  tab={tab}
                  onTab={setTab}
                  layerRows={layerRows}
                  layerName={layerName}
                  layerColor={layerColor}
                  activeLayer={activeLayer}
                  onActiveLayer={setActiveLayer}
                  visibleLayers={visible}
                  onToggleLayer={toggleLayer}
                  onLayerContextMenu={(x, y) => setLayerMenu({ x, y })}
                  objects={objects}
                  onToggleObject={(key) => setObjects((p) => toggleObject(p, key))}
                  objectColor={(key) => PCB_OBJECT_COLORS[key]}
                  opacity={opacity}
                  onOpacity={(key, value) => setOpacity((p) => ({ ...p, [key]: value }))}
                  contrast={contrast}
                  onContrast={setContrast}
                  flipBoard={flipView}
                  onFlipBoard={toggleFlip}
                  layerOptionsOpen={layerOptsOpen}
                  onLayerOptionsOpen={setLayerOptsOpen}
                  nets={{
                    nets: netRows,
                    onNetColor: setNetColor,
                    onNetVisibility: (code) =>
                      setHiddenNets((p) => {
                        const next = new Set(p);
                        if (next.has(code)) next.delete(code);
                        else next.add(code);
                        return next;
                      }),
                    netclasses: netclassRows,
                    onNetclassColor: (cls, picked) =>
                      setClassColors((p) => new Map(p).set(cls, toCssColor(picked, ', '))),
                    onNetclassVisibility: (cls) =>
                      setHiddenClasses((p) => {
                        const next = new Set(p);
                        if (next.has(cls)) next.delete(cls);
                        else next.add(cls);
                        return next;
                      }),
                    onConfigureNetclasses: () => {
                      setBoardSetupPage('netclasses');
                      setBoardSetupOpen(true);
                    },
                    netColorMode,
                    onNetColorMode: setNetColorMode,
                    ratsnestMode,
                    onRatsnestMode: setRatsnestMode,
                    optionsOpen: netOptsOpen,
                    onOptionsOpen: setNetOptsOpen,
                  }}
                  presetItems={presetItems}
                  preset={preset}
                  onPreset={onPresetChoice}
                  deletePresetDisabled={userPresets.length === 0}
                  viewportItems={viewportItems}
                  viewport={viewportSel}
                  onViewport={onViewportChoice}
                  deleteViewportDisabled={viewports.length === 0}
                />
              </div>

              {/* `.fixed` is `dock_proportion = 0` —
                `m_auimgr.GetPane( "SelectionFilter" ).dock_proportion = 0`
                (pcbnew/pcb_edit_frame.cpp:422). A docked pane grows by default;
                this is the pane that declares it does not. */}
              <div className="ze-panel fixed">
                <div className="ze-panel-header">Selection Filter</div>
                <div className="ze-panel-body">
                  {/* PANEL_SELECTION_FILTER — the same widget the footprint
                    editor docks. Right-clicking a category pops "Only <label>". */}
                  <SelectionFilterPanel
                    filter={selFilter}
                    onChange={setSelFilter}
                    onContextMenu={(x, y, item) => setFilterMenu({ x, y, item })}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* EDA_3D_VIEWER_FRAME. Upstream this is a sibling top-level window
          (KIWAY_PLAYER parented to the PCB frame); in one browser tab it is a
          full-viewport overlay, but it carries the frame's own chrome: menu
          bar, the single TOP_MAIN toolbar (3d-viewer has no side toolbars) and
          the 5-pane status bar. */}
      {show3D && board && (
        <Viewer3DFrame
          board={board}
          projectFiles={projectFiles}
          // BOARD_ADAPTER reads the stackup off the board it is given; ours is
          // held by the editor, so it is handed down. The Color column on the
          // Physical Stackup page is what these paint.
          stackup={boardSetup.physicalStackup}
          boardFinish={boardSetup.boardFinish}
          backLabel="← PCB Editor"
          imageBaseName={projectName || fileName.replace(/\.kicad_pcb$/i, '') || 'board'}
          onClose={() => setShow3D(false)}
        />
      )}

      {/* Disambiguation menu (SELECTION_TOOL::doSelectionMenu): which of several
          overlapping items to select.

          Same rows as every other menu in the app, because upstream's is an
          ordinary ACTION_MENU: the first nine are numbered `&n  <description>`
          with the number repeated as the accelerator, then a separator and
          "Select &All\tA". No title — pcbnew never sets `m_MenuTitle`, so the
          "Clarify Selection" caption we had was ours, not KiCad's. Pointing at
          a row brightens what it refers to on the board. */}
      {disambig && board && (
        <ContextMenu
          x={disambig.x}
          y={disambig.y}
          onClose={() => {
            setDisambigHover(null);
            setDisambig(null);
          }}
          items={[
            ...disambig.ids.map((id, i) => ({
              // Past nine, upstream drops the number and the accelerator: there
              // are only nine digit keys.
              label:
                i < 9 ? `${i + 1}  ${describeBoardItem(board, id)}` : describeBoardItem(board, id),
              ...(i < 9 ? { mnemonic: String(i + 1), shortcut: String(i + 1) } : {}),
              onHover: (over: boolean) => setDisambigHover(over ? new Set([id]) : null),
              action: () => applySelect(id, disambig.additive),
            })),
            { sep: true },
            {
              label: 'Select All',
              mnemonic: 'A',
              shortcut: 'A',
              onHover: (over: boolean) => setDisambigHover(over ? new Set(disambig.ids) : null),
              action: () =>
                setSelection((prev) => {
                  const next = new Set(disambig.additive ? prev : []);
                  for (const id of disambig.ids) next.add(id);
                  return next;
                }),
            },
          ]}
        />
      )}

      {/* PANEL_SELECTION_FILTER::onRightClick's one-item wxMenu. */}
      {filterMenu && (
        <SelectionFilterOnlyMenu
          at={filterMenu}
          onOnly={(key) => setSelFilter(new Set([key]))}
          onClose={() => setFilterMenu(null)}
        />
      )}

      {/* Layer right-click menu (APPEARANCE_CONTROLS::rightClickHandler /
          onLayerContextMenu), acting on the active layer like upstream. */}
      {layerMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setLayerMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setLayerMenu(null);
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(layerMenu.x, window.innerWidth - 260),
              top: Math.min(layerMenu.y, window.innerHeight - 320),
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 230,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {layerMenuItems().map((group, gi, arr) => (
              <div key={`g${gi}`}>
                {group.map((item) => (
                  <div
                    key={item.label}
                    className="ze-tree-item"
                    style={{ padding: '3px 12px', cursor: 'default' }}
                    onClick={() => {
                      item.run();
                      setLayerMenu(null);
                    }}
                  >
                    {item.label}
                  </div>
                ))}
                {gi < arr.length - 1 && (
                  <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '4px 0' }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* "Delete preset/viewport..." chooser (EDA_LIST_DIALOG stand-in). */}
      {deleteChooser && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setDeleteChooser(null)}
          />
          <div
            style={{
              position: 'fixed',
              right: 24,
              bottom: 120,
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 180,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '2px 12px 4px', opacity: 0.6 }}>
              Delete {deleteChooser === 'presets' ? 'preset' : 'viewport'}
            </div>
            {(deleteChooser === 'presets' ? userPresets : viewports).map((p) => (
              <div
                key={p.name}
                className="ze-tree-item"
                style={{ padding: '3px 12px', cursor: 'default' }}
                onClick={() => {
                  if (deleteChooser === 'presets') {
                    setUserPresets((u) => u.filter((x) => x.name !== p.name));
                  } else {
                    setViewports((v) => v.filter((x) => x.name !== p.name));
                    if (viewportSel === p.name) setViewportSel('---');
                  }
                  setDeleteChooser(null);
                }}
              >
                {p.name}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Barcode properties. `DRAWING_TOOL::DrawBarcode` opens this before
          placing (`drawing_tool.cpp:1534-1541`); a double-click on an existing
          barcode opens it through `EDIT_TOOL::Properties`. */}
      {barcodeDialog &&
        (() => {
          const bc = barcodeUnderEdit();
          if (!bc) return null;
          return (
            <DialogBarcodeProperties
              barcode={bc}
              initial={barcodeValues(bc)}
              layers={board?.layers.map((l) => l.name) ?? []}
              layerColor={layerColor}
              background={PCB_BACKGROUND}
              onClose={() => setBarcodeDialog(null)}
              onApply={(v) => {
                const brd = boardRef.current;
                const dlg = barcodeDialog;
                setBarcodeDialog(null);
                if (!brd || !dlg) return;
                const next = applyBarcodeValues(bc, v);
                if (dlg.index !== undefined) {
                  commitBoard(setBoardBarcode(brd, dlg.index, next));
                  return;
                }
                // `m_toolMgr->RunAction<EDA_ITEM*>( ACTIONS::selectItem, barcode )`
                // (`drawing_tool.cpp:1558`): the new barcode is left selected.
                const added = addBoardBarcode(brd, next);
                commitBoard(added.board);
                setSelection(new Set([added.id]));
              }}
            />
          );
        })()}

      {/* "Add Text" properties dialog (DRAWING_TOOL::PlaceText opens the text
          properties dialog before placing). */}
      {textDialog && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.3)' }}
            onMouseDown={() => {
              setTextDialog(null);
              setTextDraft('');
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '40%',
              transform: 'translate(-50%, -50%)',
              zIndex: 61,
              background: '#2a2c30',
              border: '1px solid #444',
              borderRadius: 4,
              width: 360,
              padding: 12,
              fontSize: 13,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Text Properties</div>
            <textarea
              // biome-ignore lint/a11y/noAutofocus: focus the just-opened dialog's input
              autoFocus
              rows={3}
              value={textDraft}
              placeholder="Text"
              style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setTextDialog(null);
                  setTextDraft('');
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  commitPlacedText();
                }
              }}
            />
            <div style={{ marginTop: 4 }} className="ze-muted">
              Layer: {layerName(activeLayer)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button
                onClick={() => {
                  setTextDialog(null);
                  setTextDraft('');
                }}
              >
                Cancel
              </button>
              <button onClick={commitPlacedText}>OK</button>
            </div>
          </div>
        </>
      )}

      {/* "Copper Zone Properties" dialog: the zone tool opens it on the first
          click (DRAWING_TOOL::DrawZone), then the outline is drawn. */}
      {zoneDialog && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.3)' }}
            onMouseDown={() => setZoneDialog(null)}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '40%',
              transform: 'translate(-50%, -50%)',
              zIndex: 61,
              background: '#2a2c30',
              border: '1px solid #444',
              borderRadius: 4,
              width: 340,
              padding: 12,
              fontSize: 13,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Copper Zone Properties</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8 }}>
              <label htmlFor="ze-zone-layer">Layer:</label>
              <select
                id="ze-zone-layer"
                value={zoneLayer}
                onChange={(e) => setZoneLayer(e.target.value)}
              >
                {copperLayers.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <label htmlFor="ze-zone-net">Net:</label>
              <select
                id="ze-zone-net"
                value={zoneNet}
                onChange={(e) => setZoneNet(Number(e.target.value))}
              >
                <option value={0}>&lt;no net&gt;</option>
                {nets.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name || `(unnamed ${code})`}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setZoneDialog(null)}>Cancel</button>
              <button
                onClick={() => {
                  if (zoneDialog) {
                    zoneRef.current = { net: zoneNet, layer: zoneLayer, pts: [zoneDialog] };
                    if (zoneLayer !== activeLayer) setActiveLayer(zoneLayer);
                  }
                  setZoneDialog(null);
                  requestDraw();
                }}
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      {pageDlgOpen && board && (
        <DialogPageSettings
          // BOARD_EDITOR_CONTROL::PageSettings constructs the base class, not
          // eeschema's subclass (board_editor_control.cpp:530-532), so the
          // sheet tallies and every "Export to other sheets" checkbox stay
          // Show(false) (dialog_page_settings.cpp:169-186). It is also the one
          // caller passing MAX_PAGE_SIZE_PCBNEW_MILS rather than eeschema's.
          frame="pcbnew"
          // `m_customSizeX( aParent, … )` over the board frame — a fresh
          // pcbnew is in MILLIMETRES (app_settings.cpp:228-238).
          units={unitLabel}
          value={pageSettingsValue(board.paper ?? 'A4', {
            title: board.titleBlock?.title ?? '',
            date: board.titleBlock?.date ?? '',
            rev: board.titleBlock?.rev ?? '',
            company: board.titleBlock?.company ?? '',
            comments: board.titleBlock?.comments ?? [],
          })}
          onOk={(next) => {
            const brd = boardRef.current;
            if (brd)
              commitBoard(
                setBoardPageSettings(brd, {
                  paper: toPaperToken(next),
                  title: next.title,
                  date: next.date,
                  rev: next.rev,
                  company: next.company,
                  comments: next.comments,
                }),
              );
            setPageDlgOpen(false);
          }}
          onCancel={() => setPageDlgOpen(false)}
        />
      )}
      {printDlgOpen && board && (
        <DialogPcbPrint
          board={board}
          visibleLayers={visible}
          drawOpts={drawOpts}
          onClose={() => setPrintDlgOpen(false)}
        />
      )}
      {plotDlgOpen && board && (
        <DialogPcbPlot
          board={board}
          visibleLayers={visible}
          // The Solder Mask/Paste page, in IU. The ratio is a fraction upstream
          // and a percent on the panel, hence the /100.
          maskPaste={{
            solderMaskExpansion: Math.round(boardSetup.maskPaste.maskExpansionMM * MM),
            solderPasteMargin: Math.round(boardSetup.maskPaste.pasteClearanceMM * MM),
            solderPasteMarginRatio: boardSetup.maskPaste.pasteRelativePct / 100,
          }}
          projectFolders={projectFolders}
          onOutputFile={onOutputFile}
          onRunDrc={() => {
            // DIALOG_PLOT's Run DRC... hands off to the DRC dialog.
            setPlotDlgOpen(false);
            setDrcOpen(true);
          }}
          onClose={() => setPlotDlgOpen(false)}
        />
      )}
      {/* Update PCB from Schematic: the netlist fetch, then DIALOG_UPDATE_PCB.
          A failed fetch shows the same message upstream puts in a
          DisplayErrorMessage box (a missing schematic, or one not annotated). */}
      {pasteSpecialOpen && (
        <DialogPasteSpecial
          /* `PASTE_MODE mode = PASTE_MODE::KEEP_ANNOTATIONS` before the dialog
             is shown (pcb_control.cpp:1208), so pcbnew always opens on "keep"
             — where the schematic never does. */
          mode="KEEP_ANNOTATIONS"
          /* `const wxString defaultRef = wxT( "REF**" )` (:1211), which is the
             string the third row's tooltip names. */
          defaultRef="REF**"
          onOk={(chosen: PasteSpecialMode, clearNets: boolean) => {
            setPasteSpecialOpen(false);
            const mode: PasteMode =
              chosen === 'UNIQUE_ANNOTATIONS'
                ? 'unique_annotations'
                : chosen === 'KEEP_ANNOTATIONS'
                  ? 'keep_annotations'
                  : 'remove_annotations';
            void navigator.clipboard?.readText().then((text) => pasteText(text, mode, clearNets));
          }}
          onCancel={() => setPasteSpecialOpen(false)}
        />
      )}
      {aboutOpen && <AboutDialog title={ABOUT_TITLES.pcb} onClose={() => setAboutOpen(false)} />}
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}
      {updatePcbBusy && (
        <div className="ze-modal-backdrop ze-loading-backdrop">
          <div className="ze-loading-card">
            <span className="ze-spinner" />
            Loading footprint libraries...
          </div>
        </div>
      )}
      {updatePcbError && (
        <div className="ze-modal-backdrop" onMouseDown={() => setUpdatePcbError(null)}>
          <div className="ze-modal ze-message-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Update PCB from Schematic
              <span className="x" onClick={() => setUpdatePcbError(null)}>
                ✕
              </span>
            </div>
            <div className="ze-modal-body ze-message-body">
              <p>{updatePcbError.message}</p>
              {updatePcbError.details && <pre>{updatePcbError.details}</pre>}
            </div>
            <div className="ze-modal-footer">
              <span style={{ flex: 1 }} />
              <button type="button" className="primary" onClick={() => setUpdatePcbError(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {updatePcb && (
        <DialogUpdatePcb
          onPerformUpdate={performNetlistUpdate}
          onClose={() => setUpdatePcb(null)}
        />
      )}
      {textPropsIndex !== null && board?.texts[textPropsIndex] && (
        <DialogTextProperties
          initial={collectTextValues(board.texts[textPropsIndex]!)}
          layers={board.layers.map((l) => l.name)}
          onApply={applyTextEdit}
          onClose={() => setTextPropsIndex(null)}
        />
      )}
      {shapePropsIndex !== null && board?.shapes[shapePropsIndex] && (
        <DialogShapeProperties
          initial={collectShapeValues(board.shapes[shapePropsIndex]!)}
          kind={board.shapes[shapePropsIndex]!.kind}
          layers={board.layers.map((l) => l.name)}
          onApply={applyShapeEdit}
          onClose={() => setShapePropsIndex(null)}
        />
      )}
      {pendingTable && (
        <DialogTableProperties<TableValues>
          initial={collectTableValues({ ...pendingTable, source: EMPTY_SLIST })}
          iuScale={pcbIUScale}
          isNew
          header={tableDialogHeader}
          onCancel={() => setPendingTable(null)}
          onOk={(values) => {
            const brd = boardRef.current;
            const tbl = pendingTable;
            setPendingTable(null);
            if (!brd || !tbl) return;
            const { board: withTable, id } = addBoardTable(brd, tbl);
            const index = parseBoardItemId(id)?.index ?? 0;
            // One commit, so placing a table is a single undo step.
            commitBoard(applyTableValues(withTable, index, values));
          }}
        />
      )}
      {pendingTextBox && (
        <DialogTextBoxProperties
          initial={collectTextBoxValues({ ...pendingTextBox, source: EMPTY_SLIST })}
          layers={board?.layers.map((l) => l.name) ?? []}
          layerColor={layerColor}
          placing
          onApply={(values) => {
            const brd = boardRef.current;
            const box = pendingTextBox;
            setPendingTextBox(null);
            if (!brd || !box) return;
            const { board: withBox, id } = addBoardTextBox(brd, box);
            const index = parseBoardItemId(id)?.index ?? 0;
            // Apply what was typed to the box just added, then commit once so
            // the placement is a single undo step.
            commitBoard(applyTextBoxValues(withBox, index, values));
          }}
          onClose={() => setPendingTextBox(null)}
        />
      )}
      {tablePropsIndex !== null && board?.tables[tablePropsIndex] && (
        <DialogTableProperties<TableValues>
          initial={collectTableValues(board.tables[tablePropsIndex]!)}
          iuScale={pcbIUScale}
          columnWidths={board.tables[tablePropsIndex]!.columnWidths}
          header={tableDialogHeader}
          onOk={applyTableEdit}
          onCancel={() => setTablePropsIndex(null)}
        />
      )}
      {textBoxPropsIndex !== null && board?.textBoxes[textBoxPropsIndex] && (
        <DialogTextBoxProperties
          initial={collectTextBoxValues(board.textBoxes[textBoxPropsIndex]!)}
          layers={board.layers.map((l) => l.name)}
          layerColor={layerColor}
          onApply={applyTextBoxEdit}
          onClose={() => setTextBoxPropsIndex(null)}
        />
      )}
      {imagePropsIndex !== null && board?.images[imagePropsIndex] && (
        <DialogReferenceImageProperties
          image={board.images[imagePropsIndex]!}
          initial={collectImageValues(board.images[imagePropsIndex]!)}
          layers={board.layers.map((l) => l.name)}
          onApply={applyImageEdit}
          onClose={() => setImagePropsIndex(null)}
        />
      )}
      {dimensionPropsIndex !== null && board?.dimensions[dimensionPropsIndex] && (
        <DialogDimensionProperties
          initial={collectDimensionValues(board.dimensions[dimensionPropsIndex]!)}
          kind={board.dimensions[dimensionPropsIndex]!.kind}
          layers={board.layers.map((l) => l.name)}
          onApply={applyDimensionEdit}
          onClose={() => setDimensionPropsIndex(null)}
        />
      )}
      {padPropsRef && board?.footprints[padPropsRef.footprint]?.pads[padPropsRef.pad] && (
        <DialogPadProperties
          initial={collectPadValues(
            board.footprints[padPropsRef.footprint]!.pads[padPropsRef.pad]!,
          )}
          nets={board.nets}
          layers={board.layers.map((l) => l.name)}
          onApply={applyPadEdit}
          onClose={() => setPadPropsRef(null)}
        />
      )}
      {fpPropsIndex !== null && board?.footprints[fpPropsIndex] && (
        <DialogFootprintProperties
          initial={collectFootprintValues(board.footprints[fpPropsIndex]!)}
          libId={board.footprints[fpPropsIndex]!.lib}
          onApply={applyFootprintEdit}
          onClose={() => setFpPropsIndex(null)}
        />
      )}
      {zonePropsIndex !== null && board?.zones[zonePropsIndex] && (
        <DialogCopperZones
          initial={collectZoneValues(board.zones[zonePropsIndex]!)}
          nets={board.nets}
          layers={board.layers.filter((l) => /\.Cu$/.test(l.name)).map((l) => l.name)}
          onApply={applyZoneEdit}
          onClose={() => setZonePropsIndex(null)}
        />
      )}
      {trackViaOpen && board && (
        <DialogTrackViaProperties
          selection={trackViaSelection(board, selection)}
          nets={board.nets}
          layers={board.layers.filter((l) => /\.Cu$/.test(l.name)).map((l) => l.name)}
          trackWidths={trackWidthList}
          viaSizes={viaSizeList}
          onApply={applyTrackViaEdit}
          onClose={() => setTrackViaOpen(false)}
        />
      )}
      {moveExactOpen && board && (
        <DialogMoveExact
          bbox={boardSelectionBBox(board, selection)}
          defaultAnchor={defaultRotationAnchor(selection.size)}
          onApply={applyMoveExact}
          onClose={() => setMoveExactOpen(false)}
        />
      )}
      {pickingRefShown && (
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 12px',
            fontSize: 12,
            background: 'var(--chrome-bg)',
            border: '1px solid var(--chrome-border)',
            borderRadius: 6,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            zIndex: 41,
          }}
        >
          Click an item to use as the reference.{' '}
          <button
            type="button"
            onClick={() => {
              pickingRefItem.current = false;
              setPickingRefShown(false);
              setPosRelOpen(true);
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {arrayOpen && board && (
        <DialogCreateArray
          initial={arraySettings}
          onApply={applyArray}
          onClose={() => setArrayOpen(false)}
        />
      )}
      {pnsSettingsOpen && <DialogPnsSettings onClose={() => setPnsSettingsOpen(false)} />}
      {outsetOpen && board && (
        <DialogOutsetItems
          layers={board.layers.map((l) => l.name)}
          initial={outsetSettings}
          onApply={applyOutset}
          onClose={() => setOutsetOpen(false)}
        />
      )}
      {lineModOpen && board && (
        <DialogLineModification
          title={
            lineModOpen === 'fillet'
              ? 'Fillet Lines'
              : lineModOpen === 'chamfer'
                ? 'Chamfer Lines'
                : 'Dogbone Corners'
          }
          label={lineModOpen === 'chamfer' ? 'Set-back:' : 'Radius:'}
          value={
            lineModOpen === 'fillet'
              ? filletRadius
              : lineModOpen === 'chamfer'
                ? chamferSetback
                : dogboneRadius
          }
          onApply={(v: number) => {
            if (lineModOpen === 'fillet') setFilletRadius(v);
            else if (lineModOpen === 'chamfer') setChamferSetback(v);
            else setDogboneRadius(v);
            applyLineModification(lineModOpen, v);
          }}
          onClose={() => setLineModOpen(null)}
        />
      )}
      {posRelOpen && board && (
        <DialogPositionRelative
          gridOrigin={boardGridOrigin(board)}
          userOrigin={{ x: 0, y: 0 }}
          referenceItem={
            posRelRef
              ? {
                  label: posRelRef.label,
                  at: itemAnchorPoint(board, posRelRef.id) ?? { x: 0, y: 0 },
                }
              : null
          }
          onPick={() => {
            // Hide the dialog while the canvas is armed: it is an overlay, and
            // the item wanted may well be underneath it.
            pickingRefItem.current = true;
            setPickingRefShown(true);
            setPosRelOpen(false);
          }}
          onApply={applyPositionRelative}
          onClose={() => setPosRelOpen(false)}
        />
      )}
      {filterOpen && board && (
        <DialogFilterSelection
          filter={filterOpts}
          onChange={setFilterOpts}
          matchCount={filterSelection(board, selection, filterOpts).length}
          onApply={() => {
            setSelection(new Set(filterSelection(board, selection, filterOpts)));
            setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {inspectOpen && board && (
        <DialogInspectConstraints
          title={selection.size === 2 ? 'Clearance Resolution' : 'Constraints Resolution'}
          sections={inspectSections}
          hint={
            selection.size === 0
              ? 'Select an item to see what constraints apply to it, or two items to see how their clearance resolves.'
              : undefined
          }
          onClose={() => setInspectOpen(false)}
        />
      )}
      {teardropsOpen && board && (
        <DialogGlobalEditTeardrops
          nets={board.nets}
          layers={board.layers.filter((l) => /\.Cu$/.test(l.name)).map((l) => l.name)}
          netclasses={boardSetup.netClasses.classes.map((c) => c.name)}
          hasSelection={selection.size > 0}
          initialScope={{
            vias: boardSetup.teardrops.targets.vias,
            pthPads: boardSetup.teardrops.targets.pthPads,
            smdPads: boardSetup.teardrops.targets.smdPads,
            trackToTrack: boardSetup.teardrops.targets.trackToTrack,
            roundPadsOnly: boardSetup.teardrops.targets.roundShapesOnly,
          }}
          onEditDefaults={() => {
            setTeardropsOpen(false);
            setBoardSetupPage(undefined);
            setBoardSetupOpen(true);
          }}
          onApply={applyTeardropEdit}
          onClose={() => setTeardropsOpen(false)}
        />
      )}
      {drcOpen && (
        <DialogDrc
          rootRef={drcDialogRef}
          results={drcResults}
          severities={boardSetup.drcSeverities}
          selected={drcSelected}
          run={() => {
            const brd = boardRef.current;
            if (!brd) {
              setDrcResults([]);
              setDrcSelected(null);
              return;
            }
            const c = boardSetup.constraints;
            const all = runDrc(brd, {
              minClearance: Math.round(c.minClearanceMM * MM),
              minTrackWidth: Math.round(c.minTrackMM * MM),
              minViaDiameter: Math.round(c.minViaMM * MM),
              minViaAnnulus: Math.round(c.minAnnularMM * MM),
              minThroughHole: Math.round(c.minThroughHoleMM * MM),
              minHoleToHole: Math.round(c.minHoleToHoleMM * MM),
              minCopperToEdge: Math.round(c.copperToEdgeMM * MM),
              minResolvedSpokes: c.minThermalSpokes,
              minSilkClearance: Math.round(c.silkClearanceMM * MM),
              minConnectionWidth: Math.round(c.minConnectionMM * MM),
              clearanceOf: (net) =>
                netclassInfo.classClearance.get(netClassOf.get(net) ?? 'Default') ?? 0,
              // Board Setup's Custom Rules page finally reaches DRC: a matching
              // .kicad_dru rule overrides the board default and the netclass.
              customRules: parseDrcRules(boardSetup.customRules.text),
              netClassesOf: (net) =>
                netclassesForNet(brd.nets.get(net) ?? '', boardSetup.netClasses.assignments),
            });
            // Ignored severities never make markers (RunDRC's severity gate).
            setDrcResults(all.filter((vio) => boardSetup.drcSeverities[vio.code] !== 'ignore'));
            setDrcSelected(null);
          }}
          onSelect={(i, pos) => {
            setDrcSelected(i);
            drcFocusOn(pos);
          }}
          onDeleteMarker={(i) => {
            setDrcResults((r) => (r ? r.filter((_, j) => j !== i) : r));
            setDrcSelected(null);
          }}
          onDeleteAll={() => {
            setDrcResults([]);
            setDrcSelected(null);
          }}
          onClose={() => setDrcOpen(false)}
        />
      )}
      {boardSetupOpen && (
        <DialogBoardSetup
          value={boardSetup}
          initialPage={boardSetupPage}
          onOk={(next) => {
            commitBoardSetup(next);
            setBoardSetupOpen(false);
          }}
          onClose={() => setBoardSetupOpen(false)}
        />
      )}
      {findOpen && (
        <DialogPcbFind
          query={findQuery}
          options={findOpts}
          onQuery={setFindQuery}
          onOptions={setFindOpts}
          onFind={runFind}
          onClose={() => setFindOpen(false)}
          status={findStatus}
        />
      )}

      {/* EDA_DRAW_FRAME hosts a message panel above pcbnew's 8-field status bar. */}
      <MsgPanel items={messagePanelItems} testId="pcb-message-panel" />

      {/* pcbnew's 8-field KISTATUSBAR — the pane order and widths are
          KiStatusBar's, shared with every other draw frame. */}
      <KiStatusBar
        testIds={{
          message: 'pcb-status-msg',
          coords: 'pcb-absolute-coords',
          deltas: 'pcb-relative-coords',
          tool: 'pcb-tool-msg',
          constraint: 'pcb-constraint-msg',
        }}
        fields={{
          zoom: zoomMsg(zoomFactorForScale(scale, window.devicePixelRatio || 1)),
          coords: <span ref={statusReadout.coordsRef} />,
          deltas: <span ref={statusReadout.deltasRef} />,
          grid: gridText,
          units: unitsMsg(unitLabel),
          tool: toolMsg,
          constraint: constraintMsg,
        }}
      />
    </div>
  );
}

/** One-line label for a board item, the disambiguation menu row text
 *  (KiCad's EDA_ITEM::GetItemDescription). */
function describeBoardItem(board: Board, id: string): string {
  const r = parseBoardItemId(id);
  if (!r) return id;
  const net = (c: number): string => board.nets.get(c) || `net ${c}`;
  switch (r.kind) {
    case 'track': {
      const t = board.tracks[r.index];
      return t ? `Track ${t.layer} · ${net(t.net)}` : 'Track';
    }
    case 'arc': {
      const a = board.arcs[r.index];
      return a ? `Arc ${a.layer} · ${net(a.net)}` : 'Arc';
    }
    case 'via': {
      const v = board.vias[r.index];
      return v ? `Via · ${net(v.net)}` : 'Via';
    }
    case 'footprint': {
      const f = board.footprints[r.index];
      return f ? `Footprint ${f.reference || f.lib}` : 'Footprint';
    }
    case 'zone': {
      // ZONE::GetItemDescription — net, layers *and* priority. Three pours of
      // the same net stacked through a board are one menu row repeated three
      // times without the last two.
      const z = board.zones[r.index];
      return z ? zoneItemDescription(board, z) : 'Zone';
    }
    case 'shape': {
      const s = board.shapes[r.index];
      return s ? `Graphic (${s.kind}) · ${s.layer}` : 'Graphic';
    }
    case 'text': {
      const t = board.texts[r.index];
      return t ? `Text "${t.text}"` : 'Text';
    }
    case 'fptext': {
      const f = board.footprints[r.index];
      const t = f?.texts[r.sub ?? 0];
      if (!t) return 'Text';
      const label = t.kind === 'reference' ? 'Reference' : t.kind === 'value' ? 'Value' : 'Text';
      return `${label} "${t.text}"${f?.reference ? ` of ${f.reference}` : ''}`;
    }
    case 'pad': {
      const f = board.footprints[r.index];
      const p = f?.pads[r.sub ?? 0];
      if (!p) return 'Pad';
      return `Pad ${p.number}${f?.reference ? ` of ${f.reference}` : ''} · ${net(p.net ?? 0)}`;
    }
    case 'textbox': {
      // PCB_TEXTBOX::GetItemDescription: "PCB text box '<text>' on <layer>",
      // lowercase as upstream spells it.
      const t = board.textBoxes[r.index];
      return t ? `PCB text box '${t.text}' on ${t.layer}` : 'PCB text box';
    }
    case 'table': {
      // PCB_TABLE::GetItemDescription: "%d column table", lowercase as
      // upstream spells it.
      const t = board.tables[r.index];
      return t ? `${t.columnCount} column table` : 'table';
    }
    case 'image': {
      // PCB_REFERENCE_IMAGE::GetItemDescription is the bare string, with no
      // layer and no filename — there is nothing else it can usefully say.
      return 'Reference Image';
    }
    case 'dimension': {
      // PCB_DIMENSION_BASE::GetItemDescription: "Dimension '<text>' on <layer>".
      // A centre dimension carries no text, so the quotes come out empty, which
      // is what upstream does too.
      const d = board.dimensions[r.index];
      return d ? `Dimension '${d.text?.text ?? ''}' on ${d.layer}` : 'Dimension';
    }
    case 'point':
      // `PCB_POINT::GetItemDescription` returns `_( "Point" )` and nothing
      // else — no layer, no position. Two snap points on the same spot are
      // therefore two identical rows in the disambiguation menu, which is what
      // upstream shows.
      return 'Point';
    case 'barcode': {
      const bc = board.barcodes[r.index];
      // `PCB_BARCODE::GetItemDescription` (`pcb_barcode.cpp:633-636`):
      // `_( "Barcode '%s' on %s" )` with `GetText()` — the raw text, variable
      // references and all, not `GetShownText()`.
      return bc ? `Barcode '${bc.text}' on ${bc.layer}` : 'Barcode';
    }
    case 'group': {
      const g = board.groups[r.index];
      // EDA_GROUP::GetItemDescription: 'Group "<name>" with N members' /
      // "Anonymous Group with N members".
      if (!g) return 'Group';
      return g.name
        ? `Group "${g.name}" with ${g.members.length} members`
        : `Anonymous Group with ${g.members.length} members`;
    }
  }
}
