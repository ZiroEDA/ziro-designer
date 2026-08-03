// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a dimension: the click sequence and what each click means.
 * Counterpart: `DRAWING_TOOL::DrawDimension` (pcbnew/tools/drawing_tool.cpp),
 * which drives all five `drawAlignedDimension` / `drawOrthogonalDimension` /
 * `drawCenterDimension` / `drawRadialDimension` / `drawLeader` actions through
 * one state machine.
 *
 * ## Two clicks or three
 *
 * Upstream's `SET_END` case falls through to `SET_HEIGHT` for centre, radial
 * and leader, so those finish on the **second** click. Aligned and orthogonal
 * stop at `SET_END` and need a **third** to place the crossbar. That asymmetry
 * is the whole shape of the tool and it is easy to miss, because the fallthrough
 * is written as a bare `++step; KI_FALLTHROUGH;` inside a switch.
 *
 * ## Which defaults each kind gets
 *
 * `setMeasurementAttributes` — units mode, units format, precision, suppress
 * zeroes, text position, keep-text-aligned — is applied to aligned, orthogonal
 * and radial, and **deliberately not** to centre or leader. Those two keep their
 * constructor values instead, because neither displays a measurement: both set
 * `m_overrideTextEnabled`, and a leader's text is whatever you type. Applying
 * the board defaults to them would be a plausible-looking mistake that only
 * shows up as a leader quietly gaining a units suffix.
 *
 * The geometry itself lives in dimension_geometry.ts; this only decides where
 * the feature points and the height go.
 */
import type { DimensionKind, DimensionStyle, PcbDimension, PcbTextItem } from './types.js';
import { isAlignedKind } from './types.js';
import { resize } from './dimension_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (v: number): number => Math.round(v * 1e6);
/** 50 mils, `DEFAULT_DIMENSION_ARROW_LENGTH`. */
export const DEFAULT_ARROW_LENGTH = MM(1.27);
/** `DEFAULT_DIMENSION_EXTENSION_OFFSET`, in mm. */
export const DEFAULT_EXTENSION_OFFSET = MM(0.5);
/** `PCB_DIMENSION_BASE`'s own line thickness before board settings override it. */
export const DEFAULT_LINE_THICKNESS = MM(0.2);
/** `s_arrowAngle.Sin()`, the factor `PCB_DIM_ALIGNED` seeds extension height by. */
const ARROW_ANGLE_SIN = Math.sin((27.5 * Math.PI) / 180);

/** The Board Setup values `setMeasurementAttributes` copies across. */
export interface DimensionDefaults {
  layer: string;
  lineThickness: number;
  arrowLength: number;
  extensionOffset: number;
  unitsMode: 0 | 1 | 2 | 3;
  unitsFormat: 0 | 1 | 2;
  precision: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  suppressZeroes: boolean;
  textPositionMode: 0 | 1 | 2;
  keepTextAligned: boolean;
  textSize: number;
  textThickness: number;
}

/** `BOARD_DESIGN_SETTINGS`' dimension block, at its own defaults. */
export const DEFAULT_DIMENSION_DEFAULTS: DimensionDefaults = {
  layer: 'Dwgs.User', // PCB_DIMENSION_BASE sets m_layer = Dwgs_User
  lineThickness: DEFAULT_LINE_THICKNESS,
  arrowLength: DEFAULT_ARROW_LENGTH,
  extensionOffset: DEFAULT_EXTENSION_OFFSET,
  unitsMode: 3, // AUTOMATIC
  unitsFormat: 0, // NO_SUFFIX
  precision: 4, // X_XXXX
  suppressZeroes: true,
  textPositionMode: 0, // OUTSIDE
  keepTextAligned: true,
  textSize: MM(1),
  textThickness: MM(0.15),
};

/**
 * Where the placement has got to.
 *
 * Upstream's `DIMENSION_STEPS` also has `SET_ORIGIN`, but it never *waits* in
 * it: the first click runs that case and then `++step` immediately, so the
 * state a caller can observe always already has an origin. `startDimension` is
 * that first click, and it returns a draw sitting in `end`.
 */
