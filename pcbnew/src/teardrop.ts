// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * TEARDROP_MANAGER: the copper flares that widen a track where it meets a pad,
 * a via, or a fatter track. Counterparts: `pcbnew/teardrop/teardrop.cpp`,
 * `pcbnew/teardrop/teardrop_utils.cpp` and `pcbnew/teardrop/teardrop_parameters.h`.
 *
 * A teardrop is not a graphic: upstream builds each one as a ZONE with a fixed
 * fill equal to its own outline, priority-sorted so overlapping teardrops merge
 * predictably. We do the same, so the rest of the board pipeline — plotting,
 * DRC, connectivity — sees teardrops as ordinary copper without special cases.
 *
 * The shape itself is a five-point walk: A and B on the track, C and E on the
 * pad outline, and D behind the pad centre. Straight edges join them directly;
 * curved edges replace B->C and E->A with cubic Beziers. Everything here is
 * integer IU at the pcbnew scale.
 */

import { buildConvexHull } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import {
  chainArea,
  chainIntersect,
  chainIntersectChain,
  type Intersection,
} from '@ziroeda/kimath/src/geometry/seg.js';
import {
  ErrorLoc,
  getArcToSegmentCount,
  transformCircleToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import polygonClipping, { type Geom, type MultiPolygon, type Ring } from 'polygon-clipping';

import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { arcShape, padShapes } from './drc/drc_engine.js';
import { pointInPoly, shapeDist, type Shape } from './drc/drc_geometry.js';
import { shapeToPolygon } from './zone_filler.js';
import type {
  Board,
  PcbArcTrack,
  PcbPad,
  PcbTrack,
  PcbVia,
  PcbZone,
  TeardropParams,
} from './types.js';

// ---------------------------------------------------------------------------
// TEARDROP_PARAMETERS (teardrop_parameters.h)

/** TARGET_TD, the three parameter sets a board carries. */
export enum TargetTd {
  TARGET_ROUND = 0,
  TARGET_RECT = 1,
  TARGET_TRACK = 2,
}

/**
 * TEARDROP_PARAMETERS. Lengths and widths are IU; ratios are 0..1.
 *
 * The same shape the file carries in `(teardrops …)`, so a pad's stored
 * parameters drive the generator directly with nothing to convert.
 */
export type TeardropParameters = TeardropParams;

/** TEARDROP_PARAMETERS::TEARDROP_PARAMETERS, upstream's defaults. */
export function defaultTeardropParameters(): TeardropParameters {
  return {
    tdMaxLen: pcbIUScale.mmToIU(1.0),
    tdMaxWidth: pcbIUScale.mmToIU(2.0),
    bestLengthRatio: 0.5,
    bestWidthRatio: 1.0,
    widthtoSizeFilterRatio: 0.9,
    curvedEdges: false,
    enabled: false,
    allowUseTwoTracks: true,
    tdOnPadsInZones: false,
  };
}

/** TEARDROP_PARAMETERS_LIST, plus its target filters. */
export interface TeardropParametersList {
  round: TeardropParameters;
  rect: TeardropParameters;
  track: TeardropParameters;
  targetVias: boolean;
  targetPTHPads: boolean;
  targetSMDPads: boolean;
  targetTrack2Track: boolean;
  useRoundShapesOnly: boolean;
}

/** TEARDROP_PARAMETERS_LIST::TEARDROP_PARAMETERS_LIST. */
export function defaultTeardropParametersList(): TeardropParametersList {
  return {
    round: defaultTeardropParameters(),
    rect: defaultTeardropParameters(),
    track: defaultTeardropParameters(),
    targetVias: true,
    targetPTHPads: true,
    targetSMDPads: true,
    targetTrack2Track: false,
    useRoundShapesOnly: false,
  };
}

// ---------------------------------------------------------------------------
// Item helpers

/** Either flavour of track: a straight segment or an arc. */
export type TdTrack = PcbTrack | PcbArcTrack;

/** What a teardrop can be anchored to. */
export type TdItem = PcbPad | PcbVia | TdTrack;

const isTrack = (i: TdItem): i is TdTrack => 'start' in i && 'end' in i;
const isArcTrack = (t: TdTrack): t is PcbArcTrack => 'mid' in t;
const isPad = (i: TdItem): i is PcbPad => !isTrack(i) && 'shape' in i;
const isVia = (i: TdItem): i is PcbVia => !isTrack(i) && !isPad(i);

/** ZONE_FILLER's default max error; BOARD_DESIGN_SETTINGS::m_MaxError. */
const DEFAULT_MAX_ERROR = pcbIUScale.mmToIU(0.005);

/** MAGIC_TEARDROP_ZONE_ID, the base priority every teardrop layer counts from. */
export const MAGIC_TEARDROP_ZONE_ID = 30000;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const norm = (a: Vec2): number => Math.hypot(a.x, a.y);
const samePt = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** NormalizeVector, the file-static helper in teardrop_utils.cpp. */
const normalizeVector = (v: Vec2): Vec2 => {
  const n = norm(v);
  return { x: v.x / n, y: v.y / n };
};

/** TEARDROP_MANAGER::GetWidth. */
export function getWidth(item: TdItem): number {
  if (isVia(item)) return item.size;
  if (isPad(item)) return Math.min(item.size.x, item.size.y);
  return item.width;
}

/**
 * TEARDROP_MANAGER::IsRound. Everything that is not a pad is round, and an oval
 * pad counts as round only when it is actually a circle.
 */
export function isRound(item: TdItem): boolean {
  if (!isPad(item)) return true;
  return item.shape === 'circle' || (item.shape === 'oval' && item.size.x === item.size.y);
}

/** The anchor position of a pad or via. */
const itemPosition = (item: TdItem): Vec2 => (isTrack(item) ? item.start : item.at);

/** The track's own centreline length; PCB_TRACK::GetLength. */
function trackLength(track: TdTrack): number {
  if (!isArcTrack(track)) return norm(sub(track.end, track.start));
  const s = arcShape(track.start, track.mid, track.end, track.width);
  return s.kind === 'arc' ? Math.abs(s.sweep) * s.rad : norm(sub(track.end, track.start));
}

/** The pad's or via's copper shapes, for hit tests. */
function itemShapes(item: TdItem): Shape[] {
  if (isVia(item)) return [{ kind: 'circle', c: item.at, r: item.size / 2 }];
  if (isPad(item)) return padShapes(item);
  return isArcTrack(item)
    ? [arcShape(item.start, item.mid, item.end, item.width)]
    : [{ kind: 'stadium', a: item.start, b: item.end, r: item.width / 2 }];
}

/** BOARD_ITEM::HitTest( const VECTOR2I& ) for the items teardrops care about. */
export function hitTestItem(item: TdItem, pt: Vec2): boolean {
  const probe: Shape = { kind: 'circle', c: pt, r: 0 };
  return itemShapes(item).some((s) => shapeDist(probe, s) <= 0);
}

const ringOf = (pts: Vec2[]): Ring => pts.map((p) => [p.x, p.y] as [number, number]);
const ptsOf = (ring: Ring): Vec2[] => ring.map(([x, y]) => ({ x, y }));

/**
 * The item's outline as a single closed ring, the counterpart of upstream's
 * `TransformShapeToPolygon(..., ERROR_INSIDE)` followed by `Outline(0)`.
 *
 * Round items go through {@link transformCircleToPolygon} with upstream's
 * 16-segment floor. Everything else is the union of the pad's DRC shapes, which
 * is the same outline the zone filler and DRC already agree on; taking the
 * largest ring matches `Outline(0)` for the single-body pads that reach here.
 */
export function itemOutline(item: TdItem, maxError = DEFAULT_MAX_ERROR): Vec2[] {
  if (isRound(item)) {
    return transformCircleToPolygon(
      itemPosition(item),
      getWidth(item) / 2,
      maxError,
      ErrorLoc.ERROR_INSIDE,
      16,
    );
  }

  const parts = itemShapes(item).flatMap((s) => shapeToPolygon(s, 0, maxError));

  if (parts.length === 0) return [];

  const merged = polygonClipping.union(parts[0]!, ...parts.slice(1)) as MultiPolygon;
  let best: Vec2[] = [];
  let bestArea = -Infinity;

  for (const poly of merged) {
    if (!poly[0]) continue;
    const pts = ptsOf(poly[0]);
    const area = Math.abs(chainArea(pts));
    if (area > bestArea) {
      bestArea = area;
      best = pts;
    }
  }

  return best;
}

/** A closed chain as a `polygon-clipping` geometry. */
const geomOf = (pts: Vec2[]): Geom => [[...ringOf(pts), ringOf(pts)[0]!]];

/** SHAPE_ARC::ConvertToPolyline for a track arc. */
function arcToPolyline(track: PcbArcTrack, maxError: number, reverse = false): Vec2[] {
  const s = arcShape(track.start, track.mid, track.end, track.width);

  if (s.kind !== 'arc') return reverse ? [track.end, track.start] : [track.start, track.end];

  const steps = Math.max(
    2,
    getArcToSegmentCount(s.rad, maxError, (Math.abs(s.sweep) * 180) / Math.PI),
  );
  const out: Vec2[] = [];

  for (let i = 0; i <= steps; i++) {
    const a = s.a0 + (s.sweep * i) / steps;
    out.push({ x: KiROUND(s.c.x + s.rad * Math.cos(a)), y: KiROUND(s.c.y + s.rad * Math.sin(a)) });
  }

  return reverse ? out.reverse() : out;
}

// ---------------------------------------------------------------------------
// TEARDROP_MANAGER::computeChordThroughShape

const HUGE_CHORD = Number.MAX_SAFE_INTEGER;

/**
 * The copper span the track's centreline cuts through the pad, measured on the
 * extended centreline rather than the segment.
 *
 * This is the filter that separates a real radial entry from a track that just
 * grazes a pad corner on its way past: a graze crosses only a sliver of copper,
 * and a teardrop built on it flares sideways out of the pad.
 */
export function computeChordThroughShape(
  track: TdTrack,
  other: TdItem,
  insidePoint: Vec2,
  maxError = DEFAULT_MAX_ERROR,
): number {
  // Arcs are genuine entries, not the short straight grazes this filter targets.
  if (isArcTrack(track)) return HUGE_CHORD;

  const delta = sub(track.end, track.start);
  const len = norm(delta);

  if (len === 0.0) return HUGE_CHORD;

  const outline = itemOutline(other, maxError);

  if (outline.length < 3) return HUGE_CHORD;

  // Measure the chord on the extended centreline; the bbox diagonal reaches
  // across rotated elongated pads.
  const dir = { x: delta.x / len, y: delta.y / len };
  const mid = {
    x: Math.trunc((track.start.x + track.end.x) / 2),
    y: Math.trunc((track.start.y + track.end.y) / 2),
  };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of outline) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const reach = KiROUND(Math.hypot(maxX - minX, maxY - minY) + len);
  const extStart = { x: mid.x - KiROUND(dir.x * reach), y: mid.y - KiROUND(dir.y * reach) };
  const extEnd = { x: mid.x + KiROUND(dir.x * reach), y: mid.y + KiROUND(dir.y * reach) };

  const pts = chainIntersect(outline, extStart, extEnd);

  // Degenerate/tangent-only crossings should not drop the teardrop.
  if (pts.length < 2) return HUGE_CHORD;

  // Adjacent projected crossings bound copper/air spans; use the one bracketing
  // the inside endpoint.
  const proj = pts.map((hit) => dot(sub(hit.p, extStart), dir)).sort((a, b) => a - b);
  const insideProj = dot(sub(insidePoint, extStart), dir);

  for (let ii = 0; ii + 1 < proj.length; ii++) {
    const half = (proj[ii]! + proj[ii + 1]!) / 2;
    const spanMid = {
      x: extStart.x + KiROUND(dir.x * half),
      y: extStart.y + KiROUND(dir.y * half),
    };

    if (!pointInPoly(spanMid, outline)) continue;

    if (insideProj >= proj[ii]! && insideProj <= proj[ii + 1]!)
      return KiROUND(proj[ii + 1]! - proj[ii]!);
  }

  // Boundary-touch fallback: keep the teardrop.
  return HUGE_CHORD;
}

