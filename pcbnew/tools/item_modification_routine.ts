// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/item_modification_routine.h` / `item_modification_routine.cpp`:
 * `PAIRWISE_LINE_ROUTINE` (fillet/chamfer/extend/dogbone), `OUTSET_ROUTINE` and
 * `POLYGON_BOOLEAN_ROUTINE`, the three item-modification routines
 * `EDIT_TOOL` drives — one file upstream, kept as one here.
 */

import { boardItemBBox, parseBoardItemId, tessellateArc } from '../edit-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import {
  chamferLinePair,
  computeDogbone,
  extendLinePair,
  filletLinePair,
  sharedEndpoint,
  type Seg,
} from '@ziroeda/kimath/src/geometry/corner_operations.js';
import {
  booleanAdd,
  booleanIntersection,
  booleanSubtract,
  fractureSingle,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import type { Board, PcbShape } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { SHAPE_T, FILL_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { FULL_CIRCLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetClampedCoords } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';

// ---------------------------------------------------------------------------
// ITEM_MODIFICATION_ROUTINE and the routines EDIT_TOOL drives, on the live
// BOARD (item_modification_routine.h / .cpp). The pure functions further down
// are the view-board forms they replaced (TRANSITIONAL, #636 stage 3: deleted
// with the window code that still calls them).
// ---------------------------------------------------------------------------

/**
 * `ITEM_MODIFICATION_ROUTINE::CHANGE_HANDLER`: how a routine reports what it
 * did - a new item, a modified one, a deleted one - so the caller can put it in
 * a commit.
 */
export interface CHANGE_HANDLER {
  /** Report that the tool has created a new item. The handler takes ownership. */
  AddNewItem(aItem: BOARD_ITEM): void;
  /** Report that the tool has modified an item. Call this BEFORE the change. */
  MarkItemModified(aItem: BOARD_ITEM): void;
  /** Report that the tool has deleted an item. */
  DeleteItem(aItem: BOARD_ITEM): void;
}

/** `CALLABLE_BASED_HANDLER`: a CHANGE_HANDLER made of three callables. */
export class CALLABLE_BASED_HANDLER implements CHANGE_HANDLER {
  constructor(
    readonly m_creationHandler: (aItem: BOARD_ITEM) => void,
    readonly m_modificationHandler: (aItem: BOARD_ITEM) => void,
    readonly m_deletionHandler: (aItem: BOARD_ITEM) => void,
  ) {}

  AddNewItem(aItem: BOARD_ITEM): void {
    this.m_creationHandler(aItem);
  }

  MarkItemModified(aItem: BOARD_ITEM): void {
    this.m_modificationHandler(aItem);
  }

  DeleteItem(aItem: BOARD_ITEM): void {
    this.m_deletionHandler(aItem);
  }
}

/** Check if two segments share an endpoint (can be at either end of either segment). */
function SegmentsShareEndpoint(aSegA: SEG, aSegB: SEG): boolean {
  const eq = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    p.x === q.x && p.y === q.y;

  return (
    eq(aSegA.A, aSegB.A) || eq(aSegA.A, aSegB.B) || eq(aSegA.B, aSegB.A) || eq(aSegA.B, aSegB.B)
  );
}

/**
 * `GetSharedEndpoints( aSegA, aSegB )`: which end of each segment is the shared
 * one. C++ returns pointers into the two SEGs; here, the ends' names.
 */
function GetSharedEndpoints(aSegA: SEG, aSegB: SEG): ['A' | 'B', 'A' | 'B'] | null {
  const eq = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    p.x === q.x && p.y === q.y;

  if (eq(aSegA.A, aSegB.A)) return ['A', 'A'];
  if (eq(aSegA.A, aSegB.B)) return ['A', 'B'];
  if (eq(aSegA.B, aSegB.A)) return ['B', 'A'];
  if (eq(aSegA.B, aSegB.B)) return ['B', 'B'];

  return null;
}

/**
 * `ITEM_MODIFICATION_ROUTINE`: an operation on board items that reports its
 * changes to a CHANGE_HANDLER and counts its successes and failures.
 */
export abstract class ITEM_MODIFICATION_ROUTINE {
  private m_numSuccesses = 0;
  private m_numFailures = 0;

  constructor(
    private readonly m_board: BOARD_ITEM | null,
    private readonly m_handler: CHANGE_HANDLER,
  ) {}

  GetSuccesses(): number {
    return this.m_numSuccesses;
  }

  GetFailures(): number {
    return this.m_numFailures;
  }

  abstract GetCommitDescription(): string;

  /** The board (or footprint) new items are created in. */
  protected GetBoard(): BOARD_ITEM | null {
    return this.m_board;
  }

  protected AddSuccess(): void {
    ++this.m_numSuccesses;
  }

  protected AddFailure(): void {
    ++this.m_numFailures;
  }

  /**
   * Helper function useful for multiple tools: modify a line or delete it if it
   * has zero length.
   *
   * @return true if the line was removed.
   */
  protected ModifyLineOrDeleteIfZeroLength(aLine: PCB_SHAPE, aSeg: SEG | null): boolean {
    const removed = aSeg === null || aSeg.Length() === 0;

    if (!removed) {
      // Mark modified, then change it
      this.GetHandler().MarkItemModified(aLine);
      aLine.SetStart(aSeg.A);
      aLine.SetEnd(aSeg.B);
    } else {
      // The line has become zero length - delete it
      this.GetHandler().DeleteItem(aLine);
    }

    return removed;
  }

  protected GetHandler(): CHANGE_HANDLER {
    return this.m_handler;
  }
}

/** `PAIRWISE_LINE_ROUTINE`: a routine run on every pair of lines in a selection. */
export abstract class PAIRWISE_LINE_ROUTINE extends ITEM_MODIFICATION_ROUTINE {
  /** Perform the action on the pair of lines given. */
  abstract ProcessLinePair(aLineA: PCB_SHAPE, aLineB: PCB_SHAPE): void;

  /** Get a status message to show when the routine is complete, if any. */
  abstract GetStatusMessage(aSegmentCount: number): string | null;
}

/** `LINE_FILLET_ROUTINE`: fillet two lines that share an endpoint. */
export class LINE_FILLET_ROUTINE extends PAIRWISE_LINE_ROUTINE {
  constructor(
    aBoard: BOARD_ITEM | null,
    aHandler: CHANGE_HANDLER,
    private readonly m_filletRadiusIU: number,
  ) {
    super(aBoard, aHandler);
  }

  GetCommitDescription(): string {
    return 'Fillet Lines';
  }

  GetStatusMessage(aSegmentCount: number): string | null {
    if (this.GetSuccesses() === 0) return 'Unable to fillet the selected lines.';
    else if (this.GetFailures() > 0 || this.GetSuccesses() < aSegmentCount - 1)
      return 'Some of the lines could not be filleted.';

    return null;
  }

  ProcessLinePair(aLineA: PCB_SHAPE, aLineB: PCB_SHAPE): void {
    if (aLineA.GetLength() === 0.0 || aLineB.GetLength() === 0.0) return;

    const seg_a = new SEG(aLineA.GetStart(), aLineA.GetEnd());
    const seg_b = new SEG(aLineB.GetStart(), aLineB.GetEnd());
    const shared = GetSharedEndpoints(seg_a, seg_b);

    if (!shared) {
      // The lines do not share an endpoint, so we can't fillet them
      return;
    }

    if (seg_a.Angle(seg_b).IsHorizontal()) return;

    const sArc = new SHAPE_ARC(seg_a, seg_b, this.m_filletRadiusIU);
    const t1newPoint = { x: 0, y: 0 };
    const t2newPoint = { x: 0, y: 0 };

    const setIfPointOnSeg = (
      aPointToSet: { x: number; y: number },
      aSegment: SEG,
      aVecToTest: { x: number; y: number },
    ): boolean => {
      const n = aSegment.NearestPoint(aVecToTest);
      const segToVec = { x: n.x - aVecToTest.x, y: n.y - aVecToTest.y };

      // Find out if we are on the segment (minimum precision)
      if (Math.hypot(segToVec.x, segToVec.y) < SHAPE.MIN_PRECISION_IU) {
        aPointToSet.x = aVecToTest.x;
        aPointToSet.y = aVecToTest.y;
        return true;
      }

      return false;
    };

    //Do not draw a fillet if the end points of the arc are not within the track segments
    if (
      !setIfPointOnSeg(t1newPoint, seg_a, sArc.GetP0()) &&
      !setIfPointOnSeg(t2newPoint, seg_b, sArc.GetP0())
    ) {
      this.AddFailure();
      return;
    }

    if (
      !setIfPointOnSeg(t1newPoint, seg_a, sArc.GetP1()) &&
      !setIfPointOnSeg(t2newPoint, seg_b, sArc.GetP1())
    ) {
      this.AddFailure();
      return;
    }

    const tArc = new PCB_SHAPE(this.GetBoard(), SHAPE_T.ARC);

    tArc.SetArcGeometry(sArc.GetP0(), sArc.GetArcMid(), sArc.GetP1());

    // Copy properties from one of the source lines
    tArc.SetWidth(aLineA.GetWidth());
    tArc.SetLayer(aLineA.GetLayer());
    tArc.SetLocked(aLineA.IsLocked());

    const handler = this.GetHandler();

    handler.AddNewItem(tArc);

    seg_a[shared[0]] = { ...t1newPoint };
    seg_b[shared[1]] = { ...t2newPoint };

    this.ModifyLineOrDeleteIfZeroLength(aLineA, seg_a);
    this.ModifyLineOrDeleteIfZeroLength(aLineB, seg_b);

    this.AddSuccess();
  }
}

/** `CHAMFER_PARAMS` (geometry/corner_operations.h). */
export interface CHAMFER_PARAMS {
  m_chamfer_setback_a: number;
  m_chamfer_setback_b: number;
}

/** `LINE_CHAMFER_ROUTINE`: chamfer two lines that share an endpoint. */
export class LINE_CHAMFER_ROUTINE extends PAIRWISE_LINE_ROUTINE {
  constructor(
    aBoard: BOARD_ITEM | null,
    aHandler: CHANGE_HANDLER,
    private readonly m_chamferParams: CHAMFER_PARAMS,
  ) {
    super(aBoard, aHandler);
  }

  GetCommitDescription(): string {
    return 'Chamfer Lines';
  }

  GetStatusMessage(aSegmentCount: number): string | null {
    if (this.GetSuccesses() === 0) return 'Unable to chamfer the selected lines.';
    else if (this.GetFailures() > 0 || this.GetSuccesses() < aSegmentCount - 1)
      return 'Some of the lines could not be chamfered.';

    return null;
  }

  ProcessLinePair(aLineA: PCB_SHAPE, aLineB: PCB_SHAPE): void {
    if (aLineA.GetLength() === 0.0 || aLineB.GetLength() === 0.0) return;

    const seg_a = new SEG(aLineA.GetStart(), aLineA.GetEnd());
    const seg_b = new SEG(aLineB.GetStart(), aLineB.GetEnd());

    // If the segments share an endpoint, we won't try to chamfer them
    // (we could extend to the intersection point, but this gets complicated
    // and inconsistent when you select more than two lines)
    if (!SegmentsShareEndpoint(seg_a, seg_b)) {
      // not an error, lots of lines in a 2+ line selection will not intersect
      return;
    }

    // ComputeChamferPoints( seg_a, seg_b, m_chamferParams )
    const chamfer_result = chamferLinePair(
      { a: seg_a.A, b: seg_a.B },
      { a: seg_b.A, b: seg_b.B },
      this.m_chamferParams.m_chamfer_setback_a,
      this.m_chamferParams.m_chamfer_setback_b,
    );

    if (!chamfer_result) {
      this.AddFailure();
      return;
    }

    const tSegment = new PCB_SHAPE(this.GetBoard(), SHAPE_T.SEGMENT);

    tSegment.SetStart(chamfer_result.chamfer.a);
    tSegment.SetEnd(chamfer_result.chamfer.b);

    // Copy properties from one of the source lines
    tSegment.SetWidth(aLineA.GetWidth());
    tSegment.SetLayer(aLineA.GetLayer());
    tSegment.SetLocked(aLineA.IsLocked());

    const handler = this.GetHandler();

    handler.AddNewItem(tSegment);

    this.ModifyLineOrDeleteIfZeroLength(aLineA, toSEG(chamfer_result.updatedA));
    this.ModifyLineOrDeleteIfZeroLength(aLineB, toSEG(chamfer_result.updatedB));

    this.AddSuccess();
  }
}

/** A corner_operations result segment as a SEG; null stays null. */
function toSEG(aSeg: Seg | null): SEG | null {
  return aSeg ? new SEG(aSeg.a, aSeg.b) : null;
}

/** `LINE_EXTENSION_ROUTINE`: extend two lines to meet at their intersection. */
export class LINE_EXTENSION_ROUTINE extends PAIRWISE_LINE_ROUTINE {
  GetCommitDescription(): string {
    return 'Extend Lines to Meet';
  }

  GetStatusMessage(aSegmentCount: number): string | null {
    if (this.GetSuccesses() === 0) return 'Unable to extend the selected lines to meet.';
    else if (this.GetFailures() > 0 || this.GetSuccesses() < aSegmentCount - 1)
      return 'Some of the lines could not be extended to meet.';

    return null;
  }

  ProcessLinePair(aLineA: PCB_SHAPE, aLineB: PCB_SHAPE): void {
    if (aLineA.GetLength() === 0.0 || aLineB.GetLength() === 0.0) return;

    const seg_a = new SEG(aLineA.GetStart(), aLineA.GetEnd());
    const seg_b = new SEG(aLineB.GetStart(), aLineB.GetEnd());

    if (seg_a.Intersects(seg_b)) {
      // already intersecting, nothing to do
      return;
    }

    const intersection = seg_a.IntersectLines(seg_b);

    if (!intersection) {
      // This might be an error, but it's also possible that the lines are
      // parallel and don't intersect.  We'll just ignore this case.
      return;
    }

    const handler = this.GetHandler();

    const line_extender = (aSeg: SEG, aLine: PCB_SHAPE): void => {
      // If the intersection point is not already n the line, we'll extend to it
      if (!aSeg.Contains(intersection)) {
        const dist_start = Math.trunc(
          Math.hypot(intersection.x - aSeg.A.x, intersection.y - aSeg.A.y),
        );
        const dist_end = Math.trunc(
          Math.hypot(intersection.x - aSeg.B.x, intersection.y - aSeg.B.y),
        );
        const furthest_pt = dist_start < dist_end ? aSeg.B : aSeg.A;
        // Note, the drawing tool has COORDS_PADDING of 20mm, but we need a larger buffer
        // or we are not able to select the generated segments
        const edge_padding = pcbIUScale.mmToIU(200);
        const new_end = GetClampedCoords(intersection, edge_padding, true);

        handler.MarkItemModified(aLine);
        aLine.SetStart(furthest_pt);
        aLine.SetEnd(new_end);
      }
    };

    line_extender(seg_a, aLineA);
    line_extender(seg_b, aLineB);

    this.AddSuccess();
  }
}

/** `DOGBONE_CORNER_ROUTINE::PARAMETERS`. */
export interface DOGBONE_PARAMETERS {
  DogboneRadiusIU: number;
  AddSlots: boolean;
}

/** `DOGBONE_CORNER_ROUTINE`: add a dogbone (cutter relief) to a pair of lines. */
export class DOGBONE_CORNER_ROUTINE extends PAIRWISE_LINE_ROUTINE {
  private m_haveNarrowMouths = false;

  constructor(
    aBoard: BOARD_ITEM | null,
    aHandler: CHANGE_HANDLER,
    private readonly m_params: DOGBONE_PARAMETERS,
  ) {
    super(aBoard, aHandler);
  }

  GetCommitDescription(): string {
    return 'Dogbone Corners';
  }

  GetStatusMessage(aSegmentCount: number): string | null {
    let msg = '';

    if (this.GetSuccesses() === 0) msg += 'Unable to add dogbone corners to the selected lines.';
    else if (this.GetFailures() > 0 || this.GetSuccesses() < aSegmentCount - 1)
      msg += 'Some of the lines could not have dogbone corners added.';

    if (this.m_haveNarrowMouths) {
      if (msg !== '') msg += ' ';

      msg += 'Some of the dogbone corners are too narrow to fit a cutter of the specified radius.';

      if (!this.m_params.AddSlots) msg += " Consider enabling the 'Add Slots' option.";
      else msg += ' Slots were added.';
    }

    if (msg === '') return null;

    return msg;
  }

  ProcessLinePair(aLineA: PCB_SHAPE, aLineB: PCB_SHAPE): void {
    if (aLineA.GetLength() === 0.0 || aLineB.GetLength() === 0.0) return;

    const seg_a = new SEG(aLineA.GetStart(), aLineA.GetEnd());
    const seg_b = new SEG(aLineB.GetStart(), aLineB.GetEnd());

    if (!GetSharedEndpoints(seg_a, seg_b)) return;

    // Cannot handle parallel lines
    if (seg_a.Angle(seg_b).IsHorizontal()) {
      this.AddFailure();
      return;
    }

    const dogbone_result = computeDogbone(
      { a: seg_a.A, b: seg_a.B },
      { a: seg_b.A, b: seg_b.B },
      this.m_params.DogboneRadiusIU,
      this.m_params.AddSlots,
    );

    if (!dogbone_result) {
      this.AddFailure();
      return;
    }

    if (dogbone_result.smallArcMouth) {
      // The arc is too small to fit the radius
      this.m_haveNarrowMouths = true;
    }

    const handler = this.GetHandler();
    const tArc = new PCB_SHAPE(this.GetBoard(), SHAPE_T.ARC);

    const copyProps = (aShape: PCB_SHAPE): void => {
      aShape.SetWidth(aLineA.GetWidth());
      aShape.SetLayer(aLineA.GetLayer());
      aShape.SetLocked(aLineA.IsLocked());
    };

    const addSegment = (aSeg: SEG): void => {
      if (aSeg.Length() === 0) return;

      const tSegment = new PCB_SHAPE(this.GetBoard(), SHAPE_T.SEGMENT);

      tSegment.SetStart(aSeg.A);
      tSegment.SetEnd(aSeg.B);
      copyProps(tSegment);
      handler.AddNewItem(tSegment);
    };

    const { start, mid, end } = dogbone_result.arc;

    tArc.SetArcGeometry(start, mid, end);

    // Copy properties from one of the source lines
    copyProps(tArc);

    // `m_updated_seg_a->B`: where the line now ends. An updated segment of no
    // length is null here, and then the line ends where the arc does.
    addSegment(new SEG(start, dogbone_result.updatedA?.b ?? start));
    addSegment(new SEG(end, dogbone_result.updatedB?.b ?? end));

    handler.AddNewItem(tArc);

    this.ModifyLineOrDeleteIfZeroLength(aLineA, toSEG(dogbone_result.updatedA));
    this.ModifyLineOrDeleteIfZeroLength(aLineB, toSEG(dogbone_result.updatedB));

    this.AddSuccess();
  }
}

/** `POLYGON_BOOLEAN_ROUTINE`: a boolean over a set of polygon-ish shapes. */
export abstract class POLYGON_BOOLEAN_ROUTINE extends ITEM_MODIFICATION_ROUTINE {
  /// This can be disjoint, which will be fixed at the end
  private m_workingPolygons = new SHAPE_POLY_SET();
  private m_firstPolygon = true;
  private m_width = 0;
  private m_layer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  private m_fillMode: FILL_T = FILL_T.NO_FILL;

  /**
   * Whether the order of the polygons matters: when it does not, EDIT_TOOL
   * does not retry an empty result the other way round.
   */
  abstract IsCommutative(): boolean;

  ProcessShape(aPcbShape: PCB_SHAPE): void {
    let poly: SHAPE_POLY_SET | null = null;

    switch (aPcbShape.GetShape()) {
      case SHAPE_T.POLY:
        poly = new SHAPE_POLY_SET(aPcbShape.GetPolyShape());
        // Arcs cannot be handled by polygon boolean transforms
        poly.ClearArcs();
        break;

      case SHAPE_T.RECTANGLE: {
        poly = new SHAPE_POLY_SET();
        const rect_pts = aPcbShape.GetRectCorners();
        poly.NewOutline();

        for (const pt of rect_pts) poly.Append(pt);

        break;
      }

      case SHAPE_T.CIRCLE: {
        poly = new SHAPE_POLY_SET();
        const c = aPcbShape.GetCenter();
        const arc = new SHAPE_ARC(c, { x: c.x + aPcbShape.GetRadius(), y: c.y }, FULL_CIRCLE, 0);
        poly.NewOutline();
        poly.Append(arc);
        break;
      }

      default:
        break;
    }

    if (!poly) {
      // Not a polygon or rectangle, nothing to do
      return;
    }

    if (this.m_firstPolygon) {
      this.m_width = aPcbShape.GetWidth();
      this.m_layer = aPcbShape.GetLayer();
      this.m_fillMode = aPcbShape.GetFillMode();
      this.m_workingPolygons = poly;
      this.m_firstPolygon = false;

      // Boolean ops work, but assert on arcs
      this.m_workingPolygons.ClearArcs();

      this.GetHandler().DeleteItem(aPcbShape);
    } else {
      if (this.ProcessSubsequentPolygon(poly)) {
        // If we could process the polygon, delete the source
        this.GetHandler().DeleteItem(aPcbShape);
        this.AddSuccess();
      } else {
        this.AddFailure();
      }
    }
  }

  /** Clear up any outstanding work: the working polygons become new shapes. */
  Finalize(): void {
    if (this.m_workingPolygons.OutlineCount() === 0 || this.m_firstPolygon) {
      // Nothing to do (no polygons handled or nothing left?)
      return;
    }

    const handler = this.GetHandler();

    // If we have disjoint polygons, we'll fix that now and create
    // new PCB_SHAPEs for each outline
    for (let i = 0; i < this.m_workingPolygons.OutlineCount(); ++i) {
      // If we handled any polygons to get any outline,
      // there must be a layer set by now.
      const new_poly_shape = new PCB_SHAPE(this.GetBoard(), SHAPE_T.POLY);

      const poly_set = this.m_workingPolygons.UnitSet(i);
      new_poly_shape.SetPolyShape(poly_set);

      // Copy properties from the source polygon
      new_poly_shape.SetWidth(this.m_width);
      new_poly_shape.SetLayer(this.m_layer);
      new_poly_shape.SetFillMode(this.m_fillMode);

      handler.AddNewItem(new_poly_shape);
    }
  }

  /** Get a status message to show when the routine is complete, if any. */
  abstract GetStatusMessage(): string | null;

  protected GetWorkingPolygons(): SHAPE_POLY_SET {
    return this.m_workingPolygons;
  }

  protected SetWorkingPolygons(aPolys: SHAPE_POLY_SET): void {
    this.m_workingPolygons = aPolys;
  }

  protected abstract ProcessSubsequentPolygon(aPolygon: SHAPE_POLY_SET): boolean;
}

/** `POLYGON_MERGE_ROUTINE`. */
export class POLYGON_MERGE_ROUTINE extends POLYGON_BOOLEAN_ROUTINE {
  IsCommutative(): boolean {
    return true;
  }

  GetCommitDescription(): string {
    return 'Merge Polygons';
  }

  GetStatusMessage(): string | null {
    if (this.GetSuccesses() === 0) return 'Unable to merge the selected polygons.';
    else if (this.GetFailures() > 0) return 'Some of the polygons could not be merged.';

    return null;
  }

  protected ProcessSubsequentPolygon(aPolygon: SHAPE_POLY_SET): boolean {
    const no_arcs_poly = new SHAPE_POLY_SET(aPolygon);
    no_arcs_poly.ClearArcs();

    this.GetWorkingPolygons().BooleanAdd(no_arcs_poly);
    return true;
  }
}

/** `POLYGON_SUBTRACT_ROUTINE`. */
export class POLYGON_SUBTRACT_ROUTINE extends POLYGON_BOOLEAN_ROUTINE {
  IsCommutative(): boolean {
    return false;
  }

  GetCommitDescription(): string {
    return 'Subtract Polygons';
  }

  GetStatusMessage(): string | null {
    if (this.GetSuccesses() === 0) return 'Unable to subtract the selected polygons.';
    else if (this.GetFailures() > 0) return 'Some of the polygons could not be subtracted.';

    return null;
  }

  protected ProcessSubsequentPolygon(aPolygon: SHAPE_POLY_SET): boolean {
    const working_copy = new SHAPE_POLY_SET(this.GetWorkingPolygons());

    const no_arcs_poly = new SHAPE_POLY_SET(aPolygon);
    no_arcs_poly.ClearArcs();

    working_copy.BooleanSubtract(no_arcs_poly);

    this.SetWorkingPolygons(working_copy);
    return true;
  }
}

/** `POLYGON_INTERSECT_ROUTINE`. */
export class POLYGON_INTERSECT_ROUTINE extends POLYGON_BOOLEAN_ROUTINE {
  IsCommutative(): boolean {
    return true;
  }

  GetCommitDescription(): string {
    return 'Intersect Polygons';
  }

  GetStatusMessage(): string | null {
    if (this.GetSuccesses() === 0) return 'Unable to intersect the selected polygons.';
    else if (this.GetFailures() > 0) return 'Some of the polygons could not be intersected.';

    return null;
  }

  protected ProcessSubsequentPolygon(aPolygon: SHAPE_POLY_SET): boolean {
    const working_copy = new SHAPE_POLY_SET(this.GetWorkingPolygons());

    const no_arcs_poly = new SHAPE_POLY_SET(aPolygon);
    no_arcs_poly.ClearArcs();

    working_copy.BooleanIntersection(no_arcs_poly);

    // Is there anything left?
    if (working_copy.OutlineCount() === 0) {
      // There was no intersection. Rather than deleting the working polygon, we'll skip
      // and report a failure.
      return false;
    }

    this.SetWorkingPolygons(working_copy);
    return true;
  }
}

// ---------------------------------------------------------------------------
// PAIRWISE_LINE_ROUTINE: fillet, chamfer, extend and dogbone selected lines.
// ---------------------------------------------------------------------------
/**
 * Fillet, chamfer and extend selected lines.
 * Counterparts: `PAIRWISE_LINE_ROUTINE` and its three subclasses in
 * `pcbnew/tools/item_modification_routine.cpp`, driven by `EDIT_TOOL::ModifyLines`.
 *
 * The geometry lives in kimath (corner_operations.ts); this decides which pairs
 * to try and writes the answer back to the board.
 *
 * Every *unordered pair* in the selection is tried, not just adjacent ones —
 * upstream's `alg::for_all_pairs`. That sounds wasteful and is the point: the
 * user selects a handful of lines and expects every corner among them to be
 * worked on, without having to select them in drawing order.
 *
 * A pair that cannot be worked on is skipped rather than failing the run, so
 * the counts come back as successes and failures for the status line. The
 * distinction upstream draws, and this keeps: a pair that simply does not meet
 * is *not* a failure, while a pair that meets but whose radius will not fit is.
 */

export type LineModification = 'fillet' | 'chamfer' | 'extend' | 'dogbone';

export interface ModifyLinesOptions {
  /** Fillet only. */
  radius?: number;
  /** Chamfer only; the set-back along each line. */
  setback?: number;
  /** Dogbone only; the router bit's radius. */
  dogboneRadius?: number;
  /**
   * Dogbone only: widen a pocket whose mouth is narrower than the bit into the
   * minimal slot that lets the bit in. Without it an acute corner produces a
   * pocket no cutter can actually reach.
   */
  addSlots?: boolean;
}

export interface ModifyLinesResult {
  board: Board;
  /** Pairs the operation was applied to. */
  successes: number;
  /**
   * Pairs that met at a corner but could not be worked on — a radius too big
   * for the corner, say. Pairs that never met at all are not counted: they were
   * never candidates.
   */
  failures: number;
}

/** A selected item usable as a straight line. */
interface LineRef {
  index: number;
  shape: PcbShape;
  seg: Seg;
}

function lineRefs(board: Board, selection: Iterable<string>): LineRef[] {
  const out: LineRef[] = [];

  for (const id of selection) {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'shape') continue;

    const s = board.shapes[r.index];
    if (!s || s.kind !== 'line' || !s.start || !s.end) continue;
    // A zero-length line has no direction, so no corner can be formed with it.
    if (s.start.x === s.end.x && s.start.y === s.end.y) continue;

    out.push({ index: r.index, shape: s, seg: { a: s.start, b: s.end } });
  }

  return out;
}

/** An arc graphic taking its stroke and layer from the line it came from. */
function arcFrom(src: PcbShape, pts: { start: Vec2; mid: Vec2; end: Vec2 }): PcbShape {
  return {
    kind: 'arc',
    start: pts.start,
    mid: pts.mid,
    end: pts.end,
    width: src.width,
    strokeType: src.strokeType,
    fillMode: 'none',
    layer: src.layer,
    locked: src.locked,
  };
}

/** A line graphic taking its stroke and layer from the line it came from. */
function lineFrom(src: PcbShape, seg: Seg): PcbShape {
  return {
    ...src,
    kind: 'line',
    start: seg.a,
    end: seg.b,
    // The source node still describes the old endpoints; dropping it makes the
    // writer rebuild the shape from the model rather than emit stale geometry.
  };
}

/**
 * `EDIT_TOOL::ModifyLines`: apply one of the three corner operations to every
 * pair of selected lines.
 *
 * Lines consumed entirely — a fillet or chamfer that reaches the far end — are
 * deleted, which is `ModifyLineOrDeleteIfZeroLength`.
 */
export function modifyLines(
  board: Board,
  selection: Iterable<string>,
  op: LineModification,
  opts: ModifyLinesOptions = {},
): ModifyLinesResult {
  const lines = lineRefs(board, selection);
  if (lines.length < 2) return { board, successes: 0, failures: 0 };

  // Worked on in place, so a line that takes part in two corners is shortened
  // by both — which is what makes filleting a whole rectangle in one go work.
  const segs = new Map<number, Seg>(lines.map((l) => [l.index, l.seg]));
  const deleted = new Set<number>();
  const added: PcbShape[] = [];

  let successes = 0;
  let failures = 0;

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (deleted.has(a.index) || deleted.has(b.index)) continue;

      const segA = segs.get(a.index)!;
      const segB = segs.get(b.index)!;

      if (op === 'extend') {
        const res = extendLinePair(segA, segB);
        if (!res) continue;
        if (res.updatedA) segs.set(a.index, res.updatedA);
        if (res.updatedB) segs.set(b.index, res.updatedB);
        successes++;
        continue;
      }

      // Fillet and chamfer both need a shared corner. Not sharing one is not a
      // failure — most pairs in a selection do not.
      if (!sharedEndpoint(segA, segB)) continue;

      const res =
        op === 'fillet'
          ? filletLinePair(segA, segB, opts.radius ?? 0)
          : op === 'dogbone'
            ? computeDogbone(segA, segB, opts.dogboneRadius ?? 0, opts.addSlots ?? false)
            : chamferLinePair(segA, segB, opts.setback ?? 0, opts.setback ?? 0);

      if (!res) {
        // They met, and it still could not be done: the radius or set-back does
        // not fit this corner.
        failures++;
        continue;
      }

      if ('arc' in res) added.push(arcFrom(a.shape, res.arc));
      else added.push(lineFrom(a.shape, res.chamfer));

      if (res.updatedA) segs.set(a.index, res.updatedA);
      else deleted.add(a.index);

      if (res.updatedB) segs.set(b.index, res.updatedB);
      else deleted.add(b.index);

      successes++;
    }
  }

  if (successes === 0) return { board, successes: 0, failures };

  const shapes = board.shapes
    .map((s, i) => {
      if (deleted.has(i)) return null;
      const seg = segs.get(i);
      if (!seg || (seg.a === s.start && seg.b === s.end)) return s;
      return lineFrom(s, seg);
    })
    .filter((s): s is PcbShape => s !== null);

  return { board: { ...board, shapes: [...shapes, ...added] }, successes, failures };
}

