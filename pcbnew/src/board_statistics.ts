// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board statistics: the numbers behind the Board Statistics dialog.
 * Counterparts: `pcbnew/board_statistics.cpp` (`CollectDrillLineItems`) and
 * `pcbnew/board_statistics_report.cpp` (`InitializeBoardStatisticsData`,
 * `ComputeBoardStatistics`), which `DIALOG_BOARD_STATISTICS` only formats.
 *
 * Everything here is a count or a measurement a fabricator may quote from, so
 * the interesting content is in the rules that decide *what counts*, not in the
 * arithmetic. Four of them are load bearing and none is guessable from the
 * dialog's screenshot.
 *
 * ## A footprint belongs to a side only if something on it is side-specific
 *
 * `FOOTPRINT::GetSide()` does not return the footprint's own layer. It walks
 * the pads and the *graphics* looking for one item on a layer in
 * `LSET::SideSpecificMask()` — all copper plus the six front and six back tech
 * layers — and returns `UNDEFINED_LAYER` when it finds none. The counting loop
 * switches on that and increments neither column for `UNDEFINED_LAYER`, so a
 * footprint drawn only on `User.Drawings` (or a mounting hole whose pad is on
 * `Edge.Cuts` alone) appears in no column at all, and the Total row is short by
 * it. Reference and Value are `PCB_FIELD`s and live in `m_fields`, *not* in the
 * `m_drawings` deque `GetSide` iterates — which is why silkscreen reference
 * text does not, on its own, give a footprint a side.
 *
 * ## The board area is the outline area, cutouts included
 *
 * `boardArea` sums `Outline(i).Area()` — the *absolute* shoelace area of each
 * top-level contour — and subtracts the cutouts only when "subtract holes from
 * board area" is ticked. A board with a big cutout therefore reports its gross
 * area by default. When that option is on, upstream also subtracts every pad
 * hole and every via hole; that subtraction sits **inside** the per-outline
 * loop, so on a two-outline board every drilled hole is subtracted twice. It
 * reads as a bug and is reproduced deliberately: a panel measured by KiCad and
 * by us has to give the same number.
 *
 * ## No outline, and an outline that will not close, are the same answer
 *
 * `GetBoardPolygonOutlines(polySet, false)` is called with
 * `aInferOutlineIfNecessary` false, so nothing is invented from a bounding box.
 * Inside, `doConvertOutlineToPolygon` builds every contour first and then
 * returns false the moment *any* one of them failed to close — before a single
 * contour has been added to the polygon set. So a board whose Edge.Cuts has a
 * gap does not get a partial outline and a plausible-looking area: it gets
 * `hasOutline` false, width, height and area all zero, and the dialog prints
 * "unknown". Same as a board with no Edge.Cuts at all. Rebuilding this as
 * "chain what you can and measure the rest" is the mistake this note exists to
 * prevent.
 *
 * ## Two holes are the same hole only if all seven fields agree
 *
 * `DRILL_LINE_ITEM::operator==` compares x size, y size, drill shape, plated,
 * pad-or-via, start layer and stop layer. Same diameter is not enough: a PTH
 * and an NPTH of 0.8 mm are two rows, and so are a 0.8 mm pad hole and a 0.8 mm
 * via. Grouping is first-match-wins over the list built so far, so the rows come
 * out in first-encounter order — pads before vias, footprint order within pads —
 * before the count sort reorders them.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { booleanAdd, type Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { chainOutlines, shapePoints } from './courtyard.js';
import { padIsOnLayer } from './pad_enumerate.js';
import { copperRank, enabledCopperLayers, isCopperLayerName } from './swap_layers.js';
import type { Board, PcbFootprint, PcbPad, PcbShape, PcbVia } from './types.js';

// ---------------------------------------------------------------------------
// Constants from upstream.

/** `BOARD_DESIGN_SETTINGS::m_MaxError`, ARC_HIGH_DEF — arc tessellation error. */
const BOARD_MAX_ERROR = mmToIU(0.005);

/** `DEFAULT_CHAINING_EPSILON_MM`, how far two Edge.Cuts ends may miss and still join. */
const BOARD_CHAINING_EPSILON = mmToIU(0.01);

/**
 * `LSET::SideSpecificMask()` minus the copper layers, which are handled
 * separately because a board's copper stack is not a fixed list of names.
 */
const SIDE_SPECIFIC_TECH_LAYERS = [
  'F.SilkS',
  'F.Mask',
  'F.Adhes',
  'F.Paste',
  'F.CrtYd',
  'F.Fab',
  'B.SilkS',
  'B.Mask',
  'B.Adhes',
  'B.Paste',
  'B.CrtYd',
  'B.Fab',
] as const;

// ---------------------------------------------------------------------------
// Drill line items.

/** `PAD_DRILL_SHAPE`, less the UNDEFINED member no file can produce. */
export type PadDrillShape = 'circle' | 'oblong';

/**
 * `DRILL_LINE_ITEM`: one row of the drill table, and the count of holes that
 * are identical in every field below.
 *
 * `startLayer` / `stopLayer` are layer names, or undefined for upstream's
 * `UNDEFINED_LAYER`, which a pad with no copper layer at all produces.
 */
export interface DrillLineItem {
  xSize: number;
  ySize: number;
  shape: PadDrillShape;
  /** Anything other than an NPTH pad; vias are always plated. */
  isPlated: boolean;
  isPad: boolean;
  startLayer?: string;
  stopLayer?: string;
  qty: number;
}

/** `DRILL_LINE_ITEM::operator==` — all seven fields, quantity excluded. */
export function sameDrillLineItem(a: DrillLineItem, b: DrillLineItem): boolean {
  return (
    a.xSize === b.xSize &&
    a.ySize === b.ySize &&
    a.shape === b.shape &&
    a.isPlated === b.isPlated &&
    a.isPad === b.isPad &&
    a.startLayer === b.startLayer &&
    a.stopLayer === b.stopLayer
  );
}

/** `PAD::HasHole()` — a drill with both dimensions above zero. */
function padHasHole(pad: PcbPad): boolean {
  return pad.drill !== undefined && pad.drill.w > 0 && pad.drill.h > 0;
}

/**
 * The pad's copper stack, front to back: `pad->GetLayerSet().CuStack()`.
 * The pad's `(layers …)` tokens are wildcards, so membership is asked of each
 * copper layer the board actually enables rather than read off the token list.
 */
function padCuStack(pad: PcbPad, copperLayers: readonly string[]): string[] {
  return copperLayers.filter((layer) => padIsOnLayer(pad, layer));
}

/**
 * `PCB_VIA::TopLayer()` / `BottomLayer()` after `SanitizeLayers()`: a through
 * via is F.Cu to B.Cu whatever its `(layers …)` said, and any other pair is
 * ordered by physical depth rather than by the order it was written in.
 */
function viaLayerSpan(via: PcbVia): { top: string; bottom: string } {
  if (via.kind === 'through') return { top: 'F.Cu', bottom: 'B.Cu' };

  const [a, b] = via.layers;
  return copperRank(a) <= copperRank(b) ? { top: a, bottom: b } : { top: b, bottom: a };
}

/**
 * `CollectDrillLineItems`.
 *
 * Pads come first and vias second, and within each the board's own order is
 * kept, because "first match increments, otherwise append" makes the output
 * order the order holes were first seen.
 */
export function collectDrillLineItems(board: Board): DrillLineItem[] {
  const out: DrillLineItem[] = [];

  const addOrIncrement = (d: DrillLineItem): void => {
    for (const e of out) {
      if (sameDrillLineItem(e, d)) {
        e.qty++;
        return;
      }
    }
    out.push({ ...d, qty: 1 });
  };

  const copperLayers = enabledCopperLayers(board);

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!padHasHole(pad)) continue;

      const xs = pad.drill!.w;
      const ys = pad.drill!.h;

      // Unreachable given HasHole above; upstream tests it anyway and so does
      // this, because the two conditions are not the same in the padstack model
      // upstream is moving towards.
      if (xs <= 0 || ys <= 0) continue;

      const stack = padCuStack(pad, copperLayers);

      addOrIncrement({
        xSize: xs,
        ySize: ys,
        shape: pad.drill!.oblong ? 'oblong' : 'circle',
        isPlated: pad.type !== 'np_thru_hole',
        isPad: true,
        startLayer: stack[0],
        stopLayer: stack[stack.length - 1],
        qty: 0,
      });
    }
  }

  for (const via of board.vias) {
    const dmm = via.drill;
    if (dmm <= 0) continue;

    const span = viaLayerSpan(via);

    addOrIncrement({
      xSize: dmm,
      ySize: dmm,
      shape: 'circle',
      isPlated: true,
      isPad: false,
      startLayer: span.top,
      stopLayer: span.bottom,
      qty: 0,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The board outline.

/** One top-level outline of the board polygon set, with its cutouts. */
export interface BoardOutlinePolygon {
  outline: Vec2[];
  holes: Vec2[][];
}

export interface BoardPolygonOutlines {
  /**
   * `GetBoardPolygonOutlines`' return value. False whenever a contour did not
   * close, and false when there is nothing on Edge.Cuts at all — in both cases
   * `polygons` is empty, because upstream bails before populating the set.
   */
  success: boolean;
  polygons: BoardOutlinePolygon[];
}

/** `SHAPE_LINE_CHAIN` points are integers; contour geometry is rounded to match. */
const roundPt = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

/**
 * The polyline a graphic contributes to the outline, wrapping `shapePoints`
 * with the Bezier case it declines to answer.
 *
 * `shapePoints` refuses curves because chaining a Bezier's control hull would
 * close a courtyard the user never drew. Here the curve *is* tessellated, as
 * `processShapeSegment` does for `SHAPE_T::BEZIER`: dropping it instead would
 * strand the segments either side of it and turn a perfectly good outline into
 * "not a closed shape".
 */
function edgePoints(s: PcbShape, maxError: number): { pts: Vec2[]; closed: boolean } | undefined {
  if (s.kind === 'curve') {
    const ctrl = s.pts;
    if (!ctrl || (ctrl.length !== 3 && ctrl.length !== 4)) return undefined;
    return { pts: new BezierPoly(ctrl).getPoly(maxError), closed: false };
  }

  return shapePoints(s, maxError);
}

/** Even-odd containment, `SHAPE_LINE_CHAIN::PointInside`. */
function pointInContour(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/**
 * `BOARD::GetBoardPolygonOutlines( polySet, false )`.
 *
 * Board graphics and footprint graphics on Edge.Cuts are chained together into
 * closed contours; a contour with an even number of enclosing contours is an
 * outline and one with an odd number is a cutout of its immediate parent, which
 * is `buildContourHierarchy` + `addOutlinesToPolygon` + `addHolesToPolygon`
 * with `aAllowDisjoint` true. The final `Simplify()` is the union that merges
 * outlines a malformed board drew overlapping.
 */
export function getBoardPolygonOutlines(board: Board): BoardPolygonOutlines {
  const edges = [...board.shapes, ...board.footprints.flatMap((fp) => fp.shapes)].filter(
    (s) => s.layer === 'Edge.Cuts',
  );

  // `success` starts false and only `doConvertOutlineToPolygon` sets it, and
  // that is not called when the shape list is empty.
  if (edges.length === 0) return { success: false, polygons: [] };

  const closed: Vec2[][] = [];
  const open: Vec2[][] = [];

  for (const s of edges) {
    const pts = edgePoints(s, BOARD_MAX_ERROR);

    // Upstream makes a contour out of every graphic it was handed, so a
    // malformed one (a line with no end point, a polygon with two vertices)
    // becomes a contour that cannot close and fails the whole build. Skipping
    // it here would instead hand back an outline the board does not have.
    if (!pts) return { success: false, polygons: [] };

    (pts.closed ? closed : open).push(pts.pts.map(roundPt));
  }

  const chained = chainOutlines(open, BOARD_CHAINING_EPSILON);

  // "Ensure all contours are closed": one open run fails the whole build, and
  // the caller's polygon set is never touched.
  if (chained.error) return { success: false, polygons: [] };

  // Defensive, not load-bearing: an open run of fewer than three points fails
  // chaining above and never reaches here, and no closed run shorter than a
  // triangle has been found. Mutation testing confirms removing the filter
  // changes no result. Kept because a degenerate ring reaching the parent
  // search below would be counted as an outline that encloses nothing.
  const contours = [...closed, ...chained.outlines].filter((c) => c.length >= 3);
  if (contours.length === 0) return { success: true, polygons: [] };

  // Parents of each contour: every other contour that contains its first point.
  const parents = contours.map((c, i) =>
    contours.reduce<number[]>((acc, other, j) => {
      if (j !== i && pointInContour(c[0]!, other)) acc.push(j);
      return acc;
    }, []),
  );

  const polygons: BoardOutlinePolygon[] = [];
  const outlineOf = new Map<number, number>();

  for (let i = 0; i < contours.length; i++) {
    if (parents[i]!.length % 2 !== 0) continue;
    outlineOf.set(i, polygons.length);
    polygons.push({ outline: contours[i]!, holes: [] });
  }

  for (let i = 0; i < contours.length; i++) {
    const mine = parents[i]!;
    if (mine.length % 2 !== 1) continue;

    // The immediate parent is the enclosing contour with exactly one fewer
    // ancestor of its own.
    for (const parent of mine) {
      if (parents[parent]!.length === mine.length - 1) {
        polygons[outlineOf.get(parent)!]!.holes.push(contours[i]!);
        break;
      }
    }
  }

  // `aOutlines.Simplify()`.
  const simplified = booleanAdd(
    polygons.map((p): Polygon => [p.outline, ...p.holes]),
    [],
  );

  return {
    success: true,
    polygons: simplified.map((rings) => ({ outline: rings[0]!, holes: rings.slice(1) })),
  };
}

/**
 * `SHAPE_LINE_CHAIN::Area( true )`, upstream's formula verbatim including the
 * absolute value that hides the winding direction — which is why a cutout drawn
 * the same way round as its outline still subtracts.
 */
function contourArea(pts: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    area += (pts[j]!.x + pts[i]!.x) * (pts[j]!.y - pts[i]!.y);

  return Math.abs(area * 0.5);
}

// ---------------------------------------------------------------------------
// The statistics themselves.

export interface BoardStatisticsOptions {
  /** `m_checkBoxExcludeComponentsNoPins`. */
  excludeFootprintsWithoutPads: boolean;
  /** `m_checkBoxSubtractHoles`. */
  subtractHolesFromBoardArea: boolean;
  /**
   * `m_checkBoxSubtractHolesFromCopper`. Carried so callers can round-trip the
   * dialog state; the copper areas it governs are not computed here.
   */
  subtractHolesFromCopperAreas: boolean;
}

/** `DIALOG_BOARD_STATISTICS_SAVED_STATE`: all three checkboxes start clear. */
export const DEFAULT_BOARD_STATISTICS_OPTIONS: BoardStatisticsOptions = {
  excludeFootprintsWithoutPads: false,
  subtractHolesFromBoardArea: false,
  subtractHolesFromCopperAreas: false,
};

/** `BOARD_STATISTICS_FP_ENTRY`: a footprint attribute test and its two columns. */
export interface FootprintStatisticsEntry {
  /** Attribute bits looked at, and the value they must equal. */
  attributeMask: number;
  attributeValue: number;
  title: string;
  frontCount: number;
  backCount: number;
}

/** `BOARD_STATISTICS_INFO_ENTRY<T>`: one labelled count. */
export interface StatisticsCountEntry<T extends string> {
  attribute: T;
  title: string;
  quantity: number;
}

/** `PAD_ATTRIB`, as the file spells it. */
export type PadAttribute = 'thru_hole' | 'smd' | 'connect' | 'np_thru_hole';

/** The two `PAD_PROP` members the dialog counts, as the file spells them. */
export type CountedPadProperty = 'pad_prop_castellated' | 'pad_prop_pressfit';

/** `VIATYPE`, as `PcbVia.kind` spells it, plus the buried member. */
export type ViaTypeName = 'through' | 'blind' | 'buried' | 'micro';

export interface BoardStatisticsData {
  hasOutline: boolean;
  boardWidth: number;
  boardHeight: number;
  boardArea: number;
  /** `std::numeric_limits<int>::max()` when no track set one. */
  minTrackWidth: number;
  /** Likewise; only round holes are candidates. */
  minDrillSize: number;
  footprintEntries: FootprintStatisticsEntry[];
  padEntries: StatisticsCountEntry<PadAttribute>[];
  padPropertyEntries: StatisticsCountEntry<CountedPadProperty>[];
  viaEntries: StatisticsCountEntry<ViaTypeName>[];
  drillEntries: DrillLineItem[];
}

/** `std::numeric_limits<int>::max()`, the sentinel the min fields start at. */
export const STATISTICS_INT_MAX = 2147483647;

/**
 * `InitializeBoardStatisticsData` followed by `ResetCounts`.
 *
 * The order of every list is the order of the dialog's rows and of the saved
 * report, so it is part of the output rather than an implementation detail.
 * "Unspecified" is last and matches on `(attributes & (THT|SMD)) == 0`, so a
 * footprint that somehow claims both THT and SMD is counted as THT — the first
 * entry whose test passes wins and the loop breaks.
 */
export function initialiseBoardStatisticsData(): BoardStatisticsData {
  const FP_THROUGH_HOLE = 0x0001;
  const FP_SMD = 0x0002;

  return {
    hasOutline: false,
    boardWidth: 0,
    boardHeight: 0,
    boardArea: 0,
    minTrackWidth: STATISTICS_INT_MAX,
    minDrillSize: STATISTICS_INT_MAX,
    footprintEntries: [
      {
        attributeMask: FP_THROUGH_HOLE,
        attributeValue: FP_THROUGH_HOLE,
        title: 'THT:',
        frontCount: 0,
        backCount: 0,
      },
      { attributeMask: FP_SMD, attributeValue: FP_SMD, title: 'SMD:', frontCount: 0, backCount: 0 },
      {
        attributeMask: FP_THROUGH_HOLE | FP_SMD,
        attributeValue: 0,
        title: 'Unspecified:',
        frontCount: 0,
        backCount: 0,
      },
    ],
    padEntries: [
      { attribute: 'thru_hole', title: 'Through hole:', quantity: 0 },
      { attribute: 'smd', title: 'SMD:', quantity: 0 },
      { attribute: 'connect', title: 'Connector:', quantity: 0 },
      { attribute: 'np_thru_hole', title: 'NPTH:', quantity: 0 },
    ],
    padPropertyEntries: [
      { attribute: 'pad_prop_castellated', title: 'Castellated:', quantity: 0 },
      { attribute: 'pad_prop_pressfit', title: 'Press-fit:', quantity: 0 },
    ],
    viaEntries: [
      { attribute: 'through', title: 'Through vias:', quantity: 0 },
      { attribute: 'blind', title: 'Blind vias:', quantity: 0 },
      { attribute: 'buried', title: 'Buried vias:', quantity: 0 },
      { attribute: 'micro', title: 'Micro vias:', quantity: 0 },
    ],
    drillEntries: [],
  };
}

/** `FOOTPRINT::GetAttributes()`, the bits the footprint entries test. */
function footprintAttributeBits(fp: PcbFootprint): number {
  const attrs = fp.attributes ?? [];
  return (attrs.includes('through_hole') ? 0x0001 : 0) | (attrs.includes('smd') ? 0x0002 : 0);
}

/**
 * `FOOTPRINT::GetSide()`: the footprint's layer if any pad or graphic is on a
 * side-specific layer, otherwise undefined for `UNDEFINED_LAYER`.
 *
 * Footprint zones are the one source upstream consults that the board model
 * does not carry; a footprint whose *only* side-specific item is a zone would
 * be counted by KiCad and not here.
 */
function footprintSide(fp: PcbFootprint, copperLayers: readonly string[]): string | undefined {
  const sideSpecific = (layer: string): boolean =>
    isCopperLayerName(layer) || (SIDE_SPECIFIC_TECH_LAYERS as readonly string[]).includes(layer);

  for (const pad of fp.pads) {
    if (copperLayers.some((layer) => padIsOnLayer(pad, layer))) return fp.layer;
    if (SIDE_SPECIFIC_TECH_LAYERS.some((layer) => padIsOnLayer(pad, layer))) return fp.layer;
  }

  for (const s of fp.shapes) if (sideSpecific(s.layer)) return fp.layer;

  // Reference and Value are PCB_FIELDs and are not in the m_drawings deque
  // GetSide walks; only user text is.
  for (const t of fp.texts) if (t.kind === 'user' && sideSpecific(t.layer)) return fp.layer;

  return undefined;
}

/**
 * The area of a pad's hole, from `PAD::GetEffectiveHoleShape()`:
 * a stadium of `seg.Length() * width` plus one full circle of diameter `width`.
 *
 * The halving is C++ integer division on `VECTOR2I`, so an odd drill size loses
 * its last nanometre before the area is taken. The segment is also rotated to
 * the pad's orientation upstream, which rounds its endpoints to integers and so
 * can move its length by under a nanometre; that is below the resolution of any
 * number this feeds and is not reproduced.
 */
function padHoleArea(pad: PcbPad): number {
  const halfX = Math.trunc(pad.drill!.w / 2);
  const halfY = Math.trunc(pad.drill!.h / 2);

  const halfWidth = pad.drill!.oblong ? Math.min(halfX, halfY) : halfX;
  const halfLen = pad.drill!.oblong
    ? Math.hypot(halfX - halfWidth, halfY - halfWidth)
    : /* a round hole is a zero-length segment */ 0;

  const width = halfWidth * 2;
  return 2 * halfLen * width + Math.PI * 0.25 * width * width;
}

/**
 * `ComputeBoardStatistics`.
 *
 * Returns fresh data rather than resetting a caller's struct. That is a
 * deliberate difference: `ResetCounts` clears every field *except* the two
 * footprint densities, which are only ever assigned when there is an outline,
 * so a second run on a board whose outline has since been broken keeps showing
 * the previous board's densities. Densities are not computed here at all, so
 * there is no stale value to carry — see the module note on what is left out.
 */
export function computeBoardStatistics(
  board: Board,
  options: BoardStatisticsOptions = DEFAULT_BOARD_STATISTICS_OPTIONS,
): BoardStatisticsData {
  const data = initialiseBoardStatisticsData();
  const copperLayers = enabledCopperLayers(board);

  for (const fp of board.footprints) {
    if (options.excludeFootprintsWithoutPads && fp.pads.length === 0) continue;

    const attributes = footprintAttributeBits(fp);

    for (const entry of data.footprintEntries) {
      if ((attributes & entry.attributeMask) === entry.attributeValue) {
        const side = footprintSide(fp, copperLayers);
        if (side === 'F.Cu') entry.frontCount++;
        else if (side === 'B.Cu') entry.backCount++;

        break;
      }
    }

    // `updatePadCounts` runs per footprint, inside the exclusion test — which
    // costs nothing, since the only footprints excluded have no pads.
    for (const pad of fp.pads) {
      for (const padEntry of data.padEntries) {
        if (pad.type === padEntry.attribute) {
          padEntry.quantity++;
          break;
        }
      }

      for (const propEntry of data.padPropertyEntries) {
        if (pad.padProperty === propEntry.attribute) {
          propEntry.quantity++;
          break;
        }
      }
    }
  }

  // Only PCB_TRACE_T narrows the minimum: a curved track is not a candidate,
  // however thin it is. Upstream tests the type before the `IsType` filter that
  // admits arcs and vias, and that ordering is the whole behaviour.
  for (const track of board.tracks) data.minTrackWidth = Math.min(data.minTrackWidth, track.width);

  for (const via of board.vias) {
    for (const entry of data.viaEntries) {
      if (via.kind === entry.attribute) {
        entry.quantity++;
        break;
      }
    }
  }

  data.drillEntries = collectDrillLineItems(board);

  // `DRILL_LINE_ITEM::COMPARE( COL_COUNT, false )` — descending by quantity.
  data.drillEntries.sort((a, b) => b.qty - a.qty);

  for (const drill of data.drillEntries) {
    if (drill.shape === 'circle') data.minDrillSize = Math.min(data.minDrillSize, drill.xSize);
  }

  const outlines = getBoardPolygonOutlines(board);
  data.hasOutline = outlines.success;

  if (data.hasOutline) {
    for (const polygon of outlines.polygons) {
      data.boardArea += contourArea(polygon.outline);

      if (options.subtractHolesFromBoardArea) {
        for (const hole of polygon.holes) data.boardArea -= contourArea(hole);

        // Upstream nests these two loops inside the per-outline loop, so a
        // board with N outlines subtracts every drilled hole N times. Kept.
        for (const fp of board.footprints) {
          for (const pad of fp.pads) {
            if (!padHasHole(pad)) continue;
            data.boardArea -= padHoleArea(pad);
          }
        }

        // Note this one has no `drill > 0` guard: a via is subtracted whatever
        // its drill says.
        for (const via of board.vias) data.boardArea -= Math.PI * 0.25 * via.drill * via.drill;
      }
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const polygon of outlines.polygons) {
      for (const p of polygon.outline) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }

    if (Number.isFinite(minX)) {
      data.boardWidth = maxX - minX;
      data.boardHeight = maxY - minY;
    }
  }

  return data;
}
