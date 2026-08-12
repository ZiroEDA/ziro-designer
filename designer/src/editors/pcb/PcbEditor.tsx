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
import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  boardHitCandidates,
  boardItemsInBox,
  allBoardItemIds,
  boardItemBBox,
  parseBoardItemId,
  moveBoardItems,
  dragBoardItems,
  setFootprintField,
  setFootprintLocked,
  setFootprintOrientation,
  connectedTrackEnds,
  boardItemId,
  subsetBoardItems,
  deleteBoardItems,
  rotateBoardItems,
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
  setBoardPageSettings,
  serializeBoard,
  buildRatsnest,
  prepareLocalRatsnest,
  type LocalRatsnest,
  addBoardShape,
  addBoardTrack,
  addBoardVia,
  addBoardText,
  addBoardZone,
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
} from '@ziroeda/pcbnew';
import { posturePath, routedPath as routeDecision } from './route_tool.js';
import { ReferenceImageCache } from './image_cache.js';
import { dimensionDefaultsFrom, dimensionToolKind } from './dimension_tools.js';
import { DialogDimensionProperties } from './dialogs/dialog_dimension_properties.js';
import { DialogTextBoxProperties } from './dialogs/dialog_textbox_properties.js';
import { DialogReferenceImageProperties } from './dialogs/dialog_reference_image_properties.js';
import { DialogTableProperties } from './dialogs/dialog_table_properties.js';
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
import {
  applyDimensionValues,
  collectDimensionValues,
  dimensionAt,
  type DimensionValues,
} from '@ziroeda/pcbnew/src/dimension_properties.js';
import { Reporter, type ReportLine } from '@ziroeda/common';
import { MenuBar, ContextMenu, type Menu, type MenuItem } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { StatusField, STATUS_FIELD_TEMPLATES } from '../../ui/StatusField.js';
import { DialogPcbFind, DEFAULT_PCB_FIND, type PcbFindOptions } from './dialogs/dialog_find.js';
import { DialogPageSettings } from '../schematic/dialogs/dialog_page_settings.js';
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
import { toggleObject, type ObjectState } from './pcb_objects.js';
import { align, type PcbGridState } from '@ziroeda/pcbnew/src/pcb_grid_helper.js';
import { bestSnapAnchor, snapToBoardCopper } from '@ziroeda/pcbnew/src/pcb_cursor_snap.js';
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
import { flipBoardItems } from '@ziroeda/pcbnew/src/edit-board.js';
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
  shapePointsUsed,
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
import { parseFootprint } from '../footprint/footprintBoard.js';
import {
  buildScene,
  buildDrawSteps,
  drawAnchors,
  drawBoard,
  drawGrid,
  drawDrawingSheet,
  drawPageLimits,
  drawNetNames,
  drawOriginMarker,
  drawDrcMarkers,
  DEFAULT_GRID_OPTIONS,
  DEFAULT_DRAW_OPTIONS,
  DOM_PATH_FACTORY,
  GAL_SCREEN_DPI,
  type BoardScene,
  type PcbDrawOptions,
  type DrcMarkerDraw,
  type ScenePathFactory,
  type SceneFilter,
} from './renderBoard.js';
import { PcbGl } from '../../render/gl/pcb_gl.js';
import { GL_PATH_FACTORY } from '../../render/gl/gl_path.js';
import type { Viewer3D } from './pcb3d.js';
import {
  layerColor,
  PCB_BACKGROUND,
  PCB_CURSOR,
  PCB_OBJECT_COLORS,
  PCB_SPECIAL,
} from './pcbTheme.js';
import {
  PCB_TOP_TOOLBAR,
  PCB_LEFT_TOOLBAR,
  PCB_RIGHT_TOOLBAR,
  PCB_FILTER_CATS,
} from './pcbToolbars.js';
import '../../ui/shell.css';
import { AboutDialog } from '../../home/dialogs/dialog_about.js';

const MM = PCB_IU_PER_MM; // pcbnew IU is 1 nm (base_units.h)

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
const GL_RENDERER =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('renderer') !== 'canvas';

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

// One mil in IU.
const MIL = 0.0254 * MM;

// pcbnew's grid presets, exactly APP_SETTINGS_BASE::DefaultGridSizeList()
// (app_settings.cpp): the mil rows first, then the metric rows.
const PCB_GRIDS: number[] = [
  ...[1000, 500, 250, 200, 100, 50, 25, 20, 10, 5, 2, 1].map((m) => m * MIL),
  ...[5.0, 2.5, 1.0, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.01].map((mm) => mm * MM),
];

// pcbnew's zoom presets (zoom_defines.h ZOOM_LIST_PCBNEW).
const PCB_ZOOMS: number[] = [
  0.13, 0.22, 0.35, 0.6, 1.0, 1.5, 2.2, 3.5, 5.0, 8.0, 13.0, 20.0, 35.0, 50.0, 80.0, 130.0, 220.0,
  300.0,
];

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
const IU_PER_INCH = 25.4e6; // 1 inch in pcbnew IU (1 nm each)
const zoomFactorForScale = (scale: number, dpr: number): number =>
  (scale / Math.max(dpr, 1e-9)) * (IU_PER_INCH / GAL_SCREEN_DPI);
const scaleForZoomFactor = (zoom: number, dpr: number): number =>
  (zoom * GAL_SCREEN_DPI * Math.max(dpr, 1e-9)) / IU_PER_INCH;

// Visibility (eye) toggle, drawn inline so it always renders (no asset-URL
// resolution) and reads as KiCad's light-grey eye on the dark panel. `on`
// draws the open eye; off draws it struck through and dimmed
// (APPEARANCE_CONTROLS' BITMAP_TOGGLE visible/not-visible bitmaps).
function EyeIcon({ on }: { on: boolean }): JSX.Element {
  return (
    <svg
      className="ze-eye"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      style={{ opacity: on ? 1 : 0.4 }}
    >
      <path
        d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      {!on && <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}

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
type MsgPanelItem = { upper: string; lower: string };

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

// Left-toolbar radio groups (same convention as the schematic editor).
const RADIO_GROUPS: string[][] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
  ['zoneDisplayFilled', 'zoneDisplayOutline'],
];
const DEFAULT_TOGGLES = new Set([
  'toggleGrid',
  'unitsMm',
  'crosshairSmall',
  'lineMode90',
  'ratsnestLineMode',
  'zoneDisplayFilled',
  'showLayersManager',
  'showProperties',
]);

// Objects tab rows, exactly appearance_controls.cpp s_objectSettings
// (label / tooltip / opacity slider / visibility checkbox). Rows whose
// rendering isn't ported yet are greyed in their upstream position.
type ObjectRow =
  | 'sep'
  | {
      key: keyof ObjectState;
      label: string;
      tooltip: string;
      slider?: boolean;
      noVisibility?: boolean;
      disabled?: boolean;
    };
const OBJECT_ROWS: ObjectRow[] = [
  { key: 'tracks', label: 'Tracks', tooltip: 'Show tracks', slider: true },
  { key: 'vias', label: 'Vias', tooltip: 'Show all vias', slider: true },
  { key: 'pads', label: 'Pads', tooltip: 'Show all pads', slider: true },
  { key: 'zones', label: 'Zones', tooltip: 'Show copper zones', slider: true },
  {
    key: 'filledShapes',
    label: 'Filled Shapes',
    tooltip: 'Opacity of filled shapes',
    slider: true,
    noVisibility: true,
  },
  { key: 'images', label: 'Images', tooltip: 'Show user images', slider: true, disabled: true },
  'sep',
  {
    key: 'footprintsFront',
    label: 'Footprints Front',
    tooltip: "Show footprints that are on board's front",
  },
  {
    key: 'footprintsBack',
    label: 'Footprints Back',
    tooltip: "Show footprints that are on board's back",
  },
  { key: 'fpValues', label: 'Values', tooltip: 'Show footprint values' },
  { key: 'fpReferences', label: 'References', tooltip: 'Show footprint references' },
  { key: 'fpText', label: 'Footprint Text', tooltip: 'Show all footprint text' },
  'sep',
  'sep',
  {
    key: 'ratsnest',
    label: 'Ratsnest',
    tooltip: 'Show unconnected nets as a ratsnest',
  },
  {
    key: 'drcWarnings',
    label: 'DRC Warnings',
    tooltip: 'DRC violations with a Warning severity',
    disabled: true,
  },
  {
    key: 'drcErrors',
    label: 'DRC Errors',
    tooltip: 'DRC violations with an Error severity',
    disabled: true,
  },
  {
    key: 'drcExclusions',
    label: 'DRC Exclusions',
    tooltip: 'DRC violations which have been individually excluded',
    disabled: true,
  },
  {
    key: 'anchors',
    label: 'Anchors',
    tooltip: 'Show footprint and text origins as a cross',
  },
  {
    key: 'points',
    label: 'Points',
    tooltip: 'Show explicit snap points as crosses',
    disabled: true,
  },
  {
    key: 'lockedShadow',
    label: 'Locked Item Shadow',
    tooltip: 'Show a shadow on locked items',
    disabled: true,
  },
  {
    key: 'collidingCourtyards',
    label: 'Colliding Courtyards',
    tooltip: 'Show colliding footprint courtyards',
    disabled: true,
  },
  {
    key: 'constrainedShadow',
    label: 'Constrained Item Shadow',
    tooltip: 'Show a shadow on constrained items',
    disabled: true,
  },
  {
    key: 'boardAreaShadow',
    label: 'Board Area Shadow',
    tooltip: 'Show board area shadow',
    disabled: true,
  },
  {
    key: 'drawingSheet',
    label: 'Drawing Sheet',
    tooltip: 'Show drawing sheet borders and title block',
  },
  { key: 'grid', label: 'Grid', tooltip: 'Show the (x,y) grid dots' },
];

const DEFAULT_OBJECTS: ObjectState = {
  tracks: true,
  vias: true,
  pads: true,
  zones: true,
  filledShapes: true,
  images: true,
  footprintsFront: true,
  footprintsBack: true,
  fpValues: true,
  fpReferences: true,
  fpText: true,
  ratsnest: true,
  drcWarnings: true,
  drcErrors: true,
  drcExclusions: true,
  anchors: true,
  points: true,
  lockedShadow: true,
  collidingCourtyards: true,
  constrainedShadow: true,
  boardAreaShadow: true,
  drawingSheet: true,
  grid: true,
};
// project_local_settings.cpp defaults.

const DEFAULT_OPACITY = {
  tracks: 1.0,
  vias: 1.0,
  pads: 1.0,
  zones: 0.6,
  filledShapes: 1.0,
  images: 0.6,
};

// Technical layers in the Layers tab, exactly rebuildLayers()'s non_cu_seq
// order with its tooltips (appearance_controls.cpp).
const NON_CU_SEQ: [string, string][] = [
  ['F.Adhes', "Adhesive on board's front"],
  ['B.Adhes', "Adhesive on board's back"],
  ['F.Paste', "Solder paste on board's front"],
  ['B.Paste', "Solder paste on board's back"],
  ['F.SilkS', "Silkscreen on board's front"],
  ['B.SilkS', "Silkscreen on board's back"],
  ['F.Mask', "Solder mask on board's front"],
  ['B.Mask', "Solder mask on board's back"],
  ['Dwgs.User', 'Explanatory drawings'],
  ['Cmts.User', 'Explanatory comments'],
  ['Eco1.User', 'User defined meaning'],
  ['Eco2.User', 'User defined meaning'],
  ['Edge.Cuts', "Board's perimeter definition"],
  ['Margin', "Board's edge setback outline"],
  ['F.CrtYd', "Footprint courtyards on board's front"],
  ['B.CrtYd', "Footprint courtyards on board's back"],
  ['F.Fab', "Footprint assembly on board's front"],
  ['B.Fab', "Footprint assembly on board's back"],
];
const layerTooltip = (name: string): string => {
  const t = NON_CU_SEQ.find(([n]) => n === name);
  if (t) return t[1];
  if (name === 'F.Cu') return 'Front copper layer';
  if (name === 'B.Cu') return 'Back copper layer';
  if (/\.Cu$/.test(name)) return 'Inner copper layer';
  if (/^User\.(\d+)$/.test(name)) return `User defined layer ${name.slice(5)}`;
  return '';
};

// User-facing layer names, as the Appearance panel shows them (LayerName() in
// layer_id.cpp: F.Adhesive, User.Drawings…, not the file's canonical tokens).
const LAYER_DISPLAY_NAMES: Record<string, string> = {
  'F.Adhes': 'F.Adhesive',
  'B.Adhes': 'B.Adhesive',
  'F.SilkS': 'F.Silkscreen',
  'B.SilkS': 'B.Silkscreen',
  'Dwgs.User': 'User.Drawings',
  'Cmts.User': 'User.Comments',
  'Eco1.User': 'User.Eco1',
  'Eco2.User': 'User.Eco2',
  'F.CrtYd': 'F.Courtyard',
  'B.CrtYd': 'B.Courtyard',
};

// Wildcard match for netclass_patterns ('*' and '?', like EDA_COMBINED_MATCHER).
const wildcardMatch = (pattern: string, s: string): boolean => {
  const rx = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  );
  return rx.test(s);
};

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