/** Ids of the lines a modification would consider, for enabling the menu. */
export function modifiableLineCount(board: Board, selection: Iterable<string>): number {
  return lineRefs(board, selection).length;
}

// ---------------------------------------------------------------------------
// OUTSET_ROUTINE: draw a shape a fixed distance outside another one.
// ---------------------------------------------------------------------------
/**
 * Outset Items: draw a shape a fixed distance outside another one.
 * Counterpart: `OUTSET_ROUTINE` in `pcbnew/tools/item_modification_routine.cpp`.
 *
 * The point of the tool is making a courtyard from a footprint's pads, so the
 * result wants to be a *clean* shape — a rectangle that is still a rectangle, a
 * circle still a circle — not a many-sided approximation.
 *
 * That is why this does exact per-shape outsetting rather than offsetting
 * through Clipper, which is upstream's choice and its stated reason: "This
 * attempts to do exact outsetting, rather than punting to Clipper. So it can't
 * do all shapes, but it can do the most obvious ones, which are probably the
 * ones you want to outset anyway." Shapes it cannot do exactly fall back to
 * their bounding box, which is honest about being an approximation in a way
 * that a 200-sided polygon is not.
 */

export interface OutsetOptions {
  /** How far outside the source to draw, in IU. */
  distance: number;
  /**
   * Round the corners the outset introduces. A rectangle outset with rounded
   * corners becomes a rounded rectangle — which is what a courtyard around a
   * rectangular pad actually wants — while a square outset stays a rectangle.
   */
  roundCorners?: boolean;
  /** Layer for the new shapes; the source item's own layer when absent. */
  layer?: string;
  /** Width for the new shapes; the source item's own width when absent. */
  lineWidth?: number;
  /** Snap the result outwards onto a grid of this pitch, `gridRounding`. */
  gridRounding?: number;
  /** `deleteSourceItems`. */
  deleteSourceItems?: boolean;
}

