// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where each copy of an array goes, and what it is called.
 * Counterparts: `common/array_options.cpp`, `common/array_axis.cpp` and
 * `AlphabeticFromIndex` in `common/increment.cpp`.
 *
 * Two independent halves, kept apart because they are: the *transform* says
 * where copy n sits relative to the original, and the *numbering* says what
 * designator it gets. Neither needs the other.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `ARRAY_OPTIONS::TRANSFORM`: an offset from the original, plus a rotation. */
export interface ArrayTransform {
  offset: Vec2;
  /** Degrees. Always zero for a grid; circular arrays may turn each copy. */
  rotation: number;
}

// ----- numbering (ARRAY_AXIS) ------------------------------------------------

export type NumberingType = 'numeric' | 'hex' | 'alphaFull' | 'alphaNoIOSQXZ';

const ALPHABETS: Record<NumberingType, string> = {
  numeric: '0123456789',
  hex: '0123456789ABCDEF',
  alphaFull: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  // I, O, S, Q, X and Z are dropped: on a silkscreen they are too easily read
  // as 1, 0, 5, 0, a cross and 2.
  alphaNoIOSQXZ: 'ABCDEFGHJKLMNPRTUVWY',
};

/**
 * `schemeNonUnitColsStartAt0`: whether the second and later digits count from
 * the alphabet's first letter rather than its second.
 *
 * True for the alphabetic schemes, and it is what makes the letter after Z be
 * "AA" rather than "BA" — the spreadsheet convention, where A is both the first
 * symbol and an implicit leading zero.
 */
const nonUnitColsStartAt0 = (type: NumberingType): boolean =>
  type === 'alphaFull' || type === 'alphaNoIOSQXZ';

/** `AlphabeticFromIndex`. */
export function alphabeticFromIndex(
  n: number,
  alphabet: string,
  zeroBasedNonUnitCols: boolean,
): string {
  const radix = alphabet.length;
  let rest = n;
  let out = '';
  let firstRound = true;

  do {
    let modN = rest % radix;
    if (zeroBasedNonUnitCols && !firstRound) modN--;
    out = alphabet[modN]! + out;
    rest = Math.floor(rest / radix);
    firstRound = false;
  } while (rest);

  return out;
}

export interface ArrayAxis {
  type?: NumberingType;
  /** Where the numbering starts, as an index into the alphabet. */
  offset?: number;
  /** How much the index advances per item. */
  step?: number;
  /** Emit lowercase, if the user typed a lowercase starting value. */
  useLowercase?: boolean;
}

/** `ARRAY_AXIS::GetItemNumber`. */
export function axisItemNumber(axis: ArrayAxis, n: number): string {
  const type = axis.type ?? 'numeric';
  const index = (axis.offset ?? 0) + (axis.step ?? 1) * n;
  const s = alphabeticFromIndex(index, ALPHABETS[type], nonUnitColsStartAt0(type));
  return axis.useLowercase ? s.toLowerCase() : s;
}

/**
 * `ARRAY_AXIS::getNumberingOffset`: read a starting designator back into an
 * index, so the user can type "C" or "10" rather than a number of steps.
 *
 * Returns null for anything the alphabet does not contain — which is how the
 * dialog tells a typo from a valid start.
 */
export function axisNumberingOffset(axis: ArrayAxis, str: string): number | null {
  if (str.length === 0) return null;

  const type = axis.type ?? 'numeric';
  const alphabet = ALPHABETS[type];
  const radix = alphabet.length;
  const start0 = nonUnitColsStartAt0(type);
  const numeric = type === 'numeric' || type === 'hex';

  let offset = 0;

  for (let i = 0; i < str.length; i++) {
    let ch = str[i]!;
    // The alphabets are written uppercase, so a lowercase entry is folded for
    // the lookup — the case is remembered separately, in `useLowercase`.
    if (!numeric && ch >= 'a' && ch <= 'z') ch = ch.toUpperCase();

    let chIndex = alphabet.indexOf(ch);
    if (chIndex < 0) return null;

    // "AA" is index 27, not 26.
    if (start0 && i < str.length - 1) chIndex++;

    offset = offset * radix + chIndex;
  }

  return offset;
}

// ----- grid arrays (ARRAY_GRID_OPTIONS) --------------------------------------

export interface ArrayGridOptions {
  nx: number;
  ny: number;
  /** Pitch along each axis. */
  delta: Vec2;
  /** Skew: how far each step along one axis shifts the other. */
  offset?: Vec2;
  /** Fill rows first, or columns first. */
  horizontalThenVertical?: boolean;
  /** Reverse every other row, so the numbering snakes rather than resets. */
  reverseNumberingAlternate?: boolean;
  /** Positions relative to the grid's centre rather than to item 0. */
  centred?: boolean;
  /** Offset every nth row (or column) by a fraction of the pitch. */
  stagger?: number;
  staggerRows?: boolean;
  /** Number by row and column separately, e.g. "B3". */
  twoDArrayNumbering?: boolean;
  priAxis?: ArrayAxis;
  secAxis?: ArrayAxis;
}

export const gridArraySize = (o: ArrayGridOptions): number => o.nx * o.ny;