// ---------------------------------------------------------------------------
// TEARDROP_MANAGER::findTouchingTrack

/** EDA_ITEM_FLAGS as PCB_TRACK::IsPointOnEnds returns them. */
const NO_MATCH = 0;
const STARTPOINT = 1;
const ENDPOINT = 2;

/** PCB_TRACK::IsPointOnEnds. */
function isPointOnEnds(track: TdTrack, pt: Vec2, tolerance: number): number {
  let result = NO_MATCH;
  if (norm(sub(track.start, pt)) <= tolerance) result |= STARTPOINT;
  if (norm(sub(track.end, pt)) <= tolerance) result |= ENDPOINT;
  return result;
}

/**
 * TEARDROP_MANAGER::findTouchingTrack: the single track that continues past
 * `endPoint`. A Y junction has more than one, and upstream keeps the longest.
 */
function findTouchingTrack(
  tracks: readonly TdTrack[],
  trackRef: TdTrack,
  endPoint: Vec2,
  tolerance: number,
): { track: TdTrack; matchType: number } | null {
  let matches = 0;
  let candidate: TdTrack | null = null;
  let matchType = NO_MATCH;

  for (const curr of tracks) {
    if (curr === trackRef) continue;
    if (curr.layer !== trackRef.layer) continue;

    const match = isPointOnEnds(curr, endPoint, tolerance);

    if (!match) continue;

    matches++;

    if (matches > 1 && candidate && trackLength(candidate) >= trackLength(curr)) continue;

    matchType = match;
    candidate = curr;
  }

  return candidate ? { track: candidate, matchType } : null;
}

// ---------------------------------------------------------------------------
// TEARDROP_MANAGER::computeAnchorPoints

/**
 * The two anchor points C and E on the pad/via outline.
 *
 * The trick upstream uses is a convex hull of {track point A, track point B,
 * every pad outline point}: the hull neighbours of A and B are exactly the pad
 * points whose tangent lines from the track are widest, which is what makes the
 * flare hug the pad instead of cutting across it. `pts` is mutated in place.
 */