export interface OutsetResult {
  board: Board;
  successes: number;
  /** Items whose outset would collapse to nothing, or which are not supported. */
  failures: number;
}

const roundDown = (v: number, grid: number): number => Math.floor(v / grid) * grid;
const roundUp = (v: number, grid: number): number => Math.ceil(v / grid) * grid;

/**
 * `GetRectRoundedToGridOutwards`: grow the box to the nearest grid lines that
 * contain it. Outwards on both corners, never inwards — a courtyard snapped
 * inwards would be smaller than the clearance asked for.
 */
export function roundRectOutwards(min: Vec2, max: Vec2, grid: number): { min: Vec2; max: Vec2 } {
  return {
    min: { x: roundDown(min.x, grid), y: roundDown(min.y, grid) },
    max: { x: roundUp(max.x, grid), y: roundUp(max.y, grid) },
  };
}

/** A rounded rectangle as a point ring: four corner arcs joined by four sides. */
function roundedRectRing(min: Vec2, max: Vec2, radius: number): Vec2[] {
  const r = Math.min(radius, (max.x - min.x) / 2, (max.y - min.y) / 2);
  if (r <= 0) {
    return [
      { x: min.x, y: min.y },
      { x: max.x, y: min.y },
      { x: max.x, y: max.y },
      { x: min.x, y: max.y },
    ];
  }

  // Each corner is a quarter turn about a centre inset by the radius; the arc's
  // mid point is at 45°, which is what the tessellator needs to know the sweep.
  const arcAt = (cx: number, cy: number, a0: number, a1: number): Vec2[] => {
    const mid = (a0 + a1) / 2;
    return tessellateArc(
      { x: Math.round(cx + r * Math.cos(a0)), y: Math.round(cy + r * Math.sin(a0)) },
      { x: Math.round(cx + r * Math.cos(mid)), y: Math.round(cy + r * Math.sin(mid)) },
      { x: Math.round(cx + r * Math.cos(a1)), y: Math.round(cy + r * Math.sin(a1)) },
    );
  };

  const H = Math.PI / 2;
  return [
    // Top-left corner, sweeping from pointing left to pointing up.
    ...arcAt(min.x + r, min.y + r, Math.PI, Math.PI + H),
    ...arcAt(max.x - r, min.y + r, Math.PI + H, 2 * Math.PI).slice(1),
    ...arcAt(max.x - r, max.y - r, 0, H).slice(1),
    ...arcAt(min.x + r, max.y - r, H, Math.PI).slice(1, -1),
  ];
}

