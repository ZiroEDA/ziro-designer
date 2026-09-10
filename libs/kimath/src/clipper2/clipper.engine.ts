// SPDX-License-Identifier: BSL-1.0
// Clipper2 1.3.0, Angus Johnson 2010-2023 (http://www.angusj.com), ported to
// TypeScript for ZiroEDA. Boost Software License 1.0.
/**
 * `clipper.engine.cpp`: the Vatti scanbeam polygon clipper, as KiCad 10.0.5
 * ships it (thirdparty/clipper2, built with USINGZ — the Z callback only
 * relabels intersection points for arc bookkeeping and never moves an x or
 * y, so it is left out here).
 *
 * Every function keeps its upstream name so the two can be read side by
 * side. Pointers are object references; `nullptr` is `null`; `delete` is a
 * dropped reference. The one structural liberty is the scanline priority
 * queue, which is a sorted array — only its top is ever read.
 */

import {
  type Path64,
  type Paths64,
  type Point64,
  type Rect64,
  ClipType,
  FillRule,
  PathType,
  PointInPolygonResult,
  crossProduct3,
  distanceFromLineSqrd,
  dotProduct3,
  getBounds,
  getClosestPointOnSegment,
  getIntersectPoint,
  invalidRect64,
  nearbyint,
  pointInPolygon,
  ptEq,
  rectContainsRect,
  rectIsEmpty,
  rectMidPoint,
  segmentsIntersect,
  stableSort,
  stdSort,
} from './clipper.core.js';

export enum JoinWith {
  None = 0,
  Left = 1,
  Right = 2,
}
export enum VertexFlags {
  None = 0,
  OpenStart = 1,
  OpenEnd = 2,
  LocalMax = 4,
  LocalMin = 8,
}

export interface Vertex {
  pt: Point64;
  next: Vertex | null;
  prev: Vertex | null;
  flags: number;
}

export interface OutPt {
  pt: Point64;
  next: OutPt;
  prev: OutPt;
  outrec: OutRec;
  horz: HorzSegment | null;
}

function newOutPt(pt: Point64, outrec: OutRec): OutPt {
  const op = { pt: { x: pt.x, y: pt.y }, outrec, horz: null } as OutPt;
  op.next = op;
  op.prev = op;
  return op;
}

export interface OutRec {
  idx: number;
  owner: OutRec | null;
  front_edge: Active | null;
  back_edge: Active | null;
  pts: OutPt | null;
  polypath: PolyPath64 | null;
  splits: OutRec[] | null;
  recursive_split: OutRec | null;
  bounds: Rect64;
  path: Path64;
  is_open: boolean;
}

export interface Active {
  bot: Point64;
  top: Point64;
  curr_x: number;
  dx: number;
  wind_dx: number;
  wind_cnt: number;
  wind_cnt2: number;
  outrec: OutRec | null;
  prev_in_ael: Active | null;
  next_in_ael: Active | null;
  prev_in_sel: Active | null;
  next_in_sel: Active | null;
  jump: Active | null;
  vertex_top: Vertex | null;
  local_min: LocalMinima;
  is_left_bound: boolean;
  join_with: JoinWith;
}

function newActive(local_min: LocalMinima): Active {
  return {
    bot: { x: 0, y: 0 },
    top: { x: 0, y: 0 },
    curr_x: 0,
    dx: 0,
    wind_dx: 1,
    wind_cnt: 0,
    wind_cnt2: 0,
    outrec: null,
    prev_in_ael: null,
    next_in_ael: null,
    prev_in_sel: null,
    next_in_sel: null,
    jump: null,
    vertex_top: null,
    local_min,
    is_left_bound: false,
    join_with: JoinWith.None,
  };
}

export interface LocalMinima {
  vertex: Vertex;
  polytype: PathType;
  is_open: boolean;
}

interface IntersectNode {
  pt: Point64;
  edge1: Active;
  edge2: Active;
}

interface HorzSegment {
  left_op: OutPt;
  right_op: OutPt | null;
  left_to_right: boolean;
}

interface HorzJoin {
  op1: OutPt;
  op2: OutPt;
}

// ---------------------------------------------------------------------------

const isOdd = (val: number): boolean => (val & 1) !== 0;
const isHotEdge = (e: Active): boolean => e.outrec !== null;
const isOpen = (e: Active): boolean => e.local_min.is_open;
const isOpenEndV = (v: Vertex): boolean =>
  (v.flags & (VertexFlags.OpenStart | VertexFlags.OpenEnd)) !== VertexFlags.None;
const isOpenEnd = (ae: Active): boolean => isOpenEndV(ae.vertex_top!);

function getPrevHotEdge(e: Active): Active | null {
  let prev = e.prev_in_ael;
  while (prev && (isOpen(prev) || !isHotEdge(prev))) prev = prev.prev_in_ael;
  return prev;
}

const isFront = (e: Active): boolean => e === e.outrec!.front_edge;

/*******************************************************************************
 *  Dx:                             0(90deg)                                    *
 *                                  |                                           *
 *               +inf (180deg) <--- o ---> -inf (0deg)                          *
 *******************************************************************************/
function getDx(pt1: Point64, pt2: Point64): number {
  const dy = pt2.y - pt1.y;
  if (dy !== 0) return (pt2.x - pt1.x) / dy;
  if (pt2.x > pt1.x) return -Number.MAX_VALUE;
  return Number.MAX_VALUE;
}

/** `TopX`: `std::nearbyint`, which is half-to-even. */
function topX(ae: Active, currentY: number): number {
  if (currentY === ae.top.y || ae.top.x === ae.bot.x) return ae.top.x;
  if (currentY === ae.bot.y) return ae.bot.x;
  return ae.bot.x + nearbyint(ae.dx * (currentY - ae.bot.y));
}

const isHorizontal = (e: Active): boolean => e.top.y === e.bot.y;
const isHeadingRightHorz = (e: Active): boolean => e.dx === -Number.MAX_VALUE;
const isHeadingLeftHorz = (e: Active): boolean => e.dx === Number.MAX_VALUE;
const getPolyType = (e: Active): PathType => e.local_min.polytype;
const isSamePolyType = (e1: Active, e2: Active): boolean =>
  e1.local_min.polytype === e2.local_min.polytype;
const setDx = (e: Active): void => {
  e.dx = getDx(e.bot, e.top);
};
const nextVertex = (e: Active): Vertex =>
  e.wind_dx > 0 ? e.vertex_top!.next! : e.vertex_top!.prev!;
const prevPrevVertex = (ae: Active): Vertex =>
  ae.wind_dx > 0 ? ae.vertex_top!.prev!.prev! : ae.vertex_top!.next!.next!;

function extractFromSEL(ae: Active): Active | null {
  const res = ae.next_in_sel;
  if (res) res.prev_in_sel = ae.prev_in_sel;
  ae.prev_in_sel!.next_in_sel = res;
  return res;
}

function insert1Before2InSEL(ae1: Active, ae2: Active): void {
  ae1.prev_in_sel = ae2.prev_in_sel;
  if (ae1.prev_in_sel) ae1.prev_in_sel.next_in_sel = ae1;
  ae1.next_in_sel = ae2;
  ae2.prev_in_sel = ae1;
}

const isMaximaV = (v: Vertex): boolean => (v.flags & VertexFlags.LocalMax) !== VertexFlags.None;
const isMaxima = (e: Active): boolean => isMaximaV(e.vertex_top!);

function getCurrYMaximaVertex_Open(e: Active): Vertex | null {
  let result = e.vertex_top!;
  if (e.wind_dx > 0)
    while (
      result.next!.pt.y === result.pt.y &&
      (result.flags & (VertexFlags.OpenEnd | VertexFlags.LocalMax)) === VertexFlags.None
    )
      result = result.next!;
  else
    while (
      result.prev!.pt.y === result.pt.y &&
      (result.flags & (VertexFlags.OpenEnd | VertexFlags.LocalMax)) === VertexFlags.None
    )
      result = result.prev!;
  if (!isMaximaV(result)) return null;
  return result;
}

function getCurrYMaximaVertex(e: Active): Vertex | null {
  let result = e.vertex_top!;
  if (e.wind_dx > 0) while (result.next!.pt.y === result.pt.y) result = result.next!;
  else while (result.prev!.pt.y === result.pt.y) result = result.prev!;
  if (!isMaximaV(result)) return null;
  return result;
}

function getMaximaPair(e: Active): Active | null {
  let e2 = e.next_in_ael;
  while (e2) {
    if (e2.vertex_top === e.vertex_top) return e2;
    e2 = e2.next_in_ael;
  }
  return null;
}

function duplicateOp(op: OutPt, insertAfter: boolean): OutPt {
  const result = newOutPt(op.pt, op.outrec);
  if (insertAfter) {
    result.next = op.next;
    result.next.prev = result;
    result.prev = op;
    op.next = result;
  } else {
    result.prev = op.prev;
    result.prev.next = result;
    result.next = op;
    op.prev = result;
  }
  return result;
}

function disposeOutPt(op: OutPt): OutPt {
  const result = op.next;
  op.prev.next = op.next;
  op.next.prev = op.prev;
  return result;
}

function disposeOutPts(outrec: OutRec): void {
  outrec.pts = null;
}

const intersectListSort = (a: IntersectNode, b: IntersectNode): boolean =>
  a.pt.y === b.pt.y ? a.pt.x < b.pt.x : a.pt.y > b.pt.y;

function setSides(outrec: OutRec, startEdge: Active, endEdge: Active): void {
  outrec.front_edge = startEdge;
  outrec.back_edge = endEdge;
}

function swapOutrecs(e1: Active, e2: Active): void {
  const or1 = e1.outrec;
  const or2 = e2.outrec;
  if (or1 === or2) {
    const e = or1!.front_edge;
    or1!.front_edge = or1!.back_edge;
    or1!.back_edge = e;
    return;
  }
  if (or1) {
    if (e1 === or1.front_edge) or1.front_edge = e2;
    else or1.back_edge = e2;
  }
  if (or2) {
    if (e2 === or2.front_edge) or2.front_edge = e1;
    else or2.back_edge = e1;
  }
  e1.outrec = or2;
  e2.outrec = or1;
}

