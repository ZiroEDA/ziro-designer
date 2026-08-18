// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import type { Vec2 } from '@ziroeda/kimath';
import { rotateOrientation, mirrorOrientation, type Orientation } from '@ziroeda/common';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  GRIP_MARGIN_PX,
  leftDragStart,
  expandSelectionToGroups,
  requestMovableSelection,
  selectionContains,
  planMove,
  planMoveFromPoints,
  moveItems,
  moveWithConnections,
  orthoMove,
  addItems,
  deleteByIds,
  placeSymbol,
  grabHotkeyAction,
  withPostMoveCleanup,
  planBreakWire,
  composeCommands,
  nudge,
  applyAxisLock,
  type AxisLock,
  type ArrowKey,
  placeSymbolInstance,
  moveSymbolTo,
  transformSymbol,
  makeJunction,
  isExplicitJunctionAllowed,
  makeNoConnect,
  makeLabel,
  makeDirectiveLabel,
  refId,
  setLabelFields,
  labelOrientationForPoint,
  spinOfAngle,
  SPIN_ANGLE,
  type EditedLabelField,
  type DirectiveShape,
  type SchLabel,
  startSegments,
  computeBreakPoint,
  switchPosture90,
  isTerminalPoint,
  sheetPinSideAt,
  finishWires,
  segIsNull,
  type WireSeg,
  makeRectangle,
  makeCircle,
  makeTableFromDrag,
  makeEllipse,
  makeEllipseArc,
  makeArc,
  makePolyline,
  makeRuleArea,
  makeSheet,
  MIN_SHEET_WIDTH,
  MIN_SHEET_HEIGHT,
  makeRuleAreaPreview,
  makeBusEntry,
  makeBusEntryOrSegment,
  makeImage,
  DEFAULT_ENTRY_SIZE,
  collectAnchors,
  selectionAnchors,
  nearestAnchor,
  danglingPinPositions,
  boxSelect,
  lassoSelect,
  pasteItems,
  translatePayload,
  pointEditTarget,
  editHandles,
  indicatorLines,
  parseSheetPinId,
  moveSheetPin,
  moveSheetPinCommand,
  type SheetPinRef,
  type ArcEditMode,
  dragHandle,
  reshapeCommand,
  type EditHandle,
  type PointEditTarget,
  type MoveSpec,
  type EditCommand,
  type Schematic,
  type SchImage,
  type SchSymbol,
  type LibSymbol,
  type LibGraphic,
  type LabelKind,
  type LabelShape,
  type PastePayload,
  type ErcViolation,
  type ItemRef,
  collectAndGuess,
  getNode,
  makeSymbol,
} from '@ziroeda/eeschema';
// Imported by module path rather than through the package barrel: Vite serves
// a cached transform of `eeschema/src/index.ts` and does not re-transform it
// when a new export appears, so a barrel import of anything added since the
// dev server started resolves to `undefined` at runtime.
import { makeBezier } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import {
  type BezierDraw,
  beginBezier,
  bezierPoints,
  calcBezier,
  continueBezier,
} from '@ziroeda/eeschema/src/tools/bezier_geom.js';
import { hitTestDrawingSheet } from '@ziroeda/common';
import {
  renderSchematic,
  drawingSheetItems,
  drawErcMarkers,
  hitTestErcMarker,
  fitToContent,
  fitToBBox,
  setRenderInvalidator,
  drawGrid,
  DEFAULT_RENDER_OPTS,
  type RenderOpts,
  type Viewport,
} from '../render/renderer.js';
import { SchematicGl } from '../../../render/gl/schematic_gl.js';
import { dragSplit, movingIds, sameIds } from '../moving_ids.js';

/**
 * `?perf=1` records what each repaint cost and which path drew it, on
 * `window.__perf`.
 *
 * Added because every performance claim made about this canvas so far was
 * measured by calling the renderer directly from a script, which says nothing
 * about what a frame costs in a browser. The first time it was measured here,
 * a drag turned out not to repaint at all, which invalidated the conclusion it
 * was supposed to support.
 */
const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

interface PerfCounters {
  frames: number;
  preview: number;
  ghostFull: number;
  blit: number;
  full: number;
  gl: number;
  rebuilds: number;
  totalMs: number;
  maxMs: number;
  last: number[];
}

const perf: PerfCounters = {
  frames: 0,
  preview: 0,
  ghostFull: 0,
  blit: 0,
  full: 0,
  gl: 0,
  rebuilds: 0,
  totalMs: 0,
  maxMs: 0,
  last: [],
};
if (PERF && typeof window !== 'undefined') {
  (window as unknown as { __perf: PerfCounters }).__perf = perf;
}

/** Record one repaint: which branch drew it, and how long it took. */
function notePaint(branch: 'preview' | 'ghostFull' | 'blit' | 'full' | 'gl', t0: number): void {
  if (!PERF) return;
  const ms = performance.now() - t0;
  perf.frames++;
  perf[branch]++;
  perf.totalMs += ms;
  if (ms > perf.maxMs) perf.maxMs = ms;
  perf.last.push(Math.round(ms * 10) / 10);
  if (perf.last.length > 40) perf.last.shift();
}

/**
 * The WebGL renderer, on by default; `?renderer=canvas` opts out.
 *
 * It was opt-in while it was being compared against the Canvas2D path, and
 * leaving it that way past the point of decision was a mistake: the two paths
 * behave very differently under a drag or a zoom, and the flag meant a plain
 * URL quietly exercised the old one. Improvements were reported against a
 * renderer that was not running.
 *
 * `?renderer=canvas` is kept because a renderer swap should stay reversible
 * without a deploy, and because a browser with no WebGL2 falls back to Canvas2D
 * anyway (`SchematicGl.create` returns null and `drawScene` takes the old
 * path). An editor that renders beats one that renders quickly.
 */
const GL_RENDERER =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('renderer') !== 'canvas';

/**
 * Every item a move changes the look of, by the id the painter keys them under.
 *
 * These are the items that go in the preview and are held out of the static
 * background. `refId` returns an item's uuid when it has one, so a split that
 * inserts a wire mid-drag does not renumber anything and these stay valid for
 * the whole gesture.
 *
 * A stub wire added by the move exists only in the moved document, so it is
 * drawn by the preview and has nothing to hide from the background.
 */
import { KICAD_DEFAULT, type Theme } from '../theme.js';
import { editPointColors } from '../../../render/color4d.js';
import { kiCursor, toolCursor as kiToolCursor } from '../cursors.js';
import { remapEvent } from '../hotkey_bindings.js';
import { settings } from '../../../prefs/settings.js';

/** Mouse/input behaviour from the Preferences dialog (COMMON_SETTINGS m_Input + eeschema). */
export interface InputPrefs {
  zoomSpeed: number; // 1..10 (input.zoom_speed)
  zoomSpeedAuto: boolean;
  centerOnZoom: boolean;
  reverseZoom: boolean;
  scrollModZoom: 'none' | 'ctrl' | 'shift' | 'alt';
  scrollModPanH: 'none' | 'ctrl' | 'shift' | 'alt';
  scrollModPanV: 'none' | 'ctrl' | 'shift' | 'alt';
  reverseScrollPanH: boolean;
  horizontalPan: boolean;
  mouseLeft: 'select' | 'drag_selected' | 'drag_any';
  mouseMiddle: 'pan' | 'zoom' | 'none';
  mouseRight: 'pan' | 'zoom' | 'none';
  /** eeschema input.drag_is_move: the mouse-drag gesture performs a Move
   *  (leave wires behind) instead of a Drag (rubber-band them along). */
  dragIsMove: boolean;
  autoStartWires: boolean;
  crosshair: 'small' | 'full' | '45';
  alwaysShowCrosshair: boolean;
}

export const DEFAULT_INPUT_PREFS: InputPrefs = {
  zoomSpeed: 1,
  zoomSpeedAuto: true,
  centerOnZoom: true,
  reverseZoom: false,
  scrollModZoom: 'none',
  scrollModPanH: 'ctrl',
  scrollModPanV: 'shift',
  reverseScrollPanH: false,
  horizontalPan: false,
  mouseLeft: 'drag_selected',
  mouseMiddle: 'pan',
  mouseRight: 'pan',
  dragIsMove: false,
  autoStartWires: true,
  // KiCad's defaults (app_settings.cpp): SMALL_CROSS, and the crosshair shown
  // whatever tool is active.
  crosshair: 'small',
  alwaysShowCrosshair: true,
};

/** The small crosshair is 80 screen px across, at any zoom (OPENGL_GAL::DrawCursor). */
const SMALL_CROSS_PX = 80;

/**
 * Tools that snap to connection anchors (pins, wire ends) rather than plain
 * grid, so the crosshair is drawn where the click will actually land, KiCad
 * calls ForceCursorPosition() with the anchor BestSnapAnchor() picked.
 */
const CONNECTION_SNAP_TOOLS = new Set(['junction', 'noConnect', 'drawWire', 'drawBus']);

