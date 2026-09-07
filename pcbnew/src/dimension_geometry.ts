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
 * ## The label knocks a gap out of the line
 *
 * `CollectKnockedOutSegments` cuts the crossbar (and a radial's leader, and a
 * leader's two lines) where the label's rotated bounding box crosses it, so the
 * number is never struck through. In the default `OUTSIDE` text position the box
 * sits clear of the bar and nothing is cut; it is `INLINE`, which puts the label
 * *on* the bar, that the whole mechanism exists for.
 *
 * This needs the text's bounding box, which `text_metrics.ts` provides — the
 * same `EDA_TEXT::GetTextBox` port the hit tests use.
 *
 * ## What is still deliberately not here
 *
 * A leader's `DIM_TEXT_BORDER::CIRCLE` frame. Upstream draws a `SHAPE_CIRCLE`
 * and stops the two lines on it with `segCircleIntersection`; every shape here
 * is a straight segment, so a circle would have to be faceted into one — an
 * invention rather than a port. A circle-framed leader therefore falls back to
 * the rectangular box for the knockout and draws no frame, which is what it did
 * before. `RECTANGLE` is exact, and `ROUND_RECTANGLE` draws nothing upstream
 * either (it is not in the switch).
 */
import type { PcbDimension } from './types.js';
import { isAlignedKind } from './types.js';
import { segIntersect } from '@ziroeda/kimath/src/geometry/seg.js';
import { textItemBox, textItemHitTest, textPenWidth } from './text_metrics.js';
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

/**
 * `BOX2I::Inflate( dx, dy )` on the label's box, then its four corners rotated
 * about the box centre by the text angle — the `polyBox` every knockout
 * collides against.
 *
 * The vertical inflation is **not** the same for every kind and the signs are
 * easy to lose: aligned *deflates* by the pen width, orthogonal inflates by it,
 * and a leader inflates by twice it. Upstream writes them as three separate
 * literals at three call sites; they are gathered here so the difference is
 * visible rather than accidental.
 */
export function textKnockoutPoly(d: PcbDimension): Vec2[] | null {
  const t = d.text;
  if (!t) return null;

  const pen = iu(textPenWidth(t));
  // `GetTextWidth() / 2` horizontally in every case.
  const dx = Math.trunc(t.size.x / 2);
  const dy = d.kind === 'aligned' ? -pen : d.kind === 'leader' ? pen * 2 : pen;

  // `GetTextBox` hands back a BOX2I, so every edge is already a whole IU
  // upstream; our port computes in floats and has to land on the same lattice
  // before any of the integer geometry below runs.
  const raw = textItemBox(t);
  const box = { x: iu(raw.x), y: iu(raw.y), w: iu(raw.w), h: iu(raw.h) };

  // `Inflate` refuses to deflate a side past nothing, collapsing it to a
  // zero-width box centred where it was (box2.h:558-585).
  const x = box.w < -2 * dx ? box.x + Math.trunc(box.w / 2) : box.x - dx;
  const w = box.w < -2 * dx ? 0 : box.w + 2 * dx;
  const y = box.h < -2 * dy ? box.y + Math.trunc(box.h / 2) : box.y - dy;
  const h = box.h < -2 * dy ? 0 : box.h + 2 * dy;

  const centre = { x: x + Math.trunc(w / 2), y: y + Math.trunc(h / 2) };
  // `polyBox.Append` in upstream's order: origin, (origin.x, end.y), end,
  // (end.x, origin.y) — anticlockwise on screen.
  const corners: Vec2[] = [
    { x, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
    { x: x + w, y },
  ];

  return corners.map((p) => rotateAbout(p, centre, t.angle));
}

/** `RotatePoint( point, centre, angle )`, rounded to whole IU as VECTOR2I is. */
function rotateAbout(p: Vec2, centre: Vec2, deg: number): Vec2 {
  if (deg % 360 === 0) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  // RotatePoint maps (x, y) to (x cos + y sin, -x sin + y cos).
  return { x: iu(centre.x + dx * c + dy * s), y: iu(centre.y - dx * s + dy * c) };
}

/** Even-odd point-in-polygon, `SHAPE_POLY_SET::Contains`. */
function polyContains(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * `segPolyIntersection`: walking from one end of the segment, the first point at
 * which it meets the polygon. `null` when that end is already inside, or when
 * the segment never meets it.
 */
function segPolyIntersection(poly: Vec2[], s: DimSegment, fromA = true): Vec2 | null {
  const start = fromA ? s.a : s.b;
  let endpoint = fromA ? s.b : s.a;

  if (polyContains(poly, start)) return null;

  const d2 = (p: Vec2): number => (p.x - start.x) ** 2 + (p.y - start.y) ** 2;

  for (let i = 0; i < poly.length; i++) {
    const edge = seg(poly[i]!, poly[(i + 1) % poly.length]!);
    // `( *seg ).Intersect( aSeg )` — the shared `SEG::Intersect`, which already
    // carries upstream's int64 cross products, its overflow guard and its
    // collinear-overlap arm. A local copy here had none of the last two.
    const hit = segIntersect(edge, s);
    if (hit && d2(hit) < d2(endpoint)) endpoint = hit;
  }

  if (endpoint.x === start.x && endpoint.y === start.y) return null;
  return endpoint;
}

/**
 * `CollectKnockedOutSegments`: what is left of `s` once `poly` is cut out of it —
 * nought, one or two pieces.
 *
 * A `null` poly (a dimension with no text at all) leaves the segment whole.
 */
export function knockOutSegment(poly: Vec2[] | null, s: DimSegment): DimSegment[] {
  if (!poly) return [s];

  const out: DimSegment[] = [];
  const containsA = polyContains(poly, s.a);
  const containsB = polyContains(poly, s.b);
  const endA = segPolyIntersection(poly, s, true);
  const endB = segPolyIntersection(poly, s, false);

  if (endA) out.push(seg(s.a, endA));

  if (endB) {
    let canAdd = true;
    if (endA) {
      // The degenerate readings upstream guards against: the two walks crossing
      // over, and a zero-length segment meeting the polygon at one point.
      if ((same(endB, s.a) && same(endA, s.b)) || (same(endA, endB) && same(s.a, s.b))) {
        canAdd = false;
      }
    }
    if (canAdd) out.push(seg(endB, s.b));
  }

  if (!containsA && !containsB && !endA && !endB) out.push(s);
  return out;
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * The crossbar `PCB_DIM_ALIGNED::updateGeometry` and
 * `PCB_DIM_ORTHOGONAL::updateGeometry` compute into `m_crossBarStart` /
 * `m_crossBarEnd`, for the two kinds that have one.
 *
 * It is exported because `updateText` places the label off the crossbar's
 * centre, and a second copy of this arithmetic there would be exactly the
 * per-call-site drift the central-value rule forbids: the label would drift off
 * the bar the moment either copy changed.
 */
export function dimensionCrossbar(d: PcbDimension): { start: Vec2; end: Vec2 } | null {
  const height = d.height ?? 0;

  if (d.kind === 'aligned') {
    const v = sub(d.end, d.start);
    // Upstream writes `sign(m_height) * extension.Resize(m_height)`. Both
    // factors carry the sign, so they cancel: the crossbar always sits |height|
    // along the perpendicular that was already chosen for the side.
    const crossBarDist = resize(alignedExtension(d), Math.abs(height));
    return { start: add(d.start, crossBarDist), end: add(d.end, crossBarDist) };
  }

  if (d.kind === 'orthogonal') {
    const horizontal = d.orientation !== 1;
    const ext: Vec2 = horizontal ? { x: 0, y: height } : { x: height, y: 0 };
    const start = add(d.start, resize(ext, Math.abs(height)));
    return {
      start,
      end: horizontal ? { x: d.end.x, y: start.y } : { x: start.x, y: d.end.y },
    };
  }

  return null;
}

/**
 * The perpendicular an aligned dimension hangs its extension lines and crossbar
 * from. Which side it points to is the sign of the height, expressed as the
 * choice of perpendicular rather than as a negative offset.
 */
function alignedExtension(d: PcbDimension): Vec2 {
  const v = sub(d.end, d.start);
  return (d.height ?? 0) > 0 ? { x: -v.y, y: v.x } : { x: v.y, y: -v.x };
}

/** `PCB_DIM_ALIGNED::updateGeometry`. */
function alignedSegments(d: PcbDimension): DimSegment[] {
  const out: DimSegment[] = [];
  const v = sub(d.end, d.start);
  const height = d.height ?? 0;

  const ext = alignedExtension(d);
  const extHeight = Math.abs(height) - d.style.extensionOffset + (d.style.extensionHeight ?? 0);

  for (const p of [d.start, d.end]) {
    const s = add(p, resize(ext, d.style.extensionOffset));
    out.push(seg(s, add(s, resize(ext, extHeight))));
  }

  const bar = dimensionCrossbar(d)!;
  // "Update text after calculating crossbar position but before adding crossbar
  // lines" — the label's box is what decides where the bar is cut.
  out.push(...knockOutSegment(textKnockoutPoly(d), seg(bar.start, bar.end)));

  out.push(...crossbarArrows(d, bar.start, bar.end, v));
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

  const { start: crossStart, end: crossEnd } = dimensionCrossbar(d)!;

  // The second extension line runs from the *crossbar* back to the second
  // feature point, so its length comes from that gap rather than from `height`.
  ext = horizontal ? { x: 0, y: d.end.y - crossEnd.y } : { x: d.end.x - crossEnd.x, y: 0 };
  const extHeight2 = norm(ext) - d.style.extensionOffset + styleExt;
  const s2 = sub(crossEnd, resize(ext, styleExt));
  out.push(seg(s2, add(s2, resize(ext, extHeight2))));

  out.push(...knockOutSegment(textKnockoutPoly(d), seg(crossStart, crossEnd)));
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

/**
 * `PCB_DIM_RADIAL::GetKnee`: where the radial leader bends, one leader-length
 * out along the radius from the measured point.
 *
 * It lives here rather than with the drawing tool because `updateText` needs it
 * too — a radial's label angle is measured from the knee.
 */
export function radialKnee(d: PcbDimension): Vec2 {
  return add(d.end, resize(sub(d.end, d.start), d.leaderLength ?? 0));
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
  const tip = radialKnee(d);
  // Both the leader and the run out to the label are cut by the label's box.
  const poly = textKnockoutPoly(d);
  out.push(...knockOutSegment(poly, seg(d.end, tip)));
  if (d.text) out.push(...knockOutSegment(poly, seg(tip, d.text.at)));
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
  const poly = textKnockoutPoly(d);

  // The arrow line is measured from the *feature point*, not from the offset
  // start — `SEG arrowSeg( m_start, m_end )` — but drawn from the offset start.
  // It stops where it first meets the label, or at the end point if it never
  // does.
  const arrowEnd = (poly && segPolyIntersection(poly, seg(d.start, d.end))) ?? d.end;
  const out = [seg(start, arrowEnd)];

  out.push(...arrowSegments(start, v, d.style.arrowLength));

  if (d.text && d.style.textFrame === 1) {
    // DIM_TEXT_BORDER::RECTANGLE draws the poly box itself.
    for (let i = 0; poly && i < poly.length; i++) {
      out.push(seg(poly[i]!, poly[(i + 1) % poly.length]!));
    }
  }

  // The second line is drawn only when the first reached the end point:
  // `if( textSegEnd && *arrowSegEnd == m_end )`. If the label already swallowed
  // the first line there is nothing left to run out to it.
  if (d.text && same(arrowEnd, d.end)) {
    const textEnd = poly ? segPolyIntersection(poly, seg(d.end, d.text.at)) : d.text.at;
    if (textEnd) out.push(seg(d.end, textEnd));
  }

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
 *
 * `PCB_DIMENSION_BASE::HitTest` (pcb_dimension.cpp:714-730) tries the **text
 * box first** and only then the drawn shapes, widened by half the stroke:
 *
 *     if( TextHitTest( aPosition ) ) return true;
 *     int dist_max = aAccuracy + ( m_lineThickness / 2 );
 *     for( shape : GetShapes() ) if( shape->Collide( aPosition, dist_max ) ) …
 *
 * The text branch is not a nicety. Now that the label knocks a gap out of the
 * crossbar, the shapes no longer run under the number — so without it, clicking
 * an INLINE dimension squarely on its value would select nothing.
 */
export function hitTestDimension(d: PcbDimension, p: Vec2, accuracy = 0): boolean {
  // TextHitTest is called with no accuracy argument, so it takes its default 0.
  if (d.text && d.text.text !== '' && textItemHitTest(d.text, p)) return true;
  return distanceToDimension(d, p) <= d.style.thickness / 2 + accuracy;
}
