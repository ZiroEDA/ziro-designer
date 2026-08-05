// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint autoplacement. Counterpart: `pcbnew/autorouter/ar_autoplacer.cpp`
 * (AR_AUTOPLACER), driven the way `autoplace_tool.cpp` drives it.
 *
 * One footprint is placed at a time, and the choice of *which* one is as much
 * of the algorithm as the choice of where. Each round:
 *
 *  1. {@link Autoplacer.pickFootprint} ranks every footprint on the board by
 *     bounding-box area times pad count, then re-ranks by area times the number
 *     of ratsnest edges leaving it, and takes the first still-unplaced one with
 *     any ratsnest at all — the biggest, busiest part first, so the parts that
 *     have to reach it can be pulled in around it afterwards.
 *  2. {@link Autoplacer.getOptimalFPPlacement} sweeps that footprint over every
 *     grid position that fits inside the board, columns before rows, scoring
 *     each with the ratsnest cost plus the keep-out cost read out of the matrix.
 *  3. The winner is committed and burned into the matrix, so the next footprint
 *     sees it as occupied and pays to sit near it.
 *
 * The scoring detail that decides the layout, and that a rewrite always gets
 * wrong: ties go to the *last* position tried, because upstream accepts a new
 * best on `min_cost >= Score`, not `>`. Sweeping x outermost and y innermost,
 * that puts a tied footprint at the bottom-right of the tied region rather than
 * the top-left. Change either the comparison or the loop nesting and every board
 * with a symmetry — which is most boards — comes out mirrored from KiCad's.
 *
 * The cost of one airwire is `hypot(dx, dy * 2)` after sorting the two so that
 * `dx >= dy`: a length, plus a penalty that is worst at 45 degrees and zero for
 * a horizontal or vertical run.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { boardItemId, moveBoardItems } from './edit-board.js';
import { chainOutlines, shapePoints } from './courtyard.js';
import { buildRatsnest } from './ratsnest.js';
import type { Board, PcbFootprint, PcbPad, PcbShape, PcbTextItem } from './types.js';
import {
  AR_SIDE_BOTTOM,
  AR_SIDE_TOP,
  ArMatrix,
  CELL_IS_EDGE,
  CELL_IS_HOLE,
  CELL_IS_MODULE,
  CELL_IS_ZONE,
  boxBottom,
  boxContains,
  boxInflate,
  boxMove,
  boxRight,
  idiv,
  sideMask,
  type Box2,
} from './autoplace_matrix.js';

/** `AR_GAIN`: divides the grid-times-pad-count keep-out margin. */
const AR_GAIN = 16;
/** `AR_KEEPOUT_MARGIN`: the cost a cell right under a placed footprint carries. */
const AR_KEEPOUT_MARGIN = 500;

/** `STEP_AR_MM`: the placement grid, 1 mm. */
export const AR_STEP_MM = 1.0;

/** `AR_CELL_STATE`. `testFootprintOnBoard` returns one of these, or a cost >= 0. */
const AR_OUT_OF_BOARD = -2;
const AR_OCCUIPED_BY_MODULE = -1;
const AR_FREE_CELL = 0;

/** Tessellation error for turning a curved graphic into an outline, 5 µm. */
const OUTLINE_MAX_ERROR = mmToIU(0.005);

/**
 * `BOARD::GetOutlinesChainingEpsilon`'s default, 0.01 mm: how far apart two
 * `Edge.Cuts` endpoints may be and still count as the same corner.
 */
const OUTLINE_CHAINING_EPSILON = mmToIU(0.01);

/** Layers a sided footprint's annotations live on, excluded from its extents. */
const ANNOTATION_LAYERS: ReadonlySet<string> = new Set([
  'Cmts.User',
  'Dwgs.User',
  'Eco1.User',
  'Eco2.User',
]);

