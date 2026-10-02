// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_GRID_HELPER` — `pcbnew/tools/pcb_grid_helper.{h,cpp}`, a subclass of
 * the one `GRID_HELPER` in `common/tool/grid_helper.ts`, exactly as upstream
 * derives it. The grid round, the auxiliary axis, the snap/grid enables and the
 * anchor list are the base's; this file adds only what pcbnew adds.
 *
 * This is the piece that decides **where the cursor actually lands**. Without
 * it every cursor position in the editor is `computeNearest` and nothing else,
 * so hovering a track puts the crosshair on the grid node above or below the
 * track rather than on the track: it can only ever sit on the copper when the
 * copper happens to lie on a grid line. `TOOL_BASE::snapToItem`
 * (`router/pns_tool_base.ts`) calls {@link PCB_GRID_HELPER.AlignToSegment} and
 * {@link PCB_GRID_HELPER.AlignToArc} for exactly that.
 *
 * ### What is ported here
 *
 * - `AlignToSegment` (cpp:350-402) — the cursor on a track centreline.
 * - `AlignToArc` (cpp:405-447) — the same for a curved track.
 *
 * - `BestSnapAnchor` (cpp:597-934) and `BestDragOrigin` (cpp:507-565), with
 *   the `computeAnchors` passes behind them, over the plain `Board` rather than
 *   `BOARD_ITEM`s: an anchor's `items` list is empty, and item ids stand in for
 *   the `aSkip` / selection pointers. `nearestAnchor` is pcbnew's own.
 *
 * One thing worth recording from reading it, because it is easy to assume
 * otherwise: pcbnew's *general* crosshair does **not** stick to the middle of a
 * track. A track contributes its two ends as `CORNER | SNAPPABLE` anchors and
 * its midpoint as `ORIGIN` — deliberately without `SNAPPABLE` (cpp:1796-1808) —
 * and `BestSnapAnchor` only ever considers `SNAPPABLE` ones. Mid-track
 * stickiness is specifically a router behaviour, which is why it lives behind
 * `snapToItem` and not in the anchor list.
 *
 * ### The grid selector
 *
 * `Align( aPoint, GRID_HELPER_GRIDS )` picks a per-item-type grid, but
 * `PCB_GRID_HELPER::GetGridSize` (cpp:986-1035) returns the GAL's current grid
 * for every selector unless `GRID_SETTINGS::overrides_enabled` is set, and it is
 * off by default. We have no per-type grid overrides in board settings, so the
 * base's `GetGridSize` (one grid for every selector) *is* upstream's behaviour
 * here rather than a simplification of it.
 *
 * ### No `TOOL_MANAGER`
 *
 * The editor has no `VIEW`/`GAL` for the base to read the grid off, so it is
 * fed through the base's manual setters (`SetGridSize`, `SetOrigin`, ...) from
 * a {@link PcbGridState} — see {@link PCB_GRID_HELPER.SetState}.
 */

import {
  segIntersectLines,
  segNearestPoint,
  segSquaredDistanceToPoint,
} from '@ziroeda/kimath/src/geometry/seg.js';
import { circleIntersectLine } from '@ziroeda/kimath/src/geometry/circle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { type ANCHOR, ANCHOR_FLAGS, GRID_HELPER } from '@ziroeda/common/tool/grid_helper.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { CONSTRUCTION_GEOM_DRAWABLE } from '@ziroeda/common/preview_items/construction_geom.js';
import {
  type CONSTRUCTION_ITEM_BATCH,
  CONSTRUCTION_MANAGER_SOURCE,
} from '@ziroeda/common/tool/construction_manager.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import { HALF_LINE } from '@ziroeda/kimath/src/geometry/half_line.js';
import { LINE } from '@ziroeda/kimath/src/geometry/line.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import {
  INTERSECTION_VISITOR,
  type INTERSECTABLE_GEOM,
} from '@ziroeda/kimath/src/geometry/intersection.js';
import {
  GetNearestPoint,
  GetNearestPointOfAny,
  type NEARABLE_GEOM,
} from '@ziroeda/kimath/src/geometry/nearest.js';
import {
  PT_CENTER,
  PT_CORNER,
  PT_END,
  PT_INTERSECTION,
  PT_MID,
  PT_NONE,
  PT_ON_ELEMENT,
  PT_QUADRANT,
  TYPED_POINT2I,
} from '@ziroeda/kimath/src/geometry/point_types.js';
import { BOX2ISafe } from '@ziroeda/kimath/src/math/box2.js';
import { KIGEOM_GetOvalKeyPoints, OVAL_KEY_POINTS } from '@ziroeda/kimath/src/geometry/oval.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { LAYER_ITEM_PAIR } from '@ziroeda/common/view/view.js';
import {
  GAL_LAYER_ID,
  IsCopperLayer,
  IsInnerCopperLayer,
  IsPcbLayer,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { PAD_SHAPE, PADSTACK, PADSTACK_MODE } from '../padstack.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_ARC, PCB_TRACK } from '../pcb_track.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { ZONE } from '../zone.js';
import type {
  PCB_DIM_ALIGNED,
  PCB_DIM_CENTER,
  PCB_DIM_LEADER,
  PCB_DIM_RADIAL,
} from '../pcb_dimension.js';
import type { PCB_BARCODE } from '../pcb_barcode.js';
import type { PCB_GROUP } from '../pcb_group.js';
import type { Board, PcbBarcode, PcbShape } from '../types.js';
import { parseBoardItemId, rotatePcb } from '../edit-board.js';
import { footprintBBox, padBBox } from '../edit-footprint.js';
import { barcodeGeometry, type BarcodeGeometry } from '../pcb_io/kicad_sexpr/board_view.js';
import type { BOARD_ITEM } from '../board_item.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  KIGEOM_BoxToSegs,
  KIGEOM_GetCircleKeyPoints,
} from '@ziroeda/kimath/src/geometry/shape_utils.js';
import type { PCB_REFERENCE_IMAGE } from '../pcb_reference_image.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PAD } from '../pad.js';
import type { MAGNETIC_SETTINGS } from '../pcbnew_settings.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { MAGNETIC_OPTIONS } from '../pcbnew_settings.js';
import { arcSliceContainsPoint } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import { arcCenterI } from '@ziroeda/kimath/src/geometry/shape_arc.js';

/** `SEG`, and the shape every segment type in this tree already has. */
export interface GridSeg {
  a: Vec2;
  b: Vec2;
}

/**
 * The `GRID_HELPER` state the ported methods read, as plain data.
 *
 * Upstream these come off the GAL and the tool event: `GetGrid()`,
 * `GetOrigin()`, `canUseGrid()` (which is `m_enableGrid` AND the GAL's grid
 * snapping) and `m_enableSnap` (cleared while Shift is held —
 * `TOOL_BASE::updateEndItem` does `SetSnap( !aEvent.Modifier( MD_SHIFT ) )`).
 */
export interface PcbGridState {
  /** `GetGrid()`, in internal units. A single value; see the file comment. */
  size: number;
  /** `GetOrigin()` — the board's `(setup (grid_origin ...))`. */
  origin: Vec2;
  /** `canUseGrid()`. When false, `Align` returns the point untouched. */
  enableGrid: boolean;
  /** `GetSnap()` — false while Shift is held, which disables item snapping. */
  enableSnap: boolean;
  /**
   * `GRID_HELPER::m_auxAxis` — the point a gesture started from, which stays
   * reachable for the whole gesture even when it is nowhere near a grid line.
   *
   * This is what lets an off-grid item be put back exactly where it came from.
   * Every tool that moves something sets it to the gesture's origin and clears
   * it at the end: `ROUTER_TOOL` to `m_startSnapPoint` (router_tool.cpp:2190)
   * and to the inline-drag origin (:2654), `EDIT_TOOL` to `dragOrigin`
   * (edit_tool_move_fct.cpp:1401), `PCB_POINT_EDITOR` to the original position
   * (pcb_point_editor.cpp:2366).
   */
  auxAxis?: Vec2 | null;
}

/** `AlignToSegment`'s `c_gridSnapEpsilon_sq` (cpp:352). */
const GRID_SNAP_EPSILON_SQ = 4;

/** `VECTOR2I::ECOORD_MAX`, the "nothing found yet" distance. */
const ECOORD_MAX = Number.MAX_SAFE_INTEGER;

/** `VECTOR2I::SquaredEuclideanNorm()` of `a - b`. */
const squaredDist = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return dx * dx + dy * dy;
};

/** The four rays `AlignToSegment` / `AlignToArc` shoot from the aligned cursor. */
const testSegmentsFrom = (aligned: Vec2): GridSeg[] => [
  { a: aligned, b: { x: aligned.x + 1, y: aligned.y } },
  { a: aligned, b: { x: aligned.x, y: aligned.y + 1 } },
  { a: aligned, b: { x: aligned.x + 1, y: aligned.y + 1 } },
  { a: aligned, b: { x: aligned.x + 1, y: aligned.y - 1 } },
];

/**
 * The two "nearest" loops both methods end with (cpp:377-399, :425-444).
 *
 * Note they measure from **different** points: the ends are scored against the
 * raw pointer `aPoint`, the intersections against the grid-aligned `aligned`,
 * and both are compared against the same running minimum. That is upstream as
 * written, and it is what makes the ends win when the pointer is genuinely near
 * one while still letting a mid-span intersection beat an end that the grid
 * round has pulled away from.
 */
function nearestOf(
  aPoint: Vec2,
  aligned: Vec2,
  aEnds: readonly Vec2[],
  aPoints: readonly Vec2[],
): Vec2 {
  let nearest = aligned;
  let minDistSq = ECOORD_MAX;

  // Snap by distance between pointer and endpoints
  for (const pt of aEnds) {
    const dSq = squaredDist(pt, aPoint);

    if (dSq < minDistSq) {
      minDistSq = dSq;
      nearest = pt;
    }
  }

  // Snap by distance between aligned cursor and intersections
  for (const pt of aPoints) {
    const dSq = squaredDist(pt, aligned);

    if (dSq < minDistSq) {
      minDistSq = dSq;
      nearest = pt;
    }
  }

  return nearest;
}

/** `SHAPE_ARC::GetP0()` / `GetP1()`, from the shape this tree stores. */
const arcPointAt = (aArc: GridArc, aAngle: number): Vec2 => ({
  x: aArc.c.x + aArc.rad * Math.cos(aAngle),
  y: aArc.c.y + aArc.rad * Math.sin(aAngle),
});

/** `SHAPE_ARC`, as `Shape`'s arc member spells it. */
export interface GridArc {
  c: Vec2;
  rad: number;
  a0: number;
  sweep: number;
}

const TAU = 2 * Math.PI;
const normTau = (a: number): number => ((a % TAU) + TAU) % TAU;

/**
 * `SHAPE_ARC( aStart, aMid, aEnd, aWidth )` reduced to the slice.
 *
 * A curved track is stored as three points, and `PCB_ARC::Shape()` builds a
 * `SHAPE_ARC` from them; {@link PCB_GRID_HELPER.AlignToArc} wants centre and sweep. The sweep's
 * sign is whichever direction puts the mid point inside it, which is the whole
 * reason the mid point is stored rather than just the two ends.
 *
 * Three collinear points have no centre, and `CalcArcCenter` answers with one
 * clamped to the coordinate limit rather than an error — so the arc comes back
 * with a radius near `INT_MAX`. That is upstream's shape, and upstream catches
 * it downstream instead: `SHAPE_ARC::IntersectLine` (`shape_arc.cpp:346`)
 * refuses any arc whose radius reaches `INT_MAX / 2`, which {@link PCB_GRID_HELPER.AlignToArc}
 * mirrors. Null here is only for a centre that is not a number at all.
 */
export function gridArcFromPoints(aStart: Vec2, aMid: Vec2, aEnd: Vec2): GridArc | null {
  const c = arcCenterI(aStart, aMid, aEnd);

  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;

  const rad = Math.hypot(aStart.x - c.x, aStart.y - c.y);

  if (!(rad > 0) || !Number.isFinite(rad)) return null;

  const a0 = Math.atan2(aStart.y - c.y, aStart.x - c.x);
  const spanCcw = normTau(Math.atan2(aEnd.y - c.y, aEnd.x - c.x) - a0);
  const midCcw = normTau(Math.atan2(aMid.y - c.y, aMid.x - c.x) - a0);

  return { c, rad, a0, sweep: midCcw <= spanCcw ? spanCcw : spanCcw - TAU };
}

// ---------------------------------------------------------------------------
// `PCB_GRID_HELPER::BestSnapAnchor` — the *other* cursor.
//
// The router asks "where on this item"; every other tool that snaps asks "what
// is near the cursor at all". The two answer differently on purpose, and the
// difference is the thing that surprises people: `snapToItem` rides a track's
// centreline, while `BestSnapAnchor` will not, because a track contributes its
// two ends as `CORNER | SNAPPABLE` anchors and its midpoint as `ORIGIN`
// deliberately *without* `SNAPPABLE` (cpp:1796-1808) — and only snappable
// anchors are weighed. Mid-track centring outside the router happens in exactly
// one case, and it is the case below where the grid is switched off.
// ---------------------------------------------------------------------------

