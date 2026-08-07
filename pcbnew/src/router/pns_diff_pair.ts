// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The coupled-pair model, and the gateway generation that decides how a
 * differential pair leaves a pad or a via.
 * Counterparts: `pcbnew/router/pns_diff_pair.h` and `pns_diff_pair.cpp`
 * (`DIFF_PAIR`, `DP_GATEWAY`, `DP_PRIMITIVE_PAIR`, `DP_GATEWAYS`).
 *
 * A **gateway** is a pair of points with an orientation, a spacing, and
 * optionally a pair of lead-in paths. The pair placer connects two of them with
 * parallel 45° lines and that is the route. Which gateways exist, and in what
 * order they are preferred, is therefore the whole of the pair's escape
 * geometry: get a priority wrong and every pair on the board leaves its pads
 * the wrong way, silently and plausibly.
 *
 * Nothing here touches `NODE` — upstream's file does not either, which is why
 * this can land ahead of the rest of the router.
 *
 * ## Why these are classes
 *
 * `pns_chain.ts` / `pns_line.ts` model geometry as plain arrays and pure
 * functions, and that is right for a polyline, which has no identity. All four
 * types here are the other kind. `DP_GATEWAYS` accumulates into a vector across
 * a dozen build calls and then filters it in place; `DP_GATEWAY` is mutated
 * after construction (`SetPriority`, `SetEntryLines`, `Reverse`);
 * `DP_PRIMITIVE_PAIR` owns *clones* of two items; and `DIFF_PAIR` is an `ITEM`
 * with links, nets and cached `LINE`s. Their chains, on the other hand, are the
 * established `Chain = Vec2[]`.
 *
 * ## Arcs are not representable, and that is a real (small) gap
 *
 * Every chain this module *produces* comes from `DIRECTION_45::BuildInitialTrace`
 * or a two/three point literal, so none of them can be an arc. Two upstream
 * lines therefore become no-ops here: the `IsArcSegment` skip in
 * {@link DiffPair.coupledSegmentPairs} and the arc term in
 * `SHAPE_LINE_CHAIN::Length`. A `DIFF_PAIR` assembled out of *board* tracks that
 * contain arcs — which nothing in this change does, but
 * `DIFF_PAIR::EndingPrimitives`' caller eventually could — would measure an
 * arc's chord rather than the arc. Flagged rather than papered over.
 *
 * ## Exact integer arithmetic, and what is deliberately not exact
 *
 * Gateway anchors are answers, not rankings, so the arithmetic that produces
 * them is upstream's integer arithmetic: {@link segIntersectLines}, the
 * imported `segLineProject`, and `ResizeI` all round the way `rescale( int64 )`
 * rounds, in BigInt where the products pass 2^53. The floating-point
 * `intersectLines` in `pns_line.ts` and `resize` in `drc/shape_collisions.ts`
 * are left alone; both are documented in their own files as the shortcut, and
 * both have callers that only compare candidates.
 *
 * `SEG::LineProject`, `SEG::Contains`, `SEG::ApproxParallel` and the int64
 * `rescale` come from `pns_seg_ops.ts` rather than being written again here.
 * Its `segLength` is the one thing deliberately *not* reused, and the note on
 * this module's own `segLength` says why in full.
 *
 * Two reused pieces are *not* bit-exact and are reused anyway, because forking
 * them would be worse:
 *
 *  - `segSquaredDistanceToSeg` (`drc/shape_collisions.ts`) computes its last
 *    term in double where upstream rounds to an integer. It is read here
 *    through `checkGap`'s `gap - 100` slack and through a ±10000 tolerance
 *    band, so a sub-unit difference in a *squared* quantity cannot change
 *    either answer.
 *  - `commonParallelProjection` (`drc/drc_diff_pair.ts`) is upstream's own
 *    duplicate of the routine in this file — `drc_test_provider_diff_pair_coupling.cpp:66`
 *    is a verbatim static copy of `pns_diff_pair.cpp:786` — so reusing it is
 *    structurally exact. Its clip points round with `Math.round` where upstream
 *    uses `rescale`; the two differ only on a negative half.
 *
 * ## Not ported
 *
 * `pns_diff_pair_placer.cpp` (it drives a `NODE`) and the dimensions dialog.
 * `DIFF_PAIR::Chamfer` does not exist in this KiCad revision — there is no
 * `Chamfer` member anywhere under `pcbnew/router/` — so nothing stands in for
 * it. `DP_CANDIDATE`'s `gw_p`/`gw_n`/`score` fields are never read upstream and
 * are dropped.
 */
import { AngleType, Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import {
  EuclideanNormI,
  Perpendicular,
  ResizeI,
  divideI,
} from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { commonParallelProjection } from '../drc/drc_diff_pair.js';
import { segSquaredDistanceToSeg } from '../drc/shape_collisions.js';
import { PnsKind, PnsLinkHolder, type PnsItem } from './pns_item.js';
import { PnsLine, PnsLineChain } from './pns_line_item.js';
import { appendChain, csegment, reverse, segmentCount, type Chain, type Seg } from './pns_line.js';
import { rescale64, segApproxParallel, segContains, segLineProject } from './pns_seg_ops.js';
import { PnsSegment } from './pns_segment.js';
import { PnsVia } from './pns_via.js';
import { RangedNum } from './ranged_num.js';
import type { NetHandle } from './pns_collision.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ---------------------------------------------------------------------------
// Small vector helpers, matching the C++ operators exactly.

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
// `|| 0` only normalises JavaScript's negative zero, which C++'s integer
// negation cannot produce and which compares unequal under a structural assert.
const neg = (a: Vec2): Vec2 => ({ x: -a.x || 0, y: -a.y || 0 });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k || 0, y: a.y * k || 0 });
const equal = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const big = (v: number): bigint => BigInt(v);
/** `a.Cross( b )` in int64. */
const crossB = (a: Vec2, b: Vec2): bigint => big(a.x) * big(b.y) - big(a.y) * big(b.x);
const absB = (v: bigint): bigint => (v < 0n ? -v : v);

/** `(A + B) / 2`, i.e. `VECTOR2I::operator/( double )` — KiROUND, not truncation. */
const midpoint = (a: Vec2, b: Vec2): Vec2 => divideI(add(a, b), 2);

/**
 * `isqrt` (seg.cpp:57): the largest integer whose square does not exceed `x`.
 *
 * Upstream corrects the `double` square root up and down until `r*r <= x`;
 * `Math.floor` is that answer directly for every value a squared distance can
 * take here.
 */
const isqrt = (x: number): number => Math.floor(Math.sqrt(x));

// ---------------------------------------------------------------------------
// SEG, in exact integer arithmetic.
//
// `pns_seg_ops.ts` already carries `SEG::LineProject`, `SEG::Contains`,
// `SEG::ApproxParallel` and the int64 `rescale`, so those are imported. What is
// added below is the three members it does not have — `Collinear`,
// `IntersectLines` and `Intersect` — plus the chain queries built on them. They
// live here rather than in `pns_line.ts` because that module's `Seg` helpers are
// the *drag* geometry's: floating point, and documented as such. `Seg` itself is
// the type from there, so every one of these mixes freely with both.

/**
 * `SEG::Length()` = `(A - B).EuclideanNorm()`.
 *
 * NOT `segLength` from `pns_seg_ops.ts`, and the difference is a real one.
 * `VECTOR2<int>::EuclideanNorm()` (vector2d.h:279) **rounds** — its return type
 * is already `T = int` and the body is `KiROUND( std::hypot( x, y ) )` — and it
 * short-cuts the 45° case as `KiROUND( |x| * √2 )`. `pns_seg_ops.ts` truncates
 * instead, on the reading that `int Length()` truncates the double; there is no
 * double left to truncate by then. The two disagree by one unit whenever the
 * hypotenuse's fraction reaches 0.5 — a (2,3) segment is 4 upstream and 3 there.
 *
 * This module cannot use the truncating one: `Skew()` is a *difference* of two
 * chain lengths, so a systematic one-unit-per-segment bias does not cancel, and
 * `CoupledLength` sums it over every coupled stretch.
 *
 * Rather than add a third implementation, this defers to `EuclideanNormI` in
 * `libs/kimath` — the shared primitive both should have been written on.
 */
const segLength = (s: Seg): number => EuclideanNormI(sub(s.a, s.b));

