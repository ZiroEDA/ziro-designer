// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/autorouter/ar_autoplacer.cpp`: AR_AUTOPLACER, the footprint
 * autoplacer behind Place > Auto-Place Footprints.
 *
 * Every footprint already on the board is stamped into an {@link AR_MATRIX}
 * as an obstacle with a keep-out cost halo; then, one at a time, the next
 * footprint to place ({@link AR_AUTOPLACER.pickFootprint}) is tried at every
 * grid position inside the board outline, and lands where its ratsnest cost
 * plus keep-out cost is least.
 *
 * The overlay (`drawPlacementRoutingMatrix`), the refresh callback and the
 * progress reporter are KiCad's live feedback during a long run; this port runs
 * synchronously inside one tool call, so they are not ported.
 *
 * C++ returns `GetBoundingBox()` by value; ours returns the item's cached box,
 * so every box this file inflates or moves is cloned first.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { type VECTOR2I, EuclideanNormI, add, sub } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_COMMIT } from '../board_commit.js';
import { CONNECTIVITY_DATA } from '../connectivity/connectivity_data.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import {
  AR_MATRIX,
  AR_SIDE_BOTTOM,
  AR_SIDE_TOP,
  CELL_IS_EDGE,
  CELL_IS_HOLE,
  CELL_IS_MODULE,
  CELL_IS_ZONE,
  CELL_OP,
  idiv,
} from './ar_matrix.js';

const AR_GAIN = 16;
const AR_KEEPOUT_MARGIN = 500;
const AR_ABORT_PLACEMENT = -1;

const STEP_AR_MM = 1.0;

/** `AR_CELL_STATE`. */
export enum AR_CELL_STATE {
  AR_OUT_OF_BOARD = -2,
  AR_OCCUIPED_BY_MODULE = -1,
  AR_FREE_CELL = 0,
}

/** `AR_RESULT`. */
export enum AR_RESULT {
  AR_COMPLETED = 1,
  AR_CANCELLED,
  AR_FAILURE,
}

/** `sortFootprintsByComplexity`: area times pad count, largest first. */
function sortFootprintsByComplexity(ref: FOOTPRINT, compare: FOOTPRINT): boolean {
  const ff1 = ref.GetArea() * ref.GetPadCount();
  const ff2 = compare.GetArea() * compare.GetPadCount();
  return ff2 < ff1;
}

/** `sortFootprintsByRatsnestSize`: area times ratsnest edge count, largest first. */
function sortFootprintsByRatsnestSize(ref: FOOTPRINT, compare: FOOTPRINT): boolean {
  const ff1 = ref.GetArea() * ref.GetFlag();
  const ff2 = compare.GetArea() * compare.GetFlag();
  return ff2 < ff1;
}

/** `std::sort` with a strict-weak-ordering `less`, as a comparator. */
function byLess<T>(less: (a: T, b: T) => boolean): (a: T, b: T) => number {
  return (a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0);
}

export class AR_AUTOPLACER {
  private m_matrix = new AR_MATRIX();
  /** The polygonal description of the top side free areas. */
  private m_topFreeArea = new SHAPE_POLY_SET();
  /** The polygonal description of the bottom side free areas. */
  private m_bottomFreeArea = new SHAPE_POLY_SET();
  /** The polygonal description of the board. */
  private m_boardShape = new SHAPE_POLY_SET();
  /** The footprint being placed, top side. */
  private m_fpAreaTop = new SHAPE_POLY_SET();
  /** The footprint being placed, bottom side. */
  private m_fpAreaBottom = new SHAPE_POLY_SET();

  private readonly m_board: BOARD;
  private m_curPosition: VECTOR2I = { x: 0, y: 0 };
  private m_minCost = 0.0;
  private readonly m_gridSize: number;
  private readonly m_connectivity: CONNECTIVITY_DATA;