function areaOp(op: OutPt): number {
  let result = 0;
  let op2 = op;
  do {
    result += (op2.prev.pt.y + op2.pt.y) * (op2.prev.pt.x - op2.pt.x);
    op2 = op2.next;
  } while (op2 !== op);
  return result * 0.5;
}

function areaTriangle(pt1: Point64, pt2: Point64, pt3: Point64): number {
  return (
    (pt3.y + pt1.y) * (pt3.x - pt1.x) +
    (pt1.y + pt2.y) * (pt1.x - pt2.x) +
    (pt2.y + pt3.y) * (pt2.x - pt3.x)
  );
}

function swapFrontBackSides(outrec: OutRec): void {
  const tmp = outrec.front_edge;
  outrec.front_edge = outrec.back_edge;
  outrec.back_edge = tmp;
  outrec.pts = outrec.pts!.next;
}

function getRealOutRec(outrec: OutRec | null): OutRec | null {
  while (outrec && !outrec.pts) outrec = outrec.owner;
  return outrec;
}

function isValidOwner(outrec: OutRec, testOwner: OutRec | null): boolean {
  while (testOwner && testOwner !== outrec) testOwner = testOwner.owner;
  return !testOwner;
}

function uncoupleOutRec(ae: Active): void {
  const outrec = ae.outrec;
  if (!outrec) return;
  outrec.front_edge!.outrec = null;
  outrec.back_edge!.outrec = null;
  outrec.front_edge = null;
  outrec.back_edge = null;
}

const ptsReallyClose = (pt1: Point64, pt2: Point64): boolean =>
  Math.abs(pt1.x - pt2.x) < 2 && Math.abs(pt1.y - pt2.y) < 2;

const isVerySmallTriangle = (op: OutPt): boolean =>
  op.next.next === op.prev &&
  (ptsReallyClose(op.prev.pt, op.next.pt) ||
    ptsReallyClose(op.pt, op.next.pt) ||
    ptsReallyClose(op.pt, op.prev.pt));

const isValidClosedPath = (op: OutPt | null): boolean =>
  !!op && op.next !== op && op.next !== op.prev && !isVerySmallTriangle(op);

const outrecIsAscending = (hotEdge: Active): boolean => hotEdge === hotEdge.outrec!.front_edge;

const edgesAdjacentInAEL = (inode: IntersectNode): boolean =>
  inode.edge1.next_in_ael === inode.edge2 || inode.edge1.prev_in_ael === inode.edge2;

const isJoined = (e: Active): boolean => e.join_with !== JoinWith.None;

function setOwner(outrec: OutRec, newOwner: OutRec): void {
  while (newOwner.owner && !newOwner.owner.pts) newOwner.owner = newOwner.owner.owner;
  let tmp: OutRec | null = newOwner;
  while (tmp && tmp !== outrec) tmp = tmp.owner;
  if (tmp) newOwner.owner = outrec.owner;
  outrec.owner = newOwner;
}

function pointInOpPolygon(pt: Point64, op: OutPt): PointInPolygonResult {
  if (op === op.next || op.prev === op.next) return PointInPolygonResult.IsOutside;
  let op2 = op;
  do {
    if (op.pt.y !== pt.y) break;
    op = op.next;
  } while (op !== op2);
  if (op.pt.y === pt.y) return PointInPolygonResult.IsOutside;

  let isAbove = op.pt.y < pt.y;
  const startingAbove = isAbove;
  let val = 0;
  op2 = op.next;
  while (op2 !== op) {
    if (isAbove) while (op2 !== op && op2.pt.y < pt.y) op2 = op2.next;
    else while (op2 !== op && op2.pt.y > pt.y) op2 = op2.next;
    if (op2 === op) break;

    if (op2.pt.y === pt.y) {
      if (
        op2.pt.x === pt.x ||
        (op2.pt.y === op2.prev.pt.y && pt.x < op2.prev.pt.x !== pt.x < op2.pt.x)
      )
        return PointInPolygonResult.IsOn;
      op2 = op2.next;
      if (op2 === op) break;
      continue;
    }

    if (pt.x < op2.pt.x && pt.x < op2.prev.pt.x) {
      // only interested in edges crossing on the left
    } else if (pt.x > op2.prev.pt.x && pt.x > op2.pt.x) val = 1 - val;
    else {
      const d = crossProduct3(op2.prev.pt, op2.pt, pt);
      if (d === 0) return PointInPolygonResult.IsOn;
      if (d < 0 === isAbove) val = 1 - val;
    }
    isAbove = !isAbove;
    op2 = op2.next;
  }

  if (isAbove !== startingAbove) {
    const d = crossProduct3(op2.prev.pt, op2.pt, pt);
    if (d === 0) return PointInPolygonResult.IsOn;
    if (d < 0 === isAbove) val = 1 - val;
  }
  return val === 0 ? PointInPolygonResult.IsOutside : PointInPolygonResult.IsInside;
}

function getCleanPath(op: OutPt): Path64 {
  const result: Path64 = [];
  let op2 = op;
  while (
    op2.next !== op &&
    ((op2.pt.x === op2.next.pt.x && op2.pt.x === op2.prev.pt.x) ||
      (op2.pt.y === op2.next.pt.y && op2.pt.y === op2.prev.pt.y))
  )
    op2 = op2.next;
  result.push(op2.pt);
  let prevOp = op2;
  op2 = op2.next;
  while (op2 !== op) {
    if (
      (op2.pt.x !== op2.next.pt.x || op2.pt.x !== prevOp.pt.x) &&
      (op2.pt.y !== op2.next.pt.y || op2.pt.y !== prevOp.pt.y)
    ) {
      result.push(op2.pt);
      prevOp = op2;
    }
    op2 = op2.next;
  }
  return result;
}

function path1InsidePath2(op1: OutPt, op2: OutPt): boolean {
  let outsideCnt = 0;
  let op = op1;
  do {
    const result = pointInOpPolygon(op.pt, op2);
    if (result === PointInPolygonResult.IsOutside) ++outsideCnt;
    else if (result === PointInPolygonResult.IsInside) --outsideCnt;
    op = op.next;
  } while (op !== op1 && Math.abs(outsideCnt) < 2);
  if (Math.abs(outsideCnt) > 1) return outsideCnt < 0;
  const mp = rectMidPoint(getBounds(getCleanPath(op1)));
  const path2 = getCleanPath(op2);
  return pointInPolygon(mp, path2) !== PointInPolygonResult.IsOutside;
}

// ---------------------------------------------------------------------------

function addLocMin(
  list: LocalMinima[],
  vert: Vertex,
  polytype: PathType,
  isOpenPath: boolean,
): void {
  if ((VertexFlags.LocalMin & vert.flags) !== VertexFlags.None) return;
  vert.flags = vert.flags | VertexFlags.LocalMin;
  list.push({ vertex: vert, polytype, is_open: isOpenPath });
}

function addPaths_(
  paths: Paths64,
  polytype: PathType,
  isOpenPath: boolean,
  vertexLists: Vertex[][],
  locMinList: LocalMinima[],
): void {
  let totalVertexCount = 0;
  for (const p of paths) totalVertexCount += p.length;
  if (totalVertexCount === 0) return;

  const vertices: Vertex[] = [];
  for (const path of paths) {
    // for each path create a circular double linked list of vertices
    if (path.length === 0) continue;
    let v0: Vertex | null = null;
    let prev_v: Vertex | null = null;
    let cnt = 0;
    for (const pt of path) {
      if (prev_v) {
        if (ptEq(prev_v.pt, pt)) continue; // ie skips duplicates
      }
      const curr_v: Vertex = {
        pt: { x: pt.x, y: pt.y },
        next: null,
        prev: prev_v,
        flags: VertexFlags.None,
      };
      if (prev_v) prev_v.next = curr_v;
      if (!v0) v0 = curr_v;
      vertices.push(curr_v);
      prev_v = curr_v;
      cnt++;
    }
    if (!prev_v || !prev_v.prev) continue;
    if (!isOpenPath && ptEq(prev_v.pt, v0!.pt)) prev_v = prev_v.prev;
    prev_v.next = v0;
    v0!.prev = prev_v;
    if (cnt < 2 || (cnt === 2 && !isOpenPath)) continue;

    // now find and assign local minima
    let goingUp: boolean;
    let goingUp0: boolean;
    let curr_v: Vertex;
    if (isOpenPath) {
      curr_v = v0!.next!;
      while (curr_v !== v0 && curr_v.pt.y === v0!.pt.y) curr_v = curr_v.next!;
      goingUp = curr_v.pt.y <= v0!.pt.y;
      if (goingUp) {
        v0!.flags = VertexFlags.OpenStart;
        addLocMin(locMinList, v0!, polytype, true);
      } else v0!.flags = VertexFlags.OpenStart | VertexFlags.LocalMax;
    } else {
      prev_v = v0!.prev!;
      while (prev_v !== v0 && prev_v.pt.y === v0!.pt.y) prev_v = prev_v.prev!;
      if (prev_v === v0) continue; // only open paths can be completely flat
      goingUp = prev_v.pt.y > v0!.pt.y;
    }

    goingUp0 = goingUp;
    prev_v = v0!;
    curr_v = v0!.next!;
    while (curr_v !== v0) {
      if (curr_v.pt.y > prev_v.pt.y && goingUp) {
        prev_v.flags = prev_v.flags | VertexFlags.LocalMax;
        goingUp = false;
      } else if (curr_v.pt.y < prev_v.pt.y && !goingUp) {
        goingUp = true;
        addLocMin(locMinList, prev_v, polytype, isOpenPath);
      }
      prev_v = curr_v;
      curr_v = curr_v.next!;
    }

    if (isOpenPath) {
      prev_v.flags = prev_v.flags | VertexFlags.OpenEnd;
      if (goingUp) prev_v.flags = prev_v.flags | VertexFlags.LocalMax;
      else addLocMin(locMinList, prev_v, polytype, isOpenPath);
    } else if (goingUp !== goingUp0) {
      if (goingUp0) addLocMin(locMinList, prev_v, polytype, false);
      else prev_v.flags = prev_v.flags | VertexFlags.LocalMax;
    }
  }
  vertexLists.push(vertices);
}

