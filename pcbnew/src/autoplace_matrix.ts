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
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import type { PcbPad, PcbShape } from './types.js';
import { arcCenter } from './read-board.js';

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

/** How {@link ArMatrix.writeCell} combines the new value with the old. */
export type CellOp = 'write' | 'or' | 'xor' | 'and' | 'add';

/**
 * `BOX2I`: an origin and a size rather than two corners, because upstream's
 * `SetX`/`SetY` move the origin and drag the end along with it, and
 * `ComputeMatrixSize` depends on exactly that.
 */
export interface Box2 {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const boxRight = (b: Box2): number => b.x + b.w;
export const boxBottom = (b: Box2): number => b.y + b.h;
export const boxEnd = (b: Box2): { x: number; y: number } => ({ x: b.x + b.w, y: b.y + b.h });

/** `BOX2I::Inflate( d )`. */
export const boxInflate = (b: Box2, d: number): Box2 => ({
  x: b.x - d,
  y: b.y - d,
  w: b.w + 2 * d,
  h: b.h + 2 * d,
});

/** `BOX2I::Move( v )`: shift the origin, keep the size. */
export const boxMove = (b: Box2, dx: number, dy: number): Box2 => ({
  x: b.x + dx,
  y: b.y + dy,
  w: b.w,
  h: b.h,
});

/** `BOX2I::Contains( pt )`, inclusive on all four edges. */
export const boxContains = (b: Box2, x: number, y: number): boolean =>
  x >= b.x && x <= boxRight(b) && y >= b.y && y <= boxBottom(b);

/**
 * `LSET` membership for the only two layers the matrix knows about. A pad whose
 * layer list carries `*.Cu` is on both, which is how a through-hole pad blocks
 * the far side as well as its own.
 */
export const onLayer = (layers: readonly string[], layer: string): boolean =>
  layers.includes(layer) || layers.includes('*.Cu');

/** The layer mask of a footprint: `F_Cu` or `B_Cu`, never both. */
export const sideMask = (layer: string): string[] =>
  layer === 'F.Cu' ? ['F.Cu'] : layer === 'B.Cu' ? ['B.Cu'] : [];

/**
 * `EDA_SHAPE::GetArcAngle`: the sweep from start to end about the centre. The
 * mid point plays no part — upstream normalises the end angle upwards until it
 * is at least the start angle, so the sweep is always positive.
 */
export function arcSweepDegrees(centre: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const startAngle = EDA_ANGLE.fromVector({ x: start.x - centre.x, y: start.y - centre.y });
  let endAngle = EDA_ANGLE.fromVector({ x: end.x - centre.x, y: end.y - centre.y });

  // A ring, not a null arc.
  if (endAngle.equals(startAngle)) endAngle = startAngle.add(new EDA_ANGLE(360));
  while (endAngle.lt(startAngle)) endAngle = endAngle.add(new EDA_ANGLE(360));

  return endAngle.sub(startAngle).AsDegrees();
}

/** `EDA_ANGLE::IsCardinal`: a whole multiple of 90 degrees. */
export function isCardinal(degrees: number): boolean {
  let test = degrees;
  while (test < 0.0) test += 90.0;
  while (test >= 90.0) test -= 90.0;
  return test === 0.0;
}

export class ArMatrix {
  /** Size of the grid for autoplace/autoroute, in IU. */
  gridRouting = 0;
  /** 1 or 2. The autoplacer always uses 2; several methods branch on it. */
  routingLayersCount = 1;
  /** The board bounding box, snapped onto the routing grid. */
  brdBox: Box2 = { x: 0, y: 0, w: 0, h: 0 };
  nrows = 0;
  ncols = 0;
  routeLayerTop = 'F.Cu';
  routeLayerBottom = 'B.Cu';

  /** Cell flags, indexed [side][row * ncols + col]. */
  private boardSide: [Uint8Array, Uint8Array] = [new Uint8Array(0), new Uint8Array(0)];
  /** Placement cost, same indexing. */
  private distSide: [Int32Array, Int32Array] = [new Int32Array(0), new Int32Array(0)];

  /** `GetBrdCoordOrigin()`, the board coordinate of cell (0, 0). */
  get brdCoordOrigin(): { x: number; y: number } {
    return { x: this.brdBox.x, y: this.brdBox.y };
  }

