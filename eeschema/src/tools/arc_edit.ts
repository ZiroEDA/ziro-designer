// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Editing an arc by its edit points. Counterpart: the `KI_ARC_EDIT` namespace
 * and the `editArc*` helpers in `common/tool/point_editor_behavior.cpp`, driven
 * by `EDA_ARC_POINT_EDIT_BEHAVIOR`.
 *
 * An arc has four points: start, mid, end and centre. What dragging one does
 * depends on `ARC_EDIT_MODE`, the "Arc editing mode" preference
 * (`EESCHEMA_SETTINGS::m_Drawing.arc_edit_mode`), because there is no single
 * right answer: keeping the centre and keeping the endpoints are both reasonable
 * and mutually exclusive. All three modes are here.
 *
 * KiCad holds an arc as (start, end, centre) with the mid point derived, while
 * we store (start, mid, end) as the file does. `arcState` and `arcFromState`
 * convert between the two, going through the same CalcArcCenter / GetArcMid
 * that EDA_SHAPE does, so an edit lands on the same geometry upstream would
 * reach and a round trip through an untouched arc is the identity.
 */

import { CalcArcCenter, RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { EDA_ANGLE, ANGLE_360 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { GetArcAngle } from '@ziroeda/common/src/eda_shape.js';
import type { Vec2 } from '../types.js';

/**
 * `ARC_EDIT_MODE` (settings/app_settings.h), in the order the enum declares it,
 * which is the order the preference stores.
 */
export enum ArcEditMode {
  /** Endpoints adjust angle and radius, the mid adjusts radius, the centre moves the arc. */
  KeepCenterAdjustAngleRadius = 0,
  /** Endpoints and the mid leave the others in place; the centre keeps the endpoints. */
  KeepEndpointsOrStartDirection = 1,
  /** Endpoints adjust only the angle, the mid only the radius, the centre moves the arc. */
  KeepCenterEndsAdjustAngle = 2,
}

/**
 * The next mode in the cycle (`IncrementArcEditMode`). Note it is not the
 * declaration order: cycling goes radius, then angle, then endpoints, so the two
 * centre-keeping modes sit next to each other.
 */
export function incrementArcEditMode(mode: ArcEditMode): ArcEditMode {
  switch (mode) {
    case ArcEditMode.KeepCenterAdjustAngleRadius:
      return ArcEditMode.KeepCenterEndsAdjustAngle;
    case ArcEditMode.KeepCenterEndsAdjustAngle:
      return ArcEditMode.KeepEndpointsOrStartDirection;
    default:
      return ArcEditMode.KeepCenterAdjustAngleRadius;
  }
}

/** An arc as KiCad holds it while editing: the mid point is derived from these. */
export interface ArcState {
  start: Vec2;
  end: Vec2;
  center: Vec2;
}

/**
 * A 1 mil floor keeps an edited arc non-degenerate. Upstream takes it from the
 * caller's IU scale for exactly this reason: eeschema arcs are legitimately
 * smaller than pcbnew's, so a fixed floor would snap them.
 */
const MIN_RADIUS = mmToIU(0.0254);

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const norm = (v: Vec2): number => Math.hypot(v.x, v.y);
const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** `VECTOR2I::Resize`: the same direction, scaled to length `len`. */
function resize(v: Vec2, len: number): Vec2 {
  const l = norm(v);
  if (l === 0) return { x: 0, y: 0 };
  return { x: (v.x / l) * len, y: (v.y / l) * len };
}

/**
 * `EDA_SHAPE::CalcArcAngles`, then their difference: the arc's sweep. One copy,
 * in common/, because pcbnew's Properties panel shows the same number.
 */
const arcAngle = (s: ArcState): EDA_ANGLE => GetArcAngle(s.start, s.end, s.center);

/** `EDA_SHAPE::GetArcMid`: the start swung half the sweep about the centre. */
export function arcMidOf(s: ArcState): Vec2 {
  return round(RotatePoint(s.start, s.center, arcAngle(s).multiply(-0.5)));
}

/** `EDA_SHAPE::GetRadius`. */
const radiusOf = (s: ArcState): number => norm(sub(s.start, s.center));

/** Our (start, mid, end) as the (start, end, centre) KiCad edits. */
export const arcState = (start: Vec2, mid: Vec2, end: Vec2): ArcState => ({
  start,
  end,
  center: round(CalcArcCenter(start, mid, end)),
});

/**
 * Back to our (start, mid, end). The state already carries the winding in the
 * order of its endpoints, so the mid it implies is the one to store.
 */
export const arcFromState = (s: ArcState): { start: Vec2; mid: Vec2; end: Vec2 } => ({
  start: s.start,
  mid: arcMidOf(s),
  end: s.end,
});

/** `EDA_SHAPE::SetArcGeometry`, as a value: recentre, and swap ends if the
 *  winding disagrees with the mid it was given. */
export function setArcGeometry(
  start: Vec2,
  mid: Vec2,
  end: Vec2,
): { start: Vec2; mid: Vec2; end: Vec2 } {
  const center = round(CalcArcCenter(start, mid, end));
  const newMid = arcMidOf({ start, end, center });
  const dist = norm(sub(newMid, mid));
  const dist2 = norm(sub(newMid, center));
  // The derived mid landed on the far side of the circle from the one asked
  // for, so the input winding was the other way round.
  if (dist > dist2) return { start: end, mid, end: start };
  return { start, mid, end };
}

/**
 * Move an end point around the circumference, adjusting the radius to reach it
 * and bringing the other end to the same radius
 * (`KI_ARC_EDIT::EditArcEndpointKeepCenter`).
 */
export function editArcEndpointKeepCenter(
  cur: ArcState,
  center: Vec2,
  start: Vec2,
  end: Vec2,
): ArcState {
  const movingStart = start.x !== cur.start.x || start.y !== cur.start.y;
  const prevP1 = movingStart ? cur.start : cur.end;
  let p1 = sub(movingStart ? start : end, center);
  let p2 = sub(movingStart ? end : start, center);

  if (p1.x === 0 && p1.y === 0) p1 = sub(prevP1, center);
  if (p2.x === 0 && p2.y === 0) p2 = { x: 1, y: 0 };

  const radius = Math.max(norm(p1), MIN_RADIUS);
  p1 = add(center, round(resize(p1, Math.round(radius))));
  p2 = add(center, round(resize(p2, Math.round(radius))));

  return movingStart ? { start: p1, end: p2, center } : { start: p2, end: p1, center };
}

/**
 * Move an end point around the circumference without changing the radius, so
 * only the angle it subtends changes (`editArcEndpointKeepCenterAndRadius`).
 */
export function editArcEndpointKeepRadius(
  cur: ArcState,
  center: Vec2,
  start: Vec2,
  end: Vec2,
): ArcState {
  const movingStart = start.x !== cur.start.x || start.y !== cur.start.y;
  const p1 = movingStart ? start : end;
  const moved = add(center, round(resize(sub(p1, center), radiusOf(cur))));
  return movingStart
    ? { start: moved, end: cur.end, center }
    : { start: cur.start, end: moved, center };
}

/**
 * Move an end point keeping the other end and the tangent there
 * (`editArcEndpointKeepTangent`). The new centre stays on the axis through the
 * fixed end, which is what keeps that tangent.
 */
export function editArcEndpointKeepTangent(
  cur: ArcState,
  center: Vec2,
  start: Vec2,
  mid: Vec2,
  end: Vec2,
): ArcState {
  let movingStart: boolean;
  let p1: Vec2;
  let p2: Vec2;
  if (start.x !== cur.start.x || start.y !== cur.start.y) {
    p1 = end;
    p2 = start;
    movingStart = true;
  } else if (end.x !== cur.end.x || end.y !== cur.end.y) {
    p1 = start;
    p2 = end;
    movingStart = false;
  } else {
    return cur;
  }
  const p3 = mid;

  let v1 = sub(p1, center);
  const v2raw = sub(p2, center);
  const v3 = sub(p3, center);
  // A point cannot be both the centre and on the arc.
  if (norm(v1) === 0 || norm(v2raw) === 0) return cur;

  // [u1, u2] is an orthonormal base centred on the circle: u1 toward the end
  // that does not move, u2 toward the mid point.
  const l1 = norm(v1);
  const u1 = { x: v1.x / l1, y: v1.y / l1 };
  const proj = u1.x * v3.x + u1.y * v3.y;
  let u2 = { x: v3.x - proj * u1.x, y: v3.y - proj * u1.y };
  const l2 = norm(u2);
  if (l2 === 0) return cur;
  u2 = { x: u2.x / l2, y: u2.y / l2 };

  const det = u1.x * u2.y - u2.x * u1.y;
  // u1 and u2 are unit and perpendicular, so this should never be 0.
  if (det === 0) return cur;

  const into = (v: Vec2): Vec2 => ({
    x: (v.x * u2.y - v.y * u2.x) / det,
    y: (-v.x * u1.y + v.y * u1.x) / det,
  });
  v1 = into(v1);
  let v2 = into(v2raw);

  const R = norm(v1);
  if (v2.x === R) return cur; // straight line, leave it alone

  let transformCircle = false;
  if (v2.x > R) {
    // The curvature has to invert; mirror the input so the same equation holds.
    transformCircle = true;
    v2 = { x: 2 * R - v2.x, y: v2.y };
  }

  const delta = (R * R - v2.x * v2.x - v2.y * v2.y) / (2 * v2.x - 2 * R);
  // Bounds the radius so nothing overflows downstream (m_DrawArcCenterMaxAngle).
  if (Math.abs(v2.y / (R - v2.x)) > 50 || !Number.isFinite(delta)) return cur;

  const v4 = transformCircle ? { x: 2 * R + delta, y: 0 } : { x: -delta, y: 0 };
  const back = {
    x: v4.x * u1.x + v4.y * u2.x,
    y: v4.x * u1.y + v4.y * u2.y,
  };
  const newCenter = round(add(back, center));

  return movingStart
    ? { start, end: cur.end, center: newCenter }
    : { start: cur.start, end, center: newCenter };
}

/**
 * Move the mid point, keeping the centre: the radius follows the cursor and both
 * endpoints slide out to it (`KI_ARC_EDIT::EditArcMidKeepCenter`).
 */
export function editArcMidKeepCenter(center: Vec2, start: Vec2, end: Vec2, cursor: Vec2): ArcState {
  const radius = Math.max(norm(sub(cursor, center)), MIN_RADIUS);
  return {
    start: add(center, round(resize(sub(start, center), Math.round(radius)))),
    end: add(center, round(resize(sub(end, center), Math.round(radius)))),
    center,
  };
}

/**
 * Move the mid point, keeping both endpoints (`editArcMidKeepEndpoints`). Legal
 * mid points lie on the ray from just off the chord midpoint out through the
 * current mid, so the arc cannot be inflected by point editing.
 */
export function editArcMidKeepEndpoints(
  cur: ArcState,
  start: Vec2,
  end: Vec2,
  cursor: Vec2,
): { start: Vec2; mid: Vec2; end: Vec2 } {
  const m = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const justOff = norm(sub(start, end)) / 100;
  const v = sub(arcMidOf(cur), m);
  if (norm(v) === 0) return { start, mid: arcMidOf(cur), end };
  const a = add(m, resize(v, justOff));
  const b = add(m, resize(v, Number.MAX_SAFE_INTEGER / 2));
  return setArcGeometry(start, round(nearestPointOnSegment(cursor, a, b)), end);
}

/**
 * Move the centre, keeping the endpoints (`editArcCenterKeepEndpoints`). The
 * centre of an arc through two fixed points must lie on their perpendicular
 * bisector, so the drag is projected onto it.
 */
export function editArcCenterKeepEndpoints(center: Vec2, start: Vec2, end: Vec2): Vec2 {
  const m = { x: start.x / 2 + end.x / 2, y: start.y / 2 + end.y / 2 };
  const d = sub(end, start);
  // VECTOR2I::Perpendicular is (-y, x).
  const perp = resize({ x: -d.y, y: d.x }, Number.MAX_SAFE_INTEGER / 2);
  if (norm(perp) === 0) return center;
  return round(nearestPointOnSegment(center, sub(m, perp), add(m, perp)));
}

/** `SEG::NearestPoint`, clamped to the segment. */
function nearestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