/**
 * A segment's outset: the stadium around it, or its bounding rectangle.
 *
 * Upstream builds the whole closed shape rather than only the side the user
 * might want — "make the whole stadium shape and let the user delete the
 * unwanted bits" — because which side is wanted cannot be known from the
 * geometry alone.
 */
export function outsetSegmentRing(a: Vec2, b: Vec2, distance: number, round: boolean): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0 || distance <= 0) return [];

  const ex = (dx * distance) / len;
  const ey = (dy * distance) / len;
  // `GetRotated( ext, ANGLE_90 )` in the board's y-down frame.
  const px = ey;
  const py = -ex;

  if (!round) {
    return [
      { x: Math.round(a.x - ex + px), y: Math.round(a.y - ey + py) },
      { x: Math.round(a.x - ex - px), y: Math.round(a.y - ey - py) },
      { x: Math.round(b.x + ex - px), y: Math.round(b.y + ey - py) },
      { x: Math.round(b.x + ex + px), y: Math.round(b.y + ey + py) },
    ];
  }

  // The stadium: a half turn round each end, joined by the two parallel sides.
  const capA = tessellateArc(
    { x: Math.round(a.x - px), y: Math.round(a.y - py) },
    { x: Math.round(a.x - ex), y: Math.round(a.y - ey) },
    { x: Math.round(a.x + px), y: Math.round(a.y + py) },
  );
  const capB = tessellateArc(
    { x: Math.round(b.x + px), y: Math.round(b.y + py) },
    { x: Math.round(b.x + ex), y: Math.round(b.y + ey) },
    { x: Math.round(b.x - px), y: Math.round(b.y - py) },
  );

  return [...capA, ...capB];
}

