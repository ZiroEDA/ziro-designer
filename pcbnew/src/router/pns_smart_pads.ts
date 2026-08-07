// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OPTIMIZER`'s two pad-aware passes — `SMART_PADS` and `FANOUT_CLEANUP` —
 * and the breakout machinery underneath them.
 * Counterparts: `pcbnew/router/pns_optimizer.cpp` (`runSmartPads`,
 * `smartPadsSingle`, `computeBreakouts`, `circleBreakouts`, `rectBreakouts`,
 * `customBreakouts`, `findPadOrVia`, `fanoutCleanup`) and
 * `pcbnew/router/pns_utils.cpp` (`ApproximateSegmentAsRect`).
 *
 * ## Why these two passes arrive after the rest of the optimizer
 *
 * `pns_optimizer.ts` shipped the merge passes and said these were deferred
 * because both need `NODE`'s joint model: the pass has to ask *what is at the
 * end of this line* before it can reroute the exit, and that question is
 * `NODE::FindJoint`. With `NODE` complete they are reachable, and they are the
 * difference between a route that is correct and one that looks drawn by hand —
 * a track leaving a pad on the diagonal instead of clipping its corner.
 *
 * ## They live in their own module
 *
 * `pns_optimizer.ts` is deliberately pure: chains in, chains out, with a
 * collision callback. These passes are not — they take a `PnsNode` and a
 * `PnsLine`, because a breakout depends on the *item* at the line's end and its
 * shape. Keeping them apart leaves the existing functions callable with no
 * world at all, which is how `route_tool.ts` uses them today.
 *
 * ## Breakouts, and the one place Ziro's shape union forces a decision
 *
 * Upstream dispatches on `SHAPE::Type()`: `SH_RECT` takes {@link rectBreakouts}
 * (twelve rays, with the diagonal ones offset along the pad's long axis so an
 * oblong pad is left along its length), `SH_CIRCLE` takes
 * {@link circleBreakouts} (eight rays at 45°), `SH_SEGMENT` is approximated as
 * a rect first, and `SH_SIMPLE` takes {@link customBreakouts}, which casts rays
 * and keeps where they cross the outline.
 *
 * Ziro has no rectangle shape — a rectangular pad arrives as a `poly`. Sending
 * every `poly` to `customBreakouts` would be the literal reading of the union
 * and the wrong one: it would give a plain rectangular pad eight ray-cast
 * breakouts where KiCad gives it twelve with the long-axis offset, and oblong
 * pads are exactly what this pass exists to serve. So an axis-aligned
 * four-point `poly` is recognised as a rectangle and routed to
 * {@link rectBreakouts}; anything else is a `SH_SIMPLE`. That recognition is
 * the only judgement in this file, and it is pinned by tests on both sides.
 *
 * ## Faithfully reproduced, not to be "fixed"
 *
 * `smartPadsSingle` refuses vias outright — upstream's comment says they are
 * always round "at the moment" and the optimizer would mess up an intended via
 * exit posture — so {@link computeBreakouts} builds circle breakouts for a via
 * that `smartPadsSingle` then never asks for. Offset pads are refused too.
 * `fanoutCleanup` requires a `startPad` but accepts a missing `endPad` when the
 * line ends in a via, and its length threshold is ten times the track width.
 */
import { PnsKind, type PnsItem } from './pns_item.js';
import { PnsSolid } from './pns_solid.js';
import type { PnsLine } from './pns_line_item.js';
import { PnsLineChain } from './pns_line_item.js';
import type { PnsNode } from './pns_node.js';
import type { NetHandle } from './pns_collision.js';
import { chainCornerCost } from './pns_optimizer.js';
import { Direction45, AngleType } from '@ziroeda/kimath/src/geometry/direction45.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `OPTIMIZER::BREAKOUT_LIST`: candidate exits, each a chain from the centre. */
export type BreakoutList = Vec2[][];

/**
 * The angles `smartPadsSingle` refuses between a breakout's last segment and
 * the connecting trace. Upstream spells the mask out at the top of the
 * function rather than reusing one.
 */
export const SMART_PADS_FORBIDDEN_ANGLES =
  AngleType.ANG_ACUTE | AngleType.ANG_RIGHT | AngleType.ANG_HALF_FULL | AngleType.ANG_UNDEFINED;

/** An axis-aligned rectangle, standing in for `SHAPE_RECT`. */
export interface BreakoutRect {
  pos: Vec2;
  size: Vec2;
}

