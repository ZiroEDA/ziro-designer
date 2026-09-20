// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Differential pair coupling: `DRCE_DIFF_PAIR_GAP_OUT_OF_RANGE` and
 * `DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG`.
 * Counterpart: `drc_test_provider_diff_pair_coupling.cpp`.
 *
 * Two questions about one pair of nets: is the gap between them the width it is
 * meant to be *where they run together*, and do they run together for enough of
 * their length.
 *
 * ## A pair is discovered by name, not declared
 *
 * There is no "this is a differential pair" flag anywhere in the file format.
 * `matchDpSuffix` reads the net name backwards and looks for a polarity
 * character, and two nets are a pair when each names the other. That is the
 * whole mechanism — which is why `CLK_P`/`CLK_N` works and `CLKP`/`CLKM` does
 * not.
 *
 * ## Coupling is measured on the overlap, not the whole segment
 *
 * Two tracks of a pair are rarely the same length or aligned end to end. What
 * counts as coupled is the part of each that projects onto the other —
 * `commonParallelProjection` clips both to that shared span, and the gap is
 * measured between the *clipped* pieces. Measuring endpoint to endpoint instead
 * would report a gap that varies with how the pair happens to be broken into
 * segments.
 *
 * ## The gap check hides behind the uncoupled check
 *
 * The one piece of upstream behaviour most likely to look like a bug: a gap
 * violation is reported **only** when the pair is already failing its uncoupled
 * length, or when no uncoupled constraint exists at all. So a pair that is
 * mostly well coupled with one out-of-spec corner reports nothing. That is
 * deliberate upstream — the corner is where a pair necessarily diverges, and
 * reporting every one of them is noise — and it is mirrored here rather than
 * quietly improved.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** What a net name's polarity suffix says. */
export interface DpSuffix {
  /** +1 for the positive net, -1 for the negative one, 0 for no suffix. */
  polarity: number;
  /** The name the other half of the pair must have. */
  complement: string;
  /** The name with the polarity part removed. */
  baseName: string;
}

/**
 * `DRC_ENGINE::MatchDpSuffix`: read a net name backwards for a polarity mark.
 *
 * Digits and underscores are skipped over, so `USB_D_P_1` pairs with
 * `USB_D_N_1` — the polarity does not have to be the last character. The first
 * character that is not a digit, an underscore, or one of `+ - N P` stops the
 * walk, and anything else means the name has no polarity at all.
 *
 * `count` includes the polarity character itself, which is what makes the
 * reassembly below work: everything before it is the base, everything after it
 * is the trailing index, and the mark in the middle is swapped.
 */
export function matchDpSuffix(netName: string): DpSuffix {
  let polarity = 0;
  let mark = '';
  let count = 0;

  for (let i = netName.length - 1; i >= 0 && polarity === 0; i--, count++) {
    const ch = netName[i]!;

    if ((ch >= '0' && ch <= '9') || ch === '_') continue;
    if (ch === '+') {
      mark = '-';
      polarity = 1;
    } else if (ch === '-') {
      mark = '+';
      polarity = -1;
    } else if (ch === 'N') {
      mark = 'P';
      polarity = -1;
    } else if (ch === 'P') {
      mark = 'N';
      polarity = 1;
    } else break;
  }

  if (polarity !== 0 && count >= 1) {
    const baseName = netName.slice(0, netName.length - count);
    return {
      polarity,
      baseName,
      complement: baseName + mark + netName.slice(netName.length - count + 1),
    };
  }

  return { polarity: 0, complement: '', baseName: '' };
}

