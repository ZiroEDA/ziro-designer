// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from tinyspline, copyright Marcel Steinbeck (MIT).
/**
 * The B-spline half of the DXF SPLINE entity: everything KiCad delegates to
 * `tinyspline` in `DXF_IMPORT_PLUGIN::insertSpline`.
 *
 * Counterpart: `thirdparty/tinyspline_lib/tinyspline.c`, specifically
 * `ts_bspline_new`, `ts_bspline_set_knots`, `ts_bspline_to_beziers` and
 * `ts_bspline_elevate_degree`, plus the validation the C++ wrapper
 * (`tinysplinecxx.cxx`) adds on top. Everything here is called from exactly one
 * place and exists only because a DXF SPLINE is a B-spline while pcbnew's
 * `AddSpline` takes cubic Béziers.
 *
 * What a caller gets back is deliberately *not* "a list of cubic Béziers". It
 * is tinyspline's raw `controlPoints()` array plus its `order()`, because
 * KiCad's reader walks that array with a hard-coded stride of four points and
 * an `order`-sized step. For a spline of degree 4 or more those disagree, and
 * the importer silently keeps only the first four control points of each
 * segment. Handing back a tidy list of cubics would quietly fix that; see
 * `insertSpline` in `dxf_import_plugin.ts`, where the bug is pinned.
 *
 * Two pieces are transcribed rather than copied literally, and both are noted
 * at the site: knot insertion uses the Piegl & Tiller A5.1 formulation of the
 * same Böhm insertion tinyspline implements with pointer arithmetic, and degree
 * elevation is applied per-Bézier *after* decomposition rather than before.
 */

/** `TS_KNOT_EPSILON`. Two knots closer than this are the same knot. */
const TS_KNOT_EPSILON = 1e-4;

/** A tinyspline `tsStatus` failure, which KiCad catches as `std::runtime_error`. */
export class SPLINE_ERROR extends Error {}

const knotsEqual = (x: number, y: number): boolean => Math.abs(x - y) < TS_KNOT_EPSILON;

/** One control point, `dim` coordinates wide. */
type Point = number[];

interface BSpline {
  deg: number;
  dim: number;
  /** Control points, one array per point. */
  ctrlp: Point[];
  knots: number[];
}

const order = (s: BSpline): number => s.deg + 1;

/** `ts_bspline_domain`: the parameter range the curve is actually defined on. */
const domain = (s: BSpline): [number, number] => [
  s.knots[s.deg]!,
  s.knots[s.knots.length - order(s)]!,
];

/**
 * `ts_int_bspline_find_knot`: the index `k` with `u` in `[u_k, u_k+1)` and the
 * multiplicity `s` of `u`.
 *
 * When `u` coincides with an existing knot, `k` is the index of the *last* knot
 * equal to it — that is what makes the multiplicity count below run backwards
 * from `k`. A `u` outside the domain is an error unless it is within epsilon of
 * an end, in which case it is snapped.
 */
function findKnot(s: BSpline, u: number): { u: number; k: number; s: number } {
  const numKnots = s.knots.length;
  const [min, max] = domain(s);
  let knot = u;

  if (knot < min) {
    if (knotsEqual(knot, min)) knot = min;
    else throw new SPLINE_ERROR(`knot (${knot}) < min(domain) (${min})`);
  } else if (knot > max && !knotsEqual(knot, max)) {
    throw new SPLINE_ERROR(`knot (${knot}) > max(domain) (${max})`);
  }

  let idx: number;

  if (knotsEqual(knot, s.knots[numKnots - 1]!)) {
    idx = numKnots - 1;
  } else {
    let low = 0;
    let high = numKnots - 1;
    idx = Math.trunc((low + high) / 2);

    while (knot < s.knots[idx]! || knot >= s.knots[idx + 1]!) {
      if (knot < s.knots[idx]!) high = idx;
      else low = idx;

      idx = Math.trunc((low + high) / 2);
    }
  }

  // Handle floating point errors: walk forward over knots that are equal within
  // epsilon but not bit-identical.
  while (idx < numKnots - 1 && knotsEqual(knot, s.knots[idx + 1]!)) idx++;

  if (knotsEqual(knot, s.knots[idx]!)) knot = s.knots[idx]!;

  let mult = s.deg + 1;

  for (; mult > 0; mult--) {
    if (knotsEqual(knot, s.knots[idx - (mult - 1)]!)) break;
  }

  return { u: knot, k: idx, s: mult };
}