export interface BestSnapOptions {
  /**
   * `view->ToWorld( 25 )` — the 25-screen-pixel snap radius in world units.
   * Upstream calls the constant `snapSize` (cpp:605).
   */
  snapScale: number;
  /** `GetVisibleGrid().x`, which clamps the snap radius when the grid is on. */
  visibleGrid: number;
  /** `view->ToWorld( ADVANCED_CFG::m_SnapHysteresis )`, 5 px by default. */
  hysteresis?: number;
  /** The active layer — `BestSnapAnchor`'s `aLayers`. */
  layer?: string;
  /** `MAGNETIC_SETTINGS::pads` / `::tracks`. */
  magneticPads?: MAGNETIC_OPTIONS;
  magneticTracks?: MAGNETIC_OPTIONS;
  /** `MAGNETIC_SETTINGS::allLayers`, which defeats the layer filter. */
  allLayers?: boolean;
  /**
   * `BestSnapAnchor`'s `aSkip`, as board item ids — the items whose anchors are
   * left out. `PCB_POINT_EDITOR` passes `{ item }` (pcb_point_editor.cpp:2594,
   * :2621, :2644) so a point being dragged cannot snap to the very shape it is
   * reshaping, which would pin it in place.
   */
  avoid?: ReadonlySet<string>;
  /**
   * `aSelectionFilter->points` — the Selection Filter's Points box, which
   * `computeAnchors` consults before adding a `PCB_POINT`'s anchor
   * (`pcb_grid_helper.cpp:1610-1611`, `:1790-1796`). Absent means on, as the
   * filter defaults.
   */
  points?: boolean;
  /**
   * `aSelectionFilter->otherItems`, which gates a barcode's anchors
   * (`pcb_grid_helper.cpp:1916-1917`). A barcode is not in the Graphics
   * category — `pcb_selection_tool.cpp:3522` puts it in the catch-all with
   * targets. Absent means on.
   */
  otherItems?: boolean;
}

/** `LSET` membership for the wildcard layer names a pad carries (`*.Cu`). */
export function layerMatches(aItemLayer: string, aLayer: string): boolean {
  if (aItemLayer === aLayer) return true;

  return aItemLayer.startsWith('*.') && aLayer.endsWith(aItemLayer.slice(1));
}

// ---------------------------------------------------------------------------
// `PCB_GRID_HELPER::BestDragOrigin` — where a move measures itself *from*.
//
// This is the half of a move that decides whether two parts can ever be lined
// up with each other, and it is not obvious from the name. A move does not
// translate the selection by the cursor's travel; it picks an anchor **on the
// selection** (`aFrom = true`, so a footprint offers its own origin), warps the
// pointer onto it — "Warp mouse to origin of moved object", `warp_mouse_on_move`,
// which `common_settings.cpp:255` defaults to **true** — and from then on
// `EDIT_TOOL::Move` only ever writes
//
//     movement = BestSnapAnchor( mousePos ) - prevPos
//
// with `prevPos` starting at that anchor (edit_tool_move_fct.cpp:1311-1351).
// The anchor therefore lands *absolutely* on whatever `BestSnapAnchor` returns
// — a grid node, another footprint's pad — rather than being carried along at
// whatever sub-grid offset it happened to have. Two footprints dragged in the
// same session both end up on grid nodes, which is the whole of "it aligns
// itself" that KiCad feels like and a delta-based move can never reproduce:
// quantising the *travel* preserves the original offset exactly.
//
// A browser cannot warp the pointer, and it does not have to. With the warp,
// upstream's mouse position for the rest of the gesture is the anchor plus the
// motion since the grab, so adding that motion to the anchor and snapping the
// result is the same number by construction.
//
// Note there is no snap radius here: unlike `BestSnapAnchor` this takes the
// nearest anchor however far away it is, because the selection is being grabbed
// and must always have a reference point (upstream falls back to the mouse
// position only when the selection contributes no anchors at all).
// ---------------------------------------------------------------------------

/** `computeAnchors`'s `aFrom = true` inputs that the editor has to supply. */
export interface DragOriginOptions {
  /**
   * `GetGrid()` in internal units — read only by the footprint rule that adds
   * the bounding-box centre as a second anchor when it is more than a grid step
   * away from the footprint's own origin (pcb_grid_helper.cpp:1645-1646).
   */
  gridSize: number;
  /**
   * `view->ToWorld( 50 )`, upstream's `lineSnapMinCornerDistance` (cpp:518).
   * An OUTLINE anchor may only beat a corner/origin one that is further away
   * than this. No item type collects OUTLINE anchors with `aFrom = true`, so
   * this changes nothing today and is here because it is the rule.
   */
  lineSnapMinCornerDistance?: number;
}

/**
 * `addRectPoints( barcode->GetSymbolPoly().BBox(), … )`
 * (`pcb_grid_helper.cpp:1479-1502`): the box's centre, its four corners and
 * the midpoint of each of its four edges.
 *
 * The box is the *symbol's*, taken before the rotation is applied to `m_poly`,
 * so the nine points turn with the barcode rather than boxing it upright.
 */
function barcodeSnapPoints(g: BarcodeGeometry, bc: PcbBarcode): Vec2[] {
  if (g.symbolPoly.length === 0) return [];

  const b = symbolPolyBox(g.symbolPoly);
  const turn = (p: Vec2): Vec2 => {
    if (bc.angle === 0) return p;
    const r = rotatePcb({ x: p.x - bc.at.x, y: p.y - bc.at.y }, bc.angle);
    return { x: r.x + bc.at.x, y: r.y + bc.at.y };
  };

  const tl = { x: b.x1, y: b.y1 };
  const tr = { x: b.x2, y: b.y1 };
  const br = { x: b.x2, y: b.y2 };
  const bl = { x: b.x1, y: b.y2 };
  const mid = (a: Vec2, c: Vec2): Vec2 => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });

  return [
    mid(tl, br), // the box centre
    tl,
    mid(tl, tr),
    tr,
    mid(tr, br),
    br,
    mid(br, bl),
    bl,
    mid(bl, tl),
  ].map(turn);
}

const symbolPolyBox = (
  poly: readonly (readonly (readonly Vec2[])[])[],
): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} => {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;

  for (const rings of poly)
    for (const ring of rings)
      for (const p of ring) {
        if (p.x < x1) x1 = p.x;
        if (p.y < y1) y1 = p.y;
        if (p.x > x2) x2 = p.x;
        if (p.y > y2) y2 = p.y;
      }

  return { x1, y1, x2, y2 };
};

/** `shape.GetCenter()` for a circle or a rectangle. */
function shapeCenter(aShape: PcbShape): Vec2 | null {
  if (aShape.kind === 'circle') {
    const c = aShape.center ?? aShape.start;
    return c ? { ...c } : null;
  }

  if (aShape.kind === 'rect' && aShape.start && aShape.end)
    return {
      x: Math.trunc((aShape.start.x + aShape.end.x) / 2),
      y: Math.trunc((aShape.start.y + aShape.end.y) / 2),
    };

  return null;
}

/** The `PCB_SELECTION_FILTER_OPTIONS` members `computeAnchors` reads. */
export interface SELECTION_FILTER_LIKE {
  pads: boolean;
  text: boolean;
  graphics: boolean;
  tracks: boolean;
  vias: boolean;
  zones: boolean;
  dimensions: boolean;
  points: boolean;
  footprints: boolean;
  otherItems: boolean;
}

/**
 * `GetBoardIntersectable( const BOARD_ITEM& )` (cpp:73-112): the idealised
 * geometry - a zero-width line, circle, arc or box - of a graphic shape, a
 * track, an arc or a reference image.
 */
export function GetBoardIntersectable(aItem: BOARD_ITEM): INTERSECTABLE_GEOM | null {
  switch (aItem.Type()) {
    case KICAD_T.PCB_SHAPE_T: {
      const shape = aItem as unknown as PCB_SHAPE;

      switch (shape.GetShape()) {
        case SHAPE_T.SEGMENT:
          return new SEG(shape.GetStart(), shape.GetEnd());
        case SHAPE_T.CIRCLE:
          return new CIRCLE(shape.GetCenter(), shape.GetRadius());
        case SHAPE_T.ARC:
          return new SHAPE_ARC(shape.GetStart(), shape.GetArcMid(), shape.GetEnd(), 0);
        case SHAPE_T.RECTANGLE:
          return BOX2I.ByCorners(shape.GetStart(), shape.GetEnd());
        default:
          break;
      }

      break;
    }

    case KICAD_T.PCB_TRACE_T: {
      const track = aItem as unknown as PCB_TRACK;
      return new SEG(track.GetStart(), track.GetEnd());
    }

    case KICAD_T.PCB_ARC_T: {
      const arc = aItem as unknown as PCB_ARC;
      return new SHAPE_ARC(arc.GetStart(), arc.GetMid(), arc.GetEnd(), 0);
    }

    case KICAD_T.PCB_REFERENCE_IMAGE_T:
      return (aItem as unknown as PCB_REFERENCE_IMAGE).GetBoundingBox();

    default:
      break;
  }

  return null;
}

/**
 * `PadstackUniqueLayerAppliesToLayer` (cpp:1272-1307): whether one of a
 * padstack's unique layers stands for a given real layer.
 */
function PadstackUniqueLayerAppliesToLayer(
  aPadStack: PADSTACK,
  aPadstackUniqueLayer: PCB_LAYER_ID,
  aRealLayer: PCB_LAYER_ID,
): boolean {
  switch (aPadStack.Mode()) {
    case PADSTACK_MODE.NORMAL:
      // Normal mode padstacks are the same on every layer, so they'll apply to any
      // "real" copper layer.
      return IsCopperLayer(aRealLayer);

    case PADSTACK_MODE.FRONT_INNER_BACK:
      switch (aPadstackUniqueLayer) {
        case PCB_LAYER_ID.F_Cu:
        case PCB_LAYER_ID.B_Cu:
          // The outer-layer unique layers only apply to those exact "real" layers
          return aPadstackUniqueLayer === aRealLayer;
        case PADSTACK.INNER_LAYERS:
          // But the inner layers apply to any inner layer
          return IsInnerCopperLayer(aRealLayer);
        default:
          break;
      }

      break;

    case PADSTACK_MODE.CUSTOM:
      // Custom modes are unique per layer, so it's 1:1
      return aRealLayer === aPadstackUniqueLayer;
  }

  return false;
}

export class PCB_GRID_HELPER extends GRID_HELPER {
  /** The board the last query ran over - upstream's `m_toolMgr->GetModel()`. */
  private m_board: Board | null = null;

  /** `m_pointOnLineCandidates` (pcb_grid_helper.h:165). */
  private m_pointOnLineCandidates: NEARABLE_GEOM[] = [];

  /**
   * Stand-ins for `BOARD_ITEM*`: one stable object per board item id, so that
   * an `ANCHOR`'s items, a `CONSTRUCTION_ITEM`'s `Item` and the construction
   * manager's involved-items set all compare by identity, as pointers do.
   */
  private m_itemTokens = new Map<string, EDA_ITEM>();

  private itemToken(aId: string): EDA_ITEM[] {
    let token = this.m_itemTokens.get(aId);

    if (!token) {
      token = { boardItemId: aId } as unknown as EDA_ITEM;
      this.m_itemTokens.set(aId, token);
    }

    return [token];
  }

  private itemIdOf(aItem: EDA_ITEM | null): string | undefined {
    return (aItem as unknown as { boardItemId?: string } | null)?.boardItemId;
  }

  /**
   * `GetBoardIntersectable` (cpp:73-112): the idealised geometry of a graphic
   * shape, a track or an arc on the board last queried.
   */
  private intersectableOf(aId: string | undefined): INTERSECTABLE_GEOM | null {
    const board = this.m_board;
    const ref = aId === undefined ? null : parseBoardItemId(aId);

    if (!board || !ref) return null;

    if (ref.kind === 'track') {
      const t = board.tracks[ref.index];
      return t ? new SEG(t.start, t.end) : null;
    }

    if (ref.kind === 'arc') {
      const a = board.arcs[ref.index];
      return a ? new SHAPE_ARC(a.start, a.mid, a.end, 0) : null;
    }

    if (ref.kind !== 'shape') return null;

    const s = board.shapes[ref.index];

    if (!s) return null;

    switch (s.kind) {
      case 'line':
        return s.start && s.end ? new SEG(s.start, s.end) : null;
      case 'circle': {
        const c = s.center ?? s.start;
        return c && s.end ? new CIRCLE(c, KiROUND(Math.hypot(s.end.x - c.x, s.end.y - c.y))) : null;
      }
      case 'arc':
        return s.start && s.mid && s.end ? new SHAPE_ARC(s.start, s.mid, s.end, 0) : null;
      case 'rect':
        return s.start && s.end ? BOX2I.ByCorners(s.start, s.end) : null;
      default:
        return null;
    }
  }

  /** `m_magneticSettings->allLayers || ( aLayers & item->GetLayerSet() ).any()`. */
  private itemOnLayers(aBoard: Board, aId: string, aOpts: BestSnapOptions): boolean {
    if (aOpts.allLayers || !aOpts.layer) return true;

    const ref = parseBoardItemId(aId);
    const layer =
      ref?.kind === 'track'
        ? aBoard.tracks[ref.index]?.layer
        : ref?.kind === 'arc'
          ? aBoard.arcs[ref.index]?.layer
          : ref?.kind === 'shape'
            ? aBoard.shapes[ref.index]?.layer
            : undefined;

    return layer === undefined || layerMatches(layer, aOpts.layer);
  }

