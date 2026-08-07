// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Obstacle hulls: the shape a router has to stay outside of.
 * Counterparts: `OctagonalHull`, `SegmentHull` and `BuildHullForPrimitiveShape`
 * (pcbnew/router/pns_utils.cpp), plus `SEGMENT::Hull`, `VIA::Hull` and
 * `SOLID::Hull`.
 *
 * A hull is not the obstacle. It is the obstacle *grown* by the clearance the
 * rules demand plus half the width of the track being routed, so that a path
 * whose **centreline** merely touches the hull leaves a track whose **edge**
 * sits exactly at the clearance. Working in hull space is what lets the router
 * treat a fat track as a zero-width line, and it is why every walkaround and
 * shove decision below this layer is about a polygon rather than a distance.
 *
 * ## Why octagons rather than true offsets
 *
 * A true offset of a rectangle has rounded corners, and of a segment has round
 * caps. Both would make the router's paths curve, and its whole geometry is
 * 45°. So the growth is approximated by an octagon whose chamfer is chosen to
 * touch the true rounding — never inside it, so the approximation is
 * conservative in the direction that matters: a path outside the octagon is
 * outside the real clearance too.
 *
 * ## The kink rule
 *
 * A segment shorter than a tenth of the clearance has no reliable direction —
 * its perpendicular is rounding noise, and the hull built from it comes out
 * twisted. Upstream snaps such a segment to whichever axis or diagonal it is
 * nearly on before building anything, and widens the clearance a unit or two to
 * cover the lie. That is a real routing situation, not a pathological one:
 * every corner a router lays down leaves a tiny segment behind while the mouse
 * is between grid points.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A closed polygon. First and last points are distinct; the edge wraps. */
export type Hull = Vec2[];

const SQRT1_2 = Math.SQRT1_2;

/** KiCad's KiROUND: round half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const perpendicular = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });
const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** `VECTOR2I::Resize`: same direction, given length, rounded to internal units. */
export function resize(v: Vec2, len: number): Vec2 {
  const n = Math.hypot(v.x, v.y);
  if (n === 0) return { x: 0, y: 0 };
  return { x: kiRound((v.x * len) / n) || 0, y: kiRound((v.y * len) / n) || 0 };
}

/**
 * `OctagonalHull`: a box grown by `clearance`, with its corners cut back by
 * `chamfer`.
 *
 * A zero chamfer degenerates to a plain rectangle, which is what a rectangular
 * pad wants — its true offset has rounded corners, but the router is happy to
 * treat those as square and stay further away than it must.
 */
export function octagonalHull(p0: Vec2, size: Vec2, clearance: number, chamfer: number): Hull {
  const s: Hull = [];
  const x0 = p0.x - clearance;
  const y0 = p0.y - clearance;
  const x1 = p0.x + size.x + clearance;
  const y1 = p0.y + size.y + clearance;

  s.push({ x: x0, y: y0 + chamfer });
  if (chamfer) s.push({ x: x0 + chamfer, y: y0 });

  s.push({ x: x1 - chamfer, y: y0 });
  if (chamfer) s.push({ x: x1, y: y0 + chamfer });

  s.push({ x: x1, y: y1 - chamfer });
  if (chamfer) s.push({ x: x1 - chamfer, y: y1 });

  s.push({ x: x0 + chamfer, y: y1 });
  if (chamfer) s.push({ x: x0, y: y1 - chamfer });

  return s;
}

/**
 * `IsSegment45Degree`: is this segment on an axis or a diagonal, to within an
 * internal unit?
 *
 * The tolerance is what makes it useful: a segment the user drew at 45° will
 * miss by a nanometre after rounding, and treating that as a general-direction
 * segment is what produces the twisted hulls the kink rule exists to prevent.
 */
export function isSegment45Degree(a: Vec2, b: Vec2): boolean {
  const dir = sub(b, a);
  if (Math.abs(dir.x) <= 1) return true;
  if (Math.abs(dir.y) <= 1) return true;
  const delta = Math.abs(dir.x) - Math.abs(dir.y);
  return delta >= -1 && delta <= 1;
}

/** Twice the signed area of the triangle o-a-b; the sign is the turn direction. */
const side = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * `SegmentHull`: the octagonal envelope of a track segment.
 *
 * `walkaroundThickness` is the width of the track being routed *past* this one,
 * and only half of it enters the growth — the other half is on the far side of
 * that track's own centreline. So the total separation between two track edges
 * comes out at exactly the clearance, which is the arithmetic the whole layer
 * rests on.
 *
 * The result is always wound **clockwise**. Walkaround picks a direction to
 * traverse the hull in, so a hull that came out either way round depending on
 * which end of the segment happened to be first would send paths round the
 * wrong side.
 */