export function computeAnchorPoints(
  params: TeardropParameters,
  item: TdItem,
  pts: Vec2[],
  maxError = DEFAULT_MAX_ERROR,
): boolean {
  // preferred_width: the pad/via size scaled by the width ratio. For rectangular
  // shapes this comes from the smaller of the X and Y sizes.
  let preferredWidth = KiROUND(getWidth(item) * params.bestWidthRatio);

  // force_clip forces the outline to be clipped to the constraints.
  let forceClip = params.bestWidthRatio < 1.0;

  let outline = itemOutline(item, maxError);

  if (!isRound(item)) {
    // Only pads can have a non-round shape; the teardrop is limited to a band
    // narrower than the pad, so clipping is mandatory.
    forceClip = true;
    preferredWidth = KiROUND(getWidth(item) * params.bestWidthRatio);
  }

  if (outline.length < 3) return false;

  if (forceClip || (params.tdMaxWidth > 0 && params.tdMaxWidth < preferredWidth)) {
    const halfsize =
      Math.trunc(
        (params.tdMaxWidth > 0 ? Math.min(params.tdMaxWidth, preferredWidth) : preferredWidth) / 2,
      ) || 1;

    // The teardrop axis runs from the point on the track to the far point in
    // the pad; the clip is a rectangle of that length, centred on the axis.
    const refOnTrack = {
      x: Math.trunc((pts[0]!.x + pts[1]!.x) / 2),
      y: Math.trunc((pts[0]!.y + pts[1]!.y) / 2),
    };
    const teardropAxis = sub(pts[3]!, refOnTrack);
    const len = norm(teardropAxis);
    const ang = Math.atan2(teardropAxis.y, teardropAxis.x);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);

    // Built horizontal, then rotated onto the axis and moved into place.
    const place = (x: number, y: number): Vec2 => ({
      x: refOnTrack.x + KiROUND(x * ca - y * sa),
      y: refOnTrack.y + KiROUND(x * sa + y * ca),
    });

    const clippingRect = [
      place(0, -halfsize),
      place(0, halfsize),
      place(len, halfsize),
      place(len, -halfsize),
    ];

    const clipped = polygonClipping.intersection(
      geomOf(outline),
      geomOf(clippingRect),
    ) as MultiPolygon;

    let best: Vec2[] = [];
    let bestArea = -Infinity;

    for (const poly of clipped) {
      if (!poly[0]) continue;
      const ring = ptsOf(poly[0]);
      const area = Math.abs(chainArea(ring));
      if (area > bestArea) {
        bestArea = area;
        best = ring;
      }
    }

    outline = best;
  }

  if (outline.length < 3) return false;

  const initialPoints: Vec2[] = [pts[0]!, pts[1]!, ...outline.map((p) => ({ x: p.x, y: p.y }))];
  const hull = buildConvexHull(initialPoints);

  if (hull.length < 3) return false;

  // Find the hull neighbours of the two track points. In some cases only one of
  // them survives into the hull.
  let pointC: Vec2 = pts[2] ?? { x: 0, y: 0 };
  let pointE: Vec2 = pts[4] ?? { x: 0, y: 0 };
  let foundStart = -1;
  let foundEnd = -1;

  const start = pts[0]!;
  const pend = pts[1]!;

  for (let ii = 0; ii < hull.length; ii++) {
    const next = ii + 1 >= hull.length ? 0 : ii + 1;
    const prev = ii - 1 < 0 ? hull.length - 1 : ii - 1;

    if (samePt(hull[ii]!, start)) {
      pointE = samePt(hull[next]!, pend) ? hull[prev]! : hull[next]!;
      foundStart = ii;
    }

    if (samePt(hull[ii]!, pend)) {
      pointC = samePt(hull[next]!, start) ? hull[prev]! : hull[next]!;
      foundEnd = ii;
    }
  }

  if (foundStart < 0) {
    // pointE was never set: the start point is not in the hull.
    const ii = foundEnd - 1 < 0 ? hull.length - 1 : foundEnd - 1;
    pointE = hull[ii]!;
  }

  if (foundEnd < 0) {
    const ii = foundStart - 1 < 0 ? hull.length - 1 : foundStart - 1;
    pointC = hull[ii]!;
  }

  pts[2] = pointC;
  pts[4] = pointE;

  // Which of C/E goes where is decided by area: the assignment that encloses
  // more is the one whose flanks do not cross.
  const area1 = chainArea(pts);
  [pts[2], pts[4]] = [pts[4]!, pts[2]!];
  const area2 = chainArea(pts);

  if (area1 > area2) [pts[2], pts[4]] = [pts[4]!, pts[2]!];

  return true;
}

// ---------------------------------------------------------------------------
// TEARDROP_MANAGER::findAnchorPointsOnTrack

interface TrackAnchors {
  /** Inside the teardrop. */
  startPoint: Vec2;
  /** Outside it. */
  endPoint: Vec2;
  /** Where the track centreline crosses the pad/via edge. */
  intersection: Vec2;
  /** The track the anchors ended up on; may be a second, connected segment. */
  track: TdTrack;
  /** The distance from `startPoint` to the anchor point on the track. */
  effectiveTeardropLen: number;
}

/**
 * TEARDROP_MANAGER::findAnchorPointsOnTrack.
 *
 * When the first segment is shorter than the requested teardrop length and
 * `allowUseTwoTracks` is on, this walks onto the next connected segment — but
 * only one, and only if the bend is under 60°, because the junction transition
 * in {@link computeTeardropPolygon} cannot keep a sharper corner convex.
 */
export function findAnchorPointsOnTrack(
  params: TeardropParameters,
  track: TdTrack,
  other: TdItem,
  allTracks: readonly TdTrack[],
  tolerance: number,
  maxError = DEFAULT_MAX_ERROR,
): TrackAnchors | null {
  let currentTrack = track;
  let start = track.start;
  let end = track.end;

  // Requested length of the teardrop.
  let targetLength = KiROUND(getWidth(other) * params.bestLengthRatio);

  if (params.tdMaxLen > 0) targetLength = Math.min(params.tdMaxLen, targetLength);

  let needSwap = false;

  // One end must be inside the pad/via: make it `start`.
  if (!hitTestItem(other, start)) {
    [start, end] = [end, start];
    needSwap = true;
  }

  const outline = itemOutline(other, maxError);

  if (outline.length < 3) return null;

  // Where the pad/via edge meets the track: the origin of the teardrop length.
  const pts: Intersection[] = isArcTrack(currentTrack)
    ? chainIntersectChain(outline, arcToPolyline(currentTrack, maxError))
    : chainIntersect(outline, start, end);

  // No crossing means the track is wholly inside or wholly outside the shape.
  if (pts.length < 1) return null;

  const intersection = pts[0]!.p;
  start = intersection;

  // The teardrop cannot be longer than the segment it sits on.
  let actualTdLen = Math.min(targetLength, KiROUND(norm(sub(end, start))));
  const refLengthPoint = start;

  if (actualTdLen < targetLength && params.allowUseTwoTracks) {
    let consumed = 0;

    while (actualTdLen + consumed < targetLength) {
      const touching = findTouchingTrack(allTracks, currentTrack, end, tolerance);

      if (!touching) break;

      // A sharp junction bends the teardrop into itself. The transition code
      // handles up to ~60°, so cos(60) = 0.5 is the cut-off.
      const kMinCosForTwoSegmentExtension = 0.5;

      const firstDir = normalizeVector(sub(end, refLengthPoint));
      const secondDir =
        touching.matchType === STARTPOINT
          ? normalizeVector(sub(touching.track.end, touching.track.start))
          : normalizeVector(sub(touching.track.start, touching.track.end));

      if (dot(firstDir, secondDir) < kMinCosForTwoSegmentExtension) break;

      consumed += actualTdLen;
      actualTdLen = Math.min(targetLength - consumed, Math.trunc(trackLength(touching.track)));
      currentTrack = touching.track;
      end = touching.track.end;
      start = touching.track.start;
      needSwap = false;

      if (touching.matchType !== STARTPOINT) {
        [start, end] = [end, start];
        needSwap = true;
      }

      // Never explore more than one connected track.
      break;
    }
  }

  // On an arc the anchor so far sits on the chord, not on the arc. Walk the
  // polyline back from the far end to the first vertex inside `actualTdLen`.
  if (isArcTrack(currentTrack)) {
    const poly = arcToPolyline(currentTrack, maxError, needSwap);

    if (poly.length > 2) {
      // The first point is inside or near the pad; the last is the farthest.
      for (let ii = poly.length - 1; ii >= 0; ii--) {
        const distFromStart = norm(sub(poly[ii]!, start));

        if (distFromStart < actualTdLen || ii === 0) {
          start = poly[ii]!;

          if (ii < poly.length - 1) end = poly[ii + 1]!;

          actualTdLen -= KiROUND(norm(sub(start, refLengthPoint)));

          if (actualTdLen < 0) actualTdLen = 0;

          actualTdLen = Math.min(actualTdLen, KiROUND(norm(sub(end, start))));
          break;
        }
      }
    }
  }

  return {
    startPoint: start,
    endPoint: end,
    intersection,
    track: currentTrack,
    effectiveTeardropLen: actualTdLen,
  };
}