  /** The shapes, tracks and arcs `queryVisible` returns round the cursor, as ids. */
  private queryIntersectableIds(
    aBoard: Board,
    aWhere: Vec2,
    aRange: number,
    aOpts: BestSnapOptions,
  ): string[] {
    const ids: string[] = [];
    const near = (pts: readonly (Vec2 | undefined)[], pad: number): boolean => {
      let x1 = Number.POSITIVE_INFINITY;
      let y1 = Number.POSITIVE_INFINITY;
      let x2 = Number.NEGATIVE_INFINITY;
      let y2 = Number.NEGATIVE_INFINITY;

      for (const p of pts) {
        if (!p) continue;
        x1 = Math.min(x1, p.x);
        y1 = Math.min(y1, p.y);
        x2 = Math.max(x2, p.x);
        y2 = Math.max(y2, p.y);
      }

      return (
        x1 - pad <= aWhere.x + aRange &&
        x2 + pad >= aWhere.x - aRange &&
        y1 - pad <= aWhere.y + aRange &&
        y2 + pad >= aWhere.y - aRange
      );
    };
    const take = (id: string, box: boolean): void => {
      if (aOpts.avoid?.has(id)) return;
      if (!this.itemOnLayers(aBoard, id, aOpts)) return;
      if (box) ids.push(id);
    };

    aBoard.tracks.forEach((t, i) => take(`track:${i}`, near([t.start, t.end], t.width / 2)));
    aBoard.arcs.forEach((a, i) => {
      const arc = new SHAPE_ARC(a.start, a.mid, a.end, 0);
      const bb = arc.BBox();
      take(
        `arc:${i}`,
        near(
          [
            { x: bb.GetLeft(), y: bb.GetTop() },
            { x: bb.GetRight(), y: bb.GetBottom() },
          ],
          a.width / 2,
        ),
      );
    });
    aBoard.shapes.forEach((s, i) => {
      const geom = this.intersectableOf(`shape:${i}`);

      if (!geom) return;

      if (geom instanceof CIRCLE) {
        const c = geom.Center;
        const r = geom.Radius;
        take(
          `shape:${i}`,
          near(
            [
              { x: c.x - r, y: c.y - r },
              { x: c.x + r, y: c.y + r },
            ],
            s.width / 2,
          ),
        );
      } else if (geom instanceof SHAPE_ARC) {
        const bb = geom.BBox();
        take(
          `shape:${i}`,
          near(
            [
              { x: bb.GetLeft(), y: bb.GetTop() },
              { x: bb.GetRight(), y: bb.GetBottom() },
            ],
            s.width / 2,
          ),
        );
      } else {
        take(`shape:${i}`, near([s.start, s.end], s.width / 2));
      }
    });

    return ids;
  }

  /**
   * `item->HitTest( aOrigin, 0 )` over the items round the cursor (cpp:866-882):
   * the first whose outline - its geometry widened by half its width - holds
   * the cursor.
   */
  private hoverHit(
    aBoard: Board,
    aWhere: Vec2,
    aRange: number,
    aOpts: BestSnapOptions,
  ): string | null {
    for (const id of this.queryIntersectableIds(aBoard, aWhere, aRange, aOpts)) {
      const geom = this.intersectableOf(id);
      const ref = parseBoardItemId(id);

      if (!geom || !ref) continue;

      const width =
        ref.kind === 'track'
          ? (aBoard.tracks[ref.index]?.width ?? 0)
          : ref.kind === 'arc'
            ? (aBoard.arcs[ref.index]?.width ?? 0)
            : (aBoard.shapes[ref.index]?.width ?? 0);
      const p = GetNearestPoint(geom, aWhere);

      if (Math.hypot(p.x - aWhere.x, p.y - aWhere.y) <= width / 2) return id;
    }

    return null;
  }

  /**
   * The construction-geometry half of `computeAnchors( aItems, … )`
   * (cpp:1188-1300): the items' intersectables and the construction manager's
   * geometry, free points as `SNAPPABLE | CONSTRUCTED` anchors, every crossing
   * between two different items' geometry as a `PT_INTERSECTION` anchor, and
   * the geometry kept as `m_pointOnLineCandidates`.
   */
  private computeConstructionAnchors(aIds: readonly string[]): void {
    const intersectables: { item: EDA_ITEM | null; geom: INTERSECTABLE_GEOM }[] = [];

    for (const id of aIds) {
      const geom = this.intersectableOf(id);

      if (geom) intersectables.push({ item: this.itemToken(id)[0]!, geom });
    }

    for (const batch of this.getSnapManager().GetConstructionItems()) {
      for (const constructionItem of batch) {
        for (const drawable of constructionItem.Constructions) {
          const d = drawable.Drawable;

          if (
            d instanceof LINE ||
            d instanceof CIRCLE ||
            d instanceof HALF_LINE ||
            d instanceof SHAPE_ARC
          ) {
            intersectables.push({ item: constructionItem.Item, geom: d });
          } else if (!(d instanceof SEG)) {
            // Add any free-floating points as snap points.
            this.addAnchor(
              { x: d.x, y: d.y },
              ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.CONSTRUCTED,
              constructionItem.Item ? [constructionItem.Item] : [],
              PT_NONE,
            );
          }
        }
      }
    }

    for (let ii = 0; ii < intersectables.length; ++ii) {
      const a = intersectables[ii]!;

      for (let jj = ii + 1; jj < intersectables.length; ++jj) {
        const b = intersectables[jj]!;

        // An item and its own extension will often have intersections (as they
        // are on top of each other), but they not useful points to snap to
        if (a.item === b.item) continue;

        const intersections: Vec2[] = [];
        new INTERSECTION_VISITOR(a.geom, intersections).visit(b.geom);

        for (const intersection of intersections) {
          this.addAnchor(
            intersection,
            ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.CONSTRUCTED,
            [a.item, b.item].filter((it): it is EDA_ITEM => it !== null),
            PT_INTERSECTION,
          );
        }
      }
    }

    this.m_pointOnLineCandidates = intersectables.map((it) => it.geom);
  }

  /**
   * `PCB_GRID_HELPER()` — no `TOOL_MANAGER`, so the grid comes through the
   * base's manual setters; `aState`, when given, is applied at once.
   */
  constructor(aState?: PcbGridState);
  /**
   * `PCB_GRID_HELPER( TOOL_MANAGER* aToolMgr, MAGNETIC_SETTINGS* aMagneticSettings )`:
   * the grid, its origin and snapping come from the view, as upstream.
   */
  constructor(aToolMgr: TOOL_MANAGER, aMagneticSettings: MAGNETIC_SETTINGS | null);
  constructor(a?: PcbGridState | TOOL_MANAGER, aMagneticSettings: MAGNETIC_SETTINGS | null = null) {
    const toolMgr = a && 'GetView' in a ? a : null;

    super(toolMgr);

    this.m_magneticSettings = aMagneticSettings;

    if (a && !toolMgr) this.SetState(a as PcbGridState);
  }

  /** `m_magneticSettings`, when constructed on a tool manager. */
  private m_magneticSettings: MAGNETIC_SETTINGS | null;

  /**
   * Load one event's {@link PcbGridState} into the base: `SetGridSize` /
   * `SetOrigin` for the GAL values, `SetUseGrid` and `SetSnap` for the two
   * flags a tool pokes per event, and `SetAuxAxes` for the gesture origin.
   *
   * A grid of zero or less is treated as grid snapping off. Upstream cannot
   * reach that state — a GAL grid is always positive — and without the guard
   * `computeNearest` would divide by it; with the grid off `Align` returns the
   * point untouched, which is what this port's old guard answered too.
   */
  SetState(aState: PcbGridState): this {
    this.SetGridSize({ x: aState.size, y: aState.size });
    this.SetOrigin(aState.origin);
    this.SetGridSnapping(true);
    this.SetUseGrid(aState.enableGrid && aState.size > 0);
    this.SetSnap(aState.enableSnap);
    this.SetAuxAxes(!!aState.auxAxis, aState.auxAxis ?? { x: 0, y: 0 });

    return this;
  }

  /**
   * `PCB_GRID_HELPER::AlignToSegment` (cpp:350-402) — the cursor, on a track.
   *
   * Take the grid node nearest the pointer, shoot four rays from it along the
   * routing directions (horizontal, vertical, and both diagonals), and
   * intersect each with the track's **infinite** centreline. An intersection
   * is kept only if it is within `c_gridSnapEpsilon_sq` of the segment itself,
   * which is what discards the ones that land out on the line's extension
   * beyond the track. The winner is then the nearest of the two ends and those
   * intersections (see {@link nearestOf}).
   */
  AlignToSegment(aPoint: Vec2, aSeg: GridSeg): Vec2 {
    const aligned = this.Align(aPoint);

    if (!this.m_enableSnap) return aligned;

    const points: Vec2[] = [];

    for (const seg of testSegmentsFrom(aligned)) {
      const vec = segIntersectLines(aSeg, seg);

      if (vec && segSquaredDistanceToPoint(aSeg, vec) <= GRID_SNAP_EPSILON_SQ) points.push(vec);
    }

    return nearestOf(aPoint, aligned, [aSeg.a, aSeg.b], points);
  }

  /**
   * `PCB_GRID_HELPER::AlignToArc` (cpp:405-447).
   *
   * The same four rays as {@link AlignToSegment}, through
   * `SHAPE_ARC::IntersectLine` (`shape_arc.cpp:341`) — which is the circle's
   * intersection with the infinite line, filtered to the arc's angular slice.
   * That filter is why there is no epsilon test here: unlike the segment case,
   * the intersection routine has already thrown away everything off the arc.
   */
  AlignToArc(aPoint: Vec2, aArc: GridArc): Vec2 {
    const aligned = this.Align(aPoint);

    if (!this.m_enableSnap) return aligned;

    const points: Vec2[] = [];
    const slice = { ...aArc, halfWidth: 0 };

    // `SHAPE_ARC::IntersectLine` (`shape_arc.cpp:346-347`) returns nothing at
    // all for an arc this large. It is how the degenerate arc that
    // `CalcArcCenter` builds from three collinear points — centre clamped to
    // the coordinate limit — stops short of producing meaningless crossings.
    const degenerate = aArc.rad >= 2_147_483_647 / 2;

    for (const seg of degenerate ? [] : testSegmentsFrom(aligned)) {
      for (const ip of circleIntersectLine({ c: aArc.c, r: aArc.rad }, seg)) {
        if (arcSliceContainsPoint(slice, ip)) points.push(ip);
      }
    }

    return nearestOf(
      aPoint,
      aligned,
      [arcPointAt(aArc, aArc.a0), arcPointAt(aArc, aArc.a0 + aArc.sweep)],
      points,
    );
  }

  /**
   * The anchors the last `computeAnchors` pass collected — what upstream's
   * `PCBGridHelperTestFixture` (a friend class) reads off `m_anchors`.
   */
  GetAnchors(): readonly ANCHOR[] {
    return this.m_anchors;
  }

  /**
   * `PCB_GRID_HELPER::SnapToPad` (pcb_grid_helper.cpp:446): of the pads under the
   * mouse, the centre nearest it; the mouse position itself when none is hit.
   *
   * Each pad under the mouse goes through `computeAnchors( item, aMousePos, true )`
   * (`aFrom`, no selection filter), where a pad is visible only if the view
   * shows it, one of its layers is shown (or, in high contrast, active) and its
   * LOD is below the view's scale (`checkVisibility`, cpp:1338-1361), and then
   * contributes its position as an `ORIGIN | SNAPPABLE` anchor (`handlePadShape`,
   * cpp:1372; `aFrom` returns before the outline points).
   */
  /** `PCB_GRID_HELPER::GetSnapped` (pcb_grid_helper.cpp:933-944): the snapped anchor's first item. */
  GetSnapped(): BOARD_ITEM | null {
    if (!this.m_snapItem) return null;

    // The snap anchor doesn't have an item associated with it
    // (odd, could it be entirely made of construction geometry?)
    if (this.m_snapItem.items.length === 0) return null;

    return this.m_snapItem.items[0] as BOARD_ITEM;
  }

  SnapToPad(aMousePos: Vec2, aPads: readonly PAD[]): Vec2 {
    this.clearAnchors();

    const view = this.m_toolMgr!.GetView()!;
    const settings = view.GetPainter().GetSettings();
    const activeLayers = settings.GetHighContrastLayers();
    const isHighContrast = settings.GetHighContrast();

    const checkVisibility = (aItem: BOARD_ITEM): boolean => {
      // New moved items don't yet have view flags so VIEW will call them invisible
      if (!view.IsVisible(aItem) && !aItem.IsMoving()) return false;

      let onActiveLayer = !isHighContrast;
      let isLODVisible = false;

      for (const layer of aItem.GetLayerSet().Seq()) {
        if (!onActiveLayer && activeLayers.has(layer)) onActiveLayer = true;

        if (!isLODVisible && aItem.ViewGetLOD(layer, view) < view.GetScale()) isLODVisible = true;

        if (onActiveLayer && isLODVisible) return true;
      }

      return false;
    };

    for (const pad of aPads) {
      if (!pad.HitTest(aMousePos)) continue;

      if (checkVisibility(pad))
        this.addAnchor(pad.GetPosition(), ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE, [pad]);
    }

    let minDist = Number.MAX_VALUE;
    let nearestOrigin: ANCHOR | null = null;

    for (const a of this.m_anchors) {
      if ((ANCHOR_FLAGS.ORIGIN & a.flags) !== ANCHOR_FLAGS.ORIGIN) continue;

      const dist = a.Distance(aMousePos);

      if (dist < minDist) {
        minDist = dist;
        nearestOrigin = a;
      }
    }

    return nearestOrigin ? { x: nearestOrigin.pos.x, y: nearestOrigin.pos.y } : aMousePos;
  }

