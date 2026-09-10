// SPDX-License-Identifier: BSL-1.0
// Clipper2 1.3.0, Angus Johnson 2010-2023 (http://www.angusj.com), ported to
// TypeScript for ZiroEDA. Boost Software License 1.0.
/**
 * `clipper.core.h`: points, rectangles and the geometry helpers the engine
 * and the offsetter share.
 *
 * Coordinates are `int64_t` upstream. A JavaScript number holds every integer
 * up to 2^53 exactly, which covers any board coordinate KiCad can represent
 * (its own internal-unit limit is far below that), and every product that
 * matters upstream is taken AFTER a cast to double — `CrossProduct` casts the
 * differences, not the product — so the arithmetic here is the same
 * arithmetic, bit for bit. The three places C++ integer semantics leak in
 * are named where they happen: `Point64` from doubles rounds half away from
 * zero (`std::round`), `GetIntersectPoint` truncates (`static_cast<int64_t>`),
 * and the engine's `TopX` rounds half to even (`std::nearbyint`).
 */

export interface Point64 {
  x: number;
  y: number;
}
export interface PointD {
  x: number;
  y: number;
}
export type Path64 = Point64[];
export type Paths64 = Path64[];
export type PathD = PointD[];

export enum FillRule {
  EvenOdd = 0,
  NonZero = 1,
  Positive = 2,
  Negative = 3,
}
export enum ClipType {
  None = 0,
  Intersection = 1,
  Union = 2,
  Difference = 3,
  Xor = 4,
}
export enum PathType {
  Subject = 0,
  Clip = 1,
}
export enum JoinType {
  Square = 0,
  Bevel = 1,
  Round = 2,
  Miter = 3,
}
export enum EndType {
  Polygon = 0,
  Joined = 1,
  Butt = 2,
  Square = 3,
  Round = 4,
}

/** `static const double PI = 3.141592653589793238;` — the same double as `Math.PI`. */
export const PI = Math.PI;

/**
 * `MAX_COORD = INT64_MAX >> 2` and the int64 limits — as doubles, which is
 * what every comparison against them is (2^61, 2^63).
 */
export const MAX_COORD = 2 ** 61;
export const MIN_COORD = -MAX_COORD;
export const INT64_MAX = 2 ** 63;
export const INT64_MIN = -(2 ** 63);
export const MAX_DBL = Number.MAX_VALUE;