export interface AutoplaceOptions {
  /**
   * `PAD::GetOwnClearance( pad->GetLayer() )` in IU: the clearance the design
   * rules give this pad. Injected rather than resolved here — the constraint
   * resolver lives in the DRC engine, and the autoplacer must not be the thing
   * that decides what a clearance is.
   */
  padClearance: (pad: PcbPad, footprint: PcbFootprint) => number;
  /** The placement grid in IU. Defaults to `AR_STEP_MM`; floors at 0.25 mm. */
  gridSize?: number;
  /**
   * `aPlaceOffboardModules`: also place every footprint whose position falls
   * outside the matrix box, on top of the ones asked for.
   */
  placeOffboardFootprints?: boolean;
}

export interface AutoplaceResult {
  /** The board with the placed footprints moved. Unchanged on failure. */
  board: Board;
  /** `AR_RESULT`. `failure` means the board has no usable `Edge.Cuts` extents. */
  status: 'completed' | 'failure';
  /** Footprint indices in the order they were placed. */
  order: number[];
}

// ----- geometry the placer needs from the board model ------------------------

const emptyBox = (): Box2 | null => null;

const mergePoint = (box: Box2 | null, x: number, y: number): Box2 => {
  if (!box) return { x, y, w: 0, h: 0 };
  const minX = Math.min(box.x, x);
  const minY = Math.min(box.y, y);
  const maxX = Math.max(boxRight(box), x);
  const maxY = Math.max(boxBottom(box), y);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const mergeBox = (box: Box2 | null, other: Box2 | null): Box2 | null => {
  if (!other) return box;
  const a = mergePoint(box, other.x, other.y);
  return mergePoint(a, boxRight(other), boxBottom(other));
};

/** Round a box's corners to integers, which is what a `BOX2I` holds. */
const roundBox = (b: Box2): Box2 => {
  const x = Math.round(b.x);
  const y = Math.round(b.y);
  return { x, y, w: Math.round(b.x + b.w) - x, h: Math.round(b.y + b.h) - y };
};

/**
 * `PCB_SHAPE::GetBoundingBox`. A circle is exact (centre plus radius); curved
 * shapes are measured from the same tessellation the courtyard builder uses,
 * which is inside upstream's exact arc extents by at most the tessellation
 * error.
 */
function shapeExtent(s: PcbShape): Box2 | null {
  let box = emptyBox();

  if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    box = { x: s.center.x - r, y: s.center.y - r, w: 2 * r, h: 2 * r };
  } else {
    const pts = shapePoints(s, OUTLINE_MAX_ERROR)?.pts ?? [
      ...(s.start ? [s.start] : []),
      ...(s.mid ? [s.mid] : []),
      ...(s.end ? [s.end] : []),
      ...(s.pts ?? []),
    ];
    for (const p of pts) box = mergePoint(box, p.x, p.y);
  }

  return box ? boxInflate(box, Math.max(0, s.width) / 2) : null;
}