// ---------------------------------------------------------------------------
// Curved flanks

/**
 * TEARDROP_MANAGER::computeCurvedForRoundShape.
 *
 * The control points bias outward along the pad tangent by `weaken`, which
 * falls to zero as the teardrop width approaches the track width — so a
 * teardrop barely wider than its track degenerates smoothly into a straight
 * flare rather than an S-curve.
 */
function computeCurvedForRoundShape(
  params: TeardropParameters,
  poly: Vec2[],
  trackHalfWidth: number,
  trackDir: Vec2,
  other: TdItem,
  otherPos: Vec2,
  pts: Vec2[],
  maxError: number,
): void {
  // A and B on the track (pts[0], pts[1]); C and E on the pad (pts[2], pts[4]);
  // D behind the pad centre (pts[3]).
  let vPercent = params.bestWidthRatio;
  const tdHeight = KiROUND(getWidth(other) * vPercent);

  // Re-derive the ratio from the clamped height: the raw ratio would describe
  // points on a pad size we are not actually using.
  if (params.tdMaxWidth > 0 && params.tdMaxWidth < tdHeight)
    vPercent *= params.tdMaxWidth / tdHeight;

  const radius = Math.trunc(getWidth(other) / 2) || 1;

  const minVpercent = trackHalfWidth / radius;
  const weaken = (vPercent - minVpercent) / (1 - minVpercent) / radius;

  // Where the width is constrained, the hull anchors may sit off the circle.
  // Project them back so the tangents are computed against the true edge.
  const resize = (v: Vec2, len: number): Vec2 => {
    const n = norm(v);
    return n === 0 ? v : { x: KiROUND((v.x * len) / n), y: KiROUND((v.y * len) / n) };
  };

  let vecC = sub(pts[2]!, otherPos);
  const distC = norm(vecC);

  if (distC > 0 && Math.abs(distC - radius) > maxError) {
    pts[2] = { x: otherPos.x + resize(vecC, radius).x, y: otherPos.y + resize(vecC, radius).y };
    vecC = sub(pts[2]!, otherPos);
  }

  let vecE = sub(pts[4]!, otherPos);
  const distE = norm(vecE);

  if (distE > 0 && Math.abs(distE - radius) > maxError) {
    pts[4] = { x: otherPos.x + resize(vecE, radius).x, y: otherPos.y + resize(vecE, radius).y };
    vecE = sub(pts[4]!, otherPos);
  }

  const biasBC = 0.5 * norm(sub(pts[2]!, pts[1]!));
  const biasAE = 0.5 * norm(sub(pts[0]!, pts[4]!));

  const tangentC = {
    x: pts[2]!.x - vecC.y * biasBC * weaken,
    y: pts[2]!.y + vecC.x * biasBC * weaken,
  };
  const tangentE = {
    x: pts[4]!.x + vecE.y * biasAE * weaken,
    y: pts[4]!.y - vecE.x * biasAE * weaken,
  };

  const tangentB = { x: pts[1]!.x - trackDir.x * biasBC, y: pts[1]!.y - trackDir.y * biasBC };
  const tangentA = { x: pts[0]!.x - trackDir.x * biasAE, y: pts[0]!.y - trackDir.y * biasAE };

  for (const corner of new BezierPoly(pts[1]!, tangentB, tangentC, pts[2]!).getPoly(maxError))
    poly.push(corner);

  poly.push(pts[3]!);

  for (const corner of new BezierPoly(pts[4]!, tangentE, tangentA, pts[0]!).getPoly(maxError))
    poly.push(corner);
}

/**
 * computeCornerTangentControlPoint: a control point on the tangent to a corner
 * arc at `anchor`, pointing the way `desiredDir` does.
 */
function computeCornerTangentControlPoint(
  anchor: Vec2,
  cornerCenter: Vec2,
  bias: number,
  desiredDir: Vec2,
): Vec2 {
  const radial = sub(anchor, cornerCenter);

  if (norm(radial) === 0) return anchor;

  // Two perpendiculars; take the one that points toward the track.
  const tangent1 = { x: radial.y, y: -radial.x };
  const tangent2 = { x: -radial.y, y: radial.x };
  const tangent = dot(tangent1, desiredDir) > dot(tangent2, desiredDir) ? tangent1 : tangent2;

  const n = norm(tangent);

  if (n === 0) return anchor;

  const len = KiROUND(bias);
  return {
    x: anchor.x + KiROUND((tangent.x * len) / n),
    y: anchor.y + KiROUND((tangent.y * len) / n),
  };
}

/** Rotate into the pad's own frame; KiCad's RotatePoint sense (y down). */
function toLocal(pt: Vec2, padPos: Vec2, angleDeg: number): Vec2 {
  const p = sub(pt, padPos);
  const a = (angleDeg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) + p.y * Math.sin(a), y: p.y * Math.cos(a) - p.x * Math.sin(a) };
}

/** The inverse of {@link toLocal}. */
function toBoard(pt: Vec2, padPos: Vec2, angleDeg: number): Vec2 {
  const a = (-angleDeg * Math.PI) / 180;
  return {
    x: padPos.x + KiROUND(pt.x * Math.cos(a) + pt.y * Math.sin(a)),
    y: padPos.y + KiROUND(pt.y * Math.cos(a) - pt.x * Math.sin(a)),
  };
}

/** isPointOnOvalEnd: is the anchor on one of a stadium's semicircular caps? */
function isPointOnOvalEnd(point: Vec2, padPos: Vec2, padSize: Vec2, rotation: number): Vec2 | null {
  const localPt = toLocal(point, padPos, rotation);

  const halfW = Math.trunc(padSize.x / 2);
  const halfH = Math.trunc(padSize.y / 2);

  const radius = Math.min(halfW, halfH);
  const isHorizontal = halfW > halfH;

  let center: Vec2;

  if (isHorizontal) {
    const centerOffset = halfW - radius;
    if (Math.abs(localPt.x) <= centerOffset) return null;
    center = { x: localPt.x > 0 ? centerOffset : -centerOffset, y: 0 };
  } else {
    const centerOffset = halfH - radius;
    if (Math.abs(localPt.y) <= centerOffset) return null;
    center = { x: 0, y: localPt.y > 0 ? centerOffset : -centerOffset };
  }

  return toBoard(center, padPos, rotation);
}