export type DimensionDrawStep = 'end' | 'height';

export interface DimensionDraw {
  step: DimensionDrawStep;
  dimension: PcbDimension;
  /** True once the last click has been taken and the item should be committed. */
  done: boolean;
}

const EMPTY = { kind: 'list' as const, items: [] };
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

const textAt = (at: Vec2, d: DimensionDefaults, layer: string, text: string): PcbTextItem => ({
  kind: 'user',
  text,
  at,
  angle: 0,
  layer,
  size: { x: d.textSize, y: d.textSize },
  thickness: d.textThickness,
  source: EMPTY,
});

/**
 * `PCB_DIM_RADIAL::GetKnee`: where the radial leader bends, one leader-length
 * out along the radius from the measured point.
 */
export function radialKnee(d: PcbDimension): Vec2 {
  return add(d.end, resize(sub(d.end, d.start), d.leaderLength ?? 0));
}

/**
 * The text offset a radial or leader gets while being dragged: ten arrow
 * lengths sideways, flipping to the left when the dimension points left so the
 * label never lands back over the geometry.
 */
function draggedTextOffset(start: Vec2, end: Vec2, arrowLength: number): Vec2 {
  const dx = arrowLength * 10;
  return { x: end.x < start.x ? -dx : dx, y: 0 };
}

/** `SET_ORIGIN`: a fresh dimension of this kind, both feature points on the cursor. */
export function startDimension(
  kind: DimensionKind,
  at: Vec2,
  defaults: DimensionDefaults = DEFAULT_DIMENSION_DEFAULTS,
): DimensionDraw {
  const layer = defaults.layer;
  const style: DimensionStyle = {
    thickness: defaults.lineThickness,
    arrowLength: defaults.arrowLength,
    // Centre and leader keep the constructor's OUTSIDE; the others take the
    // board value. Both happen to be OUTSIDE by default, so this is only
    // visible once Board Setup changes it.
    textPositionMode: kind === 'center' || kind === 'leader' ? 0 : defaults.textPositionMode,
    extensionOffset: defaults.extensionOffset,
  };

  if (isAlignedKind(kind)) {
    style.arrowDirection = 'outward';
    // PCB_DIM_ALIGNED seeds the extension height from the arrow length so old
    // dimensions keep their look.
    style.extensionHeight = Math.round(defaults.arrowLength * ARROW_ANGLE_SIN);
    style.keepTextAligned = defaults.keepTextAligned;
  } else if (kind === 'radial') {
    style.keepTextAligned = defaults.keepTextAligned;
  }
  // A leader's ctor clears keepTextAligned and a centre mark has no text, so
  // neither sets it.

  const dimension: PcbDimension = {
    kind,
    layer,
    start: at,
    end: at,
    style,
    source: EMPTY,
  };

  if (isAlignedKind(kind)) dimension.height = 0;
  if (kind === 'orthogonal') dimension.orientation = 0;
  // PCB_DIM_RADIAL's ctor: m_leaderLength = m_arrowLength * 3.
  if (kind === 'radial') dimension.leaderLength = defaults.arrowLength * 3;

  if (kind !== 'center') {
    // `setMeasurementAttributes` is applied to aligned, orthogonal and radial
    // only. A leader keeps PCB_DIM_LEADER's constructor values, because it
    // shows text you typed rather than a measurement — giving it the board's
    // units block would quietly add a suffix to a label.
    const measuring = kind !== 'leader';
    dimension.format = {
      prefix: kind === 'radial' ? 'R ' : '',
      suffix: '',
      units: measuring ? defaults.unitsMode : 0,
      unitsFormat: measuring ? defaults.unitsFormat : 0,
      precision: measuring ? defaults.precision : 4,
      suppressZeroes: measuring ? defaults.suppressZeroes : false,
      // PCB_DIM_LEADER sets m_overrideTextEnabled and an override of "Leader".
      ...(kind === 'leader' ? { overrideValue: 'Leader' } : {}),
    };
    dimension.text = textAt(at, defaults, layer, kind === 'leader' ? 'Leader' : '');
  }

  return { step: 'end', dimension, done: false };
}