// KiCad's BULLSEYE cursor (wxCURSOR_BULLSEYE), used by the net-highlight picker:
// concentric rings with a cross through them, hotspot at the centre. The rest of
// the tool cursors are KiCad's own bitmaps, see cursors.ts.
const BULLSEYE_CURSOR = (() => {
  const rings =
    `<circle cx="16" cy="16" r="9" fill="none"/><circle cx="16" cy="16" r="4" fill="none"/>` +
    `<line x1="16" y1="2" x2="16" y2="30"/><line x1="2" y1="16" x2="30" y2="16"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
    `<g stroke="#ffffff" stroke-width="3">${rings}</g>` +
    `<g stroke="#000000" stroke-width="1">${rings}</g>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, crosshair`;
})();

/** The wire cursor, also shown over a dangling pin with the select tool. */
const WIRE_CURSOR = kiCursor('lineWire');

/** The cursor a tool shows while it is active (SetCurrentCursor per tool). */
function toolCursor(tool: string, attached = false): string {
  if (tool === 'highlightNet') return BULLSEYE_CURSOR;
  // `setCursor` tests the attached item first, so every placement tool shows
  // the place cursor once something is riding the pointer:
  //
  //     if( item )
  //         m_frame->GetCanvas()->SetCurrentCursor( KICURSOR::PLACE );
  //     else if( isText ) ...
  if (attached) return kiCursor('place');
  return kiToolCursor(tool);
}

export type LineMode = 'free' | '90' | '45';

/** Right-toolbar tool ids that place a text label, mapped to the label kind. */
const LABEL_TOOLS: Record<string, LabelKind> = {
  placeLabel: 'label',
  placeGlobalLabel: 'global_label',
  placeHierLabel: 'hierarchical_label',
  placeText: 'text',
};

/** Right-toolbar shape/sheet drawing tools and their in-progress shape kind. */
type ShapeKind =
  | 'rectangle'
  | 'table'
  | 'ellipse'
  | 'ellipseArc'
  | 'circle'
  | 'arc'
  | 'lines'
  | 'ruleArea'
  | 'bezier'
  | 'sheet'
  | 'textbox';
const SHAPE_TOOL: Record<string, ShapeKind> = {
  rectangle: 'rectangle',
  // SCH_RULE_AREA is a POLY, so it is drawn exactly like the lines tool and
  // only differs in what the finished outline is committed as.
  drawRuleArea: 'ruleArea',
  circle: 'circle',
  arc: 'arc',
  lines: 'lines',
  bezier: 'bezier',
  drawSheet: 'sheet',
  textBox: 'textbox',
  // SHAPE_T::ELLIPSE / ELLIPSE_ARC: drawn centre-out like a circle, the drag
  // fixing each radius from its own axis.
  ellipse: 'ellipse',
  ellipseArc: 'ellipseArc',
  // `DrawTable` derives the row/column counts from the dragged rectangle; it
  // does not ask for them. So the table is a two-click drag like the text box.
  table: 'table',
};

interface DrawState {
  tool: ShapeKind;
  start: Vec2;
  points: Vec2[];
  cursor: Vec2;
  /**
   * The bezier tool's `EDA_SHAPE` edit state. It owns the four points and the
   * step the gesture is on, so `points` is unused for that tool.
   */
  bezier?: BezierDraw;
}

/** KiCad's 2-click arc (EDA_SHAPE::calcEdit state 1): quarter-circle through start/end. */
function arcFrom2(start: Vec2, end: Vec2): { start: Vec2; mid: Vec2; end: Vec2 } | null {
  const l = Math.hypot(end.x - start.x, end.y - start.y);
  if (l === 0) return null;
  const radius = l * Math.SQRT1_2;
  const m = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const f = Math.sqrt(Math.max(0, radius * radius - (l * l) / 4)) / l;
  const d = { x: f * (start.y - end.y), y: f * (end.x - start.x) };
  const c = { x: m.x + d.x, y: m.y + d.y };
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  const am = a0 + sweep / 2;
  return { start, mid: { x: c.x + radius * Math.cos(am), y: c.y + radius * Math.sin(am) }, end };
}

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Nearest sheet border to a world point (for placing sheet pins). */
function nearestSheetEdge(
  sch: Schematic,
  p: Vec2,
  tol: number,
  snap: (v: Vec2) => Vec2,
): { index: number; at: Vec2; side: 0 | 90 | 180 | 270 } | null {
  let best: { index: number; at: Vec2; side: 0 | 90 | 180 | 270 } | null = null;
  let bestD = tol;
  sch.sheets.forEach((sh, index) => {
    const x0 = sh.at.x,
      y0 = sh.at.y,
      x1 = x0 + sh.size.w,
      y1 = y0 + sh.size.h;
    if (p.x < x0 - tol || p.x > x1 + tol || p.y < y0 - tol || p.y > y1 + tol) return;
    const edges: { side: 0 | 90 | 180 | 270; at: Vec2; d: number }[] = [
      { side: 180, at: { x: x0, y: clampN(p.y, y0, y1) }, d: Math.abs(p.x - x0) },
      { side: 0, at: { x: x1, y: clampN(p.y, y0, y1) }, d: Math.abs(p.x - x1) },
      { side: 90, at: { x: clampN(p.x, x0, x1), y: y0 }, d: Math.abs(p.y - y0) },
      { side: 270, at: { x: clampN(p.x, x0, x1), y: y1 }, d: Math.abs(p.y - y1) },
    ];
    for (const ed of edges) {
      if (ed.d < bestD) {
        bestD = ed.d;
        best = { index, at: snap(ed.at), side: ed.side };
      }
    }
  });
  return best;
}

/** DEFAULT_SIZE_TEXT: 50 mils, the fallback if the caller passes no text size. */
const DEFAULT_TEXT_SIZE_IU = 12700;

/** The two tools whose outline is built click by click and ended explicitly. */
const isPolyTool = (t: ShapeKind | undefined): boolean => t === 'lines' || t === 'ruleArea';

/** The in-progress shape as a graphic, for live preview (built through the model). */
function previewGraphic(ds: DrawState): LibGraphic | null {
  const c = ds.cursor;
  switch (ds.tool) {
    case 'rectangle':
    case 'sheet':
    case 'textbox':
      return makeRectangle(ds.start, c);
    case 'table':
      // Previewed as a real table by the caller, which has the text size and
      // the grid step it needs to lay the cells out.
      return null;
    case 'circle':
      return makeCircle(ds.start, Math.hypot(c.x - ds.start.x, c.y - ds.start.y));
    case 'ellipse':
      return makeEllipse(ds.start, Math.abs(c.x - ds.start.x), Math.abs(c.y - ds.start.y));
    case 'ellipseArc':
      // A quarter sweep while drawing, the way the arc tool previews one before
      // its second click fixes the ends.
      return makeEllipseArc(
        ds.start,
        Math.abs(c.x - ds.start.x),
        Math.abs(c.y - ds.start.y),
        0,
        90,
      );
    case 'arc': {
      const a = arcFrom2(ds.start, c);
      return a ? makeArc(a.start, a.mid, a.end) : null;
    }
    case 'lines':
      return makePolyline([...ds.points, c]);
    case 'ruleArea':
      // Open, with the enclosed area filled — see `makeRuleAreaPreview`. The
      // outline only meets itself when the last point lands on the first.
      return makeRuleAreaPreview([...ds.points, c]);
    case 'bezier': {
      // The preview is the shape itself at whatever its edit state has made of
      // it — "item->CalcEdit( cursorPos ); m_view->AddToPreview( item->Clone() )".
      // State 1 leaves C2 on the end point, so the cubic collapses onto a
      // straight line and you see a line follow the cursor; states 2 and 3 bow
      // it into a C and then an S. We used to show a control polygon instead
      // and only reveal a curve after the last click.
      const g = ds.bezier;
      if (!g) return null;
      const [p0, c1, c2, p1] = bezierPoints(g);
      return makeBezier(p0, c1, c2, p1);
    }
  }
}

/** A label whose name/shape are chosen and which now follows the cursor for placement. */
export interface PendingLabel {
  kind: LabelKind;
  text: string;
  shape: LabelShape;
  /** Formatting from the label dialog (bold/italic/size in IU). */
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  /** Orientation (SPIN_STYLE) as the stored angle. */
  angle?: number;
  /** Explicit text colour, if the dialog's swatch was set. */
  color?: readonly [number, number, number, number];
  /** The label's own fields (`(property …)`), from the dialog's Fields grid. */
  fields?: readonly EditedLabelField[];
  /** "Auto": turn the label to suit what it is dropped on. */
  autoRotate?: boolean;
  /** Justification tokens for free text (the H/V alignment buttons). */
  justify?: readonly string[];
  /** FONT_CHOICE's face, when one was picked ('' / undefined = default). */
  face?: string;
  /** `(hyperlink "…")` on free text. */
  hyperlink?: string;
  /** `(exclude_from_sim yes)`, free text's simulation checkbox. */
  excludeFromSim?: boolean;
}

/** A netclass directive label whose shape/netclass are chosen, awaiting a click. */
export interface PendingDirective {
  shape: DirectiveShape;
  pinLength: number;
  netclass: string;
  angle: number;
  fontSize?: number;
  /**
   * Every field the dialog collected, not just the netclass.
   *
   * `createNewLabel` hands `DIALOG_LABEL_PROPERTIES` the real `SCH_LABEL_BASE`
   * and the dialog edits it in place, so whatever the fields grid ends up
   * holding — the netclass, the component class, anything added with the "+"
   * button — is on the item that then follows the cursor. Carrying only the
   * netclass across dropped the rest on the floor.
   */
  fields?: readonly EditedLabelField[];
}

/**
 * The label the dialog described, built at the point it is dropped,
 * SCH_DRAWING_TOOLS keeps the item it created and just moves it to the cursor,
 * so everything the dialog set (shape, formatting, colour, fields) is carried
 * onto the placed label.
 */
export function buildPendingLabel(
  p: PendingLabel,
  at: Vec2,
  sch?: Schematic,
  libById?: ReadonlyMap<string, LibSymbol>,
): SchLabel {
  // "Auto" (AutoRotateOnPlacement): the label turns to suit whatever it lands
  // on, SCH_EDIT_FRAME::AutoRotateItem, run as the item is placed.
  const spin =
    p.autoRotate && sch
      ? labelOrientationForPoint(sch, at, spinOfAngle(p.angle ?? 0), libById)
      : spinOfAngle(p.angle ?? 0);
  const label = makeLabel(p.kind, p.text, at, {
    shape: p.shape,
    bold: p.bold,
    italic: p.italic,
    fontSize: p.fontSize,
    angle: SPIN_ANGLE[spin],
  });
  const withFields = p.fields?.length ? setLabelFields(label, p.fields) : label;
  const out: { -readonly [K in keyof SchLabel]: SchLabel[K] } = { ...withFields };
  if (p.color || p.justify || p.face) {
    out.effects = {
      hidden: false,
      ...withFields.effects,
      ...(p.justify ? { justify: p.justify } : {}),
      ...(p.color ? { color: p.color } : {}),
      ...(p.face ? { face: p.face } : {}),
    };
  }
  if (p.excludeFromSim !== undefined) out.excludedFromSim = p.excludeFromSim;
  if (p.hyperlink) out.hyperlink = p.hyperlink;
  return out;
}

export interface CanvasController {
  /** `objectsOnly` fits what is drawn and ignores the page (zoomFitObjects). */
  zoomToFit: (objectsOnly?: boolean) => void;
  /** Fit the view to a world-space box (Zoom to Selected Objects). */
  zoomToBox: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** Force a repaint without changing the view (Refresh / zoomRedraw). */
  redraw: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Centre the viewport on a world point (used by ERC click-to-locate). */
  centerOn: (p: Vec2) => void;
}

interface Props {
  schematic: Schematic;
  libById: Map<string, LibSymbol>;
  selection: ReadonlySet<string>;
  activeTool: string;
  lineMode: LineMode;
  /** eeschema.drawing.arc_edit_mode: what dragging an arc's edit points means. */
  arcEditMode: ArcEditMode;
  /** Start drawing a wire from this point (Unfold from Bus hands the tool over
   *  with the entry's far end already placed). A fresh nonce re-arms it. */
  wireStartRequest?: { at: Vec2; nonce: number } | null;
  placeLib: LibSymbol | null;
  /**
   * Give a symbol its reference as it is placed, when the "Annotate
   * Automatically" toggle (or a power symbol) calls for it. Returns the symbol
   * unchanged otherwise. Applied before the placement command is built, so the
   * placement and its number are one undo step, as KiCad's single COMMIT is.
   */
  onAnnotatePlacement?: (sym: SchSymbol, lib: LibSymbol) => SchSymbol;
  /** Unit of `placeLib` attached to the cursor ("Place all units" stepping). */
  placeUnit?: number;
  /** A ready-built symbol to place instead of one made from `placeLib`'s
   *  defaults: Place Next Symbol Unit attaches a copy of an existing symbol so
   *  the new unit keeps its reference, fields and orientation. */
  placeInstance?: SchSymbol | null;
  /** A symbol was just placed, the editor steps units / reopens the chooser. */
  onSymbolPlaced?: () => void;
  /** A named label that follows the cursor until clicked to place (null = none yet). */
  pendingLabel: PendingLabel | null;
  /** A netclass directive label following the cursor (SCH_DIRECTIVE_LABEL). */
  pendingDirective?: PendingDirective | null;
  /** The pending label was just dropped: take the next one, or stop. */
  /** A label was placed; the argument is its id, which F1 repeats. */
  onLabelPlaced?: (id?: string) => void;
  /** A `(hyperlink …)` on text was Ctrl-clicked: "#<page>" or a URL. */
  onFollowLink?: (link: string) => void;
  /** A label tool clicked with nothing attached, ask for the next label
   *  (SCH_DRAWING_TOOLS::TwoClickPlace calls createNewLabel on that click).
   *  The click point lets the editor take the net name off the wire instead. */
  onLabelPrompt?: (at: Vec2) => void;
  /** Wire ids whose net is highlighted (KiCad's net-highlight overlay). */
  highlight?: ReadonlySet<string>;
  onSelect: (id: string | null, additive: boolean) => void;
  /** Highlight-Net tool: the clicked item whose net to brighten, or null to clear. */
  onHighlight?: (id: string | null) => void;
  /** Switch the active tool (used to auto-start a wire from a dangling pin). */
  onRequestTool?: (id: string) => void;
  /** Double-clicked item (KiCad's Properties action, sch_edit_tool.cpp). */
  onEditItem?: (id: string, kind: ItemRef['kind']) => void;
  /** Properties invoked over the drawing sheet with nothing selected: KiCad
   *  posts ACTIONS::pageSettings for that (SCH_EDIT_TOOL::Properties). */
  onEditDrawingSheet?: () => void;
  /** Box-selection result (KiCad SelectMultiple): replace/add/subtract the ids. */
  onSelectBox?: (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => void;
  /** Items being pasted: they follow the cursor until clicked to drop (KiCad's paste-then-move). */
  pastePending?: PastePayload | null;
  /** The paste was dropped: the command was submitted; `ids` are the pasted item ids. */
  onPasteDone?: (ids: ReadonlySet<string>) => void;
  /** ERC violations to draw as KiCad marker arrows (null = ERC not run);
   *  `excluded` picks LAYER_ERC_EXCLUSION's colour (SCH_MARKER::GetColorLayer). */
  ercMarkers?: readonly (ErcViolation & { excluded?: boolean; brightened?: boolean })[] | null;
  /**
   * A click landed on an ERC marker. `SCH_MARKER_T` is "always selectable" in
   * `SCH_SELECTION_TOOL`, and selecting one cross-probes to the ERC dialog
   * (`SCH_INSPECTION_TOOL::CrossProbe`); a double-click routes through
   * `SCH_EDIT_TOOL::Properties`, which calls the same thing but opens the
   * dialog first if it is closed.
   */
  onMarkerPick?: (violation: ErcViolation, doubleClick: boolean) => void;
  onCommand: (cmd: EditCommand) => void;
  /** WX_INFOBAR message from a tool ("Junction location contains no joinable
   *  wires and/or pins."); null dismisses it. */
  onInfoBar?: (message: string | null) => void;
  /**
   * The pointer moved. `world` is the raw position; `snapped` is where the
   * cursor actually *is* — `KIGFX::VIEW_CONTROLS::GetCursorPosition()`, which
   * snaps to the grid (or, for the connection-snapping tools, to the anchor
   * `BestSnapAnchor` picked). The status bar reads the snapped one, as
   * `SCH_BASE_FRAME::UpdateStatusBar` does.
   */
  onCursorMove?: (world: Vec2 | null, snapped: Vec2 | null) => void;
  onScaleChange?: (scale: number) => void;
  /** Active colour theme (Preferences > Colors). */
  theme?: Theme;
  /** Display options (Preferences > Display Options / Grids). */
  renderOpts?: RenderOpts;
  /** Mouse and editing behaviour (Preferences > Mouse and Touchpad / Editing Options). */
  inputPrefs?: InputPrefs;
  /** A hierarchical sheet rectangle was drawn: prompt for name/file and commit. */
  onSheetDrawn?: (at: Vec2, size: { w: number; h: number }) => void;
  /** A text-box rectangle was drawn: prompt for its text and commit (SCH_TEXTBOX). */
  onTextBoxDrawn?: (start: Vec2, end: Vec2) => void;
  /** A table dragged out: `DrawTable` derives its grid from the rectangle. */
  onTableDrawn?: (start: Vec2, end: Vec2) => void;
  /** A sheet-pin click landed on a sheet edge: prompt for the pin name and add it. */
  onSheetPinClick?: (sheetIndex: number, at: Vec2, side: 0 | 90 | 180 | 270) => void;
  /**
   * `schematic->Settings().m_DefaultTextSize`, in IU. The table tool needs it:
   * a column is fifteen characters wide and a row two high, so the grid a drag
   * describes is a function of the text size.
   */
  tableFontSizeIU?: number;
  /** An image chosen in the editor, following the cursor until clicked to place. */
  pendingImage?: SchImage | null;
  /** The pending image was dropped at `at`. */
  onImagePlaced?: (at: Vec2) => void;
  /** Keyboard-initiated grabbed move (SCH_MOVE_TOOL): 'move' leaves connected
   *  wires behind, 'drag' keeps them attached. A fresh nonce starts a move of
   *  the current selection that follows the cursor until clicked to drop. */
  /** SCH_MOVE_TOOL's four modes; break and slice split the wire, then drag it. */
  grabRequest?: { kind: 'move' | 'drag' | 'break' | 'slice'; nonce: number } | null;
  /** Zoom to Selection Area (ACTIONS::zoomTool): the user dragged a rectangle;
   *  fit the view to it (and the parent returns the tool to select). */
  onZoomArea?: (box: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  /** Plain right-click with the select tool idle (KiCad's selection-tool
   *  context menu): `hit` is the already-hit-tested item under the cursor.
   *  The editor updates the selection and pops the menu at the client point. */
  onContextMenuRequest?: (
    clientX: number,
    clientY: number,
    hit: ItemRef | null,
    /** Where the click landed and which edit point it was over, so the menu can
     *  offer Add / Remove Corner (SCH_POINT_EDITOR's two context-menu items). */
    pointEdit: { world: Vec2; handle: EditHandle | null; tolerance: number },
  ) => void;
  /** An ambiguous click (several candidates after GuessSelectionCandidates):
   *  the editor pops the Clarify Selection menu at the client point. */
  onClarify?: (clientX: number, clientY: number, candidates: ItemRef[], additive: boolean) => void;
  /** The current selection is one a right-click made for its menu
   *  (`SELECTION::IsHover`), which gets no point-editor handles. */
  isHoverSelection?: boolean;
}

type Mode = 'idle' | 'pan' | 'dragzoom' | 'move' | 'box' | 'lasso';

// KiCad's selection-rectangle colours for a bright background
// (common/preview_items/selection_area.cpp, selectionColorScheme[1]).
const BOX_FILL_NORMAL = 'rgba(128, 77, 255, 0.5)'; // COLOR4D(0.5,0.3,1.0,0.5)
const BOX_FILL_ADDITIVE = 'rgba(128, 255, 128, 0.5)'; // COLOR4D(0.5,1.0,0.5,0.5)
const BOX_FILL_SUBTRACT = 'rgba(255, 128, 128, 0.5)'; // COLOR4D(1.0,0.5,0.5,0.5)
const BOX_OUTLINE_L2R = 'rgb(179, 179, 0)'; // window select: dark yellow
const BOX_OUTLINE_R2L = 'rgb(26, 26, 255)'; // greedy select: blue

// EDIT_POINT's screen sizes (edit_points.h). The *colours* are derived from
// the theme by `editPointColors`, exactly as EDIT_POINTS::ViewDraw derives them
// from LAYER_AUX_ITEMS: they used to be hardcoded to a white square with a dark
// border, which is upside down. LAYER_SCHEMATIC_AUX_ITEMS is black in both
// builtin themes, so on a light sheet the handle is a black square with a pale
// grey border, not a white one ringed in charcoal.
const EDIT_POINT_SIZE = 8;
const EDIT_POINT_BORDER_SIZE = 3;
const EDIT_POINT_HOVER_SIZE = 6;

/** Undo labels for a completed reshape, as KiCad names the commit. */
const POINT_EDIT_LABELS: Record<PointEditTarget['kind'], string> = {
  sheet: 'Resize Sheet',
  textbox: 'Resize Text Box',
  line: 'Drag Line Endpoint',
  graphic: 'Drag Shape',
  image: 'Resize Image',
  // The drag resizes a whole column or row, not the cell, so the undo entry
  // says what actually changed.
  tablecell: 'Resize Table',
};

export const SchematicCanvas = forwardRef<CanvasController, Props>(function SchematicCanvas(
  {
    schematic,
    libById,
    selection,
    activeTool,
    lineMode,
    arcEditMode,
    wireStartRequest,
    placeLib,
    onAnnotatePlacement,
    placeUnit = 1,
    placeInstance = null,
    onSymbolPlaced,
    pendingLabel,
    pendingDirective,
    onLabelPlaced,
    onLabelPrompt,
    onFollowLink,
    highlight,
    onSelect,
    onHighlight,
    onRequestTool,
    onEditItem,
    onSelectBox,
    pastePending,
    onPasteDone,
    ercMarkers,
    onMarkerPick,
    onCommand,
    onInfoBar,
    onCursorMove,
    onScaleChange,
    theme = KICAD_DEFAULT,
    renderOpts = DEFAULT_RENDER_OPTS,
    inputPrefs = DEFAULT_INPUT_PREFS,
    onSheetDrawn,
    onTextBoxDrawn,
    onTableDrawn,
    onSheetPinClick,
    tableFontSizeIU,
    pendingImage,
    onImagePlaced,
    grabRequest,
    onZoomArea,
    onContextMenuRequest,
    isHoverSelection,
    onClarify,
    onEditDrawingSheet,
  },
  ref,
): JSX.Element {
  // The active snap grid (Preferences > Grids). With grid overrides enabled
  // (ACTIONS::toggleGridOverrides), the grid depends on what's being drawn:
  // wires, text, graphics and connectable items each get their own override.
  const o = renderOpts.grid.overrides;
  const GRID = (() => {
    const base = renderOpts.grid.sizeIU;
    if (!o?.enabled) return base;
    if (
      (activeTool === 'drawWire' || activeTool === 'drawBus' || activeTool === 'busEntry') &&
      o.wires
    )
      return o.wires;
    if ((activeTool === 'placeText' || activeTool === 'textBox') && o.text) return o.text;
    if (
      ['rectangle', 'circle', 'arc', 'lines', 'bezier', 'drawRuleArea'].includes(activeTool) &&
      o.graphics
    )
      return o.graphics;
    if (
      [
        'placeSymbol',
        'placePower',
        'junction',
        'noConnect',
        'placeLabel',
        'placeGlobalLabel',
        'placeHierLabel',
        'select',
      ].includes(activeTool) &&
      o.connected
    )
      return o.connected;
    return base;
  })();
  const snap = (p: Vec2): Vec2 => ({
    x: Math.round(p.x / GRID) * GRID,
    y: Math.round(p.y / GRID) * GRID,
  });
  // EDIT_POINTS::ViewDraw's colours, which depend on the theme's aux-items
  // colour *and* on the canvas background it is compared against.
  const editPointColor = useMemo(
    () => editPointColors(theme.auxItems, theme.background),
    [theme.auxItems, theme.background],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The scene canvas holds the schematic itself; the overlay on top carries the
  // things that follow the pointer (crosshair, rubber band, lasso, the wire
  // chain being drawn). Moving the mouse repaints only the overlay, so the
  // schematic is not re-rendered for every pointer event.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // The WebGL document layer, between the two (#449). Opt-in for now: it is
  // being compared against the Canvas2D path on real documents before it can
  // become the default, and a renderer swap is not something to do silently.
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<SchematicGl | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Live document, readable from effects that must not re-run when it changes.
  const schematicRef = useRef(schematic);
  schematicRef.current = schematic;

  const modeRef = useRef<Mode>('idle');
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  const panMovedRef = useRef(false);
  const moveStartRef = useRef<Vec2 | null>(null);
  const moveDeltaRef = useRef<Vec2 | null>(null);
  const moveSpecRef = useRef<MoveSpec | null>(null);
  /**
   * The sheet without the items being dragged, painted once per drag.
   *
   * KiCad's static view under `SCH_MOVE_TOOL`'s preview group. Keyed on the
   * move spec and the viewport, so it is rebuilt when the drag changes shape
   * (a new stub, a split) or the view moves under it, and reused on every
   * ordinary pointer move.
   */
  const dragBgRef = useRef<{
    canvas: HTMLCanvasElement;
    view: Viewport;
    spec: MoveSpec;
    /** The drag split the background was painted without; see `dragSplit`. */
    split: ReadonlySet<string>;
  } | null>(null);
  /**
   * The base render options for a drag, memoised by identity.
   *
   * `SchematicGl` decides whether to re-record by comparing the content key by
   * *reference*. Building `{ ...renderOpts, hiddenItems: moving }` inside the
   * frame would hand it a new object every pointer move and re-record the whole
   * sheet each time, which is the failure the preview exists to avoid and would
   * have been invisible except as "it is still slow".
   */
  const dragOptsMemo = useRef<{
    base: RenderOpts;
    moving: ReadonlySet<string>;
    out: RenderOpts;
  } | null>(null);
  /**
   * The current drag split, held so its *identity* survives frames in which its
   * contents did not change.
   *
   * `SchematicGl` decides whether to re-record the base by comparing the content
   * key by reference, and the base's `hiddenItems` is this set. Recomputing it
   * per frame is necessary (a bend appears the moment the drag leaves the wire's
   * axis) but handing over a new `Set` each time would re-record the whole sheet
   * on every pointer move — the exact cost the preview exists to avoid. So the
   * contents are compared and the old instance kept when they match, which in a
   * straight drag is every frame after the first.
   */
  const splitRef = useRef<ReadonlySet<string>>(new Set());
  const stableSplit = useRef((next: ReadonlySet<string>): ReadonlySet<string> => {
    if (!sameIds(splitRef.current, next)) splitRef.current = next;
    return splitRef.current;
  });

  const dragOptsRef = useRef((base: RenderOpts, moving: ReadonlySet<string>): RenderOpts => {
    const hit = dragOptsMemo.current;
    if (hit && hit.base === base && hit.moving === moving) return hit.out;
    const out: RenderOpts = { ...base, hiddenItems: moving };
    dragOptsMemo.current = { base, moving, out };
    return out;
  });
  // 'move' leaves connected wires behind (moveItems), 'drag' rubber-bands them
  // (moveWithConnections/orthoMove), SCH_MOVE_TOOL's two modes.
  const moveKindRef = useRef<'move' | 'drag'>('drag');
  // A keyboard-initiated grabbed move follows the cursor with no button held and
  // commits on the next left click (vs a button-drag, committed on pointer-up).
  const grabbedRef = useRef(false);
  const effSelRef = useRef<ReadonlySet<string>>(new Set());
  // Connectable snapping during a move: the moved items' own connection points and the
  // anchors of everything else, so a dragged pin/wire-end snaps onto a matching anchor.
  const movePointsRef = useRef<Vec2[]>([]);
  const moveAnchorsRef = useRef<Vec2[]>([]);

  // Point editing (SCH_POINT_EDITOR): the handles of the one selected item,
  // which one the cursor is over, and the drag in flight. The reshaped document
  // is what the scene paints while a handle is being dragged, and what gets
  // committed on release.
  const pointTargetRef = useRef<PointEditTarget | null>(null);
  const pointHandlesRef = useRef<readonly EditHandle[]>([]);
  /** `EDIT_POINTS`' drawn-only leaders (a bezier's end→control lines). */
  const pointLeadersRef = useRef<readonly [Vec2, Vec2][]>([]);
  const hoveredHandleRef = useRef<EditHandle | null>(null);
  const pointDragRef = useRef<EditHandle | null>(null);
  /** The reshaped document while a handle or sheet-pin drag is in flight. */
  const pointEditDocRef = useRef<Schematic | null>(null);
  /**
   * Re-derive both halves of `EDIT_POINTS` — the grabbable handles and the
   * drawn-only leaders — from one document. They are always rebuilt together
   * (a drag moves the leaders with the handles), so they are set together.
   */
  const setPointHandles = useCallback((doc: Schematic, target: PointEditTarget | null) => {
    pointHandlesRef.current = target ? editHandles(doc, target) : [];
    pointLeadersRef.current = target ? indicatorLines(doc, target) : [];
  }, []);
  /**
   * Break / Slice split the wire *before* the drag starts, and upstream folds
   * both into one commit (`SCH_COMMIT` pushed as "Break Wire"). Until the drop
   * the split is uncommitted, so the drag has to run against a document the
   * document state does not hold yet: `moveBaseRef` is that document, and
   * `breakCmdRef` is the split waiting to be composed into the commit.
   */
  const moveBaseRef = useRef<Schematic | null>(null);
  const breakCmdRef = useRef<EditCommand | null>(null);
  /**
   * The keyboard's half of a move: which axis the last arrow locked, and which
   * arrow it was (the release test compares against the immediately preceding
   * one). Upstream keeps these as `axisLock` / `lastArrowKeyAction` locals in
   * `doMoveSelection`, which lives for the duration of one move.
   */
  const axisLockRef = useRef<AxisLock>('none');
  const lastArrowRef = useRef<ArrowKey | null>(null);
  // A sheet pin drags along its sheet's border rather than by a free delta, so
  // it gets its own drag rather than going through the move tool.
  const sheetPinDragRef = useRef<SheetPinRef | null>(null);
  /** Assigned once the frame scheduler below exists. */
  const requestOverlayRef = useRef<() => void>(() => {});

  // Box-selection drag (KiCad selectMultiple): origin/end in world coordinates.
  const boxHitRef = useRef<string | null>(null);
  // What a press that started a move was over, so a press-and-release with no
  // travel can be resolved as a click (upstream's TA_MOUSE_CLICK path).
  const pressHitRef = useRef<string | null>(null);
  // Ambiguous-press candidates awaiting the Clarify Selection menu.
  const clarifyRef = useRef<ItemRef[] | null>(null);
  const boxOriginRef = useRef<Vec2 | null>(null);
  const boxEndRef = useRef<Vec2 | null>(null);
  const boxModifiersRef = useRef({ additive: false, subtractive: false });
  // Zoom to Selection Area (zoomTool): the box drag zooms instead of selecting.
  const zoomAreaRef = useRef(false);
  // Lasso-selection trace (KiCad selectLasso): the freehand polygon in world coords.
  const lassoPointsRef = useRef<Vec2[]>([]);

  // Wire-drawing state (SCH_LINE_WIRE_BUS_TOOL): the chain of segments being
  // drawn (m_wires), the last two are "live" and follow the cursor, plus the
  // 45°-mode posture flag (static bool posture) and the mode we last drew with
  // (lastMode, to adjust the chain when line mode changes mid-draw).
  const wiresRef = useRef<WireSeg[]>([]);
  const wirePostureRef = useRef(false);
  const wireLastModeRef = useRef<LineMode>(lineMode);
  // Current line mode, readable from effects/handlers without re-running them.
  const lineModeRef = useRef<LineMode>(lineMode);
  lineModeRef.current = lineMode;
  const cursorRef = useRef<Vec2 | null>(null);
  // A dangling pin the next drawWire activation should start from (auto-start wire).
  const pendingWireStartRef = useRef<Vec2 | null>(null);
  // A wire start handed over by another tool (Unfold from Bus). Armed on a new
  // nonce so the same point can be requested twice.
  useEffect(() => {
    if (wireStartRequest) pendingWireStartRef.current = wireStartRequest.at;
  }, [wireStartRequest?.nonce]);
  // Orientation applied to the symbol currently being placed (R/X/Y before dropping).
  const placeOrientRef = useRef<Orientation>({ angle: 0 });
  // The ready-built symbol on the cursor (Place Next Symbol Unit), if any. It
  // carries its own orientation, so R/X/Y turn *it* instead of accumulating
  // into placeOrientRef, which only means anything for a library default.
  const placeInstanceRef = useRef<SchSymbol | null>(null);
  useEffect(() => {
    placeInstanceRef.current = placeInstance;
  }, [placeInstance]);
  // In-progress shape/sheet drawing (rectangle/circle/arc/lines/bezier/sheet).
  const drawStateRef = useRef<DrawState | null>(null);
  // Bus-entry size vector (R rotates it through the four 45° orientations).
  const entrySizeRef = useRef<Vec2>({ x: DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE });

  const dpr = () => window.devicePixelRatio || 1;

  /**
   * How far from an item a click still counts, in world units.
   *
   * `SCH_SELECTION_TOOL::CollectHits`:
   *
   *     int pixelThreshold = KiROUND( getView()->ToWorld( HITTEST_THRESHOLD_PIXELS ) );
   *     int gridThreshold  = KiROUND( getView()->GetGAL()->GetGridSize().EuclideanNorm() / 2.0 );
   *     aCollector.m_Threshold = std::max( pixelThreshold, gridThreshold );
   *
   * The grid term is the part that matters and the part we did not have: on a
   * 1.27 mm grid it is about 0.9 mm *whatever the zoom*, so a click always
   * reaches at least half a grid square. Without it the tolerance was five
   * screen pixels and nothing else, so a near-miss on a symbol body — well
   * inside the grid square that was clicked — selected nothing at all, which is
   * most of what "clicking feels wrong" was.
   */
  const hitAccuracy = useCallback((): number => {
    const vp = viewportRef.current;
    const px = vp && vp.scale > 0 ? (5 * dpr()) / vp.scale : GRID;
    return Math.max(px, Math.hypot(GRID, GRID) / 2);
  }, [GRID]);
  /**
   * The extra leeway `GuessSelectionCandidates` gives lines when deciding what
   * counts as an *exact* hit ("Lines are hard to hit"): six pixels, and not
   * grid-floored, unlike the collection threshold above.
   */
  const lineSlop = useCallback((): number => {
    const vp = viewportRef.current;
    return vp && vp.scale > 0 ? (6 * dpr()) / vp.scale : GRID / 2;
  }, [GRID]);
  /**
   * The item a click lands on, resolved the way `SelectPoint` resolves it:
   * collect everything within the threshold, then let the
   * GuessSelectionCandidates heuristics pick.
   *
   * Selection already went through this; the drag, delete and context-menu
   * paths went through the plain `hitTest` priority order instead, so they
   * could disagree with it about what was under the cursor.
   */
  const pickAt = useCallback(
    (world: Vec2): ItemRef | null =>
      collectAndGuess(schematic, libById, world, hitAccuracy(), lineSlop())[0] ?? null,
    [schematic, libById, hitAccuracy, lineSlop],
  );

  /**
   * The ERC marker under `world`, if any.
   *
   * Markers are tried before the document, because they are the top of
   * `SCH_LAYER_ORDER` — LAYER_ERC_ERR / _WARN / _EXCLUSION sit above every item
   * layer, and a marker is deliberately drawn over the thing it flags. Within
   * the markers the same order applies, so an error wins over a warning on the
   * same pin: the list is scanned back to front.
   */
  const pickMarker = useCallback(
    (world: Vec2): ErcViolation | null => {
      if (!ercMarkers?.length) return null;
      const acc = hitAccuracy();
      const rank = (m: { excluded?: boolean; severity: string }): number =>
        m.excluded ? 0 : m.severity === 'error' ? 2 : 1;
      let best: ErcViolation | null = null;
      let bestRank = -1;
      for (const m of ercMarkers) {
        if (!hitTestErcMarker(m.at, world, acc)) continue;
        if (rank(m) > bestRank) {
          bestRank = rank(m);
          best = m;
        }
      }
      return best;
    },
    [ercMarkers, hitAccuracy],
  );

  /**
   * The endpoint of a lone selected wire that a press at `world` grabbed, or
   * null for "the whole wire".
   *
   * `SCH_SELECTION_TOOL::narrowSelection` decides this as the selection is
   * made, using the same collector threshold the hit test uses:
   *
   *     if( line->GetStartPoint().Distance( aWhere ) <= aCollector.m_Threshold )
   *         flags = STARTPOINT;
   *     else if( line->GetEndPoint().Distance( aWhere ) <= aCollector.m_Threshold )
   *         flags = ENDPOINT;
   *     else
   *         flags = STARTPOINT | ENDPOINT;
   *
   * Only for a single selected line: with several items picked, upstream drags
   * the selection as a whole.
   */
  const wireEndUnderPress = useCallback(
    (ids: ReadonlySet<string>, world: Vec2): Vec2 | null => {
      if (ids.size !== 1) return null;
      const id = [...ids][0]!;
      const index = schematic.lines.findIndex((l, i) => refId('line', l.uuid, i) === id);
      if (index < 0) return null;
      const line = schematic.lines[index]!;
      const tol = hitAccuracy();
      if (Math.hypot(world.x - line.start.x, world.y - line.start.y) <= tol) return line.start;
      if (Math.hypot(world.x - line.end.x, world.y - line.end.y) <= tol) return line.end;
      return null;
    },
    [schematic, hitAccuracy],
  );

  // Dangling (unconnected) pins, KiCad's clickable wire-start anchors.
  const danglingPins = useMemo(
    () => danglingPinPositions(schematic, libById),
    [schematic, libById],
  );
  /** The dangling pin at/near a world point (within ~8px), or null. */
  const danglingPinAt = useCallback(
    (world: Vec2): Vec2 | null => {
      const vp = viewportRef.current;
      const maxDist = vp && vp.scale > 0 ? 8 / vp.scale : GRID / 2;
      return nearestAnchor(world, danglingPins, maxDist);
    },
    [danglingPins],
  );

  // Connectable anchors (pins/wire-ends/junctions/labels) for cursor snapping, à la
  // KiCad's BestSnapAnchor with GRID_CONNECTABLE.
  const anchors = useMemo(() => collectAnchors(schematic, libById), [schematic, libById]);
  /** Snap a world point to the nearest connection anchor within ~10px, else to the grid. */
  const snapConn = useCallback(
    (world: Vec2): Vec2 => {
      const vp = viewportRef.current;
      const maxDist = vp && vp.scale > 0 ? 10 / vp.scale : GRID / 2;
      return nearestAnchor(world, anchors, maxDist) ?? snap(world);
    },
    [anchors],
  );
  /**
   * Track the cursor with the live segment(s) of the wire chain, the motion
   * handler of SCH_LINE_WIRE_BUS_TOOL::doDrawSegments, including the
   * adjustment when the H/V/45 mode is switched mid-draw. Returns the
   * possibly-adjusted cursor position (sheet-pin pushes).
   */
  const updateWireChain = useCallback(
    (cursorPos: Vec2): Vec2 => {
      const wires = wiresRef.current;
      if (wires.length === 0) return cursorPos;

      if (wireLastModeRef.current !== lineMode) {
        // Delete the extra segment / add one so we can move orthogonally.
        if (lineMode === 'free' && wires.length >= 2) {
          wires.pop();
        } else if (wireLastModeRef.current === 'free') {
          const last = wires[wires.length - 1]!;
          last.b = { ...cursorPos };
          wires.push({ a: { ...cursorPos }, b: { ...cursorPos } });
        }
        wireLastModeRef.current = lineMode;
      }

      if (lineMode !== 'free' && wires.length >= 2) {
        const segment = wires[wires.length - 2]!;
        const side = sheetPinSideAt(schematic, segment.a);
        return computeBreakPoint(
          segment,
          wires[wires.length - 1]!,
          cursorPos,
          lineMode,
          wirePostureRef.current,
          side,
          GRID,
        );
      }
      wires[wires.length - 1]!.b = { ...cursorPos };
      return cursorPos;
    },
    [lineMode, schematic, GRID],
  );

  /** finishSegments: commit the chain as wires/buses + automatic junctions. */
  const finishWireChain = useCallback(() => {
    const kind = activeTool === 'drawBus' ? 'bus' : 'wire';
    const cmd = finishWires(schematic, libById, wiresRef.current, kind);
    wiresRef.current = [];
    if (cmd) onCommand(cmd);
  }, [activeTool, schematic, libById, onCommand]);

  // 'move' (M) translates only the selected items, leaving connected wires
  // behind. 'drag' (G) keeps them attached: any non-free line mode adds
  // orthogonal bends (SCH_MOVE_TOOL applies orthoLineDrag for 90° AND 45°);
  // free mode lets the connected wire simply stretch.
  const buildMove = useCallback(
    (spec: MoveSpec, delta: Vec2): EditCommand => {
      if (moveKindRef.current === 'move') return moveItems(effSelRef.current, delta);
      // A break plans its bends against the *split* sheet: the halves it is
      // about to drag do not exist in `schematic` yet.
      return lineMode !== 'free'
        ? orthoMove(moveBaseRef.current ?? schematic, spec, delta, libById)
        : moveWithConnections(spec, delta);
    },
    [schematic, lineMode, libById],
  );

  /**
   * The same move, as it is *committed*. SCH_MOVE_TOOL runs its junction, trim
   * and dangling-stub pass inside the commit, not while the item is on the
   * cursor — so the ghost keeps using `buildMove` and only the drop cleans up.
   */
  const buildMoveCommit = useCallback(
    (spec: MoveSpec, delta: Vec2): EditCommand => {
      const move = withPostMoveCleanup(
        buildMove(spec, delta),
        spec,
        libById,
        effSelRef.current,
        // isDragLike: a plain move (M) leaves connected wires behind on purpose.
        moveKindRef.current !== 'move',
      );
      // One undo step covers the split and the drag together, as upstream's
      // single "Break Wire" / "Slice Wire" commit does — undoing a break must
      // not leave the wire cut in two where the user dropped it.
      const split = breakCmdRef.current;
      return split ? composeCommands(split.label, [split, move]) : move;
    },
    [buildMove, libById],
  );

  // Keyboard-initiated grabbed move (SCH_MOVE_TOOL Move/Drag): the selection
  // follows the cursor from the current position until a left click drops it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce-driven, like placeRequest
  useEffect(() => {
    if (!grabRequest || selection.size === 0) return;

    const kind = grabRequest.kind;

    // SCH_MOVE_TOOL::preprocessBreakOrSliceSelection: split first, then run the
    // ordinary drag over the halves. The split is held pending rather than
    // committed, so Escape abandons the whole thing and the wire is never cut.
    //
    // There is no restart arm here as there is for M and G: a split needs a
    // committed wire to cut, so a request arriving mid-move drops that move.
    if (kind === 'break' || kind === 'slice') {
      if (grabbedRef.current) {
        const spec = moveSpecRef.current;
        const d = moveDeltaRef.current;
        if (spec && d && (d.x !== 0 || d.y !== 0)) onCommand(buildMoveCommit(spec, d));
        endGrab();
        return;
      }
      const cursor = cursorRef.current ? snap(cursorRef.current) : null;
      if (!cursor) return;
      const plan = planBreakWire(schematic, selection, cursor, kind);
      if (!plan) return;
      const split = plan.command.apply(schematic);
      breakCmdRef.current = plan.command;
      moveBaseRef.current = split;
      // Both modes are drag-like (`m_mode != MOVE`), so the drop runs the
      // connected-wire cleanup rather than leaving stubs behind.
      moveKindRef.current = 'drag';
      effSelRef.current = new Set([...plan.dragEnd, ...plan.dragStart]);
      moveSpecRef.current = plan.spec;
      movePointsRef.current = plan.at ? [plan.at] : [];
      moveAnchorsRef.current = collectAnchors(split, libById, effSelRef.current);
      // `m_breakPos` seeds the cursor so the first motion is measured from the
      // break, not from wherever the pointer was when the menu was dismissed.
      moveStartRef.current = plan.at ?? cursor;
      moveDeltaRef.current = { x: 0, y: 0 };
      modeRef.current = 'move';
      grabbedRef.current = true;
      requestDraw();
      return;
    }

    // SCH_MOVE_TOOL::checkMoveInProgress — the hotkey pressed *during* a move.
    const what = grabHotkeyAction(grabbedRef.current, moveKindRef.current, kind);

    if (what === 'drop') {
      const spec = moveSpecRef.current;
      const d = moveDeltaRef.current;
      if (spec && d && (d.x !== 0 || d.y !== 0)) onCommand(buildMoveCommit(spec, d));
      endGrab();
      return;
    }

    if (what === 'restart') {
      // Nothing has been committed, so upstream's revert is just re-planning
      // against the untouched sheet. The anchor is left alone, so the items
      // stay put under the cursor instead of springing back to where they
      // began.
      moveKindRef.current = kind;
      const next = planMove(schematic, libById, effSelRef.current);
      moveSpecRef.current = next;
      const moved = new Set([...effSelRef.current, ...next.wireStart, ...next.wireEnd]);
      moveAnchorsRef.current = collectAnchors(schematic, libById, moved);
      requestDraw();
      return;
    }

    const anchors = selectionAnchors(schematic, libById, selection);
    const origin = cursorRef.current ? snap(cursorRef.current) : (anchors[0] ?? null);
    if (!origin) return;
    moveKindRef.current = kind;
    effSelRef.current = selection;
    const spec = planMove(schematic, libById, selection);
    moveSpecRef.current = spec;
    movePointsRef.current = anchors;
    const moving = new Set([...selection, ...spec.wireStart, ...spec.wireEnd]);
    moveAnchorsRef.current = collectAnchors(schematic, libById, moving);
    moveStartRef.current = origin;
    moveDeltaRef.current = { x: 0, y: 0 };
    modeRef.current = 'move';
    grabbedRef.current = true;
    requestDraw();
  }, [grabRequest?.nonce]);

  // Escape abandons a handle drag: nothing has been committed, so dropping the
  // reshaped document puts the item back. Capture phase + stopPropagation so
  // the editor's own Escape does not also clear the selection.
  useEffect(() => {
    const onEsc = (ev: KeyboardEvent): void => {
      const e = remapEvent(ev, settings.hotkeys);
      if (!e || e.key !== 'Escape' || !pointDragRef.current) return;
      ev.stopPropagation();
      pointDragRef.current = null;
      pointEditDocRef.current = null;
      const target = pointTargetRef.current;
      if (target) setPointHandles(schematicRef.current, target);
      requestDrawRef.current();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [setPointHandles]);

  /**
   * Is something riding the pointer waiting to be dropped?
   *
   * `setCursor` asks exactly this before anything else, so a symbol, label,
   * directive flag, image or pasted group all show KICURSOR::PLACE while they
   * are attached, whatever tool put them there.
   */
  const attachedItem = !!(
    placeLib ||
    pendingLabel ||
    pendingDirective ||
    pendingImage ||
    pastePending
  );

  /**
   * `SCH_POINT_EDITOR::Main` shows its points for a single selected item of a
   * point-editable type, and its only other condition is that the item is not
   * still being drawn:
   *
   *     if( selection.Size() != 1 || !selection.Front()->IsType( pointEditorTypes ) )
   *         return 0;
   *
   *     // Wait till drawing tool is done
   *     if( selection.Front()->IsNew() )
   *         return 0;
   *
   * Note what is *not* there: which tool is active. Requiring the selection
   * tool — which this did — meant a freshly drawn shape showed no handles until
   * Escape dropped the drawing tool, even though the shape was already selected.
   * `IsNew()` is the flag an item carries while it is a ghost, so the equivalent
   * here is "nothing is mid-draw and nothing is riding the cursor".
   */
  useEffect(() => {
    const one = selection.size === 1 ? [...selection][0]! : null;
    const stillDrawing = !!drawStateRef.current || attachedItem;
    // A hover selection gets no handles. A right-click on an unselected item
    // picks it up only so the menu has something to act on, and upstream never
    // brings the point editor up on one — right-clicking a sheet cold shows the
    // menu with no grips on it, while right-clicking a sheet that was already
    // selected leaves the grips it already had.
    const target =
      one && !stillDrawing && !isHoverSelection ? pointEditTarget(schematic, one) : null;
    pointTargetRef.current = target;
    setPointHandles(schematic, target);
    if (!target) hoveredHandleRef.current = null;
    requestOverlayRef.current();
  }, [selection, schematic, activeTool, attachedItem, isHoverSelection, setPointHandles]);

  /**
   * The handle under a world point. EDIT_POINTS::FindPoint hit-tests each point's
   * own box, which stays POINT_SIZE screen pixels wide however far you are zoomed
   * in, so the tolerance is converted back through the view scale.
   */
  const handleAt = useCallback((p: Vec2): EditHandle | null => {
    const vp = viewportRef.current;
    const handles = pointHandlesRef.current;
    if (!vp || handles.length === 0) return null;
    const tol = (EDIT_POINT_SIZE * dpr()) / vp.scale;
    let best: EditHandle | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const h of handles) {
      const d = Math.hypot(h.at.x - p.x, h.at.y - p.y);
      // Corner points win ties: they sit on top of the edge handles either side.
      if (d <= tol && (d < bestD || (d === bestD && h.kind === 'point'))) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }, []);

  /**
   * The document as it should currently look: the schematic plus whatever ghost
   * the active tool has attached to the cursor. `ghosting` says whether any of
   * them applied, a ghost moves every frame, so it must never be baked into
   * the retained raster.
   */
  /**
   * The document as the screen shows it: the sheet plus whatever is riding the
   * cursor. `ghostIds` names the riders, because upstream selects the item it
   * is placing —
   *
   *     m_selectionTool->ClearSelection( true );
   *     m_selectionTool->AddItemToSel( item );
   *
   * — so it is drawn with the selection halo until it is dropped. Ours drew it
   * plain, which is why it did not stand out from the sheet under it.
   */
  const buildDisplayDoc = useCallback((): {
    doc: Schematic;
    ghosting: boolean;
    ghostIds: Set<string>;
  } => {
    const ghostIds = new Set<string>();
    const md = moveDeltaRef.current;
    const spec = moveSpecRef.current;
    let ghosting = false;
    // A break in flight has already split the wire, but only in the pending
    // command; everything downstream must see the split document.
    let doc = moveBaseRef.current ?? schematic;
    // A handle drag in flight paints the reshaped document instead: it changes
    // every frame, so like every other ghost it must not be baked into the raster.
    if (pointEditDocRef.current) {
      return { doc: pointEditDocRef.current, ghosting: true, ghostIds };
    }
    if (modeRef.current === 'move' && md && spec) {
      doc = buildMove(spec, md).apply(doc);
      ghosting = true;
    } else if (
      (activeTool === 'placeSymbol' || activeTool === 'placePower') &&
      placeLib &&
      cursorRef.current
    ) {
      // Ghost: show the symbol attached to the cursor (with its current orientation).
      const inst = placeInstanceRef.current;
      doc = (
        inst
          ? placeSymbolInstance(placeLib, moveSymbolTo(inst, snap(cursorRef.current)))
          : placeSymbol(placeLib, snap(cursorRef.current), placeOrientRef.current, placeUnit)
      ).apply(schematic);
      ghosting = true;
    }
    // Ghost: the named label follows the cursor (with its flag) until clicked to place.
    if (pendingLabel && cursorRef.current) {
      doc = addItems({
        labels: [buildPendingLabel(pendingLabel, snap(cursorRef.current), schematic, libById)],
      }).apply(doc);
      ghosting = true;
    }
    // Ghost: pasted items follow the cursor until dropped (KiCad's paste-then-move).
    if (pastePending && cursorRef.current) {
      const c = snap(cursorRef.current);
      const delta = { x: c.x - pastePending.refPoint.x, y: c.y - pastePending.refPoint.y };
      doc = pasteItems(translatePayload(pastePending, delta)).apply(doc);
      ghosting = true;
    }
    // Ghost: an image chosen in the editor follows the cursor until clicked.
    if (pendingImage && cursorRef.current) {
      // Re-placed, not rebuilt: same uuid every frame, so the decoded bitmap is
      // the cache's and the ghost is visible from the first move.
      doc = addItems({
        images: [
          makeImage(
            snap(cursorRef.current),
            pendingImage.data,
            pendingImage.scale,
            pendingImage.uuid,
          ),
        ],
      }).apply(doc);
      ghosting = true;
    }
    // Ghost: the bus-entry stub follows the cursor (R rotates its size vector).
    if (activeTool === 'busEntry' && cursorRef.current) {
      doc = addItems({
        busEntries: [makeBusEntry(snap(cursorRef.current), entrySizeRef.current)],
      }).apply(doc);
      ghosting = true;
    }
    // Ghost: the netclass flag rides the cursor until it is dropped.
    if (activeTool === 'placeClassLabel' && pendingDirective && cursorRef.current) {
      const flag = makeDirectiveLabel(snapConn(cursorRef.current), {
        shape: pendingDirective.shape,
        pinLength: pendingDirective.pinLength,
        netclass: pendingDirective.netclass,
        angle: pendingDirective.angle,
        ...(pendingDirective.fontSize ? { fontSize: pendingDirective.fontSize } : {}),
        ...(pendingDirective.fields ? { fields: pendingDirective.fields } : {}),
      });
      ghostIds.add(refId('directive', flag.uuid, (doc.directiveLabels ?? []).length));
      doc = addItems({ directiveLabels: [flag] }).apply(doc);
      ghosting = true;
    }
    // Ghost: the junction dot and the no-connect X ride the cursor, so you see
    // the item before you drop it, SingleClickPlace builds the item up front
    // and keeps it in the view preview (AddToPreview) for the whole run.
    if (activeTool === 'junction' && cursorRef.current) {
      doc = addItems({ junctions: [makeJunction(snapConn(cursorRef.current))] }).apply(doc);
      ghosting = true;
    }
    if (activeTool === 'noConnect' && cursorRef.current) {
      doc = addItems({ noConnects: [makeNoConnect(snapConn(cursorRef.current))] }).apply(doc);
      ghosting = true;
    }
    // Preview: the shape/sheet being drawn (rendered through the model so it
    // matches the final item exactly).
    const ds = drawStateRef.current;
    if (ds) {
      if (ds.tool === 'sheet') {
        // A sheet previews as a *sheet*, not as a rectangle:
        //
        //     sizeSheet( sheet, cursorPos );
        //     m_view->AddToPreview( sheet->Clone() );
        //
        // so while you drag it out you see the sheet's own border and its
        // Sheetname / Sheetfile text, rather than a plain notes-layer box that
        // turns into something else on release. `sizeSheet` also holds it to
        // MIN_SHEET_WIDTH / MIN_SHEET_HEIGHT the whole time.
        const at = { x: Math.min(ds.start.x, ds.cursor.x), y: Math.min(ds.start.y, ds.cursor.y) };
        const size = {
          w: Math.max(Math.abs(ds.cursor.x - ds.start.x), MIN_SHEET_WIDTH),
          h: Math.max(Math.abs(ds.cursor.y - ds.start.y), MIN_SHEET_HEIGHT),
        };
        // Not added to `ghostIds`: `DrawSheet` previews a bare clone and only
        // selects the sheet *after* the commit —
        //
        //     m_view->AddToPreview( sheet->Clone() );      // while sizing
        //     ...
        //     c.Push( "Draw Sheet" );
        //     m_selectionTool->AddItemToSel( sheet );      // after placing
        //
        // which is the opposite way round from `TwoClickPlace`, where the item
        // is selected the whole time it rides the cursor. So the outline stays
        // in the plain sheet-border colour until it is dropped.
        doc = addItems({ sheets: [makeSheet(at, size, 'Sheet', 'sheet.kicad_sch')] }).apply(doc);
      } else if (ds.tool === 'table') {
        // A table previews as a *table*, cells and all, not as a rectangle that
        // turns into one on release. The motion branch of `DrawTable` rebuilds
        // the whole grid on every mouse move and re-adds it to the preview:
        //
        //     table->ClearCells();
        //     table->SetColCount( colCount );
        //     … for each row/col: new SCH_TABLECELL …
        //     m_view->ClearPreview();
        //     m_view->AddToPreview( table->Clone() );
        //
        // so you can see how many rows and columns the drag has bought you
        // while you are still dragging. The size passed here is the raw
        // `cursorPos - origin`, unnormalized, exactly as upstream computes
        // `requestedSize` — dragging up or left gives the 1x1 that
        // `std::max( 1, … )` produces, and `Normalize()` only runs at the end.
        const size = { x: ds.cursor.x - ds.start.x, y: ds.cursor.y - ds.start.y };
        doc = addItems({
          tables: [
            makeTableFromDrag(ds.start, size, tableFontSizeIU ?? DEFAULT_TEXT_SIZE_IU, {
              x: GRID,
              y: GRID,
            }),
          ],
        }).apply(doc);
      } else {
        const g = previewGraphic(ds);
        if (g) doc = addItems({ graphics: [g] }).apply(doc);
      }
      ghosting = true;
    }
    return { doc, ghosting, ghostIds };
  }, [
    schematic,
    libById,
    activeTool,
    placeLib,
    placeUnit,
    pendingLabel,
    pendingDirective,
    pastePending,
    pendingImage,
    snapConn,
    buildMove,
    GRID,
  ]);

  /**
   * What a full repaint of this sheet last cost, in ms. Everything below keys
   * off it: a sheet that repaints inside a frame is always painted directly and
   * is therefore always pixel-exact, and only a sheet that cannot keep up falls
   * back to the retained raster.
   */
  const paintCostRef = useRef(0);

  /** Paint the whole schematic at `view` onto any context. */
  const paintSchematic = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      doc: Schematic,
      view: Viewport,
      width: number,
      height: number,
      /** A field dragged on its own draws its umbilical back to its symbol. */
      moving = false,
      /**
       * The items riding the cursor, drawn selected: `prepItemForPlacement`
       * ends with `AddItemToSel( item )`, so what you are about to place
       * carries the selection halo until you drop it.
       */
      ghostIds?: ReadonlySet<string>,
    ) => {
      const t0 = performance.now();
      const opts = moving ? { ...renderOpts, movingSelection: true } : renderOpts;
      const sel =
        ghostIds && ghostIds.size > 0 ? new Set([...(selection ?? []), ...ghostIds]) : selection;
      renderSchematic(ctx, doc, view, theme, width, height, sel, highlight, opts);
      // ERC markers are *not* drawn here — see `drawOverlay`. They belong above
      // the sheet, and this layer is below the GL one.
      // Track the worst recent cost, decaying slowly: one cheap frame (say a
      // view where almost everything is culled) must not talk us into direct
      // painting a sheet that is expensive as soon as it is zoomed out again.
      const cost = performance.now() - t0;
      paintCostRef.current = Math.max(cost, paintCostRef.current * 0.9);
    },
    // No `ercMarkers`: the overlay draws those now, and keeping them here
    // would re-record the whole GL buffer every time ERC runs.
    [theme, selection, highlight, renderOpts],
  );

  /**
   * The selection and net-highlight halos alone, onto the 2D layer under the
   * GL one.
   *
   * `SCH_PAINTER::getShadowWidth` is `screen_pixels + world_width`, so a halo
   * is the one piece of the sheet whose geometry genuinely depends on the zoom.
   * The GL buffer is recorded once and deliberately never re-recorded on a
   * zoom, so a halo baked into it keeps the width it had when it was recorded:
   * a three-pixel glow at fit-to-page becomes a twenty-pixel bar once you zoom
   * in on a part, which is what "the halo swallows the geometry" was.
   *
   * Drawing it here costs what the selection costs, is always the right width,
   * and lands *under* the item, which is where LAYER_SELECTION_SHADOWS goes.
   */
  const paintHalos = useCallback(
    (ctx: CanvasRenderingContext2D, doc: Schematic, view: Viewport, w: number, h: number) => {
      const spec = modeRef.current === 'move' ? moveSpecRef.current : null;
      if (!selection?.size && !highlight?.size && !spec) return;
      // Everything the drag picked up counts as selected while it runs, which
      // is literally what upstream does: `getConnectedDragItems` hands its
      // results to `m_selectionTool->AddItemToSel( item, QUIET_MODE )`, so the
      // wires and labels a drag grabbed are `IsSelected()` and get the halo and
      // the anchor cross that go with it.
      //
      // Ours only ever saw the app's selection — the symbol you grabbed — so no
      // label could pass the gate and the crosses could not appear during a
      // drag by construction.
      const shown = spec ? movingIds(spec) : selection;
      renderSchematic(ctx, doc, view, theme, w, h, shown, highlight, {
        ...renderOpts,
        halos: 'only',
        // The anchored end of each stretching wire is marked while a drag runs;
        // the plan is the only thing that knows which end is moving.
        ...(spec ? { draggedEnds: { startMoving: spec.wireStart, endMoving: spec.wireEnd } } : {}),
      });
    },
    [theme, selection, highlight, renderOpts],
  );

  /**
   * Retained scene raster, the board painter's approach (PcbEditor
   * startCrispRender / cacheRef): a full repaint of a dense sheet costs tens of
   * milliseconds, far too much to redo for every pan frame, so the schematic is
   * painted once into an offscreen canvas and panning/zooming just blits that
   * bitmap through the view delta. The crisp repaint follows on the next task
   * and swaps in when ready, so the view never blocks on it.
   */
  const sceneCacheRef = useRef<{ canvas: HTMLCanvasElement; view: Viewport } | null>(null);
  /** The schematic changed, so the raster no longer depicts it. */
  const rasterStaleRef = useRef(true);
  const renderingRef = useRef(false);
  /** Assigned once the frame scheduler below exists. */
  const requestDrawRef = useRef<() => void>(() => {});

  const sameView = (a: Viewport, b: Viewport): boolean =>
    a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY;

  const paintSchematicRef = useRef(paintSchematic);
  paintSchematicRef.current = paintSchematic;

  /**
   * A sheet that repaints in under this is painted directly on every frame, so
   * pan and zoom stay pixel-exact, no blurry intermediate, nothing to "catch
   * up" afterwards. The raster is a fallback for sheets that genuinely cannot
   * paint inside a frame, where the alternative is not a crisp view but a
   * ten-frames-per-second one. Deliberately under a 16 ms frame so the overlay
   * and the browser's own work still fit alongside it.
   */
  const DIRECT_PAINT_BUDGET_MS = 10;

  /**
   * How long the view must hold still before the raster is repainted for it,
   * only reached on sheets over the budget above. A pan moves the view every
   * frame; repainting each time would put a full render between every blit and
   * undo the point of caching. Short enough not to read as a lag.
   */
  const VIEW_SETTLE_MS = 48;
  const viewRebuildRef = useRef(0);

  /** Rebuild the raster for the current view, off the current frame. */
  const startSceneRender = useCallback(() => {
    clearTimeout(viewRebuildRef.current);
    if (renderingRef.current) return; // in flight, it re-checks on completion
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp || canvas.width < 2) return;
    renderingRef.current = true;
    rasterStaleRef.current = false;
    const jobView = { ...vp };
    const work = document.createElement('canvas');
    work.width = canvas.width;
    work.height = canvas.height;
    const wctx = work.getContext('2d');
    if (!wctx) {
      renderingRef.current = false;
      return;
    }
    // A task, not an animation frame: this must still run with the tab hidden.
    setTimeout(() => {
      try {
        paintSchematicRef.current(wctx, schematicRef.current, jobView, work.width, work.height);
        sceneCacheRef.current = { canvas: work, view: jobView };
      } finally {
        renderingRef.current = false;
      }
      requestDrawRef.current();
      // Chase whatever changed while we were painting: a content change is
      // followed at once, a view change only once the view settles.
      const now = viewportRef.current;
      if (rasterStaleRef.current) startSceneRenderRef.current();
      else if (now && !sameView(jobView, now)) scheduleViewRebuildRef.current();
    }, 0);
  }, []);
  const startSceneRenderRef = useRef(startSceneRender);
  startSceneRenderRef.current = startSceneRender;

  /** Repaint the raster once the view has stopped moving. */
  const scheduleViewRebuild = useCallback(() => {
    clearTimeout(viewRebuildRef.current);
    viewRebuildRef.current = window.setTimeout(() => startSceneRenderRef.current(), VIEW_SETTLE_MS);
  }, []);
  const scheduleViewRebuildRef = useRef(scheduleViewRebuild);
  scheduleViewRebuildRef.current = scheduleViewRebuild;
  useEffect(() => () => clearTimeout(viewRebuildRef.current), []);

  /** The schematic layer: a blit of the retained raster, or a direct paint. */
  const drawScene = useCallback(() => {
    const __t0 = PERF ? performance.now() : 0;
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { doc, ghosting, ghostIds } = buildDisplayDoc();

    // The WebGL path (#449). The 2D canvas keeps the background and the grid,
    // which are cheap and genuinely zoom-dependent; the document goes to the
    // GPU once and every later pan or zoom is a uniform update. That replaces
    // the ~70 ms unchunked repaint `startSceneRender` does after each gesture,
    // which is what makes the wheel feel like it stutters.
    // The GL recorder does not draw images yet, so a sheet carrying one is
    // painted by Canvas2D rather than silently losing it. Checked per frame
    // because it is a property of the document being drawn, and it costs a
    // length comparison.
    const gl = doc.images.length === 0 ? glRef.current : null;
    const dragSpec = modeRef.current === 'move' ? moveSpecRef.current : null;

    // A drag on the GL path: the document without the moving items stays on the
    // GPU, and only the moving items are re-recorded and re-uploaded per frame.
    //
    // This used to fall back to Canvas2D, which meant none of the WebGL work
    // applied to the one interaction it was most needed for. Worse, the
    // fallback cached a full-size bitmap keyed on the viewport, so any pan or
    // zoom mid-drag, including auto-pan at the canvas edge, threw it away and
    // re-rendered the whole sheet in Canvas2D: one such frame measured 116 ms,
    // which is the lurch where the symbol stops following the cursor.
    //
    // The base is keyed on the *moving set*, not on the view, so panning and
    // zooming during a drag cost nothing.
    if (gl && !gl.isLost && ghosting && dragSpec) {
      const base = moveBaseRef.current ?? schematicRef.current;
      // One set drives both halves, so they are exact complements: the base is
      // recorded without it, the preview draws only it.
      const split = dragSplit(movingIds(dragSpec), base, doc);
      // Only `hidden` needs a stable identity; the preview is re-recorded every
      // frame regardless, so a fresh set there costs nothing.
      const hidden = stableSplit.current(split.hidden);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawGrid(ctx, vp, theme, canvas.width, canvas.height, renderOpts.grid);
      paintHalos(ctx, doc, vp, canvas.width, canvas.height);
      gl.render(
        {
          doc: base,
          theme,
          opts: dragOptsRef.current(renderOpts, hidden),
          selection,
          highlight,
        },
        { scale: vp.scale, offsetX: vp.offsetX, offsetY: vp.offsetY },
        { doc, ids: split.preview },
      );
      notePaint('preview', __t0);
      onScaleChange?.(vp.scale);
      return;
    }
    // A ghost (a drag in flight, or a symbol attached to the cursor) rebuilds
    // the document every frame, and the GL buffer is keyed on the document's
    // identity, so it would re-record and re-upload the whole sheet on every
    // pointer move: roughly 165 ms a frame, far worse than the Canvas2D path it
    // is meant to replace. Ghost frames therefore go to Canvas2D below, which
    // is also what draws a moving field's umbilical (`movingSelection`).
    //
    // The real answer is KiCad's: `VIEW::AddToPreview` / `ClearPreview` keep the
    // items being dragged in a small group that is rebuilt each frame while the
    // cached geometry for everything else is left alone. That needs a way to
    // hide the moving items from the base recording, and is the next piece of
    // work on #449.
    if (gl && !gl.isLost && !ghosting) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawGrid(ctx, vp, theme, canvas.width, canvas.height, renderOpts.grid);
      paintHalos(ctx, doc, vp, canvas.width, canvas.height);
      gl.render(
        { doc, theme, opts: renderOpts, selection, highlight },
        { scale: vp.scale, offsetX: vp.offsetX, offsetY: vp.offsetY },
      );
      notePaint('gl', __t0);
      onScaleChange?.(vp.scale);
      return;
    }
    // Every path below paints the whole scene to the 2D canvas, and the GL
    // layer sits *above* it. A buffer left on that layer keeps showing through:
    // during a drag it put a second, stale copy of the symbol at its old
    // position while the real one followed the cursor underneath, and on
    // release the stale one appeared to teleport.
    //
    // Clear the *context*, not the local: `gl` above is null whenever this
    // render is not allowed to use GL, and "the document now has an image" is
    // one of those reasons. Reaching for `gl?.clear()` there is a no-op exactly
    // when the buffer most needs clearing — attaching an image to the cursor
    // switched the backend off mid-session and left the whole sheet's last GL
    // frame frozen on top of the live 2D one.
    glRef.current?.clear();

    // A drag repaints only what is moving, over a background painted once.
    //
    // This is KiCad's arrangement: `SCH_MOVE_TOOL` puts the dragged items in a
    // preview group (`m_view->AddToPreview` / `ClearPreview`) over an otherwise
    // static view, so a pointer move costs what the moving items cost and not
    // what the sheet costs. Repainting the whole sheet per pointer move is why
    // a dragged symbol trailed the cursor by the length of a full repaint,
    // which grew with the size of the sheet rather than with what was dragged.
    const moveSpec = modeRef.current === 'move' ? moveSpecRef.current : null;
    if (ghosting && moveSpec) {
      // The same split the GL path uses, so the background and the preview stay
      // exact complements here too. It is part of the background's cache key:
      // when a bend appears the background must be repainted without it, or the
      // preview draws it a second time over a stale copy.
      const split = dragSplit(
        movingIds(moveSpec),
        moveBaseRef.current ?? schematicRef.current,
        doc,
      );
      const hidden = stableSplit.current(split.hidden);
      const bg = dragBgRef.current;
      const reusable =
        bg &&
        bg.spec === moveSpec &&
        bg.split === hidden &&
        bg.canvas.width === canvas.width &&
        bg.canvas.height === canvas.height &&
        bg.view.scale === vp.scale &&
        bg.view.offsetX === vp.offsetX &&
        bg.view.offsetY === vp.offsetY;
      if (!reusable) {
        perf.rebuilds++;
        // Once per drag (and again if the view moves under it): the sheet
        // without the items being dragged.
        const work = document.createElement('canvas');
        work.width = canvas.width;
        work.height = canvas.height;
        const wctx = work.getContext('2d');
        if (wctx) {
          renderSchematic(
            wctx,
            moveBaseRef.current ?? schematicRef.current,
            vp,
            theme,
            work.width,
            work.height,
            selection,
            highlight,
            { ...renderOpts, hiddenItems: hidden },
          );
          dragBgRef.current = { canvas: work, view: { ...vp }, spec: moveSpec, split: hidden };
        }
      }
      const ready = dragBgRef.current;
      if (ready) {
        sceneCacheRef.current = null;
        rasterStaleRef.current = true;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(ready.canvas, 0, 0);
        // Only the moving items, at the cursor. `movingSelection` is what draws
        // a dragged field's umbilical back to its symbol.
        renderSchematic(ctx, doc, vp, theme, canvas.width, canvas.height, selection, highlight, {
          ...renderOpts,
          onlyItems: split.preview,
          movingSelection: true,
          draggedEnds: { startMoving: moveSpec.wireStart, endMoving: moveSpec.wireEnd },
        });
        notePaint('preview', __t0);
        onScaleChange?.(vp.scale);
        return;
      }
    }

    // Any other ghost (a symbol attached to the cursor, a handle drag) still
    // paints straight to the screen; the raster is dropped rather than having
    // the ghost baked into it.
    if (ghosting) {
      dragBgRef.current = null;
      sceneCacheRef.current = null;
      rasterStaleRef.current = true;
      paintSchematic(
        ctx,
        doc,
        vp,
        canvas.width,
        canvas.height,
        modeRef.current === 'move',
        ghostIds,
      );
      notePaint('ghostFull', __t0);
      onScaleChange?.(vp.scale);
      return;
    }
    // The drag is over: the background is stale and must not be reused.
    dragBgRef.current = null;

    // Sheets that can be repainted inside a frame always are, so panning and
    // zooming them is exact at every step and never has to resolve afterwards.
    if (paintCostRef.current <= DIRECT_PAINT_BUDGET_MS) {
      clearTimeout(viewRebuildRef.current);
      sceneCacheRef.current = null;
      rasterStaleRef.current = true;
      paintSchematic(ctx, doc, vp, canvas.width, canvas.height);
      notePaint('full', __t0);
      onScaleChange?.(vp.scale);
      return;
    }

    const cache = sceneCacheRef.current;
    const usable =
      cache && cache.canvas.width === canvas.width && cache.canvas.height === canvas.height;
    if (!usable) {
      // Nothing to blit (first frame, or the canvas was resized): paint now so
      // the sheet is on screen, and build the raster from it.
      paintSchematic(ctx, doc, vp, canvas.width, canvas.height);
      onScaleChange?.(vp.scale);
      startSceneRender();
      return;
    }

    // Blit the raster through the view delta. Panning past its edge exposes the
    // background until the crisp repaint lands, so clear first.
    const k = vp.scale / cache.view.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      k,
      0,
      0,
      k,
      vp.offsetX - cache.view.offsetX * k,
      vp.offsetY - cache.view.offsetY * k,
    );
    // Keep zoom-in crisp; let zoom-out smooth, so thin wires don't shimmer.
    ctx.imageSmoothingEnabled = k < 1;
    ctx.drawImage(cache.canvas, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    notePaint('blit', __t0);
    onScaleChange?.(vp.scale);

    // A changed sheet is repainted at once; a moved view waits for the gesture
    // to finish, so a pan is carried entirely by blits.
    if (rasterStaleRef.current) startSceneRender();
    else if (!sameView(cache.view, vp)) scheduleViewRebuild();
  }, [
    buildDisplayDoc,
    paintSchematic,
    paintHalos,
    startSceneRender,
    scheduleViewRebuild,
    onScaleChange,
    theme,
  ]);

  /**
   * Everything that tracks the pointer, on its own transparent canvas above the
   * scene: the selection rubber band, the lasso trace, the wire/bus chain being
   * drawn, and the crosshair. None of it needs the document, so a mouse move
   * repaints only this layer.
   */
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // ERC markers (KiCad's bent-arrow fault indicators), on this layer rather
    // than with the sheet.
    //
    // They used to be painted at the end of `paintSchematic`, which the GL
    // paths never call — so running ERC on the default renderer produced no
    // markers at all. Moving them down to the 2D scene layer would not have
    // worked either: the GL canvas sits above it, so a marker would have been
    // hidden by the very item it flags. LAYER_ERC_ERR / LAYER_ERC_WARN are
    // above the items upstream, and this is the only layer above them here.
    if (ercMarkers && ercMarkers.length > 0) drawErcMarkers(ctx, ercMarkers, vp, theme);

    // Box-selection rubber band, in KiCad's colours: the fill shows the mode
    // (normal/additive/subtractive) and the outline shows the direction,
    // dark yellow for a left-to-right "window", blue for right-to-left greedy.
    const bo = boxOriginRef.current;
    const be = boxEndRef.current;
    if (modeRef.current === 'box' && bo && be) {
      const greedy = be.x < bo.x;
      const { additive, subtractive } = boxModifiersRef.current;
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.fillStyle = subtractive
        ? BOX_FILL_SUBTRACT
        : additive
          ? BOX_FILL_ADDITIVE
          : BOX_FILL_NORMAL;
      ctx.strokeStyle = greedy ? BOX_OUTLINE_R2L : BOX_OUTLINE_L2R;
      ctx.lineWidth = 1 / vp.scale;
      const x = Math.min(bo.x, be.x),
        y = Math.min(bo.y, be.y);
      const w = Math.abs(be.x - bo.x),
        h = Math.abs(be.y - bo.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    // Lasso freehand polygon (KiCad selectLasso): closed, in the box colours.
    const lasso = lassoPointsRef.current;
    if (modeRef.current === 'lasso' && lasso.length >= 2) {
      const { additive, subtractive } = boxModifiersRef.current;
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.fillStyle = subtractive
        ? BOX_FILL_SUBTRACT
        : additive
          ? BOX_FILL_ADDITIVE
          : BOX_FILL_NORMAL;
      ctx.strokeStyle = BOX_OUTLINE_R2L; // lasso: greedy/touching, blue
      ctx.lineWidth = 1 / vp.scale;
      ctx.beginPath();
      lasso.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Wire / bus chain preview: every non-null segment of m_wires, with the
    // live pair coerced to the cursor by computeBreakPoint.
    const cur = cursorRef.current;
    if ((activeTool === 'drawWire' || activeTool === 'drawBus') && wiresRef.current.length && cur) {
      updateWireChain(snapConn(cur));
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.strokeStyle = activeTool === 'drawBus' ? theme.bus : theme.wire;
      // The same widths the committed wire or bus will have, so the preview
      // does not change thickness the moment it is placed (it used to hardcode
      // 6 and 12 mils while the renderer drew both at the graphic-line default).
      ctx.lineWidth =
        activeTool === 'drawBus'
          ? (renderOpts.defaultBusIU ?? 0.3048 * 10000)
          : (renderOpts.defaultWireIU ?? 0.1524 * 10000);
      ctx.beginPath();
      for (const seg of wiresRef.current) {
        if (segIsNull(seg)) continue;
        ctx.moveTo(seg.a.x, seg.a.y);
        ctx.lineTo(seg.b.x, seg.b.y);
      }
      ctx.stroke();
    }

    // Edit points (SCH_POINT_EDITOR): a square on every corner or vertex of the
    // one selected item and a circle at every edge midpoint, drawn at a fixed
    // screen size whatever the zoom, in LAYER_AUX_ITEMS white with the darker
    // border EDIT_POINTS::ViewDraw derives from it, thickening on hover.
    {
      const handles = pointHandlesRef.current;
      if (handles.length > 0 && modeRef.current !== 'move') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const r = dpr();
        const half = (EDIT_POINT_SIZE / 2) * r;
        const hovered = pointDragRef.current ?? hoveredHandleRef.current;
        ctx.fillStyle = editPointColor.fill;
        ctx.setLineDash([]);
        // Indicator lines first, so a handle square sits on top of the leader
        // that ends at it. `EDIT_POINTS::ViewDraw` strokes them at a quarter of
        // the handle border width, in the border colour, and gives them no
        // midpoint circle:
        //
        //     if( line.DrawLine() )
        //     {
        //         gal->SetLineWidth( borderSize / 4 );
        //         gal->SetStrokeColor( borderColor );
        //         gal->DrawLine( line.GetOrigin().GetPosition(), line.GetEnd().GetPosition() );
        //     }
        //
        // Like the handles they are a fixed screen size, so this runs in device
        // space rather than through the view transform.
        if (pointLeadersRef.current.length > 0) {
          ctx.strokeStyle = editPointColor.border;
          ctx.lineWidth = (EDIT_POINT_BORDER_SIZE / 4) * r;
          ctx.beginPath();
          for (const [a, b] of pointLeadersRef.current) {
            ctx.moveTo(a.x * vp.scale + vp.offsetX, a.y * vp.scale + vp.offsetY);
            ctx.lineTo(b.x * vp.scale + vp.offsetX, b.y * vp.scale + vp.offsetY);
          }
          ctx.stroke();
        }
        for (const h of handles) {
          const x = h.at.x * vp.scale + vp.offsetX;
          const y = h.at.y * vp.scale + vp.offsetY;
          const active = hovered?.kind === h.kind && hovered?.index === h.index;
          ctx.strokeStyle = active ? editPointColor.highlight : editPointColor.border;
          ctx.lineWidth = (active ? EDIT_POINT_HOVER_SIZE : EDIT_POINT_BORDER_SIZE) * r;
          ctx.beginPath();
          if (h.kind === 'line') ctx.arc(x, y, half, 0, Math.PI * 2);
          else ctx.rect(x - half, y - half, half * 2, half * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Crosshair cursor (GAL options): full-window lines or a small cross at
    // the snapped cursor position, in the LAYER_SCHEMATIC_CURSOR colour.
    // Drawing tools always show it (ShowCursor(true)); with the selection tool
    // it depends on "Always show crosshairs".
    if (cur && (inputPrefs.alwaysShowCrosshair || activeTool !== 'select')) {
      const c = CONNECTION_SNAP_TOOLS.has(activeTool) ? snapConn(cur) : snap(cur);
      ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
      ctx.strokeStyle = theme.cursor;
      ctx.lineWidth = 1 / vp.scale;
      ctx.setLineDash([]);
      const left = -vp.offsetX / vp.scale;
      const top = -vp.offsetY / vp.scale;
      const rightW = (canvas.width - vp.offsetX) / vp.scale;
      const bottomW = (canvas.height - vp.offsetY) / vp.scale;
      // Clip to the visible rect so the full-window / 45° lines never overrun.
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, rightW - left, bottomW - top);
      ctx.clip();
      ctx.beginPath();
      if (inputPrefs.crosshair === 'full') {
        ctx.moveTo(left, c.y);
        ctx.lineTo(rightW, c.y);
        ctx.moveTo(c.x, top);
        ctx.lineTo(c.x, bottomW);
      } else if (inputPrefs.crosshair === '45') {
        // 45° full-window crosshair (cursor45Crosshairs): two diagonals through
        // the cursor spanning the whole visible rect.
        const span = Math.max(rightW - left, bottomW - top);
        ctx.moveTo(c.x - span, c.y - span);
        ctx.lineTo(c.x + span, c.y + span);
        ctx.moveTo(c.x - span, c.y + span);
        ctx.lineTo(c.x + span, c.y - span);
      } else {
        const arm = SMALL_CROSS_PX / 2 / vp.scale;
        ctx.moveTo(c.x - arm, c.y);
        ctx.lineTo(c.x + arm, c.y);
        ctx.moveTo(c.x, c.y - arm);
        ctx.lineTo(c.x, c.y + arm);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [
    activeTool,
    updateWireChain,
    snapConn,
    theme,
    editPointColor,
    inputPrefs,
    renderOpts,
    ercMarkers,
    GRID,
  ]);

  /**
   * One repaint per animation frame, the way every other canvas in the app
   * schedules its work (PcbEditor/GerberCanvas/FootprintCanvas requestDraw).
   * `sceneDirtyRef` records whether the schematic layer has to be rebuilt too,
   * a plain pointer move only asks for the overlay.
   */
  const sceneDirtyRef = useRef(true);
  const rafRef = useRef(0);
  const drawSceneRef = useRef(drawScene);
  drawSceneRef.current = drawScene;
  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  const frame = useCallback(() => {
    rafRef.current = 0;
    if (sceneDirtyRef.current) {
      sceneDirtyRef.current = false;
      drawSceneRef.current();
    }
    drawOverlayRef.current();
  }, []);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  // Cancel-and-re-arm on every request, like the other canvases: the pending
  // frame is always the freshest one, and a request can never be swallowed by
  // an earlier frame that (in a throttled or occluded window) never arrives.
  const schedule = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => frameRef.current());
  }, []);
  /** Repaint the schematic (and the overlay) on the next frame. */
  const requestDraw = useCallback(() => {
    sceneDirtyRef.current = true;
    schedule();
  }, [schedule]);

  /** Let go of a grabbed move without committing anything. */
  const endGrab = useCallback(() => {
    grabbedRef.current = false;
    modeRef.current = 'idle';
    moveSpecRef.current = null;
    moveDeltaRef.current = null;
    moveStartRef.current = null;
    // A break that is abandoned takes its split with it: nothing was committed,
    // so dropping the pending command restores the unbroken wire.
    breakCmdRef.current = null;
    moveBaseRef.current = null;
    // The lock lives exactly as long as the move that owns it.
    axisLockRef.current = 'none';
    lastArrowRef.current = null;
    requestDraw();
  }, [requestDraw]);

  /**
   * Abandon whatever the pointer was doing, committing nothing.
   *
   * A button-drag is a tool loop upstream, and a loop that loses its input
   * device ends: `TOOL_MANAGER` cancels the active tool and `SCH_MOVE_TOOL`'s
   * commit is reverted, so the sheet goes back to how it was before the press.
   * Here the ghost is the only thing that has changed, so dropping the move
   * state is the whole revert.
   *
   * Reached from `pointercancel` and `lostpointercapture`, and from a
   * `pointerup` that arrives after the tool changed. Without it a lost capture
   * left `modeRef` on 'move' forever: the selection kept following the cursor
   * with no button held, and the next click committed that drag — which is how
   * a symbol ended up displaced with its wiring rewritten, and auto-saved.
   */
  const abortGesture = useCallback(() => {
    grabbedRef.current = false;
    modeRef.current = 'idle';
    moveSpecRef.current = null;
    moveDeltaRef.current = null;
    moveStartRef.current = null;
    breakCmdRef.current = null;
    moveBaseRef.current = null;
    axisLockRef.current = 'none';
    lastArrowRef.current = null;
    sheetPinDragRef.current = null;
    pointDragRef.current = null;
    pointEditDocRef.current = null;
    boxHitRef.current = null;
    pressHitRef.current = null;
    clarifyRef.current = null;
    boxOriginRef.current = null;
    boxEndRef.current = null;
    lassoPointsRef.current = [];
    zoomAreaRef.current = false;
    panLastRef.current = null;
    dragBgRef.current = null;
    const target = pointTargetRef.current;
    if (target) setPointHandles(schematicRef.current, target);
    requestDraw();
  }, [requestDraw, setPointHandles]);

  // Arrow keys nudge a grabbed move one grid square and lock the axis
  // (SCH_MOVE_TOOL's m_lastKeyboardCursorPosition block). Registered once, like
  // the Escape handler, so a restart cannot leave the move without a keyboard.
  useEffect(() => {
    const KEYS: Record<string, ArrowKey> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    };
    /** One grid step in world units, per axis, as CursorControl uses. */
    const stepFor = (key: ArrowKey, mult: number): Vec2 => ({
      x: (key === 'left' ? -1 : key === 'right' ? 1 : 0) * GRID * mult,
      y: (key === 'up' ? -1 : key === 'down' ? 1 : 0) * GRID * mult,
    });

    const onArrow = (rawArrow: KeyboardEvent): void => {
      // Cursor Up/Down/Left/Right are ordinary registry actions, so a user who
      // rebound or cleared one has to be obeyed here too.
      const ev = remapEvent(rawArrow, settings.hotkeys);
      if (!ev) return;
      const key = KEYS[ev.key];
      if (!key || ev.altKey) return; // Alt+Arrow is sheet navigation

      // With nothing grabbed the arrows drive the *crosshair*, which is
      // `COMMON_TOOLS::CursorControl` / `PanControl`: one grid step, ten with
      // Ctrl (`gridSize *= 10`), and Shift pans the view by ten instead.
      //
      // Browser delta, and it is unavoidable: upstream finishes with
      // `SetCursorPosition( cursor, /* warpMouse */ true )`, and a page cannot
      // move the OS pointer. The crosshair moves and everything that follows it
      // follows, but the next real mouse move snaps it back under the pointer.
      if (!grabbedRef.current) {
        const vp = viewportRef.current;
        if (!vp) return;
        ev.preventDefault();
        if (ev.shiftKey) {
          const d = stepFor(key, 10);
          viewportRef.current = { ...vp, offsetX: vp.offsetX - d.x, offsetY: vp.offsetY - d.y };
          requestDraw();
          return;
        }
        const at = cursorRef.current;
        if (!at) return;
        const d = stepFor(key, ev.ctrlKey || ev.metaKey ? 10 : 1);
        cursorRef.current = { x: at.x + d.x, y: at.y + d.y };
        requestDraw();
        return;
      }

      // A grabbed move keeps upstream's axis-lock behaviour below.
      if (ev.ctrlKey || ev.metaKey) return;
      const start = moveStartRef.current;
      const delta = moveDeltaRef.current;
      if (!start || !delta) return;
      ev.preventDefault();
      ev.stopPropagation();
      const next = nudge(
        {
          cursor: { x: start.x + delta.x, y: start.y + delta.y },
          lock: axisLockRef.current,
          lastKey: lastArrowRef.current,
        },
        key,
        GRID,
      );
      axisLockRef.current = next.lock;
      lastArrowRef.current = next.lastKey;
      moveDeltaRef.current = { x: next.cursor.x - start.x, y: next.cursor.y - start.y };
      requestDraw();
    };
    window.addEventListener('keydown', onArrow, true);
    return () => window.removeEventListener('keydown', onArrow, true);
  }, [requestDraw]);

  // Escape cancels a grabbed move (nothing was committed, so just drop the
  // ghost). Capture phase + stopPropagation so the editor's Escape doesn't also
  // clear the selection. Registered once rather than per grab, so a restart
  // (the grab effect) cannot leave the move without its escape hatch.
  useEffect(() => {
    const onEsc = (ev: KeyboardEvent): void => {
      const e = remapEvent(ev, settings.hotkeys);
      if (e?.key === 'Escape' && grabbedRef.current) {
        ev.stopPropagation();
        endGrab();
      }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [endGrab]);

  /** Repaint only the pointer overlay on the next frame. */
  const requestOverlay = schedule;
  requestDrawRef.current = requestDraw;
  requestOverlayRef.current = requestOverlay;
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const zoomAbout = useCallback(
    (px: number, py: number, factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const wx = (px - vp.offsetX) / vp.scale;
      const wy = (py - vp.offsetY) / vp.scale;
      const scale = vp.scale * factor;
      viewportRef.current = { scale, offsetX: px - wx * scale, offsetY: py - wy * scale };
      requestDraw();
    },
    [requestDraw],
  );

  /** Zoom about the cursor, falling back to the viewport centre when it is off-canvas. */
  const zoomAboutCursor = useCallback(
    (factor: number) => {
      const c = canvasRef.current;
      const vp = viewportRef.current;
      if (!c || !vp) return;
      const cur = cursorRef.current;
      if (cur) zoomAbout(cur.x * vp.scale + vp.offsetX, cur.y * vp.scale + vp.offsetY, factor);
      else zoomAbout(c.width / 2, c.height / 2, factor);
    },
    [zoomAbout],
  );

  // A fit requested before the canvas has been laid out (ResizeObserver hasn't
  // fired yet, so the canvas still has its default 300x150 size) is deferred
  // and honoured by the size effect below.
  const fitPendingRef = useRef(false);
  const sizedRef = useRef(false);

  useImperativeHandle(
    ref,
    (): CanvasController => ({
      zoomToFit: (objectsOnly = false) => {
        const c = canvasRef.current;
        if (!c || !sizedRef.current) {
          fitPendingRef.current = true;
          return;
        }
        viewportRef.current = fitToContent(schematic, c.width, c.height, !objectsOnly, libById);
        requestDraw();
      },
      zoomToBox: (box) => {
        const c = canvasRef.current;
        if (!c || !sizedRef.current) return;
        viewportRef.current = fitToBBox(box, c.width, c.height);
        requestDraw();
      },
      redraw: () => requestDraw(),
      // ACTIONS::zoomIn / zoomOut are "Zoom In/Out **at Cursor**": F1 and F2
      // both run COMMON_TOOLS::ZoomInOut, which calls doZoomToPreset with
      // aCenterOnCursor true and so `view->SetScale( scale, GetCursorPosition() )`.
      // (zoomInCenter / zoomOutCenter, which do zoom about the viewport centre,
      // have no default hotkey at all.) With the pointer off the canvas there
      // is no cursor to zoom about, so the centre is the fallback.
      zoomIn: () => zoomAboutCursor(1.25),
      zoomOut: () => zoomAboutCursor(0.8),
      centerOn: (p: Vec2) => {
        const c = canvasRef.current;
        const vp = viewportRef.current;
        if (!c || !vp) return;
        // Keep the zoom, but make sure the fault is legible (~ 0.02 px/IU minimum).
        const scale = Math.max(vp.scale, 0.002);
        viewportRef.current = {
          scale,
          offsetX: c.width / 2 - p.x * scale,
          offsetY: c.height / 2 - p.y * scale,
        };
        requestDraw();
      },
    }),
    [schematic, libById, requestDraw, zoomAbout, zoomAboutCursor],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bring up the GL device once the layer is mounted. A null means this browser
  // or this moment cannot give us WebGL2, and `drawScene` then takes the
  // Canvas2D path exactly as before: an editor that renders is worth more than
  // one that renders quickly.
  useEffect(() => {
    if (!GL_RENDERER) return;
    const canvas = glCanvasRef.current;
    if (!canvas || glRef.current) return;
    glRef.current = SchematicGl.create(canvas);
    if (!glRef.current) console.warn('WebGL2 unavailable; using the Canvas2D renderer');
    // A lost context is not an error we can prevent, only one we can survive:
    // drop the device and let the next frame fall back.
    const onLost = (e: Event): void => {
      e.preventDefault();
      glRef.current?.dispose();
      glRef.current = null;
      requestDrawRef.current();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      glRef.current?.dispose();
      glRef.current = null;
    };
  }, []);

  // Size the backing stores. Assigning canvas.width *always* clears the bitmap,
  // even to the value it already has, so this must not run on every document
  // change, or every edit blanks the canvas for a frame before it repaints.
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay || size.w === 0 || size.h === 0) return;
    const r = dpr();
    const w = Math.floor(size.w * r);
    const h = Math.floor(size.h * r);
    // The GL layer is sized with the others when it is mounted. Its drawing
    // buffer is the viewport the shaders project into, so a stale size shows up
    // as a document drawn at the wrong scale rather than as nothing at all.
    const layers = [canvas, overlay, ...(glCanvasRef.current ? [glCanvasRef.current] : [])];
    for (const c of layers) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      c.style.width = `${size.w}px`;
      c.style.height = `${size.h}px`;
    }
    sizedRef.current = true;
    if (!viewportRef.current || fitPendingRef.current) {
      viewportRef.current = fitToContent(
        schematicRef.current,
        canvas.width,
        canvas.height,
        true,
        libById,
      );
      fitPendingRef.current = false;
    }
    requestDraw();
  }, [size, requestDraw]);

  // The sheet, or the way it is painted, changed: the retained raster no longer
  // depicts it and has to be rebuilt rather than blitted. Declared before the
  // repaint effect below so the flag is set by the time that one runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: paintSchematic is the signal, not a callee
  useEffect(() => {
    rasterStaleRef.current = true;
  }, [schematic, paintSchematic]);

  // Repaint whenever anything the scene is built from changes, `drawScene`'s
  // identity tracks the document, selection, tool, theme and display options,
  // so it is the invalidation signal even though the effect never calls it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawScene is the signal, not a callee
  useEffect(() => {
    requestDraw();
  }, [drawScene, requestDraw]);
  // The same for the overlay, which the scene repaint does not cover: it is a
  // separate canvas, and the only thing that ever asked for one was a pointer
  // event. So switching crosshair mode left the old crosshair on screen until
  // the mouse moved — and switching it from the toolbar means the mouse is not
  // over the canvas at all. `drawOverlay`'s identity tracks the tool, theme and
  // input preferences, so it is the signal here just as `drawScene` is above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawOverlay is the signal, not a callee
  useEffect(() => {
    requestOverlay();
  }, [drawOverlay, requestOverlay]);
  // Embedded bitmaps decode asynchronously; repaint when one becomes ready.
  useEffect(() => {
    setRenderInvalidator(requestDraw);
    return () => setRenderInvalidator(null);
  }, [requestDraw]);
  // Cancel an in-progress wire and reset the placement orientation only when the
  // tool actually changes (not on every schematic update, which would break the
  // multi-segment wire chain). When drawWire was just auto-started from a dangling
  // pin, seed the wire's first anchor with that pin instead of clearing it.
  useEffect(() => {
    if (activeTool === 'drawWire' && pendingWireStartRef.current) {
      // Auto-start from the dangling pin (startSegments primes the chain).
      wiresRef.current = startSegments(pendingWireStartRef.current, lineModeRef.current);
      pendingWireStartRef.current = null;
    } else {
      wiresRef.current = [];
    }
    wirePostureRef.current = false;
    wireLastModeRef.current = lineModeRef.current;
    placeOrientRef.current = { angle: 0 };
    // Switching tools abandons any in-progress shape and resets the entry stub.
    drawStateRef.current = null;
    entrySizeRef.current = { x: DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE };
    // Per-tool cursor (PICKER_TOOL::SetCursor / the drawing tools' KICURSOR):
    // the wire/bus tools use KiCad's green wire cursor, the net-highlight
    // picker the bullseye (sch_editor_control.cpp:1802), everything else the
    // plain crosshair the drawing tools show.
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = toolCursor(activeTool, attachedItem);
  }, [activeTool, attachedItem]);

  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const canvas = canvasRef.current!;
    const vp = viewportRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * dpr();
    const py = (clientY - rect.top) * dpr();
    return { x: (px - vp.offsetX) / vp.scale, y: (py - vp.offsetY) / vp.scale };
  };

  // Scroll gestures (PANEL_MOUSE_SETTINGS): the modifier held selects zoom /
  // pan up-down / pan left-right; zoom speed and reverse flags apply.
  //
  // Bound natively and non-passively in the effect below, the way every other
  // canvas in the app binds it (PcbEditor, GerberCanvas, FootprintCanvas,
  // DrawingSheetCanvas). React registers `onWheel` as a *passive* listener on
  // the root container, so `preventDefault()` there is a no-op and the browser
  // keeps its own gesture: Ctrl+wheel zooms the whole page, and a trackpad
  // two-finger scroll can overscroll the window out from under the canvas.
  const onWheel = useCallback(
    (e: WheelEvent) => {
      const canvas = canvasRef.current;
      const vp = viewportRef.current;
      if (!canvas || !vp) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mod: 'none' | 'ctrl' | 'shift' | 'alt' =
        e.ctrlKey || e.metaKey ? 'ctrl' : e.shiftKey ? 'shift' : e.altKey ? 'alt' : 'none';
      const delta = e.deltaY;

      if (
        mod === inputPrefs.scrollModPanV &&
        inputPrefs.scrollModPanV !== inputPrefs.scrollModZoom
      ) {
        viewportRef.current = { ...vp, offsetY: vp.offsetY - delta * dpr() };
        requestDraw();
        return;
      }
      if (
        mod === inputPrefs.scrollModPanH &&
        inputPrefs.scrollModPanH !== inputPrefs.scrollModZoom
      ) {
        const d = inputPrefs.reverseScrollPanH ? -delta : delta;
        viewportRef.current = { ...vp, offsetX: vp.offsetX - d * dpr() };
        requestDraw();
        return;
      }
      if (mod !== inputPrefs.scrollModZoom) return;
      // Horizontal touchpad movement pans when enabled.
      if (inputPrefs.horizontalPan && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        viewportRef.current = { ...vp, offsetX: vp.offsetX - e.deltaX * dpr() };
        requestDraw();
        return;
      }
      const speed = inputPrefs.zoomSpeedAuto ? 1 : inputPrefs.zoomSpeed / 5;
      const dir = inputPrefs.reverseZoom ? 1 : -1;
      zoomAbout(
        (e.clientX - rect.left) * dpr(),
        (e.clientY - rect.top) * dpr(),
        Math.exp(dir * delta * 0.001 * speed),
      );
    },
    [zoomAbout, requestDraw, inputPrefs],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Finish a rectangle/circle/arc (2nd click), a bezier (4th click), or a
  // sheet rectangle (which hands off to the editor for its name/file dialog).
  const finalizeShape = useCallback(
    (ds: DrawState, p: Vec2) => {
      drawStateRef.current = null;
      let g: LibGraphic | null = null;
      if (ds.tool === 'rectangle') g = makeRectangle(ds.start, p);
      else if (ds.tool === 'circle')
        g = makeCircle(ds.start, Math.hypot(p.x - ds.start.x, p.y - ds.start.y));
      else if (ds.tool === 'ellipse')
        g = makeEllipse(ds.start, Math.abs(p.x - ds.start.x), Math.abs(p.y - ds.start.y));
      else if (ds.tool === 'ellipseArc')
        g = makeEllipseArc(ds.start, Math.abs(p.x - ds.start.x), Math.abs(p.y - ds.start.y), 0, 90);
      else if (ds.tool === 'arc') {
        const a = arcFrom2(ds.start, p);
        if (a) g = makeArc(a.start, a.mid, a.end);
      } else if (ds.tool === 'bezier' && ds.bezier) {
        // The four points the edit states have filled in: start, C1, C2, end —
        // a real `SHAPE_T::BEZIER`, so the point editor gives it the four
        // handles `EDA_BEZIER_POINT_EDIT_BEHAVIOR` gives it. It used to flatten
        // a *quadratic* into a 25-point polyline, which is the wrong curve
        // family, is not a bezier in the file, and puts a handle on every one
        // of those flattened vertices.
        const [p0, c1, c2, p1] = bezierPoints(ds.bezier);
        g = makeBezier(p0, c1, c2, p1);
      } else if (ds.tool === 'sheet') {
        const at = { x: Math.min(ds.start.x, p.x), y: Math.min(ds.start.y, p.y) };
        const size = { w: Math.abs(p.x - ds.start.x), h: Math.abs(p.y - ds.start.y) };
        if (size.w > 0 && size.h > 0) onSheetDrawn?.(at, size);
        requestDraw();
        return;
      } else if (ds.tool === 'textbox') {
        const start = { x: Math.min(ds.start.x, p.x), y: Math.min(ds.start.y, p.y) };
        const end = { x: Math.max(ds.start.x, p.x), y: Math.max(ds.start.y, p.y) };
        if (end.x > start.x && end.y > start.y) onTextBoxDrawn?.(start, end);
        requestDraw();
        return;
      } else if (ds.tool === 'table') {
        // "table->Normalize(); DIALOG_TABLE_PROPERTIES dlg( m_frame, table );"
        // — the drag fixes the grid, then the dialog confirms it, and only OK
        // commits.
        const start = { x: Math.min(ds.start.x, p.x), y: Math.min(ds.start.y, p.y) };
        const end = { x: Math.max(ds.start.x, p.x), y: Math.max(ds.start.y, p.y) };
        if (end.x > start.x && end.y > start.y) onTableDrawn?.(start, end);
        requestDraw();
        return;
      }
      if (g) {
        onCommand(addItems({ graphics: [g] }));
        // `EE_GRAPHIC_TOOL::DrawShape` selects what it just drew:
        //
        //     m_selectionTool->AddItemToSel( item.get() );
        //     SCH_COMMIT commit( m_toolMgr );
        //     commitItem( commit, std::move( item ), … );
        //
        // and the arc, bezier, table, image, symbol and label paths all do the
        // same. Graphics are addressed by index, so the new one is the length
        // the array had before the command ran.
        onSelect(refId('graphic', undefined, schematic.graphics.length), false);
      }
      requestDraw();
    },
    [onCommand, onSelect, schematic, onSheetDrawn, onTextBoxDrawn, onTableDrawn, requestDraw],
  );

  // Finish an open polyline (lines tool): double-click / Enter / right-click.
  const finishPoly = useCallback(() => {
    const ds = drawStateRef.current;
    if (ds?.tool !== 'lines' && ds?.tool !== 'ruleArea') return;
    const rule = ds.tool === 'ruleArea';
    drawStateRef.current = null;
    // A rule area needs an area, so it takes three corners; an open polyline
    // is happy with two points.
    if (ds.points.length >= (rule ? 3 : 2)) {
      onCommand(addItems({ graphics: [rule ? makeRuleArea(ds.points) : makePolyline(ds.points)] }));
      // Every drawing tool selects what it just made — `AddItemToSel( item )`
      // in `EE_GRAPHIC_TOOL::DrawShape`, `RunAction( selectItem, ruleArea )` in
      // `RULE_AREA_CREATE_HELPER::commitRuleArea` — so it comes up with its halo
      // and its edit points already on. Graphics are addressed by index, and the
      // new one is appended, so its id is the length the array had before.
      onSelect(refId('graphic', undefined, schematic.graphics.length), false);
    }
    requestDraw();
  }, [onCommand, onSelect, schematic, requestDraw]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const world = toWorld(e.clientX, e.clientY);

      // A keyboard grabbed move (M/G) commits on the next left click.
      if (grabbedRef.current) {
        if (e.button !== 0) return;
        const d = moveDeltaRef.current;
        const spec = moveSpecRef.current;
        if (d && spec && (d.x !== 0 || d.y !== 0)) onCommand(buildMoveCommit(spec, d));
        endGrab();
        return;
      }

      // Middle/right-button drag pans or zooms per the Drag Gestures settings.
      if (e.button === 1 || e.button === 2) {
        const action = e.button === 1 ? inputPrefs.mouseMiddle : inputPrefs.mouseRight;
        if (action === 'none') return;
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = action === 'zoom' ? 'dragzoom' : 'pan';
        panLastRef.current = { x: e.clientX, y: e.clientY };
        panMovedRef.current = false;
        e.preventDefault();
        return;
      }

      // A pending image follows the cursor; a left click drops it.
      if (pendingImage) {
        if (e.button !== 0) return;
        onImagePlaced?.(snap(world));
        return;
      }

      // Zoom to Selection Area: a left drag draws the zoom rectangle.
      if (activeTool === 'zoomTool' && e.button === 0) {
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = 'box';
        zoomAreaRef.current = true;
        boxOriginRef.current = world;
        boxEndRef.current = world;
        return;
      }

      // A pending paste follows the cursor; a left click drops it (KiCad's paste-then-move).
      if (pastePending) {
        if (e.button !== 0) return;
        const c = snap(world);
        const delta = { x: c.x - pastePending.refPoint.x, y: c.y - pastePending.refPoint.y };
        const placed = translatePayload(pastePending, delta);
        onCommand(pasteItems(placed));
        const ids = new Set<string>();
        placed.batch.symbols.forEach((s) => ids.add(s.uuid!));
        placed.batch.lines.forEach((l) => ids.add(l.uuid!));
        placed.batch.junctions.forEach((j) => ids.add(j.uuid!));
        placed.batch.labels.forEach((l) => ids.add(l.uuid!));
        onPasteDone?.(ids);
        return;
      }

      if (activeTool === 'drawWire' || activeTool === 'drawBus') {
        const kind = activeTool === 'drawBus' ? 'bus' : 'wire';
        const wires = wiresRef.current;
        const cursorPos = snapConn(world);
        if (wires.length === 0) {
          wiresRef.current = startSegments(cursorPos, lineMode);
          wireLastModeRef.current = lineMode;
        } else {
          const pos = updateWireChain(cursorPos);
          const twoSegments = lineMode !== 'free';
          const last = wires[wires.length - 1]!;
          // Only place once something has actually been drawn.
          if (
            !segIsNull(last) ||
            (twoSegments && wires.length >= 2 && !segIsNull(wires[wires.length - 2]!))
          ) {
            // Terminate the run if the end point is on a pin, junction,
            // label, or another wire or bus (IsTerminalPoint).
            if (isTerminalPoint(schematic, libById, pos, kind)) {
              finishWireChain();
            } else {
              // Fix the segment and chain new live segment(s) after it. With
              // the 45° end the user targets the endpoint with the angled
              // portion, so both segments place at once.
              const placedSegments = lineMode === '45' ? 2 : 1;
              for (let i = 0; i < placedSegments; i++) wires.push({ a: { ...pos }, b: { ...pos } });
            }
          }
        }
        requestDraw();
        return;
      }

      if (activeTool === 'junction') {
        // SCH_DRAWING_TOOLS::SingleClickPlace refuses a dot where nothing joins
        // - otherwise the schematic cleanup would drop it again straight away,
        // which reads as "the tool did nothing".
        const at = snapConn(world);
        if (!isExplicitJunctionAllowed(schematic, libById, at)) {
          onInfoBar?.('Junction location contains no joinable wires and/or pins.');
          return;
        }
        onInfoBar?.(null);
        onCommand(addItems({ junctions: [makeJunction(at)] }));
        return;
      }

      // No-connect flags snap to the nearest pin/anchor, as KiCad's placement does.
      if (activeTool === 'noConnect') {
        onCommand(addItems({ noConnects: [makeNoConnect(snapConn(world))] }));
        return;
      }

      // Label tools: once the name/shape are chosen (pendingLabel), a click drops the
      // label at the snapped point. It stays attached so the same label can be placed on
      // several wires; Escape (handled in App) ends the run.
      if (LABEL_TOOLS[activeTool]) {
        if (pendingLabel) {
          const placed = buildPendingLabel(pendingLabel, snap(world), schematic, libById);
          onCommand(addItems({ labels: [placed] }));
          // The label was selected while it rode the cursor
          // (`prepItemForPlacement` -> `AddItemToSel`) and nothing deselects it
          // when it is dropped, so it stays selected after placement.
          onSelect(refId('label', placed.uuid, schematic.labels.length), false);
          // The placed label is done with; the tool takes the next one of a
          // multi-label run, or waits for a click to ask for another.
          // Its id is what F1 repeats (SCH_EDIT_FRAME's repeat list).
          onLabelPlaced?.(placed.uuid);
        } else {
          onLabelPrompt?.(snapConn(world));
        }
        return;
      }

      // Netclass directive label: the dialog names it, a click drops it.
      if (activeTool === 'placeClassLabel') {
        if (pendingDirective) {
          const flag = makeDirectiveLabel(snapConn(world), {
            shape: pendingDirective.shape,
            pinLength: pendingDirective.pinLength,
            netclass: pendingDirective.netclass,
            angle: pendingDirective.angle,
            ...(pendingDirective.fontSize ? { fontSize: pendingDirective.fontSize } : {}),
            ...(pendingDirective.fields ? { fields: pendingDirective.fields } : {}),
          });
          onCommand(addItems({ directiveLabels: [flag] }));
          onSelect(refId('directive', flag.uuid, (schematic.directiveLabels ?? []).length), false);
          onLabelPlaced?.();
        } else {
          onLabelPrompt?.(snapConn(world));
        }
        return;
      }

      // Wire-to-bus entry: click drops a 45° stub (R rotates it; stays active).
      // A stub drawn bus-to-bus becomes a bus *segment* instead, because that is
      // what the file format can hold — saveBusEntry converts one on the way out
      // and parseBusEntry can never read one back.
      if (activeTool === 'busEntry') {
        onCommand(
          addItems(makeBusEntryOrSegment(schematic, libById, snap(world), entrySizeRef.current)),
        );
        return;
      }

      // Sheet-pin: click a sheet border to add a pin there (editor prompts for the name).
      if (activeTool === 'sheetPin') {
        const found = nearestSheetEdge(schematic, world, (10 * dpr()) / vp.scale, snap);
        if (found) onSheetPinClick?.(found.index, found.at, found.side);
        return;
      }

      // Shape / sheet drawing tools (SCH_ACTIONS::draw*): 2-click for rectangle /
      // circle / arc / sheet, multi-click for lines, 3-click for bezier.
      const shapeKind = SHAPE_TOOL[activeTool];
      if (shapeKind) {
        const p = snap(world);
        const ds = drawStateRef.current;
        if (!ds) {
          drawStateRef.current = {
            tool: shapeKind,
            start: p,
            points: [p],
            cursor: p,
            // "item->BeginEdit( cursorPos )" — the bezier's first click puts all
            // four of its points on the cursor and arms edit state 1.
            ...(shapeKind === 'bezier' ? { bezier: beginBezier(p) } : {}),
          };
        } else if (shapeKind === 'lines' || shapeKind === 'ruleArea') {
          // "Check if it is double click / closing line (so we have to finish
          // the zone)": a rule area is finished by putting a point back on the
          // one it started from.
          //
          //     bool POLYGON_GEOM_MANAGER::NewPointClosesOutline( const VECTOR2I& aPt ) const
          //     { return m_lockedPoints.PointCount() > 0 && m_lockedPoints.CPoint( 0 ) == aPt; }
          const first = ds.points[0]!;
          if (
            shapeKind === 'ruleArea' &&
            ds.points.length >= 3 &&
            first.x === p.x &&
            first.y === p.y
          ) {
            finishPoly();
            return;
          }
          const last = ds.points[ds.points.length - 1]!;
          if (last.x !== p.x || last.y !== p.y) ds.points.push(p);
        } else if (shapeKind === 'bezier') {
          // "finished = !item->ContinueEdit( cursorPos );" — each click after
          // the first advances the edit state, and the one that finds it at 3
          // ends the curve. Four clicks in all: start, end, C1, C2.
          //
          // The geometry is settled by `calcEdit` first. Upstream leaves that
          // to the motion event that precedes the click; doing it here as well
          // costs nothing (it is the same cursor position) and means a click
          // with no motion before it — a tap — still lands its point.
          ds.bezier = calcBezier(ds.bezier ?? beginBezier(p), p);
          const next = continueBezier(ds.bezier);
          if (next) ds.bezier = next;
          else finalizeShape(ds, p);
        } else {
          finalizeShape(ds, p);
        }
        requestDraw();
        return;
      }

      if (activeTool === 'delete') {
        const hit = pickAt(world);
        if (hit) onCommand(deleteByIds(new Set([hit.id])));
        return;
      }

      // Highlight-Net tool (KiCad SCH_EDITOR_CONTROL::HighlightNet): click a
      // connectable item to brighten its net; click empty space to clear it.
      // The pick is GetNode's, connectable types only, at growing thresholds,
      // so pins, power flags and sheet pins highlight and a symbol body doesn't
      // swallow the click. The picker also runs unsnapped (SetSnapping(false)).
      if (activeTool === 'highlightNet') {
        const node = getNode(schematic, libById, world, Math.max((5 * dpr()) / vp.scale, GRID));
        onHighlight?.(node ? node.id : null);
        return;
      }

      if (activeTool === 'placeSymbol' || activeTool === 'placePower') {
        if (placeLib) {
          const inst = placeInstanceRef.current;
          // Built, then annotated, then placed. `placeSymbol` makes the symbol
          // internally, so the pre-built form is used to get the reference on
          // before the command exists — sch_drawing_tools.cpp annotates inside
          // the same commit, and this is how that stays one undo step.
          //
          // "Place next unit" keeps the reference it is copying (upstream
          // passes reannotate = false), so it is not touched here.
          const built = inst
            ? moveSymbolTo(inst, snap(world))
            : makeSymbol(placeLib, snap(world), placeOrientRef.current, placeUnit);
          const ready = inst || !onAnnotatePlacement ? built : onAnnotatePlacement(built, placeLib);
          onCommand(placeSymbolInstance(placeLib, ready));
          // The editor steps to the next unit, keeps placing copies, or
          // reopens the chooser (sch_drawing_tools.cpp after commit.Push).
          onSymbolPlaced?.();
        }
        return;
      }

      // Lasso selection tool (KiCad selectLasso): a left-press starts a freehand
      // polygon trace; a plain click (no drag) selects the pressed item or clears.
      if (activeTool === 'selectLasso') {
        (e.target as Element).setPointerCapture(e.pointerId);
        const hit = pickAt(world);
        modeRef.current = 'lasso';
        boxHitRef.current = hit ? hit.id : null;
        lassoPointsRef.current = [world];
        boxModifiersRef.current = {
          additive: (e.ctrlKey || e.shiftKey) && !e.altKey,
          subtractive: e.ctrlKey && e.shiftKey && !e.altKey,
        };
        return;
      }

      if (activeTool !== 'select') return; // other tools not yet implemented

      // Ctrl/Cmd-click on text carrying a `(hyperlink …)` follows it, the way
      // SCH_EDIT_FRAME does: "#<page>" jumps to that sheet, a URL opens.
      if (e.ctrlKey || e.metaKey) {
        const linked = pickAt(world);
        if (linked?.kind === 'label' || linked?.kind === 'textbox') {
          const link =
            linked.kind === 'label'
              ? schematic.labels.find((l, i) => refId('label', l.uuid, i) === linked.id)?.hyperlink
              : schematic.textBoxes.find((tb, i) => refId('textbox', tb.uuid, i) === linked.id)
                  ?.hyperlink;
          if (link) {
            onFollowLink?.(link);
            return;
          }
        }
      }

      // Auto-start a wire when clicking a dangling pin (KiCad's autostartEvent),
      // gated by the "Automatically start wires on unconnected pins" preference.
      const pin = inputPrefs.autoStartWires ? danglingPinAt(world) : null;
      if (pin && !e.shiftKey) {
        pendingWireStartRef.current = pin;
        onRequestTool?.('drawWire');
        return;
      }

      // An ERC marker takes the press before anything in the document does: its
      // layers are the top of SCH_LAYER_ORDER, and `SCH_MARKER_T` is "always
      // selectable" in SCH_SELECTION_TOOL. Selecting one cross-probes to the
      // ERC dialog, which is `SCH_INSPECTION_TOOL::CrossProbe` running off the
      // selection change rather than off the click.
      if (e.button === 0 && activeTool === 'select') {
        const marker = pickMarker(world);
        if (marker) {
          onMarkerPick?.(marker, false);
          return;
        }
      }

      // A sheet pin is constrained to its sheet's border, so dragging one is
      // not a move by a delta and does not go through the move tool.
      if (e.button === 0 && activeTool === 'select') {
        const hit = pickAt(world);
        if (hit?.kind === 'sheetpin') {
          const ref = parseSheetPinId(schematic, hit.id);
          if (ref) {
            (e.target as Element).setPointerCapture(e.pointerId);
            onSelect(hit.id, e.shiftKey);
            sheetPinDragRef.current = ref;
            return;
          }
        }
      }

      // A handle under the cursor takes the press: SCH_POINT_EDITOR runs ahead
      // of the selection tool, so grabbing a point reshapes the item rather than
      // starting a move of it.
      if (e.button === 0) {
        const grabbed = handleAt(world);
        if (grabbed) {
          (e.target as Element).setPointerCapture(e.pointerId);
          pointDragRef.current = grabbed;
          requestOverlay();
          return;
        }
      }

      // select / move: the `evt->IsDrag( BUT_LEFT )` branch of
      // SCH_SELECTION_TOOL::Main, whose decisive test is
      // `selectionContains( DragOrigin() )` — is the press inside a *selected*
      // item's box plus a 20-pixel grip margin — and not a hit test at all.
      //
      // Asking the hit test instead is what made a second press on the symbol
      // you had just selected draw a rubber band: the press has to resolve to
      // the exact same id, and a symbol's pins and its reference and value
      // fields are separate candidates sitting on top of the body that win the
      // closest-item race from a couple of pixels away.
      (e.target as Element).setPointerCapture(e.pointerId);
      const hit = pickAt(world);
      // RequestSelection( MovableItems ): trim an existing selection to the
      // movable kinds, or, with nothing selected, take what is under the press.
      // `RequestSelection` picks the press up through `SelectPoint` when
      // nothing is selected, and SelectPoint promotes to the top-level group —
      // so a press on a grouped item grabs the whole group in the same gesture
      // that would otherwise have dragged one member out of it.
      const requested = expandSelectionToGroups(schematic, requestMovableSelection(selection, hit));
      const gripped = selectionContains(
        schematic,
        libById,
        requested,
        world,
        (GRIP_MARGIN_PX * dpr()) / vp.scale,
      );
      const start = leftDragStart({
        hasModifier: e.shiftKey || e.ctrlKey || e.metaKey || e.altKey,
        action: inputPrefs.mouseLeft,
        dragIsMove: inputPrefs.dragIsMove,
        selectionEmpty: selection.size === 0,
        gripped,
      });
      if (start !== 'box') {
        const effSel: ReadonlySet<string> = requested;
        // Upstream only *trims* a non-empty selection here; it is `SelectPoint`
        // inside RequestSelection that picks something up, and that only runs
        // when nothing was selected. Re-selecting the pressed item would
        // collapse a multi-item selection to the one you grabbed it by.
        if (selection.size === 0 && hit) onSelect(hit.id, false);
        // What the press was over, in case it turns out to be a click rather
        // than a drag: upstream's `IsClick( BUT_LEFT )` runs SelectPoint, so
        // clicking one member of a multi-item selection reduces the selection
        // to it. Resolved on release, since only then is it known.
        pressHitRef.current = hit ? hit.id : null;
        modeRef.current = 'move';
        // The drag gesture rubber-bands connected wires along unless the
        // "drag is move" preference turns it into a plain Move (SCH_MOVE_TOOL).
        moveKindRef.current = start;
        // A wire dragged near one of its ends moves *that end*, not the whole
        // wire. Upstream flags it as the selection is made
        // (SCH_SELECTION_TOOL::narrowSelection, "Handle line ends specially"):
        //
        //     if( line->GetStartPoint().Distance( aWhere ) <= m_Threshold )  flags = STARTPOINT;
        //     else if( line->GetEndPoint().Distance( aWhere ) <= m_Threshold ) flags = ENDPOINT;
        //     else flags = STARTPOINT | ENDPOINT;
        //
        // This is how eeschema reshapes a wire — there are no endpoint grips on
        // one, which is why `pointEditTarget` no longer offers any.
        const grabbedEnd = wireEndUnderPress(effSel, world);
        effSelRef.current = grabbedEnd ? new Set<string>() : effSel;
        moveStartRef.current = world;
        moveDeltaRef.current = { x: 0, y: 0 };
        // Nothing moves whole; the endpoint does, and every wire meeting it
        // picks up STARTPOINT/ENDPOINT from that.
        const spec = grabbedEnd
          ? planMoveFromPoints(schematic, libById, new Set(), [grabbedEnd])
          : planMove(schematic, libById, effSel);
        moveSpecRef.current = spec;
        movePointsRef.current = grabbedEnd
          ? [grabbedEnd]
          : selectionAnchors(schematic, libById, effSel);
        // Snap targets are the fixed anchors: exclude the selection AND the wires that
        // rubber-band with it (spec.wireStart/wireEnd), so a moved point never snaps
        // back onto a wire that is moving with it.
        const moving = new Set([...effSelRef.current, ...spec.wireStart, ...spec.wireEnd]);
        moveAnchorsRef.current = collectAnchors(schematic, libById, moving);
      } else {
        // Empty canvas (or SELECT-mode drag): start a KiCad drag-box selection
        // (left-to-right = window select, right-to-left = greedy). A no-drag
        // click selects the pressed item, or clears the selection. An
        // ambiguous press collects every candidate for the Clarify menu
        // (SCH_SELECTION_TOOL::SelectPoint → GuessSelectionCandidates).
        (e.target as Element).setPointerCapture(e.pointerId);
        modeRef.current = 'box';
        const cands = hit
          ? collectAndGuess(schematic, libById, world, hitAccuracy(), lineSlop())
          : [];
        boxHitRef.current = cands[0]?.id ?? (hit ? hit.id : null);
        clarifyRef.current = cands.length > 1 ? cands : null;
        boxOriginRef.current = world;
        boxEndRef.current = world;
        boxModifiersRef.current = {
          additive: (e.ctrlKey || e.shiftKey) && !e.altKey, // m_drag_additive
          subtractive: e.ctrlKey && e.shiftKey && !e.altKey, // m_drag_subtractive
        };
      }
    },
    [
      activeTool,
      lineMode,
      placeLib,
      placeUnit,
      onSymbolPlaced,
      pendingLabel,
      pastePending,
      pendingImage,
      schematic,
      libById,
      selection,
      onSelect,
      pickMarker,
      onMarkerPick,
      finishPoly,
      onHighlight,
      onRequestTool,
      onPasteDone,
      onImagePlaced,
      onSheetPinClick,
      danglingPinAt,
      onCommand,
      buildMoveCommit,
      endGrab,
      snapConn,
      updateWireChain,
      finishWireChain,
      finalizeShape,
      requestDraw,
      requestOverlay,
      handleAt,
      inputPrefs,
      wireEndUnderPress,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const world = toWorld(e.clientX, e.clientY);
      cursorRef.current = world;
      onCursorMove?.(world, CONNECTION_SNAP_TOOLS.has(activeTool) ? snapConn(world) : snap(world));

      // Dragging a sheet pin slides it along its sheet's border, switching
      // edges when the cursor is nearest another one (ConstrainOnEdge).
      const pinDrag = sheetPinDragRef.current;
      if (pinDrag) {
        const moved = moveSheetPin(schematic, pinDrag, snap(world));
        pointEditDocRef.current = moved === schematic ? null : moved;
        requestDraw();
        return;
      }

      // Dragging an edit point reshapes the item live. The reshape runs against
      // the committed document rather than the previous frame's result, so a
      // drag is a pure function of where the cursor is now, and nothing
      // accumulates across frames.
      const dragging = pointDragRef.current;
      const target = pointTargetRef.current;
      if (dragging && target) {
        const reshaped = dragHandle(schematic, target, dragging, snap(world), arcEditMode);
        pointEditDocRef.current = reshaped === schematic ? null : reshaped;
        // The handles move with the item, so the one being dragged is re-derived
        // to keep the hover highlight and the next frame's geometry in step.
        setPointHandles(reshaped, target);
        requestDraw();
        return;
      }

      // Idle hover over a handle thickens its border (EDIT_POINTS::ViewDraw).
      if (modeRef.current === 'idle' && pointHandlesRef.current.length > 0) {
        const over = handleAt(world);
        const was = hoveredHandleRef.current;
        if (over?.kind !== was?.kind || over?.index !== was?.index) {
          hoveredHandleRef.current = over;
          requestOverlay();
        }
      }

      // Over a dangling pin with the select tool: show the wire cursor (KiCad switches
      // the cursor to LINE_WIRE to signal that clicking will start a wire).
      const canvas = canvasRef.current;
      if (canvas && activeTool === 'select' && modeRef.current === 'idle')
        canvas.style.cursor = danglingPinAt(world) ? WIRE_CURSOR : 'default';

      // Shape/sheet drawing preview + bus-entry / image ghosts track the cursor.
      // These ride in the document, so the scene has to be rebuilt.
      if (drawStateRef.current) {
        const ds = drawStateRef.current;
        ds.cursor = snap(world);
        // "item->CalcEdit( cursorPos )": what a move drags depends on which
        // edit state the bezier is in.
        if (ds.bezier) ds.bezier = calcBezier(ds.bezier, ds.cursor);
        requestDraw();
        return;
      }
      if (activeTool === 'busEntry' || pendingImage) {
        requestDraw();
        return;
      }

      if (pendingLabel || pendingDirective) {
        requestDraw();
        return;
      } // update the attached label / directive-flag ghost
      if (pastePending && modeRef.current !== 'pan') {
        requestDraw();
        return;
      } // pasted items track the cursor

      // The rubber band, the lasso and the wire chain all live on the overlay,
      // so dragging one of them never repaints the schematic.
      if (modeRef.current === 'box') {
        boxEndRef.current = world;
        requestOverlay();
        return;
      }

      if (modeRef.current === 'lasso') {
        // Append a point once the pointer has travelled a few screen pixels, so the
        // trace stays a manageable polygon rather than one vertex per mouse event.
        const pts = lassoPointsRef.current;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(world.x - last.x, world.y - last.y) * vp.scale > 4) pts.push(world);
        requestOverlay();
        return;
      }

      if (activeTool === 'drawWire' || activeTool === 'drawBus') {
        if (wiresRef.current.length) requestOverlay();
        else requestOverlay(); // keep the crosshair tracking between runs
        return;
      }
      if (activeTool === 'placeSymbol' || activeTool === 'placePower') {
        if (placeLib)
          requestDraw(); // the attached ghost rides in the document
        else requestOverlay();
        return;
      }
      if (modeRef.current === 'move' && moveStartRef.current) {
        const raw = { x: world.x - moveStartRef.current.x, y: world.y - moveStartRef.current.y };
        let delta = { x: Math.round(raw.x / GRID) * GRID, y: Math.round(raw.y / GRID) * GRID };
        // Connectable snap: if a moved connection point lands near a fixed anchor, snap
        // the whole move so it coincides exactly (KiCad drags snap to connection points).
        const maxDist = vp.scale > 0 ? 10 / vp.scale : GRID / 2;
        let bestD = maxDist * maxDist;
        let bestDelta: Vec2 | null = null;
        for (const mp of movePointsRef.current) {
          const cand = { x: mp.x + delta.x, y: mp.y + delta.y };
          const a = nearestAnchor(cand, moveAnchorsRef.current, maxDist);
          if (!a) continue;
          const dx = a.x - cand.x,
            dy = a.y - cand.y,
            d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            bestDelta = { x: delta.x + dx, y: delta.y + dy };
          }
        }
        if (bestDelta) delta = bestDelta;
        // Once an arrow has fixed the axis, the mouse cannot pull the item off
        // it — the lock is applied to the pointer path as well as the keyboard
        // one, which is the whole reason it exists.
        if (axisLockRef.current !== 'none') {
          const prev = moveDeltaRef.current ?? { x: 0, y: 0 };
          delta = applyAxisLock(delta, prev, axisLockRef.current);
        }
        moveDeltaRef.current = delta;
        requestDraw();
      } else if (modeRef.current === 'pan' && panLastRef.current) {
        panMovedRef.current = true;
        viewportRef.current = {
          ...vp,
          offsetX: vp.offsetX + (e.clientX - panLastRef.current.x) * dpr(),
          offsetY: vp.offsetY + (e.clientY - panLastRef.current.y) * dpr(),
        };
        panLastRef.current = { x: e.clientX, y: e.clientY };
        requestDraw();
      } else if (modeRef.current === 'dragzoom' && panLastRef.current) {
        // Drag-zoom gesture: vertical travel zooms about the canvas centre.
        panMovedRef.current = true;
        const canvas = canvasRef.current;
        if (canvas)
          zoomAbout(
            canvas.width / 2,
            canvas.height / 2,
            Math.exp((panLastRef.current.y - e.clientY) * 0.005),
          );
        panLastRef.current = { x: e.clientX, y: e.clientY };
      } else if (cursorRef.current) {
        requestOverlay(); // keep the crosshair tracking the cursor
      }
    },
    [
      activeTool,
      placeLib,
      pendingLabel,
      pendingDirective,
      pastePending,
      pendingImage,
      danglingPinAt,
      requestDraw,
      requestOverlay,
      onCursorMove,
      zoomAbout,
      handleAt,
      schematic,
      snap,
      arcEditMode,
      setPointHandles,
      GRID,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // A sheet-pin drag commits the same way a handle drag does.
      if (sheetPinDragRef.current) {
        (e.target as Element).releasePointerCapture(e.pointerId);
        const moved = pointEditDocRef.current;
        sheetPinDragRef.current = null;
        pointEditDocRef.current = null;
        if (moved) onCommand(moveSheetPinCommand(moved));
        requestDraw();
        return;
      }

      // A handle drag commits the reshape as one undo step. A press that never
      // moved leaves no document to commit and just lets go of the handle.
      if (pointDragRef.current) {
        (e.target as Element).releasePointerCapture(e.pointerId);
        const reshaped = pointEditDocRef.current;
        const target = pointTargetRef.current;
        pointDragRef.current = null;
        pointEditDocRef.current = null;
        if (reshaped && target) onCommand(reshapeCommand(POINT_EDIT_LABELS[target.kind], reshaped));
        else if (target) pointHandlesRef.current = editHandles(schematic, target);
        requestDraw();
        return;
      }
      // Middle/right-button pan or drag-zoom ends regardless of the active tool.
      if (
        (modeRef.current === 'pan' || modeRef.current === 'dragzoom') &&
        (e.button === 1 || e.button === 2)
      ) {
        (e.target as Element).releasePointerCapture(e.pointerId);
        modeRef.current = 'idle';
        panLastRef.current = null;
        return;
      }
      // Zoom to Selection Area: release fits the view to the drawn rectangle.
      if (zoomAreaRef.current && modeRef.current === 'box') {
        (e.target as Element).releasePointerCapture(e.pointerId);
        const bo = boxOriginRef.current;
        const be = boxEndRef.current;
        const vp = viewportRef.current;
        const movedPx = bo && be && vp ? Math.hypot(be.x - bo.x, be.y - bo.y) * vp.scale : 0;
        if (bo && be && movedPx > 4) {
          onZoomArea?.({
            minX: Math.min(bo.x, be.x),
            minY: Math.min(bo.y, be.y),
            maxX: Math.max(bo.x, be.x),
            maxY: Math.max(bo.y, be.y),
          });
        }
        zoomAreaRef.current = false;
        boxOriginRef.current = null;
        boxEndRef.current = null;
        modeRef.current = 'idle';
        requestDraw();
        return;
      }
      // A press that is still in flight has to be resolved even if the tool has
      // changed under it: a hotkey (or a hot reload) that switches tools during
      // a drag used to fall out here with `modeRef` stuck on 'move', and every
      // later pointer move went on dragging the selection with no button held.
      // The drop itself belongs to the tool the press started in, so it is only
      // *committed* for the selection tools; otherwise the gesture is dropped.
      if (activeTool !== 'select' && activeTool !== 'selectLasso') {
        if (modeRef.current !== 'idle') abortGesture();
        return;
      }
      (e.target as Element).releasePointerCapture(e.pointerId);
      let committedMove = false;
      if (modeRef.current === 'lasso') {
        const pts = lassoPointsRef.current;
        const vp = viewportRef.current;
        // A trace with real extent is a lasso; a near-stationary press is a click.
        let span = 0;
        for (const p of pts) span = Math.max(span, Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y));
        const movedPx = vp ? span * vp.scale : 0;
        if (pts.length >= 3 && movedPx > 4) {
          const { additive, subtractive } = boxModifiersRef.current;
          onSelectBox?.(lassoSelect(schematic, libById, pts), additive, subtractive);
        } else {
          onSelect(boxHitRef.current, e.shiftKey);
        }
        boxHitRef.current = null;
        lassoPointsRef.current = [];
        modeRef.current = 'idle';
        requestDraw();
        return;
      }
      if (modeRef.current === 'move' && grabbedRef.current) {
        // A keyboard grabbed move ignores button-up; it commits on the next
        // left click (handled in onPointerDown). Nothing to do here.
        return;
      } else if (modeRef.current === 'move') {
        const d = moveDeltaRef.current;
        const spec = moveSpecRef.current;
        if (d && spec && (d.x !== 0 || d.y !== 0)) {
          onCommand(buildMoveCommit(spec, d));
          committedMove = true;
        } else {
          // The press never became a drag, so it was a click: SelectPoint runs
          // and the selection becomes the item under it (upstream splits these
          // into TA_MOUSE_CLICK and TA_MOUSE_DRAG; here they are told apart by
          // whether the move ever moved).
          onSelect(pressHitRef.current, e.shiftKey);
        }
        pressHitRef.current = null;
      } else if (modeRef.current === 'box') {
        const bo = boxOriginRef.current;
        const be = boxEndRef.current;
        const vp = viewportRef.current;
        // Under ~4 screen px of travel it's a click, which clears the selection.
        const movedPx = bo && be && vp ? Math.hypot(be.x - bo.x, be.y - bo.y) * vp.scale : 0;
        if (bo && be && movedPx > 4) {
          const { additive, subtractive } = boxModifiersRef.current;
          onSelectBox?.(boxSelect(schematic, libById, bo, be), additive, subtractive);
        } else if (clarifyRef.current && onClarify) {
          // Several candidates under the click: pop the Clarify Selection
          // menu instead of guessing (SCH_SELECTION_TOOL::doSelectionMenu).
          onClarify(e.clientX, e.clientY, clarifyRef.current, e.shiftKey);
        } else {
          // A plain click in SELECT mode selects the pressed item, else clears.
          onSelect(boxHitRef.current, e.shiftKey);
        }
        boxHitRef.current = null;
        clarifyRef.current = null;
        boxOriginRef.current = null;
        boxEndRef.current = null;
      } else if (modeRef.current === 'pan' && !panMovedRef.current) {
        onSelect(null, e.shiftKey);
      }
      modeRef.current = 'idle';
      moveStartRef.current = null;
      moveDeltaRef.current = null;
      moveSpecRef.current = null;
      panLastRef.current = null;
      if (!committedMove) requestDraw();
    },
    [
      activeTool,
      schematic,
      libById,
      onCommand,
      buildMoveCommit,
      onSelect,
      onClarify,
      onSelectBox,
      onZoomArea,
      requestDraw,
      abortGesture,
    ],
  );

  /**
   * The pointer went away mid-gesture: the browser cancelled it, or the capture
   * moved elsewhere (a dev-server hot reload replacing the canvas node does
   * exactly this). Either way `pointerup` is never coming, so end the gesture
   * here rather than leaving it running with no button held.
   */
  const onPointerAbort = useCallback(() => {
    // A keyboard grab (M/G) is not a pointer gesture: it holds no capture and
    // commits on the next click, so it must survive one being released. And a
    // normal `pointerup` releases its capture, which fires `lostpointercapture`
    // straight after — by then the gesture is already over and there is nothing
    // to abandon.
    if (grabbedRef.current) return;
    if (modeRef.current === 'idle' && !pointDragRef.current && !sheetPinDragRef.current) return;
    abortGesture();
  }, [abortGesture]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Double-click ends the wire run at the point (the two plain clicks it
      // contains already fixed the segments; the extras are null and merge away).
      if (activeTool === 'drawWire' || activeTool === 'drawBus') {
        if (wiresRef.current.length) {
          updateWireChain(snapConn(toWorld(e.clientX, e.clientY)));
          finishWireChain();
        }
        requestDraw();
        return;
      }
      // Lines and rule-area tools: a double-click ends the outline.
      if (isPolyTool(drawStateRef.current?.tool)) {
        finishPoly();
        return;
      }
      // Select tool: double-click opens the item's properties (KiCad binds mouse
      // double-click to SCH_ACTIONS::properties -> SCH_EDIT_TOOL::EditProperties).
      if (activeTool === 'select') {
        const vp = viewportRef.current;
        if (!vp) return;
        const world = toWorld(e.clientX, e.clientY);
        // SCH_EDIT_TOOL::Properties, `case SCH_MARKER_T`: hand the marker to
        // SCH_INSPECTION_TOOL::CrossProbe rather than opening a properties
        // dialog, since a marker has none.
        const marker = pickMarker(world);
        if (marker) {
          onMarkerPick?.(marker, true);
          return;
        }
        const hit = pickAt(world);
        if (hit) {
          onEditItem?.(hit.id, hit.kind);
          return;
        }
        // Nothing under the cursor: SCH_EDIT_TOOL::Properties falls through to
        // the drawing sheet, if the layer is shown and the point actually
        // lands on one of its items, it posts ACTIONS::pageSettings. Empty
        // paper inside the frame hits nothing, so this cannot fire from a
        // double-click on blank canvas.
        if (renderOpts.showDrawingSheet === false) return;
        const draws = drawingSheetItems(schematic, renderOpts.drawingSheet, renderOpts);
        // HitTestDrawingSheetItems: five pixels of slop at the current zoom.
        if (hitTestDrawingSheet(draws, world, (5 * dpr()) / vp.scale)) onEditDrawingSheet?.();
      }
    },
    [
      activeTool,
      requestDraw,
      schematic,
      libById,
      onEditItem,
      onEditDrawingSheet,
      pickMarker,
      onMarkerPick,
      renderOpts,
      finishPoly,
      updateWireChain,
      finishWireChain,
      snapConn,
    ],
  );

  // Escape ends an in-progress wire; '/' switches the segment posture and
  // Backspace undoes the last segment while drawing; R/X/Y rotate/mirror
  // (KiCad hotkeys): the attached symbol while placing, else the selection.
  useEffect(() => {
    const onKey = (raw: KeyboardEvent) => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'schematic') !== 'schematic') return;
      // The user's bindings, applied before the comparisons below — see
      // hotkey_bindings.ts. This handler compares raw keys just as the editor's
      // does, and the two must agree about what a key means.
      const e = remapEvent(raw, settings.hotkeys);
      if (!e) return;
      if (e.key === 'Escape' && wiresRef.current.length) {
        wiresRef.current = [];
        requestDraw();
        return;
      }
      // SCH_ACTIONS::switchSegmentPosture ('/') while drawing a wire/bus.
      if (e.key === '/' && wiresRef.current.length >= 2) {
        const wires = wiresRef.current;
        wirePostureRef.current = !wirePostureRef.current;
        if (lineModeRef.current === '90') {
          // 90° has no forced posture; just swap the live pair's directions.
          switchPosture90(wires[wires.length - 2]!, wires[wires.length - 1]!);
        }
        e.preventDefault();
        requestDraw(); // 45° recomputes the break point from the flipped posture
        return;
      }
      // SCH_ACTIONS::undoLastSegment (Backspace/Delete) while drawing.
      if ((e.key === 'Backspace' || e.key === 'Delete') && wiresRef.current.length) {
        const wires = wiresRef.current;
        const free = lineModeRef.current === 'free';
        if ((free && wires.length > 1) || (!free && wires.length > 2)) {
          wires.pop();
          e.preventDefault();
          requestDraw();
        }
        return;
      }
      if (e.key === 'Escape' && drawStateRef.current) {
        drawStateRef.current = null;
        requestDraw();
        return;
      }
      // ACTIONS::finishInteractive (End): commit the in-progress wire/bus
      // chain; Enter/End both close a polyline.
      if (e.key === 'End' && wiresRef.current.length) {
        e.preventDefault();
        finishWireChain();
        requestDraw();
        return;
      }
      if ((e.key === 'Enter' || e.key === 'End') && isPolyTool(drawStateRef.current?.tool)) {
        finishPoly();
        return;
      }

      // Skip while typing, a focused checkbox/radio (Selection Filter panel)
      // isn't typing and must not eat the R/X/Y hotkeys.
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'TEXTAREA' ||
          tgt.tagName === 'SELECT' ||
          tgt.isContentEditable ||
          (tgt.tagName === 'INPUT' &&
            !/^(checkbox|radio|button|range)$/.test((tgt as HTMLInputElement).type)))
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // R/X/Y here only steer the item attached to the cursor while placing;
      // selection transforms live in the editor's hotkey handler (a second
      // window listener, handling them in both applied every transform twice).
      const k = e.key.toLowerCase();
      if (k !== 'r' && k !== 'x' && k !== 'y') return;

      // Bus-entry tool: R cycles the stub through its four 45° orientations.
      if (activeTool === 'busEntry' && k === 'r') {
        const sz = entrySizeRef.current;
        entrySizeRef.current = e.shiftKey
          ? { x: -sz.y, y: sz.x } // Shift+R = rotate CW
          : { x: sz.y, y: -sz.x };
        e.preventDefault();
        requestDraw();
        return;
      }

      if ((activeTool === 'placeSymbol' || activeTool === 'placePower') && placeLib) {
        // Advance the attached symbol's orientation in place. Serialized mirror
        // axis 'y' is KiCad's MirrorHorizontally (hotkey X), 'x' its
        // MirrorVertically (hotkey Y), see common/transform.ts.
        const inst = placeInstanceRef.current;
        if (inst) {
          // A copied symbol turns exactly as a placed one does: about its own
          // position, so `SCH_SYMBOL::Rotate`'s field move vector is zero and the
          // fields hold their offset from the body (sch_symbol.cpp:2837). They
          // used to orbit the anchor instead, which threw the reference to a
          // different side of the symbol on every press before it was placed.
          const op =
            k === 'r' ? (e.shiftKey ? 'rotateCW' : 'rotateCCW') : k === 'x' ? 'mirrorY' : 'mirrorX';
          placeInstanceRef.current = transformSymbol(inst, op, inst.at);
        } else {
          const o = placeOrientRef.current;
          placeOrientRef.current =
            k === 'r'
              ? rotateOrientation(o, e.shiftKey)
              : k === 'x'
                ? mirrorOrientation(o, 'y')
                : mirrorOrientation(o, 'x');
        }
        e.preventDefault();
        requestDraw();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestDraw, activeTool, placeLib, finishPoly, finishWireChain]);

  const cursor = toolCursor(activeTool, attachedItem);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerAbort}
        onLostPointerCapture={onPointerAbort}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (activeTool === 'drawWire' || activeTool === 'drawBus') {
            wiresRef.current = [];
            requestDraw();
          } else if (isPolyTool(drawStateRef.current?.tool)) finishPoly();
          else if (drawStateRef.current) {
            drawStateRef.current = null;
            requestDraw();
          } else if (
            (activeTool === 'select' || activeTool === 'selectLasso') &&
            !panMovedRef.current
          ) {
            // KiCad's selection-tool context menu: a plain right-click (not the
            // end of a right-drag pan) hit-tests the point and asks the editor
            // to select the item and pop the menu.
            const vp = viewportRef.current;
            if (!vp) return;
            const world = toWorld(e.clientX, e.clientY);
            const hit = pickAt(world);
            onContextMenuRequest?.(e.clientX, e.clientY, hit, {
              world,
              handle: handleAt(world),
              tolerance: (EDIT_POINT_SIZE * dpr()) / vp.scale,
            });
          }
        }}
        onPointerLeave={() => {
          cursorRef.current = null;
          onCursorMove?.(null, null);
          requestOverlay(); // drop the crosshair when the pointer leaves
        }}
      />
      {/* The WebGL document layer (#449), mounted only with ?renderer=gl. It is
          transparent and sits over the 2D canvas, which then paints just the
          background and the grid: the grid's spacing adapts to the zoom, so it
          is the one thing that genuinely cannot live in a retained buffer.
          Takes no events, like the overlay above it. */}
      {GL_RENDERER && (
        <canvas
          ref={glCanvasRef}
          style={{ display: 'block', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
        />
      )}
      {/* The pointer overlay (crosshair, rubber band, lasso, wire preview) sits
          above the scene and never takes events, so clicks and pointer captures
          still land on the scene canvas below. */}
      <canvas
        ref={overlayRef}
        style={{ display: 'block', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
      />
      {/* Label placement uses a properties dialog (in App) and a cursor-attached ghost. */}
    </div>
  );
});