/** isPointOnRoundedCorner: is the anchor inside a roundrect's corner arc? */
function isPointOnRoundedCorner(
  point: Vec2,
  padPos: Vec2,
  padSize: Vec2,
  cornerRadius: number,
  rotation: number,
): Vec2 | null {
  const localPt = toLocal(point, padPos, rotation);

  const innerHalfW = Math.trunc(padSize.x / 2) - cornerRadius;
  const innerHalfH = Math.trunc(padSize.y / 2) - cornerRadius;

  if (!(Math.abs(localPt.x) > innerHalfW) || !(Math.abs(localPt.y) > innerHalfH)) return null;

  return toBoard(
    {
      x: localPt.x > 0 ? innerHalfW : -innerHalfW,
      y: localPt.y > 0 ? innerHalfH : -innerHalfH,
    },
    padPos,
    rotation,
  );
}

/** PAD::GetRoundRectCornerRadius. */
const roundRectCornerRadius = (pad: PcbPad): number =>
  KiROUND(Math.min(pad.size.x, pad.size.y) * (pad.roundrectRatio ?? 0.25));

/**
 * TEARDROP_MANAGER::computeCurvedForRectShape.
 *
 * A midpoint control point is fine on a straight pad edge but drives the curve
 * straight through a rounded corner, so where the anchor lands on an arc the
 * control point is taken along that arc's tangent instead.
 */
function computeCurvedForRectShape(
  poly: Vec2[],
  pts: Vec2[],
  intersection: Vec2,
  other: TdItem,
  otherPos: Vec2,
  maxError: number,
): void {
  // side1 runs from track to via; side2 from via back to track.
  const side1 = sub(pts[2]!, pts[1]!);
  const side2 = sub(pts[4]!, pts[0]!);

  const trackDir = sub(intersection, {
    x: Math.trunc((pts[0]!.x + pts[1]!.x) / 2),
    y: Math.trunc((pts[0]!.y + pts[1]!.y) / 2),
  });

  let isRoundRect = false;
  let isOval = false;
  let cornerRadius = 0;
  let padSize: Vec2 = { x: 0, y: 0 };
  let padRotation = 0;

  if (isPad(other)) {
    if (other.shape === 'roundrect') {
      isRoundRect = true;
      cornerRadius = roundRectCornerRadius(other);
      padSize = other.size;
      padRotation = other.angle;
    } else if (other.shape === 'oval') {
      isOval = true;
      padSize = other.size;
      padRotation = other.angle;
    }
  }

  const resize = (v: Vec2, len: number): Vec2 => {
    const n = norm(v);
    return n === 0 ? { x: 0, y: 0 } : { x: KiROUND((v.x * len) / n), y: KiROUND((v.y * len) / n) };
  };

  const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
    x: Math.trunc((a.x + b.x) / 2),
    y: Math.trunc((a.y + b.y) / 2),
  });

  // Direction from the pad anchor back toward the track.
  const towardTrack = { x: -trackDir.x, y: -trackDir.y };

  // First Bezier: track point B to pad point C.
  const d1 = resize(trackDir, norm(side1) / 4);
  const ctrl1a = { x: pts[1]!.x + d1.x, y: pts[1]!.y + d1.y };
  let ctrl2a = midpoint(pts[2]!, intersection);

  if (isRoundRect && cornerRadius > 0) {
    const cc = isPointOnRoundedCorner(pts[2]!, otherPos, padSize, cornerRadius, padRotation);
    if (cc) ctrl2a = computeCornerTangentControlPoint(pts[2]!, cc, 0.5 * norm(side1), towardTrack);
  } else if (isOval) {
    const ac = isPointOnOvalEnd(pts[2]!, otherPos, padSize, padRotation);
    if (ac) ctrl2a = computeCornerTangentControlPoint(pts[2]!, ac, 0.5 * norm(side1), towardTrack);
  }

  for (const corner of new BezierPoly(pts[1]!, ctrl1a, ctrl2a, pts[2]!).getPoly(maxError))
    poly.push(corner);

  poly.push(pts[3]!);

  // Second Bezier: pad point E to track point A.
  let ctrl1b = midpoint(pts[4]!, intersection);

  if (isRoundRect && cornerRadius > 0) {
    const cc = isPointOnRoundedCorner(pts[4]!, otherPos, padSize, cornerRadius, padRotation);
    if (cc) ctrl1b = computeCornerTangentControlPoint(pts[4]!, cc, 0.5 * norm(side2), towardTrack);
  } else if (isOval) {
    const ac = isPointOnOvalEnd(pts[4]!, otherPos, padSize, padRotation);
    if (ac) ctrl1b = computeCornerTangentControlPoint(pts[4]!, ac, 0.5 * norm(side2), towardTrack);
  }

  const d2 = resize(trackDir, norm(side2) / 4);
  const ctrl2b = { x: pts[0]!.x + d2.x, y: pts[0]!.y + d2.y };

  for (const corner of new BezierPoly(pts[4]!, ctrl1b, ctrl2b, pts[0]!).getPoly(maxError))
    poly.push(corner);
}

// ---------------------------------------------------------------------------
// TEARDROP_MANAGER::computeTeardropPolygon

/**
 * TEARDROP_MANAGER::computeTeardropPolygon: the corner list of one teardrop, or
 * null when the geometry cannot support one.
 */