/**
 * Insert the knot `u` into `sp` `n` times.
 *
 * `ts_int_bspline_insert_knot`, with the de Boor net held as a list of levels
 * instead of one flat buffer walked by decreasing strides. The maths is Böhm
 * insertion either way; the levels make the three copy phases below readable.
 *
 * Note that `n` may take the multiplicity all the way up to `order`, one more
 * than the textbook A5.1 allows — that is precisely a *split*, where the last
 * level of the net is a single point that becomes both the end of one segment
 * and the start of the next.
 *
 * Level 0 of the net is the `N = deg - s + 1` control points the knot affects;
 * level `r` has one fewer, each a weighted pair from the level above. The result
 * is then the untouched prefix, the *first* point of levels 0…n-1, whatever
 * remains of level n, the *last* point of levels n-1…0, and the untouched
 * suffix.
 */
function insertKnot(sp: BSpline, u: number, n: number): BSpline {
  const found = findKnot(sp, u);
  const k = found.k;
  const s = found.s;
  const knot = found.u;

  if (s + n > order(sp))
    throw new SPLINE_ERROR(`multiplicity(${knot}) (${s}) + ${n} > order (${order(sp)})`);

  if (n === 0) return { ...sp, ctrlp: sp.ctrlp.map((p) => [...p]), knots: [...sp.knots] };

  const deg = sp.deg;
  const dim = sp.dim;
  const U = sp.knots;
  const P = sp.ctrlp;

  const fst = k - deg; // first affected control point, inclusive
  const lst = k - s; // last affected control point, inclusive
  const N = lst - fst + 1;
  const h = deg < s ? 0 : deg - s; // number of insertions the net supports

  const levels: Point[][] = [];

  levels.push(P.slice(fst, lst + 1).map((q) => [...q]));

  for (let r = 1; r <= h; r++) {
    const prev = levels[r - 1]!;
    const level: Point[] = [];

    for (let j = 0; j < N - r; j++) {
      const i = fst + r + j;
      const ui = U[i]!;
      const a = (knot - ui) / (U[i + deg - r + 1]! - ui);
      const aHat = 1.0 - a;

      const point: Point = [];

      for (let d = 0; d < dim; d++) point.push(aHat * prev[j]![d]! + a * prev[j + 1]![d]!);

      level.push(point);
    }

    levels.push(level);
  }

  const Q: Point[] = [];

  for (let i = 0; i < fst; i++) Q.push([...P[i]!]);

  // The first point of each of the first n levels.
  for (let t = 0; t < n; t++) Q.push([...levels[t]![0]!]);

  // Whatever level n still has, when the insertion stopped short of a split.
  const middle = levels[n];

  if (middle !== undefined) {
    for (let j = 0; j < N - n; j++) Q.push([...middle[j]!]);
  }

  // The last point of the same levels, walked back out again.
  for (let t = 0; t < n; t++) {
    const level = levels[n - 1 - t]!;

    Q.push([...level[level.length - 1]!]);
  }

  for (let i = lst + 1; i < P.length; i++) Q.push([...P[i]!]);

  const UQ: number[] = [];

  for (let i = 0; i <= k; i++) UQ.push(U[i]!);
  for (let i = 0; i < n; i++) UQ.push(knot);
  for (let i = k + 1; i < U.length; i++) UQ.push(U[i]!);

  return { deg: sp.deg, dim: sp.dim, ctrlp: Q, knots: UQ };
}

