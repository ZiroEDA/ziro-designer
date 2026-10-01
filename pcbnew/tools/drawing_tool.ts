// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DRAWING_TOOL::DrawBezier` and `drawOneBezier` — the click sequence, the
 * preview geometry, and the rule that chains one curve into the next.
 * Counterpart: `pcbnew/tools/drawing_tool.cpp`.
 *
 * The geometry itself is not here: it is {@link BEZIER_GEOM_MANAGER} in
 * `common/`, exactly as upstream keeps it in `common/preview_items/`. What is
 * here is the part `drawOneBezier` owns — which clicks lock in, what the
 * committed shape's four points are, and what the *next* curve starts with.
 *
 * The state a caller holds is a plain list of locked-in points, so a canvas can
 * keep it in the same ref every other drawing tool uses and Esc can drop it
 * with `[]`. The manager is rebuilt from that list on demand rather than held,
 * which is cheap (four `addPoint` calls) and means the preview and the commit
 * cannot drift apart: both read the same replay.
 *
 * ## Chaining
 *
 * `DrawBezier`'s loop is the reason the C2 reflection exists:
 *
 *     startingPoint = bezierRef.GetEnd();
 *     if( bezierRef.GetEnd() != bezierRef.GetBezierC2() )
 *         startingC1 = bezierRef.GetEnd() - ( bezierRef.GetBezierC2() - bezierRef.GetEnd() );
 *
 * and `drawOneBezier` locks both of those in before the user clicks again. Work
 * it through with `C2 = 2·end − clicked` and the seeded C1 comes out at
 * `clicked` — the very point the cursor was on when the curve finished. So the
 * next curve leaves the joint along the same line the last one arrived on, and
 * the two are tangent without the user aiming for it.
 *
 * The guard is not decoration: a curve whose C2 landed exactly on its end has
 * no direction to continue in, so the next one is seeded with the start alone
 * and the user picks a fresh C1.
 *
 * ## What is left out, and why it costs nothing
 *
 * Upstream's double-click "use the current point for all remaining points" is
 * not ported. It is a shortcut, not a capability: the one thing it can produce
 * that four ordinary clicks cannot is a curve whose C2 sits on its end, and
 * clicking the fourth point on the third does exactly that. No other drawing
 * tool here binds double-click either, so binding it for this one alone would
 * be the odd behaviour.
 */

import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  MD_CTRL,
  MD_SHIFT,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { TEXT_ATTRIBUTES } from '@ziroeda/common/font/text_attributes.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { InferBold } from '@ziroeda/common/gr_text.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { ARC_ASSISTANT } from '@ziroeda/common/preview_items/arc_assistant.js';
