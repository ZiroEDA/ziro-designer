// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DRAWING_TOOL::DrawBezier` and `drawOneBezier` — the click sequence, the
 * preview geometry, and the rule that chains one curve into the next.
 * Counterpart: `pcbnew/tools/drawing_tool.cpp`.
 *
 * The geometry itself is not here: it is {@link BezierGeomManager} in
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

import { BezierGeomManager, BezierStep } from '@ziroeda/common/index.js';
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
  readonly step: BezierStep;
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * Replay the locked-in points into a manager, then feed the cursor without
 * locking it in — `AddPoint( cursorPos, false )`, the motion case.
 */
function replay(locked: readonly Vec2[], cursor: Vec2 | null): BezierGeomManager {
  const m = new BezierGeomManager();
  for (const p of locked) m.addPoint(p, true);
  if (cursor) m.addPoint(cursor, false);
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
  if (m.isReset()) return null;
  return {
    points: [m.getStart(), m.getControlC1(), m.getControlC2(), m.getEnd()],
    step: m.getBezierStep(),
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
  if (!live || live.step < BezierStep.SET_END) return null;
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
  const step = locked.length as BezierStep;

  if (step === BezierStep.SET_END && !same(at, locked[0]!))
    return { kind: 'continue', locked: [...locked, at] };

  if (step === BezierStep.SET_END) return { kind: 'continue', locked: locked.slice(0, -1) };

  if (step < BezierStep.SET_CONTROL2) return { kind: 'continue', locked: [...locked, at] };

  const m = replay(locked, null);
  m.addPoint(at, true);
  const points: BezierPoints = [m.getStart(), m.getControlC1(), m.getControlC2(), m.getEnd()];
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