/**
 * `ApproximateSegmentAsRect` (`pns_utils.cpp`).
 *
 * Note it grows *both* ends by half the width in *both* axes — it is the
 * bounding box of the segment inflated by a square, not a stadium, so a
 * diagonal segment gets a box far larger than the shape it stands for. That is
 * upstream's, and the only consumer is a breakout ray direction.
 */
export function approximateSegmentAsRect(aA: Vec2, aB: Vec2, aWidth: number): BreakoutRect {
  const d = Math.trunc(aWidth / 2);
  const p0 = { x: aA.x - d, y: aA.y - d };
  const p1 = { x: aB.x + d, y: aB.y + d };

  return {
    pos: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y) },
    size: { x: Math.abs(p1.x - p0.x), y: Math.abs(p1.y - p0.y) },
  };
}

/**
 * `OPTIMIZER::circleBreakouts`.
 *
 * Eight rays at 45°, each reaching `radius * sqrt(2)` — the circumradius of the
 * square around the circle, so a diagonal exit clears the corner a rectangular
 * pad of the same size would have. `aWidth` is accepted and unused, as upstream.
 */
export function circleBreakouts(_aWidth: number, aCentre: Vec2, aRadius: number): BreakoutList {
  const out: BreakoutList = [];

  for (let deg = 0; deg < 360; deg += 45) {
    const v = RotatePoint({ x: Math.trunc(aRadius * Math.SQRT2), y: 0 }, new EDA_ANGLE(-deg));
    out.push([{ ...aCentre }, { x: aCentre.x + v.x, y: aCentre.y + v.y }]);
  }

  return out;
}

/**
 * `OPTIMIZER::rectBreakouts`.
 *
 * Four axis exits, then — when diagonals are permitted — four more that step
 * along the pad's **long** axis first and only then turn 45°. That offset is
 * the whole point of the routine: on an oblong pad it makes the diagonal exit
 * leave from near the end rather than from the centre, so the track follows the
 * pad's preferential direction instead of paralleling its short side.
 *
 * Upstream's two arms differ only in which of the four diagonals get which
 * sign, and its own comment on the second says "fixme: this could be done more
 * efficiently". Both are transcribed as written.
 */
export function rectBreakouts(
  aWidth: number,
  aRect: BreakoutRect,
  aPermitDiagonal: boolean,
): BreakoutList {
  const s = aRect.size;
  const c = {
    x: aRect.pos.x + Math.trunc(s.x / 2),
    y: aRect.pos.y + Math.trunc(s.y / 2),
  };

  const dOffset = {
    x: s.x > s.y ? Math.trunc((s.x - s.y) / 2) : 0,
    y: s.x < s.y ? Math.trunc((s.y - s.x) / 2) : 0,
  };
  const dVert = { x: 0, y: Math.trunc(s.y / 2) + aWidth };
  const dHoriz = { x: Math.trunc(s.x / 2) + aWidth, y: 0 };

  const add = (v: Vec2): Vec2 => ({ x: c.x + v.x, y: c.y + v.y });
  const sub = (v: Vec2): Vec2 => ({ x: c.x - v.x, y: c.y - v.y });

  const out: BreakoutList = [
    [{ ...c }, add(dHoriz)],
    [{ ...c }, sub(dHoriz)],
    [{ ...c }, add(dVert)],
    [{ ...c }, sub(dVert)],
  ];

  if (!aPermitDiagonal) return out;

  const l = aWidth + Math.trunc(Math.min(s.x, s.y) / 2);
  const plus = add(dOffset);
  const minus = sub(dOffset);
  const off = (p: Vec2, dx: number, dy: number): Vec2 => ({ x: p.x + dx, y: p.y + dy });

  if (s.x >= s.y) {
    out.push([{ ...c }, plus, off(plus, l, l)]);
    out.push([{ ...c }, plus, off(plus, -l, -l)]);
    out.push([{ ...c }, minus, off(minus, -l, l)]);
    out.push([{ ...c }, minus, off(minus, l, -l)]);
  } else {
    out.push([{ ...c }, plus, off(plus, l, l)]);
    out.push([{ ...c }, minus, off(minus, -l, l)]);
    out.push([{ ...c }, plus, off(plus, -l, l)]);
    out.push([{ ...c }, minus, off(minus, l, -l)]);
  }

  return out;
}