/**
 * `SEG::Collinear`: both of `other`'s endpoints within 1 IU of *this* segment's
 * infinite line, measured by the unnormalised canonical form.
 *
 * Unnormalised is the point: the tolerance is `|qa·x + qb·y + qc| <= 1` with
 * `qa`/`qb` the raw coordinate differences, so it tightens as the segment gets
 * longer. `BuildGeneric` relies on that — its probe segments are exactly 200
 * units long, which makes "collinear" mean "within about 1/200 of a unit of
 * offset", i.e. exactly aligned.
 */
export function segCollinear(s: Seg, other: Seg): boolean {
  const qa = big(s.a.y) - big(s.b.y);
  const qb = big(s.b.x) - big(s.a.x);
  const qc = -qa * big(s.a.x) - qb * big(s.a.y);

  const d1 = absB(big(other.a.x) * qa + big(other.a.y) * qb + qc);
  const d2 = absB(big(other.b.x) * qa + big(other.b.y) * qb + qc);

  return d1 <= 1n && d2 <= 1n;
}

/**
 * `SEG::IntersectLines`: where the two *infinite* lines meet, or null.
 *
 * Upstream's `intersects( aLines = true )` skips the parameter-range checks and
 * has one branch that reads like a placeholder and is load bearing: two
 * **collinear** lines meet everywhere, and rather than answer null it answers
 * the midpoint between the two `A` endpoints (or the degenerate segment's own
 * point when one of them is a point). `BuildGeneric` calls this on probe pairs
 * that are collinear whenever the two pad anchors line up, which is the common
 * case — and then discards the result with an explicit `Collinear` test of its
 * own. Getting this branch "right" by returning null would change nothing
 * there and would change `BuildOrthoProjections`.
 */
export function segIntersectLines(s: Seg, other: Seg): Vec2 | null {
  const dir1 = sub(s.b, s.a);
  const dir2 = sub(other.b, other.a);
  const offset = sub(other.a, s.a);
  const determinant = crossB(dir2, dir1);

  if (determinant === 0n) {
    if (crossB(dir1, offset) !== 0n) return null; // parallel, not collinear

    if (equal(other.a, other.b)) return { ...other.a };
    if (equal(s.a, s.b)) return { ...s.a };

    return midpoint(s.a, other.a);
  }

  const param1Num = crossB(dir1, offset);

  return {
    x: other.a.x + Number(rescale64(param1Num, big(dir2.x), determinant)),
    y: other.a.y + Number(rescale64(param1Num, big(dir2.y), determinant)),
  };
}

/**
 * `SEG::checkCollinearOverlap`, the branch `intersects` takes for two collinear
 * segments: the midpoint of the overlap, lifted back onto the line.
 *
 * `aIgnoreEndpoints` rejects an overlap that is a single shared endpoint, which
 * is how `SelfIntersecting` avoids reporting every corner of a polyline.
 */
function checkCollinearOverlap(
  s: Seg,
  other: Seg,
  useXAxis: boolean,
  ignoreEndpoints: boolean,
): Vec2 | null {
  const pick = (p: Vec2): number => (useXAxis ? p.x : p.y);
  const off = (p: Vec2): number => (useXAxis ? p.y : p.x);

  const seg1Start = pick(s.a);
  const seg1End = pick(s.b);
  const coord1Start = off(s.a);
  const coord1End = off(s.b);

  const seg1Min = Math.min(seg1Start, seg1End);
  const seg1Max = Math.max(seg1Start, seg1End);
  const seg2Min = Math.min(pick(other.a), pick(other.b));
  const seg2Max = Math.max(pick(other.a), pick(other.b));

  if (!(seg1Max >= seg2Min && seg2Max >= seg1Min)) return null;

  const overlapStart = Math.max(seg1Min, seg2Min);
  const overlapEnd = Math.min(seg1Max, seg2Max);

  // A single shared point is an overlap of zero extent.
  if (ignoreEndpoints && overlapStart === overlapEnd) return null;

  const proj = (overlapStart + overlapEnd) / 2;
  const other1 =
    seg1End !== seg1Start
      ? coord1Start + ((proj - seg1Start) * (coord1End - coord1Start)) / (seg1End - seg1Start)
      : coord1Start;

  return useXAxis ? { x: proj, y: other1 } : { x: other1, y: proj };
}

/**
 * `SEG::Intersect`: the crossing point when it lies on **both** closed
 * segments, or null.
 *
 * `aIgnoreEndpoints` drops a crossing that is an endpoint of both — the shared
 * corner of two consecutive polyline segments.
 */
export function segIntersect(s: Seg, other: Seg, ignoreEndpoints = false): Vec2 | null {
  if (
    Math.max(s.a.x, s.b.x) < Math.min(other.a.x, other.b.x) ||
    Math.max(other.a.x, other.b.x) < Math.min(s.a.x, s.b.x) ||
    Math.max(s.a.y, s.b.y) < Math.min(other.a.y, other.b.y) ||
    Math.max(other.a.y, other.b.y) < Math.min(s.a.y, s.b.y)
  ) {
    return null;
  }

  const dir1 = sub(s.b, s.a);
  const dir2 = sub(other.b, other.a);
  const offset = sub(other.a, s.a);
  const determinant = crossB(dir2, dir1);

  if (determinant === 0n) {
    if (crossB(dir1, offset) !== 0n) return null;

    const useXAxis = Math.abs(dir1.x) >= Math.abs(dir1.y);

    return checkCollinearOverlap(s, other, useXAxis, ignoreEndpoints);
  }

  const param2Num = crossB(dir2, offset);
  const param1Num = crossB(dir1, offset);

  if (determinant > 0n) {
    if (param1Num < 0n || param1Num > determinant || param2Num < 0n || param2Num > determinant) {
      return null;
    }
  } else if (
    param1Num > 0n ||
    param1Num < determinant ||
    param2Num > 0n ||
    param2Num < determinant
  ) {
    return null;
  }

  if (
    ignoreEndpoints &&
    (param1Num === 0n || param1Num === determinant) &&
    (param2Num === 0n || param2Num === determinant)
  ) {
    return null;
  }

  return {
    x: other.a.x + Number(rescale64(param1Num, big(dir2.x), determinant)),
    y: other.a.y + Number(rescale64(param1Num, big(dir2.y), determinant)),
  };
}

/** `SEG::Distance( const SEG& )` = `isqrt( SquaredDistance( aSeg ) )`. */
export const segDistance = (s: Seg, other: Seg): number => isqrt(segSquaredDistanceToSeg(s, other));

// ---------------------------------------------------------------------------
// SHAPE_LINE_CHAIN, over `Chain = Vec2[]`.

/**
 * `SHAPE_LINE_CHAIN::Length()`: the sum of the **integer** segment lengths.
 *
 * Not `chainLength` from `pns_line.ts`, which sums `Math.hypot` in double. That
 * one only ever ranks drag candidates against each other. This one is
 * subtracted from another of itself in {@link DiffPair.skew}, where a
 * fractional residue would report a nonzero skew on a pair that is exactly
 * balanced. The arc term upstream adds is absent — see the module note.
 */
export function chainLengthI(c: Chain): number {
  let l = 0;

  for (let i = 0; i < segmentCount(c); i++) l += segLength(csegment(c, i));

  return l;
}

/**
 * `SHAPE_LINE_CHAIN::SelfIntersecting()`, reduced to the yes/no its only caller
 * here wants.
 *
 * Three ways a pair of segments counts, in upstream's order: the later
 * segment's start lying *on* the earlier one (skipped for immediately adjacent
 * segments, whose shared corner always would), its end lying on the earlier one,
 * or a proper crossing with shared endpoints excluded. "Lying on" is
 * `SEG::Contains`, a squared-distance tolerance of 3, so a polyline that
 * doubles back to within a unit of itself is self-intersecting even though
 * nothing strictly crosses.
 *
 * The closed-chain exemption (last segment ending where the first begins) is
 * written out but cannot fire: nothing hands this a closed chain.
 */