/** `PAD::GetBoundingBox`: the pad's size rectangle at its orientation. */
function padExtent(pad: PcbPad): Box2 {
  const hw = pad.size.x / 2;
  const hh = pad.size.y / 2;
  const rad = (pad.angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  let box = emptyBox();

  for (const corner of [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]) {
    // The reader stores pad angles board-frame absolute, with KiCad's
    // clockwise-positive convention (read-board.ts).
    box = mergePoint(box, pad.at.x + corner.x * c + corner.y * sn, pad.at.y + corner.y * c - corner.x * sn);
  }

  return box!;
}

/** The same crude glyph-width estimate the rest of the board editor uses. */
function textExtent(t: PcbTextItem): Box2 {
  const hw = Math.max(t.text.length, 1) * t.size.x * 0.6;
  const hh = t.size.y / 2;
  return { x: t.at.x - hw, y: t.at.y - hh, w: 2 * hw, h: 2 * hh };
}

/**
 * `FOOTPRINT::GetBoundingBox( false )`, the text-excluded extents every part of
 * the autoplacer measures a footprint by.
 *
 * The seed is a zero-size box at the footprint anchor inflated by 0.25 mm, so a
 * footprint always has some extent even with nothing in it, and a footprint
 * whose geometry sits far from its anchor is measured from the anchor outwards.
 * Annotation layers are dropped for a sided footprint; text only counts when
 * there is nothing else at all.
 */
export function footprintExtent(fp: PcbFootprint): Box2 {
  let box: Box2 | null = boxInflate({ x: fp.at.x, y: fp.at.y, w: 0, h: 0 }, mmToIU(0.25));

  const sided = fp.layer === 'F.Cu' || fp.layer === 'B.Cu';

  for (const s of fp.shapes) {
    if (sided && ANNOTATION_LAYERS.has(s.layer)) continue;
    box = mergeBox(box, shapeExtent(s));
  }

  for (const pad of fp.pads) box = mergeBox(box, padExtent(pad));

  // Upstream's `m_drawings` holds graphics and free text but not the fields, so
  // the reference and value never keep this test from firing.
  const userTexts = fp.texts.filter((t) => t.kind === 'user');
  const noDrawItems = fp.shapes.length === 0 && userTexts.length === 0 && fp.pads.length === 0;

  if (noDrawItems) {
    for (const t of fp.texts) box = mergeBox(box, textExtent(t));
  }

  return roundBox(box!);
}

/** `FOOTPRINT::GetArea( 0 )`: the text-excluded bounding box's area. */
export function footprintArea(fp: PcbFootprint): number {
  const box = footprintExtent(fp);
  return Math.abs(box.w) * Math.abs(box.h);
}

/**
 * `BOARD::GetBoardEdgesBoundingBox`: the extents of every `Edge.Cuts` graphic,
 * board level and inside footprints alike. Null when there are none.
 */
export function boardEdgesBoundingBox(board: Board): Box2 | null {
  let box = emptyBox();

  for (const s of board.shapes) {
    if (s.layer === 'Edge.Cuts') box = mergeBox(box, shapeExtent(s));
  }

  for (const fp of board.footprints) {
    for (const s of fp.shapes) {
      if (s.layer === 'Edge.Cuts') box = mergeBox(box, shapeExtent(s));
    }
  }

  return box ? roundBox(box) : null;
}

/**
 * The board outline as closed rings of integer points, for the scanline fill.
 *
 * Upstream builds a `SHAPE_POLY_SET` and fractures it, then scans outline 0.
 * Fracturing folds a polygon's holes into its outer contour precisely so that a
 * crossing-parity scan of the result fills the same area as an even-odd scan of
 * the contour and its holes, which is what this does directly — so cut-outs
 * come out identical. What is not reproduced is upstream's *discarding* of
 * outlines 1 and beyond: a board drawn as two disjoint islands fills both here
 * and only the first upstream. Nor is `BuildBoardPolygonOutlines`' test for
 * whether a footprint's own `Edge.Cuts` graphics are a cut-out or a board of
 * their own (`isCopperOutside`) — every ring counts here, and the even-odd scan
 * then reads a closed one inside the board as a hole. Right for a milled slot,
 * wrong for the rare footprint that carries a whole board outline.
 */
export function boardOutlineRings(board: Board): Vec2[][] {
  const edges = [
    ...board.shapes.filter((s) => s.layer === 'Edge.Cuts'),
    ...board.footprints.flatMap((fp) => fp.shapes.filter((s) => s.layer === 'Edge.Cuts')),
  ];

  const closed: Vec2[][] = [];
  const open: Vec2[][] = [];

  for (const s of edges) {
    const pts = shapePoints(s, OUTLINE_MAX_ERROR);
    if (!pts) continue;
    (pts.closed ? closed : open).push(pts.pts);
  }

  // `ConvertOutlineToPolygon`'s chaining, shared with the courtyard builder and
  // the malformed-outline DRC check so the three agree on what closes. A run
  // that never closes is dropped along with everything after it, exactly as it
  // is there.
  const chained = chainOutlines(open, OUTLINE_CHAINING_EPSILON).outlines;

  return [...closed, ...chained].map((ring) =>
    ring.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
  );
}

// ----- the placer ------------------------------------------------------------

/**
 * `AR_AUTOPLACER`. Exported for the tests, which drive the matrix build and the
 * position sweep separately; callers want {@link autoplaceFootprints}.
 */
export class Autoplacer {
  board: Board;
  matrix = new ArMatrix();
  curPosition: Vec2 = { x: 0, y: 0 };
  /** `FOOTPRINT::NeedsPlaced`, by footprint index. */
  needsPlaced = new Set<number>();

  constructor(
    board: Board,
    private readonly opts: AutoplaceOptions,
  ) {
    this.board = board;
  }

  private get grid(): number {
    return this.matrix.gridRouting;
  }

  /** `placeFootprint`: `SetPosition`, which drags the footprint's children along. */
  placeFootprint(index: number, pos: Vec2): void {
    const fp = this.board.footprints[index]!;
    this.board = moveBoardItems(this.board, new Set([boardItemId('footprint', index)]), {
      x: pos.x - fp.at.x,
      y: pos.y - fp.at.y,
    });
  }

  /** `genPlacementRoutingMatrix`. False is upstream's `return 0`, i.e. AR_FAILURE. */
  genPlacementRoutingMatrix(): boolean {
    this.matrix.unInitRoutingMatrix();

    const bbox = boardEdgesBoundingBox(this.board);
    if (!bbox || bbox.w === 0 || bbox.h === 0) return false;

    this.matrix.computeMatrixSize(bbox);

    // Choose the number of board sides.
    this.matrix.routingLayersCount = 2;
    this.matrix.initRoutingMatrix();
    this.matrix.routeLayerBottom = 'B.Cu';
    this.matrix.routeLayerTop = 'F.Cu';

    // Fill (mark) the cells inside the board.
    this.fillMatrix();

    // Other obstacles. Every board graphic that is not on Edge.Cuts becomes a
    // hole, silkscreen and fabrication notes included — upstream tests the
    // layer only to exclude the outline itself.
    for (const drawing of this.board.shapes) {
      if (drawing.layer !== 'Edge.Cuts') {
        this.matrix.tracePcbShape(drawing, CELL_IS_HOLE | CELL_IS_EDGE, this.grid, 'write');
      }
    }

    // Initialise the top layer to the same value as the bottom layer.
    this.matrix.copySide(AR_SIDE_BOTTOM, AR_SIDE_TOP);
    return true;
  }

  /**
   * `fillMatrix`: mark every cell inside the board outline `CELL_IS_ZONE`, by
   * scanning one horizontal line per grid row and filling between crossings.
   *
   * Two upstream behaviours survive here on purpose. Row 0 is skipped
   * (`if( idy <= 0 ) continue;`), so the topmost row of the matrix is never
   * inside the board and nothing can be placed against it. And an odd number of
   * crossings on any row abandons the whole fill from that row down — the rows
   * already done keep their cells, and the caller ignores the failure.
   */
  fillMatrix(): boolean {
    const step = this.grid;
    const origin = this.matrix.brdCoordOrigin;
    const rings = boardOutlineRings(this.board);
    if (rings.length === 0) return true;

    let top = Infinity;
    let bottom = -Infinity;
    for (const ring of rings) {
      for (const p of ring) {
        if (p.y < top) top = p.y;
        if (p.y > bottom) bottom = p.y;
      }
    }

    for (let refy = top; refy < bottom; refy += step) {
      // The row index of the current line scan inside the placement matrix.
      const idy = idiv(refy - origin.y, step);

      if (idy >= this.matrix.nrows) break;
      if (idy <= 0) continue;

      // Every crossing of the infinite line y = refy with a polyline side.
      const xs: number[] = [];

      for (const ring of rings) {
        for (let v = 0; v < ring.length; v++) {
          const a = ring[v]!;
          const b = ring[(v + 1) % ring.length]!;

          // Trivially above or below the scan line.
          if (a.y > refy && b.y > refy) continue;
          if (a.y <= refy && b.y <= refy) continue;

          const segEndX = b.x - a.x;
          const segEndY = b.y - a.y;
          if (segEndY === 0) continue; // horizontal, already excluded above

          const invSlope = segEndX / segEndY;
          xs.push(Math.trunc((refy - a.y) * invSlope) + a.x);
        }
      }

      xs.sort((p, q) => p - q);

      // An even count is expected: a segment has two ends.
      if ((xs.length & 1) !== 0) return false;

      const iimax = xs.length - 1;

      for (let ii = 0; ii < iimax; ii += 2) {
        const segStartX = xs[ii]! - origin.x;
        const segEndX = xs[ii + 1]! - origin.x;

        for (let idx = idiv(segStartX, step); idx < this.matrix.ncols; idx++) {
          if (idx * step > segEndX) break;
          if (idx * step >= segStartX) this.matrix.setCell(idy, idx, AR_SIDE_BOTTOM, CELL_IS_ZONE);
        }
      }
    }

    return true;
  }

  /**
   * `genModuleOnRoutingMatrix`: burn a placed footprint into the matrix as
   * occupied cells, and lay its cost gradient into the dist map.
   *
   * The keep-out margin is `grid * padCount / 16` — the cost halo around a
   * footprint grows with how many pads it has, so the placer keeps space around
   * a connector and crowds resistors together.
   */
  genModuleOnRoutingMatrix(index: number): void {
    const fp = this.board.footprints[index]!;
    const fpBBox = boxInflate(footprintExtent(fp), idiv(this.grid, 2));

    const brd = this.matrix.brdBox;
    const clampX = (v: number): number => Math.min(Math.max(v, brd.x), boxRight(brd));
    const clampY = (v: number): number => Math.min(Math.max(v, brd.y), boxBottom(brd));

    const ox = clampX(fpBBox.x);
    const fx = clampX(boxRight(fpBBox));
    const oy = clampY(fpBBox.y);
    const fy = clampY(boxBottom(fpBBox));

    const layerMask = sideMask(fp.layer);

    this.matrix.traceFilledRectangle(ox, oy, fx, fy, layerMask, CELL_IS_MODULE, 'or');

    for (const pad of fp.pads) {
      const margin = idiv(this.grid, 2) + this.opts.padClearance(pad, fp);
      this.matrix.placePad(pad, CELL_IS_MODULE, margin, 'or');
    }

    const margin = idiv(this.grid * fp.pads.length, AR_GAIN);
    this.matrix.createKeepOutRectangle(ox, oy, fx, fy, margin, AR_KEEPOUT_MARGIN, layerMask);
  }

  /**
   * `testRectangle`: is every cell the rectangle covers inside the board and
   * free? The rectangle is inflated by half a grid step first, so a footprint
   * has to clear the cells around it as well as the ones it sits on.
   */
  testRectangle(aRect: Box2, side: number): number {
    const rect = boxInflate(aRect, idiv(this.grid, 2));
    const brd = this.matrix.brdBox;

    const startX = rect.x - brd.x;
    const startY = rect.y - brd.y;
    const endX = boxRight(rect) - brd.x;
    const endY = boxBottom(rect) - brd.y;

    let rowMin = idiv(startY, this.grid);
    let rowMax = idiv(endY, this.grid);
    let colMin = idiv(startX, this.grid);
    let colMax = idiv(endX, this.grid);

    if (startY > rowMin * this.grid) rowMin++;
    if (startX > colMin * this.grid) colMin++;
    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.matrix.nrows - 1) rowMax = this.matrix.nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.matrix.ncols - 1) colMax = this.matrix.ncols - 1;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const data = this.matrix.getCell(row, col, side);

        if ((data & CELL_IS_ZONE) === 0) return AR_OUT_OF_BOARD;
        if (data & CELL_IS_MODULE) return AR_OCCUIPED_BY_MODULE;
      }
    }

    return AR_FREE_CELL;
  }

  /** `calculateKeepOutArea`: the summed cost of the cells the rectangle covers. */
  calculateKeepOutArea(aRect: Box2, side: number): number {
    const brd = this.matrix.brdBox;

    const startX = aRect.x - brd.x;
    const startY = aRect.y - brd.y;
    const endX = boxRight(aRect) - brd.x;
    const endY = boxBottom(aRect) - brd.y;

    let rowMin = idiv(startY, this.grid);
    let rowMax = idiv(endY, this.grid);
    let colMin = idiv(startX, this.grid);
    let colMax = idiv(endX, this.grid);

    if (startY > rowMin * this.grid) rowMin++;
    if (startX > colMin * this.grid) colMin++;
    if (rowMin < 0) rowMin = 0;
    if (rowMax >= this.matrix.nrows - 1) rowMax = this.matrix.nrows - 1;
    if (colMin < 0) colMin = 0;
    if (colMax >= this.matrix.ncols - 1) colMax = this.matrix.ncols - 1;

    let keepOutCost = 0;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        keepOutCost += this.matrix.getDist(row, col, side);
      }
    }

    return keepOutCost;
  }

  /**
   * `testFootprintOnBoard`: the footprint's extents shifted to the trial
   * position, tested for fit and then priced. A negative return is a refusal
   * ({@link AR_OUT_OF_BOARD} or {@link AR_OCCUIPED_BY_MODULE}); zero or more is
   * the keep-out cost of sitting there.
   */
  testFootprintOnBoard(index: number, tstOtherSide: boolean, offset: Vec2): number {
    const fp = this.board.footprints[index]!;

    const side = fp.layer === 'B.Cu' ? AR_SIDE_BOTTOM : AR_SIDE_TOP;
    const otherside = fp.layer === 'B.Cu' ? AR_SIDE_TOP : AR_SIDE_BOTTOM;

    let fpBBox = boxMove(footprintExtent(fp), -offset.x, -offset.y);

    let diag = this.testRectangle(fpBBox, side);
    if (diag !== AR_FREE_CELL) return diag;

    if (tstOtherSide) {
      diag = this.testRectangle(fpBBox, otherside);
      if (diag !== AR_FREE_CELL) return diag;
    }

    const marge = idiv(this.grid * fp.pads.length, AR_GAIN);

    fpBBox = boxInflate(fpBBox, marge);
    return this.calculateKeepOutArea(fpBBox, side);
  }

  /**
   * `getOptimalFPPlacement`. Returns 1 when no position on the whole board
   * accepted the footprint, in which case {@link curPosition} is left at the
   * matrix origin and the caller places it there anyway.
   */
  getOptimalFPPlacement(index: number): number {
    const fp = this.board.footprints[index]!;
    const brd = this.matrix.brdBox;

    let error = 1;
    let lastPosOK: Vec2 = { x: brd.x, y: brd.y };

    const fpPos = fp.at;
    // Move the extents so the footprint's own position is at (0, 0). Upstream
    // also re-anchors this box to each trial position inside the sweep; the
    // result is never read, because `testFootprintOnBoard` measures the
    // footprint again from scratch, so it is left out here.
    const fpBBox = boxMove(footprintExtent(fp), -fpPos.x, -fpPos.y);

    // The limit of the footprint position, relative to the matrix area.
    const xylimit = {
      x: boxRight(brd) - boxRight(fpBBox),
      y: boxBottom(brd) - boxBottom(fpBBox),
    };

    const initialPos = { x: brd.x - fpBBox.x, y: brd.y - fpBBox.y };

    // Stay on grid.
    initialPos.x -= initialPos.x % this.grid;
    initialPos.y -= initialPos.y % this.grid;

    // A footprint with any pad reaching the far side has to clear that side too.
    let testOtherSide = false;

    if (this.matrix.routingLayersCount > 1) {
      const other = fp.layer === 'B.Cu' ? 'F.Cu' : 'B.Cu';

      for (const pad of fp.pads) {
        if (!pad.layers.includes(other) && !pad.layers.includes('*.Cu')) continue;
        testOtherSide = true;
        break;
      }
    }

    let minCost = -1.0;

    for (let x = initialPos.x; x < xylimit.x; x += this.grid) {
      for (let y = initialPos.y; y < xylimit.y; y += this.grid) {
        const offset = { x: fpPos.x - x, y: fpPos.y - y };
        const keepOutCost = this.testFootprintOnBoard(index, testOtherSide, offset);

        if (keepOutCost >= 0) {
          // The footprint can be put here.
          error = 0;
          const currCost = this.computePlacementRatsnestCost(index, offset);
          const score = currCost + keepOutCost;

          // `>=`, not `>`: a tie moves the footprint on.
          if (minCost >= score || minCost < 0) {
            lastPosOK = { x, y };
            minCost = score;
          }
        }
      }
    }

    this.curPosition = lastPosOK;
    return error;
  }

  /**
   * `nearestPad`: the closest same-net pad on any *other* footprint whose
   * anchor lies inside the matrix box. Footprints still waiting to be placed
   * are not excluded, so a part can be scored against one that has not moved
   * yet.
   */
  nearestPad(refIndex: number, refPad: PcbPad, offset: Vec2): PcbPad | null {
    let nearest: PcbPad | null = null;
    let nearestDist = Infinity;
    const refNet = refPad.net ?? 0;

    for (let i = 0; i < this.board.footprints.length; i++) {
      if (i === refIndex) continue;

      const fp = this.board.footprints[i]!;
      if (!boxContains(this.matrix.brdBox, fp.at.x, fp.at.y)) continue;

      for (const pad of fp.pads) {
        const net = pad.net ?? 0;
        if (net !== refNet || net <= 0) continue;

        const dist = EuclideanNormI({
          x: refPad.at.x - offset.x - pad.at.x,
          y: refPad.at.y - offset.y - pad.at.y,
        });

        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = pad;
        }
      }
    }

    return nearest;
  }

  /**
   * `computePlacementRatsnestCost`: one airwire per pad, to that pad's nearest
   * same-net neighbour, priced at `hypot(dx, dy * 2)` with `dx` the longer axis.
   * Note that this is a *per-pad* nearest neighbour and not a spanning tree —
   * two pads of the same net can both be charged for reaching the same target.
   */
  computePlacementRatsnestCost(index: number, offset: Vec2): number {
    const fp = this.board.footprints[index]!;
    let currCost = 0;

    for (const pad of fp.pads) {
      const nearest = this.nearestPad(index, pad, offset);
      if (!nearest) continue;

      const start = { x: pad.at.x - offset.x, y: pad.at.y - offset.y };
      const end = nearest.at;

      let dx = Math.abs(end.x - start.x);
      let dy = Math.abs(end.y - start.y);

      // Always dx >= dy, so the penalty is on the shorter axis.
      if (dx < dy) [dx, dy] = [dy, dx];

      // Length plus a slope penalty: worst at 45 degrees, nil on an axis.
      currCost += Math.hypot(dx, dy * 2.0);
    }

    return currCost;
  }

  /**
   * `pickFootprint`. Two sorts, both descending and both stable here where
   * upstream's `std::sort` is not: first by area times pad count, then by area
   * times ratsnest-edge count. The first still-unplaced footprint with a
   * non-zero ratsnest wins; if none has one, the *last* unplaced footprint
   * scanned is returned instead, which after the second sort is the least
   * complex one on the board.
   *
   * The edge count is `GetRatsnestForComponent( fp, true )`. Its
   * `aSkipInternalConnections` argument has no effect: an edge with both ends on
   * this footprint fails the first test for want of the flag and is then caught
   * by the `else if( srcFound || dstFound )`, so it is counted anyway. Mirrored,
   * because the flag is what orders the whole placement.
   */
  pickFootprint(): number | null {
    const fps = this.board.footprints;
    let list = fps.map((_, i) => i);

    list = stableSortDesc(list, (i) => footprintArea(fps[i]!) * fps[i]!.pads.length);

    // The connectivity the autoplacer carries holds only footprints — no
    // tracks, vias or zones were ever added to it — so nothing but pad copper
    // can merge two clusters and shorten the ratsnest.
    const padsOnly: Board = { ...this.board, tracks: [], arcs: [], vias: [], zones: [] };
    const edges = buildRatsnest(padsOnly);

    const flags = new Array<number>(fps.length).fill(0);
    for (const e of edges) {
      if (e.aFootprint !== undefined) flags[e.aFootprint]!++;
      if (e.bFootprint !== undefined && e.bFootprint !== e.aFootprint) flags[e.bFootprint]!++;
    }

    list = stableSortDesc(list, (i) => footprintArea(fps[i]!) * flags[i]!);

    let bestFootprint: number | null = null;
    let altFootprint: number | null = null;

    for (const i of list) {
      if (!this.needsPlaced.has(i)) continue;

      altFootprint = i;

      if (flags[i] === 0) continue;

      bestFootprint = i;
      break;
    }

    return bestFootprint ?? altFootprint;
  }
}