/** Segment-vs-segment intersection, for the ray casts `customBreakouts` makes. */
function raySegIntersect(aP0: Vec2, aP1: Vec2, aA: Vec2, aB: Vec2): Vec2 | null {
  const rx = aP1.x - aP0.x;
  const ry = aP1.y - aP0.y;
  const sx = aB.x - aA.x;
  const sy = aB.y - aA.y;
  const denom = rx * sy - ry * sx;

  if (denom === 0) return null;

  const t = ((aA.x - aP0.x) * sy - (aA.y - aP0.y) * sx) / denom;
  const u = ((aA.x - aP0.x) * ry - (aA.y - aP0.y) * rx) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: Math.round(aP0.x + t * rx), y: Math.round(aP0.y + t * ry) };
}

/**
 * `OPTIMIZER::customBreakouts`.
 *
 * Casts a ray from the pad's position out past its bounding box and keeps the
 * point where it crosses the outline. Upstream carries two commented-out
 * alternatives — a breakout set back by 40% of the centre-to-edge distance, and
 * an absolute 0.1 mm — and uses neither; the breakout sits **on** the edge.
 * That is left as-is, comments and all, because the choice is visible in every
 * routed exit.
 *
 * The ray is `max(w, h) / 2 + 5` long, upstream's "must be large enough to
 * guarantee intersecting the convex polygon". Rays that hit nothing are
 * dropped — upstream notes `n == 0` "can not happen I think, but...".
 */
export function customBreakouts(
  _aWidth: number,
  aPos: Vec2,
  aOutline: readonly Vec2[],
  aPermitDiagonal: boolean,
): BreakoutList {
  const out: BreakoutList = [];

  if (aOutline.length < 2) return out;

  const xs = aOutline.map((p) => p.x);
  const ys = aOutline.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const length = Math.trunc(Math.max(w, h) / 2) + 5;
  const increment = aPermitDiagonal ? 45 : 90;

  for (let deg = 0; deg < 360; deg += increment) {
    const v = RotatePoint({ x: aPos.x + length, y: aPos.y }, aPos, new EDA_ANGLE(-deg));

    let hit: Vec2 | null = null;

    for (let i = 0; i < aOutline.length && !hit; i++) {
      const a = aOutline[i] as Vec2;
      const b = aOutline[(i + 1) % aOutline.length] as Vec2;
      hit = raySegIntersect(aPos, v, a, b);
    }

    if (hit) out.push([{ ...aPos }, hit]);
  }

  return out;
}

/**
 * An axis-aligned four-point `poly` read back as a rectangle.
 *
 * Ziro's `Shape` union has no rectangle, so this is how a `SH_RECT` pad reaches
 * {@link rectBreakouts} rather than being demoted to a ray-cast `SH_SIMPLE`.
 * Anything rotated, or with any other vertex count, is not a rectangle.
 */
export function polyAsAxisAlignedRect(aPts: readonly Vec2[]): BreakoutRect | null {
  if (aPts.length !== 4) return null;

  const xs = [...new Set(aPts.map((p) => p.x))];
  const ys = [...new Set(aPts.map((p) => p.y))];

  if (xs.length !== 2 || ys.length !== 2) return null;

  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);

  return { pos: { x: x0, y: y0 }, size: { x: Math.max(...xs) - x0, y: Math.max(...ys) - y0 } };
}

/** `OPTIMIZER::computeBreakouts`, over Ziro's shape union. */
export function computeBreakouts(
  aWidth: number,
  aItem: PnsItem,
  aPermitDiagonal: boolean,
): BreakoutList {
  const shape: Shape | null = aItem.shape(-1);

  if (!shape) return [];

  if (aItem.kind() === PnsKind.VIA_T) {
    // Upstream reads the via's layer-0 shape and notes a padstack TODO.
    return shape.kind === 'circle' ? circleBreakouts(aWidth, shape.c, shape.r) : [];
  }

  if (aItem.kind() !== PnsKind.SOLID_T) return [];

  switch (shape.kind) {
    case 'circle':
      return circleBreakouts(aWidth, shape.c, shape.r);
    case 'stadium':
      // `SH_SEGMENT` -> ApproximateSegmentAsRect -> rectBreakouts.
      return rectBreakouts(
        aWidth,
        approximateSegmentAsRect(shape.a, shape.b, shape.r * 2),
        aPermitDiagonal,
      );
    case 'poly': {
      const rect = polyAsAxisAlignedRect(shape.pts);

      if (rect) return rectBreakouts(aWidth, rect, aPermitDiagonal);

      const pos = aItem instanceof PnsSolid ? aItem.pos() : shape.pts[0];

      return pos ? customBreakouts(aWidth, pos, shape.pts, aPermitDiagonal) : [];
    }
    default:
      return [];
  }
}