  /**
   * `ComputeMatrixSize`. The box start is snapped onto the grid by subtracting
   * `x % grid` — truncating, so a negative origin snaps *inwards* (towards
   * zero) while a positive one snaps outwards. The end is then snapped down and
   * pushed out by one whole grid step, and one spare row and column are added.
   */
  computeMatrixSize(aBoundingBox: Box2): void {
    const g = this.gridRouting;
    const box: Box2 = { ...aBoundingBox };

    // SetX / SetY move the origin and take the end with them.
    box.x = box.x - (box.x % g);
    box.y = box.y - (box.y % g);

    let endX = boxRight(box);
    let endY = boxBottom(box);

    endX -= endX % g;
    endX += g;
    endY -= endY % g;
    endY += g;

    box.w = endX - box.x;
    box.h = endY - box.y;
    this.brdBox = box;

    this.nrows = idiv(box.h, g);
    this.ncols = idiv(box.w, g);

    // Gives a small margin.
    this.ncols += 1;
    this.nrows += 1;
  }

  /** `InitRoutingMatrix`: allocate both sides, everything empty. */
  initRoutingMatrix(): boolean {
    if (this.nrows <= 0 || this.ncols <= 0) return false;

    // Upstream gives a small margin for memory allocation.
    const n = (this.nrows + 1) * (this.ncols + 1);
    this.boardSide = [new Uint8Array(n), new Uint8Array(n)];
    this.distSide = [new Int32Array(n), new Int32Array(n)];
    return true;
  }

  /** `UnInitRoutingMatrix`. */
  unInitRoutingMatrix(): void {
    this.boardSide = [new Uint8Array(0), new Uint8Array(0)];
    this.distSide = [new Int32Array(0), new Int32Array(0)];
    this.nrows = 0;
    this.ncols = 0;
  }

  private at(row: number, col: number): number {
    if (row < 0 || col < 0 || row >= this.nrows || col >= this.ncols) return -1;
    return row * this.ncols + col;
  }

  getCell(row: number, col: number, side: number): number {
    const i = this.at(row, col);
    return i < 0 ? 0 : this.boardSide[side === AR_SIDE_TOP ? 0 : 1]![i]!;
  }

  setCell(row: number, col: number, side: number, value: number): void {
    const i = this.at(row, col);
    if (i >= 0) this.boardSide[side === AR_SIDE_TOP ? 0 : 1]![i] = value;
  }

  getDist(row: number, col: number, side: number): number {
    const i = this.at(row, col);
    return i < 0 ? 0 : this.distSide[side === AR_SIDE_TOP ? 0 : 1]![i]!;
  }

  setDist(row: number, col: number, side: number, value: number): void {
    const i = this.at(row, col);
    if (i >= 0) this.distSide[side === AR_SIDE_TOP ? 0 : 1]![i] = value;
  }

  /** `WriteCell` through the operation `SetCellOperation` selected. */
  writeCell(row: number, col: number, side: number, value: number, op: CellOp): void {
    const i = this.at(row, col);
    if (i < 0) return;
    const buf = this.boardSide[side === AR_SIDE_TOP ? 0 : 1]!;
    switch (op) {
      case 'write':
        buf[i] = value;
        break;
      case 'or':
        buf[i]! |= value;
        break;
      case 'xor':
        buf[i]! ^= value;
        break;
      case 'and':
        buf[i]! &= value;
        break;
      case 'add':
        buf[i]! += value;
        break;
    }
  }

  /** Copy one side's cell map onto the other (the `memcpy` in genPlacementRoutingMatrix). */
  copySide(from: number, to: number): void {
    this.boardSide[to === AR_SIDE_TOP ? 0 : 1]!.set(this.boardSide[from === AR_SIDE_TOP ? 0 : 1]!);
  }