export function computeTeardropPolygon(
  params: TeardropParameters,
  track: TdTrack,
  other: TdItem,
  otherPos: Vec2,
  allTracks: readonly TdTrack[] = [],
  tolerance = pcbIUScale.mmToIU(0.01),
  maxError = DEFAULT_MAX_ERROR,
): Vec2[] | null {
  const originalTrack = track;
  const anchors = findAnchorPointsOnTrack(params, track, other, allTracks, tolerance, maxError);

  if (!anchors) return null;

  const { startPoint: start, endPoint: end, intersection } = anchors;
  const trackStubLen = anchors.effectiveTeardropLen;
  const activeTrack = anchors.track;

  // A zero-length anchor segment gives no direction to build from.
  if (samePt(start, end)) return null;

  const vecT = normalizeVector(sub(end, start));

  // When the anchors span two segments, `start` is the junction, which is not
  // the same point as `intersection` on the pad edge. The via-side geometry must
  // follow how the track *enters* the pad, so it keeps the first segment's
  // direction. Arcs move `start` too, but keep the same track pointer, so they
  // are correctly excluded here.
  const twoSegments = activeTrack !== originalTrack;

  // A first segment so short that the junction lands on the pad edge would
  // normalise a zero vector; fall back to the second segment's direction.
  let vecVia = vecT;
  if (twoSegments && !samePt(start, intersection))
    vecVia = normalizeVector(sub(start, intersection));

  // The sharp end of the teardrop, two points across the track.
  const trackHalfWidth = Math.trunc(activeTrack.width / 2);
  const pointB = {
    x: start.x + KiROUND(vecT.x * trackStubLen + vecT.y * trackHalfWidth),
    y: start.y + KiROUND(vecT.y * trackStubLen - vecT.x * trackHalfWidth),
  };
  const pointA = {
    x: start.x + KiROUND(vecT.x * trackStubLen - vecT.y * trackHalfWidth),
    y: start.y + KiROUND(vecT.y * trackStubLen + vecT.x * trackHalfWidth),
  };

  // A and B must be outside the pad, which pads with very different X and Y
  // sizes can violate.
  if (!isRound(other)) {
    if (hitTestItem(other, pointA)) return null;
    if (hitTestItem(other, pointB)) return null;
  }

  // pointD sits behind the pad centre. For an off-centre entry the centre is
  // projected onto the track axis, so the teardrop stays symmetric about the
  // track rather than skewing toward the pad centre.
  const padRadius = Math.trunc(getWidth(other) / 2);
  const intToPad = sub(otherPos, intersection);
  const projOnTrack = -dot(intToPad, vecVia);
  let effectiveDist = Math.max(projOnTrack, padRadius);
  const offset = pcbIUScale.mmToIU(0.001);

  const outline = itemOutline(other, maxError);

  if (!isRound(other) && isPad(other)) {
    // Clamp pointD to the pad's far edge. Without this, an oblique track that
    // only grazes a corner of an elongated pad sends pointD spiking out the
    // side, because the projection is measured along an axis that crosses the
    // pad instead of entering its body.
    let boundingRadius = 0;
    for (const p of outline) boundingRadius = Math.max(boundingRadius, norm(sub(p, otherPos)));

    const reach = effectiveDist + 2.0 * boundingRadius + offset;
    const rayEnd = {
      x: intersection.x + KiROUND(-vecVia.x * reach),
      y: intersection.y + KiROUND(-vecVia.y * reach),
    };

    let farEdge = 0;

    for (const hit of chainIntersect(outline, intersection, rayEnd)) {
      // Ignore the crossing at the intersection point itself.
      const d = norm(sub(hit.p, intersection));
      if (d > offset) farEdge = Math.max(farEdge, d);
    }

    // farEdge == 0 is a tangential graze: collapse pointD onto the entry so the
    // teardrop simply flares from the track to the pad edge.
    effectiveDist = Math.min(effectiveDist, Math.max(0.0, farEdge - 2.0 * offset));
  } else {
    // For round shapes, solve for the far intersection of the ray with the pad
    // circle. The padRadius floor overshoots whenever the teardrop axis is not
    // radial — a two-segment teardrop whose first segment grazes tangentially
    // projects near zero, and the floor would then push pointD out into a spike.
    const R = padRadius;
    const distCenterSq = intToPad.x * intToPad.x + intToPad.y * intToPad.y;
    const disc = projOnTrack * projOnTrack - (distCenterSq - R * R);

    if (disc >= 0) {
      const farEdge = projOnTrack + Math.sqrt(disc);
      const maxAllowed = Math.max(0.0, farEdge - 2.0 * offset);
      if (effectiveDist > maxAllowed) effectiveDist = maxAllowed;
    }
  }

  const pointD = {
    x: intersection.x + KiROUND(-vecVia.x * (effectiveDist + offset)),
    y: intersection.y + KiROUND(-vecVia.y * (effectiveDist + offset)),
  };

  // Where the track changes direction, take the first segment's side of the
  // junction as the hull anchor so C and E stay oriented to the via entry axis.
  let junctionBSeg2: Vec2 = { x: 0, y: 0 };
  let junctionBSeg1: Vec2 = { x: 0, y: 0 };
  let junctionASeg2: Vec2 = { x: 0, y: 0 };
  let junctionASeg1: Vec2 = { x: 0, y: 0 };

  if (twoSegments) {
    junctionBSeg2 = {
      x: start.x + KiROUND(vecT.y * trackHalfWidth),
      y: start.y + KiROUND(-vecT.x * trackHalfWidth),
    };
    junctionASeg2 = {
      x: start.x + KiROUND(-vecT.y * trackHalfWidth),
      y: start.y + KiROUND(vecT.x * trackHalfWidth),
    };
    junctionBSeg1 = {
      x: start.x + KiROUND(vecVia.y * trackHalfWidth),
      y: start.y + KiROUND(-vecVia.x * trackHalfWidth),
    };
    junctionASeg1 = {
      x: start.x + KiROUND(-vecVia.y * trackHalfWidth),
      y: start.y + KiROUND(vecVia.x * trackHalfWidth),
    };
  }

  // On the inside of a bend the seg2 junction point backtracks and would
  // self-intersect; drop it on whichever side that happens.
  let skipJunctionA = false;
  let skipJunctionB = false;

  if (twoSegments) {
    skipJunctionA = dot(sub(junctionASeg2, junctionASeg1), sub(pointA, junctionASeg1)) < 0;
    skipJunctionB = dot(sub(junctionBSeg2, junctionBSeg1), sub(pointB, junctionBSeg1)) < 0;
  }

  const anchorA = twoSegments ? junctionASeg1 : pointA;
  const anchorB = twoSegments ? junctionBSeg1 : pointB;

  const pts: Vec2[] = [anchorA, anchorB, { x: 0, y: 0 }, pointD, { x: 0, y: 0 }];

  if (!computeAnchorPoints(params, other, pts, maxError)) return null;

  // For an off-centre entry the hull gives asymmetric anchors (C and E at
  // different distances from the track axis). Rebuild them symmetric so the
  // flare opens evenly on both sides.
  if (isRound(other)) {
    const perpVia = { x: -vecVia.y, y: vecVia.x };
    const padOffset = sub(otherPos, intersection);
    const perpDistToCenter = dot(padOffset, perpVia);

    if (Math.abs(perpDistToCenter) > padRadius * 0.1) {
      const d = Math.abs(perpDistToCenter);

      if (d < padRadius) {
        // The shorter side bounds the symmetric half-width: the distance from
        // the track axis to the near circle edge.
        const maxSymmetric = padRadius - d;

        const preferredWidth = KiROUND(getWidth(other) * params.bestWidthRatio);
        let maxHalfWidth = Math.trunc(preferredWidth / 2);

        if (params.tdMaxWidth > 0)
          maxHalfWidth = Math.min(maxHalfWidth, Math.trunc(params.tdMaxWidth / 2));

        const symHalfWidth = Math.min(maxSymmetric, maxHalfWidth);

        if (symHalfWidth > trackHalfWidth) {
          const R = padRadius;
          const projAlongTrack = dot(padOffset, vecVia);

          // Intersect the line parallel to the track at `perpDist` with the pad
          // circle, keeping the root on the track-entry side.
          const findCircleLineIntersection = (perpDist: number): Vec2 => {
            const lineOrigin = {
              x: intersection.x + vecVia.x * projAlongTrack + perpVia.x * perpDist,
              y: intersection.y + vecVia.y * projAlongTrack + perpVia.y * perpDist,
            };
            const oc = sub(lineOrigin, otherPos);
            const bCoeff = dot(oc, vecVia);
            const cCoeff = oc.x * oc.x + oc.y * oc.y - R * R;
            const disc = bCoeff * bCoeff - cCoeff;

            if (disc < 0) return { x: KiROUND(lineOrigin.x), y: KiROUND(lineOrigin.y) };

            const sqrtDisc = Math.sqrt(disc);
            const t1 = -bCoeff - sqrtDisc;
            const t2 = -bCoeff + sqrtDisc;
            const p1 = { x: lineOrigin.x + vecVia.x * t1, y: lineOrigin.y + vecVia.y * t1 };
            const p2 = { x: lineOrigin.x + vecVia.x * t2, y: lineOrigin.y + vecVia.y * t2 };

            const pick = norm(sub(p1, intersection)) < norm(sub(p2, intersection)) ? p1 : p2;
            return { x: KiROUND(pick.x), y: KiROUND(pick.y) };
          };

          // pointA is offset along +perpVia and pointB along -perpVia. In the
          // walk A->B->C->D->E->A, C is adjacent to B and E to A, so C takes the
          // -perpVia side and E the +perpVia side. Swapping them folds the
          // polygon into a bowtie.
          pts[2] = findCircleLineIntersection(-symHalfWidth);
          pts[4] = findCircleLineIntersection(symHalfWidth);
        }
      }
    }
  }

  const corners: Vec2[] = [];

  if (!params.curvedEdges) {
    if (twoSegments) {
      corners.push(pointA);
      corners.push(pointB);
      if (!skipJunctionB) corners.push(junctionBSeg2);
      corners.push(pts[1]!); // junctionB_seg1
      corners.push(pts[2]!); // C
      corners.push(pts[3]!); // D
      corners.push(pts[4]!); // E
      corners.push(pts[0]!); // junctionA_seg1
      if (!skipJunctionA) corners.push(junctionASeg2);
    } else {
      corners.push(...pts);
    }

    return corners;
  }

  if (isRound(other)) {
    if (twoSegments) {
      const curvePoly: Vec2[] = [];
      computeCurvedForRoundShape(
        params,
        curvePoly,
        trackHalfWidth,
        vecVia,
        other,
        otherPos,
        pts,
        maxError,
      );
      corners.push(pointB);
      if (!skipJunctionB) corners.push(junctionBSeg2);
      corners.push(...curvePoly);
      if (!skipJunctionA) corners.push(junctionASeg2);
      corners.push(pointA);
    } else {
      computeCurvedForRoundShape(
        params,
        corners,
        trackHalfWidth,
        vecT,
        other,
        otherPos,
        pts,
        maxError,
      );
    }
  } else if (twoSegments) {
    const curvePoly: Vec2[] = [];
    computeCurvedForRectShape(curvePoly, pts, intersection, other, otherPos, maxError);
    corners.push(pointB);
    if (!skipJunctionB) corners.push(junctionBSeg2);
    corners.push(...curvePoly);
    if (!skipJunctionA) corners.push(junctionASeg2);
    corners.push(pointA);
  } else {
    computeCurvedForRectShape(corners, pts, intersection, other, otherPos, maxError);
  }

  return corners;
}