  /**
   * `computeAnchors` over the board's copper — and over its snap points.
   *
   * Ported: pads (`handlePadShape`'s centre), vias, tracks and arcs — the items
   * whose anchors decide where a track or a via can be dropped — plus every
   * `PCB_POINT`, which is what a point is *for*: "a defined snap anchor for
   * component alignment, [or] a routing snap point in a custom pad"
   * (`pcb_point.h:31-35`). A point that did not reach this list would be a
   * marker and nothing more. Not yet ported: graphics, zones, dimensions, text
   * and the construction-geometry intersections, all of which add anchors
   * upstream and none of which change where copper lands.
   */
  protected computeAnchors(
    aBoard: Board,
    aWhere: Vec2,
    aRange: number,
    aOpts: BestSnapOptions,
  ): void {
    const add = (aPos: Vec2, aFlags: number, aId: string): void =>
      this.addAnchor(aPos, aFlags, this.itemToken(aId));
    const pads = aOpts.magneticPads ?? MAGNETIC_OPTIONS.CAPTURE_ALWAYS;
    const tracks = aOpts.magneticTracks ?? MAGNETIC_OPTIONS.CAPTURE_ALWAYS;

    // `queryVisible`'s horizon: upstream builds a box of `snapRange` about the
    // cursor and asks the view for what is inside it.
    const inRange = (p: Vec2): boolean =>
      Math.abs(p.x - aWhere.x) <= aRange && Math.abs(p.y - aWhere.y) <= aRange;

    const onLayer = (itemLayer: string): boolean =>
      !!aOpts.allLayers || !aOpts.layer || layerMatches(itemLayer, aOpts.layer);

    const skipped = (kind: string, index: number): boolean =>
      aOpts.avoid?.has(`${kind}:${index}`) ?? false;

    if (pads === MAGNETIC_OPTIONS.CAPTURE_ALWAYS) {
      for (const [fpIndex, fp] of aBoard.footprints.entries()) {
        if (skipped('footprint', fpIndex)) continue;

        for (const [padIndex, pad] of fp.pads.entries()) {
          if (!pad.layers.some(onLayer)) continue;

          // `handlePadShape`: the pad's own position is its origin anchor.
          if (inRange(pad.at))
            add(pad.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE, `pad:${fpIndex}:${padIndex}`);
        }
      }
    }

    if (tracks === MAGNETIC_OPTIONS.CAPTURE_ALWAYS) {
      for (const [i, v] of aBoard.vias.entries()) {
        if (skipped('via', i)) continue;

        // A via spans layers, so the layer filter never excludes one.
        if (inRange(v.at))
          add(v.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE, `via:${i}`);
      }

      const wires: { kind: string; index: number; t: (typeof aBoard.tracks)[number] }[] = [
        ...aBoard.tracks.map((t, index) => ({ kind: 'track', index, t })),
        ...aBoard.arcs.map((a, index) => ({ kind: 'arc', index, t: a })),
      ];

      for (const { kind, index, t } of wires) {
        if (skipped(kind, index)) continue;

        if (!onLayer(t.layer)) continue;

        for (const end of [t.start, t.end]) {
          if (inRange(end))
            add(end, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE, `${kind}:${index}`);
        }

        // `track->GetCenter()`, added as ORIGIN and *not* SNAPPABLE — see the
        // block comment above. It is here because it is upstream, and because
        // leaving it out would make the omission look accidental.
        const mid = { x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 };

        if (inRange(mid)) add(mid, ANCHOR_FLAGS.ORIGIN, `${kind}:${index}`);
      }
    }

    // `case PCB_POINT_T: addAnchor( aItem->GetPosition(), ORIGIN | SNAPPABLE, … )`
    // (`pcb_grid_helper.cpp:1790-1797`), and the same for a footprint's own
    // points, which upstream collects in the footprint branch with the comment
    // "Points are also pick-up points" (`:1607-1617`).
    //
    // Outside both magnetic blocks above: `MAGNETIC_SETTINGS` govern pads and
    // tracks, and a point is neither — its anchor is offered whatever those are
    // set to.
    if (aOpts.points !== false) {
      for (const [i, pt] of aBoard.points.entries()) {
        if (skipped('point', i)) continue;
        if (!onLayer(pt.layer)) continue;
        if (inRange(pt.at)) add(pt.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE, `point:${i}`);
      }

      for (const [fpIndex, fp] of aBoard.footprints.entries()) {
        if (skipped('footprint', fpIndex)) continue;

        for (const [j, pt] of fp.points.entries()) {
          if (!onLayer(pt.layer)) continue;
          if (inRange(pt.at))
            add(pt.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE, `fppoint:${fpIndex}:${j}`);
        }
      }
    }

    // `case PCB_BARCODE_T` (`pcb_grid_helper.cpp:1915-1928`): the item's own
    // position as a centre anchor, then the SYMBOL polygon's bounding box —
    // `GetSymbolPoly().BBox()`, so the human-readable line and any knockout
    // margin are outside it — through `addRectPoints`.
    //
    // Gated on the Selection Filter's "Other items" box rather than on Graphics,
    // matching `pcb_selection_tool.cpp:3522`.
    if (aOpts.otherItems !== false) {
      const barcodes: { kind: string; index: number; bc: PcbBarcode }[] = [
        ...aBoard.barcodes.map((bc, index) => ({ kind: 'barcode', index, bc })),
      ];

      for (const { kind, index, bc } of barcodes) {
        if (skipped(kind, index)) continue;
        if (!onLayer(bc.layer)) continue;

        // `queryVisible`'s horizon is the item's EXTENT against the box round
        // the cursor, not its position: a barcode whose corner is under the
        // cursor has its centre 5 mm away, and gating on the centre would offer
        // the anchors of exactly the items the cursor is not near.
        const g = barcodeGeometry(bc);
        if (g.symbolPoly.length === 0) continue;

        const box = g.bbox;
        if (box.x2 < aWhere.x - aRange || box.x1 > aWhere.x + aRange) continue;
        if (box.y2 < aWhere.y - aRange || box.y1 > aWhere.y + aRange) continue;

        // `addAnchor( aItem->GetPosition(), ORIGIN, barcode, PT_CENTER )`.
        if (inRange(bc.at)) add(bc.at, ANCHOR_FLAGS.ORIGIN, `${kind}:${index}`);

        for (const p of barcodeSnapPoints(g, bc))
          if (inRange(p)) add(p, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE, `${kind}:${index}`);
      }
    }

    this.computeConstructionAnchors(this.queryIntersectableIds(aBoard, aWhere, aRange, aOpts));
  }

  /**
   * `PCB_GRID_HELPER::nearestAnchor( aPos, aFlags )` (cpp:1966-2068): the
   * nearest anchor carrying every flag.
   *
   * Every anchor tied at the nearest position is collected; a CONSTRUCTED one
   * whose real items the construction manager has not activated is dropped,
   * and of the rest the one whose item lies nearest the cursor wins - so of
   * two lines meeting end to end, the one under the cursor is the one that
   * gets extended.
   */
  private nearestAnchor(aPos: Vec2, aFlags: number): ANCHOR | null {
    // Upstream seeds with `numeric_limits<ecoord>::max()`; these are squared
    // distances in IU, so anything finite would reject far anchors, which
    // `BestDragOrigin` - with no snap radius - must still find.
    let minDist = Number.POSITIVE_INFINITY;
    let anchorsAtMinDistance: ANCHOR[] = [];

    for (const anchor of this.m_anchors) {
      if ((aFlags & anchor.flags) !== aFlags) continue;

      const front = anchorsAtMinDistance[0];

      if (front && anchor.pos.x === front.pos.x && anchor.pos.y === front.pos.y) {
        // Same distance as the previous best anchor
        anchorsAtMinDistance.push(anchor);
      } else {
        const dist = squaredDist(anchor.pos, aPos);

        if (dist < minDist) {
          minDist = dist;
          anchorsAtMinDistance = [anchor];
        }
      }
    }

    const snapManager = this.getSnapManager();
    const noRealItemsInAnchorAreInvolved = (aAnchor: ANCHOR): boolean => {
      if (!ADVANCED_CFG.GetCfg().m_EnableExtensionSnaps) return false;

      if (!(aAnchor.flags & ANCHOR_FLAGS.CONSTRUCTED)) return false;

      return !snapManager.GetConstructionManager().InvolvesAllGivenRealItems(aAnchor.items);
    };

    anchorsAtMinDistance = anchorsAtMinDistance.filter((a) => !noRealItemsInAnchorAreInvolved(a));

    let minDistToItem = Number.POSITIVE_INFINITY;
    let best: ANCHOR | null = null;

    for (const anchor of anchorsAtMinDistance) {
      let distToNearestItem = Number.POSITIVE_INFINITY;

      for (const item of anchor.items) {
        const geom = item?.IsBOARD_ITEM?.()
          ? GetBoardIntersectable(item as BOARD_ITEM)
          : this.intersectableOf(this.itemIdOf(item));

        if (geom) {
          const d = squaredDist(GetNearestPoint(geom, aPos), aPos);
          distToNearestItem = Math.min(distToNearestItem, d);
        }
      }

      // If the item doesn't have any special min-dist handler, just use the
      // distance to the anchor
      distToNearestItem = Math.min(distToNearestItem, minDist);

      if (distToNearestItem < minDistToItem) {
        minDistToItem = distToNearestItem;
        best = anchor;
      }
    }

    return best;
  }

  /**
   * `PCB_GRID_HELPER::BestSnapAnchor` (cpp:593-930) - the cursor for every
   * tool that is not the router.
   *
   * The snap radius and its clamp to the visible grid; the anchors, their
   * intersections and the construction geometry's; snap lines, which have
   * priority over new snaps; the held snap (`m_snapItem`) until the cursor is
   * `snapOut` from it; a new anchor inside `snapIn`, which also proposes its
   * items' construction geometry; the item under the cursor proposed on hover;
   * the nearest point on an element when the grid is off; and the grid.
   */
  BestSnapAnchor(aBoard: Board, aWhere: Vec2, aOpts: BestSnapOptions): Vec2;
  /**
   * `BestSnapAnchor( const VECTOR2I& aOrigin, BOARD_ITEM* aReferenceItem,
   * GRID_HELPER_GRIDS aGrid )` (cpp:568-590): the reference item's layers, else
   * the frame's active layer, else all of them; the reference item skipped.
   */
  BestSnapAnchor(aOrigin: Vec2, aReferenceItem: BOARD_ITEM | null, aGrid?: GRID_HELPER_GRIDS): Vec2;
  /**
   * `BestSnapAnchor( const VECTOR2I& aOrigin, const LSET& aLayers,
   * GRID_HELPER_GRIDS aGrid, const std::vector<BOARD_ITEM*>& aSkip )` (cpp:593).
   */
  BestSnapAnchor(
    aOrigin: Vec2,
    aLayers: LSET,
    aGrid?: GRID_HELPER_GRIDS,
    aSkip?: readonly BOARD_ITEM[],
  ): Vec2;
  BestSnapAnchor(
    a: Board | Vec2,
    b: Vec2 | BOARD_ITEM | LSET | null,
    c?: BestSnapOptions | GRID_HELPER_GRIDS,
    d?: readonly BOARD_ITEM[],
  ): Vec2 {
    if ('footprints' in a) return this.bestSnapAnchorOn(a, b as Vec2, c as BestSnapOptions);

    if (b instanceof LSET)
      return this.bestSnapAnchorLive(
        a,
        b,
        (c as GRID_HELPER_GRIDS | undefined) ?? GRID_HELPER_GRIDS.GRID_CURRENT,
        d ?? [],
      );

    let layers: LSET;
    const item: BOARD_ITEM[] = [];
    const frame = this.toolFrame();

    if (b) {
      layers = (b as BOARD_ITEM).GetLayerSet();
      item.push(b as BOARD_ITEM);
    } else if (frame?.GetScreen()) {
      layers = new LSET([frame.GetActiveLayer()]);
    } else {
      layers = LSET.AllLayersMask();
    }

    return this.bestSnapAnchorLive(
      a,
      layers,
      (c as GRID_HELPER_GRIDS | undefined) ?? GRID_HELPER_GRIDS.GRID_CURRENT,
      item,
    );
  }

  /**
   * `BestSnapAnchor( aOrigin, aLayers, aGrid, aSkip )` (cpp:593-930) over the
   * live BOARD: the items the VIEW has round the cursor (`queryVisible`), their
   * anchors and intersections on `aLayers`, and the snap decision.
   */
  private bestSnapAnchorLive(
    aOrigin: Vec2,
    aLayers: LSET,
    aGrid: GRID_HELPER_GRIDS,
    aSkip: readonly BOARD_ITEM[],
  ): Vec2 {
    const view = this.m_toolMgr!.GetView()!;

    // Tuning constant: snap radius in screen space
    const snapSize = 25;

    // Snapping distance is in screen space, clamped to the current grid to ensure that the grid
    // points that are visible can always be snapped to.
    const snapScale = view.ToWorld(snapSize);
    const snapRange = KiROUND(
      this.m_enableGrid ? Math.min(snapScale, this.GetVisibleGrid().x) : snapScale,
    );

    // Respect limits of coordinates representation
    const visibilityHorizon = BOX2ISafe(
      { x: aOrigin.x - snapRange / 2.0, y: aOrigin.y - snapRange / 2.0 },
      { x: snapRange, y: snapRange },
    );

    this.clearAnchors();

    const visibleItems = this.queryVisible(visibilityHorizon, aSkip);
    this.computeAnchorsOfItems(visibleItems, aOrigin, false, null, aLayers, false);

    const nearest = this.nearestAnchor(aOrigin, ANCHOR_FLAGS.SNAPPABLE);
    const nearestGrid = this.Align(aOrigin, aGrid);
    const gridSize = this.GetGridSize(aGrid);

    const hysteresisWorld = KiROUND(view.ToWorld(ADVANCED_CFG.GetCfg().m_SnapHysteresis));

    return this.resolveSnap(
      aOrigin,
      snapRange,
      nearest,
      nearestGrid,
      gridSize,
      hysteresisWorld,
      (aItems) => {
        // Add any involved item as a temporary construction item
        // (de-duplication with existing construction items is handled later)
        const items: BOARD_ITEM[] = [];

        for (const item of aItems) {
          // Null items are allowed to arrive here as they represent geometry that isn't
          // specifically tied to a board item. For example snap lines from some
          // other anchor. But they don't produce new construction items.
          if (!item?.IsBOARD_ITEM()) continue;

          const boardItem = item as BOARD_ITEM;

          if (
            (this.m_magneticSettings?.allLayers ?? false) ||
            aLayers.and(boardItem.GetLayerSet()).any()
          )
            items.push(boardItem);
        }

        // Temporary construction items are not persistent and don't
        // overlay the items themselves (as the items will not be moved)
        this.addConstructionItemsLive(items, true, false);
      },
      () => {
        // An exact hit on an item, even if not near a snap point
        // If it's tool hard to hit by hover, this can be increased
        // to make it non-exact.
        const hoverAccuracy = 0;

        for (const item of visibleItems) {
          if (item.HitTest(aOrigin, hoverAccuracy)) return item;
        }

        return null;
      },
    );
  }