  /**
   * `OP_CELL`: an undefined layer writes both sides, otherwise only the side
   * whose route layer the shape is on.
   */
  private opCell(layer: string | null, row: number, col: number, color: number, op: CellOp): void {
    if (layer === null) {
      this.writeCell(row, col, AR_SIDE_BOTTOM, color, op);
      if (this.routingLayersCount > 1) this.writeCell(row, col, AR_SIDE_TOP, color, op);
    } else {
      if (layer === this.routeLayerBottom) this.writeCell(row, col, AR_SIDE_BOTTOM, color, op);
      if (this.routingLayersCount > 1 && layer === this.routeLayerTop)
        this.writeCell(row, col, AR_SIDE_TOP, color, op);
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
    layer: string | null,
    color: number,
    op: CellOp,
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
    const demiPas = idiv(this.gridRouting, 2);

    let colMin = idiv(ux0 - lg, this.gridRouting);
    if (colMin < 0) colMin = 0;

    let colMax = idiv(ux1 + lg + demiPas, this.gridRouting);
    if (colMax > this.ncols - 1) colMax = this.ncols - 1;

    let rowMin: number;
    let rowMax: number;

    if (inc > 0) {
      rowMin = idiv(uy0 - lg, this.gridRouting);
      rowMax = idiv(uy1 + lg + demiPas, this.gridRouting);
    } else {
      rowMin = idiv(uy1 - lg, this.gridRouting);
      rowMax = idiv(uy0 + lg + demiPas, this.gridRouting);
    }

    if (rowMin < 0) rowMin = 0;
    if (rowMin > this.nrows - 1) rowMin = this.nrows - 1;
    if (rowMax < 0) rowMax = 0;
    if (rowMax > this.nrows - 1) rowMax = this.nrows - 1;

    const angle = EDA_ANGLE.fromVector({ x: ux1 - ux0, y: uy1 - uy0 });
    // Rotated so the segment lies along +X: dx becomes its length, dy zero.
    const dx = RotatePoint({ x: ux1 - ux0, y: uy1 - uy0 }, angle).x;

    for (let col = colMin; col <= colMax; col++) {
      const cxr = col * this.gridRouting - ux0;

      for (let row = rowMin; row <= rowMax; row++) {
        const rotated = RotatePoint({ x: cxr, y: row * this.gridRouting - uy0 }, angle);
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
          continue;
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
    layer: string | null,
    color: number,
    op: CellOp,
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
    layer: string | null,
    color: number,
    op: CellOp,
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
    layerMask: readonly string[],
    color: number,
    op: CellOp,
  ): void {
    let trace = 0;
    if (onLayer(layerMask, this.routeLayerBottom)) trace = 1;
    if (onLayer(layerMask, this.routeLayerTop) && this.routingLayersCount > 1) trace |= 2;
    if (trace === 0) return;

    const cx = cxIn - this.brdCoordOrigin.x;
    const cy = cyIn - this.brdCoordOrigin.y;

    const ux0 = cx - radius;
    const uy0 = cy - radius;
    const ux1 = cx + radius;
    const uy1 = cy + radius;

    let rowMax = idiv(uy1, this.gridRouting);
    let colMax = idiv(ux1, this.gridRouting);
    let rowMin = idiv(uy0, this.gridRouting);
    let colMin = idiv(ux0, this.gridRouting);

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.nrows - 1) rowMax = this.nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.ncols - 1) colMax = this.ncols - 1;
    if (rowMin > rowMax) rowMax = rowMin;
    if (colMin > colMax) colMax = colMin;

    let fdistmin = radius * radius;
    let tstwrite = false;

    for (let row = rowMin; row <= rowMax; row++) {
      const fdisty = (cy - row * this.gridRouting) ** 2;

      for (let col = colMin; col <= colMax; col++) {
        const fdistx = (cx - col * this.gridRouting) ** 2;
        if (fdistmin <= fdistx + fdisty) continue;

        if (trace & 1) this.writeCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.writeCell(row, col, AR_SIDE_TOP, color, op);
        tstwrite = true;
      }
    }

    if (tstwrite) return;

    // Nothing was written: a pad off grid, in the centre of its four diagonal
    // neighbours. Claim them instead.
    const distmin = idiv(this.gridRouting, 2) + 1;
    fdistmin = distmin * distmin * 2;

    for (let row = rowMin; row <= rowMax; row++) {
      const fdisty = (cy - row * this.gridRouting) ** 2;

      for (let col = colMin; col <= colMax; col++) {
        const fdistx = (cx - col * this.gridRouting) ** 2;
        if (fdistmin <= fdistx + fdisty) continue;

        if (trace & 1) this.writeCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.writeCell(row, col, AR_SIDE_TOP, color, op);
      }
    }
  }

  /** `TraceFilledRectangle`, the axis-aligned overload. Board coordinates. */
  traceFilledRectangle(
    ux0In: number,
    uy0In: number,
    ux1In: number,
    uy1In: number,
    layerMask: readonly string[],
    color: number,
    op: CellOp,
  ): void {
    let trace = 0;
    if (onLayer(layerMask, this.routeLayerBottom)) trace = 1;
    if (onLayer(layerMask, this.routeLayerTop) && this.routingLayersCount > 1) trace |= 2;
    if (trace === 0) return;

    const org = this.brdCoordOrigin;
    const ux0 = ux0In - org.x;
    const uy0 = uy0In - org.y;
    const ux1 = ux1In - org.x;
    const uy1 = uy1In - org.y;

    let rowMax = idiv(uy1, this.gridRouting);
    let colMax = idiv(ux1, this.gridRouting);
    let rowMin = idiv(uy0, this.gridRouting);
    if (uy0 > rowMin * this.gridRouting) rowMin++;
    let colMin = idiv(ux0, this.gridRouting);
    if (ux0 > colMin * this.gridRouting) colMin++;

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.nrows - 1) rowMax = this.nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.ncols - 1) colMax = this.ncols - 1;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (trace & 1) this.writeCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.writeCell(row, col, AR_SIDE_TOP, color, op);
      }
    }
  }

  /**
   * `TraceFilledRectangle`, the rotated overload: `angle` is in tenths of a
   * degree, and each candidate cell is rotated *back* into the rectangle's frame
   * before being tested against its bounds (exclusively on all four sides).
   */
  traceFilledRectangleAngled(
    ux0In: number,
    uy0In: number,
    ux1In: number,
    uy1In: number,
    angleTenths: number,
    layerMask: readonly string[],
    color: number,
    op: CellOp,
  ): void {
    let trace = 0;
    if (onLayer(layerMask, this.routeLayerBottom)) trace = 1;
    if (onLayer(layerMask, this.routeLayerTop) && this.routingLayersCount > 1) trace |= 2;
    if (trace === 0) return;

    const org = this.brdCoordOrigin;
    const ux0 = ux0In - org.x;
    const uy0 = uy0In - org.y;
    const ux1 = ux1In - org.x;
    const uy1 = uy1In - org.y;

    const cx = idiv(ux0 + ux1, 2);
    const cy = idiv(uy0 + uy1, 2);
    const radius = EuclideanNormI({ x: ux0 - cx, y: uy0 - cy });

    let rowMax = idiv(cy + radius, this.gridRouting);
    let colMax = idiv(cx + radius, this.gridRouting);
    let rowMin = idiv(cy - radius, this.gridRouting);
    if (uy0 > rowMin * this.gridRouting) rowMin++;
    let colMin = idiv(cx - radius, this.gridRouting);
    if (ux0 > colMin * this.gridRouting) colMin++;

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.nrows - 1) rowMax = this.nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.ncols - 1) colMax = this.ncols - 1;

    const angle = new EDA_ANGLE(angleTenths, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T).negate();

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const r = RotatePoint(
          { x: col * this.gridRouting, y: row * this.gridRouting },
          { x: cx, y: cy },
          angle,
        );

        if (r.y <= uy0) continue;
        if (r.y >= uy1) continue;
        if (r.x <= ux0) continue;
        if (r.x >= ux1) continue;

        if (trace & 1) this.writeCell(row, col, AR_SIDE_BOTTOM, color, op);
        if (trace & 2) this.writeCell(row, col, AR_SIDE_TOP, color, op);
      }
    }
  }

  /**
   * `TracePcbShape`. Only segments, circles and arcs are traced — a rectangle,
   * polygon or bezier on a non-`Edge.Cuts` layer is no obstacle at all as far as
   * the autoplacer is concerned, which is upstream's behaviour, not an omission.
   */
  tracePcbShape(shape: PcbShape, color: number, margin: number, op: CellOp): void {
    const halfWidth = idiv(shape.width, 2) + margin;
    const org = this.brdCoordOrigin;
    // Draw on all layers.
    const layer = null;

    if (shape.kind === 'circle') {
      if (!shape.center || !shape.end) return;
      this.traceCircle(
        shape.center.x - org.x,
        shape.center.y - org.y,
        shape.end.x - org.x,
        shape.end.y - org.y,
        halfWidth,
        layer,
        color,
        op,
      );
    } else if (shape.kind === 'line') {
      if (!shape.start || !shape.end) return;
      this.drawSegmentQcq(
        shape.start.x - org.x,
        shape.start.y - org.y,
        shape.end.x - org.x,
        shape.end.y - org.y,
        halfWidth,
        layer,
        color,
        op,
      );
    } else if (shape.kind === 'arc') {
      if (!shape.start || !shape.mid || !shape.end) return;
      const centre = arcCenter(shape.start, shape.mid, shape.end);
      if (!centre) return;
      this.traceArc(
        Math.round(centre.x) - org.x,
        Math.round(centre.y) - org.y,
        shape.start.x - org.x,
        shape.start.y - org.y,
        arcSweepDegrees(centre, shape.start, shape.end),
        halfWidth,
        layer,
        color,
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
  createKeepOutRectangle(
    ux0In: number,
    uy0In: number,
    ux1In: number,
    uy1In: number,
    marge: number,
    aKeepOut: number,
    layerMask: readonly string[],
  ): void {
    let trace = 0;
    if (onLayer(layerMask, this.routeLayerBottom)) trace = 1;
    // Note the truthiness test on the layer count, where every other tracer
    // here asks for `> 1`.
    if (onLayer(layerMask, this.routeLayerTop) && this.routingLayersCount) trace |= 2;
    if (trace === 0) return;

    const ux0 = ux0In - this.brdBox.x - marge;
    const uy0 = uy0In - this.brdBox.y - marge;
    const ux1 = ux1In - this.brdBox.x + marge;
    const uy1 = uy1In - this.brdBox.y + marge;

    let pmarge = idiv(marge, this.gridRouting);
    if (pmarge < 1) pmarge = 1;

    let rowMax = idiv(uy1, this.gridRouting);
    let colMax = idiv(ux1, this.gridRouting);
    let rowMin = idiv(uy0, this.gridRouting);
    if (uy0 > rowMin * this.gridRouting) rowMin++;
    let colMin = idiv(ux0, this.gridRouting);
    if (ux0 > colMin * this.gridRouting) colMin++;

    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.nrows - 1) rowMax = this.nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.ncols - 1) colMax = this.ncols - 1;

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
          this.setDist(row, col, AR_SIDE_BOTTOM, this.getDist(row, col, AR_SIDE_BOTTOM) + localKeepOut);
        }

        if (trace & 2) {
          this.setDist(
            row,
            col,
            AR_SIDE_TOP,
            Math.max(this.getDist(row, col, AR_SIDE_TOP), localKeepOut),
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
  placePad(pad: PcbPad, color: number, marge: number, op: CellOp): void {
    // `ShapePos`: the pad centre plus its shape offset. This model carries no
    // shape offset, so the centre is the shape position.
    const shapePos = pad.at;

    let dx = idiv(pad.size.x, 2) + marge;

    if (pad.shape === 'circle') {
      this.traceFilledCircle(shapePos.x, shapePos.y, dx, pad.layers, color, op);
      return;
    }

    let dy = idiv(pad.size.y, 2) + marge;

    if (pad.shape === 'trapezoid') {
      dx += idiv(Math.abs(pad.delta?.y ?? 0), 2);
      dy += idiv(Math.abs(pad.delta?.x ?? 0), 2);
    }

    if (isCardinal(pad.angle)) {
      // Upstream compares the raw angle against 90 and 270 with `operator==`,
      // which is an exact comparison of the stored degrees and not a normalised
      // one. A pad at -90 is cardinal, so it takes this branch, but does *not*
      // swap its axes — it is traced with its width and height the wrong way
      // round. Reproduced rather than corrected.
      if (pad.angle === 90 || pad.angle === 270) {
        [dx, dy] = [dy, dx];
      }

      this.traceFilledRectangle(
        shapePos.x - dx,
        shapePos.y - dy,
        shapePos.x + dx,
        shapePos.y + dy,
        pad.layers,
        color,
        op,
      );
    } else {
      this.traceFilledRectangleAngled(
        shapePos.x - dx,
        shapePos.y - dy,
        shapePos.x + dx,
        shapePos.y + dy,
        new EDA_ANGLE(pad.angle).AsTenthsOfADegree(),
        pad.layers,
        color,
        op,
      );
    }
  }
}