  constructor(aBoard: BOARD) {
    this.m_board = aBoard;
    this.m_connectivity = new CONNECTIVITY_DATA();

    for (const footprint of this.m_board.Footprints()) this.m_connectivity.Add(footprint);

    this.m_gridSize = pcbIUScale.mmToIU(STEP_AR_MM);
  }

  /** The cost of the last placement (`m_minCost`); read by tests. */
  GetMinCost(): number {
    return this.m_minCost;
  }

  private placeFootprint(
    aFootprint: FOOTPRINT | null,
    _aDoNotRecreateRatsnest: boolean,
    aPos: VECTOR2I,
  ): void {
    if (!aFootprint) return;

    aFootprint.SetPosition(aPos);
    this.m_connectivity.Update(aFootprint);
  }

  private genPlacementRoutingMatrix(): number {
    this.m_matrix.UnInitRoutingMatrix();

    const bbox = this.m_board.GetBoardEdgesBoundingBox();

    if (bbox.GetWidth() === 0 || bbox.GetHeight() === 0) return 0;

    // Build the board shape.
    this.m_board.GetBoardPolygonOutlines(this.m_boardShape, true);
    this.m_topFreeArea = this.m_boardShape.CloneDropTriangulation();
    this.m_bottomFreeArea = this.m_boardShape.CloneDropTriangulation();

    this.m_matrix.ComputeMatrixSize(bbox);

    // Choose the number of board sides.
    this.m_matrix.m_RoutingLayersCount = 2;
    this.m_matrix.InitRoutingMatrix();
    this.m_matrix.m_routeLayerBottom = PCB_LAYER_ID.B_Cu;
    this.m_matrix.m_routeLayerTop = PCB_LAYER_ID.F_Cu;

    // Fill (mark) the cells inside the board.
    this.fillMatrix();

    // Other obstacles can be added here.
    for (const drawing of this.m_board.Drawings()) {
      switch (drawing.Type()) {
        case KICAD_T.PCB_SHAPE_T:
          if (drawing.GetLayer() !== PCB_LAYER_ID.Edge_Cuts) {
            this.m_matrix.TracePcbShape(
              drawing as PCB_SHAPE,
              CELL_IS_HOLE | CELL_IS_EDGE,
              this.m_matrix.m_GridRouting,
              CELL_OP.WRITE_CELL,
            );
          }

          break;

        default:
          break;
      }
    }

    // Initialize top layer to the same value as the bottom layer.
    this.m_matrix.copySide(AR_SIDE_BOTTOM, AR_SIDE_TOP);

    return 1;
  }