/** `std::round`: half away from zero. What `Point<int64_t>` does with a double. */
export function roundHalfAway(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** `std::nearbyint` under the default rounding mode: half to even. */
export function nearbyint(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** `Point64( double x, double y )`. */
export const point64 = (x: number, y: number): Point64 => ({
  x: roundHalfAway(x),
  y: roundHalfAway(y),
});
export const ptEq = (a: Point64, b: Point64): boolean => a.x === b.x && a.y === b.y;

export interface Rect64 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const rect64 = (l: number, t: number, r: number, b: number): Rect64 => ({
  left: l,
  top: t,
  right: r,
  bottom: b,
});
/** `Rect64( false )`: an invalid rect, left = top = INT64_MAX, right = bottom = INT64_MIN. */
export const invalidRect64 = (): Rect64 => rect64(INT64_MAX, INT64_MAX, INT64_MIN, INT64_MIN);
export const rectIsValid = (r: Rect64): boolean => r.left !== INT64_MAX;
export const rectIsEmpty = (r: Rect64): boolean => r.bottom <= r.top || r.right <= r.left;
export const rectWidth = (r: Rect64): number => r.right - r.left;
export const rectHeight = (r: Rect64): number => r.bottom - r.top;
export const rectMidPoint = (r: Rect64): Point64 => ({
  // `(left + right) / 2` in int64: truncation toward zero.
  x: Math.trunc((r.left + r.right) / 2),
  y: Math.trunc((r.top + r.bottom) / 2),
});
export const rectContainsPt = (r: Rect64, pt: Point64): boolean =>
  pt.x > r.left && pt.x < r.right && pt.y > r.top && pt.y < r.bottom;
export const rectContainsRect = (r: Rect64, rec: Rect64): boolean =>
  rec.left >= r.left && rec.right <= r.right && rec.top >= r.top && rec.bottom <= r.bottom;
export const rectAsPath = (r: Rect64): Path64 => [
  { x: r.left, y: r.top },
  { x: r.right, y: r.top },
  { x: r.right, y: r.bottom },
  { x: r.left, y: r.bottom },
];

export function getBounds(path: Path64): Rect64 {
  let xmin = INT64_MAX;
  let ymin = INT64_MAX;
  let xmax = INT64_MIN;
  let ymax = INT64_MIN;
  for (const p of path) {
    if (p.x < xmin) xmin = p.x;
    if (p.x > xmax) xmax = p.x;
    if (p.y < ymin) ymin = p.y;
    if (p.y > ymax) ymax = p.y;
  }
  return rect64(xmin, ymin, xmax, ymax);
}

export const sqr = (v: number): number => v * v;

/** `CrossProduct( pt1, pt2, pt3 )`: the differences cast to double, then multiplied. */
export function crossProduct3(pt1: Point64, pt2: Point64, pt3: Point64): number {
  return (pt2.x - pt1.x) * (pt3.y - pt2.y) - (pt2.y - pt1.y) * (pt3.x - pt2.x);
}
/** `DotProduct( pt1, pt2, pt3 )`. */
export function dotProduct3(pt1: Point64, pt2: Point64, pt3: Point64): number {
  return (pt2.x - pt1.x) * (pt3.x - pt2.x) + (pt2.y - pt1.y) * (pt3.y - pt2.y);
}
/**
 * `CrossProduct( vec1, vec2 )` and `DotProduct( vec1, vec2 )` on PointD, which
 * is the only way the offsetter calls them: plain double arithmetic.
 */
export const crossProductD = (v1: PointD, v2: PointD): number => v1.y * v2.x - v2.y * v1.x;
export const dotProductD = (v1: PointD, v2: PointD): number => v1.x * v2.x + v1.y * v2.y;

export function distanceSqr(pt1: Point64, pt2: Point64): number {
  return sqr(pt1.x - pt2.x) + sqr(pt1.y - pt2.y);
}

export function distanceFromLineSqrd(pt: Point64, ln1: Point64, ln2: Point64): number {
  const A = ln1.y - ln2.y;
  const B = ln2.x - ln1.x;
  let C = A * ln1.x + B * ln1.y;
  C = A * pt.x + B * pt.y - C;
  return (C * C) / (A * A + B * B);
}

/**
 * `Area( const Path<T>& )`, in upstream's pairwise order: the terms are
 * summed two at a time from the end, which is not the same double as a plain
 * left-to-right shoelace when the products are large.
 */
export function area(path: Path64): number {
  const cnt = path.length;
  if (cnt < 3) return 0;
  let a = 0;
  let it1 = 0;
  let it2 = cnt - 1;
  const stop = cnt & 1 ? cnt - 1 : cnt;
  while (it1 !== stop) {
    a += (path[it2]!.y + path[it1]!.y) * (path[it2]!.x - path[it1]!.x);
    it2 = it1 + 1;
    a += (path[it1]!.y + path[it2]!.y) * (path[it1]!.x - path[it2]!.x);
    it1 += 2;
  }
  if (cnt & 1) a += (path[it2]!.y + path[it1]!.y) * (path[it2]!.x - path[it1]!.x);
  return a * 0.5;
}

export const isPositive = (poly: Path64): boolean => area(poly) >= 0;

/**
 * `GetIntersectPoint`. The result is `static_cast<int64_t>`: TRUNCATED, not
 * rounded, and `t <= 0` / `t >= 1` snap to the segment's own ends.
 */
export function getIntersectPoint(
  ln1a: Point64,
  ln1b: Point64,
  ln2a: Point64,
  ln2b: Point64,
  ip: Point64,
): boolean {
  const dx1 = ln1b.x - ln1a.x;
  const dy1 = ln1b.y - ln1a.y;
  const dx2 = ln2b.x - ln2a.x;
  const dy2 = ln2b.y - ln2a.y;
  const det = dy1 * dx2 - dy2 * dx1;
  if (det === 0) return false;
  const t = ((ln1a.x - ln2a.x) * dy2 - (ln1a.y - ln2a.y) * dx2) / det;
  if (t <= 0) {
    ip.x = ln1a.x;
    ip.y = ln1a.y;
  } else if (t >= 1) {
    ip.x = ln1b.x;
    ip.y = ln1b.y;
  } else {
    ip.x = Math.trunc(ln1a.x + t * dx1);
    ip.y = Math.trunc(ln1a.y + t * dy1);
  }
  return true;
}

export function segmentsIntersect(
  seg1a: Point64,
  seg1b: Point64,
  seg2a: Point64,
  seg2b: Point64,
  inclusive = false,
): boolean {
  if (inclusive) {
    const res1 = crossProduct3(seg1a, seg2a, seg2b);
    const res2 = crossProduct3(seg1b, seg2a, seg2b);
    if (res1 * res2 > 0) return false;
    const res3 = crossProduct3(seg2a, seg1a, seg1b);
    const res4 = crossProduct3(seg2b, seg1a, seg1b);
    if (res3 * res4 > 0) return false;
    return res1 !== 0 || res2 !== 0 || res3 !== 0 || res4 !== 0;
  }
  return (
    crossProduct3(seg1a, seg2a, seg2b) * crossProduct3(seg1b, seg2a, seg2b) < 0 &&
    crossProduct3(seg2a, seg1a, seg1b) * crossProduct3(seg2b, seg1a, seg1b) < 0
  );
}

/** `GetClosestPointOnSegment` for Point64: `nearbyint` on the offsets. */
export function getClosestPointOnSegment(offPt: Point64, seg1: Point64, seg2: Point64): Point64 {
  if (seg1.x === seg2.x && seg1.y === seg2.y) return { x: seg1.x, y: seg1.y };
  const dx = seg2.x - seg1.x;
  const dy = seg2.y - seg1.y;
  let q = ((offPt.x - seg1.x) * dx + (offPt.y - seg1.y) * dy) / (sqr(dx) + sqr(dy));
  if (q < 0) q = 0;
  else if (q > 1) q = 1;
  return { x: seg1.x + nearbyint(q * dx), y: seg1.y + nearbyint(q * dy) };
}

export enum PointInPolygonResult {
  IsOn = 0,
  IsInside = 1,
  IsOutside = 2,
}

/** `PointInPolygon( pt, polygon )`, iterator-for-iterator. */
export function pointInPolygon(pt: Point64, polygon: Path64): PointInPolygonResult {
  const n = polygon.length;
  if (n < 3) return PointInPolygonResult.IsOutside;
  let val = 0;
  const cbegin = 0;
  let first = cbegin;
  let cend = n;
  while (first !== cend && polygon[first]!.y === pt.y) ++first;
  if (first === cend) return PointInPolygonResult.IsOutside;

  let isAbove = polygon[first]!.y < pt.y;
  const startingAbove = isAbove;
  let curr = first + 1;
  let prev: number;
  for (;;) {
    if (curr === cend) {
      if (cend === first || first === cbegin) break;
      cend = first;
      curr = cbegin;
    }
    if (isAbove) {
      while (curr !== cend && polygon[curr]!.y < pt.y) ++curr;
      if (curr === cend) continue;
    } else {
      while (curr !== cend && polygon[curr]!.y > pt.y) ++curr;
      if (curr === cend) continue;
    }
    if (curr === cbegin) prev = n - 1;
    else prev = curr - 1;

    if (polygon[curr]!.y === pt.y) {
      if (
        polygon[curr]!.x === pt.x ||
        (polygon[curr]!.y === polygon[prev]!.y &&
          pt.x < polygon[prev]!.x !== pt.x < polygon[curr]!.x)
      )
        return PointInPolygonResult.IsOn;
      ++curr;
      if (curr === first) break;
      continue;
    }

    if (pt.x < polygon[curr]!.x && pt.x < polygon[prev]!.x) {
      // we're only interested in edges crossing on the left
    } else if (pt.x > polygon[prev]!.x && pt.x > polygon[curr]!.x) val = 1 - val;
    else {
      const d = crossProduct3(polygon[prev]!, polygon[curr]!, pt);
      if (d === 0) return PointInPolygonResult.IsOn;
      if (d < 0 === isAbove) val = 1 - val;
    }
    isAbove = !isAbove;
    ++curr;
  }

  if (isAbove !== startingAbove) {
    cend = n;
    if (curr === cend) curr = cbegin;
    if (curr === cbegin) prev = n - 1;
    else prev = curr - 1;
    const d = crossProduct3(polygon[prev]!, polygon[curr]!, pt);
    if (d === 0) return PointInPolygonResult.IsOn;
    if (d < 0 === isAbove) val = 1 - val;
  }
  return val === 0 ? PointInPolygonResult.IsOutside : PointInPolygonResult.IsInside;
}

/** `StripDuplicates( path, is_closed_path )`: `std::unique` then the closing duplicate. */
export function stripDuplicates(path: Path64, isClosedPath: boolean): Path64 {
  const out: Path64 = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || !ptEq(last, p)) out.push(p);
  }
  if (isClosedPath) while (out.length > 1 && ptEq(out[out.length - 1]!, out[0]!)) out.pop();
  return out;
}