/**
 * `ts_bspline_split`: raise the multiplicity of `u` to a full `order`, so the
 * curve comes apart there, and report the index of the last knot equal to `u`.
 */
function split(sp: BSpline, u: number): { spline: BSpline; k: number } {
  const found = findKnot(sp, u);

  if (found.s === order(sp))
    return {
      spline: { ...sp, ctrlp: sp.ctrlp.map((p) => [...p]), knots: [...sp.knots] },
      k: found.k,
    };

  const h = sp.deg < found.s ? 0 : sp.deg - found.s;

  return { spline: insertKnot(sp, u, h + 1), k: found.k + h + 1 };
}

/**
 * `ts_int_bspline_resize`, restricted to the two shrinking calls
 * `ts_bspline_to_beziers` makes — dropping `-n` control points and knots from
 * the front (`aBack` false) or the back (`aBack` true).
 *
 * A growing resize is only used by degree elevation, which is handled
 * differently here, so a positive `n` would be a porting mistake rather than
 * something to support.
 */
function resize(sp: BSpline, n: number, aBack: boolean): BSpline {
  if (n === 0) return { ...sp, ctrlp: sp.ctrlp.map((p) => [...p]), knots: [...sp.knots] };

  if (n > 0) throw new SPLINE_ERROR(`unsupported growing resize by ${n}`);

  const numCtrlp = sp.ctrlp.length + n;
  const numKnots = sp.knots.length + n;

  if (aBack) {
    return {
      deg: sp.deg,
      dim: sp.dim,
      ctrlp: sp.ctrlp.slice(0, numCtrlp).map((p) => [...p]),
      knots: sp.knots.slice(0, numKnots),
    };
  }

  return {
    deg: sp.deg,
    dim: sp.dim,
    ctrlp: sp.ctrlp.slice(-n).map((p) => [...p]),
    knots: sp.knots.slice(-n),
  };
}

/**
 * `ts_bspline_to_beziers`: split at every knot until the curve is a plain
 * sequence of Bézier segments of `order` control points each.
 *
 * The first two steps only fire for an *unclamped* spline, whose first and last
 * control points are not on the curve; a DXF written by any real CAD tool is
 * clamped and skips both.
 */
function toBeziers(spline: BSpline): BSpline {
  const deg = spline.deg;
  const ord = order(spline);

  let tmp: BSpline = {
    ...spline,
    ctrlp: spline.ctrlp.map((p) => [...p]),
    knots: [...spline.knots],
  };

  // Fix first control point if necessary.
  const uMin = tmp.knots[deg]!;

  if (!knotsEqual(tmp.knots[0]!, uMin)) {
    const r = split(tmp, uMin);
    tmp = resize(r.spline, -deg + (deg * 2 - r.k), false);
  }

  // Fix last control point if necessary.
  const uMax = tmp.knots[tmp.knots.length - ord]!;

  if (!knotsEqual(tmp.knots[tmp.knots.length - 1]!, uMax)) {
    const r = split(tmp, uMax);
    tmp = resize(r.spline, -deg + (r.k - (r.spline.knots.length - ord)), true);
  }

  // Split internal knots.
  let k = ord;

  while (k < tmp.knots.length - ord) {
    const r = split(tmp, tmp.knots[k]!);
    tmp = r.spline;
    k = r.k + 1;
  }

  return tmp;
}

/**
 * `ts_bspline_elevate_degree`, applied to a curve already in Bézier form.
 *
 * Upstream elevates first and decomposes afterwards; the order is swapped here
 * because tinyspline's own elevation *starts* by calling `ts_bspline_to_beziers`
 * and then runs exactly this per-segment formula. Its closing "combine bezier
 * curves" pass drops the duplicated joint control point between consecutive
 * segments — and KiCad's following `toBeziers()` call immediately puts it back,
 * so the two cancel and the control points that reach `insertSpline` are these.
 *
 * The formula is standard Bézier elevation: the last control point is copied to
 * a new final slot, then every interior point is replaced walking *backwards*,
 * so each read still sees the un-elevated neighbour.
 */
