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
import {
  booleanIntersection,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import { ErrorLoc } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { buildBoardPolygonOutlines } from './convert_shape_list_to_polygon_legacy.js';
import { padTransformShapeToPolygon } from './transform_shape_to_polygon.js';
import { padIsOnLayer } from './pad_enumerate.js';
import { copperRank, enabledCopperLayers } from './swap_layers.js';
import type { Board, PcbFootprint, PcbPad, PcbVia } from './types.js';

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
export const SIDE_SPECIFIC_TECH_LAYERS = [
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
export function padHasHole(pad: PcbPad): boolean {
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

/**
 * `BOARD::GetBoardPolygonOutlines( polySet, false )` — `BuildBoardPolygonOutlines`
 * in `pcbnew/convert_shape_list_to_polygon.ts`, with the board's
 * `m_MaxError` (the design-settings value the caller has; ARC_HIGH_DEF when
 * none is given) and the default chaining epsilon.
 *
 * `success` starts false and only `doConvertOutlineToPolygon` sets it, so a
 * board with nothing on Edge.Cuts answers false and no polygons.
 */
export function getBoardPolygonOutlines(
  board: Board,
  maxError: number = BOARD_MAX_ERROR,
): BoardPolygonOutlines {
  // `isCopperOutside`: a pad whose effective polygon has no intersection
  // with the footprint's own closed outline.
  const copperOutside = (fp: PcbFootprint) => (outline: Polygon[]) => {
    for (const pad of fp.pads) {
      const padPoly = padTransformShapeToPolygon(pad, 0, maxError, ErrorLoc.ERROR_INSIDE);
      if (padPoly.length === 0) continue;
      if (booleanIntersection(outline, padPoly).length === 0) return true;
    }
    return false;
  };
  const r = buildBoardPolygonOutlines(
    board.shapes,
    board.footprints.map((fp) => ({ shapes: fp.shapes ?? [], copperOutside: copperOutside(fp) })),
    maxError,
    BOARD_CHAINING_EPSILON,
  );
  return {
    success: r.success,
    polygons: r.polygons.map((rings) => ({ outline: rings[0]!, holes: rings.slice(1) })),
  };
}

/**
 * `SHAPE_LINE_CHAIN::Area( true )`, upstream's formula verbatim including the
 * absolute value that hides the winding direction — which is why a cutout drawn
 * the same way round as its outline still subtracts.
 */
export function contourArea(pts: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    area += (pts[j]!.x + pts[i]!.x) * (pts[j]!.y - pts[i]!.y);

  return Math.abs(area * 0.5);
}