  private fillMatrix(): boolean {
    let success = true;
    const step = this.m_matrix.m_GridRouting;
    // Board coordinate of matrix cell (0, 0).
    const coordOrigin = this.m_matrix.GetBrdCoordOrigin();

    // Create a single board outline.
    const brdShape = this.m_boardShape.CloneDropTriangulation();
    brdShape.Fracture();
    const outline = brdShape.Outline(0);
    const rect = outline.BBox();

    // Creates the horizontal segments.
    for (let refy = rect.GetY(), endy = rect.GetBottom(); refy < endy; refy += step) {
      // The row index (vertical position) of current line scan inside the placement matrix.
      const idy = idiv(refy - coordOrigin.y, step);

      // Ensure we are still inside the placement matrix.
      if (idy >= this.m_matrix.m_Nrows) break;

      // Ensure we are inside the placement matrix.
      if (idy <= 0) continue;

      // Find all intersection points of an infinite line with polyline sides.
      const xCoordinates: number[] = [];

      for (let v = 0; v < outline.PointCount(); v++) {
        const segStartX = outline.CPoint(v).x;
        const segStartY = outline.CPoint(v).y;
        let segEndX = outline.CPoint(v + 1).x;
        let segEndY = outline.CPoint(v + 1).y;

        // Trivial cases: skip if ref above or below the segment to test.
        if (segStartY > refy && segEndY > refy) continue;

        // Segment below ref point, or its Y end pos on Y coordinate ref point: skip.
        if (segStartY <= refy && segEndY <= refy) continue;

        // At this point refy is between segStartY and segEndY: move the origin
        // to the segment start and intersect.
        segEndX -= segStartX;
        segEndY -= segStartY;
        const newrefy = refy - segStartY;

        // Horizontal segment on the same line: skip.
        if (segEndY === 0) continue;

        const invSlope = segEndX / segEndY;
        const intersecX = newrefy * invSlope;
        // `(int) intersec_x`: truncation towards zero.
        xCoordinates.push(Math.trunc(intersecX) + segStartX);
      }

      // A line scan is finished: sort the intersections so that two
      // consecutive points are the ends of a segment.
      xCoordinates.sort((a, b) => a - b);

      // An even number of coordinates is expected, because a segment has 2 ends.
      if ((xCoordinates.length & 1) !== 0) {
        success = false;
        break;
      }

      // Fill cells having the same Y coordinate.
      const iimax = xCoordinates.length - 1;

      for (let ii = 0; ii < iimax; ii += 2) {
        const segStart = xCoordinates[ii]! - coordOrigin.x;
        const segEnd = xCoordinates[ii + 1]! - coordOrigin.x;

        // Fill cells at y coord = idy, and at x coord >= segStart and <= segEnd.
        for (let idx = idiv(segStart, step); idx < this.m_matrix.m_Ncols; idx++) {
          if (idx * step > segEnd) break;

          if (idx * step >= segStart) this.m_matrix.SetCell(idy, idx, AR_SIDE_BOTTOM, CELL_IS_ZONE);
        }
      }
    }

    return success;
  }

  /** Add a polygonal shape (rectangle) to m_fpAreaTop and/or m_fpAreaBottom. */
  private addFpBody(aStart: VECTOR2I, aEnd: VECTOR2I, aLayerMask: LSET): void {
    if (aLayerMask.Contains(PCB_LAYER_ID.F_Cu)) {
      this.m_fpAreaTop.NewOutline();
      this.m_fpAreaTop.Append(aStart.x, aStart.y);
      this.m_fpAreaTop.Append(aEnd.x, aStart.y);
      this.m_fpAreaTop.Append(aEnd.x, aEnd.y);
      this.m_fpAreaTop.Append(aStart.x, aEnd.y);
    }

    if (aLayerMask.Contains(PCB_LAYER_ID.B_Cu)) {
      this.m_fpAreaBottom.NewOutline();
      this.m_fpAreaBottom.Append(aStart.x, aStart.y);
      this.m_fpAreaBottom.Append(aEnd.x, aStart.y);
      this.m_fpAreaBottom.Append(aEnd.x, aEnd.y);
      this.m_fpAreaBottom.Append(aStart.x, aEnd.y);
    }
  }

  /** Add a polygonal shape (rectangle) to m_fpAreaTop and/or m_fpAreaBottom. */
  private addPad(aPad: PAD, aClearance: number): void {
    const bbox = aPad.GetBoundingBox().Clone();
    bbox.Inflate(aClearance);

    if (aPad.IsOnLayer(PCB_LAYER_ID.F_Cu)) {
      this.m_fpAreaTop.NewOutline();
      this.m_fpAreaTop.Append(bbox.GetLeft(), bbox.GetTop());
      this.m_fpAreaTop.Append(bbox.GetRight(), bbox.GetTop());
      this.m_fpAreaTop.Append(bbox.GetRight(), bbox.GetBottom());
      this.m_fpAreaTop.Append(bbox.GetLeft(), bbox.GetBottom());
    }

    if (aPad.IsOnLayer(PCB_LAYER_ID.B_Cu)) {
      this.m_fpAreaBottom.NewOutline();
      this.m_fpAreaBottom.Append(bbox.GetLeft(), bbox.GetTop());
      this.m_fpAreaBottom.Append(bbox.GetRight(), bbox.GetTop());
      this.m_fpAreaBottom.Append(bbox.GetRight(), bbox.GetBottom());
      this.m_fpAreaBottom.Append(bbox.GetLeft(), bbox.GetBottom());
    }
  }