// ---------------------------------------------------------------------------
// PolyPath / PolyTree

export class PolyPath64 {
  readonly childs: PolyPath64[] = [];
  polygon: Path64 = [];
  constructor(readonly parent: PolyPath64 | null = null) {}

  level(): number {
    let result = 0;
    let p = this.parent;
    while (p) {
      ++result;
      p = p.parent;
    }
    return result;
  }
  /** Even levels except level 0. */
  isHole(): boolean {
    const lvl = this.level();
    return lvl !== 0 && !(lvl & 1);
  }
  addChild(path: Path64): PolyPath64 {
    const p = new PolyPath64(this);
    this.childs.push(p);
    p.polygon = path;
    return p;
  }
  clear(): void {
    this.childs.length = 0;
  }
  count(): number {
    return this.childs.length;
  }
}
export type PolyTree64 = PolyPath64;

// ---------------------------------------------------------------------------
// ClipperBase

export class ClipperBase {
  private cliptype_: ClipType = ClipType.None;
  private fillrule_: FillRule = FillRule.EvenOdd;
  private readonly fillpos: FillRule = FillRule.Positive;
  private bot_y_ = 0;
  private minima_list_sorted_ = false;
  private using_polytree_ = false;
  private actives_: Active | null = null;
  private sel_: Active | null = null;
  private minima_list_: LocalMinima[] = [];
  private current_locmin_idx_ = 0;
  private vertex_lists_: Vertex[][] = [];
  /** `std::priority_queue<int64_t>`: kept sorted ascending, so the max is last. */
  private scanline_list_: number[] = [];
  private intersect_nodes_: IntersectNode[] = [];
  private horz_seg_list_: HorzSegment[] = [];
  private horz_join_list_: HorzJoin[] = [];

  protected preserve_collinear_ = true;
  protected reverse_solution_ = false;
  protected error_code_ = 0;
  protected has_open_paths_ = false;
  protected succeeded_ = true;
  protected outrec_list_: OutRec[] = [];

  preserveCollinear(val: boolean): void {
    this.preserve_collinear_ = val;
  }
  reverseSolution(val: boolean): void {
    this.reverse_solution_ = val;
  }
  errorCode(): number {
    return this.error_code_;
  }

  private cleanUp(): void {
    this.actives_ = null;
    this.scanline_list_ = [];
    this.intersect_nodes_ = [];
    this.outrec_list_ = [];
    this.horz_seg_list_ = [];
    this.horz_join_list_ = [];
  }

  clear(): void {
    this.cleanUp();
    this.minima_list_ = [];
    this.vertex_lists_ = [];
    this.current_locmin_idx_ = 0;
    this.minima_list_sorted_ = false;
    this.has_open_paths_ = false;
  }

  private reset(): void {
    if (!this.minima_list_sorted_) {
      // LocMinSorter: `std::stable_sort` (#594)
      stableSort(this.minima_list_, (locMin1, locMin2) =>
        locMin2.vertex.pt.y !== locMin1.vertex.pt.y
          ? locMin2.vertex.pt.y < locMin1.vertex.pt.y
          : locMin2.vertex.pt.x > locMin1.vertex.pt.x,
      );
      this.minima_list_sorted_ = true;
    }
    for (let i = this.minima_list_.length - 1; i >= 0; i--)
      this.insertScanline(this.minima_list_[i]!.vertex.pt.y);
    this.current_locmin_idx_ = 0;
    this.actives_ = null;
    this.sel_ = null;
    this.succeeded_ = true;
  }

  protected addPaths(paths: Paths64, polytype: PathType, isOpenPath: boolean): void {
    if (isOpenPath) this.has_open_paths_ = true;
    this.minima_list_sorted_ = false;
    addPaths_(paths, polytype, isOpenPath, this.vertex_lists_, this.minima_list_);
  }