// ---------------------------------------------------------------------------
// The manager

/** TEARDROP_TYPE. */
export type TeardropType = 'viapad' | 'trackend';

/** A teardrop zone, plus the bookkeeping the priority pass needs. */
export interface Teardrop {
  type: TeardropType;
  layer: string;
  net: number;
  corners: Vec2[];
  /** Set by the priority pass; MAGIC_TEARDROP_ZONE_ID and up, per layer. */
  priority: number;
  /** The absolute outline area, the priority sort key. */
  outlineArea: number;
}

/** Per-item parameter lookup; return null to leave an item alone. */
export type TeardropParamsFor = (item: TdItem) => TeardropParameters | null;

/** Options for {@link updateTeardrops}. */
export interface UpdateTeardropsOptions {
  /** Per-pad/via parameters. Defaults to the board's target-type defaults. */
  paramsFor?: TeardropParamsFor;
  /** TEARDROP_PARAMETERS_LIST; used for the track-to-track pass and defaults. */
  list?: TeardropParametersList;
  maxError?: number;
}

/** ZONE::CalculateOutlineArea. */
const outlineArea = (corners: Vec2[]): number => Math.abs(chainArea(corners));

/** Every track and arc on the board, in file order. */
const allBoardTracks = (board: Board): TdTrack[] => [...board.tracks, ...board.arcs];

/**
 * areItemsInSameZone: does a filled copper zone on the track's layer already
 * connect the pad and the track?
 *
 * A pad a zone already floods has no annular ring for a teardrop to strengthen,
 * so upstream skips it unless `tdOnPadsInZones` says otherwise.
 */
export function areItemsInSameZone(board: Board, padOrVia: TdItem, track: TdTrack): boolean {
  const padPos = itemPosition(padOrVia);

  for (const zone of board.zones) {
    // Skip teardrops.
    if (zone.teardropType) continue;
    if (!zone.layers.includes(track.layer)) continue;
    if (zone.net !== track.net) continue;

    const fill = zone.fills.find((f) => f.layer === track.layer);

    if (!fill || fill.polys.length === 0) continue;

    // The outline may contain both items while the *fill* does not reach them,
    // because of thermal gaps, min width or island removal — so test the fill.
    const contains = (p: Vec2): boolean => fill.polys.some((ring) => pointInPoly(p, ring));

    if (!contains(padPos)) continue;
    if (!contains(track.start) && !contains(track.end)) continue;

    if (isPad(padOrVia) && zone.padConnection === 'none') return false;

    return true;
  }

  return false;
}

/** Pads that a track touches, on the track's layer and net. */
function connectedPads(board: Board, track: TdTrack): PcbPad[] {
  const out: PcbPad[] = [];
  const trackShape = itemShapes(track)[0]!;

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (pad.net !== track.net) continue;
      if (!pad.layers.some((l) => l === track.layer || l === '*.Cu')) continue;
      if (padShapes(pad).some((s) => shapeDist(trackShape, s) <= 0)) out.push(pad);
    }
  }

  return out;
}

/** Vias that a track touches, on the track's net. */
function connectedVias(board: Board, track: TdTrack): PcbVia[] {
  const trackShape = itemShapes(track)[0]!;

  return board.vias.filter(
    (via) =>
      via.net === track.net &&
      shapeDist(trackShape, { kind: 'circle', c: via.at, r: via.size / 2 }) <= 0,
  );
}

/** The parameter set a pad or via falls under, by shape. */
function defaultParamsFor(list: TeardropParametersList, item: TdItem): TeardropParameters | null {
  // The item's own `(teardrops …)` wins, as PAD::GetTeardropParams does: the
  // board-level list only supplies what an item never overrode.
  const own = isTrack(item) ? undefined : item.teardrops;

  if (isVia(item)) return list.targetVias ? (own ?? list.round) : null;

  if (isPad(item)) {
    const isPTH = item.type === 'thru_hole';

    if (isPTH && !list.targetPTHPads) return null;
    if (!isPTH && !list.targetSMDPads) return null;

    if (isRound(item)) return own ?? list.round;
    if (list.useRoundShapesOnly) return null;
    return own ?? list.rect;
  }

  return list.track;
}

/**
 * TEARDROP_MANAGER::setTeardropPriorities: group by layer, then by decreasing
 * outline area, counting up from MAGIC_TEARDROP_ZONE_ID within each layer.
 *
 * The area ordering is what makes overlaps deterministic — the bigger teardrop
 * always ends up underneath, so a small one nested inside it is never erased.
 */
export function setTeardropPriorities(teardrops: Teardrop[]): void {
  teardrops.sort((a, b) => {
    if (a.layer === b.layer) {
      if (a.outlineArea !== b.outlineArea) return b.outlineArea - a.outlineArea;
      return 0;
    }
    return a.layer < b.layer ? -1 : 1;
  });

  let currLayer: string | null = null;
  let priorityBase = MAGIC_TEARDROP_ZONE_ID;

  for (const td of teardrops) {
    if (td.layer !== currLayer) {
      currLayer = td.layer;
      priorityBase = MAGIC_TEARDROP_ZONE_ID;
    }

    td.priority = priorityBase++;
  }
}

/**
 * TEARDROP_MANAGER::AddTeardropsOnTracks: teardrops where a thin track meets a
 * fat one end to end.
 */