/**
 * libstdc++'s `std::sort`: introsort with a depth limit of 2·lg(n),
 * median-of-three pivots moved to the front, unguarded partitioning, a
 * 16-element insertion-sort threshold and a heapsort fallback. `std::sort` is
 * not stable, and the engine sorts its intersection list with it: two nodes
 * at the same point come out in the order THIS algorithm leaves them in, and
 * the edges are then processed in that order. A stable sort here would be a
 * different program.
 */
export function stdSort<T>(a: T[], comp: (x: T, y: T) => boolean): void {
  const n = a.length;
  if (n < 2) return;
  let depth = 0;
  for (let k = n; k > 1; k >>= 1) depth++;
  introsortLoop(a, 0, n, depth * 2, comp);
  finalInsertionSort(a, 0, n, comp);
}

const THRESHOLD = 16;

function introsortLoop<T>(
  a: T[],
  first: number,
  last: number,
  depthLimit: number,
  comp: (x: T, y: T) => boolean,
): void {
  while (last - first > THRESHOLD) {
    if (depthLimit === 0) {
      heapSort(a, first, last, comp);
      return;
    }
    --depthLimit;
    const cut = unguardedPartitionPivot(a, first, last, comp);
    introsortLoop(a, cut, last, depthLimit, comp);
    last = cut;
  }
}