  private insertScanline(y: number): void {
    // binary insert, ascending
    let lo = 0;
    let hi = this.scanline_list_.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.scanline_list_[mid]! < y) lo = mid + 1;
      else hi = mid;
    }
    this.scanline_list_.splice(lo, 0, y);
  }

  private popScanline(): number | null {
    if (this.scanline_list_.length === 0) return null;
    const y = this.scanline_list_.pop()!;
    while (
      this.scanline_list_.length > 0 &&
      y === this.scanline_list_[this.scanline_list_.length - 1]
    )
      this.scanline_list_.pop(); // Pop duplicates.
    return y;
  }

  private popLocalMinima(y: number): LocalMinima | null {
    if (
      this.current_locmin_idx_ === this.minima_list_.length ||
      this.minima_list_[this.current_locmin_idx_]!.vertex.pt.y !== y
    )
      return null;
    return this.minima_list_[this.current_locmin_idx_++]!;
  }

  private isContributingClosed(e: Active): boolean {
    switch (this.fillrule_) {
      case FillRule.EvenOdd:
        break;
      case FillRule.NonZero:
        if (Math.abs(e.wind_cnt) !== 1) return false;
        break;
      case FillRule.Positive:
        if (e.wind_cnt !== 1) return false;
        break;
      case FillRule.Negative:
        if (e.wind_cnt !== -1) return false;
        break;
    }

    switch (this.cliptype_) {
      case ClipType.None:
        return false;
      case ClipType.Intersection:
        switch (this.fillrule_) {
          case FillRule.Positive:
            return e.wind_cnt2 > 0;
          case FillRule.Negative:
            return e.wind_cnt2 < 0;
          default:
            return e.wind_cnt2 !== 0;
        }
      case ClipType.Union:
        switch (this.fillrule_) {
          case FillRule.Positive:
            return e.wind_cnt2 <= 0;
          case FillRule.Negative:
            return e.wind_cnt2 >= 0;
          default:
            return e.wind_cnt2 === 0;
        }
      case ClipType.Difference: {
        let result: boolean;
        switch (this.fillrule_) {
          case FillRule.Positive:
            result = e.wind_cnt2 <= 0;
            break;
          case FillRule.Negative:
            result = e.wind_cnt2 >= 0;
            break;
          default:
            result = e.wind_cnt2 === 0;
        }
        if (getPolyType(e) === PathType.Subject) return result;
        return !result;
      }
      case ClipType.Xor:
        return true;
    }
    return false;
  }

  private isContributingOpen(e: Active): boolean {
    let isInClip: boolean;
    let isInSubj: boolean;
    switch (this.fillrule_) {
      case FillRule.Positive:
        isInClip = e.wind_cnt2 > 0;
        isInSubj = e.wind_cnt > 0;
        break;
      case FillRule.Negative:
        isInClip = e.wind_cnt2 < 0;
        isInSubj = e.wind_cnt < 0;
        break;
      default:
        isInClip = e.wind_cnt2 !== 0;
        isInSubj = e.wind_cnt !== 0;
    }
    switch (this.cliptype_) {
      case ClipType.Intersection:
        return isInClip;
      case ClipType.Union:
        return !isInSubj && !isInClip;
      default:
        return !isInClip;
    }
  }

  private setWindCountForClosedPathEdge(e: Active): void {
    let e2 = e.prev_in_ael;
    const pt = getPolyType(e);
    while (e2 && (getPolyType(e2) !== pt || isOpen(e2))) e2 = e2.prev_in_ael;

    if (!e2) {
      e.wind_cnt = e.wind_dx;
      e2 = this.actives_;
    } else if (this.fillrule_ === FillRule.EvenOdd) {
      e.wind_cnt = e.wind_dx;
      e.wind_cnt2 = e2.wind_cnt2;
      e2 = e2.next_in_ael;
    } else {
      if (e2.wind_cnt * e2.wind_dx < 0) {
        if (Math.abs(e2.wind_cnt) > 1) {
          if (e2.wind_dx * e.wind_dx < 0) e.wind_cnt = e2.wind_cnt;
          else e.wind_cnt = e2.wind_cnt + e.wind_dx;
        } else e.wind_cnt = isOpen(e) ? 1 : e.wind_dx;
      } else {
        if (e2.wind_dx * e.wind_dx < 0) e.wind_cnt = e2.wind_cnt;
        else e.wind_cnt = e2.wind_cnt + e.wind_dx;
      }
      e.wind_cnt2 = e2.wind_cnt2;
      e2 = e2.next_in_ael;
    }

    if (this.fillrule_ === FillRule.EvenOdd)
      while (e2 !== e) {
        if (getPolyType(e2!) !== pt && !isOpen(e2!)) e.wind_cnt2 = e.wind_cnt2 === 0 ? 1 : 0;
        e2 = e2!.next_in_ael;
      }
    else
      while (e2 !== e) {
        if (getPolyType(e2!) !== pt && !isOpen(e2!)) e.wind_cnt2 += e2!.wind_dx;
        e2 = e2!.next_in_ael;
      }
  }

  private setWindCountForOpenPathEdge(e: Active): void {
    let e2 = this.actives_;
    if (this.fillrule_ === FillRule.EvenOdd) {
      let cnt1 = 0;
      let cnt2 = 0;
      while (e2 !== e) {
        if (getPolyType(e2!) === PathType.Clip) cnt2++;
        else if (!isOpen(e2!)) cnt1++;
        e2 = e2!.next_in_ael;
      }
      e.wind_cnt = isOdd(cnt1) ? 1 : 0;
      e.wind_cnt2 = isOdd(cnt2) ? 1 : 0;
    } else {
      while (e2 !== e) {
        if (getPolyType(e2!) === PathType.Clip) e.wind_cnt2 += e2!.wind_dx;
        else if (!isOpen(e2!)) e.wind_cnt += e2!.wind_dx;
        e2 = e2!.next_in_ael;
      }
    }
  }

  private insertLeftEdge(e: Active): void {
    if (!this.actives_) {
      e.prev_in_ael = null;
      e.next_in_ael = null;
      this.actives_ = e;
    } else if (!isValidAelOrder(this.actives_, e)) {
      e.prev_in_ael = null;
      e.next_in_ael = this.actives_;
      this.actives_.prev_in_ael = e;
      this.actives_ = e;
    } else {
      let e2: Active | null = this.actives_;
      while (e2.next_in_ael && isValidAelOrder(e2.next_in_ael, e)) e2 = e2.next_in_ael;
      if (e2.join_with === JoinWith.Right) e2 = e2.next_in_ael;
      if (!e2) return;
      e.next_in_ael = e2.next_in_ael;
      if (e2.next_in_ael) e2.next_in_ael.prev_in_ael = e;
      e.prev_in_ael = e2;
      e2.next_in_ael = e;
    }
  }

  private insertLocalMinimaIntoAEL(botY: number): void {
    for (;;) {
      const localMinima = this.popLocalMinima(botY);
      if (!localMinima) break;
      let leftBound: Active | null;
      let rightBound: Active | null;
      if ((localMinima.vertex.flags & VertexFlags.OpenStart) !== VertexFlags.None) {
        leftBound = null;
      } else {
        leftBound = newActive(localMinima);
        leftBound.bot = { ...localMinima.vertex.pt };
        leftBound.curr_x = leftBound.bot.x;
        leftBound.wind_dx = -1;
        leftBound.vertex_top = localMinima.vertex.prev; // ie descending
        leftBound.top = { ...leftBound.vertex_top!.pt };
        setDx(leftBound);
      }

      if ((localMinima.vertex.flags & VertexFlags.OpenEnd) !== VertexFlags.None) {
        rightBound = null;
      } else {
        rightBound = newActive(localMinima);
        rightBound.bot = { ...localMinima.vertex.pt };
        rightBound.curr_x = rightBound.bot.x;
        rightBound.wind_dx = 1;
        rightBound.vertex_top = localMinima.vertex.next; // ie ascending
        rightBound.top = { ...rightBound.vertex_top!.pt };
        setDx(rightBound);
      }

      if (leftBound && rightBound) {
        if (isHorizontal(leftBound)) {
          if (isHeadingRightHorz(leftBound)) [leftBound, rightBound] = [rightBound, leftBound];
        } else if (isHorizontal(rightBound)) {
          if (isHeadingLeftHorz(rightBound)) [leftBound, rightBound] = [rightBound, leftBound];
        } else if (leftBound.dx < rightBound.dx) [leftBound, rightBound] = [rightBound, leftBound];
      } else if (!leftBound) {
        leftBound = rightBound;
        rightBound = null;
      }

      let contributing: boolean;
      leftBound!.is_left_bound = true;
      this.insertLeftEdge(leftBound!);

      if (isOpen(leftBound!)) {
        this.setWindCountForOpenPathEdge(leftBound!);
        contributing = this.isContributingOpen(leftBound!);
      } else {
        this.setWindCountForClosedPathEdge(leftBound!);
        contributing = this.isContributingClosed(leftBound!);
      }

      if (rightBound) {
        rightBound.is_left_bound = false;
        rightBound.wind_cnt = leftBound!.wind_cnt;
        rightBound.wind_cnt2 = leftBound!.wind_cnt2;
        insertRightEdge(leftBound!, rightBound);
        if (contributing) {
          this.addLocalMinPoly(leftBound!, rightBound, leftBound!.bot, true);
          if (!isHorizontal(leftBound!)) this.checkJoinLeft(leftBound!, leftBound!.bot);
        }

        while (rightBound.next_in_ael && isValidAelOrder(rightBound.next_in_ael, rightBound)) {
          this.intersectEdges(rightBound, rightBound.next_in_ael, rightBound.bot);
          this.swapPositionsInAEL(rightBound, rightBound.next_in_ael);
        }

        if (isHorizontal(rightBound)) this.pushHorz(rightBound);
        else {
          this.checkJoinRight(rightBound, rightBound.bot);
          this.insertScanline(rightBound.top.y);
        }
      } else if (contributing) {
        this.startOpenPath(leftBound!, leftBound!.bot);
      }

      if (isHorizontal(leftBound!)) this.pushHorz(leftBound!);
      else this.insertScanline(leftBound!.top.y);
    }
  }

  private pushHorz(e: Active): void {
    e.next_in_sel = this.sel_ ? this.sel_ : null;
    this.sel_ = e;
  }

  private popHorz(): Active | null {
    const e = this.sel_;
    if (!e) return null;
    this.sel_ = this.sel_!.next_in_sel;
    return e;
  }

  private addLocalMinPoly(e1: Active, e2: Active, pt: Point64, isNew = false): OutPt {
    const outrec = this.newOutRec();
    e1.outrec = outrec;
    e2.outrec = outrec;

    if (isOpen(e1)) {
      outrec.owner = null;
      outrec.is_open = true;
      if (e1.wind_dx > 0) setSides(outrec, e1, e2);
      else setSides(outrec, e2, e1);
    } else {
      const prevHotEdge = getPrevHotEdge(e1);
      if (prevHotEdge) {
        if (this.using_polytree_) setOwner(outrec, prevHotEdge.outrec!);
        if (outrecIsAscending(prevHotEdge) === isNew) setSides(outrec, e2, e1);
        else setSides(outrec, e1, e2);
      } else {
        outrec.owner = null;
        if (isNew) setSides(outrec, e1, e2);
        else setSides(outrec, e2, e1);
      }
    }

    const op = newOutPt(pt, outrec);
    outrec.pts = op;
    return op;
  }

  private addLocalMaxPoly(e1: Active, e2: Active, pt: Point64): OutPt | null {
    if (isJoined(e1)) this.split(e1, pt);
    if (isJoined(e2)) this.split(e2, pt);

    if (isFront(e1) === isFront(e2)) {
      if (isOpenEnd(e1)) swapFrontBackSides(e1.outrec!);
      else if (isOpenEnd(e2)) swapFrontBackSides(e2.outrec!);
      else {
        this.succeeded_ = false;
        return null;
      }
    }

    let result = this.addOutPt(e1, pt);
    if (e1.outrec === e2.outrec) {
      const outrec = e1.outrec!;
      outrec.pts = result;

      if (this.using_polytree_) {
        const e = getPrevHotEdge(e1);
        if (!e) outrec.owner = null;
        else setOwner(outrec, e.outrec!);
      }
      uncoupleOutRec(e1);
      result = outrec.pts;
      if (outrec.owner && !outrec.owner.front_edge) outrec.owner = getRealOutRec(outrec.owner);
    } else if (isOpen(e1)) {
      if (e1.wind_dx < 0) this.joinOutrecPaths(e1, e2);
      else this.joinOutrecPaths(e2, e1);
    } else if (e1.outrec!.idx < e2.outrec!.idx) this.joinOutrecPaths(e1, e2);
    else this.joinOutrecPaths(e2, e1);
    return result;
  }

  private joinOutrecPaths(e1: Active, e2: Active): void {
    const p1_st = e1.outrec!.pts!;
    const p2_st = e2.outrec!.pts!;
    const p1_end = p1_st.next;
    const p2_end = p2_st.next;
    if (isFront(e1)) {
      p2_end.prev = p1_st;
      p1_st.next = p2_end;
      p2_st.next = p1_end;
      p1_end.prev = p2_st;
      e1.outrec!.pts = p2_st;
      e1.outrec!.front_edge = e2.outrec!.front_edge;
      if (e1.outrec!.front_edge) e1.outrec!.front_edge.outrec = e1.outrec;
    } else {
      p1_end.prev = p2_st;
      p2_st.next = p1_end;
      p1_st.next = p2_end;
      p2_end.prev = p1_st;
      e1.outrec!.back_edge = e2.outrec!.back_edge;
      if (e1.outrec!.back_edge) e1.outrec!.back_edge.outrec = e1.outrec;
    }

    e2.outrec!.front_edge = null;
    e2.outrec!.back_edge = null;
    e2.outrec!.pts = null;

    if (isOpenEnd(e1)) {
      e2.outrec!.pts = e1.outrec!.pts;
      e1.outrec!.pts = null;
    } else setOwner(e2.outrec!, e1.outrec!);

    e1.outrec = null;
    e2.outrec = null;
  }

  private newOutRec(): OutRec {
    const result: OutRec = {
      idx: this.outrec_list_.length,
      owner: null,
      front_edge: null,
      back_edge: null,
      pts: null,
      polypath: null,
      splits: null,
      recursive_split: null,
      bounds: { left: 0, top: 0, right: 0, bottom: 0 },
      path: [],
      is_open: false,
    };
    this.outrec_list_.push(result);
    return result;
  }

  private addOutPt(e: Active, pt: Point64): OutPt {
    const outrec = e.outrec!;
    const toFront = isFront(e);
    const opFront = outrec.pts!;
    const opBack = opFront.next;
    if (toFront) {
      if (ptEq(pt, opFront.pt)) return opFront;
    } else if (ptEq(pt, opBack.pt)) return opBack;

    const newOp = newOutPt(pt, outrec);
    opBack.prev = newOp;
    newOp.prev = opFront;
    newOp.next = opBack;
    opFront.next = newOp;
    if (toFront) outrec.pts = newOp;
    return newOp;
  }

  protected cleanCollinear(outrec: OutRec | null): void {
    outrec = getRealOutRec(outrec);
    if (!outrec || outrec.is_open) return;
    if (!isValidClosedPath(outrec.pts)) {
      disposeOutPts(outrec);
      return;
    }

    let startOp = outrec.pts!;
    let op2 = startOp;
    for (;;) {
      if (
        crossProduct3(op2.prev.pt, op2.pt, op2.next.pt) === 0 &&
        (ptEq(op2.pt, op2.prev.pt) ||
          ptEq(op2.pt, op2.next.pt) ||
          !this.preserve_collinear_ ||
          dotProduct3(op2.prev.pt, op2.pt, op2.next.pt) < 0)
      ) {
        if (op2 === outrec.pts) outrec.pts = op2.prev;
        op2 = disposeOutPt(op2);
        if (!isValidClosedPath(op2)) {
          disposeOutPts(outrec);
          return;
        }
        startOp = op2;
        continue;
      }
      op2 = op2.next;
      if (op2 === startOp) break;
    }
    this.fixSelfIntersects(outrec);
  }

  private doSplitOp(outrec: OutRec, splitOp: OutPt): void {
    const prevOp = splitOp.prev;
    const nextNextOp = splitOp.next.next;
    outrec.pts = prevOp;
    const ip: Point64 = { x: 0, y: 0 };
    getIntersectPoint(prevOp.pt, splitOp.pt, splitOp.next.pt, nextNextOp.pt, ip);

    const area1 = areaOp(outrec.pts);
    const absArea1 = Math.abs(area1);
    if (absArea1 < 2) {
      disposeOutPts(outrec);
      return;
    }

    const area2 = areaTriangle(ip, splitOp.pt, splitOp.next.pt);
    const absArea2 = Math.abs(area2);

    if (ptEq(ip, prevOp.pt) || ptEq(ip, nextNextOp.pt)) {
      nextNextOp.prev = prevOp;
      prevOp.next = nextNextOp;
    } else {
      const newOp2 = newOutPt(ip, prevOp.outrec);
      newOp2.prev = prevOp;
      newOp2.next = nextNextOp;
      nextNextOp.prev = newOp2;
      prevOp.next = newOp2;
    }

    if (absArea2 >= 1 && (absArea2 > absArea1 || area2 > 0 === area1 > 0)) {
      const newOr = this.newOutRec();
      newOr.owner = outrec.owner;
      splitOp.outrec = newOr;
      splitOp.next.outrec = newOr;
      const newOp = newOutPt(ip, newOr);
      newOp.prev = splitOp.next;
      newOp.next = splitOp;
      newOr.pts = newOp;
      splitOp.prev = newOp;
      splitOp.next.next = newOp;

      if (this.using_polytree_) {
        if (path1InsidePath2(prevOp, newOp)) {
          newOr.splits = [outrec];
        } else {
          if (!outrec.splits) outrec.splits = [];
          outrec.splits.push(newOr);
        }
      }
    }
  }

  private fixSelfIntersects(outrec: OutRec): void {
    let op2 = outrec.pts!;
    for (;;) {
      if (op2.prev === op2.next.next) break;
      if (segmentsIntersect(op2.prev.pt, op2.pt, op2.next.pt, op2.next.next.pt)) {
        if (op2 === outrec.pts || op2.next === outrec.pts) outrec.pts = outrec.pts!.prev;
        this.doSplitOp(outrec, op2);
        if (!outrec.pts) break;
        op2 = outrec.pts;
        continue;
      }
      op2 = op2.next;
      if (op2 === outrec.pts) break;
    }
  }

  private startOpenPath(e: Active, pt: Point64): OutPt {
    const outrec = this.newOutRec();
    outrec.is_open = true;
    if (e.wind_dx > 0) {
      outrec.front_edge = e;
      outrec.back_edge = null;
    } else {
      outrec.front_edge = null;
      outrec.back_edge = e;
    }
    e.outrec = outrec;
    const op = newOutPt(pt, outrec);
    outrec.pts = op;
    return op;
  }

  private updateEdgeIntoAEL(e: Active): void {
    e.bot = { ...e.top };
    e.vertex_top = nextVertex(e);
    e.top = { ...e.vertex_top.pt };
    e.curr_x = e.bot.x;
    setDx(e);

    if (isJoined(e)) this.split(e, e.bot);

    if (isHorizontal(e)) {
      if (!isOpen(e)) trimHorz(e, this.preserve_collinear_);
      return;
    }
    this.insertScanline(e.top.y);

    this.checkJoinLeft(e, e.bot);
    this.checkJoinRight(e, e.bot, true); // (#500)
  }

  private intersectEdges(e1: Active, e2: Active, pt: Point64): OutPt | null {
    if (this.has_open_paths_ && (isOpen(e1) || isOpen(e2))) {
      if (isOpen(e1) && isOpen(e2)) return null;
      let edge_o: Active;
      let edge_c: Active;
      if (isOpen(e1)) {
        edge_o = e1;
        edge_c = e2;
      } else {
        edge_o = e2;
        edge_c = e1;
      }
      if (isJoined(edge_c)) this.split(edge_c, pt);

      if (Math.abs(edge_c.wind_cnt) !== 1) return null;
      switch (this.cliptype_) {
        case ClipType.Union:
          if (!isHotEdge(edge_c)) return null;
          break;
        default:
          if (edge_c.local_min.polytype === PathType.Subject) return null;
      }

      switch (this.fillrule_) {
        case FillRule.Positive:
          if (edge_c.wind_cnt !== 1) return null;
          break;
        case FillRule.Negative:
          if (edge_c.wind_cnt !== -1) return null;
          break;
        default:
          if (Math.abs(edge_c.wind_cnt) !== 1) return null;
          break;
      }

      let resultOp: OutPt;
      if (isHotEdge(edge_o)) {
        resultOp = this.addOutPt(edge_o, pt);
        if (isFront(edge_o)) edge_o.outrec!.front_edge = null;
        else edge_o.outrec!.back_edge = null;
        edge_o.outrec = null;
      } else if (ptEq(pt, edge_o.local_min.vertex.pt) && !isOpenEndV(edge_o.local_min.vertex)) {
        const e3 = findEdgeWithMatchingLocMin(edge_o);
        if (e3 && isHotEdge(e3)) {
          edge_o.outrec = e3.outrec;
          if (edge_o.wind_dx > 0) setSides(e3.outrec!, edge_o, e3);
          else setSides(e3.outrec!, e3, edge_o);
          return e3.outrec!.pts;
        }
        resultOp = this.startOpenPath(edge_o, pt);
      } else resultOp = this.startOpenPath(edge_o, pt);
      return resultOp;
    }

    // MANAGING CLOSED PATHS FROM HERE ON
    if (isJoined(e1)) this.split(e1, pt);
    if (isJoined(e2)) this.split(e2, pt);

    // UPDATE WINDING COUNTS...
    let old_e1_windcnt: number;
    let old_e2_windcnt: number;
    if (e1.local_min.polytype === e2.local_min.polytype) {
      if (this.fillrule_ === FillRule.EvenOdd) {
        old_e1_windcnt = e1.wind_cnt;
        e1.wind_cnt = e2.wind_cnt;
        e2.wind_cnt = old_e1_windcnt;
      } else {
        if (e1.wind_cnt + e2.wind_dx === 0) e1.wind_cnt = -e1.wind_cnt;
        else e1.wind_cnt += e2.wind_dx;
        if (e2.wind_cnt - e1.wind_dx === 0) e2.wind_cnt = -e2.wind_cnt;
        else e2.wind_cnt -= e1.wind_dx;
      }
    } else {
      if (this.fillrule_ !== FillRule.EvenOdd) {
        e1.wind_cnt2 += e2.wind_dx;
        e2.wind_cnt2 -= e1.wind_dx;
      } else {
        e1.wind_cnt2 = e1.wind_cnt2 === 0 ? 1 : 0;
        e2.wind_cnt2 = e2.wind_cnt2 === 0 ? 1 : 0;
      }
    }

    switch (this.fillrule_) {
      case FillRule.EvenOdd:
      case FillRule.NonZero:
        old_e1_windcnt = Math.abs(e1.wind_cnt);
        old_e2_windcnt = Math.abs(e2.wind_cnt);
        break;
      default:
        if (this.fillrule_ === this.fillpos) {
          old_e1_windcnt = e1.wind_cnt;
          old_e2_windcnt = e2.wind_cnt;
        } else {
          old_e1_windcnt = -e1.wind_cnt;
          old_e2_windcnt = -e2.wind_cnt;
        }
        break;
    }

    const e1_windcnt_in_01 = old_e1_windcnt === 0 || old_e1_windcnt === 1;
    const e2_windcnt_in_01 = old_e2_windcnt === 0 || old_e2_windcnt === 1;

    if ((!isHotEdge(e1) && !e1_windcnt_in_01) || (!isHotEdge(e2) && !e2_windcnt_in_01)) return null;

    // NOW PROCESS THE INTERSECTION ...
    let resultOp: OutPt | null = null;
    if (isHotEdge(e1) && isHotEdge(e2)) {
      if (
        (old_e1_windcnt !== 0 && old_e1_windcnt !== 1) ||
        (old_e2_windcnt !== 0 && old_e2_windcnt !== 1) ||
        (e1.local_min.polytype !== e2.local_min.polytype && this.cliptype_ !== ClipType.Xor)
      ) {
        resultOp = this.addLocalMaxPoly(e1, e2, pt);
      } else if (isFront(e1) || e1.outrec === e2.outrec) {
        resultOp = this.addLocalMaxPoly(e1, e2, pt);
        this.addLocalMinPoly(e1, e2, pt);
      } else {
        resultOp = this.addOutPt(e1, pt);
        this.addOutPt(e2, pt);
        swapOutrecs(e1, e2);
      }
    } else if (isHotEdge(e1)) {
      resultOp = this.addOutPt(e1, pt);
      swapOutrecs(e1, e2);
    } else if (isHotEdge(e2)) {
      resultOp = this.addOutPt(e2, pt);
      swapOutrecs(e1, e2);
    } else {
      let e1Wc2: number;
      let e2Wc2: number;
      switch (this.fillrule_) {
        case FillRule.EvenOdd:
        case FillRule.NonZero:
          e1Wc2 = Math.abs(e1.wind_cnt2);
          e2Wc2 = Math.abs(e2.wind_cnt2);
          break;
        default:
          if (this.fillrule_ === this.fillpos) {
            e1Wc2 = e1.wind_cnt2;
            e2Wc2 = e2.wind_cnt2;
          } else {
            e1Wc2 = -e1.wind_cnt2;
            e2Wc2 = -e2.wind_cnt2;
          }
          break;
      }

      if (!isSamePolyType(e1, e2)) {
        resultOp = this.addLocalMinPoly(e1, e2, pt, false);
      } else if (old_e1_windcnt === 1 && old_e2_windcnt === 1) {
        resultOp = null;
        switch (this.cliptype_) {
          case ClipType.Union:
            if (e1Wc2 <= 0 && e2Wc2 <= 0) resultOp = this.addLocalMinPoly(e1, e2, pt, false);
            break;
          case ClipType.Difference:
            if (
              (getPolyType(e1) === PathType.Clip && e1Wc2 > 0 && e2Wc2 > 0) ||
              (getPolyType(e1) === PathType.Subject && e1Wc2 <= 0 && e2Wc2 <= 0)
            )
              resultOp = this.addLocalMinPoly(e1, e2, pt, false);
            break;
          case ClipType.Xor:
            resultOp = this.addLocalMinPoly(e1, e2, pt, false);
            break;
          default:
            if (e1Wc2 > 0 && e2Wc2 > 0) resultOp = this.addLocalMinPoly(e1, e2, pt, false);
            break;
        }
      }
    }
    return resultOp;
  }

  private deleteFromAEL(e: Active): void {
    const prev = e.prev_in_ael;
    const next = e.next_in_ael;
    if (!prev && !next && e !== this.actives_) return; // already deleted
    if (prev) prev.next_in_ael = next;
    else this.actives_ = next;
    if (next) next.prev_in_ael = prev;
  }

  private adjustCurrXAndCopyToSEL(topY: number): void {
    let e = this.actives_;
    this.sel_ = e;
    while (e) {
      e.prev_in_sel = e.prev_in_ael;
      e.next_in_sel = e.next_in_ael;
      e.jump = e.next_in_sel;
      if (e.join_with === JoinWith.Left) e.curr_x = e.prev_in_ael!.curr_x;
      else e.curr_x = topX(e, topY);
      e = e.next_in_ael;
    }
  }

  protected executeInternal(ct: ClipType, fillrule: FillRule, usePolytrees: boolean): boolean {
    this.cliptype_ = ct;
    this.fillrule_ = fillrule;
    this.using_polytree_ = usePolytrees;
    this.reset();
    let y = this.popScanline();
    if (ct === ClipType.None || y === null) return true;
    while (this.succeeded_) {
      this.insertLocalMinimaIntoAEL(y);
      for (let e = this.popHorz(); e; e = this.popHorz()) this.doHorizontal(e);
      if (this.horz_seg_list_.length > 0) {
        this.convertHorzSegsToJoins();
        this.horz_seg_list_ = [];
      }
      this.bot_y_ = y; // bot_y_ == bottom of scanbeam
      y = this.popScanline();
      if (y === null) break; // y new top of scanbeam
      this.doIntersections(y);
      this.doTopOfScanbeam(y);
      for (let e = this.popHorz(); e; e = this.popHorz()) this.doHorizontal(e);
    }
    if (this.succeeded_) this.processHorzJoins();
    return this.succeeded_;
  }

  private convertHorzSegsToJoins(): void {
    // `std::count_if` runs UpdateHorzSegment on every element, in order.
    let j = 0;
    for (const hs of this.horz_seg_list_) if (updateHorzSegment(hs)) j++;
    if (j < 2) return;
    // HorzSegSorter, stable
    stableSort(this.horz_seg_list_, (hs1, hs2) => {
      if (!hs1.right_op || !hs2.right_op) return !!hs1.right_op;
      return hs2.left_op.pt.x > hs1.left_op.pt.x;
    });

    const list = this.horz_seg_list_;
    const hsEnd = j;
    const hsEnd1 = hsEnd - 1;
    for (let i1 = 0; i1 !== hsEnd1; ++i1) {
      const hs1 = list[i1]!;
      for (let i2 = i1 + 1; i2 !== hsEnd; ++i2) {
        const hs2 = list[i2]!;
        if (
          hs2.left_op.pt.x >= hs1.right_op!.pt.x ||
          hs2.left_to_right === hs1.left_to_right ||
          hs2.right_op!.pt.x <= hs1.left_op.pt.x
        )
          continue;
        const currY = hs1.left_op.pt.y;
        if (hs1.left_to_right) {
          while (hs1.left_op.next.pt.y === currY && hs1.left_op.next.pt.x <= hs2.left_op.pt.x)
            hs1.left_op = hs1.left_op.next;
          while (hs2.left_op.prev.pt.y === currY && hs2.left_op.prev.pt.x <= hs1.left_op.pt.x)
            hs2.left_op = hs2.left_op.prev;
          this.horz_join_list_.push({
            op1: duplicateOp(hs1.left_op, true),
            op2: duplicateOp(hs2.left_op, false),
          });
        } else {
          while (hs1.left_op.prev.pt.y === currY && hs1.left_op.prev.pt.x <= hs2.left_op.pt.x)
            hs1.left_op = hs1.left_op.prev;
          while (hs2.left_op.next.pt.y === currY && hs2.left_op.next.pt.x <= hs1.left_op.pt.x)
            hs2.left_op = hs2.left_op.next;
          this.horz_join_list_.push({
            op1: duplicateOp(hs2.left_op, true),
            op2: duplicateOp(hs1.left_op, false),
          });
        }
      }
    }
  }

  private processHorzJoins(): void {
    for (const j of this.horz_join_list_) {
      const or1 = getRealOutRec(j.op1.outrec)!;
      let or2 = getRealOutRec(j.op2.outrec)!;

      const op1b = j.op1.next;
      const op2b = j.op2.prev;
      j.op1.next = j.op2;
      j.op2.prev = j.op1;
      op1b.prev = op2b;
      op2b.next = op1b;

      if (or1 === or2) {
        or2 = this.newOutRec();
        or2.pts = op1b;
        fixOutRecPts(or2);

        if (or1.pts!.outrec === or2) {
          or1.pts = j.op1;
          or1.pts.outrec = or1;
        }

        if (this.using_polytree_) {
          if (path1InsidePath2(or1.pts!, or2.pts!)) {
            const tmp = or1.pts;
            or1.pts = or2.pts;
            or2.pts = tmp;
            fixOutRecPts(or1);
            fixOutRecPts(or2);
            or2.owner = or1;
          } else if (path1InsidePath2(or2.pts!, or1.pts!)) {
            or2.owner = or1;
          } else or2.owner = or1.owner;

          if (!or1.splits) or1.splits = [];
          or1.splits.push(or2);
        } else or2.owner = or1;
      } else {
        or2.pts = null;
        if (this.using_polytree_) {
          setOwner(or2, or1);
          moveSplits(or2, or1);
        } else or2.owner = or1;
      }
    }
  }

  private doIntersections(topY: number): void {
    if (this.buildIntersectList(topY)) {
      this.processIntersectList();
      this.intersect_nodes_ = [];
    }
  }

  private addNewIntersectNode(e1: Active, e2: Active, topY: number): void {
    const ip: Point64 = { x: 0, y: 0 };
    if (!getIntersectPoint(e1.bot, e1.top, e2.bot, e2.top, ip)) {
      ip.x = e1.curr_x;
      ip.y = topY;
    }

    if (ip.y > this.bot_y_ || ip.y < topY) {
      const absDx1 = Math.abs(e1.dx);
      const absDx2 = Math.abs(e2.dx);
      if (absDx1 > 100 && absDx2 > 100) {
        let p: Point64;
        if (absDx1 > absDx2) p = getClosestPointOnSegment(ip, e1.bot, e1.top);
        else p = getClosestPointOnSegment(ip, e2.bot, e2.top);
        ip.x = p.x;
        ip.y = p.y;
      } else if (absDx1 > 100) {
        const p = getClosestPointOnSegment(ip, e1.bot, e1.top);
        ip.x = p.x;
        ip.y = p.y;
      } else if (absDx2 > 100) {
        const p = getClosestPointOnSegment(ip, e2.bot, e2.top);
        ip.x = p.x;
        ip.y = p.y;
      } else {
        if (ip.y < topY) ip.y = topY;
        else ip.y = this.bot_y_;
        if (absDx1 < absDx2) ip.x = topX(e1, ip.y);
        else ip.x = topX(e2, ip.y);
      }
    }
    this.intersect_nodes_.push({ pt: ip, edge1: e1, edge2: e2 });
  }

  private buildIntersectList(topY: number): boolean {
    if (!this.actives_ || !this.actives_.next_in_ael) return false;

    this.adjustCurrXAndCopyToSEL(topY);

    let left: Active | null = this.sel_;
    let right: Active | null;
    let l_end: Active | null;
    let r_end: Active | null;
    let curr_base: Active | null;
    let tmp: Active | null;

    while (left && left.jump) {
      let prev_base: Active | null = null;
      while (left && left.jump) {
        curr_base = left;
        right = left.jump;
        l_end = right;
        r_end = right.jump;
        left.jump = r_end;
        while (left !== l_end && right !== r_end) {
          if (right!.curr_x < left!.curr_x) {
            tmp = right!.prev_in_sel;
            for (;;) {
              this.addNewIntersectNode(tmp!, right!, topY);
              if (tmp === left) break;
              tmp = tmp!.prev_in_sel;
            }

            tmp = right;
            right = extractFromSEL(tmp!);
            l_end = right;
            insert1Before2InSEL(tmp!, left!);
            if (left === curr_base) {
              curr_base = tmp;
              curr_base!.jump = r_end;
              if (!prev_base) this.sel_ = curr_base;
              else prev_base.jump = curr_base;
            }
          } else left = left!.next_in_sel;
        }
        prev_base = curr_base;
        left = r_end;
      }
      left = this.sel_;
    }
    return this.intersect_nodes_.length > 0;
  }

  private processIntersectList(): void {
    stdSort(this.intersect_nodes_, intersectListSort);

    const nodes = this.intersect_nodes_;
    for (let i = 0; i < nodes.length; ++i) {
      if (!edgesAdjacentInAEL(nodes[i]!)) {
        let i2 = i + 1;
        while (!edgesAdjacentInAEL(nodes[i2]!)) ++i2;
        const t = nodes[i]!;
        nodes[i] = nodes[i2]!;
        nodes[i2] = t;
      }

      const node = nodes[i]!;
      this.intersectEdges(node.edge1, node.edge2, node.pt);
      this.swapPositionsInAEL(node.edge1, node.edge2);

      node.edge1.curr_x = node.pt.x;
      node.edge2.curr_x = node.pt.x;
      this.checkJoinLeft(node.edge2, node.pt, true);
      this.checkJoinRight(node.edge1, node.pt, true);
    }
  }

  private swapPositionsInAEL(e1: Active, e2: Active): void {
    const next = e2.next_in_ael;
    if (next) next.prev_in_ael = e1;
    const prev = e1.prev_in_ael;
    if (prev) prev.next_in_ael = e2;
    e2.prev_in_ael = prev;
    e2.next_in_ael = e1;
    e1.prev_in_ael = e2;
    e1.next_in_ael = next;
    if (!e2.prev_in_ael) this.actives_ = e2;
  }

  private addTrialHorzJoin(op: OutPt): void {
    if (op.outrec.is_open) return;
    this.horz_seg_list_.push({ left_op: op, right_op: null, left_to_right: true });
  }

  private doHorizontal(horz: Active): void {
    let pt: Point64;
    const horzIsOpen = isOpen(horz);
    const y = horz.bot.y;
    const vertex_max = horzIsOpen ? getCurrYMaximaVertex_Open(horz) : getCurrYMaximaVertex(horz);

    const dir = { left: 0, right: 0 };
    let isLeftToRight = resetHorzDirection(horz, vertex_max, dir);

    if (isHotEdge(horz)) {
      const op = this.addOutPt(horz, { x: horz.curr_x, y });
      this.addTrialHorzJoin(op);
    }

    for (;;) {
      let e: Active | null = isLeftToRight ? horz.next_in_ael : horz.prev_in_ael;
      while (e) {
        if (e.vertex_top === vertex_max) {
          if (isHotEdge(horz) && isJoined(e)) this.split(e, e.top);

          if (isHotEdge(horz)) {
            while (horz.vertex_top !== vertex_max) {
              this.addOutPt(horz, horz.top);
              this.updateEdgeIntoAEL(horz);
            }
            if (isLeftToRight) this.addLocalMaxPoly(horz, e, horz.top);
            else this.addLocalMaxPoly(e, horz, horz.top);
          }
          this.deleteFromAEL(e);
          this.deleteFromAEL(horz);
          return;
        }

        if (vertex_max !== horz.vertex_top || isOpenEnd(horz)) {
          if ((isLeftToRight && e.curr_x > dir.right) || (!isLeftToRight && e.curr_x < dir.left))
            break;

          if (e.curr_x === horz.top.x && !isHorizontal(e)) {
            pt = nextVertex(horz).pt;
            if (isLeftToRight) {
              if (isOpen(e) && !isSamePolyType(e, horz) && !isHotEdge(e)) {
                if (topX(e, pt.y) > pt.x) break;
              } else if (topX(e, pt.y) >= pt.x) break;
            } else {
              if (isOpen(e) && !isSamePolyType(e, horz) && !isHotEdge(e)) {
                if (topX(e, pt.y) < pt.x) break;
              } else if (topX(e, pt.y) <= pt.x) break;
            }
          }
        }

        pt = { x: e.curr_x, y: horz.bot.y };
        if (isLeftToRight) {
          this.intersectEdges(horz, e, pt);
          this.swapPositionsInAEL(horz, e);
          this.checkJoinLeft(e, pt);
          horz.curr_x = e.curr_x;
          e = horz.next_in_ael;
        } else {
          this.intersectEdges(e, horz, pt);
          this.swapPositionsInAEL(e, horz);
          this.checkJoinRight(e, pt);
          horz.curr_x = e.curr_x;
          e = horz.prev_in_ael;
        }

        if (horz.outrec) this.addTrialHorzJoin(getLastOp(horz));
      }

      if (horzIsOpen && isOpenEnd(horz)) {
        if (isHotEdge(horz)) {
          this.addOutPt(horz, horz.top);
          if (isFront(horz)) horz.outrec!.front_edge = null;
          else horz.outrec!.back_edge = null;
          horz.outrec = null;
        }
        this.deleteFromAEL(horz);
        return;
      }
      if (nextVertex(horz).pt.y !== horz.top.y) break;

      if (isHotEdge(horz)) this.addOutPt(horz, horz.top);
      this.updateEdgeIntoAEL(horz);

      isLeftToRight = resetHorzDirection(horz, vertex_max, dir);
    }

    if (isHotEdge(horz)) {
      const op = this.addOutPt(horz, horz.top);
      this.addTrialHorzJoin(op);
    }
    this.updateEdgeIntoAEL(horz);
  }

  private doTopOfScanbeam(y: number): void {
    this.sel_ = null;
    let e = this.actives_;
    while (e) {
      if (e.top.y === y) {
        e.curr_x = e.top.x;
        if (isMaxima(e)) {
          e = this.doMaxima(e);
          continue;
        }
        if (isHotEdge(e)) this.addOutPt(e, e.top);
        this.updateEdgeIntoAEL(e);
        if (isHorizontal(e)) this.pushHorz(e);
      } else e.curr_x = topX(e, y);
      e = e.next_in_ael;
    }
  }

  private doMaxima(e: Active): Active | null {
    const prev_e = e.prev_in_ael;
    let next_e = e.next_in_ael;

    if (isOpenEnd(e)) {
      if (isHotEdge(e)) this.addOutPt(e, e.top);
      if (!isHorizontal(e)) {
        if (isHotEdge(e)) {
          if (isFront(e)) e.outrec!.front_edge = null;
          else e.outrec!.back_edge = null;
          e.outrec = null;
        }
        this.deleteFromAEL(e);
      }
      return next_e;
    }

    const max_pair = getMaximaPair(e);
    if (!max_pair) return next_e;

    if (isJoined(e)) this.split(e, e.top);
    if (isJoined(max_pair)) this.split(max_pair, max_pair.top);

    while (next_e !== max_pair) {
      this.intersectEdges(e, next_e!, e.top);
      this.swapPositionsInAEL(e, next_e!);
      next_e = e.next_in_ael;
    }

    if (isOpen(e)) {
      if (isHotEdge(e)) this.addLocalMaxPoly(e, max_pair, e.top);
      this.deleteFromAEL(max_pair);
      this.deleteFromAEL(e);
      return prev_e ? prev_e.next_in_ael : this.actives_;
    }

    if (isHotEdge(e)) this.addLocalMaxPoly(e, max_pair, e.top);
    this.deleteFromAEL(e);
    this.deleteFromAEL(max_pair);
    return prev_e ? prev_e.next_in_ael : this.actives_;
  }

  private split(e: Active, pt: Point64): void {
    if (e.join_with === JoinWith.Right) {
      e.join_with = JoinWith.None;
      e.next_in_ael!.join_with = JoinWith.None;
      this.addLocalMinPoly(e, e.next_in_ael!, pt, true);
    } else {
      e.join_with = JoinWith.None;
      e.prev_in_ael!.join_with = JoinWith.None;
      this.addLocalMinPoly(e.prev_in_ael!, e, pt, true);
    }
  }

  private checkJoinLeft(e: Active, pt: Point64, checkCurrX = false): void {
    const prev = e.prev_in_ael;
    if (isOpen(e) || !isHotEdge(e) || !prev || isOpen(prev) || !isHotEdge(prev)) return;
    if ((pt.y < e.top.y + 2 || pt.y < prev.top.y + 2) && (e.bot.y > pt.y || prev.bot.y > pt.y))
      return;

    if (checkCurrX) {
      if (distanceFromLineSqrd(pt, prev.bot, prev.top) > 0.25) return;
    } else if (e.curr_x !== prev.curr_x) return;
    if (crossProduct3(e.top, pt, prev.top) !== 0) return;

    if (e.outrec!.idx === prev.outrec!.idx) this.addLocalMaxPoly(prev, e, pt);
    else if (e.outrec!.idx < prev.outrec!.idx) this.joinOutrecPaths(e, prev);
    else this.joinOutrecPaths(prev, e);
    prev.join_with = JoinWith.Right;
    e.join_with = JoinWith.Left;
  }

  private checkJoinRight(e: Active, pt: Point64, checkCurrX = false): void {
    const next = e.next_in_ael;
    if (isOpen(e) || !isHotEdge(e) || !next || isOpen(next) || !isHotEdge(next)) return;
    if ((pt.y < e.top.y + 2 || pt.y < next.top.y + 2) && (e.bot.y > pt.y || next.bot.y > pt.y))
      return;

    if (checkCurrX) {
      if (distanceFromLineSqrd(pt, next.bot, next.top) > 0.35) return;
    } else if (e.curr_x !== next.curr_x) return;
    if (crossProduct3(e.top, pt, next.top) !== 0) return;

    if (e.outrec!.idx === next.outrec!.idx) this.addLocalMaxPoly(e, next, pt);
    else if (e.outrec!.idx < next.outrec!.idx) this.joinOutrecPaths(e, next);
    else this.joinOutrecPaths(next, e);
    e.join_with = JoinWith.Right;
    next.join_with = JoinWith.Left;
  }

  protected checkBounds(outrec: OutRec): boolean {
    if (!outrec.pts) return false;
    if (!rectIsEmpty(outrec.bounds)) return true;
    this.cleanCollinear(outrec);
    if (!outrec.pts) return false;
    const path = buildPath64(outrec.pts, this.reverse_solution_, false);
    if (!path) return false;
    outrec.path = path;
    outrec.bounds = getBounds(outrec.path);
    return true;
  }

  private checkSplitOwner(outrec: OutRec, splits: OutRec[]): boolean {
    for (let split of splits) {
      split = getRealOutRec(split)!;
      if (!split || split === outrec || split.recursive_split === outrec) continue;
      split.recursive_split = outrec;
      if (split.splits && this.checkSplitOwner(outrec, split.splits)) return true;
      if (
        this.checkBounds(split) &&
        isValidOwner(outrec, split) &&
        rectContainsRect(split.bounds, outrec.bounds) &&
        path1InsidePath2(outrec.pts!, split.pts!)
      ) {
        outrec.owner = split;
        return true;
      }
    }
    return false;
  }

  protected recursiveCheckOwners(outrec: OutRec, polypath: PolyPath64): void {
    if (outrec.polypath || rectIsEmpty(outrec.bounds)) return;

    while (outrec.owner) {
      if (outrec.owner.splits && this.checkSplitOwner(outrec, outrec.owner.splits)) break;
      if (
        outrec.owner.pts &&
        this.checkBounds(outrec.owner) &&
        rectContainsRect(outrec.owner.bounds, outrec.bounds) &&
        path1InsidePath2(outrec.pts!, outrec.owner.pts)
      )
        break;
      outrec.owner = outrec.owner.owner;
    }

    if (outrec.owner) {
      if (!outrec.owner.polypath) this.recursiveCheckOwners(outrec.owner, polypath);
      outrec.polypath = outrec.owner.polypath!.addChild(outrec.path);
    } else outrec.polypath = polypath.addChild(outrec.path);
  }

  protected cleanUpAfter(): void {
    this.cleanUp();
  }
}