/** `OUTSET_ROUTINE::ProcessItem`. */
export function outsetItems(
  board: Board,
  selection: Iterable<string>,
  opts: OutsetOptions,
): OutsetResult {
  const { distance } = opts;
  const round = opts.roundCorners ?? false;

  const added: PcbShape[] = [];
  const consumed = new Set<number>();
  let successes = 0;
  let failures = 0;

  const emit = (
    src: PcbShape | null,
    shape: Omit<PcbShape, 'source' | 'layer' | 'width'>,
  ): void => {
    added.push({
      ...shape,
      layer: opts.layer ?? src?.layer ?? 'F.CrtYd',
      width: opts.lineWidth ?? src?.width ?? 0,
    });
  };

  /** The outset box of an axis-aligned extent, or null if it collapses. */
  const boxOutset = (min: Vec2, max: Vec2): { min: Vec2; max: Vec2 } | null => {
    let lo = { x: min.x - distance, y: min.y - distance };
    let hi = { x: max.x + distance, y: max.y + distance };
    // A negative distance can shrink the box past nothing.
    if (hi.x <= lo.x || hi.y <= lo.y) return null;
    if (opts.gridRounding && opts.gridRounding > 0) {
      const g = roundRectOutwards(lo, hi, opts.gridRounding);
      lo = g.min;
      hi = g.max;
    }
    return { min: lo, max: hi };
  };

  for (const id of selection) {
    const r = parseBoardItemId(id);
    const s = r?.kind === 'shape' ? board.shapes[r.index] : undefined;

    // A rectangle stays a rectangle, unless rounded corners are asked for.
    if (s?.kind === 'rect' && s.start && s.end) {
      const min = { x: Math.min(s.start.x, s.end.x), y: Math.min(s.start.y, s.end.y) };
      const max = { x: Math.max(s.start.x, s.end.x), y: Math.max(s.start.y, s.end.y) };
      const box = boxOutset(min, max);
      if (!box) {
        failures++;
        continue;
      }

      if (round && distance > 0) {
        emit(s, {
          kind: 'poly',
          pts: roundedRectRing(box.min, box.max, distance),
          fillMode: 'none',
        });
      } else {
        emit(s, { kind: 'rect', start: box.min, end: box.max, fillMode: 'none' });
      }

      if (r) consumed.add(r.index);
      successes++;
      continue;
    }

    // A circle stays a circle, or becomes the square that contains it.
    if (s?.kind === 'circle') {
      const c = s.center ?? s.start;
      if (!c || !s.end) {
        failures++;
        continue;
      }
      const newRadius = Math.hypot(s.end.x - c.x, s.end.y - c.y) + distance;
      if (newRadius <= 0) {
        failures++;
        continue;
      }

      if (round) {
        emit(s, {
          kind: 'circle',
          center: c,
          end: { x: c.x + newRadius, y: c.y },
          fillMode: 'none',
        });
      } else {
        // The square containing the already-outset circle: upstream builds it
        // from the new radius, so the distance is not applied a second time.
        let lo = { x: c.x - newRadius, y: c.y - newRadius };
        let hi = { x: c.x + newRadius, y: c.y + newRadius };
        if (opts.gridRounding && opts.gridRounding > 0) {
          const g = roundRectOutwards(lo, hi, opts.gridRounding);
          lo = g.min;
          hi = g.max;
        }
        emit(s, { kind: 'rect', start: lo, end: hi, fillMode: 'none' });
      }

      if (r) consumed.add(r.index);
      successes++;
      continue;
    }

    // A segment becomes the whole stadium (or its rectangle): which side the
    // user wants cannot be told from the geometry.
    if (s?.kind === 'line' && s.start && s.end) {
      if (distance <= 0) {
        failures++;
        continue;
      }
      const ring = outsetSegmentRing(s.start, s.end, distance, round);
      if (ring.length < 3) {
        failures++;
        continue;
      }
      emit(s, { kind: 'poly', pts: ring, fillMode: 'none' });
      if (r) consumed.add(r.index);
      successes++;
      continue;
    }

    // Everything else falls back to its bounding box — upstream's default.
    const bb = boardItemBBox(board, id);
    if (!bb) {
      failures++;
      continue;
    }
    const box = boxOutset({ x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.maxY });
    if (!box) {
      failures++;
      continue;
    }
    emit(s ?? null, { kind: 'rect', start: box.min, end: box.max, fillMode: 'none' });
    if (r?.kind === 'shape') consumed.add(r.index);
    successes++;
  }

  if (successes === 0) return { board, successes: 0, failures };

  const kept = opts.deleteSourceItems
    ? board.shapes.filter((_, i) => !consumed.has(i))
    : board.shapes;

  return { board: { ...board, shapes: [...kept, ...added] }, successes, failures };
}