export function chainSelfIntersecting(c: Chain, closed = false): boolean {
  const segCount = segmentCount(c);
  const ptCount = c.length;

  if (segCount < 2) return false;

  for (let s1 = 0; s1 < segCount; s1++) {
    const a1 = c[s1] as Vec2;
    const b1 = c[s1 + 1 < ptCount ? s1 + 1 : 0] as Vec2;

    // Expanded by 2 to cover `Contains`' tolerance, as upstream.
    const s1MinX = Math.min(a1.x, b1.x) - 2;
    const s1MaxX = Math.max(a1.x, b1.x) + 2;
    const s1MinY = Math.min(a1.y, b1.y) - 2;
    const s1MaxY = Math.max(a1.y, b1.y) + 2;

    for (let s2 = s1 + 1; s2 < segCount; s2++) {
      const a2 = c[s2] as Vec2;
      const b2 = c[s2 + 1 < ptCount ? s2 + 1 : 0] as Vec2;

      if (s1MaxX < Math.min(a2.x, b2.x) || Math.max(a2.x, b2.x) < s1MinX) continue;
      if (s1MaxY < Math.min(a2.y, b2.y) || Math.max(a2.y, b2.y) < s1MinY) continue;

      const seg1: Seg = { a: a1, b: b1 };

      if (s1 + 1 !== s2 && segContains(seg1, a2)) return true;

      if (segContains(seg1, b2)) {
        if (!(closed && s1 === 0 && s2 === segCount - 1)) return true;
      } else if (segIntersect(seg1, { a: a2, b: b2 }, true) !== null) {
        return true;
      }
    }
  }

  return false;
}

/**
 * `SHAPE_LINE_CHAIN::Intersects( const SHAPE_LINE_CHAIN& )`, i.e.
 * `Intersect( aChain, dummy ) != 0`.
 *
 * Note how weak the test is, because `aExcludeColinearAndTouching` defaults to
 * false: two chains that merely *touch* at a shared endpoint intersect, and two
 * collinear segments intersect as soon as either contains an endpoint of the
 * other. `BuildInitial` uses this to reject a pair whose two lanes cross, and
 * that strictness is why a lane that grazes its partner is rejected too.
 */