function swap<T>(a: T[], i: number, j: number): void {
  const t = a[i]!;
  a[i] = a[j]!;
  a[j] = t;
}

function moveMedianToFirst<T>(
  a: T[],
  result: number,
  b: number,
  c: number,
  d: number,
  comp: (x: T, y: T) => boolean,
): void {
  if (comp(a[b]!, a[c]!)) {
    if (comp(a[c]!, a[d]!)) swap(a, result, c);
    else if (comp(a[b]!, a[d]!)) swap(a, result, d);
    else swap(a, result, b);
  } else if (comp(a[b]!, a[d]!)) swap(a, result, b);
  else if (comp(a[c]!, a[d]!)) swap(a, result, d);
  else swap(a, result, c);
}

function unguardedPartitionPivot<T>(
  a: T[],
  first: number,
  last: number,
  comp: (x: T, y: T) => boolean,
): number {
  const mid = first + ((last - first) >> 1);
  moveMedianToFirst(a, first, first + 1, mid, last - 1, comp);
  return unguardedPartition(a, first + 1, last, first, comp);
}

function unguardedPartition<T>(
  a: T[],
  first: number,
  last: number,
  pivot: number,
  comp: (x: T, y: T) => boolean,
): number {
  for (;;) {
    while (comp(a[first]!, a[pivot]!)) ++first;
    --last;
    while (comp(a[pivot]!, a[last]!)) --last;
    if (!(first < last)) return first;
    swap(a, first, last);
    ++first;
  }
}