function isValidAelOrder(resident: Active, newcomer: Active): boolean {
  if (newcomer.curr_x !== resident.curr_x) return newcomer.curr_x > resident.curr_x;

  const d = crossProduct3(resident.top, newcomer.bot, newcomer.top);
  if (d !== 0) return d < 0;

  if (!isMaxima(resident) && resident.top.y > newcomer.top.y) {
    return crossProduct3(newcomer.bot, resident.top, nextVertex(resident).pt) <= 0;
  }
  if (!isMaxima(newcomer) && newcomer.top.y > resident.top.y) {
    return crossProduct3(newcomer.bot, newcomer.top, nextVertex(newcomer).pt) >= 0;
  }

  const y = newcomer.bot.y;
  const newcomerIsLeft = newcomer.is_left_bound;

  if (resident.bot.y !== y || resident.local_min.vertex.pt.y !== y) return newcomer.is_left_bound;
  if (resident.is_left_bound !== newcomerIsLeft) return newcomerIsLeft;
  if (crossProduct3(prevPrevVertex(resident).pt, resident.bot, resident.top) === 0) return true;
  return (
    crossProduct3(prevPrevVertex(resident).pt, newcomer.bot, prevPrevVertex(newcomer).pt) > 0 ===
    newcomerIsLeft
  );
}