/** A stable descending sort by a numeric key, taken once per element. */
function stableSortDesc(list: number[], key: (i: number) => number): number[] {
  const keyed = list.map((i) => ({ i, k: key(i) }));
  keyed.sort((a, b) => b.k - a.k);
  return keyed.map((e) => e.i);
}

/**
 * `AR_AUTOPLACER::AutoplaceFootprints`, driven as `AUTOPLACE_TOOL::autoplace`
 * drives it.
 *
 * `footprints` names the footprints to place by board index; every other
 * footprint is treated as fixed and is burned into the matrix before the first
 * placement, so the ones being placed arrange themselves around what is already
 * there.
 */
export function autoplaceFootprints(
  board: Board,
  footprints: Iterable<number>,
  opts: AutoplaceOptions,
): AutoplaceResult {
  const placer = new Autoplacer(board, opts);

  placer.matrix.gridRouting = opts.gridSize ?? mmToIU(AR_STEP_MM);

  // Ensure the routing grid has a reasonable value.
  if (placer.matrix.gridRouting < mmToIU(0.25)) placer.matrix.gridRouting = mmToIU(0.25);

  if (!placer.genPlacementRoutingMatrix()) return { board, status: 'failure', order: [] };

  const offboard: number[] = [];

  if (opts.placeOffboardFootprints) {
    board.footprints.forEach((fp, i) => {
      if (!boxContains(placer.matrix.brdBox, fp.at.x, fp.at.y)) offboard.push(i);
    });
  }

  for (const i of footprints) {
    if (i >= 0 && i < board.footprints.length) placer.needsPlaced.add(i);
  }

  for (const i of offboard) placer.needsPlaced.add(i);

  for (let i = 0; i < board.footprints.length; i++) {
    if (!placer.needsPlaced.has(i)) placer.genModuleOnRoutingMatrix(i);
  }

  const order: number[] = [];

  for (;;) {
    const index = placer.pickFootprint();
    if (index === null) break;

    placer.getOptimalFPPlacement(index);

    placer.placeFootprint(index, placer.curPosition);
    placer.genModuleOnRoutingMatrix(index);
    placer.needsPlaced.delete(index);
    order.push(index);
  }

  placer.matrix.unInitRoutingMatrix();

  return { board: placer.board, status: 'completed', order };
}