  /** Build m_fpAreaTop and m_fpAreaBottom for aFootprint; aFpClearance is a mechanical clearance. */
  private buildFpAreas(aFootprint: FOOTPRINT, aFpClearance: number): void {
    this.m_fpAreaTop.RemoveAllContours();
    this.m_fpAreaBottom.RemoveAllContours();

    aFootprint.BuildCourtyardCaches();
    this.m_fpAreaTop = aFootprint.GetCourtyard(PCB_LAYER_ID.F_CrtYd).CloneDropTriangulation();
    this.m_fpAreaBottom = aFootprint.GetCourtyard(PCB_LAYER_ID.B_CrtYd).CloneDropTriangulation();

    const layerMask = new LSET();

    if (aFootprint.GetLayer() === PCB_LAYER_ID.F_Cu) layerMask.set(PCB_LAYER_ID.F_Cu);

    if (aFootprint.GetLayer() === PCB_LAYER_ID.B_Cu) layerMask.set(PCB_LAYER_ID.B_Cu);

    const fpBBox = aFootprint.GetBoundingBox(false).Clone();
    fpBBox.Inflate(idiv(this.m_matrix.m_GridRouting, 2) + aFpClearance);

    // Add a minimal area to the fp area.
    this.addFpBody(fpBBox.GetOrigin(), fpBBox.GetEnd(), layerMask);

    // Trace pads + clearance areas.
    for (const pad of aFootprint.Pads()) {
      const margin = idiv(this.m_matrix.m_GridRouting, 2) + pad.GetOwnClearance(pad.GetLayer());
      this.addPad(pad, margin);
    }
  }

  private genModuleOnRoutingMatrix(aFootprint: FOOTPRINT): void {
    const layerMask = new LSET();

    const fpBBox = aFootprint.GetBoundingBox(false).Clone();
    fpBBox.Inflate(idiv(this.m_matrix.m_GridRouting, 2));

    const brd = this.m_matrix.m_BrdBox;
    let ox = fpBBox.GetX();
    let fx = fpBBox.GetRight();
    let oy = fpBBox.GetY();
    let fy = fpBBox.GetBottom();

    if (ox < brd.GetX()) ox = brd.GetX();
    if (ox > brd.GetRight()) ox = brd.GetRight();
    if (fx < brd.GetX()) fx = brd.GetX();
    if (fx > brd.GetRight()) fx = brd.GetRight();
    if (oy < brd.GetY()) oy = brd.GetY();
    if (oy > brd.GetBottom()) oy = brd.GetBottom();
    if (fy < brd.GetY()) fy = brd.GetY();
    if (fy > brd.GetBottom()) fy = brd.GetBottom();

    if (aFootprint.GetLayer() === PCB_LAYER_ID.F_Cu) layerMask.set(PCB_LAYER_ID.F_Cu);

    if (aFootprint.GetLayer() === PCB_LAYER_ID.B_Cu) layerMask.set(PCB_LAYER_ID.B_Cu);

    this.m_matrix.TraceFilledRectangle(
      ox,
      oy,
      fx,
      fy,
      layerMask,
      CELL_IS_MODULE,
      CELL_OP.WRITE_OR_CELL,
    );

    // Trace pads + clearance areas.
    for (const pad of aFootprint.Pads()) {
      const margin = idiv(this.m_matrix.m_GridRouting, 2) + pad.GetOwnClearance(pad.GetLayer());
      this.m_matrix.PlacePad(pad, CELL_IS_MODULE, margin, CELL_OP.WRITE_OR_CELL);
    }

    // Trace clearance.
    const margin = idiv(this.m_matrix.m_GridRouting * aFootprint.GetPadCount(), AR_GAIN);
    this.m_matrix.CreateKeepOutRectangle(ox, oy, fx, fy, margin, AR_KEEPOUT_MARGIN, layerMask);

    // Build the footprint courtyard.
    this.buildFpAreas(aFootprint, margin);

    // Subtract the shape from the free areas.
    this.m_topFreeArea.BooleanSubtract(this.m_fpAreaTop);
    this.m_bottomFreeArea.BooleanSubtract(this.m_fpAreaBottom);
  }