/** A segment, in the form the rest of this module works in. */
export interface Seg {
  a: Vec2;
  b: Vec2;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** `SEG::SquaredLength`. */
const squaredLength = (s: Seg): number => dot(sub(s.b, s.a), sub(s.b, s.a));

/**
 * `SEG::TCoef`: how far along the segment a point projects, scaled by the
 * segment's squared length so it stays integral.
 */
const tCoef = (s: Seg, p: Vec2): number => dot(sub(s.b, s.a), sub(p, s.a));

/** `SEG::LineProject`: the point on this segment's *infinite line* nearest `p`. */
function lineProject(s: Seg, p: Vec2): Vec2 {
  const d = sub(s.b, s.a);
  const len2 = dot(d, d);
  if (len2 === 0) return { x: s.a.x, y: s.a.y };
  const t = dot(sub(p, s.a), d) / len2;
  return { x: Math.round(s.a.x + d.x * t), y: Math.round(s.a.y + d.y * t) };
}

/**
 * Clip two segments to the span over which they run alongside each other.
 *
 * Returns null when they do not overlap at all in that sense — one is entirely
 * past the end of the other — which is upstream's early `return false`, and is
 * the difference between "these two tracks are a coupled pair here" and "these
 * two tracks are merely both on the board".
 */
export function commonParallelProjection(p: Seg, n: Seg): { pClip: Seg; nClip: Seg } | null {
  const nProjP: Seg = { a: lineProject(p, n.a), b: lineProject(p, n.b) };

  let tA = 0;
  let tB = tCoef(p, p.b);
  let tProjA = tCoef(p, nProjP.a);
  let tProjB = tCoef(p, nProjP.b);

  if (tB < tA) [tA, tB] = [tB, tA];
  if (tProjB < tProjA) [tProjA, tProjB] = [tProjB, tProjA];

  if (tB <= tProjA) return null;
  if (tA >= tProjB) return null;

  // The two middle values of the four are the overlap; upstream sorts all four
  // and takes tv[1] and tv[2], and calls the method awful in a comment.
  const tv = [0, tCoef(p, p.b), tCoef(p, nProjP.a), tCoef(p, nProjP.b)].sort((x, y) => x - y);
  const pLenSq = squaredLength(p);
  if (pLenSq === 0) return null;

  const d = sub(p.b, p.a);
  const at = (t: number): Vec2 => ({
    x: Math.round(p.a.x + (d.x * t) / pLenSq),
    y: Math.round(p.a.y + (d.y * t) / pLenSq),
  });

  const pClip: Seg = { a: at(tv[1]!), b: at(tv[2]!) };
  return { pClip, nClip: { a: lineProject(n, pClip.a), b: lineProject(n, pClip.b) } };
}

/** Distance between the nearest points of two segments. */
export function segmentDistance(p: Seg, n: Seg): number {
  const distPointSeg = (pt: Vec2, s: Seg): number => {
    const d = sub(s.b, s.a);
    const len2 = dot(d, d);
    if (len2 === 0) return Math.hypot(pt.x - s.a.x, pt.y - s.a.y);
    let t = dot(sub(pt, s.a), d) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(pt.x - (s.a.x + d.x * t), pt.y - (s.a.y + d.y * t));
  };

  return Math.min(
    distPointSeg(p.a, n),
    distPointSeg(p.b, n),
    distPointSeg(n.a, p),
    distPointSeg(n.b, p),
  );
}

/** One track of a pair, reduced to what the coupling test needs. */
export interface DpTrack {
  a: Vec2;
  b: Vec2;
  width: number;
  layer: string;
}

/** A stretch over which the two nets genuinely run together. */
export interface CoupledSpan {
  pClip: Seg;
  nClip: Seg;
  /** Edge to edge, so the track widths come off the centreline distance. */
  gap: number;
  /** The coupled length, measured on the N side as upstream does. */
  length: number;
  layer: string;
}

/** Length of a segment. */
const segLength = (s: Seg): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

/**
 * Every coupled stretch between the two halves of a pair.
 *
 * Segments barely longer than an internal unit are skipped: at that size the
 * direction is numerical noise, everything is "parallel" to them, and the
 * projection they produce is meaningless. Upstream uses squared length > 2 and
 * so does this.
 */
export function coupledSpans(
  pTracks: readonly DpTrack[],
  nTracks: readonly DpTrack[],
): CoupledSpan[] {
  const out: CoupledSpan[] = [];

  for (const sp of pTracks) {
    const ssp: Seg = { a: sp.a, b: sp.b };
    if (squaredLength(ssp) <= 2) continue;

    for (const sn of nTracks) {
      if (sn.layer !== sp.layer) continue;
      const ssn: Seg = { a: sn.a, b: sn.b };
      if (squaredLength(ssn) <= 2) continue;

      const clipped = commonParallelProjection(ssp, ssn);
      if (!clipped) continue;

      // Centreline distance less both half-widths: what a fabricator would
      // call the gap, rather than what the router's centrelines are apart.
      const gap = Math.round(
        segmentDistance(clipped.pClip, clipped.nClip) - (sp.width + sn.width) / 2,
      );

      out.push({
        pClip: clipped.pClip,
        nClip: clipped.nClip,
        gap,
        length: Math.round(segLength(clipped.nClip)),
        layer: sp.layer,
      });
    }
  }

  return out;
}

export interface DiffPairLimits {
  /** `diff_pair_gap` min/max (IU). Absent means the gap is not checked. */
  gapMin?: number;
  gapMax?: number;
  /** `diff_pair_uncoupled` max (IU). Absent means uncoupled length is not checked. */
  maxUncoupled?: number;
}

export interface DiffPairResult {
  /** Total length running within the gap limits. */
  coupledLength: number;
  /** The longer of the two nets, which is what the uncoupled figure is against. */
  totalLength: number;
  uncoupledLength: number;
  /** Set when the uncoupled length exceeds its maximum. */
  uncoupledViolation: boolean;
  /** Spans whose gap is out of range *and* which upstream would report. */
  gapViolations: (CoupledSpan & { failedMin: boolean; failedMax: boolean })[];
}

/**
 * `Run()`'s per-pair arithmetic.
 *
 * `epsilon` is upstream's slack on the gap comparison — a gap is only wrong
 * when it is wrong by more than the tolerance the geometry is known to.
 */
export function evaluateDiffPair(
  pTracks: readonly DpTrack[],
  nTracks: readonly DpTrack[],
  limits: DiffPairLimits,
  epsilon = 0,
): DiffPairResult {
  const spans = coupledSpans(pTracks, nTracks);
  const lengthOf = (tracks: readonly DpTrack[]): number =>
    Math.round(tracks.reduce((sum, t) => sum + Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y), 0));