/**
 * `OPTIMIZER::findPadOrVia`.
 *
 * The joint at the line's end, and the first via or pad linked to it. Note it
 * returns the *first* such link rather than the nearest or the largest — link
 * order is the answer.
 */
export function findPadOrVia(
  aNode: PnsNode,
  aLayer: number,
  aNet: NetHandle,
  aP: Vec2,
): PnsItem | null {
  const jt = aNode.findJoint(aP, aLayer, aNet);

  if (!jt) return null;

  for (const item of jt.linkList()) {
    if (item.ofKind(PnsKind.VIA_T | PnsKind.SOLID_T)) return item;
  }

  return null;
}

/** The corner count of a chain against a forbidden-angle mask. `LINE::CountCorners`. */
export function countCorners(aChain: readonly Vec2[], aAngles: number): number {
  let count = 0;

  for (let i = 0; i < aChain.length - 2; i++) {
    const a = Direction45.fromSeg(aChain[i] as Vec2, aChain[i + 1] as Vec2);
    const b = Direction45.fromSeg(aChain[i + 1] as Vec2, aChain[i + 2] as Vec2);

    if (a.angle(b) & aAngles) count++;
  }

  return count;
}

const chainLength = (c: readonly Vec2[]): number => {
  let l = 0;
  for (let i = 0; i + 1 < c.length; i++)
    l += Math.hypot(
      (c[i + 1] as Vec2).x - (c[i] as Vec2).x,
      (c[i + 1] as Vec2).y - (c[i] as Vec2).y,
    );
  return l;
};

/** A candidate rerouted exit, as `smartPadsSingle`'s `RtVariant` tuple. */
interface PadVariant {
  p: number;
  breakoutLength: number;
  chain: Vec2[];
}

/**
 * `OPTIMIZER::smartPadsSingle`.
 *
 * Tries every breakout against every one of the first three vertices, in both
 * postures, and keeps the cheapest that collides with nothing. The tie-break is
 * the part worth reading: **at equal corner cost the longer breakout wins**,
 * because on an oblong pad that is the exit that follows the pad's length
 * rather than paralleling its short side.
 *
 * The baseline is the line the user drew, so a route already good enough is
 * left alone. Vias and offset pads are refused outright.
 */
export function smartPadsSingle(
  aLine: PnsLine,
  aPad: PnsItem,
  aEnd: boolean,
  aEndVertex: number,
  aCollides: (chain: readonly Vec2[]) => boolean,
): { chain: Vec2[]; vertex: number } | null {
  const solid = aPad instanceof PnsSolid ? aPad : null;

  // Offset pads: the breakout geometry is built around the pad's position, so
  // an offset one would exit from the wrong place.
  if (solid) {
    const o = solid.offset();
    if (o.x !== 0 || o.y !== 0) return null;
  }

  // Vias are always round at the moment and the optimizer would possibly mess
  // up an intended via exit posture.
  if (aPad.kind() === PnsKind.VIA_T) return null;

  const breakouts = computeBreakouts(aLine.width(), aPad, true);
  const base = aLine.cLine().points();
  const line = aEnd ? [...base].reverse() : [...base];
  const pEnd = Math.min(aEndVertex, Math.min(3, line.length - 1));
  const variants: PadVariant[] = [];
  const lineLen = chainLength(line);

  // Start at 1: 0 is the pad connection itself.
  for (let p = 1; p <= pEnd; p++) {
    for (const breakout of breakouts) {
      for (let diag = 0; diag < 2; diag++) {
        const last = breakout[breakout.length - 1] as Vec2;
        const connect = Direction45.UNDEFINED.buildInitialTrace(last, line[p] as Vec2, diag === 0);

        if (connect.length < 2) continue;

        const dirBreakout = Direction45.fromSeg(breakout[breakout.length - 2] ?? last, last);
        const dirConnect = Direction45.fromSeg(connect[0] as Vec2, connect[1] as Vec2);

        if (dirBreakout.angle(dirConnect) & SMART_PADS_FORBIDDEN_ANGLES) continue;

        const breakoutLen = chainLength(breakout);

        if (breakoutLen > lineLen) continue;

        const v = [...breakout, ...connect];

        for (let i = p + 1; i < line.length; i++) v.push(line[i] as Vec2);

        if (countCorners(v, SMART_PADS_FORBIDDEN_ANGLES) !== 0) continue;

        variants.push({ p, breakoutLength: breakoutLen, chain: aEnd ? [...v].reverse() : v });
      }
    }
  }

  let minCost = chainCornerCost(base);
  let maxLength = 0;
  let best: PadVariant | null = null;

  for (const vp of variants) {
    const cost = chainCornerCost(vp.chain);

    if (aCollides(vp.chain)) continue;

    if (cost < minCost || (cost === minCost && vp.breakoutLength > maxLength)) {
      best = vp;

      if (cost <= minCost) maxLength = Math.max(vp.breakoutLength, maxLength);

      minCost = Math.min(cost, minCost);
    }
  }

  return best ? { chain: best.chain, vertex: best.p } : null;
}