import { ARC_GEOM_MANAGER, ARC_STEPS } from '@ziroeda/common/preview_items/arc_geom_manager.js';
import {
  GEOM_SHAPE,
  TWO_POINT_ASSISTANT,
} from '@ziroeda/common/preview_items/two_point_assistant.js';
import { TWO_POINT_GEOMETRY_MANAGER } from '@ziroeda/common/preview_items/two_point_geom_manager.js';
import { ANGLE_0, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  GetClampedCoords,
  LeaderMode,
  vectorSnapped45,
  vectorSnapped90,
} from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import {
  add,
  equal,
  sub,
  type Vec2 as VECTOR2D,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '../board.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import { IsZoneFillAction } from './pcb_picker_tool.js';
import { PCB_SELECTION } from './pcb_selection.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { NoPrintableChars } from '@ziroeda/common/string_utils.js';
import { DIALOG_TEXT_PROPERTIES } from '../dialogs/dialog_text_properties.js';
import { PCB_TEXT } from '../pcb_text.js';
import type { ZONE } from '../zone.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { POLYGON_GEOM_MANAGER } from '@ziroeda/common/preview_items/polygon_geom_manager.js';
import { ZONE_MODE } from './pcb_actions.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { ZONE_CREATE_HELPER, type ZONE_CREATE_PARAMS } from './zone_create_helper.js';
import { BEZIER_GEOM_MANAGER, BEZIER_STEPS } from '@ziroeda/common/index.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbMmToIU } from '@ziroeda/common/eda_units.js';
import { newKiid } from '@ziroeda/common/kiid.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { segNearestPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import { TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { ConnectBoardShapes } from '../fix_board_shape.js';
import type { IMPORTED_ITEM } from '../import_gfx/graphics_importer_pcbnew.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { Board, PcbShape, PcbTextItem, PcbTrack, PcbVia } from '../types.js';
import {
  DEFAULT_DIMENSION_DEFAULTS,
  type DimensionDefaults as EngineDimensionDefaults,
  type DimensionKind,
} from '../index.js';

/** The four control points of a `(gr_curve (pts …))`, in file order. */
export type BezierPoints = [Vec2, Vec2, Vec2, Vec2];

/** The curve as it stands, with the cursor supplying the step's live point. */
export interface BezierInFlight {
  readonly points: BezierPoints;
  /** Which point the cursor is currently dragging. */
  readonly step: BEZIER_STEPS;
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * Replay the locked-in points into a manager, then feed the cursor without
 * locking it in — `AddPoint( cursorPos, false )`, the motion case.
 */
function replay(locked: readonly Vec2[], cursor: Vec2 | null): BEZIER_GEOM_MANAGER {
  const m = new BEZIER_GEOM_MANAGER();
  for (const p of locked) m.AddPoint(p, true);
  if (cursor) m.AddPoint(cursor, false);
  return m;
}

/**
 * The bezier the preview should draw, or null before the first click.
 *
 * `locked` is the accepted clicks so far (0-3 of them) and `cursor` the snapped
 * mouse position. The C2 returned is the real one, already reflected.
 */
export function bezierInFlight(
  locked: readonly Vec2[],
  cursor: Vec2 | null,
): BezierInFlight | null {
  if (locked.length === 0 && !cursor) return null;
  const m = replay(locked, cursor);
  if (m.IsReset()) return null;
  return {
    points: [m.GetStart(), m.GetControlC1(), m.GetControlC2(), m.GetEnd()],
    step: m.GetStep(),
  };
}

/**
 * The curve the preview should STROKE, or null while there is nothing to stroke
 * yet.
 *
 * `drawOneBezier` builds the `PCB_SHAPE` from the first click, but it only puts
 * it in the preview group once the manager reaches `SET_END`:
 *
 *     if( bezierManager.GetStep() == KIGFX::PREVIEW::BEZIER_GEOM_MANAGER::SET_END )
 *         preview.Add( bezier.get() );
 *
 * and that is not a detail. Before `SET_END` the manager has the end and both
 * control points sitting on C1, so the "curve" is a straight line lying exactly
 * under the dashed arm. Drawing it anyway puts two strokes on the same pixels,
 * one of them in the layer's colour at the shape's full width — which reads as
 * the tool drawing a straight line instead of a curve, because that is what it
 * is doing.
 *
 * The arms are the assistant's and are drawn at every step from
 * `SET_CONTROL1` on; only the curve waits.
 */
export function bezierPreviewCurve(live: BezierInFlight | null): BezierPoints | null {
  if (!live || live.step < BEZIER_STEPS.SET_END) return null;
  return live.points;
}

/** What one left click does to the locked-in list. */
export type BezierClick =
  /** Still drawing: this is the new locked list. */
  | { readonly kind: 'continue'; readonly locked: Vec2[] }
  /** Finished: commit `points`, then start the next curve from `next`. */
  | { readonly kind: 'commit'; readonly points: BezierPoints; readonly next: Vec2[] };

/**
 * One left click of the bezier tool.
 *
 * The only click that can be refused is the end point: `setEnd` returns
 * `m_end != m_start`, and a rejected point makes `performStep` walk the manager
 * *backwards*. So clicking the end exactly on the start does not merely do
 * nothing — it un-locks C1 and leaves the user choosing it again, which is what
 * dropping the last entry here reproduces.
 */
export function bezierClick(locked: readonly Vec2[], at: Vec2): BezierClick {
  const step = locked.length as BEZIER_STEPS;

  if (step === BEZIER_STEPS.SET_END && !same(at, locked[0]!))
    return { kind: 'continue', locked: [...locked, at] };

  if (step === BEZIER_STEPS.SET_END) return { kind: 'continue', locked: locked.slice(0, -1) };

  if (step < BEZIER_STEPS.SET_CONTROL2) return { kind: 'continue', locked: [...locked, at] };

  const m = replay(locked, null);
  m.AddPoint(at, true);
  const points: BezierPoints = [m.GetStart(), m.GetControlC1(), m.GetControlC2(), m.GetEnd()];
  return { kind: 'commit', points, next: bezierChainSeed(points) };
}

/**
 * `DrawBezier`'s `startingPoint` / `startingC1`, as a locked-in list for the
 * next curve — one point when the last curve ended flat, two when it did not.
 */
export function bezierChainSeed(points: BezierPoints): Vec2[] {
  const [, , c2, end] = points;
  if (same(end, c2)) return [end];
  return [end, { x: end.x - (c2.x - end.x), y: end.y - (c2.y - end.y) }];
}

// ---------------------------------------------------------------------------
/**
 * `DRAWING_TOOL::DrawVia`'s `VIA_PLACER` — the Place Vias tool.
 * Counterpart: `pcbnew/tools/drawing_tool.cpp:3686-4412`.
 *
 * The tool looks like "drop a circle where you clicked", and the two things it
 * actually does are neither of those:
 *
 * - **it picks the net up in a fixed order** — the track under it, then a pad,
 *   then a filled graphic that has a net, and only then the zone it is
 *   stitching (`PlaceItem`, `:4285-4318`). A via placed on a track takes the
 *   *track's* net even when a zone of another net is under it too.
 * - **it BREAKS the track it lands on.** A via strictly inside a segment
 *   shortens that segment to the via and adds a second one from the via to the
 *   old end (`:4340-4361`). Without it the board still holds one continuous
 *   track through the via, so the router cannot attach to it and dragging
 *   either end moves the whole thing.
 *
 * The split is skipped when the via lands exactly on an end — there is nothing
 * to break — and when the user held Shift, because "if the user explicitly
 * disables snap … then don't break the tracks. This will prevent PNS from
 * being able to connect the via and track but it is explicitly requested".
 *
 * This lives in `pcbnew/` rather than in the canvas because it is board
 * surgery: the caller supplies the click, and what comes back is a board.
 */

/** `findTrack`'s answer: the index of the track a via at `at` would attach to. */
export function trackUnderVia(
  board: Board,
  at: Vec2,
  layers: readonly string[],
  viaWidth: number,
): number | null {
  let best: number | null = null;
  let minDist = Number.POSITIVE_INFINITY;

  board.tracks.forEach((track, i) => {
    if (!layers.includes(track.layer)) return;

    // `TestSegmentHit( aPosition, start, end, ( track width + via width ) / 2 )`.
    if (!TestSegmentHit(at, track.start, track.end, (track.width + viaWidth) / 2)) return;

    // "for( PCB_TRACK* track : possible_tracks )" — the NEAREST wins, measured
    // to the segment rather than to either end.
    const near = segNearestPoint({ a: track.start, b: track.end }, at);
    const dist = Math.hypot(near.x - at.x, near.y - at.y);

    if (dist < minDist) {
      minDist = dist;
      best = i;
    }
  });

  return best;
}

/**
 * `SEG::Contains( aVia )` for the split test: the via has to be ON the segment,
 * not merely near it.
 *
 * Upstream's `trackSeg.Contains( viaPos )` is `SquaredDistance <= 3`, i.e. an
 * exact-ish hit in internal units — the via position has already been snapped
 * onto the segment by `SnapItem`'s `AlignToSegment`, so this is asking "did the
 * snap actually land", not "is it close enough".
 */
function onSegment(track: PcbTrack, at: Vec2): boolean {
  const near = segNearestPoint({ a: track.start, b: track.end }, at);
  const dx = near.x - at.x;
  const dy = near.y - at.y;
  return dx * dx + dy * dy <= 3;
}

export interface PlaceViaResult {
  board: Board;
  /** The id the caller selects, as `commit.Add( via )` then hands over. */
  viaId: string;
  /** Whether the track under the via was broken in two. */
  splitTrack: boolean;
}

/**
 * `VIA_PLACER::PlaceItem` — add the via, take the net from what is underneath,
 * and break the track it landed on.
 *
 * `allowSplit` is `m_gridHelper.GetSnap()`, which Shift turns off.
 */
export function placeVia(
  board: Board,
  via: PcbVia,
  opts: { allowSplit?: boolean } = {},
): PlaceViaResult {
  const allowSplit = opts.allowSplit !== false;
  const viaId = `via:${board.vias.length}`;

  const idx = trackUnderVia(board, via.at, via.layers, via.size);
  const track = idx === null ? null : board.tracks[idx];

  const noSplit = (): PlaceViaResult => ({
    board: { ...board, vias: [...board.vias, via] },
    viaId,
    splitTrack: false,
  });

  if (!allowSplit || !track) return noSplit();
  // "if( viaPos == trackStart || viaPos == trackEnd ) return true;" — landing on
  // an end attaches to the track without breaking it.
  if (same(via.at, track.start) || same(via.at, track.end)) return noSplit();
  if (!onSegment(track, via.at)) return noSplit();

  // `aCommit.Modify( track )` shortens it, and a CLONE carries every other
  // property — width, layer, net, mask opening, locked — to the far half. Only
  // the uuid is reissued (`const_cast<KIID&>( newTrack->m_Uuid ) = KIID()`).
  const nearHalf: PcbTrack = { ...track, end: { x: via.at.x, y: via.at.y } };
  const farHalf: PcbTrack = {
    ...track,
    start: { x: via.at.x, y: via.at.y },
    uuid: newKiid(),
  };

  const tracks = [...board.tracks];
  tracks[idx!] = nearHalf;
  tracks.push(farHalf);

  return {
    board: { ...board, tracks, vias: [...board.vias, via] },
    viaId,
    splitTrack: true,
  };
}

// --- the five `Go( &DRAWING_TOOL::DrawDimension, … )` registrations (was dimension_tools.ts) ---

/** Toolbar/action id -> the kind it places. */
export const DIMENSION_TOOLS: Readonly<Record<string, DimensionKind>> = {
  drawAlignedDimension: 'aligned',
  drawOrthogonalDimension: 'orthogonal',
  drawCenterDimension: 'center',
  drawRadialDimension: 'radial',
  drawLeader: 'leader',
};

/** The kind this tool places, or null when it is not a dimension tool. */
export function dimensionToolKind(toolId: string): DimensionKind | null {
  return DIMENSION_TOOLS[toolId] ?? null;
}

/** Whether this tool id places a dimension at all. */
export function isDimensionTool(toolId: string): boolean {
  return dimensionToolKind(toolId) !== null;
}

/**
 * Board Setup's dimension block, as the engine wants it.
 *
 * The panel stores these as the *display strings* the dropdowns show
 * (`PANEL_SETUP_TEXT_AND_GRAPHICS`' choice lists), while the engine and the
 * file format both use the numeric `DIM_*` enums. This is that translation, and
 * it is the reason it lives in a plain module: it is the only real logic in the
 * tool wiring, and getting a mapping off by one would silently write a
 * different precision or the wrong units into every dimension placed.
 *
 * An unrecognised string falls back to the engine default rather than to zero —
 * zero is a meaningful value for all four of these (inches, no suffix, `0`
 * precision, outside), so a typo would otherwise look deliberate.
 */
export function dimensionDefaultsFrom(
  setup: {
    units: string;
    format: string;
    precision: string;
    suppressTrailingZeroes: boolean;
    textPosition: string;
    keepTextAligned: boolean;
    arrowLengthMM: number;
    extLineOffsetMM: number;
  },
  layer: string,
  lineThicknessIU: number,
  /**
   * `GetTextSize( layer )`, `GetTextThickness( layer )` and
   * `GetTextItalic( layer )` — all three index `[ GetLayerClass( aLayer ) ]`
   * (`board_design_settings.cpp:1689-1704`), so they must come from the row for
   * the layer being drawn on. Passing the silkscreen row for every layer gave a
   * dimension on `Dwgs.User` the silkscreen text size.
   */
  layerClass: { textWidth: number; textHeight: number; textThickness: number; italic: boolean },
): EngineDimensionDefaults {
  const mm = (v: number): number => Math.round(v * 1e6);
  const idx = <T>(list: readonly string[], value: string, fallback: T): T | number => {
    const i = list.indexOf(value);
    return i < 0 ? fallback : i;
  };

  return {
    layer,
    lineThickness: lineThicknessIU || DEFAULT_DIMENSION_DEFAULTS.lineThickness,
    arrowLength: mm(setup.arrowLengthMM) || DEFAULT_DIMENSION_DEFAULTS.arrowLength,
    extensionOffset: mm(setup.extLineOffsetMM),
    unitsMode: idx(DIM_UNITS, setup.units, DEFAULT_DIMENSION_DEFAULTS.unitsMode) as 0 | 1 | 2 | 3,
    unitsFormat: idx(DIM_FORMATS, setup.format, DEFAULT_DIMENSION_DEFAULTS.unitsFormat) as
      | 0
      | 1
      | 2,
    precision: idx(
      DIM_PRECISION,
      setup.precision,
      DEFAULT_DIMENSION_DEFAULTS.precision,
    ) as EngineDimensionDefaults['precision'],
    suppressZeroes: setup.suppressTrailingZeroes,
    textPositionMode: idx(
      DIM_POSITION,
      setup.textPosition,
      DEFAULT_DIMENSION_DEFAULTS.textPositionMode,
    ) as 0 | 1 | 2,
    keepTextAligned: setup.keepTextAligned,
    textWidth: layerClass.textWidth || DEFAULT_DIMENSION_DEFAULTS.textWidth,
    textHeight: layerClass.textHeight || DEFAULT_DIMENSION_DEFAULTS.textHeight,
    textThickness: layerClass.textThickness || DEFAULT_DIMENSION_DEFAULTS.textThickness,
    textItalic: layerClass.italic,
  };
}

// The dropdown choice lists, in the order that gives each entry its enum value.
const DIM_UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'] as const;
const DIM_FORMATS = ['1234', '1234 mm', '1234 (mm)'] as const;
const DIM_PRECISION = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'] as const;
// DIM_TEXT_POSITION also has MANUAL, which the panel does not offer: it is set
// by dragging the text, not chosen up front.
const DIM_POSITION = ['Outside', 'Inline'] as const;

/*
 * The model half of `DRAWING_TOOL::PlaceImportedGraphics`
 * (`drawing_tool.cpp:2044-2230`): turning the plain records
 * `DialogImportGraphics.onOk` hands back into board items, welding them if
 * asked, and reporting which ids to select. The interactive half (the cluster
 * following the cursor) reuses the netlist updater's post-update move gesture;
 * Escape leaves the items at the import origin rather than deleting them.
 */

/**
 * `shapeList` in `PlaceImportedGraphics` (`:2098-2106`) is every imported
 * `PCB_SHAPE`, unfiltered by its `SHAPE_T` — `ConnectBoardShapes` itself is
 * what restricts which of them may START a walk (`fix_board_shape.cpp:401-410`,
 * SEGMENT/ARC/BEZIER only). Only those three kinds have a start/mid/end this
 * port can read back afterwards, so only those three are welded; a circle,
 * rect or polygon among the imported shapes is left untouched — the same
 * shapes `AddCircle`/`AddPolygon` in `graphics_importer_pcbnew.ts` produce are
 * exactly the ones a DXF/SVG outline needs connected in the first place.
 */
const WELDABLE: ReadonlySet<PcbShape['kind']> = new Set(['line', 'arc', 'curve']);

/** One imported shape, as a live `PCB_SHAPE` for `ConnectBoardShapes` to mutate. */
function shapeToWeldItem(s: PcbShape): PCB_SHAPE {
  const k = new PCB_SHAPE(null);
  switch (s.kind) {
    case 'line':
      k.SetShape(SHAPE_T.SEGMENT);
      k.SetStart(s.start!);
      k.SetEnd(s.end!);
      break;
    case 'arc':
      k.SetShape(SHAPE_T.ARC);
      k.SetArcGeometry(s.start!, s.mid!, s.end!);
      break;
    case 'curve':
      k.SetShape(SHAPE_T.BEZIER);
      k.SetStart(s.pts![0]!);
      k.SetBezierC1(s.pts![1]!);
      k.SetBezierC2(s.pts![2]!);
      k.SetEnd(s.pts![3]!);
      break;
    default:
      // Unreachable: callers only build this for a WELDABLE kind.
      break;
  }
  return k;
}

/** Read a welded `PCB_SHAPE`'s geometry back into the record it came from. */
function weldItemToShape(s: PcbShape, k: PCB_SHAPE): PcbShape {
  switch (s.kind) {
    case 'line':
      return { ...s, start: k.GetStart(), end: k.GetEnd() };
    case 'arc':
      return { ...s, start: k.GetStart(), mid: k.GetArcMid(), end: k.GetEnd() };
    case 'curve':
      return { ...s, pts: [k.GetStart(), k.GetBezierC1(), k.GetBezierC2(), k.GetEnd()] };
    default:
      return s;
  }
}

/**
 * `ConnectBoardShapes( shapeList, dlg.GetTolerance() )` (`:2099`): weld the
 * open (line/arc/curve) shapes' endpoints in place, at `aToleranceIU`.
 */
export function weldImportedShapes(shapes: readonly PcbShape[], aToleranceIU: number): PcbShape[] {
  const weldable = shapes.map((s, i) => ({ s, i })).filter(({ s }) => WELDABLE.has(s.kind));

  if (weldable.length === 0) return [...shapes];

  const items = weldable.map(({ s }) => shapeToWeldItem(s));
  ConnectBoardShapes(items, aToleranceIU);

  const out = [...shapes];
  weldable.forEach(({ i, s }, n) => {
    out[i] = weldItemToShape(s, items[n]!);
  });
  return out;
}

export interface PlacedImport {
  shapes: PcbShape[];
  texts: PcbTextItem[];
}

/**
 * Split the importer's `IMPORTED_ITEM[]`, stamp a fresh KIID on each — every
 * `EDA_ITEM` constructor does this upstream, and `groupBoardItems` below
 * skips an item with none — and weld if asked.
 */
export function placeImportedItems(
  items: readonly IMPORTED_ITEM[],
  opts: { fixDiscontinuities: boolean; toleranceMM: number },
): PlacedImport {
  let shapes = items
    .filter((i): i is { type: 'shape'; shape: Omit<PcbShape, 'source'> } => i.type === 'shape')
    .map((i) => ({ ...i.shape, uuid: newKiid() }) as PcbShape);
  const texts = items
    .filter((i): i is { type: 'text'; text: Omit<PcbTextItem, 'source'> } => i.type === 'text')
    .map((i) => ({ ...i.text, uuid: newKiid() }) as PcbTextItem);

  if (opts.fixDiscontinuities) shapes = weldImportedShapes(shapes, pcbMmToIU(opts.toleranceMM));

  return { shapes, texts };
}

// ---------------------------------------------------------------------------
// DRAWING_TOOL (pcbnew/tools/drawing_tool.cpp), on the live BOARD.
//
// Ported so far: the class, Init, Reset, UpdateStatusBar, and the four shape
// tools - DrawLine, DrawRectangle, DrawCircle, DrawArc - with drawShape and
// drawArc, their previews in the VIEW (`m_preview` and the assistants), as
// upstream. The other handlers (text, dimensions, zones, vias, tables, images,
// beziers, barcodes, points, import) still run in the frame window.
// ---------------------------------------------------------------------------

/** `DRAWING_TOOL::MODE`. */
export enum DRAWING_MODE {
  NONE,
  LINE,
  RECTANGLE,
  CIRCLE,
  ARC,
  IMAGE,
  TEXT,
  ANCHOR,
  DXF,
  DIMENSION,
  KEEPOUT,
  ZONE,
  GRAPHIC_POLYGON,
  VIA,
  TUNING,
  BEZIER,
  POINT,
}

/** `DRAWING_TOOL::COORDS_PADDING` (drawing_tool.cpp:92). */
const DRAWING_COORDS_PADDING = pcbIUScale.mmToIU(20);

/** `DRAWING_TOOL::WIDTH_STEP` (drawing_tool.cpp:4418): one -/+ key press. */
const WIDTH_STEP = pcbIUScale.mmToIU(0.1);

const INT_MAX = 2147483647;

/**
 * `getClampedDifferenceEnd` (drawing_tool.h:344-364): the end clamped so its
 * difference from the origin fits an int.
 */
export function getClampedDifferenceEnd(aOrigin: VECTOR2I, aEnd: VECTOR2I): VECTOR2I {
  const guardValue = 1;
  const maxDiff = INT_MAX - guardValue;

  let xDiff = aEnd.x - aOrigin.x;
  let yDiff = aEnd.y - aOrigin.y;

  if (xDiff > maxDiff) xDiff = maxDiff;
  if (yDiff > maxDiff) yDiff = maxDiff;

  if (xDiff < -maxDiff) xDiff = -maxDiff;
  if (yDiff < -maxDiff) yDiff = -maxDiff;

  return { x: aOrigin.x + xDiff, y: aOrigin.y + yDiff };
}

/**
 * `getClampedRadiusEnd` (drawing_tool.h:374-394): the end pulled in so the
 * radius fits half an int.
 */
export function getClampedRadiusEnd(aOrigin: VECTOR2I, aEnd: VECTOR2I): VECTOR2I {
  const guardValue = 10;

  let xDiff = aEnd.x - aOrigin.x;
  let yDiff = aEnd.y - aOrigin.y;

  const maxRadius = Math.trunc(INT_MAX / 2) - guardValue;
  const radius = Math.hypot(xDiff, yDiff);

  if (radius > maxRadius) {
    const scaleFactor = maxRadius / radius;

    xDiff = KiROUND(xDiff * scaleFactor);
    yDiff = KiROUND(yDiff * scaleFactor);
  }

  return { x: aOrigin.x + xDiff, y: aOrigin.y + yDiff };
}

/** `updateSegmentFromGeometryMgr` (drawing_tool.cpp:2349-2356). */
function updateSegmentFromGeometryMgr(aMgr: TWO_POINT_GEOMETRY_MANAGER, aGraphic: PCB_SHAPE): void {
  if (!aMgr.IsReset()) {
    aGraphic.SetStart(aMgr.GetOrigin());
    aGraphic.SetEnd(aMgr.GetEnd());
  }
}

/** `updateArcFromConstructionMgr` (drawing_tool.cpp:2771-2788). */
function updateArcFromConstructionMgr(aMgr: ARC_GEOM_MANAGER, aArc: PCB_SHAPE): void {
  aArc.SetCenter(aMgr.GetOrigin());

  if (aMgr.GetSubtended().lt(ANGLE_0)) {
    aArc.SetStart(aMgr.GetStartRadiusEnd());
    aArc.SetEnd(aMgr.GetEndRadiusEnd());
  } else {
    aArc.SetStart(aMgr.GetEndRadiusEnd());
    aArc.SetEnd(aMgr.GetStartRadiusEnd());
  }
}

/** A `PCB_SHAPE*&` out-parameter. */
interface SHAPE_REF {
  value: PCB_SHAPE | null;
}

const S = <T>(aBody: T): T => aBody;

export class DRAWING_TOOL extends PCB_TOOL_BASE {
  private m_view: VIEW | null = null;
  private m_controls: VIEW_CONTROLS | null = null;
  private m_board: BOARD | null = null;
  private m_frame: PCB_BASE_EDIT_FRAME | null = null;
  private m_mode: DRAWING_MODE = DRAWING_MODE.NONE;
  /** Re-entrancy guard. */
  private m_inDrawingTool = false;

  /** The layer we last drew on. */
  private m_layer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  /** Current stroke for multi-segment drawing. */
  private readonly m_stroke = new STROKE_PARAMS(1, LINE_STYLE.DEFAULT, COLOR4D_UNSPECIFIED);
  private readonly m_textAttrs = new TEXT_ATTRIBUTES();

  private readonly m_preview = new PCB_SELECTION();

  constructor() {
    super('pcbnew.InteractiveDrawing');
  }

  override Init(): boolean {
    const haveHighlight = (_sel: SELECTION): boolean => {
      const cfg = this.m_toolMgr!.GetView()!.GetPainter()!.GetSettings();

      return cfg.GetHighlightNetCodes().size > 0;
    };

    const activeToolFunctor = (_aSel: SELECTION): boolean => this.m_mode !== DRAWING_MODE.NONE;

    // some interactive drawing tools can undo the last point
    const canUndoPoint = (_aSel: SELECTION): boolean =>
      this.m_mode === DRAWING_MODE.ARC ||
      this.m_mode === DRAWING_MODE.ZONE ||
      this.m_mode === DRAWING_MODE.KEEPOUT ||
      this.m_mode === DRAWING_MODE.GRAPHIC_POLYGON ||
      this.m_mode === DRAWING_MODE.BEZIER ||
      this.m_mode === DRAWING_MODE.LINE;

    // functor for tools that can automatically close the outline
    const canCloseOutline = (_aSel: SELECTION): boolean =>
      this.m_mode === DRAWING_MODE.ZONE ||
      this.m_mode === DRAWING_MODE.KEEPOUT ||
      this.m_mode === DRAWING_MODE.GRAPHIC_POLYGON;

    const arcToolActive = (_aSel: SELECTION): boolean => this.m_mode === DRAWING_MODE.ARC;
    const tuningToolActive = (_aSel: SELECTION): boolean => this.m_mode === DRAWING_MODE.TUNING;
    const dimensionToolActive = (_aSel: SELECTION): boolean =>
      this.m_mode === DRAWING_MODE.DIMENSION;

    const ctxMenu = this.m_menu.GetMenu();

    // cancel current tool goes in main context menu at the top if present
    ctxMenu.AddItem(ACTIONS.cancelInteractive, activeToolFunctor, 1);
    ctxMenu.AddSeparator(1);

    ctxMenu.AddItem(PCB_ACTIONS.clearHighlight, haveHighlight, 2);
    ctxMenu.AddSeparator(haveHighlight, 2);

    // tool-specific actions
    ctxMenu.AddItem(PCB_ACTIONS.closeOutline, canCloseOutline, 200);
    ctxMenu.AddItem(PCB_ACTIONS.deleteLastPoint, canUndoPoint, 200);
    ctxMenu.AddItem(PCB_ACTIONS.arcPosture, arcToolActive, 200);
    ctxMenu.AddItem(PCB_ACTIONS.spacingIncrease, tuningToolActive, 200);
    ctxMenu.AddItem(PCB_ACTIONS.spacingDecrease, tuningToolActive, 200);
    ctxMenu.AddItem(PCB_ACTIONS.amplIncrease, tuningToolActive, 200);
    ctxMenu.AddItem(PCB_ACTIONS.amplDecrease, tuningToolActive, 200);
    ctxMenu.AddItem(PCB_ACTIONS.lengthTunerSettings, tuningToolActive, 200);
    ctxMenu.AddItem(PCB_ACTIONS.changeDimensionArrows, dimensionToolActive, 200);

    ctxMenu.AddSeparator(500);

    // TRANSITIONAL: VIA_SIZE_MENU arrives with DrawVia.
    ctxMenu.AddSeparator(500);

    // Type-specific sub-menus will be added for us by other tools
    // For example, zone fill/unfill is provided by the PCB control tool

    // Finally, add the standard zoom/grid items
    this.getEditFrame<PCB_BASE_FRAME>().AddStandardSubMenus(this.m_menu);

    return true;
  }

  override Reset(aReason: RESET_REASON): void {
    // Init variables used by every drawing tool
    this.m_view = this.getView();
    this.m_controls = this.getViewControls() as unknown as VIEW_CONTROLS;
    this.m_board = this.getModel<BOARD>();
    this.m_frame = this.getEditFrame<PCB_BASE_EDIT_FRAME>();

    if (aReason === RESET_REASON.SHUTDOWN) return;

    // KiCad's frame always holds a BOARD and a screen (empty ones before a
    // file is opened); ours can have neither yet, and then there is nothing
    // to read the layer defaults from.
    if (!this.m_board || !this.m_frame.GetScreen()) return;

    this.setLayerDefaults();
    this.UpdateStatusBar();
  }

  /** The session attributes Reset, drawShape and layerChanged all take from the layer. */
  private setLayerDefaults(): void {
    // Re-initialize session attributes
    const bds = this.m_frame!.GetDesignSettings();

    this.m_layer = this.m_frame!.GetActiveLayer();
    this.m_stroke.SetWidth(bds.GetLineThickness(this.m_layer));
    this.m_stroke.SetLineStyle(LINE_STYLE.DEFAULT);
    this.m_stroke.SetColor(COLOR4D_UNSPECIFIED);

    this.m_textAttrs.m_Size = bds.GetTextSize(this.m_layer);
    this.m_textAttrs.m_StrokeWidth = bds.GetTextThickness(this.m_layer);
    InferBold(this.m_textAttrs);
    this.m_textAttrs.m_Italic = bds.GetTextItalic(this.m_layer);
    this.m_textAttrs.m_KeepUpright = bds.GetTextUpright(this.m_layer);
    this.m_textAttrs.m_Mirrored = this.m_board!.IsBackLayer(this.m_layer);
    this.m_textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
    this.m_textAttrs.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
  }

  GetDrawingMode(): DRAWING_MODE {
    return this.m_mode;
  }

  UpdateStatusBar(): void {
    if (this.m_frame) {
      switch (this.GetAngleSnapMode()) {
        case LeaderMode.DEG45:
          this.m_frame.DisplayConstraintsMsg('Constrain to H, V, 45');
          break;
        case LeaderMode.DEG90:
          this.m_frame.DisplayConstraintsMsg('Constrain to H, V');
          break;
        default:
          this.m_frame.DisplayConstraintsMsg('');
          break;
      }
    }
  }

  /** `REENTRANCY_GUARD` and `SCOPED_DRAW_MODE` around a handler body. */
  private *scoped(
    aMode: DRAWING_MODE,
    aBody: () => COROUTINE_BODY<number>,
  ): COROUTINE_BODY<number> {
    if (this.m_inDrawingTool) return 0;

    const prevMode = this.m_mode;
    this.m_inDrawingTool = true;
    this.m_mode = aMode;

    try {
      return yield* aBody();
    } finally {
      this.m_mode = prevMode;
      this.m_inDrawingTool = false;
    }
  }

  *DrawLine(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_isFootprintEditor && !this.m_frame!.GetModel()) return 0;

    return yield* this.scoped(
      DRAWING_MODE.LINE,
      function* (this: DRAWING_TOOL) {
        const parent = this.m_frame!.GetModel() as unknown as BOARD_ITEM;
        const line: SHAPE_REF = { value: new PCB_SHAPE(parent) };
        const commit = new BOARD_COMMIT(this.m_frame!);
        let startingPoint: VECTOR2D | null = null;
        const committedLines: PCB_SHAPE[] = [];

        line.value!.SetShape(SHAPE_T.SEGMENT);
        line.value!.SetFlags(IS_NEW);

        if (aEvent.HasPosition())
          startingPoint = this.getViewControls()!.GetCursorPosition(!aEvent.DisableGridSnapping());

        this.m_frame!.PushTool(aEvent);
        this.Activate();

        while (yield* this.drawShape(aEvent, line, startingPoint, committedLines)) {
          if (line.value) {
            commit.Add(line.value);
            commit.Push('Draw Line');
            startingPoint = { ...line.value.GetEnd() };
            committedLines.push(line.value);
          } else {
            startingPoint = null;
          }

          line.value = new PCB_SHAPE(parent);
          line.value.SetShape(SHAPE_T.SEGMENT);
          line.value.SetFlags(IS_NEW);
        }

        return 0;
      }.bind(this),
    );
  }

  *DrawRectangle(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_isFootprintEditor && !this.m_frame!.GetModel()) return 0;

    return yield* this.scoped(
      DRAWING_MODE.RECTANGLE,
      function* (this: DRAWING_TOOL) {
        // TRANSITIONAL: drawTextBox (isTextBox) still runs in the frame window,
        // because its properties dialog is asynchronous here.
        const parent = this.m_frame!.GetModel() as unknown as BOARD_ITEM;
        const commit = new BOARD_COMMIT(this.m_frame!);
        let startingPoint: VECTOR2D | null = null;

        const make = (): PCB_SHAPE => {
          const rect = new PCB_SHAPE(parent);
          rect.SetShape(SHAPE_T.RECTANGLE);
          rect.SetFilled(false);
          rect.SetFlags(IS_NEW);
          return rect;
        };
        const rect: SHAPE_REF = { value: make() };

        if (aEvent.HasPosition())
          startingPoint = this.getViewControls()!.GetCursorPosition(!aEvent.DisableGridSnapping());

        this.m_frame!.PushTool(aEvent);
        this.Activate();

        while (yield* this.drawShape(aEvent, rect, startingPoint, null)) {
          if (rect.value) {
            rect.value.Normalize();
            commit.Add(rect.value);
            commit.Push('Draw Rectangle');

            this.m_toolMgr!.RunAction(ACTIONS.selectItem, rect.value);
          }

          rect.value = make();
          startingPoint = null;
        }

        return 0;
      }.bind(this),
    );
  }

  *DrawCircle(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_isFootprintEditor && !this.m_frame!.GetModel()) return 0;

    return yield* this.scoped(
      DRAWING_MODE.CIRCLE,
      function* (this: DRAWING_TOOL) {
        const parent = this.m_frame!.GetModel() as unknown as BOARD_ITEM;
        const commit = new BOARD_COMMIT(this.m_frame!);
        let startingPoint: VECTOR2D | null = null;

        const make = (): PCB_SHAPE => {
          const circle = new PCB_SHAPE(parent);
          circle.SetShape(SHAPE_T.CIRCLE);
          circle.SetFilled(false);
          circle.SetFlags(IS_NEW);
          return circle;
        };
        const circle: SHAPE_REF = { value: make() };

        if (aEvent.HasPosition())
          startingPoint = this.getViewControls()!.GetCursorPosition(!aEvent.DisableGridSnapping());

        this.m_frame!.PushTool(aEvent);
        this.Activate();

        while (yield* this.drawShape(aEvent, circle, startingPoint, null)) {
          if (circle.value) {
            commit.Add(circle.value);
            commit.Push('Draw Circle');

            this.m_toolMgr!.RunAction(ACTIONS.selectItem, circle.value);
          }

          circle.value = make();
          startingPoint = null;
        }

        return 0;
      }.bind(this),
    );
  }

  *DrawArc(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_isFootprintEditor && !this.m_frame!.GetModel()) return 0;

    return yield* this.scoped(
      DRAWING_MODE.ARC,
      function* (this: DRAWING_TOOL) {
        const parent = this.m_frame!.GetModel() as unknown as BOARD_ITEM;
        const commit = new BOARD_COMMIT(this.m_frame!);
        let startingPoint: VECTOR2D | null = null;

        const make = (): PCB_SHAPE => {
          const arc = new PCB_SHAPE(parent);
          arc.SetShape(SHAPE_T.ARC);
          arc.SetFlags(IS_NEW);
          return arc;
        };
        const arc: SHAPE_REF = { value: make() };

        this.m_frame!.PushTool(aEvent);
        this.Activate();

        if (aEvent.HasPosition()) startingPoint = aEvent.Position();

        while (yield* this.drawArc(aEvent, arc, startingPoint)) {
          if (arc.value) {
            commit.Add(arc.value);
            commit.Push('Draw Arc');

            this.m_toolMgr!.RunAction(ACTIONS.selectItem, arc.value);
          }

          arc.value = make();
          startingPoint = null;
        }

        return 0;
      }.bind(this),
    );
  }

  *PlaceText(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_isFootprintEditor && !this.m_frame!.GetModel()) return 0;

    return yield* this.scoped(
      DRAWING_MODE.TEXT,
      function* (this: DRAWING_TOOL) {
        const common_settings = Pgm().GetCommonSettings();
        let text: PCB_TEXT | null = null;
        let ignorePrimePosition = false;
        const bds = this.m_frame!.GetDesignSettings();
        const commit = new BOARD_COMMIT(this.m_frame!);
        const grid = new PCB_GRID_HELPER(this.m_toolMgr!, this.m_frame!.GetMagneticItemsSettings());
        const controls = this.m_controls!;

        const setCursor = (): void => {
          if (text) this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.MOVING);
          else this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.TEXT);
        };

        const cleanup = (): void => {
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
          controls.ForceCursorPosition(false);
          controls.ShowCursor(true);
          controls.SetAutoPan(false);
          controls.CaptureCursor(false);
          text = null;
        };

        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

        this.m_frame!.PushTool(aEvent);

        this.Activate();
        // Must be done after Activate() so that it gets set into the correct context
        controls.ShowCursor(true);
        controls.ForceCursorPosition(false);
        // do not capture or auto-pan until we start placing some text
        // Set initial cursor
        setCursor();

        if (aEvent.HasPosition()) {
          this.m_toolMgr!.PrimeTool(aEvent.Position());
        } else if ((common_settings?.m_Input.immediate_actions ?? true) && !aEvent.IsReactivate()) {
          this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });
          ignorePrimePosition = true;
        }

        // Main loop: keep receiving events
        for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
          setCursor();

          grid.SetSnap(!evt.Modifier(MD_SHIFT));
          grid.SetUseGrid(
            this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping(),
          );
          let cursorPos: VECTOR2I = GetClampedCoords(
            grid.BestSnapAnchor(
              controls.GetMousePosition(),
              new LSET([this.m_frame!.GetActiveLayer()]),
              GRID_HELPER_GRIDS.GRID_TEXT,
            ),
            DRAWING_COORDS_PADDING,
          );
          controls.ForceCursorPosition(true, cursorPos);

          if (evt.IsDrag()) {
            continue;
          } else if (evt.IsCancelInteractive() || (text && evt.IsAction(ACTIONS.undo))) {
            if (text) {
              cleanup();
            } else {
              this.m_frame!.PopTool(aEvent);
              break;
            }
          } else if (evt.IsActivate()) {
            if (text) cleanup();

            if (evt.IsMoveTool()) {
              // leave ourselves on the stack so we come back after the move
              break;
            } else {
              this.m_frame!.PopTool(aEvent);
              break;
            }
          } else if (evt.IsClick(BUT_RIGHT)) {
            if (!text) this.m_toolMgr!.VetoContextMenuMouseWarp();

            this.m_menu.ShowContextMenu(this.selection());
          } else if (evt.IsClick(BUT_LEFT)) {
            let placing = text !== null;

            if (!text) {
              this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

              controls.ForceCursorPosition(true, controls.GetCursorPosition());

              const layer = this.m_frame!.GetActiveLayer();
              const textAttrs = new TEXT_ATTRIBUTES();

              textAttrs.m_Size = bds.GetTextSize(layer);
              textAttrs.m_StrokeWidth = bds.GetTextThickness(layer);
              InferBold(textAttrs);
              textAttrs.m_Italic = bds.GetTextItalic(layer);
              textAttrs.m_KeepUpright = bds.GetTextUpright(layer);
              textAttrs.m_Mirrored = this.m_board!.IsBackLayer(layer);
              textAttrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
              textAttrs.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;

              const newText = new PCB_TEXT(this.m_frame!.GetModel() as unknown as BOARD_ITEM);

              newText.SetLayer(layer);
              newText.SetAttributes(textAttrs);
              newText.SetTextPos(cursorPos);
              newText.SetFlags(IS_NEW); // Prevent double undo commits

              const textDialog = new DIALOG_TEXT_PROPERTIES(this.m_frame!, newText);

              // QuasiModal required for Scintilla auto-complete
              const ok = yield* this.RunMainStackModal(() =>
                this.m_frame!.ShowTextPropertiesDialog(textDialog),
              );
              const cancelled = ok !== true;

              text = newText;

              if (cancelled || NoPrintableChars(text.GetText())) {
                text = null;
              } else if (!equal(text.GetTextPos(), cursorPos)) {
                // If the user modified the location then go ahead and place it there.
                // Otherwise we'll drag.
                placing = true;
              }

              if (text) {
                if (!this.m_view!.IsLayerVisible(text.GetLayer())) {
                  this.m_frame!.GetAppearancePanel()?.SetLayerVisible?.(text.GetLayer(), true);
                  this.m_frame!.GetCanvas()!.Refresh();
                }

                this.m_toolMgr!.RunAction(ACTIONS.selectItem, text);
                this.m_view!.Update(this.selection());

                // update the cursor so it looks correct before another event
                setCursor();
              }
            }

            if (placing && text) {
              text.ClearFlags();
              this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

              commit.Add(text);
              commit.Push('Draw Text');

              this.m_toolMgr!.RunAction(ACTIONS.selectItem, text);

              text = null;
            }

            controls.ForceCursorPosition(false);

            // If we started with a hotkey which has a position then warp back to that.
            // Otherwise update to the current mouse position pinned inside the autoscroll
            // boundaries.
            if (evt.IsPrime() && !ignorePrimePosition) {
              cursorPos = evt.Position();
              controls.WarpMouseCursor(cursorPos, true);
            } else {
              controls.PinCursorInsideNonAutoscrollArea(true);
              cursorPos = controls.GetMousePosition();
            }

            this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

            controls.ShowCursor(true);
            controls.CaptureCursor(text !== null);
            controls.SetAutoPan(text !== null);
          } else if (text && (evt.IsMotion() || evt.IsAction(ACTIONS.refreshPreview))) {
            text.SetPosition(cursorPos);
            this.selection().SetReferencePoint(cursorPos);
            this.m_view!.Update(this.selection());
          } else if (text && (IsZoneFillAction(evt) || evt.IsAction(ACTIONS.redo))) {
            wxBell();
          } else if (text && evt.IsAction(PCB_ACTIONS.properties)) {
            onEditItemRequest(this.m_frame!, text);
            this.m_view!.Update(this.selection());
            this.m_frame!.SetMsgPanel(text);
          } else {
            evt.SetPassEvent();
          }
        }

        controls.SetAutoPan(false);
        controls.CaptureCursor(false);
        controls.ForceCursorPosition(false);
        this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);

        if (this.selection().Empty()) this.m_frame!.SetMsgPanel(this.board());

        return 0;
      }.bind(this),
    );
  }

  /** `getSourceZoneForAction` (drawing_tool.cpp:3399-3432). */
  private getSourceZoneForAction(aMode: ZONE_MODE, aZone: { value: ZONE | null }): boolean {
    let clearSelection = false;
    aZone.value = null;

    // not an action that needs a source zone
    if (aMode === ZONE_MODE.ADD || aMode === ZONE_MODE.GRAPHIC_POLYGON) return true;

    const selTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;
    const selection = selTool.GetSelection();

    if (selection.Empty()) {
      clearSelection = true;
      this.m_toolMgr!.RunAction(ACTIONS.selectionCursor);
    }

    // we want a single zone
    if (selection.Size() === 1 && selection.GetItems()[0]!.Type() === KICAD_T.PCB_ZONE_T)
      aZone.value = selection.GetItems()[0] as unknown as ZONE;

    // expected a zone, but didn't get one
    if (!aZone.value) {
      if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      return false;
    }

    return true;
  }

  *DrawZone(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_isFootprintEditor && !this.m_frame!.GetModel()) return 0;

    const zoneMode = aEvent.Parameter<ZONE_MODE>();
    let drawMode = DRAWING_MODE.ZONE;

    if (aEvent.IsAction(PCB_ACTIONS.drawRuleArea)) drawMode = DRAWING_MODE.KEEPOUT;

    if (aEvent.IsAction(PCB_ACTIONS.drawPolygon)) drawMode = DRAWING_MODE.GRAPHIC_POLYGON;

    return yield* this.scoped(
      drawMode,
      function* (this: DRAWING_TOOL) {
        // get a source zone, if we need one. We need it for:
        // ZONE_MODE::CUTOUT (adding a hole to the source zone)
        // ZONE_MODE::SIMILAR (creating a new zone using settings of source zone
        const sourceZone: { value: ZONE | null } = { value: null };

        if (!this.getSourceZoneForAction(zoneMode, sourceZone)) return 0;

        // Turn zones on if they are off, so that the created object will be visible after completion
        this.m_frame!.SetObjectVisible(GAL_LAYER_ID.LAYER_ZONES);

        const params: ZONE_CREATE_PARAMS = {
          m_keepout: drawMode === DRAWING_MODE.KEEPOUT,
          m_mode: zoneMode,
          m_sourceZone: sourceZone.value,
          m_layer: this.m_frame!.GetActiveLayer(),
        };

        if (zoneMode === ZONE_MODE.SIMILAR && !sourceZone.value!.IsOnLayer(params.m_layer))
          params.m_layer = sourceZone.value!.GetFirstLayer();

        const zoneTool = new ZONE_CREATE_HELPER(
          {
            GetManager: () => this.m_toolMgr,
            getView: () => this.m_view,
            GetAngleSnapMode: () => this.GetAngleSnapMode(),
            editFrame: () => this.m_frame!,
            RunMainStackModal: (f) => this.RunMainStackModal(f),
          },
          params,
        );
        // the geometry manager which handles the zone geometry, and hands the calculated points
        // over to the zone creator tool
        const polyGeomMgr = new POLYGON_GEOM_MANAGER(zoneTool);
        let started = false;
        const grid = new PCB_GRID_HELPER(this.m_toolMgr!, this.m_frame!.GetMagneticItemsSettings());
        const controls = this.m_controls!;

        this.m_frame!.PushTool(aEvent);

        const setCursor = (): void => {
          this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
        };

        const cleanup = (): void => {
          polyGeomMgr.Reset();
          started = false;
          grid.ClearSkipPoint();

          // Snap guides persist in the grid helper until the tool exits, so abandoning the
          // outline mid-draw must clear them or they linger on screen.
          grid.FullReset();

          controls.SetAutoPan(false);
          controls.CaptureCursor(false);
        };

        this.Activate();
        // Must be done after Activate() so that it gets set into the correct context
        controls.ShowCursor(true);
        controls.ForceCursorPosition(false);
        // Set initial cursor
        setCursor();

        if (aEvent.HasPosition()) this.m_toolMgr!.PrimeTool(aEvent.Position());

        try {
          // Main loop: keep receiving events
          for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
            setCursor();

            const layers = new LSET([this.m_frame!.GetActiveLayer()]);
            grid.SetSnap(!evt.Modifier(MD_SHIFT));
            let angleSnap = this.GetAngleSnapMode();

            if (evt.Modifier(MD_CTRL)) angleSnap = LeaderMode.DIRECT;

            grid.SetUseGrid(
              this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping(),
            );

            let cursorPos: VECTOR2I = evt.HasPosition()
              ? evt.Position()
              : controls.GetMousePosition();
            cursorPos = GetClampedCoords(
              grid.BestSnapAnchor(cursorPos, layers, GRID_HELPER_GRIDS.GRID_GRAPHICS),
              DRAWING_COORDS_PADDING,
            );

            controls.ForceCursorPosition(true, cursorPos);

            polyGeomMgr.SetLeaderMode(angleSnap);

            if (evt.IsCancelInteractive()) {
              if (started) {
                cleanup();
              } else {
                this.m_frame!.PopTool(aEvent);

                // We've handled the cancel event.  Don't cancel other tools
                evt.SetPassEvent(false);
                break;
              }
            } else if (evt.IsActivate()) {
              if (started) cleanup();

              if (evt.IsPointEditor()) {
                // don't exit (the point editor runs in the background)
              } else if (evt.IsMoveTool()) {
                // leave ourselves on the stack so we come back after the move
                break;
              } else {
                this.m_frame!.PopTool(aEvent);
                break;
              }
            } else if (evt.IsAction(PCB_ACTIONS.layerChanged)) {
              if (zoneMode !== ZONE_MODE.SIMILAR) params.m_layer = this.m_frame!.GetActiveLayer();

              if (!this.m_view!.IsLayerVisible(params.m_layer)) {
                this.m_frame!.GetAppearancePanel()?.SetLayerVisible?.(params.m_layer, true);
                this.m_frame!.GetCanvas()!.Refresh();
              }
            } else if (evt.IsClick(BUT_RIGHT)) {
              if (!started) this.m_toolMgr!.VetoContextMenuMouseWarp();

              this.m_menu.ShowContextMenu(this.selection());
            }
            // events that lock in nodes
            else if (
              evt.IsClick(BUT_LEFT) ||
              evt.IsDblClick(BUT_LEFT) ||
              evt.IsAction(PCB_ACTIONS.closeOutline)
            ) {
              // Check if it is double click / closing line (so we have to finish the zone)
              const endPolygon =
                evt.IsDblClick(BUT_LEFT) ||
                evt.IsAction(PCB_ACTIONS.closeOutline) ||
                polyGeomMgr.NewPointClosesOutline(cursorPos);

              if (endPolygon) {
                polyGeomMgr.SetFinished();
                polyGeomMgr.Reset();

                cleanup();
                this.m_frame!.PopTool(aEvent);
                break;
              }

              // The zone's properties dialog, which upstream's OnFirstPoint shows
              // from inside AddPoint (see ZONE_CREATE_HELPER).
              if (!polyGeomMgr.IsPolygonInProgress() && !(yield* zoneTool.PrepareFirstPoint()))
                continue;

              // adding a corner
              if (polyGeomMgr.AddPoint(cursorPos)) {
                if (!started) {
                  started = true;

                  controls.SetAutoPan(true);
                  controls.CaptureCursor(true);

                  if (!this.m_view!.IsLayerVisible(params.m_layer)) {
                    this.m_frame!.GetAppearancePanel()?.SetLayerVisible?.(params.m_layer, true);
                    this.m_frame!.GetCanvas()!.Refresh();
                  }
                }
              }
            } else if (
              started &&
              (evt.IsAction(PCB_ACTIONS.deleteLastPoint) ||
                evt.IsAction(ACTIONS.doDelete) ||
                evt.IsAction(ACTIONS.undo))
            ) {
              // Snap guides persist in the grid helper until the tool exits, so dropping a corner
              // must clear them or they linger on screen.
              grid.FullReset();

              const last = polyGeomMgr.DeleteLastCorner();

              if (last) {
                cursorPos = last;
                this.getViewControls()!.WarpMouseCursor(cursorPos, true);
                controls.ForceCursorPosition(true, cursorPos);
                polyGeomMgr.SetCursorPosition(cursorPos);
              } else {
                cleanup();
              }
            } else if (started && (evt.IsMotion() || evt.IsDrag(BUT_LEFT))) {
              polyGeomMgr.SetCursorPosition(cursorPos);
            } else if (started && (IsZoneFillAction(evt) || evt.IsAction(ACTIONS.redo))) {
              wxBell();
            } else if (started && evt.IsAction(PCB_ACTIONS.properties)) {
              const zone = zoneTool.GetZone();

              if (zone) {
                onEditItemRequest(this.m_frame!, zone);
                zoneTool.OnGeometryChange(polyGeomMgr);
                this.m_frame!.SetMsgPanel(zone);
              }
            } else {
              evt.SetPassEvent();
            }
          } // end while
        } finally {
          zoneTool.Destroy();
        }

        this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
        controls.ForceCursorPosition(false);
        controls.SetAutoPan(false);
        controls.CaptureCursor(false);
        return 0;
      }.bind(this),
    );
  }

  /** `m_frame->GetAppearancePanel()->SetLayerVisible( m_layer, true )` when it is hidden. */
  private showLayer(): void {
    if (!this.m_view!.IsLayerVisible(this.m_layer)) {
      this.m_frame!.GetAppearancePanel()?.SetLayerVisible?.(this.m_layer, true);
      this.m_frame!.GetCanvas()!.Refresh();
    }
  }

  private *drawShape(
    aTool: TOOL_EVENT,
    aGraphic: SHAPE_REF,
    aStartingPoint: VECTOR2D | null,
    aCommittedGraphics: PCB_SHAPE[] | null,
  ): COROUTINE_BODY<boolean> {
    const shape = aGraphic.value!.GetShape();

    // Only three shapes are currently supported
    console.assert(
      shape === SHAPE_T.SEGMENT || shape === SHAPE_T.CIRCLE || shape === SHAPE_T.RECTANGLE,
    );

    const bds = this.m_frame!.GetDesignSettings();
    let userUnits = this.m_frame!.GetUserUnits();
    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, this.m_frame!.GetMagneticItemsSettings());

    if (this.m_layer !== this.m_frame!.GetActiveLayer()) this.setLayerDefaults();

    // Turn shapes on if they are off, so that the created object will be visible after completion
    this.m_frame!.SetObjectVisible(GAL_LAYER_ID.LAYER_FILLED_SHAPES);

    // geometric construction manager
    const twoPointMgr = new TWO_POINT_GEOMETRY_MANAGER();

    // drawing assistant overlay
    const geomShape =
      shape === SHAPE_T.SEGMENT
        ? GEOM_SHAPE.SEGMENT
        : shape === SHAPE_T.RECTANGLE
          ? GEOM_SHAPE.RECT
          : GEOM_SHAPE.CIRCLE;
    const twoPointAsst = new TWO_POINT_ASSISTANT(twoPointMgr, pcbIUScale, userUnits, geomShape);

    // Add a VIEW_GROUP that serves as a preview for the new item
    this.m_preview.Clear();
    this.m_view!.Add(this.m_preview);
    this.m_view!.Add(twoPointAsst);

    let started = false;
    let cancelled = false;
    const screen = this.m_frame!.GetScreen()!;
    let isLocalOriginSet = screen.m_LocalOrigin.x !== 0 || screen.m_LocalOrigin.y !== 0;
    let cursorPos: VECTOR2I = this.m_controls!.GetMousePosition();

    const setCursor = (): void => {
      this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
    };

    const cleanup = (): void => {
      this.m_preview.Clear();
      this.m_view!.Update(this.m_preview);
      aGraphic.value = null;

      if (!isLocalOriginSet) screen.m_LocalOrigin = { x: 0, y: 0 };
    };

    this.m_controls!.ShowCursor(true);
    this.m_controls!.ForceCursorPosition(false);
    // Set initial cursor
    setCursor();

    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

    if (aStartingPoint) this.m_toolMgr!.PrimeTool(aStartingPoint);

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();

      if (started) this.m_frame!.SetMsgPanel(aGraphic.value!);

      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      let angleSnap = this.GetAngleSnapMode();

      // Drawing rectangles and circles ignore the snap behavior by default, but constrains
      // when the modifier key is pressed
      if (shape === SHAPE_T.RECTANGLE || shape === SHAPE_T.CIRCLE) {
        if (evt.Modifier(MD_CTRL)) angleSnap = LeaderMode.DEG45;
        else angleSnap = LeaderMode.DIRECT;
      } else {
        // All other drawing uses the snap mode, except that is disabled with the modifier key
        if (evt.Modifier(MD_CTRL)) angleSnap = LeaderMode.DIRECT;
      }

      grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());
      cursorPos = GetClampedCoords(
        grid.BestSnapAnchor(
          this.m_controls!.GetMousePosition(),
          new LSET([this.m_layer]),
          GRID_HELPER_GRIDS.GRID_GRAPHICS,
        ),
        DRAWING_COORDS_PADDING,
      );
      this.m_controls!.ForceCursorPosition(true, cursorPos);

      if (evt.IsCancelInteractive() || (started && evt.IsAction(ACTIONS.undo))) {
        cleanup();

        if (!started) {
          // We've handled the cancel event.  Don't cancel other tools
          evt.SetPassEvent(false);
          this.m_frame!.PopTool(aTool);
          cancelled = true;
        }

        break;
      } else if (evt.IsActivate()) {
        if (evt.IsPointEditor()) {
          // don't exit (the point editor runs in the background)
        } else if (evt.IsMoveTool()) {
          cleanup();
          // leave ourselves on the stack so we come back after the move
          cancelled = true;
          break;
        } else {
          cleanup();
          this.m_frame!.PopTool(aTool);
          cancelled = true;
          break;
        }
      } else if (evt.IsAction(PCB_ACTIONS.layerChanged)) {
        if (this.m_layer !== this.m_frame!.GetActiveLayer()) this.setLayerDefaults();

        const graphic = aGraphic.value;

        if (graphic) {
          this.showLayer();

          graphic.SetLayer(this.m_layer);
          graphic.SetStroke(this.m_stroke.clone());

          this.m_view!.Update(this.m_preview);
          this.m_frame!.SetMsgPanel(graphic);
        } else {
          evt.SetPassEvent();
        }
      } else if (evt.IsClick(BUT_RIGHT)) {
        if (!aGraphic.value) this.m_toolMgr!.VetoContextMenuMouseWarp();

        this.m_menu.ShowContextMenu(this.selection());
      } else if (evt.IsClick(BUT_LEFT) || evt.IsDblClick(BUT_LEFT)) {
        const graphic = aGraphic.value;

        if (!graphic) break;

        if (!started) {
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          if (aStartingPoint) {
            cursorPos = { x: aStartingPoint.x, y: aStartingPoint.y };
            aStartingPoint = null;
          }

          // Init the new item attributes
          graphic.SetShape(shape);
          graphic.SetFilled(false);
          graphic.SetStroke(this.m_stroke.clone());
          graphic.SetLayer(this.m_layer);

          grid.SetSkipPoint(cursorPos);

          twoPointMgr.SetOrigin(cursorPos);
          twoPointMgr.SetEnd(cursorPos);

          if (!isLocalOriginSet) screen.m_LocalOrigin = { ...cursorPos };

          this.m_preview.Add(graphic);
          this.m_frame!.SetMsgPanel(graphic);
          this.m_controls!.SetAutoPan(true);
          this.m_controls!.CaptureCursor(true);

          this.showLayer();

          updateSegmentFromGeometryMgr(twoPointMgr, graphic);

          started = true;
        } else {
          const snapped = grid.GetSnapped();
          const snapItem = snapped instanceof PCB_SHAPE ? snapped : null;

          if (shape === SHAPE_T.SEGMENT && snapItem && graphic.GetLength() > 0) {
            // User has clicked on the end of an existing segment, closing a path
            const commit = new BOARD_COMMIT(this.m_frame!);

            commit.Add(graphic);
            commit.Push('Draw Line');
            this.m_toolMgr!.RunAction(ACTIONS.selectItem, graphic);

            aGraphic.value = null;
          } else if (twoPointMgr.IsEmpty() || evt.IsDblClick(BUT_LEFT)) {
            // User has clicked twice in the same spot, meaning we're finished
            aGraphic.value = null;
          }

          this.m_preview.Clear();
          twoPointMgr.Reset();
          break;
        }

        twoPointMgr.SetEnd(GetClampedCoords(cursorPos));
      } else if (evt.IsMotion()) {
        let clampedCursorPos = cursorPos;

        if (shape === SHAPE_T.CIRCLE || shape === SHAPE_T.ARC)
          clampedCursorPos = getClampedRadiusEnd(twoPointMgr.GetOrigin(), cursorPos);
        else clampedCursorPos = getClampedDifferenceEnd(twoPointMgr.GetOrigin(), cursorPos);

        // constrained lines
        if (started && angleSnap !== LeaderMode.DIRECT) {
          const lineVector = sub(clampedCursorPos, twoPointMgr.GetOrigin());

          let newEnd: VECTOR2I;
          if (angleSnap === LeaderMode.DEG90) newEnd = vectorSnapped90(lineVector);
          else newEnd = vectorSnapped45(lineVector, shape === SHAPE_T.RECTANGLE);

          this.m_controls!.ForceCursorPosition(true, twoPointMgr.GetEnd());
          twoPointMgr.SetEnd(add(twoPointMgr.GetOrigin(), newEnd));
          twoPointMgr.SetAngleSnap(angleSnap);
        } else {
          twoPointMgr.SetEnd(clampedCursorPos);
          twoPointMgr.SetAngleSnap(LeaderMode.DIRECT);
        }

        if (aGraphic.value) updateSegmentFromGeometryMgr(twoPointMgr, aGraphic.value);

        this.m_view!.Update(this.m_preview);
        this.m_view!.Update(twoPointAsst);
      } else if (
        started &&
        (evt.IsAction(PCB_ACTIONS.doDelete) || evt.IsAction(PCB_ACTIONS.deleteLastPoint))
      ) {
        if (aCommittedGraphics && aCommittedGraphics.length > 0) {
          const top = aCommittedGraphics.pop()!;
          twoPointMgr.SetOrigin(top.GetStart());
          twoPointMgr.SetEnd(top.GetEnd());

          // Snap guides persist in the grid helper until the tool exits, so a mid-draw
          // backup must clear them or they linger on screen.
          grid.FullReset();

          this.getViewControls()!.WarpMouseCursor(twoPointMgr.GetEnd(), true);

          const undo = this.m_frame!.PopCommandFromUndoList();

          if (undo) {
            this.m_frame!.PutDataInPreviousState(undo);
            this.m_frame!.ClearListAndDeleteItems(undo);
          }

          if (aGraphic.value) updateSegmentFromGeometryMgr(twoPointMgr, aGraphic.value);

          this.m_view!.Update(this.m_preview);
          this.m_view!.Update(twoPointAsst);
        } else {
          cleanup();
          break;
        }
      } else if (aGraphic.value && evt.IsAction(PCB_ACTIONS.incWidth)) {
        this.m_stroke.SetWidth(this.m_stroke.GetWidth() + WIDTH_STEP);
        aGraphic.value.SetStroke(this.m_stroke.clone());
        this.m_view!.Update(this.m_preview);
        this.m_frame!.SetMsgPanel(aGraphic.value);
      } else if (aGraphic.value && evt.IsAction(PCB_ACTIONS.decWidth)) {
        if (this.m_stroke.GetWidth() > WIDTH_STEP) {
          this.m_stroke.SetWidth(this.m_stroke.GetWidth() - WIDTH_STEP);
          aGraphic.value.SetStroke(this.m_stroke.clone());
          this.m_view!.Update(this.m_preview);
          this.m_frame!.SetMsgPanel(aGraphic.value);
        }
      } else if (started && evt.IsAction(PCB_ACTIONS.properties)) {
        onEditItemRequest(this.m_frame!, aGraphic.value!);
        this.m_view!.Update(this.m_preview);
        this.m_frame!.SetMsgPanel(aGraphic.value!);
      } else if (started && (IsZoneFillAction(evt) || evt.IsAction(ACTIONS.redo))) {
        wxBell();
      } else if (evt.IsAction(ACTIONS.resetLocalCoords)) {
        isLocalOriginSet = true;
        evt.SetPassEvent();
      } else if (evt.IsAction(ACTIONS.updateUnits)) {
        if (this.m_frame!.GetUserUnits() !== userUnits) {
          userUnits = this.m_frame!.GetUserUnits();
          twoPointAsst.SetUnits(userUnits);
          this.m_view!.Update(twoPointAsst);
        }
        evt.SetPassEvent();
      } else {
        evt.SetPassEvent();
      }
    }

    if (!isLocalOriginSet)
      // reset the relative coordinate if it was not set before
      screen.m_LocalOrigin = { x: 0, y: 0 };

    this.m_view!.Remove(twoPointAsst);
    this.m_view!.Remove(this.m_preview);

    if (this.selection().Empty()) this.m_frame!.SetMsgPanel(this.board());

    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    this.m_controls!.SetAutoPan(false);
    this.m_controls!.CaptureCursor(false);
    this.m_controls!.ForceCursorPosition(false);

    return !cancelled;
  }

  private *drawArc(
    aTool: TOOL_EVENT,
    aGraphic: SHAPE_REF,
    aStartingPoint: VECTOR2D | null,
  ): COROUTINE_BODY<boolean> {
    if (!aGraphic.value) return false; // wxCHECK( graphic, false )

    if (this.m_layer !== this.m_frame!.GetActiveLayer()) {
      this.m_layer = this.m_frame!.GetActiveLayer();
      this.m_stroke.SetWidth(this.m_frame!.GetDesignSettings().GetLineThickness(this.m_layer));
      this.m_stroke.SetLineStyle(LINE_STYLE.DEFAULT);
      this.m_stroke.SetColor(COLOR4D_UNSPECIFIED);
    }

    // Arc geometric construction manager
    const arcManager = new ARC_GEOM_MANAGER();

    // Arc drawing assistant overlay
    const arcAsst = new ARC_ASSISTANT(arcManager, pcbIUScale, this.m_frame!.GetUserUnits());

    // Add a VIEW_GROUP that serves as a preview for the new item
    const preview = new PCB_SELECTION();
    this.m_view!.Add(preview);
    this.m_view!.Add(arcAsst);
    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, this.m_frame!.GetMagneticItemsSettings());

    const setCursor = (): void => {
      this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
    };

    const cleanup = (): void => {
      preview.Clear();
      aGraphic.value = null;
    };

    this.m_controls!.ShowCursor(true);
    this.m_controls!.ForceCursorPosition(false);
    // Set initial cursor
    setCursor();

    let started = false;
    let cancelled = false;

    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

    if (aStartingPoint) this.m_toolMgr!.PrimeTool(aStartingPoint);

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      const graphic = aGraphic.value;

      if (started && graphic) this.m_frame!.SetMsgPanel(graphic);

      setCursor();

      graphic?.SetLayer(this.m_layer);

      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      let angleSnap = this.GetAngleSnapMode();

      if (evt.Modifier(MD_CTRL)) angleSnap = LeaderMode.DIRECT;

      grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());
      const cursorPos = GetClampedCoords(
        grid.BestSnapAnchor(
          this.m_controls!.GetMousePosition(),
          graphic,
          GRID_HELPER_GRIDS.GRID_GRAPHICS,
        ),
        DRAWING_COORDS_PADDING,
      );
      this.m_controls!.ForceCursorPosition(true, cursorPos);

      if (evt.IsCancelInteractive() || (started && evt.IsAction(ACTIONS.undo))) {
        cleanup();

        if (!started) {
          // We've handled the cancel event.  Don't cancel other tools
          evt.SetPassEvent(false);
          this.m_frame!.PopTool(aTool);
          cancelled = true;
        }

        break;
      } else if (evt.IsActivate()) {
        if (evt.IsPointEditor()) {
          // don't exit (the point editor runs in the background)
        } else if (evt.IsMoveTool()) {
          cleanup();
          // leave ourselves on the stack so we come back after the move
          cancelled = true;
          break;
        } else {
          cleanup();
          this.m_frame!.PopTool(aTool);
          cancelled = true;
          break;
        }
      } else if (evt.IsClick(BUT_LEFT)) {
        if (!started && graphic) {
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          this.m_controls!.SetAutoPan(true);
          this.m_controls!.CaptureCursor(true);

          // Init the new item attributes
          // (non-geometric, those are handled by the manager)
          graphic.SetShape(SHAPE_T.ARC);
          graphic.SetStroke(this.m_stroke.clone());

          this.showLayer();

          preview.Add(graphic);
          this.m_frame!.SetMsgPanel(graphic);
          started = true;
        }

        arcManager.AddPoint(cursorPos, true);
      } else if (evt.IsAction(PCB_ACTIONS.deleteLastPoint)) {
        // Snap guides persist in the grid helper until the tool exits, so a mid-draw backup
        // must clear them or they linger on screen.
        grid.FullReset();
        arcManager.RemoveLastPoint();
      } else if (evt.IsMotion()) {
        // set angle snap
        arcManager.SetAngleSnap(angleSnap !== LeaderMode.DIRECT);

        // update, but don't step the manager state
        arcManager.AddPoint(cursorPos, false);
      } else if (evt.IsAction(PCB_ACTIONS.layerChanged)) {
        if (this.m_layer !== this.m_frame!.GetActiveLayer()) {
          this.m_layer = this.m_frame!.GetActiveLayer();
          this.m_stroke.SetWidth(this.m_frame!.GetDesignSettings().GetLineThickness(this.m_layer));
          this.m_stroke.SetLineStyle(LINE_STYLE.DEFAULT);
          this.m_stroke.SetColor(COLOR4D_UNSPECIFIED);
        }

        if (graphic) {
          this.showLayer();

          graphic.SetLayer(this.m_layer);
          graphic.SetStroke(this.m_stroke.clone());
          this.m_view!.Update(preview);
          this.m_frame!.SetMsgPanel(graphic);
        } else {
          evt.SetPassEvent();
        }
      } else if (evt.IsAction(PCB_ACTIONS.properties) && graphic) {
        if (arcManager.GetStep() === ARC_STEPS.SET_START) {
          graphic.SetArcAngleAndEnd(ANGLE_90);
          onEditItemRequest(this.m_frame!, graphic);
          this.m_view!.Update(preview);
          this.m_frame!.SetMsgPanel(graphic);
          break;
        }
        // Don't show the edit panel if we can't represent the arc with it
        else if (
          arcManager.GetStep() === ARC_STEPS.SET_ANGLE &&
          !equal(arcManager.GetStartRadiusEnd(), arcManager.GetEndRadiusEnd())
        ) {
          onEditItemRequest(this.m_frame!, graphic);
          this.m_view!.Update(preview);
          this.m_frame!.SetMsgPanel(graphic);
          break;
        } else {
          evt.SetPassEvent();
        }
      } else if (evt.IsClick(BUT_RIGHT)) {
        if (!graphic) this.m_toolMgr!.VetoContextMenuMouseWarp();

        this.m_menu.ShowContextMenu(this.selection());
      } else if (evt.IsAction(PCB_ACTIONS.incWidth)) {
        this.m_stroke.SetWidth(this.m_stroke.GetWidth() + WIDTH_STEP);

        if (graphic) {
          graphic.SetStroke(this.m_stroke.clone());
          this.m_view!.Update(preview);
          this.m_frame!.SetMsgPanel(graphic);
        }
      } else if (evt.IsAction(PCB_ACTIONS.decWidth)) {
        if (this.m_stroke.GetWidth() > WIDTH_STEP) {
          this.m_stroke.SetWidth(this.m_stroke.GetWidth() - WIDTH_STEP);

          if (graphic) {
            graphic.SetStroke(this.m_stroke.clone());
            this.m_view!.Update(preview);
            this.m_frame!.SetMsgPanel(graphic);
          }
        }
      } else if (evt.IsAction(PCB_ACTIONS.arcPosture)) {
        arcManager.ToggleClockwise();
      } else if (evt.IsAction(ACTIONS.updateUnits)) {
        arcAsst.SetUnits(this.m_frame!.GetUserUnits());
        this.m_view!.Update(arcAsst);
        evt.SetPassEvent();
      } else if (started && (IsZoneFillAction(evt) || evt.IsAction(ACTIONS.redo))) {
        wxBell();
      } else {
        evt.SetPassEvent();
      }

      if (arcManager.IsComplete()) {
        break;
      } else if (arcManager.HasGeometryChanged() && aGraphic.value) {
        updateArcFromConstructionMgr(arcManager, aGraphic.value);
        this.m_view!.Update(preview);
        this.m_view!.Update(arcAsst);

        if (started) this.m_frame!.SetMsgPanel(aGraphic.value);
        else this.m_frame!.SetMsgPanel(this.board());
      }
    }

    if (aGraphic.value) preview.Remove(aGraphic.value);
    this.m_view!.Remove(arcAsst);
    this.m_view!.Remove(preview);

    if (this.selection().Empty()) this.m_frame!.SetMsgPanel(this.board());

    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    this.m_controls!.SetAutoPan(false);
    this.m_controls!.CaptureCursor(false);
    this.m_controls!.ForceCursorPosition(false);

    return !cancelled;
  }

  protected override setTransitions(): void {
    // clang-format off
    this.Go(S(this.DrawLine), PCB_ACTIONS.drawLine.MakeEvent());
    this.Go(S(this.DrawRectangle), PCB_ACTIONS.drawRectangle.MakeEvent());
    this.Go(S(this.DrawCircle), PCB_ACTIONS.drawCircle.MakeEvent());
    this.Go(S(this.DrawArc), PCB_ACTIONS.drawArc.MakeEvent());
    this.Go(S(this.PlaceText), PCB_ACTIONS.placeText.MakeEvent());
    this.Go(S(this.DrawZone), PCB_ACTIONS.drawPolygon.MakeEvent());
    // TRANSITIONAL: drawZone, drawRuleArea, drawZoneCutout and drawSimilarZone
    // bind to DrawZone once their properties windows take a ZONE_SETTINGS.
    // TRANSITIONAL: the remaining handlers are bound as they are ported.
  }
}

/** `frame()->OnEditItemRequest( aItem )`: PCB_BASE_FRAME's virtual, which PCB_EDIT_FRAME answers. */
function onEditItemRequest(aFrame: PCB_BASE_EDIT_FRAME, aItem: BOARD_ITEM): void {
  (aFrame as unknown as { OnEditItemRequest?(aItem: BOARD_ITEM): void }).OnEditItemRequest?.(aItem);
}