  let coupledLength = 0;
  const failing: (CoupledSpan & { failedMin: boolean; failedMax: boolean })[] = [];

  for (const span of spans) {
    const failedMin =
      limits.gapMin !== undefined && limits.gapMin >= 0 && span.gap < limits.gapMin - epsilon;
    const failedMax =
      limits.gapMax !== undefined && limits.gapMax >= 0 && span.gap > limits.gapMax + epsilon;

    // Only a span within the gap limits counts as coupled at all: a pair that
    // runs alongside itself at the wrong spacing is not coupled, it is two
    // tracks near each other.
    if (!failedMin && !failedMax) coupledLength += span.length;
    else failing.push({ ...span, failedMin, failedMax });
  }

  const totalLength = Math.max(lengthOf(pTracks), lengthOf(nTracks));
  const uncoupledLength = totalLength - coupledLength;
  const uncoupledViolation =
    limits.maxUncoupled !== undefined &&
    limits.maxUncoupled >= 0 &&
    (pTracks.length > 0 || nTracks.length > 0) &&
    uncoupledLength > limits.maxUncoupled;

  // Upstream's gate: gap violations surface only when the pair is already
  // failing its uncoupled length, or when there is no uncoupled rule to fail.
  const reportGaps = uncoupledViolation || limits.maxUncoupled === undefined;

  return {
    coupledLength,
    totalLength,
    uncoupledLength,
    uncoupledViolation,
    gapViolations: reportGaps ? failing : [],
  };
}