// ---------------------------------------------------------------------------
// DIALOG_OUTSET_ITEMS::TransferDataFromWindow (was outset_settings.ts)
// ---------------------------------------------------------------------------

/** One field per `PARAMETERS` member. */
export interface OutsetSettings {
  distanceIU: number;
  roundCorners: boolean;
  useSourceLayers: boolean;
  layer: string;
  useSourceWidths: boolean;
  lineWidthIU: number;
  roundToGrid: boolean;
  gridPitchIU: number;
  deleteSourceItems: boolean;
}

/** Upstream's defaults: a 0.25 mm rounded courtyard at 0.05 mm line width. */
export const DEFAULT_OUTSET_SETTINGS: OutsetSettings = {
  distanceIU: mmToIU(0.25),
  roundCorners: true,
  useSourceLayers: false,
  layer: 'F.CrtYd',
  useSourceWidths: false,
  lineWidthIU: mmToIU(0.05),
  roundToGrid: false,
  gridPitchIU: mmToIU(0.01),
  deleteSourceItems: false,
};

/**
 * What the engine should be handed for these settings.
 *
 * The two "copy from source" checkboxes are expressed by *leaving the field
 * out*: absent already means "take it from the source item" to the engine, so
 * passing a flag as well would give the same intent two spellings that could
 * disagree. Likewise the grid pitch is only sent when rounding is on, so a
 * stale pitch left in the box cannot leak into the result.
 */
