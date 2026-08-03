// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The lines a dimension is drawn as, and the value it measures.
 * Counterparts: `PCB_DIM_*::updateGeometry` and
 * `PCB_DIMENSION_BASE::drawAnArrow` (pcbnew/pcb_dimension.cpp).
 *
 * A dimension stores only its two *feature points* — what is being measured.
 * Everything drawn (extension lines, crossbar, arrowheads, centre cross, radial
 * leader) is derived from those plus the style, which is why this has to exist
 * before anything can render or hit-test one.
 *
 * ## The rotation convention
 *
 * Upstream builds arrowheads with `RotatePoint(v, -EDA_ANGLE(u) ± arrowAngle)`.
 * KiCad's `RotatePoint(v, θ)` maps `(x, y)` to `(x·cosθ + y·sinθ, −x·sinθ +
 * y·cosθ)` — clockwise in maths terms, which is counter-clockwise on screen
 * because y points down. Composed with `EDA_ANGLE(u) = atan2(u.y, u.x)`, the
 * whole expression just says "take a vector of this length at this angle *from
 * u*". So the arms are built from u's unit vector rotated by ±27.5°, which is
 * exactly equivalent and avoids reimplementing `EDA_ANGLE`'s special-case table
 * (it hard-codes 0°, ±90°, ±180° and ±45° to dodge float error). The tests pin
 * the equivalence at those very angles.
 *
 * ## What is deliberately not here
 *
 * Upstream knocks a gap out of the crossbar where the dimension text sits
 * (`CollectKnockedOutSegments`), and gives a leader an optional rectangle or
 * circle around its text. Both need the text's bounding box, which needs glyph
 * metrics we do not have — the same limit that keeps text out of the DRC area
 * predicates and the silk-to-silk check. The crossbar is therefore emitted
 * whole. For hit-testing and bounding boxes that is the *safer* answer (a
 * superset of the drawn ink); for rendering it means the text is drawn over an
 * unbroken line rather than into a gap.
 */
import type { PcbDimension } from './types.js';
import { isAlignedKind } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** One drawn line of a dimension. */
export interface DimSegment {
  a: Vec2;
  b: Vec2;
}

/** `s_arrowAngle`: half the arrowhead's opening, in degrees. */
export const ARROW_ANGLE_DEG = 27.5;

/**
 * `INWARD_ARROW_LENGTH_TO_HEAD_RATIO`: an inward arrow also draws a tail, this
 * many arrow-lengths long, so the pair reads as `>-----<` rather than as two
 * bare heads.
 */
export const INWARD_ARROW_LENGTH_TO_HEAD_RATIO = 2;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const norm = (v: Vec2): number => Math.hypot(v.x, v.y);
const seg = (a: Vec2, b: Vec2): DimSegment => ({ a, b });

/** KiCad's `sign()`: -1, 0 or 1. */
const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * `VECTOR2I::Resize`: the same direction, this length. A negative length
 * reverses the direction, which the aligned/orthogonal crossbar arithmetic
 * relies on. A zero-length vector has no direction to keep, so it stays zero.
 */
export function resize(v: Vec2, len: number): Vec2 {
  const n = norm(v);
  if (n === 0) return { x: 0, y: 0 };
  return { x: iu((v.x / n) * len), y: iu((v.y / n) * len) };
}

/**
 * Round to whole internal units, collapsing negative zero.
 *
 * `-0` is contagious through this arithmetic (any zero component times a
 * negative length produces it) and it is not harmless: it compares unequal to
 * `0` under `Object.is`, and the writer already has to special-case the string
 * `"-0"` when serialising.
 */
const iu = (n: number): number => Math.round(n) || 0;

/** Rotate counter-clockwise in maths terms (clockwise on screen, y down). */
function rotateCCW(v: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: iu(v.x * c - v.y * s), y: iu(v.x * s + v.y * c) };
}

/**
 * `PCB_DIMENSION_BASE::drawAnArrow`: two barbs from `at`, opening ±27.5° about
 * `along`, plus an optional tail of `tailLength` in the same direction.
 *
 * The barbs are `arrowLength` long regardless of the tail — the tail is what
 * makes an inward arrow, and its length is a multiple of the head, not the head
 * itself.
 */
export function arrowSegments(
  at: Vec2,
  along: Vec2,
  arrowLength: number,
  tailLength = 0,
): DimSegment[] {
  const out: DimSegment[] = [];
  if (tailLength) out.push(seg(at, add(at, resize(along, tailLength))));
  const head = resize(along, arrowLength);
  out.push(seg(at, add(at, rotateCCW(head, -ARROW_ANGLE_DEG))));
  out.push(seg(at, add(at, rotateCCW(head, ARROW_ANGLE_DEG))));
  return out;
}

/**
 * The number the dimension displays, before formatting, in internal units.
 *
 * An orthogonal dimension measures only one axis — that is the whole point of
 * it — so a diagonal pair of feature points measures its horizontal *or*
 * vertical span, not the distance between them.
 */
export function measuredValue(d: PcbDimension): number {
  const v = sub(d.end, d.start);
  if (d.kind === 'orthogonal') return Math.abs(d.orientation === 1 ? v.y : v.x);
  if (d.kind === 'center') return 0; // marks a point; measures nothing
  return Math.round(norm(v));
}

/** `PCB_DIM_ALIGNED::updateGeometry`. */
function alignedSegments(d: PcbDimension): DimSegment[] {
  const out: DimSegment[] = [];
  const v = sub(d.end, d.start);
  const height = d.height ?? 0;

  // Which side the crossbar sits on is the sign of the height, expressed as the
  // choice of perpendicular rather than as a negative offset.
  const ext: Vec2 = height > 0 ? { x: -v.y, y: v.x } : { x: v.y, y: -v.x };
  const extHeight = Math.abs(height) - d.style.extensionOffset + (d.style.extensionHeight ?? 0);

  for (const p of [d.start, d.end]) {
    const s = add(p, resize(ext, d.style.extensionOffset));
    out.push(seg(s, add(s, resize(ext, extHeight))));
  }

  // Upstream writes `sign(m_height) * extension.Resize(m_height)`. Both factors
  // carry the sign, so they cancel: the crossbar always sits |height| along the
  // perpendicular that was already chosen for the side.
  const crossBarDist = resize(ext, Math.abs(height));
  const crossStart = add(d.start, crossBarDist);
  const crossEnd = add(d.end, crossBarDist);
  out.push(seg(crossStart, crossEnd));

  out.push(...crossbarArrows(d, crossStart, crossEnd, v));
  return out;
}

/** `PCB_DIM_ORTHOGONAL::updateGeometry`. */
function orthogonalSegments(d: PcbDimension): DimSegment[] {
  const out: DimSegment[] = [];
  const horizontal = d.orientation !== 1;
  const height = d.height ?? 0;
  const styleExt = d.style.extensionHeight ?? 0;

  let ext: Vec2 = horizontal ? { x: 0, y: height } : { x: height, y: 0 };
  const extHeight = Math.abs(height) - d.style.extensionOffset + styleExt;

  const s1 = add(d.start, resize(ext, d.style.extensionOffset));
  out.push(seg(s1, add(s1, resize(ext, extHeight))));

  const crossStart = add(d.start, resize(ext, Math.abs(height)));
  const crossEnd: Vec2 = horizontal
    ? { x: d.end.x, y: crossStart.y }
    : { x: crossStart.x, y: d.end.y };

  // The second extension line runs from the *crossbar* back to the second
  // feature point, so its length comes from that gap rather than from `height`.
  ext = horizontal ? { x: 0, y: d.end.y - crossEnd.y } : { x: d.end.x - crossEnd.x, y: 0 };
  const extHeight2 = norm(ext) - d.style.extensionOffset + styleExt;
  const s2 = sub(crossEnd, resize(ext, styleExt));
  out.push(seg(s2, add(s2, resize(ext, extHeight2))));

  out.push(seg(crossStart, crossEnd));
  out.push(...crossbarArrows(d, crossStart, crossEnd, sub(crossEnd, crossStart)));
  return out;
}

/**
 * The arrow pair at each end of a crossbar.
 *
 * Outward arrows point away from the measurement (`<----->`) and have no tail;
 * inward ones point into it (`>-----<`) and grow a tail so the line still reads
 * as a measurement when the arrows have nowhere to sit.
 */
function crossbarArrows(
  d: PcbDimension,
  crossStart: Vec2,
  crossEnd: Vec2,
  along: Vec2,
): DimSegment[] {
  const al = d.style.arrowLength;
  const back: Vec2 = { x: -along.x, y: -along.y };
  if (d.style.arrowDirection === 'inward') {
    const tail = al * INWARD_ARROW_LENGTH_TO_HEAD_RATIO;
    return [
      ...arrowSegments(crossStart, back, al, tail),
      ...arrowSegments(crossEnd, along, al, tail),
    ];
  }
  return [...arrowSegments(crossStart, along, al), ...arrowSegments(crossEnd, back, al)];
}

/** `PCB_DIM_RADIAL::updateGeometry`. */
function radialSegments(d: PcbDimension): DimSegment[] {
  const out: DimSegment[] = [];
  const al = d.style.arrowLength;

  // A cross on the centre, one arm-length each way on both axes.
  const arm: Vec2 = { x: 0, y: al };
  out.push(seg(sub(d.start, arm), add(d.start, arm)));
  const arm90 = rotateCCW(arm, 90);
  out.push(seg(sub(d.start, arm90), add(d.start, arm90)));

  const radial = resize(sub(d.end, d.start), d.leaderLength ?? 0);
  const tip = add(d.end, radial);
  out.push(seg(d.end, tip));
  if (d.text) out.push(seg(tip, d.text.at));
  out.push(...arrowSegments(d.end, radial, al));
  return out;
}

/** `PCB_DIM_CENTER::updateGeometry`: a cross whose arm is the feature vector. */
function centerSegments(d: PcbDimension): DimSegment[] {
  const arm = sub(d.end, d.start);
  const arm90 = rotateCCW(arm, 90);
  return [seg(sub(d.start, arm), add(d.start, arm)), seg(sub(d.start, arm90), add(d.start, arm90))];
}

/**
 * `PCB_DIM_LEADER::updateGeometry`, without the text frame (see file header).
 *
 * The arrow sits at the *offset* start and points back at the feature point,
 * which is what makes a leader call something out rather than measure it.
 * Upstream draws the second line (end to text) only when the first was not
 * clipped by the text box; with no text box the first line always reaches the
 * end, so that branch is the one that applies.
 */
function leaderSegments(d: PcbDimension): DimSegment[] {
  const v = sub(d.end, d.start);
  const start = add(d.start, resize(v, d.style.extensionOffset));
  const out = [seg(start, d.end)];
  if (d.text) out.push(seg(d.end, d.text.at));
  out.push(...arrowSegments(start, v, d.style.arrowLength));
  return out;
}

/** Every line this dimension draws as, in upstream's order. */
export function dimensionSegments(d: PcbDimension): DimSegment[] {
  switch (d.kind) {
    case 'aligned':
      return alignedSegments(d);
    case 'orthogonal':
      return orthogonalSegments(d);
    case 'radial':
      return radialSegments(d);
    case 'center':
      return centerSegments(d);
    case 'leader':
      return leaderSegments(d);
  }
}

/**
 * The dimension's extent, from its lines. Half the stroke is added on every
 * side, since a line is drawn centred on its path.
 *
 * The text is *not* included — measuring it needs glyph metrics, so a caller
 * that has them should union the text box in itself.
 */
export function dimensionBBox(d: PcbDimension): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const segs = dimensionSegments(d);
  const half = d.style.thickness / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const s of segs) {
    for (const p of [s.a, s.b]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (segs.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

/** Shortest distance from `p` to any of the dimension's lines. */
export function distanceToDimension(d: PcbDimension, p: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (const s of dimensionSegments(d)) {
    const vx = s.b.x - s.a.x;
    const vy = s.b.y - s.a.y;
    const len2 = vx * vx + vy * vy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * vx + (p.y - s.a.y) * vy) / len2));
    best = Math.min(best, Math.hypot(p.x - (s.a.x + t * vx), p.y - (s.a.y + t * vy)));
  }
  return best;
}

/**
 * Whether `p` is close enough to count as a click on this dimension.
 * `PCB_DIMENSION_BASE::HitTest` tests the drawn shapes with the accuracy the
 * caller supplies, widened by half the stroke.
 */
export function hitTestDimension(d: PcbDimension, p: Vec2, accuracy = 0): boolean {
  return distanceToDimension(d, p) <= d.style.thickness / 2 + accuracy;
}