  /** The cell range a rectangle covers, clipped to the matrix (shared by the two scans below). */
  private cellRange(aRect: BOX2I): {
    rowMin: number;
    rowMax: number;
    colMin: number;
    colMax: number;
  } {
    const grid = this.m_matrix.m_GridRouting;
    const start = sub(aRect.GetOrigin(), this.m_matrix.m_BrdBox.GetOrigin());
    const end = sub(aRect.GetEnd(), this.m_matrix.m_BrdBox.GetOrigin());

    let rowMin = idiv(start.y, grid);
    let rowMax = idiv(end.y, grid);
    let colMin = idiv(start.x, grid);
    let colMax = idiv(end.x, grid);

    if (start.y > rowMin * grid) rowMin++;
    if (start.x > colMin * grid) colMin++;
    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.m_matrix.m_Nrows - 1) rowMax = this.m_matrix.m_Nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.m_matrix.m_Ncols - 1) colMax = this.m_matrix.m_Ncols - 1;

    return { rowMin, rowMax, colMin, colMax };
  }

  private testRectangle(aRect: BOX2I, side: number): number {
    const rect = aRect.Clone();
    rect.Inflate(idiv(this.m_matrix.m_GridRouting, 2));

    const { rowMin, rowMax, colMin, colMax } = this.cellRange(rect);

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const data = this.m_matrix.GetCell(row, col, side);

        if ((data & CELL_IS_ZONE) === 0) return AR_CELL_STATE.AR_OUT_OF_BOARD;

        if (data & CELL_IS_MODULE) return AR_CELL_STATE.AR_OCCUIPED_BY_MODULE;
      }
    }

    return AR_CELL_STATE.AR_FREE_CELL;
  }

  private calculateKeepOutArea(aRect: BOX2I, side: number): number {
    const { rowMin, rowMax, colMin, colMax } = this.cellRange(aRect);
    let keepOutCost = 0;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++)
        keepOutCost += this.m_matrix.GetDist(row, col, side);
    }

    // `unsigned int`.
    return keepOutCost >>> 0;
  }

  private testFootprintOnBoard(
    aFootprint: FOOTPRINT,
    TstOtherSide: boolean,
    aOffset: VECTOR2I,
  ): number {
    let side = AR_SIDE_TOP;
    let otherside = AR_SIDE_BOTTOM;

    if (aFootprint.GetLayer() === PCB_LAYER_ID.B_Cu) {
      side = AR_SIDE_BOTTOM;
      otherside = AR_SIDE_TOP;
    }

    const fpBBox = aFootprint.GetBoundingBox(false).Clone();
    fpBBox.Move({ x: -aOffset.x, y: -aOffset.y });

    let diag = this.testRectangle(fpBBox, side);

    if (diag !== AR_CELL_STATE.AR_FREE_CELL) return diag;

    if (TstOtherSide) {
      diag = this.testRectangle(fpBBox, otherside);

      if (diag !== AR_CELL_STATE.AR_FREE_CELL) return diag;
    }

    const marge = idiv(this.m_matrix.m_GridRouting * aFootprint.GetPadCount(), AR_GAIN);

    fpBBox.Inflate(marge);
    // `int` from the `unsigned int` cost.
    return this.calculateKeepOutArea(fpBBox, side) | 0;
  }

  private getOptimalFPPlacement(aFootprint: FOOTPRINT): number {
    let error = 1;
    let minCost: number;
    let lastPosOK = this.m_matrix.m_BrdBox.GetOrigin();
    const grid = this.m_matrix.m_GridRouting;

    const fpPos = aFootprint.GetPosition();
    const fpBBox = aFootprint.GetBoundingBox(false).Clone();

    // Move fpBBox to have the footprint position at (0, 0).
    fpBBox.Move({ x: -fpPos.x, y: -fpPos.y });
    const fpBBoxOrg = fpBBox.GetOrigin();

    // Calculate the limit of the footprint position, relative to the routing matrix area.
    const xylimit = sub(this.m_matrix.m_BrdBox.GetEnd(), fpBBox.GetEnd());

    const initialPos = sub(this.m_matrix.m_BrdBox.GetOrigin(), fpBBoxOrg);

    // Stay on grid.
    initialPos.x -= initialPos.x % grid;
    initialPos.y -= initialPos.y % grid;

    this.m_curPosition = { ...initialPos };
    let fpOffset = sub(fpPos, this.m_curPosition);

    // Examine pads, and set testOtherSide to true if a footprint has at least
    // one pad through.
    let testOtherSide = false;

    if (this.m_matrix.m_RoutingLayersCount > 1) {
      const other = new LSET([
        aFootprint.GetLayer() === PCB_LAYER_ID.B_Cu ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu,
      ]);

      for (const pad of aFootprint.Pads()) {
        if (!pad.GetLayerSet().and(other).any()) continue;

        testOtherSide = true;
        break;
      }
    }

    fpBBox.SetOrigin(add(fpBBoxOrg, this.m_curPosition));

    minCost = -1.0;

    for (; this.m_curPosition.x < xylimit.x; this.m_curPosition.x += grid) {
      this.m_curPosition.y = initialPos.y;

      for (; this.m_curPosition.y < xylimit.y; this.m_curPosition.y += grid) {
        fpBBox.SetOrigin(add(fpBBoxOrg, this.m_curPosition));
        fpOffset = sub(fpPos, this.m_curPosition);
        const keepOutCost = this.testFootprintOnBoard(aFootprint, testOtherSide, fpOffset);

        // I.e. if the footprint can be put here.
        if (keepOutCost >= 0) {
          error = 0;
          const currCost = this.computePlacementRatsnestCost(aFootprint, fpOffset);
          const score = currCost + keepOutCost;

          if (minCost >= score || minCost < 0) {
            lastPosOK = { ...this.m_curPosition };
            minCost = score;
          }
        }
      }
    }

    // Regeneration of the modified variable.
    this.m_curPosition = lastPosOK;
    this.m_minCost = minCost;

    return error;
  }

  private nearestPad(aRefFP: FOOTPRINT, aRefPad: PAD, aOffset: VECTOR2I): PAD | null {
    let nearest: PAD | null = null;
    let nearestDist = Number.MAX_SAFE_INTEGER;

    for (const footprint of this.m_board.Footprints()) {
      if (footprint === aRefFP) continue;

      if (!this.m_matrix.m_BrdBox.Contains(footprint.GetPosition())) continue;

      for (const pad of footprint.Pads()) {
        if (pad.GetNetCode() !== aRefPad.GetNetCode() || pad.GetNetCode() <= 0) continue;

        const dist = EuclideanNormI(sub(sub(aRefPad.GetPosition(), aOffset), pad.GetPosition()));

        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = pad;
        }
      }
    }

    return nearest;
  }

  private computePlacementRatsnestCost(aFootprint: FOOTPRINT, aOffset: VECTOR2I): number {
    let currCost = 0;

    for (const pad of aFootprint.Pads()) {
      const nearest = this.nearestPad(aFootprint, pad, aOffset);

      if (!nearest) continue;

      const start = sub(pad.GetPosition(), aOffset);
      const end = nearest.GetPosition();
      let dx = Math.abs(end.x - start.x);
      let dy = Math.abs(end.y - start.y);

      // Ensure dx >= dy.
      if (dx < dy) [dx, dy] = [dy, dx];

      // Cost of a connection = lenght + penalty * disgonal_lenght; a diagonal
      // connection has twice the cost of the same horizontal or vertical one.
      const connCost = Math.hypot(dx, dy * 2.0);

      // Total cost = sum of costs of each connection.
      currCost += connCost;
    }

    return currCost;
  }

  /** Find the "best" footprint place. The criteria are: maximum ratsnest with placed footprints, maximum size. */
  pickFootprint(): FOOTPRINT | null {
    const fpList: FOOTPRINT[] = [...this.m_board.Footprints()];

    fpList.sort(byLess(sortFootprintsByComplexity));

    for (const footprint of fpList) {
      footprint.SetFlag(0);

      if (!footprint.NeedsPlaced()) continue;

      this.m_connectivity.Update(footprint);
    }

    this.m_connectivity.RecalculateRatsnest();

    for (const footprint of fpList) {
      const edges = this.m_connectivity.GetRatsnestForComponent(footprint, true);
      footprint.SetFlag(edges.length);
    }

    fpList.sort(byLess(sortFootprintsByRatsnestSize));

    // Search for "best" footprint.
    let bestFootprint: FOOTPRINT | null = null;
    let altFootprint: FOOTPRINT | null = null;

    for (const footprint of fpList) {
      if (!footprint.NeedsPlaced()) continue;

      altFootprint = footprint;

      if (footprint.GetFlag() === 0) continue;

      bestFootprint = footprint;
      break;
    }

    return bestFootprint ?? altFootprint;
  }

  AutoplaceFootprints(
    aFootprints: FOOTPRINT[],
    aCommit: BOARD_COMMIT,
    aPlaceOffboardModules = false,
  ): AR_RESULT {
    const memopos = this.m_curPosition;

    this.m_matrix.m_GridRouting = this.m_gridSize;

    // Ensure Grid size is not too small.
    if (this.m_matrix.m_GridRouting < pcbIUScale.mmToIU(0.25))
      this.m_matrix.m_GridRouting = pcbIUScale.mmToIU(0.25);

    // Compute footprint parameters used in autoplace.
    if (this.genPlacementRoutingMatrix() === 0) return AR_RESULT.AR_FAILURE;

    for (const footprint of this.m_board.Footprints()) footprint.SetNeedsPlaced(false);

    const offboardMods: FOOTPRINT[] = [];

    if (aPlaceOffboardModules) {
      for (const footprint of this.m_board.Footprints()) {
        if (!this.m_matrix.m_BrdBox.Contains(footprint.GetPosition())) offboardMods.push(footprint);
      }
    }

    for (const footprint of aFootprints) {
      footprint.SetNeedsPlaced(true);
      aCommit.Modify(footprint);
    }

    for (const footprint of offboardMods) {
      footprint.SetNeedsPlaced(true);
      aCommit.Modify(footprint);
    }

    for (const footprint of this.m_board.Footprints()) {
      if (!footprint.NeedsPlaced()) this.genModuleOnRoutingMatrix(footprint);
    }

    for (
      let footprint = this.pickFootprint();
      footprint !== null;
      footprint = this.pickFootprint()
    ) {
      const error = this.getOptimalFPPlacement(footprint);

      if (error === AR_ABORT_PLACEMENT) break;

      // Place footprint.
      this.placeFootprint(footprint, true, this.m_curPosition);

      this.genModuleOnRoutingMatrix(footprint);
      footprint.SetIsPlaced(true);
      footprint.SetNeedsPlaced(false);
    }

    this.m_curPosition = memopos;

    this.m_matrix.UnInitRoutingMatrix();

    return AR_RESULT.AR_COMPLETED;
  }
}