export function segmentHull(
  a: Vec2,
  bIn: Vec2,
  width: number,
  clearance: number,
  walkaroundThickness: number,
): Hull {
  const kinkThreshold = clearance / 10;

  let cl = clearance + Math.trunc(walkaroundThickness / 2);
  const d = width / 2 + cl;
  const x = (2.0 / (1.0 + Math.SQRT2)) * d;
  const dr = kiRound(d);
  const xr2 = kiRound(x / 2.0);

  let b = bIn;
  let w = b.x - a.x;
  let h = b.y - a.y;
  const len = Math.hypot(w, h);

  // The kink rule. A segment this short has a direction made of rounding
  // noise, so it is snapped to the axis or diagonal it is nearly on before its
  // perpendicular is taken.
  if (a.x !== b.x || a.y !== b.y) {
    if (!isSegment45Degree(a, b)) {
      if (len <= kinkThreshold && len > 0) {
        const ll = Math.max(Math.abs(w), Math.abs(h));
        b = { x: a.x + sgn(w) * ll, y: a.y + sgn(h) * ll };
        w = b.x - a.x;
        h = b.y - a.y;
      }
    } else if (len <= kinkThreshold) {
      const delta45 = Math.abs(Math.abs(w) - Math.abs(h));

      // The clearance bumps below are upstream's and are *dead* in this
      // branch: `d` was computed from `cl` before the kink block, and nothing
      // after it reads `cl` again unless the segment degenerated to a point,
      // which snapping cannot cause. Kept because upstream has them and the
      // intent — pay a little clearance for the lie about the direction — is
      // worth preserving if `d` ever moves below this.
      if (Math.abs(w) <= 1) {
        // Almost vertical: make it exactly so.
        w = 0;
        cl += 1;
      } else if (Math.abs(h) <= 1) {
        h = 0;
        cl += 1;
      } else if (delta45 <= 2) {
        const longer = Math.max(Math.abs(w), Math.abs(h));
        w = sgn(w) * longer;
        h = sgn(h) * longer;
        cl += 2;
      }

      b = { x: a.x + w, y: a.y + h };
    }
  }

  // A zero-length segment is a dot, and its hull is the octagon of its own
  // square rather than anything derived from a direction it does not have.
  if (a.x === b.x && a.y === b.y) {
    const xx2 = kiRound(2.0 * (1.0 - SQRT1_2) * d);
    return octagonalHull(
      { x: a.x - Math.trunc(width / 2), y: a.y - Math.trunc(width / 2) },
      { x: width, y: width },
      cl,
      xx2,
    );
  }

  const dir = sub(b, a);
  const p0 = resize(perpendicular(dir), dr);
  const ds = resize(perpendicular(dir), xr2);
  const pd = resize(dir, xr2);
  const dp = resize(dir, dr);

  const s: Hull = [
    add(add(b, p0), pd),
    add(add(b, dp), ds),
    sub(add(b, dp), ds),
    add(sub(b, p0), pd),
    sub(sub(a, p0), pd),
    sub(sub(a, dp), ds),
    add(sub(a, dp), ds),
    sub(add(a, p0), pd),
  ];

  // Wind it clockwise, whichever way the segment happened to run.
  return side(s[0]!, s[1]!, a) < 0 ? [...s].reverse() : s;
}

/**
 * `VIA::Hull`: an octagon around the via's diameter.
 *
 * The chamfer is `(2·cl + width)·(1 − √½)`, which is the cut that makes the
 * octagon touch the true circular offset at its corners rather than crossing
 * inside it.
 */
export function viaHull(
  pos: Vec2,
  diameter: number,
  clearance: number,
  walkaroundThickness: number,
): Hull {
  const cl = clearance + Math.trunc(walkaroundThickness / 2);
  const half = Math.trunc(diameter / 2);

  return octagonalHull(
    { x: pos.x - half, y: pos.y - half },
    { x: diameter, y: diameter },
    cl,
    kiRound((2 * cl + diameter) * (1.0 - SQRT1_2)),
  );
}

/**
 * `BuildHullForPrimitiveShape` for a circle — a round pad, or a hole.
 *
 * Upstream writes the chamfer here as `2·(1−√½)·(r + cl)` and a via's as
 * `(2·cl + d)·(1−√½)`, which look like different rules and are the same one:
 * `d = 2r`, so both are `(2r + 2cl)(1−√½)`. Kept as two functions because
 * upstream has two and a via may yet grow a stack-dependent diameter, but a
 * round pad and a via of the same size get identical hulls, and a test says so
 * — I had assumed otherwise until the numbers disagreed.
 */
export function circleHull(center: Vec2, radius: number, clearance: number): Hull {
  return octagonalHull(
    { x: center.x - radius, y: center.y - radius },
    { x: 2 * radius, y: 2 * radius },
    clearance,
    kiRound(2.0 * (1.0 - SQRT1_2) * (radius + clearance)),
  );
}

/**
 * `BuildHullForPrimitiveShape` for a rectangle — a rectangular pad.
 *
 * No chamfer at all: the hull is the box grown by the clearance, corners
 * square. The true offset is rounded there, so this stays *outside* it, which
 * is the safe direction to be wrong in.
 */
export function rectHull(p0: Vec2, size: Vec2, clearance: number): Hull {
  return octagonalHull(p0, size, clearance, 0);
}