function finalInsertionSort<T>(
  a: T[],
  first: number,
  last: number,
  comp: (x: T, y: T) => boolean,
): void {
  if (last - first > THRESHOLD) {
    insertionSort(a, first, first + THRESHOLD, comp);
    for (let i = first + THRESHOLD; i !== last; ++i) unguardedLinearInsert(a, i, comp);
  } else insertionSort(a, first, last, comp);
}

function insertionSort<T>(
  a: T[],
  first: number,
  last: number,
  comp: (x: T, y: T) => boolean,
): void {
  if (first === last) return;
  for (let i = first + 1; i !== last; ++i) {
    if (comp(a[i]!, a[first]!)) {
      const val = a[i]!;
      for (let j = i; j > first; --j) a[j] = a[j - 1]!;
      a[first] = val;
    } else unguardedLinearInsert(a, i, comp);
  }
}

function unguardedLinearInsert<T>(a: T[], last: number, comp: (x: T, y: T) => boolean): void {
  const val = a[last]!;
  let next = last - 1;
  while (comp(val, a[next]!)) {
    a[last] = a[next]!;
    last = next;
    --next;
  }
  a[last] = val;
}

function heapSort<T>(a: T[], first: number, last: number, comp: (x: T, y: T) => boolean): void {
  const len = last - first;
  if (len < 2) return;
  // __make_heap
  let parent = (len - 2) >> 1;
  for (;;) {
    adjustHeap(a, first, parent, len, a[first + parent]!, comp);
    if (parent === 0) break;
    parent--;
  }
  // __sort_heap
  while (last - first > 1) {
    --last;
    const value = a[last]!;
    a[last] = a[first]!;
    adjustHeap(a, first, 0, last - first, value, comp);
  }
}

function adjustHeap<T>(
  a: T[],
  first: number,
  holeIndex: number,
  len: number,
  value: T,
  comp: (x: T, y: T) => boolean,
): void {
  const topIndex = holeIndex;
  let secondChild = holeIndex;
  while (secondChild < (len - 1) >> 1) {
    secondChild = 2 * (secondChild + 1);
    if (comp(a[first + secondChild]!, a[first + secondChild - 1]!)) secondChild--;
    a[first + holeIndex] = a[first + secondChild]!;
    holeIndex = secondChild;
  }
  if ((len & 1) === 0 && secondChild === (len - 2) >> 1) {
    secondChild = 2 * (secondChild + 1);
    a[first + holeIndex] = a[first + secondChild - 1]!;
    holeIndex = secondChild - 1;
  }
  // __push_heap
  let parent = (holeIndex - 1) >> 1;
  while (holeIndex > topIndex && comp(a[first + parent]!, value)) {
    a[first + holeIndex] = a[first + parent]!;
    holeIndex = parent;
    parent = (holeIndex - 1) >> 1;
  }
  a[first + holeIndex] = value;
}

/** `std::stable_sort` with a "less" comparator: JavaScript's sort is stable. */
export function stableSort<T>(a: T[], less: (x: T, y: T) => boolean): void {
  a.sort((x, y) => (less(x, y) ? -1 : less(y, x) ? 1 : 0));
}