export function addTeardropsOnTracks(
  board: Board,
  list: TeardropParametersList,
  tolerance: number,
  maxError: number,
): Teardrop[] {
  const params = { ...list.track };
  const out: Teardrop[] = [];
  const tracks = allBoardTracks(board);

  // Group by layer and net, as TRACK_BUFFER does.
  const groups = new Map<string, TdTrack[]>();

  for (const t of tracks) {
    const key = `${t.layer}|${t.net}`;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  for (const sublist of groups.values()) {
    if (sublist.length <= 1) continue; // At least 2 segments are needed.

    sublist.sort((a, b) => a.width - b.width);

    if (sublist[sublist.length - 1]!.width === sublist[0]!.width) continue;

    for (let ii = 0; ii < sublist.length - 1; ii++) {
      const track = sublist[ii]!;
      const trackLen = Math.trunc(trackLength(track));

      // A threshold keeps two similar widths from earning a teardrop.
      params.widthtoSizeFilterRatio = Math.max(params.widthtoSizeFilterRatio, 0.1);
      const th = 1.0 / params.widthtoSizeFilterRatio;
      const minWidth = KiROUND(track.width * th);

      for (let jj = ii + 1; jj < sublist.length; jj++) {
        const candidate = sublist[jj]!;

        if (minWidth >= candidate.width) continue;

        // The track must be longer than the candidate's radius.
        if (trackLen <= candidate.width / 2) continue;

        let pos = candidate.start;
        let matchPoints = isPointOnEnds(track, pos, tolerance);

        if (!matchPoints) {
          pos = candidate.end;
          matchPoints = isPointOnEnds(track, pos, tolerance);
        }

        if (!matchPoints) continue;

        // Pads and vias have priority: skip if one already sits here.
        const existingPadOrVia =
          connectedPads(board, track).some((pad) => hitTestItem(pad, pos)) ||
          connectedVias(board, track).some((via) => hitTestItem(via, pos));

        if (existingPadOrVia) continue;

        const corners = computeTeardropPolygon(
          params,
          track,
          candidate,
          pos,
          tracks,
          tolerance,
          maxError,
        );

        if (corners) {
          out.push({
            type: 'trackend',
            layer: track.layer,
            net: track.net,
            corners,
            priority: MAGIC_TEARDROP_ZONE_ID,
            outlineArea: outlineArea(corners),
          });
        }
      }
    }
  }

  return out;
}

/**
 * TEARDROP_MANAGER::UpdateTeardrops, the full-rebuild path.
 *
 * Only the full rebuild is ported: the incremental dirty-item path exists
 * upstream to avoid recomputing a whole board on every edit, and rebuilding all
 * of them is the same answer, just slower.
 */
export function updateTeardrops(board: Board, opts: UpdateTeardropsOptions = {}): Teardrop[] {
  const list = opts.list ?? defaultTeardropParametersList();
  const maxError = opts.maxError ?? DEFAULT_MAX_ERROR;
  const paramsFor = opts.paramsFor ?? ((item: TdItem) => defaultParamsFor(list, item));

  // m_tolerance, as UpdateTeardrops sets it.
  const tolerance = pcbIUScale.mmToIU(0.01);

  const tracks = allBoardTracks(board);
  const out: Teardrop[] = [];

  const build = (params: TeardropParameters, track: TdTrack, other: TdItem, pos: Vec2): void => {
    const corners = computeTeardropPolygon(params, track, other, pos, tracks, tolerance, maxError);

    if (!corners) return;

    out.push({
      type: 'viapad',
      layer: track.layer,
      net: track.net,
      corners,
      priority: MAGIC_TEARDROP_ZONE_ID,
      outlineArea: outlineArea(corners),
    });
  };

  for (const track of tracks) {
    for (const other of [...connectedPads(board, track), ...connectedVias(board, track)]) {
      const params = paramsFor(other);

      if (!params?.enabled) continue;

      const annularWidth = getWidth(other);

      // A teardrop only makes sense where the track is thinner than the pad.
      if (
        track.width >= params.tdMaxWidth ||
        track.width >= annularWidth * params.bestWidthRatio ||
        track.width >= annularWidth * params.widthtoSizeFilterRatio
      ) {
        continue;
      }

      const startHits = hitTestItem(other, track.start);
      const endHits = hitTestItem(other, track.end);

      // Wholly inside: there is no outside end to flare from.
      if (startHits && endHits) continue;

      // Reject tangential grazes, but keep short radial entries.
      if (
        startHits !== endHits &&
        computeChordThroughShape(track, other, startHits ? track.start : track.end, maxError) <
          track.width
      ) {
        continue;
      }

      // A zone that already connects both leaves nothing to strengthen.
      if (isPad(other) && !params.tdOnPadsInZones && areItemsInSameZone(board, other, track))
        continue;

      const pos = itemPosition(other);

      build(params, track, other, pos);

      // A track can cross clean through a pad, which earns a teardrop at each
      // end — but only when the pad's centre is actually on the track, or the
      // two shapes come out wrong.
      if (!startHits && !endHits && hitTestItem(track, pos)) {
        const base = { ...track } as TdTrack;
        build(params, { ...base, start: track.end, end: pos } as TdTrack, other, pos);
        build(params, { ...base, start: track.start, end: pos } as TdTrack, other, pos);
      }
    }
  }

  if (list.targetTrack2Track && list.track.enabled)
    out.push(...addTeardropsOnTracks(board, list, tolerance, maxError));

  setTeardropPriorities(out);

  return out;
}

/**
 * The teardrops as board zones, ready to drop into `board.zones`.
 *
 * `createTeardrop` fills each zone with its own outline instead of running the
 * zone filler over it — upstream's note is that a real refill is potentially
 * very expensive, and the outline is already the intended copper.
 */
export function teardropZones(
  teardrops: readonly Teardrop[],
  netNames?: ReadonlyMap<number, string>,
): PcbZone[] {
  return teardrops.map((td) => ({
    net: td.net,
    netName: netNames?.get(td.net) ?? '',
    layers: [td.layer],
    fills: [{ layer: td.layer, polys: [td.corners] }],
    outline: td.corners,
    padConnection: 'full' as const,
    clearance: 0,
    minThickness: pcbIUScale.mmToIU(0.0254),
    filled: true,
    priority: td.priority,
    teardropType: td.type,
    // ZONE_BORDER_DISPLAY_STYLE::INVISIBLE_BORDER.
    hatchStyle: 'none' as const,
    // Source-less, so the writer emits it from buildZoneNode. A non-empty
    // source here would be echoed to the file verbatim.
    source: { kind: 'list' as const, items: [] },
  }));
}

/**
 * TEARDROP_MANAGER::RemoveTeardrops with a full sweep: every generated
 * teardrop zone, gone. User zones are untouched.
 */
export function removeTeardrops(board: Board): Board {
  return { ...board, zones: board.zones.filter((z) => !z.teardropType) };
}

/**
 * Rebuild every teardrop on the board: drop the old generated zones, run the
 * generator, append the new ones.
 *
 * This is the `UpdateTeardrops( aForceFullUpdate = true )` entry point the
 * "Add Teardrops" command uses. Teardrop zones go last in `board.zones` so
 * their high priorities sort above the user's pours.
 */
export function applyTeardrops(board: Board, opts: UpdateTeardropsOptions = {}): Board {
  const cleaned = removeTeardrops(board);
  const zones = teardropZones(updateTeardrops(cleaned, opts), board.nets);
  return { ...cleaned, zones: [...cleaned.zones, ...zones] };
}