export function chainsIntersect(a: Chain, b: Chain): boolean {
  const ourSegCount = segmentCount(a);
  const theirSegCount = segmentCount(b);

  if (ourSegCount === 0 || theirSegCount === 0) return false;

  for (let s1 = 0; s1 < ourSegCount; s1++) {
    const sa = csegment(a, s1);

    for (let s2 = 0; s2 < theirSegCount; s2++) {
      const sb = csegment(b, s2);
      const p = segIntersect(sa, sb);

      if (segCollinear(sa, sb)) {
        if (
          segContains(sa, sb.a) ||
          segContains(sa, sb.b) ||
          segContains(sb, sa.a) ||
          segContains(sb, sa.b)
        ) {
          return true;
        }
      } else if (p !== null) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------

/** `DIRECTION_45::AngleType` of two vectors — the file-static `angle()` helper. */
const angleOf = (a: Vec2, b: Vec2): AngleType =>
  Direction45.fromVector(a).angle(Direction45.fromVector(b));

/**
 * `checkGap`: no segment of one lane may come closer to a segment of the other
 * than `gap - 100`.
 *
 * The 100 IU of slack is upstream's, and it is what lets a 45° corner — where
 * the two lanes necessarily pinch — survive the test.
 */
function checkGap(p: Chain, n: Chain, gap: number): boolean {
  const gapSq = (gap - 100) * (gap - 100);

  for (let i = 0; i < segmentCount(p); i++) {
    for (let j = 0; j < segmentCount(n); j++) {
      if (segSquaredDistanceToSeg(csegment(p, i), csegment(n, j)) < gapSq) return false;
    }
  }

  return true;
}

/**
 * `makeGapVector`: `dir` rescaled so that a *symmetric* pair of it spans at
 * least `length`.
 *
 * Not `Resize( length / 2 )`. Integer rounding can leave `2·Resize(l)` a unit
 * short of `length`, so upstream lengthens by one and retries until it is not —
 * the pair of anchors either side of a gateway must be at least a gap apart,
 * never a nanometre less. The loop is a `do`/`while`, so the first `Resize` is
 * always at `length / 2` (truncated).
 *
 * A zero direction is returned unchanged, and a non-positive `length` exits
 * after one iteration with the zero vector `Resize` gives for a zero (or
 * negative) length.
 */
export function makeGapVector(dir: Vec2, length: number): Vec2 {
  let l = Math.trunc(length / 2);
  let rv: Vec2;

  if (EuclideanNormI(dir) === 0) return { ...dir };

  do {
    rv = ResizeI(dir, l);
    l++;
  } while (EuclideanNormI(scale(rv, 2)) < length);

  return rv;
}

/**
 * `DP_GATEWAY`: a pair of anchors with an orientation, the 45° entry angles it
 * will accept, a matching priority, and optionally the lead-in paths that reach
 * it from a pad.
 */
export class DpGateway {
  private mEntryP: Chain = [];
  private mEntryN: Chain = [];
  private mHasEntryLines = false;
  private readonly mAnchorP: Vec2;
  private readonly mAnchorN: Vec2;
  private readonly mIsDiagonal: boolean;
  private readonly mAllowedEntryAngles: number;
  private mPriority: number;

  constructor(
    aAnchorP: Vec2,
    aAnchorN: Vec2,
    aIsDiagonal: boolean,
    aAllowedEntryAngles: number = AngleType.ANG_OBTUSE,
    aPriority = 0,
  ) {
    this.mAnchorP = { ...aAnchorP };
    this.mAnchorN = { ...aAnchorN };
    this.mIsDiagonal = aIsDiagonal;
    this.mAllowedEntryAngles = aAllowedEntryAngles;
    this.mPriority = aPriority;
  }

  /** A by-value copy, which is what `DP_GATEWAY t( aTarget )` makes. */
  copy(): DpGateway {
    const g = new DpGateway(
      this.mAnchorP,
      this.mAnchorN,
      this.mIsDiagonal,
      this.mAllowedEntryAngles,
      this.mPriority,
    );

    g.mEntryP = this.mEntryP.map((p) => ({ ...p }));
    g.mEntryN = this.mEntryN.map((p) => ({ ...p }));
    g.mHasEntryLines = this.mHasEntryLines;

    return g;
  }

  /** True when the gateway's two anchors lie on a diagonal line. */
  isDiagonal(): boolean {
    return this.mIsDiagonal;
  }

  anchorP(): Vec2 {
    return this.mAnchorP;
  }

  anchorN(): Vec2 {
    return this.mAnchorN;
  }

  /** A mask of the 45° entry directions the gateway allows. */
  allowedAngles(): number {
    return this.mAllowedEntryAngles;
  }

  priority(): number {
    return this.mPriority;
  }

  setPriority(aPriority: number): void {
    this.mPriority = aPriority;
  }

  /** Note this sets `hasEntryLines` even when one of the two chains is empty. */
  setEntryLines(aEntryP: Chain, aEntryN: Chain): void {
    this.mEntryP = aEntryP.map((p) => ({ ...p }));
    this.mEntryN = aEntryN.map((p) => ({ ...p }));
    this.mHasEntryLines = true;
  }

  entryP(): Chain {
    return this.mEntryP;
  }

  entryN(): Chain {
    return this.mEntryN;
  }

  /** The lead-in paths as a pair. The gap constraint is 0, tolerances included. */
  entry(): DiffPair {
    return new DiffPair(this.mEntryP, this.mEntryN, 0);
  }

  /**
   * Reverse both lead-ins, in place. Unconditional: an empty chain reverses to
   * an empty chain, and `hasEntryLines` is deliberately not cleared.
   */
  reverse(): void {
    this.mEntryN = reverse(this.mEntryN);
    this.mEntryP = reverse(this.mEntryP);
  }

  hasEntryLines(): boolean {
    return this.mHasEntryLines;
  }
}

/**
 * `DP_PRIMITIVE_PAIR`: the two board things a pair starts or ends on — a pair
 * of pads, of vias, or of track ends.
 *
 * It owns *clones*, as upstream does, so a pair outlives the node the originals
 * came from.
 */
export class DpPrimitivePair {
  private readonly mPrimP: PnsItem | null;
  private readonly mPrimN: PnsItem | null;
  private mAnchorP: Vec2;
  private mAnchorN: Vec2;

  private constructor(aPrimP: PnsItem | null, aPrimN: PnsItem | null, aP: Vec2, aN: Vec2) {
    this.mPrimP = aPrimP;
    this.mPrimN = aPrimN;
    this.mAnchorP = aP;
    this.mAnchorN = aN;
  }

  /** `DP_PRIMITIVE_PAIR( ITEM*, ITEM* )`: clone both, anchor at `Anchor( 0 )`. */
  static fromItems(aPrimP: PnsItem, aPrimN: PnsItem): DpPrimitivePair {
    const p = aPrimP.clone();
    const n = aPrimN.clone();

    return new DpPrimitivePair(p, n, { ...p.anchor(0) }, { ...n.anchor(0) });
  }

  /** `DP_PRIMITIVE_PAIR( const VECTOR2I&, const VECTOR2I& )`: no primitives. */
  static fromAnchors(aAnchorP: Vec2, aAnchorN: Vec2): DpPrimitivePair {
    return new DpPrimitivePair(null, null, { ...aAnchorP }, { ...aAnchorN });
  }

  /** The copy constructor: the primitives are cloned again. */
  copy(): DpPrimitivePair {
    return new DpPrimitivePair(
      this.mPrimP ? this.mPrimP.clone() : null,
      this.mPrimN ? this.mPrimN.clone() : null,
      { ...this.mAnchorP },
      { ...this.mAnchorN },
    );
  }

  setAnchors(aAnchorP: Vec2, aAnchorN: Vec2): void {
    this.mAnchorP = { ...aAnchorP };
    this.mAnchorN = { ...aAnchorN };
  }

  anchorP(): Vec2 {
    return this.mAnchorP;
  }

  anchorN(): Vec2 {
    return this.mAnchorN;
  }

  primP(): PnsItem | null {
    return this.mPrimP;
  }

  primN(): PnsItem | null {
    return this.mPrimN;
  }

  /**
   * Is the pair leaving along an existing track? Note that **only `primP`** is
   * consulted, upstream included — a P-side segment paired with an N-side pad
   * reports directional.
   */
  directional(): boolean {
    if (!this.mPrimP) return false;

    return this.mPrimP.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T);
  }

  /**
   * `anchorDirection`: the direction pointing *out* of the anchor, away from
   * the primitive's far end. Anything that is not a segment or an arc has no
   * direction at all.
   */
  private anchorDirection(aItem: PnsItem | null, aP: Vec2): Direction45 {
    if (!aItem || !aItem.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) return Direction45.UNDEFINED;

    return equal(aItem.anchor(0), aP)
      ? Direction45.fromVector(sub(aItem.anchor(0), aItem.anchor(1)))
      : Direction45.fromVector(sub(aItem.anchor(1), aItem.anchor(0)));
  }

  dirP(): Direction45 {
    return this.anchorDirection(this.mPrimP, this.mAnchorP);
  }

  dirN(): Direction45 {
    return this.anchorDirection(this.mPrimN, this.mAnchorN);
  }

  /**
   * Where the pair's midpoint is and which way it is heading, given a cursor.
   *
   * Two segments running parallel hand back their own direction, resized to the
   * distance between the two anchor points — the pair keeps its spacing and its
   * heading. Anything else falls back to the perpendicular of the anchor-to-
   * anchor line, flipped if need be so it points at the cursor.
   *
   * Upstream oddity, reproduced: when both primitives *are* segments but are
   * **not** parallel, the `else` that would re-read `Anchor( 0 )` is not taken,
   * so the fallback runs on the `Anchor( 1 )` values the parallel branch had
   * already loaded.
   */
  cursorOrientation(aCursorPos: Vec2): { midpoint: Vec2; direction: Vec2 } {
    if (!this.mPrimP || !this.mPrimN) {
      throw new Error('PNS: DP_PRIMITIVE_PAIR::CursorOrientation() with no primitives');
    }

    let aP: Vec2;
    let aN: Vec2;

    if (this.mPrimP.ofKind(PnsKind.SEGMENT_T) && this.mPrimN.ofKind(PnsKind.SEGMENT_T)) {
      aP = this.mPrimP.anchor(1);
      aN = this.mPrimN.anchor(1);

      const segP = (this.mPrimP as PnsSegment).seg();
      const segN = (this.mPrimN as PnsSegment).seg();

      if (!equal(segP.b, segP.a) && !equal(segN.b, segN.a) && segApproxParallel(segP, segN)) {
        const m = midpoint(aP, aN);

        return {
          midpoint: m,
          direction: ResizeI(sub(segP.b, segP.a), EuclideanNormI(sub(aP, aN))),
        };
      }
    } else {
      aP = this.mPrimP.anchor(0);
      aN = this.mPrimN.anchor(0);
    }

    const m = midpoint(aP, aN);
    let direction = Perpendicular(sub(aP, aN));

    if (dot(direction, sub(aCursorPos, m)) < 0) direction = neg(direction);

    return { midpoint: m, direction };
  }
}

/** One stretch over which the two lanes of a pair genuinely run together. */
export interface CoupledSegments {
  coupledP: Seg;
  coupledN: Seg;
  parentP: Seg;
  parentN: Seg;
  indexP: number;
  indexN: number;
}

/**
 * `DIFF_PAIR`: two lines, the gap between them, and the coupling constraint
 * that says how far the gap may stray before they stop counting as a pair.
 */
export class DiffPair extends PnsLinkHolder {
  private mN: Chain = [];
  private mP: Chain = [];
  private mLineP = new PnsLine();
  private mLineN = new PnsLine();
  private mViaP = new PnsVia();
  private mViaN = new PnsVia();
  private mHasVias = false;
  private mNetP: NetHandle = null;
  private mNetN: NetHandle = null;
  private mWidth = 0;
  private mGap = 0;
  private mViaGap = 0;
  private mMaxUncoupledLength = 0;
  private mChamferLimit = 0;
  private mGapConstraint = new RangedNum();

  /**
   * `DIFF_PAIR()`, `DIFF_PAIR( aGap )` and
   * `DIFF_PAIR( aP, aN, aGap = 0 )` folded into one signature.
   *
   * Note what a gap argument does — and does not — do: it sets the *constraint*
   * value and leaves the tolerances at zero, while `m_gap` itself stays 0. Only
   * {@link setGap} builds the ±10000 band. `DP_GATEWAYS::FitGateways` and
   * `DP_GATEWAY::Entry` both rely on the difference.
   */
  constructor(aP?: Chain, aN?: Chain, aGap?: number) {
    super(PnsKind.DIFF_PAIR_T);

    if (aP) this.mP = aP.map((p) => ({ ...p }));
    if (aN) this.mN = aN.map((p) => ({ ...p }));
    if (aGap !== undefined) this.mGapConstraint = this.mGapConstraint.withValue(aGap);
  }

  /** `DIFF_PAIR( aGap )`. */
  static withGap(aGap: number): DiffPair {
    return new DiffPair(undefined, undefined, aGap);
  }

  static classOf(aItem: PnsItem | null): boolean {
    return aItem !== null && aItem.kind() === PnsKind.DIFF_PAIR_T;
  }

  /** Upstream asserts and returns nullptr; a pair is not clonable. */
  clone(): DiffPair {
    throw new Error('PNS: DIFF_PAIR::Clone() is not supported');
  }

  /**
   * `DIFF_PAIR( const DIFF_PAIR& )`, the *implicit* copy constructor — a
   * different thing from {@link clone}, which is the `ITEM` virtual upstream
   * asserts in.
   *
   * `DP_MEANDER_PLACER::Move` copies the origin pair by value and re-shapes the
   * copy, so the copy has to carry the gap *constraint* the coupling search
   * runs on. Rebuilding one with {@link setGap} would not do: that always
   * produces a ±10000 band, and the band the copied pair needs is whichever one
   * it was assembled with.
   */
  static copyOf(aOther: DiffPair): DiffPair {
    const p = new DiffPair();

    p.copyFrom(aOther);
    p.copyLinks(aOther);

    p.mP = aOther.mP.map((v) => ({ ...v }));
    p.mN = aOther.mN.map((v) => ({ ...v }));
    p.mLineP = aOther.mLineP.clone();
    p.mLineN = aOther.mLineN.clone();
    p.mViaP = aOther.mViaP;
    p.mViaN = aOther.mViaN;
    p.mHasVias = aOther.mHasVias;
    p.mNetP = aOther.mNetP;
    p.mNetN = aOther.mNetN;
    p.mWidth = aOther.mWidth;
    p.mGap = aOther.mGap;
    p.mViaGap = aOther.mViaGap;
    p.mMaxUncoupledLength = aOther.mMaxUncoupledLength;
    p.mChamferLimit = aOther.mChamferLimit;
    p.mGapConstraint = aOther.mGapConstraint;

    return p;
  }

  override clearLinks(): void {
    super.clearLinks();
    this.mLineP.clearLinks();
    this.mLineN.clearLinks();
  }

  /** `SetShape( aP, aN, aSwapLanes )`. */
  setShape(aP: Chain, aN: Chain, aSwapLanes = false): void {
    if (aSwapLanes) {
      this.mP = aN.map((p) => ({ ...p }));
      this.mN = aP.map((p) => ({ ...p }));
    } else {
      this.mP = aP.map((p) => ({ ...p }));
      this.mN = aN.map((p) => ({ ...p }));
    }
  }

  /** `SetShape( const DIFF_PAIR& )`: take another pair's geometry only. */
  setShapeFrom(aPair: DiffPair): void {
    this.mP = aPair.mP.map((p) => ({ ...p }));
    this.mN = aPair.mN.map((p) => ({ ...p }));
  }

  setNets(aP: NetHandle, aN: NetHandle): void {
    this.mNetP = aP;
    this.mNetN = aN;
  }

  /** Upstream also pushes the width into the two chains; a `Chain` has none. */
  setWidth(aWidth: number): void {
    this.mWidth = aWidth;
  }

  width(): number {
    return this.mWidth;
  }

  /** Unlike the constructor's gap, this one comes with a ±10000 IU band. */
  setGap(aGap: number): void {
    this.mGap = aGap;
    this.mGapConstraint = new RangedNum(this.mGap, 10000, 10000);
  }

  gap(): number {
    return this.mGap;
  }

  setViaGap(aViaGap: number): void {
    this.mViaGap = aViaGap;
  }

  viaGap(): number {
    return this.mViaGap;
  }

  setMaxUncoupledLength(aLength: number): void {
    this.mMaxUncoupledLength = aLength;
  }

  maxUncoupledLength(): number {
    return this.mMaxUncoupledLength;
  }

  setChamferLimit(aLimit: number): void {
    this.mChamferLimit = aLimit;
  }

  chamferLimit(): number {
    return this.mChamferLimit;
  }

  /**
   * Copy both vias in and re-clone their holes.
   *
   * `PnsVia.clone()` rebuilds the hole as a circle from the drill, where
   * upstream clones the hole it was given — which differs only for a via whose
   * hole is not a plain centred circle.
   */
  appendVias(aViaP: PnsVia, aViaN: PnsVia): void {
    this.mHasVias = true;
    this.mViaP = aViaP.clone();
    this.mViaN = aViaN.clone();
  }

  /**
   * Upstream's asymmetry, kept: this clears the flag and drops the vias from
   * the two cached `LINE`s, but `m_via_p` / `m_via_n` keep their values.
   */
  removeVias(): void {
    this.mHasVias = false;
    this.mLineN.removeVia();
    this.mLineP.removeVia();
  }

  endsWithVias(): boolean {
    return this.mHasVias;
  }

  setViaDiameter(aDiameter: number): void {
    this.mViaP.setDiameter(PnsVia.ALL_LAYERS, aDiameter);
    this.mViaN.setDiameter(PnsVia.ALL_LAYERS, aDiameter);
  }

  setViaDrill(aDrill: number): void {
    this.mViaP.setDrill(aDrill);
    this.mViaN.setDrill(aDrill);
  }

  netP(): NetHandle {
    return this.mNetP;
  }

  netN(): NetHandle {
    return this.mNetN;
  }

  /** The cached `LINE`, rebuilt from the chain unless it is already linked. */
  pLine(): PnsLine {
    if (!this.mLineP.isLinked()) this.updateLine(this.mLineP, this.mP, this.mNetP, this.mViaP);

    return this.mLineP;
  }

  nLine(): PnsLine {
    if (!this.mLineN.isLinked()) this.updateLine(this.mLineN, this.mN, this.mNetN, this.mViaN);

    return this.mLineN;
  }

  private updateLine(aLine: PnsLine, aShape: Chain, aNet: NetHandle, aVia: PnsVia): void {
    aLine.setShape(PnsLineChain.fromPoints(aShape));
    aLine.setWidth(this.mWidth);
    aLine.setNet(aNet);
    aLine.setLayer(this.layers().start());
    aLine.setParent(this.mParent);
    aLine.setSourceItem(this.mSourceItem);

    if (this.mHasVias) aLine.appendVia(aVia);
  }

  /**
   * The two things the pair currently ends on: its vias, or a `SEGMENT` cut
   * from the last segment of each lane, anchored at that segment's far end.
   */
  endingPrimitives(): DpPrimitivePair {
    if (this.mHasVias) return DpPrimitivePair.fromItems(this.mViaP, this.mViaN);

    const lP = this.pLine();
    const lN = this.nLine();

    const sP = PnsSegment.fromParentLine(lP, lP.cLine().cSegment(-1));
    const sN = PnsSegment.fromParentLine(lN, lN.cLine().cSegment(-1));

    const dpair = DpPrimitivePair.fromItems(sP, sN);

    dpair.setAnchors(sP.seg().b, sN.seg().b);

    return dpair;
  }

  clear(): void {
    this.mN = [];
    this.mP = [];
  }

  append(aOther: DiffPair): void {
    this.mN = appendChain(this.mN, aOther.mN);
    this.mP = appendChain(this.mP, aOther.mP);
  }

  /** Empty when *either* lane has no segments. */
  empty(): boolean {
    return segmentCount(this.mN) === 0 || segmentCount(this.mP) === 0;
  }

  cP(): Chain {
    return this.mP;
  }

  cN(): Chain {
    return this.mN;
  }

  gapConstraint(): RangedNum {
    return this.mGapConstraint;
  }

  /**
   * Route the pair between two gateways with the standard 45° initial trace,
   * splicing in whatever lead-ins the gateways carry.
   *
   * Three things here look like mistakes and are upstream's:
   *
   *  1. the redundant `m_p = p; m_n = n;` above the `if` is **load bearing** —
   *     `aEntry.Entry().CheckConnectionAngle( *this, … )` reads this pair's
   *     chains, and what it must see is the bare trace, not the assembled one;
   *  2. the gap, self-intersection and lane-crossing checks all run on the bare
   *     traces `p`/`n` and never on the assembled `m_p`/`m_n`, so a lead-in
   *     that pinches the gap or crosses the other lane is not caught here;
   *  3. the target's gateway is *copied and reversed* before its entry is read,
   *     which is what turns a target's outward lead-ins into inward ones.
   */
  buildInitial(aEntry: DpGateway, aTarget: DpGateway, aPrefDiagonal: boolean): boolean {
    const p = Direction45.UNDEFINED.buildInitialTrace(
      aEntry.anchorP(),
      aTarget.anchorP(),
      aPrefDiagonal,
    );
    const n = Direction45.UNDEFINED.buildInitialTrace(
      aEntry.anchorN(),
      aTarget.anchorN(),
      aPrefDiagonal,
    );

    let mask = aEntry.allowedAngles() | AngleType.ANG_STRAIGHT | AngleType.ANG_OBTUSE;

    this.mP = p;
    this.mN = n;

    if (aEntry.hasEntryLines()) {
      if (!aEntry.entry().checkConnectionAngle(this, mask)) return false;

      this.mP = appendChain(aEntry.entry().cP(), p);
      this.mN = appendChain(aEntry.entry().cN(), n);
    } else {
      this.mP = p;
      this.mN = n;
    }

    mask = aTarget.allowedAngles() | AngleType.ANG_STRAIGHT | AngleType.ANG_OBTUSE;

    if (aTarget.hasEntryLines()) {
      const t = aTarget.copy();

      t.reverse();

      if (!this.checkConnectionAngle(t.entry(), mask)) return false;

      this.mP = appendChain(this.mP, t.entry().cP());
      this.mN = appendChain(this.mN, t.entry().cN());
    }

    if (!checkGap(p, n, this.mGapConstraint.value)) return false;

    if (chainSelfIntersecting(p) || chainSelfIntersecting(n)) return false;

    if (chainsIntersect(p, n)) return false;

    return true;
  }

  /**
   * Do this pair's two lanes meet `aOther`'s at an allowed angle?
   *
   * An empty lane on either side passes unconditionally — which is what makes
   * the one-sided gateways `buildDpContinuation` produces usable at all.
   */
  checkConnectionAngle(aOther: DiffPair, aAllowedAngles: number): boolean {
    let checkP: boolean;
    let checkN: boolean;

    if (segmentCount(this.mP) === 0 || segmentCount(aOther.mP) === 0) {
      checkP = true;
    } else {
      const p0 = Direction45.fromSeg(csegment(this.mP, -1).a, csegment(this.mP, -1).b);
      const p1 = Direction45.fromSeg(csegment(aOther.mP, 0).a, csegment(aOther.mP, 0).b);

      checkP = (p0.angle(p1) & aAllowedAngles) !== 0;
    }

    if (segmentCount(this.mN) === 0 || segmentCount(aOther.mN) === 0) {
      checkN = true;
    } else {
      const n0 = Direction45.fromSeg(csegment(this.mN, -1).a, csegment(this.mN, -1).b);
      const n1 = Direction45.fromSeg(csegment(aOther.mN, 0).a, csegment(aOther.mN, 0).b);

      checkN = (n0.angle(n1) & aAllowedAngles) !== 0;
    }

    return checkP && checkN;
  }

  /** How much longer the P lane is than the N lane. */
  skew(): number {
    return chainLengthI(this.mP) - chainLengthI(this.mN);
  }

  /** The mean of the two lane lengths. */
  totalLength(): number {
    return (chainLengthI(this.mN) + chainLengthI(this.mP)) / 2.0;
  }

  coupledLengthFactor(): number {
    const t = this.totalLength();

    if (t === 0.0) return 0.0;

    return this.coupledLength() / t;
  }

  /**
   * Every pair of segments, one from each lane, that run alongside each other
   * at the constrained gap.
   *
   * The chains are deliberately **not** simplified first — upstream says so in
   * a comment — because the recorded indices have to stay valid against the
   * caller's own view of the chains.
   *
   * The parallelism threshold is **2** here where the two `CoupledLength`
   * overloads leave it at the default 1, and the distance compared against the
   * band is centre-to-centre less the track width.
   *
   * The `IsArcSegment` skip upstream has is absent: a `Chain` cannot carry an
   * arc. See the module note.
   */
  coupledSegmentPairs(): CoupledSegments[] {
    const out: CoupledSegments[] = [];
    const p = this.mP;
    const n = this.mN;

    for (let i = 0; i < segmentCount(p); i++) {
      for (let j = 0; j < segmentCount(n); j++) {
        const sp = csegment(p, i);
        const sn = csegment(n, j);

        const dist = Math.abs(segDistance(sp, sn) - this.mWidth);

        if (!segApproxParallel(sp, sn, 2)) continue;
        if (!this.mGapConstraint.matches(dist)) continue;

        const clipped = commonParallelProjection(sp, sn);

        if (!clipped) continue;

        out.push({
          coupledP: clipped.pClip,
          coupledN: clipped.nClip,
          parentP: sp,
          parentN: sn,
          indexP: i,
          indexN: j,
        });
      }
    }

    return out;
  }

  /** `CoupledLength()`: the total length of the coupled stretches, P side. */
  coupledLength(): number {
    let l = 0.0;

    for (const pair of this.coupledSegmentPairs()) l += segLength(pair.coupledP);

    return l;
  }

  /** `CoupledLength( const SEG&, const SEG& )` — threshold 1, not 2. */
  coupledLengthOfSegs(aP: Seg, aN: Seg): number {
    const dist = Math.abs(segDistance(aP, aN) - this.mWidth);

    if (segApproxParallel(aP, aN) && this.mGapConstraint.matches(dist)) {
      const clipped = commonParallelProjection(aP, aN);

      if (clipped) return segLength(clipped.pClip);
    }

    return 0;
  }

  /** `CoupledLength( const SHAPE_LINE_CHAIN&, const SHAPE_LINE_CHAIN& )`. */
  coupledLengthOfChains(aP: Chain, aN: Chain): number {
    let total = 0;

    for (let i = 0; i < segmentCount(aP); i++) {
      for (let j = 0; j < segmentCount(aN); j++) {
        const sp = csegment(aP, i);
        const sn = csegment(aN, j);
        const dist = Math.abs(segDistance(sp, sn) - this.mWidth);

        if (segApproxParallel(sp, sn) && this.mGapConstraint.matches(dist)) {
          const clipped = commonParallelProjection(sp, sn);

          if (clipped) total += segLength(clipped.pClip);
        }
      }
    }

    return total;
  }
}

/**
 * `DP_GATEWAYS`: everywhere a pair could leave a given place, scored.
 *
 * The build methods *append*; nothing here replaces the list, so a
 * `BuildFromPrimitivePair` that takes the diagonal-alignment path emits its four
 * fan gateways and then everything `BuildGeneric` finds as well.
 */
export class DpGateways {
  private mGap: number;
  private mViaGap: number;
  private mViaDiameter = 0;
  private mFitVias = true;
  private mGateways: DpGateway[] = [];

  constructor(aGap: number) {
    this.mGap = aGap;
    this.mViaGap = aGap;
  }

  clear(): void {
    this.mGateways = [];
  }

  /** A negative `aViaGap` means "use the track gap". */
  setFitVias(aEnable: boolean, aDiameter = 0, aViaGap = -1): void {
    this.mFitVias = aEnable;
    this.mViaDiameter = aDiameter;

    if (aViaGap < 0) this.mViaGap = this.mGap;
    else this.mViaGap = aViaGap;
  }

  gateways(): DpGateway[] {
    return this.mGateways;
  }

  /**
   * Drop every gateway whose orientation makes one of the masked angles with
   * `aRefOrientation`.
   *
   * The orientation is `AnchorP - AnchorN`, so it is the axis the pair is
   * *spread* along, not the direction it travels. An undefined orientation —
   * two coincident anchors — gives `ANG_UNDEFINED`, which no caller masks, so
   * such a gateway always survives.
   */
  filterByOrientation(aAngleMask: number, aRefOrientation: Direction45): void {
    this.mGateways = this.mGateways.filter((dp) => {
      const orient = Direction45.fromVector(sub(dp.anchorP(), dp.anchorN()));

      return (orient.angle(aRefOrientation) & aAngleMask) === 0;
    });
  }

  /**
   * Eight gateways around a bare cursor position: four with the anchors on a
   * diagonal of length `gap`, four with them on an axis.
   *
   * The naming is inverted and it is upstream's: the `!diagonal` pass builds a
   * `(gap, gap)` *diagonal* offset vector, the `diagonal` pass builds
   * axis-aligned ones — and the flag each gateway is stamped with is the loop
   * variable, not the shape of its offset. In `fitVias` mode nothing is stamped
   * at all: the gateways come from `BuildGeneric`, so the two passes differ only
   * in where they are centred.
   */
  buildForCursor(aCursorPos: Vec2): void {
    const gap = this.mFitVias ? this.mViaGap + this.mViaDiameter : this.mGap;

    for (const diagonal of [false, true]) {
      for (let i = 0; i < 4; i++) {
        let dir: Vec2;

        if (!diagonal) {
          const d = makeGapVector({ x: gap, y: gap }, gap);
          dir = {
            x: i % 2 === 0 ? -d.x : d.x,
            y: Math.trunc(i / 2) === 0 ? -d.y : d.y,
          };
        } else {
          const half = Math.trunc((gap + 1) / 2) * (i % 2 ? -1 : 1);

          dir = Math.trunc(i / 2) === 0 ? { x: half, y: 0 } : { x: 0, y: half };
        }

        if (this.mFitVias) {
          this.buildGeneric(add(aCursorPos, dir), sub(aCursorPos, dir), true, true);
        } else {
          this.mGateways.push(new DpGateway(add(aCursorPos, dir), sub(aCursorPos, dir), diagonal));
        }
      }
    }
  }

  /**
   * Give every gateway that has none a lead-in reaching it from `p0`.
   *
   * The trace is built *from the gateway back to the pad* and then reversed, so
   * the corner it puts in lands next to the pad rather than next to the
   * gateway. `DIRECTION_45()` is undefined, so the gateway's own diagonal flag
   * chooses which leg comes first.
   */
  private buildEntries(p0_p: Vec2, p0_n: Vec2): void {
    for (const g of this.mGateways) {
      if (!g.hasEntryLines()) {
        const leadP = reverse(
          Direction45.UNDEFINED.buildInitialTrace(g.anchorP(), p0_p, g.isDiagonal()),
        );
        const leadN = reverse(
          Direction45.UNDEFINED.buildInitialTrace(g.anchorN(), p0_n, g.isDiagonal()),
        );

        g.setEntryLines(leadP, leadN);
      }
    }
  }

  /**
   * Continue an existing pair: the gateway is the pair's own two track ends.
   *
   * Beyond the straight continuation, a pair sitting at a cardinal or 45°
   * orientation also gets gateways with **one** anchor pushed forward along its
   * own track, which tilts the pair's axis by about 22.5° and lets it connect to
   * tracks 45° off the current heading. Two sets are emitted:
   * `sin(22.5°)` at priority 20 and `sin(23.5°)` at priority 5 — the second is
   * upstream's fix for gitlab issue 12459, where the exact value does not
   * always work and a little wiggle room does. Both constants are the decimal
   * literals upstream uses, not `Math.sin` of anything.
   */
  private buildDpContinuation(aPair: DpPrimitivePair, aIsDiagonal: boolean): void {
    const gw = new DpGateway(aPair.anchorP(), aPair.anchorN(), aIsDiagonal);

    gw.setPriority(100);
    this.mGateways.push(gw);

    if (!aPair.directional()) return;

    const EPSILON = 5; // 0.005um
    const SIN_22_5 = 0.38268;
    const SIN_23_5 = 0.39875;

    const addAngledGateways = (length: number, priority: number): void => {
      const entryLineP: Chain = [
        { ...aPair.anchorP() },
        add(aPair.anchorP(), ResizeI(aPair.dirP().toVector(), length)),
      ];
      const gwExtendP = new DpGateway(
        entryLineP[entryLineP.length - 1] as Vec2,
        aPair.anchorN(),
        aIsDiagonal,
      );

      gwExtendP.setPriority(priority);
      gwExtendP.setEntryLines(entryLineP, []);
      this.mGateways.push(gwExtendP);

      const entryLineN: Chain = [
        { ...aPair.anchorN() },
        add(aPair.anchorN(), ResizeI(aPair.dirN().toVector(), length)),
      ];
      const gwExtendN = new DpGateway(
        aPair.anchorP(),
        entryLineN[entryLineN.length - 1] as Vec2,
        aIsDiagonal,
      );

      gwExtendN.setPriority(priority);
      gwExtendN.setEntryLines([], entryLineN);
      this.mGateways.push(gwExtendN);
    };

    const delta = sub(aPair.anchorP(), aPair.anchorN());

    if (
      Math.abs(delta.x) < EPSILON ||
      Math.abs(delta.y) < EPSILON ||
      Math.abs(delta.x - delta.y) < EPSILON
    ) {
      addAngledGateways(KiROUND(this.mGap * SIN_22_5), 20);

      // fixme; sin(22.5) doesn't always work, so we also add some lower
      // priority ones with a bit of wiggle room.
      // See https://gitlab.com/kicad/code/kicad/-/issues/12459.
      addAngledGateways(KiROUND(this.mGap * SIN_23_5), 5);
    }
  }

  /**
   * The general fan: every way a pair can leave two arbitrary points.
   *
   * The construction is a set of 200-unit probe segments through each anchor —
   * horizontal, vertical, and both diagonals — and gateways are placed where
   * probes from opposite anchors meet. That is why gateways cluster where the
   * pads line up on an axis or a diagonal, and thin out where they do not.
   *
   * Priorities encode "how far apart are the pads relative to the gap":
   * `padDist > 3 * gap` makes the *midpoint* exit better (2 rather than 1) and
   * the *intersection* exits worse (10 rather than 20). Widely spaced pads want
   * to converge to the middle first; closely spaced ones are already about
   * right and should just fan out.
   */
  buildGeneric(p0_p: Vec2, p0_n: Vec2, aBuildEntries = false, aViaMode = false): void {
    const stP: Seg[] = [];
    const stN: Seg[] = [];
    const dP: Seg[] = [];
    const dN: Seg[] = [];

    const padToGapThreshold = 3;
    const padDist = EuclideanNormI(sub(p0_n, p0_p));

    stP[0] = { a: add(p0_p, { x: -100, y: 0 }), b: add(p0_p, { x: 100, y: 0 }) };
    stN[0] = { a: add(p0_n, { x: -100, y: 0 }), b: add(p0_n, { x: 100, y: 0 }) };
    stP[1] = { a: add(p0_p, { x: 0, y: -100 }), b: add(p0_p, { x: 0, y: 100 }) };
    stN[1] = { a: add(p0_n, { x: 0, y: -100 }), b: add(p0_n, { x: 0, y: 100 }) };
    dP[0] = { a: add(p0_p, { x: -100, y: -100 }), b: add(p0_p, { x: 100, y: 100 }) };
    dP[1] = { a: add(p0_p, { x: 100, y: -100 }), b: add(p0_p, { x: -100, y: 100 }) };
    dN[0] = { a: add(p0_n, { x: -100, y: -100 }), b: add(p0_n, { x: 100, y: 100 }) };
    dN[1] = { a: add(p0_n, { x: 100, y: -100 }), b: add(p0_n, { x: -100, y: 100 }) };

    // midpoint exit & side-by exits
    for (let i = 0; i < 2; i++) {
      const straightColl = segCollinear(stP[i] as Seg, stN[i] as Seg);
      const diagColl = segCollinear(dP[i] as Seg, dN[i] as Seg);

      if (straightColl || diagColl) {
        let dir = makeGapVector(sub(p0_n, p0_p), Math.trunc(this.mGap / 2));
        const m = midpoint(p0_p, p0_n);
        const prio = padDist > padToGapThreshold * this.mGap ? 2 : 1;

        if (!aViaMode) {
          this.mGateways.push(
            new DpGateway(sub(m, dir), add(m, dir), diagColl, AngleType.ANG_RIGHT, prio),
          );

          dir = makeGapVector(sub(p0_n, p0_p), 2 * this.mGap);
          const perp = Perpendicular(dir);

          this.mGateways.push(new DpGateway(sub(p0_p, dir), add(sub(p0_p, dir), perp), diagColl));
          this.mGateways.push(new DpGateway(sub(p0_p, dir), sub(sub(p0_p, dir), perp), diagColl));
          this.mGateways.push(new DpGateway(add(add(p0_n, dir), perp), add(p0_n, dir), diagColl));
          this.mGateways.push(new DpGateway(sub(add(p0_n, dir), perp), add(p0_n, dir), diagColl));
        }
      }
    }

    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const ips: (Vec2 | null)[] = [];

        ips[0] = segIntersectLines(dN[i] as Seg, dP[j] as Seg);
        ips[1] = segIntersectLines(stP[i] as Seg, stN[j] as Seg);

        if (segCollinear(dN[i] as Seg, dP[j] as Seg)) ips[0] = null;

        // UPSTREAM TYPO, reproduced: this guards `st_p[i]` against `st_p[j]`,
        // not against the `st_n[j]` the intersection above was taken with.
        //
        // It happens to be **equivalent**, and the argument is worth writing
        // down because it is the only reason not to "fix" it. `st_p` and `st_n`
        // are axis probes, so index 0 is always horizontal and index 1 always
        // vertical:
        //  - `i == j`: `st_p[i]` is trivially collinear with itself, so `ips[1]`
        //    is discarded. It would have been discarded anyway — `st_p[i]` and
        //    `st_n[i]` are parallel, so `IntersectLines` returns non-null only
        //    when they are collinear, which is exactly what the intended guard
        //    tests;
        //  - `i != j`: the two probes are perpendicular. Neither `st_p[i]` vs
        //    `st_p[j]` nor `st_p[i]` vs `st_n[j]` can be collinear, so both
        //    guards are false.
        // A mutant that "corrects" this line therefore survives, and is
        // documented here rather than killed by a contrived test.
        if (segCollinear(stP[i] as Seg, stP[j] as Seg)) ips[1] = null;

        // diagonal-diagonal and straight-straight cases - the most typical case
        // if the pads are on the same straight/diagonal line
        for (let k = 0; k < 2; k++) {
          const ip = ips[k];

          if (ip) {
            const m = ip;

            if (!equal(m, p0_p) && !equal(m, p0_n)) {
              const prio = padDist > padToGapThreshold * this.mGap ? 10 : 20;
              const gP = ResizeI(sub(p0_p, m), Math.ceil(this.mGap * Math.SQRT1_2));
              const gN = ResizeI(sub(p0_n, m), Math.ceil(this.mGap * Math.SQRT1_2));

              this.mGateways.push(
                new DpGateway(add(m, gP), add(m, gN), k === 0, AngleType.ANG_OBTUSE, prio),
              );
            }
          }
        }

        ips[0] = segIntersectLines(stN[i] as Seg, dP[j] as Seg);
        ips[1] = segIntersectLines(stP[i] as Seg, dN[j] as Seg);

        // diagonal-straight cases: 8 possibilities of "weirder" exits
        for (let k = 0; k < 2; k++) {
          const ip = ips[k];

          if (ip) {
            const m = ip;

            if (!aViaMode && !equal(m, p0_p) && !equal(m, p0_n)) {
              let gP = ResizeI(sub(p0_p, m), Math.ceil(this.mGap * Math.SQRT2));
              let gN = ResizeI(sub(p0_n, m), Math.ceil(this.mGap));

              if (angleOf(gP, gN) !== AngleType.ANG_ACUTE) {
                this.mGateways.push(new DpGateway(add(m, gP), add(m, gN), true));
              }

              gP = ResizeI(sub(p0_p, m), this.mGap);
              gN = ResizeI(sub(p0_n, m), Math.ceil(this.mGap * Math.SQRT2));

              if (angleOf(gP, gN) !== AngleType.ANG_ACUTE) {
                this.mGateways.push(new DpGateway(add(m, gP), add(m, gN), true));
              }
            }
          }
        }
      }
    }

    if (aBuildEntries) this.buildEntries(p0_p, p0_n);
  }

  /**
   * Are the two anchors on a common horizontal, vertical or 45° line?
   *
   * Upstream oddity, reproduced: two **coincident** anchors answer *true*, via
   * the `dx == dy` clause with both zero, even though the other two clauses are
   * explicitly written to exclude the degenerate case.
   */
  checkDiagonalAlignment(a: Vec2, b: Vec2): boolean {
    const dir = { x: Math.abs(a.x - b.x), y: Math.abs(a.y - b.y) };

    return (dir.x === 0 && dir.y !== 0) || dir.x === dir.y || (dir.y === 0 && dir.x !== 0);
  }

  /**
   * Everywhere a pair can leave the given pair of primitives.
   *
   * Four cases: no primitive at all (a bare pair of points), two pads or vias
   * (fan out of the pad shape), two tracks (continue the pair), and anything
   * mixed — which falls through to a `return` with both positions still at the
   * origin, upstream included.
   *
   * The pad case adds a "fan" of four gateways *before* the generic ones when
   * the two anchors line up: two spreads (`orthoFanDistance` at priority 100,
   * `diagFanDistance` at 99) times two signs. The fan distances come from the
   * pad's own dimensions, so a long pad fans further than a round one.
   */
  buildFromPrimitivePair(aPair: DpPrimitivePair, aPreferDiagonal: boolean): void {
    let p0_p: Vec2 = { x: 0, y: 0 };
    let p0_n: Vec2 = { x: 0, y: 0 };
    let orthoFanDistance = 0;
    let diagFanDistance = 0;
    let shP: Shape | null = null;

    const primP = aPair.primP();
    const primN = aPair.primN();

    if (primP === null) {
      this.buildGeneric(aPair.anchorP(), aPair.anchorN(), true);
      return;
    }

    const pvMask = PnsKind.SOLID_T | PnsKind.VIA_T;

    if (primP.ofKind(pvMask) && primN !== null && primN.ofKind(pvMask)) {
      p0_p = aPair.anchorP();
      p0_n = aPair.anchorN();

      // TODO(JE) padstacks
      shP = primP.shape(-1);
    } else if (
      primP.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T) &&
      primN !== null &&
      primN.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)
    ) {
      this.buildDpContinuation(aPair, aPreferDiagonal);

      return;
    }

    const majorDirection = Perpendicular(sub(p0_p, p0_n));

    if (shP === null) return;

    switch (shP.kind) {
      case 'circle':
        this.buildGeneric(p0_p, p0_n, true);
        return;

      case 'stadium': {
        // SH_SEGMENT. Ziro's `r` is upstream's `GetWidth() / 2`, truncated.
        const w = shP.r * 2;
        const len = EuclideanNormI(sub(shP.b, shP.a));

        orthoFanDistance = w + len;
        diagFanDistance = len;
        break;
      }

      case 'poly': {
        // SH_RECT and SH_SIMPLE both land here: Ziro has no separate rectangle
        // shape, and for an axis-aligned rectangle the bounding box upstream
        // takes in the SH_SIMPLE branch *is* the rectangle, so the arithmetic
        // is the same either way.
        const xs = shP.pts.map((q) => q.x);
        const ys = shP.pts.map((q) => q.y);
        let w = Math.max(...xs) - Math.min(...xs);
        let h = Math.max(...ys) - Math.min(...ys);

        if (w < h) [w, h] = [h, w];

        orthoFanDistance = Math.trunc(((w + 1) * 3) / 2);
        diagFanDistance = w - h;
        break;
      }

      default:
        // Upstream `wxFAIL_MSG`s on an unsupported starting primitive and falls
        // through with both fan distances still zero. An `arc` shape is the only
        // thing that reaches here.
        break;
    }

    if (this.checkDiagonalAlignment(p0_p, p0_n)) {
      const padDist = EuclideanNormI(sub(p0_p, p0_n));

      for (let k = 0; k < 2; k++) {
        const dir = makeGapVector(majorDirection, k === 0 ? orthoFanDistance : diagFanDistance);

        const d = Math.max(0, padDist - this.mGap);
        const dp = makeGapVector(dir, d);
        const dv = makeGapVector(sub(p0_n, p0_p), d);

        for (let i = 0; i < 2; i++) {
          const sign = i ? -1 : 1;
          const spread = scale(add(dir, dp), sign);

          const gwP = add(add(p0_p, spread), dv);
          const gwN = sub(add(p0_n, spread), dv);

          const entryP: Chain = [{ ...p0_p }, add(p0_p, scale(dir, sign)), gwP];
          const entryN: Chain = [{ ...p0_n }, add(p0_n, scale(dir, sign)), gwN];

          const gw = new DpGateway(gwP, gwN, false);

          gw.setEntryLines(entryP, entryN);
          gw.setPriority(100 - k);
          this.mGateways.push(gw);
        }
      }
    }

    this.buildGeneric(p0_p, p0_n, true);
  }

  /**
   * Project the cursor onto each entry gateway's own axis and build a target
   * there, so a pair being dragged snaps to running straight or at 45° out of
   * whatever it started on.
   *
   * The guide through the entry's midpoint is compared in two forms, horizontal
   * and (1,1)-diagonal, and the nearer projection wins. A **tie takes the
   * diagonal**, because the comparison is a strict `<` on the straight one.
   */
  buildOrthoProjections(aEntries: DpGateways, aCursorPos: Vec2, aOrthoScore: number): void {
    for (const g of aEntries.gateways()) {
      const m = midpoint(g.anchorP(), g.anchorN());
      const guideS: Seg = { a: m, b: add(m, { x: 1, y: 0 }) };
      const guideD: Seg = { a: m, b: add(m, { x: 1, y: 1 }) };

      const projS = segLineProject(guideS, aCursorPos);
      const projD = segLineProject(guideD, aCursorPos);

      const distS = EuclideanNormI(sub(projS, aCursorPos));
      const distD = EuclideanNormI(sub(projD, aCursorPos));

      const proj = distS < distD ? projS : projD;

      const targets = new DpGateways(this.mGap);

      targets.mViaGap = this.mViaGap;
      targets.mViaDiameter = this.mViaDiameter;
      targets.mFitVias = this.mFitVias;

      targets.buildForCursor(proj);

      for (const t of targets.gateways()) {
        t.setPriority(aOrthoScore);
        this.mGateways.push(t);
      }
    }
  }

  /**
   * Pick the best entry/target pairing that can actually be routed, and put its
   * geometry into `aDp`.
   *
   * The score is the two priorities plus a **-3 penalty for taking the
   * non-preferred diagonal sense** — the diagonal preference is worth three
   * points of gateway priority and no more, which is why a high-priority
   * gateway can drag the route onto the "wrong" diagonal.
   *
   * Two upstream details in three lines:
   *
   *  - the comparison is `>=`, so among equally scored candidates the **last**
   *    one tried wins, not the first;
   *  - `bestScore` only advances when `BuildInitial` *succeeds*, so a
   *    high-scoring pairing that cannot be routed does not lock out the lower
   *    ones behind it. (`score >= bestScore` is checked before the attempt, so
   *    a failure is also cheap.)
   */
  fitGateways(
    aEntry: DpGateways,
    aTarget: DpGateways,
    aPrefDiagonal: boolean,
    aDp: DiffPair,
  ): boolean {
    let bestP: Chain = [];
    let bestN: Chain = [];
    let bestScore = -1000;
    let found = false;

    for (const gEntry of aEntry.gateways()) {
      for (const gTarget of aTarget.gateways()) {
        for (const preferred of [false, true]) {
          let score = preferred ? 0 : -3;

          score += gEntry.priority();
          score += gTarget.priority();

          if (score >= bestScore) {
            const l = DiffPair.withGap(this.mGap);

            if (l.buildInitial(gEntry, gTarget, preferred ? aPrefDiagonal : !aPrefDiagonal)) {
              bestP = l.cP();
              bestN = l.cN();
              bestScore = score;
              found = true;
            }
          }
        }
      }
    }

    if (found) {
      aDp.setGap(this.mGap);
      aDp.setShape(bestP, bestN);
      return true;
    }

    return false;
  }
}