  /**
   * `checkVisibility` of `computeAnchors( BOARD_ITEM*, … )` (cpp:1338-1361):
   * shown in the view (or moving), on a shown or - in high contrast - active
   * layer, and below its LOD.
   */
  private checkVisibility(aItem: BOARD_ITEM): boolean {
    const view = this.m_toolMgr!.GetView()!;
    const settings = view.GetPainter().GetSettings();
    const activeLayers = settings.GetHighContrastLayers();
    const isHighContrast = settings.GetHighContrast();

    // New moved items don't yet have view flags so VIEW will call them invisible
    if (!view.IsVisible(aItem) && !aItem.IsMoving()) return false;

    let onActiveLayer = !isHighContrast;
    let isLODVisible = false;

    for (const layer of aItem.GetLayerSet().Seq()) {
      if (!onActiveLayer && activeLayers.has(layer)) onActiveLayer = true;

      if (!isLODVisible && aItem.ViewGetLOD(layer, view) < view.GetScale()) isLODVisible = true;

      if (onActiveLayer && isLODVisible) return true;
    }

    return false;
  }

  /** The current tool, for `IsFootprintEditor()` (cpp:1041). */
  private isFootprintEditor(): boolean {
    const tool = this.m_toolMgr?.GetCurrentTool() as unknown as {
      IsFootprintEditor?(): boolean;
    } | null;

    return tool?.IsFootprintEditor?.() ?? false;
  }

  /** `queryVisible( aArea, aSkip )` (cpp:1034-1095). */
  private queryVisible(aArea: BOX2I, aSkip: readonly BOARD_ITEM[]): BOARD_ITEM[] {
    const items = new Set<BOARD_ITEM>();
    const visibleItems: LAYER_ITEM_PAIR[] = [];

    const view = this.m_toolMgr!.GetView()!;
    const settings = view.GetPainter().GetSettings();
    const activeLayers = settings.GetHighContrastLayers();
    const isHighContrast = settings.GetHighContrast();

    view.Query(aArea, visibleItems);

    for (const [viewItem, layer] of visibleItems) {
      if (!viewItem.IsBOARD_ITEM()) continue;

      const boardItem = viewItem as unknown as BOARD_ITEM;

      if (this.isFootprintEditor()) {
        // If we are in the footprint editor, don't use the footprint itself
        if (boardItem.Type() === KICAD_T.PCB_FOOTPRINT_T) continue;
      } else {
        // If we are not in the footprint editor, don't use footprint-editor-private items
        const parentFP = boardItem.GetParentFootprint();

        if (parentFP && IsPcbLayer(layer) && parentFP.GetPrivateLayers().Contains(layer)) continue;
      }

      // The boardItem must be visible and on an active layer
      if (
        view.IsVisible(boardItem) &&
        (!isHighContrast || activeLayers.has(layer)) &&
        boardItem.ViewGetLOD(layer, view) < view.GetScale()
      ) {
        items.add(boardItem);
      }
    }

    const skipItem = (aItem: BOARD_ITEM): void => {
      items.delete(aItem);

      aItem.RunOnChildren((aChild: BOARD_ITEM) => skipItem(aChild), RECURSE_MODE.RECURSE);
    };

    for (const item of aSkip) skipItem(item);

    return [...items];
  }

  /**
   * `computeAnchors( const std::vector<BOARD_ITEM*>&, aRefPos, aFrom,
   * aSelectionFilter, aMatchLayers, aForDrag )` (cpp:1115-1270).
   */
  private computeAnchorsOfItems(
    aItems: readonly BOARD_ITEM[],
    aRefPos: Vec2,
    aFrom: boolean,
    aSelectionFilter: SELECTION_FILTER_LIKE | null,
    aMatchLayers: LSET | null,
    aForDrag: boolean,
  ): void {
    const intersectables: { item: BOARD_ITEM | null; geom: INTERSECTABLE_GEOM }[] = [];

    // These could come from a more granular snap mode filter
    // But when looking for drag points, we don't want construction geometry
    const computeIntersections = !aForDrag;
    const computePointsOnElements = !aForDrag;
    const excludeGraphics = !!aSelectionFilter && !aSelectionFilter.graphics;
    const excludeTracks = !!aSelectionFilter && !aSelectionFilter.tracks;

    const itemIsSnappable = (aItem: BOARD_ITEM): boolean => {
      // If we are filtering by layers, check if the item matches
      if (aMatchLayers)
        return (
          (this.m_magneticSettings?.allLayers ?? false) ||
          aMatchLayers.and(aItem.GetLayerSet()).any()
        );

      return true;
    };

    const processItem = (item: BOARD_ITEM): void => {
      // Don't even process the item if it doesn't match the layers
      if (!itemIsSnappable(item)) return;

      // First, add all the key points of the item itself
      this.computeItemAnchors(item, aRefPos, aFrom, aSelectionFilter);

      // If we are computing intersections, construct the relevant intersectables
      // Points on elements also use the intersectables.
      if (computeIntersections || computePointsOnElements) {
        let intersectableGeom: INTERSECTABLE_GEOM | null = null;

        if (
          !excludeGraphics &&
          (item.Type() === KICAD_T.PCB_SHAPE_T || item.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T)
        ) {
          intersectableGeom = GetBoardIntersectable(item);
        } else if (
          !excludeTracks &&
          (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T)
        ) {
          intersectableGeom = GetBoardIntersectable(item);
        }

        if (intersectableGeom) intersectables.push({ item, geom: intersectableGeom });
      }
    };

    for (const item of aItems) processItem(item);

    for (const batch of this.getSnapManager().GetConstructionItems()) {
      for (const constructionItem of batch) {
        const involvedItem = constructionItem.Item as BOARD_ITEM | null;

        for (const drawable of constructionItem.Constructions) {
          const d = drawable.Drawable;

          if (
            d instanceof LINE ||
            d instanceof CIRCLE ||
            d instanceof HALF_LINE ||
            d instanceof SHAPE_ARC
          ) {
            intersectables.push({ item: involvedItem, geom: d });
          } else if (!(d instanceof SEG)) {
            // Add any free-floating points as snap points.
            this.addAnchor(
              { x: d.x, y: d.y },
              ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.CONSTRUCTED,
              involvedItem ? [involvedItem] : [],
              PT_NONE,
            );
          }
        }
      }
    }

    // Now, add all the intersections between the items
    if (computeIntersections) {
      for (let ii = 0; ii < intersectables.length; ++ii) {
        const a = intersectables[ii]!;

        for (let jj = ii + 1; jj < intersectables.length; ++jj) {
          const b = intersectables[jj]!;

          // An item and its own extension will often have intersections (as they are on top
          // of each other), but they not useful points to snap to
          if (a.item === b.item) continue;

          const intersections: Vec2[] = [];
          new INTERSECTION_VISITOR(a.geom, intersections).visit(b.geom);

          // For each intersection, add an intersection snap anchor
          for (const intersection of intersections) {
            this.addAnchor(
              intersection,
              ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.CONSTRUCTED,
              [a.item, b.item] as EDA_ITEM[],
              PT_INTERSECTION,
            );
          }
        }
      }
    }

    // The intersectables can also be used for fall-back snapping to "point on line"
    // snaps if no other snap is found
    this.m_pointOnLineCandidates = [];

    if (computePointsOnElements) this.m_pointOnLineCandidates = intersectables.map((it) => it.geom);
  }

  /**
   * `computeAnchors( BOARD_ITEM* aItem, aRefPos, aFrom, aSelectionFilter )`
   * (cpp:1329-1963): the key points one item offers.
   */
  private computeItemAnchors(
    aItem: BOARD_ITEM,
    aRefPos: Vec2,
    aFrom: boolean,
    aSelectionFilter: SELECTION_FILTER_LIKE | null,
  ): void {
    const view = this.m_toolMgr!.GetView()!;
    const settings = view.GetPainter().GetSettings();
    const activeHighContrastPrimaryLayer = settings.GetPrimaryHighContrastLayer();
    const isHighContrast = settings.GetHighContrast();
    const mag = this.m_magneticSettings;

    const { ORIGIN, CORNER, OUTLINE, SNAPPABLE } = ANCHOR_FLAGS;

    const checkVisibility = (aIt: BOARD_ITEM): boolean => this.checkVisibility(aIt);
    const add = (aPos: Vec2, aFlags: number, aIt: EDA_ITEM, aType = PT_NONE): void =>
      this.addAnchor({ x: aPos.x, y: aPos.y }, aFlags, [aIt], aType);

    // As defaults, these are probably reasonable to avoid spamming key points
    const ovalKeyPointFlags =
      OVAL_KEY_POINTS.OVAL_CENTER |
      OVAL_KEY_POINTS.OVAL_CAP_TIPS |
      OVAL_KEY_POINTS.OVAL_SIDE_MIDPOINTS |
      OVAL_KEY_POINTS.OVAL_CARDINAL_EXTREMES;

    const handlePadShape = (aPad: PAD, aLayer: PCB_LAYER_ID): void => {
      add(aPad.GetPosition(), ORIGIN | SNAPPABLE, aPad, PT_CENTER);

      /// If we are getting a drag point, we don't want to center the edge of pads
      if (aFrom) return;

      switch (aPad.GetShape(aLayer)) {
        case PAD_SHAPE.CIRCLE: {
          const circle = new CIRCLE(aPad.ShapePos(aLayer), Math.trunc(aPad.GetSizeX() / 2));

          for (const pt of KIGEOM_GetCircleKeyPoints(circle, false))
            add(pt.m_point, OUTLINE | SNAPPABLE, aPad, pt.m_types);

          break;
        }
        case PAD_SHAPE.OVAL: {
          const oval = SHAPE_SEGMENT.BySizeAndCenter(
            aPad.GetSize(aLayer),
            aPad.GetPosition(),
            aPad.GetOrientation(),
          );

          for (const pt of KIGEOM_GetOvalKeyPoints(oval, ovalKeyPointFlags))
            add(pt.m_point, OUTLINE | SNAPPABLE, aPad, pt.m_types);

          break;
        }
        case PAD_SHAPE.RECTANGLE:
        case PAD_SHAPE.TRAPEZOID:
        case PAD_SHAPE.ROUNDRECT:
        case PAD_SHAPE.CHAMFERED_RECT: {
          const size = aPad.GetSize(aLayer);
          const half_size = { x: Math.trunc(size.x / 2), y: Math.trunc(size.y / 2) };
          let trap_delta = { x: 0, y: 0 };

          if (aPad.GetShape(aLayer) === PAD_SHAPE.TRAPEZOID) {
            const delta = aPad.GetDelta(aLayer);
            trap_delta = { x: Math.trunc(delta.x / 2), y: Math.trunc(delta.y / 2) };
          }

          const corners = new SHAPE_LINE_CHAIN();

          corners.Append(-half_size.x - trap_delta.y, half_size.y + trap_delta.x);
          corners.Append(half_size.x + trap_delta.y, half_size.y - trap_delta.x);
          corners.Append(half_size.x - trap_delta.y, -half_size.y + trap_delta.x);
          corners.Append(-half_size.x + trap_delta.y, -half_size.y - trap_delta.x);
          corners.SetClosed(true);

          corners.Rotate(aPad.GetOrientation());
          corners.Move(aPad.ShapePos(aLayer));

          for (let ii = 0; ii < corners.GetSegmentCount(); ++ii) {
            const seg = corners.GetSegment(ii);
            add(seg.A, OUTLINE | SNAPPABLE, aPad, PT_CORNER);
            add(seg.Center(), OUTLINE | SNAPPABLE, aPad, PT_MID);

            if (ii === corners.GetSegmentCount() - 1)
              add(seg.B, OUTLINE | SNAPPABLE, aPad, PT_CORNER);
          }

          break;
        }
        default: {
          const outline = aPad.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE);

          if (!outline.IsEmpty()) {
            for (const pt of outline.Outline(0).CPoints()) add(pt, OUTLINE | SNAPPABLE, aPad);
          }

          break;
        }
      }

      if (aPad.HasHole()) {
        // Holes are at the pad centre (it's the shape that may be offset)
        const hole_pos = aPad.GetPosition();
        const hole_size = aPad.GetDrillSize();

        let snap_pts: TYPED_POINT2I[];

        if (hole_size.x === hole_size.y) {
          // Circle
          const circle = new CIRCLE(hole_pos, Math.trunc(hole_size.x / 2));
          snap_pts = KIGEOM_GetCircleKeyPoints(circle, true);
        } else {
          // Oval
          const oval = SHAPE_SEGMENT.BySizeAndCenter(hole_size, hole_pos, aPad.GetOrientation());
          snap_pts = KIGEOM_GetOvalKeyPoints(oval, ovalKeyPointFlags);
        }

        for (const snap_pt of snap_pts)
          add(snap_pt.m_point, OUTLINE | SNAPPABLE, aPad, snap_pt.m_types);
      }
    };