function insertRightEdge(e: Active, e2: Active): void {
  e2.next_in_ael = e.next_in_ael;
  if (e.next_in_ael) e.next_in_ael.prev_in_ael = e2;
  e2.prev_in_ael = e;
  e.next_in_ael = e2;
}

function trimHorz(horzEdge: Active, preserveCollinear: boolean): void {
  let wasTrimmed = false;
  let pt = nextVertex(horzEdge).pt;
  while (pt.y === horzEdge.top.y) {
    if (preserveCollinear && pt.x < horzEdge.top.x !== horzEdge.bot.x < horzEdge.top.x) break;
    horzEdge.vertex_top = nextVertex(horzEdge);
    horzEdge.top = { ...pt };
    wasTrimmed = true;
    if (isMaxima(horzEdge)) break;
    pt = nextVertex(horzEdge).pt;
  }
  if (wasTrimmed) setDx(horzEdge);
}

function findEdgeWithMatchingLocMin(e: Active): Active | null {
  let result = e.next_in_ael;
  while (result) {
    if (result.local_min === e.local_min) return result;
    if (!isHorizontal(result) && !ptEq(e.bot, result.bot)) result = null;
    else result = result.next_in_ael;
  }
  result = e.prev_in_ael;
  while (result) {
    if (result.local_min === e.local_min) return result;
    if (!isHorizontal(result) && !ptEq(e.bot, result.bot)) return null;
    result = result.prev_in_ael;
  }
  return result;
}