function elevateBezier(aSegment: Point[], aDim: number): Point[] {
  const ord = aSegment.length;
  const out = aSegment.map((p) => [...p]);

  out.push([...aSegment[ord - 1]!]);

  for (let c = ord - 1; c > 0; c--) {
    const f = c / ord;
    const fHat = 1 - f;

    for (let d = 0; d < aDim; d++) out[c]![d] = f * out[c - 1]![d]! + fHat * out[c]![d]!;
  }

  return out;
}

/**
 * The whole of what `insertSpline` needs: validate the spline as tinyspline
 * would, elevate it to at least degree 3, decompose it into Bézier segments and
 * hand back the flat control-point array and the segment size.
 *
 * @param aCtrlp flat control points, `aDim` values per point.
 * @param aKnots the knot vector, which must be exactly `aCtrlp/aDim + degree + 1` long.
 * @throws SPLINE_ERROR for anything tinyspline would reject.
 */
export function bsplineToBeziers(
  aCtrlp: number[],
  aKnots: number[],
  aDegree: number,
  aDim = 2,
): { coords: number[]; order: number } {
  const numCtrlp = Math.trunc(aCtrlp.length / aDim);

  // `ts_bspline_new`: a curve needs at least `order` control points to exist.
  if (aDegree >= numCtrlp)
    throw new SPLINE_ERROR(`deg (${aDegree}) >= num(control_points) (${numCtrlp})`);

  // The C++ wrapper's `setControlPoints`/`setKnots` size checks.
  if (aCtrlp.length !== numCtrlp * aDim)
    throw new SPLINE_ERROR(`expected size: ${numCtrlp * aDim}, actual size: ${aCtrlp.length}`);

  const numKnots = numCtrlp + aDegree + 1;

  if (aKnots.length !== numKnots)
    throw new SPLINE_ERROR(`expected size: ${numKnots}, actual size: ${aKnots.length}`);

  validateKnots(aKnots, aDegree + 1);

  const points: Point[] = [];

  for (let i = 0; i < numCtrlp; i++) points.push(aCtrlp.slice(i * aDim, i * aDim + aDim));

  let spline: BSpline = { deg: aDegree, dim: aDim, ctrlp: points, knots: [...aKnots] };

  spline = toBeziers(spline);

  let ord = order(spline);
  let segments: Point[][] = [];

  for (let i = 0; i * ord < spline.ctrlp.length; i++)
    segments.push(spline.ctrlp.slice(i * ord, i * ord + ord));

  // Elevate to cubic, one degree at a time as tinyspline does. A spline that is
  // already cubic or higher is left alone — including the degree-4-and-up case
  // the caller then mis-reads.
  while (ord < 4) {
    segments = segments.map((seg) => elevateBezier(seg, aDim));
    ord++;
  }

  const coords: number[] = [];

  for (const seg of segments) {
    for (const p of seg) coords.push(...p);
  }

  return { coords, order: ord };
}

/**
 * `ts_bspline_set_knots`' validation.
 *
 * The running multiplicity counter is reset to **0**, not 1, whenever the knot
 * value changes — tinyspline's own off-by-one. The effect is that only the very
 * first run in the vector is measured correctly, and every later run has to be
 * one longer than `order` before it is rejected. Reproduced: tightening it
 * would refuse files tinyspline accepts.
 */
function validateKnots(aKnots: number[], aOrder: number): void {
  let lastKnot = aKnots[0]!;
  let mult = 1;

  for (let idx = 1; idx < aKnots.length; idx++) {
    const knot = aKnots[idx]!;

    if (knotsEqual(lastKnot, knot)) mult++;
    else if (lastKnot > knot) throw new SPLINE_ERROR(`decreasing knot vector at index: ${idx}`);
    else mult = 0;

    if (mult > aOrder) throw new SPLINE_ERROR(`mult(${knot}) (${mult}) > order (${aOrder})`);

    lastKnot = knot;
  }
}
