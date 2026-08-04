// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper slivers: `DRCE_COPPER_SLIVER`.
 * Counterpart: `DRC_TEST_PROVIDER_SLIVER_CHECKER` (pcbnew/drc/).
 *
 * A sliver is a needle of copper — where two edges of the *same* merged copper
 * region come back on themselves at a very sharp angle. Fabrication cannot hold
 * a feature that thin: it lifts, or etches away, or bridges.
 *
 * ## It is a vertex test, not an offset test
 *
 * The obvious way to find thin copper is to deflate and re-inflate and see what
 * vanishes. Upstream does not: it merges all the copper on a layer into one
 * polygon and then walks the outline looking at each vertex's two arms. That is
 * cheaper and, more importantly, it reports *where* the sliver is rather than
 * that one exists somewhere.
 *
 * The test at a vertex, in order — every one of these is a rejection, so the
 * reported set is small:
 *
 * 1. The two arms must point the *same* way (`dot > 0`). A dot product of zero
 *    or less is an angle of 90° or more, which is a normal corner. Note this
 *    also throws out the *near-180°* case, which the angle test below cannot:
 *    that test takes an absolute value, so a barely-bent vertex looks just as
 *    "sharp" to it as a doubled-back one.
 * 2. The vertex must be **locally inside** the polygon — a convex point of
 *    copper, not a concave one. This is the difference between a tapering
 *    *finger* of copper, which is a sliver, and an equally sharp *slot* cut
 *    into a pour, which is not: a slot is a gap, and gaps are clearance's
 *    business, not this test's.
 * 3. The included angle must be sharper than the tolerance, by the law of
 *    cosines on the three points.
 * 4. The opposite side must still be **longer** than the width tolerance —
 *    otherwise the whole feature is smaller than the tolerance and is noise,
 *    not a sliver. This is why a hair-thin spike goes unreported while a
 *    broad-based wedge does: below the tolerance upstream stops trusting the
 *    outline at all.
 *
 * ## Winding
 *
 * Rejection 2 is orientation-sensitive — reverse the outline and it reports the
 * slots instead of the fingers. It is safe here because `booleanAdd` normalises
 * every outer ring to positive area whatever winding went in, which is the
 * orientation this expects. A test pins that, since nothing in the type system
 * does.
 *
 * ## Why the arms are grown before measuring
 *
 * Filled zones carry vertices only a few nanometres apart, and a two-nanometre
 * arm has no meaningful direction — its angle is numerical noise. Upstream
 * walks forward until each arm is at least `minLength`, and only then measures.
 * Without that every zone fill reports hundreds of phantom slivers.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (v: number): number => Math.round(v * 1e6);

/** `ADVANCED_CFG::m_SliverWidthTolerance`, 0.08 mm. */
export const SLIVER_WIDTH_TOLERANCE = MM(0.08);
/** `ADVANCED_CFG::m_SliverAngleTolerance`, 20°. */
export const SLIVER_ANGLE_TOLERANCE_DEG = 20;
/** `ADVANCED_CFG::m_SliverMinimumLength`, 0.0008 mm — 800 nm. */
export const SLIVER_MINIMUM_LENGTH = MM(0.0008);

/**
 * `std::numeric_limits<float>::epsilon()`. Upstream compares a *double* against
 * the **float** epsilon here, which is nine orders of magnitude looser than the
 * double one — deliberately, since the quantity it guards is a cosine built out
 * of square roots. Kept as upstream has it.
 */
const FLOAT_EPSILON = 1.1920929e-7;

