// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint autoplacer's occupancy and cost grid. Counterpart:
 * `pcbnew/autorouter/ar_matrix.cpp` (AR_MATRIX).
 *
 * Two parallel grids per board side span the board's bounding box at
 * `gridRouting` spacing: a *cell* map of bit flags saying what occupies a cell,
 * and a *dist* map holding that cell's placement cost. Both are addressed as
 * `row * ncols + col` from a board coordinate that has already had the matrix
 * origin subtracted.
 *
 * The invariant that is easy to lose in translation: every `/` upstream is a
 * C++ integer division, which truncates *towards zero*, and every `%` keeps the
 * sign of the dividend. On a board laid out at negative coordinates a
 * `Math.floor` in place of {@link idiv} shifts a whole row or column, so the
 * matrix stops agreeing with upstream's exactly where it matters least
 * visibly — the board still gets placed, just differently.
 *
 * Cell writes outside the grid are dropped here. Upstream indexes the raw
 * allocation instead: in-range rows and columns always land inside it, so the
 * only reachable difference is a negative index, which in C++ is undefined
 * behaviour rather than a value this port could reproduce.
 */

import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { EuclideanNormI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { LSET } from '@ziroeda/common/lset.js';
import type { PAD } from '../pad.js';
import { PAD_SHAPE, PADSTACK } from '../padstack.js';
import type { PCB_SHAPE } from '../pcb_shape.js';

/** C++ integer division: truncate towards zero, not `Math.floor`. */
export const idiv = (a: number, b: number): number => Math.trunc(a / b);

// ----- cell flags (ar_autoplacer.cpp) ---------------------------------------

export const CELL_IS_EMPTY = 0x00;
/** A conducting hole or obstacle. */
export const CELL_IS_HOLE = 0x01;
/** Occupied by a footprint already placed. */
export const CELL_IS_MODULE = 0x02;
/** Limiting cell contour (board, zone). */
export const CELL_IS_EDGE = 0x20;
/** Cell part of the net. Written by the autorouter, never by the autoplacer. */
export const CELL_IS_FRIEND = 0x40;
/** Cell available: inside the board outline. */
export const CELL_IS_ZONE = 0x80;

export const AR_SIDE_TOP = 0;
export const AR_SIDE_BOTTOM = 1;

/** `AR_MATRIX::CELL_OP`: how {@link AR_MATRIX.WriteCell} combines the new value with the old. */
export enum CELL_OP {
  WRITE_CELL,
  WRITE_OR_CELL,
  WRITE_XOR_CELL,
  WRITE_AND_CELL,
  WRITE_ADD_CELL,
}

export class AR_MATRIX {
  /** Size of the grid for autoplace/autoroute, in IU. */
  m_GridRouting = 0;
  /** 1 or 2. The autoplacer always uses 2; several methods branch on it. */
  m_RoutingLayersCount = 1;
  /** The board bounding box, snapped onto the routing grid. */
  m_BrdBox = new BOX2I();
  m_Nrows = 0;
  m_Ncols = 0;
  m_routeLayerTop: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;
  m_routeLayerBottom: PCB_LAYER_ID = PCB_LAYER_ID.B_Cu;

  /** Cell flags, indexed [side][row * ncols + col]. */
  private m_BoardSide: [Uint8Array, Uint8Array] = [new Uint8Array(0), new Uint8Array(0)];
  /** Placement cost, same indexing. */
  private m_DistSide: [Int32Array, Int32Array] = [new Int32Array(0), new Int32Array(0)];

  /** `GetBrdCoordOrigin()`, the board coordinate of cell (0, 0). */
  GetBrdCoordOrigin(): VECTOR2I {
    return this.m_BrdBox.GetOrigin();
  }

  /**
   * `ComputeMatrixSize`. The box start is snapped onto the grid by subtracting
   * `x % grid` — truncating, so a negative origin snaps *inwards* (towards
   * zero) while a positive one snaps outwards. The end is then snapped down and
   * pushed out by one whole grid step, and one spare row and column are added.
   */
  ComputeMatrixSize(aBoundingBox: BOX2I): void {
    const g = this.m_GridRouting;
    // The boundary coordinates must be multiples of m_GridRouting.
    this.m_BrdBox = aBoundingBox.Clone();
    this.m_BrdBox.SetX(this.m_BrdBox.GetX() - (this.m_BrdBox.GetX() % g));
    this.m_BrdBox.SetY(this.m_BrdBox.GetY() - (this.m_BrdBox.GetY() % g));

    const end = this.m_BrdBox.GetEnd();
    let endX = end.x;
    let endY = end.y;
    endX -= endX % g;
    endX += g;
    endY -= endY % g;
    endY += g;
    this.m_BrdBox.SetEnd(endX, endY);

    this.m_Nrows = idiv(this.m_BrdBox.GetHeight(), g);
    this.m_Ncols = idiv(this.m_BrdBox.GetWidth(), g);

    // Gives a small margin.
    this.m_Ncols += 1;
    this.m_Nrows += 1;
  }

  /** `InitRoutingMatrix`: allocate both sides, everything empty. */
  InitRoutingMatrix(): boolean {
    if (this.m_Nrows <= 0 || this.m_Ncols <= 0) return false;

    // Upstream gives a small margin for memory allocation.
    const n = (this.m_Nrows + 1) * (this.m_Ncols + 1);
    this.m_BoardSide = [new Uint8Array(n), new Uint8Array(n)];
    this.m_DistSide = [new Int32Array(n), new Int32Array(n)];
    return true;
  }

  /** `UnInitRoutingMatrix`. */
  UnInitRoutingMatrix(): void {
    this.m_BoardSide = [new Uint8Array(0), new Uint8Array(0)];
    this.m_DistSide = [new Int32Array(0), new Int32Array(0)];
    this.m_Nrows = 0;
    this.m_Ncols = 0;
  }

  private at(row: number, col: number): number {
    if (row < 0 || col < 0 || row >= this.m_Nrows || col >= this.m_Ncols) return -1;
    return row * this.m_Ncols + col;
  }

  GetCell(row: number, col: number, side: number): number {
    const i = this.at(row, col);
    return i < 0 ? 0 : this.m_BoardSide[side === AR_SIDE_TOP ? 0 : 1]![i]!;
  }

  SetCell(row: number, col: number, side: number, value: number): void {
    const i = this.at(row, col);
    if (i >= 0) this.m_BoardSide[side === AR_SIDE_TOP ? 0 : 1]![i] = value;
  }

  GetDist(row: number, col: number, side: number): number {
    const i = this.at(row, col);
    return i < 0 ? 0 : this.m_DistSide[side === AR_SIDE_TOP ? 0 : 1]![i]!;
  }

  SetDist(row: number, col: number, side: number, value: number): void {
    const i = this.at(row, col);
    if (i >= 0) this.m_DistSide[side === AR_SIDE_TOP ? 0 : 1]![i] = value;
  }

  /** `WriteCell` through the operation `SetCellOperation` selected. */
  WriteCell(row: number, col: number, side: number, value: number, op: CELL_OP): void {
    const i = this.at(row, col);
    if (i < 0) return;
    const buf = this.m_BoardSide[side === AR_SIDE_TOP ? 0 : 1]!;
    switch (op) {
      case CELL_OP.WRITE_CELL:
        buf[i] = value;
        break;
      case CELL_OP.WRITE_OR_CELL:
        buf[i]! |= value;
        break;
      case CELL_OP.WRITE_XOR_CELL:
        buf[i]! ^= value;
        break;
      case CELL_OP.WRITE_AND_CELL:
        buf[i]! &= value;
        break;
      case CELL_OP.WRITE_ADD_CELL:
        buf[i]! += value;
        break;
    }
  }

  /** Copy one side's cell map onto the other (the `memcpy` in genPlacementRoutingMatrix). */
  copySide(from: number, to: number): void {
    this.m_BoardSide[to === AR_SIDE_TOP ? 0 : 1]!.set(
      this.m_BoardSide[from === AR_SIDE_TOP ? 0 : 1]!,
    );
  }

  /**
   * `OP_CELL`: an undefined layer writes both sides, otherwise only the side
   * whose route layer the shape is on.
   */
  private opCell(layer: PCB_LAYER_ID, row: number, col: number, color: number, op: CELL_OP): void {
    if (layer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      this.WriteCell(row, col, AR_SIDE_BOTTOM, color, op);
      if (this.m_RoutingLayersCount > 1) this.WriteCell(row, col, AR_SIDE_TOP, color, op);
    } else {
      if (layer === this.m_routeLayerBottom) this.WriteCell(row, col, AR_SIDE_BOTTOM, color, op);
      if (this.m_RoutingLayersCount > 1 && layer === this.m_routeLayerTop)
        this.WriteCell(row, col, AR_SIDE_TOP, color, op);
    }
  }

  /**
   * `drawSegmentQcq`: fill every cell within `lg` of the segment, ends rounded.
   * Coordinates are relative to the matrix origin.
   */
  drawSegmentQcq(
    ux0in: number,
    uy0in: number,
    ux1in: number,
    uy1in: number,
    lg: number,
    layer: PCB_LAYER_ID,
    color: number,
    op: CELL_OP,
  ): void {
    let ux0 = ux0in;
    let uy0 = uy0in;
    let ux1 = ux1in;
    let uy1 = uy1in;

    // Make ux1 > ux0 to simplify the calculations.
    if (ux1 < ux0) {
      [ux1, ux0] = [ux0, ux1];
      [uy1, uy0] = [uy0, uy1];
    }

    const inc = uy1 < uy0 ? -1 : 1;
    const demiPas = idiv(this.m_GridRouting, 2);

    let colMin = idiv(ux0 - lg, this.m_GridRouting);
    if (colMin < 0) colMin = 0;

    let colMax = idiv(ux1 + lg + demiPas, this.m_GridRouting);
    if (colMax > this.m_Ncols - 1) colMax = this.m_Ncols - 1;

    let rowMin: number;
    let rowMax: number;

    if (inc > 0) {
      rowMin = idiv(uy0 - lg, this.m_GridRouting);
      rowMax = idiv(uy1 + lg + demiPas, this.m_GridRouting);
    } else {
      rowMin = idiv(uy1 - lg, this.m_GridRouting);
      rowMax = idiv(uy0 + lg + demiPas, this.m_GridRouting);
    }

    if (rowMin < 0) rowMin = 0;
    if (rowMin > this.m_Nrows - 1) rowMin = this.m_Nrows - 1;
    if (rowMax < 0) rowMax = 0;
    if (rowMax > this.m_Nrows - 1) rowMax = this.m_Nrows - 1;

    const angle = EDA_ANGLE.fromVector({ x: ux1 - ux0, y: uy1 - uy0 });
    // Rotated so the segment lies along +X: dx becomes its length, dy zero.
    const dx = RotatePoint({ x: ux1 - ux0, y: uy1 - uy0 }, angle).x;

    for (let col = colMin; col <= colMax; col++) {
      const cxr = col * this.m_GridRouting - ux0;

      for (let row = rowMin; row <= rowMax; row++) {
        const rotated = RotatePoint({ x: cxr, y: row * this.m_GridRouting - uy0 }, angle);
        const cx = rotated.x;
        const cy = rotated.y;

        if (Math.abs(cy) > lg) continue; // too far on the Y axis

        if (cx >= 0 && cx <= dx) {
          this.opCell(layer, row, col, color, op);
          continue;
        }

        // The rounded ends.
        if (cx < 0 && cx >= -lg) {
          if (cx * cx + cy * cy <= lg * lg) this.opCell(layer, row, col, color, op);
          continue;
        }

        if (cx > dx && cx <= dx + lg) {
          if ((cx - dx) * (cx - dx) + cy * cy <= lg * lg) this.opCell(layer, row, col, color, op);
        }
      }
    }
  }

  /**
   * `traceCircle`: the circle centred on (ux0, uy0) through (ux1, uy1), drawn
   * as a chain of chords `lg` wide.
   */
  traceCircle(
    ux0: number,
    uy0: number,
    ux1: number,
    uy1: number,
    lgIn: number,
    layer: PCB_LAYER_ID,
    color: number,
    op: CELL_OP,
  ): void {
    const radius = EuclideanNormI({ x: ux0 - ux1, y: uy0 - uy1 });
    const lg = lgIn < 1 ? 1 : lgIn;

    let x0 = radius;
    let y0 = 0;
    let x1 = radius;
    let y1 = 0;

    let nbSegm = idiv(2 * radius, lg);
    if (nbSegm < 5) nbSegm = 5;
    if (nbSegm > 100) nbSegm = 100;

    for (let ii = 1; ii < nbSegm; ii++) {
      const angle = new EDA_ANGLE((360 * ii) / nbSegm);
      x1 = KiROUND(radius * angle.Cos());
      y1 = KiROUND(radius * angle.Sin());
      this.drawSegmentQcq(x0 + ux0, y0 + uy0, x1 + ux0, y1 + uy0, lg, layer, color, op);
      x0 = x1;
      y0 = y1;
    }

    this.drawSegmentQcq(x1 + ux0, y1 + uy0, ux0 + radius, uy0, lg, layer, color, op);
  }

  /**
   * `traceArc`. Upstream computes the segment end as
   * `y1 = KiROUND( radius * angle.Cos() )` — the same `Cos` it uses for `x1`,
   * where every other tracer uses `Sin`. Mirrored deliberately: the chords it
   * lays down run along the line y = x rather than round the arc, so an arc on
   * a non-`Edge.Cuts` layer blocks a diagonal band of cells instead of its own
   * sweep. Fixing it here would give a different occupancy grid from KiCad's on
   * any board that has one.
   */
  traceArc(
    ux0: number,
    uy0: number,
    ux1: number,
    uy1: number,
    arcAngleDegrees: number,
    lgIn: number,
    layer: PCB_LAYER_ID,
    color: number,
    op: CELL_OP,
  ): void {
    const radius = EuclideanNormI({ x: ux0 - ux1, y: uy0 - uy1 });
    const lg = lgIn < 1 ? 1 : lgIn;

    let x0 = ux1 - ux0;
    let y0 = uy1 - uy0;
    const startAngle = EDA_ANGLE.fromVector({ x: ux1 - ux0, y: uy1 - uy0 });

    let nbSegm = idiv(2 * radius, lg);
    nbSegm = Math.trunc((nbSegm * Math.abs(arcAngleDegrees)) / 360.0);

    if (nbSegm < 5) nbSegm = 5;
    if (nbSegm > 100) nbSegm = 100;

    for (let ii = 1; ii <= nbSegm; ii++) {
      const angle = new EDA_ANGLE((arcAngleDegrees * ii) / nbSegm).add(startAngle).Normalize();
      const x1 = KiROUND(radius * angle.Cos());
      const y1 = KiROUND(radius * angle.Cos()); // sic — upstream's Cos, not Sin
      this.drawSegmentQcq(x0 + ux0, y0 + uy0, x1 + ux0, y1 + uy0, lg, layer, color, op);
      x0 = x1;
      y0 = y1;
    }
  }

  /** `traceFilledCircle`. Coordinates are board coordinates. */
  traceFilledCircle(
    cxIn: number,
    cyIn: number,
    radius: number,
    aLayerMask: LSET,
    color: number,
    op: CELL_OP,
  ): void {
    let trace = 0;
    if (aLayerMask.Contains(this.m_routeLayerBottom)) trace = 1;
    if (aLayerMask.Contains(this.m_routeLayerTop) && this.m_RoutingLayersCount > 1) trace |= 2;
    if (trace === 0) return;

    const cx = cxIn - this.GetBrdCoordOrigin().x;
    const cy = cyIn - this.GetBrdCoordOrigin().y;

    const ux0 = cx - radius;
    const uy0 = cy - radius;
    const ux1 = cx + radius;
    const uy1 = cy + radius;

    let rowMax = idiv(uy1, this.m_GridRouting);
    let colMax = idiv(ux1, this.m_GridRouting);
    let rowMin = idiv(uy0, this.m_GridRouting);
    let colMin = idiv(ux0, this.m_GridRouting);

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.m_Nrows - 1) rowMax = this.m_Nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.m_Ncols - 1) colMax = this.m_Ncols - 1;
    if (rowMin > rowMax) rowMax = rowMin;
    if (colMin > colMax) colMax = colMin;

    let fdistmin = radius * radius;
    let tstwrite = false;

    for (let row = rowMin; row <= rowMax; row++) {
      const fdisty = (cy - row * this.m_GridRouting) ** 2;

      for (let col = colMin; col <= colMax; col++) {
        const fdistx = (cx - col * this.m_GridRouting) ** 2;
        if (fdistmin <= fdistx + fdisty) continue;

        if (trace & 1) this.WriteCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.WriteCell(row, col, AR_SIDE_TOP, color, op);
        tstwrite = true;
      }
    }

    if (tstwrite) return;

    // Nothing was written: a pad off grid, in the centre of its four diagonal
    // neighbours. Claim them instead.
    const distmin = idiv(this.m_GridRouting, 2) + 1;
    fdistmin = distmin * distmin * 2;

    for (let row = rowMin; row <= rowMax; row++) {
      const fdisty = (cy - row * this.m_GridRouting) ** 2;

      for (let col = colMin; col <= colMax; col++) {
        const fdistx = (cx - col * this.m_GridRouting) ** 2;
        if (fdistmin <= fdistx + fdisty) continue;

        if (trace & 1) this.WriteCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.WriteCell(row, col, AR_SIDE_TOP, color, op);
      }
    }
  }

  /** `TraceFilledRectangle`, the axis-aligned overload. Board coordinates. */
  TraceFilledRectangle(
    ux0In: number,
    uy0In: number,
    ux1In: number,
    uy1In: number,
    aLayerMask: LSET,
    color: number,
    op: CELL_OP,
  ): void {
    let trace = 0;
    if (aLayerMask.Contains(this.m_routeLayerBottom)) trace = 1;
    if (aLayerMask.Contains(this.m_routeLayerTop) && this.m_RoutingLayersCount > 1) trace |= 2;
    if (trace === 0) return;

    const org = this.GetBrdCoordOrigin();
    const ux0 = ux0In - org.x;
    const uy0 = uy0In - org.y;
    const ux1 = ux1In - org.x;
    const uy1 = uy1In - org.y;

    let rowMax = idiv(uy1, this.m_GridRouting);
    let colMax = idiv(ux1, this.m_GridRouting);
    let rowMin = idiv(uy0, this.m_GridRouting);
    if (uy0 > rowMin * this.m_GridRouting) rowMin++;
    let colMin = idiv(ux0, this.m_GridRouting);
    if (ux0 > colMin * this.m_GridRouting) colMin++;

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.m_Nrows - 1) rowMax = this.m_Nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.m_Ncols - 1) colMax = this.m_Ncols - 1;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (trace & 1) this.WriteCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.WriteCell(row, col, AR_SIDE_TOP, color, op);
      }
    }
  }

  /**
   * `TraceFilledRectangle`, the rotated overload: `angle` is in tenths of a
   * degree, and each candidate cell is rotated *back* into the rectangle's frame
   * before being tested against its bounds (exclusively on all four sides).
   */
  TraceFilledRectangleAngled(
    ux0In: number,
    uy0In: number,
    ux1In: number,
    uy1In: number,
    angleTenths: number,
    aLayerMask: LSET,
    color: number,
    op: CELL_OP,
  ): void {
    let trace = 0;
    if (aLayerMask.Contains(this.m_routeLayerBottom)) trace = 1;
    if (aLayerMask.Contains(this.m_routeLayerTop) && this.m_RoutingLayersCount > 1) trace |= 2;
    if (trace === 0) return;

    const org = this.GetBrdCoordOrigin();
    const ux0 = ux0In - org.x;
    const uy0 = uy0In - org.y;
    const ux1 = ux1In - org.x;
    const uy1 = uy1In - org.y;

    const cx = idiv(ux0 + ux1, 2);
    const cy = idiv(uy0 + uy1, 2);
    const radius = EuclideanNormI({ x: ux0 - cx, y: uy0 - cy });

    let rowMax = idiv(cy + radius, this.m_GridRouting);
    let colMax = idiv(cx + radius, this.m_GridRouting);
    let rowMin = idiv(cy - radius, this.m_GridRouting);
    if (uy0 > rowMin * this.m_GridRouting) rowMin++;
    let colMin = idiv(cx - radius, this.m_GridRouting);
    if (ux0 > colMin * this.m_GridRouting) colMin++;

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.m_Nrows - 1) rowMax = this.m_Nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.m_Ncols - 1) colMax = this.m_Ncols - 1;

    const angle = new EDA_ANGLE(angleTenths, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T).negate();

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const r = RotatePoint(
          { x: col * this.m_GridRouting, y: row * this.m_GridRouting },
          { x: cx, y: cy },
          angle,
        );

        if (r.y <= uy0) continue;
        if (r.y >= uy1) continue;
        if (r.x <= ux0) continue;
        if (r.x >= ux1) continue;

        if (trace & 1) this.WriteCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.WriteCell(row, col, AR_SIDE_TOP, color, op);
      }
    }
  }

  /**
   * `TracePcbShape`. Only segments, circles and arcs are traced — a rectangle,
   * polygon or bezier on a non-`Edge.Cuts` layer is no obstacle at all as far as
   * the autoplacer is concerned, which is upstream's behaviour, not an omission.
   */
  TracePcbShape(aShape: PCB_SHAPE, aColor: number, aMargin: number, op: CELL_OP): void {
    const halfWidth = idiv(aShape.GetWidth(), 2) + aMargin;
    const org = this.GetBrdCoordOrigin();
    // Draw on all layers.
    const layer = PCB_LAYER_ID.UNDEFINED_LAYER;

    if (aShape.GetShape() === SHAPE_T.CIRCLE || aShape.GetShape() === SHAPE_T.SEGMENT) {
      const ux0 = aShape.GetStart().x - org.x;
      const uy0 = aShape.GetStart().y - org.y;
      const ux1 = aShape.GetEnd().x - org.x;
      const uy1 = aShape.GetEnd().y - org.y;

      if (aShape.GetShape() === SHAPE_T.CIRCLE)
        this.traceCircle(ux0, uy0, ux1, uy1, halfWidth, layer, aColor, op);
      else this.drawSegmentQcq(ux0, uy0, ux1, uy1, halfWidth, layer, aColor, op);
    } else if (aShape.GetShape() === SHAPE_T.ARC) {
      const ux0 = aShape.GetCenter().x - org.x;
      const uy0 = aShape.GetCenter().y - org.y;
      const ux1 = aShape.GetStart().x - org.x;
      const uy1 = aShape.GetStart().y - org.y;

      this.traceArc(
        ux0,
        uy0,
        ux1,
        uy1,
        aShape.GetArcAngle().AsDegrees(),
        halfWidth,
        layer,
        aColor,
        op,
      );
    }
  }

  /**
   * `CreateKeepOutRectangle`, the cost map. Cells inside the rectangle gain the
   * full `aKeepOut`; cells in the `marge` band around it gain a share of it that
   * falls off linearly towards the band's outer edge, in 1/256ths.
   *
   * The two sides are *not* treated alike, and that asymmetry is upstream's:
   * the bottom accumulates (`dist + keepOut`, so overlapping footprints stack
   * their cost) while the top takes the maximum (`max(dist, keepOut)`, so it
   * does not). A footprint on the back of a busy board therefore sees a
   * different cost surface from the same footprint on the front.
   */
  CreateKeepOutRectangle(
    ux0In: number,
    uy0In: number,
    ux1In: number,
    uy1In: number,
    marge: number,
    aKeepOut: number,
    aLayerMask: LSET,
  ): void {
    let trace = 0;
    if (aLayerMask.Contains(this.m_routeLayerBottom)) trace = 1;
    // Note the truthiness test on the layer count, where every other tracer
    // here asks for `> 1`.
    if (aLayerMask.Contains(this.m_routeLayerTop) && this.m_RoutingLayersCount) trace |= 2;
    if (trace === 0) return;

    const ux0 = ux0In - this.m_BrdBox.GetX() - marge;
    const uy0 = uy0In - this.m_BrdBox.GetY() - marge;
    const ux1 = ux1In - this.m_BrdBox.GetX() + marge;
    const uy1 = uy1In - this.m_BrdBox.GetY() + marge;

    let pmarge = idiv(marge, this.m_GridRouting);
    if (pmarge < 1) pmarge = 1;

    let rowMax = idiv(uy1, this.m_GridRouting);
    let colMax = idiv(ux1, this.m_GridRouting);
    let rowMin = idiv(uy0, this.m_GridRouting);
    if (uy0 > rowMin * this.m_GridRouting) rowMin++;
    let colMin = idiv(ux0, this.m_GridRouting);
    if (ux0 > colMin * this.m_GridRouting) colMin++;

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.m_Nrows - 1) rowMax = this.m_Nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.m_Ncols - 1) colMax = this.m_Ncols - 1;

    for (let row = rowMin; row <= rowMax; row++) {
      let lgain = 256;
      if (row < pmarge) lgain = idiv(256 * row, pmarge);
      else if (row > rowMax - pmarge) lgain = idiv(256 * (rowMax - row), pmarge);

      for (let col = colMin; col <= colMax; col++) {
        let cgain = 256;
        let localKeepOut = aKeepOut;

        if (col < pmarge) cgain = idiv(256 * col, pmarge);
        else if (col > colMax - pmarge) cgain = idiv(256 * (colMax - col), pmarge);

        cgain = idiv(cgain * lgain, 256);

        if (cgain !== 256) localKeepOut = idiv(localKeepOut * cgain, 256);

        if (trace & 1) {
          this.SetDist(
            row,
            col,
            AR_SIDE_BOTTOM,
            this.GetDist(row, col, AR_SIDE_BOTTOM) + localKeepOut,
          );
        }

        if (trace & 2) {
          this.SetDist(
            row,
            col,
            AR_SIDE_TOP,
            Math.max(this.GetDist(row, col, AR_SIDE_TOP), localKeepOut),
          );
        }
      }
    }
  }

  /**
   * `PlacePad`. Only a circular pad gets a circle; everything else — oval,
   * rounded rectangle, chamfered, custom — is traced as the rectangle of its
   * size, which is upstream's approximation, not a gap in this port. A
   * trapezoid grows by half its delta on each axis.
   */
  PlacePad(aPad: PAD, color: number, marge: number, op: CELL_OP): void {
    const shapePos = aPad.ShapePos(PADSTACK.ALL_LAYERS);

    // TODO(JE) padstacks
    let dx = idiv(aPad.GetSize(PADSTACK.ALL_LAYERS).x, 2);
    dx += marge;

    if (aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE) {
      this.traceFilledCircle(shapePos.x, shapePos.y, dx, aPad.GetLayerSet(), color, op);
      return;
    }

    let dy = idiv(aPad.GetSize(PADSTACK.ALL_LAYERS).y, 2);
    dy += marge;

    if (aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.TRAPEZOID) {
      dx += idiv(Math.abs(aPad.GetDelta(PADSTACK.ALL_LAYERS).y), 2);
      dy += idiv(Math.abs(aPad.GetDelta(PADSTACK.ALL_LAYERS).x), 2);
    }

    // The pad is a rectangle (horizontal or vertical).
    if (aPad.GetOrientation().IsCardinal()) {
      // Orientation turned 90 deg.
      const degrees = aPad.GetOrientation().AsDegrees();

      if (degrees === 90 || degrees === 270) [dx, dy] = [dy, dx];

      this.TraceFilledRectangle(
        shapePos.x - dx,
        shapePos.y - dy,
        shapePos.x + dx,
        shapePos.y + dy,
        aPad.GetLayerSet(),
        color,
        op,
      );
    } else {
      this.TraceFilledRectangleAngled(
        shapePos.x - dx,
        shapePos.y - dy,
        shapePos.x + dx,
        shapePos.y + dy,
        aPad.GetOrientation().AsTenthsOfADegree(),
        aPad.GetLayerSet(),
        color,
        op,
      );
    }
  }
}