export function outsetOptionsFrom(s: OutsetSettings): OutsetOptions {
  return {
    distance: s.distanceIU,
    roundCorners: s.roundCorners,
    ...(s.useSourceLayers ? {} : { layer: s.layer }),
    ...(s.useSourceWidths ? {} : { lineWidth: s.lineWidthIU }),
    ...(s.roundToGrid ? { gridRounding: s.gridPitchIU } : {}),
    deleteSourceItems: s.deleteSourceItems,
  };
}

// ---------------------------------------------------------------------------
// POLYGON_BOOLEAN_ROUTINE: merge, subtract and intersect selected polygons.
// ---------------------------------------------------------------------------
/**
 * Merge, subtract and intersect selected polygons.
 * Counterpart: `POLYGON_BOOLEAN_ROUTINE` and its three subclasses in
 * `pcbnew/tools/item_modification_routine.cpp`.
 *
 * The selection is folded left: the first polygon becomes the working set and
 * every later one is combined into it. That makes the order matter for
 * subtraction — first minus the rest — and it is why the first item also
 * decides the layer, width and fill of the result.
 *
 * All the sources are consumed. The result is written back as one shape per
 * disjoint outline, so subtracting a bar across the middle of a rectangle
 * leaves two shapes rather than one shape with a hole through it that no longer
 * describes anything connected.
 */