export interface SliverOptions {
  widthTolerance?: number;
  angleToleranceDeg?: number;
  minLength?: number;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const norm2 = (v: Vec2): number => v.x * v.x + v.y * v.y;

/** Twice the signed area of the triangle p-q-r; negative is a clockwise turn. */
const cross = (p: Vec2, q: Vec2, r: Vec2): number =>
  (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

/**
 * Whether the chord from `a` to `b` lies inside the polygon at `a`.
 *
 * Upstream's `isLocallyInside`, itself earcut's: which side of `a`'s own corner
 * the chord falls on decides whether it cuts through material or across empty
 * space. That is what separates a sharp finger of copper from an equally sharp
 * slot cut into it.
 */
function isLocallyInside(pts: readonly Vec2[], a: number, b: number): boolean {
  const n = pts.length;
  const prev = (n + a - 1) % n;
  const next = (a + 1) % n;
  if (cross(pts[prev]!, pts[a]!, pts[next]!) < 0)
    return cross(pts[a]!, pts[b]!, pts[next]!) >= 0 && cross(pts[a]!, pts[prev]!, pts[b]!) >= 0;
  return cross(pts[a]!, pts[b]!, pts[prev]!) < 0 || cross(pts[a]!, pts[next]!, pts[b]!) < 0;
}

/**
 * Every sliver vertex on one closed outline.
 *
 * An outline of five points or fewer is skipped outright, as upstream does: a
 * shape that simple has no room for a sliver, and the arm-growing walk needs
 * somewhere to go.
 */
export function findSliverPoints(pts: readonly Vec2[], opts: SliverOptions = {}): Vec2[] {
  const widthTolerance = opts.widthTolerance ?? SLIVER_WIDTH_TOLERANCE;
  const angleTol = opts.angleToleranceDeg ?? SLIVER_ANGLE_TOLERANCE_DEG;
  const minLength = opts.minLength ?? SLIVER_MINIMUM_LENGTH;

  const n = pts.length;
  if (n <= 5) return [];

  const squaredWidth = widthTolerance * widthTolerance;
  const cosAngleTol = 2 * Math.cos((angleTol * Math.PI) / 180);
  const out: Vec2[] = [];

  let offset = 1;
  for (let kk = 0; kk < n; kk += offset) {
    const priorIndex = (n + kk - 1) % n;
    let nextIndex = (kk + 1) % n;
    let pt = pts[kk]!;
    const ptPrior = pts[priorIndex]!;
    let vPrior = sub(ptPrior, pt);
    offset = 1;
    let forward = 1;

    // Grow the backward arm past the sub-micron vertices a zone fill carries,
    // whose direction is numerical noise.
    while (Math.abs(vPrior.x) < minLength && Math.abs(vPrior.y) < minLength && offset < n) {
      pt = pts[(kk + offset++) % n]!;
      vPrior = sub(ptPrior, pt);
    }
    if (offset >= n) break;

    let ptAfter = pts[nextIndex]!;
    let vAfter = sub(ptAfter, pt);
    while (Math.abs(vAfter.x) < minLength && Math.abs(vAfter.y) < minLength && forward < n) {
      nextIndex = (kk + forward++) % n;
      ptAfter = pts[nextIndex]!;
      vAfter = sub(ptAfter, pt);
    }
    if (offset >= n) break;

    // A dot product of zero or less is 90° or more: an ordinary corner.
    if (dot(vPrior, vAfter) <= 0) continue;
    // A sharp *outward* point is a legitimate shape; only an inward one is a
    // slot the etchant cannot clear.
    if (!isLocallyInside(pts, priorIndex, nextIndex)) continue;

    const vIncluded = sub(ptAfter, ptPrior);
    const arm1 = norm2(vPrior);
    const arm2 = norm2(vAfter);
    const opp = norm2(vIncluded);
    if (arm1 === 0 || arm2 === 0) continue;

    // Law of cosines on the three points.
    const cosAng = Math.abs((opp - arm1 - arm2) / (Math.sqrt(arm1) * Math.sqrt(arm2)));

    // The middle term drops the fully degenerate vertex whose arms lie on one
    // ray; the last keeps a feature *smaller* than the tolerance from being
    // reported, since that is noise in the outline, not a sliver of copper.
    if (cosAng > cosAngleTol && 2 - cosAng > FLOAT_EPSILON && opp > squaredWidth) {
      out.push(pt);
    }
  }
  return out;
}