function fixOutRecPts(outrec: OutRec): void {
  let op = outrec.pts!;
  do {
    op.outrec = outrec;
    op = op.next;
  } while (op !== outrec.pts);
}

function setHorzSegHeadingForward(hs: HorzSegment, opP: OutPt, opN: OutPt): boolean {
  if (opP.pt.x === opN.pt.x) return false;
  if (opP.pt.x < opN.pt.x) {
    hs.left_op = opP;
    hs.right_op = opN;
    hs.left_to_right = true;
  } else {
    hs.left_op = opN;
    hs.right_op = opP;
    hs.left_to_right = false;
  }
  return true;
}

function updateHorzSegment(hs: HorzSegment): boolean {
  const op = hs.left_op;
  const outrec = getRealOutRec(op.outrec)!;
  const outrecHasEdges = !!outrec.front_edge;
  const currY = op.pt.y;
  let opP = op;
  let opN = op;
  if (outrecHasEdges) {
    const opA = outrec.pts!;
    const opZ = opA.next;
    while (opP !== opZ && opP.prev.pt.y === currY) opP = opP.prev;
    while (opN !== opA && opN.next.pt.y === currY) opN = opN.next;
  } else {
    while (opP.prev !== opN && opP.prev.pt.y === currY) opP = opP.prev;
    while (opN.next !== opP && opN.next.pt.y === currY) opN = opN.next;
  }
  const result = setHorzSegHeadingForward(hs, opP, opN) && !hs.left_op.horz;
  if (result) hs.left_op.horz = hs;
  else hs.right_op = null;
  return result;
}