export type PolygonBoolean = 'merge' | 'subtract' | 'intersect';

export interface PolygonBooleanResult {
  board: Board;
  /** Sources folded into the working set. */
  successes: number;
  /**
   * Sources that could not be folded in. Only intersection produces these: an
   * empty result is refused rather than committed, so that intersecting with a
   * polygon that does not overlap leaves the working set alone instead of
   * erasing everything.
   */
  failures: number;
}

/**
 * The polygon a shape contributes, or null when it is not an area.
 * `POLYGON_BOOLEAN_ROUTINE::ProcessShape` accepts polygons, rectangles and
 * circles; everything else is silently ignored.
 *
 * Arcs are dropped from polygons, as upstream's `ClearArcs` does — Clipper works
 * on straight edges, and an arc left in would assert.
 */
export function shapeAsPolygon(s: PcbShape): Polygon | null {
  if (s.kind === 'poly' && s.pts && s.pts.length >= 3) return [[...s.pts]];

  if (s.kind === 'rect' && s.start && s.end) {
    return [
      [
        { x: s.start.x, y: s.start.y },
        { x: s.end.x, y: s.start.y },
        { x: s.end.x, y: s.end.y },
        { x: s.start.x, y: s.end.y },
      ],
    ];
  }

  if (s.kind === 'circle') {
    const c = s.center ?? s.start;
    if (!c || !s.end) return null;
    const r = Math.hypot(s.end.x - c.x, s.end.y - c.y);
    if (r === 0) return null;
    const left = { x: c.x - r, y: c.y };
    const right = { x: c.x + r, y: c.y };
    // Two half turns: one tessellation cannot express a full circle, since its
    // start and end would coincide and the sweep would be ambiguous. The second
    // half drops both its endpoints, which the first already supplied.
    return [
      [
        ...tessellateArc(left, { x: c.x, y: c.y - r }, right),
        ...tessellateArc(right, { x: c.x, y: c.y + r }, left).slice(1, -1),
      ],
    ];
  }

  return null;
}

export interface PolygonBooleanOptions {
  /** Overrides the layer the first source contributes. */
  layer?: string;
}

/** `POLYGON_BOOLEAN_ROUTINE`. */
export function polygonBoolean(
  board: Board,
  selection: Iterable<string>,
  op: PolygonBoolean,
  opts: PolygonBooleanOptions = {},
): PolygonBooleanResult {
  const sources: { index: number; shape: PcbShape; poly: Polygon }[] = [];

  for (const id of selection) {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'shape') continue;

    const s = board.shapes[r.index];
    if (!s) continue;

    const poly = shapeAsPolygon(s);
    if (poly) sources.push({ index: r.index, shape: s, poly });
  }

  // One polygon has nothing to combine with.
  if (sources.length < 2) return { board, successes: 0, failures: 0 };

  const first = sources[0]!;
  let working: Polygon[] = [first.poly];
  // Consumed sources, including the first — upstream deletes it as soon as it
  // becomes the working set.
  const consumed = new Set<number>([first.index]);

  let successes = 0;
  let failures = 0;

  for (let i = 1; i < sources.length; i++) {
    const src = sources[i]!;
    const clip = [src.poly];

    if (op === 'merge') {
      working = booleanAdd(working, clip);
    } else if (op === 'subtract') {
      working = booleanSubtract(working, clip);
    } else {
      const next = booleanIntersection(working, clip);
      if (next.length === 0) {
        // No overlap. Committing would erase the working set entirely, so
        // upstream skips the source and reports it instead.
        failures++;
        continue;
      }
      working = next;
    }

    consumed.add(src.index);
    successes++;
  }

  if (successes === 0) return { board, successes: 0, failures };

  const layer = opts.layer ?? first.shape.layer;

  // One shape per disjoint outline.
  //
  // A subtraction can leave a hole, and neither our PcbShape nor the file's
  // `(gr_poly (pts …))` can hold one — both are a single ring. So the result is
  // fractured: each hole is joined to its outline by a zero-width slit, which
  // is the same ring the renderer and the zone filler already expect elsewhere.
  const added: PcbShape[] = working.map((poly) => ({
    kind: 'poly',
    pts: fractureSingle(poly)[0]!,
    width: first.shape.width,
    strokeType: first.shape.strokeType,
    fillMode: first.shape.fillMode,
    layer,
    source: { kind: 'list', items: [] },
  }));

  const kept = board.shapes.filter((_, i) => !consumed.has(i));

  return {
    board: { ...board, shapes: [...kept, ...added] },
    successes,
    failures,
  };
}

/** Ids of the shapes a boolean would consider, for enabling the menu. */
export function booleanableShapeCount(board: Board, selection: Iterable<string>): number {
  let n = 0;
  for (const id of selection) {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'shape') continue;
    const s = board.shapes[r.index];
    if (s && shapeAsPolygon(s)) n++;
  }
  return n;
}