/**
 * `OPTIMIZER::runSmartPads`.
 *
 * Both ends, start first. The second call's vertex budget depends on whether
 * the first found anything — upstream passes `PointCount() - 1` when it did
 * not, and `PointCount() - 1 - vtx` when it did, so a start reroute that ate
 * three vertices leaves the end pass three fewer to work with.
 */
export function runSmartPads(
  aLine: PnsLine,
  aNode: PnsNode,
  aCollides: (chain: readonly Vec2[]) => boolean,
): boolean {
  if (aLine.pointCount() < 3) return false;

  const pStart = aLine.cPoint(0);
  const pEnd = aLine.cLastPoint();
  const layer = aLine.layers().start();
  const startPad = findPadOrVia(aNode, layer, aLine.net(), pStart);
  const endPad = findPadOrVia(aNode, layer, aLine.net(), pEnd);

  let vtx = -1;

  if (startPad) {
    const r = smartPadsSingle(aLine, startPad, false, 3, aCollides);

    if (r) {
      aLine.setShape(PnsLineChain.fromPoints(r.chain));
      vtx = r.vertex;
    }
  }

  if (endPad) {
    const budget = vtx < 0 ? aLine.pointCount() - 1 : aLine.pointCount() - 1 - vtx;
    const r = smartPadsSingle(aLine, endPad, true, budget, aCollides);

    if (r) aLine.setShape(PnsLineChain.fromPoints(r.chain));
  }

  return true;
}

/**
 * `OPTIMIZER::fanoutCleanup`.
 *
 * A short line between two pads, or a pad and a via, is replaced outright by a
 * two-segment trace if either posture is clear. "Short" is ten times the track
 * width, which is why a fanout escape gets straightened and a real route does
 * not.
 *
 * Note the asymmetry: a missing `startPad` refuses immediately, but a missing
 * `endPad` is still accepted when the line ends in a via — upstream falls back
 * to `EndsWithVia()` there and to nothing at the start.
 */
export function fanoutCleanup(
  aLine: PnsLine,
  aNode: PnsNode,
  aCollides: (chain: readonly Vec2[]) => boolean,
): boolean {
  if (aLine.pointCount() < 3) return false;

  const pStart = aLine.cPoint(0);
  const pEnd = aLine.cLastPoint();
  const layer = aLine.layers().start();
  const startPad = findPadOrVia(aNode, layer, aLine.net(), pStart);
  const endPad = findPadOrVia(aNode, layer, aLine.net(), pEnd);

  if (!startPad) return false;

  const thr = aLine.width() * 10;
  const len = chainLength(aLine.cLine().points());
  const startMatch = startPad.ofKind(PnsKind.VIA_T | PnsKind.SOLID_T);
  const endMatch = endPad ? endPad.ofKind(PnsKind.VIA_T | PnsKind.SOLID_T) : aLine.endsWithVia();

  if (!(startMatch && endMatch && len < thr)) return false;

  for (let i = 0; i < 2; i++) {
    // Upstream passes ROUTER::Settings().GetCornerMode() here. buildInitialTrace
    // takes no corner-mode argument yet — only the mitered-45 arm is written —
    // so this is the mitered-45 behaviour, which is the default and the only
    // mode that currently builds geometry. Thread the mode through when the
    // 90-degree arm lands.
    const l2 = Direction45.UNDEFINED.buildInitialTrace(pStart, pEnd, i === 1);

    if (!aCollides(l2)) {
      aLine.setShape(PnsLineChain.fromPoints(l2));
      return true;
    }
  }

  return false;
}