    const handlePad = (aPad: PAD): void => {
      aPad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
        if (
          !isHighContrast ||
          PadstackUniqueLayerAppliesToLayer(aPad.Padstack(), aLayer, activeHighContrastPrimaryLayer)
        ) {
          handlePadShape(aPad, aLayer);
        }
      });
    };

    const addRectPoints = (aBox: BOX2I, aRelatedItem: EDA_ITEM): void => {
      const topRight = { x: aBox.GetRight(), y: aBox.GetTop() };
      const bottomLeft = { x: aBox.GetLeft(), y: aBox.GetBottom() };

      const first = new SEG(aBox.GetOrigin(), topRight);
      const second = new SEG(topRight, aBox.GetEnd());
      const third = new SEG(aBox.GetEnd(), bottomLeft);
      const fourth = new SEG(bottomLeft, aBox.GetOrigin());

      const snapFlags = CORNER | SNAPPABLE;

      add(aBox.GetCenter(), snapFlags, aRelatedItem, PT_CENTER);

      add(first.A, snapFlags, aRelatedItem, PT_CORNER);
      add(first.Center(), snapFlags, aRelatedItem, PT_MID);
      add(second.A, snapFlags, aRelatedItem, PT_CORNER);
      add(second.Center(), snapFlags, aRelatedItem, PT_MID);
      add(third.A, snapFlags, aRelatedItem, PT_CORNER);
      add(third.Center(), snapFlags, aRelatedItem, PT_MID);
      add(fourth.A, snapFlags, aRelatedItem, PT_CORNER);
      add(fourth.Center(), snapFlags, aRelatedItem, PT_MID);
    };

    const handleShape = (shape: PCB_SHAPE): void => {
      const start = shape.GetStart();
      const end = shape.GetEnd();

      switch (shape.GetShape()) {
        case SHAPE_T.CIRCLE: {
          const r = KiROUND(Math.hypot(start.x - end.x, start.y - end.y));

          add(start, ORIGIN | SNAPPABLE, shape, PT_CENTER);

          add({ x: start.x - r, y: start.y }, OUTLINE | SNAPPABLE, shape, PT_QUADRANT);
          add({ x: start.x + r, y: start.y }, OUTLINE | SNAPPABLE, shape, PT_QUADRANT);
          add({ x: start.x, y: start.y - r }, OUTLINE | SNAPPABLE, shape, PT_QUADRANT);
          add({ x: start.x, y: start.y + r }, OUTLINE | SNAPPABLE, shape, PT_QUADRANT);
          break;
        }

        case SHAPE_T.ARC:
          add(shape.GetStart(), CORNER | SNAPPABLE, shape, PT_END);
          add(shape.GetEnd(), CORNER | SNAPPABLE, shape, PT_END);
          add(shape.GetArcMid(), CORNER | SNAPPABLE, shape, PT_MID);
          add(shape.GetCenter(), ORIGIN | SNAPPABLE, shape, PT_CENTER);
          break;

        case SHAPE_T.RECTANGLE:
          addRectPoints(BOX2I.ByCorners(start, end), shape);
          break;

        case SHAPE_T.SEGMENT:
          add(start, CORNER | SNAPPABLE, shape, PT_END);
          add(end, CORNER | SNAPPABLE, shape, PT_END);
          add(shape.GetCenter(), CORNER | SNAPPABLE, shape, PT_MID);
          break;

        case SHAPE_T.POLY: {
          const lc = new SHAPE_LINE_CHAIN();
          lc.SetClosed(true);

          for (const p of shape.GetPolyPoints()) {
            add(p, CORNER | SNAPPABLE, shape, PT_CORNER);
            lc.Append(p);
          }

          add(lc.NearestPoint(aRefPos), OUTLINE, aItem);
          break;
        }

        case SHAPE_T.BEZIER:
          add(start, CORNER | SNAPPABLE, shape, PT_END);
          add(end, CORNER | SNAPPABLE, shape, PT_END);
          add(shape.GetPosition(), ORIGIN | SNAPPABLE, shape);
          break;

        default:
          add(shape.GetPosition(), ORIGIN | SNAPPABLE, shape);
          break;
      }
    };

    switch (aItem.Type()) {
      case KICAD_T.PCB_FOOTPRINT_T: {
        const footprint = aItem as unknown as FOOTPRINT;
        const footprintVisible = checkVisibility(aItem);

        for (const pad of footprint.Pads()) {
          if (aFrom) {
            if (aSelectionFilter && !aSelectionFilter.pads) continue;
          } else if (mag?.pads !== MAGNETIC_OPTIONS.CAPTURE_ALWAYS) {
            continue;
          }

          if (!checkVisibility(pad)) continue;

          if (!pad.GetBoundingBox().Contains(aRefPos)) continue;

          handlePad(pad);
        }

        // Points are also pick-up points
        for (const pt of footprint.Points()) {
          if (aSelectionFilter && !aSelectionFilter.points) continue;

          if (!checkVisibility(pt)) continue;

          add(pt.GetPosition(), ORIGIN | SNAPPABLE, aItem, PT_CENTER);
        }

        // When computing drag origins (aFrom=true), always proceed to add the footprint
        // position anchor regardless of the visibility state.
        if (!footprintVisible && !aFrom) break;

        if (aFrom && aSelectionFilter && !aSelectionFilter.footprints) break;

        // Snap to the footprint origin so that move operations keep the part aligned to
        // the grid regardless of anchor layer visibility, but not when the footprint's
        // side is hidden.
        const fpRenderLayer =
          footprint.GetLayer() === PCB_LAYER_ID.F_Cu
            ? GAL_LAYER_ID.LAYER_FOOTPRINTS_FR
            : footprint.GetLayer() === PCB_LAYER_ID.B_Cu
              ? GAL_LAYER_ID.LAYER_FOOTPRINTS_BK
              : GAL_LAYER_ID.LAYER_ANCHOR;

        if (!view.IsLayerVisible(fpRenderLayer)) break;

        const position = footprint.GetPosition();
        const center = footprint.GetBoundingBox(false).Centre();
        const grid = this.GetGrid();

        add(position, ORIGIN | SNAPPABLE, aItem, PT_CENTER);

        if (squaredDist(center, position) > grid.x * grid.x + grid.y * grid.y)
          add(center, ORIGIN | SNAPPABLE, aItem, PT_CENTER);

        break;
      }

      case KICAD_T.PCB_PAD_T:
        if (aFrom) {
          if (aSelectionFilter && !aSelectionFilter.pads) break;
        } else if (mag?.pads !== MAGNETIC_OPTIONS.CAPTURE_ALWAYS) {
          break;
        }

        if (checkVisibility(aItem)) handlePad(aItem as unknown as PAD);

        break;

      case KICAD_T.PCB_TEXTBOX_T:
        if (aFrom) {
          if (aSelectionFilter && !aSelectionFilter.text) break;
        } else if (!mag?.graphics) {
          break;
        }

        if (checkVisibility(aItem)) handleShape(aItem as unknown as PCB_SHAPE);

        break;

      case KICAD_T.PCB_TABLE_T:
        if (aFrom) {
          if (aSelectionFilter && !aSelectionFilter.text) break;
        } else if (!mag?.graphics) {
          break;
        }

        if (checkVisibility(aItem)) {
          const table = aItem as unknown as PCB_TABLE;

          const drawAngle = table.GetCell(0, 0)!.GetDrawRotation();
          const topLeft = table.GetCell(0, 0)!.GetCornersInSequence(drawAngle)[0]!;
          const bottomLeft = table
            .GetCell(table.GetRowCount() - 1, 0)!
            .GetCornersInSequence(drawAngle)[3]!;
          const topRight = table
            .GetCell(0, table.GetColCount() - 1)!
            .GetCornersInSequence(drawAngle)[1]!;
          const bottomRight = table
            .GetCell(table.GetRowCount() - 1, table.GetColCount() - 1)!
            .GetCornersInSequence(drawAngle)[2]!;

          add(topLeft, CORNER | SNAPPABLE, aItem, PT_END);
          add(bottomLeft, CORNER | SNAPPABLE, aItem, PT_END);
          add(topRight, CORNER | SNAPPABLE, aItem, PT_END);
          add(bottomRight, CORNER | SNAPPABLE, aItem, PT_END);

          add(table.GetCenter(), ORIGIN, aItem, PT_MID);
        }

        break;

      case KICAD_T.PCB_SHAPE_T:
        if (aFrom) {
          if (aSelectionFilter && !aSelectionFilter.graphics) break;
        } else if (!mag?.graphics) {
          break;
        }

        if (checkVisibility(aItem)) handleShape(aItem as unknown as PCB_SHAPE);

        break;

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
        if (aFrom) {
          if (aSelectionFilter && !aSelectionFilter.tracks) break;
        } else if (mag?.tracks !== MAGNETIC_OPTIONS.CAPTURE_ALWAYS) {
          break;
        }

        if (checkVisibility(aItem)) {
          const track = aItem as unknown as PCB_TRACK;

          add(track.GetStart(), CORNER | SNAPPABLE, aItem, PT_END);
          add(track.GetEnd(), CORNER | SNAPPABLE, aItem, PT_END);

          if (aItem.Type() === KICAD_T.PCB_ARC_T) {
            for (const spec of PCB_GRID_HELPER.GetArcAnchors(aItem as unknown as PCB_ARC, aFrom))
              add(spec.pos, spec.flags, aItem, spec.pointType);
          } else {
            add(track.GetCenter(), ORIGIN, aItem, PT_MID);
          }
        }

        break;

      case KICAD_T.PCB_MARKER_T:
      case KICAD_T.PCB_TARGET_T:
        add(aItem.GetPosition(), ORIGIN | CORNER | SNAPPABLE, aItem, PT_CENTER);
        break;

      case KICAD_T.PCB_POINT_T:
        if (aSelectionFilter && !aSelectionFilter.points) break;

        if (checkVisibility(aItem)) add(aItem.GetPosition(), ORIGIN | SNAPPABLE, aItem, PT_CENTER);

        break;

      case KICAD_T.PCB_VIA_T:
        if (aFrom) {
          if (aSelectionFilter && !aSelectionFilter.vias) break;
        } else if (mag?.tracks !== MAGNETIC_OPTIONS.CAPTURE_ALWAYS) {
          break;
        }

        if (checkVisibility(aItem))
          add(aItem.GetPosition(), ORIGIN | CORNER | SNAPPABLE, aItem, PT_CENTER);

        break;

      case KICAD_T.PCB_ZONE_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.zones) break;

        if (checkVisibility(aItem)) {
          const outline = (aItem as unknown as ZONE).Outline();

          const lc = new SHAPE_LINE_CHAIN();
          lc.SetClosed(true);

          for (const pt of outline.CIterateWithHoles()) {
            add(pt, CORNER | SNAPPABLE, aItem, PT_CORNER);
            lc.Append(pt);
          }

          add(lc.NearestPoint(aRefPos), OUTLINE, aItem);
        }

        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.dimensions) break;

        if (checkVisibility(aItem)) {
          const dim = aItem as unknown as PCB_DIM_ALIGNED;
          add(dim.GetCrossbarStart(), CORNER | SNAPPABLE, aItem);
          add(dim.GetCrossbarEnd(), CORNER | SNAPPABLE, aItem);
          add(dim.GetStart(), CORNER | SNAPPABLE, aItem);
          add(dim.GetEnd(), CORNER | SNAPPABLE, aItem);
        }

        break;

      case KICAD_T.PCB_DIM_CENTER_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.dimensions) break;

        if (checkVisibility(aItem)) {
          const dim = aItem as unknown as PCB_DIM_CENTER;
          add(dim.GetStart(), CORNER | SNAPPABLE, aItem);
          add(dim.GetEnd(), CORNER | SNAPPABLE, aItem);

          const start = dim.GetStart();
          let radial = { x: dim.GetEnd().x - start.x, y: dim.GetEnd().y - start.y };

          for (let i = 0; i < 2; i++) {
            radial = RotatePoint(radial, ANGLE_90.negate());
            add({ x: start.x + radial.x, y: start.y + radial.y }, CORNER | SNAPPABLE, aItem);
          }
        }

        break;

      case KICAD_T.PCB_DIM_RADIAL_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.dimensions) break;

        if (checkVisibility(aItem)) {
          const radialDim = aItem as unknown as PCB_DIM_RADIAL;
          add(radialDim.GetStart(), CORNER | SNAPPABLE, aItem);
          add(radialDim.GetEnd(), CORNER | SNAPPABLE, aItem);
          add(radialDim.GetKnee(), CORNER | SNAPPABLE, aItem);
          add(radialDim.GetTextPos(), CORNER | SNAPPABLE, aItem);
        }

        break;

      case KICAD_T.PCB_DIM_LEADER_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.dimensions) break;

        if (checkVisibility(aItem)) {
          const leader = aItem as unknown as PCB_DIM_LEADER;
          add(leader.GetStart(), CORNER | SNAPPABLE, aItem);
          add(leader.GetEnd(), CORNER | SNAPPABLE, aItem);
          add(leader.GetTextPos(), CORNER | SNAPPABLE, aItem);
        }

        break;

      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.text) break;

        if (checkVisibility(aItem)) add(aItem.GetPosition(), ORIGIN, aItem);

        break;

      case KICAD_T.PCB_BARCODE_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.otherItems) break;

        if (checkVisibility(aItem)) {
          const barcode = aItem as unknown as PCB_BARCODE;
          const bbox = barcode.GetSymbolPoly().BBox();

          add(aItem.GetPosition(), ORIGIN, aItem, PT_CENTER);
          addRectPoints(bbox, aItem);
        }

        break;

      case KICAD_T.PCB_GROUP_T:
        for (const item of (aItem as unknown as PCB_GROUP).GetBoardItems()) {
          if (checkVisibility(item)) this.computeItemAnchors(item, aRefPos, aFrom, null);
        }

        break;

      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        if (aFrom && aSelectionFilter && !aSelectionFilter.graphics) break;

        if (checkVisibility(aItem)) {
          const image = aItem as unknown as PCB_REFERENCE_IMAGE;
          const refImg = image.GetReferenceImage();
          const bbox = refImg.GetBoundingBox();

          addRectPoints(bbox, aItem);

          const offset = refImg.GetTransformOriginOffset();

          if (offset.x !== 0 || offset.y !== 0) {
            const pos = image.GetPosition();
            add({ x: pos.x + offset.x, y: pos.y + offset.y }, ORIGIN, aItem, PT_CENTER);
          }
        }

        break;

      default:
        break;
    }
  }

  /** `GetArcAnchors( const PCB_ARC&, bool aFrom )` (cpp:1310-1327). */
  static GetArcAnchors(
    aArc: PCB_ARC,
    aFrom: boolean,
  ): { pos: Vec2; flags: number; pointType: number }[] {
    const anchors: { pos: Vec2; flags: number; pointType: number }[] = [];

    // The stored midpoint is grid-aligned when the arc is; expose it alongside the endpoints so
    // BestDragOrigin picks a grid-aligned corner as the drag/paste reference.
    anchors.push({
      pos: aArc.GetMid(),
      flags: ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE,
      pointType: PT_MID,
    });

    // The derived geometric center is rarely grid-aligned. It stays available as a drag origin
    // for other items (aFrom=false) but is never offered as this arc's own origin.
    if (!aFrom)
      anchors.push({ pos: aArc.GetCenter(), flags: ANCHOR_FLAGS.ORIGIN, pointType: PT_CENTER });

    return anchors;
  }

  /** The tool holder, as the PCB frame the live forms read. */
  private toolFrame(): {
    GetScreen(): unknown;
    GetActiveLayer(): PCB_LAYER_ID;
  } | null {
    return (this.m_toolMgr?.GetToolHolder() as never) ?? null;
  }

  private bestSnapAnchorOn(aBoard: Board, aWhere: Vec2, aOpts: BestSnapOptions): Vec2 {
    this.m_board = aBoard;

    // Snapping distance is in screen space, clamped to the current grid so that
    // the grid points that are visible can always be snapped to (cpp:604-615).
    const snapRange = KiROUND(
      this.m_enableGrid ? Math.min(aOpts.snapScale, aOpts.visibleGrid) : aOpts.snapScale,
    );

    this.clearAnchors();
    this.computeAnchors(aBoard, aWhere, snapRange, aOpts);

    const nearest = this.nearestAnchor(aWhere, ANCHOR_FLAGS.SNAPPABLE);
    const nearestGrid = this.Align(aWhere);
    const gridSize = this.GetGridSize(0);
    const hysteresisWorld = KiROUND(aOpts.hysteresis ?? 0);

    return this.resolveSnap(
      aWhere,
      snapRange,
      nearest,
      nearestGrid,
      gridSize,
      hysteresisWorld,
      (aItems) => {
        // Null items represent geometry that isn't tied to a board item (a snap
        // line from another anchor) and produce no construction items.
        const ids: string[] = [];

        for (const item of aItems) {
          const id = this.itemIdOf(item);

          if (id !== undefined && this.itemOnLayers(aBoard, id, aOpts)) ids.push(id);
        }

        this.AddConstructionItems(aBoard, ids, true, false);
      },
      () => {
        const hit = this.hoverHit(aBoard, aWhere, snapRange, aOpts);

        return hit !== null ? this.itemToken(hit)[0]! : null;
      },
    );
  }

  /**
   * The decision half of `BestSnapAnchor` (cpp:643-930), once the anchors are
   * computed: snap lines first, the held snap until `snapOut`, a new anchor
   * inside `snapIn`, the item under the cursor proposed on hover, a point on an
   * element with the grid off, else the grid. `aPropose` is the
   * `proposeConstructionForItems` lambda and `aHoverHit` the hit test over the
   * visible items; both depend on what the anchors were computed from.
   */
  private resolveSnap(
    aWhere: Vec2,
    snapRange: number,
    nearest: ANCHOR | null,
    nearestGrid: Vec2,
    gridSize: Vec2,
    hysteresisWorld: number,
    proposeConstructionForItems: (aItems: readonly (EDA_ITEM | null)[]) => void,
    aHoverHit: () => EDA_ITEM | null,
  ): Vec2 {
    const snapIn = Math.max(0, snapRange - hysteresisWorld);
    const snapOut = snapRange + hysteresisWorld;

    // The distance to the nearest snap point, if any
    let snapDist: number | null = nearest ? nearest.Distance(aWhere) : null;

    if (this.m_snapItem) {
      const existingDist = this.m_snapItem.Distance(aWhere);

      if (snapDist === null || existingDist < snapDist) snapDist = existingDist;
    }

    this.showConstructionGeometry(this.m_enableSnap);

    const snapManager = this.getSnapManager();
    const snapLineManager = snapManager.GetSnapLineManager();
    const ptIsReferenceOnly = (aPt: Vec2): boolean =>
      snapManager.GetReferenceOnlyPoints().some((p) => p.x === aPt.x && p.y === aPt.y);

    let snapValid = false;

    if (this.m_enableSnap) {
      // Existing snap lines need priority over new snaps
      if (this.m_enableSnapLine) {
        let snapLineSnap = snapLineManager.GetNearestSnapLinePoint(
          aWhere,
          nearestGrid,
          snapDist,
          snapRange,
          gridSize,
          this.GetOrigin(),
        );

        if (!snapLineSnap)
          snapLineSnap = this.SnapToConstructionLines(aWhere, nearestGrid, gridSize, snapRange);

        // We found a better snap point that the nearest one
        if (
          snapLineSnap &&
          (this.m_skipPoint.x !== snapLineSnap.x || this.m_skipPoint.y !== snapLineSnap.y)
        ) {
          // Prefer actual anchors over construction line grid intersections
          const preferAnchor = !!nearest && nearest.Distance(aWhere) <= snapIn;

          if (!preferAnchor) {
            snapLineManager.SetSnapLineEnd(snapLineSnap);
            snapValid = true;

            // Don't show a snap point if we're snapping to a grid rather than an anchor
            this.setSnapPointVisible(false);

            // Only return the snap line end as a snap if it's not a reference
            // point (we don't snap to reference points, but we can use them to
            // update the snap line, without actually snapping)
            if (!ptIsReferenceOnly(snapLineSnap)) return snapLineSnap;
          }
        }
      }

      if (this.m_snapItem) {
        const dist = this.m_snapItem.Distance(aWhere);

        if (dist <= snapOut) {
          if (nearest && ptIsReferenceOnly(nearest.pos) && nearest.Distance(aWhere) <= snapRange)
            snapLineManager.SetSnapLineOrigin(nearest.pos);

          snapLineManager.SetSnappedAnchor(this.m_snapItem.pos);
          this.updateSnapPoint(new TYPED_POINT2I(this.m_snapItem.pos, this.m_snapItem.pointTypes));

          return { ...this.m_snapItem.pos };
        }

        this.m_snapItem = null;
      }

      // If there's a snap anchor within range, use it if we can
      if (nearest && nearest.Distance(aWhere) <= snapIn) {
        const anchorIsConstructed = !!(nearest.flags & ANCHOR_FLAGS.CONSTRUCTED);

        // If the nearest anchor is a reference point, we don't snap to it, but
        // we can update the snap line origin
        if (ptIsReferenceOnly(nearest.pos)) {
          snapLineManager.SetSnapLineOrigin(nearest.pos);
        } else {
          // 'Intrinsic' points of items can trigger adding construction
          // geometry for _that_ item by proximity.
          if (!anchorIsConstructed) proposeConstructionForItems(nearest.items);

          this.m_snapItem = nearest;

          // Set the snap line origin or end as needed
          snapLineManager.SetSnappedAnchor(nearest.pos);

          // Show the correct snap point marker
          this.updateSnapPoint(new TYPED_POINT2I(nearest.pos, nearest.pointTypes));

          return { ...nearest.pos };
        }

        snapValid = true;
      } else if (ADVANCED_CFG.GetCfg().m_ExtensionSnapActivateOnHover) {
        // An exact hit on an item, even if not near a snap point
        const hit = aHoverHit();

        if (hit !== null) {
          proposeConstructionForItems([hit]);
          snapValid = true;
        }
      }

      // If we got here, we didn't snap to an anchor or snap line. If we're
      // snapping to a grid, on-element snaps would be too intrusive but they're
      // useful when there isn't a grid to snap to
      if (!this.m_enableGrid) {
        const nearestPointOnAnElement = GetNearestPointOfAny(this.m_pointOnLineCandidates, aWhere);

        // Got any nearest point - snap if in range
        if (
          nearestPointOnAnElement &&
          Math.trunc(
            Math.hypot(nearestPointOnAnElement.x - aWhere.x, nearestPointOnAnElement.y - aWhere.y),
          ) <= snapRange
        ) {
          this.updateSnapPoint(new TYPED_POINT2I(nearestPointOnAnElement, PT_ON_ELEMENT));

          // Clear the snap end, but keep the origin so touching another line
          // doesn't kill a snap line
          snapLineManager.SetSnapLineEnd(null);

          return nearestPointOnAnElement;
        }
      }
    }

    // Completely failed to find any snap point, so snap to the grid
    this.m_snapItem = null;

    if (!snapValid) snapManager.GetConstructionManager().CancelProposal();

    snapLineManager.SetSnapLineEnd(null);
    this.setSnapPointVisible(false);

    return nearestGrid;
  }

  /**
   * `PCB_GRID_HELPER::AddConstructionItems` (cpp:204-343) over board item ids:
   * a graphic segment's two extension rays (or the whole line), an arc's
   * complement and centre (or its circle), a circle's or rectangle's centre;
   * every other item is proposed with no geometry of its own.
   */
  AddConstructionItems(
    aBoard: Board,
    aItemIds: readonly string[],
    aExtensionOnly: boolean,
    aIsPersistent: boolean,
  ): void;
  /**
   * `PCB_GRID_HELPER::AddConstructionItems( std::vector<BOARD_ITEM*>, bool, bool )`
   * (cpp:204-343) on live items, each proposed under its own pointer.
   */
  AddConstructionItems(
    aItems: readonly BOARD_ITEM[],
    aExtensionOnly: boolean,
    aIsPersistent: boolean,
  ): void;
  AddConstructionItems(
    a: Board | readonly BOARD_ITEM[],
    b: readonly string[] | boolean,
    c: boolean,
    d?: boolean,
  ): void {
    if (Array.isArray(a)) {
      this.addConstructionItemsLive(a as readonly BOARD_ITEM[], b as boolean, c);
      return;
    }

    const aBoard = a as Board;
    const aItemIds = b as readonly string[];
    const aExtensionOnly = c;
    const aIsPersistent = d!;

    if (!ADVANCED_CFG.GetCfg().m_EnableExtensionSnaps) return;

    const batch: CONSTRUCTION_ITEM_BATCH = [];
    const referenceOnlyPoints: Vec2[] = [];

    for (const id of aItemIds) {
      const drawables: CONSTRUCTION_GEOM_DRAWABLE[] = [];
      const ref = parseBoardItemId(id);
      const shape = ref?.kind === 'shape' ? aBoard.shapes[ref.index] : undefined;

      if (shape?.kind === 'line' && shape.start && shape.end) {
        const { start, end } = shape;

        if (!aExtensionOnly) {
          drawables.push(new LINE(start, end));
        } else {
          // Two rays, extending from the segment ends
          const segVec = { x: end.x - start.x, y: end.y - start.y };
          drawables.push(new HALF_LINE(start, { x: start.x - segVec.x, y: start.y - segVec.y }));
          drawables.push(new HALF_LINE(end, { x: end.x + segVec.x, y: end.y + segVec.y }));
        }

        if (aIsPersistent) {
          drawables.push({ ...start }, { ...end });
          referenceOnlyPoints.push({ ...start }, { ...end });
        }
      } else if (shape?.kind === 'arc' && shape.start && shape.mid && shape.end) {
        const arc = new SHAPE_ARC(shape.start, shape.mid, shape.end, 0);
        const center = arc.GetCenter();

        if (!aExtensionOnly) {
          drawables.push(new CIRCLE(center, arc.GetRadius()));
        } else {
          // The rest of the circle is the arc through the opposite point to the midpoint
          const arcMid = arc.GetArcMid();
          const oppositeMid = {
            x: center.x + (center.x - arcMid.x),
            y: center.y + (center.y - arcMid.y),
          };
          drawables.push(new SHAPE_ARC(shape.start, oppositeMid, shape.end, 0));
        }

        drawables.push({ ...center });

        if (aIsPersistent) {
          drawables.push({ ...shape.start }, { ...shape.end });
          referenceOnlyPoints.push({ ...shape.start }, { ...shape.end });
        }
      } else if (shape?.kind === 'circle' || shape?.kind === 'rect') {
        const c = shapeCenter(shape);

        if (c) drawables.push(c);
      }

      batch.push({
        Source: CONSTRUCTION_MANAGER_SOURCE.FROM_ITEMS,
        Item: this.itemToken(id)[0]!,
        Constructions: drawables.map((d) => ({ Drawable: d, LineWidth: 1 })),
      });
    }

    if (referenceOnlyPoints.length)
      this.getSnapManager().SetReferenceOnlyPoints(referenceOnlyPoints);

    this.getSnapManager().GetConstructionManager().ProposeConstructionItems(batch, aIsPersistent);
  }

  private addConstructionItemsLive(
    aItems: readonly BOARD_ITEM[],
    aExtensionOnly: boolean,
    aIsPersistent: boolean,
  ): void {
    if (!ADVANCED_CFG.GetCfg().m_EnableExtensionSnaps) return;

    // For all the elements that get drawn construction geometry,
    // add something suitable to the construction helper.
    // This can be nothing.
    const batch: CONSTRUCTION_ITEM_BATCH = [];
    const referenceOnlyPoints: Vec2[] = [];

    for (const item of aItems) {
      const drawables: CONSTRUCTION_GEOM_DRAWABLE[] = [];

      switch (item.Type()) {
        case KICAD_T.PCB_SHAPE_T: {
          const shape = item as unknown as PCB_SHAPE;

          switch (shape.GetShape()) {
            case SHAPE_T.SEGMENT: {
              const start = shape.GetStart();
              const end = shape.GetEnd();

              if (!aExtensionOnly) {
                drawables.push(new LINE(start, end));
              } else {
                // Two rays, extending from the segment ends
                const segVec = { x: end.x - start.x, y: end.y - start.y };
                drawables.push(
                  new HALF_LINE(start, { x: start.x - segVec.x, y: start.y - segVec.y }),
                );
                drawables.push(new HALF_LINE(end, { x: end.x + segVec.x, y: end.y + segVec.y }));
              }

              if (aIsPersistent) {
                // include the original endpoints as construction items
                // (this allows H/V snapping), but mark them as references, so
                // they don't get snapped to themselves
                drawables.push({ ...start }, { ...end });
                referenceOnlyPoints.push({ ...start }, { ...end });
              }

              break;
            }

            case SHAPE_T.ARC: {
              const center = shape.GetCenter();

              if (!aExtensionOnly) {
                drawables.push(new CIRCLE(center, shape.GetRadius()));
              } else {
                // The rest of the circle is the arc through the opposite point to the midpoint
                const arcMid = shape.GetArcMid();
                const oppositeMid = {
                  x: center.x + (center.x - arcMid.x),
                  y: center.y + (center.y - arcMid.y),
                };
                drawables.push(new SHAPE_ARC(shape.GetStart(), oppositeMid, shape.GetEnd(), 0));
              }

              drawables.push({ ...center });

              if (aIsPersistent) {
                drawables.push({ ...shape.GetStart() }, { ...shape.GetEnd() });
                referenceOnlyPoints.push({ ...shape.GetStart() }, { ...shape.GetEnd() });
              }

              break;
            }

            case SHAPE_T.CIRCLE:
            case SHAPE_T.RECTANGLE:
              drawables.push({ ...shape.GetCenter() });
              break;

            default:
              // This shape doesn't have any construction geometry to draw
              break;
          }

          break;
        }

        case KICAD_T.PCB_REFERENCE_IMAGE_T: {
          const refImg = (item as unknown as PCB_REFERENCE_IMAGE).GetReferenceImage();
          const pos = refImg.GetPosition();
          const offset = refImg.GetTransformOriginOffset();

          drawables.push({ ...pos });

          if (offset.x !== 0 || offset.y !== 0)
            drawables.push({ x: pos.x + offset.x, y: pos.y + offset.y });

          for (const seg of KIGEOM_BoxToSegs(refImg.GetBoundingBox())) drawables.push(seg);

          break;
        }

        default:
          // This item doesn't have any construction geometry to draw
          break;
      }

      // constructionDrawables can be empty, which is fine: the item is still
      // going to be proposed for activation
      batch.push({
        Source: CONSTRUCTION_MANAGER_SOURCE.FROM_ITEMS,
        Item: item,
        Constructions: drawables.map((dr) => ({ Drawable: dr, LineWidth: 1 })),
      });
    }

    if (referenceOnlyPoints.length)
      this.getSnapManager().SetReferenceOnlyPoints(referenceOnlyPoints);

    this.getSnapManager().GetConstructionManager().ProposeConstructionItems(batch, aIsPersistent);
  }

  /**
   * `PCB_GRID_HELPER::computeAnchors( aItems, aRefPos, aFrom = true )` over the
   * selection, as board item ids.
   *
   * `aFrom = true` is a different anchor set from the one {@link
   * computeCopperAnchors} builds, not merely a filtered one:
   *
   * - a pad contributes **only** its centre — "if we are getting a drag point, we
   *   don't want to center the edge of pads" (cpp:1374-1376), so none of the
   *   outline key points are collected;
   * - a footprint contributes its own origin unconditionally, plus the centre of
   *   its bounding box when that is more than a grid step away, plus the centres
   *   of the pads whose bounding box the cursor is actually inside (cpp:1576-1648);
   * - an arc offers its stored midpoint but *not* its derived geometric centre,
   *   which is rarely on the grid (cpp:1315-1323).
   *
   * Not ported, all for the same reason `computeCopperAnchors` leaves them out —
   * they are anchor sources we have no geometry for here: graphic shapes, zone
   * outlines, dimensions, text, and the construction-geometry intersections.
   * A selection made only of those falls back to the cursor, which is upstream's
   * own answer when nothing contributes an anchor.
   */
  computeDragAnchors(
    aBoard: Board,
    aItems: Iterable<string>,
    aWhere: Vec2,
    aOpts: DragOriginOptions,
  ): void {
    let curId = '';
    const add = (aPos: Vec2, aFlags: number): void =>
      this.addAnchor(aPos, aFlags, this.itemToken(curId));
    // `VECTOR2I grid( GetGrid() ); … > grid.SquaredEuclideanNorm()`, and a GAL
    // grid is square here, so the threshold is both axes together.
    const gridSq = 2 * aOpts.gridSize * aOpts.gridSize;

    const pad = (p: { at: Vec2 }): void => {
      add(p.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);
    };

    for (const id of aItems) {
      const ref = parseBoardItemId(id);
      if (!ref) continue;
      curId = id;

      switch (ref.kind) {
        case 'footprint': {
          const fp = aBoard.footprints[ref.index];
          if (!fp) break;

          // "pad->GetBoundingBox().Contains( aRefPos )" (cpp:1592): only a pad the
          // cursor is genuinely over is a pick-up point, which is what makes
          // grabbing a part by one of its pads drag it by that pad.
          for (const p of fp.pads) {
            const bb = padBBox(p);
            if (
              bb &&
              aWhere.x >= bb.minX &&
              aWhere.x <= bb.maxX &&
              aWhere.y >= bb.minY &&
              aWhere.y <= bb.maxY
            )
              pad(p);
          }

          add(fp.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);

          // `footprint->GetBoundingBox( false )` — the box without the text, so a
          // long reference cannot drag the centre off the part.
          const bb = footprintBBox(fp, false);
          if (bb) {
            const centre = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
            if (squaredDist(centre, fp.at) > gridSq)
              add(centre, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.SNAPPABLE);
          }

          break;
        }

        case 'pad': {
          const p = aBoard.footprints[ref.index]?.pads[ref.sub ?? 0];
          if (p) pad(p);
          break;
        }

        case 'via': {
          const v = aBoard.vias[ref.index];
          if (v) add(v.at, ANCHOR_FLAGS.ORIGIN | ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          break;
        }

        case 'track': {
          const t = aBoard.tracks[ref.index];
          if (!t) break;
          add(t.start, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          add(t.end, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          add({ x: (t.start.x + t.end.x) / 2, y: (t.start.y + t.end.y) / 2 }, ANCHOR_FLAGS.ORIGIN);
          break;
        }

        case 'arc': {
          const a = aBoard.arcs[ref.index];
          if (!a) break;
          add(a.start, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          add(a.end, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          // The stored midpoint, which is grid-aligned when the arc is. The
          // derived centre is deliberately *not* offered as the arc's own origin.
          add(a.mid, ANCHOR_FLAGS.CORNER | ANCHOR_FLAGS.SNAPPABLE);
          break;
        }

        default:
          break;
      }
    }
  }

  /**
   * `PCB_GRID_HELPER::BestDragOrigin` (cpp:507-565) — the point a move measures
   * itself from, given the selection and the raw mouse position.
   *
   * Origin beats corner beats outline, each only when it is nearer; the outline
   * anchor additionally may not win unless the best of the other two is further
   * away than `lineSnapMinCornerDistance`. With no anchors at all the cursor
   * itself is the answer.
   */
  BestDragOrigin(
    aBoard: Board,
    aItems: Iterable<string>,
    aWhere: Vec2,
    aOpts: DragOriginOptions,
  ): Vec2;
  /**
   * `BestDragOrigin( const VECTOR2I& aMousePos, std::vector<BOARD_ITEM*>& aItems,
   * GRID_HELPER_GRIDS aGrid, const PCB_SELECTION_FILTER_OPTIONS* aSelectionFilter )`
   * (cpp:507). TRANSITIONAL (#636 stage 3): computed on the frame's view board,
   * as `bestSnapAnchorLive`.
   */
  BestDragOrigin(
    aMousePos: Vec2,
    aItems: readonly BOARD_ITEM[],
    aGrid?: GRID_HELPER_GRIDS,
    aSelectionFilter?: unknown,
  ): Vec2;
  BestDragOrigin(
    a: Board | Vec2,
    b: Iterable<string> | readonly BOARD_ITEM[],
    c?: Vec2 | GRID_HELPER_GRIDS,
    d?: DragOriginOptions | unknown,
  ): Vec2 {
    if ('footprints' in a)
      return this.bestDragOriginOn(a, b as Iterable<string>, c as Vec2, d as DragOriginOptions);

    return this.bestDragOriginLive(
      a,
      b as readonly BOARD_ITEM[],
      d as SELECTION_FILTER_LIKE | null,
    );
  }

  /** `BestDragOrigin( aMousePos, aItems, aGrid, aSelectionFilter )` (cpp:507-565). */
  private bestDragOriginLive(
    aMousePos: Vec2,
    aItems: readonly BOARD_ITEM[],
    aSelectionFilter: SELECTION_FILTER_LIKE | null,
  ): Vec2 {
    this.clearAnchors();

    this.computeAnchorsOfItems(aItems, aMousePos, true, aSelectionFilter ?? null, null, true);

    const lineSnapMinCornerDistance = this.m_toolMgr!.GetView()!.ToWorld(50);

    const nearestOutline = this.nearestAnchor(aMousePos, ANCHOR_FLAGS.OUTLINE);
    const nearestCorner = this.nearestAnchor(aMousePos, ANCHOR_FLAGS.CORNER);
    const nearestOrigin = this.nearestAnchor(aMousePos, ANCHOR_FLAGS.ORIGIN);
    let best: ANCHOR | null = null;
    let minDist = Number.MAX_VALUE;

    if (nearestOrigin) {
      minDist = nearestOrigin.Distance(aMousePos);
      best = nearestOrigin;
    }

    if (nearestCorner) {
      const dist = nearestCorner.Distance(aMousePos);

      if (dist < minDist) {
        minDist = dist;
        best = nearestCorner;
      }
    }

    if (nearestOutline) {
      const dist = nearestOutline.Distance(aMousePos);

      if (minDist > lineSnapMinCornerDistance && dist < minDist) best = nearestOutline;
    }

    return best ? { ...best.pos } : { x: aMousePos.x, y: aMousePos.y };
  }

  private bestDragOriginOn(
    aBoard: Board,
    aItems: Iterable<string>,
    aWhere: Vec2,
    aOpts: DragOriginOptions,
  ): Vec2 {
    this.m_board = aBoard;
    this.clearAnchors();
    this.computeDragAnchors(aBoard, aItems, aWhere, aOpts);

    const nearestOutline = this.nearestAnchor(aWhere, ANCHOR_FLAGS.OUTLINE);
    const nearestCorner = this.nearestAnchor(aWhere, ANCHOR_FLAGS.CORNER);
    const nearestOrigin = this.nearestAnchor(aWhere, ANCHOR_FLAGS.ORIGIN);

    let best: ANCHOR | null = null;
    let minDist = Number.MAX_VALUE;

    if (nearestOrigin) {
      minDist = nearestOrigin.Distance(aWhere);
      best = nearestOrigin;
    }

    if (nearestCorner) {
      const d = nearestCorner.Distance(aWhere);
      if (d < minDist) {
        minDist = d;
        best = nearestCorner;
      }
    }

    if (nearestOutline) {
      const d = nearestOutline.Distance(aWhere);
      if (minDist > (aOpts.lineSnapMinCornerDistance ?? 0) && d < minDist) best = nearestOutline;
    }

    return best ? { x: best.pos.x, y: best.pos.y } : { x: aWhere.x, y: aWhere.y };
  }
}

/**
 * `Align( aPoint )` for one event's state: the grid round, and the auxiliary
 * axis that keeps a gesture's origin reachable off-grid — both the base's.
 */
export function align(aPoint: Vec2, aGrid: PcbGridState): Vec2 {
  return new PCB_GRID_HELPER(aGrid).Align(aPoint);
}