function moveSplits(fromOr: OutRec, toOr: OutRec): void {
  if (!fromOr.splits) return;
  if (!toOr.splits) toOr.splits = [];
  for (const s of fromOr.splits) toOr.splits.push(s);
  fromOr.splits = [];
}

function getLastOp(hotEdge: Active): OutPt {
  const outrec = hotEdge.outrec!;
  let result = outrec.pts!;
  if (hotEdge !== outrec.front_edge) result = result.next;
  return result;
}

function resetHorzDirection(
  horz: Active,
  maxVertex: Vertex | null,
  out: { left: number; right: number },
): boolean {
  if (horz.bot.x === horz.top.x) {
    out.left = horz.curr_x;
    out.right = horz.curr_x;
    let e = horz.next_in_ael;
    while (e && e.vertex_top !== maxVertex) e = e.next_in_ael;
    return e !== null;
  }
  if (horz.curr_x < horz.top.x) {
    out.left = horz.curr_x;
    out.right = horz.top.x;
    return true;
  }
  out.left = horz.top.x;
  out.right = horz.curr_x;
  return false;
}

export function buildPath64(
  op: OutPt | null,
  reverse: boolean,
  isOpenPath: boolean,
): Path64 | null {
  if (!op || op.next === op || (!isOpenPath && op.next === op.prev)) return null;
  const path: Path64 = [];
  let lastPt: Point64;
  let op2: OutPt;
  if (reverse) {
    lastPt = op.pt;
    op2 = op.prev;
  } else {
    op = op.next;
    lastPt = op.pt;
    op2 = op.next;
  }
  path.push({ x: lastPt.x, y: lastPt.y });
  while (op2 !== op) {
    if (!ptEq(op2.pt, lastPt)) {
      lastPt = op2.pt;
      path.push({ x: lastPt.x, y: lastPt.y });
    }
    op2 = reverse ? op2.prev : op2.next;
  }
  if (path.length === 3 && isVerySmallTriangle(op2)) return null;
  return path;
}

// ---------------------------------------------------------------------------

export class Clipper64 extends ClipperBase {
  addSubject(subjects: Paths64): void {
    this.addPaths(subjects, PathType.Subject, false);
  }
  addOpenSubject(openSubjects: Paths64): void {
    this.addPaths(openSubjects, PathType.Subject, true);
  }
  addClip(clips: Paths64): void {
    this.addPaths(clips, PathType.Clip, false);
  }

  /** `Execute( clip_type, fill_rule, Paths64& closed_paths )`. */
  executePaths(clipType: ClipType, fillRule: FillRule): Paths64 {
    const closed: Paths64 = [];
    if (this.executeInternal(clipType, fillRule, false)) this.buildPaths64(closed, null);
    this.cleanUpAfter();
    return closed;
  }

  /** `Execute( clip_type, fill_rule, PolyTree64& polytree )`. */
  executeTree(clipType: ClipType, fillRule: FillRule, polytree: PolyTree64): boolean {
    if (this.executeInternal(clipType, fillRule, true)) {
      polytree.clear();
      this.buildTree64(polytree);
    }
    this.cleanUpAfter();
    return this.succeeded_;
  }

  private buildPaths64(solutionClosed: Paths64, solutionOpen: Paths64 | null): void {
    for (let i = 0; i < this.outrec_list_.length; ++i) {
      const outrec = this.outrec_list_[i]!;
      if (outrec.pts === null) continue;
      if (solutionOpen && outrec.is_open) {
        const path = buildPath64(outrec.pts, this.reverse_solution_, true);
        if (path) solutionOpen.push(path);
      } else {
        this.cleanCollinear(outrec);
        const path = buildPath64(outrec.pts, this.reverse_solution_, false);
        if (path) solutionClosed.push(path);
      }
    }
  }

  private buildTree64(polytree: PolyPath64): void {
    polytree.clear();
    for (let i = 0; i < this.outrec_list_.length; ++i) {
      const outrec = this.outrec_list_[i]!;
      if (!outrec || !outrec.pts) continue;
      if (outrec.is_open) continue;
      if (this.checkBounds(outrec)) this.recursiveCheckOwners(outrec, polytree);
    }
  }
}
