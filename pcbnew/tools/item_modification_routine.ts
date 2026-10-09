// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/item_modification_routine.h` / `item_modification_routine.cpp`:
 * `PAIRWISE_LINE_ROUTINE` (fillet/chamfer/extend/dogbone), `OUTSET_ROUTINE` and
 * `POLYGON_BOOLEAN_ROUTINE`, the three item-modification routines
 * `EDIT_TOOL` drives — one file upstream, kept as one here.
 */
import {
  chamferLinePair,
  computeDogbone,
  type Seg,
} from '@ziroeda/kimath/src/geometry/corner_operations.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { PAD } from '../pad.js';
import { PAD_SHAPE, PADSTACK } from '../padstack.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ROUNDRECT } from '@ziroeda/kimath/src/geometry/roundrect.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { KIGEOM_ConvertToChain } from '@ziroeda/kimath/src/geometry/oval.js';
import { KIGEOM_RoundNW, KIGEOM_RoundSE } from '@ziroeda/kimath/src/geometry/vector_utils.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { GetRotated } from '@ziroeda/kimath/src/trigo.js';
import { ANGLE_90, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetBoardItemWidth } from './pcb_tool_utils.js';
import { ResizeI } from '@ziroeda/kimath/src/math/vector2.js';
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

/** `OUTSET_ROUTINE::PARAMETERS`. */
export interface OUTSET_PARAMETERS {
  outsetDistance: number;
  roundCorners: boolean;
  useSourceLayers: boolean;
  useSourceWidths: boolean;
  layer: PCB_LAYER_ID;
  lineWidth: number;
  gridRounding: number | null;
  deleteSourceItems: boolean;
}

function GetRectRoundedToGridOutwards(aRect: SHAPE_RECT, aGridSize: number): SHAPE_RECT {
  const newPos = KIGEOM_RoundNW(aRect.GetPosition(), aGridSize);
  const p = aRect.GetPosition();
  const sz = aRect.GetSize();
  const newOpposite = KIGEOM_RoundSE({ x: p.x + sz.x, y: p.y + sz.y }, aGridSize);
  return new SHAPE_RECT(newPos, newOpposite);
}

/**
 * `OUTSET_ROUTINE`: draw new shapes a fixed distance outside the selected
 * pads and shapes (item_modification_routine.cpp:649-1042).
 */
export class OUTSET_ROUTINE extends ITEM_MODIFICATION_ROUTINE {
  private readonly m_params: OUTSET_PARAMETERS;

  constructor(aBoard: BOARD_ITEM | null, aHandler: CHANGE_HANDLER, aParams: OUTSET_PARAMETERS) {
    super(aBoard, aHandler);
    this.m_params = { ...aParams };
  }

  GetCommitDescription(): string {
    return 'Outset Items';
  }

  GetStatusMessage(): string | null {
    if (this.GetSuccesses() === 0) return 'Unable to outset the selected items.';
    else if (this.GetFailures() > 0) return 'Some of the items could not be outset.';

    return null;
  }