/** `evt->IsMotion()`: the cursor moved, so update whatever the current step tracks. */
export function moveDimension(draw: DimensionDraw, cursor: Vec2): DimensionDraw {
  const d = draw.dimension;

  if (draw.step === 'end') {
    const next: PcbDimension = { ...d, end: cursor };

    if (d.kind === 'orthogonal') {
      // "Create a nice preview by measuring the longer dimension."
      const w = Math.abs(cursor.x - d.start.x);
      const h = Math.abs(cursor.y - d.start.y);
      next.orientation = w < h ? 1 : 0;
    } else if (d.kind === 'radial') {
      const knee = radialKnee(next);
      next.text = d.text
        ? { ...d.text, at: add(knee, draggedTextOffset(d.start, cursor, d.style.arrowLength)) }
        : undefined;
    } else if (d.kind === 'leader') {
      next.text = d.text
        ? { ...d.text, at: add(cursor, draggedTextOffset(d.start, cursor, d.style.arrowLength)) }
        : undefined;
    }
    return { ...draw, dimension: next };
  }

  // SET_HEIGHT
  if (isAlignedKind(d.kind)) return { ...draw, dimension: setHeightFromCursor(d, cursor) };
  return draw;
}

/**
 * `SET_HEIGHT`'s motion handler, for both kinds that have one.
 *
 * Aligned projects the cursor onto the perpendicular of its own axis, so the
 * crossbar slides along that normal and the measurement never changes.
 * Orthogonal instead takes one raw axis of the cursor — and **only re-picks
 * which axis while the cursor is outside the two feature points' box**, so the
 * orientation stops flickering once you have committed to a side.
 */
export function setHeightFromCursor(d: PcbDimension, cursor: Vec2): PcbDimension {
  if (d.kind === 'aligned') {
    const angle = Math.atan2(d.end.y - d.start.y, d.end.x - d.start.x) + Math.PI / 2;
    const delta = sub(cursor, d.end);
    const height = delta.x * Math.cos(angle) + delta.y * Math.sin(angle);
    return { ...d, height: Math.round(height) };
  }

  const left = Math.min(d.start.x, d.end.x);
  const right = Math.max(d.start.x, d.end.x);
  const top = Math.min(d.start.y, d.end.y);
  const bottom = Math.max(d.start.y, d.end.y);
  const inside = cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom;

  let vert = d.orientation === 1;
  if (!inside) {
    if (right - left === 0) vert = true;
    else if (bottom - top === 0) vert = false;
    else if (cursor.x > left && cursor.x < right) vert = false;
    else if (cursor.y > top && cursor.y < bottom) vert = true;
    else {
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      vert = Math.abs(cursor.y - cy) < Math.abs(cursor.x - cx);
    }
  }

  const heightVector = sub(cursor, d.start);
  return {
    ...d,
    orientation: vert ? 1 : 0,
    height: vert ? heightVector.x : heightVector.y,
  };
}

/**
 * A click. Advances the step, or refuses to when the result would be degenerate.
 *
 * A dimension whose two feature points are the same spot is not valid, so the
 * second click on the origin is *ignored* rather than producing a zero-length
 * dimension (upstream's `--step`).
 */
export function clickDimension(draw: DimensionDraw, cursor: Vec2): DimensionDraw {
  if (draw.done) return draw;
  const moved = moveDimension(draw, cursor);
  const d = moved.dimension;

  if (draw.step === 'end') {
    // "Dimensions that have origin and end in the same spot are not valid."
    if (same(d.start, d.end)) return { ...moved, step: 'end' };
    // Centre, radial and leader fall through to SET_HEIGHT and finish here.
    if (!isAlignedKind(d.kind)) return { ...moved, step: 'height', done: true };
    return { ...moved, step: 'height' };
  }

  return { ...moved, done: true };
}

/** How many clicks this kind takes to place, origin included. */
export function dimensionClickCount(kind: DimensionKind): number {
  return isAlignedKind(kind) ? 3 : 2;
}