/** `ARRAY_GRID_OPTIONS::getGridCoords`. */
export function gridCoords(o: ArrayGridOptions, n: number): Vec2 {
  const horizontalFirst = o.horizontalThenVertical ?? true;
  const axisSize = horizontalFirst ? o.nx : o.ny;

  let x = n % axisSize;
  const y = Math.floor(n / axisSize);

  // Snake: every other row runs the other way, so consecutive numbers stay
  // physically adjacent at the turn.
  if (o.reverseNumberingAlternate && y % 2) x = axisSize - x - 1;

  return { x, y };
}

/** `ARRAY_GRID_OPTIONS::gtItemPosRelativeToItem0`. */
function gridPosRelativeToItem0(o: ArrayGridOptions, n: number): { x: number; y: number } {
  const coords = gridCoords(o, n);
  const horizontalFirst = o.horizontalThenVertical ?? true;

  // Filling columns first swaps which coordinate means what.
  const cx = horizontalFirst ? coords.x : coords.y;
  const cy = horizontalFirst ? coords.y : coords.x;

  const off = o.offset ?? { x: 0, y: 0 };
  const point = {
    x: cx * o.delta.x + cy * off.x,
    y: cy * o.delta.y + cx * off.y,
  };

  const stagger = Math.abs(o.stagger ?? 0);

  // Zero would divide by zero below, and one puts every item in phase 0 — so
  // neither shifts anything. Upstream's bound is `> 1`; the `1` half of it is
  // arithmetically redundant and kept only to match.
  if (stagger > 1) {
    const sr = o.staggerRows ?? true;
    const staggerIdx = (sr ? cy : cx) % stagger;
    const staggerDelta = { x: sr ? o.delta.x : off.x, y: sr ? off.y : o.delta.y };
    // A negative stagger shifts the other way; the sign rides on the index.
    const signed = Math.sign(o.stagger ?? 0) * staggerIdx;

    point.x += Math.trunc((staggerDelta.x * signed) / stagger);
    point.y += Math.trunc((staggerDelta.y * signed) / stagger);
  }

  return point;
}

/** `ARRAY_GRID_OPTIONS::GetTransform`. */
export function gridTransform(o: ArrayGridOptions, n: number): ArrayTransform {
  const p = gridPosRelativeToItem0(o, n);
  const point = { x: p.x, y: p.y };

  if (o.centred) {
    // Shift the whole array back by half its extent, so the original sits in
    // the middle rather than at a corner.
    const off = o.offset ?? { x: 0, y: 0 };
    const extentX = (o.nx - 1) * o.delta.x + (o.ny - 1) * off.x;
    const extentY = (o.ny - 1) * o.delta.y + (o.nx - 1) * off.y;
    point.x -= Math.trunc(extentX / 2);
    point.y -= Math.trunc(extentY / 2);
  }

  return { offset: point, rotation: 0 };
}

/** `ARRAY_GRID_OPTIONS::GetItemNumber`. */
export function gridItemNumber(o: ArrayGridOptions, n: number): string {
  if (o.twoDArrayNumbering) {
    const c = gridCoords(o, n);
    return axisItemNumber(o.priAxis ?? {}, c.x) + axisItemNumber(o.secAxis ?? {}, c.y);
  }
  return axisItemNumber(o.priAxis ?? {}, n);
}

// ----- circular arrays (ARRAY_CIRCULAR_OPTIONS) ------------------------------

export interface ArrayCircularOptions {
  nPts: number;
  /** Degrees between copies, or 0 to divide a full turn evenly. */
  angle?: number;
  angleOffset?: number;
  clockwise?: boolean;
  centre: Vec2;
  /** Turn each copy to face outwards, rather than only moving it. */
  rotateItems?: boolean;
  axis?: ArrayAxis;
}

export const circularArraySize = (o: ArrayCircularOptions): number => o.nPts;

/** KiCad's `RotatePoint`: clockwise on screen for a positive angle, y being down. */
function rotateAbout(p: Vec2, c: Vec2, deg: number): Vec2 {
  const rad = (deg * Math.PI) / 180;
  const s = Math.sin(rad);
  const cs = Math.cos(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {
    x: Math.round(dy * s + dx * cs) + c.x,
    y: Math.round(dy * cs - dx * s) + c.y,
  };
}

/**
 * `ARRAY_CIRCULAR_OPTIONS::GetTransform`.
 *
 * An angle of zero means "space them evenly round a full turn" rather than
 * "do not move them" — the dialog's own convention, and the reason the field
 * can be left blank for the common case.
 */
export function circularTransform(o: ArrayCircularOptions, n: number, pos: Vec2): ArrayTransform {
  let angle = o.angle ? o.angle * n : (360 * n) / o.nPts;

  angle += o.angleOffset ?? 0;
  if (o.clockwise) angle = -angle;

  const moved = rotateAbout(pos, o.centre, angle);

  return {
    offset: { x: moved.x - pos.x, y: moved.y - pos.y },
    // The copy travels round the circle either way; this decides whether it
    // also turns as it goes.
    rotation: o.rotateItems ? angle : 0,
  };
}

/** `ARRAY_CIRCULAR_OPTIONS::GetItemNumber`. */
export const circularItemNumber = (o: ArrayCircularOptions, n: number): string =>
  axisItemNumber(o.axis ?? {}, n);