  ProcessItem(aItem: BOARD_ITEM): void {
    /*
     * This attempts to do exact outsetting, rather than punting to Clipper.
     * So it can't do all shapes, but it can do the most obvious ones, which are probably
     * the ones you want to outset anyway, most usually when making a courtyard for a footprint.
     */

    const layer = this.m_params.useSourceLayers ? aItem.GetLayer() : this.m_params.layer;

    // Not all items have a width, even if the parameters want to copy it
    // So fall back to the given width if we can't get one.
    let width = this.m_params.lineWidth;

    if (this.m_params.useSourceWidths) {
      const item_width = GetBoardItemWidth(aItem);

      if (item_width !== null) width = item_width;
    }

    const handler = this.GetHandler();

    const addPolygonalChain = (aChain: SHAPE_LINE_CHAIN): void => {
      const new_poly = new SHAPE_POLY_SET(aChain);

      const new_shape = new PCB_SHAPE(this.GetBoard(), SHAPE_T.POLY);

      new_shape.SetPolyShape(new_poly);
      new_shape.SetLayer(layer);
      new_shape.SetWidth(width);

      handler.AddNewItem(new_shape);
    };

    // Iterate the SHAPE_LINE_CHAIN in the polygon, pulling out
    // segments and arcs to create new PCB_SHAPE primitives.
    const addChain = (aChain: SHAPE_LINE_CHAIN): void => {
      // Prefer to add a polygonal chain if there are no arcs
      // as this permits boolean ops
      if (aChain.ArcCount() === 0) {
        addPolygonalChain(aChain);
        return;
      }

      for (let si = 0; si < aChain.GetSegmentCount(); ++si) {
        const seg = aChain.GetSegment(si);

        if (seg.Length() === 0) continue;

        if (aChain.IsArcSegment(si)) continue;

        const new_shape = new PCB_SHAPE(this.GetBoard(), SHAPE_T.SEGMENT);
        new_shape.SetStart(seg.A);
        new_shape.SetEnd(seg.B);
        new_shape.SetLayer(layer);
        new_shape.SetWidth(width);

        handler.AddNewItem(new_shape);
      }

      for (let ai = 0; ai < aChain.ArcCount(); ++ai) {
        const arc = aChain.Arc(ai);
        const p0 = arc.GetP0();
        const p1 = arc.GetP1();

        if (arc.GetRadius() === 0 || (p0.x === p1.x && p0.y === p1.y)) continue;

        const new_shape = new PCB_SHAPE(this.GetBoard(), SHAPE_T.ARC);
        new_shape.SetArcGeometry(p0, arc.GetArcMid(), p1);
        new_shape.SetLayer(layer);
        new_shape.SetWidth(width);

        handler.AddNewItem(new_shape);
      }
    };

    const addPoly = (aPoly: SHAPE_POLY_SET): void => {
      for (let oi = 0; oi < aPoly.OutlineCount(); ++oi) {
        addChain(aPoly.Outline(oi));
      }
    };

    const addRect = (aRect: SHAPE_RECT): void => {
      const new_shape = new PCB_SHAPE(this.GetBoard(), SHAPE_T.RECTANGLE);

      if (this.m_params.gridRounding === null) {
        new_shape.SetPosition(aRect.GetPosition());
        new_shape.SetRectangleWidth(aRect.GetWidth());
        new_shape.SetRectangleHeight(aRect.GetHeight());
      } else {
        const grid_rect = GetRectRoundedToGridOutwards(aRect, this.m_params.gridRounding);
        new_shape.SetPosition(grid_rect.GetPosition());
        new_shape.SetRectangleWidth(grid_rect.GetWidth());
        new_shape.SetRectangleHeight(grid_rect.GetHeight());
      }

      new_shape.SetLayer(layer);
      new_shape.SetWidth(width);

      handler.AddNewItem(new_shape);
    };

    const addCircle = (aCircle: CIRCLE): void => {
      const new_shape = new PCB_SHAPE(this.GetBoard(), SHAPE_T.CIRCLE);
      new_shape.SetCenter(aCircle.Center);
      new_shape.SetRadius(aCircle.Radius);
      new_shape.SetLayer(layer);
      new_shape.SetWidth(width);

      handler.AddNewItem(new_shape);
    };

    const addCircleOrRect = (aCircle: CIRCLE): void => {
      if (this.m_params.roundCorners) {
        addCircle(aCircle);
      } else {
        const c = aCircle.Center;
        const r = aCircle.Radius;
        const rect = new SHAPE_RECT({ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
        addRect(rect);
      }
    };

    switch (aItem.Type()) {
      case KICAD_T.PCB_PAD_T: {
        const pad = aItem as unknown as PAD;

        // TODO(JE) padstacks
        const pad_shape = pad.GetShape(PADSTACK.ALL_LAYERS);

        switch (pad_shape) {
          case PAD_SHAPE.RECTANGLE:
          case PAD_SHAPE.ROUNDRECT:
          case PAD_SHAPE.OVAL: {
            const pad_size = pad.GetSize(PADSTACK.ALL_LAYERS);
            const pos = pad.GetPosition();

            // `pad_size / 2` is VECTOR2I integer division
            const box = new BOX2I(
              { x: pos.x - Math.trunc(pad_size.x / 2), y: pos.y - Math.trunc(pad_size.y / 2) },
              pad_size,
            );
            box.Inflate(this.m_params.outsetDistance);

            if (box.GetWidth() <= 0 || box.GetHeight() <= 0) {
              this.AddFailure();
              break;
            }

            let radius = this.m_params.outsetDistance;

            if (pad_shape === PAD_SHAPE.ROUNDRECT)
              radius += pad.GetRoundRectCornerRadius(PADSTACK.ALL_LAYERS);
            else if (pad_shape === PAD_SHAPE.OVAL)
              radius += Math.trunc(Math.min(pad_size.x, pad_size.y) / 2);

            radius = this.m_params.roundCorners ? Math.max(radius, 0) : 0;

            // No point doing a SHAPE_RECT as we may need to rotate it
            const rrect = new ROUNDRECT(new SHAPE_RECT(box), radius);
            const poly = new SHAPE_POLY_SET();
            rrect.TransformToPolygon(poly, pad.GetMaxError());

            poly.Rotate(pad.GetOrientation(), pad.GetPosition());
            addPoly(poly);
            this.AddSuccess();
            break;
          }

          case PAD_SHAPE.CIRCLE: {
            const radius =
              Math.trunc(pad.GetSize(PADSTACK.ALL_LAYERS).x / 2) + this.m_params.outsetDistance;

            if (radius <= 0) {
              this.AddFailure();
              break;
            }

            const circle = new CIRCLE(pad.GetPosition(), radius);
            addCircleOrRect(circle);
            this.AddSuccess();
            break;
          }

          case PAD_SHAPE.TRAPEZOID:
            // Not handled yet, but could use a generic convex polygon outset method.
            break;

          default:
            // Other pad shapes are not supported with exact outsets
            break;
        }
        break;
      }
      case KICAD_T.PCB_SHAPE_T: {
        const pcb_shape = aItem as unknown as PCB_SHAPE;

        switch (pcb_shape.GetShape()) {
          case SHAPE_T.RECTANGLE: {
            const box = new BOX2I(pcb_shape.GetPosition(), {
              x: pcb_shape.GetRectangleWidth(),
              y: pcb_shape.GetRectangleHeight(),
            });
            box.Inflate(this.m_params.outsetDistance);

            if (box.GetWidth() <= 0 || box.GetHeight() <= 0) {
              this.AddFailure();
              break;
            }

            box.Normalize();

            let rect = new SHAPE_RECT(box);
            let cornerRadius = pcb_shape.GetCornerRadius();

            if (this.m_params.roundCorners)
              cornerRadius = Math.max(cornerRadius + this.m_params.outsetDistance, 0);

            if (this.m_params.gridRounding !== null)
              rect = GetRectRoundedToGridOutwards(rect, this.m_params.gridRounding);

            if (cornerRadius > 0) {
              const rrect = new ROUNDRECT(rect, cornerRadius);
              const poly = new SHAPE_POLY_SET();
              rrect.TransformToPolygon(poly, pcb_shape.GetMaxError());
              addChain(poly.Outline(0));
            } else {
              addRect(rect);
            }

            this.AddSuccess();
            break;
          }

          case SHAPE_T.CIRCLE: {
            const newRadius = pcb_shape.GetRadius() + this.m_params.outsetDistance;

            if (newRadius <= 0) {
              this.AddFailure();
              break;
            }

            const circle = new CIRCLE(pcb_shape.GetCenter(), newRadius);
            addCircleOrRect(circle);
            this.AddSuccess();
            break;
          }

          case SHAPE_T.SEGMENT: {
            if (this.m_params.outsetDistance <= 0) {
              this.AddFailure();
              break;
            }

            // For now just make the whole stadium shape and let the user delete the unwanted bits
            const seg = new SEG(pcb_shape.GetStart(), pcb_shape.GetEnd());

            if (this.m_params.roundCorners) {
              const oval = new SHAPE_SEGMENT(seg, this.m_params.outsetDistance * 2);
              addChain(KIGEOM_ConvertToChain(oval));
            } else {
              const chain = new SHAPE_LINE_CHAIN();
              const ext = ResizeI(
                { x: seg.B.x - seg.A.x, y: seg.B.y - seg.A.y },
                this.m_params.outsetDistance,
              );
              const perp = GetRotated(ext, ANGLE_90);

              chain.Append({ x: seg.A.x - ext.x + perp.x, y: seg.A.y - ext.y + perp.y });
              chain.Append({ x: seg.A.x - ext.x - perp.x, y: seg.A.y - ext.y - perp.y });
              chain.Append({ x: seg.B.x + ext.x - perp.x, y: seg.B.y + ext.y - perp.y });
              chain.Append({ x: seg.B.x + ext.x + perp.x, y: seg.B.y + ext.y + perp.y });
              chain.SetClosed(true);
              addChain(chain);
            }

            this.AddSuccess();
            break;
          }

          case SHAPE_T.ARC:
            // Not 100% sure what a sensible non-round outset of an arc is!
            // (not sure it's that important in practice)

            // Gets rather complicated if this isn't true
            if (pcb_shape.GetRadius() >= this.m_params.outsetDistance) {
              // Again, include the endcaps and let the user delete the unwanted bits
              const arc = new SHAPE_ARC(
                pcb_shape.GetCenter(),
                pcb_shape.GetStart(),
                pcb_shape.GetArcAngle(),
                0,
              );

              const c = arc.GetCenter();
              const p0 = arc.GetP0();
              const startNorm = ResizeI(
                { x: p0.x - c.x, y: p0.y - c.y },
                this.m_params.outsetDistance,
              );

              const inner = new SHAPE_ARC(
                c,
                { x: p0.x - startNorm.x, y: p0.y - startNorm.y },
                arc.GetCentralAngle(),
                0,
              );
              const outer = new SHAPE_ARC(
                c,
                { x: p0.x + startNorm.x, y: p0.y + startNorm.y },
                arc.GetCentralAngle(),
                0,
              );

              const chain = new SHAPE_LINE_CHAIN();
              chain.Append(outer);
              // End cap at the P1 end
              chain.Append(new SHAPE_ARC(arc.GetP1(), outer.GetP1(), ANGLE_180));

              if (inner.GetRadius() > 0) {
                chain.Append(inner.Reversed());
              }

              // End cap at the P0 end back to the start
              chain.Append(new SHAPE_ARC(arc.GetP0(), inner.GetP0(), ANGLE_180));
              addChain(chain);
              this.AddSuccess();
            }

            break;

          default:
            // Other shapes are not supported with exact outsets
            // (convex) POLY shouldn't be too traumatic and it would bring trapezoids for free.
            break;
        }

        break;
      }

      default:
        // Other item types are not supported with exact outsets
        break;
    }

    // It would be nice if we could differentiate which items went with which in the mixed success/failure
    // case, but since we can't it's better to err on the side of safety.
    if (this.m_params.deleteSourceItems && this.GetSuccesses() > 0 && this.GetFailures() === 0)
      handler.DeleteItem(aItem);
  }
}