// Builtin layer presets (appearance_controls.cpp preset* + common/lset.cpp masks).
const FRONT_TECH = ['F.SilkS', 'F.Mask', 'F.Adhes', 'F.Paste', 'F.CrtYd', 'F.Fab'];
const BACK_TECH = ['B.SilkS', 'B.Mask', 'B.Adhes', 'B.Paste', 'B.CrtYd', 'B.Fab'];
const PRESETS: { name: string; layers: (all: string[], copper: string[]) => string[] }[] = [
  { name: 'All Layers', layers: (all) => all },
  { name: 'No Layers', layers: () => [] },
  { name: 'All Copper Layers', layers: (_a, cu) => [...cu, 'Edge.Cuts'] },
  {
    name: 'Inner Copper Layers',
    layers: (_a, cu) => [...cu.filter((c) => /^In/.test(c)), 'Edge.Cuts'],
  },
  { name: 'Front Layers', layers: () => ['F.Cu', ...FRONT_TECH, 'Edge.Cuts'] },
  {
    name: 'Front Assembly View',
    layers: () => ['F.SilkS', 'F.Mask', 'F.Fab', 'F.CrtYd', 'Edge.Cuts'],
  },
  { name: 'Back Layers', layers: () => ['B.Cu', ...BACK_TECH, 'Edge.Cuts'] },
  {
    name: 'Back Assembly View',
    layers: () => ['B.SilkS', 'B.Mask', 'B.Fab', 'B.CrtYd', 'Edge.Cuts'],
  },
];

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
// EDIT_POINT's screen sizes and LAYER_AUX_ITEMS colour (edit_points.h /
// edit_points.cpp ViewDraw). The border is derived from the fill the way
// upstream does it: white is bright, so it darkens by 0.7 / 0.5 at alpha 0.8.
const EDIT_POINT_SIZE = 8;
const EDIT_POINT_BORDER_SIZE = 3;
const EDIT_POINT_HOVER_SIZE = 6;
const EDIT_POINT_FILL = 'rgb(255,255,255)';
const EDIT_POINT_BORDER = 'rgba(77,77,77,0.8)';
const EDIT_POINT_HOVER_BORDER = 'rgba(128,128,128,0.8)';

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
  projectName,
  projectFiles,
  rootPro,
  onPersistFiles,
  onOutputFile,
  crossProbeNet,
  updateFromSchematic,
  readOnlyNotice,
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
  /** A strip to show above the canvas, e.g. "this demo is not being saved". */
  readOnlyNotice?: JSX.Element | null;
  /** Bumped by the schematic editor's Tools > Update PCB from Schematic (F8),
   *  which switches here and then runs the same dialog this frame's own F8 does
   *  (KiCad's SCH_EDIT_FRAME::doUpdatePcb hands off to pcbnew the same way). */
  updateFromSchematic?: number | null;
}): JSX.Element {
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
  const [preset, setPreset] = useState('---');
  const [tab, setTab] = useState<'Layers' | 'Objects' | 'Nets'>('Layers');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
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
  const [netColors, setNetColors] = useState<ReadonlyMap<number, string>>(new Map());
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
  const [selFilter, setSelFilter] = useState<Set<string>>(
    new Set(PCB_FILTER_CATS.map((c) => c.key)),
  );
  // Right-click "Only <category>" popup of the Selection Filter panel
  // (PANEL_SELECTION_FILTER::onRightClick).
  const [filterMenu, setFilterMenu] = useState<{
    x: number;
    y: number;
    key: string;
    label: string;
  } | null>(null);
  const [netQuery, setNetQuery] = useState('');
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
    let code = 0;
    if (crossProbeNet && brd) {
      for (const [c, name] of brd.nets) {
        if (name === crossProbeNet) {
          code = c;
          break;
        }
      }
    }
    setHighlightNets((prev) => {
      if (code <= 0) return prev.size === 0 ? prev : new Set();
      if (prev.size === 1 && prev.has(code)) return prev;
      return new Set([code]);
    });
  }, [crossProbeNet]);
  const [activeTool, setActiveTool] = useState('selectSetRect');
  // Selected board items (PCB_SELECTION_TOOL's selection), by `${kind}:${index}` id.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
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
  const viewer3dRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
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
  const ctrlDownRef = useRef(false);
  const [scale, setScale] = useState(0);
  // Active grid size (the TOP_AUX grid selector; EDA_DRAW_FRAME's grid list).
  const [gridIU, setGridIU] = useState(DEFAULT_GRID_OPTIONS.size);
  const gridIURef = useRef(gridIU);
  gridIURef.current = gridIU;
  // The board's own grid origin (`(setup (grid_origin))`), which pcbnew hands
  // to the GAL on open (pcb_base_edit_frame.cpp) and which both the dots and
  // the snap are measured from. A ref because `draw` and the pointer handlers
  // read it without wanting to be rebuilt when the board object is replaced.
  const gridOriginRef = useRef<{ x: number; y: number }>(DEFAULT_GRID_OPTIONS.origin);
  gridOriginRef.current = useMemo(
    () => (board ? boardGridOrigin(board) : DEFAULT_GRID_OPTIONS.origin),
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
    // `canUseGrid()` = the grid-snapping setting AND no Ctrl. We have no
    // grid-snapping preference of our own yet, so the modifier is the whole of
    // it — but it is the half users reach for, and without it there is no way
    // at all to place something off the lattice.
    enableGrid: !ctrlDownRef.current,
    enableSnap: !shiftDownRef.current,
    auxAxis: auxAxisRef.current,
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
    });
  };
  // TOP_AUX track-width / via-size selections: index 0 = "use netclass",
  // 1.. = the pre-defined list entries (BOARD_DESIGN_SETTINGS m_TrackWidthList /
  // m_ViasDimensionsList; ours come from the project's netclasses).
  const [trackSel, setTrackSel] = useState(0);
  const [viaSel, setViaSel] = useState(0);
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
  // Keyboard grab (M/G): the selection follows the cursor until a click commits
  // or Esc cancels, SCH/PCB move tool. Distinct from a left-button drag.
  const grabbingRef = useRef(false);
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
  // Item the disambiguation menu is hovering, brightened in the overlay pass.
  const hoverRef = useRef<string | null>(null);
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
      'PCB Editor',
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
    tableStartRef.current = null;
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
  const buildBoardScene = (b: Board, filter: SceneFilter = {}): BoardScene => {
    if (!filter.clearanceForNet) filter = { ...filter, clearanceForNet };
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

  const showAppearance = toggles.has('showLayersManager');
  const showProperties = toggles.has('showProperties');

  // Draw options derived from the Objects tab + zone display mode.
  const drawOpts = useMemo<PcbDrawOptions>(
    () => ({
      ...DEFAULT_DRAW_OPTIONS,
      tracks: objects.tracks,
      vias: objects.vias,
      pads: objects.pads,
      zones: objects.zones,
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
      // Identity-stable: the cache mutates the map and asks for a redraw, and
      // the paint pass reads it then. Nothing here needs to change for a decode
      // to become visible.
      imageBitmaps: imageCacheRef.current.bitmaps,
    }),
    [objects, opacity, toggles, contrast, activeLayer],
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

  // Parse after the first paint so "Loading…" is visible for big boards.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      try {
        const b = { ...readBoard(parse(text)), fileName };
        if (cancelled) return;
        boardRef.current = b;
        sceneRef.current = buildBoardScene(b);
        setBoard(b);
        setVisible(new Set(b.layers.map((l) => l.name)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [text, fileName]);

  // Hydrate Board Setup from the loaded project: the .kicad_pro slices
  // (design settings, netclasses, component classes, tuning profiles, text
  // variables), the board file's setup sections and the .kicad_dru rules,
  // the same load KiCad does in BOARD::SetProject + LoadProjectSettings.
  useEffect(() => {
    const files = projectFilesNow();
    const s = readBoardSetupPro(files, rootPro);
    applyBoardFileSetup(text, s);
    const dru = findProjectDru(files, rootPro);
    if (dru) s.customRules.text = dru.text;
    setBoardSetup(s);
  }, [projectFilesNow, rootPro, text]);

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
    if (objects.grid && toggles.has('toggleGrid')) {
      drawGrid(bctx, v, canvas.width, canvas.height, dpr, {
        ...DEFAULT_GRID_OPTIONS,
        size: gridIURef.current,
        origin: gridOriginRef.current,
      });
    }
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
      const sheetInfo = {
        paper: boardRef.current.paper,
        titleBlock: boardRef.current.titleBlock,
        fileName,
      };
      // The paper edge first, in its own colour, the way DrawBorder runs after
      // the sheet's items in DS_PROXY_VIEW_ITEM::ViewDraw. This is the call the
      // board actually makes: the GL recorder disables the sheet
      // (`drawingSheet: false`) because it stays on this 2D layer, so anything
      // added to `buildDrawSteps` alone never reaches the screen.
      drawPageLimits(bctx, sheetInfo, drawOpts.theme?.special.pageLimits ?? PCB_SPECIAL.pageLimits);
      drawDrawingSheet(bctx, sheetInfo, sheetColor);
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
    drawOriginMarker(ctx, auxOriginOf(), v, canvas.width, canvas.height, dpr);
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
        ctx.lineWidth = Math.max(1, dpr);
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
        ctx.fillStyle = EDIT_POINT_FILL;
        for (const h of handles) {
          const x = h.at.x * sx + v.tx;
          const y = h.at.y * v.scale + v.ty;
          const active = hovered?.kind === h.kind && hovered?.index === h.index;
          ctx.strokeStyle = active ? EDIT_POINT_HOVER_BORDER : EDIT_POINT_BORDER;
          ctx.lineWidth = (active ? EDIT_POINT_HOVER_SIZE : EDIT_POINT_BORDER_SIZE) * dpr;
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
          drawOpts,
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
        const live = moveDimension(dr, snapToGrid(cur0)).dimension;
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
    // Measure ruler (ACTIONS::measureTool): line with end ticks and the
    // distance / dx / dy readout in the current units.
    {
      const m = measureRef.current;
      const cur0 = cursorRef.current;
      if (m && (m.b || cur0)) {
        const b = m.b ?? snapToGrid(cur0!);
        const ax = m.a.x * sx + v.tx;
        const ay = m.a.y * v.scale + v.ty;
        const bx = b.x * sx + v.tx;
        const by = b.y * v.scale + v.ty;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = 'rgba(120,230,255,0.95)';
        ctx.fillStyle = 'rgba(120,230,255,0.95)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        // End ticks perpendicular to the ruler.
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / len) * 6 * dpr;
        const ny = ((bx - ax) / len) * 6 * dpr;
        ctx.moveTo(ax - nx, ay - ny);
        ctx.lineTo(ax + nx, ay + ny);
        ctx.moveTo(bx - nx, by - ny);
        ctx.lineTo(bx + nx, by + ny);
        ctx.stroke();
        const dist = Math.hypot(b.x - m.a.x, b.y - m.a.y);
        ctx.font = `${12 * dpr}px system-ui, sans-serif`;
        ctx.fillText(
          `${fmtCoord(dist)} ${unitLabel}  (dx ${fmtCoord(b.x - m.a.x)}  dy ${fmtCoord(b.y - m.a.y)})`,
          (ax + bx) / 2 + 10 * dpr,
          (ay + by) / 2 - 8 * dpr,
        );
      }
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
    // Disambiguation hover: brighten the item the menu is pointing at.
    const hover = hoverRef.current;
    if (brd && hover) {
      const hb = boardItemBBox(brd, hover);
      if (hb) {
        const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
          x: p.x * sx + v.tx,
          y: p.y * v.scale + v.ty,
        });
        const q0 = toPx({ x: hb.minX, y: hb.minY }),
          q1 = toPx({ x: hb.maxX, y: hb.maxY });
        const pad = 2 * dpr;
        ctx.strokeStyle = 'rgba(120,230,255,1)';
        ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
        ctx.strokeRect(
          Math.min(q0.x, q1.x) - pad,
          Math.min(q0.y, q1.y) - pad,
          Math.abs(q1.x - q0.x) + 2 * pad,
          Math.abs(q1.y - q0.y) + 2 * pad,
        );
      }
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
    // Crosshair cursor (GAL blitCursor): a white cross at the grid-snapped
    // cursor. crosshairSmall = an 80px cross (default), crosshairFull = full
    // screen lines, crosshair45 = a big diagonal X. Drawn topmost.
    const cur = cursorRef.current;
    if (cur && activeToolRef.current !== 'localRatsnestTool') {
      const snapped = cursorSnapRef.current(cur);
      const px = snapped.x * sx + v.tx;
      const py = snapped.y * v.scale + v.ty;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = PCB_CURSOR;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      if (toggles.has('crosshairFull')) {
        ctx.moveTo(0, py);
        ctx.lineTo(canvas.width, py);
        ctx.moveTo(px, 0);
        ctx.lineTo(px, canvas.height);
      } else if (toggles.has('crosshair45')) {
        const d = canvas.width + canvas.height;
        ctx.moveTo(px - d, py - d);
        ctx.lineTo(px + d, py + d);
        ctx.moveTo(px - d, py + d);
        ctx.lineTo(px + d, py - d);
      } else {
        const s = 40 * dpr; // 80px cross, ±40
        ctx.moveTo(px - s, py);
        ctx.lineTo(px + s, py);
        ctx.moveTo(px, py - s);
        ctx.lineTo(px, py + s);
      }
      ctx.stroke();
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
  const rebuildSelScene = useCallback(() => {
    const brd = boardRef.current;
    const sel = selForDrawRef.current;
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
    if (!GL_RENDERER) return;
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
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
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
        setSelection(new Set(result.addedFootprints.map((i) => boardItemId('footprint', i))));
      }

      return reporter.lines;
    },
    [updatePcb, commitBoard],
  );

  // Apply a footprint edit from the Properties grid, committing to the board
  // (children + undo follow). Mirrors the PCB_PROPERTIES_PANEL edits.
  const editFootprint = useCallback(
    (index: number, e: FpEdit): void => {
      const brd = boardRef.current;
      const fp = brd?.footprints[index];
      if (!brd || !fp) return;
      if (e.kind === 'pos') {
        if (!Number.isFinite(e.valueMM)) return;
        const target = Math.round(e.valueMM * MM);
        const delta =
          e.axis === 'x' ? { x: target - fp.at.x, y: 0 } : { x: 0, y: target - fp.at.y };
        if (delta.x === 0 && delta.y === 0) return;
        commitBoard(moveBoardItems(brd, new Set([boardItemId('footprint', index)]), delta));
      } else if (e.kind === 'orient') {
        if (!Number.isFinite(e.deg)) return;
        commitBoard(setFootprintOrientation(brd, index, e.deg));
      } else if (e.kind === 'field') {
        commitBoard(setFootprintField(brd, index, e.field, e.value));
      } else if (e.kind === 'locked') {
        commitBoard(setFootprintLocked(brd, index, e.locked));
      }
    },
    [commitBoard],
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

  // Rotate the selection ±90° about its centre (EDIT_TOOL::Rotate). Keeps the
  // selection so it can be rotated repeatedly. Groups rotate as their members.
  const rotateSel = useCallback(
    (ccw: boolean) => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      const { items, selection } = promotePadsForCommand(brd, sel);
      if (selection) setSelection(selection);
      commitBoard(rotateBoardItems(brd, items, ccw));
    },
    [commitBoard],
  );

  // Mirror the selection about its centre (EDIT_TOOL::Mirror; mirrorV = flip
  // top/bottom, mirrorH = left/right). Footprints are skipped, like KiCad.
  const mirrorSel = useCallback(
    (direction: 'v' | 'h') => {
      const brd = boardRef.current;
      const sel = selForDrawRef.current;
      if (!brd || sel.size === 0) return;
      const { items, selection } = promotePadsForCommand(brd, sel);
      if (selection) setSelection(selection);
      commitBoard(mirrorBoardItems(brd, items, direction));
    },
    [commitBoard],
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

  // Fit the view to a world-space box (shared by Zoom-to-Fit variants and the
  // interactive zoom tool).
  const fitWorldBox = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number, margin: number) => {
      const canvas = canvasRef.current;
      if (!canvas || maxX <= minX || maxY <= minY) return;
      const s = Math.min(
        canvas.width / (maxX - minX + margin * 2),
        canvas.height / (maxY - minY + margin * 2),
      );
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
  const zoomToFitImpl = useCallback(
    (includeSheet: boolean) => {
      const scene = sceneRef.current;
      if (!scene?.bbox) return;
      let { minX, minY, maxX, maxY } = scene.bbox;
      const paper = boardRef.current?.paper?.split(/\s+/)[0];
      const PAGE: Record<string, [number, number]> = {
        A5: [210, 148],
        A4: [297, 210],
        A3: [420, 297],
        A2: [594, 420],
        A1: [841, 594],
        A0: [1189, 841],
      };
      if (includeSheet && paper && PAGE[paper] && objects.drawingSheet) {
        const [pw, ph] = PAGE[paper]!;
        minX = Math.min(minX, 0);
        minY = Math.min(minY, 0);
        maxX = Math.max(maxX, pw * MM);
        maxY = Math.max(maxY, ph * MM);
      }
      fitWorldBox(minX, minY, maxX, maxY, 5 * MM);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitWorldBox, objects.drawingSheet],
  );
  const zoomToFit = useCallback(() => zoomToFitImpl(true), [zoomToFitImpl]);
  const zoomFitObjects = useCallback(() => zoomToFitImpl(false), [zoomToFitImpl]);

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
      const r = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      // Assigning canvas.width clears the canvas even when the value is
      // unchanged, blanking the board for a frame. This effect re-runs (and
      // re-observes, firing an initial callback) whenever the draw options
      // change, so only touch the canvas on a REAL size change, otherwise a
      // left-toolbar toggle flickers the whole view.
      const changed = canvas.width !== w || canvas.height !== h;
      if (changed) {
        // The GL and overlay layers are sized with the board canvas. The GL
        // one's drawing buffer *is* the viewport its shaders project into, so a
        // stale size shows up as a board drawn at the wrong scale rather than as
        // nothing at all.
        for (const c of [canvas, glCanvasRef.current, overCanvasRef.current]) {
          if (!c) continue;
          c.width = w;
          c.height = h;
          c.style.width = `${r.width}px`;
          c.style.height = `${r.height}px`;
        }
      }
      // Only a fit against a viewport that exists counts.
      //
      // The frames stay mounted and are toggled with CSS, so this observer also
      // fires while the board editor is hidden behind the schematic, and a
      // hidden element measures 0 x 0 — which `Math.max(1, …)` above turns into
      // a 1 x 1 canvas. Fitting to that produced a scale and an offset that
      // meant nothing, and recording it as done meant the real layout, when the
      // user finally switched over, never fitted at all: an empty sheet with the
      // origin marker sitting in it until they pressed Zoom to Fit themselves.
      const measured = r.width > 0 && r.height > 0;
      if (!fittedRef.current && sceneRef.current && measured) {
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

  // Wheel zoom about the cursor; drag to pan (left or middle button).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * dpr;
      const py = (e.clientY - rect.top) * dpr;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale *= factor;
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
  const hitCandidates = (w: { x: number; y: number }): string[] => {
    const brd = boardRef.current;
    if (!brd) return [];
    const canvas = canvasRef.current;
    const v = viewRef.current;
    const cands = boardHitCandidates(brd, w, tolOf(), {
      filter: passesFilter,
      activeLayer,
      visibleLayers: visible,
      viewportIU: canvas ? { w: canvas.width / v.scale, h: canvas.height / v.scale } : undefined,
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
    }
    requestDraw();
  };

  // Right-click opens the selection context menu (PCB_SELECTION_TOOL TOOL_MENU).
  // An unselected item under the cursor becomes the selection first, exactly as
  // KiCad selects before popping the menu.
  const onCanvasContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    const w = worldAt(e.clientX, e.clientY);
    const brd = boardRef.current;
    if (!w || !brd) {
      setCtxMenu(null);
      return;
    }
    const hit = hitCandidates(w)[0] ?? null;
    if (hit && !selForDrawRef.current.has(hit)) applySelect(hit, false);
    // The menu always opens on a non-empty board (Select All is shown even with
    // nothing selected, per noItemsCondition = board && !IsEmpty).
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  // The selection context menu, in the upstream PCB_SELECTION_TOOL TOOL_MENU
  // order for the actions we support: Select All / Unselect All, then the
  // priority-100 submenus (Mirror / Rotate, GROUP_CONTEXT_MENU "Grouping",
  // LOCK_CONTEXT_MENU "Locking"), then the priority-150 Duplicate / Delete.
  // Each item's enabled state follows its upstream SELECTION_CONDITION. Entries
  // gated by an empty selection are hidden, matching CONDITIONAL_MENU.
  const buildPcbContextMenu = (): MenuItem[] => {
    const brd = board;
    let groupCount = 0;
    let hasUngrouped = false;
    let hasMember = false;
    let anyLocked = false;
    let anyUnlocked = false;
    let hasNonPad = false;
    for (const id of selection) {
      const r = parseBoardItemId(id);
      if (!r) continue;
      if (brd) {
        if (isBoardItemLocked(brd, id)) anyLocked = true;
        else anyUnlocked = true;
      }
      if (r.kind === 'group') {
        groupCount++;
        hasNonPad = true;
        if (brd && groupContaining(brd, id)) hasMember = true;
      } else if (r.kind === 'pad' || r.kind === 'fptext') {
        // children: not groupable and not mirrorable on their own
      } else {
        hasNonPad = true;
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
    const items: MenuItem[] = [
      { label: 'Select All', action: selectAllSel },
      { label: 'Unselect All', action: unselectAllSel, disabled: selection.size === 0 },
    ];
    if (selection.size > 0) {
      const zoneIdx = brd ? zoneAt(brd, selection) : null;
      const fpIdx = brd ? footprintAt(brd, selection) : null;
      const padIdx = brd ? selectedPadAt(brd, selection) : null;
      const textIdx = brd ? textAt(brd, selection) : null;
      const shapeIdx = brd ? shapeAt(brd, selection) : null;
      const copper = brd ? hasTrackOrVia(trackViaSelection(brd, selection)) : false;
      const editable =
        copper ||
        zoneIdx !== null ||
        fpIdx !== null ||
        padIdx !== null ||
        textIdx !== null ||
        shapeIdx !== null;
      items.push(
        { sep: true },
        {
          label: 'Properties…',
          action: () => {
            if (copper) setTrackViaOpen(true);
            else if (zoneIdx !== null) setZonePropsIndex(zoneIdx);
            else if (padIdx !== null) setPadPropsRef(padIdx);
            else if (textIdx !== null) setTextPropsIndex(textIdx);
            else if (shapeIdx !== null) setShapePropsIndex(shapeIdx);
            else setFpPropsIndex(fpIdx);
          },
          disabled: !editable,
        },
        { sep: true },
        {
          label: 'Mirror / Rotate',
          items: [
            A('Rotate Counterclockwise', 'rotateCCW'),
            A('Rotate Clockwise', 'rotateCW'),
            A('Mirror Horizontally', 'mirrorH', !hasNonPad),
            A('Mirror Vertically', 'mirrorV', !hasNonPad),
            { sep: true },
            {
              label: 'Change Side / Flip',
              action: () => flipSelection(),
              disabled: selection.size === 0,
            },
          ],
        },
        {
          label: 'Grouping',
          icon: 'group',
          items: [
            A('Group Items', 'group', selection.size < 2),
            A('Ungroup Items', 'ungroup', groupCount === 0),
            A('Add Items', 'addToGroup', !(groupCount === 1 && hasUngrouped)),
            A('Remove Items', 'removeFromGroup', !hasMember),
          ],
        },
        {
          label: 'Locking',
          icon: 'lock',
          items: [
            A('Lock', 'lock', !anyUnlocked),
            A('Unlock', 'unlock', !anyLocked),
            A('Toggle Lock', 'toggleLock'),
          ],
        },
        { sep: true },
        { label: 'Duplicate', icon: 'duplicate', action: duplicateSel },
        { label: 'Delete', icon: 'delete', action: deleteSel },
      );
    }
    return items;
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
    const base = { width, fill: false, layer: activeLayer } as const;

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
  const copperAt = (w: {
    x: number;
    y: number;
  }): { net: number; snap: { x: number; y: number } } | null => {
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
  const routeDims = (net: number): ClassDims => {
    const base = netclassInfo.classDims.get(netClassOf.get(net) ?? 'Default') ?? DEFAULT_CLASS_DIMS;
    const tw = trackWidthListRef.current[trackSelRef.current - 1];
    const vs = viaSizeListRef.current[viaSelRef.current - 1];
    return {
      trackWidth: tw ?? base.trackWidth,
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
        dims: routeDims(c?.net ?? 0),
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
  const handleDimensionClick = (world: { x: number; y: number }, kind: DimensionKind): void => {
    const brd = boardRef.current;
    if (!brd) return;
    const p = snapToGrid(world);
    const cur = dimensionRef.current;

    if (!cur) {
      const tg = boardSetupRef.current.textGraphics;
      dimensionRef.current = startDimension(
        kind,
        p,
        dimensionDefaultsFrom(
          tg.dimensions,
          activeLayer,
          shapeWidthIU(activeLayer),
          Math.round((tg.rows[0]?.textHeight ?? 1) * MM),
          Math.round((tg.rows[0]?.textThickness ?? 0.15) * MM),
        ),
      );
      requestDraw();
      return;
    }

    const next = clickDimension(cur, p);
    if (next.done) {
      commitBoard(addBoardDimension(brd, next.dimension).board);
      dimensionRef.current = null;
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
  /** Board Setup values a freshly-drawn table takes, shared by preview and commit. */
  const tableDefaults = (): TableDefaults => {
    const tg = boardSetupRef.current.textGraphics;
    return {
      layer: activeLayer,
      fontWidth: Math.round((tg.rows[0]?.textWidth ?? 1) * MM),
      fontHeight: Math.round((tg.rows[0]?.textHeight ?? 1) * MM),
      textThickness: Math.round((tg.rows[0]?.textThickness ?? 0.15) * MM),
      lineThickness: shapeWidthIU(activeLayer),
      gridPitch: gridIURef.current,
    };
  };

  /**
   * A click with the table tool active (DRAWING_TOOL::DrawTable). Two clicks,
   * then the properties dialog decides whether the table is kept at all.
   */
  const handleTableClick = (world: { x: number; y: number }): void => {
    const p = snapToGrid(world);
    const first = tableStartRef.current;
    if (!first) {
      tableStartRef.current = p;
      requestDraw();
      return;
    }
    setPendingTable(newTable(first, p, tableDefaults()));
    tableStartRef.current = null;
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
    else measureRef.current = { a: m.a, b: p };
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
    // `EDIT_TOOL` sets the axis to `dragOrigin` (edit_tool_move_fct.cpp:1401).
    // The move path is delta-based and was already reversible, but the axis
    // also makes the *zero* delta land exactly rather than merely nearly.
    auxAxisRef.current = null;
    auxAxisRef.current = snapToGrid(origin);
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
    commitBoard(fillZones(brd));
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
  const openTrackViaPropertiesRef = useRef(openTrackViaProperties);
  openTrackViaPropertiesRef.current = openTrackViaProperties;

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
  const flipSelectionRef = useRef(flipSelection);
  flipSelectionRef.current = flipSelection;

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
      const next = applyDimensionValues(brd, index, values);
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
      if (next !== brd) commitBoard(fillZones(next));
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

  // Track the in-flight gesture to the grid-snapped cursor. A drag rebuilds the
  // stretched geometry each frame (traces don't translate uniformly).
  const updateMove = (cur: { x: number; y: number }): void => {
    const brd = boardRef.current;
    const origin = moveOriginRef.current;
    if (!brd || !origin) return;
    const from = snapToGrid(origin);
    const to = snapToGrid(cur);
    const delta = { x: to.x - from.x, y: to.y - from.y };
    moveDeltaRef.current = delta;
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
      inPlaceMoveRef.current = null;
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
      const chain = updateTrackDrag(drag, dragSnap(cur, seed ? new Set([seed]) : null));
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
    if (e.button === 1) {
      panRef.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
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
      const hitId =
        activeToolRef.current !== 'zoomTool' && w && brd ? (hitCandidates(w)[0] ?? null) : null;
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
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      // Signed X so the crosshair tracks the physical cursor under a flipped view.
      const wx = ((e.clientX - rect.left) * dpr - v.tx) / (v.flipX ? -v.scale : v.scale);
      const wy = ((e.clientY - rect.top) * dpr - v.ty) / v.scale;
      setCursor({ x: wx, y: wy });
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
            0,
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
    setCursor(null);
    requestDraw();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'pcb') !== 'pcb') return;
      // Don't steal keys from text fields (net filter, property editors…).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))
        return;
      const mod = e.ctrlKey || e.metaKey;
      // ACTIONS::highContrastModeCycle (H): Normal -> Dim -> Hide -> Normal.
      if (!mod && (e.key === 'h' || e.key === 'H')) {
        setContrast((c) => (c === 'normal' ? 'dim' : c === 'dim' ? 'hide' : 'normal'));
        return;
      }
      // V while routing: place a via and switch copper layer (ROUTER_TOOL).
      if (!mod && (e.key === 'v' || e.key === 'V') && routeRef.current) {
        e.preventDefault();
        routeViaSwitchRef.current();
        return;
      }
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      // ACTIONS::updatePcbFromSchematic's default hotkey.
      if (!mod && e.key === 'F8') {
        e.preventDefault();
        void openUpdatePcb();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        duplicateSel();
        return;
      }
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteSel();
        return;
      }
      if (!mod && (e.key === 'r' || e.key === 'R')) {
        rotateSel(!e.shiftKey);
        return;
      } // R = CCW, Shift+R = CW
      // Shift+M = Move Exactly (PCB_ACTIONS::moveExact). This has to come
      // before plain M below, which would otherwise swallow it: `e.key` is
      // already 'M' whenever shift is held.
      if (!mod && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        if (selForDrawRef.current.size > 0) setMoveExactOpen(true);
        return;
      }
      // Shift+P = Position Relative To (PCB_ACTIONS::positionRelative).
      if (!mod && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (selForDrawRef.current.size > 0) setPosRelOpen(true);
        return;
      }
      // M = Move (routing left behind), G = Drag (attached traces follow), a
      // keyboard grab that follows the cursor and commits on click (EDIT_TOOL).
      if (!mod && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        grabStartRef.current('move');
        return;
      }
      if (!mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        grabStartRef.current('drag');
        return;
      }
      if (!mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        grabStartRef.current('drag45');
        return;
      }
      // E = Properties (ACTIONS::properties).
      if (!mod && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        openTrackViaPropertiesRef.current();
        return;
      }
      // B = Fill All Zones (PCB_ACTIONS::zoneFillAll).
      if (!mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        fillAllZonesRef.current();
        return;
      }
      // F = Change Side / Flip (PCB_ACTIONS::flip). Zoom to Fit is Ctrl+0 and
      // Home upstream, not F.
      if (!mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        flipSelectionRef.current();
        return;
      }
      if (e.key === 'Home' || (mod && e.key === '0')) {
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
          setDisambig(null);
        } else if (routeRef.current) {
          // Esc ends the route in progress; committed segments stay.
          routeRef.current = null;
          requestDrawRef.current();
        } else if (tableStartRef.current) {
          tableStartRef.current = null;
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
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit, undo, redo, deleteSel, rotateSel, duplicateSel]);

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

  const [viewer3dReady, setViewer3dReady] = useState(false);
  // Mount the three.js 3D viewer while the overlay is open. Lazy-imported so
  // three.js only downloads when the user actually opens the 3D view.
  useEffect(() => {
    if (!show3D || !viewer3dRef.current || !boardRef.current) return;
    let viewer: Viewer3D | null = null;
    let cancelled = false;
    setViewer3dReady(false);
    const el = viewer3dRef.current,
      brd = boardRef.current;
    void import('./pcb3d.js').then(({ mount3DViewer }) => {
      if (cancelled) return;
      try {
        viewer = mount3DViewer(el, brd, projectFiles);
      } catch {
        viewer = null;
      }
      setViewer3dReady(true);
    });
    return () => {
      cancelled = true;
      viewer?.dispose();
    };
  }, [show3D, projectFiles]);

  // ----- appearance data ------------------------------------------------------

  const copperLayers = useMemo(
    () => (board ? board.layers.filter((l) => /\.Cu$/.test(l.name)).map((l) => l.name) : []),
    [board],
  );
  // Copper layers first, then the technical layers in rebuildLayers()'s
  // non_cu_seq order (appearance_controls.cpp), then any remaining (User.*).
  const layerRows = useMemo(() => {
    if (!board) return [];
    const known = new Set(board.layers.map((l) => l.name));
    const seq = NON_CU_SEQ.map(([n]) => n).filter((n) => known.has(n));
    const seen = new Set([...copperLayers, ...seq]);
    const rest = board.layers.map((l) => l.name).filter((n) => !seen.has(n));
    return [...copperLayers, ...seq, ...rest];
  }, [board, copperLayers]);

  const toggleLayer = (name: string): void => {
    setPreset('(unsaved)');
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
      setPreset(name);
      setVisible(new Set(user.layers));
      return;
    }
    setPreset(name);
    const p = PRESETS.find((x) => x.name === name);
    if (!p || !board) return;
    const all = board.layers.map((l) => l.name);
    setVisible(new Set(p.layers(all, copperLayers).filter((l) => all.includes(l))));
  };

  // Layer right-click context menu ops (APPEARANCE_CONTROLS::onLayerContextMenu).
  const nonCopperLayers = useMemo(
    () => (board ? board.layers.map((l) => l.name).filter((n) => !/\.Cu$/.test(n)) : []),
    [board],
  );
  const setVisibleUnsaved = (names: Iterable<string>): void => {
    setPreset('(unsaved)');
    setVisible(new Set(names));
  };
  const layerMenuItems = (): { label: string; run: () => void }[][] => {
    if (!board) return [];
    const all = board.layers.map((l) => l.name);
    const has = (n: string): boolean => all.includes(n);
    const applyNamed = (name: string, active?: string): void => {
      const p = PRESETS.find((x) => x.name === name);
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

  // Presets combo (rebuildLayerPresetsWidget): builtins, user presets,
  // "(unsaved)", then --- / Save preset... / Delete preset...
  const onPresetChoice = (value: string): void => {
    if (value === '---') return;
    if (value === 'Save preset...') {
      const name = window.prompt('Layer preset name:')?.trim();
      if (!name) return;
      setUserPresets((p) => [...p.filter((x) => x.name !== name), { name, layers: [...visible] }]);
      setPreset(name);
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

  const nets = useMemo(() => {
    if (!board) return [];
    const q = netQuery.toLowerCase();
    return [...board.nets.entries()]
      .filter(([code, name]) => code !== 0 && name.toLowerCase().includes(q))
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [board, netQuery]);

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
    const patterns = boardSetup.netClasses.assignments
      .filter((a) => a.pattern && a.netClass)
      .map((a) => ({ netclass: a.netClass, pattern: a.pattern }));
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
      for (const [code, name] of board.nets) {
        const hit = netclassInfo.patterns.find((p) => wildcardMatch(p.pattern, name));
        m.set(code, hit?.netclass ?? 'Default');
      }
    }
    return m;
  }, [board, netclassInfo]);
  const classColorOf = useCallback(
    (cls: string): string | undefined => classColors.get(cls) ?? netclassInfo.classColors.get(cls),
    [classColors, netclassInfo],
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

  // Drag the splitter on the Properties pane's right edge (KiCad's resizable
  // AUI pane), clamped to KiCad's MinSize width of 240.
  const startPropResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = propWidth;
    const onMove = (ev: PointerEvent): void =>
      setPropWidth(Math.max(240, Math.min(600, startW + (ev.clientX - startX))));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag the Appearance pane's left edge (the AUI dock splitter). KiCad's
  // pane MinSize is the panel min width; clamp like the Properties pane.
  const startAppResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = appWidth;
    const onMove = (ev: PointerEvent): void =>
      setAppWidth(Math.max(200, Math.min(500, startW - (ev.clientX - startX))));
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onLeftToggle = (id: string): void => {
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
    setToggles((prev) => {
      const next = new Set(prev);
      const group = RADIO_GROUPS.find((g) => g.includes(id));
      if (group) {
        for (const g of group) next.delete(g);
        next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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
      case 'pageSettings':
        setPageDlgOpen(true);
        break;
      case 'runDRC':
        setDrcOpen(true);
        break;
      case 'boardSetup':
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
  const alignDisabled = selection.size < 2;
  // Distribution needs one item at each end and at least one to move between
  // them, so it wants three where align wants two (SELECTION_CONDITIONS::
  // MoreThan( 2 )).
  const distributeDisabled = selection.size < 3;
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
        { label: 'Open…', disabled: dis },
        { sep: true },
        {
          label: 'Save',
          action: () => onTopAction('save'),
          shortcut: 'Ctrl+S',
        },
        { label: 'Save a Copy…', action: saveCopy },
        { sep: true },
        { label: 'Import', disabled: dis },
        { label: 'Export', disabled: dis },
        { label: 'Fabrication Outputs', disabled: dis },
        { sep: true },
        { label: 'Close (back to project)', action: onExit, shortcut: 'Ctrl+W' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', action: undo, shortcut: 'Ctrl+Z' },
        { label: 'Redo', action: redo, shortcut: 'Ctrl+Y' },
        { sep: true },
        { label: 'Duplicate', action: duplicateSel, shortcut: 'Ctrl+D' },
        { label: 'Delete', action: deleteSel, shortcut: 'Del' },
        { sep: true },
        {
          label: 'Align/Distribute',
          submenu: [
            {
              label: 'Align to Left',
              action: () => alignSelection('left'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Horizontal Center',
              action: () => alignSelection('centerX'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Right',
              action: () => alignSelection('right'),
              disabled: alignDisabled,
            },
            { sep: true },
            {
              label: 'Align to Top',
              action: () => alignSelection('top'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Vertical Center',
              action: () => alignSelection('centerY'),
              disabled: alignDisabled,
            },
            {
              label: 'Align to Bottom',
              action: () => alignSelection('bottom'),
              disabled: alignDisabled,
            },
            { sep: true },
            {
              label: 'Distribute Horizontally by Centers',
              action: () => distributeSelection('horizontallyCenters'),
              disabled: distributeDisabled,
            },
            {
              label: 'Distribute Horizontally by Gaps',
              action: () => distributeSelection('horizontallyGaps'),
              disabled: distributeDisabled,
            },
            {
              label: 'Distribute Vertically by Centers',
              action: () => distributeSelection('verticallyCenters'),
              disabled: distributeDisabled,
            },
            {
              label: 'Distribute Vertically by Gaps',
              action: () => distributeSelection('verticallyGaps'),
              disabled: distributeDisabled,
            },
          ],
        },
        {
          label: 'Convert',
          submenu: [
            {
              label: 'Create Polygon from Selection…',
              action: () => convertSelection('poly'),
              disabled: selection.size === 0,
            },
            {
              label: 'Create Zone from Selection…',
              action: () => convertSelection('zone'),
              disabled: selection.size === 0,
            },
            {
              label: 'Create Rule Area from Selection…',
              action: () => convertSelection('ruleArea'),
              disabled: selection.size === 0,
            },
            { sep: true },
            {
              label: 'Create Lines from Selection…',
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
          label: 'Create Array…',
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
          label: 'Outset Items…',
          action: () => setOutsetOpen(true),
          disabled: selection.size === 0,
        },
        {
          label: 'Modify Lines',
          submenu: [
            {
              label: 'Fillet Lines…',
              action: () => setLineModOpen('fillet'),
              disabled: lineModDisabled,
            },
            {
              label: 'Chamfer Lines…',
              action: () => setLineModOpen('chamfer'),
              disabled: lineModDisabled,
            },
            {
              label: 'Dogbone Corners…',
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
          label: 'Move Exactly…',
          action: () => setMoveExactOpen(true),
          shortcut: 'Shift+M',
          disabled: selection.size === 0,
        },
        {
          label: 'Position Relative To…',
          action: () => setPosRelOpen(true),
          shortcut: 'Shift+P',
          disabled: selection.size === 0,
        },
        {
          label: 'Filter Selection…',
          action: () => setFilterOpen(true),
          disabled: selection.size === 0,
        },
        { sep: true },
        { label: 'Find', action: () => setFindOpen(true), shortcut: 'Ctrl+F' },
        { sep: true },
        { label: 'Properties…', action: () => openTrackViaProperties(), shortcut: 'E' },
        { label: 'Change Side / Flip', action: () => flipSelection(), shortcut: 'F' },
        { sep: true },
        { label: 'Edit Teardrops…', action: () => setTeardropsOpen(true) },
        { sep: true },
        { label: 'Global Deletions…', disabled: dis },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', action: () => zoomStep(1.3), shortcut: 'Ctrl++' },
        { label: 'Zoom Out', action: () => zoomStep(1 / 1.3), shortcut: 'Ctrl+-' },
        { label: 'Zoom to Fit', action: zoomToFit, shortcut: 'Ctrl+0' },
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
        { label: 'Footprint…', disabled: dis },
        { label: 'Via', disabled: dis },
        { label: 'Zone', disabled: dis },
        { label: 'Text', disabled: dis },
        { label: 'Dimension', disabled: dis },
        { sep: true },
        { label: 'Drill/Place File Origin', disabled: dis },
        { label: 'Grid Origin', disabled: dis },
      ],
    },
    {
      label: 'Route',
      items: [
        { label: 'Single Track', disabled: dis, shortcut: 'X' },
        { label: 'Differential Pair', disabled: dis },
        { sep: true },
        { label: 'Tune Length of a Single Track', disabled: dis },
        { label: 'Tune Length of a Differential Pair', disabled: dis },
        { label: 'Tune Skew of a Differential Pair', disabled: dis },
        { sep: true },
        {
          label: 'Interactive Router Settings…',
          action: () => setPnsSettingsOpen(true),
        },
      ],
    },
    {
      label: 'Inspect',
      items: [
        { label: 'Measure Tool', disabled: dis, shortcut: 'Ctrl+Shift+M' },
        { label: 'Board Statistics', disabled: dis },
        { sep: true },
        // Upstream names these by what is being resolved, and which one you
        // get depends on how many items are selected.
        {
          label: 'Clearance Resolution…',
          disabled: dis || selection.size !== 2,
          action: () => setInspectOpen(true),
        },
        {
          label: 'Constraints Resolution…',
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
          label: 'Update PCB from Schematic…',
          action: () => void openUpdatePcb(),
          disabled: !onShowSchematic,
          shortcut: 'F8',
        },
        { label: 'Update Footprints from Library…', disabled: dis },
        { sep: true },
        { label: 'Remove Unused Pads…', disabled: dis },
        { label: 'Cleanup Tracks & Vias…', disabled: dis },
      ],
    },
    {
      label: 'Preferences',
      items: [{ label: 'Preferences…', disabled: dis, shortcut: 'Ctrl+,' }],
    },
    { label: 'Help', items: [{ label: 'About Ziro Designer', action: () => setAboutOpen(true) }] },
  ];

  // ----- unit display ---------------------------------------------------------

  const fmtCoord = (iu: number): string => {
    const mm = iuToMM(iu);
    if (toggles.has('unitsInches')) return (mm / 25.4).toFixed(4);
    if (toggles.has('unitsMils')) return ((mm / 25.4) * 1000).toFixed(2);
    return mm.toFixed(4);
  };
  const fmtAngle = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(3)}`;
  const unitLabel = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const statusCoordText = cursor ? `X ${fmtCoord(cursor.x)}  Y ${fmtCoord(cursor.y)}` : 'X, Y -';
  const statusDeltaText = cursor
    ? toggles.has('togglePolarCoords')
      ? `r ${fmtCoord(Math.hypot(cursor.x, cursor.y))}  theta ${fmtAngle(Math.atan2(-cursor.y, cursor.x))}`
      : `dx ${fmtCoord(cursor.x)}  dy ${fmtCoord(cursor.y)}  dist ${fmtCoord(Math.hypot(cursor.x, cursor.y))}`
    : toggles.has('togglePolarCoords')
      ? 'r, theta -'
      : 'dx, dy, dist -';
  const gridText = `grid ${fmtCoord(gridIU)}`;
  // TOP_AUX combo formatting (PCB_EDIT_FRAME::ComboBoxUnits): mm at %.3f,
  // mils at %.2f.
  const auxMM = (iu: number): string => iuToMM(iu).toFixed(3);
  const auxMils = (iu: number): string => ((iuToMM(iu) / 25.4) * 1000).toFixed(2);
  const auxSepStyle: CSSProperties = { width: 1, alignSelf: 'stretch', background: '#333' };
  // Zoom selector value (EDA_DRAW_FRAME::OnUpdateSelectZoom): snap to a preset
  // within 1%, else surface the live zoom as a dynamic custom entry.
  const zoomNow = zoomFactorForScale(scale, window.devicePixelRatio || 1);
  const zoomPreset = PCB_ZOOMS.find((z) => Math.abs(z - zoomNow) / z < 0.01);
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
  const messagePanelItems: MsgPanelItem[] = useMemo(() => {
    if (!board)
      return [
        { upper: 'Pads', lower: '0' },
        { upper: 'Vias', lower: '0' },
        { upper: 'Track Segments', lower: '0' },
        { upper: 'Nets', lower: '0' },
        { upper: 'Unrouted', lower: '0' },
      ];

    const net = (code: number): string =>
      board.nets.get(code) || (code === 0 ? '<no net>' : `net ${code}`);
    const itemPos = (bbox: BoardBBox | null): string =>
      bbox ? `X ${fmtCoord(bboxCenter(bbox).x)}  Y ${fmtCoord(bboxCenter(bbox).y)}` : '';
    const selectedIds = [...selection];

    if (selectedIds.length === 0) {
      const padCount = board.footprints.reduce((sum, fp) => sum + fp.pads.length, 0);
      return [
        { upper: 'Pads', lower: String(padCount) },
        { upper: 'Vias', lower: String(board.vias.length) },
        { upper: 'Track Segments', lower: String(board.tracks.length + board.arcs.length) },
        { upper: 'Nets', lower: String(Math.max(0, board.nets.size - 1)) },
        { upper: 'Unrouted', lower: String(ratsnestEdges.length) },
      ];
    }

    if (selectedIds.length === 1) {
      const id = selectedIds[0]!;
      const r = parseBoardItemId(id);
      const bbox = boardItemBBox(board, id);
      const common = [
        { upper: 'Item', lower: describeBoardItem(board, id) },
        { upper: 'Position', lower: itemPos(bbox) },
      ];
      if (!r) return common;

      switch (r.kind) {
        case 'footprint': {
          const fp = board.footprints[r.index];
          if (!fp) return common;
          // FOOTPRINT::GetMsgPanelInfo (board editor): reference→value, board
          // side, rotation, then status/attributes, matching pcbnew exactly.
          const attrLabel: Record<string, string> = {
            board_only: 'not in schematic',
            exclude_from_pos_files: 'exclude from pos files',
            exclude_from_bom: 'exclude from BOM',
            dnp: 'DNP',
          };
          const attrs = (fp.attributes ?? []).map((a) => attrLabel[a] ?? a).join(', ');
          const status = fp.locked ? 'Locked' : '';
          return [
            { upper: fp.reference || '', lower: fp.value || '' },
            { upper: 'Board Side', lower: fp.layer === 'B.Cu' ? 'Back (Flipped)' : 'Front' },
            { upper: 'Rotation', lower: String(Number(fp.angle.toPrecision(4))) },
            { upper: `Status: ${status}`, lower: `Attributes: ${attrs}` },
          ];
        }
        case 'track': {
          const t = board.tracks[r.index];
          return t
            ? [
                { upper: 'Track', lower: t.layer },
                { upper: 'Net', lower: net(t.net) },
                { upper: 'Width', lower: fmtCoord(t.width) },
                ...common.slice(1),
              ]
            : common;
        }
        case 'arc': {
          const a = board.arcs[r.index];
          return a
            ? [
                { upper: 'Arc', lower: a.layer },
                { upper: 'Net', lower: net(a.net) },
                { upper: 'Width', lower: fmtCoord(a.width) },
                ...common.slice(1),
              ]
            : common;
        }
        case 'via': {
          const v = board.vias[r.index];
          return v
            ? [
                { upper: 'Via', lower: v.kind },
                { upper: 'Net', lower: net(v.net) },
                { upper: 'Size', lower: fmtCoord(v.size) },
                { upper: 'Drill', lower: fmtCoord(v.drill) },
                { upper: 'Position', lower: `X ${fmtCoord(v.at.x)}  Y ${fmtCoord(v.at.y)}` },
              ]
            : common;
        }
        case 'zone': {
          const z = board.zones[r.index];
          return z
            ? [
                { upper: 'Zone', lower: z.netName ?? net(z.net) },
                { upper: 'Layers', lower: z.layers.join(', ') },
                ...common.slice(1),
              ]
            : common;
        }
        case 'shape': {
          const s = board.shapes[r.index];
          return s
            ? [
                { upper: 'Graphic', lower: s.kind },
                { upper: 'Layer', lower: s.layer },
                { upper: 'Width', lower: fmtCoord(s.width) },
                ...common.slice(1),
              ]
            : common;
        }
        case 'text': {
          const t = board.texts[r.index];
          return t
            ? [
                { upper: 'Text', lower: t.text },
                { upper: 'Layer', lower: t.layer },
                { upper: 'Position', lower: `X ${fmtCoord(t.at.x)}  Y ${fmtCoord(t.at.y)}` },
              ]
            : common;
        }
        case 'fptext': {
          const fp = board.footprints[r.index];
          const t = fp?.texts[r.sub ?? 0];
          return t
            ? [
                { upper: 'Footprint Text', lower: t.text },
                { upper: 'Footprint', lower: fp?.reference || fp?.lib || '' },
                { upper: 'Layer', lower: t.layer },
                { upper: 'Position', lower: `X ${fmtCoord(t.at.x)}  Y ${fmtCoord(t.at.y)}` },
              ]
            : common;
        }
        case 'pad': {
          const fp = board.footprints[r.index];
          const p = fp?.pads[r.sub ?? 0];
          if (!p) return common;
          // PAD::GetMsgPanelInfo (board editor): Footprint, Pad, Net, Layer,
          // shape/type, size + rotation, then hole, matching pcbnew's order.
          const dim = (iu: number): string => `${fmtCoord(iu)} ${unitLabel}`;
          const shapeLabel = p.shape.charAt(0).toUpperCase() + p.shape.slice(1);
          // Pad type abbreviations (ShowPadAttr): plated/non-plated through hole,
          // SMD, connector.
          const padType =
            p.type === 'thru_hole'
              ? 'PTH'
              : p.type === 'np_thru_hole'
                ? 'NPTH'
                : p.type === 'smd'
                  ? 'SMD'
                  : p.type === 'connect'
                    ? 'Connector'
                    : p.type;
          const sizeItems =
            p.shape === 'circle'
              ? [{ upper: 'Diameter', lower: dim(p.size.x) }]
              : [
                  { upper: 'Width', lower: dim(p.size.x) },
                  { upper: 'Height', lower: dim(p.size.y) },
                ];
          const holeItems = p.drill
            ? [
                {
                  upper: p.drill.oblong ? 'Hole X / Y' : 'Hole',
                  lower: p.drill.oblong
                    ? `${fmtCoord(p.drill.w)} / ${fmtCoord(p.drill.h)} ${unitLabel}`
                    : dim(p.drill.w),
                },
              ]
            : [];
          const pinItems = [
            ...(p.pinFunction ? [{ upper: 'Pin Name', lower: p.pinFunction }] : []),
            ...(p.pinType ? [{ upper: 'Pin Type', lower: p.pinType }] : []),
          ];
          return [
            { upper: 'Footprint', lower: fp?.reference || fp?.lib || '' },
            { upper: 'Pad', lower: p.number },
            ...pinItems,
            { upper: 'Net', lower: net(p.net ?? 0) },
            { upper: 'Resolved Netclass', lower: netClassOf.get(p.net ?? 0) ?? 'Default' },
            { upper: 'Layer', lower: p.layers.join(', ') },
            { upper: shapeLabel, lower: padType },
            ...sizeItems,
            { upper: 'Rotation', lower: String(Number((p.angle ?? 0).toPrecision(4))) },
            ...holeItems,
          ];
        }
      }
    }

    const labels: Partial<Record<BoardItemKind, string>> = {
      footprint: 'Footprints',
      fptext: 'Footprint Text',
      pad: 'Pads',
      track: 'Tracks',
      arc: 'Arcs',
      via: 'Vias',
      zone: 'Zones',
      shape: 'Graphics',
      text: 'Text',
    };
    const counts = new Map<string, number>();
    for (const id of selectedIds) {
      const r = parseBoardItemId(id);
      const label = r ? (labels[r.kind] ?? r.kind) : 'Items';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [
      { upper: 'Selection', lower: `${selectedIds.length} items` },
      ...[...counts.entries()].map(([upper, count]) => ({ upper, lower: String(count) })),
    ];
  }, [board, fmtCoord, ratsnestEdges.length, selection, netClassOf, unitLabel]);

  // Top-toolbar enablement. Save follows the dirty flag; the toolbar's Group /
  // Ungroup grey out per GROUP_TOOL::update, Group needs >= 2 selected items,
  // Ungroup needs a selected group. (Add / Remove to Group are right-click-only
  // in KiCad; they live in the grouping context menu, not the toolbar.)
  const topDisabled = useMemo(() => {
    const s = new Set<string>();
    if (!dirty) s.add('save');
    let groupCount = 0;
    for (const id of selection) {
      if (parseBoardItemId(id)?.kind === 'group') groupCount++;
    }
    if (selection.size < 2) s.add('group');
    if (groupCount === 0) s.add('ungroup');
    return s;
  }, [dirty, selection]);

  return (
    <div className="ze-app">
      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onExit} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
        title={
          <>
            <b>
              {dirty ? '*' : ''}
              {projectName || fileName.replace(/\.kicad_pcb$/i, '') || 'No project'}
            </b>
            &nbsp;-&nbsp;PCB Editor
          </>
        }
      />
      <Toolbar
        entries={PCB_TOP_TOOLBAR}
        orientation="horizontal"
        disabledIds={topDisabled}
        onActivate={onTopAction}
      />

      {/* TOP_AUX bar (toolbars_pcb_editor.cpp TOOLBAR_LOC::TOP_AUX): track
          width + auto-width | via size | layer selector + layer pair | grid |
          zoom | override locks. Combo texts follow UpdateTrackWidthSelectBox /
          UpdateViaSizeSelectBox / GRID_MENU::BuildChoiceList /
          UpdateZoomSelectBox exactly. */}
      <div
        className="ze-auxbar"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '2px 8px',
          borderBottom: '1px solid #333',
          fontSize: 12,
        }}
      >
        <select
          title="Track width"
          value={trackSel}
          onChange={(e) => setTrackSel(Number(e.target.value))}
        >
          <option value={0}>Track: use netclass width</option>
          {trackWidthList.map((w, i) => (
            <option key={`${w}:${i}`} value={i + 1}>
              Track: {auxMM(w)} mm ({auxMils(w)} mil)
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled
          title="Auto track width: when routing from an existing track use its width, otherwise, use the current width setting"
          style={{ opacity: 0.4 }}
        >
          auto
        </button>
        <span style={auxSepStyle} />
        <select title="Via size" value={viaSel} onChange={(e) => setViaSel(Number(e.target.value))}>
          <option value={0}>Via: use netclass sizes</option>
          {viaSizeList.map((v, i) => (
            <option key={`${v.diameter}:${v.drill}:${i}`} value={i + 1}>
              {v.drill > 0
                ? `Via: ${auxMM(v.diameter)} / ${auxMM(v.drill)} mm (${auxMils(v.diameter)} / ${auxMils(v.drill)} mil)`
                : `Via: ${auxMM(v.diameter)} mm (${auxMils(v.diameter)} mil)`}
            </option>
          ))}
        </select>
        <span style={auxSepStyle} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: layerColor(activeLayer),
              borderRadius: 2,
              border: '1px solid #444',
            }}
          />
          <select
            value={activeLayer}
            onChange={(e) => setActiveLayer(e.target.value)}
            title="Active layer"
          >
            {(board?.layers ?? []).map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </span>
        <button
          type="button"
          disabled
          title="Select the layer pair for routing vias"
          style={{ opacity: 0.4 }}
        >
          pair
        </button>
        <span style={auxSepStyle} />
        <select
          title="Grid"
          value={gridIU}
          onChange={(e) => {
            setGridIU(Number(e.target.value));
            requestDraw();
          }}
        >
          {PCB_GRIDS.map((g) => (
            <option key={g} value={g}>
              {fmtCoord(g)} {unitLabel} (
              {toggles.has('unitsMils') ? `${auxMM(g)} mm` : `${auxMils(g)} mil`})
            </option>
          ))}
          {!PCB_GRIDS.includes(gridIU) && (
            <option value={gridIU}>
              {fmtCoord(gridIU)} {unitLabel}
            </option>
          )}
        </select>
        <span style={auxSepStyle} />
        <select
          title="Zoom"
          value={zoomSelValue}
          onChange={(e) => {
            if (e.target.value === 'auto') zoomToFit();
            else setZoomPreset(Number(e.target.value));
          }}
        >
          <option value="auto">Zoom Auto</option>
          {zoomCustom !== null && <option value={zoomCustom}>Zoom {zoomCustom.toFixed(2)}</option>}
          {PCB_ZOOMS.map((z) => (
            <option key={z} value={z}>
              Zoom {z.toFixed(2)}
            </option>
          ))}
        </select>
        <span style={auxSepStyle} />
        <button
          type="button"
          disabled
          title="Override locks: allow editing locked items"
          style={{ opacity: 0.4 }}
        >
          locks
        </button>
      </div>

      <div className="ze-body">
        {/* KiCad docks the Properties pane outermost-left (Layer 5), then the
            left options toolbar (Layer 3), then the canvas. */}
        {showProperties && (
          <div
            className="ze-leftdock"
            style={{ width: propWidth, minWidth: 240, position: 'relative' }}
          >
            <div className="ze-panel grow">
              <div className="ze-panel-header">Properties</div>
              <div className="ze-panel-body">
                {selection.size === 0 ? (
                  <div className="ze-muted">No objects selected</div>
                ) : (
                  <PcbSelectionInfo
                    board={board}
                    selection={selection}
                    onEditFootprint={editFootprint}
                    onEdit={commitBoard}
                  />
                )}
              </div>
            </div>
            <div
              onPointerDown={startPropResize}
              title="Resize"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 5,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 2,
              }}
            />
          </div>
        )}

        <Toolbar
          entries={PCB_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={leftToggles}
          disabledIds={leftDisabled}
          onActivate={onLeftToggle}
        />

        <div className="ze-canvas-wrap" ref={wrapRef} style={{ position: 'relative' }}>
          {readOnlyNotice}
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
              cursor: activeTool === 'localRatsnestTool' ? 'crosshair' : 'default',
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
          {GL_RENDERER && (
            <canvas
              ref={glCanvasRef}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            />
          )}
          {/* Everything above the board: selection, ratsnest, umbilicals, the
              in-flight previews, DRC markers and the crosshair. Split out only
              because the GL layer has to go between it and the background;
              without the GL renderer `draw` paints all of it onto the one
              canvas as before. */}
          {GL_RENDERER && (
            <canvas
              ref={overCanvasRef}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            />
          )}
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
              <span>Loading board… (large boards can take a while)</span>
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

        <Toolbar
          entries={PCB_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={setActiveTool}
        />

        {/* LayersManager + SelectionFilter dock: Right().Layer(4), outside the
            Right().Layer(3) toolbar (pcb_edit_frame.cpp AUI setup), i.e. at the
            window edge with the toolbar between it and the canvas. */}
        {showAppearance && (
          <div className="ze-rightdock" style={{ width: appWidth, position: 'relative' }}>
            <div
              onPointerDown={startAppResize}
              title="Resize"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 5,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 2,
              }}
            />
            <div className="ze-panel grow">
              <div className="ze-panel-header">Appearance</div>
              {/* tabs, like APPEARANCE_CONTROLS' notebook */}
              <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
                {(['Layers', 'Objects', 'Nets'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1,
                      padding: '4px 0',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: tab === t ? '#2a2a2e' : 'transparent',
                      color: 'inherit',
                      border: 'none',
                      borderBottom: tab === t ? '2px solid #4d7fc4' : '2px solid transparent',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="ze-panel-body" style={{ overflow: 'auto' }}>
                {tab === 'Layers' &&
                  layerRows.map((name) => {
                    const on = visible.has(name);
                    return (
                      // appendLayer row: [indicator][color swatch][eye][name]
                      <div
                        key={name}
                        className={`ze-layer-row${name === activeLayer ? ' active' : ''}`}
                        onClick={() => setActiveLayer(name)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setLayerMenu({ x: e.clientX, y: e.clientY });
                        }}
                        title={layerTooltip(name)}
                      >
                        <span
                          className={`ze-layer-indicator${name === activeLayer ? ' on' : ''}`}
                        />
                        <span
                          className="ze-layer-swatch"
                          style={{ background: layerColor(name) }}
                        />
                        <button
                          type="button"
                          className="ze-eye-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLayer(name);
                          }}
                          title="Show or hide this layer"
                        >
                          <EyeIcon on={on} />
                        </button>
                        <span className="ze-ellipsis">{LAYER_DISPLAY_NAMES[name] ?? name}</span>
                      </div>
                    );
                  })}

                {tab === 'Objects' &&
                  OBJECT_ROWS.map((row, i) => {
                    if (row === 'sep') return <div key={`sep${i}`} style={{ height: 8 }} />;
                    const { key, label, tooltip, slider, noVisibility, disabled } = row;
                    const on = objects[key];
                    const swatchColor = PCB_OBJECT_COLORS[key];
                    return (
                      // appendObject row: [swatch|spacer][eye|spacer][label][slider]
                      <div
                        key={key}
                        className="ze-object-row"
                        title={tooltip}
                        style={disabled ? { opacity: 0.4 } : undefined}
                      >
                        <span
                          className={`ze-layer-swatch${swatchColor ? '' : ' blank'}`}
                          style={swatchColor ? { background: swatchColor } : undefined}
                        />
                        {noVisibility ? (
                          <span style={{ width: 16, flex: '0 0 auto' }} />
                        ) : (
                          <button
                            type="button"
                            className="ze-eye-btn"
                            onClick={() => {
                              if (!disabled) setObjects((p) => toggleObject(p, key));
                            }}
                            title={`Show or hide ${label.toLowerCase()}`}
                          >
                            <EyeIcon on={on} />
                          </button>
                        )}
                        {/* Opacity rows fix the label width so all sliders line
                            up (KiCad's label->SetMinSize(labelWidth)); other
                            rows let the label fill the row. */}
                        <span className={`ze-obj-label${slider ? ' fixed' : ''}`}>{label}</span>
                        {slider &&
                          key in opacity &&
                          (() => {
                            const pct = Math.round(opacity[key as keyof typeof opacity] * 100);
                            return (
                              <input
                                type="range"
                                className="ze-opacity"
                                min={0}
                                max={100}
                                value={pct}
                                // Fill the track left of the thumb (KiCad's slider
                                // shows the set portion), the rest neutral grey.
                                style={{
                                  background: `linear-gradient(to right, var(--slider-fill) 0 ${pct}%, #55585d ${pct}% 100%)`,
                                }}
                                title={`Set opacity of ${label.toLowerCase()}`}
                                disabled={disabled}
                                onChange={(e) =>
                                  setOpacity((p) => ({
                                    ...p,
                                    [key]: Number(e.target.value) / 100,
                                  }))
                                }
                              />
                            );
                          })()}
                      </div>
                    );
                  })}

                {tab === 'Nets' && (
                  <>
                    {/* Nets box: header + filter + the scrollable net list, its
                        own panel like KiCad's nets/netclasses splitter. */}
                    <div className="ze-nets-box">
                      <div className="ze-nets-header">
                        <span>Nets</span>
                        <input
                          type="search"
                          placeholder="Filter nets"
                          value={netQuery}
                          onChange={(e) => setNetQuery(e.target.value)}
                        />
                      </div>
                      <div className="ze-nets-list">
                        {/* Net rows: [color swatch][visibility][name]; the swatch
                            opens a color picker, the eye hides the net's ratsnest. */}
                        {nets.slice(0, 400).map(([code, name]) => {
                          const color = netColors.get(code);
                          const on = !hiddenNets.has(code);
                          return (
                            <div key={code} className="ze-object-row" title={`Net ${code}`}>
                              <label
                                className={`ze-layer-swatch picker${color ? '' : ' unset'}`}
                                style={color ? { background: color } : undefined}
                                title="Set net color"
                              >
                                <input
                                  type="color"
                                  value={color ?? '#000000'}
                                  onChange={(e) =>
                                    setNetColors((p) => new Map(p).set(code, e.target.value))
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="ze-eye-btn"
                                title={`Show or hide ratsnest for ${name}`}
                                onClick={() =>
                                  setHiddenNets((p) => {
                                    const next = new Set(p);
                                    if (next.has(code)) next.delete(code);
                                    else next.add(code);
                                    return next;
                                  })
                                }
                              >
                                <EyeIcon on={on} />
                              </button>
                              <span className="ze-ellipsis">{name || `(unnamed ${code})`}</span>
                            </div>
                          );
                        })}
                        {nets.length > 400 && (
                          <div className="ze-muted">…{nets.length - 400} more</div>
                        )}
                      </div>
                    </div>

                    {/* Net Classes box: the lower panel of KiCad's nets splitter. */}
                    <div className="ze-nets-box">
                      <div className="ze-nets-header">
                        <span>Net Classes</span>
                      </div>
                      {netclassInfo.classes.map((cls) => {
                        const color = classColorOf(cls);
                        const on = !hiddenClasses.has(cls);
                        return (
                          <div key={cls} className="ze-object-row">
                            <label
                              className={`ze-layer-swatch picker${color ? '' : ' unset'}`}
                              style={color ? { background: color } : undefined}
                              title="Set netclass color"
                            >
                              <input
                                type="color"
                                value={color?.startsWith('#') ? color : '#000000'}
                                onChange={(e) =>
                                  setClassColors((p) => new Map(p).set(cls, e.target.value))
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="ze-eye-btn"
                              title={`Show or hide ratsnest for the ${cls} class`}
                              onClick={() =>
                                setHiddenClasses((p) => {
                                  const next = new Set(p);
                                  if (next.has(cls)) next.delete(cls);
                                  else next.add(cls);
                                  return next;
                                })
                              }
                            >
                              <EyeIcon on={on} />
                            </button>
                            <span className="ze-ellipsis">{cls}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* "Net Display Options" collapsible pane on the Nets tab. */}
              {tab === 'Nets' && (
                <div className="ze-collapsepane">
                  <button className="ze-collapse-toggle" onClick={() => setNetOptsOpen((o) => !o)}>
                    <span className={`ze-collapse-arrow${netOptsOpen ? ' open' : ''}`} />
                    Net Display Options
                  </button>
                  {netOptsOpen && (
                    <div className="ze-collapse-body">
                      <div className="ze-info" title="Choose when to show net and netclass colors">
                        Net colors:
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <label title="Net and netclass colors are shown on all copper items">
                          <input
                            type="radio"
                            name="ze-netcolor"
                            checked={netColorMode === 'all'}
                            onChange={() => setNetColorMode('all')}
                          />
                          All
                        </label>
                        <label title="Net and netclass colors are shown on the ratsnest only">
                          <input
                            type="radio"
                            name="ze-netcolor"
                            checked={netColorMode === 'ratsnest'}
                            onChange={() => setNetColorMode('ratsnest')}
                          />
                          Ratsnest
                        </label>
                        <label title="Net and netclass colors are not shown">
                          <input
                            type="radio"
                            name="ze-netcolor"
                            checked={netColorMode === 'off'}
                            onChange={() => setNetColorMode('off')}
                          />
                          None
                        </label>
                      </div>
                      <div className="ze-info" style={{ marginTop: 6 }}>
                        Ratsnest display:
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <label title="Show ratsnest lines to items on all layers">
                          <input
                            type="radio"
                            name="ze-ratsmode"
                            checked={ratsnestMode === 'all'}
                            onChange={() => setRatsnestMode('all')}
                          />
                          All
                        </label>
                        <label title="Show ratsnest lines to items on visible layers">
                          <input
                            type="radio"
                            name="ze-ratsmode"
                            checked={ratsnestMode === 'visible'}
                            onChange={() => setRatsnestMode('visible')}
                          />
                          Visible layers
                        </label>
                        <label title="Hide all ratsnest lines">
                          <input
                            type="radio"
                            name="ze-ratsmode"
                            checked={ratsnestMode === 'off'}
                            onChange={() => setRatsnestMode('off')}
                          />
                          None
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* "Layer Display Options" collapsible pane at the bottom of the
                  Layers tab (createControls). */}
              {tab === 'Layers' && (
                <div className="ze-collapsepane">
                  <button
                    className="ze-collapse-toggle"
                    onClick={() => setLayerOptsOpen((o) => !o)}
                  >
                    <span className={`ze-collapse-arrow${layerOptsOpen ? ' open' : ''}`} />
                    Layer Display Options
                  </button>
                  {layerOptsOpen && (
                    <div className="ze-collapse-body">
                      <div className="ze-info">Inactive layers (H):</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <label title="Inactive layers will be shown in full color">
                          <input
                            type="radio"
                            name="ze-hc"
                            checked={contrast === 'normal'}
                            onChange={() => setContrast('normal')}
                          />
                          Normal
                        </label>
                        <label title="Inactive layers will be dimmed">
                          <input
                            type="radio"
                            name="ze-hc"
                            checked={contrast === 'dim'}
                            onChange={() => setContrast('dim')}
                          />
                          Dim
                        </label>
                        <label title="Inactive layers will be hidden">
                          <input
                            type="radio"
                            name="ze-hc"
                            checked={contrast === 'hide'}
                            onChange={() => setContrast('hide')}
                          />
                          Hide
                        </label>
                      </div>
                      <hr className="ze-hr" />
                      <label>
                        <input type="checkbox" checked={flipView} onChange={toggleFlip} />
                        Flip board view
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Presets / Viewports below the notebook (appearance_controls_base). */}
              <div className="ze-appearance-bottom">
                <div className="ze-info">Presets (Ctrl+Tab):</div>
                <select value={preset} onChange={(e) => onPresetChoice(e.target.value)}>
                  {preset === '(unsaved)' && <option value="(unsaved)">(unsaved)</option>}
                  {PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                  {userPresets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                  <option value="---">---</option>
                  <option>Save preset...</option>
                  <option disabled={userPresets.length === 0}>Delete preset...</option>
                </select>
                <div className="ze-info" style={{ marginTop: 4 }}>
                  Viewports (Shift+Tab):
                </div>
                <select value={viewportSel} onChange={(e) => onViewportChoice(e.target.value)}>
                  {viewports.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                  <option value="---">---</option>
                  <option>Save viewport...</option>
                  <option disabled={viewports.length === 0}>Delete viewport...</option>
                </select>
              </div>
            </div>

            <div className="ze-panel">
              <div className="ze-panel-header">Selection Filter</div>
              <div className="ze-panel-body">
                {/* PANEL_SELECTION_FILTER_BASE's wxGridBagSizer: "All items"
                    at (0,0), then the categories two per row in upstream
                    order. Right-clicking a category pops "Only <label>". */}
                <div className="ze-selfilter">
                  <label>
                    <input
                      type="checkbox"
                      checked={selFilter.size === PCB_FILTER_CATS.length}
                      onChange={() =>
                        // OnFilterChanged on m_cbAllItems: drive every
                        // category to the new state.
                        setSelFilter((p) =>
                          p.size === PCB_FILTER_CATS.length
                            ? new Set()
                            : new Set(PCB_FILTER_CATS.map((c) => c.key)),
                        )
                      }
                    />
                    All items
                  </label>
                  {PCB_FILTER_CATS.map(({ key, label, tooltip }) => (
                    <label
                      key={key}
                      title={tooltip}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFilterMenu({ x: e.clientX, y: e.clientY, key, label });
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selFilter.has(key)}
                        onChange={() =>
                          setSelFilter((p) => {
                            const n = new Set(p);
                            if (n.has(key)) n.delete(key);
                            else n.add(key);
                            return n;
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {show3D && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgb(13,15,23)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 12px',
              borderBottom: '1px solid #333',
              fontSize: 13,
            }}
          >
            <b>3D Viewer</b>
            <span style={{ opacity: 0.6 }}>drag to orbit · wheel to zoom · Esc to close</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setShow3D(false)}>Close ✕</button>
          </div>
          <div
            ref={viewer3dRef}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              background: 'linear-gradient(180deg, rgb(204,204,230) 0%, rgb(102,102,128) 100%)',
            }}
          >
            {!viewer3dReady && (
              <div className="ze-canvas-loading">
                <span className="ze-spinner" />
                <span>Loading 3D viewer…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disambiguation menu (PCB_SELECTION_TOOL::doSelectionMenu): pick which of
          several overlapping items to select; hovering a row previews it. */}
      {disambig && board && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => {
              hoverRef.current = null;
              setDisambig(null);
              requestDraw();
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(disambig.x, window.innerWidth - 220),
              top: disambig.y,
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 190,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '2px 12px 4px', opacity: 0.6 }}>Clarify Selection</div>
            {disambig.ids.map((id) => (
              <div
                key={id}
                className="ze-tree-item"
                style={{ padding: '3px 12px', cursor: 'pointer' }}
                onMouseEnter={() => {
                  hoverRef.current = id;
                  requestDraw();
                }}
                onMouseLeave={() => {
                  if (hoverRef.current === id) {
                    hoverRef.current = null;
                    requestDraw();
                  }
                }}
                onClick={() => {
                  hoverRef.current = null;
                  applySelect(id, disambig.additive);
                  setDisambig(null);
                }}
              >
                {describeBoardItem(board, id)}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Selection Filter right-click menu (PANEL_SELECTION_FILTER::onRightClick):
          a single "Only <category>" entry that unchecks everything else. */}
      {filterMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setFilterMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setFilterMenu(null);
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(filterMenu.x, window.innerWidth - 200),
              top: filterMenu.y,
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 160,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="ze-tree-item"
              style={{ padding: '3px 12px', cursor: 'pointer' }}
              onClick={() => {
                setSelFilter(new Set([filterMenu.key]));
                setFilterMenu(null);
              }}
            >
              Only {filterMenu.label.toLowerCase()}
            </div>
          </div>
        </>
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
                    style={{ padding: '3px 12px', cursor: 'pointer' }}
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
                style={{ padding: '3px 12px', cursor: 'pointer' }}
                onClick={() => {
                  if (deleteChooser === 'presets') {
                    setUserPresets((u) => u.filter((x) => x.name !== p.name));
                    if (preset === p.name) setPreset('(unsaved)');
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
              Layer: {LAYER_DISPLAY_NAMES[activeLayer] ?? activeLayer}
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
          value={{
            paper: board.paper ?? 'A4',
            title: board.titleBlock?.title ?? '',
            date: board.titleBlock?.date ?? '',
            rev: board.titleBlock?.rev ?? '',
            company: board.titleBlock?.company ?? '',
            comments: Array.from({ length: 9 }, (_, i) => board.titleBlock?.comments?.[i] ?? ''),
          }}
          sheetCount={1}
          sheetNumber={1}
          onOk={(next) => {
            const brd = boardRef.current;
            if (brd)
              commitBoard(
                setBoardPageSettings(brd, {
                  paper: next.paper,
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
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {updatePcbBusy && (
        <div className="ze-modal-backdrop ze-loading-backdrop">
          <div className="ze-loading-card">
            <span className="ze-spinner" />
            Loading footprint libraries…
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
        <DialogTableProperties
          initial={collectTableValues({ ...pendingTable, source: EMPTY_SLIST })}
          layers={board?.layers.map((l) => l.name) ?? []}
          onApply={(values) => {
            const brd = boardRef.current;
            const tbl = pendingTable;
            setPendingTable(null);
            if (!brd || !tbl) return;
            const { board: withTable, id } = addBoardTable(brd, tbl);
            const index = parseBoardItemId(id)?.index ?? 0;
            // One commit, so placing a table is a single undo step.
            commitBoard(applyTableValues(withTable, index, values));
          }}
          onClose={() => setPendingTable(null)}
        />
      )}
      {pendingTextBox && (
        <DialogTextBoxProperties
          initial={collectTextBoxValues({ ...pendingTextBox, source: EMPTY_SLIST })}
          layers={board?.layers.map((l) => l.name) ?? []}
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
        <DialogTableProperties
          initial={collectTableValues(board.tables[tablePropsIndex]!)}
          layers={board.layers.map((l) => l.name)}
          onApply={applyTableEdit}
          onClose={() => setTablePropsIndex(null)}
        />
      )}
      {textBoxPropsIndex !== null && board?.textBoxes[textBoxPropsIndex] && (
        <DialogTextBoxProperties
          initial={collectTextBoxValues(board.textBoxes[textBoxPropsIndex]!)}
          layers={board.layers.map((l) => l.name)}
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
      <div className="ze-msgpanel" data-testid="pcb-message-panel">
        {messagePanelItems.map((item) => (
          <div className="ze-msgpanel-item" key={`${item.upper}:${item.lower}`}>
            <div className="ze-msgpanel-upper">{item.upper}</div>
            <div className="ze-msgpanel-lower">{item.lower || '\u00a0'}</div>
          </div>
        ))}
      </div>

      {/* pcbnew's 8-field KISTATUSBAR (eda_draw_frame.cpp updateStatusBarWidths):
          message (grows) | Z zoom | absolute X/Y | relative dx/dy/dist or polar
          r/theta | grid | units | current-tool (grows) | constraint mode. */}
      <div className="ze-statusbar">
        <span className="cell msg" data-testid="pcb-status-msg" />
        <StatusField template={STATUS_FIELD_TEMPLATES.zoom}>
          Z {scale > 0 ? zoomFactorForScale(scale, window.devicePixelRatio || 1).toFixed(2) : '-'}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.coords} testId="pcb-absolute-coords">
          {statusCoordText}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.deltas} testId="pcb-relative-coords">
          {statusDeltaText}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.grid}>{gridText}</StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.units}>
          {unitLabel === 'in' ? 'inches' : unitLabel}
        </StatusField>
        <span className="cell tool" data-testid="pcb-tool-msg">
          {toolMsg}
        </span>
        <StatusField template={STATUS_FIELD_TEMPLATES.constraint} testId="pcb-constraint-msg">
          {constraintMsg}
        </StatusField>
      </div>
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
      const z = board.zones[r.index];
      return z ? `Zone · ${z.netName ?? net(z.net)}` : 'Zone';
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

// ---- KiCad property-grid components (PCB_PROPERTIES_PANEL wxPropertyGrid) -----
// White name/value text, grey read-only, category bars with the GTK disclosure
// chevron reused from the project tree, styled by .ze-pg* in shell.css.

/** A collapsible category header (wxPropertyCategory). */
const PgCat = ({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}): JSX.Element => (
  <div className="ze-pg-cat" onClick={onToggle}>
    <span className={`twisty expandable${open ? ' open' : ''}`} />
    <span>{label}</span>
  </div>
);
/** Name | value row. */
const PgRow = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div className="ze-pg-row">
    <div className="k" title={label}>
      {label}
    </div>
    <div className="v">{children}</div>
  </div>
);
/** Read-only value (greyed). */
const PgRO = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <div className="ze-pg-row">
    <div className="k" title={label}>
      {label}
    </div>
    <div className="v ro" title={value}>
      {value}
    </div>
  </div>
);
/** A checkbox value; editable when `onChange` is supplied. */
const PgCheck = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
}): JSX.Element => (
  <PgRow label={label}>
    <input
      type="checkbox"
      checked={checked}
      readOnly={!onChange}
      onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
      style={{ margin: 0 }}
    />
  </PgRow>
);
/** A layer value: color swatch + name. */
const PgLayer = ({
  label,
  layer,
  color,
}: {
  label: string;
  layer: string;
  color: string;
}): JSX.Element => (
  <PgRow label={label}>
    <span className="ze-pg-swatch" style={{ background: color }} />
    <span>{layer}</span>
  </PgRow>
);
/** An editable value cell: shows text; click to edit; Enter/blur commits. */
function PgEdit({
  label,
  value,
  suffix,
  onCommit,
}: {
  label: string;
  value: string;
  suffix?: string;
  onCommit?: (v: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    setEditing(false);
    if (onCommit && draft !== value) onCommit(draft);
  };
  return (
    <PgRow label={label}>
      {editing && onCommit ? (
        <input
          className="pg-edit"
          value={draft}
          // biome-ignore lint/a11y/noAutofocus: focus the just-opened cell editor
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span
          style={{ cursor: onCommit ? 'text' : 'default', width: '100%' }}
          onClick={() => {
            if (onCommit) {
              setDraft(value);
              setEditing(true);
            }
          }}
        >
          {value}
          {suffix ? ` ${suffix}` : ''}
        </span>
      )}
    </PgRow>
  );
}

/** Footprint orientation the KiCad way: normalized to (-180°, 180°], trimmed. */
const fmtOrient = (deg: number): string => {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return String(Number.parseFloat(a.toFixed(4)));
};

/** A footprint edit from the Properties grid (PCB_PROPERTIES_PANEL fields). */
type FpEdit =
  | { kind: 'pos'; axis: 'x' | 'y'; valueMM: number }
  | { kind: 'orient'; deg: number }
  | { kind: 'field'; field: 'reference' | 'value'; value: string }
  | { kind: 'locked'; locked: boolean };

/** The FOOTPRINT property grid (collapsible categories; editable fields). */
function FootprintProps({
  fp,
  index,
  onEdit,
}: {
  fp: PcbFootprint;
  index: number;
  onEdit?: (index: number, e: FpEdit) => void;
}): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({
    Basic: true,
    Fields: true,
    Attributes: true,
    Overrides: true,
  });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));
  const mm = (iu: number): string => iuToMM(iu).toFixed(4);
  const attrs = fp.attributes ?? [];
  const has = (a: string): boolean => attrs.includes(a);
  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Footprint</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgEdit
            label="Position X"
            value={mm(fp.at.x)}
            suffix="mm"
            onCommit={
              onEdit
                ? (v) => onEdit(index, { kind: 'pos', axis: 'x', valueMM: Number(v) })
                : undefined
            }
          />
          <PgEdit
            label="Position Y"
            value={mm(fp.at.y)}
            suffix="mm"
            onCommit={
              onEdit
                ? (v) => onEdit(index, { kind: 'pos', axis: 'y', valueMM: Number(v) })
                : undefined
            }
          />
          <PgCheck
            label="Locked"
            checked={!!fp.locked}
            onChange={onEdit ? (c) => onEdit(index, { kind: 'locked', locked: c }) : undefined}
          />
          <PgLayer label="Layer" layer={fp.layer} color={layerColor(fp.layer)} />
          <PgEdit
            label="Orientation"
            value={fmtOrient(fp.angle)}
            suffix="°"
            onCommit={onEdit ? (v) => onEdit(index, { kind: 'orient', deg: Number(v) }) : undefined}
          />
        </>
      )}
      <PgCat label="Fields" open={open.Fields ?? true} onToggle={() => toggle('Fields')} />
      {(open.Fields ?? true) && (
        <>
          <PgEdit
            label="Reference"
            value={fp.reference ?? ''}
            onCommit={
              onEdit
                ? (v) => onEdit(index, { kind: 'field', field: 'reference', value: v })
                : undefined
            }
          />
          <PgEdit
            label="Value"
            value={fp.value ?? ''}
            onCommit={
              onEdit ? (v) => onEdit(index, { kind: 'field', field: 'value', value: v }) : undefined
            }
          />
          <PgRO label="Library Link" value={fp.lib} />
          <PgRO label="Library Description" value={fp.descr ?? ''} />
          <PgRO label="Keywords" value={fp.tags ?? ''} />
          <PgRO label="Component Class" value="" />
        </>
      )}
      <PgCat
        label="Attributes"
        open={open.Attributes ?? true}
        onToggle={() => toggle('Attributes')}
      />
      {(open.Attributes ?? true) && (
        <>
          <PgCheck label="Not in Schematic" checked={has('board_only')} />
          <PgCheck label="Exclude From Position Files" checked={has('exclude_from_pos_files')} />
          <PgCheck label="Exclude From Bill of Materials" checked={has('exclude_from_bom')} />
          <PgCheck label="Do not Populate" checked={has('dnp')} />
        </>
      )}
      <PgCat label="Overrides" open={open.Overrides ?? true} onToggle={() => toggle('Overrides')} />
      {(open.Overrides ?? true) && (
        <>
          <PgCheck
            label="Exempt From Courtyard Requirement"
            checked={has('allow_missing_courtyard')}
          />
          <PgRO label="Clearance Override" value="" />
          <PgRO label="Solderpaste Margin Override" value="" />
          <PgRO label="Solderpaste Margin Ratio Override" value="" />
          <PgRO label="Zone Connection Style" value="Inherited" />
        </>
      )}
    </div>
  );
}

/** Read-only summary of the current selection for the Properties panel, the
 *  first slice of pcbnew's PCB_PROPERTIES_PANEL (editable fields come later). */
// Property-grid mm formatter (KiCad's PCB_PROPERTIES_PANEL shows 2 decimals).
const pgMM = (iu: number): string => `${iuToMM(iu).toFixed(2)} mm`;
/** The bare number a PgEdit cell shows for an IU length (no unit suffix). */
const pgNum = (iu: number): string => iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
/** Parse a millimetre cell back to IU, or undefined if it is not a number. */
const pgIU = (text: string): number | undefined => {
  const n = Number(text);
  return Number.isFinite(n) ? mmToIU(n) : undefined;
};

/**
 * An editable millimetre row: shows `1.23 mm`, commits IU.
 *
 * The panel edits live, one field at a time, so each commit runs the same
 * collect/apply pair the matching dialog uses — the property grid is a second
 * face on those modules, not a second implementation.
 */
const PgMM = ({
  label,
  iu,
  onCommit,
}: {
  label: string;
  iu: number;
  onCommit?: (iu: number) => void;
}): JSX.Element => (
  <PgEdit
    label={label}
    value={pgNum(iu)}
    suffix="mm"
    onCommit={
      onCommit
        ? (text) => {
            const v = pgIU(text);
            if (v !== undefined) onCommit(v);
          }
        : undefined
    }
  />
);

/** A choice row (wxEnumProperty). */
const PgChoice = <T extends string>({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onCommit?: (v: T) => void;
}): JSX.Element => (
  <PgRow label={label}>
    {onCommit ? (
      <select
        className="pg-edit"
        value={value}
        onChange={(e) => onCommit(e.target.value as T)}
        style={{ width: '100%' }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    ) : (
      <span>{options.find(([v]) => v === value)?.[1] ?? value}</span>
    )}
  </PgRow>
);

/**
 * An override cell: blank means inherit, which is not the same as zero.
 * Clearing the box drops the override rather than writing 0.
 */
const PgOverride = ({
  label,
  iu,
  onCommit,
}: {
  label: string;
  iu: number | null;
  onCommit?: (v: number | null) => void;
}): JSX.Element => (
  <PgEdit
    label={label}
    value={iu === null ? '' : pgNum(iu)}
    suffix={iu === null ? '' : 'mm'}
    onCommit={
      onCommit
        ? (text) => {
            if (text.trim() === '') {
              onCommit(null);
              return;
            }
            const v = pgIU(text);
            if (v !== undefined) onCommit(v);
          }
        : undefined
    }
  />
);

/** The PAD property grid (PCB_PROPERTIES_PANEL: PAD reflected properties). */
function PadProps({
  board,
  padRef,
  netName,
  onEdit,
}: {
  board: Board;
  padRef: PadRef;
  netName: (c: number) => string;
  onEdit?: (next: Board) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState<Record<string, boolean>>({
    Basic: true,
    Pad: true,
    Overrides: true,
  });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));

  const pad = board.footprints[padRef.footprint]?.pads[padRef.pad];
  if (!pad) return null;
  const v = collectPadValues(pad);

  const commit = onEdit
    ? (patch: Partial<PadValues>): void => onEdit(applyPadValues(board, padRef, { ...v, ...patch }))
    : undefined;

  // A through pad spans all copper (KiCad "All copper layers"); an SMD pad
  // names its single copper layer.
  const copperLayers = pad.layers.some((l) => l === '*.Cu')
    ? 'All copper layers'
    : pad.layers.filter((l) => /\.Cu$/.test(l)).join(', ') || pad.layers.join(', ');

  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Pad</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgMM label="Position X" iu={v.x} onCommit={commit ? (x) => commit({ x }) : undefined} />
          <PgMM label="Position Y" iu={v.y} onCommit={commit ? (y) => commit({ y }) : undefined} />
          <PgChoice
            label="Net"
            value={String(v.net)}
            options={[...board.nets.entries()].map(
              ([code, name]) => [String(code), name === '' ? '<no net>' : name] as const,
            )}
            onCommit={commit ? (n) => commit({ net: Number(n) }) : undefined}
          />
          <PgEdit
            label="Orientation"
            value={String(v.orientation)}
            suffix="°"
            onCommit={
              commit
                ? (t) => {
                    const n = Number(t);
                    if (Number.isFinite(n)) commit({ orientation: n });
                  }
                : undefined
            }
          />
        </>
      )}
      <PgCat label="Pad Properties" open={open.Pad ?? true} onToggle={() => toggle('Pad')} />
      {(open.Pad ?? true) && (
        <>
          <PgChoice
            label="Pad Type"
            value={v.type}
            options={
              [
                ['thru_hole', 'Through-hole'],
                ['smd', 'SMD'],
                ['connect', 'Edge connector'],
                ['np_thru_hole', 'NPTH, mechanical'],
              ] as const
            }
            onCommit={
              commit
                ? (type) =>
                    commit({ type, hasHole: type === 'thru_hole' || type === 'np_thru_hole' })
                : undefined
            }
          />
          <PgChoice
            label="Pad Shape"
            value={v.shape}
            options={
              [
                ['circle', 'Circle'],
                ['rect', 'Rectangle'],
                ['roundrect', 'Rounded rectangle'],
                ['oval', 'Oval'],
                ['trapezoid', 'Trapezoidal'],
                ['custom', 'Custom'],
              ] as const
            }
            onCommit={commit ? (shape) => commit({ shape }) : undefined}
          />
          <PgEdit
            label="Pad Number"
            value={v.number}
            onCommit={commit ? (number) => commit({ number }) : undefined}
          />
          <PgRO label="Pin Name" value={pad.pinFunction ?? ''} />
          <PgRO label="Pin Type" value={pad.pinType ?? ''} />
          <PgMM
            label="Size X"
            iu={v.sizeX}
            onCommit={commit ? (sizeX) => commit({ sizeX }) : undefined}
          />
          {v.shape !== 'circle' && (
            <PgMM
              label="Size Y"
              iu={v.sizeY}
              onCommit={commit ? (sizeY) => commit({ sizeY }) : undefined}
            />
          )}
          {v.hasHole && (
            <PgChoice
              label="Hole Shape"
              value={v.holeOblong ? 'oval' : 'round'}
              options={
                [
                  ['round', 'Round'],
                  ['oval', 'Oval'],
                ] as const
              }
              onCommit={commit ? (k) => commit({ holeOblong: k === 'oval' }) : undefined}
            />
          )}
          {v.hasHole && (
            <PgMM
              label="Hole Size X"
              iu={v.holeW}
              onCommit={commit ? (holeW) => commit({ holeW }) : undefined}
            />
          )}
          {v.hasHole && v.holeOblong && (
            <PgMM
              label="Hole Size Y"
              iu={v.holeH}
              onCommit={commit ? (holeH) => commit({ holeH }) : undefined}
            />
          )}
          <PgRO label="Copper Layers" value={copperLayers} />
          <PgOverride
            label="Pad To Die Length"
            iu={v.padToDieLength}
            onCommit={commit ? (padToDieLength) => commit({ padToDieLength }) : undefined}
          />
        </>
      )}
      <PgCat label="Overrides" open={open.Overrides ?? true} onToggle={() => toggle('Overrides')} />
      {(open.Overrides ?? true) && (
        <>
          <PgOverride
            label="Clearance Override"
            iu={v.localClearance}
            onCommit={commit ? (localClearance) => commit({ localClearance }) : undefined}
          />
          <PgOverride
            label="Soldermask Margin Override"
            iu={v.localSolderMaskMargin}
            onCommit={
              commit ? (localSolderMaskMargin) => commit({ localSolderMaskMargin }) : undefined
            }
          />
          <PgOverride
            label="Solderpaste Margin Override"
            iu={v.localSolderPasteMargin}
            onCommit={
              commit ? (localSolderPasteMargin) => commit({ localSolderPasteMargin }) : undefined
            }
          />
          <PgEdit
            label="Solderpaste Margin Ratio Override"
            value={
              v.localSolderPasteMarginRatio === null ? '' : String(v.localSolderPasteMarginRatio)
            }
            onCommit={
              commit
                ? (t) => {
                    if (t.trim() === '') {
                      commit({ localSolderPasteMarginRatio: null });
                      return;
                    }
                    const n = Number(t);
                    if (Number.isFinite(n)) commit({ localSolderPasteMarginRatio: n });
                  }
                : undefined
            }
          />
          <PgChoice
            label="Zone Connection Style"
            value={v.zoneConnection}
            options={
              [
                ['inherited', 'Inherited'],
                ['full', 'Solid'],
                ['thermal', 'Thermal reliefs'],
                ['none', 'None'],
              ] as const
            }
            onCommit={commit ? (zoneConnection) => commit({ zoneConnection }) : undefined}
          />
          <PgOverride
            label="Thermal Relief Gap"
            iu={v.thermalGap}
            onCommit={commit ? (thermalGap) => commit({ thermalGap }) : undefined}
          />
          <PgOverride
            label="Thermal Spoke Width"
            iu={v.thermalBridgeWidth}
            onCommit={commit ? (thermalBridgeWidth) => commit({ thermalBridgeWidth }) : undefined}
          />
        </>
      )}
    </div>
  );
}

/** The TRACK / ARC property grid (PCB_TRACK reflected properties). */
function TrackProps({
  board,
  id,
  netName,
  layers,
  onEdit,
}: {
  board: Board;
  id: string;
  netName: (c: number) => string;
  layers: readonly string[];
  onEdit?: (next: Board) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Track: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));

  const sel = trackViaSelection(board, [id]);
  const t = sel.tracks[0]?.item ?? sel.arcs[0]?.item;
  if (!t) return null;
  const isArc = sel.arcs.length > 0;

  // One field at a time, through the same collect/apply pair the dialog uses.
  const commit = onEdit
    ? (patch: Partial<TrackViaValues>): void => onEdit(applyTrackViaValues(board, sel, patch))
    : undefined;

  return (
    <div className="ze-pg">
      <div className="ze-pg-title">{isArc ? 'Track (Arc)' : 'Track'}</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          {/* An arc's endpoints follow its mid point, so they stay read-only. */}
          <PgMM
            label="Start X"
            iu={t.start.x}
            onCommit={!isArc && commit ? (v) => commit({ startX: v }) : undefined}
          />
          <PgMM
            label="Start Y"
            iu={t.start.y}
            onCommit={!isArc && commit ? (v) => commit({ startY: v }) : undefined}
          />
          <PgMM
            label="End X"
            iu={t.end.x}
            onCommit={!isArc && commit ? (v) => commit({ endX: v }) : undefined}
          />
          <PgMM
            label="End Y"
            iu={t.end.y}
            onCommit={!isArc && commit ? (v) => commit({ endY: v }) : undefined}
          />
          <PgChoice
            label="Net"
            value={String(t.net)}
            options={[...board.nets.entries()].map(
              ([code, name]) => [String(code), name === '' ? '<no net>' : name] as const,
            )}
            onCommit={commit ? (v) => commit({ net: Number(v) }) : undefined}
          />
        </>
      )}
      <PgCat label="Track Properties" open={open.Track ?? true} onToggle={() => toggle('Track')} />
      {(open.Track ?? true) && (
        <>
          <PgChoice
            label="Layer"
            value={t.layer}
            options={layers.map((l) => [l, l] as const)}
            onCommit={commit ? (v) => commit({ layer: v }) : undefined}
          />
          <PgMM
            label="Width"
            iu={t.width}
            onCommit={commit ? (v) => commit({ trackWidth: v }) : undefined}
          />
          <PgCheck
            label="Locked"
            checked={t.locked ?? false}
            onChange={commit ? (v) => commit({ locked: v }) : undefined}
          />
        </>
      )}
    </div>
  );
}

/** The VIA property grid (PCB_VIA reflected properties). */
function ViaProps({
  board,
  id,
  layers,
  onEdit,
}: {
  board: Board;
  id: string;
  layers: readonly string[];
  onEdit?: (next: Board) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Via: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));

  const sel = trackViaSelection(board, [id]);
  const via = sel.vias[0]?.item;
  if (!via) return null;

  const commit = onEdit
    ? (patch: Partial<TrackViaValues>): void => onEdit(applyTrackViaValues(board, sel, patch))
    : undefined;

  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Via</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgMM
            label="Position X"
            iu={via.at.x}
            onCommit={commit ? (v) => commit({ viaX: v }) : undefined}
          />
          <PgMM
            label="Position Y"
            iu={via.at.y}
            onCommit={commit ? (v) => commit({ viaY: v }) : undefined}
          />
          <PgChoice
            label="Net"
            value={String(via.net)}
            options={[...board.nets.entries()].map(
              ([code, name]) => [String(code), name === '' ? '<no net>' : name] as const,
            )}
            onCommit={commit ? (v) => commit({ net: Number(v) }) : undefined}
          />
        </>
      )}
      <PgCat label="Via Properties" open={open.Via ?? true} onToggle={() => toggle('Via')} />
      {(open.Via ?? true) && (
        <>
          <PgChoice
            label="Via Type"
            value={via.kind}
            options={
              [
                ['through', 'Through'],
                ['blind', 'Blind/buried'],
                ['micro', 'Microvia'],
              ] as const
            }
            onCommit={commit ? (v) => commit({ viaType: v }) : undefined}
          />
          <PgMM
            label="Diameter"
            iu={via.size}
            onCommit={commit ? (v) => commit({ viaDiameter: v }) : undefined}
          />
          <PgMM
            label="Hole"
            iu={via.drill}
            onCommit={commit ? (v) => commit({ viaDrill: v }) : undefined}
          />
          <PgChoice
            label="Layer Top"
            value={via.layers[0]}
            options={layers.map((l) => [l, l] as const)}
            onCommit={commit ? (v) => commit({ startLayer: v }) : undefined}
          />
          <PgChoice
            label="Layer Bottom"
            value={via.layers[1]}
            options={layers.map((l) => [l, l] as const)}
            onCommit={commit ? (v) => commit({ endLayer: v }) : undefined}
          />
          <PgCheck
            label="Locked"
            checked={via.locked ?? false}
            onChange={commit ? (v) => commit({ locked: v }) : undefined}
          />
        </>
      )}
      <PgCat label="Teardrops" open={open.Td ?? false} onToggle={() => toggle('Td')} />
      {open.Td && (
        <>
          <PgCheck
            label="Enabled"
            checked={via.teardrops?.enabled ?? false}
            onChange={commit ? (v) => commit({ tdEnabled: v }) : undefined}
          />
          <PgCheck
            label="Curved Edges"
            checked={via.teardrops?.curvedEdges ?? false}
            onChange={commit ? (v) => commit({ tdCurvedEdges: v }) : undefined}
          />
        </>
      )}
    </div>
  );
}

/** The ZONE property grid (ZONE reflected properties). */
function ZoneProps({
  board,
  index,
  netName,
  onEdit,
}: {
  board: Board;
  index: number;
  netName: (c: number) => string;
  onEdit?: (next: Board) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Fill: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));

  const zone = board.zones[index];
  if (!zone) return null;
  const v = collectZoneValues(zone);

  // A zone edit changes the pour, so the fill is rebuilt with it — the same
  // thing the dialog does on OK.
  const commit = onEdit
    ? (patch: Partial<ZoneValues>): void =>
        onEdit(fillZones(applyZoneValues(board, index, { ...v, ...patch })))
    : undefined;

  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Copper Zone</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgEdit
            label="Name"
            value={v.name}
            onCommit={commit ? (name) => commit({ name }) : undefined}
          />
          <PgChoice
            label="Net"
            value={String(v.net)}
            options={[...board.nets.entries()].map(
              ([code, name]) => [String(code), name === '' ? '<no net>' : name] as const,
            )}
            onCommit={commit ? (n) => commit({ net: Number(n) }) : undefined}
          />
          <PgRO label="Layers" value={zone.layers.join(', ')} />
          <PgEdit
            label="Priority"
            value={String(v.priority)}
            onCommit={
              commit
                ? (t) => {
                    const n = Number(t);
                    if (Number.isFinite(n)) commit({ priority: n });
                  }
                : undefined
            }
          />
          <PgCheck
            label="Locked"
            checked={v.locked}
            onChange={commit ? (locked) => commit({ locked }) : undefined}
          />
        </>
      )}
      <PgCat label="Fill Style" open={open.Fill ?? true} onToggle={() => toggle('Fill')} />
      {(open.Fill ?? true) && (
        <>
          <PgChoice
            label="Border Display"
            value={v.hatchStyle}
            options={
              [
                ['none', 'Line'],
                ['edge', 'Hatched'],
                ['full', 'Fully hatched'],
                ['invisible', 'Invisible'],
              ] as const
            }
            onCommit={commit ? (hatchStyle) => commit({ hatchStyle }) : undefined}
          />
          <PgCheck
            label="Filled"
            checked={v.filled}
            onChange={commit ? (filled) => commit({ filled }) : undefined}
          />
          <PgChoice
            label="Fill Type"
            value={v.fillMode}
            options={
              [
                ['solid', 'Solid fill'],
                ['hatch', 'Hatch pattern'],
                ['thieving', 'Copper thieving'],
              ] as const
            }
            onCommit={commit ? (fillMode) => commit({ fillMode }) : undefined}
          />
          <PgMM
            label="Clearance"
            iu={v.clearance}
            onCommit={commit ? (clearance) => commit({ clearance }) : undefined}
          />
          <PgMM
            label="Min Width"
            iu={v.minThickness}
            onCommit={commit ? (minThickness) => commit({ minThickness }) : undefined}
          />
          <PgChoice
            label="Pad Connections"
            value={v.padConnection}
            options={
              [
                ['full', 'Solid'],
                ['thermal', 'Thermal reliefs'],
                ['thru_hole_only', 'Reliefs for PTH'],
                ['none', 'None'],
              ] as const
            }
            onCommit={commit ? (padConnection) => commit({ padConnection }) : undefined}
          />
          <PgMM
            label="Thermal Gap"
            iu={v.thermalGap}
            onCommit={commit ? (thermalGap) => commit({ thermalGap }) : undefined}
          />
          <PgMM
            label="Thermal Spoke Width"
            iu={v.thermalBridgeWidth}
            onCommit={commit ? (thermalBridgeWidth) => commit({ thermalBridgeWidth }) : undefined}
          />
          <PgChoice
            label="Remove Islands"
            value={v.islandRemovalMode}
            options={
              [
                ['always', 'Always'],
                ['never', 'Never'],
                ['area', 'Below area limit'],
              ] as const
            }
            onCommit={commit ? (islandRemovalMode) => commit({ islandRemovalMode }) : undefined}
          />
        </>
      )}
    </div>
  );
}

function PcbSelectionInfo({
  board,
  selection,
  onEditFootprint,
  onEdit,
}: {
  board: Board | null;
  selection: ReadonlySet<string>;
  onEditFootprint?: (index: number, e: FpEdit) => void;
  /** Commit a whole new board; the panel edits live, one field at a time. */
  onEdit?: (next: Board) => void;
}): JSX.Element {
  const ids = [...selection];

  if (!board) return <div className="ze-muted">…</div>;

  const layerNames = board.layers.map((l) => l.name);
  const copperLayers = layerNames.filter((l) => /\.Cu$/.test(l));

  if (ids.length === 1) {
    const id = ids[0]!;
    const ref = parseBoardItemId(id);
    const netName = (code: number): string => board.nets.get(code) || `(net ${code})`;

    if (ref) {
      switch (ref.kind) {
        case 'track':
        case 'arc':
          return (
            <TrackProps
              board={board}
              id={id}
              netName={netName}
              layers={copperLayers}
              onEdit={onEdit}
            />
          );
        case 'via':
          return <ViaProps board={board} id={id} layers={copperLayers} onEdit={onEdit} />;
        case 'pad':
          return (
            <PadProps
              board={board}
              padRef={{ footprint: ref.index, pad: ref.sub ?? 0 }}
              netName={netName}
              onEdit={onEdit}
            />
          );
        case 'footprint': {
          const f = board.footprints[ref.index];
          if (f) return <FootprintProps fp={f} index={ref.index} onEdit={onEditFootprint} />;
          break;
        }
        case 'zone':
          return <ZoneProps board={board} index={ref.index} netName={netName} onEdit={onEdit} />;
        case 'shape':
          return (
            <GraphicShapeProps
              board={board}
              index={ref.index}
              layers={layerNames}
              onEdit={onEdit}
            />
          );
        case 'text':
          return (
            <GraphicTextProps board={board} index={ref.index} layers={layerNames} onEdit={onEdit} />
          );
      }
    }
  }

  // Multiple items: a per-kind tally (pcbnew's status "N items selected").
  const counts = new Map<string, number>();
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (r) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  }
  return (
    <div>
      <b>{ids.length} items selected</b>
      {[...counts].map(([k, n]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
          <span className="ze-muted">{k}</span>
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}

/** The board-text property grid (PCB_TEXT reflected properties). */
function GraphicTextProps({
  board,
  index,
  layers,
  onEdit,
}: {
  board: Board;
  index: number;
  layers: readonly string[];
  onEdit?: (next: Board) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Font: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));

  const t = board.texts[index];
  if (!t) return null;
  const v = collectTextValues(t);

  const commit = onEdit
    ? (patch: Partial<TextValues>): void =>
        onEdit(applyTextValues(board, index, { ...v, ...patch }))
    : undefined;

  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Text</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          <PgEdit
            label="Text"
            value={v.text}
            onCommit={commit ? (text) => commit({ text }) : undefined}
          />
          <PgMM label="Position X" iu={v.x} onCommit={commit ? (x) => commit({ x }) : undefined} />
          <PgMM label="Position Y" iu={v.y} onCommit={commit ? (y) => commit({ y }) : undefined} />
          <PgEdit
            label="Orientation"
            value={String(v.orientation)}
            suffix="°"
            onCommit={
              commit
                ? (s) => {
                    const n = Number(s);
                    if (Number.isFinite(n)) commit({ orientation: n });
                  }
                : undefined
            }
          />
          <PgChoice
            label="Layer"
            value={v.layer}
            options={layers.map((l) => [l, l] as const)}
            onCommit={commit ? (layer) => commit({ layer }) : undefined}
          />
          <PgCheck
            label="Locked"
            checked={v.locked}
            onChange={commit ? (locked) => commit({ locked }) : undefined}
          />
        </>
      )}
      <PgCat label="Text Properties" open={open.Font ?? true} onToggle={() => toggle('Font')} />
      {(open.Font ?? true) && (
        <>
          <PgMM
            label="Width"
            iu={v.width}
            onCommit={commit ? (width) => commit({ width }) : undefined}
          />
          <PgMM
            label="Height"
            iu={v.height}
            onCommit={commit ? (height) => commit({ height }) : undefined}
          />
          <PgMM
            label="Thickness"
            iu={v.thickness}
            onCommit={commit ? (thickness) => commit({ thickness }) : undefined}
          />
          <PgCheck
            label="Bold"
            checked={v.bold}
            onChange={commit ? (bold) => commit({ bold }) : undefined}
          />
          <PgCheck
            label="Italic"
            checked={v.italic}
            onChange={commit ? (italic) => commit({ italic }) : undefined}
          />
          <PgCheck
            label="Mirrored"
            checked={v.mirrored}
            onChange={commit ? (mirrored) => commit({ mirrored }) : undefined}
          />
          <PgCheck
            label="Knockout"
            checked={v.knockout}
            onChange={commit ? (knockout) => commit({ knockout }) : undefined}
          />
          <PgCheck
            label="Hidden"
            checked={v.hidden}
            onChange={commit ? (hidden) => commit({ hidden }) : undefined}
          />
        </>
      )}
    </div>
  );
}

/** The board-graphic property grid (PCB_SHAPE reflected properties). */
function GraphicShapeProps({
  board,
  index,
  layers,
  onEdit,
}: {
  board: Board;
  index: number;
  layers: readonly string[];
  onEdit?: (next: Board) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState<Record<string, boolean>>({ Basic: true, Stroke: true });
  const toggle = (g: string): void => setOpen((o) => ({ ...o, [g]: !o[g] }));

  const shape = board.shapes[index];
  if (!shape) return null;
  const v = collectShapeValues(shape);
  const used = shapePointsUsed(shape.kind);

  const commit = onEdit
    ? (patch: Partial<ShapeValues>): void =>
        onEdit(applyShapeValues(board, index, { ...v, ...patch }))
    : undefined;

  const pt = (label: string, key: 'start' | 'end' | 'mid' | 'center'): JSX.Element => (
    <>
      <PgMM
        label={`${label} X`}
        iu={v[key].x}
        onCommit={commit ? (x) => commit({ [key]: { ...v[key], x } }) : undefined}
      />
      <PgMM
        label={`${label} Y`}
        iu={v[key].y}
        onCommit={commit ? (y) => commit({ [key]: { ...v[key], y } }) : undefined}
      />
    </>
  );

  return (
    <div className="ze-pg">
      <div className="ze-pg-title">Graphic ({shape.kind})</div>
      <PgCat label="Basic Properties" open={open.Basic ?? true} onToggle={() => toggle('Basic')} />
      {(open.Basic ?? true) && (
        <>
          {used.center && pt('Center', 'center')}
          {used.start && pt('Start', 'start')}
          {used.mid && pt('Mid', 'mid')}
          {used.end && pt(shape.kind === 'circle' ? 'Radius' : 'End', 'end')}
          <PgChoice
            label="Layer"
            value={v.layer}
            options={layers.map((l) => [l, l] as const)}
            onCommit={commit ? (layer) => commit({ layer }) : undefined}
          />
          <PgCheck
            label="Locked"
            checked={v.locked}
            onChange={commit ? (locked) => commit({ locked }) : undefined}
          />
        </>
      )}
      <PgCat label="Stroke" open={open.Stroke ?? true} onToggle={() => toggle('Stroke')} />
      {(open.Stroke ?? true) && (
        <>
          <PgMM
            label="Line Width"
            iu={v.lineWidth}
            onCommit={commit ? (lineWidth) => commit({ lineWidth }) : undefined}
          />
          <PgChoice
            label="Line Style"
            value={v.strokeType}
            options={
              [
                ['default', 'Default'],
                ['solid', 'Solid'],
                ['dash', 'Dashed'],
                ['dot', 'Dotted'],
                ['dash_dot', 'Dash-Dot'],
                ['dash_dot_dot', 'Dash-Dot-Dot'],
              ] as const
            }
            onCommit={commit ? (strokeType) => commit({ strokeType }) : undefined}
          />
          <PgCheck
            label="Filled"
            checked={v.filled}
            onChange={commit ? (filled) => commit({ filled }) : undefined}
          />
        </>
      )}
    </div>
  );
}
